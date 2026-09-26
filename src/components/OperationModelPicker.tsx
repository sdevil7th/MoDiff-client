import { useEffect, useMemo, useRef, useState } from 'react';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  useStudioStore,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import {
  operationAuthoring,
  planOperationChange,
  planPristineOperationChange,
  type OperationChangePlan,
} from '../workflow/operationAuthoring';
import { requestOperationStarter } from '../workflow/operationStarterRequest';
import { commitOperationGraph, operationGraphSignature } from '../workflow/operationGraphTransaction';
import {
  groupWorkflowModels,
  workflowChoices,
  workflowTaskLabel,
  type WorkflowChoice,
} from '../workflow/workflowChoices';
import { operationOwnsModel } from '../workflow/operationContracts';
import { rememberTaskModel } from '../workflow/taskModelPreferences';
import { ModiffButton, ModiffDialog, ModiffDisclosure, ModiffSearchInput } from '../ui';
import { formatRequestError } from '../utils/requestJson';

type Review = {
  plan: OperationChangePlan;
  context: WorkflowOperationContext;
  signature: string;
  choice: WorkflowChoice;
  restoreDefaults?: boolean;
};

function choiceLabel(choice: WorkflowChoice) {
  const repositoryParts = (choice.repo || '').split('/');
  return choice.label || repositoryParts[repositoryParts.length - 1] || choice.pipeline;
}

