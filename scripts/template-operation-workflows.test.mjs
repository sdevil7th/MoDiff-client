import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server,
  templates,
  exactness,
  builder,
  groups,
  values,
  defaults,
  fixture,
  flowStore,
  nodeStore,
  studioStore,
  lifecycle;
let publicOperations, starterRequests, qwenInpaintCandidate, qwenInpaintCandidateFixture;
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
  ({ STUDIO_TEMPLATES: templates } = await server.ssrLoadModule('/src/studio/templates.ts'));
  exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  builder = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  qwenInpaintCandidate = await server.ssrLoadModule('/src/studio/qwenInpaintNativeCandidate.ts');
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  values = await server.ssrLoadModule('/src/studio/executionSpecValues.ts');
  ({ DEFAULT_STUDIO_FORM: defaults } = await server.ssrLoadModule('/src/studio/modelProfiles.ts'));
  ({ useFlowStore: flowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  ({ useNodesStore: nodeStore } = await server.ssrLoadModule('/src/stores/useNodeStore.ts'));
  studioStore = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  lifecycle = await server.ssrLoadModule('/src/studio/templateWorkflow.ts');
  starterRequests = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  const backend = path.resolve('../MoDiff');
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const script = path.resolve('scripts/template-operation-fixtures.py');
  fixture = JSON.parse(
    execFileSync(
      process.platform === 'win32' ? python : path.join(backend, 'scripts/with-runtime-env.sh'),
      process.platform === 'win32' ? [script] : [python, script],
      {
        cwd: backend,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        input: JSON.stringify(
          templates
            .filter((item) => item.executionSelection)
            .map((item) => ({ id: item.id, selection: item.executionSelection })),
        ),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ),
  );
  const { qwenInpaintNativeCandidateSelection } = await server.ssrLoadModule(
    '/src/studio/templateOperationSelections.ts',
  );
  qwenInpaintCandidateFixture = JSON.parse(
    execFileSync(
      process.platform === 'win32' ? python : path.join(backend, 'scripts/with-runtime-env.sh'),
      process.platform === 'win32' ? [script] : [python, script],
      {
        cwd: backend,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        input: JSON.stringify(
          [
            'qwen_inpaint_object_replace',
            'qwen_inpaint_mask_draft',
            'qwen_outpaint_aspect_template',
            'qwen_outpaint_draft',
          ].map((id) => ({ id, selection: qwenInpaintNativeCandidateSelection(id) })),
        ),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ),
  );
});
after(async () => server?.close());

test('four fresh Qwen masked templates preserve creator settings and use actual native stages', async (t) => {
  const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  const payload = qwenInpaintCandidateFixture.publicPayload;
  const contracts = operations.parseOperationContracts(
    payload.operationContracts,
    payload.operationContractSchemaVersion,
  );
  for (const row of qwenInpaintCandidateFixture.recipes)
    await t.test(row.id, () => {
      const template = templates.find((item) => item.id === row.id);
      const before = structuredClone(template);
      const form = selectedForm(template);
      const starter = starterRequests.parseOperationStarter(
        row.starter,
        row.starter.pipelineClass,
        row.starter.task,
        contracts,
      );
      for (const action of ['ModelsLoader', 'ImageEncode']) {
        const field = starter.nodes.find((item) => item.node.action === action).node.params.inpaint_compatibility;
        assert.equal(field.value ?? field.default, 'native', 'generic starter retains its native policy');
      }
      const graph = builder.createTemplateOperationGraph(
        template,
        form,
        starter,
        { ...fixture.registry, ...qwenInpaintCandidateFixture.registry },
        row.spec,
        row.capability,
      );
      assert.deepEqual(template, before);
      assert.equal(
        template.executionSelection.implementation,
        'native_stages',
        'fresh templates select the reviewed native masked recipe',
      );
      const flat = groups.unpackVisualOperationGroups(graph).graph;
      const api = flowStore
        .getState()
        .exportGraph('qwen-native-candidate', undefined, { sourceGraph: graph, randomizeSeeds: false });
      const nodes = Object.values(api.nodes);
      for (const action of ['ModelsLoader', 'EncodePrompt', 'ImageEncode', 'Denoise', 'DecodeLatents', 'Guider'])
        assert.equal(
          nodes.filter((node) => node.module === 'modules.ModularDiffusers' && node.action === action).length,
          1,
          action,
        );
      assert.equal(
        nodes.some((node) => ['LoadPipeline', 'Inpaint', 'DiffusersExecutionRecipe'].includes(node.action)),
        false,
      );
      const encode = nodes.find((node) => node.action === 'ImageEncode');
      const denoise = nodes.find((node) => node.action === 'Denoise');
      const prompt = nodes.find((node) => node.action === 'EncodePrompt');
      const loader = nodes.find((node) => node.action === 'ModelsLoader');
      assert.equal(loader.params.inpaint_compatibility.value, 'whole_v1');
      assert.equal(encode.params.inpaint_compatibility.value, 'whole_v1');
      assert.equal(denoise.params.width.value, form.width);
      assert.equal(denoise.params.height.value, form.height);
      assert.equal(denoise.params.num_inference_steps.value, form.steps);
      assert.equal(denoise.params.strength.value, form.strength);
      assert.equal(prompt.params.prompt.value, form.prompt);
      assert.equal(prompt.params.negative_prompt.value, form.negativePrompt);
      assert.ok(nodes.filter((node) => node.params.seed).every((node) => node.params.seed.value === form.seed));
      assert.equal(new Set(flat.edges.map((edge) => `${edge.target}:${edge.targetHandle}`)).size, flat.edges.length);
      const canvas = nodes.find((node) => node.action === 'OutpaintCanvas');
      if (row.id.startsWith('qwen_outpaint_')) {
        assert.ok(canvas);
        assert.equal(denoise.params.width.value, canvas.params.width.value);
        assert.equal(denoise.params.height.value, canvas.params.height.value);
        assert.deepEqual(
          [denoise.params.width.value, denoise.params.height.value],
          [1344, 768],
          'the original rectangular canvas and denoising noise use the same geometry',
        );
        for (const [field, formField] of Object.entries({
          width: 'width',
          height: 'height',
          left: 'outpaintLeft',
          right: 'outpaintRight',
          top: 'outpaintTop',
          bottom: 'outpaintBottom',
          overlap: 'outpaintOverlap',
          feather: 'outpaintFeather',
          fill_color: 'outpaintFillColor',
        }))
          assert.deepEqual(canvas.params[field].value, form[formField]);
        for (const [node, field, output] of [
          [encode, 'image', 'canvas'],
          [encode, 'mask_image', 'mask_image'],
          [prompt, 'image', 'canvas'],
        ]) {
          assert.equal(api.nodes[node.params[field].sourceId], canvas);
          assert.equal(node.params[field].sourceKey, output);
        }
      } else assert.equal(canvas, undefined);
    });
});

test('private Qwen candidate inherits authored crop padding and honors explicit overrides including null', async () => {
  const row = qwenInpaintCandidateFixture.recipes.find((item) => item.id === 'qwen_inpaint_object_replace');
  const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  const payload = qwenInpaintCandidateFixture.publicPayload;
  const contracts = operations.parseOperationContracts(
    payload.operationContracts,
    payload.operationContractSchemaVersion,
  );
  const starter = starterRequests.parseOperationStarter(
    row.starter,
    row.starter.pipelineClass,
    row.starter.task,
    contracts,
  );
  const template = templates.find((item) => item.id === row.id);
  const form = { ...selectedForm(template), paddingMaskCrop: 96 };
  for (const [options, expected] of [
    [{}, 96],
    [{ paddingMaskCrop: 24 }, 24],
    [{ paddingMaskCrop: null }, null],
  ]) {
    const graph = groups.unpackVisualOperationGroups(
      qwenInpaintCandidate.createQwenInpaintNativeCandidateGraph(
        template,
        form,
        starter,
        { ...fixture.registry, ...qwenInpaintCandidateFixture.registry },
        row.spec,
        row.capability,
        options,
      ),
    ).graph;
    const encode = graph.nodes.find((node) => node.data.action === 'ImageEncode');
    assert.equal(encode.data.params.padding_mask_crop.value, expected);
    const api = flowStore
      .getState()
      .exportGraph('qwen-native-crop', undefined, { sourceGraph: graph, randomizeSeeds: false });
    const packetEncode = Object.values(api.nodes).find((node) => node.action === 'ImageEncode');
    assert.equal(packetEncode.params.padding_mask_crop.value ?? null, expected);
  }
});

test('fresh Qwen masked compatibility rejects missing or different reviewed workflow identities', () => {
  const row = qwenInpaintCandidateFixture.recipes.find((item) => item.id === 'qwen_inpaint_object_replace');
  const template = templates.find((item) => item.id === row.id);
  for (const workflowId of [null, 'image_conditioned']) {
    const starter = structuredClone(row.starter);
    starter.workflowId = workflowId;
    const before = structuredClone(starter);
    assert.throws(
      () =>
        builder.createTemplateOperationGraph(
          template,
          selectedForm(template),
          starter,
          fixture.registry,
          row.spec,
          row.capability,
        ),
      /requires the reviewed image_conditioned_inpainting workflow/,
    );
    assert.deepEqual(starter, before);
  }
  const starter = structuredClone(row.starter);
  const owner = starter.nodes.find((item) => item.operation.nodeType === 'loader');
  owner.operation.binding.values.workflow_id = 'image_conditioned';
  assert.throws(
    () =>
      builder.createTemplateOperationGraph(
        template,
        selectedForm(template),
        starter,
        fixture.registry,
        row.spec,
        row.capability,
      ),
    /requires the reviewed image_conditioned_inpainting workflow/,
  );
});

test('the real public capability and every selected starter response pass production wire parsers', async () => {
  const nodes = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  const support = await server.ssrLoadModule('/src/workflow/operationCatalog.ts');
  const choices = await server.ssrLoadModule('/src/workflow/workflowChoices.ts');
  const payload = fixture.publicPayload;
  const capabilities = nodes.parseStudioModelCapabilities(payload);
  publicOperations = operations.parseOperationContracts(
    payload.operationContracts,
    payload.operationContractSchemaVersion,
  );
  const pipelines = support.parsePipelineSupport(
    payload.pipelineSupport,
    payload.pipelineSupportSchemaVersion,
    publicOperations,
  );
  choices.parseWorkflowModelDescriptors(payload, pipelines, capabilities.capabilities);
  for (const row of fixture.recipes) {
    const parsed = starterRequests.parseOperationStarter(
      row.starter,
      row.starter.pipelineClass,
      row.starter.task,
      publicOperations,
    );
    assert.equal(parsed.nodes.length, row.starter.nodes.length, row.id);
  }
});

test('all image templates select an exact developer operation recipe without changing creator settings', async () => {
  const baseline = JSON.parse(await readFile('tests/fixtures/image-template-creator-contracts.v1.json', 'utf8'));
  const images = templates.filter((template) => template.example?.mediaType === 'image');
  assert.equal(images.length, 54);
  for (const expected of baseline.templates) {
    const template = images.find((item) => item.id === expected.templateId);
    assert.ok(template, expected.templateId);
    assert.deepEqual(
      {
        lockedSettings: exactness.getTemplateLockedSettings(template),
        inputBindings: template.inputBindings ?? [],
        workflowBlocks: template.workflowBlocks ?? [],
        workflowBlockSettings: template.workflowBlockSettings ?? {},
      },
      expected.contract,
      `${template.id} retains the complete creator contract`,
    );
    assert.equal(template.executionSelection?.schemaVersion, 1, `${template.id} selects a reviewed operation recipe`);
    assert.ok(template.executionSelection.executionProfileId);
    assert.ok(template.executionSelection.pipelineClass);
    if (template.executionSelection.implementation === 'native_stages')
      assert.deepEqual(
        template.executionSelection.componentPolicy ?? null,
        expected.originalComponentPolicy,
        `${template.id} preserves exactly its original component policy`,
      );
  }
});

test('execution selection changes invalidate current exactness while preserving the historical example', () => {
  const template = templates.find((item) => item.id === 'z_image_quick_concept');
  const historical = { ...template, executionSelection: undefined };
  assert.notEqual(exactness.getTemplateLockHash(template), exactness.getTemplateLockHash(historical));
});

test('only the seven converted Z recipes preserve the observed standard-pipeline CFG formulation', () => {
  const converted = new Set([
    'z_image_quick_concept',
    'z_image_product_mockup',
    'z_image_poster',
    'z_image_lora_style',
    'z_image_cinematic_contact_sheet',
    'low_vram',
    'fast_lora',
  ]);
  const images = templates.filter((template) => template.example?.mediaType === 'image');
  assert.equal(
    images.filter(
      (template) =>
        template.executionSelection.pipelineClass === 'ZImageModularPipeline' &&
        template.executionSelection.guidancePolicy,
    ).length,
    7,
  );
  for (const template of images) {
    if (!converted.has(template.id)) {
      if (!['FluxModularPipeline', 'FluxKontextModularPipeline'].includes(template.executionSelection.pipelineClass))
        assert.equal(template.executionSelection.guidancePolicy, undefined, template.id);
      continue;
    }
    assert.deepEqual(template.executionSelection.guidancePolicy, { enabled: true, useOriginalFormulation: true });
    const previous = {
      ...template,
      executionSelection: { ...template.executionSelection, guidancePolicy: undefined },
    };
    assert.notEqual(exactness.getTemplateLockHash(template), exactness.getTemplateLockHash(previous));
    const starter = fixture.recipes.find((row) => row.id === template.id).starter;
    const guider = starter.nodes.find((node) => node.operation.operationId === 'diffusion.guidance');
    assert.equal(guider.node.params.enabled.value, false, 'ordinary upstream developer starter remains disabled');
    assert.equal(guider.node.params.use_original_formulation.value, false);
  }
});

test('historical approved image remains visible without becoming proof of the current execution selection', async () => {
  const template = templates.find((item) => item.id === 'z_image_quick_concept');
  const manifest = JSON.parse(await readFile('public/template-gallery/manifest.json', 'utf8'));
  assert.equal(exactness.findManifestEntry(template, manifest), undefined);
  const historical = exactness.findHistoricalTemplateManifestEntry(template, manifest);
  assert.ok(historical);
  const state = exactness.getTemplateExampleUiState(template, selectedForm(template), null, manifest);
  assert.equal(state.status, 'historical');
  assert.equal(state.tone, 'neutral');
  assert.ok(exactness.getTemplateCardMedia(template, manifest).mediaPath);
  const changedPrompt = { ...template, prompt: `${template.prompt} different scene` };
  assert.equal(exactness.findHistoricalTemplateManifestEntry(changedPrompt, manifest), undefined);
});

function selectedForm(template) {
  return {
    ...defaults,
    ...exactness.getTemplateLockedSettings(template),
    referenceImages: ['source.png', 'reference-second.png', 'reference-third.png'],
    maskImage: 'mask.png',
    controlImage: 'control.png',
  };
}

test('all seven converted Z recipes bind the authored negative text to the real guided encoder', async (t) => {
  const converted = templates.filter(
    (template) => template.executionSelection?.pipelineClass === 'ZImageModularPipeline',
  );
  assert.equal(converted.length, 7);
  for (const template of converted)
    await t.test(template.id, () => {
      const row = fixture.recipes.find((item) => item.id === template.id);
      for (const negativePrompt of [template.negativePrompt ?? '', `exclude duplicate objects for ${template.id}`]) {
        const form = { ...selectedForm(template), negativePrompt };
        const graph = builder.createTemplateOperationGraph(
          template,
          form,
          row.starter,
          fixture.registry,
          row.spec,
          row.capability,
        );
        const api = flowStore
          .getState()
          .exportGraph('z-negative-conditioning', undefined, { sourceGraph: graph, randomizeSeeds: false });
        const entries = Object.entries(api.nodes);
        const encoders = entries.filter(([, node]) => node.action === 'EncodePrompt');
        assert.equal(encoders.length, 1);
        const [encoderId, encoder] = encoders[0];
        assert.equal(
          encoder.params.negative_prompt?.value,
          negativePrompt,
          'the actual encoder retains original and changed nonempty negative text',
        );
        const [guiderId, guider] = entries.find(([, node]) => node.action === 'Guider');
        assert.equal(guider.params.enabled.value, true);
        assert.equal(guider.params.use_original_formulation.value, true);
        assert.equal(encoder.params.guider.sourceId, guiderId);
        const denoiser = entries.find(([, node]) => node.action === 'Denoise')[1];
        assert.equal(denoiser.params.guider.sourceId, guiderId);
        assert.equal(denoiser.params.embeddings.sourceId, encoderId);
      }
    });
});

test('only the two converted single-LoRA Z recipes preserve the original whole-pipeline default adapter identity', async () => {
  const preserved = new Set(['z_image_lora_style', 'fast_lora']);
  assert.equal(fixture.registry['modules.DiffusersImage.LoadAdapter'].params.adapter_name.default, 'default');
  const images = templates.filter((template) => template.example?.mediaType === 'image');
  assert.equal(images.filter((template) => template.executionSelection.loraPolicy).length, 2);
  for (const template of images) {
    if (!preserved.has(template.id)) {
      assert.equal(template.executionSelection.loraPolicy, undefined, template.id);
      continue;
    }
    assert.deepEqual(template.executionSelection.loraPolicy, { defaultAdapterName: 'default' });
    assert.equal(
      template.workflowBlockSettings.lora.adapterName,
      undefined,
      'the immutable creator literal stays omitted',
    );
    assert.equal(template.workflowBlockSettings.lora.additionalAdapters?.length ?? 0, 0);
    const previous = {
      ...template,
      executionSelection: { ...template.executionSelection, loraPolicy: undefined },
    };
    assert.notEqual(exactness.getTemplateLockHash(template), exactness.getTemplateLockHash(previous));
    assert.deepEqual(template.example, previous.example, 'historical output is retained without a new approval');
  }
  for (const template of images.filter((item) => item.workflowBlocks?.includes('lora'))) {
    const row = fixture.recipes.find((item) => item.id === template.id);
    const graph = builder.createTemplateOperationGraph(
      template,
      selectedForm(template),
      row.starter,
      fixture.registry,
      row.spec,
      row.capability,
    );
    const api = flowStore
      .getState()
      .exportGraph('exact-adapter-names', undefined, { sourceGraph: graph, randomizeSeeds: false });
    const loras = Object.values(api.nodes).filter((node) => node.action === 'Lora' || node.action === 'LoadAdapter');
    const settings = template.workflowBlockSettings.lora;
    const adapters = [settings, ...(settings.additionalAdapters ?? [])];
    assert.equal(loras.length, adapters.length, template.id);
    adapters.forEach((adapter, index) => {
      assert.equal(
        loras[index].params.adapter_name.value,
        adapter.adapterName ?? (preserved.has(template.id) || loras[index].action === 'LoadAdapter' ? 'default' : ''),
        `${template.id} retains its exact authored or original default adapter identity`,
      );
    });
  }
});

test('a default adapter identity policy fails closed on malformed names, extra adapters and incompatible owners', () => {
  const source = templates.find((item) => item.id === 'z_image_lora_style');
  const row = fixture.recipes.find((item) => item.id === source.id);
  const build = (template, selected = row) =>
    builder.createTemplateOperationGraph(
      template,
      selectedForm(template),
      selected.starter,
      fixture.registry,
      selected.spec,
      selected.capability,
    );
  for (const defaultAdapterName of ['', ' default', 'default ', 'bad\nname', 'x'.repeat(257), 1]) {
    const template = structuredClone(source);
    template.executionSelection.loraPolicy = { defaultAdapterName };
    assert.throws(() => build(template), /adapter identity policy/);
  }
  const extra = structuredClone(source);
  extra.executionSelection.loraPolicy = { defaultAdapterName: 'default' };
  extra.workflowBlockSettings.lora.additionalAdapters = [structuredClone(source.workflowBlockSettings.lora)];
  assert.throws(() => build(extra), /adapter identity policy/);
  const conflict = structuredClone(source);
  conflict.executionSelection.loraPolicy = { defaultAdapterName: 'default' };
  conflict.workflowBlockSettings.lora.adapterName = 'authored-other';
  assert.throws(() => build(conflict), /adapter identity policy/);
  for (const templateId of ['z_image_quick_concept', 'qwen_layered_portrait']) {
    const template = structuredClone(templates.find((item) => item.id === templateId));
    template.executionSelection.loraPolicy = { defaultAdapterName: 'default' };
    assert.throws(
      () =>
        build(
          template,
          fixture.recipes.find((item) => item.id === templateId),
        ),
      /adapter identity policy/,
    );
  }
  const whole = structuredClone(templates.find((item) => item.id === 'flux_fill_inpaint'));
  whole.executionSelection.loraPolicy = { defaultAdapterName: 'default' };
  whole.workflowBlocks = ['lora'];
  whole.workflowBlockSettings = { lora: structuredClone(source.workflowBlockSettings.lora) };
  assert.throws(
    () =>
      build(
        whole,
        fixture.recipes.find((item) => item.id === whole.id),
      ),
    /adapter identity policy/,
  );
});

// These are the original whole-pipeline wrapper's separate embedded guidance
// defaults, independently observed in frozen standard-pipeline API recipes.
function preservedEmbeddedGuidance(template) {
  return { FluxSchnellPipeline: 0, FluxDevPipeline: 3.5, FluxKreaPipeline: 3.5, FluxKontextPipeline: 3.5 }[
    template.modelType
  ];
}

test('the thirteen converted Flux recipes preserve true CFG separately from original embedded guidance', () => {
  const images = templates.filter((template) => template.example?.mediaType === 'image');
  const converted = images.filter((template) => preservedEmbeddedGuidance(template) !== undefined);
  assert.equal(converted.length, 13);
  assert.equal(images.filter((template) => template.executionSelection.guidancePolicy).length, 20);
  for (const template of converted) {
    const policy = template.executionSelection.guidancePolicy;
    assert.deepEqual(policy, {
      enabled: template.id !== 'flux_schnell_text_to_image',
      useOriginalFormulation: false,
      distilledGuidanceScale: preservedEmbeddedGuidance(template),
    });
    const row = fixture.recipes.find((item) => item.id === template.id);
    const ordinary = row.starter.nodes.find((item) => item.operation.operationId === 'diffusion.guidance');
    assert.ok(ordinary, 'the actual selected backend starter declares a CFG owner');
    assert.equal(
      ordinary.node.params.enabled.value,
      false,
      'ordinary upstream developer authoring retains its conditional-only default',
    );
    assert.equal(ordinary.node.params.guidance_scale.value, 1.0);
    const graph = builder.createTemplateOperationGraph(
      template,
      selectedForm(template),
      row.starter,
      fixture.registry,
      row.spec,
      row.capability,
    );
    const api = flowStore
      .getState()
      .exportGraph('separate-flux-guidance', undefined, { sourceGraph: graph, randomizeSeeds: false });
    const guide = Object.values(api.nodes).find((node) => node.action === 'Guider');
    const denoise = Object.values(api.nodes).find((node) => node.action === 'Denoise');
    assert.equal(
      guide.params.guidance_scale.value,
      exactness.getTemplateLockedSettings(template).guidanceScale,
      'actual CFG retains the creator scalar',
    );
    assert.equal(
      denoise.params.guidance_scale.value,
      preservedEmbeddedGuidance(template),
      'actual model forward retains the separate original embedded scalar',
    );
    for (const action of ['EncodePrompt', 'Denoise']) {
      const consumer = Object.values(api.nodes).find((node) => node.action === action);
      assert.equal(api.nodes[consumer.params.guider.sourceId], guide, 'the real same CFG owner feeds both stages');
    }
  }
});

test('native Schnell exports the creator 512-token recipe rather than the ordinary starter default', () => {
  const template = templates.find((item) => item.id === 'flux_schnell_text_to_image');
  const row = fixture.recipes.find((item) => item.id === template.id);
  const form = selectedForm(template);
  assert.equal(form.maxSequenceLength, 512);
  const starterPrompt = row.starter.nodes.find((item) => item.node.action === 'EncodePrompt');
  assert.equal(starterPrompt.node.params.max_sequence_length.value, 256);
  const graph = builder.createTemplateOperationGraph(
    template,
    form,
    row.starter,
    fixture.registry,
    row.spec,
    row.capability,
  );
  const api = flowStore
    .getState()
    .exportGraph('schnell-recipe', undefined, { sourceGraph: graph, randomizeSeeds: false });
  const prompt = Object.values(api.nodes).find((node) => node.action === 'EncodePrompt');
  assert.equal(prompt.params.max_sequence_length.value, 512);
  assert.equal(prompt.params.prompt.value, template.prompt);
  const denoise = Object.values(api.nodes).find((node) => node.action === 'Denoise');
  assert.equal(denoise.params.num_inference_steps.value, 4);
  assert.equal(denoise.params.guidance_scale.value, 0);
  assert.equal(denoise.params.seed.value, 8427);
  const owner = Object.values(api.nodes).find((node) => node.action === 'ModelsLoader');
  assert.equal(owner.params.repo_id.value.value, 'black-forest-labs/FLUX.1-schnell');
  assert.equal(owner.params.revision.value, '741f7c3ce8b383c54771c7003378a50191e9efe9');
});

test('Strength is offered only when the selected image task has a reviewed execution binding', async (t) => {
  const { parseStudioModelCapabilities } = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  const { studioSupportsStrength } = await server.ssrLoadModule('/src/studio/effectiveControls.ts');
  const { capabilities } = parseStudioModelCapabilities(fixture.publicPayload);
  const expected = {
    qwen_tile_extract: false,
    qwen_character_angles: false,
    qwen_edit_strength_sweep: false,
    character_edit: false,
    reference_fusion: false,
    qwen_layered_portrait: false,
    flux2_klein_edit: false,
    flux2_klein_multi_reference: false,
    flux_kontext_edit: false,
    flux_redux_edit: false,
    qwen_inpaint_object_replace: true,
    qwen_inpaint_mask_draft: true,
    flux_fill_inpaint: true,
    flux_fill_outpaint: true,
  };
  for (const [id, supported] of Object.entries(expected)) {
    await t.test(id, () => {
      const template = templates.find((item) => item.id === id);
      assert.ok(template, id);
      const capability = capabilities.find((item) => item.modelType === template.modelType);
      assert.ok(capability, template.modelType);
      assert.equal(studioSupportsStrength(template, capabilities, template), supported);
      assert.equal(
        studioSupportsStrength(template, [], template),
        false,
        'missing reviewed execution metadata must not advertise a functional control',
      );
    });
  }
  for (const modelType of ['FluxReduxPipeline', 'FluxKontextPipeline', 'Flux2KleinPipeline']) {
    for (const mode of ['edit_image', 'multi_image_reference_edit']) {
      await t.test(`${modelType}/${mode} legacy selection`, () => {
        assert.equal(studioSupportsStrength({ modelType, mode }, capabilities), false);
      });
    }
  }
  const oldId = templates.find((item) => item.id === 'qwen_edit_strength_sweep');
  assert.match(oldId.description, /single-image reference edit/i);
  assert.doesNotMatch(oldId.label, /strength|sweep/i);
});

test('unsupported Strength does not appear in parameter notes or executable variations', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { StudioVariationPlanner } = await server.ssrLoadModule('/src/components/StudioVariationPlanner.tsx');
  const { StudioParameterExplainers } = await server.ssrLoadModule('/src/components/StudioParameterExplainers.tsx');
  const form = { ...defaults, mode: 'edit_image' };
  for (const supported of [false, true]) {
    const planner = renderToStaticMarkup(
      createElement(StudioVariationPlanner, {
        form,
        supportsStrength: supported,
        onChange() {},
        onRunSweep() {},
      }),
    );
    const notes = renderToStaticMarkup(
      createElement(StudioParameterExplainers, {
        form,
        supportsStrength: supported,
      }),
    );
    assert.equal(planner.includes('Lower strength'), supported);
    assert.equal(planner.includes('Higher strength'), supported);
    assert.equal(notes.includes('Strength:'), supported);
    assert.ok(planner.includes('Next seed'), 'other actual variations remain available');
  }
});

test('all54 image recipes construct and export the exact backend developer stages with every declared creator binding', async (t) => {
  assert.equal(fixture.recipes.length, 54);
  assert.equal(
    fixture.recipes.filter(
      (row) => templates.find((item) => item.id === row.id).executionSelection.implementation === 'native_stages',
    ).length,
    48,
  );
  for (const row of fixture.recipes)
    await t.test(row.id, () => {
      const template = templates.find((item) => item.id === row.id);
      const form = selectedForm(template);
      const before = structuredClone(row.starter);
      const graph = builder.createTemplateOperationGraph(
        template,
        form,
        starterRequests.parseOperationStarter(
          row.starter,
          row.starter.pipelineClass,
          row.starter.task,
          publicOperations,
        ),
        fixture.registry,
        row.spec,
        row.capability,
      );
      assert.deepEqual(row.starter, before, 'construction never changes the resolved backend contract');
      const flat = groups.unpackVisualOperationGroups(graph).graph;
      const operations = flat.nodes.filter((node) => node.data.operationAuthoring);
      assert.equal(operations.length, row.starter.nodes.length);
      assert.deepEqual(
        operations.map((node) => node.data.operationAuthoring.operation.operationId).sort(),
        row.starter.nodes.map((node) => node.operation.operationId).sort(),
      );
      assert.ok(
        flat.nodes.every((node) => !node.data.studioOwned),
        'ordinary graph has no stale managed owner',
      );
      const owner = operations.find((node) => node.data.operationAuthoring.operation.nodeType === 'loader');
      assert.ok(owner);
      const backendOwner = row.starter.nodes.find((node) => node.operation.nodeType === 'loader').node;
      for (const field of ['model_id', 'repo_id', 'revision', 'pipeline_class', 'model_type', 'execution_profile_id']) {
        if (backendOwner.params[field])
          assert.deepEqual(
            owner.data.params[field].value ?? owner.data.params[field].default,
            backendOwner.params[field].value ?? backendOwner.params[field].default,
            `${field} retains the selected artifact identity`,
          );
      }
      const revision = owner.data.params.revision?.value ?? owner.data.params.revision?.default;
      const expected = values.resolveStudioExecutionSpecValues(form, row.spec, row.capability, {
        defaultModelRevision: revision,
      });
      const claimed = new Set();
      for (const [role, key] of row.spec.roles) {
        if (role === 'loadMask' && ['qwen_outpaint_aspect_template', 'qwen_outpaint_draft'].includes(template.id)) {
          assert.ok(flat.nodes.some((node) => node.data.action === 'OutpaintCanvas'));
          continue;
        }
        const node = flat.nodes.find(
          (item) => `${item.data.module}.${item.data.action}` === key && !claimed.has(item.id),
        );
        assert.ok(node, role);
        claimed.add(node.id);
        for (const [boundRole, field, source] of row.spec.bindings)
          if (boundRole === role) {
            if (
              node.id === owner.id &&
              ['artifact', 'defaultRevision', 'pipelineClass', 'executionProfileId', 'modelVariant'].includes(source)
            )
              continue;
            const value =
              field === 'guidance_scale' &&
              node.data.action === 'Denoise' &&
              preservedEmbeddedGuidance(template) !== undefined
                ? preservedEmbeddedGuidance(template)
                : node.data.params[field].type === 'model' && typeof expected[source] === 'string'
                  ? { source: 'hub', value: expected[source] }
                  : expected[source];
            assert.deepEqual(node.data.params[field].value, value, `${role}.${field} retains ${source}`);
          }
      }
      assert.equal(
        new Set(flat.edges.map((edge) => `${edge.target}:${edge.targetHandle}`)).size,
        flat.edges.length,
        'each port has one supplier',
      );
      const api = flowStore
        .getState()
        .exportGraph('test-template', undefined, { sourceGraph: graph, randomizeSeeds: false });
      assert.equal(
        Object.values(api.nodes).filter((node) => node.module === 'modules.ModularDiffusers').length,
        flat.nodes.filter((node) => node.data.module === 'modules.ModularDiffusers').length,
        'Encode Inputs lowers the same actual stages',
      );
      const seedConsumers = Object.values(api.nodes).filter((node) => 'seed' in node.params);
      assert.ok(seedConsumers.length);
      assert.ok(
        seedConsumers.every((node) => node.params.seed.value === form.seed),
        'every generator initialization retains the locked seed',
      );
      if (template.executionSelection.implementation === 'native_stages') {
        assert.ok(
          graph.nodes.some((node) => groups.visualOperationGroup(node) === 'inputs'),
          'real encoders are grouped as Encode Inputs',
        );
        assert.ok(
          !flat.nodes.some((node) => node.data.action === 'DiffusersExecutionRecipe'),
          'native fields are inline rather than inherited unknown utility owners',
        );
      }
      const guider = operations.find(
        (node) => node.data.operationAuthoring.operation.operationId === 'diffusion.guidance',
      );
      assert.equal(
        graph.nodes.some((node) => groups.visualOperationGroup(node) === 'guidance'),
        Boolean(guider),
        'Guidance contains the actual backend-declared guidance owner only',
      );
      if (guider) {
        assert.equal(guider.data.params.guider.value, 'ClassifierFreeGuidance');
        assert.equal(guider.data.params.guidance_scale.value, form.guidanceScale);
        const original = row.starter.nodes.find((node) => node.operation.operationId === 'diffusion.guidance').node
          .params;
        const policy = template.executionSelection.guidancePolicy;
        assert.equal(guider.data.params.enabled.value, policy?.enabled ?? original.enabled.value);
        const exportedGuider = Object.values(api.nodes).find((node) => node.action === 'Guider');
        assert.ok(exportedGuider, 'the actual guidance owner is exported for execution');
        assert.equal(exportedGuider.params.enabled.value, policy?.enabled ?? original.enabled.value);
        assert.equal(
          exportedGuider.params.use_original_formulation.value,
          policy?.useOriginalFormulation ?? original.use_original_formulation.value,
        );
        for (const [field, value] of Object.entries({
          guidance_rescale: 0,
          use_original_formulation: policy?.useOriginalFormulation ?? original.use_original_formulation.value,
          start: 0,
          stop: 1,
        }))
          assert.equal(guider.data.params[field].value, value, `preserved upstream ${field}`);
        const targets = flat.edges.filter((edge) => edge.source === guider.id && edge.sourceHandle === 'guider_out');
        assert.deepEqual(targets.map((edge) => flat.nodes.find((node) => node.id === edge.target).data.action).sort(), [
          'Denoise',
          'EncodePrompt',
        ]);
      }
      const policy = template.executionSelection.componentPolicy;
      if (policy) {
        assert.equal(owner.data.params.attention_backend.value, policy.attentionBackend);
        assert.equal(owner.data.params.vae_slicing.value, policy.vaeSlicing);
        assert.equal(owner.data.params.vae_tiling.value, policy.vaeTiling);
      } else if (owner.data.action === 'ModelsLoader') {
        assert.equal(
          owner.data.params.attention_backend.value ?? owner.data.params.attention_backend.default,
          'inherit',
        );
        assert.equal(owner.data.params.vae_slicing.value ?? owner.data.params.vae_slicing.default, null);
        assert.equal(owner.data.params.vae_tiling.value ?? owner.data.params.vae_tiling.default, null);
      }
      const loras = flat.nodes.filter((node) => node.data.action === 'Lora' || node.data.action === 'LoadAdapter');
      const settings = template.workflowBlockSettings?.lora;
      const adapters = settings ? [settings, ...(settings.additionalAdapters ?? [])] : [];
      assert.equal(loras.length, adapters.length);
      adapters.forEach((adapter, index) => {
        const node = loras[index];
        const params = node.data.params;
        assert.deepEqual((params.model ?? params.adapter_path).value, {
          source: adapter.model.source,
          value: adapter.model.value,
        });
        assert.equal(params.revision.value, adapter.model.revision);
        assert.equal(params.expected_sha256.value, adapter.model.sha256);
        assert.equal(params.scale.value, adapter.scale);
        if (adapter.adapterName) assert.equal(params.adapter_name.value, adapter.adapterName);
        if (adapter.weightName) assert.equal(params.weight_name.value, adapter.weightName);
        if (index && node.data.action === 'Lora')
          assert.ok(
            flat.edges.some(
              (edge) =>
                edge.source === loras[index - 1].id &&
                edge.target === node.id &&
                edge.targetHandle === 'previous_loras',
            ),
          );
        if (index === 0 && adapter.schedulerClass) assert.equal(params.scheduler_class.value, adapter.schedulerClass);
        if (index === 0 && adapter.schedulerConfig)
          assert.deepEqual(JSON.parse(params.scheduler_config.value), adapter.schedulerConfig);
      });
      const upscaler = flat.nodes.find((node) => node.data.module === 'modules.Spandrel');
      if (template.workflowBlocks?.includes('upscaler')) {
        assert.ok(upscaler);
        assert.deepEqual(upscaler.data.params.model_id.value, template.workflowBlockSettings.upscaler.model);
        assert.equal(upscaler.data.params.downscale.value, template.workflowBlockSettings.upscaler.downscale);
        assert.equal(
          flat.nodes.filter((node) => node.data.action === 'Preview').length,
          2,
          'retains original and upscaled image outputs',
        );
      } else assert.equal(upscaler, undefined);
    });
});

test('all54 exported image consumers independently retain the preserved creator recipe', async (t) => {
  const fields = {
    prompt: 'prompt',
    negative_prompt: 'negativePrompt',
    max_sequence_length: 'maxSequenceLength',
    num_inference_steps: 'steps',
    guidance_scale: 'guidanceScale',
    width: 'width',
    height: 'height',
    batch_size: 'batchSize',
    seed: 'seed',
    dtype: 'dtype',
    offload_mode: 'offloadMode',
  };
  const consumers = new Set([
    'EncodePrompt',
    'ImageEncode',
    'Denoise',
    'Generate',
    'Edit',
    'Inpaint',
    'ControlGenerate',
    'LoadPipeline',
    'ModelsLoader',
    'AutoModelLoader',
  ]);
  for (const row of fixture.recipes)
    await t.test(row.id, () => {
      const template = templates.find((item) => item.id === row.id);
      const form = selectedForm(template);
      const graph = builder.createTemplateOperationGraph(
        template,
        form,
        row.starter,
        fixture.registry,
        row.spec,
        row.capability,
      );
      const api = flowStore
        .getState()
        .exportGraph('independent-creator-recipe', undefined, { sourceGraph: graph, randomizeSeeds: false });
      let checked = 0;
      for (const node of Object.values(api.nodes)) {
        if (!consumers.has(node.action)) continue;
        for (const [field, formField] of Object.entries(fields)) {
          const param = node.params[field];
          if (!param || param.display === 'output') continue;
          if (param.sourceId) {
            assert.ok(
              ['width', 'height'].includes(field) && template.mode === 'outpaint',
              `${node.action}.${field} cannot replace the creator recipe with an unexpected supplier`,
            );
            assert.equal(api.nodes[param.sourceId].action, 'OutpaintCanvas');
            assert.equal(param.sourceKey, field, 'outpaint generation uses the actual computed canvas geometry');
            continue;
          }
          const expected =
            field === 'guidance_scale' && node.action === 'Denoise' && preservedEmbeddedGuidance(template) !== undefined
              ? preservedEmbeddedGuidance(template)
              : form[formField];
          assert.equal(param.value, expected, `${node.action}.${field} consumes the preserved creator ${formField}`);
          checked++;
        }
      }
      assert.ok(checked >= 8, 'checks actual consumer fields independently of execution spec declarations');
    });
});

test('changed profile, missing LoRA descriptor schema and conflicting suppliers fail without mutating an existing graph', () => {
  const row = fixture.recipes.find((item) => item.id === 'flux_lora_cinematic_octane_3d');
  const template = templates.find((item) => item.id === row.id);
  const starter = structuredClone(row.starter);
  starter.pipelineClass = 'Flux2KleinModularPipeline';
  assert.throws(
    () =>
      builder.createTemplateOperationGraph(
        template,
        selectedForm(template),
        starter,
        fixture.registry,
        row.spec,
        row.capability,
      ),
    /does not match its backend execution contract/,
  );
  const registry = structuredClone(fixture.registry);
  delete registry['modules.ModularDiffusers.Lora'].params.previous_loras;
  assert.throws(
    () =>
      builder.createTemplateOperationGraph(
        template,
        selectedForm(template),
        row.starter,
        registry,
        row.spec,
        row.capability,
      ),
    /incompatible/,
  );
});

function prepareLifecycleFixture(templateId) {
  const row = fixture.recipes.find((item) => item.id === templateId);
  const template = templates.find((item) => item.id === templateId);
  const studio = studioStore.useStudioStore;
  studio.setState({ workflowCanvasHydrated: true });
  const tabId = studio.getState().createWorkflowTab(template.label, undefined, 'template', template.id);
  studio.getState().applyTemplate(template);
  nodeStore.setState({
    nodesRegistry: fixture.registry,
    operationContracts: row.starter.nodes.map((item) => item.operation),
    studioModelCapabilities: [
      {
        ...row.capability,
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: [row.spec.mode],
        studioExecutionSpecs: [row.spec],
      },
    ],
    studioExecutionSpecInvalid: false,
  });
  return { row, template, tabId, studio, context: studioStore.captureWorkflowOperationContext() };
}

test('both Z default adapter identities survive ordinary template creation and workflow import', async (t) => {
  if (!publicOperations) {
    const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
    publicOperations = operations.parseOperationContracts(
      fixture.publicPayload.operationContracts,
      fixture.publicPayload.operationContractSchemaVersion,
    );
  }
  for (const templateId of ['z_image_lora_style', 'fast_lora'])
    await t.test(templateId, async () => {
      const previous = [flowStore.getState(), nodeStore.getState(), studioStore.useStudioStore.getState()];
      const originalFetch = globalThis.fetch;
      try {
        const { row, template, studio } = prepareLifecycleFixture(templateId);
        const nodeModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
        nodeStore.setState({ nodesRegistry: nodeModule.parseNodesResponse({ nodes: fixture.registry }).nodes });
        const form = structuredClone(studio.getState().form);
        globalThis.fetch = async () => Response.json(row.starter);
        await lifecycle.createImageTemplateOperationWorkflow(
          template,
          form,
          studioStore.captureWorkflowOperationContext(),
        );
        assert.equal(studio.getState().graphBinding, null);
        const beforeImport = flowStore
          .getState()
          .exportGraph('z-default-adapter', undefined, { randomizeSeeds: false });
        const loras = Object.values(beforeImport.nodes).filter((node) => node.action === 'Lora');
        assert.equal(loras.length, 1);
        assert.equal(loras[0].params.adapter_name.value, 'default');
        const owner = Object.values(beforeImport.nodes).find((node) => node.action === 'ModelsLoader');
        assert.equal(owner.params.lora_list.sourceKey, 'lora');
        const graph = flowStore.getState().toObject();
        const packageModule = await server.ssrLoadModule('/src/studio/workflowPackage.ts');
        const parsed = packageModule.parseWorkflowPackage({
          metadata: { studio: form },
          graph,
          restore: { formSnapshot: form, graphSnapshot: graph, graphBindingSnapshot: null },
        });
        assert.ok(parsed);
        studio.getState().createWorkflowTab('Imported Z adapter recipe', parsed.snapshot, 'import', 'private');
        assert.equal(studio.getState().graphBinding, null);
        assert.equal(studio.getState().graphFinalization, null);
        assert.deepEqual(
          flowStore.getState().exportGraph('z-default-adapter', undefined, { randomizeSeeds: false }),
          beforeImport,
          'normal import retains the complete API packet, identity and model-owner wire',
        );
      } finally {
        globalThis.fetch = originalFetch;
        flowStore.setState(previous[0]);
        nodeStore.setState(previous[1]);
        studioStore.useStudioStore.setState(previous[2]);
      }
    });
});

test('both Qwen ControlNet templates retain the exact creator API packet through ordinary creation and import', async (t) => {
  if (!publicOperations) {
    const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
    publicOperations = operations.parseOperationContracts(
      fixture.publicPayload.operationContracts,
      fixture.publicPayload.operationContractSchemaVersion,
    );
  }
  for (const templateId of ['qwen_control_image_layout', 'qwen_packaging_dieline'])
    await t.test(templateId, async () => {
      const previous = [flowStore.getState(), nodeStore.getState(), studioStore.useStudioStore.getState()];
      const originalFetch = globalThis.fetch;
      try {
        const { row, template, studio } = prepareLifecycleFixture(templateId);
        const nodeModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
        const parsedRegistry = nodeModule.parseNodesResponse({ nodes: fixture.registry });
        nodeStore.setState({ nodesRegistry: parsedRegistry.nodes });
        assert.deepEqual(
          parsedRegistry.nodes['modules.ModularDiffusers.AutoModelLoader'].params.model.connectionRoleSelector,
          { field: 'model_type', values: { controlnet: 'controlnet_component' } },
        );
        studio.getState().updateForm({ controlImage: 'byte-verified-control.png', resourceMode: 'expert' });
        const form = structuredClone(studio.getState().form);
        const context = studioStore.captureWorkflowOperationContext();
        const expectedGraph = builder.createTemplateOperationGraph(
          template,
          form,
          starterRequests.parseOperationStarter(
            row.starter,
            row.starter.pipelineClass,
            row.starter.task,
            publicOperations,
          ),
          fixture.registry,
          row.spec,
          row.capability,
        );
        const flatExpected = groups.unpackVisualOperationGroups(expectedGraph).graph;
        const expected = flowStore
          .getState()
          .exportGraph('control-recipe', undefined, { sourceGraph: expectedGraph, randomizeSeeds: false });
        globalThis.fetch = async () => Response.json(row.starter);
        await lifecycle.createImageTemplateOperationWorkflow(template, form, context);
        assert.equal(studio.getState().graphBinding, null);
        const committed = groups.unpackVisualOperationGroups(flowStore.getState().toObject()).graph;
        const standalone = committed.nodes.find((node) => node.data.action === 'AutoModelLoader');
        const preparation = committed.nodes.find((node) => node.data.action === 'Controlnet');
        assert.ok(standalone && preparation);
        assert.ok(
          committed.edges.some(
            (edge) =>
              edge.source === standalone.id &&
              edge.sourceHandle === 'model' &&
              edge.target === preparation.id &&
              edge.targetHandle === 'controlnet',
          ),
          'ordinary creation must retain the required ControlNet component wire',
        );
        function canonicalApi(api, graph) {
          const names = new Map(graph.nodes.map((node) => [node.id, `${node.data.module}.${node.data.action}`]));
          return Object.fromEntries(
            Object.entries(api.nodes).map(([id, node]) => [
              names.get(id),
              {
                ...node,
                params: Object.fromEntries(
                  Object.entries(node.params).map(([key, param]) => [
                    key,
                    { ...param, ...(param.sourceId ? { sourceId: names.get(param.sourceId) } : {}) },
                  ]),
                ),
              },
            ]),
          );
        }
        assert.deepEqual(
          canonicalApi(
            flowStore.getState().exportGraph('control-recipe', undefined, { randomizeSeeds: false }),
            committed,
          ),
          canonicalApi(expected, flatExpected),
          'ordinary transaction must retain every original setting and typed supplier',
        );
        const graph = flowStore.getState().toObject();
        const packageModule = await server.ssrLoadModule('/src/studio/workflowPackage.ts');
        const parsed = packageModule.parseWorkflowPackage({
          metadata: { studio: form },
          graph,
          restore: { formSnapshot: form, graphSnapshot: graph, graphBindingSnapshot: null },
        });
        assert.ok(parsed);
        const beforeImport = flowStore.getState().exportGraph('control-recipe', undefined, { randomizeSeeds: false });
        studio.getState().createWorkflowTab('Imported ControlNet recipe', parsed.snapshot, 'import', 'private');
        assert.equal(studio.getState().graphBinding, null);
        assert.equal(studio.getState().graphFinalization, null);
        assert.deepEqual(
          flowStore.getState().exportGraph('control-recipe', undefined, { randomizeSeeds: false }),
          beforeImport,
          'normal import must preserve every API field and source wire',
        );
        const wrongKind = groups.unpackVisualOperationGroups(flowStore.getState().toObject()).graph;
        wrongKind.nodes.find((node) => node.data.action === 'AutoModelLoader').data.params.model_type.value = 'vae';
        flowStore.getState().replaceGraph(wrongKind);
        assert.equal(
          flowStore
            .getState()
            .edges.some(
              (edge) =>
                edge.source === standalone.id && edge.target === preparation.id && edge.targetHandle === 'controlnet',
            ),
          false,
          'real reconciliation rejects a different standalone component kind',
        );
      } finally {
        globalThis.fetch = originalFetch;
        flowStore.setState(previous[0]);
        nodeStore.setState(previous[1]);
        studioStore.useStudioStore.setState(previous[2]);
      }
    });
});

test('fresh developer template commits once, preserves creator provenance, and restores the same ordinary graph after save/undo/redo', async () => {
  const previous = [flowStore.getState(), nodeStore.getState(), studioStore.useStudioStore.getState()];
  const originalFetch = globalThis.fetch;
  try {
    const { row, template, tabId, studio, context } = prepareLifecycleFixture('z_image_quick_concept');
    globalThis.fetch = async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), {
        pipelineClass: template.executionSelection.pipelineClass,
        task: template.executionSelection.task,
        executionProfileId: template.executionSelection.executionProfileId,
      });
      return Response.json(row.starter);
    };
    await lifecycle.createImageTemplateOperationWorkflow(template, studio.getState().form, context);
    assert.equal(studio.getState().graphBinding, null);
    assert.equal(studio.getState().graphFinalization, null);
    assert.equal(studio.getState().activeTemplateId, template.id);
    const graph = flowStore.getState().toObject();
    assert.ok(graph.nodes.length);
    const saved = studio.getState().workflowTabs.find((tab) => tab.id === tabId);
    assert.equal(saved.source, 'template');
    assert.equal(saved.snapshot.activeTemplateId, template.id);
    assert.equal(saved.snapshot.studioGraphBinding, null);
    flowStore.getState().undo();
    assert.equal(flowStore.getState().nodes.length, 0);
    flowStore.getState().redo();
    assert.deepEqual(flowStore.getState().toObject(), graph);
    studio.getState().createWorkflowTab('Other document');
    studio.getState().switchWorkflowTab(tabId);
    studio.getState().hydrateActiveWorkflowCanvas();
    assert.equal(studio.getState().graphBinding, null);
    assert.equal(studio.getState().activeTemplateId, template.id);
    assert.equal(flowStore.getState().nodes.length, graph.nodes.length);
    assert.deepEqual(
      flowStore.getState().exportGraph('test-template', undefined, { randomizeSeeds: false }),
      flowStore.getState().exportGraph('test-template', undefined, { sourceGraph: graph, randomizeSeeds: false }),
    );
  } finally {
    globalThis.fetch = originalFetch;
    flowStore.setState(previous[0]);
    nodeStore.setState(previous[1]);
    studioStore.useStudioStore.setState(previous[2]);
  }
});

