import { useMemo } from 'react';
import type { HfDownloadProgress, ModelCacheDiagnostics, NodeData, RuntimeStatus } from '../stores/useNodeStore';
import { autoPlanIsReady, autoResourceInstallTarget, type StudioAutoResourcePlan } from './autoResource';
import { getStudioWorkflowArtifactRequirements } from './artifactRequirements';
import { isHfDownloadActive } from './modelInstall';
import { getStudioModelCacheStatus } from './modelCache';
import {
  STUDIO_MODE_LABELS,
  getCompatibleModelsForMode,
  getProfileForForm,
  getStudioModelDisplayName,
} from './modelProfiles';
import {
  formatVram,
  getRuntimeCudaDevice,
  getRuntimeMpsDevice,
  getRuntimeXpuDevice,
  getStudioCudaCapacityIssue,
  getStudioDeviceOffloadIssue,
  getStudioMpsCompatibilityIssue,
  getStudioOffloadCapabilityIssue,
  getStudioQwenInpaintCapabilityIssue,
  getStudioQuantizationCapabilityIssue,
  isMpsDevice,
  isXpuDevice,
} from './runReadiness';
import type { StudioFormState, StudioMode, StudioModelProfile, StudioModelType } from './types';

type StudioReadinessOptions = {
  form: StudioFormState;
  hfCache: unknown[];
  localModels: unknown[];
  modelCacheDiagnostics: ModelCacheDiagnostics | null;
  runtimeStatus: RuntimeStatus | null;
  nodesRegistry: Record<string, NodeData>;
  hfDownloadProgress: Record<string, HfDownloadProgress>;
  isConnected: boolean;
  autoResourcePlan?: StudioAutoResourcePlan | null;
  backendCapabilities?: StudioModelProfile[];
};

