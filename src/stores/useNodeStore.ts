// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { create } from 'zustand';
import type { RuntimeResourceSnapshot } from '../studio/runtimeResources';
import config from '../../app.config';
import {
  classifyHfDownloadFailure,
  compactHfDownloadFailureLabel,
  formatDownloadBytes,
  formatDownloadDuration,
  hasHfDownloadFailed,
  isHfDownloadActive,
  isHfDownloadComplete,
} from '../studio/modelInstall';
import { parseRuntimeEnvironment, type RuntimeEnvironment } from '../studio/runtimeEnvironment';
import { isStudioMode, isStudioModelType } from '../studio/modelCapabilities';
import { parseStudioExecutionSpecs } from '../studio/executionSpecs';
import {
  buildTaskTemplateSkeleton,
  parseTaskTemplateContracts,
  type StudioTaskTemplateSkeleton,
} from '../studio/taskTemplateContracts';
import {
  parseOptionalRuntimeCatalog,
  parseOptionalRuntimeExecutionProfiles,
  parseOptionalRuntimeRequirement,
  parseRuntimeModes,
  type OptionalRuntimeCatalog,
} from '../studio/optionalRuntimes';
import type {
  ExecutionProgress,
  RunReadinessIssue,
  StudioExecutionProfile,
  StudioModelProfile,
  StudioTaskTemplateContract,
  UserBlockDefinition,
} from '../studio/types';
import type { ModiffFieldStyle, ModiffNodeStyle } from '../theme';
import { enqueueSnackbar } from '../ui/snackbar';
import type { ImageArtifact } from '../utils/imageArtifacts';
import { createLatestRequestGate, formatRequestError, requestJson, RequestError } from '../utils/requestJson';
import { useStudioStore } from './useStudioStore';

export type NodeParamOptions = unknown[] | Record<string, unknown>;
export type NodeParamSignal = { direction: 'input' | 'output'; origin?: string; value: unknown };
export type NodeExecutionStatus = 'queued' | 'running' | 'completed' | 'cached' | 'failed' | 'cancelled' | 'succeeded';

