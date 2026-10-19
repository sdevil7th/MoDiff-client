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
  const audio = template.example?.mediaType === 'audio';
  const artifact = template.modelArtifact ?? (audio ? template.workflowBlockSettings?.lora?.baseModel : undefined);
  const repository = artifact?.value ?? profile.default_repo;
  const exampleRevision = template.example?.modelRevision;
  const declared = profile.repository_revisions?.filter((pair) => pair.repo === repository);
  const revision =
    artifact?.revision ??
    (audio && !/^[a-f0-9]{40}$/u.test(exampleRevision ?? '')
      ? declared?.length === 1
        ? declared[0]!.revision
        : undefined
      : exampleRevision);
  if (
    !revision ||
    !/^[a-f0-9]{40}$/u.test(revision) ||
    (artifact && artifact.source !== 'hub') ||
    ![profile.default_repo, profile.fallback_repo, ...(profile.compatible_repos ?? [])].includes(repository) ||
    (!audio && repository !== profile.default_repo) ||
    (audio && declared && (declared.length !== 1 || declared[0]!.revision !== revision)) ||
    (audio && repository !== profile.default_repo && declared?.length !== 1) ||
    (exampleRevision && (!audio || /^[a-f0-9]{40}$/u.test(exampleRevision)) && exampleRevision !== revision)
  )
    return null;
  return { capability, profile, repository, revision };
}
