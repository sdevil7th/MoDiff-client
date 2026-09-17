import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let nodesStoreModule;
let extensionsModule;
let operationContractsModule;
let optionalRuntimesModule;
let requestModule;
let runReadinessModule;
let server;
let stableHashModule;
let studioStoreModule;
let flowStoreModule;
let originalFetch;

function requestStates() {
  return Object.fromEntries(
    [
      'capabilities',
      'customModules',
      'hfCache',
      'localModels',
      'modelCache',
      'nodes',
      'optionalRuntimes',
      'runtime',
    ].map((key) => [key, { status: 'idle', error: null, requestId: null }]),
  );
}

before(async () => {
  globalThis.window = {
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  requestModule = await server.ssrLoadModule('/src/utils/requestJson.ts');
  extensionsModule = await server.ssrLoadModule('/src/studio/customExtensions.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  nodesStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  operationContractsModule = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  optionalRuntimesModule = await server.ssrLoadModule('/src/studio/optionalRuntimes.ts');
  runReadinessModule = await server.ssrLoadModule('/src/studio/runReadiness.ts');
  stableHashModule = await server.ssrLoadModule('/src/studio/stableHash.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  nodesStoreModule.useNodesStore.setState({
    nodesRegistry: {},
    isLoading: false,
    instance: '',
    error: null,
    hfCache: [],
    localModels: [],
    modelCacheDiagnostics: null,
    studioModelCapabilities: [],
    operationContracts: [],
    pipelineSupport: [],
    studioModelCapabilitiesAuthoritative: false,
    runtimeStatus: null,
    runtimeError: null,
    optionalRuntimeCatalog: null,
    hfDownloadProgress: {},
    customModules: [],
    customModuleError: null,
    discoveryRequests: requestStates(),
  });
  studioStoreModule.useStudioStore.setState({
    autoResourcePlan: null,
    autoResourcePlans: {},
  });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function customModule(name, enabled = true) {
  return {
    name,
    moduleKey: `custom.${name}`,
    source: 'custom',
    enabled,
    status: enabled ? 'enabled' : 'disabled',
    path: `C:/custom/${name}`,
    codeHash: 'sha256:' + 'a'.repeat(64),
    dependencies: [],
    files: [],
    preview: null,
    hasInit: true,
    hasMain: false,
    nodeCount: 0,
    nodes: [],
    hasGit: true,
    canUpdate: true,
    canDisable: enabled,
    canEnable: !enabled,
  };
}

function runtimeRequirement(overrides = {}) {
  return {
    schemaVersion: 1,
    delivery: 'base',
    requiredNow: false,
    profileIds: ['huggingface-transformers-peft-5.14.1-0.20.0'],
    executionProfileIds: ['qwen-image:t2i-direct'],
    state: 'base_satisfied',
    reason: 'base_runtime_contract',
    ...overrides,
  };
}

function optionalRuntimeCatalog(overrides = {}) {
  return {
    schemaVersion: 1,
    profiles: [
      {
        schemaVersion: 1,
        id: 'huggingface-transformers-peft-5.14.1-0.20.0',
        label: 'Hugging Face Transformers + PEFT',
        platform: 'linux',
        machine: 'x86_64',
        specDigest: `sha256:${'1'.repeat(64)}`,
        contractState: 'candidate_unqualified',
        cutoverReady: false,
        installActionAvailable: false,
        activationAvailable: false,
        status: 'missing',
        overlayStatus: 'missing',
      },
    ],
    overlay: {
      processLoadStatus: 'base',
      state: { activeEnvironmentId: null, previousEnvironmentId: null },
      environments: [],
    },
    activeInstallJob: null,
    ...overrides,
  };
}

function fluxExecutionProfile(
  modelType = 'FluxSchnellPipeline',
  id = 'flux-schnell:direct',
  repo = 'black-forest-labs/FLUX.1-schnell',
) {
  return {
    id,
    model_type: modelType,
    modes: ['text_to_image'],
    loader_module: 'modules.DiffusersImage',
    loader_action: 'LoadPipeline',
    execution_path: 'direct-diffusers-image',
    backend_path: 'modules.DiffusersImage.LoadPipeline',
    pipeline_class: 'FluxPipeline',
    default_repo: repo,
    fallback_repo: null,
    compatible_repos: [],
    quantizable_components: ['transformer', 'text_encoder_2'],
    default_quantized_components: [],
    supported_offload_modes: ['none', 'model_cpu'],
    retry_offload_modes: ['model_cpu'],
    live_proof: false,
  };
}

function fluxExecutionSpec(overrides = {}) {
  const semantic = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    id: 'flux-schnell:text-to-image:v1',
    modelType: 'FluxSchnellPipeline',
    mode: 'text_to_image',
    executionProfileId: 'flux-schnell:direct',
    loaderModule: 'modules.DiffusersImage',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-image',
    pipelineClass: 'FluxPipeline',
    defaultRepo: 'black-forest-labs/FLUX.1-schnell',
    roles: [
      ['diffusersQuantization', 'modules.DiffusersRuntime.PipelineQuantizationConfigV2', -1280, -80],
      ['diffusersRecipe', 'modules.DiffusersRuntime.DiffusersExecutionRecipe', -900, -80],
      ['diffusersImagePipeline', 'modules.DiffusersImage.LoadPipeline', -520, -80],
      ['diffusersImageGenerate', 'modules.DiffusersImage.Generate', -120, -80],
      ['preview', 'modules.Image.Preview', 980, -80],
    ],
    edges: [
      ['diffusersQuantization', 'quantization_config', 'diffusersRecipe', 'quantization_config'],
      ['diffusersRecipe', 'execution_recipe', 'diffusersImagePipeline', 'execution_recipe'],
      ['diffusersImagePipeline', 'pipeline', 'diffusersImageGenerate', 'pipeline'],
      ['diffusersImageGenerate', 'images', 'preview', 'image'],
    ],
    bindings: [
      ['diffusersImagePipeline', 'model_id', 'artifact'],
      ['diffusersImagePipeline', 'pipeline_class', 'pipelineClass'],
      ['diffusersImageGenerate', 'prompt', 'prompt'],
    ],
    autoFields: ['resolvedArtifact', 'pipelineClass'],
    actions: [],
    ...overrides,
  };
  return {
    ...semantic,
    contentHash: `studio-spec-v1-${stableHashModule.hashString(stableHashModule.stableStringify(semantic))}`,
  };
}

function fluxCapability(spec = fluxExecutionSpec(), overrides = {}) {
  return {
    modelType: 'FluxSchnellPipeline',
    modes: ['text_to_image'],
    runnableModes: ['text_to_image'],
    executionProfiles: [fluxExecutionProfile()],
    studioExecutionSpecSchemaVersion: 1,
    studioExecutionSpecModes: [spec.mode],
    studioExecutionSpecs: [spec],
    ...overrides,
  };
}

function fluxTaskTemplateContract(spec = fluxExecutionSpec(), overrides = {}) {
  const semantic = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    id: `task-template:${spec.id}`,
    modelType: spec.modelType,
    mode: spec.mode,
    mediaKind: 'image',
    executionProfileId: spec.executionProfileId,
    executionSpecId: spec.id,
    executionSpecContentHash: spec.contentHash,
    loaderModule: spec.loaderModule,
    loaderAction: spec.loaderAction,
    loaderRole: 'diffusersImagePipeline',
    pipelineClass: spec.pipelineClass,
    defaultRepo: spec.defaultRepo,
    loaderRepositories: [spec.defaultRepo],
    requiredMedia: [],
    output: {
      mediaKind: 'image',
      role: 'preview',
      nodeKey: 'modules.Image.Preview',
      inputHandle: 'image',
    },
    qualificationStatus: 'graph-qualified-execution-pending',
    galleryEligible: false,
    ...overrides,
  };
  return {
    ...semantic,
    contentHash: `task-template-v1-${stableHashModule.hashString(stableHashModule.stableStringify(semantic))}`,
  };
}

test('requestJson normalizes non-OK JSON responses', async () => {
  globalThis.fetch = async () => jsonResponse({ error: true, message: 'Backend unavailable' }, 503);

  await assert.rejects(requestModule.requestJson('/status'), (error) => {
    assert.equal(error.name, 'RequestError');
    assert.equal(error.kind, 'http');
    assert.equal(error.status, 503);
    assert.equal(error.message, 'Backend unavailable');
    return true;
  });
});

test('requestJson distinguishes invalid JSON and invalid payloads', async () => {
  globalThis.fetch = async () => new Response('<html>broken</html>', { status: 200 });
  await assert.rejects(requestModule.requestJson('/broken-json'), (error) => error.kind === 'invalid_json');

  globalThis.fetch = async () => jsonResponse({ value: 1 });
  await assert.rejects(
    requestModule.requestJson('/broken-payload', {
      parse: () => {
        throw new Error('Expected a typed list.');
      },
    }),
    (error) => error.kind === 'invalid_payload' && error.message === 'Expected a typed list.',
  );
});

test('model capabilities keep schema-v2 runnable modes exact and ignore experimental records', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image', 'control_image'],
          runnableModes: ['text_to_image'],
        },
      ],
      experimentalCapabilities: [
        {
          modelType: 'FluxModularPipeline',
          modes: ['text_to_image', 'image_to_image', 'control_image'],
          runnableModes: ['text_to_image', 'image_to_image', 'control_image'],
        },
      ],
    });

  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.studioModelCapabilitiesAuthoritative, true);
  assert.deepEqual(
    state.studioModelCapabilities.map(({ modelType, modes, runnableModes }) => ({ modelType, modes, runnableModes })),
    [
      {
        modelType: 'QwenImageModularPipeline',
        modes: ['text_to_image', 'control_image'],
        runnableModes: ['text_to_image'],
      },
    ],
  );
});

test('model capabilities reject untrusted Expert install repositories and file paths', async () => {
  const capability = {
    modelType: 'LTX2ConditionPipeline',
    modes: ['text_to_video'],
    runnableModes: ['text_to_video'],
    defaultRepo: 'Lightricks/LTX-2',
    artifactLabel: 'LTX-2 exact snapshot',
    executionStatus: 'expert_only',
    revisionCandidates: ['47da56e2ad66ce4125a9922b4a8826bf407f9d0a'],
    downloadFiles: ['model_index.json', 'transformer/diffusion_pytorch_model-00001-of-00008.safetensors'],
  };
  globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [capability] });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.equal(state.studioModelCapabilities[0].defaultRepo, capability.defaultRepo);
  assert.deepEqual(state.studioModelCapabilities[0].downloadFiles, capability.downloadFiles);

  for (const malformed of [
    { ...capability, defaultRepo: 'https://huggingface.co/Lightricks/LTX-2' },
    { ...capability, artifactLabel: 42 },
    { ...capability, downloadFiles: ['../model.safetensors'] },
    { ...capability, downloadFiles: ['/tmp/model.safetensors'] },
  ]) {
    globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [malformed] });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    state = nodesStoreModule.useNodesStore.getState();
    assert.equal(state.discoveryRequests.capabilities.status, 'error');
    assert.equal(state.studioModelCapabilities[0].defaultRepo, capability.defaultRepo);
    assert.deepEqual(state.studioModelCapabilities[0].downloadFiles, capability.downloadFiles);
  }
});

