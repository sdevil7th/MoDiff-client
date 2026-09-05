// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import {
  Background,
  BackgroundVariant,
  Connection,
  Edge,
  IsValidConnection,
  ReactFlow,
  useReactFlow,
  Viewport,
  useUpdateNodeInternals,
  ConnectionLineType,
  Panel,
  type NodeProps,
} from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network } from 'lucide-react';

import NodeSearchDialog from './NodeSearchDialog';
import { useNodesStore, type NodeParams } from '../stores/useNodeStore';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
  useStudioStore,
  workflowOperationContextIsCurrent,
} from '../stores/useStudioStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { isTerminalTaskStatus, useTaskStore } from '../stores/useTaskStore';
import { useGraphFixStore } from '../stores/useGraphFixStore';

import CustomNode from './CustomNode';
import AnyNode from './AnyNode';
import LoopNode from './LoopNode';
import GroupNode from './GroupNode';
import BlockNode from './BlockNode';
import HuggingFaceClusterNode from './HuggingFaceClusterNode';
import ProjectedBlockNodeV2 from './ProjectedBlockNodeV2';

import { SelectionToolbar } from './SelectionToolbar';
import { modiffOverlays, reactFlowCss } from '../theme';
import { useWorkflowAltDrag } from '../workflow/useWorkflowAltDrag';
import { useWorkflowConnections, workflowConnectionParam } from '../workflow/useWorkflowConnections';
import { useWorkflowDrop } from '../workflow/useWorkflowDrop';
import { enqueueSnackbar } from '../ui/snackbar';
import {
  createUserBlockNode,
  createUserBlockFromSelection,
  expandedUserBlockAtPosition,
  isUserBlockExpandedInstance,
  runtimeProgressTarget,
  type BlockSelectionResult,
  userBlockConnectionIsAllowed,
  validateUserBlockSelection,
  workflowBlueprintToUserBlock,
} from '../studio/userBlocks';
import { buildGraphFixPreview } from '../studio/graphFixer';
import { connectionColor, decorateConnectionEdges } from '../theme/connectionTypes';
import { ModiffButton, ModiffCheckbox, ModiffDialog, ModiffFieldShell, ModiffIconButton, ModiffInput } from '../ui';
import { GraphConnectionSurface } from '../ui/GraphConnectionSurface';
import { executionProgressFrom } from '../studio/executionProgress';
import { blockV2ConnectionScopeIsAllowed } from '../studio/nodeConnectorResolution';
import { expandedHuggingFaceClusterAtPosition } from '../studio/huggingFaceClusterGraph';
import { customizeHuggingFaceClusterInstance } from '../studio/huggingFaceClusterCustomization';
import {
  classifyExpandedClusterDrop,
  isOwnedHuggingFaceClusterExecutionNode,
} from '../workflow/huggingFaceClusterDrag';

const FileBrowserDialog = lazy(() => import('./FileBrowserDialog'));
const ModelManagerDialog = lazy(() => import('./ModelManagerDialog'));
const AlertDialog = lazy(() => import('./AlertDialog'));
const SettingsDialog = lazy(() => import('./SettingsDialog'));
const LightboxDialog = lazy(() => import('./LightboxDialog'));

const CustomNodeRenderer = (node: NodeProps<CustomNodeType>) =>
  node.data.blockProjectionModular === true ? <ProjectedBlockNodeV2 {...node} /> : <CustomNode {...node} />;
const AnyNodeRenderer = (node: NodeProps<CustomNodeType>) =>
  node.data.blockProjectionModular === true ? <ProjectedBlockNodeV2 {...node} /> : <AnyNode {...node} />;
const LoopNodeRenderer = (node: NodeProps<CustomNodeType>) =>
  node.data.blockProjectionModular === true ? <ProjectedBlockNodeV2 {...node} /> : <LoopNode {...node} />;
const GroupNodeRenderer = (node: NodeProps<CustomNodeType>) =>
  node.data.blockProjectionModular === true ? <ProjectedBlockNodeV2 {...node} /> : <GroupNode {...node} />;

const nodeTypes = {
  custom: CustomNodeRenderer,
  any: AnyNodeRenderer,
  loop: LoopNodeRenderer,
  group: GroupNodeRenderer,
  block: BlockNode,
  cluster: HuggingFaceClusterNode,
};

type PendingBlock = {
  result: Extract<BlockSelectionResult, { ok: true }>;
  name: string;
  inputLabels: Record<string, string>;
  outputLabels: Record<string, string>;
  exposedParamIds: Set<string>;
};

function expandedBlockV2AtPosition(nodes: CustomNodeType[], position: CustomNodeType['position']) {
  const candidates = nodes
    .filter(
      (node) =>
        !node.parentId &&
        node.data.blockInstanceV2?.presentation.expanded === true &&
        node.data.blockProjectionOwnerId === undefined,
    )
    .filter((node) => {
      const width = node.width ?? node.measured?.width ?? node.data.blockInstanceV2?.presentation.size.width ?? 360;
      const height = node.height ?? node.measured?.height ?? node.data.blockInstanceV2?.presentation.size.height ?? 320;
      return (
        position.x >= node.position.x &&
        position.x <= node.position.x + width &&
        position.y >= node.position.y &&
        position.y <= node.position.y + height
      );
    })
    .sort((left, right) => {
      const leftArea =
        (left.width ?? left.measured?.width ?? left.data.blockInstanceV2?.presentation.size.width ?? 360) *
        (left.height ?? left.measured?.height ?? left.data.blockInstanceV2?.presentation.size.height ?? 320);
      const rightArea =
        (right.width ?? right.measured?.width ?? right.data.blockInstanceV2?.presentation.size.width ?? 360) *
        (right.height ?? right.measured?.height ?? right.data.blockInstanceV2?.presentation.size.height ?? 320);
      return leftArea - rightArea;
    });
  return candidates[0] ?? null;
}

