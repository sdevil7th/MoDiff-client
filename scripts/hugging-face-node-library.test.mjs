import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let libraryModule;
let libraryCatalogModule;
let clusterGraphModule;
let clusterCompilerModule;
let clusterFinalizationModule;
let clusterForkModule;
let clusterCustomizationModule;
let clusterInstanceModule;
let clusterMaterializerModule;
let modularConditionalModule;
let compositeNodesModule;
let customModularHubImportModule;
let flowGraphExportModule;
let flowStoreModule;
let clusterRuntimeStoreModule;
let clusterRuntimeModule;
let clusterQualificationModule;
let libraryStoreModule;
let nodeCatalogModule;
let nodeListModule;
let nodeStoreModule;
let originalFetch;

test('canonical discovery only hides exact aliases for the selected pipeline and task', () => {
  const canonical = { module: 'modules.ModularDiffusers', action: 'EncodePrompt', label: 'Encode Prompt', params: {} };
  const nodes = {
    'modules.ModularDiffusers.EncodePrompt': canonical,
    'alias.encode': { ...canonical, label: 'Old prompt encoder' },
    'distinct.encode': { ...canonical, params: { text: { type: 'string' } } },
    'custom.prompt': { module: 'custom.prompt', action: 'Encode', label: 'Encode Prompt', params: {} },
  };
  const binding = {
    pipelineClass: 'FuturePipeline',
    task: 'text_to_image',
    operationId: 'diffusion.encode_prompt',
    nodeKey: 'modules.ModularDiffusers.EncodePrompt',
    binding: { pipelineClass: 'FuturePipeline', values: {} },
  };
  const support = [
    { pipelineClass: 'FuturePipeline', tasks: [{ task: binding.task, operationIds: [binding.operationId] }] },
  ];
  const selection = { pipeline: binding.pipelineClass, task: binding.task };
  const select = nodeCatalogModule.runtimeCatalogNodes;
  const before = JSON.stringify(nodes);
  assert.equal(
    select(nodes, [binding], support, 'common'),
    nodes,
    'Generic nodes remain available before selecting a pipeline.',
  );
  for (const view of ['common', 'experimental']) {
    assert.deepEqual(Object.keys(select(nodes, [binding], support, view, selection)), [
      'distinct.encode',
      'custom.prompt',
    ]);
    for (const contracts of [[], [{ ...binding, binding: undefined }], [{ ...binding, task: null }]])
      assert.deepEqual(select(nodes, contracts, support, view, selection), nodes);
    for (const invalid of [
      { pipeline: 'OtherPipeline', task: binding.task },
      { ...selection, task: 'image_to_image' },
    ])
      assert.deepEqual(select(nodes, [binding], support, view, invalid), nodes);
  }
  for (const view of ['advanced', 'all']) assert.equal(select(nodes, [binding], support, view, selection), nodes);
  const aliasesOnly = { 'alias.encode': nodes['alias.encode'] };
  assert.deepEqual(
    select(aliasesOnly, [binding], support, 'common', selection),
    aliasesOnly,
    'Never guess which schema a missing canonical key refers to.',
  );
  assert.deepEqual(select(nodes, [binding], [], 'common', selection), nodes);
  assert.equal(JSON.stringify(nodes), before);
});

test('one common catalog includes generic nodes, utilities and custom nodes with additive discovery options', () => {
  const entry = (module, action, extra = {}) =>
    nodeCatalogModule.getNodeCatalogEntry({ module, action, label: action, category: 'Test', params: {}, ...extra });
  const matches = nodeCatalogModule.nodeCatalogEntryMatchesView;
  for (const action of ['ModelsLoader', 'EncodePrompt', 'Denoise', 'DecodeLatents', 'ImageEncode']) {
    for (const view of ['common', 'advanced', 'experimental', 'all'])
      assert.equal(matches(entry('modules.ModularDiffusers', action), view), true, action);
  }
  for (const action of ['ReviewedModularWorkflowStep', 'WorkflowKrea2Denoise', 'DynamicBlockNode']) {
    assert.equal(matches(entry('modules.ModularDiffusers', action), 'common'), false);
    assert.equal(matches(entry('modules.ModularDiffusers', action), 'experimental'), false);
    assert.equal(matches(entry('modules.ModularDiffusers', action), 'advanced'), true);
    assert.equal(matches(entry('modules.ModularDiffusers', action), 'all'), true);
  }
  for (const module of ['modules.Primitive', 'modules.Text', 'custom.my_nodes'])
    assert.equal(matches(entry(module, 'TextValue'), 'common'), true);
  assert.equal(matches(entry('modules.Image', 'Preview'), 'common'), true);
  for (const action of ['Resize', 'Save', 'Compare', 'ApplyMask', 'Merge', 'ImageGrid', 'SplitImageGrid']) {
    for (const view of ['common', 'experimental', 'advanced', 'all'])
      assert.equal(matches(entry('modules.Image', action), view), true, `${action} in ${view}`);
    assert.equal(matches(entry('modules.Image', action, { type: 'group' }), 'common'), false);
  }
  for (const [module, actions] of [
    ['modules.ImageFilters', ['Canny', 'UnsharpMask', 'GuidedBlur', 'AdaptiveSharpening', 'GaussianBlur']],
    ['modules.Color', ['Invert']],
    ['modules.DiffusersImage', ['OutpaintCanvas']],
  ]) {
    for (const action of actions) {
      for (const view of ['common', 'experimental', 'advanced', 'all'])
        assert.equal(matches(entry(module, action), view), true, `${module}.${action} in ${view}`);
      assert.equal(matches(entry(module, action, { type: 'group' }), 'common'), false);
    }
  }
  assert.equal(matches(entry('modules.ImageFiltersExperimental', 'Canny'), 'common'), false);
  assert.equal(matches(entry('modules.DiffusersImage', 'UnreviewedInternal'), 'common'), false);
  for (const view of ['common', 'advanced', 'experimental', 'all'])
    assert.equal(matches(entry('modules.ModularDiffusers', 'Denoise', { type: 'group' }), view), false);
  assert.equal(matches(entry('modules.Experiments', 'SD3Loader'), 'common'), false);
  assert.equal(matches(entry('modules.Experiments', 'SD3Loader'), 'advanced'), false);
  assert.equal(matches(entry('modules.Experiments', 'SD3Loader'), 'experimental'), true);
  assert.equal(matches(entry('modules.Experiments', 'SD3Loader'), 'all'), true);
});

test('workbench catalog scope filters HF internals and catalog-only blocks before search', () => {
  const sections = [
    {
      id: 'diffusers_cluster_nodes',
      label: 'Diffusers Blocks',
      entries: [
        {
          id: 'ready',
          kind: 'cluster',
          readiness: 'graph_qualified',
          insertable: true,
          label: 'Ready task',
          searchText: '',
        },
        {
          id: 'draft',
          kind: 'cluster',
          readiness: 'catalog_only',
          insertable: true,
          label: 'Draft task',
          searchText: '',
        },
        {
          id: 'blocked',
          kind: 'cluster',
          readiness: 'graph_qualified',
          insertable: false,
          label: 'Blocked task',
          searchText: '',
        },
      ],
    },
    {
      id: 'modular_diffusers_block_nodes',
      label: 'Modular blocks',
      entries: [{ id: 'internal', kind: 'block', label: 'Denoise internals', searchText: '', insertable: true }],
    },
    {
      id: 'diffusers_component_nodes',
      label: 'Components',
      entries: [{ id: 'component', kind: 'component', label: 'VAE reference', searchText: '', insertable: false }],
    },
  ];
  const before = JSON.stringify(sections);
  const filter = libraryCatalogModule.filterHuggingFaceCatalogSections;
  const ids = (view, query = '') => filter(sections, query, view).flatMap(({ entries }) => entries.map(({ id }) => id));
  assert.deepEqual(ids('common'), ['ready']);
  assert.deepEqual(ids('common', 'Draft'), []);
  assert.deepEqual(ids('experimental'), ['ready']);
  assert.deepEqual(ids('advanced'), ['ready', 'draft', 'blocked', 'internal', 'component']);
  assert.deepEqual(ids('advanced', 'Denoise'), ['internal']);
  assert.equal(JSON.stringify(sections), before, 'Discovery must not mutate catalog contracts.');
});

test('runtime node search requires every keyword and preserves exact registry keys and aliases', () => {
  const entry = nodeCatalogModule.getNodeCatalogEntry(
    {
      module: 'modules.Image',
      action: 'Load',
      label: 'Open picture',
      category: 'image',
      description: 'Read a picture from disk',
      params: {},
    },
    'custom.registry.ImageLoader',
  );
  entry.aliases = ['legacy.Image.Open'];
  for (const query of [
    '  IMAGE   load ',
    'load-image',
    'custom.registry.ImageLoader',
    'legacy.Image.Open',
    'picture',
  ]) {
    assert.equal(nodeCatalogModule.nodeCatalogEntryMatchesSearch(entry, query), true, query);
  }
  for (const query of ['image audio', 'disk image', 'missing', '---']) {
    assert.equal(nodeCatalogModule.nodeCatalogEntryMatchesSearch(entry, query), false, query);
  }
  assert.equal(nodeCatalogModule.nodeCatalogEntryMatchesSearch(entry, ''), true);
  assert.equal(nodeCatalogModule.nodeCatalogEntryMatchesSearch(entry, '  '), true);
});

test('catalog keyword search handles spacing, punctuation and word order without admitting partial queries', () => {
  const sections = [
    {
      id: 'modular_diffusers_block_nodes',
      label: 'Modular Diffusers implementation',
      entries: [
        {
          id: 'text-inputs',
          label: 'Qwen Image Text Inputs',
          description: 'Batch embeddings',
          groupPath: ['Image'],
          searchText: 'qwenimagetextinputsstep',
        },
        {
          id: 'decode',
          label: 'Qwen Image Decode',
          description: 'Decode latents',
          groupPath: ['Image'],
          searchText: 'qwenimagedecodestep',
        },
        {
          id: 'flux',
          label: 'Flux Text Inputs',
          description: 'Batch embeddings',
          groupPath: ['Image'],
          searchText: 'fluxtextinputsstep',
        },
      ],
    },
  ];
  for (const query of [
    '  QWEN   inputs  ',
    'inputs qwen',
    'qwen text-inputs',
    'qwen text_inputs',
    'qwenimagetextinputsstep',
  ]) {
    assert.deepEqual(
      libraryCatalogModule
        .filterHuggingFaceCatalogSections(sections, query)
        .flatMap(({ entries }) => entries.map(({ id }) => id)),
      ['text-inputs'],
      query,
    );
  }
  for (const query of ['qwen missing', 'nothing-matches']) {
    assert.deepEqual(libraryCatalogModule.filterHuggingFaceCatalogSections(sections, query), [], query);
  }
  assert.equal(libraryCatalogModule.filterHuggingFaceCatalogSections(sections, '   '), sections);
  assert.equal(
    libraryCatalogModule.filterHuggingFaceCatalogSections(sections, 'Modular Diffusers')[0]?.entries.length,
    3,
  );
});

test('catalog search matches readable mixed-case internal node labels', () => {
  const sections = [
    {
      id: 'modular_diffusers_block_nodes',
      label: 'Modular Diffusers',
      entries: [
        {
          id: 'text-inputs',
          label: 'Qwen Image Text Inputs',
          description: 'Batch Embeddings',
          searchText: 'qwenimagetextinputsstep',
        },
      ],
    },
  ];
  for (const query of ['Qwen Image Text Inputs', 'qwen image text inputs'])
    assert.equal(
      libraryCatalogModule.filterHuggingFaceCatalogSections(sections, query)[0]?.entries[0]?.id,
      'text-inputs',
    );
  assert.deepEqual(libraryCatalogModule.filterHuggingFaceCatalogSections(sections, 'Batch Embeddings'), []);
});
let server;
let studioStoreModule;
let userBlocksModule;
let userBlockPersistenceModule;
let modularCompositionModule;

test('User Node library groups saved context and actual revisions without changing definitions or hiding saved copies', async () => {
  const library = await server.ssrLoadModule('/src/studio/userBlockLibrary.ts');
  const definition = {
    schemaVersion: 2,
    definitionId: 'copy-one',
    displayName: 'Qwen Image — Text To Image — Product campaign',
    contentHash: 'sha256:1234567890abcdef',
    source: { kind: 'user', library: 'diffusers', pipelineClass: 'QwenImageModularPipeline', workflow: 'text2image' },
  };
  const second = { ...definition, definitionId: 'copy-two', contentHash: 'sha256:abcdef1234567890' };
  const before = JSON.stringify([definition, second]);
  assert.deepEqual(library.storedUserBlockGroupPath(definition), ['Diffusers derived', 'Qwen Image', 'Text to image']);
  assert.deepEqual(library.storedUserBlockGroupPath(definition, 'workflow'), [
    'Product campaign',
    'Qwen Image — Text To Image',
  ]);
  assert.equal(library.storedUserBlockRevision(definition), 'Revision 1234567890ab');
  assert.equal(
    library.storedUserBlockRevision({ ...definition, contentHash: 'block-definition-v2-2116b7a1' }),
    'Revision 2116b7a1',
  );
  assert.equal(
    library.storedUserBlockRevision({ ...definition, contentHash: 'block-definition-v2-28772675' }),
    'Revision 28772675',
  );
  assert.deepEqual(library.uniqueStoredUserBlocks([definition, second, definition]).map(library.storedUserBlockId), [
    'copy-one',
    'copy-two',
  ]);
  const legacy = { id: 'legacy', name: 'Reusable render', version: 1, updatedAt: 0 };
  assert.deepEqual(library.storedUserBlockGroupPath(legacy, 'workflow'), [
    'No saved workflow context',
    'Reusable render',
  ]);
  assert.equal(library.storedUserBlockRevision(legacy), 'Saved 1970-01-01 00:00:00 UTC');
  assert.equal(JSON.stringify([definition, second]), before);
});

