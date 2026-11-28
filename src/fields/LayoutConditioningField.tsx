import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldProps } from '../components/NodeContent';
import config from '../../app.config';
import { useFlowStore } from '../stores/useFlowStore';
import { captureWorkflowOperationContext, workflowOperationContextIsCurrent } from '../stores/useStudioStore';
import { requestJson } from '../utils/requestJson';
import { layoutReferenceContext, validateLayoutReferenceRun } from '../studio/layoutReferenceContext';
import {
  MAX_LAYOUT_REGIONS,
  nextLayoutRegionId,
  parseLayoutConditioning,
  parseLayoutConditioningEdit,
  parseLayoutConditioningSupport,
  parseLayoutReferenceSummary,
  validateLayoutConditioningSupport,
  type LayoutBox,
  type LayoutConditioning,
  type LayoutConditioningSupport,
  type LayoutRegion,
  type LayoutReferenceSummary,
} from '../studio/layoutConditioning';
import {
  FieldFrame,
  ModiffButton,
  ModiffCheckbox,
  ModiffFieldShell,
  ModiffInput,
  ModiffRadioGroup,
  ModiffSelect,
  ModiffTextarea,
} from '../ui';

const EMPTY_LAYOUT: LayoutConditioning = {
  schemaVersion: 1,
  coordinateSpace: 'normalized_xyxy',
  regions: [],
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The structured layout is invalid.';
}

function BoxInputs({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset className="grid min-w-0 grid-cols-2 gap-2">
      <legend className="col-span-2 mb-1 text-modiff-label font-semibold text-modiff-subtle-text">{label}</legend>
      {['Left', 'Top', 'Right', 'Bottom'].map((corner, index) => (
        <ModiffFieldShell key={corner} label={`${label} ${corner.toLowerCase()}`}>
          <ModiffInput
            type="number"
            min={0}
            max={1}
            step="any"
            value={value[index]}
            onChange={(event) =>
              onChange(value.map((item, position) => (position === index ? event.target.value : item)))
            }
          />
        </ModiffFieldShell>
      ))}
    </fieldset>
  );
}

function draftBox(values: string[]): LayoutBox {
  if (values.some((value) => !value.trim())) throw new Error('Enter all four box coordinates.');
  return values.map(Number) as [number, number, number, number];
}

