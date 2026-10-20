import { parsePipelineSupport, type PipelineSupport } from './operationCatalog';
import { boundedText, identifier, record, type OperationContract } from './operationContracts';
import type { WorkflowModelDescriptor } from './workflowChoices';

/** Explicit installed evaluation metadata only; never changes public model capabilities. */
export function parseEvaluationAuthoring(
  payload: Record<string, unknown>,
  support: PipelineSupport[],
  operations: OperationContract[],
): { support: PipelineSupport[]; descriptors: WorkflowModelDescriptor[] } {
  if (payload.evaluationAuthoring === undefined) return { support, descriptors: [] };
  const invalid = (): never => {
    throw new Error('Invalid evaluation authoring metadata.');
  };
  const item = record(payload.evaluationAuthoring, [
    'schemaVersion',
    'scope',
    'autoEligible',
    'templateEligible',
    'galleryEligible',
    'executionProfiles',
    'pipelineSupport',
  ]);
  if (
    item.schemaVersion !== 1 ||
    item.scope !== 'expert-authoring' ||
    item.autoEligible !== false ||
    item.templateEligible !== false ||
    item.galleryEligible !== false ||
    !Array.isArray(item.executionProfiles) ||
    !item.executionProfiles.length ||
    item.executionProfiles.length > 32 ||
    !Array.isArray(item.pipelineSupport) ||
    !Array.isArray(payload.capabilities)
  )
    invalid();
  const profiles = (item.executionProfiles as unknown[]).map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
    const profile = raw as Record<string, unknown>;
    if (
      profile.public !== false ||
      profile.live_proof !== false ||
      !Array.isArray(profile.modes) ||
      !profile.modes.length ||
      profile.modes.length > 64
    )
      invalid();
    return {
      id: boundedText(profile.id, 256),
      pipeline: identifier(profile.pipeline_class),
      model: identifier(profile.model_type),
      repo: boundedText(profile.default_repo, 512),
      modes: (profile.modes as unknown[]).map(identifier),
    };
  });
  const publicIds = new Set(support.flatMap((p) => p.tasks.flatMap((task) => task.executionProfileIds)));
  if (
    new Set(profiles.map((p) => p.id)).size !== profiles.length ||
    profiles.some((p) => publicIds.has(p.id) || new Set(p.modes).size !== p.modes.length)
  )
    invalid();
  const pipelines = new Set(profiles.map((p) => p.pipeline));
  // A private namespace may fill an unpublished pipeline, never replace public rows.
  if (support.some((p) => pipelines.has(p.pipelineClass) && p.tasks.some((task) => task.executionProfileIds.length)))
    invalid();
  const declared = parsePipelineSupport(
    item.pipelineSupport,
    1,
    operations.filter((operation) => pipelines.has(operation.pipelineClass)),
  );
  if (declared.length !== pipelines.size || declared.some((p) => !pipelines.has(p.pipelineClass))) invalid();
  const selected = new Set<string>();
  for (const pipeline of declared)
    for (const task of pipeline.tasks) {
      if (!task.executionProfileIds.length) invalid();
      for (const id of task.executionProfileIds) {
        const profile = profiles.find((p) => p.id === id && p.pipeline === pipeline.pipelineClass);
        if (!profile || !profile.modes.includes(task.task)) invalid();
        selected.add(id);
      }
    }
  if (selected.size !== profiles.length) invalid();
  const descriptors = profiles.map((profile): WorkflowModelDescriptor => {
    const matches = (payload.capabilities as unknown[]).filter(
      (raw) =>
        raw &&
        typeof raw === 'object' &&
        !Array.isArray(raw) &&
        (raw as Record<string, unknown>).modelType === profile.model,
    );
    if (matches.length !== 1) return invalid();
    const model = matches[0] as Record<string, unknown>;
    if (
      model.autoEligible !== false ||
      model.templateEligible !== false ||
      model.galleryEligible !== false ||
      model.liveProof !== false ||
      model.defaultRepo !== profile.repo
    )
      invalid();
    return {
      profileId: profile.id,
      pipeline: profile.pipeline,
      label: boundedText(model.label, 512),
      repo: profile.repo,
      evaluationOnly: true,
    };
  });
  return { support: [...support.filter((p) => !pipelines.has(p.pipelineClass)), ...declared], descriptors };
}
