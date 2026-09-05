import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateRunProvenance } from './live-proof-provenance.mjs';
import { normalizeResourceRouteBinding, resourceRouteBindingHash } from './resource-route-binding.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(SCRIPT_PATH);
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const CONTRACT_PATH = resolve(
  process.env.MODIFF_RELEASE_CONTRACT || join(BACKEND_ROOT, 'data', 'release-contract.v1.json'),
);
const REGISTRY_PATH = resolve(
  process.env.MODIFF_RESOURCE_RECEIPT_REGISTRY ||
    join(BACKEND_ROOT, 'data', 'qualification', 'release', 'resource-run-receipts.v1.json'),
);
const PROVENANCE_DIR = resolve(
  process.env.MODIFF_RESOURCE_PROVENANCE_DIR ||
    join(BACKEND_ROOT, 'data', 'qualification', 'release', 'resource-provenance'),
);

const ALL_RESOURCE_PARAMS = new Set(['DiffusersExecutionRecipe', 'PipelineQuantizationConfigV2']);
const RESOURCE_PARAM_NAMES = new Set([
  'auto_offload',
  'backend',
  'component_overrides',
  'components',
  'device',
  'device_map',
  'device_map_overrides',
  'dtype',
  'excluded_modules',
  'execution_recipe',
  'low_cpu_mem_usage',
  'max_memory',
  'offload_mode',
  'quant_config',
  'quantization_config',
  'quantization_mode',
  'quantized_components',
]);

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
  return JSON.stringify(stable(value));
}

function sha256Value(prefix, value) {
  return `sha256:${prefix}:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function required(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  return path;
}

function exactRevision(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^.+@[0-9a-f]{40,64}$/i.test(text) ? text : null;
}

export function exactRouteModelSetWasExecuted(provenance, routeBinding) {
  const items = Array.isArray(provenance?.models?.items) ? provenance.models.items : [];
  if (items.length > 0) {
    const required = [routeBinding.artifact, ...routeBinding.modelDependencies].map((artifact) => ({
      repository: artifact.repository.toLowerCase(),
      revision: artifact.revision,
    }));
    const executed = items.map((item) => ({
      repository: String(item?.repoId ?? '').toLowerCase(),
      revision: item?.selectedRevision,
      validModelRevision: item?.modelRevision === `${item?.repoId}@${item?.selectedRevision}`,
    }));
    return (
      required.length === executed.length &&
      executed.every(({ validModelRevision }) => validModelRevision) &&
      required.every(({ repository, revision }) =>
        executed.some((item) => item.repository === repository && item.revision === revision),
      )
    );
  }
  const { repository, revision } = routeBinding.artifact;
  return (
    routeBinding.modelDependencies.length === 0 &&
    exactRevision(provenance?.modelRevision ?? provenance?.model?.modelRevision) === `${repository}@${revision}`
  );
}

function normalizedNode(node) {
  const params = ALL_RESOURCE_PARAMS.has(node?.action)
    ? {}
    : Object.fromEntries(Object.entries(node?.params ?? {}).filter(([name]) => !RESOURCE_PARAM_NAMES.has(name)));
  return {
    ...node,
    params,
  };
}

export function normalizedResourceWorkload(provenance) {
  const canonicalGraph = provenance?.graph?.canonicalGraph ?? {};
  const deterministicMode =
    canonicalGraph.deterministicMode && typeof canonicalGraph.deterministicMode === 'object'
      ? Object.fromEntries(
          Object.entries(canonicalGraph.deterministicMode).filter(([name]) => name !== 'promptSettingsHash'),
        )
      : (canonicalGraph.deterministicMode ?? null);
  return stable({
    templateId: provenance?.template?.id ?? null,
    catalogTemplateLockHash: provenance?.template?.catalogTemplateLockHash ?? null,
    promptSettingsHash: provenance?.template?.promptSettingsHash ?? null,
    lockedSettings: provenance?.template?.lockedSettings ?? null,
    modelRevision: provenance?.modelRevision ?? provenance?.model?.modelRevision ?? null,
    inputArtifactsHash: provenance?.inputArtifactsHash ?? provenance?.inputs?.hash ?? null,
    expectedOutput: provenance?.template?.expectedOutput ?? null,
    graph: {
      schemaVersion: canonicalGraph.schemaVersion ?? null,
      // This embedded hash includes resource-form fields in older graphs. The
      // current catalog prompt/settings identity is locked separately above;
      // seed, strictness, template id, and template lock remain part of this
      // workload signature.
      deterministicMode,
      nodes: (canonicalGraph.nodes ?? []).map(normalizedNode),
      paths: canonicalGraph.paths ?? [],
    },
  });
}

export function resourceWorkloadHash(provenance) {
  return sha256Value('resource-workload-v1', normalizedResourceWorkload(provenance));
}

export function resourceRecipeFromProvenance(provenance) {
  const plan = provenance?.graph?.executionPlan ?? {};
  return {
    modelType: plan.modelType ?? null,
    dtype: plan.dtype ?? null,
    offloadMode: plan.offloadMode ?? 'none',
    quantizationMode: plan.quantizationMode ?? 'none',
    quantizedComponents: [...(plan.quantizedComponents ?? [])].map(String).sort(),
    autoOffload: plan.autoOffload === true,
    device: plan.device ?? null,
    deviceMap: plan.deviceMap ?? null,
    pipelineClass: plan.pipelineClass ?? null,
    executionPath: plan.executionPath ?? null,
    attentionBackend: plan.attentionBackend ?? 'auto',
    regionalCompile: plan.regionalCompile === true,
    denoiserCache: plan.denoiserCache ?? 'none',
    channelsLast: plan.channelsLast === true,
    layerwiseCasting: plan.layerwiseCasting === true,
  };
}

export function resourceRecipeHash(recipe) {
  return sha256Value('resource-recipe-v2', recipe);
}

function sameDeclaredRecipe(left, right) {
  return (
    left?.modelType === right?.modelType &&
    left?.dtype === right?.dtype &&
    left?.offloadMode === right?.offloadMode &&
    left?.quantizationMode === right?.quantizationMode
  );
}

function assertNonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Resource qualification is missing ${label}.`);
}

