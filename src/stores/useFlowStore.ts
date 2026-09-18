import { sharedOperationInput } from '../workflow/operationSharedInputs';
// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { create } from 'zustand';
import { createDurableNodesSelector } from './flowDurableReferences';
import { persist, createJSONStorage } from 'zustand/middleware';
import { NodeData, NodeParams, type NodeParamSignal } from './useNodeStore';
import { Node, Edge, OnNodesChange, OnEdgesChange, NodeChange, EdgeChange, Connection, Viewport } from '@xyflow/react';
import { nanoid } from 'nanoid';

import type { ApiGraphExport } from '../types/api';
import { migrateLocalStorageKey } from '../utils/persistMigration';
import { arrangeGraphNodes } from '../workflow/graphLayout';
import {
  handleConnect,
  handleEdgesChange,
  handleReconnect,
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
  applyUserBlockDefinitionToInstance,
  expandUserBlockGraph,
  expandUserBlockInstance,
  fitUserBlockInstance,
  insertNodeAtUserBlockSuggestion,
  isUserBlockExpandedInstance,
  placeExistingNodeInsideExpandedUserBlock,
  USER_BLOCK_COLLAPSED_HEIGHT,
  USER_BLOCK_COLLAPSED_WIDTH,
} from '../studio/userBlocks';
import { useUserBlockStore } from './useUserBlockStore';
import { replaceFlowGraph, type FlowGraphReplacement, type FlowGraphReplacementOptions } from './flowGraphMutations';
import { decorateConnectionEdges } from '../theme/connectionTypes';
import {
  collapseHuggingFaceClusterInstance,
  expandHuggingFaceClusterInstance,
  expandHuggingFaceClusterBoundaryEdges,
  fitHuggingFaceClusterInstance,
  HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
  HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
  isHuggingFaceClusterExpanded,
  setHuggingFaceClusterGraphChildParameter,
  setHuggingFaceClusterGraphExecution,
  setHuggingFaceClusterGraphExecutionParameter,
  setHuggingFaceClusterGraphExecutionPosition,
  setHuggingFaceClusterGraphParameter,
  toggleHuggingFaceClusterBlockExpanded,
} from '../studio/huggingFaceClusterGraph';
import { useHuggingFaceNodeLibraryStore } from './useHuggingFaceNodeLibraryStore';
import { useHuggingFaceModularConditionalStore } from './useHuggingFaceModularConditionalStore';
import {
  reviewedBlockCanBeAuthoredV2,
  bindReviewedNodeContextV2,
  reviewedDestinationContextV2,
} from '../studio/reviewedBlockContextV2';
import { useHuggingFaceClusterRuntimeStore } from './useHuggingFaceClusterRuntimeStore';
import type { UserBlockDefinition } from '../studio/types';
import type { UserBlockInsertionSuggestion } from '../studio/userBlocks';
import type {
  BlockBoundaryV2,
  BlockControlV2,
  BlockPreviewBindingV2,
  BlockDefinitionV2,
  BlockGraphNodeV2,
  BlockJsonValue,
} from '../studio/blockSchemaV2';
import {
  blockGraphParentIdsV2,
  blockGraphSubtreeNodeIdsV2,
  blockModularContainerNodeIdsV2,
  createBlockInstanceV2,
} from '../studio/blockSchemaV2';
import { stableStringify } from '../studio/stableHash';
import { reparentOrdinaryBlockNodeV2 } from '../studio/blockReparentingV2';
import { repositionBlockChildV2 } from '../studio/blockLayoutDragV2';
import { detachBlockGraphNodesV2, remapDetachedBlockEdgesV2 } from '../studio/blockDetachmentV2';
import {
  assertBlockCrossingConnectionV2,
  blockConnectionTargetsV2,
  blockCrossingHandleV2,
  parseBlockCrossingHandleV2,
} from '../studio/blockCrossingConnectionsV2';
import {
  rebaseBlockInstanceV2ToDefinition,
  reusableBlockDefinitionFromSubtreeV2,
} from '../studio/blockDefinitionPersistenceV2';
import { configureBlockContainerInterfaceV1, setBlockContainerControlValueV1 } from '../studio/blockContainerEditingV1';
import {
  blockContainerFieldV1,
  blockContainerFieldValueV1,
  remapBlockContainerInterfaceV1,
} from '../studio/blockContainerInterfaceV1';
import { assertBlockRouteEdgesCompatibleV1, switchBlockRouteInstanceV1 } from '../studio/blockRouteSelectionV1';
import {
  assertBlockInternalConnectionV2,
  addBlockEffectiveGraphNodeV2,
  addBlockEffectiveGraphSubtreeV2,
  blockExpandedProjectionSizeV2,
  blockInputPortBindingsV2,
  blockProjectionNodeIdV2,
  blockRelativeInternalLayoutsV2,
  canonicalizePersistedBlockGraphV2,
  createBlockRootNodeV2,
  expandBlockGraphV2ForExecution,
  isBlockRootV2,
  materializeBlockProjectionV2,
  replaceBlockEffectiveGraphV2,
  replaceBlockEffectiveGraphNodeV2,
  replaceBlockEffectiveInterfaceV2,
  setBlockInstanceValueV2 as reduceBlockInstanceValueV2,
  setBlockPreviewStateV2 as reduceBlockPreviewStateV2,
  setBlockPresentationV2 as reduceBlockPresentationV2,
  type BlockPreviewPatchV2,
  type BlockPresentationPatchV2,
} from '../studio/blockRuntimeV2';

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
  onReconnect: (oldEdge: Edge, conn: Connection) => void;

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
  setNodeSize: (id: string, width: number, height: number, options?: { history?: boolean }) => void;
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
  toggleHuggingFaceClusterExpanded: (id: string) => void;
  toggleHuggingFaceClusterBlockExpanded: (id: string, path: string) => void;
  setHuggingFaceClusterParameter: (id: string, name: string, value: unknown) => void;
  setHuggingFaceClusterExecution: (id: string, admissionId: string | null) => void;
  setHuggingFaceClusterExecutionParameter: (id: string, source: string, value: unknown) => void;
  persistHuggingFaceClusterExecutionPosition: (nodeId: string) => void;
  toggleUserBlockExpanded: (id: string) => void;
  setBlockInstanceValueV2: (id: string, logicalId: string, value: BlockJsonValue) => void;
  switchBlockRouteV1: (
    id: string,
    routeKey: string,
    compiledDestination: NonNullable<NodeData['blockInstanceV2']>,
  ) => void;
  applyBlockSuggestedInputsV2: (id: string, suggestionId: string) => void;
  setBlockPresentationV2: (id: string, patch: BlockPresentationPatchV2) => void;
  toggleBlockContainerExpandedV2: (id: string, semanticNodeId: string) => void;
  setBlockPreviewStateV2: (
    id: string,
    preview: { nodeId: string; outputPortId: string },
    patch: BlockPreviewPatchV2,
  ) => void;
  ensureBlockProjectionV2: (id: string) => void;
  ensureBlockMinimumHeightV2: (id: string, minimumHeight: number) => void;
  persistBlockCanvasPresentationV2: (nodeId: string) => void;
  fitBlockProjectionToChildrenV2: (id: string) => void;
  growBlockContainersForDragV2: (nodeId: string) => void;
  adoptNodeIntoBlockV2: (nodeId: string, blockId: string, parentSemanticNodeId?: string) => void;
  adoptBlockFragmentIntoBlockV2: (fragmentId: string, blockId: string, parentSemanticNodeId?: string) => void;
  replaceNodeInBlockV2: (nodeId: string, projectedNodeId: string) => void;
  moveNodeOutOfBlockV2: (projectedNodeId: string, position: { x: number; y: number }) => string;
  reparentNodeInBlockV2: (
    projectedNodeId: string,
    parentSemanticNodeId: string | undefined,
    absolutePosition: { x: number; y: number },
  ) => void;
  configureBlockInterfaceV2: (
    id: string,
    value: { boundary: BlockBoundaryV2; controls: BlockControlV2[]; previews?: BlockPreviewBindingV2[] },
    subtreeId?: string,
  ) => void;
  fitUserBlockToChildren: (id: string) => void;
  placeNodeInUserBlock: (nodeId: string, blockId: string) => void;
  insertNodeInUserBlock: (blockId: string, suggestion: UserBlockInsertionSuggestion) => void;
  configureUserBlock: (
    id: string,
    changes: {
      name: string;
      inputLabels: Record<string, string>;
      outputLabels: Record<string, string>;
      exposedParamIds: Set<string>;
    },
  ) => void;
  applyUserBlockDefinition: (id: string, definition: UserBlockDefinition) => void;
  applyBlockDefinitionV2: (id: string, definition: BlockDefinitionV2) => void;
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
  exportGraph: (
    sid: string,
    targetNodeId?: string,
    options?: { randomizeSeeds?: boolean; sourceGraph?: { nodes: CustomNodeType[]; edges: Edge[] } },
  ) => APIGraphExport;
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

/**
 * Resolve a durable canvas target to the concrete node that will exist after
 * composite expansion. Keeping this beside exportGraph prevents toolbar runs,
 * direct store exports, and queued submissions from selecting different paths.
 */
export function resolveFlowExecutionTargetNodeId(
  nodes: CustomNodeType[],
  targetNodeId?: string,
  edges: Edge[] = [],
): string | undefined {
  if (!targetNodeId) return undefined;
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!target) return targetNodeId;
  if (target.data.blockProjectionContainer) return resolveFlowExecutionTargetNodeIds(nodes, targetNodeId)?.[0];

  if (target.data.blockInstanceV2 !== undefined) {
    if (!isBlockRootV2(target)) {
      throw new Error(`Block V2 run target ${targetNodeId} has malformed instance authority.`);
    }
    const instance = target.data.blockInstanceV2;
    const nodesWithOutgoingEdges = new Set(instance.effectiveGraph.edges.map(({ sourceNodeId }) => sourceNodeId));
    // Some reviewed graphs expose diagnostic text previews on intermediate
    // encoder nodes as well as the actual terminal media preview. Lexical
    // compiler order historically marked the diagnostic preview as primary.
    // Running a Block must target a terminal preview when one exists so the
    // complete generation path executes; retain the explicit primary marker
    // only as the tie-breaker/fallback.
    const terminalPreviews = instance.definitionSnapshot.previews.filter(
      ({ nodeId }) => !nodesWithOutgoingEdges.has(nodeId),
    );
    const preview =
      terminalPreviews.find((candidate) => candidate.primary === true) ??
      terminalPreviews.find((candidate) => candidate.mediaType !== 'text') ??
      terminalPreviews[0] ??
      instance.definitionSnapshot.previews.find((candidate) => candidate.primary === true) ??
      instance.definitionSnapshot.previews[0];
    return preview
      ? blockProjectionNodeIdV2(instance.instanceId, preview.nodeId)
      : resolveFlowExecutionTargetNodeIds(nodes, targetNodeId)?.[0];
  }

  if (target.data.userBlockId) {
    // A generic User Node expands to ordinary nodes with this instance prefix.
    // Returning undefined would run every disconnected workflow on the canvas.
    const expanded = expandUserBlockGraph(nodes, edges, useUserBlockStore.getState().blocks);
    const prefix = `${targetNodeId}__`;
    const owned = expanded.nodes.filter((node) => node.id.startsWith(prefix));
    const ownedIds = new Set(owned.map((node) => node.id));
    const withInternalOutputs = new Set(
      expanded.edges.filter((edge) => ownedIds.has(edge.target)).map((edge) => edge.source),
    );
    const terminals = owned.filter((node) => !withInternalOutputs.has(node.id));
    const preview = terminals.find((node) =>
      Object.values(node.data.params ?? {}).some((param) =>
        ['ui_image', 'ui_video', 'ui_audio'].includes(String(param.display)),
      ),
    );
    const endpoint = preview ?? terminals[0];
    if (!endpoint) throw new Error(`Block run target ${targetNodeId} has no executable terminal node.`);
    return endpoint.id;
  }

  // Historical registered Cluster roots retain their separate compatibility path.
  if (target.data.huggingFaceClusterRole === 'root') return undefined;
  return targetNodeId;
}

