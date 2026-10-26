import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = Object.fromEntries(['window', 'localStorage', 'fetch'].map((key) => [key, globalThis[key]]));
let server, fixture;
const load = (name) => server.ssrLoadModule(`/src/${name}.ts`);

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
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/cache$/u, 'these units may only simulate normal cache eviction');
    assert.equal(options?.method, 'DELETE');
    return new Response(JSON.stringify({ error: false, nodes: JSON.parse(options.body).nodes }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  fixture = JSON.parse(await readFile(path.join(ROOT, 'tests/fixtures/public-flux3-missing-provider.v1.json'), 'utf8'));
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
});
after(async () => {
  await server?.close();
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
});

function selectedCase(modelType = 'Flux3DistilledModularPipeline') {
  const capability = fixture.capabilitiesPayload.capabilities.find((item) => item.modelType === modelType);
  assert.ok(capability, modelType);
  const spec = capability.studioExecutionSpecs.find((item) => item.mode === 'text_to_image');
  assert.ok(spec);
  return {
    capability,
    spec,
    profile: capability.executionProfiles.find((item) => item.id === spec.executionProfileId),
  };
}

async function formFor(capability, values = {}) {
  const { DEFAULT_STUDIO_FORM } = await load('studio/modelProfiles');
  return {
    ...DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: capability.modelType,
    modelRepo: capability.defaultRepo,
    resourceMode: 'expert',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    autoOffload: false,
    offloadMode: 'none',
    width: 512,
    height: 512,
    randomSeed: false,
    ...values,
  };
}

// Keep this first and import only pre-existing modules: old source must fail on
// its actual dropped/hardcoded value, never on absence of the new helper file.
test('persisted explicit FP8r reaches the declared semantic weight-format binding', async () => {
  const { capability, spec } = selectedCase();
  const contracts = await load('studio/outputContracts');
  const values = await load('studio/executionSpecValues');
  const form = await formFor(capability, { weightFormat: 'fp8r' });
  const restored = contracts.coerceStudioFormState(form);
  const resolved = values.resolveStudioExecutionSpecValues({ ...restored, weightFormat: 'fp8r' }, spec, capability);
  assert.deepEqual([restored.weightFormat, resolved.weightFormat], ['fp8r', 'fp8r']);
  assert.deepEqual([resolved.dtype, resolved.quantizationMode], ['bfloat16', 'none']);
});

async function descriptors() {
  const operations = await load('workflow/operationContracts');
  const catalog = await load('workflow/operationCatalog');
  const choices = await load('workflow/workflowChoices');
  const payload = fixture.capabilitiesPayload;
  const contracts = operations.parseOperationContracts(
    payload.operationContracts,
    payload.operationContractSchemaVersion,
  );
  const support = catalog.parsePipelineSupport(
    payload.pipelineSupport,
    payload.pipelineSupportSchemaVersion,
    contracts,
  );
  return { contracts, rows: choices.parseWorkflowModelDescriptors(payload, support) };
}

async function loaderFor(capability, spec) {
  const { contracts } = await descriptors();
  const requests = await load('workflow/operationStarterRequest');
  const operations = await load('workflow/operationAuthoring');
  const source = fixture.starters.find(
    (item) =>
      item.pipelineClass === spec.pipelineClass &&
      item.task === spec.mode &&
      item.authoring.executionProfileIds.includes(spec.executionProfileId) &&
      item.authoring.id.endsWith(':prompt-preview-append-fp32:v1'),
  );
  assert.ok(source, spec.executionProfileId);
  const raw = structuredClone(source);
  const selection = { executionProfileId: spec.executionProfileId, authoringRecipeId: raw.authoring.id };
  const starter = requests.parseOperationStarter(raw, spec.pipelineClass, spec.mode, contracts, selection);
  const graph = operations.createOperationStarter(starter, { x: 80, y: 120 });
  const loader = graph.nodes.find(
    (node) => node.data.module === 'modules.ModularDiffusers' && node.data.action === 'ModelsLoader',
  );
  assert.ok(loader);
  assert.equal(loader.data.params.repo_id.value.value, capability.defaultRepo);
  return { loader, raw, starter };
}

function withFormat(loader, format = 'fp8r') {
  const node = structuredClone(loader);
  node.data.params.weight_format = { ...node.data.params.weight_format, value: format };
  return node;
}

test('format values are closed and current loader options are required for non-native edits', async () => {
  const formats = await load('studio/weightFormat');
  assert.equal(formats.studioWeightFormat(undefined), 'native');
  for (const value of ['native', 'fp8r', 'nvfp4']) assert.equal(formats.studioWeightFormat(value), value);
  for (const value of [null, true, 1, [], {}, 'FP8R', 'bnb_4bit'])
    assert.throws(() => formats.studioWeightFormat(value), /backend-declared weight format/);
  assert.equal(formats.assertStudioWeightFormatOptions(undefined), 'native');
  assert.throws(() => formats.assertStudioWeightFormatOptions('fp8r'), /current loader fields/);
  assert.throws(
    () => formats.assertStudioWeightFormatOptions('fp8r', { options: ['native'] }),
    /current loader fields/,
  );
  assert.equal(formats.assertStudioWeightFormatOptions('fp8r', { options: ['native', 'fp8r'] }), 'fp8r');
});

