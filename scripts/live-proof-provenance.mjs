import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { normalizeResourceRouteBinding, resourceRouteBindingHash } from './resource-route-binding.mjs';
import { createAppliedAdapterProof, validateAppliedAdapterProof } from './applied-adapter-provenance.mjs';
export { validateAppliedAdapterProof } from './applied-adapter-provenance.mjs';

export const LIVE_PROOF_PROVENANCE_SCHEMA_VERSION = 2;
export const LIVE_PROOF_PROVENANCE_FORMAT = 'modiff.live-proof.provenance.v2';
export const CANONICAL_GRAPH_SCHEMA_VERSION = 1;

const RUNTIME_TORCH_FIELDS = [
  'cuda_available',
  'cuda_device_count',
  'cuda_device_name',
  'cudnn_version',
  'cudnn_deterministic',
  'cudnn_benchmark',
  'deterministic_algorithms',
  'cuda_device_total_memory_bytes',
  'cuda_memory_total_bytes',
  'cuda_device_capability',
];

const EXECUTION_PLAN_FIELDS = [
  'source',
  'device',
  'cudaIndex',
  'modelType',
  'modelRepo',
  'resolvedModelRepo',
  'resolvedArtifact',
  'modelDependencies',
  'executionPath',
  'pipelineClass',
  'dtype',
  'resourceMode',
  'resolvedResourceMode',
  'quantizationMode',
  'quantizedComponents',
  'autoOffload',
  'offloadMode',
  'deviceMap',
  'attentionBackend',
  'regionalCompile',
  'denoiserCache',
  'channelsLast',
  'layerwiseCasting',
  'autoResourceCandidateId',
  'resourceRetryAttempt',
];

const CONTRACT_PARAM_FIELDS = [
  'type',
  'display',
  'default',
  'min',
  'max',
  'step',
  'options',
  'fieldOptions',
  'dataSource',
  'cache',
];

function orderedValue(value) {
  if (Array.isArray(value)) return value.map(orderedValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, orderedValue(entryValue)]),
  );
}

export function stableStringify(value) {
  return JSON.stringify(orderedValue(value));
}

export function sha256Value(prefix, value) {
  const digest = createHash('sha256').update(stableStringify(value)).digest('hex');
  return `sha256:${prefix}:${digest}`;
}

function outputCollectionItemIdentity(item) {
  return {
    index: item.index,
    mediaType: item.mediaType,
    width: item.width,
    height: item.height,
    frames: item.frames,
    durationSeconds: item.durationSeconds,
    sampleRate: item.sampleRate,
    channels: item.channels,
    decodedSha256: item.decodedSha256,
    ...(item.decodedAudioSha256 ? { decodedAudioSha256: item.decodedAudioSha256 } : {}),
    ...(item.audiovisualSha256 ? { audiovisualSha256: item.audiovisualSha256 } : {}),
  };
}

export function liveProofLockHash(provenance) {
  const proofLock = {
    format: provenance?.format,
    templateRevisionHash: provenance?.template?.revisionHash,
    resolvedTemplateLockHash: provenance?.template?.resolvedTemplateLockHash,
    graphHash: provenance?.graph?.hash,
    executionPlanHash: provenance?.graph?.executionPlanHash,
    modelRevision: provenance?.model?.modelRevision,
    modelFingerprint: provenance?.model?.fingerprint,
    modelSetHash: provenance?.models?.hash,
    inputArtifactsHash: provenance?.inputArtifactsHash,
    runtimeFingerprint: provenance?.runtime?.lockFingerprint,
    backendSourceFingerprint: provenance?.runtime?.backendSource?.fingerprint,
    backendContractFingerprint: provenance?.runtime?.backendContract?.fingerprint,
    deterministicFingerprint: provenance?.runtime?.deterministic?.fingerprint,
    outputCollectionHash: provenance?.output?.collectionHash,
    ...(provenance?.routeBindingHash ? { routeBindingHash: provenance.routeBindingHash } : {}),
    ...(provenance?.adapterApplicationsHash !== undefined
      ? { adapterApplicationsHash: provenance.adapterApplicationsHash }
      : {}),
  };
  return sha256Value('live-proof-lock-v1', proofLock);
}

export function repairDuplicateOutputItems(provenance, executedOutput) {
  const backendItems = executedOutput?.backendProvenance?.mediaItems ?? executedOutput?.mediaItems ?? [];
  const uniqueItems = [];
  const seenEncodedHashes = new Set();
  for (const item of provenance?.output?.items ?? []) {
    if (!item?.encodedSha256 || seenEncodedHashes.has(item.encodedSha256)) continue;
    seenEncodedHashes.add(item.encodedSha256);
    uniqueItems.push(item);
  }
  if (uniqueItems.length !== backendItems.length) {
    throw new Error(
      `Cannot repair output collection: ${uniqueItems.length} unique captured item(s) do not match ${backendItems.length} backend item(s).`,
    );
  }
  const items = uniqueItems.map((item, index) => ({
    ...item,
    index,
    backendMediaHash: backendItems[index]?.mediaHash ?? null,
  }));
  const collectionPayload = items.map(outputCollectionItemIdentity);
  const output = {
    ...provenance.output,
    count: items.length,
    collectionHash: sha256Value('decoded-output-collection-v1', collectionPayload),
    backendCollectionHash: executedOutput?.mediaCollectionHash ?? null,
    items,
  };
  const repaired = {
    ...provenance,
    output,
  };
  return { ...repaired, proofLockHash: liveProofLockHash(repaired) };
}

function nodeEntries(apiGraph) {
  if (Array.isArray(apiGraph?.nodes)) {
    return apiGraph.nodes.map((node) => [String(node?.id ?? ''), node]);
  }
  return Object.entries(apiGraph?.nodes ?? {});
}

function graphNodeOrder(apiGraph, entries) {
  const available = new Set(entries.map(([id]) => id));
  const ordered = [];
  for (const nodeId of (apiGraph?.paths ?? []).flat()) {
    const normalized = String(nodeId);
    if (available.has(normalized) && !ordered.includes(normalized)) ordered.push(normalized);
  }

  const remaining = entries
    .filter(([id]) => !ordered.includes(id))
    .sort(([, left], [, right]) => {
      const leftKey = `${left?.module ?? ''}.${left?.action ?? ''}:${stableStringify(left?.params ?? {})}`;
      const rightKey = `${right?.module ?? ''}.${right?.action ?? ''}:${stableStringify(right?.params ?? {})}`;
      return leftKey.localeCompare(rightKey);
    })
    .map(([id]) => id);
  return [...ordered, ...remaining];
}

function canonicalGraphValue(value, idMap) {
  if (Array.isArray(value)) return value.map((item) => canonicalGraphValue(item, idMap));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => {
        if ((key === 'sourceId' || key === 'targetId') && typeof entryValue === 'string') {
          return [key, idMap.get(entryValue) ?? entryValue];
        }
        return [key, canonicalGraphValue(entryValue, idMap)];
      }),
  );
}

function canonicalGraphParams(params, idMap) {
  return Object.fromEntries(
    Object.entries(params ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, rawParam]) => {
        if (
          rawParam &&
          typeof rawParam === 'object' &&
          !Array.isArray(rawParam) &&
          typeof rawParam.display === 'string' &&
          rawParam.display.startsWith('ui_')
        ) {
          const stableParam = { ...rawParam };
          delete stableParam.value;
          return [key, canonicalGraphValue(stableParam, idMap)];
        }
        return [key, canonicalGraphValue(rawParam, idMap)];
      }),
  );
}

export function canonicalizeApiGraph(apiGraph) {
  const entries = nodeEntries(apiGraph);
  const byId = new Map(entries);
  const orderedIds = graphNodeOrder(apiGraph, entries);
  const actionCounts = new Map();
  const idMap = new Map();

  for (const nodeId of orderedIds) {
    const node = byId.get(nodeId) ?? {};
    const actionKey = `${node.module ?? 'unknown'}.${node.action ?? 'unknown'}`;
    const ordinal = (actionCounts.get(actionKey) ?? 0) + 1;
    actionCounts.set(actionKey, ordinal);
    idMap.set(nodeId, `${actionKey}#${ordinal}`);
  }

  const nodes = orderedIds.map((nodeId) => {
    const node = byId.get(nodeId) ?? {};
    return {
      key: idMap.get(nodeId),
      module: node.module ?? null,
      action: node.action ?? null,
      params: canonicalGraphParams(node.params ?? {}, idMap),
    };
  });
  const paths = (apiGraph?.paths ?? []).map((nodePath) =>
    nodePath.map((nodeId) => idMap.get(String(nodeId)) ?? String(nodeId)),
  );

  return orderedValue({
    schemaVersion: CANONICAL_GRAPH_SCHEMA_VERSION,
    nodes,
    paths,
    deterministicMode: apiGraph?.deterministicMode ?? null,
  });
}

export function canonicalGraphIdentity(apiGraph) {
  const canonicalGraph = canonicalizeApiGraph(apiGraph);
  return {
    schemaVersion: CANONICAL_GRAPH_SCHEMA_VERSION,
    hash: sha256Value('canonical-graph-v1', canonicalGraph),
    canonicalGraph,
  };
}

function apiParamValue(node, key) {
  const param = node?.params?.[key];
  if (!param || typeof param !== 'object' || Array.isArray(param)) return undefined;
  return Object.hasOwn(param, 'value') ? param.value : undefined;
}

function hubRepository(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.source === 'hub' &&
    typeof value.value === 'string' &&
    value.value.trim()
  ) {
    return value.value.trim();
  }
  return null;
}

function connectedParamSource(node, key) {
  const param = node?.params?.[key];
  if (
    !param ||
    typeof param !== 'object' ||
    Array.isArray(param) ||
    typeof param.sourceId !== 'string' ||
    !param.sourceId ||
    typeof param.sourceKey !== 'string' ||
    !param.sourceKey
  ) {
    return null;
  }
  return { nodeId: param.sourceId, field: param.sourceKey };
}

/**
 * Recover the minimal manual resource identity for a retained Expert Studio
 * execution whose old submission omitted Studio runtime hints. This is not a
 * generic form fallback: every claimed resource value must agree across the
 * durable Studio snapshot and the concrete loader/recipe/quantization nodes on
 * an executed API path. Any ambiguity or mismatch returns null.
 */