/** Root and nested Block Run include all local terminal branches and upstream dependencies. */
export function resolveFlowExecutionTargetNodeIds(
  nodes: CustomNodeType[],
  targetNodeId?: string,
  edges: Edge[] = [],
): string[] | undefined {
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!target?.data.blockProjectionContainer && target?.data.blockInstanceV2 === undefined) {
    const id = resolveFlowExecutionTargetNodeId(nodes, targetNodeId, edges);
    return id ? [id] : undefined;
  }
  const isRoot = target.data.blockInstanceV2 !== undefined;
  const owner = isRoot ? target : nodes.find((node) => node.id === target.data.blockProjectionOwnerId);
  const semanticId = isRoot ? undefined : target.data.blockProjectionNodeId;
  if (!owner?.data.blockInstanceV2 || !isBlockRootV2(owner) || (!isRoot && !semanticId))
    throw new Error('The selected internal Block has no valid execution owner.');
  const instance = owner.data.blockInstanceV2;
  const included = semanticId
    ? blockGraphSubtreeNodeIdsV2(instance.effectiveGraph, semanticId)
    : new Set(instance.effectiveGraph.nodes.map(({ nodeId }) => nodeId));
  const parents = blockGraphParentIdsV2(instance.effectiveGraph);
  const disabledIds = new Set(
    instance.effectiveGraph.nodes
      .filter((node) => isRecord(node.data.uiState) && node.data.uiState.disabled === true)
      .map(({ nodeId }) => nodeId),
  );
  const disabled = (id: string) => {
    let ancestor: string | undefined = id;
    while (ancestor) {
      if (disabledIds.has(ancestor)) return true;
      ancestor = parents.get(ancestor);
    }
    return false;
  };
  const executableIds = new Set(
    instance.effectiveGraph.nodes
      .filter(
        (node) =>
          included.has(node.nodeId) &&
          !disabled(node.nodeId) &&
          node.nodeType !== 'group' &&
          node.nodeType !== 'loop' &&
          node.data.module &&
          node.data.action,
      )
      .map((node) => node.nodeId),
  );
  const nonterminal = new Set(
    instance.effectiveGraph.edges
      .filter((edge) => executableIds.has(edge.sourceNodeId) && executableIds.has(edge.targetNodeId))
      .map((edge) => edge.sourceNodeId),
  );
  const terminals = [...executableIds].filter((id) => !nonterminal.has(id));
  if (!terminals.length)
    throw new Error(
      'This Block has no enabled executable terminal node. Add, enable or reconnect its nodes before running it.',
    );
  return terminals.map((id) => blockProjectionNodeIdV2(instance.instanceId, id));
}

/** Remove hidden registered-definition compiler sessions from every durable or executable graph view. */
export function withoutBlockCompilationTransientsV2(nodes: CustomNodeType[], edges: Edge[]) {
  const transientNodeIds = new Set(
    nodes.filter((node) => Boolean(node.data.blockCompilationTransientV2)).map((node) => node.id),
  );
  if (!transientNodeIds.size) return { nodes, edges };
  return {
    nodes: nodes.filter((node) => !transientNodeIds.has(node.id)),
    edges: edges.filter((edge) => !transientNodeIds.has(edge.source) && !transientNodeIds.has(edge.target)),
  };
}