test('native absence preserves historical template and prompt lock shapes while explicit formats bind new locks', async () => {
  const exactness = await load('studio/templateExactness');
  const templates = await load('studio/templates');
  const hashes = await load('studio/stableHash');
  const template = structuredClone(
    templates.STUDIO_TEMPLATES.find((item) => item.id === 'qwen_low_vram_product_concept'),
  );
  assert.ok(template);
  const before = structuredClone(template);
  const native = {
    ...template,
    example: { ...template.example, lockedSettings: { ...template.example.lockedSettings, weightFormat: 'native' } },
  };
  const oldSettings = exactness.getTemplateLockedSettings(template);
  assert.equal(Object.hasOwn(oldSettings, 'weightFormat'), false);
  assert.deepEqual(exactness.getTemplateLockedSettings(native), oldSettings);
  assert.equal(exactness.getTemplateLockHash(native), exactness.getTemplateLockHash(template));
  assert.equal(
    exactness.getPromptSettingsHash({ ...oldSettings, weightFormat: 'native' }),
    exactness.getPromptSettingsHash(oldSettings),
  );
  assert.equal(
    exactness.getPromptSettingsHash(oldSettings),
    `ps_${hashes.hashString(hashes.stableStringify(oldSettings))}`,
  );
  const fp8 = {
    ...native,
    example: { ...native.example, lockedSettings: { ...native.example.lockedSettings, weightFormat: 'fp8r' } },
  };
  const fp4 = {
    ...fp8,
    example: { ...fp8.example, lockedSettings: { ...fp8.example.lockedSettings, weightFormat: 'nvfp4' } },
  };
  assert.equal(exactness.getTemplateLockedSettings(fp8).weightFormat, 'fp8r');
  assert.notEqual(exactness.getTemplateLockHash(fp8), exactness.getTemplateLockHash(template));
  assert.notEqual(exactness.getTemplateLockHash(fp4), exactness.getTemplateLockHash(fp8));
  assert.notEqual(
    exactness.getPromptSettingsHash(exactness.getTemplateLockedSettings(fp8)),
    exactness.getPromptSettingsHash(oldSettings),
  );
  assert.deepEqual(template, before);
});

test('each real public owner joins only its declared immutable weight-format inventory', async () => {
  const formats = await load('studio/weightFormat');
  const { rows } = await descriptors();
  const fixtureBefore = structuredClone(fixture);
  for (const modelType of ['Flux3DistilledModularPipeline', 'Flux3ModularPipeline']) {
    const { capability, spec } = selectedCase(modelType);
    const { loader } = await loaderFor(capability, spec);
    assert.equal(formats.selectedNodeWeightFormatArtifact(loader, rows), null);
    for (const format of ['fp8r', 'nvfp4']) {
      const node = withFormat(loader, format);
      const selected = formats.selectedNodeWeightFormatArtifact(node, rows);
      const expected = capability.weightFormatSelections.find((item) => item.weightFormat === format);
      assert.ok(expected);
      assert.deepEqual(selected.selection, expected);
      assert.equal(selected.descriptor.profileId, spec.executionProfileId);
      assert.deepEqual(selected.options, ['native', 'fp8r', 'nvfp4']);
      assert.equal(
        Object.hasOwn(node.data.params, 'execution_profile_id'),
        false,
        'actual ordinary loader does not carry a fabricated profile parameter',
      );
      for (const [field, value] of [
        ['revision', '0'.repeat(40)],
        ['model_type', 'ForeignPipeline'],
      ]) {
        const invalid = structuredClone(node);
        invalid.data.params[field].value = value;
        const before = structuredClone(invalid);
        assert.throws(() => formats.selectedNodeWeightFormatArtifact(invalid, rows), /exact backend|do not declare/);
        assert.deepEqual(invalid, before);
      }
      assert.throws(
        () =>
          formats.selectedNodeWeightFormatArtifact(
            node,
            rows.filter((row) => row.profileId !== spec.executionProfileId),
          ),
        /exact backend|do not declare/,
      );
      const descriptor = rows.find((row) => row.profileId === spec.executionProfileId);
      const ambiguous = [...rows, { ...descriptor, profileId: 'ambiguous-same-artifact' }];
      assert.throws(() => formats.selectedNodeWeightFormatArtifact(node, ambiguous), /exact backend|do not declare/);
      assert.equal(
        formats.selectedNodeWeightFormatArtifact(node, ambiguous, spec.executionProfileId).descriptor.profileId,
        spec.executionProfileId,
        'a verified template selection can disambiguate its exact profile',
      );
      assert.throws(
        () => formats.selectedNodeWeightFormatArtifact(node, [...rows, descriptor], spec.executionProfileId),
        /exact backend|do not declare/,
        'the same explicit profile cannot have duplicate authorities',
      );
      const local = structuredClone(node);
      local.data.params.repo_id.value = { source: 'local', value: 'local-file.safetensors' };
      assert.throws(() => formats.selectedNodeWeightFormatArtifact(local, rows), /immutable Hub/);
      const foreign = structuredClone(node);
      foreign.data.module = 'modules.Foreign';
      assert.throws(() => formats.selectedNodeWeightFormatArtifact(foreign, rows), /does not declare/);
    }
  }
  assert.deepEqual(fixture, fixtureBefore, 'source metadata and dormant qualification flags must remain unchanged');
});

