import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let flowStoreModule;
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
