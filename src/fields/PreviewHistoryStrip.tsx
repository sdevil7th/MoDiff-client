import { lazy, Suspense, useMemo } from 'react';
import { studioPreviewSlotKey, useStudioStore } from '../stores/useStudioStore';
import { previousOutputsForPreview } from '../studio/previewState';

const Content = lazy(() => import('./PreviewHistoryStripContent'));

export type PreviewHistoryStripProps = {
  nodeId: string;
  fieldKey: string;
  currentUrls?: string[];
  audioDownloadSampleRate?: number | null;
};

export function PreviewHistoryStrip({
  nodeId,
  fieldKey,
  currentUrls = [],
  audioDownloadSampleRate,
}: PreviewHistoryStripProps) {
  const outputs = useStudioStore((state) => state.outputs);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const previewSlot = useStudioStore(
    (state) => state.previewSlots[studioPreviewSlotKey(nodeId, fieldKey, activeWorkflowTabId)] ?? null,
  );
  const currentRunContext = useStudioStore((state) => state.currentRunContext);
  const currentUrlSet = useMemo(() => new Set(currentUrls), [currentUrls]);
  const history = useMemo(() => {
    const candidates = previousOutputsForPreview(
      outputs,
      activeWorkflowTabId,
      nodeId,
      fieldKey,
      previewSlot?.currentOutputId ?? null,
    );
    return (
      previewSlot
        ? candidates
        : candidates
            .filter((output) => !output.clientRunId || output.clientRunId !== currentRunContext?.clientRunId)
            .filter((output) => !currentUrlSet.has(output.mediaItems?.[0]?.url ?? output.url))
    ).slice(0, 6);
  }, [activeWorkflowTabId, currentRunContext?.clientRunId, currentUrlSet, fieldKey, nodeId, outputs, previewSlot]);

  if (history.length === 0) return null;

  return (
    <Suspense
      fallback={
        <p role="status" className="nodrag nowheel py-2 text-xs text-modiff-subtle-text">
          Loading previous outputs…
        </p>
      }
    >
      <Content history={history} audioDownloadSampleRate={audioDownloadSampleRate} />
    </Suspense>
  );
}
