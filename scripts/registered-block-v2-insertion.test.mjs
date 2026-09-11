import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const QWEN_2512_CREATOR_PROMPT =
  'A 20-year-old East Asian girl with delicate, charming features and large, bright brown eyes—expressive and ' +
  'lively, with a cheerful or subtly smiling expression. Her naturally wavy long hair is either loose or tied in ' +
  'twin ponytails. She has fair skin and light makeup accentuating her youthful freshness. She wears a modern, ' +
  'cute dress or relaxed outfit in bright, soft colors—lightweight fabric, minimalist cut. She stands indoors at ' +
  'an anime convention, surrounded by banners, posters, or stalls. Lighting is typical indoor illumination—no ' +
  'staged lighting—and the image resembles a casual iPhone snapshot: unpretentious composition, yet brimming with ' +
  'vivid, fresh, youthful charm.';

let blockRuntime;
let blockSchema;
let blockPersistence;
let blockRunForm;
let blockAutoAuthority;
let blockExecutionAuthority;
let blockAdapter;
let connectionTypeCompatibility;
let conditionalStore;
let flowStore;
let clusterGraph;
let clusterInstance;
let clusterMaterializer;
let clusterRuntime;
let catalogModule;
let insertion;
let libraryStore;
let migrationGenerator;
let modelProfiles;
let modularComposition;
let modularBlockInsertion;
let nodeStore;
let outputContracts;
let routeModule;
let runCoordinator;
let server;
let settingsStore;
let studioStore;
let topBarAutoPolicy;
let originalFetch;
let storage;
let compiledCatalogRequests;

test('full FLUX.2 has an exact Expert Model Manager profile without Auto promotion', () => {
  const profile = modelProfiles
    .getCatalogModelProfiles({ includeWorkflowOnly: true })
    .find((item) => item.modelType === 'Flux2ModularPipeline');
  assert.ok(profile, 'A runnable registered cluster must not disappear from Model Manager');
  assert.equal(profile.defaultRepo, 'black-forest-labs/FLUX.2-dev');
  assert.deepEqual(profile.revisionCandidates, ['26afe3a78bb242c0a8bb181dcc8937bb16e5c66c']);
  assert.deepEqual(profile.modes, ['text_to_image', 'edit_image']);
  assert.equal(profile.autoEligible, false);
  assert.equal(profile.galleryEligible, false);
  assert.equal(profile.liveProof, false);
  assert.equal(profile.recommendedSteps, 50);
  assert.equal(profile.recommendedGuidance, 4);
  assert.equal(modelProfiles.getFormDefaultsForMode('text_to_image', profile.modelType).modelType, profile.modelType);
});

before(async () => {
  storage = new Map();
  globalThis.localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.window = {
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  blockAutoAuthority = await server.ssrLoadModule('/src/studio/blockAutoAuthorityV2.ts');
  blockExecutionAuthority = await server.ssrLoadModule('/src/studio/blockExecutionAuthorityV2.ts');
  blockRuntime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  blockSchema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  blockPersistence = await server.ssrLoadModule('/src/studio/blockDefinitionPersistenceV2.ts');
  blockRunForm = await server.ssrLoadModule('/src/studio/blockRunFormV2.ts');
  blockAdapter = await server.ssrLoadModule('/src/studio/registeredBlockAdapterV2.ts');
  connectionTypeCompatibility = await server.ssrLoadModule('/src/theme/connectionTypeCompatibility.ts');
  conditionalStore = await server.ssrLoadModule('/src/stores/useHuggingFaceModularConditionalStore.ts');
  flowStore = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  clusterGraph = await server.ssrLoadModule('/src/studio/huggingFaceClusterGraph.ts');
  clusterInstance = await server.ssrLoadModule('/src/studio/huggingFaceClusterInstance.ts');
  clusterMaterializer = await server.ssrLoadModule('/src/studio/huggingFaceClusterMaterializer.ts');
  clusterRuntime = await server.ssrLoadModule('/src/studio/huggingFaceClusterRuntime.ts');
  catalogModule = await server.ssrLoadModule('/src/studio/huggingFaceNodeCatalog.ts');
  insertion = await server.ssrLoadModule('/src/studio/huggingFaceClusterInsertion.ts');
  libraryStore = await server.ssrLoadModule('/src/stores/useHuggingFaceNodeLibraryStore.ts');
  migrationGenerator = await server.ssrLoadModule('/src/studio/registeredClusterCompilerSupplement.ts');
  modelProfiles = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  modularComposition = await server.ssrLoadModule('/src/studio/modularComposition.ts');
  modularBlockInsertion = await server.ssrLoadModule('/src/studio/modularDiffusersBlockInsertion.ts');
  nodeStore = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  outputContracts = await server.ssrLoadModule('/src/studio/outputContracts.ts');
  routeModule = await server.ssrLoadModule('/src/studio/registeredBlockV2Routes.ts');
  runCoordinator = await server.ssrLoadModule('/src/studio/runCoordinator.ts');
  settingsStore = await server.ssrLoadModule('/src/stores/useSettingsStore.ts');
  studioStore = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  topBarAutoPolicy = await server.ssrLoadModule('/src/studio/topBarAutoPolicyV2.ts');
  originalFetch = globalThis.fetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
});

const input = (type) => ({ display: 'input', type });
const output = (type) => ({ display: 'output', type });

function node(key, params) {
  const [module, action] = key.split(/\.(?=[^.]+$)/u);
  return { type: 'custom', module, action, label: action, category: 'Test', params };
}

function registry({ missingSteps = false, deferredModelAction = false } = {}) {
  const denoiseParams = {
    unet: { ...input('model'), onSignal: { action: 'show', data: {} } },
    scheduler: input('scheduler'),
    embeddings: input('embeddings'),
    latents: output('latents'),
  };
  if (!missingSteps) denoiseParams.num_inference_steps = { type: 'int', default: 28 };
  denoiseParams.width = { type: 'int', default: 1024 };
  denoiseParams.height = { type: 'int', default: 1024 };
  denoiseParams.guidance_scale = { type: 'float', default: 4 };
  return {
    'modules.ModularDiffusers.ModelsLoader': node('modules.ModularDiffusers.ModelsLoader', {
      model_type: {
        type: 'string',
        onChange: deferredModelAction ? 'set_filters' : { action: 'show', data: {} },
      },
      repo_id: { type: 'string', display: 'modelselect', value: { source: 'hub', value: '' } },
      reviewed_variant: {
        label: 'Model',
        type: 'string',
        value: 'Qwen/Qwen-Image-2512',
        default: 'Qwen/Qwen-Image-2512',
        options: ['Qwen/Qwen-Image-2512', 'Qwen/Qwen-Image'],
        fieldOptions: { controlTier: 'essential' },
      },
      dtype: { type: 'string', value: 'bfloat16' },
      workflow_id: { type: 'string', value: '', hidden: true },
      text_encoders: output('models'),
      unet_out: output('model'),
      scheduler: output('scheduler'),
      vae_out: output('model'),
      pipeline_components: output('diffusers_modular_pipeline_components'),
    }),
    'modules.ModularDiffusers.EncodePrompt': node('modules.ModularDiffusers.EncodePrompt', {
      text_encoders: { ...input('models'), onSignal: { action: 'show', data: {} } },
      prompt: { type: 'text', display: 'textarea', default: '' },
      embeddings: output('embeddings'),
    }),
    'modules.ModularDiffusers.Denoise': node('modules.ModularDiffusers.Denoise', denoiseParams),
    'modules.ModularDiffusers.DecodeLatents': node('modules.ModularDiffusers.DecodeLatents', {
      vae: { ...input('model'), onSignal: { action: 'show', data: {} } },
      latents: input('latents'),
      images: output('image'),
    }),
    'modules.ModularDiffusers.ReviewedModularWorkflowStep': node(
      'modules.ModularDiffusers.ReviewedModularWorkflowStep',
      {
        pipeline_components: input('diffusers_modular_pipeline_components'),
        state_in: input('modular_workflow_state'),
        loop_members_in: input('modular_loop_members'),
        pipeline_class: { type: 'string', hidden: true },
        workflow_id: { type: 'string', hidden: true },
        placement_path: { type: 'object', hidden: true },
        block_definition_id: { type: 'string', hidden: true },
        block_class: { type: 'string', hidden: true },
        block_contract_hash: { type: 'string', hidden: true },
        execution_kind: { type: 'string', hidden: true },
        execution_scope: { type: 'string', hidden: true },
        prompt: { type: 'text', display: 'textarea', default: '' },
        negative_prompt: { type: 'text', display: 'textarea', default: '' },
        max_sequence_length: { type: 'int', default: 1024 },
        num_images_per_prompt: { type: 'int', default: 1 },
        latents: input('latent'),
        height: { type: 'int', default: 1024 },
        width: { type: 'int', default: 1024 },
        seed: { type: 'int', default: 0 },
        num_inference_steps: { type: 'int', default: 50 },
        sigmas: { type: 'object', default: null },
        attention_kwargs: { type: 'object', default: null },
        guidance_scale: { type: 'float', default: 4 },
        output_type: { type: 'string', default: 'pil' },
        state_out: output('modular_workflow_state'),
        loop_members: output('modular_loop_members'),
        images: output('list[image]'),
      },
    ),
    'modules.Image.Preview': node('modules.Image.Preview', {
      image: input('image'),
      preview: { display: 'ui_image', type: 'list[image]', dataSource: 'output' },
    }),
  };
}

function exactQwenBlocks() {
  const placements = [
    { path: ['text_encoder'], className: 'QwenImageTextEncoderStep', kind: 'block', inputs: ['prompt'] },
    { path: ['denoise.input'], className: 'QwenImageTextInputsStep', kind: 'block', inputs: [] },
    {
      path: ['denoise.prepare_latents'],
      className: 'QwenImagePrepareLatentsStep',
      kind: 'block',
      inputs: ['height', 'width'],
    },
    {
      path: ['denoise.set_timesteps'],
      className: 'QwenImageSetTimestepsStep',
      kind: 'block',
      inputs: ['num_inference_steps'],
    },
    { path: ['denoise.prepare_rope_inputs'], className: 'QwenImageRoPEInputsStep', kind: 'block', inputs: [] },
    { path: ['denoise.denoise'], className: 'QwenImageDenoiseStep', kind: 'loop', inputs: [] },
    {
      path: ['denoise.denoise', 'before_denoiser'],
      className: 'QwenImageLoopBeforeDenoiser',
      kind: 'block',
      inputs: [],
    },
    {
      path: ['denoise.denoise', 'denoiser'],
      className: 'QwenImageLoopDenoiser',
      kind: 'block',
      inputs: [],
    },
    {
      path: ['denoise.denoise', 'after_denoiser'],
      className: 'QwenImageLoopAfterDenoiser',
      kind: 'block',
      inputs: [],
    },
    { path: ['denoise.after_denoise'], className: 'QwenImageAfterDenoiseStep', kind: 'block', inputs: [] },
    { path: ['decode.decode'], className: 'QwenImageDecoderStep', kind: 'block', inputs: [] },
    {
      path: ['decode.postprocess'],
      className: 'QwenImageProcessImagesOutputStep',
      kind: 'block',
      inputs: [],
      outputs: ['images'],
    },
  ];
  let topLevelOrder = 0;
  let loopOrder = 0;
  const blockDefinitions = placements.map((placement, index) => {
    const contentHash = `sha256:${(index + 1).toString(16).repeat(64)}`;
    return {
      id: `diffusers.modular-block:${placement.className}:${contentHash}`,
      className: placement.className,
      kind: placement.kind,
      description: `${placement.className} exact unit fixture`,
      inputs: placement.inputs.map((name) => ({
        name,
        type: name === 'prompt' ? 'builtins.str' : 'builtins.int',
        required: name === 'prompt',
        default: name === 'prompt' ? '' : 1024,
        description: `${name} fixture`,
        kwargsType: null,
      })),
      variadicInputs: [],
      outputs: (placement.outputs ?? []).map((name) => ({
        name,
        type: name === 'images' ? 'list[image]' : 'typing.Any',
        required: true,
        default: null,
        description: `${name} fixture`,
        kwargsType: null,
      })),
      components: [],
      configs: [],
      contentHash,
    };
  });
  return {
    blockDefinitions,
    blockPlacements: placements.map((placement, index) => ({
      path: placement.path,
      legacyPath: placement.path.join('.'),
      order: placement.path.length === 1 ? topLevelOrder++ : loopOrder++,
      blockDefinitionId: blockDefinitions[index].id,
    })),
    steps: placements.map((placement) => ({
      path: placement.path.join('.'),
      className: placement.className,
      kind: placement.kind,
      description: `${placement.className} exact unit fixture`,
    })),
  };
}

function fixture() {
  const definitionId = 'diffusers.modular:QwenImageModularPipeline:text2image';
  const admissionId = 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image';
  const adapterId = 'diffusers.modular-adapter:QwenImageModularPipeline:text2image:mode:text_to_image';
  const receipt = {
    id: 'qwen-image-2512:modular-text-to-image:v1',
    contentHash: 'studio-spec-v1-f4c15e0d',
    executionProfileId: 'qwen-image:modular',
  };
  const artifact = { repo: 'Qwen/Qwen-Image-2512', revision: '25468b98e3276ca6700de15c6628e51b7de54a26' };
  const admission = {
    schemaVersion: 4,
    id: admissionId,
    definitionId,
    studioMode: 'modular_text_to_image',
    bindingSources: [
      'artifact',
      'guidanceScale',
      'height',
      'modelVariant',
      'pipelineClass',
      'prompt',
      'steps',
      'width',
    ],
    instanceInputBindings: [{ bindingSource: 'prompt', input: 'prompt' }],
    executionParameterSources: ['guidanceScale', 'height', 'modelVariant', 'steps', 'width'],
    sealedBindingValues: { artifact: artifact.repo, pipelineClass: 'QwenImageModularPipeline' },
    modelDependencies: [{ id: 'model', kind: 'model', repo: artifact.repo, revision: artifact.revision }],
    dynamicFieldActions: [
      { role: 'models', field: 'model_type', event: 'onChange', valueSource: 'pipelineClass' },
      { role: 'prompt', field: 'text_encoders', event: 'onSignal', valueSource: 'pipelineClass' },
      { role: 'denoise', field: 'unet', event: 'onSignal', valueSource: 'pipelineClass' },
      { role: 'decode', field: 'vae', event: 'onSignal', valueSource: 'pipelineClass' },
    ],
    adapterContractId: adapterId,
    studioExecutionSpec: receipt,
    artifact,
    status: 'admitted',
    claim: 'static_graph_contract_compatible',
    executable: false,
    publication: {
      schemaVersion: 1,
      readiness: 'graph_qualified',
      insertable: true,
      executable: false,
      autoEligible: false,
      liveProof: false,
      reasons: [],
    },
    reasons: [],
  };
  const exact = exactQwenBlocks();
  const definition = {
    schemaVersion: 6,
    id: definitionId,
    provider: 'diffusers',
    publisher: 'huggingface',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'modular_pipeline_workflow',
    ownership: 'library',
    mutable: false,
    libraryRevision: '2f7e0154a9db246e95c9ede43edba7db5b130805',
    pipelineClass: 'QwenImageModularPipeline',
    blocksClass: 'QwenImageAutoBlocks',
    pipelineKind: 'auto',
    workflowId: 'text2image',
    workflowKind: 'sequential',
    taskId: 'text_to_image',
    taskContractId: 'diffusers.task.text_to_image.v1',
    label: 'Qwen Image — Text To Image',
    description: 'Atomic registered V2 insertion fixture.',
    integrationStatus: 'reviewed_modiff_contract',
    executionClaim: 'discovery_only',
    executionAdmissions: [admission],
    graphAdapterContracts: [
      {
        schemaVersion: 1,
        id: adapterId,
        source: 'mode',
        adapterId: 'text_to_image',
        upstreamWorkflowId: 'text2image',
        requiredInputs: ['prompt'],
        actionSequence: ['models', 'prompt', 'denoise', 'decode', 'preview'],
        stateEdges: [],
        upstreamBlockSequence: [],
      },
    ],
    inputs: [{ name: 'prompt', type: 'builtins.str', required: true, default: '', description: 'Image prompt.' }],
    outputs: [{ name: 'images', type: 'list[image]', required: true, default: null, description: '' }],
    requiredInputs: ['prompt'],
    requiredInputAlternatives: [],
    stateKeys: [],
    components: [],
    steps: exact.steps,
    blockContractHash: `sha256:${'c'.repeat(64)}`,
    rootBlockDefinitionId: `diffusers.modular-block:QwenImageAutoBlocks:sha256:${'d'.repeat(64)}`,
    blockPlacements: exact.blockPlacements,
    suggestedInputs: {
      schemaVersion: 1,
      values: { prompt: QWEN_2512_CREATOR_PROMPT },
      source: {
        kind: 'publisher_example',
        label: 'Qwen/Qwen-Image-2512 model card example',
        url: 'https://huggingface.co/Qwen/Qwen-Image-2512/blob/' + '25468b98e3276ca6700de15c6628e51b7de54a26/README.md',
      },
    },
    contentHash: 'sha256:9cbb38204acb409888b94e880a6e343e9bd67ea5703455560bc5c6d713437f68',
  };
  const executionSpec = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    ...receipt,
    modelType: definition.pipelineClass,
    mode: 'modular_text_to_image',
    loaderModule: 'modules.ModularDiffusers',
    loaderAction: 'ModelsLoader',
    executionPath: 'modular-diffusers',
    pipelineClass: definition.pipelineClass,
    defaultRepo: artifact.repo,
    roles: [
      ['models', 'modules.ModularDiffusers.ModelsLoader', -720, -80],
      ['prompt', 'modules.ModularDiffusers.EncodePrompt', -360, -240],
      ['denoise', 'modules.ModularDiffusers.Denoise', 80, -80],
      ['decode', 'modules.ModularDiffusers.DecodeLatents', 440, -80],
      ['preview', 'modules.Image.Preview', 800, -80],
    ],
    edges: [
      ['models', 'text_encoders', 'prompt', 'text_encoders'],
      ['models', 'unet_out', 'denoise', 'unet'],
      ['models', 'scheduler', 'denoise', 'scheduler'],
      ['models', 'vae_out', 'decode', 'vae'],
      ['prompt', 'embeddings', 'denoise', 'embeddings'],
      ['denoise', 'latents', 'decode', 'latents'],
      ['decode', 'images', 'preview', 'image'],
    ],
    bindings: [
      ['models', 'model_type', 'pipelineClass'],
      ['models', 'repo_id', 'artifact'],
      ['models', 'reviewed_variant', 'modelVariant'],
      ['prompt', 'prompt', 'prompt'],
      ['denoise', 'guidance_scale', 'guidanceScale'],
      ['denoise', 'height', 'height'],
      ['denoise', 'num_inference_steps', 'steps'],
      ['denoise', 'width', 'width'],
    ],
    autoFields: [],
    actions: [],
  };
  return { admission, definition, executionSpec, blockDefinitions: exact.blockDefinitions };
}

