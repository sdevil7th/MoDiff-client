import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build, createServer, loadConfigFromFile } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let actionsModule;
let originalFetch;
let server;
let controlModule;

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
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  actionsModule = await server.ssrLoadModule('/src/utils/serverActions.ts');
  controlModule = await server.ssrLoadModule('/src/utils/supervisorControl.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
  controlModule.resetSupervisorControl();
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('advertised unsupervised workers stop directly without probing a missing control port', async () => {
  controlModule.updateWorkerControl(controlModule.parseWorkerControl({ available: false, address: null }));
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse({ error: false });
  };
  await actionsModule.requestExecutionStop();
  assert.deepEqual(requests, ['http://127.0.0.1:5191/stop']);
});

test('invalid legacy control configuration still permits the ordinary worker Stop fallback', async () => {
  const config = (await server.ssrLoadModule('/app.config.ts')).default;
  const previous = config.supervisorAddress;
  const requests = [];
  config.supervisorAddress = 'http://remote.example:8089';
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse({ error: false });
  };
  try {
    await actionsModule.requestExecutionStop();
    assert.deepEqual(requests, ['http://127.0.0.1:5191/stop']);
  } finally {
    config.supervisorAddress = previous;
  }
});

test('explicit Stop retains a verified custom control address through metadata failure and polling backoff', async () => {
  controlModule.updateWorkerControl(
    controlModule.parseWorkerControl({ available: true, address: 'http://127.0.0.1:43001' }),
  );
  controlModule.updateWorkerControl(undefined);
  controlModule.supervisorControlFailed();
  assert.equal(controlModule.supervisorControlAddress(), null);
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse({ error: false });
  };
  await actionsModule.requestExecutionStop();
  assert.deepEqual(requests, ['http://127.0.0.1:43001/stop']);
});

test('worker control metadata rejects malformed, remote, credentialed and non-origin destinations', () => {
  assert.equal(controlModule.parseWorkerControl(undefined), undefined);
  for (const value of [
    null,
    [],
    {},
    { available: 'true', address: null },
    { available: false, address: 'http://127.0.0.1:8089' },
    { available: true, address: null },
    { available: false, address: null, arbitrary: true },
    ...[
      'http://example.com:9001',
      'http://127.0.0.2:9001',
      'https://127.0.0.1:9001',
      'http://user@127.0.0.1:9001',
      'http://127.0.0.1:9001/queue',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
      'http://127.0.0.1:9001?x=1',
      'http://2130706433:9001',
    ].map((address) => ({ available: true, address })),
  ]) {
    assert.throws(() => controlModule.parseWorkerControl(value));
  }
  assert.deepEqual(controlModule.parseWorkerControl({ available: true, address: 'http://127.0.0.1:43001/' }), {
    available: true,
    address: 'http://127.0.0.1:43001',
  });
  assert.deepEqual(controlModule.parseWorkerControl({ available: true, address: 'http://127.0.0.1:80' }), {
    available: true,
    address: 'http://127.0.0.1',
  });
});

test('older health metadata cannot replace a newer verified supervisor destination', () => {
  const older = controlModule.beginWorkerControlRead();
  const newer = controlModule.beginWorkerControlRead();
  controlModule.updateWorkerControl({ available: true, address: 'http://127.0.0.1:43001' }, newer);
  controlModule.updateWorkerControl({ available: false, address: null }, older);
  assert.equal(controlModule.supervisorControlAddress(), 'http://127.0.0.1:43001');
});

async function withControlConfiguration(overrides, run) {
  const config = (await server.ssrLoadModule('/app.config.ts')).default;
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, config[key]]));
  Object.assign(config, overrides);
  try {
    return await run(config);
  } finally {
    Object.assign(config, previous);
  }
}

const advertisedBackend = { host: '127.0.0.1', port: 8088, scheme: 'http' };
const adjacentControl = { available: true, address: 'http://127.0.0.1:8089' };