test('the public template creator binds FP8r from exact metadata without changing the shared registry', async () => {
  const { createTemplateOperationGraph } = await load('studio/templateOperationWorkflow');
  const { expandFlowExecutionGraph } = await load('stores/useFlowStore');
  const { STUDIO_TEMPLATES } = await load('studio/templates');
  const { rows } = await descriptors();
  const originalFixture = structuredClone(fixture);
  // This CPU source capture omits the ordinary Preview leaf. Reuse its real
  // maintained definition without changing either shared metadata fixture.
  const ancillary = JSON.parse(await readFile(path.join(ROOT, 'tests/fixtures/ancillary-authoring.v1.json'), 'utf8'));
  const preview = ancillary.parents[0].registry['modules.Image.Preview'];
  assert.deepEqual([preview.module, preview.action], ['modules.Image', 'Preview']);
  const registry = { ...structuredClone(fixture.registry), 'modules.Image.Preview': structuredClone(preview) };
  const registryBefore = structuredClone(registry);
  for (const modelType of ['Flux3DistilledModularPipeline', 'Flux3ModularPipeline']) {
    const { capability, spec } = selectedCase(modelType);
    const { starter } = await loaderFor(capability, spec);
    const rawOwner = starter.nodes.find((item) => item.node.action === 'ModelsLoader');
    const declaredDevice = rawOwner.node.params.device.value;
    assert.equal(declaredDevice, 'cpu:0', 'this source fixture declares only CPU devices');
    // A legitimate initial static field can still be native-only. Current
    // descriptor metadata supplies choices to this instance, not to the registry.
    rawOwner.node.params.weight_format.options = ['native'];
    rawOwner.node.params.weight_format.hidden = true;
    const template = structuredClone(STUDIO_TEMPLATES.find((item) => item.id === 'qwen_low_vram_product_concept'));
    Object.assign(template, {
      id: 'unit-format-template',
      modelType,
      mode: 'text_to_image',
      workflowBlocks: [],
      modelArtifact: { source: 'hub', value: capability.defaultRepo, revision: capability.revisionCandidates[0] },
      executionSelection: {
        schemaVersion: 1,
        pipelineClass: spec.pipelineClass,
        task: spec.mode,
        executionProfileId: spec.executionProfileId,
        bindingSpec: { modelType, mode: spec.mode },
        implementation: 'native_stages',
        memoryPolicy: 'custom_experimental',
        authoringRecipeId: starter.authoring.id,
      },
    });
    template.example = { ...template.example, mediaType: 'image', modelRevision: capability.revisionCandidates[0] };
    const graph = createTemplateOperationGraph(
      template,
      await formFor(capability, { weightFormat: 'fp8r', device: declaredDevice }),
      starter,
      registry,
      spec,
      capability,
      { workflowModelDescriptors: rows },
    );
    const effective = expandFlowExecutionGraph(graph.nodes, graph.edges);
    const owner = effective.nodes.find((node) => node.data.action === 'ModelsLoader');
    assert.ok(owner, 'inspect the declared executable owner inside the normal grouped template');
    assert.equal(owner.data.params.weight_format.value, 'fp8r');
    assert.deepEqual(owner.data.params.weight_format.options, ['native', 'fp8r', 'nvfp4']);
    assert.equal(owner.data.params.weight_format.hidden, false);
    assert.equal(Object.hasOwn(owner.data.params, 'execution_profile_id'), false);
    assert.deepEqual(owner.data.params.repo_id.value, { source: 'hub', value: capability.defaultRepo });
    assert.equal(owner.data.params.revision.value, capability.revisionCandidates[0]);
  }
  assert.deepEqual(registry, registryBefore);
  assert.deepEqual(fixture, originalFixture);
  assert.equal(fixture.activeProvider, null, 'graph construction does not install or qualify the missing provider');
});

test('native-only cache cannot satisfy a distinct variant and deduplication preserves both exact file selections', async () => {
  const formats = await load('studio/weightFormat');
  const artifacts = await load('studio/artifactRequirements');
  const { capability, spec } = selectedCase();
  const { loader } = await loaderFor(capability, spec);
  const { rows } = await descriptors();
  const selected = formats.selectedNodeWeightFormatArtifact(withFormat(loader), rows).selection;
  const reference = (files) => ({
    nodeId: loader.id,
    kind: 'repo',
    value: selected.repo,
    revision: selected.revision,
    paramKey: 'repo_id',
    downloadFiles: files,
  });
  const baseCache = {
    id: selected.repo,
    complete: true,
    installed: true,
    planned_revision: selected.revision,
    planned_files: [...capability.downloadFiles],
  };
  const requirements = artifacts.getGraphWorkflowArtifactRequirements({
    references: [
      reference(capability.downloadFiles),
      reference(selected.downloadFiles),
      reference(selected.downloadFiles),
    ],
    hfCache: [baseCache],
    localModels: [],
    modelCacheDiagnostics: null,
  });
  assert.equal(
    requirements.length,
    2,
    'native and variant manifests are distinct, duplicate exact variant is one target',
  );
  const missing = requirements.find((item) => item.installTarget?.files?.includes('variants/fp8r/model.safetensors'));
  assert.ok(missing);
  assert.equal(missing.status.runnable, false);
  assert.equal(missing.primaryAction, 'Repair');
  assert.deepEqual(missing.installTarget.files, selected.downloadFiles);
  assert.equal(missing.installTarget.revision, selected.revision);
  assert.notEqual(missing.installTarget.files, selected.downloadFiles);
  const installed = artifacts.getGraphWorkflowArtifactRequirements({
    references: [reference(selected.downloadFiles)],
    hfCache: [{ ...baseCache, planned_files: [...selected.downloadFiles] }],
    localModels: [],
    modelCacheDiagnostics: null,
  });
  assert.equal(installed[0].status.runnable, true);
  assert.equal(installed[0].installTarget, undefined);
  const separateInstalled = artifacts.getGraphWorkflowArtifactRequirements({
    references: [
      reference(capability.downloadFiles),
      reference(selected.downloadFiles),
      reference(selected.downloadFiles),
    ],
    hfCache: [{ ...baseCache, planned_files: [...new Set([...capability.downloadFiles, ...selected.downloadFiles])] }],
    localModels: [],
    modelCacheDiagnostics: null,
  });
  assert.equal(
    separateInstalled.every((item) => item.status.runnable && item.installTarget === undefined),
    true,
  );
  assert.equal(separateInstalled.length, 2);
  assert.equal(
    new Set(separateInstalled.map((item) => item.id)).size,
    2,
    'exact manifest identity must survive deduplication after Ready drops installTarget',
  );
});