test('a delayed template starter cannot overwrite a switched document or edited form', async (t) => {
  for (const edit of ['document', 'form'])
    await t.test(edit, async () => {
      const previous = [flowStore.getState(), nodeStore.getState(), studioStore.useStudioStore.getState()];
      const originalFetch = globalThis.fetch;
      let finish;
      let requestEntered;
      const requestStarted = new Promise((resolve) => (requestEntered = resolve));
      try {
        const { row, template, studio, context } = prepareLifecycleFixture('z_image_quick_concept');
        globalThis.fetch = async () =>
          await new Promise((resolve) => {
            finish = () => resolve(Response.json(row.starter));
            requestEntered();
          });
        const pending = lifecycle.createImageTemplateOperationWorkflow(template, studio.getState().form, context);
        await requestStarted;
        if (edit === 'document') studio.getState().createWorkflowTab('Newer document');
        else studio.getState().updateForm({ prompt: 'An explicit newer prompt' });
        finish();
        await assert.rejects(pending, (error) => studioStore.isWorkflowOperationCancelled(error));
        assert.equal(flowStore.getState().nodes.length, 0);
        if (edit === 'form') assert.equal(studio.getState().form.prompt, 'An explicit newer prompt');
      } finally {
        globalThis.fetch = originalFetch;
        flowStore.setState(previous[0]);
        nodeStore.setState(previous[1]);
        studioStore.useStudioStore.setState(previous[2]);
      }
    });
});