export function executedExpertPlanFromGraph(apiGraph) {
  const runtimeHints = apiGraph?.runtimeHints;
  const snapshot = runtimeHints?.workflowSnapshot;
  const form = snapshot?.studioForm;
  const binding = snapshot?.studioGraphBinding;
  if (
    !form ||
    typeof form !== 'object' ||
    Array.isArray(form) ||
    !binding ||
    typeof binding !== 'object' ||
    Array.isArray(binding) ||
    form.resourceMode !== 'expert' ||
    typeof form.modelType !== 'string' ||
    !form.modelType ||
    binding.modelType !== form.modelType ||
    typeof form.dtype !== 'string' ||
    typeof form.quantizationMode !== 'string' ||
    typeof form.offloadMode !== 'string' ||
    typeof form.autoOffload !== 'boolean' ||
    typeof form.device !== 'string'
  ) {
    return null;
  }

  const entries = nodeEntries(apiGraph);
  const byId = new Map(entries);
  const executedIds = new Set((apiGraph?.paths ?? []).flat().map(String));
  const executedLoaders = entries.filter(([id, node]) => {
    if (!executedIds.has(id)) return false;
    const repo = hubRepository(apiParamValue(node, 'model_id') ?? apiParamValue(node, 'repo_id'));
    return (
      repo &&
      String(node?.action ?? '')
        .toLowerCase()
        .includes('load') &&
      typeof apiParamValue(node, 'dtype') === 'string' &&
      typeof apiParamValue(node, 'quantization_mode') === 'string' &&
      typeof apiParamValue(node, 'offload_mode') === 'string' &&
      typeof apiParamValue(node, 'auto_offload') === 'boolean' &&
      typeof apiParamValue(node, 'device') === 'string' &&
      connectedParamSource(node, 'execution_recipe')?.field === 'execution_recipe'
    );
  });
  if (executedLoaders.length !== 1) return null;
  const [, loader] = executedLoaders[0];
  const recipeSource = connectedParamSource(loader, 'execution_recipe');
  const recipe = recipeSource ? byId.get(recipeSource.nodeId) : null;
  if (
    !recipe ||
    !executedIds.has(recipeSource.nodeId) ||
    recipe.module !== 'modules.DiffusersRuntime' ||
    recipe.action !== 'DiffusersExecutionRecipe'
  ) {
    return null;
  }
  const quantSource = connectedParamSource(recipe, 'quantization_config');
  const quant = quantSource ? byId.get(quantSource.nodeId) : null;
  if (
    !quant ||
    quantSource.field !== 'quantization_config' ||
    !executedIds.has(quantSource.nodeId) ||
    quant.module !== 'modules.DiffusersRuntime' ||
    quant.action !== 'PipelineQuantizationConfigV2'
  ) {
    return null;
  }

  const dtype = apiParamValue(loader, 'dtype');
  const quantizationMode = apiParamValue(loader, 'quantization_mode');
  const offloadMode = apiParamValue(loader, 'offload_mode');
  const autoOffload = apiParamValue(loader, 'auto_offload');
  const device = apiParamValue(loader, 'device');
  const deviceMap = apiParamValue(loader, 'device_map');
  const quantizedComponents = apiParamValue(loader, 'quantized_components');
  if (
    dtype !== form.dtype ||
    dtype !== apiParamValue(quant, 'dtype') ||
    quantizationMode !== form.quantizationMode ||
    quantizationMode !== apiParamValue(quant, 'backend') ||
    offloadMode !== form.offloadMode ||
    offloadMode !== apiParamValue(recipe, 'offload_mode') ||
    autoOffload !== form.autoOffload ||
    device !== form.device ||
    device !== apiParamValue(recipe, 'device') ||
    deviceMap !== apiParamValue(recipe, 'device_map') ||
    !Array.isArray(quantizedComponents) ||
    (quantizationMode === 'none' && quantizedComponents.length !== 0)
  ) {
    return null;
  }
  if (
    quantizationMode !== 'none' &&
    stableStringify(quantizedComponents) !== stableStringify(apiParamValue(quant, 'components'))
  ) {
    return null;
  }

  const modelRepo = hubRepository(apiParamValue(loader, 'model_id') ?? apiParamValue(loader, 'repo_id'));
  const pipelineClass = apiParamValue(loader, 'pipeline_class');
  if (!modelRepo || typeof pipelineClass !== 'string' || !pipelineClass) return null;
  return orderedValue({
    source: 'executed-expert-diffusers-graph-v1',
    device,
    modelType: form.modelType,
    modelRepo,
    resolvedModelRepo: modelRepo,
    resolvedArtifact: modelRepo,
    pipelineClass,
    dtype,
    resourceMode: 'expert',
    resolvedResourceMode: 'expert',
    quantizationMode,
    quantizedComponents,
    autoOffload,
    offloadMode,
    deviceMap,
    attentionBackend: apiParamValue(recipe, 'attention_backend'),
    regionalCompile: apiParamValue(recipe, 'regional_compile'),
    denoiserCache: apiParamValue(recipe, 'denoiser_cache'),
    channelsLast: apiParamValue(recipe, 'channels_last'),
    layerwiseCasting: apiParamValue(recipe, 'layerwise_casting'),
  });
}

/**
 * Ordinary modular Run has no managed Studio plan. Recover only the reviewed
 * BF16/FP8r, CPU-loading Expert contract from its executed owner and durable
 * authoring context. This records a recipe, never runtime or fit qualification.
 */
function executedModularExpertPlanFromGraph(apiGraph) {
  const snapshot = apiGraph?.runtimeHints?.workflowSnapshot;
  const form = snapshot?.studioForm;
  if (
    form?.resourceMode !== 'expert' ||
    form.dtype !== 'bfloat16' ||
    form.weightFormat !== 'fp8r' ||
    form.quantizationMode !== 'none' ||
    form.trustRemoteCode !== false ||
    typeof form.autoOffload !== 'boolean' ||
    typeof form.offloadMode !== 'string' ||
    typeof form.device !== 'string' ||
    typeof form.modelType !== 'string' ||
    !Array.isArray(snapshot.nodes)
  )
    return null;

  const entries = nodeEntries(apiGraph);
  const byId = new Map(entries);
  const executedIds = new Set((apiGraph?.paths ?? []).flat().map(String));
  const owners = entries.filter(
    ([id, node]) =>
      executedIds.has(id) && node?.module === 'modules.ModularDiffusers' && node.action === 'ModelsLoader',
  );
  if (owners.length !== 1) return null;
  const [ownerId, owner] = owners[0];
  for (const field of [
    'repo_id',
    'revision',
    'model_type',
    'dtype',
    'weight_format',
    'device',
    'offload_mode',
    'auto_offload',
    'weight_loading_mode',
    'trust_remote_code',
  ]) {
    if (owner.params?.[field]?.sourceId != null || owner.params?.[field]?.sourceKey != null) return null;
  }
  const repo = apiParamValue(owner, 'repo_id');
  const revision = apiParamValue(owner, 'revision');
  if (
    !repo ||
    typeof repo !== 'object' ||
    Array.isArray(repo) ||
    repo.source !== 'hub' ||
    typeof repo.value !== 'string' ||
    !repo.value ||
    // Normal template forms retain model type and controls; the immutable
    // repository lives on the executed loader. A retained optional form
    // repository must agree, but its absence cannot erase that actual owner.
    (form.modelRepo !== undefined && repo.value !== form.modelRepo) ||
    typeof revision !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(revision) ||
    apiParamValue(owner, 'model_type') !== form.modelType ||
    apiParamValue(owner, 'dtype') !== form.dtype ||
    apiParamValue(owner, 'weight_format') !== form.weightFormat ||
    apiParamValue(owner, 'device') !== form.device ||
    apiParamValue(owner, 'offload_mode') !== form.offloadMode ||
    apiParamValue(owner, 'auto_offload') !== form.autoOffload ||
    apiParamValue(owner, 'weight_loading_mode') !== 'cpu' ||
    apiParamValue(owner, 'trust_remote_code') !== false
  )
    return null;
  // A borrowed component or a quantization node changes the loading contract.
  for (const field of [
    'quant_config',
    'unet',
    'vae',
    'controlnet',
    'text_encoders',
    'pipeline_components',
    'image_encoder',
  ]) {
    const param = owner.params?.[field];
    if (param?.sourceId != null || param?.sourceKey != null || apiParamValue(owner, field) != null) return null;
  }

  // Read active durable leaves only, not definition snapshots or projected UI
  // duplicates. Local Block roles use semantic IDs; external roles already use
  // exported IDs. This is the blockProjectionNodeIdV2 identity format, not a
  // reconstruction of graph execution or socket expansion.
  const leaves = [];
  const visit = (nodes, localIds = null) => {
    for (const node of nodes) {
      const data = node?.data;
      if (!data || data.blockProjectionOwnerId) continue;
      if (data.blockInstanceV2) {
        const instance = data.blockInstanceV2;
        const children = instance.effectiveGraph?.nodes;
        if (localIds || typeof instance.instanceId !== 'string' || !Array.isArray(children)) return false;
        const ids = new Map(
          children.map((child) => [
            child.nodeId,
            `block-v2-node:${instance.instanceId.length}:${instance.instanceId}:${child.nodeId?.length}:${child.nodeId}`,
          ]),
        );
        if (ids.size !== children.length || children.some((child) => typeof child.nodeId !== 'string')) return false;
        if (!visit(children, ids)) return false;
      } else {
        const context = data.operationAuthoring?.ancillaryParent;
        const roles = context?.parentRoleNodes;
        leaves.push({
          data,
          id: localIds?.get(node.nodeId) ?? node.id,
          roles:
            roles && Object.fromEntries(Object.entries(roles).map(([role, id]) => [role, localIds?.get(id) ?? id])),
        });
      }
    }
    return true;
  };
  if (!visit(snapshot.nodes)) return null;
  const contexts = leaves.filter(
    ({ data, id, roles }) =>
      data.module === 'modules.ModularDiffusers' &&
      data.action === 'EncodePrompt' &&
      roles?.models === ownerId &&
      roles.prompt === id,
  );
  if (contexts.length !== 1) return null;
  const hint = contexts[0].data.operationAuthoring;
  const context = hint.ancillaryParent;
  const parent = context.parent;
  const roles = contexts[0].roles;
  if (
    context.schemaVersion !== 1 ||
    parent?.pipelineClass !== form.modelType ||
    parent.task !== form.mode ||
    hint.operation?.pipelineClass !== form.modelType ||
    hint.operation.task !== form.mode ||
    typeof parent.executionProfileId !== 'string' ||
    !parent.executionProfileId ||
    typeof parent.authoringRecipeId !== 'string' ||
    !parent.authoringRecipeId ||
    typeof parent.baseSpecId !== 'string' ||
    !parent.baseSpecId.startsWith(`${parent.executionProfileId}:`) ||
    !/^studio-spec-v1-[0-9a-f]{8}$/u.test(parent.baseSpecContentHash ?? '') ||
    !/^studio-authoring-v1-[0-9a-f]{8}$/u.test(parent.authoringContentHash ?? '') ||
    new Set(Object.values(roles)).size !== Object.values(roles).length
  )
    return null;
  for (const [role, action] of [
    ['prompt', 'EncodePrompt'],
    ['denoise', 'Denoise'],
    ['decode', 'DecodeLatents'],
  ]) {
    const node = byId.get(roles[role]);
    if (!executedIds.has(roles[role]) || node?.module !== 'modules.ModularDiffusers' || node.action !== action)
      return null;
  }
  for (const [role, field, sourceRole, sourceField] of [
    ['prompt', 'text_encoders', 'models', 'text_encoders'],
    ['denoise', 'unet', 'models', 'unet_out'],
    ['denoise', 'scheduler', 'models', 'scheduler'],
    ['denoise', 'embeddings', 'prompt', 'embeddings'],
    ['decode', 'vae', 'models', 'vae_out'],
    ['decode', 'latents', 'denoise', 'latents'],
  ]) {
    const source = connectedParamSource(byId.get(roles[role]), field);
    if (source?.nodeId !== roles[sourceRole] || source.field !== sourceField) return null;
  }
  return orderedValue({
    source: 'executed-expert-modular-graph-v1',
    device: form.device,
    modelType: form.modelType,
    modelRepo: repo.value,
    resolvedModelRepo: repo.value,
    resolvedArtifact: repo.value,
    modelRevision: revision,
    pipelineClass: form.modelType,
    executionProfileId: parent.executionProfileId,
    authoringRecipeId: parent.authoringRecipeId,
    dtype: form.dtype,
    weightFormat: form.weightFormat,
    weightLoadingMode: 'cpu',
    resourceMode: 'expert',
    resolvedResourceMode: 'expert',
    quantizationMode: 'none',
    quantizedComponents: [],
    autoOffload: form.autoOffload,
    offloadMode: form.offloadMode,
  });
}