test('observed exact cached selections supersede native receipts without confusing variants or repository prefixes', async () => {
  const { getRepoCacheStatus, getStudioModelCacheStatus } = await load('studio/modelCache');
  const { getGraphWorkflowArtifactRequirements } = await load('studio/artifactRequirements');
  const repo = 'example/image';
  const revision = 'a'.repeat(40);
  const native = ['model_index.json', 'native.safetensors'];
  const files = ['model_index.json', 'variants/fp8r/model.safetensors'];
  const entry = {
    id: repo,
    installed: true,
    complete: true,
    planned_revision: revision,
    planned_files: native,
    observed_selections: [{ revision, files, complete: true }],
  };
  const status = (cache, expectation = { revision, files }) => getRepoCacheStatus(repo, cache, [], null, expectation);
  assert.equal(status([entry]).runnable, true, 'a stale receipt is not an inventory of all cached files');
  assert.equal(status([{ ...entry, installed: false, complete: false, repair_required: true }]).runnable, true);
  const incompleteNative = { ...entry, installed: false, complete: false, repair_required: true };
  assert.equal(status([incompleteNative], { revision }).runnable, false, 'a revision alone does not select FP8r');
  assert.equal(status([incompleteNative], { files }).runnable, false, 'files alone do not select a revision');
  assert.equal(status([entry], { revision, files: native }).runnable, false);
  assert.equal(status([entry], { revision: 'b'.repeat(40), files }).runnable, false);
  assert.equal(status([entry], { revision, files: ['variants/nvfp4/model.safetensors'] }).runnable, false);
  assert.equal(status([{ ...entry, id: `${repo}-base` }]).runnable, false);
  assert.equal(status([{ ...entry, id: `${repo}-base` }, entry]).runnable, true);
  for (const observed_selections of [
    [{ revision, files, complete: false }],
    [{ revision, files, complete: 'true' }],
    [{ revision, files: [...files, '../escape'], complete: true }],
    [],
    null,
  ]) {
    assert.equal(status([{ ...entry, planned_files: files, observed_selections }]).runnable, false);
  }
  const { observed_selections: _observations, ...legacy } = entry;
  assert.equal(status([{ ...legacy, planned_files: files }]).runnable, true, 'older backend compatibility');
  assert.equal(status([legacy]).runnable, false);
  assert.equal(getRepoCacheStatus(repo, [{ ...legacy, id: `${repo}-base` }], [], null).runnable, false);
  const profile = { defaultRepo: repo, revisionCandidates: [revision], downloadFiles: files };
  assert.equal(getStudioModelCacheStatus(profile, [entry], [], null).runnable, true);
  const requirements = getGraphWorkflowArtifactRequirements({
    references: [{ nodeId: 'owner', kind: 'repo', value: repo, revision, paramKey: 'repo_id', downloadFiles: files }],
    hfCache: [entry],
    localModels: [],
    modelCacheDiagnostics: null,
  });
  assert.equal(requirements[0].status.runnable, true);
  assert.equal(requirements[0].installTarget, undefined);
});

test('incompatible model or execution changes require an explicit Native choice without mutating the draft', async () => {
  const formats = await load('studio/weightFormat');
  const values = await load('studio/executionSpecValues');
  const { rows } = await descriptors();
  const { capability, spec } = selectedCase();
  const form = await formFor(capability, { weightFormat: 'fp8r' });
  const before = structuredClone(form);
  assert.doesNotThrow(() => formats.assertFormWeightFormatSelection(form, spec, capability, rows));
  const noBinding = { ...spec, bindings: spec.bindings.filter(([, , source]) => source !== 'weightFormat') };
  assert.throws(() => values.resolveStudioExecutionSpecValues(form, noBinding, capability), /does not declare/);
  for (const [selectedSpec, selectedCapability, selectedRows] of [
    [noBinding, capability, rows],
    [spec, { ...capability, modelType: 'ForeignPipeline' }, rows],
    [spec, { ...capability, revisionCandidates: ['0'.repeat(40)] }, rows],
    [spec, capability, []],
  ])
    assert.throws(
      () => formats.assertFormWeightFormatSelection(form, selectedSpec, selectedCapability, selectedRows),
      /Choose Native explicitly; the graph is unchanged/,
    );
  assert.deepEqual(form, before);
  assert.doesNotThrow(() =>
    formats.assertFormWeightFormatSelection(
      { ...form, weightFormat: 'native' },
      noBinding,
      { ...capability, modelType: 'ForeignPipeline' },
      [],
    ),
  );
});

