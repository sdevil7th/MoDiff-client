import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let resources;
const originalWindow = globalThis.window;
before(async () => {
  globalThis.window = {
    location: { protocol: 'http:', hostname: '127.0.0.1', port: '8088', origin: 'http://127.0.0.1:8088' },
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { entries: [], noDiscovery: true },
    appType: 'custom',
  });
  resources = await server.ssrLoadModule('/src/studio/runtimeResources.ts');
});
after(async () => {
  await server?.close();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

test('paused allocator readings remain unavailable, with the explicit explanation state', () => {
  const snapshot = resources.parseRuntimeResourceSnapshot({
    schemaVersion: 1,
    activeDevice: 'cuda:0',
    accelerators: [
      {
        device: 'cuda:0',
        allocatorStatsStatus: 'paused_during_execution',
        allocatedBytes: null,
        reservedBytes: null,
        memoryUsedBytes: null,
        utilizationPercent: 25,
        utilizationSource: 'sysfs',
      },
    ],
  });
  assert.equal(snapshot.accelerators[0].allocatorStatsStatus, 'paused_during_execution');
  assert.equal(snapshot.accelerators[0].allocatedBytes, null);
  assert.equal(snapshot.accelerators[0].reservedBytes, null);
  assert.equal(snapshot.accelerators[0].memoryUsedBytes, null);
  assert.equal(snapshot.accelerators[0].utilizationPercent, 25);
  assert.equal(resources.formatResourceBytes(snapshot.accelerators[0].allocatedBytes), '—');
});

test('idle and unknown allocator status cannot produce an invented paused explanation', () => {
  for (const status of [undefined, null, 'unknown', {}, false]) {
    const snapshot = resources.parseRuntimeResourceSnapshot({
      accelerators: [{ device: 'cuda:0', allocatorStatsStatus: status, allocatedBytes: 1024 }],
    });
    assert.equal(snapshot.accelerators[0].allocatorStatsStatus, null);
    assert.equal(snapshot.accelerators[0].allocatedBytes, 1024);
  }
});