export function executionPlanIdentity(apiGraph) {
  const runtimeHints = apiGraph?.runtimeHints ?? {};
  const declaredPlan = Object.fromEntries(
    EXECUTION_PLAN_FIELDS.filter((field) => runtimeHints[field] !== undefined).map((field) => [
      field,
      runtimeHints[field],
    ]),
  );
  const fields = Object.keys(declaredPlan);
  const expertOnly = fields.every(
    (field) => ['resourceMode', 'resolvedResourceMode'].includes(field) && declaredPlan[field] === 'expert',
  );
  const modularPlan = expertOnly ? executedModularExpertPlanFromGraph(apiGraph) : null;
  const plan = modularPlan ?? (fields.length > 0 ? declaredPlan : (executedExpertPlanFromGraph(apiGraph) ?? {}));
  return {
    hash: sha256Value('execution-plan-v1', plan),
    plan: orderedValue(plan),
  };
}

export function executionReceiptIdentity(executionReceipt, executionPlan) {
  const measurement = executionReceipt?.runtimeMeasurement;
  const hints = executionReceipt?.runtimeHints;
  const peakMemoryBytes =
    measurement?.peakAllocatedBytes ??
    measurement?.peakReservedBytes ??
    measurement?.driverAllocatedBytes ??
    measurement?.processRssBytes ??
    null;
  const manualResourceCandidateId =
    executionPlan?.modelType && executionPlan?.dtype
      ? `manual-resource-v1:${[
          executionPlan.modelType,
          executionPlan.dtype,
          executionPlan.offloadMode ?? 'none',
          executionPlan.quantizationMode ?? 'none',
        ].join('|')}`
      : null;
  return {
    resourceCandidateId:
      hints?.autoResourceCandidateId ?? executionPlan?.autoResourceCandidateId ?? manualResourceCandidateId,
    elapsedSeconds:
      Number.isFinite(measurement?.elapsedSeconds) && measurement.elapsedSeconds >= 0
        ? measurement.elapsedSeconds
        : null,
    peakMemoryBytes: Number.isFinite(peakMemoryBytes) && peakMemoryBytes > 0 ? Math.trunc(peakMemoryBytes) : null,
    measurement: measurement && typeof measurement === 'object' ? orderedValue(measurement) : null,
  };
}

export function resolvedModelReposFromOutput(output) {
  const graph = output?.apiGraphSnapshot;
  const loaderRepos = nodeEntries(graph).flatMap(([, node]) => {
    const params = node?.params ?? {};
    const action = String(node?.action ?? '').toLowerCase();
    const modelParam =
      params.model_id ??
      params.repo_id ??
      (action.includes('adapter') ? params.adapter_path : undefined) ??
      (action === 'lora' ? params.model : undefined);
    if (!modelParam || (!action.includes('load') && action !== 'lora' && action !== 'upscaler')) return [];
    const loaderValue = modelParam?.value;
    const rawRepo = typeof loaderValue === 'object' ? loaderValue?.value : loaderValue;
    if (typeof rawRepo !== 'string' || !rawRepo.trim()) return [];
    const repoOrFile = rawRepo.trim();
    const segments = repoOrFile.split('/');
    const repo =
      segments.length > 2 && /\.(?:safetensors|pt|pth|ckpt|pkl|bin)$/i.test(repoOrFile)
        ? segments.slice(0, 2).join('/')
        : repoOrFile;
    return [repo];
  });
  const fallbacks = [
    graph?.runtimeHints?.resolvedArtifact,
    graph?.runtimeHints?.resolvedModelRepo,
    output?.provenance?.resourcePlan?.resolvedArtifact,
    output?.repo,
  ].filter((value) => typeof value === 'string' && value.trim());
  const dependencyRepos = Array.isArray(graph?.runtimeHints?.modelDependencies)
    ? graph.runtimeHints.modelDependencies
        .map((dependency) => dependency?.repo)
        .filter((value) => typeof value === 'string' && value.trim())
    : [];
  return [...new Set([...(loaderRepos.length > 0 ? loaderRepos : fallbacks), ...dependencyRepos])];
}

export function resolvedModelRepoFromOutput(output) {
  return resolvedModelReposFromOutput(output)[0] ?? null;
}

export function selectInstalledModelIdentity(payload, repoId) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const model = models.find(
    (item) => item?.installed && String(item?.repoId ?? '').toLowerCase() === String(repoId ?? '').toLowerCase(),
  );
  if (!model?.selectedRevision || !model?.modelRevision) {
    return null;
  }
  return {
    repoId: model.repoId,
    selectedRevision: model.selectedRevision,
    modelRevision: model.modelRevision,
    fingerprint: model.fingerprint ?? null,
    revisions: (model.revisions ?? []).map((revision) => ({
      hash: revision.hash,
      size: revision.size ?? 0,
      lastModified: revision.lastModified ?? null,
    })),
  };
}

export function modelSetIdentity(modelIdentities = []) {
  const items = modelIdentities
    .filter(Boolean)
    .map((model) => orderedValue(model))
    .sort((left, right) => String(left.repoId).localeCompare(String(right.repoId)));
  const revisionLock = items.map((item) => item.modelRevision).join(' | ');
  const commitLock = items.map((item) => `${item.repoId}@${item.selectedRevision}`).join(' | ');
  return {
    count: items.length,
    hash: sha256Value('model-set-v1', items),
    revisionLock,
    commitLock,
    items,
  };
}

function inputArtifactsIdentity(inputArtifacts = []) {
  const items = inputArtifacts
    .map((item) =>
      orderedValue({
        role: item.role ?? null,
        path: item.path ?? null,
        contentHash: item.contentHash ?? item.sha256 ?? null,
        byteSize: item.byteSize ?? null,
      }),
    )
    .sort((left, right) => `${left.role}:${left.path}`.localeCompare(`${right.role}:${right.path}`));
  return {
    count: items.length,
    hash: sha256Value('input-artifacts-v1', items),
    items,
  };
}

export function normalizeBackendRuntime(runtimeFingerprint, deterministicMode = null) {
  if (!runtimeFingerprint || typeof runtimeFingerprint !== 'object') {
    return {
      reportedFingerprint: typeof runtimeFingerprint === 'string' ? runtimeFingerprint : null,
      lockFingerprint: null,
      payload: null,
    };
  }

  const torch = Object.fromEntries(
    RUNTIME_TORCH_FIELDS.filter((field) => runtimeFingerprint.torch?.[field] !== undefined).map((field) => [
      field,
      runtimeFingerprint.torch[field],
    ]),
  );
  const applied = deterministicMode?.settings ?? {};
  if (deterministicMode?.enabled) {
    if (typeof applied.cudnn_benchmark === 'boolean') torch.cudnn_benchmark = applied.cudnn_benchmark;
    if (typeof applied.cudnn_deterministic === 'boolean') {
      torch.cudnn_deterministic = applied.cudnn_deterministic;
    }
    if (typeof applied.torch_deterministic_algorithms === 'boolean') {
      torch.deterministic_algorithms = applied.torch_deterministic_algorithms;
    }
  }
  const payload = orderedValue({
    packages: runtimeFingerprint.packages ?? {},
    torch,
    workDir: runtimeFingerprint.work_dir ?? null,
    dataDir: runtimeFingerprint.data_dir ?? null,
  });
  return {
    reportedFingerprint: runtimeFingerprint.fingerprint ?? null,
    lockFingerprint: sha256Value('stable-runtime-v1', payload),
    payload,
  };
}

