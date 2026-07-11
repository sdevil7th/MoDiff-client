import { create } from 'zustand';
import config from '../../app.config';
import {
  compactHfDownloadFailureLabel,
  formatDownloadBytes,
  formatDownloadDuration,
  hasHfDownloadFailed,
  isHfDownloadActive,
  isHfDownloadComplete,
} from '../studio/modelInstall';
import type { RunReadinessIssue, StudioModelProfile } from '../studio/types';
import type { ModiffFieldStyle, ModiffNodeStyle } from '../theme';
import { enqueueSnackbar } from '../ui/snackbar';
import type { ImageArtifact } from '../utils/imageArtifacts';
import { createLatestRequestGate, formatRequestError, requestJson, RequestError } from '../utils/requestJson';

export type NodeParamOptions = unknown[] | Record<string, unknown>;
export type NodeParamSignal = { direction: 'input' | 'output'; origin?: string; value: unknown };
export type NodeExecutionStatus = 'queued' | 'running' | 'completed' | 'cached' | 'failed' | 'cancelled' | 'succeeded';

export type NodeData = {
  type: 'custom' | 'any' | 'group';
  module: string;
  action: string;
  label: string;
  category: string;
  params: Record<string, NodeParams>;
  description?: string;
  style?: ModiffNodeStyle;
  resizable?: boolean;
  executionTime?: Record<string, number>;
  memoryUsage?: Record<string, number>;
  isCached?: boolean;
  progress?: number;
  activeTaskId?: string | null;
  attemptIndex?: number;
  executionStatus?: NodeExecutionStatus;
  executionPhase?: string;
  progressMessage?: string;
  minimized?: boolean;
  headerColor?: string;
  uiState?: {
    collapsed?: boolean;
    disabled?: boolean;
    validationSeverity?: RunReadinessIssue['severity'];
    validationMessage?: string;
    errorMessage?: string;
    recentChangeLabel?: string;
    recentChangeAt?: number;
  };
  studioRole?: string;
  studioOwned?: boolean;
  studioAuxiliary?: boolean;
  userBlockId?: string;
};

export type NodeParams = {
  type?: string | string[];
  display?: string;
  label?: string;
  value?: unknown;
  default?: unknown;
  description?: string;
  disabled?: boolean;
  hidden?: boolean;
  isInput?: boolean;
  isConnected?: boolean;
  spawn?: boolean;
  options?: NodeParamOptions;
  optionsSource?: Record<string, unknown>;
  min?: number;
  max?: number;
  step?: number;
  onChange?: unknown;
  onSignal?: unknown;
  signal?: NodeParamSignal;
  dataSource?: string;
  fieldOptions?: Record<string, unknown>;
  artifacts?: ImageArtifact[];
  style?: ModiffFieldStyle;
};

export type ModelCacheLocation = {
  label: string;
  path: string | null;
  exists: boolean;
  repo_count?: number;
  file_count?: number;
  directory_count?: number;
  scanned_entries?: number;
  truncated?: boolean;
  extension_counts?: Record<string, number>;
  total_file_bytes?: number;
  model_file_bytes?: number;
  compatible_hf_repo_count?: number;
  external_package_count?: number;
  sample_model_files?: string[];
  error?: string | null;
  runnable?: boolean;
  reason?: string;
};

export type ExternalModelPackage = {
  source: string;
  label: string;
  path: string;
  format: string;
  runnable: boolean;
  reason: string;
  file_count?: number;
  directory_count?: number;
  total_file_bytes?: number;
  model_file_bytes?: number;
  extension_counts?: Record<string, number>;
  sample_model_files?: string[];
  class_names?: string[];
};

export type HfCompatibleExternalRepo = {
  source: string;
  repo_id: string;
  path: string;
  runnable: boolean;
  reason: string;
};

export type ModelCacheDiagnostics = {
  configured_hf_cache_dir?: string | null;
  default_hf_cache_dir?: string | null;
  environment_hf_cache_candidates?: Array<{ label: string; path: string | null }>;
  appdata_hf_cache_candidates?: Array<{ label: string; path: string | null; exists: boolean }>;
  discovered_appdata_hf_cache_roots?: Array<{ label: string; path: string | null }>;
  locations: ModelCacheLocation[];
  external_model_packages?: ExternalModelPackage[];
  hf_compatible_external_repos?: HfCompatibleExternalRepo[];
};