before(async () => {
  const storage = new Map();
  const localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.localStorage = localStorage;
  globalThis.window = {
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage,
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  libraryModule = await server.ssrLoadModule('/src/studio/huggingFaceNodeLibrary.ts');
  libraryCatalogModule = await server.ssrLoadModule('/src/studio/huggingFaceNodeCatalog.ts');
  clusterGraphModule = await server.ssrLoadModule('/src/studio/huggingFaceClusterGraph.ts');
  clusterCompilerModule = await server.ssrLoadModule('/src/studio/huggingFaceClusterCompiler.ts');
  clusterFinalizationModule = await server.ssrLoadModule('/src/studio/huggingFaceClusterFinalization.ts');
  clusterForkModule = await server.ssrLoadModule('/src/studio/huggingFaceClusterFork.ts');
  clusterCustomizationModule = await server.ssrLoadModule('/src/studio/huggingFaceClusterCustomization.ts');
  clusterInstanceModule = await server.ssrLoadModule('/src/studio/huggingFaceClusterInstance.ts');
  clusterMaterializerModule = await server.ssrLoadModule('/src/studio/huggingFaceClusterMaterializer.ts');
  modularConditionalModule = await server.ssrLoadModule('/src/studio/huggingFaceModularConditionals.ts');
  compositeNodesModule = await server.ssrLoadModule('/src/studio/compositeNodes.ts');
  customModularHubImportModule = await server.ssrLoadModule('/src/studio/customModularHubImport.ts');
  flowGraphExportModule = await server.ssrLoadModule('/src/stores/flowGraphExport.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  clusterRuntimeStoreModule = await server.ssrLoadModule('/src/stores/useHuggingFaceClusterRuntimeStore.ts');
  clusterRuntimeModule = await server.ssrLoadModule('/src/studio/huggingFaceClusterRuntime.ts');
  clusterQualificationModule = await server.ssrLoadModule('/src/studio/huggingFaceClusterQualification.ts');
  libraryStoreModule = await server.ssrLoadModule('/src/stores/useHuggingFaceNodeLibraryStore.ts');
  nodeCatalogModule = await server.ssrLoadModule('/src/studio/nodeCatalog.ts');
  nodeListModule = await server.ssrLoadModule('/src/components/NodeList.tsx');
  nodeStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  modularCompositionModule = await server.ssrLoadModule('/src/studio/modularComposition.ts');
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  userBlocksModule = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  userBlockPersistenceModule = await server.ssrLoadModule('/src/studio/userBlockPersistence.ts');
  originalFetch = globalThis.fetch;
});

test('executable declarative Hub imports require exact immutable component pins', () => {
  const inspection = {
    admission: { executable: true },
    runtimeNode: {
      identity: {
        schema: 'modiff.custom-pipeline-identity.v3',
        component_revisions: {
          'z-owner/second': 'b'.repeat(40),
          'a-owner/first': 'a'.repeat(40),
        },
      },
    },
  };
  assert.deepEqual(customModularHubImportModule.executableCustomModularDependencies(inspection), [
    { repository: 'a-owner/first', revision: 'a'.repeat(40) },
    { repository: 'z-owner/second', revision: 'b'.repeat(40) },
  ]);
  assert.throws(
    () =>
      customModularHubImportModule.executableCustomModularDependencies({
        ...inspection,
        runtimeNode: {
          identity: {
            schema: 'modiff.custom-pipeline-identity.v3',
            component_revisions: { 'a-owner/first': 'main' },
          },
        },
      }),
    /invalid component pin/u,
  );
});

beforeEach(() => {
  libraryStoreModule.useHuggingFaceNodeLibraryStore.setState({
    library: null,
    loaded: false,
    error: null,
  });
  clusterRuntimeStoreModule.useHuggingFaceClusterRuntimeStore.setState({ authorities: {} });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

test('model capability discovery accepts only versioned app-owned built-in repositories', () => {
  const capability = {
    modelType: 'BuiltinImageOperation',
    modes: ['image_filter'],
    qualifiedModes: [],
    defaultRepo: 'builtin://modiff/image-operations/v1',
    artifactKind: 'builtin',
    artifactInstallRequired: false,
    executionStatus: 'supported',
  };
  const parsed = nodeStoreModule.parseStudioModelCapabilities({
    schemaVersion: 2,
    capabilities: [structuredClone(capability)],
  });
  assert.equal(parsed.authoritative, true);
  assert.equal(parsed.capabilities[0].defaultRepo, capability.defaultRepo);
  assert.throws(
    () =>
      nodeStoreModule.parseStudioModelCapabilities({
        schemaVersion: 2,
        capabilities: [{ ...capability, defaultRepo: 'builtin://modiff/../unsafe/v1' }],
      }),
    /Invalid model-capabilities response/u,
  );
});

test('model capability discovery remains bounded while admitting catalogs beyond the legacy 128-entry limit', () => {
  const capability = {
    modelType: 'BuiltinImageOperation',
    modes: ['image_filter'],
    qualifiedModes: [],
    defaultRepo: 'builtin://modiff/image-operations/v1',
    artifactKind: 'builtin',
    artifactInstallRequired: false,
    executionStatus: 'supported',
  };
  const catalog = [
    capability,
    ...Array.from({ length: 128 }, (_, index) => ({
      modelType: `FutureReviewedModel${index}`,
      modes: [],
    })),
  ];
  const parsed = nodeStoreModule.parseStudioModelCapabilities({ schemaVersion: 2, capabilities: catalog });
  assert.equal(parsed.capabilities.length, 1);
  assert.throws(
    () =>
      nodeStoreModule.parseStudioModelCapabilities({
        schemaVersion: 2,
        capabilities: Array.from({ length: nodeStoreModule.MAX_STUDIO_MODEL_CAPABILITIES + 1 }, (_, index) => ({
          modelType: `FutureReviewedModel${index}`,
          modes: [],
        })),
      }),
    /Invalid model-capabilities response/u,
  );
});

test('Expert Cluster qualification accepts only the exact backend receipt boundary', async () => {
  const artifactStatus = {
    repo: 'Wan-AI/Wan2.1-FLF2V-14B-720P-diffusers',
    revision: '1'.repeat(40),
    installed: true,
    complete: true,
    exactRevisionComplete: true,
    repairRequired: false,
    reason: 'Exact snapshot is complete.',
    missingFiles: [],
    corruptFiles: [],
    activeFiles: [],
  };
  const receipt = {
    schemaVersion: 1,
    claim: 'expert_cluster_runtime_qualified',
    publicationExecutable: false,
    checkedAt: 1,
    qualificationFingerprint: `sha256:${'a'.repeat(64)}`,
    definitionId: 'diffusers.modular:WanImage2VideoModularPipeline:flf2v',
    admissionId: 'diffusers.cluster-admission:WanImage2VideoModularPipeline:flf2v:state_flow:flf2v',
    executionProfileId: 'wan-flf:modular',
    modelType: 'WanImage2VideoModularPipeline',
    mode: 'image_to_video',
    pipelineClass: 'WanImage2VideoModularPipeline',
    loaderModule: 'modules.ModularDiffusers',
    loaderAction: 'ModelsLoader',
    executionPath: 'modular-diffusers',
    runtimeFingerprint: `sha256:${'b'.repeat(64)}`,
    resourceFingerprint: `sha256:${'c'.repeat(64)}`,
    artifactStatus,
    dependencies: [],
    optionalRuntimeRequirement: { schemaVersion: 1, requiredNow: true, state: 'active' },
    recipe: {
      device: 'cuda:0',
      dtype: 'bfloat16',
      quantizationMode: 'none',
      autoOffload: true,
      offloadMode: 'model_cpu',
    },
  };
  const form = {
    device: 'cuda:0',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    autoOffload: true,
    offloadMode: 'model_cpu',
  };
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: false, receipt }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const accepted = await clusterQualificationModule.fetchHuggingFaceClusterExpertQualification({
      definitionId: receipt.definitionId,
      admissionId: receipt.admissionId,
      form,
    });
    assert.deepEqual(accepted, receipt);

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: false, receipt: { ...receipt, unexpected: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    await assert.rejects(
      clusterQualificationModule.fetchHuggingFaceClusterExpertQualification({
        definitionId: receipt.definitionId,
        admissionId: receipt.admissionId,
        form,
      }),
      /Invalid Hugging Face Cluster runtime qualification response/u,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

function field(name, required = false) {
  return { name, type: 'builtins.str', required, default: null, description: `${name} field` };
}

function blockField(name, required = false, kwargsType = null) {
  return { ...field(name, required), kwargsType };
}

function blockDefinition(step, marker) {
  const contentHash = `sha256:${marker.repeat(64)}`;
  return {
    schemaVersion: 1,
    id: `diffusers.modular-block:${step.className}:${contentHash}`,
    className: step.className,
    kind: step.kind,
    description: step.description,
    inputs: [blockField('state', true)],
    variadicInputs:
      marker === '1'
        ? [
            {
              kwargsType: 'denoiser_input_fields',
              type: 'typing.Any',
              required: false,
              default: null,
              description: 'Additional denoiser state.',
            },
          ]
        : [],
    requiredInputs: ['state'],
    outputs: [blockField('state', false, 'intermediate_state')],
    components:
      marker === '1'
        ? [
            {
              name: 'transformer',
              type: 'diffusers.FluxTransformer2DModel',
              description: 'Transformer component.',
              creationMethod: 'from_pretrained',
              defaultConfig: null,
            },
          ]
        : [],
    configs: marker === '1' ? [{ name: 'guidance', default: 3.5, description: 'Guidance scale.' }] : [],
    contentHash,
  };
}

test('Modular conditional companion retains inactive branches and resolves trigger presence exactly', () => {
  const root = blockDefinition({ className: 'TestRootBlocks', kind: 'sequential', description: 'Root blocks.' }, '6');
  const selector = blockDefinition(
    { className: 'TestDurationSelector', kind: 'auto', description: 'Duration selector.' },
    '7',
  );
  const duration = blockDefinition(
    { className: 'TestDurationStep', kind: 'block', description: 'Duration block.' },
    '8',
  );
  const followupSelector = blockDefinition(
    { className: 'TestFollowupSelector', kind: 'auto', description: 'Intermediate selector.' },
    'a',
  );
  const followup = blockDefinition(
    { className: 'TestFollowupStep', kind: 'block', description: 'Intermediate block.' },
    'b',
  );
  const pipelineBody = {
    schemaVersion: 1,
    pipelineClass: 'TestModularPipeline',
    rootBlockDefinitionId: root.id,
    placements: [
      {
        path: ['duration'],
        legacyPath: 'duration',
        order: 0,
        blockDefinitionId: selector.id,
        intermediateOutputs: [],
      },
      {
        path: ['duration', 'duration'],
        legacyPath: 'duration.duration',
        order: 0,
        blockDefinitionId: duration.id,
        intermediateOutputs: ['state'],
      },
      {
        path: ['followup'],
        legacyPath: 'followup',
        order: 1,
        blockDefinitionId: followupSelector.id,
        intermediateOutputs: [],
      },
      {
        path: ['followup', 'followup'],
        legacyPath: 'followup.followup',
        order: 0,
        blockDefinitionId: followup.id,
        intermediateOutputs: [],
      },
    ],
    conditionals: [
      {
        path: ['duration'],
        legacyPath: 'duration',
        blockDefinitionId: selector.id,
        strategy: 'presence',
        branchNames: ['duration'],
        triggerInputs: ['num_frames'],
        defaultBlockName: null,
        selectionTable: [
          { presentInputs: [], selectedBlockName: 'duration', error: null },
          { presentInputs: ['num_frames'], selectedBlockName: null, error: null },
        ],
      },
      {
        path: ['followup'],
        legacyPath: 'followup',
        blockDefinitionId: followupSelector.id,
        strategy: 'presence',
        branchNames: ['followup'],
        triggerInputs: ['state'],
        defaultBlockName: null,
        selectionTable: [
          { presentInputs: [], selectedBlockName: null, error: null },
          { presentInputs: ['state'], selectedBlockName: 'followup', error: null },
        ],
      },
    ],
    workflows: [
      {
        id: 'text2video',
        cases: [
          {
            presentInputs: ['prompt'],
            selections: [
              {
                path: ['duration'],
                legacyPath: 'duration',
                selectedBlockName: 'duration',
              },
            ],
            activeLeafPaths: [['duration', 'duration']],
            activeLeafDefinitionIds: [duration.id],
          },
        ],
      },
    ],
    contentHash: `sha256:${'9'.repeat(64)}`,
  };
  const snapshot = modularConditionalModule.parseHuggingFaceModularConditionalSnapshot({
    schemaVersion: 1,
    diffusersRevision: 'a'.repeat(40),
    blockDefinitions: [root, selector, duration, followupSelector, followup],
    pipelines: [pipelineBody],
  });
  const predicted = modularConditionalModule.projectHuggingFaceModularBranches(snapshot, 'TestModularPipeline', {
    prompt: 'test',
    num_frames: null,
  });
  assert.equal(predicted.selectors.get('duration').selectedBlockName, 'duration');
  assert.equal(predicted.activePaths.has('duration/duration'), true);
  assert.equal(predicted.inactivePaths.has('duration/duration'), false);
  assert.equal(predicted.selectors.get('followup').selectedBlockName, 'followup');
  assert.equal(predicted.activePaths.has('followup/followup'), true);

  const explicitFrames = modularConditionalModule.projectHuggingFaceModularBranches(snapshot, 'TestModularPipeline', {
    prompt: 'test',
    num_frames: 9,
  });
  assert.equal(explicitFrames.selectors.get('duration').selectedBlockName, null);
  assert.equal(explicitFrames.activePaths.has('duration/duration'), false);
  assert.equal(explicitFrames.inactivePaths.has('duration/duration'), true);
  assert.equal(explicitFrames.selectors.get('followup').selectedBlockName, null);
  assert.equal(explicitFrames.inactivePaths.has('followup/followup'), true);
  assert.throws(
    () =>
      modularConditionalModule.parseHuggingFaceModularConditionalSnapshot({
        ...snapshot,
        pipelines: [{ ...pipelineBody, unexpected: true }],
      }),
    /Invalid Modular Diffusers conditional contract/u,
  );
});

test('conditional hierarchy maps repeated active blocks to their exact reviewed workflow paths', () => {
  const resizeId = `diffusers.modular-block:WanImageResizeStep:sha256:${'a'.repeat(64)}`;
  const conditionals = [
    {
      path: ['image_encoder'],
      legacyPath: 'image_encoder',
      blockDefinitionId: `diffusers.modular-block:WanAutoImageEncoderStep:sha256:${'b'.repeat(64)}`,
      strategy: 'auto',
      branchNames: ['flf2v_image_encoder', 'image2video_image_encoder'],
      triggerInputs: ['image', 'last_image'],
      defaultBlockName: null,
      selectionTable: [],
    },
    {
      path: ['vae_encoder'],
      legacyPath: 'vae_encoder',
      blockDefinitionId: `diffusers.modular-block:WanAutoVaeEncoderStep:sha256:${'c'.repeat(64)}`,
      strategy: 'auto',
      branchNames: ['flf2v_vae_encoder', 'image2video_vae_encoder'],
      triggerInputs: ['image', 'last_image'],
      defaultBlockName: null,
      selectionTable: [],
    },
  ];
  const candidates = [
    {
      path: ['image_encoder.image_resize'],
      legacyPath: 'image_encoder.image_resize',
      order: 1,
      blockDefinitionId: resizeId,
    },
    {
      path: ['vae_encoder.image_resize'],
      legacyPath: 'vae_encoder.image_resize',
      order: 3,
      blockDefinitionId: resizeId,
    },
  ];
  const activeImageResize = {
    path: ['image_encoder', 'image2video_image_encoder', 'image_resize'],
    legacyPath: 'image_encoder.image2video_image_encoder.image_resize',
    order: 0,
    blockDefinitionId: resizeId,
    intermediateOutputs: ['resized_image'],
  };
  const activeVaeResize = {
    path: ['vae_encoder', 'image2video_vae_encoder', 'image_resize'],
    legacyPath: 'vae_encoder.image2video_vae_encoder.image_resize',
    order: 0,
    blockDefinitionId: resizeId,
    intermediateOutputs: ['resized_image'],
  };

  assert.equal(
    modularConditionalModule.reviewedConditionalParameterPlacement(activeImageResize, conditionals, candidates)
      .legacyPath,
    'image_encoder.image_resize',
  );
  assert.equal(
    modularConditionalModule.reviewedConditionalParameterPlacement(activeVaeResize, conditionals, candidates)
      .legacyPath,
    'vae_encoder.image_resize',
  );
});

test('conditional hierarchy maps an Auto specialization to its shape-equivalent reviewed workflow block', () => {
  const activeDefinition = blockDefinition(
    { className: 'QwenImageAdditionalInputsStep', kind: 'block', description: 'Auto specialization' },
    'd',
  );
  const reviewedDefinition = blockDefinition(
    { className: 'QwenImageAdditionalInputsStep', kind: 'block', description: 'Workflow specialization' },
    'e',
  );
  const unrelatedDefinition = blockDefinition(
    { className: 'UnrelatedInputsStep', kind: 'block', description: 'Different step' },
    'f',
  );
  const item = {
    path: ['denoise', 'inpaint', 'input', 'additional_inputs'],
    legacyPath: 'denoise.inpaint.input.additional_inputs',
    order: 1,
    blockDefinitionId: activeDefinition.id,
    intermediateOutputs: ['image_latents'],
  };
  const conditionals = [
    {
      path: ['denoise'],
      legacyPath: 'denoise',
      blockDefinitionId: `diffusers.modular-block:QwenAutoDenoiseStep:sha256:${'a'.repeat(64)}`,
      strategy: 'presence',
      branchNames: ['inpaint'],
      triggerInputs: ['image_latents'],
      defaultBlockName: null,
      selectionTable: [],
    },
  ];
  const candidate = {
    path: ['denoise.input.additional_inputs'],
    legacyPath: 'denoise.input.additional_inputs',
    order: 4,
    blockDefinitionId: reviewedDefinition.id,
  };
  const definitions = new Map(
    [activeDefinition, reviewedDefinition, unrelatedDefinition].map((definition) => [definition.id, definition]),
  );

  assert.equal(
    modularConditionalModule.reviewedConditionalParameterPlacement(item, conditionals, [candidate], definitions),
    candidate,
  );
  assert.equal(
    modularConditionalModule.reviewedConditionalParameterPlacement(
      item,
      conditionals,
      [{ ...candidate, blockDefinitionId: unrelatedDefinition.id }],
      definitions,
    ),
    null,
  );
});

test('conditional hierarchy maps a unique same-class workflow specialization without guessing across ambiguity', () => {
  const activeDefinition = blockDefinition(
    { className: 'HeliosAdditionalInputsStep', kind: 'block', description: 'Auto specialization' },
    'a',
  );
  const reviewedId = `diffusers.modular-block:HeliosAdditionalInputsStep:sha256:${'b'.repeat(64)}`;
  const item = {
    path: ['denoise', 'video2video', 'additional_inputs'],
    legacyPath: 'denoise.video2video.additional_inputs',
    order: 1,
    blockDefinitionId: activeDefinition.id,
    intermediateOutputs: ['video_latents'],
  };
  const conditionals = [
    {
      path: ['denoise'],
      legacyPath: 'denoise',
      blockDefinitionId: `diffusers.modular-block:HeliosAutoDenoiseStep:sha256:${'c'.repeat(64)}`,
      strategy: 'presence',
      branchNames: ['video2video'],
      triggerInputs: ['video'],
      defaultBlockName: null,
      selectionTable: [],
    },
  ];
  const candidate = {
    path: ['denoise.additional_inputs'],
    legacyPath: 'denoise.additional_inputs',
    order: 4,
    blockDefinitionId: reviewedId,
  };
  const definitions = new Map([[activeDefinition.id, activeDefinition]]);

  assert.equal(
    modularConditionalModule.reviewedConditionalParameterPlacement(item, conditionals, [candidate], definitions),
    candidate,
  );
  assert.equal(
    modularConditionalModule.reviewedConditionalParameterPlacement(
      item,
      conditionals,
      [candidate, { ...candidate, path: ['other'], order: 5 }],
      definitions,
    ),
    null,
  );
});

function blockRoleAdapter(blockDefinitionId, role) {
  const contentHash = blockDefinitionId.slice(blockDefinitionId.lastIndexOf('sha256:'));
  return {
    schemaVersion: 1,
    id: `diffusers.modular-block-role:${role}:${contentHash}`,
    blockDefinitionId,
    role,
    adapterKind: role === 'workflow' ? 'workflow_root' : 'pipeline_state_block',
    executionClaim: 'structural_adapter_only',
  };
}

function containerStateAdapter(blockDefinition, iterationInput = 'state') {
  const contentHash = blockDefinition.id.slice(blockDefinition.id.lastIndexOf('sha256:'));
  return {
    schemaVersion: 1,
    id: `diffusers.modular-container-state:${blockDefinition.className}:${contentHash}`,
    blockDefinitionId: blockDefinition.id,
    className: blockDefinition.className,
    containerKind: 'loop',
    iteration: { input: iterationInput, cardinality: 'value', index: 'k' },
    stateInitializers: [{ name: 'latent_chunks', operation: 'empty_list' }],
    publishedState: ['latent_chunks'],
    progressSemantics: 'container_default',
    executionClaim: 'container_state_adapter_only',
  };
}

function definition(pipelineClass, workflowId, taskId, stepSpecs = [], rootBlockDefinitionId) {
  const steps = stepSpecs.map(({ path, className, kind, description }) => ({
    path: path.join('.'),
    className,
    kind,
    description,
  }));
  return {
    schemaVersion: 5,
    id: `diffusers.modular:${pipelineClass}:${workflowId}`,
    provider: 'diffusers',
    publisher: 'huggingface',
    surface: 'diffusers_cluster_nodes',
    definitionKind: 'modular_pipeline_workflow',
    ownership: 'library',
    mutable: false,
    libraryRevision: '1'.repeat(40),
    pipelineClass,
    blocksClass: `${pipelineClass.replace('ModularPipeline', '')}AutoBlocks`,
    pipelineKind: 'auto',
    workflowId,
    workflowKind: 'sequential',
    taskId,
    taskContractId: `diffusers.task.${taskId}.v1`,
    label: `${pipelineClass} — ${taskId}`,
    description: '',
    integrationStatus: 'reviewed_modiff_contract',
    executionClaim: 'discovery_only',
    executionAdmissions: [],
    graphAdapterContracts: [
      {
        schemaVersion: 1,
        id: `diffusers.modular-adapter:${pipelineClass}:${workflowId}:mode:text_to_image`,
        source: 'mode',
        adapterId: 'text_to_image',
        upstreamWorkflowId: workflowId,
        requiredInputs: ['prompt'],
        actionSequence: ['text_encoder', 'denoise', 'decoder'],
        stateEdges: [
          {
            producerAction: 'text_encoder',
            producerOutput: 'embeddings',
            consumerAction: 'denoise',
            consumerInput: 'embeddings',
          },
          {
            producerAction: 'denoise',
            producerOutput: 'latents',
            consumerAction: 'decoder',
            consumerInput: 'latents',
          },
        ],
        upstreamBlockSequence: [],
      },
    ],
    inputs: [field('prompt', true)],
    outputs: [field('images')],
    requiredInputs: ['prompt'],
    requiredInputAlternatives: [],
    stateKeys: [],
    components: [
      {
        name: 'transformer',
        type: `diffusers.${pipelineClass.replace('ModularPipeline', 'Transformer2DModel')}`,
        creationMethod: 'from_pretrained',
        reuseKey: ['loadId'],
      },
    ],
    steps,
    blockContractHash: `sha256:${'3'.repeat(64)}`,
    rootBlockDefinitionId,
    blockPlacements: stepSpecs.map((step, index) => ({
      path: step.path,
      legacyPath: step.path.join('.'),
      order: step.path.length === 1 ? step.order : 0,
      blockDefinitionId: step.blockDefinitionId,
    })),
    contentHash: `sha256:${'2'.repeat(64)}`,
  };
}

function payload() {
  const specs = [
    { path: ['text_encoder'], className: 'FluxTextEncoderStep', kind: 'block', description: '', order: 0 },
    { path: ['denoise.input'], className: 'FluxDenoiseInputStep', kind: 'block', description: '', order: 1 },
    { path: ['denoise.denoise'], className: 'FluxDenoiseStep', kind: 'loop', description: '', order: 2 },
    {
      path: ['denoise.denoise', 'denoiser'],
      className: 'FluxLoopDenoiser',
      kind: 'block',
      description: '',
      order: 0,
    },
    { path: ['text_encoder'], className: 'QwenImageTextEncoderStep', kind: 'block', description: '', order: 0 },
    { path: ['denoise.input'], className: 'QwenImageDenoiseInputStep', kind: 'block', description: '', order: 1 },
    { path: ['denoise.denoise'], className: 'QwenImageDenoiseStep', kind: 'loop', description: '', order: 2 },
    {
      path: ['denoise.denoise', 'denoiser'],
      className: 'QwenImageLoopDenoiser',
      kind: 'block',
      description: '',
      order: 0,
    },
  ];
  const rootDefinitions = [
    blockDefinition({ className: 'SequentialPipelineBlocks', kind: 'sequential', description: '' }, 'a'),
    blockDefinition({ className: 'SequentialPipelineBlocks', kind: 'sequential', description: '' }, 'b'),
  ];
  const blockDefinitions = [
    ...specs.map((step, index) => blockDefinition(step, String(index + 1))),
    ...rootDefinitions,
  ];
  for (const offset of [0, 4]) {
    blockDefinitions[offset].inputs = [blockField('prompt', true)];
    blockDefinitions[offset].requiredInputs = ['prompt'];
    blockDefinitions[offset].outputs = [blockField('state', false, 'intermediate_state')];
    for (let index = offset + 1; index < offset + 4; index += 1) {
      blockDefinitions[index].inputs = [blockField('state', true)];
      blockDefinitions[index].requiredInputs = ['state'];
      blockDefinitions[index].outputs = [
        blockField(index === offset + 3 ? 'images' : 'state', false, 'intermediate_state'),
      ];
    }
  }
  rootDefinitions.forEach((root) => {
    root.inputs = [blockField('prompt', true)];
    root.requiredInputs = ['prompt'];
    root.outputs = [blockField('images')];
  });
  const specsWithIds = specs.map((step, index) => ({ ...step, blockDefinitionId: blockDefinitions[index].id }));
  const definitions = [
    definition('FluxModularPipeline', 'text2image', 'text_to_image', specsWithIds.slice(0, 4), rootDefinitions[0].id),
    definition('QwenImageModularPipeline', 'text2image', 'text_to_image', specsWithIds.slice(4), rootDefinitions[1].id),
  ];
  return {
    schemaVersion: 5,
    diffusersRevision: '1'.repeat(40),
    providers: ['diffusers'],
    taskContracts: [
      {
        schemaVersion: 5,
        id: 'diffusers.task.text_to_image.v1',
        provider: 'diffusers',
        taskId: 'text_to_image',
        label: 'Text To Image',
        definitionIds: definitions.map((item) => item.id),
      },
    ],
    definitions,
    blockDefinitions,
    blockRoleAdapters: [],
    containerStateAdapters: [],
  };
}

function payloadWithStandardDiffusersComposite() {
  const body = payload();
  const source = structuredClone(body.definitions[0]);
  const usedBlockIds = new Set([
    source.rootBlockDefinitionId,
    ...source.blockPlacements.map((placement) => placement.blockDefinitionId),
  ]);
  const idMap = new Map();
  const compositeBlocks = body.blockDefinitions
    .filter((block) => usedBlockIds.has(block.id))
    .map((block) => {
      const id = block.id.replace('diffusers.modular-block:', 'diffusers.composite-block:');
      idMap.set(block.id, id);
      return { ...structuredClone(block), provider: 'diffusers', id };
    });
  const definition = {
    ...source,
    id: 'diffusers.composite:FluxModularPipeline:text2image',
    definitionKind: 'studio_execution_composite',
    integrationStatus: 'reviewed_diffusers_composite',
    rootBlockDefinitionId: idMap.get(source.rootBlockDefinitionId),
    blockPlacements: source.blockPlacements.map((placement) => ({
      ...placement,
      blockDefinitionId: idMap.get(placement.blockDefinitionId),
    })),
    graphAdapterContracts: source.graphAdapterContracts.map((adapter) => ({
      ...adapter,
      id: 'diffusers.composite-adapter:FluxModularPipeline:text2image',
      adapterId: 'text2image',
    })),
    executionAdmissions: [],
  };
  body.definitions.push(definition);
  body.blockDefinitions.push(...compositeBlocks);
  body.taskContracts[0].definitionIds.push(definition.id);
  return body;
}

function payloadWithTransformersTextCluster() {
  const body = payload();
  const revision = '12fd25f77366fa6b3b4b768ec3050bf629380bac';
  const block = (className, kind, marker) => {
    const contentHash = `sha256:${marker.repeat(64)}`;
    return {
      schemaVersion: 1,
      provider: 'transformers',
      id: `transformers.composite-block:${className}:${contentHash}`,
      className,
      kind,
      description: `${className} reviewed composite role.`,
      inputs: [],
      variadicInputs: [],
      requiredInputs: [],
      outputs: [],
      components: [],
      configs: [],
      contentHash,
    };
  };
  const roleBlocks = [
    block('LoadTextGenerationModel', 'block', 'c'),
    block('GenerateText', 'block', 'd'),
    block('DataViewer', 'block', 'e'),
  ];
  const rootBlock = block('HuggingFaceTextGenerationModelTextGenerationComposite', 'sequential', 'f');
  const roles = [
    ['transformersTextModel', 'LoadTextGenerationModel'],
    ['transformersTextGenerate', 'GenerateText'],
    ['transformersTextPreview', 'DataViewer'],
  ];
  const inputs = [
    { name: 'dtype', type: 'str', required: true, default: 'float32', description: 'Model dtype.' },
    { name: 'prompt', type: 'str', required: true, default: '', description: 'Generation prompt.' },
    { name: 'use_chat_template', type: 'bool', required: false, default: true, description: 'Use chat template.' },
    { name: 'max_new_tokens', type: 'int', required: false, default: 256, description: 'Maximum new tokens.' },
    { name: 'min_new_tokens', type: 'int', required: false, default: 0, description: 'Minimum new tokens.' },
    { name: 'do_sample', type: 'bool', required: false, default: false, description: 'Use sampling.' },
    { name: 'temperature', type: 'float', required: false, default: 1, description: 'Sampling temperature.' },
    { name: 'top_p', type: 'float', required: false, default: 1, description: 'Nucleus sampling probability.' },
    { name: 'top_k', type: 'int', required: false, default: 50, description: 'Top-k cutoff.' },
    { name: 'num_beams', type: 'int', required: false, default: 1, description: 'Beam width.' },
    {
      name: 'repetition_penalty',
      type: 'float',
      required: false,
      default: 1,
      description: 'Repetition penalty.',
    },
  ];
  const instanceInputBindings = [
    ['dtype', 'dtype'],
    ['prompt', 'prompt'],
    ['useChatTemplate', 'use_chat_template'],
    ['maxNewTokens', 'max_new_tokens'],
    ['minNewTokens', 'min_new_tokens'],
    ['doSample', 'do_sample'],
    ['temperature', 'temperature'],
    ['topP', 'top_p'],
    ['topK', 'top_k'],
    ['numBeams', 'num_beams'],
    ['repetitionPenalty', 'repetition_penalty'],
  ].map(([bindingSource, input]) => ({ bindingSource, input }));
  const definitionId = 'transformers.composite:HuggingFaceTextGenerationModel:text_generation';
  const adapterId = 'transformers.composite-adapter:HuggingFaceTextGenerationModel:text_generation';
  const admissionId = 'transformers.cluster-admission:HuggingFaceTextGenerationModel:text_generation';
  const receipt = {
    id: 'smollm2-135m-instruct:text-generation:v1',
    contentHash: 'studio-spec-v1-d9902470',
    executionProfileId: 'smollm2-135m-instruct:direct',
  };
  const transformerDefinition = {
    schemaVersion: 6,
    id: definitionId,
    provider: 'transformers',
    publisher: 'huggingface',
    surface: 'transformers_cluster_nodes',
    definitionKind: 'studio_execution_composite',
    ownership: 'library',
    mutable: false,
    libraryRevision: revision,
    pipelineClass: 'HuggingFaceTextGenerationModel',
    blocksClass: 'AutoModelForCausalLM',
    pipelineKind: 'sequential',
    workflowId: 'text_generation',
    workflowKind: 'sequential',
    taskId: 'text_generation',
    taskContractId: 'transformers.task.text_generation.v1',
    label: 'SmolLM2 135M Instruct — Text Generation',
    description: 'Cluster Node containing an exact Transformers loader, generation action, and preview.',
    integrationStatus: 'reviewed_transformers_contract',
    executionClaim: 'discovery_only',
    executionAdmissions: [
      {
        schemaVersion: 4,
        id: admissionId,
        definitionId,
        studioMode: 'text_generation',
        bindingSources: [
          'artifact',
          'defaultRevision',
          'device',
          'doSample',
          'dtype',
          'maxNewTokens',
          'minNewTokens',
          'numBeams',
          'prompt',
          'quantizationMode',
          'repetitionPenalty',
          'temperature',
          'topK',
          'topP',
          'useChatTemplate',
        ],
        instanceInputBindings,
        executionParameterSources: ['device', 'quantizationMode'],
        sealedBindingValues: {
          artifact: 'HuggingFaceTB/SmolLM2-135M-Instruct',
          defaultRevision: revision,
        },
        modelDependencies: [],
        dynamicFieldActions: [],
        adapterContractId: adapterId,
        studioExecutionSpec: receipt,
        artifact: { repo: 'HuggingFaceTB/SmolLM2-135M-Instruct', revision },
        status: 'admitted',
        claim: 'static_graph_contract_compatible',
        executable: false,
        publication: graphQualifiedPublication(),
        reasons: [],
      },
    ],
    graphAdapterContracts: [
      {
        schemaVersion: 1,
        id: adapterId,
        source: 'mode',
        adapterId: 'text_generation',
        upstreamWorkflowId: 'text_generation',
        requiredInputs: ['dtype', 'prompt'],
        actionSequence: roles.map(([role]) => role),
        stateEdges: [],
        upstreamBlockSequence: [
          'modules.HuggingFaceTransformers.LoadTextGenerationModel',
          'modules.HuggingFaceTransformers.GenerateText',
          'modules.Primitive.DataViewer',
        ],
      },
    ],
    inputs,
    outputs: [{ name: 'result', type: 'object', required: true, default: null, description: 'Generated text.' }],
    requiredInputs: ['dtype', 'prompt'],
    requiredInputAlternatives: [],
    stateKeys: [],
    components: [
      {
        name: 'optional_runtime',
        type: `huggingface-transformers-peft-5.14.1-0.20.0@sha256:${'9'.repeat(64)}`,
        creationMethod: 'explicit_app_setup',
        reuseKey: ['optional_runtime'],
      },
      {
        name: 'model',
        type: 'AutoModelForCausalLM',
        creationMethod: 'from_pretrained',
        reuseKey: ['model', 'revision', 'dtype', 'device'],
      },
    ],
    steps: roles.map(([path, className]) => ({
      path,
      className,
      kind: 'block',
      description: roleBlocks.find((candidate) => candidate.className === className).description,
    })),
    blockContractHash: rootBlock.contentHash,
    rootBlockDefinitionId: rootBlock.id,
    blockPlacements: roles.map(([path], order) => ({
      path: [path],
      legacyPath: path,
      order,
      blockDefinitionId: roleBlocks[order].id,
    })),
    suggestedInputs: {
      schemaVersion: 1,
      values: { prompt: 'Explain why the sky appears blue.' },
      source: {
        kind: 'modiff_task_starter',
        label: 'MoDiff text-generation starter',
        url: '',
      },
    },
    contentHash: 'sha256:32f78d82f1912997b1eaaf43a749627d7ccd07b8805bd66e8abaf21b27c6385a',
  };
  body.providers = ['diffusers', 'transformers'];
  body.definitions.push(transformerDefinition);
  body.blockDefinitions.push(rootBlock, ...roleBlocks);
  body.taskContracts.push({
    schemaVersion: 5,
    id: 'transformers.task.text_generation.v1',
    provider: 'transformers',
    taskId: 'text_generation',
    label: 'Text Generation',
    definitionIds: [definitionId],
  });
  return { body, transformerDefinition, receipt };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function graphQualifiedPublication() {
  return {
    schemaVersion: 1,
    readiness: 'graph_qualified',
    insertable: true,
    executable: false,
    autoEligible: false,
    liveProof: false,
    reasons: [
      {
        code: 'runtime_resource_admission_required',
        message: 'Runtime and resource admission are still required.',
      },
    ],
  };
}

function payloadWithMiniMaxMusic3Workflow() {
  const body = payload();
  const rawDefinition = body.definitions[0];
  const revision = 'fbdf52fbaaca799592917417eb05f1899f1255ec';
  const definitionId = 'diffusers.modular:MiniMaxMusic3ModularPipeline:default';
  const adapterId = 'diffusers.modular-adapter:MiniMaxMusic3ModularPipeline:default:workflow:official_top_level_blocks';
  const admissionId =
    'diffusers.cluster-admission:MiniMaxMusic3ModularPipeline:default:workflow:official_top_level_blocks';
  const receipt = {
    id: 'minimax-music3:modular-text-to-audio:v1',
    contentHash: 'studio-spec-v1-8a75ab6f',
    executionProfileId: 'minimax-music3:official-modular-workflow',
  };
  const rootBlock = blockDefinition(
    { className: 'SequentialPipelineBlocks', kind: 'sequential', description: 'Official workflow root.' },
    'e',
  );
  const stageDefinitions = [
    blockDefinition(
      { className: 'MiniMaxMusic3SemanticGeneratorBlocks', kind: 'sequential', description: 'Semantic stage.' },
      'f',
    ),
    blockDefinition(
      { className: 'MiniMaxMusic3DenoiseBlocks', kind: 'sequential', description: 'Denoising stage.' },
      '7',
    ),
    blockDefinition({ className: 'MiniMaxMusic3DecodeBlock', kind: 'block', description: 'Audio decode stage.' }, '8'),
  ];
  stageDefinitions[0].inputs = [blockField('prompt', true), blockField('lyrics', true), blockField('audio_duration')];
  stageDefinitions[0].requiredInputs = ['lyrics', 'prompt'];
  stageDefinitions[1].inputs = [blockField('num_inference_steps')];
  stageDefinitions[1].requiredInputs = [];
  stageDefinitions[2].inputs = [];
  stageDefinitions[2].requiredInputs = [];

  Object.assign(rawDefinition, {
    id: definitionId,
    pipelineClass: 'MiniMaxMusic3ModularPipeline',
    blocksClass: 'MiniMaxMusic3Blocks',
    pipelineKind: 'sequential',
    workflowId: 'default',
    taskId: 'text_to_audio',
    taskContractId: 'diffusers.task.text_to_audio.v1',
    label: 'Mini Max Music3 — Text To Audio',
    integrationStatus: 'reviewed_modular_workflow_route',
    inputs: [
      field('prompt', true),
      field('lyrics', true),
      { name: 'audio_duration', type: 'builtins.float', required: false, default: 60, description: 'Seconds.' },
      { name: 'generator', type: 'torch._C.Generator', required: false, default: null, description: 'Generator.' },
      {
        name: 'num_inference_steps',
        type: 'builtins.int',
        required: false,
        default: 30,
        description: 'Denoising steps.',
      },
      { name: 'output_type', type: 'builtins.str', required: false, default: 'np', description: 'Output type.' },
    ],
    outputs: [{ name: 'audios', type: 'numpy.ndarray', required: false, default: null, description: 'Stereo audio.' }],
    requiredInputs: ['lyrics', 'prompt'],
    stateKeys: ['prompt', 'lyrics', 'audio_duration', 'generator', 'num_inference_steps', 'output_type'],
    components: [
      {
        name: 'transformer',
        type: 'diffusers.MiniMaxMusic3Transformer1DModel',
        creationMethod: 'from_pretrained',
        reuseKey: ['transformer', 'loadId'],
      },
    ],
    steps: [
      {
        path: 'semantic_generator',
        className: stageDefinitions[0].className,
        kind: 'sequential',
        description: stageDefinitions[0].description,
      },
      {
        path: 'denoise',
        className: stageDefinitions[1].className,
        kind: 'sequential',
        description: stageDefinitions[1].description,
      },
      {
        path: 'decode',
        className: stageDefinitions[2].className,
        kind: 'block',
        description: stageDefinitions[2].description,
      },
    ],
    blockContractHash: `sha256:${'d'.repeat(64)}`,
    rootBlockDefinitionId: rootBlock.id,
    blockPlacements: stageDefinitions.map((block, order) => ({
      path: [['semantic_generator'], ['denoise'], ['decode']][order],
      legacyPath: ['semantic_generator', 'denoise', 'decode'][order],
      order,
      blockDefinitionId: block.id,
    })),
    graphAdapterContracts: [
      {
        schemaVersion: 1,
        id: adapterId,
        source: 'workflow',
        adapterId: 'official_top_level_blocks',
        upstreamWorkflowId: 'default',
        requiredInputs: ['lyrics', 'prompt'],
        actionSequence: ['semantic_generator', 'workflow_denoise', 'workflow_audio_decoder'],
        stateEdges: [
          {
            producerAction: 'semantic_generator',
            producerOutput: 'state_out',
            consumerAction: 'workflow_denoise',
            consumerInput: 'state_in',
          },
          {
            producerAction: 'workflow_denoise',
            producerOutput: 'state_out',
            consumerAction: 'workflow_audio_decoder',
            consumerInput: 'state_in',
          },
        ],
        upstreamBlockSequence: ['semantic_generator', 'denoise', 'decode'],
      },
    ],
    executionAdmissions: [
      {
        schemaVersion: 4,
        id: admissionId,
        definitionId,
        studioMode: 'text_to_audio',
        bindingSources: [
          'artifact',
          'audioDuration',
          'autoOffload',
          'defaultRevision',
          'defaultWorkflow',
          'device',
          'dtype',
          'false',
          'lyrics',
          'offloadMode',
          'pipelineClass',
          'prompt',
          'sampleRate44100',
          'seed',
          'semanticGeneratorBlock',
          'steps',
          'workflowDecodeBlock',
          'workflowDenoiseBlock',
        ],
        instanceInputBindings: [
          { bindingSource: 'audioDuration', input: 'audio_duration' },
          { bindingSource: 'lyrics', input: 'lyrics' },
          { bindingSource: 'prompt', input: 'prompt' },
          { bindingSource: 'steps', input: 'num_inference_steps' },
        ],
        executionParameterSources: ['autoOffload', 'device', 'dtype', 'offloadMode', 'seed'],
        sealedBindingValues: {
          artifact: 'MiniMaxAI/MiniMax-Music3',
          defaultRevision: revision,
          defaultWorkflow: 'default',
          false: false,
          pipelineClass: 'MiniMaxMusic3ModularPipeline',
          sampleRate44100: 44100,
          semanticGeneratorBlock: 'semantic_generator',
          workflowDecodeBlock: 'decode',
          workflowDenoiseBlock: 'denoise',
        },
        modelDependencies: [],
        dynamicFieldActions: [{ role: 'models', field: 'model_type', event: 'onChange', valueSource: 'pipelineClass' }],
        adapterContractId: adapterId,
        studioExecutionSpec: receipt,
        artifact: { repo: 'MiniMaxAI/MiniMax-Music3', revision },
        status: 'admitted',
        claim: 'static_graph_contract_compatible',
        executable: false,
        publication: graphQualifiedPublication(),
        reasons: [],
      },
    ],
    contentHash: `sha256:${'c'.repeat(64)}`,
  });
  body.definitions = [rawDefinition];
  body.blockDefinitions = [rootBlock, ...stageDefinitions];
  body.taskContracts = [
    {
      schemaVersion: 5,
      id: 'diffusers.task.text_to_audio.v1',
      provider: 'diffusers',
      taskId: 'text_to_audio',
      label: 'Text To Audio',
      definitionIds: [definitionId],
    },
  ];
  return { body, rawDefinition, receipt, revision };
}

test('different families retain exact definitions while sharing a generic task contract', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  assert.equal(parsed.taskContracts.length, 1);
  assert.equal(parsed.taskContracts[0].id, 'diffusers.task.text_to_image.v1');
  assert.deepEqual(
    new Set(parsed.definitions.map((item) => item.taskContractId)),
    new Set(['diffusers.task.text_to_image.v1']),
  );
  assert.notDeepEqual(parsed.definitions[0].steps, parsed.definitions[1].steps);
  assert.equal(parsed.definitions[0].graphAdapterContracts[0].executionClaim, undefined);
  assert.deepEqual(parsed.definitions[0].graphAdapterContracts[0].actionSequence, [
    'text_encoder',
    'denoise',
    'decoder',
  ]);
  assert.ok(parsed.definitions.every((item) => item.ownership === 'library' && item.mutable === false));
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.definitions[0]), true);
});

test('standard Diffusers composites remain distinct from official Modular block hierarchies', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payloadWithStandardDiffusersComposite());
  const composite = parsed.definitions.find((definition) => definition.id.startsWith('diffusers.composite:'));
  assert.ok(composite);
  assert.equal(composite.provider, 'diffusers');
  assert.equal(composite.definitionKind, 'studio_execution_composite');
  assert.equal(composite.integrationStatus, 'reviewed_diffusers_composite');
  assert.match(composite.rootBlockDefinitionId, /^diffusers\.composite-block:/u);
  assert.match(composite.graphAdapterContracts[0].id, /^diffusers\.composite-adapter:/u);
  assert.ok(
    composite.blockPlacements.every((placement) =>
      placement.blockDefinitionId.startsWith('diffusers.composite-block:'),
    ),
  );
});

test('ordinary composite sequences retain repeated classes at distinct action placements', () => {
  const body = payloadWithStandardDiffusersComposite();
  const composite = body.definitions.at(-1);
  const adapter = composite.graphAdapterContracts[0];
  adapter.upstreamBlockSequence = adapter.actionSequence.map(() => 'modules.Image.Load');
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body).definitions.at(-1);
  assert.deepEqual(parsed.graphAdapterContracts[0].upstreamBlockSequence, adapter.upstreamBlockSequence);
  const duplicateAction = structuredClone(body);
  duplicateAction.definitions.at(-1).graphAdapterContracts[0].actionSequence[1] = adapter.actionSequence[0];
  assert.throws(() => libraryModule.parseHuggingFaceNodeLibrary(duplicateAction));
  const malformed = structuredClone(body);
  malformed.definitions.at(-1).graphAdapterContracts[0].upstreamBlockSequence[0] = '../invalid';
  assert.throws(() => libraryModule.parseHuggingFaceNodeLibrary(malformed));
  const wrongLength = structuredClone(body);
  wrongLength.definitions.at(-1).graphAdapterContracts[0].upstreamBlockSequence.pop();
  assert.throws(() => libraryModule.parseHuggingFaceNodeLibrary(wrongLength));
});

test('unregistered publications remain structurally insertable while execution receipts stay sealed', () => {
  const body = payload();
  const flux = body.definitions[0];
  const adapter = flux.graphAdapterContracts[0];
  flux.executionAdmissions = [
    {
      schemaVersion: 4,
      id: `diffusers.cluster-admission:${flux.pipelineClass}:${flux.workflowId}:mode:text_to_image`,
      definitionId: flux.id,
      studioMode: 'text_to_image',
      bindingSources: [
        'artifact',
        'classifierFreeGuidance',
        'controlnetKind',
        'controlnetLoadClass',
        'controlnetRepo',
        'controlnetRevision',
        'controlnetRouteVariant',
        'controlnetWeightVariant',
        'false',
        'ipAdapterRepo',
        'ipAdapterRevision',
        'ipAdapterWeightName',
        'pipelineClass',
        'prompt',
        'steps',
      ],
      instanceInputBindings: [{ bindingSource: 'prompt', input: 'prompt' }],
      executionParameterSources: ['steps'],
      sealedBindingValues: {
        artifact: 'black-forest-labs/FLUX.1-dev',
        classifierFreeGuidance: 'ClassifierFreeGuidance',
        controlnetKind: 'controlnet',
        controlnetLoadClass: 'ControlNetUnionModel',
        controlnetRepo: 'xinsir/controlnet-union-sdxl-1.0',
        controlnetRevision: 'b'.repeat(40),
        controlnetRouteVariant: 'union',
        controlnetWeightVariant: '',
        false: false,
        ipAdapterRepo: 'h94/IP-Adapter',
        ipAdapterRevision: 'c'.repeat(40),
        ipAdapterWeightName: 'sdxl_models/ip-adapter_sdxl.safetensors',
        pipelineClass: flux.pipelineClass,
      },
      modelDependencies: [],
      dynamicFieldActions: [
        { role: 'models', field: 'model_type', event: 'onChange', valueSource: 'pipelineClass' },
        { role: 'prompt', field: 'text_encoders', event: 'onSignal', valueSource: 'pipelineClass' },
        { role: 'denoise', field: 'unet', event: 'onSignal', valueSource: 'pipelineClass' },
        { role: 'decode', field: 'vae', event: 'onSignal', valueSource: 'pipelineClass' },
      ],
      adapterContractId: adapter.id,
      studioExecutionSpec: {
        id: 'flux:text-to-image:v1',
        contentHash: 'studio-spec-v1-1234abcd',
        executionProfileId: 'flux:modular',
      },
      artifact: {
        repo: 'black-forest-labs/FLUX.1-dev',
        revision: 'a'.repeat(40),
      },
      status: 'admitted',
      claim: 'static_graph_contract_compatible',
      executable: false,
      publication: graphQualifiedPublication(),
      reasons: [],
    },
  ];

  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body);
  assert.equal(parsed.definitions[0].executionAdmissions[0].status, 'admitted');
  assert.equal(parsed.definitions[0].executionAdmissions[0].executable, false);

  const fanOutBody = structuredClone(body);
  fanOutBody.definitions[0].executionAdmissions[0].bindingSources.push('promptRef');
  fanOutBody.definitions[0].executionAdmissions[0].instanceInputBindings.push({
    bindingSource: 'promptRef',
    input: 'prompt',
  });
  const fanOutAdmission = libraryModule.parseHuggingFaceNodeLibrary(fanOutBody).definitions[0].executionAdmissions[0];
  assert.deepEqual(
    fanOutAdmission.instanceInputBindings.filter(({ input }) => input === 'prompt'),
    [
      { bindingSource: 'prompt', input: 'prompt' },
      { bindingSource: 'promptRef', input: 'prompt' },
    ],
  );
  const sections = libraryCatalogModule.buildHuggingFaceCatalogSections(parsed);
  const graphQualifiedEntry = sections
    .find((section) => section.id === 'diffusers_cluster_nodes')
    .entries.find((entry) => entry.id === flux.id);
  assert.equal(graphQualifiedEntry.readiness, 'catalog_only');
  assert.equal(graphQualifiedEntry.readinessLabel, 'Catalog only');
  assert.equal(graphQualifiedEntry.insertable, true);
  const projected = clusterInstanceModule.huggingFaceClusterOverridesForBindingValues(
    parsed.definitions[0],
    parsed.definitions[0].executionAdmissions[0],
    { prompt: 'A copper telescope', steps: 19, artifact: 'unreviewed/repo', unrelated: true },
  );
  assert.deepEqual(projected.parameterOverrides, { prompt: 'A copper telescope' });
  assert.deepEqual(projected.executionParameterOverrides, { steps: 19 });
  const inserted = clusterGraphModule.createHuggingFaceClusterNode(
    parsed.definitions[0],
    'cluster-graph-qualified',
    { x: 10, y: 20 },
    projected.parameterOverrides,
    parsed.definitions[0].executionAdmissions[0].id,
    projected.executionParameterOverrides,
  );
  assert.equal(
    inserted.data.huggingFaceClusterInstance.execution.admissionId,
    parsed.definitions[0].executionAdmissions[0].id,
  );
  assert.equal(inserted.data.uiState?.disabled, undefined);
  assert.equal(inserted.data.huggingFaceClusterInstance.parameterOverrides.prompt, 'A copper telescope');
  assert.equal(inserted.data.huggingFaceClusterInstance.execution.parameterOverrides.steps, 19);
  assert.deepEqual(inserted.data.huggingFaceClusterInstance.execution.explicitParameterSources, []);

  const mediaDefinition = structuredClone(parsed.definitions[0]);
  mediaDefinition.inputs.push({
    name: 'conditions',
    type: 'builtins.list',
    required: true,
    default: [],
    description: 'Ordered condition images.',
  });
  mediaDefinition.executionAdmissions[0].bindingSources.push('conditionImages');
  mediaDefinition.executionAdmissions[0].instanceInputBindings.push({
    bindingSource: 'conditionImages',
    input: 'conditions',
  });
  const mediaNode = clusterGraphModule.createHuggingFaceClusterNode(mediaDefinition, 'cluster-media-binding', {
    x: 30,
    y: 40,
  });
  assert.equal(mediaNode.data.params.conditions.display, 'filebrowser');
  assert.deepEqual(mediaNode.data.params.conditions.fieldOptions.fileTypes, ['image']);
  assert.equal(mediaNode.data.params.conditions.fieldOptions.multiple, true);

  const sealedOverride = structuredClone(body);
  sealedOverride.definitions[0].executionAdmissions[0].executionParameterSources = ['artifact'];
  assert.throws(
    () => libraryModule.parseHuggingFaceNodeLibrary(sealedOverride),
    /Invalid Hugging Face node-library contract/,
  );

  const unknownInput = structuredClone(body);
  unknownInput.definitions[0].executionAdmissions[0].instanceInputBindings[0].input = 'not_an_input';
  assert.throws(
    () => libraryModule.parseHuggingFaceNodeLibrary(unknownInput),
    /Invalid Hugging Face node-library contract/,
  );

  const forgedPublication = structuredClone(body);
  forgedPublication.definitions[0].executionAdmissions[0].publication.executable = true;
  assert.throws(
    () => libraryModule.parseHuggingFaceNodeLibrary(forgedPublication),
    /Invalid Hugging Face node-library contract/,
  );

  flux.executionAdmissions[0].executable = true;
  assert.throws(() => libraryModule.parseHuggingFaceNodeLibrary(body), /Invalid Hugging Face node-library contract/);
});

test('admitted execution specs materialize stable isolated skeletons that stay disabled', async () => {
  const body = payload();
  const fluxDefinition = body.definitions[0];
  const adapter = fluxDefinition.graphAdapterContracts[0];
  const receipt = {
    id: 'flux:text-to-image:v1',
    contentHash: 'studio-spec-v1-1234abcd',
    executionProfileId: 'flux:modular',
  };
  fluxDefinition.executionAdmissions = [
    {
      schemaVersion: 4,
      id: `diffusers.cluster-admission:${fluxDefinition.pipelineClass}:${fluxDefinition.workflowId}:mode:text_to_image`,
      definitionId: fluxDefinition.id,
      studioMode: 'text_to_image',
      bindingSources: ['artifact', 'controlnetRepo', 'false', 'pipelineClass', 'prompt', 'steps'],
      instanceInputBindings: [{ bindingSource: 'prompt', input: 'prompt' }],
      executionParameterSources: ['steps'],
      sealedBindingValues: {
        artifact: 'black-forest-labs/FLUX.1-dev',
        controlnetRepo: 'xinsir/controlnet-union-sdxl-1.0',
        false: false,
        pipelineClass: fluxDefinition.pipelineClass,
      },
      modelDependencies: [],
      dynamicFieldActions: [
        { role: 'models', field: 'model_type', event: 'onChange', valueSource: 'pipelineClass' },
        { role: 'prompt', field: 'text_encoders', event: 'onSignal', valueSource: 'pipelineClass' },
        { role: 'denoise', field: 'unet', event: 'onSignal', valueSource: 'pipelineClass' },
        { role: 'decode', field: 'vae', event: 'onSignal', valueSource: 'pipelineClass' },
      ],
      adapterContractId: adapter.id,
      studioExecutionSpec: receipt,
      artifact: { repo: 'black-forest-labs/FLUX.1-dev', revision: 'a'.repeat(40) },
      status: 'admitted',
      claim: 'static_graph_contract_compatible',
      executable: false,
      publication: graphQualifiedPublication(),
      reasons: [],
    },
  ];
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body);
  const definition = parsed.definitions[0];
  const admission = definition.executionAdmissions[0];
  const selectedInstance = clusterInstanceModule.setHuggingFaceClusterExecution(
    clusterInstanceModule.createHuggingFaceClusterInstance(definition, 'cluster-flux-materialized', {
      prompt: 'A brass observatory',
    }),
    definition,
    admission.id,
  );
  const instance = clusterInstanceModule.setHuggingFaceClusterExecutionParameter(
    selectedInstance,
    definition,
    'steps',
    28,
  );
  const node = (key, params) => {
    const [module, action] = key.split(/\.(?=[^.]+$)/u);
    return { type: 'custom', module, action, label: action, category: 'test', params };
  };
  const input = (type) => ({ display: 'input', type });
  const output = (type) => ({ display: 'output', type });
  const registry = {
    'modules.ModularDiffusers.ModelsLoader': node('modules.ModularDiffusers.ModelsLoader', {
      model_type: { type: 'string', onChange: 'set_filters' },
      repo_id: { type: 'string', display: 'modelselect', value: { source: 'hub', value: '' } },
      controlnet_id: { type: 'string', display: 'modelselect', value: { source: 'hub', value: '' } },
      trust_remote_code: { type: 'boolean', value: false },
      text_encoders: output('models'),
      unet_out: output('model'),
      scheduler: output('scheduler'),
      vae_out: output('model'),
    }),
    'modules.ModularDiffusers.EncodePrompt': node('modules.ModularDiffusers.EncodePrompt', {
      text_encoders: { ...input('models'), onSignal: 'update_node' },
      prompt: { type: 'string' },
      embeddings: output('embeddings'),
    }),
    'modules.ModularDiffusers.Denoise': node('modules.ModularDiffusers.Denoise', {
      unet: { ...input('model'), onSignal: 'update_node' },
      scheduler: input('scheduler'),
      embeddings: input('embeddings'),
      num_inference_steps: { type: 'int' },
      latents: output('latents'),
    }),
    'modules.ModularDiffusers.DecodeLatents': node('modules.ModularDiffusers.DecodeLatents', {
      vae: { ...input('model'), onSignal: 'update_node' },
      latents: input('latents'),
      images: output('image'),
    }),
    'modules.Image.Preview': node('modules.Image.Preview', {
      image: input('image'),
      preview: { display: 'ui_image', type: 'url', dataSource: 'output' },
      output: output('image'),
    }),
  };
  const executionSpec = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    ...receipt,
    modelType: fluxDefinition.pipelineClass,
    mode: 'text_to_image',
    loaderModule: 'modules.ModularDiffusers',
    loaderAction: 'ModelsLoader',
    executionPath: 'modular-diffusers',
    pipelineClass: fluxDefinition.pipelineClass,
    defaultRepo: admission.artifact.repo,
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
      ['models', 'controlnet_id', 'controlnetRepo'],
      ['models', 'trust_remote_code', 'false'],
      ['prompt', 'prompt', 'prompt'],
      ['denoise', 'num_inference_steps', 'steps'],
    ],
    autoFields: [],
    actions: [],
  };
  const skeleton = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec,
    nodesRegistry: registry,
  });
  assert.ok(
    skeleton.nodes
      .flatMap((item) => Object.values(item.data.params))
      .every((param) => param.fieldOptions?.suppressInitialFieldAction === true),
    'rendering a finalized Cluster execution graph must not replay dynamic field actions',
  );
  assert.throws(
    () =>
      clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
        definition,
        instance,
        admission,
        executionSpec,
        nodesRegistry: registry,
        bindingValues: { artifact: 'evil/repo' },
      }),
    /sealed or planner binding values/,
  );

  const pendingRegistry = structuredClone(registry);
  delete pendingRegistry['modules.ModularDiffusers.Denoise'].params.num_inference_steps;
  const pendingSkeleton = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec,
    nodesRegistry: pendingRegistry,
  });
  assert.equal(pendingSkeleton.bindingsComplete, false);
  assert.ok(
    pendingSkeleton.pendingFields.some(
      (item) => item.role === 'denoise' && item.field === 'num_inference_steps' && item.purpose === 'binding',
    ),
  );
  const reconciledSkeleton = clusterMaterializerModule.reconcileHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec,
    skeleton: pendingSkeleton,
    currentNodes: skeleton.nodes,
  });
  assert.equal(reconciledSkeleton.bindingsComplete, true);
  assert.deepEqual(
    reconciledSkeleton.nodes.map((item) => item.id),
    pendingSkeleton.nodes.map((item) => item.id),
  );

  assert.equal(skeleton.bindingsComplete, true);
  assert.equal(skeleton.executable, false);
  assert.equal(skeleton.nodes.length, 5);
  assert.equal(skeleton.edges.length, 7);
  assert.ok(skeleton.nodes.every((item) => item.hidden && item.data.uiState.disabled));
  assert.equal(
    skeleton.nodes.find((item) => item.data.huggingFaceClusterExecutionRole === 'prompt').data.params.prompt.value,
    'A brass observatory',
  );
  assert.deepEqual(
    skeleton.nodes.find((item) => item.data.huggingFaceClusterExecutionRole === 'models').data.params.repo_id.value,
    { source: 'hub', value: 'black-forest-labs/FLUX.1-dev' },
  );
  assert.deepEqual(
    skeleton.nodes.find((item) => item.data.huggingFaceClusterExecutionRole === 'models').data.params.controlnet_id
      .value,
    { source: 'hub', value: 'xinsir/controlnet-union-sdxl-1.0' },
  );
  assert.equal(
    skeleton.nodes.find((item) => item.data.huggingFaceClusterExecutionRole === 'denoise').data.params
      .num_inference_steps.value,
    28,
  );
  const fieldActionPlan = clusterFinalizationModule.planHuggingFaceClusterDynamicFieldActions({
    definition,
    instance,
    admission,
    executionSpec,
    skeleton,
    nodes: skeleton.nodes,
  });
  assert.equal(fieldActionPlan.executable, false);
  assert.deepEqual(
    fieldActionPlan.actions.map(({ role, field, event, value }) => ({ role, field, event, value })),
    [
      { role: 'models', field: 'model_type', event: 'onChange', value: fluxDefinition.pipelineClass },
      { role: 'prompt', field: 'text_encoders', event: 'onSignal', value: fluxDefinition.pipelineClass },
      { role: 'denoise', field: 'unet', event: 'onSignal', value: fluxDefinition.pipelineClass },
      { role: 'decode', field: 'vae', event: 'onSignal', value: fluxDefinition.pipelineClass },
    ],
  );
  const appliedActions = [];
  const fieldActionReceipt = await clusterFinalizationModule.applyHuggingFaceClusterDynamicFieldActionPlan(
    fieldActionPlan,
    async (action) => appliedActions.push(`${action.role}.${action.field}.${action.event}`),
  );
  assert.equal(fieldActionReceipt.executable, false);
  assert.deepEqual(appliedActions, [
    'models.model_type.onChange',
    'prompt.text_encoders.onSignal',
    'denoise.unet.onSignal',
    'decode.vae.onSignal',
  ]);
  const staleNodes = structuredClone(skeleton.nodes);
  delete staleNodes.find((item) => item.data.huggingFaceClusterExecutionRole === 'prompt').data.params.text_encoders
    .onSignal;
  assert.throws(
    () =>
      clusterFinalizationModule.planHuggingFaceClusterDynamicFieldActions({
        definition,
        instance,
        admission,
        executionSpec,
        skeleton,
        nodes: staleNodes,
      }),
    /absent from the live node definition/,
  );
  assert.equal(flowGraphExportModule.executableFlowNodes(skeleton.nodes).length, 0);

  const repeated = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec,
    nodesRegistry: registry,
  });
  assert.deepEqual(
    repeated.nodes.map((item) => item.id),
    skeleton.nodes.map((item) => item.id),
  );
  assert.deepEqual(
    repeated.edges.map((item) => item.id),
    skeleton.edges.map((item) => item.id),
  );
  const expandedSkeleton = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec,
    nodesRegistry: registry,
    expanded: true,
  });
  assert.deepEqual(
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(expandedSkeleton),
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(skeleton),
  );
  const refreshedInstance = clusterInstanceModule.validateHuggingFaceClusterInstance(
    JSON.parse(JSON.stringify(instance)),
    definition,
  );
  const refreshedSkeleton = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: refreshedInstance,
    admission,
    executionSpec,
    nodesRegistry: registry,
  });
  assert.deepEqual(
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(refreshedSkeleton),
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(skeleton),
  );

  const plainRoot = clusterGraphModule.createHuggingFaceClusterNode(
    definition,
    instance.instanceId,
    { x: 40, y: 60 },
    instance.parameterOverrides,
  );
  const selectedRootGraph = clusterGraphModule.setHuggingFaceClusterGraphExecution(
    { nodes: [plainRoot], edges: [] },
    instance.instanceId,
    definition,
    admission.id,
  );
  const configuredRootGraph = clusterGraphModule.setHuggingFaceClusterGraphExecutionParameter(
    selectedRootGraph,
    instance.instanceId,
    definition,
    'steps',
    28,
  );
  const root = configuredRootGraph.nodes[0];
  const previousFlow = {
    nodes: flowStoreModule.useFlowStore.getState().nodes,
    edges: flowStoreModule.useFlowStore.getState().edges,
  };
  flowStoreModule.useFlowStore.setState({ nodes: [root], edges: [] });
  let publishedDynamicFields = false;
  const flowFinalization = await clusterFinalizationModule.finalizeHuggingFaceClusterDynamicFieldsInFlow(
    {
      definition,
      instance,
      admission,
      executionSpec,
      skeleton: pendingSkeleton,
      timeoutMs: 100,
    },
    async () => {
      if (publishedDynamicFields) return;
      publishedDynamicFields = true;
      const completeNodes = new Map(skeleton.nodes.map((item) => [item.id, item]));
      flowStoreModule.useFlowStore.setState((state) => ({
        nodes: state.nodes.map((item) => completeNodes.get(item.id) ?? item),
      }));
    },
  );
  assert.equal(flowFinalization.executable, false);
  assert.equal(flowFinalization.skeleton.bindingsComplete, true);
  assert.ok(flowFinalization.skeleton.nodes.every((item) => item.data.uiState.disabled));
  assert.deepEqual(flowFinalization.studioExecutionSpec, {
    schemaVersion: 1,
    id: receipt.id,
    contentHash: receipt.contentHash,
    nodes: flowFinalization.skeleton.nodeIdsByRole,
  });
  flowStoreModule.useFlowStore.setState(previousFlow);
  const attached = clusterGraphModule.attachHuggingFaceClusterExecutionSkeleton(
    { nodes: [root], edges: [] },
    instance.instanceId,
    definition,
    skeleton,
  );
  const attachedExecutionNodes = attached.nodes.filter((item) => item.data.huggingFaceClusterRole === 'execution');
  assert.equal(attachedExecutionNodes.length, 5);
  assert.ok(
    attachedExecutionNodes.every(
      (item) => item.hidden === false && item.style?.visibility === 'hidden' && item.style?.pointerEvents === 'none',
    ),
  );
  assert.ok(attached.edges.every((edge) => edge.hidden));
  const attachedRoot = attached.nodes.find((item) => item.id === instance.instanceId);
  const rootInput = Object.entries(attachedRoot.data.params).find(
    ([, param]) => param.fieldOptions?.huggingFaceClusterPortDirection === 'input',
  );
  const rootOutput = Object.entries(attachedRoot.data.params).find(
    ([, param]) => param.fieldOptions?.huggingFaceClusterPortDirection === 'output',
  );
  assert.equal(rootInput[1].display, 'input');
  assert.equal(rootInput[1].label, 'prompt');
  assert.equal(rootOutput[1].display, 'output');
  assert.equal(rootOutput[1].label, 'images');
  const externalEdges = [
    {
      id: 'external-prompt-to-cluster',
      source: 'external-prompt',
      sourceHandle: 'text',
      target: instance.instanceId,
      targetHandle: rootInput[0],
    },
    {
      id: 'cluster-to-external-preview',
      source: instance.instanceId,
      sourceHandle: rootOutput[0],
      target: 'external-preview',
      targetHandle: 'image',
    },
  ];
  const bridged = clusterGraphModule.expandHuggingFaceClusterBoundaryEdges({
    nodes: attached.nodes,
    edges: [...attached.edges, ...externalEdges],
  });
  const bridgedInput = bridged.edges.find((edge) => edge.id === 'external-prompt-to-cluster');
  const bridgedOutput = bridged.edges.find((edge) => edge.id === 'cluster-to-external-preview');
  assert.equal(bridgedInput.target, rootInput[1].fieldOptions.huggingFaceClusterPortNodeId);
  assert.equal(bridgedInput.targetHandle, rootInput[1].fieldOptions.huggingFaceClusterPortField);
  assert.equal(bridgedOutput.source, rootOutput[1].fieldOptions.huggingFaceClusterPortNodeId);
  assert.equal(bridgedOutput.sourceHandle, rootOutput[1].fieldOptions.huggingFaceClusterPortField);
  const runtimeAuthority = {
    schemaVersion: 1,
    instanceId: instance.instanceId,
    definitionId: definition.id,
    admissionId: admission.id,
    executionFingerprint: 'hfcluster_test_authority',
    runtimeFingerprint: `sha256:${'b'.repeat(64)}`,
    checkedAt: 1,
    claim: 'qualification_execution_authorized',
    publicationExecutable: false,
    nodeIds: Object.values(skeleton.nodeIdsByRole),
  };
  const authorized = clusterMaterializerModule.authorizeHuggingFaceClusterExecutionSkeleton(skeleton, runtimeAuthority);
  assert.equal(authorized.executable, true);
  assert.ok(authorized.nodes.every((item) => item.data.uiState.disabled === false));
  const executableAttached = clusterGraphModule.attachHuggingFaceClusterExecutableGraph(
    { nodes: [root], edges: [] },
    instance.instanceId,
    definition,
    authorized,
  );
  const apiExport = (graph) =>
    flowGraphExportModule.buildApiGraphExport({
      nodes: graph.nodes,
      edges: graph.edges,
      sid: 'cluster-test',
      setParam: () => {},
    });
  const collapsedExecutableExport = apiExport(executableAttached);
  const fork = clusterForkModule.createHuggingFaceClusterUserNodeFork({
    graph: attached,
    instanceId: instance.instanceId,
    definition,
    admission,
    skeleton,
  });
  assert.equal(fork.blockNode.id, instance.instanceId);
  assert.equal(fork.blockNode.data.category, 'User Nodes');
  assert.equal(fork.block.origin.kind, 'hugging_face_cluster_fork');
  assert.equal(fork.block.origin.definitionId, definition.id);
  assert.equal(fork.block.origin.pipelineClass, definition.pipelineClass);
  assert.equal(fork.block.origin.workflowId, definition.workflowId);
  assert.equal(fork.block.origin.rootBlockDefinitionId, definition.rootBlockDefinitionId);
  assert.equal(fork.block.origin.blockContractHash, definition.blockContractHash);
  assert.equal(fork.block.origin.compositionKind, 'modiff_graph_snapshot');
  assert.equal(fork.block.origin.admissionId, admission.id);
  assert.equal(fork.block.origin.repo, admission.artifact.repo);
  assert.equal(fork.block.origin.revision, admission.artifact.revision);
  assert.ok(
    fork.block.nodes.every(
      (item) =>
        !item.data.huggingFaceClusterRole &&
        !item.data.huggingFaceClusterInstanceId &&
        item.data.uiState.disabled === false,
    ),
  );
  const forkedModelNode = fork.block.nodes.find((item) => item.data.action === 'ModelsLoader');
  assert.equal(forkedModelNode.data.params.repo_id.disabled, false);
  assert.equal(forkedModelNode.data.params.repo_id.fieldOptions?.huggingFaceClusterBinding, undefined);
  const forkedGraph = clusterForkModule.replaceHuggingFaceClusterWithUserNode(
    attached,
    instance.instanceId,
    fork.blockNode,
  );
  assert.equal(forkedGraph.nodes.length, 1);
  assert.equal(forkedGraph.nodes[0].data.type, 'block');
  const expandedFork = userBlocksModule.expandUserBlockGraph(forkedGraph.nodes, forkedGraph.edges, [fork.block]);
  assert.deepEqual(apiExport(expandedFork), collapsedExecutableExport);
  const editableFork = userBlocksModule.expandUserBlockInstance(forkedGraph, fork.blockNode.id, [fork.block]);
  const editableParent = editableFork.nodes.find((item) => item.id === fork.blockNode.id);
  const dropPosition = {
    x: editableParent.position.x + userBlocksModule.USER_BLOCK_CHILD_LEFT + 12,
    y: editableParent.position.y + userBlocksModule.USER_BLOCK_CHILD_TOP + 12,
  };
  assert.equal(userBlocksModule.expandedUserBlockAtPosition(editableFork.nodes, dropPosition)?.id, fork.blockNode.id);
  const injectedNode = structuredClone(fork.block.nodes[0]);
  injectedNode.id = 'user-injected-node';
  injectedNode.position = dropPosition;
  const adopted = userBlocksModule.placeNodeInsideExpandedUserBlock(injectedNode, editableParent, dropPosition);
  assert.equal(adopted.parentId, fork.blockNode.id);
  assert.equal(adopted.data.userBlockInstanceId, fork.blockNode.id);
  const structurallyEdited = userBlocksModule.collapseUserBlockInstance(
    { nodes: [...editableFork.nodes, adopted], edges: editableFork.edges },
    fork.blockNode.id,
    [fork.block],
  );
  const editedSnapshot = structurallyEdited.nodes.find((item) => item.id === fork.blockNode.id).data.userBlockSnapshot;
  assert.ok(editedSnapshot.nodes.some((item) => item.id === 'user-injected-node'));
  assert.ok(
    JSON.parse(JSON.stringify(structurallyEdited))
      .nodes.find((item) => item.id === fork.blockNode.id)
      .data.userBlockSnapshot.nodes.some((item) => item.id === 'user-injected-node'),
  );
  const expandedExecutable = clusterGraphModule.expandHuggingFaceClusterInstance(
    executableAttached,
    instance.instanceId,
    definition,
  );
  assert.deepEqual(apiExport(expandedExecutable), collapsedExecutableExport);
  const persistedExecutableGraph = flowStoreModule.normalizePersistedFlowState(
    JSON.parse(JSON.stringify({ ...executableAttached, viewport: { x: 0, y: 0, zoom: 1 } })),
  );
  assert.equal(
    persistedExecutableGraph.nodes.some(
      (item) => item.data.huggingFaceClusterRole === 'block' || item.data.huggingFaceClusterRole === 'execution',
    ),
    false,
  );
  assert.equal(persistedExecutableGraph.edges.length, 0);
  const persistedExecutableRoot = persistedExecutableGraph.nodes.find((item) => item.id === instance.instanceId);
  const refreshedExecutableSkeleton = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: persistedExecutableRoot.data.huggingFaceClusterInstance,
    admission,
    executionSpec,
    nodesRegistry: registry,
  });
  const refreshedAuthorized = clusterMaterializerModule.authorizeHuggingFaceClusterExecutionSkeleton(
    refreshedExecutableSkeleton,
    runtimeAuthority,
  );
  const refreshedExecutable = clusterGraphModule.attachHuggingFaceClusterExecutableGraph(
    { nodes: [persistedExecutableRoot], edges: [] },
    instance.instanceId,
    definition,
    refreshedAuthorized,
  );
  assert.deepEqual(apiExport(refreshedExecutable), collapsedExecutableExport);
  const previewExecutionNode = attachedExecutionNodes.find(
    (item) => item.data.huggingFaceClusterExecutionRole === 'preview',
  );
  const collapsedPreviewTarget = clusterGraphModule.collapsedHuggingFaceClusterPreviewTarget(
    attached.nodes,
    previewExecutionNode.id,
    'preview',
  );
  assert.equal(collapsedPreviewTarget.nodeId, instance.instanceId);
  assert.equal(userBlocksModule.runtimeProgressTarget(attached.nodes, previewExecutionNode.id), instance.instanceId);
  const promptExecutionNode = attachedExecutionNodes.find(
    (item) => item.data.huggingFaceClusterExecutionRole === 'prompt',
  );
  const modelExecutionNode = attachedExecutionNodes.find(
    (item) => item.data.huggingFaceClusterExecutionRole === 'models',
  );
  const promptEdited = clusterGraphModule.setHuggingFaceClusterGraphChildParameter(
    attached,
    promptExecutionNode.id,
    definition,
    'prompt',
    'A silver observatory',
  );
  assert.equal(promptEdited.nodes.filter((item) => item.data.huggingFaceClusterRole === 'execution').length, 0);
  const promptEditedInstance = promptEdited.nodes.find((item) => item.id === instance.instanceId).data
    .huggingFaceClusterInstance;
  const promptEditedSkeleton = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: promptEditedInstance,
    admission,
    executionSpec,
    nodesRegistry: registry,
  });
  const promptReattached = clusterGraphModule.attachHuggingFaceClusterExecutionSkeleton(
    promptEdited,
    instance.instanceId,
    definition,
    promptEditedSkeleton,
  );
  const reboundDenoiseNode = promptReattached.nodes.find(
    (item) => item.data.huggingFaceClusterExecutionRole === 'denoise',
  );
  const executionEdited = clusterGraphModule.setHuggingFaceClusterGraphChildParameter(
    promptReattached,
    reboundDenoiseNode.id,
    definition,
    'num_inference_steps',
    36,
  );
  assert.equal(executionEdited.nodes.filter((item) => item.data.huggingFaceClusterRole === 'execution').length, 0);
  const editedRootInstance = executionEdited.nodes.find((item) => item.id === instance.instanceId).data
    .huggingFaceClusterInstance;
  assert.equal(editedRootInstance.parameterOverrides.prompt, 'A silver observatory');
  assert.equal(editedRootInstance.execution.parameterOverrides.steps, 36);
  assert.equal(
    clusterInstanceModule.validateHuggingFaceClusterInstance(JSON.parse(JSON.stringify(editedRootInstance)), definition)
      .execution.parameterOverrides.steps,
    36,
  );
  assert.throws(
    () =>
      clusterGraphModule.setHuggingFaceClusterGraphChildParameter(
        attached,
        modelExecutionNode.id,
        definition,
        'repo_id',
        'evil/repo',
      ),
    /sealed by the reviewed contract/,
  );

  const expanded = clusterGraphModule.expandHuggingFaceClusterInstance(attached, instance.instanceId, definition);
  const expandedExecutionNodes = expanded.nodes.filter((item) => item.data.huggingFaceClusterRole === 'execution');
  assert.deepEqual(
    expandedExecutionNodes.map((item) => item.id),
    attachedExecutionNodes.map((item) => item.id),
  );
  assert.ok(
    expandedExecutionNodes.every(
      (item) =>
        item.hidden === false && item.style?.visibility === 'visible' && item.style?.pointerEvents === undefined,
    ),
  );
  const topLevelBlockBottom = Math.max(
    ...expanded.nodes
      .filter((item) => item.parentId === instance.instanceId && item.data.huggingFaceClusterRole === 'block')
      .map((item) => item.position.y + (item.height ?? 0)),
  );
  assert.ok(Math.min(...expandedExecutionNodes.map((item) => item.position.y)) > topLevelBlockBottom);
  assert.ok(expanded.edges.every((edge) => edge.hidden === false));
  assert.equal(
    clusterGraphModule.collapsedHuggingFaceClusterPreviewTarget(expanded.nodes, previewExecutionNode.id, 'preview'),
    null,
  );
  assert.equal(
    userBlocksModule.runtimeProgressTarget(expanded.nodes, previewExecutionNode.id),
    previewExecutionNode.id,
  );
  assert.deepEqual(
    flowGraphExportModule.buildApiGraphExport({
      nodes: attached.nodes,
      edges: attached.edges,
      sid: 'cluster-materialized',
      setParam: () => {},
    }),
    flowGraphExportModule.buildApiGraphExport({
      nodes: expanded.nodes,
      edges: expanded.edges,
      sid: 'cluster-materialized',
      setParam: () => {},
    }),
  );

  const movedPromptPosition = {
    x: expandedExecutionNodes.find((item) => item.data.huggingFaceClusterExecutionRole === 'prompt').position.x + 37,
    y: expandedExecutionNodes.find((item) => item.data.huggingFaceClusterExecutionRole === 'prompt').position.y + 29,
  };
  const graphWithMovedPrompt = {
    ...expanded,
    nodes: expanded.nodes.map((item) =>
      item.data.huggingFaceClusterExecutionRole === 'prompt' ? { ...item, position: movedPromptPosition } : item,
    ),
  };
  const layoutPersisted = clusterGraphModule.setHuggingFaceClusterGraphExecutionPosition(
    graphWithMovedPrompt,
    promptExecutionNode.id,
    definition,
  );
  const layoutRoot = layoutPersisted.nodes.find((item) => item.id === instance.instanceId);
  assert.deepEqual(layoutRoot.data.huggingFaceClusterInstance.presentation.executionLayout.prompt, {
    x: movedPromptPosition.x - 8,
    y: movedPromptPosition.y - 40,
  });
  const durableLayoutGraph = flowStoreModule.normalizePersistedFlowState({
    ...layoutPersisted,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  assert.equal(
    durableLayoutGraph.nodes.some((item) => item.data.huggingFaceClusterRole === 'execution'),
    false,
  );
  const durableLayoutRoot = durableLayoutGraph.nodes.find((item) => item.id === instance.instanceId);
  const rematerializedLayoutSkeleton = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: durableLayoutRoot.data.huggingFaceClusterInstance,
    admission,
    executionSpec,
    nodesRegistry: registry,
    expanded: true,
  });
  const restoredLayoutGraph = clusterGraphModule.attachHuggingFaceClusterExecutionSkeleton(
    { nodes: [durableLayoutRoot], edges: [] },
    instance.instanceId,
    definition,
    rematerializedLayoutSkeleton,
  );
  assert.deepEqual(
    restoredLayoutGraph.nodes.find((item) => item.data.huggingFaceClusterExecutionRole === 'prompt').position,
    movedPromptPosition,
  );

  const restored = clusterGraphModule.reconcileHuggingFaceClusterGraph(expanded, instance.instanceId, definition);
  assert.equal(
    restored.nodes.some((item) => item.data.huggingFaceClusterRole === 'execution'),
    false,
  );
  assert.equal(restored.edges.length, 0);
  assert.equal(
    Object.values(restored.nodes.find((item) => item.id === instance.instanceId).data.params).some(
      (param) => typeof param.fieldOptions?.huggingFaceClusterPreviewSourceNodeId === 'string',
    ),
    false,
  );
});

