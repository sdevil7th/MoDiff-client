import { applyEdgeChanges, type Edge, type EdgeChange } from '@xyflow/react';
import { nanoid } from 'nanoid';

import { dataTypeClass } from '../utils/dataTypeCategory';
import type { CustomConnection, FlowStore } from './useFlowStore';

type FlowStoreSet = (
  partial: Partial<FlowStore> | FlowStore | ((state: FlowStore) => Partial<FlowStore> | FlowStore),
) => void;

type FlowStoreGet = () => FlowStore;

function toArray<T>(value: T | T[]) {
  return Array.isArray(value) ? value : [value];
}

function removeSpawnedField(get: FlowStoreGet, set: FlowStoreSet, targetNodeId: string, targetHandle: string) {
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

      if (node.data.params?.[edge.targetHandle]?.isInput) {
        get().setParam(node.id, edge.targetHandle, false, 'isInput');
      }

      if (node.data.params?.[edge.targetHandle]?.spawn) {
        removeSpawnedField(get, set, edge.target, edge.targetHandle);
      }
    });

  const newEdges = applyEdgeChanges(changes, get().edges);
  set({ edges: newEdges });

  if (removedEdges.length > 0) {
    get().updateHandleConnectionStatus();
    get().updateSignalValues(removedEdges);
  }
}

function buildEdgeFromConnection(conn: CustomConnection, get: FlowStoreGet) {
  const sourceNode = get().nodes.find((node) => node.id === conn.source);
  const handleType = sourceNode?.data.params?.[conn.sourceHandle || '']?.type || 'default';

  return {
    ...conn,
    id: nanoid(),
    type: conn.edgeType || 'default',
    className: dataTypeClass(handleType),
  };
}

function updateSpawnReplacement(conn: CustomConnection, edgeToUpdate: Edge, get: FlowStoreGet, set: FlowStoreSet) {
  const sourceNode = get().nodes.find((node) => node.id === conn.source);
  const handleType = sourceNode?.data.params?.[conn.sourceHandle || '']?.type || 'default';
  const updatedEdge = {
    ...edgeToUpdate,
    source: conn.source,
    sourceHandle: conn.sourceHandle,
    className: dataTypeClass(handleType),
  };

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
  if (!conn.source || !conn.target || !conn.targetHandle) {
    return;
  }

  const edgesToRemove = get().edges.filter(
    (edge) => edge.target === conn.target && edge.targetHandle === conn.targetHandle,
  );
  const isReplace = edgesToRemove.length > 0;

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
    appendConnection(conn, get, set);
    return;
  }

  appendConnection(conn, get, set);
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

    const sourceParam = sourceNode.data.params?.[sourceHandle];
    const targetParam = targetNode.data.params?.[targetHandle];
    const sourceSignal = sourceParam?.signal;
    const targetSignal = targetParam?.signal;

    if (sourceParam?.disabled || targetParam?.disabled) {
      return;
    }

    if (sourceSignal) {
      if (!sourceParam?.isConnected && !sourceSignal.origin) {
        get().setParam(edge.source, sourceHandle, { ...sourceSignal, value: undefined }, 'signal');
      }

      if (sourceParam?.isConnected && sourceSignal.direction === 'output' && !targetSignal?.origin) {
        get().setParam(edge.target, targetHandle, { ...sourceSignal, origin: undefined }, 'signal');
      }
    }

    if (targetSignal) {
      if (!targetParam?.isConnected && !targetSignal.origin) {
        get().setParam(edge.target, targetHandle, { ...targetSignal, value: undefined }, 'signal');
      }

      if (targetParam?.isConnected && targetSignal.direction === 'input' && !sourceSignal?.origin) {
        get().setParam(edge.source, sourceHandle, { ...targetSignal, origin: undefined }, 'signal');
      }
    }
  });
}

export function reconcileGraphConnections(get: FlowStoreGet) {
  refreshHandleConnectionStatus(get);

  get().nodes.forEach((node) => {
    Object.entries(node.data.params).forEach(([key, param]) => {
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
    Object.keys(node.data.params)
      .filter((key) => {
        const param = node.data.params[key];
        return param?.display === 'input' || param?.display === 'output';
      })
      .forEach((key) => {
        const param = node.data.params[key];
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
