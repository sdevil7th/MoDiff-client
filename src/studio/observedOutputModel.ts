import type { StudioOutput } from './types';
import { outputModelKey } from './resolvedExecutionInputs';
import type { WorkflowModelDescriptor } from '../workflow/workflowChoices';
import { workflowModelArtifactRows } from '../workflow/workflowModelInventory';

/** Match the model summary to its one validated owner in this output receipt. */
export function observedOutputModel(output: StudioOutput) {
  const receipt = output.resolvedExecutionInputs;
  if (receipt?.graphTasks?.length !== 1) return undefined;
  const task = receipt.graphTasks[0]!;
  if (outputModelKey(output) !== task.pipelineClass) return undefined;
  const model = receipt.nodes.find(({ nodeId }) => nodeId === task.loaderId);
  if (!model) return undefined;
  const repositories = new Set(
    [model.fields.repo_id?.value, model.fields.model_id?.value].filter(
      (value): value is string => typeof value === 'string' && Boolean(value),
    ),
  );
  return {
    pipeline: task.pipelineClass,
    task: task.task,
    repo: repositories.size === 1 ? repositories.values().next().value : undefined,
    revision: model.fields.revision?.value,
  };
}

/** Current discovery supplies a display name without changing captured fields or filter keys. */
export function observedOutputModelLabel(output: StudioOutput, descriptors: readonly WorkflowModelDescriptor[]) {
  const model = observedOutputModel(output);
  if (!model?.repo || typeof model.revision !== 'string' || !/^[0-9a-f]{40}$/u.test(model.revision))
    return output.modelLabel;
  const { pipeline, task, repo, revision } = model;
  const labels = new Set(
    descriptors.flatMap((descriptor) =>
      descriptor.pipeline === pipeline &&
      workflowModelArtifactRows(descriptor).some(
        ({ selection }) =>
          selection?.repo === repo &&
          selection.revision === revision &&
          (!('modes' in selection) ||
            (task !== null && Array.isArray(selection.modes) && selection.modes.includes(task))),
      )
        ? [descriptor.label]
        : [],
    ),
  );
  return labels.size === 1 ? (labels.values().next().value ?? output.modelLabel) : output.modelLabel;
}