function fluxFixture() {
  const base = fixture();
  const definition = structuredClone(base.definition);
  const admission = definition.executionAdmissions[0];
  const definitionId = 'diffusers.modular:FluxModularPipeline:text2image';
  const admissionId = 'diffusers.cluster-admission:FluxModularPipeline:text2image:mode:text_to_image';
  const adapterId = 'diffusers.modular-adapter:FluxModularPipeline:text2image:mode:text_to_image';
  const artifact = {
    repo: 'black-forest-labs/FLUX.1-dev',
    revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
  };
  Object.assign(definition, {
    id: definitionId,
    pipelineClass: 'FluxModularPipeline',
    blocksClass: 'FluxAutoBlocks',
    label: 'Flux — Text To Image',
    inputs: [{ ...definition.inputs[0], type: 'opaque' }],
    outputs: [
      {
        ...definition.outputs[0],
        type: 'list[typing.Union[PIL.Image.Image, np.ndarray, torch.Tensor]]',
      },
    ],
    suggestedInputs: {
      ...definition.suggestedInputs,
      values: { prompt: 'A creator-provided cinematic copper observatory.' },
      source: {
        kind: 'publisher_example',
        label: 'FLUX.1-dev model card example',
        url: 'https://huggingface.co/black-forest-labs/FLUX.1-dev',
      },
    },
    contentHash: 'sha256:a356ee05c84bbc30230e07c8477b9159a36678b9f76fa07127eea1a37e399e3a',
  });
  Object.assign(admission, {
    id: admissionId,
    definitionId,
    studioMode: 'text_to_image',
    sealedBindingValues: { artifact: artifact.repo, pipelineClass: 'FluxModularPipeline' },
    modelDependencies: [{ id: 'model', kind: 'model', repo: artifact.repo, revision: artifact.revision }],
    adapterContractId: adapterId,
    studioExecutionSpec: {
      id: 'flux-dev:modular-text-to-image:v1',
      contentHash: 'studio-spec-v1-9dd14796',
      executionProfileId: 'flux-dev:modular',
    },
    artifact,
  });
  definition.graphAdapterContracts[0] = { ...definition.graphAdapterContracts[0], id: adapterId };
  const executionSpec = {
    ...structuredClone(base.executionSpec),
    ...admission.studioExecutionSpec,
    modelType: definition.pipelineClass,
    mode: admission.studioMode,
    pipelineClass: definition.pipelineClass,
    defaultRepo: artifact.repo,
  };
  return { admission, definition, executionSpec, blockDefinitions: base.blockDefinitions };
}

function baseNode() {
  return {
    id: 'existing-node',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Existing',
      label: 'Existing',
      category: 'Test',
      params: {},
    },
  };
}

function form() {
  return {
    ...modelProfiles.getFormDefaultsForMode('modular_text_to_image', 'QwenImageModularPipeline'),
    modelType: 'QwenImageModularPipeline',
    mode: 'modular_text_to_image',
    prompt: '',
    steps: 12,
  };
}

function fluxForm() {
  return {
    ...modelProfiles.getFormDefaultsForModel('FluxModularPipeline'),
    modelType: 'FluxModularPipeline',
    mode: 'text_to_image',
    prompt: '',
    steps: 10,
  };
}

function currentRouteCompilerRoot(definition, admission, instanceId, position = { x: 0, y: 0 }) {
  const bindingForm = {
    ...modelProfiles.getFormDefaultsForRegisteredRoute(admission.studioMode, definition.pipelineClass),
    modelType: definition.pipelineClass,
    mode: admission.studioMode,
  };
  const { parameterOverrides, executionParameterOverrides } =
    clusterInstance.huggingFaceClusterOverridesForBindingValues(definition, admission, bindingForm);
  const suggestedValues = definition.suggestedInputs?.values ?? {};
  const seededParameterOverrides = Object.fromEntries(
    Object.entries(parameterOverrides).filter(
      ([name, value]) => !(value === '' && Object.prototype.hasOwnProperty.call(suggestedValues, name)),
    ),
  );
  return clusterGraph.createHuggingFaceClusterNode(
    definition,
    instanceId,
    position,
    { ...suggestedValues, ...seededParameterOverrides },
    admission.id,
    executionParameterOverrides,
  );
}

function historicalMappingAuthority({ definition, admission, historicalRoot, compiled, canonicalSha256 }) {
  const legacy = historicalRoot.data.huggingFaceClusterInstance;
  return {
    mappingId: 'legacy-cluster-compiler-mapping:test:current-route',
    mappingHash: `sha256:${'8'.repeat(64)}`,
    historical: {
      manifestDefinitionId: legacy.definition.id,
      libraryRevision: legacy.definition.libraryRevision,
      manifestContentHash: legacy.definition.contentHash,
      executionAdmissionId: legacy.execution.admissionId,
      studioExecutionSpec: structuredClone(legacy.execution.studioExecutionSpec),
      archivedDefinitionRecordHash: `sha256:${'6'.repeat(64)}`,
      blockContractHash: definition.blockContractHash,
      rootBlockDefinitionId: definition.rootBlockDefinitionId,
    },
    destination: {
      manifestDefinitionId: definition.id,
      libraryRevision: definition.libraryRevision,
      manifestContentHash: definition.contentHash,
      executionAdmissionId: admission.id,
      blockDefinitionId: compiled.definition.definitionId,
      blockDefinitionContentHash: compiled.definition.contentHash,
      blockDefinitionCanonicalSha256: canonicalSha256,
      executionGraphHash: compiled.definition.graph.graphHash,
      interfaceHash: blockSchema.blockInterfaceHashV2({
        boundary: compiled.definition.boundary,
        controls: compiled.definition.controls,
      }),
    },
    review: {
      decision: 'historical_compiler_mapping_reviewed',
      issuer: 'workspace_owner:test-reviewer',
      reviewedAt: '2026-09-02T19:03:00+05:30',
      notes: 'Historical values remain instance values and do not compile the current destination definition.',
    },
  };
}