test('production tunnel Stop uses the configured adjacent supervisor and never the remote-local port', async () => {
  await withControlConfiguration(
    {
      serverAddress: 'http://127.0.0.1:18088',
      backendAddress: 'http://127.0.0.1:18088',
      supervisorAddress: 'http://127.0.0.1:18089',
      supervisorAddressExplicit: false,
    },
    async () => {
      controlModule.updateWorkerControl(controlModule.parseWorkerControl(adjacentControl, advertisedBackend));
      const requests = [];
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        return jsonResponse({ error: false });
      };
      await actionsModule.requestExecutionStop();
      assert.deepEqual(requests, ['http://127.0.0.1:18089/stop']);
      requests.length = 0;
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        if (requests.length === 1) throw new TypeError('Owned supervisor tunnel unavailable.');
        return jsonResponse({ error: false });
      };
      await actionsModule.requestExecutionStop();
      assert.deepEqual(requests, ['http://127.0.0.1:18089/stop', 'http://127.0.0.1:18088/stop']);
    },
  );
});

test('direct and DEV-proxied backend metadata preserve the actual custom supervisor port', async () => {
  await withControlConfiguration(
    {
      serverAddress: 'http://127.0.0.1:5191',
      backendAddress: 'http://127.0.0.1:8088',
      supervisorAddress: 'http://127.0.0.1:8089',
      supervisorAddressExplicit: false,
    },
    () => {
      assert.equal(
        controlModule.parseWorkerControl(adjacentControl, advertisedBackend).address,
        'http://127.0.0.1:8089',
      );
      assert.equal(
        controlModule.parseWorkerControl({ available: true, address: 'http://127.0.0.1:43001' }, advertisedBackend)
          .address,
        'http://127.0.0.1:43001',
      );
    },
  );
});

test('a nonadjacent tunneled supervisor requires a trusted explicit override and otherwise Stop uses only the worker', async () => {
  await withControlConfiguration(
    {
      serverAddress: 'http://127.0.0.1:18088',
      backendAddress: 'http://127.0.0.1:18088',
      supervisorAddress: 'http://127.0.0.1:18089',
      supervisorAddressExplicit: false,
    },
    async (config) => {
      const custom = { available: true, address: 'http://127.0.0.1:43001' };
      const unresolved = controlModule.parseWorkerControl(custom, advertisedBackend);
      assert.deepEqual(unresolved, { available: true, address: null });
      controlModule.updateWorkerControl(unresolved);
      assert.throws(() => controlModule.supervisorControlAddress(), /supervisor.*configured backend/i);
      const requests = [];
      globalThis.fetch = async (url) => {
        requests.push(String(url));
        return jsonResponse({ error: false });
      };
      await actionsModule.requestExecutionStop();
      assert.deepEqual(requests, ['http://127.0.0.1:18088/stop']);
      config.supervisorAddressExplicit = true;
      config.supervisorAddress = 'http://127.0.0.1:19001';
      controlModule.updateWorkerControl(controlModule.parseWorkerControl(custom, advertisedBackend));
      assert.equal(controlModule.supervisorControlAddress(), 'http://127.0.0.1:19001');
      config.supervisorAddress = 'http://remote.example:19001';
      assert.throws(
        () => controlModule.parseWorkerControl(custom, advertisedBackend),
        /Invalid supervisor control address/,
      );
    },
  );
});

test('control translation rejects metadata authority outside a matching loopback adjacent pair', async () => {
  await withControlConfiguration(
    {
      backendAddress: 'http://127.0.0.1:18088',
      supervisorAddress: 'http://127.0.0.1:18089',
      supervisorAddressExplicit: false,
    },
    (config) => {
      for (const metadata of [
        null,
        [],
        {},
        { ...advertisedBackend, host: 'example.com' },
        { ...advertisedBackend, host: '127.0.0.2' },
        { ...advertisedBackend, host: 'user@127.0.0.1' },
        { ...advertisedBackend, port: '8088' },
        { ...advertisedBackend, port: 0 },
        { ...advertisedBackend, port: 65536 },
        { ...advertisedBackend, scheme: 'file' },
        { ...advertisedBackend, host: '::1' },
      ]) {
        assert.deepEqual(controlModule.parseWorkerControl(adjacentControl, metadata), {
          available: true,
          address: null,
        });
      }
      for (const address of [
        'http://example.com:18088',
        'http://user@127.0.0.1:18088',
        'http://2130706433:18088',
        'http://127.0.0.1:65536',
      ]) {
        config.backendAddress = address;
        assert.deepEqual(controlModule.parseWorkerControl(adjacentControl, advertisedBackend), {
          available: true,
          address: null,
        });
      }
      config.backendAddress = 'http://127.0.0.1:65535';
      assert.deepEqual(controlModule.parseWorkerControl(adjacentControl, advertisedBackend), {
        available: true,
        address: null,
      });
      config.backendAddress = 'http://backend.example:18088';
      config.supervisorAddress = 'http://127.0.0.1:19001';
      config.supervisorAddressExplicit = true;
      assert.equal(
        controlModule.parseWorkerControl(adjacentControl, advertisedBackend).address,
        'http://127.0.0.1:19001',
      );
    },
  );
});