test('template creation waits for the latest already-loading runtime without fetching or changing its owned form', async () => {
  const previous = [nodeStore.getState(), studioStore.useStudioStore.getState()];
  try {
    const { studio, context } = prepareLifecycleFixture('z_image_quick_concept');
    const originalForm = structuredClone(studio.getState().form);
    let runtimeFetches = 0;
    nodeStore.setState({
      runtimeStatus: null,
      fetchRuntimeStatus: async () => {
        runtimeFetches++;
      },
      discoveryRequests: {
        ...nodeStore.getState().discoveryRequests,
        runtime: { status: 'loading', requestId: 100, error: null },
      },
    });
    let completed = false;
    const pending = lifecycle.waitForTemplateRuntimeDiscovery(context).then(() => {
      completed = true;
    });
    await Promise.resolve();
    assert.equal(completed, false);
    nodeStore.setState({
      discoveryRequests: {
        ...nodeStore.getState().discoveryRequests,
        runtime: { status: 'loading', requestId: 101, error: null },
      },
    });
    await Promise.resolve();
    assert.equal(completed, false, 'a replacement request is still pending');
    nodeStore.setState({
      runtimeStatus: { packages: { torch: { cuda_available: false } } },
      discoveryRequests: {
        ...nodeStore.getState().discoveryRequests,
        runtime: { status: 'success', requestId: 101, error: null },
      },
    });
    await pending;
    assert.equal(runtimeFetches, 0);
    assert.deepEqual(studio.getState().form, originalForm);
    studioStore.assertWorkflowOperationContext(context);
  } finally {
    nodeStore.setState(previous[0]);
    studioStore.useStudioStore.setState(previous[1]);
  }
});

