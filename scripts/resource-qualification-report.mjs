import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exactCurrentResourceRouteFromManifest, loadCurrentResourceRouteManifest } from './current-resource-routes.mjs';
import { classifyResourceRecipeReleaseLanes } from './release-qualification-policy.mjs';
import { resourceRecipeHash, validateResourceQualificationEvidence } from './resource-qualification.mjs';
import { retainedRouteResourceProofs, validateRouteResourceWorkloadReceipt } from './route-resource-qualification.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const CONTRACT_PATH = join(BACKEND_ROOT, 'data', 'release-contract.v1.json');
const HISTORY_PATH = join(BACKEND_ROOT, 'data', 'auto_resource', 'history.json');
const RECEIPT_REGISTRY_PATH = join(BACKEND_ROOT, 'data', 'qualification', 'release', 'resource-run-receipts.v1.json');
const ROUTE_RECEIPT_REGISTRY_PATH = join(
  BACKEND_ROOT,
  'data',
  'qualification',
  'release',
  'route-resource-workload-receipts.v1.json',
);
const OUTPUT_PATH = join(BACKEND_ROOT, 'data', 'qualification', 'release', 'resource-recipe-coverage.v1.json');
const CHECK = process.argv.includes('--check');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function canonicalJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function reportHash(value) {
  const digest = createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
  return `sha256:resource-recipe-coverage-v1:${digest}`;
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function recipeKey(value) {
  return [value.modelType, value.dtype, value.offloadMode, value.quantizationMode].join('|');
}

function validMeasurement(entry) {
  const measurement = entry?.lastMeasurement;
  return (
    entry?.lastStatus === 'live_proven' &&
    typeof entry?.candidate?.artifactRevision === 'string' &&
    entry.candidate.artifactRevision.length >= 40 &&
    Number.isFinite(measurement?.elapsedSeconds) &&
    measurement.elapsedSeconds >= 0 &&
    Number.isInteger(measurement?.peakAllocatedBytes) &&
    measurement.peakAllocatedBytes > 0
  );
}

const contract = readJson(CONTRACT_PATH);
// Runtime history is intentionally local and may not exist in a clean checkout
// or on a freshly provisioned qualification host. Its absence means there is
// no legacy evidence; it must not prevent the campaign from reporting every
// recipe as missing and scheduling the required real-weight runs.
const history = existsSync(HISTORY_PATH) ? readJson(HISTORY_PATH) : { entries: {} };
const contractTemplateById = new Map(contract.templates.map((template) => [template.id, template]));
const releaseEligibleTemplateIds = new Set(
  contract.templates.filter((template) => template.releaseEligible).map((template) => template.id),
);
const requiredByKey = new Map();
for (const template of contract.templates) {
  if (template.qualificationExemption) continue;
  for (const recipe of template.resourceRecipes?.declaredRecipes ?? []) {
    const requirement = {
      modelType: template.modelType,
      dtype: recipe.dtype,
      offloadMode: recipe.offloadMode,
      quantizationMode: recipe.quantizationMode,
    };
    const key = recipeKey(requirement);
    const existing = requiredByKey.get(key) ?? { ...requirement, templates: [] };
    existing.templates.push(template.id);
    requiredByKey.set(key, existing);
  }
}

const evidenceByKey = new Map();
const routeQualificationsByKey = new Map();
for (const entry of Object.values(history.entries ?? {})) {
  if (!validMeasurement(entry)) continue;
  const key = recipeKey(entry.candidate);
  const previous = evidenceByKey.get(key);
  if (!previous || Number(entry.lastSuccessAt) > Number(previous.lastSuccessAt)) {
    evidenceByKey.set(key, {
      source: 'legacy_auto_history',
      capturedAt: new Date(Number(entry.lastSuccessAt)).toISOString(),
      candidateId: entry.candidate.id,
      artifact: entry.candidate.artifact,
      artifactRevision: entry.candidate.artifactRevision,
      hardwareFingerprint: entry.signature?.hardwareFingerprint ?? null,
      executionDurationSeconds: entry.lastMeasurement.elapsedSeconds,
      peakMemoryBytes: entry.lastMeasurement.peakAllocatedBytes,
      peakReservedBytes: entry.lastMeasurement.peakReservedBytes ?? null,
      processRssBytes: entry.lastMeasurement.processRssBytes ?? null,
      backend: entry.lastMeasurement.backend ?? null,
      device: entry.lastMeasurement.device ?? null,
      taskId: null,
      templateId: null,
      proofPath: null,
      proofSha256: null,
      bindingStatus: 'legacy_unbound',
      routeBindingHash: null,
    });
  }
}

if (existsSync(RECEIPT_REGISTRY_PATH)) {
  const registry = readJson(RECEIPT_REGISTRY_PATH);
  for (const receipt of registry.receipts ?? []) {
    const contractTemplate = contractTemplateById.get(receipt.templateId);
    if (!contractTemplate || receipt.templateSchemaHash !== contractTemplate.schemaHash) continue;
    const requirement = requiredByKey.get(recipeKey(receipt));
    if (!requirement?.templates.includes(receipt.templateId)) continue;
    const proofPath = resolve(BACKEND_ROOT, String(receipt.proofPath ?? ''));
    if (!existsSync(proofPath)) {
      throw new Error(`Resource qualification proof is missing: ${String(receipt.proofPath)}`);
    }
    if (sha256File(proofPath) !== receipt.proofSha256) {
      throw new Error(`Resource qualification proof hash mismatch: ${String(receipt.proofPath)}`);
    }
    const baselinePath = resolve(BACKEND_ROOT, String(contractTemplate.lastSuccessfulRealRun?.provenancePath ?? ''));
    if (!existsSync(baselinePath)) {
      throw new Error(`Locked-template baseline proof is missing for ${receipt.templateId}.`);
    }
    const proof = readJson(proofPath);
    const validated = validateResourceQualificationEvidence({
      provenance: proof,
      baseline: readJson(baselinePath),
      contractTemplate,
    });
    if (
      recipeKey(validated.recipe) !== recipeKey(receipt) ||
      validated.workloadHash !== receipt.workloadHash ||
      validated.baselineWorkloadHash !== receipt.baselineWorkloadHash ||
      validated.modelRevision !== receipt.modelRevision ||
      receipt.taskId !== proof.taskId ||
      receipt.capturedAt !== proof.capturedAt ||
      receipt.graphHash !== (proof.graphHash ?? proof.graph?.hash) ||
      receipt.runtimeFingerprint !== proof.runtimeFingerprint ||
      receipt.outputHash !== (proof.mediaHash ?? proof.output?.items?.[0]?.decodedSha256) ||
      receipt.executionDurationSeconds !== proof.execution?.elapsedSeconds ||
      receipt.peakMemoryBytes !== proof.execution?.peakMemoryBytes ||
      (receipt.recipe !== undefined && canonicalJson(receipt.recipe) !== canonicalJson(validated.recipe))
    ) {
      throw new Error(`Resource qualification receipt does not match its retained proof: ${receipt.templateId}.`);
    }
    if (receipt.recipeHash !== undefined && receipt.recipeHash !== resourceRecipeHash(validated.recipe)) {
      throw new Error(`Resource qualification receipt has a stale recipe hash: ${receipt.templateId}.`);
    }
    const expectedBindingStatus = validated.routeBinding ? 'exact_route_bound' : 'legacy_unbound';
    if (validated.routeBinding) {
      if (
        receipt.bindingStatus !== expectedBindingStatus ||
        receipt.routeBindingHash !== validated.routeBindingHash ||
        canonicalJson(receipt.routeBinding) !== canonicalJson(validated.routeBinding) ||
        receipt.modelSetHash !== validated.modelSetHash
      ) {
        throw new Error(`Resource qualification receipt has a stale route binding: ${receipt.templateId}.`);
      }
    } else if (
      (receipt.bindingStatus !== undefined && receipt.bindingStatus !== 'legacy_unbound') ||
      (receipt.routeBinding !== undefined && receipt.routeBinding !== null) ||
      (receipt.routeBindingHash !== undefined && receipt.routeBindingHash !== null)
    ) {
      throw new Error(`Legacy resource qualification receipt claims an exact route binding: ${receipt.templateId}.`);
    }
    const key = recipeKey(receipt);
    const capturedAt = Date.parse(receipt.capturedAt);
    const previous = evidenceByKey.get(key);
    if (previous?.source !== 'resource_run_receipt' || capturedAt > Date.parse(previous?.capturedAt ?? '')) {
      evidenceByKey.set(key, {
        source: 'resource_run_receipt',
        capturedAt: receipt.capturedAt,
        candidateId: receipt.resourceCandidateId,
        artifact: receipt.modelRevision.split('@')[0],
        artifactRevision: receipt.modelRevision,
        hardwareFingerprint: receipt.runtimeFingerprint,
        executionDurationSeconds: receipt.executionDurationSeconds,
        peakMemoryBytes: receipt.peakMemoryBytes,
        peakReservedBytes: receipt.peakReservedBytes ?? null,
        processRssBytes: receipt.processRssBytes ?? null,
        backend: receipt.backend ?? null,
        device: receipt.device ?? null,
        taskId: receipt.taskId,
        templateId: receipt.templateId,
        proofPath: receipt.proofPath,
        proofSha256: receipt.proofSha256,
        bindingStatus: expectedBindingStatus,
        routeBindingHash: validated.routeBindingHash,
        modelSetHash: validated.modelSetHash,
      });
    }
  }
}

// Exact route qualification is deliberately independent of standard-template
// family coverage. A family receipt may retain an exact binding for audit, but
// it cannot enter this lane. Only two retained current-V2 route proofs do.
if (existsSync(ROUTE_RECEIPT_REGISTRY_PATH)) {
  const registry = readJson(ROUTE_RECEIPT_REGISTRY_PATH);
  if (
    registry?.schemaVersion !== 1 ||
    registry?.format !== 'modiff.route-resource-workload-receipt-registry.v1' ||
    typeof registry?.generatedAt !== 'string' ||
    !registry.generatedAt ||
    !Array.isArray(registry?.receipts) ||
    Object.keys(registry).sort().join('|') !== ['format', 'generatedAt', 'receipts', 'schemaVersion'].sort().join('|')
  ) {
    throw new Error('Route resource workload receipt registry is malformed.');
  }
  const currentRouteManifest = loadCurrentResourceRouteManifest({ backendRoot: BACKEND_ROOT });
  const invalidReceipts = [];
  const checkedReceipts = registry.receipts.flatMap((receipt, index) => {
    try {
      const proofs = retainedRouteResourceProofs({ receipt, backendRoot: BACKEND_ROOT });
      const currentRoute = exactCurrentResourceRouteFromManifest(receipt.routeBinding, currentRouteManifest);
      return [{ receipt, validated: validateRouteResourceWorkloadReceipt({ receipt, proofs, currentRoute }) }];
    } catch (error) {
      invalidReceipts.push(`Receipt ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });
  // Diagnose every rejected receipt, but never publish a partial report that
  // silently drops stale or corrupt evidence from the qualification gate.
  if (invalidReceipts.length) {
    throw new Error(
      `Route resource workload registry has ${invalidReceipts.length} invalid receipt(s):\n${invalidReceipts.join('\n')}`,
    );
  }
  for (const { receipt, validated } of checkedReceipts) {
    const routeKey = `${validated.routeBindingHash}|${validated.recipeHash}`;
    if (routeQualificationsByKey.has(routeKey)) {
      throw new Error('Route resource workload receipt registry contains a duplicate exact route recipe.');
    }
    const evidenceProofs = receipt.proofs.map((proofReceipt) => ({ ...proofReceipt }));
    routeQualificationsByKey.set(routeKey, {
      routeBinding: validated.routeBinding,
      routeBindingHash: validated.routeBindingHash,
      workloadHash: validated.workloadHash,
      modelSetHash: validated.modelSetHash,
      recipe: { ...validated.recipe, recipeHash: validated.recipeHash },
      runtimeContract: validated.runtimeContract,
      evidence: {
        bindingStatus: 'exact_route_bound_two_proof',
        evidenceSource: 'route_resource_two_live_proofs',
        proofCount: 2,
        taskIds: evidenceProofs.map((proof) => proof.taskId),
        lastSuccessAt: evidenceProofs
          .map((proof) => proof.capturedAt)
          .sort()
          .at(-1),
        proofs: evidenceProofs,
      },
    });
  }
}

const rawRecipes = [...requiredByKey.values()]
  .map((requirement) => {
    const evidence = evidenceByKey.get(recipeKey(requirement));
    return {
      ...requirement,
      templates: [...new Set(requirement.templates)].sort(),
      status: evidence ? 'qualified' : 'missing',
      evidence: evidence
        ? {
            evidenceSource: evidence.source,
            candidateId: evidence.candidateId,
            artifact: evidence.artifact,
            artifactRevision: evidence.artifactRevision,
            hardwareFingerprint: evidence.hardwareFingerprint,
            lastSuccessAt: evidence.capturedAt,
            executionDurationSeconds: evidence.executionDurationSeconds,
            peakMemoryBytes: evidence.peakMemoryBytes,
            peakReservedBytes: evidence.peakReservedBytes,
            processRssBytes: evidence.processRssBytes,
            backend: evidence.backend,
            device: evidence.device,
            taskId: evidence.taskId,
            templateId: evidence.templateId,
            proofPath: evidence.proofPath,
            proofSha256: evidence.proofSha256,
            bindingStatus: evidence.bindingStatus,
            routeBindingHash: evidence.routeBindingHash,
            modelSetHash: evidence.modelSetHash ?? null,
          }
        : null,
    };
  })
  .sort((left, right) => recipeKey(left).localeCompare(recipeKey(right)));
const { recipes, coverage: coverageByReleaseLane } = classifyResourceRecipeReleaseLanes(
  rawRecipes,
  releaseEligibleTemplateIds,
);
const qualified = recipes.filter((recipe) => recipe.status === 'qualified').length;
const latestSuccessAt = Math.max(
  0,
  ...recipes.map((recipe) => Date.parse(recipe.evidence?.lastSuccessAt ?? '') || 0),
  ...[...routeQualificationsByKey.values()].map(
    (qualification) => Date.parse(qualification.evidence.lastSuccessAt) || 0,
  ),
);
const body = {
  schemaVersion: 1,
  format: 'modiff.resource-recipe-coverage.v1',
  generatedAt: latestSuccessAt ? new Date(latestSuccessAt).toISOString() : contract.generatedAt,
  releaseContractHash: contract.contractHash,
  status: qualified === recipes.length ? 'complete' : 'incomplete',
  coverage: {
    required: recipes.length,
    qualified,
    missing: recipes.length - qualified,
    byReleaseLane: coverageByReleaseLane,
  },
  recipes,
  routeQualifications: [...routeQualificationsByKey.values()].sort((left, right) => {
    const leftKey = `${left.routeBindingHash}|${left.recipe.recipeHash}`;
    const rightKey = `${right.routeBindingHash}|${right.recipe.recipeHash}`;
    return leftKey.localeCompare(rightKey);
  }),
};
const report = { ...body, reportHash: reportHash(body) };
const serialized = canonicalJson(report);

if (CHECK) {
  if (!existsSync(OUTPUT_PATH)) throw new Error(`Resource qualification report is missing: ${OUTPUT_PATH}`);
  if (readFileSync(OUTPUT_PATH, 'utf8') !== serialized) {
    throw new Error('Resource qualification report is stale. Run npm run release:resources:generate.');
  }
  console.log(`Resource qualification report verified: ${qualified}/${recipes.length}`);
} else {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Wrote ${OUTPUT_PATH}: ${qualified}/${recipes.length} qualified.`);
}