test('loopback IPv6, default ports and a custom health transport retain bounded control resolution', async () => {
  await withControlConfiguration(
    {
      backendAddress: 'http://127.0.0.1:8088',
      supervisorAddress: 'http://127.0.0.1:8089',
      supervisorAddressExplicit: false,
    },
    (config) => {
      assert.equal(
        controlModule.parseWorkerControl(adjacentControl, advertisedBackend, 'http://127.0.0.1:28088').address,
        'http://127.0.0.1:28089',
      );
      config.backendAddress = 'http://[::1]:18088';
      config.supervisorAddress = 'http://[::1]:18089';
      assert.equal(
        controlModule.parseWorkerControl(
          { available: true, address: 'http://[::1]:8089' },
          { host: '::1', port: 8088, scheme: 'http' },
        ).address,
        'http://[::1]:18089',
      );
      config.backendAddress = 'http://localhost';
      config.supervisorAddress = 'http://localhost:81';
      assert.equal(
        controlModule.parseWorkerControl(
          { available: true, address: 'http://127.0.0.1:43001' },
          { ...advertisedBackend, port: 80 },
        ).address,
        'http://127.0.0.1:43001',
      );
      assert.equal(
        controlModule.parseWorkerControl(
          { available: false, address: null },
          { ...advertisedBackend, host: 'example.com' },
        ).address,
        null,
      );
    },
  );
});

test('execution stop uses the process-external supervisor before the backend worker', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return jsonResponse({ error: false, message: 'Execution set for interruption.' });
  };

  const result = await actionsModule.requestExecutionStop();
  assert.match(request.url, /\/stop$/);
  assert.match(request.url, /:8089\/stop$/);
  assert.equal(request.init.method, 'POST');
  assert.equal(result.message, 'Execution set for interruption.');
});

test('the real Vite config derives the supervisor from the backend rather than the frontend port', async () => {
  const priorBackend = process.env.VITE_BACKEND_PROXY_TARGET;
  const priorSupervisor = process.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
  process.env.VITE_BACKEND_PROXY_TARGET = 'http://127.0.0.1:65530';
  delete process.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
  try {
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'test' },
      path.join(ROOT, 'vite.config.ts'),
      ROOT,
      'silent',
    );
    assert.ok(loaded);
    assert.equal(
      loaded.config.define['import.meta.env.VITE_BACKEND_PROXY_TARGET'],
      JSON.stringify('http://127.0.0.1:65530'),
    );
    assert.equal(
      loaded.config.define['import.meta.env.VITE_SUPERVISOR_CONTROL_ADDRESS'],
      JSON.stringify('http://127.0.0.1:65531'),
    );
    assert.equal(loaded.config.define['import.meta.env.MODIFF_SUPERVISOR_CONTROL_EXPLICIT'], 'false');
    assert.equal(loaded.config.server.proxy['/huggingface'].target, 'http://127.0.0.1:65530');
  } finally {
    if (priorBackend === undefined) delete process.env.VITE_BACKEND_PROXY_TARGET;
    else process.env.VITE_BACKEND_PROXY_TARGET = priorBackend;
    if (priorSupervisor === undefined) delete process.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
    else process.env.VITE_SUPERVISOR_CONTROL_ADDRESS = priorSupervisor;
  }
});

