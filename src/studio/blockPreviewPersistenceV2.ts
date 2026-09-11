import type { CustomNodeType } from '../stores/useFlowStore';
import type { StudioOutput, StudioPreviewSlot } from './types';
import { blockProjectionNodeIdV2 } from './blockRuntimeV2';

/** Retain the exact run's asset, even after its temporary execution cache expires. */
export function withDurableBlockPreviewsV2(
  nodes: CustomNodeType[],
  outputs: StudioOutput[],
  current?: { workflowTabId: string | null; previewSlots: Record<string, StudioPreviewSlot> },
): CustomNodeType[] {
  let changed = false;
  const result = nodes.map((node) => {
    const instance = node.data.blockInstanceV2;
    if (!instance) return node;
    let previewChanged = false;
    const previewStates = instance.previewStates.map((preview) => {
      // A reopened browser may have missed completion over websocket. Only an
      // explicit backend current-output slot for this document can advance it.
      const slot = current?.workflowTabId
        ? Object.values(current.previewSlots).find(
            (candidate) =>
              candidate.workflowTabId === current.workflowTabId &&
              candidate.nodeId === blockProjectionNodeIdV2(node.id, preview.binding.nodeId) &&
              candidate.fieldKey === preview.binding.outputPortId,
          )
        : undefined;
      const currentOutput =
        slot?.status === 'ready' && slot.currentOutputId
          ? outputs.find((output) => output.id === slot.currentOutputId)
          : undefined;
      const currentUrl = currentOutput?.mediaItems?.[0]?.backendPath
        ? currentOutput.mediaItems[0].url
        : currentOutput?.backendMediaPath || currentOutput?.backendImagePath
          ? currentOutput.url
          : undefined;
      if (currentOutput?.taskId && currentUrl) {
        if (
          preview.taskId === currentOutput.taskId &&
          preview.mediaReference === currentUrl &&
          preview.status === 'complete'
        )
          return preview;
        previewChanged = true;
        return { ...preview, taskId: currentOutput.taskId, mediaReference: currentUrl, status: 'complete' as const };
      }
      if (!preview.taskId || !preview.mediaReference) return preview;
      for (const output of outputs) {
        // Never substitute the most recent output from this node or another task.
        if (output.taskId !== preview.taskId) continue;
        const items = output.mediaItems ?? [];
        const exactItem = items.find(
          (item) =>
            item.value === preview.mediaReference &&
            item.backendPath &&
            (!item.taskId || item.taskId === preview.taskId),
        );
        const sameSlot =
          output.nodeId === blockProjectionNodeIdV2(node.id, preview.binding.nodeId) &&
          output.fieldKey === preview.binding.outputPortId;
        const sameReference: boolean =
          output.value === preview.mediaReference ||
          (Array.isArray(output.value) && output.value.includes(preview.mediaReference));
        const durableUrl: string | undefined =
          exactItem?.url ??
          (items.length <= 1 && (sameSlot || sameReference) && (output.backendMediaPath || output.backendImagePath)
            ? output.url
            : undefined);
        if (!durableUrl || durableUrl === preview.mediaReference) continue;
        previewChanged = true;
        return { ...preview, mediaReference: durableUrl };
      }
      return preview;
    });
    if (!previewChanged) return node;
    changed = true;
    return { ...node, data: { ...node.data, blockInstanceV2: { ...instance, previewStates } } };
  });
  return changed ? result : nodes;
}
