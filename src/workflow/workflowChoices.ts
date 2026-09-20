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

/** Join backend identities, never infer support from model names or cache folders. */
export function workflowChoices(
  support: PipelineSupport[],
  models: StudioModelProfile[],
  cache: unknown[],
  local: unknown[],
  diagnostics: ModelCacheDiagnostics | null,
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
        const matches = task.executionProfileIds.flatMap((id) => {
          const entry = profiles.get(id);
          return entry ? [entry] : [];
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
        return matches.map(({ model, profile }) => ({
          id: `${pipeline.pipelineClass}:${task.task}:${profile.id}`,
          pipeline: pipeline.pipelineClass,
          task: task.task,
          label: model.label,
          repo: profile.default_repo,
          profileId: profile.id,
          support: task,
          cache:
            model.defaultRepo === profile.default_repo
              ? getStudioModelCacheStatus(model, cache, local, diagnostics)
              : getRepoCacheStatus(profile.default_repo, cache, local, diagnostics),
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