function pinFixtureRoute({ definition, executionSpec, blockDefinitions }, nodesRegistry) {
  const admission = definition.executionAdmissions[0];
  const route = routeModule.registeredBlockV2Route(definition, admission);
  if (!route) return null;
  const legacyRoot = clusterGraph.createHuggingFaceClusterNode(
    definition,
    `fixture-pin:${definition.pipelineClass}`,
    { x: 0, y: 0 },
    Object.fromEntries(definition.inputs.map((field) => [field.name, field.default])),
    admission.id,
  );
  const instance = legacyRoot.data.huggingFaceClusterInstance;
  const bindingForm = {
    ...modelProfiles.getFormDefaultsForRegisteredRoute(admission.studioMode, definition.pipelineClass),
  };
  const skeleton = clusterMaterializer.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec,
    nodesRegistry,
    bindingValues: clusterRuntime.huggingFaceClusterExecutionParameterValues(admission, bindingForm),
    expanded: false,
  });
  const compiled = blockAdapter.compileRegisteredBlockV2(definition, skeleton, {
    instanceId: instance.instanceId,
    position: { x: 0, y: 0 },
    route,
    blockDefinitions,
    reviewedModularStepNodeData: nodesRegistry['modules.ModularDiffusers.ReviewedModularWorkflowStep'],
  });
  route.compiledDefinitionContentHash = compiled.definition.contentHash;
  route.compiledDefinitionCanonicalSha256 = `sha256:${createHash('sha256')
    .update(blockSchema.canonicalBlockStringifyV2(blockSchema.canonicalBlockDefinitionV2(compiled.definition)))
    .digest('hex')}`;
  return { compiled, route };
}

function installCompiledCatalogFetch(configured, witness) {
  const admission = configured.definition.executionAdmissions[0];
  compiledCatalogRequests = [];
  globalThis.fetch = async (url, init) => {
    const requestedUrl = String(url);
    if (!requestedUrl.includes('/huggingface/registered-block-v2?')) {
      throw new Error(`Unexpected request ${requestedUrl}`);
    }
    compiledCatalogRequests.push({ init, url: requestedUrl });
    return new Response(
      JSON.stringify({
        error: false,
        schemaVersion: 1,
        entry: {
          catalogDefinitionId: configured.definition.id,
          catalogDefinitionContentHash: configured.definition.contentHash,
          admissionId: admission.id,
          compiledDefinitionCanonicalSha256: witness.route.compiledDefinitionCanonicalSha256,
          definition: witness.compiled.definition,
          values: witness.compiled.instance.values,
          internalLayout: witness.compiled.instance.presentation.internalLayout,
          internalLayoutMode: witness.compiled.instance.presentation.internalLayoutMode ?? 'root',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
}

function configureFixture(configured) {
  const { definition, executionSpec } = configured;
  const nodesRegistry = registry();
  nodeStore.useNodesStore.setState({
    nodesRegistry,
    studioModelCapabilities: [
      {
        modelType: definition.pipelineClass,
        modes: [executionSpec.mode],
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: [executionSpec.mode],
        studioExecutionSpecs: [executionSpec],
      },
    ],
  });
  conditionalStore.useHuggingFaceModularConditionalStore.setState({
    loaded: true,
    error: null,
    snapshot:
      definition.provider === 'diffusers'
        ? {
            schemaVersion: 1,
            diffusersRevision: definition.libraryRevision,
            blockDefinitions: configured.blockDefinitions ?? [],
            pipelines: [
              {
                schemaVersion: 1,
                pipelineClass: definition.pipelineClass,
                rootBlockDefinitionId: definition.rootBlockDefinitionId,
                placements: definition.blockPlacements.map((placement) => ({
                  ...placement,
                  intermediateOutputs: [],
                })),
                conditionals: [],
                workflows: [
                  {
                    id: definition.workflowId,
                    cases: [
                      {
                        presentInputs: [],
                        activeLeafPaths: definition.blockPlacements.map(({ path }) => path),
                        activeLeafDefinitionIds: definition.blockPlacements.map(
                          ({ blockDefinitionId }) => blockDefinitionId,
                        ),
                        selections: [],
                      },
                    ],
                  },
                ],
                contentHash: `sha256:${'f'.repeat(64)}`,
              },
            ],
          }
        : null,
  });
  const witness = pinFixtureRoute(configured, nodesRegistry);
  if (witness) installCompiledCatalogFetch(configured, witness);
  return witness;
}

function fixtureLibrary(definitions, blockDefinitions = exactQwenBlocks().blockDefinitions) {
  return {
    schemaVersion: 6,
    diffusersRevision: definitions.find(({ provider }) => provider === 'diffusers')?.libraryRevision ?? 'a'.repeat(40),
    definitions,
    blockDefinitions,
  };
}

function transientNodes() {
  return flowStore.useFlowStore
    .getState()
    .nodes.filter((candidate) => Boolean(candidate.data.blockCompilationTransientV2));
}

function persistedFlowText() {
  return storage.get('modiff.flow') ?? '';
}

function autoReceipt(instance) {
  const source = instance.definitionSnapshot.source;
  return {
    kind: 'auto',
    definitionId: instance.definitionRef.definitionId,
    definitionContentHash: instance.definitionRef.contentHash,
    effectiveGraphHash: instance.effectiveGraph.graphHash,
    executionParameterHash: blockExecutionAuthority.blockExecutionParameterHashV2(instance),
    artifactRevisions: { [source.repository]: source.repositoryRevision },
    admissionId: source.executionAdmissionId,
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  storage.clear();
  const configured = fixture();
  flowStore.useFlowStore.setState({
    nodes: [baseNode()],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  configureFixture(configured);
  studioStore.useStudioStore.setState({
    activeWorkflowTabId: null,
    workflowCanvasHydrated: true,
    workflowCanvasEpoch: 0,
    workflowFormEpoch: 0,
    graphBinding: null,
    form: { ...studioStore.useStudioStore.getState().form, resourceMode: 'auto' },
  });
  settingsStore.useSettingsStore.setState({ studioViewMode: 'auto' });
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([configured.definition], configured.blockDefinitions),
    loaded: true,
    error: null,
  });
});

test('blank Auto workflow ignores an isolated compiler projection without changing mode or form epoch', () => {
  flowStore.useFlowStore.setState({
    nodes: [
      {
        ...baseNode(),
        id: 'compiler-root',
        hidden: true,
        data: {
          ...baseNode().data,
          blockCompilationTransientV2: 'registered-block-v2:test-session',
        },
      },
      {
        ...baseNode(),
        id: 'compiler-child',
        parentId: 'compiler-root',
        hidden: true,
        data: {
          ...baseNode().data,
          blockCompilationTransientV2: 'registered-block-v2:test-session',
        },
      },
    ],
    edges: [
      {
        id: 'compiler-edge',
        source: 'compiler-root',
        sourceHandle: 'output',
        target: 'compiler-child',
        targetHandle: 'input',
      },
    ],
  });
  const studioBefore = studioStore.useStudioStore.getState();
  const flow = flowStore.useFlowStore.getState();
  const policy = topBarAutoPolicy.resolveTopBarAutoPolicyV2({
    workflowCanvasHydrated: studioBefore.workflowCanvasHydrated,
    graphBindingPresent: Boolean(studioBefore.graphBinding),
    graphBindingDiverged: false,
    nodes: flow.nodes,
    edges: flow.edges,
  });

  // Mirror TopBar's mode-switching effect. The transient compiler witness is
  // an empty user graph for this policy, so this branch must remain inert.
  if (policy.autoUnavailable) {
    studioStore.useStudioStore.getState().updateForm({ resourceMode: 'expert' });
  }
  const studioAfter = studioStore.useStudioStore.getState();
  assert.equal(policy.graph.nodes.length, 0);
  assert.equal(policy.graph.edges.length, 0);
  assert.equal(policy.customGraphActive, false);
  assert.equal(policy.autoUnavailable, false);
  assert.equal(studioBefore.form.resourceMode, 'auto');
  assert.equal(studioAfter.form.resourceMode, 'auto');
  assert.equal(studioAfter.workflowFormEpoch, studioBefore.workflowFormEpoch);
});

test('a template skeleton cannot force Expert before its managed binding is ready', () => {
  const input = {
    workflowCanvasHydrated: true,
    graphBindingPresent: false,
    graphBindingDiverged: false,
    nodes: [baseNode()],
    edges: [],
  };
  const building = topBarAutoPolicy.resolveTopBarAutoPolicyV2({ ...input, templateGraphBuilding: true });
  assert.equal(building.graph.nodes.length, 1);
  assert.equal(building.customGraphActive, false);
  assert.equal(building.autoUnavailable, false);
  const finished = topBarAutoPolicy.resolveTopBarAutoPolicyV2(input);
  assert.equal(finished.customGraphActive, true);
  assert.equal(finished.autoUnavailable, false);
});

test('Qwen text-to-image fetches one audited definition and inserts only one source-neutral V2 root', async () => {
  const { definition } = fixture();
  const observedTransientStates = [];
  const unsubscribe = flowStore.useFlowStore.subscribe((state) => {
    const nodes = state.nodes.filter((candidate) => candidate.data.blockCompilationTransientV2);
    if (nodes.length) observedTransientStates.push(structuredClone(nodes));
  });
  const root = await insertion.createHuggingFaceClusterForGraph(definition, { x: 320, y: 180 }, form(), {
    insert: true,
  });
  unsubscribe();

  assert.equal(observedTransientStates.length, 0);
  assert.equal(compiledCatalogRequests.length, 1);
  assert.equal(compiledCatalogRequests[0].init?.method ?? 'GET', 'GET');
  assert.match(compiledCatalogRequests[0].url, /definition_id=.*QwenImageModularPipeline/u);
  assert.match(compiledCatalogRequests[0].url, /admission_id=.*QwenImageModularPipeline/u);
  assert.deepEqual(
    flowStore.useFlowStore.getState().nodes.map(({ id }) => id),
    ['existing-node', root.id],
  );
  assert.equal(transientNodes().length, 0);
  assert.equal(persistedFlowText().includes('blockCompilationTransientV2'), false);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 1);

  assert.equal(root.type, 'block');
  assert.equal(root.data.type, 'block');
  assert.equal(blockRuntime.isBlockRootV2(root), true);
  assert.deepEqual(root.data.params, {});
  assert.equal(root.data.huggingFaceClusterInstance, undefined);
  assert.equal(root.data.huggingFaceClusterRole, undefined);
  assert.equal(root.data.blockCompilationTransientV2, undefined);
  assert.equal(JSON.stringify(root).includes('huggingFaceCluster'), false);
  assert.deepEqual(root.position, { x: 320, y: 180 });
  const view = blockRuntime.blockViewModelV2(root.data.blockInstanceV2);
  assert.equal(view.controlParams.prompt.value, QWEN_2512_CREATOR_PROMPT);
  assert.equal(view.controlParams.num_inference_steps, undefined);
  assert.equal(view.controlParams.steps.value, 50);
  assert.ok(view.connectorParams.inputs.prompt);
  assert.ok(view.connectorParams.outputs.images);
  assert.equal(root.data.blockInstanceV2.definitionSnapshot.controls[0].valueType, 'string');
  assert.equal(root.data.blockInstanceV2.definitionSnapshot.boundary.inputs[0].valueType, 'string');
  assert.equal(view.connectorParams.inputs.prompt.type, 'string');
  assert.equal(
    connectionTypeCompatibility.connectionTypesAreCompatible('string', view.connectorParams.inputs.prompt.type),
    true,
  );
  assert.equal(
    root.data.blockInstanceV2.effectiveGraph.nodes.find(({ nodeId }) => nodeId === 'prompt').data.params.prompt.type,
    'text',
  );
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 1);
  assert.equal(flowStore.useFlowStore.getState().nodes.length, 2);

  const exported = flowStore.useFlowStore.getState().exportGraph('qwen-v2-insertion', root.id);
  assert.equal(exported.nodes[root.id], undefined);
  assert.equal(JSON.stringify(exported.nodes).includes('blockCompilationTransientV2'), false);
  assert.equal(JSON.stringify(exported.nodes).includes('huggingFaceCluster'), false);
});

test('unqualified Modular workflows remain structurally insertable as exact V2 Blocks', async () => {
  const configured = fixture();
  const admission = configured.definition.executionAdmissions[0];
  admission.status = 'rejected';
  admission.claim = 'rejected';
  admission.publication.readiness = 'catalog_only';
  admission.publication.insertable = false;
  admission.publication.reasons = [{ code: 'qualification_pending', message: 'Execution proof is pending.' }];
  admission.reasons = [{ code: 'qualification_pending', message: 'Execution proof is pending.' }];
  configureFixture(configured);
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([configured.definition], configured.blockDefinitions),
    loaded: true,
    error: null,
  });
  const entry = catalogModule
    .buildHuggingFaceCatalogSections(libraryStore.useHuggingFaceNodeLibraryStore.getState().library)
    .flatMap(({ entries }) => entries)
    .find(({ id }) => id === configured.definition.id);
  assert.ok(entry);
  assert.equal(entry.readiness, 'catalog_only');
  assert.equal(entry.insertable, true);

  const root = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 320, y: 180 }, form(), {
    insert: false,
  });
  const instance = root.data.blockInstanceV2;
  assert.ok(instance);
  assert.equal(root.data.type, 'block');
  assert.equal(instance.definitionSnapshot.source.kind, 'diffusers_catalog');
  assert.equal(instance.authorities.length, 0);
  assert.equal(instance.presentation.internalLayoutMode, 'hierarchical');
  assert.equal(instance.effectiveGraph.nodes[0].nodeId, 'models');
  assert.equal(instance.effectiveGraph.nodes[0].data.action, 'ModelsLoader');
  assert.ok(instance.effectiveGraph.nodes.some(({ modularDiffusers }) => modularDiffusers?.kind === 'upstream_block'));
  assert.ok(instance.effectiveGraph.edges.some(({ sourceNodeId }) => sourceNodeId === 'models'));
  assert.equal(instance.values.prompt, QWEN_2512_CREATOR_PROMPT);
  assert.ok(instance.effectiveInterface.boundary.inputs.some(({ portId }) => portId === 'prompt'));
  assert.ok(instance.effectiveInterface.boundary.outputs.some(({ portId }) => portId === 'images'));
});

