import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { nodeCatalogEntries, nodeCatalogEntryMatchesSearch } from '../studio/nodeCatalog';
import { matchingNodeHandleForDrop, type HandleDirection } from './nodeConnectionMatching';
import {
  storedUserBlockId,
  storedUserBlockRevision,
  uniqueStoredUserBlocks,
  type StoredUserBlockDefinition,
} from '../studio/userBlockLibrary';
import { createStoredUserBlockNode } from '../studio/storedUserBlockInsertion';

export { matchingNodeHandleForDrop } from './nodeConnectionMatching';

export function savedBlockSearchEntries(blocks: StoredUserBlockDefinition[]) {
  return uniqueStoredUserBlocks(blocks).map((block) => ({
    key: `saved-block:${storedUserBlockId(block)}`,
    node: createStoredUserBlockNode(block, { x: 0, y: 0 }).data,
    block,
    revision: storedUserBlockRevision(block),
  }));
}

export function connectionSearchEntries(
  registry: Record<string, NodeData>,
  dataType?: NodeParams['type'] | null,
  handleType?: HandleDirection,
  search = '',
): [string, NodeData][] {
  return nodeCatalogEntries(registry)
    .filter((entry) => entry.visibility !== 'internal')
    .filter((entry) => nodeCatalogEntryMatchesSearch(entry, search))
    .filter((entry) => !handleType || matchingNodeHandleForDrop(entry.node, dataType, handleType))
    .map((entry) => [entry.key, entry.node]);
}
