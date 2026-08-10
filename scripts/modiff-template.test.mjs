import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { normalizePortableWorkflowNodeOffload, workflowNodeDeviceOffloadError } from './workflow-library-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let templatesModule;
let browserModule;
let readinessModule;
let profilesModule;
let resourcePlannerModule;
let autoResourceModule;
let runReadinessModule;
let runMetadataModule;
let outputContractsModule;
let nodesStoreModule;
let studioStoreModule;
let templateQualityModule;
let templateAssetsModule;
let modelCacheModule;
let templateExactnessModule;
let templateInputsModule;
let workflowInferenceModule;
let startupRequestModule;
let flowStoreModule;
let runtimeOptionsModule;
let deviceRebaseModule;
let modelUsagePoliciesModule;
let modelCapabilitiesModule;

before(async () => {
  globalThis.window = {
    location: {
      origin: 'http://127.0.0.1:5191',
    },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  templatesModule = await server.ssrLoadModule('/src/studio/templates.ts');
  browserModule = await server.ssrLoadModule('/src/studio/templateBrowser.ts');
  readinessModule = await server.ssrLoadModule('/src/studio/templateReadiness.ts');
  profilesModule = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  resourcePlannerModule = await server.ssrLoadModule('/src/studio/resourcePlanner.ts');
  autoResourceModule = await server.ssrLoadModule('/src/studio/autoResource.ts');
  runReadinessModule = await server.ssrLoadModule('/src/studio/runReadiness.ts');
  runMetadataModule = await server.ssrLoadModule('/src/studio/runPreparation.ts');
  outputContractsModule = await server.ssrLoadModule('/src/studio/outputContracts.ts');
  nodesStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  templateQualityModule = await server.ssrLoadModule('/src/studio/templateQuality.ts');
  templateAssetsModule = await server.ssrLoadModule('/src/studio/templateAssets.ts');
  modelCacheModule = await server.ssrLoadModule('/src/studio/modelCache.ts');
  templateExactnessModule = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  templateInputsModule = await server.ssrLoadModule('/src/studio/templateInputs.ts');
  workflowInferenceModule = await server.ssrLoadModule('/src/studio/workflowInference.ts');
  startupRequestModule = await server.ssrLoadModule('/src/studio/startupRequest.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  runtimeOptionsModule = await server.ssrLoadModule('/src/studio/runtimeOptions.ts');
  deviceRebaseModule = await server.ssrLoadModule('/src/studio/deviceRebase.ts');
  modelUsagePoliciesModule = await server.ssrLoadModule('/src/studio/modelUsagePolicies.ts');
  modelCapabilitiesModule = await server.ssrLoadModule('/src/studio/modelCapabilities.ts');
});

test('schema-v2 capability modes are exact while legacy mode metadata can fall back', () => {
  const explicitNoModes = {
    modelType: 'FluxDepthPipeline',
    modes: ['control_image'],
    runnableModes: [],
  };
  const exact = modelCapabilitiesModule.exactStudioCapabilitySupport(
    [explicitNoModes],
    true,
    'FluxDepthPipeline',
    'control_image',
  );

  assert.equal(exact.status, 'unsupported');
  assert.equal(exact.reason, 'mode_not_advertised');
  assert.deepEqual(exact.modes, []);
  assert.equal(
    modelCapabilitiesModule.exactStudioCapabilityUnsupportedMessage('FluxDepthPipeline', 'control_image', exact),
    'FLUX.1-Depth-dev does not support Control image on the connected backend.',
  );

  const legacy = { modelType: 'FluxDepthPipeline', modes: ['control_image'] };
  assert.deepEqual(modelCapabilitiesModule.advertisedStudioModes(legacy), ['control_image']);
  assert.equal(
    modelCapabilitiesModule.exactStudioCapabilitySupport([legacy], false, 'FluxDepthPipeline', 'control_image').status,
    'unknown',
  );
});

test('the managed Qwen ControlNet requirement carries its reviewed immutable commit', () => {
  assert.equal(profilesModule.QWEN_CONTROLNET_REQUIREMENT.repo, 'InstantX/Qwen-Image-ControlNet-Union');
  assert.equal(profilesModule.QWEN_CONTROLNET_REQUIREMENT.revision, 'b13036f066d6dee7c20513e263d3d673055e9de8');
});

test('run readiness blocks a model and task pair omitted by authoritative backend capabilities', () => {
  const previousCapabilities = nodesStoreModule.useNodesStore.getState().studioModelCapabilities;
  const previousAuthoritative = nodesStoreModule.useNodesStore.getState().studioModelCapabilitiesAuthoritative;
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;

  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image', 'control_image'],
          runnableModes: ['text_to_image'],
        },
      ],
      studioModelCapabilitiesAuthoritative: true,
    });
    studioStoreModule.useStudioStore.setState({
      form: {
        ...previousForm,
        mode: 'control_image',
        modelType: 'QwenImageModularPipeline',
        resourceMode: 'expert',
      },
      graphBinding: null,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });

    const issue = runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'backend_mode_unsupported');
    assert.equal(issue?.blocking, true);
    assert.equal(issue?.message, 'Qwen-Image-2512 does not support Control image on the connected backend.');
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousCapabilities,
      studioModelCapabilitiesAuthoritative: previousAuthoritative,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

test('an imported stale Qwen Edit Plus inpaint form stays blocked by backend capability truth', () => {
  const previousCapabilities = nodesStoreModule.useNodesStore.getState().studioModelCapabilities;
  const previousAuthoritative = nodesStoreModule.useNodesStore.getState().studioModelCapabilitiesAuthoritative;
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;

  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [
        {
          modelType: 'QwenImageEditPlusModularPipeline',
          // Preserve a stale legacy metadata claim to prove schema-v2
          // runnableModes remains authoritative for an imported form.
          modes: ['edit_image', 'multi_image_reference_edit', 'inpaint'],
          runnableModes: ['edit_image', 'multi_image_reference_edit'],
        },
      ],
      studioModelCapabilitiesAuthoritative: true,
    });
    studioStoreModule.useStudioStore.setState({
      form: {
        ...previousForm,
        mode: 'inpaint',
        modelType: 'QwenImageEditPlusModularPipeline',
        resourceMode: 'auto',
      },
      graphBinding: null,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });

    const issue = runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'backend_mode_unsupported');
    assert.equal(issue?.blocking, true);
    assert.equal(issue?.message, 'Qwen-Image-Edit-2511 does not support Inpaint on the connected backend.');
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousCapabilities,
      studioModelCapabilitiesAuthoritative: previousAuthoritative,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

function optionalRequirement(overrides = {}) {
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

function qualifiedOptionalRuntimeCatalog() {
  return {
    schemaVersion: 1,
    processLoadStatus: 'active',
    profiles: [
      {
        id: 'huggingface-transformers-peft-5.14.1-0.20.0',
        label: 'Hugging Face Transformers + PEFT',
        specDigest: `sha256:${'1'.repeat(64)}`,
        contractState: 'qualified',
        cutoverReady: true,
        installActionAvailable: true,
        activationAvailable: true,
        status: 'present_unqualified',
        overlayStatus: 'active',
      },
    ],
  };
}

test('optional runtime readiness is exact-mode scoped and base delivery stays neutral', () => {
  const previousNodesState = nodesStoreModule.useNodesStore.getState();
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;
  const base = optionalRequirement();
  const required = optionalRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    executionProfileIds: ['qwen-image:control'],
    state: 'missing',
    reason: 'optional_runtime_missing',
  });
  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilitiesAuthoritative: true,
      optionalRuntimeCatalog: null,
      studioModelCapabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image', 'control_image'],
          runnableModes: ['text_to_image', 'control_image'],
          executionProfiles: [
            { id: 'qwen-image:t2i-direct', modes: ['text_to_image'], optionalRuntimeRequirement: base },
            { id: 'qwen-image:control', modes: ['control_image'], optionalRuntimeRequirement: required },
          ],
        },
      ],
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });
    studioStoreModule.useStudioStore.setState({
      form: { ...previousForm, modelType: 'QwenImageModularPipeline', mode: 'text_to_image', resourceMode: 'expert' },
      graphBinding: null,
    });
    let issue = runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'optional_runtime_required');
    assert.equal(issue, undefined, 'base-delivered exact mode must ignore missing overlay status');

    studioStoreModule.useStudioStore.setState({
      form: { ...previousForm, modelType: 'QwenImageModularPipeline', mode: 'control_image', resourceMode: 'expert' },
    });
    issue = runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'optional_runtime_required');
    assert.equal(issue?.blocking, true);
    assert.equal(issue?.action, 'open_setup');
    assert.match(issue?.message ?? '', /reviewed optional runtime/i);
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousNodesState.studioModelCapabilities,
      studioModelCapabilitiesAuthoritative: previousNodesState.studioModelCapabilitiesAuthoritative,
      optionalRuntimeCatalog: previousNodesState.optionalRuntimeCatalog,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

test('a required runtime becomes ready only with the exact qualified active catalog', () => {
  const previousNodesState = nodesStoreModule.useNodesStore.getState();
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;
  const required = optionalRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    state: 'active',
    reason: 'optional_runtime_active',
  });
  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilitiesAuthoritative: true,
      optionalRuntimeCatalog: qualifiedOptionalRuntimeCatalog(),
      discoveryRequests: {
        ...previousNodesState.discoveryRequests,
        capabilities: { status: 'success', error: null, requestId: 1 },
        optionalRuntimes: { status: 'success', error: null, requestId: 1 },
      },
      studioModelCapabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image'],
          runnableModes: ['text_to_image'],
          optionalRuntimeRequirement: required,
          executionProfiles: [
            { id: 'qwen-image:t2i-direct', modes: ['text_to_image'], optionalRuntimeRequirement: required },
          ],
        },
      ],
    });
    studioStoreModule.useStudioStore.setState({
      form: { ...previousForm, modelType: 'QwenImageModularPipeline', mode: 'text_to_image', resourceMode: 'expert' },
      graphBinding: null,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });

    const optionalIssue = () =>
      runReadinessModule
        .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
        .find((item) => item.code === 'optional_runtime_required');
    const setDiscovery = (key, status) => {
      const discoveryRequests = nodesStoreModule.useNodesStore.getState().discoveryRequests;
      nodesStoreModule.useNodesStore.setState({
        discoveryRequests: { ...discoveryRequests, [key]: { status, error: null, requestId: 2 } },
      });
    };
    assert.equal(optionalIssue(), undefined);
    const activeCapability = nodesStoreModule.useNodesStore.getState().studioModelCapabilities[0];
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [
        {
          ...activeCapability,
          executionProfiles: activeCapability.executionProfiles.map((profile) => ({
            ...profile,
            modes: ['control_image'],
          })),
        },
      ],
    });
    assert.equal(optionalIssue()?.blocking, true, 'present execution profiles require an exact selected-mode match');
    nodesStoreModule.useNodesStore.setState({ studioModelCapabilities: [activeCapability] });
    assert.equal(optionalIssue(), undefined);
    for (const key of ['capabilities', 'optionalRuntimes']) {
      for (const status of ['loading', 'error']) {
        setDiscovery(key, status);
        assert.equal(optionalIssue()?.blocking, true, `${key} ${status} must make retained runtime status stale`);
        setDiscovery(key, 'success');
        assert.equal(optionalIssue(), undefined);
      }
    }
    nodesStoreModule.useNodesStore.setState({ optionalRuntimeCatalog: null });
    assert.equal(optionalIssue()?.blocking, true, 'missing or stale status must restore the blocker');
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousNodesState.studioModelCapabilities,
      studioModelCapabilitiesAuthoritative: previousNodesState.studioModelCapabilitiesAuthoritative,
      optionalRuntimeCatalog: previousNodesState.optionalRuntimeCatalog,
      discoveryRequests: previousNodesState.discoveryRequests,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

test('Intel XPU is preferred over CPU while compatibility remains backend-owned', () => {
  const runtime = {
    packages: {
      torch: {
        xpu_available: true,
        xpu_devices: [
          {
            index: 0,
            name: 'Intel Arc Graphics',
            total_memory: 12 * 1024 ** 3,
            memory_free_bytes: 10 * 1024 ** 3,
            memory_kind: 'shared',
          },
        ],
      },
    },
  };
  assert.equal(runReadinessModule.getPreferredRuntimeDevice(runtime), 'xpu:0');
  assert.equal(runReadinessModule.runtimeDeviceIsAvailable(runtime, 'xpu:0'), true);
  const compatibility = autoResourceModule.autoResourceCompatibility({
    schemaVersion: 2,
    compatibility: {
      state: 'ready',
      severity: 'success',
      code: 'auto_recipe_ready',
      summary: 'Ready with local Auto recipe',
      detail: 'The backend qualified Intel XPU for this recipe.',
      action: null,
      source: 'backend_auto_planner',
    },
  });
  assert.equal(compatibility.state, 'ready');
  assert.match(compatibility.detail, /backend qualified Intel XPU/);
});

after(async () => {
  await server?.close();
});

test('template runtime estimates use only stable hardware-matched local history', () => {
  assert.equal(autoResourceModule.localRuntimeEstimate(null), null);
  assert.equal(
    autoResourceModule.localRuntimeEstimate({
      selectedCandidate: {
        id: 'unmeasured',
        successHistory: null,
      },
    }),
    null,
  );

  const measured = autoResourceModule.localRuntimeEstimate({
    selectedCandidate: {
      id: 'measured-here',
      successHistory: {
        successCount: 1,
        bestElapsedSeconds: 632.4,
        lastMeasurement: { elapsedSeconds: 632.4 },
      },
    },
  });
  assert.equal(measured.label, '~5 min–22 min locally');
  assert.equal(measured.observedSeconds, 632.4);
  assert.match(measured.title, /1 matching successful local run/);

  assert.equal(
    autoResourceModule.localRuntimeEstimate({
      selectedCandidate: {
        id: 'unstable-cold-warm-history',
        successHistory: {
          successCount: 2,
          bestElapsedSeconds: 30,
          lastMeasurement: { elapsedSeconds: 632.4 },
        },
      },
    }),
    null,
    'an astronomically wide local history must be hidden instead of presented as a prediction',
  );
});

test('template gallery manifest parser validates every entry and rejects unsafe asset paths', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'public', 'template-gallery', 'manifest.json'), 'utf8'));
  const parsed = templateExactnessModule.parseTemplateGalleryManifest(manifest);
  assert.equal(parsed.examples.length, manifest.examples.length);
  assert.throws(
    () => templateExactnessModule.parseTemplateGalleryManifest({ ...manifest, examples: [null] }),
    /example 1 is invalid/i,
  );
  assert.throws(
    () =>
      templateExactnessModule.parseTemplateGalleryManifest({
        ...manifest,
        examples: [{ ...manifest.examples[0], outputPath: '/template-gallery/../secret.json' }],
      }),
    /unsafe outputPath/i,
  );
  assert.throws(
    () =>
      templateExactnessModule.parseTemplateGalleryManifest({
        ...manifest,
        examples: [{ ...manifest.examples[0], templateId: 'unknown-template' }],
      }),
    /invalid or duplicate templateId/i,
  );
});

function runtimeStatus({ totalBytes = 24 * 1024 ** 3, freeBytes = 18 * 1024 ** 3 } = {}) {
  return {
    ready: true,
    packages: {
      torch: {
        available: true,
        cuda_available: true,
        cuda_device_count: 1,
        cuda_devices: [
          {
            index: 0,
            name: 'Mock CUDA',
            memory_total_bytes: totalBytes,
            memory_free_bytes: freeBytes,
          },
        ],
      },
    },
  };
}

function readinessContext({
  autoResourcePlan = {
    schemaVersion: 2,
    status: 'ready',
    readiness: 'ready',
    selectedCandidate: {
      id: 'unit-ready',
      loaderModule: 'modules.ModularDiffusers',
      loaderAction: 'ModelsLoader',
      executionPath: 'modular-diffusers',
      installed: true,
      proof: { status: 'declared_safe' },
    },
    candidates: [
      {
        id: 'unit-ready',
        loaderModule: 'modules.ModularDiffusers',
        loaderAction: 'ModelsLoader',
        executionPath: 'modular-diffusers',
        installed: true,
        proof: { status: 'declared_safe' },
      },
    ],
    compatibility: {
      state: 'ready',
      severity: 'success',
      code: 'auto_recipe_ready',
      summary: 'Ready with local Auto recipe',
      detail: 'Qualified by the backend test fixture.',
      action: null,
      source: 'backend_auto_planner',
    },
  },
  form,
  hfCache = [],
  modelIndexesRefreshing = false,
  nodesRegistry = {},
  runtime = runtimeStatus(),
} = {}) {
  return {
    form: form ?? profilesModule.DEFAULT_STUDIO_FORM,
    hfCache,
    localModels: [],
    modelCacheDiagnostics: { locations: [] },
    runtimeStatus: runtime,
    nodesRegistry,
    autoResourcePlan,
    modelIndexesRefreshing,
  };
}

function optionDescriptor(value, overrides = {}) {
  return {
    schemaVersion: 1,
    value,
    label: value,
    compatibility: 'compatible',
    availability: 'installed',
    installationState: 'installed',
    ...overrides,
  };
}

function canonicalModularTextToImageGraph() {
  const node = (id, module, action, params = {}) => ({
    id,
    type: 'custom',
    position: { x: id.length * 31, y: id.length * -17 },
    data: {
      type: 'custom',
      module,
      action,
      label: action,
      category: module,
      params,
    },
  });
  const nodes = [
    node('models', 'modules.ModularDiffusers', 'ModelsLoader', {
      model_type: { value: 'ZImageModularPipeline' },
      repo_id: { value: { source: 'hub', value: 'Tongyi-MAI/Z-Image-Turbo' } },
    }),
    node('prompt', 'modules.ModularDiffusers', 'EncodePrompt', {
      prompt: { value: 'A canonical imported prompt' },
    }),
    node('denoise', 'modules.ModularDiffusers', 'Denoise', {
      width: { value: 1024 },
      height: { value: 1024 },
      num_inference_steps: { value: 9 },
    }),
    node('decode', 'modules.ModularDiffusers', 'DecodeLatents'),
    node('preview', 'modules.Image', 'Preview'),
  ];
  const edge = (id, source, sourceHandle, target, targetHandle) => ({
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
  });
  return {
    nodes,
    edges: [
      edge('models-prompt', 'models', 'text_encoders', 'prompt', 'text_encoders'),
      edge('models-denoise-unet', 'models', 'unet_out', 'denoise', 'unet'),
      edge('models-decode', 'models', 'vae_out', 'decode', 'vae'),
      edge('models-denoise-scheduler', 'models', 'scheduler', 'denoise', 'scheduler'),
      edge('prompt-denoise', 'prompt', 'embeddings', 'denoise', 'embeddings'),
      edge('denoise-decode', 'denoise', 'latents', 'decode', 'latents'),
      edge('decode-preview', 'decode', 'images', 'preview', 'image'),
    ],
    viewport: { x: -140, y: 100, zoom: 0.73 },
  };
}

