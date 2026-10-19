import assert from 'node:assert/strict';
import { captureAudioSchemaFixture } from './audio-schema-fixture.mjs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
let fixture;
let server,
  nodes,
  contracts,
  catalog,
  authoring,
  starters,
  groups,
  adapters,
  policies,
  templates,
  builder,
  exactness,
  defaults,
  authority,
  projection,
  exporter,
  requiredInputs;
before(async () => {
  fixture = captureAudioSchemaFixture();
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { dispatchEvent: () => true, location: { origin: 'http://127.0.0.1:5191' }, localStorage };
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    cacheDir: path.join(here, 'vite-cache', 'authority'),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  nodes = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  contracts = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  catalog = await server.ssrLoadModule('/src/workflow/operationCatalog.ts');
  authoring = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  starters = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  adapters = await server.ssrLoadModule('/src/workflow/modelSetupAdapters.ts');
  policies = await server.ssrLoadModule('/src/studio/optionalRuntimes.ts');
  ({ STUDIO_TEMPLATES: templates } = await server.ssrLoadModule('/src/studio/templates.ts'));
  builder = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  ({ DEFAULT_STUDIO_FORM: defaults } = await server.ssrLoadModule('/src/studio/modelProfiles.ts'));
  projection = await server.ssrLoadModule('/src/workflow/visualOperationGroupProjection.ts');
  exporter = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  requiredInputs = await server.ssrLoadModule('/src/studio/requiredGraphInputs.ts');
  const publicPayload = fixture.publicPayload;
  const parsed = nodes.parseStudioModelCapabilities(publicPayload);
  const operationContracts = contracts.parseOperationContracts(
    publicPayload.operationContracts,
    publicPayload.operationContractSchemaVersion,
  );
  authority = {
    nodesRegistry: fixture.registry,
    studioModelCapabilities: parsed.capabilities,
    studioModelCapabilitiesAuthoritative: true,
    studioExecutionSpecInvalid: false,
    operationContracts,
    pipelineSupport: catalog.parsePipelineSupport(
      publicPayload.pipelineSupport,
      publicPayload.pipelineSupportSchemaVersion,
      operationContracts,
    ),
    discoveryRequests: { nodes: { status: 'success' }, capabilities: { status: 'success' } },
  };
});
after(async () => server?.close());

function actualStarter(row) {
  return starters.parseOperationStarter(
    row.starter,
    row.starter.pipelineClass,
    row.starter.task,
    authority.operationContracts,
    { executionProfileId: row.spec?.executionProfileId },
  );
}
function setup(row) {
  const graph = groups.groupNewOperationGraph(authoring.createOperationStarter(actualStarter(row), { x: 0, y: 0 }));
  const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
  return { graph, root, chain: adapters.modelSetupAdapterChain(graph, root.id) };
}
function pinned() {
  return {
    adapter_path: { source: 'hub', value: 'ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA' },
    revision: 'cb829a12775740c830a6d49795f16913065dc492',
    weight_name: 'adapter_model.safetensors',
    expected_sha256: '78650245c79cbfda7169eae34eb2ccb5f5e639b31a99da0a153a5bbd74194b0d',
    adapter_name: 'chinese_new_year',
    scale: 0.355,
    replace_existing: true,
  };
}

