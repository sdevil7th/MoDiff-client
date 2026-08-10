// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { NodeData, NodeParams, type NodeParamSignal } from './useNodeStore';
import { Node, Edge, OnNodesChange, OnEdgesChange, NodeChange, EdgeChange, Connection, Viewport } from '@xyflow/react';

import type { ApiGraphExport } from '../types/api';
import { migrateLocalStorageKey } from '../utils/persistMigration';
import { arrangeGraphNodes } from '../workflow/graphLayout';
import {
  handleConnect,
  handleEdgesChange,
  refreshHandleConnectionStatus,
  updateSignalsForEdges,
} from './flowConnectionMutations';
import { buildApiGraphExport } from './flowGraphExport';
import {
  addFlowNode,
  applyFlowNodeChanges,
  clearFlowNodeUiStates,
  clearFlowWorkflow,
  duplicateFlowNode,
  getFlowNodeParamValues,
  groupFlowNodes,
  loopFlowNodes,
  readNodeParam,
  removeFlowEdges,
  removeFlowNodes,
  replaceFlowNodeParams,
  resetFlowNodeSize,
  resetFlowExecutionProgress,
  resetFlowStatus,
  setFlowEdgesType,
  setFlowNodeCached,
  setFlowNodeLoopParent,
  setFlowNodeSize,
  setFlowNodeUiState,
  setFlowViewport,
  toggleFlowNodeCollapsed,
  ungroupFlowNodes,
  updateFlowCacheStatus,
  updateFlowNodeProgress,
  writeNodeParam,
} from './flowNodeMutations';
import { deepEqual } from '../utils/deepEqual';
import {
  collapseUserBlockInstance,
  configureUserBlockInstance,
  expandUserBlockGraph,
  expandUserBlockInstance,
  fitUserBlockInstance,
  isUserBlockExpandedInstance,
  USER_BLOCK_COLLAPSED_HEIGHT,
  USER_BLOCK_COLLAPSED_WIDTH,
} from '../studio/userBlocks';
import { useUserBlockStore } from './useUserBlockStore';
import { replaceFlowGraph, type FlowGraphReplacement, type FlowGraphReplacementOptions } from './flowGraphMutations';
import { decorateConnectionEdges } from '../theme/connectionTypes';

export type CustomNodeType = Node<NodeData, NodeData['type']>;
export interface CustomConnection extends Connection {
  edgeType?: 'default' | 'smoothstep' | 'straight' | 'step' | string;
}

export type ReplaceGraphOptions = FlowGraphReplacementOptions & {
  historyLabel?: string;
};

export type ArrangeGraphOptions = {
  history?: boolean;
};