function blockV2ProjectionAtPosition(nodes: CustomNodeType[], position: CustomNodeType['position']) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const absolutePosition = (node: CustomNodeType) => {
    let x = node.position.x;
    let y = node.position.y;
    let parentId = node.parentId;
    const visited = new Set<string>([node.id]);
    while (parentId) {
      if (visited.has(parentId)) return null;
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return null;
      x += parent.position.x;
      y += parent.position.y;
      parentId = parent.parentId;
    }
    return { x, y };
  };
  return (
    nodes
      .filter((node) => node.data.blockProjectionOwnerId && node.data.blockProjectionNodeId)
      .filter((node) => {
        const owner = byId.get(node.data.blockProjectionOwnerId!);
        if (!owner?.data.blockInstanceV2?.presentation.expanded) return false;
        const absolute = absolutePosition(node);
        if (!absolute) return false;
        const width = node.measured?.width ?? node.width ?? 220;
        const height = node.measured?.height ?? node.height ?? 120;
        return (
          position.x >= absolute.x &&
          position.x <= absolute.x + width &&
          position.y >= absolute.y &&
          position.y <= absolute.y + height
        );
      })
      .sort((left, right) => {
        const leftArea = (left.measured?.width ?? left.width ?? 220) * (left.measured?.height ?? left.height ?? 120);
        const rightArea =
          (right.measured?.width ?? right.width ?? 220) * (right.measured?.height ?? right.height ?? 120);
        return leftArea - rightArea;
      })[0] ?? null
  );
}

function pointInsideNode(node: CustomNodeType, point: CustomNodeType['position']) {
  const width = node.width ?? node.measured?.width ?? node.data.blockInstanceV2?.presentation.size.width ?? 360;
  const height = node.height ?? node.measured?.height ?? node.data.blockInstanceV2?.presentation.size.height ?? 320;
  return (
    point.x >= node.position.x &&
    point.x <= node.position.x + width &&
    point.y >= node.position.y &&
    point.y <= node.position.y + height
  );
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
}

