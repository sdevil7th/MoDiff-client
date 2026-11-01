import assert from 'node:assert/strict';
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
  drafts;
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
  ].map(([pipelineClass, task]) => ({ id: `${pipelineClass}:${task}`, selection: { pipelineClass, task } }));
  for (const [id, modelType, pipelineClass, profile, task] of [
    ['ltx_video_text_to_video', 'LTXVideoPipeline', 'LTXConditionPipeline', 'ltx-video:direct', 'text_to_video'],
    ['ltx_video_image_to_video', 'LTXVideoPipeline', 'LTXConditionPipeline', 'ltx-video:direct', 'image_to_video'],
    ['ltx_video_video_to_video', 'LTXVideoPipeline', 'LTXConditionPipeline', 'ltx-video:direct', 'video_to_video'],
    ['ltx_video_multi_reference', 'LTXVideoPipeline', 'LTXConditionPipeline', 'ltx-video:direct', 'reference_to_video'],
    ['wan_22_ti2v_5b_seed_vault', 'WanTI2VPipeline', 'WanTI2VPipeline', 'wan-22-ti2v-5b:direct', 'text_to_video'],
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
  ({ STUDIO_TEMPLATES: templates } = await server.ssrLoadModule('/src/studio/templates.ts'));
  builder = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  ({ DEFAULT_STUDIO_FORM: defaults } = await server.ssrLoadModule('/src/studio/modelProfiles.ts'));
});
after(async () => server?.close());

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

function api(graph) {
  const result = exporter.useFlowStore
    .getState()
    .exportGraph('video-stage-contract', undefined, { sourceGraph: graph, randomizeSeeds: false });
  const names = new Map(Object.entries(result.nodes).map(([id, node]) => [id, `${node.module}.${node.action}`]));
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

test('five retained video template factories preserve creative settings on their exact staged starters', () => {
  const parsed = nodes.parseStudioModelCapabilities(fixture.publicPayload);
  const operations = contracts.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  for (const row of fixture.recipes.filter((row) => row.spec)) {
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
    const flat = groups.unpackVisualOperationGroups(graph).graph;
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
    const exportNode = flat.nodes.find((node) => node.data.module === 'modules.Video');
    assert.ok(decoder && exportNode, 'real video decode and delivery are retained');
    const videoWire = flat.edges.find((edge) => edge.target === exportNode.id && edge.targetHandle === 'video');
    if (template.workflowBlocks?.includes('upscaler')) {
      const upscale = flat.nodes.find((node) => node.data.module === 'modules.Spandrel');
      assert.deepEqual(upscale.data.params.model_id.value, template.workflowBlockSettings.upscaler.model);
      assert.equal(videoWire.source, upscale.id);
      assert.ok(flat.edges.some((edge) => edge.source === decoder.id && edge.target === upscale.id));
      assert.equal(
        graph.nodes.filter((node) => groups.visualOperationGroup(node) === 'output').length,
        0,
        'an interposed upscale remains a genuine separate stage',
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

test('selected video starters reject missing ownership wires, partial stages and foreign task metadata', () => {
  const operations = contracts.parseOperationContracts(fixture.publicPayload.operationContracts, 3);
  for (const row of fixture.recipes.filter((item) => item.spec)) {
    const parse = (value) =>
      starterParser.parseOperationStarter(value, value.pipelineClass, value.task, operations, {
        executionProfileId: row.spec.executionProfileId,
        authoringRecipeId: 'generic-video-stages:v1',
      });
    for (const field of ['encoded_inputs', 'latent_binding', 'latents', 'pipeline']) {
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
      (value) => value.edges.push(structuredClone(value.edges.find((edge) => edge.targetHandle === 'latent_binding'))),
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

test('fresh task drafts group the real retained-video exporter with their decoder', () => {
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
    assert.ok(leaves.some((node) => node.data.action === 'DecodeLatents'));
    assert.ok(leaves.some((node) => node.data.module === 'modules.Video' && node.data.action === 'ExportAsset'));
    assert.equal(output.data.blockInstanceV2.previewStates[0].binding.mediaType, 'video');
    assert.deepEqual(api(graph), api(groups.unpackVisualOperationGroups(graph).graph));
  }
});
