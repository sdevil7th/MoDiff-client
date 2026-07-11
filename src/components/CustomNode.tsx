import { NodeProps, useStoreApi } from '@xyflow/react';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Circle,
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
import { AnchoredPanel, CustomNodeFrame, CustomNodeHeaderFrame, ModiffProgress } from '../ui';
import { cx } from '../utils/classNames';
import ErrorBoundary from './ErrorBoundary';
import NodeContent from './NodeContent';
import { enqueueSnackbar } from '../ui/snackbar';
import { deleteNodeCache } from '../utils/serverActions';

const MAX_NODE_WIDTH = modiffLayout.maxNodeWidth;
const MAX_NODE_HEIGHT = modiffLayout.maxNodeHeight;

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
  const label = node.data.label || `${node.data.module} ${node.data.action}`;
  const setParam = useFlowStore((state) => state.setParam);
  const setNodeSize = useFlowStore((state) => state.setNodeSize);
  const beginHistoryTransaction = useFlowStore((state) => state.beginHistoryTransaction);
  const commitHistoryTransaction = useFlowStore((state) => state.commitHistoryTransaction);
  const setNodeCached = useFlowStore((state) => state.setNodeCached);
  const removeNodes = useFlowStore((state) => state.removeNodes);
  const duplicateNode = useFlowStore((state) => state.duplicateNode);
  const toggleNodeCollapsed = useFlowStore((state) => state.toggleNodeCollapsed);
  const resetNodeSize = useFlowStore((state) => state.resetNodeSize);
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
  const sid = useWebsocketStore((state) => state.sid);
  const isConnected = useWebsocketStore((state) => state.isConnected);
  const reactFlowStore = useStoreApi();
  const scheduleNodeLayoutSync = useNodeLayoutSync(node.id, nodeRef);
  const validationSeverity = node.data.uiState?.validationSeverity;
  const validationMessage = node.data.uiState?.validationMessage || node.data.uiState?.errorMessage;
  const recentChangeLabel = node.data.uiState?.recentChangeLabel;
  const isError = validationSeverity === 'error';
  const isCollapsed = Boolean(node.data.uiState?.collapsed || node.data.minimized);
  const isDisabledForRun = Boolean(node.data.uiState?.disabled);

  const handleUpdateStore = useCallback(
    (param: string, value: unknown, key?: keyof NodeParams) => {
      setParam(node.id, param, value, key);

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

  const handleClearCache = useCallback(async () => {
    try {
      await deleteNodeCache([node.id]);
      setNodeCached(node.id, false);
      enqueueSnackbar('Cache cleared', { variant: 'success', autoHideDuration: 1500 });
    } catch (error) {
      console.error('Failed to delete cache', error);
    }
  }, [node.id, setNodeCached]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setContextMenu(contextMenuAnchor(event));
  }, []);

  const handleRunFromNode = useCallback(async () => {
    closeContextMenu();
    const validation = validateCurrentRun({ sid, isConnected, includeStudio: false });
    if (!validation.canRun || !sid) return;
    await coordinateGraphRun({ sid, targetNodeId: node.id });
  }, [closeContextMenu, isConnected, node.id, sid]);

  const handlePreviewBranch = useCallback(() => {
    const validation = validateCurrentRun({ sid, isConnected, includeStudio: false, showDialog: false });
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

  const onResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      beginHistoryTransaction('Resize node');
      const initialWidth = nodeRef.current?.clientWidth || node.width || 0;
      const initialHeight = nodeRef.current?.clientHeight || node.height || 0;
      const startX = event.clientX;
      const startY = event.clientY;
      const zoomLevel = reactFlowStore.getState().transform[2];

      const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const newWidth = Math.min(MAX_NODE_WIDTH, initialWidth + Math.round((moveEvent.clientX - startX) / zoomLevel));
        const newHeight = Math.min(
          MAX_NODE_HEIGHT,
          initialHeight + Math.round((moveEvent.clientY - startY) / zoomLevel),
        );
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
      testId={`graph-node-action-${node.data.action}`}
      className={cx(
        normalizeDataType(`${node.data.module}_${node.data.action}`),
        normalizeDataType(node.data.module),
        dataTypeClass(node.data.category),
        isDisabledForRun && 'opacity-60',
        recentChangeLabel && 'outline-hf-yellow border-hf-yellow shadow-modiff-panel',
      )}
      nodeStyle={style}
      maxWidth={MAX_NODE_WIDTH}
      maxHeight={MAX_NODE_HEIGHT}
      isError={isError}
      onContextMenu={handleContextMenu}
    >
      <CustomNodeHeaderFrame headerColor={node.data.headerColor}>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{label}</span>
          {isDisabledForRun && <span className="block truncate text-xs text-hf-orange">Disabled for run export</span>}
          {recentChangeLabel && <span className="block truncate text-xs text-hf-yellow">{recentChangeLabel}</span>}
        </div>
        <div className="nodrag flex items-center gap-1">
          {validationMessage && (
            <>
              <button
                type="button"
                className={cx(
                  'grid size-7 place-items-center rounded-modiff-compact transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
                  isError ? 'text-modiff-red' : 'text-hf-orange',
                )}
                onClick={(event) => setIssueAnchor(anchorBeside(event.currentTarget))}
                title={validationMessage}
                aria-label={isError ? 'Node error details' : 'Node warning details'}
              >
                <TriangleAlert size={16} />
              </button>
              {issueAnchor && (
                <NodePopover anchor={issueAnchor} onClose={() => setIssueAnchor(null)} className="max-w-[420px] p-3">
                  <div className={cx('mb-1 text-sm font-bold', isError ? 'text-modiff-red' : 'text-hf-orange')}>
                    {isError ? 'Node error' : 'Node warning'}
                  </div>
                  <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-gray-300">
                    {validationMessage}
                  </p>
                </NodePopover>
              )}
            </>
          )}
          <button
            type="button"
            className="grid size-7 place-items-center rounded-modiff-compact text-gray-200 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
            onClick={(event) => setHelpAnchor(anchorBeside(event.currentTarget))}
            aria-label="Node help"
          >
            <CircleHelp size={16} />
          </button>
          {helpAnchor && (
            <NodePopover anchor={helpAnchor} onClose={() => setHelpAnchor(null)} className="max-w-[480px] p-3">
              <div className="text-base font-bold text-modiff-text">{label}</div>
              {node.data.description && <div className="mt-1 text-sm text-gray-300">{node.data.description}</div>}
              {Object.entries(node.data.params).map(([key, param]) =>
                param.description ? (
                  <div key={key} className="mt-1 text-sm text-gray-300">
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
        <div className="relative flex min-h-24 w-full flex-1 items-center justify-center bg-modiff-surface px-8 py-4 text-gray-400">
          <ErrorBoundary module={node.data.module || ''} action={node.data.action || ''}>
            <NodeContent
              nodeId={node.id}
              params={node.data.params}
              updateStore={handleUpdateStore}
              module={node.data.module || ''}
              action={node.data.action || ''}
              groupHandles
              handlesOnly
              compactHandles
              executionStatus={node.data.executionStatus}
              progressMessage={node.data.progressMessage}
            />
          </ErrorBoundary>
          <span className="truncate text-xs font-semibold text-modiff-muted">Collapsed</span>
        </div>
      ) : (
        <>
          <div
            className={cx(
              'nowheel flex min-h-0 w-full flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto bg-modiff-surface p-3 pb-2 text-modiff-text',
              node.height && node.height > 360
                ? '[&_.modiff-textarea-field]:min-h-40'
                : '[&_.modiff-textarea-field]:min-h-[110px]',
            )}
          >
            <ErrorBoundary module={node.data.module || ''} action={node.data.action || ''}>
              <NodeContent
                nodeId={node.id}
                params={node.data.params}
                updateStore={handleUpdateStore}
                module={node.data.module || ''}
                action={node.data.action || ''}
                executionStatus={node.data.executionStatus}
                progressMessage={node.data.progressMessage}
              />
            </ErrorBoundary>
          </div>

          <div className="relative w-full shrink-0 bg-modiff-bg text-gray-400">
            <NodeProgress progress={node.data.progress} />
            <div className="flex items-center gap-2 p-1 pr-6">
              <button
                type="button"
                className="nodrag grid size-7 place-items-center rounded-modiff-compact text-gray-500 transition hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
                disabled={!node.data.isCached}
                title={node.data.isCached ? 'Click to clear cache' : 'Not cached'}
                onClick={() => {
                  void handleClearCache();
                }}
              >
                <Circle
                  size={14}
                  className={node.data.isCached ? 'fill-modiff-green text-modiff-green' : 'fill-gray-600 text-gray-600'}
                />
              </button>
              <NodeProgressStatus
                status={node.data.executionStatus}
                phase={node.data.executionPhase}
                message={node.data.progressMessage}
                progress={node.data.progress}
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

            {node.data.resizable && (
              <div
                className="nodrag absolute bottom-0 right-0 z-[9999] h-[26px] w-[26px] cursor-se-resize border-4 border-transparent border-b-gray-500 border-r-gray-500 leading-none hover:border-b-hf-yellow hover:border-r-hf-yellow hover:bg-white/10"
                onMouseDown={onResizeStart}
              />
            )}
          </div>
        </>
      )}
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
            data-testid="node-menu-clear-cache"
            icon={<Circle size={15} />}
            onClick={() => {
              closeContextMenu();
              void handleClearCache();
            }}
          >
            Clear cache
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
          <p className="text-xs text-gray-300">Target: {label}</p>
          <p className="text-xs text-gray-400">Included nodes: {branchPreview.nodeIds.length}</p>
          <p className="text-xs text-gray-400">Cached nodes that may be reused: {branchPreview.cachedNodeIds.length}</p>
          <div className="mt-2 max-h-28 overflow-auto border border-modiff-border bg-modiff-bg p-2">
            {branchPreview.nodeIds.map((id) => (
              <p
                key={id}
                className={cx(
                  'truncate text-xs',
                  branchPreview.cachedNodeIds.includes(id) ? 'text-modiff-green' : 'text-gray-300',
                )}
              >
                {branchPreview.cachedNodeIds.includes(id) ? 'Cached' : 'Run'} | {id}
              </p>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-modiff-compact bg-hf-yellow px-3 text-sm font-semibold text-black transition hover:bg-hf-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
            onClick={() => {
              setBranchPreview(null);
              void handleRunFromNode();
            }}
          >
            <Play size={15} />
            Run selected branch
          </button>
        </NodePopover>
      )}
    </CustomNodeFrame>
  );
});

function NodeProgress({ progress = 0 }: { progress?: number }) {
  if (progress < 0) {
    return (
      <div className="h-1 overflow-hidden bg-white/10">
        <div className="h-full w-1/4 animate-[modiff-progress-indeterminate_1.15s_ease-in-out_infinite] bg-hf-yellow" />
      </div>
    );
  }

  return <ModiffProgress value={progress} className="h-1 rounded-none bg-white/10" />;
}

function NodeProgressStatus({
  status,
  phase,
  message,
  progress = 0,
}: {
  status?: string;
  phase?: string;
  message?: string;
  progress?: number;
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
  return (
    <span
      className="max-w-32 truncate rounded-modiff-compact bg-modiff-surface px-2 py-1 text-xs font-semibold capitalize text-modiff-muted"
      title={detail}
    >
      {label}
    </span>
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
  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        onClick={onClose}
        aria-label="Close popover"
      />
      <AnchoredPanel
        anchor={anchor}
        className={cx(
          'rounded-modiff-panel border border-modiff-border bg-modiff-surface shadow-modiff-node',
          className,
        )}
      >
        {children}
      </AnchoredPanel>
    </>,
    document.body,
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
    <button
      type="button"
      title={title}
      className="nodrag inline-flex h-7 min-w-0 items-center gap-1 rounded-modiff-compact border border-modiff-border px-2 text-xs font-semibold text-gray-300 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

function MetricRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex gap-2 text-sm text-gray-300">
      <span className="w-14 text-gray-400">{label}</span>
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
  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        onClick={onClose}
        aria-label="Close node menu"
      />
      <AnchoredPanel
        anchor={{ left: position.mouseX, top: position.mouseY }}
        className="min-w-44 rounded-modiff-panel border border-modiff-border bg-modiff-surface p-1 shadow-modiff-node"
      >
        {children}
      </AnchoredPanel>
    </>,
    document.body,
  );
}

function ContextMenuItem({
  children,
  danger = false,
  icon,
  onClick,
  ...props
}: {
  children: ReactNode;
  danger?: boolean;
  icon: ReactNode;
  onClick: () => void;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        'flex w-full items-center gap-2 rounded-modiff-compact px-2 py-1.5 text-left text-sm transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
        danger ? 'text-modiff-red hover:text-modiff-red' : 'text-gray-200 hover:text-white',
      )}
      onClick={onClick}
      {...props}
    >
      <span className="grid size-4 place-items-center">{icon}</span>
      {children}
    </button>
  );
}

function ContextMenuDivider() {
  return <div className="my-1 border-t border-modiff-border" />;
}

export default CustomNode;
