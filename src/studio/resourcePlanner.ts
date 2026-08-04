import {
  QWEN_IMAGE_2512_PREQUANTIZED_REPO,
  STUDIO_MODEL_PROFILES,
  STUDIO_OFFLOAD_RUNTIME_LABELS,
} from './modelProfiles';
import { normalizeStudioDeviceOffloadPlan, supportsStudioCpuOffload } from './deviceOffload';
import type { StudioFormState, StudioOffloadMode, StudioResourceMode } from './types';

export const STUDIO_RESOURCE_MODES = ['auto', 'expert'] as const;

export const STUDIO_RESOURCE_LABELS: Record<StudioResourceMode, string> = {
  auto: 'Auto',
  expert: 'Expert',
};

export const STUDIO_RESOURCE_DESCRIPTIONS: Record<StudioResourceMode, string> = {
  auto: 'MoDiff checks local hardware, available resources, model requirements, and installed artifacts, then chooses the best known local recipe.',
  expert:
    'Expose precision, quantization, offload, device, and scheduler-level controls for debugging or custom graph work.',
};

const RESOURCE_RETRY_ORDER: StudioOffloadMode[] = ['model_cpu', 'sequential_cpu', 'group_disk'];
const QWEN_PRACTICAL_WIDTH = 1024;
const QWEN_PRACTICAL_HEIGHT = 1024;
const QWEN_AUTO_MAX_DIMENSION = 1344;
const QWEN_AUTO_PIXEL_BUDGET = QWEN_PRACTICAL_WIDTH * QWEN_PRACTICAL_HEIGHT;
const QWEN_NATIVE_STEPS = 50;
const QWEN_NATIVE_GUIDANCE = 4.0;
const QWEN_TRANSFORMER_ONLY_QUANTIZED_COMPONENTS = ['transformer'] as const;

export type StudioResourceRetryPlan = {
  reason: string;
  executionPath?: string;
  modelRepo?: string;
  resolvedArtifact?: string;
  quantizationMode?: StudioFormState['quantizationMode'];
  quantizedComponents?: string[];
  bnb4ComputeDtype?: StudioFormState['dtype'];
  offloadMode?: StudioOffloadMode;
  onCategories?: string[];
  onErrorCodes?: string[];
  generation?: {
    width?: number;
    height?: number;
    steps?: number;
    guidanceScale?: number;
    negativePrompt?: string;
    maxSequenceLength?: number;
    audioDuration?: number;
    shift?: number;
  };
};

type RuntimeStatusLike = unknown;

export type StudioResourcePlan = {
  resourceMode: StudioResourceMode;
  resolvedResourceMode: StudioResourceMode;
  dtype: StudioFormState['dtype'];
  quantizationMode: StudioFormState['quantizationMode'];
  autoOffload: boolean;
  offloadMode: StudioOffloadMode;
  executionPath?: string;
  resolvedModelRepo?: string;
  resolvedArtifact?: string;
  quantizedComponents: string[];
  retryOffloadModes: StudioOffloadMode[];
  retryPlans: StudioResourceRetryPlan[];
  offloadDiskPath?: string;
  summary: string;
};

export function getStudioResourceExecutionPathLabel(plan: Pick<StudioResourcePlan, 'executionPath' | 'resourceMode'>) {
  if (plan.resourceMode === 'expert') return 'Expert: full graph';
  if (plan.executionPath === 'direct-wan-vace') return 'Auto: Direct pipeline';
  if (plan.executionPath === 'direct-diffusers-audio') return 'Auto: Diffusers audio';
  if (plan.executionPath === 'direct-diffusers-image') return 'Auto: Diffusers image';
  if (plan.executionPath === 'modular-diffusers') return 'Auto: Modular graph';
  return 'Auto';
}

function supportedOffload(profileModes: StudioOffloadMode[], requested: StudioOffloadMode): StudioOffloadMode {
  if (profileModes.includes(requested)) return requested;
  if (profileModes.includes('model_cpu')) return 'model_cpu';
  if (profileModes.includes('sequential_cpu')) return 'sequential_cpu';
  if (profileModes.includes('group_cpu')) return 'group_cpu';
  return profileModes[0] ?? 'none';
}

function retryModesFor(offloadMode: StudioOffloadMode, supportedModes: StudioOffloadMode[]) {
  const supported = RESOURCE_RETRY_ORDER.filter((mode) => supportedModes.includes(mode));
  const currentIndex = supported.indexOf(offloadMode);
  return currentIndex >= 0 ? supported.slice(currentIndex + 1) : supported;
}

function isDirectQwenTextToImage(form: StudioFormState, resourceMode: StudioResourceMode) {
  return form.modelType === 'QwenImageModularPipeline' && form.mode === 'text_to_image' && resourceMode !== 'expert';
}

function qwenDimension(value: number, fallback: number) {
  const finite = Number.isFinite(value) && value > 0 ? value : fallback;
  return Math.max(256, Math.floor((finite + 1e-6) / 16) * 16);
}