test('model capabilities preserve exact per-workflow artifact selections and reject ambiguous mappings', async () => {
  const capability = {
    modelType: 'WanImage2VideoModularPipeline',
    modes: ['single_image_to_video', 'image_to_video'],
    runnableModes: ['single_image_to_video', 'image_to_video'],
    defaultRepo: 'Wan-AI/Wan2.1-I2V-14B-480P-Diffusers',
    artifactSelections: [
      {
        modes: ['single_image_to_video'],
        repo: 'Wan-AI/Wan2.1-I2V-14B-480P-Diffusers',
        revision: 'b184e23a8a16b20f108f727c902e769e873ffc73',
        downloadFiles: ['model_index.json', 'transformer/model.safetensors'],
        label: 'Wan I2V 480P',
      },
      {
        modes: ['image_to_video'],
        repo: 'Wan-AI/Wan2.1-FLF2V-14B-720P-diffusers',
        revision: '17c30769b1e0b5dcaa1799b117bf20a9c31f59d7',
        downloadFiles: ['model_index.json', 'transformer/model.safetensors'],
        label: 'Wan FLF2V 720P',
      },
    ],
    modeDefaults: {
      image_to_video: { steps: 12, guidanceScale: 1 },
    },
  };
  globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [capability] });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.deepEqual(state.studioModelCapabilities[0].artifactSelections, capability.artifactSelections);
  assert.deepEqual(state.studioModelCapabilities[0].modeDefaults, capability.modeDefaults);

  for (const artifactSelections of [
    [capability.artifactSelections[0], { ...capability.artifactSelections[1], modes: ['single_image_to_video'] }],
    [{ ...capability.artifactSelections[0], revision: 'main' }],
    [{ ...capability.artifactSelections[0], downloadFiles: ['../model.safetensors'] }],
  ]) {
    globalThis.fetch = async () =>
      jsonResponse({ schemaVersion: 2, capabilities: [{ ...capability, artifactSelections }] });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    state = nodesStoreModule.useNodesStore.getState();
    assert.equal(state.discoveryRequests.capabilities.status, 'error');
    assert.deepEqual(state.studioModelCapabilities[0].artifactSelections, capability.artifactSelections);
  }

  for (const modeDefaults of [
    { text_to_video: { steps: 12 } },
    { image_to_video: { steps: 0 } },
    { image_to_video: { schedulerShift: 7 } },
  ]) {
    globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [{ ...capability, modeDefaults }] });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    state = nodesStoreModule.useNodesStore.getState();
    assert.equal(state.discoveryRequests.capabilities.status, 'error');
    assert.deepEqual(state.studioModelCapabilities[0].modeDefaults, capability.modeDefaults);
  }
});

test('model capabilities admit only the reviewed installed Spandrel artifact kind', async () => {
  const capability = {
    modelType: 'SpandrelVideoUpscale',
    modes: ['video_upscale'],
    runnableModes: ['video_upscale'],
    artifactKind: 'spandrel_upscaler',
    artifactInstallRequired: true,
    executionStatus: 'expert_only',
    qualificationStatus: 'graph-qualified-execution-pending',
    qualifiedModes: [],
    autoEligible: false,
    templateEligible: true,
    galleryEligible: false,
    liveProof: false,
  };
  globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [capability] });

  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();

  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.equal(state.studioModelCapabilities[0].artifactKind, 'spandrel_upscaler');
  assert.equal(state.studioModelCapabilities[0].artifactInstallRequired, true);

  for (const malformed of [
    { ...capability, artifactKind: 'arbitrary_checkpoint' },
    { ...capability, artifactInstallRequired: false },
  ]) {
    globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [malformed] });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    state = nodesStoreModule.useNodesStore.getState();
    assert.equal(state.discoveryRequests.capabilities.status, 'error');
    assert.equal(state.studioModelCapabilities[0].artifactKind, 'spandrel_upscaler');
  }
});

test('Janus capability parsing preserves mode outputs and fail-closed license compliance', async () => {
  const compliance = {
    state: 'product_and_user_review_required',
    codeLicense: 'MIT',
    weightsLicense: 'DeepSeek Model License Agreement v1.0',
    noticePath: 'licenses/DeepSeek-Model-License-1.0.txt',
    useRestrictionsPresent: true,
    distributionAndHostedUseCarryDuties: true,
    sourceExecutable: true,
    liveExecutionQualified: false,
  };
  const capability = {
    modelType: 'HuggingFaceAnyToAnyModel',
    modes: ['text_generation', 'image_to_text', 'text_to_image'],
    runnableModes: ['text_generation', 'image_to_text', 'text_to_image'],
    modeOutputKinds: { text_generation: 'json', image_to_text: 'json', text_to_image: 'image' },
    executionStatus: 'expert_only',
    qualificationStatus: 'graph-qualified-execution-pending',
    qualifiedModes: [],
    autoEligible: false,
    templateEligible: true,
    galleryEligible: false,
    license: 'DeepSeek Model License Agreement v1.0',
    licenseCompliance: compliance,
  };
  globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [capability] });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.deepEqual(state.studioModelCapabilities[0].modeOutputKinds, capability.modeOutputKinds);
  assert.deepEqual(state.studioModelCapabilities[0].licenseCompliance, compliance);
  assert.equal(state.studioModelCapabilities[0].autoEligible, false);
  assert.equal(state.studioModelCapabilities[0].galleryEligible, false);

  for (const malformed of [
    { ...capability, modeOutputKinds: { text_to_image: 'text' } },
    { ...capability, qualifiedModes: ['speech_to_text'] },
    { ...capability, licenseCompliance: { ...compliance, liveExecutionQualified: 'false' } },
    { ...capability, licenseCompliance: { ...compliance, weightsLicense: '' } },
  ]) {
    globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [malformed] });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    state = nodesStoreModule.useNodesStore.getState();
    assert.equal(state.discoveryRequests.capabilities.status, 'error');
    assert.equal(state.studioModelCapabilities[0].modelType, capability.modelType);
    assert.deepEqual(state.studioModelCapabilities[0].licenseCompliance, compliance);
  }
});

test('synchronized output media parses generically and fails closed', async () => {
  const capability = {
    modelType: 'LTX2Pipeline',
    modes: ['text_to_video'],
    runnableModes: ['text_to_video'],
    outputKind: 'video',
    outputMedia: ['video', 'audio'],
    executionStatus: 'expert_only',
    qualificationStatus: 'graph-qualified-execution-pending',
    qualifiedModes: [],
    autoEligible: false,
    templateEligible: true,
    galleryEligible: false,
    liveProof: false,
  };
  globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [capability] });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.deepEqual(state.studioModelCapabilities[0].outputMedia, ['video', 'audio']);

  for (const outputMedia of [[], ['audio'], ['video', 'video'], ['video', 'waveform']]) {
    globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [{ ...capability, outputMedia }] });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    state = nodesStoreModule.useNodesStore.getState();
    assert.equal(state.discoveryRequests.capabilities.status, 'error');
    assert.deepEqual(state.studioModelCapabilities[0].outputMedia, ['video', 'audio']);
  }
});

test('layer and dual-video capability metadata parses exactly and fails closed', async () => {
  const layered = {
    modelType: 'QwenImageLayeredPipeline',
    modes: ['layer_decomposition'],
    runnableModes: ['layer_decomposition'],
    modeRequirements: { layer_decomposition: { requiredImages: ['referenceImages'] } },
    layerCount: { default: 4, min: 1, max: 10 },
    layerResolutions: [640, 1024],
    executionStatus: 'expert_only',
    qualificationStatus: 'graph-qualified-execution-pending',
    qualifiedModes: [],
    autoEligible: false,
    templateEligible: true,
    galleryEligible: false,
    liveProof: false,
  };
  const combined = {
    modelType: 'AnimateDiffVideoToVideoControlNetPipeline',
    modes: ['control_video_to_video'],
    runnableModes: ['control_video_to_video'],
    modeRequirements: {
      control_video_to_video: { requiredVideos: ['sourceVideo', 'controlVideo'] },
    },
    executionStatus: 'expert_only',
    qualificationStatus: 'graph-qualified-execution-pending',
    qualifiedModes: [],
    autoEligible: false,
    templateEligible: true,
    galleryEligible: false,
    liveProof: false,
  };
  globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [layered, combined] });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.deepEqual(state.studioModelCapabilities[0].layerCount, layered.layerCount);
  assert.deepEqual(state.studioModelCapabilities[0].layerResolutions, layered.layerResolutions);
  assert.deepEqual(state.studioModelCapabilities[1].modeRequirements.control_video_to_video.requiredVideos, [
    'sourceVideo',
    'controlVideo',
  ]);
  assert.equal(state.studioModelCapabilities[1].liveProof, false);

  for (const malformed of [
    { ...layered, layerCount: { default: 4, min: 0, max: 10 } },
    { ...layered, layerCount: { default: 4, min: 1, max: 17 } },
    { ...layered, layerCount: { default: 4, min: 1, max: 10, extra: 1 } },
    { ...layered, layerResolutions: [640, 640] },
    { ...layered, layerResolutions: [641, 1024] },
    { ...layered, modes: ['text_to_image'] },
    { ...layered, layerResolutions: undefined },
    { ...layered, liveProof: 'false' },
  ]) {
    globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [malformed] });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    state = nodesStoreModule.useNodesStore.getState();
    assert.equal(state.discoveryRequests.capabilities.status, 'error');
    assert.deepEqual(state.studioModelCapabilities[0].layerCount, layered.layerCount);
  }
});

