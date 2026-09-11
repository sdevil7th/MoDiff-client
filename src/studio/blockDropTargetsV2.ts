import type { CustomNodeType, FlowStore } from '../stores/useFlowStore';

/** Deepest visible expanded Block, using parent-relative canvas coordinates. */
export function expandedBlockV2AtPosition(nodes: CustomNodeType[], point: CustomNodeType['position']) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const candidates = nodes.flatMap((node) => {
    const root = node.data.blockInstanceV2?.presentation.expanded === true;
    if (!root && !(node.data.blockProjectionContainer && node.data.blockProjectionContainerExpanded !== false))
      return [];
    const owner = root ? node : byId.get(node.data.blockProjectionOwnerId ?? '');
    if (!owner?.data.blockInstanceV2?.presentation.expanded) return [];
    let x = node.position.x;
    let y = node.position.y;
    let depth = 0;
    let parentId = node.parentId;
    const visited = new Set([node.id]);
    while (parentId) {
      if (visited.has(parentId)) return [];
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent || parent.hidden || parent.data.blockProjectionContainerExpanded === false) return [];
      x += parent.position.x;
      y += parent.position.y;
      depth += 1;
      parentId = parent.parentId;
    }
    const width = node.width ?? node.measured?.width ?? 360;
    const height = node.height ?? node.measured?.height ?? 320;
    if (node.hidden || point.x < x || point.y < y || point.x > x + width || point.y > y + height) return [];
    return [{ node, depth, area: width * height }];
  });
  candidates.sort((a, b) => b.depth - a.depth || a.area - b.area || a.node.id.localeCompare(b.node.id));
  return candidates[0]?.node ?? null;
}

/** One palette gesture, including rollback if its semantic adoption is invalid. */
export function insertNodeAtBlockTargetV2(
  node: CustomNodeType,
  target: CustomNodeType,
  flow: FlowStore,
  addNode: (node: CustomNodeType) => void,
) {
  flow.beginHistoryTransaction('Add node inside Block');
  try {
    addNode(node);
    const ownerId = target.data.blockProjectionOwnerId ?? target.id;
    if (node.data.blockInstanceV2)
      flow.adoptBlockFragmentIntoBlockV2(node.id, ownerId, target.data.blockProjectionNodeId);
    else flow.adoptNodeIntoBlockV2(node.id, ownerId, target.data.blockProjectionNodeId);
    flow.commitHistoryTransaction();
  } catch (error) {
    flow.cancelHistoryTransaction();
    throw error;
  }
}