test('development configuration distinguishes proxy transport, direct backend and explicit supervisor overrides', async () => {
  const priorBackend = process.env.VITE_BACKEND_PROXY_TARGET;
  const priorSupervisor = process.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
  process.env.VITE_BACKEND_PROXY_TARGET = 'http://127.0.0.1:9000';
  try {
    for (const [directBackend, supervisorOverride, expectedBackend, expectedSupervisor] of [
      [undefined, undefined, 'http://127.0.0.1:9000', 'http://127.0.0.1:9001'],
      ['http://127.0.0.1:19000', undefined, 'http://127.0.0.1:19000', 'http://127.0.0.1:19001'],
      [undefined, 'http://127.0.0.1:29001', 'http://127.0.0.1:9000', 'http://127.0.0.1:29001'],
    ]) {
      if (supervisorOverride) process.env.VITE_SUPERVISOR_CONTROL_ADDRESS = supervisorOverride;
      else delete process.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
      const loaded = await loadConfigFromFile(
        { command: 'serve', mode: 'test' },
        path.join(ROOT, 'vite.config.ts'),
        ROOT,
        'silent',
      );
      assert.ok(loaded);
      assert.equal(
        loaded.config.define['import.meta.env.MODIFF_SUPERVISOR_CONTROL_EXPLICIT'],
        String(Boolean(supervisorOverride)),
      );
      const bundle = await build({
        configFile: false,
        root: ROOT,
        logLevel: 'silent',
        build: {
          write: false,
          minify: false,
          lib: { entry: path.join(ROOT, 'app.config.ts'), formats: ['cjs'] },
          rollupOptions: { output: { exports: 'named' } },
        },
        define: {
          'import.meta.env.DEV': 'true',
          'import.meta.env.VITE_SERVER_ADDRESS': directBackend ? JSON.stringify(directBackend) : 'undefined',
          ...loaded.config.define,
        },
      });
      const module = { exports: {} };
      runInNewContext(bundle[0].output[0].code, {
        module,
        exports: module.exports,
        window: { location: { origin: 'http://127.0.0.1:5191' } },
        URL,
      });
      assert.equal(module.exports.default.backendAddress, expectedBackend);
      assert.equal(module.exports.default.supervisorAddress, expectedSupervisor);
      assert.equal(module.exports.default.supervisorAddressExplicit, Boolean(supervisorOverride));
    }
  } finally {
    if (priorBackend === undefined) delete process.env.VITE_BACKEND_PROXY_TARGET;
    else process.env.VITE_BACKEND_PROXY_TARGET = priorBackend;
    if (priorSupervisor === undefined) delete process.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
    else process.env.VITE_SUPERVISOR_CONTROL_ADDRESS = priorSupervisor;
  }
});

test('execution stop falls back to the worker endpoint when the supervisor is unavailable', async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (requests.length === 1) throw new TypeError('control plane unavailable');
    return jsonResponse({ error: false, message: 'Execution set for interruption.' });
  };

  const result = await actionsModule.requestExecutionStop();
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /:8089\/stop$/);
  assert.equal(requests[0].init.method, 'POST');
  assert.match(requests[1].url, /:5191\/stop$/);
  assert.equal(requests[1].init.method, 'POST');
  assert.equal(result.message, 'Execution set for interruption.');
});

