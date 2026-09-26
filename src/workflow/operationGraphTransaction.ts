import { useFlowStore } from '../stores/useFlowStore';
import { assertWorkflowOperationContext, type WorkflowOperationContext } from '../stores/useStudioStore';
import type { OperationGraph } from './operationAuthoring';

function reviewNode(node: OperationGraph['nodes'][number]) {
  if (!node.data.operationAuthoring) return node;
  const copy = structuredClone(node);
  for (const field of Object.values(copy.data.params)) {
    // Connection/field actions recompute availability asynchronously. These
    // flags are not edits to a value, port contract, binding, or layout.
    delete field.disabled;
    delete field.hidden;
  }
  return copy;
}

export function operationGraphSignature(graph: OperationGraph) {
  return JSON.stringify({ ...graph, nodes: graph.nodes.map(reviewNode) });
}

/** Commit a reviewed ordinary graph under the existing history/rollback owner. */
export function commitOperationGraph(
  graph: OperationGraph,
  context: WorkflowOperationContext,
  signature: string,
  label: string,
) {
  assertWorkflowOperationContext(context, { includeForm: false });
  const flow = useFlowStore.getState();
  const previous = JSON.parse(signature) as OperationGraph;
  const current = flow.toObject();
  if (operationGraphSignature(current) !== operationGraphSignature(previous))
    throw new Error('The graph changed after this preview. Request a fresh preview.');
  if (flow.historyTransaction) throw new Error('Finish the current canvas gesture before applying this change.');
  flow.beginHistoryTransaction(label);
  try {
    const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
    const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
    flow.replaceGraph(
      {
        ...graph,
        nodes: graph.nodes.map((node) => {
          const original = previousNodes.get(node.id);
          // Keep refreshed availability on untouched siblings, rather than
          // restoring the preview's older presentation metadata over them.
          return original && JSON.stringify(reviewNode(node)) === JSON.stringify(reviewNode(original))
            ? (currentNodes.get(node.id) ?? node)
            : node;
        }),
      },
      { clearRemovedCache: true },
    );
    flow.commitHistoryTransaction();
  } catch (error) {
    flow.cancelHistoryTransaction();
    throw error;
  }
}
