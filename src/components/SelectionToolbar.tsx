import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import {
  Blocks,
  Circle,
  Copy,
  EllipsisVertical,
  Files,
  Maximize2,
  Minimize2,
  Play,
  Power,
  RefreshCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { validateCurrentRun } from '../studio/runReadiness';
import { cx } from '../utils/classNames';
import { enqueueSnackbar } from '../ui/snackbar';
import { deleteNodeCache } from '../utils/serverActions';

const TOOLBAR_MARGIN = 8;
const TOOLBAR_SELECTION_GAP = 12;

type SelectionToolbarProps = {
  canvasSuspended: boolean;
  createBlockDisabledReason?: string | null;
  nodes: CustomNodeType[];
  onCreateBlockFromSelection: () => void;
  selectionDragging: boolean;
};

type ToolbarActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  children: ReactNode;
  danger?: boolean;
  label: string;
};

function ToolbarActionButton({
  active = false,
  children,
  className,
  danger = false,
  disabled = false,
  label,
  onClick,
  type = 'button',
  ...props
}: ToolbarActionButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-disabled={disabled}
      data-tooltip={label}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cx(
        'relative grid size-8 place-items-center rounded-modiff-compact text-gray-300 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
        'after:pointer-events-none after:absolute after:left-1/2 after:top-[calc(100%+6px)] after:z-50 after:-translate-x-1/2 after:whitespace-nowrap after:rounded-modiff-compact after:border after:border-modiff-border after:bg-modiff-bg after:px-2 after:py-1 after:text-xs after:font-semibold after:text-modiff-text after:opacity-0 after:shadow-modiff-panel after:transition-opacity after:delay-75 after:content-[attr(data-tooltip)] hover:after:opacity-100 focus-visible:after:opacity-100',
        'hover:bg-white/10 hover:text-white',
        active && !disabled && 'bg-hf-yellow text-black hover:bg-hf-yellow hover:text-black',
        danger && !disabled && 'text-modiff-red hover:bg-modiff-red/10 hover:text-modiff-red',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-gray-300',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-0.5 h-6 w-px bg-modiff-border" aria-hidden="true" />;
}

type MoreMenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  danger?: boolean;
  icon: ReactNode;
};

function MoreMenuItem({ children, className, danger = false, icon, type = 'button', ...props }: MoreMenuItemProps) {
  return (
    <button
      type={type}
      className={cx(
        'flex h-8 w-full items-center gap-2 px-2 text-left text-sm font-semibold text-gray-300 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:bg-white/10 focus-visible:outline-none',
        danger && 'text-modiff-red hover:bg-modiff-red/10 hover:text-modiff-red',
        className,
      )}
      {...props}
    >
      <span className="grid size-4 place-items-center">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  );
}

