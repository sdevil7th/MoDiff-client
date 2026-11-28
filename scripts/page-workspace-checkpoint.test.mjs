import { runInNewContext } from 'node:vm';
import { installEphemeralWorkflowStorage } from './workflow-library-ephemeral-storage.mjs';
import { installEphemeralGalleryStorage } from './template-gallery-runner.mjs';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const servers = [];
const originalFetch = globalThis.fetch;

function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function activate(page) {
  globalThis.window = page.window;
  globalThis.localStorage = page.window.localStorage;
  globalThis.sessionStorage = page.window.sessionStorage;
  globalThis.location = page.window.location;
}

async function page(local, session = storage(), initialize) {
  const context = {
    window: { localStorage: local, sessionStorage: session, location: { origin: 'http://127.0.0.1:5191' } },
  };
  activate(context);
  initialize?.();
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    cacheDir: path.join(ROOT, 'node_modules', `.vite-page-checkpoint-${servers.length}`),
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  servers.push(server);
  context.studio = (await server.ssrLoadModule('/src/stores/useStudioStore.ts')).useStudioStore;
  context.flow = (await server.ssrLoadModule('/src/stores/useFlowStore.ts')).useFlowStore;
  context.settings = (await server.ssrLoadModule('/src/stores/useSettingsStore.ts')).useSettingsStore;
  context.nodes = (await server.ssrLoadModule('/src/stores/useNodeStore.ts')).useNodesStore;
  context.websocket = await server.ssrLoadModule('/src/stores/websocketMessageHandler.ts');
  context.checkpoints = await server.ssrLoadModule('/src/utils/checkpointStorage.ts');
  context.toasts = await server.ssrLoadModule('/src/ui/snackbar.ts');
  return context;
}

function seed(context, label, count = 3) {
  activate(context);
  const form = { ...context.studio.getState().form, prompt: `${label} authored prompt`, seed: 7654321 };
  const nodes = [
    {
      id: `${label}-text`,
      type: 'custom',
      position: { x: 42, y: 81 },
      data: {
        type: 'custom',
        label: `${label} text`,
        module: 'fixture.Text',
        action: 'Text',
        params: { text: { type: 'string', value: `${label} authored value` } },
      },
    },
  ];
  const viewport = { x: 21, y: 34, zoom: 0.75 };
  const snapshot = {
    nodes,
    edges: [],
    viewport,
    studioForm: form,
    studioGraphBinding: null,
    selectedMode: form.mode,
    activeTemplateId: null,
    sourceOutputId: null,
  };
  const tabs = Array.from({ length: count }, (_, index) => ({
    id: `${label}-${index}`,
    title: `${label} ${index}`,
    createdAt: index + 1,
    updatedAt: index + 10,
    dirty: true,
    source: 'manual',
    snapshot: structuredClone(snapshot),
  }));
  context.flow.getState().replaceGraph({ nodes, edges: [], viewport });
  context.studio.setState(
    context.studio.persist.getOptions().merge(
      {
        workflowTabs: tabs,
        activeWorkflowTabId: tabs.at(-1).id,
        form,
        selectedMode: form.mode,
        graphBinding: null,
        workflowCanvasHydrated: true,
      },
      context.studio.getState(),
    ),
  );
  return workspace(context);
}

function workspace(context) {
  const state = context.studio.getState();
  return structuredClone({
    tabs: state.workflowTabs,
    active: state.activeWorkflowTabId,
    form: state.form,
    flow: context.flow.getState().toObject(),
  });
}

after(async () => {
  await Promise.all(servers.map((server) => server.close()));
  globalThis.fetch = originalFetch;
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  delete globalThis.location;
});

test('another page welcome, output fetch and flow reset cannot replace this page checkpoint on reload', async () => {
  const shared = storage();
  const b = await page(shared);
  const expectedB = seed(b, 'older-B');
  let outputRead;
  const fetchOutputs = b.studio.getState().fetchBackendOutputs;
  b.studio.setState({ fetchBackendOutputs: () => (outputRead = fetchOutputs()) });
  b.nodes.setState({ instance: 'B-worker', fetchRuntimeStatus: async () => {} });
  const a = await page(shared);
  const expectedA = seed(a, 'current-A');
  activate(b);
  b.studio.getState().setLauncherDismissed(false);
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ outputs: [], previewSlots: [], revision: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  b.websocket.handleWebsocketMessage(
    {
      type: 'welcome',
      sid: 'B-session',
      instance: 'B-worker',
      cachedNodes: [],
      current: null,
      queued: {},
      recent: [],
      downloads: [],
    },
    { ws: { url: 'ws://127.0.0.1:5191/ws' }, sid: 'B-session', setSid: () => {} },
  );
  assert.ok(outputRead, 'the real welcome handler must start its actual output-history request');
  await outputRead;
  b.flow.getState().resetExecutionProgress();
  assert.deepEqual(workspace(b), expectedB, 'volatile activity must leave B authored state intact');
  const reloaded = await page(shared, a.window.sessionStorage);
  assert.deepEqual(
    workspace(reloaded),
    expectedA,
    'A must reload its own exact roster, active document, form and canvas',
  );
  assert.deepEqual(workspace(b), expectedB, 'reloading A must leave B intact');
});

