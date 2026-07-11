import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let autoResourceModule;
let server;
let taskStoreModule;
let userBlockStoreModule;
let originalFetch;

before(async () => {
  globalThis.window = {
    dispatchEvent: () => true,
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
  taskStoreModule = await server.ssrLoadModule('/src/stores/useTaskStore.ts');
  userBlockStoreModule = await server.ssrLoadModule('/src/stores/useUserBlockStore.ts');
  autoResourceModule = await server.ssrLoadModule('/src/studio/autoResource.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  taskStoreModule.useTaskStore.setState({
    queuedTasks: {},
    currentTask: undefined,
    failedTasks: {},
    sessionRuns: [],
    taskCount: 0,
    queueRevision: 0,
    fetchState: { status: 'idle', error: null, requestId: null },
  });
  userBlockStoreModule.useUserBlockStore.setState({
    blocks: [],
    loaded: false,
    error: null,
    revision: 0,
  });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function deferred() {
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

function userBlock(id, name = id) {
  return {
    id,
    name,
    version: 1,
    nodes: [],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
  };
}

test('a delayed queue fetch cannot overwrite a newer websocket queue revision', async () => {
  const call = deferred();
  globalThis.fetch = () => call.promise;

  const fetchPromise = taskStoreModule.useTaskStore.getState().fetchTasks();
  taskStoreModule.useTaskStore.getState().setTasks({ name: 'Live task', task_id: 'live', status: 'running' }, {});
  call.resolve(jsonResponse({ current: { name: 'Stale task', task_id: 'stale' }, queued: {} }));
  await fetchPromise;

  const state = taskStoreModule.useTaskStore.getState();
  assert.equal(state.currentTask.task_id, 'live');
  assert.equal(state.fetchState.status, 'success');
});

test('queue response validation reports an endpoint error and a later retry recovers', async () => {
  globalThis.fetch = async () => jsonResponse({ current: null, queued: [] });
  await taskStoreModule.useTaskStore.getState().fetchTasks();
  assert.equal(taskStoreModule.useTaskStore.getState().fetchState.status, 'error');
  assert.match(taskStoreModule.useTaskStore.getState().fetchState.error, /queued task response/);

  globalThis.fetch = async () => jsonResponse({ current: null, queued: { next: { name: 'Next', task_id: 'next' } } });
  await taskStoreModule.useTaskStore.getState().fetchTasks();
  const state = taskStoreModule.useTaskStore.getState();
  assert.equal(state.fetchState.status, 'success');
  assert.equal(state.queuedTasks.next.task_id, 'next');
});

test('a delayed block fetch cannot overwrite a newer optimistic local block', async () => {
  const call = deferred();
  globalThis.fetch = () => call.promise;
  const fetchPromise = userBlockStoreModule.useUserBlockStore.getState().fetchBlocks();
  userBlockStoreModule.useUserBlockStore.getState().upsertLocalBlock(userBlock('local'));
  call.resolve(jsonResponse({ blocks: [userBlock('stale')] }));
  await fetchPromise;

  const state = userBlockStoreModule.useUserBlockStore.getState();
  assert.deepEqual(
    state.blocks.map((block) => block.id),
    ['local'],
  );
  assert.equal(state.error, null);
});

test('out-of-order block saves cannot resurrect an older version', async () => {
  const calls = [];
  globalThis.fetch = () => {
    const call = deferred();
    calls.push(call);
    return call.promise;
  };

  const first = userBlockStoreModule.useUserBlockStore.getState().saveBlock(userBlock('same', 'First'));
  const second = userBlockStoreModule.useUserBlockStore.getState().saveBlock(userBlock('same', 'Second'));
  calls[1].resolve(jsonResponse({ block: userBlock('same', 'Second saved') }));
  await second;
  calls[0].resolve(jsonResponse({ block: userBlock('same', 'First saved') }));
  await first;

  assert.equal(userBlockStoreModule.useUserBlockStore.getState().blocks[0].name, 'Second saved');
});

test('a failed block delete restores only its target and preserves concurrent edits', async () => {
  const first = userBlock('first');
  const second = userBlock('second');
  const concurrent = userBlock('concurrent');
  userBlockStoreModule.useUserBlockStore.getState().setBlocks([first, second]);
  const call = deferred();
  globalThis.fetch = () => call.promise;

  const deletion = userBlockStoreModule.useUserBlockStore.getState().deleteBlock('first');
  userBlockStoreModule.useUserBlockStore.getState().upsertLocalBlock(concurrent);
  call.resolve(jsonResponse({ error: true, message: 'Delete rejected.' }, 409));
  await assert.rejects(deletion, (error) => error.kind === 'http' && error.message === 'Delete rejected.');

  const state = userBlockStoreModule.useUserBlockStore.getState();
  assert.deepEqual(new Set(state.blocks.map((block) => block.id)), new Set(['first', 'second', 'concurrent']));
  assert.equal(state.error, 'Delete rejected.');
});

test('Auto planning preserves its error-plan API while using normalized transport failures', async () => {
  globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 });
  const plan = await autoResourceModule.fetchAutoResourcePlan({ modelType: 'QwenImageModularPipeline' });
  assert.equal(plan.error, true);
  assert.equal(plan.status, 'needs_setup');
  assert.match(plan.message, /invalid JSON/);
});

test('Auto plan batches and history mutations reject invalid or failed responses', async () => {
  globalThis.fetch = async () => jsonResponse({ plans: [null] });
  await assert.rejects(
    autoResourceModule.fetchAutoResourcePlans([{ modelType: 'QwenImageModularPipeline' }]),
    (error) => error.kind === 'invalid_payload' && /plan 1/.test(error.message),
  );

  globalThis.fetch = async () => jsonResponse({ message: 'History is locked.' }, 423);
  await assert.rejects(
    autoResourceModule.clearAutoResourceHistory({ modelType: 'QwenImageModularPipeline' }),
    (error) => error.kind === 'http' && error.status === 423 && error.message === 'History is locked.',
  );
});