/** Model-first authoring over the existing ordinary/Block graph transaction. */
export default function OperationModelPicker({
  node,
  value,
  disabled,
}: {
  node: CustomNodeType;
  value: string;
  disabled?: boolean;
}) {
  const hint = operationAuthoring(node)!;
  const support = useNodesStore((s) => s.pipelineSupport);
  const models = useNodesStore((s) => s.studioModelCapabilities);
  const descriptors = useNodesStore((s) => s.workflowModelDescriptors);
  const cache = useNodesStore((s) => s.hfCache);
  const local = useNodesStore((s) => s.localModels);
  const diagnostics = useNodesStore((s) => s.modelCacheDiagnostics);
  const operations = useNodesStore((s) => s.operationContracts);
  const workflow = useStudioStore((s) => s.activeWorkflowTabId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const pending = useRef<AbortController | null>(null);
  const choices = useMemo(
    () =>
      workflowChoices(support, models, cache, local, diagnostics, descriptors).filter(
        (c) => c.task === hint.operation.task && c.repo && c.profileId,
      ),
    [support, models, cache, local, diagnostics, descriptors, hint.operation.task],
  );
  const current = choices.find((c) => c.repo === value && c.pipeline === hint.operation.pipelineClass);
  const visible = choices.filter(
    (c) =>
      (!installed || c.cache?.runnable) && `${c.label} ${c.repo}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    setOpen(false);
    return () => {
      pending.current?.abort();
    };
  }, [workflow, node.id]);

  function close() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setReview(null);
    setError(null);
    setOpen(false);
  }
  function apply(candidate: Review) {
    commitOperationGraph(
      candidate.plan.graph,
      candidate.context,
      candidate.signature,
      candidate.restoreDefaults ? 'Restore model defaults' : 'Change model',
    );
    useStudioStore.getState().saveActiveWorkflowTab(true);
    if (!candidate.restoreDefaults && candidate.choice.profileId)
      rememberTaskModel(candidate.choice.task, candidate.choice.profileId);
    close();
  }
  async function choose(choice: WorkflowChoice, restoreDefaults = false) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const context = captureWorkflowOperationContext();
    const snapshot = useFlowStore.getState().toObject();
    const signature = operationGraphSignature(snapshot);
    setBusy(true);
    setError(null);
    setReview(null);
    try {
      const starter = await requestOperationStarter(
        choice.pipeline,
        choice.task,
        operations,
        controller.signal,
        choice.profileId,
      );
      if (controller.signal.aborted) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      const baseline = node.data.blockProjectionOwnerId
        ? null
        : await requestOperationStarter(
            hint.operation.pipelineClass,
            hint.operation.task!,
            operations,
            controller.signal,
          );
      if (controller.signal.aborted) return;
      const plan = node.data.blockProjectionOwnerId
        ? (await import('../workflow/operationLegacyBlockChange')).planOwnerBlockOperationChange(
            snapshot,
            node.data.blockProjectionOwnerId,
            node.data.blockProjectionNodeId ?? node.id,
            starter,
            { replaceModel: !restoreDefaults, restoreDefaults },
          )
        : (!restoreDefaults && baseline && planPristineOperationChange(snapshot, node.id, baseline, starter)) ||
          planOperationChange(snapshot, node.id, starter, {
            replaceModel: !restoreDefaults,
            restoreDefaults,
            baseline,
          });
      if (controller.signal.aborted) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      if (operationGraphSignature(useFlowStore.getState().toObject()) !== signature)
        throw new Error('The workflow changed. Select the model again.');
      const candidate = { plan, context, signature, choice, restoreDefaults };
      if (plan.review.required) setReview(candidate);
      else apply(candidate);
    } catch (e) {
      if (!controller.signal.aborted) setError(formatRequestError(e, 'Could not change this model.'));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  const reviewFooter = review ? (
    <section className="w-full space-y-2" aria-label="Review model selection" data-testid="model-selection-review">
      <div>
        <p className="font-semibold text-modiff-text">Review selection</p>
        <p className="text-sm text-modiff-subtle-text">
          Apply {choiceLabel(review.choice)} to this workflow, or keep the current model.
        </p>
      </div>
      {review.plan.review.changes.length ? (
        <ModiffDisclosure
          label={`What will change (${review.plan.review.changes.length})`}
          buttonClassName="px-0 py-1 text-sm"
          panelClassName="pt-1"
        >
          <ul className="list-inside list-disc text-sm text-modiff-subtle-text">
            {review.plan.review.changes.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </ModiffDisclosure>
      ) : null}
      {review.plan.review.preserved.length ? (
        <ModiffDisclosure
          label={`Values and connections kept (${review.plan.review.preserved.length})`}
          buttonClassName="px-0 py-1 text-sm"
          panelClassName="pt-1"
        >
          <ul className="list-inside list-disc text-sm text-modiff-subtle-text">
            {review.plan.review.preserved.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </ModiffDisclosure>
      ) : null}
      {review.plan.review.attention.length ? (
        <ModiffDisclosure
          label={`Needs attention (${review.plan.review.attention.length})`}
          buttonClassName="px-0 py-1 text-sm"
          panelClassName="pt-1"
        >
          <ul className="list-inside list-disc text-sm text-modiff-subtle-text">
            {review.plan.review.attention.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </ModiffDisclosure>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <ModiffButton onClick={() => setReview(null)}>Keep current model</ModiffButton>
        <ModiffButton
          tone="primary"
          onClick={() => {
            try {
              apply(review);
            } catch (e) {
              setError(formatRequestError(e, 'Could not apply the model change.'));
            }
          }}
        >
          Apply model change
        </ModiffButton>
      </div>
    </section>
  ) : undefined;

  return (
    <>
      <ModiffButton
        aria-label="Choose model"
        className="w-full"
        align="left"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={value}
      >
        <span className="min-w-0 truncate">{current ? choiceLabel(current) : value || 'Choose model'}</span>
      </ModiffButton>
      {current &&
      operations.some(
        (o) =>
          o.pipelineClass === hint.operation.pipelineClass && o.task === hint.operation.task && !operationOwnsModel(o),
      ) ? (
        <ModiffButton
          disabled={disabled || busy}
          onClick={() => {
            setOpen(true);
            void choose(current, true);
          }}
          title="Reset unconnected prompts and generation controls; keep model, memory settings, media and custom nodes. Undo is available."
        >
          Restore model defaults
        </ModiffButton>
      ) : null}
      {open ? (
        <ModiffDialog
          open
          onClose={close}
          title="Choose model for Load Models"
          panelClassName="max-w-3xl"
          footer={reviewFooter}
        >
          <div className="space-y-3">
            <p className="text-sm text-modiff-subtle-text">
              {workflowTaskLabel(hint.operation.task ?? '')}. Selecting a model updates its connected nodes. Nothing is
              downloaded or executed.
            </p>
            <ModiffSearchInput
              aria-label="Search compatible models"
              placeholder="Search by model or repository"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery('')}
            />
            <div className="flex gap-2">
              <ModiffButton tone={installed ? 'secondary' : 'primary'} onClick={() => setInstalled(false)}>
                All supported
              </ModiffButton>
              <ModiffButton tone={installed ? 'primary' : 'secondary'} onClick={() => setInstalled(true)}>
                Downloaded
              </ModiffButton>
            </div>
            {error ? <p role="alert">{error}</p> : null}
            {busy ? <p role="status">Updating model and node contracts…</p> : null}
            <div
              className="grid max-h-[min(24rem,50dvh)] gap-2 overflow-y-auto overscroll-contain pr-1"
              aria-label="Compatible models"
            >
              {groupWorkflowModels(visible, current?.id).map(({ id, primary: choice, routes }) => (
                <div
                  key={id}
                  className="overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-panel"
                >
                  <ModiffButton
                    aria-pressed={review?.choice.id === choice.id || (!review && current?.id === choice.id)}
                    className="h-auto w-full rounded-none p-3"
                    align="left"
                    disabled={busy}
                    onClick={() => void choose(choice)}
                    tone={review?.choice.id === choice.id ? 'primary' : 'ghost'}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{choiceLabel(choice)}</span>
                      <span className="block break-all text-xs text-modiff-subtle-text">{choice.repo}</span>
                    </span>
                    <span className="ml-auto flex shrink-0 flex-col items-end gap-1 text-xs text-modiff-subtle-text">
                      {choice.cache?.runnable ? (
                        <span className="rounded-modiff-compact bg-modiff-selected-surface px-2 py-1 text-hf-yellow">
                          Downloaded
                        </span>
                      ) : null}
                      <span>{choice.support.decomposition === 'stages' ? 'Editable nodes' : 'Whole pipeline'}</span>
                      {choice.support.dependencies === 'blocked' ? <span>Runtime setup required</span> : null}
                    </span>
                  </ModiffButton>
                  {routes.length > 1 ? (
                    <ModiffDisclosure
                      label={
                        <span className="flex items-center justify-between gap-2">
                          <span>Other implementations</span>
                          <span className="text-modiff-subtle-text">{routes.length - 1}</span>
                        </span>
                      }
                      className="border-t border-modiff-border"
                      buttonClassName="rounded-none px-3 py-2 text-xs"
                      panelClassName="grid gap-1 border-t border-modiff-border bg-modiff-bg/40 p-2"
                    >
                      {routes.slice(1).map((route) => (
                        <ModiffButton
                          key={route.id}
                          aria-pressed={review?.choice.id === route.id}
                          align="left"
                          className="h-auto w-full justify-between px-2 py-2"
                          disabled={busy}
                          onClick={() => void choose(route)}
                          tone={review?.choice.id === route.id ? 'primary' : 'ghost'}
                        >
                          <span>{route.support.decomposition === 'stages' ? 'Editable nodes' : 'Whole pipeline'}</span>
                          <span className="min-w-0 break-words text-xs text-modiff-subtle-text">
                            {choiceLabel(route)} · {route.pipeline} · {route.profileId}
                          </span>
                        </ModiffButton>
                      ))}
                    </ModiffDisclosure>
                  ) : null}
                </div>
              ))}
              {!visible.length ? <p role="status">No compatible models match these filters.</p> : null}
            </div>
          </div>
        </ModiffDialog>
      ) : null}
    </>
  );
}
