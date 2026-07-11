import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let coordinatorModule;
let flowStoreModule;
let studioStoreModule;
let websocketModule;
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
    dispatchEvent: () => true,
    localStorage: globalThis.localStorage,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  coordinatorModule = await server.ssrLoadModule('/src/studio/runCoordinator.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  websocketModule = await server.ssrLoadModule('/src/stores/websocketMessageHandler.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  flowStoreModule.useFlowStore.setState({
    nodes: [
      {
        id: 'preview',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Preview',
          label: 'Preview',
          category: 'Test',
          params: {
            output: { type: 'image', display: 'ui_image', value: 'current-workflow.png' },
          },
        },
      },
    ],
    edges: [],
  });
  studioStoreModule.useStudioStore.setState({
    activeWorkflowTabId: 'workflow-origin',
    currentRunContext: null,
    outputs: [],
    runContextsByClientRunId: {},
    runContextsByTaskId: {},
  });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function deferredResponse() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function graph(sid = 'session-1') {
  return {
    sid,
    nodes: {
      generate: {
        module: 'modules.Test',
        action: 'Generate',
        params: { prompt: { value: 'test prompt' } },
      },
    },
    paths: [['generate']],
  };
}

test('out-of-order graph responses attach to their immutable submission contexts', async () => {
  const requests = [];
  globalThis.fetch = (_url, init) => {
    const response = deferredResponse();
    requests.push({ body: JSON.parse(init.body), response });
    return response.promise;
  };

  const firstRun = coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
    studioContext: { applyRuntimeMetadata: false, clearChangedPreviews: false },
  });
  const firstClientRunId = studioStoreModule.useStudioStore.getState().currentRunContext.clientRunId;

  const secondRun = coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
    studioContext: { applyRuntimeMetadata: false, clearChangedPreviews: false },
  });
  const secondClientRunId = studioStoreModule.useStudioStore.getState().currentRunContext.clientRunId;

  assert.notEqual(firstClientRunId, secondClientRunId);
  assert.equal(requests.length, 2);

  requests[1].response.resolve(jsonResponse({ task_id: 'task-second', sid: 'session-1', message: 'queued second' }));
  await secondRun;

  requests[0].response.resolve(jsonResponse({ task_id: 'task-first', sid: 'session-1', message: 'queued first' }));
  await firstRun;

  const state = studioStoreModule.useStudioStore.getState();
  assert.equal(state.currentRunContext.clientRunId, secondClientRunId);
  assert.equal(state.currentRunContext.run.taskId, 'task-second');
  assert.equal(state.runContextsByTaskId['task-first'].clientRunId, firstClientRunId);
  assert.equal(state.runContextsByTaskId['task-second'].clientRunId, secondClientRunId);
  assert.equal(state.runContextsByClientRunId[firstClientRunId].run.taskId, 'task-first');
  assert.equal(state.runContextsByClientRunId[secondClientRunId].run.taskId, 'task-second');
});

test('Studio submission sends the same correlation identity that the store captures', async () => {
  let submittedGraph;
  globalThis.fetch = async (_url, init) => {
    submittedGraph = JSON.parse(init.body);
    return jsonResponse({ task_id: 'task-correlated', sid: 'session-1', message: 'queued' });
  };

  const result = await coordinatorModule.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: graph(),
    studioContext: { clearChangedPreviews: false },
  });

  assert.equal(submittedGraph.runtimeHints.clientRunId, result.context.clientRunId);
  assert.equal(submittedGraph.runtimeHints.runInputHash, result.context.runInputHash);
  assert.equal(result.response.task_id, 'task-correlated');
  assert.equal(
    studioStoreModule.useStudioStore.getState().runContextsByTaskId['task-correlated'].clientRunId,
    result.context.clientRunId,
  );
});