export function validateResourceQualificationEvidence({ provenance, baseline, contractTemplate }) {
  if (Number(provenance?.schemaVersion) < 2 || provenance?.format !== 'modiff.live-proof.provenance.v2') {
    throw new Error('Resource qualification requires a v2 live-proof provenance record.');
  }
  const proofBlockers = [...new Set([...(provenance?.blockers ?? []), ...validateRunProvenance(provenance)])];
  if (proofBlockers.length > 0) {
    throw new Error(`Resource proof contains blocker(s): ${proofBlockers.join(' ')}`);
  }
  if (provenance?.template?.id !== contractTemplate?.id || baseline?.template?.id !== contractTemplate?.id) {
    throw new Error('Resource proof and locked-template baseline must identify the current contract template.');
  }
  if (
    provenance?.template?.catalogTemplateLockHash !== baseline?.template?.catalogTemplateLockHash ||
    provenance?.template?.promptSettingsHash !== baseline?.template?.promptSettingsHash
  ) {
    throw new Error('Resource proof does not match the current locked template prompt/settings identity.');
  }
  const baselineModelRevision = String(baseline?.modelRevision ?? baseline?.model?.modelRevision ?? '').trim();
  const modelRevision = String(provenance?.modelRevision ?? provenance?.model?.modelRevision ?? '').trim();
  if (!modelRevision || modelRevision !== baselineModelRevision) {
    throw new Error('Resource proof does not use the locked template model revision.');
  }
  const baselineModelSetHash = baseline?.models?.hash ?? null;
  const modelSetHash = provenance?.models?.hash ?? null;
  if ((modelSetHash || baselineModelSetHash) && (!modelSetHash || modelSetHash !== baselineModelSetHash)) {
    throw new Error('Resource proof does not use the locked template model set.');
  }
  const hasRouteBinding = provenance?.routeBinding !== undefined && provenance?.routeBinding !== null;
  const hasRouteBindingHash = provenance?.routeBindingHash !== undefined && provenance?.routeBindingHash !== null;
  if (hasRouteBinding !== hasRouteBindingHash) {
    throw new Error('Resource proof routeBinding and routeBindingHash must both be present.');
  }
  const routeBinding = hasRouteBinding ? normalizeResourceRouteBinding(provenance.routeBinding) : null;
  const routeBindingHash = routeBinding ? resourceRouteBindingHash(routeBinding) : null;
  if (routeBinding && routeBindingHash !== provenance.routeBindingHash) {
    throw new Error('Resource proof routeBindingHash does not match its exact registered route binding.');
  }
  if (routeBinding && !exactRouteModelSetWasExecuted(provenance, routeBinding)) {
    throw new Error(
      'Resource proof route binding artifacts and dependencies do not match the complete executed immutable model set.',
    );
  }
  if (
    routeBinding &&
    (!modelSetHash || !Array.isArray(provenance?.models?.items) || provenance.models.items.length < 1)
  ) {
    throw new Error('Exact route resource proof must retain the complete executed model set identity.');
  }
  const baselineWorkloadHash = resourceWorkloadHash(baseline);
  const workloadHash = resourceWorkloadHash(provenance);
  if (workloadHash !== baselineWorkloadHash) {
    throw new Error('Resource proof changed the locked workload, inputs, topology, prompt, or generation parameters.');
  }

  const recipe = resourceRecipeFromProvenance(provenance);
  const declared = (contractTemplate?.resourceRecipes?.declaredRecipes ?? []).some((candidate) =>
    sameDeclaredRecipe({ modelType: contractTemplate.modelType, ...candidate }, recipe),
  );
  if (!declared) {
    throw new Error(
      `Resource proof recipe is not declared for ${contractTemplate.id}: ${Object.values(recipe).join('|')}.`,
    );
  }
  if (recipe.offloadMode !== 'none' && provenance?.graph?.executionPlan?.autoOffload !== true) {
    throw new Error('An offloaded resource proof must record autoOffload=true in its execution plan.');
  }

  for (const [value, label] of [
    [provenance?.taskId, 'taskId'],
    [provenance?.capturedAt, 'capturedAt'],
    [provenance?.graphHash ?? provenance?.graph?.hash, 'graphHash'],
    [provenance?.runtimeFingerprint, 'runtimeFingerprint'],
    [provenance?.mediaHash ?? provenance?.output?.items?.[0]?.decodedSha256, 'outputHash'],
  ]) {
    assertNonEmpty(value, label);
  }
  if (!Number.isFinite(provenance?.execution?.elapsedSeconds) || provenance.execution.elapsedSeconds < 0) {
    throw new Error('Resource qualification is missing executionDurationSeconds.');
  }
  if (!Number.isInteger(provenance?.execution?.peakMemoryBytes) || provenance.execution.peakMemoryBytes <= 0) {
    throw new Error('Resource qualification is missing peakMemoryBytes.');
  }
  if ((provenance?.output?.items?.length ?? 0) === 0) {
    throw new Error('Resource qualification output receipt is empty.');
  }

  return {
    recipe,
    modelRevision,
    modelSetHash,
    workloadHash,
    baselineWorkloadHash,
    routeBinding,
    routeBindingHash,
  };
}

