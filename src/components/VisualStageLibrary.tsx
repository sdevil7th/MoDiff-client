import { useEffect, useRef, useState } from 'react';
import { ModiffButton, ModiffDisclosure, ModiffSelect } from '../ui';
import { useNodesStore, type NodeData } from '../stores/useNodeStore';
import { assertWorkflowOperationContext, captureWorkflowOperationContext } from '../stores/useStudioStore';
import { useNodeDiscoveryStore } from '../stores/useNodeDiscoveryStore';
import { beginOperationDrag, endOperationDrag } from '../workflow/operationDrag';
import { withOperationAuthoring } from '../workflow/operationAuthoring';
import { formatRequestError } from '../utils/requestJson';
import { stageDragKey, type StageChoice, type StageMatch } from '../studio/visualNodeCatalog';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';

export default function VisualStageLibrary({
  matches,
  insert,
  searching,
}: {
  matches: StageMatch[];
  insert: (key: string, definition: NodeData) => void;
  searching: boolean;
}) {
  const [chosen, setChosen] = useState<{ match: StageMatch; index: number } | null>(null);
  const [error, setError] = useState('');
  const nodes = useFlowStore((s) => s.nodes);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function add(match: StageChoice) {
    let definition = match.definition;
    const request = new AbortController();
    pending.current?.abort();
    pending.current = request;
    setError('');
    const context = captureWorkflowOperationContext();
    const selection = useNodeDiscoveryStore.getState().selection;
    try {
      if (match.operation) {
        const node = await useNodesStore.getState().resolveOperation(match.operation, request.signal);
        if (request.signal.aborted || useNodeDiscoveryStore.getState().selection !== selection) return;
        assertWorkflowOperationContext(context);
        definition = withOperationAuthoring(node, match.operation);
      }
      insert(`${definition.module}.${definition.action}`, definition);
    } catch (e) {
      if (!request.signal.aborted) setError(formatRequestError(e, 'Could not add the selected stage.'));
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }
  return (
    <section aria-label="Workflow stages" className="grid gap-1 px-1">
      {error && (
        <p role="alert" className="px-2 text-xs text-modiff-red">
          {error}
        </p>
      )}
      {matches.map((match) => {
        const choices = match.choices;
        const index =
          chosen?.match === match
            ? chosen.index
            : choices.findIndex((item) => item.mode === match.mode && item.operation === match.operation);
        const choice = choices[index] ?? match;
        const existing = searching
          ? nodes.filter(
              (n) =>
                !n.hidden &&
                !n.data.blockProjectionOwnerId &&
                ((n.data.module + '.' + n.data.action === choice.mode.node &&
                  Object.entries(choice.mode.settings ?? {}).every(
                    ([key, value]) => (n.data.params[key]?.value ?? n.data.params[key]?.default) === value,
                  )) ||
                  n.data.blockInstanceV2?.effectiveGraph.nodes.some(
                    (member) => member.data.module + '.' + member.data.action === choice.mode.node,
                  )),
            )
          : [];
        return (
          <div key={match.stage.id} className="min-w-0 rounded-modiff-compact border border-modiff-border">
            <ModiffButton
              fullWidth
              align="left"
              disabled={match.requiresModel}
              draggable={!match.requiresModel}
              title={match.stage.summary}
              data-testid={'stage-add-' + match.stage.id}
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  'text/plain',
                  choice.operation ? beginOperationDrag(choice.operation) : stageDragKey(match.stage, choice.mode),
                );
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onDragEnd={endOperationDrag}
              onClick={() => void add(choice)}
            >
              <span data-testid={'node-row-' + choice.mode.node.replace(/\./g, '-')} className="min-w-0 break-words">
                {match.stage.label}
              </span>
            </ModiffButton>
            {choices.length > 1 ? (
              <ModiffDisclosure
                label={choice.mode === match.mode ? match.detail : choice.mode.label}
                aria-label={match.stage.label + ' actions'}
                buttonClassName="break-words text-xs"
                panelClassName="px-2 pb-1"
              >
                <ModiffSelect
                  aria-label={match.stage.label + ' action'}
                  value={String(index)}
                  options={choices.map((item, i) => ({
                    value: String(i),
                    label: item.operation ? item.mode.label + ' · ' + item.operation.operationId : item.mode.label,
                  }))}
                  onValueChange={(v) => setChosen({ match, index: Number(v) })}
                />
              </ModiffDisclosure>
            ) : (
              <p className="px-2 pb-1 text-xs text-modiff-subtle-text">{match.detail}</p>
            )}
            {existing.map((n, i) => (
              <ModiffButton
                key={n.id}
                size="compact"
                onClick={() => {
                  const { workflowTabId } = captureWorkflowOperationContext();
                  if (!workflowTabId) return;
                  const now = Date.now();
                  useSettingsStore
                    .getState()
                    .setWorkflowFocusRequest({ workflowTabId, nodeId: n.id, requestId: now, requestedAt: now });
                }}
              >
                Show on canvas{existing.length > 1 ? ' · ' + (i + 1) : ''}
              </ModiffButton>
            ))}
          </div>
        );
      })}
    </section>
  );
}