test('Studio execution specifications require an exact versioned capability contract', async () => {
  const spec = fluxExecutionSpec();
  const reviewedRevision = '462165984030d82259a11f4367a4eed129e94a7b';
  const reordered = Object.fromEntries(Object.entries(spec).reverse());
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [fluxCapability(reordered)],
    });

  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.equal(state.studioModelCapabilitiesAuthoritative, true);
  assert.equal(state.studioExecutionSpecInvalid, false);
  assert.equal(state.studioModelCapabilities[0].studioExecutionSpecs[0].contentHash, spec.contentHash);

  const auxiliarySpec = fluxExecutionSpec({
    roles: [...spec.roles, ['afterDecode', 'modules.ModularDiffusers.WorkflowCosmos3OmniAfterDecode', 980, 240]],
    edges: [...spec.edges, ['diffusersImageGenerate', 'images', 'afterDecode', 'state_in']],
    auxiliaryTerminalRoles: ['afterDecode'],
  });
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [fluxCapability(auxiliarySpec)],
    });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.deepEqual(state.studioModelCapabilities[0].studioExecutionSpecs[0].auxiliaryTerminalRoles, ['afterDecode']);

  const pinnedSpec = fluxExecutionSpec({
    bindings: [...spec.bindings, ['diffusersImagePipeline', 'revision', 'defaultRevision']],
  });
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [fluxCapability(pinnedSpec, { revisionCandidates: [reviewedRevision] })],
    });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.deepEqual(state.studioModelCapabilities[0].revisionCandidates, [reviewedRevision]);

  const partial = fluxCapability(spec, { modes: ['text_to_image', 'edit_image'] });
  globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [partial] });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  state = nodesStoreModule.useNodesStore.getState();
  assert.deepEqual(state.studioModelCapabilities[0].studioExecutionSpecModes, ['text_to_image']);
  assert.deepEqual(state.studioModelCapabilities[0].modes, ['text_to_image', 'edit_image']);

  const malformed = [
    fluxCapability({ ...spec, contentHash: 'studio-spec-v1-00000000' }),
    fluxCapability({ ...spec, roles: [...spec.roles, spec.roles[0]] }),
    fluxCapability({ ...spec, edges: [['missingRole', 'output', 'preview', 'image']] }),
    fluxCapability({ ...spec, edges: spec.edges.slice(0, 1) }),
    fluxCapability({ ...spec, bindings: [['diffusersImagePipeline', 'model_id', 'unreviewedSource']] }),
    fluxCapability(fluxExecutionSpec({ auxiliaryTerminalRoles: ['missingRole'] })),
    fluxCapability(fluxExecutionSpec({ auxiliaryTerminalRoles: ['diffusersImageGenerate'] })),
    fluxCapability(fluxExecutionSpec({ auxiliaryTerminalRoles: ['preview'] })),
    fluxCapability(fluxExecutionSpec({ auxiliaryTerminalRoles: ['preview', 'preview'] })),
    { ...fluxCapability(spec), studioExecutionSpecs: [spec, spec] },
    (() => {
      const defaultRepo = 'x'.repeat(513);
      const oversized = fluxExecutionSpec({ defaultRepo });
      return fluxCapability(oversized, {
        executionProfiles: [fluxExecutionProfile('FluxSchnellPipeline', 'flux-schnell:direct', defaultRepo)],
      });
    })(),
    { ...fluxCapability(spec), studioExecutionSpecSchemaVersion: undefined },
    { ...fluxCapability(spec), studioExecutionSpecs: undefined },
    { ...fluxCapability(spec), studioExecutionSpecModes: undefined },
    { ...fluxCapability(spec), studioExecutionSpecModes: [] },
    { ...fluxCapability(spec), studioExecutionSpecModes: [spec.mode, spec.mode] },
    { ...fluxCapability(spec), studioExecutionSpecModes: ['edit_image'] },
    { ...fluxCapability(spec), studioExecutionSpecModes: [spec.mode, 'future_mode'] },
    fluxCapability(spec, { revisionCandidates: ['main'] }),
    fluxCapability(spec, { revisionCandidates: [reviewedRevision, reviewedRevision] }),
  ];
  for (const capability of malformed) {
    globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [capability] });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    state = nodesStoreModule.useNodesStore.getState();
    assert.equal(state.discoveryRequests.capabilities.status, 'error');
    assert.equal(state.studioModelCapabilitiesAuthoritative, false);
    assert.equal(state.studioExecutionSpecInvalid, true);
    assert.deepEqual(state.studioModelCapabilities, []);
  }
  globalThis.fetch = async () => jsonResponse({ capabilities: [fluxCapability(spec)] });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'error');
  assert.equal(state.studioExecutionSpecInvalid, true);
});

test('schema-v2 runnable modes admit exact internal Modular Diffusers routes omitted from legacy modes', async () => {
  const directProfile = fluxExecutionProfile('ZImageModularPipeline', 'z-image:direct');
  const modularProfile = {
    ...fluxExecutionProfile('ZImageModularPipeline', 'z-image:modular', 'Tongyi-MAI/Z-Image-Turbo'),
    modes: ['modular_text_to_image'],
    loader_module: 'modules.ModularDiffusers',
    loader_action: 'ModelsLoader',
    execution_path: 'modular-diffusers',
    backend_path: 'modules.ModularDiffusers.ModelsLoader',
    pipeline_class: 'ZImageModularPipeline',
  };
  const baseSpec = fluxExecutionSpec();
  const modularSpec = fluxExecutionSpec({
    id: 'z-image:modular-text-to-image:v1',
    modelType: 'ZImageModularPipeline',
    mode: 'modular_text_to_image',
    executionProfileId: modularProfile.id,
    loaderModule: modularProfile.loader_module,
    loaderAction: modularProfile.loader_action,
    executionPath: modularProfile.execution_path,
    pipelineClass: modularProfile.pipeline_class,
    defaultRepo: modularProfile.default_repo,
    roles: baseSpec.roles.map((role) =>
      role[0] === 'diffusersImagePipeline'
        ? ['diffusersImagePipeline', 'modules.ModularDiffusers.ModelsLoader', role[2], role[3]]
        : role,
    ),
  });
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [
        {
          modelType: 'ZImageModularPipeline',
          // Schema-v1 clients only understand this presentation route.
          modes: ['text_to_image'],
          // Schema-v2 clients must use this exact execution set.
          runnableModes: ['text_to_image', 'modular_text_to_image'],
          executionProfiles: [directProfile, modularProfile],
          studioExecutionSpecSchemaVersion: 1,
          studioExecutionSpecModes: ['modular_text_to_image'],
          studioExecutionSpecs: [modularSpec],
        },
      ],
    });

  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.deepEqual(state.studioModelCapabilities[0].modes, ['text_to_image']);
  assert.deepEqual(state.studioModelCapabilities[0].runnableModes, ['text_to_image', 'modular_text_to_image']);
  assert.equal(state.studioModelCapabilities[0].studioExecutionSpecs[0].id, modularSpec.id);
});

test('FLUX Modular Cluster capabilities retain their exact reviewed execution surfaces', async () => {
  const capabilities = [
    ['FluxModularPipeline', ['text_to_image', 'image_to_image']],
    ['FluxKontextModularPipeline', ['text_to_image', 'edit_image']],
    ['Flux2KleinModularPipeline', ['text_to_image', 'edit_image']],
    ['Flux2KleinBaseModularPipeline', ['text_to_image', 'edit_image']],
  ].map(([modelType, modes]) => ({ modelType, modes, runnableModes: modes }));
  globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities });

  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.equal(state.studioModelCapabilitiesAuthoritative, true);
  assert.deepEqual(
    state.studioModelCapabilities.map((capability) => capability.modelType),
    capabilities.map((capability) => capability.modelType),
  );
  assert.deepEqual(
    state.studioModelCapabilities.map((capability) => capability.runnableModes),
    capabilities.map((capability) => capability.runnableModes),
  );
});

test('task-template contracts generate stable planning skeletons from the exact execution spec', async () => {
  const spec = fluxExecutionSpec();
  const contract = fluxTaskTemplateContract(spec);
  const capability = fluxCapability(spec, {
    taskTemplateContractSchemaVersion: 1,
    taskTemplateContractModes: [spec.mode],
    taskTemplateContracts: [contract],
  });
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [capability],
      taskTemplateContractSchemaVersion: 1,
      taskTemplateContracts: [contract],
    });

  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.deepEqual(state.studioTaskTemplateContracts, [{ ...contract, auxiliaryTerminalRoles: [] }]);
  assert.deepEqual(state.studioTaskTemplateSkeletons, [
    {
      id: contract.id,
      modelType: contract.modelType,
      mode: contract.mode,
      mediaKind: 'image',
      executionSpecId: spec.id,
      requiredMedia: [],
      output: contract.output,
      galleryVisible: false,
    },
  ]);
});

test('legacy model capabilities remain non-authoritative when schemaVersion is absent', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      capabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image', 'control_image'],
        },
      ],
    });

  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.studioModelCapabilitiesAuthoritative, false);
  assert.deepEqual(state.studioModelCapabilities[0].modes, ['text_to_image', 'control_image']);
});

test('optional runtime contracts normalize exact nested profile metadata', async () => {
  const requirement = runtimeRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    state: 'missing',
    reason: 'optional_runtime_missing',
  });
  const expertCudaPolicy = {
    schema_version: 1,
    blocked_dtypes: ['float32'],
    recommended_dtype: 'bfloat16',
    offloaded_vram_bytes: 10 * 1024 ** 3,
    resident_vram_bytes: 80 * 1024 ** 3,
    quantized_resident_vram_bytes: [['bnb_4bit', 24 * 1024 ** 3]],
  };
  const expertQuantizationPolicy = {
    schema_version: 1,
    quantization_mode: 'bnb_4bit',
    offload_mode: 'model_cpu',
    modular_node: 'modules.ModularDiffusers.QuantizationConfigNode',
    subfolder: 'transformer',
    component: 'qwen_low_vram',
    four_bit_quant_type: 'nf4',
    compute_dtype: 'bfloat16',
    double_quant: true,
  };
  const expertMpsPolicy = {
    schema_version: 1,
    qualification: 'unqualified',
    fallback_action: 'switch_to_z_image',
  };
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image'],
          runnableModes: ['text_to_image'],
          optionalRuntimeRequirement: requirement,
          executionProfiles: [
            {
              id: 'qwen-image:t2i-direct',
              modes: ['text_to_image'],
              optional_runtime_delivery: 'optional_overlay',
              optional_runtime_requirement: requirement,
              expert_cuda_policy: expertCudaPolicy,
              expert_quantization_policy: expertQuantizationPolicy,
              expert_mps_policy: expertMpsPolicy,
              expert_quantization_modes: ['bnb_4bit'],
              available_expert_quantization_modes: [],
            },
          ],
        },
      ],
    });

  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.deepEqual(state.studioModelCapabilities[0].optionalRuntimeRequirement, requirement);
  assert.deepEqual(state.studioModelCapabilities[0].executionProfiles[0].optionalRuntimeRequirement, requirement);
  assert.deepEqual(state.studioModelCapabilities[0].executionProfiles[0].expert_cuda_policy, expertCudaPolicy);
  assert.deepEqual(
    state.studioModelCapabilities[0].executionProfiles[0].expert_quantization_policy,
    expertQuantizationPolicy,
  );
  assert.deepEqual(state.studioModelCapabilities[0].executionProfiles[0].expert_mps_policy, expertMpsPolicy);
  assert.deepEqual(state.studioModelCapabilities[0].executionProfiles[0].expert_quantization_modes, ['bnb_4bit']);
  assert.deepEqual(state.studioModelCapabilities[0].executionProfiles[0].available_expert_quantization_modes, []);
  assert.equal(state.studioModelCapabilities[0].executionProfiles[0].optional_runtime_requirement, undefined);
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousFlow = flowStoreModule.useFlowStore.getState();
  try {
    studioStoreModule.useStudioStore.setState({
      form: { ...previousForm, modelType: 'QwenImageModularPipeline', mode: 'text_to_image', resourceMode: 'expert' },
      graphBinding: null,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });
    const issue = runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'optional_runtime_required');
    assert.equal(issue?.blocking, false, 'the exact backend snake-case contract must remain a manual warning');
    assert.equal(issue?.severity, 'warning');
  } finally {
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousFlow.nodes, edges: previousFlow.edges });
  }
});