test('runtime waiting cancels promptly on document, canvas or explicit form edits and does not adopt the newer context', async (t) => {
  for (const edit of ['document', 'canvas', 'form'])
    await t.test(edit, async () => {
      const previous = [nodeStore.getState(), studioStore.useStudioStore.getState()];
      try {
        const { studio, context } = prepareLifecycleFixture('z_image_quick_concept');
        nodeStore.setState({
          discoveryRequests: {
            ...nodeStore.getState().discoveryRequests,
            runtime: { status: 'loading', requestId: 110, error: null },
          },
        });
        const pending = lifecycle.waitForTemplateRuntimeDiscovery(context);
        const cancelled = assert.rejects(pending, (error) => studioStore.isWorkflowOperationCancelled(error));
        if (edit === 'document') studio.getState().createWorkflowTab('An explicitly newer document');
        else if (edit === 'canvas') studio.setState({ workflowCanvasEpoch: studio.getState().workflowCanvasEpoch + 1 });
        else studio.getState().updateForm({ prompt: 'An explicitly newer prompt' });
        await cancelled;
        if (edit === 'form') assert.equal(studio.getState().form.prompt, 'An explicitly newer prompt');
        assert.throws(() => studioStore.assertWorkflowOperationContext(context), /workflow changed/i);
      } finally {
        nodeStore.setState(previous[0]);
        studioStore.useStudioStore.setState(previous[1]);
      }
    });
});

