import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  useStudioStore,
} from '../stores/useStudioStore';
import { prepareWorkflowForManualInsertion } from '../studio/manualGraphInsertion';
import { ModiffButton, ModiffCheckbox, ModiffDialog, ModiffSearchInput } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { formatRequestError } from '../utils/requestJson';
import { workflowChoices, workflowTaskLabel } from '../workflow/workflowChoices';
import {
  WORKFLOW_CATEGORIES,
  matchesWorkflowTask,
  workflowTaskCards,
  type WorkflowCategory,
} from '../workflow/workflowTaskBrowser';
import { requestTaskStarter } from '../workflow/operationStarterRequest';
import { preferredTaskModel } from '../workflow/taskModelPreferences';
import { createWorkflowDraft } from '../workflow/workflowDraft';
import WorkflowFileImportButton from './WorkflowFileImportButton';
import { commitOperationGraph } from '../workflow/operationGraphTransaction';

const CustomExtensionsDialog = lazy(() => import('./CustomExtensionsDialog'));

export default function DeveloperWorkflowLauncher({ embedded = false }: { embedded?: boolean }) {
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
  const cards = useMemo(() => workflowTaskCards(choices), [choices]);
  const [category, setCategory] = useState<WorkflowCategory | 'All'>('Image');
  const [query, setQuery] = useState('');
  const [moreTasks, setMoreTasks] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [customSource, setCustomSource] = useState<'hub' | 'local' | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [workflow],
  );
  const dismiss = () => {
    pending.current?.abort();
    prepareWorkflowForManualInsertion({ revealWorkspace: false });
  };

  async function create(task: string) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const context = captureWorkflowOperationContext();
    const signature = JSON.stringify(useFlowStore.getState().toObject());
    setBusy(task);
    setError(null);
    try {
      const { starter, unbound, message } = await requestTaskStarter(task, operations, {
        signal: controller.signal,
        preferredProfileId: preferredTaskModel(task),
        resourceMode: useStudioStore.getState().form.resourceMode,
      });
      if (controller.signal.aborted) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      if (
        (!embedded && useFlowStore.getState().nodes.length) ||
        JSON.stringify(useFlowStore.getState().toObject()) !== signature
      )
        throw new Error('The canvas changed. Start a new workflow before choosing a task.');
      const draft = createWorkflowDraft(starter, registry);
      if (embedded) {
        useStudioStore.getState().createWorkflowTab(workflowTaskLabel(task));
        commitOperationGraph(
          draft.graph,
          captureWorkflowOperationContext(),
          JSON.stringify(useFlowStore.getState().toObject()),
          'Create workflow',
        );
      } else {
        commitOperationGraph(draft.graph, context, signature, 'Create workflow');
      }
      useStudioStore.getState().detachManagedGraph();
      prepareWorkflowForManualInsertion();
      const id = useStudioStore.getState().activeWorkflowTabId;
      if (id) {
        useStudioStore.getState().renameWorkflowTab(id, workflowTaskLabel(task));
        const now = Date.now();
        useSettingsStore
          .getState()
          .setWorkflowFocusRequest({ workflowTabId: id, nodeId: null, requestId: now, requestedAt: now });
      }
      useStudioStore.getState().saveActiveWorkflowTab(true);
      if (unbound) enqueueSnackbar(message, { variant: 'info', autoHideDuration: 8000 });
    } catch (e) {
      if (!controller.signal.aborted) setError(formatRequestError(e, 'Could not create this workflow.'));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy('');
      }
    }
  }
  const searching = query.trim().length > 0;
  const matches = cards.filter(
    (c) =>
      (searching || category === 'All' || c.category === category) &&
      (!downloaded || c.downloaded) &&
      matchesWorkflowTask(c, query),
  );
  const hasMoreTasks =
    !searching && matches.some((card) => card.specialist) && matches.some((card) => !card.specialist);
  const visible = hasMoreTasks && !moreTasks ? matches.filter((card) => !card.specialist) : matches;
  if (customSource)
    return (
      <Suspense fallback={null}>
        <CustomExtensionsDialog initialKind={customSource} onClose={() => setCustomSource(null)} />
      </Suspense>
    );
  const content = (
    <div className="space-y-4">
      <p className="text-sm text-modiff-subtle-text">
        Choose a task to create its connected nodes. Change the model and parameters on the canvas. Models load only
        when you run.
      </p>
      {!embedded ? (
        <div className="flex flex-wrap gap-2">
          <ModiffButton
            onClick={() => {
              if (embedded) useStudioStore.getState().createWorkflowTab('');
              prepareWorkflowForManualInsertion();
            }}
            disabled={Boolean(busy)}
            data-testid="launcher-mode-advanced_workflow"
          >
            Empty workflow
          </ModiffButton>
          <ModiffButton
            onClick={() => {
              dismiss();
              useSettingsStore.getState().setWorkflowLibraryView('saved');
              useSettingsStore.getState().setLeftPanelTabIndex(4);
              useSettingsStore.getState().setLeftPanelOpen(true);
            }}
            disabled={Boolean(busy)}
          >
            Open saved workflow
          </ModiffButton>
          <WorkflowFileImportButton onImported={dismiss} />
          <ModiffButton
            onClick={() => {
              dismiss();
              useSettingsStore.getState().setTemplateBrowserOpen(true);
            }}
            disabled={Boolean(busy)}
          >
            Browse templates
          </ModiffButton>
        </div>
      ) : null}
      <ModiffSearchInput
        aria-label="Search workflow tasks"
        placeholder="Search workflows and actions"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery('')}
      />
      <div className="flex flex-wrap gap-2" aria-label="Workflow categories">
        {(['All', ...WORKFLOW_CATEGORIES] as const).map((name) => (
          <ModiffButton
            key={name}
            tone={(!searching && category === name) || (searching && name === 'All') ? 'primary' : 'secondary'}
            aria-pressed={searching ? name === 'All' : category === name}
            onClick={() => {
              setCategory(name);
              setQuery('');
              setMoreTasks(false);
            }}
          >
            {name}
          </ModiffButton>
        ))}
      </div>
      {searching && (
        <p className="text-sm text-modiff-subtle-text" role="status">
          {WORKFLOW_CATEGORIES.map((name) => ({ name, count: matches.filter((item) => item.category === name).length }))
            .filter(({ count }) => count > 0)
            .map(({ name, count }) => `${name} (${count})`)
            .join(' · ')}
        </p>
      )}
      <ModiffCheckbox checked={downloaded} onCheckedChange={setDownloaded} label="With downloaded models" />
      {error ? <p role="alert">{error}</p> : null}
      {busy ? <p role="status">Creating {workflowTaskLabel(busy).toLowerCase()} workflow…</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((card) => (
          <ModiffButton
            key={card.task}
            tone="secondary"
            align="left"
            className="h-auto min-h-24 p-4"
            disabled={Boolean(busy)}
            onClick={() => void create(card.task)}
            data-testid={`workflow-task-${card.task}`}
          >
            <span className="block">
              <span className="block font-semibold">{card.label}</span>
              {card.description && (
                <span className="mt-1 block text-sm font-normal text-modiff-subtle-text">{card.description}</span>
              )}
            </span>
          </ModiffButton>
        ))}
      </div>
      {hasMoreTasks && (
        <ModiffButton aria-expanded={moreTasks} onClick={() => setMoreTasks(!moreTasks)}>
          {moreTasks
            ? 'Hide additional image tasks'
            : `More image tasks and guidance (${matches.filter((card) => card.specialist).length})`}
        </ModiffButton>
      )}
      {!matches.length ? (
        <p role="status">
          {capabilitiesStatus.status === 'loading'
            ? 'Loading workflows…'
            : cards.length
              ? 'No workflows match these filters.'
              : 'No workflow capabilities are available. Check the backend connection.'}
        </p>
      ) : null}
      {!cards.length || capabilitiesStatus.error ? (
        <ModiffButton onClick={() => void useNodesStore.getState().fetchStudioModelCapabilities()}>
          Retry capabilities
        </ModiffButton>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-modiff-border pt-3">
        <span className="text-sm text-modiff-subtle-text">Custom nodes</span>
        <ModiffButton disabled={Boolean(busy)} onClick={() => setCustomSource('hub')}>
          Add from Hugging Face
        </ModiffButton>
        <ModiffButton disabled={Boolean(busy)} onClick={() => setCustomSource('local')}>
          Add local source
        </ModiffButton>
      </div>
    </div>
  );
  return embedded ? (
    <div className="p-3" data-testid="task-browser">
      {content}
    </div>
  ) : (
    <ModiffDialog
      open
      onClose={dismiss}
      title="Workflows"
      testId="task-launcher"
      panelClassName="max-w-5xl"
      bodyClassName="max-h-[78vh]"
    >
      {content}
    </ModiffDialog>
  );
}
