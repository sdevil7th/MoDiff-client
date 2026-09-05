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
