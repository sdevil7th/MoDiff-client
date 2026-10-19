import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, authoring, groups, guidance, shared, adapters, runtime;
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
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  authoring = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  guidance = await server.ssrLoadModule('/src/workflow/guidanceNodeFields.ts');
  shared = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
  adapters = await server.ssrLoadModule('/src/workflow/modelSetupAdapters.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
});
after(async () => server?.close());

function ordinaryImage({ task = 'text_to_image', withGuidance = true } = {}) {
  const pipelineClass = 'FutureImagePipeline';
  const field = (type, display, value) => ({ type, display, ...(value === undefined ? {} : { value }) });
  const stage = (id, action, nodeType, params) => ({
    node: { type: 'custom', module: 'modules.Test', action, label: action, category: 'Test', params },
    operation: {
      pipelineClass,
      task,
      operationId: `diffusion.${id}`,
      nodeKey: `modules.Test.${action}`,
      nodeType,
      blockName: ['loader', 'guidance'].includes(nodeType) ? null : nodeType,
      decomposition: nodeType === 'loader' ? 'loader' : nodeType === 'guidance' ? 'bundle' : 'block',
      support: 'declared',
      workflowId: task,
      binding: { pipelineClass, values: {} },
      ports: Object.entries(params).map(([name, param]) => ({
        name,
        semanticName: name,
        direction: param.display === 'output' ? 'output' : 'input',
        roles: ['value'],
        types: [param.type],
        required: false,
        hidden: false,
        semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
      })),
    },
  });
  const nodes = [
    stage('load_models', 'LoadModels', 'loader', {
      models: field('models', 'output'),
      lora_list: field('custom_lora', 'input'),
    }),
    stage('encode_prompt', 'EncodePrompt', 'text_encoder', {
      models: field('models', 'input'),
      prompt: field('string', 'textarea', 'An authored prompt'),
      seed: field('int', 'number', 42),
      guider: field('custom_guider', 'input'),
      embeddings: field('embeddings', 'output'),
    }),
    stage('denoise', 'Denoise', 'denoise', {
      models: field('models', 'input'),
      embeddings: field('embeddings', 'input'),
      guider: field('custom_guider', 'input'),
      seed: field('int', 'number', 42),
      latents: field('latents', 'output'),
    }),
    stage('decode_latents', 'DecodeLatents', 'decoder', {
      models: field('models', 'input'),
      latents: field('latents', 'input'),
      images: field('image', 'output'),
    }),
  ];
  if (withGuidance)
    nodes.push(
      stage('guidance', 'Guider', 'guidance', {
        enabled: { type: 'boolean', value: false },
        use_original_formulation: { type: 'boolean', value: true },
        guidance_scale: { type: 'float', display: 'slider', value: 4, min: 0, max: 20 },
        guider: { type: 'string', value: 'ClassifierFreeGuidance', onChange: 'updateNode' },
        guider_out: field('custom_guider', 'output'),
      }),
    );
  const edges = [
    ...['encode_prompt', 'denoise', 'decode_latents'].map((id) => ({
      source: 'diffusion.load_models',
      sourceHandle: 'models',
      target: `diffusion.${id}`,
      targetHandle: 'models',
    })),
    {
      source: 'diffusion.encode_prompt',
      sourceHandle: 'embeddings',
      target: 'diffusion.denoise',
      targetHandle: 'embeddings',
    },
    {
      source: 'diffusion.denoise',
      sourceHandle: 'latents',
      target: 'diffusion.decode_latents',
      targetHandle: 'latents',
    },
    ...(withGuidance
      ? ['encode_prompt', 'denoise'].map((id) => ({
          source: 'diffusion.guidance',
          sourceHandle: 'guider_out',
          target: `diffusion.${id}`,
          targetHandle: 'guider',
        }))
      : []),
  ];
  const graph = authoring.createOperationStarter(
    {
      pipelineClass,
      task,
      workflowId: task,
      nodes,
      edges,
      requiredInputs: [],
      upstreamBlocks: [],
      sharedInputs: [
        {
          name: 'seed',
          members: [
            { operationId: 'diffusion.encode_prompt', field: 'seed' },
            { operationId: 'diffusion.denoise', field: 'seed' },
          ],
        },
      ],
    },
    { x: 0, y: 0 },
  );
  graph.nodes.push({
    id: 'preview-image',
    type: 'custom',
    position: { x: 1600, y: 0 },
    data: {
      module: 'modules.Image',
      action: 'Preview',
      label: 'Preview Image',
      category: 'Image',
      params: {
        image: field('image', 'input'),
        preview: field('image', 'ui_image', '@data/outputs/retained.webp'),
      },
    },
  });
  graph.edges.push({
    id: 'preview-wire',
    source: graph.nodes.find((n) => n.data.action === 'DecodeLatents').id,
    sourceHandle: 'images',
    target: 'preview-image',
    targetHandle: 'image',
  });
  return graph;
}

