import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let runIssueStoreModule;
let modularRuntimeFailureIssue;
let server;
const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;

before(async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  runIssueStoreModule = await server.ssrLoadModule('/src/stores/useRunIssueStore.ts');
  ({ modularRuntimeFailureIssue } = await server.ssrLoadModule('/src/studio/modularRuntimeFailureIssue.ts'));
});

beforeEach(() => {
  runIssueStoreModule.useRunIssueStore.setState({
    issues: [],
    issueDialogOpen: false,
    failure: null,
    failureDialogOpen: false,
    failuresByTaskId: {},
  });
});

after(async () => {
  await server?.close();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
});

test('Run recovery captures the workflow and graph that produced the issue dialog', async () => {
  const { useStudioStore } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const { captureRunRecoveryOrigin, runRecoveryOriginIsCurrent } =
    await server.ssrLoadModule('/src/studio/runRecovery.ts');
  const previousStudio = useStudioStore.getState();
  const previousFlow = useFlowStore.getState();
  try {
    useStudioStore.setState({
      activeWorkflowTabId: 'recovery-origin',
      workflowCanvasEpoch: 3,
      workflowFormEpoch: 5,
    });
    useFlowStore.setState({ nodes: [], edges: [] });
    runIssueStoreModule.useRunIssueStore
      .getState()
      .showIssues(
        [{ id: 'blocked', category: 'user_input', severity: 'error', blocking: true, message: 'Choose an input' }],
        captureRunRecoveryOrigin(),
      );
    const origin = runIssueStoreModule.useRunIssueStore.getState().issueOrigin;
    assert.deepEqual(origin?.workflow, { workflowTabId: 'recovery-origin', canvasEpoch: 3, formEpoch: 5 });
    assert.equal(typeof origin?.graphKey, 'string');
    assert.equal(runRecoveryOriginIsCurrent(origin), true);
    useStudioStore.setState({ activeWorkflowTabId: 'another-workflow' });
    assert.equal(runIssueStoreModule.useRunIssueStore.getState().issueOrigin, origin);
    assert.equal(runRecoveryOriginIsCurrent(origin), false);
  } finally {
    useStudioStore.setState(previousStudio);
    useFlowStore.setState({ nodes: previousFlow.nodes, edges: previousFlow.edges });
  }
});

test('Run recovery ignores presentation and progress but rejects changed inputs and document epochs', async () => {
  const { useStudioStore } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const { captureRunRecoveryOrigin, runRecoveryOriginIsCurrent } =
    await server.ssrLoadModule('/src/studio/runRecovery.ts');
  const previousStudio = useStudioStore.getState();
  const previousFlow = useFlowStore.getState();
  const node = {
    id: 'recovery-input',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { type: 'custom', module: 'Text', action: 'Value', params: { text: { value: 'original' } } },
  };
  try {
    useStudioStore.setState({ activeWorkflowTabId: 'same-document', workflowCanvasEpoch: 1, workflowFormEpoch: 2 });
    useFlowStore.setState({ nodes: [node], edges: [] });
    const origin = captureRunRecoveryOrigin();
    const displayed = {
      ...node,
      selected: true,
      position: { x: 120, y: 80 },
      measured: { width: 200, height: 100 },
      data: { ...node.data, executionProgress: 0.5, uiState: { collapsed: true } },
    };
    useFlowStore.setState({ nodes: [displayed] });
    assert.equal(runRecoveryOriginIsCurrent(origin), true);
    useFlowStore.setState({
      nodes: [{ ...displayed, data: { ...displayed.data, params: { text: { value: 'new input' } } } }],
    });
    assert.equal(runRecoveryOriginIsCurrent(origin), false);
    useFlowStore.setState({ nodes: [node] });
    useStudioStore.setState({ workflowFormEpoch: 3 });
    assert.equal(runRecoveryOriginIsCurrent(origin), false);
    useStudioStore.setState({ workflowFormEpoch: 2, workflowCanvasEpoch: 2 });
    assert.equal(runRecoveryOriginIsCurrent(origin), false);
    useStudioStore.setState({ workflowCanvasEpoch: 1 });
    useFlowStore.setState({
      edges: [{ id: 'new-wire', source: node.id, target: node.id, sourceHandle: 'out', targetHandle: 'in' }],
    });
    assert.equal(runRecoveryOriginIsCurrent(origin), false);
    useFlowStore.setState({ edges: [], nodes: [{ ...node, data: { ...node.data, uiState: { disabled: true } } }] });
    assert.equal(runRecoveryOriginIsCurrent(origin), false);
  } finally {
    useStudioStore.setState(previousStudio);
    useFlowStore.setState({ nodes: previousFlow.nodes, edges: previousFlow.edges });
  }
});

