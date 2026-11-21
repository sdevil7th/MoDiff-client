import type { NodeParams } from '../stores/useNodeStore';
import { useMemo } from 'react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { blockOperationGraphV2, blockViewModelV2 } from '../studio/blockRuntimeV2';
import { operationOwnsModel } from '../workflow/operationContracts';
import { visualOperationGroup } from '../workflow/visualOperationGroupProjection';
import { ModiffDisclosure } from '../ui';
import { BlockOwnerChoices } from './OperationOwnerControls';
import NodeContent from './NodeContent';
import ModelSetupAdapterControls from './ModelSetupAdapterControls';
import { isModelSetupAdapter } from '../workflow/modelSetupAdapters';
import { modelSetupControlGroupLabel, modelSetupControlParams } from '../workflow/modelSetupControlPresentation';

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
  const setup = visualOperationGroup(node) === 'setup';
  const { view, groups } = useMemo(() => {
    const view = blockViewModelV2(instance);
    const graph = blockOperationGraphV2(instance);
    const controlParams = setup ? modelSetupControlParams(instance, graph, view.controlParams) : view.controlParams;
    const owners = new Set(
      graph.nodes
        .filter((n) => operationOwnsModel(n.data.operationAuthoring?.operation))
        .map((n) => n.data.blockProjectionNodeId),
    );
    const adapters = new Set(graph.nodes.filter(isModelSetupAdapter).map((node) => node.data.blockProjectionNodeId));
    const controls = instance.effectiveInterface.controls.filter(
      (control) =>
        controlParams[control.controlId] !== undefined &&
        !(
          setup &&
          owners.has(control.binding.nodeId) &&
          ['repo_id', 'model_id', 'model_type'].includes(control.binding.fieldId)
        ) &&
        !(setup && adapters.has(control.binding.nodeId)),
    );
    const groups = [...new Set(controls.map((control) => control.group ?? 'Settings'))].map((group) => {
      const groupControls = controls.filter((control) => (control.group ?? 'Settings') === group);
      return {
        key: group,
        label: setup ? modelSetupControlGroupLabel(group, groupControls, graph) : group,
        params: Object.fromEntries(
          groupControls.map((control) => [control.controlId, controlParams[control.controlId]!]),
        ),
      };
    });
    return { view, groups };
  }, [instance, setup]);
  return (
    <div className="nodrag nowheel grid min-w-0 grid-cols-1 gap-2">
      {setup ? <BlockOwnerChoices node={node} /> : null}
      {setup ? <ModelSetupAdapterControls node={node} updateStore={updateStore} /> : null}
      {groups.map((group) => (
        <ModiffDisclosure
          key={group.key}
          label={group.label}
          defaultOpen
          unmount={false}
          panelClassName="grid min-w-0 grid-cols-1 gap-2 px-1 pt-2"
        >
          <NodeContent
            nodeId={node.id}
            params={group.params}
            updateStore={updateStore}
            module={node.data.module}
            action={node.data.action}
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
