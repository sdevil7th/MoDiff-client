import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

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
    server: { middlewareMode: true },
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

test('execution stop uses the shared GET contract and returns a validated action payload', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return jsonResponse({ error: false, message: 'Execution set for interruption.' });
  };

  const result = await actionsModule.requestExecutionStop();
  assert.match(request.url, /\/stop$/);
  assert.equal(request.init.method, 'GET');
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

test('GPU cleanup and Hugging Face deletion use their typed mutation methods', async () => {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return jsonResponse({ error: false, message: 'Done.' });
  };

  await actionsModule.cleanupGpuMemory();
  await actionsModule.deleteHfCacheEntry('repo/hash with spaces');
  assert.match(requests[0].url, /\/runtime\/gpu_cleanup$/);
  assert.equal(requests[0].init.method, 'POST');
  assert.match(requests[1].url, /\/hf_cache\/repo%2Fhash%20with%20spaces$/);
  assert.equal(requests[1].init.method, 'DELETE');
});
