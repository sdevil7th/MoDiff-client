import { lazy, Suspense, useState } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { captureWorkflowOperationContext } from '../stores/useStudioStore';
import { ModiffButton, ModiffDialog } from '../ui';

const Content = lazy(() => import('./BlockInterfaceDialogContentV2'));

/** Capture before loading the editor: neither the workflow nor the draft may drift. */
export default function BlockInterfaceDialogV2({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const [target] = useState(() => {
    const nodes = useFlowStore.getState().nodes;
    const selected = nodes.find((node) => node.id === nodeId);
    const ownerId = selected?.data.blockInstanceV2 ? nodeId : selected?.data.blockProjectionOwnerId;
    const instance = nodes.find((node) => node.id === ownerId)?.data.blockInstanceV2;
    return {
      snapshot: instance ? structuredClone(instance) : null,
      subtreeId: selected?.data.blockProjectionNodeId,
      context: captureWorkflowOperationContext(),
    };
  });
  return target.snapshot ? (
    <Suspense
      fallback={
        <ModiffDialog open title="Configure Block interface" onClose={onClose}>
          <p role="status">Loading interface controls…</p>
        </ModiffDialog>
      }
    >
      <Content
        nodeId={nodeId}
        snapshot={target.snapshot}
        subtreeId={target.subtreeId}
        context={target.context}
        onClose={onClose}
      />
    </Suspense>
  ) : (
    <ModiffDialog
      open
      title="Configure Block interface"
      onClose={onClose}
      footer={<ModiffButton onClick={onClose}>Close</ModiffButton>}
    >
      <p role="alert">This Block is no longer available. Select it again before configuring its interface.</p>
    </ModiffDialog>
  );
}