test('exact canonical modular imports are adopted as managed without rebuilding or moving them', () => {
  const graph = canonicalModularTextToImageGraph();
  const snapshot = workflowInferenceModule.workflowSnapshotFromGraph(
    graph,
    'smoothstep',
    profilesModule.DEFAULT_STUDIO_FORM,
  );

  assert.equal(snapshot.activeTemplateId, null);
  assert.equal(snapshot.studioForm.mode, 'text_to_image');
  assert.equal(snapshot.studioForm.modelType, 'ZImageModularPipeline');
  assert.deepEqual(
    snapshot.nodes.map((node) => node.position),
    graph.nodes.map((node) => node.position),
  );
  assert.deepEqual(snapshot.viewport, graph.viewport);
  assert.deepEqual(snapshot.studioGraphBinding?.nodes, {
    models: 'models',
    prompt: 'prompt',
    denoise: 'denoise',
    decode: 'decode',
    preview: 'preview',
  });
  assert.deepEqual(
    snapshot.studioGraphBinding?.managedNodeIds,
    graph.nodes.map((node) => node.id),
  );
  assert.deepEqual(
    snapshot.studioGraphBinding?.managedEdgeIds,
    graph.edges.map((edge) => edge.id),
  );
  assert.ok(snapshot.nodes.every((node) => node.data.studioOwned === true));
});

test('partially similar and extended graph imports remain custom', () => {
  const rewired = canonicalModularTextToImageGraph();
  rewired.edges[0].targetHandle = 'wrong_input';
  const rewiredSnapshot = workflowInferenceModule.workflowSnapshotFromGraph(
    rewired,
    'smoothstep',
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(rewiredSnapshot.studioGraphBinding, null);
  assert.ok(rewiredSnapshot.nodes.every((node) => node.data.studioRole === undefined));

  const extended = canonicalModularTextToImageGraph();
  extended.nodes.push({
    id: 'custom',
    type: 'custom',
    position: { x: 900, y: 300 },
    data: {
      type: 'custom',
      module: 'modules.Image',
      action: 'Resize',
      label: 'Resize',
      category: 'image',
      params: {},
    },
  });
  const extendedSnapshot = workflowInferenceModule.workflowSnapshotFromGraph(
    extended,
    'smoothstep',
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(extendedSnapshot.studioGraphBinding, null);
  assert.ok(extendedSnapshot.nodes.every((node) => node.data.studioRole === undefined));
});

test('device rebasing only changes declared device parameters', () => {
  const graph = {
    nodes: [
      {
        id: 'loader',
        data: {
          label: 'cpu',
          params: {
            device: { value: 'cpu:0', default: 'cpu' },
            prompt: { value: 'cpu' },
            notes: { value: ['cuda:0', { label: 'mps:0' }] },
          },
        },
      },
    ],
    metadata: { preferredLabel: 'cuda:0' },
  };

  assert.deepEqual(deviceRebaseModule.inspectGraphDeviceReferences(graph), [
    { path: 'nodes[0].data.params.device.value', device: 'cpu:0' },
    { path: 'nodes[0].data.params.device.default', device: 'cpu' },
  ]);
  const rebased = deviceRebaseModule.rebaseGraphDevices(graph, 'cuda:1');
  assert.equal(rebased.nodes[0].data.params.device.value, 'cuda:1');
  assert.equal(rebased.nodes[0].data.params.device.default, 'cuda:1');
  assert.equal(rebased.nodes[0].data.params.prompt.value, 'cpu');
  assert.deepEqual(rebased.nodes[0].data.params.notes.value, ['cuda:0', { label: 'mps:0' }]);
  assert.equal(rebased.nodes[0].data.label, 'cpu');
  assert.equal(rebased.metadata.preferredLabel, 'cuda:0');
});

test('role-marked generated Studio workflow imports retain their managed contract', () => {
  const graph = canonicalModularTextToImageGraph();
  graph.nodes = graph.nodes.map((node, index) => ({
    ...node,
    data: {
      ...node.data,
      studioOwned: true,
      studioRole: ['models', 'prompt', 'denoise', 'decode', 'preview'][index],
    },
  }));
  // A generated graph may evolve its internal edge set. Explicit Studio roles
  // are provenance, so this no longer depends on the legacy exact-edge matcher.
  graph.edges[0].targetHandle = 'dynamic_text_encoders';

  const snapshot = workflowInferenceModule.workflowSnapshotFromGraph(
    graph,
    'smoothstep',
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.deepEqual(
    snapshot.studioGraphBinding?.managedNodeIds,
    graph.nodes.map((node) => node.id),
  );
  assert.deepEqual(
    snapshot.studioGraphBinding?.managedEdgeIds,
    graph.edges.map((edge) => edge.id),
  );
  assert.equal(snapshot.nodes.find((node) => node.id === 'prompt')?.data.studioRole, 'prompt');
});

test('existing saved canonical imports are adopted during workflow-tab normalization', () => {
  const graph = canonicalModularTextToImageGraph();
  const modelNode = graph.nodes.find((node) => node.id === 'models');
  modelNode.data.params.model_type.value = 'Flux2KleinModularPipeline';
  modelNode.data.params.repo_id.value = {
    source: 'hub',
    value: 'black-forest-labs/FLUX.2-klein-4B',
  };
  const staleForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
  };
  const beforeTabs = studioStoreModule.useStudioStore.getState().workflowTabs;
  try {
    studioStoreModule.useStudioStore.getState().mergeBackendWorkflow({
      id: 'legacy-canonical-import',
      title: 'text_to_image',
      createdAt: 1,
      updatedAt: 1,
      dirty: false,
      source: 'import',
      sourceLabel: '/data/graphs/modular_diffusers/text_to_image.json',
      backendRevision: 1,
      snapshot: {
        nodes: graph.nodes,
        edges: graph.edges,
        viewport: graph.viewport,
        studioForm: staleForm,
        studioGraphBinding: null,
        selectedMode: staleForm.mode,
        activeTemplateId: null,
        sourceOutputId: null,
      },
    });

    const restored = studioStoreModule.useStudioStore
      .getState()
      .workflowTabs.find((tab) => tab.id === 'legacy-canonical-import');
    assert.ok(restored?.snapshot.studioGraphBinding);
    assert.deepEqual(restored.snapshot.studioGraphBinding.nodes, {
      models: 'models',
      prompt: 'prompt',
      denoise: 'denoise',
      decode: 'decode',
      preview: 'preview',
    });
    assert.equal(restored.snapshot.studioForm.modelType, 'Flux2KleinPipeline');
    assert.equal(restored.snapshot.studioGraphBinding.modelType, 'Flux2KleinPipeline');
    assert.ok(restored.snapshot.nodes.every((node) => node.data.studioOwned === true));
  } finally {
    studioStoreModule.useStudioStore.setState({ workflowTabs: beforeTabs });
  }
});

test('persisted inferred bindings self-repair stale model metadata from canonical nodes', () => {
  const graph = canonicalModularTextToImageGraph();
  const modelNode = graph.nodes.find((node) => node.id === 'models');
  modelNode.data.params.model_type.value = 'Flux2KleinModularPipeline';
  modelNode.data.params.repo_id.value = {
    source: 'hub',
    value: 'black-forest-labs/FLUX.2-klein-4B',
  };
  const roles = ['models', 'prompt', 'denoise', 'decode', 'preview'];
  graph.nodes = graph.nodes.map((node, index) => ({
    ...node,
    data: {
      ...node.data,
      studioOwned: true,
      studioRole: roles[index],
    },
  }));
  const staleForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
  };
  const staleInferredBinding = {
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    nodes: {
      models: 'models',
      prompt: 'prompt',
      denoise: 'denoise',
      decode: 'decode',
      preview: 'preview',
    },
    managedNodeIds: graph.nodes.map((node) => node.id),
    managedEdgeIds: graph.edges.map((edge) => edge.id),
    fingerprint: 'text_to_image:ZImageModularPipeline:auto:none',
    createdAt: 0,
    updatedAt: 0,
  };
  const beforeTabs = studioStoreModule.useStudioStore.getState().workflowTabs;
  try {
    studioStoreModule.useStudioStore.getState().mergeBackendWorkflow({
      id: 'interim-stale-canonical-import',
      title: 'text_to_image',
      createdAt: 1,
      updatedAt: 1,
      dirty: false,
      source: 'import',
      sourceLabel: '/data/graphs/modular_diffusers/text_to_image.json',
      backendRevision: 1,
      snapshot: {
        nodes: graph.nodes,
        edges: graph.edges,
        viewport: graph.viewport,
        studioForm: staleForm,
        studioGraphBinding: staleInferredBinding,
        selectedMode: staleForm.mode,
        activeTemplateId: null,
        sourceOutputId: null,
      },
    });

    const restored = studioStoreModule.useStudioStore
      .getState()
      .workflowTabs.find((tab) => tab.id === 'interim-stale-canonical-import');
    assert.equal(restored?.snapshot.studioForm.modelType, 'Flux2KleinPipeline');
    assert.equal(restored?.snapshot.studioGraphBinding?.modelType, 'Flux2KleinPipeline');
    assert.equal(restored?.snapshot.studioGraphBinding?.createdAt, 0);
    assert.equal(restored?.snapshot.studioGraphBinding?.updatedAt, 0);
  } finally {
    studioStoreModule.useStudioStore.setState({ workflowTabs: beforeTabs });
  }
});

test('template prompts are unique, detailed, and not generic placeholders', () => {
  const prompts = templatesModule.STUDIO_TEMPLATES.map((template) => template.prompt);
  assert.equal(new Set(prompts).size, prompts.length);

  const weakFragments = [
    'one clear subject, cinematic lighting',
    'a polished image with clean composition',
    'a focused concept image using the selected style',
    'a highly detailed final image, refined lighting',
  ];

  for (const template of templatesModule.STUDIO_TEMPLATES) {
    assert.ok(template.intentGroup, `${template.id} has an intent group`);
    assert.ok(template.recipeSummary, `${template.id} has a recipe summary`);
    assert.ok(template.mediaSlots?.length > 0, `${template.id} has media placeholders`);
    if (template.promptQualityPolicy === 'adapter_reference') {
      assert.equal(template.category, 'lora', `${template.id} adapter reference prompts are limited to LoRA recipes`);
      assert.ok(template.prompt.length >= 20, `${template.id} retains a meaningful adapter reference prompt`);
    } else {
      assert.ok(template.prompt.length >= 120, `${template.id} prompt is detailed`);
    }
    const audit = templateQualityModule.auditTemplateQuality(template);
    assert.deepEqual(audit.issues, [], `${template.id} has a modality-complete prompt and model-aware negative policy`);
    for (const fragment of weakFragments) {
      assert.equal(
        template.prompt.toLowerCase().includes(fragment),
        false,
        `${template.id} avoids generic prompt fragment`,
      );
    }
  }
});

test('parameter presets stay model-specific and match the installed pipeline recipes', () => {
  const preset = (id) => templatesModule.STUDIO_PRESETS.find((entry) => entry.id === id);

  assert.deepEqual(preset('fast').compatibleModelTypes, ['ZImageModularPipeline']);
  assert.equal(preset('fast').values.steps, 8);
  assert.equal(preset('fast').values.guidanceScale, 1);

  assert.ok(preset('balanced').compatibleModelTypes.every((modelType) => modelType.startsWith('QwenImage')));
  assert.equal(preset('quality').values.steps, 50);
  assert.equal(preset('quality').values.guidanceScale, 4);
  assert.equal(preset('text_accuracy').values.guidanceScale, 4);

  for (const id of ['audio_fast', 'audio_balanced', 'audio_continuation', 'audio_variation']) {
    assert.equal(preset(id).values.steps, 8, `${id} uses the ACE-Step v1.5 Turbo native step count`);
    assert.equal(preset(id).values.guidanceScale, 1, `${id} does not request ignored turbo guidance`);
  }

  assert.equal(preset('flux_fill').values.steps, 50);
  assert.equal(preset('flux_fill').values.guidanceScale, 30);
  assert.equal(preset('flux_fill').values.strength, 1);
  assert.equal(preset('flux_control').values.steps, 50);
  assert.equal(preset('flux_control').values.guidanceScale, 30);
  assert.deepEqual(preset('flux_kontext').compatibleModelTypes, ['FluxKontextPipeline']);

  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.AceStepAudioPipeline.recommendedSteps, 8);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.AceStepAudioPipeline.recommendedGuidance, 1);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.FluxFillPipeline.recommendedSteps, 50);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.FluxCannyPipeline.recommendedGuidance, 30);
});

test('LTX templates use the qualified 13B distilled execution contract', () => {
  const preset = templatesModule.STUDIO_PRESETS.find((entry) => entry.id === 'ltx_video_balanced');
  assert.ok(preset);
  assert.equal(profilesModule.LTX_VIDEO_REPO, 'Lightricks/LTX-Video-0.9.8-13B-distilled');
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.LTXVideoPipeline.recommendedSteps, 8);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.LTXVideoPipeline.recommendedGuidance, 1);
  assert.equal(preset.values.numFrames, 161);
  assert.equal(preset.values.steps, 8);
  assert.equal(preset.values.guidanceScale, 1);

  const templates = templatesModule.STUDIO_TEMPLATES.filter((entry) => entry.modelType === 'LTXVideoPipeline');
  assert.equal(templates.length, 6);
  for (const template of templates) {
    assert.equal(
      template.runtimeReuseKey,
      'ltx-0.9.8-13b-distilled-bfloat16-model-cpu',
      `${template.id} declares the shared immutable loader contract`,
    );
    assert.equal(template.negativePrompt, '', `${template.id} does not request ignored distilled CFG`);
    if (
      template.workflowBlocks?.includes('video_sequence') ||
      template.workflowBlocks?.includes('quality_video_sequence')
    ) {
      const nativeShotFrames = template.id === 'ltx_video_text_to_video' ? 121 : 81;
      assert.equal(
        template.example.lockedSettings.numFrames,
        nativeShotFrames,
        `${template.id} composes native-length shots`,
      );
      assert.ok(template.example.expectedOutput.durationSeconds >= 10, `${template.id} delivers a multi-shot sequence`);
    } else {
      const nativeFrames =
        template.id === 'ltx_video_text_to_video'
          ? 121
          : template.id === 'ltx_video_multi_reference'
            ? 81
            : template.id === 'ltx_video_video_to_video'
              ? 81
              : 161;
      assert.equal(
        template.example.lockedSettings.numFrames,
        nativeFrames,
        `${template.id} exposes its qualified native preview length`,
      );
    }
    if (template.videoDelivery === 'native') {
      assert.ok(!template.workflowBlocks?.includes('upscaler'), `${template.id} avoids framewise delivery upscaling`);
      assert.ok(template.example.expectedOutput.width >= 1216, `${template.id} uses the official native width`);
      assert.ok(template.example.expectedOutput.height >= 704, `${template.id} uses the official native height`);
    } else {
      assert.ok(template.workflowBlocks?.includes('upscaler'), `${template.id} includes delivery upscaling`);
    }
    assert.equal(template.example.lockedSettings.steps, 8, `${template.id} uses distilled steps`);
    assert.equal(template.example.lockedSettings.guidanceScale, 1, `${template.id} disables CFG`);
  }
  for (const id of ['ltx_video_long_showcase', 'wan_video_long_showcase']) {
    const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === id);
    assert.ok(template.example.expectedOutput.durationSeconds >= 20, `${id} remains a 20-30 second showcase`);
  }

  const railApproach = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'ltx_video_text_to_video');
  assert.ok(railApproach);
  assert.match(railApproach.label, /Rainy Rail Approach/);
  assert.match(railApproach.prompt, /moves rapidly forward from frame one/i);
  assert.match(railApproach.prompt, /sleepers rush out beneath the lens/i);
  assert.match(railApproach.prompt, /stone tunnel grows steadily ahead/i);
  assert.match(railApproach.prompt, /keep rail spacing, horizon, forest depth and forward direction stable/i);
  assert.deepEqual(
    {
      motionReviewProfile: railApproach.example.expectedOutput.motionReviewProfile,
      minimumMotionCoverage: railApproach.example.expectedOutput.minimumMotionCoverage,
      minimumAdjacentMotionCoverage: railApproach.example.expectedOutput.minimumAdjacentMotionCoverage,
      minimumEndToEndMotionCoverage: railApproach.example.expectedOutput.minimumEndToEndMotionCoverage,
      minimumActiveMotionWindowRatio: railApproach.example.expectedOutput.minimumActiveMotionWindowRatio,
      minimumStrongMotionWindowRatio: railApproach.example.expectedOutput.minimumStrongMotionWindowRatio,
      maximumLowMotionFrameRatio: railApproach.example.expectedOutput.maximumLowMotionFrameRatio,
    },
    {
      motionReviewProfile: 'global_camera',
      minimumMotionCoverage: 0.7,
      minimumAdjacentMotionCoverage: 0.08,
      minimumEndToEndMotionCoverage: 0.45,
      minimumActiveMotionWindowRatio: 0.9,
      minimumStrongMotionWindowRatio: 0.8,
      maximumLowMotionFrameRatio: 0.2,
    },
  );
  assert.ok(
    railApproach.prompt.trim().split(/\s+/).length <= 128,
    'the LTX rail prompt stays within the concise 128-word authoring budget',
  );
});

test('every published template exposes a hardware-aware loader reuse contract for family batches', () => {
  for (const template of templatesModule.STUDIO_TEMPLATES) {
    assert.ok(template.runtimeReuseKey, `${template.id} has a loader reuse key`);
  }

  const qwenText = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'qwen_text_rendering');
  const qwenPoster = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'qwen_poster_logo_text');
  const qwenLowVram = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'qwen_low_vram_text_rendering',
  );
  const qwenControl = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'qwen_control_image_layout');
  const qwenUpscale = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'qwen_upscale_finish');
  assert.equal(qwenText.runtimeReuseKey, qwenPoster.runtimeReuseKey);
  assert.equal(qwenText.runtimeReuseKey, qwenLowVram.runtimeReuseKey);
  assert.equal(qwenText.runtimeReuseKey, qwenUpscale.runtimeReuseKey);
  assert.match(qwenText.runtimeReuseKey, /:auto-planned:base-image$/);
  assert.match(qwenControl.runtimeReuseKey, /:auto-planned:control-image$/);
  assert.notEqual(qwenText.runtimeReuseKey, qwenControl.runtimeReuseKey);

  const fastLora = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'fast_lora');
  const zImageLora = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'z_image_lora_style');
  assert.match(fastLora.runtimeReuseKey, /:auto-planned:default$/);
  assert.equal(fastLora.runtimeReuseKey, zImageLora.runtimeReuseKey);
});

test('Qwen Edit Lightning templates retain the reviewed immutable auxiliary identity', () => {
  const templates = templatesModule.STUDIO_TEMPLATES.filter(
    (template) => template.workflowBlockSettings?.lora?.model?.value === 'lightx2v/Qwen-Image-Edit-2511-Lightning',
  );
  assert.ok(templates.length > 0);
  for (const template of templates) {
    const artifact = template.workflowBlockSettings.lora.model;
    assert.equal(artifact.revision, 'd74eba145674fd7e31b949324e148e21e7118abd', template.id);
    assert.equal(artifact.sha256, '22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f', template.id);
    assert.equal(
      template.workflowBlockSettings.lora.weightName,
      'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
      template.id,
    );
  }
});

