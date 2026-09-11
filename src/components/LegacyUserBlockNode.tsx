import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ListChecks, Maximize2, Minimize2, Save, Settings2 } from 'lucide-react';
import { type NodeProps, useStoreApi, useUpdateNodeInternals } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useStudioStore } from '../stores/useStudioStore';
import {
  createUserBlockNode,
  inspectUserBlockComposition,
  isUserBlockExpandedInstance,
  userBlockCollapsedContentGroups,
  userBlockAvailableExposedParams,
} from '../studio/userBlocks';
import { persistUserBlockInstanceChoice } from '../studio/userBlockPersistence';
import { contextualUserNodeName } from '../studio/huggingFaceClusterCustomization';
import {
  duplicateReviewedModularBlockRecipe,
  rebuildReviewedModularComposition,
  reviewedModularCompositionSource,
  type ModularCompositionReceipt,
} from '../studio/modularComposition';
import { cx } from '../utils/classNames';
import { deepEqual } from '../utils/deepEqual';
import { useNodeLayoutSync } from '../utils/useNodeLayoutSync';
import {
  BlockNodeFrame,
  ModiffButton,
  ModiffCheckbox,
  ModiffDialog,
  ModiffDisclosure,
  ModiffFieldShell,
  ModiffIconButton,
  ModiffInput,
} from '../ui';
import NodeContent from './NodeContent';
import { enqueueSnackbar } from '../ui/snackbar';

