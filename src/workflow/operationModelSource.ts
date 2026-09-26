import type { CustomNodeType } from '../stores/useFlowStore';
import { blockOperationGraphV2 } from '../studio/blockRuntimeV2';
import { operationAuthoring } from './operationAuthoringHint';
import { operationOwnsModel } from './operationContracts';
import { prepareOperationBlockGraph } from './operationLegacyBlockChange';

/** Resolve the actual model owner through a declared public Block control. */
export function operationModelSource(root: CustomNodeType, fieldKey: string) {
  const eligible = (node: CustomNodeType, field: string) =>
    ['model_id', 'repo_id'].includes(field) &&
    Boolean(operationAuthoring(node)?.operation.task) &&
    operationOwnsModel(operationAuthoring(node)?.operation);
  if (eligible(root, fieldKey)) return root;
  if (!root.data.blockInstanceV2 && !root.data.userBlockSnapshot) return null;
  if (root.data.userBlockSnapshot && root.data.uiState?.blockExpanded) return null;
  try {
    const prepared = prepareOperationBlockGraph({ nodes: [root], edges: [] }, root.id).root;
    const instance = prepared.data.blockInstanceV2;
    if (!instance) return null;
    const control = instance.effectiveInterface.controls.find((c) => c.controlId === fieldKey);
    if (!control || control.sealed || control.mirrorBindings?.length) return null;
    const node = blockOperationGraphV2(instance).nodes.find(
      (n) => n.data.blockProjectionNodeId === control.binding.nodeId,
    );
    return node && eligible(node, control.binding.fieldId)
      ? { ...node, data: { ...node.data, blockProjectionOwnerId: root.id } }
      : null;
  } catch {
    // Legacy conversion can require an enclosing owner. Existing Block controls
    // retain their explicit diagnostic; a field render must never migrate it.
    return null;
  }
}
