import { Boxes, ChevronDown, FileOutput, PencilRuler, Play, Plus, SlidersHorizontal } from 'lucide-react';
import { cx } from '../utils/classNames';
import { useEffect, useRef, useState } from 'react';
import { ModiffButton, ModiffSelect } from '../ui';
import { useNodesStore, type NodeData } from '../stores/useNodeStore';
import { assertWorkflowOperationContext, captureWorkflowOperationContext } from '../stores/useStudioStore';
import { useNodeDiscoveryStore } from '../stores/useNodeDiscoveryStore';
import { beginOperationDrag, endOperationDrag } from '../workflow/operationDrag';
import { withOperationAuthoring } from '../workflow/operationAuthoring';
import { formatRequestError } from '../utils/requestJson';
import { stageDragKey, type StageChoice, type StageMatch } from '../studio/visualNodeCatalog';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';

// These are browse headings only. The backend catalog owns the actions and ports.
const STAGE_SECTIONS = [
  {
    title: 'Setup & inputs',
    icon: Boxes,
    ids: [
      'model-setup',
      'media-input',
      'encode-inputs',
      'references',
      'prepare-mask',
      'control-map',
      'storyboard',
      'parameter-set',
    ],
  },
  {
    title: 'Generate',
    icon: Play,
    ids: [
      'generate-image',
      'edit-image',
      'inpaint-image',
      'generate-video',
      'generate-audio',
      'generate-text',
      'transcribe-audio',
      'render-3d',
    ],
  },
  {
    title: 'Process',
    icon: SlidersHorizontal,
    ids: [
      'process-image',
      'process-video',
      'process-audio',
      'upscale',
      'predict-map',
      'separate-layers',
      'composite',
      'assemble-clips',
      'text-data',
      'collection',
    ],
  },
  { title: 'Outputs', icon: FileOutput, ids: ['preview', 'export', 'compare'] },
];

export default function VisualStageLibrary({
  matches,
  insert,
  searchQuery,
}: {
  matches: StageMatch[];
  insert: (key: string, definition: NodeData) => void;
  searchQuery: string;
}) {
  const [chosen, setChosen] = useState<Record<string, { query: string; choice: StageChoice }>>({});
  const searching = Boolean(searchQuery);
  const [expanded, setExpanded] = useState<string | null>(null);
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
  const sections = searching
    ? [{ title: 'Matching stages', icon: Boxes, matches }]
    : [
        ...STAGE_SECTIONS.map((section) => ({
          ...section,
          matches: matches.filter(({ stage }) => section.ids.includes(stage.id)),
        })),
        {
          title: 'Specialist stages',
          icon: PencilRuler,
          matches: matches.filter(({ stage }) => !STAGE_SECTIONS.some((s) => s.ids.includes(stage.id))),
        },
      ];
  return (
    <section aria-label="Workflow stages" className="grid gap-3 px-1">
      {error && (
        <p role="alert" className="px-2 text-xs text-modiff-red">
          {error}
        </p>
      )}
      {sections
        .filter((section) => section.matches.length)
        .map(({ title, icon: Icon, matches: rows }) => (
          <section key={title} aria-label={title}>
            <h3 className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold text-modiff-subtle-text">
              <Icon size={13} className="text-hf-yellow" aria-hidden />
              {title}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] gap-1">
              {rows.map((match) => {
                const choices = match.choices;
                const saved = chosen[match.stage.id];
                const selected = saved?.query === searchQuery ? saved.choice : undefined;
                const choice =
                  choices.find(
                    (c) =>
                      c.mode.node === selected?.mode.node &&
                      c.mode.label === selected.mode.label &&
                      c.operation?.operationId === selected.operation?.operationId,
                  ) ?? match;
                const detail = choice === match ? match.detail : choice.mode.label;
                const showDetail = detail.toLowerCase() !== match.stage.label.toLowerCase();
                const isExpanded = expanded === match.stage.id;
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
                  <div
                    key={match.stage.id}
                    className="min-w-0 self-start rounded-modiff-compact border border-modiff-border bg-modiff-surface"
                  >
                    <div className="flex min-w-0 items-stretch">
                      <ModiffButton
                        tone="ghost"
                        align="left"
                        className="group h-auto min-h-10 min-w-0 flex-1 gap-2 px-2.5 py-1.5"
                        disabled={match.requiresModel}
                        draggable={!match.requiresModel}
                        title={match.stage.summary}
                        data-testid={'stage-add-' + match.stage.id}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            'text/plain',
                            choice.operation
                              ? beginOperationDrag(choice.operation)
                              : stageDragKey(match.stage, choice.mode),
                          );
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onDragEnd={endOperationDrag}
                        onClick={() => void add(choice)}
                      >
                        <Plus
                          size={14}
                          aria-hidden
                          className="shrink-0 text-modiff-subtle-text group-hover:text-hf-yellow"
                        />
                        <span className="min-w-0">
                          <span
                            data-testid={'node-row-' + choice.mode.node.replace(/\./g, '-')}
                            className="block break-words text-sm font-semibold text-modiff-text"
                          >
                            {match.stage.label}
                          </span>
                          {showDetail && (
                            <span className="block break-words text-xs font-normal text-modiff-subtle-text">
                              {detail}
                            </span>
                          )}
                        </span>
                      </ModiffButton>
                      {choices.length > 1 && (
                        <ModiffButton
                          size="compact"
                          tone="ghost"
                          className="h-auto shrink-0 self-stretch px-2 text-modiff-subtle-text"
                          aria-label={match.stage.label + ' actions'}
                          title={'Choose an action for ' + match.stage.label}
                          aria-expanded={isExpanded}
                          onClick={() => setExpanded(isExpanded ? null : match.stage.id)}
                        >
                          <ChevronDown size={14} aria-hidden className={cx(isExpanded && 'rotate-180')} />
                        </ModiffButton>
                      )}
                    </div>
                    {choices.length > 1 && isExpanded && (
                      <div className="border-t border-modiff-border p-1.5">
                        <ModiffSelect
                          aria-label={match.stage.label + ' action'}
                          value={String(
                            choices.findIndex(
                              (item) => item.mode === choice.mode && item.operation === choice.operation,
                            ),
                          )}
                          options={choices.map((item, i) => ({
                            value: String(i),
                            label: item.operation
                              ? item.mode.label + ' · ' + item.operation.operationId
                              : item.mode.label,
                          }))}
                          onValueChange={(value) => {
                            const selectedChoice = choices[Number(value)];
                            if (selectedChoice)
                              setChosen((previous) => ({
                                ...previous,
                                [match.stage.id]: { query: searchQuery, choice: selectedChoice },
                              }));
                          }}
                        />
                      </div>
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
            </div>
          </section>
        ))}
    </section>
  );
}
