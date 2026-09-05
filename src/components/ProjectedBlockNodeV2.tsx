import { memo, useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Maximize2, Minimize2, Save, Settings2 } from 'lucide-react';
import { type NodeProps, useStoreApi, useUpdateNodeInternals } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import { modiffLayout } from '../theme';
import { BlockNodeFrame, ModiffIconButton } from '../ui';
import { useNodeLayoutSync } from '../utils/useNodeLayoutSync';
import { syncManagedNodeControlChange } from '../studio/managedControlSync';
import ErrorBoundary from './ErrorBoundary';
import NodeContent from './NodeContent';
import BlockSaveDialogV2 from './BlockSaveDialogV2';
import BlockInterfaceDialogV2 from './BlockInterfaceDialogV2';

/**
 * Block-shaped view of one upstream Modular Diffusers placement.
 *
 * This is intentionally a projection of the owning BlockInstanceV2 rather
 * than a nested persisted BlockInstanceV2. It shares the normal Block frame,
 * controls, connectors, resize behavior, and subtree-save action while all
 * edits continue to update the single workflow-owned root authority.
 */
const ProjectedBlockNodeV2 = memo((node: NodeProps<CustomNodeType>) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [saveChoicesOpen, setSaveChoicesOpen] = useState(false);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const connectorRef = useRef<HTMLDivElement>(null);
  const reactFlowStore = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const scheduleNodeLayoutSync = useNodeLayoutSync(node.id, nodeRef);
  const setParam = useFlowStore((state) => state.setParamWithHistory);
  const setNodeSize = useFlowStore((state) => state.setNodeSize);
  const beginHistoryTransaction = useFlowStore((state) => state.beginHistoryTransaction);
  const commitHistoryTransaction = useFlowStore((state) => state.commitHistoryTransaction);
  const toggleContainer = useFlowStore((state) => state.toggleBlockContainerExpandedV2);
  const ownerSourceKind = useFlowStore((state) => {
    const ownerId = node.data.blockProjectionOwnerId;
    if (!ownerId) return 'diffusers_catalog' as const;
    return state.nodes.find((candidate) => candidate.id === ownerId)?.data.blockInstanceV2?.definitionSnapshot.source
      .kind;
  });
  const label = node.data.label || node.data.action || node.data.blockProjectionNodeId || 'Modular Diffusers Block';
  const isContainer = node.data.blockProjectionContainer === true;
  const expanded = isContainer && node.data.blockProjectionContainerExpanded !== false;
  const childCount = node.data.blockProjectionChildCount ?? 0;
  const hasVisibleControls = Object.values(node.data.params).some(
    (param) => param.display !== 'input' && param.display !== 'output' && !param.hidden,
  );

  const updateStore = useCallback(
    (param: string, value: unknown, key?: Parameters<typeof setParam>[3]) => {
      setParam(node.id, param, value, key);
      syncManagedNodeControlChange(node.id, param, value, key);
    },
    [node.id, setParam],
  );

  const handleToggle = useCallback(() => {
    const ownerId = node.data.blockProjectionOwnerId;
    const semanticNodeId = node.data.blockProjectionNodeId;
    if (!ownerId || !semanticNodeId || !isContainer) return;
    toggleContainer(ownerId, semanticNodeId);
    scheduleNodeLayoutSync();
  }, [
    isContainer,
    node.data.blockProjectionNodeId,
    node.data.blockProjectionOwnerId,
    scheduleNodeLayoutSync,
    toggleContainer,
  ]);

  const collapsedMinimumHeight = useCallback(() => {
    const headerHeight = headerRef.current?.offsetHeight ?? 44;
    const connectorHeight = connectorRef.current?.offsetHeight ?? 0;
    return Math.ceil(headerHeight + connectorHeight + 96 + 4);
  }, []);

  const syncCollapsedMinimumHeight = useCallback(() => {
    if (expanded) return;
    const minimumHeight = collapsedMinimumHeight();
    const current = useFlowStore.getState().nodes.find((candidate) => candidate.id === node.id);
    // A ResizeObserver notification queued while this container was collapsed
    // can be delivered after the expansion reducer has already projected its
    // recursive bounds. Never let that stale callback overwrite the expanded
    // container with its compact connector-tray height.
    if (
      !current ||
      (isContainer && current.data.blockProjectionContainerExpanded !== false) ||
      (current.height ?? 0) >= minimumHeight
    )
      return;
    setNodeSize(node.id, current.width ?? 280, minimumHeight);
    updateNodeInternals(node.id);
    scheduleNodeLayoutSync();
  }, [
    collapsedMinimumHeight,
    expanded,
    isContainer,
    node.id,
    scheduleNodeLayoutSync,
    setNodeSize,
    updateNodeInternals,
  ]);

  useLayoutEffect(() => {
    if (expanded) return undefined;
    syncCollapsedMinimumHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Never mutate React Flow node dimensions during ResizeObserver
      // delivery. Nested container trays can otherwise resize their parent
      // in the same delivery batch and trigger Chromium's loop diagnostic.
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncCollapsedMinimumHeight);
    });
    if (headerRef.current) observer.observe(headerRef.current);
    if (connectorRef.current) observer.observe(connectorRef.current);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [expanded, syncCollapsedMinimumHeight]);

  const handleResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      beginHistoryTransaction('Resize Modular Diffusers block');
      const initialWidth = nodeRef.current?.clientWidth || node.width || 0;
      const initialHeight = nodeRef.current?.clientHeight || node.height || 0;
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = reactFlowStore.getState().transform[2] || 1;
      const minimumHeight = collapsedMinimumHeight();
      const onMove = (moveEvent: globalThis.MouseEvent) => {
        setNodeSize(
          node.id,
          Math.max(260, Math.min(modiffLayout.maxNodeWidth, initialWidth + (moveEvent.clientX - startX) / zoom)),
          Math.max(minimumHeight, initialHeight + (moveEvent.clientY - startY) / zoom),
        );
        scheduleNodeLayoutSync();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        commitHistoryTransaction();
        scheduleNodeLayoutSync();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [
      beginHistoryTransaction,
      collapsedMinimumHeight,
      commitHistoryTransaction,
      node.height,
      node.id,
      node.width,
      reactFlowStore,
      scheduleNodeLayoutSync,
      setNodeSize,
    ],
  );

  return (
    <>
      <BlockNodeFrame
        nodeId={node.id}
        label={label}
        expanded={expanded}
        nodeRef={nodeRef}
        headerRef={headerRef}
        connectorRef={connectorRef}
        onResizeStart={handleResizeStart}
        schemaVersion={2}
        sourceKind={ownerSourceKind ?? 'diffusers_catalog'}
        projectionKind="modular-diffusers"
        semanticNodeId={node.data.blockProjectionNodeId}
        parentNodeId={node.parentId}
        actions={
          <>
            <ModiffIconButton
              className="nodrag nowheel"
              size="compact"
              label="Configure exposed inputs, outputs, and controls"
              onClick={() => setInterfaceOpen(true)}
              data-testid={`user-block-configure-${node.id}`}
            >
              <Settings2 size={15} />
            </ModiffIconButton>
            <ModiffIconButton
              className="nodrag nowheel"
              size="compact"
              label={`Save changes to ${label}`}
              onClick={() => setSaveChoicesOpen(true)}
              data-testid={`projected-block-save-${node.id}`}
            >
              <Save size={15} />
            </ModiffIconButton>
            {isContainer ? (
              <ModiffIconButton
                className="nodrag nowheel"
                size="compact"
                label={expanded ? `Collapse ${label}` : `Expand ${label}`}
                onClick={handleToggle}
                data-testid={`toggle-modular-container-${node.id}`}
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </ModiffIconButton>
            ) : null}
          </>
        }
        controls={
          hasVisibleControls ? (
            <ErrorBoundary module={node.data.module || ''} action={node.data.action || ''}>
              <NodeContent
                nodeId={node.id}
                params={node.data.params}
                updateStore={updateStore}
                module={node.data.module || ''}
                action={node.data.action || ''}
                mode="controls"
                executionStatus={node.data.executionStatus}
                progressMessage={node.data.progressMessage}
              />
            </ErrorBoundary>
          ) : (
            <div className="grid min-h-16 content-center gap-1 text-xs text-modiff-subtle-text">
              {node.data.description ? <p>{node.data.description}</p> : null}
              <p>
                {childCount
                  ? `${childCount} immediate Modular ${childCount === 1 ? 'block' : 'blocks'}`
                  : 'Leaf Modular Diffusers block'}
              </p>
            </div>
          )
        }
        connectors={
          <ErrorBoundary module={node.data.module || ''} action={node.data.action || ''}>
            <NodeContent
              nodeId={node.id}
              params={node.data.params}
              updateStore={updateStore}
              module={node.data.module || ''}
              action={node.data.action || ''}
              mode="connectors"
            />
          </ErrorBoundary>
        }
        connectorsWhenExpanded
      />
      {interfaceOpen ? <BlockInterfaceDialogV2 nodeId={node.id} onClose={() => setInterfaceOpen(false)} /> : null}
      {saveChoicesOpen ? <BlockSaveDialogV2 nodeId={node.id} onClose={() => setSaveChoicesOpen(false)} /> : null}
    </>
  );
});

ProjectedBlockNodeV2.displayName = 'ProjectedBlockNodeV2';

export default ProjectedBlockNodeV2;