test('managed weight-format aliases validate every current target before changing form or siblings', async () => {
  const sync = await load('studio/managedControlSync');
  const { useFlowStore } = await load('stores/useFlowStore');
  const { useStudioStore } = await load('stores/useStudioStore');
  const { capability, spec } = selectedCase();
  const { loader } = await loaderFor(capability, spec);
  const originalFlow = useFlowStore.getState();
  const originalStudio = useStudioStore.getState();
  try {
    const node = (id) => {
      const value = withFormat(loader, 'native');
      value.id = id;
      value.data.studioRole = 'models';
      value.data.params.weight_format.options = ['native', 'fp8r', 'nvfp4'];
      return value;
    };
    const a = node('format-a'),
      b = node('format-b'),
      ordinary = node('format-manual');
    const binding = {
      mode: 'text_to_image',
      modelType: capability.modelType,
      nodes: { models: a.id },
      managedNodeIds: [a.id, b.id],
      managedEdgeIds: [],
      fingerprint: 'unit-weight-format',
      createdAt: 1,
      updatedAt: 1,
    };
    useFlowStore.setState({ nodes: [a, b, ordinary], edges: [] });
    useStudioStore.setState({ form: await formFor(capability), graphBinding: binding });
    sync.syncManagedNodeControlChange(a.id, 'weight_format', 'fp8r');
    assert.equal(useStudioStore.getState().form.weightFormat, 'fp8r');
    for (const id of [a.id, b.id])
      assert.equal(
        useFlowStore.getState().nodes.find((item) => item.id === id).data.params.weight_format.value,
        'fp8r',
      );
    assert.equal(
      useFlowStore.getState().nodes.find((item) => item.id === ordinary.id).data.params.weight_format.value,
      'native',
    );
    const restricted = structuredClone(useFlowStore.getState().nodes);
    restricted.find((item) => item.id === b.id).data.params.weight_format.options = ['native'];
    useFlowStore.setState({ nodes: restricted });
    const formBefore = structuredClone(useStudioStore.getState().form);
    const nodesBefore = structuredClone(useFlowStore.getState().nodes);
    assert.throws(() => sync.syncManagedNodeControlChange(a.id, 'weight_format', 'nvfp4'), /current loader fields/);
    assert.deepEqual(useStudioStore.getState().form, formBefore);
    assert.deepEqual(useFlowStore.getState().nodes, nodesBefore);
    sync.syncManagedNodeControlChange(ordinary.id, 'weight_format', 'nvfp4');
    assert.deepEqual(
      useStudioStore.getState().form,
      formBefore,
      'ordinary graph fields are not managed form authority',
    );
    assert.deepEqual(useFlowStore.getState().nodes, nodesBefore);
  } finally {
    useFlowStore.setState(originalFlow, true);
    useStudioStore.setState(originalStudio, true);
  }
});

test('applying a historical native template clears a prior explicit format without rewriting its locks', async () => {
  const { useStudioStore } = await load('stores/useStudioStore');
  const { STUDIO_TEMPLATES } = await load('studio/templates');
  const formats = await load('studio/weightFormat');
  const exactness = await load('studio/templateExactness');
  const template = STUDIO_TEMPLATES.find((item) => item.id === 'qwen_low_vram_product_concept');
  assert.ok(template);
  const before = structuredClone(template);
  const hash = exactness.getTemplateLockHash(template);
  const originalStudio = useStudioStore.getState();
  try {
    useStudioStore.setState({ form: { ...originalStudio.form, weightFormat: 'fp8r' } });
    useStudioStore.getState().applyTemplate(template);
    assert.equal(formats.studioWeightFormat(useStudioStore.getState().form.weightFormat), 'native');
    assert.equal(Object.hasOwn(exactness.getTemplateLockedSettings(template), 'weightFormat'), false);
    assert.equal(exactness.getTemplateLockHash(template), hash);
    assert.deepEqual(template, before);
  } finally {
    useStudioStore.setState(originalStudio, true);
  }
});

test('actual managed sync entry points refuse an unsupported format before graph, form or binding mutation', async () => {
  const bridge = await load('studio/graphBridge');
  const { useFlowStore } = await load('stores/useFlowStore');
  const { useStudioStore } = await load('stores/useStudioStore');
  const { useNodesStore } = await load('stores/useNodeStore');
  const { STUDIO_TEMPLATES } = await load('studio/templates');
  const { getTemplateLockedSettings } = await load('studio/templateExactness');
  const legacy = STUDIO_TEMPLATES.find((item) => item.id === 'qwen_low_vram_product_concept');
  assert.ok(legacy);
  const { capability, spec } = selectedCase();
  const { rows } = await descriptors();
  const { loader } = await loaderFor(capability, spec);
  const current = await formFor(capability, { weightFormat: 'fp8r' });
  const requested = {
    ...current,
    ...getTemplateLockedSettings(legacy),
    modelType: legacy.modelType,
    mode: legacy.mode,
    resourceMode: 'expert',
    weightFormat: 'fp8r',
  };
  const binding = {
    mode: current.mode,
    modelType: current.modelType,
    nodes: { models: loader.id },
    managedNodeIds: [loader.id],
    managedEdgeIds: [],
    fingerprint: 'unit-unchanged-before-refusal',
    createdAt: 1,
    updatedAt: 1,
  };
  const oldFlow = useFlowStore.getState(),
    oldStudio = useStudioStore.getState(),
    oldNodes = useNodesStore.getState();
  try {
    useFlowStore.setState({ nodes: [loader], edges: [], historyPast: [], historyFuture: [] });
    useStudioStore.setState({ form: current, graphBinding: binding, graphFinalization: null });
    useNodesStore.setState({
      studioModelCapabilities: fixture.capabilitiesPayload.capabilities,
      studioExecutionSpecInvalid: false,
      workflowModelDescriptors: rows,
    });
    const snapshot = () =>
      structuredClone({
        form: useStudioStore.getState().form,
        binding: useStudioStore.getState().graphBinding,
        finalization: useStudioStore.getState().graphFinalization,
        nodes: useFlowStore.getState().nodes,
        edges: useFlowStore.getState().edges,
        historyPast: useFlowStore.getState().historyPast,
        historyFuture: useFlowStore.getState().historyFuture,
      });
    const before = snapshot();
    for (const action of [bridge.syncStudioGraphValues, bridge.syncStudioGraphDefinition]) {
      assert.throws(() => action(requested), /Choose Native explicitly; the graph is unchanged/);
      assert.deepEqual(snapshot(), before);
    }
  } finally {
    useFlowStore.setState(oldFlow, true);
    useStudioStore.setState(oldStudio, true);
    useNodesStore.setState(oldNodes, true);
  }
});