test('native five-second video proofs follow the shared card-preview contract', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'wan_vace_outpaint_reframe');
  const base = {
    templateId: template.id,
    promptSettingsHash: templateExactnessModule.getPromptSettingsHash(
      templateExactnessModule.getTemplateLockedSettings(template),
    ),
    modelRevision: template.example.modelRevision,
    runtimeFingerprint: 'runtime',
    graphHash: 'graph',
    proofLockHash: 'proof',
    backendSourceFingerprint: 'backend-source',
    backendContractFingerprint: 'backend-contract',
    modelCommit: 'commit',
    templateRevisionHash: 'revision',
    provenancePath: '/proof.json',
    provenanceHash: 'provenance',
    outputPath: '/video.mp4',
    thumbnailPath: '/poster.webp',
    cardPreviewPath: '/video.card-preview.mp4',
    cardPreviewSha256: 'sha256:bytes:preview',
    mediaHash: 'media',
    mediaType: 'video',
    verificationTimestamp: new Date(0).toISOString(),
    qualityReviewPath: '/review.json',
    qualityReviewHash: 'review',
    qualityReviewStatus: 'approved_reviewed',
    reviewer: 'test',
    reviewedAt: new Date(0).toISOString(),
    width: 1664,
    height: 960,
    frames: 81,
    durationSeconds: 5.06,
  };
  base.templateLockHash = templateExactnessModule.getTemplateLockHash(template, base.modelRevision);
  base.templateInputContractHash = templateExactnessModule.getTemplateInputContractHash(template);
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    runtimeFingerprint: 'runtime',
    examples: [base],
  };

  assert.ok(templateExactnessModule.findManifestEntry(template, manifest));
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, promptSettingsHash: 'ps_stale_prompt_settings' }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, templateLockHash: 'tpl_stale_template_lock' }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, templateInputContractHash: 'tic_stale_default_inputs' }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, cardPreviewPath: undefined, cardPreviewSha256: undefined }],
    }),
    undefined,
  );
  assert.ok(
    templateExactnessModule.findManifestEntry(
      template,
      {
        ...manifest,
        examples: [{ ...base, cardPreviewPath: undefined, cardPreviewSha256: undefined }],
      },
      { requireCardPreview: false },
    ),
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, durationSeconds: 4.99 }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, frames: 80 }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, width: 640, height: 360 }],
    }),
    undefined,
  );
});

test('template cards keep valid base motion after form edits and reject stale or revoked card media', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'wan_vace_outpaint_reframe');
  assert.ok(template);
  const lockedSettings = templateExactnessModule.getTemplateLockedSettings(template);
  const proof = {
    templateId: template.id,
    promptSettingsHash: templateExactnessModule.getPromptSettingsHash(lockedSettings),
    modelRevision: template.example.modelRevision,
    runtimeFingerprint: 'runtime',
    graphHash: 'graph',
    proofLockHash: 'proof',
    backendSourceFingerprint: 'backend-source',
    backendContractFingerprint: 'backend-contract',
    modelCommit: 'commit',
    templateRevisionHash: 'revision',
    provenancePath: '/proof.json',
    provenanceHash: 'provenance',
    outputPath: '/reviewed-video.mp4',
    thumbnailPath: '/reviewed-poster.webp',
    cardPreviewPath: '/reviewed-video.card-preview.mp4',
    cardPreviewSha256: 'sha256:bytes:preview',
    beforePath: '/reviewed-source.mp4',
    beforeMediaHash: 'sha256:bytes:source-preview',
    mediaHash: 'sha256:decoded-video-framemd5:valid-card-proof',
    mediaType: 'video',
    verificationTimestamp: new Date(0).toISOString(),
    qualityReviewPath: '/review.json',
    qualityReviewHash: 'review',
    qualityReviewStatus: 'approved_reviewed',
    reviewer: 'test',
    reviewedAt: new Date(0).toISOString(),
    width: 1664,
    height: 960,
    frames: 81,
    durationSeconds: 5.06,
  };
  proof.templateLockHash = templateExactnessModule.getTemplateLockHash(template, proof.modelRevision);
  proof.templateInputContractHash = templateExactnessModule.getTemplateInputContractHash(template);
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    runtimeFingerprint: 'runtime',
    examples: [proof],
  };
  const modifiedForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    ...lockedSettings,
    prompt: `${template.prompt} User edit.`,
  };

  const modifiedUiState = templateExactnessModule.getTemplateExampleUiState(
    template,
    modifiedForm,
    template.id,
    manifest,
  );
  assert.equal(modifiedUiState.status, 'modified');
  assert.equal(modifiedUiState.manifestEntry, undefined);
  assert.deepEqual(templateExactnessModule.getTemplateCardMedia(template, manifest), {
    beforePath: '/reviewed-source.mp4',
    mediaPath: '/reviewed-video.card-preview.mp4',
    thumbnailPath: '/reviewed-poster.webp',
  });

  const editorialFallback = templateExactnessModule.templateManifestPath(
    template.example.thumbnailPath ?? template.example.outputPath,
  );
  for (const rejectedProof of [
    {
      ...proof,
      templateLockHash: 'tpl_stale_template_lock',
      outputPath: '/stale-video.mp4',
      thumbnailPath: '/stale-poster.webp',
      cardPreviewPath: '/stale-video.card-preview.mp4',
      beforePath: '/stale-source.mp4',
    },
    {
      ...proof,
      mediaHash: 'sha256:decoded-video-framemd5:346b9ca1410359054c090c54f7238914997222f3999d836553cd3921817a07cf',
      outputPath: '/revoked-video.mp4',
      thumbnailPath: '/revoked-poster.webp',
      cardPreviewPath: '/revoked-video.card-preview.mp4',
      beforePath: '/revoked-source.mp4',
    },
  ]) {
    assert.deepEqual(
      templateExactnessModule.getTemplateCardMedia(template, {
        ...manifest,
        examples: [rejectedProof],
      }),
      {
        beforePath: undefined,
        mediaPath: undefined,
        thumbnailPath: editorialFallback,
      },
    );
  }
});

test('revocation follows the rejected media proof instead of permanently blocking a template', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'ltx_video_text_to_video');
  assert.ok(template);
  const expected = template.example.expectedOutput;
  const rejectedProof = {
    templateId: template.id,
    promptSettingsHash: templateExactnessModule.getPromptSettingsHash(
      templateExactnessModule.getTemplateLockedSettings(template),
    ),
    modelRevision: template.example.modelRevision,
    runtimeFingerprint: 'runtime',
    graphHash: 'graph',
    proofLockHash: 'proof',
    backendSourceFingerprint: 'backend-source',
    backendContractFingerprint: 'backend-contract',
    modelCommit: 'commit',
    templateRevisionHash: 'revision',
    provenancePath: '/proof.json',
    provenanceHash: 'provenance',
    outputPath: '/video.mp4',
    thumbnailPath: '/poster.webp',
    cardPreviewPath: '/video.card-preview.mp4',
    cardPreviewSha256: 'sha256:bytes:preview',
    mediaHash: 'sha256:decoded-video-framemd5:346b9ca1410359054c090c54f7238914997222f3999d836553cd3921817a07cf',
    mediaType: 'video',
    verificationTimestamp: new Date(0).toISOString(),
    qualityReviewPath: '/review.json',
    qualityReviewHash: 'review',
    qualityReviewStatus: 'approved_reviewed',
    reviewer: 'test',
    reviewedAt: new Date(0).toISOString(),
    width: expected.width,
    height: expected.height,
    frames: expected.frames,
    durationSeconds: expected.durationSeconds,
  };
  rejectedProof.templateLockHash = templateExactnessModule.getTemplateLockHash(template, rejectedProof.modelRevision);
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    runtimeFingerprint: 'runtime',
    examples: [rejectedProof],
  };

  assert.equal(templateExactnessModule.findManifestEntry(template, manifest), undefined);
  assert.ok(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [
        {
          ...rejectedProof,
          mediaHash: 'sha256:decoded-video-framemd5:3d57a6c1ad3fd403692281f7b59b9f540ff56e70c195fb27e3c9404f70584160',
        },
      ],
    }),
    'a newly reviewed proof with a different media hash can qualify',
  );
});

test('required-audio video manifests bind the soundtrack without revoking a reusable visual', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'wan_22_ti2v_5b_seed_vault');
  assert.ok(template);
  assert.equal(template.example.expectedOutput.requiresAudio, true);
  const expected = template.example.expectedOutput;
  const proof = {
    templateId: template.id,
    promptSettingsHash: templateExactnessModule.getPromptSettingsHash(
      templateExactnessModule.getTemplateLockedSettings(template),
    ),
    modelRevision: template.example.modelRevision,
    runtimeFingerprint: 'runtime',
    graphHash: 'graph',
    proofLockHash: 'proof',
    backendSourceFingerprint: 'backend-source',
    backendContractFingerprint: 'backend-contract',
    modelCommit: 'commit',
    templateRevisionHash: 'revision',
    provenancePath: '/proof.json',
    provenanceHash: 'provenance',
    outputPath: '/video.mp4',
    thumbnailPath: '/poster.webp',
    cardPreviewPath: '/video.card-preview.mp4',
    cardPreviewSha256: 'sha256:bytes:preview',
    mediaHash: 'sha256:decoded-video-framemd5:f46d1387bd5848c62fe9343a800d813a906ea33e0139f43f50926cc822bb1de7',
    mediaType: 'video',
    verificationTimestamp: new Date(0).toISOString(),
    qualityReviewPath: '/review.json',
    qualityReviewHash: 'review',
    qualityReviewStatus: 'approved_reviewed',
    reviewer: 'test',
    reviewedAt: new Date(0).toISOString(),
    width: expected.width,
    height: expected.height,
    frames: expected.frames,
    durationSeconds: expected.durationSeconds,
  };
  proof.templateLockHash = templateExactnessModule.getTemplateLockHash(template, proof.modelRevision);
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    runtimeFingerprint: 'runtime',
    examples: [proof],
  };

  assert.equal(templateExactnessModule.findManifestEntry(template, manifest), undefined);
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [
        {
          ...proof,
          decodedAudioHash:
            'sha256:decoded-audio-pcm-s16le-48000-stereo:811cfa5f48a6b84410a861f25488709641f03d208092f60c6dbe6040f2b089aa',
          audiovisualMediaHash: 'sha256:decoded-av-v1:rejected-pair',
        },
      ],
    }),
    undefined,
    'the explicitly rejected soundtrack remains revoked',
  );
  assert.ok(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [
        {
          ...proof,
          decodedAudioHash:
            'sha256:decoded-audio-pcm-s16le-48000-stereo:7971158f3e9988632c8c2100cd1f485c3477dbdb1006e9814d52fcbb1c84db3d',
          audiovisualMediaHash: 'sha256:decoded-av-v1:abb6bde8c9ac4d302e1741e51eb38bc139d873ae6914b5de548058a00c4bb476',
        },
      ],
    }),
    'a newly reviewed soundtrack can qualify while retaining the accepted picture',
  );
});

test('Wan VACE execution pins the app-installed immutable model revision', () => {
  assert.equal(profilesModule.WAN_VACE_REPO, 'Wan-AI/Wan2.1-VACE-1.3B-diffusers');
  assert.equal(profilesModule.WAN_VACE_REVISION, 'ec4d2cb062b548996b179d493fdd05340de702a1');
});

test('qualified Wan gallery proofs use native five-second shots without reducing recommended steps', () => {
  for (const template of [...templatesModule.STUDIO_TEMPLATES, ...templatesModule.PLANNING_STUDIO_TEMPLATES]) {
    if (!template.id.startsWith('wan_')) continue;
    assert.match(template.negativePrompt, /deformity/i, `${template.id} includes the shared deformity guard`);
  }

  const ids = [
    'wan_vace_cinematic_text_to_video',
    'wan_vace_direct_text_to_video',
    'wan_vace_video_color_grade',
    'wan_vace_masked_object_replace',
    'wan_vace_outpaint_reframe',
    'wan_vace_grayscale_control',
    'wan_vace_video_to_video',
  ];
  for (const id of ids) {
    const template = [...templatesModule.STUDIO_TEMPLATES, ...templatesModule.PLANNING_STUDIO_TEMPLATES].find(
      (item) => item.id === id,
    );
    assert.ok(template, `${id} exists`);
    if (id === 'wan_vace_direct_text_to_video') {
      assert.equal(template.example.status, 'blocked', `${id} stays hidden after failed motion qualification`);
    }
    if (id === 'wan_vace_cinematic_text_to_video') {
      assert.equal(template.modelType, 'WanVideoPipeline', `${id} uses the dedicated base Wan text pipeline`);
      assert.equal(template.example.lockedSettings.numFrames, 81, `${id} uses native-length Wan shots`);
      assert.equal(template.example.expectedOutput.frames, 81, `${id} delivers one fully active five-second shot`);
      assert.ok(!template.workflowBlocks.includes('video_sequence'), `${id} uses direct single-shot generation`);
      assert.ok(template.requiredBackendCapabilities.includes('modules.DiffusersVideo.Generate'));
    } else if (id === 'wan_vace_masked_object_replace') {
      assert.equal(template.example.lockedSettings.numFrames, 161, `${id} keeps its accepted full-orbit proof`);
    } else {
      assert.equal(template.example.lockedSettings.numFrames, 81, `${id} uses a native five-second motion window`);
    }
    assert.ok(template.workflowBlocks.includes('upscaler'), `${id} includes delivery upscaling`);
    const expectedSteps =
      id === 'wan_vace_masked_object_replace' ||
      id === 'wan_vace_direct_text_to_video' ||
      id === 'wan_vace_outpaint_reframe' ||
      id === 'wan_vace_grayscale_control'
        ? 30
        : 50;
    assert.equal(template.example.lockedSettings.steps, expectedSteps, `${id} preserves the upstream quality recipe`);
  }

  const wanTi2v = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'wan_22_ti2v_5b_seed_vault');
  assert.equal(
    wanTi2v.example.lockedSettings.steps,
    50,
    'Wan 2.2 TI2V 5B uses its official Diffusers model-card steps',
  );
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.WanTI2VPipeline.recommendedSteps, 50);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.WanTI2VPipeline.lowVram.steps, 50);
  assert.ok(wanTi2v.workflowBlocks.includes('soundtrack'));
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.pipelineClass, 'AceStepPipeline');
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.steps, 8);
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.guidanceScale, 1);
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.durationSeconds, 12);
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.seed, 1684710282);
  assert.deepEqual(wanTi2v.workflowBlockSettings.soundtrack.audioFit, {
    sourceStartSeconds: 1,
    sourceDurationSeconds: 121 / 24,
    targetDurationSeconds: 121 / 24,
    delaySeconds: 4 / 24,
    targetSampleRate: 48000,
    fadeInSeconds: 0.008,
    fadeOutSeconds: 0.12,
  });
  assert.ok(wanTi2v.requiredBackendCapabilities.includes('modules.Audio.FitDuration'));
  assert.equal(wanTi2v.example.expectedOutput.requiresAudio, true);

  const colorGrade = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'wan_vace_video_color_grade');
  assert.ok(colorGrade);
  assert.ok(
    colorGrade.example.lockedSettings.strength <= 0.2,
    'Wan color finishing stays below the observed 0.25 rigid-geometry redesign regime',
  );
  assert.equal(colorGrade.example.expectedOutput.motionReviewProfile, 'localized_subject');
  assert.equal(colorGrade.example.expectedOutput.minimumMotionCoverage, 0.27);
  assert.equal(colorGrade.example.expectedOutput.minimumAdjacentMotionCoverage, 0.03);
  assert.equal(colorGrade.example.expectedOutput.minimumEndToEndMotionCoverage, 0.18);
  assert.equal(colorGrade.example.expectedOutput.minimumActiveMotionWindowRatio, 0.65);
  assert.equal(colorGrade.example.expectedOutput.minimumStrongMotionWindowRatio, 0);
  assert.equal(colorGrade.example.expectedOutput.maximumLowMotionFrameRatio, 0.3);

  const grayscaleControl = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'wan_vace_grayscale_control');
  assert.ok(grayscaleControl);
  assert.equal(grayscaleControl.example.expectedOutput.minimumMotionCoverage, 0.75);
  assert.equal(grayscaleControl.example.expectedOutput.minimumAdjacentMotionCoverage, 0.03);
  assert.equal(grayscaleControl.example.expectedOutput.minimumEndToEndMotionCoverage, 0.6);
  assert.equal(grayscaleControl.example.expectedOutput.minimumActiveMotionWindowRatio, 0.6);
  assert.equal(grayscaleControl.example.expectedOutput.minimumStrongMotionWindowRatio, 0.4);
  assert.equal(grayscaleControl.example.expectedOutput.maximumLowMotionFrameRatio, 0.8);

  const planningReference = templatesModule.PLANNING_STUDIO_TEMPLATES.find(
    (item) => item.id === 'wan_vace_reference_motion',
  );
  assert.ok(planningReference, 'failed Wan reference conditioning remains available to planning reports');
  assert.equal(planningReference.example.status, 'blocked');

  const reduxBlend = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'flux_redux_multi_reference');
  assert.ok(reduxBlend, 'the user-approved Redux visual-blend proof is available in the template browser');
  assert.equal(reduxBlend.mode, 'multi_image_reference_edit');
  assert.equal(reduxBlend.example.status, 'reviewed');
  assert.equal(
    templatesModule.PLANNING_STUDIO_TEMPLATES.some((item) => item.id === 'flux_redux_multi_reference'),
    false,
    'the approved Redux card no longer remains hidden in planning',
  );
});

test('LTX video variation separates source conditioning from denoise strength', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'ltx_video_video_to_video');
  assert.ok(template);
  assert.equal(template.example.lockedSettings.conditioningScale, 1);
  assert.equal(template.example.lockedSettings.strength, 0.6);
  assert.ok(
    template.example.lockedSettings.conditioningScale > template.example.lockedSettings.strength,
    'the remaster hard-locks the source trajectory while denoising reconstructs its delivery frames',
  );
});

test('Qwen Auto never rewrites user generation controls while planning runtime resources', () => {
  const base = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    resourceMode: 'auto',
  };

  assert.deepEqual(resourcePlannerModule.getQwenAutoDimensions({ ...base, width: 1024, height: 768 }), {
    width: 1024,
    height: 768,
  });
  assert.deepEqual(resourcePlannerModule.getQwenAutoDimensions({ ...base, width: 768, height: 1344 }), {
    width: 768,
    height: 1344,
  });
  assert.deepEqual(resourcePlannerModule.getQwenAutoDimensions({ ...base, width: 1328, height: 1328 }), {
    width: 1024,
    height: 1024,
  });

  const resolved = resourcePlannerModule.resolveStudioResourceForm({ ...base, width: 1024, height: 768 });
  assert.equal(resolved.width, 1024);
  assert.equal(resolved.height, 768);

  const candidatePatch = autoResourceModule.formPatchForAutoCandidate(
    {
      dtype: 'bfloat16',
      offloadMode: 'model_cpu',
      generation: { width: 1024, height: 1024, steps: 50, guidanceScale: 4 },
    },
    { ...base, width: 1024, height: 768 },
  );
  assert.equal(candidatePatch.width, undefined);
  assert.equal(candidatePatch.height, undefined);

  const editedSamplingForm = {
    ...base,
    steps: 17,
    guidanceScale: 6.5,
    negativePrompt: 'Keep this user-authored negative prompt',
  };
  assert.equal(
    autoResourceModule.autoPlanKeyForForm(editedSamplingForm),
    autoResourceModule.autoPlanKeyForForm({
      ...editedSamplingForm,
      steps: 49,
      guidanceScale: 2.25,
      negativePrompt: 'A different user-authored negative prompt',
    }),
    'sampling edits must not invalidate a compatible hardware plan',
  );
  const editedSamplingPatch = autoResourceModule.formPatchForAutoCandidate(
    {
      dtype: 'bfloat16',
      offloadMode: 'model_cpu',
      generation: {
        width: 1024,
        height: 1024,
        steps: 50,
        guidanceScale: 4,
        negativePrompt: 'Planner default',
      },
    },
    editedSamplingForm,
  );
  assert.equal(Object.hasOwn(editedSamplingPatch, 'steps'), false);
  assert.equal(Object.hasOwn(editedSamplingPatch, 'guidanceScale'), false);
  assert.equal(Object.hasOwn(editedSamplingPatch, 'negativePrompt'), false);
});