test('production recovery follows the serving backend port instead of the development proxy', async () => {
  const priorBackend = process.env.VITE_BACKEND_PROXY_TARGET;
  const priorSupervisor = process.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
  process.env.VITE_BACKEND_PROXY_TARGET = 'http://127.0.0.1:65530';
  delete process.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
  try {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      path.join(ROOT, 'vite.config.ts'),
      ROOT,
      'silent',
    );
    assert.ok(loaded);
    for (const [origin, override, expected] of [
      ['http://127.0.0.1:8096', undefined, 'http://127.0.0.1:8097'],
      ['http://127.0.0.1:8088', undefined, 'http://127.0.0.1:8089'],
      ['http://127.0.0.1:18088', undefined, 'http://127.0.0.1:18089'],
      ['http://127.0.0.1:8096', 'http://127.0.0.1:18000', 'http://127.0.0.1:18000'],
    ]) {
      const bundle = await build({
        configFile: false,
        root: ROOT,
        logLevel: 'silent',
        build: {
          write: false,
          minify: false,
          lib: { entry: path.join(ROOT, 'app.config.ts'), formats: ['cjs'] },
          rollupOptions: { output: { exports: 'named' } },
        },
        define: {
          'import.meta.env.DEV': 'false',
          'import.meta.env.VITE_SERVER_ADDRESS': 'undefined',
          'import.meta.env.VITE_BACKEND_PROXY_TARGET': JSON.stringify(process.env.VITE_BACKEND_PROXY_TARGET),
          'import.meta.env.VITE_SUPERVISOR_CONTROL_ADDRESS': override ? JSON.stringify(override) : 'undefined',
          ...loaded.config.define,
        },
      });
      const module = { exports: {} };
      runInNewContext(bundle[0].output[0].code, {
        module,
        exports: module.exports,
        window: { location: { origin } },
        URL,
      });
      assert.equal(module.exports.default.serverAddress, origin);
      assert.equal(module.exports.default.backendAddress, origin);
      assert.equal(module.exports.default.supervisorAddress, expected);
      assert.equal(module.exports.default.supervisorAddressExplicit, Boolean(override));
    }
  } finally {
    if (priorBackend === undefined) delete process.env.VITE_BACKEND_PROXY_TARGET;
    else process.env.VITE_BACKEND_PROXY_TARGET = priorBackend;
    if (priorSupervisor === undefined) delete process.env.VITE_SUPERVISOR_CONTROL_ADDRESS;
    else process.env.VITE_SUPERVISOR_CONTROL_ADDRESS = priorSupervisor;
  }
});

test('successful HTTP responses with an error payload remain application failures', async () => {
  globalThis.fetch = async () => jsonResponse({ error: true, message: 'Nothing is currently running.' });

  await assert.rejects(actionsModule.requestExecutionStop(), (error) => {
    assert.equal(error.name, 'RequestError');
    assert.equal(error.kind, 'application');
    assert.equal(error.message, 'Nothing is currently running.');
    return true;
  });
});

test('queue cancellation encodes the id and rejects a mismatched response identity', async () => {
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return jsonResponse({ error: false, task_id: 'other-task', queued: {}, current: null });
  };

  await assert.rejects(actionsModule.cancelQueuedTask('task/with spaces'), (error) => {
    assert.equal(error.kind, 'invalid_payload');
    assert.match(error.message, /wrong task identifier/);
    return true;
  });
  assert.match(requestedUrl, /task%2Fwith%20spaces$/);
});

test('node cache deletion deduplicates ids and validates the echoed node list', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return jsonResponse({ error: false, nodes: ['node-a', 'node-b'] });
  };

  const result = await actionsModule.deleteNodeCache(['node-a', 'node-a', '', 'node-b']);
  assert.match(request.url, /\/cache$/);
  assert.equal(request.init.method, 'DELETE');
  assert.deepEqual(JSON.parse(request.init.body), { nodes: ['node-a', 'node-b'] });
  assert.deepEqual(result.nodes, ['node-a', 'node-b']);
});

test('empty cache deletion is a no-op and does not contact the backend', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ error: false, nodes: [] });
  };

  const result = await actionsModule.deleteNodeCache([]);
  assert.equal(calls, 0);
  assert.deepEqual(result.nodes, []);
});

