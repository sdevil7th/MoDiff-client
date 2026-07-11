import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let originalFetch;
let server;
let studioStoreModule;

const storageValues = new Map();
const localStorageMock = {
  clear: () => storageValues.clear(),
  getItem: (key) => storageValues.get(key) ?? null,
  key: (index) => [...storageValues.keys()][index] ?? null,
  get length() {
    return storageValues.size;
  },
  removeItem: (key) => storageValues.delete(key),
  setItem: (key, value) => storageValues.set(key, String(value)),
};

before(async () => {
  globalThis.localStorage = localStorageMock;
  globalThis.window = {
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: localStorageMock,
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  studioStoreModule.useStudioStore.setState({
    outputs: [],
    outputRevision: 0,
    galleryBackendStatus: 'idle',
    galleryBackendError: null,
    galleryRequests: {
      history: { error: null, pending: 0 },
      mutation: { error: null, pending: 0 },
      sync: { error: null, pending: 0 },
    },
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

function output(id, favorite = false) {
  return {
    id,
    url: `http://127.0.0.1:5191/${id}.png`,
    nodeId: 'node-1',
    fieldKey: 'image',
    prompt: id,
    negativePrompt: '',
    favorite,
    createdAt: id.charCodeAt(0),
  };
}

async function flushPromises() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

test('a delayed output-history response cannot overwrite a newer local output revision', async () => {
  const call = deferred();
  globalThis.fetch = () => call.promise;
  const fetching = studioStoreModule.useStudioStore.getState().fetchBackendOutputs();
  studioStoreModule.useStudioStore.setState((state) => ({
    outputs: [output('local')],
    outputRevision: state.outputRevision + 1,
  }));
  call.resolve(jsonResponse({ error: false, outputs: [output('stale')] }));
  await fetching;

  const state = studioStoreModule.useStudioStore.getState();
  assert.deepEqual(
    state.outputs.map((item) => item.id),
    ['local'],
  );
  assert.equal(state.galleryBackendStatus, 'idle');
  assert.equal(state.galleryRequests.history.pending, 0);
});

test('an invalid backend output rejects the whole response instead of partially merging it', async () => {
  globalThis.fetch = async () => jsonResponse({ error: false, outputs: [output('valid'), { id: 'missing-url' }] });
  await studioStoreModule.useStudioStore.getState().fetchBackendOutputs();

  const state = studioStoreModule.useStudioStore.getState();
  assert.deepEqual(state.outputs, []);
  assert.equal(state.galleryBackendStatus, 'error');
  assert.match(state.galleryBackendError, /invalid output/);
});

test('a failed favorite mutation rolls back only the affected optimistic value', async () => {
  studioStoreModule.useStudioStore.setState({ outputs: [output('a', false)], outputRevision: 1 });
  const call = deferred();
  globalThis.fetch = () => call.promise;
  studioStoreModule.useStudioStore.getState().toggleFavoriteOutput('a');
  assert.equal(studioStoreModule.useStudioStore.getState().outputs[0].favorite, true);
  call.resolve(jsonResponse({ error: true, message: 'Favorite rejected.' }, 409));
  await flushPromises();

  const state = studioStoreModule.useStudioStore.getState();
  assert.equal(state.outputs[0].favorite, false);
  assert.equal(state.galleryRequests.mutation.pending, 0);
  assert.equal(state.galleryBackendError, 'Favorite rejected.');
});

test('an older favorite failure cannot undo or report over a newer successful toggle', async () => {
  studioStoreModule.useStudioStore.setState({ outputs: [output('a', false)], outputRevision: 1 });
  const calls = [];
  globalThis.fetch = () => {
    const call = deferred();
    calls.push(call);
    return call.promise;
  };

  studioStoreModule.useStudioStore.getState().toggleFavoriteOutput('a');
  studioStoreModule.useStudioStore.getState().toggleFavoriteOutput('a');
  calls[1].resolve(jsonResponse({ error: false, outputs: [output('a', false)] }));
  await flushPromises();
  calls[0].resolve(jsonResponse({ error: true, message: 'Stale failure.' }, 409));
  await flushPromises();

  const state = studioStoreModule.useStudioStore.getState();
  assert.equal(state.outputs[0].favorite, false);
  assert.equal(state.galleryBackendError, null);
  assert.equal(state.galleryRequests.mutation.pending, 0);
});

test('a failed output delete restores its target without removing a concurrent output', async () => {
  studioStoreModule.useStudioStore.setState({ outputs: [output('a'), output('b')], outputRevision: 1 });
  const call = deferred();
  globalThis.fetch = () => call.promise;
  studioStoreModule.useStudioStore.getState().deleteOutput('a');
  studioStoreModule.useStudioStore.setState((state) => ({
    outputs: [output('c'), ...state.outputs],
    outputRevision: state.outputRevision + 1,
  }));
  call.resolve(jsonResponse({ error: true, message: 'Delete rejected.' }, 409));
  await flushPromises();

  const state = studioStoreModule.useStudioStore.getState();
  assert.deepEqual(new Set(state.outputs.map((item) => item.id)), new Set(['a', 'b', 'c']));
  assert.equal(state.galleryBackendError, 'Delete rejected.');
});