test('palette loop members expose consumed iteration ports, not inert ordinary controls', () => {
  const library = structuredClone(libraryStore.useHuggingFaceNodeLibraryStore.getState().library);
  const block = library.blockDefinitions.find(({ className }) => className === 'QwenImageLoopBeforeDenoiser');
  block.inputs = [{ name: 'latents', type: 'torch.Tensor', required: true, default: null, description: '' }];
  block.outputs = [{ name: 'latents', type: 'torch.Tensor', required: true, default: null, description: '' }];
  const entry = catalogModule
    .buildHuggingFaceCatalogSections(library)
    .flatMap(({ entries }) => entries)
    .find(({ modularBlockPlacement }) => modularBlockPlacement?.placement.blockDefinitionId === block.id);
  assert.ok(entry);
  const nodesRegistry = structuredClone(nodeStore.useNodesStore.getState().nodesRegistry);
  const params = nodesRegistry['modules.ModularDiffusers.ReviewedModularWorkflowStep'].params;
  params.iteration_input__latents = input('latent');
  params.iteration_output__latents = output('latent');
  params.iteration_previous__latents = output('latent');
  const inserted = modularBlockInsertion.createModularDiffusersCatalogNode(entry, library, nodesRegistry, {
    x: 0,
    y: 0,
  });
  assert.equal(inserted.data.params.execution_kind.value, 'loop_member');
  assert.equal(inserted.data.params.latents, undefined);
  assert.equal(inserted.data.params.state_input__latents, undefined);
  assert.ok(inserted.data.params.iteration_input__latents);
  assert.ok(inserted.data.params.iteration_output__latents);
  assert.ok(inserted.data.params.iteration_previous__latents);
  assert.equal(inserted.data.params.iteration_input__latents.value, undefined);
});

test('a nested Modular catalog container inserts as a source-neutral V2 fragment of ordinary nodes', () => {
  const library = libraryStore.useHuggingFaceNodeLibraryStore.getState().library;
  const snapshot = conditionalStore.useHuggingFaceModularConditionalStore.getState().snapshot;
  const entry = catalogModule
    .buildHuggingFaceCatalogSections(library, snapshot)
    .flatMap(({ entries }) => entries)
    .find(
      (candidate) =>
        candidate.kind === 'block' && candidate.modularBlockPlacement?.placement.path.join('/') === 'denoise.denoise',
    );
  assert.ok(entry);
  assert.equal(entry.modularBlockPlacement.workflowId, '__unpruned__');
  assert.equal(modularBlockInsertion.modularDiffusersCatalogEntryHasDescendants(entry, library, snapshot), true);
  const fragment = modularBlockInsertion.createModularDiffusersCatalogFragmentV2(
    entry,
    library,
    nodeStore.useNodesStore.getState().nodesRegistry,
    { x: 300, y: 180 },
    snapshot,
  );
  const instance = fragment.data.blockInstanceV2;
  assert.ok(instance);
  assert.equal(fragment.data.type, 'block');
  assert.equal(instance.definitionSnapshot.source.kind, 'diffusers_catalog');
  assert.equal(instance.effectiveGraph.nodes.length, 4);
  assert.equal(
    instance.effectiveGraph.nodes.some(({ nodeType }) => nodeType === 'block' || nodeType === 'cluster'),
    false,
  );
  assert.ok(instance.effectiveGraph.nodes.every(({ modularDiffusers }) => modularDiffusers?.kind === 'upstream_block'));
  assert.ok(
    instance.effectiveGraph.nodes.every(
      ({ modularDiffusers }) => modularDiffusers?.sourceExecutionScope === 'unpruned_pipeline',
    ),
  );
  const progressivelyExpanded = blockRuntime.materializeBlockProjectionV2(
    blockRuntime.createBlockRootNodeV2(blockRuntime.setBlockPresentationV2(instance, { expanded: true })),
  );
  const rootProjection = progressivelyExpanded.nodes.find(
    ({ data }) => data.blockProjectionNodeId === instance.effectiveGraph.executionOrder[0],
  );
  assert.equal(rootProjection.parentId, instance.instanceId);
  assert.ok(instance.presentation.collapsedContainerNodeIds.includes(instance.effectiveGraph.executionOrder[0]));
  assert.equal(
    progressivelyExpanded.nodes.filter(
      ({ data, parentId }) => data.blockProjectionOwnerId === instance.instanceId && parentId === rootProjection.id,
    ).length,
    0,
  );

  const rootOpened = blockRuntime.materializeBlockProjectionV2(
    blockRuntime.createBlockRootNodeV2(
      blockRuntime.setBlockPresentationV2(instance, {
        expanded: true,
        collapsedContainerNodeIds: instance.presentation.collapsedContainerNodeIds.filter(
          (nodeId) => nodeId !== instance.effectiveGraph.executionOrder[0],
        ),
      }),
    ),
  );
  assert.equal(
    rootOpened.nodes.filter(
      ({ data, parentId }) => data.blockProjectionOwnerId === instance.instanceId && parentId === rootProjection.id,
    ).length,
    3,
  );
});

test('a V2 Modular instance derives exact insert and replace recipes while parameter edits stay operation-free', async () => {
  const configured = fixture();
  const { definition } = configured;
  const root = await insertion.createHuggingFaceClusterForGraph(definition, { x: 320, y: 180 }, form(), {
    insert: false,
  });
  const library = libraryStore.useHuggingFaceNodeLibraryStore.getState().library;
  const parameterOnly = {
    ...root.data.blockInstanceV2,
    values: { ...root.data.blockInstanceV2.values, prompt: 'Only this workflow instance changes.' },
  };
  assert.deepEqual(
    modularComposition.reviewedModularCompositionRecipeForInstanceV2(parameterOnly, library).operations,
    [],
  );

  const leaf = root.data.blockInstanceV2.effectiveGraph.nodes.find(
    (node) => node.modularDiffusers?.kind === 'upstream_block' && node.modularDiffusers.blockKind === 'block',
  );
  assert.ok(leaf);
  const sourcePath = structuredClone(leaf.modularDiffusers.placementPath);
  const insertedNode = {
    ...structuredClone(leaf),
    nodeId: 'inserted-reviewed-leaf',
    modularDiffusers: {
      ...structuredClone(leaf.modularDiffusers),
      runtimeRole: 'custom:inserted-reviewed-leaf',
      placementPath: ['inserted_reviewed_leaf'],
      sourceDefinitionId: definition.id,
      sourcePlacementPath: sourcePath,
      sourceExecutionScope: 'selected_workflow',
    },
  };
  const inserted = blockRuntime.addBlockEffectiveGraphNodeV2(root.data.blockInstanceV2, insertedNode);
  const insertRecipe = modularComposition.reviewedModularCompositionRecipeForInstanceV2(inserted, library);
  assert.deepEqual(insertRecipe.operations, [
    {
      kind: 'insert',
      sourceDefinitionId: definition.id,
      sourceBlockDefinitionId: leaf.modularDiffusers.blockDefinitionId,
      sourcePath,
      sourceExecutionScope: 'selected_workflow',
      parentPath: [],
      name: 'inserted_reviewed_leaf',
      index: insertRecipe.operations[0].index,
    },
  ]);

  const replacementNode = {
    ...structuredClone(leaf),
    nodeId: 'replacement-reviewed-leaf',
    modularDiffusers: {
      ...structuredClone(leaf.modularDiffusers),
      runtimeRole: `custom:${sourcePath.join('/')}`,
      sourceDefinitionId: definition.id,
      sourcePlacementPath: sourcePath,
      sourceExecutionScope: 'selected_workflow',
    },
  };
  const replaced = blockRuntime.replaceBlockEffectiveGraphNodeV2(
    root.data.blockInstanceV2,
    leaf.nodeId,
    replacementNode,
  );
  assert.deepEqual(modularComposition.reviewedModularCompositionRecipeForInstanceV2(replaced, library).operations, [
    {
      kind: 'replace',
      path: sourcePath,
      sourceDefinitionId: definition.id,
      sourceBlockDefinitionId: leaf.modularDiffusers.blockDefinitionId,
      sourcePath,
      sourceExecutionScope: 'selected_workflow',
    },
  ]);
});

test('a complete catalog container subtree lowers to one exact upstream insert operation', async () => {
  const { definition } = fixture();
  const library = libraryStore.useHuggingFaceNodeLibraryStore.getState().library;
  const snapshot = conditionalStore.useHuggingFaceModularConditionalStore.getState().snapshot;
  const root = await insertion.createHuggingFaceClusterForGraph(definition, { x: 100, y: 120 }, form(), {
    insert: false,
  });
  const expandedInstance = blockRuntime.setBlockPresentationV2(root.data.blockInstanceV2, { expanded: true });
  const expanded = blockRuntime.materializeBlockProjectionV2(blockRuntime.createBlockRootNodeV2(expandedInstance));
  const entry = catalogModule
    .buildHuggingFaceCatalogSections(library, snapshot)
    .flatMap(({ entries }) => entries)
    .find(
      (candidate) =>
        candidate.kind === 'block' && candidate.modularBlockPlacement?.placement.path.join('/') === 'denoise.denoise',
    );
  assert.ok(entry);
  const fragment = modularBlockInsertion.createModularDiffusersCatalogFragmentV2(
    entry,
    library,
    nodeStore.useNodesStore.getState().nodesRegistry,
    { x: 900, y: 500 },
    snapshot,
  );
  flowStore.useFlowStore.setState({
    nodes: [...expanded.nodes, fragment],
    edges: expanded.edges,
    historyPast: [],
    historyFuture: [],
  });
  flowStore.useFlowStore.getState().adoptBlockFragmentIntoBlockV2(fragment.id, root.id);
  const changed = flowStore.useFlowStore.getState().nodes.find(({ id }) => id === root.id).data.blockInstanceV2;
  const recipe = modularComposition.reviewedModularCompositionRecipeForInstanceV2(changed, library, snapshot);
  assert.equal(recipe.operations.length, 1);
  assert.deepEqual(recipe.operations[0], {
    kind: 'insert',
    sourceDefinitionId: definition.id,
    sourceBlockDefinitionId: entry.modularBlockPlacement.placement.blockDefinitionId,
    sourcePath: entry.modularBlockPlacement.placement.path,
    sourceExecutionScope: 'unpruned_pipeline',
    parentPath: [],
    name: recipe.operations[0].name,
    index: recipe.operations[0].index,
  });
  const inserted = changed.effectiveGraph.nodes.filter(({ modularDiffusers }) =>
    modularDiffusers?.runtimeRole.startsWith('custom:'),
  );
  assert.equal(inserted.length, 4);
  const incompleteGraph = structuredClone(changed.effectiveGraph);
  incompleteGraph.nodes = incompleteGraph.nodes.filter(({ nodeId }) => nodeId !== inserted.at(-1).nodeId);
  incompleteGraph.executionOrder = incompleteGraph.executionOrder.filter((nodeId) => nodeId !== inserted.at(-1).nodeId);
  const incomplete = blockRuntime.replaceBlockEffectiveGraphV2(changed, incompleteGraph);
  assert.throws(
    () => modularComposition.reviewedModularCompositionRecipeForInstanceV2(incomplete, library, snapshot),
    /missing its exact descendant/u,
  );
});

