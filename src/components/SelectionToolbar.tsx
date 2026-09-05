import {
  forwardRef,
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
  Repeat2,
  Save,
  Trash2,
  TriangleAlert,
  Ungroup,
} from 'lucide-react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { isUserBlockExpandedInstance } from '../studio/userBlocks';
import { isHuggingFaceClusterExpanded } from '../studio/huggingFaceClusterGraph';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { prepareHuggingFaceClustersForRun } from '../studio/huggingFaceClusterPreparation';
import { validateCurrentRun } from '../studio/runReadiness';
import { cx } from '../utils/classNames';
import { enqueueSnackbar } from '../ui/snackbar';
import { GraphIconButton } from '../ui/GraphControls';
import { ModiffMenuAction, ModiffMenuRoot, ModiffMenuSurface, ModiffMenuTrigger } from '../ui';
import { deleteNodeCache } from '../utils/serverActions';
import BlockSaveDialogV2 from './BlockSaveDialogV2';

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

const ToolbarActionButton = forwardRef<HTMLButtonElement, ToolbarActionButtonProps>(function ToolbarActionButton(
  { active = false, children, className, danger = false, disabled = false, label, onClick, type = 'button', ...props },
  ref,
) {
  return (
    <GraphIconButton
      ref={ref}
      type={type}
      label={label}
      size="dense"
      active={active && !disabled}
      tone={danger && !disabled ? 'danger' : 'ghost'}
      aria-disabled={disabled}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cx(disabled && 'cursor-not-allowed opacity-40', className)}
      {...props}
    >
      {children}
    </GraphIconButton>
  );
});

