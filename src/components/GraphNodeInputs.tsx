import { useCallback, useMemo, useState } from 'react';
import { Pin, PinOff } from 'lucide-react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import {
  graphNodeControlParams,
  updateGraphNodeControl,
  revealPinnedGraphInput,
  type GraphInputCandidate,
} from '../studio/graphNodeControls';
import { formatStudioFieldValue } from '../studio/presetDiff';
import { ModiffDisclosure, StatusLine, StudioButton } from '../ui';
import { cx } from '../utils/classNames';
import NodeContent from './NodeContent';

const inspectorDisclosureMemory = new Map<string, boolean>();

export function GraphNodeInputs({
  candidates,
  nodes,
  onTogglePin,
  pinnedIds,
  pinnedInputs,
  selectedNodes,
  workflowId,
}: {
  candidates: GraphInputCandidate[];
  nodes: CustomNodeType[];
  onTogglePin: (id: string) => void;
  pinnedIds: string[];
  pinnedInputs: GraphInputCandidate[];
  selectedNodes: CustomNodeType[];
  workflowId: string | null;
}) {
  const [disclosureState, setDisclosureState] = useState<Record<string, boolean>>({});
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const groups = useMemo(() => {
    const byNode = new Map<string, { node: CustomNodeType; params: Record<string, NodeParams> }>();
    pinnedInputs.forEach((input) => {
      if (!input.nodeId || !input.paramKey) return;
      const group = byNode.get(input.nodeId) ?? { node: input.node, params: {} };
      group.params[input.paramKey] = input.param;
      byNode.set(input.nodeId, group);
    });

    if (selectedNode) {
      const selectedParams = graphNodeControlParams(selectedNode);
      byNode.set(selectedNode.id, { node: selectedNode, params: selectedParams });
    }

    const orderedNodeIds = [
      ...(selectedNode ? [selectedNode.id] : []),
      ...[...new Set([...nodes.map((node) => node.id), ...byNode.keys()])].filter((id) => id !== selectedNode?.id),
    ];
    return orderedNodeIds.flatMap((id) => {
      const group = byNode.get(id);
      return group ? [group] : [];
    });
  }, [nodes, pinnedInputs, selectedNode]);

  const updateParam = useCallback(
    (nodeId: string, param: string, value: unknown, key?: keyof NodeParams) => {
      updateGraphNodeControl(workflowId, nodeId, param, value, key);
    },
    [workflowId],
  );

  return (
    <div
      className="grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-2"
      data-testid={selectedNodes.length > 0 ? 'studio-custom-graph-inspector' : 'studio-pinned-graph-inputs'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-modiff-text">Node controls</span>
      </div>
      {selectedNodes.length > 1 ? <StatusLine>One node at a time</StatusLine> : null}
      {groups.length > 0 ? (
        groups.map(({ node, params }, index) => {
          const selected = selectedNode?.id === node.id;
          const disclosureKey = `${workflowId ?? 'unscoped'}:${node.id}`;
          const rememberedOpen = disclosureState[disclosureKey] ?? inspectorDisclosureMemory.get(disclosureKey);
          const defaultOpen = selected || (rememberedOpen ?? index === 0);
          const label = node.data.label || `${node.data.module}.${node.data.action}`;
          const fieldCount = Object.keys(params).length;

          return (
            <ModiffDisclosure
              key={`${disclosureKey}:${selected ? 'selected' : 'idle'}`}
              aria-label={`Node controls: ${label}`}
              className={cx(
                'overflow-hidden rounded-modiff-compact border bg-modiff-bg',
                selected ? 'border-hf-yellow/60' : 'border-modiff-border',
              )}
              data-testid={`studio-node-disclosure-${node.id}`}
              defaultOpen={defaultOpen}
              label={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={label}>
                    {label}
                  </span>
                  <span className="text-xs font-normal text-modiff-subtle-text">{fieldCount}</span>
                </span>
              }
              onOpenChange={(open) => {
                inspectorDisclosureMemory.set(disclosureKey, open);
                setDisclosureState((current) =>
                  current[disclosureKey] === open ? current : { ...current, [disclosureKey]: open },
                );
              }}
              panelClassName="border-t border-modiff-border-subtle p-3"
            >
              {!nodes.some(({ id }) => id === node.id) ? (
                <div className="grid gap-2" data-testid={`studio-hidden-pinned-inputs-${node.id}`}>
                  {Object.entries(params).map(([key, param]) => (
                    <p key={key} className="break-words text-xs text-modiff-subtle-text">
                      {param.label || key}: {formatStudioFieldValue(param.value ?? param.default)}
                    </p>
                  ))}
                  <StudioButton tone="secondary" onClick={() => revealPinnedGraphInput(workflowId, node)}>
                    Reveal in Block to edit
                  </StudioButton>
                </div>
              ) : fieldCount > 0 ? (
                <div className="grid min-w-0 grid-cols-1 gap-3 [&>[data-key]]:m-0 [&>[data-key]]:min-w-0">
                  <NodeContent
                    nodeId={node.id}
                    controlIdPrefix="studio-inspector"
                    params={params}
                    updateStore={(param, value, key) => updateParam(node.id, param, value, key)}
                    updateFieldActionStore={(origin, param, value, key) =>
                      updateGraphNodeControl(workflowId, node.id, param, value, key, origin)
                    }
                    module={
                      node.data.blockInstanceV2
                        ? (node.data.blockInstanceV2.definitionSnapshot.source.library ??
                          node.data.blockInstanceV2.definitionSnapshot.source.provider ??
                          'MoDiff')
                        : node.data.module
                    }
                    action={node.data.blockInstanceV2 ? 'BlockV2' : node.data.action}
                    mode="controls"
                    hidePreviews
                    executionStatus={node.data.executionStatus}
                    progressMessage={node.data.progressMessage}
                    uiStateMessage={node.data.uiState?.validationMessage ?? node.data.uiState?.errorMessage}
                  />
                </div>
              ) : (
                <StatusLine tone="secondary">No editable params</StatusLine>
              )}
            </ModiffDisclosure>
          );
        })
      ) : (
        <StatusLine tone="secondary">No pinned inputs</StatusLine>
      )}
      {candidates.length > 0 ? (
        <ModiffDisclosure
          className="border-t border-modiff-border pt-2"
          label="Pin inputs"
          buttonClassName="min-h-0 justify-start p-0 text-xs text-modiff-subtle-text hover:bg-transparent"
          panelClassName="mt-2 grid gap-1"
        >
          {candidates.map((input) => {
            const pinned = pinnedSet.has(input.id);
            return (
              <StudioButton
                key={input.id}
                tone="ghost"
                align="left"
                fullWidth
                className="min-h-8 px-2 text-xs"
                onClick={() => onTogglePin(input.id)}
                icon={
                  pinned ? (
                    <PinOff size={14} className="text-hf-yellow" />
                  ) : (
                    <Pin size={14} className="text-modiff-subtle-text" />
                  )
                }
              >
                <span className="min-w-0 flex-1 truncate">{input.label}</span>
              </StudioButton>
            );
          })}
        </ModiffDisclosure>
      ) : null}
    </div>
  );
}
