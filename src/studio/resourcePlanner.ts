import { STUDIO_MODEL_PROFILES, STUDIO_OFFLOAD_RUNTIME_LABELS } from './modelProfiles';
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
export const AUTO_RESOURCE_TARGET_KEYS = [
  'executionProfileId',
  'modelType',
  'mode',
  'loaderModule',
  'loaderAction',
  'executionPath',
  'pipelineClass',
] as const;
export const AUTO_RESOURCE_LOADER_TARGETS = [
  'modules.ModularDiffusers.ModelsLoader.modular-diffusers',
  'modules.DiffusersImage.LoadPipeline.direct-diffusers-image',
  'modules.DiffusersAudio.LoadPipeline.direct-diffusers-audio',
  'modules.DiffusersVideo.LoadPipeline.direct-diffusers-video',
  'modules.DiffusersVideo.LoadPipeline.direct-wan-vace',
] as const;
export function autoProofIsReady(proof: { status?: string } | null | undefined) {
  return ['passed', 'declared_safe', 'live_proven'].includes(proof?.status as string);
}
export type StudioResourceRetryPlan = {
  reason?: string;
  candidateId?: string;
  executionProfileId?: string;
  modelType?: string;
  mode?: string;
  loaderModule?: string;
  loaderAction?: string;
  executionPath?: string;
  pipelineClass?: string;
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

export function qwenDirectRetryPlansFromCandidates(
  candidates:
    | Array<{
        id?: string;
        executionProfileId?: string;
        modelType?: string;
        mode?: string;
        loaderModule?: string;
        loaderAction?: string;
        executionPath?: string;
        pipelineClass?: string;
        offloadMode?: string;
        proof?: { status?: string };
      }>
    | null
    | undefined,
  selectedId?: string | null,
): StudioResourceRetryPlan[] {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  if (!selectedId) return [];
  const selectedIndex = candidates.findIndex((candidate) => candidate.id === selectedId);
  if (selectedIndex < 0) return [];
  const selected = candidates[selectedIndex]!;
  if (AUTO_RESOURCE_TARGET_KEYS.some((key) => !selected[key]?.trim())) return [];
  return candidates
    .slice(selectedIndex + 1)
    .filter(
      (candidate) =>
        autoProofIsReady(candidate.proof) && AUTO_RESOURCE_TARGET_KEYS.every((key) => candidate[key] === selected[key]),
    )
    .map(
      (candidate) =>
        ({
          candidateId: candidate.id,
          ...Object.fromEntries(AUTO_RESOURCE_TARGET_KEYS.map((key) => [key, candidate[key]])),
          onCategories: ['oom', 'cuda_kernel'],
          onErrorCodes: ['cuda_kernel_unsupported', 'cuda_oom'],
        }) as StudioResourceRetryPlan,
    );
}

export function normalizeStudioResourceMode(value: unknown): StudioResourceMode {
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

export function resolveStudioResourcePlan(form: StudioFormState): StudioResourcePlan {
  const profile = STUDIO_MODEL_PROFILES[form.modelType];
  const mode = normalizeStudioResourceMode(form.resourceMode);
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
      resolvedModelRepo: profile.defaultRepo,
      resolvedArtifact: profile.defaultRepo,
      quantizedComponents: form.quantizationMode === 'bnb_4bit' ? ['transformer', 'text_encoder'] : [],
      retryOffloadModes: !supportsStudioCpuOffload(form.device)
        ? []
        : retryModesFor(execution.offloadMode, supportedModes),
      retryPlans: [],
      offloadDiskPath: execution.offloadMode === 'group_disk' ? 'data/offload/diffusers' : undefined,
      summary: `Expert: ${form.dtype}, ${form.quantizationMode}, ${STUDIO_OFFLOAD_RUNTIME_LABELS[execution.offloadMode]}`,
    };
  }

  const requestedOffloadMode = supportedOffload(supportedModes, profile.offloadSupport.default);
  const execution = normalizeStudioDeviceOffloadPlan({
    device: form.device,
    autoOffload: requestedOffloadMode !== 'none',
    offloadMode: requestedOffloadMode,
  });
  const offloadMode = execution.offloadMode;
  return {
    resourceMode: 'auto',
    resolvedResourceMode: 'auto',
    dtype: profile.defaultDtype,
    quantizationMode: 'none',
    autoOffload: execution.autoOffload,
    offloadMode,
    resolvedModelRepo: profile.defaultRepo,
    resolvedArtifact: profile.defaultRepo,
    quantizedComponents: [],
    retryOffloadModes: !supportsStudioCpuOffload(form.device) ? [] : retryModesFor(offloadMode, supportedModes),
    retryPlans: [],
    offloadDiskPath: offloadMode === 'group_disk' ? 'data/offload/diffusers' : undefined,
    summary: `Auto: ${profile.defaultDtype}, ${STUDIO_OFFLOAD_RUNTIME_LABELS[offloadMode]}`,
  };
}

export function resolveStudioResourceForm(form: StudioFormState): StudioFormState {
  const plan = resolveStudioResourcePlan(form);
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
