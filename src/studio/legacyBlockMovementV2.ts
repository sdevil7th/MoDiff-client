import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { isLegacyMembershipBlock, prepareLegacyBlockMovementV2 as prepareMovement } from './legacyBlockMovementCoreV2';

export { isLegacyUserBlock, isLegacyMembershipBlock, migrateLegacyHierarchyV2 } from './legacyBlockMovementCoreV2';

/** Explicit UI edits resolve libraries here; pure graph planners never read stores. */
export function prepareLegacyBlockMovementV2(
  nodes: CustomNodeType[],
  edges: Edge[],
  ids: readonly string[],
  destinationId: string | null,
) {
  return prepareMovement(nodes, edges, ids, destinationId, {
    blocks: useUserBlockStore.getState().blocks,
    clusterDefinitions: useHuggingFaceNodeLibraryStore.getState().library?.definitions ?? [],
  });
}

export function prepareLegacyGraphForAutoV2(nodes: CustomNodeType[], edges: Edge[], targetNodeId?: string) {
  const ids = targetNodeId ? [targetNodeId] : nodes.filter(isLegacyMembershipBlock).map((node) => node.id);
  return prepareLegacyBlockMovementV2(nodes, edges, ids, null);
}