test('schema-v4 admissions preserve reviewed auxiliary-stage and single-frame constants', () => {
  const { body } = payloadWithMiniMaxMusic3Workflow();
  const admission = body.definitions[0].executionAdmissions[0];
  admission.bindingSources.push(
    'oneFrame',
    'oneVideo',
    'workflowAfterDecodeBlock',
    'workflowImageEmbeddingsBlock',
    'workflowVaeEncoderBlock',
  );
  admission.sealedBindingValues.oneFrame = 1;
  admission.sealedBindingValues.oneVideo = 1;
  admission.sealedBindingValues.workflowAfterDecodeBlock = 'after_decode';
  admission.sealedBindingValues.workflowImageEmbeddingsBlock = 'image_encoder';
  admission.sealedBindingValues.workflowVaeEncoderBlock = 'vae_encoder';

  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body);
  const values = parsed.definitions[0].executionAdmissions[0].sealedBindingValues;
  assert.equal(values.oneFrame, 1);
  assert.equal(values.oneVideo, 1);
  assert.equal(values.workflowImageEmbeddingsBlock, 'image_encoder');
  assert.equal(values.workflowVaeEncoderBlock, 'vae_encoder');
  assert.equal(values.workflowAfterDecodeBlock, 'after_decode');
});

test('audio admissions retain reviewed native rates, task and waveform count without accepting arbitrary constants', () => {
  const { body } = payloadWithMiniMaxMusic3Workflow();
  const admission = body.definitions[0].executionAdmissions[0];
  const constants = { sampleRate24000: 24000, sampleRate16000: 16000, numWaveforms3: 3, text2audio: 'text2audio' };
  admission.bindingSources.push(...Object.keys(constants));
  Object.assign(admission.sealedBindingValues, constants);
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body);
  for (const [key, value] of Object.entries(constants))
    assert.equal(parsed.definitions[0].executionAdmissions[0].sealedBindingValues[key], value);
  admission.bindingSources.push('arbitraryAudioConstant');
  admission.sealedBindingValues.arbitraryAudioConstant = 1;
  assert.throws(() => libraryModule.parseHuggingFaceNodeLibrary(body), /Invalid Hugging Face/u);
});