test('a fresh Qwen registered route rejects matching stale ambient defaults and keeps siblings isolated', async () => {
  const configured = fixture();
  const staleMatchingForm = {
    ...modelProfiles.getFormDefaultsForRegisteredRoute('modular_text_to_image', 'QwenImageModularPipeline'),
    width: 640,
    height: 640,
    steps: 8,
    guidanceScale: 1,
  };
  assert.equal(staleMatchingForm.modelType, 'QwenImageModularPipeline');
  assert.equal(staleMatchingForm.mode, 'modular_text_to_image');
  assert.equal(staleMatchingForm.steps, 8);
  assert.equal(staleMatchingForm.guidanceScale, 1);

  const first = await insertion.createHuggingFaceClusterForGraph(
    configured.definition,
    { x: 320, y: 180 },
    staleMatchingForm,
    { insert: true },
  );
  const sibling = await insertion.createHuggingFaceClusterForGraph(
    configured.definition,
    { x: 720, y: 180 },
    staleMatchingForm,
    { insert: true },
  );
  const firstView = blockRuntime.blockViewModelV2(first.data.blockInstanceV2);
  const siblingBefore = JSON.stringify(sibling.data.blockInstanceV2);

  assert.equal(firstView.controlParams.prompt.value, QWEN_2512_CREATOR_PROMPT);
  assert.equal(firstView.controlParams.width.value, 1328);
  assert.equal(firstView.controlParams.height.value, 1328);
  assert.equal(firstView.controlParams.steps.value, 50);
  assert.equal(firstView.controlParams.guidanceScale.value, 4);
  assert.equal(blockRuntime.blockViewModelV2(sibling.data.blockInstanceV2).controlParams.guidanceScale.value, 4);

  flowStore.useFlowStore.getState().setBlockInstanceValueV2(first.id, 'guidanceScale', 1);
  const roots = flowStore.useFlowStore.getState().nodes;
  const changed = roots.find(({ id }) => id === first.id);
  const unchangedSibling = roots.find(({ id }) => id === sibling.id);
  assert.equal(blockRuntime.blockViewModelV2(changed.data.blockInstanceV2).controlParams.guidanceScale.value, 1);
  assert.equal(JSON.stringify(unchangedSibling.data.blockInstanceV2), siblingBefore);
  assert.equal(
    blockRuntime.blockViewModelV2(unchangedSibling.data.blockInstanceV2).controlParams.guidanceScale.value,
    4,
  );
});

test('a backend-defined route without a legacy Studio profile retains compiled creator defaults', async () => {
  const configured = fixture();
  const witness = configureFixture(configured);
  const ambient = form();
  const pipelineClass = configured.definition.pipelineClass;
  const profile = modelProfiles.STUDIO_MODEL_PROFILES[pipelineClass];
  // Simulate a newly admitted backend route absent from the legacy FE profile
  // table. Its exact catalog/compiled authority is still present and unchanged.
  delete modelProfiles.STUDIO_MODEL_PROFILES[pipelineClass];
  try {
    const root = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 80, y: 90 }, ambient);
    const accepted = new Set([
      ...witness.compiled.definition.controls.map(({ controlId }) => controlId),
      ...witness.compiled.definition.boundary.inputs.map(({ portId }) => portId),
    ]);
    const expected = Object.fromEntries(
      Object.entries({
        ...witness.compiled.instance.values,
        ...(configured.definition.suggestedInputs?.values ?? {}),
      }).filter(([key]) => accepted.has(key)),
    );
    assert.deepEqual(root.data.blockInstanceV2.values, expected);
    assert.deepEqual(root.data.blockInstanceV2.definitionSnapshot, witness.compiled.definition);
  } finally {
    modelProfiles.STUDIO_MODEL_PROFILES[pipelineClass] = profile;
  }
});

test('registered image-to-image aliases retain edit-oriented model profile identity', () => {
  const defaults = modelProfiles.getFormDefaultsForRegisteredRoute('modular_image_to_image', 'ZImageModularPipeline');
  assert.equal(defaults.modelType, 'ZImageModularPipeline');
  assert.equal(defaults.mode, 'modular_image_to_image');
  assert.equal(defaults.steps, modelProfiles.STUDIO_MODEL_PROFILES.ZImageModularPipeline.recommendedSteps);
  assert.equal(defaults.guidanceScale, modelProfiles.STUDIO_MODEL_PROFILES.ZImageModularPipeline.recommendedGuidance);
});

