import { applyEdgeChanges, type Connection, type Edge, type EdgeChange } from '@xyflow/react';
import { nanoid } from 'nanoid';

import {
  blockV2ConnectionScopeIsAllowed,
  isBlockRootV2Node,
  nodeConnectorParam,
  nodeConnectorParams,
} from '../studio/nodeConnectorResolution';
import {
  blockProjectionConnectionEndpointV2,
  createBlockRootNodeV2,
  materializeBlockProjectionV2,
  replaceBlockEffectiveGraphV2,
} from '../studio/blockRuntimeV2';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { decorateConnectionEdge, decorateConnectionEdges } from '../theme/connectionTypes';
import type { CustomConnection, CustomNodeType, FlowStore } from './useFlowStore';

type FlowStoreSet = (
  partial: Partial<FlowStore> | FlowStore | ((state: FlowStore) => Partial<FlowStore> | FlowStore),
) => void;

type FlowStoreGet = () => FlowStore;

function toArray<T>(value: T | T[]) {
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function projectUpdatedBlockV2(
  ownerId: string,
  nextInstance: NonNullable<CustomNodeType['data']['blockInstanceV2']>,
  get: FlowStoreGet,
) {
  const currentRoot = get().nodes.find((node) => node.id === ownerId);
  if (!currentRoot?.data.blockInstanceV2) return null;
  const projection = materializeBlockProjectionV2(
    createBlockRootNodeV2(nextInstance, { selected: currentRoot.selected }),
  );
  const [canonicalRoot, ...children] = projection.nodes;
  if (!canonicalRoot) return null;
  const root = {
    ...canonicalRoot,
    ...(currentRoot.selected === undefined ? {} : { selected: currentRoot.selected }),
    ...(currentRoot.zIndex === undefined ? {} : { zIndex: currentRoot.zIndex }),
  };
  const nodes = get().nodes.flatMap((node) => {
    if (node.id === ownerId) return [root, ...children];
    if (node.data.blockProjectionOwnerId === ownerId) return [];
    return [node];
  });
  const retainedEdges = get().edges.filter((edge) => {
    const data = isRecord(edge.data) ? edge.data : {};
    return data.blockProjectionOwnerId !== ownerId;
  });
  return { nodes, edges: decorateConnectionEdges(nodes, [...retainedEdges, ...projection.edges]) };
}

function appendBlockV2InternalConnection(
  conn: CustomConnection,
  sourceNode: CustomNodeType,
  targetNode: CustomNodeType,
  get: FlowStoreGet,
  set: FlowStoreSet,
) {
  const ownerId = sourceNode.data.blockProjectionOwnerId;
  const sourceEndpoint = conn.sourceHandle
    ? blockProjectionConnectionEndpointV2(sourceNode, conn.sourceHandle, 'output')
    : null;
  const targetEndpoint = conn.targetHandle
    ? blockProjectionConnectionEndpointV2(targetNode, conn.targetHandle, 'input')
    : null;
  if (
    !ownerId ||
    targetNode.data.blockProjectionOwnerId !== ownerId ||
    !sourceEndpoint ||
    !targetEndpoint ||
    !conn.sourceHandle ||
    !conn.targetHandle
  )
    return false;
  const root = get().nodes.find((node) => node.id === ownerId);
  if (!root?.data.blockInstanceV2) return false;
  const effectiveGraph = root.data.blockInstanceV2.effectiveGraph;
  if (
    effectiveGraph.edges.some(
      (edge) =>
        edge.sourceNodeId === sourceEndpoint.nodeId &&
        edge.sourcePortId === sourceEndpoint.fieldOrPortId &&
        edge.targetNodeId === targetEndpoint.nodeId &&
        edge.targetPortId === targetEndpoint.fieldOrPortId,
    )
  )
    return true;
  const nextInstance = replaceBlockEffectiveGraphV2(root.data.blockInstanceV2, {
    ...effectiveGraph,
    edges: [
      ...effectiveGraph.edges,
      {
        edgeId: `workflow-edge-${nanoid()}`,
        sourceNodeId: sourceEndpoint.nodeId,
        sourcePortId: sourceEndpoint.fieldOrPortId,
        targetNodeId: targetEndpoint.nodeId,
        targetPortId: targetEndpoint.fieldOrPortId,
      },
    ],
  });
  const graph = projectUpdatedBlockV2(ownerId, nextInstance, get);
  if (!graph) return false;
  set(graph);
  get().updateHandleConnectionStatus();
  return true;
}

function removeBlockV2InternalEdges(edges: Edge[], get: FlowStoreGet, set: FlowStoreSet) {
  const byOwner = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    const data = isRecord(edge.data) ? edge.data : {};
    if (
      data.blockProjectionKind !== 'internal' ||
      typeof data.blockProjectionOwnerId !== 'string' ||
      typeof data.blockProjectionEdgeId !== 'string'
    )
      return;
    const ids = byOwner.get(data.blockProjectionOwnerId) ?? new Set<string>();
    ids.add(data.blockProjectionEdgeId);
    byOwner.set(data.blockProjectionOwnerId, ids);
  });
  byOwner.forEach((edgeIds, ownerId) => {
    const root = get().nodes.find((node) => node.id === ownerId);
    if (!root?.data.blockInstanceV2) return;
    const effectiveGraph = root.data.blockInstanceV2.effectiveGraph;
    const nextInstance = replaceBlockEffectiveGraphV2(root.data.blockInstanceV2, {
      ...effectiveGraph,
      edges: effectiveGraph.edges.filter((edge) => !edgeIds.has(edge.edgeId)),
    });
    const graph = projectUpdatedBlockV2(ownerId, nextInstance, get);
    if (graph) set(graph);
  });
}

