import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, execution;
before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  execution = await server.ssrLoadModule('/src/studio/executionSpecs.ts');
});
after(async () => server?.close());

const spec = {
  id: 'wan-t2v:v1',
  contentHash: 'reviewed-hash',
  mode: 'text_to_video',
  roles: [['wanPipeline'], ['wanGenerate'], ['videoExport']],
};
const capabilities = [{ modelType: 'WanPipeline', studioExecutionSpecs: [spec] }];
function binding(contracts) {
  return {
    modelType: 'WanPipeline',
    mode: 'text_to_video',
    executionSpec: { schemaVersion: 1, id: spec.id, contentHash: spec.contentHash },
    nodes: { wanPipeline: 'loader', wanGenerate: 'single', videoExport: 'export' },
    ...(contracts ? { controlled: { contractIds: contracts } } : {}),
  };
}

test('controlled video replacements do not attach a single-shot specification to a different executable graph', () => {
  for (const contract of ['video-sequence.v1', 'quality-video.t2v.v1', 'quality-video.i2v.v1', 'lyric-video.v1']) {
    const graph = { loader: {}, sequence: {}, export: {} };
    assert.equal(execution.studioExecutionSpecRuntimeReceipt(binding([contract]), capabilities, graph), undefined);
  }
});

test('base graphs and controlled additions keep their exact reviewed specification receipt', () => {
  const graph = { loader: {}, single: {}, export: {}, upscaler: {} };
  for (const contracts of [undefined, ['upscale.video.v1'], ['video-sequence.v1']]) {
    assert.deepEqual(execution.studioExecutionSpecRuntimeReceipt(binding(contracts), capabilities, graph), {
      schemaVersion: 1,
      id: spec.id,
      contentHash: spec.contentHash,
      nodes: { wanPipeline: 'loader', wanGenerate: 'single', videoExport: 'export' },
    });
  }
});

test('unreviewed contracts and stale specification identities cannot drop the managed receipt', () => {
  assert.ok(execution.studioExecutionSpecRuntimeReceipt(binding(['unknown']), capabilities, { loader: {} }));
  const stale = binding(['video-sequence.v1']);
  stale.executionSpec.contentHash = 'stale';
  assert.throws(() => execution.studioExecutionSpecRuntimeReceipt(stale, capabilities, { loader: {} }), /stale/);
});
