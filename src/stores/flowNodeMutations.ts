import { applyNodeChanges, type Edge, type EdgeChange, type NodeChange, type Viewport } from '@xyflow/react';
import { nanoid } from 'nanoid';

import type { NodeData, NodeParams } from './useNodeStore';
import type { CustomNodeType, FlowStore } from './useFlowStore';
import { deepEqual } from '../utils/deepEqual';
import { applyFlowNodeChangesInvariant, removeFlowNodesInvariant, replaceFlowGraph } from './flowGraphMutations';
import { handleEdgesChange, reconcileGraphConnections } from './flowConnectionMutations';

type FlowStoreSet = (
  partial: Partial<FlowStore> | FlowStore | ((state: FlowStore) => Partial<FlowStore> | FlowStore),
) => void;

type FlowStoreGet = () => FlowStore;

function toArray(value: string | string[]) {
  return Array.isArray(value) ? value : [value];
}

export function applyFlowNodeChanges(changes: NodeChange<CustomNodeType>[], set: FlowStoreSet, get: FlowStoreGet) {
  applyFlowNodeChangesInvariant(changes, set, get, applyNodeChanges);
}

export function addFlowNode(node: CustomNodeType, set: FlowStoreSet, get: FlowStoreGet) {
  set({ nodes: [...get().nodes, node] });
}

export function removeFlowNodes(ids: string | string[], set: FlowStoreSet, get: FlowStoreGet) {
  removeFlowNodesInvariant(ids, set, get);
}

export function removeFlowEdges(ids: string | string[], get: FlowStoreGet) {
  const changes: EdgeChange<Edge>[] = Array.isArray(ids)
    ? ids.map((id) => ({ id, type: 'remove' }))
    : [{ id: ids, type: 'remove' }];
  get().onEdgesChange(changes);
}

export function clearFlowWorkflow(set: FlowStoreSet, get: FlowStoreGet) {
  replaceFlowGraph({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, { clearRemovedCache: true }, set, get);
  set({ lastExecutionTime: 0 });
}

export function readNodeParam<K extends keyof NodeParams>(id: string, param: string, key: K, get: FlowStoreGet) {
  const node = get().nodes.find((item) => item.id === id);
  if (!node) {
    return null;
  }
  return (node.data.params?.[param]?.[key] ?? null) as NodeParams[K] | null;
}

export function writeNodeParam<K extends keyof NodeParams = 'value'>(
  id: string,
  param: string,
  value: NodeParams[K],
  key: K | undefined,
  set: FlowStoreSet,
) {
  const paramKey = (key ?? 'value') as keyof NodeParams;
  set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) {
      return state;
    }
    const currentValue = node.data.params[param]?.[paramKey];
    if (deepEqual(currentValue, value)) {
      return state;
    }

    return {
      nodes: state.nodes.map((item) =>
        item.id === id
          ? {
              ...item,
              data: {
                ...item.data,
                params: {
                  ...item.data.params,
                  [param]: {
                    ...item.data.params[param],
                    [paramKey]: value,
                  },
                },
              },
            }
          : item,
      ),
    };
  });
}

export function setFlowNodeSize(id: string, width: number, height: number, set: FlowStoreSet) {
  set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) {
      return state;
    }
    if (node.width === width && node.height === height) {
      return state;
    }

    return {
      nodes: state.nodes.map((item) => (item.id === id ? { ...item, width, height } : item)),
    };
  });
}

export function getFlowNodeParamValues(id: string, get: FlowStoreGet): Record<string, unknown> {
  const node = get().nodes.find((item) => item.id === id);
  if (!node) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(node.data.params)
      .filter(([, value]) => {
        const display = value.display;
        return display !== 'input' && display !== 'output';
      })
      .map(([key, value]) => [key, value.value ?? value.default]),
  );
}

export function replaceFlowNodeParams(
  id: string,
  params: Record<string, NodeParams>,
  set: FlowStoreSet,
  get: FlowStoreGet,
) {
  const currentNode = get().nodes.find((node) => node.id === id);
  if (!currentNode) {
    return;
  }

  const connectedEdges = get().edges.filter((edge) => edge.source === id || edge.target === id);
  const invalidEdges = connectedEdges.filter((edge) => {
    const handleName = edge.source === id ? edge.sourceHandle : edge.targetHandle;
    return !handleName || !params[handleName];
  });
  if (invalidEdges.length > 0) {
    handleEdgesChange(
      invalidEdges.map((edge) => ({ id: edge.id, type: 'remove' as const })),
      set,
      get,
    );
  }

  set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) {
      return state;
    }

    return {
      nodes: state.nodes.map((item) => (item.id === id ? { ...item, data: { ...item.data, params } } : item)),
    };
  });
  reconcileGraphConnections(get);
}

