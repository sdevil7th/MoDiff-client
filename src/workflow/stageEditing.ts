import { isStageEditorOpen } from './encodingNodePresentation';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { captureWorkflowOperationContext } from '../stores/useStudioStore';

/** Expose the existing editable projection. The same instance keeps its controls and crossing wires. */
export function setStageEditorOpen(nodeId: string, open: boolean) {
  const { workflowTabId } = captureWorkflowOperationContext();
  const flow = useFlowStore.getState();
  flow.withHistory(open ? 'Edit stage operations' : 'Return to workflow', () => {
    if (open) {
      for (const node of flow.nodes) {
        if (node.id !== nodeId && isStageEditorOpen(node.data.blockInstanceV2)) {
          flow.setBlockPresentationV2(node.id, { expanded: false, stageEditorOpen: false });
        }
      }
    }
    flow.setBlockPresentationV2(nodeId, { expanded: open, stageEditorOpen: open });
  });
  if (workflowTabId) {
    const now = Date.now();
    useSettingsStore.getState().setWorkflowFocusRequest({
      workflowTabId,
      nodeId,
      requestId: now,
      requestedAt: now,
      stageEditor: open ? 'enter' : 'leave',
    });
  }
}
