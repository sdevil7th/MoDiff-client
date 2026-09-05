import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let clusterDrag;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  clusterDrag = await server.ssrLoadModule('/src/workflow/huggingFaceClusterDrag.ts');
});

after(async () => {
  await server?.close();
});

test('moving an execution child owned by an expanded Cluster is layout-only', () => {
  const child = {
    id: 'qwen-instance__denoise',
    data: {
      type: 'custom',
      huggingFaceClusterRole: 'execution',
      huggingFaceClusterInstanceId: 'qwen-instance',
    },
  };

  assert.equal(clusterDrag.isOwnedHuggingFaceClusterExecutionNode(child), true);
  assert.equal(clusterDrag.classifyExpandedClusterDrop(child, 'qwen-instance'), 'preserve-owned-child');

  let customizationCalls = 0;
  let studioBlockPosts = 0;
  if (clusterDrag.classifyExpandedClusterDrop(child, 'qwen-instance') === 'customize-and-adopt') {
    customizationCalls += 1;
    studioBlockPosts += 1;
  }
  assert.equal(customizationCalls, 0);
  assert.equal(studioBlockPosts, 0);
});

test('only an unowned ordinary node dropped over a Cluster requests structural customization', () => {
  assert.equal(
    clusterDrag.classifyExpandedClusterDrop({ id: 'viewer', data: { type: 'custom' } }, 'qwen-instance'),
    'customize-and-adopt',
  );
  assert.equal(
    clusterDrag.classifyExpandedClusterDrop({ id: 'other-block', data: { type: 'block' } }, 'qwen-instance'),
    'reject-composite',
  );
});