function huggingFaceDefinitionForNode(node: CustomNodeType | undefined) {
  const reference = node?.data.huggingFaceClusterInstance?.definition;
  if (!reference) return undefined;
  return useHuggingFaceNodeLibraryStore
    .getState()
    .library?.definitions.find(
      (definition) =>
        definition.id === reference.id &&
        definition.libraryRevision === reference.libraryRevision &&
        definition.contentHash === reference.contentHash,
    );
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
  const durableNodes = (Array.isArray(record.nodes) ? record.nodes : [])
    .filter(isPersistedFlowNode)
    .filter((node) => !node.data.blockCompilationTransientV2)
    .map(durableFlowNodeSnapshot)
    // Cluster block and execution children are deterministic projections of
    // the pinned root definition. In particular, executable children require
    // volatile runtime/resource authority and must never regain authority by
    // being restored from a browser or workflow checkpoint.
    .filter((node) => node.data.huggingFaceClusterRole !== 'block' && node.data.huggingFaceClusterRole !== 'execution');
  const durableNodeIds = new Set(durableNodes.map((node) => node.id));
  const durableEdges = (Array.isArray(record.edges) ? record.edges : [])
    .filter(isPersistedFlowEdge)
    .filter((edge) => durableNodeIds.has(edge.source) && durableNodeIds.has(edge.target))
    .map((edge) => cloneJson(edge));
  const canonical = canonicalizePersistedBlockGraphV2(durableNodes, durableEdges);
  return {
    nodes: canonical.nodes,
    edges: canonical.edges,
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
        clusterCollapsedWidth: snapshot.data.uiState.clusterCollapsedWidth,
        clusterCollapsedHeight: snapshot.data.uiState.clusterCollapsedHeight,
        disabled: snapshot.data.uiState.disabled,
      }
    : undefined;
  Object.entries(snapshot.data.params).forEach(([name, param]) => {
    if (param.fieldOptions?.huggingFaceClusterPreviewSourceNodeId) {
      delete snapshot.data.params[name];
      return;
    }
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
  return normalizePersistedFlowState(state);
}

const selectPersistenceNodes = createDurableNodesSelector();
let persistenceSource: Pick<FlowStore, 'nodes' | 'edges' | 'viewport'> | undefined;
let persistenceSnapshot: FlowHistorySnapshot;
function persistedFlowSnapshot(state: FlowStore) {
  const nodes = selectPersistenceNodes(state.nodes);
  if (
    !persistenceSource ||
    persistenceSource.nodes !== nodes ||
    persistenceSource.edges !== state.edges ||
    persistenceSource.viewport !== state.viewport
  ) {
    persistenceSource = { nodes, edges: state.edges, viewport: state.viewport };
    persistenceSnapshot = snapshotFlowState(state);
  }
  return persistenceSnapshot;
}

function pushHistory(past: FlowHistorySnapshot[], snapshot: FlowHistorySnapshot) {
  return [...past, snapshot].slice(-FLOW_HISTORY_LIMIT);
}

function sameSnapshot(left: FlowHistorySnapshot, right: FlowHistorySnapshot) {
  return (
    deepEqual(left.nodes, right.nodes) && deepEqual(left.edges, right.edges) && deepEqual(left.viewport, right.viewport)
  );
}

/**
 * Replace the derived canvas projection for one source-neutral composite.
 * `BlockInstanceV2` remains the only durable authority: root controls and
 * connector params are intentionally never copied into `NodeData.params`.
 */
function projectBlockInstanceV2(
  state: Pick<FlowStore, 'nodes' | 'edges'>,
  id: string,
  instance: NonNullable<NodeData['blockInstanceV2']>,
) {
  const current = state.nodes.find((node) => node.id === id);
  if (!current) return null;
  const candidateHasInstance = Boolean(current.data.blockInstanceV2);
  if (!isBlockRootV2(current)) {
    if (candidateHasInstance) throw new Error(`Invalid Block V2 root ${id}.`);
    return null;
  }

  const root = createBlockRootNodeV2(instance, { selected: current.selected });
  const projection = materializeBlockProjectionV2(root);
  const [canonicalRoot, ...projectedChildren] = projection.nodes;
  if (!canonicalRoot) throw new Error(`Could not project Block V2 root ${id}.`);
  const projectedRoot = {
    ...canonicalRoot,
    ...(current.selected === undefined ? {} : { selected: current.selected }),
    ...(current.zIndex === undefined ? {} : { zIndex: current.zIndex }),
  };

  const previousById = new Map(state.nodes.map((node) => [node.id, node]));
  const nodes = state.nodes.flatMap((node) => {
    if (node.data.blockProjectionOwnerId === id) return [];
    if (node.id === id)
      return [
        projectedRoot,
        ...projectedChildren.map((child) => {
          const previous = previousById.get(child.id);
          return previous?.selected === undefined ? child : { ...child, selected: previous.selected };
        }),
      ];
    return [node];
  });
  const retainedEdges = state.edges.filter((edge) => {
    const data = isRecord(edge.data) ? edge.data : {};
    return data.blockProjectionOwnerId !== id;
  });
  return { nodes, edges: [...retainedEdges, ...projection.edges] };
}

function ordinaryBlockGraphNodeV2(node: CustomNodeType): BlockGraphNodeV2 {
  const snapshot = durableFlowNodeSnapshot(node);
  const nodeType = snapshot.type ?? snapshot.data.type;
  if (nodeType !== 'custom' && nodeType !== 'any')
    throw new Error(
      `Cannot move node "${node.id}" into this Block: only ordinary, non-container graph nodes are supported.`,
    );
  const data = cloneJson(snapshot.data) as unknown as BlockGraphNodeV2['data'];
  const modularDiffusers = snapshot.data.modularDiffusersCatalogNode
    ? cloneJson(snapshot.data.modularDiffusersCatalogNode)
    : undefined;
  delete (data as Record<string, unknown>).modularDiffusersCatalogNode;
  return {
    nodeId: snapshot.id,
    nodeType,
    data,
    ...(modularDiffusers ? { modularDiffusers } : {}),
  };
}

/**
 * Atomically replace one disconnected top-level canvas node with an ordinary
 * projected child owned by an expanded V2 Block. The explicit public
 * interface remains the immutable definition snapshot; this gesture only
 * changes the instance effective graph and presentation layout.
 */
function adoptTopLevelNodeIntoBlockV2(
  state: Pick<FlowStore, 'nodes' | 'edges'>,
  nodeId: string,
  blockId: string,
  parentSemanticNodeId?: string,
) {
  const source = state.nodes.find((node) => node.id === nodeId);
  if (!source) throw new Error(`Cannot move node "${nodeId}" into this Block because it no longer exists.`);
  const target = state.nodes.find((node) => node.id === blockId);
  if (!target) throw new Error(`Cannot move node "${nodeId}" into Block "${blockId}" because it no longer exists.`);
  if (!target.data.blockInstanceV2 || !isBlockRootV2(target))
    throw new Error(`Cannot move node "${nodeId}" into Block "${blockId}": the target Block is invalid.`);
  if (!target.data.blockInstanceV2.presentation.expanded)
    throw new Error(`Cannot move node "${nodeId}" into Block "${blockId}": expand the Block before dropping.`);
  if (source.id === target.id || source.data.type === 'block' || source.data.type === 'cluster')
    throw new Error('Legacy Blocks cannot be nested directly.');
  if (source.parentId)
    throw new Error(`Cannot move node "${nodeId}" into this Block: only disconnected top-level nodes are supported.`);
  if (state.nodes.some((node) => node.parentId === source.id))
    throw new Error(`Cannot move node "${nodeId}" into this Block because it owns nested canvas nodes.`);
  const parentSemantic = parentSemanticNodeId
    ? target.data.blockInstanceV2.effectiveGraph.nodes.find(
        ({ nodeId: candidate }) => candidate === parentSemanticNodeId,
      )
    : null;
  if (
    parentSemanticNodeId &&
    (!parentSemantic ||
      (parentSemantic.nodeType !== 'group' &&
        !(
          parentSemantic.modularDiffusers?.kind === 'upstream_block' &&
          parentSemantic.modularDiffusers.blockKind !== 'block'
        )))
  )
    throw new Error(`Cannot move node "${nodeId}" into unknown Modular container "${parentSemanticNodeId}".`);
  const incidentEdges = state.edges.filter((edge) => edge.source === source.id || edge.target === source.id);
  // Older ordinary nodes used bare NanoIDs, which may start with '_' or '-'.
  // Re-key only the explicitly adopted instance and its crossing edges; Undo
  // retains the original top-level ID. Strict schema validation still applies.
  const adoptedId = /^[_-]/u.test(source.id) ? `node-${source.id}` : source.id;
  const retainedCrossings: Edge[] = [];
  const crossingEdges = incidentEdges.flatMap((edge) => {
    if (!edge.sourceHandle || !edge.targetHandle) throw new Error('Cannot move an incomplete connection.');
    const adoptedEdgeId = /^[_-]/u.test(edge.id) ? `edge-${edge.id}` : edge.id;
    if (edge.source === source.id && edge.target === source.id)
      return [
        {
          edgeId: adoptedEdgeId,
          sourceNodeId: adoptedId,
          sourcePortId: edge.sourceHandle,
          targetNodeId: adoptedId,
          targetPortId: edge.targetHandle,
        },
      ];
    if (edge.source === source.id && edge.target === target.id) {
      const targets = blockConnectionTargetsV2(target, edge.targetHandle ?? '', 'input');
      if (!targets.length) throw new Error('The connected Block input is no longer available.');
      return targets.map((binding, index) => ({
        edgeId: index ? `workflow-edge-${nanoid()}` : adoptedEdgeId,
        sourceNodeId: adoptedId,
        sourcePortId: edge.sourceHandle!,
        targetNodeId: binding.nodeId,
        targetPortId: binding.fieldOrPortId,
      }));
    }
    if (edge.source === target.id && edge.target === source.id) {
      const binding = blockConnectionTargetsV2(target, edge.sourceHandle ?? '', 'output')[0];
      if (!binding) throw new Error('The connected Block output is no longer available.');
      return [
        {
          edgeId: adoptedEdgeId,
          sourceNodeId: binding.nodeId,
          sourcePortId: binding.fieldOrPortId,
          targetNodeId: adoptedId,
          targetPortId: edge.targetHandle,
        },
      ];
    }
    retainedCrossings.push({
      ...edge,
      ...(edge.source === source.id
        ? {
            source: target.id,
            sourceHandle: blockCrossingHandleV2({
              nodeId: adoptedId,
              fieldOrPortId: edge.sourceHandle,
              direction: 'output',
            }),
          }
        : {}),
      ...(edge.target === source.id
        ? {
            target: target.id,
            targetHandle: blockCrossingHandleV2({
              nodeId: adoptedId,
              fieldOrPortId: edge.targetHandle,
              direction: 'input',
            }),
          }
        : {}),
    });
    return [];
  });

  const width = source.measured?.width ?? source.width;
  const height = source.measured?.height ?? source.height;
  let adoptedNode = { ...ordinaryBlockGraphNodeV2(source), nodeId: adoptedId };
  if (parentSemantic) {
    const parentMetadata = parentSemantic.modularDiffusers;
    const sourceMetadata = adoptedNode.modularDiffusers;
    if (parentMetadata?.kind !== 'upstream_block' || sourceMetadata?.kind !== 'upstream_block') {
      // An ordinary utility stays an ordinary utility. Its customized owner
      // belongs to the flat graph, not fabricated Diffusers source metadata.
      adoptedNode = { ...adoptedNode, parentNodeId: parentSemantic.nodeId };
    } else {
      if (!parentMetadata.placementPath?.length)
        throw new Error('The destination Modular container has no exact placement identity.');
      const destinationContext = reviewedDestinationContextV2(target.data.blockInstanceV2, parentMetadata);
      if (
        !reviewedBlockCanBeAuthoredV2(
          sourceMetadata,
          destinationContext,
          useHuggingFaceModularConditionalStore.getState().snapshot,
        )
      )
        throw new Error(`Unsupported contract: ${sourceMetadata.blockClass} inside ${parentMetadata.blockClass}.`);
      const occupied = new Set(
        target.data.blockInstanceV2.effectiveGraph.nodes.map(({ modularDiffusers }) =>
          modularDiffusers?.placementPath?.join('/'),
        ),
      );
      const sourcePlacementPath = sourceMetadata.placementPath ?? [];
      const leaf = sourcePlacementPath[sourcePlacementPath.length - 1] ?? sourceMetadata.blockClass ?? 'block';
      let placementPath = [...parentMetadata.placementPath, leaf];
      let suffix = 2;
      while (occupied.has(placementPath.join('/')))
        placementPath = [...parentMetadata.placementPath, `${leaf}_${suffix++}`];
      adoptedNode = {
        ...bindReviewedNodeContextV2(adoptedNode, destinationContext),
        modularDiffusers: {
          ...sourceMetadata,
          runtimeRole: `custom:${placementPath.join('/')}`,
          placementPath,
          parentPlacementPath: [...parentMetadata.placementPath],
        },
      };
    }
  }
  const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  const absolutePosition = (node: CustomNodeType) => {
    let x = node.position.x;
    let y = node.position.y;
    let parentId = node.parentId;
    const visited = new Set([node.id]);
    while (parentId) {
      if (visited.has(parentId)) throw new Error(`Cannot place node "${nodeId}": canvas parent cycle detected.`);
      visited.add(parentId);
      const parent = nodeById.get(parentId);
      if (!parent) break;
      x += parent.position.x;
      y += parent.position.y;
      parentId = parent.parentId;
    }
    return { x, y };
  };
  const layoutOrigin = parentSemanticNodeId
    ? state.nodes.find(
        (node) =>
          node.data.blockProjectionOwnerId === blockId && node.data.blockProjectionNodeId === parentSemanticNodeId,
      )
    : target;
  const origin = layoutOrigin ? absolutePosition(layoutOrigin) : target.position;
  let instance = addBlockEffectiveGraphNodeV2(target.data.blockInstanceV2, adoptedNode, {
    layout: {
      x: source.position.x - origin.x,
      y: source.position.y - origin.y,
      ...(width && Number.isFinite(width) && width > 0 ? { width } : {}),
      ...(height && Number.isFinite(height) && height > 0 ? { height } : {}),
    },
  });
  if (crossingEdges.length) {
    for (const edge of crossingEdges)
      assertBlockInternalConnectionV2(
        instance,
        { nodeId: edge.sourceNodeId, fieldOrPortId: edge.sourcePortId },
        { nodeId: edge.targetNodeId, fieldOrPortId: edge.targetPortId },
      );
    instance = replaceBlockEffectiveGraphV2(instance, {
      ...instance.effectiveGraph,
      edges: [...instance.effectiveGraph.edges, ...crossingEdges],
    });
  }
  const projected = projectBlockInstanceV2(state, target.id, instance);
  if (!projected) throw new Error(`Cannot move node "${nodeId}" into Block "${blockId}": projection failed.`);
  const nextNodes = projected.nodes.filter((node) => node.id !== source.id);
  const nextEdges = [
    ...projected.edges.filter((edge) => !incidentEdges.some(({ id }) => id === edge.id)),
    ...retainedCrossings,
  ];
  for (const edge of retainedCrossings)
    assertBlockCrossingConnectionV2(edge as Connection, nextNodes, nextEdges, new Set([edge.id]));
  return {
    nodes: nextNodes,
    edges: nextEdges,
  };
}

function adoptTopLevelBlockFragmentIntoBlockV2(
  state: Pick<FlowStore, 'nodes' | 'edges'>,
  fragmentId: string,
  blockId: string,
  parentSemanticNodeId?: string,
) {
  const source = state.nodes.find((node) => node.id === fragmentId);
  const target = state.nodes.find((node) => node.id === blockId);
  const fragment = source?.data.blockInstanceV2;
  const targetInstance = target?.data.blockInstanceV2;
  if (!source || !fragment || !isBlockRootV2(source))
    throw new Error('The Modular Diffusers fragment is no longer available.');
  if (!target || !targetInstance || !isBlockRootV2(target) || !targetInstance.presentation.expanded)
    throw new Error('Expand a valid destination Block before dropping this Modular Diffusers fragment.');
  if (fragment.effectiveGraph.nodes.length === 0)
    throw new Error('An empty Block has no nodes to insert. Add content before nesting it.');
  const destinationParent = parentSemanticNodeId
    ? targetInstance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === parentSemanticNodeId)
    : null;
  if (
    parentSemanticNodeId &&
    (!destinationParent ||
      (destinationParent.nodeType !== 'group' &&
        !(
          destinationParent.modularDiffusers?.kind === 'upstream_block' &&
          destinationParent.modularDiffusers.blockKind !== 'block'
        )))
  )
    throw new Error(`The destination Modular container ${parentSemanticNodeId} is unavailable.`);
  const destinationMetadata = destinationParent?.modularDiffusers;
  const destinationContext = destinationMetadata && reviewedDestinationContextV2(targetInstance, destinationMetadata);
  const sourceParents = blockGraphParentIdsV2(fragment.effectiveGraph);
  const roots = fragment.effectiveGraph.nodes.filter((node) => !sourceParents.has(node.nodeId));
  const sourceMetadata = roots.length === 1 ? roots[0]!.modularDiffusers : undefined;
  const publicSurface = {
    schemaVersion: 1 as const,
    boundary: fragment.effectiveInterface.boundary,
    controls: fragment.effectiveInterface.controls.map((control) => {
      const entry = cloneJson(control);
      delete entry.defaultValue;
      return entry;
    }),
    previews: fragment.definitionSnapshot.previews.filter((preview) =>
      fragment.effectiveGraph.nodes.some((node) => node.nodeId === preview.nodeId),
    ),
  };
  const sourceLocal = roots.length === 1 ? roots[0]!.containerInterface : undefined;
  const needsWrapper =
    roots.length !== 1 ||
    // Do not overwrite an independently configured local surface when the
    // source's outer public surface happens to differ from its sole child.
    (sourceLocal !== undefined &&
      stableStringify({ ...sourceLocal, previews: sourceLocal.previews ?? [] }) !== stableStringify(publicSurface)) ||
    (roots[0]!.nodeType !== 'group' &&
      !(sourceMetadata?.kind === 'upstream_block' && sourceMetadata.blockKind !== 'block'));
  const wrapperId = needsWrapper ? `nested-block-${nanoid(16)}` : undefined;
  // Generic grouping imposes no pipeline family. An actual upstream control
  // owner requires a contract reviewed for its pinned execution context.
  if (
    destinationMetadata?.kind === 'upstream_block' &&
    fragment.effectiveGraph.nodes.some(
      ({ modularDiffusers }) =>
        modularDiffusers &&
        !reviewedBlockCanBeAuthoredV2(
          modularDiffusers,
          destinationContext!,
          useHuggingFaceModularConditionalStore.getState().snapshot,
        ),
    )
  )
    throw new Error('Choose a subtree with contracts reviewed for this destination.');

  const sourcePaths = new Map(
    fragment.effectiveGraph.nodes.flatMap((node) =>
      node.modularDiffusers?.kind === 'upstream_block'
        ? [[node.nodeId, node.modularDiffusers.placementPath!] as const]
        : [],
    ),
  );
  const sourceRootPath =
    !needsWrapper && sourceMetadata?.kind === 'upstream_block' ? sourceMetadata.placementPath! : [];
  const destinationParentPath =
    destinationMetadata?.kind === 'upstream_block' ? (destinationMetadata.placementPath ?? []) : [];
  const occupied = new Set(
    targetInstance.effectiveGraph.nodes.flatMap(({ modularDiffusers }) =>
      modularDiffusers?.placementPath?.length ? [modularDiffusers.placementPath.join('/')] : [],
    ),
  );
  const rootLeaf = sourceRootPath[sourceRootPath.length - 1] ?? `user_${nanoid(12)}`;
  let destinationRootPath = [...destinationParentPath, rootLeaf];
  let suffix = 2;
  while (occupied.has(destinationRootPath.join('/')))
    destinationRootPath = [...destinationParentPath, `${rootLeaf}_${suffix++}`];

  const semanticIdBySource = new Map<string, string>();
  fragment.effectiveGraph.nodes.forEach((node, index) => {
    semanticIdBySource.set(node.nodeId, `adopted-${nanoid(16)}-${index}`);
  });
  const rebasedPathBySource = new Map<string, string[]>();
  fragment.effectiveGraph.nodes.forEach((node) => {
    const path = sourcePaths.get(node.nodeId);
    if (path) rebasedPathBySource.set(node.nodeId, [...destinationRootPath, ...path.slice(sourceRootPath.length)]);
  });
  const nodes = fragment.effectiveGraph.nodes.map((node) => {
    const placementPath = rebasedPathBySource.get(node.nodeId);
    const metadata = node.modularDiffusers ? cloneJson(node.modularDiffusers) : undefined;
    if (metadata?.kind === 'upstream_block') delete metadata.parentPlacementPath;
    let copied = cloneJson(node);
    delete copied.parentNodeId;
    const sourceParent = sourceParents.get(node.nodeId);
    const parent = sourceParent ? semanticIdBySource.get(sourceParent) : (wrapperId ?? parentSemanticNodeId);
    if (parent) copied.parentNodeId = parent;
    for (const fieldId of Object.keys(isRecord(copied.data.params) ? copied.data.params : {})) {
      const field = blockContainerFieldV1(copied, fieldId);
      const value = blockContainerFieldValueV1(fragment, node.nodeId, fieldId);
      if (field && value !== undefined) field.value = cloneJson(value);
    }
    // Bake source values first: otherwise the source's saved hidden context
    // overwrites the destination binding during nested User Node adoption.
    if (destinationMetadata?.kind === 'upstream_block' && metadata?.kind === 'upstream_block')
      copied = bindReviewedNodeContextV2(copied, destinationContext!);
    const local = !needsWrapper && node.nodeId === roots[0]!.nodeId ? publicSurface : node.containerInterface;
    return {
      ...copied,
      nodeId: semanticIdBySource.get(node.nodeId)!,
      ...(local ? { containerInterface: remapBlockContainerInterfaceV1(local, semanticIdBySource) } : {}),
      ...(metadata?.kind === 'upstream_block' && placementPath
        ? {
            modularDiffusers: {
              ...metadata,
              runtimeRole: `custom:${placementPath.join('/')}`,
              placementPath,
              ...(placementPath.length > 1 ? { parentPlacementPath: placementPath.slice(0, -1) } : {}),
            },
          }
        : {}),
    };
  });
  if (wrapperId)
    nodes.unshift({
      nodeId: wrapperId,
      nodeType: 'group',
      data: { type: 'group', label: fragment.definitionSnapshot.displayName, params: {} },
      ...(parentSemanticNodeId ? { parentNodeId: parentSemanticNodeId } : {}),
      containerInterface: remapBlockContainerInterfaceV1(publicSurface, semanticIdBySource),
    });
  const edges = fragment.effectiveGraph.edges.map((edge) => ({
    ...cloneJson(edge),
    edgeId: `adopted-edge-${nanoid(16)}`,
    sourceNodeId: semanticIdBySource.get(edge.sourceNodeId)!,
    targetNodeId: semanticIdBySource.get(edge.targetNodeId)!,
  }));
  const originalFragmentEdgeCount = edges.length;
  const remainingEdges: Edge[] = [];
  const resolveMoved = (handle: string | null | undefined, direction: 'input' | 'output') => {
    const bindings = blockConnectionTargetsV2(source, handle ?? '', direction);
    if (!bindings.length) throw new Error('A moved Block connection no longer resolves to an internal socket.');
    return bindings.map((binding) => ({ ...binding, nodeId: semanticIdBySource.get(binding.nodeId)! }));
  };
  for (const edge of state.edges) {
    if (edge.data?.blockProjectionOwnerId === fragmentId) continue;
    const fromMoved = edge.source === fragmentId;
    const toMoved = edge.target === fragmentId;
    if (!fromMoved && !toMoved) {
      remainingEdges.push(edge);
      continue;
    }
    if ((fromMoved && edge.target === blockId) || (toMoved && edge.source === blockId)) {
      const sources = fromMoved
        ? resolveMoved(edge.sourceHandle, 'output')
        : blockConnectionTargetsV2(target, edge.sourceHandle ?? '', 'output');
      const targets = toMoved
        ? resolveMoved(edge.targetHandle, 'input')
        : blockConnectionTargetsV2(target, edge.targetHandle ?? '', 'input');
      if (!sources.length || !targets.length)
        throw new Error('A destination connection no longer resolves to an internal socket.');
      for (const input of targets)
        for (const output of sources)
          edges.push({
            edgeId: `adopted-edge-${nanoid(16)}`,
            sourceNodeId: output.nodeId,
            sourcePortId: output.fieldOrPortId,
            targetNodeId: input.nodeId,
            targetPortId: input.fieldOrPortId,
          });
    } else {
      const endpoints = resolveMoved(fromMoved ? edge.sourceHandle : edge.targetHandle, fromMoved ? 'output' : 'input');
      endpoints.forEach((endpoint, index) =>
        remainingEdges.push({
          ...edge,
          id: index ? `${edge.id}:consumer:${index}` : edge.id,
          ...(fromMoved
            ? { source: blockId, sourceHandle: blockCrossingHandleV2({ ...endpoint, direction: 'output' }) }
            : { target: blockId, targetHandle: blockCrossingHandleV2({ ...endpoint, direction: 'input' }) }),
        }),
      );
    }
  }
  const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
  const absolutePosition = (node: CustomNodeType) => {
    let position = { ...node.position };
    let parentId = node.parentId;
    while (parentId) {
      const parent = nodeById.get(parentId);
      if (!parent) break;
      position = { x: position.x + parent.position.x, y: position.y + parent.position.y };
      parentId = parent.parentId;
    }
    return position;
  };
  const destinationCanvasParent = parentSemanticNodeId
    ? state.nodes.find(
        (node) =>
          node.data.blockProjectionOwnerId === blockId && node.data.blockProjectionNodeId === parentSemanticNodeId,
      )
    : target;
  const origin = destinationCanvasParent ? absolutePosition(destinationCanvasParent) : target.position;
  const sourceLayouts = blockRelativeInternalLayoutsV2(fragment);
  const dropPosition = { x: source.position.x - origin.x, y: source.position.y - origin.y };
  const layouts = Object.fromEntries(
    fragment.effectiveGraph.nodes.map((node) => {
      const nextId = semanticIdBySource.get(node.nodeId)!;
      const sourceLayout = sourceLayouts[node.nodeId]!;
      return [
        nextId,
        !needsWrapper && node.nodeId === roots[0]!.nodeId
          ? {
              ...dropPosition,
              ...(sourceLayout?.width ? { width: sourceLayout.width } : {}),
              ...(sourceLayout?.height ? { height: sourceLayout.height } : {}),
            }
          : cloneJson(sourceLayout),
      ];
    }),
  );
  const insertedRootId = wrapperId ?? semanticIdBySource.get(roots[0]!.nodeId)!;
  if (wrapperId)
    layouts[wrapperId] = {
      ...dropPosition,
      ...fragment.presentation.size,
    };
  // Normalize only presentation coordinates to one parent-relative convention.
  // This does not touch semantic graph, parameters, interfaces or execution.
  const hierarchicalTarget = reduceBlockPresentationV2(targetInstance, {
    internalLayoutMode: 'hierarchical',
    internalLayout: blockRelativeInternalLayoutsV2(targetInstance),
  });
  let addedInstance = addBlockEffectiveGraphSubtreeV2(
    hierarchicalTarget,
    nodes,
    edges.slice(0, originalFragmentEdgeCount),
    layouts,
  );
  if (edges.length > originalFragmentEdgeCount)
    addedInstance = replaceBlockEffectiveGraphV2(addedInstance, {
      ...addedInstance.effectiveGraph,
      edges: [...addedInstance.effectiveGraph.edges, ...edges.slice(originalFragmentEdgeCount)],
    });
  let nextInstance = reduceBlockPresentationV2(addedInstance, {
    collapsedContainerNodeIds: [
      ...new Set([
        ...(targetInstance.presentation.collapsedContainerNodeIds ?? []),
        insertedRootId,
        ...(fragment.presentation.collapsedContainerNodeIds ?? []).map((id) => semanticIdBySource.get(id)!),
      ]),
    ],
  });
  // Moving an existing Block within this workflow retains completed media, but
  // a moved graph must never inherit an in-flight run's execution ownership.
  for (const preview of fragment.previewStates) {
    if (preview.status !== 'complete' || preview.mediaReference === undefined) continue;
    const nodeId = semanticIdBySource.get(preview.binding.nodeId)!;
    if (
      !nextInstance.previewStates.some(
        (candidate) =>
          candidate.binding.nodeId === nodeId && candidate.binding.outputPortId === preview.binding.outputPortId,
      )
    )
      continue;
    nextInstance = reduceBlockPreviewStateV2(
      nextInstance,
      { nodeId, outputPortId: preview.binding.outputPortId },
      {
        status: 'complete',
        mediaReference: preview.mediaReference,
        ...(preview.taskId ? { taskId: preview.taskId } : {}),
      },
    );
  }
  for (const edge of edges.slice(originalFragmentEdgeCount))
    assertBlockInternalConnectionV2(
      nextInstance,
      { nodeId: edge.sourceNodeId, fieldOrPortId: edge.sourcePortId },
      { nodeId: edge.targetNodeId, fieldOrPortId: edge.targetPortId },
    );
  const projected = projectBlockInstanceV2({ ...state, edges: remainingEdges }, target.id, nextInstance);
  if (!projected) throw new Error('The destination Block could not project the inserted Modular subtree.');
  const removedCanvasIds = new Set([
    fragmentId,
    ...state.nodes.filter(({ data }) => data.blockProjectionOwnerId === fragmentId).map(({ id }) => id),
  ]);
  return {
    nodes: projected.nodes.filter((node) => !removedCanvasIds.has(node.id)),
    edges: projected.edges.filter((edge) => !removedCanvasIds.has(edge.source) && !removedCanvasIds.has(edge.target)),
  };
}

function replaceProjectedNodeInBlockV2(
  state: Pick<FlowStore, 'nodes' | 'edges'>,
  sourceId: string,
  projectedNodeId: string,
) {
  const source = state.nodes.find((node) => node.id === sourceId);
  const projected = state.nodes.find((node) => node.id === projectedNodeId);
  if (!source || !projected) throw new Error('Cannot replace this Block node because one of the nodes disappeared.');
  const ownerId = projected.data.blockProjectionOwnerId;
  const semanticNodeId = projected.data.blockProjectionNodeId;
  const root = state.nodes.find((node) => node.id === ownerId);
  if (
    !ownerId ||
    !semanticNodeId ||
    projected.data.blockProjectionKind !== 'internal' ||
    !root?.data.blockInstanceV2 ||
    !isBlockRootV2(root)
  )
    throw new Error('Cannot replace a malformed Block V2 internal projection.');
  if (!root.data.blockInstanceV2.presentation.expanded)
    throw new Error('Expand the Block before replacing an internal node.');
  if (source.parentId || source.data.type === 'block' || source.data.type === 'cluster')
    throw new Error('Only an ordinary top-level node can replace a Block internal node.');
  if (state.nodes.some((node) => node.parentId === source.id))
    throw new Error(`Cannot use node "${source.id}" as a replacement because it owns nested canvas nodes.`);
  if (state.edges.some((edge) => edge.source === source.id || edge.target === source.id))
    throw new Error(`Disconnect node "${source.id}" before using it as a Block replacement.`);

  let replacement = ordinaryBlockGraphNodeV2(source);
  const replacedSemantic = root.data.blockInstanceV2.effectiveGraph.nodes.find(
    ({ nodeId }) => nodeId === semanticNodeId,
  );
  const sourceMetadata = replacement.modularDiffusers;
  const targetMetadata = replacedSemantic?.modularDiffusers;
  if (sourceMetadata?.kind === 'upstream_block' && targetMetadata?.kind === 'upstream_block') {
    const destinationContext = reviewedDestinationContextV2(root.data.blockInstanceV2, targetMetadata);
    if (
      !reviewedBlockCanBeAuthoredV2(
        sourceMetadata,
        destinationContext,
        useHuggingFaceModularConditionalStore.getState().snapshot,
      )
    )
      throw new Error(
        `Unsupported replacement contract: ${sourceMetadata.blockClass} for ${targetMetadata.blockClass}.`,
      );
    if (sourceMetadata.blockKind !== 'block' || targetMetadata.blockKind !== 'block')
      throw new Error(
        'Container replacement requires its reviewed child subtree. Drag a leaf block here, or replace the container through the nested subtree action.',
      );
    const placementPath = targetMetadata.placementPath ?? [];
    const sourceIdentity = { ...sourceMetadata };
    delete sourceIdentity.parentPlacementPath;
    replacement = {
      ...bindReviewedNodeContextV2(replacement, destinationContext),
      modularDiffusers: {
        ...sourceIdentity,
        runtimeRole: `custom:${placementPath.join('/')}`,
        placementPath: [...placementPath],
        ...(targetMetadata.parentPlacementPath ? { parentPlacementPath: [...targetMetadata.parentPlacementPath] } : {}),
      },
    };
  }
  const instance = replaceBlockEffectiveGraphNodeV2(root.data.blockInstanceV2, semanticNodeId, replacement);
  const graph = projectBlockInstanceV2(state, ownerId, instance);
  if (!graph) throw new Error(`Cannot replace Block V2 internal node "${semanticNodeId}": projection failed.`);
  return { nodes: graph.nodes.filter((node) => node.id !== source.id), edges: graph.edges };
}

function moveProjectedNodeOutOfBlockV2(
  state: Pick<FlowStore, 'nodes' | 'edges'>,
  projectedNodeId: string,
  position: { x: number; y: number },
) {
  const projected = state.nodes.find((node) => node.id === projectedNodeId);
  const ownerId = projected?.data.blockProjectionOwnerId;
  const semanticNodeId = projected?.data.blockProjectionNodeId;
  const root = state.nodes.find((node) => node.id === ownerId);
  if (
    !projected ||
    !ownerId ||
    !semanticNodeId ||
    projected.data.blockProjectionKind !== 'internal' ||
    !root?.data.blockInstanceV2 ||
    !isBlockRootV2(root)
  )
    throw new Error('Cannot move a malformed Block V2 internal projection out of its Block.');
  if (!root.data.blockInstanceV2.presentation.expanded)
    throw new Error('Expand the Block before moving an internal node out.');
  const instance = root.data.blockInstanceV2;
  const semantic = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === semanticNodeId);
  if (!semantic) throw new Error(`Cannot move unknown Block V2 internal node "${semanticNodeId}" out.`);
  if (projected.data.blockProjectionContainer)
    return moveProjectedSubtreeOutOfBlockV2(state, root, projected, position);
  const incident = instance.effectiveGraph.edges.filter(
    ({ sourceNodeId, targetNodeId }) => sourceNodeId === semanticNodeId || targetNodeId === semanticNodeId,
  );
  const nextInstance = detachBlockGraphNodesV2(instance, new Set([semanticNodeId]));
  const graph = projectBlockInstanceV2(state, ownerId, nextInstance);
  if (!graph) throw new Error(`Cannot move Block V2 internal node "${semanticNodeId}" out: projection failed.`);

  const occupied = new Set(graph.nodes.map(({ id }) => id));
  const topLevelId = occupied.has(semanticNodeId) ? `node-${nanoid()}` : semanticNodeId;
  const snapshot = durableFlowNodeSnapshot(projected);
  const data = cloneJson(snapshot.data);
  delete data.blockProjectionOwnerId;
  delete data.blockProjectionNodeId;
  delete data.blockProjectionKind;
  delete data.blockProjectionContainer;
  delete data.blockProjectionContainerExpanded;
  delete data.blockProjectionModular;
  delete data.blockProjectionChildCount;
  delete data.blockProjectionDepth;
  delete data.blockProjectionPortBindings;
  // The standalone node keeps its exact upstream identity. Projection markers
  // are disposable, but dropping provenance here made a move-out/reinsert turn
  // a Modular leaf into an untyped utility with no source contract.
  if (semantic.modularDiffusers) data.modularDiffusersCatalogNode = cloneJson(semantic.modularDiffusers);
  Object.values(data.params).forEach((param) => {
    if (!isRecord(param.fieldOptions)) return;
    const fieldOptions = { ...param.fieldOptions };
    delete fieldOptions.blockBindingV2;
    delete fieldOptions.blockContainerControlV1;
    param.fieldOptions = fieldOptions;
  });
  const topLevel: CustomNodeType = {
    ...snapshot,
    id: topLevelId,
    position,
    data,
  };
  delete topLevel.parentId;
  delete topLevel.extent;
  delete topLevel.expandParent;

  const inputPortFor = (edge: (typeof incident)[number]) =>
    instance.effectiveInterface.boundary.inputs.find((port) => {
      const targets = blockInputPortBindingsV2(port);
      return (
        targets.some(
          (binding) => binding.nodeId === edge.targetNodeId && binding.fieldOrPortId === edge.targetPortId,
        ) &&
        targets.every((binding) =>
          incident.some(
            (candidate) =>
              candidate.sourceNodeId === semanticNodeId &&
              candidate.sourcePortId === edge.sourcePortId &&
              candidate.targetNodeId === binding.nodeId &&
              candidate.targetPortId === binding.fieldOrPortId,
          ),
        )
      );
    });
  const crossingCandidates: Edge[] = incident.map((edge) => ({
    id: `workflow-edge-${nanoid()}`,
    source: edge.sourceNodeId === semanticNodeId ? topLevelId : ownerId,
    sourceHandle:
      edge.sourceNodeId === semanticNodeId
        ? edge.sourcePortId
        : (instance.effectiveInterface.boundary.outputs.find(
            (port) => port.binding.nodeId === edge.sourceNodeId && port.binding.fieldOrPortId === edge.sourcePortId,
          )?.portId ??
          blockCrossingHandleV2({ nodeId: edge.sourceNodeId, fieldOrPortId: edge.sourcePortId, direction: 'output' })),
    target: edge.targetNodeId === semanticNodeId ? topLevelId : ownerId,
    targetHandle:
      edge.targetNodeId === semanticNodeId
        ? edge.targetPortId
        : (inputPortFor(edge)?.portId ??
          blockCrossingHandleV2({ nodeId: edge.targetNodeId, fieldOrPortId: edge.targetPortId, direction: 'input' })),
    type: 'default',
  }));
  const crossingEdges = crossingCandidates.filter(
    (edge, index) =>
      crossingCandidates.findIndex(
        (other) =>
          other.source === edge.source &&
          other.sourceHandle === edge.sourceHandle &&
          other.target === edge.target &&
          other.targetHandle === edge.targetHandle,
      ) === index,
  );
  const retainedEdges = remapDetachedBlockEdgesV2(graph.edges, root, new Set([semanticNodeId]), topLevelId, false);
  const nodes = [...graph.nodes, topLevel];
  return { nodes, edges: decorateConnectionEdges(nodes, [...retainedEdges, ...crossingEdges]), topLevelId };
}