export type FlowStore = {
  nodes: CustomNodeType[];
  edges: Edge[];
  viewport: Viewport;
  lastExecutionTime: number;
  historyPast: FlowHistorySnapshot[];
  historyFuture: FlowHistorySnapshot[];
  historyTransaction: FlowHistoryTransaction | null;
  layoutRevision: number;

  // events
  onNodesChange: OnNodesChange<CustomNodeType>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: (conn: CustomConnection) => void;

  // actions
  addNode: (node: CustomNodeType) => void;
  removeNodes: (ids: string | string[]) => void;
  removeEdges: (id: string | string[]) => void;
  clearWorkflow: () => void;
  replaceGraph: (replacement: FlowGraphReplacement, options?: ReplaceGraphOptions) => void;
  getParam: <K extends keyof NodeParams>(id: string, param: string, key: K) => NodeParams[K] | null;
  setParam: <K extends keyof NodeParams = 'value'>(id: string, param: string, value: NodeParams[K], key?: K) => void;
  setParamWithHistory: <K extends keyof NodeParams = 'value'>(
    id: string,
    param: string,
    value: NodeParams[K],
    key?: K,
  ) => void;
  setNodeSize: (id: string, width: number, height: number) => void;
  getNodeParamsValues: (id: string) => Record<string, unknown>;
  replaceNodeParams: (id: string, params: Record<string, NodeParams>) => void;
  setNodeUiState: (id: string, uiState: Partial<NonNullable<NodeData['uiState']>>) => void;
  clearNodeUiStates: () => void;
  duplicateNode: (id: string) => string | null;
  toggleNodeCollapsed: (id: string) => void;
  resetNodeSize: (id: string) => void;
  setAllEdgesType: (edgeType: 'default' | 'smoothstep') => void;
  updateHandleConnectionStatus: () => void;
  updateSignalValues: (edges: Edge | Edge[]) => void;
  getSignalValue: (id: string, param: string) => NodeParamSignal['value'] | undefined;
  groupNodes: (ids: string[]) => void;
  loopNodes: (ids: string[]) => void;
  setNodeLoopParent: (nodeId: string, loopId: string | null) => void;
  toggleUserBlockExpanded: (id: string) => void;
  fitUserBlockToChildren: (id: string) => void;
  configureUserBlock: (
    id: string,
    changes: {
      name: string;
      inputLabels: Record<string, string>;
      outputLabels: Record<string, string>;
      exposedParamIds: Set<string>;
    },
  ) => void;
  arrangeGraph: (options?: ArrangeGraphOptions) => Promise<void>;
  refreshConnectionVisuals: () => void;
  ungroupNodes: (id: string) => void;
  setViewport: (viewport: Viewport) => void;
  setNodeCached: (
    id: string,
    cached: boolean,
    memoryUsage?: Record<string, number>,
    executionTime?: Record<string, number>,
  ) => void;
  updateCacheStatus: (ids: string | string[]) => void;
  exportGraph: (sid: string, targetNodeId?: string) => APIGraphExport;
  updateProgress: (
    id: string,
    progress: number,
    metadata?: Partial<
      Pick<
        NodeData,
        'activeTaskId' | 'attemptIndex' | 'executionStatus' | 'executionPhase' | 'progressMessage' | 'executionProgress'
      >
    >,
  ) => void;
  resetExecutionProgress: (taskId?: string | null) => void;
  resetStatus: (cachedIds: string | string[]) => void;
  withHistory: (label: string, mutation: () => void) => void;
  beginHistoryTransaction: (label: string) => void;
  commitHistoryTransaction: () => void;
  cancelHistoryTransaction: () => void;
  resetHistory: () => void;
  undo: () => void;
  redo: () => void;
  toObject: () => {
    nodes: CustomNodeType[];
    edges: Edge[];
    viewport: Viewport;
  };
};

export type APIGraphExport = ApiGraphExport;
export type FlowHistorySnapshot = {
  nodes: CustomNodeType[];
  edges: Edge[];
  viewport: Viewport;
};

type FlowHistoryTransaction = {
  label: string;
  depth: number;
  snapshot: FlowHistorySnapshot;
};

const FLOW_STORAGE_KEY = 'modiff.flow';
const FLOW_STORAGE_VERSION = 1;
const FLOW_HISTORY_LIMIT = 50;
migrateLocalStorageKey('reactflow', FLOW_STORAGE_KEY);

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFinitePosition(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  );
}

function isPersistedFlowNode(value: unknown): value is CustomNodeType {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isFinitePosition(value.position)) return false;
  if (!isRecord(value.data) || !isRecord(value.data.params)) return false;
  return (
    Object.values(value.data.params).every(isRecord) &&
    typeof value.data.type === 'string' &&
    typeof value.data.module === 'string' &&
    typeof value.data.action === 'string' &&
    typeof value.data.label === 'string'
  );
}

function isPersistedFlowEdge(value: unknown): value is Edge {
  return Boolean(
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id &&
    typeof value.source === 'string' &&
    value.source &&
    typeof value.target === 'string' &&
    value.target,
  );
}

function persistedViewport(value: unknown): Viewport {
  if (!isRecord(value)) return { x: 0, y: 0, zoom: 1 };
  const x = typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : 0;
  const y = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : 0;
  const zoom = typeof value.zoom === 'number' && Number.isFinite(value.zoom) && value.zoom > 0 ? value.zoom : 1;
  return { x, y, zoom };
}

