import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let search;
let interfaces;

before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  search = await server.ssrLoadModule('/src/workflow/nodeConnectionSearch.ts');
  interfaces = await server.ssrLoadModule('/src/studio/registeredBlockInterfaces.ts');
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

test('insertion preserves the discovery policy and rejects stale endpoints without choosing another socket', async () => {
  const { matchingNodeHandleForInsertion } = await server.ssrLoadModule('/src/workflow/nodeConnectionMatching.ts');
  const node = definition({ metadata: { type: 'any', display: 'input' }, image: { type: 'image', display: 'input' } });
  const origin = { handleId: 'image', node: definition({ image: { type: 'image', display: 'output' } }) };
  const selection = { dataType: 'image', handleType: 'source', origin, allowUnverified: false };
  assert.equal(matchingNodeHandleForInsertion(node, selection, origin)?.[0], 'image');
  assert.equal(matchingNodeHandleForInsertion(node, { ...selection, allowUnverified: true }, origin)?.[0], 'metadata');
  assert.equal(matchingNodeHandleForInsertion(node, selection, null), undefined);
  const stale = { ...origin, node: definition({ image: { type: 'audio', display: 'output' } }) };
  assert.equal(matchingNodeHandleForInsertion(node, selection, stale), undefined);
  const reversed = { ...origin, node: definition({ image: { type: 'image', display: 'input' } }) };
  assert.equal(matchingNodeHandleForInsertion(node, selection, reversed), undefined);
  const consumer = { handleId: 'image', node: definition({ image: { type: 'image', display: 'input' } }) };
  const producer = definition({
    metadata: { type: 'any', display: 'output' },
    image: { type: 'image', display: 'output' },
  });
  assert.equal(
    matchingNodeHandleForInsertion(producer, { ...selection, handleType: 'target', origin: consumer }, consumer)?.[0],
    'image',
  );
});

test('insertion revalidates derived Block crossing sockets using the normal connector resolver', async () => {
  const { matchingNodeHandleForInsertion } = await server.ssrLoadModule('/src/workflow/nodeConnectionMatching.ts');
  const schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const definition = JSON.parse(readFileSync('../MoDiff/tests/fixtures/block_container_interface_v1.json', 'utf8'));
  const root = runtime.createBlockRootNodeV2(
    schema.createBlockInstanceV2(definition, {
      instanceId: 'crossing-origin',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
    }),
  );
  const origin = { node: root.data, handleId: 'block-crossing:output:generate:images' };
  const target = {
    type: 'custom',
    module: 'modules.Image',
    action: 'Preview',
    params: { image: { type: 'image', display: 'input' } },
  };
  assert.equal(
    matchingNodeHandleForInsertion(
      target,
      {
        dataType: 'image',
        handleType: 'source',
        origin,
        allowUnverified: false,
      },
      origin,
    )?.[0],
    'image',
  );
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
  assert.deepEqual(keys(undefined, 'source'), []);
  assert.deepEqual(keys(undefined, 'target'), []);
  assert.deepEqual(keys(undefined, 'source', '', 'all', undefined, true), ['custom.Workbench.Input']);
  assert.deepEqual(keys(undefined, 'target', '', 'all', undefined, true), ['custom.Workbench.Output']);
  assert.deepEqual(keys(' STRING ', 'source'), ['custom.Workbench.Input']);
  assert.deepEqual(keys('image', 'source'), []);
  assert.deepEqual(keys(undefined, undefined), Object.keys(registry));
  assert.equal(JSON.stringify(registry), before);
});

