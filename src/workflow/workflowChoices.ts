import type { ModelCacheDiagnostics } from '../stores/useNodeStore';
import type { StudioModelProfile } from '../studio/types';
import type { StudioExecutionProfile, StudioImageAdapterAuthoringPolicy } from '../studio/types';
import { getRepoCacheStatus, getStudioModelCacheStatus, type StudioModelCacheStatus } from '../studio/modelCache';
import type { PipelineSupport, PipelineTaskSupport } from './operationCatalog';
import { parseWorkflowModelInventory, type WorkflowModelInventory } from './workflowModelInventory';
import { parseAuthoringRecipeOffers } from './authoringRecipeOffers';
import { identifier } from './operationContracts';

export type WorkflowChoice = {
  id: string;
  pipeline: string;
  task: string;
  label: string;
  repo: string | null;
  profileId?: string;
  support: PipelineTaskSupport;
  cache: StudioModelCacheStatus | null;
  evaluationOnly?: true;
  authoringRecipeId?: string;
};

/** Generic selected-profile authority; it does not widen the legacy Studio model union. */
export type WorkflowImageAdapterProfile = Pick<
  StudioExecutionProfile,
  | 'id'
  | 'pipeline_class'
  | 'loader_module'
  | 'loader_action'
  | 'execution_path'
  | 'default_repo'
  | 'optionalRuntimeRequirement'
> & {
  model_type: string;
  modes: string[];
  repository_revisions: StudioImageAdapterAuthoringPolicy['repositoryRevisions'];
  adapterAuthoring: StudioImageAdapterAuthoringPolicy;
};

export type WorkflowModelDescriptor = {
  profileId: string;
  pipeline: string;
  label: string;
  repo: string;
  inventory?: WorkflowModelInventory;
  evaluationOnly?: true;
  modelType?: string;
  adapterAuthoringProfile?: WorkflowImageAdapterProfile;
  authoringRecipes?: Readonly<Record<string, string>>;
  /** Explicit backend alternative for a null authored layout; never inferred from model names. */
  rawPromptAuthoringRecipes?: Readonly<Record<string, string>>;
  rawPromptAuthoringChoices?: Readonly<Record<string, readonly { authoringRecipeId: string; label: string }[]>>;
  layoutPromptAuthoringChoices?: Readonly<Record<string, readonly { authoringRecipeId: string; label: string }[]>>;
};

/** Presentation-only identities for generic workflows, independent of legacy Studio forms. */
export function parseWorkflowModelDescriptors(
  value: unknown,
  support: PipelineSupport[],
  knownModels: StudioModelProfile[] = [],
): WorkflowModelDescriptor[] {
  const invalid = (): never => {
    throw new Error('Invalid workflow model descriptors.');
  };
  const object = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : invalid();
  const text = (v: unknown): string =>
    typeof v === 'string' && v.length > 0 && v.length <= 512 && [...v].every((c) => c.charCodeAt(0) >= 32)
      ? v
      : invalid();
  const payload = object(value);
  if (payload.schemaVersion !== 2) return [];
  if (!Array.isArray(payload.capabilities) || payload.capabilities.length > 2048) invalid();
  // Legacy forms already validate and supply their own model choices. Do not
  // impose a new presentation schema on older optional-runtime-only records.
  const known = new Set<string>(knownModels.map((model) => model.modelType));
  const selectedIds = new Set(support.flatMap((p) => p.tasks.flatMap((t) => t.executionProfileIds)));
  const selected = new Set(
    support.flatMap((p) => p.tasks.flatMap((t) => t.executionProfileIds.map((id) => `${p.pipelineClass}:${id}`))),
  );
  const seen = new Set<string>();
  const result: WorkflowModelDescriptor[] = [];
  for (const raw of payload.capabilities as unknown[]) {
    const model = object(raw);
    const knownModel = typeof model.modelType === 'string' && known.has(model.modelType);
    const profiles = model.executionProfiles;
    // Older known-model records retain their legacy presentation boundary.
    // Explicit offers opt into this same generic profile/task contract.
    if (
      knownModel &&
      (!Array.isArray(profiles) ||
        !profiles.some(
          (profile) =>
            profile !== null &&
            typeof profile === 'object' &&
            Object.prototype.hasOwnProperty.call(profile, 'authoringRecipes'),
        ))
    )
      continue;
    if (profiles === undefined) continue;
    if (!Array.isArray(profiles) || profiles.length > 512) invalid();
    for (const rawProfile of profiles as unknown[]) {
      const profile = object(rawProfile);
      const hasOffers = Object.prototype.hasOwnProperty.call(profile, 'authoringRecipes');
      if (knownModel && !hasOffers) continue;
      const profileId = text(profile.id);
      if (!selectedIds.has(profileId)) continue;
      const pipeline = text(profile.pipeline_class);
      if (profile.public === false || !selected.has(`${pipeline}:${profileId}`)) continue;
      if (hasOffers && profile.public !== true) invalid();
      if (text(profile.model_type) !== text(model.modelType) || seen.has(profileId)) invalid();
      if (profile.public !== undefined && typeof profile.public !== 'boolean') invalid();
      seen.add(profileId);
      const repo = text(profile.default_repo);
      const inventory = parseWorkflowModelInventory(model, repo);
      let offers: Pick<
        WorkflowModelDescriptor,
        'authoringRecipes' | 'rawPromptAuthoringRecipes' | 'rawPromptAuthoringChoices' | 'layoutPromptAuthoringChoices'
      > = {};
      if (hasOffers) {
        const declaredModes = Array.isArray(profile.modes) ? profile.modes : invalid();
        if (!declaredModes.length || declaredModes.length > 64) invalid();
        const modes = declaredModes.map(identifier);
        if (new Set(modes).size !== modes.length) invalid();
        const parsed = parseAuthoringRecipeOffers(
          profile.authoringRecipes,
          [{ id: profileId, pipeline, modes }],
          support,
          invalid,
        );
        offers = {
          ...(parsed.recipes.has(profileId) ? { authoringRecipes: parsed.recipes.get(profileId) } : {}),
          ...(parsed.rawRecipes.has(profileId) ? { rawPromptAuthoringRecipes: parsed.rawRecipes.get(profileId) } : {}),
          ...(parsed.rawChoices.has(profileId) ? { rawPromptAuthoringChoices: parsed.rawChoices.get(profileId) } : {}),
          ...(parsed.layoutChoices.has(profileId)
            ? { layoutPromptAuthoringChoices: parsed.layoutChoices.get(profileId) }
            : {}),
        };
      }
      result.push({
        profileId,
        pipeline,
        label: text(model.label),
        repo,
        ...(inventory ? { inventory } : {}),
        ...offers,
      });
    }
  }
  return result;
}