function completeRuntimeFingerprintObject(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.fingerprint === 'string' &&
    value.fingerprint.startsWith('sha256:') &&
    value.packages &&
    typeof value.packages === 'object' &&
    !Array.isArray(value.packages) &&
    Object.keys(value.packages).length > 0 &&
    value.torch &&
    typeof value.torch === 'object' &&
    !Array.isArray(value.torch) &&
    Object.keys(value.torch).length > 0 &&
    typeof value.work_dir === 'string' &&
    value.work_dir.length > 0 &&
    typeof value.data_dir === 'string' &&
    value.data_dir.length > 0,
  );
}

/**
 * Select a complete backend runtime receipt without letting a compact queue
 * fingerprint replace the richer graph-completion payload. Multiple complete
 * receipts may differ in volatile memory observations, but their normalized
 * locks must agree. Scalar fingerprints are corroborating claims only and
 * must match one of those complete receipts.
 */
export function selectBackendRuntimeFingerprintEvidence(values, deterministicMode = null) {
  const candidates = values.filter(completeRuntimeFingerprintObject);
  if (candidates.length === 0) return null;
  const locks = new Set(
    candidates.map((candidate) => normalizeBackendRuntime(candidate, deterministicMode).lockFingerprint),
  );
  if (locks.size !== 1 || locks.has(null)) return null;

  const objectFingerprints = new Set(candidates.map((candidate) => candidate.fingerprint));
  const scalarClaims = values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
  if (scalarClaims.some((claim) => !objectFingerprints.has(claim))) return null;
  return candidates[0];
}

export function runtimeLockFromProvenance(provenance) {
  const deterministic = provenance?.runtime?.deterministic?.settings;
  return normalizeBackendRuntime(
    {
      fingerprint: provenance?.runtime?.reportedFingerprint,
      packages: provenance?.runtime?.payload?.packages,
      torch: provenance?.runtime?.payload?.torch,
      work_dir: provenance?.runtime?.payload?.workDir,
      data_dir: provenance?.runtime?.payload?.dataDir,
    },
    deterministic,
  ).lockFingerprint;
}

function normalizedContractParam(param) {
  if (!param || typeof param !== 'object') return param;
  return Object.fromEntries(
    CONTRACT_PARAM_FIELDS.filter((field) => param[field] !== undefined).map((field) => [field, param[field]]),
  );
}

export function backendContractIdentity(nodesPayload, canonicalGraph) {
  const contracts = nodesPayload?.nodes ?? nodesPayload ?? {};
  const used = (canonicalGraph?.nodes ?? []).map((node) => {
    const contract = contracts?.[`${node.module}.${node.action}`] ?? {};
    return {
      key: `${node.module}.${node.action}`,
      module: contract.module ?? node.module,
      action: contract.action ?? node.action,
      type: contract.type ?? null,
      cache: contract.cache ?? null,
      skipParamsCheck: contract.skipParamsCheck ?? null,
      params: Object.fromEntries(
        Object.entries(contract.params ?? {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, param]) => [key, normalizedContractParam(param)]),
      ),
    };
  });
  const payload = orderedValue(used);
  return {
    fingerprint: sha256Value('backend-contract-v1', payload),
    contracts: payload,
  };
}

function sourceFilesUnder(target) {
  if (!existsSync(target)) return [];
  const stats = statSync(target);
  if (stats.isFile()) return [target];
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__pycache__' || entry.name.startsWith('.')) return [];
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(child);
    return /\.(py|toml|ini)$/i.test(entry.name) ? [child] : [];
  });
}

function gitCommit(root) {
  const topLevel = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (topLevel.status !== 0 || !topLevel.stdout.trim()) return null;
  try {
    if (realpathSync(topLevel.stdout.trim()) !== realpathSync(root)) return null;
  } catch {
    return null;
  }
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function backendSourceIdentity(backendRoot) {
  const targets = [
    path.join(backendRoot, 'main.py'),
    path.join(backendRoot, 'pyproject.toml'),
    path.join(backendRoot, 'modiff'),
    path.join(backendRoot, 'modules'),
    path.join(backendRoot, 'utils'),
  ];
  const files = [...new Set(targets.flatMap(sourceFilesUnder))]
    // The Python worker sorts POSIX paths before imports. Normalize separators
    // before sorting: on Windows a backslash orders Image after ImageFilters.
    .map((file) => ({
      file,
      relativePath: path.relative(backendRoot, file).replaceAll('\\', '/'),
    }))
    .sort((left, right) =>
      left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
    )
    .map(({ file, relativePath }) => ({
      path: relativePath,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    }));
  const payload = {
    gitCommit: gitCommit(backendRoot),
    files,
  };
  return {
    gitCommit: payload.gitCommit,
    fingerprint: sha256Value('backend-source-v1', payload),
    files,
  };
}

function processBackendSourceAttestation(runtimeFingerprint) {
  const value = runtimeFingerprint?.backendSource;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    value.claim !== 'process_start_backend_source_identity' ||
    !/^sha256:backend-source-v1:[a-f0-9]{64}$/u.test(String(value.fingerprint ?? '')) ||
    !(value.gitCommit === null || /^[a-f0-9]{40}$/u.test(String(value.gitCommit ?? ''))) ||
    !Number.isInteger(value.fileCount) ||
    value.fileCount <= 0 ||
    typeof value.capturedAt !== 'string' ||
    !value.capturedAt
  ) {
    return null;
  }
  return orderedValue({
    schemaVersion: 1,
    claim: value.claim,
    gitCommit: value.gitCommit,
    fingerprint: value.fingerprint,
    fileCount: value.fileCount,
    capturedAt: value.capturedAt,
  });
}

function backendSourceInventoryBlockers(identity, label) {
  const blockers = [];
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    return [`${label} is missing or malformed.`];
  }
  const gitCommit = identity.gitCommit;
  if (!(gitCommit === null || /^[a-f0-9]{40}$/u.test(String(gitCommit ?? '')))) {
    blockers.push(`${label} Git commit is malformed.`);
  }
  const files = identity.files;
  if (!Array.isArray(files) || files.length === 0) {
    blockers.push(`${label} file inventory is missing or empty.`);
    return blockers;
  }
  const paths = [];
  for (const [index, file] of files.entries()) {
    if (
      !file ||
      typeof file !== 'object' ||
      Array.isArray(file) ||
      typeof file.path !== 'string' ||
      !file.path ||
      !/^[a-f0-9]{64}$/u.test(String(file.sha256 ?? ''))
    ) {
      blockers.push(`${label} file inventory entry ${index} is malformed.`);
      continue;
    }
    paths.push(file.path);
  }
  if (new Set(paths).size !== paths.length) blockers.push(`${label} file inventory contains duplicate paths.`);
  if (blockers.length === 0) {
    const expectedFingerprint = sha256Value('backend-source-v1', { gitCommit, files });
    if (identity.fingerprint !== expectedFingerprint) {
      blockers.push(`${label} fingerprint does not match its retained file inventory.`);
    }
  }
  return blockers;
}

/**
 * Bind a filesystem before/after inventory to the identity captured by the
 * actual worker before it imported executable backend modules. A reused
 * worker is acceptable only while that process-start claim still matches both
 * inventories; old or stale workers fail closed.
 */
export function backendSourceEvidence({ before, after, runtimeFingerprint }) {
  const blockers = [];
  const attestation = processBackendSourceAttestation(runtimeFingerprint);
  blockers.push(...backendSourceInventoryBlockers(before, 'pre-run backend source identity'));
  blockers.push(...backendSourceInventoryBlockers(after, 'post-run backend source identity'));
  if (!attestation) {
    blockers.push('the executing worker did not emit a valid process-start backend source attestation.');
  }
  if (before?.fingerprint && after?.fingerprint && before.fingerprint !== after.fingerprint) {
    blockers.push('backend source files changed while the proof was running.');
  }
  if (attestation && before?.fingerprint && attestation.fingerprint !== before.fingerprint) {
    blockers.push('the executing worker loaded a different backend source identity than the pre-run snapshot.');
  }
  if (attestation && after?.fingerprint && attestation.fingerprint !== after.fingerprint) {
    blockers.push('the executing worker backend source identity does not match the post-run snapshot.');
  }
  if (
    attestation &&
    before?.gitCommit !== undefined &&
    (attestation.gitCommit !== before.gitCommit || attestation.gitCommit !== after?.gitCommit)
  ) {
    blockers.push('the executing worker Git commit does not match both source snapshots.');
  }
  if (
    attestation &&
    Array.isArray(before?.files) &&
    Array.isArray(after?.files) &&
    (attestation.fileCount !== before.files.length || attestation.fileCount !== after.files.length)
  ) {
    blockers.push('the executing worker source-file count does not match both source snapshots.');
  }
  return {
    identity: blockers.length === 0 ? before : null,
    attestation,
    blockers,
  };
}

function deterministicIdentity(deterministicMode) {
  const payload = orderedValue(deterministicMode ?? null);
  return {
    fingerprint: sha256Value('deterministic-settings-v1', payload),
    settings: payload,
  };
}

function templateIdentity({
  templateId,
  lockedSettings,
  promptSettingsHash,
  catalogTemplateLockHash,
  resolvedTemplateLockHash,
  modelRevision,
}) {
  const revisionPayload = {
    templateId,
    lockedSettings,
    promptSettingsHash,
    catalogTemplateLockHash,
    resolvedTemplateLockHash,
    modelRevision,
  };
  return {
    id: templateId,
    promptSettingsHash,
    catalogTemplateLockHash,
    resolvedTemplateLockHash,
    revisionHash: sha256Value('template-revision-v1', revisionPayload),
    lockedSettings: orderedValue(lockedSettings),
  };
}

