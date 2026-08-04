// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import {
  Background,
  BackgroundVariant,
  Edge,
  IsValidConnection,
  ReactFlow,
  useReactFlow,
  Viewport,
  useUpdateNodeInternals,
  ConnectionLineType,
  Panel,
} from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network } from 'lucide-react';

import NodeSearchDialog from './NodeSearchDialog';
import { useNodesStore } from '../stores/useNodeStore';
import { useFlowStore } from '../stores/useFlowStore';
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
import BlockNode from './BlockNode';

import FileBrowserDialog from './FileBrowserDialog';
import ModelManagerDialog from './ModelManagerDialog';
import AlertDialog from './AlertDialog';
import SettingsDialog from './SettingsDialog';
import LightboxDialog from './LightboxDialog';
import { SelectionToolbar } from './SelectionToolbar';
import { modiffOverlays, reactFlowCss } from '../theme';
import { useWorkflowAltDrag } from '../workflow/useWorkflowAltDrag';
import { useWorkflowConnections } from '../workflow/useWorkflowConnections';
import { useWorkflowDrop } from '../workflow/useWorkflowDrop';
import { enqueueSnackbar } from '../ui/snackbar';
import {
  createUserBlockNode,
  createUserBlockFromSelection,
  runtimeProgressTarget,
  type BlockSelectionResult,
  validateUserBlockSelection,
  workflowBlueprintToUserBlock,
} from '../studio/userBlocks';
import { buildGraphFixPreview } from '../studio/graphFixer';
import { connectionColor, decorateConnectionEdges } from '../theme/connectionTypes';
import { ModiffButton, ModiffCheckbox, ModiffDialog, ModiffFieldShell, ModiffIconButton, ModiffInput } from '../ui';
import { GraphConnectionSurface } from '../ui/GraphConnectionSurface';
import { executionProgressFrom } from '../studio/executionProgress';

const nodeTypes = {
  custom: CustomNode,
  any: AnyNode,
  loop: LoopNode,
  block: BlockNode,
};

type PendingBlock = {
  result: Extract<BlockSelectionResult, { ok: true }>;
  name: string;
  inputLabels: Record<string, string>;
  outputLabels: Record<string, string>;
  exposedParamIds: Set<string>;
};

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
  const graphFixPreview = useMemo(
    () => buildGraphFixPreview({ nodes, registry: nodesRegistry }, graphFixPreviewCandidate),
    [graphFixPreviewCandidate, nodes, nodesRegistry],
  );
  const exactVisibleNodes = [...nodes, ...graphFixPreview.nodes];
  const decoratedEdges = useMemo(() => decorateConnectionEdges(nodes, edges), [edges, nodes]);
  const exactVisibleEdges = [...decoratedEdges, ...graphFixPreview.edges];

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
    getParam,
    onConnect,
    screenToFlowPosition,
    setParam,
    updateNodeInternals,
  });
  const connectionLineColor = connectionColor(connectionDataType);

  useEffect(() => {
    if (!workflowFocusRequest || workflowFocusRequest.workflowTabId !== activeWorkflowTabId) return;
    const requestKey = `${workflowFocusRequest.workflowTabId}:${workflowFocusRequest.nodeId}:${workflowFocusRequest.requestId}`;
    if (handledWorkflowFocusKey.current === requestKey) return;
    if (!workflowFocusRequest.nodeId) {
      handledWorkflowFocusKey.current = requestKey;
      suppressAutomaticFitUntil.current = Date.now() + 750;
      setWorkflowFocusRequest(null);
      void fitView({ padding: 0.16, duration: 240, includeHiddenNodes: true });
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
    setWorkflowFocusRequest(null);
    void fitView({ nodes: [{ id: targetId }], padding: 0.5, duration: 240 });
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
        if (parent?.data.type === 'block') {
          useFlowStore.getState().fitUserBlockToChildren(parent.id);
        }
      }
    },
    [handleNodeDrag],
  );

  const handleTrackedNodeDragStop = useCallback(
    (...args: Parameters<typeof handleNodeDragStop>) => {
      handleNodeDragStop(...args);
      const dragged = args[1];
      if (dragged && dragged.data.type !== 'group') {
        const state = useFlowStore.getState();
        const current = state.nodes.find((node) => node.id === dragged.id);
        if (current) {
          const parent = current.parentId ? state.nodes.find((node) => node.id === current.parentId) : undefined;
          if (parent?.data.type === 'block') {
            state.fitUserBlockToChildren(parent.id);
          }
          if (!parent || parent.data.type === 'loop') {
            const absolute = parent
              ? { x: parent.position.x + current.position.x, y: parent.position.y + current.position.y }
              : current.position;
            const width = current.measured?.width ?? current.width ?? 220;
            const height = current.measured?.height ?? current.height ?? 120;
            const center = { x: absolute.x + width / 2, y: absolute.y + height / 2 };
            const target = state.nodes
              .filter((node) => node.data.type === 'loop' && !node.parentId && node.id !== current.id)
              .find((node) => {
                const loopWidth = node.measured?.width ?? node.width ?? 360;
                const loopHeight = node.measured?.height ?? node.height ?? 240;
                return (
                  center.x >= node.position.x &&
                  center.x <= node.position.x + loopWidth &&
                  center.y >= node.position.y &&
                  center.y <= node.position.y + loopHeight
                );
              });
            if ((target?.id ?? null) !== (parent?.data.type === 'loop' ? parent.id : null)) {
              state.setNodeLoopParent(current.id, target?.id ?? null);
            }
          }
        }
      }
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
        onlyRenderVisibleElements
        zoomOnDoubleClick={false}
        isValidConnection={handleIsValidConnection as IsValidConnection}
        onDoubleClick={handleDoubleClick}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeDoubleClick={handleEdgeDoubleClick}
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
