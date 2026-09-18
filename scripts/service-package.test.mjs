import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, service;
before(async () => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:5191' } };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  service = await server.ssrLoadModule('/src/studio/servicePackage.ts');
});
after(async () => {
  await server?.close();
  delete globalThis.window;
});

test('named bindings keep exact lowered graph identities and reject duplicate names', () => {
  const candidates = {
    inputs: [{ nodeId: 'block_child', field: 'prompt', type: 'string' }],
    outputs: [{ nodeId: 'preview', field: 'image', type: 'ui_image' }],
  };
  const names = { '["inputs","block_child","prompt"]': 'prompt', '["outputs","preview","image"]': 'image' };
  assert.deepEqual(service.buildServiceInterface(candidates, names), {
    inputs: { prompt: [{ nodeId: 'block_child', field: 'prompt' }] },
    outputs: { image: [{ nodeId: 'preview', field: 'image' }] },
  });
  assert.throws(() => service.buildServiceInterface(candidates, {}), /preview output/);
  assert.throws(
    () => service.buildServiceInterface(candidates, { ...names, '["inputs","block_child","prompt"]': 'bad name' }),
    /names/,
  );
  const duplicate = {
    ...candidates,
    inputs: [...candidates.inputs, { nodeId: 'next', field: 'text', type: 'string' }],
  };
  assert.throws(
    () => service.buildServiceInterface(duplicate, { ...names, '["inputs","next","text"]': 'prompt' }),
    /different name/,
  );
});

test('network responses are narrowed before use or download', () => {
  assert.throws(() => service.parseServiceCandidates({ error: false, inputs: [{ nodeId: 2 }], outputs: [] }));
  assert.throws(() => service.parseServicePackage({ package: { schema: 'modiff-service-v1' } }));
  const value = {
    error: false,
    package: {
      schema: 'modiff-service-v1',
      contentHash: `sha256:${'a'.repeat(64)}`,
      graph: { nodes: {}, paths: [] },
      interface: { inputs: {}, outputs: {} },
      requirements: {},
    },
  };
  assert.equal(service.parseServicePackage(value).schema, 'modiff-service-v1');
  assert.throws(() =>
    service.parseServicePackage({
      ...value,
      package: { ...value.package, graph: { nodes: {}, paths: [], value: Infinity } },
    }),
  );
});
