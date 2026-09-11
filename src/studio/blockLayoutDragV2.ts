import { blockGraphParentIdsV2, type BlockInstanceV2 } from './blockSchemaV2';
import { blockRelativeInternalLayoutsV2, setBlockPresentationV2 } from './blockRuntimeV2';

/** A layout drag grows ancestors; it never changes graph membership. Growing
 * left/up rebases siblings to keep their world positions unchanged. */
export function repositionBlockChildV2(
  instance: BlockInstanceV2,
  nodeId: string,
  layout: BlockInstanceV2['presentation']['internalLayout'][string],
) {
  const parents = blockGraphParentIdsV2(instance.effectiveGraph);
  const layouts = blockRelativeInternalLayoutsV2(instance);
  if (!layouts[nodeId]) throw new Error('The dragged internal node is no longer present.');
  layouts[nodeId] = { ...layouts[nodeId], ...layout };
  const position = { ...instance.presentation.position };
  let parent = parents.get(nodeId);
  for (;;) {
    const siblings = instance.effectiveGraph.nodes.filter((node) => parents.get(node.nodeId) === parent);
    const dx = Math.min(0, ...siblings.map((node) => layouts[node.nodeId]!.x - 32));
    const dy = Math.min(0, ...siblings.map((node) => layouts[node.nodeId]!.y - 80));
    for (const node of siblings) {
      const sibling = layouts[node.nodeId]!;
      layouts[node.nodeId] = { ...sibling, x: sibling.x - dx, y: sibling.y - dy };
    }
    if (!parent) {
      position.x += dx;
      position.y += dy;
      break;
    }
    const ancestor = layouts[parent]!;
    layouts[parent] = { ...ancestor, x: ancestor.x + dx, y: ancestor.y + dy };
    parent = parents.get(parent);
  }
  return setBlockPresentationV2(instance, { position, internalLayoutMode: 'hierarchical', internalLayout: layouts });
}
