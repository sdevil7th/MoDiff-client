import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let originalFetch;
let server;
let studioStoreModule;
let previewStateModule;

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
  previewStateModule = await server.ssrLoadModule('/src/studio/previewState.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  storageValues.clear();
  studioStoreModule.useStudioStore.setState({
    outputs: [],
    outputRevision: 0,
    previewSlots: {},
    previewStateRevision: 0,
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

function previewSlot(currentOutputId, revision = 1) {
  return {
    schemaVersion: 1,
    workflowTabId: 'workflow-a',
    nodeId: 'node-1',
    fieldKey: 'image',
    currentOutputId,
    pendingClientRunId: null,
    pendingTaskId: null,
    generation: revision,
    attemptIndex: 0,
    status: currentOutputId ? 'ready' : 'pending',
    updatedAt: revision,
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

test('backend-owned output history is not duplicated into localStorage', async () => {
  globalThis.fetch = async () => jsonResponse({ error: false, outputs: [output('backend')] });
  await studioStoreModule.useStudioStore.getState().fetchBackendOutputs();

  assert.deepEqual(
    studioStoreModule.useStudioStore.getState().outputs.map((item) => item.id),
    ['backend'],
  );
  const persisted = JSON.parse(storageValues.get('modiff.studio'));
  assert.equal(Object.hasOwn(persisted.state, 'outputs'), false);
});

test('refresh hydrates the durable current preview separately from previous outputs', async () => {
  const current = { ...output('current'), workflowTabId: 'workflow-a' };
  const previous = { ...output('previous'), workflowTabId: 'workflow-a' };
  globalThis.fetch = async () =>
    jsonResponse({
      error: false,
      outputs: [current, previous],
      previewSlots: [previewSlot('current', 4)],
      revision: 4,
    });

  await studioStoreModule.useStudioStore.getState().fetchBackendOutputs();
  const state = studioStoreModule.useStudioStore.getState();
  const key = studioStoreModule.studioPreviewSlotKey('node-1', 'image', 'workflow-a');
  assert.equal(state.previewSlots[key].currentOutputId, 'current');
  assert.deepEqual(
    previewStateModule
      .previousOutputsForPreview(
        state.outputs,
        'workflow-a',
        'node-1',
        'image',
        state.previewSlots[key].currentOutputId,
      )
      .map((item) => item.id),
    ['previous'],
  );
});

test('a slower history response cannot replace a newer preview-state revision', async () => {
  const call = deferred();
  globalThis.fetch = () => call.promise;
  const fetching = studioStoreModule.useStudioStore.getState().fetchBackendOutputs();
  studioStoreModule.useStudioStore.getState().mergePreviewState([previewSlot('new-current', 9)], 9);
  call.resolve(
    jsonResponse({
      error: false,
      outputs: [{ ...output('old-current'), workflowTabId: 'workflow-a' }],
      previewSlots: [previewSlot('old-current', 8)],
      revision: 8,
    }),
  );
  await fetching;

  const state = studioStoreModule.useStudioStore.getState();
  const key = studioStoreModule.studioPreviewSlotKey('node-1', 'image', 'workflow-a');
  assert.equal(state.previewStateRevision, 9);
  assert.equal(state.previewSlots[key].currentOutputId, 'new-current');
});

test('legacy localStorage output copies are discarded during hydration', async () => {
  const state = studioStoreModule.useStudioStore.getState();
  storageValues.set(
    'modiff.studio',
    JSON.stringify({
      state: {
        selectedMode: state.selectedMode,
        form: state.form,
        outputs: [output('legacy')],
      },
      version: 0,
    }),
  );

  await studioStoreModule.useStudioStore.persist.rehydrate();

  assert.deepEqual(studioStoreModule.useStudioStore.getState().outputs, []);
});

test('workflow snapshots drop obsolete per-tab user-block copies', () => {
  const state = studioStoreModule.useStudioStore.getState();
  state.mergeBackendWorkflow({
    id: 'legacy-user-block-workflow',
    title: 'Legacy user block workflow',
    createdAt: 1,
    updatedAt: 1,
    dirty: false,
    source: 'manual',
    snapshot: {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      studioForm: state.form,
      studioGraphBinding: null,
      selectedMode: state.selectedMode,
      activeTemplateId: null,
      sourceOutputId: null,
      pinnedGraphInputIds: [],
      userBlocks: [
        {
          id: 'legacy-copy',
          name: 'Legacy copy',
          version: 1,
          nodes: [],
          edges: [],
          inputs: [],
          outputs: [],
          exposedParams: [],
        },
      ],
    },
  });

  const snapshot = studioStoreModule.useStudioStore
    .getState()
    .workflowTabs.find((tab) => tab.id === 'legacy-user-block-workflow')?.snapshot;
  assert.ok(snapshot);
  assert.equal(Object.hasOwn(snapshot, 'userBlocks'), false);
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
