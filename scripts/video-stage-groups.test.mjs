import assert from 'node:assert/strict';
import { canonicalGraphIdentity } from './live-proof-provenance.mjs';
import { executionReceiptsForRun } from './template-gallery-runner.mjs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let fixture,
  server,
  authoring,
  groups,
  projection,
  exporter,
  templates,
  builder,
  exactness,
  defaults,
  nodes,
  contracts,
  starterParser,
  drafts,
  setupAdapters,
  secondaryStages,
  secondaryFixture;
before(async () => {
  const backend = process.env.MODIFF_BACKEND_DIR || path.resolve('../MoDiff');
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const selections = [
    ['WanModularPipeline', 'text_to_video'],
    ['MiniMaxH3ModularPipeline', 'text_to_video_with_audio'],
    ['MiniMaxH3ModularPipeline', 'first_last_frame_to_video_with_audio'],
    ['MiniMaxH3ModularPipeline', 'reference_to_video_with_audio'],
    ['PikaH3FlexModularPipeline', 'text_to_video_with_audio'],
    ['PikaH3FlexModularPipeline', 'first_last_frame_to_video_with_audio'],
    ['PikaH3FlexModularPipeline', 'reference_to_video_with_audio'],
  ].map(([pipelineClass, task]) => ({ id: `${pipelineClass}:${task}`, selection: { pipelineClass, task } }));
  for (const [id, modelType, pipelineClass, profile, task] of [
    ['ltx_video_text_to_video', 'LTXVideoPipeline', 'LTXConditionPipeline', 'ltx-video:direct', 'text_to_video'],
    ['ltx_video_image_to_video', 'LTXVideoPipeline', 'LTXConditionPipeline', 'ltx-video:direct', 'image_to_video'],
    ['ltx_video_video_to_video', 'LTXVideoPipeline', 'LTXConditionPipeline', 'ltx-video:direct', 'video_to_video'],
    ['ltx_video_multi_reference', 'LTXVideoPipeline', 'LTXConditionPipeline', 'ltx-video:direct', 'reference_to_video'],
    ['wan_22_ti2v_5b_seed_vault', 'WanTI2VPipeline', 'WanTI2VPipeline', 'wan-22-ti2v-5b:direct', 'text_to_video'],
    [
      'wan_vace_cinematic_text_to_video',
      'WanVideoPipeline',
      'WanPipeline',
      'wan-text-to-video:direct',
      'text_to_video',
    ],
    [
      'wan_vace_video_color_grade',
      'WanVideoPipeline',
      'WanVideoToVideoPipeline',
      'wan-video-to-video:direct',
      'video_color_edit',
    ],
    [
      'wan_vace_video_to_video',
      'WanVideoPipeline',
      'WanVideoToVideoPipeline',
      'wan-video-to-video:direct',
      'video_to_video',
    ],
    ['wan_vace_masked_object_replace', 'WanVACEPipeline', 'WanVACEPipeline', 'wan-vace:direct', 'video_inpaint'],
    ['wan_vace_outpaint_reframe', 'WanVACEPipeline', 'WanVACEPipeline', 'wan-vace:direct', 'video_outpaint'],
    ['wan_vace_grayscale_control', 'WanVACEPipeline', 'WanVACEPipeline', 'wan-vace:direct', 'control_to_video'],
    [
      'wan_22_i2v_seed_vault',
      'WanImageToVideoPipeline',
      'WanImageToVideoPipeline',
      'wan-22-image-to-video:direct',
      'image_to_video',
    ],
  ])
    selections.push({
      id,
      selection: {
        pipelineClass,
        task,
        executionProfileId: profile,
        bindingSpec: { modelType, mode: task },
        authoringRecipeId: 'generic-video-stages:v1',
      },
    });
  selections.push({
    id: 'unbound-vace-whole',
    selection: { pipelineClass: 'WanVACEPipeline', task: 'control_to_video' },
  });
  fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: backend,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 ** 2,
      timeout: 120_000,
      input: JSON.stringify(selections),
      env: {
        ...process.env,
        MODIFF_BACKEND_DIR: backend,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        CUDA_VISIBLE_DEVICES: '',
      },
    }),
  );
  fixture.unboundVace = fixture.recipes.find((row) => row.id === 'unbound-vace-whole');
  fixture.recipes = fixture.recipes.filter((row) => row !== fixture.unboundVace);
  secondaryFixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: backend,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 ** 2,
      timeout: 120_000,
      input: JSON.stringify([
        {
          id: 'soundtrack',
          selection: {
            pipelineClass: 'AceStepPipeline',
            task: 'text_to_audio',
            executionProfileId: 'ace-step-audio:direct',
            repository: 'ACE-Step/acestep-v15-xl-turbo-diffusers',
          },
        },
      ]),
      env: {
        ...process.env,
        MODIFF_BACKEND_DIR: backend,
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        CUDA_VISIBLE_DEVICES: '',
      },
    }),
  );
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { dispatchEvent: () => true, location: { origin: 'http://127.0.0.1:5191' }, localStorage };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  authoring = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  projection = await server.ssrLoadModule('/src/workflow/visualOperationGroupProjection.ts');
  exporter = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  nodes = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  contracts = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  starterParser = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  drafts = await server.ssrLoadModule('/src/workflow/workflowDraft.ts');
  setupAdapters = await server.ssrLoadModule('/src/workflow/modelSetupAdapters.ts');
  ({ STUDIO_TEMPLATES: templates } = await server.ssrLoadModule('/src/studio/templates.ts'));
  secondaryStages = await server.ssrLoadModule('/src/studio/templateSecondaryStages.ts');
  const operations = contracts.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const resolved = secondaryFixture.recipes[0].starter;
  const soundtrackStarter = starterParser.parseOperationStarter(
    resolved,
    resolved.pipelineClass,
    resolved.task,
    operations,
    { executionProfileId: 'ace-step-audio:direct', repository: 'ACE-Step/acestep-v15-xl-turbo-diffusers' },
  );
  fixture.registry = await secondaryStages.templateSecondaryStageRegistry(
    templates.find((item) => item.id === 'wan_22_ti2v_5b_seed_vault'),
    fixture.registry,
    nodes.parseStudioModelCapabilities(fixture.publicPayload).capabilities,
    operations,
    async () => soundtrackStarter,
  );
  builder = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  ({ DEFAULT_STUDIO_FORM: defaults } = await server.ssrLoadModule('/src/studio/modelProfiles.ts'));
});
after(async () => server?.close());

test('joint video/audio presentation retains both declared families without granting qualification', () => {
  const parsed = nodes.parseStudioModelCapabilities(fixture.publicPayload);
  for (const model of ['MiniMaxH3ModularPipeline', 'PikaH3FlexModularPipeline']) {
    const capability = parsed.capabilities.find((item) => item.modelType === model);
    assert.ok(capability, `${model} must survive presentation parsing`);
    assert.deepEqual(capability.modes, [
      'text_to_video_with_audio',
      'first_last_frame_to_video_with_audio',
      'reference_to_video_with_audio',
    ]);
    assert.equal(capability.autoEligible, false);
    assert.equal(capability.templateEligible, false);
    assert.equal(capability.galleryEligible, false);
    assert.equal(capability.liveProof, false);
  }
});