test('Run recovery focus is volatile and cannot be restored from persisted settings', async () => {
  const { useSettingsStore } = await server.ssrLoadModule('/src/stores/useSettingsStore.ts');
  const { captureRunRecoveryOrigin } = await server.ssrLoadModule('/src/studio/runRecovery.ts');
  const previous = useSettingsStore.getState();
  try {
    const request = { origin: captureRunRecoveryOrigin(), target: { kind: 'studio', fieldId: 'layers' } };
    useSettingsStore.getState().setRunRecoveryFocusRequest(request);
    const options = useSettingsStore.persist.getOptions();
    assert.equal('runRecoveryFocusRequest' in options.partialize(useSettingsStore.getState()), false);
    assert.equal(
      options.merge({ runRecoveryFocusRequest: request }, useSettingsStore.getState()).runRecoveryFocusRequest,
      null,
    );
  } finally {
    useSettingsStore.setState(previous);
  }
});

test('Modular runtime Fix advice is non-blocking and restricted to its active workflow and visible node', () => {
  const failure = {
    id: 'runtime-loop',
    message: 'Loop member denoise/before: missing initial noise_pred',
    createdAt: 1,
  };
  const advice = modularRuntimeFailureIssue(failure, true, 'visible-owner');
  assert.equal(advice.code, 'modular_runtime_failure');
  assert.equal(advice.blocking, false);
  assert.equal(advice.nodeId, 'visible-owner');
  assert.match(advice.message, /noise_pred/);
  assert.equal(modularRuntimeFailureIssue(failure, false, 'visible-owner'), null);
  assert.equal(modularRuntimeFailureIssue(failure, true, null), null);
  assert.equal(modularRuntimeFailureIssue({ ...failure, oom: true }, true, 'visible-owner'), null);
  assert.equal(
    modularRuntimeFailureIssue({ ...failure, message: 'Network disconnected' }, true, 'visible-owner'),
    null,
  );
});

test('runtime failures can be selected and opened by their exact task identity', () => {
  const store = runIssueStoreModule.useRunIssueStore.getState();
  store.reportFailure({ taskId: 'task-first', message: 'first exact backend error' }, false);
  store.reportFailure({ taskId: 'task-second', message: 'second exact backend error' }, false);

  runIssueStoreModule.useRunIssueStore.getState().openFailure('task-first');
  let state = runIssueStoreModule.useRunIssueStore.getState();
  assert.equal(state.failure?.taskId, 'task-first');
  assert.equal(state.failure?.message, 'first exact backend error');
  assert.equal(state.failureDialogOpen, true);

  state.closeFailure();
  runIssueStoreModule.useRunIssueStore.getState().selectFailure('task-second');
  state = runIssueStoreModule.useRunIssueStore.getState();
  assert.equal(state.failure?.taskId, 'task-second');
  assert.equal(state.failure?.message, 'second exact backend error');
  assert.equal(state.failureDialogOpen, false);

  state.openFailure('task-that-does-not-exist');
  state = runIssueStoreModule.useRunIssueStore.getState();
  assert.equal(state.failure, null);
  assert.equal(state.failureDialogOpen, false);
});

