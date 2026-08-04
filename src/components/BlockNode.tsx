import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Maximize2, Minimize2, PackageOpen, Settings2 } from 'lucide-react';
import { type NodeProps, useStoreApi, useUpdateNodeInternals } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import {
  createUserBlockNode,
  isUserBlockExpandedInstance,
  userBlockCollapsedContentGroups,
  userBlockAvailableExposedParams,
} from '../studio/userBlocks';
import { cx } from '../utils/classNames';
import { deepEqual } from '../utils/deepEqual';
import { useNodeLayoutSync } from '../utils/useNodeLayoutSync';
import {
  ModiffButton,
  ModiffCheckbox,
  ModiffDialog,
  ModiffDisclosure,
  ModiffFieldShell,
  ModiffIconButton,
  ModiffInput,
  NodeResizeGrip,
} from '../ui';
import NodeContent from './NodeContent';

const BlockNode = memo((node: NodeProps<CustomNodeType>) => {
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
  const updateStore = useCallback(
    (param: string, value: unknown, key?: keyof NodeParams) => setParam(node.id, param, value, key),
    [node.id, setParam],
  );
  const handleToggleExpanded = useCallback(() => {
    toggleExpanded(node.id);
    useStudioStore.getState().saveActiveWorkflowTab(true);
  }, [node.id, toggleExpanded]);
  const collapsedMinimumHeight = useCallback(() => {
    const headerHeight = headerRef.current?.offsetHeight ?? 44;
    const connectorHeight = connectorRef.current?.offsetHeight ?? 0;
    return Math.ceil(headerHeight + connectorHeight + 96 + 4);
  }, []);
  const syncCollapsedMinimumHeight = useCallback(() => {
    if (expanded) return;
    const minimumHeight = collapsedMinimumHeight();
    const current = useFlowStore.getState().nodes.find((candidate) => candidate.id === node.id);
    if (!current || (current.height ?? 0) >= minimumHeight) return;
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
    const observer = new ResizeObserver(syncCollapsedMinimumHeight);
    if (headerRef.current) observer.observe(headerRef.current);
    if (connectorRef.current) observer.observe(connectorRef.current);
    return () => observer.disconnect();
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
    <div
      ref={nodeRef}
      className={cx(
        'relative flex h-full w-full min-w-[260px] flex-col overflow-visible rounded-modiff-panel border-2 border-hf-yellow/60 shadow-modiff-node',
        expanded ? 'bg-hf-yellow/[0.055]' : 'bg-modiff-surface',
      )}
      data-testid={`user-block-${node.id}`}
    >
      <header
        ref={headerRef}
        className={cx(
          'flex h-11 shrink-0 items-center gap-2 rounded-t-modiff-panel border-b border-hf-yellow/25 px-3 text-sm font-bold text-modiff-text',
          expanded ? 'bg-hf-yellow/10' : 'bg-modiff-bg',
        )}
      >
        <PackageOpen size={16} className="shrink-0 text-hf-yellow" />
        <span className="min-w-0 flex-1 truncate">{node.data.label || effectiveDefinition?.name || 'Block'}</span>
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
      </header>

      {expanded ? (
        <div className="pointer-events-none min-h-0 flex-1" aria-hidden="true" />
      ) : (
        <>
          <div
            className="nowheel min-h-24 flex-1 overflow-x-hidden overflow-y-auto bg-modiff-surface p-3"
            data-testid={`user-block-controls-${node.id}`}
          >
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
          </div>
          <div ref={connectorRef} className="shrink-0">
            <NodeContent
              nodeId={node.id}
              params={effectiveParams}
              updateStore={updateStore}
              module={node.data.module}
              action={node.data.action}
              mode="connectors"
            />
          </div>
        </>
      )}

      {!expanded ? <NodeResizeGrip label="Drag to resize block" onMouseDown={handleResizeStart} /> : null}
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
    </div>
  );
});

BlockNode.displayName = 'BlockNode';

export default BlockNode;