test('registered V2 insertion uses the audited snapshot without field actions or transient compiler nodes', async () => {
  const configured = fixture();
  const witness = configureFixture(configured);
  assert.ok(witness);
  const witnessCanonical = blockSchema.canonicalBlockStringifyV2(
    blockSchema.canonicalBlockDefinitionV2(witness.compiled.definition),
  );

  const root = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 320, y: 180 }, form(), {
    compilerTimeoutMs: 500,
    insert: true,
  });
  const route = routeModule.registeredBlockV2Route(configured.definition, configured.admission);
  assert.ok(route);
  assert.equal(compiledCatalogRequests.length, 1);
  assert.equal(
    compiledCatalogRequests.some(({ url }) => url.endsWith('/fields/action')),
    false,
  );
  assert.equal(root.data.blockInstanceV2.definitionSnapshot.contentHash, route.compiledDefinitionContentHash);
  const compiledModels = root.data.blockInstanceV2.definitionSnapshot.graph.nodes.find(
    ({ nodeId }) => nodeId === 'models',
  ).data.params;
  assert.equal(compiledModels.dtype.value, 'bfloat16');
  const canonical = blockSchema.canonicalBlockStringifyV2(
    blockSchema.canonicalBlockDefinitionV2(root.data.blockInstanceV2.definitionSnapshot),
  );
  assert.equal(
    canonical,
    witnessCanonical,
    'the fetched snapshot must be byte-identical to its independently compiled witness',
  );
  assert.equal(
    `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
    route.compiledDefinitionCanonicalSha256,
    'the fetched snapshot must be byte-identical to its route pin',
  );
  assert.equal(transientNodes().length, 0);
});

test('registered V2 insertion fails closed without changing the graph when the audited snapshot is unavailable', async () => {
  const configured = fixture();
  configureFixture(configured);
  const before = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: true, detail: 'Audited entry unavailable.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });

  await assert.rejects(
    insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 320, y: 180 }, form(), {
      insert: true,
    }),
    /Audited entry unavailable|Request failed/u,
  );
  assert.equal(transientNodes().length, 0);
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), before);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 0);
});

test('registered V2 insertion rejects a canonical SHA substitution even when the public content hash matches', async () => {
  const configured = fixture();
  configureFixture(configured);
  const route = routeModule.registeredBlockV2Route(configured.definition, configured.admission);
  assert.ok(route);
  route.compiledDefinitionCanonicalSha256 = `sha256:${'0'.repeat(64)}`;
  const before = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());

  await assert.rejects(
    insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 320, y: 180 }, form(), {
      compilerTimeoutMs: 0,
      insert: true,
    }),
    /generated registered BlockDefinitionV2 identity is stale|canonical SHA-256 is stale/u,
  );
  assert.equal(transientNodes().length, 0);
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), before);
});

test('Qwen Auto preparation posts the exact instance once and attaches its receipt only to the requested root', async () => {
  const configured = fixture();
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([configured.definition], configured.blockDefinitions),
    loaded: true,
    error: null,
  });
  const first = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 320, y: 180 }, form(), {
    insert: true,
  });
  const sibling = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 720, y: 180 }, form(), {
    insert: true,
  });
  const siblingBefore = JSON.stringify(sibling.data.blockInstanceV2);
  const pendingResponse = deferred();
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init, body: JSON.parse(String(init?.body)) });
    return pendingResponse.promise;
  };

  const firstPreparation = blockAutoAuthority.prepareRegisteredBlockAutoAuthoritiesV2([first.id]);
  const duplicatePreparation = blockAutoAuthority.prepareRegisteredBlockAutoAuthoritiesV2([first.id]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.match(request.url, /\/huggingface\/cluster\/auto-authority$/u);
  assert.equal(request.init.method, 'POST');
  assert.deepEqual(Object.keys(request.body).sort(), ['form', 'instance', 'schemaVersion']);
  assert.equal(request.body.schemaVersion, 1);
  assert.deepEqual(request.body.instance, first.data.blockInstanceV2);
  assert.equal(request.body.form.modelType, 'QwenImageModularPipeline');
  assert.equal(request.body.form.mode, 'modular_text_to_image');
  assert.equal(request.body.form.resourceMode, 'auto');
  assert.equal(request.body.form.steps, 50);
  for (const key of [
    'width',
    'height',
    'steps',
    'numFrames',
    'device',
    'dtype',
    'quantizationMode',
    'autoOffload',
    'offloadMode',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(request.body.form, key), true, `missing ${key}`);
  }
  pendingResponse.resolve(
    new Response(JSON.stringify({ error: false, receipt: autoReceipt(first.data.blockInstanceV2) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  await Promise.all([firstPreparation, duplicatePreparation]);

  const roots = flowStore.useFlowStore.getState().nodes;
  const prepared = roots.find(({ id }) => id === first.id).data.blockInstanceV2;
  const unchangedSibling = roots.find(({ id }) => id === sibling.id).data.blockInstanceV2;
  assert.equal(blockExecutionAuthority.registeredBlockAutoAuthorityStatusV2(prepared).ready, true);
  assert.equal(JSON.stringify(unchangedSibling), siblingBefore);
});

test('Qwen Auto preparation failure is atomic and Expert mode bypasses the request boundary', async () => {
  const configured = fixture();
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([configured.definition], configured.blockDefinitions),
    loaded: true,
    error: null,
  });
  const root = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 320, y: 180 }, form(), {
    insert: true,
  });
  const before = JSON.stringify(root.data.blockInstanceV2);
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ error: true, message: 'bounded planner rejection' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await assert.rejects(
    blockAutoAuthority.prepareRegisteredBlockAutoAuthoritiesV2([root.id]),
    /bounded planner rejection/u,
  );
  assert.equal(requests, 1);
  assert.equal(
    JSON.stringify(flowStore.useFlowStore.getState().nodes.find(({ id }) => id === root.id).data.blockInstanceV2),
    before,
  );

  studioStore.useStudioStore.setState((state) => ({ form: { ...state.form, resourceMode: 'expert' } }));
  await blockAutoAuthority.prepareRegisteredBlockAutoAuthoritiesV2([root.id]);
  assert.equal(requests, 1);
  assert.equal(
    JSON.stringify(flowStore.useFlowStore.getState().nodes.find(({ id }) => id === root.id).data.blockInstanceV2),
    before,
  );

  // A restored graph can momentarily disagree with the visibly-off top-bar
  // switch. The user's explicit Expert choice wins, repairs the stale form,
  // and still performs no planner request.
  studioStore.useStudioStore.setState((state) => ({ form: { ...state.form, resourceMode: 'auto' } }));
  settingsStore.useSettingsStore.setState({ studioViewMode: 'expert' });
  await blockAutoAuthority.prepareRegisteredBlockAutoAuthoritiesV2([root.id]);
  assert.equal(requests, 1);
  assert.equal(studioStore.useStudioStore.getState().form.resourceMode, 'expert');
  assert.equal(
    JSON.stringify(flowStore.useFlowStore.getState().nodes.find(({ id }) => id === root.id).data.blockInstanceV2),
    before,
  );
});

test('Expert submission projects runtime identity from the exact targeted V2 instance, never global Studio or its sibling', async () => {
  const configured = fixture();
  configureFixture(configured);
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([configured.definition], configured.blockDefinitions),
    loaded: true,
    error: null,
  });
  const first = await insertion.createHuggingFaceClusterForGraph(
    configured.definition,
    { x: 320, y: 180 },
    { ...form(), prompt: 'selected first instance prompt' },
    { insert: true },
  );
  await insertion.createHuggingFaceClusterForGraph(
    configured.definition,
    { x: 820, y: 180 },
    { ...form(), prompt: 'unrelated sibling prompt' },
    { insert: true },
  );
  const flow = flowStore.useFlowStore.getState();
  flow.setBlockInstanceValueV2(first.id, 'prompt', 'selected first instance prompt');
  const siblingRoot = flowStore.useFlowStore
    .getState()
    .nodes.find(({ id }) => id !== first.id && id !== 'existing-node');
  assert.ok(siblingRoot?.data.blockInstanceV2);
  flowStore.useFlowStore.getState().setBlockInstanceValueV2(siblingRoot.id, 'prompt', 'unrelated sibling prompt');
  const profile = {
    id: configured.executionSpec.executionProfileId,
    model_type: configured.executionSpec.modelType,
    modes: [configured.executionSpec.mode],
    loader_module: configured.executionSpec.loaderModule,
    loader_action: configured.executionSpec.loaderAction,
    execution_path: configured.executionSpec.executionPath,
    backend_path: 'modular',
    pipeline_class: configured.executionSpec.pipelineClass,
    default_repo: configured.executionSpec.defaultRepo,
    quantizable_components: ['transformer', 'text_encoder'],
    default_quantized_components: ['transformer', 'text_encoder'],
    supported_offload_modes: ['none', 'model_cpu', 'group_disk'],
    retry_offload_modes: ['group_disk'],
    live_proof: false,
  };
  nodeStore.useNodesStore.setState((state) => ({
    studioModelCapabilities: state.studioModelCapabilities.map((capability) => ({
      ...capability,
      executionProfiles: [profile],
    })),
    studioModelCapabilitiesAuthoritative: true,
    studioExecutionSpecInvalid: false,
  }));
  const unrelatedGlobalForm = {
    ...modelProfiles.getFormDefaultsForModel('ZImageModularPipeline'),
    modelType: 'ZImageModularPipeline',
    mode: 'text_to_image',
    prompt: 'unrelated global Studio prompt',
    resourceMode: 'expert',
    dtype: 'float32',
    quantizationMode: 'none',
    autoOffload: false,
    offloadMode: 'none',
  };
  studioStore.useStudioStore.setState({ form: unrelatedGlobalForm });
  const submissions = [];
  globalThis.fetch = async (_url, init) => {
    submissions.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ task_id: `expert-v2-${submissions.length}`, sid: 'session-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const selected = await runCoordinator.coordinateGraphRun({
    sid: 'session-1',
    targetNodeId: first.id,
  });
  const qwenRouteDefaults = modelProfiles.getFormDefaultsForRegisteredRoute(
    'modular_text_to_image',
    'QwenImageModularPipeline',
  );
  const hints = selected.submittedGraph.runtimeHints;
  assert.equal(hints.source, 'hugging-face-cluster');
  assert.equal(hints.modelType, 'QwenImageModularPipeline');
  assert.equal(hints.mode, 'modular_text_to_image');
  assert.equal(hints.modelRepo, configured.admission.artifact.repo);
  assert.equal(hints.resolvedArtifact, configured.admission.artifact.repo);
  assert.deepEqual(hints.modelDependencies, configured.admission.modelDependencies);
  assert.equal(hints.loaderModule, configured.executionSpec.loaderModule);
  assert.equal(hints.loaderAction, configured.executionSpec.loaderAction);
  assert.equal(hints.executionPath, configured.executionSpec.executionPath);
  assert.equal(hints.pipelineClass, configured.executionSpec.pipelineClass);
  assert.equal(hints.resourceMode, 'expert');
  assert.equal(hints.dtype, qwenRouteDefaults.dtype);
  assert.equal(hints.quantizationMode, qwenRouteDefaults.quantizationMode);
  assert.equal(hints.autoOffload, qwenRouteDefaults.autoOffload);
  assert.equal(hints.offloadMode, qwenRouteDefaults.offloadMode);
  assert.equal(hints.optimizationQualificationForm.prompt, 'selected first instance prompt');
  assert.notEqual(hints.optimizationQualificationForm.prompt, 'unrelated sibling prompt');
  assert.notEqual(hints.optimizationQualificationForm.prompt, unrelatedGlobalForm.prompt);
  assert.equal(hints.studioExecutionSpec, undefined, 'the V2 route receipt is graph provenance, not a V1 node map');
  assert.equal(selected.submittedGraph.provenance.registeredBlockV2RouteBinding.admissionId, configured.admission.id);

  const ambiguous = await runCoordinator.coordinateGraphRun({ sid: 'session-1' });
  assert.equal(ambiguous.submittedGraph.provenance?.registeredBlockV2RouteBinding, undefined);
  assert.equal(ambiguous.submittedGraph.runtimeHints.source, undefined);
  assert.equal(ambiguous.submittedGraph.runtimeHints.modelType, undefined);
  assert.equal(ambiguous.context.form.modelType, unrelatedGlobalForm.modelType);
});

test('exact Flux text-to-image uses the same atomic V2 path and canonical public socket types', async () => {
  const configured = fluxFixture();
  configureFixture(configured);
  const root = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 720, y: 180 }, fluxForm(), {
    insert: true,
  });

  assert.equal(root.type, 'block');
  assert.equal(blockRuntime.isBlockRootV2(root), true);
  assert.equal(transientNodes().length, 0);
  assert.equal(JSON.stringify(root).includes('huggingFaceCluster'), false);
  const instance = root.data.blockInstanceV2;
  const view = blockRuntime.blockViewModelV2(instance);
  assert.equal(instance.definitionSnapshot.source.pipelineClass, 'FluxModularPipeline');
  assert.equal(instance.definitionSnapshot.source.repository, 'black-forest-labs/FLUX.1-dev');
  assert.equal(
    instance.definitionSnapshot.controls.find(({ controlId }) => controlId === 'prompt').valueType,
    'string',
  );
  assert.equal(
    instance.definitionSnapshot.boundary.inputs.find(({ portId }) => portId === 'prompt').valueType,
    'string',
  );
  assert.equal(
    instance.definitionSnapshot.boundary.outputs.find(({ portId }) => portId === 'images').valueType,
    'image',
  );
  assert.equal(view.controlParams.prompt.value, 'A creator-provided cinematic copper observatory.');
  assert.equal(view.controlParams.steps.value, 28);
  assert.equal(view.connectorParams.outputs.images.type, 'image');
});

test('saved User Node metadata inherits defaults and repairs output identity without granting registered authority', async () => {
  const configured = fluxFixture();
  configureFixture(configured);
  const root = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 720, y: 180 }, fluxForm(), {
    insert: true,
  });
  const store = flowStore.useFlowStore.getState();
  store.setBlockInstanceValueV2(root.id, 'prompt', 'A detailed copper astrolabe on a blue velvet workbench.');
  store.setBlockInstanceValueV2(root.id, 'width', '768');
  store.setBlockInstanceValueV2(root.id, 'steps', '17');
  const edited = flowStore.useFlowStore.getState().nodes.find(({ id }) => id === root.id).data.blockInstanceV2;
  const saved = blockPersistence.reusableBlockDefinitionFromInstanceV2(edited, {
    choice: 'new',
    definitionId: 'user-metadata-proof',
    displayName: 'User metadata proof',
  });
  const inserted = blockSchema.createBlockInstanceV2(saved, {
    instanceId: 'user-metadata-instance',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 320 },
  });
  assert.deepEqual(inserted.values, {});
  assert.equal(blockRunForm.registeredBlockV2RouteForInstance(inserted), null);
  const projected = blockRunForm.userBlockRunFormV2(inserted);
  assert.ok(projected);
  assert.equal(projected.form.prompt, 'A detailed copper astrolabe on a blue velvet workbench.');
  assert.equal(projected.form.modelType, 'FluxModularPipeline');
  assert.equal(projected.form.modelRepo, 'black-forest-labs/FLUX.1-dev');
  assert.equal(projected.form.width, 768);
  assert.equal(projected.form.steps, 17);
  assert.equal(projected.form.resourceMode, 'expert');
  assert.equal(projected.route, undefined);
  const userRoot = blockRuntime.createBlockRootNodeV2(inserted);
  const recovered = outputContracts.coerceStudioOutput({
    id: 'saved-user-output',
    url: '/file?file=user-output.webp',
    nodeId: blockRuntime.blockProjectionNodeIdV2(inserted.instanceId, inserted.previewStates[0].binding.nodeId),
    modelType: 'ZImageModularPipeline',
    prompt: 'wrong global prompt',
    steps: 8,
    formSnapshot: modelProfiles.getFormDefaultsForModel('ZImageModularPipeline'),
    graphSnapshot: { nodes: [userRoot], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  });
  assert.equal(recovered.modelType, 'FluxModularPipeline');
  assert.equal(recovered.repo, 'black-forest-labs/FLUX.1-dev');
  assert.equal(recovered.prompt, projected.form.prompt);
  assert.equal(recovered.steps, 17);
  assert.equal(blockRunForm.userBlockRunFormForFlowV2([userRoot, root], undefined), null);
  assert.equal(
    blockRunForm.userBlockRunFormForFlowV2([userRoot, root], userRoot.id).form.prompt,
    projected.form.prompt,
  );
  assert.equal(blockRunForm.userBlockRunFormV2(root.data.blockInstanceV2), null);
});

test('registered V2 run metadata coerces numeric strings, rejects ambiguous roots, and repairs stale output provenance', async () => {
  assert.equal(blockRunForm.projectBlockControlValueV2({ value: '314159', isRandom: false }, 42), 314159);
  assert.equal(blockRunForm.projectBlockControlValueV2({ value: '', isRandom: true }, 42), 42);
  const configured = fixture();
  const first = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 320, y: 180 }, form(), {
    insert: true,
  });
  const sibling = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 720, y: 180 }, form(), {
    insert: true,
  });
  const prompt = 'A small red cube beside a blue glass sphere on a clean white tabletop.';
  const store = flowStore.useFlowStore.getState();
  store.setBlockInstanceValueV2(first.id, 'prompt', prompt);
  store.setBlockInstanceValueV2(first.id, 'width', '256');
  store.setBlockInstanceValueV2(first.id, 'height', '256');
  store.setBlockInstanceValueV2(first.id, 'steps', '2');
  const updatedNodes = flowStore.useFlowStore.getState().nodes;
  const updatedFirst = updatedNodes.find(({ id }) => id === first.id);
  assert.ok(updatedFirst?.data.blockInstanceV2);

  assert.throws(
    () => blockRunForm.registeredBlockRunFormForFlowV2(updatedNodes, undefined, 'expert'),
    /multiple executable registered Blocks/u,
  );
  const targeted = blockRunForm.registeredBlockRunFormForFlowV2(updatedNodes, first.id, 'expert');
  assert.equal(targeted.form.modelType, 'QwenImageModularPipeline');
  assert.equal(targeted.form.mode, 'modular_text_to_image');
  assert.equal(targeted.form.prompt, prompt);
  assert.equal(targeted.form.width, 256);
  assert.equal(targeted.form.height, 256);
  assert.equal(targeted.form.steps, 2);
  assert.equal(typeof targeted.form.width, 'number');
  assert.equal(typeof targeted.form.steps, 'number');

  const previewNodeId = blockRuntime.blockProjectionNodeIdV2(
    updatedFirst.data.blockInstanceV2.instanceId,
    updatedFirst.data.blockInstanceV2.previewStates[0].binding.nodeId,
  );
  const staleOutput = {
    id: 'run-output-recovered-qwen-v2',
    url: '/file?file=recovered-qwen-v2.webp',
    nodeId: previewNodeId,
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    modelLabel: 'Z-Image',
    repo: 'Tongyi-MAI/Z-Image-Turbo',
    prompt: '',
    negativePrompt: '',
    seed: 42,
    width: 1024,
    height: 1024,
    steps: 8,
    guidanceScale: 1,
    formSnapshot: {
      ...modelProfiles.getFormDefaultsForModel('ZImageModularPipeline'),
      resourceMode: 'expert',
    },
    graphSnapshot: { nodes: updatedNodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    createdAt: 1,
  };
  const recovered = outputContracts.coerceStudioOutput(staleOutput);
  assert.ok(recovered);
  assert.equal(recovered.modelType, 'QwenImageModularPipeline');
  assert.equal(recovered.mode, 'modular_text_to_image');
  assert.equal(recovered.modelLabel, modelProfiles.STUDIO_MODEL_PROFILES.QwenImageModularPipeline.label);
  assert.equal(recovered.repo, 'Qwen/Qwen-Image-2512');
  assert.equal(recovered.prompt, prompt);
  assert.equal(recovered.width, 256);
  assert.equal(recovered.height, 256);
  assert.equal(recovered.steps, 2);
  assert.equal(recovered.formSnapshot.modelType, 'QwenImageModularPipeline');
  assert.equal(recovered.formSnapshot.prompt, prompt);
  assert.equal(recovered.formSnapshot.width, 256);
  assert.equal(recovered.formSnapshot.height, 256);
  assert.equal(recovered.formSnapshot.steps, 2);

  const ambiguousOutput = outputContracts.coerceStudioOutput({
    ...staleOutput,
    graphSnapshot: {
      nodes: updatedNodes.map((node) =>
        node.id === sibling.id
          ? {
              ...node,
              data: {
                ...node.data,
                blockInstanceV2: {
                  ...node.data.blockInstanceV2,
                  instanceId: updatedFirst.data.blockInstanceV2.instanceId,
                },
              },
            }
          : node,
      ),
      edges: [],
    },
  });
  assert.equal(ambiguousOutput.modelType, 'ZImageModularPipeline');
});

test('a changed registered route falls back to a structural V2 Block without creating a legacy Cluster root', async () => {
  const configured = fluxFixture();
  configured.definition.contentHash = `sha256:${'f'.repeat(64)}`;
  configureFixture(configured);
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([configured.definition], configured.blockDefinitions),
    loaded: true,
    error: null,
  });
  assert.equal(routeModule.registeredBlockV2Route(configured.definition, configured.admission), null);
  const before = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());

  const root = await insertion.createHuggingFaceClusterForGraph(configured.definition, { x: 720, y: 180 }, fluxForm(), {
    insert: true,
  });

  assert.notDeepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), before);
  assert.deepEqual(
    flowStore.useFlowStore.getState().nodes.map(({ id }) => id),
    ['existing-node', root.id],
  );
  assert.equal(root.data.type, 'block');
  assert.equal(root.data.blockInstanceV2.definitionSnapshot.source.kind, 'diffusers_catalog');
  assert.equal(root.data.blockInstanceV2.authorities.length, 0);
  assert.equal(
    flowStore.useFlowStore.getState().nodes.some((candidate) => candidate.data.huggingFaceClusterRole === 'root'),
    false,
  );
  assert.equal(transientNodes().length, 0);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 1);
});

test('Qwen compiler timeout removes every transient without changing graph or history', async () => {
  const { admission, definition } = fixture();
  nodeStore.useNodesStore.setState({ nodesRegistry: registry({ missingSteps: true }) });
  // Exercise the dynamic compiler failure path explicitly. Production prefers
  // the immutable generated definition, whose completeness is already proven
  // by the catalog tests and would correctly bypass this incomplete fixture.
  globalThis.fetch = async () => new Response(JSON.stringify({ error: true }), { status: 404 });
  const before = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  const legacyRoot = currentRouteCompilerRoot(definition, admission, 'missing-fields-compiler');

  await assert.rejects(
    insertion.compileRegisteredCatalogBlockV2Exact(definition, legacyRoot, { timeoutMs: 0 }),
    /did not publish required fields: denoise\.num_inference_steps/u,
  );

  assert.equal(transientNodes().length, 0);
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), before);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 0);
  assert.equal(persistedFlowText().includes('blockCompilationTransientV2'), false);
});

test('exact-current legacy Cluster supplement generation reads saved bytes and leaves the canvas untouched', async () => {
  const { admission, definition } = fixture();
  const legacyRoot = clusterGraph.createHuggingFaceClusterNode(
    definition,
    'legacy-qwen-root',
    { x: 140, y: 90 },
    { prompt: 'A persisted migration prompt.' },
    admission.id,
    { height: 640, steps: 8, width: 640 },
  );
  legacyRoot.data.params.__hf_cluster_input__prompt = {
    label: 'Prompt',
    display: 'input',
    type: 'text',
    isConnected: false,
    fieldOptions: {
      huggingFaceClusterPortAdmissionId: admission.id,
      huggingFaceClusterPortDirection: 'input',
      huggingFaceClusterPortNodeId: `${legacyRoot.id}__diffusers.cluster-execution:prompt`,
      huggingFaceClusterPortField: 'prompt',
    },
  };
  legacyRoot.data.params.__hf_cluster_output__images = {
    label: 'Images',
    display: 'output',
    type: 'list[image]',
    isConnected: false,
    fieldOptions: {
      huggingFaceClusterPortAdmissionId: admission.id,
      huggingFaceClusterPortDirection: 'output',
      huggingFaceClusterPortNodeId: `${legacyRoot.id}__diffusers.cluster-execution:decode`,
      huggingFaceClusterPortField: 'images',
    },
  };
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([definition]),
    loaded: true,
    error: null,
  });
  const before = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ method: init?.method ?? 'GET', url: String(url) });
    if (String(url).endsWith('/workflows/legacy-migration')) {
      return new Response(
        JSON.stringify({
          id: 'legacy-migration',
          snapshot: { nodes: [legacyRoot], edges: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected request ${String(url)}`);
  };
  const progress = [];
  // This focused fixture intentionally carries a reduced node registry. Pin
  // its route to the exact compiler result for this test only; the separate
  // live route audit proves all production pins against the backend registry.
  const compiledFixture = await insertion.compileRegisteredCatalogBlockV2Exact(definition, legacyRoot);
  const route = routeModule.registeredBlockV2Route(definition, admission);
  assert.ok(route);
  const originalPins = {
    contentHash: route.compiledDefinitionContentHash,
    canonicalSha256: route.compiledDefinitionCanonicalSha256,
  };
  route.compiledDefinitionContentHash = compiledFixture.definition.contentHash;
  route.compiledDefinitionCanonicalSha256 = `sha256:${createHash('sha256')
    .update(blockSchema.canonicalBlockStringifyV2(blockSchema.canonicalBlockDefinitionV2(compiledFixture.definition)))
    .digest('hex')}`;
  let generated;
  try {
    generated = await migrationGenerator.generateRegisteredClusterCompilerSupplement({
      candidates: [
        {
          kind: 'legacy_registered_cluster_instance',
          sourcePath: 'user-workflows/legacy-migration.json',
          id: legacyRoot.id,
          status: 'blocked',
          reason: 'Exact compiler supplement required.',
          sourceSha256: `sha256:${'1'.repeat(64)}`,
          legacyCompositeHash: `sha256:${'2'.repeat(64)}`,
        },
      ],
      onProgress: (item) => progress.push(item),
    });
  } finally {
    route.compiledDefinitionContentHash = originalPins.contentHash;
    route.compiledDefinitionCanonicalSha256 = originalPins.canonicalSha256;
  }

  assert.equal(generated.candidateCount, 1);
  assert.equal(generated.conversionCount, 1, JSON.stringify(generated.diagnostics));
  assert.deepEqual(generated.diagnostics, []);
  assert.equal(generated.supplement.compilerOutputs.length, 1);
  const output = generated.supplement.compilerOutputs[0];
  assert.equal(output.sourcePath, 'user-workflows/legacy-migration.json');
  assert.equal(output.sourceSha256, `sha256:${'1'.repeat(64)}`);
  const conversion = output.conversions[0];
  assert.equal(conversion.legacyInstanceId, legacyRoot.id);
  assert.equal(conversion.legacyCompositeHash, `sha256:${'2'.repeat(64)}`);
  assert.equal(conversion.blockInstanceV2.instanceId, legacyRoot.id);
  assert.equal(conversion.blockInstanceV2.presentation.position.x, 140);
  assert.equal(conversion.blockInstanceV2.presentation.position.y, 90);
  assert.equal(conversion.blockInstanceV2.values.prompt, 'A persisted migration prompt.');
  assert.equal(conversion.blockInstanceV2.values.steps, 8);
  assert.deepEqual(conversion.ownedNodeMappings, []);
  assert.deepEqual(
    conversion.portMappings.map(({ direction, legacyPortId, v2PortId }) => ({
      direction,
      legacyPortId,
      v2PortId,
    })),
    [
      { direction: 'input', legacyPortId: '__hf_cluster_input__prompt', v2PortId: 'prompt' },
      { direction: 'output', legacyPortId: '__hf_cluster_output__images', v2PortId: 'images' },
    ],
  );
  assert.ok(conversion.valueMappings.some(({ sourceKind }) => sourceKind === 'instance_parameter_override'));
  assert.ok(conversion.valueMappings.some(({ sourceKind }) => sourceKind === 'execution_parameter_override'));
  assert.deepEqual(
    progress.map(({ completed, total }) => [completed, total]),
    [[1, 1]],
  );
  const savedWorkflowRequests = requests.filter(({ url }) => /\/workflows\/legacy-migration$/u.test(url));
  assert.equal(savedWorkflowRequests.length, 1);
  assert.equal(savedWorkflowRequests[0].method, 'GET');
  assert.equal(migrationGenerator.registeredClusterCompilerTransientCount(), 0);
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), before);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 0);
  assert.equal(persistedFlowText().includes('blockCompilationTransientV2'), false);
});