test('schema-v2 Auto targets only the exact managed loader for Qwen and Wan profiles', () => {
  const cases = [
    [
      'QwenImageModularPipeline',
      'text_to_image',
      'modules.DiffusersImage',
      'LoadPipeline',
      'direct-diffusers-image',
      'QwenImagePipeline',
    ],
    [
      'QwenImageModularPipeline',
      'control_image',
      'modules.ModularDiffusers',
      'ModelsLoader',
      'modular-diffusers',
      'QwenImageModularPipeline',
    ],
    [
      'QwenImageEditPlusModularPipeline',
      'edit_image',
      'modules.ModularDiffusers',
      'ModelsLoader',
      'modular-diffusers',
      'QwenImageEditPlusModularPipeline',
    ],
    [
      'QwenImageLayeredModularPipeline',
      'layer_decomposition',
      'modules.ModularDiffusers',
      'ModelsLoader',
      'modular-diffusers',
      'QwenImageLayeredModularPipeline',
    ],
    [
      'WanVACEPipeline',
      'control_to_video',
      'modules.DiffusersVideo',
      'LoadPipeline',
      'direct-wan-vace',
      'WanVACEPipeline',
    ],
    [
      'WanVideoPipeline',
      'text_to_video',
      'modules.DiffusersVideo',
      'LoadPipeline',
      'direct-diffusers-video',
      'WanPipeline',
    ],
  ];
  const node = (id, module, action, identity, disabled = false, parentId) => ({
    id,
    parentId,
    data: {
      module,
      action,
      type: 'custom',
      params: {
        [module === 'modules.ModularDiffusers' ? 'model_type' : 'pipeline_class']: { value: identity },
      },
      uiState: disabled ? { disabled: true } : undefined,
    },
  });
  const planFor = (modelType, mode, loaderModule, loaderAction, executionPath, pipelineClass, id = 'selected') => {
    const candidate = { id, modelType, mode, loaderModule, loaderAction, executionPath, pipelineClass };
    return {
      schemaVersion: 2,
      status: 'ready',
      canAutoRun: true,
      compatibility: { state: 'ready' },
      selectedCandidate: candidate,
      candidates: [{ ...candidate }],
    };
  };

  for (const [modelType, mode, loaderModule, loaderAction, executionPath, pipelineClass] of cases) {
    const plan = planFor(modelType, mode, loaderModule, loaderAction, executionPath, pipelineClass);
    const nodes = [
      node('modular', 'modules.ModularDiffusers', 'ModelsLoader', modelType),
      node('image', 'modules.DiffusersImage', 'LoadPipeline', pipelineClass),
      node('video', 'modules.DiffusersVideo', 'LoadPipeline', pipelineClass),
    ];
    const managedId =
      loaderModule === 'modules.ModularDiffusers' ? 'modular' : loaderModule.includes('Video') ? 'video' : 'image';
    assert.equal(
      autoResourceModule.autoResourcePlanTargetMatches(plan, nodes, [managedId], { modelType, mode }),
      true,
      `${modelType}:${mode}`,
    );
  }

  const qwenPlan = planFor(
    'QwenImageModularPipeline',
    'control_image',
    'modules.ModularDiffusers',
    'ModelsLoader',
    'modular-diffusers',
    'QwenImageModularPipeline',
  );
  const mixedNodes = [
    node('managed-image', 'modules.DiffusersImage', 'LoadPipeline', 'QwenImagePipeline'),
    node('unrelated-modular', 'modules.ModularDiffusers', 'ModelsLoader', 'QwenImageModularPipeline'),
  ];
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(qwenPlan, mixedNodes, ['managed-image'], {
      modelType: 'QwenImageModularPipeline',
      mode: 'control_image',
    }),
    'an unrelated visible loader cannot satisfy the managed target',
  );
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(
      qwenPlan,
      [node('managed-modular', 'modules.ModularDiffusers', 'ModelsLoader', 'QwenImageModularPipeline', true)],
      ['managed-modular'],
      { modelType: 'QwenImageModularPipeline', mode: 'control_image' },
    ),
    'a disabled loader is not executable',
  );
  for (const containers of [
    [{ id: 'disabled-group', data: { type: 'group', uiState: { disabled: true } } }],
    [
      { id: 'disabled-loop', data: { type: 'loop', uiState: { disabled: true } } },
      { id: 'nested-group', parentId: 'disabled-loop', data: { type: 'group' } },
    ],
  ]) {
    const parentId = containers.at(-1).id;
    assert.ok(
      !autoResourceModule.autoResourcePlanTargetMatches(
        qwenPlan,
        [
          ...containers,
          node(
            'managed-modular',
            'modules.ModularDiffusers',
            'ModelsLoader',
            'QwenImageModularPipeline',
            false,
            parentId,
          ),
        ],
        ['managed-modular'],
        { modelType: 'QwenImageModularPipeline', mode: 'control_image' },
      ),
      'a loader nested under a disabled group or loop is not executable',
    );
  }

  const staleId = { ...qwenPlan, selectedCandidate: { ...qwenPlan.selectedCandidate, id: 'stale' } };
  assert.equal(autoResourceModule.selectedAutoCandidate(staleId), null);
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(staleId, mixedNodes, ['unrelated-modular'], {
      modelType: 'QwenImageModularPipeline',
      mode: 'control_image',
    }),
  );
  const boundCandidate = {
    ...qwenPlan.selectedCandidate,
    artifactRevision: 'a'.repeat(40),
    artifactResolution: {
      resolved: { repo: 'Qwen/Qwen-Image-2512', revision: 'a'.repeat(40), components: ['transformer'] },
    },
    quantizedComponents: ['transformer'],
    bnb4ComputeDtype: 'bfloat16',
    autoOffload: true,
    generation: { width: 1024, height: 1024, steps: 50 },
    proof: { status: 'declared_safe' },
  };
  const exactBoundPlan = {
    ...qwenPlan,
    selectedCandidate: { ...boundCandidate },
    candidates: [{ ...boundCandidate }],
  };
  assert.equal(autoResourceModule.selectedAutoCandidate(exactBoundPlan)?.id, 'selected');
  for (const selectedCandidate of [
    { ...boundCandidate, artifactRevision: 'b'.repeat(40) },
    { ...boundCandidate, quantizedComponents: ['text_encoder'] },
    { ...boundCandidate, quantizedComponents: { 0: 'transformer' } },
    { ...boundCandidate, generation: { ...boundCandidate.generation, steps: 28 } },
  ]) {
    const stalePayload = { ...exactBoundPlan, selectedCandidate };
    assert.equal(autoResourceModule.selectedAutoCandidate(stalePayload), null);
    assert.ok(
      !autoResourceModule.autoResourcePlanTargetMatches(stalePayload, mixedNodes, ['unrelated-modular'], {
        modelType: 'QwenImageModularPipeline',
        mode: 'control_image',
      }),
    );
  }
  for (const selectedCandidate of [
    { ...qwenPlan.selectedCandidate, executionPath: 'direct-diffusers-image' },
    { ...qwenPlan.selectedCandidate, pipelineClass: 'FluxPipeline' },
  ]) {
    const inconsistentTarget = {
      ...qwenPlan,
      selectedCandidate,
      candidates: [{ ...selectedCandidate }],
    };
    assert.equal(autoResourceModule.selectedAutoCandidate(inconsistentTarget), null);
    assert.equal(
      autoResourceModule.autoResourcePlanTargetMatches(inconsistentTarget, mixedNodes, ['unrelated-modular'], {
        modelType: 'QwenImageModularPipeline',
        mode: 'control_image',
      }),
      false,
    );
  }
  const wrongPair = planFor(
    'FluxSchnellPipeline',
    'text_to_image',
    'modules.DiffusersImage',
    'LoadPipeline',
    'direct-diffusers-image',
    'FluxPipeline',
  );
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(wrongPair, mixedNodes, ['managed-image'], {
      modelType: 'QwenImageModularPipeline',
      mode: 'text_to_image',
    }),
  );
  const wrongClass = planFor(
    'QwenImageModularPipeline',
    'text_to_image',
    'modules.DiffusersImage',
    'LoadPipeline',
    'direct-diffusers-image',
    'FluxPipeline',
  );
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(wrongClass, mixedNodes, ['managed-image'], {
      modelType: 'QwenImageModularPipeline',
      mode: 'text_to_image',
    }),
    'the same loader module/action cannot repurpose a different live pipeline class',
  );
});

test('Auto retry plans preserve exact targets and never fall back from a stale selected id', () => {
  const identity = {
    executionProfileId: 'qwen-image:t2i-direct',
    modelType: 'QwenImageModularPipeline',
    mode: 'text_to_image',
    loaderModule: 'modules.DiffusersImage',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-image',
    pipelineClass: 'QwenImagePipeline',
  };
  const candidates = [
    { id: 'selected', ...identity, proof: { status: 'passed' }, offloadMode: 'none' },
    { id: 'retry', ...identity, proof: { status: 'declared_safe' }, offloadMode: 'model_cpu' },
    {
      id: 'cross-branch',
      ...identity,
      modelType: 'FluxSchnellPipeline',
      pipelineClass: 'FluxPipeline',
      proof: { status: 'passed' },
      offloadMode: 'model_cpu',
    },
    { id: 'targetless', proof: { status: 'passed' }, offloadMode: 'model_cpu' },
  ];
  assert.deepEqual(resourcePlannerModule.qwenDirectRetryPlansFromCandidates(candidates, 'selected')[0], {
    candidateId: 'retry',
    ...identity,
    onCategories: ['oom', 'cuda_kernel'],
    onErrorCodes: ['cuda_kernel_unsupported', 'cuda_oom'],
  });
  assert.equal(resourcePlannerModule.qwenDirectRetryPlansFromCandidates(candidates, 'selected').length, 1);
  assert.deepEqual(resourcePlannerModule.qwenDirectRetryPlansFromCandidates(candidates, 'missing'), []);
});

test('ACE templates lock musical structure, metadata, and model-aware negative behavior', () => {
  const templates = templatesModule.STUDIO_TEMPLATES.filter(
    (template) => template.modelType === 'AceStepAudioPipeline',
  );
  assert.equal(templates.length, 7);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.AceStepAudioPipeline.recommendedSampleRate, 48000);

  for (const template of templates) {
    const locked = template.example.lockedSettings;
    assert.equal(locked.steps, 8);
    assert.equal(locked.guidanceScale, 1);
    assert.equal(locked.shift, 3);
    const expectedBpm =
      template.id === 'ace_step_lyric_music_video'
        ? 100
        : template.id === 'ace_step_chinese_new_year_lora'
          ? 96
          : template.id === 'ace_step_custom_lora'
            ? 92
            : 170;
    const expectedKey =
      template.id === 'ace_step_chinese_new_year_lora'
        ? 'D major'
        : template.id === 'ace_step_custom_lora'
          ? 'A minor'
          : 'C# minor';
    assert.equal(locked.bpm, expectedBpm);
    assert.equal(locked.keyscale, expectedKey);
    const expectedTimeSignature =
      template.id === 'ace_step_text_to_audio' || template.id === 'ace_step_audio_continuation'
        ? '3'
        : template.id === 'ace_step_lyric_music_video'
          ? '4'
          : '4/4';
    assert.equal(locked.timesignature, expectedTimeSignature);
    assert.equal(template.negativePrompt, '');
  }

  const textToAudio75 = templates.find((template) => template.id === 'ace_step_text_to_audio');
  assert.equal(textToAudio75.example.lockedSettings.audioDuration, 75);
  assert.equal(textToAudio75.example.expectedOutput.durationSeconds, 75);
  assert.match(textToAudio75.prompt, /0-6 seconds/);
  assert.match(textToAudio75.prompt, /72-75 seconds/);
  assert.match(textToAudio75.example.lockedSettings.lyrics, /\[Pre-Chorus\]/);
  assert.match(textToAudio75.example.lockedSettings.lyrics, /\[Bridge\]/);
  assert.equal(
    templateExactnessModule.getTemplateCardMedia(textToAudio75, null).mediaPath,
    templateAssetsModule.resolveTemplateAssetUrl('/template-gallery/ace_step_text_to_audio.current.wav'),
  );

  const lyricVideo = templates.find((template) => template.id === 'ace_step_lyric_music_video');
  assert.ok(lyricVideo.workflowBlocks.includes('lyric_video'));
  assert.ok(lyricVideo.example.expectedOutput.durationSeconds >= 20);
  assert.equal(lyricVideo.example.lockedSeed, 1201047366);
  assert.equal(lyricVideo.example.lockedSettings.audioDuration, 30);
  assert.equal(lyricVideo.example.expectedOutput.requiresAudio, true);
  assert.ok(lyricVideo.requiredBackendCapabilities.includes('modules.Audio.FitDuration'));
  assert.deepEqual(lyricVideo.workflowBlockSettings.lyricVideo.audioFit, {
    sourceStartSeconds: 0,
    sourceDurationSeconds: 30,
    targetDurationSeconds: 381 / 16,
    delaySeconds: 0,
    targetSampleRate: 48000,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  });
  assert.equal(lyricVideo.workflowBlockSettings.lyricVideo.audio.seed, 1201047366);
  assert.equal(lyricVideo.workflowBlockSettings.lyricVideo.audio.bpm, 100);
  assert.match(lyricVideo.workflowBlockSettings.lyricVideo.audio.lyrics, /^\[Verse\]/);
  assert.equal(
    lyricVideo.workflowBlockSettings.lyricVideo.lrc,
    [
      '[00:00.00]Daylight leaves the garden wall',
      '[00:03.26]Silver buds begin to call',
      '[00:07.44]White petals turn into the night',
      '[00:11.38]Every vine unfolds its light',
      '[00:15.08]Stars grow pale above the lawn',
      '[00:18.90]Moonflowers hold until the dawn',
    ].join('\n'),
  );

  const textToAudio = templates.find((template) => template.mode === 'text_to_audio');
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[intro\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[verse\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[chorus\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[bridge\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[outro\]/i);

  const chineseNewYear = templates.find((template) => template.id === 'ace_step_chinese_new_year_lora');
  assert.equal(
    chineseNewYear.workflowBlockSettings.lora.baseModel.value,
    'Runware/acestep-v15-turbo-diffusers',
    'the official 2048-wide LoRA must retain its matching base instead of the XL Studio default',
  );
  assert.equal(
    chineseNewYear.workflowBlockSettings.lora.baseModel.revision,
    'be23effe449c5957947f3020fd63bee23c64abe4',
    'the matching Diffusers base must remain pinned to the reviewed revision',
  );
  assert.equal(
    chineseNewYear.workflowBlockSettings.lora.model.revision,
    'cb829a12775740c830a6d49795f16913065dc492',
    'the restricted adapter must remain pinned to the reviewed revision',
  );
  assert.equal(chineseNewYear.workflowBlockSettings.lora.scale, 0.5);
  assert.equal(chineseNewYear.prompt, 'chinese traditional music, erhu solo, peaceful and elegant');
  assert.equal(chineseNewYear.example.lockedSettings.audioDuration, 30);
  assert.equal(chineseNewYear.example.expectedOutput.durationSeconds, 30);
  assert.equal(
    templateExactnessModule.getTemplateCardMedia(chineseNewYear, null).mediaPath,
    templateAssetsModule.resolveTemplateAssetUrl('/template-gallery/ace_step_chinese_new_year_lora.wav'),
  );
  assert.equal(
    chineseNewYear.example.lockedSettings.lyrics,
    '[verse]\n\u6625\u98ce\u53c8\u7eff\u6c5f\u5357\u5cb8\n\u660e\u6708\u4f55\u65f6\u7167\u6211\u8fd8',
  );
  const customLora = templates.find((template) => template.id === 'ace_step_custom_lora');
  assert.equal(customLora.evidencePolicy, 'user_supplied');
  assert.match(customLora.example.notes, /bring-your-own adapter/i);
  assert.equal(
    customLora.workflowBlockSettings.lora.baseModel.revision,
    'be23effe449c5957947f3020fd63bee23c64abe4',
    'the local-adapter starter must still pin its managed Hub base model',
  );

  const ghibliLora = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'flux_lora_ghibli_story');
  const ghibliMedia = templateExactnessModule.getTemplateCardMedia(ghibliLora, null);
  assert.equal(ghibliMedia.mediaPath, undefined, 'permission-pending generated media must not resolve');
  assert.equal(ghibliMedia.thumbnailPath, undefined, 'permission-pending posters must not resolve');
  for (const templateId of ['flux_lora_oil_painting', 'flux_lora_retro_comic']) {
    const template = templatesModule.STUDIO_TEMPLATES.find((candidate) => candidate.id === templateId);
    const media = templateExactnessModule.getTemplateCardMedia(template, null);
    assert.ok(media.mediaPath || media.thumbnailPath, `${templateId} keeps its reviewed public preview`);
  }
  const octaneTemplate = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'flux_lora_cinematic_octane_3d',
  );
  assert.equal(
    templateExactnessModule.getTemplateCardMedia(octaneTemplate, null).thumbnailPath,
    templateAssetsModule.resolveTemplateAssetUrl('/template-gallery/flux_lora_cinematic_octane_3d.card-poster.webp'),
    'the portrait editorial poster remains visible as the template card fallback',
  );

  const ghibliPolicies = modelUsagePoliciesModule.acknowledgementRequiredForTemplate(ghibliLora);
  assert.deepEqual(ghibliPolicies.map((policy) => policy.repository).sort(), [
    'alvarobartt/ghibli-characters-flux-lora',
    'black-forest-labs/FLUX.1-dev',
  ]);
  assert.equal(
    ghibliPolicies.find((policy) => policy.repository === 'alvarobartt/ghibli-characters-flux-lora')?.useScope,
    'personal_noncommercial',
  );
  const ghibliAcknowledgementKey = modelUsagePoliciesModule.usagePolicyAcknowledgementKey(ghibliPolicies);
  assert.match(ghibliAcknowledgementKey, /^terms-v2:[0-9a-f]{8}$/);
  assert.ok(
    ghibliPolicies.every((policy) => /^[0-9a-f]{40}$/.test(policy.revision)),
    'acknowledgement contracts must use immutable model revisions',
  );

  const chineseNewYearPolicies = modelUsagePoliciesModule.acknowledgementRequiredForTemplate(chineseNewYear);
  assert.deepEqual(
    chineseNewYearPolicies.map((policy) => policy.repository),
    ['ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA'],
  );
  const chineseNewYearPolicy = chineseNewYearPolicies[0];
  assert.equal(chineseNewYearPolicy.useScope, 'research_academic_only');
  assert.equal(chineseNewYearPolicy.revision, 'cb829a12775740c830a6d49795f16913065dc492');
  assert.equal(chineseNewYearPolicy.reviewedRevision, 'cb829a12775740c830a6d49795f16913065dc492');
  assert.match(chineseNewYearPolicy.shortSummary, /research and academic exchange only/i);
  assert.match(chineseNewYearPolicy.shortSummary, /prohibits commercial use/i);
  assert.equal(
    chineseNewYearPolicy.termsUrl,
    'https://huggingface.co/ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA/blob/cb829a12775740c830a6d49795f16913065dc492/README.md',
  );
  assert.match(
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey(chineseNewYearPolicies),
    /^terms-v2:[0-9a-f]{8}$/,
  );
  assert.notEqual(
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey(chineseNewYearPolicies),
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey([
      { ...chineseNewYearPolicy, revision: '0000000000000000000000000000000000000000' },
    ]),
    'changing a repository revision must invalidate the stored acknowledgement',
  );
  assert.notEqual(
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey(chineseNewYearPolicies),
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey([
      { ...chineseNewYearPolicy, policyVersion: 'next-policy-review' },
    ]),
    'changing the reviewed policy version must invalidate the stored acknowledgement',
  );

  const oilTemplate = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'flux_lora_oil_painting');
  assert.deepEqual(
    modelUsagePoliciesModule.acknowledgementRequiredForTemplate(oilTemplate).map((policy) => policy.repository),
    ['black-forest-labs/FLUX.1-dev'],
    'a commercially licensed adapter still surfaces the restricted FLUX dev base terms',
  );
  const unrestrictedTemplate = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'flux_schnell_text_to_image',
  );
  assert.deepEqual(modelUsagePoliciesModule.acknowledgementRequiredForTemplate(unrestrictedTemplate), []);
  assert.equal(modelUsagePoliciesModule.repositoryRequiresHuggingFaceGate('black-forest-labs/FLUX.1-dev'), true);
  assert.equal(
    modelUsagePoliciesModule.repositoryRequiresHuggingFaceGate('alvarobartt/ghibli-characters-flux-lora'),
    false,
  );

  const continuation = templates.find((template) => template.mode === 'audio_continuation');
  assert.equal(continuation.example.lockedSettings.audioDuration, 75);
  assert.equal(continuation.example.lockedSettings.extensionDuration, 15);
  assert.equal(continuation.example.expectedOutput.durationSeconds, 90);
  assert.ok(continuation.requiredBackendCapabilities.includes('modules.Audio.MatchLoudness'));
  assert.ok(continuation.requiredBackendCapabilities.includes('modules.Audio.Join'));
  assert.match(continuation.prompt, /absolute time 75 to 90 seconds/);
  assert.match(continuation.prompt, /strict 3\/4/);
  assert.match(continuation.example.lockedSettings.lyrics, /MoDiff—lock the final line[\s\S]*\[Continuation\]/);
  assert.match(continuation.example.lockedSettings.lyrics, /\[Final Hook\]/);
  assert.equal(continuation.inputBindings[0].label, 'Included 75-second source audio');
  assert.equal(
    continuation.inputBindings[0].defaultAssets[0].runtimeSha256,
    'sha256:bytes:3807d712e24a94c4b445c2fa950a784bba334f5f665e74964fe4d47a43856230',
  );
  assert.equal(
    templateExactnessModule.getTemplateCardMedia(continuation, null).beforePath,
    templateAssetsModule.resolveTemplateAssetUrl('/template-gallery/ace_step_text_to_audio.current.wav'),
  );
});

