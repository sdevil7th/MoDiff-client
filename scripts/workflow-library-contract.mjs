function paramValue(node, key) {
  return node?.data?.params?.[key]?.value;
}

const FORBIDDEN_ATTENTION_BACKENDS = new Set(['aiter', 'aiter_fa2_hub']);

export function workflowNodeAttentionBackendError(node) {
  const attention = node?.data?.params?.attention_backend;
  if (!attention || typeof attention !== 'object') return null;
  const savedOptions = Array.isArray(attention.options)
    ? attention.options.map((option) => (typeof option === 'string' ? option : option?.value))
    : Object.keys(attention.options ?? {});
  const stale = [attention.value, ...savedOptions].filter((value) => FORBIDDEN_ATTENTION_BACKENDS.has(value));
  return stale.length > 0 ? `persists unsupported attention backends: ${[...new Set(stale)].join(', ')}` : null;
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
