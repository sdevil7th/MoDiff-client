import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let nodesStoreModule;
let requestModule;
let server;
let originalFetch;

function requestStates() {
  return Object.fromEntries(
    ['capabilities', 'customModules', 'hfCache', 'localModels', 'modelCache', 'nodes', 'runtime'].map((key) => [
      key,
      { status: 'idle', error: null, requestId: null },
    ]),
  );
}

before(async () => {
  globalThis.window = {
    dispatchEvent: () => true,
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
  requestModule = await server.ssrLoadModule('/src/utils/requestJson.ts');
  nodesStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  nodesStoreModule.useNodesStore.setState({
    nodesRegistry: {},
    isLoading: false,
    instance: '',
    error: null,
    hfCache: [],
    localModels: [],
    modelCacheDiagnostics: null,
    studioModelCapabilities: [],
    runtimeStatus: null,
    runtimeError: null,
    hfDownloadProgress: {},
    customModules: [],
    customModuleError: null,
    discoveryRequests: requestStates(),
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

function customModule(name, enabled = true) {
  return {
    name,
    moduleKey: `custom.${name}`,
    source: 'custom',
    enabled,
    status: enabled ? 'enabled' : 'disabled',
    path: `C:/custom/${name}`,
    hasInit: true,
    hasMain: false,
    nodeCount: 0,
    nodes: [],
    hasGit: true,
    canUpdate: true,
    canDisable: enabled,
    canEnable: !enabled,
  };
}

test('requestJson normalizes non-OK JSON responses', async () => {
  globalThis.fetch = async () => jsonResponse({ error: true, message: 'Backend unavailable' }, 503);

  await assert.rejects(requestModule.requestJson('/status'), (error) => {
    assert.equal(error.name, 'RequestError');
    assert.equal(error.kind, 'http');
    assert.equal(error.status, 503);
    assert.equal(error.message, 'Backend unavailable');
    return true;
  });
});

test('requestJson distinguishes invalid JSON and invalid payloads', async () => {
  globalThis.fetch = async () => new Response('<html>broken</html>', { status: 200 });
  await assert.rejects(requestModule.requestJson('/broken-json'), (error) => error.kind === 'invalid_json');

  globalThis.fetch = async () => jsonResponse({ value: 1 });
  await assert.rejects(
    requestModule.requestJson('/broken-payload', {
      parse: () => {
        throw new Error('Expected a typed list.');
      },
    }),
    (error) => error.kind === 'invalid_payload' && error.message === 'Expected a typed list.',
  );
});

test('requestJson aborts requests at the configured timeout', async () => {
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });

  await assert.rejects(requestModule.requestJson('/slow', { timeoutMs: 10 }), (error) => {
    assert.equal(error.kind, 'timeout');
    assert.match(error.message, /10ms/);
    return true;
  });
});

test('latest endpoint request wins even when an aborted mock resolves late', async () => {
  const calls = [];
  globalThis.fetch = () => {
    const call = deferred();
    calls.push(call);
    return call.promise;
  };

  const first = nodesStoreModule.useNodesStore.getState().fetchHfCache(false);
  const second = nodesStoreModule.useNodesStore.getState().fetchHfCache(true);
  calls[1].resolve(jsonResponse([{ repo_id: 'new/repo' }]));
  await second;
  calls[0].resolve(jsonResponse([{ repo_id: 'stale/repo' }]));
  await first;

  const state = nodesStoreModule.useNodesStore.getState();
  assert.deepEqual(state.hfCache, [{ repo_id: 'new/repo' }]);
  assert.equal(state.discoveryRequests.hfCache.status, 'success');
  assert.equal(state.isLoading, false);
});

test('parallel discovery keeps loading active until every endpoint settles', async () => {
  const calls = new Map();
  globalThis.fetch = (url) => {
    const call = deferred();
    calls.set(String(url).includes('runtime/status') ? 'runtime' : 'localModels', call);
    return call.promise;
  };

  const runtime = nodesStoreModule.useNodesStore.getState().fetchRuntimeStatus();
  const localModels = nodesStoreModule.useNodesStore.getState().fetchLocalModels();
  calls.get('runtime').resolve(jsonResponse({ ready: true, packages: {} }));
  await runtime;
  assert.equal(nodesStoreModule.useNodesStore.getState().isLoading, true);
  calls.get('localModels').resolve(jsonResponse([{ name: 'local-model' }]));
  await localModels;
  assert.equal(nodesStoreModule.useNodesStore.getState().isLoading, false);
});

test('one discovery failure does not suppress successful sibling endpoints', async () => {
  globalThis.fetch = async (url) =>
    String(url).includes('hf_cache')
      ? jsonResponse({ message: 'Cache scan failed' }, 500)
      : jsonResponse([{ name: 'local-model' }]);

  await Promise.all([
    nodesStoreModule.useNodesStore.getState().fetchHfCache(),
    nodesStoreModule.useNodesStore.getState().fetchLocalModels(),
  ]);

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.hfCache.status, 'error');
  assert.equal(state.discoveryRequests.hfCache.error, 'Cache scan failed');
  assert.equal(state.discoveryRequests.localModels.status, 'success');
  assert.deepEqual(state.localModels, [{ name: 'local-model' }]);
  assert.equal(state.error, null);
});

test('invalid node registry responses report an error and a later retry recovers', async () => {
  globalThis.fetch = async () => jsonResponse({ instance: 'broken', nodes: [] });
  await nodesStoreModule.useNodesStore.getState().fetchNodes();
  assert.equal(nodesStoreModule.useNodesStore.getState().discoveryRequests.nodes.status, 'error');
  assert.match(nodesStoreModule.useNodesStore.getState().error, /nodes object/);

  globalThis.fetch = async () =>
    jsonResponse({
      instance: 'recovered',
      nodes: {
        'modules.Test.Generate': {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          label: 'Generate',
          category: 'Test',
          params: {},
        },
      },
    });
  await nodesStoreModule.useNodesStore.getState().fetchNodes();

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.nodes.status, 'success');
  assert.equal(state.error, null);
  assert.equal(state.instance, 'recovered');
  assert.ok(state.nodesRegistry['modules.Test.Generate']);
});

test('custom-module discovery validates entries and recovers without sticky global errors', async () => {
  globalThis.fetch = async () => jsonResponse({ modules: [{ name: 'missing-module-key' }] });
  await nodesStoreModule.useNodesStore.getState().fetchCustomModules();
  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.customModules.status, 'error');
  assert.match(state.customModuleError, /entry 1 is invalid/);
  assert.equal(state.error, null);

  globalThis.fetch = async () => jsonResponse({ modules: [customModule('recovered')] });
  await nodesStoreModule.useNodesStore.getState().fetchCustomModules();
  state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.customModules.status, 'success');
  assert.equal(state.customModuleError, null);
  assert.equal(state.customModules[0].name, 'recovered');
});