export function LayoutRegionEditor({
  region,
  support,
  disabled,
  onApply,
  onCancel,
}: {
  region: LayoutRegion;
  support: LayoutConditioningSupport;
  disabled: boolean;
  onApply: (region: LayoutRegion) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(region.id);
  const [description, setDescription] = useState(region.description);
  const [target, setTarget] = useState((region.targetBox ?? [0, 0, 1, 1]).map(String));
  const [action, setAction] = useState(region.action ?? 'place');
  const [hasSource, setHasSource] = useState(Boolean(region.source));
  const [reference, setReference] = useState(String(region.source?.referenceIndex ?? 0));
  const [sourceBox, setSourceBox] = useState((region.source?.box ?? [0, 0, 1, 1]).map(String));
  const [error, setError] = useState('');
  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-2 rounded-modiff-compact border border-modiff-border p-2">
      <legend className="px-1 text-modiff-label font-semibold text-modiff-text">Edit region</legend>
      <ModiffFieldShell label="Region ID" description="Use this ID in the prompt as a tag, for example <subject>.">
        <ModiffInput value={id} onChange={(event) => setId(event.target.value)} maxLength={64} />
      </ModiffFieldShell>
      <ModiffFieldShell label="Region description">
        <ModiffTextarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} />
      </ModiffFieldShell>
      {support.schemaVersion === 2 ? (
        <ModiffFieldShell label="Region action">
          <ModiffSelect
            aria-label="Region action"
            value={action}
            options={[
              { value: 'place', label: 'Place' },
              { value: 'relocate', label: 'Relocate from source', disabled: !support.sourceRegions },
              { value: 'remove', label: 'Remove from source', disabled: !support.sourceRegions },
            ]}
            onValueChange={(value) => {
              setAction(value as 'place' | 'relocate' | 'remove');
              setHasSource(value !== 'place');
            }}
          />
        </ModiffFieldShell>
      ) : null}
      {action !== 'remove' ? <BoxInputs label="Target box" value={target} onChange={setTarget} /> : null}
      <p className="text-modiff-metadata text-modiff-subtle-text">
        Coordinates run from 0 to 1, from the top-left corner.
      </p>
      {support.sourceRegions && support.schemaVersion === 1 ? (
        <ModiffCheckbox label="Use a source region" checked={hasSource} onCheckedChange={setHasSource} />
      ) : (
        <p className="text-modiff-metadata text-modiff-subtle-text">
          {support.sourceRegions
            ? 'Source boxes use the actual encoded reference frame.'
            : 'Source regions are unavailable for this input.'}
        </p>
      )}
      {hasSource ? (
        <>
          <ModiffFieldShell label="Source reference index">
            {support.sourceRegions && support.schemaVersion === 2 ? (
              <ModiffSelect
                aria-label="Source reference index"
                value={reference}
                onValueChange={setReference}
                options={support.references.map((item, index) => ({
                  value: String(index),
                  label: `Reference ${index}: ${item.sourceSize.join('×')} → ${item.processedSize.join('×')}`,
                }))}
              />
            ) : (
              <ModiffInput
                type="number"
                min={0}
                max={support.sourceRegions && support.schemaVersion === 1 ? support.referenceCount - 1 : 7}
                step={1}
                value={reference}
                disabled={!support.sourceRegions}
                onChange={(event) => setReference(event.target.value)}
              />
            )}
          </ModiffFieldShell>
          <BoxInputs label="Source box" value={sourceBox} onChange={setSourceBox} />
          <ModiffButton
            onClick={() => {
              setHasSource(false);
              setAction('place');
            }}
          >
            Remove source region
          </ModiffButton>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-modiff-metadata text-modiff-invalid">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ModiffButton
          tone="primary"
          onClick={() => {
            try {
              if (hasSource && !reference.trim()) throw new Error('Enter a source reference index.');
              const parsed = parseLayoutConditioning({
                ...EMPTY_LAYOUT,
                schemaVersion: support.schemaVersion,
                regions: [
                  {
                    id,
                    description,
                    targetBox: action === 'remove' ? null : draftBox(target),
                    ...(support.schemaVersion === 2 ? { action } : {}),
                    ...(hasSource
                      ? {
                          source: {
                            referenceIndex: Number(reference),
                            box: draftBox(sourceBox),
                            ...(support.schemaVersion === 2
                              ? {
                                  expectedReferenceId: support.sourceRegions
                                    ? support.references[Number(reference)]?.referenceId
                                    : region.source?.expectedReferenceId,
                                }
                              : {}),
                          },
                        }
                      : {}),
                  },
                ],
              })!;
              validateLayoutConditioningSupport(parsed, support);
              onApply(parsed.regions[0]!);
            } catch (error) {
              setError(errorMessage(error));
            }
          }}
        >
          Apply region
        </ModiffButton>
        <ModiffButton onClick={onCancel}>Cancel</ModiffButton>
      </div>
    </fieldset>
  );
}

export default function LayoutConditioningField(props: FieldProps) {
  const [editing, setEditing] = useState<{ index: number; region: LayoutRegion; base: string } | null>(null);
  const [error, setError] = useState('');
  const [referenceState, setReferenceState] = useState<{ key: string; summary: LayoutReferenceSummary } | null>(null);
  const [loadingReferences, setLoadingReferences] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const referenceContext = useMemo(
    () => layoutReferenceContext(nodes, edges, props.nodeId, props.fieldKey),
    [nodes, edges, props.nodeId, props.fieldKey],
  );
  const currentReferences = referenceState?.key === referenceContext?.key ? referenceState?.summary : null;
  const effectiveValue = props.value === undefined ? (props.default ?? null) : props.value;
  let support: LayoutConditioningSupport | null = null;
  let layout: LayoutConditioning | null = null;
  let invalid = '';
  try {
    support = parseLayoutConditioningSupport(props.fieldOptions?.layoutConditioning);
    if (
      support.schemaVersion === 2 &&
      !support.sourceRegions &&
      support.supportsBoundSourceRegions &&
      currentReferences
    )
      support = { schemaVersion: 2, sourceRegions: true, references: currentReferences.references };
    layout = parseLayoutConditioning(effectiveValue);
    validateLayoutConditioningSupport(layout, support);
  } catch (error) {
    invalid = errorMessage(error);
  }
  const commit = (value: LayoutConditioning | null) => {
    if (props.disabled || !support) return;
    try {
      const parsed = parseLayoutConditioningEdit(value, layout, support);
      props.updateStore(props.fieldKey, parsed);
      setError('');
      setEditing(null);
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const regions = layout?.regions ?? [];
  const layoutKey = JSON.stringify(layout);
  const staleEditing = editing !== null && editing.base !== layoutKey;
  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="nodrag nowheel grid min-w-0 gap-2"
    >
      <p className="text-modiff-label font-semibold text-modiff-text">{props.label}</p>
      <ModiffRadioGroup
        aria-label={`${props.label} mode`}
        value={effectiveValue === null ? 'raw' : 'structured'}
        disabled={props.disabled || !support}
        options={[
          { value: 'raw', label: 'Raw prompt' },
          { value: 'structured', label: 'Structured layout' },
        ]}
        onValueChange={(value) =>
          commit(value === 'raw' ? null : { ...EMPTY_LAYOUT, schemaVersion: support?.schemaVersion ?? 1 })
        }
      />
      <p className="text-modiff-metadata text-modiff-subtle-text">
        The prompt stays unchanged. The selected backend combines it with structured regions when running.
      </p>
      {support?.schemaVersion === 2 && (support.sourceRegions || support.supportsBoundSourceRegions) ? (
        <div className="grid gap-1">
          <ModiffButton
            disabled={props.disabled || !referenceContext || loadingReferences}
            onClick={async () => {
              if (!referenceContext) return;
              const context = referenceContext;
              const workflow = captureWorkflowOperationContext();
              request.current?.abort();
              const controller = new AbortController();
              request.current = controller;
              setLoadingReferences(true);
              try {
                const summary = await requestJson(
                  `${config.serverAddress}/cache/${encodeURIComponent(context.summaryNodeId)}/layout_reference_summary`,
                  { signal: controller.signal, parse: parseLayoutReferenceSummary },
                );
                if (!summary.taskId) throw new Error('The cached references have no task identity.');
                const run = await requestJson(`${config.serverAddress}/runs/${encodeURIComponent(summary.taskId)}`, {
                  signal: controller.signal,
                });
                validateLayoutReferenceRun(run, summary, context, props.nodeId, props.fieldKey, workflow.workflowTabId);
                const live = useFlowStore.getState();
                if (
                  !workflowOperationContextIsCurrent(workflow, { includeForm: false }) ||
                  layoutReferenceContext(live.nodes, live.edges, props.nodeId, props.fieldKey)?.key !== context.key
                )
                  return;
                setReferenceState({ key: context.key, summary });
                setEditing(null);
                setError('');
              } catch (error) {
                if (!controller.signal.aborted && workflowOperationContextIsCurrent(workflow, { includeForm: false }))
                  setError(`Encode the connected reference images first. ${errorMessage(error)}`);
              } finally {
                if (request.current === controller) setLoadingReferences(false);
              }
            }}
          >
            {loadingReferences ? 'Reading encoded references…' : 'Read encoded references'}
          </ModiffButton>
          <p role="status" className="break-words text-modiff-metadata text-modiff-subtle-text">
            {currentReferences
              ? `${currentReferences.references.length} encoded references${currentReferences.taskId ? ` from task ${currentReferences.taskId}` : ''}. Source changes require a new encoding and explicit rebind.`
              : referenceState
                ? 'Reference context changed. Encode again and read the new references before rebinding.'
                : 'Connect and encode reference images, then read their actual identities. This does not grant execution readiness.'}
          </p>
        </div>
      ) : null}
      {invalid || error ? (
        <p role="alert" className="text-modiff-metadata text-modiff-invalid">
          {error || invalid}
        </p>
      ) : null}
      {layout && support ? (
        <>
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label="Target region layout"
            className="aspect-square w-full rounded-modiff-compact border border-modiff-border bg-modiff-bg"
          >
            {regions
              .filter((region) => region.targetBox !== null)
              .map((region) => (
                <g key={region.id}>
                  <rect
                    x={region.targetBox![0] * 100}
                    y={region.targetBox![1] * 100}
                    width={(region.targetBox![2] - region.targetBox![0]) * 100}
                    height={(region.targetBox![3] - region.targetBox![1]) * 100}
                    className="fill-hf-yellow/10 stroke-hf-yellow"
                    strokeWidth={0.5}
                  >
                    <title>{`${region.id}: ${region.description}`}</title>
                  </rect>
                </g>
              ))}
          </svg>
          <ol aria-label="Layout regions" className="grid min-w-0 gap-2">
            {regions.map((region, index) => (
              <li key={region.id} className="grid min-w-0 gap-1 rounded-modiff-compact border border-modiff-border p-2">
                <p className="break-words text-modiff-control text-modiff-text">{region.id}</p>
                <p className="break-words whitespace-pre-wrap text-modiff-metadata text-modiff-subtle-text">
                  {region.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  <ModiffButton
                    disabled={props.disabled}
                    onClick={() => setEditing({ index, region, base: layoutKey })}
                  >
                    Edit {region.id}
                  </ModiffButton>
                  <ModiffButton
                    disabled={props.disabled || index === 0}
                    aria-label={`Move ${region.id} up`}
                    onClick={() => {
                      const next = [...regions];
                      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                      commit({ ...layout, regions: next });
                    }}
                  >
                    Up
                  </ModiffButton>
                  <ModiffButton
                    disabled={props.disabled || index === regions.length - 1}
                    aria-label={`Move ${region.id} down`}
                    onClick={() => {
                      const next = [...regions];
                      [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                      commit({ ...layout, regions: next });
                    }}
                  >
                    Down
                  </ModiffButton>
                  <ModiffButton
                    disabled={props.disabled}
                    onClick={() => commit({ ...layout, regions: regions.filter((_, position) => position !== index) })}
                  >
                    Remove {region.id}
                  </ModiffButton>
                </div>
              </li>
            ))}
          </ol>
          {staleEditing ? (
            <div className="grid gap-2">
              <p role="alert" className="text-modiff-metadata text-modiff-invalid">
                The layout changed while you were editing. Cancel this draft and reopen the current region.
              </p>
              <ModiffButton onClick={() => setEditing(null)}>Cancel stale draft</ModiffButton>
            </div>
          ) : editing ? (
            <LayoutRegionEditor
              key={`${editing.index}:${JSON.stringify(editing.region)}`}
              region={editing.region}
              support={support}
              disabled={props.disabled}
              onApply={(region) => {
                const next = [...regions];
                next[editing.index] = region;
                commit({ ...layout, regions: next });
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <ModiffButton
              disabled={props.disabled || Boolean(invalid) || regions.length >= MAX_LAYOUT_REGIONS}
              onClick={() =>
                setEditing({
                  index: regions.length,
                  region: {
                    id: nextLayoutRegionId(regions),
                    description: '',
                    targetBox: [0, 0, 1, 1],
                    ...(support.schemaVersion === 2 ? { action: 'place' } : {}),
                  },
                  base: layoutKey,
                })
              }
            >
              Add region
            </ModiffButton>
          )}
        </>
      ) : null}
    </FieldFrame>
  );
}
