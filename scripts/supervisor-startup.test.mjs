import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server, control, nodes, tasks, originalFetch;
before(async () => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:5191' }, dispatchEvent: () => true };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  control = await server.ssrLoadModule('/src/utils/supervisorControl.ts');
  nodes = (await server.ssrLoadModule('/src/stores/useNodeStore.ts')).useNodesStore;
  tasks = (await server.ssrLoadModule('/src/stores/useTaskStore.ts')).useTaskStore;
  originalFetch = globalThis.fetch;
});
beforeEach(() => {
  control.resetSupervisorControl();
  const discoveryRequests = { ...nodes.getState().discoveryRequests };
  for (const key of ['nodes', 'runtime']) discoveryRequests[key] = { status: 'idle', requestId: null, error: null };
  nodes.setState({ discoveryRequests, runtimeStatus: null, runtimeError: null });
  tasks.setState({
    currentTask: undefined,
    queuedTasks: {},
    taskCount: 0,
    queueRevision: 0,
    supervisorControlError: null,
  });
});
after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});
function status(key, state, requestId = 1) {
  nodes.setState({
    discoveryRequests: { ...nodes.getState().discoveryRequests, [key]: { status: state, requestId, error: null } },
  });
}
function countedStore() {
  let subscriptions = 0;
  return {
    getState: nodes.getState,
    subscribe(listener) {
      subscriptions++;
      const unsubscribe = nodes.subscribe(listener);
      return () => {
        subscriptions--;
        unsubscribe();
      };
    },
    count: () => subscriptions,
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function response(x) {
  return new Response(JSON.stringify(x), { headers: { 'Content-Type': 'application/json' } });
}
async function background(store = nodes, signal, timeoutMs = 1000) {
  if (await control.waitForSupervisorMetadata(store, signal, timeoutMs)) await tasks.getState().fetchSupervisorTasks();
}

test('startup waits through owned nodes-to-runtime discovery and avoids a standalone queue probe', async () => {
  status('nodes', 'loading');
  const store = countedStore();
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return response({ ready: true, workerControl: { available: false, address: null } });
  };
  const pending = background(store);
  status('nodes', 'success');
  await Promise.resolve();
  assert.equal(store.count(), 1, 'nodes success is not runtime metadata');
  await nodes.getState().fetchRuntimeStatus();
  await pending;
  assert.equal(store.count(), 0);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /runtime\/status$/);
});

test('supervised metadata before timeout restores the actual queue at its advertised address', async () => {
  const health = deferred();
  status('runtime', 'loading');
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith('/runtime/status')) return health.promise;
    return response({
      current: { task_id: 'active-startup', status: 'running', name: 'Live native run' },
      queued: {},
      recent: [],
    });
  };
  const runtime = nodes.getState().fetchRuntimeStatus();
  const pending = background();
  health.resolve(response({ ready: true, workerControl: { available: true, address: 'http://127.0.0.1:43001' } }));
  await runtime;
  await pending;
  assert.equal(tasks.getState().currentTask.task_id, 'active-startup');
  assert.equal(requests.filter((x) => x.endsWith('/queue')).length, 1);
  assert.equal(requests.at(-1), 'http://127.0.0.1:43001/queue');
});

test('a busy metadata request falls back once after a bounded wait and later standalone metadata stops polling', async () => {
  status('nodes', 'loading');
  const store = countedStore();
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return response({ current: { task_id: 'busy-worker', status: 'running' }, queued: {}, recent: [] });
  };
  await background(store, undefined, 5);
  assert.equal(store.count(), 0);
  assert.equal(tasks.getState().currentTask.task_id, 'busy-worker');
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^http:\/\/(127\.0\.0\.1|localhost):\d+\/queue$/);
  control.updateWorkerControl({ available: false, address: null });
  status('runtime', 'success');
  await background(store);
  assert.equal(requests.length, 1);
});

test('older successful metadata and failed discovery preserve legacy restoration and genuine errors', async () => {
  status('runtime', 'loading');
  const pending = background(nodes, undefined, 1000);
  globalThis.fetch = async () => {
    throw new TypeError('Actual control connection refused.');
  };
  status('runtime', 'success');
  await pending;
  assert.match(tasks.getState().supervisorControlError, /Actual control connection refused/);
  control.resetSupervisorControl();
  status('runtime', 'error');
  await background();
  assert.match(tasks.getState().supervisorControlError, /Actual control connection refused/);
});

test('known control is immediate even when discovery is busy', async () => {
  status('nodes', 'loading');
  control.updateWorkerControl({ available: true, address: 'http://127.0.0.1:43001' });
  const store = countedStore();
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'http://127.0.0.1:43001/queue');
    return response({ current: null, queued: {}, recent: [] });
  };
  await background(store);
  assert.equal(store.count(), 0);
});

test('cancelled periodic wait unsubscribes, clears its timer and never requests the queue', async () => {
  status('nodes', 'loading');
  const store = countedStore();
  const abort = new AbortController();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error('Cancelled polling must not fetch.');
  };
  const pending = background(store, abort.signal, 5);
  assert.equal(store.count(), 1);
  abort.abort();
  await pending;
  assert.equal(store.count(), 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(requests, 0);
  assert.equal(await control.waitForSupervisorMetadata(store, abort.signal), false);
});

test('metadata arriving between initial check and subscription cannot be lost', async () => {
  status('runtime', 'loading');
  let subscriptions = 0;
  const store = {
    getState: nodes.getState,
    subscribe(listener) {
      subscriptions++;
      control.updateWorkerControl({ available: false, address: null });
      status('runtime', 'success');
      const unsubscribe = nodes.subscribe(listener);
      return () => {
        subscriptions--;
        unsubscribe();
      };
    },
  };
  assert.equal(await control.waitForSupervisorMetadata(store), true);
  assert.equal(subscriptions, 0);
});

test('App uses the same bounded metadata wait for restoration and cancellable initial periodic polling', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(path.join(ROOT, 'src/App.tsx'), 'utf8');
  assert.match(source, /await waitForSupervisorMetadata\(useNodesStore\)/);
  assert.match(source, /await waitForSupervisorMetadata\(useNodesStore, abort\.signal\)/);
  assert.match(source, /abort\.abort\(\)/);
  assert.match(source, /SUPERVISOR_STARTUP_TIMEOUT_MS = 5_000/);
});

test('synchronous completion during registration removes the newly registered subscription', async () => {
  status('runtime', 'loading');
  let subscriptions = 0;
  const store = {
    getState: nodes.getState,
    subscribe(listener) {
      subscriptions++;
      control.updateWorkerControl({ available: false, address: null });
      listener();
      return () => {
        subscriptions--;
      };
    },
  };
  assert.equal(await control.waitForSupervisorMetadata(store), true);
  assert.equal(subscriptions, 0);
});
