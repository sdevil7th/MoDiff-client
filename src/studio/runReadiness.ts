import { nanoid } from 'nanoid';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { useStudioStore } from '../stores/useStudioStore';
import { getStudioModelCacheStatus } from './modelCache';
import {
  getGraphWorkflowArtifactRequirements,
  getStudioWorkflowArtifactRequirements,
  type WorkflowGraphArtifactReference,
} from './artifactRequirements';
import {
  getProfileForForm,
  getStudioModelArtifactNote,
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
import { autoPlanIsReady, autoResourceInstallTarget, selectedAutoCandidate } from './autoResource';
import type { GraphInspectionSummary, RunReadinessIssue, StudioFormState, StudioModelProfile } from './types';
import type { RuntimeCudaDevice, RuntimeMpsDevice, RuntimeStatus } from '../stores/useNodeStore';

const GIB = 1024 ** 3;
export const QWEN_MIN_CUDA_TOTAL_BYTES = 20 * GIB;
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
  return {
    id: values.id ?? nanoid(),
    ...values,
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
    const value = compactModelString(repoValueFromParam(param.value ?? param.default));
    if (!value || value === 'undefined' || value === 'null') return;
    const modelRelated = paramLooksModelRelated(paramKey, param);
    if (isHfRepoId(value) && (modelRelated || paramKey === 'repo_id' || paramKey === 'model_id')) {
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

function indexFromDevice(device: string, prefix: 'cuda' | 'mps') {
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

export function getPreferredRuntimeDevice(status: RuntimeStatus | null) {
  const torchStatus = status?.packages?.torch;
  if (torchStatus?.cuda_available) return 'cuda:0';
  if (torchStatus?.mps_available) return 'mps:0';
  return 'cpu:0';
}

export function runtimeDeviceIsAvailable(status: RuntimeStatus | null, device: string) {
  if (!status) return true;
  const normalized = device.trim().toLowerCase();
  if (normalized.startsWith('cuda')) return Boolean(getRuntimeCudaDevice(status, device));
  if (normalized.startsWith('mps')) return Boolean(getRuntimeMpsDevice(status, device));
  if (normalized.startsWith('cpu')) return true;
  return false;
}

function cudaTotalBytes(status: RuntimeStatus | null, device: string) {
  const cudaDevice = getRuntimeCudaDevice(status, device);
  return cudaDevice?.memory_total_bytes ?? cudaDevice?.total_memory ?? null;
}

function isQwenQuantizedLowVram(form: StudioFormState) {
  return form.quantizationMode === QWEN_LOW_VRAM_QUANTIZATION_MODE;
}

function expectedLoaderNodeKey(form: StudioFormState) {
  if (form.modelType === 'WanVACEPipeline') return 'modules.WanVACE.LoadPipeline';
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
  return Array.isArray(options) ? options.map(String) : [];
}

export function getStudioCudaCapacityIssue(
  form: StudioFormState,
  status: RuntimeStatus | null = useNodesStore.getState().runtimeStatus,
) {
  const resolvedForm = resolveStudioResourceForm(form, { runtimeStatus: status });
  const profile = getProfileForForm(resolvedForm);
  if (profile.family !== 'Qwen Image' || cudaIndexFromDevice(resolvedForm.device) === null) return null;

  const modelName = getStudioModelDisplayName(profile);
  if (resolvedForm.resourceMode === 'expert' && resolvedForm.dtype === 'float32') {
    return {
      category: 'device',
      severity: 'error',
      blocking: true,
      action: 'apply_low_vram_preset',
      message: `${modelName} needs bfloat16 before running on CUDA.`,
      details: `${modelName} is memory-heavy in Diffusers. Use Auto for a hardware-aware recipe, or keep Expert on bfloat16 with offload enabled.`,
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  if (resolvedForm.resourceMode === 'expert' && !resolvedForm.autoOffload) {
    return {
      category: 'device',
      severity: 'error',
      blocking: true,
      action: 'apply_low_vram_preset',
      message: `${modelName} needs auto-offload before running on CUDA.`,
      details: `${modelName} should use Auto or Expert offload on local GPUs so Diffusers does not move every component onto CUDA at once.`,
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  const totalBytes = cudaTotalBytes(status, resolvedForm.device);
  if (!totalBytes || totalBytes >= QWEN_MIN_CUDA_TOTAL_BYTES || resolvedForm.resourceMode === 'expert') return null;

  return {
    category: 'device',
    severity: 'info',
    blocking: false,
    message: `${modelName} Auto will choose a local plan for this ${formatVram(totalBytes)} CUDA device.`,
    details: `Auto does not reject this GPU by size alone. It checks installed artifacts and hardware metadata, then runs the selected plan visibly through the graph. ${getStudioModelArtifactNote(profile)}.`,
  } satisfies Omit<RunReadinessIssue, 'id'>;
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
    category: 'backend',
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
      category: 'device',
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
      category: 'backend',
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
      category: 'backend',
      severity: 'error',
      blocking: true,
      action: 'open_setup',
      message: `${STUDIO_OFFLOAD_LABELS[offloadMode]} is not available in this backend loader.`,
      details: `${loaderNodeKey}.offload_mode supports ${options.join(', ') || 'no advertised options'}. Restart or update MoDiff for repo-wide Diffusers offload support.`,
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  return null;
}

export function getStudioQwenInpaintCapabilityIssue(
  form: StudioFormState,
  registry = useNodesStore.getState().nodesRegistry,
) {
  if (!['inpaint', 'outpaint'].includes(form.mode) || form.modelType !== 'QwenImageEditModularPipeline') return null;
  if (Object.keys(registry).length === 0) return null;

  const requiredNodes =
    form.mode === 'outpaint'
      ? [QWEN_INPAINT_PIPELINE_NODE_KEY, QWEN_OUTPAINT_CANVAS_NODE_KEY, QWEN_INPAINT_GENERATE_NODE_KEY]
      : [QWEN_INPAINT_PIPELINE_NODE_KEY, QWEN_INPAINT_GENERATE_NODE_KEY];
  const missing = requiredNodes.filter((nodeKey) => !registry[nodeKey]);
  if (missing.length === 0) return null;

  return {
    category: 'backend',
    severity: 'error',
    blocking: true,
    action: 'open_setup',
    message:
      form.mode === 'outpaint'
        ? 'Qwen outpaint needs direct backend canvas and mask support.'
        : 'Qwen inpaint needs direct backend mask execution support.',
    details: `This backend did not expose ${missing.join(', ')}. Restart or update the MoDiff backend with direct Qwen Image ${form.mode} nodes, or use an edit workflow without a generated mask.`,
  } satisfies Omit<RunReadinessIssue, 'id'>;
}

export function getStudioMpsCompatibilityIssue(form: StudioFormState) {
  if (!isMpsDevice(form.device)) return null;

  const profile = getProfileForForm(form);
  if (profile.family === 'Qwen Image') {
    return {
      category: 'device',
      severity: 'error',
      blocking: true,
      action: form.mode === 'text_to_image' ? 'switch_to_z_image' : 'open_setup',
      message: `${profile.label} is not certified on Apple MPS.`,
      details:
        'This Studio profile is guarded on Apple Silicon until a real MPS run proves the model contract and memory behavior. Use a CUDA backend, choose CPU only for a very slow experiment, or switch to Z-Image Turbo for local text-to-image smoke testing.',
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  if (profile.family === 'Wan Video') {
    return {
      category: 'device',
      severity: 'error',
      blocking: true,
      action: 'open_setup',
      message: `${profile.label} is not certified on Apple MPS.`,
      details:
        'Wan video workflows are CUDA-oriented and remain blocked on Apple Silicon until an end-to-end MPS video run is validated.',
    } satisfies Omit<RunReadinessIssue, 'id'>;
  }

  if (profile.family === 'Z-Image') {
    return {
      category: 'device',
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
  const { hfCache, localModels, modelCacheDiagnostics } = useNodesStore.getState();
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
        category: 'model',
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

function enabledExecutableNodes() {
  return useFlowStore
    .getState()
    .nodes.filter(
      (node) =>
        node.data.type !== 'group' &&
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
  const issues = [...collectGraphStructureIssues(), ...collectGraphModelIssues()];

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
  const { graphBinding, autoResourcePlan } = useStudioStore.getState();
  const profile = getProfileForForm(form);
  const modelStatus = getStudioModelCacheStatus(profile, hfCache, localModels, modelCacheDiagnostics);
  const autoCandidate = form.resourceMode === 'auto' ? selectedAutoCandidate(autoResourcePlan) : null;
  const autoInstallTarget = form.resourceMode === 'auto' ? autoResourceInstallTarget(autoResourcePlan) : null;

  if (form.resourceMode === 'auto' && autoResourcePlan && !autoPlanIsReady(autoResourcePlan)) {
    issues.push(
      issue({
        category: 'model',
        severity: 'error',
        nodeId:
          graphBinding?.nodes.models ??
          graphBinding?.nodes.diffusersImagePipeline ??
          graphBinding?.nodes.audioPipeline ??
          graphBinding?.nodes.wanPipeline,
        repoId: autoInstallTarget?.repo ?? profile.defaultRepo,
        blocking: true,
        action: autoInstallTarget ? 'install_model' : 'open_setup',
        message: autoInstallTarget
          ? `${autoInstallTarget.actionLabel ?? 'Install Auto artifact'}: ${autoInstallTarget.repo}`
          : `Auto cannot choose a runnable local plan for ${profile.label}.`,
        details:
          autoInstallTarget?.reason ??
          autoResourcePlan.blockingReason ??
          autoResourcePlan.message ??
          'Switch to Expert to inspect or create a custom graph.',
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
          category: 'model',
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
        category: 'model',
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
        category: 'input',
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
        category: 'input',
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
        category: 'input',
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
        category: 'input',
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
        category: 'input',
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
        category: 'input',
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
        category: 'input',
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
        category: 'input',
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
        category: 'backend',
        severity: 'error',
        blocking: true,
        action: 'open_setup',
        message: 'Inpaint is blocked because the backend has no native mask execution contract.',
        details: contractDetails ?? modeNote,
      }),
    );
  }

  const cudaCapacityIssue = getStudioCudaCapacityIssue(form);
  if (cudaCapacityIssue) {
    issues.push(issue(cudaCapacityIssue));
  } else if (
    profile.family === 'Qwen Image' &&
    form.device.startsWith('cuda') &&
    form.width * form.height >= 1024 * 1024 &&
    form.steps >= 40
  ) {
    issues.push(
      issue({
        category: 'device',
        severity: 'warning',
        blocking: false,
        action: 'apply_low_vram_preset',
        message: `${getStudioModelDisplayName(profile)} at ${form.width}x${form.height} for ${form.steps} steps is a high-VRAM CUDA run.`,
        details: `If this OOMs, use Auto, release accelerator cache, or switch to Z-Image Turbo. MoDiff will send backend runtime hints before execution.`,
      }),
    );
  }

  const quantizationCapabilityIssue = getStudioQuantizationCapabilityIssue(form);
  if (quantizationCapabilityIssue) {
    issues.push(issue(quantizationCapabilityIssue));
  }

  const offloadCapabilityIssue = getStudioOffloadCapabilityIssue(form);
  if (offloadCapabilityIssue) {
    issues.push(issue(offloadCapabilityIssue));
  }

  const qwenInpaintCapabilityIssue = getStudioQwenInpaintCapabilityIssue(form);
  if (qwenInpaintCapabilityIssue) {
    issues.push(issue(qwenInpaintCapabilityIssue));
  }

  if (profile.family === 'Wan Video' && form.device.startsWith('cuda')) {
    if (form.width * form.height > 832 * 480 || form.numFrames > 81 || form.steps > 50) {
      issues.push(
        issue({
          category: 'device',
          severity: 'warning',
          blocking: false,
          action: 'apply_low_vram_preset',
          message: `${profile.label} is above the 16GB-safe video preset.`,
          details: `Use Video preview or Video low VRAM if this run OOMs. Current request: ${form.width}x${form.height}, ${form.numFrames} frames, ${form.steps} steps.`,
        }),
      );
    }
    if (form.dtype === 'float32') {
      issues.push(
        issue({
          category: 'device',
          severity: 'warning',
          blocking: false,
          action: 'apply_low_vram_preset',
          message: 'float32 video generation is memory-heavy.',
          details: 'bfloat16 with auto-offload is the recommended Wan VACE setting for 16GB VRAM.',
        }),
      );
    }
  }

  const mpsCompatibilityIssue = getStudioMpsCompatibilityIssue(form);
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
  }

  issues.push(...collectGraphStructureIssues());
  issues.push(...collectGraphModelIssues());
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
  const blocking = issues.filter((item) => item.blocking);
  if (blocking.length > 0 && options.showDialog !== false) {
    useRunIssueStore.getState().showIssues(issues);
  }
  return {
    issues,
    blocking,
    canRun: blocking.length === 0,
  };
}