export type NodeData = {
  type: 'custom' | 'any' | 'group' | 'loop' | 'block';
  module: string;
  action: string;
  label: string;
  category: string;
  params: Record<string, NodeParams>;
  description?: string;
  style?: ModiffNodeStyle;
  resizable?: boolean;
  skipParamsCheck?: boolean;
  executionTime?: Record<string, number>;
  memoryUsage?: Record<string, number>;
  isCached?: boolean;
  progress?: number;
  activeTaskId?: string | null;
  attemptIndex?: number;
  executionStatus?: NodeExecutionStatus;
  executionPhase?: string;
  progressMessage?: string;
  executionProgress?: ExecutionProgress;
  minimized?: boolean;
  headerColor?: string;
  uiState?: {
    collapsed?: boolean;
    blockExpanded?: boolean;
    blockCollapsedWidth?: number;
    blockCollapsedHeight?: number;
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
  userBlockSnapshot?: UserBlockDefinition;
  userBlockInstanceId?: string;
  userBlockSourceNodeId?: string;
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
  required?: boolean;
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
  progress?: number | null;
  status?: string;
  phase?: string;
  path?: string;
  cache_dir?: string;
  downloaded_bytes?: number;
  completed_bytes?: number;
  total_bytes?: number | null;
  remaining_bytes?: number | null;
  bytes_per_second?: number | null;
  file_count?: number;
  total_file_count?: number | null;
  completed_file_count?: number | null;
  current_file?: string | null;
  active_files?: string[];
  eta_seconds?: number | null;
  started_at?: number;
  updated_at?: number;
  completed_at?: number | null;
  size_known?: boolean;
  plan_error?: string;
  revision?: string | null;
  repair?: boolean;
  requested_file_count?: number;
  reserved_bytes?: number;
  error?: string | null;
  error_code?: string | null;
  last_error?: string;
  message?: string;
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
  accessible_memory_total?: number;
  dedicated_memory_total?: number;
  shared_memory_total?: number;
  memory_kind?: 'dedicated' | 'shared' | 'unified' | string;
  vendor?: string;
  backend?: string;
  architecture?: string;
  properties_error?: string;
  memory_error?: string;
};

export type RuntimeMpsDevice = {
  index?: number;
  name?: string;
  total_memory?: number;
  memory_free_bytes?: number;
  memory_kind?: 'unified' | 'shared' | string;
  architecture?: string;
};

export type RuntimeXpuDevice = {
  index?: number;
  name?: string;
  total_memory?: number;
  memory_free_bytes?: number;
  accessible_memory_total?: number;
  memory_kind?: 'dedicated' | 'shared' | 'unified' | string;
  architecture?: string;
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
  xpu_available?: boolean;
  xpu_device_count?: number;
  xpu_devices?: RuntimeXpuDevice[];
  xpu_error?: string;
  mps_built?: boolean;
  mps_available?: boolean;
  mps_device_count?: number;
  mps_devices?: RuntimeMpsDevice[];
  mps_error?: string;
};

export type RuntimeStatus = {
  ready?: boolean;
  runtime_fingerprint?: string;
  runtimeEnvironment: RuntimeEnvironment;
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
  studioModelCapabilitiesAuthoritative: boolean;
  studioExecutionSpecInvalid: boolean;
  studioTaskTemplateContracts: StudioTaskTemplateContract[];
  studioTaskTemplateSkeletons: StudioTaskTemplateSkeleton[];
  runtimeStatus: RuntimeStatus | null;
  runtimeResources: RuntimeResourceSnapshot | null;
  runtimeError: string | null;
  optionalRuntimeCatalog: OptionalRuntimeCatalog | null;
  hfDownloadProgress: Record<string, HfDownloadProgress>;
  customModules: CustomModuleInfo[];
  customModuleError: string | null;
  discoveryRequests: Record<DiscoveryRequestKey, DiscoveryRequestState>;
  setHfDownloadProgress: (progress: HfDownloadProgress) => void;
  rehydrateHfDownloadProgress: (downloads: HfDownloadProgress[]) => void;
  clearHfDownloadProgress: (repoId: string) => void;
  refreshModelIndexes: (refresh?: boolean, options?: { invalidateAutoPlans?: boolean }) => Promise<void>;
  installHfModel: (
    repoId: string,
    sid?: string | null,
    options?: { repair?: boolean; files?: string[] },
  ) => Promise<HfInstallResult>;
  fetchCustomModules: () => Promise<void>;
  refreshCustomModules: () => Promise<CustomModuleActionResult>;
  installCustomModule: (source: string, name?: string) => Promise<CustomModuleActionResult>;
  updateCustomModule: (name: string) => Promise<CustomModuleActionResult>;
  setCustomModuleEnabled: (name: string, enabled: boolean) => Promise<CustomModuleActionResult>;
  fetchRuntimeStatus: () => Promise<void>;
  fetchOptionalRuntimes: () => Promise<void>;
  setRuntimeResources: (snapshot: RuntimeResourceSnapshot | null) => void;
  fetchNodes: () => Promise<void>;
  fetchHfCache: (refresh?: boolean) => Promise<void>;
  fetchLocalModels: (refresh?: boolean) => Promise<void>;
  fetchModelCacheDiagnostics: (refresh?: boolean) => Promise<void>;
  fetchStudioModelCapabilities: () => Promise<void>;
  fetchRegistry: () => Promise<void>;
};

export type DiscoveryRequestKey =
  | 'capabilities'
  | 'customModules'
  | 'hfCache'
  | 'localModels'
  | 'modelCache'
  | 'nodes'
  | 'optionalRuntimes'
  | 'runtime';

export type DiscoveryRequestState = {
  status: 'error' | 'idle' | 'loading' | 'success';
  error: string | null;
  requestId: number | null;
};

type NodesStoreSet = (partial: Partial<NodesStore> | ((state: NodesStore) => Partial<NodesStore>)) => void;
type NodesStoreGet = () => NodesStore;

const inFlightHfInstalls = new Map<string, Promise<HfInstallResult>>();
let inFlightNodeDiscovery: Promise<void> | null = null;
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
    optionalRuntimes: { status: 'idle', error: null, requestId: null },
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
  const payload = payloadRecord(value, 'The runtime status response is invalid.');
  return {
    ...payload,
    runtimeEnvironment: parseRuntimeEnvironment(payload),
  } as RuntimeStatus;
}