/** Join backend identities, never infer support from model names or cache folders. */
export function workflowChoices(
  support: PipelineSupport[],
  models: StudioModelProfile[],
  cache: unknown[],
  local: unknown[],
  diagnostics: ModelCacheDiagnostics | null,
  descriptors: WorkflowModelDescriptor[] = [],
): WorkflowChoice[] {
  const profiles = new Map(
    models.flatMap((model) =>
      (model.executionProfiles ?? []).map((profile) => [profile.id, { model, profile }] as const),
    ),
  );
  return support
    .flatMap((pipeline) =>
      pipeline.tasks.flatMap<WorkflowChoice>((task) => {
        if (!task.operationIds.length) return [];
        const matches = task.executionProfileIds.flatMap<{
          model?: StudioModelProfile;
          profileId: string;
          label: string;
          repo: string;
          evaluationOnly?: true;
          authoringRecipes?: Readonly<Record<string, string>>;
        }>((id) => {
          const entry = profiles.get(id);
          const descriptor = descriptors.find((d) => d.profileId === id && d.pipeline === pipeline.pipelineClass);
          if (entry)
            return [
              {
                model: entry.model,
                profileId: id,
                label: entry.model.label,
                repo: entry.profile.default_repo,
                ...(descriptor &&
                !descriptor.evaluationOnly &&
                descriptor.repo === entry.profile.default_repo &&
                descriptor.authoringRecipes
                  ? { authoringRecipes: descriptor.authoringRecipes }
                  : {}),
              },
            ];
          return descriptor ? [{ model: undefined, ...descriptor }] : [];
        });
        if (!matches.length)
          return [
            {
              id: `${pipeline.pipelineClass}:${task.task}`,
              pipeline: pipeline.pipelineClass,
              task: task.task,
              label: pipeline.pipelineClass,
              repo: null,
              support: task,
              cache: null,
            },
          ];
        return matches.map(({ model, profileId, label, repo, evaluationOnly, authoringRecipes }) => ({
          id: `${pipeline.pipelineClass}:${task.task}:${profileId}`,
          pipeline: pipeline.pipelineClass,
          task: task.task,
          label,
          repo,
          profileId,
          ...(evaluationOnly ? { evaluationOnly } : {}),
          ...(authoringRecipes?.[task.task] ? { authoringRecipeId: authoringRecipes[task.task] } : {}),
          support: task,
          cache:
            model && model.defaultRepo === repo
              ? getStudioModelCacheStatus(model, cache, local, diagnostics)
              : getRepoCacheStatus(repo, cache, local, diagnostics),
        }));
      }),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.cache?.runnable)) - Number(Boolean(a.cache?.runnable)) ||
        a.label.localeCompare(b.label) ||
        a.pipeline.localeCompare(b.pipeline) ||
        a.id.localeCompare(b.id),
    );
}

const TASK_LABELS: Record<string, string> = {
  text_to_image: 'Text to image',
  image_upscale: 'Image upscale',
  image_to_image: 'Image to image',
  edit_image: 'Image edit',
  inpaint: 'Inpaint',
  outpaint: 'Outpaint',
  control_image: 'Image conditioning',
  multi_image_reference_edit: 'Edit with image references',
};
export function workflowTaskLabel(task: string): string {
  return TASK_LABELS[task] ?? task.replace(/_/gu, ' ').replace(/^./u, (c) => c.toUpperCase());
}

/** Search presentation text independently of punctuation in a model or repository name. */
export function workflowModelMatchesQuery(choice: Pick<WorkflowChoice, 'label' | 'repo'>, query: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const text = normalize(`${choice.label} ${choice.repo ?? ''}`);
  return query
    .trim()
    .split(/\s+/u)
    .every((part) => text.includes(normalize(part)));
}

/** One model row per repository/task, with exact backend routes still selectable. */
export function groupWorkflowModels(choices: WorkflowChoice[], currentId?: string) {
  const groups = new Map<string, WorkflowChoice[]>();
  for (const choice of choices) {
    const key = `${choice.task}:${choice.repo ?? choice.id}`;
    groups.set(key, [...(groups.get(key) ?? []), choice]);
  }
  return [...groups.entries()].map(([id, routes]) => {
    routes.sort(
      (a, b) =>
        Number(b.id === currentId) - Number(a.id === currentId) ||
        Number(b.support.dependencies === 'ready') - Number(a.support.dependencies === 'ready') ||
        Number(b.support.decomposition === 'stages') - Number(a.support.decomposition === 'stages') ||
        a.id.localeCompare(b.id),
    );
    return { id, primary: routes[0]!, routes };
  });
}