test('fresh native image presents four real stages and keeps guidance, preview and shared seeds', () => {
  const ordinary = ordinaryImage();
  const before = structuredClone(ordinary);
  const graph = groups.groupNewOperationGraph(ordinary);
  assert.deepEqual(graph.nodes.map((n) => n.data.label).sort(), [
    'Denoise',
    'Encode Inputs',
    'Image Output',
    'Model Setup',
  ]);
  assert.deepEqual(ordinary, before, 'creation cannot mutate its input graph');
  const flat = groups.unpackVisualOperationGroups(graph).graph;
  assert.equal(flat.nodes.length, ordinary.nodes.length);
  assert.equal(flat.edges.length, ordinary.edges.length);
  const input = graph.nodes.find((n) => groups.visualOperationGroup(n) === 'inputs');
  assert.deepEqual(
    guidance
      .guidanceFields(input.data.blockInstanceV2)
      .map((f) => f.field)
      .sort(),
    ['enabled', 'guidance_scale', 'guider', 'use_original_formulation'],
  );
  assert.ok(input.data.blockInstanceV2.effectiveInterface.controls.some((c) => c.binding.fieldId === 'enabled'));
  assert.equal(
    guidance.guidanceFields(input.data.blockInstanceV2).find((f) => f.field === 'enabled').param.value,
    false,
  );
  const encoder = flat.nodes.find((n) => n.data.action === 'EncodePrompt');
  const owner = flat.nodes.find((n) => n.data.action === 'LoadModels');
  assert.equal(shared.sharedOperationInput(flat.nodes, flat.edges, encoder.id, 'seed').members.length, 2);
  assert.equal(encoder.data.operationAuthoring.sharedInputs[0].loaderId, owner.id);
  assert.equal(
    flat.nodes.find((n) => n.data.action === 'Preview').data.params.preview.value,
    '@data/outputs/retained.webp',
  );
});

test('unsupported guidance leaves no empty section; audio retains its existing separate presentation', () => {
  const image = groups.groupNewOperationGraph(ordinaryImage({ withGuidance: false }));
  assert.equal(image.nodes.length, 4);
  const inputs = image.nodes.find((n) => groups.visualOperationGroup(n) === 'inputs');
  assert.deepEqual(guidance.guidanceFields(inputs.data.blockInstanceV2), []);
  const audio = groups.groupNewOperationGraph(ordinaryImage({ task: 'text_to_audio' }));
  assert.ok(audio.nodes.some((n) => groups.visualOperationGroup(n) === 'guidance'));
  assert.ok(!audio.nodes.some((n) => ['setup', 'output'].includes(groups.visualOperationGroup(n))));
});

