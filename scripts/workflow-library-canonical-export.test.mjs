import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { sanitizeCanonicalWorkflowGraph, canonicalizeGraphIds } from './workflow-library-generator.mjs';
import { retainExistingCanonicalDeviceDefaults } from './workflow-library-contract.mjs';
import { canonicalGraphIdentity } from './live-proof-provenance.mjs';
import { selectReviewedExperimentalWorkflows } from './workflow-library-manifest-state.mjs';

test('repeated shot processors retain only unanimous fallback defaults with unchanged multiplicity', () => {
  const make = (id, fallback) => ({
    id,
    data: {
      module: 'modules.Images',
      action: 'Upscale',
      params: { device: { value: 'cuda:0', default: fallback, options: ['cpu', 'cuda:0'] } },
    },
  });
  const original = { nodes: [make('old-a', 'cpu'), make('old-b', 'cpu')] };
  const fresh = { nodes: [make('new-b', 'cuda:0'), make('new-a', 'cuda:0')] };
  retainExistingCanonicalDeviceDefaults(fresh, original);
  assert.deepEqual(
    fresh.nodes.map((n) => n.data.params.device.default),
    ['cpu', 'cpu'],
  );
  assert.deepEqual(
    fresh.nodes.map((n) => n.data.params.device.value),
    ['cuda:0', 'cuda:0'],
  );
  assert.throws(
    () => retainExistingCanonicalDeviceDefaults({ nodes: [make('one', 'cuda:0')] }, original),
    /unambiguous/,
  );
  assert.throws(
    () => retainExistingCanonicalDeviceDefaults(fresh, { nodes: [make('a', 'cpu'), make('b', 'cuda:0')] }),
    /unambiguous/,
  );
});
import { canonicalExecutableWorkflowGraph, loadCanonicalWorkflowExpander } from './canonical-workflow-execution.mjs';

let server, hooks, flowStore, groups, blockSchema, blockRuntime, modelSetupControlParams, graphNodeControlParams;
let modelSetupControlGroupLabel;
let fixture, templates, builder, defaults, exactness, operations;
let requests;
let shared;
const ids = ['qwen_text_rendering', 'cosmos3_super_text_to_image', 'qwen_outpaint_aspect_template'];

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  const all = (await server.ssrLoadModule('/src/studio/templates.ts')).STUDIO_TEMPLATES;
  templates = ids.map((id) => all.find((item) => item.id === id));
  assert.ok(templates.every(Boolean));
  ({ useFlowStore: flowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  blockRuntime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  ({ modelSetupControlGroupLabel, modelSetupControlParams } = await server.ssrLoadModule(
    '/src/workflow/modelSetupControlPresentation.ts',
  ));
  ({ graphNodeControlParams } = await server.ssrLoadModule('/src/studio/graphNodeControls.ts'));
  shared = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
  blockSchema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  builder = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  requests = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  ({ DEFAULT_STUDIO_FORM: defaults } = await server.ssrLoadModule('/src/studio/modelProfiles.ts'));
  const e2e = await server.ssrLoadModule('/src/utils/e2eHooks.ts');
  e2e.installE2EHooks();
  hooks = window.__MODIFF_E2E__;
  assert.ok(hooks);
  const python = process.env.MODIFF_BACKEND_PYTHON;
  assert.ok(python, 'Use the declared ordinary CPU schema fixture environment.');
  fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: path.resolve('../MoDiff'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      input: JSON.stringify(templates.map((item) => ({ id: item.id, selection: item.executionSelection }))),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }),
  );
});
after(async () => server?.close());