test('fresh joint video/audio drafts attach one typed joined exporter and Video Output stage', async (t) => {
  for (const row of fixture.recipes.filter((item) => item.starter.task.endsWith('_with_audio')))
    await t.test(row.id, () => {
      const result = drafts.createWorkflowDraft(row.starter, fixture.registry);
      const flat = groups.unpackVisualOperationGroups(result.graph).graph;
      const outputs = flat.nodes.filter(
        (node) => node.data.module === 'modules.Video' && node.data.action === 'ExportWithAudio',
      );
      assert.equal(outputs.length, 1, 'the ordinary creation path must retain the joint soundtrack');
      const wires = flat.edges.filter((edge) => edge.target === outputs[0].id);
      assert.deepEqual(wires.map((edge) => edge.targetHandle).sort(), ['audio', 'video']);
      assert.equal(new Set(wires.map((edge) => edge.source)).size, 1, 'both streams come from the same producer');
      assert.equal(result.graph.nodes.filter((node) => groups.visualOperationGroup(node) === 'output').length, 1);
      assert.ok(!flat.nodes.some((node) => node.data.module === 'modules.Audio' && node.data.action === 'Preview'));
    });
});

test('a missing or incompatible joined exporter never creates a partial audio/video connection', () => {
  const row = fixture.recipes.find((item) => item.id === 'MiniMaxH3ModularPipeline:text_to_video_with_audio');
  const original = structuredClone(fixture.registry);
  for (const incompatible of [false, true]) {
    const registry = structuredClone(fixture.registry);
    if (incompatible) registry['modules.Video.ExportWithAudio'].params.audio.type = 'image';
    else delete registry['modules.Video.ExportWithAudio'];
    const result = drafts.createWorkflowDraft(row.starter, registry);
    const flat = groups.unpackVisualOperationGroups(result.graph).graph;
    assert.ok(!flat.nodes.some((node) => node.data.action === 'ExportWithAudio'));
    assert.ok(result.notices.some((notice) => notice.includes('joined video/audio')));
  }
  assert.deepEqual(fixture.registry, original);
});

test('one ambiguous union output is not treated as two simultaneous media streams', () => {
  const starter = structuredClone(
    fixture.recipes.find((item) => item.id === 'MiniMaxH3ModularPipeline:text_to_video_with_audio').starter,
  );
  const producer = starter.nodes.find((node) =>
    node.operation.ports.some((port) => port.direction === 'output' && port.types.includes('audio')),
  );
  producer.operation.ports = producer.operation.ports.filter(
    (port) => port.direction !== 'output' || !port.types.includes('audio'),
  );
  producer.operation.ports.find((port) => port.direction === 'output' && port.types.includes('video')).types = [
    'video',
    'audio',
  ];
  const result = drafts.createWorkflowDraft(starter, fixture.registry);
  const flat = groups.unpackVisualOperationGroups(result.graph).graph;
  assert.ok(!flat.nodes.some((node) => node.data.action === 'ExportWithAudio'));
});

function graphFor(row) {
  const graph = authoring.createOperationStarter(structuredClone(row.starter), { x: 0, y: 0 });
  for (const node of graph.nodes)
    if (String(node.data.params.device?.value ?? node.data.params.device?.default).startsWith('cpu')) {
      if (node.data.params.offload_mode) node.data.params.offload_mode.value = 'none';
      if (node.data.params.auto_offload) node.data.params.auto_offload.value = false;
    }
  const audio = row.starter.task.includes('audio');
  graph.nodes.push({
    id: 'video-export',
    type: 'custom',
    position: { x: 1800, y: 0 },
    data: structuredClone(fixture.registry[`modules.Video.${audio ? 'ExportWithAudio' : 'Export'}`]),
  });
  for (const media of audio ? ['video', 'audio'] : ['video']) {
    const sources = graph.nodes.filter(
      (node) =>
        node.id !== 'video-export' &&
        Object.values(node.data.params).some((field) => field.display === 'output' && field.type === media),
    );
    assert.equal(sources.length, 1, `one real final ${media} producer`);
    const port = Object.entries(sources[0].data.params).find(
      ([, field]) => field.display === 'output' && field.type === media,
    )[0];
    graph.edges.push({
      id: `export-${media}`,
      source: sources[0].id,
      sourceHandle: port,
      target: 'video-export',
      targetHandle: media,
    });
  }
  return graph;
}

test('encoded video stages require their real encoding instead of duplicate raw media, including restored schemas', async () => {
  const { inspectRequiredGraphInputs } = await server.ssrLoadModule('/src/studio/requiredGraphInputs.ts');
  const { inspectBlockMediaInputsV2 } = await server.ssrLoadModule('/src/studio/blockMediaReadinessV2.ts');
  const operations = contracts.parseOperationContracts(fixture.publicPayload.operationContracts, 3);
  for (const row of fixture.recipes.filter((item) => item.starter.pipelineClass === 'WanVACEPipeline')) {
    const graph = graphFor(row);
    const render = graph.nodes.find(
      (node) => node.data.operationAuthoring?.operation.operationId === 'diffusion.render_video',
    );
    assert.ok(render, row.id);
    // An old saved instance still has the whole-operation raw-media overlay.
    for (const name of ['video', 'mask']) render.data.params[name].required = true;
    const before = structuredClone(graph);
    const required = () =>
      inspectRequiredGraphInputs(graph.nodes, graph, fixture.registry, operations).filter(
        (issue) => issue.nodeId === render.id,
      );
    const media = () =>
      inspectBlockMediaInputsV2(graph.nodes, graph, operations, fixture.registry).filter(
        (issue) => issue.nodeId === render.id,
      );
    assert.deepEqual(required(), [], row.id);
    assert.deepEqual(media(), [], row.id);
    assert.deepEqual(graph, before, 'inspection must not rewrite a restored workflow');
    const wire = graph.edges.find((edge) => edge.target === render.id && edge.targetHandle === 'encoded_inputs');
    assert.ok(wire);
    graph.edges = graph.edges.filter((edge) => edge !== wire);
    assert.deepEqual(
      required().map((issue) => issue.fieldId),
      ['encoded_inputs'],
    );
    graph.edges.push(wire);
    const encoder = graph.nodes.find((node) => node.id === wire.source);
    encoder.data.uiState = { disabled: true };
    assert.deepEqual(
      required().map((issue) => issue.fieldId),
      ['encoded_inputs'],
    );
    delete encoder.data.uiState;
    const output = encoder.data.params[wire.sourceHandle];
    const type = output.type;
    output.type = 'image';
    assert.deepEqual(
      required().map((issue) => issue.fieldId),
      ['encoded_inputs'],
    );
    output.type = type;
    assert.deepEqual(required(), []);
    const strictRegistry = structuredClone(fixture.registry);
    strictRegistry['modules.DiffusersVideo.Generate'].params.video.required = true;
    assert.ok(
      inspectRequiredGraphInputs(graph.nodes, graph, strictRegistry, []).some(
        (issue) => issue.nodeId === render.id && issue.fieldId === 'video',
      ),
      'saved hints cannot narrow registry requirements without current backend authority',
    );
    render.data.operationAuthoring.operation.ports.find((port) => port.name === 'encoded_inputs').required = false;
    graph.edges = graph.edges.filter((edge) => edge !== wire);
    assert.deepEqual(
      required().map((issue) => issue.fieldId),
      ['encoded_inputs'],
      'saved port metadata cannot relax current backend requiredness',
    );
    graph.edges.push(wire);
    render.data.params.mode.isConnected = true;
    assert.ok(
      inspectRequiredGraphInputs(graph.nodes, graph, strictRegistry, operations).some(
        (issue) => issue.nodeId === render.id && issue.fieldId === 'video',
      ),
      'computed selectors do not establish a literal bundle selection',
    );
  }
});

