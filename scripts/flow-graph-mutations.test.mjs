import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let flowStoreModule;
let nodeStoreModule;
let server;
let originalFetch;
let requests;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.window = {
    dispatchEvent: () => true,
    localStorage: globalThis.localStorage,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  nodeStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    return new Response(JSON.stringify({ error: false, nodes: Array.isArray(body.nodes) ? body.nodes : [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  flowStoreModule.useFlowStore.setState({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    lastExecutionTime: 0,
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  nodeStoreModule.useNodesStore.setState({ nodesRegistry: {} });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function node(id, params, extras = {}) {
  return {
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: id,
      label: id,
      category: 'Test',
      params,
      ...extras,
    },
  };
}

function edge(id, source, target, sourceHandle, targetHandle) {
  return { id, source, target, sourceHandle, targetHandle, type: 'default' };
}

function cacheRequests() {
  return requests.filter((request) => request.url.endsWith('/cache') && request.init.method === 'DELETE');
}

test('graph replacement restores missing live UI preview contracts without replacing saved values', () => {
  nodeStoreModule.useNodesStore.setState({
    nodesRegistry: {
      'modules.Test.Preview': {
        type: 'custom',
        module: 'modules.Test',
        action: 'Preview',
        label: 'Preview',
        category: 'Test',
        params: {
          title: {
            display: 'ui_label',
            label: 'Current label',
            value: 'Live fallback',
            fieldOptions: { tone: 'subtle' },
          },
          preview: {
            display: 'ui_video',
            type: 'url',
            dataSource: 'file',
          },
          file: {
            display: 'output',
            type: 'video',
          },
        },
      },
    },
  });

  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      node('Preview', {
        title: {
          display: 'ui_label',
          label: 'Stale label',
          value: 'Saved workflow title',
          fieldOptions: { tone: 'old' },
        },
        file: { display: 'output', type: 'video' },
      }),
    ],
    edges: [],
  });
  let params = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  let preview = params.preview;
  assert.deepEqual(preview, {
    display: 'ui_video',
    type: 'url',
    dataSource: 'file',
  });
  assert.deepEqual(params.title, {
    display: 'ui_label',
    label: 'Current label',
    value: 'Saved workflow title',
    fieldOptions: { tone: 'subtle' },
  });

  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      node('Preview', {
        file: { display: 'output', type: 'video' },
        preview: { value: '/file?file=previous.mp4' },
      }),
    ],
    edges: [],
  });
  params = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  preview = params.preview;
  assert.equal(preview.display, 'ui_video');
  assert.equal(preview.dataSource, 'file');
  assert.equal(preview.value, '/file?file=previous.mp4');
});

test('node deletion cleans edges, spawned inputs, signals, handles, cache, and round-trips through history', () => {
  const source = node(
    'source',
    {
      output: {
        display: 'output',
        isConnected: true,
        signal: { direction: 'output', value: 'propagated' },
        artifacts: [{ url: '/cache/source/output' }],
      },
    },
    {
      isCached: true,
      progress: 67,
      executionStatus: 'running',
      executionTime: { last: 12 },
      memoryUsage: { last: 1024 },
      uiState: { collapsed: true, validationSeverity: 'error', validationMessage: 'old runtime error' },
    },
  );
  const dynamicTarget = node('dynamic-target', {
    'input>>>spawned': {
      display: 'input',
      spawn: true,
      isInput: true,
      isConnected: true,
      signal: { direction: 'input', value: 'propagated' },
    },
  });
  const regularTarget = node('regular-target', {
    input: {
      display: 'input',
      isInput: true,
      isConnected: true,
      signal: { direction: 'input', value: 'propagated' },
    },
  });
  flowStoreModule.useFlowStore.setState({
    nodes: [source, dynamicTarget, regularTarget],
    edges: [
      edge('edge-dynamic', 'source', 'dynamic-target', 'output', 'input>>>spawned'),
      edge('edge-regular', 'source', 'regular-target', 'output', 'input'),
    ],
  });

  flowStoreModule.useFlowStore.getState().removeNodes('source');

  let state = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(
    state.nodes.map((item) => item.id),
    ['dynamic-target', 'regular-target'],
  );
  assert.equal(state.edges.length, 0);
  assert.equal(state.nodes[0].data.params['input>>>spawned'], undefined);
  assert.equal(state.nodes[1].data.params.input.isInput, false);
  assert.equal(state.nodes[1].data.params.input.isConnected, false);
  assert.equal(state.nodes[1].data.params.input.signal.value, undefined);
  assert.equal(state.historyPast.length, 1);
  assert.equal(cacheRequests().length, 1);
  assert.deepEqual(JSON.parse(cacheRequests()[0].init.body), { nodes: ['source'] });
  assert.equal(cacheRequests()[0].init.headers['Content-Type'], 'application/json');

  state.undo();
  state = flowStoreModule.useFlowStore.getState();
  const restoredSource = state.nodes.find((item) => item.id === 'source');
  assert.equal(state.edges.length, 2);
  assert.ok(state.nodes.find((item) => item.id === 'dynamic-target').data.params['input>>>spawned']);
  assert.equal(restoredSource.data.params.output.isConnected, true);
  assert.equal(restoredSource.data.isCached, undefined);
  assert.equal(restoredSource.data.progress, undefined);
  assert.equal(restoredSource.data.executionStatus, undefined);
  assert.equal(restoredSource.data.executionTime, undefined);
  assert.equal(restoredSource.data.memoryUsage, undefined);
  assert.equal(restoredSource.data.uiState.collapsed, true);
  assert.equal(restoredSource.data.uiState.validationMessage, undefined);
  assert.equal(restoredSource.data.params.output.artifacts, undefined);
  assert.equal(restoredSource.data.params.output.signal.value, undefined);
  assert.equal(cacheRequests().length, 1);

  state.redo();
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(
    state.nodes.some((item) => item.id === 'source'),
    false,
  );
  assert.equal(state.edges.length, 0);
  assert.equal(cacheRequests().length, 2);
});