test('the model-change owner preflight preserves explicit formats only for exact compatible target artifacts', async () => {
  const { studioModelChangeWeightFormatPatch } = await load('studio/useStudioRunActions');
  const { rows } = await descriptors();
  const metadata = {
    studioModelCapabilities: fixture.capabilitiesPayload.capabilities,
    studioExecutionSpecInvalid: false,
    workflowModelDescriptors: rows,
  };
  const metadataBefore = structuredClone(metadata);
  for (const [sourceType, targetType] of [
    ['Flux3DistilledModularPipeline', 'Flux3ModularPipeline'],
    ['Flux3ModularPipeline', 'Flux3DistilledModularPipeline'],
  ]) {
    const { capability } = selectedCase(sourceType);
    const target = selectedCase(targetType).capability;
    const current = await formFor(capability, { weightFormat: 'fp8r' });
    const before = structuredClone(current);
    assert.deepEqual(studioModelChangeWeightFormatPatch(current, targetType, metadata), {
      modelRepo: target.defaultRepo,
    });
    assert.deepEqual(current, before);
    for (const [model, authority] of [
      ['QwenImageModularPipeline', metadata],
      [targetType, { ...metadata, studioExecutionSpecInvalid: true }],
      [
        targetType,
        { ...metadata, workflowModelDescriptors: [...rows, rows.find((row) => row.repo === target.defaultRepo)] },
      ],
    ]) {
      assert.throws(
        () => studioModelChangeWeightFormatPatch(current, model, authority),
        /Choose Native explicitly; the graph is unchanged/,
      );
      assert.deepEqual(current, before);
    }
    assert.deepEqual(
      studioModelChangeWeightFormatPatch({ ...current, weightFormat: 'native' }, 'QwenImageModularPipeline', metadata),
      {},
      'an explicit Native reset retains the historical model-change path',
    );
  }
  assert.deepEqual(metadata, metadataBefore);
});

test('an explicit weight format cannot reuse or request a native-only Auto resource plan', async () => {
  const auto = await load('studio/autoResource');
  const values = await load('studio/executionSpecValues');
  const formats = await load('studio/weightFormat');
  const { capability, spec } = selectedCase();
  const native = await formFor(capability, { resourceMode: 'auto' });
  const explicit = { ...native, weightFormat: 'fp8r' };
  // Exercise the existing legacy-plan path; this is a client fixture, not a
  // fabricated backend hardware receipt for the newly selected format.
  const candidate = {
    id: 'legacy-native',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    offloadMode: 'none',
    autoOffload: false,
    installed: true,
  };
  const plan = { selectedCandidate: candidate, candidates: [candidate], error: false };
  const before = structuredClone({ native, explicit, plan });
  assert.equal(auto.selectedAutoCandidate(plan, native), candidate);
  assert.equal(auto.autoPlanIsReady(plan, native), true);
  assert.equal(auto.autoResourceHealthBadge(plan, native), 'This should work');
  assert.equal(auto.autoResourceCompatibility(plan, native).source, 'backend_auto_planner');
  assert.equal(auto.formPatchForAutoCandidate(candidate, native).resourceMode, 'auto');
  assert.equal(values.resolveStudioExecutionSpecValues(native, spec, capability).weightFormat, 'native');
  assert.equal(auto.selectedAutoCandidate(plan, explicit), null);
  assert.equal(auto.autoPlanIsReady(plan, explicit), false);
  assert.equal(
    auto.autoResourceInstallTarget({ ...plan, selectedInstallTarget: { repo: capability.defaultRepo } }, explicit),
    null,
  );
  assert.equal(auto.autoResourceHealthBadge(plan, explicit), 'Expert only');
  const refusal = auto.autoResourceCompatibility(plan, explicit);
  assert.equal(refusal.state, 'expert_only');
  assert.equal(refusal.code, 'weight_format_auto_contract_unavailable');
  assert.equal(refusal.source, 'client_contract_guard');
  assert.equal(refusal.action, null);
  const unavailable = (error) => error instanceof Error && error.message === formats.WEIGHT_FORMAT_AUTO_UNAVAILABLE;
  assert.throws(() => auto.formPatchForAutoCandidate(candidate, explicit), unavailable);
  assert.deepEqual(auto.formPatchForAutoCandidate(null, explicit), {});
  assert.throws(() => values.resolveStudioExecutionSpecValues(explicit, spec, capability), unavailable);
  const expert = { ...explicit, resourceMode: 'expert' };
  assert.equal(values.resolveStudioExecutionSpecValues(expert, spec, capability).weightFormat, 'fp8r');
  const { rows } = await descriptors();
  assert.equal(formats.assertFormWeightFormatSelection(expert, spec, capability, rows).selection.weightFormat, 'fp8r');
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('unexpected Auto request');
  };
  try {
    await assert.rejects(auto.fetchAutoResourcePlan(explicit), unavailable);
    await assert.rejects(auto.fetchAutoResourcePlans([native, explicit]), unavailable);
    assert.equal(calls, 0, 'refuse before any native-only backend plan request');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual({ native, explicit, plan }, before);
});

