import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let nodesStoreModule;
let requestModule;
let server;
let studioStoreModule;
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
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
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
  studioStoreModule.useStudioStore.setState({
    autoResourcePlan: null,
    autoResourcePlans: {},
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

test('concurrent node-registry consumers share and await the startup request', async () => {
  const registryRequest = deferred();
  let requestCount = 0;
  globalThis.fetch = () => {
    requestCount += 1;
    return registryRequest.promise;
  };

  const startupRequest = nodesStoreModule.useNodesStore.getState().fetchNodes();
  const graphBuilderRequest = nodesStoreModule.useNodesStore.getState().fetchNodes();
  assert.equal(requestCount, 1);

  registryRequest.resolve(
    jsonResponse({
      instance: 'startup-instance',
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
    }),
  );
  await Promise.all([startupRequest, graphBuilderRequest]);

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.nodes.status, 'success');
  assert.equal(state.instance, 'startup-instance');
  assert.ok(state.nodesRegistry['modules.Test.Generate']);
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

test('runtime discovery normalizes legacy and managed runtime payloads', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      ready: true,
      packages: {
        torch: {
          version: '2.test',
          cuda_available: true,
          cuda_device_name: 'Legacy CUDA',
          cuda_device_total_memory: 16 * 1024 ** 3,
          cuda_memory_free_bytes: 12 * 1024 ** 3,
        },
      },
    });
  await nodesStoreModule.useNodesStore.getState().fetchRuntimeStatus();

  let status = nodesStoreModule.useNodesStore.getState().runtimeStatus;
  assert.equal(status.ready, true);
  assert.equal(status.runtimeEnvironment.profileVerified, false);
  assert.equal(status.runtimeEnvironment.executionReady, true);
  assert.equal(status.runtimeEnvironment.defaultDevice, 'cuda:0');
  assert.deepEqual(
    status.runtimeEnvironment.devices.map(({ backend, device }) => ({ backend, device })),
    [
      { backend: 'cuda', device: 'cuda:0' },
      { backend: 'cpu', device: 'cpu:0' },
    ],
  );

  globalThis.fetch = async () =>
    jsonResponse({
      ready: true,
      packages: { torch: { version: '2.9.1+rocm7.2', cuda_available: true } },
      hardware: {
        schema_version: 1,
        default_device: 'cuda:0',
        devices: [
          {
            type: 'cuda',
            device: 'cuda:0',
            name: 'AMD Radeon',
            vram_total: 16 * 1024 ** 3,
            vram_free: 10 * 1024 ** 3,
          },
          { type: 'cpu', device: 'cpu:0', name: 'CPU' },
        ],
      },
      runtime_profile: {
        requested: 'amd-rocm-linux',
        installed: 'amd-rocm-linux',
        status: 'setup-required',
        execution_ready: false,
        support_tier: 'experimental',
        repair_command: 'python -m modiff.install --accelerator amd --repair',
        issues: [null, { message: 42 }, { code: 'reboot-required', severity: 'warning', message: 'Restart the host.' }],
        installation: {
          status: 'blocked',
          current_phase: 'system-preparation',
          completed_phases: ['detect', 42],
          reboot_required: true,
          resume_command: './install.sh --resume',
          steps: [
            'invalid',
            {
              id: 'gpu-groups',
              title: 'Add GPU groups',
              phase: 'system-preparation',
              status: 'pending',
              requires_admin: true,
              requires_reboot: true,
              command: 'sudo usermod -a -G video,render "$USER"',
            },
          ],
        },
      },
    });
  await nodesStoreModule.useNodesStore.getState().fetchRuntimeStatus();

  status = nodesStoreModule.useNodesStore.getState().runtimeStatus;
  const environment = status.runtimeEnvironment;
  assert.equal(environment.profileVerified, true);
  assert.equal(environment.executionReady, false);
  assert.equal(environment.supportTier, 'experimental');
  assert.equal(environment.devices[0].backend, 'rocm');
  assert.equal(environment.devices[0].vendor, 'amd');
  assert.equal(environment.devices[0].memoryTotal, 16 * 1024 ** 3);
  assert.deepEqual(environment.issues, [
    { code: 'reboot-required', severity: 'warning', message: 'Restart the host.' },
  ]);
  assert.equal(environment.installation.status, 'blocked');
  assert.deepEqual(environment.installation.completedPhases, ['detect']);
  assert.equal(environment.installation.steps.length, 1);
  assert.equal(environment.installation.steps[0].requiresAdmin, true);
  assert.equal(environment.installation.resumeCommand, './install.sh --resume');
});

test('runtime fingerprint changes invalidate every cached Auto plan', async () => {
  const cachedPlan = { status: 'ready', checkedAt: 1 };
  studioStoreModule.useStudioStore.setState({
    autoResourcePlan: cachedPlan,
    autoResourcePlans: { cached: cachedPlan },
  });
  nodesStoreModule.useNodesStore.setState({
    runtimeStatus: {
      ready: true,
      runtime_fingerprint: 'sha256:before',
      runtimeEnvironment: {
        schemaVersion: 1,
        profileVerified: false,
        executionReady: true,
        requestedProfile: null,
        installedProfile: null,
        status: 'unverified',
        supportTier: 'unverified',
        repairCommand: null,
        issues: [],
        installation: null,
        defaultDevice: 'cpu:0',
        devices: [],
      },
    },
  });
  globalThis.fetch = async () =>
    jsonResponse({
      ready: true,
      runtime_fingerprint: 'sha256:after',
      packages: {},
    });

  await nodesStoreModule.useNodesStore.getState().fetchRuntimeStatus();

  assert.equal(studioStoreModule.useStudioStore.getState().autoResourcePlan, null);
  assert.deepEqual(studioStoreModule.useStudioStore.getState().autoResourcePlans, {});
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
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return jsonResponse(
      { error: 'Access denied for gated/model.', code: 'huggingface_access_required', repo_id: 'gated/model' },
      403,
    );
  };

  await assert.rejects(
    nodesStoreModule.useNodesStore
      .getState()
      .installHfModel('gated/model', null, { files: ['weights/model.safetensors'] }),
    (error) => {
      assert.equal(error.kind, 'http');
      assert.equal(error.status, 403);
      assert.equal(error.message, 'Access denied for gated/model.');
      return true;
    },
  );

  assert.match(request.url, /\/hf_download$/);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.init.body), {
    repo_id: 'gated/model',
    files: ['weights/model.safetensors'],
  });

  const progress = nodesStoreModule.useNodesStore.getState().hfDownloadProgress['gated/model'];
  assert.equal(progress.status, 'error');
  assert.equal(progress.error, 'Access denied for gated/model.');
  assert.equal(progress.error_code, 'huggingface_access_required');
});

test('model-install access failures infer the stable code from legacy error text', async () => {
  globalThis.fetch = async () =>
    jsonResponse(
      {
        error: '403 gated repo: this account is not authorized. Accept the license and configure a token.',
        repo_id: 'legacy/gated-model',
      },
      403,
    );

  await assert.rejects(
    nodesStoreModule.useNodesStore.getState().installHfModel('legacy/gated-model'),
    (error) => error.kind === 'http' && error.status === 403,
  );

  const progress = nodesStoreModule.useNodesStore.getState().hfDownloadProgress['legacy/gated-model'];
  assert.equal(progress.status, 'error');
  assert.equal(progress.error_code, 'huggingface_access_required');
});