/** Detach a complete subtree as a workflow-owned Block, never a library write. */
function moveProjectedSubtreeOutOfBlockV2(
  state: Pick<FlowStore, 'nodes' | 'edges'>,
  root: CustomNodeType,
  projected: CustomNodeType,
  position: { x: number; y: number },
) {
  const instance = root.data.blockInstanceV2!;
  const semanticId = projected.data.blockProjectionNodeId!;
  const included = blockGraphSubtreeNodeIdsV2(instance.effectiveGraph, semanticId);
  const definition = reusableBlockDefinitionFromSubtreeV2(instance, {
    rootNodeId: semanticId,
    definitionId: `user:detached-${nanoid()}`,
    displayName: projected.data.label || 'Detached User Block',
  });
  const topLevelId = `block-${nanoid()}`;
  const crossingCandidates: Edge[] = instance.effectiveGraph.edges.flatMap((edge) => {
    const fromInside = included.has(edge.sourceNodeId),
      toInside = included.has(edge.targetNodeId);
    if (fromInside === toInside) return [];
    const outputBoundary = fromInside ? definition.boundary : instance.effectiveInterface.boundary;
    const inputBoundary = toInside ? definition.boundary : instance.effectiveInterface.boundary;
    const outputPort = outputBoundary.outputs.find(
      (port) => port.binding.nodeId === edge.sourceNodeId && port.binding.fieldOrPortId === edge.sourcePortId,
    );
    const inputPort = inputBoundary.inputs.find((port) => {
      const targets = blockInputPortBindingsV2(port);
      return (
        targets.some(
          (binding) => binding.nodeId === edge.targetNodeId && binding.fieldOrPortId === edge.targetPortId,
        ) &&
        targets.every((binding) =>
          instance.effectiveGraph.edges.some(
            (candidate) =>
              candidate.sourceNodeId === edge.sourceNodeId &&
              candidate.sourcePortId === edge.sourcePortId &&
              candidate.targetNodeId === binding.nodeId &&
              candidate.targetPortId === binding.fieldOrPortId,
          ),
        )
      );
    });
    return [
      {
        id: `workflow-edge-${nanoid()}`,
        source: fromInside ? topLevelId : root.id,
        target: toInside ? topLevelId : root.id,
        sourceHandle:
          outputPort?.portId ??
          blockCrossingHandleV2({ nodeId: edge.sourceNodeId, fieldOrPortId: edge.sourcePortId, direction: 'output' }),
        targetHandle:
          inputPort?.portId ??
          blockCrossingHandleV2({ nodeId: edge.targetNodeId, fieldOrPortId: edge.targetPortId, direction: 'input' }),
        type: 'default',
      },
    ];
  });
  const crossings = crossingCandidates.filter(
    (edge, index) =>
      crossingCandidates.findIndex(
        (other) =>
          other.source === edge.source &&
          other.sourceHandle === edge.sourceHandle &&
          other.target === edge.target &&
          other.targetHandle === edge.targetHandle,
      ) === index,
  );
  const remaining = detachBlockGraphNodesV2(instance, included);
  const layouts = blockRelativeInternalLayoutsV2(instance);
  let detached = createBlockInstanceV2(definition, {
    instanceId: topLevelId,
    position,
    size: { width: layouts[semanticId]?.width ?? 420, height: layouts[semanticId]?.height ?? 480 },
    internalLayoutMode: 'hierarchical',
    internalLayout: Object.fromEntries(
      [...included].map((id) => [id, id === semanticId ? { ...layouts[id], x: 32, y: 80 } : layouts[id]!]),
    ),
  });
  detached = reduceBlockPresentationV2(detached, {
    collapsedContainerNodeIds: (instance.presentation.collapsedContainerNodeIds ?? []).filter((id) => included.has(id)),
  });
  for (const preview of instance.previewStates) {
    if (preview.status !== 'complete' || preview.mediaReference === undefined || !included.has(preview.binding.nodeId))
      continue;
    if (
      !detached.previewStates.some(
        ({ binding }) =>
          binding.nodeId === preview.binding.nodeId && binding.outputPortId === preview.binding.outputPortId,
      )
    )
      continue;
    detached = reduceBlockPreviewStateV2(detached, preview.binding, {
      status: 'complete',
      mediaReference: preview.mediaReference,
      ...(preview.taskId ? { taskId: preview.taskId } : {}),
    });
  }
  const graph = projectBlockInstanceV2(state, root.id, remaining);
  if (!graph) throw new Error('Could not project the remaining Block.');
  const nodes = [...graph.nodes, createBlockRootNodeV2(detached, { selected: projected.selected })];
  const retained = remapDetachedBlockEdgesV2(graph.edges, root, included, topLevelId, true);
  return { nodes, edges: decorateConnectionEdges(nodes, [...retained, ...crossings]), topLevelId };
}