test('pipeline capability signals reject task-incompatible image consumers before insertion', () => {
  const loader = {
    module: 'modules.DiffusersImage',
    action: 'LoadPipeline',
    label: 'Load Image Pipeline',
    category: 'Image',
    type: 'custom',
    params: {
      pipeline: {
        display: 'output',
        type: 'image_diffusion_pipeline',
        signal: {
          direction: 'output',
          value: {
            mode: 'text_to_image',
            actions: { Generate: ['text_to_image'] },
          },
        },
      },
    },
  };
  const taskParams = {
    pipeline: {
      display: 'input',
      type: 'image_diffusion_pipeline',
      signalCompatibility: { required: true, action: '$node' },
    },
    image_contract: { hidden: true, type: 'object' },
  };
  const generate = {
    ...definition(taskParams, 'Generate'),
    module: 'modules.DiffusersImage',
  };
  const unconditional = {
    ...definition(taskParams, 'UnconditionalGenerate'),
    module: 'modules.DiffusersImage',
  };
  const origin = { node: loader, handleId: 'pipeline' };
  assert.equal(
    search.matchingNodeHandleForDrop(generate, 'image_diffusion_pipeline', 'source', origin)?.[0],
    'pipeline',
  );
  assert.equal(
    search.matchingNodeHandleForDrop(unconditional, 'image_diffusion_pipeline', 'source', origin),
    undefined,
  );
  assert.equal(search.nodeConnectionSemanticsAreCompatible(loader, 'pipeline', unconditional, 'pipeline'), false);
});

test('declarative action contracts cover every pipeline modality and aliases without frontend module branches', () => {
  const cases = [
    ['audio_diffusion_pipeline', 'modules.AnyAudio', 'Generate', 'text_to_audio'],
    ['video_diffusion_pipeline', 'custom.VideoNodes', 'GenerateVideoAudio', 'text_to_video'],
    ['three_d_diffusion_pipeline', 'custom.ThreeDNodes', 'GenerateRenderedArtifact', 'text_to_3d'],
  ];
  for (const [type, module, action, mode] of cases) {
    const loader = definition({
      pipeline: {
        display: 'output',
        type,
        signal: { direction: 'output', value: { mode, actions: { [action]: [mode] } } },
      },
    });
    const consumer = {
      ...definition(
        {
          pipeline: {
            display: 'input',
            type,
            signalCompatibility: { required: true, action: '$node' },
          },
        },
        action,
      ),
      module,
    };
    assert.equal(search.nodeConnectionSemanticsAreCompatible(loader, 'pipeline', consumer, 'pipeline'), true);
    loader.params.pipeline.signal.value.actions = { DifferentAction: [mode] };
    assert.equal(search.nodeConnectionSemanticsAreCompatible(loader, 'pipeline', consumer, 'pipeline'), false);
  }
});

test('strict signal allowlists reject broad same-type producers without semantic identity', () => {
  const genericLoader = definition({
    model: { display: 'output', type: 'diffusers_auto_model', connectionRole: 'denoiser' },
  });
  const reviewedLoader = definition({
    model: {
      display: 'output',
      type: 'diffusers_auto_model',
      connectionRole: 'denoiser',
      signal: { direction: 'output', value: 'StableDiffusionXLModularPipeline' },
    },
  });
  const denoise = definition(
    {
      unet: {
        display: 'input',
        type: 'diffusers_auto_model',
        signalCompatibility: {
          required: true,
          role: 'denoiser',
          values: { StableDiffusionXLModularPipeline: ['denoise'] },
        },
      },
    },
    'Denoise',
  );
  assert.equal(search.nodeConnectionSemanticsAreCompatible(genericLoader, 'model', denoise, 'unet'), false);
  assert.equal(search.nodeConnectionSemanticsAreCompatible(reviewedLoader, 'model', denoise, 'unet'), true);
  reviewedLoader.params.model.connectionRole = 'scheduler';
  assert.equal(search.nodeConnectionSemanticsAreCompatible(reviewedLoader, 'model', denoise, 'unet'), false);
  reviewedLoader.params.model.connectionRole = 'denoiser';
  reviewedLoader.params.model.signal.value = 'ZImageModularPipeline';
  assert.equal(search.nodeConnectionSemanticsAreCompatible(reviewedLoader, 'model', denoise, 'unet'), false);
});

