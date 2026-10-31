import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { executionPlanIdentity, executionReceiptIdentity } from './live-proof-provenance.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalGlobals = Object.fromEntries(
  ['window', 'localStorage', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
let networkRequests = 0;
const variants = [
  ['flux3_klein_fp8r512', 'flux3-klein', 'Flux3DistilledModularPipeline', 16, 1],
  ['flux3_klein_base_fp8r512', 'flux3-klein-base', 'Flux3ModularPipeline', 50, 3.5],
];
const kinds = ['text_to_image', 'single_reference_edit', 'multi_reference_edit', 'raw_coordinate_prompt', 'lora_style'];
const ids = variants.flatMap(([prefix]) => kinds.map((kind) => `${prefix}_${kind}`));
let server, templates, inputs, modelSelection, fixture;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  };
  globalThis.fetch = async () => {
    networkRequests += 1;
    throw new Error('Planning contract units must not contact any backend or network.');
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  templates = await server.ssrLoadModule('/src/studio/templates.ts');
  inputs = await server.ssrLoadModule('/src/studio/templateInputs.ts');
  modelSelection = await server.ssrLoadModule('/src/studio/templateModelSelection.ts');
  fixture = JSON.parse(await readFile(path.join(ROOT, 'tests/fixtures/public-flux3-missing-provider.v1.json'), 'utf8'));
});
after(async () => {
  try {
    await server?.close();
    assert.equal(networkRequests, 0);
  } finally {
    for (const [key, descriptor] of Object.entries(originalGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

const card = (id) => templates.STUDIO_TEMPLATES.find((item) => item.id === id);

test('ten reviewed recipes enter Experimental without inline execution or hardware qualification claims', () => {
  assert.equal(new Set(ids).size, 10);
  for (const id of ids) {
    const value = card(id);
    assert.ok(value, id);
    assert.equal(
      templates.PLANNING_STUDIO_TEMPLATES.some((item) => item.id === id),
      false,
    );
    assert.equal(value.difficulty, 'advanced');
    assert.equal(value.readinessPolicy, value.inputRequirements ? 'requires_input' : 'runnable');
    assert.equal(value.example.status, 'unverified');
    assert.equal(Object.hasOwn(value.example, 'blockReason'), false);
    assert.ok(value.tags.includes('experimental'));
    assert.match(value.example.notes, /does not qualify other prompts, placements or hardware/);
    for (const key of ['outputPath', 'thumbnailPath', 'mediaHash', 'runtimeFingerprint', 'verificationTimestamp'])
      assert.equal(Object.hasOwn(value.example, key), false, `${id}:${key}`);
    assert.equal(
      value.mediaSlots.every((slot) => !slot.path && !slot.posterPath),
      true,
    );
  }
});

test('published preview discovery keeps exact declared creator authority and rejects private or mutable replacements', async () => {
  const browser = await server.ssrLoadModule('/src/studio/templateBrowser.ts');
  for (const id of ids) {
    const template = card(id);
    assert.equal(browser.hasDeclaredExperimentalCreator(template), true, id);
    for (const replacement of [
      { ...template, executionSelection: { ...template.executionSelection, executionProfileId: 'private-fixture' } },
      { ...template, executionSelection: { ...template.executionSelection, authoringRecipeId: 'private-fixture' } },
      { ...template, executionSelection: { ...template.executionSelection, memoryPolicy: 'auto' } },
      { ...template, modelArtifact: { ...template.modelArtifact, revision: 'main' } },
    ]) {
      assert.equal(browser.hasDeclaredExperimentalCreator(replacement), false, id);
    }
  }
});

test('each card resolves the real public profile and immutable artifact while stale or private identities refuse', () => {
  const capabilities = fixture.capabilitiesPayload.capabilities;
  assert.equal(fixture.activeProvider, null);
  for (const id of ids) {
    const value = card(id);
    const selected = modelSelection.resolveTemplateModelSelection(value, capabilities);
    assert.ok(selected, id);
    assert.equal(selected.profile.public, true);
    assert.match(selected.profile.id, /^flux3-klein(?:-base)?:official-provider:v1$/u);
    assert.equal(value.executionSelection.memoryPolicy, 'custom_experimental');
    assert.equal(value.executionSelection.implementation, 'native_stages');
    assert.equal(value.modelArtifact.revision, selected.revision);
    assert.equal(value.modelArtifact.value, selected.repository);
    const staleRevision = { ...value, modelArtifact: { ...value.modelArtifact, revision: '0'.repeat(40) } };
    assert.equal(modelSelection.resolveTemplateModelSelection(staleRevision, capabilities), null);
    const privateIdentity = {
      ...value,
      executionSelection: { ...value.executionSelection, executionProfileId: 'foreign-private-profile' },
    };
    assert.equal(modelSelection.resolveTemplateModelSelection(privateIdentity, capabilities), null);
    assert.equal(selected.capability.templateEligible, false);
    assert.equal(selected.capability.galleryEligible, false);
    assert.equal(selected.capability.liveProof, false);
    assert.deepEqual(selected.capability.qualifiedModes, []);
  }
});

test('approved named source images bind ordinary one- and ordered two-reference edit contracts', () => {
  const cobalt = 'sha256:bytes:d5ba3943d6c0a264860ba0cde18d87e2d9554a3f7328308f4d771e082a9e0c24';
  const dieline = 'sha256:bytes:b748201353f02543c2a48920bb514c2741366151df45bf6c4904aeb0f32f1a67';
  for (const [prefix] of variants) {
    for (const [suffix, count] of [
      ['single_reference_edit', 1],
      ['multi_reference_edit', 2],
    ]) {
      const value = card(`${prefix}_${suffix}`);
      assert.deepEqual(
        [value.mode, value.executionSelection.task, value.executionSelection.bindingSpec.mode],
        ['edit_image', 'edit_image', 'edit_image'],
      );
      assert.equal(value.inputRequirements.referenceImages, count);
      const resolution = inputs.resolveTemplateInputs(value);
      assert.deepEqual(resolution.missingLabels, []);
      assert.deepEqual(resolution.downstreamBindings, []);
      const binding = resolution.templateDefaultBindings.find((item) => item.field === 'referenceImages');
      assert.equal(binding.origin, 'template');
      assert.equal(binding.field, 'referenceImages');
      assert.equal(binding.defaultAssets.length, count);
      assert.deepEqual(
        binding.defaultAssets.map((asset) => asset.runtimeSha256),
        [cobalt, dieline].slice(0, count),
      );
      assert.deepEqual(
        binding.defaultAssets.map((asset) => asset.runtimePath),
        [
          '/template-gallery/inputs/flux2_klein_edit.before.png',
          '/template-gallery/inputs/qwen_control_image_layout.before.png',
        ].slice(0, count),
      );
      assert.equal(new Set(binding.defaultAssets.map((asset) => asset.runtimeSha256)).size, count);
      assert.match(value.prompt, /reference image 1/i);
      if (count === 2) {
        assert.match(value.example.notes, /no native Fill claim/);
        const mask = resolution.templateDefaultBindings.find((item) => item.field === 'maskImage');
        assert.equal(mask.defaultAssets.length, 1);
        assert.equal(
          mask.defaultAssets[0].runtimeSha256,
          'sha256:bytes:d36162153e2009e0b2f3a711825d39e67c02ba3577971a444bd92eebe81169ac',
        );
        assert.deepEqual(value.example.expectedOutput, { width: 1024, height: 1024 });
      }
    }
  }
});

test('the real per-task offers retain append default and explicit raw precision or constrained choices', () => {
  for (const id of ids) {
    const value = card(id);
    const { profile } = modelSelection.resolveTemplateModelSelection(value, fixture.capabilitiesPayload.capabilities);
    const selection = value.executionSelection;
    const offer = profile.authoringRecipes.find((item) => item.task === value.mode);
    assert.ok(offer, id);
    assert.equal(selection.authoringRecipeId, offer.authoringRecipeId);
    assert.match(offer.authoringRecipeId, /:prompt-preview-append-fp32:v1$/u);
    assert.deepEqual(
      offer.rawAuthoringRecipeChoices.map(({ label }) => label),
      ['Raw wording: FP32', 'Raw wording: BF16 + NF4'],
    );
    assert.deepEqual(
      offer.rawAuthoringRecipeChoices.map(({ authoringRecipeId }) => authoringRecipeId),
      [offer.authoringRecipeId.replace('append-fp32', 'fp32'), offer.authoringRecipeId.replace('append-fp32', 'nf4')],
    );
    assert.deepEqual(
      offer.layoutAuthoringRecipeChoices.map(({ label }) => label),
      ['Append wording: preserve authored layout', 'Generate constrained table: FP32 (Expert)'],
    );
    assert.equal(offer.layoutAuthoringRecipeChoices[0].authoringRecipeId, offer.authoringRecipeId);
    assert.equal(
      offer.layoutAuthoringRecipeChoices[1].authoringRecipeId,
      offer.authoringRecipeId.replace('append-fp32', 'constrained-fp32'),
    );
  }
});

test('locked diffusion recipes remain explicit and independent of optional PUP NF4', () => {
  for (const [prefix, , , steps, guidance] of variants) {
    for (const kind of kinds) {
      const value = card(`${prefix}_${kind}`);
      const locked = value.example.lockedSettings;
      assert.deepEqual([locked.width, locked.height, locked.steps, locked.guidanceScale], [512, 512, steps, guidance]);
      assert.deepEqual(
        [locked.dtype, locked.quantizationMode, locked.resourceMode, locked.autoOffload, locked.offloadMode],
        ['bfloat16', 'none', 'expert', false, 'none'],
      );
      assert.equal(locked.randomSeed, false);
      assert.equal(value.example.expectedOutput.width, kind === 'multi_reference_edit' ? 1024 : 512);
      assert.equal(locked.weightFormat, 'fp8r');
    }
  }
});

test('raw coordinate examples are complete prompt text without seeded layout or generated-table claims', () => {
  for (const [prefix] of variants) {
    const value = card(`${prefix}_raw_coordinate_prompt`);
    const [caption, json] = value.prompt.split('\n');
    assert.equal(caption, 'A still life with <apple_1>.');
    assert.deepEqual(JSON.parse(json), [
      { id: 'apple_1', bbox: [250, 125, 750, 875], desc: 'A red apple, with a green leaf.' },
    ]);
    assert.equal(Object.hasOwn(value.example.lockedSettings, 'layoutConditioning'), false);
    assert.match(value.example.notes, /layout_conditioning field remains null/);
    assert.match(value.example.notes, /PUP stays disabled/);
    assert.match(value.example.notes, /not a seeded region-widget or generated-table template/);
  }
});

test('selected NASA and Monet candidates bind exact adapters and prompts without promoting trial evidence', () => {
  const candidates = [
    {
      id: 'flux3_klein_fp8r512_lora_style',
      repository: 'kocabiyik/nsc7-style-lora',
      revision: '9b998d3bdc3b4aeb2113ab4e8cbd9fe2ebfa1cae',
      sha256: 'ae6c417cb3bb8ee6f5272a8115d7720587319c6099fffa80f8d39bbbf307daf7',
      byteSize: 160696320,
      weightName: 'nsc7-style-lora.safetensors',
      adapterName: 'nsc7',
      scale: 0.75,
      seed: 481205,
      prompt:
        'One complete rotating ring habitat above Earth, seen from outside in three-quarter view. A single continuous white torus surrounds a plain central hub. Warm sunlight falls across the curved structure against deep blue space, with a small view of Earth below. Every hardware surface is blank and unmarked. One habitat fills a balanced square composition, without people, other spacecraft, plants, flowers, grass or stems. No writing, letters, numbers, labels, logos, emblems, watermarks, signatures, border or frame. nsc7 style',
    },
    {
      id: 'flux3_klein_base_fp8r512_lora_style',
      repository: 'pjecuacion/flux3-klein-mnt-oil-monet-lora',
      revision: '0d94b6a4601892499defd8c5d89c24f78e78043b',
      sha256: 'a25e926d8e5fd0069ed5ee3db67be8ac191df4d713bc807e2abfe61a8f885047',
      byteSize: 80381072,
      weightName: 'mnt_oil_klein3.safetensors',
      adapterName: 'mnt_oil',
      scale: 0.65,
      seed: 481405,
      prompt:
        'mnt_oil, a full-bleed impressionist oil painting of a single red fox walking through sunlit meadow grass beside a quiet woodland pond. The fox has a clear natural silhouette, one head, one bushy tail and coherent legs. Loose broken brushstrokes and luminous green and gold reflections contrast with soft blue shadows. Grass, reeds, water and dappled foliage fill the entire square canvas from edge to edge. The lower corners are softly painted meadow grass and pond reflections, continuous with the rest of the scene. A simple peaceful composition, natural morning light, no people, no lettering, no frame.',
    },
  ];
  for (const expected of candidates) {
    const value = card(expected.id);
    assert.equal(value.evidencePolicy, 'generated');
    assert.equal(value.inputRequirements?.loraAdapter, undefined);
    assert.deepEqual(value.workflowBlocks, ['lora']);
    assert.ok(value.requiredBackendCapabilities.includes('modules.ModularDiffusers.Lora'));
    assert.deepEqual(value.executionSelection.loraPolicy, { defaultAdapterName: expected.adapterName });
    const lora = value.workflowBlockSettings.lora;
    assert.deepEqual(lora.model, {
      source: 'hub',
      value: expected.repository,
      revision: expected.revision,
      sha256: expected.sha256,
      byteSize: expected.byteSize,
      license: 'FLUX Kommunity License v1.0',
    });
    assert.deepEqual(
      [lora.weightName, lora.adapterName, lora.scale, lora.additionalAdapters],
      [expected.weightName, expected.adapterName, expected.scale, undefined],
    );
    assert.equal(value.prompt, expected.prompt);
    assert.equal(value.description, expected.prompt);
    assert.equal(value.negativePrompt, '');
    assert.equal(value.example.lockedSeed, expected.seed);
    assert.match(value.label, /LoRA Style:/);
    assert.equal(value.example.status, 'unverified');
    assert.match(value.example.notes, /model_cpu.*autoOffload=true/);
    assert.match(value.example.notes, /none.*autoOffload=false/);
    assert.match(value.promptGuide.modelHints.join(' '), /FLUX Kommunity License/);
  }
});

test('revised plain-radio recipes retain distinct tested seeds', () => {
  assert.equal(card('flux3_klein_fp8r512_text_to_image').example.lockedSeed, 481402);
  assert.equal(card('flux3_klein_base_fp8r512_text_to_image').example.lockedSeed, 481401);
});

// Complete source inputs are not native output, fit or publication proof.
test('all ten reviewed fixed-input recipes retain complete source authority without inline qualification', () => {
  for (const id of ids) {
    const value = card(id);
    assert.deepEqual(inputs.resolveTemplateInputs(value).missingLabels, []);
    assert.ok(value.prompt.trim());
    assert.equal(value.runtimeReuseKey.includes(':fp8r:'), true);
    assert.equal(value.executionSelection.memoryPolicy, 'custom_experimental');
  }
  for (const id of ids) {
    const value = card(id);
    assert.equal(
      templates.PLANNING_STUDIO_TEMPLATES.some((item) => item.id === id),
      false,
    );
    assert.equal(value.readinessPolicy, value.inputRequirements ? 'requires_input' : 'runnable');
    assert.equal(value.example.status, 'unverified');
    assert.equal(Object.hasOwn(value.example, 'blockReason'), false);
    assert.equal(Object.hasOwn(value.example, 'outputPath'), false);
    assert.equal(Object.hasOwn(value.example, 'runtimeFingerprint'), false);
  }
});

// This uses captured source metadata and mocked managed input paths only. It
// constructs ordinary graphs; it does not read media, execute or qualify models.
test('all ten reviewed cards create the unchanged ordinary FP8r task graphs', async () => {
  const load = (name) => server.ssrLoadModule(`/src/${name}.ts`);
  const [operations, catalog, choices, requests, creator, flow, defaults, exactness, visualGroups] = await Promise.all([
    load('workflow/operationContracts'),
    load('workflow/operationCatalog'),
    load('workflow/workflowChoices'),
    load('workflow/operationStarterRequest'),
    load('studio/templateOperationWorkflow'),
    load('stores/useFlowStore'),
    load('studio/modelProfiles'),
    load('studio/templateExactness'),
    load('workflow/visualOperationGroupProjection'),
  ]);
  const captured = JSON.parse(
    await readFile(path.join(ROOT, 'tests/fixtures/public-flux3-template-creators.v1.json'), 'utf8'),
  );
  const capturedBefore = structuredClone(captured);
  assert.equal(captured.activeProvider, null);
  assert.equal(captured.starters.length, 10);
  for (const key of [
    'modules.Image.Load',
    'modules.Image.Preview',
    'modules.ModularDiffusers.ImageEncode',
    'modules.ModularDiffusers.Lora',
  ]) {
    const leaf = captured.registry[key];
    assert.ok(leaf, key);
    assert.equal(`${leaf.module}.${leaf.action}`, key);
  }
  const payload = captured.capabilitiesPayload;
  const contracts = operations.parseOperationContracts(
    payload.operationContracts,
    payload.operationContractSchemaVersion,
  );
  const support = catalog.parsePipelineSupport(
    payload.pipelineSupport,
    payload.pipelineSupportSchemaVersion,
    contracts,
  );
  const descriptors = choices.parseWorkflowModelDescriptors(payload, support);
  const registry = structuredClone(captured.registry);
  const utilities = JSON.parse(
    await readFile(path.join(ROOT, 'tests/fixtures/template-image-composite-utilities.v1.json'), 'utf8'),
  );
  Object.assign(registry, structuredClone(utilities.registry));
  const registryBefore = structuredClone(registry);
  for (const id of ids) {
    const value = card(id);
    const cardBefore = structuredClone(value);
    const selected = modelSelection.resolveTemplateModelSelection(value, payload.capabilities);
    assert.ok(selected, id);
    const { capability, repository, revision } = selected;
    const selection = value.executionSelection;
    const specs = capability.studioExecutionSpecs.filter(
      (item) => item.mode === value.mode && item.executionProfileId === selection.executionProfileId,
    );
    assert.equal(specs.length, 1, id);
    const spec = specs[0];
    const sources = captured.starters.filter(
      (item) =>
        item.pipelineClass === selection.pipelineClass &&
        item.task === selection.task &&
        item.authoring.id === selection.authoringRecipeId &&
        item.authoring.executionProfileIds.includes(selection.executionProfileId),
    );
    assert.equal(sources.length, 1, `${id}: exact captured public per-task starter`);
    const starter = requests.parseOperationStarter(
      structuredClone(sources[0]),
      selection.pipelineClass,
      selection.task,
      contracts,
      { executionProfileId: selection.executionProfileId, authoringRecipeId: selection.authoringRecipeId },
    );
    const rawOwners = starter.nodes.filter(
      (item) => item.node.module === 'modules.ModularDiffusers' && item.node.action === 'ModelsLoader',
    );
    assert.equal(rawOwners.length, 1);
    const device = rawOwners[0].node.params.device.value;
    assert.equal(device, 'cpu:0', 'use the actual captured CPU fixture device, not a GPU claim');
    for (const [, key] of starter.authoring.roles)
      assert.ok(value.requiredBackendCapabilities.includes(key), `${id}: declared creator role ${key}`);
    const defaultBindings = inputs.resolveTemplateInputs(value).templateDefaultBindings;
    const assets = defaultBindings
      .filter((binding) => binding.field === 'referenceImages')
      .flatMap((binding) => binding.defaultAssets);
    const maskAsset = defaultBindings.find((binding) => binding.field === 'maskImage')?.defaultAssets[0];
    // These do not resolve or copy public assets: the real upload service would
    // supply managed input paths after normal hash verification.
    const references = assets.map((asset, index) => `unit-managed-inputs/${id}/${index}-${asset.fileName}`);
    const form = {
      ...defaults.DEFAULT_STUDIO_FORM,
      ...exactness.getTemplateLockedSettings(value),
      mode: value.mode,
      modelType: value.modelType,
      device,
      referenceImages: references,
      maskImage: maskAsset ? `unit-managed-inputs/${id}/${maskAsset.fileName}` : '',
    };
    assert.equal(Object.hasOwn(form, 'modelRepo'), false, 'Normal creator form does not store the loader repository.');
    assert.deepEqual(
      [form.weightFormat, form.dtype, form.quantizationMode, form.resourceMode],
      ['fp8r', 'bfloat16', 'none', 'expert'],
    );
    const grouped = creator.createTemplateOperationGraph(value, form, starter, registry, spec, capability, {
      workflowModelDescriptors: descriptors,
    });
    const graph = flow.expandFlowExecutionGraph(grouped.nodes, grouped.edges);
    const nodeFor = (module, action) => {
      const nodes = graph.nodes.filter((node) => node.data.module === module && node.data.action === action);
      assert.equal(nodes.length, 1, `${id}: ${module}.${action}`);
      return nodes[0];
    };
    const owner = nodeFor('modules.ModularDiffusers', 'ModelsLoader');
    const prompt = nodeFor('modules.ModularDiffusers', 'EncodePrompt');
    const denoise = nodeFor('modules.ModularDiffusers', 'Denoise');
    const preview = nodeFor('modules.Image', 'Preview');
    assert.deepEqual(owner.data.params.repo_id.value, { source: 'hub', value: repository });
    assert.deepEqual(
      [
        owner.data.params.model_type.value,
        owner.data.params.revision.value,
        owner.data.params.weight_format.value,
        owner.data.params.dtype.value,
        owner.data.params.device.value,
      ],
      [selection.pipelineClass, revision, 'fp8r', 'bfloat16', device],
    );
    assert.equal(owner.data.params.auto_offload.value, false);
    assert.equal(owner.data.params.offload_mode.value, 'none');
    assert.equal(
      graph.nodes.some((node) => node.data.action === 'QuantizationConfigNode'),
      false,
      `${id}: parent text-encoder quantization requires an explicitly authored derivative`,
    );
    assert.equal(
      graph.edges.some((edge) => edge.target === owner.id && edge.targetHandle === 'quant_config'),
      false,
    );
    assert.equal(prompt.data.params.prompt.value, value.prompt);
    assert.equal(prompt.data.params.layout_conditioning.value ?? prompt.data.params.layout_conditioning.default, null);
    assert.deepEqual(
      [
        denoise.data.params.width.value,
        denoise.data.params.height.value,
        denoise.data.params.num_inference_steps.value,
      ],
      [512, 512, form.steps],
    );
    const edge = (from, sourceHandle, to, targetHandle) => {
      const matches = graph.edges.filter(
        (item) =>
          item.source === from.id &&
          item.sourceHandle === sourceHandle &&
          item.target === to.id &&
          item.targetHandle === targetHandle,
      );
      assert.equal(
        matches.length,
        1,
        `${id}: ${from.data.action}.${sourceHandle} -> ${to.data.action}.${targetHandle}`,
      );
    };
    edge(nodeFor('modules.ModularDiffusers', 'DecodeLatents'), 'images', preview, 'image');
    if (value.workflowBlocks?.includes('lora')) {
      const lora = nodeFor('modules.ModularDiffusers', 'Lora');
      const expected = value.workflowBlockSettings.lora;
      assert.deepEqual(lora.data.params.model.value, { source: 'hub', value: expected.model.value });
      assert.deepEqual(
        ['revision', 'expected_sha256', 'weight_name', 'adapter_name', 'scale'].map(
          (field) => lora.data.params[field].value,
        ),
        [expected.model.revision, expected.model.sha256, expected.weightName, expected.adapterName, expected.scale],
      );
      assert.notEqual(lora.data.params.revision.value, owner.data.params.revision.value);
      edge(lora, 'lora', owner, 'lora_list');
      assert.equal(
        graph.edges.some((item) => item.target === lora.id && item.targetHandle === 'previous_loras'),
        false,
      );
    } else {
      assert.equal(
        graph.nodes.some((node) => node.data.action === 'Lora'),
        false,
      );
    }
    if (value.mode === 'edit_image') {
      const encoder = nodeFor('modules.ModularDiffusers', 'ImageEncode');
      const imageWire = graph.edges.find((item) => item.target === encoder.id && item.targetHandle === 'image');
      const image = graph.nodes.find((item) => item.id === imageWire.source);
      assert.equal(image.data.module, 'modules.Image');
      assert.equal(image.data.action, 'Load');
      assert.deepEqual(image.data.params.file.value, references, `${id}: preserve ordered references`);
      assert.equal(references.length, value.inputRequirements.referenceImages);
      edge(owner, 'vae_out', encoder, 'vae');
      edge(image, 'image', encoder, 'image');
      edge(encoder, 'image_cond_latents', denoise, 'image_cond_latents');
      edge(encoder, 'reference_binding', prompt, 'reference_binding');
      edge(encoder, 'reference_binding', denoise, 'reference_binding');
    } else {
      assert.deepEqual(references, []);
      assert.equal(
        graph.nodes.some(
          (node) =>
            node.data.action === 'ImageEncode' || (node.data.module === 'modules.Image' && node.data.action === 'Load'),
        ),
        false,
      );
      assert.equal(
        graph.edges.some((item) => item.target === denoise.id && item.targetHandle === 'image_cond_latents'),
        false,
      );
    }
    if (value.modelType === 'Flux3ModularPipeline') {
      const guider = nodeFor('modules.ModularDiffusers', 'Guider');
      assert.equal(guider.data.params.guidance_scale.value, 3.5);
      edge(guider, 'guider_out', denoise, 'guider');
    }
    if (id.endsWith('_multi_reference_edit')) {
      const settings = {
        backgroundReferenceIndex: 1,
        foregroundSize: { width: 768, height: 768 },
        verticalPad: { width: 768, height: 1280 },
        horizontalPad: { width: 1024, height: 1280 },
        crop: { x: 0, y: value.modelType === 'Flux3ModularPipeline' ? 165 : 205, width: 1024, height: 1024 },
        maskChannel: 'luminance',
        invertMask: false,
      };
      const composedTemplate = {
        ...value,
        workflowBlocks: ['masked_composite'],
        workflowBlockSettings: { maskedComposite: settings },
      };
      const composedForm = { ...form, maskImage: 'unit-managed-inputs/protected-photo-mask.png' };
      const compose = (template = composedTemplate, currentForm = composedForm, nodes = registry) =>
        creator.createTemplateOperationGraph(template, currentForm, starter, nodes, spec, capability, {
          workflowModelDescriptors: descriptors,
        });
      const groupedComposite = compose();
      const composed = flow.expandFlowExecutionGraph(groupedComposite.nodes, groupedComposite.edges);
      const byAction = (module, action) =>
        composed.nodes.filter((node) => node.data.module === module && node.data.action === action);
      assert.equal(byAction('modules.ModularDiffusers', 'ModelsLoader').length, 1);
      const exported = flow.useFlowStore.getState().exportGraph('composite-source-unit', undefined, {
        sourceGraph: groupedComposite,
        randomizeSeeds: false,
      });
      const baseline = flow.useFlowStore.getState().exportGraph('composite-baseline-unit', undefined, {
        sourceGraph: grouped,
        randomizeSeeds: false,
      });
      const loaderCall = (api) => Object.values(api.nodes).find((node) => node.action === 'ModelsLoader').params;
      assert.deepEqual(
        loaderCall(exported),
        loaderCall(baseline),
        'composition never changes the executable model recipe',
      );
      assert.equal(byAction('modules.Image', 'Load').length, 3);
      const masks = byAction('modules.Image', 'Load').filter(
        (node) => JSON.stringify(node.data.params.file.value) === JSON.stringify([composedForm.maskImage]),
      );
      assert.equal(masks.length, 1);
      const backgrounds = byAction('modules.Image', 'Load').filter(
        (node) => JSON.stringify(node.data.params.file.value) === JSON.stringify([references[1]]),
      );
      assert.equal(backgrounds.length, 1, 'background is the second reference, preserving the generation input order');
      const resizes = byAction('modules.Image', 'Resize');
      assert.deepEqual(
        resizes.map((node) =>
          ['width', 'height', 'method', 'interpolation', 'multiple_of'].map((k) => node.data.params[k].value),
        ),
        [
          [768, 768, 'stretch', 'lanczos', 1],
          [768, 1280, 'pad', 'lanczos', 1],
          [1024, 1280, 'pad', 'lanczos', 1],
        ],
      );
      const crops = byAction('modules.ImageOperations', 'CropImage');
      assert.equal(crops.length, 1);
      assert.equal(crops[0].data.params.y.value, settings.crop.y);
      const composites = byAction('modules.ImageOperations', 'MaskComposite');
      const saves = byAction('modules.Image', 'Save');
      assert.equal(composites.length, 1);
      assert.equal(saves.length, 1);
      assert.equal(saves[0].data.params.saved_images.fieldOptions.format, 'PNG');
      assert.equal(saves[0].data.studioRole, 'compositeOutput');
      assert.match(saves[0].data.params.filename.value, /\.png$/u);
      for (const [source, output, target, input] of [
        [backgrounds[0], 'image', composites[0], 'background'],
        [masks[0], 'image', composites[0], 'mask'],
        [crops[0], 'output', composites[0], 'foreground'],
        [composites[0], 'output', saves[0], 'image'],
      ])
        assert.equal(
          composed.edges.filter(
            (e) =>
              e.source === source.id && e.sourceHandle === output && e.target === target.id && e.targetHandle === input,
          ).length,
          1,
        );
      assert.equal(Object.values(exported.nodes).filter((node) => node.action === 'MaskComposite').length, 1);
      assert.equal(Object.values(exported.nodes).filter((node) => node.action === 'Save').length, 1);
      assert.throws(() => compose(composedTemplate, { ...composedForm, maskImage: '' }), /protection mask/);
      assert.throws(() => compose(composedTemplate, { ...composedForm, batchSize: 2 }), /one image per prompt/);
      assert.throws(
        () =>
          compose({
            ...composedTemplate,
            workflowBlockSettings: {
              maskedComposite: { ...settings, backgroundReferenceIndex: 2 },
            },
          }),
        /existing ordered reference/,
      );
      assert.throws(
        () =>
          compose({
            ...composedTemplate,
            workflowBlockSettings: {
              maskedComposite: { ...settings, crop: { ...settings.crop, y: -1 } },
            },
          }),
        /crop origin/,
      );
      const lossyRegistry = structuredClone(registry);
      delete lossyRegistry['modules.Image.Save'].params.saved_images.fieldOptions;
      assert.throws(() => compose(composedTemplate, composedForm, lossyRegistry), /lossless Save Image/);
      for (const key of Object.keys(utilities.registry)) {
        const missing = structuredClone(registry);
        delete missing[key];
        assert.throws(() => compose(composedTemplate, composedForm, missing), /backend registry is missing/);
      }
    }
    assert.equal(
      graph.nodes.some((node) => node.data.module === 'modules.HuggingFaceTransformers'),
      false,
      'PUP starts disabled; graph authoring is not a provider execution',
    );
    // Ordinary production Run adds correlation plus this durable snapshot,
    // without a managed Studio resource plan. Use the real creator/exporter;
    // these are CPU metadata fixtures, never native execution measurements.
    const apiGraph = flow.useFlowStore.getState().exportGraph('native-expert-proof', undefined, {
      sourceGraph: grouped,
      randomizeSeeds: false,
    });
    const proofGraph = {
      ...apiGraph,
      runtimeHints: { workflowSnapshot: { ...structuredClone(grouped), studioForm: form, studioGraphBinding: null } },
    };
    for (const hints of [{}, { resourceMode: 'expert' }]) {
      const current = { ...proofGraph, runtimeHints: { ...proofGraph.runtimeHints, ...hints } };
      const plan = executionPlanIdentity(current).plan;
      assert.equal(plan.source, 'executed-expert-modular-graph-v1', id);
      assert.equal(plan.modelType, selection.pipelineClass);
      assert.equal(plan.modelRepo, repository);
      assert.equal(plan.modelRevision, revision);
      assert.equal(plan.executionProfileId, selection.executionProfileId);
      assert.equal(plan.authoringRecipeId, selection.authoringRecipeId);
      assert.deepEqual(
        [plan.dtype, plan.weightFormat, plan.quantizationMode, plan.device],
        ['bfloat16', 'fp8r', 'none', device],
      );
      assert.deepEqual([plan.autoOffload, plan.offloadMode, plan.weightLoadingMode], [false, 'none', 'cpu']);
      assert.equal(
        executionReceiptIdentity({}, plan).resourceCandidateId,
        `manual-resource-v1:${selection.pipelineClass}|bfloat16|none|none`,
      );
      assert.equal(executionReceiptIdentity({}, plan).peakMemoryBytes, null, 'No fabricated measurement.');
      const retainedRepo = structuredClone(current);
      retainedRepo.runtimeHints.workflowSnapshot.studioForm.modelRepo = repository;
      assert.deepEqual(executionPlanIdentity(retainedRepo).plan, plan, 'An optional matching repository stays valid.');
    }
    const ordinary = visualGroups.unpackVisualOperationGroups(grouped).graph;
    const ordinaryApi = flow.useFlowStore.getState().exportGraph('native-expert-proof-ordinary', undefined, {
      sourceGraph: ordinary,
      randomizeSeeds: false,
    });
    ordinaryApi.runtimeHints = { workflowSnapshot: { ...ordinary, studioForm: form, studioGraphBinding: null } };
    assert.deepEqual(
      executionPlanIdentity(ordinaryApi).plan,
      executionPlanIdentity(proofGraph).plan,
      'Ordinary and grouped creator graphs prove the same loading recipe.',
    );
    if (id === ids[0]) {
      const loaderId = Object.keys(apiGraph.nodes).find((key) => apiGraph.nodes[key].action === 'ModelsLoader');
      const parentContext = (g) =>
        g.runtimeHints.workflowSnapshot.nodes
          .flatMap((node) => node.data.blockInstanceV2?.effectiveGraph.nodes ?? [node])
          .find((node) => node.data.operationAuthoring?.ancillaryParent)?.data.operationAuthoring.ancillaryParent;
      const mutations = [
        (g) => {
          g.runtimeHints.workflowSnapshot.studioForm.dtype = 'float16';
        },
        (g) => {
          g.runtimeHints.workflowSnapshot.studioForm.weightFormat = 'native';
        },
        (g) => {
          g.runtimeHints.workflowSnapshot.studioForm.device = 'cuda:9';
        },
        (g) => {
          g.runtimeHints.workflowSnapshot.studioForm.autoOffload = true;
        },
        (g) => {
          g.runtimeHints.workflowSnapshot.studioForm.modelType = 'OtherPipeline';
        },
        (g) => {
          g.runtimeHints.workflowSnapshot.studioForm.modelRepo = 'Other/Model';
        },
        ...[null, '', 123, { source: 'hub', value: repository }].map((modelRepo) => (g) => {
          g.runtimeHints.workflowSnapshot.studioForm.modelRepo = modelRepo;
        }),
        (g) => {
          g.runtimeHints.workflowSnapshot.studioForm.trustRemoteCode = true;
        },
        (g) => {
          g.nodes[loaderId].params.repo_id.value = repository;
        },
        (g) => {
          g.nodes[loaderId].params.revision.value = 'main';
        },
        (g) => {
          g.nodes[loaderId].params.trust_remote_code.value = true;
        },
        (g) => {
          g.nodes[loaderId].params.dtype.sourceId = 'foreign';
        },
        (g) => {
          g.nodes[loaderId].params.quant_config.sourceId = 'foreign';
        },
        (g) => {
          g.nodes[loaderId].params.unet.sourceId = 'foreign';
        },
        (g) => {
          g.paths = g.paths.map((row) => row.filter((key) => key !== loaderId));
        },
        (g) => {
          g.nodes.extra = structuredClone(g.nodes[loaderId]);
          g.paths[0].push('extra');
        },
        (g) => {
          g.runtimeHints.workflowSnapshot.nodes = [];
        },
        (g) => {
          g.runtimeHints.resourceMode = 'auto';
        },
        (g) => {
          parentContext(g).parent.executionProfileId = 'foreign-profile';
        },
        (g) => {
          delete parentContext(g).parent.authoringRecipeId;
        },
        (g) => {
          parentContext(g).parent.task = 'edit_image';
        },
        (g) => {
          parentContext(g).parentRoleNodes.models = 'foreign';
        },
        (g) => {
          parentContext(g).parentRoleNodes.prompt = 'foreign';
        },
        (g) => {
          parentContext(g).parentRoleNodes.decode = parentContext(g).parentRoleNodes.denoise;
        },
        (g) => {
          g.nodes[Object.keys(g.nodes).find((key) => g.nodes[key].action === 'DecodeLatents')].params.vae.sourceId =
            'foreign';
        },
      ];
      for (const [index, mutate] of mutations.entries()) {
        const changed = structuredClone(proofGraph);
        mutate(changed);
        assert.equal(
          executionReceiptIdentity({}, executionPlanIdentity(changed).plan).resourceCandidateId,
          null,
          `native Expert mismatch ${index} must not recover a receipt identity`,
        );
      }
    }
    assert.deepEqual(value, cardBefore);
    assert.equal(value.example.status, 'unverified');
  }
  assert.deepEqual(registry, registryBefore);
  assert.deepEqual(captured, capturedBefore);
});