test('actual published audio policy parses without changing its false broad flag or image-only boundary', () => {
  const capability = authority.studioModelCapabilities.find((item) => item.modelType === 'AceStepAudioPipeline');
  assert.equal(capability.supportsLora, false);
  const profile = capability.executionProfiles.find((item) => item.id === 'ace-step-audio:direct');
  const actual = policies.parseAdapterAuthoringPolicy(
    profile.adapterAuthoring,
    profile.modes,
    profile.repository_revisions,
    profile,
  );
  assert.equal(actual.mediaKind, 'audio');
  assert.equal(actual.maxOwnedAdapters, 1);
  assert.deepEqual(actual.repositoryRevisions, profile.repository_revisions);
  assert.throws(() =>
    policies.parseImageAdapterAuthoringPolicy(actual, profile.modes, profile.repository_revisions, profile),
  );
  for (const mutate of [
    (policy) => {
      policy.maxOwnedAdapters = 2;
    },
    (policy) => {
      policy.maxOwnedAdapters = '1';
    },
    (policy) => {
      policy.mediaKind = 'image';
    },
    (policy) => {
      policy.mediaKind = ['image'];
    },
    (policy) => {
      policy.mediaKind = ['audio'];
    },
    (policy) => {
      policy.mediaKind = {};
    },
    (policy) => {
      policy.mediaKind = true;
    },
    (policy) => {
      policy.adapterNodeKey = 'modules.DiffusersImage.LoadAdapter';
    },
    (policy) => {
      policy.tasks = ['text_to_image'];
    },
    (policy) => {
      policy.repositoryRevisions[0].revision = 'main';
    },
    (policy) => {
      policy.extra = true;
    },
    (policy) => {
      policy.repositoryRevisions.push({ ...policy.repositoryRevisions[0] });
    },
  ]) {
    const bad = structuredClone(actual);
    mutate(bad);
    assert.throws(() =>
      policies.parseAdapterAuthoringPolicy(bad, profile.modes, profile.repository_revisions, profile),
    );
  }
  for (const context of [
    undefined,
    { ...profile, loader_module: 'modules.DiffusersImage' },
    { ...profile, loader_action: 'ModelsLoader' },
    { ...profile, execution_path: 'direct-diffusers-image' },
  ])
    assert.throws(() =>
      policies.parseAdapterAuthoringPolicy(actual, profile.modes, profile.repository_revisions, context),
    );
});

test('actual selected audio tasks and both own repositories authorize one populated row and safe recovery', async (t) => {
  for (const row of fixture.recipes.filter((item) => item.starter.pipelineClass === 'AceStepPipeline'))
    await t.test(row.id, () => {
      const { graph, root, chain } = setup(row);
      assert.equal(adapters.modelSetupAdapterAddUnavailable(chain, authority), null);
      const next = adapters.planModelSetupAdapterEdit(
        graph,
        root.id,
        { kind: 'add', values: pinned(), registry: authority.nodesRegistry },
        authority,
      );
      const added = adapters.modelSetupAdapterChain(next, root.id);
      assert.equal(added.adapters.length, 1);
      assert.equal(added.adapters[0].data.module, 'modules.DiffusersAudio');
      assert.equal(added.adapters[0].data.params.scale.value, 0.355);
      assert.equal(adapters.modelSetupAdapterEditUnavailable(added, authority), null);
      assert.match(adapters.modelSetupAdapterAddUnavailable(added, authority), /at most 1/);
      const before = structuredClone(next);
      assert.throws(
        () =>
          adapters.planModelSetupAdapterEdit(
            next,
            root.id,
            { kind: 'add', values: pinned(), registry: authority.nodesRegistry },
            authority,
          ),
        /at most 1/,
      );
      assert.deepEqual(next, before);
      const withdrawn = structuredClone(authority);
      delete withdrawn.studioModelCapabilities.find((item) => item.modelType === 'AceStepAudioPipeline')
        .executionProfiles[0].adapterAuthoring;
      assert.match(adapters.modelSetupAdapterEditUnavailable(added, withdrawn), /no reviewed/);
      const removed = adapters.planModelSetupAdapterEdit(
        next,
        root.id,
        { kind: 'remove', nodeId: added.adapters[0].id },
        withdrawn,
      );
      const restored = adapters.modelSetupAdapterChain(removed, root.id);
      assert.equal(restored.adapters.length, 0);
      assert.equal(restored.tail.length, 1);
      const edge = restored.unpacked.graph.edges.find(
        (edge) => edge.source === restored.owner.id && edge.sourceHandle === 'pipeline',
      );
      assert.equal(edge.target, restored.tail[0].target);
    });
});

