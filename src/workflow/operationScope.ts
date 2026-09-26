import type { CustomNodeType } from '../stores/useFlowStore';
import type { OperationGraph } from './operationAuthoring';
import { operationAuthoring } from './operationAuthoringHint';
import { operationOwnsModel } from './operationContracts';

export function operationScope(graph: OperationGraph, loaderId: string): CustomNodeType[] {
  const root = graph.nodes.find((n) => n.id === loaderId);
  const hint = root && operationAuthoring(root);
  if (
    !root ||
    !hint ||
    !operationOwnsModel(hint.operation) ||
    root.parentId ||
    root.data.blockInstanceV2 ||
    root.data.blockProjectionOwnerId
  )
    throw new Error('Choose a top-level operation loader. Use the existing Block inspector for nested Blocks.');
  const candidates = new Map(
    graph.nodes
      .filter((n) => {
        const h = operationAuthoring(n);
        return (
          h &&
          !n.parentId &&
          !n.data.blockInstanceV2 &&
          !n.data.blockProjectionOwnerId &&
          h.operation.pipelineClass === hint.operation.pipelineClass &&
          h.operation.task === hint.operation.task &&
          (!operationOwnsModel(h.operation) || n.id === loaderId)
        );
      })
      .map((n) => [n.id, n]),
  );
  const ids = new Set([loaderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      for (const [source, target] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ]) {
        if (source && target && ids.has(source) && candidates.has(target) && !ids.has(target)) {
          ids.add(target);
          changed = true;
        }
      }
    }
  }
  const result = [...ids].map((id) => candidates.get(id)!);
  if (new Set(result.map((n) => operationAuthoring(n)!.operation.operationId)).size !== result.length)
    throw new Error(
      'This graph has several instances of one stage. Change a separate branch or reconnect it to its own loader first.',
    );
  // A shared stage belongs to neither loader exclusively.
  for (const edge of graph.edges) {
    if (!ids.has(edge.target) || ids.has(edge.source)) continue;
    const source = graph.nodes.find((n) => n.id === edge.source);
    const h = source && operationAuthoring(source);
    if (operationOwnsModel(h?.operation))
      throw new Error(
        'A stage uses another loader too. Separate the shared component connection before changing this graph.',
      );
  }
  return result;
}