test('active optional-runtime capabilities preserve the supported execution state', async () => {
  const requirement = runtimeRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    profileIds: ['huggingface-transformers-main-96fe6dce-peft-0.20.0'],
    executionProfileIds: ['z-image:auto', 'z-image:img2img-direct'],
    state: 'active',
    reason: 'optional_runtime_active',
  });
  const capability = {
    modelType: 'ZImageModularPipeline',
    modes: ['text_to_image', 'edit_image'],
    runnableModes: ['text_to_image', 'edit_image'],
    executionStatus: 'supported',
    optionalRuntimeRequirement: requirement,
    executionProfiles: [
      {
        id: 'z-image:auto',
        modes: ['text_to_image'],
        optional_runtime_delivery: 'optional_overlay',
        optionalRuntimeRequirement: {
          ...requirement,
          executionProfileIds: ['z-image:auto'],
        },
      },
      {
        id: 'z-image:img2img-direct',
        modes: ['edit_image'],
        optional_runtime_delivery: 'optional_overlay',
        optionalRuntimeRequirement: {
          ...requirement,
          executionProfileIds: ['z-image:img2img-direct'],
        },
      },
    ],
  };
  globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities: [capability] });

  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();

  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.equal(state.studioModelCapabilitiesAuthoritative, true);
  assert.equal(state.studioModelCapabilities[0].executionStatus, 'supported');
  assert.deepEqual(state.studioModelCapabilities[0].optionalRuntimeRequirement, requirement);

  globalThis.fetch = async () =>
    jsonResponse({ schemaVersion: 2, capabilities: [{ ...capability, executionStatus: 'fully_supported' }] });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'error');
  assert.equal(state.studioModelCapabilities[0].executionStatus, 'supported');
});

test('malformed optional runtime capability metadata fails the authoritative response closed', async () => {
  const invalidRequirements = [
    runtimeRequirement({ unexpected: true }),
    runtimeRequirement({ requiredNow: true, state: 'active' }),
    runtimeRequirement({ executionProfileIds: ['qwen-image:t2i-direct', 'qwen-image:t2i-direct'] }),
  ];
  for (const requirement of invalidRequirements) {
    globalThis.fetch = async () =>
      jsonResponse({
        schemaVersion: 2,
        capabilities: [
          {
            modelType: 'QwenImageModularPipeline',
            modes: ['text_to_image'],
            runnableModes: ['text_to_image'],
            optionalRuntimeRequirement: requirement,
          },
        ],
      });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    const state = nodesStoreModule.useNodesStore.getState();
    assert.equal(state.discoveryRequests.capabilities.status, 'error');
    assert.equal(state.studioModelCapabilitiesAuthoritative, false);
    assert.deepEqual(state.studioModelCapabilities, []);
  }
});

test('mixed-version and conflicting execution runtime contracts fail closed', async () => {
  const firstId = 'qwen-image:t2i-direct';
  const secondId = 'qwen-image:t2i-secondary';
  const base = runtimeRequirement({ executionProfileIds: [firstId] });
  const overlay = runtimeRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    executionProfileIds: [secondId],
    state: 'missing',
    reason: 'optional_runtime_missing',
  });
  const requiredFirst = { ...overlay, executionProfileIds: [firstId] };
  const invalidProfiles = [
    {
      aggregate: runtimeRequirement(),
      profiles: [{ id: firstId, modes: ['text_to_image'] }],
    },
    {
      profiles: [
        { id: firstId, modes: ['text_to_image'], optionalRuntimeRequirement: base },
        { id: secondId, modes: ['control_image'] },
      ],
    },
    {
      profiles: [
        { id: firstId, modes: ['text_to_image'], optionalRuntimeRequirement: base },
        { id: secondId, modes: ['text_to_image'], optionalRuntimeRequirement: overlay },
      ],
    },
    {
      aggregate: requiredFirst,
      profiles: [{ id: firstId, modes: ['text_to_image'], optionalRuntimeRequirement: base }],
    },
    {
      aggregate: base,
      profiles: [{ id: firstId, modes: ['text_to_image'], optionalRuntimeRequirement: requiredFirst }],
    },
    {
      profiles: [
        {
          id: firstId,
          modes: ['text_to_image'],
          expert_cuda_policy: {
            schema_version: 1,
            blocked_dtypes: ['float32'],
            recommended_dtype: 'bfloat16',
            offloaded_vram_bytes: 10 * 1024 ** 3,
            resident_vram_bytes: 80 * 1024 ** 3,
            quantized_resident_vram_bytes: [['bnb_4bit', 24 * 1024 ** 3]],
            unexpected: true,
          },
        },
      ],
    },
    {
      profiles: [{ id: firstId, modes: ['text_to_image'], expert_quantization_modes: [] }],
    },
    {
      profiles: [{ id: firstId, modes: ['text_to_image'], expert_quantization_modes: ['bnb_4bit', 'bnb_4bit'] }],
    },
    {
      profiles: [{ id: firstId, modes: ['text_to_image'], expert_quantization_modes: ['future_quantization'] }],
    },
    {
      profiles: [
        {
          id: firstId,
          modes: ['text_to_image'],
          expert_quantization_modes: ['bnb_4bit'],
          available_expert_quantization_modes: ['torchao_float8'],
        },
      ],
    },
    {
      profiles: [
        {
          id: firstId,
          modes: ['text_to_image'],
          expert_cuda_policy: {
            schema_version: 1,
            blocked_dtypes: ['float32'],
            recommended_dtype: 'bfloat16',
            offloaded_vram_bytes: 10 * 1024 ** 3,
            resident_vram_bytes: 1025 * 1024 ** 3,
            quantized_resident_vram_bytes: [['bnb_4bit', 24 * 1024 ** 3]],
          },
        },
      ],
    },
    {
      profiles: [
        {
          id: firstId,
          modes: ['text_to_image'],
          expert_quantization_policy: {
            schema_version: 1,
            quantization_mode: 'bnb_4bit',
            offload_mode: 'model_cpu',
            modular_node: '../../unsafe',
            subfolder: 'transformer',
            component: 'qwen_low_vram',
            four_bit_quant_type: 'nf4',
            compute_dtype: 'bfloat16',
            double_quant: true,
          },
        },
      ],
    },
    {
      profiles: [
        {
          id: firstId,
          modes: ['text_to_image'],
          expert_quantization_policy: {
            schema_version: 1,
            quantization_mode: 'bnb_4bit',
            offload_mode: 'model_cpu',
            modular_node: 'modules.ModularDiffusers.QuantizationConfigNode',
            subfolder: 'transformer',
            component: 'qwen_low_vram',
            four_bit_quant_type: 'nf4',
            compute_dtype: 'bfloat16',
            double_quant: true,
            unexpected: true,
          },
        },
      ],
    },
    {
      profiles: [
        {
          id: firstId,
          modes: ['text_to_image'],
          compatible_repos: ['owner/repo', 'owner/repo'],
        },
      ],
    },
    {
      profiles: [
        {
          id: firstId,
          modes: ['text_to_image'],
          expert_mps_policy: {
            schema_version: 1,
            qualification: 'certified',
            fallback_action: 'open_setup',
          },
        },
      ],
    },
    {
      profiles: [
        {
          id: firstId,
          modes: ['text_to_image'],
          expert_mps_policy: {
            schema_version: 1,
            qualification: 'unqualified',
            fallback_action: 'open_setup',
            unexpected: true,
          },
        },
      ],
    },
  ];
  for (const { aggregate, profiles } of invalidProfiles) {
    globalThis.fetch = async () =>
      jsonResponse({
        schemaVersion: 2,
        capabilities: [
          {
            modelType: 'QwenImageModularPipeline',
            modes: ['text_to_image', 'control_image'],
            runnableModes: ['text_to_image', 'control_image'],
            ...(aggregate ? { optionalRuntimeRequirement: aggregate } : {}),
            executionProfiles: profiles,
          },
        ],
      });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    assert.equal(nodesStoreModule.useNodesStore.getState().discoveryRequests.capabilities.status, 'error');
  }
});

test('capability identity and runnable execution-profile coverage are exact', async () => {
  const baseCapability = {
    modelType: 'QwenImageModularPipeline',
    modes: ['text_to_image', 'control_image'],
    runnableModes: ['text_to_image'],
  };
  for (const capabilities of [
    [baseCapability, { ...baseCapability, optionalRuntimeRequirement: runtimeRequirement() }],
    [
      {
        ...baseCapability,
        executionProfiles: [{ id: 'qwen-image:control', modes: ['control_image'] }],
      },
    ],
    [
      {
        ...baseCapability,
        executionProfiles: [{ id: 'qwen-image:t2i-direct', modes: ['text_to_image', 'text_to_image'] }],
      },
    ],
    [
      {
        modelType: baseCapability.modelType,
        modes: ['text_to_image', 'control_image'],
        executionProfiles: [{ id: 'qwen-image:control', modes: ['control_image'] }],
      },
    ],
    [{ ...baseCapability, modes: ['text_to_image', 'text_to_image'] }],
    [{ ...baseCapability, runnableModes: ['text_to_image', 'text_to_image'] }],
    [{ ...baseCapability, modes: Array(100_000).fill('text_to_image') }],
    Array.from({ length: nodesStoreModule.MAX_STUDIO_MODEL_CAPABILITIES + 1 }, (_, index) => ({
      modelType: `FuturePipeline${index}`,
      modes: [],
    })),
  ]) {
    globalThis.fetch = async () => jsonResponse({ schemaVersion: 2, capabilities });
    await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
    assert.equal(nodesStoreModule.useNodesStore.getState().discoveryRequests.capabilities.status, 'error');
  }

  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [{ ...baseCapability, optionalRuntimeRequirement: runtimeRequirement() }],
    });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  assert.equal(
    nodesStoreModule.useNodesStore.getState().discoveryRequests.capabilities.status,
    'success',
    'an absent executionProfiles field keeps the legacy aggregate fallback compatible',
  );
});

test('a malformed capability refresh preserves the last authoritative runtime contract', async () => {
  const requirement = runtimeRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    state: 'missing',
    reason: 'optional_runtime_missing',
  });
  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image'],
          runnableModes: ['text_to_image'],
          optionalRuntimeRequirement: requirement,
          executionProfiles: [
            { id: 'qwen-image:t2i-direct', modes: ['text_to_image'], optionalRuntimeRequirement: requirement },
          ],
        },
      ],
    });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  const previous = nodesStoreModule.useNodesStore.getState().studioModelCapabilities;

  globalThis.fetch = async () =>
    jsonResponse({
      schemaVersion: 2,
      capabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image'],
          optionalRuntimeRequirement: { ...requirement, schemaVersion: 999 },
        },
      ],
    });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'error');
  assert.equal(state.studioModelCapabilitiesAuthoritative, true);
  assert.deepEqual(state.studioModelCapabilities, previous);
});

test('concurrent model-capability callers join one authoritative discovery request', async () => {
  const calls = [];
  const requested = deferred();
  globalThis.fetch = () => {
    const call = deferred();
    calls.push(call);
    requested.resolve();
    return call.promise;
  };
  const first = nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  const second = nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  await requested.promise;
  assert.equal(calls.length, 1);
  calls[0].resolve(
    jsonResponse({
      schemaVersion: 2,
      capabilities: [
        { modelType: 'QwenImageModularPipeline', modes: ['text_to_image'], runnableModes: ['text_to_image'] },
      ],
    }),
  );
  await Promise.all([first, second]);
  assert.equal(calls.length, 1);
  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.capabilities.status, 'success');
  assert.equal(state.studioModelCapabilitiesAuthoritative, true);
  assert.equal(state.studioModelCapabilities[0].modelType, 'QwenImageModularPipeline');
});