function api(graph) {
  const result = exporter.useFlowStore
    .getState()
    .exportGraph('video-stage-contract', undefined, { sourceGraph: graph, randomizeSeeds: false });
  const keys = Object.values(result.nodes).map((node) => `${node.module}.${node.action}`);
  const names = new Map(
    Object.entries(result.nodes).map(([id, node]) => {
      const key = `${node.module}.${node.action}`;
      const consumers = Object.values(result.nodes)
        .flatMap((consumer) =>
          Object.entries(consumer.params ?? {})
            .filter(([, value]) => value?.sourceId === id)
            .map(([field]) => `${consumer.module}.${consumer.action}.${field}`),
        )
        .sort();
      return [id, keys.filter((item) => item === key).length === 1 ? key : `${key}:${consumers.join(',')}`];
    }),
  );
  assert.equal(new Set(names.values()).size, names.size);
  const normalize = (value) =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              key === 'sourceId' ? (names.get(item) ?? item) : normalize(item),
            ]),
          )
        : value;
  // Presentation may choose another valid ordering of independent suppliers.
  // Compare every exact node input/connection and scope membership, and require
  // actual dependencies to precede their consumers in both exported orders.
  const suppliers = (value) =>
    Array.isArray(value)
      ? value.flatMap(suppliers)
      : value && typeof value === 'object'
        ? [...(typeof value.sourceId === 'string' ? [value.sourceId] : []), ...Object.values(value).flatMap(suppliers)]
        : [];
  for (const route of result.paths)
    for (const id of route)
      for (const source of suppliers(result.nodes[id])) {
        assert.ok(
          route.indexOf(source) >= 0 && route.indexOf(source) < route.indexOf(id),
          'connected supplier precedes its consumer',
        );
      }
  return {
    nodes: Object.fromEntries(
      [...names].map(([id, name]) => [name, normalize(result.nodes[id])]).sort(([a], [b]) => a.localeCompare(b)),
    ),
    paths: result.paths
      .map((route) => route.map((id) => names.get(id) ?? id).sort())
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

test('actual video workflows group real encoders and decoder/export without changing execution', async (t) => {
  for (const row of fixture.recipes)
    await t.test(row.id, () => {
      const graph = graphFor(row),
        original = structuredClone(graph);
      const grouped = groups.groupNewOperationGraph(graph);
      const inputs = grouped.nodes.filter((node) => groups.visualOperationGroup(node) === 'inputs');
      const outputs = grouped.nodes.filter((node) => groups.visualOperationGroup(node) === 'output');
      assert.equal(inputs.length, 1);
      assert.equal(outputs.length, 1);
      assert.equal(outputs[0].data.label, 'Video Output');
      assert.equal(projection.visualOperationGroupMedia(outputs[0]), 'video');
      assert.equal(outputs[0].data.blockInstanceV2.previewStates[0].binding.mediaType, 'video');
      assert.equal(
        inputs[0].data.blockInstanceV2.effectiveGraph.nodes.some(
          (node) => node.data.operationAuthoring.operation.nodeType === 'denoise',
        ),
        false,
      );
      const expectedEncoders = graph.nodes.filter((node) =>
        ['text_encoder', 'vae_encoder', 'before_encode', 'video_encoder'].includes(
          node.data.operationAuthoring?.operation.nodeType,
        ),
      );
      assert.equal(inputs[0].data.blockInstanceV2.effectiveGraph.nodes.length, expectedEncoders.length);
      assert.deepEqual(api(grouped), api(original));
      assert.deepEqual(api(groups.unpackVisualOperationGroups(grouped).graph), api(original));
      assert.deepEqual(graph, original);
      const restored = JSON.parse(JSON.stringify(grouped));
      assert.deepEqual(api(restored), api(original), 'ordinary saved graph reopens with exact values and connections');
    });
});

test('direct video Model Setup explains unavailable inline adapters without blaming valid consumers', () => {
  for (const id of ['ltx_video_text_to_video', 'wan_22_ti2v_5b_seed_vault']) {
    const row = fixture.recipes.find((item) => item.id === id);
    assert.ok(row, id);
    const graph = groups.groupNewOperationGraph(graphFor(row));
    const setup = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
    assert.ok(setup, id);
    const before = api(graph);
    assert.throws(
      () => setupAdapters.modelSetupAdapterChain(graph, setup.id),
      /LoRA editing is not available for this pipeline type/,
    );
    assert.deepEqual(api(graph), before, 'read-only limitation leaves the complete video graph intact');
  }
});

test('fresh ordinary native video keeps sampling and decode in Generate and delivery in Video Output', () => {
  const row = fixture.recipes.find((item) => item.id === 'ltx_video_text_to_video');
  const original = graphFor(row);
  const graph = groups.groupNewOperationGraph(original);
  const generate = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'generate');
  const output = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'output');
  assert.ok(generate, 'an adjacent native decoder must not be consumed by Output before Generate is built');
  assert.deepEqual(generate.data.blockInstanceV2.effectiveGraph.nodes.map((node) => node.data.action).sort(), [
    'DecodeLatents',
    'Denoise',
  ]);
  assert.deepEqual(
    output.data.blockInstanceV2.effectiveGraph.nodes.map((node) => node.data.action),
    ['Export'],
  );
  assert.deepEqual(api(graph), api(original));
});

