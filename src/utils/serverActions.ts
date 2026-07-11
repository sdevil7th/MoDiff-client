import config from '../../app.config';
import { requestJson, RequestError } from './requestJson';

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
  init: Omit<RequestInit, 'signal'> = {},
  validate?: (payload: T) => void,
) {
  const url = `${config.serverAddress}${path}`;
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
  return serverAction('/stop', 'Could not stop the current execution.', { method: 'GET' });
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

export function deleteHfCacheEntry(hash: string) {
  return serverAction(`/hf_cache/${encodeURIComponent(hash)}`, 'Could not delete the Hugging Face model.', {
    method: 'DELETE',
  });
}