test('terminal cleanup is task-scoped and durable graph snapshots never retain execution state', () => {
  const completedTaskNode = node(
    'completed-task-node',
    {
      output: {
        display: 'output',
        type: 'image',
        artifacts: [{ url: '/cache/completed/output' }],
        signal: { direction: 'output', value: 'runtime-only' },
      },
    },
    {
      progress: -1,
      activeTaskId: 'task-completed',
      attemptIndex: 2,
      executionStatus: 'running',
      executionPhase: 'decoding',
      progressMessage: 'Decoding',
    },
  );
  const newerTaskNode = node(
    'newer-task-node',
    {},
    {
      progress: 35,
      activeTaskId: 'task-newer',
      attemptIndex: 0,
      executionStatus: 'running',
      executionPhase: 'denoising',
      progressMessage: 'Denoising',
    },
  );
  flowStoreModule.useFlowStore.setState({ nodes: [completedTaskNode, newerTaskNode], edges: [] });

  flowStoreModule.useFlowStore.getState().resetExecutionProgress('task-completed');

  const state = flowStoreModule.useFlowStore.getState();
  const cleared = state.nodes.find((item) => item.id === 'completed-task-node');
  const active = state.nodes.find((item) => item.id === 'newer-task-node');
  assert.equal(cleared.data.progress, 0);
  assert.equal(cleared.data.activeTaskId, null);
  assert.equal(cleared.data.attemptIndex, undefined);
  assert.equal(cleared.data.executionStatus, undefined);
  assert.equal(cleared.data.executionPhase, undefined);
  assert.equal(cleared.data.progressMessage, undefined);
  assert.equal(active.data.progress, 35);
  assert.equal(active.data.activeTaskId, 'task-newer');
  assert.equal(active.data.executionStatus, 'running');

  const durable = state.toObject();
  const durableActive = durable.nodes.find((item) => item.id === 'newer-task-node');
  const durableCleared = durable.nodes.find((item) => item.id === 'completed-task-node');
  assert.equal(durableActive.data.progress, undefined);
  assert.equal(durableActive.data.activeTaskId, undefined);
  assert.equal(durableActive.data.attemptIndex, undefined);
  assert.equal(durableActive.data.executionStatus, undefined);
  assert.equal(durableActive.data.executionPhase, undefined);
  assert.equal(durableActive.data.progressMessage, undefined);
  assert.equal(durableCleared.data.params.output.artifacts, undefined);
  assert.equal(durableCleared.data.params.output.signal.value, undefined);

  const persisted = JSON.parse(globalThis.localStorage.getItem('modiff.flow')).state;
  const persistedActive = persisted.nodes.find((item) => item.id === 'newer-task-node');
  assert.equal(persistedActive.data.progress, undefined);
  assert.equal(persistedActive.data.activeTaskId, undefined);
  assert.equal(persistedActive.data.executionStatus, undefined);
});