test('optional runtime catalog parsing is bounded and qualified-active only', () => {
  assert.deepEqual(
    optionalRuntimesModule.parseOptionalRuntimeRequirement(
      runtimeRequirement({ profileIds: [], executionProfileIds: [] }),
    ).executionProfileIds,
    [],
  );
  assert.throws(
    () =>
      optionalRuntimesModule.parseOptionalRuntimeRequirement(
        runtimeRequirement({
          delivery: 'optional_overlay',
          requiredNow: true,
          profileIds: [],
          executionProfileIds: [],
          state: 'missing',
        }),
      ),
    /runtime contract/i,
  );
  const parsed = optionalRuntimesModule.parseOptionalRuntimeCatalog(optionalRuntimeCatalog());
  assert.equal(parsed.profiles[0].installActionAvailable, false);
  assert.equal(optionalRuntimesModule.optionalRuntimeBlockState(runtimeRequirement(), null), null);
  for (const processLoadStatus of ['active', 'base', 'busy_recovery_only', 'repair_required', 'restart_required']) {
    assert.equal(
      optionalRuntimesModule.optionalRuntimeBlockState(runtimeRequirement(), { ...parsed, processLoadStatus }),
      null,
      `base delivery must ignore ${processLoadStatus}`,
    );
  }

  const required = runtimeRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    state: 'active',
    reason: 'optional_runtime_active',
  });
  assert.equal(
    optionalRuntimesModule.optionalRuntimeBlockState(required, parsed),
    'unavailable',
    'candidate_unqualified must not satisfy an active requirement',
  );
  const activeCatalog = optionalRuntimesModule.parseOptionalRuntimeCatalog(
    optionalRuntimeCatalog({
      profiles: [
        {
          ...optionalRuntimeCatalog().profiles[0],
          contractState: 'qualified',
          cutoverReady: true,
          status: 'present_unqualified',
          overlayStatus: 'active',
        },
      ],
      overlay: {
        processLoadStatus: 'active',
        state: { activeEnvironmentId: 'runtime-1-12345678', previousEnvironmentId: null },
        environments: [
          {
            id: 'runtime-1-12345678',
            status: 'ready',
            active: true,
            specs: [
              {
                kind: 'optional_runtime',
                id: 'huggingface-transformers-peft-5.14.1-0.20.0',
                specDigest: `sha256:${'1'.repeat(64)}`,
              },
            ],
          },
        ],
      },
    }),
  );
  assert.equal(optionalRuntimesModule.optionalRuntimeBlockState(required, activeCatalog), null);
  const compositeCatalog = optionalRuntimesModule.parseOptionalRuntimeCatalog(
    optionalRuntimeCatalog({
      profiles: [
        {
          ...optionalRuntimeCatalog().profiles[0],
          contractState: 'qualified',
          cutoverReady: true,
          status: 'present_unqualified',
          overlayStatus: 'active',
        },
        {
          ...optionalRuntimeCatalog().profiles[0],
          id: 'gallery-media-opencv-5.0.0.93-pyav-18.1.0',
          label: 'Transformers main + PEFT + media codecs',
          specDigest: `sha256:${'3'.repeat(64)}`,
          contractState: 'qualified',
          cutoverReady: true,
          status: 'present_unqualified',
          overlayStatus: 'active',
          satisfiesProfiles: [
            {
              id: 'huggingface-transformers-peft-5.14.1-0.20.0',
              specDigest: `sha256:${'1'.repeat(64)}`,
            },
          ],
        },
      ],
      overlay: {
        processLoadStatus: 'active',
        state: { activeEnvironmentId: 'runtime-1-12345678', previousEnvironmentId: null },
        environments: [
          {
            id: 'runtime-1-12345678',
            status: 'ready',
            active: true,
            specs: [
              {
                kind: 'optional_runtime',
                id: 'gallery-media-opencv-5.0.0.93-pyav-18.1.0',
                specDigest: `sha256:${'3'.repeat(64)}`,
              },
            ],
          },
        ],
      },
    }),
  );
  assert.equal(
    optionalRuntimesModule.optionalRuntimeBlockState(required, compositeCatalog),
    null,
    'an exact active composite alias must satisfy its reviewed profile requirement',
  );
  const mixedPins = runtimeRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    state: 'active',
    reason: 'optional_runtime_active',
    profileIds: ['huggingface-transformers-peft-5.14.1-0.20.0', 'huggingface-transformers-main-96fe6dce-peft-0.20.0'],
  });
  const mixedCatalog = optionalRuntimesModule.parseOptionalRuntimeCatalog(
    optionalRuntimeCatalog({
      profiles: [
        {
          ...optionalRuntimeCatalog().profiles[0],
          id: 'huggingface-transformers-peft-5.14.1-0.20.0',
          contractState: 'qualified',
          cutoverReady: true,
          status: 'wrong_version',
          overlayStatus: 'missing',
        },
        {
          ...optionalRuntimeCatalog().profiles[0],
          id: 'huggingface-transformers-main-96fe6dce-peft-0.20.0',
          contractState: 'qualified',
          cutoverReady: true,
          status: 'present_unqualified',
          overlayStatus: 'active',
        },
      ],
      overlay: {
        processLoadStatus: 'active',
        state: { activeEnvironmentId: 'runtime-1-12345678', previousEnvironmentId: null },
        environments: [
          {
            id: 'runtime-1-12345678',
            status: 'ready',
            active: true,
            specs: [
              {
                kind: 'optional_runtime',
                id: 'huggingface-transformers-main-96fe6dce-peft-0.20.0',
                specDigest: `sha256:${'1'.repeat(64)}`,
              },
            ],
          },
        ],
      },
    }),
  );
  assert.equal(
    optionalRuntimesModule.optionalRuntimeBlockState(mixedPins, mixedCatalog),
    null,
    'one active alternative pin must satisfy the optional-runtime requirement',
  );
  for (const [label, activeProfileId, activeDigest] of [
    [
      'an unrelated active profile must not satisfy the requirement',
      'huggingface-transformers-main-96fe6dce-peft-0.20.0',
      `sha256:${'1'.repeat(64)}`,
    ],
    [
      'a mismatched active profile digest must not satisfy the requirement',
      'huggingface-transformers-peft-5.14.1-0.20.0',
      `sha256:${'2'.repeat(64)}`,
    ],
  ]) {
    const mismatchedActiveCatalog = optionalRuntimesModule.parseOptionalRuntimeCatalog(
      optionalRuntimeCatalog({
        profiles: activeCatalog.profiles,
        overlay: {
          processLoadStatus: 'active',
          state: { activeEnvironmentId: 'runtime-1-12345678', previousEnvironmentId: null },
          environments: [
            {
              id: 'runtime-1-12345678',
              status: 'ready',
              active: true,
              specs: [{ kind: 'optional_runtime', id: activeProfileId, specDigest: activeDigest }],
            },
          ],
        },
      }),
    );
    assert.equal(
      optionalRuntimesModule.optionalRuntimeBlockState(required, mismatchedActiveCatalog),
      'unavailable',
      label,
    );
  }
  assert.equal(
    optionalRuntimesModule.optionalRuntimeBlockState(
      required,
      optionalRuntimesModule.parseOptionalRuntimeCatalog(
        optionalRuntimeCatalog({
          profiles: [
            {
              ...optionalRuntimeCatalog().profiles[0],
              contractState: 'qualified',
              cutoverReady: false,
              overlayStatus: 'active',
            },
          ],
          overlay: {
            processLoadStatus: 'active',
            state: { activeEnvironmentId: null, previousEnvironmentId: null },
            environments: [],
          },
        }),
      ),
    ),
    'unavailable',
  );
  assert.throws(
    () =>
      optionalRuntimesModule.parseOptionalRuntimeCatalog(
        optionalRuntimeCatalog({ profiles: Array.from({ length: 33 }, () => optionalRuntimeCatalog().profiles[0]) }),
      ),
    /runtime contract/i,
  );
  assert.throws(
    () =>
      optionalRuntimesModule.parseOptionalRuntimeCatalog(
        optionalRuntimeCatalog({ profiles: [{ ...optionalRuntimeCatalog().profiles[0], schemaVersion: 999 }] }),
      ),
    /runtime contract/i,
  );
  for (const profile of [
    { ...optionalRuntimeCatalog().profiles[0], specDigest: 'sha256:invalid' },
    { ...optionalRuntimeCatalog().profiles[0], platform: 'solaris' },
    { ...optionalRuntimeCatalog().profiles[0], machine: 'riscv64' },
    { ...optionalRuntimeCatalog().profiles[0], installActionAvailable: 'yes' },
    { ...optionalRuntimeCatalog().profiles[0], activationAvailable: undefined },
  ]) {
    assert.throws(
      () => optionalRuntimesModule.parseOptionalRuntimeCatalog(optionalRuntimeCatalog({ profiles: [profile] })),
      /runtime contract/i,
    );
  }

  const actionable = optionalRuntimesModule.parseOptionalRuntimeCatalog(
    optionalRuntimeCatalog({
      profiles: [
        {
          ...optionalRuntimeCatalog().profiles[0],
          contractState: 'qualified',
          cutoverReady: true,
          installActionAvailable: true,
          activationAvailable: true,
          overlayStatus: 'staged',
        },
      ],
      overlay: {
        processLoadStatus: 'base',
        state: {
          activeEnvironmentId: null,
          previousEnvironmentId: 'runtime-1-abcdef12',
        },
        environments: [
          {
            id: 'runtime-2-12345678',
            status: 'ready',
            active: false,
            specs: [
              {
                kind: 'optional_runtime',
                id: 'huggingface-transformers-peft-5.14.1-0.20.0',
                specDigest: `sha256:${'1'.repeat(64)}`,
              },
            ],
          },
        ],
      },
    }),
  );
  assert.equal(
    optionalRuntimesModule.stagedOptionalRuntimeEnvironment(actionable, actionable.profiles[0]),
    'runtime-2-12345678',
  );
  assert.equal(actionable.previousEnvironmentId, 'runtime-1-abcdef12');
  assert.equal(actionable.activeEnvironmentId, null);
  const repairedAfterBaseRollback = optionalRuntimesModule.parseOptionalRuntimeCatalog(
    optionalRuntimeCatalog({
      profiles: actionable.profiles,
      overlay: {
        processLoadStatus: 'base',
        state: {
          activeEnvironmentId: null,
          previousEnvironmentId: 'runtime-1-abcdef12',
        },
        environments: [
          {
            id: 'runtime-1-abcdef12',
            status: 'staged_unchecked',
            active: false,
            specs: [
              {
                kind: 'optional_runtime',
                id: actionable.profiles[0].id,
                specDigest: actionable.profiles[0].specDigest,
              },
            ],
          },
          {
            id: 'runtime-2-12345678',
            status: 'staged_unchecked',
            active: false,
            specs: [
              {
                kind: 'optional_runtime',
                id: actionable.profiles[0].id,
                specDigest: actionable.profiles[0].specDigest,
              },
            ],
          },
        ],
      },
    }),
  );
  assert.equal(
    optionalRuntimesModule.stagedOptionalRuntimeEnvironment(
      repairedAfterBaseRollback,
      repairedAfterBaseRollback.profiles[0],
    ),
    undefined,
    'an unchecked staged environment must be repaired or revalidated before activation',
  );
  assert.equal(
    optionalRuntimesModule.stagedOptionalRuntimeEnvironment(
      optionalRuntimesModule.parseOptionalRuntimeCatalog(
        optionalRuntimeCatalog({
          profiles: actionable.profiles,
          overlay: {
            ...optionalRuntimeCatalog().overlay,
            environments: [
              {
                id: 'runtime-2-12345678',
                status: 'ready',
                active: true,
                specs: [
                  {
                    kind: 'optional_runtime',
                    id: actionable.profiles[0].id,
                    specDigest: actionable.profiles[0].specDigest,
                  },
                ],
              },
            ],
          },
        }),
      ),
      actionable.profiles[0],
    ),
    undefined,
  );
  const ambiguous = optionalRuntimesModule.parseOptionalRuntimeCatalog({
    ...optionalRuntimeCatalog(),
    profiles: actionable.profiles,
    overlay: {
      ...optionalRuntimeCatalog().overlay,
      environments: [
        {
          id: 'runtime-2-12345678',
          status: 'ready',
          active: false,
          specs: [
            { kind: 'optional_runtime', id: actionable.profiles[0].id, specDigest: actionable.profiles[0].specDigest },
          ],
        },
        {
          id: 'runtime-3-87654321',
          status: 'ready',
          active: false,
          specs: [
            { kind: 'optional_runtime', id: actionable.profiles[0].id, specDigest: actionable.profiles[0].specDigest },
          ],
        },
      ],
    },
  });
  assert.equal(optionalRuntimesModule.stagedOptionalRuntimeEnvironment(ambiguous, ambiguous.profiles[0]), undefined);
  assert.equal(
    optionalRuntimesModule.parseOptionalRuntimeCatalog(
      optionalRuntimeCatalog({ activeInstallJob: { ownerKind: 'optional_runtime', ownerId: null } }),
    ).installBusy,
    true,
  );

  const job = optionalRuntimesModule.parseOptionalRuntimeJobResponse({
    error: false,
    job: {
      id: 'optjob-AbCdEf123456',
      profileId: actionable.profiles[0].id,
      specDigest: actionable.profiles[0].specDigest,
      status: 'ready',
      progress: { phase: 'ready', message: 'Validation passed.' },
      result: { environmentId: 'runtime-2-12345678', requiresActivation: true },
    },
  });
  assert.equal(job.result.environmentId, 'runtime-2-12345678');
  assert.throws(
    () =>
      optionalRuntimesModule.parseOptionalRuntimeJobResponse({
        error: false,
        job: { ...job, id: '../job', progress: job.progress },
      }),
    /runtime contract/i,
  );
  assert.deepEqual(
    optionalRuntimesModule.parseOptionalRuntimeMutation({
      error: false,
      restartRequired: true,
      restarting: false,
      message: 'Restart MoDiff.',
    }),
    { restartRequired: true, restarting: false, message: 'Restart MoDiff.' },
  );
});