test('signal-driven option contracts exclude incompatible component modifiers for built-in and custom nodes', () => {
  const loader = definition(
    {
      scheduler: {
        display: 'output',
        type: 'diffusers_auto_model',
        connectionRole: 'scheduler',
        signal: { direction: 'output', value: 'ZImageModularPipeline' },
      },
    },
    'LoadModels',
  );
  const scheduler = definition(
    {
      scheduler_in: {
        display: 'input',
        type: 'diffusers_auto_model',
        onSignal: {
          action: 'value',
          target: 'scheduler',
          prop: 'options',
          data: { StableDiffusionXLModularPipeline: ['EulerDiscreteScheduler'] },
        },
        signalCompatibility: {
          required: true,
          role: 'scheduler',
          values: { StableDiffusionXLModularPipeline: ['EulerDiscreteScheduler'] },
        },
      },
      scheduler: { type: 'string', value: 'EulerDiscreteScheduler' },
    },
    'Scheduler',
  );
  const origin = { node: loader, handleId: 'scheduler' };

  assert.equal(search.matchingNodeHandleForDrop(scheduler, 'diffusers_auto_model', 'source', origin), undefined);
  assert.equal(search.nodeConnectionSemanticsAreCompatible(loader, 'scheduler', scheduler, 'scheduler_in'), false);

  loader.params.scheduler.signal.value = 'StableDiffusionXLModularPipeline';
  assert.equal(
    search.matchingNodeHandleForDrop(scheduler, 'diffusers_auto_model', 'source', origin)?.[0],
    'scheduler_in',
  );
  assert.equal(search.nodeConnectionSemanticsAreCompatible(loader, 'scheduler', scheduler, 'scheduler_in'), true);

  const guider = definition(
    {
      guider_out: {
        display: 'output',
        type: 'custom_guider',
        onSignal: {
          action: 'value',
          target: 'guider',
          prop: 'options',
          data: { StableDiffusionXLModularPipeline: ['ClassifierFreeGuidance'] },
        },
      },
    },
    'Guider',
  );
  const downstream = definition(
    {
      guider: {
        display: 'input',
        type: 'custom_guider',
        signal: { direction: 'input', value: 'ZImageModularPipeline' },
      },
    },
    'Denoise',
  );
  assert.equal(search.nodeConnectionSemanticsAreCompatible(guider, 'guider_out', downstream, 'guider'), false);
  downstream.params.guider.signal.value = 'StableDiffusionXLModularPipeline';
  assert.equal(search.nodeConnectionSemanticsAreCompatible(guider, 'guider_out', downstream, 'guider'), true);
});