test('combined presentation survives Guidance capability removal and return; legacy separate groups stay separate', () => {
  const combined = groups.groupNewOperationGraph(ordinaryImage());
  const original = groups.unpackVisualOperationGroups(combined);
  const guider = original.graph.nodes.find((node) => node.data.action === 'Guider');
  const without = {
    nodes: original.graph.nodes.filter((node) => node.id !== guider.id),
    edges: original.graph.edges.filter((edge) => edge.source !== guider.id && edge.target !== guider.id),
  };
  const absent = groups.restoreVisualOperationGroups(without, original);
  assert.equal(
    guidance.guidanceFields(
      absent.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs').data.blockInstanceV2,
    ).length,
    0,
  );
  const projected = groups.unpackVisualOperationGroups(absent);
  const returned = groups.restoreVisualOperationGroups(
    {
      nodes: [...projected.graph.nodes, guider],
      edges: [...projected.graph.edges, ...original.graph.edges.filter((edge) => edge.source === guider.id)],
    },
    projected,
  );
  assert.equal(returned.nodes.length, 4);
  assert.equal(
    guidance.guidanceFields(
      returned.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs').data.blockInstanceV2,
    ).length,
    4,
  );
  const legacy = ordinaryImage();
  const owner = legacy.nodes.find((node) => node.data.action === 'LoadModels');
  const separate = groups.groupOperationStages(legacy, owner.id);
  const roundtrip = groups.restoreVisualOperationGroups(
    groups.unpackVisualOperationGroups(separate).graph,
    groups.unpackVisualOperationGroups(separate),
  );
  assert.ok(roundtrip.nodes.some((node) => groups.visualOperationGroup(node) === 'guidance'));
  assert.equal(
    guidance.guidanceFields(
      roundtrip.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs').data.blockInstanceV2,
    ).length,
    0,
  );
});

test('explicit Combine retains Guidance values, sealed labels, removed controls and immutable old definitions', () => {
  const ordinary = ordinaryImage();
  const owner = ordinary.nodes.find((node) => node.data.action === 'LoadModels');
  const graph = groups.groupOperationStages(ordinary, owner.id);
  const guide = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'guidance');
  const instance = guide.data.blockInstanceV2;
  const controls = instance.effectiveInterface.controls
    .filter((control) => control.binding.fieldId !== 'use_original_formulation')
    .map((control, order) => ({
      ...control,
      order,
      ...(control.binding.fieldId === 'enabled' ? { label: 'Authored activation', sealed: true } : {}),
    }));
  const customized = runtime.replaceBlockEffectiveInterfaceV2(instance, {
    boundary: instance.effectiveInterface.boundary,
    controls,
  });
  graph.nodes = graph.nodes.map((node) => (node.id === guide.id ? runtime.createBlockRootNodeV2(customized) : node));
  const before = structuredClone(graph);
  const combined = groups.combineOperationInputStages(graph, owner.id);
  assert.deepEqual(graph, before);
  assert.equal(combined.nodes.length, before.nodes.length - 1);
  assert.ok(!combined.nodes.some((node) => groups.visualOperationGroup(node) === 'guidance'));
  const input = combined.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs');
  const enabled = input.data.blockInstanceV2.effectiveInterface.controls.find(
    (control) => control.binding.fieldId === 'enabled',
  );
  assert.equal(enabled.label, 'Authored activation');
  assert.equal(enabled.sealed, true);
  assert.ok(
    !input.data.blockInstanceV2.effectiveInterface.controls.some(
      (control) => control.binding.fieldId === 'use_original_formulation',
    ),
  );
  assert.equal(
    guidance.guidanceFields(input.data.blockInstanceV2).find((item) => item.field === 'enabled').param.value,
    false,
  );
  const flat = groups.unpackVisualOperationGroups(combined).graph;
  assert.equal(flat.nodes.length, ordinary.nodes.length);
  assert.equal(flat.edges.length, ordinary.edges.length);
});