export function getQwenAutoDimensions(form: Pick<StudioFormState, 'width' | 'height'>) {
  const requestedWidth = qwenDimension(form.width, QWEN_PRACTICAL_WIDTH);
  const requestedHeight = qwenDimension(form.height, QWEN_PRACTICAL_HEIGHT);
  const requestedPixels = requestedWidth * requestedHeight;
  const scale = Math.min(
    1,
    Math.sqrt(QWEN_AUTO_PIXEL_BUDGET / requestedPixels),
    QWEN_AUTO_MAX_DIMENSION / Math.max(requestedWidth, requestedHeight),
  );

  return {
    width: qwenDimension(requestedWidth * scale, QWEN_PRACTICAL_WIDTH),
    height: qwenDimension(requestedHeight * scale, QWEN_PRACTICAL_HEIGHT),
  };
}

function qwenGenerationDefaults(form: StudioFormState) {
  const dimensions = getQwenAutoDimensions(form);
  return {
    ...dimensions,
    steps: QWEN_NATIVE_STEPS,
    guidanceScale: QWEN_NATIVE_GUIDANCE,
    negativePrompt: form.negativePrompt.trim() || ' ',
    maxSequenceLength: form.maxSequenceLength || 512,
  };
}

export function qwenDirectRetryPlansFromCandidates(
  candidates:
    | Array<{
        id?: string;
        executionPath?: string;
        modelRepo?: string;
        resolvedArtifact?: string;
        artifact?: string;
        quantizationMode?: string;
        quantizedComponents?: string[];
        bnb4ComputeDtype?: string;
        offloadMode?: string;
        proof?: { status?: string };
        generation?: StudioResourceRetryPlan['generation'];
      }>
    | null
    | undefined,
  selectedId?: string | null,
  form?: StudioFormState,
): StudioResourceRetryPlan[] {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const selectedIndex = selectedId ? candidates.findIndex((candidate) => candidate.id === selectedId) : -1;
  return candidates
    .slice(selectedIndex >= 0 ? selectedIndex + 1 : 0)
    .filter((candidate) => ['passed', 'declared_safe', 'live_proven'].includes(candidate.proof?.status ?? ''))
    .filter((candidate) => !form || supportsStudioCpuOffload(form.device) || candidate.offloadMode === 'none')
    .map((candidate) => ({
      reason: `auto_candidate_${candidate.id ?? 'fallback'}`,
      executionPath: candidate.executionPath,
      modelRepo: candidate.modelRepo ?? candidate.resolvedArtifact ?? candidate.artifact,
      resolvedArtifact: candidate.resolvedArtifact ?? candidate.artifact ?? candidate.modelRepo,
      quantizationMode: candidate.quantizationMode === 'bnb_4bit' ? 'bnb_4bit' : 'none',
      quantizedComponents: candidate.quantizedComponents ?? [],
      bnb4ComputeDtype:
        candidate.bnb4ComputeDtype === 'float16' || candidate.bnb4ComputeDtype === 'float32'
          ? candidate.bnb4ComputeDtype
          : 'bfloat16',
      offloadMode: candidate.offloadMode as StudioOffloadMode | undefined,
      generation:
        form?.modelType === 'QwenImageModularPipeline' && form.mode === 'text_to_image'
          ? { ...candidate.generation, ...getQwenAutoDimensions(form) }
          : candidate.generation,
      onCategories: ['oom', 'cuda_kernel'],
      onErrorCodes: ['cuda_kernel_unsupported', 'cuda_oom'],
    }));
}

function qwenManualRetryPlans(form: StudioFormState): StudioResourceRetryPlan[] {
  if (!isDirectQwenTextToImage(form, normalizeStudioResourceMode(form.resourceMode, form))) return [];
  const officialRepo = STUDIO_MODEL_PROFILES.QwenImageModularPipeline.defaultRepo;
  const generation = qwenGenerationDefaults(form);
  return [
    {
      reason: 'qwen_manual_transformer_only_after_bnb_text_encoder_kernel_failure',
      executionPath: 'direct-diffusers-image',
      modelRepo: officialRepo,
      resolvedArtifact: officialRepo,
      quantizationMode: 'bnb_4bit',
      quantizedComponents: [...QWEN_TRANSFORMER_ONLY_QUANTIZED_COMPONENTS],
      bnb4ComputeDtype: 'bfloat16',
      offloadMode: 'model_cpu',
      generation,
      onErrorCodes: ['cuda_kernel_unsupported'],
    },
    {
      reason: 'qwen_manual_prequantized_artifact_after_kernel_or_oom',
      executionPath: 'direct-diffusers-image',
      modelRepo: QWEN_IMAGE_2512_PREQUANTIZED_REPO,
      resolvedArtifact: QWEN_IMAGE_2512_PREQUANTIZED_REPO,
      quantizationMode: 'none',
      quantizedComponents: [],
      offloadMode: 'model_cpu',
      generation,
      onCategories: ['oom', 'cuda_kernel'],
      onErrorCodes: ['cuda_kernel_unsupported'],
    },
  ];
}

