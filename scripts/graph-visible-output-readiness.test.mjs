import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

let server, flow, readiness;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    localStorage,
    sessionStorage: localStorage,
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  ({ useFlowStore: flow } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  readiness = await server.ssrLoadModule('/src/studio/runReadiness.ts');
});
after(async () => server?.close());
beforeEach(() => flow.getState().replaceGraph({ nodes: [], edges: [] }));

function graph(display = 'ui_video', source = 'file') {
  return {
    nodes: [
      {
        id: 'frames',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          module: 'modules.Video',
          action: 'Load',
          label: 'Scene',
          type: 'custom',
          params: {
            file: { display: 'filebrowser', type: 'str', value: ['@data/videos/scene.mp4'] },
            video: { display: 'output', type: 'video' },
          },
        },
      },
      {
        id: 'film',
        type: 'custom',
        position: { x: 300, y: 0 },
        data: {
          module: 'modules.Video',
          action: 'ExportWithAudio',
          label: 'Moonflower photographic film',
          category: 'Video',
          type: 'custom',
          params: {
            video: { display: 'input', type: 'video' },
            preview: { display, type: 'url', dataSource: source },
            file: { display: 'output', type: 'video' },
          },
        },
      },
    ],
    edges: [{ id: 'frames-film', source: 'frames', sourceHandle: 'video', target: 'film', targetHandle: 'video' }],
  };
}

function structuralIssues() {
  return readiness
    .collectRunReadinessIssues({ sid: 'unit-session', isConnected: true, includeStudio: false })
    .filter((issue) => ['graph_output_missing', 'graph_output_disconnected'].includes(issue.code));
}

test('a renamed video-with-audio exporter retains its declared visible output', () => {
  const original = graph();
  flow.getState().replaceGraph(original);
  const before = structuredClone(flow.getState().toObject());
  const inspection = readiness.inspectCurrentGraph();
  assert.deepEqual(inspection.connectedOutputNodeIds, ['film']);
  assert.equal(inspection.outputPathCount, 1);
  assert.deepEqual(structuralIssues(), []);
  assert.deepEqual(flow.getState().toObject(), before, 'Readiness must not repair or relabel the saved graph.');
});

test('declared media and text previews do not depend on a node label or action spelling', () => {
  for (const display of ['ui_image', 'ui_video', 'ui_audio', 'ui_text', 'ui_imagecompare']) {
    const current = graph(display);
    current.nodes[1].data.module = 'modules.Utility';
    current.nodes[1].data.action = 'Bake';
    flow.getState().replaceGraph(current);
    assert.deepEqual(readiness.inspectCurrentGraph().connectedOutputNodeIds, ['film'], display);
  }
});

test('an input-backed widget or unknown preview source does not invent an output', () => {
  for (const source of ['video', 'absent', '']) {
    flow.getState().replaceGraph(graph('ui_video', source));
    assert.deepEqual(readiness.inspectCurrentGraph().outputNodeIds, [], source);
    assert.equal(structuralIssues()[0]?.code, 'graph_output_missing');
  }
  flow.getState().replaceGraph(graph('ui_label'));
  assert.deepEqual(readiness.inspectCurrentGraph().outputNodeIds, []);
});

test('disabled and disconnected declared outputs still block Run', () => {
  const disconnected = graph();
  disconnected.edges = [];
  flow.getState().replaceGraph(disconnected);
  assert.equal(structuralIssues()[0]?.code, 'graph_output_disconnected');
  const disabled = graph();
  disabled.nodes[1].data.uiState = { disabled: true };
  flow.getState().replaceGraph(disabled);
  assert.equal(structuralIssues()[0]?.code, 'graph_output_missing');
});
