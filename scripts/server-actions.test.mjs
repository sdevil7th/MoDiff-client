import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, loadConfigFromFile } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let actionsModule;
let originalFetch;
let server;

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
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
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
    assert.equal(loaded.config.server.proxy['/huggingface'].target, 'http://127.0.0.1:65530');
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