export function normalizeStudioResourceMode(value: unknown, form?: StudioFormState): StudioResourceMode {
  void form;
  if (value === 'manual' || value === 'expert') return 'expert';
  if (
    value === 'auto' ||
    value === 'prefer_speed' ||
    value === 'prefer_low_memory' ||
    value === 'maximum_compatibility'
  ) {
    return 'auto';
  }
  return 'auto';
}

export function resolveStudioResourcePlan(
  form: StudioFormState,
  options: { runtimeStatus?: RuntimeStatusLike } = {},
): StudioResourcePlan {
  void options;
  const profile = STUDIO_MODEL_PROFILES[form.modelType];
  const mode = normalizeStudioResourceMode(form.resourceMode, form);
  const supportedModes = profile.offloadSupport.modes;

  if (mode === 'expert') {
    const execution = normalizeStudioDeviceOffloadPlan({
      device: form.device,
      autoOffload: form.autoOffload,
      offloadMode: form.offloadMode,
    });
    return {
      resourceMode: 'expert',
      resolvedResourceMode: 'expert',
      dtype: form.dtype,
      quantizationMode: form.quantizationMode,
      autoOffload: execution.autoOffload,
      offloadMode: execution.offloadMode,
      executionPath: 'modular-diffusers',
      resolvedModelRepo: profile.defaultRepo,
      resolvedArtifact: profile.defaultRepo,
      quantizedComponents: form.quantizationMode === 'bnb_4bit' ? ['transformer', 'text_encoder'] : [],
      retryOffloadModes: !supportsStudioCpuOffload(form.device)
        ? []
        : retryModesFor(execution.offloadMode, supportedModes),
      retryPlans: qwenManualRetryPlans(form),
      offloadDiskPath: execution.offloadMode === 'group_disk' ? 'data/offload/diffusers' : undefined,
      summary: `Expert: ${form.dtype}, ${form.quantizationMode}, ${STUDIO_OFFLOAD_RUNTIME_LABELS[execution.offloadMode]}`,
    };
  }

  const isQwenT2I = isDirectQwenTextToImage(form, mode);
  const requestedOffloadMode = supportedOffload(
    supportedModes,
    isQwenT2I ? 'model_cpu' : profile.offloadSupport.default,
  );
  const execution = normalizeStudioDeviceOffloadPlan({
    device: form.device,
    autoOffload: requestedOffloadMode !== 'none',
    offloadMode: requestedOffloadMode,
  });
  const offloadMode = execution.offloadMode;
  const executionPath = isQwenT2I
    ? 'direct-diffusers-image'
    : profile.family === 'Wan Video'
      ? 'direct-wan-vace'
      : profile.family === 'LTX Video'
        ? 'direct-diffusers-video'
        : profile.family === 'ACE Audio'
          ? 'direct-diffusers-audio'
          : profile.family === 'FLUX Image'
            ? 'direct-diffusers-image'
            : 'modular-diffusers';

  const qwenDimensions = isQwenT2I ? getQwenAutoDimensions(form) : null;

  return {
    resourceMode: 'auto',
    resolvedResourceMode: 'auto',
    dtype: profile.defaultDtype,
    quantizationMode: 'none',
    autoOffload: execution.autoOffload,
    offloadMode,
    executionPath,
    resolvedModelRepo: profile.defaultRepo,
    resolvedArtifact: profile.defaultRepo,
    quantizedComponents: [],
    retryOffloadModes: !supportsStudioCpuOffload(form.device) ? [] : retryModesFor(offloadMode, supportedModes),
    retryPlans: [],
    offloadDiskPath: offloadMode === 'group_disk' ? 'data/offload/diffusers' : undefined,
    summary: isQwenT2I
      ? `Auto: awaiting local Qwen recipe, ${qwenDimensions?.width}x${qwenDimensions?.height}, ${QWEN_NATIVE_STEPS} steps, CFG ${QWEN_NATIVE_GUIDANCE}`
      : `Auto: ${profile.defaultDtype}, ${STUDIO_OFFLOAD_RUNTIME_LABELS[offloadMode]}`,
  };
}

export function resolveStudioResourceForm(
  form: StudioFormState,
  options: { runtimeStatus?: RuntimeStatusLike } = {},
): StudioFormState {
  const plan = resolveStudioResourcePlan(form, options);
  if (plan.resourceMode === 'expert') {
    return normalizeStudioDeviceOffloadPlan({
      ...form,
      resourceMode: 'expert',
      autoOffload: plan.autoOffload,
      offloadMode: plan.offloadMode,
    });
  }

  return normalizeStudioDeviceOffloadPlan({
    ...form,
    resourceMode: 'auto',
    dtype: plan.dtype,
    quantizationMode: plan.quantizationMode,
    autoOffload: plan.autoOffload,
    offloadMode: plan.offloadMode,
  });
}
