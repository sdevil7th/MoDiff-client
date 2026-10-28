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

function ordinaryImageSnapshot(module, action, resourceMode) {
  const node = (id, module, action, params) => ({
    id,
    type: 'custom',
    position: { x: 40, y: 80 },
    data: { type: 'custom', module, action, label: action, params },
  });
  const studioForm = { ...defaultForm, resourceMode, prompt: 'Saved form summary' };
  if (resourceMode === undefined) delete studioForm.resourceMode;
  return {
    nodes: [
      node('source', 'modules.Image', 'Load', { image: { type: 'image', display: 'output', isConnected: true } }),
      node('operation', module, action, {
        operation: { type: 'string', value: 'image_upscale' },
        images: { type: 'image', display: 'input', isConnected: true },
        output: { type: 'image', display: 'output', isConnected: false },
      }),
      node('model', 'modules.ModularDiffusers', 'ModelsLoader', {
        model_type: { type: 'string', value: 'SyntheticPipeline' },
        dtype: { type: 'string', value: 'bfloat16' },
        device: { type: 'string', value: 'cpu' },
        offload_mode: { type: 'string', value: 'none' },
        auto_offload: { type: 'boolean', value: false },
      }),
      node('prompt', 'modules.ModularDiffusers', 'EncodePrompt', {
        prompt: { type: 'string', value: 'Current graph caption' },
      }),
    ],
    edges: [
      { id: 'source-wire', source: 'source', sourceHandle: 'image', target: 'operation', targetHandle: 'images' },
    ],
    viewport: { x: -20, y: 30, zoom: 0.75 },
    studioForm,
    selectedMode: studioForm.mode,
    studioGraphBinding: null,
    activeTemplateId: null,
    sourceOutputId: null,
  };
}