test('runtime waiting fails explicitly on a failed pending read or bounded timeout and releases subscriptions', async (t) => {
  for (const outcome of ['error', 'timeout', 'success-during-subscribe'])
    await t.test(outcome, async () => {
      const previous = [nodeStore.getState(), studioStore.useStudioStore.getState()];
      const originalNodesSubscribe = nodeStore.subscribe;
      const originalStudioSubscribe = studioStore.useStudioStore.subscribe;
      let subscriptions = 0;
      try {
        const { context } = prepareLifecycleFixture('z_image_quick_concept');
        nodeStore.setState({
          runtimeStatus: null,
          discoveryRequests: {
            ...nodeStore.getState().discoveryRequests,
            runtime: { status: 'loading', requestId: 120, error: null },
          },
        });
        const track = (subscribe) => (listener) => {
          subscriptions++;
          const unsubscribe = subscribe(listener);
          return () => {
            subscriptions--;
            unsubscribe();
          };
        };
        nodeStore.subscribe = track(originalNodesSubscribe);
        studioStore.useStudioStore.subscribe = track(originalStudioSubscribe);
        if (outcome === 'success-during-subscribe') {
          nodeStore.subscribe = (listener) => {
            const unsubscribe = track(originalNodesSubscribe)(listener);
            nodeStore.setState({
              runtimeStatus: { packages: { torch: { cuda_available: false } } },
              discoveryRequests: {
                ...nodeStore.getState().discoveryRequests,
                runtime: { status: 'success', requestId: 120, error: null },
              },
            });
            return unsubscribe;
          };
        }
        const pending = lifecycle.waitForTemplateRuntimeDiscovery(context, 20);
        if (outcome === 'error') {
          const failed = assert.rejects(pending, /runtime.*read failed/i);
          nodeStore.setState({
            discoveryRequests: {
              ...nodeStore.getState().discoveryRequests,
              runtime: { status: 'error', requestId: 120, error: 'Runtime read failed' },
            },
          });
          await failed;
        } else if (outcome === 'timeout') await assert.rejects(pending, /runtime.*timed out.*retry/i);
        else await pending;
        assert.equal(subscriptions, 0, 'both store subscriptions and the timeout are cleaned up');
        studioStore.assertWorkflowOperationContext(context);
      } finally {
        nodeStore.subscribe = originalNodesSubscribe;
        studioStore.useStudioStore.subscribe = originalStudioSubscribe;
        nodeStore.setState(previous[0]);
        studioStore.useStudioStore.setState(previous[1]);
      }
    });
});

