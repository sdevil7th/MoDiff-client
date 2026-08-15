import { useMemo } from 'react';
import type { ModelCacheDiagnostics } from '../stores/useNodeStore';
import { autoResourceInstallTarget, type StudioAutoResourcePlan } from './autoResource';
import { getStudioWorkflowArtifactRequirements } from './artifactRequirements';
import { getStudioModelCacheStatus } from './modelCache';
import { getCompatibleModelsForMode, getProfileForForm } from './modelProfiles';
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
  const capability = useMemo(() => {
    const fallback = getProfileForForm(form);
    const backend = backendCapabilities.find((item) => item.modelType === form.modelType);
    return backend ? { ...fallback, ...backend } : fallback;
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
  const modeImageRequirements = capability.modeRequirements?.[form.mode]?.requiredImages ?? [];
  const requiresReferenceImage = modeImageRequirements.includes('referenceImages');
  const requiresMaskImage = modeImageRequirements.includes('maskImage');
  const requiresControlImage = modeImageRequirements.includes('controlImage');
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
  const missingInstallTarget =
    autoInstallTarget ??
    (form.resourceMode !== 'auto' && capability.artifactInstallRequired !== false && !modelStatus.runnable
      ? { repo: capability.defaultRepo, label: capability.label }
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
    supportsMask,
    inpaintContract,
    missingInstallTarget,
  };
}