test('soundtrack secondary owner receives the same Model Setup grouping as standalone audio', () => {
  const template = templates.find((item) => item.id === 'wan_22_ti2v_5b_seed_vault');
  const row = fixture.recipes.find((item) => item.id === template.id);
  const parsed = nodes.parseStudioModelCapabilities(fixture.publicPayload);
  const operations = contracts.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const capability = parsed.capabilities.find((item) => item.modelType === template.modelType);
  const spec = capability.studioExecutionSpecs.find((item) => item.mode === template.mode);
  const starter = starterParser.parseOperationStarter(
    row.starter,
    row.starter.pipelineClass,
    row.starter.task,
    operations,
    { executionProfileId: row.spec.executionProfileId, authoringRecipeId: 'generic-video-stages:v1' },
  );
  const form = {
    ...defaults,
    ...exactness.getTemplateLockedSettings(template),
    device: 'cpu:0',
    offloadMode: 'none',
    autoOffload: false,
  };
  const graph = builder.createTemplateOperationGraph(template, form, starter, fixture.registry, spec, capability, {
    operationContracts: operations,
    studioModelCapabilities: parsed.capabilities,
  });
  const setups = graph.nodes.filter((node) => groups.visualOperationGroup(node) === 'setup');
  assert.equal(setups.length, 2, 'video and soundtrack need independent declared Model Setup stages');
  const audioSetup = setups.find((node) =>
    node.data.blockInstanceV2.effectiveGraph.nodes.some(
      (leaf) => leaf.data.module === 'modules.DiffusersAudio' && leaf.data.action === 'LoadPipeline',
    ),
  );
  assert.ok(audioSetup, 'the actual ACE loader and its exclusive recipe must be grouped');
  assert.deepEqual(audioSetup.data.blockInstanceV2.effectiveGraph.nodes.map((node) => node.data.action).sort(), [
    'DiffusersExecutionRecipe',
    'LoadPipeline',
    'PipelineQuantizationConfigV2',
  ]);
  const flattened = groups.unpackVisualOperationGroups(graph).graph;
  assert.equal(flattened.nodes.filter((node) => node.data.action === 'LoadPipeline').length, 2);
  assert.equal(flattened.nodes.filter((node) => node.data.action === 'FitDuration').length, 1);
  assert.equal(flattened.nodes.filter((node) => node.data.action === 'ExportWithAudio').length, 1);
});

test('secondary stage resolution rejects a different immutable model without changing registry data', async () => {
  const template = templates.find((item) => item.id === 'wan_22_ti2v_5b_seed_vault');
  const capability = nodes.parseStudioModelCapabilities(fixture.publicPayload).capabilities;
  const operations = contracts.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const before = structuredClone(secondaryFixture.registry);
  const row = secondaryFixture.recipes[0].starter;
  const starter = starterParser.parseOperationStarter(row, row.pipelineClass, row.task, operations, {
    executionProfileId: 'ace-step-audio:direct',
    repository: template.workflowBlockSettings.soundtrack.model.value,
  });
  const foreign = structuredClone(starter);
  const owner = foreign.nodes.find((item) => contracts.operationOwnsModel(item.operation));
  owner.node.params.revision.value = '0'.repeat(40);
  await assert.rejects(
    secondaryStages.templateSecondaryStageRegistry(
      template,
      secondaryFixture.registry,
      capability,
      operations,
      async () => foreign,
    ),
    /different immutable soundtrack model/,
  );
  assert.deepEqual(secondaryFixture.registry, before);
});

