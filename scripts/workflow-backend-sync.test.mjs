import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_EFFECTS = '\0workflow-sync-hook-effects';
const HOOK_STORE = '\0workflow-sync-hook-store';
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

let server;
let studio;
let sync;
let flow;
let nodes;

before(async () => {
  globalThis.location = { origin: 'http://127.0.0.1:5191' };
  globalThis.window = {
    localStorage: storage(),
    sessionStorage: storage(),
    location: globalThis.location,
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.localStorage = globalThis.window.localStorage;
  globalThis.sessionStorage = globalThis.window.sessionStorage;
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    plugins: [
      {
        name: 'workflow-sync-controlled-hook-effects',
        enforce: 'pre',
        transform(code, id) {
          if (id.replaceAll('\\', '/').endsWith('/src/studio/useWorkflowBackendSync.ts'))
            return code.replace("from 'react'", "from 'workflow-sync-controlled-react'");
        },
        resolveId(id, importer) {
          if (!importer?.replaceAll('\\', '/').endsWith('/src/studio/useWorkflowBackendSync.ts')) return;
          if (id === 'workflow-sync-controlled-react') return HOOK_EFFECTS;
          if (id === '../stores/useStudioStore') return HOOK_STORE;
        },
        load(id) {
          if (id === HOOK_EFFECTS)
            return `export const useEffect = effect => globalThis.workflowSyncHook.effects.push(effect);
              export const useMemo = read => read();
              export const useState = initial => [initial === false ? globalThis.workflowSyncHook.hydrated : initial,
                value => { if (initial === false) { globalThis.workflowSyncHook.hydrated = value;
                  if (value) globalThis.workflowSyncHook.finish(); } }];`;
          if (id === HOOK_STORE)
            return `import {useStudioStore as actual} from '/src/stores/useStudioStore.ts';
              export const useStudioStore = selector => selector(actual.getState());
              useStudioStore.getState = actual.getState;
              useStudioStore.setState = actual.setState;`;
        },
      },
    ],
  });
  studio = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  sync = await server.ssrLoadModule('/src/studio/useWorkflowBackendSync.ts');
  flow = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  nodes = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
});

beforeEach(() => {
  sync.forgetBackendWorkflow('workflow-sync-test');
});

after(async () => {
  sync.forgetBackendWorkflow('workflow-sync-test');
  await server?.close();
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  delete globalThis.location;
  delete globalThis.window;
});

function workflowTab({ dirty, prompt }) {
  return {
    id: 'workflow-sync-test',
    title: 'Workflow sync test',
    createdAt: 1,
    updatedAt: 2,
    dirty,
    source: 'manual',
    backendRevision: 7,
    snapshot: {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      studioForm: { prompt },
      studioGraphBinding: null,
      selectedMode: 'text_to_image',
      activeTemplateId: null,
      sourceOutputId: null,
    },
  };
}

test('an exact delayed dirty marker clears after the backend owns the same document', () => {
  const backend = workflowTab({ dirty: false, prompt: 'Saved prompt' });
  sync.markBackendWorkflow(backend);
  studio.useStudioStore.setState({
    workflowTabs: [workflowTab({ dirty: true, prompt: 'Saved prompt' })],
    activeWorkflowTabId: backend.id,
  });

  assert.equal(sync.clearDirtyMarkerForExactBackendDocument(backend.id), true);
  assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, false);
});

test('a genuinely newer local document is never cleared by an older backend signature', () => {
  const backend = workflowTab({ dirty: false, prompt: 'Saved prompt' });
  sync.markBackendWorkflow(backend);
  studio.useStudioStore.setState({
    workflowTabs: [workflowTab({ dirty: true, prompt: 'New local prompt' })],
    activeWorkflowTabId: backend.id,
  });

  assert.equal(sync.clearDirtyMarkerForExactBackendDocument(backend.id), false);
  assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, true);
});