export function setFlowNodeUiState(id: string, uiState: Partial<NonNullable<NodeData['uiState']>>, set: FlowStoreSet) {
  set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) {
      return state;
    }

    const nextUiState = { ...(node.data.uiState || {}), ...uiState };
    if (deepEqual(node.data.uiState || {}, nextUiState)) {
      return state;
    }

    return {
      nodes: state.nodes.map((item) =>
        item.id === id ? { ...item, data: { ...item.data, uiState: nextUiState } } : item,
      ),
    };
  });
}

export function clearFlowNodeUiStates(set: FlowStoreSet) {
  set((state) => {
    if (!state.nodes.some((node) => node.data.uiState)) {
      return state;
    }
    return {
      nodes: state.nodes.map((node) => {
        if (!node.data.uiState) return node;
        const nextUiState = {
          collapsed: node.data.uiState.collapsed,
          disabled: node.data.uiState.disabled,
        };
        const compactUiState = Object.fromEntries(
          Object.entries(nextUiState).filter(([, value]) => value !== undefined),
        ) as NonNullable<NodeData['uiState']>;
        return {
          ...node,
          data: {
            ...node.data,
            uiState: Object.keys(compactUiState).length > 0 ? compactUiState : undefined,
          },
        };
      }),
    };
  });
}

export function duplicateFlowNode(id: string, set: FlowStoreSet, get: FlowStoreGet) {
  const node = get().nodes.find((item) => item.id === id);
  if (!node) {
    return null;
  }

  const cloneId = nanoid();
  const clonedNode: CustomNodeType = {
    ...node,
    id: cloneId,
    selected: false,
    position: {
      x: node.position.x + 36,
      y: node.position.y + 36,
    },
    data: JSON.parse(
      JSON.stringify({
        ...node.data,
        isCached: false,
        progress: 0,
        uiState: undefined,
        studioRole: undefined,
        studioOwned: undefined,
        studioAuxiliary: undefined,
      }),
    ),
  };

  set({ nodes: [...get().nodes, clonedNode] });
  return cloneId;
}

export function toggleFlowNodeCollapsed(id: string, get: FlowStoreGet) {
  const node = get().nodes.find((item) => item.id === id);
  get().setNodeUiState(id, { collapsed: !node?.data.uiState?.collapsed });
}

export function resetFlowNodeSize(id: string, set: FlowStoreSet) {
  set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node || (node.width === undefined && node.height === undefined)) {
      return state;
    }

    return {
      nodes: state.nodes.map((item) => (item.id === id ? { ...item, width: undefined, height: undefined } : item)),
    };
  });
}

export function setFlowEdgesType(edgeType: 'default' | 'smoothstep', set: FlowStoreSet) {
  set((state) => {
    if (state.edges.every((edge) => edge.type === edgeType)) {
      return state;
    }

    return {
      edges: state.edges.map((edge) =>
        edge.type === edgeType
          ? edge
          : {
              ...edge,
              type: edgeType,
            },
      ),
    };
  });
}

export function groupFlowNodes(ids: string[], set: FlowStoreSet) {
  set((state) => {
    const nodes = state.nodes.filter((node) => ids.includes(node.id));
    if (nodes.length === 0) {
      return state;
    }

    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + (node.measured?.width ?? 0)));
    const maxY = Math.max(...nodes.map((node) => node.position.y + (node.measured?.height ?? 0)));
    const groupNode: CustomNodeType = {
      id: nanoid(),
      type: 'group',
      width: maxX - minX + 40,
      height: maxY - minY + 40,
      data: {
        type: 'group',
        label: 'Group',
        category: 'group',
        module: '',
        action: '',
        params: {},
      },
      position: {
        x: minX - 20,
        y: minY - 20,
      },
    };
    const updatedNodes = state.nodes.map((node) => {
      if (!ids.includes(node.id)) {
        return node;
      }

      return {
        ...node,
        parentId: groupNode.id,
        position: {
          x: node.position.x - minX + 20,
          y: node.position.y - minY + 20,
        },
        extent: 'parent' as const,
      };
    });

    return { nodes: [groupNode, ...updatedNodes] };
  });
}