test('optional runtime status uses latest-response ordering and clears malformed state', async () => {
  const calls = [];
  globalThis.fetch = () => {
    const call = deferred();
    calls.push(call);
    return call.promise;
  };
  const first = nodesStoreModule.useNodesStore.getState().fetchOptionalRuntimes();
  const second = nodesStoreModule.useNodesStore.getState().fetchOptionalRuntimes();
  calls[1].resolve(jsonResponse(optionalRuntimeCatalog()));
  await second;
  calls[0].resolve(jsonResponse({ schemaVersion: 999 }));
  await first;
  assert.equal(nodesStoreModule.useNodesStore.getState().optionalRuntimeCatalog.profiles.length, 1);

  globalThis.fetch = async () =>
    jsonResponse({ schemaVersion: 1, profiles: [], overlay: { processLoadStatus: 'bogus' } });
  await nodesStoreModule.useNodesStore.getState().fetchOptionalRuntimes();
  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.optionalRuntimeCatalog, null);
  assert.equal(state.discoveryRequests.optionalRuntimes.status, 'error');
  assert.match(state.discoveryRequests.optionalRuntimes.error, /runtime contract/i);
});

test('requestJson aborts requests at the configured timeout', async () => {
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });

  await assert.rejects(requestModule.requestJson('/slow', { timeoutMs: 10 }), (error) => {
    assert.equal(error.kind, 'timeout');
    assert.match(error.message, /10ms/);
    return true;
  });
});

test('latest endpoint request wins even when an aborted mock resolves late', async () => {
  const calls = [];
  globalThis.fetch = () => {
    const call = deferred();
    calls.push(call);
    return call.promise;
  };

  const first = nodesStoreModule.useNodesStore.getState().fetchHfCache(false);
  const second = nodesStoreModule.useNodesStore.getState().fetchHfCache(true);
  calls[1].resolve(jsonResponse([{ repo_id: 'new/repo' }]));
  await second;
  calls[0].resolve(jsonResponse([{ repo_id: 'stale/repo' }]));
  await first;

  const state = nodesStoreModule.useNodesStore.getState();
  assert.deepEqual(state.hfCache, [{ repo_id: 'new/repo' }]);
  assert.equal(state.discoveryRequests.hfCache.status, 'success');
  assert.equal(state.isLoading, false);
});

test('concurrent node-registry consumers share and await the startup request', async () => {
  const registryRequest = deferred();
  let requestCount = 0;
  globalThis.fetch = () => {
    requestCount += 1;
    return registryRequest.promise;
  };

  const startupRequest = nodesStoreModule.useNodesStore.getState().fetchNodes();
  const graphBuilderRequest = nodesStoreModule.useNodesStore.getState().fetchNodes();
  assert.equal(requestCount, 1);

  registryRequest.resolve(
    jsonResponse({
      instance: 'startup-instance',
      nodes: {
        'modules.Test.Generate': {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          label: 'Generate',
          category: 'Test',
          params: {},
        },
      },
    }),
  );
  await Promise.all([startupRequest, graphBuilderRequest]);

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.nodes.status, 'success');
  assert.equal(state.instance, 'startup-instance');
  assert.ok(state.nodesRegistry['modules.Test.Generate']);
});

test('parallel discovery keeps loading active until every endpoint settles', async () => {
  const calls = new Map();
  globalThis.fetch = (url) => {
    const call = deferred();
    calls.set(String(url).includes('runtime/status') ? 'runtime' : 'localModels', call);
    return call.promise;
  };

  const runtime = nodesStoreModule.useNodesStore.getState().fetchRuntimeStatus();
  const localModels = nodesStoreModule.useNodesStore.getState().fetchLocalModels();
  calls.get('runtime').resolve(jsonResponse({ ready: true, packages: {} }));
  await runtime;
  assert.equal(nodesStoreModule.useNodesStore.getState().isLoading, true);
  calls.get('localModels').resolve(jsonResponse([{ name: 'local-model' }]));
  await localModels;
  assert.equal(nodesStoreModule.useNodesStore.getState().isLoading, false);
});

test('runtime discovery normalizes legacy and managed runtime payloads', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      ready: true,
      packages: {
        torch: {
          version: '2.test',
          cuda_available: true,
          cuda_device_name: 'Legacy CUDA',
          cuda_device_total_memory: 16 * 1024 ** 3,
          cuda_memory_free_bytes: 12 * 1024 ** 3,
        },
      },
    });
  await nodesStoreModule.useNodesStore.getState().fetchRuntimeStatus();

  let status = nodesStoreModule.useNodesStore.getState().runtimeStatus;
  assert.equal(status.ready, true);
  assert.equal(status.runtimeEnvironment.profileVerified, false);
  assert.equal(status.runtimeEnvironment.executionReady, true);
  assert.equal(status.runtimeEnvironment.defaultDevice, 'cuda:0');
  assert.deepEqual(
    status.runtimeEnvironment.devices.map(({ backend, device }) => ({ backend, device })),
    [
      { backend: 'cuda', device: 'cuda:0' },
      { backend: 'cpu', device: 'cpu:0' },
    ],
  );

  globalThis.fetch = async () =>
    jsonResponse({
      ready: true,
      packages: { torch: { version: '2.9.1+rocm7.2', cuda_available: true } },
      hardware: {
        schema_version: 1,
        default_device: 'cuda:0',
        devices: [
          {
            type: 'cuda',
            device: 'cuda:0',
            name: 'AMD Radeon',
            vram_total: 16 * 1024 ** 3,
            vram_free: 10 * 1024 ** 3,
          },
          { type: 'cpu', device: 'cpu:0', name: 'CPU' },
        ],
      },
      runtime_profile: {
        requested: 'amd-rocm-linux',
        installed: 'amd-rocm-linux',
        status: 'setup-required',
        execution_ready: false,
        support_tier: 'experimental',
        repair_command: 'python -m modiff.install --accelerator amd --repair',
        issues: [null, { message: 42 }, { code: 'reboot-required', severity: 'warning', message: 'Restart the host.' }],
        installation: {
          status: 'blocked',
          current_phase: 'system-preparation',
          completed_phases: ['detect', 42],
          reboot_required: true,
          resume_command: './install.sh --resume',
          steps: [
            'invalid',
            {
              id: 'gpu-groups',
              title: 'Add GPU groups',
              phase: 'system-preparation',
              status: 'pending',
              requires_admin: true,
              requires_reboot: true,
              command: 'sudo usermod -a -G video,render "$USER"',
            },
          ],
        },
      },
    });
  await nodesStoreModule.useNodesStore.getState().fetchRuntimeStatus();

  status = nodesStoreModule.useNodesStore.getState().runtimeStatus;
  const environment = status.runtimeEnvironment;
  assert.equal(environment.profileVerified, true);
  assert.equal(environment.executionReady, false);
  assert.equal(environment.supportTier, 'experimental');
  assert.equal(environment.devices[0].backend, 'rocm');
  assert.equal(environment.devices[0].vendor, 'amd');
  assert.equal(environment.devices[0].memoryTotal, 16 * 1024 ** 3);
  assert.deepEqual(environment.issues, [
    { code: 'reboot-required', severity: 'warning', message: 'Restart the host.' },
  ]);
  assert.equal(environment.installation.status, 'blocked');
  assert.deepEqual(environment.installation.completedPhases, ['detect']);
  assert.equal(environment.installation.steps.length, 1);
  assert.equal(environment.installation.steps[0].requiresAdmin, true);
  assert.equal(environment.installation.resumeCommand, './install.sh --resume');
});