function removeSpawnedField(get: FlowStoreGet, set: FlowStoreSet, targetNodeId: string, targetHandle: string) {
  if (isBlockRootV2Node(get().nodes.find((node) => node.id === targetNodeId))) return;
  set({
    nodes: get().nodes.map((node) =>
      node.id === targetNodeId
        ? {
            ...node,
            data: {
              ...node.data,
              params: Object.fromEntries(Object.entries(node.data.params).filter(([key]) => key !== targetHandle)),
            },
          }
        : node,
    ),
  });
}

export function handleEdgesChange(changes: EdgeChange<Edge>[], set: FlowStoreSet, get: FlowStoreGet) {
  const removedEdges: Edge[] = [];

  changes
    .filter((change) => change.type === 'remove')
    .forEach((change) => {
      const edge = get().edges.find((item) => item.id === change.id);
      if (edge) {
        removedEdges.push(edge);
      }

      if (!edge?.targetHandle) {
        return;
      }

      const node = get().nodes.find((item) => item.id === edge.target);
      if (!node) {
        return;
      }

      const targetParam = nodeConnectorParam(node, edge.targetHandle);
      if (!isBlockRootV2Node(node) && targetParam?.isInput) {
        get().setParam(node.id, edge.targetHandle, false, 'isInput');
      }

      if (!isBlockRootV2Node(node) && targetParam?.spawn) {
        removeSpawnedField(get, set, edge.target, edge.targetHandle);
      }
    });

  removeBlockV2InternalEdges(removedEdges, get, set);

  const newEdges = decorateConnectionEdges(get().nodes, applyEdgeChanges(changes, get().edges));
  set({ edges: newEdges });

  if (removedEdges.length > 0) {
    get().updateHandleConnectionStatus();
    get().updateSignalValues(removedEdges);
  }
}

function buildEdgeFromConnection(conn: CustomConnection, get: FlowStoreGet) {
  return decorateConnectionEdge(
    {
      ...conn,
      id: nanoid(),
      type: conn.edgeType || 'default',
    },
    get().nodes,
  );
}

function updateSpawnReplacement(conn: CustomConnection, edgeToUpdate: Edge, get: FlowStoreGet, set: FlowStoreSet) {
  const updatedEdge = decorateConnectionEdge(
    {
      ...edgeToUpdate,
      source: conn.source,
      sourceHandle: conn.sourceHandle,
    },
    get().nodes,
  );

  set({ edges: get().edges.map((edge) => (edge.id === edgeToUpdate.id ? updatedEdge : edge)) });
  get().updateHandleConnectionStatus();
  get().updateSignalValues(updatedEdge);
}

