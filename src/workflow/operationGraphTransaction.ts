import { useFlowStore } from '../stores/useFlowStore';
import { assertWorkflowOperationContext, type WorkflowOperationContext } from '../stores/useStudioStore';
import type { OperationGraph } from './operationAuthoring';

function previewNode(node: OperationGraph['nodes'][number]) {
  const uiState = node.data.uiState;
  // A derived facade refresh may materialize the default empty object. Only
  // that representation equals absence; every nonempty UI setting is an edit.
  if (!uiState || Object.getPrototypeOf(uiState) !== Object.prototype || Object.keys(uiState).length) return node;
  const copy = structuredClone(node);
  delete copy.data.uiState;
  return copy;
}

function reviewNode(node: OperationGraph['nodes'][number]) {
  const reviewed = previewNode(node);
  if (!reviewed.data.operationAuthoring) return reviewed;
  const copy = structuredClone(reviewed);
  for (const field of Object.values(copy.data.params)) {
    // Connection/field actions recompute availability asynchronously. These
    // flags are not edits to a value, port contract, binding, or layout.
    delete field.disabled;
    delete field.hidden;
  }
  return copy;
}

export function operationGraphPreviewSignature(graph: OperationGraph) {
  return JSON.stringify({ ...graph, nodes: graph.nodes.map(previewNode) });
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
