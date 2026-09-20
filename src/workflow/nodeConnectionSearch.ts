import { operationLabel, operationsForTask } from './operationCatalog';
import type { OperationContract } from './operationContracts';
import { matchesSearchKeywords } from '../utils/searchKeywords';
import { runtimeNodeIdentityV2 } from '../studio/nodeLibraryAuditV2';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import {
  nodeCatalogEntries,
  nodeCatalogEntryMatchesSearch,
  nodeCatalogEntryMatchesView,
  type NodeCatalogView,
} from '../studio/nodeCatalog';
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
  view: NodeCatalogView = 'all',
): [string, NodeData][] {
  return nodeCatalogEntries(registry)
    .filter((entry) => nodeCatalogEntryMatchesView(entry, view))
    .filter((entry) => nodeCatalogEntryMatchesSearch(entry, search))
    .filter((entry) => !handleType || matchingNodeHandleForDrop(entry.node, dataType, handleType))
    .map((entry) => [entry.key, entry.node]);
}

/** Port suggestions use declared types; insertion still validates the resolved node and full connection. */
export function operationSearchEntries(
  operations: OperationContract[],
  pipeline: string,
  task: string,
  dataType?: NodeParams['type'] | null,
  handleType?: HandleDirection,
  search = '',
  registry: Record<string, NodeData> = {},
) {
  const aliases = new Map(
    nodeCatalogEntries(registry).map((entry) => [
      runtimeNodeIdentityV2(entry.node),
      [entry.key, entry.label, ...(entry.aliases ?? [])],
    ]),
  );
  return operationsForTask(operations, pipeline, task)
    .filter((op) =>
      matchesSearchKeywords(search, [
        operationLabel(op),
        op.nodeKey,
        op.pipelineClass,
        ...(registry[op.nodeKey] ? (aliases.get(runtimeNodeIdentityV2(registry[op.nodeKey]!)) ?? []) : []),
      ]),
    )
    .filter(
      (op) =>
        !handleType ||
        op.ports.some(
          (port) =>
            !port.hidden &&
            (handleType === 'source'
              ? port.direction === 'input' && connectionTypesAreCompatible(dataType, port.types)
              : port.direction === 'output' && connectionTypesAreCompatible(port.types, dataType)),
        ),
    );
}

/** Expose a new node's declared value socket just as dropping a wire on its
 * editable control would. Never change resolver defaults or binding constants. */
export function prepareOperationConnection(
  node: NodeData,
  operation: OperationContract,
  dataType: NodeParams['type'] | null,
  handleType: HandleDirection,
): NodeData {
  if (handleType !== 'source' || matchingNodeHandleForDrop(node, dataType, handleType)) return node;
  const port = operation.ports.find((port) => {
    const param = node.params[port.name];
    return (
      port.direction === 'input' &&
      !port.hidden &&
      port.roles.includes('value') &&
      !Object.prototype.hasOwnProperty.call(operation.binding?.values ?? {}, port.name) &&
      param &&
      !param.hidden &&
      !param.disabled &&
      !param.signal &&
      param.display !== 'output' &&
      connectionTypesAreCompatible(dataType, port.types) &&
      connectionTypesAreCompatible(dataType, param.type)
    );
  });
  if (!port) return node;
  return { ...node, params: { ...node.params, [port.name]: { ...node.params[port.name], isInput: true } } };
}
