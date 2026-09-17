import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let search;

before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  search = await server.ssrLoadModule('/src/workflow/nodeConnectionSearch.ts');
});

after(async () => server?.close());

const definition = (params, action = 'Process') => ({
  module: 'custom.Workbench',
  action,
  label: `Workbench ${action}`,
  category: 'Test',
  type: 'custom',
  params,
});

test('connection search and insertion agree on direction, enabled inputs, normalized types, unions and wildcards', () => {
  const node = definition({
    output: { display: 'output', type: 'string', isInput: true },
    ordinaryControl: { display: 'text', type: 'string' },
    input: { display: 'text', type: ['string', 'image'], isInput: true },
  });
  assert.equal(search.matchingNodeHandleForDrop(node, ' STRING ', 'source')?.[0], 'input');
  assert.equal(search.matchingNodeHandleForDrop(node, 'string', 'target')?.[0], 'output');
  assert.equal(search.matchingNodeHandleForDrop(node, 'audio', 'source'), undefined);
  assert.equal(search.matchingNodeHandleForDrop(node, 'str', 'source'), undefined, 'Do not invent type aliases.');
  assert.equal(search.matchingNodeHandleForDrop(node, undefined, 'source')?.[0], 'input');
  assert.equal(search.matchingNodeHandleForDrop(node, ['any', 'audio'], 'target')?.[0], 'output');
  assert.equal(search.matchingNodeHandleForDrop(node, 'string', null), undefined);
  for (const type of ['any', 'default', 'missing', undefined]) {
    const wildcard = definition({ input: { display: 'input', type } });
    assert.equal(search.matchingNodeHandleForDrop(wildcard, 'image', 'source')?.[0], 'input');
    assert.equal(search.matchingNodeHandleForDrop(wildcard, 'image', 'target'), undefined);
  }
});

test('connection search excludes wrong-direction nodes even for untyped origins and retains custom identities', () => {
  const input = definition({ text: { display: 'text', isInput: true, type: 'string' } }, 'Input');
  const output = definition({ text: { display: 'output', type: 'string' } }, 'Output');
  const registry = { 'custom.Workbench.Input': input, 'custom.Workbench.Output': output };
  const before = JSON.stringify(registry);
  const keys = (...args) => search.connectionSearchEntries(registry, ...args).map(([key]) => key);
  assert.deepEqual(keys(undefined, 'source'), ['custom.Workbench.Input']);
  assert.deepEqual(keys(undefined, 'target'), ['custom.Workbench.Output']);
  assert.deepEqual(keys(' STRING ', 'source'), ['custom.Workbench.Input']);
  assert.deepEqual(keys('image', 'source'), []);
  assert.deepEqual(keys(undefined, undefined), Object.keys(registry));
  assert.equal(JSON.stringify(registry), before);
});

test('connection search deduplicates exact aliases and excludes structural groups without merging different contracts', () => {
  const original = definition({ input: { display: 'input', type: 'string' } });
  const different = definition({ input: { display: 'input', type: 'image' } });
  const entries = search.connectionSearchEntries(
    {
      canonical: original,
      alias: structuredClone(original),
      different,
      group: { ...original, type: 'group' },
    },
    'any',
    'source',
  );
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map(([, node]) => node.params.input.type).sort(), ['image', 'string']);
});
