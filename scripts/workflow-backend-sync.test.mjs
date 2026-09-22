import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

before(async () => {
  globalThis.location = { origin: 'http://127.0.0.1:5191' };
  globalThis.window = {
    localStorage: storage(),
    sessionStorage: storage(),
    location: globalThis.location,
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
  });
  studio = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  sync = await server.ssrLoadModule('/src/studio/useWorkflowBackendSync.ts');
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
