import { nodeDisplayLabel } from '../workflow/nodePresentation';
// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { NodeProps, useStoreApi } from '@xyflow/react';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  Circle,
  CircleCheck,
  Info,
  CircleHelp,
  Clock3,
  Copy,
  Files,
  Gauge,
  GitBranch,
  Maximize2,
  Minimize2,
  Play,
  Power,
  RefreshCcw,
  Save,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import { CustomNodeType, useFlowStore } from '../stores/useFlowStore';
import { NodeParams } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { validateCurrentRun } from '../studio/runReadiness';
import { modiffLayout, sanitizeModiffNodeStyle } from '../theme';
import { dataTypeClass, normalizeDataType } from '../utils/dataTypeCategory';
import { formatExecutionTime } from '../utils/formatExecutionTime';
import { formatMemory } from '../utils/formatMemory';
import { useNodeLayoutSync } from '../utils/useNodeLayoutSync';
import {
  CustomNodeFrame,
  CustomNodeHeaderFrame,
  ModiffButton,
  ModiffIconButton,
  ModiffPopover,
  ModiffProgress,
  ModiffTooltip,
  NodeResizeGrip,
} from '../ui';
import { cx } from '../utils/classNames';
import ErrorBoundary from './ErrorBoundary';
import NodeContent from './NodeContent';
import { enqueueSnackbar } from '../ui/snackbar';
import { deleteNodeCache, recomputeNodeOutputs } from '../utils/serverActions';
import { syncManagedNodeControlChange } from '../studio/managedControlSync';
import {
  GraphMenuAction,
  GraphMenuDivider as SharedGraphMenuDivider,
  type GraphMenuActionProps,
} from '../ui/GraphMenuAction';
import { executionProgressDetail } from '../studio/executionProgress';
import type { ExecutionProgress } from '../studio/types';
import BlockSaveDialogV2 from './BlockSaveDialogV2';

const MAX_NODE_WIDTH = modiffLayout.maxNodeWidth;

type PanelAnchor = { left: number; top: number };

function clampAnchor(anchor: PanelAnchor, estimatedWidth = 220, estimatedHeight = 320): PanelAnchor {
  const viewportWidth = window.innerWidth || 1280;
  const viewportHeight = window.innerHeight || 720;
  return {
    left: Math.max(8, Math.min(anchor.left, viewportWidth - estimatedWidth - 8)),
    top: Math.max(8, Math.min(anchor.top, viewportHeight - estimatedHeight - 8)),
  };
}

function anchorBeside(element: HTMLElement): PanelAnchor {
  const rect = element.getBoundingClientRect();
  return clampAnchor(
    {
      left: Math.round(rect.right + 8),
      top: Math.round(Math.max(8, rect.top - 8)),
    },
    480,
    260,
  );
}

function anchorBelow(element: HTMLElement): PanelAnchor {
  const rect = element.getBoundingClientRect();
  return clampAnchor(
    {
      left: Math.round(rect.left),
      top: Math.round(rect.bottom + 6),
    },
    220,
    160,
  );
}

function contextMenuAnchor(event: MouseEvent<HTMLDivElement>): { mouseX: number; mouseY: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  const rawX = Number.isFinite(event.clientX) ? event.clientX : rect.left + 24;
  const rawY = Number.isFinite(event.clientY) ? event.clientY : rect.top + 24;
  const anchor = clampAnchor({ left: Math.round(rawX + 2), top: Math.round(rawY - 6) });
  return { mouseX: anchor.left, mouseY: anchor.top };
}