test('retained video template factories preserve creative settings on their exact latent starters', () => {
  const parsed = nodes.parseStudioModelCapabilities(fixture.publicPayload);
  const operations = contracts.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  for (const row of fixture.recipes.filter(
    (row) => row.spec && !row.id.startsWith('wan_vace_') && row.id !== 'wan_22_i2v_seed_vault',
  )) {
    const template = templates.find((template) => template.id === row.id);
    assert.ok(template?.executionSelection, row.id);
    const capability = parsed.capabilities.find((capability) => capability.modelType === template.modelType);
    const spec = capability.studioExecutionSpecs.find((spec) => spec.mode === template.mode);
    const starter = starterParser.parseOperationStarter(
      row.starter,
      row.starter.pipelineClass,
      row.starter.task,
      operations,
      { executionProfileId: row.spec.executionProfileId, authoringRecipeId: 'generic-video-stages:v1' },
    );
    const form = {
      ...defaults,
      ...exactness.getTemplateLockedSettings(template),
      device: 'cpu:0',
      offloadMode: 'none',
      autoOffload: false,
      referenceImages: ['images/reference.webp'],
      sourceVideo: 'videos/source.mp4',
    };
    const graph = builder.createTemplateOperationGraph(template, form, starter, fixture.registry, spec, capability);
    const generate = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'generate');
    const newStages = graph.nodes.filter((node) =>
      ['generate', 'videoInput'].includes(groups.visualOperationGroup(node)),
    );
    const ordinary = groups.unpackVisualOperationGroups(graph, new Set(newStages.map((node) => node.id))).graph;
    const identity = (sourceGraph) =>
      canonicalGraphIdentity(
        exporter.useFlowStore.getState().exportGraph('presentation', undefined, { sourceGraph, randomizeSeeds: false }),
      ).hash;
    assert.equal(
      identity(graph),
      identity(ordinary),
      `${row.id} must preserve execution order as well as values and wires`,
    );
    assert.ok(generate, `${row.id} should show Generate before the upscaler or joined delivery`);
    assert.deepEqual(generate.data.blockInstanceV2.effectiveGraph.nodes.map((n) => n.data.action).sort(), [
      'DecodeLatents',
      'Denoise',
    ]);
    assert.ok(
      !generate.data.blockInstanceV2.effectiveInterface.boundary.outputs.some((p) =>
        ['latents_out', 'latent_binding'].includes(p.binding.fieldOrPortId),
      ),
    );
    assert.equal(
      generate.data.blockInstanceV2.effectiveInterface.boundary.inputs.filter(
        (p) => p.binding.fieldOrPortId === 'pipeline',
      ).length,
      1,
    );
    if (row.id === 'ltx_video_video_to_video') {
      const input = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'videoInput');
      assert.ok(input);
      assert.deepEqual(input.data.blockInstanceV2.effectiveGraph.nodes.map((n) => n.data.action).sort(), [
        'Load',
        'Normalize',
      ]);
      const fields = input.data.blockInstanceV2.effectiveInterface.controls.map((c) => c.binding.fieldId);
      for (const field of ['file', 'width', 'height', 'num_frames', 'fit']) assert.ok(fields.includes(field), field);
      const flatInput = groups.unpackVisualOperationGroups(graph).graph;
      assert.deepEqual(api(JSON.parse(JSON.stringify(graph))), api(flatInput));
    }
    const flat = groups.unpackVisualOperationGroups(graph).graph;
    for (const recipe of flat.nodes.filter((node) => node.data.action === 'DiffusersExecutionRecipe'))
      assert.equal(recipe.data.params.attention_backend.value, 'auto', `${row.id}:fresh attention`);
    for (const attentionBackend of ['_native_math', '_native_flash']) {
      const authoredGraph = builder.createTemplateOperationGraph(
        template,
        { ...form, attentionBackend },
        starter,
        fixture.registry,
        spec,
        capability,
      );
      const authoredRecipes = groups
        .unpackVisualOperationGroups(authoredGraph)
        .graph.nodes.filter((node) => node.data.action === 'DiffusersExecutionRecipe');
      for (const authoredRecipe of authoredRecipes)
        assert.equal(authoredRecipe.data.params.attention_backend.value, attentionBackend);
    }
    assert.ok(
      !flat.nodes.some((node) => node.data.module === 'modules.DiffusersVideo' && node.data.action === 'Generate'),
    );
    const encoder = flat.nodes.find((node) => node.data.action === 'EncodeInputs');
    const denoiser = flat.nodes.find((node) => node.data.action === 'Denoise');
    assert.equal(encoder.data.params.prompt.value, form.prompt);
    assert.deepEqual(denoiser.data.params.seed.value, { value: form.seed, isRandom: false });
    for (const [key, value] of [
      ['width', form.width],
      ['height', form.height],
      ['num_frames', form.numFrames],
      ['num_inference_steps', form.steps],
    ])
      assert.equal(denoiser.data.params[key].value, value, `${row.id}:${key}`);
    const decoder = flat.nodes.find((node) => node.data.action === 'DecodeLatents');
    const exportNode = flat.nodes.find(
      (node) => node.data.module === 'modules.Video' && node.data.action.startsWith('Export'),
    );
    assert.ok(decoder && exportNode, 'real video decode and delivery are retained');
    const videoWire = flat.edges.find((edge) => edge.target === exportNode.id && edge.targetHandle === 'video');
    if (template.workflowBlocks?.includes('upscaler')) {
      const upscale = flat.nodes.find((node) => node.data.module === 'modules.Spandrel');
      assert.deepEqual(upscale.data.params.model_id.value, template.workflowBlockSettings.upscaler.model);
      assert.equal(videoWire.source, upscale.id);
      assert.ok(flat.edges.some((edge) => edge.source === decoder.id && edge.target === upscale.id));
      assert.equal(
        graph.nodes.filter((node) => groups.visualOperationGroup(node) === 'output').length,
        1,
        'an interposed upscale keeps its own stage before Video Output',
      );
    } else assert.equal(videoWire.source, decoder.id);
    if (template.workflowBlocks?.includes('soundtrack')) {
      assert.equal(exportNode.data.action, 'ExportWithAudio');
      const soundtrack = flat.nodes.find(
        (node) => node.data.module === 'modules.DiffusersAudio' && node.data.action === 'Generate',
      );
      const fit = flat.nodes.find((node) => node.data.module === 'modules.Audio' && node.data.action === 'FitDuration');
      const audioOwner = flat.nodes.find(
        (node) => node.data.module === 'modules.DiffusersAudio' && node.data.action === 'LoadPipeline',
      );
      const settings = template.workflowBlockSettings.soundtrack;
      assert.equal(soundtrack.data.params.prompt.value, settings.prompt);
      assert.equal(soundtrack.data.params.seed.value, settings.seed);
      assert.deepEqual(audioOwner.data.params.model_id.value, {
        source: settings.model.source,
        value: settings.model.value,
      });
      assert.equal(audioOwner.data.params.revision.value, settings.model.revision);
      assert.equal(fit.data.params.target_duration_seconds.value, settings.audioFit.targetDurationSeconds);
      assert.ok(
        flat.edges.some(
          (edge) => edge.source === soundtrack.id && edge.target === fit.id && edge.targetHandle === 'audio',
        ),
      );
      assert.ok(
        flat.edges.some(
          (edge) => edge.source === fit.id && edge.target === exportNode.id && edge.targetHandle === 'audio',
        ),
      );
      assert.equal(
        graph.nodes.filter((node) => groups.visualOperationGroup(node) === 'output').length,
        0,
        'independently generated audio is not presented as a joint decoder',
      );
    }
  }
});

test('new single-shot templates expose the agreed source, mask, generate and delivery stages', () => {
  const parsed = nodes.parseStudioModelCapabilities(fixture.publicPayload);
  for (const row of fixture.recipes.filter(
    (row) => row.spec && (row.id.startsWith('wan_vace_') || row.id === 'wan_22_i2v_seed_vault'),
  )) {
    const template = templates.find((item) => item.id === row.id);
    const capability = parsed.capabilities.find((item) => item.modelType === template.modelType);
    const spec = capability.studioExecutionSpecs.find((item) => item.mode === template.mode);
    const form = {
      ...defaults,
      ...exactness.getTemplateLockedSettings(template),
      device: 'cpu:0',
      offloadMode: 'none',
      autoOffload: false,
      referenceImages: ['images/reference.png'],
      sourceVideo: 'videos/source.mp4',
      controlVideo: 'videos/control.mp4',
      maskVideo: 'videos/mask.mp4',
    };
    const graph = builder.createTemplateOperationGraph(template, form, row.starter, fixture.registry, spec, capability);
    const kinds = graph.nodes.map((node) => groups.visualOperationGroup(node));
    for (const kind of ['setup', 'inputs', 'generate', 'output']) assert.ok(kinds.includes(kind), `${row.id}:${kind}`);
    if (
      ['video_color_edit', 'video_to_video', 'video_inpaint', 'video_outpaint', 'control_to_video'].includes(
        template.mode,
      )
    ) {
      const input = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'videoInput');
      assert.ok(input, row.id);
      const file = input.data.blockInstanceV2.effectiveInterface.controls.find(
        (control) => control.binding.fieldId === 'file',
      );
      assert.ok(file, `${row.id}: the source picker and its inline preview remain available`);
      const load = input.data.blockInstanceV2.effectiveGraph.nodes.find((node) => node.nodeId === file.binding.nodeId);
      assert.ok(load.data.params.file.fieldOptions.fileTypes.includes('video'));
    }
    if (['video_inpaint', 'video_outpaint'].includes(template.mode)) assert.ok(kinds.includes('mask'), row.id);
    if (template.mode === 'video_inpaint') assert.ok(kinds.includes('references'), row.id);
    if (template.mode === 'image_to_video') assert.ok(kinds.includes('imageInput'), row.id);
    const flat = groups.unpackVisualOperationGroups(graph).graph;
    if (template.mode === 'video_outpaint') {
      const canvas = flat.nodes.find((node) => node.data.action === 'OutpaintCanvas');
      assert.equal(canvas.data.params.preparation.value, 'prepared');
      assert.equal(canvas.data.params.prepared_mask_file.value, form.maskVideo);
      for (const field of ['preparation', 'prepared_mask_file', 'left', 'right', 'top', 'bottom'])
        assert.ok(
          graph.nodes
            .find((node) => groups.visualOperationGroup(node) === 'mask')
            .data.blockInstanceV2.effectiveInterface.controls.some((control) => control.binding.fieldId === field),
        );
      const encoder = flat.nodes.find((node) => node.data.action === 'EncodeInputs');
      assert.ok(
        flat.edges.some(
          (edge) =>
            edge.source === canvas.id &&
            edge.sourceHandle === 'canvas' &&
            edge.target === encoder.id &&
            edge.targetHandle === 'video',
        ),
      );
    }
    const actual = flat.nodes.find(
      (node) => node.data.action === (template.modelType === 'WanVACEPipeline' ? 'Generate' : 'Denoise'),
    );
    const seed = actual.data.params.seed.value;
    assert.equal(typeof seed === 'object' ? seed.value : seed, form.seed);
    assert.equal(actual.data.params.num_inference_steps.value, form.steps);
    assert.deepEqual(api(JSON.parse(JSON.stringify(graph))), api(flat));
  }
});