test('template-owned normalization preserves available devices and explicit XPU or MPS choices without guessing on unknown runtime', async (t) => {
  for (const scenario of [
    { device: 'cuda:0', runtime: null, expected: 'cuda:0' },
    {
      device: 'cuda:0',
      runtime: {
        packages: {
          torch: { cuda_available: true, cuda_device_count: 1, cuda_devices: [{ index: 0, name: 'Reviewed GPU' }] },
        },
      },
      expected: 'cuda:0',
    },
    { device: 'xpu:0', runtime: { packages: { torch: { cuda_available: false } } }, expected: 'xpu:0' },
    { device: 'mps:0', runtime: { packages: { torch: { cuda_available: false } } }, expected: 'mps:0' },
    { device: 'cuda:0', runtime: { packages: { torch: { cuda_available: false } } }, expected: 'cpu:0' },
  ])
    await t.test(`${scenario.device} → ${scenario.expected}`, () => {
      const previous = [nodeStore.getState(), studioStore.useStudioStore.getState()];
      try {
        const { studio } = prepareLifecycleFixture('z_image_quick_concept');
        studio.setState({ form: { ...studio.getState().form, device: scenario.device } });
        const context = studioStore.captureWorkflowOperationContext();
        const before = structuredClone(studio.getState().form);
        nodeStore.setState({ runtimeStatus: scenario.runtime });
        lifecycle.normalizeTemplateRuntimeDevice(context);
        assert.equal(studio.getState().form.device, scenario.expected);
        if (scenario.expected === 'cpu:0') assert.equal(studio.getState().form.offloadMode, 'none');
        else assert.deepEqual(studio.getState().form, before);
        studioStore.assertWorkflowOperationContext(context);
      } finally {
        nodeStore.setState(previous[0]);
        studioStore.useStudioStore.setState(previous[1]);
      }
    });
});