const UserBlockNode = memo((node: NodeProps<CustomNodeType>) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const connectorRef = useRef<HTMLDivElement>(null);
  const expanded = useFlowStore((state) => isUserBlockExpandedInstance(state, node.id));
  const definition = node.data.userBlockSnapshot;
  const toggleExpanded = useFlowStore((state) => state.toggleUserBlockExpanded);
  const setParam = useFlowStore((state) => state.setParamWithHistory);
  const replaceNodeParams = useFlowStore((state) => state.replaceNodeParams);
  const setNodeSize = useFlowStore((state) => state.setNodeSize);
  const beginHistoryTransaction = useFlowStore((state) => state.beginHistoryTransaction);
  const commitHistoryTransaction = useFlowStore((state) => state.commitHistoryTransaction);
  const setNodeUiState = useFlowStore((state) => state.setNodeUiState);
  const configureBlock = useFlowStore((state) => state.configureUserBlock);
  const workflowTitle = useStudioStore(
    (state) => state.workflowTabs.find((tab) => tab.id === state.activeWorkflowTabId)?.title || 'Workflow',
  );
  const fitBlockToChildren = useFlowStore((state) => state.fitUserBlockToChildren);
  const childLayoutSignature = useFlowStore((state) =>
    state.nodes
      .filter((candidate) => candidate.data.userBlockInstanceId === node.id)
      .map(
        (candidate) =>
          `${candidate.id}:${candidate.position.x}:${candidate.position.y}:${candidate.measured?.width ?? candidate.width ?? 0}:${candidate.measured?.height ?? candidate.height ?? 0}`,
      )
      .sort()
      .join('|'),
  );
  const updateNodeInternals = useUpdateNodeInternals();
  const reactFlowStore = useStoreApi();
  const scheduleNodeLayoutSync = useNodeLayoutSync(node.id, nodeRef);
  const generatedBlockNode = useMemo(
    () => (definition ? createUserBlockNode(definition, { x: 0, y: 0 }, node.id) : null),
    [definition, node.id],
  );
  const effectiveDefinition = generatedBlockNode?.data.userBlockSnapshot ?? definition;
  const effectiveParams = useMemo(() => {
    const generatedParams = generatedBlockNode?.data.params;
    if (!generatedParams) return node.data.params;
    const merged = { ...generatedParams };
    Object.entries(node.data.params).forEach(([key, param]) => {
      const generated = generatedParams[key];
      merged[key] = generated
        ? {
            ...generated,
            ...param,
            fieldOptions: {
              ...(generated.fieldOptions ?? {}),
              ...(param.fieldOptions ?? {}),
            },
          }
        : param;
    });
    return merged;
  }, [generatedBlockNode?.data.params, node.data.params]);
  const contentGroups = useMemo(
    () => (effectiveDefinition ? userBlockCollapsedContentGroups(effectiveDefinition, effectiveParams) : []),
    [effectiveDefinition, effectiveParams],
  );
  const availableExposedParams = useMemo(
    () => (effectiveDefinition ? userBlockAvailableExposedParams(effectiveDefinition) : []),
    [effectiveDefinition],
  );
  const [configuration, setConfiguration] = useState<{
    name: string;
    inputLabels: Record<string, string>;
    outputLabels: Record<string, string>;
    exposedParamIds: Set<string>;
  } | null>(null);
  const [saveChoicesOpen, setSaveChoicesOpen] = useState(false);
  const [compositionOpen, setCompositionOpen] = useState(false);
  const [savingChoice, setSavingChoice] = useState(false);
  const [modularCompositionBusyPath, setModularCompositionBusyPath] = useState<string | null>(null);
  const [modularCompositionReceipt, setModularCompositionReceipt] = useState<ModularCompositionReceipt | null>(null);
  const [modularCompositionError, setModularCompositionError] = useState<string | null>(null);
  const huggingFaceLibrary = useHuggingFaceNodeLibraryStore((state) => state.library);
  const compositionSignature = useFlowStore((state) => {
    if (!expanded) return '';
    const childIds = new Set(
      state.nodes
        .filter((candidate) => candidate.data.userBlockInstanceId === node.id)
        .map((candidate) => candidate.id),
    );
    const childSignature = state.nodes
      .filter((candidate) => childIds.has(candidate.id))
      .map((candidate) =>
        JSON.stringify([
          candidate.id,
          candidate.parentId,
          candidate.data.type,
          Object.entries(candidate.data.params ?? {}).map(([key, param]) => [
            key,
            param.type,
            param.display,
            param.isInput,
            param.hidden,
            key === 'pipeline_class' || key === 'workflow_id' ? (param.value ?? param.default) : undefined,
          ]),
        ]),
      )
      .sort()
      .join('|');
    const edgeSignature = state.edges
      .filter((edge) => childIds.has(edge.source) || childIds.has(edge.target))
      .map((edge) => `${edge.id}:${edge.source}:${edge.sourceHandle ?? ''}:${edge.target}:${edge.targetHandle ?? ''}`)
      .sort()
      .join('|');
    return `${childSignature}\n${edgeSignature}`;
  });
  const compositionReport = useMemo(() => {
    // The signature is the stable store subscription that invalidates this
    // derived report when an internal node or edge changes.
    String(compositionSignature);
    return expanded
      ? inspectUserBlockComposition(useFlowStore.getState(), node.id)
      : { valid: true, issues: [], insertionSuggestions: [] };
  }, [compositionSignature, expanded, node.id]);
  const insertNodeInUserBlock = useFlowStore((state) => state.insertNodeInUserBlock);
  const modularCompositionSource = useMemo(
    () => reviewedModularCompositionSource(effectiveDefinition, huggingFaceLibrary),
    [effectiveDefinition, huggingFaceLibrary],
  );
  const updateStore = useCallback(
    (param: string, value: unknown, key?: keyof NodeParams) => setParam(node.id, param, value, key),
    [node.id, setParam],
  );
  const handleToggleExpanded = useCallback(() => {
    toggleExpanded(node.id);
    useStudioStore.getState().saveActiveWorkflowTab(true);
  }, [node.id, toggleExpanded]);
  const handleDefinitionChoice = useCallback(
    async (choice: 'update' | 'new' | 'workflow') => {
      if (savingChoice) return;
      setSavingChoice(true);
      try {
        const saved = await persistUserBlockInstanceChoice({ instanceId: node.id, choice, workflowTitle });
        setSaveChoicesOpen(false);
        enqueueSnackbar(
          choice === 'update'
            ? 'Reusable User Node updated. Existing workflow instances keep their embedded snapshots.'
            : choice === 'new'
              ? `Saved as new User Node: ${saved.name}`
              : 'Changes kept only in this workflow.',
          { variant: 'success', autoHideDuration: 3200 },
        );
      } catch (error) {
        enqueueSnackbar(error instanceof Error ? error.message : 'Could not save the User Node changes.', {
          variant: 'error',
          autoHideDuration: 4200,
        });
      } finally {
        setSavingChoice(false);
      }
    },
    [node.id, savingChoice, workflowTitle],
  );
  const collapsedMinimumHeight = useCallback(() => {
    const headerHeight = headerRef.current?.offsetHeight ?? 44;
    const connectorHeight = connectorRef.current?.offsetHeight ?? 0;
    return Math.ceil(headerHeight + connectorHeight + 96 + 4);
  }, []);
  const syncCollapsedMinimumHeight = useCallback(() => {
    if (expanded) return;
    const minimumHeight = collapsedMinimumHeight();
    const current = useFlowStore.getState().nodes.find((candidate) => candidate.id === node.id);
    if (
      !current ||
      isUserBlockExpandedInstance(useFlowStore.getState(), node.id) ||
      (current.height ?? 0) >= minimumHeight
    )
      return;
    useFlowStore.setState((state) => ({
      nodes: state.nodes.map((candidate) =>
        candidate.id === node.id
          ? {
              ...candidate,
              height: minimumHeight,
              data: {
                ...candidate.data,
                uiState: {
                  ...candidate.data.uiState,
                  blockCollapsedHeight: minimumHeight,
                },
              },
            }
          : candidate,
      ),
    }));
    updateNodeInternals(node.id);
    scheduleNodeLayoutSync();
  }, [collapsedMinimumHeight, expanded, node.id, scheduleNodeLayoutSync, updateNodeInternals]);

  useEffect(() => {
    updateNodeInternals(node.id);
  }, [expanded, node.id, updateNodeInternals]);

  useLayoutEffect(() => {
    if (expanded) return undefined;
    syncCollapsedMinimumHeight();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let frame: number | null = null;
    let active = true;
    const observer = new ResizeObserver(() => {
      if (!active || frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (active) syncCollapsedMinimumHeight();
      });
    });
    if (headerRef.current) observer.observe(headerRef.current);
    if (connectorRef.current) observer.observe(connectorRef.current);
    return () => {
      active = false;
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [expanded, syncCollapsedMinimumHeight]);

  useEffect(() => {
    if (!expanded || !childLayoutSignature) return;
    const frame = window.requestAnimationFrame(() => {
      fitBlockToChildren(node.id);
      scheduleNodeLayoutSync();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [childLayoutSignature, expanded, fitBlockToChildren, node.id, scheduleNodeLayoutSync]);

  useEffect(() => {
    if (!deepEqual(node.data.params, effectiveParams)) {
      replaceNodeParams(node.id, effectiveParams);
    }
  }, [effectiveParams, node.data.params, node.id, replaceNodeParams]);

  const handleResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      beginHistoryTransaction('Resize block');
      const initialWidth = nodeRef.current?.clientWidth || node.width || 340;
      const initialHeight = nodeRef.current?.clientHeight || node.height || 360;
      const startX = event.clientX;
      const startY = event.clientY;
      const zoom = reactFlowStore.getState().transform[2] || 1;
      const minimumHeight = collapsedMinimumHeight();
      let finalWidth = initialWidth;
      let finalHeight = initialHeight;

      const handleMove = (moveEvent: globalThis.MouseEvent) => {
        finalWidth = Math.min(720, Math.max(280, initialWidth + (moveEvent.clientX - startX) / zoom));
        finalHeight = Math.max(minimumHeight, initialHeight + (moveEvent.clientY - startY) / zoom);
        setNodeSize(node.id, Math.round(finalWidth), Math.round(finalHeight));
        scheduleNodeLayoutSync();
      };
      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        setNodeUiState(node.id, {
          blockCollapsedWidth: Math.round(finalWidth),
          blockCollapsedHeight: Math.round(finalHeight),
        });
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
      setNodeSize,
      setNodeUiState,
    ],
  );

  return (
    <>
      <BlockNodeFrame
        nodeId={node.id}
        label={node.data.label || effectiveDefinition?.name || 'Block'}
        expanded={expanded}
        nodeRef={nodeRef}
        headerRef={headerRef}
        connectorRef={connectorRef}
        onResizeStart={handleResizeStart}
        actions={
          <>
            {expanded ? (
              <ModiffIconButton
                className={cx('nodrag nowheel', compositionReport.valid ? 'text-modiff-green' : 'text-modiff-red')}
                size="compact"
                label={
                  compositionReport.valid
                    ? 'Inspect User Node composition'
                    : `Inspect User Node composition: ${compositionReport.issues.length} issue${compositionReport.issues.length === 1 ? '' : 's'}`
                }
                onClick={() => setCompositionOpen(true)}
                data-testid={`user-block-composition-${node.id}`}
              >
                <ListChecks size={15} />
              </ModiffIconButton>
            ) : null}
            <ModiffIconButton
              className="nodrag nowheel"
              size="compact"
              label="Save User Node changes"
              onClick={() => setSaveChoicesOpen(true)}
              data-testid={`user-block-save-choices-${node.id}`}
            >
              <Save size={15} />
            </ModiffIconButton>
            <ModiffIconButton
              className="nodrag nowheel"
              size="compact"
              label="Configure block instance"
              onClick={() => {
                if (!effectiveDefinition) return;
                setConfiguration({
                  name: effectiveDefinition.name,
                  inputLabels: Object.fromEntries(effectiveDefinition.inputs.map((port) => [port.id, port.label])),
                  outputLabels: Object.fromEntries(effectiveDefinition.outputs.map((port) => [port.id, port.label])),
                  exposedParamIds: new Set(effectiveDefinition.exposedParams.map((input) => input.id)),
                });
              }}
              data-testid={`user-block-configure-${node.id}`}
            >
              <Settings2 size={15} />
            </ModiffIconButton>
            <ModiffIconButton
              className="nodrag nowheel"
              size="compact"
              label={expanded ? 'Collapse block' : 'Expand block'}
              onClick={handleToggleExpanded}
              data-testid={`user-block-toggle-${node.id}`}
            >
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </ModiffIconButton>
          </>
        }
        controls={
          <div className="grid gap-2" data-testid={`user-block-disclosures-${node.id}`}>
            {contentGroups.map((group) => (
              <section key={group.id} data-block-source-node={group.id}>
                {Object.keys(group.controlParams).length > 0 ? (
                  <ModiffDisclosure
                    label={group.label}
                    data-testid={`user-block-disclosure-${node.id}-${group.id}`}
                    className="rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg/60"
                    buttonClassName="min-h-8 text-xs"
                    panelClassName="grid gap-2 border-t border-modiff-border-subtle p-2"
                  >
                    <NodeContent
                      nodeId={node.id}
                      params={group.controlParams}
                      updateStore={updateStore}
                      module={group.module}
                      action={group.action}
                      mode="controls"
                    />
                  </ModiffDisclosure>
                ) : null}
                {Object.keys(group.previewParams).length > 0 ? (
                  <div
                    className="mt-2 overflow-hidden rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg p-2"
                    data-testid={`user-block-preview-${node.id}-${group.id}`}
                  >
                    <div className="mb-2 truncate text-xs font-semibold text-modiff-subtle-text">{group.label}</div>
                    <NodeContent
                      nodeId={node.id}
                      params={group.previewParams}
                      updateStore={updateStore}
                      module={group.module}
                      action={group.action}
                      mode="controls"
                    />
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        }
        connectors={
          <NodeContent
            nodeId={node.id}
            params={effectiveParams}
            updateStore={updateStore}
            module={node.data.module}
            action={node.data.action}
            mode="connectors"
          />
        }
      />
      <ModiffDialog
        open={compositionOpen}
        onClose={() => setCompositionOpen(false)}
        title="User Node composition"
        testId={`user-block-composition-dialog-${node.id}`}
        panelClassName="max-w-2xl"
        footer={<ModiffButton onClick={() => setCompositionOpen(false)}>Close</ModiffButton>}
      >
        <div className="grid gap-4 text-sm">
          <section className="grid gap-1">
            <div className="font-semibold text-modiff-text">Execution contract</div>
            <p className="text-modiff-subtle-text">
              This editable instance executes as an ordinary MoDiff graph. Socket types, container ownership, and sealed
              Modular workflow-state identity are checked before execution.
            </p>
            {effectiveDefinition?.origin?.provider === 'diffusers' ? (
              <p className="text-modiff-subtle-text">
                Upstream identity: {effectiveDefinition.origin.definitionId || 'imported Diffusers definition'} at{' '}
                {effectiveDefinition.origin.libraryRevision ||
                  effectiveDefinition.origin.revision ||
                  'its pinned revision'}
                . Ordinary node edits do not claim upstream block-tree parity; reviewed Modular block edits are rebuilt
                through Diffusers <code>init_pipeline()</code>.
              </p>
            ) : null}
          </section>

          <section className="grid gap-2" data-testid={`user-block-composition-issues-${node.id}`}>
            <div className="font-semibold text-modiff-text">
              {compositionReport.valid
                ? 'No structural connection issues found'
                : `${compositionReport.issues.length} structural issue${compositionReport.issues.length === 1 ? '' : 's'}`}
            </div>
            {compositionReport.issues.map((issue) => (
              <div
                key={issue.id}
                className="rounded-modiff-compact border border-modiff-red/40 bg-modiff-red/10 px-3 py-2 text-modiff-text"
              >
                {issue.message}
              </div>
            ))}
          </section>

          <section className="grid gap-2" data-testid={`user-block-insertion-suggestions-${node.id}`}>
            <div className="font-semibold text-modiff-text">Compatible insertion points</div>
            {compositionReport.insertionSuggestions.length ? (
              compositionReport.insertionSuggestions.slice(0, 12).map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="flex items-center justify-between gap-3 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-3 py-2"
                >
                  <span className="min-w-0 flex-1 text-modiff-subtle-text">{suggestion.label}</span>
                  <ModiffButton
                    tone="primary"
                    onClick={() => {
                      try {
                        insertNodeInUserBlock(node.id, suggestion);
                        useStudioStore.getState().saveActiveWorkflowTab(true);
                        enqueueSnackbar('The node was inserted into the compatible execution path.', {
                          variant: 'success',
                          autoHideDuration: 2600,
                        });
                      } catch (error) {
                        enqueueSnackbar(
                          error instanceof Error ? error.message : 'The compatible insertion point is unavailable.',
                          { variant: 'error', autoHideDuration: 3600 },
                        );
                      }
                    }}
                  >
                    Insert
                  </ModiffButton>
                </div>
              ))
            ) : (
              <p className="text-modiff-subtle-text">
                No disconnected node currently has both an input and output that can safely replace an existing typed
                connection.
              </p>
            )}
          </section>

          {modularCompositionSource ? (
            <section className="grid gap-2" data-testid={`reviewed-modular-composition-${node.id}`}>
              <div className="font-semibold text-modiff-text">Reviewed upstream Modular blocks</div>
              <p className="text-modiff-subtle-text">
                These actions validate an upstream block-tree modification against the exact pinned Diffusers
                definition. The backend applies the edit to <code>sub_blocks</code> and rebuilds its interface through{' '}
                <code>init_pipeline()</code>. The receipt is structural and does not silently replace this ordinary User
                Node execution graph.
              </p>
              <div className="max-h-52 overflow-y-auto rounded-modiff-compact border border-modiff-border">
                {modularCompositionSource.definition.blockPlacements.map((placement) => {
                  const path = placement.path.join('.');
                  return (
                    <div
                      key={path}
                      className="flex items-center justify-between gap-3 border-b border-modiff-border px-3 py-2 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 truncate text-modiff-subtle-text">{path}</span>
                      <ModiffButton
                        disabled={Boolean(modularCompositionBusyPath)}
                        onClick={() => {
                          setModularCompositionBusyPath(path);
                          setModularCompositionError(null);
                          void rebuildReviewedModularComposition(
                            duplicateReviewedModularBlockRecipe(modularCompositionSource, placement.path),
                          )
                            .then((receipt) => setModularCompositionReceipt(receipt))
                            .catch((error) =>
                              setModularCompositionError(
                                error instanceof Error ? error.message : 'Could not rebuild the Modular composition.',
                              ),
                            )
                            .finally(() => setModularCompositionBusyPath(null));
                        }}
                      >
                        {modularCompositionBusyPath === path ? 'Rebuilding…' : 'Validate duplicate'}
                      </ModiffButton>
                    </div>
                  );
                })}
              </div>
              {modularCompositionReceipt ? (
                <div
                  className="rounded-modiff-compact border border-modiff-green/40 bg-modiff-green/10 px-3 py-2 text-modiff-text"
                  data-testid={`reviewed-modular-composition-receipt-${node.id}`}
                >
                  Upstream <code>init_pipeline()</code> rebuild passed: {modularCompositionReceipt.composedPaths.length}{' '}
                  block paths, {modularCompositionReceipt.inputs.length} inputs,{' '}
                  {modularCompositionReceipt.outputs.length} outputs. Receipt{' '}
                  {modularCompositionReceipt.receiptHash.slice(0, 20)}…
                </div>
              ) : null}
              {modularCompositionError ? (
                <div className="rounded-modiff-compact border border-modiff-red/40 bg-modiff-red/10 px-3 py-2 text-modiff-text">
                  {modularCompositionError}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </ModiffDialog>
      <ModiffDialog
        open={saveChoicesOpen}
        onClose={() => {
          if (!savingChoice) setSaveChoicesOpen(false);
        }}
        title="Save User Node changes"
        testId={`save-user-block-choices-${node.id}`}
        panelClassName="max-w-lg"
        footer={
          <>
            <ModiffButton disabled={savingChoice} onClick={() => void handleDefinitionChoice('workflow')}>
              Keep only in this workflow
            </ModiffButton>
            <ModiffButton disabled={savingChoice} onClick={() => void handleDefinitionChoice('new')}>
              Save as new User Node
            </ModiffButton>
            <ModiffButton tone="primary" disabled={savingChoice} onClick={() => void handleDefinitionChoice('update')}>
              Update existing User Node
            </ModiffButton>
          </>
        }
      >
        <div className="grid gap-3 text-sm text-modiff-subtle-text">
          <p>The current topology, parameters, exposed ports, and model revision have been captured.</p>
          <p>
            Updating changes the reusable library definition but does not silently rewrite other workflow instances.
            Saving as new defaults to{' '}
            <strong>{contextualUserNodeName(effectiveDefinition?.name || 'User Node', workflowTitle)}</strong>.
          </p>
        </div>
      </ModiffDialog>
      <ModiffDialog
        open={Boolean(configuration)}
        onClose={() => setConfiguration(null)}
        title="Configure block instance"
        testId={`configure-user-block-${node.id}`}
        panelClassName="max-w-xl"
        footer={
          <>
            <ModiffButton onClick={() => setConfiguration(null)}>Cancel</ModiffButton>
            <ModiffButton
              tone="primary"
              disabled={!configuration?.name.trim()}
              onClick={() => {
                if (!configuration) return;
                configureBlock(node.id, configuration);
                setConfiguration(null);
              }}
            >
              Apply
            </ModiffButton>
          </>
        }
      >
        {configuration && effectiveDefinition ? (
          <div className="grid gap-4">
            <ModiffFieldShell label="Name" required>
              <ModiffInput
                value={configuration.name}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setConfiguration((current) => (current ? { ...current, name: value } : current));
                }}
              />
            </ModiffFieldShell>
            {effectiveDefinition.inputs.map((port) => (
              <ModiffFieldShell key={`input-${port.id}`} label={`Input: ${port.label}`}>
                <ModiffInput
                  value={configuration.inputLabels[port.id] ?? port.label}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setConfiguration((current) =>
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
            {effectiveDefinition.outputs.map((port) => (
              <ModiffFieldShell key={`output-${port.id}`} label={`Output: ${port.label}`}>
                <ModiffInput
                  value={configuration.outputLabels[port.id] ?? port.label}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setConfiguration((current) =>
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
            {availableExposedParams.length > 0 ? (
              <section className="grid gap-2">
                <h3 className="text-sm font-semibold text-modiff-text">Editable parameters</h3>
                {availableExposedParams.map((input) => (
                  <ModiffCheckbox
                    key={input.id}
                    label={input.label}
                    checked={configuration.exposedParamIds.has(input.id)}
                    onCheckedChange={(checked) =>
                      setConfiguration((current) => {
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
    </>
  );
});

UserBlockNode.displayName = 'UserBlockNode';

export default UserBlockNode;