function updateBlockInstanceV2(
  state: Pick<FlowStore, 'nodes' | 'edges'>,
  id: string,
  reducer: (instance: NonNullable<NodeData['blockInstanceV2']>) => NonNullable<NodeData['blockInstanceV2']>,
) {
  const root = state.nodes.find((node) => node.id === id);
  if (!root?.data.blockInstanceV2) return null;
  return projectBlockInstanceV2(state, id, reducer(root.data.blockInstanceV2));
}

function isUndoableNodeChange(change: NodeChange<CustomNodeType>, nodes: CustomNodeType[]) {
  if (change.type === 'select' || change.type === 'dimensions') {
    return false;
  }

  // React Flow emits final parent-relative position reconciliation after a
  // User Node is expanded or its children are adopted. The surrounding drag
  // transaction already owns user-initiated movement; recording these trailing
  // child updates separately makes one structural gesture require many undos.
  if (change.type === 'position' && change.dragging !== true) {
    const node = nodes.find((candidate) => candidate.id === change.id);
    if (node?.parentId && node.data.userBlockInstanceId) return false;
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
        if (changes.some((change) => isUndoableNodeChange(change, get().nodes))) {
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
      onReconnect: (oldEdge, conn) => {
        get().withHistory('Reconnect edge', () => handleReconnect(oldEdge, conn, set, get));
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
        useHuggingFaceClusterRuntimeStore.getState().clearAuthorities();
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
        const node = get().nodes.find((candidate) => candidate.id === id);
        const blockOwnerId = node?.data.blockProjectionOwnerId;
        const blockSemanticNodeId = node?.data.blockProjectionNodeId;
        if (blockOwnerId && blockSemanticNodeId && (key === undefined || key === 'value')) {
          const localBindingValue = node.data.params[param]?.fieldOptions?.blockContainerControlV1;
          const localBinding = isRecord(localBindingValue) ? localBindingValue : null;
          if (localBinding) {
            if (
              localBinding.schemaVersion !== 1 ||
              localBinding.ownerId !== blockOwnerId ||
              localBinding.containerNodeId !== blockSemanticNodeId ||
              typeof localBinding.controlId !== 'string'
            )
              throw new Error('This internal control has an invalid binding. Reopen the Block.');
            const controlId = localBinding.controlId;
            get().withHistory('Edit internal Block control', () => {
              set((state) => {
                const graph = updateBlockInstanceV2(state, blockOwnerId, (instance) =>
                  setBlockContainerControlValueV1(
                    instance,
                    blockSemanticNodeId,
                    controlId,
                    value as BlockJsonValue | undefined,
                  ),
                );
                return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
              });
            });
            return;
          }
          const bindingValue = node.data.params[param]?.fieldOptions?.blockBindingV2;
          const binding = isRecord(bindingValue) ? bindingValue : null;
          const logicalId =
            binding?.ownerId === blockOwnerId && typeof binding.logicalId === 'string' ? binding.logicalId : null;
          if (logicalId) {
            get().setBlockInstanceValueV2(blockOwnerId, logicalId, value as BlockJsonValue);
            return;
          }
          get().withHistory('Edit block internal parameter', () => {
            set((state) => {
              const graph = updateBlockInstanceV2(state, blockOwnerId, (instance) => {
                const effectiveGraph = cloneJson(instance.effectiveGraph);
                const graphNode = effectiveGraph.nodes.find((candidate) => candidate.nodeId === blockSemanticNodeId);
                if (!graphNode) throw new Error(`Unknown Block V2 internal node ${blockSemanticNodeId}.`);
                const params = isRecord(graphNode.data.params) ? graphNode.data.params : {};
                const currentParam = isRecord(params[param]) ? params[param] : {};
                const nextParam = { ...currentParam };
                if (value === undefined) delete nextParam.value;
                else nextParam.value = cloneJson(value) as BlockJsonValue;
                graphNode.data.params = { ...params, [param]: nextParam };
                return replaceBlockEffectiveGraphV2(instance, effectiveGraph);
              });
              return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
            });
          });
          return;
        }
        const clusterBinding = node?.data.params[param]?.fieldOptions?.huggingFaceClusterBinding;
        if (
          node?.data.huggingFaceClusterRole === 'execution' &&
          clusterBinding &&
          typeof clusterBinding === 'object' &&
          (key === undefined || key === 'value')
        ) {
          if (
            'persistence' in clusterBinding &&
            clusterBinding.persistence === 'sealed' &&
            deepEqual(node.data.params[param]?.value, value)
          )
            return;
          get().withHistory('Edit Diffusers Block parameter', () => {
            set((state) => {
              const root = state.nodes.find((candidate) => candidate.id === node.data.huggingFaceClusterInstanceId);
              const definition = huggingFaceDefinitionForNode(root);
              if (!definition) return state;
              const graph = setHuggingFaceClusterGraphChildParameter(state, id, definition, param, value);
              return { nodes: graph.nodes, edges: graph.edges };
            });
          });
          if (node.data.huggingFaceClusterInstanceId) {
            useHuggingFaceClusterRuntimeStore.getState().clearAuthority(node.data.huggingFaceClusterInstanceId);
          }
          return;
        }
        const shared =
          key === undefined || key === 'value' ? sharedOperationInput(get().nodes, get().edges, id, param) : null;
        if (shared) {
          get().withHistory(`Edit shared ${shared.name}`, () => {
            for (const member of shared.members) writeNodeParam(member.node.id, member.field, value, key, set);
          });
          return;
        }
        if (key && ['disabled', 'hidden', 'isConnected', 'isInput', 'signal'].includes(key)) {
          writeNodeParam(id, param, value, key, set);
        } else {
          get().withHistory('Edit node parameter', () => writeNodeParam(id, param, value, key, set));
        }
        if (key === 'type') {
          get().refreshConnectionVisuals();
        }
      },
      setNodeSize: (id: string, width: number, height: number, options) => {
        const resize = () => setFlowNodeSize(id, width, height, set);
        if (options?.history === false) resize();
        else get().withHistory('Resize node', resize);
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
        if (node?.data.huggingFaceClusterRole === 'root') {
          const expanded = Boolean(node.data.huggingFaceClusterInstance?.presentation.expanded);
          get().withHistory(expanded ? 'Fit Block to contents' : 'Reset Block size', () => {
            if (expanded) {
              set((state) => {
                const graph = fitHuggingFaceClusterInstance(state, id);
                return graph === state ? state : { nodes: graph.nodes };
              });
              return;
            }
            set((state) => ({
              nodes: state.nodes.map((item) =>
                item.id === id
                  ? {
                      ...item,
                      width: HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
                      height: HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
                      data: {
                        ...item.data,
                        uiState: {
                          ...item.data.uiState,
                          clusterCollapsedWidth: HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
                          clusterCollapsedHeight: HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
                        },
                      },
                    }
                  : item,
              ),
            }));
          });
          return;
        }
        if (node?.data.blockInstanceV2) {
          get().setBlockPresentationV2(id, { size: { width: 360, height: 320 } });
          return;
        }
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
      toggleHuggingFaceClusterExpanded: (id) => {
        get().withHistory('Toggle Hugging Face Block expansion', () => {
          set((state) => {
            const definition = huggingFaceDefinitionForNode(state.nodes.find((node) => node.id === id));
            if (!definition) return state;
            const graph = isHuggingFaceClusterExpanded(state, id)
              ? collapseHuggingFaceClusterInstance(state, id, definition)
              : expandHuggingFaceClusterInstance(state, id, definition);
            return graph === state ? state : { nodes: graph.nodes, edges: graph.edges };
          });
        });
      },
      toggleHuggingFaceClusterBlockExpanded: (id, path) => {
        get().withHistory('Toggle Hugging Face Block parameters', () => {
          set((state) => {
            const definition = huggingFaceDefinitionForNode(state.nodes.find((node) => node.id === id));
            if (!definition) return state;
            const graph = toggleHuggingFaceClusterBlockExpanded(state, id, path, definition);
            return graph === state ? state : { nodes: graph.nodes, edges: graph.edges };
          });
        });
      },
      setHuggingFaceClusterParameter: (id, name, value) => {
        get().withHistory('Change Hugging Face Block parameter', () => {
          set((state) => {
            const definition = huggingFaceDefinitionForNode(state.nodes.find((node) => node.id === id));
            if (!definition) return state;
            const graph = setHuggingFaceClusterGraphParameter(state, id, definition, name, value);
            return graph === state ? state : { nodes: graph.nodes, edges: graph.edges };
          });
        });
        useHuggingFaceClusterRuntimeStore.getState().clearAuthority(id);
      },
      setHuggingFaceClusterExecution: (id, admissionId) => {
        get().withHistory('Change Hugging Face Block execution mode', () => {
          set((state) => {
            const definition = huggingFaceDefinitionForNode(state.nodes.find((node) => node.id === id));
            if (!definition) return state;
            const graph = setHuggingFaceClusterGraphExecution(state, id, definition, admissionId);
            return graph === state ? state : { nodes: graph.nodes, edges: graph.edges };
          });
        });
        useHuggingFaceClusterRuntimeStore.getState().clearAuthority(id);
      },
      setHuggingFaceClusterExecutionParameter: (id, source, value) => {
        get().withHistory('Change Hugging Face Block execution parameter', () => {
          set((state) => {
            const definition = huggingFaceDefinitionForNode(state.nodes.find((node) => node.id === id));
            if (!definition) return state;
            const graph = setHuggingFaceClusterGraphExecutionParameter(state, id, definition, source, value);
            return graph === state ? state : { nodes: graph.nodes, edges: graph.edges };
          });
        });
        useHuggingFaceClusterRuntimeStore.getState().clearAuthority(id);
      },
      persistHuggingFaceClusterExecutionPosition: (nodeId) => {
        set((state) => {
          const child = state.nodes.find((node) => node.id === nodeId);
          const root = state.nodes.find((node) => node.id === child?.data.huggingFaceClusterInstanceId);
          const definition = huggingFaceDefinitionForNode(root);
          if (!definition) return state;
          const graph = setHuggingFaceClusterGraphExecutionPosition(state, nodeId, definition);
          return graph === state ? state : { nodes: graph.nodes };
        });
      },
      setBlockInstanceValueV2: (id, logicalId, value) => {
        get().withHistory('Edit block parameter', () => {
          set((state) => {
            const graph = updateBlockInstanceV2(state, id, (instance) =>
              reduceBlockInstanceValueV2(instance, logicalId, value),
            );
            return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
          });
        });
      },
      switchBlockRouteV1: (id, routeKey, compiledDestination) => {
        get().withHistory('Switch block model route', () => {
          set((state) => {
            const root = state.nodes.find((candidate) => candidate.id === id);
            if (!root?.data.blockInstanceV2) throw new Error(`Block V2 root ${id} is unavailable.`);
            if (
              root.data.blockInstanceV2.previewStates.some(({ status }) => status === 'queued' || status === 'running')
            )
              throw new Error('Cannot switch this Block while its current run is queued or running.');
            assertBlockRouteEdgesCompatibleV1(root.data.blockInstanceV2, compiledDestination, state.edges);
            const graph = updateBlockInstanceV2(state, id, (instance) =>
              switchBlockRouteInstanceV1(instance, routeKey, compiledDestination),
            );
            if (!graph) throw new Error(`Block V2 root ${id} could not be switched.`);
            return { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) };
          });
        });
      },
      applyBlockSuggestedInputsV2: (id, suggestionId) => {
        get().withHistory('Apply block starter values', () => {
          set((state) => {
            const graph = updateBlockInstanceV2(state, id, (instance) => {
              const suggestion = instance.definitionSnapshot.suggestedInputs?.find(
                (candidate) => candidate.suggestionId === suggestionId,
              );
              if (!suggestion) throw new Error(`Unknown Block V2 starter values ${suggestionId}.`);
              const allowed = new Set([
                ...instance.effectiveInterface.boundary.inputs.map(({ portId }) => portId),
                ...instance.effectiveInterface.controls.map(({ controlId }) => controlId),
              ]);
              return Object.entries(suggestion.values).reduce(
                (current, [logicalId, value]) =>
                  allowed.has(logicalId) ? reduceBlockInstanceValueV2(current, logicalId, value) : current,
                instance,
              );
            });
            return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
          });
        });
      },
      setBlockPresentationV2: (id, patch) => {
        get().withHistory('Change block presentation', () => {
          set((state) => {
            const graph = updateBlockInstanceV2(state, id, (instance) => reduceBlockPresentationV2(instance, patch));
            return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
          });
        });
      },
      toggleBlockContainerExpandedV2: (id, semanticNodeId) => {
        get().withHistory('Toggle Modular Diffusers container', () => {
          set((state) => {
            const graph = updateBlockInstanceV2(state, id, (instance) => {
              const containerIds = new Set(blockModularContainerNodeIdsV2(instance.effectiveGraph));
              if (!containerIds.has(semanticNodeId))
                throw new Error(`Modular Diffusers container ${semanticNodeId} is unavailable.`);
              const collapsed = new Set(instance.presentation.collapsedContainerNodeIds ?? []);
              if (collapsed.has(semanticNodeId)) collapsed.delete(semanticNodeId);
              else collapsed.add(semanticNodeId);
              return reduceBlockPresentationV2(instance, {
                collapsedContainerNodeIds: [...collapsed].sort(),
              });
            });
            return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
          });
        });
      },
      setBlockPreviewStateV2: (id, preview, patch) => {
        // Preview updates are backend-owned run state. They must not create an
        // undo entry or rebuild/replace the derived execution projection.
        set((state) => {
          const root = state.nodes.find((node) => node.id === id);
          if (!root?.data.blockInstanceV2) return state;
          if (!isBlockRootV2(root)) throw new Error(`Invalid Block V2 preview owner ${id}.`);
          const blockInstanceV2 = reduceBlockPreviewStateV2(root.data.blockInstanceV2, preview, patch);
          return {
            nodes: state.nodes.map((node) =>
              node.id === id ? { ...node, data: { ...node.data, blockInstanceV2 } } : node,
            ),
          };
        });
      },
      ensureBlockProjectionV2: (id) => {
        set((state) => {
          const root = state.nodes.find((node) => node.id === id);
          if (!root?.data.blockInstanceV2) return state;
          const graph = projectBlockInstanceV2(state, id, root.data.blockInstanceV2);
          return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
        });
      },
      ensureBlockMinimumHeightV2: (id, minimumHeight) => {
        if (!Number.isFinite(minimumHeight) || minimumHeight <= 0) return;
        set((state) => {
          const root = state.nodes.find((node) => node.id === id);
          const instance = root?.data.blockInstanceV2;
          if (!instance || instance.presentation.expanded || instance.presentation.size.height >= minimumHeight)
            return state;
          const graph = projectBlockInstanceV2(
            state,
            id,
            reduceBlockPresentationV2(instance, {
              size: { width: instance.presentation.size.width, height: Math.ceil(minimumHeight) },
            }),
          );
          return graph ? { nodes: graph.nodes, edges: graph.edges } : state;
        });
      },
      persistBlockCanvasPresentationV2: (nodeId) => {
        set((state) => {
          const node = state.nodes.find((candidate) => candidate.id === nodeId);
          if (!node) return state;
          if (node.data.blockInstanceV2) {
            const graph = updateBlockInstanceV2(state, node.id, (instance) => {
              // Expanded dimensions are derived projection bounds. Persisting
              // them as the collapsed user size makes one child move silently
              // change the Block's collapsed appearance and can leave React
              // Flow reusing a stale measured frame for the same node id.
              const presentation = instance.presentation.expanded
                ? { position: node.position }
                : {
                    position: node.position,
                    size: {
                      width: node.width ?? node.measured?.width ?? instance.presentation.size.width,
                      height: node.height ?? node.measured?.height ?? instance.presentation.size.height,
                    },
                  };
              return reduceBlockPresentationV2(instance, presentation);
            });
            return graph ? { nodes: graph.nodes, edges: graph.edges } : state;
          }
          const ownerId = node.data.blockProjectionOwnerId;
          const semanticNodeId = node.data.blockProjectionNodeId;
          if (!ownerId || !semanticNodeId) return state;
          const graph = updateBlockInstanceV2(state, ownerId, (instance) =>
            repositionBlockChildV2(instance, semanticNodeId, {
              x: node.position.x,
              y: node.position.y,
              ...((node.measured?.width ?? node.width) ? { width: node.measured?.width ?? node.width } : {}),
              ...((node.measured?.height ?? node.height) ? { height: node.measured?.height ?? node.height } : {}),
            }),
          );
          return graph ? { nodes: graph.nodes, edges: graph.edges } : state;
        });
      },
      growBlockContainersForDragV2: (nodeId) => {
        set((state) => {
          const byId = new Map(state.nodes.map((node) => [node.id, node]));
          const resized = new Map<string, CustomNodeType>();
          let child = byId.get(nodeId);
          while (child?.parentId && child.data.blockProjectionOwnerId) {
            const parent = byId.get(child.parentId);
            if (!parent) break;
            const boundary = parent.data.blockInstanceV2?.effectiveInterface.boundary;
            const params = Object.values(parent.data.params);
            const inputCount =
              boundary?.inputs.length ?? params.filter((param) => param.isInput || param.display === 'input').length;
            const outputCount = boundary?.outputs.length ?? params.filter((param) => param.display === 'output').length;
            const bottom = 48 + 24 * Math.max(inputCount, outputCount);
            const width = Math.max(
              parent.width ?? 0,
              child.position.x + (child.width ?? child.measured?.width ?? 320) + 32,
            );
            const height = Math.max(
              parent.height ?? 0,
              child.position.y + (child.height ?? child.measured?.height ?? 240) + bottom,
            );
            if (width === parent.width && height === parent.height) {
              child = parent;
              continue;
            }
            child = { ...parent, width, height, style: { ...parent.style, width, height } };
            resized.set(parent.id, child);
          }
          return resized.size ? { nodes: state.nodes.map((node) => resized.get(node.id) ?? node) } : state;
        });
      },
      fitBlockProjectionToChildrenV2: (id) => {
        set((state) => {
          const root = state.nodes.find((node) => node.id === id);
          const instance = root?.data.blockInstanceV2;
          if (!root || !instance?.presentation.expanded) return state;
          const children = state.nodes.filter((node) => node.data.blockProjectionOwnerId === id);
          if (!children.length) return state;
          if (children.some((node) => node.dragging)) return state;
          const size = blockExpandedProjectionSizeV2(instance, children);
          // Always publish a fresh controlled root after projection mount.
          // React Flow may retain a collapsed wrapper measurement for the same
          // node id even when our durable/store width is already correct; an
          // equality early-return leaves the rendered frame stale forever.
          return {
            nodes: state.nodes.map((node) =>
              node.id === id
                ? {
                    ...node,
                    width: size.width,
                    height: size.height,
                    style: { ...node.style, width: size.width, height: size.height },
                  }
                : node,
            ),
          };
        });
      },
      adoptNodeIntoBlockV2: (nodeId, blockId, parentSemanticNodeId) => {
        get().withHistory('Move node into Block', () => {
          set((state) => {
            const graph = adoptTopLevelNodeIntoBlockV2(state, nodeId, blockId, parentSemanticNodeId);
            return {
              nodes: graph.nodes,
              edges: decorateConnectionEdges(graph.nodes, graph.edges),
            };
          });
          get().updateHandleConnectionStatus();
          get().updateSignalValues(get().edges);
        });
      },
      adoptBlockFragmentIntoBlockV2: (fragmentId, blockId, parentSemanticNodeId) => {
        get().withHistory('Move Modular subtree into Block', () => {
          set((state) => {
            const graph = adoptTopLevelBlockFragmentIntoBlockV2(state, fragmentId, blockId, parentSemanticNodeId);
            return {
              nodes: graph.nodes,
              edges: decorateConnectionEdges(graph.nodes, graph.edges),
            };
          });
          get().updateHandleConnectionStatus();
          get().updateSignalValues(get().edges);
        });
      },
      replaceNodeInBlockV2: (nodeId, projectedNodeId) => {
        get().withHistory('Replace Block internal node', () => {
          set((state) => {
            const graph = replaceProjectedNodeInBlockV2(state, nodeId, projectedNodeId);
            return { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) };
          });
          get().updateHandleConnectionStatus();
          get().updateSignalValues(get().edges);
        });
      },
      moveNodeOutOfBlockV2: (projectedNodeId, position) => {
        let topLevelId = '';
        get().withHistory('Move node out of Block', () => {
          set((state) => {
            const graph = moveProjectedNodeOutOfBlockV2(state, projectedNodeId, position);
            topLevelId = graph.topLevelId;
            return { nodes: graph.nodes, edges: graph.edges };
          });
          get().updateHandleConnectionStatus();
          get().updateSignalValues(get().edges);
        });
        if (!topLevelId) throw new Error('Could not materialize the node outside this Block.');
        return topLevelId;
      },
      reparentNodeInBlockV2: (projectedNodeId, parentSemanticNodeId, absolutePosition) => {
        get().withHistory('Move internal node between Blocks', () => {
          set((state) => {
            const source = state.nodes.find((node) => node.id === projectedNodeId);
            const ownerId = source?.data.blockProjectionOwnerId;
            const semanticId = source?.data.blockProjectionNodeId;
            const owner = state.nodes.find((node) => node.id === ownerId);
            if (!source || !ownerId || !semanticId || !owner?.data.blockInstanceV2?.presentation.expanded)
              throw new Error('Expand the owning Block before moving its internal nodes.');
            const destination = parentSemanticNodeId
              ? state.nodes.find(
                  (node) =>
                    node.data.blockProjectionOwnerId === ownerId &&
                    node.data.blockProjectionNodeId === parentSemanticNodeId,
                )
              : owner;
            if (
              !destination ||
              destination.hidden ||
              (parentSemanticNodeId && destination.data.blockProjectionContainerExpanded !== true)
            )
              throw new Error('Expand the destination internal Block first.');
            let origin = { ...destination.position };
            let ancestorId = destination.parentId;
            const visited = new Set([destination.id]);
            while (ancestorId) {
              if (visited.has(ancestorId)) throw new Error('Invalid canvas parent cycle.');
              visited.add(ancestorId);
              const ancestor = state.nodes.find((node) => node.id === ancestorId);
              if (!ancestor) throw new Error('The destination canvas parent is missing.');
              origin = { x: origin.x + ancestor.position.x, y: origin.y + ancestor.position.y };
              ancestorId = ancestor.parentId;
            }
            const next = reparentOrdinaryBlockNodeV2(owner.data.blockInstanceV2, semanticId, parentSemanticNodeId, {
              x: absolutePosition.x - origin.x,
              y: absolutePosition.y - origin.y,
            });
            const graph = projectBlockInstanceV2(state, ownerId, next);
            if (!graph) throw new Error('Could not project the moved internal node.');
            return graph;
          });
          get().updateHandleConnectionStatus();
        });
      },
      configureBlockInterfaceV2: (id, value, subtreeId) => {
        if (!subtreeId && value.previews !== undefined)
          throw new Error('Root preview bindings belong to the Block definition, not its effective interface.');
        get().withHistory('Configure Block interface', () => {
          set((state) => {
            const root = state.nodes.find((node) => node.id === id);
            if (!root?.data.blockInstanceV2 || !isBlockRootV2(root))
              throw new Error(`Cannot configure invalid Block V2 root "${id}".`);
            if (subtreeId) {
              const graph = updateBlockInstanceV2(state, id, (instance) =>
                configureBlockContainerInterfaceV1(instance, subtreeId, value),
              );
              return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
            }
            const inputIds = new Set(value.boundary.inputs.map(({ portId }) => portId));
            const outputIds = new Set(value.boundary.outputs.map(({ portId }) => portId));
            const impacted = state.edges.filter(
              (edge) =>
                (edge.target === id &&
                  !parseBlockCrossingHandleV2(edge.targetHandle) &&
                  (!edge.targetHandle || !inputIds.has(edge.targetHandle))) ||
                (edge.source === id &&
                  !parseBlockCrossingHandleV2(edge.sourceHandle) &&
                  (!edge.sourceHandle || !outputIds.has(edge.sourceHandle))),
            );
            if (impacted.length)
              throw new Error(
                `Cannot remove ${impacted.length} connected Block port${impacted.length === 1 ? '' : 's'}. Disconnect the affected edge${impacted.length === 1 ? '' : 's'} first.`,
              );
            const graph = updateBlockInstanceV2(state, id, (instance) =>
              replaceBlockEffectiveInterfaceV2(instance, value, { preserveOmittedMirrors: false }),
            );
            return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
          });
          get().updateHandleConnectionStatus();
          get().updateSignalValues(get().edges);
        });
      },
      toggleUserBlockExpanded: (id) => {
        get().withHistory('Toggle block expansion', () => {
          set((state) => {
            const block = state.nodes.find((node) => node.id === id && node.data.type === 'block');
            if (!block) return state;
            if (block.data.blockInstanceV2) {
              const graph = updateBlockInstanceV2(state, id, (instance) =>
                reduceBlockPresentationV2(instance, {
                  expanded: !instance.presentation.expanded,
                  ...(!instance.presentation.expanded && instance.presentation.collapsedContainerNodeIds === undefined
                    ? { collapsedContainerNodeIds: blockModularContainerNodeIdsV2(instance.effectiveGraph) }
                    : {}),
                }),
              );
              return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
            }
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
      placeNodeInUserBlock: (nodeId, blockId) => {
        get().withHistory('Move node into Block', () => {
          set((state) => {
            const graph = placeExistingNodeInsideExpandedUserBlock(state, nodeId, blockId);
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
      insertNodeInUserBlock: (blockId, suggestion) => {
        get().withHistory('Insert node into Block execution path', () => {
          set((state) => {
            const graph = insertNodeAtUserBlockSuggestion(state, blockId, suggestion);
            return {
              nodes: graph.nodes,
              edges: decorateConnectionEdges(graph.nodes, graph.edges),
            };
          });
          get().updateHandleConnectionStatus();
          get().updateSignalValues(get().edges);
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
      applyUserBlockDefinition: (id, definition) => {
        get().withHistory('Apply Block definition', () => {
          set((state) => {
            const graph = applyUserBlockDefinitionToInstance(state, id, definition);
            return graph === state ? state : { nodes: graph.nodes, edges: graph.edges };
          });
          get().updateHandleConnectionStatus();
          get().updateSignalValues(get().edges);
        });
      },
      applyBlockDefinitionV2: (id, definition) => {
        get().withHistory('Apply Block V2 definition', () => {
          set((state) => {
            const graph = updateBlockInstanceV2(state, id, (instance) =>
              rebaseBlockInstanceV2ToDefinition(instance, definition),
            );
            return graph ? { nodes: graph.nodes, edges: decorateConnectionEdges(graph.nodes, graph.edges) } : state;
          });
          get().updateHandleConnectionStatus();
          get().updateSignalValues(get().edges);
        });
      },
      arrangeGraph: async (options = {}) => {
        const applyLayout = () => {
          set((state) => {
            const arranged = arrangeGraphNodes(state.nodes, state.edges).map((node) => {
              const instance = node.data.blockInstanceV2;
              if (!instance) return node;
              return {
                ...node,
                data: {
                  ...node.data,
                  blockInstanceV2: reduceBlockPresentationV2(instance, { position: node.position }),
                },
              };
            });
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

      exportGraph: (sid: string, targetNodeId?: string, options = {}) => {
        const { nodes, edges } = options.sourceGraph ?? get();
        const durable = withoutBlockCompilationTransientsV2(nodes, edges);
        const expanded = expandUserBlockGraph(durable.nodes, durable.edges, useUserBlockStore.getState().blocks);
        const withClusterBoundaries = expandHuggingFaceClusterBoundaryEdges(expanded);
        const executable = expandBlockGraphV2ForExecution(
          withClusterBoundaries.nodes,
          withClusterBoundaries.edges,
          targetNodeId,
        );
        return buildApiGraphExport({
          nodes: executable.nodes,
          edges: executable.edges,
          sid,
          targetNodeIds: resolveFlowExecutionTargetNodeIds(nodes, targetNodeId, edges),
          setParam: get().setParam,
          randomizeSeeds: options.randomizeSeeds,
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
        const current = get().historyTransaction;
        if (!current) return;
        replaceFlowGraph(
          {
            nodes: cloneJson(current.snapshot.nodes),
            edges: cloneJson(current.snapshot.edges),
            viewport: cloneJson(current.snapshot.viewport),
          },
          { clearRemovedCache: false },
          set,
          get,
        );
        set({ historyTransaction: null });
        get().updateHandleConnectionStatus();
        get().updateSignalValues(get().edges);
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
      partialize: persistedFlowSnapshot,
      onRehydrateStorage: () => (state) => {
        state?.resetExecutionProgress();
      },
    },
  ),
);
