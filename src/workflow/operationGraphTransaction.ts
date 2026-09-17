import { useFlowStore } from '../stores/useFlowStore';
import { assertWorkflowOperationContext, type WorkflowOperationContext } from '../stores/useStudioStore';
import type { OperationGraph } from './operationAuthoring';

/** Commit a reviewed ordinary graph under the existing history/rollback owner. */
export function commitOperationGraph(
  graph: OperationGraph,
  context: WorkflowOperationContext,
  signature: string,
  label: string,
) {
  assertWorkflowOperationContext(context, { includeForm: false });
  const flow = useFlowStore.getState();
  if (JSON.stringify(flow.toObject()) !== signature)
    throw new Error('The graph changed after this preview. Request a fresh preview.');
  if (flow.historyTransaction) throw new Error('Finish the current canvas gesture before applying this change.');
  flow.beginHistoryTransaction(label);
  try {
    flow.replaceGraph(graph, { clearRemovedCache: true });
    flow.commitHistoryTransaction();
  } catch (error) {
    flow.cancelHistoryTransaction();
    throw error;
  }
}