function parseModelCacheDiagnostics(value: unknown) {
  const payload = payloadRecord(value, 'The model-cache diagnostics response is invalid.');
  if (!Array.isArray(payload.locations)) {
    throw new Error('The model-cache diagnostics response has no locations array.');
  }
  return payload as ModelCacheDiagnostics;
}

function invalidModelCapabilities(): never {
  throw new Error('Invalid model-capabilities response.');
}

function parseModeOutputKinds(value: unknown, modes: readonly string[]) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalidModelCapabilities();
  const entries = Object.entries(value);
  if (
    entries.length > modes.length ||
    entries.some(
      ([mode, outputKind]) =>
        !modes.includes(mode) || !['image', 'video', 'audio', 'json'].includes(String(outputKind)),
    )
  )
    invalidModelCapabilities();
  return { ...value } as StudioModelProfile['modeOutputKinds'];
}

function parseOutputMedia(value: unknown, outputKind: unknown) {
  if (value === undefined) return undefined;
  const mediaKinds = ['image', 'video', 'audio', 'json'];
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > mediaKinds.length ||
    value.some((item) => !mediaKinds.includes(String(item))) ||
    new Set(value).size !== value.length ||
    (typeof outputKind === 'string' && !value.includes(outputKind))
  )
    invalidModelCapabilities();
  return [...value] as NonNullable<StudioModelProfile['outputMedia']>;
}

function parseLicenseCompliance(value: unknown) {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 8 ||
    value.state !== 'product_and_user_review_required' ||
    !['codeLicense', 'weightsLicense', 'noticePath'].every(
      (key) => typeof value[key] === 'string' && Boolean(value[key].trim()),
    ) ||
    ![
      'useRestrictionsPresent',
      'distributionAndHostedUseCarryDuties',
      'sourceExecutable',
      'liveExecutionQualified',
    ].every((key) => typeof value[key] === 'boolean')
  )
    invalidModelCapabilities();
  return { ...value } as StudioModelProfile['licenseCompliance'];
}

function parseLayerCount(value: unknown) {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join() !== 'default,max,min' ||
    ![value.default, value.min, value.max].every(Number.isInteger) ||
    !((value.min as number) >= 1 && (value.min as number) <= (value.default as number)) ||
    !((value.default as number) <= (value.max as number) && (value.max as number) <= 16)
  )
    invalidModelCapabilities();
  return { ...value } as NonNullable<StudioModelProfile['layerCount']>;
}

function parseLayerResolutions(value: unknown) {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 8 ||
    value.some((item) => !Number.isInteger(item) || item < 64 || item > 2048 || item % 16 !== 0) ||
    new Set(value).size !== value.length
  )
    invalidModelCapabilities();
  return [...value] as number[];
}