function outputIdentity(outputAnalysis, executedOutput) {
  const backendItems = executedOutput?.backendProvenance?.mediaItems ?? executedOutput?.mediaItems ?? [];
  const items = (outputAnalysis?.analyses ?? []).map((analysis, index) => {
    const mediaType = analysis.mediaType ?? executedOutput?.displayType ?? 'image';
    return {
      index,
      mediaType,
      width: analysis.width ?? null,
      height: analysis.height ?? null,
      frames: analysis.frames ?? null,
      durationSeconds: analysis.durationSeconds ?? null,
      sampleRate: analysis.sampleRate ?? null,
      channels: analysis.channels ?? null,
      byteSize: analysis.byteSize ?? null,
      encodedSha256: analysis.encodedSha256 ?? null,
      decodedSha256: analysis.decodedSha256 ?? analysis.hash ?? null,
      hasAudio: analysis.hasAudio ?? null,
      decodedAudioSha256: analysis.embeddedAudio?.hash ?? analysis.decodedAudioHash ?? null,
      audiovisualSha256: analysis.audiovisualMediaHash ?? null,
      backendMediaHash: backendItems[index]?.mediaHash ?? (index === 0 ? (executedOutput?.mediaHash ?? null) : null),
    };
  });
  const collectionPayload = items.map(outputCollectionItemIdentity);
  return {
    count: items.length,
    collectionHash: sha256Value('decoded-output-collection-v1', collectionPayload),
    backendCollectionHash: executedOutput?.mediaCollectionHash ?? null,
    items,
  };
}

export function validateRunProvenance(provenance) {
  const blockers = [];
  try {
    validateAppliedAdapterProof(provenance);
  } catch (error) {
    blockers.push(`Applied adapter evidence is invalid: ${error.message}`);
  }
  const required = [
    ['template.resolvedTemplateLockHash', provenance?.template?.resolvedTemplateLockHash],
    ['template.revisionHash', provenance?.template?.revisionHash],
    ['graph.hash', provenance?.graph?.hash],
    ['graph.executionPlanHash', provenance?.graph?.executionPlanHash],
    ['model.modelRevision', provenance?.model?.modelRevision],
    ['model.selectedRevision', provenance?.model?.selectedRevision],
    ['model.fingerprint', provenance?.model?.fingerprint],
    ['runtime.lockFingerprint', provenance?.runtime?.lockFingerprint],
    ['runtime.backendSourceFingerprint', provenance?.runtime?.backendSource?.fingerprint],
    ['runtime.backendContractFingerprint', provenance?.runtime?.backendContract?.fingerprint],
    ['runtime.deterministicFingerprint', provenance?.runtime?.deterministic?.fingerprint],
    ['output.collectionHash', provenance?.output?.collectionHash],
  ];
  for (const [field, value] of required) {
    if (!value || String(value).includes('pin-required') || String(value).includes('unverified')) {
      blockers.push(`${field} is not pinned.`);
    }
  }
  if (provenance?.proofLockHash !== liveProofLockHash(provenance)) {
    blockers.push('proofLockHash does not match the immutable provenance identity.');
  }
  const modelItems = provenance?.models?.items;
  if (
    !Array.isArray(modelItems) ||
    provenance?.models?.count !== modelItems.length ||
    provenance?.models?.hash !== sha256Value('model-set-v1', modelItems)
  ) {
    blockers.push('models.hash does not match the complete executed model set.');
  } else {
    const revisionLock = modelItems.map((item) => item.modelRevision).join(' | ');
    const commitLock = modelItems.map((item) => `${item.repoId}@${item.selectedRevision}`).join(' | ');
    if (provenance.models.revisionLock !== undefined && provenance.models.revisionLock !== revisionLock) {
      blockers.push('models.revisionLock does not match the complete executed model set.');
    }
    if (provenance.models.commitLock !== undefined && provenance.models.commitLock !== commitLock) {
      blockers.push('models.commitLock does not match the complete executed model set.');
    }
  }
  if (Number(provenance?.schemaVersion) >= 2) {
    const sourceIdentity = provenance?.runtime?.backendSource;
    const sourceAttestation = provenance?.runtime?.backendSourceAttestation;
    blockers.push(...backendSourceInventoryBlockers(sourceIdentity, 'runtime.backendSource'));
    const normalizedSourceAttestation = processBackendSourceAttestation({ backendSource: sourceAttestation });
    if (!normalizedSourceAttestation) {
      blockers.push('runtime.backendSourceAttestation is missing or invalid.');
    } else {
      if (normalizedSourceAttestation.fingerprint !== sourceIdentity?.fingerprint) {
        blockers.push('runtime.backendSourceAttestation does not match the retained backend source identity.');
      }
      if (normalizedSourceAttestation.gitCommit !== sourceIdentity?.gitCommit) {
        blockers.push('runtime.backendSourceAttestation Git commit does not match the retained source identity.');
      }
      if (
        !Array.isArray(sourceIdentity?.files) ||
        normalizedSourceAttestation.fileCount !== sourceIdentity.files.length
      ) {
        blockers.push('runtime.backendSourceAttestation file count does not match the retained source inventory.');
      }
    }
    if (!provenance?.execution?.resourceCandidateId) {
      blockers.push('execution.resourceCandidateId is missing.');
    }
    if (!Number.isFinite(provenance?.execution?.elapsedSeconds) || provenance.execution.elapsedSeconds < 0) {
      blockers.push('execution.elapsedSeconds is invalid.');
    }
    if (!Number.isInteger(provenance?.execution?.peakMemoryBytes) || provenance.execution.peakMemoryBytes <= 0) {
      blockers.push('execution.peakMemoryBytes is invalid.');
    }
  }
  if ((provenance?.output?.items?.length ?? 0) === 0) blockers.push('output.items is empty.');
  const expectedOutput = provenance?.template?.expectedOutput;
  const primaryOutput = provenance?.output?.items?.[0];
  if (expectedOutput && primaryOutput) {
    for (const field of ['width', 'height', 'frames']) {
      if (
        Number.isInteger(expectedOutput[field]) &&
        expectedOutput[field] > 0 &&
        primaryOutput[field] !== expectedOutput[field]
      ) {
        blockers.push(
          `output.items.0.${field} does not match the template contract: expected ${expectedOutput[field]}, got ${String(primaryOutput[field])}.`,
        );
      }
    }
    if (expectedOutput.requiresAudio === true && primaryOutput.hasAudio !== true) {
      blockers.push('output.items.0.hasAudio does not match the template contract: audio is required.');
    }
  }
  for (const [index, item] of (provenance?.output?.items ?? []).entries()) {
    if (!item.decodedSha256) blockers.push(`output.items.${index}.decodedSha256 is missing.`);
    if (item.mediaType === 'video' && item.hasAudio === true) {
      if (!item.decodedAudioSha256) blockers.push(`output.items.${index}.decodedAudioSha256 is missing.`);
      if (!item.audiovisualSha256) blockers.push(`output.items.${index}.audiovisualSha256 is missing.`);
    }
    if (item.mediaType === 'audio') {
      if (!Number.isInteger(item.sampleRate) || item.sampleRate <= 0) {
        blockers.push(`output.items.${index}.sampleRate is invalid.`);
      }
      if (!Number.isInteger(item.channels) || item.channels <= 0) {
        blockers.push(`output.items.${index}.channels is invalid.`);
      }
      if (!Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0) {
        blockers.push(`output.items.${index}.durationSeconds is invalid.`);
      }
    } else if (item.mediaType !== 'json') {
      if (!Number.isInteger(item.width) || item.width <= 0) blockers.push(`output.items.${index}.width is invalid.`);
      if (!Number.isInteger(item.height) || item.height <= 0) blockers.push(`output.items.${index}.height is invalid.`);
      if (item.mediaType === 'video' && (!Number.isInteger(item.frames) || item.frames <= 0)) {
        blockers.push(`output.items.${index}.frames is invalid.`);
      }
    }
  }
  for (const [index, item] of (provenance?.inputs?.items ?? []).entries()) {
    if (!item.role) blockers.push(`inputs.items.${index}.role is missing.`);
    if (!item.contentHash) blockers.push(`inputs.items.${index}.contentHash is missing.`);
    if (!Number.isInteger(item.byteSize) || item.byteSize <= 0) {
      blockers.push(`inputs.items.${index}.byteSize is invalid.`);
    }
  }
  const hasRouteBinding = provenance?.routeBinding !== undefined && provenance?.routeBinding !== null;
  const hasRouteBindingHash = provenance?.routeBindingHash !== undefined && provenance?.routeBindingHash !== null;
  if (hasRouteBinding !== hasRouteBindingHash) {
    blockers.push('routeBinding and routeBindingHash must either both be present or both be absent.');
  } else if (hasRouteBinding) {
    try {
      const routeBinding = normalizeResourceRouteBinding(provenance.routeBinding);
      const expectedHash = resourceRouteBindingHash(routeBinding);
      if (provenance.routeBindingHash !== expectedHash) {
        blockers.push('routeBindingHash does not match the exact registered route binding.');
      }
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : 'routeBinding is malformed.');
    }
  }
  return blockers;
}

const same = (actual, expected, label) => assert.equal(stableStringify(actual), stableStringify(expected), label);
const immutableRevision = (value) => typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value);

const accountingFields = {
  LoadPipeline: `model_id pipeline_class mode revision conditioning_kind conditioning_model_id conditioning_revision
    dtype device quantization_mode quantized_components device_map auto_offload offload_mode enable_vae_slicing
    enable_vae_tiling low_cpu_mem_usage`.split(/\s+/u),
  PipelineQuantizationConfigV2: 'backend components dtype excluded_modules component_overrides'.split(' '),
  DiffusersExecutionRecipe: `device_map max_memory device_map_overrides offload_mode device attention_backend
    attention_components vae_slicing vae_tiling layerwise_casting layerwise_casting_components layerwise_storage_dtype
    layerwise_compute_dtype channels_last channels_last_components regional_compile compile_components compile_backend
    compile_mode compile_fullgraph compile_dynamic denoiser_cache cache_threshold cache_options`.split(/\s+/u),
  UnconditionalGenerate: 'image_contract batch_size seed num_inference_steps eta class_label output_type'.split(' '),
  Preview: ['device', 'export'],
};
const accountingModules = {
  LoadPipeline: 'modules.DiffusersImage',
  UnconditionalGenerate: 'modules.DiffusersImage',
  PipelineQuantizationConfigV2: 'modules.DiffusersRuntime',
  DiffusersExecutionRecipe: 'modules.DiffusersRuntime',
  Preview: 'modules.Image',
};
const accountingScalar = (value) =>
  value === null ||
  typeof value === 'boolean' ||
  (typeof value === 'string' && value.length <= 16_384) ||
  (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
const accountingValue = (value) =>
  accountingScalar(value) || (Array.isArray(value) && value.length <= 16 && value.every(accountingScalar));
function accountingKeys(value, keys, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), label);
  same(Object.keys(value).sort(), [...keys].sort(), label);
}
// The backend hashes sorted ASCII JSON, separately from existing v1 hashes.
function accountingDigest(kind, value) {
  const ordered = (item) =>
    Array.isArray(item)
      ? item.map(ordered)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, ordered(item[key])]),
          )
        : item;
  const ascii = JSON.stringify(ordered(value)).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return createHash('sha256').update(`${kind}\n${ascii}`, 'ascii').digest('hex');
}