test('soundtrack field projection preserves managed selector metadata and exact fresh-field revision', async () => {
  const values = await server.ssrLoadModule('/src/studio/controlledWorkflowValues.ts');
  const settings = templates.find((item) => item.id === 'wan_22_ti2v_5b_seed_vault').workflowBlockSettings.soundtrack;
  const fresh = values.soundtrackWorkflowFieldValues(settings, defaults);
  const managed = values.soundtrackWorkflowFieldValues(settings, defaults, { retainSelectorMetadata: true });
  const value = (set, field) => set.pipeline.find((row) => row.fields.includes(field)).value;
  assert.deepEqual(value(managed, 'model_id'), settings.model);
  assert.equal(value(managed, 'model_id').revision, '200ba991ae448051e14b0183157e35c2d27c9fb0');
  assert.deepEqual(value(fresh, 'model_id'), { source: settings.model.source, value: settings.model.value });
  assert.equal(value(fresh, 'revision'), settings.model.revision);
  assert.equal(value(managed, 'revision'), settings.model.revision);
});

test('joint video output keeps audio connected and refuses an independently supplied soundtrack', () => {
  const row = fixture.recipes.find((row) => row.starter.task.includes('audio'));
  const graph = graphFor(row);
  graph.edges.find((edge) => edge.target === 'video-export' && edge.targetHandle === 'audio').source = 'external-audio';
  const result = groups.groupNewOperationGraph(graph);
  assert.equal(
    result.nodes.some((node) => groups.visualOperationGroup(node) === 'output'),
    false,
  );
});

test('the exact VACE catalog keeps whole-operation drafts separate from encoded-stage alternatives', () => {
  const operations = contracts.parseOperationContracts(fixture.publicPayload.operationContracts, 3);
  const original = fixture.unboundVace.starter;
  const parse = (value) => starterParser.parseOperationStarter(value, value.pipelineClass, value.task, operations);
  assert.equal(parse(original).nodes.length, 2);
  const whole = original.nodes.find((node) => node.node.action === 'Generate');
  assert.equal(whole.operation.operationId, 'diffusion.generate_video');
  assert.equal(whole.operation.decomposition, 'pipeline');
  const mixed = structuredClone(original);
  const staged = fixture.recipes.find((row) => row.id === 'wan_vace_grayscale_control').starter;
  mixed.nodes.push(structuredClone(staged.nodes.find((node) => node.operation.nodeType === 'video_encoder')));
  mixed.edges.push(structuredClone(staged.edges.find((edge) => edge.targetHandle === 'pipeline')));
  assert.throws(() => parse(mixed), 'a partial mixture never becomes either declared route');
  assert.deepEqual(fixture.unboundVace.starter, original);
});

test('selected video starters reject missing ownership wires, partial stages and foreign task metadata', () => {
  const operations = contracts.parseOperationContracts(fixture.publicPayload.operationContracts, 3);
  for (const row of fixture.recipes.filter((item) => item.spec)) {
    const rendered = row.starter.pipelineClass === 'WanVACEPipeline';
    const parse = (value) =>
      starterParser.parseOperationStarter(value, value.pipelineClass, value.task, operations, {
        executionProfileId: row.spec.executionProfileId,
        authoringRecipeId: 'generic-video-stages:v1',
      });
    for (const field of rendered
      ? ['encoded_inputs', 'pipeline']
      : ['encoded_inputs', 'latent_binding', 'latents', 'pipeline']) {
      const value = structuredClone(row.starter);
      const index = value.edges.findIndex((edge) => edge.targetHandle === field);
      assert.ok(index >= 0);
      value.edges.splice(index, 1);
      assert.throws(() => parse(value), `${row.id}: missing ${field}`);
    }
    for (const change of [
      (value) => value.nodes.push(structuredClone(value.nodes[0])),
      (value) =>
        (value.nodes.find((item) => item.operation.nodeType === 'denoise').operation.task = 'foreign_video_task'),
      (value) =>
        value.edges.push(
          structuredClone(
            value.edges.find((edge) => edge.targetHandle === (rendered ? 'encoded_inputs' : 'latent_binding')),
          ),
        ),
    ]) {
      const value = structuredClone(row.starter);
      change(value);
      assert.throws(() => parse(value));
    }
  }
});

test('the same video stages preserve authored prompt and sampling values across LTX and Wan model changes', () => {
  const rows = ['ltx_video_text_to_video', 'wan_22_ti2v_5b_seed_vault'].map((id) =>
    fixture.recipes.find((row) => row.id === id),
  );
  for (const [source, target] of [rows, [...rows].reverse()]) {
    const graph = graphFor(source);
    const encoder = graph.nodes.find((node) => node.data.action === 'EncodeInputs');
    const denoiser = graph.nodes.find((node) => node.data.action === 'Denoise');
    encoder.data.params.prompt.value = 'An amber paper boat travels slowly across a quiet pond.';
    denoiser.data.params.seed.value = { value: 714, isRandom: false };
    denoiser.data.params.num_frames.value = 81;
    // Ordinary setParam records an explicit edit even when the chosen value
    // equals the old model's default. Preserve that real authoring intent.
    authoring.operationAuthoring(denoiser).authored = ['seed', 'num_frames'];
    const owner = graph.nodes.find((node) => node.data.action === 'LoadPipeline');
    const original = structuredClone(graph);
    const changed = authoring.planOperationChange(graph, owner.id, target.starter, {
      replaceModel: true,
      baseline: source.starter,
    });
    assert.deepEqual(graph, original);
    for (const action of ['EncodeInputs', 'Denoise', 'DecodeLatents'])
      assert.equal(changed.graph.nodes.filter((node) => node.data.action === action).length, 1);
    assert.equal(
      changed.graph.nodes.find((node) => node.data.action === 'EncodeInputs').data.params.prompt.value,
      encoder.data.params.prompt.value,
    );
    assert.deepEqual(
      changed.graph.nodes.find((node) => node.data.action === 'Denoise').data.params.seed.value,
      denoiser.data.params.seed.value,
    );
    assert.equal(changed.graph.nodes.find((node) => node.data.action === 'Denoise').data.params.num_frames.value, 81);
    assert.ok(changed.graph.edges.some((edge) => edge.target === 'video-export' && edge.targetHandle === 'video'));
  }
});