function adapterRegistry(native = true) {
  return {
    [native ? 'modules.ModularDiffusers.Lora' : 'modules.DiffusersImage.LoadAdapter']: {
      type: 'custom',
      module: native ? 'modules.ModularDiffusers' : 'modules.DiffusersImage',
      action: native ? 'Lora' : 'LoadAdapter',
      label: 'LoRA',
      category: 'Models',
      params: {
        model: { type: 'string', display: 'model', label: 'Adapter model' },
        scale: { type: 'float', display: 'slider', label: 'Adapter scale', default: 1, min: 0, max: 2, isInput: true },
        revision: { type: 'string', display: 'text' },
        expected_sha256: { type: 'string', display: 'text' },
        weight_name: { type: 'string', display: 'text' },
        ...(native
          ? {
              previous_loras: { type: 'custom_lora', display: 'input' },
              lora: { type: 'custom_lora', display: 'output' },
            }
          : {
              pipeline: { type: 'pipeline', display: 'input' },
              output: { type: 'pipeline', display: 'output' },
              replace_existing: { type: 'boolean', display: 'checkbox', default: true },
            }),
      },
    },
  };
}
const localAdapter = (value) => ({ model: { source: 'local', value }, scale: 0.75 });
// These tests exercise graph preservation with a synthetic backend declaration;
// the independent authority suite uses actual selected backend image schemas.
function adapterImage() {
  const graph = ordinaryImage();
  const owner = graph.nodes.find((node) => node.data.action === 'LoadModels');
  Object.assign(owner.data.params, {
    model_type: { type: 'string', value: 'FutureImagePipeline' },
    pipeline_class: { type: 'string', value: 'FutureImagePipeline' },
    repo_id: { type: 'string', display: 'model', value: { source: 'hub', value: 'reviewed/image' } },
    model_id: { type: 'string', display: 'model', value: { source: 'hub', value: 'reviewed/image' } },
    revision: { type: 'string', value: 'a'.repeat(40) },
    execution_profile_id: { type: 'string', value: 'future-image:reviewed' },
  });
  return graph;
}
function planAdapterEdit(graph, rootId, edit) {
  if (edit.kind === 'remove') return adapters.planModelSetupAdapterEdit(graph, rootId, edit);
  const chain = adapters.modelSetupAdapterChain(graph, rootId);
  const operation = chain.owner.data.operationAuthoring.operation;
  const key = `${chain.owner.data.module}.${chain.owner.data.action}`;
  const registry = {
    ...Object.fromEntries(chain.adapters.map((node) => [`${node.data.module}.${node.data.action}`, node.data])),
    ...edit.registry,
    [key]: structuredClone(chain.owner.data),
  };
  const authority = {
    nodesRegistry: registry,
    studioModelCapabilitiesAuthoritative: true,
    studioExecutionSpecInvalid: false,
    discoveryRequests: { nodes: { status: 'success' }, capabilities: { status: 'success' } },
    operationContracts: [operation],
    pipelineSupport: [
      {
        pipelineClass: operation.pipelineClass,
        tasks: [
          {
            task: operation.task,
            operationIds: [operation.operationId],
            executionProfileIds: ['future-image:reviewed'],
          },
        ],
      },
    ],
    studioModelCapabilities: [
      {
        modelType: operation.pipelineClass,
        defaultRepo: 'reviewed/image',
        supportsLora: true,
        revisionCandidates: ['a'.repeat(40)],
        executionProfiles: [
          {
            id: 'future-image:reviewed',
            pipeline_class: operation.pipelineClass,
            model_type: operation.pipelineClass,
            loader_module: chain.owner.data.module,
            loader_action: chain.owner.data.action,
            default_repo: 'reviewed/image',
            repository_revisions: [{ repo: 'reviewed/image', revision: 'a'.repeat(40) }],
            modes: ['text_to_image'],
          },
        ],
      },
    ],
  };
  return adapters.planModelSetupAdapterEdit(graph, rootId, { ...edit, registry }, authority);
}

test('adapter Add rejects blank/mutable Hub selections before insertion and uses declared sockets', () => {
  const graph = groups.groupNewOperationGraph(adapterImage());
  const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
  const before = structuredClone(graph);
  const registry = adapterRegistry();
  assert.throws(() => planAdapterEdit(graph, root.id, { kind: 'add', values: {}, registry }), /Select a Hub or local/);
  assert.throws(
    () =>
      planAdapterEdit(graph, root.id, {
        kind: 'add',
        values: { model: { source: 'hub', value: 'owner/lora' } },
        registry,
      }),
    /commit revision/,
  );
  assert.throws(
    () =>
      planAdapterEdit(graph, root.id, {
        kind: 'add',
        values: {
          model: { source: 'hub', value: 'owner/lora' },
          revision: 'a'.repeat(40),
          expected_sha256: 'b'.repeat(64),
          weight_name: '../adapter.safetensors',
        },
        registry,
      }),
    /contained/,
  );
  const invalid = structuredClone(registry);
  invalid['modules.ModularDiffusers.Lora'].params.lora.type = 'image';
  assert.throws(
    () =>
      planAdapterEdit(graph, root.id, {
        kind: 'add',
        values: localAdapter('@models/lora/one.safetensors'),
        registry: invalid,
      }),
    /compatible chain sockets/,
  );
  assert.deepEqual(graph, before);
});

