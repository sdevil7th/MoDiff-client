import type { HfDownloadProgress } from '../stores/useNodeStore';
import type { ImageArtifact } from '../utils/imageArtifacts';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type NodeParamValue = JsonValue | File | Blob | undefined;

export type ApiGraphParamExport = {
  sourceId?: string;
  sourceKey?: string;
  value?: NodeParamValue;
  display?: string | string[];
  spawn?: boolean;
};

export type ApiNodeExport = {
  module: string;
  action: string;
  params: Record<string, ApiGraphParamExport>;
};

export type ApiGraphRuntimeHints = {
  source: 'studio';
  device: string;
  cudaIndex?: number;
  cudaMemoryFreeBytes?: number;
  cudaMemoryTotalBytes?: number;
  modelFamily?: string;
  modelType?: string;
  modelRepo?: string;
  modelName?: string;
  resolvedModelRepo?: string;
  resolvedArtifact?: string;
  executionPath?: string;
  pipelineClass?: string;
  dtype?: string;
  resourceMode?: string;
  resolvedResourceMode?: string;
  quantizationMode?: string;
  quantizedComponents?: string[];
  autoOffload?: boolean;
  offloadMode?: string;
  supportedOffloadModes?: string[];
  offloadDiskPath?: string;
  resourcePlan?: JsonObject;
  autoResourcePlan?: JsonObject;
  autoResourceCandidates?: JsonObject[];
  autoResourceProofStatus?: string;
  autoResourceCandidateId?: string;
  resourceRetryModes?: string[];
  resourceRetryPlans?: JsonObject[];
  compatibilityProbe?: JsonObject;
  compatibilityStatus?: string;
  lowVramMode?: boolean;
  cudaBudgetPolicy?: string;
  enforceCudaBudget?: boolean;
  requestedCudaReserveBytes?: number;
  requestedCudaBudgetBytes?: number;
  clientRunId?: string;
  runInputHash?: string;
};

export type ApiGraphExport = {
  sid: string;
  nodes: Record<string, ApiNodeExport>;
  paths: string[][];
  runtimeHints?: ApiGraphRuntimeHints;
  deterministicMode?: {
    enabled: boolean;
    strict: boolean;
    seed?: number;
    templateId?: string;
    templateLockHash?: string;
    promptSettingsHash?: string;
  };
  provenance?: JsonObject;
};

export type GraphRunResponse = {
  error?: boolean;
  message?: string;
  sid?: string | null;
  task_id?: string | null;
  [key: string]: unknown;
};

export type TaskSnapshot = Record<string, unknown>;

type BaseWebsocketMessage<T extends string> = {
  type: T;
  sid?: string | null;
};

export type WelcomeWebsocketMessage = BaseWebsocketMessage<'welcome'> & {
  instance?: string;
  cachedNodes?: string[];
  current?: TaskSnapshot | null;
  queued?: Record<string, TaskSnapshot>;
  recent?: TaskSnapshot[];
};

export type NodeWebsocketMessage = BaseWebsocketMessage<
  'executed' | 'node_error' | 'progress' | 'update_value' | 'node_definition'
> & {
  node?: string;
  key?: string;
  data_type?: string | string[];
  value?: unknown;
  artifacts?: ImageArtifact[];
  progress?: number;
  overall_progress?: number;
  current_step?: number;
  total_steps?: number;
  elapsed_seconds?: number;
  average_step_seconds?: number;
  eta_seconds?: number;
  updated_at?: number;
  task_id?: string;
  client_run_id?: string;
  run_input_hash?: string;
  attempt_index?: number;
  status?: 'queued' | 'running' | 'completed' | 'cached' | 'failed' | 'cancelled' | 'succeeded';
  phase?: 'loading' | 'encoding' | 'denoising' | 'decoding' | 'saving' | 'previewing' | 'unknown' | string;
  current_node?: string;
  runtimeFingerprint?: unknown;
  params?: Record<string, Record<string, unknown>>;
  definition?: unknown;
  label?: string;
  style?: { headerColor?: string };
  hasChanged?: boolean;
  memoryUsage?: Record<string, number>;
  executionTime?: Record<string, number>;
  message?: string;
  error?: string;
};