test('explicit saves share one in-flight chain per workflow', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (_url, options) =>
    new Promise((resolve) => {
      const body = JSON.parse(options.body);
      calls.push({
        body,
        finish: () =>
          resolve(
            new Response(
              JSON.stringify({
                ...body,
                id: 'workflow-sync-test',
                revision: calls.length + 7,
              }),
              { headers: { 'Content-Type': 'application/json' } },
            ),
          ),
      });
    });
  const first = workflowTab({ dirty: true, prompt: 'First explicit save' });
  studio.useStudioStore.setState({ workflowTabs: [first], activeWorkflowTabId: null });
  const a = sync.saveWorkflowNow(first, { merge: false });
  await new Promise((resolve) => setImmediate(resolve));
  const second = workflowTab({ dirty: true, prompt: 'Second explicit save' });
  studio.useStudioStore.setState({ workflowTabs: [second] });
  const b = sync.saveWorkflowNow(second, { merge: false });
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(calls.length, 1, 'second PUT must wait, not race the first save');
    calls[0].finish();
    await a;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.snapshot.studioForm.prompt, 'Second explicit save');
  } finally {
    calls.forEach((call) => call.finish());
    await Promise.all([a, b]);
    globalThis.fetch = originalFetch;
  }
});

for (const { editedWhileSaving, rejectedSave } of [
  { editedWhileSaving: false, rejectedSave: false },
  { editedWhileSaving: true, rejectedSave: false },
  { editedWhileSaving: false, rejectedSave: true },
]) {
  const outcome = rejectedSave
    ? 'retries a rejected save'
    : editedWhileSaving
      ? 'retains a newer edit'
      : 'skips a duplicate';
  test(`queued autosave ${outcome} after waiting for an explicit save`, async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    const errors = [];
    globalThis.fetch = (_url, options) =>
      new Promise((resolve, reject) => {
        const body = JSON.parse(options.body);
        calls.push({
          body,
          fail: () => reject(new Error('Explicit Save failed')),
          finish: () =>
            resolve(
              new Response(JSON.stringify({ ...body, id: 'workflow-sync-test', revision: calls.length + 7 }), {
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
        });
      });
    const saved = { ...workflowTab({ dirty: true, prompt: 'Explicit document' }), intent: 'saved' };
    studio.useStudioStore.setState({ workflowTabs: [saved], activeWorkflowTabId: null });
    const explicit = sync.saveWorkflowNow(saved, { merge: false });
    const rejected = rejectedSave ? assert.rejects(explicit, /Explicit Save failed/u) : null;
    await new Promise((resolve) => setImmediate(resolve));
    const latest = editedWhileSaving
      ? { ...saved, snapshot: { ...saved.snapshot, studioForm: { prompt: 'Newer local edit' } } }
      : saved;
    studio.useStudioStore.setState({ workflowTabs: [latest] });
    sync.queueWorkflowPut(latest, (error) => errors.push(error));
    try {
      assert.equal(calls.length, 1);
      if (rejectedSave) calls[0].fail();
      else calls[0].finish();
      await (rejected ?? explicit);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls.length, editedWhileSaving || rejectedSave ? 2 : 1);
      if (editedWhileSaving || rejectedSave) {
        assert.equal(
          calls[1].body.snapshot.studioForm.prompt,
          editedWhileSaving ? 'Newer local edit' : 'Explicit document',
        );
        assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, true);
      } else {
        assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, false);
      }
      assert.deepEqual(errors, []);
    } finally {
      calls.forEach((call) => call.finish());
      await (rejected ?? explicit);
      await new Promise((resolve) => setImmediate(resolve));
      globalThis.fetch = originalFetch;
    }
  });
}

test('a delayed own-save acknowledgement never replaces a newer clean document', () => {
  const newer = workflowTab({ dirty: false, prompt: 'Restored by Redo' });
  studio.useStudioStore.setState({ workflowTabs: [newer], activeWorkflowTabId: null });
  studio.useStudioStore.getState().mergeBackendWorkflow(
    {
      ...workflowTab({ dirty: false, prompt: 'Older in-flight save' }),
      backendRevision: 8,
    },
    { acknowledgement: true },
  );
  const retained = studio.useStudioStore.getState().workflowTabs[0];
  assert.equal(retained.snapshot.studioForm.prompt, 'Restored by Redo');
  assert.equal(retained.backendRevision, 8);
  assert.equal(retained.dirty, true, 'preserved newer document must still reach the backend');
});

test('a genuine remote update still refreshes an unchanged clean document', () => {
  studio.useStudioStore.setState({
    workflowTabs: [workflowTab({ dirty: false, prompt: 'Local clean snapshot' })],
    activeWorkflowTabId: null,
  });
  studio.useStudioStore.getState().mergeBackendWorkflow({
    ...workflowTab({ dirty: false, prompt: 'Changed in another browser' }),
    backendRevision: 8,
  });
  const retained = studio.useStudioStore.getState().workflowTabs[0];
  assert.equal(retained.snapshot.studioForm.prompt, 'Changed in another browser');
  assert.equal(retained.dirty, false);
});