test('ordinary Auto ControlNet creation keeps the auxiliary component resident while the base uses model CPU offload', async (t) => {
  if (!publicOperations) {
    const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
    publicOperations = operations.parseOperationContracts(
      fixture.publicPayload.operationContracts,
      fixture.publicPayload.operationContractSchemaVersion,
    );
  }
  for (const templateId of ['qwen_control_image_layout', 'qwen_packaging_dieline'])
    await t.test(templateId, async () => {
      const previous = [flowStore.getState(), nodeStore.getState(), studioStore.useStudioStore.getState()];
      const originalFetch = globalThis.fetch;
      try {
        const { row, template, studio } = prepareLifecycleFixture(templateId);
        studio.getState().updateForm({
          controlImage: 'original-byte-bound-control.png',
          resourceMode: 'auto',
          autoOffload: true,
          offloadMode: 'model_cpu',
          dtype: 'bfloat16',
          device: 'cuda:0',
        });
        const form = structuredClone(studio.getState().form);
        assert.equal(form.autoOffload, true);
        assert.equal(form.offloadMode, 'model_cpu');
        globalThis.fetch = async () => Response.json(row.starter);
        await lifecycle.createImageTemplateOperationWorkflow(
          template,
          form,
          studioStore.captureWorkflowOperationContext(),
        );
        const api = flowStore
          .getState()
          .exportGraph('control-auto-component-placement', undefined, { randomizeSeeds: false });
        const base = Object.values(api.nodes).find((node) => node.action === 'ModelsLoader');
        const auxiliary = Object.values(api.nodes).find((node) => node.action === 'AutoModelLoader');
        assert.ok(base && auxiliary);
        assert.equal(base.params.auto_offload.value, true);
        assert.equal(base.params.offload_mode.value, 'model_cpu');
        assert.equal(auxiliary.params.auto_offload.value, false);
        assert.equal(auxiliary.params.offload_mode.value, 'none');
        for (const field of ['device', 'dtype']) assert.equal(auxiliary.params[field].value, base.params[field].value);
        assert.equal(auxiliary.params.model_type.value, 'controlnet');
        assert.equal(
          api.nodes[Object.values(api.nodes).find((node) => node.action === 'Controlnet').params.controlnet.sourceId]
            .action,
          'AutoModelLoader',
        );
        assert.equal(studio.getState().graphBinding, null);
        assert.equal(studio.getState().form.resourceMode, 'auto');
      } finally {
        globalThis.fetch = originalFetch;
        flowStore.setState(previous[0]);
        nodeStore.setState(previous[1]);
        studioStore.useStudioStore.setState(previous[2]);
      }
    });
});