test('selected-format summaries and graph requirements use exact files without a native readiness fallback', async () => {
  const formats = await load('studio/weightFormat');
  const cache = await load('studio/modelCache');
  const artifacts = await load('studio/artifactRequirements');
  const { capability, spec } = selectedCase();
  const { rows } = await descriptors();
  const { loader } = await loaderFor(capability, spec);
  const form = await formFor(capability, { weightFormat: 'fp8r' });
  const selected = formats.selectedNodeWeightFormatArtifact(withFormat(loader), rows).selection;
  const capabilities = fixture.capabilitiesPayload.capabilities;
  const before = structuredClone({ form, capability, rows, capabilities });
  const nativeCache = [
    {
      id: capability.defaultRepo,
      installed: true,
      complete: true,
      planned_revision: capability.revisionCandidates[0],
      planned_files: [...capability.downloadFiles],
    },
  ];
  const options = { hfCache: nativeCache, localModels: [], modelCacheDiagnostics: null };
  const native = { ...form, weightFormat: 'native' };
  assert.equal(formats.studioWeightFormatProfile(native, capability, [], [], true), capability);
  assert.equal(cache.getStudioModelCacheStatus(capability, nativeCache, [], null).runnable, true);
  const profile = formats.studioWeightFormatProfile(form, capability, capabilities, rows);
  assert.ok(profile);
  assert.deepEqual(
    [profile.defaultRepo, profile.revisionCandidates, profile.downloadFiles],
    [selected.repo, [selected.revision], selected.downloadFiles],
  );
  assert.match(profile.label, /FP8R/u);
  assert.notEqual(profile.downloadFiles, selected.downloadFiles);
  for (const key of ['templateEligible', 'galleryEligible', 'autoEligible'])
    assert.equal(profile[key], capability[key]);
  const status = cache.getStudioModelCacheStatus(profile, nativeCache, [], null);
  assert.equal(status.runnable, false);
  assert.equal(status.repairRequired, true);
  assert.equal(
    cache.reviewedExpertInstallTarget(profile, status),
    null,
    'the fixture has no active required provider; summary projection cannot grant installation readiness',
  );
  const requirements = artifacts.getStudioWorkflowArtifactRequirements({
    ...options,
    form,
    backendCapabilities: capabilities,
    workflowModelDescriptors: rows,
  });
  const pipeline = requirements.find((item) => item.repo === selected.repo);
  assert.ok(pipeline);
  assert.equal(pipeline.primaryAction, 'Repair');
  assert.equal(pipeline.status.runnable, false);
  assert.deepEqual(
    [pipeline.installTarget.revision, pipeline.installTarget.files],
    [selected.revision, selected.downloadFiles],
  );
  for (const [caps, declarations, invalid] of [
    [[], rows, false],
    [capabilities, [], false],
    [capabilities, rows, true],
  ]) {
    assert.equal(formats.studioWeightFormatProfile(form, capability, caps, declarations, invalid), null);
    const missing = artifacts.getStudioWorkflowArtifactRequirements({
      ...options,
      form,
      backendCapabilities: caps,
      workflowModelDescriptors: declarations,
      studioExecutionSpecInvalid: invalid,
    });
    assert.equal(missing.length, 1);
    assert.equal(missing[0].primaryAction, 'Details');
    assert.equal(missing[0].status.runnable, false);
    assert.equal(missing[0].installTarget, undefined);
  }
  const diagnostic = cache.getStudioModelCacheStatus(null, nativeCache, [], null);
  assert.equal(diagnostic.runnable, false);
  assert.equal(diagnostic.repairRequired, false);
  assert.match(diagnostic.reason, /no native installation is selected/u);
  const reference = { nodeId: loader.id, kind: 'repo', value: selected.repo, paramKey: 'repo_id' };
  const unrelated = { nodeId: 'unrelated-native', kind: 'repo', value: 'unrelated/native', paramKey: 'repo_id' };
  const unrelatedBaseline = artifacts.getGraphWorkflowArtifactRequirements({ ...options, references: [unrelated] })[0];
  const graph = artifacts.getGraphWorkflowArtifactRequirements({
    ...options,
    references: [reference, unrelated],
    nodes: [withFormat(loader)],
    workflowModelDescriptors: rows,
  });
  assert.equal(graph[0].primaryAction, 'Repair');
  assert.deepEqual(
    [graph[0].installTarget.revision, graph[0].installTarget.files],
    [selected.revision, selected.downloadFiles],
  );
  assert.deepEqual(graph[1], unrelatedBaseline);
  const invalidGraph = artifacts.getGraphWorkflowArtifactRequirements({
    ...options,
    references: [reference, unrelated],
    nodes: [withFormat(loader)],
    workflowModelDescriptors: [],
  });
  assert.equal(invalidGraph[0].primaryAction, 'Details');
  assert.equal(invalidGraph[0].status.runnable, false);
  assert.equal(invalidGraph[0].installTarget, undefined);
  assert.deepEqual(invalidGraph[1], unrelatedBaseline);
  assert.deepEqual({ form, capability, rows, capabilities }, before);
});