/** Independent accounting join; not a provenance factory or release grant.
 * Initial scope is the existing five-node, unquantized DDIM canonical creator.
 * The optional shared-factory hook binds this join to the original task/output.
 * Native acceptance remains separate; the default factory path stays unchanged.
 */
export function canonicalAccountingExecutionPlan({ expectedApiGraph, apiGraph, consumed, target }) {
  same(
    canonicalGraphIdentity(apiGraph),
    canonicalGraphIdentity(expectedApiGraph),
    'Accounting graph is not the canonical export.',
  );
  assert.equal(target.modelType, 'DDIMPipeline', 'Canonical accounting model is outside the reviewed initial scope.');
  assert.equal(target.task, 'unconditional_image');
  assert.ok(
    !apiGraph.runtimeHints || Object.keys(apiGraph.runtimeHints).length === 0,
    'Declared runtime hints need a separate accounting policy.',
  );
  assert.equal(consumed?.schemaVersion, 1);
  assert.equal(consumed.source, 'backend-execution');
  assert.equal(consumed.truncated, false);
  same(consumed.uncapturedNodeIds, [], 'Accounting ancestry is incomplete.');
  same(consumed.fieldAccountingStatus, { schemaVersion: 1, truncated: false }, 'Accounting extension is incomplete.');
  assert.ok(Array.isArray(consumed.nodes) && consumed.nodes.length === 5, 'Exact five-node accounting is required.');
  assert.equal(new Set(consumed.nodes.map((row) => row.nodeId)).size, 5, 'Accounting owner identities are ambiguous.');
  same(
    consumed.nodes.map((row) => row.nodeId).sort(),
    Object.keys(apiGraph.nodes).sort(),
    'Accounting graph scope differs.',
  );
  assert.ok(Array.isArray(apiGraph.paths) && apiGraph.paths.length === 1, 'One executed canonical path is required.');
  same([...apiGraph.paths[0]].sort(), Object.keys(apiGraph.nodes).sort(), 'Accounting contains an unexecuted owner.');
  const byAction = new Map();
  for (const row of consumed.nodes) {
    const node = apiGraph.nodes[row.nodeId];
    assert.ok(Object.hasOwn(accountingFields, row.action), 'Unknown accounting action.');
    assert.equal(row.module, accountingModules[row.action], 'Unknown accounting module.');
    assert.equal(node.module, row.module);
    assert.equal(node.action, row.action);
    assert.ok(!byAction.has(row.action), 'Accounting owner is not unique.');
    byAction.set(row.action, { row, node });
    same(row.omittedFields, {}, 'Legacy consumed fields were omitted.');
    const section = row.fieldAccounting;
    accountingKeys(
      section,
      [
        'schemaVersion',
        'fields',
        'inputProjections',
        'outputProjections',
        'unaccountedFields',
        'omittedFields',
        'complete',
      ],
      'Unknown or missing accounting section keys.',
    );
    assert.equal(section.schemaVersion, 1);
    assert.equal(section.complete, true, 'Incomplete field accounting.');
    same(section.omittedFields, {}, 'Accounting fields were omitted.');
    same(section.unaccountedFields, [], 'Unaccounted graph fields remain.');
    assert.ok(JSON.stringify(section).length <= 65_536, 'Accounting section exceeds its bound.');
    accountingKeys(section.fields, accountingFields[row.action], 'Accounting literal field set differs.');
    for (const [key, field] of Object.entries(section.fields)) {
      const parameter = node.params[key];
      assert.ok(
        parameter && Object.hasOwn(parameter, 'value') && !parameter.sourceId && !parameter.sourceKey,
        `Accounting literal origin differs: ${row.nodeId}.${key}`,
      );
      assert.equal(field.source, 'literal', 'Connected or overridden scalar accounting is unsupported.');
      if (field.disposition === 'metadata') {
        accountingKeys(field, ['disposition', 'source', 'reason', 'sha256'], 'Unexpected metadata fields.');
        assert.equal(key, 'image_contract');
        assert.equal(field.reason, 'presentation-contract');
        assert.equal(
          field.sha256,
          accountingDigest('image-contract-v1', parameter.value),
          'Metadata contract hash differs.',
        );
      } else {
        accountingKeys(
          field,
          ['disposition', 'inputValue', 'value', 'source', ...(field.disposition === 'consumed' ? [] : ['reason'])],
          'Unexpected accounted scalar fields.',
        );
        assert.ok(
          ['consumed', 'inactive', 'superseded'].includes(field.disposition),
          'Unknown accounting disposition.',
        );
        assert.ok(accountingValue(field.inputValue) && accountingValue(field.value), 'Unbounded accounting scalar.');
        const requested = parameter.value?.source === 'hub' ? parameter.value.value : parameter.value;
        same(field.inputValue, requested, `Requested literal differs: ${row.nodeId}.${key}`);
      }
    }
    for (const [key, parameter] of Object.entries(node.params)) {
      if (Object.hasOwn(parameter, 'value') && !parameter.sourceId)
        assert.ok(Object.hasOwn(section.fields, key), `Unaccounted literal: ${row.nodeId}.${key}`);
    }
    for (const [key, field] of Object.entries(row.fields)) {
      assert.equal(field.source, 'literal', 'Legacy scalar origin differs.');
      accountingKeys(field, ['value', 'source'], 'Legacy scalar has contradictory origin fields.');
      if (key === 'executed_task') {
        assert.equal(row.action, 'UnconditionalGenerate');
        assert.equal(field.value, target.task);
        continue;
      }
      const accounted = section.fields[key];
      assert.ok(accounted && accounted.disposition !== 'metadata', `Legacy scalar lacks accounting: ${key}`);
      let expected = row.action === 'LoadPipeline' ? accounted.inputValue : accounted.value;
      if (key === 'seed' && Number.isSafeInteger(expected) && typeof field.value === 'string')
        expected = String(expected);
      same(field.value, expected, `Legacy/new accounting contradicts: ${row.nodeId}.${key}`);
    }
  }
  const owner = byAction.get('LoadPipeline');
  const recipe = byAction.get('DiffusersExecutionRecipe');
  const quant = byAction.get('PipelineQuantizationConfigV2');
  const generate = byAction.get('UnconditionalGenerate');
  const preview = byAction.get('Preview');
  assert.ok(owner && recipe && quant && generate && preview, 'Canonical accounting roles are incomplete.');
  assert.equal(consumed.nodeId, preview.row.nodeId, 'Accounting output owner differs.');
  const fields = (entry) => entry.row.fieldAccounting.fields;
  const value = (entry, key) => fields(entry)[key].value;
  const check = (entry, key, disposition, effective, reason) => {
    const field = fields(entry)[key];
    assert.equal(field.disposition, disposition, `Wrong disposition: ${entry.row.nodeId}.${key}`);
    assert.equal(field.reason, reason, `Wrong disposition reason: ${entry.row.nodeId}.${key}`);
    same(field.value, effective, `Effective control differs: ${entry.row.nodeId}.${key}`);
  };
  const wires = new Map([
    [owner.row.nodeId, { execution_recipe: [recipe, 'execution_recipe'] }],
    [recipe.row.nodeId, { quantization_config: [quant, 'quantization_config'] }],
    [generate.row.nodeId, { pipeline: [owner, 'pipeline'] }],
    [preview.row.nodeId, { image: [generate, 'images'] }],
    [quant.row.nodeId, {}],
  ]);
  for (const entry of byAction.values()) {
    const expected = wires.get(entry.row.nodeId);
    // The normal exporter also retains Preview's UI output selector. It has
    // no source node and is never an execution input or producer connection.
    for (const [key, parameter] of Object.entries(entry.node.params)) {
      if (!parameter.sourceId && parameter.sourceKey) {
        assert.equal(entry, preview, 'A dangling input port is not accounted.');
        assert.equal(key, 'preview');
        same(parameter, { display: 'ui_image', sourceKey: 'output' }, 'Unknown output selector.');
      }
    }
    const connected = Object.entries(entry.node.params).filter(([, parameter]) => parameter.sourceId);
    same(connected.map(([key]) => key).sort(), Object.keys(expected).sort(), 'Unexpected connected runtime input.');
    for (const [key, [producer, port]] of Object.entries(expected)) {
      const parameter = entry.node.params[key];
      assert.equal(parameter.sourceId, producer.row.nodeId, 'Connected producer differs.');
      assert.equal(parameter.sourceKey, port, 'Connected producer port differs.');
      assert.ok(!Object.hasOwn(parameter, 'value'), 'Connected input also declares a literal.');
      assert.ok(
        apiGraph.paths[0].indexOf(producer.row.nodeId) < apiGraph.paths[0].indexOf(entry.row.nodeId),
        'Producer was not executed before its consumer.',
      );
    }
  }
  const disabled = { backend: 'none', disabled: true };
  const recipeValues = { schema_version: 1, quantization: 'none', device_map_strategy: value(recipe, 'device_map') };
  const componentFields = new Set([
    'attention_components',
    'layerwise_casting_components',
    'channels_last_components',
    'compile_components',
  ]);
  for (const key of accountingFields.DiffusersExecutionRecipe.filter((key) => key !== 'device_map_overrides')) {
    const item = value(recipe, key);
    if (componentFields.has(key)) {
      assert.ok(typeof item === 'string' || (Array.isArray(item) && item.every((part) => typeof part === 'string')));
      recipeValues[key] = [
        ...new Set(
          (Array.isArray(item) ? item : item.replaceAll('\n', ',').split(','))
            .map((part) => part.trim())
            .filter(Boolean),
        ),
      ];
    } else recipeValues[key] = item;
  }
  for (const key of ['max_memory', 'cache_options', 'device_map_overrides'])
    assert.equal(value(recipe, key), '{}', 'Mapping or cache configuration is outside the bounded accounting scope.');
  assert.equal(value(recipe, 'device_map'), 'none', 'Split/manual placement is outside the bounded accounting scope.');
  assert.equal(value(recipe, 'offload_mode'), 'none', 'Offload accounting needs a separate reviewed scope.');
  const projection = (item, kind, values, producer) => {
    accountingKeys(
      item,
      ['kind', 'values', 'sha256', ...(producer ? ['source', 'sourceNodeId', 'sourcePortId'] : [])],
      'Projection shape differs.',
    );
    assert.equal(item.kind, kind);
    same(item.values, values, 'Projection differs from actual producer controls.');
    assert.equal(item.sha256, accountingDigest(kind, values), 'Projection hash differs.');
    if (producer) {
      assert.equal(item.source, 'connected');
      assert.equal(item.sourceNodeId, producer[0].row.nodeId);
      assert.equal(item.sourcePortId, producer[1]);
    }
  };
  for (const entry of byAction.values()) {
    const section = entry.row.fieldAccounting;
    const inputPort = entry === owner ? 'execution_recipe' : entry === recipe ? 'quantization_config' : null;
    const outputPort = entry === recipe ? 'execution_recipe' : entry === quant ? 'quantization_config' : null;
    accountingKeys(section.inputProjections, inputPort ? [inputPort] : [], 'Unexpected input projections.');
    accountingKeys(section.outputProjections, outputPort ? [outputPort] : [], 'Unexpected output projections.');
    if (inputPort)
      projection(
        section.inputProjections[inputPort],
        entry === owner ? 'execution-recipe-v1' : 'disabled-quantization-v1',
        entry === owner ? recipeValues : disabled,
        entry === owner ? [recipe, inputPort] : [quant, inputPort],
      );
    if (outputPort)
      projection(
        section.outputProjections[outputPort],
        entry === recipe ? 'execution-recipe-v1' : 'disabled-quantization-v1',
        entry === recipe ? recipeValues : disabled,
      );
  }
  assert.equal(value(quant, 'backend'), 'none', 'Enabled quantization is unsupported.');
  for (const key of accountingFields.PipelineQuantizationConfigV2)
    check(
      quant,
      key,
      ['dtype', 'excluded_modules'].includes(key) ? 'inactive' : 'consumed',
      fields(quant)[key].inputValue,
      ['dtype', 'excluded_modules'].includes(key) ? 'feature-disabled' : undefined,
    );
  const inactiveRecipe = new Set(['device_map_overrides']);
  for (const [enabled, keys] of [
    [
      value(recipe, 'layerwise_casting'),
      ['layerwise_casting_components', 'layerwise_storage_dtype', 'layerwise_compute_dtype'],
    ],
    [value(recipe, 'channels_last'), ['channels_last_components']],
    [
      value(recipe, 'regional_compile'),
      ['compile_components', 'compile_backend', 'compile_mode', 'compile_fullgraph', 'compile_dynamic'],
    ],
    [value(recipe, 'denoiser_cache') !== 'none', ['cache_threshold', 'cache_options']],
  ])
    if (!enabled) for (const key of keys) inactiveRecipe.add(key);
  for (const key of accountingFields.DiffusersExecutionRecipe)
    check(
      recipe,
      key,
      inactiveRecipe.has(key) ? 'inactive' : 'consumed',
      fields(recipe)[key].inputValue,
      inactiveRecipe.has(key) ? 'feature-disabled' : undefined,
    );
  const superseded = {
    device: 'device',
    offload_mode: 'offload_mode',
    auto_offload: 'offload_mode',
    enable_vae_slicing: 'vae_slicing',
    enable_vae_tiling: 'vae_tiling',
  };
  for (const key of accountingFields.LoadPipeline) {
    if (Object.hasOwn(superseded, key)) {
      const effective =
        key === 'auto_offload' ? value(recipe, 'offload_mode') !== 'none' : value(recipe, superseded[key]);
      check(owner, key, 'superseded', effective, 'connected-recipe');
    } else if (key === 'device_map' && ['cuda', 'cuda:0'].includes(value(owner, 'device'))) {
      assert.equal(fields(owner)[key].inputValue, 'none');
      check(owner, key, 'superseded', 'cuda', 'loader-normalization');
    } else if (['conditioning_model_id', 'conditioning_revision'].includes(key)) {
      check(owner, key, 'inactive', fields(owner)[key].inputValue, 'adapter-inactive');
    } else check(owner, key, 'consumed', fields(owner)[key].inputValue);
  }
  assert.equal(value(owner, 'pipeline_class'), target.modelType);
  assert.equal(value(owner, 'mode'), target.task);
  assert.equal(value(owner, 'conditioning_kind'), 'none');
  assert.equal(value(owner, 'quantization_mode'), 'none');
  same(value(owner, 'quantized_components'), [], 'Quantized components are unsupported.');
  assert.ok(immutableRevision(value(owner, 'revision')), 'Executed loader pin is unresolved.');
  same(
    [{ repoId: value(owner, 'model_id'), revision: value(owner, 'revision') }],
    target.modelSet,
    'Executed model set differs.',
  );
  for (const key of accountingFields.UnconditionalGenerate) {
    if (key === 'image_contract') {
      assert.equal(fields(generate)[key].disposition, 'metadata');
      continue;
    }
    check(
      generate,
      key,
      key === 'class_label' ? 'inactive' : 'consumed',
      fields(generate)[key].inputValue,
      key === 'class_label' ? 'adapter-inactive' : undefined,
    );
  }
  assert.equal(value(generate, 'output_type'), 'pil', 'Only already-decoded output is accounted.');
  check(preview, 'device', 'inactive', fields(preview).device.inputValue, 'already-decoded-image');
  check(preview, 'export', 'consumed', fields(preview).export.inputValue);
  const plan = {
    source: 'executed-canonical-accounting-v1',
    resourceMode: 'expert',
    resolvedResourceMode: 'expert',
    modelType: target.modelType,
    pipelineClass: value(owner, 'pipeline_class'),
    modelRepo: value(owner, 'model_id'),
    resolvedModelRepo: value(owner, 'model_id'),
    resolvedArtifact: value(owner, 'model_id'),
    dtype: value(owner, 'dtype'),
    device: value(owner, 'device'),
    deviceMap: value(owner, 'device_map'),
    autoOffload: value(owner, 'auto_offload'),
    offloadMode: value(owner, 'offload_mode'),
    quantizationMode: 'none',
    quantizedComponents: [],
    attentionBackend: recipeValues.attention_backend,
    regionalCompile: recipeValues.regional_compile,
    denoiserCache: recipeValues.denoiser_cache,
    channelsLast: recipeValues.channels_last,
    layerwiseCasting: recipeValues.layerwise_casting,
  };
  return { ownerId: owner.row.nodeId, plan, hash: sha256Value('execution-plan-v1', plan) };
}

