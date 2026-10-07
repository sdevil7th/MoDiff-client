import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server, origin, sync, studio, originalFetch;
const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
before(async () => {
  globalThis.localStorage = globalThis.sessionStorage = storage;
  globalThis.window = {
    localStorage: storage,
    sessionStorage: storage,
    location: { origin: 'http://127.0.0.1:5191' },
    dispatchEvent: () => true,
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  origin = await server.ssrLoadModule('/src/studio/workflowDocumentOrigin.ts');
  studio = (await server.ssrLoadModule('/src/stores/useStudioStore.ts')).useStudioStore;
  sync = await server.ssrLoadModule('/src/studio/useWorkflowBackendSync.ts');
  originalFetch = globalThis.fetch;
});
beforeEach(() => {
  for (const tab of studio.getState().workflowTabs) origin.forgetFreshWorkflowId(tab.id);
  studio.setState({ workflowTabs: [], activeWorkflowTabId: null });
});
after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  delete globalThis.window;
});
function tab(id) {
  return studio.getState().workflowTabs.find((x) => x.id === id);
}
function response(value) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}
function record(t) {
  return { ...t, revision: 1 };
}

test('a genuinely new tab skips its first GET and consumes its marker before the ordinary PUT', async () => {
  const id = studio.getState().createWorkflowTab();
  const t = tab(id);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([String(url), options?.method ?? 'GET']);
    assert.equal(origin.isFreshWorkflowId(id), false);
    return response(record(t));
  };
  assert.equal(origin.isFreshWorkflowId(id), true);
  assert.equal(await sync.readWorkflowForHydration(t), null);
  assert.deepEqual(calls, []);
  await sync.saveDetachedWorkflowNow(t);
  assert.deepEqual(
    calls.map((x) => x[1]),
    ['PUT'],
  );
  assert.equal(origin.isFreshWorkflowId(id), false);
});

test('restored legacy revision-zero/source-new documents still read remote authority', async () => {
  studio.getState().ensureWorkflowTabs();
  const fresh = tab(studio.getState().activeWorkflowTabId);
  const restored = { ...fresh, id: 'restored-document', backendRevision: 0, source: 'new' };
  studio.setState({ workflowTabs: [restored], activeWorkflowTabId: restored.id });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options?.method ?? 'GET');
    return response({ ...record(restored), title: 'Actual remote title' });
  };
  assert.equal(origin.isFreshWorkflowId(restored.id), false);
  assert.equal((await sync.readWorkflowForHydration(restored)).title, 'Actual remote title');
  assert.deepEqual(calls, ['GET']);
});

test('lost PUT response consumes fresh authority so retry reads the document the server may have saved', async () => {
  const id = studio.getState().createWorkflowTab();
  const t = tab(id);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options?.method ?? 'GET');
    if (options?.method === 'PUT') throw new TypeError('PUT response lost after server save');
    return response({ ...record(t), title: 'Saved by first PUT' });
  };
  assert.equal(await sync.readWorkflowForHydration(t), null);
  await assert.rejects(sync.saveDetachedWorkflowNow(t), /PUT response lost/);
  assert.equal(origin.isFreshWorkflowId(id), false);
  assert.equal((await sync.readWorkflowForHydration(t)).title, 'Saved by first PUT');
  assert.deepEqual(calls, ['PUT', 'GET']);
});

test('cancel before first PUT retains fresh authority; aborted dispatch makes StrictMode retry read', async () => {
  const id = studio.getState().createWorkflowTab();
  const t = tab(id);
  const abort = new AbortController();
  abort.abort();
  assert.equal(await sync.readWorkflowForHydration(t, abort.signal), null);
  assert.equal(origin.isFreshWorkflowId(id), true);
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(options?.method ?? 'GET');
    if (options?.method === 'PUT') throw new DOMException('Page lifecycle ended', 'AbortError');
    return response(record(t));
  };
  await assert.rejects(sync.saveDetachedWorkflowNow(t));
  await sync.readWorkflowForHydration(t);
  assert.deepEqual(calls, ['PUT', 'GET']);
});

test('all three fresh creation paths mark IDs, while closing, deletion and acknowledgement clear them', () => {
  studio.getState().ensureWorkflowTabs();
  const first = studio.getState().activeWorkflowTabId;
  assert.equal(origin.isFreshWorkflowId(first), true);
  studio.getState().closeWorkflowTab(first);
  const replacement = studio.getState().activeWorkflowTabId;
  assert.notEqual(replacement, first);
  assert.equal(origin.isFreshWorkflowId(first), false);
  assert.equal(origin.isFreshWorkflowId(replacement), true);
  const created = studio.getState().createWorkflowTab();
  assert.equal(origin.isFreshWorkflowId(created), true);
  sync.markBackendWorkflow(tab(created));
  assert.equal(origin.isFreshWorkflowId(created), false);
  sync.forgetBackendWorkflow(replacement);
  assert.equal(origin.isFreshWorkflowId(replacement), false);
});

test('a restored current-document ID never acquires freshness from backendRevision or local serialization', () => {
  const id = studio.getState().createWorkflowTab();
  const serialized = JSON.stringify(tab(id));
  origin.forgetFreshWorkflowId(id);
  const restored = JSON.parse(serialized);
  studio.setState({ workflowTabs: [restored], activeWorkflowTabId: id });
  assert.equal(origin.isFreshWorkflowId(id), false);
  assert.equal(serialized.includes('FreshWorkflow'), false);
});
