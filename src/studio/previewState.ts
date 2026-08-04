import { useStudioStore, studioPreviewSlotKey } from '../stores/useStudioStore';
import type { StudioOutput, StudioOutputMediaItem } from './types';

function previewValue(mediaItems: StudioOutputMediaItem[] | undefined, value: unknown, displayType?: string) {
  if (displayType === 'text') return value;
  const urls = mediaItems?.map((item) => item.url).filter(Boolean) ?? [];
  if (urls.length > 0) return urls;
  return value;
}

export function previousOutputsForPreview(
  outputs: StudioOutput[],
  workflowTabId: string | null,
  nodeId: string,
  fieldKey: string,
  currentOutputId: string | null,
) {
  return outputs
    .filter((output) => output.nodeId === nodeId && output.fieldKey === fieldKey)
    .filter((output) => !workflowTabId || !output.workflowTabId || output.workflowTabId === workflowTabId)
    .filter((output) => output.id !== currentOutputId);
}

export function useCurrentStudioPreview(nodeId: string, fieldKey: string) {
  const workflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const key = studioPreviewSlotKey(nodeId, fieldKey, workflowTabId);
  const slot = useStudioStore((state) => state.previewSlots[key] ?? null);
  const output = useStudioStore((state) =>
    slot?.currentOutputId ? (state.outputs.find((candidate) => candidate.id === slot.currentOutputId) ?? null) : null,
  );
  const hasAuthority = Boolean(slot);
  const value =
    slot?.status === 'ready' && output ? previewValue(output.mediaItems, output.value, output.displayType) : null;
  const artifacts =
    slot?.status === 'ready' && output?.mediaItems
      ? output.mediaItems.map((item) => ({
          url: item.url,
          nodeId: output.nodeId,
          fieldKey: output.fieldKey,
          index: item.index,
          mimeType: item.contentType,
          filename: item.backendPath?.split('/').pop(),
          width: item.width,
          height: item.height,
          durationSeconds: item.durationSeconds,
          taskId: item.taskId,
          clientRunId: item.clientRunId,
          runInputHash: item.runInputHash,
          attemptIndex: item.attemptIndex,
        }))
      : undefined;
  const statusMessage =
    slot?.status === 'pending'
      ? 'Waiting for this run'
      : slot?.status === 'failed'
        ? 'Run failed before producing a new output.'
        : '';

  return { artifacts, hasAuthority, output, slot, statusMessage, value };
}
