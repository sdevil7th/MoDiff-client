import { useMemo } from 'react';
import { useNodesStore, type ModelCacheDiagnostics } from '../stores/useNodeStore';
import { studioWeightFormatProfile } from './weightFormat';
import { autoResourceInstallTarget, type StudioAutoResourcePlan } from './autoResource';
import { getStudioWorkflowArtifactRequirements } from './artifactRequirements';
import { getStudioModelCacheStatus } from './modelCache';
import { getCompatibleModelsForMode, getProfileForArtifactMode, getProfileForForm } from './modelProfiles';
import type { StudioFormState, StudioModelProfile, StudioModelType } from './types';
import { advertisedStudioModes } from './modelCapabilities';

type StudioReadinessOptions = {
  form: StudioFormState;
  hfCache: unknown[];
  localModels: unknown[];
  modelCacheDiagnostics: ModelCacheDiagnostics | null;
  autoResourcePlan?: StudioAutoResourcePlan | null;
  backendCapabilities?: StudioModelProfile[];
  backendCapabilitiesAuthoritative?: boolean;
};

export function useStudioReadiness({
  form,
  hfCache,
  localModels,
  modelCacheDiagnostics,
  autoResourcePlan,
  backendCapabilities = [],
  backendCapabilitiesAuthoritative = false,
}: StudioReadinessOptions) {
  const workflowModelDescriptors = useNodesStore((state) => state.workflowModelDescriptors);
  const studioExecutionSpecInvalid = useNodesStore((state) => state.studioExecutionSpecInvalid);
  const capability = useMemo(() => {
    const fallback = getProfileForForm(form);
    const backend = backendCapabilities.find((item) => item.modelType === form.modelType);
    return getProfileForArtifactMode(backend ? { ...fallback, ...backend } : fallback, form.mode);
  }, [backendCapabilities, form]);
  const compatibleModels = useMemo(() => {
    if (!backendCapabilitiesAuthoritative) {
      return getCompatibleModelsForMode(form.mode, { currentModelType: form.modelType });
    }
    const models = backendCapabilities
      .filter((item) => advertisedStudioModes(item).includes(form.mode))
      .map((item) => item.modelType as StudioModelType);
    return models;
  }, [backendCapabilities, backendCapabilitiesAuthoritative, form.mode, form.modelType]);
  const compatibleModes = useMemo(() => {
    if (!backendCapabilitiesAuthoritative) return capability.modes;
    const backend = backendCapabilities.find((item) => item.modelType === form.modelType);
    return backend ? advertisedStudioModes(backend) : [];
  }, [backendCapabilities, backendCapabilitiesAuthoritative, capability.modes, form.modelType]);
  const selectedCapability = useMemo(
    () =>
      studioWeightFormatProfile(
        form,
        capability,
        backendCapabilities,
        workflowModelDescriptors,
        studioExecutionSpecInvalid || !backendCapabilitiesAuthoritative,
      ),
    [
      form,
      capability,
      backendCapabilities,
      backendCapabilitiesAuthoritative,
      workflowModelDescriptors,
      studioExecutionSpecInvalid,
    ],
  );
  const modelStatus = useMemo(
    () => getStudioModelCacheStatus(selectedCapability, hfCache, localModels, modelCacheDiagnostics),
    [selectedCapability, hfCache, localModels, modelCacheDiagnostics],
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
        backendCapabilities,
        workflowModelDescriptors,
        studioExecutionSpecInvalid: studioExecutionSpecInvalid || !backendCapabilitiesAuthoritative,
      }),
    [
      autoResourcePlan,
      form,
      hfCache,
      localModels,
      modelCacheDiagnostics,
      backendCapabilities,
      backendCapabilitiesAuthoritative,
      workflowModelDescriptors,
      studioExecutionSpecInvalid,
    ],
  );
  const modeImageRequirements = capability.modeRequirements?.[form.mode]?.requiredImages ?? [];
  const requiresReferenceImage = modeImageRequirements.includes('referenceImages');
  const requiresMaskImage = modeImageRequirements.includes('maskImage');
  const requiresControlImage = modeImageRequirements.includes('controlImage');
  const requiresIPAdapterImage = modeImageRequirements.includes('ipAdapterImage');
  const showImageTray =
    requiresReferenceImage ||
    form.mode === 'control_image' ||
    form.mode === 'inpaint' ||
    form.mode === 'layer_decomposition';
  const supportsMask = capability.supportsMask;
  const inpaintContract = capability.inpaintContract;
  const missingModeRequirement = workflowArtifactRequirements.find((requirement) => !requirement.status.runnable);
  const autoInstallTarget = useMemo(
    () => (form.resourceMode === 'auto' ? autoResourceInstallTarget(autoResourcePlan, form) : null),
    [autoResourcePlan, form],
  );
  const exactCapabilityRevision =
    selectedCapability?.revisionCandidates?.length === 1 ? selectedCapability.revisionCandidates[0] : undefined;
  const missingInstallTarget =
    autoInstallTarget ??
    (form.resourceMode !== 'auto' &&
    selectedCapability &&
    selectedCapability.artifactInstallRequired !== false &&
    !modelStatus.runnable
      ? {
          repo: selectedCapability.defaultRepo,
          label: selectedCapability.label,
          revision: exactCapabilityRevision,
          files: selectedCapability.downloadFiles,
          ...(form.weightFormat !== undefined && form.weightFormat !== 'native'
            ? {
                repair: modelStatus.repairRequired,
                actionLabel: modelStatus.repairRequired ? 'Repair' : 'Install',
              }
            : {}),
        }
      : missingModeRequirement
        ? { repo: missingModeRequirement.repo, label: missingModeRequirement.label }
        : null);

  return {
    capability,
    compatibleModels,
    compatibleModes,
    showImageTray,
    requiresMaskImage,
    requiresControlImage,
    requiresIPAdapterImage,
    supportsMask,
    inpaintContract,
    missingInstallTarget,
  };
}
