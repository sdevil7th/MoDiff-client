import type { Edge, NodeChange, Viewport } from '@xyflow/react';

import { deleteNodeCache } from '../utils/serverActions';
import { decorateConnectionEdges } from '../theme/connectionTypes';
import { parseBlockCrossingHandleV2 } from '../studio/blockCrossingConnectionsV2';
import {
  blockProjectionNodeIdV2,
  isBlockRootV2,
  removeBlockEffectiveGraphNodesV2,
  setBlockPresentationV2,
} from '../studio/blockRuntimeV2';
import { enqueueSnackbar } from '../ui/snackbar';
import { handleEdgesChange, reconcileGraphConnections } from './flowConnectionMutations';
import type { CustomNodeType, FlowStore } from './useFlowStore';
import { useNodesStore } from './useNodeStore';

type FlowStoreSet = (
  partial: Partial<FlowStore> | FlowStore | ((state: FlowStore) => Partial<FlowStore> | FlowStore),
) => void;

type FlowStoreGet = () => FlowStore;

export type FlowGraphReplacement = {
  nodes: CustomNodeType[];
  edges: Edge[];
  viewport?: Viewport;
};

export type FlowGraphReplacementOptions = {
  clearRemovedCache?: boolean;
};

function toArray(value: string | string[]) {
  return Array.isArray(value) ? value : [value];
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function withLiveFieldContracts(nodes: CustomNodeType[]) {
  const registry = useNodesStore.getState().nodesRegistry;

  return nodes.map((node) => {
    const definition = registry[`${node.data.module}.${node.data.action}`];
    const liveParams = definition?.params;
    const storedParams = node.data.params;
    const params = Object.fromEntries(
      Object.entries(storedParams).map(([fieldKey, storedParam]) => {
        const liveParam = liveParams?.[fieldKey];
        const fullLiveField = liveParam?.display?.startsWith('ui_');
        // Hidden is a mode-dependent field state, not permission to overwrite
        // an existing workflow schema with the registry's initial-mode schema.
        // Fill absent hidden metadata, but retain explicit saved visibility,
        // required sockets and bounds. Actions below still come only from the
        // live registry, never from the imported document.
        const mergedParam = fullLiveField
          ? { ...storedParam, ...liveParam }
          : { ...(liveParam?.hidden ? liveParam : {}), ...storedParam };
        if (fullLiveField && hasOwn(storedParam, 'value')) mergedParam.value = storedParam.value;
        if (fullLiveField && hasOwn(storedParam, 'artifacts')) mergedParam.artifacts = storedParam.artifacts;
        for (const behaviorKey of ['onChange', 'onSignal'] as const) {
          if (liveParam && hasOwn(liveParam, behaviorKey)) mergedParam[behaviorKey] = liveParam[behaviorKey];
          else delete mergedParam[behaviorKey];
        }
        return [fieldKey, mergedParam];
      }),
    );
    for (const [fieldKey, liveParam] of Object.entries(liveParams ?? {})) {
      if (hasOwn(storedParams, fieldKey)) continue;
      if (liveParam.display?.startsWith('ui_') || liveParam.hidden) params[fieldKey] = { ...liveParam };
    }
    return { ...node, data: { ...node.data, params } };
  });
}

function collectNodeIdsWithDescendants(nodes: CustomNodeType[], requestedIds: string[]) {
  const nodeIds = new Set(requestedIds);
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach((node) => {
      if (node.parentId && nodeIds.has(node.parentId) && !nodeIds.has(node.id)) {
        nodeIds.add(node.id);
        changed = true;
      }
    });
  }
  return nodeIds;
}

async function deleteServerNodeCache(nodeIds: string[]) {
  if (nodeIds.length === 0) return;

  try {
    await deleteNodeCache(nodeIds);
  } catch (error) {
    console.error('Failed to delete cache', error);
  }
}

function removedRuntimeCacheIds(previous: CustomNodeType[], next: CustomNodeType[], removedCanvasIds: string[]) {
  const retainedRuntimeIds = new Set(
    next.flatMap((node) => {
      const instance = node.data.blockInstanceV2;
      return (
        instance?.effectiveGraph.nodes.map((child) => blockProjectionNodeIdV2(instance.instanceId, child.nodeId)) ?? []
      );
    }),
  );
  // Hiding a projection is not deleting its durable executable node.
  const ids = new Set(removedCanvasIds.filter((id) => !retainedRuntimeIds.has(id)));
  const nextById = new Map(next.map((node) => [node.id, node]));
  for (const node of previous) {
    const instance = node.data.blockInstanceV2;
    if (!instance) continue;
    const retained = new Set(
      nextById.get(node.id)?.data.blockInstanceV2?.effectiveGraph.nodes.map((child) => child.nodeId) ?? [],
    );
    for (const child of instance.effectiveGraph.nodes) {
      if (!retained.has(child.nodeId)) ids.add(blockProjectionNodeIdV2(instance.instanceId, child.nodeId));
    }
  }
  return [...ids];
}

