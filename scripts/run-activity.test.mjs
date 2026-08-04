import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let activityModule;
let flowStoreModule;
let issueStoreModule;
let settingsStoreModule;
let snackbarModule;
let studioStoreModule;
let taskStoreModule;
let server;
let originalFetch;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.window = {
    localStorage: globalThis.localStorage,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  activityModule = await server.ssrLoadModule('/src/studio/runActivity.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  issueStoreModule = await server.ssrLoadModule('/src/stores/useRunIssueStore.ts');
  settingsStoreModule = await server.ssrLoadModule('/src/stores/useSettingsStore.ts');
  snackbarModule = await server.ssrLoadModule('/src/ui/snackbar.ts');
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  taskStoreModule = await server.ssrLoadModule('/src/stores/useTaskStore.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ task: { task_id: 'fallback-task' }, outputs: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  studioStoreModule.useStudioStore.setState({
    outputs: [],
    currentRunContext: null,
    runContextsByClientRunId: {},
    runContextsByTaskId: {},
  });
  settingsStoreModule.useSettingsStore.setState({
    isRightPanelOpen: false,
    rightPanelTab: 'studio',
    mediaViewerOpener: null,
    workflowFocusRequest: null,
    runActivityPendingTaskId: null,
  });
  taskStoreModule.useTaskStore.setState({
    queuedTasks: {},
    currentTask: undefined,
    failedTasks: {},
    sessionRuns: [],
    focusedTaskId: null,
  });
  issueStoreModule.useRunIssueStore.setState({
    failure: null,
    failureDialogOpen: false,
    failuresByTaskId: {},
  });
  snackbarModule.closeSnackbar();
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function output(overrides = {}) {
  const form = studioStoreModule.useStudioStore.getState().form;
  return {
    id: 'output-one',
    clientRunId: 'client-one',
    workflowTabId: 'closed-workflow',
    nodeId: 'preview-node',
    fieldKey: 'image',
    value: '/cache/output.png',
    url: '/cache/output.png',
    mode: form.mode,
    modelType: form.modelType,
    modelLabel: 'Test model',
    repo: 'test/model',
    taskId: 'task-one',
    prompt: '',
    negativePrompt: '',
    seed: 1,
    width: 64,
    height: 64,
    steps: 1,
    guidanceScale: 1,
    referenceImages: [],
    formSnapshot: form,
    createdAt: 1,
    favorite: false,
    displayType: 'image',
    ...overrides,
  };
}

function deferredResponse() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test('queue and shelf rows derive the same run activity target', () => {
  assert.deepEqual(
    activityModule.runActivityTargetForTask(
      {
        id: 'session-id',
        task_id: 'task-id',
        client_run_id: 'client-id',
        workflow_tab_id: 'workflow-id',
        current_node: 'node-id',
        status: 'completed',
        name: 'Named workflow run',
      },
      'fallback-id',
      'queued',
    ),
    {
      taskId: 'task-id',
      clientRunId: 'client-id',
      workflowTabId: 'workflow-id',
      nodeId: 'node-id',
      status: 'completed',
      name: 'Named workflow run',
    },
  );
  assert.deepEqual(activityModule.runActivityTargetForTask({ name: 'Failed run' }, 'failed-map-key', 'failed'), {
    taskId: 'failed-map-key',
    clientRunId: undefined,
    workflowTabId: undefined,
    nodeId: undefined,
    status: 'failed',
    name: 'Failed run',
  });
});

test('run activity rows prefer the workflow title over the generic execution name', () => {
  assert.equal(
    activityModule.runActivityLabelForTask({
      name: 'Graph execution',
      workflow_title: 'Qwen product relight',
    }),
    'Qwen product relight',
  );
  assert.equal(activityModule.runActivityLabelForTask({ name: 'Named qualification' }), 'Named qualification');
  assert.equal(activityModule.runActivityLabelForTask({ name: 'Graph execution' }, 'task-id'), 'task-id');
});

test('session activity lists the newest run first without mutating store order', () => {
  const stored = [
    { id: 'old', status: 'completed', createdAtMs: 100, completedAtMs: 200 },
    { id: 'active', status: 'running', createdAtMs: 250, startedAtMs: 300 },
    { id: 'newest', status: 'completed', createdAtMs: 150, completedAtMs: 400 },
  ];
  assert.deepEqual(
    activityModule.sortSessionRunsNewestFirst(stored).map((run) => run.id),
    ['newest', 'active', 'old'],
  );
  assert.deepEqual(
    stored.map((run) => run.id),
    ['old', 'active', 'newest'],
  );
});

test('task matching is strict before client-run fallback and media collections remain viewable', () => {
  const records = [
    output(),
    output({ id: 'wrong-task', taskId: 'task-two', clientRunId: 'client-one', url: '/cache/wrong.png' }),
    output({
      id: 'conflicting-client',
      clientRunId: 'other-client',
      mediaItems: [
        {
          index: 0,
          taskId: 'task-one',
          clientRunId: 'client-one',
          url: '/cache/conflict.png',
          displayType: 'image',
        },
      ],
    }),
  ];
  const matched = activityModule.outputsForRun(records, 'task-one', 'client-one');
  assert.deepEqual(
    matched.map((item) => item.id),
    ['output-one'],
  );
  assert.deepEqual(activityModule.outputsForRun([records[1]], 'task-one', 'client-one'), []);
  assert.deepEqual(activityModule.outputsForRun([records[2]], 'task-one', 'client-one'), []);
  assert.deepEqual(
    activityModule
      .outputsForRun(
        [output({ id: 'legacy-client-only', taskId: null, clientRunId: 'client-one' })],
        'task-one',
        'client-one',
      )
      .map((item) => item.id),
    ['legacy-client-only'],
  );

  const items = activityModule.mediaViewerItemsForRun([
    output({
      mediaItems: [
        { index: 0, url: '/cache/clip.mp4', displayType: 'video', label: 'Clip' },
        { index: 1, url: '/cache/audio.wav', displayType: 'audio', label: 'Soundtrack' },
      ],
    }),
  ]);
  assert.deepEqual(
    items.map((item) => [item.kind, item.label]),
    [
      ['video', 'Clip'],
      ['audio', 'Soundtrack'],
    ],
  );
});

test('same-text run notifications remain individually actionable by task', () => {
  snackbarModule.enqueueSnackbar('Generation completed', {
    action: { type: 'open_task_run', taskId: 'task-one', outcome: 'completed' },
  });
  snackbarModule.enqueueSnackbar('Generation completed', {
    action: { type: 'open_task_run', taskId: 'task-two', outcome: 'completed' },
  });
  assert.deepEqual(
    snackbarModule.getToastItems().map((item) => item.action.taskId),
    ['task-one', 'task-two'],
  );
});

test('an open originating workflow is selected and its run node is requested for focus', async () => {
  const studio = studioStoreModule.useStudioStore.getState();
  studio.ensureWorkflowTabs();
  const originId = studioStoreModule.useStudioStore.getState().activeWorkflowTabId;
  studio.createWorkflowTab('Other workflow');
  assert.notEqual(studioStoreModule.useStudioStore.getState().activeWorkflowTabId, originId);

  const result = await activityModule.openRunActivity({
    taskId: 'task-open',
    workflowTabId: originId,
    nodeId: 'origin-node',
    status: 'completed',
  });

  assert.equal(result, 'workflow');
  assert.equal(studioStoreModule.useStudioStore.getState().activeWorkflowTabId, originId);
  assert.equal(settingsStoreModule.useSettingsStore.getState().rightPanelTab, 'studio');
  assert.deepEqual(settingsStoreModule.useSettingsStore.getState().workflowFocusRequest, {
    workflowTabId: originId,
    nodeId: 'origin-node',
    requestId: settingsStoreModule.useSettingsStore.getState().workflowFocusRequest.requestId,
    requestedAt: settingsStoreModule.useSettingsStore.getState().workflowFocusRequest.requestedAt,
  });
});

test('a completed closed workflow opens exact run output without recreating its tab', async () => {
  studioStoreModule.useStudioStore.setState({ outputs: [output()] });
  const beforeIds = studioStoreModule.useStudioStore.getState().workflowTabs.map((tab) => tab.id);

  const result = await activityModule.openRunActivity({
    taskId: 'task-one',
    clientRunId: 'client-one',
    workflowTabId: 'closed-workflow',
    status: 'completed',
    name: 'Closed render',
  });

  assert.equal(result, 'preview');
  assert.deepEqual(
    studioStoreModule.useStudioStore.getState().workflowTabs.map((tab) => tab.id),
    beforeIds,
  );
  assert.equal(
    settingsStoreModule.useSettingsStore.getState().mediaViewerOpener.title,
    'Output preview - Closed render',
  );
  assert.equal(settingsStoreModule.useSettingsStore.getState().mediaViewerOpener.items[0].url, '/cache/output.png');
  assert.deepEqual(settingsStoreModule.useSettingsStore.getState().mediaViewerOpener.workflow, {
    taskId: 'task-one',
    clientRunId: 'client-one',
    workflowTabId: 'closed-workflow',
    nodeId: null,
    name: 'Closed render',
  });
});

test('a completed closed workflow recovers its output from the exact backend run after local state loss', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        task: { task_id: 'backend-task', client_run_id: 'backend-client', status: 'completed' },
        workflow_id: 'closed-workflow',
        workflow_title: 'Recovered render',
        outputs: [
          output({
            id: 'backend-output',
            taskId: 'backend-task',
            clientRunId: 'backend-client',
            url: '/cache/backend-output.png',
          }),
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  const result = await activityModule.openRunActivity({
    taskId: 'backend-task',
    clientRunId: 'backend-client',
    workflowTabId: 'closed-workflow',
    status: 'completed',
  });

  assert.equal(result, 'preview');
  assert.equal(
    settingsStoreModule.useSettingsStore.getState().mediaViewerOpener.title,
    'Output preview - Recovered render',
  );
  assert.equal(
    settingsStoreModule.useSettingsStore.getState().mediaViewerOpener.items[0].url,
    '/cache/backend-output.png',
  );
});

test('a mismatched backend output never opens for another completed run', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        task: { task_id: 'requested-task', client_run_id: 'requested-client', status: 'completed' },
        outputs: [
          output({
            id: 'wrong-backend-output',
            taskId: 'different-task',
            clientRunId: 'requested-client',
          }),
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  const result = await activityModule.openRunActivity({
    taskId: 'requested-task',
    clientRunId: 'requested-client',
    workflowTabId: 'closed-workflow',
    status: 'completed',
  });

  assert.equal(result, 'queue');
  assert.equal(settingsStoreModule.useSettingsStore.getState().mediaViewerOpener, null);
  assert.equal(
    snackbarModule.getToastItems().at(-1)?.message,
    'Run completed, but no previewable output was generated. Showing its Queue details.',
  );
});

test('the output preview action restores a completed workflow from its durable output after backend restart', async () => {
  const studio = studioStoreModule.useStudioStore.getState();
  const restoredNode = {
    id: 'completed-preview-node',
    type: 'custom',
    position: { x: 80, y: 40 },
    data: {
      module: 'modules.Image',
      action: 'Preview',
      type: 'custom',
      label: 'Preview Image',
      category: 'image',
      description: '',
      resizable: true,
      skipParamsCheck: false,
      style: {},
      params: {},
      time: [0, 0, 0],
      memory: [0, 0, 0],
      cache: false,
    },
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        task: {
          task_id: 'completed-task',
          client_run_id: 'completed-client',
          workflow_tab_id: 'completed-workflow',
          status: 'completed',
        },
        workflow_id: null,
        workflow_title: null,
        workflow_snapshot: null,
        outputs: [
          output({
            id: 'completed-output',
            taskId: 'completed-task',
            clientRunId: 'completed-client',
            workflowTabId: 'completed-workflow',
            apiGraphSnapshot: {
              runtimeHints: {
                workflowTabId: 'completed-workflow',
                workflowTitle: 'Completed workflow',
                workflowSnapshot: {
                  nodes: [restoredNode],
                  edges: [],
                  viewport: { x: 0, y: 0, zoom: 1 },
                  studioForm: studio.form,
                  studioGraphBinding: null,
                  selectedMode: studio.selectedMode,
                  activeTemplateId: null,
                  sourceOutputId: null,
                  pinnedGraphInputIds: [],
                },
              },
            },
          }),
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  const result = await activityModule.openRunActivity({
    taskId: 'completed-task',
    clientRunId: 'completed-client',
    workflowTabId: 'completed-workflow',
    status: 'completed',
    preferWorkflow: true,
  });

  assert.equal(result, 'workflow');
  assert.equal(studioStoreModule.useStudioStore.getState().activeWorkflowTabId, 'completed-workflow');
  assert.ok(flowStoreModule.useFlowStore.getState().nodes.some((node) => node.id === 'completed-preview-node'));
});

test('a failed closed workflow selects the task-specific error instead of a newer failure', async () => {
  const issues = issueStoreModule.useRunIssueStore.getState();
  issues.reportFailure({ taskId: 'older-failure', message: 'Exact older failure' }, false);
  issues.reportFailure({ taskId: 'newer-failure', message: 'Different newer failure' }, false);

  const result = await activityModule.openRunActivity({
    taskId: 'older-failure',
    workflowTabId: 'closed-workflow',
    status: 'failed',
  });

  assert.equal(result, 'failure');
  assert.equal(issueStoreModule.useRunIssueStore.getState().failure.taskId, 'older-failure');
  assert.equal(issueStoreModule.useRunIssueStore.getState().failure.message, 'Exact older failure');
  assert.equal(issueStoreModule.useRunIssueStore.getState().failureDialogOpen, true);
});

test('stored failure provenance reveals its open workflow and failed node when the notification omits them', async () => {
  const studio = studioStoreModule.useStudioStore.getState();
  studio.ensureWorkflowTabs();
  const originId = studioStoreModule.useStudioStore.getState().activeWorkflowTabId;
  studio.createWorkflowTab('Other workflow');
  assert.notEqual(studioStoreModule.useStudioStore.getState().activeWorkflowTabId, originId);
  issueStoreModule.useRunIssueStore
    .getState()
    .reportFailure(
      { taskId: 'stored-failure', workflowTabId: originId, nodeId: 'failed-node', message: 'Exact stored failure' },
      false,
    );

  const result = await activityModule.openRunActivity({
    taskId: 'stored-failure',
    status: 'failed',
  });

  assert.equal(result, 'failure');
  assert.equal(studioStoreModule.useStudioStore.getState().activeWorkflowTabId, originId);
  assert.deepEqual(settingsStoreModule.useSettingsStore.getState().workflowFocusRequest, {
    workflowTabId: originId,
    nodeId: 'failed-node',
    requestId: settingsStoreModule.useSettingsStore.getState().workflowFocusRequest.requestId,
    requestedAt: settingsStoreModule.useSettingsStore.getState().workflowFocusRequest.requestedAt,
  });
  assert.equal(issueStoreModule.useRunIssueStore.getState().failureDialogOpen, true);
});

test('a reloaded failure recovers actionable backend metadata for its exact open workflow', async () => {
  const studio = studioStoreModule.useStudioStore.getState();
  studioStoreModule.useStudioStore.setState({
    workflowTabs: [
      {
        id: 'failure-workflow',
        title: 'Failure workflow',
        createdAt: 1,
        updatedAt: 1,
        dirty: false,
        source: 'manual',
        snapshot: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          studioForm: studio.form,
          studioGraphBinding: null,
          selectedMode: studio.selectedMode,
          activeTemplateId: null,
          sourceOutputId: null,
          pinnedGraphInputIds: [],
        },
      },
    ],
    activeWorkflowTabId: 'failure-workflow',
    workflowCanvasHydrated: true,
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        task: {
          task_id: 'reloaded-failure',
          client_run_id: 'reloaded-client',
          run_input_hash: 'reloaded-hash',
          workflow_tab_id: 'failure-workflow',
          status: 'failed',
          node: 'loader-node',
          node_name: 'Load Models',
          message: 'CUDA out of memory while loading',
          exception_type: 'OutOfMemoryError',
          category: 'oom',
          error_code: 'cuda_oom',
          recovery_hint: 'Apply the Low-VRAM preset and retry.',
          oom: true,
        },
        workflow_id: 'failure-workflow',
        outputs: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  const result = await activityModule.openRunActivity({
    taskId: 'reloaded-failure',
    status: 'failed',
  });

  assert.equal(result, 'failure');
  const failure = issueStoreModule.useRunIssueStore.getState().failure;
  assert.equal(failure.taskId, 'reloaded-failure');
  assert.equal(failure.clientRunId, 'reloaded-client');
  assert.equal(failure.workflowTabId, 'failure-workflow');
  assert.equal(failure.runInputHash, 'reloaded-hash');
  assert.equal(failure.nodeId, 'loader-node');
  assert.equal(failure.nodeName, 'Load Models');
  assert.equal(failure.exceptionType, 'OutOfMemoryError');
  assert.equal(failure.category, 'oom');
  assert.equal(failure.errorCode, 'cuda_oom');
  assert.equal(failure.recoveryHint, 'Apply the Low-VRAM preset and retry.');
  assert.equal(failure.oom, true);
  assert.equal(
    issueStoreModule.runtimeFailureTargetsActiveWorkflow(failure, null, {
      activeWorkflowTabId: 'failure-workflow',
      currentRunContext: null,
      workflowCanvasHydrated: true,
      workflowTabs: [{ id: 'failure-workflow' }],
    }),
    true,
  );
});

test('a running closed workflow with no output falls back to its queue entry', async () => {
  const result = await activityModule.openRunActivity({
    taskId: 'running-task',
    workflowTabId: 'closed-workflow',
    status: 'running',
  });

  assert.equal(result, 'queue');
  assert.equal(taskStoreModule.useTaskStore.getState().focusedTaskId, 'running-task');
  assert.equal(settingsStoreModule.useSettingsStore.getState().rightPanelTab, 'queue');
});

test('an active run from another client restores its workflow snapshot and running node', async () => {
  const studio = studioStoreModule.useStudioStore.getState();
  const remoteNode = {
    id: 'remote-running-node',
    type: 'custom',
    position: { x: 120, y: 80 },
    data: {
      module: 'modules.Image',
      action: 'Preview',
      type: 'custom',
      label: 'Preview Image',
      category: 'image',
      description: 'Preview an image',
      resizable: true,
      skipParamsCheck: false,
      style: {},
      params: {},
      time: [0, 0, 0],
      memory: [0, 0, 0],
      cache: false,
      studioRole: 'preview',
      studioOwned: true,
    },
  };
  globalThis.fetch = async (input) => {
    if (String(input).includes('/workflows/')) {
      return new Response(JSON.stringify({ error: true }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        task: {
          task_id: 'remote-running-task',
          client_run_id: 'remote-running-client',
          workflow_tab_id: 'remote-running-workflow',
          status: 'running',
          progress: 63,
          node_progress: 37,
          current_node: remoteNode.id,
          phase: 'denoising',
          message: 'Denoising 3/8',
        },
        workflow_id: 'remote-running-workflow',
        workflow_title: 'Remote running workflow',
        workflow_snapshot: {
          nodes: [remoteNode],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          studioForm: studio.form,
          studioGraphBinding: null,
          selectedMode: studio.selectedMode,
          activeTemplateId: null,
          sourceOutputId: null,
          pinnedGraphInputIds: [],
        },
        outputs: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await activityModule.openRunActivity({
    taskId: 'remote-running-task',
    clientRunId: 'remote-running-client',
    workflowTabId: 'remote-running-workflow',
    nodeId: remoteNode.id,
    status: 'running',
  });

  assert.equal(result, 'workflow');
  assert.equal(studioStoreModule.useStudioStore.getState().activeWorkflowTabId, 'remote-running-workflow');
  assert.equal(settingsStoreModule.useSettingsStore.getState().rightPanelTab, 'studio');
  assert.equal(
    settingsStoreModule.useSettingsStore.getState().workflowFocusRequest.workflowTabId,
    'remote-running-workflow',
  );
  const restoredNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === remoteNode.id);
  assert.equal(restoredNode.data.activeTaskId, 'remote-running-task');
  assert.equal(restoredNode.data.executionStatus, 'running');
  assert.equal(restoredNode.data.executionPhase, 'denoising');
  assert.equal(restoredNode.data.progress, 37);
});

test('an active queue snapshot navigates without waiting for a run lookup during model loading', async () => {
  const studio = studioStoreModule.useStudioStore.getState();
  const remoteNode = {
    id: 'queue-snapshot-node',
    type: 'custom',
    position: { x: 80, y: 60 },
    data: {
      module: 'modules.DiffusersAudio',
      action: 'LoadPipeline',
      type: 'custom',
      label: 'Load Pipeline',
      category: 'audio',
      description: '',
      resizable: true,
      skipParamsCheck: false,
      style: {},
      params: {},
      time: [0, 0, 0],
      memory: [0, 0, 0],
      cache: false,
    },
  };
  taskStoreModule.useTaskStore.setState({
    currentTask: {
      name: 'Graph execution',
      task_id: 'queue-snapshot-task',
      workflow_tab_id: 'queue-snapshot-workflow',
      workflow_title: 'Queued snapshot workflow',
      workflow_snapshot: {
        nodes: [remoteNode],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        studioForm: studio.form,
        studioGraphBinding: null,
        selectedMode: studio.selectedMode,
        activeTemplateId: null,
        sourceOutputId: null,
        pinnedGraphInputIds: [],
      },
      status: 'running',
      progress: 16,
      node_progress: 0,
      current_node: remoteNode.id,
      phase: 'loading',
      message: 'Loading pipeline',
    },
  });
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('The busy backend should not be consulted for navigation.');
  };

  const result = await activityModule.openRunActivity({
    taskId: 'queue-snapshot-task',
    workflowTabId: 'queue-snapshot-workflow',
    nodeId: remoteNode.id,
    status: 'running',
  });

  assert.equal(result, 'workflow');
  assert.equal(fetchCount, 0);
  assert.equal(studioStoreModule.useStudioStore.getState().activeWorkflowTabId, 'queue-snapshot-workflow');
  const restoredNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === remoteNode.id);
  assert.equal(restoredNode.data.executionStatus, 'running');
  assert.equal(restoredNode.data.executionPhase, 'loading');
});

test('a slower earlier lookup cannot replace the result of the latest activity click', async () => {
  const requests = [];
  globalThis.fetch = () => {
    const response = deferredResponse();
    requests.push(response);
    return response.promise;
  };

  const earlier = activityModule.openRunActivity({
    taskId: 'earlier-task',
    clientRunId: 'earlier-client',
    workflowTabId: 'closed-earlier',
    status: 'completed',
  });
  const latest = activityModule.openRunActivity({
    taskId: 'latest-task',
    clientRunId: 'latest-client',
    workflowTabId: 'closed-latest',
    status: 'completed',
  });
  assert.equal(settingsStoreModule.useSettingsStore.getState().runActivityPendingTaskId, 'latest-task');

  requests[1].resolve(
    new Response(
      JSON.stringify({
        workflow_title: 'Latest output',
        outputs: [
          output({
            id: 'latest-output',
            taskId: 'latest-task',
            clientRunId: 'latest-client',
            workflowTabId: 'closed-latest',
            url: '/cache/latest.png',
          }),
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  assert.equal(await latest, 'preview');

  requests[0].resolve(
    new Response(
      JSON.stringify({
        workflow_title: 'Earlier output',
        outputs: [
          output({
            id: 'earlier-output',
            taskId: 'earlier-task',
            clientRunId: 'earlier-client',
            workflowTabId: 'closed-earlier',
            url: '/cache/earlier.png',
          }),
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  assert.equal(await earlier, 'superseded');
  assert.equal(
    settingsStoreModule.useSettingsStore.getState().mediaViewerOpener.title,
    'Output preview - Latest output',
  );
  assert.equal(settingsStoreModule.useSettingsStore.getState().mediaViewerOpener.items[0].url, '/cache/latest.png');
  assert.equal(settingsStoreModule.useSettingsStore.getState().runActivityPendingTaskId, null);
});
