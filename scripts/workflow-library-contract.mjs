import { stableJsonValue } from './canonical-json.mjs';

function paramValue(node, key) {
  return node?.data?.params?.[key]?.value;
}

/** A canonical graph records both visible artifacts and backend-declared
 * dependencies for its exact task. This is metadata, not installation or proof. */
export function canonicalWorkflowRequiredArtifacts(graph, capability, mode) {
  const artifacts = new Set();
  for (const node of graph?.nodes ?? []) {
    for (const field of Object.values(node?.data?.params ?? {})) {
      const value = field?.value;
      if (value?.source === 'hub' && typeof value.value === 'string' && value.value.length > 0)
        artifacts.add(value.value);
    }
  }
  if (artifacts.size === 0 && capability.defaultRepo) artifacts.add(capability.defaultRepo);
  for (const requirement of [
    ...(capability.inputContracts?.[mode]?.modelRequirements ?? []),
    ...(capability.modeRequirements?.[mode]?.modelRequirements ?? []),
    ...(capability.additionalRequirements ?? []),
  ]) {
    if (Array.isArray(requirement.requiredForModes) && !requirement.requiredForModes.includes(mode)) continue;
    if (typeof requirement.repo !== 'string' || !requirement.repo.trim())
      throw new Error('A required canonical workflow dependency has no repository.');
    artifacts.add(requirement.repo);
  }
  return [...artifacts];
}

const FORBIDDEN_ATTENTION_BACKENDS = new Set(['aiter', 'aiter_fa2_hub']);
const APP_DATA_COLLISION_REFERENCE = /^(@data\/(?:audio|images|videos)\/[^/]+?)_[A-Za-z0-9_-]{6}(\.[A-Za-z0-9]+)$/;

export function normalizePortableWorkflowDataReference(value) {
  if (typeof value !== 'string') return value;
  return value.replace(APP_DATA_COLLISION_REFERENCE, '$1$2');
}

export function normalizePortableWorkflowFieldState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value.isConnected !== true || typeof value.disabled !== 'boolean') return value;
  return value.disabled === true ? value : { ...value, disabled: true };
}

export function workflowNodeAttentionBackendError(node) {
  const attention = node?.data?.params?.attention_backend;
  if (!attention || typeof attention !== 'object') return null;
  const savedOptions = Array.isArray(attention.options)
    ? attention.options.map((option) => (typeof option === 'string' ? option : option?.value))
    : Object.keys(attention.options ?? {});
  const stale = [attention.value, ...savedOptions].filter((value) => FORBIDDEN_ATTENTION_BACKENDS.has(value));
  if (stale.length > 0) return `persists unsupported attention backends: ${[...new Set(stale)].join(', ')}`;
  const backend = attention.value;
  const device = paramValue(node, 'device');
  // PyTorch's math SDPA is portable; the other native kernels still require
  // an accelerator. Keep the exception exact, not a native-prefix exemption.
  if (
    backend !== '_native_math' &&
    String(backend ?? '').startsWith('_native_') &&
    String(device ?? '').startsWith('cpu')
  )
    return `selects accelerator attention ${backend} on ${device}`;
  return null;
}

export function workflowNodeDeviceOffloadError(node) {
  const device = String(paramValue(node, 'device') ?? '');
  if (!device) return null;
  const offloadMode = paramValue(node, 'offload_mode');
  const autoOffload = paramValue(node, 'auto_offload');
  const supportsCpuOffload = /^cuda(?::\d+)?$/i.test(device);
  if (!supportsCpuOffload && (autoOffload === true || (typeof offloadMode === 'string' && offloadMode !== 'none'))) {
    return `selects ${offloadMode || 'automatic CPU'} offload on ${device}`;
  }
  if (typeof autoOffload === 'boolean' && typeof offloadMode === 'string' && autoOffload !== (offloadMode !== 'none')) {
    return `has inconsistent auto_offload=${autoOffload} and offload_mode=${offloadMode}`;
  }
  return null;
}

export function normalizePortableWorkflowNodeOffload(node) {
  if (!workflowNodeDeviceOffloadError(node)) return node;
  const params = node?.data?.params ?? {};
  if (params.auto_offload) params.auto_offload = { ...params.auto_offload, value: false };
  if (params.offload_mode) params.offload_mode = { ...params.offload_mode, value: 'none' };
  return node;
}

function canonicalDeviceOwnerIdentity(node) {
  const data = node?.data;
  if (typeof data?.module !== 'string' || typeof data.action !== 'string') return null;
  const operation = data.operationAuthoring?.operation;
  return JSON.stringify(
    stableJsonValue({
      module: data.module,
      action: data.action,
      operationId: operation?.operationId ?? null,
      decomposition: operation?.decomposition ?? null,
      pipelineClass: operation?.pipelineClass ?? null,
      workflowId: operation?.workflowId ?? null,
      binding: operation?.binding ?? null,
    }),
  );
}