export function useStudioReadiness({
  form,
  hfCache,
  localModels,
  modelCacheDiagnostics,
  runtimeStatus,
  nodesRegistry,
  hfDownloadProgress,
  isConnected,
  autoResourcePlan,
  backendCapabilities = [],
}: StudioReadinessOptions) {
  const capability = useMemo(() => {
    const fallback = getProfileForForm(form);
    const backend = backendCapabilities.find((item) => item.modelType === form.modelType);
    return backend ? { ...fallback, ...backend } : fallback;
  }, [backendCapabilities, form]);
  const compatibleModels = useMemo(() => {
    if (backendCapabilities.length === 0) {
      return getCompatibleModelsForMode(form.mode, { currentModelType: form.modelType });
    }
    const models = backendCapabilities
      .filter((item) => (item.runnableModes ?? item.modes).includes(form.mode))
      .map((item) => item.modelType as StudioModelType);
    return models.includes(form.modelType) ? models : [form.modelType, ...models];
  }, [backendCapabilities, form.mode, form.modelType]);
  const compatibleModes = useMemo(
    () => ((capability.runnableModes?.length ? capability.runnableModes : capability.modes) ?? []) as StudioMode[],
    [capability],
  );
  const modelStatus = useMemo(
    () => getStudioModelCacheStatus(capability, hfCache, localModels, modelCacheDiagnostics),
    [capability, hfCache, localModels, modelCacheDiagnostics],
  );
  const workflowArtifactRequirements = useMemo(
    () =>
      getStudioWorkflowArtifactRequirements({
        form,
        autoResourcePlan,
        hfCache,
        localModels,
        modelCacheDiagnostics,
        includePipeline: false,
      }),
    [autoResourcePlan, form, hfCache, localModels, modelCacheDiagnostics],
  );
  const modeRequirementStatuses = useMemo(
    () =>
      workflowArtifactRequirements.map((requirement) => ({
        requirement,
        status: requirement.status,
      })),
    [workflowArtifactRequirements],
  );

  const modeImageRequirements = capability.modeRequirements?.[form.mode]?.requiredImages ?? [];
  const modeVideoRequirements = capability.modeRequirements?.[form.mode]?.requiredVideos ?? [];
  const modeAudioRequirements = capability.modeRequirements?.[form.mode]?.requiredAudio ?? [];
  const requiresReferenceImage = modeImageRequirements.includes('referenceImages');
  const requiresMaskImage = modeImageRequirements.includes('maskImage');
  const requiresControlImage = modeImageRequirements.includes('controlImage');
  const requiresSourceVideo = modeVideoRequirements.includes('sourceVideo');
  const requiresMaskVideo = modeVideoRequirements.includes('maskVideo');
  const requiresControlVideo = modeVideoRequirements.includes('controlVideo');
  const requiresSourceAudio = modeAudioRequirements.includes('sourceAudio');
  const requiresReferenceAudio = modeAudioRequirements.includes('referenceAudio');
  const showImageTray =
    requiresReferenceImage ||
    form.mode === 'control_image' ||
    form.mode === 'inpaint' ||
    form.mode === 'layer_decomposition';
  const supportsMask = capability.supportsMask;
  const inpaintContract = capability.inpaintContract;
  const hasReferenceImages = form.referenceImages.some((image) => image.trim());
  const hasControlImage = Boolean(form.controlImage.trim() || form.referenceImages[0]?.trim());
  const hasMaskImage = Boolean(form.maskImage.trim());
  const hasSourceVideo = Boolean(form.sourceVideo.trim());
  const hasMaskVideo = Boolean(form.maskVideo.trim());
  const hasControlVideo = Boolean(form.controlVideo.trim());
  const hasSourceAudio = Boolean(form.sourceAudio.trim());
  const hasReferenceAudio = Boolean(form.referenceAudio.trim());
  const draftExecutionReason =
    form.mode === 'inpaint' && !supportsMask
      ? (inpaintContract?.reason ?? 'This model does not expose a supported inpaint mask execution contract yet.')
      : '';
  const missingModelReason =
    form.resourceMode !== 'auto' && !modelStatus.runnable
      ? `${getStudioModelDisplayName(capability)} is not installed in a runnable MoDiff model cache. Open Setup to install ${capability.defaultRepo}.`
      : '';
  const missingModeRequirement = modeRequirementStatuses.find((item) => !item.status.runnable);
  const missingModeRequirementReason = missingModeRequirement
    ? `${missingModeRequirement.requirement.label} is required for ${STUDIO_MODE_LABELS[form.mode]} and is not installed. Open Setup to install ${missingModeRequirement.requirement.repo}.`
    : '';
  const autoInstallTarget = useMemo(
    () => (form.resourceMode === 'auto' ? autoResourceInstallTarget(autoResourcePlan, form) : null),
    [autoResourcePlan, form],
  );
  const missingInstallTarget =
    autoInstallTarget ??
    (form.resourceMode !== 'auto' && !modelStatus.runnable
      ? { repo: capability.defaultRepo, label: capability.label }
      : missingModeRequirement
        ? { repo: missingModeRequirement.requirement.repo, label: missingModeRequirement.requirement.label }
        : null);
  const missingInstallProgress = missingInstallTarget ? hfDownloadProgress[missingInstallTarget.repo] : undefined;
  const missingInstallActive = isHfDownloadActive(missingInstallProgress);
  const missingInstallProgressKnown =
    typeof missingInstallProgress?.progress === 'number' &&
    missingInstallProgress.progress > 0 &&
    missingInstallProgress.progress < 1;
  const missingImageReason =
    requiresReferenceImage && !hasReferenceImages
      ? 'Add at least one reference image before running this Studio mode.'
      : '';
  const missingMaskImageReason = requiresMaskImage && !hasMaskImage ? 'Add one mask image before running Inpaint.' : '';
  const missingControlImageReason =
    requiresControlImage && !hasControlImage ? 'Add one control image before running Control image.' : '';
  const missingSourceVideoReason =
    requiresSourceVideo && !hasSourceVideo ? 'Add one source video before running this Studio mode.' : '';
  const missingMaskVideoReason =
    requiresMaskVideo && !hasMaskVideo ? 'Add one mask video before running this Studio mode.' : '';
  const missingControlVideoReason =
    requiresControlVideo && !hasControlVideo ? 'Add one control video before running this Studio mode.' : '';
  const missingSourceAudioReason =
    requiresSourceAudio && !hasSourceAudio ? 'Add one source audio file before running this Studio mode.' : '';
  const missingReferenceAudioReason =
    requiresReferenceAudio && !hasReferenceAudio ? 'Add one reference audio file before running this Studio mode.' : '';
  const cudaCapacityIssue = useMemo(
    () => (form.resourceMode === 'expert' ? getStudioCudaCapacityIssue(form, runtimeStatus) : null),
    [form, runtimeStatus],
  );
  const quantizationCapabilityIssue = useMemo(
    () => getStudioQuantizationCapabilityIssue(form, nodesRegistry),
    [form, nodesRegistry],
  );
  const offloadCapabilityIssue = useMemo(
    () => getStudioOffloadCapabilityIssue(form, nodesRegistry),
    [form, nodesRegistry],
  );
  const deviceOffloadIssue = useMemo(() => getStudioDeviceOffloadIssue(form), [form]);
  const qwenInpaintCapabilityIssue = useMemo(
    () => getStudioQwenInpaintCapabilityIssue(form, nodesRegistry),
    [form, nodesRegistry],
  );
  const mpsCompatibilityIssue = useMemo(
    () => (form.resourceMode === 'expert' ? getStudioMpsCompatibilityIssue(form) : null),
    [form],
  );
  const cudaDevice = useMemo(() => getRuntimeCudaDevice(runtimeStatus, form.device), [form.device, runtimeStatus]);
  const mpsDevice = useMemo(() => getRuntimeMpsDevice(runtimeStatus, form.device), [form.device, runtimeStatus]);
  const xpuDevice = useMemo(() => getRuntimeXpuDevice(runtimeStatus, form.device), [form.device, runtimeStatus]);
  const cudaTotalBytes = cudaDevice?.memory_total_bytes ?? cudaDevice?.total_memory ?? null;
  const cudaFreeBytes = cudaDevice?.memory_free_bytes ?? null;
  const cudaMemoryLabel = cudaTotalBytes
    ? `${formatVram(cudaFreeBytes)} free / ${formatVram(cudaTotalBytes)} total`
    : runtimeStatus
      ? 'memory unknown'
      : 'runtime status pending';
  const cudaCapacityReason = cudaCapacityIssue?.blocking ? cudaCapacityIssue.message : '';
  const quantizationCapabilityReason = quantizationCapabilityIssue?.blocking ? quantizationCapabilityIssue.message : '';
  const offloadCapabilityReason = offloadCapabilityIssue?.blocking ? offloadCapabilityIssue.message : '';
  const deviceOffloadReason = deviceOffloadIssue?.blocking ? deviceOffloadIssue.message : '';
  const qwenInpaintCapabilityReason = qwenInpaintCapabilityIssue?.blocking ? qwenInpaintCapabilityIssue.message : '';
  const mpsCompatibilityReason = mpsCompatibilityIssue?.blocking ? mpsCompatibilityIssue.message : '';
  const autoPlanReason =
    form.resourceMode === 'auto' && !autoPlanIsReady(autoResourcePlan, form)
      ? autoResourcePlan
        ? `${getStudioModelDisplayName(capability)}: ${
            autoInstallTarget?.reason ||
            autoResourcePlan.willNotWorkReason ||
            autoResourcePlan.blockingReason ||
            autoResourcePlan.message ||
            'Auto could not choose a runnable local recipe for this workflow.'
          }`
        : `${getStudioModelDisplayName(capability)}: Auto is choosing a compatible local recipe.`
      : '';
  const runBlockedReason =
    autoPlanReason ||
    missingModelReason ||
    missingModeRequirementReason ||
    missingImageReason ||
    missingMaskImageReason ||
    missingControlImageReason ||
    missingSourceVideoReason ||
    missingMaskVideoReason ||
    missingControlVideoReason ||
    missingSourceAudioReason ||
    missingReferenceAudioReason ||
    draftExecutionReason ||
    cudaCapacityReason ||
    quantizationCapabilityReason ||
    offloadCapabilityReason ||
    deviceOffloadReason ||
    qwenInpaintCapabilityReason ||
    mpsCompatibilityReason ||
    (!isConnected ? 'Connect to the MoDiff server before running the graph.' : '');

  return {
    capability,
    compatibleModels,
    compatibleModes,
    modelStatus,
    modeRequirementStatuses,
    showImageTray,
    supportsMask,
    inpaintContract,
    hasReferenceImages,
    hasControlImage,
    hasMaskImage,
    requiresReferenceImage,
    requiresMaskImage,
    requiresControlImage,
    draftExecutionReason,
    missingInstallTarget,
    missingInstallProgress,
    missingInstallActive,
    missingInstallProgressKnown,
    cudaCapacityIssue,
    quantizationCapabilityIssue,
    offloadCapabilityIssue,
    qwenInpaintCapabilityIssue,
    mpsCompatibilityIssue,
    cudaDevice,
    mpsDevice,
    xpuDevice,
    cudaMemoryLabel,
    runtimeDeviceLabel: isMpsDevice(form.device)
      ? (mpsDevice?.name ?? form.device)
      : isXpuDevice(form.device)
        ? (xpuDevice?.name ?? form.device)
        : (cudaDevice?.name ?? form.device),
    runBlockedReason,
  };
}