test('pair regeneration preserves canonical device defaults without changing authored controls or identities', () => {
  const loader = (device) => ({
    id: 'loader',
    data: {
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      params: { device: { type: 'str', value: 'cuda:0', options: { 'cpu:0': {}, 'cuda:0': {} } } },
      operationAuthoring: {
        operation: { operationId: 'diffusion.load_models', binding: { values: { model_type: 'Example' } } },
        defaults: { device, dtype: 'bfloat16' },
      },
    },
  });
  const preview = (device) => ({
    id: 'preview',
    data: {
      module: 'modules.Image',
      action: 'Preview',
      params: { device: { type: 'str', default: device, options: { 'cpu:0': {}, 'cuda:0': {} } } },
    },
  });
  const original = { nodes: [loader('cpu:0'), preview('cpu:0')], edges: [] };
  const regenerated = { nodes: [preview('cuda:0'), loader('cuda:0')], edges: [] };
  const before = structuredClone(regenerated);
  const retained = retainExistingCanonicalDeviceDefaults(regenerated, original);
  assert.equal(retained.nodes[0].data.params.device.default, 'cpu:0');
  assert.equal(retained.nodes[1].data.operationAuthoring.defaults.device, 'cpu:0');
  assert.equal(retained.nodes[1].data.params.device.value, 'cuda:0', 'The authored CUDA selection is retained.');
  assert.deepEqual(
    retained.nodes[1].data.operationAuthoring.operation,
    before.nodes[1].data.operationAuthoring.operation,
  );
  assert.deepEqual(retained.nodes[1].data.params, before.nodes[1].data.params);
  assert.deepEqual(retained.nodes[0].data.params.device.options, before.nodes[0].data.params.device.options);
  assert.deepEqual(
    original.nodes.map((node) => node.id),
    ['loader', 'preview'],
    'The existing graph is not mutated.',
  );
  const changedIdentity = structuredClone(before);
  changedIdentity.nodes[1].data.operationAuthoring.operation.binding.values.model_type = 'Different';
  retainExistingCanonicalDeviceDefaults(changedIdentity, original);
  assert.equal(changedIdentity.nodes[1].data.operationAuthoring.defaults.device, 'cuda:0');
  const ambiguous = structuredClone(before);
  ambiguous.nodes.push(structuredClone(ambiguous.nodes[0]));
  assert.throws(() => retainExistingCanonicalDeviceDefaults(ambiguous, original), /unambiguous/);
  assert.deepEqual(ambiguous.nodes[0], before.nodes[0], 'A rejected migration must not partially alter defaults.');
  const incompatible = structuredClone(before);
  incompatible.nodes[0].data.params.device.options = { 'cuda:0': {} };
  assert.throws(() => retainExistingCanonicalDeviceDefaults(incompatible, original), /unavailable/);
  assert.equal(incompatible.nodes[1].data.operationAuthoring.defaults.device, 'cuda:0');
  const added = preview('cuda:0');
  added.data.action = 'NewPreview';
  const freshStage = { nodes: [added], edges: [] };
  retainExistingCanonicalDeviceDefaults(freshStage, original);
  assert.equal(added.data.params.device.default, 'cuda:0', 'New stages retain their declared fresh defaults.');
});

test('canonical sanitization preserves weight-loading selectors and existing portable device semantics', () => {
  for (const mode of ['cpu', 'cuda']) {
    const selector = {
      type: 'string',
      default: mode,
      value: mode,
      options: [
        { schemaVersion: 1, value: 'cpu', label: 'cpu', compatibility: 'compatible' },
        { schemaVersion: 1, value: 'cuda', label: 'cuda', compatibility: 'compatible' },
      ],
      fieldOptions: { controlTier: 'advanced' },
    };
    const graph = {
      nodes: [
        {
          id: 'models',
          data: {
            module: 'modules.ModularDiffusers',
            action: 'ModelsLoader',
            params: {
              weight_loading_mode: selector,
              device: { default: 'cuda:1', value: 'cuda:1', options: ['cpu:0', 'cuda:1'] },
              device_map: { default: 'cpu', value: 'cuda', options: ['cpu', 'cuda'] },
              unrelated: { value: 'cuda:1' },
            },
            operationAuthoring: { defaults: { weight_loading_mode: mode, device: 'cuda:1' } },
          },
        },
      ],
      edges: [],
    };
    const before = structuredClone(graph);
    const data = sanitizeCanonicalWorkflowGraph(graph).nodes[0].data;
    assert.deepEqual(data.params.weight_loading_mode, selector, 'Enum values/defaults/options are not device IDs.');
    assert.deepEqual(data.operationAuthoring.defaults, graph.nodes[0].data.operationAuthoring.defaults);
    assert.deepEqual(data.params.device, graph.nodes[0].data.params.device);
    assert.deepEqual(data.params.device_map, graph.nodes[0].data.params.device_map);
    assert.equal(data.params.unrelated.value, 'cpu:0', 'Existing unrelated device-token normalization is retained.');
    assert.deepEqual(graph, before, 'Canonical sanitization does not mutate the saved graph.');
  }
});