export function normalizePersistedFlowState(value: unknown): FlowHistorySnapshot {
  const record = isRecord(value) ? value : {};
  const nodes = (Array.isArray(record.nodes) ? record.nodes : [])
    .filter(isPersistedFlowNode)
    .map(durableFlowNodeSnapshot);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(record.edges) ? record.edges : [])
    .filter(isPersistedFlowEdge)
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge) => cloneJson(edge));
  return {
    nodes,
    edges,
    viewport: persistedViewport(record.viewport),
  };
}

export function durableFlowNodeSnapshot(node: CustomNodeType) {
  const snapshot = cloneJson(node);
  delete snapshot.selected;
  delete snapshot.dragging;
  delete snapshot.measured;
  delete snapshot.data.isCached;
  delete snapshot.data.progress;
  delete snapshot.data.activeTaskId;
  delete snapshot.data.attemptIndex;
  delete snapshot.data.executionStatus;
  delete snapshot.data.executionPhase;
  delete snapshot.data.progressMessage;
  delete snapshot.data.executionProgress;
  delete snapshot.data.executionTime;
  delete snapshot.data.memoryUsage;
  snapshot.data.uiState = snapshot.data.uiState
    ? {
        collapsed: snapshot.data.uiState.collapsed,
        blockExpanded: snapshot.data.uiState.blockExpanded,
        blockCollapsedWidth: snapshot.data.uiState.blockCollapsedWidth,
        blockCollapsedHeight: snapshot.data.uiState.blockCollapsedHeight,
        disabled: snapshot.data.uiState.disabled,
      }
    : undefined;
  Object.values(snapshot.data.params).forEach((param) => {
    delete param.artifacts;
    delete param.onChange;
    delete param.onSignal;
    if (param.signal) {
      param.signal = { ...param.signal, value: undefined };
    }
  });
  return snapshot;
}

function snapshotFlowState(state: Pick<FlowStore, 'nodes' | 'edges' | 'viewport'>): FlowHistorySnapshot {
  return {
    nodes: state.nodes.map(durableFlowNodeSnapshot),
    edges: cloneJson(state.edges),
    viewport: cloneJson(state.viewport),
  };
}

function pushHistory(past: FlowHistorySnapshot[], snapshot: FlowHistorySnapshot) {
  return [...past, snapshot].slice(-FLOW_HISTORY_LIMIT);
}

function sameSnapshot(left: FlowHistorySnapshot, right: FlowHistorySnapshot) {
  return (
    deepEqual(left.nodes, right.nodes) && deepEqual(left.edges, right.edges) && deepEqual(left.viewport, right.viewport)
  );
}

function isUndoableNodeChange(change: NodeChange<CustomNodeType>) {
  if (change.type === 'select' || change.type === 'dimensions') {
    return false;
  }

  return true;
}

function isUndoableEdgeChange(change: EdgeChange<Edge>) {
  return change.type !== 'select';
}