/** Pair regeneration must not replace published fallback device defaults with
 * the generator host's defaults. Authored values and fresh schemas stay intact. */
export function retainExistingCanonicalDeviceDefaults(graph, existingGraph) {
  const existingByIdentity = new Map();
  const freshByIdentity = new Map();
  for (const [nodes, index] of [
    [existingGraph?.nodes ?? [], existingByIdentity],
    [graph?.nodes ?? [], freshByIdentity],
  ]) {
    for (const node of nodes) {
      const identity = canonicalDeviceOwnerIdentity(node);
      if (identity !== null) index.set(identity, [...(index.get(identity) ?? []), node]);
    }
  }
  const updates = [];
  for (const [identity, existingNodes] of existingByIdentity) {
    const freshNodes = freshByIdentity.get(identity);
    if (!freshNodes) continue;
    const defaults = existingNodes.flatMap((node) => [
      [node.data.params?.device, 'default'],
      [node.data.operationAuthoring?.defaults, 'device'],
    ]);
    if (!defaults.some(([owner, key]) => owner && Object.hasOwn(owner, key))) continue;
    if (existingNodes.length !== 1 || freshNodes.length !== 1)
      throw new Error('Canonical device defaults require an unambiguous unchanged executable node identity.');
    const existing = existingNodes[0];
    const fresh = freshNodes[0];
    const field = fresh.data.params?.device;
    for (const [previousOwner, key, owner] of [
      [existing.data.params?.device, 'default', field],
      [existing.data.operationAuthoring?.defaults, 'device', fresh.data.operationAuthoring?.defaults],
    ]) {
      if (!previousOwner || !Object.hasOwn(previousOwner, key)) continue;
      const value = previousOwner[key];
      if (!owner || !field || typeof value !== 'string' || !/^(?:cuda|mps|cpu|xpu)(?::\d+)?$/i.test(value))
        throw new Error('An existing canonical device default has no compatible declared destination.');
      const options = Array.isArray(field.options)
        ? field.options.map((option) => (typeof option === 'string' ? option : option?.value))
        : Object.keys(field.options ?? {});
      if (options.length > 0 && !options.includes(value))
        throw new Error('An existing canonical device default is unavailable in the fresh field schema.');
      updates.push([owner, key, value]);
    }
  }
  for (const [owner, key, value] of updates) owner[key] = value;
  return graph;
}

/** Verify the existing declared image-stage contract against the actual saved
 * graph. Reachability and a graph hash do not prove required owner links. */
export function verifyCanonicalImagePipelineStages(workflow, graph, contracts) {
  if (workflow.mediaKind !== 'image') return;
  const nodes = (graph.nodes ?? []).map((node) => ({
    id: node.id,
    nodeKey: `${node.data?.module}.${node.data?.action}`,
    operation: node.data?.operationAuthoring?.operation,
    params: node.data?.params ?? {},
  }));
  const stageKeys = {
    image_encoder: 'modules.DiffusersImage.EncodeInputs',
    denoise: 'modules.DiffusersImage.Denoise',
    decoder: 'modules.DiffusersImage.DecodeLatents',
  };
  const stages = nodes.filter(
    (node) =>
      ['modules.DiffusersImage.EncodeInputs', 'modules.DiffusersImage.Denoise'].includes(node.nodeKey) ||
      (node.operation?.decomposition === 'bundle' &&
        Object.hasOwn(stageKeys, node.operation.nodeType) &&
        node.operation.ports.some(
          (port) => port.direction === 'input' && port.types.includes('image_diffusion_pipeline'),
        )),
  );
  if (stages.length === 0) return;
  const owners = nodes.filter(
    (node) =>
      contracts.operationOwnsModel(node.operation) &&
      node.operation.ports.some(
        (port) => port.direction === 'output' && port.types.includes('image_diffusion_pipeline'),
      ),
  );
  const owner = owners[0];
  const stageIds = new Set(stages.map((node) => node.id));
  const edges = graph.edges ?? [];
  const supplying = edges.filter(
    (edge) =>
      stageIds.has(edge.target) &&
      nodes.find((node) => node.id === edge.target)?.params[edge.targetHandle]?.type === 'image_diffusion_pipeline',
  );
  if (
    owners.length !== 1 ||
    stages.length !== 3 ||
    owner.operation.nodeKey !== owner.nodeKey ||
    owner.operation.task !== workflow.mode ||
    stages.some(
      (node) =>
        !node.operation ||
        node.operation.nodeKey !== node.nodeKey ||
        node.nodeKey !== stageKeys[node.operation.nodeType] ||
        node.operation.task !== workflow.mode,
    ) ||
    new Set(nodes.map((node) => node.id)).size !== nodes.length ||
    supplying.some((edge) => edge.source !== owner.id) ||
    contracts.declaredImagePipelineStageContracts(nodes, owner.id, edges, supplying) === null
  )
    throw new Error(`${workflow.id} is missing its exact declared owned image pipeline stage route.`);
}