test('late save acknowledgements and remote refresh retain user tab ordering', () => {
  const saved = workflowTab({ dirty: false, prompt: 'Saved' });
  const other = { ...saved, id: 'other-tab' };
  studio.useStudioStore.setState({ workflowTabs: [saved, other], activeWorkflowTabId: null });
  studio.useStudioStore.getState().moveWorkflowTab(other.id, saved.id, 'before');
  for (const acknowledgement of [true, false]) {
    studio.useStudioStore
      .getState()
      .mergeBackendWorkflow({ ...saved, backendRevision: acknowledgement ? 8 : 9 }, { acknowledgement });
    const tabs = studio.useStudioStore.getState().workflowTabs;
    assert.deepEqual(
      tabs.map((tab) => tab.id),
      [other.id, saved.id],
    );
    assert.equal(tabs[0], other);
  }
});

test('own websocket acknowledgement requires the exact nonempty session client id', () => {
  sessionStorage.setItem('modiff-workflow-client-id', 'this-browser');
  assert.equal(sync.isOwnWorkflowAcknowledgement({ clientId: 'this-browser' }), true);
  for (const payload of [null, {}, { clientId: '' }, { clientId: 'other-browser' }]) {
    assert.equal(sync.isOwnWorkflowAcknowledgement(payload), false);
  }
});

test('an exact own-save acknowledgement clears dirty without another document replacement', () => {
  studio.useStudioStore.setState({ workflowTabs: [], activeWorkflowTabId: null });
  studio.useStudioStore.getState().mergeBackendWorkflow(workflowTab({ dirty: false, prompt: 'Exact saved document' }));
  const local = { ...studio.useStudioStore.getState().workflowTabs[0], dirty: true };
  studio.useStudioStore.setState({ workflowTabs: [local], activeWorkflowTabId: null });
  studio.useStudioStore.getState().mergeBackendWorkflow(
    { ...local, dirty: false, backendRevision: 8 },
    {
      acknowledgement: true,
    },
  );
  const retained = studio.useStudioStore.getState().workflowTabs[0];
  assert.equal(retained.snapshot.studioForm.prompt, local.snapshot.studioForm.prompt);
  assert.equal(retained.backendRevision, 8);
  assert.equal(retained.dirty, false);
});

test('saved intent promotion retains newer graph edits without replacing the canvas', () => {
  const local = { ...workflowTab({ dirty: true, prompt: 'Newer local edit' }), intent: 'draft' };
  studio.useStudioStore.setState({ workflowTabs: [local], activeWorkflowTabId: null, workflowCanvasEpoch: 42 });
  studio.useStudioStore.getState().mergeBackendWorkflow(
    {
      ...local,
      intent: 'saved',
      snapshot: { ...local.snapshot, studioForm: { prompt: 'Earlier saved edit' } },
      backendRevision: 8,
    },
    { acknowledgement: true },
  );
  const state = studio.useStudioStore.getState();
  assert.equal(state.workflowTabs[0].intent, 'saved');
  assert.equal(state.workflowTabs[0].snapshot.studioForm.prompt, 'Newer local edit');
  assert.equal(state.workflowTabs[0].dirty, true);
  assert.equal(state.workflowCanvasEpoch, 42);
});