export type TaskWebsocketMessage = BaseWebsocketMessage<
  'task_queued' | 'task_cancelled' | 'task_started' | 'task_completed' | 'task_failed' | 'task_progress'
> & {
  task_id?: string;
  client_run_id?: string;
  run_input_hash?: string;
  attempt_index?: number;
  current?: TaskSnapshot | null;
  queued?: Record<string, TaskSnapshot>;
  args?: unknown[];
  node?: string;
  node_name?: string;
  name?: string;
  progress?: number;
  message?: string;
  error?: string;
  exception_type?: string | null;
  traceback?: string | null;
  category?: string | null;
  error_code?: string | null;
  recovery_hint?: string | null;
  oom?: boolean;
  memory_summary?: string | null;
  cuda_memory_snapshot?: JsonObject | null;
  gpu_processes?: JsonObject | null;
  runtime_hints?: JsonObject | null;
  runtime_budget?: JsonObject | null;
  loader_diagnostics?: JsonObject | null;
  recent?: TaskSnapshot[];
};

export type FieldWebsocketMessage = BaseWebsocketMessage<
  'set_field_visibility' | 'set_field_value' | 'set_field_params'
> & {
  node?: string;
  field?: string;
  fields?: Record<string, unknown>;
  params?: Record<string, unknown>;
};

export type HfDownloadProgressWebsocketMessage = HfDownloadProgress & BaseWebsocketMessage<'hf_download_progress'>;

export type SignalValueWebsocketMessage = BaseWebsocketMessage<'get_signal_value'> & {
  node?: string;
  field?: string;
  request_id?: string;
};

export type NotificationWebsocketMessage = BaseWebsocketMessage<'notification'> & {
  message?: string;
  variant?: 'default' | 'error' | 'success' | 'warning' | 'info';
  persist?: boolean;
  autoHideDuration?: number;
};

export type GraphCompletedWebsocketMessage = BaseWebsocketMessage<'graph_completed'> & {
  task_id?: string | null;
  client_run_id?: string;
  run_input_hash?: string;
  executionTime?: number;
  runtimeFingerprint?: unknown;
  deterministicMode?: unknown;
  runtimeHints?: unknown;
  runtimeBudget?: unknown;
};

export type DeterministicExecutionWebsocketMessage = BaseWebsocketMessage<'deterministic_execution'> & {
  task_id?: string | null;
  deterministicMode?: unknown;
  runtimeFingerprint?: unknown;
};

export type ResourceRetryWebsocketMessage = BaseWebsocketMessage<'resource_retry' | 'resource_retry_cleanup'> & {
  task_id?: string | null;
  attempt?: number;
  offloadMode?: string;
  message?: string;
  updatedNodes?: string[];
  history?: unknown;
  released?: unknown;
  errors?: unknown;
};

export type ErrorWebsocketMessage = BaseWebsocketMessage<'error'> & {
  error?: string;
  message?: string;
};

export type WebsocketMessage =
  | WelcomeWebsocketMessage
  | NodeWebsocketMessage
  | TaskWebsocketMessage
  | FieldWebsocketMessage
  | HfDownloadProgressWebsocketMessage
  | SignalValueWebsocketMessage
  | NotificationWebsocketMessage
  | GraphCompletedWebsocketMessage
  | DeterministicExecutionWebsocketMessage
  | ResourceRetryWebsocketMessage
  | ErrorWebsocketMessage
  | BaseWebsocketMessage<'hf_cache_update' | 'local_cache_update'>;

const websocketMessageTypes = new Set<WebsocketMessage['type']>([
  'welcome',
  'executed',
  'node_error',
  'progress',
  'update_value',
  'node_definition',
  'task_queued',
  'task_cancelled',
  'task_started',
  'task_completed',
  'task_failed',
  'task_progress',
  'set_field_visibility',
  'set_field_value',
  'set_field_params',
  'hf_download_progress',
  'get_signal_value',
  'notification',
  'graph_completed',
  'deterministic_execution',
  'resource_retry',
  'resource_retry_cleanup',
  'error',
  'hf_cache_update',
  'local_cache_update',
]);

export function isWebsocketMessage(value: unknown): value is WebsocketMessage {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string' &&
    websocketMessageTypes.has((value as { type: WebsocketMessage['type'] }).type),
  );
}
