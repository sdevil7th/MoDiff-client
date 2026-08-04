import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyResourceRecipeReleaseLanes } from './release-qualification-policy.mjs';
import { validateResourceQualificationEvidence } from './resource-qualification.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const CONTRACT_PATH = join(BACKEND_ROOT, 'data', 'release-contract.v1.json');
const HISTORY_PATH = join(BACKEND_ROOT, 'data', 'auto_resource', 'history.json');
const RECEIPT_REGISTRY_PATH = join(BACKEND_ROOT, 'data', 'qualification', 'release', 'resource-run-receipts.v1.json');
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
const history = readJson(HISTORY_PATH);
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
    const validated = validateResourceQualificationEvidence({
      provenance: readJson(proofPath),
      baseline: readJson(baselinePath),
      contractTemplate,
    });
    if (
      recipeKey(validated.recipe) !== recipeKey(receipt) ||
      validated.workloadHash !== receipt.workloadHash ||
      validated.modelRevision !== receipt.modelRevision
    ) {
      throw new Error(`Resource qualification receipt does not match its retained proof: ${receipt.templateId}.`);
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
      });
    }
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
const latestSuccessAt = Math.max(0, ...recipes.map((recipe) => Date.parse(recipe.evidence?.lastSuccessAt ?? '') || 0));
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
  writeFileSync(OUTPUT_PATH, serialized);
  console.log(`Wrote ${OUTPUT_PATH}: ${qualified}/${recipes.length} qualified.`);
}