test('connection ranking puts the likely media sink/source first and keeps stable ties', () => {
  const process = definition({ image: { display: 'input', type: 'image' } }, 'Invert');
  const preview = {
    ...definition({ image: { display: 'input', type: 'image' } }, 'Preview'),
    module: 'modules.Image',
  };
  const load = {
    ...definition({ image: { display: 'output', type: 'image' } }, 'Load'),
    module: 'modules.Image',
  };
  const entries = [
    { key: 'modules.Color.Invert', label: 'Invert Colors', node: process },
    { key: 'modules.Image.Preview', label: 'Preview Image', node: preview },
  ];
  assert.equal(search.rankConnectionSearchEntries(entries, 'image', 'source')[0].key, 'modules.Image.Preview');
  assert.equal(
    search.rankConnectionSearchEntries(
      [...entries, { key: 'modules.Image.Load', label: 'Load Image', node: load }],
      'image',
      'target',
    )[0].key,
    'modules.Image.Load',
  );
  assert.deepEqual(
    search.rankConnectionSearchEntries(entries, 'image', undefined).map((entry) => entry.key),
    entries.map((entry) => entry.key),
  );
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
    '',
    'all',
    undefined,
    true,
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

const publicInterface = () => ({
  catalogDefinitionId: 'catalog-task',
  catalogDefinitionContentHash: 'source-hash',
  admissionId: 'admission',
  compiledDefinitionContentHash: 'compiled-hash',
  compiledDefinitionCanonicalSha256: `sha256:${'a'.repeat(64)}`,
  inputs: [{ portId: 'value', valueType: ['str', 'int'] }],
  outputs: [{ portId: 'value', valueType: 'image' }],
});
const interfaceIndex = (entry = publicInterface()) => ({ schemaVersion: 1, error: false, entries: [entry] });
const interfaceRoute = () => {
  const entry = publicInterface();
  return {
    definitionId: entry.catalogDefinitionId,
    definitionContentHash: entry.catalogDefinitionContentHash,
    admissionId: entry.admissionId,
    compiledDefinitionContentHash: entry.compiledDefinitionContentHash,
    compiledDefinitionCanonicalSha256: entry.compiledDefinitionCanonicalSha256,
  };
};

test('compiled interface suggestions preserve directions and aliases and require all route pins', () => {
  const entries = interfaces.parseRegisteredBlockInterfaces(interfaceIndex());
  const route = interfaceRoute();
  const node = interfaces.registeredBlockInterfaceNode(entries, route);
  assert.ok(search.matchingNodeHandleForDrop(node, 'string', 'source'));
  assert.ok(search.matchingNodeHandleForDrop(node, 'integer', 'source'));
  assert.ok(search.matchingNodeHandleForDrop(node, 'image', 'target'));
  assert.equal(search.matchingNodeHandleForDrop(node, 'image', 'source'), undefined);
  assert.equal(search.matchingNodeHandleForDrop(node, 'string', 'target'), undefined);
  for (const key of Object.keys(route)) {
    assert.equal(interfaces.registeredBlockInterfaceNode(entries, { ...route, [key]: 'stale' }), null, key);
  }
  assert.equal(interfaces.registeredBlockInterfaceNode([], route), null);
});

test('interface index rejects malformed, oversized, duplicate and extra executable data', () => {
  for (const modify of [
    (index) => {
      index.error = true;
    },
    (index) => {
      index.schemaVersion = 2;
    },
    (index) => {
      index.graph = {};
    },
    (index) => {
      index.entries.push(structuredClone(index.entries[0]));
    },
    (index) => {
      index.entries[0].inputs.push(index.entries[0].inputs[0]);
    },
    (index) => {
      index.entries[0].inputs[0].valueType = [];
    },
    (index) => {
      index.entries[0].inputs[0].portId = 'bad\u0000id';
    },
    (index) => {
      index.entries[0].outputs[0].valueType = { code: 'unsafe' };
    },
    (index) => {
      index.entries[0].outputs[0].binding = {};
    },
    (index) => {
      index.entries[0].compiledDefinitionCanonicalSha256 = 'bad';
    },
    (index) => {
      index.entries[0].graph = {};
    },
    (index) => {
      index.entries[0].inputs = Array.from({ length: 513 }, (_, n) => ({ portId: `${n}`, valueType: 'image' }));
    },
  ]) {
    const index = interfaceIndex();
    modify(index);
    assert.throws(() => interfaces.parseRegisteredBlockInterfaces(index), /Invalid registered Block interface index/);
  }
});

test('every shipped compiled catalog interface agrees with the frontend route and connector types', async () => {
  const { REGISTERED_BLOCK_V2_ROUTES } = await server.ssrLoadModule('/src/studio/registeredBlockV2Routes.ts');
  const catalog = JSON.parse(
    gunzipSync(readFileSync(new URL('../../MoDiff/modiff/registered_block_v2_catalog.v1.json.gz', import.meta.url))),
  );
  const entries = catalog.entries.map((entry) => ({
    catalogDefinitionId: entry.catalogDefinitionId,
    catalogDefinitionContentHash: entry.catalogDefinitionContentHash,
    admissionId: entry.admissionId,
    compiledDefinitionContentHash: entry.definition.contentHash,
    compiledDefinitionCanonicalSha256: entry.compiledDefinitionCanonicalSha256,
    inputs: entry.definition.boundary.inputs.map(({ portId, valueType }) => ({ portId, valueType })),
    outputs: entry.definition.boundary.outputs.map(({ portId, valueType }) => ({ portId, valueType })),
  }));
  const parsed = interfaces.parseRegisteredBlockInterfaces({ schemaVersion: 1, error: false, entries });
  assert.equal(parsed.length, REGISTERED_BLOCK_V2_ROUTES.length);
  for (const route of REGISTERED_BLOCK_V2_ROUTES) {
    const node = interfaces.registeredBlockInterfaceNode(parsed, route);
    assert.ok(node, route.definitionId);
    const entry = parsed.find(
      (entry) => entry.admissionId === route.admissionId && entry.catalogDefinitionId === route.definitionId,
    );
    for (const [direction, ports] of [
      ['source', entry.inputs],
      ['target', entry.outputs],
    ]) {
      for (const port of ports)
        assert.ok(
          search.matchingNodeHandleForDrop(node, port.valueType, direction),
          `${route.definitionId}:${direction}:${port.portId}`,
        );
    }
  }
});