test('template browser exposes the complete workflow catalog across task and adapter categories', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const { TEMPLATE_BROWSER_CATEGORIES, filterStudioTemplates, templateCategoryId, templateCategoryIds } = browserModule;
  const form = profilesModule.DEFAULT_STUDIO_FORM;

  assert.deepEqual(
    TEMPLATE_BROWSER_CATEGORIES.map((category) => category.id),
    [
      'recommended',
      'all',
      'getting-started',
      'image',
      'edit',
      'control',
      'video',
      'audio',
      'adapters',
      'upscale',
      'performance',
    ],
  );

  const imageTemplates = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'image',
    query: '',
    modelType: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });
  assert.ok(imageTemplates.length > 0);
  assert.ok(imageTemplates.every((template) => templateCategoryIds(template).includes('image')));
  assert.ok(imageTemplates.some((template) => template.id === 'flux_lora_oil_painting'));
  assert.ok(imageTemplates.some((template) => template.id === 'flux_lora_retro_comic'));

  const adapterTemplates = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'adapters',
    includeBlocked: true,
    query: '',
    modelType: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });
  const authoredAdapterIds = STUDIO_TEMPLATES.filter((template) => template.category === 'lora').map(
    (template) => template.id,
  );
  assert.deepEqual(
    authoredAdapterIds.filter((templateId) => !adapterTemplates.some((template) => template.id === templateId)),
    [],
  );

  const referenceEdits = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'edit',
    query: '',
    modelType: 'all',
    mode: 'multi_image_reference_edit',
    difficulty: 'all',
    sort: 'recommended',
  });
  assert.ok(referenceEdits.length > 0);
  assert.ok(referenceEdits.every((template) => template.mode === 'multi_image_reference_edit'));
  assert.ok(referenceEdits.every((template) => templateCategoryId(template) === 'edit'));

  const defaultInventory = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'all',
    query: '',
    modelType: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });
  assert.equal(
    defaultInventory.some((template) => template.difficulty === 'blocked' || template.example?.status === 'blocked'),
    false,
  );

  const completeInventory = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'all',
    includeBlocked: true,
    query: '',
    modelType: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });
  assert.equal(completeInventory.length, STUDIO_TEMPLATES.length);
  assert.ok(completeInventory.length >= defaultInventory.length);
});

test('every template name identifies its exact model and operation', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const { STUDIO_MODEL_LABELS } = profilesModule;
  for (const template of STUDIO_TEMPLATES) {
    assert.ok(
      template.label.startsWith(`${STUDIO_MODEL_LABELS[template.modelType]} — `),
      `${template.id} must begin with its model name`,
    );
    assert.doesNotMatch(template.label, /^(Low VRAM|High quality|Fast LoRA)$/i);
  }
  assert.equal(
    STUDIO_TEMPLATES.find((template) => template.id === 'low_vram')?.label,
    'Z-Image Turbo — Text to Image: Auto-Offload Preview',
  );
});

test('browser display names stay concise because model and operation have dedicated metadata', () => {
  const displayNames = templatesModule.STUDIO_TEMPLATES.map((template) => ({
    template,
    name: browserModule.templateDisplayName(template),
  }));
  const productConcept = displayNames.find(({ template }) => template.id === 'qwen_low_vram_product_concept');
  assert.equal(productConcept?.name, 'Product Concept');
  const quickPreview = displayNames.find(({ template }) => template.id === 'low_vram');
  assert.equal(quickPreview?.name, 'Quick Preview');
  for (const { template, name } of displayNames) {
    assert.ok(name.length > 0, `${template.id} has a display name`);
    assert.equal(/auto[ -]?offload|low[ -]?vram/i.test(name), false, `${template.id} hides execution strategy`);
    assert.equal(
      name.includes(profilesModule.STUDIO_MODEL_LABELS[template.modelType]),
      false,
      `${template.id} hides duplicate model name`,
    );
    assert.equal(
      name.includes(profilesModule.STUDIO_MODE_LABELS[template.mode]),
      false,
      `${template.id} hides duplicate operation`,
    );
  }
});

test('every declared template backend capability has an explicit registry contract', () => {
  const templates = [...templatesModule.STUDIO_TEMPLATES, ...templatesModule.PLANNING_STUDIO_TEMPLATES];
  for (const template of templates) {
    const capabilities = template.requiredBackendCapabilities ?? [];
    for (const capability of capabilities) {
      assert.equal(
        readinessModule.isTemplateBackendCapabilityRecognized(capability),
        true,
        `${template.id} has no readiness resolver for ${capability}`,
      );
    }
    if (capabilities.length > 0) {
      assert.ok(
        readinessModule.templateBackendNodeKeys(template).length > 0,
        `${template.id} has no source-controlled backend-node contract`,
      );
    }
  }
  assert.equal(readinessModule.isTemplateBackendCapabilityRecognized('unregistered future capability'), false);
});

test('runtime option normalization supports the real registry descriptor contract and legacy declarations', () => {
  const entries = runtimeOptionsModule.runtimeOptionEntries([
    optionDescriptor('model_cpu', { label: 'RAM/CPU model offload' }),
    optionDescriptor('group_disk', {
      label: 'SSD group offload',
      availability: 'remote',
      installationState: 'installable',
    }),
    { id: 'legacy', label: 'Legacy object choice' },
    { unsupportedShape: true },
  ]);

  assert.deepEqual(
    entries
      .filter((entry) => entry.type === 'option')
      .map(({ value, label, disabled }) => ({
        value,
        label,
        disabled,
      })),
    [
      { value: 'model_cpu', label: 'RAM/CPU model offload', disabled: false },
      { value: 'group_disk', label: 'SSD group offload', disabled: true },
      { value: 'legacy', label: 'Legacy object choice', disabled: false },
    ],
  );
  assert.deepEqual(runtimeOptionsModule.runtimeOptionValues(entries.map((entry) => entry.raw)), [
    'model_cpu',
    'legacy',
  ]);
  assert.equal(JSON.stringify(entries).includes('[object Object]'), false);

  const dictionaryEntries = runtimeOptionsModule.runtimeOptionEntries({
    __runtime: 'Installed',
    quality: optionDescriptor('quality', { label: 'Quality' }),
    fast: 'Fast',
  });
  assert.equal(dictionaryEntries[0].type, 'header');
  assert.deepEqual(runtimeOptionsModule.runtimeOptionValues({ quality: optionDescriptor('quality'), fast: 'Fast' }), [
    'quality',
    'fast',
  ]);
});

test('template readiness classifies ready, input, model, and backend states', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const { getTemplateReadiness } = readinessModule;
  const baseRegistry = {
    'modules.ModularDiffusers.AutoModelLoader': {},
    'modules.ModularDiffusers.Controlnet': {},
  };
  const modularQwenEditRegistry = {
    'modules.ModularDiffusers.ModelsLoader': {},
    'modules.ModularDiffusers.EncodePrompt': {},
    'modules.ModularDiffusers.ImageEncode': {},
    'modules.ModularDiffusers.Denoise': {},
    'modules.ModularDiffusers.DecodeLatents': {},
    'modules.ModularDiffusers.Lora': {},
    'modules.Image.Load': {},
    'modules.Image.Preview': {},
  };

  const quick = STUDIO_TEMPLATES.find((template) => template.id === 'z_image_quick_concept');
  const fastLora = STUDIO_TEMPLATES.find((template) => template.id === 'fast_lora');
  const fluxLora = STUDIO_TEMPLATES.find((template) => template.id === 'flux_lora_ghibli_story');
  const character = STUDIO_TEMPLATES.find((template) => template.id === 'character_edit');
  const control = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_control_image_layout');
  const upscale = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_upscale_finish');
  const inpaint = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_inpaint_mask_draft');
  const layered = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_layered_portrait');
  const outpaint = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_outpaint_aspect_template');
  const storm = STUDIO_TEMPLATES.find((template) => template.id === 'wan_vace_cinematic_text_to_video');
  assert.ok(
    quick && fastLora && fluxLora && character && control && upscale && inpaint && layered && outpaint && storm,
  );

  assert.equal(
    getTemplateReadiness(quick, readinessContext({ hfCache: ['Tongyi-MAI/Z-Image-Turbo'] })).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      character,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit-2511', 'lightx2v/Qwen-Image-Edit-2511-Lightning'],
        nodesRegistry: modularQwenEditRegistry,
      }),
    ).status,
    'ready',
  );
  const userInputQuick = {
    ...quick,
    inputRequirements: { sourceImage: true },
    inputBindings: [
      {
        id: 'user-source-image',
        label: 'Source image',
        mediaType: 'image',
        origin: 'user',
        requiredAt: 'workflow_start',
        field: 'referenceImages',
        count: 1,
      },
    ],
  };
  assert.equal(
    getTemplateReadiness(userInputQuick, readinessContext({ hfCache: ['Tongyi-MAI/Z-Image-Turbo'] })).status,
    'needs_input',
  );
  assert.equal(
    getTemplateReadiness(
      character,
      readinessContext({
        nodesRegistry: {
          ...modularQwenEditRegistry,
          'modules.ModularDiffusers.EncodePrompt': undefined,
        },
      }),
    ).status,
    'needs_backend',
  );
  const fluxLoraRegistry = {
    'modules.DiffusersImage.LoadPipeline': {},
    'modules.DiffusersImage.Generate': {},
    'modules.DiffusersImage.LoadAdapter': {},
    'modules.Image.Preview': {},
  };
  assert.deepEqual(
    getTemplateReadiness(fluxLora, readinessContext({ nodesRegistry: fluxLoraRegistry })).missingBackendCapabilities,
    [],
  );
  assert.deepEqual(
    getTemplateReadiness(
      fluxLora,
      readinessContext({
        nodesRegistry: {
          ...fluxLoraRegistry,
          'modules.DiffusersImage.LoadAdapter': undefined,
        },
      }),
    ).missingBackendCapabilities,
    ['pinned LoRA adapter verification'],
  );
  assert.equal(
    getTemplateReadiness(
      quick,
      readinessContext({
        autoResourcePlan: {
          status: 'needs_setup',
          selectedInstallTarget: {
            repo: 'Tongyi-MAI/Z-Image-Turbo',
            label: 'Z-Image Turbo',
            actionLabel: 'Install',
          },
        },
      }),
    ).status,
    'needs_model',
  );
  assert.equal(
    getTemplateReadiness(
      quick,
      readinessContext({
        hfCache: ['Tongyi-MAI/Z-Image-Turbo'],
        autoResourcePlan: {
          status: 'needs_setup',
          healthBadge: 'Failed here before',
          blockingReason: 'The installed model needs a different runtime configuration.',
        },
      }),
    ).status,
    'needs_setup',
  );
  assert.equal(getTemplateReadiness(quick, readinessContext({ modelIndexesRefreshing: true })).status, 'preparing');
  assert.equal(getTemplateReadiness(quick, readinessContext({ runtime: null })).status, 'needs_backend');
  const controlMissingBackend = getTemplateReadiness(
    control,
    readinessContext({
      hfCache: ['Qwen/Qwen-Image-2512', 'InstantX/Qwen-Image-ControlNet-Union'],
      nodesRegistry: { 'modules.ModularDiffusers.ModelsLoader': {} },
    }),
  );
  assert.equal(controlMissingBackend.status, 'needs_backend');
  assert.equal(controlMissingBackend.label, 'Backend blocked');
  assert.equal(
    getTemplateReadiness(
      control,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-2512', 'InstantX/Qwen-Image-ControlNet-Union'],
        nodesRegistry: baseRegistry,
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      fastLora,
      readinessContext({
        hfCache: ['Tongyi-MAI/Z-Image-Turbo'],
        nodesRegistry: { 'modules.ModularDiffusers.ModelsLoader': {} },
      }),
    ).status,
    'needs_backend',
  );
  const missingPinnedLora = getTemplateReadiness(
    fastLora,
    readinessContext({
      hfCache: ['Tongyi-MAI/Z-Image-Turbo'],
      nodesRegistry: {
        'modules.ModularDiffusers.ModelsLoader': {},
        'modules.ModularDiffusers.Lora': {},
      },
    }),
  );
  assert.equal(missingPinnedLora.status, 'needs_model');
  assert.deepEqual(missingPinnedLora.missingModelRepos, ['youknownothing/v1-realism-v1-adapter-ZIT-lora']);
  assert.deepEqual(missingPinnedLora.missingInputs, []);
  assert.equal(
    getTemplateReadiness(
      fastLora,
      readinessContext({
        hfCache: ['Tongyi-MAI/Z-Image-Turbo', 'youknownothing/v1-realism-v1-adapter-ZIT-lora'],
        nodesRegistry: {
          'modules.ModularDiffusers.ModelsLoader': {},
          'modules.ModularDiffusers.Lora': {},
        },
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      upscale,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-2512'],
        nodesRegistry: { 'modules.Image.Preview': {} },
      }),
    ).status,
    'needs_backend',
  );
  const missingUpscaler = getTemplateReadiness(
    upscale,
    readinessContext({
      hfCache: ['Qwen/Qwen-Image-2512'],
      nodesRegistry: {
        'modules.Spandrel.Upscaler': {},
        'modules.Image.Preview': {},
      },
    }),
  );
  assert.equal(missingUpscaler.status, 'needs_model');
  assert.deepEqual(missingUpscaler.missingModelRepos, ['amd/realesrgan-x4plus']);
  assert.deepEqual(missingUpscaler.missingInputs, []);
  assert.equal(
    getTemplateReadiness(
      upscale,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-2512', 'amd/realesrgan-x4plus'],
        nodesRegistry: {
          'modules.Spandrel.Upscaler': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'ready',
  );
  const stormRegistry = {
    'modules.DiffusersVideo.LoadPipeline': {},
    'modules.DiffusersVideo.Generate': {},
    'modules.Spandrel.Upscaler': {},
    'modules.Video.Export': {},
  };
  const stormMissingUpscaler = getTemplateReadiness(
    storm,
    readinessContext({
      hfCache: ['Wan-AI/Wan2.1-T2V-1.3B-Diffusers'],
      nodesRegistry: stormRegistry,
    }),
  );
  assert.equal(stormMissingUpscaler.status, 'needs_model');
  assert.deepEqual(stormMissingUpscaler.missingModelRepos, ['nateraw/real-esrgan']);
  assert.deepEqual(stormMissingUpscaler.missingInputs, []);
  assert.equal(
    getTemplateReadiness(
      storm,
      readinessContext({
        hfCache: ['Wan-AI/Wan2.1-T2V-1.3B-Diffusers', 'nateraw/real-esrgan'],
        nodesRegistry: stormRegistry,
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      inpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: { 'modules.DiffusersImage.LoadPipeline': {} },
      }),
    ).status,
    'needs_backend',
  );
  assert.equal(
    getTemplateReadiness(
      inpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: {
          'modules.DiffusersImage.LoadPipeline': {},
          'modules.DiffusersImage.Inpaint': {},
          'modules.Image.Load': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      layered,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Layered'],
        nodesRegistry: { 'modules.Image.Preview': {} },
      }),
    ).status,
    'needs_backend',
  );
  assert.equal(
    getTemplateReadiness(
      layered,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Layered'],
        nodesRegistry: {
          'modules.ModularDiffusers.DecodeLatents': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      outpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: {
          'modules.DiffusersImage.LoadPipeline': {},
          'modules.DiffusersImage.Inpaint': {},
          'modules.Image.Load': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'needs_backend',
  );
  assert.equal(
    getTemplateReadiness(
      outpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: {
          'modules.DiffusersImage.LoadPipeline': {},
          'modules.DiffusersImage.OutpaintCanvas': {},
          'modules.DiffusersImage.Inpaint': {},
          'modules.Image.Load': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'ready',
  );
});

test('template and run surfaces share one structured readiness decision with precise categories', () => {
  const quick = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'z_image_quick_concept');
  assert.ok(quick);

  const ready = readinessModule.getTemplateReadiness(
    quick,
    readinessContext({ hfCache: ['Tongyi-MAI/Z-Image-Turbo'] }),
  );
  assert.equal(ready.status, 'ready');
  assert.equal(ready.decision.state, 'ready');
  assert.equal(ready.decision.canRun, true);

  const sourceRequired = readinessModule.getTemplateReadiness(
    {
      ...quick,
      inputRequirements: { sourceImage: true },
      inputBindings: [
        {
          id: 'required-source',
          label: 'Source image',
          mediaType: 'image',
          origin: 'user',
          requiredAt: 'workflow_start',
          field: 'referenceImages',
          count: 1,
        },
      ],
    },
    readinessContext({ hfCache: ['Tongyi-MAI/Z-Image-Turbo'] }),
  );
  assert.equal(sourceRequired.status, 'needs_input');
  assert.equal(sourceRequired.decision.state, 'blocked');
  assert.equal(sourceRequired.decision.primaryIssue.category, 'asset');

  const integrityRepair = readinessModule.getTemplateReadiness(
    quick,
    readinessContext({
      autoResourcePlan: {
        status: 'needs_setup',
        repairRequired: true,
        selectedInstallTarget: {
          repo: 'Tongyi-MAI/Z-Image-Turbo',
          label: 'Z-Image Turbo',
          repair: true,
        },
      },
    }),
  );
  assert.equal(integrityRepair.status, 'needs_model');
  assert.equal(integrityRepair.decision.primaryIssue.category, 'model_integrity');

  const packageDecision = runReadinessModule.buildRunReadinessDecision([
    {
      id: 'package:missing',
      category: 'package',
      severity: 'error',
      message: 'Backend package missing',
      blocking: true,
      action: 'open_setup',
    },
  ]);
  assert.equal(packageDecision.state, 'blocked');
  assert.equal(packageDecision.canRun, false);
  assert.equal(packageDecision.primaryIssue.category, 'package');
});

test('template input readiness is isolated from the active workflow and distinguishes downstream graph inputs', () => {
  const character = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'character_edit');
  const userInputTemplate = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'wan_22_i2v_seed_vault',
  );
  const qwenOutpaint = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'qwen_outpaint_aspect_template',
  );
  const wanOutpaint = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'wan_vace_outpaint_reframe');
  assert.ok(character && userInputTemplate && qwenOutpaint && wanOutpaint);

  const userInputResolution = templateInputsModule.resolveTemplateInputs(userInputTemplate);
  assert.deepEqual(userInputResolution.missingLabels, ['1 reference image']);
  assert.equal(userInputResolution.templateDefaultBindings.length, 0);

  const characterResolution = templateInputsModule.resolveTemplateInputs(character);
  assert.deepEqual(characterResolution.missingLabels, []);
  assert.equal(characterResolution.templateDefaultBindings.length, 1);
  const wanResolution = templateInputsModule.resolveTemplateInputs(wanOutpaint);
  assert.deepEqual(wanResolution.missingLabels, []);
  assert.equal(wanResolution.templateDefaultBindings.length, 2);
  assert.deepEqual(
    wanResolution.templateDefaultBindings.map((binding) => binding.field),
    ['sourceVideo', 'maskVideo'],
  );

  const qwenResolution = templateInputsModule.resolveTemplateInputs(qwenOutpaint);
  assert.deepEqual(qwenResolution.missingLabels, []);
  assert.equal(qwenResolution.templateDefaultBindings.length, 1);
  assert.deepEqual(
    qwenResolution.downstreamBindings.map((binding) => [binding.producer.role, binding.producer.output]),
    [
      ['qwenOutpaintCanvas', 'image'],
      ['qwenOutpaintCanvas', 'mask'],
    ],
  );
});