test('runtime fingerprint changes invalidate every cached Auto plan', async () => {
  const cachedPlan = { status: 'ready', checkedAt: 1 };
  studioStoreModule.useStudioStore.setState({
    autoResourcePlan: cachedPlan,
    autoResourcePlans: { cached: cachedPlan },
  });
  nodesStoreModule.useNodesStore.setState({
    runtimeStatus: {
      ready: true,
      runtime_fingerprint: 'sha256:before',
      runtimeEnvironment: {
        schemaVersion: 1,
        profileVerified: false,
        executionReady: true,
        requestedProfile: null,
        installedProfile: null,
        status: 'unverified',
        supportTier: 'unverified',
        repairCommand: null,
        issues: [],
        installation: null,
        defaultDevice: 'cpu:0',
        devices: [],
      },
    },
  });
  globalThis.fetch = async () =>
    jsonResponse({
      ready: true,
      runtime_fingerprint: 'sha256:after',
      packages: {},
    });

  await nodesStoreModule.useNodesStore.getState().fetchRuntimeStatus();

  assert.equal(studioStoreModule.useStudioStore.getState().autoResourcePlan, null);
  assert.deepEqual(studioStoreModule.useStudioStore.getState().autoResourcePlans, {});
});

test('one discovery failure does not suppress successful sibling endpoints', async () => {
  globalThis.fetch = async (url) =>
    String(url).includes('hf_cache')
      ? jsonResponse({ message: 'Cache scan failed' }, 500)
      : jsonResponse([{ name: 'local-model' }]);

  await Promise.all([
    nodesStoreModule.useNodesStore.getState().fetchHfCache(),
    nodesStoreModule.useNodesStore.getState().fetchLocalModels(),
  ]);

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.hfCache.status, 'error');
  assert.equal(state.discoveryRequests.hfCache.error, 'Cache scan failed');
  assert.equal(state.discoveryRequests.localModels.status, 'success');
  assert.deepEqual(state.localModels, [{ name: 'local-model' }]);
  assert.equal(state.error, null);
});

test('an older backend without optional-runtime status keeps critical discovery usable', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    requests.push(path);
    if (path.endsWith('/nodes')) return jsonResponse({ instance: 'legacy', nodes: {} });
    if (path.includes('/runtime/optional-runtimes')) return jsonResponse({ message: 'Not found' }, 404);
    if (path.includes('/runtime/status')) return jsonResponse({ ready: true, packages: {} });
    if (path.includes('/model_cache/diagnostics')) return jsonResponse({ locations: [] });
    if (path.includes('/model_capabilities')) return jsonResponse({ schemaVersion: 2, capabilities: [] });
    if (path.includes('/custom_modules')) return jsonResponse({ modules: [] });
    return jsonResponse([]);
  };

  await nodesStoreModule.useNodesStore.getState().fetchRegistry();

  const state = nodesStoreModule.useNodesStore.getState();
  for (const key of ['nodes', 'runtime', 'hfCache', 'localModels', 'modelCache', 'capabilities']) {
    assert.equal(state.discoveryRequests[key].status, 'success', key);
  }
  assert.equal(state.discoveryRequests.optionalRuntimes.status, 'error');
  assert.equal(state.optionalRuntimeCatalog, null);
  assert.ok(
    requests.some((request) => request.includes('/hf_cache?compact=1&refresh=false')),
    'startup must consume the backend index instead of forcing a second Hub cache scan',
  );
  assert.ok(requests.some((request) => request.includes('/local_models?refresh=false')));
  assert.ok(requests.some((request) => request.includes('/model_cache/diagnostics?refresh=false')));
});

test('invalid node registry responses report an error and a later retry recovers', async () => {
  globalThis.fetch = async () => jsonResponse({ instance: 'broken', nodes: [] });
  await nodesStoreModule.useNodesStore.getState().fetchNodes();
  assert.equal(nodesStoreModule.useNodesStore.getState().discoveryRequests.nodes.status, 'error');
  assert.match(nodesStoreModule.useNodesStore.getState().error, /nodes object/);

  globalThis.fetch = async () =>
    jsonResponse({
      instance: 'recovered',
      nodes: {
        'modules.Test.Generate': {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          label: 'Generate',
          category: 'Test',
          params: {},
        },
      },
    });
  await nodesStoreModule.useNodesStore.getState().fetchNodes();

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.nodes.status, 'success');
  assert.equal(state.error, null);
  assert.equal(state.instance, 'recovered');
  assert.ok(state.nodesRegistry['modules.Test.Generate']);
});

test('custom-module discovery validates entries and recovers without sticky global errors', async () => {
  globalThis.fetch = async () => jsonResponse({ modules: [{ name: 'missing-module-key' }] });
  await nodesStoreModule.useNodesStore.getState().fetchCustomModules();
  let state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.customModules.status, 'error');
  assert.match(state.customModuleError, /invalid custom extension record/);
  assert.equal(state.error, null);

  globalThis.fetch = async () => jsonResponse({ modules: [customModule('recovered')] });
  await nodesStoreModule.useNodesStore.getState().fetchCustomModules();
  state = nodesStoreModule.useNodesStore.getState();
  assert.equal(state.discoveryRequests.customModules.status, 'success');
  assert.equal(state.customModuleError, null);
  assert.equal(state.customModules[0].name, 'recovered');
});

test('custom-module mutations use normalized errors and never erase the last valid list on failure', async () => {
  const retained = customModule('retained');
  nodesStoreModule.useNodesStore.setState({ customModules: [retained] });
  globalThis.fetch = async () => jsonResponse({ error: true, message: 'Source is not trusted.' }, 403);

  await assert.rejects(
    nodesStoreModule.useNodesStore.getState().installCustomModule({
      kind: 'git',
      source: 'https://example.invalid/module.git',
      name: 'Example',
      revision: 'a'.repeat(40),
    }),
    (error) => error.kind === 'http' && error.status === 403 && error.message === 'Source is not trusted.',
  );

  const state = nodesStoreModule.useNodesStore.getState();
  assert.deepEqual(state.customModules, [retained]);
  assert.equal(state.customModuleError, 'Source is not trusted.');
});

test('successful custom-module mutations validate the payload and refresh the node registry', async () => {
  const installed = customModule('installed');
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/custom_modules/install')) {
      return jsonResponse({ error: false, modules: [installed], instance: 'modules-v2' });
    }
    if (String(url).endsWith('/custom_modules')) return jsonResponse({ modules: [installed] });
    return jsonResponse({ nodes: {}, instance: 'nodes-v2' });
  };

  await nodesStoreModule.useNodesStore.getState().installCustomModule({
    kind: 'git',
    source: 'https://example.invalid/installed.git',
    name: 'installed',
    revision: 'a'.repeat(40),
  });

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    kind: 'git',
    source: 'https://example.invalid/installed.git',
    name: 'installed',
    revision: 'a'.repeat(40),
  });
  assert.match(calls[1].url, /\/nodes$/);
  assert.equal(state.customModules[0].name, 'installed');
  assert.equal(state.instance, 'nodes-v2');
  assert.equal(state.customModuleError, null);
});

test('model-install failures use the typed HTTP contract and update progress once', async () => {
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return jsonResponse(
      { error: 'Access denied for gated/model.', code: 'huggingface_access_required', repo_id: 'gated/model' },
      403,
    );
  };

  await assert.rejects(
    nodesStoreModule.useNodesStore.getState().installHfModel('gated/model', null, {
      revision: '0123456789abcdef0123456789abcdef01234567',
      files: ['weights/model.safetensors'],
    }),
    (error) => {
      assert.equal(error.kind, 'http');
      assert.equal(error.status, 403);
      assert.equal(error.message, 'Access denied for gated/model.');
      return true;
    },
  );

  assert.match(request.url, /\/hf_download$/);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.init.body), {
    repo_id: 'gated/model',
    revision: '0123456789abcdef0123456789abcdef01234567',
    files: ['weights/model.safetensors'],
  });

  const progress = nodesStoreModule.useNodesStore.getState().hfDownloadProgress['gated/model'];
  assert.equal(progress.status, 'error');
  assert.equal(progress.error, 'Access denied for gated/model.');
  assert.equal(progress.error_code, 'huggingface_access_required');
});

test('model-install access failures infer the stable code from legacy error text', async () => {
  globalThis.fetch = async () =>
    jsonResponse(
      {
        error: '403 gated repo: this account is not authorized. Accept the license and configure a token.',
        repo_id: 'legacy/gated-model',
      },
      403,
    );

  await assert.rejects(
    nodesStoreModule.useNodesStore.getState().installHfModel('legacy/gated-model'),
    (error) => error.kind === 'http' && error.status === 403,
  );

  const progress = nodesStoreModule.useNodesStore.getState().hfDownloadProgress['legacy/gated-model'];
  assert.equal(progress.status, 'error');
  assert.equal(progress.error_code, 'huggingface_access_required');
});

