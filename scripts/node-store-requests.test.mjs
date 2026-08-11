import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let nodesStoreModule;
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
    server: { middlewareMode: true },
    appType: 'custom',
  });
  requestModule = await server.ssrLoadModule('/src/utils/requestJson.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  nodesStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
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
        specDigest: `sha256:${'1'.repeat(64)}`,
        contractState: 'candidate_unqualified',
        cutoverReady: false,
        installActionAvailable: false,
        activationAvailable: false,
        status: 'missing',
        overlayStatus: 'missing',
      },
    ],
    overlay: { processLoadStatus: 'base' },
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

test('Studio execution specifications require an exact versioned capability contract', async () => {
  const spec = fluxExecutionSpec();
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
    assert.equal(issue?.blocking, true, 'the exact backend snake-case required contract must block Run');
  } finally {
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousFlow.nodes, edges: previousFlow.edges });
  }
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
    Array.from({ length: 129 }, (_, index) => ({ modelType: `FuturePipeline${index}`, modes: [] })),
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

test('a late malformed capability response cannot replace the newest valid contract', async () => {
  const calls = [];
  globalThis.fetch = () => {
    const call = deferred();
    calls.push(call);
    return call.promise;
  };
  const first = nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  const second = nodesStoreModule.useNodesStore.getState().fetchStudioModelCapabilities();
  calls[1].resolve(
    jsonResponse({
      schemaVersion: 2,
      capabilities: [
        { modelType: 'QwenImageModularPipeline', modes: ['text_to_image'], runnableModes: ['text_to_image'] },
      ],
    }),
  );
  await second;
  calls[0].resolve(jsonResponse({ schemaVersion: 2, capabilities: 'malformed' }));
  await first;
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
      overlay: { processLoadStatus: 'active' },
    }),
  );
  assert.equal(optionalRuntimesModule.optionalRuntimeBlockState(required, activeCatalog), null);
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
          overlay: { processLoadStatus: 'active' },
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
    { ...optionalRuntimeCatalog().profiles[0], installActionAvailable: 'yes' },
    { ...optionalRuntimeCatalog().profiles[0], activationAvailable: undefined },
  ]) {
    assert.throws(
      () => optionalRuntimesModule.parseOptionalRuntimeCatalog(optionalRuntimeCatalog({ profiles: [profile] })),
      /runtime contract/i,
    );
  }
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
  globalThis.fetch = async (url) => {
    const path = String(url);
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
  assert.match(state.customModuleError, /entry 1 is invalid/);
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
    nodesStoreModule.useNodesStore.getState().installCustomModule('https://example.invalid/module.git'),
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
    return jsonResponse({ nodes: {}, instance: 'nodes-v2' });
  };

  await nodesStoreModule.useNodesStore
    .getState()
    .installCustomModule('https://example.invalid/installed.git', 'installed');

  const state = nodesStoreModule.useNodesStore.getState();
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    source: 'https://example.invalid/installed.git',
    name: 'installed',
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
    nodesStoreModule.useNodesStore
      .getState()
      .installHfModel('gated/model', null, { files: ['weights/model.safetensors'] }),
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