export function ungroupFlowNodes(id: string, set: FlowStoreSet) {
  set((state) => {
    const group = state.nodes.find((node) => node.id === id && node.type === 'group');
    if (!group) return state;
    return {
      nodes: state.nodes
        .filter((node) => node.id !== id)
        .map((node) =>
          node.parentId === id
            ? {
                ...node,
                parentId: group.parentId,
                extent: group.parentId ? ('parent' as const) : undefined,
                position: {
                  x: node.position.x + group.position.x,
                  y: node.position.y + group.position.y,
                },
              }
            : node,
        ),
    };
  });
}

export function setFlowViewport(viewport: Viewport, set: FlowStoreSet) {
  set((state) =>
    state.viewport.x === viewport.x && state.viewport.y === viewport.y && state.viewport.zoom === viewport.zoom
      ? state
      : { viewport },
  );
}

export function setFlowNodeCached(
  id: string,
  isCached: boolean,
  memoryUsage: Record<string, number> | undefined,
  executionTime: Record<string, number> | undefined,
  set: FlowStoreSet,
) {
  set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) {
      return state;
    }
    const nextMemoryUsage = !isCached ? undefined : memoryUsage || node.data.memoryUsage || {};
    const nextExecutionTime = !isCached ? undefined : executionTime || node.data.executionTime || {};
    if (
      node.data.isCached === isCached &&
      deepEqual(node.data.memoryUsage, nextMemoryUsage) &&
      deepEqual(node.data.executionTime, nextExecutionTime)
    ) {
      return state;
    }

    return {
      nodes: state.nodes.map((item) =>
        item.id === id
          ? {
              ...item,
              data: {
                ...item.data,
                isCached,
                memoryUsage: nextMemoryUsage,
                executionTime: nextExecutionTime,
              },
            }
          : item,
      ),
    };
  });
}

export function updateFlowCacheStatus(ids: string | string[], set: FlowStoreSet) {
  const cached = toArray(ids);
  set((state) => {
    const cachedSet = new Set(cached);
    if (state.nodes.every((node) => Boolean(node.data.isCached) === cachedSet.has(node.id))) {
      return state;
    }
    return {
      nodes: state.nodes.map((node) => {
        const isCached = cachedSet.has(node.id);
        return Boolean(node.data.isCached) === isCached ? node : { ...node, data: { ...node.data, isCached } };
      }),
    };
  });
}

export function updateFlowNodeProgress(
  id: string,
  progress: number,
  metadata:
    | Partial<
        Pick<NodeData, 'activeTaskId' | 'attemptIndex' | 'executionStatus' | 'executionPhase' | 'progressMessage'>
      >
    | undefined,
  set: FlowStoreSet,
) {
  set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) {
      return state;
    }
    const nextData = {
      ...node.data,
      progress,
      ...(metadata ?? {}),
    };
    if (
      node.data.progress === progress &&
      node.data.activeTaskId === nextData.activeTaskId &&
      node.data.attemptIndex === nextData.attemptIndex &&
      node.data.executionStatus === nextData.executionStatus &&
      node.data.executionPhase === nextData.executionPhase &&
      node.data.progressMessage === nextData.progressMessage
    ) {
      return state;
    }

    return {
      nodes: state.nodes.map((item) => (item.id === id ? { ...item, data: nextData } : item)),
    };
  });
}

export function resetFlowStatus(cachedIds: string | string[], set: FlowStoreSet, get: FlowStoreGet) {
  get().updateCacheStatus(cachedIds);

  get().nodes.forEach((node) => {
    if ((node.data.progress && node.data.progress !== 0) || node.data.executionStatus || node.data.progressMessage) {
      get().updateProgress(node.id, 0, {
        activeTaskId: null,
        attemptIndex: undefined,
        executionStatus: undefined,
        executionPhase: undefined,
        progressMessage: undefined,
      });
    }
  });

  const currentNodes = get().nodes;
  const currentEdges = get().edges;
  const currentViewport = get().viewport;
  set({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, lastExecutionTime: 0 });
  queueMicrotask(() => {
    set({ nodes: currentNodes, edges: currentEdges, viewport: currentViewport });
  });
}

export function resetFlowExecutionProgress(set: FlowStoreSet) {
  set((state) => ({
    nodes: state.nodes.map((node) =>
      node.data.progress || node.data.executionStatus || node.data.progressMessage || node.data.activeTaskId
        ? {
            ...node,
            data: {
              ...node.data,
              progress: 0,
              activeTaskId: null,
              attemptIndex: undefined,
              executionStatus: undefined,
              executionPhase: undefined,
              progressMessage: undefined,
            },
          }
        : node,
    ),
  }));
}