function receiptKey(receipt) {
  return [
    receipt.routeBindingHash ?? 'legacy_unbound',
    receipt.recipeHash ??
      resourceRecipeHash({
        modelType: receipt.modelType,
        dtype: receipt.dtype,
        offloadMode: receipt.offloadMode,
        quantizationMode: receipt.quantizationMode,
      }),
    receipt.templateId,
    receipt.runtimeFingerprint,
    receipt.graphHash,
    receipt.outputHash,
  ].join('|');
}

export async function recordResourceQualification({
  provenancePath,
  contractPath = CONTRACT_PATH,
  registryPath = REGISTRY_PATH,
  provenanceDir = PROVENANCE_DIR,
} = {}) {
  const sourcePath = required(resolve(provenancePath), 'Resource run provenance');
  const contract = readJson(required(contractPath, 'Release contract'));
  const provenance = readJson(sourcePath);
  const templateId = provenance?.template?.id;
  const contractTemplate = contract.templates?.find((template) => template.id === templateId);
  if (!contractTemplate) throw new Error(`Template ${String(templateId)} is not in the release contract.`);
  const baselinePath = required(
    resolve(BACKEND_ROOT, contractTemplate.lastSuccessfulRealRun?.provenancePath ?? ''),
    'Locked-template baseline provenance',
  );
  const baseline = readJson(baselinePath);
  const validated = validateResourceQualificationEvidence({ provenance, baseline, contractTemplate });

  mkdirSync(provenanceDir, { recursive: true });
  const digest = sha256File(sourcePath);
  const retainedName = `${templateId}.${digest.slice('sha256:'.length, 'sha256:'.length + 16)}.json`;
  const retainedPath = join(provenanceDir, retainedName);
  copyFileSync(sourcePath, retainedPath);
  const proofPath = relative(BACKEND_ROOT, retainedPath).replaceAll('\\', '/');
  const outputHash = provenance.mediaHash ?? provenance.output.items[0].decodedSha256;
  const recipeHash = resourceRecipeHash(validated.recipe);
  const resourceCandidateId =
    provenance.execution?.resourceCandidateId ??
    `manual:${[
      validated.recipe.modelType,
      validated.recipe.dtype,
      validated.recipe.offloadMode,
      validated.recipe.quantizationMode,
    ].join('|')}`;
  const receipt = {
    schemaVersion: 1,
    format: 'modiff.resource-run-receipt.v1',
    proofKind: 'real_backend_weights_full_locked_workload',
    templateId,
    templateSchemaHash: contractTemplate.schemaHash,
    taskId: provenance.taskId,
    capturedAt: provenance.capturedAt,
    ...validated.recipe,
    recipe: validated.recipe,
    recipeHash,
    bindingStatus: validated.routeBinding ? 'exact_route_bound' : 'legacy_unbound',
    routeBinding: validated.routeBinding,
    routeBindingHash: validated.routeBindingHash,
    modelRevision: validated.modelRevision,
    modelSetHash: validated.modelSetHash,
    resourceCandidateId,
    graphHash: provenance.graphHash ?? provenance.graph.hash,
    workloadHash: validated.workloadHash,
    baselineWorkloadHash: validated.baselineWorkloadHash,
    runtimeFingerprint: provenance.runtimeFingerprint,
    outputHash,
    executionDurationSeconds: provenance.execution.elapsedSeconds,
    peakMemoryBytes: provenance.execution.peakMemoryBytes,
    peakReservedBytes: provenance.execution?.measurement?.peakReservedBytes ?? null,
    processRssBytes: provenance.execution?.measurement?.processRssBytes ?? null,
    backend: provenance.execution?.measurement?.backend ?? null,
    device: provenance.execution?.measurement?.device ?? null,
    proofPath,
    proofSha256: sha256File(retainedPath),
    sourceArtifact: relative(CLIENT_ROOT, sourcePath).replaceAll('\\', '/'),
  };

  const previous = existsSync(registryPath)
    ? readJson(registryPath)
    : {
        schemaVersion: 1,
        format: 'modiff.resource-run-receipt-registry.v1',
        receipts: [],
      };
  const receipts = [
    ...(previous.receipts ?? []).filter((candidate) => receiptKey(candidate) !== receiptKey(receipt)),
    receipt,
  ].sort((left, right) => receiptKey(left).localeCompare(receiptKey(right)));
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(
    registryPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        format: 'modiff.resource-run-receipt-registry.v1',
        generatedAt: receipt.capturedAt,
        receipts,
      },
      null,
      2,
    )}\n`,
  );
  return receipt;
}

async function main() {
  const provenancePath = process.env.MODIFF_RESOURCE_PROVENANCE;
  if (!provenancePath) {
    throw new Error('Set MODIFF_RESOURCE_PROVENANCE to a completed v2 gallery-run provenance file.');
  }
  const receipt = await recordResourceQualification({ provenancePath });
  console.log(
    `Recorded full-workload resource qualification for ${receipt.templateId}: ${receipt.modelType} ${receipt.dtype} ${receipt.offloadMode} ${receipt.quantizationMode}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
