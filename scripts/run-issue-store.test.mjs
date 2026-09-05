import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let runIssueStoreModule;
let server;

before(async () => {
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
