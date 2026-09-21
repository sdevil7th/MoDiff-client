import { isLegacyUserBlock, prepareLegacyBlockMovementV2 } from '../studio/legacyBlockMovementV2';
import type { OperationGraph, OperationStarter } from './operationAuthoring';
import { planBlockOperationChange } from './operationBlockChange';

/** Read-only adaptation of the selected instance, never a library migration. */
export function prepareOperationBlockGraph(graph: OperationGraph, blockId: string) {
  const current = graph.nodes.find((node) => node.id === blockId);
  if (!current) throw new Error('The owning Block is no longer available.');
  if (!isLegacyUserBlock(current)) return { graph, root: current, converted: false };
  if (current.parentId) throw new Error('Change this nested legacy Block through its outer owning Block.');
  if (
    graph.nodes.some(
      (node) =>
        (node.id === blockId || node.data.userBlockInstanceId === blockId) &&
        (node.data.executionStatus === 'running' || node.data.executionStatus === 'queued'),
    )
  )
    throw new Error('Wait for this Block to finish before changing its model or task.');
  const prepared = prepareLegacyBlockMovementV2(graph.nodes, graph.edges, [blockId], null);
  const root = prepared.nodes.find((node) => node.id === prepared.ids[0]);
  if (!root?.data.blockInstanceV2) throw new Error('The owning Block could not be prepared.');
  return { graph: { nodes: prepared.nodes, edges: prepared.edges }, root, converted: true };
}

/** The UI commits this complete candidate through its existing Undo owner. */
export function planOwnerBlockOperationChange(
  graph: OperationGraph,
  blockId: string,
  loaderId: string,
  starter: OperationStarter,
  options: { replaceModel?: boolean } = {},
) {
  const prepared = prepareOperationBlockGraph(graph, blockId);
  const plan = planBlockOperationChange(prepared.graph, prepared.root.id, loaderId, starter, options);
  return {
    ...plan,
    changes: [
      ...plan.changes,
      ...(prepared.converted
        ? [
            'Update this legacy workflow instance to the current editable Block format; Undo restores its original format.',
          ]
        : []),
    ],
  };
}