function build(id) {
  const template = templates.find((item) => item.id === id);
  const row = fixture.recipes.find((item) => item.id === id);
  const contracts = operations.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const starter = requests.parseOperationStarter(
    row.starter,
    row.starter.pipelineClass,
    row.starter.task,
    contracts,
    template.executionSelection,
  );
  const device = starter.nodes.find((item) => item.operation.decomposition === 'loader').node.params.device;
  const form = {
    ...defaults,
    ...exactness.getTemplateLockedSettings(template),
    device: device.value ?? device.default,
    autoOffload: false,
    offloadMode: 'none',
  };
  return builder.createTemplateOperationGraph(
    template,
    form,
    starter,
    fixture.registry,
    row.spec,
    fixture.capabilities.find((item) => item.modelType === template.modelType),
  );
}

function semanticApi(graph) {
  const api = flowStore
    .getState()
    .exportGraph('canonical-export-contract', undefined, { sourceGraph: graph, randomizeSeeds: false });
  const names = new Map(Object.entries(api.nodes).map(([id, node]) => [id, `${node.module}.${node.action}`]));
  assert.equal(new Set(names.values()).size, names.size, 'These independently chosen witnesses have unique actions.');
  return Object.entries(api.nodes)
    .map(([id, node]) => ({
      identity: names.get(id),
      params: Object.fromEntries(
        Object.entries(node.params).map(([key, param]) => [
          key,
          param && typeof param === 'object' && 'sourceId' in param
            ? { ...param, sourceId: names.get(param.sourceId) }
            : param,
        ]),
      ),
    }))
    .sort((a, b) => a.identity.localeCompare(b.identity));
}

test('canonical library regrouping preserves ordered executable identity for independent inputs', () => {
  const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const manifest = JSON.parse(readFileSync(path.join(backend, 'data/workflow-library-manifest.json'), 'utf8'));
  const witnesses = [
    'AceStepAudioPipeline:audio_continuation',
    'FluxCannyPipeline:control_image',
    'FluxFillPipeline:inpaint',
    'FluxReduxPipeline:multi_image_reference_edit',
  ];
  for (const id of witnesses) {
    const row = manifest.workflows.find((item) => item.id === id);
    assert.ok(row, id);
    const graph = JSON.parse(readFileSync(path.join(backend, 'data/graphs', row.graphPath), 'utf8'));
    const original = structuredClone(graph);
    const grouped = groups.groupNewOperationGraph(graph);
    const identity = (sourceGraph) =>
      canonicalGraphIdentity(
        flowStore
          .getState()
          .exportGraph('library-presentation-regression', undefined, { sourceGraph, randomizeSeeds: false }),
      );
    assert.deepEqual(identity(grouped), identity(graph), `${id}: inputs, references and execution order must survive`);
    assert.deepEqual(graph, original, `${id}: the shipped source must not be mutated`);
  }
});

test('whole-pipeline examples fold connected runtime settings into the shared Model Setup', () => {
  const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  for (const relative of [
    'studio/sana-sprint-pipeline/text-to-image.json',
    'studio/stable-diffusion-pipeline/text-to-image.json',
  ]) {
    const graph = JSON.parse(readFileSync(path.join(backend, 'data/graphs', relative), 'utf8'));
    const original = structuredClone(graph);
    const grouped = groups.groupNewOperationGraph(graph);
    const setup = grouped.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
    assert.ok(setup, relative);
    assert.deepEqual(setup.data.blockInstanceV2.effectiveGraph.nodes.map((node) => node.data.action).sort(), [
      'DiffusersExecutionRecipe',
      'LoadPipeline',
      'PipelineQuantizationConfigV2',
    ]);
    const identity = (sourceGraph) =>
      canonicalGraphIdentity(
        flowStore
          .getState()
          .exportGraph('whole-pipeline-presentation', undefined, { sourceGraph, randomizeSeeds: false }),
      );
    assert.deepEqual(identity(grouped), identity(graph));
    assert.equal(
      setup.data.blockInstanceV2.effectiveInterface.boundary.outputs.some((port) =>
        ['execution_recipe', 'quantization_config'].includes(port.binding.fieldOrPortId),
      ),
      false,
      'Connections used only inside Model Setup are not duplicate public sockets.',
    );
    const recipe = setup.data.blockInstanceV2.effectiveGraph.nodes.find(
      (node) => node.data.action === 'DiffusersExecutionRecipe',
    );
    assert.ok(
      setup.data.blockInstanceV2.effectiveInterface.controls.some(
        (control) => control.binding.nodeId === recipe.nodeId && control.binding.fieldId === 'offload_mode',
      ),
    );
    const shared = structuredClone(graph);
    shared.edges.push({
      ...shared.edges.find((edge) => edge.source === 'node-04'),
      id: 'shared-recipe',
      target: 'node-01',
      targetHandle: 'other_recipe',
    });
    const sharedSetup = groups
      .groupNewOperationGraph(shared)
      .nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
    assert.ok(sharedSetup);
    assert.deepEqual(
      sharedSetup.data.blockInstanceV2.effectiveGraph.nodes.map((node) => node.data.action),
      ['LoadPipeline'],
      'A shared supplier and its own supplier remain outside.',
    );
    const invalid = structuredClone(graph);
    invalid.nodes.find((node) => node.data.action === 'LoadPipeline').data.params.pipeline.type = 'unreviewed_pipeline';
    assert.equal(
      groups.groupNewOperationGraph(invalid).nodes.some((node) => groups.visualOperationGroup(node) === 'setup'),
      false,
    );
    assert.deepEqual(graph, original);
  }
});