test('ordinary image document normalization preserves memory policy through import, switching and hydration', async (t) => {
  const previousFlow = flow.getState();
  const previousStudio = studio.getState();
  const previousFetch = globalThis.fetch;
  const wire = (edge) => [edge.id, edge.source, edge.sourceHandle, edge.target, edge.targetHandle];
  try {
    globalThis.fetch = async () => assert.fail('Document normalization must not dispatch a request.');
    for (const [module, action] of [
      ['modules.ImageOperations', 'ProcessImage'],
      ['modules.DiffusersImage', 'LoadPipeline'],
      ['modules.Spandrel', 'Upscaler'],
    ]) {
      for (const [label, value, expected] of [
        ['Custom', 'expert', 'expert'],
        ['Automatic', 'auto', 'auto'],
        ['legacy manual', 'manual', 'expert'],
        ['absent', undefined, 'auto'],
        ['invalid', 'unrecognized-policy', 'auto'],
      ]) {
        await t.test(`${action}: ${label}`, () => {
          studio.setState({ workflowTabs: [], activeWorkflowTabId: null });
          const snapshot = ordinaryImageSnapshot(module, action, value);
          const original = structuredClone(snapshot);
          const id = studio.getState().createWorkflowTab('Saved image graph', snapshot, 'import');
          const assertDocument = (expectedPrompt = 'Current graph caption') => {
            const saved = tab(id).snapshot;
            assert.equal(saved.studioForm.resourceMode, expected);
            assert.equal(studio.getState().form.resourceMode, expected);
            assert.equal(
              saved.studioForm.prompt,
              expectedPrompt,
              'Explicit import infers a summary; passive hydration retains the saved form.',
            );
            assert.equal(saved.studioGraphBinding, null);
            assert.deepEqual(
              saved.nodes.map(({ id, data }) => [id, data.params]),
              snapshot.nodes.map(({ id, data }) => [id, data.params]),
            );
            assert.deepEqual(saved.edges.map(wire), snapshot.edges.map(wire));
            assert.deepEqual(saved.viewport, snapshot.viewport);
          };
          assertDocument();
          studio.getState().createWorkflowTab('Another document');
          studio.getState().switchWorkflowTab(id);
          assertDocument();
          studio.setState({ workflowTabs: [], activeWorkflowTabId: id });
          studio.getState().mergeBackendWorkflow({
            id,
            title: 'Saved image graph',
            source: 'import',
            createdAt: 1,
            updatedAt: 2,
            revision: 1,
            snapshot,
          });
          assertDocument('Saved form summary');
          assert.deepEqual(snapshot, original, 'Normalization cannot mutate the input document.');
        });
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
    flow.setState(previousFlow);
    studio.setState(previousStudio);
  }
});

test('fresh ordinary graph inference still defaults to Automatic without a saved memory choice', async () => {
  const inference = await server.ssrLoadModule('/src/studio/workflowInference.ts');
  const snapshot = ordinaryImageSnapshot('modules.ImageOperations', 'ProcessImage', 'expert');
  assert.equal(inference.inferStudioFormFromWorkflow(snapshot.nodes, snapshot.studioForm).resourceMode, 'auto');
});

test('passive ordinary image restore preserves the complete saved form and does not autosave an inferred summary', async (t) => {
  const previousFlow = flow.getState();
  const previousStudio = studio.getState();
  const previousFetch = globalThis.fetch;
  try {
    for (const [module, action] of [
      ['modules.ImageOperations', 'ProcessImage'],
      ['modules.DiffusersImage', 'LoadPipeline'],
      ['modules.Spandrel', 'Upscaler'],
      ['modules.HuggingFaceTransformers', 'LoadDepthEstimationModel'],
      ['modules.HuggingFaceTransformers', 'LoadImageTextToTextModel'],
    ]) {
      for (const transition of ['switch', 'close', 'backend hydration', 'reload']) {
        await t.test(`${action}: ${transition}`, async () => {
          studio.setState({ workflowTabs: [], activeWorkflowTabId: null });
          const snapshot = ordinaryImageSnapshot(module, action, 'expert');
          snapshot.nodes[1].data.params.operation.value = 'image_stitch';
          snapshot.nodes[1].data.retainedAuthoring = { version: 3, labels: ['keep', 'unchanged'] };
          const id = studio.getState().createWorkflowTab('Retained ordinary document', snapshot, 'import');
          // Author after explicit import so the retained form deliberately differs
          // from the existing graph-derived summary, as in the Linux reproduction.
          studio.getState().updateForm({
            ...defaultForm,
            resourceMode: 'expert',
            prompt: 'Keep this authored form summary',
            negativePrompt: 'Retained negative caption',
            dtype: 'float16',
            device: 'cuda:0',
            autoOffload: true,
            offloadMode: 'group_disk',
            steps: 17,
            guidanceScale: 6.25,
            seed: 123,
            randomSeed: false,
            width: 768,
            height: 512,
            aspectRatio: 'custom',
            referenceImages: ['images/retained-reference.png'],
          });
          studio.getState().saveActiveWorkflowTab(true);
          const original = structuredClone({ ...tab(id), dirty: false, intent: 'saved', backendRevision: 2 });
          studio.setState({ workflowTabs: [structuredClone(original)] });
          sync.markBackendWorkflow(original);
          const requests = [];
          globalThis.fetch = async (url, options) => {
            requests.push([String(url), options?.method ?? 'GET']);
            return response(record(tab(id)));
          };

          if (transition === 'switch' || transition === 'close') {
            const otherId = studio.getState().createWorkflowTab('Another document');
            const other = structuredClone(tab(otherId));
            if (transition === 'switch') studio.getState().switchWorkflowTab(id);
            else studio.getState().closeWorkflowTab(otherId);
            if (transition === 'switch') assert.deepEqual(tab(otherId), other, 'Unrelated tab remains exact.');
          } else if (transition === 'backend hydration') {
            studio.setState({ workflowTabs: [], activeWorkflowTabId: id });
            studio.getState().mergeBackendWorkflow({ ...original, revision: 2 });
          } else {
            const persisted = studio.persist.getOptions().partialize(studio.getState());
            storage.setItem('modiff.studio', JSON.stringify({ state: persisted, version: 0 }));
            await studio.persist.rehydrate();
          }

          assert.deepEqual(studio.getState().form, original.snapshot.studioForm);
          assert.equal(studio.getState().selectedMode, original.snapshot.selectedMode);
          studio.getState().saveActiveWorkflowTab(true);
          assert.deepEqual(tab(id).snapshot, original.snapshot, 'Passive checkpoint retains the complete snapshot.');
          assert.equal(tab(id).dirty, false, 'Passive restore is not an authored edit.');
          sync.queueWorkflowPut(tab(id), (error) => assert.fail(String(error)));
          await new Promise(setImmediate);
          assert.deepEqual(requests, [], 'The autosave chain must not PUT a replacement summary.');
        });
      }
    }
  } finally {
    globalThis.fetch = previousFetch;
    flow.setState(previousFlow);
    studio.setState(previousStudio);
  }
});

test('saved ordinary image copies and output restores preserve their authored form', async (t) => {
  const previousFlow = flow.getState();
  const previousStudio = studio.getState();
  try {
    for (const [module, action] of [
      ['modules.ImageOperations', 'ProcessImage'],
      ['modules.DiffusersImage', 'LoadPipeline'],
      ['modules.Spandrel', 'Upscaler'],
    ]) {
      for (const source of ['manual', 'gallery']) {
        await t.test(`${action}: ${source}`, () => {
          studio.setState({ workflowTabs: [], activeWorkflowTabId: null });
          const snapshot = ordinaryImageSnapshot(module, action, 'expert');
          snapshot.studioForm = {
            ...snapshot.studioForm,
            prompt: 'Keep the saved copy caption',
            seed: 123,
            randomSeed: false,
            width: 768,
            height: 512,
            aspectRatio: 'custom',
          };
          const original = structuredClone(snapshot);
          if (source === 'manual') {
            // Both Save As and My workflows Duplicate pass this explicit source.
            studio.getState().createWorkflowTab('Saved workflow copy', snapshot, 'manual');
          } else {
            studio.getState().restoreWorkflowFromOutput({
              id: 'retained-output',
              prompt: snapshot.studioForm.prompt,
              formSnapshot: snapshot.studioForm,
              graphSnapshot: snapshot,
            });
          }
          const restored = tab(studio.getState().activeWorkflowTabId).snapshot;
          assert.deepEqual(restored.studioForm, original.studioForm);
          assert.equal(restored.selectedMode, original.studioForm.mode);
          assert.deepEqual(restored.nodes, original.nodes);
          assert.deepEqual(restored.edges, original.edges);
          assert.deepEqual(snapshot, original, 'Copy and restore cannot mutate their source snapshot.');
        });
      }
    }
  } finally {
    flow.setState(previousFlow);
    studio.setState(previousStudio);
  }
});

test('legacy ordinary output restores still infer a missing or unrecognized original form', async (t) => {
  const previousFlow = flow.getState();
  const previousStudio = studio.getState();
  try {
    for (const [module, action] of [
      ['modules.ImageOperations', 'ProcessImage'],
      ['modules.DiffusersImage', 'LoadPipeline'],
      ['modules.Spandrel', 'Upscaler'],
    ]) {
      for (const formSnapshot of [undefined, { mode: 'unknown-mode', modelType: 'unknown-model' }]) {
        await t.test(`${action}: ${formSnapshot ? 'unrecognized' : 'missing'}`, () => {
          studio.setState({ workflowTabs: [], activeWorkflowTabId: null });
          const graphSnapshot = ordinaryImageSnapshot(module, action, 'expert');
          studio.getState().restoreWorkflowFromOutput({
            id: 'legacy-output',
            prompt: '',
            formSnapshot,
            graphSnapshot,
          });
          const form = studio.getState().form;
          assert.equal(form.prompt, 'Current graph caption');
          assert.equal(tab(studio.getState().activeWorkflowTabId).source, 'gallery');
        });
      }
    }
  } finally {
    flow.setState(previousFlow);
    studio.setState(previousStudio);
  }
});

test('legacy ordinary snapshots without a recognized form still infer their graph summary', async (t) => {
  const previousFlow = flow.getState();
  const previousStudio = studio.getState();
  try {
    for (const supplied of [undefined, { mode: 'unknown-mode', modelType: 'unknown-model' }]) {
      await t.test(supplied ? 'unrecognized legacy form' : 'bare graph', () => {
        const snapshot = ordinaryImageSnapshot('modules.ImageOperations', 'ProcessImage', 'expert');
        if (supplied) snapshot.studioForm = supplied;
        else delete snapshot.studioForm;
        delete snapshot.selectedMode;
        studio.setState({ workflowTabs: [], activeWorkflowTabId: 'legacy-image' });
        studio.getState().mergeBackendWorkflow({
          id: 'legacy-image',
          title: 'Legacy image graph',
          source: 'import',
          createdAt: 1,
          updatedAt: 2,
          revision: 1,
          snapshot,
        });
        assert.equal(studio.getState().form.modelType, 'BuiltinImageOperation');
        assert.equal(studio.getState().form.mode, 'image_upscale');
        assert.equal(studio.getState().form.prompt, 'Current graph caption');
        assert.equal(studio.getState().graphBinding, null);
      });
    }
  } finally {
    flow.setState(previousFlow);
    studio.setState(previousStudio);
  }
});

test('restored selectedMode remains the existing mirror of its saved form mode', () => {
  const previousFlow = flow.getState();
  const previousStudio = studio.getState();
  try {
    const id = studio
      .getState()
      .createWorkflowTab(
        'Legacy mode mirror',
        ordinaryImageSnapshot('modules.ImageOperations', 'ProcessImage', 'expert'),
        'import',
      );
    const original = structuredClone(tab(id));
    original.snapshot.selectedMode = 'text_to_image';
    assert.notEqual(original.snapshot.selectedMode, original.snapshot.studioForm.mode);
    studio.setState({ workflowTabs: [], activeWorkflowTabId: id });
    studio.getState().mergeBackendWorkflow({ ...original, revision: 2 });
    assert.deepEqual(tab(id).snapshot.studioForm, original.snapshot.studioForm);
    assert.equal(studio.getState().selectedMode, original.snapshot.studioForm.mode);
    assert.equal(tab(id).snapshot.selectedMode, original.snapshot.studioForm.mode);
  } finally {
    flow.setState(previousFlow);
    studio.setState(previousStudio);
  }
});

test('explicit ordinary model, task and form edits still persist through the autosave chain', async () => {
  const previousFlow = flow.getState();
  const previousStudio = studio.getState();
  const previousFetch = globalThis.fetch;
  try {
    const id = studio
      .getState()
      .createWorkflowTab(
        'Editable ordinary document',
        ordinaryImageSnapshot('modules.ImageOperations', 'ProcessImage', 'expert'),
        'import',
      );
    studio.getState().saveActiveWorkflowTab(false);
    sync.markBackendWorkflow(tab(id));
    const originalGraph = structuredClone({ nodes: tab(id).snapshot.nodes, edges: tab(id).snapshot.edges });
    const requests = [];
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return response({ ...record(tab(id)), revision: 2 });
    };
    studio.getState().updateForm({
      modelType: 'BuiltinImageOperation',
      mode: 'image_stitch',
      prompt: 'An intentional new caption',
      seed: 987,
      steps: 23,
    });
    studio.getState().saveActiveWorkflowTab(true);
    const authoredForm = structuredClone(studio.getState().form);
    sync.queueWorkflowPut(tab(id), (error) => assert.fail(String(error)));
    await new Promise(setImmediate);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].snapshot.studioForm, authoredForm);
    assert.equal(requests[0].snapshot.studioForm.mode, 'image_stitch');
    assert.equal(requests[0].snapshot.selectedMode, 'image_stitch');
    assert.deepEqual({ nodes: tab(id).snapshot.nodes, edges: tab(id).snapshot.edges }, originalGraph);
    assert.equal(tab(id).dirty, false);
  } finally {
    globalThis.fetch = previousFetch;
    flow.setState(previousFlow);
    studio.setState(previousStudio);
  }
});

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
    const previousStudio = studio.getState();
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
              device: { type: 'string', value: 'cpu:0', default: 'cpu' },
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
            params: {
              image: { type: 'image', display: 'input' },
              device: { type: 'string', value: 'cpu:0', default: 'cpu' },
            },
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
      studio.setState({ form: { ...studio.getState().form, device: 'cuda:0' } });
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
      for (const node of flow.getState().nodes) {
        assert.deepEqual(node.data.params.device, graph.nodes.find(({ id }) => id === node.id).data.params.device);
      }
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
      studio.setState(previousStudio);
      globalThis.FileReader = previousReader;
      globalThis.fetch = previousFetch;
    }
  });
}
