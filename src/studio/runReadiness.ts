import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useTaskStore, type Task } from '../stores/useTaskStore';
import { getStudioModelCacheStatus } from './modelCache';
import {
  getGraphWorkflowArtifactRequirements,
  getStudioWorkflowArtifactRequirements,
  type WorkflowGraphArtifactReference,
} from './artifactRequirements';
import {
  getProfileForForm,
  getStudioModelDisplayName,
  normalizeStudioOffloadMode,
  offloadModeIsSupported,
  QWEN_INPAINT_GENERATE_NODE_KEY,
  QWEN_INPAINT_PIPELINE_NODE_KEY,
  QWEN_LOW_VRAM_OFFLOAD_MODE,
  QWEN_LOW_VRAM_QUANTIZATION_COMPONENT,
  QWEN_OUTPAINT_CANVAS_NODE_KEY,
  QWEN_LOW_VRAM_QUANTIZATION_MODE,
  QWEN_QUANTIZATION_NODE_KEY,
  QWEN_T2I_GENERATE_NODE_KEY,
  QWEN_T2I_PIPELINE_NODE_KEY,
  STUDIO_MODE_LABELS,
  STUDIO_OFFLOAD_LABELS,
} from './modelProfiles';
import { resolveStudioResourceForm } from './resourcePlanner';
import {
  autoProofIsReady,
  autoPlanHasRuntimeIssue,
  autoPlanIsReady,
  autoResourceCompatibility,
  autoResourceInstallTarget,
  selectedAutoCandidate,
} from './autoResource';
import { studioOffloadPlanConflict } from './deviceOffload';
import type {
  GraphInspectionSummary,
  RunReadinessDecision,
  RunReadinessIssue,
  StudioFormState,
  StudioModelProfile,
} from './types';
import { runtimeOptionValues } from './runtimeOptions';
import type { RuntimeCudaDevice, RuntimeMpsDevice, RuntimeStatus, RuntimeXpuDevice } from '../stores/useNodeStore';
import type { RuntimeResourceSnapshot } from './runtimeResources';
import { getStudioGraphRunBlockingMessage } from './graphBridge';

const GIB = 1024 ** 3;
const MODEL_PARAM_HINTS = [
  'repo',
  'repository',
  'model',
  'checkpoint',
  'ckpt',
  'safetensors',
  'weights',
  'lora',
  'vae',
  'controlnet',
  'adapter',
];
const MODEL_FILE_PATTERN = /\.(safetensors|ckpt|pt|pth|bin|onnx|gguf)$/i;
const HF_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const LOCAL_PATH_PREFIX_PATTERN = /^(?:\.{1,2}\/|\/|[a-z]:|models\/|checkpoints\/|loras\/|vae\/|controlnet\/)/i;

function issue(values: Omit<RunReadinessIssue, 'id'> & { id?: string }): RunReadinessIssue {
  const stableId = [
    values.code ?? '',
    values.category,
    values.nodeId ?? '',
    values.repoId ?? '',
    values.modelPath ?? '',
    values.action ?? '',
    values.message,
  ]
    .join(':')
    .toLowerCase()
    .replace(/[^a-z0-9:_./-]+/g, '-');
  return {
    id: values.id ?? stableId,
    ...values,
  };
}

export function buildRunReadinessDecision(
  issues: RunReadinessIssue[],
  options: { preparing?: boolean } = {},
): RunReadinessDecision {
  const blockingIssues = issues.filter((item) => item.blocking);
  const warningIssues = issues.filter((item) => !item.blocking && item.severity === 'warning');
  const infoIssues = issues.filter((item) => !item.blocking && item.severity === 'info');
  const primaryIssue = blockingIssues[0] ?? warningIssues[0] ?? infoIssues[0] ?? issues[0] ?? null;
  const state = options.preparing
    ? 'preparing'
    : blockingIssues.length > 0
      ? 'blocked'
      : warningIssues.length > 0
        ? 'ready_with_warnings'
        : 'ready';

  return {
    state,
    issues,
    blockingIssues,
    warningIssues,
    primaryIssue,
    canRun: state === 'ready' || state === 'ready_with_warnings',
    title:
      state === 'preparing'
        ? 'Preparing graph'
        : state === 'blocked'
          ? 'Run blocked'
          : state === 'ready_with_warnings'
            ? 'Ready with warnings'
            : 'Ready',
    message: primaryIssue?.message ?? (state === 'preparing' ? 'Preparing graph' : 'Ready'),
  };
}

function repoValueFromParam(value: unknown) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'value' in value) {
    return String((value as { value?: unknown }).value ?? '');
  }
  return String(value);
}