test('page recovery prefers current keys, copies exact bytes once and never changes shared recovery bytes', async () => {
  const shared = storage();
  const context = await page(shared);
  const session = storage();
  context.window.sessionStorage = session;
  activate(context);
  for (const [key, alias] of [
    ['modiff.studio', 'studio'],
    ['modiff.flow', 'reactflow'],
  ]) {
    const current = ' { "state": { "from": "current" }, "version": 1 } ';
    const older = '{"state":{"from":"legacy"},"version":0}';
    shared.setItem(key, current);
    shared.setItem(alias, older);
    const checkpoint = context.checkpoints.createPageCheckpointStorage(alias);
    assert.equal(checkpoint.getItem(key), current);
    assert.equal(session.getItem(key), current, 'recovery copies original bytes without JSON rewriting');
    shared.setItem(key, 'newer-other-page-recovery');
    assert.equal(checkpoint.getItem(key), current, 'this page owns its checkpoint after recovery');
    checkpoint.removeItem(key);
    const reloaded = context.checkpoints.createPageCheckpointStorage(alias);
    assert.equal(
      reloaded.getItem(key),
      null,
      'a page-scoped recovery marker prevents stale re-import after clear/reload',
    );
    assert.equal(shared.getItem(key), 'newer-other-page-recovery');
    assert.equal(shared.getItem(alias), older);
  }
});

test('legacy aliases recover without promoting shared keys and a missing workspace is admitted once per page', async () => {
  const shared = storage();
  const context = await page(shared);
  const session = storage();
  context.window.sessionStorage = session;
  activate(context);
  for (const [key, alias] of [
    ['modiff.studio', 'studio'],
    ['modiff.flow', 'reactflow'],
  ]) {
    shared.setItem(alias, `raw-${alias}`);
    const checkpoint = context.checkpoints.createPageCheckpointStorage(alias);
    assert.equal(checkpoint.getItem(key), `raw-${alias}`);
    assert.equal(shared.getItem(key), null);
    assert.equal(shared.getItem(alias), `raw-${alias}`);
  }
  const empty = context.checkpoints.createPageCheckpointStorage('absent-alias');
  assert.equal(empty.getItem('absent-workspace'), null);
  shared.setItem('absent-workspace', 'a later foreign checkpoint');
  assert.equal(context.checkpoints.createPageCheckpointStorage('absent-alias').getItem('absent-workspace'), null);
});

test('an existing page checkpoint is authoritative even when its bytes are malformed', async () => {
  const shared = storage();
  const context = await page(shared);
  const session = storage();
  context.window.sessionStorage = session;
  activate(context);
  session.setItem('modiff.studio', '{incomplete page recovery bytes');
  shared.setItem('modiff.studio', 'an older valid shared checkpoint');
  const checkpoint = context.checkpoints.createPageCheckpointStorage('studio');
  assert.equal(checkpoint.getItem('modiff.studio'), '{incomplete page recovery bytes');
  assert.equal(shared.getItem('modiff.studio'), 'an older valid shared checkpoint');
});

test('page quota failures retain live edits, preserve shared bytes and warn until both workspace keys recover', async () => {
  const shared = storage();
  const session = storage();
  const write = session.setItem;
  session.setItem = () => {
    throw new DOMException('Full', 'QuotaExceededError');
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const context = await page(shared, session);
    const expected = seed(context, 'quota-live');
    assert.deepEqual(workspace(context), expected);
    const warning = context.toasts.getToastItems().find((item) => item.id === 'studio-checkpoint-write-failed');
    assert.equal(warning.persist, true);
    assert.match(warning.message, /Save or export unsaved workflows before refreshing/);
    assert.equal(shared.getItem('modiff.studio'), null);
    assert.equal(shared.getItem('modiff.flow'), null);
    session.setItem = write;
    context.studio.setState({ launcherDismissed: true });
    assert.ok(
      context.toasts.getToastItems().some((item) => item.id === warning.id),
      'Flow failure remains outstanding',
    );
    context.flow.getState().resetExecutionProgress();
    assert.equal(
      context.toasts.getToastItems().some((item) => item.id === warning.id),
      false,
    );
  } finally {
    console.warn = warn;
    session.setItem = write;
  }
});

