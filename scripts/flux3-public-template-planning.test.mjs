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

const card = (id) => templates.PLANNING_STUDIO_TEMPLATES.find((item) => item.id === id);

test('ten public-intent descriptors remain blocked planning entries without output or qualification claims', () => {
  assert.equal(new Set(ids).size, 10);
  for (const id of ids) {
    const value = card(id);
    assert.ok(value, id);
    assert.equal(
      templates.STUDIO_TEMPLATES.some((item) => item.id === id),
      false,
    );
    assert.equal(value.difficulty, 'blocked');
    assert.equal(value.readinessPolicy, 'planning');
    assert.equal(value.example.status, 'blocked');
    assert.match(value.example.blockReason, /grants no Gallery, Auto or hardware qualification/);
    for (const key of ['outputPath', 'thumbnailPath', 'mediaHash', 'runtimeFingerprint', 'verificationTimestamp'])
      assert.equal(Object.hasOwn(value.example, key), false, `${id}:${key}`);
    assert.equal(
      value.mediaSlots.every((slot) => !slot.path && !slot.posterPath),
      true,
    );
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
      const binding = resolution.templateDefaultBindings[0];
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
      if (count === 2) assert.match(value.example.notes, /not ControlNet/);
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
      assert.equal(value.example.expectedOutput.width, 512);
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
    assert.match(value.example.blockReason, /not a seeded region-widget or generated-table template/);
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
      prompt:
        'An unbranded ceramic field radio, a folded linen cloth and a single dried grass stem form a balanced three-quarter tabletop still life. Warm side lighting defines the radio silhouette and contact shadows. The radio, linen and stem remain clearly separated against an uncluttered background. No people, logos, readable text, signatures, watermarks or unrelated objects. nsc7 style',
    },
    {
      id: 'flux3_klein_base_fp8r512_lora_style',
      repository: 'pjecuacion/flux3-klein-mnt-oil-monet-lora',
      revision: '0d94b6a4601892499defd8c5d89c24f78e78043b',
      sha256: 'a25e926d8e5fd0069ed5ee3db67be8ac191df4d713bc807e2abfe61a8f885047',
      byteSize: 80381072,
      weightName: 'mnt_oil_klein3.safetensors',
      adapterName: 'mnt_oil',
      scale: 1,
      prompt:
        'mnt_oil, an oil painting of a single red fox standing on a moss-covered rock in an ancient forest. The fox is clearly separated from the trees and foliage, with soft morning light filtering through the canopy. Preserve one coherent fox, a readable rock silhouette and a balanced square composition. No ornamental card frame, lettering, logos, signatures or watermarks.',
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
    assert.match(value.label, /Test Candidate/);
    assert.match(value.example.blockReason, /output publication approval/);
    assert.match(value.example.notes, /model_cpu.*autoOffload=true/);
    assert.match(value.example.notes, /none.*autoOffload=false/);
    assert.match(value.promptGuide.modelHints.join(' '), /FLUX Kommunity License/);
  }
});

// Complete source inputs are not native output, fit or publication proof.
test('all ten fixed-input recipes are source-complete while exact public proof remains pending', () => {
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
      templates.STUDIO_TEMPLATES.some((item) => item.id === id),
      false,
    );
    assert.equal(value.readinessPolicy, 'planning');
    assert.equal(value.example.status, 'blocked');
    assert.match(value.example.blockReason, /Native output and template qualification/);
    assert.equal(Object.hasOwn(value.example, 'outputPath'), false);
    assert.equal(Object.hasOwn(value.example, 'runtimeFingerprint'), false);
  }
});

// This uses captured source metadata and mocked managed input paths only. It
// constructs ordinary graphs; it does not read media, execute or qualify models.
test('all ten fixed-input planning cards create exact ordinary FP8r task graphs', async () => {
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
    const assets = inputs
      .resolveTemplateInputs(value)
      .templateDefaultBindings.flatMap((binding) => binding.defaultAssets);
    // These do not resolve or copy public assets: the real upload service would
    // supply managed input paths after normal hash verification.
    const references = assets.map((asset, index) => `unit-managed-inputs/${id}/${index}-${asset.fileName}`);
    const form = {
      ...defaults.DEFAULT_STUDIO_FORM,
      ...exactness.getTemplateLockedSettings(value),
      mode: value.mode,
      modelType: value.modelType,
      modelRepo: repository,
      device,
      referenceImages: references,
    };
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
      const image = nodeFor('modules.Image', 'Load');
      const encoder = nodeFor('modules.ModularDiffusers', 'ImageEncode');
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
    assert.equal(value.example.status, 'blocked');
  }
  assert.deepEqual(registry, registryBefore);
  assert.deepEqual(captured, capturedBefore);
});
