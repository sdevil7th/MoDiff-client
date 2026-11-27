import { isRecord } from '../utils/isRecord';
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
    .filter((entry) => nodeCatalogEntryMatchesView(entry, view, Boolean(handleType || search.trim())))
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

/** Use the touched socket's owner in imported or detached workflows. Mixed-owner
 * Blocks require an exact boundary binding or an explicit picker selection. */
export function wireOperationScope(origin: ConnectionSearchOrigin | undefined, operations: OperationContract[]) {
  if (!origin) return undefined;
  const instance = origin.node.blockInstanceV2;
  const boundary = instance?.effectiveInterface.boundary;
  const port = boundary && [...boundary.inputs, ...boundary.outputs].find((item) => item.portId === origin.handleId);
  const hints: unknown[] = instance
    ? instance.effectiveGraph.nodes
        .filter((member) => !port || member.nodeId === port.binding.nodeId)
        .map((member) => member.data.operationAuthoring)
    : [origin.node.operationAuthoring];
  let scope: { pipeline: string; task: string } | undefined;
  for (const hint of hints) {
    if (!isRecord(hint) || !isRecord(hint.operation)) continue;
    const saved = hint.operation;
    const live = operations.find(
      (op) =>
        op.pipelineClass === saved.pipelineClass &&
        op.task === saved.task &&
        op.nodeKey === saved.nodeKey &&
        op.operationId === saved.operationId &&
        op.binding,
    );
    if (!live?.task || (scope && (scope.pipeline !== live.pipelineClass || scope.task !== live.task))) return undefined;
    scope = { pipeline: live.pipelineClass, task: live.task };
  }
  return scope;
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
  if (!pipeline || !task) return [];
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
        Boolean(operationWirePort(registry[op.nodeKey], op, dataType, handleType, origin, allowUnverified)),
    );
}

/** Match the published model-specific port before resolving a node. The generic
 * registry may contain only its loader sockets; insertion verifies the resolved
 * field again and never copies a speculative socket into the user's graph. */
export function operationWirePort(
  node: NodeData | undefined,
  op: OperationContract,
  dataType: NodeParams['type'] | null,
  handleType: HandleDirection,
  origin?: ConnectionSearchOrigin | null,
  allowUnverified = false,
) {
  if (!handleType) return undefined;
  let fallback: string | undefined;
  for (const port of op.ports) {
    if (
      port.hidden ||
      port.direction !== (handleType === 'source' ? 'input' : 'output') ||
      Object.prototype.hasOwnProperty.call(op.binding?.values ?? {}, port.name)
    )
      continue;
    const types = [connectionTypes(dataType), connectionTypes(port.types)];
    if (!allowUnverified && types.some((names) => !names.length || names.includes('any'))) continue;
    if (!connectionTypesAreCompatible(dataType, port.types)) continue;
    // Prefer an already exposed input (e.g. prompt_input) to the matching
    // editable field (prompt). Both can be declared by the same operation.
    if (node && matchingNodeHandleForDrop(node, dataType, handleType, origin, allowUnverified, port.name))
      return port.name;
    if (fallback) continue;
    if (node?.params[port.name]) {
      const shown = prepareOperationConnection(node, op, dataType, handleType, port.name);
      if (!matchingNodeHandleForDrop(shown, dataType, handleType, origin, allowUnverified, port.name)) continue;
    }
    fallback = port.name;
  }
  return fallback;
}

export function stageOperationMatchesWire(
  node: NodeData,
  op: OperationContract,
  dataType: NodeParams['type'] | null,
  handleType: HandleDirection,
  origin?: ConnectionSearchOrigin | null,
  allowUnverified = false,
) {
  return Boolean(operationWirePort(node, op, dataType, handleType, origin, allowUnverified));
}

/** Expose a new node's declared value socket just as dropping a wire on its
 * editable control would. Never change resolver defaults or binding constants. */
export function prepareOperationConnection(
  node: NodeData,
  operation: OperationContract,
  dataType: NodeParams['type'] | null,
  handleType: HandleDirection,
  requiredHandleId?: string,
): NodeData {
  if (
    handleType !== 'source' ||
    matchingNodeHandleForDrop(node, dataType, handleType, undefined, true, requiredHandleId)
  )
    return node;
  const port = operation.ports.find((port) => {
    const param = node.params[port.name];
    return (
      (!requiredHandleId || port.name === requiredHandleId) &&
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