function parseStudioModelCapabilities(value: unknown) {
  const payload = payloadRecord(value, 'Invalid model-capabilities response.');
  if (!Array.isArray(payload.capabilities) || payload.capabilities.length > 128) invalidModelCapabilities();
  const modelTypes = new Set();
  const capabilities = payload.capabilities.flatMap((item) => {
    if (!isRecord(item) || typeof item.modelType !== 'string') invalidModelCapabilities();
    // A newer backend can advertise models this client does not have a Studio
    // presentation for yet. Ignore those records instead of casting them into
    // the closed client model union. Experimental capabilities are likewise a
    // separate response field and are never promoted into runnable Studio data.
    if (!isStudioModelType(item.modelType)) return [];
    if (
      payload.schemaVersion !== 2 &&
      (item.studioExecutionSpecs !== undefined ||
        item.studioExecutionSpecSchemaVersion !== undefined ||
        item.studioExecutionSpecModes !== undefined)
    )
      throw new Error('Invalid Studio execution specification.');
    if (modelTypes.has(item.modelType)) invalidModelCapabilities();
    modelTypes.add(item.modelType);
    const modes = parseRuntimeModes(item.modes, isStudioMode);
    const runnableModes =
      item.runnableModes === undefined ? undefined : parseRuntimeModes(item.runnableModes, isStudioMode);
    const qualifiedModes =
      item.qualifiedModes === undefined ? undefined : parseRuntimeModes(item.qualifiedModes, isStudioMode);
    const modeOutputKinds = parseModeOutputKinds(item.modeOutputKinds, modes);
    const outputMedia = parseOutputMedia(item.outputMedia, item.outputKind);
    const licenseCompliance = parseLicenseCompliance(item.licenseCompliance);
    const layerCount = parseLayerCount(item.layerCount);
    const layerResolutions = parseLayerResolutions(item.layerResolutions);
    const artifactKind = item.artifactKind;
    const artifactInstallRequired = item.artifactInstallRequired;
    if (
      qualifiedModes?.some((mode) => !modes.includes(mode)) ||
      [item.autoEligible, item.templateEligible, item.galleryEligible, item.liveProof].some(
        (flag) => flag !== undefined && typeof flag !== 'boolean',
      ) ||
      ((layerCount || layerResolutions) && !modes.includes('layer_decomposition')) ||
      Boolean(layerCount) !== Boolean(layerResolutions) ||
      (artifactKind !== undefined && !['model', 'spandrel_upscaler', 'builtin'].includes(String(artifactKind))) ||
      (artifactInstallRequired !== undefined && typeof artifactInstallRequired !== 'boolean') ||
      ((artifactKind === 'builtin' || artifactInstallRequired === false) &&
        !(artifactKind === 'builtin' && artifactInstallRequired === false)) ||
      (item.executionStatus !== undefined &&
        !['expert_only', 'supported', 'supported_with_model'].includes(String(item.executionStatus)))
    )
      invalidModelCapabilities();
    const revisionCandidates = item.revisionCandidates;
    if (
      revisionCandidates !== undefined &&
      (!Array.isArray(revisionCandidates) ||
        revisionCandidates.length > 32 ||
        revisionCandidates.some((revision) => typeof revision !== 'string' || !/^[0-9a-f]{40}$/.test(revision)) ||
        new Set(revisionCandidates).size !== revisionCandidates.length)
    )
      invalidModelCapabilities();
    const optionalRuntimeRequirement =
      item.optionalRuntimeRequirement === undefined
        ? undefined
        : parseOptionalRuntimeRequirement(item.optionalRuntimeRequirement);
    const executionProfiles =
      item.executionProfiles === undefined
        ? undefined
        : parseOptionalRuntimeExecutionProfiles(item.executionProfiles, optionalRuntimeRequirement, isStudioMode);
    const studioExecutionSpecs =
      item.studioExecutionSpecs === undefined
        ? undefined
        : parseStudioExecutionSpecs(
            item.studioExecutionSpecs,
            item.modelType,
            modes,
            executionProfiles as unknown as StudioExecutionProfile[] | undefined,
          );
    const studioExecutionSpecModes =
      item.studioExecutionSpecModes === undefined
        ? undefined
        : parseRuntimeModes(item.studioExecutionSpecModes, isStudioMode);
    if (
      new Set([
        item.studioExecutionSpecs === undefined,
        item.studioExecutionSpecSchemaVersion === undefined,
        item.studioExecutionSpecModes === undefined,
      ]).size !== 1 ||
      (item.studioExecutionSpecSchemaVersion !== undefined &&
        (item.studioExecutionSpecSchemaVersion !== 1 ||
          !studioExecutionSpecs?.length ||
          !studioExecutionSpecModes ||
          studioExecutionSpecModes.length !== (item.studioExecutionSpecModes as unknown[]).length ||
          studioExecutionSpecs.length !== studioExecutionSpecModes.length ||
          studioExecutionSpecs.some((spec) => !studioExecutionSpecModes.includes(spec.mode))))
    )
      throw new Error('Invalid Studio execution specification.');
    if (
      executionProfiles &&
      (executionProfiles.some((profile) => profile.modes.some((mode) => !modes.includes(mode))) ||
        (runnableModes ?? modes).some((mode) => !executionProfiles.some((profile) => profile.modes.includes(mode))))
    )
      invalidModelCapabilities();
    item.modes = modes;
    if (revisionCandidates) item.revisionCandidates = [...revisionCandidates];
    if (runnableModes) item.runnableModes = runnableModes;
    if (qualifiedModes) item.qualifiedModes = qualifiedModes;
    if (modeOutputKinds) item.modeOutputKinds = modeOutputKinds;
    if (outputMedia) item.outputMedia = outputMedia;
    if (licenseCompliance) item.licenseCompliance = licenseCompliance;
    if (layerCount) item.layerCount = layerCount;
    if (layerResolutions) item.layerResolutions = layerResolutions;
    if (executionProfiles) item.executionProfiles = executionProfiles;
    if (studioExecutionSpecs) item.studioExecutionSpecs = studioExecutionSpecs;
    if (studioExecutionSpecModes) item.studioExecutionSpecModes = studioExecutionSpecModes;
    if (item.studioExecutionSpecSchemaVersion === 1) item.studioExecutionSpecSchemaVersion = 1;
    return [item as unknown as StudioModelProfile];
  });
  const taskTemplateFields = [payload.taskTemplateContractSchemaVersion, payload.taskTemplateContracts];
  const taskTemplateContracts = taskTemplateFields.every((field) => field === undefined)
    ? []
    : parseTaskTemplateContracts(
        payload.taskTemplateContracts,
        payload.taskTemplateContractSchemaVersion,
        capabilities,
      );
  if (taskTemplateContracts.length > 0) {
    for (const capability of capabilities) {
      const expected = taskTemplateContracts.filter((contract) => contract.modelType === capability.modelType);
      const declaredModes = capability.taskTemplateContractModes;
      if (
        capability.taskTemplateContractSchemaVersion !== 1 ||
        !Array.isArray(capability.taskTemplateContracts) ||
        !Array.isArray(declaredModes) ||
        declaredModes.length !== expected.length ||
        expected.some(
          (contract) =>
            !declaredModes.includes(contract.mode) ||
            !capability.taskTemplateContracts?.some(
              (declared) => declared.id === contract.id && declared.contentHash === contract.contentHash,
            ),
        )
      )
        throw new Error('Invalid Studio task-template contract.');
      capability.taskTemplateContracts = expected;
    }
  }
  return {
    authoritative: payload.schemaVersion === 2,
    capabilities,
    taskTemplateContracts,
  };
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
  studioModelCapabilitiesAuthoritative: false,
  studioExecutionSpecInvalid: false,
  studioTaskTemplateContracts: [],
  studioTaskTemplateSkeletons: [],
  runtimeStatus: null,
  runtimeResources: null,
  runtimeError: null,
  optionalRuntimeCatalog: null,
  hfDownloadProgress: {},
  customModules: [],
  customModuleError: null,
  discoveryRequests: initialDiscoveryRequests(),
  setRuntimeResources: (runtimeResources) => set({ runtimeResources }),
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
  rehydrateHfDownloadProgress: (downloads) => {
    set((state) => {
      const next = Object.fromEntries(
        Object.entries(state.hfDownloadProgress).filter(([, progress]) => !isHfDownloadActive(progress)),
      );
      downloads.forEach((progress) => {
        if (!progress.repo_id) return;
        next[progress.repo_id] = progress;
      });
      return { hfDownloadProgress: next };
    });
  },
  clearHfDownloadProgress: (repoId) => {
    set((state) => {
      const next = { ...state.hfDownloadProgress };
      delete next[repoId];
      return { hfDownloadProgress: next };
    });
  },
  refreshModelIndexes: async (refresh: boolean = true, options = {}) => {
    if (refresh && options.invalidateAutoPlans !== false) {
      useStudioStore.getState().invalidateAutoResourcePlans();
    }
    await Promise.all([
      get().fetchRuntimeStatus(),
      get().fetchOptionalRuntimes(),
      get().fetchHfCache(refresh),
      get().fetchLocalModels(refresh),
      get().fetchModelCacheDiagnostics(refresh),
      get().fetchStudioModelCapabilities(),
    ]);
  },
  installHfModel: async (repoId, sid = null, options = {}) => {
    const requestedFiles = [...new Set(options.files?.map((file) => file.trim()).filter(Boolean) ?? [])].sort();
    const installKey = `${repoId}:${options.repair ? 'repair' : 'install'}:${requestedFiles.join(',')}`;
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

      try {
        const data = await requestJson(`${config.serverAddress}/hf_download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo_id: repoId,
            ...(sid ? { sid } : {}),
            ...(options.repair ? { repair: true } : {}),
            ...(requestedFiles.length > 0 ? { files: requestedFiles } : {}),
          }),
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
        const errorPayload =
          error instanceof RequestError && error.payload && typeof error.payload === 'object'
            ? (error.payload as Record<string, unknown>)
            : null;
        const explicitErrorCode = typeof errorPayload?.code === 'string' ? errorPayload.code : null;
        const classifiedFailure = classifyHfDownloadFailure({
          repo_id: repoId,
          status: 'error',
          error: message,
        });
        const errorCode = explicitErrorCode ?? (classifiedFailure === 'access' ? 'huggingface_access_required' : null);
        get().setHfDownloadProgress({
          repo_id: repoId,
          status: 'error',
          error: message,
          error_code: errorCode,
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
          timeoutMs: 120_000,
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
    const previousFingerprint = get().runtimeStatus?.runtime_fingerprint;
    await runDiscoveryRequest(
      'runtime',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/runtime/status`, {
          signal,
          timeoutMs: 120_000,
          parse: parseRuntimeStatus,
        }),
      (runtimeStatus) => {
        const nextFingerprint = runtimeStatus.runtime_fingerprint;
        if (
          previousFingerprint !== undefined &&
          nextFingerprint !== undefined &&
          previousFingerprint !== nextFingerprint
        ) {
          useStudioStore.getState().invalidateAutoResourcePlans();
        }
        return { runtimeStatus, runtimeError: null };
      },
      (message) => ({ runtimeStatus: null, runtimeError: message }),
      'Could not read runtime status. Check that the server is running.',
    );
  },
  fetchOptionalRuntimes: async () => {
    await runDiscoveryRequest(
      'optionalRuntimes',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/runtime/optional-runtimes`, {
          signal,
          timeoutMs: 120_000,
          parse: parseOptionalRuntimeCatalog,
        }),
      (optionalRuntimeCatalog) => ({ optionalRuntimeCatalog }),
      () => ({ optionalRuntimeCatalog: null }),
      'Could not read optional runtime status.',
    );
  },
  fetchNodes: async () => {
    if (inFlightNodeDiscovery) {
      await inFlightNodeDiscovery;
      return;
    }

    const request = runDiscoveryRequest(
      'nodes',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/nodes`, {
          signal,
          timeoutMs: 120_000,
          parse: parseNodesResponse,
        }),
      (data) => ({ nodesRegistry: data.nodes, instance: data.instance, error: null }),
      (message) => ({ error: message }),
      `Server ${config.serverAddress} is not responding. Check if the server is running and the address is correct.`,
    );
    inFlightNodeDiscovery = request;
    try {
      await request;
    } finally {
      if (inFlightNodeDiscovery === request) {
        inFlightNodeDiscovery = null;
      }
    }
  },

  fetchHfCache: async (refresh: boolean = false) => {
    await runDiscoveryRequest(
      'hfCache',
      set,
      (signal) =>
        requestJson(`${config.serverAddress}/hf_cache?compact=1&refresh=${refresh}`, {
          method: 'GET',
          signal,
          timeoutMs: 120_000,
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
          timeoutMs: 120_000,
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
          timeoutMs: 120_000,
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
          timeoutMs: 120_000,
          parse: parseStudioModelCapabilities,
        }),
      ({ authoritative, capabilities, taskTemplateContracts }) => ({
        studioModelCapabilities: capabilities,
        studioModelCapabilitiesAuthoritative: authoritative,
        studioExecutionSpecInvalid: false,
        studioTaskTemplateContracts: taskTemplateContracts,
        studioTaskTemplateSkeletons: taskTemplateContracts.map(buildTaskTemplateSkeleton),
      }),
      (message) =>
        message.includes('Studio execution specification')
          ? {
              studioModelCapabilities: [],
              studioModelCapabilitiesAuthoritative: false,
              studioExecutionSpecInvalid: true,
              studioTaskTemplateContracts: [],
              studioTaskTemplateSkeletons: [],
            }
          : {},
      'Could not read model capabilities.',
    );
  },

  fetchRegistry: async () => {
    // Invalidate before any startup request begins. Invalidating between node
    // discovery and model discovery raced the startup template-plan batch and
    // could erase a freshly resolved plan.
    useStudioStore.getState().invalidateAutoResourcePlans();
    await get().fetchNodes();
    await Promise.all([get().refreshModelIndexes(true, { invalidateAutoPlans: false }), get().fetchCustomModules()]);
  },
}));
