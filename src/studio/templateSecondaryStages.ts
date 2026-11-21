import type { NodeData } from '../stores/useNodeStore';
import type { OperationContract } from '../workflow/operationContracts';
import { operationOwnsModel } from '../workflow/operationContracts';
import { withOperationAuthoring } from '../workflow/operationAuthoring';
import { requestOperationStarter } from '../workflow/operationStarterRequest';
import type { StudioModelProfile, StudioTemplate, StudioExecutionSpec } from './types';
import type { OperationStarter } from '../workflow/operationAuthoring';

export type TemplateSecondaryVideo = {
  starter: OperationStarter;
  spec: StudioExecutionSpec;
  capability: StudioModelProfile;
};

export async function templateSecondaryVideoStages(
  template: StudioTemplate,
  registry: Record<string, NodeData>,
  capabilities: readonly StudioModelProfile[],
  operations: readonly OperationContract[],
  request: typeof requestOperationStarter = requestOperationStarter,
): Promise<{ registry: Record<string, NodeData>; video?: TemplateSecondaryVideo }> {
  const settings = template.workflowBlockSettings?.lyricVideo;
  if (settings?.recipeVersion !== 'nine-scenes:v2') return { registry };
  const artifact = settings.visualModel;
  const selection = settings.visualExecutionSelection;
  const candidates = capabilities.flatMap((capability) =>
    (capability.executionProfiles ?? []).flatMap((profile) =>
      selection?.task === 'image_to_video' &&
      selection.bindingSpec.mode === 'image_to_video' &&
      selection.bindingSpec.modelType === capability.modelType &&
      selection.executionProfileId === profile.id &&
      selection.pipelineClass === profile.pipeline_class &&
      profile.model_type === capability.modelType &&
      profile.modes.includes('image_to_video') &&
      (profile.repository_revisions
        ? profile.repository_revisions.some(
            (item) => item.repo === artifact.value && item.revision === artifact.revision,
          )
        : profile.default_repo === artifact.value)
        ? [{ capability, profile }]
        : [],
    ),
  );
  const selectedProfile = candidates.length === 1 ? candidates[0] : undefined;
  const capability = selectedProfile?.capability;
  const spec = capability?.studioExecutionSpecs?.find(
    (item) =>
      item.mode === 'image_to_video' &&
      item.executionProfileId === selectedProfile?.profile.id &&
      item.pipelineClass === selectedProfile.profile.pipeline_class,
  );
  if (
    !capability ||
    !spec ||
    artifact.source !== 'hub' ||
    !artifact.revision ||
    !/^[a-f0-9]{40}$/u.test(artifact.revision)
  )
    throw new Error('The visual branch needs its reviewed image-to-video capability and immutable model.');
  const starter = await request(
    spec.pipelineClass,
    'image_to_video',
    [...operations],
    undefined,
    spec.executionProfileId,
    selection!.authoringRecipeId,
    artifact.value,
  );
  const owners = starter.nodes.filter((item) => operationOwnsModel(item.operation));
  const owner = owners.length === 1 ? owners[0] : undefined;
  const selected = owner && (owner.node.params.repo_id ?? owner.node.params.model_id);
  const value = selected?.value ?? selected?.default;
  if (
    !owner ||
    starter.pipelineClass !== spec.pipelineClass ||
    starter.task !== 'image_to_video' ||
    starter.authoring?.id !== 'generic-video-stages:v1' ||
    !value ||
    typeof value !== 'object' ||
    !('source' in value) ||
    value.source !== 'hub' ||
    !('value' in value) ||
    value.value !== artifact.value ||
    (owner.node.params.revision?.value ?? owner.node.params.revision?.default) !== artifact.revision
  )
    throw new Error('The backend resolved a different immutable visual model.');
  const enriched = { ...registry };
  for (const row of starter.nodes) {
    if (`${row.node.module}.${row.node.action}` !== row.operation.nodeKey)
      throw new Error('The visual stage schema does not match its declared operation.');
    enriched[row.operation.nodeKey] = withOperationAuthoring(row.node, row.operation);
  }
  return { registry: enriched, video: { starter, spec, capability } };
}

/** Resolve a secondary model's actual schema before its ordinary nodes are
 * created. Registry discovery alone has no selected-profile stage ownership. */
export async function templateSecondaryStageRegistry(
  template: StudioTemplate,
  registry: Record<string, NodeData>,
  capabilities: readonly StudioModelProfile[],
  operations: readonly OperationContract[],
  request: typeof requestOperationStarter = requestOperationStarter,
): Promise<Record<string, NodeData>> {
  if (!template.workflowBlocks?.includes('soundtrack')) return registry;
  const settings = template.workflowBlockSettings?.soundtrack;
  if (
    !settings ||
    settings.model.source !== 'hub' ||
    !settings.model.revision ||
    !/^[a-f0-9]{40}$/u.test(settings.model.revision)
  )
    throw new Error('The soundtrack needs one reviewed immutable model selection.');
  const task = 'text_to_audio';
  const profiles = capabilities
    .flatMap((item) => item.executionProfiles ?? [])
    .filter(
      (profile) =>
        profile.pipeline_class === settings.pipelineClass &&
        profile.modes.includes(task) &&
        profile.repository_revisions?.some(
          (item) => item.repo === settings.model.value && item.revision === settings.model.revision,
        ),
    );
  if (profiles.length !== 1)
    throw new Error('The soundtrack model profile is unavailable or ambiguous. Refresh model capabilities.');
  const starter = await request(
    settings.pipelineClass,
    task,
    [...operations],
    undefined,
    profiles[0]!.id,
    undefined,
    settings.model.value,
  );
  const owners = starter.nodes.filter((item) => operationOwnsModel(item.operation));
  const owner = owners.length === 1 ? owners[0] : undefined;
  const repository = owner && (owner.node.params.repo_id ?? owner.node.params.model_id);
  const selection = repository?.value ?? repository?.default;
  const revision = owner?.node.params.revision?.value ?? owner?.node.params.revision?.default;
  if (
    starter.pipelineClass !== settings.pipelineClass ||
    starter.task !== task ||
    !owner ||
    !selection ||
    typeof selection !== 'object' ||
    !('source' in selection) ||
    selection.source !== 'hub' ||
    !('value' in selection) ||
    selection.value !== settings.model.value ||
    revision !== settings.model.revision
  )
    throw new Error('The backend resolved a different immutable soundtrack model.');
  const result = { ...registry };
  for (const row of starter.nodes) {
    if (`${row.node.module}.${row.node.action}` !== row.operation.nodeKey)
      throw new Error('The soundtrack stage schema does not match its declared operation.');
    result[row.operation.nodeKey] = withOperationAuthoring(row.node, row.operation);
  }
  return result;
}