test('video output requires a real file-backed video exporter', () => {
  for (const mutate of [
    (sink) => {
      sink.data.module = 'modules.Unknown';
    },
    (sink) => {
      sink.data.params.preview.display = 'ui_image';
    },
    (sink) => {
      sink.data.params.file.type = 'image';
    },
    (sink) => {
      sink.data.params.preview.dataSource = 'unrelated';
    },
  ]) {
    const graph = graphFor(fixture.recipes[0]);
    mutate(graph.nodes.find((node) => node.id === 'video-export'));
    assert.equal(
      groups.groupNewOperationGraph(graph).nodes.some((node) => groups.visualOperationGroup(node) === 'output'),
      false,
    );
  }
});

test('video output wording follows the declared decoder after removing the preview', () => {
  const result = groups.groupNewOperationGraph(
    graphFor(fixture.recipes.find((row) => row.starter.task.includes('audio'))),
  );
  const output = result.nodes.find((node) => groups.visualOperationGroup(node) === 'output');
  assert.ok(output);
  output.data.blockInstanceV2.effectiveGraph.nodes = output.data.blockInstanceV2.effectiveGraph.nodes.filter(
    (node) => node.data.module !== 'modules.Video',
  );
  assert.deepEqual(projection.visualStagePresentation('output', projection.visualOperationGroupMedia(output)), {
    label: 'Video Output',
    name: 'video output',
  });
});

test('fresh task drafts retain the real exporter and the adjacent decoder in their selected stages', () => {
  for (const row of fixture.recipes.filter((item) => item.spec && item.starter.task === 'text_to_video')) {
    const starter = structuredClone(row.starter);
    for (const { node } of starter.nodes)
      if (String(node.params.device?.value ?? node.params.device?.default).startsWith('cpu')) {
        if (node.params.offload_mode) node.params.offload_mode.value = 'none';
        if (node.params.auto_offload) node.params.auto_offload.value = false;
      }
    const { graph } = drafts.createWorkflowDraft(starter, fixture.registry);
    const output = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'output');
    assert.ok(output, row.id);
    const leaves = output.data.blockInstanceV2.effectiveGraph.nodes;
    const generate = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'generate');
    assert.ok(generate.data.blockInstanceV2.effectiveGraph.nodes.some((node) => node.data.action === 'DecodeLatents'));
    assert.ok(!leaves.some((node) => node.data.action === 'DecodeLatents'));
    assert.ok(leaves.some((node) => node.data.module === 'modules.Video' && node.data.action === 'ExportAsset'));
    assert.equal(output.data.blockInstanceV2.previewStates[0].binding.mediaType, 'video');
    assert.deepEqual(api(graph), api(groups.unpackVisualOperationGroups(graph).graph));
  }
});

test('fresh video drafts connect declared image and video sources without changing the starter', () => {
  for (const row of fixture.recipes.filter((item) => item.spec && item.starter.task !== 'text_to_video')) {
    const starter = structuredClone(row.starter);
    // The no-weight fixture is CPU-only; retain the ordinary export boundary.
    for (const { node } of starter.nodes)
      if (String(node.params.device?.value ?? node.params.device?.default).startsWith('cpu')) {
        if (node.params.offload_mode) node.params.offload_mode.value = 'none';
        if (node.params.auto_offload) node.params.auto_offload.value = false;
      }
    const original = structuredClone(starter);
    const { graph, notices } = drafts.createWorkflowDraft(starter, fixture.registry);
    assert.deepEqual(starter, original);
    assert.deepEqual(notices, [], row.id);
    const flat = groups.unpackVisualOperationGroups(graph).graph;
    for (const node of flat.nodes) {
      const source = original.nodes.find(
        (item) => item.operation.operationId === node.data.operationAuthoring?.operation.operationId,
      );
      for (const field of ['guidance_scale', 'num_inference_steps'])
        if (source && node.data.params[field])
          assert.equal(
            node.data.params[field].value ?? node.data.params[field].default,
            source.node.params[field].value ?? source.node.params[field].default,
            `${row.id}/${node.data.action}/${field}`,
          );
    }
    const kinds = new Set();
    for (const input of row.starter.requiredInputs) {
      const target = flat.nodes.find(
        (node) => node.data.operationAuthoring?.operation.operationId === input.operationId,
      );
      const types =
        target?.data.operationAuthoring.operation.ports.find((port) => port.name === input.field)?.types ?? [];
      const kind = types.includes('image') ? 'image' : types.includes('video') ? 'video' : null;
      if (!kind) continue;
      kinds.add(kind);
      const wires = flat.edges.filter((edge) => edge.target === target.id && edge.targetHandle === input.field);
      assert.equal(wires.length, 1, `${row.id}:${input.field}`);
      const source = flat.nodes.find((node) => node.id === wires[0].source);
      assert.equal(source.data.module, kind === 'video' ? 'modules.Video' : 'modules.Image');
      assert.equal(source.data.action, 'Load');
      assert.equal(target.data.action, 'EncodeInputs');
    }
    assert.deepEqual(api(graph), api(flat));
    for (const kind of kinds) {
      const unavailable = { ...fixture.registry };
      const module = kind === 'video' ? 'modules.Video' : 'modules.Image';
      delete unavailable[`${module}.Load`];
      const missing = drafts.createWorkflowDraft(starter, unavailable);
      assert.ok(missing.notices.some((message) => message.includes('loader is unavailable or incompatible')));
      assert.ok(
        !groups
          .unpackVisualOperationGroups(missing.graph)
          .graph.nodes.some((node) => node.data.module === module && node.data.action === 'Load'),
      );
    }
  }
});

