import { useNodesStore } from '../stores/useNodeStore';
import { useNodeDiscoveryStore } from '../stores/useNodeDiscoveryStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { expandedBlockV2AtPosition } from '../studio/blockDropTargetsV2';
import { expandedUserBlockAtPosition } from '../studio/userBlocks';
import { expandedHuggingFaceClusterAtPosition } from '../studio/huggingFaceClusterGraph';
import { assertOperationDrag, type takeOperationDrag } from './operationDrag';
import { withOperationAuthoring } from './operationAuthoring';
import { createNodeFromRegistry } from './nodeFactory';

/** Resolve lazily, retaining the destination captured by the actual drop gesture. */
export async function resolveOperationDrop(
  drag: ReturnType<typeof takeOperationDrag>,
  target: CustomNodeType | null,
  position: CustomNodeType['position'],
  signal: AbortSignal,
) {
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener('abort', abort, { once: true });
  const validate = () => {
    assertOperationDrag(drag);
    const current = useFlowStore.getState().nodes;
    const destination =
      expandedBlockV2AtPosition(current, position) ??
      expandedUserBlockAtPosition(current, position) ??
      expandedHuggingFaceClusterAtPosition(current, position);
    if (
      destination?.id !== target?.id ||
      destination?.data.blockProjectionOwnerId !== target?.data.blockProjectionOwnerId ||
      destination?.data.blockProjectionNodeId !== target?.data.blockProjectionNodeId
    )
      throw new Error('The destination Block changed. Try the drop again.');
  };
  const cancelStale = () => {
    try {
      validate();
    } catch {
      request.abort();
    }
  };
  const unsubscribers: Array<() => void> = [];
  try {
    if (signal.aborted) return null;
    validate();
    unsubscribers.push(
      useStudioStore.subscribe(cancelStale),
      useNodeDiscoveryStore.subscribe(cancelStale),
      useNodesStore.subscribe(cancelStale),
      useFlowStore.subscribe(cancelStale),
    );
    const node = await useNodesStore.getState().resolveOperation(drag.operation, request.signal);
    if (request.signal.aborted) return null;
    validate();
    return createNodeFromRegistry(
      drag.operation.nodeKey,
      { [drag.operation.nodeKey]: withOperationAuthoring(node, drag.operation) },
      position,
    );
  } catch (error) {
    if (request.signal.aborted) return null;
    throw error;
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
    signal.removeEventListener('abort', abort);
  }
}