test('blocked session storage warns without a shared-write fallback and SSR remains unavailable normally', async () => {
  const shared = storage();
  const context = await page(shared);
  const originalWindow = context.window;
  const blocked = { ...originalWindow };
  Object.defineProperty(blocked, 'sessionStorage', {
    get: () => {
      throw new DOMException('Blocked', 'SecurityError');
    },
  });
  globalThis.window = blocked;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const checkpoint = context.checkpoints.createPageCheckpointStorage('studio');
    assert.equal(checkpoint.getItem('modiff.studio'), null);
    assert.doesNotThrow(() => checkpoint.setItem('modiff.studio', 'unsaved in-memory state'));
    assert.doesNotThrow(() => checkpoint.removeItem('modiff.studio'));
    assert.equal(shared.getItem('modiff.studio'), null);
    assert.ok(context.toasts.getToastItems().some((item) => item.persist && /Save or export/.test(item.message)));
    delete globalThis.window;
    assert.throws(() => context.checkpoints.createPageCheckpointStorage('studio'), /outside a browser/);
  } finally {
    globalThis.window = originalWindow;
    console.warn = warn;
  }
});

test('shared Settings retain their global checkpoint while each workspace survives same-page reload', async () => {
  const shared = storage();
  const a = await page(shared);
  const expectedA = seed(a, 'settings-A');
  a.settings.getState().setLeftPanelWidth(444);
  const b = await page(shared);
  seed(b, 'settings-B');
  assert.equal(b.settings.getState().leftPanelWidth, 444);
  b.settings.getState().setLeftPanelWidth(555);
  const reloaded = await page(shared, a.window.sessionStorage);
  assert.equal(reloaded.settings.getState().leftPanelWidth, 555);
  assert.deepEqual(workspace(reloaded), expectedA);
  assert.equal(JSON.parse(shared.getItem('modiff.settings')).state.leftPanelWidth, 555);
  assert.equal(shared.getItem('modiff.studio'), null);
  assert.equal(shared.getItem('modiff.flow'), null);
});

test('page checkpoints retain more than twelve dirty workflows without changing the existing retention policy', async () => {
  const shared = storage();
  const context = await page(shared);
  const expected = seed(context, 'dirty-page', 14);
  assert.equal(JSON.parse(context.window.sessionStorage.getItem('modiff.studio')).state.workflowTabs.length, 14);
  const reloaded = await page(shared, context.window.sessionStorage);
  assert.deepEqual(workspace(reloaded), expected);
});

for (const [label, install] of [
  ['Workflow', installEphemeralWorkflowStorage],
  ['Gallery', installEphemeralGalleryStorage],
]) {
  test(`${label} owned generator startup cannot recover a foreign legacy workspace`, async () => {
    let initialize;
    await install({
      addInitScript: async (script) => {
        initialize = script;
      },
      route: async () => {},
    });
    class MemoryStorage {
      values = new Map();
      getItem(key) {
        return this.values.get(key) ?? null;
      }
      setItem(key, value) {
        this.values.set(key, String(value));
      }
      removeItem(key) {
        this.values.delete(key);
      }
    }
    const shared = new MemoryStorage();
    const session = new MemoryStorage();
    const foreignNode = {
      id: 'foreign-graph',
      type: 'custom',
      position: { x: 1, y: 2 },
      data: {
        type: 'custom',
        label: 'Foreign graph',
        module: 'fixture.Text',
        action: 'Text',
        params: { text: { type: 'string', value: 'foreign authored graph' } },
      },
    };
    const foreignFlow = JSON.stringify({
      version: 1,
      state: { nodes: [foreignNode], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    });
    const foreignStudio = JSON.stringify({
      version: 0,
      state: {
        form: { prompt: 'foreign authored prompt' },
        activeWorkflowTabId: 'foreign-document',
        workflowTabs: [
          {
            id: 'foreign-document',
            title: 'Foreign document',
            createdAt: 1,
            updatedAt: 2,
            dirty: true,
            source: 'manual',
            snapshot: {
              nodes: [foreignNode],
              edges: [],
              studioForm: { prompt: 'foreign authored prompt' },
              studioGraphBinding: null,
            },
          },
        ],
      },
    });
    shared.setItem('studio', foreignStudio);
    shared.setItem('reactflow', foreignFlow);
    const app = await page(shared, session, () =>
      runInNewContext(`(${initialize.toString()})()`, {
        Storage: MemoryStorage,
        localStorage: shared,
        sessionStorage: session,
      }),
    );
    assert.deepEqual(
      app.studio.getState().workflowTabs,
      [],
      'the actual Studio factory must not return retained foreign alias bytes',
    );
    assert.equal(app.studio.getState().activeWorkflowTabId, null);
    assert.deepEqual(
      app.flow.getState().nodes,
      [],
      'the actual Flow factory must not return retained foreign alias bytes',
    );
    assert.equal(shared.getItem('studio'), foreignStudio, 'keep exact legacy recovery bytes');
    assert.equal(shared.getItem('reactflow'), foreignFlow);
    assert.equal(session.getItem('modiff.studio'), null, 'generated workspace remains ephemeral');
    assert.equal(session.getItem('modiff.flow'), null);
  });
}