test('audio Add refuses stale, connected, foreign, ambiguous or withdrawn selected authority unchanged', () => {
  const row = fixture.recipes.find((item) => item.id === 'ace:Runware:text_to_audio');
  for (const mutate of [
    ({ chain }) => {
      chain.owner.data.params.revision.value = 'a'.repeat(40);
    },
    ({ chain }) => {
      chain.owner.data.params.model_id.value = { source: 'hub', value: 'foreign/model' };
    },
    ({ chain }) => {
      chain.owner.data.params.mode.value = 'audio_repaint';
    },
    ({ chain }) => {
      chain.owner.data.params.pipeline.signal.value.repository = 'ACE-Step/acestep-v15-xl-turbo-diffusers';
    },
    ({ chain }) => {
      chain.owner.data.params.pipeline.signal.value = '';
    },
    ({ chain }) => {
      chain.unpacked.graph.edges.push({
        id: 'connected-mode',
        source: 'unknown',
        sourceHandle: 'value',
        target: chain.owner.id,
        targetHandle: 'mode',
      });
    },
    ({ current }) => {
      current.studioModelCapabilitiesAuthoritative = false;
    },
    ({ current }) => {
      current.discoveryRequests.nodes.status = 'loading';
    },
    ({ current }) => {
      current.nodesRegistry['modules.DiffusersAudio.LoadAdapter'].params.pipeline.onSignal.target = 'foreign';
    },
    ({ current }) => {
      delete current.nodesRegistry['modules.DiffusersAudio.LoadAdapter'].params.pipeline.onSignal;
    },
    ({ current }) => {
      current.nodesRegistry['modules.DiffusersAudio.LoadAdapter'].params.pipeline.signalCompatibility.required = false;
    },
    ({ current }) => {
      current.nodesRegistry['modules.DiffusersAudio.LoadAdapter'].params.output.signal.origin = 'foreign';
    },
    ({ current }) => {
      current.nodesRegistry['modules.DiffusersAudio.LoadAdapter'].params.output.signal.direction = 'input';
    },
    ({ current }) => {
      current.operationContracts.push(
        structuredClone(
          current.operationContracts.find(
            (op) =>
              op.pipelineClass === 'AceStepPipeline' && op.task === 'text_to_audio' && op.decomposition === 'loader',
          ),
        ),
      );
    },
    ({ current }) => {
      const cap = current.studioModelCapabilities.find((item) => item.modelType === 'AceStepAudioPipeline');
      cap.executionProfiles.push(structuredClone(cap.executionProfiles[0]));
    },
    ({ current }) => {
      delete current.studioModelCapabilities.find((item) => item.modelType === 'AceStepAudioPipeline')
        .executionProfiles[0].adapterAuthoring;
    },
  ]) {
    const { graph, root, chain } = setup(row);
    const current = structuredClone(authority);
    mutate({ graph, root, chain, current });
    const before = structuredClone(graph);
    assert.equal(typeof adapters.modelSetupAdapterAddUnavailable(chain, current), 'string');
    assert.deepEqual(graph, before);
  }
});

test('all seven actual curated audio factories preserve original creative settings and selected model pins', () => {
  const audio = templates.filter(
    (item) => item.executionSelection && item.example?.mediaType === 'audio' && !item.outputKinds?.includes('video'),
  );
  assert.equal(audio.length, 7);
  for (const template of audio) {
    const selection = template.executionSelection;
    const repository = template.workflowBlockSettings?.lora?.baseModel?.value;
    const row = fixture.recipes.find(
      (item) =>
        item.starter.pipelineClass === selection.pipelineClass &&
        item.starter.task === selection.task &&
        (!repository ||
          item.starter.nodes.find((item) => item.operation.decomposition === 'loader').node.params.model_id?.value
            ?.value === repository),
    );
    assert.ok(row, template.id);
    const capability = authority.studioModelCapabilities.find((item) => item.modelType === template.modelType);
    const spec = capability.studioExecutionSpecs.find((item) => item.mode === template.mode);
    const form = {
      ...defaults,
      ...exactness.getTemplateLockedSettings(template),
      device: 'cpu:0',
      offloadMode: 'none',
      autoOffload: false,
      sourceAudio: 'source.wav',
      referenceAudio: 'reference.wav',
    };
    const graph = builder.createTemplateOperationGraph(
      template,
      form,
      actualStarter(row),
      fixture.registry,
      spec,
      capability,
      authority,
    );
    const flat = groups.unpackVisualOperationGroups(graph).graph;
    const owner = flat.nodes.find((node) => node.data.operationAuthoring?.operation.decomposition === 'loader');
    assert.equal(
      owner.data.params.revision.value,
      repository
        ? 'be23effe449c5957947f3020fd63bee23c64abe4'
        : selection.pipelineClass === 'AceStepPipeline'
          ? '200ba991ae448051e14b0183157e35c2d27c9fb0'
          : template.example.modelRevision,
    );
    const generator = flat.nodes.find(
      (node) => node.data.action === 'Generate' || node.data.action === 'WorkflowSemanticGeneration',
    );
    const prompt = generator.data.params.prompt;
    assert.equal(prompt.value, form.prompt, template.id);
    if (selection.pipelineClass === 'AceStepPipeline') {
      assert.deepEqual(generator.data.params.seed.value, { value: form.seed, isRandom: false });
      assert.equal(
        flat.nodes.filter((node) => node.data.action === 'LoadAdapter').length,
        template.workflowBlocks?.includes('lora') ? 1 : 0,
      );
      assert.ok(!flat.nodes.some((node) => ['EncodeInputs', 'Denoise', 'DecodeLatents'].includes(node.data.action)));
    } else assert.equal(graph.nodes.filter((node) => groups.visualOperationGroup(node) === 'output').length, 1);
  }
});

