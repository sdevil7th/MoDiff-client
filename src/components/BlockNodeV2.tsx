import {
  lazy,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { LayoutGrid, ListChecks, Maximize2, Minimize2, Save, Settings2 } from 'lucide-react';
import { type NodeProps, useStoreApi, useUpdateNodeInternals } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';

import type { CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import { captureWorkflowOperationContext } from '../stores/useStudioStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { BlockJsonValue } from '../studio/blockSchemaV2';
import { blockExpandedProjectionSizeV2, blockProjectedChildCountV2, blockViewModelV2 } from '../studio/blockRuntimeV2';
import { resolveCompositeBlockCapabilitiesV2 } from '../studio/compositeBlockCapabilitiesV2';
import { compactReviewedModularInternalLayoutV2 } from '../studio/reviewedModularGraphV2';
import { saveBlockInstanceV2AsNewUserDefinition } from '../studio/blockPersistenceV2';
import { registeredRouteSetForBlockV1 } from '../studio/blockRouteSelectionV1';
import { useNodeLayoutSync } from '../utils/useNodeLayoutSync';
import { BlockNodeFrame, ModiffDialog, ModiffFieldShell, ModiffIconButton, ModiffSelect } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import NodeContent from './NodeContent';
import BlockSaveDialogV2 from './BlockSaveDialogV2';
import BlockInterfaceDialogV2 from './BlockInterfaceDialogV2';
import BlockCrossingPortsV2 from './BlockCrossingPortsV2';

const OperationOwnerControls = lazy(() => import('./OperationOwnerControls'));
const BlockDetailDialogV2 = lazy(() => import('./BlockDetailDialogV2'));

/**
 * Source-neutral Block V2 projection inside the shared `type: "block"`
 * renderer. The component derives every control and connector from the
 * embedded BlockInstanceV2 and never mirrors them into NodeData.params.
 */
export const BlockNodeV2 = memo((node: NodeProps<CustomNodeType>) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const connectorRef = useRef<HTMLDivElement>(null);
  const [compositionOpen, setCompositionOpen] = useState(false);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const [saveChoicesOpen, setSaveChoicesOpen] = useState(false);
  const [routeSwitchBusy, setRouteSwitchBusy] = useState(false);
  const routeSwitchRequest = useRef<AbortController | null>(null);
  const [pendingRouteKey, setPendingRouteKey] = useState<string | null>(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const reactFlowStore = useStoreApi();
  const scheduleNodeLayoutSync = useNodeLayoutSync(node.id, nodeRef);
  const toggleExpanded = useFlowStore((state) => state.toggleUserBlockExpanded);
  const setInstanceValue = useFlowStore((state) => state.setBlockInstanceValueV2);
  const applySuggestedInputs = useFlowStore((state) => state.applyBlockSuggestedInputsV2);
  const setPresentation = useFlowStore((state) => state.setBlockPresentationV2);
  const ensureProjection = useFlowStore((state) => state.ensureBlockProjectionV2);
  const fitProjectionToChildren = useFlowStore((state) => state.fitBlockProjectionToChildrenV2);
  const ensureMinimumHeight = useFlowStore((state) => state.ensureBlockMinimumHeightV2);
  const beginHistoryTransaction = useFlowStore((state) => state.beginHistoryTransaction);
  const commitHistoryTransaction = useFlowStore((state) => state.commitHistoryTransaction);
  const connectedEdges = useFlowStore(
    useShallow((state) => state.edges.filter((edge) => edge.source === node.id || edge.target === node.id)),
  );
  const projectionNodeCount = useFlowStore(
    (state) => state.nodes.filter((candidate) => candidate.data.blockProjectionOwnerId === node.id).length,
  );
  const projectionBoundsSignature = useFlowStore((state) =>
    state.nodes
      .filter((candidate) => candidate.data.blockProjectionOwnerId === node.id)
      .map(
        (candidate) =>
          `${candidate.id}:${candidate.position.x}:${candidate.position.y}:${candidate.measured?.width ?? candidate.width ?? ''}:${candidate.measured?.height ?? candidate.height ?? ''}`,
      )
      .sort()
      .join('|'),
  );
  const expandedFrameSize = useFlowStore(
    useShallow((state) => {
      const root = state.nodes.find((candidate) => candidate.id === node.id);
      const currentInstance = root?.data.blockInstanceV2;
      if (!root || !currentInstance?.presentation.expanded) return null;
      const children = state.nodes.filter((candidate) => candidate.data.blockProjectionOwnerId === node.id);
      // The frame is the drop boundary during a drag. Fitting it to a pointer
      // position makes it chase the child and prevents moving that child out.
      if (children.some((candidate) => candidate.dragging)) {
        return {
          width: root.width ?? root.measured?.width ?? 360,
          height: root.height ?? root.measured?.height ?? 320,
        };
      }
      return blockExpandedProjectionSizeV2(currentInstance, children);
    }),
  );

  const instance = node.data.blockInstanceV2;
  const view = useMemo(() => {
    if (!instance) throw new Error(`Block V2 renderer received a node without blockInstanceV2 (${node.id}).`);
    return blockViewModelV2(instance);
  }, [instance, node.id]);
  const expectedProjectionCount = useMemo(() => (instance ? blockProjectedChildCountV2(instance) : 0), [instance]);
  const capabilities = useMemo(() => {
    if (!instance) throw new Error(`Block V2 renderer received a node without blockInstanceV2 (${node.id}).`);
    return resolveCompositeBlockCapabilitiesV2(instance.definitionSnapshot, instance, {
      editWorkflow: true,
      configureInterfaces: true,
      createUserDefinitions: true,
      updateUserDefinitions: true,
    });
  }, [instance, node.id]);
  const registeredRouteSet = useMemo(() => {
    if (!instance) return null;
    try {
      return registeredRouteSetForBlockV1(instance);
    } catch {
      return null;
    }
  }, [instance]);
  const compactInternalLayout = useMemo(
    () => (instance ? compactReviewedModularInternalLayoutV2(instance) : null),
    [instance],
  );
  const connectorParams = useMemo(
    () => ({
      ...Object.fromEntries(
        Object.entries(view.connectorParams.inputs).map(([key, param]) => [
          key,
          {
            ...param,
            isConnected: connectedEdges.some((edge) => edge.target === node.id && edge.targetHandle === key),
          },
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(view.connectorParams.outputs).map(([key, param]) => [
          key,
          {
            ...param,
            isConnected: connectedEdges.some((edge) => edge.source === node.id && edge.sourceHandle === key),
          },
        ]),
      ),
    }),
    [connectedEdges, node.id, view.connectorParams.inputs, view.connectorParams.outputs],
  );

  const updateStore = useCallback(
    (param: string, value: unknown, key?: keyof NodeParams) => {
      if (key !== undefined && key !== 'value') return;
      setInstanceValue(node.id, param, value as BlockJsonValue);
    },
    [node.id, setInstanceValue],
  );
  const handleToggleExpanded = useCallback(() => {
    toggleExpanded(node.id);
    updateNodeInternals(node.id);
  }, [node.id, toggleExpanded, updateNodeInternals]);
  const handleCompactInternalLayout = useCallback(() => {
    if (!compactInternalLayout) return;
    setPresentation(node.id, { internalLayout: compactInternalLayout, internalLayoutMode: 'hierarchical' });
    requestAnimationFrame(() => {
      updateNodeInternals(node.id);
      scheduleNodeLayoutSync();
    });
    enqueueSnackbar('Applied compact Modular Diffusers layout. Graph structure and values were unchanged.', {
      variant: 'success',
      autoHideDuration: 2800,
    });
  }, [compactInternalLayout, node.id, scheduleNodeLayoutSync, setPresentation, updateNodeInternals]);
  const performRouteSwitch = useCallback(
    async (routeKey: string, saveActiveRoute = false) => {
      if (routeSwitchRequest.current) return;
      const controller = new AbortController();
      routeSwitchRequest.current = controller;
      const source = {
        context: captureWorkflowOperationContext(),
        signature: JSON.stringify(useFlowStore.getState().toObject()),
      };
      setRouteSwitchBusy(true);
      try {
        const saved = saveActiveRoute ? await saveBlockInstanceV2AsNewUserDefinition({ instanceId: node.id }) : null;
        const { switchRegisteredBlockRouteV1 } = await import('../studio/registeredBlockRouteSwitchV1');
        const switched = await switchRegisteredBlockRouteV1(node.id, routeKey, { source, signal: controller.signal });
        setPendingRouteKey(null);
        enqueueSnackbar(
          saved
            ? `Saved Block ${saved.displayName}, then switched to ${switched.definitionSnapshot.displayName}.`
            : `Model route changed to ${switched.definitionSnapshot.displayName}.`,
          {
            variant: 'success',
            autoHideDuration: 3200,
          },
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        enqueueSnackbar(error instanceof Error ? error.message : 'Could not save and switch this model route.', {
          variant: 'error',
          autoHideDuration: 6200,
        });
      } finally {
        if (routeSwitchRequest.current === controller) {
          routeSwitchRequest.current = null;
          setRouteSwitchBusy(false);
        }
      }
    },
    [node.id],
  );

  useEffect(() => () => routeSwitchRequest.current?.abort(), []);

  useEffect(() => {
    updateNodeInternals(node.id);
    scheduleNodeLayoutSync();
  }, [node.id, scheduleNodeLayoutSync, updateNodeInternals, view.expanded]);

  useEffect(() => {
    if (!view.expanded || expectedProjectionCount === 0 || projectionNodeCount === expectedProjectionCount) return;
    // Persisted workflows store only the durable root. Recreate replaceable
    // child nodes/edges when an expanded root mounts after Save/refresh.
    ensureProjection(node.id);
  }, [ensureProjection, expectedProjectionCount, node.id, projectionNodeCount, view.expanded]);

  useEffect(() => {
    if (!view.expanded || projectionNodeCount === 0) return undefined;
    // React Flow measures ordinary child nodes after their first render. Fit
    // the replaceable outer frame to those real dimensions without writing
    // them into the Block's collapsed presentation size. Defer the fit beyond
    // the browser's ResizeObserver delivery cycle so the parent resize cannot
    // recursively invalidate the child measurement batch.
    let internalsFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      fitProjectionToChildren(node.id);
      // The controlled graph updates before React Flow has necessarily
      // committed the wrapper style. Re-measure on the following frame so a
      // long-lived node id cannot retain its earlier collapsed DOM rectangle.
      internalsFrame = window.requestAnimationFrame(() => updateNodeInternals(node.id));
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (internalsFrame) window.cancelAnimationFrame(internalsFrame);
    };
  }, [
    fitProjectionToChildren,
    node.height,
    node.id,
    node.width,
    projectionBoundsSignature,
    projectionNodeCount,
    updateNodeInternals,
    view.expanded,
  ]);

  const collapsedMinimumHeight = useCallback(() => {
    const headerHeight = headerRef.current?.offsetHeight ?? 44;
    const connectorHeight = connectorRef.current?.offsetHeight ?? 0;
    return Math.ceil(headerHeight + connectorHeight + 96 + 4);
  }, []);
  const syncCollapsedMinimumHeight = useCallback(() => {
    if (view.expanded) return;
    const minimumHeight = collapsedMinimumHeight();
    const current = useFlowStore.getState().nodes.find((candidate) => candidate.id === node.id);
    if ((current?.data.blockInstanceV2?.presentation.size.height ?? 0) >= minimumHeight) return;
    ensureMinimumHeight(node.id, minimumHeight);
    updateNodeInternals(node.id);
    scheduleNodeLayoutSync();
  }, [
    collapsedMinimumHeight,
    ensureMinimumHeight,
    node.id,
    scheduleNodeLayoutSync,
    updateNodeInternals,
    view.expanded,
  ]);

  useLayoutEffect(() => {
    if (view.expanded) return undefined;
    syncCollapsedMinimumHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // A ResizeObserver callback runs inside the browser's delivery phase.
      // Updating React Flow dimensions synchronously from that phase can
      // resize the observed connector tray again and produce a delivery loop
      // for deeply nested Blocks. Coalesce the write onto the next frame.
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncCollapsedMinimumHeight);
    });
    if (headerRef.current) observer.observe(headerRef.current);
    if (connectorRef.current) observer.observe(connectorRef.current);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [syncCollapsedMinimumHeight, view.expanded]);

  const handleResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      beginHistoryTransaction('Resize block');
      const initialWidth = nodeRef.current?.clientWidth || node.width || view.size.width;
      const initialHeight = nodeRef.current?.clientHeight || node.height || view.size.height;
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = reactFlowStore.getState().transform[2] || 1;
      const minimumHeight = collapsedMinimumHeight();

      const handleMove = (moveEvent: globalThis.MouseEvent) => {
        const width = Math.min(720, Math.max(280, initialWidth + (moveEvent.clientX - startX) / zoom));
        const height = Math.max(minimumHeight, initialHeight + (moveEvent.clientY - startY) / zoom);
        setPresentation(node.id, { size: { width: Math.round(width), height: Math.round(height) } });
        scheduleNodeLayoutSync();
      };
      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        commitHistoryTransaction();
        scheduleNodeLayoutSync();
      };
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
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
      setPresentation,
      view.size.height,
      view.size.width,
    ],
  );

  return (
    <>
      <BlockNodeFrame
        nodeId={node.id}
        label={view.displayName}
        expanded={view.expanded}
        nodeRef={nodeRef}
        headerRef={headerRef}
        connectorRef={connectorRef}
        onResizeStart={handleResizeStart}
        schemaVersion={2}
        sourceKind={view.source.kind}
        expandedFrameSize={expandedFrameSize ?? undefined}
        actions={
          <>
            {view.expanded ? (
              <>
                {compactInternalLayout ? (
                  <ModiffIconButton
                    className="nodrag nowheel"
                    size="compact"
                    label="Compact internal layout"
                    onClick={handleCompactInternalLayout}
                    data-testid={`block-v2-compact-layout-${node.id}`}
                  >
                    <LayoutGrid size={15} />
                  </ModiffIconButton>
                ) : null}
                <ModiffIconButton
                  className="nodrag nowheel"
                  size="compact"
                  label="Inspect block composition"
                  onClick={() => setCompositionOpen(true)}
                  data-testid={`user-block-composition-${node.id}`}
                >
                  <ListChecks size={15} />
                </ModiffIconButton>
              </>
            ) : null}
            {capabilities.keepWorkflowOnly || capabilities.saveAsNewUserNode ? (
              <ModiffIconButton
                className="nodrag nowheel"
                size="compact"
                label="Save block changes"
                onClick={() => setSaveChoicesOpen(true)}
                data-testid={`user-block-save-choices-${node.id}`}
              >
                <Save size={15} />
              </ModiffIconButton>
            ) : null}
            <ModiffIconButton
              className="nodrag nowheel"
              size="compact"
              label="Configure public inputs, outputs, and controls"
              disabled={!capabilities.configureInterface}
              onClick={() => {
                if (!instance) return;
                setInterfaceOpen(true);
              }}
              data-testid={`user-block-configure-${node.id}`}
            >
              <Settings2 size={15} />
            </ModiffIconButton>
            <ModiffIconButton
              className="nodrag nowheel"
              size="compact"
              label={view.expanded ? 'Collapse block' : 'Expand block'}
              onClick={handleToggleExpanded}
              data-testid={`user-block-toggle-${node.id}`}
            >
              {view.expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </ModiffIconButton>
          </>
        }
        controls={
          <>
            <Suspense fallback={null}>
              <OperationOwnerControls node={{ ...node, position: view.position }} />
            </Suspense>
            {registeredRouteSet ? (
              <ModiffFieldShell className="mb-3" label={registeredRouteSet.routeSet.label}>
                <ModiffSelect
                  value={registeredRouteSet.activeRoute.key}
                  disabled={routeSwitchBusy}
                  onValueChange={(routeKey) => {
                    if (routeKey === registeredRouteSet.activeRoute.key) return;
                    if (instance?.customization.state !== 'unchanged') {
                      // Let the Headless UI listbox finish closing before a
                      // dialog takes focus. Mounting both overlays in the same
                      // change event can strand the confirmation click behind
                      // the still-active listbox portal.
                      requestAnimationFrame(() => setPendingRouteKey(routeKey));
                    } else void performRouteSwitch(routeKey);
                  }}
                  options={registeredRouteSet.routeSet.routes.map((route) => ({
                    value: route.key,
                    label: route.label,
                  }))}
                  data-testid={`block-v2-route-select-${node.id}`}
                />
              </ModiffFieldShell>
            ) : null}
            {view.suggestedInputs.length ? (
              <ModiffFieldShell className="mb-3" label="Starter values">
                <ModiffSelect
                  value=""
                  onValueChange={(suggestionId) => {
                    try {
                      applySuggestedInputs(node.id, suggestionId);
                    } catch (error) {
                      enqueueSnackbar(
                        error instanceof Error ? error.message : 'Could not apply the selected starter values.',
                        { variant: 'error', autoHideDuration: 3600 },
                      );
                    }
                  }}
                  options={view.suggestedInputs.map((suggestion) => ({
                    value: suggestion.suggestionId,
                    label: suggestion.label,
                  }))}
                  placeholder="Choose creator starter values"
                  data-testid={`block-v2-suggested-inputs-${node.id}`}
                />
              </ModiffFieldShell>
            ) : null}
            <NodeContent
              nodeId={node.id}
              params={view.controlParams}
              updateStore={updateStore}
              module={view.source.library ?? view.source.provider ?? 'MoDiff'}
              action="BlockV2"
              mode="controls"
            />
            {view.previewViews.map((preview) => (
              <div
                key={preview.previewId}
                className="mt-3 overflow-hidden rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg p-2"
                data-testid={`block-v2-preview-${node.id}-${preview.previewId}`}
              >
                <NodeContent
                  nodeId={node.id}
                  params={preview.params}
                  updateStore={() => undefined}
                  module={view.source.library ?? view.source.provider ?? 'MoDiff'}
                  action="BlockV2Preview"
                  mode="controls"
                  executionStatus={preview.status}
                />
              </div>
            ))}
          </>
        }
        connectors={
          <>
            <NodeContent
              nodeId={node.id}
              params={connectorParams}
              updateStore={updateStore}
              module={view.source.library ?? view.source.provider ?? 'MoDiff'}
              action="BlockV2"
              mode="connectors"
            />
            <BlockCrossingPortsV2 nodeId={node.id} />
          </>
        }
        connectorsWhenExpanded
      />
      {pendingRouteKey ? (
        <Suspense
          fallback={
            <ModiffDialog open title="Switch model route" onClose={() => !routeSwitchBusy && setPendingRouteKey(null)}>
              <p role="status">Loading route choices…</p>
            </ModiffDialog>
          }
        >
          <BlockDetailDialogV2
            mode="route"
            nodeId={node.id}
            busy={routeSwitchBusy}
            onClose={() => {
              routeSwitchRequest.current?.abort();
              setPendingRouteKey(null);
            }}
            onSwitch={(save) => void performRouteSwitch(pendingRouteKey, save)}
          />
        </Suspense>
      ) : null}
      {compositionOpen && instance ? (
        <Suspense
          fallback={
            <ModiffDialog open title="Block composition" onClose={() => setCompositionOpen(false)}>
              <p role="status">Loading composition details…</p>
            </ModiffDialog>
          }
        >
          <BlockDetailDialogV2
            mode="composition"
            nodeId={node.id}
            instance={instance}
            onClose={() => setCompositionOpen(false)}
          />
        </Suspense>
      ) : null}
      {interfaceOpen ? <BlockInterfaceDialogV2 nodeId={node.id} onClose={() => setInterfaceOpen(false)} /> : null}
      {saveChoicesOpen ? <BlockSaveDialogV2 nodeId={node.id} onClose={() => setSaveChoicesOpen(false)} /> : null}
    </>
  );
});

BlockNodeV2.displayName = 'BlockNodeV2';
