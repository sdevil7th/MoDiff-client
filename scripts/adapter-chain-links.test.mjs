import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

let server, flowStore, nodesStore, studioStore, bridge, controlled, chain;
const originalFetch = globalThis.fetch;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    setTimeout,
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  flowStore = (await server.ssrLoadModule('/src/stores/useFlowStore.ts')).useFlowStore;
  nodesStore = (await server.ssrLoadModule('/src/stores/useNodeStore.ts')).useNodesStore;
  studioStore = (await server.ssrLoadModule('/src/stores/useStudioStore.ts')).useStudioStore;
  bridge = await server.ssrLoadModule('/src/studio/graphBridge.ts');
  controlled = await server.ssrLoadModule('/src/studio/controlledWorkflows.ts');
  chain = await server.ssrLoadModule('/src/studio/adapterChainLinks.ts');
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/cache');
    assert.equal(options.method, 'DELETE');
    return new Response(JSON.stringify({ error: false, nodes: JSON.parse(options.body).nodes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function nativeFixture() {
  const input = (type) => ({ type, display: 'input' });
  const output = (type) => ({ type, display: 'output' });
  const make = (id, role, module, action, params) => ({
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module,
      action,
      label: action,
      category: 'Test',
      studioOwned: true,
      studioRole: role,
      params,
    },
  });
  const nodes = [
    make('models', 'models', 'modules.ModularDiffusers', 'ModelsLoader', {
      model_type: { type: 'string', value: 'QwenImageModularPipeline' },
      repo_id: { type: 'string', value: '' },
      lora_list: input('custom_lora'),
      text_encoders: output('TextEncoders'),
      unet_out: output('DenoiseModel'),
      vae_out: output('VAE'),
      scheduler: output('Scheduler'),
    }),
    make('prompt', 'prompt', 'modules.ModularDiffusers', 'EncodePrompt', {
      text_encoders: input('TextEncoders'),
      prompt: { type: 'text', value: 'authored prompt' },
      embeddings: output('TextEmbeddings'),
    }),
    make('denoise', 'denoise', 'modules.ModularDiffusers', 'Denoise', {
      unet: input('DenoiseModel'),
      scheduler: input('Scheduler'),
      embeddings: input('TextEmbeddings'),
      latents: output('Latents'),
    }),
    make('decode', 'decode', 'modules.ModularDiffusers', 'DecodeLatents', {
      vae: input('VAE'),
      latents: input('Latents'),
      images: output('image'),
    }),
    make('preview', 'preview', 'modules.Image', 'Preview', { image: input('image') }),
  ];
  const connect = (source, sourceHandle, target, targetHandle) => ({
    id: `${source}.${sourceHandle}-${target}.${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    type: 'default',
  });
  const edges = [
    connect('models', 'text_encoders', 'prompt', 'text_encoders'),
    connect('models', 'unet_out', 'denoise', 'unet'),
    connect('models', 'scheduler', 'denoise', 'scheduler'),
    connect('models', 'vae_out', 'decode', 'vae'),
    connect('prompt', 'embeddings', 'denoise', 'embeddings'),
    connect('denoise', 'latents', 'decode', 'latents'),
    connect('decode', 'images', 'preview', 'image'),
  ];
  const form = {
    ...studioStore.getState().form,
    modelType: 'QwenImageModularPipeline',
    mode: 'text_to_image',
    resourceMode: 'expert',
    quantizationMode: 'none',
    prompt: 'authored prompt',
  };
  const binding = {
    modelType: form.modelType,
    mode: form.mode,
    nodes: Object.fromEntries(nodes.map((node) => [node.data.studioRole, node.id])),
    managedNodeIds: nodes.map((node) => node.id),
    managedEdgeIds: edges.map((edge) => edge.id),
    fingerprint: `${form.mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}`,
    createdAt: 1,
    updatedAt: 1,
  };
  const lora = make('lora-definition', 'loraAdapter', 'modules.ModularDiffusers', 'Lora', {
    previous_loras: input('custom_lora'),
    lora: output('custom_lora'),
    model: { type: 'string', value: '' },
    scale: { type: 'float', value: 1 },
    adapter_name: { type: 'string', value: '' },
  });
  nodesStore.setState({
    nodesRegistry: Object.fromEntries(
      [...nodes, lora].map((node) => [
        `${node.data.module}.${node.data.action}`,
        { ...node.data, studioOwned: undefined, studioRole: undefined },
      ]),
    ),
    studioModelCapabilities: [],
    studioModelCapabilitiesAuthoritative: false,
    studioExecutionSpecInvalid: false,
  });
  flowStore.setState({
    nodes,
    edges,
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  studioStore.setState({
    form,
    graphBinding: binding,
    graphFinalization: null,
    workflowTabs: [],
    activeWorkflowTabId: null,
    autoResourcePlan: null,
    autoFieldOverrides: {},
  });
  assert.equal(bridge.syncStudioGraphDefinition(form), true);
  assert.equal(bridge.getStudioGraphRunBlockingMessage(form), null);
  return form;
}
beforeEach(() => nativeFixture());

const settings = {
  adapterName: 'one',
  scale: 0.6,
  additionalAdapters: [
    { adapterName: 'two', scale: 0.9 },
    { adapterName: 'three', scale: 1.1 },
  ],
};
const options = { graphPrepared: true, notify: false };
const adapterNodes = () =>
  flowStore
    .getState()
    .nodes.filter((node) => node.data.studioRole?.startsWith('loraAdapter'))
    .sort(
      (a, b) =>
        (a.data.studioRole === 'loraAdapter' ? 0 : Number(a.data.studioRole.split(':')[1])) -
        (b.data.studioRole === 'loraAdapter' ? 0 : Number(b.data.studioRole.split(':')[1])),
    );

// Undo refreshes visual edge styles and derived handle connection flags. Compare
// the authored nodes, values, positions and typed wires independently of those.
const authoredGraph = () => ({
  nodes: flowStore.getState().nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      params: Object.fromEntries(
        Object.entries(node.data.params).map(([key, param]) => {
          const { isConnected: _connected, ...authored } = param;
          return [key, authored];
        }),
      ),
    },
  })),
  edges: flowStore.getState().edges.map(({ id, source, sourceHandle, target, targetHandle, type }) => ({
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    type,
  })),
});

const expectNativeChain = (adapters) => {
  const links = flowStore.getState().edges.filter((edge) => adapters.some((node) => node.id === edge.source));
  assert.deepEqual(
    links.map(({ source, sourceHandle, target, targetHandle }) => [source, sourceHandle, target, targetHandle]),
    adapters.map((adapter, index) => [
      adapter.id,
      'lora',
      adapters[index + 1]?.id ?? 'models',
      index < adapters.length - 1 ? 'previous_loras' : 'lora_list',
    ]),
  );
};

test('legacy native multi-LoRA authors the complete ordered descriptor chain and seals it atomically', async () => {
  const form = studioStore.getState().form;
  const before = structuredClone(authoredGraph());
  await controlled.addLoraWorkflowBlock(form, settings, options);
  const adapters = adapterNodes();
  assert.equal(adapters.length, 3);
  assert.deepEqual(
    adapters.map((node) => node.data.params.adapter_name.value),
    ['one', 'two', 'three'],
  );
  assert.deepEqual(
    adapters.map((node) => node.data.params.scale.value),
    [0.6, 0.9, 1.1],
  );
  expectNativeChain(adapters);
  assert.equal(bridge.getStudioGraphRunBlockingMessage(form), null);
  assert.equal(studioStore.getState().graphBinding.finalizationProof.schemaVersion, 3);
  assert.equal(flowStore.getState().historyPast.length, 1);
  flowStore.getState().undo();
  assert.deepEqual(authoredGraph(), before);
});

test('native replacement removes stale adapters and bypass links without changing creative fields', async () => {
  const form = studioStore.getState().form;
  await controlled.addLoraWorkflowBlock(form, settings, options);
  const previous = adapterNodes();
  const creativeNodes = structuredClone(
    authoredGraph().nodes.filter((node) => !node.data.studioRole.startsWith('loraAdapter')),
  );
  await controlled.addLoraWorkflowBlock(form, { adapterName: 'replacement', scale: 0.4 }, options);
  const adapters = adapterNodes();
  assert.equal(adapters.length, 1);
  assert.equal(adapters[0].id, previous[0].id);
  assert.equal(adapters[0].data.params.adapter_name.value, 'replacement');
  expectNativeChain(adapters);
  assert.equal(
    flowStore
      .getState()
      .edges.some((edge) => previous.slice(1).some((node) => node.id === edge.source || node.id === edge.target)),
    false,
  );
  assert.deepEqual(
    authoredGraph().nodes.filter((node) => !node.data.studioRole.startsWith('loraAdapter')),
    creativeNodes,
  );
  assert.equal(bridge.getStudioGraphRunBlockingMessage(form), null);
  assert.equal(flowStore.getState().historyPast.length, 2);
  flowStore.getState().undo();
  expectNativeChain(adapterNodes());
  assert.equal(adapterNodes().length, 3);
});

test('eight native adapters are sealed and a ninth is rejected without graph or history changes', async () => {
  const form = studioStore.getState().form;
  const eight = {
    adapterName: 'one',
    additionalAdapters: Array.from({ length: 7 }, (_, index) => ({ adapterName: `adapter-${index + 2}`, scale: 0.5 })),
  };
  await controlled.addLoraWorkflowBlock(form, eight, options);
  assert.equal(adapterNodes().length, 8);
  expectNativeChain(adapterNodes());
  assert.equal(bridge.getStudioGraphRunBlockingMessage(form), null);
  const before = structuredClone(authoredGraph());
  const proof = structuredClone(studioStore.getState().graphBinding.finalizationProof);
  await assert.rejects(
    controlled.addLoraWorkflowBlock(
      form,
      {
        ...eight,
        additionalAdapters: [...eight.additionalAdapters, { adapterName: 'ninth' }],
      },
      options,
    ),
    /at most 8 adapters/,
  );
  assert.deepEqual(authoredGraph(), before);
  assert.deepEqual(studioStore.getState().graphBinding.finalizationProof, proof);
  assert.equal(flowStore.getState().historyPast.length, 1);
});

test('missing typed previous_loras input rolls back the entire native authoring transaction', async () => {
  const form = studioStore.getState().form;
  const registry = structuredClone(nodesStore.getState().nodesRegistry);
  delete registry['modules.ModularDiffusers.Lora'].params.previous_loras;
  nodesStore.setState({ nodesRegistry: registry });
  const before = structuredClone(authoredGraph());
  const proof = structuredClone(studioStore.getState().graphBinding.finalizationProof);
  await assert.rejects(controlled.addLoraWorkflowBlock(form, settings, options), /connection could not be completed/);
  assert.deepEqual(authoredGraph(), before);
  assert.deepEqual(studioStore.getState().graphBinding.finalizationProof, proof);
  assert.equal(flowStore.getState().historyPast.length, 0);
  assert.equal(flowStore.getState().historyTransaction, null);
});

test('a shared owned adapter branch is preserved when legacy controlled editing is unavailable', async () => {
  const form = studioStore.getState().form;
  await controlled.addLoraWorkflowBlock(form, settings, options);
  const foreign = {
    id: 'other-loader',
    type: 'custom',
    position: { x: 800, y: 0 },
    data: {
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      params: {
        lora_list: { type: 'custom_lora', display: 'input' },
      },
    },
  };
  flowStore.setState({
    nodes: [...flowStore.getState().nodes, foreign],
    edges: [
      ...flowStore.getState().edges,
      {
        id: 'shared-adapter-output',
        source: adapterNodes()[0].id,
        sourceHandle: 'lora',
        target: foreign.id,
        targetHandle: 'lora_list',
        type: 'default',
      },
    ],
  });
  const before = structuredClone(authoredGraph());
  await assert.rejects(controlled.addLoraWorkflowBlock(form, { adapterName: 'replacement' }, options));
  assert.deepEqual(authoredGraph(), before);
  assert.equal(flowStore.getState().historyPast.length, 1);
});

test('pure ordered links handle native descriptors, external prefixes and pipeline bypasses without mutation', () => {
  const native = {
    adapterIds: ['a', 'b', 'c'],
    inputHandles: ['previous_loras'],
    outputHandles: ['lora'],
    target: { nodeId: 'loader', handles: ['lora_list', 'loras'] },
  };
  const original = structuredClone(native);
  assert.deepEqual(chain.orderedAdapterChainLinks(native), [
    { source: 'a', sourceHandles: ['lora'], target: 'b', targetHandles: ['previous_loras'] },
    { source: 'b', sourceHandles: ['lora'], target: 'c', targetHandles: ['previous_loras'] },
    { source: 'c', sourceHandles: ['lora'], target: 'loader', targetHandles: ['lora_list', 'loras'] },
  ]);
  assert.deepEqual(native, original);
  const prefix = chain.orderedAdapterChainLinks({ ...native, source: { nodeId: 'shared-prefix', handles: ['lora'] } });
  assert.deepEqual(prefix[0], {
    source: 'shared-prefix',
    sourceHandles: ['lora'],
    target: 'a',
    targetHandles: ['previous_loras'],
  });
  assert.deepEqual(chain.orderedAdapterChainLinks({ ...native, adapterIds: [] }), []);
  const pipeline = {
    adapterIds: [],
    inputHandles: ['pipeline'],
    outputHandles: ['output'],
    source: { nodeId: 'owner', handles: ['pipeline'] },
    target: { nodeId: 'consumer', handles: ['pipeline'] },
  };
  assert.deepEqual(chain.orderedAdapterChainLinks(pipeline), [
    { source: 'owner', sourceHandles: ['pipeline'], target: 'consumer', targetHandles: ['pipeline'] },
  ]);
  assert.equal(chain.orderedAdapterChainLinks({ ...pipeline, adapterIds: ['a', 'b', 'c'] }).length, 4);
  assert.throws(() => chain.orderedAdapterChainLinks({ ...native, adapterIds: ['a', 'a'] }), /distinct adapters/);
  assert.throws(
    () =>
      chain.orderedAdapterChainLinks({ ...native, adapterIds: Array.from({ length: 9 }, (_, index) => `${index}`) }),
    /at most 8/,
  );
});

test('an explicit reviewed chain bound permits 32 links without widening the legacy eight-adapter default', () => {
  const options = {
    adapterIds: Array.from({ length: 32 }, (_, index) => `adapter-${index}`),
    inputHandles: ['previous_loras'],
    outputHandles: ['lora'],
    target: { nodeId: 'loader', handles: ['lora_list'] },
  };
  const original = structuredClone(options);
  const links = chain.orderedAdapterChainLinks({ ...options, maxOwnedAdapters: 32 });
  assert.equal(links.length, 32);
  assert.equal(links[0].source, 'adapter-0');
  assert.equal(links[31].target, 'loader');
  assert.deepEqual(options, original);
  assert.throws(() => chain.orderedAdapterChainLinks(options), /at most 8/);
  assert.throws(
    () =>
      chain.orderedAdapterChainLinks({
        ...options,
        adapterIds: [...options.adapterIds, 'adapter-32'],
        maxOwnedAdapters: 32,
      }),
    /at most 32/,
  );
  for (const maxOwnedAdapters of [0, 33, -1, 1.5, NaN, Infinity, '32', null])
    assert.throws(
      () => chain.orderedAdapterChainLinks({ ...options, adapterIds: ['only'], maxOwnedAdapters }),
      /bound/,
    );
});