test('Wan outpaint publishes byte-pinned runtime defaults and materializes backend paths before graph creation', async () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'wan_vace_outpaint_reframe');
  assert.ok(template);
  const bindings = template.inputBindings.filter((binding) => binding.origin === 'template');
  assert.equal(bindings.length, 2);
  const assetManifest = JSON.parse(await readFile(path.join(ROOT, 'config', 'template-assets.v1.json'), 'utf8'));
  const assetManifestByPath = new Map(assetManifest.assets.map((asset) => [asset.path, asset]));

  for (const binding of bindings) {
    for (const asset of binding.defaultAssets) {
      const storageRecord = assetManifestByPath.get(asset.runtimePath.replace(/^\/+/, ''));
      assert.ok(storageRecord, `${asset.id} is published in the storage manifest`);
      assert.equal(storageRecord.sha256, asset.runtimeSha256, `${asset.id} retains its reviewed runtime-byte identity`);
    }
  }
  assert.notEqual(
    bindings[0].defaultAssets[0].runtimePath,
    bindings[0].defaultAssets[0].previewPath,
    'the browser-safe Before derivative is not reused as the runtime source',
  );
  const changedInputTemplate = structuredClone(template);
  changedInputTemplate.inputBindings.find((binding) => binding.origin === 'template').defaultAssets[0].runtimeSha256 =
    'sha256:bytes:changed-reviewed-input';
  assert.notEqual(
    templateExactnessModule.getTemplateInputContractHash(changedInputTemplate),
    templateExactnessModule.getTemplateInputContractHash(template),
    'changing a bundled runtime input invalidates the gallery proof contract',
  );

  const uploaded = [];
  const expectedHashes = new Map(
    bindings.flatMap((binding) => binding.defaultAssets.map((asset) => [asset.id, asset.runtimeSha256])),
  );
  const patch = await templateInputsModule.materializeTemplateDefaultInputs(template, {
    load: async (asset) => new Blob([asset.id], { type: 'video/mp4' }),
    sha256: async (blob) => expectedHashes.get(await blob.text()),
    upload: async (file, mediaType) => {
      uploaded.push({ name: file.name, mediaType, contents: await file.text() });
      return `data/videos/${file.name}`;
    },
  });

  assert.deepEqual(
    patch,
    Object.fromEntries(bindings.map((binding) => [binding.field, `data/videos/${binding.defaultAssets[0].fileName}`])),
  );
  assert.deepEqual(
    uploaded.map(({ name, mediaType, contents }) => ({ name, mediaType, contents })),
    bindings.flatMap((binding) =>
      binding.defaultAssets.map((asset) => ({
        name: asset.fileName,
        mediaType: asset.mediaType,
        contents: asset.id,
      })),
    ),
  );

  let rejectedUploadCalls = 0;
  await assert.rejects(
    templateInputsModule.materializeTemplateDefaultInputs(template, {
      load: async () => new Blob(['stale-input'], { type: 'video/mp4' }),
      sha256: async () => 'sha256:bytes:stale-input',
      upload: async () => {
        rejectedUploadCalls += 1;
        return 'data/videos/should-not-exist.mp4';
      },
    }),
    /failed checksum verification/,
  );
  assert.equal(rejectedUploadCalls, 0, 'a stale bundled input is rejected before backend upload');
});

test('Qwen outpaint templates fully denoise the generated canvas boundary', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  for (const id of ['qwen_outpaint_aspect_template', 'qwen_outpaint_draft']) {
    const template = STUDIO_TEMPLATES.find((candidate) => candidate.id === id);
    assert.ok(template, `missing ${id}`);
    assert.equal(template.example.lockedSettings.strength, 1, `${id} must fill blank outpaint margins`);
  }
});

test('unknown template ids are discarded instead of entering persisted output state', () => {
  for (const template of [...templatesModule.STUDIO_TEMPLATES, ...templatesModule.PLANNING_STUDIO_TEMPLATES]) {
    assert.equal(
      outputContractsModule.coerceStudioTemplateId(template.id),
      template.id,
      `${template.id} remains accepted by persistence coercion`,
    );
  }
  const obsoleteTemplateId = 'obsolete_qwen_outpaint_template';
  assert.equal(outputContractsModule.coerceStudioTemplateId(obsoleteTemplateId), undefined);
  const output = outputContractsModule.coerceStudioOutput({
    id: 'obsolete-template-output',
    url: '/file?file=obsolete-template-output.png',
    mode: 'outpaint',
    modelType: 'QwenImageEditModularPipeline',
    templateId: obsoleteTemplateId,
    formSnapshot: {
      ...profilesModule.DEFAULT_STUDIO_FORM,
      mode: 'outpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
  });
  assert.equal(output.templateId, undefined);
});

test('template metadata declares graph blocks for recipes that need them', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  assert.deepEqual(STUDIO_TEMPLATES.find((template) => template.id === 'fast_lora')?.workflowBlocks, ['lora']);
  assert.deepEqual(STUDIO_TEMPLATES.find((template) => template.id === 'z_image_lora_style')?.workflowBlocks, ['lora']);
  assert.deepEqual(STUDIO_TEMPLATES.find((template) => template.id === 'qwen_upscale_finish')?.workflowBlocks, [
    'upscaler',
  ]);
});

test('Qwen Auto text-to-image templates lock quality-first Auto model-offload settings', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const ids = ['qwen_low_vram_text_rendering', 'qwen_low_vram_product_concept', 'qwen_low_vram_poster_layout'];
  const expectedDimensions = {
    qwen_low_vram_text_rendering: [1024, 1024],
    qwen_low_vram_product_concept: [1024, 768],
    qwen_low_vram_poster_layout: [768, 1024],
  };
  for (const id of ids) {
    const template = STUDIO_TEMPLATES.find((item) => item.id === id);
    assert.ok(template, `${id} exists`);
    assert.equal(template.mode, 'text_to_image');
    assert.equal(template.modelType, 'QwenImageModularPipeline');
    assert.notEqual(template.category, 'upscale');
    assert.ok(template.tags.includes('low vram'));
    assert.ok(template.requiredBackendCapabilities.includes('Qwen direct Auto Diffusers path'));
    assert.equal(template.example.lockedSettings.resourceMode, 'auto');
    assert.equal(template.example.lockedSettings.width, expectedDimensions[id][0]);
    assert.equal(template.example.lockedSettings.height, expectedDimensions[id][1]);
    assert.equal(template.example.lockedSettings.steps, 50);
    assert.equal(template.example.lockedSettings.guidanceScale, 4);
    assert.equal(template.example.lockedSettings.quantizationMode, 'none');
    assert.equal(template.example.lockedSettings.offloadMode, 'model_cpu');
    assert.equal(template.example.lockedSettings.autoOffload, true);
  }
});

test('published FLUX-dev base and LoRA templates allow Auto to choose hardware placement', () => {
  const ids = [
    'flux_dev_expert_text_to_image',
    'flux_lora_ghibli_story',
    'flux_lora_oil_painting',
    'flux_lora_film_noir',
    'flux_lora_retro_comic',
    'flux_lora_watercolor',
    'flux_lora_paper_cutout',
    'flux_lora_photoreal_documentary',
  ];
  for (const id of ids) {
    const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === id);
    assert.ok(template, `${id} exists`);
    assert.equal(template.modelType, 'FluxDevPipeline');
    assert.equal(template.example.lockedSettings.resourceMode, 'auto');
  }
});

test('Qwen ControlNet keeps diffusion guidance separate from the bounded control scale', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'qwen_control_image_layout');
  assert.ok(template);
  assert.equal(template.example.lockedSettings.guidanceScale, 4);
  assert.equal(template.example.lockedSettings.conditioningScale, 1.2);
  assert.equal(template.example.lockedSettings.resourceMode, 'auto');
  assert.equal(template.example.lockedSettings.quantizationMode, 'none');
  assert.equal(template.example.lockedSettings.offloadMode, 'none');
});

test('High-detail Qwen template exposes the documentary bakery preview and Auto settings', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const template = STUDIO_TEMPLATES.find((item) => item.id === 'high_quality');
  assert.ok(template);
  assert.equal(template.mode, 'text_to_image');
  assert.equal(template.modelType, 'QwenImageModularPipeline');
  assert.match(template.userGoal, /documentary bakery preview/);
  assert.ok(template.tags.includes('bakery documentary'));
  assert.ok(template.requiredBackendCapabilities.includes('Qwen direct Auto Diffusers path'));
  assert.deepEqual(template.mediaSlots, [
    {
      id: 'primary',
      label: 'Preview',
      kind: 'image',
      role: 'preview',
      path: '/template-gallery/high_quality.webp',
      placeholder: 'image example pending',
    },
  ]);
  assert.equal(template.example.lockedSettings.resourceMode, 'auto');
  assert.equal(template.example.lockedSettings.width, 1024);
  assert.equal(template.example.lockedSettings.height, 1024);
  assert.equal(template.example.lockedSettings.steps, 50);
  assert.equal(template.example.lockedSettings.guidanceScale, 4);
  assert.equal(template.example.lockedSettings.quantizationMode, 'none');
  assert.equal(template.example.lockedSettings.offloadMode, 'model_cpu');
  assert.equal(template.example.lockedSettings.autoOffload, true);
});

test('Qwen model profiles show exact repo-backed model names', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.QwenImageModularPipeline;
  const editProfile = profilesModule.STUDIO_MODEL_PROFILES.QwenImageEditModularPipeline;
  const editPlusProfile = profilesModule.STUDIO_MODEL_PROFILES.QwenImageEditPlusModularPipeline;
  const editPlusAuto = profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.QwenImageEditPlusModularPipeline;
  assert.equal(profile.label, 'Qwen-Image-2512');
  assert.equal(profile.displayName, 'Qwen-Image-2512');
  assert.equal(profile.defaultRepo, 'Qwen/Qwen-Image-2512');
  assert.equal(profile.alternateArtifact, undefined);
  assert.equal(editProfile.supportsMask, true);
  assert.equal(editProfile.inpaintContract.available, true);
  assert.equal(editProfile.inpaintContract.source, 'modules.DiffusersImage.Inpaint');
  assert.deepEqual(editProfile.modes, ['edit_image', 'inpaint', 'outpaint']);
  assert.deepEqual(profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.QwenImageEditModularPipeline.supportedModes, [
    'edit_image',
    'inpaint',
    'outpaint',
  ]);
  assert.deepEqual(editPlusProfile.modes, ['edit_image', 'multi_image_reference_edit']);
  assert.deepEqual(editPlusAuto.supportedModes, ['edit_image', 'multi_image_reference_edit']);
  assert.equal(editPlusProfile.inpaintContract.available, false);
  assert.equal(profilesModule.isModelCompatibleWithMode('QwenImageEditPlusModularPipeline', 'inpaint'), false);
  assert.equal(profilesModule.isModelCompatibleWithMode('QwenImageEditModularPipeline', 'inpaint'), true);
  assert.deepEqual(profile.offloadSupport.modes, ['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk']);
  assert.equal(profile.offloadSupport.default, 'model_cpu');
  assert.equal(profile.offloadSupport.lowVram, 'model_cpu');
  assert.equal(
    profilesModule.getStudioModelRuntimeLabel(profile, {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'auto_cpu',
    }),
    'Qwen/Qwen-Image-2512 · bfloat16 · model-cpu',
  );
  assert.equal(
    profilesModule.getStudioModelRuntimeLabel(profile, {
      dtype: 'bfloat16',
      quantizationMode: 'bnb_4bit',
      autoOffload: true,
      offloadMode: 'model_cpu',
    }),
    'Qwen/Qwen-Image-2512 · bfloat16 · bnb_4bit · model-cpu',
  );
});

test('every Studio model declares Auto requirements or an explicit Manual-only reason', () => {
  const profileIds = Object.keys(profilesModule.STUDIO_MODEL_PROFILES).sort();
  const requirementIds = Object.keys(profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS).sort();
  assert.deepEqual(requirementIds, profileIds);

  for (const id of profileIds) {
    const requirement = profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS[id];
    assert.ok(requirement.minimum, `${id} declares minimum hardware requirements`);
    assert.ok(requirement.recommended, `${id} declares recommended hardware requirements`);
    assert.ok(requirement.qualityDefaults, `${id} declares quality-safe defaults`);
    assert.ok(requirement.artifacts.length > 0, `${id} declares required artifacts`);
    if (requirement.autoStatus === 'manual_only') {
      assert.ok(requirement.manualOnlyReason, `${id} explains why Auto is not enabled`);
    }
  }
});

test('Studio form migration normalizes legacy auto_cpu offload', () => {
  const legacy = outputContractsModule.coerceStudioFormState({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'QwenImageModularPipeline',
    offloadMode: 'auto_cpu',
  });
  assert.equal(legacy.offloadMode, 'model_cpu');

  const zImage = outputContractsModule.coerceStudioFormState({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'ZImageModularPipeline',
    quantizationMode: 'bnb_4bit',
    offloadMode: 'group_disk',
  });
  assert.equal(zImage.quantizationMode, 'none');
  assert.equal(zImage.offloadMode, 'group_disk');
});

test('every registered Studio model survives persisted form and binding validation', () => {
  for (const modelType of Object.keys(profilesModule.STUDIO_MODEL_PROFILES)) {
    const form = outputContractsModule.coerceStudioFormState({
      ...profilesModule.DEFAULT_STUDIO_FORM,
      modelType,
    });
    assert.equal(form.modelType, modelType, `${modelType} must not be replaced while restoring a workflow form`);

    const binding = outputContractsModule.coerceStudioGraphBinding({
      mode: form.mode,
      modelType,
      nodes: {},
      managedNodeIds: [],
      managedEdgeIds: [],
      fingerprint: `${form.mode}:${modelType}`,
      createdAt: 1,
      updatedAt: 1,
    });
    assert.equal(binding?.modelType, modelType, `${modelType} must not be replaced while restoring graph binding`);
  }
});

test('completed graph finalization proofs survive persistence validation', () => {
  const proof = {
    schemaVersion: 2,
    shapeKey: 'edit_image:QwenImageEditModularPipeline:expert:none:models|prompt|denoise',
    fieldSchemaHash: 'graph-v1-0123abcd',
    edgeSpecHash: 'graph-v1-4567cdef',
    finalizedAt: 1234,
  };
  const binding = outputContractsModule.coerceStudioGraphBinding({
    mode: 'edit_image',
    modelType: 'QwenImageEditModularPipeline',
    nodes: {},
    managedNodeIds: [],
    managedEdgeIds: [],
    fingerprint: 'edit_image:QwenImageEditModularPipeline:expert:none',
    finalizationProof: proof,
    createdAt: 1,
    updatedAt: 2,
  });
  assert.deepEqual(binding?.finalizationProof, proof);

  const malformed = outputContractsModule.coerceStudioGraphBinding({
    ...binding,
    finalizationProof: { ...proof, schemaVersion: 1 },
  });
  assert.equal(malformed?.finalizationProof, undefined);
  assert.equal(malformed?.finalizationProofInvalid, true);
});