test('Model Setup subsections use the bound loader caption without renaming a saved group', () => {
  const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const pathToEdit = 'data/graphs/studio/stable-diffusion-xl-pipeline/edit-image.json';
  const source = JSON.parse(readFileSync(path.join(backend, pathToEdit), 'utf8'));
  const grouped = groups.groupNewOperationGraph(source);
  const setup = grouped.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
  assert.ok(setup);
  const instance = setup.data.blockInstanceV2;
  const graph = blockRuntime.blockOperationGraphV2(instance);
  const before = structuredClone(instance);
  const title = 'Diffusers.LoadPipeline';
  const controls = instance.effectiveInterface.controls.filter((control) => control.group === title);
  assert.ok(controls.length > 0);
  assert.equal(modelSetupControlGroupLabel(title, controls, graph), 'Load Image Pipeline');
  assert.equal(modelSetupControlGroupLabel('My loader settings', controls, graph), 'My loader settings');
  const other = instance.effectiveInterface.controls.find((control) => control.group !== title);
  assert.ok(other);
  assert.equal(modelSetupControlGroupLabel(title, [...controls, other], graph), title);
  assert.deepEqual(instance, before);
  const api = (sourceGraph) =>
    canonicalGraphIdentity(
      flowStore.getState().exportGraph('model-setup-subsections', undefined, { sourceGraph, randomizeSeeds: false }),
    );
  assert.deepEqual(api(grouped), api(source));
});

test('Model Setup shows connected VAE recipe controls and retains each loader fallback', () => {
  const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const examples = [
    ['studio/ddim-pipeline/unconditional-image.json', ['slicing', 'tiling']],
    ['studio/long-cat-audio-di-t-pipeline/text-to-audio.json', ['tiling']],
  ];
  for (const [relative, modes] of examples) {
    const source = JSON.parse(readFileSync(path.join(backend, 'data/graphs', relative), 'utf8'));
    const grouped = groups.groupNewOperationGraph(source);
    const setup = grouped.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
    assert.ok(setup, relative);
    const instance = setup.data.blockInstanceV2;
    const before = structuredClone(instance);
    const graph = blockRuntime.blockOperationGraphV2(instance);
    const view = blockRuntime.blockViewModelV2(instance);
    const visible = modelSetupControlParams(instance, graph, view.controlParams);
    const inspector = graphNodeControlParams(setup);
    const disconnected = {
      ...graph,
      edges: graph.edges.filter((edge) => edge.targetHandle !== 'execution_recipe'),
    };
    const fallback = modelSetupControlParams(instance, disconnected, view.controlParams);
    const competing = {
      ...graph,
      edges: [...graph.edges, ...graph.edges.filter((edge) => edge.targetHandle === 'execution_recipe')],
    };
    const unresolved = modelSetupControlParams(instance, competing, view.controlParams);
    for (const mode of modes) {
      const direct = instance.effectiveInterface.controls.find(
        (control) => control.binding.fieldId === `enable_vae_${mode}`,
      );
      const recipe = instance.effectiveInterface.controls.find((control) => control.binding.fieldId === `vae_${mode}`);
      assert.equal(view.controlParams[direct.controlId].value ?? view.controlParams[direct.controlId].default, true);
      assert.equal(visible[recipe.controlId].value ?? visible[recipe.controlId].default, false);
      assert.equal(Object.hasOwn(visible, direct.controlId), false, relative);
      assert.equal(Object.hasOwn(inspector, direct.controlId), false, relative);
      assert.equal(inspector[recipe.controlId].label, visible[recipe.controlId].label, relative);
      assert.equal(fallback[direct.controlId], view.controlParams[direct.controlId], relative);
      assert.equal(unresolved[direct.controlId], view.controlParams[direct.controlId], relative);
      const customInterface = {
        ...instance,
        effectiveInterface: {
          ...instance.effectiveInterface,
          controls: instance.effectiveInterface.controls.map((control) =>
            control.controlId === direct.controlId ? { ...control, label: 'My fallback' } : control,
          ),
        },
      };
      assert.ok(
        modelSetupControlParams(customInterface, graph, view.controlParams)[direct.controlId],
        `${relative}: retain explicitly named controls`,
      );
    }
    assert.deepEqual(instance, before, `${relative}: render must preserve saved values, graph and interface`);
    const api = (sourceGraph) =>
      canonicalGraphIdentity(
        flowStore.getState().exportGraph('model-setup-precedence', undefined, { sourceGraph, randomizeSeeds: false }),
      );
    assert.deepEqual(api(grouped), api(source), relative);
  }
});