test('official whole-workflow Modular Diffusers routes materialize their exact stateful stage graph', () => {
  const { body, receipt, revision } = payloadWithMiniMaxMusic3Workflow();
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body);
  const definition = parsed.definitions[0];
  const admission = definition.executionAdmissions[0];
  assert.equal(definition.integrationStatus, 'reviewed_modular_workflow_route');
  assert.deepEqual(definition.graphAdapterContracts[0].upstreamBlockSequence, [
    'semantic_generator',
    'denoise',
    'decode',
  ]);

  const selected = clusterInstanceModule.setHuggingFaceClusterExecution(
    clusterInstanceModule.createHuggingFaceClusterInstance(definition, 'cluster-minimax-music3', {
      prompt: 'Orchestral synthwave with a rising chorus',
      lyrics: '[verse]\nUnder neon skies\n[chorus]\nWe rise',
      audio_duration: 18,
      num_inference_steps: 24,
    }),
    definition,
    admission.id,
  );
  const node = (module, action, params) => ({
    type: 'custom',
    module,
    action,
    label: action,
    category: 'test',
    params,
  });
  const input = (type) => ({ display: 'input', type });
  const output = (type) => ({ display: 'output', type });
  const registry = {
    'modules.ModularDiffusers.ModelsLoader': node('modules.ModularDiffusers', 'ModelsLoader', {
      model_type: { type: 'string', onChange: 'set_filters' },
      repo_id: { type: 'string', display: 'modelselect', value: { source: 'hub', value: '' } },
      revision: { type: 'string', value: '' },
      dtype: { type: 'string', value: 'bfloat16' },
      device: { type: 'string', value: 'cuda:0' },
      auto_offload: { type: 'boolean', value: true },
      offload_mode: { type: 'string', value: 'group_cpu' },
      trust_remote_code: { type: 'boolean', value: false },
      pipeline_components: output('diffusers_modular_pipeline_components'),
    }),
    'modules.ModularDiffusers.WorkflowSemanticGeneration': node(
      'modules.ModularDiffusers',
      'WorkflowSemanticGeneration',
      {
        pipeline_components: input('diffusers_modular_pipeline_components'),
        pipeline_class: { type: 'string', value: '' },
        workflow_id: { type: 'string', value: '' },
        block_path: { type: 'string', value: '' },
        prompt: { type: 'string', value: '' },
        lyrics: { type: 'string', value: '' },
        audio_duration: { type: 'float', value: 60 },
        seed: { type: 'int', value: 0 },
        state_out: output('modular_workflow_state'),
      },
    ),
    'modules.ModularDiffusers.WorkflowDenoise': node('modules.ModularDiffusers', 'WorkflowDenoise', {
      pipeline_components: input('diffusers_modular_pipeline_components'),
      state_in: input('modular_workflow_state'),
      pipeline_class: { type: 'string', value: '' },
      workflow_id: { type: 'string', value: '' },
      block_path: { type: 'string', value: '' },
      num_inference_steps: { type: 'int', value: 30 },
      state_out: output('modular_workflow_state'),
    }),
    'modules.ModularDiffusers.WorkflowDecodeAudio': node('modules.ModularDiffusers', 'WorkflowDecodeAudio', {
      pipeline_components: input('diffusers_modular_pipeline_components'),
      state_in: input('modular_workflow_state'),
      pipeline_class: { type: 'string', value: '' },
      workflow_id: { type: 'string', value: '' },
      block_path: { type: 'string', value: '' },
      audio: output('audio'),
    }),
    'modules.Audio.Export': node('modules.Audio', 'Export', {
      audio: input('audio'),
      sample_rate: { type: 'int', value: 48000 },
      preview: { display: 'ui_audio', type: 'url', dataSource: 'output' },
    }),
  };
  const executionSpec = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    ...receipt,
    modelType: definition.pipelineClass,
    mode: 'text_to_audio',
    loaderModule: 'modules.ModularDiffusers',
    loaderAction: 'ModelsLoader',
    executionPath: 'modular-diffusers',
    pipelineClass: definition.pipelineClass,
    defaultRepo: admission.artifact.repo,
    roles: [
      ['models', 'modules.ModularDiffusers.ModelsLoader', -900, -80],
      ['prompt', 'modules.ModularDiffusers.WorkflowSemanticGeneration', -500, -80],
      ['denoise', 'modules.ModularDiffusers.WorkflowDenoise', -100, -80],
      ['decode', 'modules.ModularDiffusers.WorkflowDecodeAudio', 300, -80],
      ['audioExport', 'modules.Audio.Export', 700, -80],
    ],
    edges: [
      ['models', 'pipeline_components', 'prompt', 'pipeline_components'],
      ['models', 'pipeline_components', 'denoise', 'pipeline_components'],
      ['models', 'pipeline_components', 'decode', 'pipeline_components'],
      ['prompt', 'state_out', 'denoise', 'state_in'],
      ['denoise', 'state_out', 'decode', 'state_in'],
      ['decode', 'audio', 'audioExport', 'audio'],
    ],
    bindings: [
      ['models', 'model_type', 'pipelineClass'],
      ['models', 'repo_id', 'artifact'],
      ['models', 'revision', 'defaultRevision'],
      ['models', 'dtype', 'dtype'],
      ['models', 'device', 'device'],
      ['models', 'auto_offload', 'autoOffload'],
      ['models', 'offload_mode', 'offloadMode'],
      ['models', 'trust_remote_code', 'false'],
      ['prompt', 'pipeline_class', 'pipelineClass'],
      ['prompt', 'workflow_id', 'defaultWorkflow'],
      ['prompt', 'block_path', 'semanticGeneratorBlock'],
      ['prompt', 'prompt', 'prompt'],
      ['prompt', 'lyrics', 'lyrics'],
      ['prompt', 'audio_duration', 'audioDuration'],
      ['prompt', 'seed', 'seed'],
      ['denoise', 'pipeline_class', 'pipelineClass'],
      ['denoise', 'workflow_id', 'defaultWorkflow'],
      ['denoise', 'block_path', 'workflowDenoiseBlock'],
      ['denoise', 'num_inference_steps', 'steps'],
      ['decode', 'pipeline_class', 'pipelineClass'],
      ['decode', 'workflow_id', 'defaultWorkflow'],
      ['decode', 'block_path', 'workflowDecodeBlock'],
      ['audioExport', 'sample_rate', 'sampleRate44100'],
    ],
    autoFields: [],
    actions: [],
  };
  const bindingValues = {
    autoOffload: true,
    device: 'cuda:0',
    dtype: 'bfloat16',
    offloadMode: 'group_cpu',
    seed: 314159,
  };
  const collapsed = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: selected,
    admission,
    executionSpec,
    nodesRegistry: registry,
    bindingValues,
  });
  const refreshed = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: clusterInstanceModule.validateHuggingFaceClusterInstance(
      JSON.parse(JSON.stringify(selected)),
      definition,
    ),
    admission,
    executionSpec,
    nodesRegistry: registry,
    bindingValues,
    expanded: true,
  });

  assert.equal(collapsed.bindingsComplete, true);
  assert.equal(collapsed.nodes.length, 5);
  assert.equal(collapsed.edges.length, 6);
  assert.deepEqual(
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(refreshed),
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(collapsed),
  );
  const byRole = Object.fromEntries(
    collapsed.nodes.map((candidate) => [candidate.data.huggingFaceClusterExecutionRole, candidate]),
  );
  assert.equal(byRole.models.data.params.revision.value, revision);
  assert.equal(byRole.models.data.params.repo_id.value.value, 'MiniMaxAI/MiniMax-Music3');
  assert.equal(byRole.prompt.data.params.workflow_id.value, 'default');
  assert.equal(byRole.prompt.data.params.block_path.value, 'semantic_generator');
  assert.equal(byRole.prompt.data.params.lyrics.value, '[verse]\nUnder neon skies\n[chorus]\nWe rise');
  assert.equal(byRole.prompt.data.params.audio_duration.value, 18);
  assert.equal(byRole.prompt.data.params.seed.value, 314159);
  assert.equal(byRole.denoise.data.params.block_path.value, 'denoise');
  assert.equal(byRole.denoise.data.params.num_inference_steps.value, 24);
  assert.equal(byRole.decode.data.params.block_path.value, 'decode');
  assert.equal(byRole.audioExport.data.params.sample_rate.value, 44100);
  assert.ok(collapsed.nodes.every((candidate) => candidate.data.uiState.disabled));
  assert.ok(collapsed.nodes.every((candidate) => candidate.hidden));
  assert.ok(refreshed.nodes.every((candidate) => !candidate.hidden));
});