function canonicalAccountingProofPlan({ apiGraph, executedOutput, executionReceipt, taskId, proof }) {
  accountingKeys(
    proof,
    ['expectedApiGraph', 'target', 'run'],
    'Canonical proof accepts original evidence, not a supplied plan.',
  );
  const { run, target, expectedApiGraph } = proof;
  const task = run?.task;
  assert.ok(typeof taskId === 'string' && taskId.length > 0, 'Canonical task identity is missing.');
  assert.equal(task?.task_id, taskId, 'Canonical proof belongs to another task.');
  assert.equal(task.status, 'completed', 'Canonical task is not completed.');
  assert.equal(task.attempt_index, 0, 'Canonical retries are outside the reviewed scope.');
  same(task, executionReceipt, 'Canonical raw task differs from the measured task.');
  assert.ok(task.resourceCandidateId == null, 'Canonical Expert task retains an Auto resource candidate.');
  assert.ok(
    !task.runtimeHints || Object.keys(task.runtimeHints).length === 0,
    'Canonical task contains unreviewed runtime hints.',
  );
  assert.ok(
    executedOutput && typeof executedOutput.id === 'string' && executedOutput.id.length > 0,
    'Canonical output is missing.',
  );
  assert.equal(executedOutput.taskId, taskId, 'Canonical output belongs to another task.');
  assert.equal(executedOutput.attemptIndex, 0, 'Canonical output attempt differs.');
  assert.ok(typeof executedOutput.workflowTabId === 'string' && executedOutput.workflowTabId.length > 0);
  assert.equal(run.workflow_id, executedOutput.workflowTabId, 'Canonical output belongs to another workflow.');
  const persisted = (run.outputs ?? []).filter((item) => item.id === executedOutput.id && item.taskId === taskId);
  assert.equal(persisted.length, 1, 'Canonical output is not uniquely present in the raw task.');
  for (const key of [
    'taskId',
    'clientRunId',
    'runInputHash',
    'workflowTabId',
    'attemptIndex',
    'nodeId',
    'fieldKey',
    'apiGraphSnapshot',
    'resolvedExecutionInputs',
    'mediaHash',
    'mediaItems',
  ]) {
    assert.notEqual(executedOutput[key], undefined, `Canonical output is missing ${key}.`);
    same(executedOutput[key], persisted[0][key], `Canonical original output ${key} differs.`);
  }
  same(apiGraph, executedOutput.apiGraphSnapshot, 'Canonical factory graph differs from the original output.');
  const consumed = executedOutput.resolvedExecutionInputs;
  assert.equal(consumed?.taskId, taskId, 'Canonical consumed receipt belongs to another task.');
  assert.equal(consumed.attemptIndex, 0, 'Canonical consumed receipt attempt differs.');
  assert.equal(consumed.nodeId, executedOutput.nodeId, 'Canonical consumed receipt output owner differs.');
  return canonicalAccountingExecutionPlan({ expectedApiGraph, apiGraph, consumed, target });
}