export type HfDownloadProgress = {
  type?: string;
  repo_id: string;
  task_id?: string;
  download_id?: string;
  progress?: number;
  status?: string;
  phase?: string;
  path?: string;
  cache_dir?: string;
  downloaded_bytes?: number;
  completed_bytes?: number;
  total_bytes?: number;
  remaining_bytes?: number;
  bytes_per_second?: number;
  file_count?: number;
  total_file_count?: number;
  completed_file_count?: number;
  current_file?: string;
  active_files?: string[];
  eta_seconds?: number;
  started_at?: number;
  updated_at?: number;
  completed_at?: number | null;
  size_known?: boolean;
  plan_error?: string;
  error?: string;
};

export type HfInstallResult = {
  error?: boolean | string;
  message?: string;
  result?: unknown;
  task_id?: string;
  repo_id?: string;
};

export type CustomModuleInfo = {
  name: string;
  moduleKey: string;
  source: 'custom';
  enabled: boolean;
  status: 'enabled' | 'disabled';
  path: string;
  hasInit: boolean;
  hasMain: boolean;
  nodeCount: number;
  nodes: string[];
  hasGit: boolean;
  canUpdate: boolean;
  canDisable: boolean;
  canEnable: boolean;
  remote?: string;
  branch?: string;
  commit?: string;
};

export type CustomModuleActionResult = {
  error?: boolean | string;
  message?: string;
  module?: CustomModuleInfo | null;
  modules?: CustomModuleInfo[];
  instance?: string;
  git?: {
    returncode?: number;
    stdout?: string;
    stderr?: string;
  };
  removedCacheNodes?: string[];
};

export type RuntimeCudaDevice = {
  index?: number;
  name?: string;
  total_memory?: number;
  memory_free_bytes?: number;
  memory_total_bytes?: number;
  properties_error?: string;
  memory_error?: string;
};

export type RuntimeMpsDevice = {
  index?: number;
  name?: string;
  total_memory?: number;
};

export type RuntimePackageStatus = {
  available?: boolean;
  version?: string;
  error?: string;
  cuda_available?: boolean;
  cuda_device_count?: number;
  cuda_device_name?: string;
  cuda_device_total_memory?: number;
  cuda_memory_free_bytes?: number;
  cuda_memory_total_bytes?: number;
  cuda_devices?: RuntimeCudaDevice[];
  cuda_error?: string;
  mps_built?: boolean;
  mps_available?: boolean;
  mps_device_count?: number;
  mps_devices?: RuntimeMpsDevice[];
  mps_error?: string;
};

export type RuntimeStatus = {
  ready?: boolean;
  server?: {
    host?: string;
    port?: number;
    scheme?: string;
    data_dir?: string;
    work_dir?: string;
  };
  python?: {
    version?: string;
    executable?: string;
    platform?: string;
  };
  config?: {
    hf_cache_dir?: string | null;
    hf_online_status?: string;
    hf_token_configured?: boolean;
    pytorch_cuda_alloc_conf?: string | null;
  };
  packages?: Record<string, RuntimePackageStatus>;
  missing_required_packages?: string[];
  queue?: {
    queued_count?: number;
    main_queue_size?: number;
    background_queue_size?: number;
    interrupt_requested?: boolean;
  };
};