function compactModelString(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function paramLooksModelRelated(
  paramKey: string,
  param: { label?: string; description?: string; type?: string | string[] },
) {
  const text =
    `${paramKey} ${param.label ?? ''} ${param.description ?? ''} ${Array.isArray(param.type) ? param.type.join(' ') : (param.type ?? '')}`.toLowerCase();
  return MODEL_PARAM_HINTS.some((hint) => text.includes(hint));
}

function isHfRepoId(value: string) {
  if (
    !value ||
    value.includes('://') ||
    value.includes('\\') ||
    value.includes(' ') ||
    MODEL_FILE_PATTERN.test(value) ||
    LOCAL_PATH_PREFIX_PATTERN.test(value)
  )
    return false;
  return HF_REPO_PATTERN.test(value);
}

function isModelFilePath(value: string) {
  if (!value || value.startsWith('data:') || value.includes('\n')) return false;
  return MODEL_FILE_PATTERN.test(value) || /[\\/](models|checkpoints|loras|vae|controlnet)[\\/]/i.test(value);
}

function collectNodeModelReferences(node: ReturnType<typeof useFlowStore.getState>['nodes'][number]) {
  const references: Array<{ kind: 'repo' | 'path'; value: string; paramKey: string }> = [];
  const params = node.data.params || {};

  Object.entries(params).forEach(([paramKey, param]) => {
    const rawValue = param.value ?? param.default;
    const value = compactModelString(repoValueFromParam(rawValue));
    if (!value || value === 'undefined' || value === 'null') return;
    const modelRelated = paramLooksModelRelated(paramKey, param);
    const source =
      rawValue && typeof rawValue === 'object' && 'source' in rawValue
        ? String((rawValue as { source?: unknown }).source ?? '')
        : '';
    const hubFileRepo =
      source === 'hub' && MODEL_FILE_PATTERN.test(value) && value.split('/').length >= 3
        ? value.split('/').slice(0, 2).join('/')
        : '';
    if (hubFileRepo && modelRelated) {
      // A modelselect Hub value may pin a single file as
      // owner/repo/path/to/model.pth. Its readiness is governed by the
      // app-managed repository snapshot, not by the legacy local-model index.
      references.push({ kind: 'repo', value: hubFileRepo, paramKey });
    } else if (isHfRepoId(value) && (modelRelated || paramKey === 'repo_id' || paramKey === 'model_id')) {
      references.push({ kind: 'repo', value, paramKey });
    } else if (modelRelated && isModelFilePath(value)) {
      references.push({ kind: 'path', value, paramKey });
    }
  });

  const unique = new Map<string, { kind: 'repo' | 'path'; value: string; paramKey: string }>();
  references.forEach((reference) => {
    unique.set(`${reference.kind}:${reference.value}`, reference);
  });
  return Array.from(unique.values());
}

export function formatVram(bytes?: number | null) {
  if (!bytes || bytes <= 0) return 'unknown VRAM';
  const gib = bytes / GIB;
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GB`;
}

export function isCudaDevice(device: string) {
  return /^cuda(?::\d+)?$/i.test(device.trim());
}

export function isMpsDevice(device: string) {
  return /^mps(?::\d+)?$/i.test(device.trim());
}

export function isXpuDevice(device: string) {
  return /^xpu(?::\d+)?$/i.test(device.trim());
}

function indexFromDevice(device: string, prefix: 'cuda' | 'mps' | 'xpu') {
  const match = device.trim().match(new RegExp(`^${prefix}(?::(\\d+))?$`, 'i'));
  if (!match) return null;
  return match[1] ? Number(match[1]) : 0;
}

function cudaIndexFromDevice(device: string) {
  const match = device.match(/^cuda(?::(\d+))?$/i);
  if (!match) return null;
  return match[1] ? Number(match[1]) : 0;
}

export function getRuntimeCudaDevice(status: RuntimeStatus | null, device: string): RuntimeCudaDevice | null {
  const index = cudaIndexFromDevice(device);
  const torchStatus = status?.packages?.torch;
  if (index === null || !torchStatus?.cuda_available) return null;

  const listedDevice = torchStatus.cuda_devices?.find((item) => item.index === index);
  if (listedDevice) return listedDevice;
  if (index !== 0) return null;

  return {
    index: 0,
    name: torchStatus.cuda_device_name,
    total_memory: torchStatus.cuda_device_total_memory,
    memory_free_bytes: torchStatus.cuda_memory_free_bytes,
    memory_total_bytes: torchStatus.cuda_memory_total_bytes,
  };
}

export function getRuntimeMpsDevice(status: RuntimeStatus | null, device: string): RuntimeMpsDevice | null {
  const index = indexFromDevice(device, 'mps');
  const torchStatus = status?.packages?.torch;
  if (index === null || !torchStatus?.mps_available) return null;

  const listedDevice = torchStatus.mps_devices?.find((item) => item.index === index);
  if (listedDevice) return listedDevice;
  if (index !== 0) return null;

  return {
    index: 0,
    name: 'Apple Metal Performance Shaders',
    total_memory: 0,
  };
}

export function getRuntimeXpuDevice(status: RuntimeStatus | null, device: string): RuntimeXpuDevice | null {
  const index = indexFromDevice(device, 'xpu');
  const torchStatus = status?.packages?.torch;
  if (index === null || !torchStatus?.xpu_available) return null;

  const listedDevice = torchStatus.xpu_devices?.find((item) => item.index === index);
  if (listedDevice) return listedDevice;
  if (index !== 0) return null;

  return {
    index: 0,
    name: 'Intel XPU',
  };
}

export function getPreferredRuntimeDevice(status: RuntimeStatus | null) {
  const torchStatus = status?.packages?.torch;
  if (torchStatus?.cuda_available) return 'cuda:0';
  if (torchStatus?.xpu_available) return 'xpu:0';
  if (torchStatus?.mps_available) return 'mps:0';
  return 'cpu:0';
}

export function runtimeDeviceIsAvailable(status: RuntimeStatus | null, device: string) {
  if (!status) return true;
  const normalized = device.trim().toLowerCase();
  if (normalized.startsWith('cuda')) return Boolean(getRuntimeCudaDevice(status, device));
  if (normalized.startsWith('xpu')) return Boolean(getRuntimeXpuDevice(status, device));
  if (normalized.startsWith('mps')) return Boolean(getRuntimeMpsDevice(status, device));
  if (normalized.startsWith('cpu')) return true;
  return false;
}

function cudaTotalBytes(status: RuntimeStatus | null, device: string) {
  const cudaDevice = getRuntimeCudaDevice(status, device);
  return cudaDevice?.memory_total_bytes ?? cudaDevice?.total_memory ?? null;
}

function cudaAvailableBytes(status: RuntimeStatus | null, device: string) {
  const cudaDevice = getRuntimeCudaDevice(status, device);
  return cudaDevice?.memory_free_bytes ?? cudaDevice?.memory_total_bytes ?? cudaDevice?.total_memory ?? null;
}

function positiveByteRequirement(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function getStudioCudaRecipePressureIssue(
  form: StudioFormState,
  autoCandidate: ReturnType<typeof selectedAutoCandidate>,
  status: RuntimeStatus | null = useNodesStore.getState().runtimeStatus,
  resources: RuntimeResourceSnapshot | null = useNodesStore.getState().runtimeResources,
  queueContext: {
    activeWorkflowTabId?: string | null;
    currentTask?: Task;
  } = {
    activeWorkflowTabId: useStudioStore.getState().activeWorkflowTabId,
    currentTask: useTaskStore.getState().currentTask,
  },
) {
  if (!isCudaDevice(form.device)) return null;

  const profile = getProfileForForm(form);
  const currentTask = queueContext.currentTask;
  const currentTaskIsActive = Boolean(
    currentTask && !['completed', 'failed', 'cancelled'].includes(currentTask.status ?? 'running'),
  );
  const currentTaskBelongsToThisWorkflow = Boolean(
    currentTask?.workflow_tab_id && currentTask.workflow_tab_id === queueContext.activeWorkflowTabId,
  );
  if (currentTaskIsActive && !currentTaskBelongsToThisWorkflow) {
    const currentRunLabel = currentTask?.workflow_title || currentTask?.name || 'the current run';
    return {
      category: 'hardware_fit',
      severity: 'info',
      blocking: false,
      message: `${getStudioModelDisplayName(profile)} will run after ${currentRunLabel}.`,
      details:
        'Accelerator memory used by the active MoDiff run is temporary. Auto evaluates projected memory after that run and performs eligible cache cleanup before this queued run starts.',
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }
  // The active graph already owns this allocation. Its execution state is
  // rendered on the nodes and in Session activity; it is not pre-run pressure
  // for a second admission decision.
  if (currentTaskIsActive) return null;
  // Auto compatibility is owned by the backend planner. Queue ordering above
  // is UI state, but local memory thresholds below are Expert-only estimates.
  if (form.resourceMode === 'auto') return null;
  const liveAccelerator =
    resources?.accelerators.find((item) => item.device.toLowerCase() === form.device.toLowerCase()) ??
    resources?.accelerators.find((item) => item.active);
  const rawAvailableBytes = liveAccelerator?.memoryFreeBytes ?? cudaAvailableBytes(status, form.device);
  const reclaimableBytes = currentTaskIsActive ? 0 : (liveAccelerator?.reservedBytes ?? 0);
  const totalBytes = liveAccelerator?.memoryTotalBytes ?? cudaTotalBytes(status, form.device);
  const availableBytes = rawAvailableBytes
    ? Math.min(totalBytes ?? Number.POSITIVE_INFINITY, rawAvailableBytes + reclaimableBytes)
    : null;
  const candidateBytes = positiveByteRequirement(autoCandidate?.requirements?.vramBytes);
  const expertBytes =
    profile.family !== 'Qwen Image'
      ? null
      : form.autoOffload
        ? 10 * GIB
        : form.quantizationMode === QWEN_LOW_VRAM_QUANTIZATION_MODE
          ? 24 * GIB
          : 80 * GIB;
  const requiredBytes = candidateBytes ?? expertBytes;
  if (!availableBytes || !requiredBytes || requiredBytes < availableBytes) return null;

  const planLabel = form.autoOffload ? 'current offload recipe' : 'current resident recipe';
  return {
    category: 'hardware_fit',
    severity: 'warning',
    blocking: false,
    action: 'apply_low_vram_preset',
    message: `${getStudioModelDisplayName(profile)} may exceed currently available accelerator memory.`,
    details: `${planLabel} requires about ${formatVram(requiredBytes)}; ${formatVram(availableBytes)} is projected to be available before the run${reclaimableBytes > 0 ? ` after reclaiming ${formatVram(reclaimableBytes)} of MoDiff cache` : ''}. Use Auto, release accelerator cache, or choose a lower-memory recipe if pressure persists.`,
  } satisfies Omit<RunReadinessIssue, 'id'>;
}

function isQwenQuantizedLowVram(form: StudioFormState) {
  return form.quantizationMode === QWEN_LOW_VRAM_QUANTIZATION_MODE;
}

function expectedLoaderNodeKey(form: StudioFormState) {
  if (form.modelType === 'WanVACEPipeline') return 'modules.DiffusersVideo.LoadPipeline';
  if (form.modelType === 'AceStepAudioPipeline') return 'modules.DiffusersAudio.LoadPipeline';
  if (form.modelType.startsWith('Flux')) return 'modules.DiffusersImage.LoadPipeline';
  if (
    form.mode === 'text_to_image' &&
    form.modelType === 'QwenImageModularPipeline' &&
    form.resourceMode !== 'expert'
  ) {
    return QWEN_T2I_PIPELINE_NODE_KEY;
  }
  if (['inpaint', 'outpaint'].includes(form.mode) && form.modelType === 'QwenImageEditModularPipeline') {
    return QWEN_INPAINT_PIPELINE_NODE_KEY;
  }
  return 'modules.ModularDiffusers.ModelsLoader';
}

function registryParam(
  registry: Record<string, { params?: Record<string, unknown> }>,
  nodeKey: string,
  paramKey: string,
) {
  return registry[nodeKey]?.params?.[paramKey];
}

function registryParamOptions(
  registry: Record<string, { params?: Record<string, unknown> }>,
  nodeKey: string,
  paramKey: string,
) {
  const param = registryParam(registry, nodeKey, paramKey);
  if (!param || typeof param !== 'object' || !('options' in param)) return [];
  const options = (param as { options?: unknown }).options;
  return runtimeOptionValues(options);
}

export function getStudioCudaCapacityIssue(
  form: StudioFormState,
  status: RuntimeStatus | null = useNodesStore.getState().runtimeStatus,
) {
  const resolvedForm = resolveStudioResourceForm(form, { runtimeStatus: status });
  if (resolvedForm.resourceMode !== 'expert') return null;
  const profile = getProfileForForm(resolvedForm);
  if (profile.family !== 'Qwen Image' || cudaIndexFromDevice(resolvedForm.device) === null) return null;

  const modelName = getStudioModelDisplayName(profile);
  const totalBytes = cudaTotalBytes(status, resolvedForm.device);
  if (resolvedForm.resourceMode === 'expert' && resolvedForm.dtype === 'float32') {
    return {
      category: 'hardware_fit',
      severity: 'error',
      blocking: true,
      action: 'apply_low_vram_preset',
      message: `${modelName} needs bfloat16 before running on CUDA.`,
      details: `${modelName} is memory-heavy in Diffusers. Use Auto for a hardware-aware recipe, or keep Expert on bfloat16 with offload enabled.`,
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  const hasSafeResidentBudget =
    Boolean(totalBytes) &&
    ((resolvedForm.quantizationMode === 'bnb_4bit' && totalBytes! >= 24 * GIB) ||
      (resolvedForm.quantizationMode === 'none' && totalBytes! >= 80 * GIB));
  if (resolvedForm.resourceMode === 'expert' && !resolvedForm.autoOffload && !hasSafeResidentBudget) {
    return {
      category: 'hardware_fit',
      severity: 'error',
      blocking: true,
      action: 'apply_low_vram_preset',
      message: `${modelName} needs auto-offload before running on CUDA.`,
      details: `${modelName} should use Auto or Expert offload on local GPUs so Diffusers does not move every component onto CUDA at once.`,
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  return null;
}

export function getStudioQuantizationCapabilityIssue(
  form: StudioFormState,
  registry = useNodesStore.getState().nodesRegistry,
) {
  const resolvedForm = resolveStudioResourceForm(form);
  const profile = getProfileForForm(resolvedForm);
  if (profile.family !== 'Qwen Image' || !isQwenQuantizedLowVram(resolvedForm)) return null;
  if (Object.keys(registry).length === 0) return null;

  const missing: string[] = [];
  const usesDirectQwenText =
    resolvedForm.mode === 'text_to_image' &&
    resolvedForm.modelType === 'QwenImageModularPipeline' &&
    resolvedForm.resourceMode !== 'expert';
  if (usesDirectQwenText) {
    if (!registry[QWEN_T2I_PIPELINE_NODE_KEY]) {
      missing.push(QWEN_T2I_PIPELINE_NODE_KEY);
    } else {
      for (const key of ['quantization_mode', 'quantized_components', 'offload_mode']) {
        if (!registryParam(registry, QWEN_T2I_PIPELINE_NODE_KEY, key)) {
          missing.push(`${QWEN_T2I_PIPELINE_NODE_KEY}.${key}`);
        }
      }
    }
    if (!registry[QWEN_T2I_GENERATE_NODE_KEY]) {
      missing.push(QWEN_T2I_GENERATE_NODE_KEY);
    }
  } else if (!registry[QWEN_QUANTIZATION_NODE_KEY]) {
    missing.push(QWEN_QUANTIZATION_NODE_KEY);
  } else if (
    !registryParamOptions(registry, QWEN_QUANTIZATION_NODE_KEY, 'component').includes(
      QWEN_LOW_VRAM_QUANTIZATION_COMPONENT,
    )
  ) {
    missing.push(`${QWEN_QUANTIZATION_NODE_KEY}.component=${QWEN_LOW_VRAM_QUANTIZATION_COMPONENT}`);
  }
  const loaderNodeKey = expectedLoaderNodeKey(resolvedForm);
  if (!registryParam(registry, loaderNodeKey, 'offload_mode')) {
    missing.push(`${loaderNodeKey}.offload_mode`);
  }
  if (missing.length === 0) return null;

  return {
    category: 'package',
    severity: 'error',
    blocking: true,
    action: 'open_setup',
    message: `${getStudioModelDisplayName(profile)} Expert 4-bit mode needs updated Diffusers backend support.`,
    details: `This backend did not expose ${missing.join(', ')}. Restart or update MoDiff so Qwen can run with Diffusers quantization and ${QWEN_LOW_VRAM_OFFLOAD_MODE} offload.`,
  } satisfies Omit<RunReadinessIssue, 'id'>;
}

export function getStudioOffloadCapabilityIssue(
  form: StudioFormState,
  registry = useNodesStore.getState().nodesRegistry,
) {
  const resolvedForm = resolveStudioResourceForm(form);
  const profile = getProfileForForm(resolvedForm);
  const offloadMode = normalizeStudioOffloadMode(resolvedForm.offloadMode);
  if (!offloadModeIsSupported(profile, offloadMode)) {
    return {
      category: 'hardware_fit',
      severity: 'error',
      blocking: true,
      action: 'open_setup',
      message: `${getStudioModelDisplayName(profile)} does not support ${STUDIO_OFFLOAD_LABELS[offloadMode]}.`,
      details: `Supported modes for this Studio profile: ${profile.offloadSupport.modes.map((mode) => STUDIO_OFFLOAD_LABELS[mode]).join(', ')}.`,
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  if (Object.keys(registry).length === 0) return null;

  const loaderNodeKey = expectedLoaderNodeKey(resolvedForm);
  const loader = registry[loaderNodeKey];
  if (!loader) return null;

  const offloadParam = registryParam(registry, loaderNodeKey, 'offload_mode');
  if (!offloadParam) {
    return {
      category: 'package',
      severity: 'error',
      blocking: true,
      action: 'open_setup',
      message: `${getStudioModelDisplayName(profile)} needs backend offload mode support.`,
      details: `${loaderNodeKey} did not expose offload_mode. Restart or update MoDiff before using ${STUDIO_OFFLOAD_LABELS[offloadMode]} in Studio.`,
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  const options = registryParamOptions(registry, loaderNodeKey, 'offload_mode');
  const legacyModelCpuOk = offloadMode === 'model_cpu' && options.includes('auto_cpu');
  if (options.length > 0 && !options.includes(offloadMode) && !legacyModelCpuOk) {
    return {
      category: 'package',
      severity: 'error',
      blocking: true,
      action: 'open_setup',
      message: `${STUDIO_OFFLOAD_LABELS[offloadMode]} is not available in this backend loader.`,
      details: `${loaderNodeKey}.offload_mode supports ${options.join(', ') || 'no advertised options'}. Restart or update MoDiff for repo-wide Diffusers offload support.`,
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  return null;
}

export function getStudioDeviceOffloadIssue(form: StudioFormState) {
  const details = studioOffloadPlanConflict({
    device: form.device,
    autoOffload: form.autoOffload,
    offloadMode: form.offloadMode,
  });
  if (!details) return null;
  return {
    category: 'hardware_fit',
    severity: 'error',
    blocking: true,
    action: 'open_setup',
    message: `${form.device} cannot run with ${STUDIO_OFFLOAD_LABELS[form.offloadMode]}.`,
    details,
  } satisfies Omit<RunReadinessIssue, 'id'>;
}

export function getStudioQwenInpaintCapabilityIssue(
  form: StudioFormState,
  registry = useNodesStore.getState().nodesRegistry,
) {
  if (!['inpaint', 'outpaint'].includes(form.mode) || form.modelType !== 'QwenImageEditModularPipeline') return null;
  if (Object.keys(registry).length === 0) return null;

  if (
    form.mode === 'inpaint' &&
    registry['modules.DiffusersImage.LoadPipeline'] &&
    registry['modules.DiffusersImage.Inpaint']
  ) {
    return null;
  }

  const requiredNodes =
    form.mode === 'outpaint'
      ? [QWEN_INPAINT_PIPELINE_NODE_KEY, QWEN_OUTPAINT_CANVAS_NODE_KEY, QWEN_INPAINT_GENERATE_NODE_KEY]
      : [QWEN_INPAINT_PIPELINE_NODE_KEY, QWEN_INPAINT_GENERATE_NODE_KEY];
  const missing = requiredNodes.filter((nodeKey) => !registry[nodeKey]);
  if (missing.length === 0) return null;

  return {
    category: 'package',
    severity: 'error',
    blocking: true,
    action: 'open_setup',
    message:
      form.mode === 'outpaint'
        ? 'Qwen outpaint needs canvas and mask support.'
        : 'Qwen inpaint needs backend mask execution support.',
    details: `This backend did not expose ${missing.join(', ')}. Restart or update MoDiff's generic image nodes, or use an edit workflow without a generated mask.`,
  } satisfies Omit<RunReadinessIssue, 'id'>;
}