test('an interrupted model-install request recovers from the supervisor download status', async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/hf_download')) throw new TypeError('Failed to fetch');
    if (String(url).endsWith('/hf_download/status')) {
      return jsonResponse({
        error: false,
        downloads: [
          {
            repo_id: 'public/large-model',
            revision: '0123456789abcdef0123456789abcdef01234567',
            task_id: 'download-1',
            status: 'downloading',
            progress: 0.64,
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await nodesStoreModule.useNodesStore.getState().installHfModel('public/large-model', null, {
    revision: '0123456789abcdef0123456789abcdef01234567',
    files: ['transformer/model.safetensors'],
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/hf_download$/);
  assert.match(calls[1].url, /\/hf_download\/status$/);
  assert.deepEqual(result, {
    error: false,
    repo_id: 'public/large-model',
    task_id: 'download-1',
  });
  assert.equal(
    nodesStoreModule.useNodesStore.getState().hfDownloadProgress['public/large-model'].status,
    'downloading',
  );
});

test('download reconciliation clears stale active installs and refreshes model indexes', async () => {
  let refreshCount = 0;
  nodesStoreModule.useNodesStore.setState({
    hfDownloadProgress: {
      'public/completed-model': {
        repo_id: 'public/completed-model',
        task_id: 'download-complete-offline',
        status: 'downloading',
        progress: 0.99,
      },
      'public/retained-error': {
        repo_id: 'public/retained-error',
        status: 'error',
        error: 'Retain terminal history.',
      },
    },
    refreshModelIndexes: async (refresh) => {
      assert.equal(refresh, true);
      refreshCount += 1;
    },
  });
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/hf_download\/status$/);
    return jsonResponse({ error: false, downloads: [] });
  };

  await nodesStoreModule.useNodesStore.getState().reconcileHfDownloadProgress();

  const progress = nodesStoreModule.useNodesStore.getState().hfDownloadProgress;
  assert.equal(progress['public/completed-model'], undefined);
  assert.equal(progress['public/retained-error'].status, 'error');
  assert.equal(refreshCount, 1);
});

function parseOperationPayload(payload) {
  return {
    ...nodesStoreModule.parseStudioModelCapabilities(payload),
    operationContracts: operationContractsModule.parseOperationContracts(
      payload.operationContracts,
      payload.operationContractSchemaVersion,
    ),
  };
}

function operationCapabilityPayload() {
  return {
    schemaVersion: 2,
    capabilities: [],
    operationContractSchemaVersion: 2,
    operationContracts: [
      {
        pipelineClass: 'FutureModularPipeline',
        task: null,
        operationId: 'diffusion.denoise',
        nodeKey: 'modules.ModularDiffusers.Denoise',
        nodeType: 'denoise',
        blockName: 'denoise',
        decomposition: 'block',
        support: 'declared',
        ports: [
          {
            name: 'embeddings',
            semanticName: 'embeddings',
            direction: 'input',
            roles: ['value'],
            types: ['embeddings'],
            required: true,
            hidden: false,
          },
        ],
      },
    ],
  };
}

test('operation discovery accepts new backend pipelines without a client model-family branch', () => {
  const payload = operationCapabilityPayload();
  const parsed = parseOperationPayload(payload);
  assert.deepEqual(parsed.operationContracts, payload.operationContracts);
  assert.deepEqual(parsed.capabilities, []);
  assert.deepEqual(parseOperationPayload({ capabilities: [] }).operationContracts, []);
});

test('operation discovery rejects malformed, ambiguous and unsupported declarations', () => {
  const mutations = [
    (p) => {
      p.operationContractSchemaVersion = 3;
    },
    (p) => {
      delete p.operationContractSchemaVersion;
    },
    (p) => {
      p.operationContracts = null;
    },
    (p) => {
      p.operationContracts.push(structuredClone(p.operationContracts[0]));
    },
    (p) => {
      p.operationContracts[0].support = 'runnable';
    },
    (p) => {
      p.operationContracts[0].pipelineClass = '__proto__';
    },
    (p) => {
      p.operationContracts[0].pipelineClass = 'Pipeline\n';
    },
    (p) => {
      p.operationContracts[0].nodeKey = 'https://example.com/node';
    },
    (p) => {
      p.operationContracts[0].blockName = null;
    },
    (p) => {
      p.operationContracts[0].unknown = true;
    },
    (p) => {
      p.operationContracts[0].ports[0].types = [];
    },
    (p) => {
      p.operationContracts[0].ports[0].types = ['embeddings', 'embeddings'];
    },
    (p) => {
      p.operationContracts[0].ports[0].direction = 'output';
    },
    (p) => {
      p.operationContracts[0].ports[0].required = 'true';
    },
    (p) => {
      p.operationContracts[0].ports.push(structuredClone(p.operationContracts[0].ports[0]));
    },
  ];
  for (const mutate of mutations) {
    const payload = operationCapabilityPayload();
    mutate(payload);
    assert.throws(() => parseOperationPayload(payload), /operation contract/i);
  }
});

test('capability refresh replaces operation declarations and clears them on invalid responses', async () => {
  const payload = operationCapabilityPayload();
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  assert.deepEqual(nodesStoreModule.useNodesStore.getState().operationContracts, payload.operationContracts);
  payload.operationContracts[0].support = 'runnable';
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  assert.deepEqual(nodesStoreModule.useNodesStore.getState().operationContracts, []);
  assert.equal(nodesStoreModule.useNodesStore.getState().discoveryRequests.capabilities.status, 'error');
});

test('operation ports preserve combined bundle roles and independent input/output names', () => {
  const payload = operationCapabilityPayload();
  const contract = payload.operationContracts[0];
  contract.ports[0].roles = ['value', 'component'];
  contract.ports.push({
    ...structuredClone(contract.ports[0]),
    direction: 'output',
    roles: ['value'],
    required: false,
  });
  const parsed = parseOperationPayload(payload).operationContracts[0];
  assert.deepEqual(parsed.ports, contract.ports);
  parsed.ports[0].roles.push('value');
  assert.deepEqual(contract.ports[0].roles, ['value', 'component']);
  contract.ports[0].roles = ['component', 'component'];
  assert.throws(() => parseOperationPayload(payload), /operation contract/i);
});

test('operation contract size limits apply to every discovery boundary', () => {
  for (const mutate of [
    (p) => {
      p.operationContracts = Array(4097).fill(p.operationContracts[0]);
    },
    (p) => {
      p.operationContracts[0].ports = Array(129).fill(p.operationContracts[0].ports[0]);
    },
    (p) => {
      p.operationContracts[0].ports[0].types = Array(17).fill('int');
    },
    (p) => {
      p.operationContracts[0].pipelineClass = 'P'.repeat(129);
    },
  ]) {
    const payload = operationCapabilityPayload();
    mutate(payload);
    assert.throws(() => parseOperationPayload(payload), /operation contract/i);
  }
});

test('operation discovery normalizes the previous stage-only schema', () => {
  const payload = operationCapabilityPayload();
  const expected = structuredClone(payload.operationContracts);
  payload.operationContractSchemaVersion = 1;
  delete payload.operationContracts[0].task;
  delete payload.operationContracts[0].ports[0].hidden;
  assert.deepEqual(parseOperationPayload(payload).operationContracts, expected);
});

test('task-scoped pipeline operations retain handles and hidden inputs without declaring stages', () => {
  const payload = operationCapabilityPayload();
  const base = {
    pipelineClass: 'FutureImagePipeline',
    task: 'text_to_image',
    operationId: 'diffusion.load_models',
    nodeKey: 'modules.DiffusersImage.LoadPipeline',
    nodeType: 'loader',
    blockName: null,
    decomposition: 'loader',
    support: 'declared',
    ports: [
      {
        name: 'pipeline',
        semanticName: 'pipeline',
        direction: 'output',
        roles: ['pipeline'],
        types: ['image_diffusion_pipeline'],
        required: false,
        hidden: false,
      },
    ],
  };
  payload.operationContracts = [
    base,
    { ...structuredClone(base), task: 'edit_image' },
    {
      ...structuredClone(base),
      operationId: 'diffusion.generate_image',
      nodeType: 'pipeline',
      decomposition: 'pipeline',
      nodeKey: 'modules.DiffusersImage.Generate',
      ports: [{ ...base.ports[0], direction: 'input', required: true, hidden: true }],
    },
  ];
  assert.deepEqual(parseOperationPayload(payload).operationContracts, payload.operationContracts);
  for (const mutate of [
    (p) => {
      p.task = null;
    },
    (p) => {
      p.task = '__proto__';
    },
    (p) => {
      p.nodeType = 'denoise';
    },
    (p) => {
      p.blockName = 'denoise';
    },
    (p) => {
      p.ports[0].hidden = 'false';
    },
    (p) => {
      p.ports[0].roles = ['pipeline', 'value'];
    },
    (p) => {
      p.ports[0].required = true;
    },
  ]) {
    const invalid = structuredClone(payload);
    mutate(invalid.operationContracts[0]);
    assert.throws(() => parseOperationPayload(invalid), /operation contract/i);
  }
  payload.operationContractSchemaVersion = 1;
  assert.throws(() => parseOperationPayload(payload), /operation contract/i);
});

function boundOperationPayload() {
  const payload = operationCapabilityPayload();
  payload.operationContractSchemaVersion = 3;
  const op = payload.operationContracts[0];
  Object.assign(op, {
    task: 'text_to_image',
    workflowId: 'text2image',
    binding: { pipelineClass: op.pipelineClass, values: { pipeline_class: op.pipelineClass } },
  });
  op.ports[0].semantics = {
    kind: 'conditioning',
    scope: op.pipelineClass,
    state: null,
    owner: 'same_loader',
    members: [],
  };
  payload.pipelineSupportSchemaVersion = 1;
  payload.pipelineSupport = [
    {
      pipelineClass: op.pipelineClass,
      coverage: 'local-adapter',
      reason: 'Existing adapter',
      equivalentTo: [],
      upstreamTasks: [],
      tasks: [
        {
          task: op.task,
          execution: 'declared',
          decomposition: 'stages',
          operationIds: [op.operationId],
          executionProfileIds: [],
          dependencies: 'unknown',
          runtimeRequirements: [],
        },
      ],
    },
  ];
  return payload;
}

test('operation capability refresh stores support atomically and rejects stale references', async () => {
  const payload = boundOperationPayload();
  globalThis.fetch = async () => jsonResponse(payload);
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  assert.deepEqual(nodesStoreModule.useNodesStore.getState().pipelineSupport, payload.pipelineSupport);
  payload.pipelineSupport[0].tasks[0].operationIds = ['diffusion.absent'];
  await nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  assert.deepEqual(nodesStoreModule.useNodesStore.getState().pipelineSupport, []);
  assert.deepEqual(nodesStoreModule.useNodesStore.getState().operationContracts, []);
});

test('operation resolution uses the exact backend binding without a template or install request', async () => {
  const op = boundOperationPayload().operationContracts[0];
  const node = {
    module: 'modules.ModularDiffusers',
    action: 'Denoise',
    type: 'custom',
    label: 'Denoise',
    category: 'Diffusion',
    params: { pipeline_class: { type: 'string', value: op.pipelineClass } },
  };
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.match(String(url), /\/operations\/resolve$/);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), {
      pipelineClass: op.pipelineClass,
      task: 'text_to_image',
      operationId: op.operationId,
    });
    return jsonResponse({ schemaVersion: 1, operation: op, node });
  };
  assert.deepEqual(await nodesStoreModule.useNodesStore.getState().resolveOperation(op), node);
  assert.equal(calls, 1);
  node.params.pipeline_class.value = 'WrongPipeline';
  await assert.rejects(nodesStoreModule.useNodesStore.getState().resolveOperation(op), /binding/i);
  node.params.pipeline_class.value = op.pipelineClass;
  node.action = 'OtherAction';
  await assert.rejects(nodesStoreModule.useNodesStore.getState().resolveOperation(op), /binding/i);
  op.task = 'different_task';
  await assert.rejects(
    nodesStoreModule.useNodesStore.getState().resolveOperation({ ...op, task: 'text_to_image' }),
    /selection/i,
  );
});

test('extension approval parser rejects malformed identity, dependency and preview data', () => {
  const valid = customModule('Example');
  assert.equal(extensionsModule.parseExtensionInfo(valid).name, 'Example');
  for (const invalid of [
    { ...valid, moduleKey: 'modules.Text.ProcessText' },
    { ...valid, codeHash: 'mutable' },
    { ...valid, revision: {} },
    { ...valid, kind: [] },
    { ...valid, codeHash: null },
    { ...valid, status: 'disabled' },
    { ...valid, dependencies: [{ requirement: 'foo', status: 'installed' }] },
    { ...valid, files: [{ name: 'main.py', bytes: -1, sha256: 'a'.repeat(64) }] },
    { ...valid, preview: { kind: 'python', diagnostics: [], nodes: { Echo: { label: 'Echo', params: [] } } } },
  ])
    assert.throws(() => extensionsModule.parseExtensionInfo(invalid));
});

test('enable sends the reviewed code hash and preserves boolean consent', async () => {
  let submitted;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/enable')) submitted = JSON.parse(init.body);
    return jsonResponse(
      String(url).endsWith('/nodes') ? { nodes: {}, instance: 'enabled' } : { modules: [customModule('Example')] },
    );
  };
  await nodesStoreModule.useNodesStore.getState().setCustomModuleEnabled('Example', true, 'sha256:' + 'b'.repeat(64));
  assert.deepEqual(submitted, { codeHash: 'sha256:' + 'b'.repeat(64), consent: true });
});
