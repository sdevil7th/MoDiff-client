import { operationLabel, operationsForTask } from './operationCatalog';
import type { OperationContract } from './operationContracts';
import { matchesSearchKeywords } from '../utils/searchKeywords';
import { runtimeNodeIdentityV2 } from '../studio/nodeLibraryAuditV2';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { connectionTypes } from '../theme/connectionTypeCompatibility';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import {
  nodeCatalogEntries,
  nodeCatalogEntryMatchesSearch,
  nodeCatalogEntryMatchesView,
  type NodeCatalogView,
} from '../studio/nodeCatalog';
import { matchingNodeHandleForDrop, type ConnectionSearchOrigin, type HandleDirection } from './nodeConnectionMatching';
import {
  storedUserBlockId,
  storedUserBlockRevision,
  uniqueStoredUserBlocks,
  type StoredUserBlockDefinition,
} from '../studio/userBlockLibrary';
import { createStoredUserBlockNode } from '../studio/storedUserBlockInsertion';

export { matchingNodeHandleForDrop, nodeConnectionSemanticsAreCompatible } from './nodeConnectionMatching';

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
  origin?: ConnectionSearchOrigin | null,
  allowUnverified = false,
): [string, NodeData][] {
  return nodeCatalogEntries(registry)
    .filter((entry) => nodeCatalogEntryMatchesView(entry, view))
    .filter((entry) => nodeCatalogEntryMatchesSearch(entry, search))
    .filter(
      (entry) => !handleType || matchingNodeHandleForDrop(entry.node, dataType, handleType, origin, allowUnverified),
    )
    .map((entry) => [entry.key, entry.node]);
}

type RankableConnectionEntry = {
  key: string;
  label: string;
  node?: NodeData;
};

function entrySearchText(entry: RankableConnectionEntry) {
  return `${entry.key} ${entry.label} ${entry.node?.module ?? ''} ${entry.node?.action ?? ''}`.toLowerCase();
}

/** Rank common next/previous graph steps without turning ranking into a support promise. */
export function rankConnectionSearchEntries<T extends RankableConnectionEntry>(
  entries: T[],
  dataType?: NodeParams['type'] | null,
  handleType?: HandleDirection,
  origin?: ConnectionSearchOrigin | null,
): T[] {
  if (handleType !== 'source' && handleType !== 'target') return entries;
  const types = new Set(connectionTypes(dataType));
  const score = (entry: T) => {
    const text = entrySearchText(entry);
    if (handleType === 'source') {
      if (types.has('image') && text.includes('modules.image.preview')) return 100;
      if ((types.has('audio') || types.has('video') || types.has('video_asset')) && /preview|export/u.test(text))
        return 90;
      if ((types.has('text') || types.has('string')) && text.includes('modules.text.display')) return 90;
      if ((types.has('latent') || types.has('latents')) && /latentspreview|decode.*latent/u.test(text)) return 90;
      if (/preview|display/u.test(text)) return 50;
      if (/export|save/u.test(text)) return 40;
    } else {
      if (types.has('image') && text.includes('modules.image.load')) return 100;
      if (types.has('audio') && text.includes('modules.audio.load')) return 100;
      if ((types.has('video') || types.has('video_asset')) && text.includes('modules.video.load')) return 100;
      if (text.includes('load')) return 50;
      if (/value|create/u.test(text)) return 40;
      if (text.includes('generate')) return 30;
    }
    return origin && text.includes(origin.handleId.toLowerCase()) ? 1 : 0;
  };
  return entries
    .map((entry, index) => ({ entry, index, score: score(entry) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ entry }) => entry);
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
  origin?: ConnectionSearchOrigin | null,
  allowUnverified = false,
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
            (allowUnverified ||
              (connectionTypes(dataType).length > 0 &&
                connectionTypes(port.types).length > 0 &&
                ![...connectionTypes(dataType), ...connectionTypes(port.types)].includes('any'))) &&
            (handleType === 'source'
              ? port.direction === 'input' && connectionTypesAreCompatible(dataType, port.types)
              : port.direction === 'output' && connectionTypesAreCompatible(port.types, dataType)),
        ),
    )
    .filter(
      (op) =>
        !handleType ||
        !registry[op.nodeKey] ||
        matchingNodeHandleForDrop(registry[op.nodeKey]!, dataType, handleType, origin, allowUnverified),
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
