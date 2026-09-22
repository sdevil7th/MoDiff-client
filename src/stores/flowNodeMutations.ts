import { applyNodeChanges, type Edge, type EdgeChange, type NodeChange, type Viewport } from '@xyflow/react';
import { nanoid } from 'nanoid';

import type { NodeData, NodeParams } from './useNodeStore';
import type { CustomNodeType, FlowStore } from './useFlowStore';
import { deepEqual } from '../utils/deepEqual';
import { applyFlowNodeChangesInvariant, removeFlowNodesInvariant, replaceFlowGraph } from './flowGraphMutations';
import { handleEdgesChange, reconcileGraphConnections } from './flowConnectionMutations';
import { normalizeBlockInstanceV2 } from '../studio/blockSchemaV2';
import {
  blockProjectionNodeIdV2,
  createBlockRootNodeV2,
  duplicateOrdinaryBlockNodeV2,
  materializeBlockProjectionV2,
  setBlockPresentationV2,
} from '../studio/blockRuntimeV2';
import { nodeConnectorParam } from '../studio/nodeConnectorResolution';
import { decorateConnectionEdges } from '../theme/connectionTypes';
import { collapsedUserBlockFieldTarget } from '../studio/userBlocks';

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
  const nodes = get().nodes;
  const target = nodes.some((item) => item.id === id) ? null : collapsedUserBlockFieldTarget(nodes, id, param);
  const node = nodes.find((item) => item.id === (target?.nodeId ?? id));
  if (!node) {
    return null;
  }
  return (nodeConnectorParam(node, target?.fieldKey ?? param)?.[key] ?? null) as NodeParams[K] | null;
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
    const target = state.nodes.some((item) => item.id === id)
      ? null
      : collapsedUserBlockFieldTarget(state.nodes, id, param);
    const targetId = target?.nodeId ?? id;
    const targetParam = target?.fieldKey ?? param;
    const node = state.nodes.find((item) => item.id === targetId);
    if (!node) {
      return state;
    }
    // Block V2 public sockets are a derived view of BlockInstanceV2. Runtime
    // connection metadata must never create a second authority in params.
    if (node.data.blockInstanceV2) {
      return state;
    }
    const currentValue = node.data.params[targetParam]?.[paramKey];
    if (deepEqual(currentValue, value)) {
      return state;
    }

    return {
      nodes: state.nodes.map((item) =>
        item.id === targetId
          ? {
              ...item,
              data: {
                ...item.data,
                params: {
                  ...item.data.params,
                  [targetParam]: {
                    ...item.data.params[targetParam],
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
    const ownerId = node.data.blockProjectionOwnerId;
    const semanticNodeId = node.data.blockProjectionNodeId;
    const owner =
      node.data.blockProjectionKind === 'internal' && typeof ownerId === 'string' && typeof semanticNodeId === 'string'
        ? state.nodes.find((item) => item.id === ownerId && item.data.blockInstanceV2)
        : undefined;
    const previousLayout = owner?.data.blockInstanceV2?.presentation.internalLayout[semanticNodeId ?? ''];
    if (
      node.width === width &&
      node.height === height &&
      (!owner || (previousLayout?.width === width && previousLayout?.height === height))
    ) {
      return state;
    }

    const blockInstanceV2 =
      owner?.data.blockInstanceV2 && semanticNodeId
        ? setBlockPresentationV2(owner.data.blockInstanceV2, {
            internalLayout: {
              [semanticNodeId]: {
                x: node.position.x,
                y: node.position.y,
                width,
                height,
              },
            },
          })
        : undefined;

    if (blockInstanceV2 && owner && ownerId) {
      // A projected child's measured minimum can change the required bounds of
      // every expanded ancestor. Reproject atomically from the updated single
      // authority; changing only the leaf left parent frames at their previous
      // height and allowed the child to spill outside them.
      const projection = materializeBlockProjectionV2(
        createBlockRootNodeV2(blockInstanceV2, { selected: owner.selected }),
      );
      const nodes = state.nodes.flatMap((item) => {
        if (item.data.blockProjectionOwnerId === ownerId) return [];
        if (item.id === ownerId) return projection.nodes;
        return [item];
      });
      const edges = [
        ...state.edges.filter((edge) => edge.data?.blockProjectionOwnerId !== ownerId),
        ...projection.edges,
      ];
      return { nodes, edges: decorateConnectionEdges(nodes, edges) };
    }

    return { nodes: state.nodes.map((item) => (item.id === id ? { ...item, width, height } : item)) };
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
  if (!currentNode || currentNode.data.blockInstanceV2) {
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
          blockExpanded: node.data.uiState.blockExpanded,
          blockCollapsedWidth: node.data.uiState.blockCollapsedWidth,
          blockCollapsedHeight: node.data.uiState.blockCollapsedHeight,
          clusterCollapsedWidth: node.data.uiState.clusterCollapsedWidth,
          clusterCollapsedHeight: node.data.uiState.clusterCollapsedHeight,
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

  // Both ordinary clones and Block instance/semantic IDs can be adopted into Blocks.
  const cloneId = `node-${nanoid()}`;
  if (node.data.blockProjectionKind === 'internal') {
    const ownerId = node.data.blockProjectionOwnerId;
    const semanticId = node.data.blockProjectionNodeId;
    const state = get();
    const owner = state.nodes.find((item) => item.id === ownerId);
    if (!owner?.data.blockInstanceV2 || !semanticId)
      throw new Error('Cannot duplicate an internal node without its owning Block.');
    const instance = duplicateOrdinaryBlockNodeV2(owner.data.blockInstanceV2, semanticId, cloneId);
    const projection = materializeBlockProjectionV2(createBlockRootNodeV2(instance));
    const nodes = state.nodes.flatMap((item) =>
      item.id === ownerId ? projection.nodes : item.data.blockProjectionOwnerId === ownerId ? [] : [item],
    );
    const edges = [...state.edges.filter((edge) => edge.data?.blockProjectionOwnerId !== ownerId), ...projection.edges];
    set({ nodes, edges: decorateConnectionEdges(nodes, edges) });
    return blockProjectionNodeIdV2(instance.instanceId, cloneId);
  }
  if (node.data.blockInstanceV2) {
    const instance = normalizeBlockInstanceV2({
      ...node.data.blockInstanceV2,
      instanceId: cloneId,
      presentation: {
        ...node.data.blockInstanceV2.presentation,
        position: {
          x: node.data.blockInstanceV2.presentation.position.x + 36,
          y: node.data.blockInstanceV2.presentation.position.y + 36,
        },
      },
    });
    const projection = materializeBlockProjectionV2(createBlockRootNodeV2(instance, { selected: false }));
    set({
      nodes: [...get().nodes, ...projection.nodes],
      edges: [...get().edges, ...projection.edges],
    });
    return cloneId;
  }
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

export function loopFlowNodes(ids: string[], set: FlowStoreSet) {
  set((state) => {
    const nodes = state.nodes.filter(
      (node) => ids.includes(node.id) && node.data.type !== 'group' && node.data.type !== 'loop' && !node.parentId,
    );
    if (nodes.length === 0) return state;

    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + (node.measured?.width ?? node.width ?? 220)));
    const maxY = Math.max(...nodes.map((node) => node.position.y + (node.measured?.height ?? node.height ?? 140)));
    const loopNode: CustomNodeType = {
      id: nanoid(),
      type: 'loop',
      width: Math.max(360, maxX - minX + 56),
      height: Math.max(240, maxY - minY + 92),
      data: {
        type: 'loop',
        label: 'Loop',
        category: 'workflow-control',
        module: '',
        action: '',
        params: {
          iterations: { type: 'int', label: 'Iterations', value: 2, default: 2, min: 1, max: 100 },
          iteration_mode: {
            type: 'string',
            label: 'Repeat by',
            value: 'count',
            default: 'count',
            options: ['count', 'collection'],
          },
          max_iterations: { type: 'int', label: 'Maximum', value: 100, default: 100, min: 1, max: 10000 },
          carry: { type: 'bool', label: 'Carry result', value: true, default: true },
          collect: { type: 'bool', label: 'Collect results', value: true, default: true },
          durable: { type: 'bool', label: 'Resume retained media', value: false, default: false },
          max_retries: { type: 'int', label: 'Retries', value: 1, default: 1, min: 0, max: 10 },
        },
        resizable: true,
      },
      position: { x: minX - 28, y: minY - 64 },
      style: { zIndex: -1 },
    };
    const updatedNodes = state.nodes.map((node) =>
      nodes.some((selected) => selected.id === node.id)
        ? {
            ...node,
            parentId: loopNode.id,
            extent: undefined,
            position: {
              x: node.position.x - minX + 28,
              y: node.position.y - minY + 64,
            },
          }
        : node,
    );
    return { nodes: [loopNode, ...updatedNodes] };
  });
}

export function setFlowNodeLoopParent(nodeId: string, loopId: string | null, set: FlowStoreSet) {
  set((state) => {
    const node = state.nodes.find((item) => item.id === nodeId);
    if (!node || node.data.type === 'group') return state;
    const currentParent = node.parentId ? state.nodes.find((item) => item.id === node.parentId) : undefined;
    const target = loopId ? state.nodes.find((item) => item.id === loopId && item.data.type === 'loop') : undefined;
    if (loopId && !target) return state;
    if (target?.id === node.id) return state;
    let ancestorId = target?.parentId;
    const visited = new Set<string>();
    while (ancestorId && !visited.has(ancestorId)) {
      if (ancestorId === node.id) return state;
      visited.add(ancestorId);
      ancestorId = state.nodes.find((item) => item.id === ancestorId)?.parentId;
    }
    if ((target?.id ?? null) === (currentParent?.data.type === 'loop' ? currentParent.id : null)) return state;
    if (currentParent && currentParent.data.type !== 'loop') return state;

    const absolutePosition = currentParent
      ? {
          x: currentParent.position.x + node.position.x,
          y: currentParent.position.y + node.position.y,
        }
      : node.position;
    const position = target
      ? {
          x: absolutePosition.x - target.position.x,
          y: absolutePosition.y - target.position.y,
        }
      : absolutePosition;
    return {
      nodes: state.nodes.map((item) =>
        item.id === nodeId
          ? {
              ...item,
              parentId: target?.id,
              extent: undefined,
              position,
            }
          : item,
      ),
    };
  });
}

export function ungroupFlowNodes(id: string, set: FlowStoreSet) {
  set((state) => {
    const group = state.nodes.find((node) => node.id === id && (node.type === 'group' || node.type === 'loop'));
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
        Pick<
          NodeData,
          | 'activeTaskId'
          | 'attemptIndex'
          | 'executionStatus'
          | 'executionPhase'
          | 'progressMessage'
          | 'executionProgress'
        >
      >
    | undefined,
  set: FlowStoreSet,
) {
  set((state) => {
    const node = state.nodes.find((item) => item.id === id);
    if (!node) {
      return state;
    }
    const retireOtherActiveNodes = metadata?.executionStatus === 'running';
    const isActiveExecutionNode = (item: CustomNodeType) =>
      item.data.executionStatus === 'running' ||
      (Boolean(item.data.activeTaskId) && typeof item.data.progress === 'number' && item.data.progress !== 0);
    const hasPreviousActiveNode =
      retireOtherActiveNodes && state.nodes.some((item) => item.id !== id && isActiveExecutionNode(item));
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
      node.data.progressMessage === nextData.progressMessage &&
      node.data.executionProgress === nextData.executionProgress &&
      !hasPreviousActiveNode
    ) {
      return state;
    }

    return {
      nodes: state.nodes.map((item) => {
        if (item.id === id) return { ...item, data: nextData };
        if (!retireOtherActiveNodes || !isActiveExecutionNode(item)) {
          return item;
        }
        return {
          ...item,
          data: {
            ...item.data,
            progress: 0,
            activeTaskId: null,
            attemptIndex: undefined,
            executionStatus: undefined,
            executionPhase: undefined,
            progressMessage: undefined,
            executionProgress: undefined,
          },
        };
      }),
    };
  });
}

export function resetFlowStatus(cachedIds: string | string[], set: FlowStoreSet, get: FlowStoreGet) {
  void get;
  const cachedSet = new Set(toArray(cachedIds));
  set((state) => {
    let changed = state.lastExecutionTime !== 0;
    const nodes = state.nodes.map((node) => {
      const isCached = cachedSet.has(node.id);
      const hasExecutionState = Boolean(
        node.data.progress ||
        node.data.executionStatus ||
        node.data.executionPhase ||
        node.data.progressMessage ||
        node.data.executionProgress ||
        node.data.activeTaskId ||
        node.data.attemptIndex !== undefined,
      );
      if (Boolean(node.data.isCached) === isCached && !hasExecutionState) return node;
      changed = true;
      return {
        ...node,
        data: {
          ...node.data,
          isCached,
          progress: 0,
          activeTaskId: null,
          attemptIndex: undefined,
          executionStatus: undefined,
          executionPhase: undefined,
          progressMessage: undefined,
          executionProgress: undefined,
        },
      };
    });
    return changed ? { nodes, lastExecutionTime: 0 } : state;
  });
}

export function resetFlowExecutionProgress(set: FlowStoreSet, taskId?: string | null) {
  set((state) => ({
    nodes: state.nodes.map((node) =>
      (!taskId || node.data.activeTaskId === taskId) &&
      (node.data.progress ||
        node.data.executionStatus ||
        node.data.executionPhase ||
        node.data.progressMessage ||
        node.data.executionProgress ||
        node.data.activeTaskId ||
        node.data.attemptIndex !== undefined)
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
              executionProgress: undefined,
            },
          }
        : node,
    ),
  }));
}