test('custom-module mutations use normalized errors and never erase the last valid list on failure', async () => {
  const retained = customModule('retained');
  nodesStoreModule.useNodesStore.setState({ customModules: [retained] });
  globalThis.fetch = async () => jsonResponse({ error: true, message: 'Source is not trusted.' }, 403);

  await assert.rejects(
    nodesStoreModule.useNodesStore.getState().installCustomModule('https://example.invalid/module.git'),
    (error) => error.kind === 'http' && error.status === 403 && error.message === 'Source is not trusted.',
  );

  const state = nodesStoreModule.useNodesStore.getState();
  assert.deepEqual(state.customModules, [retained]);
  assert.equal(state.customModuleError, 'Source is not trusted.');
});

test('successful custom-module mutations validate the payload and refresh the node registry', async () => {
  const installed = customModule('installed');
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/custom_modules/install')) {
      return jsonResponse({ error: false, modules: [installed], instance: 'modules-v2' });
    }
    return jsonResponse({ nodes: {}, instance: 'nodes-v2' });
  };

  await nodesStoreModule.useNodesStore
    .getState()
    .installCustomModule('https://example.invalid/installed.git', 'installed');

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    source: 'https://example.invalid/installed.git',
    name: 'installed',
  });
  assert.match(calls[1].url, /\/nodes$/);
  assert.equal(state.customModules[0].name, 'installed');
  assert.equal(state.instance, 'nodes-v2');
  assert.equal(state.customModuleError, null);
});

test('model-install failures use the typed HTTP contract and update progress once', async () => {
  globalThis.fetch = async () => jsonResponse({ error: 'Access denied for gated/model.' }, 403);

  await assert.rejects(nodesStoreModule.useNodesStore.getState().installHfModel('gated/model'), (error) => {
    assert.equal(error.kind, 'http');
    assert.equal(error.status, 403);
    assert.equal(error.message, 'Access denied for gated/model.');
    return true;
  });

  const progress = nodesStoreModule.useNodesStore.getState().hfDownloadProgress['gated/model'];
  assert.equal(progress.status, 'error');
  assert.equal(progress.error, 'Access denied for gated/model.');
});
