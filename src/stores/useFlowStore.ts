import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { NodeData, NodeParams, type NodeParamSignal } from './useNodeStore';
import { Node, Edge, OnNodesChange, OnEdgesChange, NodeChange, EdgeChange, Connection, Viewport } from '@xyflow/react';

import type { ApiGraphExport } from '../types/api';
import { migrateLocalStorageKey } from '../utils/persistMigration';
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
  readNodeParam,
  removeFlowEdges,
  removeFlowNodes,
  replaceFlowNodeParams,
  resetFlowNodeSize,
  resetFlowExecutionProgress,
  resetFlowStatus,
  setFlowEdgesType,
  setFlowNodeCached,
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
import { expandUserBlockGraph } from '../studio/userBlocks';
import { useUserBlockStore } from './useUserBlockStore';
import { replaceFlowGraph, type FlowGraphReplacement, type FlowGraphReplacementOptions } from './flowGraphMutations';

export type CustomNodeType = Node<NodeData, NodeData['type']>;
export interface CustomConnection extends Connection {
  edgeType?: 'default' | 'smoothstep' | 'straight' | 'step' | string;
}

export type ReplaceGraphOptions = FlowGraphReplacementOptions & {
  historyLabel?: string;
};

export type FlowStore = {
  nodes: CustomNodeType[];
  edges: Edge[];
  viewport: Viewport;
  lastExecutionTime: number;
  historyPast: FlowHistorySnapshot[];
  historyFuture: FlowHistorySnapshot[];
  historyTransaction: FlowHistoryTransaction | null;

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
      Pick<NodeData, 'activeTaskId' | 'attemptIndex' | 'executionStatus' | 'executionPhase' | 'progressMessage'>
    >,
  ) => void;
  resetExecutionProgress: () => void;
  resetStatus: (cachedIds: string | string[]) => void;
  withHistory: (label: string, mutation: () => void) => void;
  beginHistoryTransaction: (label: string) => void;
  commitHistoryTransaction: () => void;
  cancelHistoryTransaction: () => void;
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
const FLOW_HISTORY_LIMIT = 50;
migrateLocalStorageKey('reactflow', FLOW_STORAGE_KEY);

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function durableFlowNodeSnapshot(node: CustomNodeType) {
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
  delete snapshot.data.executionTime;
  delete snapshot.data.memoryUsage;
  snapshot.data.uiState = snapshot.data.uiState
    ? {
        collapsed: snapshot.data.uiState.collapsed,
        disabled: snapshot.data.uiState.disabled,
      }
    : undefined;
  Object.values(snapshot.data.params).forEach((param) => {
    delete param.artifacts;
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
      },
      setNodeSize: (id: string, width: number, height: number) => {
        get().withHistory('Resize node', () => setFlowNodeSize(id, width, height, set));
      },
      getNodeParamsValues: (id: string) => {
        return getFlowNodeParamValues(id, get);
      },
      replaceNodeParams: (id: string, params: Record<string, NodeParams>) => {
        replaceFlowNodeParams(id, params, set, get);
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
        get().withHistory('Reset node size', () => resetFlowNodeSize(id, set));
      },
      setAllEdgesType: (edgeType: 'default' | 'smoothstep') => {
        get().withHistory('Change edge style', () => setFlowEdgesType(edgeType, set));
      },
      groupNodes: (ids: string[]) => {
        get().withHistory('Group nodes', () => groupFlowNodes(ids, set));
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
      resetExecutionProgress: () => {
        resetFlowExecutionProgress(set);
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
        return {
          nodes: get().nodes,
          edges: get().edges,
          viewport: get().viewport,
        };
      },
    }),
    {
      name: FLOW_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
        viewport: state.viewport,
      }),
    },
  ),
);