test('actual Qwen Edit and T2I contracts retain exact API inputs through ordinary creation and workflow import', async (t) => {
  const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  publicOperations ??= operations.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const nodeModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  const packageModule = await server.ssrLoadModule('/src/studio/workflowPackage.ts');
  const canonical = (api) => {
    const names = new Map(Object.entries(api.nodes).map(([id, node]) => [id, `${node.module}.${node.action}`]));
    assert.equal(new Set(names.values()).size, names.size, 'this fixture needs unique executable node roles');
    return Object.fromEntries(
      Object.entries(api.nodes).map(([id, node]) => [
        names.get(id),
        {
          ...node,
          params: Object.fromEntries(
            Object.entries(node.params).map(([field, param]) => [
              field,
              { ...param, ...(param.sourceId ? { sourceId: names.get(param.sourceId) } : {}) },
            ]),
          ),
        },
      ]),
    );
  };
  for (const templateId of ['qwen_character_angles', 'qwen_text_rendering'])
    await t.test(templateId, async () => {
      const previous = [flowStore.getState(), nodeStore.getState(), studioStore.useStudioStore.getState()];
      const originalFetch = globalThis.fetch;
      try {
        const { row, template, studio } = prepareLifecycleFixture(templateId);
        nodeStore.setState({ nodesRegistry: nodeModule.parseNodesResponse({ nodes: fixture.registry }).nodes });
        const form = structuredClone(studio.getState().form);
        const expectedGraph = builder.createTemplateOperationGraph(
          template,
          form,
          row.starter,
          fixture.registry,
          row.spec,
          row.capability,
        );
        const expected = flowStore
          .getState()
          .exportGraph('qwen-hydration', undefined, { sourceGraph: expectedGraph, randomizeSeeds: false });
        globalThis.fetch = async () => Response.json(row.starter);
        await lifecycle.createImageTemplateOperationWorkflow(
          template,
          form,
          studioStore.captureWorkflowOperationContext(),
        );
        const created = flowStore.getState().exportGraph('qwen-hydration', undefined, { randomizeSeeds: false });
        assert.deepEqual(canonical(created), canonical(expected), 'hydration retains the exact selected starter API');
        const flat = groups.unpackVisualOperationGroups(flowStore.getState().toObject()).graph;
        for (const node of flat.nodes) {
          if (node.data.module !== 'modules.ModularDiffusers') continue;
          const operation = operations.parseOperationContracts([node.data.operationAuthoring?.operation], 3)[0];
          assert.equal(
            Object.hasOwn(node.data.params, 'pipeline_components'),
            operation.ports.some((port) => port.name === 'pipeline_components'),
            `${node.data.action}: bundle socket applicability follows this route's actual contract`,
          );
        }
        const graph = flowStore.getState().toObject();
        const parsed = packageModule.parseWorkflowPackage({
          metadata: { studio: form },
          graph,
          restore: { formSnapshot: form, graphSnapshot: graph, graphBindingSnapshot: null },
        });
        assert.ok(parsed);
        studio.getState().createWorkflowTab('Imported exact Qwen recipe', parsed.snapshot, 'import', 'private');
        assert.deepEqual(
          flowStore.getState().exportGraph('qwen-hydration', undefined, { randomizeSeeds: false }),
          created,
          'normal workflow import preserves every API setting, component and media source',
        );
        if (templateId === 'qwen_text_rendering') {
          const bundle = await server.ssrLoadModule('/src/workflow/operationComponentBundle.ts');
          const owner = flat.nodes.find((node) => node.data.action === 'ModelsLoader');
          const bundled = bundle.setOperationComponentBundle(graph, owner.id, 'bundle');
          const expectedBundle = flowStore
            .getState()
            .exportGraph('qwen-hydration', undefined, { sourceGraph: bundled, randomizeSeeds: false });
          flowStore.getState().replaceGraph(bundled);
          assert.deepEqual(
            flowStore.getState().exportGraph('qwen-hydration', undefined, { randomizeSeeds: false }),
            expectedBundle,
            'declared bundle inputs and every supplier remain intact during graph replacement',
          );
          const bundledGraph = flowStore.getState().toObject();
          const parsedBundle = packageModule.parseWorkflowPackage({
            metadata: { studio: form },
            graph: bundledGraph,
            restore: { formSnapshot: form, graphSnapshot: bundledGraph, graphBindingSnapshot: null },
          });
          assert.ok(parsedBundle);
          studio
            .getState()
            .createWorkflowTab('Imported bundled Qwen recipe', parsedBundle.snapshot, 'import', 'private');
          assert.deepEqual(
            flowStore.getState().exportGraph('qwen-hydration', undefined, { randomizeSeeds: false }),
            expectedBundle,
            'normal import retains all declared aggregate connections',
          );
        }
      } finally {
        globalThis.fetch = originalFetch;
        flowStore.setState(previous[0]);
        nodeStore.setState(previous[1]);
        studioStore.useStudioStore.setState(previous[2]);
      }
    });
});

test('all four actual Qwen native inpaint candidates preserve their full API packets through normal import', async (t) => {
  const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  const payload = qwenInpaintCandidateFixture.publicPayload;
  const contracts = operations.parseOperationContracts(
    payload.operationContracts,
    payload.operationContractSchemaVersion,
  );
  const nodeModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  const packageModule = await server.ssrLoadModule('/src/studio/workflowPackage.ts');
  for (const row of qwenInpaintCandidateFixture.recipes)
    await t.test(row.id, () => {
      const previous = [flowStore.getState(), nodeStore.getState(), studioStore.useStudioStore.getState()];
      try {
        const template = templates.find((item) => item.id === row.id);
        const form = selectedForm(template);
        const registry = { ...fixture.registry, ...qwenInpaintCandidateFixture.registry };
        const starter = starterRequests.parseOperationStarter(
          row.starter,
          row.starter.pipelineClass,
          row.starter.task,
          contracts,
        );
        const candidate = qwenInpaintCandidate.createQwenInpaintNativeCandidateGraph(
          template,
          form,
          starter,
          registry,
          row.spec,
          row.capability,
        );
        const expected = flowStore
          .getState()
          .exportGraph('qwen-native-import', undefined, { sourceGraph: candidate, randomizeSeeds: false });
        nodeStore.setState({ nodesRegistry: nodeModule.parseNodesResponse({ nodes: registry }).nodes });
        flowStore.getState().replaceGraph(candidate);
        assert.deepEqual(
          flowStore.getState().exportGraph('qwen-native-import', undefined, { randomizeSeeds: false }),
          expected,
          'initial replacement retains the complete actual native API packet',
        );
        const graph = flowStore.getState().toObject();
        const parsed = packageModule.parseWorkflowPackage({
          metadata: { studio: form },
          graph,
          restore: { formSnapshot: form, graphSnapshot: graph, graphBindingSnapshot: null },
        });
        assert.ok(parsed);
        studioStore.useStudioStore
          .getState()
          .createWorkflowTab('Imported Qwen native candidate', parsed.snapshot, 'import', 'private');
        assert.deepEqual(
          flowStore.getState().exportGraph('qwen-native-import', undefined, { randomizeSeeds: false }),
          expected,
          'normal import retains whole_v1 owner/encoder settings, every media source and exact geometry',
        );
      } finally {
        flowStore.setState(previous[0]);
        nodeStore.setState(previous[1]);
        studioStore.useStudioStore.setState(previous[2]);
      }
    });
});

test('all four actual Qwen native recipes recover their coherent runtime settings after switching tasks and returning', async (t) => {
  const operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  const authoring = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  const contracts = operations.parseOperationContracts(
    qwenInpaintCandidateFixture.publicPayload.operationContracts,
    qwenInpaintCandidateFixture.publicPayload.operationContractSchemaVersion,
  );
  const awayRow = fixture.recipes.find((item) => item.id === 'qwen_character_angles');
  const awayContracts = operations.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const awayStarter = starterRequests.parseOperationStarter(
    awayRow.starter,
    awayRow.starter.pipelineClass,
    awayRow.starter.task,
    awayContracts,
  );
  for (const row of qwenInpaintCandidateFixture.recipes)
    await t.test(row.id, () => {
      const template = templates.find((item) => item.id === row.id);
      const starter = starterRequests.parseOperationStarter(
        row.starter,
        row.starter.pipelineClass,
        row.starter.task,
        contracts,
      );
      const candidate = qwenInpaintCandidate.createQwenInpaintNativeCandidateGraph(
        template,
        { ...selectedForm(template), device: 'cpu:0', autoOffload: false, offloadMode: 'none' },
        starter,
        { ...fixture.registry, ...qwenInpaintCandidateFixture.registry },
        row.spec,
        row.capability,
      );
      const source = structuredClone(candidate);
      const originalApi = flowStore
        .getState()
        .exportGraph('qwen-task-return', undefined, { sourceGraph: candidate, randomizeSeeds: false });
      const owner = groups
        .unpackVisualOperationGroups(candidate)
        .graph.nodes.find((node) => operations.operationOwnsModel(node.data.operationAuthoring?.operation));
      const away = authoring.planOperationChange(candidate, owner.id, awayStarter).graph;
      const archived = structuredClone(away);
      const awayOwner = groups
        .unpackVisualOperationGroups(away)
        .graph.nodes.find((node) => operations.operationOwnsModel(node.data.operationAuthoring?.operation));
      const returned = authoring.planOperationChange(away, awayOwner.id, starter);
      const flat = groups.unpackVisualOperationGroups(returned.graph).graph;
      for (const action of ['ModelsLoader', 'ImageEncode'])
        assert.equal(
          flat.nodes.find((node) => node.data.action === action).data.params.inpaint_compatibility.value,
          'whole_v1',
          `${action}: exact task return restores the authored compatibility setting as one coherent set`,
        );
      assert.ok(returned.review.preserved.some((message) => /runtime settings.*inactive draft/i.test(message)));
      assert.deepEqual(candidate, source, 'the original recipe remains immutable');
      assert.deepEqual(away, archived, 'the inactive draft remains immutable');
      const returnedApi = flowStore
        .getState()
        .exportGraph('qwen-task-return', undefined, { sourceGraph: returned.graph, randomizeSeeds: false });
      assert.deepEqual(returnedApi, originalApi, 'the exact task return retains the full valid CPU-host API packet');
      const previous = flowStore.getState();
      try {
        flowStore.getState().replaceGraph(returned.graph);
        assert.deepEqual(
          flowStore.getState().exportGraph('qwen-task-return', undefined, { randomizeSeeds: false }),
          returnedApi,
          'normal graph replacement and export retain the recovered runtime settings',
        );
      } finally {
        flowStore.setState(previous);
      }
      const reset = groups.unpackVisualOperationGroups(
        authoring.planOperationChange(away, awayOwner.id, starter, { restoreDefaults: true }).graph,
      ).graph;
      for (const action of ['ModelsLoader', 'ImageEncode'])
        assert.equal(
          authoring.operationFieldValue(
            reset.nodes.find((node) => node.data.action === action).data.params.inpaint_compatibility,
          ),
          'native',
          `${action}: explicit defaults reset retains the selected starter's runtime setting`,
        );
    });
});
