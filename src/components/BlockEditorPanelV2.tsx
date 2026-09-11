import { lazy, Suspense, useEffect } from 'react';
import { useBlockEditorStore } from '../stores/useBlockEditorStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useFlowStore } from '../stores/useFlowStore';

const Save = lazy(() => import('./BlockSaveDialogContentV2'));
const Interface = lazy(() => import('./BlockInterfaceDialogContentV2'));

export default function BlockEditorPanelV2() {
  const target = useBlockEditorStore((state) => state.target);
  const close = useBlockEditorStore((state) => state.close);
  const workflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const canvasEpoch = useStudioStore((state) => state.workflowCanvasEpoch);
  const targetExists = useFlowStore((state) => {
    const owner = state.nodes.find((node) => node.id === target?.snapshot.instanceId)?.data.blockInstanceV2;
    return Boolean(
      owner && (!target?.subtreeId || owner.effectiveGraph.nodes.some((node) => node.nodeId === target.subtreeId)),
    );
  });
  const current =
    targetExists && target?.context.workflowTabId === workflowTabId && target?.context.canvasEpoch === canvasEpoch;
  useEffect(() => {
    if (target && !current) close();
  }, [target, current, close]);
  if (!target || !current) return null;
  return (
    <Suspense
      fallback={
        <p className="p-3 text-sm" role="status">
          Loading Block editor…
        </p>
      }
    >
      {target.mode === 'save' ? (
        <Save key={target.requestId} nodeId={target.nodeId} context={target.context} onClose={close} />
      ) : (
        <Interface key={target.requestId} {...target} onClose={close} />
      )}
    </Suspense>
  );
}