test('supplement generation fails closed for historical manifests and an already-cancelled request', async () => {
  const { admission, definition } = fixture();
  const historicalRoot = clusterGraph.createHuggingFaceClusterNode(
    definition,
    'legacy-historical-root',
    { x: 20, y: 30 },
    { prompt: 'Historical prompt.' },
    admission.id,
    { height: 640, steps: 8, width: 640 },
  );
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([definition]),
    loaded: true,
    error: null,
  });
  historicalRoot.data.huggingFaceClusterInstance.definition.contentHash = `sha256:${'9'.repeat(64)}`;
  let reads = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).endsWith('/workflows/legacy-history')) throw new Error(`Unexpected request ${String(url)}`);
    reads += 1;
    return new Response(JSON.stringify({ id: 'legacy-history', snapshot: { nodes: [historicalRoot], edges: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const candidate = {
    kind: 'legacy_registered_cluster_instance',
    sourcePath: 'user-workflows/legacy-history.json',
    id: historicalRoot.id,
    status: 'blocked',
    reason: 'Exact compiler supplement required.',
    sourceSha256: `sha256:${'3'.repeat(64)}`,
    legacyCompositeHash: `sha256:${'4'.repeat(64)}`,
  };
  const generated = await migrationGenerator.generateRegisteredClusterCompilerSupplement({ candidates: [candidate] });
  assert.equal(generated.conversionCount, 0);
  assert.equal(generated.diagnostics.length, 1);
  assert.equal(generated.diagnostics[0].code, 'historical_manifest_unavailable');
  assert.equal(reads, 1);
  assert.equal(migrationGenerator.registeredClusterCompilerTransientCount(), 0);

  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    migrationGenerator.generateRegisteredClusterCompilerSupplement({ candidates: [candidate], signal: abort.signal }),
    (error) => error?.name === 'AbortError',
  );
  assert.equal(reads, 1, 'cancelled generation performs no saved-workflow read');
  assert.equal(migrationGenerator.registeredClusterCompilerTransientCount(), 0);

  globalThis.fetch = async (url) => {
    if (!String(url).endsWith('/workflows/legacy-history')) throw new Error(`Unexpected request ${String(url)}`);
    reads += 1;
    studioStore.useStudioStore.setState((state) => ({ workflowCanvasEpoch: state.workflowCanvasEpoch + 1 }));
    return new Response(JSON.stringify({ id: 'legacy-history', snapshot: { nodes: [historicalRoot], edges: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await assert.rejects(
    migrationGenerator.generateRegisteredClusterCompilerSupplement({ candidates: [candidate] }),
    /active workflow changed while a saved workflow was loading/u,
  );
  assert.equal(reads, 2);
  assert.equal(migrationGenerator.registeredClusterCompilerTransientCount(), 0);
});

test('a checked-in-style historical equivalence authority routes the exact destination compiler and is receipted', async () => {
  const { admission, definition } = fixture();
  const historicalRoot = clusterGraph.createHuggingFaceClusterNode(
    definition,
    'legacy-reviewed-history-root',
    { x: 20, y: 30 },
    { prompt: 'Historical reviewed prompt.' },
    admission.id,
    { height: 640, steps: 8, width: 640 },
  );
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([definition]),
    loaded: true,
    error: null,
  });
  const compiledFixture = await insertion.compileRegisteredCatalogBlockV2Exact(definition, historicalRoot);
  historicalRoot.data.huggingFaceClusterInstance.definition.contentHash = `sha256:${'9'.repeat(64)}`;
  globalThis.fetch = async (url) => {
    if (!String(url).endsWith('/workflows/legacy-reviewed-history'))
      throw new Error(`Unexpected request ${String(url)}`);
    return new Response(
      JSON.stringify({ id: 'legacy-reviewed-history', snapshot: { nodes: [historicalRoot], edges: [] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const route = routeModule.registeredBlockV2Route(definition, admission);
  assert.ok(route);
  const canonicalSha256 = `sha256:${createHash('sha256')
    .update(blockSchema.canonicalBlockStringifyV2(blockSchema.canonicalBlockDefinitionV2(compiledFixture.definition)))
    .digest('hex')}`;
  const originalPins = {
    contentHash: route.compiledDefinitionContentHash,
    canonicalSha256: route.compiledDefinitionCanonicalSha256,
  };
  route.compiledDefinitionContentHash = compiledFixture.definition.contentHash;
  route.compiledDefinitionCanonicalSha256 = canonicalSha256;
  const legacyInstance = historicalRoot.data.huggingFaceClusterInstance;
  const semanticEquivalenceAuthority = {
    receiptId: 'legacy-cluster-equivalence:qwen:reviewed-history:test',
    receiptHash: `sha256:${'8'.repeat(64)}`,
    historical: {
      manifestDefinitionId: legacyInstance.definition.id,
      libraryRevision: legacyInstance.definition.libraryRevision,
      manifestContentHash: legacyInstance.definition.contentHash,
      executionAdmissionId: legacyInstance.execution.admissionId,
      studioExecutionSpec: structuredClone(legacyInstance.execution.studioExecutionSpec),
      executionGraphHash: `sha256:${'6'.repeat(64)}`,
      interfaceHash: `sha256:${'7'.repeat(64)}`,
    },
    destination: {
      manifestDefinitionId: route.definitionId,
      libraryRevision: route.libraryRevision,
      manifestContentHash: route.definitionContentHash,
      executionAdmissionId: route.admissionId,
      blockDefinitionId: compiledFixture.definition.definitionId,
      blockDefinitionContentHash: compiledFixture.definition.contentHash,
      blockDefinitionCanonicalSha256: canonicalSha256,
      executionGraphHash: compiledFixture.definition.graph.graphHash,
      interfaceHash: blockSchema.blockInterfaceHashV2({
        boundary: compiledFixture.definition.boundary,
        controls: compiledFixture.definition.controls,
      }),
    },
    review: {
      decision: 'semantic_equivalent',
      issuer: 'workspace_owner:test-reviewer',
      reviewedAt: '2026-09-02T12:00:00+05:30',
      notes: 'Reviewed every historical block, port, value binding, preview, and execution edge.',
    },
  };
  let generated;
  try {
    generated = await migrationGenerator.generateRegisteredClusterCompilerSupplement({
      candidates: [
        {
          kind: 'legacy_registered_cluster_instance',
          sourcePath: 'user-workflows/legacy-reviewed-history.json',
          id: historicalRoot.id,
          status: 'blocked',
          reason: 'Reviewed historical equivalence requires an exact compiler output.',
          sourceSha256: `sha256:${'3'.repeat(64)}`,
          legacyCompositeHash: `sha256:${'4'.repeat(64)}`,
          semanticEquivalenceAuthority,
        },
      ],
    });
  } finally {
    route.compiledDefinitionContentHash = originalPins.contentHash;
    route.compiledDefinitionCanonicalSha256 = originalPins.canonicalSha256;
  }

  assert.equal(generated.conversionCount, 1, JSON.stringify(generated.diagnostics));
  assert.deepEqual(generated.diagnostics, []);
  assert.deepEqual(generated.supplement.compilerOutputs[0].conversions[0].semanticEquivalenceReceipt, {
    receiptId: semanticEquivalenceAuthority.receiptId,
    receiptHash: semanticEquivalenceAuthority.receiptHash,
  });
  assert.equal(migrationGenerator.registeredClusterCompilerTransientCount(), 0);
});

test('reviewed historical mapping compiles clean current bytes and isolates compatible values deterministically', async () => {
  const { admission, definition } = fixture();
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([definition]),
    loaded: true,
    error: null,
  });
  const cleanRoot = currentRouteCompilerRoot(definition, admission, 'current-destination-witness');
  const compiled = await insertion.compileRegisteredCatalogBlockV2Exact(definition, cleanRoot);
  const canonicalSha256 = `sha256:${createHash('sha256')
    .update(blockSchema.canonicalBlockStringifyV2(blockSchema.canonicalBlockDefinitionV2(compiled.definition)))
    .digest('hex')}`;
  const route = routeModule.registeredBlockV2Route(definition, admission);
  assert.ok(route);
  assert.equal(compiled.definition.contentHash, route.compiledDefinitionContentHash);
  assert.equal(canonicalSha256, route.compiledDefinitionCanonicalSha256);

  const historicalRoots = [
    clusterGraph.createHuggingFaceClusterNode(
      definition,
      'legacy-mapped-a',
      { x: 20, y: 30 },
      { prompt: 'Historical instance A.' },
      admission.id,
      { height: 512, steps: 7, width: 640 },
    ),
    clusterGraph.createHuggingFaceClusterNode(
      definition,
      'legacy-mapped-b',
      { x: 420, y: 130 },
      { prompt: 'Historical instance B.' },
      admission.id,
      { height: 768, steps: 9, width: 896 },
    ),
  ];
  historicalRoots.forEach((root) => {
    root.data.huggingFaceClusterInstance.definition.contentHash = `sha256:${'9'.repeat(64)}`;
  });
  const savedRoots = structuredClone(historicalRoots);
  const canvasBefore = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  let workflowReads = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).endsWith('/workflows/legacy-mapped-values')) throw new Error(`Unexpected request ${String(url)}`);
    workflowReads += 1;
    return new Response(
      JSON.stringify({ id: 'legacy-mapped-values', snapshot: { nodes: historicalRoots, edges: [] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const candidates = historicalRoots.map((root, index) => ({
    kind: 'legacy_registered_cluster_instance',
    sourcePath: 'user-workflows/legacy-mapped-values.json',
    id: root.id,
    status: 'blocked',
    reason: 'Reviewed historical compiler mapping requires an exact current compiler output.',
    sourceSha256: `sha256:${'1'.repeat(64)}`,
    legacyCompositeHash: `sha256:${String(index + 3).repeat(64)}`,
    historicalCompilerMappingAuthority: historicalMappingAuthority({
      definition,
      admission,
      historicalRoot: root,
      compiled,
      canonicalSha256,
    }),
  }));

  const first = await migrationGenerator.generateRegisteredClusterCompilerSupplement({ candidates });
  const second = await migrationGenerator.generateRegisteredClusterCompilerSupplement({ candidates });
  assert.equal(first.conversionCount, 2, JSON.stringify(first.diagnostics));
  assert.deepEqual(first.diagnostics, []);
  assert.equal(
    blockSchema.canonicalBlockStringifyV2(first.supplement),
    blockSchema.canonicalBlockStringifyV2(second.supplement),
    'the same saved bytes and checked-in mapping produce byte-identical compiler evidence',
  );
  const conversions = first.supplement.compilerOutputs[0].conversions;
  const [convertedA, convertedB] = conversions;
  assert.equal(convertedA.blockInstanceV2.values.prompt, 'Historical instance A.');
  assert.equal(convertedA.blockInstanceV2.values.steps, 7);
  assert.equal(convertedB.blockInstanceV2.values.prompt, 'Historical instance B.');
  assert.equal(convertedB.blockInstanceV2.values.steps, 9);
  assert.equal(convertedA.blockInstanceV2.customization.state, 'parameters_changed');
  assert.equal(convertedB.blockInstanceV2.customization.state, 'parameters_changed');
  assert.deepEqual(convertedA.blockInstanceV2.definitionSnapshot, compiled.definition);
  assert.deepEqual(convertedB.blockInstanceV2.definitionSnapshot, compiled.definition);
  assert.deepEqual(convertedA.blockInstanceV2.effectiveGraph, compiled.definition.graph);
  assert.deepEqual(convertedB.blockInstanceV2.effectiveGraph, compiled.definition.graph);
  assert.equal(JSON.stringify(compiled.definition).includes('Historical instance A.'), false);
  assert.equal(JSON.stringify(compiled.definition).includes('Historical instance B.'), false);
  assert.deepEqual(convertedA.historicalCompilerMapping, {
    mappingId: candidates[0].historicalCompilerMappingAuthority.mappingId,
    mappingHash: candidates[0].historicalCompilerMappingAuthority.mappingHash,
  });
  convertedA.blockInstanceV2.values.prompt = 'Mutated conversion only.';
  assert.equal(convertedB.blockInstanceV2.values.prompt, 'Historical instance B.');
  assert.deepEqual(historicalRoots, savedRoots, 'supplement adaptation never mutates either persisted source instance');
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), canvasBefore);
  assert.equal(workflowReads, 2, 'one saved-workflow read serves both roots in each deterministic pass');
  assert.equal(migrationGenerator.registeredClusterCompilerTransientCount(), 0);
});

test('historical value adaptation rejects unknown, type-incompatible, and graph-rewrite values', async () => {
  const { admission, definition } = fixture();
  libraryStore.useHuggingFaceNodeLibraryStore.setState({
    library: fixtureLibrary([definition]),
    loaded: true,
    error: null,
  });
  const cleanRoot = currentRouteCompilerRoot(definition, admission, 'current-failure-witness');
  const compiled = await insertion.compileRegisteredCatalogBlockV2Exact(definition, cleanRoot);
  const canonicalSha256 = `sha256:${createHash('sha256')
    .update(blockSchema.canonicalBlockStringifyV2(blockSchema.canonicalBlockDefinitionV2(compiled.definition)))
    .digest('hex')}`;

  const incompatible = clusterGraph.createHuggingFaceClusterNode(
    definition,
    'legacy-incompatible',
    { x: 20, y: 30 },
    { prompt: 'Initially valid.' },
    admission.id,
    { steps: 8 },
  );
  incompatible.data.huggingFaceClusterInstance.parameterOverrides.prompt = 42;
  const unknown = clusterGraph.createHuggingFaceClusterNode(
    definition,
    'legacy-unknown',
    { x: 220, y: 30 },
    { prompt: 'Known prompt.' },
    admission.id,
    { steps: 8 },
  );
  unknown.data.huggingFaceClusterInstance.parameterOverrides.unknown_legacy_field = 'not declared';
  const rewrite = clusterGraph.createHuggingFaceClusterNode(
    definition,
    'legacy-rewrite',
    { x: 420, y: 30 },
    { prompt: 'Known prompt.' },
    admission.id,
    { steps: 8 },
  );
  const rewriteChild = {
    id: 'legacy-rewrite-models',
    type: 'custom',
    parentId: rewrite.id,
    position: { x: 24, y: 80 },
    width: 280,
    height: 220,
    data: {
      type: 'custom',
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      label: 'Historical Models Loader',
      category: 'Test',
      params: { model_type: { type: 'string', value: 'UnreviewedReplacementPipeline' } },
      huggingFaceClusterRole: 'execution',
      huggingFaceClusterInstanceId: rewrite.id,
      huggingFaceClusterExecutionAdmissionId: admission.id,
      huggingFaceClusterExecutionSpecId: admission.studioExecutionSpec.id,
      huggingFaceClusterExecutionRole: 'models',
    },
  };
  const roots = [incompatible, unknown, rewrite];
  roots.forEach((root) => {
    root.data.huggingFaceClusterInstance.definition.contentHash = `sha256:${'9'.repeat(64)}`;
  });
  const workflows = new Map([
    ['legacy-incompatible', [incompatible]],
    ['legacy-unknown', [unknown]],
    ['legacy-rewrite', [rewrite, rewriteChild]],
  ]);
  globalThis.fetch = async (url) => {
    const id = String(url).split('/').at(-1);
    const nodes = workflows.get(id);
    if (!nodes) throw new Error(`Unexpected request ${String(url)}`);
    return new Response(JSON.stringify({ id, snapshot: { nodes, edges: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const candidates = roots.map((root, index) => ({
    kind: 'legacy_registered_cluster_instance',
    sourcePath: `user-workflows/${root.id}.json`,
    id: root.id,
    status: 'blocked',
    reason: 'Fail-closed historical value adaptation test.',
    sourceSha256: `sha256:${String(index + 1).repeat(64)}`,
    legacyCompositeHash: `sha256:${String(index + 4).repeat(64)}`,
    historicalCompilerMappingAuthority: historicalMappingAuthority({
      definition,
      admission,
      historicalRoot: root,
      compiled,
      canonicalSha256,
    }),
  }));

  const generated = await migrationGenerator.generateRegisteredClusterCompilerSupplement({ candidates });
  assert.equal(generated.conversionCount, 0);
  assert.equal(generated.diagnostics.length, 3);
  const diagnostics = Object.fromEntries(generated.diagnostics.map((item) => [item.instanceId, item]));
  assert.match(diagnostics['legacy-incompatible'].message, /incompatible with V2 control type string/u);
  assert.match(diagnostics['legacy-unknown'].message, /has no exact V2 input\/control/u);
  assert.match(diagnostics['legacy-rewrite'].message, /differs from the pinned definition/u);
  assert.equal(migrationGenerator.registeredClusterCompilerTransientCount(), 0);
});

test('workflow replacement during a deferred field action aborts and cleans the hidden compiler session', async () => {
  const { admission, definition } = fixture();
  nodeStore.useNodesStore.setState({ nodesRegistry: registry({ deferredModelAction: true }) });
  let releaseAction;
  const actionPending = new Promise((resolve) => {
    releaseAction = resolve;
  });
  let requestObserved;
  const requestStarted = new Promise((resolve) => {
    requestObserved = resolve;
  });
  globalThis.fetch = async (url) => {
    if (!String(url).endsWith('/fields/action')) throw new Error(`Unexpected request ${String(url)}`);
    requestObserved();
    await actionPending;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const legacyRoot = currentRouteCompilerRoot(definition, admission, 'deferred-field-compiler');
  const compiling = insertion.compileRegisteredCatalogBlockV2Exact(definition, legacyRoot);
  await requestStarted;
  assert.ok(transientNodes().length > 0);
  assert.equal(persistedFlowText().includes('blockCompilationTransientV2'), false);
  studioStore.useStudioStore.setState((state) => ({ workflowCanvasEpoch: state.workflowCanvasEpoch + 1 }));
  releaseAction();

  await assert.rejects(compiling, /workflow changed while dynamic fields were finalizing/u);
  assert.equal(transientNodes().length, 0);
  assert.deepEqual(
    flowStore.useFlowStore.getState().nodes.map(({ id }) => id),
    ['existing-node'],
  );
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 0);
  assert.equal(persistedFlowText().includes('blockCompilationTransientV2'), false);
});