test('out-of-order websocket outputs keep origin attribution without mutating the active canvas', () => {
  globalThis.fetch = async () => jsonResponse({ error: false, outputs: [] });
  const studio = studioStoreModule.useStudioStore.getState();
  const firstIdentity = { clientRunId: 'client-first', runInputHash: 'hash-first' };
  studio.captureRunContext(graph(), undefined, firstIdentity);
  studio.attachRunResponse({ task_id: 'task-first', sid: 'session-1' }, firstIdentity.clientRunId);

  studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: 'workflow-active' });
  const secondIdentity = { clientRunId: 'client-second', runInputHash: 'hash-second' };
  studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, secondIdentity);
  studioStoreModule.useStudioStore
    .getState()
    .attachRunResponse({ task_id: 'task-second', sid: 'session-1' }, secondIdentity.clientRunId);
  assert.equal(
    studioStoreModule.useStudioStore.getState().shouldAcceptRunOutputUpdate('task-first', secondIdentity.clientRunId),
    false,
  );

  const handlerContext = {
    sid: 'session-1',
    ws: {},
    getSid: () => 'session-1',
    setSid: () => undefined,
    setLoopTimer: () => undefined,
  };
  websocketModule.handleWebsocketMessage(
    {
      type: 'update_value',
      node: 'preview',
      key: 'output',
      value: 'older-run.png',
      data_type: 'image',
      task_id: 'task-first',
      client_run_id: firstIdentity.clientRunId,
      run_input_hash: firstIdentity.runInputHash,
    },
    handlerContext,
  );

  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'current-workflow.png');
  const olderOutput = studioStoreModule.useStudioStore.getState().outputs[0];
  assert.equal(olderOutput.workflowTabId, 'workflow-origin');
  assert.equal(olderOutput.taskId, 'task-first');
  assert.equal(olderOutput.clientRunId, firstIdentity.clientRunId);

  websocketModule.handleWebsocketMessage(
    {
      type: 'update_value',
      node: 'preview',
      key: 'output',
      value: 'active-run.png',
      data_type: 'image',
      task_id: 'task-second',
      client_run_id: secondIdentity.clientRunId,
      run_input_hash: secondIdentity.runInputHash,
    },
    handlerContext,
  );

  assert.equal(flowStoreModule.useFlowStore.getState().getParam('preview', 'output', 'value'), 'active-run.png');
  assert.equal(studioStoreModule.useStudioStore.getState().outputs[0].workflowTabId, 'workflow-active');

  websocketModule.handleWebsocketMessage(
    {
      type: 'task_failed',
      sid: 'session-1',
      task_id: 'task-second',
      client_run_id: secondIdentity.clientRunId,
      message: 'run failed',
      queued: {},
      current: null,
    },
    handlerContext,
  );
  websocketModule.handleWebsocketMessage(
    {
      type: 'node_error',
      task_id: 'task-second',
      client_run_id: secondIdentity.clientRunId,
      node: 'preview',
      message: 'detailed loader failure',
    },
    handlerContext,
  );
  const previewNode = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === 'preview');
  assert.equal(previewNode.data.uiState.validationSeverity, 'error');
  assert.equal(previewNode.data.uiState.errorMessage, 'detailed loader failure');
});

test('run-correlation indexes retain a bounded recent window', () => {
  for (let index = 0; index < 55; index += 1) {
    const identity = { clientRunId: `client-${index}`, runInputHash: `hash-${index}` };
    studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, identity);
    studioStoreModule.useStudioStore
      .getState()
      .attachRunResponse({ task_id: `task-${index}`, sid: 'session-1' }, identity.clientRunId);
  }

  const state = studioStoreModule.useStudioStore.getState();
  assert.equal(Object.keys(state.runContextsByClientRunId).length, 50);
  assert.equal(Object.keys(state.runContextsByTaskId).length, 50);
  assert.equal(state.runContextsByClientRunId['client-0'], undefined);
  assert.equal(state.runContextsByTaskId['task-0'], undefined);
  assert.equal(state.runContextsByTaskId['task-54'].clientRunId, 'client-54');
});

test('terminal run contexts are pruned while the current context remains addressable', () => {
  for (let index = 0; index < 25; index += 1) {
    const identity = { clientRunId: `terminal-client-${index}`, runInputHash: `terminal-hash-${index}` };
    const taskId = `terminal-task-${index}`;
    studioStoreModule.useStudioStore.getState().captureRunContext(graph(), undefined, identity);
    studioStoreModule.useStudioStore
      .getState()
      .attachRunResponse({ task_id: taskId, sid: 'session-1' }, identity.clientRunId);
    studioStoreModule.useStudioStore.getState().markRunContextStatus(taskId, identity.clientRunId, 'completed');
  }

  const state = studioStoreModule.useStudioStore.getState();
  assert.equal(Object.keys(state.runContextsByClientRunId).length, 20);
  assert.equal(Object.keys(state.runContextsByTaskId).length, 20);
  assert.equal(state.currentRunContext.clientRunId, 'terminal-client-24');
  assert.equal(state.currentRunContext.status, 'completed');
  assert.equal(state.runContextsByTaskId['terminal-task-24'].clientRunId, 'terminal-client-24');
});