type NodesStore = {
  nodesRegistry: Record<string, NodeData>;
  isLoading: boolean;
  instance: string;
  error: string | null;
  hfCache: unknown[];
  localModels: unknown[];
  modelCacheDiagnostics: ModelCacheDiagnostics | null;
  studioModelCapabilities: StudioModelProfile[];
  runtimeStatus: RuntimeStatus | null;
  runtimeError: string | null;
  hfDownloadProgress: Record<string, HfDownloadProgress>;
  customModules: CustomModuleInfo[];
  customModuleError: string | null;
  discoveryRequests: Record<DiscoveryRequestKey, DiscoveryRequestState>;
  setHfDownloadProgress: (progress: HfDownloadProgress) => void;
  clearHfDownloadProgress: (repoId: string) => void;
  refreshModelIndexes: (refresh?: boolean) => Promise<void>;
  installHfModel: (repoId: string, sid?: string | null, options?: { repair?: boolean }) => Promise<HfInstallResult>;
  fetchCustomModules: () => Promise<void>;
  refreshCustomModules: () => Promise<CustomModuleActionResult>;
  installCustomModule: (source: string, name?: string) => Promise<CustomModuleActionResult>;
  updateCustomModule: (name: string) => Promise<CustomModuleActionResult>;
  setCustomModuleEnabled: (name: string, enabled: boolean) => Promise<CustomModuleActionResult>;
  fetchRuntimeStatus: () => Promise<void>;
  fetchNodes: () => Promise<void>;
  fetchHfCache: (refresh?: boolean) => Promise<void>;
  fetchLocalModels: (refresh?: boolean) => Promise<void>;
  fetchModelCacheDiagnostics: (refresh?: boolean) => Promise<void>;
  fetchStudioModelCapabilities: () => Promise<void>;
  fetchRegistry: () => Promise<void>;
};

export type DiscoveryRequestKey =
  'capabilities' | 'customModules' | 'hfCache' | 'localModels' | 'modelCache' | 'nodes' | 'runtime';

export type DiscoveryRequestState = {
  status: 'error' | 'idle' | 'loading' | 'success';
  error: string | null;
  requestId: number | null;
};

type NodesStoreSet = (partial: Partial<NodesStore> | ((state: NodesStore) => Partial<NodesStore>)) => void;
type NodesStoreGet = () => NodesStore;

const inFlightHfInstalls = new Map<string, Promise<HfInstallResult>>();
const discoveryRequestGate = createLatestRequestGate<DiscoveryRequestKey>();
const CUSTOM_MODULE_TIMEOUT_MS = 16 * 60 * 1000;
const HF_DOWNLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function initialDiscoveryRequests(): Record<DiscoveryRequestKey, DiscoveryRequestState> {
  return {
    capabilities: { status: 'idle', error: null, requestId: null },
    customModules: { status: 'idle', error: null, requestId: null },
    hfCache: { status: 'idle', error: null, requestId: null },
    localModels: { status: 'idle', error: null, requestId: null },
    modelCache: { status: 'idle', error: null, requestId: null },
    nodes: { status: 'idle', error: null, requestId: null },
    runtime: { status: 'idle', error: null, requestId: null },
  };
}

function requestStatePatch(
  state: NodesStore,
  key: DiscoveryRequestKey,
  request: DiscoveryRequestState,
): Pick<NodesStore, 'discoveryRequests' | 'isLoading'> {
  const discoveryRequests = { ...state.discoveryRequests, [key]: request };
  return {
    discoveryRequests,
    isLoading: Object.values(discoveryRequests).some((item) => item.status === 'loading'),
  };
}

async function runDiscoveryRequest<T>(
  key: DiscoveryRequestKey,
  set: NodesStoreSet,
  request: (signal: AbortSignal) => Promise<T>,
  onSuccess: (data: T, state: NodesStore) => Partial<NodesStore>,
  onError: (message: string, state: NodesStore) => Partial<NodesStore>,
  networkFallback: string,
) {
  const ticket = discoveryRequestGate.begin(key);
  set((state) =>
    requestStatePatch(state, key, {
      status: 'loading',
      error: null,
      requestId: ticket.id,
    }),
  );

  try {
    const data = await request(ticket.signal);
    if (!ticket.isLatest()) return;
    set((state) => ({
      ...onSuccess(data, state),
      ...requestStatePatch(state, key, {
        status: 'success',
        error: null,
        requestId: ticket.id,
      }),
    }));
  } catch (error) {
    if (!ticket.isLatest()) return;
    const message =
      error instanceof RequestError && error.kind === 'network'
        ? networkFallback
        : formatRequestError(error, networkFallback);
    set((state) => ({
      ...onError(message, state),
      ...requestStatePatch(state, key, {
        status: 'error',
        error: message,
        requestId: ticket.id,
      }),
    }));
  } finally {
    ticket.finish();
  }
}