test('GPU cleanup and Hugging Face deletion use hash-bound planning and mutation methods', async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/incomplete-cleanup-plan')) {
      return jsonResponse({
        error: false,
        schemaVersion: 1,
        kind: 'hf_incomplete_cleanup_plan',
        files: [],
        eligibleFileCount: 0,
        eligibleBytes: 0,
        blockers: [],
        canCleanup: false,
        planHash: 'sha256:partial-plan',
      });
    }
    if (String(url).includes('/deletion-plan')) {
      return jsonResponse({
        error: false,
        schemaVersion: 1,
        kind: 'hf_cache_deletion_plan',
        revisionHashes: ['a'.repeat(40)],
        targets: [],
        canonicalDependencies: [],
        savedWorkflowDependencies: [],
        dependencyPolicy: 'protect_dependencies',
        warnings: [],
        blockers: [],
        canDelete: true,
        planHash: 'sha256:plan',
      });
    }
    if (init?.method === 'DELETE' && /\/hf_cache\/[0-9a-f]{40}$/.test(String(url))) {
      return jsonResponse({
        error: false,
        deleted: true,
        plan: { planHash: 'sha256:plan' },
        runtimeRelease: {
          released: { nodes: 1, models: 1, diffusers_components: 0, offload_files: 0 },
          allocatorTrimmed: true,
          errors: [],
        },
      });
    }
    return jsonResponse({ error: false, message: 'Done.' });
  };

  await actionsModule.cleanupGpuMemory();
  await actionsModule.fetchHfCacheDeletionPlan('a'.repeat(40));
  await actionsModule.deleteHfCacheEntry('a'.repeat(40), 'sha256:plan');
  await actionsModule.fetchHfCacheDeletionPlan('a'.repeat(40), true);
  await actionsModule.deleteHfCacheEntry('a'.repeat(40), 'sha256:plan', true);
  await actionsModule.fetchHfIncompleteCleanupPlan();
  await actionsModule.cleanupHfIncompleteFiles('sha256:partial-plan');
  assert.match(requests[0].url, /\/runtime\/gpu_cleanup$/);
  assert.equal(requests[0].init.method, 'POST');
  assert.match(requests[1].url, new RegExp(`/hf_cache/${'a'.repeat(40)}/deletion-plan$`));
  assert.equal(requests[1].init.method, undefined);
  assert.match(requests[2].url, new RegExp(`/hf_cache/${'a'.repeat(40)}$`));
  assert.equal(requests[2].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(requests[2].init.body), { planHash: 'sha256:plan' });
  assert.match(requests[3].url, new RegExp(`/hf_cache/${'a'.repeat(40)}/deletion-plan\\?allow_redownload=true$`));
  assert.equal(requests[3].init.method, undefined);
  assert.match(requests[4].url, new RegExp(`/hf_cache/${'a'.repeat(40)}$`));
  assert.equal(requests[4].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(requests[4].init.body), { planHash: 'sha256:plan', allowRedownload: true });
  assert.match(requests[5].url, /\/hf_cache\/incomplete-cleanup-plan$/);
  assert.equal(requests[5].init.method, undefined);
  assert.match(requests[6].url, /\/hf_cache\/incomplete-cleanup$/);
  assert.equal(requests[6].init.method, 'DELETE');
  assert.deepEqual(JSON.parse(requests[6].init.body), { planHash: 'sha256:partial-plan' });
});

test('Hugging Face deletion rejects malformed runtime-release receipts', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      error: false,
      deleted: true,
      plan: { planHash: 'sha256:plan' },
      runtimeRelease: {
        released: { nodes: -1, models: 0, diffusers_components: 0, offload_files: 0 },
        allocatorTrimmed: 'yes',
        errors: [],
      },
    });

  await assert.rejects(actionsModule.deleteHfCacheEntry('a'.repeat(40), 'sha256:plan'), (error) => {
    assert.equal(error.kind, 'invalid_payload');
    assert.match(error.message, /deletion receipt is invalid/);
    return true;
  });
});

test('output recomputation is explicit, preserves model owners, and rejects an older backend response', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return jsonResponse({ error: false, scope: 'outputs', nodes: ['encode'], retainedModelNodes: ['load'] });
  };
  const result = await actionsModule.recomputeNodeOutputs(['load', 'encode', 'encode']);
  assert.equal(request.init.method, 'DELETE');
  assert.deepEqual(JSON.parse(request.init.body), { nodes: ['load', 'encode'], scope: 'outputs' });
  assert.deepEqual(result.retainedModelNodes, ['load']);
  globalThis.fetch = async () => jsonResponse({ error: false, nodes: ['encode'] });
  await assert.rejects(actionsModule.recomputeNodeOutputs(['encode']), /response is invalid/);
});