export function SelectionToolbar({
  canvasSuspended,
  createBlockDisabledReason,
  nodes,
  onCreateBlockFromSelection,
  selectionDragging,
}: SelectionToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [positioned, setPositioned] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const viewport = useViewport();
  const { flowToScreenPosition, getNodesBounds } = useReactFlow<CustomNodeType>();
  const sid = useWebsocketStore((state) => state.sid);
  const isConnected = useWebsocketStore((state) => state.isConnected);
  const removeNodes = useFlowStore((state) => state.removeNodes);
  const duplicateNode = useFlowStore((state) => state.duplicateNode);
  const toggleNodeCollapsed = useFlowStore((state) => state.toggleNodeCollapsed);
  const setNodeUiState = useFlowStore((state) => state.setNodeUiState);
  const resetNodeSize = useFlowStore((state) => state.resetNodeSize);
  const setNodeCached = useFlowStore((state) => state.setNodeCached);

  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedActionNodes = useMemo(
    () => selectedNodes.filter((node) => node.data.type !== 'group'),
    [selectedNodes],
  );
  const singleNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const singleActionNode = singleNode?.data.type !== 'group' ? singleNode : null;
  const isCollapsed = Boolean(singleActionNode?.data.uiState?.collapsed || singleActionNode?.data.minimized);
  const isDisabledForRun = Boolean(singleActionNode?.data.uiState?.disabled);
  const validationMessage =
    singleActionNode?.data.uiState?.validationMessage || singleActionNode?.data.uiState?.errorMessage;
  const showSingleNodeActions = Boolean(singleActionNode);
  const showCollapseToggle = singleActionNode?.data.type === 'custom';
  const showCreateBlock = selectedActionNodes.length > 0;
  const createBlockUnavailable = Boolean(createBlockDisabledReason);
  const visible =
    !canvasSuspended && !selectionDragging && selectedNodes.length > 0 && (showSingleNodeActions || showCreateBlock);

  useEffect(() => {
    const handleResize = () => setLayoutRevision((revision) => revision + 1);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!visible || !toolbar) {
      setPositioned(false);
      return;
    }

    const bounds = getNodesBounds(selectedNodes);
    const selectionCenterX = bounds.x + bounds.width / 2;
    const topAnchor = flowToScreenPosition({ x: selectionCenterX, y: bounds.y });
    const bottomAnchor = flowToScreenPosition({ x: selectionCenterX, y: bounds.y + bounds.height });
    const toolbarWidth = toolbar.offsetWidth;
    const toolbarHeight = toolbar.offsetHeight;
    const maxLeft = window.innerWidth - toolbarWidth - TOOLBAR_MARGIN;
    const maxTop = window.innerHeight - toolbarHeight - TOOLBAR_MARGIN;
    let left = topAnchor.x - toolbarWidth / 2;
    let top = topAnchor.y - toolbarHeight - TOOLBAR_SELECTION_GAP;

    if (top < TOOLBAR_MARGIN) {
      top = bottomAnchor.y + TOOLBAR_SELECTION_GAP;
    }

    left = Math.max(TOOLBAR_MARGIN, Math.min(left, maxLeft));
    top = Math.max(TOOLBAR_MARGIN, Math.min(top, maxTop));

    toolbar.style.setProperty('--modiff-selection-toolbar-x', `${Math.round(left)}px`);
    toolbar.style.setProperty('--modiff-selection-toolbar-y', `${Math.round(top)}px`);
    setPositioned(true);
  }, [
    flowToScreenPosition,
    getNodesBounds,
    layoutRevision,
    moreOpen,
    selectedNodes,
    viewport.x,
    viewport.y,
    viewport.zoom,
    visible,
  ]);

  useEffect(() => {
    if (!moreOpen) return;

    const closeOnOutsideInteraction = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && toolbarRef.current?.contains(target)) return;
      setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!visible) {
      setMoreOpen(false);
    }
  }, [visible]);

  const closeMore = useCallback(() => setMoreOpen(false), []);

  const handleDeleteSelection = useCallback(() => {
    closeMore();
    removeNodes(selectedNodes.map((node) => node.id));
  }, [closeMore, removeNodes, selectedNodes]);

  const handleDuplicateNode = useCallback(() => {
    if (!singleActionNode) return;
    duplicateNode(singleActionNode.id);
  }, [duplicateNode, singleActionNode]);

  const handleRunFromNode = useCallback(async () => {
    if (!singleActionNode) return;
    const validation = validateCurrentRun({ sid, isConnected, includeStudio: false });
    if (!validation.canRun || !sid) return;
    await coordinateGraphRun({ sid, targetNodeId: singleActionNode.id });
  }, [isConnected, sid, singleActionNode]);

  const handleToggleCollapse = useCallback(() => {
    if (!singleActionNode) return;
    toggleNodeCollapsed(singleActionNode.id);
  }, [singleActionNode, toggleNodeCollapsed]);

  const handleToggleDisabled = useCallback(() => {
    if (!singleActionNode) return;
    closeMore();
    setNodeUiState(singleActionNode.id, {
      disabled: !isDisabledForRun,
      validationSeverity: !isDisabledForRun ? 'warning' : undefined,
      validationMessage: !isDisabledForRun ? 'Disabled nodes are skipped during run export.' : undefined,
    });
  }, [closeMore, isDisabledForRun, setNodeUiState, singleActionNode]);

  const handleResetSize = useCallback(() => {
    if (!singleActionNode) return;
    closeMore();
    resetNodeSize(singleActionNode.id);
  }, [closeMore, resetNodeSize, singleActionNode]);

  const handleClearCache = useCallback(async () => {
    if (!singleActionNode) return;
    closeMore();

    try {
      await deleteNodeCache([singleActionNode.id]);
      setNodeCached(singleActionNode.id, false);
      enqueueSnackbar('Cache cleared', { variant: 'success', autoHideDuration: 1500 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 2600 });
    }
  }, [closeMore, setNodeCached, singleActionNode]);

  const handleCopyNodeInfo = useCallback(() => {
    if (!singleActionNode) return;
    closeMore();
    void navigator.clipboard
      .writeText(`${singleActionNode.id}\n${singleActionNode.data.module}.${singleActionNode.data.action}`)
      .then(() => enqueueSnackbar('Node info copied', { variant: 'success', autoHideDuration: 1600 }))
      .catch((error: unknown) => enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 2600 }));
  }, [closeMore, singleActionNode]);

  const handleInspectIssues = useCallback(() => {
    closeMore();
    enqueueSnackbar(validationMessage || 'No issues recorded for this node.', {
      variant: validationMessage ? 'error' : 'default',
      autoHideDuration: validationMessage ? 4200 : 2200,
    });
  }, [closeMore, validationMessage]);

  if (!visible) {
    return null;
  }

  return (
    <div
      ref={toolbarRef}
      className={cx(
        'nodrag nowheel fixed left-0 top-0 z-40 flex h-10 items-center gap-1 rounded-modiff-panel border border-modiff-border bg-modiff-panel p-1 shadow-modiff-node transition-opacity translate-x-[var(--modiff-selection-toolbar-x)] translate-y-[var(--modiff-selection-toolbar-y)]',
        positioned ? 'opacity-100' : 'opacity-0',
      )}
      data-testid="selection-toolbar"
      role="toolbar"
      aria-label="Selection toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <ToolbarActionButton
        label="Delete selection"
        danger
        onClick={handleDeleteSelection}
        data-testid="selection-toolbar-delete"
      >
        <Trash2 size={16} />
      </ToolbarActionButton>

      {showSingleNodeActions && (
        <>
          <ToolbarDivider />
          <ToolbarActionButton
            label="Duplicate node"
            onClick={handleDuplicateNode}
            data-testid="selection-toolbar-duplicate"
          >
            <Files size={16} />
          </ToolbarActionButton>
          <ToolbarActionButton
            label="Run from node"
            onClick={() => {
              void handleRunFromNode();
            }}
            data-testid="selection-toolbar-run-from-node"
          >
            <Play size={16} />
          </ToolbarActionButton>
          {showCollapseToggle && (
            <ToolbarActionButton
              label={isCollapsed ? 'Expand node' : 'Collapse node'}
              onClick={handleToggleCollapse}
              data-testid="selection-toolbar-collapse"
            >
              {isCollapsed ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
            </ToolbarActionButton>
          )}
        </>
      )}

      {showCreateBlock && (
        <>
          <ToolbarDivider />
          <ToolbarActionButton
            label={createBlockDisabledReason || 'Create block from selection'}
            active
            disabled={createBlockUnavailable}
            onClick={onCreateBlockFromSelection}
            data-testid="selection-toolbar-create-block"
          >
            <Blocks size={17} />
          </ToolbarActionButton>
        </>
      )}

      {showSingleNodeActions && (
        <>
          <ToolbarDivider />
          <div className="relative">
            <ToolbarActionButton
              label="More node actions"
              active={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
              data-testid="selection-toolbar-more"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
            >
              <EllipsisVertical size={16} />
            </ToolbarActionButton>
            {moreOpen && singleActionNode && (
              <div
                className="absolute right-0 top-full z-50 mt-2 w-52 border border-modiff-border bg-modiff-surface p-1 shadow-modiff-panel"
                role="menu"
                data-testid="selection-toolbar-more-menu"
              >
                <MoreMenuItem icon={<Power size={15} />} onClick={handleToggleDisabled} role="menuitem">
                  {isDisabledForRun ? 'Enable for run' : 'Disable for run'}
                </MoreMenuItem>
                <MoreMenuItem
                  icon={<Circle size={15} />}
                  disabled={!singleActionNode.data.isCached}
                  onClick={() => {
                    void handleClearCache();
                  }}
                  role="menuitem"
                >
                  Clear cache
                </MoreMenuItem>
                <MoreMenuItem
                  icon={<RefreshCcw size={15} />}
                  disabled={singleActionNode.width === undefined && singleActionNode.height === undefined}
                  onClick={handleResetSize}
                  role="menuitem"
                >
                  Reset size
                </MoreMenuItem>
                <MoreMenuItem icon={<Copy size={15} />} onClick={handleCopyNodeInfo} role="menuitem">
                  Copy node info
                </MoreMenuItem>
                <MoreMenuItem icon={<TriangleAlert size={15} />} onClick={handleInspectIssues} role="menuitem">
                  Inspect issues
                </MoreMenuItem>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
