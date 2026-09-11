import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(
  gunzipSync(readFileSync(path.resolve(ROOT, '../MoDiff/modiff/registered_block_v2_catalog.v1.json.gz'))),
);
let server;
let schema;
let runtime;
let routes;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
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
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  routes = await server.ssrLoadModule('/src/studio/registeredBlockV2Routes.ts');
});
after(async () => {
  await server?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
});

for (const pipeline of ['WanAnimate2ModularPipeline', 'WanAnimate2DistilledModularPipeline']) {
  const id = `diffusers.modular:${pipeline}:default`;
  test(`${pipeline} declares its driving file as video`, () => {
    const route = routes.REGISTERED_BLOCK_V2_ROUTES.find((item) => item.definitionId === id);
    const input = route.boundary.inputs.find((item) => item.portId === 'driving_video');
    assert.equal(input.adaptation, 'media_file_path');
    assert.equal(input.mediaType, 'video');
  });
  test(`${pipeline} compiled creator exports with only required media supplied`, () => {
    const entry = catalog.entries.find((item) => item.catalogDefinitionId === id);
    assert.ok(entry);
    for (const container of ['container:image_encoder', 'container:video_encoder', 'container:denoise']) {
      assert.ok(
        entry.definition.graph.nodes.some((node) => node.nodeId === container),
        'Reviewed structural containers must be preserved',
      );
    }
    const values = { ...entry.values, image: ['/fixtures/character.png'], driving_video: ['/fixtures/driver.mp4'] };
    const instance = schema.createBlockInstanceV2(entry.definition, {
      instanceId: `video-boundary-${pipeline}`,
      position: { x: 0, y: 0 },
      size: { width: 340, height: 400 },
      values,
      internalLayout: entry.internalLayout,
      internalLayoutMode: entry.internalLayoutMode,
      baselineValues: true,
    });
    const graph = runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(instance)], []);
    const loader = graph.nodes.find((node) => node.data.module === 'modules.Video' && node.data.action === 'Load');
    const encoder = graph.nodes.find((node) => node.data.params?.driving_video);
    assert.ok(loader && encoder);
    assert.equal(encoder.data.params.driving_video.type, 'video');
    assert.deepEqual(instance.values, values);
    assert.equal(instance.values.prompt, entry.values.prompt);
    assert.equal(instance.values.num_inference_steps, entry.values.num_inference_steps);
  });
}
