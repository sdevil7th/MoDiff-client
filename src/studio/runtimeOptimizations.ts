export type OptimizationCapability = {
  id: string;
  label: string;
  kind: 'package' | 'profile' | 'external' | 'runtime';
  summary: string;
  documentation: string;
  disabledReason?: string | null;
  enabled: boolean;
  canInstall: boolean;
  canEnable: boolean;
};

export type OptimizationCatalog = {
  capabilities: OptimizationCapability[];
};

export type OptimizationReceipt = {
  id: string;
  kind: string;
  status: string;
  capabilityId: string;
  modelType?: string;
  artifact?: string;
};

type JsonRecord = Record<string, unknown>;

export function invalidRuntimeContract(): never {
  throw new Error('Invalid runtime contract.');
}

export function runtimeRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidRuntimeContract();
  return value as JsonRecord;
}

export function runtimeText(value: unknown, pattern?: RegExp, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || (pattern && !pattern.test(value)))
    invalidRuntimeContract();
  return value;
}

function capability(value: unknown) {
  const item = runtimeRecord(value);
  ['id', 'label', 'summary', 'documentation', 'kind'].forEach((key) => runtimeText(item[key]));
  if (!['package', 'profile', 'external', 'runtime'].includes(item.kind as string)) invalidRuntimeContract();
  if (['enabled', 'canInstall', 'canEnable'].some((key) => typeof item[key] !== 'boolean')) invalidRuntimeContract();
  if (item.kind === 'package' && (item.canInstall || item.canEnable)) invalidRuntimeContract();
  if (item.disabledReason != null) runtimeText(item.disabledReason);
  return item as OptimizationCapability;
}

export function parseOptimizationCatalog(value: unknown): OptimizationCatalog {
  const payload = runtimeRecord(value);
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.capabilities)) invalidRuntimeContract();
  const capabilities = payload.capabilities.map(capability);
  if (new Set(capabilities.map((item) => item.id)).size !== capabilities.length) invalidRuntimeContract();
  return { capabilities };
}

function receipt(value: unknown) {
  const item = runtimeRecord(value);
  ['id', 'kind', 'status', 'capabilityId'].forEach((key) => runtimeText(item[key]));
  runtimeText(item.modelType, undefined, true);
  runtimeText(item.artifact, undefined, true);
  return item as OptimizationReceipt;
}

export function parseOptimizationReceipts(value: unknown) {
  const payload = runtimeRecord(value);
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.receipts)) invalidRuntimeContract();
  return { receipts: payload.receipts.map(receipt) };
}

export function parseOptimizationMutationResponse(value: unknown) {
  const payload = runtimeRecord(value);
  if (payload.error !== false) invalidRuntimeContract();
  runtimeText(payload.message, undefined, true);
  return {
    message: payload.message as string | undefined,
  };
}

export function safeOptimizationDocumentationUrl(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