test('legacy documents stay saved and new explicit saves promote a draft', async () => {
  assert.equal(sync.backendWorkflowTab(workflowTab({ dirty: false, prompt: '' })).intent, 'saved');
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ ...sent, id: 'workflow-sync-test', revision: 9 }));
  };
  try {
    const draft = { ...workflowTab({ dirty: true, prompt: 'Keep me' }), intent: 'draft' };
    studio.useStudioStore.setState({ workflowTabs: [draft], activeWorkflowTabId: null });
    const saved = await sync.saveWorkflowNow(draft);
    assert.equal(sent.intent, 'saved');
    assert.equal(saved.intent, 'saved');
    assert.equal(studio.useStudioStore.getState().workflowTabs[0].intent, 'saved');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function startupHydrationFixture({ dirty = false } = {}) {
  const tab = workflowTab({ dirty, prompt: 'Original form' });
  tab.snapshot.nodes = [
    {
      id: 'hydration-text',
      type: 'custom',
      position: { x: 10, y: 20 },
      data: {
        type: 'custom',
        module: 'modules.Primitive',
        action: 'TextValue',
        label: 'Text',
        category: 'Value',
        params: { text: { type: 'string', value: 'Old text' }, output: { type: 'string', display: 'output' } },
      },
    },
    {
      id: 'hydration-preview',
      type: 'custom',
      position: { x: 300, y: 20 },
      data: {
        type: 'custom',
        module: 'modules.Image',
        action: 'Preview',
        label: 'Preview',
        category: 'Image',
        params: { image: { type: 'image', display: 'input' } },
      },
    },
  ];
  const registry = {
    'modules.Image.Preview': {
      ...tab.snapshot.nodes[1].data,
      params: {
        ...tab.snapshot.nodes[1].data.params,
        selected_image: { type: 'image', display: 'ui_image', value: [] },
      },
    },
  };
  nodes.useNodesStore.setState({ nodesRegistry: registry });
  studio.useStudioStore.setState({ workflowTabs: [], activeWorkflowTabId: null, currentRunContext: null });
  studio.useStudioStore.getState().mergeBackendWorkflow(tab);
  const normalized = structuredClone(studio.useStudioStore.getState().workflowTabs[0]);
  normalized.dirty = dirty;
  flow.useFlowStore.getState().replaceGraph(normalized.snapshot);
  studio.useStudioStore.setState({
    workflowTabs: [normalized],
    activeWorkflowTabId: normalized.id,
    workflowCanvasEpoch: 25,
    form: normalized.snapshot.studioForm,
    graphBinding: normalized.snapshot.studioGraphBinding,
    selectedMode: normalized.snapshot.selectedMode,
    activeTemplateId: normalized.snapshot.activeTemplateId,
    sourceOutputId: normalized.snapshot.sourceOutputId,
    pinnedGraphInputIds: normalized.snapshot.pinnedGraphInputIds,
    autoFieldOverrides: normalized.snapshot.autoFieldOverrides,
    outputs: [],
    previewSlots: {},
  });
  const incoming = structuredClone(normalized);
  incoming.backendRevision = 12;
  incoming.snapshot.nodes[0].data.params.text.value = 'New backend text';
  return {
    baseline: structuredClone(normalized),
    incoming,
    registry,
    options: { hydrationBaseline: { tab: structuredClone(normalized), canvasEpoch: 25, registry } },
  };
}

async function delayedHydration({ dirty = true, beforeRead, duringRead, backendFor, autosave = false }) {
  const fixture = startupHydrationFixture({ dirty });
  // Start with the normal materialized checkpoint already on the backend:
  // registry-populated empty previews/connection flags are a separate contract.
  studio.useStudioStore.getState().saveActiveWorkflowTab(true);
  const checkpoint = structuredClone(studio.useStudioStore.getState().workflowTabs[0]);
  checkpoint.dirty = dirty;
  fixture.baseline = structuredClone(checkpoint);
  fixture.incoming = structuredClone(checkpoint);
  fixture.incoming.backendRevision = 12;
  fixture.incoming.snapshot.nodes[0].data.params.text.value = 'New backend text';
  studio.useStudioStore.setState({ workflowTabs: [checkpoint] });
  studio.useStudioStore.setState({ workflowCanvasHydrated: true });
  const originalFetch = globalThis.fetch;
  const writes = [];
  const timers = [];
  let finish;
  let finishRead;
  let failRead;
  let fail;
  const finished = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const deadline = setTimeout(() => fail(new Error('Controlled hydration did not settle.')), 5000);
  const read = new Promise((resolve, reject) => {
    finishRead = resolve;
    failRead = reject;
  });
  globalThis.workflowSyncHook = { effects: [], hydrated: false, finish };
  globalThis.window.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  };
  globalThis.window.clearTimeout = () => {};
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method !== 'PUT') {
      options.signal?.addEventListener('abort', () => failRead(options.signal.reason), { once: true });
      return read;
    }
    const body = JSON.parse(options.body);
    writes.push(body);
    return new Response(JSON.stringify({ ...body, id: fixture.baseline.id, revision: 30 }));
  };
  let cleanup;
  try {
    await beforeRead?.(fixture);
    sync.useWorkflowBackendSync();
    cleanup = globalThis.workflowSyncHook.effects[0]();
    await duringRead?.(fixture);
    const backend = backendFor ? backendFor(fixture) : fixture.baseline;
    finishRead(
      backend
        ? new Response(JSON.stringify({ ...backend, revision: backend.backendRevision }))
        : new Response(JSON.stringify({ error: true }), { status: 404 }),
    );
    await finished;
    if (autosave) {
      globalThis.workflowSyncHook.effects = [];
      sync.useWorkflowBackendSync();
      globalThis.workflowSyncHook.effects[1]();
      for (const timer of timers) if (timer.delay === 500) timer.callback();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { fixture, writes, current: structuredClone(studio.useStudioStore.getState().workflowTabs[0]) };
  } finally {
    clearTimeout(deadline);
    cleanup?.();
    globalThis.fetch = originalFetch;
    delete globalThis.workflowSyncHook;
    delete globalThis.window.setTimeout;
    delete globalThis.window.clearTimeout;
  }
}

