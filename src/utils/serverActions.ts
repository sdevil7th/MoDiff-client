import config from '../../app.config';
import { requestJson, RequestError, type RequestOptions } from './requestJson';

export type ServerActionResult = Record<string, unknown> & {
  error?: boolean | string;
  message?: string;
};

export type QueueCancellationResult = ServerActionResult & {
  task_id: string;
  current?: unknown;
  queued?: unknown;
};

export type CacheDeletionResult = ServerActionResult & {
  nodes: string[];
};

export type GpuCleanupResult = ServerActionResult & {
  cleanup_errors?: string[];
  released_diffusers_component_count?: number;
  released_diffusers_offload_file_count?: number;
  released_model_count?: number;
  released_node_count?: number;
};

export type MediaCleanupResult = ServerActionResult & {
  removed: { asset_id: string; path: string }[];
  errors: { asset_id: string; path: string; error: string }[];
  remaining: number;
};

export type HfCacheDeletionPlan = ServerActionResult & {
  schemaVersion: 1;
  kind: 'hf_cache_deletion_plan';
  revisionHashes: string[];
  targets: { repoId: string; revision: string; sizeBytes?: number }[];
  canonicalDependencies: { workflowId: string; repoId: string; revision: string; turnoverClosed: boolean }[];
  savedWorkflowDependencies: { workflowId: string; title: string; repoIds: string[] }[];
  dependencyPolicy: 'protect_dependencies' | 'allow_redownload';
  warnings: ({ code: string } & Record<string, unknown>)[];
  blockers: ({ code: string } & Record<string, unknown>)[];
  canDelete: boolean;
  planHash: string;
};

export type HfCacheDeletionResult = ServerActionResult & {
  deleted: boolean;
  plan: HfCacheDeletionPlan;
  runtimeRelease: {
    released: {
      nodes: number;
      models: number;
      diffusers_components: number;
      offload_files: number;
    };
    allocatorTrimmed: boolean;
    errors: string[];
  };
};

export type HfIncompleteCleanupPlan = ServerActionResult & {
  schemaVersion: 1;
  kind: 'hf_incomplete_cleanup_plan';
  files: Array<{
    cacheRoot: string;
    relativePath: string;
    sizeBytes: number;
    modifiedTimeNs: number;
    ageSeconds: number;
    eligible: boolean;
  }>;
  eligibleFileCount: number;
  eligibleBytes: number;
  blockers: ({ code: string } & Record<string, unknown>)[];
  canCleanup: boolean;
  planHash: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseServerAction<T extends ServerActionResult>(value: unknown, url: string, fallbackMessage: string): T {
  if (!isRecord(value)) throw new Error('The server action returned an invalid response.');
  if (value.error) {
    const message =
      typeof value.message === 'string' && value.message.trim()
        ? value.message
        : typeof value.error === 'string' && value.error.trim()
          ? value.error
          : fallbackMessage;
    throw new RequestError(message, { kind: 'application', url, payload: value });
  }
  return value as T;
}

function serverAction<T extends ServerActionResult>(
  path: string,
  fallbackMessage: string,
  init: RequestOptions = {},
  validate?: (payload: T) => void,
  baseAddress = config.serverAddress,
) {
  const url = `${baseAddress}${path}`;
  return requestJson<T>(url, {
    ...init,
    parse: (value) => {
      const payload = parseServerAction<T>(value, url, fallbackMessage);
      validate?.(payload);
      return payload;
    },
  });
}

export function requestExecutionStop() {
  return serverAction(
    '/stop',
    'Could not stop the current execution.',
    { method: 'POST' },
    undefined,
    config.supervisorAddress,
  ).catch(() => serverAction('/stop', 'Could not stop the current execution.', { method: 'POST' }));
}

export function cancelQueuedTask(taskId: string) {
  const encodedTaskId = encodeURIComponent(taskId);
  return serverAction<QueueCancellationResult>(
    `/queue/${encodedTaskId}`,
    'Could not cancel the queued task.',
    { method: 'DELETE' },
    (payload) => {
      if (payload.task_id !== taskId) throw new Error('The queue cancellation response has the wrong task identifier.');
    },
  );
}

export function deleteNodeCache(nodeIds: string[]) {
  const uniqueNodeIds = [...new Set(nodeIds.filter(Boolean))];
  if (uniqueNodeIds.length === 0) return Promise.resolve<CacheDeletionResult>({ error: false, nodes: [] });
  return serverAction<CacheDeletionResult>(
    '/cache',
    'Could not clear the node cache.',
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: uniqueNodeIds }),
    },
    (payload) => {
      if (!Array.isArray(payload.nodes) || payload.nodes.some((node) => typeof node !== 'string')) {
        throw new Error('The cache deletion response has an invalid node list.');
      }
    },
  );
}

