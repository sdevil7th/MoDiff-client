import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let exportModule;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  exportModule = await server.ssrLoadModule('/src/stores/flowGraphExport.ts');
});

after(async () => {
  await server?.close();
});

function seedNode(value) {
  return {
    id: 'generate',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.DiffusersImage',
      action: 'Generate',
      params: {
        seed: {
          type: 'int',
          display: 'random',
          value,
        },
      },
    },
  };
}

function exportSeed(value, setParam = () => {}) {
  const graph = exportModule.buildApiGraphExport({
    nodes: [seedNode(value)],
    edges: [],
    sid: 'test-session',
    setParam,
  });
  return graph.nodes.generate.params.seed;
}

test('locked random-field seeds export without the random display marker', () => {
  const seed = exportSeed({ value: 1234, isRandom: false });

  assert.equal(seed.value, 1234);
  assert.equal('display' in seed, false);
});

test('random-on-export seeds retain random behavior and metadata', () => {
  const originalRandom = Math.random;
  const updates = [];
  Math.random = () => 0.5;

  try {
    const seed = exportSeed({ value: 1234, isRandom: true }, (...args) => updates.push(args));
    const generatedSeed = Math.floor(0.5 * Number.MAX_SAFE_INTEGER);

    assert.deepEqual(seed, {
      display: 'random',
      value: generatedSeed,
    });
    assert.deepEqual(updates, [['generate', 'seed', { value: generatedSeed, isRandom: true }]]);
  } finally {
    Math.random = originalRandom;
  }
});