test('Model Setup scopes VAE precedence to each owner and distinguishes base model revision', () => {
  const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const stageControls = (relative) => {
    const source = JSON.parse(readFileSync(path.join(backend, 'data/graphs', relative), 'utf8'));
    return groups
      .groupNewOperationGraph(source)
      .nodes.filter((node) => groups.visualOperationGroup(node) === 'setup')
      .map((node) => {
        const instance = node.data.blockInstanceV2;
        const before = structuredClone(instance);
        const graph = blockRuntime.blockOperationGraphV2(instance);
        const { controlParams } = blockRuntime.blockViewModelV2(instance);
        const visible = modelSetupControlParams(instance, graph, controlParams);
        assert.deepEqual(instance, before, relative);
        return { instance, graph, controlParams, visible };
      });
  };
  const movie = stageControls('studio/wan-ti2-v-pipeline/text-to-video.json');
  assert.equal(movie.length, 2);
  const audio = movie.find(({ graph }) => graph.nodes.some((node) => node.data.module === 'modules.DiffusersAudio'));
  const video = movie.find(({ graph }) => graph.nodes.some((node) => node.data.module === 'modules.DiffusersVideo'));
  const audioFallback = audio.instance.effectiveInterface.controls.find(
    (control) => control.binding.fieldId === 'enable_vae_tiling',
  );
  assert.equal(Object.hasOwn(audio.visible, audioFallback.controlId), false);
  assert.deepEqual(video.visible, video.controlParams);

  const [adapterExample] = stageControls('studio/flux-dev-pipeline/text-to-image--flux-lora-ghibli-story.json');
  const revisionControls = adapterExample.instance.effectiveInterface.controls.filter(
    (control) => control.binding.fieldId === 'revision',
  );
  assert.equal(revisionControls.length, 2);
  assert.deepEqual(revisionControls.map(({ controlId }) => adapterExample.visible[controlId].label).sort(), [
    'Base model revision',
    'Revision',
  ]);
  assert.notEqual(...revisionControls.map(({ controlId }) => adapterExample.visible[controlId].value));
});

test('whole-pipeline video inputs combine their actual Load and Normalize operations', () => {
  const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  for (const relative of [
    'studio/cog-video-x-video-to-video-pipeline/video-to-video.json',
    'studio/animate-diff-video-to-video-pipeline/video-to-video.json',
  ]) {
    const graph = JSON.parse(readFileSync(path.join(backend, 'data/graphs', relative), 'utf8'));
    const grouped = groups.groupNewOperationGraph(graph);
    const input = grouped.nodes.find((node) => groups.visualOperationGroup(node) === 'videoInput');
    assert.ok(input, relative);
    assert.deepEqual(input.data.blockInstanceV2.effectiveGraph.nodes.map((node) => node.data.action).sort(), [
      'Load',
      'Normalize',
    ]);
    const identity = (sourceGraph) =>
      canonicalGraphIdentity(
        flowStore.getState().exportGraph('video-input-presentation', undefined, { sourceGraph, randomizeSeeds: false }),
      );
    assert.deepEqual(identity(grouped), identity(graph));
    const shared = structuredClone(graph);
    const loader = shared.nodes.find((node) => node.data.module === 'modules.Video' && node.data.action === 'Load');
    const wire = shared.edges.find((edge) => edge.source === loader.id);
    shared.edges.push({ ...wire, id: 'shared-video', target: 'external-consumer' });
    assert.equal(
      groups.groupNewOperationGraph(shared).nodes.some((node) => groups.visualOperationGroup(node) === 'videoInput'),
      false,
      'A separately consumed original clip stays visible.',
    );
  }
});

