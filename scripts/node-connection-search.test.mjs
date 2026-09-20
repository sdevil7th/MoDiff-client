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
  assert.equal(
    search.matchingNodeHandleForDrop(node, 'str', 'source')?.[0],
    'input',
    'Declared scalar aliases share the same connector.',
  );
  assert.equal(search.matchingNodeHandleForDrop(node, 'list[str]', 'source'), undefined);
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

test('canvas search retains legacy keys and labels after exact-contract deduplication', () => {
  const node = definition({ input: { display: 'input', type: 'string' } });
  const registry = {
    canonical: node,
    retired_lookup: { ...node, label: 'Historical caption', description: 'Special old explanation' },
  };
  for (const query of ['retired_lookup', 'Historical caption']) {
    assert.equal(search.connectionSearchEntries(registry, 'string', 'source', query).length, 1, query);
  }
  assert.equal(search.connectionSearchEntries(registry, 'string', 'source', 'absent term').length, 0);
});

test('bound node suggestions respect task selection, hidden ports and both connector directions', () => {
  const input = {
    name: 'prompt',
    semanticName: 'prompt',
    direction: 'input',
    roles: ['value'],
    types: ['string'],
    hidden: false,
  };
  const output = { ...input, name: 'conditioning', direction: 'output', types: ['conditioning'] };
  const operation = {
    pipelineClass: 'FuturePipeline',
    task: 'text_to_image',
    operationId: 'diffusion.encode_prompt',
    nodeKey: 'modules.ModularDiffusers.EncodePrompt',
    binding: { pipelineClass: 'FuturePipeline', values: {} },
    ports: [input, output],
  };
  const ops = [operation, { ...operation, task: 'image_to_image', operationId: 'diffusion.encode_image' }];
  const select = (type, direction, query = '') =>
    search.operationSearchEntries(ops, 'FuturePipeline', 'text_to_image', type, direction, query);
  assert.deepEqual(select('str', 'source', 'encode'), [operation]);
  assert.deepEqual(select('conditioning', 'target'), [operation]);
  assert.deepEqual(select('image', 'source'), []);
  assert.deepEqual(select('conditioning', 'source'), []);
  assert.deepEqual(select('str', 'target'), []);
  assert.deepEqual(select(undefined, undefined), [operation]);
  assert.deepEqual(search.operationSearchEntries(ops, '', ''), []);
  assert.deepEqual(
    search.operationSearchEntries(
      [{ ...operation, ports: [{ ...input, hidden: true }] }],
      'FuturePipeline',
      'text_to_image',
      'str',
      'source',
    ),
    [],
  );
  assert.deepEqual(
    search.operationSearchEntries([{ ...operation, binding: undefined }], 'FuturePipeline', 'text_to_image'),
    [],
  );
});

test('bound operations retain old registry labels after exact alias consolidation', () => {
  const node = definition({}, 'EncodePrompt');
  const operation = {
    pipelineClass: 'FuturePipeline',
    task: 'text_to_image',
    operationId: 'diffusion.encode_prompt',
    nodeKey: 'custom.Workbench.EncodePrompt',
    binding: { pipelineClass: 'FuturePipeline', values: {} },
    ports: [],
  };
  const registry = { [operation.nodeKey]: node, retired_encoder: { ...node, label: 'Legacy tokenizer' } };
  assert.deepEqual(
    search.operationSearchEntries(
      [operation],
      'FuturePipeline',
      'text_to_image',
      undefined,
      undefined,
      'legacy tokenizer',
      registry,
    ),
    [operation],
  );
  assert.deepEqual(
    search.operationSearchEntries(
      [operation],
      'FuturePipeline',
      'text_to_image',
      undefined,
      undefined,
      'retired_encoder',
      registry,
    ),
    [operation],
  );
});

test('bound value-input insertion exposes only an editable declared control without mutating defaults', () => {
  const node = definition({
    prompt: { display: 'textarea', type: 'string', default: 'Keep me' },
    negative_prompt: { display: 'textarea', type: 'string' },
  });
  const operation = {
    ports: [
      { name: 'prompt', direction: 'input', roles: ['value'], types: ['string'], hidden: false },
      { name: 'negative_prompt', direction: 'input', roles: ['value'], types: ['string'], hidden: false },
    ],
  };
  const before = JSON.stringify(node);
  const prepared = search.prepareOperationConnection(node, operation, 'str', 'source');
  assert.equal(prepared.params.prompt.isInput, true);
  assert.equal(prepared.params.prompt.default, 'Keep me');
  assert.equal(prepared.params.negative_prompt.isInput, undefined);
  assert.equal(search.matchingNodeHandleForDrop(prepared, 'string', 'source')[0], 'prompt');
  assert.equal(JSON.stringify(node), before);
  assert.equal(search.prepareOperationConnection(node, operation, 'string', 'target'), node);
  assert.equal(search.prepareOperationConnection(node, operation, 'image', 'source'), node);
  assert.equal(search.prepareOperationConnection(prepared, operation, 'string', 'source'), prepared);
  for (const blocked of [
    { ...node.params.prompt, hidden: true },
    { ...node.params.prompt, disabled: true },
    { ...node.params.prompt, signal: { direction: 'input', value: 'review' } },
    { ...node.params.prompt, display: 'output' },
  ]) {
    const restricted = definition({ prompt: blocked });
    assert.equal(search.prepareOperationConnection(restricted, operation, 'string', 'source'), restricted);
  }
  const single = definition({ prompt: node.params.prompt });
  assert.equal(
    search.prepareOperationConnection(
      single,
      { ...operation, binding: { values: { prompt: 'bound' } } },
      'string',
      'source',
    ),
    single,
  );
  assert.equal(
    search.prepareOperationConnection(single, { ports: [{ ...operation.ports[0], hidden: true }] }, 'string', 'source'),
    single,
  );
});
