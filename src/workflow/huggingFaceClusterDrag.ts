type ClusterDragNode = {
  id: string;
  data: {
    type?: string;
    huggingFaceClusterRole?: string;
    huggingFaceClusterInstanceId?: string;
  };
};

export type ExpandedClusterDropDisposition = 'preserve-owned-child' | 'reject-composite' | 'customize-and-adopt';

/**
 * Classify a node released over an expanded registered Cluster.
 *
 * Execution children already belong to their Cluster instance. Releasing one
 * after a layout-only move must never be interpreted as a structural drop:
 * that used to replace the registered Cluster with a persisted User Node.
 */
export function classifyExpandedClusterDrop(
  node: ClusterDragNode,
  targetClusterId: string,
): ExpandedClusterDropDisposition {
  if (
    node.data.huggingFaceClusterRole === 'execution' &&
    typeof node.data.huggingFaceClusterInstanceId === 'string' &&
    node.data.huggingFaceClusterInstanceId.length > 0
  ) {
    return 'preserve-owned-child';
  }
  if (node.id === targetClusterId || node.data.type === 'block' || node.data.type === 'cluster') {
    return 'reject-composite';
  }
  return 'customize-and-adopt';
}

export function isOwnedHuggingFaceClusterExecutionNode(node: ClusterDragNode) {
  return (
    classifyExpandedClusterDrop(node, node.data.huggingFaceClusterInstanceId ?? node.id) === 'preserve-owned-child'
  );
}
