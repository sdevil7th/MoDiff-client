type CompositeNode = {
  id: string;
  parentId?: string;
};

/**
 * Stable child identity shared by every composite graph surface.
 *
 * Keep this format compatible with persisted User Node instances. Composite
 * providers may pass an already namespaced semantic source ID.
 */
export function compositeChildNodeId(instanceId: string, sourceId: string) {
  return `${instanceId}__${sourceId}`;
}

export function compositeInstanceChildren<T>(
  nodes: readonly T[],
  instanceId: string,
  ownerInstanceId: (node: T) => string | undefined,
) {
  return nodes.filter((node) => ownerInstanceId(node) === instanceId);
}

export function compositeDescendantIds<T extends CompositeNode>(nodes: readonly T[], containerId: string) {
  const ids = new Set([containerId]);
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((node) => {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        changed = true;
      }
    });
  }
  ids.delete(containerId);
  return ids;
}