test('whole-pipeline Generate retains its authored executable fields during live canvas replacement', async () => {
  const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const graph = JSON.parse(
    readFileSync(path.join(backend, 'data/graphs/studio/aura-flow-pipeline/text-to-image.json'), 'utf8'),
  );
  const { useNodesStore } = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  const previous = useNodesStore.getState().nodesRegistry;
  const identity = (sourceGraph) =>
    canonicalGraphIdentity(
      flowStore.getState().exportGraph('live-legacy-fields', undefined, { sourceGraph, randomizeSeeds: false }),
    );
  const expected = identity(graph);
  try {
    assert.equal(fixture.registry['modules.DiffusersImage.Generate'].params.use_guidance_scale_2.hidden, true);
    useNodesStore.setState({ nodesRegistry: fixture.registry });
    flowStore.getState().replaceGraph(groups.groupNewOperationGraph(graph), { clearRemovedCache: false });
    const live = { nodes: flowStore.getState().nodes, edges: flowStore.getState().edges };
    assert.deepEqual(identity(live), expected, 'Opening a reviewed example must not add inactive guidance overrides.');
    const generate = live.nodes.find(
      (node) => node.data.module === 'modules.DiffusersImage' && node.data.action === 'Generate',
    );
    assert.ok(generate, 'Whole native generation has the same editable Generate stage.');
    assert.equal(generate.data.blockInstanceV2, undefined);
  } finally {
    useNodesStore.setState({ nodesRegistry: previous });
  }
});

test('legacy modular setup and native caption stages retain their authored fields during canvas hydration', async () => {
  const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const { useNodesStore } = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  const previous = useNodesStore.getState().nodesRegistry;
  const identity = (sourceGraph) =>
    canonicalGraphIdentity(
      flowStore.getState().exportGraph('live-legacy-controls', undefined, { sourceGraph, randomizeSeeds: false }),
    );
  try {
    useNodesStore.setState({ nodesRegistry: fixture.registry });
    for (const file of [
      'hugging-face-image-text-to-text-model/image-to-text.json',
      'mini-max-music3-modular-pipeline/text-to-audio.json',
      'wan-image2-video-modular-pipeline/image-to-video.json',
    ]) {
      const graph = JSON.parse(readFileSync(path.join(backend, 'data/graphs/studio', file), 'utf8'));
      const expected = identity(graph);
      flowStore.getState().replaceGraph(groups.groupNewOperationGraph(graph), { clearRemovedCache: false });
      assert.deepEqual(
        identity({ nodes: flowStore.getState().nodes, edges: flowStore.getState().edges }),
        expected,
        `${file}: opening must not introduce absent schema defaults`,
      );
    }
  } finally {
    useNodesStore.setState({ nodesRegistry: previous });
  }
});