function planBlockV2InternalNodeDeletion(nodes: CustomNodeType[], nodeIds: ReadonlySet<string>) {
  const deletingRoots = new Set(
    nodes.filter((node) => nodeIds.has(node.id) && node.data.blockInstanceV2).map((node) => node.id),
  );
  const semanticIdsByOwner = new Map<string, Set<string>>();

  nodes.forEach((node) => {
    if (!nodeIds.has(node.id)) return;
    const hasProjectionMarker =
      node.data.blockProjectionOwnerId !== undefined ||
      node.data.blockProjectionNodeId !== undefined ||
      node.data.blockProjectionKind !== undefined;
    if (!hasProjectionMarker) return;
    const ownerId = node.data.blockProjectionOwnerId;
    if (typeof ownerId === 'string' && deletingRoots.has(ownerId)) return;
    const semanticNodeId = node.data.blockProjectionNodeId;
    if (
      node.data.blockProjectionKind !== 'internal' ||
      typeof ownerId !== 'string' ||
      !ownerId ||
      typeof semanticNodeId !== 'string' ||
      !semanticNodeId ||
      node.id !== blockProjectionNodeIdV2(ownerId, semanticNodeId)
    )
      throw new Error(`Cannot delete malformed Block V2 projection node "${node.id}".`);
    const root = nodes.find((candidate) => candidate.id === ownerId);
    if (!root || !isBlockRootV2(root) || !root.data.blockInstanceV2)
      throw new Error(`Cannot delete Block V2 internal node "${semanticNodeId}": owner "${ownerId}" is invalid.`);
    const ids = semanticIdsByOwner.get(ownerId) ?? new Set<string>();
    ids.add(semanticNodeId);
    semanticIdsByOwner.set(ownerId, ids);
  });

  const nextInstances = new Map<string, NonNullable<CustomNodeType['data']['blockInstanceV2']>>();
  semanticIdsByOwner.forEach((semanticNodeIds, ownerId) => {
    const root = nodes.find((node) => node.id === ownerId);
    if (!root?.data.blockInstanceV2)
      throw new Error(`Cannot delete Block V2 internal nodes: owner "${ownerId}" disappeared.`);
    nextInstances.set(ownerId, removeBlockEffectiveGraphNodesV2(root.data.blockInstanceV2, [...semanticNodeIds]));
  });
  return { nextInstances };
}

/**
 * React Flow owns pointer movement while a node is being dragged, but a V2
 * projection is only a replaceable view of its durable root. Absorb the final
 * parent-relative position into BlockInstanceV2 before persistence can strip
 * the projection. Intermediate drag frames remain canvas-only to avoid
 * rebuilding the root on every pointer event.
 */
function persistFinalBlockV2ProjectionPositions(
  nodes: CustomNodeType[],
  changes: readonly NodeChange<CustomNodeType>[],
) {
  type PositionChange = Extract<NodeChange<CustomNodeType>, { type: 'position' }>;
  const finalPositionChanges = changes.filter(
    (change): change is PositionChange =>
      change.type === 'position' && Boolean(change.position) && change.dragging !== true,
  );
  if (!finalPositionChanges.length) return nodes;

  let nextNodes = nodes;
  finalPositionChanges.forEach((change) => {
    const projection = nextNodes.find((node) => node.id === change.id);
    if (!projection) return;
    const hasProjectionMarker =
      projection.data.blockProjectionOwnerId !== undefined ||
      projection.data.blockProjectionNodeId !== undefined ||
      projection.data.blockProjectionKind !== undefined;
    if (!hasProjectionMarker) return;

    const ownerId = projection.data.blockProjectionOwnerId;
    const semanticNodeId = projection.data.blockProjectionNodeId;
    if (
      projection.data.blockProjectionKind !== 'internal' ||
      typeof ownerId !== 'string' ||
      !ownerId ||
      typeof semanticNodeId !== 'string' ||
      !semanticNodeId ||
      projection.id !== blockProjectionNodeIdV2(ownerId, semanticNodeId)
    )
      throw new Error(`Cannot persist malformed Block V2 projection node "${projection.id}".`);
    const root = nextNodes.find((node) => node.id === ownerId);
    if (!root?.data.blockInstanceV2 || !isBlockRootV2(root))
      throw new Error(`Cannot persist Block V2 projection node "${projection.id}": owner "${ownerId}" is invalid.`);
    if (!root.data.blockInstanceV2.effectiveGraph.nodes.some(({ nodeId }) => nodeId === semanticNodeId))
      throw new Error(
        `Cannot persist Block V2 projection node "${projection.id}": semantic node "${semanticNodeId}" is absent.`,
      );

    const previous = root.data.blockInstanceV2.presentation.internalLayout[semanticNodeId];
    const width = projection.measured?.width ?? projection.width ?? previous?.width;
    const height = projection.measured?.height ?? projection.height ?? previous?.height;
    const blockInstanceV2 = setBlockPresentationV2(root.data.blockInstanceV2, {
      internalLayout: {
        [semanticNodeId]: {
          x: projection.position.x,
          y: projection.position.y,
          ...(typeof width === 'number' && Number.isFinite(width) && width > 0 ? { width } : {}),
          ...(typeof height === 'number' && Number.isFinite(height) && height > 0 ? { height } : {}),
        },
      },
    });
    nextNodes = nextNodes.map((node) =>
      node.id === ownerId ? { ...node, data: { ...node.data, blockInstanceV2 } } : node,
    );
  });
  return nextNodes;
}

