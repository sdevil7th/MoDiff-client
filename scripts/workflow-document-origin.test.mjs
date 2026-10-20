import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server, origin, sync, studio, flow, drops, packages, notifications, defaultForm, originalFetch;
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
  flow = (await server.ssrLoadModule('/src/stores/useFlowStore.ts')).useFlowStore;
  drops = await server.ssrLoadModule('/src/workflow/useWorkflowDrop.ts');
  packages = await server.ssrLoadModule('/src/studio/workflowPackage.ts');
  notifications = await server.ssrLoadModule('/src/ui/snackbar.ts');
  defaultForm = (await server.ssrLoadModule('/src/studio/modelProfiles.ts')).DEFAULT_STUDIO_FORM;
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

for (const scenario of [
  { name: 'bare graph without viewport', format: 'graph', expected: { x: 0, y: 0, zoom: 1 } },
  { name: 'saved snapshot without viewport', format: 'snapshot' },
  { name: 'normal export package without viewport', format: 'package' },
  { name: 'saved snapshot with a valid viewport', format: 'snapshot', viewport: { x: -50, y: 80, zoom: 0.6 } },
  { name: 'saved snapshot with null viewport', format: 'snapshot', viewport: null },
  { name: 'saved snapshot with invalid zoom', format: 'snapshot', viewport: { x: 10, y: 20, zoom: 0 } },
]) {
  test(`workflow import viewport: ${scenario.name} retains the graph and reports success`, async () => {
    const previousFlow = flow.getState();
    const previousReader = globalThis.FileReader;
    const previousFetch = globalThis.fetch;
    const currentViewport = { x: 25, y: -30, zoom: 0.75 };
    const operationAuthoring = {
      schemaVersion: 1,
      operation: { pipelineClass: 'TestPipeline', task: 'edit_image', operationId: 'image.load' },
      authored: ['file'],
    };
    // Import preserves opaque operation provenance; it grants no execution.
    const graph = {
      nodes: [
        {
          id: 'retained-source',
          type: 'custom',
          position: { x: 10, y: 20 },
          data: {
            type: 'custom',
            module: 'modules.Image',
            action: 'Load',
            label: 'Retained source',
            params: {
              file: { type: 'str', display: 'filebrowser', value: ['images/retained.png'] },
              image: { type: 'image', display: 'output' },
            },
            operationAuthoring,
          },
        },
        {
          id: 'retained-preview',
          type: 'custom',
          position: { x: 300, y: 20 },
          data: {
            type: 'custom',
            module: 'modules.Image',
            action: 'Preview',
            label: 'Retained preview',
            params: { image: { type: 'image', display: 'input' } },
          },
        },
      ],
      edges: [
        {
          id: 'retained-wire',
          source: 'retained-source',
          sourceHandle: 'image',
          target: 'retained-preview',
          targetHandle: 'image',
        },
      ],
      ...(Object.hasOwn(scenario, 'viewport') ? { viewport: scenario.viewport } : {}),
    };
    const originalGraph = structuredClone(graph);
    const form = { ...defaultForm, resourceMode: 'expert' };
    const value =
      scenario.format === 'snapshot'
        ? {
            ...graph,
            studioForm: form,
            studioGraphBinding: null,
            selectedMode: form.mode,
            activeTemplateId: null,
            sourceOutputId: null,
          }
        : scenario.format === 'package'
          ? packages.buildWorkflowPackage({ graph, form })
          : graph;
    const requests = [];
    try {
      globalThis.fetch = async (...args) => {
        requests.push(args);
        throw new Error('Import must not dispatch.');
      };
      flow.setState({ nodes: [], edges: [], viewport: { ...currentViewport } });
      const previousViewport = flow.getState().viewport;
      for (const toast of notifications.getToastItems()) notifications.closeSnackbar(toast.id);
      let handleDrop;
      function ImportProbe() {
        ({ handleDrop } = drops.useWorkflowDrop({
          addNode: () => assert.fail('A workflow import must not insert an unrelated node.'),
          createWorkflowTab: studio.getState().createWorkflowTab,
          edgeType: 'default',
          nodesRegistry: {},
          screenToFlowPosition: (position) => position,
        }));
        return null;
      }
      renderToStaticMarkup(React.createElement(ImportProbe));
      globalThis.FileReader = class {
        readAsText() {
          this.onload({ target: { result: JSON.stringify(value) } });
        }
      };
      const before = studio.getState().workflowTabs.length;
      await handleDrop({
        preventDefault() {},
        dataTransfer: { files: { length: 1, item: () => ({ name: 'Imported.json', type: 'application/json' }) } },
      });
      assert.equal(studio.getState().workflowTabs.length, before + 1);
      assert.deepEqual(
        notifications.getToastItems().map(({ message, variant }) => ({ message, variant })),
        [{ message: 'Workflow opened as a new tab', variant: 'success' }],
      );
      assert.deepEqual(
        flow.getState().nodes.map((node) => node.id),
        graph.nodes.map((node) => node.id),
      );
      assert.deepEqual(flow.getState().nodes[0].data.operationAuthoring, operationAuthoring);
      assert.deepEqual(flow.getState().nodes[0].data.params.file.value, ['images/retained.png']);
      assert.deepEqual(
        flow.getState().edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({
          id,
          source,
          sourceHandle,
          target,
          targetHandle,
        })),
        graph.edges,
      );
      assert.deepEqual(
        flow.getState().viewport,
        scenario.expected ?? (scenario.viewport?.zoom > 0 ? scenario.viewport : currentViewport),
      );
      assert.notEqual(flow.getState().viewport, previousViewport);
      assert.deepEqual(graph, originalGraph);
      assert.deepEqual(requests, []);
    } finally {
      flow.setState(previousFlow);
      globalThis.FileReader = previousReader;
      globalThis.fetch = previousFetch;
    }
  });
}
