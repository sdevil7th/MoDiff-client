import type { ModelCacheDiagnostics } from '../stores/useNodeStore';
import type { StudioModelProfile } from '../studio/types';
import { getRepoCacheStatus, getStudioModelCacheStatus, type StudioModelCacheStatus } from '../studio/modelCache';
import type { PipelineSupport, PipelineTaskSupport } from './operationCatalog';

export type WorkflowChoice = {
  id: string;
  pipeline: string;
  task: string;
  label: string;
  repo: string | null;
  profileId?: string;
  support: PipelineTaskSupport;
  cache: StudioModelCacheStatus | null;
};

export type WorkflowModelDescriptor = { profileId: string; pipeline: string; label: string; repo: string };

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
    if (typeof model.modelType === 'string' && known.has(model.modelType)) continue;
    const profiles = model.executionProfiles;
    if (profiles === undefined) continue;
    if (!Array.isArray(profiles) || profiles.length > 512) invalid();
    for (const rawProfile of profiles as unknown[]) {
      const profile = object(rawProfile);
      const profileId = text(profile.id);
      if (!selectedIds.has(profileId)) continue;
      const pipeline = text(profile.pipeline_class);
      if (profile.public === false || !selected.has(`${pipeline}:${profileId}`)) continue;
      if (text(profile.model_type) !== text(model.modelType) || seen.has(profileId)) invalid();
      if (profile.public !== undefined && typeof profile.public !== 'boolean') invalid();
      seen.add(profileId);
      result.push({ profileId, pipeline, label: text(model.label), repo: text(profile.default_repo) });
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
        }>((id) => {
          const entry = profiles.get(id);
          if (entry)
            return [{ model: entry.model, profileId: id, label: entry.model.label, repo: entry.profile.default_repo }];
          const descriptor = descriptors.find((d) => d.profileId === id && d.pipeline === pipeline.pipelineClass);
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
        return matches.map(({ model, profileId, label, repo }) => ({
          id: `${pipeline.pipelineClass}:${task.task}:${profileId}`,
          pipeline: pipeline.pipelineClass,
          task: task.task,
          label,
          repo,
          profileId,
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