function appendConnection(conn: CustomConnection, get: FlowStoreGet, set: FlowStoreSet) {
  const newEdge = buildEdgeFromConnection(conn, get);
  maybeAddSpawnField(conn, get, set);

  set({ edges: [...get().edges, newEdge] });
  get().updateHandleConnectionStatus();
  get().updateSignalValues(newEdge);
}

function maybeAddSpawnField(conn: CustomConnection, get: FlowStoreGet, set: FlowStoreSet) {
  if (!conn.targetHandle) {
    return;
  }

  const targetNode = get().nodes.find((node) => node.id === conn.target);
  if (isBlockRootV2Node(targetNode)) {
    return;
  }
  const isSpawn = get().getParam(conn.target, conn.targetHandle, 'spawn');
  if (!targetNode || !isSpawn) {
    return;
  }

  const keyBaseName = conn.targetHandle.split('>>>')[0] ?? conn.targetHandle;
  const spawnFields = Object.keys(targetNode.data.params).filter((key) => key.startsWith(keyBaseName));
  if (spawnFields.length > 63) {
    return;
  }

  const nodeParams = targetNode.data.params[conn.targetHandle];
  if (!nodeParams) {
    return;
  }

  const newKeyName = `${keyBaseName}>>>${nanoid(6)}`;
  const paramsForSpawn = {
    ...nodeParams,
    label: nodeParams.label || keyBaseName.charAt(0).toUpperCase() + keyBaseName.slice(1),
  };
  const newParams: typeof targetNode.data.params = {};

  Object.entries(targetNode.data.params).forEach(([key, value]) => {
    newParams[key] = value;
    if (key === conn.targetHandle) {
      newParams[newKeyName] = paramsForSpawn;
    }
  });

  set({
    nodes: get().nodes.map((node) =>
      node.id === targetNode.id ? { ...node, data: { ...node.data, params: newParams } } : node,
    ),
  });
}

export function handleConnect(conn: CustomConnection, set: FlowStoreSet, get: FlowStoreGet) {
  if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) {
    return;
  }

  const sourceNode = get().nodes.find((node) => node.id === conn.source);
  const targetNode = get().nodes.find((node) => node.id === conn.target);
  const sourceParam = nodeConnectorParam(sourceNode, conn.sourceHandle);
  const targetParam = nodeConnectorParam(targetNode, conn.targetHandle);
  if (
    !sourceNode ||
    !targetNode ||
    !sourceParam ||
    !targetParam ||
    sourceParam.display !== 'output' ||
    (targetParam.display !== 'input' && !targetParam.isInput) ||
    !connectionTypesAreCompatible(sourceParam.type, targetParam.type) ||
    !blockV2ConnectionScopeIsAllowed(get().nodes, conn.source, conn.target)
  ) {
    return;
  }

  const edgesToRemove = get().edges.filter(
    (edge) => edge.target === conn.target && edge.targetHandle === conn.targetHandle,
  );
  const isReplace = edgesToRemove.length > 0;

  if (!isReplace && appendBlockV2InternalConnection(conn, sourceNode, targetNode, get, set)) {
    return;
  }

  if (isReplace) {
    const isSpawn = get().getParam(conn.target, conn.targetHandle, 'spawn');
    if (isSpawn) {
      const edgeToUpdate = edgesToRemove[0];
      if (!edgeToUpdate) {
        return;
      }

      updateSpawnReplacement(conn, edgeToUpdate, get, set);
      return;
    }

    handleEdgesChange(
      edgesToRemove.map((edge) => ({ id: edge.id, type: 'remove' })),
      set,
      get,
    );
    const refreshedSource = get().nodes.find((node) => node.id === conn.source);
    const refreshedTarget = get().nodes.find((node) => node.id === conn.target);
    if (
      refreshedSource &&
      refreshedTarget &&
      appendBlockV2InternalConnection(conn, refreshedSource, refreshedTarget, get, set)
    ) {
      return;
    }
    appendConnection(conn, get, set);
    return;
  }

  appendConnection(conn, get, set);
}