test('equivalent standard Diffusers routes materialize a sealed full-pipeline graph without claiming split execution', () => {
  const body = payload();
  const rawDefinition = body.definitions[0];
  rawDefinition.pipelineClass = 'ErnieImageModularPipeline';
  rawDefinition.blocksClass = 'ErnieImageAutoBlocks';
  rawDefinition.id = 'diffusers.modular:ErnieImageModularPipeline:text2image';
  rawDefinition.integrationStatus = 'equivalent_standard_route';
  rawDefinition.graphAdapterContracts = [
    {
      schemaVersion: 1,
      id: 'diffusers.modular-adapter:ErnieImageModularPipeline:text2image:mode:equivalent_standard_route',
      source: 'mode',
      adapterId: 'equivalent_standard_route',
      upstreamWorkflowId: 'text2image',
      requiredInputs: ['prompt'],
      actionSequence: ['full_pipeline'],
      stateEdges: [],
      upstreamBlockSequence: rawDefinition.steps.map((step) => step.path),
    },
  ];
  body.taskContracts[0].definitionIds = [rawDefinition.id, body.definitions[1].id];
  const specReceipt = {
    id: 'ernie-image:equivalent-standard-text-to-image:v1',
    contentHash: 'studio-spec-v1-ab12cd34',
    executionProfileId: 'ernie-image:equivalent-standard',
  };
  rawDefinition.executionAdmissions = [
    {
      schemaVersion: 4,
      id: 'diffusers.cluster-admission:ErnieImageModularPipeline:text2image:mode:equivalent_standard_route',
      definitionId: rawDefinition.id,
      studioMode: 'text_to_image',
      bindingSources: ['artifact', 'defaultRevision', 'executionProfileId', 'mode', 'pipelineClass', 'prompt'],
      instanceInputBindings: [{ bindingSource: 'prompt', input: 'prompt' }],
      executionParameterSources: [],
      sealedBindingValues: {
        artifact: 'baidu/ERNIE-Image-Turbo',
        defaultRevision: 'a'.repeat(40),
        executionProfileId: 'ernie-image:equivalent-standard',
        mode: 'text_to_image',
        pipelineClass: 'ErnieImagePipeline',
      },
      modelDependencies: [],
      dynamicFieldActions: [],
      adapterContractId: rawDefinition.graphAdapterContracts[0].id,
      studioExecutionSpec: specReceipt,
      artifact: { repo: 'baidu/ERNIE-Image-Turbo', revision: 'a'.repeat(40) },
      status: 'admitted',
      claim: 'static_graph_contract_compatible',
      executable: false,
      publication: graphQualifiedPublication(),
      reasons: [],
    },
  ];

  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body);
  const definition = parsed.definitions[0];
  const admission = definition.executionAdmissions[0];
  const instance = clusterInstanceModule.setHuggingFaceClusterExecution(
    clusterInstanceModule.createHuggingFaceClusterInstance(definition, 'cluster-ernie-equivalent', {
      prompt: 'A brass observatory at sunrise',
    }),
    definition,
    admission.id,
  );
  const node = (key, params) => {
    const [module, action] = key.split(/\.(?=[^.]+$)/u);
    return { type: 'custom', module, action, label: action, category: 'test', params };
  };
  const input = (type) => ({ display: 'input', type });
  const output = (type) => ({ display: 'output', type });
  const registry = {
    'modules.DiffusersImage.LoadPipeline': node('modules.DiffusersImage.LoadPipeline', {
      model_id: { type: 'string', display: 'modelselect', value: { source: 'hub', value: '' } },
      pipeline_class: { type: 'string', value: '' },
      execution_profile_id: { type: 'string', value: '' },
      mode: { type: 'string', value: '' },
      revision: { type: 'string', value: '' },
      pipeline: output('pipeline'),
    }),
    'modules.DiffusersImage.Generate': node('modules.DiffusersImage.Generate', {
      pipeline: input('pipeline'),
      prompt: { type: 'string', value: '' },
      images: output('image'),
    }),
    'modules.Image.Preview': node('modules.Image.Preview', {
      image: input('image'),
      output: output('image'),
    }),
  };
  const executionSpec = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    ...specReceipt,
    modelType: definition.pipelineClass,
    mode: 'text_to_image',
    loaderModule: 'modules.DiffusersImage',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-image',
    pipelineClass: 'ErnieImagePipeline',
    defaultRepo: admission.artifact.repo,
    roles: [
      ['diffusersImagePipeline', 'modules.DiffusersImage.LoadPipeline', -520, -80],
      ['diffusersImageGenerate', 'modules.DiffusersImage.Generate', -120, -80],
      ['preview', 'modules.Image.Preview', 340, -80],
    ],
    edges: [
      ['diffusersImagePipeline', 'pipeline', 'diffusersImageGenerate', 'pipeline'],
      ['diffusersImageGenerate', 'images', 'preview', 'image'],
    ],
    bindings: [
      ['diffusersImagePipeline', 'model_id', 'artifact'],
      ['diffusersImagePipeline', 'pipeline_class', 'pipelineClass'],
      ['diffusersImagePipeline', 'execution_profile_id', 'executionProfileId'],
      ['diffusersImagePipeline', 'mode', 'mode'],
      ['diffusersImagePipeline', 'revision', 'defaultRevision'],
      ['diffusersImageGenerate', 'prompt', 'prompt'],
    ],
    autoFields: [],
    actions: [],
  };

  const collapsed = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec,
    nodesRegistry: registry,
  });
  const expanded = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: clusterInstanceModule.validateHuggingFaceClusterInstance(
      JSON.parse(JSON.stringify(instance)),
      definition,
    ),
    admission,
    executionSpec,
    nodesRegistry: registry,
    expanded: true,
  });

  assert.equal(collapsed.bindingsComplete, true);
  assert.equal(collapsed.executable, false);
  assert.equal(collapsed.nodes.length, 3);
  assert.deepEqual(
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(expanded),
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(collapsed),
  );
  const loader = collapsed.nodes.find(
    (candidate) => candidate.data.huggingFaceClusterExecutionRole === 'diffusersImagePipeline',
  );
  assert.equal(loader.data.params.pipeline_class.value, 'ErnieImagePipeline');
  assert.equal(loader.data.params.pipeline_class.disabled, true);
  assert.equal(loader.data.params.execution_profile_id.value, 'ernie-image:equivalent-standard');
  assert.equal(loader.data.params.execution_profile_id.disabled, true);
  assert.equal(loader.data.params.mode.value, 'text_to_image');
  assert.equal(loader.data.params.mode.disabled, true);
  assert.throws(
    () =>
      clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
        definition,
        instance,
        admission,
        executionSpec: { ...executionSpec, pipelineClass: definition.pipelineClass },
        nodesRegistry: registry,
      }),
    /does not match the admission receipt/u,
  );
});