function notifyHfDownloadTransition(previous: HfDownloadProgress | undefined, next: HfDownloadProgress) {
  const previousActive = isHfDownloadActive(previous);
  const nextActive = isHfDownloadActive(next);
  const title = next.repo_id || 'Hugging Face model';

  if (nextActive && !previousActive && !isHfDownloadComplete(previous)) {
    enqueueSnackbar(`Installing ${title}...`, {
      key: `hf-download-start-${next.download_id ?? next.task_id ?? title}`,
      variant: 'info',
      autoHideDuration: 2600,
    });
    return;
  }

  if (isHfDownloadComplete(next) && !isHfDownloadComplete(previous)) {
    const total = next.total_bytes ? ` | ${formatDownloadBytes(next.total_bytes)}` : '';
    const duration = formatDownloadDuration(next.started_at, next.completed_at ?? undefined);
    enqueueSnackbar(`${title} installed${duration ? ` in ${duration}` : ''}${total}`, {
      key: `hf-download-complete-${next.download_id ?? next.task_id ?? title}`,
      variant: 'success',
      autoHideDuration: 5200,
    });
    return;
  }

  if (hasHfDownloadFailed(next) && !hasHfDownloadFailed(previous)) {
    enqueueSnackbar(`${compactHfDownloadFailureLabel(next)}: ${title}`, {
      key: `hf-download-error-${next.download_id ?? next.task_id ?? title}`,
      variant: 'error',
      autoHideDuration: 9000,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function payloadRecord(value: unknown, fallbackMessage: string) {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  if (value.error) {
    throw new Error(
      typeof value.message === 'string'
        ? value.message
        : typeof value.error === 'string'
          ? value.error
          : fallbackMessage,
    );
  }
  return value;
}

function parseNodesResponse(value: unknown) {
  const payload = payloadRecord(value, 'The node registry response is invalid.');
  if (!isRecord(payload.nodes)) throw new Error('The node registry response has no nodes object.');
  Object.entries(payload.nodes).forEach(([key, definition]) => {
    if (
      !isRecord(definition) ||
      typeof definition.module !== 'string' ||
      typeof definition.action !== 'string' ||
      !isRecord(definition.params)
    ) {
      throw new Error(`Node definition ${key} is invalid.`);
    }
  });
  return {
    nodes: payload.nodes as unknown as Record<string, NodeData>,
    instance: typeof payload.instance === 'string' ? payload.instance : '',
  };
}

function parseArrayResponse(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} response must be an array.`);
  return value;
}

function parseRuntimeStatus(value: unknown) {
  return payloadRecord(value, 'The runtime status response is invalid.') as RuntimeStatus;
}

function parseModelCacheDiagnostics(value: unknown) {
  const payload = payloadRecord(value, 'The model-cache diagnostics response is invalid.');
  if (!Array.isArray(payload.locations)) {
    throw new Error('The model-cache diagnostics response has no locations array.');
  }
  return payload as ModelCacheDiagnostics;
}

function parseStudioModelCapabilities(value: unknown) {
  const payload = payloadRecord(value, 'The model-capabilities response is invalid.');
  if (!Array.isArray(payload.capabilities)) {
    throw new Error('The model-capabilities response has no capabilities array.');
  }
  return payload.capabilities as StudioModelProfile[];
}

function parseHfInstallResponse(value: unknown, repoId: string) {
  const payload = payloadRecord(value, `Could not install ${repoId}.`);
  if (payload.result === false) throw new Error(`Could not install ${repoId}.`);
  if (payload.task_id !== undefined && typeof payload.task_id !== 'string') {
    throw new Error('The model-install response has an invalid task identifier.');
  }
  return payload as HfInstallResult;
}

function parseCustomModuleInfo(value: unknown, index: number) {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.moduleKey !== 'string') {
    throw new Error(`Custom module entry ${index + 1} is invalid.`);
  }
  return value as CustomModuleInfo;
}

function parseCustomModules(value: unknown, fallbackMessage: string) {
  const payload = payloadRecord(value, fallbackMessage);
  if (!Array.isArray(payload.modules)) throw new Error('The custom-module response has no modules array.');
  return {
    ...payload,
    modules: payload.modules.map(parseCustomModuleInfo),
  } as CustomModuleActionResult & { modules: CustomModuleInfo[] };
}

function applyCustomModuleResult(set: NodesStoreSet, get: NodesStoreGet, data: CustomModuleActionResult) {
  set({
    customModules: data.modules ?? [],
    customModuleError: null,
    instance: typeof data.instance === 'string' ? data.instance : get().instance,
  });
}

async function runCustomModuleAction(
  set: NodesStoreSet,
  get: NodesStoreGet,
  url: string,
  init: Omit<RequestInit, 'signal'>,
  fallbackMessage: string,
): Promise<CustomModuleActionResult> {
  try {
    const data = await requestJson<CustomModuleActionResult & { modules: CustomModuleInfo[] }>(url, {
      ...init,
      timeoutMs: CUSTOM_MODULE_TIMEOUT_MS,
      parse: (value) => parseCustomModules(value, fallbackMessage),
    });
    applyCustomModuleResult(set, get, data);
    await get().fetchNodes();
    return data;
  } catch (error) {
    set({ customModuleError: formatRequestError(error, fallbackMessage) });
    throw error;
  }
}

export const useNodesStore = create<NodesStore>()((set, get) => ({
  nodesRegistry: {},
  isLoading: false,
  instance: '',
  error: null,
  hfCache: [],
  localModels: [],
  modelCacheDiagnostics: null,
  studioModelCapabilities: [],
  runtimeStatus: null,
  runtimeError: null,
  hfDownloadProgress: {},
  customModules: [],
  customModuleError: null,
  discoveryRequests: initialDiscoveryRequests(),
  setHfDownloadProgress: (progress) => {
    if (!progress.repo_id) {
      return;
    }
    const previous = get().hfDownloadProgress[progress.repo_id];
    const startsNewAttempt = progress.status === 'queued';
    const previousForMerge = startsNewAttempt ? undefined : previous;
    const nextProgress = {
      ...previousForMerge,
      ...progress,
      updated_at: progress.updated_at ?? Date.now() / 1000,
      started_at: progress.started_at ?? previousForMerge?.started_at ?? Date.now() / 1000,
    };
    set((state) => ({
      hfDownloadProgress: {
        ...state.hfDownloadProgress,
        [progress.repo_id]: nextProgress,
      },
    }));
    notifyHfDownloadTransition(previous, nextProgress);
  },
  clearHfDownloadProgress: (repoId) => {
    set((state) => {
      const next = { ...state.hfDownloadProgress };
      delete next[repoId];
      return { hfDownloadProgress: next };
    });
  },
  refreshModelIndexes: async (refresh: boolean = true) => {
    await Promise.all([
      get().fetchRuntimeStatus(),
      get().fetchHfCache(refresh),
      get().fetchLocalModels(refresh),
      get().fetchModelCacheDiagnostics(refresh),
      get().fetchStudioModelCapabilities(),
    ]);
  },
  installHfModel: async (repoId, sid = null, options = {}) => {
    const installKey = `${repoId}:${options.repair ? 'repair' : 'install'}`;
    const existing = inFlightHfInstalls.get(installKey);
    if (existing) {
      return existing;
    }

    const installPromise = (async () => {
      get().setHfDownloadProgress({
        repo_id: repoId,
        status: 'queued',
        progress: 0,
      });

      const params = new URLSearchParams({ repo_id: repoId });
      if (sid) {
        params.set('sid', sid);
      }
      if (options.repair) {
        params.set('repair', '1');
      }

      try {
        const data = await requestJson(`${config.serverAddress}/hf_download?${params.toString()}`, {
          method: 'GET',
          timeoutMs: HF_DOWNLOAD_TIMEOUT_MS,
          parse: (value) => parseHfInstallResponse(value, repoId),
        });

        get().setHfDownloadProgress({
          repo_id: repoId,
          task_id: data?.task_id,
          download_id: data?.task_id,
          status: 'complete',
          progress: 1,
          completed_at: Date.now() / 1000,
        });
        await get().refreshModelIndexes(true);
        return {
          ...(data ?? {}),
          error: false,
          repo_id: data?.repo_id ?? repoId,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        get().setHfDownloadProgress({
          repo_id: repoId,
          status: 'error',
          error: message,
        });
        throw error;
      } finally {
        inFlightHfInstalls.delete(installKey);
      }
    })();

    inFlightHfInstalls.set(installKey, installPromise);
    return installPromise;
  },
  fetchCustomModules: async () => {
    await runDiscoveryRequest(
      'customModules',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/custom_modules`, {
          signal,
          parse: (value) => parseCustomModules(value, 'Could not read custom modules.'),
        }),
      (data) => ({ customModules: data.modules, customModuleError: null }),
      (message) => ({ customModuleError: message }),
      'Could not read custom modules.',
    );
  },
  refreshCustomModules: async () => {
    return runCustomModuleAction(
      set,
      get,
      `${config.serverAddress}/custom_modules/refresh`,
      { method: 'POST' },
      'Could not refresh custom modules.',
    );
  },
  installCustomModule: async (source, name) => {
    return runCustomModuleAction(
      set,
      get,
      `${config.serverAddress}/custom_modules/install`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, name }),
      },
      'Could not install custom module.',
    );
  },
  updateCustomModule: async (name) => {
    return runCustomModuleAction(
      set,
      get,
      `${config.serverAddress}/custom_modules/${encodeURIComponent(name)}/update`,
      { method: 'POST' },
      `Could not update ${name}.`,
    );
  },
  setCustomModuleEnabled: async (name, enabled) => {
    const action = enabled ? 'enable' : 'disable';
    return runCustomModuleAction(
      set,
      get,
      `${config.serverAddress}/custom_modules/${encodeURIComponent(name)}/${action}`,
      { method: 'POST' },
      `Could not ${action} ${name}.`,
    );
  },
  fetchRuntimeStatus: async () => {
    await runDiscoveryRequest(
      'runtime',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/runtime/status`, {
          signal,
          parse: parseRuntimeStatus,
        }),
      (runtimeStatus) => ({ runtimeStatus, runtimeError: null }),
      (message) => ({ runtimeStatus: null, runtimeError: message }),
      'Could not read runtime status. Check that the server is running.',
    );
  },
  fetchNodes: async () => {
    await runDiscoveryRequest(
      'nodes',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/nodes`, {
          signal,
          parse: parseNodesResponse,
        }),
      (data) => ({ nodesRegistry: data.nodes, instance: data.instance, error: null }),
      (message) => ({ error: message }),
      `Server ${config.serverAddress} is not responding. Check if the server is running and the address is correct.`,
    );
  },

  fetchHfCache: async (refresh: boolean = false) => {
    await runDiscoveryRequest(
      'hfCache',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/hf_cache?compact=1&refresh=${refresh}`, {
          method: 'GET',
          signal,
          parse: (value) => parseArrayResponse(value, 'Hugging Face cache'),
        }),
      (hfCache) => ({ hfCache }),
      () => ({}),
      'Error fetching Hugging Face cache. Check if the server is running and try to reload the page.',
    );
  },

  fetchLocalModels: async (refresh: boolean = false) => {
    await runDiscoveryRequest(
      'localModels',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/local_models?refresh=${refresh}`, {
          method: 'GET',
          signal,
          parse: (value) => parseArrayResponse(value, 'Local models'),
        }),
      (localModels) => ({ localModels }),
      () => ({}),
      'Error getting the list of local models. Check if the server is running and try to reload the page.',
    );
  },

  fetchModelCacheDiagnostics: async (refresh: boolean = false) => {
    await runDiscoveryRequest(
      'modelCache',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/model_cache/diagnostics?refresh=${refresh}`, {
          method: 'GET',
          signal,
          parse: parseModelCacheDiagnostics,
        }),
      (modelCacheDiagnostics) => ({ modelCacheDiagnostics }),
      () => ({ modelCacheDiagnostics: null }),
      'Could not read model-cache diagnostics.',
    );
  },

  fetchStudioModelCapabilities: async () => {
    await runDiscoveryRequest(
      'capabilities',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/model_capabilities`, {
          method: 'GET',
          signal,
          parse: parseStudioModelCapabilities,
        }),
      (studioModelCapabilities) => ({ studioModelCapabilities }),
      () => ({ studioModelCapabilities: [] }),
      'Could not read model capabilities.',
    );
  },

  fetchRegistry: async () => {
    await get().fetchNodes();
    await Promise.all([get().refreshModelIndexes(false), get().fetchCustomModules()]);
  },
}));