export function removeFlowNodesInvariant(ids: string | string[], set: FlowStoreSet, get: FlowStoreGet) {
  const currentNodes = get().nodes;
  const nodeIds = collectNodeIdsWithDescendants(currentNodes, toArray(ids));
  const removedNodeIds = currentNodes.filter((node) => nodeIds.has(node.id)).map((node) => node.id);
  if (removedNodeIds.length === 0) return true;

  let blockDeletion;
  try {
    blockDeletion = planBlockV2InternalNodeDeletion(currentNodes, nodeIds);
  } catch (error) {
    enqueueSnackbar(error instanceof Error ? error.message : 'That Block V2 internal node cannot be deleted.', {
      variant: 'error',
      autoHideDuration: 7000,
    });
    return false;
  }

  const affectedEdges = get().edges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target));
  const connectionCleanupEdges = affectedEdges.filter((edge) => {
    const data = edge.data && typeof edge.data === 'object' && !Array.isArray(edge.data) ? edge.data : {};
    return data.blockProjectionKind !== 'internal';
  });
  if (connectionCleanupEdges.length > 0) {
    handleEdgesChange(
      connectionCleanupEdges.map((edge) => ({ id: edge.id, type: 'remove' as const })),
      set,
      get,
    );
  }

  const nodes = get()
    .nodes.filter((node) => !nodeIds.has(node.id))
    .map((node) => {
      const blockInstanceV2 = blockDeletion.nextInstances.get(node.id);
      return blockInstanceV2 ? { ...node, data: { ...node.data, blockInstanceV2 } } : node;
    });
  const edges = decorateConnectionEdges(
    nodes,
    get().edges.filter((edge) => {
      if (nodeIds.has(edge.source) || nodeIds.has(edge.target)) return false;
      for (const [id, handle] of [
        [edge.source, edge.sourceHandle],
        [edge.target, edge.targetHandle],
      ]) {
        const changed = id ? blockDeletion.nextInstances.get(id) : undefined;
        const endpoint = parseBlockCrossingHandleV2(handle);
        if (changed && endpoint && !changed.effectiveGraph.nodes.some((node) => node.nodeId === endpoint.nodeId))
          return false;
      }
      return true;
    }),
  );
  set({ nodes, edges });
  reconcileGraphConnections(get);
  void deleteServerNodeCache(removedRuntimeCacheIds(currentNodes, nodes, removedNodeIds));
  return true;
}

export function applyFlowNodeChangesInvariant(
  changes: NodeChange<CustomNodeType>[],
  set: FlowStoreSet,
  get: FlowStoreGet,
  applyRemainingChanges: (changes: NodeChange<CustomNodeType>[], nodes: CustomNodeType[]) => CustomNodeType[],
) {
  const removedIds = changes.filter((change) => change.type === 'remove').map((change) => change.id);
  if (removedIds.length > 0) {
    if (!removeFlowNodesInvariant(removedIds, set, get)) return;
  }
  const remainingChanges = changes.filter((change) => change.type !== 'remove');
  if (remainingChanges.length > 0) {
    const nodes = applyRemainingChanges(remainingChanges, get().nodes);
    set({ nodes: persistFinalBlockV2ProjectionPositions(nodes, remainingChanges) });
  }
}

export function replaceFlowGraph(
  replacement: FlowGraphReplacement,
  options: FlowGraphReplacementOptions,
  set: FlowStoreSet,
  get: FlowStoreGet,
) {
  const previousNodes = get().nodes;
  const previousNodeIds = new Set(previousNodes.map((node) => node.id));
  const nodes = withLiveFieldContracts(replacement.nodes);
  const nextNodeIds = new Set(nodes.map((node) => node.id));
  const removedNodeIds = [...previousNodeIds].filter((nodeId) => !nextNodeIds.has(nodeId));
  const edges = decorateConnectionEdges(
    nodes,
    replacement.edges.filter((edge) => nextNodeIds.has(edge.source) && nextNodeIds.has(edge.target)),
  );

  set({
    nodes,
    edges,
    viewport: replacement.viewport ?? get().viewport,
  });
  reconcileGraphConnections(get);

  if (options.clearRemovedCache) {
    void deleteServerNodeCache(removedRuntimeCacheIds(previousNodes, nodes, removedNodeIds));
  }
}
