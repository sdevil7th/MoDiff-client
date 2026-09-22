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
import { formatRequestError } from '../utils/requestJson';
import { workflowChoices, workflowTaskLabel } from '../workflow/workflowChoices';
import {
  WORKFLOW_CATEGORIES,
  defaultWorkflowChoice,
  workflowTaskCards,
  type WorkflowCategory,
} from '../workflow/workflowTaskBrowser';
import { requestOperationStarter } from '../workflow/operationStarterRequest';
import { createWorkflowDraft } from '../workflow/workflowDraft';
import { commitOperationGraph } from '../workflow/operationGraphTransaction';

const CustomExtensionsDialog = lazy(() => import('./CustomExtensionsDialog'));

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
  const cards = useMemo(() => workflowTaskCards(choices), [choices]);
  const [category, setCategory] = useState<WorkflowCategory | 'All'>('Image');
  const [query, setQuery] = useState('');
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
      // A fast first click must not pick an unavailable alphabetical model
      // merely because the installed-artifact indexes are still arriving.
      const discovery = useNodesStore.getState();
      await Promise.all([
        discovery.discoveryRequests.hfCache.status === 'success' ? undefined : discovery.fetchHfCache(),
        discovery.discoveryRequests.localModels.status === 'success' ? undefined : discovery.fetchLocalModels(),
        discovery.discoveryRequests.modelCache.status === 'success'
          ? undefined
          : discovery.fetchModelCacheDiagnostics(),
      ]);
      if (controller.signal.aborted) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      const current = useNodesStore.getState();
      const selected = defaultWorkflowChoice(
        workflowChoices(
          current.pipelineSupport,
          current.studioModelCapabilities,
          current.hfCache,
          current.localModels,
          current.modelCacheDiagnostics,
          current.workflowModelDescriptors,
        ),
        task,
      );
      if (!selected) throw new Error('This task is no longer available. Refresh the workflow catalog.');
      const starter = await requestOperationStarter(
        selected.pipeline,
        task,
        operations,
        controller.signal,
        selected.profileId,
      );
      if (controller.signal.aborted) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      if (useFlowStore.getState().nodes.length || JSON.stringify(useFlowStore.getState().toObject()) !== signature)
        throw new Error('The canvas changed. Start a new workflow before choosing a task.');
      const draft = createWorkflowDraft(starter, registry);
      commitOperationGraph(draft.graph, context, signature, 'Create workflow');
      useStudioStore.getState().detachManagedGraph();
      prepareWorkflowForManualInsertion();
      const id = useStudioStore.getState().activeWorkflowTabId;
      if (id) useStudioStore.getState().renameWorkflowTab(id, workflowTaskLabel(task));
      useStudioStore.getState().saveActiveWorkflowTab(true);
    } catch (e) {
      if (!controller.signal.aborted) setError(formatRequestError(e, 'Could not create this workflow.'));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy('');
      }
    }
  }
  const visible = cards.filter(
    (c) =>
      (category === 'All' || c.category === category) &&
      (!downloaded || c.downloaded) &&
      `${c.label} ${c.task} ${c.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
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
      panelClassName="max-w-5xl"
      bodyClassName="max-h-[78vh]"
    >
      <div className="space-y-4">
        <p className="text-sm text-modiff-subtle-text">
          Choose a task to create its connected nodes. Change the model and parameters on the canvas. Models load only
          when you run.
        </p>
        <div className="flex flex-wrap gap-2">
          <ModiffButton
            onClick={() => prepareWorkflowForManualInsertion()}
            disabled={Boolean(busy)}
            data-testid="launcher-mode-advanced_workflow"
          >
            Empty workflow
          </ModiffButton>
          <ModiffButton
            onClick={() => {
              dismiss();
              useSettingsStore.getState().setLeftPanelTabIndex(4);
              useSettingsStore.getState().setLeftPanelOpen(true);
            }}
            disabled={Boolean(busy)}
          >
            Open workflow
          </ModiffButton>
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
              tone={category === name ? 'primary' : 'secondary'}
              aria-pressed={category === name}
              onClick={() => setCategory(name)}
            >
              {name}
            </ModiffButton>
          ))}
        </div>
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
                <span className="mt-1 block text-sm font-normal text-modiff-subtle-text">{card.description}</span>
              </span>
            </ModiffButton>
          ))}
        </div>
        {!visible.length ? (
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
    </ModiffDialog>
  );
}