test('Cluster technical bindings are provisionally complete and rebind to the selected resource candidate', () => {
  const admission = {
    executionParameterSources: [
      'attentionBackend',
      'channelsLast',
      'denoiserCache',
      'deviceMapNone',
      'layerwiseCasting',
      'pipelineQuantizedComponents',
      'quantizedComponents',
      'regionalCompile',
    ],
  };
  const form = {
    attentionBackend: '',
    device: 'cuda:0',
    guidanceScale2: 0,
    height: 256,
    numFrames: 1,
    offloadMode: 'model_cpu',
    quantizationMode: 'quanto_float8',
    resourceMode: 'auto',
    width: 256,
  };
  const provisional = clusterRuntimeModule.huggingFaceClusterExecutionParameterValues(admission, form);
  assert.deepEqual(provisional, {
    attentionBackend: 'auto',
    channelsLast: false,
    denoiserCache: 'none',
    deviceMapNone: 'none',
    layerwiseCasting: false,
    pipelineQuantizedComponents: ['transformer'],
    quantizedComponents: ['transformer'],
    regionalCompile: false,
  });
  const rebound = clusterRuntimeModule.huggingFaceClusterExecutionParameterValues(admission, form, {
    attentionBackend: '_native_flash',
    channelsLast: true,
    denoiserCache: 'first_block',
    layerwiseCasting: true,
    quantizedComponents: ['transformer', 'text_encoder'],
    regionalCompile: true,
  });
  assert.deepEqual(rebound, {
    attentionBackend: '_native_flash',
    channelsLast: true,
    denoiserCache: 'first_block',
    deviceMapNone: 'none',
    layerwiseCasting: true,
    pipelineQuantizedComponents: ['transformer', 'text_encoder'],
    quantizedComponents: ['transformer', 'text_encoder'],
    regionalCompile: true,
  });
});

test('Audio Cluster BPM binding matches the native template normalization without changing the form', () => {
  const admission = { executionParameterSources: ['bpmNormalized'] };
  for (const bpm of [96, 0, -1]) {
    const form = { bpm, device: 'cuda:0', offloadMode: 'model_cpu', quantizationMode: 'none' };
    const original = structuredClone(form);
    assert.deepEqual(clusterRuntimeModule.huggingFaceClusterExecutionParameterValues(admission, form), {
      bpmNormalized: bpm > 0 ? bpm : 0,
    });
    assert.deepEqual(form, original);
  }
});

test('Cluster customization persists before replacement and leaves the original recoverable on failure', async () => {
  const cluster = {
    id: 'recoverable-cluster',
    type: 'cluster',
    position: { x: 40, y: 60 },
    selected: true,
    data: {
      type: 'cluster',
      module: 'modiff.hugging_face_cluster',
      action: 'RecoverableCluster',
      label: 'Recoverable Cluster',
      category: 'Diffusers Blocks',
      params: {
        prompt: { label: 'Prompt', type: 'string', value: 'Keep this prompt' },
      },
      huggingFaceClusterRole: 'root',
      huggingFaceClusterInstance: {
        parameterOverrides: { prompt: 'Keep this prompt' },
      },
    },
  };
  const block = {
    id: 'recoverable-user-node',
    name: 'Recoverable Cluster — Workflow',
    version: 1,
    nodes: [
      {
        id: 'child',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'PassThrough',
          label: 'Pass Through',
          category: 'Test',
          params: {},
        },
      },
    ],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const blockNode = userBlocksModule.createUserBlockNode(block, cluster.position, cluster.id);
  flowStoreModule.useFlowStore.setState({
    nodes: [cluster],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  const context = studioStoreModule.captureWorkflowOperationContext();
  const sourceSignature = clusterCustomizationModule.clusterCustomizationSourceSignature(cluster.id);

  await assert.rejects(
    clusterCustomizationModule.commitHuggingFaceClusterCustomization(
      { instanceId: cluster.id, block, blockNode, context, sourceSignature },
      async () => {
        throw new Error('simulated User Node save failure');
      },
    ),
    /simulated User Node save failure/,
  );
  let state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].data.huggingFaceClusterRole, 'root');
  assert.equal(state.nodes[0].data.params.prompt.value, 'Keep this prompt');
  assert.equal(state.historyPast.length, 0);

  await clusterCustomizationModule.commitHuggingFaceClusterCustomization(
    { instanceId: cluster.id, block, blockNode, context, sourceSignature },
    async (definition) => definition,
  );
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0].data.type, 'block');
  assert.equal(state.nodes[0].data.userBlockId, block.id);
  assert.equal(state.historyPast.length, 1);

  state.undo();
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.nodes[0].data.huggingFaceClusterRole, 'root');
  assert.equal(state.nodes[0].data.params.prompt.value, 'Keep this prompt');

  state.redo();
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.nodes[0].data.type, 'block');
  assert.equal(state.nodes[0].data.userBlockId, block.id);
});

test('Cluster customization refuses a stale canvas or concurrently edited source graph', async () => {
  const cluster = {
    id: 'stale-cluster',
    type: 'cluster',
    position: { x: 0, y: 0 },
    data: {
      type: 'cluster',
      module: 'modiff.hugging_face_cluster',
      action: 'StaleCluster',
      label: 'Stale Cluster',
      category: 'Diffusers Blocks',
      params: { prompt: { type: 'string', value: 'Before' } },
      huggingFaceClusterRole: 'root',
      huggingFaceClusterInstance: {},
    },
  };
  const block = {
    id: 'stale-user-node',
    name: 'Stale Cluster — Workflow',
    version: 1,
    nodes: [],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const blockNode = userBlocksModule.createUserBlockNode(block, cluster.position, cluster.id);
  flowStoreModule.useFlowStore.setState({
    nodes: [cluster],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  const context = studioStoreModule.captureWorkflowOperationContext();
  const sourceSignature = clusterCustomizationModule.clusterCustomizationSourceSignature(cluster.id);

  await assert.rejects(
    clusterCustomizationModule.commitHuggingFaceClusterCustomization(
      { instanceId: cluster.id, block, blockNode, context, sourceSignature },
      async (definition) => {
        flowStoreModule.useFlowStore.getState().setParam(cluster.id, 'prompt', 'Changed while saving');
        return definition;
      },
    ),
    /Cluster changed while its User Node definition was saving/,
  );
  const state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.nodes[0].data.huggingFaceClusterRole, 'root');
  assert.equal(state.nodes[0].data.params.prompt.value, 'Changed while saving');
});

test('all User Node save choices isolate workflow instances and cancel across a workflow switch', async () => {
  const definition = {
    id: 'three-choice-user-node',
    name: 'Three choice node',
    version: 1,
    nodes: [
      {
        id: 'child',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Prompt',
          label: 'Prompt',
          category: 'Test',
          params: { prompt: { label: 'Prompt', type: 'string', value: 'Original' } },
        },
      },
    ],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const firstNode = userBlocksModule.createUserBlockNode(definition, { x: 10, y: 20 }, 'first-instance');
  const secondNode = userBlocksModule.createUserBlockNode(definition, { x: 30, y: 40 }, 'second-instance');
  studioStoreModule.useStudioStore.setState((state) => ({
    workflowTabs: [],
    activeWorkflowTabId: null,
    workflowCanvasEpoch: state.workflowCanvasEpoch + 1,
    workflowFormEpoch: state.workflowFormEpoch + 1,
  }));
  flowStoreModule.useFlowStore.setState({
    nodes: [firstNode],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  const studio = studioStoreModule.useStudioStore.getState();
  studio.ensureWorkflowTabs();
  const firstWorkflowId = studioStoreModule.useStudioStore.getState().activeWorkflowTabId;
  studioStoreModule.useStudioStore.getState().saveActiveWorkflowTab(true);
  const secondWorkflowId = studioStoreModule.useStudioStore.getState().createWorkflowTab('Unchanged workflow');
  flowStoreModule.useFlowStore.setState({ nodes: [secondNode], edges: [] });
  studioStoreModule.useStudioStore.getState().saveActiveWorkflowTab(true);
  const secondBefore = structuredClone(
    studioStoreModule.useStudioStore.getState().workflowTabs.find((tab) => tab.id === secondWorkflowId).snapshot,
  );
  studioStoreModule.useStudioStore.getState().switchWorkflowTab(firstWorkflowId);

  const updated = await userBlockPersistenceModule.persistUserBlockInstanceChoice(
    {
      instanceId: firstNode.id,
      choice: 'update',
      workflowTitle: 'Workflow 1',
    },
    async (candidate) => ({ ...candidate, name: 'Updated reusable definition', updatedAt: 2 }),
  );
  assert.equal(updated.id, definition.id);
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === firstNode.id).data.label,
    'Updated reusable definition',
  );
  assert.deepEqual(
    studioStoreModule.useStudioStore.getState().workflowTabs.find((tab) => tab.id === secondWorkflowId).snapshot,
    secondBefore,
  );

  const copied = await userBlockPersistenceModule.persistUserBlockInstanceChoice(
    {
      instanceId: firstNode.id,
      choice: 'new',
      workflowTitle: 'Workflow 1',
    },
    async (candidate) => candidate,
  );
  assert.notEqual(copied.id, definition.id);
  assert.match(copied.name, /— Workflow 1$/u);
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === firstNode.id).data.userBlockId,
    copied.id,
  );

  let workflowOnlySaveCalls = 0;
  const workflowOnly = await userBlockPersistenceModule.persistUserBlockInstanceChoice(
    {
      instanceId: firstNode.id,
      choice: 'workflow',
      workflowTitle: 'Workflow 1',
    },
    async (candidate) => {
      workflowOnlySaveCalls += 1;
      return candidate;
    },
  );
  assert.equal(workflowOnlySaveCalls, 0);
  assert.equal(workflowOnly.id, copied.id);

  await assert.rejects(
    userBlockPersistenceModule.persistUserBlockInstanceChoice(
      {
        instanceId: firstNode.id,
        choice: 'update',
        workflowTitle: 'Workflow 1',
      },
      async (candidate) => {
        studioStoreModule.useStudioStore.getState().switchWorkflowTab(secondWorkflowId);
        return candidate;
      },
    ),
    { name: 'WorkflowOperationCancelledError' },
  );
  assert.equal(studioStoreModule.useStudioStore.getState().activeWorkflowTabId, secondWorkflowId);
  assert.deepEqual(
    studioStoreModule.useStudioStore.getState().workflowTabs.find((tab) => tab.id === secondWorkflowId).snapshot,
    secondBefore,
  );
  assert.equal(flowStoreModule.useFlowStore.getState().nodes[0].id, secondNode.id);
});

test('catalog projections use Block terminology and retain exact family definitions', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const sections = libraryCatalogModule.buildHuggingFaceCatalogSections(parsed);
  assert.deepEqual(
    sections.map((section) => section.label),
    ['Diffusers Blocks', 'Transformers Blocks', 'Modular Diffusers implementation', 'Diffusers components'],
  );
  assert.deepEqual(
    sections.map((section) => section.entries.length),
    [2, 0, 8, 2],
  );
  assert.ok(sections[0].entries.every((entry) => entry.readiness === 'catalog_only'));
  assert.ok(sections[2].entries.every((entry) => entry.readiness === 'composable'));
  assert.ok(sections[2].entries.every((entry) => entry.insertable));
  assert.ok(sections[3].entries.every((entry) => entry.readiness === 'catalog_only'));
  assert.ok(sections[0].entries.every((entry) => entry.insertable));
  assert.ok(sections[0].entries.every((entry) => !/\bpipeline\b/i.test(entry.label)));
  assert.notDeepEqual(sections[0].entries[0].definitionIds, sections[0].entries[1].definitionIds);
  assert.ok(sections[2].entries.every((entry) => entry.id.startsWith('modular-block:diffusers.modular-block:')));
  assert.ok(sections[2].entries.every((entry) => entry.modularBlockPlacement));
  assert.ok(sections[2].entries.every((entry) => entry.modularBlockContexts?.length));
  assert.ok(sections.every((section) => section.entries.every((entry) => entry.groupPath.length > 0)));

  const qwenResults = libraryCatalogModule.filterHuggingFaceCatalogSections(sections, 'qwen');
  const qwenClusters = qwenResults.find((section) => section.id === 'diffusers_cluster_nodes');
  assert.equal(qwenClusters.entries.length, 1);
  assert.match(qwenClusters.entries[0].label, /Qwen Image/);
});

test('Qwen search does not return Anima workflows just because they use Qwen components', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const qwen = parsed.definitions.find((definition) => definition.pipelineClass.includes('Qwen'));
  const anima = {
    ...qwen,
    id: 'diffusers:AnimaPipeline:text_to_image',
    label: 'Anima — Text To Image',
    pipelineClass: 'AnimaPipeline',
    blocksClass: null,
    description: 'Generate images with Anima using Qwen states.',
    components: [
      {
        name: 'text_encoder',
        type: 'transformers.Qwen3Model',
        creationMethod: 'from_pretrained',
        reuseKey: ['Qwen/Qwen3-0.6B'],
      },
    ],
    steps: [{ path: 'encode', className: 'QwenTextEncoderStep', kind: 'step', description: 'Encode text with Qwen' }],
  };
  const sections = libraryCatalogModule.buildHuggingFaceCatalogSections({ ...parsed, definitions: [qwen, anima] });
  const results = libraryCatalogModule.filterHuggingFaceCatalogSections(sections, 'qwen');
  assert.deepEqual(
    results.find(({ id }) => id === 'diffusers_cluster_nodes').entries.map(({ id }) => id),
    [qwen.id],
  );
  assert.ok(
    results.find(({ id }) => id === 'diffusers_component_nodes').entries.some(({ label }) => label.includes('Qwen3')),
  );
  const animaResults = libraryCatalogModule.filterHuggingFaceCatalogSections(sections, 'anima');
  assert.deepEqual(
    animaResults.find(({ id }) => id === 'diffusers_cluster_nodes').entries.map(({ id }) => id),
    [anima.id],
  );
});