function ToolbarDivider() {
  return <span className="mx-0.5 h-6 w-px bg-modiff-border" aria-hidden="true" />;
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
  const [layoutRevision, setLayoutRevision] = useState(0);
  const viewport = useViewport();
  const { flowToScreenPosition, getNodesBounds } = useReactFlow<CustomNodeType>();
  const [saveNodeId, setSaveNodeId] = useState<string | null>(null);
  const sid = useWebsocketStore((state) => state.sid);
  const isConnected = useWebsocketStore((state) => state.isConnected);
  const removeNodes = useFlowStore((state) => state.removeNodes);
  const duplicateNode = useFlowStore((state) => state.duplicateNode);
  const toggleNodeCollapsed = useFlowStore((state) => state.toggleNodeCollapsed);
  const toggleUserBlockExpanded = useFlowStore((state) => state.toggleUserBlockExpanded);
  const toggleHuggingFaceClusterExpanded = useFlowStore((state) => state.toggleHuggingFaceClusterExpanded);
  const toggleBlockContainerExpandedV2 = useFlowStore((state) => state.toggleBlockContainerExpandedV2);
  const setNodeUiState = useFlowStore((state) => state.setNodeUiState);
  const resetNodeSize = useFlowStore((state) => state.resetNodeSize);
  const loopNodes = useFlowStore((state) => state.loopNodes);
  const ungroupNodes = useFlowStore((state) => state.ungroupNodes);
  const setNodeCached = useFlowStore((state) => state.setNodeCached);

  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedActionNodes = useMemo(
    () => selectedNodes.filter((node) => node.data.type !== 'group' && node.data.type !== 'loop'),
    [selectedNodes],
  );
  const singleNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const singleContainer = singleNode?.data.type === 'group' || singleNode?.data.type === 'loop' ? singleNode : null;
  const singleProjectedModular =
    singleNode?.data.blockProjectionKind === 'internal' &&
    singleNode.data.blockProjectionModular === true &&
    singleNode.data.blockProjectionOwnerId &&
    singleNode.data.blockProjectionNodeId
      ? singleNode
      : null;
  const singleActionNode =
    !singleProjectedModular && singleNode?.data.type !== 'group' && singleNode?.data.type !== 'loop'
      ? singleNode
      : null;
  const isUserBlock = singleActionNode?.data.type === 'block';
  const isHuggingFaceCluster = singleActionNode?.data.huggingFaceClusterRole === 'root';
  const isCompositeNode = Boolean(isUserBlock || isHuggingFaceCluster);
  const isCompositeExpanded =
    Boolean(singleActionNode?.data.blockInstanceV2?.presentation.expanded) ||
    Boolean(
      isUserBlock && singleActionNode && isUserBlockExpandedInstance({ nodes, edges: [] }, singleActionNode.id),
    ) ||
    Boolean(
      isHuggingFaceCluster &&
      singleActionNode &&
      isHuggingFaceClusterExpanded({ nodes, edges: [] }, singleActionNode.id),
    );
  const isCollapsed = Boolean(singleActionNode?.data.uiState?.collapsed || singleActionNode?.data.minimized);
  const isDisabledForRun = Boolean(singleActionNode?.data.uiState?.disabled);
  const validationMessage =
    singleActionNode?.data.uiState?.validationMessage || singleActionNode?.data.uiState?.errorMessage;
  const showSingleNodeActions = Boolean(singleActionNode);
  const showCollapseToggle = singleActionNode?.data.type === 'custom' || isCompositeNode;
  const showCreateBlock =
    selectedActionNodes.length > 0 &&
    !singleProjectedModular &&
    !(
      selectedActionNodes.length === 1 &&
      (selectedActionNodes[0]?.data.type === 'block' || selectedActionNodes[0]?.data.huggingFaceClusterRole === 'root')
    );
  const createBlockUnavailable = Boolean(createBlockDisabledReason);
  const visible =
    !canvasSuspended &&
    !selectionDragging &&
    selectedNodes.length > 0 &&
    (showSingleNodeActions || showCreateBlock || Boolean(singleContainer) || Boolean(singleProjectedModular));

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
    const canvasBounds = toolbar.parentElement?.getBoundingClientRect();
    const minLeft = (canvasBounds?.left ?? 0) + TOOLBAR_MARGIN;
    const minTop = (canvasBounds?.top ?? 0) + TOOLBAR_MARGIN;
    const maxLeft = Math.max(minLeft, (canvasBounds?.right ?? window.innerWidth) - toolbarWidth - TOOLBAR_MARGIN);
    const maxTop = Math.max(minTop, (canvasBounds?.bottom ?? window.innerHeight) - toolbarHeight - TOOLBAR_MARGIN);
    let left = topAnchor.x - toolbarWidth / 2;
    let top = topAnchor.y - toolbarHeight - TOOLBAR_SELECTION_GAP;

    if (top < minTop) {
      top = bottomAnchor.y + TOOLBAR_SELECTION_GAP;
    }

    left = Math.max(minLeft, Math.min(left, maxLeft));
    top = Math.max(minTop, Math.min(top, maxTop));

    toolbar.style.setProperty('--modiff-selection-toolbar-x', `${Math.round(left)}px`);
    toolbar.style.setProperty('--modiff-selection-toolbar-y', `${Math.round(top)}px`);
    setPositioned(true);
  }, [
    flowToScreenPosition,
    getNodesBounds,
    layoutRevision,
    selectedNodes,
    viewport.x,
    viewport.y,
    viewport.zoom,
    visible,
  ]);

  const handleDeleteSelection = useCallback(() => {
    removeNodes(selectedNodes.map((node) => node.id));
  }, [removeNodes, selectedNodes]);

  const handleCreateLoop = useCallback(() => {
    loopNodes(selectedActionNodes.map((node) => node.id));
  }, [loopNodes, selectedActionNodes]);

  const handleUngroup = useCallback(() => {
    if (singleContainer) ungroupNodes(singleContainer.id);
  }, [singleContainer, ungroupNodes]);

  const handleToggleProjectedContainer = useCallback(() => {
    if (
      !singleProjectedModular?.data.blockProjectionContainer ||
      !singleProjectedModular.data.blockProjectionOwnerId ||
      !singleProjectedModular.data.blockProjectionNodeId
    )
      return;
    toggleBlockContainerExpandedV2(
      singleProjectedModular.data.blockProjectionOwnerId,
      singleProjectedModular.data.blockProjectionNodeId,
    );
    useStudioStore.getState().saveActiveWorkflowTab(true);
  }, [singleProjectedModular, toggleBlockContainerExpandedV2]);

  const handleDuplicateNode = useCallback(() => {
    if (!singleActionNode) return;
    duplicateNode(singleActionNode.id);
  }, [duplicateNode, singleActionNode]);

  const handleRunFromNode = useCallback(async () => {
    if (!singleActionNode) return;
    if (singleActionNode.data.huggingFaceClusterRole === 'root' || singleActionNode.data.blockInstanceV2) {
      await prepareHuggingFaceClustersForRun([singleActionNode.id]);
    }
    const validation = validateCurrentRun({ sid, isConnected, includeStudio: false });
    if (!validation.canRun || !sid) return;
    await coordinateGraphRun({ sid, targetNodeId: singleActionNode.id });
  }, [isConnected, sid, singleActionNode]);

  const handleToggleCollapse = useCallback(() => {
    if (!singleActionNode) return;
    if (singleActionNode.data.type === 'block') {
      toggleUserBlockExpanded(singleActionNode.id);
      useStudioStore.getState().saveActiveWorkflowTab(true);
    } else if (singleActionNode.data.huggingFaceClusterRole === 'root') {
      toggleHuggingFaceClusterExpanded(singleActionNode.id);
      useStudioStore.getState().saveActiveWorkflowTab(true);
    } else {
      toggleNodeCollapsed(singleActionNode.id);
    }
  }, [singleActionNode, toggleHuggingFaceClusterExpanded, toggleNodeCollapsed, toggleUserBlockExpanded]);

  const handleToggleDisabled = useCallback(() => {
    if (!singleActionNode) return;
    setNodeUiState(singleActionNode.id, {
      disabled: !isDisabledForRun,
      validationSeverity: !isDisabledForRun ? 'warning' : undefined,
      validationMessage: !isDisabledForRun ? 'Disabled nodes are skipped during run export.' : undefined,
    });
  }, [isDisabledForRun, setNodeUiState, singleActionNode]);

  const handleResetSize = useCallback(() => {
    if (!singleActionNode) return;
    resetNodeSize(singleActionNode.id);
  }, [resetNodeSize, singleActionNode]);

  const handleClearCache = useCallback(async () => {
    if (!singleActionNode) return;
    try {
      await deleteNodeCache([singleActionNode.id]);
      setNodeCached(singleActionNode.id, false);
      enqueueSnackbar('Cache cleared', { variant: 'success', autoHideDuration: 1500 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 2600 });
    }
  }, [setNodeCached, singleActionNode]);

  const handleCopyNodeInfo = useCallback(() => {
    if (!singleActionNode) return;
    void navigator.clipboard
      .writeText(`${singleActionNode.id}\n${singleActionNode.data.module}.${singleActionNode.data.action}`)
      .then(() => enqueueSnackbar('Node info copied', { variant: 'success', autoHideDuration: 1600 }))
      .catch((error: unknown) => enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 2600 }));
  }, [singleActionNode]);

  const handleInspectIssues = useCallback(() => {
    enqueueSnackbar(validationMessage || 'No issues recorded for this node.', {
      variant: validationMessage ? 'error' : 'default',
      autoHideDuration: validationMessage ? 4200 : 2200,
    });
  }, [validationMessage]);

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

      {singleContainer && !singleProjectedModular && (
        <ToolbarActionButton
          label={singleContainer.data.type === 'loop' ? 'Remove loop container' : 'Ungroup nodes'}
          onClick={handleUngroup}
          data-testid="selection-toolbar-ungroup"
        >
          <Ungroup size={16} />
        </ToolbarActionButton>
      )}

      {singleProjectedModular && (
        <>
          <ToolbarActionButton
            label="Save Block changes"
            onClick={() => setSaveNodeId(singleProjectedModular.id)}
            data-testid="selection-toolbar-save-modular-subtree"
          >
            <Save size={16} />
          </ToolbarActionButton>
          {singleProjectedModular.data.blockProjectionContainer ? (
            <ToolbarActionButton
              label={
                singleProjectedModular.data.blockProjectionContainerExpanded !== false
                  ? 'Collapse Modular Diffusers block'
                  : 'Expand Modular Diffusers block'
              }
              onClick={handleToggleProjectedContainer}
              data-testid="selection-toolbar-toggle-modular-block"
            >
              {singleProjectedModular.data.blockProjectionContainerExpanded !== false ? (
                <Minimize2 size={16} />
              ) : (
                <Maximize2 size={16} />
              )}
            </ToolbarActionButton>
          ) : null}
        </>
      )}

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
              label={
                isCompositeNode
                  ? isCompositeExpanded
                    ? isHuggingFaceCluster
                      ? 'Collapse Cluster Node'
                      : 'Collapse block'
                    : isHuggingFaceCluster
                      ? 'Expand Cluster Node to view internal nodes'
                      : 'Expand block to edit internal nodes'
                  : isCollapsed
                    ? 'Expand node'
                    : 'Collapse node'
              }
              onClick={handleToggleCollapse}
              data-testid="selection-toolbar-collapse"
            >
              {isCompositeNode ? (
                isCompositeExpanded ? (
                  <Minimize2 size={16} />
                ) : (
                  <Maximize2 size={16} />
                )
              ) : isCollapsed ? (
                <Maximize2 size={16} />
              ) : (
                <Minimize2 size={16} />
              )}
            </ToolbarActionButton>
          )}
        </>
      )}

      {showCreateBlock && (
        <>
          <ToolbarDivider />
          <ToolbarActionButton
            label="Repeat selection in a loop"
            onClick={handleCreateLoop}
            data-testid="selection-toolbar-create-loop"
          >
            <Repeat2 size={17} />
          </ToolbarActionButton>
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
          <ModiffMenuRoot>
            <ModiffMenuTrigger>
              <ToolbarActionButton label="More node actions" data-testid="selection-toolbar-more">
                <EllipsisVertical size={16} />
              </ToolbarActionButton>
            </ModiffMenuTrigger>
            {singleActionNode ? (
              <ModiffMenuSurface
                anchor="bottom end"
                layer="graph"
                className="w-52"
                data-testid="selection-toolbar-more-menu"
              >
                <ModiffMenuAction icon={<Power size={15} />} onClick={handleToggleDisabled}>
                  {isDisabledForRun ? 'Enable for run' : 'Disable for run'}
                </ModiffMenuAction>
                <ModiffMenuAction
                  icon={<Circle size={15} />}
                  disabled={!singleActionNode.data.isCached}
                  onClick={() => {
                    void handleClearCache();
                  }}
                >
                  Clear cache
                </ModiffMenuAction>
                <ModiffMenuAction
                  icon={<RefreshCcw size={15} />}
                  disabled={
                    singleActionNode.data.type !== 'block' &&
                    singleActionNode.width === undefined &&
                    singleActionNode.height === undefined
                  }
                  onClick={handleResetSize}
                >
                  {isCompositeExpanded
                    ? isHuggingFaceCluster
                      ? 'Fit Cluster Node to contents'
                      : 'Fit block to contents'
                    : isCompositeNode
                      ? isHuggingFaceCluster
                        ? 'Reset Cluster Node size'
                        : 'Reset block size'
                      : 'Reset automatic size'}
                </ModiffMenuAction>
                <ModiffMenuAction icon={<Copy size={15} />} onClick={handleCopyNodeInfo}>
                  Copy node info
                </ModiffMenuAction>
                <ModiffMenuAction icon={<TriangleAlert size={15} />} onClick={handleInspectIssues}>
                  Inspect issues
                </ModiffMenuAction>
              </ModiffMenuSurface>
            ) : null}
          </ModiffMenuRoot>
        </>
      )}
      {saveNodeId ? (
        <BlockSaveDialogV2 key={saveNodeId} nodeId={saveNodeId} onClose={() => setSaveNodeId(null)} />
      ) : null}
    </div>
  );
}
