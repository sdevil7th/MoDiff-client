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
} from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useCallback, useEffect, useRef, useState } from 'react';

import NodeSearchDialog from './NodeSearchDialog';
import { useNodesStore } from '../stores/useNodeStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { useTaskStore } from '../stores/useTaskStore';

import CustomNode from './CustomNode';
import AnyNode from './AnyNode';

import FileBrowserDialog from './FileBrowserDialog';
import ModelManagerDialog from './ModelManagerDialog';
import AlertDialog from './AlertDialog';
import SettingsDialog from './SettingsDialog';
import LightboxDialog from './LightboxDialog';
import { SelectionToolbar } from './SelectionToolbar';
import { modiffColors, modiffOverlays, reactFlowCss } from '../theme';
import { useWorkflowAltDrag } from '../workflow/useWorkflowAltDrag';
import { useWorkflowConnections } from '../workflow/useWorkflowConnections';
import { useWorkflowDrop } from '../workflow/useWorkflowDrop';
import { enqueueSnackbar } from '../ui/snackbar';
import {
  createUserBlockFromSelection,
  validateUserBlockSelection,
  workflowBlueprintToUserBlock,
} from '../studio/userBlocks';

const nodeTypes = {
  custom: CustomNode,
  any: AnyNode,
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
  const { nodes, edges, defaultViewport } = useFlowStore(
    useShallow((state) => ({
      nodes: state.nodes,
      edges: state.edges,
      defaultViewport: state.viewport,
    })),
  );
  const addNode = useFlowStore((state) => state.addNode);
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
  const currentTask = useTaskStore((state) => state.currentTask);
  const createWorkflowTab = useStudioStore((state) => state.createWorkflowTab);
  const canvasTransition = useStudioStore((state) => state.canvasTransition);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const blueprints = useStudioStore((state) => state.blueprints);
  const saveActiveWorkflowTab = useStudioStore((state) => state.saveActiveWorkflowTab);
  const userBlocks = useUserBlockStore((state) => state.blocks);
  const userBlocksLoaded = useUserBlockStore((state) => state.loaded);
  const fetchUserBlocks = useUserBlockStore((state) => state.fetchBlocks);
  const saveUserBlock = useUserBlockStore((state) => state.saveBlock);
  const [selectionDragging, setSelectionDragging] = useState(false);
  const migratedBlueprintIds = useRef<Set<string>>(new Set());
  const updateNodeInternals = useUpdateNodeInternals();
  const canvasSuspended = Boolean(
    canvasTransition?.type === 'template_graph_building' && canvasTransition.workflowTabId === activeWorkflowTabId,
  );
  const visibleNodes = canvasSuspended ? [] : nodes;
  const visibleEdges = canvasSuspended ? [] : edges;

  // The websocket welcome may hydrate the queue before persisted workflow
  // nodes have been restored. Replay the authoritative snapshot once the
  // matching node exists so a refresh does not leave the canvas looking idle.
  useEffect(() => {
    if (!currentTask?.current_node) return;
    const activeNode = nodes.find((node) => node.id === currentTask.current_node);
    if (!activeNode) return;
    const nodeProgress = currentTask.node_progress ?? 0;
    if (
      activeNode.data.activeTaskId === (currentTask.task_id ?? null) &&
      activeNode.data.progress === nodeProgress &&
      activeNode.data.executionPhase === currentTask.phase &&
      activeNode.data.progressMessage === currentTask.message
    ) {
      return;
    }
    useFlowStore.getState().updateProgress(currentTask.current_node, currentTask.node_progress ?? 0, {
      activeTaskId: currentTask.task_id ?? null,
      attemptIndex: currentTask.attempt_index,
      executionStatus: currentTask.status ?? 'running',
      executionPhase: currentTask.phase,
      progressMessage: currentTask.message,
    });
  }, [
    currentTask?.attempt_index,
    currentTask?.current_node,
    currentTask?.message,
    currentTask?.node_progress,
    currentTask?.phase,
    currentTask?.status,
    currentTask?.task_id,
    nodes,
  ]);

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
  const { screenToFlowPosition } = useReactFlow();
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

  const handleTrackedNodeDragStop = useCallback(
    (...args: Parameters<typeof handleNodeDragStop>) => {
      handleNodeDragStop(...args);
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

  const createBlockDisabledReason = validateUserBlockSelection({ nodes: visibleNodes, edges: visibleEdges });

  const handleCreateBlockFromSelection = useCallback(async () => {
    const result = createUserBlockFromSelection({ nodes, edges });
    if (!result.ok) {
      enqueueSnackbar(result.reason, { variant: 'error', autoHideDuration: 2400 });
      return;
    }

    try {
      await saveUserBlock(result.block);
      withHistory('Create user block', () => {
        useFlowStore.getState().replaceGraph({
          nodes: result.nodes,
          edges: result.edges,
        });
      });
      updateHandleConnectionStatus();
      updateSignalValues(result.edges);
      saveActiveWorkflowTab(true);
      enqueueSnackbar('Block created', { variant: 'success', autoHideDuration: 1800 });
    } catch {
      // saveUserBlock already reports the concrete backend error.
    }
  }, [
    edges,
    nodes,
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
    <div className="relative h-full w-full">
      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={visibleNodes}
        edges={visibleEdges}
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
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleTrackedNodeDragStop}
        onMoveEnd={handleMoveEnd}
        className={`${isConnecting ? 'connecting' : ''} ${isConnectionValid !== null ? (isConnectionValid ? 'valid-connection' : 'invalid-connection') : ''}`}
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
              <rect x="0" y="0" width="4" height="4" rx="1" fill={modiffColors.flowHandle} />
            </marker>
          </defs>
        </svg>
      </ReactFlow>
      {canvasSuspended && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-modiff-compact border border-modiff-border bg-modiff-panel px-3 py-2 text-sm font-semibold text-modiff-text shadow-modiff-node">
            Building template graph
          </div>
        </div>
      )}
      <SelectionToolbar
        canvasSuspended={canvasSuspended}
        createBlockDisabledReason={createBlockDisabledReason}
        nodes={visibleNodes}
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
    </div>
  );
}

export default Workflow;