test('owned native adapters add, reorder and remove without losing scale wires or a shared external prefix', () => {
  const ordinary = adapterImage();
  const owner = ordinary.nodes.find((node) => node.data.action === 'LoadModels');
  const registry = adapterRegistry();
  const prefix = {
    id: 'shared-adapter',
    type: 'custom',
    position: { x: -400, y: 0 },
    data: structuredClone(registry['modules.ModularDiffusers.Lora']),
  };
  prefix.data.params.model.value = { source: 'local', value: '@models/lora/shared.safetensors' };
  const sink = {
    id: 'external-consumer',
    type: 'custom',
    position: { x: -400, y: 400 },
    data: {
      module: 'modules.Test',
      action: 'OtherConsumer',
      params: { adapters: { type: 'custom_lora', display: 'input' } },
    },
  };
  ordinary.nodes.push(prefix, sink);
  ordinary.edges.push(
    { id: 'shared-owner', source: prefix.id, sourceHandle: 'lora', target: owner.id, targetHandle: 'lora_list' },
    { id: 'shared-other', source: prefix.id, sourceHandle: 'lora', target: sink.id, targetHandle: 'adapters' },
  );
  let graph = groups.groupNewOperationGraph(ordinary);
  const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
  assert.ok(
    graph.nodes.some((node) => node.id === prefix.id),
    'shared descriptors stay external',
  );
  for (const path of ['one', 'two'])
    graph = planAdapterEdit(graph, root.id, {
      kind: 'add',
      values: localAdapter(`@models/lora/${path}.safetensors`),
      registry,
    });
  const original = adapters.modelSetupAdapterChain(graph, root.id);
  assert.equal(original.adapters.length, 2);
  const scaleNode = {
    id: 'scale-supplier',
    type: 'custom',
    position: { x: 0, y: 700 },
    data: { module: 'modules.Test', action: 'Scale', params: { value: { type: 'float', display: 'output' } } },
  };
  const flat = original.unpacked.graph;
  flat.nodes.push(scaleNode);
  flat.edges.push({
    id: 'scale-wire',
    source: scaleNode.id,
    sourceHandle: 'value',
    target: original.adapters[0].id,
    targetHandle: 'scale',
  });
  graph = groups.restoreVisualOperationGroups(flat, original.unpacked);
  graph = planAdapterEdit(graph, root.id, {
    kind: 'move',
    nodeId: original.adapters[1].id,
    offset: -1,
  });
  const reordered = adapters.modelSetupAdapterChain(graph, root.id);
  assert.deepEqual(
    reordered.adapters.map((node) => node.data.params.model.value.value),
    ['@models/lora/two.safetensors', '@models/lora/one.safetensors'],
  );
  assert.ok(
    reordered.unpacked.graph.edges.some((edge) => edge.id === 'scale-wire' && edge.target === original.adapters[0].id),
  );
  assert.ok(reordered.unpacked.graph.edges.some((edge) => edge.id === 'shared-other' && edge.source === prefix.id));
  const instance = graph.nodes.find((node) => node.id === root.id).data.blockInstanceV2;
  const control = instance.effectiveInterface.controls.find(
    (item) => item.binding.fieldId === 'model' && `${root.id}/${item.binding.nodeId}` === original.adapters[0].id,
  );
  const sealed = runtime.replaceBlockEffectiveInterfaceV2(instance, {
    boundary: instance.effectiveInterface.boundary,
    controls: instance.effectiveInterface.controls.map((item) => (item === control ? { ...item, sealed: true } : item)),
  });
  const sealedGraph = {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === root.id ? runtime.createBlockRootNodeV2(sealed) : node)),
  };
  assert.throws(
    () => planAdapterEdit(sealedGraph, root.id, { kind: 'remove', nodeId: original.adapters[0].id }),
    /sealed/,
  );
  for (const node of reordered.adapters) graph = planAdapterEdit(graph, root.id, { kind: 'remove', nodeId: node.id });
  const final = adapters.modelSetupAdapterChain(graph, root.id);
  assert.equal(final.adapters.length, 0);
  assert.equal(final.prefix.source, prefix.id);
  assert.ok(final.unpacked.graph.edges.some((edge) => edge.id === 'shared-other'));
  assert.ok(final.unpacked.graph.nodes.some((node) => node.id === scaleNode.id));
});