test('delayed hydration never republishes its captured snapshot over a newer checkpoint', async () => {
  let latest;
  const result = await delayedHydration({
    duringRead() {
      flow.useFlowStore.getState().setParamWithHistory('hydration-text', 'text', 'New local text');
      studio.useStudioStore.getState().updateForm({ prompt: 'New local form' });
      studio.useStudioStore.getState().saveActiveWorkflowTab(true);
      latest = structuredClone(studio.useStudioStore.getState().workflowTabs[0]);
    },
  });
  assert.equal(result.writes.length, 1);
  assert.notDeepEqual(
    result.writes[0].snapshot,
    result.fixture.baseline.snapshot,
    'no metadata-only echo of old content',
  );
  assert.deepEqual(result.writes[0].snapshot, latest.snapshot, 'the actual current checkpoint owns the PUT');
  assert.deepEqual(result.current.snapshot, latest.snapshot, 'acknowledgement retains the current graph and form');
});

test('delayed hydration cannot replace a newer acknowledgement signature with an older read', async () => {
  let acknowledged;
  const result = await delayedHydration({
    dirty: false,
    duringRead(fixture) {
      acknowledged = structuredClone(fixture.baseline);
      acknowledged.backendRevision = 29;
      acknowledged.snapshot.nodes[0].data.params.text.value = 'New acknowledged text';
      sync.markBackendWorkflow(acknowledged);
      studio.useStudioStore.getState().mergeBackendWorkflow(acknowledged);
    },
    autosave: true,
  });
  assert.equal(result.current.backendRevision, 29);
  assert.deepEqual(result.current.snapshot, acknowledged.snapshot);
  assert.equal(result.writes.length, 0, 'an old GET must not trigger an autosave of already acknowledged content');
});

test('delayed hydration cannot republish a newer acknowledgement after an overtaken missing read', async () => {
  let acknowledged;
  const result = await delayedHydration({
    dirty: false,
    backendFor: () => null,
    duringRead(fixture) {
      acknowledged = structuredClone(fixture.baseline);
      acknowledged.backendRevision = 29;
      acknowledged.snapshot.nodes[0].data.params.text.value = 'New acknowledged text';
      sync.markBackendWorkflow(acknowledged);
      studio.useStudioStore.getState().mergeBackendWorkflow(acknowledged);
    },
    autosave: true,
  });
  assert.equal(result.current.backendRevision, 29);
  assert.deepEqual(result.current.snapshot, acknowledged.snapshot);
  assert.equal(result.writes.length, 0, 'an overtaken 404 must not republish already acknowledged content');
});

test('delayed hydration uploads a newer dirty checkpoint after an acknowledgement and missing read', async () => {
  let latest;
  const result = await delayedHydration({
    dirty: false,
    backendFor: () => null,
    duringRead(fixture) {
      const acknowledged = structuredClone(fixture.baseline);
      acknowledged.backendRevision = 29;
      sync.markBackendWorkflow(acknowledged);
      studio.useStudioStore.getState().mergeBackendWorkflow(acknowledged);
      flow.useFlowStore.getState().setParamWithHistory('hydration-text', 'text', 'New unacknowledged text');
      studio.useStudioStore.getState().saveActiveWorkflowTab(true);
      latest = structuredClone(studio.useStudioStore.getState().workflowTabs[0]);
    },
  });
  assert.equal(result.writes.length, 1);
  assert.deepEqual(result.writes[0].snapshot, latest.snapshot);
  assert.deepEqual(result.current.snapshot, latest.snapshot);
});

test('delayed hydration recreates a genuinely missing document acknowledged before its read', async () => {
  let acknowledged;
  const result = await delayedHydration({
    dirty: false,
    backendFor: () => null,
    beforeRead(fixture) {
      acknowledged = structuredClone(fixture.baseline);
      acknowledged.backendRevision = 29;
      sync.markBackendWorkflow(acknowledged);
      studio.useStudioStore.getState().mergeBackendWorkflow(acknowledged);
    },
    autosave: true,
  });
  assert.equal(result.writes.length, 1, 'an acknowledgement predating this GET cannot waive a genuine 404');
  assert.deepEqual(result.writes[0].snapshot, acknowledged.snapshot);
  assert.deepEqual(result.current.snapshot, acknowledged.snapshot);
});

