import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';

/**
 * Make a blank workflow an independent manual document before its first node
 * is inserted. A restored Studio receipt can otherwise outlive the canvas it
 * described and incorrectly govern the new graph.
 */
export function prepareWorkflowForManualInsertion() {
  const studio = useStudioStore.getState();
  if (useFlowStore.getState().nodes.length === 0 && studio.graphBinding) {
    studio.detachManagedGraph();
  }
  useStudioStore.getState().setLauncherDismissed(true);
}