test('whole-pipeline adapter chains use the same graph edits and reject replacement that would unload prior rows', () => {
  const ordinary = adapterImage();
  const owner = ordinary.nodes.find((node) => node.data.action === 'LoadModels');
  delete owner.data.params.lora_list;
  owner.data.params.pipeline = { type: 'pipeline', display: 'output' };
  const denoise = ordinary.nodes.find((node) => node.data.action === 'Denoise');
  denoise.data.params.pipeline = { type: 'pipeline', display: 'input' };
  ordinary.edges.push({
    id: 'direct-pipeline',
    source: owner.id,
    sourceHandle: 'pipeline',
    target: denoise.id,
    targetHandle: 'pipeline',
  });
  let graph = groups.groupNewOperationGraph(ordinary);
  const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
  const registry = adapterRegistry(false);
  graph = planAdapterEdit(graph, root.id, {
    kind: 'add',
    values: localAdapter('@models/lora/one.safetensors'),
    registry,
  });
  assert.throws(
    () =>
      planAdapterEdit(graph, root.id, {
        kind: 'add',
        values: localAdapter('@models/lora/two.safetensors'),
        registry,
      }),
    /Only the first adapter/,
  );
  graph = planAdapterEdit(graph, root.id, {
    kind: 'add',
    values: { ...localAdapter('@models/lora/two.safetensors'), replace_existing: false },
    registry,
  });
  const chain = adapters.modelSetupAdapterChain(graph, root.id);
  assert.equal(chain.adapters.length, 2);
  assert.throws(
    () => planAdapterEdit(graph, root.id, { kind: 'move', nodeId: chain.adapters[0].id, offset: 1 }),
    /Only the first adapter/,
  );
  for (const node of chain.adapters) graph = planAdapterEdit(graph, root.id, { kind: 'remove', nodeId: node.id });
  const final = adapters.modelSetupAdapterChain(graph, root.id);
  assert.equal(final.adapters.length, 0);
  assert.equal(final.prefix.source, final.owner.id);
  assert.equal(final.tail[0].target, denoise.id);
});

test('backend-declared auxiliary guidance without an operation hint joins Inputs through its exclusive typed owner wires', () => {
  const graph = ordinaryImage(),
    guider = graph.nodes.find((node) => node.data.action === 'Guider');
  delete guider.data.operationAuthoring;
  guider.data.studioRole = 'guider';
  const grouped = groups.groupNewOperationGraph(graph);
  assert.equal(grouped.nodes.length, 4);
  const inputs = grouped.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs');
  assert.ok(inputs.data.blockInstanceV2.effectiveGraph.nodes.some((node) => node.data.studioRole === 'guider'));
  assert.ok(
    inputs.data.blockInstanceV2.effectiveInterface.controls.some(
      (control) => control.binding.fieldId === 'guidance_scale',
    ),
  );
});
for (const [name, change] of [
  [
    'missing typed output',
    (graph, node) => {
      delete node.data.params.guider_out;
    },
  ],
  [
    'wrong output type',
    (graph, node) => {
      node.data.params.guider_out.type = 'string';
    },
  ],
  [
    'nested node',
    (graph, node) => {
      node.parentId = 'custom-parent';
    },
  ],
  [
    'shared foreign owner wire',
    (graph, node) => {
      graph.edges.push({
        id: 'foreign',
        source: node.id,
        sourceHandle: 'guider_out',
        target: 'foreign-stage',
        targetHandle: 'guider',
      });
    },
  ],
])
  test(`auxiliary guidance is not adopted with ${name}`, () => {
    const graph = ordinaryImage(),
      guider = graph.nodes.find((node) => node.data.action === 'Guider');
    delete guider.data.operationAuthoring;
    guider.data.studioRole = 'guider';
    change(graph, guider);
    const grouped = groups.groupNewOperationGraph(graph);
    assert.ok(grouped.nodes.some((node) => node.id === guider.id));
  });
