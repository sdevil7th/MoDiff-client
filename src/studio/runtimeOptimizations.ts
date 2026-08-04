export type OptimizationCapability = {
  id: string;
  label: string;
  kind: 'package' | 'profile' | 'external' | 'runtime';
  summary: string;
  documentation: string;
  compatible: boolean;
  disabledReason?: string | null;
  installed: boolean;
  installedVersion?: string | null;
  enabled: boolean;
  canInstall: boolean;
  canEnable: boolean;
  automaticEligible: boolean;
};

export type OptimizationEnvironment = {
  id: string;
  capabilities: string[];
  active: boolean;
  validation?: { status?: string };
};

export type OptimizationCatalog = {
  schemaVersion: 1;
  state: {
    activeEnvironmentId?: string | null;
    previousEnvironmentId?: string | null;
    enabledCapabilities?: string[];
  };
  capabilities: OptimizationCapability[];
  environments: OptimizationEnvironment[];
  qualification?: { receiptCount?: number; qualifiedCount?: number; observedCount?: number };
};

export type OptimizationJob = {
  id: string;
  capabilityId: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  progress?: { phase?: string; message?: string };
  result?: { environmentId?: string };
  error?: string;
};

export type OptimizationReceipt = {
  id: string;
  kind: string;
  status: string;
  capabilityId: string;
  modelType?: string;
  artifact?: string;
  measurement?: { elapsed_seconds?: number };
};

type JsonRecord = Record<string, unknown>;

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid optimization ${label}.`);
  return value as JsonRecord;
}

function text(value: unknown, label: string, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid optimization ${label}.`);
}

function nullableText(value: unknown, label: string) {
  if (value !== undefined && value !== null) text(value, label);
}

function flag(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`Invalid optimization ${label}.`);
}

function texts(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Invalid optimization ${label}.`);
  }
  return value as string[];
}

function count(value: unknown, label: string) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
    throw new Error(`Invalid optimization ${label}.`);
  }
}

function capability(value: unknown) {
  const item = object(value, 'capability');
  ['id', 'label', 'summary', 'documentation'].forEach((key) => text(item[key], `capability ${key}`));
  text(item.kind, 'capability kind');
  if (!['package', 'profile', 'external', 'runtime'].includes(item.kind as string)) {
    throw new Error('Invalid optimization capability kind.');
  }
  ['compatible', 'installed', 'enabled', 'canInstall', 'canEnable', 'automaticEligible'].forEach((key) =>
    flag(item[key], `capability ${key}`),
  );
  nullableText(item.disabledReason, 'disabled reason');
  nullableText(item.installedVersion, 'installed version');
  return item as OptimizationCapability;
}

function environment(value: unknown) {
  const item = object(value, 'environment');
  text(item.id, 'environment id');
  texts(item.capabilities, 'environment capabilities');
  flag(item.active, 'environment active state');
  if (item.validation !== undefined)
    text(object(item.validation, 'environment validation').status, 'validation status', true);
  return item as OptimizationEnvironment;
}

export function parseOptimizationCatalog(value: unknown): OptimizationCatalog {
  const payload = object(value, 'catalog');
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.capabilities) || !Array.isArray(payload.environments)) {
    throw new Error('Unsupported optimization catalog contract.');
  }
  const state = object(payload.state, 'catalog state');
  nullableText(state.activeEnvironmentId, 'active environment id');
  nullableText(state.previousEnvironmentId, 'previous environment id');
  if (state.enabledCapabilities !== undefined) texts(state.enabledCapabilities, 'enabled capabilities');
  if (payload.qualification !== undefined) {
    const summary = object(payload.qualification, 'qualification summary');
    ['receiptCount', 'qualifiedCount', 'observedCount'].forEach((key) => count(summary[key], key));
  }
  const capabilities = payload.capabilities.map(capability);
  const capabilityIds = new Set(capabilities.map((item) => item.id));
  if (capabilityIds.size !== capabilities.length) throw new Error('Duplicate optimization capability ids.');
  const environments = payload.environments.map(environment);
  if (new Set(environments.map((item) => item.id)).size !== environments.length) {
    throw new Error('Duplicate optimization environment ids.');
  }
  if (environments.some((item) => item.capabilities.some((id) => !capabilityIds.has(id)))) {
    throw new Error('Optimization environment references an unknown capability.');
  }
  return { ...payload, schemaVersion: 1, state, capabilities, environments } as OptimizationCatalog;
}

export function parseOptimizationJob(value: unknown): OptimizationJob {
  const job = object(value, 'job');
  text(job.id, 'job id');
  text(job.capabilityId, 'job capability id');
  text(job.status, 'job status');
  if (!['queued', 'running', 'ready', 'failed'].includes(job.status as string)) {
    throw new Error('Invalid optimization job status.');
  }
  if (job.progress !== undefined) {
    const progress = object(job.progress, 'job progress');
    text(progress.phase, 'job phase', true);
    text(progress.message, 'job message', true);
  }
  if (job.result !== undefined) text(object(job.result, 'job result').environmentId, 'result environment id', true);
  text(job.error, 'job error', true);
  return job as OptimizationJob;
}

export function parseOptimizationJobResponse(value: unknown) {
  const payload = object(value, 'job response');
  if (payload.error !== false) throw new Error('Optimization job request was not successful.');
  return { job: parseOptimizationJob(payload.job) };
}

function receipt(value: unknown) {
  const item = object(value, 'receipt');
  ['id', 'kind', 'status', 'capabilityId'].forEach((key) => text(item[key], `receipt ${key}`));
  text(item.modelType, 'receipt model type', true);
  text(item.artifact, 'receipt artifact', true);
  if (item.measurement !== undefined) {
    const elapsed = object(item.measurement, 'receipt measurement').elapsed_seconds;
    if (elapsed !== undefined && (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0)) {
      throw new Error('Invalid optimization receipt elapsed time.');
    }
  }
  return item as OptimizationReceipt;
}

export function parseOptimizationReceipts(value: unknown) {
  const payload = object(value, 'receipts response');
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.receipts)) {
    throw new Error('Unsupported optimization receipts contract.');
  }
  return { receipts: payload.receipts.map(receipt) };
}

export function parseOptimizationMutationResponse(value: unknown) {
  const payload = object(value, 'action response');
  if (payload.error !== false) throw new Error('Optimization action was not successful.');
  text(payload.message, 'action message', true);
  return {
    message: payload.message as string | undefined,
    job: payload.job === undefined ? undefined : parseOptimizationJob(payload.job),
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