export function cleanupGpuMemory() {
  return serverAction<GpuCleanupResult>('/runtime/gpu_cleanup', 'Accelerator cleanup failed.', { method: 'POST' });
}

export function cleanupTemporaryMedia() {
  return serverAction<MediaCleanupResult>(
    '/media_assets',
    'Temporary media cleanup failed.',
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'all_unpinned' }),
    },
    (payload) => {
      if (!Array.isArray(payload.removed) || !Array.isArray(payload.errors)) {
        throw new Error('The temporary media cleanup response is invalid.');
      }
    },
  );
}

export function fetchHfCacheDeletionPlan(hash: string, allowRedownload = false) {
  const query = allowRedownload ? '?allow_redownload=true' : '';
  return serverAction<HfCacheDeletionPlan>(
    `/hf_cache/${encodeURIComponent(hash)}/deletion-plan${query}`,
    'Could not inspect Hugging Face model dependencies.',
    { timeoutMs: 120_000 },
    (payload) => {
      if (
        payload.kind !== 'hf_cache_deletion_plan' ||
        !Array.isArray(payload.targets) ||
        !Array.isArray(payload.warnings) ||
        !Array.isArray(payload.blockers) ||
        typeof payload.canDelete !== 'boolean' ||
        typeof payload.planHash !== 'string'
      ) {
        throw new Error('The Hugging Face deletion plan response is invalid.');
      }
    },
  );
}

export function deleteHfCacheEntry(hash: string, planHash: string, allowRedownload = false) {
  return serverAction<HfCacheDeletionResult>(
    `/hf_cache/${encodeURIComponent(hash)}`,
    'Could not delete the Hugging Face model.',
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(allowRedownload ? { planHash, allowRedownload: true } : { planHash }),
      timeoutMs: 300_000,
    },
    (payload) => {
      const release = payload.runtimeRelease;
      const released = isRecord(release) ? release.released : null;
      const releaseCountKeys = ['nodes', 'models', 'diffusers_components', 'offload_files'] as const;
      const releasedCounts = isRecord(released) ? releaseCountKeys.map((key) => released[key]) : [];
      if (
        payload.deleted !== true ||
        !isRecord(payload.plan) ||
        !isRecord(release) ||
        !isRecord(released) ||
        releasedCounts.length !== 4 ||
        releasedCounts.some((count) => typeof count !== 'number' || !Number.isInteger(count) || count < 0) ||
        typeof release.allocatorTrimmed !== 'boolean' ||
        !Array.isArray(release.errors) ||
        release.errors.some((error) => typeof error !== 'string')
      ) {
        throw new Error('The Hugging Face cache deletion receipt is invalid.');
      }
    },
  );
}

export function fetchHfIncompleteCleanupPlan() {
  return serverAction<HfIncompleteCleanupPlan>(
    '/hf_cache/incomplete-cleanup-plan',
    'Could not inspect stale Hugging Face downloads.',
    { timeoutMs: 120_000 },
    (payload) => {
      if (
        payload.kind !== 'hf_incomplete_cleanup_plan' ||
        !Array.isArray(payload.files) ||
        !Array.isArray(payload.blockers) ||
        typeof payload.canCleanup !== 'boolean' ||
        typeof payload.planHash !== 'string'
      ) {
        throw new Error('The incomplete-download cleanup plan response is invalid.');
      }
    },
  );
}

export function cleanupHfIncompleteFiles(planHash: string) {
  return serverAction('/hf_cache/incomplete-cleanup', 'Could not clean stale Hugging Face downloads.', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planHash }),
    timeoutMs: 300_000,
  });
}