export function getStudioMpsCompatibilityIssue(form: StudioFormState) {
  if (!isMpsDevice(form.device)) return null;

  const profile = getProfileForForm(form);
  if (profile.family === 'Qwen Image') {
    return {
      category: 'hardware_fit',
      severity: 'warning',
      blocking: false,
      action: form.mode === 'text_to_image' ? 'switch_to_z_image' : 'open_setup',
      message: `${profile.label} is not certified on Apple MPS.`,
      details:
        'This exact recipe has not been qualified on Apple Silicon. The run is allowed; use a CUDA backend or switch to Z-Image Turbo if MPS reports an unsupported operation or memory failure.',
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  if (profile.outputKind === 'video') {
    return {
      category: 'hardware_fit',
      severity: 'warning',
      blocking: false,
      action: 'open_setup',
      message: `${profile.label} is not certified on Apple MPS.`,
      details:
        'This exact video recipe has not been qualified on Apple Silicon. The run is allowed, but it may be slow or encounter an unsupported MPS operation; choose another device if that occurs.',
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  if (profile.family === 'Z-Image') {
    return {
      category: 'hardware_fit',
      severity: 'warning',
      blocking: false,
      action: 'open_setup',
      message: `${profile.label} on Apple MPS is experimental.`,
      details:
        'MoDiff can launch with MPS, but Z-Image output quality, memory behavior, and performance still need Apple Silicon proof before this is treated as production-ready.',
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  return null;
}

function getModelRepoFromNode(nodeId: string) {
  const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId);
  if (!node) return '';
  const params = node.data.params || {};
  const repoParam = params.repo_id ?? params.model_id;
  const value = repoParam?.value ?? repoParam?.default;
  return repoValueFromParam(value);
}

function collectGraphModelIssues(): RunReadinessIssue[] {
  const { nodes } = useFlowStore.getState();
  const { hfCache, localModels, modelCacheDiagnostics, discoveryRequests } = useNodesStore.getState();
  const modelDiscoveryStarted =
    discoveryRequests.hfCache.status !== 'idle' || discoveryRequests.localModels.status !== 'idle';
  const modelIndexesReady =
    discoveryRequests.hfCache.status === 'success' && discoveryRequests.localModels.status === 'success';
  // Empty or stale indexes while startup discovery is running are not proof
  // that an installed graph model is missing.
  if (modelDiscoveryStarted && !modelIndexesReady) return [];
  const graphReferences: WorkflowGraphArtifactReference[] = [];

  nodes.forEach((node) => {
    if (node.data.uiState?.disabled) return;

    const isModelLoader =
      node.data.module === 'modules.ModularDiffusers' && ['ModelsLoader', 'AutoModelLoader'].includes(node.data.action);
    const nodeReferences = collectNodeModelReferences(node);
    const loaderRepo = isModelLoader ? getModelRepoFromNode(node.id) : '';
    if (
      loaderRepo &&
      loaderRepo !== 'undefined' &&
      !nodeReferences.some((item) => item.kind === 'repo' && item.value === loaderRepo)
    ) {
      graphReferences.push({
        kind: 'repo',
        nodeId: node.id,
        nodeLabel: node.data.label || node.data.action,
        value: loaderRepo,
        paramKey: 'repo_id',
      });
    }

    nodeReferences.forEach((reference) => {
      graphReferences.push({
        ...reference,
        nodeId: node.id,
        nodeLabel: node.data.label || node.data.action,
      });
    });
  });

  return getGraphWorkflowArtifactRequirements({
    references: graphReferences,
    hfCache,
    localModels,
    modelCacheDiagnostics,
  })
    .filter((requirement) => !requirement.status.runnable)
    .map((requirement) =>
      issue({
        category: requirement.primaryAction === 'Repair' ? 'model_integrity' : 'model',
        severity: 'error',
        nodeId: requirement.nodeId,
        repoId: requirement.modelPath ? undefined : requirement.repo,
        modelPath: requirement.modelPath,
        blocking: true,
        action:
          requirement.primaryAction === 'Install' || requirement.primaryAction === 'Repair'
            ? 'install_model'
            : 'open_model_manager',
        message: requirement.modelPath
          ? `Model file is missing for imported workflow node ${requirement.nodeLabel || requirement.nodeId || 'unknown'}.`
          : `${requirement.repo} is required by imported workflow node ${requirement.nodeLabel || requirement.nodeId || 'unknown'}.`,
        details: requirement.details,
      }),
    );
}

function nodeParamValue(node: ReturnType<typeof enabledExecutableNodes>[number], key: string) {
  const param = node.data.params?.[key];
  return param?.value ?? param?.default;
}

export function collectGraphDeviceOffloadIssues(): RunReadinessIssue[] {
  return enabledExecutableNodes().flatMap((node) => {
    const device = nodeParamValue(node, 'device');
    if (typeof device !== 'string' || !device.trim()) return [];
    const autoOffload = nodeParamValue(node, 'auto_offload');
    const offloadMode = nodeParamValue(node, 'offload_mode');
    const details = studioOffloadPlanConflict({
      device,
      autoOffload: typeof autoOffload === 'boolean' ? autoOffload : undefined,
      offloadMode:
        offloadMode === 'model_cpu' ||
        offloadMode === 'sequential_cpu' ||
        offloadMode === 'group_cpu' ||
        offloadMode === 'group_disk'
          ? offloadMode
          : 'none',
    });
    if (!details) return [];
    return [
      issue({
        category: 'hardware_fit',
        severity: 'error',
        blocking: true,
        action: 'inspect_node',
        nodeId: node.id,
        message: `${node.data.label || node.data.action} has an invalid device/offload plan.`,
        details,
      }),
    ];
  });
}

function enabledExecutableNodes() {
  return useFlowStore
    .getState()
    .nodes.filter(
      (node) =>
        node.data.type !== 'group' &&
        node.data.type !== 'loop' &&
        !node.data.uiState?.disabled &&
        Boolean(node.data.module) &&
        Boolean(node.data.action),
    );
}

function isOutputLikeNode(node: ReturnType<typeof enabledExecutableNodes>[number]) {
  const text = `${node.data.module} ${node.data.action} ${node.data.label} ${node.data.category}`.toLowerCase();
  return (
    /\b(preview|export|save|display|output|gallery)\b/.test(text) ||
    /\.preview\b/i.test(`${node.data.module}.${node.data.action}`) ||
    /\.export\b/i.test(`${node.data.module}.${node.data.action}`)
  );
}

function collectGraphStructureIssues(): RunReadinessIssue[] {
  const { edges } = useFlowStore.getState();
  const executableNodes = enabledExecutableNodes();
  const executableNodeIds = new Set(executableNodes.map((node) => node.id));

  if (executableNodes.length === 0) {
    return [
      issue({
        category: 'graph',
        severity: 'error',
        blocking: true,
        action: 'inspect_node',
        message: 'Add nodes before running.',
        details: 'The graph has no enabled executable nodes.',
      }),
    ];
  }

  const outputNodes = executableNodes.filter(isOutputLikeNode);
  if (outputNodes.length === 0) {
    return [
      issue({
        category: 'graph',
        severity: 'error',
        blocking: true,
        action: 'inspect_node',
        message: 'Add a connected output node before running.',
        details: 'Use a Preview, Export, Save, Display, or output node so the graph can produce a visible result.',
      }),
    ];
  }

  const connectedOutput = outputNodes.find((node) =>
    edges.some((edge) => edge.target === node.id && executableNodeIds.has(edge.source)),
  );
  if (!connectedOutput) {
    return [
      issue({
        category: 'graph',
        severity: 'error',
        blocking: true,
        action: 'inspect_node',
        nodeId: outputNodes[0]?.id,
        message: 'Connect the graph to an output before running.',
        details: 'The graph has an output-like node, but no enabled node is connected into it.',
      }),
    ];
  }

  return [];
}

export function inspectCurrentGraph(): GraphInspectionSummary {
  const { nodes, edges } = useFlowStore.getState();
  const executableNodes = enabledExecutableNodes();
  const executableNodeIds = new Set(executableNodes.map((node) => node.id));
  const outputNodes = executableNodes.filter(isOutputLikeNode);
  const connectedOutputNodes = outputNodes.filter((node) =>
    edges.some((edge) => edge.target === node.id && executableNodeIds.has(edge.source)),
  );
  const connectedOutputNodeIds = new Set(connectedOutputNodes.map((node) => node.id));
  const modelRefs = executableNodes.flatMap((node) => {
    const references = collectNodeModelReferences(node);
    const isModelLoader =
      node.data.module === 'modules.ModularDiffusers' && ['ModelsLoader', 'AutoModelLoader'].includes(node.data.action);
    const loaderRepo = isModelLoader ? getModelRepoFromNode(node.id) : '';
    if (
      loaderRepo &&
      loaderRepo !== 'undefined' &&
      !references.some((item) => item.kind === 'repo' && item.value === loaderRepo)
    ) {
      references.push({ kind: 'repo', value: loaderRepo, paramKey: 'repo_id' });
    }
    return references.map((reference) => ({
      nodeId: node.id,
      nodeLabel: node.data.label || node.data.action,
      ...reference,
    }));
  });
  const issues = [...collectGraphStructureIssues(), ...collectGraphModelIssues(), ...collectGraphDeviceOffloadIssues()];

  return {
    nodeCount: nodes.length,
    enabledExecutableCount: executableNodes.length,
    outputNodeIds: outputNodes.map((node) => node.id),
    connectedOutputNodeIds: Array.from(connectedOutputNodeIds),
    outputPathCount: connectedOutputNodes.length,
    outputRefs: outputNodes.map((node) => ({
      nodeId: node.id,
      nodeLabel: node.data.label || node.data.action,
      connected: connectedOutputNodeIds.has(node.id),
    })),
    modelRefs,
    blockingIssues: issues.filter((item) => item.blocking),
  };
}

function describeInpaintContract(profile: StudioModelProfile) {
  const contract = profile.inpaintContract;
  if (!contract) return profile.modeRequirements?.inpaint?.note;
  const missingInputs = contract.missingInputs?.length ? ` Missing inputs: ${contract.missingInputs.join(', ')}.` : '';
  return `${contract.reason}${missingInputs} Source: ${contract.source}.`;
}

function collectStudioIssues(form: StudioFormState): RunReadinessIssue[] {
  const issues: RunReadinessIssue[] = [];
  const { hfCache, localModels, modelCacheDiagnostics } = useNodesStore.getState();
  const { graphBinding, autoResourcePlan, autoResourceCheck } = useStudioStore.getState();
  const profile = getProfileForForm(form);
  const modelStatus = getStudioModelCacheStatus(profile, hfCache, localModels, modelCacheDiagnostics);
  const autoCandidate = form.resourceMode === 'auto' ? selectedAutoCandidate(autoResourcePlan, form) : null;
  const autoInstallTarget = form.resourceMode === 'auto' ? autoResourceInstallTarget(autoResourcePlan, form) : null;
  const autoCompatibility = autoResourceCompatibility(autoResourcePlan, form);

  if (form.resourceMode === 'auto' && (!autoResourcePlan || !autoPlanIsReady(autoResourcePlan, form))) {
    const transientPlannerFailure = autoResourcePlan?.error === true;
    const runtimeIssue = autoPlanHasRuntimeIssue(autoResourcePlan);
    const autoIssueCategory = transientPlannerFailure
      ? 'backend'
      : runtimeIssue
        ? 'environment'
        : autoInstallTarget?.repair || autoResourcePlan?.repairRequired
          ? 'model_integrity'
          : autoResourcePlan?.issue?.category === 'package'
            ? 'package'
            : autoResourcePlan?.issue?.category === 'device'
              ? 'hardware_fit'
              : 'model';
    issues.push(
      issue({
        code: 'auto_plan_not_ready',
        category: autoIssueCategory,
        severity: autoCompatibility.severity,
        nodeId: runtimeIssue
          ? undefined
          : (graphBinding?.nodes.models ??
            graphBinding?.nodes.diffusersImagePipeline ??
            graphBinding?.nodes.audioPipeline ??
            graphBinding?.nodes.wanPipeline),
        repoId: runtimeIssue
          ? undefined
          : (autoCompatibility.action?.repo ?? autoInstallTarget?.repo ?? profile.defaultRepo),
        blocking: true,
        action: transientPlannerFailure
          ? undefined
          : autoInstallTarget
            ? 'install_model'
            : autoResourcePlan
              ? 'open_setup'
              : undefined,
        message: autoCompatibility.summary,
        details:
          autoInstallTarget?.reason ??
          autoResourcePlan?.repairAction?.command ??
          autoCompatibility.detail ??
          (autoResourceCheck.status === 'checking'
            ? autoResourceCheck.message
            : 'Wait for hardware and installed-model discovery before running this graph.') ??
          'Wait for Auto planning to finish.',
      }),
    );
  } else if (form.resourceMode !== 'auto' && !modelStatus.runnable) {
    issues.push(
      issue({
        category: 'model',
        severity: 'error',
        nodeId: graphBinding?.nodes.models,
        repoId: profile.defaultRepo,
        blocking: true,
        action: 'install_model',
        message: `${profile.label} is missing, so ${STUDIO_MODE_LABELS[form.mode]} cannot run.`,
        details: modelStatus.reason,
      }),
    );
  } else if (form.resourceMode === 'auto' && autoCandidate?.proof?.status) {
    const repo =
      autoCandidate.resolvedArtifact ??
      autoCandidate.artifact ??
      autoCandidate.installTarget?.repo ??
      autoCandidate.modelRepo;
    if (repo && autoCandidate.installed === false) {
      issues.push(
        issue({
          category: autoCandidate.repairRequired ? 'model_integrity' : 'model',
          severity: 'error',
          nodeId:
            graphBinding?.nodes.models ??
            graphBinding?.nodes.diffusersImagePipeline ??
            graphBinding?.nodes.audioPipeline ??
            graphBinding?.nodes.wanPipeline,
          repoId: repo,
          blocking: true,
          action: 'install_model',
          message: `${repo} is the selected Auto artifact and is not installed.`,
          details: autoCandidate.proof?.message ?? 'Install the Auto-selected artifact, then refresh model status.',
        }),
      );
    } else if (!autoProofIsReady(autoCandidate.proof)) {
      issues.push(
        issue({
          code: 'auto_plan_unqualified',
          category: 'hardware_fit',
          severity: 'warning',
          nodeId:
            graphBinding?.nodes.models ??
            graphBinding?.nodes.diffusersImagePipeline ??
            graphBinding?.nodes.audioPipeline ??
            graphBinding?.nodes.wanPipeline,
          repoId: repo || undefined,
          blocking: false,
          action: 'open_setup',
          message: `${profile.label} is runnable, but this exact Auto configuration is not qualified on the current runtime.`,
          details:
            autoCandidate.proof?.message ??
            'You can run it now. If it fails, MoDiff will identify the responsible node and suggest a compatible device, offload, quantization, or model change.',
        }),
      );
    }
  }

  getStudioWorkflowArtifactRequirements({
    form,
    autoResourcePlan,
    hfCache,
    localModels,
    modelCacheDiagnostics,
    includePipeline: false,
  }).forEach((requirement) => {
    const status = requirement.status;
    if (status.runnable) return;
    issues.push(
      issue({
        category: requirement.primaryAction === 'Repair' ? 'model_integrity' : 'model',
        severity: 'error',
        nodeId: graphBinding?.nodes.controlnetModel,
        repoId: requirement.repo,
        blocking: true,
        action: 'install_model',
        message: `${requirement.label} is required for ${STUDIO_MODE_LABELS[form.mode]} and is missing.`,
        details: status.reason,
      }),
    );
  });

  const requirements = profile.modeRequirements?.[form.mode]?.requiredImages ?? [];
  if (requirements.includes('referenceImages') && !form.referenceImages.some((image) => image.trim())) {
    issues.push(
      issue({
        category: 'asset',
        severity: 'error',
        blocking: true,
        action: 'select_image',
        message: 'A source image is required before this workflow can run.',
      }),
    );
  }
  if (requirements.includes('maskImage') && !form.maskImage.trim()) {
    issues.push(
      issue({
        category: 'asset',
        severity: 'error',
        blocking: true,
        action: 'select_image',
        message: 'A mask image is required before this workflow can run.',
      }),
    );
  }
  if (requirements.includes('controlImage') && !(form.controlImage.trim() || form.referenceImages[0]?.trim())) {
    issues.push(
      issue({
        category: 'asset',
        severity: 'error',
        blocking: true,
        action: 'select_image',
        message: 'A control image is required before this workflow can run.',
      }),
    );
  }

  const videoRequirements = profile.modeRequirements?.[form.mode]?.requiredVideos ?? [];
  if (videoRequirements.includes('sourceVideo') && !form.sourceVideo.trim()) {
    issues.push(
      issue({
        category: 'asset',
        severity: 'error',
        blocking: true,
        action: 'select_image',
        message: 'A source video is required before this workflow can run.',
      }),
    );
  }
  if (videoRequirements.includes('maskVideo') && !form.maskVideo.trim()) {
    issues.push(
      issue({
        category: 'asset',
        severity: 'error',
        blocking: true,
        action: 'select_image',
        message: 'A mask video is required before this workflow can run.',
      }),
    );
  }
  if (videoRequirements.includes('controlVideo') && !form.controlVideo.trim()) {
    issues.push(
      issue({
        category: 'asset',
        severity: 'error',
        blocking: true,
        action: 'select_image',
        message: 'A control video is required before this workflow can run.',
      }),
    );
  }

  const audioRequirements = profile.modeRequirements?.[form.mode]?.requiredAudio ?? [];
  if (audioRequirements.includes('sourceAudio') && !form.sourceAudio.trim()) {
    issues.push(
      issue({
        category: 'asset',
        severity: 'error',
        blocking: true,
        action: 'select_image',
        message: 'A source audio file is required before this workflow can run.',
      }),
    );
  }
  if (audioRequirements.includes('referenceAudio') && !form.referenceAudio.trim()) {
    issues.push(
      issue({
        category: 'asset',
        severity: 'error',
        blocking: true,
        action: 'select_image',
        message: 'A reference audio file is required before this workflow can run.',
      }),
    );
  }

  const modeNote = profile.modeRequirements?.[form.mode]?.note;
  if (form.mode === 'inpaint' && !profile.supportsMask) {
    const contractDetails = describeInpaintContract(profile);
    issues.push(
      issue({
        category: 'package',
        severity: 'error',
        blocking: true,
        action: 'open_setup',
        message: 'Inpaint is blocked because the backend has no native mask execution contract.',
        details: contractDetails ?? modeNote,
      }),
    );
  }

  const cudaCapacityIssue = form.resourceMode === 'expert' ? getStudioCudaCapacityIssue(form) : null;
  if (cudaCapacityIssue) {
    issues.push(issue(cudaCapacityIssue));
  } else {
    const cudaRecipePressureIssue = getStudioCudaRecipePressureIssue(form, autoCandidate);
    if (cudaRecipePressureIssue) issues.push(issue(cudaRecipePressureIssue));
  }

  const quantizationCapabilityIssue = getStudioQuantizationCapabilityIssue(form);
  if (quantizationCapabilityIssue) {
    issues.push(issue(quantizationCapabilityIssue));
  }

  const offloadCapabilityIssue = getStudioOffloadCapabilityIssue(form);
  if (offloadCapabilityIssue) {
    issues.push(issue(offloadCapabilityIssue));
  }
  const deviceOffloadIssue = getStudioDeviceOffloadIssue(form);
  if (deviceOffloadIssue) {
    issues.push(issue(deviceOffloadIssue));
  }

  const qwenInpaintCapabilityIssue = getStudioQwenInpaintCapabilityIssue(form);
  if (qwenInpaintCapabilityIssue) {
    issues.push(issue(qwenInpaintCapabilityIssue));
  }

  if (
    profile.outputKind === 'video' &&
    form.device.startsWith('cuda') &&
    form.resourceMode !== 'auto' &&
    form.dtype === 'float32'
  ) {
    issues.push(
      issue({
        category: 'hardware_fit',
        severity: 'warning',
        blocking: false,
        action: 'apply_low_vram_preset',
        message: `${profile.label} float32 video generation is memory-heavy.`,
        details:
          'Use Auto or a supported lower-precision dtype with offload if the projected memory check reports pressure.',
      }),
    );
  }

  const mpsCompatibilityIssue = form.resourceMode === 'expert' ? getStudioMpsCompatibilityIssue(form) : null;
  if (mpsCompatibilityIssue) {
    issues.push(issue(mpsCompatibilityIssue));
  }
  return issues;
}

export function collectRunReadinessIssues(options: {
  sid?: string | null;
  isConnected: boolean;
  includeStudio?: boolean;
}) {
  const issues: RunReadinessIssue[] = [];
  const studioState = useStudioStore.getState();
  if (
    studioState.canvasTransition?.type === 'template_graph_building' &&
    studioState.canvasTransition.workflowTabId === studioState.activeWorkflowTabId
  ) {
    return [
      issue({
        id: 'template-graph-preparing',
        category: 'graph',
        severity: 'info',
        blocking: true,
        action: 'inspect_node',
        message: 'Preparing graph',
        details: 'Run becomes available after the template graph is finalized and arranged.',
      }),
    ];
  }
  const customGraphContext = !studioState.graphBinding && useFlowStore.getState().nodes.length > 0;
  if (!options.sid || !options.isConnected) {
    issues.push(
      issue({
        category: 'backend',
        severity: 'error',
        blocking: true,
        action: 'open_setup',
        message: 'MoDiff backend is not connected.',
        details: 'Start or reconnect the backend before running this graph.',
      }),
    );
  }

  if (options.includeStudio !== false && !customGraphContext) {
    issues.push(...collectStudioIssues(studioState.form));
    const finalization = studioState.graphFinalization;
    if (finalization && finalization.status !== 'idle' && finalization.status !== 'complete') {
      issues.push(
        issue({
          category: 'graph',
          severity: finalization.status === 'error' ? 'error' : 'warning',
          blocking: true,
          action: 'inspect_node',
          message: finalization.message || 'Graph fields are still finalizing.',
          details: 'Run becomes available after the managed graph finishes wiring all required fields.',
        }),
      );
    }
    const managedGraphIssue = getStudioGraphRunBlockingMessage(studioState.form);
    if (managedGraphIssue) {
      issues.push(
        issue({
          category: 'graph',
          severity: 'warning',
          blocking: true,
          action: 'inspect_node',
          message: managedGraphIssue,
          details: 'Run becomes available after the managed graph exposes and connects its required fields.',
        }),
      );
    }
  }

  issues.push(...collectGraphStructureIssues());
  issues.push(...collectGraphModelIssues());
  issues.push(...collectGraphDeviceOffloadIssues());
  const unique = new Map<string, RunReadinessIssue>();
  issues.forEach((item) => {
    const key = `${item.nodeId ?? ''}:${item.repoId ?? ''}:${item.modelPath ?? ''}:${item.message}`;
    if (!unique.has(key)) unique.set(key, item);
  });
  return Array.from(unique.values());
}

export function applyRunReadinessToGraph(issues: RunReadinessIssue[]) {
  const flow = useFlowStore.getState();
  flow.clearNodeUiStates();
  issues.forEach((item) => {
    if (!item.nodeId) return;
    flow.setNodeUiState(item.nodeId, {
      validationSeverity: item.severity,
      validationMessage: item.details ? `${item.message} ${item.details}` : item.message,
    });
  });
}

export function validateCurrentRun(options: {
  sid?: string | null;
  isConnected: boolean;
  includeStudio?: boolean;
  showDialog?: boolean;
}) {
  const issues = collectRunReadinessIssues(options);
  applyRunReadinessToGraph(issues);
  const decision = buildRunReadinessDecision(issues);
  if (decision.blockingIssues.length > 0 && options.showDialog !== false) {
    useRunIssueStore.getState().showIssues(issues);
  }
  return {
    ...decision,
    blocking: decision.blockingIssues,
  };
}