export const useFlowStore = create<FlowStore>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      viewport: {
        x: 0,
        y: 0,
        zoom: 1,
      },
      lastExecutionTime: 0,
      historyPast: [],
      historyFuture: [],
      historyTransaction: null,
      layoutRevision: 0,

      onNodesChange: async (changes: NodeChange<CustomNodeType>[]) => {
        const applyChanges = () => {
          void applyFlowNodeChanges(changes, set, get);
        };
        if (changes.some(isUndoableNodeChange)) {
          get().withHistory('Change nodes', applyChanges);
        } else {
          applyChanges();
        }
      },
      onEdgesChange: (changes: EdgeChange<Edge>[]) => {
        const applyChanges = () => handleEdgesChange(changes, set, get);
        if (changes.some(isUndoableEdgeChange)) {
          get().withHistory('Change edges', applyChanges);
        } else {
          applyChanges();
        }
      },
      onConnect: (conn: CustomConnection) => {
        get().withHistory('Connect nodes', () => handleConnect(conn, set, get));
      },
      updateSignalValues: (edges: Edge | Edge[]) => {
        updateSignalsForEdges(edges, get);
      },
      getSignalValue: (id: string, param: string) => {
        const node = get().nodes.find((n) => n.id === id);
        if (!node) {
          return undefined;
        }
        const signal = node.data.params?.[param]?.signal;
        return signal ? signal.value : undefined;
      },
      updateHandleConnectionStatus: () => {
        refreshHandleConnectionStatus(get);
      },
      addNode: (node: CustomNodeType) => {
        get().withHistory('Add node', () => addFlowNode(node, set, get));
      },
      removeNodes: (ids: string | string[]) => {
        get().withHistory('Remove nodes', () => removeFlowNodes(ids, set, get));
      },
      removeEdges: (ids: string | string[]) => {
        get().withHistory('Remove edges', () => removeFlowEdges(ids, get));
      },
      clearWorkflow: () => {
        get().withHistory('Clear workflow', () => clearFlowWorkflow(set, get));
      },
      replaceGraph: (replacement, options = {}) => {
        const applyReplacement = () => replaceFlowGraph(replacement, options, set, get);
        if (options.historyLabel) {
          get().withHistory(options.historyLabel, applyReplacement);
        } else {
          applyReplacement();
        }
      },
      getParam: <K extends keyof NodeParams>(id: string, param: string, key: K) => {
        return readNodeParam(id, param, key, get);
      },
      setParam: <K extends keyof NodeParams = 'value'>(id: string, param: string, value: NodeParams[K], key?: K) => {
        writeNodeParam(id, param, value, key, set);
        if (key === 'type') {
          get().refreshConnectionVisuals();
        }
      },
      setParamWithHistory: <K extends keyof NodeParams = 'value'>(
        id: string,
        param: string,
        value: NodeParams[K],
        key?: K,
      ) => {
        get().withHistory('Edit node parameter', () => writeNodeParam(id, param, value, key, set));
        if (key === 'type') {
          get().refreshConnectionVisuals();
        }
      },
      setNodeSize: (id: string, width: number, height: number) => {
        get().withHistory('Resize node', () => setFlowNodeSize(id, width, height, set));
      },
      getNodeParamsValues: (id: string) => {
        return getFlowNodeParamValues(id, get);
      },
      replaceNodeParams: (id: string, params: Record<string, NodeParams>) => {
        replaceFlowNodeParams(id, params, set, get);
        get().refreshConnectionVisuals();
      },
      setNodeUiState: (id, uiState) => {
        setFlowNodeUiState(id, uiState, set);
      },
      clearNodeUiStates: () => {
        clearFlowNodeUiStates(set);
      },
      duplicateNode: (id) => {
        let nextId: string | null = null;
        get().withHistory('Duplicate node', () => {
          nextId = duplicateFlowNode(id, set, get);
        });
        return nextId;
      },
      toggleNodeCollapsed: (id) => {
        get().withHistory('Toggle node collapse', () => toggleFlowNodeCollapsed(id, get));
      },
      resetNodeSize: (id) => {
        const node = get().nodes.find((item) => item.id === id);
        if (node?.data.type === 'block') {
          get().withHistory(node.data.uiState?.blockExpanded ? 'Fit block to contents' : 'Reset block size', () => {
            if (node.data.uiState?.blockExpanded) {
              set((state) => {
                const graph = fitUserBlockInstance(state, id);
                return graph === state ? state : { nodes: graph.nodes };
              });
              return;
            }
            set((state) => ({
              nodes: state.nodes.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      width: USER_BLOCK_COLLAPSED_WIDTH,
                      height: USER_BLOCK_COLLAPSED_HEIGHT,
                      data: {
                        ...item.data,
                        uiState: {
                          ...item.data.uiState,
                          blockCollapsedWidth: USER_BLOCK_COLLAPSED_WIDTH,
                          blockCollapsedHeight: USER_BLOCK_COLLAPSED_HEIGHT,
                        },
                      },
                    }
                  : item,
              ),
            }));
          });
          return;
        }
        get().withHistory('Reset node size', () => resetFlowNodeSize(id, set));
      },
      setAllEdgesType: (edgeType: 'default' | 'smoothstep') => {
        get().withHistory('Change edge style', () => setFlowEdgesType(edgeType, set));
      },
      groupNodes: (ids: string[]) => {
        get().withHistory('Group nodes', () => groupFlowNodes(ids, set));
      },
      loopNodes: (ids: string[]) => {
        get().withHistory('Create loop', () => loopFlowNodes(ids, set));
      },
      setNodeLoopParent: (nodeId, loopId) => {
        get().withHistory(loopId ? 'Move node into loop' : 'Move node out of loop', () =>
          setFlowNodeLoopParent(nodeId, loopId, set),
        );
      },
      toggleUserBlockExpanded: (id) => {
        get().withHistory('Toggle block expansion', () => {
          set((state) => {
            const block = state.nodes.find((node) => node.id === id && node.data.type === 'block');
            if (!block) return state;
            const graph = isUserBlockExpandedInstance(state, id)
              ? collapseUserBlockInstance(state, id, useUserBlockStore.getState().blocks)
              : expandUserBlockInstance(state, id, useUserBlockStore.getState().blocks);
            return graph === state
              ? state
              : {
                  nodes: graph.nodes,
                  edges: decorateConnectionEdges(graph.nodes, graph.edges),
                };
          });
          get().updateHandleConnectionStatus();
          get().updateSignalValues(get().edges);
        });
      },
      fitUserBlockToChildren: (id) => {
        set((state) => {
          const graph = fitUserBlockInstance(state, id);
          return graph === state ? state : { nodes: graph.nodes };
        });
      },
      configureUserBlock: (id, changes) => {
        get().withHistory('Configure block', () => {
          set((state) => {
            const graph = configureUserBlockInstance(state, id, useUserBlockStore.getState().blocks, changes);
            return graph === state ? state : { nodes: graph.nodes, edges: graph.edges };
          });
          get().updateHandleConnectionStatus();
        });
      },
      arrangeGraph: async (options = {}) => {
        const applyLayout = () => {
          set((state) => {
            const arranged = arrangeGraphNodes(state.nodes, state.edges);
            return {
              nodes: arranged,
              layoutRevision: state.layoutRevision + 1,
            };
          });
        };
        if (options.history === false) {
          applyLayout();
        } else {
          get().withHistory('Arrange graph', applyLayout);
        }
      },
      refreshConnectionVisuals: () => {
        set((state) => {
          const edges = decorateConnectionEdges(state.nodes, state.edges);
          return edges === state.edges ? state : { edges };
        });
      },
      ungroupNodes: (id: string) => {
        get().withHistory('Ungroup nodes', () => ungroupFlowNodes(id, set));
      },
      setViewport: (viewport: Viewport) => {
        setFlowViewport(viewport, set);
      },

      setNodeCached: (
        id: string,
        isCached: boolean,
        memoryUsage?: Record<string, number>,
        executionTime?: Record<string, number>,
      ) => {
        setFlowNodeCached(id, isCached, memoryUsage, executionTime, set);
      },

      updateCacheStatus: (ids: string | string[]) => {
        updateFlowCacheStatus(ids, set);
      },

      exportGraph: (sid: string, targetNodeId?: string) => {
        const { nodes, edges } = get();
        const expanded = expandUserBlockGraph(nodes, edges, useUserBlockStore.getState().blocks);
        return buildApiGraphExport({
          nodes: expanded.nodes,
          edges: expanded.edges,
          sid,
          targetNodeId: nodes.find((node) => node.id === targetNodeId)?.data.userBlockId ? undefined : targetNodeId,
          setParam: get().setParam,
        });
      },
      updateProgress: (id: string, progress: number, metadata) => {
        updateFlowNodeProgress(id, progress, metadata, set);
      },
      resetExecutionProgress: (taskId) => {
        resetFlowExecutionProgress(set, taskId);
      },
      resetStatus: (cachedIds: string | string[]) => {
        resetFlowStatus(cachedIds, set, get);
      },
      withHistory: (_label: string, mutation: () => void) => {
        if (get().historyTransaction) {
          mutation();
          return;
        }

        const before = snapshotFlowState(get());
        set({
          historyTransaction: {
            label: _label,
            depth: 1,
            snapshot: before,
          },
        });
        try {
          mutation();
        } catch (error) {
          set({ historyTransaction: null });
          throw error;
        }
        const after = snapshotFlowState(get());

        if (sameSnapshot(before, after)) {
          set({ historyTransaction: null });
          return;
        }

        set((state) => ({
          historyPast: pushHistory(state.historyPast, before),
          historyFuture: [],
          historyTransaction: null,
        }));
      },
      beginHistoryTransaction: (label: string) => {
        const current = get().historyTransaction;
        if (current) {
          set({
            historyTransaction: {
              ...current,
              depth: current.depth + 1,
            },
          });
          return;
        }

        set({
          historyTransaction: {
            label,
            depth: 1,
            snapshot: snapshotFlowState(get()),
          },
        });
      },
      commitHistoryTransaction: () => {
        const current = get().historyTransaction;
        if (!current) {
          return;
        }

        if (current.depth > 1) {
          set({
            historyTransaction: {
              ...current,
              depth: current.depth - 1,
            },
          });
          return;
        }

        const after = snapshotFlowState(get());
        if (sameSnapshot(current.snapshot, after)) {
          set({ historyTransaction: null });
          return;
        }

        set((state) => ({
          historyPast: pushHistory(state.historyPast, current.snapshot),
          historyFuture: [],
          historyTransaction: null,
        }));
      },
      cancelHistoryTransaction: () => {
        set({ historyTransaction: null });
      },
      resetHistory: () => {
        set({ historyPast: [], historyFuture: [], historyTransaction: null });
      },
      undo: () => {
        const past = get().historyPast;
        const previous = past[past.length - 1];
        if (!previous) {
          return;
        }

        const current = snapshotFlowState(get());
        replaceFlowGraph(
          {
            nodes: cloneJson(previous.nodes),
            edges: cloneJson(previous.edges),
            viewport: cloneJson(previous.viewport),
          },
          { clearRemovedCache: false },
          set,
          get,
        );
        set({
          historyPast: past.slice(0, -1),
          historyFuture: [current, ...get().historyFuture].slice(0, FLOW_HISTORY_LIMIT),
          historyTransaction: null,
        });
        get().updateHandleConnectionStatus();
        get().updateSignalValues(get().edges);
      },
      redo: () => {
        const future = get().historyFuture;
        const next = future[0];
        if (!next) {
          return;
        }

        const current = snapshotFlowState(get());
        replaceFlowGraph(
          {
            nodes: cloneJson(next.nodes),
            edges: cloneJson(next.edges),
            viewport: cloneJson(next.viewport),
          },
          { clearRemovedCache: true },
          set,
          get,
        );
        set({
          historyPast: pushHistory(get().historyPast, current),
          historyFuture: future.slice(1),
          historyTransaction: null,
        });
        get().updateHandleConnectionStatus();
        get().updateSignalValues(get().edges);
      },
      toObject: () => {
        return snapshotFlowState(get());
      },
    }),
    {
      name: FLOW_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: FLOW_STORAGE_VERSION,
      migrate: (persisted) => normalizePersistedFlowState(persisted),
      merge: (persisted, current) => ({
        ...current,
        ...normalizePersistedFlowState(persisted),
        historyPast: [],
        historyFuture: [],
        historyTransaction: null,
      }),
      partialize: (state) => snapshotFlowState(state),
      onRehydrateStorage: () => (state) => {
        state?.resetExecutionProgress();
      },
    },
  ),
);