test('advancing a task retires the previous node progress indicator', () => {
  flowStoreModule.useFlowStore.setState({
    nodes: [node('config', {}), node('loader', {})],
    edges: [],
  });

  const flow = flowStoreModule.useFlowStore.getState();
  flow.updateProgress('config', -1, {
    activeTaskId: 'stale-or-missing-task-identity',
    attemptIndex: 0,
    executionStatus: 'running',
    executionPhase: 'preparing',
    progressMessage: 'Building execution recipe',
    executionProgress: { phase: 'preparing', message: 'Building execution recipe' },
  });
  flow.updateProgress('loader', 23, {
    activeTaskId: 'task-sequential',
    attemptIndex: 0,
    executionStatus: 'running',
    executionPhase: 'loading',
    progressMessage: 'Loading weights 91/398',
    executionProgress: { phase: 'loading', message: 'Loading weights 91/398' },
  });

  const state = flowStoreModule.useFlowStore.getState();
  const config = state.nodes.find((item) => item.id === 'config');
  const loader = state.nodes.find((item) => item.id === 'loader');
  assert.equal(config.data.progress, 0);
  assert.equal(config.data.activeTaskId, null);
  assert.equal(config.data.executionStatus, undefined);
  assert.equal(config.data.executionPhase, undefined);
  assert.equal(config.data.progressMessage, undefined);
  assert.equal(config.data.executionProgress, undefined);
  assert.equal(loader.data.progress, 23);
  assert.equal(loader.data.activeTaskId, 'task-sequential');
  assert.equal(loader.data.executionStatus, 'running');
  assert.equal(loader.data.progressMessage, 'Loading weights 91/398');
});

test('persisted flow hydration versions and filters malformed graph state', async () => {
  const valid = node('persisted-valid', { prompt: { value: 'restored' } });
  globalThis.localStorage.setItem(
    'modiff.flow',
    JSON.stringify({
      version: 1,
      state: {
        nodes: [
          valid,
          { id: 'invalid-node', position: null, data: { params: {} } },
          {
            ...node('invalid-param-node'),
            data: { ...node('invalid-param-node').data, params: { prompt: null } },
          },
        ],
        edges: [
          edge('valid-edge', 'persisted-valid', 'persisted-valid', 'output', 'input'),
          edge('dangling-edge', 'persisted-valid', 'missing-node', 'output', 'input'),
        ],
        viewport: { x: 12, y: Number.NaN, zoom: -4 },
      },
    }),
  );

  await flowStoreModule.useFlowStore.persist.rehydrate();

  const restored = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(
    restored.nodes.map((item) => item.id),
    ['persisted-valid'],
  );
  assert.deepEqual(
    restored.edges.map((item) => item.id),
    ['valid-edge'],
  );
  assert.deepEqual(restored.viewport, { x: 12, y: 0, zoom: 1 });
  assert.equal(restored.historyPast.length, 0);
  assert.equal(restored.historyFuture.length, 0);
});

test('cache status reset is atomic and never publishes an empty graph during reconnect', () => {
  const managedNode = node(
    'managed-generate',
    {},
    {
      studioRole: 'generate',
      progress: 42,
      activeTaskId: 'task-running',
      attemptIndex: 0,
      executionStatus: 'running',
      executionPhase: 'denoising',
      progressMessage: 'Denoising',
    },
  );
  const outputNode = node('managed-output', {}, { studioRole: 'output', isCached: true });
  const connection = edge('managed-edge', managedNode.id, outputNode.id, 'image', 'image');
  const viewport = { x: 21, y: -13, zoom: 0.82 };
  flowStoreModule.useFlowStore.setState({
    nodes: [managedNode, outputNode],
    edges: [connection],
    viewport,
    lastExecutionTime: 1250,
  });

  const publications = [];
  const unsubscribe = flowStoreModule.useFlowStore.subscribe((state) => {
    publications.push({
      nodeIds: state.nodes.map((item) => item.id),
      edgeIds: state.edges.map((item) => item.id),
      viewport: state.viewport,
    });
  });
  flowStoreModule.useFlowStore.getState().resetStatus(['managed-generate']);
  unsubscribe();

  assert.ok(publications.length > 0);
  assert.ok(publications.every((publication) => publication.nodeIds.length === 2));
  assert.ok(publications.every((publication) => publication.edgeIds.length === 1));
  assert.ok(publications.every((publication) => publication.viewport === viewport));

  const state = flowStoreModule.useFlowStore.getState();
  const generate = state.nodes.find((item) => item.id === 'managed-generate');
  const output = state.nodes.find((item) => item.id === 'managed-output');
  assert.equal(generate.data.studioRole, 'generate');
  assert.equal(generate.data.isCached, true);
  assert.equal(generate.data.progress, 0);
  assert.equal(generate.data.activeTaskId, null);
  assert.equal(generate.data.attemptIndex, undefined);
  assert.equal(generate.data.executionStatus, undefined);
  assert.equal(generate.data.executionPhase, undefined);
  assert.equal(generate.data.progressMessage, undefined);
  assert.equal(output.data.studioRole, 'output');
  assert.equal(output.data.isCached, false);
  assert.deepEqual(state.edges, [connection]);
  assert.equal(state.viewport, viewport);
  assert.equal(state.lastExecutionTime, 0);
});

