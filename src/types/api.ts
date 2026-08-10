import type { HfDownloadProgress } from '../stores/useNodeStore';
import type { ImageArtifact } from '../utils/imageArtifacts';
import type { StudioMode, StudioPreviewSlot } from '../studio/types';

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

export type ApiGraphLoopExport = {
  id: string;
  bodyNodeIds: string[];
  iterations: number;
  maxIterations: number;
  inputNodeId?: string;
  indexNodeId?: string;
  itemNodeId?: string;
  resultNodeId: string;
  iterationMode: 'count' | 'collection';
  carry: boolean;
  collect: boolean;
  maxRetries: number;
  parentLoopId?: string;
};

export type ApiGraphRuntimeHints = {
  /**
   * Correlation and workflow fields are attached to every graph submission.
   * Studio-managed runs additionally provide the resource/model fields below.
   */
  source?: 'studio';
  device?: string;
  cudaIndex?: number;
  cudaMemoryFreeBytes?: number;
  cudaMemoryTotalBytes?: number;
  modelFamily?: string;
  modelType?: string;
  mode?: StudioMode;
  modelRepo?: string;
  modelName?: string;
  resolvedModelRepo?: string;
  resolvedArtifact?: string;
  modelDependencies?: JsonObject[];
  executionPath?: string;
  pipelineClass?: string;
  dtype?: string;
  resourceMode?: string;
  resolvedResourceMode?: string;
  quantizationMode?: string;
  quantizedComponents?: string[];
  autoOffload?: boolean;
  offloadMode?: string;
  deviceMap?: string;
  attentionBackend?: string;
  regionalCompile?: boolean;
  denoiserCache?: string;
  channelsLast?: boolean;
  layerwiseCasting?: boolean;
  supportedOffloadModes?: string[];
  offloadDiskPath?: string;
  resourcePlan?: JsonObject;
  autoResourcePlan?: JsonObject;
  autoResourceCandidates?: JsonObject[];
  autoResourceProofStatus?: string;
  autoResourceCandidateId?: string;
  autoFieldOverrides?: JsonObject[];
  optimizationQualificationForm?: JsonObject;
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
  workflowTabId?: string;
  workflowCanvasEpoch?: number;
  workflowTitle?: string;
  workflowSnapshot?: JsonObject;
  nodeId?: string;
  maxRuntimeSeconds?: number;
};

export type ApiGraphExport = {
  sid: string;
  nodes: Record<string, ApiNodeExport>;
  paths: string[][];
  loops?: ApiGraphLoopExport[];
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
  current_step?: number | null;
  total_steps?: number | null;
  component?: string | null;
  shard_current?: number | null;
  shard_total?: number | null;
  elapsed_seconds?: number;
  average_step_seconds?: number | null;
  eta_seconds?: number | null;
  updated_at?: number;
  last_heartbeat_at?: number;
  resource_snapshot?: JsonObject | null;
  phase_timings?: Record<string, number>;
  task_id?: string;
  client_run_id?: string;
  run_input_hash?: string;
  workflow_tab_id?: string;
  workflow_canvas_epoch?: number;
  node_id?: string;
  output_id?: string;
  backend_persisted?: boolean;
  preview_slot?: StudioPreviewSlot;
  preview_state_revision?: number;
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
  workflow_tab_id?: string;
  workflow_canvas_epoch?: number;
  node_id?: string;
  attempt_index?: number;
  queued_at?: number;
  started_at?: number;
  completed_at?: number;
  updated_at?: number;
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  current_node?: string;
  current_node_name?: string;
  node_progress?: number;
  phase?: string;
  current_step?: number | null;
  total_steps?: number | null;
  component?: string | null;
  shard_current?: number | null;
  shard_total?: number | null;
  eta_seconds?: number | null;
  average_step_seconds?: number | null;
  elapsed_seconds?: number | null;
  last_heartbeat_at?: number;
  resource_snapshot?: JsonObject | null;
  phase_timings?: Record<string, number>;
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
  preview_slots?: StudioPreviewSlot[];
  preview_state_revision?: number;
};

export type FieldWebsocketMessage = BaseWebsocketMessage<
  'set_field_visibility' | 'set_field_value' | 'set_field_params'
