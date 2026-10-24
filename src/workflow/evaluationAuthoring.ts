import { parsePipelineSupport, type PipelineSupport } from './operationCatalog';
import { boundedText, identifier, record, type OperationContract } from './operationContracts';
import type { WorkflowModelDescriptor } from './workflowChoices';
import { parseImageAdapterAuthoringPolicy, parseOptionalRuntimeExecutionProfiles } from '../studio/optionalRuntimes';

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
  const hasRecipes =
    payload.evaluationAuthoring !== null &&
    typeof payload.evaluationAuthoring === 'object' &&
    Object.prototype.hasOwnProperty.call(payload.evaluationAuthoring, 'authoringRecipes');
  const item = record(payload.evaluationAuthoring, [
    'schemaVersion',
    'scope',
    'autoEligible',
    'templateEligible',
    'galleryEligible',
    'executionProfiles',
    'pipelineSupport',
    ...(hasRecipes ? ['authoringRecipes'] : []),
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
      raw: profile,
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
  const recipes = new Map<string, Record<string, string>>();
  if (hasRecipes) {
    if (!Array.isArray(item.authoringRecipes) || item.authoringRecipes.length > 4) invalid();
    for (const raw of item.authoringRecipes as unknown[]) {
      const row = record(raw, ['executionProfileId', 'pipelineClass', 'task', 'authoringRecipeId']);
      const profileId = boundedText(row.executionProfileId, 256);
      const task = identifier(row.task);
      const profile = profiles.find((p) => p.id === profileId && p.pipeline === row.pipelineClass);
      if (
        !profile ||
        !profile.modes.includes(task) ||
        !declared.some(
          (pipeline) =>
            pipeline.pipelineClass === profile.pipeline &&
            pipeline.tasks.some((row) => row.task === task && row.executionProfileIds.includes(profileId)),
        )
      )
        invalid();
      const byTask = recipes.get(profileId) ?? {};
      if (Object.prototype.hasOwnProperty.call(byTask, task)) invalid();
      byTask[task] = boundedText(row.authoringRecipeId, 256);
      recipes.set(profileId, byTask);
    }
  }
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
    let adapterAuthoringProfile: WorkflowModelDescriptor['adapterAuthoringProfile'];
    if (Object.prototype.hasOwnProperty.call(profile.raw, 'adapterAuthoring')) {
      const [parsed] = parseOptionalRuntimeExecutionProfiles(
        [structuredClone(profile.raw)],
        undefined,
        (mode): mode is string => typeof mode === 'string' && profile.modes.includes(mode),
      );
      const adapterAuthoring = parseImageAdapterAuthoringPolicy(
        parsed!.adapterAuthoring,
        profile.modes,
        parsed!.repository_revisions as { repo: string; revision: string }[] | undefined,
        {
          loader_module: boundedText(parsed!.loader_module, 256),
          loader_action: identifier(parsed!.loader_action),
          execution_path: boundedText(parsed!.execution_path, 256),
        },
      );
      adapterAuthoringProfile = {
        id: profile.id,
        model_type: profile.model,
        pipeline_class: profile.pipeline,
        default_repo: profile.repo,
        modes: profile.modes,
        loader_module: boundedText(parsed!.loader_module, 256),
        loader_action: identifier(parsed!.loader_action),
        execution_path: boundedText(parsed!.execution_path, 256),
        repository_revisions: adapterAuthoring.repositoryRevisions,
        optionalRuntimeRequirement: parsed!.optionalRuntimeRequirement,
        adapterAuthoring,
      };
    }
    return {
      profileId: profile.id,
      pipeline: profile.pipeline,
      label: boundedText(model.label, 512),
      repo: profile.repo,
      evaluationOnly: true,
      modelType: profile.model,
      ...(adapterAuthoringProfile ? { adapterAuthoringProfile } : {}),
      ...(recipes.has(profile.id) ? { authoringRecipes: recipes.get(profile.id) } : {}),
    };
  });
  return { support: [...support.filter((p) => !pipelines.has(p.pipelineClass)), ...declared], descriptors };
}