test('actual persistence hydration retains unsupported format documents as blocked and recoverable', async () => {
  const { useStudioStore } = await load('stores/useStudioStore');
  const { useFlowStore } = await load('stores/useFlowStore');
  const contracts = await load('studio/outputContracts');
  const formats = await load('studio/weightFormat');
  const exact = await load('studio/templateExactness');
  const auto = await load('studio/autoResource');
  const artifacts = await load('studio/artifactRequirements');
  const values = await load('studio/executionSpecValues');
  const { STUDIO_TEMPLATES } = await load('studio/templates');
  const { capability, spec } = selectedCase();
  const { loader } = await loaderFor(capability, spec);
  const unknown = await formFor(capability, {
    weightFormat: 'future-unsupported-format',
    prompt: 'Retain authored wording.',
    referenceImages: ['images/retained-unit-source.png'],
  });
  const nullForm = { ...unknown, prompt: 'Retain the other document.', weightFormat: null };
  // A saved manual graph contains authored values, not registry callbacks or
  // generated pipeline-identity signal values (durableFlowNodeSnapshot removes
  // those intentionally). Keep every authored field in this realistic fixture.
  const graphNode = {
    id: loader.id,
    type: loader.type,
    position: { x: 80, y: 120 },
    data: {
      module: loader.data.module,
      action: loader.data.action,
      type: loader.data.type,
      label: 'Retain authored model label',
      params: Object.fromEntries(
        ['model_type', 'repo_id', 'revision', 'weight_format'].map((key) => [
          key,
          {
            type: loader.data.params[key].type,
            label: loader.data.params[key].label,
            value:
              key === 'weight_format' ? 'future-unsupported-format' : structuredClone(loader.data.params[key].value),
          },
        ]),
      ),
    },
  };
  const snapshot = (form) => ({
    nodes: [graphNode],
    edges: [],
    viewport: { x: 10, y: 20, zoom: 1 },
    studioForm: form,
    selectedMode: form.mode,
    activeTemplateId: null,
    studioGraphBinding: null,
    sourceOutputId: null,
    pinnedGraphInputIds: [],
    autoFieldOverrides: {},
  });
  const tabs = [
    {
      id: 'blocked-saved',
      title: 'Saved authoring',
      intent: 'saved',
      dirty: false,
      source: 'manual',
      createdAt: 1,
      updatedAt: 2,
      backendRevision: 7,
      snapshot: snapshot(unknown),
    },
    {
      id: 'blocked-draft',
      title: 'Dirty authoring',
      intent: 'draft',
      dirty: true,
      source: 'manual',
      createdAt: 3,
      updatedAt: 4,
      snapshot: snapshot(nullForm),
    },
  ];
  const oldStudio = useStudioStore.getState(),
    oldFlow = useFlowStore.getState();
  const oldStorage = localStorage.getItem('modiff.studio'),
    oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error('hydration must not contact the backend');
  };
  try {
    localStorage.setItem(
      'modiff.studio',
      JSON.stringify({
        version: 0,
        state: {
          form: unknown,
          selectedMode: unknown.mode,
          activeWorkflowTabId: tabs[0].id,
          workflowTabs: tabs,
          savedSnippets: ['Keep this authored snippet.'],
          promptHistory: ['Keep this prompt.'],
        },
      }),
    );
    await useStudioStore.persist.rehydrate();
    assert.equal(useStudioStore.persist.hasHydrated(), true);
    const state = useStudioStore.getState();
    assert.equal(state.form.weightFormat, null);
    assert.equal(state.form.prompt, unknown.prompt);
    assert.deepEqual(state.form.referenceImages, unknown.referenceImages);
    assert.deepEqual(
      state.workflowTabs.map((tab) => [
        tab.id,
        tab.title,
        tab.intent,
        tab.dirty,
        tab.snapshot.studioForm.prompt,
        tab.snapshot.studioForm.weightFormat,
      ]),
      tabs.map((tab) => [tab.id, tab.title, tab.intent, tab.dirty, tab.snapshot.studioForm.prompt, null]),
    );
    assert.deepEqual(
      state.workflowTabs.map((tab) => tab.snapshot.nodes),
      tabs.map((tab) => tab.snapshot.nodes),
    );
    assert.deepEqual(
      state.workflowTabs.map((tab) => tab.snapshot.edges),
      [[], []],
    );
    assert.deepEqual(
      state.workflowTabs.map((tab) => tab.snapshot.viewport),
      tabs.map((tab) => tab.snapshot.viewport),
    );
    assert.deepEqual(
      state.workflowTabs.map((tab) => tab.snapshot.studioForm.referenceImages),
      [unknown.referenceImages, nullForm.referenceImages],
    );
    assert.deepEqual(useFlowStore.getState().nodes, [graphNode]);
    assert.deepEqual(state.savedSnippets, ['Keep this authored snippet.']);
    assert.deepEqual(state.promptHistory, ['Keep this prompt.']);
    const template = STUDIO_TEMPLATES.find((item) => item.id === 'qwen_low_vram_product_concept');
    assert.ok(template);
    const blockedTemplate = {
      ...template,
      example: { ...template.example, lockedSettings: { ...template.example.lockedSettings, weightFormat: null } },
    };
    assert.doesNotThrow(() => exact.getTemplateLockHash(blockedTemplate));
    assert.notEqual(
      exact.getPromptSettingsHash(state.form),
      exact.getPromptSettingsHash({ ...state.form, weightFormat: 'native' }),
    );
    assert.equal(
      exact.getTemplateModifiedFields(blockedTemplate, { ...state.form, weightFormat: null }).includes('weightFormat'),
      true,
    );
    assert.throws(
      () => values.resolveStudioExecutionSpecValues(state.form, spec, capability),
      /backend-declared weight format/,
    );
    const plan = { selectedCandidate: { id: 'legacy-native', installed: true }, candidates: [] };
    assert.equal(auto.selectedAutoCandidate(plan, state.form), null);
    assert.equal(auto.autoPlanIsReady(plan, state.form), false);
    assert.equal(auto.autoResourceInstallTarget(plan, state.form), null);
    const requirement = artifacts.getStudioWorkflowArtifactRequirements({
      form: state.form,
      hfCache: [],
      localModels: [],
      modelCacheDiagnostics: null,
    });
    assert.equal(requirement[0].primaryAction, 'Details');
    assert.equal(requirement[0].installTarget, undefined);
    await assert.rejects(auto.fetchAutoResourcePlan(state.form), /no backend Auto resource contract/);
    const output = contracts.coerceStudioOutput({
      id: 'blocked-output',
      url: '/source-metadata-only.png',
      formSnapshot: unknown,
      graphSnapshot: { nodes: [graphNode], edges: [] },
      promptSettingsHash: 'previous-native-proof',
      exactTemplateCompatible: true,
    });
    assert.ok(output);
    assert.equal(output.formSnapshot.weightFormat, null);
    assert.equal(output.promptSettingsHash, undefined);
    assert.equal(output.exactTemplateCompatible, false);
    assert.deepEqual(output.graphSnapshot.nodes, [graphNode]);
    assert.equal(requests, 0);
    useStudioStore.getState().updateForm({ weightFormat: 'native' });
    assert.equal(formats.studioWeightFormat(useStudioStore.getState().form.weightFormat), 'native');
    assert.equal(useStudioStore.getState().form.prompt, unknown.prompt);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = oldFetch;
    useFlowStore.setState(oldFlow, true);
    useStudioStore.setState(oldStudio, true);
    if (oldStorage === null) localStorage.removeItem('modiff.studio');
    else localStorage.setItem('modiff.studio', oldStorage);
  }
});