/** Atomically reconnect an existing edge, including durable V2 internals. */
export function handleReconnect(oldEdge: Edge, conn: Connection, set: FlowStoreSet, get: FlowStoreGet) {
  if (!get().edges.some((edge) => edge.id === oldEdge.id))
    throw new Error(`Cannot reconnect unknown edge "${oldEdge.id}".`);
  if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle)
    throw new Error('Cannot reconnect an edge without complete source and target handles.');
  const sourceNode = get().nodes.find((node) => node.id === conn.source);
  const targetNode = get().nodes.find((node) => node.id === conn.target);
  const sourceParam = nodeConnectorParam(sourceNode, conn.sourceHandle);
  const targetParam = nodeConnectorParam(targetNode, conn.targetHandle);
  if (
    !sourceNode ||
    !targetNode ||
    !sourceParam ||
    !targetParam ||
    sourceParam.display !== 'output' ||
    (targetParam.display !== 'input' && !targetParam.isInput) ||
    !connectionTypesAreCompatible(sourceParam.type, targetParam.type) ||
    !blockV2ConnectionScopeIsAllowed(get().nodes, conn.source, conn.target)
  )
    throw new Error(
      'Cannot reconnect this edge: the selected handles are missing, incompatible, or cross a Block boundary.',
    );

  const oldData = isRecord(oldEdge.data) ? oldEdge.data : {};
  const oldInternal =
    oldData.blockProjectionKind === 'internal' &&
    typeof oldData.blockProjectionOwnerId === 'string' &&
    typeof oldData.blockProjectionEdgeId === 'string';
  const newOwnerId = sourceNode.data.blockProjectionOwnerId;
  const sourceEndpoint = blockProjectionConnectionEndpointV2(sourceNode, conn.sourceHandle, 'output');
  const targetEndpoint = blockProjectionConnectionEndpointV2(targetNode, conn.targetHandle, 'input');
  const newInternal = Boolean(
    newOwnerId && sourceEndpoint && targetNode.data.blockProjectionOwnerId === newOwnerId && targetEndpoint,
  );
  if (oldInternal !== newInternal)
    throw new Error('Cannot reconnect an edge across a Block boundary. Use the Block public interface.');

  if (oldInternal) {
    const ownerId = oldData.blockProjectionOwnerId as string;
    if (newOwnerId !== ownerId) throw new Error('Cannot reconnect an internal edge into a different Block instance.');
    const root = get().nodes.find((node) => node.id === ownerId);
    if (!root?.data.blockInstanceV2) throw new Error(`Cannot reconnect edge: Block owner "${ownerId}" is invalid.`);
    const semanticEdgeId = oldData.blockProjectionEdgeId as string;
    const semantic = root.data.blockInstanceV2.effectiveGraph.edges.find(({ edgeId }) => edgeId === semanticEdgeId);
    if (!semantic) throw new Error(`Cannot reconnect unknown Block V2 internal edge "${semanticEdgeId}".`);
    if (!sourceEndpoint || !targetEndpoint)
      throw new Error('Cannot reconnect this Block edge: the projected boundary handle is invalid.');
    if (
      root.data.blockInstanceV2.effectiveGraph.edges.some(
        (edge) =>
          edge.edgeId !== semanticEdgeId &&
          edge.targetNodeId === targetEndpoint.nodeId &&
          edge.targetPortId === targetEndpoint.fieldOrPortId,
      )
    )
      throw new Error('Cannot reconnect this Block edge: the selected internal input already has a connection.');
    const nextInstance = replaceBlockEffectiveGraphV2(root.data.blockInstanceV2, {
      ...root.data.blockInstanceV2.effectiveGraph,
      edges: root.data.blockInstanceV2.effectiveGraph.edges.map((edge) =>
        edge.edgeId === semanticEdgeId
          ? {
              ...edge,
              sourceNodeId: sourceEndpoint.nodeId,
              sourcePortId: sourceEndpoint.fieldOrPortId,
              targetNodeId: targetEndpoint.nodeId,
              targetPortId: targetEndpoint.fieldOrPortId,
            }
          : edge,
      ),
    });
    const graph = projectUpdatedBlockV2(ownerId, nextInstance, get);
    if (!graph) throw new Error('Cannot reconnect this Block edge because projection failed.');
    set(graph);
    get().updateHandleConnectionStatus();
    return;
  }

  if (
    get().edges.some(
      (edge) => edge.id !== oldEdge.id && edge.target === conn.target && edge.targetHandle === conn.targetHandle,
    )
  )
    throw new Error('Cannot reconnect this edge: the selected input already has a connection.');
  const replacement = decorateConnectionEdge({ ...oldEdge, ...conn, data: oldEdge.data }, get().nodes);
  set({ edges: get().edges.map((edge) => (edge.id === oldEdge.id ? replacement : edge)) });
  get().updateHandleConnectionStatus();
  get().updateSignalValues([oldEdge, replacement]);
}