function actualGraph(row) {
  const graph = authoring.createOperationStarter(structuredClone(row.starter), { x: 0, y: 0 });
  // The metadata interpreter publishes CPU, while starter placement defaults may
  // target an accelerator. Select the genuine NONE CPU controls explicitly for
  // this authoring-only export comparison, before recording either graph.
  for (const node of graph.nodes) {
    if (
      node.data.params.device &&
      String(node.data.params.device.value ?? node.data.params.device.default).startsWith('cpu')
    ) {
      if (node.data.params.offload_mode) node.data.params.offload_mode.value = 'none';
      if (node.data.params.auto_offload) node.data.params.auto_offload.value = false;
    }
  }
  const definition = structuredClone(fixture.registry['modules.Audio.Export']);
  graph.nodes.push({ id: 'audio-export', type: 'custom', position: { x: 1800, y: 0 }, data: definition });
  const source = graph.nodes.filter(
    (node) =>
      node.id !== 'audio-export' &&
      Object.values(node.data.params).some((field) => field.display === 'output' && field.type === 'audio'),
  );
  assert.equal(source.length, 1, 'actual starter has one declared final audio producer');
  const port = Object.entries(source[0].data.params).find(
    ([, field]) => field.display === 'output' && field.type === 'audio',
  )[0];
  graph.edges.push({
    id: 'audio-export-wire',
    source: source[0].id,
    sourceHandle: port,
    target: 'audio-export',
    targetHandle: 'audio',
  });
  return graph;
}