test('every bundled example opens as stages without changing its ordered API or rewriting saved presentation', async () => {
  const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
  const manifest = JSON.parse(readFileSync(path.join(backend, 'data/workflow-library-manifest.json'), 'utf8'));
  const variants = JSON.parse(readFileSync(path.resolve('config/canonical-template-variants.v1.json'), 'utf8'));
  const rows = [
    ...manifest.workflows,
    ...selectReviewedExperimentalWorkflows(manifest.experimentalWorkflows, variants),
  ];
  const { exampleWorkflowSnapshotFromGraph } = await server.ssrLoadModule('/src/studio/exampleWorkflow.ts');
  const { workflowSnapshotFromGraph } = await server.ssrLoadModule('/src/studio/workflowInference.ts');
  const { materializeBlockProjectionV2, setBlockPresentationV2, storyboardStageKindV2 } = await server.ssrLoadModule(
    '/src/studio/blockRuntimeV2.ts',
  );
  const { isFocusedStageNode } = await server.ssrLoadModule('/src/workflow/encodingNodePresentation.ts');
  const identity = (sourceGraph) =>
    canonicalGraphIdentity(
      flowStore.getState().exportGraph('library-stage-restore', undefined, { sourceGraph, randomizeSeeds: false }),
    );
  assert.equal(rows.length, 220, 'Audit the full current library, including declared experimental examples.');
  for (const row of rows) {
    const graph = JSON.parse(readFileSync(path.join(backend, 'data/graphs', row.graphPath), 'utf8'));
    const original = structuredClone(graph);
    const expected = identity(graph);
    let opened = exampleWorkflowSnapshotFromGraph(graph, 'default', defaults);
    for (const node of opened.nodes.filter((node) => node.data.blockInstanceV2))
      assert.deepEqual(
        node.position,
        node.data.blockInstanceV2.presentation.position,
        `${row.id}: one durable position authority`,
      );
    assert.deepEqual(identity(opened), expected, row.id);
    for (const stage of opened.nodes.filter(groups.visualOperationGroup)) {
      assert.ok(isFocusedStageNode(stage.data.blockInstanceV2), `${row.id}: ${stage.data.label} opens as a node`);
      const exposed = groups.unpackVisualOperationGroups(opened, new Set([stage.id])).graph;
      assert.deepEqual(
        identity(exposed),
        expected,
        `${row.id}: exposing ${stage.data.label} preserves all remaining groups' order`,
      );
    }
    const saved = JSON.parse(JSON.stringify(opened));
    for (let reload = 0; reload < 3; reload++) {
      opened = workflowSnapshotFromGraph(JSON.parse(JSON.stringify(opened)), 'default', defaults);
      assert.deepEqual(identity(opened), expected, `${row.id}: reload ${reload + 1}`);
      assert.deepEqual(opened.nodes, saved.nodes, `${row.id}: saved nodes retain their presentation`);
      assert.deepEqual(opened.edges, saved.edges, `${row.id}: saved wires retain their presentation`);
    }
    assert.deepEqual(graph, original, `${row.id}: shipped bytes retain their identity`);
    if (row.id.includes('long_showcase') || row.id.includes('animated_story') || row.id.includes('lyric_music_video')) {
      const shots = opened.nodes.filter((node) => /^Shot \d+/.test(node.data.label ?? ''));
      assert.ok(shots.length > 1, `${row.id}: separate Shot groups`);
      for (const shot of shots) {
        // An older saved instance could have expanded the inner stages.
        const previous = shot.data.blockInstanceV2;
        const instance = setBlockPresentationV2(previous, { expanded: true, collapsedContainerNodeIds: [] });
        const projection = materializeBlockProjectionV2({
          ...shot,
          data: { ...shot.data, blockInstanceV2: instance },
        });
        const stages = projection.nodes.filter((node) =>
          storyboardStageKindV2(instance, node.data.blockProjectionNodeId),
        );
        assert.deepEqual(
          stages.map((node) => node.data.label).sort(),
          [
            'Encode Inputs',
            'Generate',
            ...(previous.effectiveGraph.nodes.some(
              (node) => node.data.module === 'modules.Image' && node.data.action === 'Load',
            )
              ? ['Image Input']
              : []),
          ],
          `${row.id}: one compact card per stage inside ${shot.data.label}`,
        );
        assert.ok(stages.every((node) => node.data.blockProjectionContainerExpanded === false));
        assert.ok(projection.nodes.every((node) => stages.every((stage) => stage.id !== node.parentId)));
        assert.deepEqual(
          identity({
            ...opened,
            nodes: opened.nodes.flatMap((node) => (node.id === shot.id ? projection.nodes : [node])),
            edges: [...opened.edges, ...projection.edges],
          }),
          expected,
          `${row.id}: shot disclosure keeps the executable recipe`,
        );
      }
    }
  }
});

