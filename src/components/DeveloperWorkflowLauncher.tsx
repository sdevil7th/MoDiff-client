import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  useStudioStore,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { prepareWorkflowForManualInsertion } from '../studio/manualGraphInsertion';
import { ModiffButton, ModiffDialog, ModiffDisclosure, ModiffFieldShell, ModiffSearchInput, ModiffSelect } from '../ui';
import { formatRequestError } from '../utils/requestJson';
import { workflowChoices, workflowTaskLabel } from '../workflow/workflowChoices';
import { requestOperationStarter } from '../workflow/operationStarterRequest';
import { createWorkflowDraft } from '../workflow/workflowDraft';
import { commitOperationGraph } from '../workflow/operationGraphTransaction';
import WorkflowEntryActions from './WorkflowEntryActions';
import type { OperationStarter } from '../workflow/operationAuthoring';

const CustomExtensionsDialog = lazy(() => import('./CustomExtensionsDialog'));

type Preview = {
  starter: OperationStarter;
  draft: ReturnType<typeof createWorkflowDraft>;
  context: WorkflowOperationContext;
  signature: string;
};

export default function DeveloperWorkflowLauncher() {
  const support = useNodesStore((s) => s.pipelineSupport);
  const models = useNodesStore((s) => s.studioModelCapabilities);
  const descriptors = useNodesStore((s) => s.workflowModelDescriptors);
  const operations = useNodesStore((s) => s.operationContracts);
  const registry = useNodesStore((s) => s.nodesRegistry);
  const hfCache = useNodesStore((s) => s.hfCache);
  const localModels = useNodesStore((s) => s.localModels);
  const diagnostics = useNodesStore((s) => s.modelCacheDiagnostics);
  const capabilitiesStatus = useNodesStore((s) => s.discoveryRequests.capabilities);
  const workflow = useStudioStore((s) => s.activeWorkflowTabId);
  const choices = useMemo(
    () => workflowChoices(support, models, hfCache, localModels, diagnostics, descriptors),
    [support, models, hfCache, localModels, diagnostics, descriptors],
  );
  const tasks = useMemo(
    () =>
      [...new Set(choices.map((c) => c.task))].sort((a, b) => {
        const order = ['text_to_image', 'image_to_image', 'edit_image', 'inpaint', 'outpaint'];
        return (
          (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99) ||
          a.localeCompare(b)
        );
      }),
    [choices],
  );
  const [customSource, setCustomSource] = useState<'local' | 'hub' | null>(null);
  const [task, setTask] = useState('');
  const [choiceId, setChoiceId] = useState('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const applied = useRef(false);
  const options = choices.filter((c) => c.task === task);
  const selected = options.find((c) => c.id === choiceId);
  const visibleOptions = options.filter(
    (c) =>
      c.id === choiceId ||
      `${c.label} ${c.repo ?? ''} ${c.pipeline}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setPreview(null);
    setError(null);
    applied.current = false;
    return () => {
      pending.current?.abort();
    };
  }, [task, choiceId, workflow, operations, registry]);

  const dismiss = () => prepareWorkflowForManualInsertion({ revealWorkspace: false });
  const openSetup = () => {
    dismiss();
    useSettingsStore.getState().setRightPanelTab('setup');
    useSettingsStore.getState().setRightPanelOpen(true);
  };

  async function prepare() {
    if (!selected || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const context = captureWorkflowOperationContext();
    const signature = JSON.stringify(useFlowStore.getState().toObject());
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const starter = await requestOperationStarter(
        selected.pipeline,
        task,
        operations,
        controller.signal,
        selected.profileId,
      );
      if (controller.signal.aborted) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      if (JSON.stringify(useFlowStore.getState().toObject()) !== signature)
        throw new Error('The workflow changed. Request a new preview.');
      setPreview({ starter, draft: createWorkflowDraft(starter, registry), context, signature });
    } catch (e) {
      if (!controller.signal.aborted) setError(formatRequestError(e, 'Could not prepare this workflow.'));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  function create() {
    if (!preview || applied.current) return;
    try {
      assertWorkflowOperationContext(preview.context, { includeForm: false });
      if (
        useFlowStore.getState().nodes.length ||
        JSON.stringify(useFlowStore.getState().toObject()) !== preview.signature
      )
        throw new Error('This canvas changed. Start a new workflow or request a fresh preview.');
      applied.current = true;
      // Same transaction and ordinary node factory used by the operation library.
      commitOperationGraph(preview.draft.graph, preview.context, preview.signature, 'Create workflow');
      useStudioStore.getState().detachManagedGraph();
      prepareWorkflowForManualInsertion();
      useStudioStore.getState().saveActiveWorkflowTab(true);
    } catch (e) {
      applied.current = false;
      setError(formatRequestError(e, 'Could not create this workflow.'));
    }
  }

  if (customSource)
    return (
      <Suspense fallback={null}>
        <CustomExtensionsDialog initialKind={customSource} onClose={() => setCustomSource(null)} />
      </Suspense>
    );

  return (
    <ModiffDialog
      open
      onClose={dismiss}
      title="Workflows"
      testId="task-launcher"
      panelClassName="max-w-[920px]"
      bodyClassName="max-h-[78vh]"
    >
      <p className="mb-3 text-sm text-modiff-subtle-text">
        Choose a task, select a model, and preview its connected nodes. Models load only when you run the workflow.
      </p>
      <div className="mb-4">
        <WorkflowEntryActions templates />
        <div className="mt-2 flex flex-wrap gap-2">
          <ModiffButton disabled={busy} onClick={() => setCustomSource('hub')}>
            Add from Hugging Face
          </ModiffButton>
          <ModiffButton disabled={busy} onClick={() => setCustomSource('local')}>
            Add local source
          </ModiffButton>
        </div>
      </div>
      {!task ? (
        <>
          {tasks.length ? (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
              {tasks.map((name) => (
                <ModiffButton
                  key={name}
                  tone="secondary"
                  align="left"
                  className="h-auto min-h-16 p-3"
                  onClick={() => setTask(name)}
                  data-testid={`workflow-task-${name}`}
                >
                  {workflowTaskLabel(name)}
                </ModiffButton>
              ))}
            </div>
          ) : (
            <div className="space-y-2" role="status">
              <p>
                {capabilitiesStatus.status === 'loading'
                  ? 'Loading workflow capabilities…'
                  : 'No workflow capabilities are available. Check the backend connection or retry.'}
              </p>
              {capabilitiesStatus.error ? <p role="alert">{capabilitiesStatus.error}</p> : null}
              <ModiffButton onClick={() => void useNodesStore.getState().fetchStudioModelCapabilities()}>
                Retry capabilities
              </ModiffButton>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <ModiffButton
            onClick={() => {
              setTask('');
              setChoiceId('');
              setQuery('');
            }}
          >
            All tasks
          </ModiffButton>
          <h3 className="text-base font-semibold">{workflowTaskLabel(task)}</h3>
          <ModiffSearchInput
            aria-label="Search workflow models"
            placeholder="Search models"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery('')}
          />
          <ModiffFieldShell label="Model">
            <ModiffSelect
              aria-label="Workflow model"
              value={choiceId}
              onValueChange={setChoiceId}
              options={[
                { value: '', label: 'Select a model' },
                ...visibleOptions.map((c) => ({
                  value: c.id,
                  label: `${c.cache?.runnable ? 'Downloaded · ' : ''}${c.label} · ${c.support.decomposition === 'stages' ? 'Editable nodes' : 'Whole pipeline'} · ${c.pipeline}`,
                })),
              ]}
            />
          </ModiffFieldShell>
          {selected ? (
            <>
              <p className="break-words text-sm">{selected.repo ?? selected.pipeline}</p>
              <p className="text-xs text-modiff-subtle-text">
                {selected.cache?.reason ?? 'Model files are checked when you run.'}
              </p>
              <p className="text-xs text-modiff-subtle-text">
                {selected.support.execution === 'adapter'
                  ? 'Execution adapter available. Run checks this model’s files, inputs and memory recipe.'
                  : 'Declared workflow without a reviewed model execution profile. Inspect and configure this draft before running.'}
              </p>
              {selected.support.dependencies === 'blocked' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span>Runtime setup required.</span>
                  <ModiffButton onClick={openSetup}>Open Setup</ModiffButton>
                </div>
              ) : null}
              {selected.cache && !selected.cache.runnable ? (
                <ModiffButton
                  onClick={() => {
                    dismiss();
                    useSettingsStore.getState().setModelManagerOpener({ nodeId: null, fieldKey: null });
                  }}
                >
                  Review model files
                </ModiffButton>
              ) : null}
              <ModiffButton disabled={busy} loading={busy} onClick={() => void prepare()}>
                Preview workflow
              </ModiffButton>
            </>
          ) : null}
          {busy ? <p role="status">Preparing nodes and connections…</p> : null}
          {preview ? (
            <section
              className="space-y-3 rounded-modiff-panel border border-modiff-border p-3"
              aria-label="Workflow preview"
            >
              <p className="text-sm">{preview.draft.graph.nodes.map((n) => n.data.label).join(' → ')}</p>
              <p className="text-xs text-modiff-subtle-text">
                {preview.draft.graph.nodes.length} nodes · {preview.draft.graph.edges.length} connections. Creates an
                editable workflow; nothing is executed.
              </p>
              {preview.starter.requiredInputs.length ? (
                <div>
                  <h4 className="text-sm font-semibold">Inputs to provide</h4>
                  <ul className="list-inside list-disc text-sm">
                    {preview.starter.requiredInputs.map((input) => (
                      <li key={`${input.operationId}:${input.field}`}>
                        {preview.starter.nodes.find((n) => n.operation.operationId === input.operationId)?.node.label} ·{' '}
                        {input.field}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {preview.draft.notices.map((notice) => (
                <p key={notice} role="status">
                  {notice}
                </p>
              ))}
              <ModiffDisclosure label="Implementation">
                <p className="break-words text-xs">
                  {preview.starter.pipelineClass} · {preview.starter.workflowId ?? 'Whole pipeline'}
                </p>
                <ul className="list-inside list-disc text-xs">
                  {preview.starter.nodes.map((n) => (
                    <li key={n.operation.operationId}>{n.operation.nodeKey}</li>
                  ))}
                </ul>
              </ModiffDisclosure>
              <ModiffButton tone="primary" onClick={create}>
                Create workflow
              </ModiffButton>
            </section>
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-sm">
          {error}
        </p>
      ) : null}
    </ModiffDialog>
  );
}