function api(graph) {
  const exported = exporter.useFlowStore
    .getState()
    .exportGraph('audio-contract', undefined, { sourceGraph: graph, randomizeSeeds: false });
  const names = new Map(Object.entries(exported.nodes).map(([id, node]) => [id, `${node.module}.${node.action}`]));
  assert.equal(new Set(names.values()).size, names.size, 'this bounded fixture has unique action identities');
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          key === 'sourceId' ? (names.get(item) ?? item) : normalize(item),
        ]),
      );
    return value;
  };
  return {
    nodes: Object.fromEntries(
      [...names].map(([id, name]) => [name, normalize(exported.nodes[id])]).sort(([a], [b]) => a.localeCompare(b)),
    ),
    paths: exported.paths
      .map((route) => route.map((id) => names.get(id) ?? id))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

test('actual audio families group only their real execution stages', async (t) => {
  for (const row of fixture.recipes)
    await t.test(row.id, () => {
      const original = actualGraph(row);
      const before = structuredClone(original);
      const grouped = groups.groupNewOperationGraph(original);
      const setup = grouped.nodes.filter((node) => groups.visualOperationGroup(node) === 'setup');
      const output = grouped.nodes.filter((node) => groups.visualOperationGroup(node) === 'output');
      const native = row.starter.pipelineClass === 'MiniMaxMusic3ModularPipeline';
      assert.equal(setup.length, native ? 0 : 1);
      assert.equal(output.length, native ? 1 : 0);
      assert.ok(!grouped.nodes.some((node) => groups.visualOperationGroup(node) === 'guidance'));
      assert.ok(!grouped.nodes.some((node) => groups.visualOperationGroup(node) === 'inputs'));
      if (native) {
        assert.equal(output[0].data.label, 'Audio Output');
        assert.deepEqual(
          projection.visualStagePresentation('output', projection.visualOperationGroupMedia(output[0])),
          { label: 'Audio Output', name: 'audio output' },
        );
        const instance = output[0].data.blockInstanceV2;
        assert.equal(instance.effectiveGraph.nodes.length, 2);
        assert.equal(instance.previewStates.length, 1);
        assert.equal(instance.previewStates[0].binding.mediaType, 'audio');
        assert.equal(instance.previewStates[0].binding.outputPortId, 'preview');
        assert.equal(grouped.nodes.length, 4, 'real loader, semantic generation, denoise and audio output');
      } else
        assert.equal(
          grouped.nodes.length,
          original.nodes.length,
          'integrated Generate and Export remain ordinary nodes',
        );
      assert.deepEqual(original, before, 'presentation must not mutate the creator graph');
      assert.deepEqual(
        api(grouped),
        api(original),
        'ordinary exported graph and creative/media controls are preserved',
      );
      assert.deepEqual(api(groups.unpackVisualOperationGroups(grouped).graph), api(original));
    });
});

test('actual native audio output refuses an unrelated sink or missing preview binding', () => {
  const row = fixture.recipes.find((item) => item.starter.pipelineClass === 'MiniMaxMusic3ModularPipeline');
  for (const mutate of [
    (sink) => {
      sink.data.module = 'modules.Unreviewed';
    },
    (sink) => {
      sink.data.params.preview.display = 'ui_image';
    },
    (sink) => {
      sink.data.params.preview.dataSource = 'unrelated';
    },
    (sink) => {
      sink.data.params.file.type = 'image';
    },
  ]) {
    const original = actualGraph(row);
    mutate(original.nodes.find((node) => node.id === 'audio-export'));
    const before = structuredClone(original);
    const grouped = groups.groupNewOperationGraph(original);
    assert.ok(!grouped.nodes.some((node) => groups.visualOperationGroup(node) === 'output'));
    assert.deepEqual(original, before);
  }
});

test('audio output preview identity, custom title and current values survive explicit regrouping', () => {
  const row = fixture.recipes.find((item) => item.starter.pipelineClass === 'MiniMaxMusic3ModularPipeline');
  const original = actualGraph(row);
  const sink = original.nodes.find((node) => node.id === 'audio-export');
  sink.data.params.sample_rate.value = 44100;
  sink.data.params.preview.value = '@data/outputs/own-task.wav';
  const grouped = groups.groupNewOperationGraph(original);
  const root = grouped.nodes.find((node) => groups.visualOperationGroup(node) === 'output');
  const flat = groups.unpackVisualOperationGroups(grouped);
  const restored = groups.restoreVisualOperationGroups(flat.graph, flat);
  assert.deepEqual(api(restored), api(grouped));
  assert.equal(root.data.blockInstanceV2.previewStates[0].binding.mediaType, 'audio');
  assert.equal(projection.visualStagePresentation('output', null).label, 'Image Output');
});

function factory(template, current = authority) {
  const selection = template.executionSelection;
  const repository = template.workflowBlockSettings?.lora?.baseModel?.value;
  const row = fixture.recipes.find(
    (item) =>
      item.starter.pipelineClass === selection.pipelineClass &&
      item.starter.task === selection.task &&
      (!repository ||
        item.starter.nodes.find((item) => item.operation.decomposition === 'loader').node.params.model_id?.value
          ?.value === repository),
  );
  const capability = current.studioModelCapabilities.find((item) => item.modelType === template.modelType);
  const spec = capability.studioExecutionSpecs.find((item) => item.mode === template.mode);
  const form = {
    ...defaults,
    ...exactness.getTemplateLockedSettings(template),
    device: 'cpu:0',
    offloadMode: 'none',
    autoOffload: false,
    sourceAudio: 'source.wav',
    referenceAudio: 'reference.wav',
  };
  return builder.createTemplateOperationGraph(
    template,
    form,
    actualStarter(row),
    fixture.registry,
    spec,
    capability,
    current,
  );
}

test('audio replacement is atomic at capacity and rejects malformed populated selections', () => {
  const { graph, root } = setup(fixture.recipes.find((item) => item.id === 'ace:Runware:text_to_audio'));
  const populated = adapters.planModelSetupAdapterEdit(
    graph,
    root.id,
    { kind: 'add', values: pinned(), registry: authority.nodesRegistry },
    authority,
  );
  const chain = adapters.modelSetupAdapterChain(populated, root.id);
  const original = structuredClone(populated);
  const replaced = adapters.planModelSetupAdapterEdit(
    populated,
    root.id,
    {
      kind: 'replace',
      nodeId: chain.adapters[0].id,
      values: { ...pinned(), adapter_name: 'replacement', scale: 0.625 },
      registry: authority.nodesRegistry,
    },
    authority,
  );
  const replacement = adapters.modelSetupAdapterChain(replaced, root.id);
  assert.equal(replacement.adapters.length, 1);
  assert.equal(replacement.adapters[0].id, chain.adapters[0].id);
  assert.equal(replacement.adapters[0].data.params.adapter_name.value, 'replacement');
  assert.equal(replacement.adapters[0].data.params.scale.value, 0.625);
  const endpoints = (graph) =>
    graph.edges.map(({ source, sourceHandle, target, targetHandle }) => ({
      source,
      sourceHandle,
      target,
      targetHandle,
    }));
  assert.deepEqual(endpoints(replacement.unpacked.graph), endpoints(chain.unpacked.graph));
  assert.deepEqual(populated, original);
  for (const mutate of [
    (value) => {
      value.adapter_path.source = ['hub'];
    },
    (value) => {
      value.adapter_path.source = {};
    },
    (value) => {
      value.adapter_path.source = true;
    },
    (value) => {
      value.revision = 'main';
    },
    (value) => {
      value.expected_sha256 = '';
    },
    (value) => {
      value.weight_name = '../adapter.safetensors';
    },
  ]) {
    const values = pinned();
    mutate(values);
    assert.throws(() =>
      adapters.planModelSetupAdapterEdit(
        populated,
        root.id,
        { kind: 'replace', nodeId: chain.adapters[0].id, values, registry: authority.nodesRegistry },
        authority,
      ),
    );
    assert.deepEqual(populated, original);
  }
});

test('audio policy rejects non-data own fields before reading a getter', () => {
  const profile = authority.studioModelCapabilities.find((item) => item.modelType === 'AceStepAudioPipeline')
    .executionProfiles[0];
  let calls = 0;
  const getter = structuredClone(profile.adapterAuthoring);
  Object.defineProperty(getter, 'mediaKind', {
    enumerable: true,
    get() {
      calls++;
      return 'audio';
    },
  });
  const symbol = structuredClone(profile.adapterAuthoring);
  symbol[Symbol('foreign')] = true;
  const hidden = structuredClone(profile.adapterAuthoring);
  Object.defineProperty(hidden, 'extra', { value: true });
  for (const policy of [getter, symbol, hidden])
    assert.throws(() =>
      policies.parseAdapterAuthoringPolicy(policy, profile.modes, profile.repository_revisions, profile),
    );
  assert.equal(calls, 0);
});

test('a restrictive actual policy map refuses both manual Add and populated template insertion', () => {
  const current = structuredClone(authority);
  current.studioModelCapabilities.find(
    (item) => item.modelType === 'AceStepAudioPipeline',
  ).executionProfiles[0].adapterAuthoring.requiredControls = { offload_mode: 'group_disk' };
  const { graph, root, chain } = setup(fixture.recipes.find((item) => item.id === 'ace:Runware:text_to_audio'));
  const before = structuredClone(graph);
  assert.equal(typeof adapters.modelSetupAdapterAddUnavailable(chain, current), 'string');
  assert.throws(() =>
    adapters.planModelSetupAdapterEdit(
      graph,
      root.id,
      { kind: 'add', values: pinned(), registry: current.nodesRegistry },
      current,
    ),
  );
  assert.deepEqual(graph, before);
  assert.throws(() =>
    factory(
      templates.find((item) => item.id === 'ace_step_chinese_new_year_lora'),
      current,
    ),
  );
});

test('user-supplied blank audio adapter remains a required-input draft while tampered curated weights refuse', () => {
  const draft = structuredClone(templates.find((item) => item.id === 'ace_step_custom_lora'));
  draft.workflowBlockSettings.lora.model = { source: 'local', value: '' };
  const graph = factory(draft);
  const flat = groups.unpackVisualOperationGroups(graph).graph;
  const adapter = flat.nodes.find((node) => node.data.action === 'LoadAdapter');
  assert.deepEqual(adapter.data.params.adapter_path.value, { source: 'local', value: '' });
  const issues = requiredInputs.inspectRequiredGraphInputs(graph.nodes, flat, fixture.registry);
  assert.ok(
    issues.some(
      (issue) => issue.blocking && issue.code === 'required_graph_input_missing' && /LoRA/.test(issue.message),
    ),
  );
  const curated = templates.find((item) => item.id === 'ace_step_chinese_new_year_lora');
  assert.equal(curated.workflowBlockSettings.lora.model.byteSize, 88130280);
  for (const mutate of [
    (lora) => {
      lora.model.revision = 'main';
    },
    (lora) => {
      lora.model.sha256 = '';
    },
    (lora) => {
      lora.weightName = '../adapter.safetensors';
    },
    (lora) => {
      lora.model.source = ['hub'];
    },
  ]) {
    const bad = structuredClone(curated);
    mutate(bad.workflowBlockSettings.lora);
    assert.throws(() => factory(bad));
  }
});

test('audio output wording survives removed or mixed previews and custom titles', () => {
  const original = actualGraph(fixture.recipes.find((item) => item.id === 'minimax:text_to_audio'));
  const grouped = groups.groupNewOperationGraph(original);
  const output = grouped.nodes.find((node) => groups.visualOperationGroup(node) === 'output');
  output.data.label = 'My rendered song';
  const instance = output.data.blockInstanceV2;
  instance.definitionSnapshot.previews = [];
  instance.previewStates = [];
  assert.equal(projection.visualOperationGroupMedia(output), 'audio');
  assert.deepEqual(projection.visualStagePresentation('output', projection.visualOperationGroupMedia(output)), {
    label: 'Audio Output',
    name: 'audio output',
  });
  instance.definitionSnapshot.previews.push({
    nodeId: 'custom-preview',
    outputPortId: 'image',
    mediaType: 'image',
    label: 'Artwork',
  });
  assert.equal(projection.visualOperationGroupMedia(output), 'audio');
  assert.equal(output.data.label, 'My rendered song');
});

test('required model selectors distinguish blank drafts, populated values, declared connections and optional absence', () => {
  const registered = {
    type: 'custom',
    module: 'modules.Future',
    action: 'SelectModel',
    label: 'Model',
    category: 'Test',
    params: { model: { label: 'Model', display: 'modelselect', type: 'string', required: true } },
  };
  const node = { id: 'model', type: 'custom', position: { x: 0, y: 0 }, data: structuredClone(registered) };
  const registry = { 'modules.Future.SelectModel': registered };
  const graph = { nodes: [node], edges: [] };
  const inspect = () => requiredInputs.inspectRequiredGraphInputs(graph.nodes, graph, registry);
  for (const value of [
    '',
    '   ',
    { source: 'local', value: '' },
    { source: 'hub', value: '' },
    { source: 'local', value: '   ' },
  ]) {
    node.data.params.model.value = value;
    assert.equal(inspect().length, 1);
  }
  for (const value of ['path/to/weights', { source: 'local', value: 'path/to/weights' }]) {
    node.data.params.model.value = value;
    assert.deepEqual(inspect(), []);
  }
  delete node.data.params.model.value;
  const source = {
    id: 'text',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { ...registered, action: 'Text', params: { text: { type: 'string', display: 'output' } } },
  };
  graph.nodes.push(source);
  graph.edges.push({
    id: 'model-input',
    source: source.id,
    sourceHandle: 'text',
    target: node.id,
    targetHandle: 'model',
  });
  assert.deepEqual(inspect(), []);
  source.data.params.text.type = 'image';
  assert.equal(inspect().length, 1);
  graph.edges = [];
  registered.params.model.required = false;
  assert.deepEqual(inspect(), []);
});

test('audio Replace preserves a custom row and a connected unchanged strength', () => {
  const { graph, root } = setup(fixture.recipes.find((item) => item.id === 'ace:Runware:text_to_audio'));
  const populated = adapters.planModelSetupAdapterEdit(
    graph,
    root.id,
    { kind: 'add', values: pinned(), registry: authority.nodesRegistry },
    authority,
  );
  const chain = adapters.modelSetupAdapterChain(populated, root.id);
  const row = chain.adapters[0];
  row.data.label = 'My audio style';
  row.data.style = { width: 432 };
  row.data.uiState = { collapsed: true };
  chain.unpacked.graph.nodes.push({
    id: 'strength-source',
    type: 'custom',
    position: { x: 0, y: 700 },
    data: {
      type: 'custom',
      module: 'modules.Future',
      action: 'Strength',
      category: 'Test',
      label: 'Strength',
      params: { value: { type: 'float', display: 'output', value: 0.355 } },
    },
  });
  chain.unpacked.graph.edges.push({
    id: 'strength-edge',
    source: 'strength-source',
    sourceHandle: 'value',
    target: row.id,
    targetHandle: 'scale',
  });
  const presented = groups.restoreVisualOperationGroups(chain.unpacked.graph, chain.unpacked);
  const before = structuredClone(presented);
  const current = adapters.modelSetupAdapterChain(presented, root.id);
  const replaced = adapters.planModelSetupAdapterEdit(
    presented,
    root.id,
    {
      kind: 'replace',
      nodeId: current.adapters[0].id,
      values: { ...pinned(), adapter_name: 'new_name' },
      registry: authority.nodesRegistry,
    },
    authority,
  );
  const after = adapters.modelSetupAdapterChain(replaced, root.id);
  assert.equal(after.adapters[0].data.label, 'My audio style');
  assert.deepEqual(after.adapters[0].data.style, current.adapters[0].data.style);
  assert.deepEqual(after.adapters[0].data.uiState, current.adapters[0].data.uiState);
  assert.equal(after.adapters[0].data.params.scale.value, 0.355);
  assert.ok(
    after.unpacked.graph.edges.some(
      (edge) =>
        edge.source === 'strength-source' && edge.target === after.adapters[0].id && edge.targetHandle === 'scale',
    ),
  );
  assert.throws(() =>
    adapters.planModelSetupAdapterEdit(
      presented,
      root.id,
      {
        kind: 'replace',
        nodeId: current.adapters[0].id,
        values: { ...pinned(), scale: 0.5 },
        registry: authority.nodesRegistry,
      },
      authority,
    ),
  );
  assert.deepEqual(presented, before);
});

test('ordinary audio template hydration retains provenance and real stages without managed recovery', async (t) => {
  const studio = (await server.ssrLoadModule('/src/stores/useStudioStore.ts')).useStudioStore;
  const flow = exporter.useFlowStore;
  for (const id of ['ace_step_text_to_audio', 'minimax_music3_chamber_pop'])
    await t.test(id, () => {
      const previous = [studio.getState(), flow.getState()];
      try {
        const template = templates.find((item) => item.id === id);
        assert.ok(template, id);
        const selection = template.executionSelection;
        const row = fixture.recipes.find(
          (item) => item.starter.pipelineClass === selection.pipelineClass && item.starter.task === selection.task,
        );
        const capability = authority.studioModelCapabilities.find((item) => item.modelType === template.modelType);
        const spec = capability.studioExecutionSpecs.find((item) => item.mode === template.mode);
        const form = {
          ...defaults,
          ...exactness.getTemplateLockedSettings(template),
          mode: template.mode,
          modelType: template.modelType,
          device: 'cpu:0',
          offloadMode: 'none',
          autoOffload: false,
        };
        const graph = builder.createTemplateOperationGraph(
          template,
          form,
          actualStarter(row),
          fixture.registry,
          spec,
          capability,
          authority,
        );
        flow.getState().replaceGraph(graph);
        const persistedGraph = flow.getState().toObject();
        const expectedApi = api(persistedGraph);
        const tabId = `restored-${id}`;
        const record = {
          id: tabId,
          title: template.label,
          source: 'template',
          sourceLabel: id,
          revision: 1,
          snapshot: {
            ...persistedGraph,
            // A stale Creator form is advisory for this ordinary saved graph.
            studioForm: { ...form, device: 'cuda:0', offloadMode: 'model_cpu', autoOffload: true },
            selectedMode: template.mode,
            activeTemplateId: id,
            studioGraphBinding: null,
            sourceOutputId: null,
          },
        };
        studio.setState({ workflowTabs: [], activeWorkflowTabId: tabId, workflowCanvasHydrated: true });
        studio.getState().mergeBackendWorkflow(record);
        assert.equal(studio.getState().graphBinding, null);
        assert.equal(studio.getState().activeTemplateId, id);
        const restored = studio.getState().workflowTabs.find((tab) => tab.id === tabId);
        assert.equal(restored.source, 'template');
        assert.equal(restored.sourceLabel, id);
        assert.deepEqual(
          JSON.parse(JSON.stringify(flow.getState().nodes)),
          JSON.parse(JSON.stringify(persistedGraph.nodes)),
          'persisted graph metadata and ownership survive the real JSON transport',
        );
        assert.deepEqual(api(flow.getState().toObject()), expectedApi);
      } finally {
        studio.setState(previous[0]);
        flow.setState(previous[1]);
      }
    });
});