export function updateSignalsForEdges(edges: Edge | Edge[], get: FlowStoreGet) {
  const edgesArray = toArray(edges);

  edgesArray.forEach((edge) => {
    const sourceHandle = edge.sourceHandle;
    const targetHandle = edge.targetHandle;
    if (!sourceHandle || !targetHandle) {
      return;
    }

    const sourceNode = get().nodes.find((node) => node.id === edge.source);
    const targetNode = get().nodes.find((node) => node.id === edge.target);
    if (!sourceNode || !targetNode) {
      return;
    }

    const sourceParam = nodeConnectorParam(sourceNode, sourceHandle);
    const targetParam = nodeConnectorParam(targetNode, targetHandle);
    const sourceSignal = sourceParam?.signal;
    const targetSignal = targetParam?.signal;

    if (sourceParam?.disabled || targetParam?.disabled) {
      return;
    }

    if (sourceSignal) {
      if (!sourceParam?.isConnected && !sourceSignal.origin) {
        get().setParam(edge.source, sourceHandle, { ...sourceSignal, value: undefined }, 'signal');
      }

      if (
        sourceParam?.isConnected &&
        sourceSignal.direction === 'output' &&
        !(targetSignal?.direction === 'input' && targetSignal.origin)
      ) {
        get().setParam(edge.target, targetHandle, { ...sourceSignal, origin: undefined }, 'signal');
      }
    }

    if (targetSignal) {
      if (!targetParam?.isConnected && !targetSignal.origin) {
        get().setParam(edge.target, targetHandle, { ...targetSignal, value: undefined }, 'signal');
      }

      if (
        targetParam?.isConnected &&
        targetSignal.direction === 'input' &&
        !(sourceSignal?.direction === 'output' && sourceSignal.origin)
      ) {
        get().setParam(edge.source, sourceHandle, { ...targetSignal, origin: undefined }, 'signal');
      }
    }
  });
}

export function reconcileGraphConnections(get: FlowStoreGet) {
  refreshHandleConnectionStatus(get);

  get().nodes.forEach((node) => {
    if (isBlockRootV2Node(node)) return;
    Object.entries(nodeConnectorParams(node)).forEach(([key, param]) => {
      if (param.isConnected || !param.signal || param.signal.origin) return;
      if (param.signal.value !== undefined) {
        get().setParam(node.id, key, { ...param.signal, value: undefined }, 'signal');
      }
    });
  });

  updateSignalsForEdges(get().edges, get);
}

export function refreshHandleConnectionStatus(get: FlowStoreGet) {
  const edges = get().edges;

  get().nodes.forEach((node) => {
    if (isBlockRootV2Node(node)) return;
    const params = nodeConnectorParams(node);
    Object.keys(params)
      .filter((key) => {
        const param = params[key];
        return param?.display === 'input' || param?.display === 'output';
      })
      .forEach((key) => {
        const param = params[key];
        if (!param) {
          return;
        }

        let isConnected = false;
        if (param.display === 'input') {
          isConnected = edges.some((edge) => edge.target === node.id && edge.targetHandle === key);
        } else if (param.display === 'output') {
          isConnected = edges.some((edge) => edge.source === node.id && edge.sourceHandle === key);
        }

        get().setParam(node.id, key, isConnected, 'isConnected');
      });
  });
}