test('canonical library projection preserves real Cosmos/Qwen controls, wires and owner identity without rewriting grouped saves', async () => {
  for (const id of ids) {
    const graph = build(id);
    const expectedApi = semanticApi(graph);
    const expectedOwners = groups
      .unpackVisualOperationGroups(graph)
      .graph.nodes.filter((node) => node.data.operationAuthoring?.operation.decomposition === 'loader')
      .map((node) => node.data.operationAuthoring.operation.binding);
    assert.ok(graph.nodes.some(groups.visualOperationGroup));
    flowStore.setState({ nodes: structuredClone(graph.nodes), edges: structuredClone(graph.edges) });
    const ordinarySave = await hooks.prepareWorkflowGraphForExport();
    const definitionHashes = ordinarySave.nodes
      .filter(groups.visualOperationGroup)
      .map((node) => node.data.blockInstanceV2.definitionSnapshot.contentHash);
    const exported = await hooks.prepareWorkflowGraphForExport({ canonicalLibrary: true });
    assert.equal(exported.nodes.some(groups.visualOperationGroup), false, id);
    assert.deepEqual(semanticApi(exported), expectedApi, id);
    assert.deepEqual(
      exported.nodes
        .filter((node) => node.data.operationAuthoring?.operation.decomposition === 'loader')
        .map((node) => node.data.operationAuthoring.operation.binding),
      expectedOwners,
      id,
    );
    const sanitized = sanitizeCanonicalWorkflowGraph(exported);
    assert.deepEqual(semanticApi(sanitized), expectedApi, 'Only transient UI/preview state may be removed.');
    if (id === ids[2]) {
      const encoder = sanitized.nodes.find((node) => node.data.action === 'ImageEncode');
      assert.equal(
        shared.sharedOperationInput(sanitized.nodes, sanitized.edges, encoder.id, 'seed')?.members.length,
        2,
        'The actual masked workflow exposes its single state-owned seed before ID canonicalization.',
      );
    }
    const canonical = canonicalizeGraphIds(structuredClone(sanitized), shared.remapOperationAuthoring);
    assert.deepEqual(
      semanticApi(canonical),
      expectedApi,
      'Canonical IDs preserve every executable parameter and wire.',
    );
    for (const node of canonical.nodes) {
      for (const binding of node.data.operationAuthoring?.sharedInputs ?? []) {
        assert.ok(
          canonical.nodes.some((owner) => owner.id === binding.loaderId),
          'The editing owner must use its canonical ID.',
        );
      }
    }
    if (id === ids[2]) {
      const encoder = canonical.nodes.find((node) => node.data.action === 'ImageEncode');
      assert.equal(
        shared.sharedOperationInput(canonical.nodes, canonical.edges, encoder.id, 'seed')?.members.length,
        2,
      );
    }
    assert.deepEqual(
      flowStore
        .getState()
        .nodes.filter(groups.visualOperationGroup)
        .map((node) => node.data.blockInstanceV2.definitionSnapshot.contentHash),
      definitionHashes,
    );
    assert.ok((await hooks.prepareWorkflowGraphForExport()).nodes.some(groups.visualOperationGroup));
  }
});

test('canonical projection leaves user Blocks intact and rejects malformed visual definition hashes', async () => {
  const graph = build(ids[0]);
  const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs');
  const definition = structuredClone(root.data.blockInstanceV2.definitionSnapshot);
  definition.source.provider = 'operator-authored-example';
  definition.contentHash = blockSchema.blockDefinitionContentHashV2(definition);
  root.data.blockInstanceV2.definitionSnapshot = blockSchema.normalizeBlockDefinitionV2(definition);
  root.data.blockInstanceV2.definitionRef.contentHash = definition.contentHash;
  flowStore.setState({ nodes: structuredClone(graph.nodes), edges: structuredClone(graph.edges) });
  const exported = await hooks.prepareWorkflowGraphForExport({ canonicalLibrary: true });
  const retained = exported.nodes.find((node) => node.id === root.id);
  assert.ok(retained?.data.blockInstanceV2);
  assert.deepEqual(retained.data.blockInstanceV2.definitionSnapshot, definition);
  const malformed = build(ids[0]);
  flowStore.setState({ nodes: malformed.nodes, edges: malformed.edges });
  flowStore.getState().nodes.find(groups.visualOperationGroup).data.blockInstanceV2.definitionSnapshot.contentHash =
    'block-definition-v2-00000000';
  await assert.rejects(hooks.prepareWorkflowGraphForExport({ canonicalLibrary: true }), /contentHash/);
});

test('portable canonical IDs preserve executable Blocks without changing the grouped source or its definition', async () => {
  const graph = build(ids[0]);
  const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs');
  const definition = structuredClone(root.data.blockInstanceV2.definitionSnapshot);
  definition.source.provider = 'operator-authored-example';
  definition.contentHash = blockSchema.blockDefinitionContentHashV2(definition);
  root.data.blockInstanceV2.definitionSnapshot = blockSchema.normalizeBlockDefinitionV2(definition);
  root.data.blockInstanceV2.definitionRef.contentHash = definition.contentHash;
  const before = structuredClone(graph);
  const expectedApi = semanticApi(graph);
  const expand = await loadCanonicalWorkflowExpander(server);
  const portable = canonicalExecutableWorkflowGraph(graph, expand);
  const canonical = canonicalizeGraphIds(sanitizeCanonicalWorkflowGraph(portable), shared.remapOperationAuthoring);
  assert.deepEqual(semanticApi(canonical), expectedApi);
  assert.equal(
    canonical.nodes.some((node) => node.data.blockInstanceV2),
    false,
  );
  assert.deepEqual(graph, before, 'Canonical publication does not rewrite the ordinary grouped canvas.');
  const broken = structuredClone(graph);
  broken.nodes.find((node) => node.data.blockInstanceV2).data.blockInstanceV2.instanceId = 'wrong-root';
  assert.throws(() => canonicalExecutableWorkflowGraph(broken, expand), /canvas id/);
});