test('React Flow removal deletes group descendants through the same invariant path', () => {
  const group = {
    ...node('group', {}),
    type: 'group',
    data: { ...node('group', {}).data, type: 'group' },
  };
  const child = { ...node('child', {}), parentId: 'group', extent: 'parent' };
  flowStoreModule.useFlowStore.setState({ nodes: [group, child], edges: [] });

  flowStoreModule.useFlowStore.getState().onNodesChange([{ id: 'group', type: 'remove' }]);

  assert.equal(flowStoreModule.useFlowStore.getState().nodes.length, 0);
  assert.deepEqual(JSON.parse(cacheRequests()[0].init.body), { nodes: ['group', 'child'] });
});

test('loop creation keeps selected nodes visible as direct container children and can be reversed', () => {
  const first = { ...node('first', {}), position: { x: 100, y: 120 }, width: 180, height: 100, selected: true };
  const second = { ...node('second', {}), position: { x: 360, y: 180 }, width: 180, height: 100, selected: true };
  flowStoreModule.useFlowStore.setState({ nodes: [first, second], edges: [] });

  flowStoreModule.useFlowStore.getState().loopNodes(['first', 'second']);

  let state = flowStoreModule.useFlowStore.getState();
  const loop = state.nodes.find((item) => item.data.type === 'loop');
  assert.ok(loop);
  assert.equal(state.nodes.find((item) => item.id === 'first').parentId, loop.id);
  assert.equal(state.nodes.find((item) => item.id === 'second').parentId, loop.id);
  assert.equal(loop.data.params.iterations.value, 2);

  state.ungroupNodes(loop.id);
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(
    state.nodes.some((item) => item.id === loop.id),
    false,
  );
  assert.equal(state.nodes.find((item) => item.id === 'first').parentId, undefined);
  assert.deepEqual(state.nodes.find((item) => item.id === 'first').position, { x: 100, y: 120 });
});

test('graph replacement filters dangling edges and reconciles disconnected runtime state', () => {
  const oldNode = node('old', { output: { display: 'output', isConnected: true } });
  flowStoreModule.useFlowStore.setState({ nodes: [oldNode], edges: [] });
  const importedTarget = node('imported-target', {
    input: {
      display: 'input',
      isConnected: true,
      signal: { direction: 'input', value: 'stale' },
    },
  });

  flowStoreModule.useFlowStore.getState().replaceGraph(
    {
      nodes: [importedTarget],
      edges: [edge('dangling', 'missing-source', 'imported-target', 'output', 'input')],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    },
    { historyLabel: 'Import graph', clearRemovedCache: true },
  );

  const state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.edges.length, 0);
  assert.deepEqual(state.viewport, { x: 10, y: 20, zoom: 0.8 });
  assert.equal(state.nodes[0].data.params.input.isConnected, false);
  assert.equal(state.nodes[0].data.params.input.signal.value, undefined);
  assert.equal(state.historyPast.length, 1);
  assert.deepEqual(JSON.parse(cacheRequests()[0].init.body), { nodes: ['old'] });
});

test('dynamic parameter replacement preserves compatible edge identities and removes only invalid handles', () => {
  const source = node('source', {
    keep: { display: 'output', isConnected: true },
    remove: { display: 'output', isConnected: true, signal: { direction: 'output', value: 'stale' } },
  });
  const target = node('target', {
    keep: { display: 'input', isInput: true, isConnected: true },
    remove: {
      display: 'input',
      isInput: true,
      isConnected: true,
      signal: { direction: 'input', value: 'stale' },
    },
  });
  flowStoreModule.useFlowStore.setState({
    nodes: [source, target],
    edges: [
      edge('keep-edge', 'source', 'target', 'keep', 'keep'),
      edge('remove-edge', 'source', 'target', 'remove', 'remove'),
    ],
  });

  flowStoreModule.useFlowStore.getState().replaceNodeParams('target', {
    keep: { display: 'input', isInput: true, isConnected: true },
  });

  const state = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(
    state.edges.map((item) => item.id),
    ['keep-edge'],
  );
  assert.equal(state.nodes.find((item) => item.id === 'source').data.params.remove.isConnected, false);
  assert.equal(state.nodes.find((item) => item.id === 'source').data.params.remove.signal.value, undefined);
  assert.equal(state.nodes.find((item) => item.id === 'target').data.params.remove, undefined);
  assert.equal(state.historyPast.length, 0);
});
