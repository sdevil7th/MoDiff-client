import { ModiffFieldShell, ModiffSelect } from '../ui';
import { useNodeDiscovery } from '../stores/useNodeDiscoveryStore';

export default function OperationDiscoveryFields({
  inPopover = false,
  inferred,
}: {
  inPopover?: boolean;
  inferred?: { pipeline: string; task: string };
}) {
  const discovery = useNodeDiscovery();
  const { support, select } = discovery;
  const scope = discovery.selection ? undefined : inferred;
  const pipeline = scope?.pipeline ?? discovery.pipeline;
  const task = scope?.task ?? discovery.task;
  const entry = scope ? support.find((item) => item.pipelineClass === pipeline) : discovery.entry;
  if (!support.length) return null;
  return (
    <div className="space-y-2 px-2 pb-2">
      <ModiffFieldShell label="Pipeline">
        <ModiffSelect
          layer={inPopover ? 'popover' : 'panel'}
          aria-label="Operation pipeline"
          value={pipeline}
          onValueChange={(value) => select(value)}
          options={[
            { value: '', label: 'Select a pipeline' },
            ...support.map((p) => ({ value: p.pipelineClass, label: p.pipelineClass })),
          ]}
        />
      </ModiffFieldShell>
      {entry ? (
        <ModiffFieldShell label="Task">
          <ModiffSelect
            layer={inPopover ? 'popover' : 'panel'}
            aria-label="Operation task"
            value={task}
            onValueChange={(value) => select(pipeline, value)}
            options={entry.tasks.map((t) => ({ value: t.task, label: t.task.replace(/_/gu, ' ') }))}
          />
        </ModiffFieldShell>
      ) : null}
    </div>
  );
}