export function createRunProvenance({
  templateId,
  lockedSettings,
  promptSettingsHash,
  catalogTemplateLockHash,
  resolvedTemplateLockHash,
  apiGraph,
  nodesPayload,
  modelIdentity,
  modelIdentities,
  inputArtifacts = [],
  runtimeFingerprint,
  deterministicMode,
  backendSource,
  outputAnalysis,
  executedOutput,
  executionReceipt,
  taskId,
  expectedOutput,
  canonicalAccountingProof,
  capturedAt = new Date().toISOString(),
}) {
  const rawRouteBinding = apiGraph?.provenance?.registeredBlockV2RouteBinding;
  const routeBinding =
    rawRouteBinding === undefined || rawRouteBinding === null ? null : normalizeResourceRouteBinding(rawRouteBinding);
  const routeBindingHash = routeBinding ? resourceRouteBindingHash(routeBinding) : null;
  const graph = canonicalGraphIdentity(apiGraph);
  const adapterApplications = createAppliedAdapterProof({
    apiGraph,
    canonicalGraph: graph.canonicalGraph,
    executedOutput,
    executionReceipt,
    taskId,
  });
  const executionPlan =
    canonicalAccountingProof === undefined
      ? executionPlanIdentity(apiGraph)
      : canonicalAccountingProofPlan({
          apiGraph,
          executedOutput,
          executionReceipt,
          taskId,
          proof: canonicalAccountingProof,
        });
  const execution = executionReceiptIdentity(executionReceipt, executionPlan.plan);
  const runtime = normalizeBackendRuntime(runtimeFingerprint, deterministicMode);
  const backendSourceAttestation = processBackendSourceAttestation(runtimeFingerprint);
  const backendContract = backendContractIdentity(nodesPayload, graph.canonicalGraph);
  const deterministic = deterministicIdentity(deterministicMode);
  const modelSet = modelSetIdentity(modelIdentities?.length ? modelIdentities : [modelIdentity].filter(Boolean));
  if (canonicalAccountingProof !== undefined) {
    same(
      modelSet.items
        .map((item) => ({ repoId: item.repoId, revision: item.selectedRevision }))
        .sort((left, right) => left.repoId.localeCompare(right.repoId)),
      canonicalAccountingProof.target.modelSet,
      'Canonical installed model identity differs from the executed model owner.',
    );
    same(runtimeFingerprint, executionReceipt.runtimeFingerprint, 'Canonical runtime differs from the raw task.');
    assert.ok(
      Number.isFinite(executionReceipt.started_at) &&
        Number.isFinite(executionReceipt.completed_at) &&
        executionReceipt.completed_at >= executionReceipt.started_at,
      'Canonical task duration is missing.',
    );
    assert.equal(
      capturedAt,
      new Date(executionReceipt.completed_at * 1000).toISOString(),
      'Canonical completion time differs.',
    );
  }
  const compatibilityModel =
    modelSet.count === 1
      ? modelSet.items[0]
      : {
          repoId: `model-set:${modelSet.hash}`,
          selectedRevision: modelSet.commitLock,
          modelRevision: modelSet.revisionLock,
          fingerprint: modelSet.hash,
          revisions: [],
        };
  const inputs = inputArtifactsIdentity(inputArtifacts);
  const template = templateIdentity({
    templateId,
    lockedSettings,
    promptSettingsHash,
    catalogTemplateLockHash,
    resolvedTemplateLockHash,
    modelRevision: compatibilityModel?.modelRevision,
  });
  const output = outputIdentity(outputAnalysis, executedOutput);
  const proofLock = {
    format: LIVE_PROOF_PROVENANCE_FORMAT,
    templateRevisionHash: template.revisionHash,
    resolvedTemplateLockHash: template.resolvedTemplateLockHash,
    graphHash: graph.hash,
    executionPlanHash: executionPlan.hash,
    modelRevision: compatibilityModel?.modelRevision ?? null,
    modelFingerprint: compatibilityModel?.fingerprint ?? null,
    modelSetHash: modelSet.hash,
    inputArtifactsHash: inputs.hash,
    runtimeFingerprint: runtime.lockFingerprint,
    backendSourceFingerprint: backendSource?.fingerprint ?? null,
    backendContractFingerprint: backendContract.fingerprint,
    deterministicFingerprint: deterministic.fingerprint,
    outputCollectionHash: output.collectionHash,
    ...(routeBindingHash ? { routeBindingHash } : {}),
    ...(adapterApplications ? { adapterApplicationsHash: adapterApplications.hash } : {}),
  };
  const firstOutput = output.items[0] ?? {};
  const provenance = {
    schemaVersion: LIVE_PROOF_PROVENANCE_SCHEMA_VERSION,
    format: LIVE_PROOF_PROVENANCE_FORMAT,
    capturedAt,
    taskId: taskId ?? null,
    proofLockHash: sha256Value('live-proof-lock-v1', proofLock),
    graphHash: graph.hash,
    runtimeFingerprint: runtime.lockFingerprint,
    backendReportedRuntimeFingerprint: runtime.reportedFingerprint,
    backendSourceFingerprint: backendSource?.fingerprint ?? null,
    backendContractFingerprint: backendContract.fingerprint,
    modelRevision: compatibilityModel?.modelRevision ?? null,
    modelCommit: compatibilityModel?.selectedRevision ?? null,
    inputArtifactsHash: inputs.hash,
    templateLockHash: template.resolvedTemplateLockHash,
    templateRevisionHash: template.revisionHash,
    mediaHash: firstOutput.decodedSha256 ?? null,
    decodedAudioHash: firstOutput.decodedAudioSha256 ?? null,
    audiovisualMediaHash: firstOutput.audiovisualSha256 ?? null,
    mediaType: firstOutput.mediaType ?? null,
    width: firstOutput.width ?? null,
    height: firstOutput.height ?? null,
    frames: firstOutput.frames ?? null,
    durationSeconds: firstOutput.durationSeconds ?? null,
    sampleRate: firstOutput.sampleRate ?? null,
    channels: firstOutput.channels ?? null,
    ...(routeBinding ? { routeBinding, routeBindingHash } : {}),
    ...(adapterApplications
      ? { adapterApplications: adapterApplications.proof, adapterApplicationsHash: adapterApplications.hash }
      : {}),
    template: {
      ...template,
      expectedOutput:
        expectedOutput && typeof expectedOutput === 'object'
          ? {
              ...(Number.isInteger(expectedOutput.width) ? { width: expectedOutput.width } : {}),
              ...(Number.isInteger(expectedOutput.height) ? { height: expectedOutput.height } : {}),
              ...(Number.isInteger(expectedOutput.frames) ? { frames: expectedOutput.frames } : {}),
              ...(expectedOutput.requiresAudio === true ? { requiresAudio: true } : {}),
            }
          : null,
    },
    graph: {
      ...graph,
      executionPlanHash: executionPlan.hash,
      executionPlan: executionPlan.plan,
    },
    execution,
    model: compatibilityModel ?? null,
    models: modelSet,
    inputs,
    runtime: {
      ...runtime,
      backendSource: backendSource ?? null,
      backendSourceAttestation,
      backendContract,
      deterministic,
    },
    output,
  };
  return {
    ...provenance,
    blockers: validateRunProvenance(provenance),
  };
}

function valueAt(root, pathExpression) {
  return pathExpression.split('.').reduce((value, key) => value?.[key], root);
}

export function compareRunProvenance(baseline, candidate) {
  const fields = [
    'schemaVersion',
    'format',
    'template.id',
    'template.promptSettingsHash',
    'template.resolvedTemplateLockHash',
    'template.revisionHash',
    'graph.hash',
    'graph.executionPlanHash',
    'model.repoId',
    'model.selectedRevision',
    'model.modelRevision',
    'model.fingerprint',
    'models.count',
    'models.hash',
    'inputs.count',
    'inputs.hash',
    'runtime.backendSource.fingerprint',
    'runtime.backendContract.fingerprint',
    'runtime.deterministic.fingerprint',
    'output.count',
    'output.collectionHash',
  ];
  if (baseline?.routeBindingHash || candidate?.routeBindingHash) fields.push('routeBindingHash');
  const maxOutputs = Math.max(baseline?.output?.items?.length ?? 0, candidate?.output?.items?.length ?? 0);
  for (let index = 0; index < maxOutputs; index += 1) {
    const mediaType =
      baseline?.output?.items?.[index]?.mediaType ?? candidate?.output?.items?.[index]?.mediaType ?? 'image';
    fields.push(`output.items.${index}.decodedSha256`);
    if (baseline?.output?.items?.[index]?.decodedAudioSha256 || candidate?.output?.items?.[index]?.decodedAudioSha256) {
      fields.push(`output.items.${index}.decodedAudioSha256`);
    }
    if (baseline?.output?.items?.[index]?.audiovisualSha256 || candidate?.output?.items?.[index]?.audiovisualSha256) {
      fields.push(`output.items.${index}.audiovisualSha256`);
    }
    if (mediaType === 'audio') {
      fields.push(
        `output.items.${index}.sampleRate`,
        `output.items.${index}.channels`,
        `output.items.${index}.durationSeconds`,
      );
    } else if (mediaType === 'video') {
      fields.push(
        `output.items.${index}.width`,
        `output.items.${index}.height`,
        `output.items.${index}.frames`,
        `output.items.${index}.durationSeconds`,
      );
    } else if (mediaType !== 'json') {
      fields.push(`output.items.${index}.width`, `output.items.${index}.height`);
    }
  }

  const mismatches = fields.flatMap((field) => {
    const expected = valueAt(baseline, field);
    const actual = valueAt(candidate, field);
    return stableStringify(expected) === stableStringify(actual) ? [] : [{ field, expected, actual }];
  });
  const baselineRuntimeLock = runtimeLockFromProvenance(baseline);
  const candidateRuntimeLock = runtimeLockFromProvenance(candidate);
  if (baselineRuntimeLock !== candidateRuntimeLock) {
    mismatches.push({
      field: 'runtime.lockFingerprint',
      expected: baselineRuntimeLock,
      actual: candidateRuntimeLock,
    });
  }
  const baselineBlockers = validateRunProvenance(baseline);
  const candidateBlockers = validateRunProvenance(candidate);
  return {
    matches: mismatches.length === 0,
    candidateExact: mismatches.length === 0 && baselineBlockers.length === 0 && candidateBlockers.length === 0,
    comparedFields: fields.length + 1,
    mismatches,
    baselineBlockers,
    candidateBlockers,
  };
}