test('late failure delivery cannot close or replace the failure dialog the user opened', () => {
  const store = runIssueStoreModule.useRunIssueStore;
  store.getState().reportFailure({ taskId: 'opened', message: 'early queue failure' }, false);
  store.getState().openFailure('opened');
  store.getState().reportFailure({ taskId: 'opened', message: 'late websocket detail' }, false);
  assert.equal(store.getState().failureDialogOpen, true);
  assert.equal(store.getState().failure.message, 'late websocket detail');
  store.getState().reportFailure({ taskId: 'background', message: 'another workflow failed' }, false);
  assert.equal(store.getState().failureDialogOpen, true);
  assert.equal(store.getState().failure.taskId, 'opened');
  assert.equal(store.getState().failuresByTaskId.background.message, 'another workflow failed');
  store.getState().closeFailure();
  store.getState().reportFailure({ taskId: 'opened', message: 'another repeated update' }, false);
  assert.equal(store.getState().failureDialogOpen, false);
});

test('runtime failure history retains only the newest bounded task window', () => {
  for (let index = 0; index < 35; index += 1) {
    runIssueStoreModule.useRunIssueStore
      .getState()
      .reportFailure({ taskId: `task-${index}`, message: `backend error ${index}`, createdAt: index }, false);
  }

  const state = runIssueStoreModule.useRunIssueStore.getState();
  assert.equal(Object.keys(state.failuresByTaskId).length, runIssueStoreModule.MAX_RUNTIME_FAILURE_HISTORY);
  assert.equal(state.failuresByTaskId['task-4'], undefined);
  assert.equal(state.failuresByTaskId['task-5']?.message, 'backend error 5');
  assert.equal(state.failuresByTaskId['task-34']?.message, 'backend error 34');
});

test('graph-mutating recovery is allowed only for the active open workflow and latest run', () => {
  const failure = {
    id: 'failure-active',
    taskId: 'task-active',
    clientRunId: 'client-active',
    workflowTabId: 'workflow-active',
    runInputHash: 'hash-active',
    message: 'exact failure',
    createdAt: 1,
  };
  const runContext = {
    clientRunId: 'client-active',
    workflowTabId: 'workflow-active',
    runInputHash: 'hash-active',
    run: { taskId: 'task-active' },
  };
  const workflowState = {
    activeWorkflowTabId: 'workflow-active',
    currentRunContext: runContext,
    workflowCanvasHydrated: true,
    workflowTabs: [{ id: 'workflow-active' }],
  };

  assert.equal(runIssueStoreModule.runtimeFailureTargetsActiveWorkflow(failure, runContext, workflowState), true);
  assert.equal(
    runIssueStoreModule.runtimeFailureTargetsActiveWorkflow(failure, runContext, {
      ...workflowState,
      activeWorkflowTabId: 'workflow-other',
    }),
    false,
  );
  assert.equal(
    runIssueStoreModule.runtimeFailureTargetsActiveWorkflow(failure, runContext, {
      ...workflowState,
      currentRunContext: { ...runContext, clientRunId: 'client-newer' },
    }),
    false,
  );
  assert.equal(
    runIssueStoreModule.runtimeFailureTargetsActiveWorkflow(failure, runContext, {
      ...workflowState,
      workflowTabs: [],
    }),
    false,
  );
  assert.equal(
    runIssueStoreModule.runtimeFailureTargetsActiveWorkflow(failure, runContext, {
      ...workflowState,
      workflowCanvasHydrated: false,
    }),
    false,
  );
});

test('a reloaded failure remains actionable only for its exact active workflow when no newer run exists', () => {
  const failure = {
    id: 'failure-reloaded',
    taskId: 'task-reloaded',
    workflowTabId: 'workflow-reloaded',
    message: 'exact reloaded failure',
    createdAt: 1,
  };
  const workflowState = {
    activeWorkflowTabId: 'workflow-reloaded',
    currentRunContext: null,
    workflowCanvasHydrated: true,
    workflowTabs: [{ id: 'workflow-reloaded' }],
  };

  assert.equal(runIssueStoreModule.runtimeFailureTargetsActiveWorkflow(failure, null, workflowState), true);
  assert.equal(
    runIssueStoreModule.runtimeFailureTargetsActiveWorkflow(failure, null, {
      ...workflowState,
      activeWorkflowTabId: 'workflow-other',
    }),
    false,
  );
  assert.equal(
    runIssueStoreModule.runtimeFailureTargetsActiveWorkflow(failure, null, {
      ...workflowState,
      currentRunContext: { clientRunId: 'newer-run', workflowTabId: 'workflow-reloaded' },
    }),
    false,
  );
});