test('delayed hydration acknowledges an exact restored dirty document without a PUT', async () => {
  const result = await delayedHydration({ autosave: true });
  assert.equal(result.writes.length, 0);
  assert.equal(result.current.dirty, false);
  assert.deepEqual(result.current.snapshot, result.fixture.baseline.snapshot);
});

test('delayed hydration creates a missing document from the current checkpoint', async () => {
  let latest;
  const result = await delayedHydration({
    backendFor: () => null,
    duringRead() {
      flow.useFlowStore.getState().setParamWithHistory('hydration-text', 'text', 'Current new draft');
      studio.useStudioStore.getState().saveActiveWorkflowTab(true);
      latest = structuredClone(studio.useStudioStore.getState().workflowTabs[0]);
    },
  });
  assert.equal(result.writes.length, 1);
  assert.deepEqual(result.writes[0].snapshot, latest.snapshot);
  assert.deepEqual(result.current.snapshot, latest.snapshot);
});

test('delayed hydration retains a genuinely dirty document against a newer remote document', async () => {
  const result = await delayedHydration({ backendFor: (fixture) => fixture.incoming });
  assert.equal(result.writes.length, 1);
  assert.deepEqual(result.writes[0].snapshot, result.fixture.baseline.snapshot);
  assert.deepEqual(result.current.snapshot, result.fixture.baseline.snapshot);
});

test('delayed hydration accepts a newer remote document for an unchanged clean tab', async () => {
  const result = await delayedHydration({ dirty: false, backendFor: (fixture) => fixture.incoming, autosave: true });
  assert.equal(result.writes.length, 0);
  assert.equal(result.current.dirty, false);
  assert.deepEqual(result.current.snapshot, result.fixture.incoming.snapshot);
});

function checkpointedSavedWorkflow() {
  startupHydrationFixture();
  // Persist the passive registry/connection metadata once, as a successful PUT would.
  studio.useStudioStore.getState().saveActiveWorkflowTab(true);
  const saved = { ...studio.useStudioStore.getState().workflowTabs[0], dirty: false, updatedAt: 1234 };
  studio.useStudioStore.setState({ workflowTabs: [saved] });
  sync.markBackendWorkflow(saved);
  return saved;
}

test('unchanged canvas checkpoints preserve the saved marker and document timestamp', () => {
  const saved = checkpointedSavedWorkflow();
  for (let index = 0; index < 5; index += 1) {
    studio.useStudioStore.getState().saveActiveWorkflowTab(true);
    const current = studio.useStudioStore.getState().workflowTabs[0];
    assert.equal(current.dirty, false);
    assert.equal(current.updatedAt, saved.updatedAt);
    assert.equal(current, saved, 'an identical checkpoint must retain the document');
  }
});

test('an unchanged checkpoint preserves an unsaved edit until its exact acknowledgement', () => {
  checkpointedSavedWorkflow();
  flow.useFlowStore.getState().setParamWithHistory('hydration-text', 'text', 'Keep this unsaved edit');
  studio.useStudioStore.getState().saveActiveWorkflowTab(true);
  const edited = studio.useStudioStore.getState().workflowTabs[0];
  assert.equal(edited.dirty, true);
  assert.equal(edited.snapshot.nodes[0].data.params.text.value, 'Keep this unsaved edit');
  assert.equal(sync.clearDirtyMarkerForExactBackendDocument(edited.id), false);
  studio.useStudioStore.getState().saveActiveWorkflowTab(true);
  assert.equal(studio.useStudioStore.getState().workflowTabs[0], edited);
});

test('switching away from an unchanged saved canvas does not mark it unsaved', () => {
  const saved = checkpointedSavedWorkflow();
  const other = { ...structuredClone(saved), id: 'other-clean-workflow', title: 'Other workflow' };
  studio.useStudioStore.setState({ workflowTabs: [saved, other] });
  studio.useStudioStore.getState().switchWorkflowTab(other.id);
  assert.equal(studio.useStudioStore.getState().workflowTabs[0], saved);
  assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, false);
});