const CustomNode = memo((node: NodeProps<CustomNodeType>) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const style = sanitizeModiffNodeStyle(node.data.style, `${node.id}.node`);
  const label = nodeDisplayLabel(node.data);
  const hasAudioPlayer = Object.values(node.data.params).some((param) => param.display === 'ui_audio');
  const minimumNodeWidth = hasAudioPlayer ? modiffLayout.audioPreviewNodeMinWidth : modiffLayout.nodeMinWidth;
  const setParam = useFlowStore((state) => state.setParamWithHistory);
  const setNodeSize = useFlowStore((state) => state.setNodeSize);
  const beginHistoryTransaction = useFlowStore((state) => state.beginHistoryTransaction);
  const commitHistoryTransaction = useFlowStore((state) => state.commitHistoryTransaction);
  const setNodeCached = useFlowStore((state) => state.setNodeCached);
  const removeNodes = useFlowStore((state) => state.removeNodes);
  const duplicateNode = useFlowStore((state) => state.duplicateNode);
  const toggleNodeCollapsed = useFlowStore((state) => state.toggleNodeCollapsed);
  const resetNodeSize = useFlowStore((state) => state.resetNodeSize);
  // NodeProps.height is React Flow's latest measurement, not necessarily a
  // user-authored size. Feeding it back into textarea minima changed natural
  // content height inside React Flow's ResizeObserver delivery (110 -> 160),
  // causing undelivered notifications. Only explicit canvas sizing opts in.
  const hasTallExplicitSize = useFlowStore(
    (state) => (state.nodes.find((candidate) => candidate.id === node.id)?.height ?? 0) > 360,
  );
  const setNodeUiState = useFlowStore((state) => state.setNodeUiState);
  const [helpAnchor, setHelpAnchor] = useState<PanelAnchor | null>(null);
  const [issueAnchor, setIssueAnchor] = useState<PanelAnchor | null>(null);
  const [executionTimeAnchor, setExecutionTimeAnchor] = useState<PanelAnchor | null>(null);
  const [memoryAnchor, setMemoryAnchor] = useState<PanelAnchor | null>(null);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const [branchPreview, setBranchPreview] = useState<{
    anchor: PanelAnchor;
    nodeIds: string[];
    cachedNodeIds: string[];
  } | null>(null);
  const runningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const contextMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const sid = useWebsocketStore((state) => state.sid);
  const isConnected = useWebsocketStore((state) => state.isConnected);
  const reactFlowStore = useStoreApi();
  const scheduleNodeLayoutSync = useNodeLayoutSync(node.id, nodeRef);
  const isClusterGraphProjection = node.data.huggingFaceClusterRole === 'execution';
  const isBlockProjection = useFlowStore((state) => {
    const ownerId = node.data.blockProjectionOwnerId;
    const semanticNodeId = node.data.blockProjectionNodeId;
    if (!ownerId || !semanticNodeId) return false;
    const owner = state.nodes.find((candidate) => candidate.id === ownerId);
    return Boolean(owner?.data.blockInstanceV2?.effectiveGraph.nodes.some(({ nodeId }) => nodeId === semanticNodeId));
  });
  const validationSeverity = isClusterGraphProjection ? undefined : node.data.uiState?.validationSeverity;
  const validationMessage = isClusterGraphProjection
    ? undefined
    : node.data.uiState?.validationMessage || node.data.uiState?.errorMessage;
  const recentChangeLabel = node.data.uiState?.recentChangeLabel;
  const isError = validationSeverity === 'error';
  const isStatus = validationSeverity === 'success' || validationSeverity === 'info';
  const statusHeading = isError ? 'Node error' : isStatus ? 'Node status' : 'Node warning';
  const StatusIcon = validationSeverity === 'success' ? CircleCheck : isStatus ? Info : TriangleAlert;
  const statusColor = isError
    ? 'text-modiff-red'
    : validationSeverity === 'success'
      ? 'text-modiff-green'
      : isStatus
        ? 'text-modiff-subtle-text'
        : 'text-hf-orange';
  const isCollapsed = Boolean(node.data.uiState?.collapsed || node.data.minimized);
  const isDisabledForRun = Boolean(node.data.uiState?.disabled);
  const showDisabledForRun = isDisabledForRun && !isClusterGraphProjection;

  const handleUpdateStore = useCallback(
    (param: string, value: unknown, key?: keyof NodeParams) => {
      setParam(node.id, param, value, key);
      syncManagedNodeControlChange(node.id, param, value, key);

      const currentRunningState = useSettingsStore.getState().runningState;

      if (currentRunningState === 'auto_queue' && sid) {
        const lastExecutionTime = useFlowStore.getState().lastExecutionTime * 1000;
        const interval = Math.min(Math.max(lastExecutionTime * 1.15, 100), 1000);

        if (runningTimeoutRef.current) {
          clearTimeout(runningTimeoutRef.current);
        }
        runningTimeoutRef.current = setTimeout(() => {
          void coordinateGraphRun({ sid });
        }, interval);
      }
    },
    [setParam, node.id, sid],
  );

  const handleRecompute = useCallback(async () => {
    try {
      const result = await recomputeNodeOutputs([node.id]);
      if (result.nodes.length) setNodeCached(node.id, false);
      enqueueSnackbar(
        result.nodes.length
          ? 'Outputs will recompute on the next Run. Loaded models are retained.'
          : 'Loaded models retained; no computed outputs to invalidate.',
        { variant: 'success', autoHideDuration: 3500 },
      );
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : String(error), { variant: 'error' });
    }
  }, [node.id, setNodeCached]);

  const handleClearCache = useCallback(async () => {
    try {
      await deleteNodeCache([node.id]);
      setNodeCached(node.id, false);
      enqueueSnackbar('Node cache released', { variant: 'success', autoHideDuration: 1500 });
    } catch (error) {
      console.error('Failed to delete cache', error);
    }
  }, [node.id, setNodeCached]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    window.requestAnimationFrame(() => contextMenuReturnFocusRef.current?.focus());
  }, []);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const currentFocus = document.activeElement;
    contextMenuReturnFocusRef.current =
      currentFocus instanceof HTMLElement && currentFocus !== document.body
        ? currentFocus
        : event.currentTarget.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])');
    setContextMenu(contextMenuAnchor(event));
  }, []);

  const handleRunFromNode = useCallback(async () => {
    closeContextMenu();
    const validation = validateCurrentRun({ sid, isConnected, includeStudio: false, targetNodeId: node.id });
    if (!validation.canRun || !sid) return;
    await coordinateGraphRun({ sid, targetNodeId: node.id });
  }, [closeContextMenu, isConnected, node.id, sid]);

  const handlePreviewBranch = useCallback(() => {
    const validation = validateCurrentRun({
      sid,
      isConnected,
      includeStudio: false,
      showDialog: false,
      targetNodeId: node.id,
    });
    if (!validation.canRun || !sid || !contextMenu) return;
    const apiGraph = useFlowStore.getState().exportGraph(sid, node.id);
    const nodeIds = Object.keys(apiGraph.nodes);
    const cachedNodeIds = useFlowStore
      .getState()
      .nodes.filter((item) => nodeIds.includes(item.id) && item.data.isCached)
      .map((item) => item.id);
    setBranchPreview({
      anchor: clampAnchor({ left: contextMenu.mouseX + 180, top: contextMenu.mouseY }, 320, 260),
      nodeIds,
      cachedNodeIds,
    });
    closeContextMenu();
  }, [closeContextMenu, contextMenu, isConnected, node.id, sid]);

  const handleCopyNodeInfo = useCallback(() => {
    closeContextMenu();
    void navigator.clipboard.writeText(`${node.id}\n${node.data.module}.${node.data.action}`);
    enqueueSnackbar('Node info copied', { variant: 'success', autoHideDuration: 1600 });
  }, [closeContextMenu, node.data.action, node.data.module, node.id]);

  const [saveChoicesOpen, setSaveChoicesOpen] = useState(false);

  const onResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      beginHistoryTransaction('Resize node');
      const initialWidth = nodeRef.current?.clientWidth || node.width || 0;
      const initialHeight = nodeRef.current?.clientHeight || node.height || 0;
      const startX = event.clientX;
      const startY = event.clientY;
      const zoomLevel = reactFlowStore.getState().transform[2];

      const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const newWidth = Math.max(
          minimumNodeWidth,
          Math.min(MAX_NODE_WIDTH, initialWidth + Math.round((moveEvent.clientX - startX) / zoomLevel)),
        );
        const newHeight = Math.max(160, initialHeight + Math.round((moveEvent.clientY - startY) / zoomLevel));
        setNodeSize(node.id, newWidth, newHeight);
        scheduleNodeLayoutSync();
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        commitHistoryTransaction();
        scheduleNodeLayoutSync();
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [
      beginHistoryTransaction,
      commitHistoryTransaction,
      node.id,
      node.width,
      node.height,
      minimumNodeWidth,
      reactFlowStore,
      scheduleNodeLayoutSync,
      setNodeSize,
    ],
  );

  useEffect(() => {
    return () => {
      if (runningTimeoutRef.current) {
        clearTimeout(runningTimeoutRef.current);
      }
    };
  }, []);

  return (
    <CustomNodeFrame
      ref={nodeRef}
      id={node.id}
      parentNodeId={node.parentId}
      testId={`graph-node-action-${node.data.action}`}
      className={cx(
        normalizeDataType(`${node.data.module}_${node.data.action}`),
        normalizeDataType(node.data.module),
        dataTypeClass(node.data.category),
        showDisabledForRun && 'opacity-60',
        recentChangeLabel && 'outline-hf-yellow border-hf-yellow shadow-modiff-panel',
      )}
      nodeStyle={style}
      maxWidth={MAX_NODE_WIDTH}
      minWidth={minimumNodeWidth}
      isError={isError}
      onContextMenu={handleContextMenu}
    >
      <CustomNodeHeaderFrame headerColor={node.data.headerColor}>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{label}</span>
          {showDisabledForRun && <span className="block truncate text-xs text-hf-orange">Disabled for run export</span>}
          {recentChangeLabel && <span className="block truncate text-xs text-hf-yellow">{recentChangeLabel}</span>}
        </div>
        <div className="nodrag flex items-center gap-1">
          {validationMessage && (
            <>
              <ModiffIconButton
                size="compact"
                className={cx('nodrag', statusColor)}
                onClick={(event) => setIssueAnchor(anchorBeside(event.currentTarget))}
                title={validationMessage}
                label={`${statusHeading} details`}
              >
                <StatusIcon size={16} />
              </ModiffIconButton>
              {issueAnchor && (
                <NodePopover anchor={issueAnchor} onClose={() => setIssueAnchor(null)} className="max-w-[420px] p-3">
                  <div className={cx('mb-1 text-sm font-bold', statusColor)}>{statusHeading}</div>
                  <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-modiff-text">
                    {validationMessage}
                  </p>
                </NodePopover>
              )}
            </>
          )}
          <ModiffIconButton
            size="compact"
            className="nodrag text-modiff-text"
            onClick={(event) => setHelpAnchor(anchorBeside(event.currentTarget))}
            label="Node help"
          >
            <CircleHelp size={16} />
          </ModiffIconButton>
          {helpAnchor && (
            <NodePopover anchor={helpAnchor} onClose={() => setHelpAnchor(null)} className="max-w-[480px] p-3">
              <div className="text-base font-bold text-modiff-text">{label}</div>
              {node.data.description && <div className="mt-1 text-sm text-modiff-text">{node.data.description}</div>}
              {Object.entries(node.data.params).map(([key, param]) =>
                param.description ? (
                  <div key={key} className="mt-1 text-sm text-modiff-text">
                    <b className="text-modiff-text">{param.label || key.charAt(0).toUpperCase() + key.slice(1)}:</b>{' '}
                    {param.description}
                  </div>
                ) : null,
              )}
            </NodePopover>
          )}
        </div>
      </CustomNodeHeaderFrame>

      {isCollapsed ? (
        <div
          className="relative flex min-h-24 w-full flex-1 items-center justify-center bg-modiff-surface px-8 py-4 text-modiff-subtle-text"
          data-testid={`node-scroll-body-${node.id}`}
        >
          <span className="truncate text-xs font-semibold text-modiff-subtle-text">Collapsed</span>
        </div>
      ) : (
        <>
          <div
            className={cx(
              'nowheel flex min-h-0 w-full flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto bg-modiff-surface p-3 pb-2 text-modiff-text',
              hasTallExplicitSize ? '[&_.modiff-textarea-field]:min-h-40' : '[&_.modiff-textarea-field]:min-h-[110px]',
            )}
            data-testid={`node-scroll-body-${node.id}`}
          >
            <ErrorBoundary module={node.data.module || ''} action={node.data.action || ''}>
              <NodeContent
                nodeId={node.id}
                params={node.data.params}
                updateStore={handleUpdateStore}
                updateFieldActionStore={
                  node.data.operationAuthoring && !node.data.blockProjectionOwnerId && !isClusterGraphProjection
                    ? (_origin, param, value, key) => useFlowStore.getState().setParam(node.id, param, value, key)
                    : undefined
                }
                module={node.data.module || ''}
                action={node.data.action || ''}
                mode="controls"
                executionStatus={node.data.executionStatus}
                progressMessage={node.data.progressMessage}
              />
            </ErrorBoundary>
          </div>

          <div className="relative w-full shrink-0 bg-modiff-bg text-modiff-subtle-text">
            <NodeProgress
              progress={node.data.progress}
              executionStatus={node.data.executionStatus}
              executionProgress={node.data.executionProgress}
            />
            <div className="flex items-center gap-2 p-1 pr-6">
              <ModiffIconButton
                size="compact"
                className="nodrag text-modiff-subtle-text"
                disabled={!node.data.isCached}
                label={node.data.isCached ? 'Release node cache' : 'Node is not cached'}
                title={node.data.isCached ? 'Release this node and its loaded components' : 'Not cached'}
                onClick={() => {
                  void handleClearCache();
                }}
              >
                <Circle
                  size={14}
                  className={
                    node.data.isCached
                      ? 'fill-modiff-green text-modiff-green'
                      : 'fill-modiff-disabled text-modiff-disabled'
                  }
                />
              </ModiffIconButton>
              <NodeProgressStatus
                status={node.data.executionStatus}
                phase={node.data.executionPhase}
                message={node.data.progressMessage}
                progress={node.data.progress}
                executionProgress={node.data.executionProgress}
              />
              <FooterMetricButton
                icon={<Gauge size={14} />}
                title="Peak node memory usage"
                onClick={(event) => setMemoryAnchor(anchorBelow(event.currentTarget))}
              >
                {node.data.memoryUsage?.last ? formatMemory(node.data.memoryUsage.last) : '-'}
              </FooterMetricButton>
              {memoryAnchor && (
                <NodePopover anchor={memoryAnchor} onClose={() => setMemoryAnchor(null)} className="p-3">
                  <div className="mb-1 text-sm font-bold text-modiff-text">Peak node VRAM usage</div>
                  <MetricRow label="Last:">{formatMemory(node.data.memoryUsage?.last ?? 0)}</MetricRow>
                  <MetricRow label="Min:">{formatMemory(node.data.memoryUsage?.min ?? 0)}</MetricRow>
                  <MetricRow label="Max:">{formatMemory(node.data.memoryUsage?.max ?? 0)}</MetricRow>
                </NodePopover>
              )}
              <FooterMetricButton
                icon={<Clock3 size={14} />}
                title="Execution time"
                onClick={(event) => setExecutionTimeAnchor(anchorBelow(event.currentTarget))}
              >
                {node.data.executionTime?.last ? formatExecutionTime(node.data.executionTime.last) : '-'}
              </FooterMetricButton>
              {executionTimeAnchor && (
                <NodePopover anchor={executionTimeAnchor} onClose={() => setExecutionTimeAnchor(null)} className="p-3">
                  <div className="mb-1 text-sm font-bold text-modiff-text">Execution time</div>
                  <MetricRow label="Last:">
                    {node.data.executionTime?.last ? formatExecutionTime(node.data.executionTime.last) : '-'}
                  </MetricRow>
                  <MetricRow label="Min:">
                    {node.data.executionTime?.min ? formatExecutionTime(node.data.executionTime.min) : '-'}
                  </MetricRow>
                  <MetricRow label="Max:">
                    {node.data.executionTime?.max ? formatExecutionTime(node.data.executionTime.max) : '-'}
                  </MetricRow>
                </NodePopover>
              )}
            </div>

            {node.data.resizable && <NodeResizeGrip onMouseDown={onResizeStart} />}
          </div>
        </>
      )}
      <ErrorBoundary module={node.data.module || ''} action={node.data.action || ''}>
        <NodeContent
          nodeId={node.id}
          params={node.data.params}
          updateStore={handleUpdateStore}
          updateFieldActionStore={
            node.data.operationAuthoring && !node.data.blockProjectionOwnerId && !isClusterGraphProjection
              ? (_origin, param, value, key) => useFlowStore.getState().setParam(node.id, param, value, key)
              : undefined
          }
          module={node.data.module || ''}
          action={node.data.action || ''}
          mode="connectors"
          compactConnectors={isCollapsed}
          executionStatus={node.data.executionStatus}
          progressMessage={node.data.progressMessage}
        />
      </ErrorBoundary>
      {contextMenu && (
        <NodeContextMenu position={contextMenu} onClose={closeContextMenu}>
          <ContextMenuItem
            data-testid="node-menu-preview-branch"
            icon={<GitBranch size={15} />}
            onClick={handlePreviewBranch}
          >
            Preview branch
          </ContextMenuItem>
          <ContextMenuItem
            data-testid="node-menu-run-from-node"
            icon={<Play size={15} />}
            onClick={() => {
              void handleRunFromNode();
            }}
          >
            Run from node
          </ContextMenuItem>
          <ContextMenuItem
            data-testid="node-menu-duplicate"
            icon={<Files size={15} />}
            onClick={() => {
              closeContextMenu();
              duplicateNode(node.id);
            }}
          >
            Duplicate
          </ContextMenuItem>
          {isBlockProjection ? (
            <ContextMenuItem
              data-testid="node-menu-save-modular-subtree"
              icon={<Save size={15} />}
              onClick={() => {
                closeContextMenu();
                setSaveChoicesOpen(true);
              }}
            >
              Save Block changes
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem
            data-testid="node-menu-collapse-toggle"
            icon={isCollapsed ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
            onClick={() => {
              closeContextMenu();
              toggleNodeCollapsed(node.id);
              scheduleNodeLayoutSync();
            }}
          >
            {isCollapsed ? 'Expand' : 'Collapse'}
          </ContextMenuItem>
          <ContextMenuItem
            data-testid="node-menu-disable-toggle"
            icon={<Power size={15} />}
            onClick={() => {
              closeContextMenu();
              setNodeUiState(node.id, {
                disabled: !isDisabledForRun,
                validationSeverity: !isDisabledForRun ? 'warning' : undefined,
                validationMessage: !isDisabledForRun ? 'Disabled nodes are skipped during run export.' : undefined,
              });
            }}
          >
            {isDisabledForRun ? 'Enable for run' : 'Disable for run'}
          </ContextMenuItem>
          <ContextMenuItem
            data-testid="node-menu-reset-size"
            icon={<RefreshCcw size={15} />}
            onClick={() => {
              closeContextMenu();
              resetNodeSize(node.id);
              scheduleNodeLayoutSync();
            }}
          >
            Reset size
          </ContextMenuItem>
          <ContextMenuItem
            data-testid="node-menu-recompute"
            icon={<RefreshCcw size={15} />}
            onClick={() => {
              closeContextMenu();
              void handleRecompute();
            }}
          >
            Recompute on next Run
          </ContextMenuItem>
          <ContextMenuItem
            data-testid="node-menu-clear-cache"
            icon={<Circle size={15} />}
            onClick={() => {
              closeContextMenu();
              void handleClearCache();
            }}
          >
            Release node cache
          </ContextMenuItem>
          <ContextMenuDivider />
          <ContextMenuItem data-testid="node-menu-copy-info" icon={<Copy size={15} />} onClick={handleCopyNodeInfo}>
            Copy node info
          </ContextMenuItem>
          <ContextMenuItem
            data-testid="node-menu-inspect-issues"
            icon={<TriangleAlert size={15} />}
            onClick={() => {
              closeContextMenu();
              setNodeUiState(node.id, {
                validationSeverity: validationSeverity || 'info',
                validationMessage: validationMessage || 'No issues recorded for this node.',
              });
            }}
          >
            Inspect issues
          </ContextMenuItem>
          <ContextMenuDivider />
          <ContextMenuItem
            data-testid="node-menu-delete"
            icon={<Trash2 size={15} />}
            danger
            onClick={() => {
              closeContextMenu();
              removeNodes(node.id);
            }}
          >
            Delete
          </ContextMenuItem>
        </NodeContextMenu>
      )}
      {branchPreview && (
        <NodePopover anchor={branchPreview.anchor} onClose={() => setBranchPreview(null)} className="w-80 p-3">
          <div className="mb-2 text-sm font-bold text-modiff-text">Run branch preview</div>
          <p className="text-xs text-modiff-text">Target: {label}</p>
          <p className="text-xs text-modiff-subtle-text">Included nodes: {branchPreview.nodeIds.length}</p>
          <p className="text-xs text-modiff-subtle-text">
            Cached nodes that may be reused: {branchPreview.cachedNodeIds.length}
          </p>
          <div className="mt-2 max-h-28 overflow-auto border border-modiff-border bg-modiff-bg p-2">
            {branchPreview.nodeIds.map((id) => (
              <p
                key={id}
                className={cx(
                  'truncate text-xs',
                  branchPreview.cachedNodeIds.includes(id) ? 'text-modiff-green' : 'text-modiff-text',
                )}
              >
                {branchPreview.cachedNodeIds.includes(id) ? 'Cached' : 'Run'} | {id}
              </p>
            ))}
          </div>
          <ModiffButton
            tone="primary"
            size="dense"
            className="mt-2"
            icon={<Play size={15} />}
            onClick={() => {
              setBranchPreview(null);
              void handleRunFromNode();
            }}
          >
            Run selected branch
          </ModiffButton>
        </NodePopover>
      )}
      {saveChoicesOpen ? <BlockSaveDialogV2 nodeId={node.id} onClose={() => setSaveChoicesOpen(false)} /> : null}
    </CustomNodeFrame>
  );
});

function NodeProgress({
  progress = 0,
  executionStatus,
  executionProgress,
}: {
  progress?: number;
  executionStatus?: string;
  executionProgress?: ExecutionProgress;
}) {
  const indeterminate = progress < 0 || (executionStatus === 'running' && progress <= 0);
  const detail =
    executionProgressDetail(executionProgress) || (indeterminate ? 'Working; progress is not measurable yet.' : '');
  const progressBar = indeterminate ? (
    <div
      aria-label="Node is running; progress is not measurable yet."
      className="h-1 overflow-hidden bg-modiff-border-subtle"
      data-testid="node-progress-indeterminate"
      role="progressbar"
    >
      <div className="h-full w-1/4 animate-[modiff-progress-indeterminate_1.15s_ease-in-out_infinite] bg-hf-yellow" />
    </div>
  ) : (
    <ModiffProgress value={progress} className="h-1 rounded-none bg-modiff-border-subtle" />
  );
  if (!detail) return progressBar;
  return (
    <ModiffTooltip<HTMLDivElement> content={detail} placement="top">
      {(tooltipProps) => (
        <div
          {...tooltipProps}
          className="nodrag nowheel outline-none focus-visible:ring-1 focus-visible:ring-modiff-focus"
          role="group"
          aria-label={detail}
          tabIndex={0}
        >
          {progressBar}
        </div>
      )}
    </ModiffTooltip>
  );
}

function NodeProgressStatus({
  status,
  phase,
  message,
  progress = 0,
  executionProgress,
}: {
  status?: string;
  phase?: string;
  message?: string;
  progress?: number;
  executionProgress?: ExecutionProgress;
}) {
  const active = status === 'running' || progress < 0 || progress > 0;
  if (!active && !message && !status) return null;
  const detail =
    message ||
    (status === 'running' && phase ? phase.replace(/_/g, ' ') : null) ||
    (status === 'cached' ? 'Cached' : null) ||
    (status === 'completed' || status === 'succeeded' ? 'Completed' : null) ||
    (status === 'failed' ? 'Failed' : null) ||
    null;
  if (!detail) return null;
  const label =
    !active && message
      ? status === 'failed'
        ? 'Failed'
        : 'Issue recorded'
      : detail.length > 42
        ? `${detail.slice(0, 39).trimEnd()}...`
        : detail;
  const completeDetail = executionProgressDetail(executionProgress) || detail;
  return (
    <ModiffTooltip<HTMLSpanElement> content={completeDetail} placement="top">
      {(tooltipProps) => (
        <span
          {...tooltipProps}
          className="max-w-32 truncate rounded-modiff-compact bg-modiff-surface px-2 py-1 text-xs font-semibold capitalize text-modiff-subtle-text outline-none focus-visible:ring-1 focus-visible:ring-modiff-focus"
          role="status"
          tabIndex={0}
        >
          {label}
        </span>
      )}
    </ModiffTooltip>
  );
}

function NodePopover({
  anchor,
  children,
  className,
  onClose,
}: {
  anchor: PanelAnchor;
  children: ReactNode;
  className?: string;
  onClose: () => void;
}) {
  return (
    <ModiffPopover
      anchor={anchor}
      ariaLabel="Node details"
      closeOnOutside={false}
      gap={0}
      modal
      onClose={onClose}
      open
      panelClassName={className}
      placement="bottom-start"
    >
      {children}
    </ModiffPopover>
  );
}

function FooterMetricButton({
  children,
  icon,
  onClick,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  title: string;
}) {
  return (
    <ModiffButton
      size="compact"
      tone="ghost"
      title={title}
      icon={icon}
      className="nodrag min-w-0 border border-modiff-border px-2 text-xs text-modiff-text"
      onClick={onClick}
    >
      {children}
    </ModiffButton>
  );
}

function MetricRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex gap-2 text-sm text-modiff-text">
      <span className="w-14 text-modiff-subtle-text">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function NodeContextMenu({
  children,
  onClose,
  position,
}: {
  children: ReactNode;
  onClose: () => void;
  position: { mouseX: number; mouseY: number };
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
    if (items.length === 0) return;
    const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex]?.focus();
    }
  };

  return (
    <ModiffPopover
      anchor={{ left: position.mouseX, top: position.mouseY }}
      ariaLabel="Node actions"
      closeOnOutside={false}
      gap={0}
      modal
      onClose={onClose}
      open
      panelClassName="min-w-44 p-1"
      placement="bottom-start"
      role="menu"
    >
      <div ref={menuRef} onKeyDown={handleKeyDown}>
        {children}
      </div>
    </ModiffPopover>
  );
}

function ContextMenuItem({ ...props }: GraphMenuActionProps) {
  return <GraphMenuAction {...props} />;
}

function ContextMenuDivider() {
  return <SharedGraphMenuDivider />;
}

export default CustomNode;