test('selected and unpruned Anima blocks do not match Qwen in descriptions, sockets or dependencies', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const source = parsed.definitions[0];
  const block = {
    ...parsed.blockDefinitions[0],
    id: 'diffusers.modular-block:AnimaTextEncoderStep',
    className: 'AnimaTextEncoderStep',
    description: 'Encodes Anima prompts into Qwen states and T5 token ids.',
    inputs: [{ name: 'qwen_prompt_embeds', type: 'QwenStates', description: 'Qwen inputs' }],
    components: [{ name: 'text_encoder', type: 'Qwen3Model', description: 'Qwen model' }],
  };
  const placement = {
    ...source.blockPlacements[0],
    blockDefinitionId: block.id,
    path: ['text_encoder'],
    legacyPath: 'text_encoder',
  };
  const anima = {
    ...source,
    id: 'anima:text2image',
    label: 'Anima — Text To Image',
    pipelineClass: 'AnimaModularPipeline',
    blocksClass: 'AnimaAutoBlocks',
    blockPlacements: [placement],
  };
  const library = { ...parsed, definitions: [anima], blockDefinitions: [block] };
  const snapshot = {
    diffusersRevision: library.diffusersRevision,
    blockDefinitions: [block],
    pipelines: [{ pipelineClass: anima.pipelineClass, placements: [placement] }],
  };
  for (const conditionalSnapshot of [undefined, snapshot]) {
    const sections = libraryCatalogModule.buildHuggingFaceCatalogSections(library, conditionalSnapshot);
    const matches = (query) =>
      libraryCatalogModule
        .filterHuggingFaceCatalogSections(sections, query)
        .find(({ id }) => id === 'modular_diffusers_block_nodes')?.entries ?? [];
    assert.equal(matches('qwen').length, 0);
    assert.equal(matches('anima encoder').length, 1);
    assert.equal(matches('AnimaTextEncoderStep').length, 1);
  }
});

test('catalog projections preserve a reviewed human family label for standard Diffusers composites', () => {
  const body = payloadWithStandardDiffusersComposite();
  const composite = body.definitions.find((definition) => definition.definitionKind === 'studio_execution_composite');
  composite.label = 'Flux 1 Dev — Text To Image';
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body);
  const entry = libraryCatalogModule
    .buildHuggingFaceCatalogSections(parsed)
    .find((section) => section.id === 'diffusers_cluster_nodes')
    .entries.find((candidate) => candidate.id === composite.id);
  const root = clusterGraphModule.createHuggingFaceClusterNode(
    parsed.definitions.find((definition) => definition.id === composite.id),
    'standard-composite-human-label',
    { x: 0, y: 0 },
  );

  assert.equal(entry.label, 'Flux 1 Dev — Text To Image');
  assert.equal(root.data.label, 'Flux 1 Dev — Text To Image');
});

test('reviewed Modular composition recipes preserve exact origin pins and bounded block paths', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const definition = parsed.definitions.find((candidate) => candidate.pipelineClass === 'FluxModularPipeline');
  const block = {
    id: 'reviewed-composition-user-node',
    name: 'Reviewed composition',
    version: 1,
    nodes: [],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 1,
    origin: {
      schemaVersion: 1,
      kind: 'hugging_face_cluster_fork',
      provider: 'diffusers',
      definitionId: definition.id,
      libraryRevision: definition.libraryRevision,
      contentHash: definition.contentHash,
      pipelineClass: definition.pipelineClass,
      workflowId: definition.workflowId,
      rootBlockDefinitionId: definition.rootBlockDefinitionId,
      blockContractHash: definition.blockContractHash,
      compositionKind: 'modiff_graph_snapshot',
      importedAt: 1,
    },
  };
  const source = modularCompositionModule.reviewedModularCompositionSource(block, parsed);
  assert.ok(source);
  const path = source.definition.blockPlacements.at(-1).path;
  const recipe = modularCompositionModule.duplicateReviewedModularBlockRecipe(source, path);
  assert.deepEqual(
    {
      diffusersRevision: recipe.diffusersRevision,
      pipelineClass: recipe.pipelineClass,
      workflowId: recipe.workflowId,
      definitionId: recipe.definitionId,
      blockContractHash: recipe.blockContractHash,
    },
    {
      diffusersRevision: definition.libraryRevision,
      pipelineClass: definition.pipelineClass,
      workflowId: definition.workflowId,
      definitionId: definition.id,
      blockContractHash: definition.blockContractHash,
    },
  );
  assert.deepEqual(recipe.operations[0].path, path);
  assert.equal(recipe.operations[0].kind, 'duplicate');
  assert.match(recipe.operations[0].name, /_copy$/u);
});

test('Transformers Blocks insert and materialize their exact generic task graph', () => {
  const { body, transformerDefinition: rawDefinition, receipt } = payloadWithTransformersTextCluster();
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body);
  const definition = parsed.definitions.find((candidate) => candidate.id === rawDefinition.id);
  const admission = definition.executionAdmissions[0];
  const transformersSection = libraryCatalogModule
    .buildHuggingFaceCatalogSections(parsed)
    .find((section) => section.id === 'transformers_cluster_nodes');
  assert.equal(transformersSection.entries.length, 1);
  assert.equal(transformersSection.entries[0].label, 'SmolLM2 135M Instruct — Text Generation');
  assert.equal(transformersSection.entries[0].readiness, 'graph_qualified');
  assert.equal(transformersSection.entries[0].readinessLabel, 'Graph qualified');
  assert.equal(transformersSection.entries[0].insertable, true);

  const root = clusterGraphModule.createHuggingFaceClusterNode(
    definition,
    'transformers-text-cluster',
    { x: 20, y: 40 },
    { prompt: 'Explain why the sky appears blue.', max_new_tokens: 64 },
    admission.id,
    { device: 'cpu', quantizationMode: 'none' },
  );
  assert.equal(root.data.category, 'Transformers Cluster Nodes', 'Legacy serialized category stays unchanged.');
  assert.equal(root.data.params.prompt.value, 'Explain why the sky appears blue.');
  const typedTokenCount = clusterInstanceModule.setHuggingFaceClusterParameter(
    root.data.huggingFaceClusterInstance,
    definition,
    'max_new_tokens',
    '32',
  );
  assert.equal(typedTokenCount.parameterOverrides.max_new_tokens, 32);
  assert.throws(
    () =>
      clusterInstanceModule.setHuggingFaceClusterParameter(
        root.data.huggingFaceClusterInstance,
        definition,
        'max_new_tokens',
        'not-a-number',
      ),
    /must be a finite integer/,
  );
  const expanded = clusterGraphModule.expandHuggingFaceClusterInstance(
    { nodes: [root], edges: [] },
    root.id,
    definition,
  );
  assert.equal(expanded.nodes.filter((node) => node.data.huggingFaceClusterInstanceId === root.id).length, 0);

  const node = (module, action, params) => ({
    type: 'custom',
    module,
    action,
    label: action,
    category: 'Transformers Nodes',
    params,
  });
  const input = (type) => ({ display: 'input', type });
  const output = (type) => ({ display: 'output', type });
  const registry = {
    'modules.HuggingFaceTransformers.LoadTextGenerationModel': node(
      'modules.HuggingFaceTransformers',
      'LoadTextGenerationModel',
      {
        model_id: { type: 'string', display: 'modelselect', value: { source: 'hub', value: '' } },
        revision: { type: 'string', value: '' },
        dtype: { type: 'string', value: 'float32' },
        device: { type: 'string', value: 'cpu' },
        quantization_mode: { type: 'string', value: 'none' },
        model: output('model'),
      },
    ),
    'modules.HuggingFaceTransformers.GenerateText': node('modules.HuggingFaceTransformers', 'GenerateText', {
      model: input('model'),
      prompt: { type: 'string', value: '' },
      use_chat_template: { type: 'boolean', value: true },
      max_new_tokens: { type: 'int', value: 256 },
      min_new_tokens: { type: 'int', value: 0 },
      do_sample: { type: 'boolean', value: false },
      temperature: { type: 'float', value: 1 },
      top_p: { type: 'float', value: 1 },
      top_k: { type: 'int', value: 50 },
      num_beams: { type: 'int', value: 1 },
      repetition_penalty: { type: 'float', value: 1 },
      result: output('object'),
    }),
    'modules.Primitive.DataViewer': node('modules.Primitive', 'DataViewer', {
      value: input('object'),
      output: output('object'),
    }),
  };
  const executionSpec = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    ...receipt,
    modelType: definition.pipelineClass,
    mode: 'text_generation',
    loaderModule: 'modules.HuggingFaceTransformers',
    loaderAction: 'LoadTextGenerationModel',
    executionPath: 'direct-huggingface-transformers-text',
    pipelineClass: definition.blocksClass,
    defaultRepo: admission.artifact.repo,
    roles: [
      ['transformersTextModel', 'modules.HuggingFaceTransformers.LoadTextGenerationModel', -720, -80],
      ['transformersTextGenerate', 'modules.HuggingFaceTransformers.GenerateText', -240, -80],
      ['transformersTextPreview', 'modules.Primitive.DataViewer', 240, -80],
    ],
    edges: [
      ['transformersTextModel', 'model', 'transformersTextGenerate', 'model'],
      ['transformersTextGenerate', 'result', 'transformersTextPreview', 'value'],
    ],
    bindings: [
      ['transformersTextModel', 'model_id', 'artifact'],
      ['transformersTextModel', 'revision', 'defaultRevision'],
      ['transformersTextModel', 'dtype', 'dtype'],
      ['transformersTextModel', 'device', 'device'],
      ['transformersTextModel', 'quantization_mode', 'quantizationMode'],
      ['transformersTextGenerate', 'prompt', 'prompt'],
      ['transformersTextGenerate', 'use_chat_template', 'useChatTemplate'],
      ['transformersTextGenerate', 'max_new_tokens', 'maxNewTokens'],
      ['transformersTextGenerate', 'min_new_tokens', 'minNewTokens'],
      ['transformersTextGenerate', 'do_sample', 'doSample'],
      ['transformersTextGenerate', 'temperature', 'temperature'],
      ['transformersTextGenerate', 'top_p', 'topP'],
      ['transformersTextGenerate', 'top_k', 'topK'],
      ['transformersTextGenerate', 'num_beams', 'numBeams'],
      ['transformersTextGenerate', 'repetition_penalty', 'repetitionPenalty'],
    ],
    autoFields: [],
    actions: [],
  };
  const skeleton = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: root.data.huggingFaceClusterInstance,
    admission,
    executionSpec,
    nodesRegistry: registry,
  });
  assert.equal(skeleton.bindingsComplete, true);
  assert.equal(skeleton.nodes.length, 3);
  assert.equal(skeleton.edges.length, 2);
  const visibleGraph = clusterGraphModule.attachHuggingFaceClusterExecutionSkeleton(expanded, root.id, definition, {
    ...skeleton,
    nodes: skeleton.nodes.map((candidate) => ({ ...candidate, hidden: false })),
  });
  const visibleChildren = visibleGraph.nodes.filter(
    (candidate) => candidate.data.huggingFaceClusterInstanceId === root.id,
  );
  assert.equal(visibleChildren.length, 3);
  assert.ok(visibleChildren.every((candidate) => candidate.type === 'custom'));
  assert.ok(visibleChildren.every((candidate) => candidate.data.category === 'Transformers Nodes'));
  assert.equal(visibleGraph.edges.length, 2);
  assert.ok(visibleGraph.edges.every((edge) => edge.hidden === false));
  assert.equal(
    skeleton.nodes.find((candidate) => candidate.data.huggingFaceClusterExecutionRole === 'transformersTextModel').data
      .params.revision.value,
    admission.artifact.revision,
  );
  assert.equal(
    skeleton.nodes.find((candidate) => candidate.data.huggingFaceClusterExecutionRole === 'transformersTextGenerate')
      .data.params.max_new_tokens.value,
    64,
  );
  const refreshed = clusterMaterializerModule.materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance: clusterInstanceModule.validateHuggingFaceClusterInstance(
      JSON.parse(JSON.stringify(root.data.huggingFaceClusterInstance)),
      definition,
    ),
    admission,
    executionSpec,
    nodesRegistry: registry,
    expanded: true,
  });
  assert.deepEqual(
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(refreshed),
    clusterMaterializerModule.canonicalHuggingFaceClusterExecutionSnapshot(skeleton),
  );
});

test('Cluster Node instances persist isolated parameters and presentation state', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const flux = parsed.definitions.find((definition) => definition.pipelineClass === 'FluxModularPipeline');
  const qwen = parsed.definitions.find((definition) => definition.pipelineClass === 'QwenImageModularPipeline');
  const originalFlux = clusterInstanceModule.createHuggingFaceClusterInstance(flux, 'cluster-flux-1');
  const originalQwen = clusterInstanceModule.createHuggingFaceClusterInstance(qwen, 'cluster-qwen-1');
  const editedFlux = clusterInstanceModule.setHuggingFaceClusterParameter(
    originalFlux,
    flux,
    'prompt',
    'A copper observatory',
  );
  const expandedFlux = clusterInstanceModule.setHuggingFaceClusterPresentation(editedFlux, flux, {
    expanded: true,
    expandedPaths: ['denoise.denoise'],
  });

  const restored = clusterInstanceModule.validateHuggingFaceClusterInstance(
    JSON.parse(JSON.stringify(expandedFlux)),
    flux,
  );
  assert.deepEqual(restored.presentation.executionLayout, {});
  const projection = clusterInstanceModule.huggingFaceClusterParameterProjection(restored, flux);
  assert.equal(projection.find((field) => field.name === 'prompt').value, 'A copper observatory');
  assert.equal(originalQwen.parameterOverrides.prompt, undefined);
  assert.deepEqual(
    clusterInstanceModule.huggingFaceClusterSemanticSnapshot(editedFlux, flux),
    clusterInstanceModule.huggingFaceClusterSemanticSnapshot(expandedFlux, flux),
  );

  const hierarchy = clusterInstanceModule.huggingFaceClusterHierarchy(restored, flux);
  const denoiseContainer = hierarchy.find((node) => node.path === 'denoise');
  const denoiseInput = denoiseContainer.children.find((node) => node.path === 'denoise.input');
  const denoise = denoiseContainer.children.find((node) => node.path === 'denoise.denoise');
  assert.equal(denoiseContainer.implicit, true);
  assert.equal(denoiseContainer.className, null);
  assert.equal(denoiseInput.legacyPath, 'denoise.input');
  assert.deepEqual(denoiseInput.pathSegments, ['denoise.input']);
  assert.equal(denoise.implicit, false);
  assert.equal(denoise.children[0].path, 'denoise.denoise/denoiser');
  assert.deepEqual(denoise.children[0].pathSegments, ['denoise.denoise', 'denoiser']);
  assert.equal(
    denoise.children[0].semanticId,
    clusterInstanceModule.huggingFaceClusterChildSemanticId('cluster-flux-1', 'denoise.denoise/denoiser'),
  );
  assert.throws(
    () => clusterInstanceModule.setHuggingFaceClusterParameter(restored, flux, 'not_a_field', 1),
    /unknown parameter/,
  );
  assert.throws(
    () =>
      clusterInstanceModule.validateHuggingFaceClusterInstance(
        { ...restored, definition: { ...restored.definition, contentHash: `sha256:${'9'.repeat(64)}` } },
        flux,
      ),
    /content hash/,
  );
});

test('Cluster execution selections migrate, round-trip, switch modes, and isolate tunable parameters', () => {
  const body = payload();
  const flux = body.definitions.find((definition) => definition.pipelineClass === 'FluxModularPipeline');
  const primaryAdapter = flux.graphAdapterContracts[0];
  const fastAdapter = {
    ...structuredClone(primaryAdapter),
    id: `diffusers.modular-adapter:${flux.pipelineClass}:${flux.workflowId}:mode:text_to_image_fast`,
    adapterId: 'text_to_image_fast',
  };
  flux.graphAdapterContracts.push(fastAdapter);
  const admission = (adapter, mode, specId, hashMarker) => ({
    schemaVersion: 4,
    id: `diffusers.cluster-admission:${flux.pipelineClass}:${flux.workflowId}:mode:${adapter.adapterId}`,
    definitionId: flux.id,
    studioMode: mode,
    bindingSources: ['artifact', 'dtype', 'false', 'guidanceScale', 'pipelineClass', 'prompt', 'seed'],
    instanceInputBindings: [{ bindingSource: 'prompt', input: 'prompt' }],
    executionParameterSources: ['dtype', 'guidanceScale', 'seed'],
    sealedBindingValues: {
      artifact: 'black-forest-labs/FLUX.1-dev',
      false: false,
      pipelineClass: flux.pipelineClass,
    },
    modelDependencies: [],
    dynamicFieldActions: [
      { role: 'models', field: 'model_type', event: 'onChange', valueSource: 'pipelineClass' },
      { role: 'prompt', field: 'text_encoders', event: 'onSignal', valueSource: 'pipelineClass' },
      { role: 'denoise', field: 'unet', event: 'onSignal', valueSource: 'pipelineClass' },
      { role: 'decode', field: 'vae', event: 'onSignal', valueSource: 'pipelineClass' },
    ],
    adapterContractId: adapter.id,
    studioExecutionSpec: {
      id: specId,
      contentHash: `studio-spec-v1-${hashMarker.repeat(8)}`,
      executionProfileId: `${mode}:modular`,
    },
    artifact: { repo: 'black-forest-labs/FLUX.1-dev', revision: hashMarker.repeat(40) },
    status: 'admitted',
    claim: 'static_graph_contract_compatible',
    executable: false,
    publication: graphQualifiedPublication(),
    reasons: [],
  });
  flux.executionAdmissions = [
    admission(primaryAdapter, 'text_to_image', 'flux:text-to-image:v1', 'a'),
    admission(fastAdapter, 'text_to_image_fast', 'flux:text-to-image-fast:v1', 'b'),
  ];

  const definition = libraryModule
    .parseHuggingFaceNodeLibrary(body)
    .definitions.find((candidate) => candidate.id === flux.id);
  const created = clusterInstanceModule.createHuggingFaceClusterInstance(definition, 'cluster-execution-a');
  const { execution: _legacyExecution, ...legacyFields } = created;
  const migrated = clusterInstanceModule.validateHuggingFaceClusterInstance(
    { ...legacyFields, schemaVersion: 1 },
    definition,
  );
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.execution, null);

  const selected = clusterInstanceModule.setHuggingFaceClusterExecution(
    migrated,
    definition,
    definition.executionAdmissions[0].id,
  );
  const withSeed = clusterInstanceModule.setHuggingFaceClusterExecutionParameter(selected, definition, 'seed', 123456);
  const withGuidance = clusterInstanceModule.setHuggingFaceClusterExecutionParameter(
    withSeed,
    definition,
    'guidanceScale',
    4.25,
  );
  const configured = clusterInstanceModule.setHuggingFaceClusterExecutionParameter(
    withGuidance,
    definition,
    'dtype',
    'bfloat16',
  );
  const restored = clusterInstanceModule.validateHuggingFaceClusterInstance(
    JSON.parse(JSON.stringify(configured)),
    definition,
  );
  assert.deepEqual(restored.execution.parameterOverrides, {
    seed: 123456,
    guidanceScale: 4.25,
    dtype: 'bfloat16',
  });
  assert.deepEqual(restored.execution.explicitParameterSources, ['dtype', 'guidanceScale', 'seed']);
  assert.deepEqual(
    clusterInstanceModule.huggingFaceClusterSemanticSnapshot(restored, definition).execution,
    restored.execution,
  );
  const executionFingerprint = clusterInstanceModule.huggingFaceClusterExecutionFingerprint(restored, definition);
  const presented = clusterInstanceModule.setHuggingFaceClusterPresentation(restored, definition, {
    expanded: true,
    expandedPaths: [],
  });
  assert.equal(
    clusterInstanceModule.huggingFaceClusterExecutionFingerprint(presented, definition),
    executionFingerprint,
  );

  const isolated = clusterInstanceModule.setHuggingFaceClusterExecution(
    clusterInstanceModule.createHuggingFaceClusterInstance(definition, 'cluster-execution-b'),
    definition,
    definition.executionAdmissions[0].id,
  );
  const independentlySeeded = clusterInstanceModule.setHuggingFaceClusterExecutionParameter(
    isolated,
    definition,
    'seed',
    999,
  );
  assert.equal(restored.execution.parameterOverrides.seed, 123456);
  assert.equal(independentlySeeded.execution.parameterOverrides.seed, 999);
  assert.deepEqual(independentlySeeded.execution.explicitParameterSources, ['seed']);
  assert.notEqual(
    clusterInstanceModule.huggingFaceClusterExecutionFingerprint(independentlySeeded, definition),
    executionFingerprint,
  );

  const switched = clusterInstanceModule.setHuggingFaceClusterExecution(
    restored,
    definition,
    definition.executionAdmissions[1].id,
  );
  assert.equal(switched.execution.admissionId, definition.executionAdmissions[1].id);
  assert.deepEqual(switched.execution.parameterOverrides, {});
  assert.deepEqual(switched.execution.explicitParameterSources, []);
  assert.notEqual(
    clusterInstanceModule.huggingFaceClusterExecutionFingerprint(switched, definition),
    executionFingerprint,
  );
  assert.throws(
    () => clusterInstanceModule.setHuggingFaceClusterExecutionParameter(restored, definition, 'artifact', 'evil/repo'),
    /unknown or sealed execution parameter/,
  );
  assert.throws(
    () =>
      clusterInstanceModule.validateHuggingFaceClusterInstance(
        {
          ...restored,
          execution: { ...restored.execution, parameterOverrides: { artifact: 'evil/repo' } },
        },
        definition,
      ),
    /unknown or sealed binding source/,
  );

  const cleared = clusterInstanceModule.setHuggingFaceClusterExecutionParameter(
    restored,
    definition,
    'guidanceScale',
    undefined,
  );
  assert.equal(Object.hasOwn(cleared.execution.parameterOverrides, 'guidanceScale'), false);
  assert.deepEqual(cleared.execution.explicitParameterSources, ['dtype', 'seed']);

  const legacyExecutionReceipt = structuredClone(restored);
  delete legacyExecutionReceipt.execution.explicitParameterSources;
  const migratedLegacyExecution = clusterInstanceModule.validateHuggingFaceClusterInstance(
    legacyExecutionReceipt,
    definition,
  );
  assert.deepEqual(migratedLegacyExecution.execution.explicitParameterSources, ['seed', 'guidanceScale', 'dtype']);
});

