import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('operation planners import without window or localStorage', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.localStorage, 'undefined');
  const tempRoot = realpathSync(tmpdir());
  const cacheDir = mkdtempSync(path.join(tempRoot, 'modiff-operation-headless-'));
  let server;
  try {
    server = await createServer({
      root,
      configFile: false,
      cacheDir,
      logLevel: 'silent',
      optimizeDeps: { entries: [], noDiscovery: true },
      server: { middlewareMode: true, watch: null },
      appType: 'custom',
    });
    for (const [module, name] of [
      ['/src/workflow/operationAuthoring.ts', 'planOperationChange'],
      ['/src/workflow/operationBlockChange.ts', 'planBlockOperationChange'],
      ['/src/workflow/encodingNodeConnection.ts', 'planEncodingConnection'],
      ['/src/workflow/mediaAttachment.ts', 'planMediaAttachment'],
    ]) {
      const loaded = await server.ssrLoadModule(module);
      assert.equal(typeof loaded[name], 'function');
    }
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.localStorage, 'undefined');
  } finally {
    await server?.close();
    const resolvedCacheDir = realpathSync(cacheDir);
    assert.equal(path.dirname(resolvedCacheDir), tempRoot, 'Cleanup must remain inside the temporary directory.');
    assert.ok(path.basename(resolvedCacheDir).startsWith('modiff-operation-headless-'));
    rmSync(resolvedCacheDir, { recursive: true, force: true });
  }
});