test('existing video stages offer declared media attachment and lower a video loader to the same graph', async () => {
  const attachment = await server.ssrLoadModule('/src/workflow/mediaAttachment.ts');
  const sources = await server.ssrLoadModule('/src/workflow/mediaAttachmentSources.ts');
  const row = fixture.recipes.find((item) => item.id === 'ltx_video_video_to_video');
  const operations = row.starter.nodes.map((item) => item.operation);
  const choices = attachment.mediaAttachmentChoices(operations, row.starter.pipelineClass);
  const choice = choices.find((item) => item.kind === 'video' && item.role === 'video');
  assert.ok(choice, 'a declared video task must not disappear from Add media');
  const graph = graphFor(row);
  const owner = graph.nodes.find((node) => contracts.operationOwnsModel(node.data.operationAuthoring?.operation));
  const original = structuredClone(graph);
  const next = attachment.planMediaAttachment(graph, owner.id, row.starter, choice, fixture.registry);
  assert.deepEqual(graph, original, 'planning never mutates the retained workflow');
  const input = next.nodes.find((node) => node.data.module === 'modules.Video' && node.data.action === 'Load');
  assert.ok(input);
  const encode = next.nodes.find((node) => node.data.action === 'EncodeInputs');
  assert.ok(
    next.edges.some(
      (edge) =>
        edge.source === input.id &&
        edge.sourceHandle === 'video' &&
        edge.target === encode.id &&
        edge.targetHandle === 'video',
    ),
  );
  assert.ok(
    sources
      .mediaAttachmentSources(next.nodes, next.edges, 'video')
      .some((source) => source.value === JSON.stringify([input.id, 'video'])),
  );
  const repeated = attachment.planMediaAttachment(next, owner.id, row.starter, choice, fixture.registry, {
    nodeId: input.id,
    handleId: 'video',
  });
  assert.deepEqual(repeated, next, 'choosing the already-connected source is idempotent');
  assert.throws(
    () =>
      attachment.planMediaAttachment(next, owner.id, row.starter, choice, fixture.registry, {
        nodeId: 'video-export',
        handleId: 'file',
      }),
    /already connected/u,
  );
  assert.throws(
    () =>
      attachment.planMediaAttachment(graph, owner.id, row.starter, choice, fixture.registry, {
        nodeId: 'video-export',
        handleId: 'file',
      }),
    /cycle/u,
  );
  assert.deepEqual(graph, original, 'failed attachment leaves all values and wires intact');
});

test('video task media discovery includes real image roles but excludes components and hidden ports', async () => {
  const attachment = await server.ssrLoadModule('/src/workflow/mediaAttachment.ts');
  const row = fixture.recipes.find((item) => item.id === 'ltx_video_image_to_video');
  const operations = row.starter.nodes.map((item) => item.operation);
  const original = structuredClone(operations);
  const choices = attachment.mediaAttachmentChoices(operations, row.starter.pipelineClass);
  assert.ok(choices.some((item) => item.kind === 'image'));
  assert.ok(!choices.some((item) => /pipeline|latent|encoded/u.test(item.role)));
  assert.deepEqual(operations, original);
  assert.deepEqual(attachment.mediaAttachmentChoices(operations, 'foreign'), []);
});

test('ordinary video template creation reaches real stages and checkpoints their exact saved graph', async (t) => {
  const lifecycle = await server.ssrLoadModule('/src/studio/templateWorkflow.ts');
  const studioModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const studio = studioModule.useStudioStore;
  const flow = exporter.useFlowStore;
  const registry = nodes.useNodesStore;
  const parsed = nodes.parseStudioModelCapabilities(fixture.publicPayload);
  const operations = contracts.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  for (const row of fixture.recipes.filter((item) => item.spec))
    await t.test(row.id, async () => {
      const previous = [studio.getState(), flow.getState(), registry.getState()];
      const originalFetch = globalThis.fetch;
      try {
        const template = templates.find((item) => item.id === row.id);
        studio.setState({ workflowCanvasHydrated: true });
        const tabId = studio.getState().createWorkflowTab(template.label, undefined, 'template', template.id);
        studio.getState().applyTemplate(template);
        studio.getState().updateForm({
          device: 'cpu:0',
          offloadMode: 'none',
          autoOffload: false,
          referenceImages: ['images/reference.webp'],
          sourceVideo: 'videos/source.mp4',
        });
        registry.setState({
          nodesRegistry: fixture.registry,
          operationContracts: operations,
          studioModelCapabilities: parsed.capabilities,
          studioExecutionSpecInvalid: false,
        });
        const requests = [];
        globalThis.fetch = async (url, init) => {
          if (String(url).endsWith('/operations/starter')) {
            const request = JSON.parse(init.body);
            requests.push(request);
            const selected = [row, ...secondaryFixture.recipes].find(
              (item) => item.starter.pipelineClass === request.pipelineClass && item.starter.task === request.task,
            );
            assert.ok(selected, 'the actual primary or secondary model must be explicitly requested');
            return Response.json(selected.starter);
          }
          return Response.json(row.starter);
        };
        const form = structuredClone(studio.getState().form);
        await lifecycle.createTemplateOperationWorkflow(template, form, studioModule.captureWorkflowOperationContext());
        assert.equal(requests.length, template.workflowBlocks?.includes('soundtrack') ? 2 : 1);
        const graph = flow.getState().toObject();
        const flat = groups.unpackVisualOperationGroups(graph).graph;
        const rendered = row.starter.pipelineClass === 'WanVACEPipeline';
        for (const action of rendered
          ? ['LoadPipeline', 'EncodeInputs', 'Generate']
          : ['LoadPipeline', 'EncodeInputs', 'Denoise', 'DecodeLatents'])
          assert.equal(
            flat.nodes.filter((node) => node.data.module === 'modules.DiffusersVideo' && node.data.action === action)
              .length,
            1,
          );
        assert.ok(
          rendered ||
            !flat.nodes.some(
              (node) => node.data.module === 'modules.DiffusersVideo' && node.data.action === 'Generate',
            ),
        );
        const encoder = flat.nodes.find((node) => node.data.action === 'EncodeInputs');
        assert.equal(encoder.data.params.prompt.value, form.prompt);
        assert.equal(studio.getState().graphBinding, null);
        const saved = structuredClone(studio.getState().workflowTabs.find((tab) => tab.id === tabId));
        assert.equal(saved.source, 'template');
        assert.equal(saved.snapshot.activeTemplateId, template.id);
        assert.equal(saved.snapshot.studioGraphBinding, null);
        const before = flow.getState().exportGraph('saved-video-template', undefined, { randomizeSeeds: false });
        const events = Object.keys(before.nodes).map((node) => ({
          type: 'executed',
          task_id: 'video-receipt-contract',
          node,
          status: 'succeeded',
          hasChanged: true,
        }));
        const output = { taskId: 'video-receipt-contract', apiGraphSnapshot: before };
        const receipts = executionReceiptsForRun(template, output, events);
        assert.equal(receipts.filter((item) => item.action === (rendered ? 'Generate' : 'Denoise')).length, 1);
        const tampered = structuredClone(output);
        const sampler = Object.values(tampered.apiGraphSnapshot.nodes).find(
          (node) => node.action === (rendered ? 'Generate' : 'Denoise'),
        );
        sampler.params.pipeline.sourceId = 'foreign-owner';
        assert.throws(() => executionReceiptsForRun(template, tampered, events), /foreign encoding owner/);
        studio.setState({ workflowTabs: [], activeWorkflowTabId: tabId });
        studio.getState().mergeBackendWorkflow({ ...saved, revision: 1 });
        studio.getState().hydrateActiveWorkflowCanvas();
        assert.deepEqual(
          flow.getState().exportGraph('saved-video-template', undefined, { randomizeSeeds: false }),
          before,
        );
        assert.equal(studio.getState().form.prompt, form.prompt);
      } finally {
        globalThis.fetch = originalFetch;
        studio.setState(previous[0], true);
        flow.setState(previous[1], true);
        registry.setState(previous[2], true);
      }
    });
});
