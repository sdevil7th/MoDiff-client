import { useState } from 'react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { operationAuthoring } from '../workflow/operationAuthoring';
import { ModiffDisclosure, ModiffFieldShell, ModiffSelect } from '../ui';
import OperationGraphControls from './OperationGraphControls';

/** Local target choices never change library browsing or the authored graph. */
export default function OperationOwnerControls({ node }: { node: CustomNodeType }) {
  const hint = operationAuthoring(node);
  if (
    !hint ||
    !hint.operation.pipelineClass ||
    !hint.operation.task ||
    hint.operation.decomposition !== 'loader' ||
    node.parentId ||
    node.data.blockInstanceV2 ||
    node.data.blockProjectionOwnerId
  )
    return null;
  return (
    <OwnerChoices
      key={`${node.id}:${hint.operation.pipelineClass}:${hint.operation.task}`}
      ownerId={node.id}
      pipelineClass={hint.operation.pipelineClass}
      currentTask={hint.operation.task}
    />
  );
}

function OwnerChoices({
  ownerId,
  pipelineClass,
  currentTask,
}: {
  ownerId: string;
  pipelineClass: string;
  currentTask: string;
}) {
  const support = useNodesStore((state) => state.pipelineSupport);
  const [pipeline, setPipeline] = useState(pipelineClass);
  const [task, setTask] = useState(currentTask);
  const pipelines = support.filter((p) => p.tasks.some((t) => t.operationIds.length));
  const entry = pipelines.find((p) => p.pipelineClass === pipeline);
  const tasks = entry?.tasks.filter((t) => t.operationIds.length) ?? [];
  const selected = tasks.find((t) => t.task === task);
  return (
    <ModiffDisclosure label="Change model / task" panelClassName="grid gap-2 py-2">
      <p className="text-xs text-modiff-subtle-text">
        Review changes to this loader and its connected nodes. Model files and resources are checked when you run.
      </p>
      <ModiffFieldShell label="Pipeline">
        <ModiffSelect
          aria-label="Replacement pipeline"
          value={pipeline}
          onValueChange={(value) => {
            const next = pipelines.find((p) => p.pipelineClass === value)?.tasks.filter((t) => t.operationIds.length);
            setPipeline(value);
            setTask(next?.find((t) => t.task === task)?.task ?? next?.[0]?.task ?? '');
          }}
          options={pipelines.map((p) => ({ value: p.pipelineClass, label: p.pipelineClass }))}
        />
      </ModiffFieldShell>
      <ModiffFieldShell label="Task">
        <ModiffSelect
          aria-label="Replacement task"
          value={selected?.task ?? ''}
          onValueChange={setTask}
          options={tasks.map((t) => ({ value: t.task, label: t.task.replace(/_/gu, ' ') }))}
        />
      </ModiffFieldShell>
      {selected ? (
        <OperationGraphControls pipeline={pipeline} task={selected.task} ownerId={ownerId} />
      ) : (
        <p role="status" className="text-xs text-modiff-subtle-text">
          Select an available pipeline and task to preview a change.
        </p>
      )}
    </ModiffDisclosure>
  );
}
