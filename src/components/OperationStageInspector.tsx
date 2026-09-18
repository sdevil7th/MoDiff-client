import { useEffect, useState } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { captureWorkflowOperationContext, useStudioStore } from '../stores/useStudioStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { ModiffDialog } from '../ui';
import { deepEqual } from '../utils/deepEqual';
import { operationAuthoring, operationFieldValue } from '../workflow/operationAuthoring';

/** Read-only, scoped to the selected node and the workflow that opened it. */
export default function OperationStageInspector({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const [context] = useState(captureWorkflowOperationContext);
  const selected = useFlowStore((s) => s.nodes.find((n) => n.id === nodeId));
  const edges = useFlowStore((s) => s.edges);
  const workflow = useStudioStore((s) => s.activeWorkflowTabId);
  const epoch = useStudioStore((s) => s.workflowCanvasEpoch);
  const mode = useSettingsStore((s) => s.studioViewMode);
  const selectedHint = selected ? operationAuthoring(selected) : null;
  const valid = Boolean(
    selected?.selected &&
    selectedHint &&
    mode === 'expert' &&
    workflow === context.workflowTabId &&
    epoch === context.canvasEpoch,
  );
  useEffect(() => {
    if (!valid) onClose();
  }, [valid, onClose]);
  if (!valid || !selected || !selectedHint) return null;
  return (
    <ModiffDialog open title="Stage implementation and settings" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>
          {selectedHint.operation.pipelineClass} · {selectedHint.operation.task}
        </p>
        <p>
          {selectedHint.operation.nodeKey} / {selectedHint.operation.blockName ?? 'Pipeline'}
        </p>
        <dl className="space-y-2">
          {Object.entries(selectedHint.defaults).map(([name, value]) => {
            const connected = edges.find((e) => e.target === selected.id && e.targetHandle === name);
            return (
              <div key={name}>
                <dt>
                  {name} —{' '}
                  {connected
                    ? `Connected from ${connected.source}.${connected.sourceHandle}; saved fallback`
                    : deepEqual(value, operationFieldValue(selected.data.params[name]))
                      ? 'Selected contract default'
                      : 'User override'}
                </dt>
                <dd className="break-words text-modiff-subtle-text">
                  {JSON.stringify(operationFieldValue(selected.data.params[name]))}
                </dd>
              </div>
            );
          })}
        </dl>
        {selectedHint.retained.length ? (
          <div>
            <p>Retained settings — excluded from execution:</p>
            <ul className="list-inside list-disc">
              {selectedHint.retained.map((setting, i) => (
                <li key={i} className="break-words">
                  {setting.pipeline} / {setting.field}: {JSON.stringify(setting.value)}. {setting.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </ModiffDialog>
  );
}