test('startup hydration replaces a clean baseline after only passive registry and connection metadata', () => {
  const fixture = startupHydrationFixture();
  studio.useStudioStore.getState().saveActiveWorkflowTab(true);
  const checkpoint = studio.useStudioStore.getState().workflowTabs[0];
  assert.equal(checkpoint.dirty, true);
  assert.equal(checkpoint.snapshot.nodes[0].data.params.output.isConnected, false);
  assert.deepEqual(checkpoint.snapshot.nodes[1].data.params.selected_image, {
    type: 'image',
    display: 'ui_image',
    value: [],
  });
  const unchangedBaseline = structuredClone(fixture.options.hydrationBaseline);

  studio.useStudioStore.getState().mergeBackendWorkflow(fixture.incoming, fixture.options);

  assert.equal(
    studio.useStudioStore.getState().workflowTabs[0].snapshot.nodes[0].data.params.text.value,
    'New backend text',
  );
  assert.equal(flow.useFlowStore.getState().nodes[0].data.params.text.value, 'New backend text');
  assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, false);
  assert.deepEqual(
    fixture.options.hydrationBaseline,
    unchangedBaseline,
    'comparison must not rewrite the baseline or registry',
  );
});

const pendingHydrationEdits = [
  [
    'authored text before the checkpoint',
    () => flow.useFlowStore.getState().setParamWithHistory('hydration-text', 'text', 'Operator edit'),
  ],
  ['form', () => studio.useStudioStore.getState().updateForm({ prompt: 'Operator form edit' })],
  ['title', () => studio.useStudioStore.getState().renameWorkflowTab('workflow-sync-test', 'Operator title')],
  [
    'intent',
    () =>
      studio.useStudioStore.setState((state) => ({
        workflowTabs: state.workflowTabs.map((tab) => ({ ...tab, intent: 'draft' })),
      })),
  ],
  [
    'position',
    () =>
      flow.useFlowStore
        .getState()
        .onNodesChange([{ type: 'position', id: 'hydration-text', position: { x: 99, y: 20 }, dragging: true }]),
  ],
  ['dimensions', () => flow.useFlowStore.getState().setNodeSize('hydration-text', 500, 400)],
  ['viewport', () => flow.useFlowStore.getState().setViewport({ x: 17, y: 23, zoom: 2 })],
  ['binding', () => studio.useStudioStore.setState({ graphBinding: { fingerprint: 'operator-binding' } })],
  [
    'topology',
    () =>
      flow.useFlowStore.getState().onEdgesChange([
        {
          type: 'add',
          item: {
            id: 'new-wire',
            source: 'hydration-text',
            sourceHandle: 'output',
            target: 'hydration-preview',
            targetHandle: 'image',
          },
        },
      ]),
  ],
  [
    'node definition',
    () =>
      flow.useFlowStore.setState((state) => ({
        nodes: state.nodes.map((node) =>
          node.id === 'hydration-text' ? { ...node, data: { ...node.data, action: 'OtherTextValue' } } : node,
        ),
      })),
  ],
  ['schema', () => flow.useFlowStore.getState().setParamWithHistory('hydration-text', 'text', 'int', 'type')],
  [
    'true connection state',
    () => flow.useFlowStore.getState().setParam('hydration-text', 'output', true, 'isConnected'),
  ],
  [
    'wrong-type connection state',
    () => flow.useFlowStore.getState().setParam('hydration-text', 'output', 'false', 'isConnected'),
  ],
  [
    'nonempty preview',
    () => flow.useFlowStore.getState().setParam('hydration-preview', 'selected_image', ['@data/current.png']),
  ],
  [
    'extra preview schema',
    () => flow.useFlowStore.getState().setParam('hydration-preview', 'selected_image', 'Authored preview', 'label'),
  ],
];

for (const [label, edit] of pendingHydrationEdits) {
  test(`startup hydration preserves a pending ${label} change`, async () => {
    const fixture = startupHydrationFixture();
    await edit();
    // Capture the actual live document, including an edit made before the delayed checkpoint.
    studio.useStudioStore.getState().saveActiveWorkflowTab(true);
    const expected = structuredClone(studio.useStudioStore.getState().workflowTabs[0]);
    studio.useStudioStore.getState().mergeBackendWorkflow(fixture.incoming, fixture.options);
    const retained = studio.useStudioStore.getState().workflowTabs[0];
    assert.deepEqual(retained.snapshot, expected.snapshot);
    assert.equal(retained.title, expected.title);
    assert.equal(retained.dirty, true);
    assert.equal(retained.backendRevision, 12);
  });
}