test('Studio execution-spec receipts are exact and malformed persistence is quarantined', () => {
  const executionSpec = {
    schemaVersion: 1,
    id: 'flux-schnell:text-to-image:v1',
    contentHash: 'studio-spec-v1-9cd1abb5',
    executionProfileId: 'flux-schnell:direct',
  };
  const base = {
    mode: 'text_to_image',
    modelType: 'FluxSchnellPipeline',
    nodes: {},
    managedNodeIds: [],
    managedEdgeIds: [],
    fingerprint: 'text_to_image:FluxSchnellPipeline:expert:none',
    executionSpec,
    createdAt: 1,
    updatedAt: 2,
  };
  const binding = outputContractsModule.coerceStudioGraphBinding(base);
  assert.deepEqual(binding?.executionSpec, executionSpec);
  assert.equal(binding?.finalizationProofInvalid, undefined);

  for (const malformedReceipt of [
    { ...executionSpec, schemaVersion: 2 },
    { ...executionSpec, id: 'invalid receipt' },
    { ...executionSpec, contentHash: 'studio-spec-v1-not-a-hash' },
    { ...executionSpec, executionProfileId: '' },
    { ...executionSpec, unexpected: true },
  ]) {
    const malformed = outputContractsModule.coerceStudioGraphBinding({ ...base, executionSpec: malformedReceipt });
    assert.equal(malformed?.executionSpec, undefined);
    assert.equal(malformed?.finalizationProofInvalid, true);
  }
});

test('controlled graph declarations require an exact schema-v3 persistence proof', () => {
  const controlled = {
    schemaVersion: 1,
    contractRevision: 1,
    contractIds: ['upscale.video.v1'],
  };
  const proof = {
    schemaVersion: 3,
    canonicalizationVersion: 1,
    contractRevision: 1,
    shapeKey: 'text_to_video:WanVideoPipeline:expert:none:runtime|generate|export',
    fieldSchemaHash: 'graph-v1-0123abcd',
    managedGraphHash: 'graph-v1-4567cdef',
    contractIds: controlled.contractIds,
    finalizedAt: 1234,
  };
  const base = {
    mode: 'text_to_video',
    modelType: 'WanVideoPipeline',
    nodes: {},
    managedNodeIds: [],
    managedEdgeIds: [],
    fingerprint: 'text_to_video:WanVideoPipeline:expert:none',
    controlled,
    finalizationProof: proof,
    createdAt: 1,
    updatedAt: 2,
  };
  const binding = outputContractsModule.coerceStudioGraphBinding(base);
  assert.deepEqual(binding?.controlled, controlled);
  assert.deepEqual(binding?.finalizationProof, proof);
  assert.equal(binding?.finalizationProofInvalid, undefined);

  const malformedCases = [
    { ...base, controlled: { ...controlled, contractIds: ['unknown.v1'] } },
    { ...base, finalizationProof: { ...proof, schemaVersion: 2, edgeSpecHash: 'graph-v1-89abcdef' } },
    { ...base, finalizationProof: { ...proof, managedGraphHash: 'not-a-proof-hash' } },
    { ...base, finalizationProof: { ...proof, contractIds: ['soundtrack.v1'] } },
  ];
  malformedCases.forEach((value) => {
    const malformed = outputContractsModule.coerceStudioGraphBinding(value);
    assert.equal(malformed?.finalizationProof, undefined);
    assert.equal(malformed?.finalizationProofInvalid, true);
  });
});

test('Qwen-Image-2512 Auto remains backend-owned while Expert blocks unsafe settings', () => {
  const form = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    device: 'cuda:0',
    dtype: 'bfloat16',
    autoOffload: true,
    quantizationMode: 'none',
  };
  const issue = runReadinessModule.getStudioCudaCapacityIssue(
    form,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  );
  assert.equal(issue, null, 'Auto hardware compatibility must come from the backend plan');

  const manualIssue = runReadinessModule.getStudioCudaCapacityIssue(
    { ...form, resourceMode: 'manual' },
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  );
  assert.equal(manualIssue, null);

  const roomyIssue = runReadinessModule.getStudioCudaCapacityIssue(
    { ...form, resourceMode: 'manual' },
    runtimeStatus({
      totalBytes: 24 * 1024 ** 3,
      freeBytes: 18 * 1024 ** 3,
    }),
  );
  assert.equal(roomyIssue, null);

  const float32Issue = runReadinessModule.getStudioCudaCapacityIssue(
    { ...form, resourceMode: 'manual', dtype: 'float32' },
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  );
  assert.equal(float32Issue.blocking, true);
  assert.match(float32Issue.message, /bfloat16/);

  const offloadIssue = runReadinessModule.getStudioCudaCapacityIssue(
    { ...form, resourceMode: 'manual', autoOffload: false },
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  );
  assert.equal(offloadIssue.blocking, true);
  assert.match(offloadIssue.message, /auto-offload/);

  const residentQuantizedIssue = runReadinessModule.getStudioCudaCapacityIssue(
    {
      ...form,
      resourceMode: 'expert',
      autoOffload: false,
      quantizationMode: 'bnb_4bit',
    },
    runtimeStatus({
      totalBytes: 24 * 1024 ** 3,
      freeBytes: 22 * 1024 ** 3,
    }),
  );
  assert.equal(residentQuantizedIssue, null);

  const residentBfloat16Issue = runReadinessModule.getStudioCudaCapacityIssue(
    {
      ...form,
      resourceMode: 'expert',
      autoOffload: false,
      quantizationMode: 'none',
    },
    runtimeStatus({
      totalBytes: 96 * 1024 ** 3,
      freeBytes: 90 * 1024 ** 3,
    }),
  );
  assert.equal(residentBfloat16Issue, null);

  const autoCandidate = {
    id: 'qwen-auto-offload',
    requirements: { vramBytes: 10 * 1024 ** 3 },
  };
  assert.equal(
    runReadinessModule.getStudioCudaRecipePressureIssue(
      { ...form, resourceMode: 'auto' },
      autoCandidate,
      runtimeStatus({
        totalBytes: 96 * 1024 ** 3,
        freeBytes: 90 * 1024 ** 3,
      }),
    ),
    null,
  );
  const equalCapacityIssue = runReadinessModule.getStudioCudaRecipePressureIssue(
    { ...form, resourceMode: 'auto' },
    autoCandidate,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 10 * 1024 ** 3,
    }),
  );
  assert.equal(equalCapacityIssue, null, 'frontend pressure estimates must not override an Auto plan');

  const queuedIssue = runReadinessModule.getStudioCudaRecipePressureIssue(
    { ...form, resourceMode: 'auto' },
    autoCandidate,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 2 * 1024 ** 3,
    }),
    null,
    {
      activeWorkflowTabId: 'waiting-workflow',
      currentTask: {
        name: 'LTX image to video',
        status: 'running',
        task_id: 'active-task',
        workflow_tab_id: 'active-workflow',
        workflow_title: 'Current video render',
      },
    },
  );
  assert.equal(queuedIssue.blocking, false);
  assert.equal(queuedIssue.severity, 'info');
  assert.match(queuedIssue.message, /will run after Current video render/);
  assert.match(queuedIssue.details, /memory used by the active MoDiff run is temporary/);

  const ownRunIssue = runReadinessModule.getStudioCudaRecipePressureIssue(
    { ...form, resourceMode: 'auto' },
    autoCandidate,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 2 * 1024 ** 3,
    }),
    null,
    {
      activeWorkflowTabId: 'active-workflow',
      currentTask: {
        name: 'LTX image to video',
        status: 'running',
        task_id: 'active-task',
        workflow_tab_id: 'active-workflow',
      },
    },
  );
  assert.equal(ownRunIssue, null);

  const missingQuantNodeIssue = runReadinessModule.getStudioQuantizationCapabilityIssue(
    { ...form, resourceMode: 'manual', quantizationMode: 'bnb_4bit' },
    {
      'modules.ModularDiffusers.ModelsLoader': {},
    },
  );
  assert.equal(missingQuantNodeIssue.blocking, true);
  assert.match(missingQuantNodeIssue.details, /QuantizationConfigNode/);

  const quantNodeReadyIssue = runReadinessModule.getStudioQuantizationCapabilityIssue(
    { ...form, resourceMode: 'manual', quantizationMode: 'bnb_4bit' },
    {
      'modules.ModularDiffusers.ModelsLoader': {
        params: {
          offload_mode: { options: ['none', 'model_cpu', 'group_cpu', 'group_disk'] },
        },
      },
      'modules.ModularDiffusers.QuantizationConfigNode': {
        params: {
          component: { options: ['transformer', 'text_encoder', 'qwen_low_vram'] },
        },
      },
    },
  );
  assert.equal(quantNodeReadyIssue, null);

  const missingOffloadIssue = runReadinessModule.getStudioOffloadCapabilityIssue(
    { ...form, resourceMode: 'manual', offloadMode: 'group_disk' },
    {
      'modules.ModularDiffusers.ModelsLoader': {
        params: {
          offload_mode: { options: ['auto_cpu', 'group_cpu'] },
        },
      },
    },
  );
  assert.equal(missingOffloadIssue.blocking, true);
  assert.match(missingOffloadIssue.details, /offload_mode/);

  const legacyModelCpuOffloadIssue = runReadinessModule.getStudioOffloadCapabilityIssue(
    { ...form, resourceMode: 'manual', offloadMode: 'model_cpu' },
    {
      'modules.ModularDiffusers.ModelsLoader': {
        params: {
          offload_mode: { options: ['auto_cpu', 'group_cpu'] },
        },
      },
    },
  );
  assert.equal(legacyModelCpuOffloadIssue, null);

  const audioForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_audio',
    modelType: 'AceStepAudioPipeline',
    resourceMode: 'expert',
    device: 'cuda:0',
    autoOffload: true,
    offloadMode: 'model_cpu',
  };
  const structuredAudioOffloadIssue = runReadinessModule.getStudioOffloadCapabilityIssue(audioForm, {
    'modules.DiffusersAudio.LoadPipeline': {
      params: {
        offload_mode: {
          options: [
            optionDescriptor('none', { label: 'Off' }),
            optionDescriptor('model_cpu', { label: 'RAM/CPU model offload' }),
            optionDescriptor('sequential_cpu'),
          ],
        },
      },
    },
  });
  assert.equal(
    structuredAudioOffloadIssue,
    null,
    'real /nodes descriptors must not make supported audio offload look unavailable',
  );

  const unavailableAudioOffloadIssue = runReadinessModule.getStudioOffloadCapabilityIssue(audioForm, {
    'modules.DiffusersAudio.LoadPipeline': {
      params: {
        offload_mode: {
          options: [
            optionDescriptor('none', { label: 'Off' }),
            optionDescriptor('model_cpu', {
              compatibility: 'incompatible',
              availability: 'unavailable',
              installationState: 'unavailable',
              disabledReason: 'Unavailable in this runtime.',
            }),
          ],
        },
      },
    },
  });
  assert.equal(unavailableAudioOffloadIssue.blocking, true);
  assert.doesNotMatch(unavailableAudioOffloadIssue.details, /\[object Object\]/);

  const missingInpaintNodeIssue = runReadinessModule.getStudioQwenInpaintCapabilityIssue(
    {
      ...form,
      mode: 'inpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
    {
      'modules.DiffusersImage.LoadPipeline': {},
    },
  );
  assert.equal(missingInpaintNodeIssue.blocking, true);
  assert.match(missingInpaintNodeIssue.details, /modules\.DiffusersImage\.Inpaint/);

  const inpaintNodesReadyIssue = runReadinessModule.getStudioQwenInpaintCapabilityIssue(
    {
      ...form,
      mode: 'inpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
    {
      'modules.DiffusersImage.LoadPipeline': {},
      'modules.DiffusersImage.Inpaint': {},
    },
  );
  assert.equal(inpaintNodesReadyIssue, null);

  const genericInpaintNodesReadyIssue = runReadinessModule.getStudioQwenInpaintCapabilityIssue(
    {
      ...form,
      mode: 'inpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
    {
      'modules.DiffusersImage.LoadPipeline': {},
      'modules.DiffusersImage.Inpaint': {},
    },
  );
  assert.equal(genericInpaintNodesReadyIssue, null);
});

test('Auto resource setup offers app-driven repair for incomplete artifacts', () => {
  const plan = {
    status: 'needs_setup',
    statusLabel: 'Needs setup',
    blockingReason: 'Cached artifact snapshot is incomplete; missing text_encoder/model-00001-of-00002.safetensors.',
    candidates: [
      {
        id: 'qwen-t2i-prequantized-model-cpu',
        rank: 1,
        artifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
        resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
        installed: true,
        artifactStatus: {
          installed: true,
          complete: false,
          reason: 'Cached artifact snapshot is incomplete; missing text_encoder/model-00001-of-00002.safetensors.',
          missingFiles: ['text_encoder/model-00001-of-00002.safetensors'],
        },
        proof: {
          status: 'skipped',
          message: 'Cached artifact snapshot is incomplete.',
        },
      },
    ],
  };

  assert.equal(autoResourceModule.autoPlanIsReady(plan), false);
  const target = autoResourceModule.autoResourceInstallTarget(plan);
  assert.deepEqual(target, {
    repo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
    label: 'Auto artifact',
    reason: 'Cached artifact snapshot is incomplete; missing text_encoder/model-00001-of-00002.safetensors.',
    actionLabel: 'Repair Auto artifact',
    repair: true,
    candidateId: 'qwen-t2i-prequantized-model-cpu',
  });
});

test('Studio resource plans expose user-facing execution path labels', () => {
  const qwenAutoForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    resourceMode: 'auto',
    device: 'cuda:0',
  };
  const qwenAutoPlan = resourcePlannerModule.resolveStudioResourcePlan(qwenAutoForm, {
    runtimeStatus: runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  });
  assert.equal(qwenAutoPlan.executionPath, 'direct-diffusers-image');
  assert.equal(resourcePlannerModule.getStudioResourceExecutionPathLabel(qwenAutoPlan), 'Auto: Diffusers image');

  const qwenExpertPlan = resourcePlannerModule.resolveStudioResourcePlan({
    ...qwenAutoForm,
    resourceMode: 'expert',
  });
  assert.equal(qwenExpertPlan.executionPath, 'modular-diffusers');
  assert.equal(resourcePlannerModule.getStudioResourceExecutionPathLabel(qwenExpertPlan), 'Expert: full graph');
  assert.deepEqual(qwenExpertPlan.retryPlans, [], 'Expert must not retry through the direct-image Auto branch');

  const zImagePlan = resourcePlannerModule.resolveStudioResourcePlan({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'ZImageModularPipeline',
  });
  assert.equal(zImagePlan.executionPath, 'modular-diffusers');
  assert.equal(resourcePlannerModule.getStudioResourceExecutionPathLabel(zImagePlan), 'Auto: Modular graph');
  assert.equal(
    resourcePlannerModule.getStudioResourceExecutionPathLabel({
      ...zImagePlan,
      executionPath: 'direct-diffusers-image',
    }),
    'Auto: Diffusers image',
  );
});

test('all Studio profiles and templates keep offload plans compatible with their execution device', () => {
  const unsupportedDevices = ['cpu:0', 'mps:0', 'xpu:0'];
  const requestedOffloadModes = ['model_cpu', 'sequential_cpu'];

  for (const profile of Object.values(profilesModule.STUDIO_MODEL_PROFILES)) {
    for (const mode of profile.modes) {
      const defaults = profilesModule.getFormDefaultsForMode(mode, profile.modelType);
      for (const device of unsupportedDevices) {
        for (const offloadMode of requestedOffloadModes) {
          const input = {
            ...defaults,
            device,
            autoOffload: true,
            offloadMode,
          };
          const resolved = resourcePlannerModule.resolveStudioResourceForm(input);
          const plan = resourcePlannerModule.resolveStudioResourcePlan(input);
          assert.equal(resolved.autoOffload, false, `${profile.modelType}|${mode}|${device} form`);
          assert.equal(resolved.offloadMode, 'none', `${profile.modelType}|${mode}|${device} form`);
          assert.equal(plan.autoOffload, false, `${profile.modelType}|${mode}|${device} plan`);
          assert.equal(plan.offloadMode, 'none', `${profile.modelType}|${mode}|${device} plan`);
          assert.deepEqual(plan.retryOffloadModes, [], `${profile.modelType}|${mode}|${device} retries`);
          const expert = resourcePlannerModule.resolveStudioResourceForm({
            ...input,
            resourceMode: 'expert',
          });
          assert.equal(expert.autoOffload, false, `${profile.modelType}|${mode}|${device} expert form`);
          assert.equal(expert.offloadMode, 'none', `${profile.modelType}|${mode}|${device} expert form`);
        }
      }

      const cudaInput = {
        ...defaults,
        device: 'cuda:0',
        autoOffload: true,
        offloadMode: profile.offloadSupport.default,
      };
      const cudaPlan = resourcePlannerModule.resolveStudioResourcePlan(cudaInput);
      assert.equal(cudaPlan.offloadMode, profile.offloadSupport.default, `${profile.modelType}|${mode}|cuda`);
      assert.equal(cudaPlan.autoOffload, profile.offloadSupport.default !== 'none');
    }
  }

  for (const template of templatesModule.STUDIO_TEMPLATES) {
    const defaults = profilesModule.getFormDefaultsForMode(template.mode, template.modelType);
    const locked = templateExactnessModule.getTemplateLockedSettings(template);
    for (const device of unsupportedDevices) {
      const resolved = resourcePlannerModule.resolveStudioResourceForm({
        ...defaults,
        ...locked,
        device,
        autoOffload: true,
        offloadMode: 'model_cpu',
      });
      assert.equal(resolved.autoOffload, false, `${template.id}|${device}`);
      assert.equal(resolved.offloadMode, 'none', `${template.id}|${device}`);
    }
  }
});

