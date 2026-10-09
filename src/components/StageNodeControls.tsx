import type { NodeParams } from '../stores/useNodeStore';
import type { CustomNodeType } from '../stores/useFlowStore';
import { blockOperationGraphV2, blockViewModelV2 } from '../studio/blockRuntimeV2';
import { operationOwnsModel } from '../workflow/operationContracts';
import { visualOperationGroup } from '../workflow/visualOperationGroupProjection';
import { ModiffDisclosure } from '../ui';
import { BlockOwnerChoices } from './OperationOwnerControls';
import NodeContent from './NodeContent';

/** The same exposed fields, model planner and preview authority as Block V2,
 * presented within the ordinary node shell. No second state or executor. */
export default function StageNodeControls({
  node,
  updateStore,
}: {
  node: CustomNodeType;
  updateStore: (param: string, value: unknown, key?: keyof NodeParams) => void;
}) {
  const instance = node.data.blockInstanceV2!;
  const view = blockViewModelV2(instance);
  const setup = visualOperationGroup(node) === 'setup';
  const owners = new Set(
    blockOperationGraphV2(instance)
      .nodes.filter((n) => operationOwnsModel(n.data.operationAuthoring?.operation))
      .map((n) => n.data.blockProjectionNodeId),
  );
  const controls = instance.effectiveInterface.controls.filter(
    (control) =>
      !(
        setup &&
        owners.has(control.binding.nodeId) &&
        ['repo_id', 'model_id', 'model_type'].includes(control.binding.fieldId)
      ),
  );
  const groups = [...new Set(controls.map((control) => control.group ?? 'Settings'))];
  return (
    <div className="nodrag nowheel grid gap-2">
      {setup ? <BlockOwnerChoices node={node} /> : null}
      {groups.map((group) => (
        <ModiffDisclosure key={group} label={group} defaultOpen unmount={false} panelClassName="grid gap-2 px-1 pt-2">
          <NodeContent
            nodeId={node.id}
            params={Object.fromEntries(
              controls
                .filter((control) => (control.group ?? 'Settings') === group)
                .map((control) => [control.controlId, view.controlParams[control.controlId]!]),
            )}
            updateStore={updateStore}
            module="MoDiff"
            action="Stage"
            mode="controls"
          />
        </ModiffDisclosure>
      ))}
      {view.previewViews.map((preview) => (
        <div key={preview.previewId} data-testid={`stage-preview-${node.id}`}>
          <NodeContent
            nodeId={node.id}
            params={preview.params}
            updateStore={() => undefined}
            module="MoDiff"
            action="StagePreview"
            mode="controls"
            executionStatus={preview.status}
          />
        </div>
      ))}
    </div>
  );
}