test('Cluster expansion is an ordinary graph frame and never materializes nested hierarchy cards', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const flux = parsed.definitions.find((definition) => definition.pipelineClass === 'FluxModularPipeline');
  const qwen = parsed.definitions.find((definition) => definition.pipelineClass === 'QwenImageModularPipeline');
  const createdFluxRoot = clusterGraphModule.createHuggingFaceClusterNode(flux, 'cluster-flux-graph', {
    x: 20,
    y: 30,
  });
  const fluxRoot = {
    ...createdFluxRoot,
    width: 612,
    height: 740,
    data: {
      ...createdFluxRoot.data,
      uiState: {
        ...createdFluxRoot.data.uiState,
        clusterCollapsedWidth: 612,
        clusterCollapsedHeight: 740,
      },
    },
  };
  const qwenRoot = clusterGraphModule.createHuggingFaceClusterNode(qwen, 'cluster-qwen-graph', { x: 500, y: 30 });
  const runtimeNode = {
    id: 'runtime-node',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Echo',
      label: 'Runtime node',
      category: 'Test',
      params: { value: { type: 'string', value: 'unchanged' } },
    },
  };
  const initial = { nodes: [runtimeNode, fluxRoot, qwenRoot], edges: [] };
  const beforeExport = flowGraphExportModule.buildApiGraphExport({
    ...initial,
    sid: 'test-session',
    setParam: () => {},
  });
  const expanded = clusterGraphModule.expandHuggingFaceClusterInstance(initial, fluxRoot.id, flux);
  const children = expanded.nodes.filter((node) => node.data.huggingFaceClusterInstanceId === fluxRoot.id);

  assert.equal(children.length, 0);
  assert.equal(
    expanded.nodes.some((node) => node.data.huggingFaceClusterRole === 'block'),
    false,
  );
  assert.deepEqual(
    flowGraphExportModule.buildApiGraphExport({
      ...expanded,
      sid: 'test-session',
      setParam: () => {},
    }),
    beforeExport,
  );

  const edited = clusterGraphModule.setHuggingFaceClusterGraphParameter(
    expanded,
    fluxRoot.id,
    flux,
    'prompt',
    'A city inside a prism',
  );
  const editedFluxRoot = edited.nodes.find((node) => node.id === fluxRoot.id);
  const untouchedQwenRoot = edited.nodes.find((node) => node.id === qwenRoot.id);
  assert.equal(editedFluxRoot.data.params.prompt.value, 'A city inside a prism');
  assert.equal(editedFluxRoot.data.huggingFaceClusterInstance.parameterOverrides.prompt, 'A city inside a prism');
  assert.equal(untouchedQwenRoot.data.huggingFaceClusterInstance.parameterOverrides.prompt, undefined);

  const collapsed = clusterGraphModule.collapseHuggingFaceClusterInstance(edited, fluxRoot.id, flux);
  const collapsedFluxRoot = collapsed.nodes.find((node) => node.id === fluxRoot.id);
  assert.equal(collapsedFluxRoot.width, 612);
  assert.equal(collapsedFluxRoot.height, 740);
  assert.equal(collapsedFluxRoot.data.uiState.clusterCollapsedWidth, 612);
  assert.equal(collapsedFluxRoot.data.uiState.clusterCollapsedHeight, 740);
  assert.equal(
    collapsed.nodes.some((node) => node.data.huggingFaceClusterInstanceId === fluxRoot.id),
    false,
  );
  assert.equal(
    collapsed.nodes.find((node) => node.id === fluxRoot.id).data.params.prompt.value,
    'A city inside a prism',
  );
  assert.deepEqual(
    flowGraphExportModule.buildApiGraphExport({
      ...collapsed,
      sid: 'test-session',
      setParam: () => {},
    }),
    beforeExport,
  );
});

test('compiler preserves exact state order and loop boundaries without making an execution claim', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const flux = parsed.definitions.find((definition) => definition.pipelineClass === 'FluxModularPipeline');
  const plan = clusterCompilerModule.compileHuggingFaceClusterStructuralPlan(parsed, flux);

  assert.equal(plan.executionClaim, 'structural_plan_only');
  assert.equal(plan.executable, false);
  assert.equal(plan.structurallyClosed, true);
  assert.equal(plan.fullyRoleAdapted, false);
  assert.equal(plan.nodes.length, 4);
  assert.equal(plan.diagnostics.length, 0);
  assert.equal(plan.nodes.find((node) => node.path === 'denoise.input').parentPath, null);
  assert.equal(plan.nodes.find((node) => node.path === 'denoise.denoise').role, 'loop_container');
  assert.equal(plan.nodes.find((node) => node.path === 'denoise.denoise/denoiser').parentPath, 'denoise.denoise');
  assert.ok(
    plan.edges.some(
      (edge) =>
        edge.kind === 'loop_feedback' &&
        edge.source.includes('denoise.denoise%2Fdenoiser') &&
        edge.target.includes('denoise.denoise%2Fdenoiser'),
    ),
  );
  assert.ok(plan.unresolvedAdapterBlockDefinitionIds.length > 0);
  assert.equal(plan.reviewedGraphAdapterContracts.length, 1);
  assert.equal(plan.reviewedGraphAdapterContracts[0].adapterId, 'text_to_image');
});

test('compiler attaches backend-declared reusable roles without client model-family inference', () => {
  const body = payload();
  const flux = body.definitions.find((definition) => definition.pipelineClass === 'FluxModularPipeline');
  body.blockRoleAdapters = [
    blockRoleAdapter(flux.rootBlockDefinitionId, 'workflow'),
    ...flux.blockPlacements.map((placement, index) =>
      blockRoleAdapter(placement.blockDefinitionId, index === 0 ? 'text_encoder' : 'denoise'),
    ),
  ];
  const loopPlacement = flux.blockPlacements.find((placement) => placement.path[0] === 'denoise.denoise');
  const loopBlock = body.blockDefinitions.find((block) => block.id === loopPlacement.blockDefinitionId);
  body.containerStateAdapters = [containerStateAdapter(loopBlock)];
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(body);
  const definition = parsed.definitions.find((item) => item.id === flux.id);
  const plan = clusterCompilerModule.compileHuggingFaceClusterStructuralPlan(parsed, definition);

  assert.equal(plan.structurallyClosed, true);
  assert.equal(plan.fullyRoleAdapted, true);
  assert.deepEqual(plan.unresolvedAdapterBlockDefinitionIds, []);
  assert.equal(plan.nodes.find((node) => node.path === 'text_encoder').adapter.role, 'text_encoder');
  assert.ok(
    plan.nodes.filter((node) => node.path.startsWith('denoise')).every((node) => node.adapter?.role === 'denoise'),
  );
  assert.equal(
    plan.nodes.find((node) => node.path === 'denoise.denoise').containerStateAdapter.publishedState[0],
    'latent_chunks',
  );
  assert.equal(plan.reviewedContainerStateAdapters.length, 1);

  const forged = structuredClone(body);
  forged.blockRoleAdapters[0].role = 'invented';
  assert.throws(() => libraryModule.parseHuggingFaceNodeLibrary(forged), /Invalid Hugging Face node-library contract/);

  const forgedContainer = structuredClone(body);
  forgedContainer.containerStateAdapters[0].publishedState = ['not_initialized'];
  assert.throws(
    () => libraryModule.parseHuggingFaceNodeLibrary(forgedContainer),
    /Invalid Hugging Face node-library contract/,
  );
});

test('compiler reports undeclared leaf state and refuses catalog drift', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const flux = parsed.definitions.find((definition) => definition.pipelineClass === 'FluxModularPipeline');
  const changedLibrary = {
    ...parsed,
    blockDefinitions: parsed.blockDefinitions.map((block) =>
      block.id === flux.blockPlacements.at(-1).blockDefinitionId
        ? { ...block, requiredInputs: ['missing_state'], inputs: [blockField('missing_state', true)] }
        : block,
    ),
  };
  const plan = clusterCompilerModule.compileHuggingFaceClusterStructuralPlan(changedLibrary, flux);
  assert.equal(plan.structurallyClosed, false);
  assert.ok(plan.diagnostics.some((diagnostic) => diagnostic.field === 'missing_state'));
  assert.throws(
    () =>
      clusterCompilerModule.compileHuggingFaceClusterStructuralPlan(parsed, {
        ...flux,
        contentHash: `sha256:${'f'.repeat(64)}`,
      }),
    /content hashes/,
  );
});

test('persisted Cluster Node graphs restore parameters and rebuild derived hierarchy from the reviewed definition', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const flux = parsed.definitions.find((definition) => definition.pipelineClass === 'FluxModularPipeline');
  const root = clusterGraphModule.createHuggingFaceClusterNode(
    flux,
    'cluster-persistence',
    { x: 0, y: 0 },
    { prompt: 'A glass forest' },
  );
  const expanded = clusterGraphModule.expandHuggingFaceClusterInstance({ nodes: [root], edges: [] }, root.id, flux);
  const originalChildIds = expanded.nodes
    .filter((node) => node.data.huggingFaceClusterInstanceId === root.id)
    .map((node) => node.id);
  const persisted = flowStoreModule.normalizePersistedFlowState(
    JSON.parse(JSON.stringify({ ...expanded, viewport: { x: 10, y: 20, zoom: 0.8 } })),
  );
  const restoredRoot = persisted.nodes.find((node) => node.id === root.id);
  assert.equal(restoredRoot.data.huggingFaceClusterInstance.parameterOverrides.prompt, 'A glass forest');
  assert.equal(restoredRoot.data.params.prompt.value, 'A glass forest');

  const restored = clusterGraphModule.reconcileHuggingFaceClusterGraph(persisted, root.id, flux);
  assert.deepEqual(
    restored.nodes.filter((node) => node.data.huggingFaceClusterInstanceId === root.id).map((node) => node.id),
    originalChildIds,
  );
  assert.throws(
    () =>
      clusterGraphModule.reconcileHuggingFaceClusterGraph(
        {
          ...persisted,
          nodes: persisted.nodes.map((node) =>
            node.id === root.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    huggingFaceClusterInstance: {
                      ...node.data.huggingFaceClusterInstance,
                      definition: {
                        ...node.data.huggingFaceClusterInstance.definition,
                        contentHash: `sha256:${'f'.repeat(64)}`,
                      },
                    },
                  },
                }
              : node,
          ),
        },
        root.id,
        flux,
      ),
    /content hash/,
  );
});

test('flow-store Cluster actions keep visual controls and the persisted instance contract synchronized', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const flux = parsed.definitions.find((definition) => definition.pipelineClass === 'FluxModularPipeline');
  const root = clusterGraphModule.createHuggingFaceClusterNode(flux, 'cluster-store-action', { x: 0, y: 0 });
  const otherRoot = clusterGraphModule.createHuggingFaceClusterNode(
    flux,
    'cluster-store-action-other',
    { x: 500, y: 0 },
    { prompt: 'An isolated second Cluster' },
  );
  libraryStoreModule.useHuggingFaceNodeLibraryStore.setState({ library: parsed, loaded: true, error: null });
  flowStoreModule.useFlowStore.setState({
    nodes: [root, otherRoot],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  clusterRuntimeStoreModule.useHuggingFaceClusterRuntimeStore.setState({
    authorities: {
      [root.id]: { instanceId: root.id },
      [otherRoot.id]: { instanceId: otherRoot.id },
    },
  });

  flowStoreModule.useFlowStore.getState().setHuggingFaceClusterParameter(root.id, 'prompt', 'A clockwork greenhouse');
  let state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.nodes[0].data.params.prompt.value, 'A clockwork greenhouse');
  assert.equal(state.nodes[0].data.huggingFaceClusterInstance.parameterOverrides.prompt, 'A clockwork greenhouse');
  assert.equal(
    state.nodes.find((node) => node.id === otherRoot.id).data.params.prompt.value,
    'An isolated second Cluster',
  );
  assert.equal(clusterRuntimeStoreModule.useHuggingFaceClusterRuntimeStore.getState().authorities[root.id], undefined);
  assert.equal(
    clusterRuntimeStoreModule.useHuggingFaceClusterRuntimeStore.getState().authorities[otherRoot.id].instanceId,
    otherRoot.id,
  );

  state.toggleHuggingFaceClusterExpanded(root.id);
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(
    state.nodes.find((node) => node.id === root.id).data.huggingFaceClusterInstance.presentation.expanded,
    true,
  );
  assert.equal(state.nodes.filter((node) => node.data.huggingFaceClusterInstanceId === root.id).length, 0);

  state.toggleHuggingFaceClusterExpanded(root.id);
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(
    state.nodes.find((node) => node.id === root.id).data.huggingFaceClusterInstance.presentation.expanded,
    false,
  );
  assert.equal(state.nodes.filter((node) => node.data.huggingFaceClusterInstanceId === root.id).length, 0);
  assert.equal(state.nodes.find((node) => node.id === root.id).data.params.prompt.value, 'A clockwork greenhouse');
  assert.equal(
    state.nodes.find((node) => node.id === otherRoot.id).data.params.prompt.value,
    'An isolated second Cluster',
  );
});

test('expanded Cluster graph keeps root parameter edits without presentation-only block nodes', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const flux = parsed.definitions.find((definition) => definition.pipelineClass === 'FluxModularPipeline');
  const root = clusterGraphModule.createHuggingFaceClusterNode(flux, 'cluster-block-controls', { x: 0, y: 0 });
  libraryStoreModule.useHuggingFaceNodeLibraryStore.setState({ library: parsed, loaded: true, error: null });
  flowStoreModule.useFlowStore.setState({
    nodes: [root],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });

  flowStoreModule.useFlowStore.getState().toggleHuggingFaceClusterExpanded(root.id);
  let state = flowStoreModule.useFlowStore.getState();
  assert.equal(
    state.nodes.some((node) => node.data.huggingFaceClusterRole === 'block'),
    false,
  );
  flowStoreModule.useFlowStore.getState().setHuggingFaceClusterParameter(root.id, 'prompt', 'Block-owned edit');
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.nodes.find((node) => node.id === root.id).data.params.prompt.value, 'Block-owned edit');

  flowStoreModule.useFlowStore.getState().toggleHuggingFaceClusterExpanded(root.id);
  flowStoreModule.useFlowStore.getState().toggleHuggingFaceClusterExpanded(root.id);
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.nodes.find((node) => node.id === root.id).data.params.prompt.value, 'Block-owned edit');
  assert.equal(
    state.nodes.some((node) => node.data.huggingFaceClusterRole === 'block'),
    false,
  );
});

test('Nodes panel keeps structural Clusters and Modular blocks draggable', () => {
  const parsed = libraryModule.parseHuggingFaceNodeLibrary(payload());
  const sections = libraryCatalogModule.buildHuggingFaceCatalogSections(parsed);
  const markup = renderToStaticMarkup(
    React.createElement(nodeListModule.HuggingFaceNodeGroups, {
      activeGroupIds: [
        'hugging-face:diffusers_cluster_nodes',
        'hugging-face:modular_diffusers_block_nodes',
        'hugging-face:diffusers_component_nodes',
      ],
      error: null,
      loading: false,
      onRetry: async () => {},
      onInsertCluster: () => {},
      onToggleGroup: () => {},
      searching: true,
      sections,
    }),
  );
  assert.match(markup, />Diffusers Blocks</);
  assert.match(markup, />Modular Diffusers implementation</);
  assert.match(markup, />Diffusers components</);
  assert.match(markup, /data-readiness="catalog_only"/);
  assert.match(markup, /aria-label="[^"]+Catalog only; insert Block\."/);
  assert.match(markup, /aria-label="[^"]+Composable; insert Modular Diffusers block\."/);
  assert.match(markup, /draggable="true"/);
  assert.match(markup, /Add this exact pinned Modular Diffusers definition from \d+ compatible context/);
  assert.match(markup, /Insert the reviewed structural Block; execution remains unavailable/);
  assert.match(markup, /Catalog only/);
  assert.doesNotMatch(markup, />Diffusers Pipelines</);

  assert.equal(
    nodeCatalogModule.nodeGroupForCatalogEntry(
      {
        node: { module: 'modules.HuggingFaceTransformers', category: 'Text' },
        surfaceCategory: 'Text',
        groupPath: ['Text', 'Generate'],
      },
      false,
    ),
    'Text',
  );
  const userNode = userBlocksModule.createUserBlockNode(
    {
      id: 'user-node-one',
      name: 'My custom block',
      version: 1,
      nodes: [],
      edges: [],
      inputs: [],
      outputs: [],
      exposedParams: [],
      createdAt: 1,
      updatedAt: 1,
    },
    { x: 0, y: 0 },
  );
  assert.equal(userNode.data.category, 'User Nodes');
});

test('the parser rejects a built-in definition presented as mutable user content', () => {
  const changed = payload();
  changed.definitions[0].mutable = true;
  assert.throws(() => libraryModule.parseHuggingFaceNodeLibrary(changed), /Invalid Hugging Face node-library/);
});

test('the store fetches the dedicated read-only endpoint and rejects malformed responses', async () => {
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return jsonResponse(payload());
  };

  await libraryStoreModule.useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
  let state = libraryStoreModule.useHuggingFaceNodeLibraryStore.getState();
  assert.match(requests[0], /\/huggingface\/node-library$/);
  assert.equal(state.loaded, true);
  assert.equal(state.error, null);
  assert.equal(state.library.definitions.length, 2);

  globalThis.fetch = async () => jsonResponse({ definitions: [] });
  await libraryStoreModule.useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
  state = libraryStoreModule.useHuggingFaceNodeLibraryStore.getState();
  assert.equal(state.loaded, true);
  assert.equal(state.library, null);
  assert.match(state.error, /Invalid Hugging Face node-library/);
});

test('concurrent catalog consumers await the same fetch instead of cancelling each other', async () => {
  const store = libraryStoreModule.useHuggingFaceNodeLibraryStore;
  store.setState({ library: null, loaded: false, error: null });
  const requests = [];
  globalThis.fetch = (url, options) =>
    new Promise((resolve) => requests.push({ url, signal: options.signal, resolve }));
  const first = store.getState().fetchLibrary();
  const second = store.getState().fetchLibrary();
  let firstSettled = false;
  void first.then(() => {
    firstSettled = true;
  });
  try {
    await Promise.resolve();
    assert.equal(requests.length, 1, 'palette, route compiler and Auto must share one in-flight catalog pull');
    assert.equal(requests[0].signal.aborted, false);
    assert.equal(firstSettled, false, 'an awaited fetch cannot return before the catalog is available');
  } finally {
    requests.forEach(({ resolve }) => resolve(jsonResponse(payload())));
    await Promise.all([first, second]);
  }
  assert.equal(store.getState().library.definitions.length, 2);
  assert.equal(store.getState().error, null);
  // An explicit refresh after completion is still a new request, not a stale cache.
  globalThis.fetch = async () => jsonResponse({ definitions: [] });
  await store.getState().fetchLibrary();
  assert.equal(store.getState().library, null);
  assert.match(store.getState().error, /Invalid Hugging Face node-library/);
});

test('runtime library groups stay nested across modes and only identical executable contracts merge', async () => {
  const audit = await server.ssrLoadModule('/src/studio/nodeLibraryAuditV2.ts');
  const base = {
    type: 'custom',
    module: 'modules.Image',
    action: 'Resize',
    label: 'Resize image',
    category: 'image_filter',
    params: { width: { type: 'int', value: 512 } },
  };
  const registry = {
    resize: base,
    alias: { ...base, label: 'Resize picture' },
    variant: { ...base, action: 'Fit', label: 'Resize image', params: { width: { type: 'int', value: 1024 } } },
  };
  const before = JSON.stringify(registry);
  const entries = nodeCatalogModule.nodeCatalogEntries(registry);
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.deepEqual(entry.groupPath, ['Image', 'Resize & Crop']);
    assert.equal(
      nodeCatalogModule.nodeGroupForCatalogEntry(entry, true),
      nodeCatalogModule.nodeGroupForCatalogEntry(entry, false),
    );
  }
  assert.equal(audit.auditNodeLibraryV2(registry, []).exactRuntimeAliases.length, 1);
  assert.equal(JSON.stringify(registry), before);
});