function Workflow() {
  const { nodesRegistry } = useNodesStore(
    useShallow((state) => ({
      nodesRegistry: state.nodesRegistry,
    })),
  );
  const { nodes, edges, defaultViewport, layoutRevision } = useFlowStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      defaultViewport: state.viewport,
      layoutRevision: state.layoutRevision,
    })),
  );
  const addNode = useFlowStore((state) => state.addNode);
  const arrangeGraph = useFlowStore((state) => state.arrangeGraph);
  const onNodesChange = useFlowStore((state) => state.onNodesChange);
  const onEdgesChange = useFlowStore((state) => state.onEdgesChange);
  const onConnect = useFlowStore((state) => state.onConnect);
  const onReconnect = useFlowStore((state) => state.onReconnect);
  const getParam = useFlowStore((state) => state.getParam);
  const removeEdges = useFlowStore((state) => state.removeEdges);
  const setParam = useFlowStore((state) => state.setParam);
  const updateViewportStore = useFlowStore((state) => state.setViewport);
  const beginHistoryTransaction = useFlowStore((state) => state.beginHistoryTransaction);
  const commitHistoryTransaction = useFlowStore((state) => state.commitHistoryTransaction);
  const withHistory = useFlowStore((state) => state.withHistory);
  const updateHandleConnectionStatus = useFlowStore((state) => state.updateHandleConnectionStatus);
  const updateSignalValues = useFlowStore((state) => state.updateSignalValues);
  const undo = useFlowStore((state) => state.undo);
  const redo = useFlowStore((state) => state.redo);
  const refreshConnectionVisuals = useFlowStore((state) => state.refreshConnectionVisuals);
  const currentTask = useTaskStore((state) => state.currentTask);
  const graphFixPreviewCandidate = useGraphFixStore((state) => state.previewCandidate);
  const createWorkflowTab = useStudioStore((state) => state.createWorkflowTab);
  const canvasTransition = useStudioStore((state) => state.canvasTransition);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const workflowCanvasHydrated = useStudioStore((state) => state.workflowCanvasHydrated);
  const blueprints = useStudioStore((state) => state.blueprints);
  const saveActiveWorkflowTab = useStudioStore((state) => state.saveActiveWorkflowTab);
  const workflowFocusRequest = useSettingsStore((state) => state.workflowFocusRequest);
  const setWorkflowFocusRequest = useSettingsStore((state) => state.setWorkflowFocusRequest);
  const userBlocks = useUserBlockStore((state) => state.blocks);
  const userBlocksLoaded = useUserBlockStore((state) => state.loaded);
  const fetchUserBlocks = useUserBlockStore((state) => state.fetchBlocks);
  const saveUserBlock = useUserBlockStore((state) => state.saveBlock);
  const [selectionDragging, setSelectionDragging] = useState(false);
  const [pendingBlock, setPendingBlock] = useState<PendingBlock | null>(null);
  const migratedBlueprintIds = useRef<Set<string>>(new Set());
  const updateNodeInternals = useUpdateNodeInternals();
  const canvasSuspended = Boolean(
    !workflowCanvasHydrated ||
    (canvasTransition?.type === 'template_graph_building' && canvasTransition.workflowTabId === activeWorkflowTabId),
  );
  const requiresCompleteCompositeMount = nodes.some(
    (node) =>
      (node.data.huggingFaceClusterRole === 'root' &&
        node.data.huggingFaceClusterInstance?.presentation.expanded === true) ||
      node.data.blockInstanceV2?.presentation.expanded === true ||
      (node.data.type === 'block' && isUserBlockExpandedInstance({ nodes, edges }, node.id)),
  );
  const graphFixPreview = useMemo(
    () => buildGraphFixPreview({ nodes, registry: nodesRegistry }, graphFixPreviewCandidate),
    [graphFixPreviewCandidate, nodes, nodesRegistry],
  );
  const exactVisibleNodes = [...nodes, ...graphFixPreview.nodes];
  const decoratedEdges = useMemo(() => decorateConnectionEdges(nodes, edges), [edges, nodes]);
  const clusterInstanceByExecutionNode = new Map(
    nodes.flatMap((node) =>
      node.data.huggingFaceClusterRole === 'execution' && node.data.huggingFaceClusterInstanceId
        ? [[node.id, node.data.huggingFaceClusterInstanceId] as const]
        : [],
    ),
  );
  const clusterEdgesReady = new Map(
    nodes.flatMap((node) =>
      node.data.huggingFaceClusterRole === 'root'
        ? [[node.id, node.data.uiState?.clusterExecutionEdgesReady === true] as const]
        : [],
    ),
  );
  // Hidden edges remain in the workflow store for persistence/export, but
  // passing them to React Flow still makes it resolve their handles. Cluster
  // children are intentionally inert while collapsed, so rendering those
  // edges would create a missing-handle loop even though no link is visible.
  const exactVisibleEdges = [...decoratedEdges, ...graphFixPreview.edges].filter((edge) => {
    if (edge.hidden) return false;
    const instanceId =
      clusterInstanceByExecutionNode.get(edge.source) ?? clusterInstanceByExecutionNode.get(edge.target);
    return !instanceId || clusterEdgesReady.get(instanceId) === true;
  });

  // The websocket welcome may hydrate the queue before persisted workflow
  // nodes have been restored. Replay the authoritative snapshot once the
  // matching node exists so a refresh does not leave the canvas looking idle.
  useEffect(() => {
    if (!currentTask?.current_node || isTerminalTaskStatus(currentTask.status)) return;
    if (
      !useStudioStore
        .getState()
        .shouldApplyRunUpdateToActiveWorkflow(
          currentTask.task_id,
          currentTask.client_run_id,
          currentTask.workflow_tab_id,
        )
    ) {
      return;
    }
    const activeNodeId = runtimeProgressTarget(nodes, currentTask.current_node, currentTask.current_node_name);
    const activeNode = nodes.find((node) => node.id === activeNodeId);
    if (!activeNode) return;
    const nodeProgress = currentTask.node_progress ?? 0;
    const hasOtherActiveNode = nodes.some(
      (node) =>
        node.id !== activeNode.id &&
        (node.data.executionStatus === 'running' ||
          (Boolean(node.data.activeTaskId) && typeof node.data.progress === 'number' && node.data.progress !== 0)),
    );
    if (
      activeNode.data.activeTaskId === (currentTask.task_id ?? null) &&
      activeNode.data.progress === nodeProgress &&
      activeNode.data.executionPhase === currentTask.phase &&
      activeNode.data.progressMessage === currentTask.message &&
      !hasOtherActiveNode
    ) {
      return;
    }
    useFlowStore.getState().updateProgress(activeNode.id, currentTask.node_progress ?? 0, {
      activeTaskId: currentTask.task_id ?? null,
      attemptIndex: currentTask.attempt_index,
      executionStatus: currentTask.status ?? 'running',
      executionPhase: currentTask.phase,
      progressMessage: currentTask.message,
      executionProgress: executionProgressFrom(currentTask),
    });
  }, [activeWorkflowTabId, currentTask, nodes]);

  const {
    edgeType,
    fileBrowserOpener,
    setFileBrowserOpener,
    modelManagerOpener,
    setModelManagerOpener,
    alertOpener,
    setAlertOpener,
    settingsOpener,
    setSettingsOpener,
    lightboxOpener,
    setLightboxOpener,
  } = useSettingsStore(
    useShallow((state) => ({
      edgeType: state.edgeType,
      fileBrowserOpener: state.fileBrowserOpener,
      setFileBrowserOpener: state.setFileBrowserOpener,
      modelManagerOpener: state.modelManagerOpener,
      setModelManagerOpener: state.setModelManagerOpener,
      alertOpener: state.alertOpener,
      setAlertOpener: state.setAlertOpener,
      settingsOpener: state.settingsOpener,
      setSettingsOpener: state.setSettingsOpener,
      lightboxOpener: state.lightboxOpener,
      setLightboxOpener: state.setLightboxOpener,
    })),
  );
  const { fitView, screenToFlowPosition } = useReactFlow();
  const workflowCanvasRef = useRef<HTMLDivElement>(null);
  const lastFitLayoutRevision = useRef(layoutRevision);
  const handledWorkflowFocusKey = useRef('');
  const suppressAutomaticFitUntil = useRef(0);
  const connectionScopeIsValid = useCallback(
    (connection: {
      source: string | null;
      sourceHandle: string | null;
      target: string | null;
      targetHandle: string | null;
    }) =>
      Boolean(
        connection.source &&
        connection.target &&
        userBlockConnectionIsAllowed(
          nodes,
          connection.source,
          connection.sourceHandle,
          connection.target,
          connection.targetHandle,
        ) &&
        blockV2ConnectionScopeIsAllowed(nodes, connection.source, connection.target),
      ),
    [nodes],
  );
  const getConnectionParam = useCallback(
    <K extends keyof NodeParams>(id: string, param: string, key: K) =>
      workflowConnectionParam(nodes, getParam, id, param, key),
    [getParam, nodes],
  );
  const { handleNodeDragStart, handleNodeDrag, handleNodeDragStop } = useWorkflowAltDrag({
    nodes,
    edges,
    onNodesChange,
  });
  const { handleDragOver, handleDrop } = useWorkflowDrop({
    addNode,
    createWorkflowTab,
    edgeType,
    nodesRegistry,
    screenToFlowPosition,
  });
  const {
    anchorPosition,
    closeNodeSearchDialog,
    connectionDataType,
    handleConnect,
    handleConnectEnd,
    handleConnectStart,
    handleDoubleClick,
    handleIsValidConnection,
    handleNodeSearchSelect,
    isConnecting,
    isConnectionValid,
    nodeSearchDataType,
    nodeSearchHandleType,
  } = useWorkflowConnections({
    addNode,
    edgeType,
    getParam: getConnectionParam,
    onConnect,
    screenToFlowPosition,
    setParam,
    updateNodeInternals,
    connectionScopeIsValid,
  });
  const connectionLineColor = connectionColor(connectionDataType);

  useEffect(() => {
    if (!workflowFocusRequest || workflowFocusRequest.workflowTabId !== activeWorkflowTabId) return;
    const requestKey = `${workflowFocusRequest.workflowTabId}:${workflowFocusRequest.nodeId}:${workflowFocusRequest.requestId}`;
    if (handledWorkflowFocusKey.current === requestKey) return;
    if (!workflowFocusRequest.nodeId) {
      handledWorkflowFocusKey.current = requestKey;
      suppressAutomaticFitUntil.current = Date.now() + 750;
      void fitView({ padding: 0.16, duration: 240, includeHiddenNodes: true }).finally(() => {
        setWorkflowFocusRequest(null);
      });
      return;
    }
    const targetId = nodes.find((node) => node.id === workflowFocusRequest.nodeId)?.id;
    if (!targetId) {
      if (Date.now() - workflowFocusRequest.requestedAt > 3000) setWorkflowFocusRequest(null);
      return;
    }

    handledWorkflowFocusKey.current = requestKey;
    suppressAutomaticFitUntil.current = Date.now() + 750;
    useFlowStore.setState((state) => ({
      nodes: state.nodes.every((node) => Boolean(node.selected) === (node.id === targetId))
        ? state.nodes
        : state.nodes.map((node) => ({ ...node, selected: node.id === targetId })),
    }));
    void fitView({ nodes: [{ id: targetId }], padding: 0.5, duration: 240 }).finally(() => {
      setWorkflowFocusRequest(null);
    });
  }, [activeWorkflowTabId, fitView, nodes, setWorkflowFocusRequest, workflowFocusRequest]);

  useEffect(() => {
    refreshConnectionVisuals();
  }, [edges, nodes, refreshConnectionVisuals]);

  useEffect(() => {
    if (layoutRevision === lastFitLayoutRevision.current) return;
    lastFitLayoutRevision.current = layoutRevision;
    if (Date.now() < suppressAutomaticFitUntil.current) return;
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        void fitView({ padding: 0.16, duration: 0, includeHiddenNodes: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [fitView, layoutRevision]);

  const handleArrangeGraph = useCallback(async () => {
    await arrangeGraph();
    saveActiveWorkflowTab(true);
  }, [arrangeGraph, saveActiveWorkflowTab]);

  const handleEdgeDoubleClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      removeEdges(edge.id);
      updateNodeInternals(edge.target);
    },
    [removeEdges, updateNodeInternals],
  );
  const handleEdgeReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      try {
        onReconnect(oldEdge, connection);
        saveActiveWorkflowTab(true);
      } catch (error) {
        enqueueSnackbar(error instanceof Error ? error.message : 'Could not reconnect this edge.', {
          variant: 'error',
          autoHideDuration: 5200,
        });
      }
    },
    [onReconnect, saveActiveWorkflowTab],
  );

  const handleTrackedNodeDragStart = useCallback(
    (...args: Parameters<typeof handleNodeDragStart>) => {
      setSelectionDragging(true);
      beginHistoryTransaction('Move node');
      handleNodeDragStart(...args);
    },
    [beginHistoryTransaction, handleNodeDragStart],
  );

  const handleTrackedNodeDrag = useCallback(
    (...args: Parameters<typeof handleNodeDrag>) => {
      handleNodeDrag(...args);
      const dragged = args[1];
      const current = useFlowStore.getState().nodes.find((node) => node.id === dragged.id);
      if (current?.parentId) {
        const parent = useFlowStore.getState().nodes.find((node) => node.id === current.parentId);
        // Legacy User Blocks grow while a child is dragged. A V2 Block decides
        // containment on drag-stop instead; growing it here would chase the
        // dragged projection and make moving an internal node out impossible.
        if (parent?.data.type === 'block' && !parent.data.blockInstanceV2) {
          useFlowStore.getState().fitUserBlockToChildren(parent.id);
        }
      }
    },
    [handleNodeDrag],
  );

  const handleTrackedNodeDragStop = useCallback(
    async (...args: Parameters<typeof handleNodeDragStop>) => {
      handleNodeDragStop(...args);
      const dragged = args[1];
      if (dragged && (dragged.data.type !== 'group' || dragged.data.blockProjectionKind === 'internal')) {
        const state = useFlowStore.getState();
        let current = state.nodes.find((node) => node.id === dragged.id);
        if (current) {
          const initialParentId = current.parentId;
          const parent = initialParentId ? state.nodes.find((node) => node.id === initialParentId) : undefined;
          if (parent?.data.type === 'block' && !parent.data.blockInstanceV2) {
            state.fitUserBlockToChildren(parent.id);
          }
          const byId = new Map(state.nodes.map((node) => [node.id, node]));
          let absolute = { ...current.position };
          let ancestorId = current.parentId;
          const visited = new Set<string>([current.id]);
          while (ancestorId) {
            if (visited.has(ancestorId)) break;
            visited.add(ancestorId);
            const ancestor = byId.get(ancestorId);
            if (!ancestor) break;
            absolute = { x: absolute.x + ancestor.position.x, y: absolute.y + ancestor.position.y };
            ancestorId = ancestor.parentId;
          }
          const width = current.measured?.width ?? current.width ?? 220;
          const height = current.measured?.height ?? current.height ?? 120;
          const center = { x: absolute.x + width / 2, y: absolute.y + height / 2 };
          // A materialized execution child is already owned by its registered
          // Cluster. A drag inside the expanded frame is a layout-only edit;
          // never reinterpret it as adoption or persist a User Node.
          const clusterOwnedExecutionChild = isOwnedHuggingFaceClusterExecutionNode(current);
          if (clusterOwnedExecutionChild) {
            state.persistHuggingFaceClusterExecutionPosition(current.id);
            useStudioStore.getState().saveActiveWorkflowTab(true);
            current = useFlowStore.getState().nodes.find((node) => node.id === dragged.id) ?? current;
          }
          let movedOutBlockV2OwnerId: string | null = null;
          let blockV2OwnedChild = Boolean(current.data.blockProjectionOwnerId && current.data.blockProjectionNodeId);
          const blockV2Owner = blockV2OwnedChild
            ? state.nodes.find((node) => node.id === current?.data.blockProjectionOwnerId && node.data.blockInstanceV2)
            : undefined;
          if (blockV2OwnedChild && blockV2Owner?.data.blockInstanceV2) {
            if (!pointInsideNode(blockV2Owner, center)) {
              if (current.data.blockProjectionContainer) {
                state.ensureBlockProjectionV2(blockV2Owner.id);
                enqueueSnackbar(
                  'A Modular container owns nested blocks. Keep it inside this Block or save the subtree as a User Node.',
                  { variant: 'warning', autoHideDuration: 5000 },
                );
                current = useFlowStore.getState().nodes.find((node) => node.id === dragged.id);
              } else
                try {
                  const movedId = state.moveNodeOutOfBlockV2(current.id, absolute);
                  movedOutBlockV2OwnerId = blockV2Owner.id;
                  useStudioStore.getState().saveActiveWorkflowTab(true);
                  current = useFlowStore.getState().nodes.find((node) => node.id === movedId);
                  blockV2OwnedChild = false;
                  enqueueSnackbar('The internal node was moved out of this Block.', {
                    variant: 'success',
                    autoHideDuration: 3000,
                  });
                } catch (error) {
                  state.ensureBlockProjectionV2(blockV2Owner.id);
                  enqueueSnackbar(
                    error instanceof Error ? error.message : 'Could not move this node out of the Block.',
                    {
                      variant: 'error',
                      autoHideDuration: 6000,
                    },
                  );
                  current = useFlowStore.getState().nodes.find((node) => node.id === dragged.id);
                }
            } else {
              state.persistBlockCanvasPresentationV2(current.id);
              useStudioStore.getState().saveActiveWorkflowTab(true);
              current = useFlowStore.getState().nodes.find((node) => node.id === dragged.id) ?? current;
            }
          } else if (current.data.blockInstanceV2) {
            state.persistBlockCanvasPresentationV2(current.id);
            useStudioStore.getState().saveActiveWorkflowTab(true);
            current = useFlowStore.getState().nodes.find((node) => node.id === dragged.id) ?? current;
          }
          const targetUserBlock =
            clusterOwnedExecutionChild || blockV2OwnedChild || !current
              ? null
              : expandedUserBlockAtPosition(
                  useFlowStore.getState().nodes.filter((node) => node.id !== movedOutBlockV2OwnerId),
                  center,
                );
          if (
            targetUserBlock &&
            current &&
            targetUserBlock.id !== current.id &&
            targetUserBlock.id !== current.data.userBlockInstanceId
          ) {
            if (current.data.type === 'block' || current.data.type === 'cluster') {
              enqueueSnackbar('Cluster Nodes and User Nodes cannot be nested.', {
                variant: 'warning',
                autoHideDuration: 2600,
              });
            } else {
              state.placeNodeInUserBlock(current.id, targetUserBlock.id);
              useStudioStore.getState().saveActiveWorkflowTab(true);
              current = useFlowStore.getState().nodes.find((node) => node.id === dragged.id);
            }
          }
          const replacementTarget =
            targetUserBlock || clusterOwnedExecutionChild || blockV2OwnedChild || !current
              ? null
              : blockV2ProjectionAtPosition(
                  useFlowStore
                    .getState()
                    .nodes.filter((node) => node.data.blockProjectionOwnerId !== movedOutBlockV2OwnerId),
                  center,
                );
          if (replacementTarget && current && replacementTarget.id !== current.id) {
            const currentId = current.id;
            try {
              useFlowStore.getState().replaceNodeInBlockV2(currentId, replacementTarget.id);
              useStudioStore.getState().saveActiveWorkflowTab(true);
              current = undefined;
              enqueueSnackbar('The internal node was replaced in this workflow Block.', {
                variant: 'success',
                autoHideDuration: 3200,
              });
            } catch (error) {
              useFlowStore.getState().cancelHistoryTransaction();
              enqueueSnackbar(error instanceof Error ? error.message : 'Could not replace this Block node.', {
                variant: 'error',
                autoHideDuration: 6000,
              });
              current = useFlowStore.getState().nodes.find((node) => node.id === currentId);
            }
          }
          const targetBlockV2 =
            targetUserBlock || clusterOwnedExecutionChild || blockV2OwnedChild || replacementTarget
              ? null
              : expandedBlockV2AtPosition(
                  useFlowStore.getState().nodes.filter((node) => node.id !== movedOutBlockV2OwnerId),
                  center,
                );
          if (targetBlockV2 && current && targetBlockV2.id !== current.id) {
            const currentId = current.id;
            try {
              useFlowStore.getState().adoptNodeIntoBlockV2(currentId, targetBlockV2.id);
              useStudioStore.getState().saveActiveWorkflowTab(true);
              current = undefined;
              enqueueSnackbar('The existing node was moved into this Block.', {
                variant: 'success',
                autoHideDuration: 3000,
              });
            } catch (error) {
              console.error('Could not move the existing node into this Block.', error);
              useFlowStore.getState().cancelHistoryTransaction();
              enqueueSnackbar(error instanceof Error ? error.message : 'Could not move this node into the Block.', {
                variant: 'error',
                autoHideDuration: 5200,
              });
              current = useFlowStore.getState().nodes.find((node) => node.id === currentId);
            }
          }
          const targetCluster =
            targetUserBlock || targetBlockV2 || clusterOwnedExecutionChild || blockV2OwnedChild
              ? null
              : expandedHuggingFaceClusterAtPosition(state.nodes, center);
          if (targetCluster && current) {
            const clusterDropDisposition = classifyExpandedClusterDrop(current, targetCluster.id);
            if (clusterDropDisposition === 'reject-composite') {
              enqueueSnackbar('Cluster Nodes and User Nodes cannot be nested.', {
                variant: 'warning',
                autoHideDuration: 2600,
              });
            } else if (clusterDropDisposition === 'customize-and-adopt') {
              const currentId = current.id;
              const customizationFlow = useFlowStore.getState();
              customizationFlow.beginHistoryTransaction('Customize Cluster and adopt node');
              try {
                const { blockNodeId } = await customizeHuggingFaceClusterInstance(targetCluster.id);
                const customizedFlow = useFlowStore.getState();
                customizedFlow.toggleUserBlockExpanded(blockNodeId);
                useFlowStore.getState().placeNodeInUserBlock(currentId, blockNodeId);
                useStudioStore.getState().saveActiveWorkflowTab(true);
                current = useFlowStore.getState().nodes.find((node) => node.id === currentId);
                enqueueSnackbar('Cluster customized as a User Node and the existing node was moved inside it.', {
                  variant: 'success',
                  autoHideDuration: 3000,
                });
              } catch (error) {
                useFlowStore.getState().cancelHistoryTransaction();
                console.error('Could not customize the Cluster as a User Node.', error);
                enqueueSnackbar(
                  error instanceof Error ? error.message : 'Could not customize the Cluster as a User Node.',
                  { variant: 'error', autoHideDuration: 4200 },
                );
              } finally {
                useFlowStore.getState().commitHistoryTransaction();
              }
            }
          }
          const currentParent = current?.parentId
            ? useFlowStore.getState().nodes.find((node) => node.id === current?.parentId)
            : undefined;
          if (current && (!currentParent || currentParent.data.type === 'loop')) {
            const currentId = current.id;
            const currentAbsolute = currentParent
              ? {
                  x: currentParent.position.x + current.position.x,
                  y: currentParent.position.y + current.position.y,
                }
              : current.position;
            const width = current.measured?.width ?? current.width ?? 220;
            const height = current.measured?.height ?? current.height ?? 120;
            const currentCenter = { x: currentAbsolute.x + width / 2, y: currentAbsolute.y + height / 2 };
            const target = state.nodes
              .filter((node) => node.data.type === 'loop' && !node.parentId && node.id !== currentId)
              .find((node) => {
                const loopWidth = node.measured?.width ?? node.width ?? 360;
                const loopHeight = node.measured?.height ?? node.height ?? 240;
                return (
                  currentCenter.x >= node.position.x &&
                  currentCenter.x <= node.position.x + loopWidth &&
                  currentCenter.y >= node.position.y &&
                  currentCenter.y <= node.position.y + loopHeight
                );
              });
            if ((target?.id ?? null) !== (currentParent?.data.type === 'loop' ? currentParent.id : null)) {
              state.setNodeLoopParent(current.id, target?.id ?? null);
            }
          }
        }
      }
      // React Flow has already published the final drag position before this
      // callback runs. Commit synchronously so an immediate Undo targets the
      // completed drag transaction instead of the preceding parameter edit.
      // Parent-relative reconciliation emitted after adoption is deliberately
      // non-undoable in the flow store and therefore does not need a frame
      // delay here.
      commitHistoryTransaction();
      setSelectionDragging(false);
    },
    [commitHistoryTransaction, handleNodeDragStop],
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      updateViewportStore(viewport);
    },
    [updateViewportStore],
  );

  const createBlockDisabledReason = validateUserBlockSelection(
    { nodes: exactVisibleNodes, edges: exactVisibleEdges },
    userBlocks,
  );

  const handleCreateBlockFromSelection = useCallback(() => {
    const result = createUserBlockFromSelection({ nodes, edges }, undefined, userBlocks);
    if (!result.ok) {
      enqueueSnackbar(result.reason, { variant: 'error', autoHideDuration: 2400 });
      return;
    }
    setPendingBlock({
      result,
      name: result.block.name,
      inputLabels: Object.fromEntries(result.block.inputs.map((port) => [port.id, port.label])),
      outputLabels: Object.fromEntries(result.block.outputs.map((port) => [port.id, port.label])),
      exposedParamIds: new Set(result.block.exposedParams.map((input) => input.id)),
    });
  }, [edges, nodes, userBlocks]);

  const handleConfirmBlockCreation = useCallback(async () => {
    if (!pendingBlock) return;
    const context = captureWorkflowOperationContext();
    const name = pendingBlock.name.trim();
    if (!name) {
      enqueueSnackbar('Enter a block name', { variant: 'error', autoHideDuration: 2200 });
      return;
    }
    const block = {
      ...pendingBlock.result.block,
      name,
      inputs: pendingBlock.result.block.inputs.map((port) => ({
        ...port,
        label: pendingBlock.inputLabels[port.id]?.trim() || port.label,
      })),
      outputs: pendingBlock.result.block.outputs.map((port) => ({
        ...port,
        label: pendingBlock.outputLabels[port.id]?.trim() || port.label,
      })),
      exposedParams: pendingBlock.result.block.exposedParams.filter((input) =>
        pendingBlock.exposedParamIds.has(input.id),
      ),
    };
    const replacementNode = createUserBlockNode(
      block,
      pendingBlock.result.blockNode.position,
      pendingBlock.result.blockNode.id,
    );
    const replacementNodes = pendingBlock.result.nodes.map((node) =>
      node.id === replacementNode.id ? replacementNode : node,
    );
    try {
      const saved = await saveUserBlock(block);
      assertWorkflowOperationContext(context);
      const savedNode = createUserBlockNode(saved, replacementNode.position, replacementNode.id);
      const nextNodes = replacementNodes.map((node) => (node.id === savedNode.id ? savedNode : node));
      withHistory('Create user block', () => {
        useFlowStore.getState().replaceGraph({
          nodes: nextNodes,
          edges: pendingBlock.result.edges,
        });
      });
      updateHandleConnectionStatus();
      updateSignalValues(pendingBlock.result.edges);
      saveActiveWorkflowTab(true);
      setPendingBlock(null);
      // Replacing several selected nodes with one collapsed block can reduce
      // the graph bounds dramatically. Keep the newly created block legible
      // instead of retaining the zoom that fitted the former expanded
      // topology. Two frames let React Flow measure the replacement node
      // before calculating the new viewport.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!workflowOperationContextIsCurrent(context)) return;
          void fitView({
            nodes: nextNodes.map(({ id }) => ({ id })),
            padding: 0.16,
            duration: 0,
            includeHiddenNodes: true,
          });
        });
      });
      enqueueSnackbar('Block created', { variant: 'success', autoHideDuration: 1800 });
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      // saveUserBlock already reports the concrete backend error.
    }
  }, [
    pendingBlock,
    fitView,
    saveActiveWorkflowTab,
    saveUserBlock,
    updateHandleConnectionStatus,
    updateSignalValues,
    withHistory,
  ]);

  useEffect(() => {
    if (!userBlocksLoaded) {
      void fetchUserBlocks();
    }
  }, [fetchUserBlocks, userBlocksLoaded]);

  useEffect(() => {
    if (!userBlocksLoaded || blueprints.length === 0) return;
    const existingIds = new Set(userBlocks.map((block) => block.id));
    blueprints.forEach((blueprint) => {
      if (existingIds.has(blueprint.id) || migratedBlueprintIds.current.has(blueprint.id)) return;
      migratedBlueprintIds.current.add(blueprint.id);
      void saveUserBlock(workflowBlueprintToUserBlock(blueprint)).catch(() => {
        migratedBlueprintIds.current.delete(blueprint.id);
      });
    });
  }, [blueprints, saveUserBlock, userBlocks, userBlocksLoaded]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isEditableKeyboardTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redo, undo]);

  return (
    <GraphConnectionSurface
      ref={workflowCanvasRef}
      id="workflow-canvas-panel"
      role="tabpanel"
      aria-label={activeWorkflowTabId ? undefined : 'Workflow canvas'}
      aria-labelledby={activeWorkflowTabId ? `workflow-tab-${activeWorkflowTabId}` : undefined}
      connectionColor={connectionLineColor}
      className="relative h-full w-full"
    >
      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={exactVisibleNodes}
        edges={exactVisibleEdges}
        defaultViewport={defaultViewport}
        connectionLineType={edgeType as ConnectionLineType}
        nodeOrigin={[0, 0]}
        minZoom={0.2}
        maxZoom={1.5}
        colorMode={'dark'}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        // Composite execution children can be outside the viewport even while
        // their root is collapsed. Their retained graph edges still require
        // registered handles. Mount the complete composite projection so its
        // internal links remain stable across collapse, expansion, and pan.
        onlyRenderVisibleElements={!canvasSuspended && !workflowFocusRequest && !requiresCompleteCompositeMount}
        zoomOnDoubleClick={false}
        isValidConnection={handleIsValidConnection as IsValidConnection}
        onDoubleClick={handleDoubleClick}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onReconnect={handleEdgeReconnect}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onNodeDragStart={handleTrackedNodeDragStart}
        onNodeDrag={handleTrackedNodeDrag}
        onNodeDragStop={handleTrackedNodeDragStop}
        onMoveEnd={handleMoveEnd}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        elevateEdgesOnSelect
        className={`${canvasSuspended ? 'pointer-events-none opacity-0' : ''} ${isConnecting ? 'connecting' : ''} ${isConnectionValid !== null ? (isConnectionValid ? 'valid-connection' : 'invalid-connection') : ''}`}
      >
        <style>{reactFlowCss}</style>
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color={modiffOverlays.disabledText} />
        <svg className="absolute h-0 w-0 overflow-hidden">
          <defs>
            <marker
              id="connection-marker"
              viewBox="0 0 4 4"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
              refX="2"
              refY="2"
            >
              <rect x="0" y="0" width="4" height="4" rx="1" />
            </marker>
          </defs>
        </svg>
        <Panel
          position="top-left"
          className="rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 shadow-modiff-panel"
        >
          <ModiffIconButton
            label="Arrange graph"
            data-testid="arrange-graph"
            disabled={nodes.length < 2 || canvasSuspended}
            onClick={() => {
              void handleArrangeGraph();
            }}
          >
            <Network size={16} />
          </ModiffIconButton>
        </Panel>
      </ReactFlow>
      {canvasSuspended && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-modiff-compact border border-modiff-border bg-modiff-panel px-3 py-2 text-sm font-semibold text-modiff-text shadow-modiff-node">
            {workflowCanvasHydrated ? 'Building template graph' : 'Restoring workflow'}
          </div>
        </div>
      )}
      <SelectionToolbar
        canvasSuspended={canvasSuspended}
        createBlockDisabledReason={createBlockDisabledReason}
        nodes={exactVisibleNodes}
        onCreateBlockFromSelection={() => {
          void handleCreateBlockFromSelection();
        }}
        selectionDragging={selectionDragging}
      />
      <NodeSearchDialog
        anchorPosition={anchorPosition}
        onClose={closeNodeSearchDialog}
        onSelect={handleNodeSearchSelect}
        nodes={nodesRegistry}
        dataType={nodeSearchDataType}
        handleType={nodeSearchHandleType}
      />
      <Suspense fallback={null}>
        {fileBrowserOpener && (
          <FileBrowserDialog
            opener={fileBrowserOpener}
            onClose={() => {
              setFileBrowserOpener(null);
            }}
          />
        )}
        {modelManagerOpener && (
          <ModelManagerDialog
            opener={modelManagerOpener}
            onClose={() => {
              setModelManagerOpener(null);
            }}
          />
        )}
        {settingsOpener && (
          <SettingsDialog
            opener={settingsOpener}
            onClose={() => {
              setSettingsOpener(null);
            }}
          />
        )}
        {lightboxOpener && (
          <LightboxDialog
            opener={lightboxOpener}
            onClose={() => {
              setLightboxOpener(null);
            }}
          />
        )}
        {alertOpener && (
          <AlertDialog
            opener={alertOpener}
            onClose={() => {
              setAlertOpener(null);
            }}
          />
        )}
      </Suspense>
      <ModiffDialog
        open={Boolean(pendingBlock)}
        onClose={() => setPendingBlock(null)}
        title="Create block"
        testId="create-user-block-dialog"
        panelClassName="max-w-xl"
        footer={
          <>
            <ModiffButton onClick={() => setPendingBlock(null)}>Cancel</ModiffButton>
            <ModiffButton
              tone="primary"
              disabled={!pendingBlock?.name.trim()}
              onClick={() => {
                void handleConfirmBlockCreation();
              }}
              data-testid="confirm-create-user-block"
            >
              Create block
            </ModiffButton>
          </>
        }
      >
        {pendingBlock ? (
          <div className="grid gap-4">
            <ModiffFieldShell label="Name" required>
              <ModiffInput
                autoFocus
                value={pendingBlock.name}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setPendingBlock((current) => (current ? { ...current, name: value } : current));
                }}
              />
            </ModiffFieldShell>

            {pendingBlock.result.block.inputs.length > 0 ? (
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold text-modiff-text">Inputs</h3>
                {pendingBlock.result.block.inputs.map((port) => (
                  <ModiffFieldShell key={port.id} label={port.label}>
                    <ModiffInput
                      value={pendingBlock.inputLabels[port.id] ?? port.label}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setPendingBlock((current) =>
                          current
                            ? {
                                ...current,
                                inputLabels: {
                                  ...current.inputLabels,
                                  [port.id]: value,
                                },
                              }
                            : current,
                        );
                      }}
                    />
                  </ModiffFieldShell>
                ))}
              </section>
            ) : null}

            {pendingBlock.result.block.outputs.length > 0 ? (
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold text-modiff-text">Outputs</h3>
                {pendingBlock.result.block.outputs.map((port) => (
                  <ModiffFieldShell key={port.id} label={port.label}>
                    <ModiffInput
                      value={pendingBlock.outputLabels[port.id] ?? port.label}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setPendingBlock((current) =>
                          current
                            ? {
                                ...current,
                                outputLabels: {
                                  ...current.outputLabels,
                                  [port.id]: value,
                                },
                              }
                            : current,
                        );
                      }}
                    />
                  </ModiffFieldShell>
                ))}
              </section>
            ) : null}

            {pendingBlock.result.block.exposedParams.length > 0 ? (
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold text-modiff-text">Editable parameters</h3>
                {pendingBlock.result.block.exposedParams.map((input) => (
                  <ModiffCheckbox
                    key={input.id}
                    label={input.label}
                    checked={pendingBlock.exposedParamIds.has(input.id)}
                    onCheckedChange={(checked) =>
                      setPendingBlock((current) => {
                        if (!current) return current;
                        const exposedParamIds = new Set(current.exposedParamIds);
                        if (checked) exposedParamIds.add(input.id);
                        else exposedParamIds.delete(input.id);
                        return { ...current, exposedParamIds };
                      })
                    }
                  />
                ))}
              </section>
            ) : null}
          </div>
        ) : null}
      </ModiffDialog>
    </GraphConnectionSurface>
  );
}

export default Workflow;
