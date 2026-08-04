import type { Edge, NodeChange, Viewport } from '@xyflow/react';

import { deleteNodeCache } from '../utils/serverActions';
import { decorateConnectionEdges } from '../theme/connectionTypes';
import { normalizeGenericModelLoaderParams } from '../studio/modelSelection';
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

function withLiveUiFieldContracts(nodes: CustomNodeType[]) {
  const registry = useNodesStore.getState().nodesRegistry;

  return nodes.map((node) => {
    const definition = registry[`${node.data.module}.${node.data.action}`];
    const uiFields = Object.entries(definition?.params ?? {}).filter(([, param]) =>
      String(param.display ?? '').startsWith('ui_'),
    );

    let changed = false;
    const params = { ...node.data.params };
    uiFields.forEach(([fieldKey, liveParam]) => {
      const storedParam = params[fieldKey];
      const mergedParam = storedParam ? { ...storedParam, ...liveParam } : { ...liveParam };
      if (storedParam && Object.prototype.hasOwnProperty.call(storedParam, 'value')) {
        mergedParam.value = storedParam.value;
      }
      if (storedParam && Object.prototype.hasOwnProperty.call(storedParam, 'artifacts')) {
        mergedParam.artifacts = storedParam.artifacts;
      }
      params[fieldKey] = mergedParam;
      changed = true;
    });
    const normalizedParams = normalizeGenericModelLoaderParams(
      node.data.module,
      node.data.action,
      changed ? params : node.data.params,
    );
    return changed || normalizedParams !== node.data.params
      ? { ...node, data: { ...node.data, params: normalizedParams } }
      : node;
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
  const nodes = withLiveUiFieldContracts(replacement.nodes);
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
