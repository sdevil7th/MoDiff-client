import { useEffect, useState } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { captureWorkflowOperationContext, useStudioStore } from '../stores/useStudioStore';
import { ModiffDialog } from '../ui';
import { GraphNodeInputs } from './GraphNodeInputs';

/** A contextual view of the same controls used in the side panel, in either workspace. */
export default function NodeInspectorDialog({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const [context] = useState(captureWorkflowOperationContext);
  const node = useFlowStore((state) => state.nodes.find((item) => item.id === nodeId));
  const workflow = useStudioStore((state) => state.activeWorkflowTabId);
  const epoch = useStudioStore((state) => state.workflowCanvasEpoch);
  const valid = Boolean(node?.selected && workflow === context.workflowTabId && epoch === context.canvasEpoch);
  useEffect(() => {
    if (!valid) onClose();
  }, [valid, onClose]);
  if (!valid || !node) return null;
  return (
    <ModiffDialog open title={node.data.blockInstanceV2 ? 'Block inspector' : 'Node inspector'} onClose={onClose}>
      <GraphNodeInputs
        nodes={[node]}
        selectedNodes={[node]}
        workflowId={workflow}
        candidates={[]}
        pinnedInputs={[]}
        pinnedIds={[]}
        onTogglePin={() => undefined}
        controlIdPrefix="dialog-inspector"
      />
    </ModiffDialog>
  );
}
