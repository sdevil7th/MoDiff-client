function paramValue(node, key) {
  return node?.data?.params?.[key]?.value;
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