test('Auto plans, form patches, cache keys, readiness, and persisted managed nodes share the device contract', () => {
  const cpuForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'QwenImageModularPipeline',
    device: 'cpu:0',
    autoOffload: false,
    offloadMode: 'none',
  };
  const cudaForm = {
    ...cpuForm,
    device: 'cuda:0',
    autoOffload: true,
    offloadMode: 'model_cpu',
  };
  const offloadCandidate = {
    id: 'qwen-model-cpu',
    offloadMode: 'model_cpu',
    autoOffload: true,
    proof: { status: 'passed' },
  };
  const offloadPlan = {
    status: 'ready',
    selectedCandidate: offloadCandidate,
    candidates: [offloadCandidate],
  };
  assert.equal(autoResourceModule.autoPlanIsReady(offloadPlan, cudaForm), true);
  assert.equal(autoResourceModule.autoPlanIsReady(offloadPlan, cpuForm), false);
  assert.equal(autoResourceModule.selectedAutoCandidate(offloadPlan, cpuForm), null);
  assert.deepEqual(autoResourceModule.formPatchForAutoCandidate(offloadCandidate, cpuForm), {
    resourceMode: 'auto',
    autoOffload: false,
    offloadMode: 'none',
  });
  assert.notEqual(autoResourceModule.autoPlanKeyForForm(cpuForm), autoResourceModule.autoPlanKeyForForm(cudaForm));

  const studioBefore = studioStoreModule.useStudioStore.getState();
  const residentCandidate = {
    id: 'qwen-resident',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    offloadMode: 'none',
    proof: { status: 'live_proven' },
  };
  const residentPlan = {
    status: 'ready',
    selectedCandidate: residentCandidate,
    candidates: [residentCandidate],
  };
  try {
    studioStoreModule.useStudioStore.setState({
      form: {
        ...cudaForm,
        resourceMode: 'auto',
        quantizationMode: 'bnb_4bit',
        autoOffload: true,
        offloadMode: 'model_cpu',
      },
      autoResourcePlan: null,
      autoResourcePlans: {},
    });
    const current = studioStoreModule.useStudioStore.getState().form;
    studioStoreModule.useStudioStore
      .getState()
      .applyAutoResourcePlan(residentPlan, autoResourceModule.formPatchForAutoCandidate(residentCandidate, current));
    const committed = studioStoreModule.useStudioStore.getState();
    assert.equal(committed.form.quantizationMode, 'none');
    assert.equal(committed.form.autoOffload, false);
    assert.equal(committed.form.offloadMode, 'none');
    assert.equal(committed.autoResourcePlan, residentPlan);
  } finally {
    studioStoreModule.useStudioStore.setState({
      form: studioBefore.form,
      autoResourcePlan: studioBefore.autoResourcePlan,
      autoResourcePlans: studioBefore.autoResourcePlans,
    });
  }

  for (const device of ['cpu:0', 'mps:0', 'xpu:0']) {
    const issue = runReadinessModule.getStudioDeviceOffloadIssue({
      ...cpuForm,
      device,
      autoOffload: true,
      offloadMode: 'model_cpu',
    });
    assert.equal(issue?.blocking, true, device);
    assert.match(issue?.details ?? '', /CUDA or ROCm/);
  }
  assert.equal(runReadinessModule.getStudioDeviceOffloadIssue(cudaForm), null);

  const previousGraph = flowStoreModule.useFlowStore.getState().toObject();
  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      {
        id: 'manual-loader',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.ModularDiffusers',
          action: 'ModelsLoader',
          label: 'Load models',
          params: {
            device: { value: 'cpu:0' },
            auto_offload: { value: true },
            offload_mode: { value: 'model_cpu' },
          },
        },
      },
    ],
    edges: [],
  });
  try {
    const graphIssues = runReadinessModule.collectGraphDeviceOffloadIssues();
    assert.equal(graphIssues.length, 1);
    assert.equal(graphIssues[0].blocking, true);
    assert.equal(graphIssues[0].nodeId, 'manual-loader');
  } finally {
    flowStoreModule.useFlowStore.getState().replaceGraph(previousGraph);
  }

  const managedNode = {
    id: 'managed-loader',
    data: {
      studioOwned: true,
      params: {
        device: { value: 'cpu:0' },
        auto_offload: { value: true },
        offload_mode: { value: 'model_cpu' },
      },
    },
  };
  const customNode = {
    id: 'custom-loader',
    data: {
      params: {
        device: { value: 'cpu:0' },
        auto_offload: { value: true },
        offload_mode: { value: 'model_cpu' },
      },
    },
  };
  const migrated = studioStoreModule.normalizeManagedSnapshotExecutionPlan([managedNode, customNode], cpuForm, null);
  assert.deepEqual(
    Object.fromEntries(Object.entries(migrated[0].data.params).map(([key, value]) => [key, value.value])),
    { device: 'cpu:0', auto_offload: false, offload_mode: 'none' },
  );
  assert.equal(migrated[1].data.params.auto_offload.value, true, 'manual graphs are blocked, not silently rewritten');
});

test('canonical workflow generation normalizes unsupported devices and preserves CUDA/ROCm offload', () => {
  for (const device of ['cpu:0', 'mps:0', 'xpu:0']) {
    const node = {
      data: {
        params: {
          device: { value: device },
          auto_offload: { value: true },
          offload_mode: { value: 'sequential_cpu' },
        },
      },
    };
    assert.match(workflowNodeDeviceOffloadError(node), /offload/);
    normalizePortableWorkflowNodeOffload(node);
    assert.equal(node.data.params.auto_offload.value, false);
    assert.equal(node.data.params.offload_mode.value, 'none');
    assert.equal(workflowNodeDeviceOffloadError(node), null);
  }

  const cudaNode = {
    data: {
      params: {
        device: { value: 'cuda:0' },
        auto_offload: { value: true },
        offload_mode: { value: 'model_cpu' },
      },
    },
  };
  normalizePortableWorkflowNodeOffload(cudaNode);
  assert.equal(cudaNode.data.params.auto_offload.value, true);
  assert.equal(cudaNode.data.params.offload_mode.value, 'model_cpu');
  assert.equal(workflowNodeDeviceOffloadError(cudaNode), null);
});

test('Studio runtime hints preserve the exact Qwen Auto recipe without a client-owned CUDA budget', () => {
  const totalBytes = 16 * 1024 ** 3;
  const freeBytes = 15 * 1024 ** 3;
  nodesStoreModule.useNodesStore.setState({ runtimeStatus: runtimeStatus({ totalBytes, freeBytes }) });
  studioStoreModule.useStudioStore.setState({
    form: {
      ...profilesModule.DEFAULT_STUDIO_FORM,
      mode: 'text_to_image',
      modelType: 'QwenImageModularPipeline',
      device: 'cuda:0',
      dtype: 'bfloat16',
      resourceMode: 'auto',
      quantizationMode: 'none',
      autoOffload: true,
      offloadMode: 'model_cpu',
    },
    autoResourcePlan: {
      status: 'ready',
      statusLabel: 'Ready with local Auto recipe',
      selectedCandidate: {
        id: 'qwen-t2i-prequantized-model-cpu',
        executionProfileId: 'qwen-image:t2i-direct',
        modelType: 'QwenImageModularPipeline',
        mode: 'text_to_image',
        loaderModule: 'modules.DiffusersImage',
        loaderAction: 'LoadPipeline',
        executionPath: 'direct-diffusers-image',
        pipelineClass: 'QwenImagePipeline',
        modelRepo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
        resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
        dtype: 'bfloat16',
        quantizationMode: 'none',
        quantizedComponents: [],
        offloadMode: 'model_cpu',
        generation: {
          width: 1024,
          height: 1024,
          steps: 50,
          guidanceScale: 4,
          negativePrompt: ' ',
          maxSequenceLength: 512,
        },
        proof: { status: 'declared_safe', source: 'static_auto_requirements' },
      },
      candidates: [
        {
          id: 'qwen-t2i-prequantized-model-cpu',
          executionProfileId: 'qwen-image:t2i-direct',
          modelType: 'QwenImageModularPipeline',
          mode: 'text_to_image',
          loaderModule: 'modules.DiffusersImage',
          loaderAction: 'LoadPipeline',
          executionPath: 'direct-diffusers-image',
          pipelineClass: 'QwenImagePipeline',
          dtype: 'bfloat16',
          modelRepo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          quantizationMode: 'none',
          quantizedComponents: [],
          offloadMode: 'model_cpu',
          proof: { status: 'declared_safe' },
        },
        {
          id: 'qwen-t2i-fallback',
          executionProfileId: 'qwen-image:t2i-direct',
          modelType: 'QwenImageModularPipeline',
          mode: 'text_to_image',
          loaderModule: 'modules.DiffusersImage',
          loaderAction: 'LoadPipeline',
          executionPath: 'direct-diffusers-image',
          pipelineClass: 'QwenImagePipeline',
          modelRepo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          quantizationMode: 'none',
          quantizedComponents: [],
          offloadMode: 'sequential_cpu',
          proof: { status: 'passed' },
        },
      ],
    },
  });

  const graph = runMetadataModule.applyStudioRuntimeHints({ sid: 'test', nodes: {}, paths: [] });
  assert.equal(graph.runtimeHints.modelType, 'QwenImageModularPipeline');
  assert.equal(graph.runtimeHints.mode, 'text_to_image');
  assert.equal(graph.runtimeHints.modelName, 'Qwen-Image-2512');
  assert.equal(graph.runtimeHints.modelRepo, 'Qwen/Qwen-Image-2512');
  assert.equal(graph.runtimeHints.dtype, 'bfloat16');
  assert.equal(graph.runtimeHints.quantizationMode, 'none');
  assert.deepEqual(graph.runtimeHints.quantizedComponents, []);
  assert.equal(graph.runtimeHints.autoOffload, true);
  assert.equal(graph.runtimeHints.offloadMode, 'model_cpu');
  assert.deepEqual(graph.runtimeHints.supportedOffloadModes, [
    'none',
    'model_cpu',
    'sequential_cpu',
    'group_cpu',
    'group_disk',
  ]);
  assert.equal(graph.runtimeHints.executionPath, 'direct-diffusers-image');
  assert.equal(graph.runtimeHints.resolvedArtifact, 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit');
  assert.equal(graph.runtimeHints.autoResourceCandidateId, 'qwen-t2i-prequantized-model-cpu');
  assert.equal(graph.runtimeHints.autoResourceProofStatus, 'declared_safe');
  assert.ok(graph.runtimeHints.resourceRetryPlans.length >= 1);
  assert.equal(graph.runtimeHints.lowVramMode, true);
  assert.equal(graph.runtimeHints.cudaMemoryTotalBytes, totalBytes);
  assert.equal(graph.runtimeHints.requestedCudaReserveBytes, undefined);
  assert.equal(graph.runtimeHints.requestedCudaBudgetBytes, undefined);
});

test('ACE LoRA runtime hints replace the selected candidate and its complete artifact receipt', () => {
  const previousStudio = studioStoreModule.useStudioStore.getState();
  const previousFlow = flowStoreModule.useFlowStore.getState();
  const originalRepo = 'ACE-Step/ACE-Step-v1.5-turbo';
  const originalRevision = 'a'.repeat(40);
  const reviewedRepo = 'Runware/acestep-v15-turbo-diffusers';
  const reviewedRevision = 'be23effe449c5957947f3020fd63bee23c64abe4';
  const candidate = {
    id: 'ace-auto',
    modelType: 'AceStepAudioPipeline',
    mode: 'text_to_audio',
    loaderModule: 'modules.DiffusersAudio',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-audio',
    pipelineClass: 'AceStepPipeline',
    modelRepo: originalRepo,
    resolvedArtifact: originalRepo,
    artifact: originalRepo,
    baseArtifact: originalRepo,
    artifactRevision: originalRevision,
    artifactResolution: {
      base: { repo: originalRepo, revision: originalRevision },
      resolved: {
        repo: originalRepo,
        revision: originalRevision,
        format: 'diffusers',
        bits: null,
        quantization: 'none',
        components: ['transformer'],
      },
      substituted: true,
    },
    installTarget: { repo: originalRepo, candidateId: 'ace-auto' },
    dtype: 'bfloat16',
    quantizationMode: 'none',
    quantizedComponents: [],
    autoOffload: false,
    offloadMode: 'none',
    proof: { status: 'passed' },
  };

  try {
    studioStoreModule.useStudioStore.setState({
      activeTemplateId: 'ace_step_chinese_new_year_lora',
      form: {
        ...profilesModule.DEFAULT_STUDIO_FORM,
        modelType: 'AceStepAudioPipeline',
        mode: 'text_to_audio',
        resourceMode: 'auto',
        device: 'cpu:0',
        autoOffload: false,
        offloadMode: 'none',
      },
      graphBinding: {
        mode: 'text_to_audio',
        modelType: 'AceStepAudioPipeline',
        nodes: { audioPipeline: 'ace-loader' },
        managedNodeIds: ['ace-loader'],
        managedEdgeIds: [],
        fingerprint: 'text_to_audio:AceStepAudioPipeline:auto:none',
        createdAt: 1,
        updatedAt: 1,
      },
      autoResourcePlan: {
        schemaVersion: 2,
        status: 'ready',
        canAutoRun: true,
        compatibility: { state: 'ready' },
        selectedCandidate: { ...candidate },
        candidates: [{ ...candidate }],
      },
    });
    flowStoreModule.useFlowStore.setState({
      nodes: [
        {
          id: 'ace-loader',
          data: {
            type: 'custom',
            module: 'modules.DiffusersAudio',
            action: 'LoadPipeline',
            params: { pipeline_class: { value: 'AceStepPipeline' } },
          },
        },
      ],
      edges: [],
    });

    const hints = runMetadataModule.applyStudioRuntimeHints({ sid: 'ace', nodes: {}, paths: [] }).runtimeHints;
    const selected = hints.autoResourcePlan;
    const listed = hints.autoResourceCandidates.find((item) => item.id === candidate.id);
    for (const receipt of [selected, listed]) {
      assert.equal(receipt.modelRepo, reviewedRepo);
      assert.equal(receipt.resolvedArtifact, reviewedRepo);
      assert.equal(receipt.artifact, reviewedRepo);
      assert.equal(receipt.baseArtifact, reviewedRepo);
      assert.equal(receipt.artifactRevision, reviewedRevision);
      assert.deepEqual(receipt.artifactResolution.base, { repo: reviewedRepo, revision: reviewedRevision });
      assert.deepEqual(receipt.artifactResolution.resolved, {
        ...candidate.artifactResolution.resolved,
        repo: reviewedRepo,
        revision: reviewedRevision,
      });
      assert.equal(receipt.artifactResolution.substituted, false);
      assert.equal(receipt.installTarget.repo, reviewedRepo);
    }
    assert.deepEqual(listed, selected, 'the canonical same-id list entry must be updated with the selected receipt');
    assert.equal(hints.modelRepo, reviewedRepo);
    assert.equal(hints.resolvedArtifact, reviewedRepo);
    assert.equal(candidate.artifactResolution.resolved.repo, originalRepo, 'the backend plan must not be mutated');
  } finally {
    studioStoreModule.useStudioStore.setState({
      activeTemplateId: previousStudio.activeTemplateId,
      form: previousStudio.form,
      graphBinding: previousStudio.graphBinding,
      autoResourcePlan: previousStudio.autoResourcePlan,
    });
    flowStoreModule.useFlowStore.setState({ nodes: previousFlow.nodes, edges: previousFlow.edges });
  }
});

test('Studio output contract preserves per-layer media item hashes', () => {
  const output = outputContractsModule.coerceStudioOutput({
    id: 'layered-output',
    nodeId: 'node-1',
    fieldKey: 'images',
    value: ['/cache/node-1/images?index=0', '/cache/node-1/images?index=1'],
    url: '/cache/node-1/images?index=0',
    mode: 'layer_decomposition',
    modelType: 'QwenImageLayeredModularPipeline',
    formSnapshot: {
      ...profilesModule.DEFAULT_STUDIO_FORM,
      mode: 'layer_decomposition',
      modelType: 'QwenImageLayeredModularPipeline',
    },
    createdAt: 1,
    mediaHash: 'sha256:collection:abc',
    mediaCollectionHash: 'sha256:collection:abc',
    mediaItems: [
      { index: 0, role: 'layer', label: 'Layer 1', url: '/file?file=layer0.webp', mediaHash: 'sha256:bytes:000' },
      { index: 1, role: 'layer', label: 'Layer 2', url: '/file?file=layer1.webp', mediaHash: 'sha256:bytes:111' },
    ],
  });
  assert.equal(output.mediaItems.length, 2);
  assert.equal(output.mediaCollectionHash, 'sha256:collection:abc');
  assert.equal(output.mediaItems[0].role, 'layer');
  assert.equal(output.mediaItems[1].mediaHash, 'sha256:bytes:111');
});

test('Qwen Layered defaults to a pipeline-supported source resolution', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'qwen_layered_portrait');
  const profile = profilesModule.STUDIO_MODEL_PROFILES.QwenImageLayeredModularPipeline;
  assert.ok(template);
  assert.deepEqual(profile.defaultSize, { width: 640, height: 640, aspectRatio: '1:1' });
  assert.equal(template.example.lockedSettings.width, 640);
  assert.equal(template.example.lockedSettings.height, 640);
  assert.equal(template.example.lockedSettings.layers, 3);
  assert.deepEqual(template.example.expectedOutput, { width: 640, height: 640 });
  assert.deepEqual(template.example.galleryExpectedOutput, { width: 1536, height: 1108 });
});

test('partially downloaded Hugging Face snapshots are not runnable cache hits', () => {
  const repo = 'Qwen/Qwen-Image-Layered';
  assert.equal(
    modelCacheModule.cacheContains(
      [
        {
          id: repo,
          cached: true,
          installed: false,
          complete: false,
          repair_required: true,
          active_files: ['blobs/weights.incomplete'],
        },
      ],
      repo,
    ),
    false,
  );
  assert.equal(modelCacheModule.cacheContains([{ id: repo, installed: true, complete: true }], repo), true);
  // Older backends did not provide installation metadata; preserve that wire contract.
  assert.equal(modelCacheModule.cacheContains([{ id: repo }], repo), true);
});

test('startup request caches recover manifest and plans at their startup readiness signals without a modal refresh', async () => {
  let attempts = 0;
  const cache = startupRequestModule.createStartupRequestCache(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('backend not ready');
    return { ready: true };
  });

  await assert.rejects(cache.load(), /backend not ready/);
  assert.equal(cache.hasRejected(), true);
  assert.equal(
    startupRequestModule.shouldRetryStaticStartupRequest({
      attempted: false,
      failed: cache.hasRejected(),
    }),
    true,
  );
  assert.equal(
    startupRequestModule.shouldRetryStaticStartupRequest({
      attempted: true,
      failed: cache.hasRejected(),
    }),
    false,
  );
  assert.equal(
    startupRequestModule.shouldRetryStartupRequest({
      attempted: false,
      backendReady: false,
      discoveryRefreshing: false,
      failed: cache.hasRejected(),
    }),
    false,
  );
  assert.equal(
    startupRequestModule.shouldRetryStartupRequest({
      attempted: false,
      backendReady: true,
      discoveryRefreshing: true,
      failed: cache.hasRejected(),
    }),
    false,
  );
  assert.equal(
    startupRequestModule.shouldRetryStartupRequest({
      attempted: false,
      backendReady: true,
      discoveryRefreshing: false,
      failed: cache.hasRejected(),
    }),
    true,
  );

  assert.deepEqual(await cache.load(), { ready: true });
  assert.equal(cache.hasRejected(), false);
  assert.deepEqual(await cache.load(), { ready: true });
  assert.equal(attempts, 2);
  assert.equal(
    startupRequestModule.shouldRetryStartupRequest({
      attempted: true,
      backendReady: true,
      discoveryRefreshing: false,
      failed: true,
    }),
    false,
  );

  const browserSource = await readFile(path.join(ROOT, 'src/components/TemplateBrowserDialog.tsx'), 'utf8');
  assert.match(browserSource, /const templateManifestRequest = createStartupRequestCache<TemplateGalleryManifest>/);
  assert.match(
    browserSource,
    /const templateAutoPlansRequest = createStartupRequestCache<Record<string, StudioAutoResourcePlan>>/,
  );
  assert.match(browserSource, /shouldRetryStaticStartupRequest\(\{[\s\S]*?manifestStartupRetryAttempted\.current/);
  assert.doesNotMatch(browserSource, /templateManifestRequest\s*\?\?=/);
});