> & {
  node?: string;
  field?: string;
  fields?: Record<string, unknown>;
  params?: Record<string, unknown>;
  task_id?: string;
  client_run_id?: string;
  run_input_hash?: string;
  workflow_tab_id?: string;
  workflow_canvas_epoch?: number;
  attempt_index?: number;
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
  action?: {
    type: 'open_task_run';
    taskId: string;
    clientRunId?: string | null;
    workflowTabId?: string | null;
    nodeId?: string | null;
    outcome: 'completed' | 'failed';
  };
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

export type AutoResourceWebsocketMessage = BaseWebsocketMessage<
  'auto_resource_plan_applied' | 'auto_resource_cleanup' | 'auto_retry_requires_approval'
> & {
  task_id?: string | null;
  client_run_id?: string;
  run_input_hash?: string;
  workflow_tab_id?: string;
  workflow_canvas_epoch?: number;
  node_id?: string;
  node?: string | null;
  attempt?: number;
  attempt_index?: number;
  candidateId?: string;
  message?: string;
  updatedNodes?: string[];
  retryPlans?: JsonObject[];
  performed?: boolean;
  reasons?: string[];
  incomingModelFamily?: string | null;
  previousModelFamily?: string | null;
  residentRecipeReusable?: boolean;
  resourceRecipeChanged?: boolean;
  availableRamBytes?: number | null;
  availableVramBytes?: number | null;
  cleanup?: JsonObject | null;
};

export type RuntimeLoaderReusedWebsocketMessage = BaseWebsocketMessage<'runtime_loader_reused'> & {
  task_id?: string | null;
  client_run_id?: string;
  run_input_hash?: string;
  workflow_tab_id?: string;
  node_id?: string;
  node?: string;
  previous_node?: string;
  module?: string;
  action?: string;
  message?: string;
};

export type ErrorWebsocketMessage = BaseWebsocketMessage<'error'> & {
  error?: string;
  message?: string;
};

export type WorkflowWebsocketMessage = BaseWebsocketMessage<'workflow_updated' | 'workflow_deleted'> & {
  workflow?: JsonObject;
  workflow_id?: string;
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
  | AutoResourceWebsocketMessage
  | RuntimeLoaderReusedWebsocketMessage
  | WorkflowWebsocketMessage
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
  'auto_resource_plan_applied',
  'auto_resource_cleanup',
  'auto_retry_requires_approval',
  'runtime_loader_reused',
  'error',
  'hf_cache_update',
  'local_cache_update',
  'workflow_updated',
  'workflow_deleted',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isBoundedRecord(value: unknown, valueIsValid: (item: unknown) => boolean = () => true) {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 256 && entries.every(([key, item]) => key.length > 0 && key.length <= 256 && valueIsValid(item))
  );
}

function optionalField(
  value: Record<string, unknown>,
  key: string,
  predicate: (field: unknown) => boolean,
  nullable = false,
) {
  const field = value[key];
  return field === undefined || (nullable && field === null) || predicate(field);
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRecordArray(value: unknown) {
  return Array.isArray(value) && value.every(isRecord);
}

function isTaskRecord(value: unknown) {
  return isRecord(value);
}

function isTaskRecordMap(value: unknown) {
  return isRecord(value) && Object.values(value).every(isTaskRecord);
}

function isNumericRecord(value: unknown) {
  return isRecord(value) && Object.values(value).every(isFiniteNumber);
}

function isNotificationAction(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    value.type === 'open_task_run' &&
    typeof value.taskId === 'string' &&
    (value.outcome === 'completed' || value.outcome === 'failed') &&
    ['clientRunId', 'workflowTabId', 'nodeId'].every((key) =>
      optionalField(value, key, (field) => typeof field === 'string', true),
    )
  );
}

function hasValidCommonWebsocketFields(value: Record<string, unknown>) {
  const strings = [
    'task_id',
    'client_run_id',
    'run_input_hash',
    'workflow_tab_id',
    'node_id',
    'node',
    'node_name',
    'current_node',
    'current_node_name',
    'component',
    'phase',
    'message',
    'name',
    'error',
  ];
  const numbers = [
    'overall_progress',
    'node_progress',
    'attempt',
    'attempt_index',
    'current_step',
    'total_steps',
    'shard_current',
    'shard_total',
    'average_step_seconds',
    'elapsed_seconds',
    'updated_at',
    'last_heartbeat_at',
    'queued_at',
    'started_at',
    'completed_at',
    'workflow_canvas_epoch',
  ];
  const booleans = ['backend_persisted', 'hasChanged', 'oom', 'persist', 'performed'];
  return (
    optionalField(value, 'sid', (field) => typeof field === 'string', true) &&
    strings.every((key) =>
      optionalField(
        value,
        key,
        (field) => typeof field === 'string',
        key === 'node' || key === 'task_id' || key === 'error' || key === 'component',
      ),
    ) &&
    numbers.every((key) =>
      optionalField(
        value,
        key,
        isFiniteNumber,
        [
          'average_step_seconds',
          'completed_at',
          'current_step',
          'elapsed_seconds',
          'eta_seconds',
          'shard_current',
          'shard_total',
          'total_steps',
        ].includes(key),
      ),
    ) &&
    optionalField(value, 'progress', isFiniteNumber, value.type === 'hf_download_progress') &&
    optionalField(value, 'eta_seconds', isFiniteNumber, true) &&
    booleans.every((key) => optionalField(value, key, (field) => typeof field === 'boolean')) &&
    optionalField(value, 'current', isTaskRecord, true) &&
    optionalField(value, 'queued', isTaskRecordMap) &&
    optionalField(value, 'recent', isRecordArray) &&
    optionalField(value, 'updatedNodes', isStringArray) &&
    optionalField(value, 'retryPlans', isRecordArray) &&
    optionalField(value, 'reasons', isStringArray) &&
    optionalField(value, 'cachedNodes', isStringArray) &&
    optionalField(value, 'active_files', isStringArray) &&
    optionalField(value, 'args', Array.isArray) &&
    optionalField(value, 'artifacts', isRecordArray) &&
    optionalField(value, 'data_type', (field) => typeof field === 'string' || isStringArray(field)) &&
    optionalField(value, 'fields', isRecord) &&
    optionalField(value, 'params', isRecord) &&
    optionalField(
      value,
      'style',
      (field) => isRecord(field) && optionalField(field, 'headerColor', (color) => typeof color === 'string'),
    ) &&
    optionalField(value, 'memoryUsage', isNumericRecord) &&
    optionalField(value, 'resource_snapshot', isRecord, true) &&
    optionalField(value, 'phase_timings', isNumericRecord) &&
    optionalField(
      value,
      'workflow_canvas_epoch',
      (field) => typeof field === 'number' && Number.isSafeInteger(field) && field >= 0,
    )
  );
}

export function isWebsocketMessage(value: unknown): value is WebsocketMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  const type = value.type as WebsocketMessage['type'];
  if (!websocketMessageTypes.has(type) || !hasValidCommonWebsocketFields(value)) return false;

  switch (type) {
    case 'welcome':
      return optionalField(value, 'instance', (field) => typeof field === 'string');
    case 'executed':
    case 'node_error':
    case 'progress':
      return (
        typeof value.node === 'string' &&
        value.node.length > 0 &&
        optionalField(value, 'progress', isFiniteNumber) &&
        optionalField(value, 'executionTime', isNumericRecord)
      );
    case 'update_value':
      return typeof value.node === 'string' && typeof value.key === 'string';
    case 'node_definition':
      return typeof value.node === 'string' && isBoundedRecord(value.params, isRecord);
    case 'task_queued':
    case 'task_started':
      return typeof value.task_id === 'string' && (value.current !== undefined || value.queued !== undefined);
    case 'task_cancelled':
    case 'task_completed':
    case 'task_failed':
      return typeof value.task_id === 'string';
    case 'task_progress':
      return typeof value.task_id === 'string' && isFiniteNumber(value.progress);
    case 'set_field_visibility':
      return typeof value.node === 'string' && isBoundedRecord(value.fields, (field) => typeof field === 'boolean');
    case 'set_field_value':
      return typeof value.node === 'string' && isBoundedRecord(value.fields);
    case 'set_field_params':
      return typeof value.node === 'string' && typeof value.field === 'string' && isBoundedRecord(value.params);
    case 'hf_download_progress':
      return (
        typeof value.repo_id === 'string' &&
        [
          'progress',
          'downloaded_bytes',
          'completed_bytes',
          'total_bytes',
          'remaining_bytes',
          'bytes_per_second',
          'eta_seconds',
          'file_count',
          'total_file_count',
          'completed_file_count',
        ].every((key) => optionalField(value, key, isFiniteNumber, true)) &&
        optionalField(value, 'size_known', (field) => typeof field === 'boolean')
      );
    case 'get_signal_value':
      return (
        typeof value.node === 'string' &&
        typeof value.field === 'string' &&
        typeof value.request_id === 'string' &&
        typeof value.sid === 'string'
      );
    case 'notification':
      return (
        typeof value.message === 'string' &&
        optionalField(value, 'variant', (field) =>
          ['default', 'error', 'success', 'warning', 'info'].includes(String(field)),
        ) &&
        optionalField(value, 'autoHideDuration', isFiniteNumber) &&
        optionalField(value, 'action', isNotificationAction)
      );
    case 'workflow_updated':
      return isRecord(value.workflow);
    case 'workflow_deleted':
      return typeof value.workflow_id === 'string';
    case 'auto_resource_plan_applied':
      return optionalField(value, 'candidateId', (field) => typeof field === 'string');
    case 'auto_retry_requires_approval':
      return typeof value.message === 'string' && isRecordArray(value.retryPlans);
    case 'runtime_loader_reused':
      return (
        typeof value.node === 'string' &&
        typeof value.previous_node === 'string' &&
        typeof value.module === 'string' &&
        typeof value.action === 'string'
      );
    case 'auto_resource_cleanup':
      return (
        ['residentRecipeReusable', 'resourceRecipeChanged'].every((key) =>
          optionalField(value, key, (field) => typeof field === 'boolean'),
        ) &&
        ['availableRamBytes', 'availableVramBytes'].every((key) => optionalField(value, key, isFiniteNumber, true)) &&
        ['incomingModelFamily', 'previousModelFamily'].every((key) =>
          optionalField(value, key, (field) => typeof field === 'string', true),
        ) &&
        optionalField(value, 'cleanup', isRecord, true)
      );
    case 'graph_completed':
      return optionalField(value, 'executionTime', isFiniteNumber);
    case 'deterministic_execution':
    case 'resource_retry':
    case 'resource_retry_cleanup':
    case 'hf_cache_update':
    case 'local_cache_update':
      return true;
    case 'error':
      return typeof value.error === 'string' || typeof value.message === 'string';
  }
}
