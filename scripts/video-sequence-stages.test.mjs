import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { executionReceiptsForRun } from './template-gallery-runner.mjs';

let server,
  fixture,
  templates,
  builder,
  exactness,
  defaults,
  capabilities,
  flow,
  shared,
  secondary,
  runtime,
  fieldActions,
  moonflowerScenes,
  controlConnections;
const cases = [
  ['wan_21_t2v_13b_seed_vault', 6],
  ['ltx_video_long_showcase', 6],
  ['wan_video_long_showcase', 5],
  ['ltx_video_animated_story', 3],
  ['ace_step_lyric_music_video', 9],
];
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { location: { origin: 'http://127.0.0.1:5191' }, dispatchEvent: () => true, localStorage };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  ({ STUDIO_TEMPLATES: templates } = await server.ssrLoadModule('/src/studio/templates.ts'));
  builder = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  ({ DEFAULT_STUDIO_FORM: defaults } = await server.ssrLoadModule('/src/studio/modelProfiles.ts'));
  flow = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  shared = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
  secondary = await server.ssrLoadModule('/src/studio/templateSecondaryStages.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  fieldActions = await server.ssrLoadModule('/src/studio/visualStageFieldActions.ts');
  ({ MOONFLOWER_SCENES: moonflowerScenes } = await server.ssrLoadModule('/src/studio/moonflowerRecipe.ts'));
  controlConnections = await server.ssrLoadModule('/src/studio/blockControlConnectionsV2.ts');
  const parser = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  const backend = process.env.MODIFF_BACKEND_DIR || path.resolve('../MoDiff');
  const python = process.env.MODIFF_BACKEND_PYTHON || path.join(backend, '.venv', 'Scripts/python.exe');
  fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: backend,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 64 * 1024 ** 2,
      input: JSON.stringify([
        ...cases.map(([id]) => ({ id, selection: templates.find((row) => row.id === id).executionSelection })),
        {
          id: 'moonflower-visual',
          selection: {
            pipelineClass: 'LTXConditionPipeline',
            task: 'image_to_video',
            executionProfileId: 'ltx-video:direct',
            authoringRecipeId: 'generic-video-stages:v1',
            bindingSpec: { modelType: 'LTXVideoPipeline', mode: 'image_to_video' },
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
  capabilities = parser.parseStudioModelCapabilities(fixture.publicPayload).capabilities;
});
after(async () => server?.close());

test('secondary visuals use the exact pinned backend starter and reject a foreign model', async () => {
  const template = templates.find((row) => row.id === 'ace_step_lyric_music_video');
  const visual = fixture.recipes.find((row) => row.id === 'moonflower-visual').starter;
  const requests = [];
  const resolved = await secondary.templateSecondaryVideoStages(
    template,
    fixture.registry,
    capabilities,
    [],
    async (...args) => {
      requests.push(args);
      return structuredClone(visual);
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], 'LTXConditionPipeline');
  assert.equal(requests[0][1], 'image_to_video');
  assert.equal(requests[0][5], 'generic-video-stages:v1');
  assert.equal(resolved.video.starter.pipelineClass, visual.pipelineClass);
  assert.notEqual(resolved.registry, fixture.registry);
  await assert.rejects(
    () =>
      secondary.templateSecondaryVideoStages(template, fixture.registry, capabilities, [], async () => {
        const wrong = structuredClone(visual);
        wrong.nodes.find((row) => row.node.action === 'LoadPipeline').node.params.revision.value = 'f'.repeat(40);
        return wrong;
      }),
    /different immutable visual model/,
  );
});

function create(id, revise = (template) => template) {
  const template = revise(structuredClone(templates.find((row) => row.id === id))),
    row = fixture.recipes.find((row) => row.id === id);
  const capability = capabilities.find((row) => row.modelType === template.modelType);
  const spec = capability.studioExecutionSpecs.find((row) => row.mode === template.executionSelection.bindingSpec.mode);
  const form = {
    ...defaults,
    ...exactness.getTemplateLockedSettings(template),
    device: 'cpu:0',
    offloadMode: 'none',
    autoOffload: false,
    referenceImages: Array.from({ length: 10 }, (_, index) => `images/shot-${index + 1}.png`),
  };
  const visual = fixture.recipes.find((row) => row.id === 'moonflower-visual');
  const visualCapability = capabilities.find((row) => row.modelType === 'LTXVideoPipeline');
  return {
    template,
    form,
    graph: builder.createTemplateOperationGraph(
      template,
      form,
      row.starter,
      fixture.registry,
      spec,
      capability,
      undefined,
      {
        secondaryVideo: {
          starter: visual.starter,
          spec: visualCapability.studioExecutionSpecs.find((row) => row.mode === 'image_to_video'),
          capability: visualCapability,
        },
      },
    ),
  };
}

test('all sequence templates arrange their shots in story order independently of generated IDs', async (t) => {
  const { arrangeGraphNodes } = await server.ssrLoadModule('/src/workflow/graphLayout.ts');
  for (const [id, count] of cases)
    await t.test(id, () => {
      const { graph } = create(id);
      const shots = graph.nodes.filter((node) => node.data.label.startsWith('Shot '));
      const identities = new Map(shots.map((node, index) => [node.id, `shot-${count - index}`]));
      const nodes = graph.nodes.map((node) => ({ ...node, id: identities.get(node.id) ?? node.id }));
      const edges = graph.edges.map((edge) => ({
        ...edge,
        source: identities.get(edge.source) ?? edge.source,
        target: identities.get(edge.target) ?? edge.target,
      }));
      const arranged = arrangeGraphNodes(nodes, edges);
      const shotIds = new Set(identities.values());
      const ordered = arranged.filter((node) => shotIds.has(node.id));
      ordered.sort((left, right) => left.position.y - right.position.y);
      assert.deepEqual(
        ordered.map((node) => node.data.label),
        shots.map((node) => node.data.label),
      );
      assert.deepEqual(arrangeGraphNodes(arranged, edges), arranged);
      assert.deepEqual(
        arranged.map((node) => node.data),
        nodes.map((node) => node.data),
      );
    });
});

test('every sequence has actual separate shot groups and one shared primary model', async (t) => {
  for (const [id, count] of cases)
    await t.test(id, () => {
      const { graph, template } = create(id);
      const shots = graph.nodes.filter((node) => node.data.label.startsWith('Shot '));
      assert.equal(shots.length, count);
      assert.equal(
        graph.nodes.filter((node) => node.data.label === 'Model Setup').length,
        id === 'ace_step_lyric_music_video' ? 2 : 1,
      );
      assert.equal(graph.nodes.filter((node) => node.data.action === 'Storyboard').length, 1);
      assert.ok(
        !graph.nodes.some((node) => node.data.action === 'ToList'),
        'ordering bookkeeping stays inside Assemble',
      );
      for (const shot of shots) {
        assert.equal(
          shot.data.blockInstanceV2.effectiveInterface.controls.length,
          0,
          'shot overview expands to the actual editable stages',
        );
        assert.equal(
          shot.data.blockInstanceV2.effectiveInterface.boundary.outputs.length,
          1,
          'only the real delivered shot crosses its outer boundary',
        );
        const supplied = graph.edges
          .filter((edge) => edge.target === shot.id)
          .map((edge) => `${edge.source}:${edge.sourceHandle}`);
        assert.equal(new Set(supplied).size, supplied.length, 'common external inputs have one public socket');
      }
      const flat = flow.expandFlowExecutionGraph(graph.nodes, graph.edges);
      const video = flat.nodes.filter((node) => node.data.module === 'modules.DiffusersVideo');
      assert.equal(video.filter((node) => node.data.action === 'LoadPipeline').length, 1);
      assert.ok(
        !graph.nodes.some((node) => node.data.module === 'modules.DiffusersRuntime'),
        'resource controls belong inside shared Model Setup',
      );
      const owner = video.find((node) => node.data.action === 'LoadPipeline');
      const recipe = flat.nodes.find(
        (node) =>
          node.data.action === 'DiffusersExecutionRecipe' &&
          flat.edges.some(
            (edge) => edge.source === node.id && edge.target === owner.id && edge.targetHandle === 'execution_recipe',
          ),
      );
      assert.ok(recipe, 'the shared loader must retain its genuine execution recipe');
      assert.ok(
        flat.edges.some((edge) => edge.target === recipe.id && edge.targetHandle === 'quantization_config'),
        'the genuine quantization config must remain wired',
      );
      for (const action of ['EncodeInputs', 'Denoise', 'DecodeLatents'])
        assert.equal(video.filter((node) => node.data.action === action).length, count, `${id}:${action}`);
      assert.ok(
        !video.some((node) => ['GenerateSequence', 'GenerateShotJob', 'BuildShotJobs'].includes(node.data.action)),
      );
      assert.ok(!flat.nodes.some((node) => node.data.module === 'modules.WorkflowControl'));
      assert.equal(flat.nodes.filter((node) => node.data.action === 'ExportAsset').length, count);
      if (template.mode === 'image_to_video')
        for (const shot of shots)
          assert.equal(
            shot.data.blockInstanceV2.effectiveGraph.nodes.filter(
              (node) => node.data.module === 'modules.Image' && node.data.action === 'Load',
            ).length,
            1,
          );
      const api = flow.useFlowStore
        .getState()
        .exportGraph('explicit-shots', undefined, { sourceGraph: graph, randomizeSeeds: false });
      const restored = flow.useFlowStore.getState().exportGraph('explicit-shots', undefined, {
        sourceGraph: JSON.parse(JSON.stringify(graph)),
        randomizeSeeds: false,
      });
      assert.deepEqual(restored, api);
      assert.ok(!api.loops);
      const events = Object.keys(api.nodes).map((node) => ({
        type: 'executed',
        task_id: 'explicit-receipts',
        node,
        status: 'succeeded',
        hasChanged: true,
      }));
      const output = { taskId: 'explicit-receipts', apiGraphSnapshot: api };
      const receipts = executionReceiptsForRun(template, output, events);
      assert.equal(receipts.filter((row) => row.action === 'Denoise').length, count);
      const last = receipts.filter((row) => row.action === 'Denoise').at(-1);
      assert.throws(
        () =>
          executionReceiptsForRun(
            template,
            output,
            events.filter((event) => event.node !== last.nodeId),
          ),
        /No execution receipt/,
      );
      assert.throws(
        () =>
          executionReceiptsForRun(
            template,
            output,
            events.map((event) =>
              event.node === last.nodeId ? { ...event, status: 'cached', hasChanged: false } : event,
            ),
          ),
        /cached output/,
      );
      const warm = events.map((event) =>
        Object.entries(api.nodes).some(([id, node]) => id === event.node && node.action === 'EncodeInputs')
          ? { ...event, status: 'cached', hasChanged: false }
          : event,
      );
      assert.equal(executionReceiptsForRun(template, output, warm).length, receipts.length);
      const partial = structuredClone(output);
      partial.apiGraphSnapshot.paths = partial.apiGraphSnapshot.paths.map((route) =>
        route.filter((id) => id !== last.nodeId),
      );
      assert.throws(() => executionReceiptsForRun(template, partial, events), /all .* authored shots/);
    });
});

test('every template shot uses the shared visual-stage field-action identity', async (t) => {
  for (const [id] of cases)
    await t.test(id, () => {
      const { graph } = create(id);
      for (const shot of graph.nodes.filter((node) => node.data.label.startsWith('Shot '))) {
        const instance = shot.data.blockInstanceV2;
        assert.equal(instance.definitionSnapshot.source.provider, 'modiff.visual-stages.storyboard.v1');
        const view = runtime.materializeBlockProjectionV2(
          runtime.createBlockRootNodeV2(
            runtime.setBlockPresentationV2(instance, { expanded: true, collapsedContainerNodeIds: [] }),
          ),
        );
        let controls = 0;
        for (const node of view.nodes)
          for (const [fieldKey, param] of Object.entries(node.data.params)) {
            if (param.hidden || !param.fieldOptions?.blockContainerControlV1) continue;
            controls++;
            const sources = fieldActions.visualStageFieldSources(view.nodes, {
              nodeId: node.id,
              fieldKey,
              module: node.data.module,
              action: node.data.action,
            });
            assert.ok(sources?.length, `${id}: ${node.data.label}.${fieldKey} needs its native owner`);
            assert.ok(sources.every((source) => source.node.data.module && source.node.data.action));
          }
        assert.ok(controls > 0, `${id} needs real editable inner-stage controls`);
      }
    });
});

test('Moonflower retains nine accepted scene records, ten ordered images and a 45-second song', () => {
  const { graph } = create('ace_step_lyric_music_video');
  const flat = flow.expandFlowExecutionGraph(graph.nodes, graph.edges);
  const audio = flat.nodes.find(
    (node) => node.data.module === 'modules.DiffusersAudio' && node.data.action === 'Generate',
  );
  assert.equal(audio.data.params.audio_duration.value, 45);
  assert.equal(audio.data.params.seed.value.value, 20261106);
  assert.equal(audio.data.params.bpm.value, 96);
  assert.equal(audio.data.params.keyscale.value, 'D major');
  assert.equal(audio.data.params.timesignature.value, '4', 'retain the accepted song’s literal conditioning text');
  assert.equal(audio.data.params.num_inference_steps.value, 8);
  assert.equal(audio.data.params.guidance_scale.value, 1);
  assert.equal(audio.data.params.shift.value, 3);
  assert.equal(audio.data.params.vocal_language.value, 'en');
  const overlay = flat.nodes.find((node) => node.data.action === 'LyricOverlay');
  assert.equal(overlay.data.params.enabled.value, false);
  const trim = flat.nodes.find((node) => node.data.action === 'Trim');
  assert.equal(trim.data.params.range_mode.value, 'frames');
  assert.equal(trim.data.params.end.value, 720);
  assert.equal(trim.data.params.fps.value, 16);
  const shots = graph.nodes
    .filter((node) => node.data.label.startsWith('Shot '))
    .sort((a, b) => Number(a.data.label.match(/^Shot (\d+)/)[1]) - Number(b.data.label.match(/^Shot (\d+)/)[1]));
  let offset = 0;
  for (const [index, shot] of shots.entries()) {
    const native = runtime.blockOperationGraphV2(shot.data.blockInstanceV2);
    const images = native.nodes.filter((node) => node.data.module === 'modules.Image' && node.data.action === 'Load');
    const count = moonflowerScenes[index].reference_count;
    const expected = Array.from({ length: count }, (_, index) => `images/shot-${offset + index + 1}.png`);
    const paths = images.flatMap((node) => node.data.params.file.value);
    assert.equal(images.length, 1, 'one ordered reference collection belongs to each shot');
    assert.deepEqual(paths, expected, `ordered references belong to ${shot.data.label}`);
    assert.ok(native.edges.some((edge) => edge.source === images[0].id && edge.targetHandle === 'reference_images'));
    offset += count;
  }
  assert.equal(offset, 10);
  assert.ok(flat.nodes.some((node) => node.data.module === 'modules.Audio' && node.data.action === 'Export'));
});

test('Run Shot retains its actual model and storyboard without rendering other shots', () => {
  const { graph } = create('wan_21_t2v_13b_seed_vault');
  const shot = graph.nodes.find((node) => node.data.label.startsWith('Shot 2 '));
  const api = flow.useFlowStore
    .getState()
    .exportGraph('one-shot', shot.id, { sourceGraph: graph, randomizeSeeds: false });
  const nodes = Object.values(api.nodes);
  assert.equal(nodes.filter((node) => node.action === 'Denoise').length, 1);
  assert.equal(nodes.filter((node) => node.action === 'LoadPipeline').length, 1);
  assert.equal(nodes.filter((node) => node.action === 'Storyboard').length, 1);
  assert.equal(nodes.filter((node) => node.action === 'ExportAsset').length, 1);
  assert.ok(!nodes.some((node) => ['ConcatenateAssets', 'Concatenate'].includes(node.action)));
});

test('frame count and conditioning edits use the actual sampler without storyboard overrides', () => {
  const { graph } = create('ltx_video_long_showcase');
  const flat = flow.expandFlowExecutionGraph(graph.nodes, graph.edges);
  const samplers = flat.nodes.filter((node) => node.data.action === 'Denoise');
  assert.equal(samplers.length, 6);
  for (const node of samplers) {
    assert.ok(
      !flat.edges.some((edge) => edge.target === node.id && ['num_frames', 'strength'].includes(edge.targetHandle)),
    );
    assert.equal(node.data.params.num_frames.value, 81);
  }
  const original = new Map(
    samplers.map((node) => [node.id, [node.data.params.num_frames.value, node.data.params.strength.value]]),
  );
  const store = flow.useFlowStore;
  store.getState().replaceGraph(JSON.parse(JSON.stringify(graph)));
  const shot = store.getState().nodes.find((node) => node.data.label.startsWith('Shot 1 '));
  const samplerId = runtime
    .blockOperationGraphV2(shot.data.blockInstanceV2)
    .nodes.find((node) => node.data.action === 'Denoise').id;
  store.getState().toggleUserBlockExpanded(shot.id);
  const generate = store.getState().nodes.find((node) => node.parentId === shot.id && node.data.label === 'Generate');
  for (const [label, value] of [
    ['Frames', 121],
    ['Condition strength', 0.85],
  ]) {
    const [field] = Object.entries(generate.data.params).find(
      ([, param]) => !param.hidden && param.label === label && param.display !== 'output',
    );
    store.getState().setParamWithHistory(generate.id, field, value);
  }
  const api = flow.useFlowStore.getState().exportGraph('edited-shot-controls', undefined, {
    sourceGraph: JSON.parse(JSON.stringify(store.getState().toObject())),
    randomizeSeeds: false,
  });
  assert.equal(api.nodes[samplerId].params.num_frames.value, 121);
  assert.equal(api.nodes[samplerId].params.strength.value, 0.85);
  for (const [id, node] of Object.entries(api.nodes).filter(([, node]) => node.action === 'Denoise')) {
    if (id !== samplerId)
      assert.deepEqual([node.params.num_frames.value, node.params.strength.value], original.get(id));
  }
  const storyboard = flat.nodes.find((node) => node.data.action === 'Storyboard');
  assert.ok(
    JSON.parse(storyboard.data.params.shots_json.value).every(
      (shot) => !('duration_seconds' in shot) && !('conditioning_strength' in shot),
    ),
  );
});

test('assembly preserves numeric shot order when storage canonicalizes object keys', () => {
  const { graph } = create('wan_21_t2v_13b_seed_vault', (template) => {
    template.workflowBlockSettings.qualityVideoSequence.shotsJson = JSON.stringify(
      Array.from({ length: 12 }, (_, index) => ({
        title: `Scene ${index + 1}`,
        prompt: `A railway scene ${index + 1}`,
        duration_seconds: 5.4,
      })),
    );
    return template;
  });
  const flat = flow.expandFlowExecutionGraph(graph.nodes, graph.edges);
  const list = flat.nodes.find((node) => node.data.module === 'modules.Primitive' && node.data.action === 'ToList');
  const labels = Object.keys(list.data.params)
    .sort()
    .filter((key) => key === 'item' || key.startsWith('item>>>'))
    .map((key) => list.data.params[key].label);
  assert.deepEqual(
    labels,
    Array.from({ length: 12 }, (_, index) => `Shot ${index + 1}`),
  );
});

test('guidance remains paired inside one shot under a shared model, including save/reopen', () => {
  const { graph } = create('wan_21_t2v_13b_seed_vault');
  const reopened = JSON.parse(JSON.stringify(graph));
  const flat = flow.expandFlowExecutionGraph(reopened.nodes, reopened.edges);
  const samplers = flat.nodes.filter((node) => node.data.action === 'Denoise');
  const groups = samplers.map((node) => shared.sharedOperationInput(flat.nodes, flat.edges, node.id, 'guidance_scale'));
  assert.ok(
    groups.every((group) => group?.members.length === 2),
    JSON.stringify(
      samplers.slice(0, 1).map((node) => ({
        id: node.id,
        shared: node.data.operationAuthoring.sharedInputs,
        owners: flat.nodes.filter((row) => row.data.action === 'LoadPipeline').map((row) => row.id),
        encoders: flat.nodes
          .filter((row) => row.data.action === 'EncodeInputs')
          .slice(0, 1)
          .map((row) => ({ id: row.id, shared: row.data.operationAuthoring.sharedInputs })),
      })),
    ),
  );
  assert.equal(new Set(groups.map((group) => group.key)).size, 6);
  const original = groups
    .slice(1)
    .map((group) => group.members.map(({ node, field }) => node.data.params[field].value));
  for (const { node, field } of groups[0].members) node.data.params[field].value = 8;
  shared.assertSharedOperationInput(groups[0], flat.edges);
  assert.deepEqual(
    groups.slice(1).map((group) => group.members.map(({ node, field }) => node.data.params[field].value)),
    original,
  );
  groups[0].members[0].node.data.params[groups[0].members[0].field].value = 9;
  assert.throws(() => shared.assertSharedOperationInput(groups[0], flat.edges), /controls disagree/);
  const binding = samplers[0].data.operationAuthoring.sharedInputs.find((row) => row.field === 'guidance_scale');
  binding.scopeNodeIds.push(samplers[1].id);
  assert.equal(shared.sharedOperationInput(flat.nodes, flat.edges, samplers[0].id, 'guidance_scale'), null);
});

async function nestedGuidanceFixture(id, action, { plain = false, sealed = false } = {}) {
  const { graph } = create(id);
  const get = flow.useFlowStore.getState;
  get().replaceGraph(JSON.parse(JSON.stringify(graph)));
  const shot = get().nodes.find((node) => /^Shot 2\b/.test(node.data.label));
  assert.ok(shot);
  if (plain || sealed) {
    const schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
    let instance = shot.data.blockInstanceV2;
    if (plain) {
      const definition = structuredClone(instance.definitionSnapshot);
      delete definition.source.provider;
      definition.contentHash = schema.blockDefinitionContentHashV2(definition);
      instance = schema.normalizeBlockInstanceV2({
        ...instance,
        definitionSnapshot: definition,
        definitionRef: { ...instance.definitionRef, contentHash: definition.contentHash },
      });
    }
    if (sealed) {
      const effective = structuredClone(instance.effectiveGraph);
      const encoder = effective.nodes.find((node) => node.data.action === 'EncodeInputs');
      const control = effective.nodes
        .flatMap((node) => node.containerInterface?.controls ?? [])
        .find((control) => control.binding.nodeId === encoder.nodeId && control.binding.fieldId === 'guidance_scale');
      assert.ok(control);
      control.sealed = true;
      instance = runtime.replaceBlockEffectiveGraphV2(instance, effective);
    }
    get().replaceGraph({
      nodes: get()
        .toObject()
        .nodes.map((node) =>
          node.id === shot.id ? { ...node, data: { ...node.data, blockInstanceV2: instance } } : node,
        ),
      edges: get().edges,
    });
  }
  get().toggleUserBlockExpanded(shot.id);
  get().resetHistory();
  const instance = get().nodes.find((node) => node.id === shot.id).data.blockInstanceV2;
  const choices = get()
    .nodes.filter((node) => node.data.blockProjectionOwnerId === shot.id)
    .flatMap((node) =>
      Object.entries(node.data.params).flatMap(([field, param]) => {
        if (param.hidden || param.disabled || !param.fieldOptions?.blockContainerControlV1) return [];
        const binding = controlConnections.blockControlBindingV2(node, field, param, get().nodes)?.control.binding;
        const member = binding && instance.effectiveGraph.nodes.find((member) => member.nodeId === binding.nodeId);
        return binding?.fieldId === 'guidance_scale' && member?.data.action === action
          ? [{ node, field, binding }]
          : [];
      }),
    );
  assert.equal(choices.length, 1);
  return { get, instance, chosen: choices[0] };
}

test('native nested guidance edits retain the external loader and only update their own shot', async (t) => {
  for (const id of ['wan_video_long_showcase', 'wan_21_t2v_13b_seed_vault']) {
    for (const action of ['Denoise', 'EncodeInputs'])
      await t.test(`${id} via ${action}`, async () => {
        const { get, instance, chosen } = await nestedGuidanceFixture(id, action);
        const before = get().exportGraph('nested-guidance-edit');
        const native = runtime.blockProjectionNodeIdV2(instance.instanceId, chosen.binding.nodeId);
        const flat = flow.expandFlowExecutionGraph(get().nodes, get().edges);
        const group = shared.sharedOperationInput(flat.nodes, flat.edges, native, 'guidance_scale');
        assert.equal(group?.members.length, 2, 'the real shared loader reaches this encoder and sampler');
        const allowed = new Set(group.members.map(({ node, field }) => `${node.id}\0${field}`));
        const next = Number(before.nodes[native].params.guidance_scale.value) + 1;
        get().setParamWithHistory(chosen.node.id, chosen.field, next);
        const after = get().exportGraph('nested-guidance-edit');
        for (const [nodeId, node] of Object.entries(after.nodes))
          for (const [field, param] of Object.entries(node.params)) {
            if (allowed.has(`${nodeId}\0${field}`)) assert.equal(param.value, next);
            else assert.deepEqual(param, before.nodes[nodeId].params[field], `${nodeId}.${field} stays unchanged`);
          }
        assert.equal(get().historyPast.length, 1);
        get().undo();
        assert.deepEqual(get().exportGraph('nested-guidance-edit'), before);
        get().redo();
        assert.deepEqual(get().exportGraph('nested-guidance-edit'), after);
        get().replaceGraph(JSON.parse(JSON.stringify(get().toObject())));
        assert.deepEqual(get().exportGraph('nested-guidance-edit'), after);
      });
  }
});

test('ordinary user Blocks retain the same scoped shared editing without a presentation provider', async () => {
  const { get, chosen } = await nestedGuidanceFixture('wan_video_long_showcase', 'Denoise', { plain: true });
  get().setParamWithHistory(chosen.node.id, chosen.field, 6);
  const api = get().exportGraph('plain-user-block-shared-edit');
  const changed = Object.values(api.nodes).filter((node) => Number(node.params.guidance_scale?.value) === 6);
  assert.deepEqual(changed.map((node) => node.action).sort(), ['Denoise', 'EncodeInputs']);
});

test('a sealed shared partner rejects a nested edit atomically before history changes', async () => {
  const { get, chosen } = await nestedGuidanceFixture('wan_video_long_showcase', 'Denoise', { sealed: true });
  const before = JSON.parse(JSON.stringify(get().toObject()));
  assert.throws(() => get().setParamWithHistory(chosen.node.id, chosen.field, 6), /sealed Block control/);
  assert.deepEqual(get().toObject(), before);
  assert.equal(get().historyPast.length, 0);
});
