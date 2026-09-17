import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { nodeCatalogEntries } from '../studio/nodeCatalog';
import { matchingNodeHandleForDrop, type HandleDirection } from './nodeConnectionMatching';

export { matchingNodeHandleForDrop } from './nodeConnectionMatching';

export function connectionSearchEntries(
  registry: Record<string, NodeData>,
  dataType?: NodeParams['type'] | null,
  handleType?: HandleDirection,
): [string, NodeData][] {
  return nodeCatalogEntries(registry)
    .filter((entry) => entry.visibility !== 'internal')
    .filter((entry) => !handleType || matchingNodeHandleForDrop(entry.node, dataType, handleType))
    .map((entry) => [entry.key, entry.node]);
}
