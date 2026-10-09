import type { StudioModelProfile, StudioTemplate } from './types';

/** Exact backend ownership for a fresh recipe, independent of Auto and media
 * qualification. It grants no package installation or execution permission. */
export function resolveTemplateModelSelection(template: StudioTemplate, capabilities: StudioModelProfile[]) {
  const selection = template.executionSelection;
  if (!selection) return null;
  const matching = capabilities.filter((item) => item.modelType === selection.bindingSpec.modelType);
  if (matching.length !== 1) return null;
  const capability = matching[0]!;
  const profiles = capability.executionProfiles?.filter((item) => item.id === selection.executionProfileId);
  if (profiles?.length !== 1) return null;
  const profile = profiles[0]!;
  if (
    template.modelType !== selection.bindingSpec.modelType ||
    template.mode !== selection.bindingSpec.mode ||
    profile.model_type !== selection.bindingSpec.modelType ||
    profile.pipeline_class !== selection.pipelineClass ||
    !profile.modes.includes(selection.bindingSpec.mode) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u.test(profile.default_repo)
  )
    return null;
  const artifact = template.modelArtifact;
  const revision = artifact?.revision ?? template.example?.modelRevision;
  if (
    !revision ||
    !/^[a-f0-9]{40}$/u.test(revision) ||
    (artifact && (artifact.source !== 'hub' || artifact.value !== profile.default_repo)) ||
    (template.example?.modelRevision && template.example.modelRevision !== revision)
  )
    return null;
  return { capability, profile, repository: profile.default_repo, revision };
}
