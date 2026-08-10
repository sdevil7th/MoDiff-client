import type { Edge, NodeChange, Viewport } from '@xyflow/react';

import { deleteNodeCache } from '../utils/serverActions';
import { decorateConnectionEdges } from '../theme/connectionTypes';
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
        const fullLiveField = liveParam && (liveParam.display?.startsWith('ui_') || liveParam.hidden);
        const mergedParam = fullLiveField ? { ...storedParam, ...liveParam } : { ...storedParam };
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

export function removeFlowNodesInvariant(ids: string | string[], set: FlowStoreSet, get: FlowStoreGet) {
  const currentNodes = get().nodes;
  const nodeIds = collectNodeIdsWithDescendants(currentNodes, toArray(ids));
  const removedNodeIds = currentNodes.filter((node) => nodeIds.has(node.id)).map((node) => node.id);
  if (removedNodeIds.length === 0) return;

  const affectedEdges = get().edges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target));
  if (affectedEdges.length > 0) {
    handleEdgesChange(
      affectedEdges.map((edge) => ({ id: edge.id, type: 'remove' as const })),
      set,
      get,
    );
  }

  set({ nodes: get().nodes.filter((node) => !nodeIds.has(node.id)) });
  reconcileGraphConnections(get);
  void deleteServerNodeCache(removedNodeIds);
}

export function applyFlowNodeChangesInvariant(
  changes: NodeChange<CustomNodeType>[],
  set: FlowStoreSet,
  get: FlowStoreGet,
  applyRemainingChanges: (changes: NodeChange<CustomNodeType>[], nodes: CustomNodeType[]) => CustomNodeType[],
) {
  const removedIds = changes.filter((change) => change.type === 'remove').map((change) => change.id);
  if (removedIds.length > 0) {
    removeFlowNodesInvariant(removedIds, set, get);
  }
  const remainingChanges = changes.filter((change) => change.type !== 'remove');
  if (remainingChanges.length > 0) {
    set({ nodes: applyRemainingChanges(remainingChanges, get().nodes) });
  }
}

export function replaceFlowGraph(
  replacement: FlowGraphReplacement,
  options: FlowGraphReplacementOptions,
  set: FlowStoreSet,
  get: FlowStoreGet,
) {
  const previousNodeIds = new Set(get().nodes.map((node) => node.id));
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
    void deleteServerNodeCache(removedNodeIds);
  }
}