test('startup hydration protects a real live edit even before its checkpoint marks dirty', () => {
  const fixture = startupHydrationFixture();
  flow.useFlowStore.getState().setParamWithHistory('hydration-text', 'text', 'Uncheckpointed operator edit');
  assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, false);
  studio.useStudioStore.getState().mergeBackendWorkflow(fixture.incoming, fixture.options);
  assert.equal(
    studio.useStudioStore.getState().workflowTabs[0].snapshot.nodes[0].data.params.text.value,
    'Uncheckpointed operator edit',
  );
  assert.equal(flow.useFlowStore.getState().nodes[0].data.params.text.value, 'Uncheckpointed operator edit');
});

test('startup hydration never overrides an originally dirty restored document', () => {
  const fixture = startupHydrationFixture({ dirty: true });
  studio.useStudioStore.getState().saveActiveWorkflowTab(true);
  const expected = structuredClone(studio.useStudioStore.getState().workflowTabs[0].snapshot);
  studio.useStudioStore.getState().mergeBackendWorkflow(fixture.incoming, fixture.options);
  assert.deepEqual(studio.useStudioStore.getState().workflowTabs[0].snapshot, expected);
  assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, true);
});

for (const [label, change] of [
  [
    'undeclared field',
    (fixture) => {
      delete fixture.registry['modules.Image.Preview'].params.selected_image;
    },
  ],
  [
    'mismatched registry schema',
    (fixture) => {
      fixture.registry['modules.Image.Preview'].params.selected_image.type = 'video';
    },
  ],
  [
    'missing registry',
    (fixture) => {
      fixture.options.hydrationBaseline.registry = {};
    },
  ],
  [
    'own acknowledgement',
    (fixture) => {
      fixture.options.acknowledgement = true;
    },
  ],
  [
    'changed canvas context',
    () => {
      studio.useStudioStore.setState({ workflowCanvasEpoch: 26 });
    },
  ],
  [
    'changed active tab context',
    () => {
      studio.useStudioStore.setState({ activeWorkflowTabId: 'another-tab' });
    },
  ],
  [
    'advanced local revision',
    () => {
      studio.useStudioStore.setState((state) => ({
        workflowTabs: state.workflowTabs.map((tab) => ({ ...tab, backendRevision: 9 })),
      }));
    },
  ],
]) {
  test(`startup hydration does not waive ${label}`, () => {
    const fixture = startupHydrationFixture();
    studio.useStudioStore.getState().saveActiveWorkflowTab(true);
    change(fixture);
    const expected = structuredClone(studio.useStudioStore.getState().workflowTabs[0].snapshot);
    studio.useStudioStore.getState().mergeBackendWorkflow(fixture.incoming, fixture.options);
    assert.deepEqual(studio.useStudioStore.getState().workflowTabs[0].snapshot, expected);
    assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, true);
  });
}

for (const revision of [6, 7]) {
  test(`startup hydration does not replace with stale or equal revision ${revision}`, () => {
    const fixture = startupHydrationFixture();
    studio.useStudioStore.getState().saveActiveWorkflowTab(true);
    fixture.incoming.backendRevision = revision;
    const expected = structuredClone(studio.useStudioStore.getState().workflowTabs[0]);
    studio.useStudioStore.getState().mergeBackendWorkflow(fixture.incoming, fixture.options);
    assert.deepEqual(studio.useStudioStore.getState().workflowTabs[0], expected);
  });
}

test('startup hydration retains the active run and current preview authority', () => {
  const fixture = startupHydrationFixture();
  studio.useStudioStore.getState().saveActiveWorkflowTab(true);
  const context = { workflowTabId: fixture.baseline.id, clientRunId: 'active-local-run', status: 'running' };
  const slots = {
    current: { workflowTabId: fixture.baseline.id, taskId: 'actual-current-task', value: '@data/current.png' },
  };
  studio.useStudioStore.setState({ currentRunContext: context, previewSlots: slots });
  const expected = structuredClone(studio.useStudioStore.getState().workflowTabs[0].snapshot);
  studio.useStudioStore.getState().mergeBackendWorkflow(fixture.incoming, fixture.options);
  assert.deepEqual(studio.useStudioStore.getState().workflowTabs[0].snapshot, expected);
  assert.equal(studio.useStudioStore.getState().currentRunContext, context);
  assert.equal(studio.useStudioStore.getState().previewSlots, slots);
  assert.equal(studio.useStudioStore.getState().workflowTabs[0].dirty, true);
});
