import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server,
  adapters,
  groups,
  fixture,
  authority,
  cases,
  flowStore,
  runtimeProfiles,
  studioStore,
  transactions,
  captureContext;
const integratedImageStageIds = [
  'flux_fill_inpaint',
  'flux_control_canny',
  'flux_fill_outpaint',
  'flux_depth_control',
  'flux_redux_edit',
  'flux_redux_multi_reference',
];
const curatedFluxIds = [
  'flux_lora_cinematic_octane_3d',
  'flux_lora_ghibli_story',
  'flux_lora_oil_painting',
  'flux_lora_film_noir',
  'flux_lora_retro_comic',
  'flux_lora_watercolor',
  'flux_lora_paper_cutout',
  'flux_lora_photoreal_documentary',
];
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { dispatchEvent: () => true, location: { origin: 'http://127.0.0.1:5191' }, localStorage };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  adapters = await server.ssrLoadModule('/src/workflow/modelSetupAdapters.ts');
  runtimeProfiles = await server.ssrLoadModule('/src/studio/optionalRuntimes.ts');
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const { STUDIO_TEMPLATES } = await server.ssrLoadModule('/src/studio/templates.ts');
  const { DEFAULT_STUDIO_FORM } = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  const { getTemplateLockedSettings } = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  const { createTemplateOperationGraph } = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  const { createOperationStarter } = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  const { parseOperationStarter } = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  const { parseOperationContracts } = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  const { parsePipelineSupport } = await server.ssrLoadModule('/src/workflow/operationCatalog.ts');
  const { parseStudioModelCapabilities } = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  const { useNodesStore } = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  ({ useFlowStore: flowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  ({ useStudioStore: studioStore, captureWorkflowOperationContext: captureContext } = await server.ssrLoadModule(
    '/src/stores/useStudioStore.ts',
  ));
  transactions = await server.ssrLoadModule('/src/workflow/operationGraphTransaction.ts');
  const ids = [
    'z_image_quick_concept',
    'flux_schnell_text_to_image',
    'flux_krea_text_to_image',
    ...editPolicySelections.map((selection) => selection.id),
    'qwen_text_rendering',
    'cosmos3_super_text_to_image',
    ...integratedImageStageIds,
    'qwen_outpaint_draft',
    ...curatedFluxIds,
  ];
  const templates = ids.map((id) => {
    const template = STUDIO_TEMPLATES.find((item) => item.id === id);
    assert.ok(template?.executionSelection, id);
    return template;
  });
  const ddpm = {
    id: 'ddpm-negative',
    selection: {
      pipelineClass: 'DDPMPipeline',
      task: 'unconditional_image',
      executionProfileId: 'ddpm-cifar10:direct',
    },
  };
  const qwenDirect = {
    id: 'qwen-direct',
    selection: {
      pipelineClass: 'QwenImagePipeline',
      task: 'text_to_image',
      executionProfileId: 'qwen-image:t2i-direct',
    },
  };
  const backend = path.resolve('../MoDiff');
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: backend,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      input: JSON.stringify([
        ...templates.map((template) => ({ id: template.id, selection: template.executionSelection })),
        ddpm,
        qwenDirect,
        ...editControlSelections,
      ]),
    }),
  );
  const payload = fixture.publicPayload;
  const operations = parseOperationContracts(payload.operationContracts, payload.operationContractSchemaVersion);
  const parsed = parseStudioModelCapabilities(payload);
  authority = {
    nodesRegistry: fixture.registry,
    studioModelCapabilities: parsed.capabilities,
    studioModelCapabilitiesAuthoritative: parsed.authoritative,
    studioExecutionSpecInvalid: false,
    operationContracts: operations,
    pipelineSupport: parsePipelineSupport(payload.pipelineSupport, payload.pipelineSupportSchemaVersion, operations),
    discoveryRequests: { nodes: { status: 'success' }, capabilities: { status: 'success' } },
  };
  useNodesStore.setState({ nodesRegistry: fixture.registry });
  cases = new Map(
    fixture.recipes.map((row) => {
      const template = templates.find((item) => item.id === row.id);
      const selection =
        template?.executionSelection ??
        [ddpm, qwenDirect, ...editControlSelections].find((item) => item.id === row.id)?.selection;
      assert.ok(selection, row.id);
      const starter = parseOperationStarter(
        row.starter,
        selection.pipelineClass,
        selection.task,
        operations,
        selection,
      );
      const owner = row.starter.nodes.find((item) => item.operation.decomposition === 'loader').node;
      const graph = template
        ? createTemplateOperationGraph(
            template,
            {
              ...DEFAULT_STUDIO_FORM,
              ...getTemplateLockedSettings(template),
              ...(editPolicySelections.some((selection) => selection.id === template.id)
                ? {
                    referenceImages: Array.from(
                      { length: editPolicySelections.find((selection) => selection.id === template.id).referenceCount },
                      (_, index) => `@data/images/metadata-only-reference-${index + 1}.png`,
                    ),
                  }
                : {}),
              ...(integratedImageStageIds.includes(template.id)
                ? {
                    referenceImages: ['@data/images/stage-source.png', '@data/images/stage-reference.png'],
                    maskImage: '@data/images/stage-mask.png',
                    controlImage: '@data/images/stage-control.png',
                  }
                : {}),
              device: owner.params.device.value ?? owner.params.device.default,
              autoOffload: false,
              offloadMode: 'none',
            },
            starter,
            fixture.registry,
            row.spec,
            parsed.capabilities.find((item) => item.modelType === template.modelType),
          )
        : groups.groupNewOperationGraph(createOperationStarter(starter, { x: 0, y: 0 }));
      const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
      assert.ok(root, row.id);
      return [row.id, { graph, root }];
    }),
  );
});

test('all eight curated FLUX templates retain their original adapters while the exact selected policy authorizes editing', async (t) => {
  const capability = authority.studioModelCapabilities.find((item) => item.modelType === 'FluxModularPipeline');
  assert.equal(capability.supportsLora, false, 'The selected policy must not promote aggregate capability flags.');
  const profile = capability.executionProfiles.find((item) => item.id === 'flux-dev:modular');
  assert.equal(profile.adapterAuthoring.maxOwnedAdapters, 32);
  for (const id of curatedFluxIds)
    await t.test(id, () => {
      const { graph, root } = cases.get(id);
      const original = structuredClone(graph);
      const chain = adapters.modelSetupAdapterChain(graph, root.id);
      assert.equal(adapters.modelSetupAdapterAddUnavailable(chain, authority), null);
      assert.equal(adapters.modelSetupAdapterEditUnavailable(chain, authority), null);
      assert.equal(chain.adapters.length, id === curatedFluxIds[0] ? 2 : 1);
      assert.deepEqual(graph.nodes.map((node) => node.data.label).sort(), [
        'Denoise',
        'Encode Inputs',
        'Image Output',
        'Model Setup',
      ]);
      const next = add(graph, root);
      const changed = adapters.modelSetupAdapterChain(next, root.id);
      assert.deepEqual(
        changed.adapters.slice(0, -1).map((node) => node.data.params),
        chain.adapters.map((node) => node.data.params),
      );
      assert.deepEqual(changed.owner.data.params, chain.owner.data.params);
      const restored = adapters.planModelSetupAdapterEdit(next, root.id, {
        kind: 'remove',
        nodeId: changed.adapters.at(-1).id,
      });
      const exportApi = (sourceGraph) =>
        flowStore.getState().exportGraph('metadata-curated-policy', undefined, { sourceGraph, randomizeSeeds: false });
      assert.deepEqual(
        exportApi(restored),
        exportApi(graph),
        'Remove restores all original executable values and leaf wires.',
      );
      assert.deepEqual(graph, original);
    });
});
after(async () => server?.close());

const add = (graph, root, metadata = authority, values = {}) => {
  const chain = adapters.modelSetupAdapterChain(graph, root.id);
  return adapters.planModelSetupAdapterEdit(
    graph,
    root.id,
    {
      kind: 'add',
      registry: metadata?.nodesRegistry ?? fixture.registry,
      values: {
        [chain.native ? 'model' : 'adapter_path']: { source: 'local', value: 'metadata-only.safetensors' },
        ...(!chain.native ? { replace_existing: false } : {}),
        ...values,
      },
    },
    metadata,
  );
};

const selectedFluxProfile = () =>
  authority.studioModelCapabilities
    .flatMap((item) => item.executionProfiles ?? [])
    .find((item) => item.id === 'flux-dev:modular');
const aliasSelections = [
  { id: 'flux_schnell_text_to_image', profileId: 'flux-schnell:modular', embeddedGuidance: 0, guiderEnabled: false },
  { id: 'flux_krea_text_to_image', profileId: 'flux-krea:modular', embeddedGuidance: 3.5, guiderEnabled: true },
];
test('actual selected alias policies authorize their own native image adapter Add', async (t) => {
  for (const { id, profileId, embeddedGuidance, guiderEnabled } of aliasSelections)
    await t.test(id, () => {
      const { graph, root } = cases.get(id);
      const before = structuredClone(graph);
      const next = add(add(graph, root, authority, { scale: '0.8' }), root, authority, { scale: '0.35' });
      const { profile, policy } = publishedAliasPolicy(profileId);
      const chain = adapters.modelSetupAdapterChain(next, root.id);
      assert.equal(chain.adapters.length, 2);
      assert.equal(chain.owner.data.params.model_type.value, profile.pipeline_class);
      assert.deepEqual(chain.owner.data.params.repo_id.value, { source: 'hub', value: profile.default_repo });
      assert.ok(
        policy.repositoryRevisions.some(
          (pair) => pair.repo === profile.default_repo && pair.revision === chain.owner.data.params.revision.value,
        ),
        'The current selected owner must match its own actual reviewed pair.',
      );
      assert.deepEqual(policy.tasks, ['text_to_image']);
      assert.equal(policy.maxOwnedAdapters, 32);
      assert.equal(adapters.modelSetupAdapterEditUnavailable(chain, authority), null);
      assert.equal(adapters.modelSetupAdapterAddUnavailable(chain, authority), null);
      assert.deepEqual(chain.owner.data.params, adapters.modelSetupAdapterChain(graph, root.id).owner.data.params);
      const flat = groups.unpackVisualOperationGroups(next).graph;
      const guider = flat.nodes.find((node) => node.data.action === 'Guider');
      assert.equal(guider.data.params.enabled.value, guiderEnabled);
      assert.equal(guider.data.params.use_original_formulation.value, false);
      assert.equal(
        flat.nodes.find((node) => node.data.action === 'Denoise').data.params.guidance_scale.value,
        embeddedGuidance,
      );
      assert.equal(
        authority.studioModelCapabilities.find((item) => item.modelType === profile.pipeline_class).supportsLora,
        false,
        'Authoring permission must not promote canonical runtime capability.',
      );
      const moved = adapters.planModelSetupAdapterEdit(
        next,
        root.id,
        { kind: 'move', nodeId: chain.adapters[1].id, offset: -1 },
        authority,
      );
      assert.deepEqual(
        adapters.modelSetupAdapterChain(moved, root.id).adapters.map((node) => node.data.params.scale.value),
        ['0.35', '0.8'],
      );
      let removed = moved;
      for (const adapter of adapters.modelSetupAdapterChain(moved, root.id).adapters)
        removed = adapters.planModelSetupAdapterEdit(removed, root.id, { kind: 'remove', nodeId: adapter.id });
      const exportApi = (sourceGraph) =>
        flowStore
          .getState()
          .exportGraph('metadata-own-alias-policy', undefined, { sourceGraph, randomizeSeeds: false });
      assert.deepEqual(
        exportApi(removed),
        exportApi(graph),
        'Removing owned rows restores all creator values and wires.',
      );
      assert.deepEqual(graph, before);
    });
});
const publishedAliasPolicy = (profileId) => {
  const matches = authority.studioModelCapabilities
    .flatMap((item) => item.executionProfiles ?? [])
    .filter((item) => item.id === profileId);
  assert.equal(matches.length, 1, 'The selected alias profile must have unique actual publication.');
  const profile = matches[0];
  assert.ok(
    Object.hasOwn(profile, 'adapterAuthoring'),
    'Permission must come from the actual selected backend profile.',
  );
  const policy = runtimeProfiles.parseImageAdapterAuthoringPolicy(
    profile.adapterAuthoring,
    profile.modes,
    profile.repository_revisions,
    profile,
  );
  assert.deepEqual(policy, profile.adapterAuthoring);
  return { profile, policy };
};
const withPolicy = (id, policy, { omit = false, supportsLora } = {}) => ({
  ...authority,
  studioModelCapabilities: authority.studioModelCapabilities.map((item) => ({
    ...item,
    ...(supportsLora === undefined ? {} : { supportsLora }),
    executionProfiles: item.executionProfiles?.map((profile) => {
      if (profile.id !== id) return profile;
      const copy = structuredClone(profile);
      if (omit) delete copy.adapterAuthoring;
      else copy.adapterAuthoring = policy;
      return copy;
    }),
  })),
});

test('own alias policies reject borrowed, missing, stale and ambiguous metadata without graph mutation', async (t) => {
  for (const { id, profileId } of aliasSelections) {
    const { graph, root } = cases.get(id);
    const { policy } = publishedAliasPolicy(profileId);
    const foreignId = aliasSelections.find((item) => item.profileId !== profileId).profileId;
    const foreignPolicy = publishedAliasPolicy(foreignId).policy;
    const variants = {
      absent: () => withPolicy(profileId, undefined, { omit: true }),
      malformedPresent: () => withPolicy(profileId, { ...policy, maxOwnedAdapters: 0 }),
      borrowedDense: () => withPolicy(profileId, selectedFluxProfile().adapterAuthoring),
      borrowedAlias: () => withPolicy(profileId, foreignPolicy),
      wrongTask: () => withPolicy(profileId, { ...policy, tasks: ['image_to_image'] }),
      pending: () => ({
        ...authority,
        discoveryRequests: { ...authority.discoveryRequests, capabilities: { status: 'loading' } },
      }),
      staleOperations: () => ({ ...authority, operationContracts: [] }),
      staleSupport: () => ({ ...authority, pipelineSupport: [] }),
      ambiguousProfile: () => ({
        ...authority,
        studioModelCapabilities: authority.studioModelCapabilities.map((capability) => ({
          ...capability,
          executionProfiles: capability.executionProfiles?.flatMap((profile) =>
            profile.id === profileId ? [profile, structuredClone(profile)] : [profile],
          ),
        })),
      }),
    };
    for (const [name, metadata] of Object.entries(variants))
      await t.test(`${id}/${name}`, () => {
        const before = structuredClone(graph);
        assert.throws(() => add(graph, root, metadata()), /policy|LoRA|profile|capabilities/i);
        assert.deepEqual(graph, before);
      });
  }
});

test('own alias policies require literal current repository, immutable pin, workflow and task selectors', async (t) => {
  for (const { id, profileId } of aliasSelections) {
    const { graph, root } = cases.get(id);
    publishedAliasPolicy(profileId);
    for (const [field, selected] of [
      ['repo_id', { source: 'hub', value: 'black-forest-labs/FLUX.1-dev' }],
      ['revision', 'a'.repeat(40)],
      ['workflow_id', 'image_to_image'],
      ['model_type', 'UnknownPipeline'],
    ])
      await t.test(`${id}/changed ${field}`, () => {
        const unpacked = groups.unpackVisualOperationGroups(graph);
        const owner = adapters.modelSetupAdapterChain(graph, root.id).owner;
        unpacked.graph.nodes.find((node) => node.id === owner.id).data.params[field].value = selected;
        const changed = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
        const before = structuredClone(changed);
        assert.throws(() => add(changed, root), /policy|LoRA|profile|revision|selector/i);
        assert.deepEqual(changed, before);
      });
    for (const field of ['model_type', 'repo_id', 'revision', 'workflow_id'])
      await t.test(`${id}/connected ${field}`, () => {
        const unpacked = groups.unpackVisualOperationGroups(graph);
        const owner = adapters.modelSetupAdapterChain(graph, root.id).owner;
        unpacked.graph.nodes.push({
          id: `alias-supplier-${field}`,
          type: 'custom',
          position: { x: -400, y: 0 },
          data: {
            module: 'modules.Test',
            action: 'Selector',
            params: { output: { type: 'string', display: 'output' } },
          },
        });
        unpacked.graph.edges.push({
          id: `alias-selector-${field}`,
          source: `alias-supplier-${field}`,
          sourceHandle: 'output',
          target: owner.id,
          targetHandle: field,
        });
        const connected = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
        const before = structuredClone(connected);
        assert.throws(() => add(connected, root), /policy|LoRA|profile|selector|reviewed image model/i);
        assert.deepEqual(connected, before);
      });
  }
});

test('selected image adapter policies reject malformed keys, bounds, tasks and foreign immutable pairs', async (t) => {
  const profile = selectedFluxProfile();
  const policy = profile.adapterAuthoring;
  const parse = (value, selected = profile) =>
    runtimeProfiles.parseOptionalRuntimeExecutionProfiles(
      [{ ...structuredClone(selected), adapterAuthoring: value }],
      undefined,
      (mode) => selected.modes.includes(mode),
    )[0].adapterAuthoring;
  assert.deepEqual(parse(policy), policy, 'The positive policy is actual current backend publication.');
  const inherited = Object.create(policy);
  const variants = {
    undefined,
    null: null,
    array: [],
    empty: {},
    inherited,
    extra: { ...policy, grant: true },
    schema: { ...policy, schemaVersion: 2 },
    audio: { ...policy, mediaKind: 'audio' },
    node: { ...policy, adapterNodeKey: 'modules.DiffusersImage.LoadAdapter' },
    tasksEmpty: { ...policy, tasks: [] },
    tasksRepeated: { ...policy, tasks: ['text_to_image', 'text_to_image'] },
    taskForeign: { ...policy, tasks: ['edit_image'] },
    tasksOversized: { ...policy, tasks: Array(33).fill('text_to_image') },
    taskNonstring: { ...policy, tasks: [123] },
    maxZero: { ...policy, maxOwnedAdapters: 0 },
    maxLarge: { ...policy, maxOwnedAdapters: 33 },
    maxFraction: { ...policy, maxOwnedAdapters: 2.5 },
    maxString: { ...policy, maxOwnedAdapters: '32' },
    maxNonfinite: { ...policy, maxOwnedAdapters: Infinity },
    pairsEmpty: { ...policy, repositoryRevisions: [] },
    pairsNull: { ...policy, repositoryRevisions: null },
    pairsRepeated: { ...policy, repositoryRevisions: [...policy.repositoryRevisions, ...policy.repositoryRevisions] },
    pairsOversized: { ...policy, repositoryRevisions: Array(33).fill(policy.repositoryRevisions[0]) },
    pairExtra: { ...policy, repositoryRevisions: [{ ...policy.repositoryRevisions[0], permission: true }] },
    pairForeign: { ...policy, repositoryRevisions: [{ ...policy.repositoryRevisions[0], repo: 'foreign/model' }] },
    pairUnreviewed: {
      ...policy,
      repositoryRevisions: [{ ...policy.repositoryRevisions[0], revision: 'a'.repeat(40) }],
    },
    pairMutable: { ...policy, repositoryRevisions: [{ ...policy.repositoryRevisions[0], revision: 'main' }] },
    pairUppercase: {
      ...policy,
      repositoryRevisions: [
        { ...policy.repositoryRevisions[0], revision: policy.repositoryRevisions[0].revision.toUpperCase() },
      ],
    },
  };
  for (const [name, value] of Object.entries(variants))
    await t.test(name, () => {
      assert.throws(() => parse(value), /runtime contract/i);
      const { graph, root } = cases.get(curatedFluxIds[0]);
      const before = structuredClone(graph);
      assert.throws(
        () => add(graph, root, withPolicy(profile.id, value, { supportsLora: true })),
        /policy.*invalid/i,
        'A malformed present policy cannot fall back to broad true capability flags.',
      );
      assert.deepEqual(graph, before);
    });
  const foreignProfile = authority.studioModelCapabilities
    .flatMap((item) => item.executionProfiles ?? [])
    .find((item) => item.id === 'flux-schnell:modular');
  assert.throws(() => parse(policy, foreignProfile), /runtime contract/i);
  const { graph, root } = cases.get('flux_schnell_text_to_image');
  assert.throws(() => add(graph, root, withPolicy(foreignProfile.id, policy)), /policy|authorize/i);
});

test('selected policy removal retains false-flag fallback and cannot authorize another repository, revision or task', async (t) => {
  const profile = selectedFluxProfile();
  const { graph, root } = cases.get(curatedFluxIds[0]);
  assert.throws(() => add(graph, root, withPolicy(profile.id, undefined, { omit: true })), /does not support LoRA/);
  for (const [field, value] of [
    ['repo_id', { source: 'hub', value: 'black-forest-labs/FLUX.1-dev-fp8' }],
    ['repo_id', { source: 'hub', value: 'black-forest-labs/FLUX.1-Krea-dev' }],
    ['revision', 'a'.repeat(40)],
    ['workflow_id', 'image_to_image'],
  ])
    await t.test(`${field}:${JSON.stringify(value)}`, () => {
      const unpacked = groups.unpackVisualOperationGroups(graph);
      const owner = adapters.modelSetupAdapterChain(graph, root.id).owner;
      assert.ok(owner.data.params[field], 'The actual owner must declare this selector.');
      unpacked.graph.nodes.find((node) => node.id === owner.id).data.params[field].value = value;
      const changed = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
      const before = structuredClone(changed);
      assert.throws(() => add(changed, root), /profile|revision|policy|task|selector|LoRA/i);
      assert.deepEqual(changed, before);
    });
});

test('selected policy does not grant authoring through duplicated, stale or connected authority', async (t) => {
  const { graph, root } = cases.get(curatedFluxIds[0]);
  const variants = {
    duplicateCapability: {
      ...authority,
      studioModelCapabilities: [
        ...authority.studioModelCapabilities,
        structuredClone(authority.studioModelCapabilities.find((item) => item.modelType === 'FluxModularPipeline')),
      ],
    },
    duplicateProfile: {
      ...authority,
      studioModelCapabilities: authority.studioModelCapabilities.map((item) => ({
        ...item,
        executionProfiles: item.executionProfiles?.flatMap((profile) =>
          profile.id === selectedFluxProfile().id ? [profile, structuredClone(profile)] : [profile],
        ),
      })),
    },
    duplicateOperation: {
      ...authority,
      operationContracts: [
        ...authority.operationContracts,
        authority.operationContracts.find(
          (item) =>
            item.pipelineClass === 'FluxModularPipeline' && item.task === 'text_to_image' && item.nodeType === 'loader',
        ),
      ],
    },
    staleProfileTask: {
      ...authority,
      pipelineSupport: authority.pipelineSupport.map((item) => ({
        ...item,
        tasks: item.tasks.map((task) => ({
          ...task,
          executionProfileIds: task.executionProfileIds.filter((id) => id !== selectedFluxProfile().id),
        })),
      })),
    },
    pending: {
      ...authority,
      discoveryRequests: { ...authority.discoveryRequests, capabilities: { status: 'loading' } },
    },
  };
  for (const [name, metadata] of Object.entries(variants))
    await t.test(name, () => {
      const before = structuredClone(graph);
      assert.throws(() => add(graph, root, metadata), /profile|capabilities/i);
      assert.deepEqual(graph, before);
    });
  await t.test('connected workflow selector', () => {
    const unpacked = groups.unpackVisualOperationGroups(graph);
    const owner = adapters.modelSetupAdapterChain(graph, root.id).owner;
    unpacked.graph.nodes.push({
      id: 'external-workflow-selector',
      type: 'custom',
      position: { x: -500, y: 0 },
      data: { module: 'modules.Text', action: 'Text', params: { output: { type: 'string', display: 'output' } } },
    });
    unpacked.graph.edges.push({
      id: 'external-workflow-wire',
      source: 'external-workflow-selector',
      sourceHandle: 'output',
      target: owner.id,
      targetHandle: 'workflow_id',
    });
    const connected = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
    const before = structuredClone(connected);
    assert.throws(() => add(connected, root), /policy|selector|task/i);
    assert.deepEqual(connected, before);
  });
});

test('a full selected 32-adapter setup supports Move and persisted export but refuses a 33rd draft or commit', () => {
  const { graph, root } = cases.get(curatedFluxIds[1]);
  let full = graph;
  while (adapters.modelSetupAdapterChain(full, root.id).adapters.length < 32) full = add(full, root);
  const original = structuredClone(full);
  const chain = adapters.modelSetupAdapterChain(full, root.id);
  assert.equal(adapters.modelSetupAdapterEditUnavailable(chain, authority), null);
  assert.match(adapters.modelSetupAdapterAddUnavailable(chain, authority), /at most 32/);
  assert.throws(() => add(full, root), /at most 32/);
  assert.deepEqual(full, original);
  const moved = adapters.planModelSetupAdapterEdit(
    full,
    root.id,
    { kind: 'move', nodeId: chain.adapters[31].id, offset: -1 },
    authority,
  );
  const order = chain.adapters.map((node) => node.id);
  [order[30], order[31]] = [order[31], order[30]];
  assert.deepEqual(
    adapters.modelSetupAdapterChain(moved, root.id).adapters.map((node) => node.id),
    order,
  );
  const savedId = studioStore.getState().createWorkflowTab('32 selected adapters', {
    nodes: full.nodes,
    edges: full.edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  flowStore.getState().resetHistory();
  const current = flowStore.getState().toObject();
  const committedMove = adapters.planModelSetupAdapterEdit(
    current,
    root.id,
    { kind: 'move', nodeId: chain.adapters[31].id, offset: -1 },
    authority,
  );
  transactions.commitOperationGraph(
    committedMove,
    captureContext(),
    transactions.operationGraphSignature(current),
    'move model adapter',
  );
  assert.equal(flowStore.getState().historyPast.length, 1);
  flowStore.getState().undo();
  assert.deepEqual(
    adapters.modelSetupAdapterChain(flowStore.getState().toObject(), root.id).adapters.map((node) => node.id),
    chain.adapters.map((node) => node.id),
  );
  flowStore.getState().redo();
  studioStore.getState().saveActiveWorkflowTab(true);
  studioStore.getState().createWorkflowTab('temporary blank');
  studioStore.getState().switchWorkflowTab(savedId);
  const restored = flowStore.getState().toObject();
  const restoredChain = adapters.modelSetupAdapterChain(restored, root.id);
  assert.deepEqual(
    restoredChain.adapters.map((node) => node.id),
    order,
  );
  assert.deepEqual(
    restoredChain.adapters.map((node) => node.data.params.model.value),
    adapters.modelSetupAdapterChain(moved, root.id).adapters.map((node) => node.data.params.model.value),
  );
  const api = flowStore
    .getState()
    .exportGraph('metadata-selected-policy', undefined, { sourceGraph: restored, randomizeSeeds: false });
  assert.equal(
    Object.values(api.nodes).filter((node) => `${node.module}.${node.action}` === profileAdapterKey()).length,
    32,
  );
  const withdrawn = withPolicy(selectedFluxProfile().id, undefined, { omit: true });
  assert.match(adapters.modelSetupAdapterEditUnavailable(restoredChain, withdrawn), /does not support LoRA/);
  const removed = adapters.planModelSetupAdapterEdit(restored, root.id, {
    kind: 'remove',
    nodeId: restoredChain.adapters[0].id,
  });
  assert.equal(adapters.modelSetupAdapterChain(removed, root.id).adapters.length, 31);
  assert.deepEqual(
    adapters.modelSetupAdapterChain(removed, root.id).owner.data.params,
    restoredChain.owner.data.params,
  );
});

const profileAdapterKey = () => selectedFluxProfile().adapterAuthoring.adapterNodeKey;

test('policy duplicate repository names are case-insensitive while exact selected spelling remains unchanged', () => {
  const profile = selectedFluxProfile();
  const policy = profile.adapterAuthoring;
  const pair = policy.repositoryRevisions[0];
  const upper = { ...pair, repo: pair.repo.toUpperCase() };
  assert.throws(
    () =>
      runtimeProfiles.parseImageAdapterAuthoringPolicy(
        { ...policy, repositoryRevisions: [pair, upper] },
        profile.modes,
        [pair, upper],
        profile,
      ),
    /runtime contract/i,
  );
  assert.deepEqual(
    runtimeProfiles.parseImageAdapterAuthoringPolicy(policy, profile.modes, profile.repository_revisions, profile)
      .repositoryRevisions,
    [pair],
  );
  assert.throws(
    () =>
      runtimeProfiles.parseImageAdapterAuthoringPolicy(
        { ...policy, repositoryRevisions: [upper] },
        profile.modes,
        [pair],
        profile,
      ),
    /runtime contract/i,
    'Duplicate detection must not normalize authority spelling.',
  );
});

test('policy task grammar rejects mode-declared runtime IDs that are not backend task identifiers', () => {
  const profile = selectedFluxProfile();
  for (const task of ['1task', 'image.task', 'image-task', 'x'.repeat(65), 'text_to_image\n'])
    assert.throws(
      () =>
        runtimeProfiles.parseImageAdapterAuthoringPolicy(
          { ...profile.adapterAuthoring, tasks: [task] },
          [task],
          profile.repository_revisions,
          profile,
        ),
      /runtime contract/i,
      task,
    );
});

test('policy repositories retain the backend bounded identifier grammar even when a parent declares the value', () => {
  const profile = selectedFluxProfile();
  for (const repo of [
    '-owner/model',
    'owner/.model',
    'x'.repeat(97) + '/model',
    'owner/' + 'x'.repeat(97),
    'owner/model\n',
  ]) {
    const pair = { repo, revision: profile.adapterAuthoring.repositoryRevisions[0].revision };
    assert.throws(
      () =>
        runtimeProfiles.parseImageAdapterAuthoringPolicy(
          { ...profile.adapterAuthoring, repositoryRevisions: [pair] },
          profile.modes,
          [pair],
          profile,
        ),
      /runtime contract/i,
      repo,
    );
  }
});

test('absent selected policy keeps unsupported Cosmos and DDPM owners from changing the saved graph', async (t) => {
  for (const id of ['cosmos3_super_text_to_image', 'ddpm-negative'])
    await t.test(id, () => {
      const { graph, root } = cases.get(id);
      const before = structuredClone(graph);
      const metadata =
        id === 'cosmos3_super_text_to_image'
          ? withPolicy('cosmos3-super-text-to-image:official-modular-workflow', undefined, { omit: true })
          : authority;
      assert.throws(() => add(graph, root, metadata), /LoRA.*support|support.*LoRA/i);
      assert.deepEqual(graph, before);
    });
});

test('current supported native and direct image owners authorize actual registered adapter transport', async (t) => {
  for (const id of ['z_image_quick_concept', 'qwen_text_rendering', 'flux_fill_outpaint', 'qwen-direct'])
    await t.test(id, () => {
      const { graph, root } = cases.get(id);
      const chain = adapters.modelSetupAdapterChain(graph, root.id);
      const field = chain.native ? 'model' : 'adapter_path';
      const next = adapters.planModelSetupAdapterEdit(
        graph,
        root.id,
        {
          kind: 'add',
          registry: fixture.registry,
          values: { [field]: { source: 'local', value: 'metadata-only.safetensors' } },
        },
        authority,
      );
      assert.equal(adapters.modelSetupAdapterChain(next, root.id).adapters.length, 1);
    });
});

test('pending, stale, unknown and mismatched selected metadata refuses Add without changing existing values', async (t) => {
  const { graph, root } = cases.get('z_image_quick_concept');
  const variants = {
    missing: () => null,
    pendingCapabilities: () => ({
      ...authority,
      discoveryRequests: { ...authority.discoveryRequests, capabilities: { status: 'loading' } },
    }),
    pendingRegistry: () => ({
      ...authority,
      discoveryRequests: { ...authority.discoveryRequests, nodes: { status: 'loading' } },
    }),
    failedCapabilities: () => ({
      ...authority,
      discoveryRequests: { ...authority.discoveryRequests, capabilities: { status: 'error' } },
    }),
    nonAuthoritative: () => ({ ...authority, studioModelCapabilitiesAuthoritative: false }),
    invalidSpecification: () => ({ ...authority, studioExecutionSpecInvalid: true }),
    unknownTask: () => ({ ...authority, pipelineSupport: [] }),
    staleOperation: () => ({ ...authority, operationContracts: [] }),
    missingRegistry: () => ({ ...authority, nodesRegistry: {} }),
    staleProfile: () => ({
      ...authority,
      studioModelCapabilities: authority.studioModelCapabilities.map((item) => ({ ...item, executionProfiles: [] })),
    }),
    missingSelectedPairs: () => ({
      ...authority,
      studioModelCapabilities: authority.studioModelCapabilities.map((item) => ({
        ...item,
        executionProfiles: item.executionProfiles?.map((profile) => ({ ...profile, repository_revisions: undefined })),
      })),
    }),
    foreignRepositoryPair: () => ({
      ...authority,
      studioModelCapabilities: authority.studioModelCapabilities.map((item) => ({
        ...item,
        executionProfiles: item.executionProfiles?.map((profile) => ({
          ...profile,
          repository_revisions: profile.repository_revisions?.map((pair) => ({ ...pair, repo: 'unreviewed/model' })),
        })),
      })),
    }),
    staleSelectedRevision: () => ({
      ...authority,
      studioModelCapabilities: authority.studioModelCapabilities.map((item) => ({
        ...item,
        executionProfiles: item.executionProfiles?.map((profile) => ({
          ...profile,
          repository_revisions: profile.repository_revisions?.map((pair) => ({ ...pair, revision: 'b'.repeat(40) })),
        })),
      })),
    }),
    staleRegistrySocket: () => {
      const nodesRegistry = structuredClone(authority.nodesRegistry);
      nodesRegistry['modules.ModularDiffusers.Lora'].params.lora.type = 'image';
      return { ...authority, nodesRegistry };
    },
  };
  for (const [name, make] of Object.entries(variants))
    await t.test(name, () => {
      const before = structuredClone(graph);
      assert.throws(() => add(graph, root, make()), /LoRA|capabilities|profile/i);
      assert.deepEqual(graph, before);
    });
  for (const [name, value] of [
    ['model_type', 'UnknownPipeline'],
    ['repo_id', { source: 'hub', value: 'unreviewed/model' }],
    ['revision', 'b'.repeat(40)],
  ])
    await t.test(name, () => {
      const unpacked = groups.unpackVisualOperationGroups(graph);
      const owner = adapters.modelSetupAdapterChain(graph, root.id).owner;
      unpacked.graph.nodes.find((node) => node.id === owner.id).data.params[name].value = value;
      const modified = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
      const before = structuredClone(modified);
      assert.throws(() => add(modified, root), /LoRA|capabilities|profile/i);
      assert.deepEqual(modified, before);
    });
  for (const field of ['model_type', 'repo_id', 'revision'])
    await t.test(`connected ${field}`, () => {
      const unpacked = groups.unpackVisualOperationGroups(graph);
      const owner = adapters.modelSetupAdapterChain(graph, root.id).owner;
      unpacked.graph.nodes.push({
        id: `supplier-${field}`,
        type: 'custom',
        position: { x: -400, y: 0 },
        data: {
          module: 'modules.Test',
          action: 'Selector',
          params: { output: { type: 'string', display: 'output' } },
        },
      });
      unpacked.graph.edges.push({
        id: `selector-${field}`,
        source: `supplier-${field}`,
        sourceHandle: 'output',
        target: owner.id,
        targetHandle: field,
      });
      const modified = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
      const before = structuredClone(modified);
      assert.throws(() => add(modified, root), /reviewed image model|LoRA|profile/i);
      assert.deepEqual(modified, before);
    });

  await t.test('stale direct profile selection', () => {
    const direct = cases.get('qwen-direct');
    const unpacked = groups.unpackVisualOperationGroups(direct.graph);
    const owner = adapters.modelSetupAdapterChain(direct.graph, direct.root.id).owner;
    unpacked.graph.nodes.find((node) => node.id === owner.id).data.params.execution_profile_id.value = 'old-profile';
    const modified = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
    const before = structuredClone(modified);
    assert.throws(() => add(modified, direct.root), /profile|capabilities/i);
    assert.deepEqual(modified, before);
  });
});

test('an existing adapter remains inspectable and removable when current selected support is withdrawn', () => {
  const { graph, root } = cases.get('z_image_quick_concept');
  const populated = add(graph, root);
  const before = structuredClone(populated);
  const withdrawn = {
    ...authority,
    studioModelCapabilities: authority.studioModelCapabilities.map((item) => ({ ...item, supportsLora: false })),
  };
  const chain = adapters.modelSetupAdapterChain(populated, root.id);
  assert.match(adapters.modelSetupAdapterAddUnavailable(chain, withdrawn), /does not support LoRA/);
  assert.equal(chain.adapters.length, 1);
  assert.throws(() => add(populated, root, withdrawn), /does not support LoRA/);
  assert.throws(
    () =>
      adapters.planModelSetupAdapterEdit(
        populated,
        root.id,
        { kind: 'move', nodeId: chain.adapters[0].id, offset: 1 },
        withdrawn,
      ),
    /does not support LoRA/,
  );
  assert.deepEqual(populated, before);
  const removed = adapters.planModelSetupAdapterEdit(populated, root.id, {
    kind: 'remove',
    nodeId: chain.adapters[0].id,
  });
  assert.equal(adapters.modelSetupAdapterChain(removed, root.id).adapters.length, 0);
  assert.deepEqual(adapters.modelSetupAdapterChain(removed, root.id).owner.data.params, chain.owner.data.params);
});

test('actual direct image adapters retain their operation scope through ordered edits and reject shared suppliers', async (t) => {
  for (const id of ['flux_fill_outpaint', 'qwen-direct'])
    await t.test(id, () => {
      const { graph, root } = cases.get(id);
      const original = adapters.modelSetupAdapterChain(graph, root.id);
      const one = add(graph, root);
      const two = add(one, root);
      const chain = adapters.modelSetupAdapterChain(two, root.id);
      assert.equal(chain.adapters.length, 2);
      assert.deepEqual(chain.owner.data.params, original.owner.data.params);
      const moved = adapters.planModelSetupAdapterEdit(
        two,
        root.id,
        { kind: 'move', nodeId: chain.adapters[1].id, offset: -1 },
        authority,
      );
      const reordered = adapters.modelSetupAdapterChain(moved, root.id);
      assert.deepEqual(
        reordered.adapters.map((node) => node.id),
        chain.adapters.map((node) => node.id).reverse(),
      );
      let removed = moved;
      for (const node of reordered.adapters)
        removed = adapters.planModelSetupAdapterEdit(removed, root.id, { kind: 'remove', nodeId: node.id });
      assert.equal(adapters.modelSetupAdapterChain(removed, root.id).adapters.length, 0);
      assert.deepEqual(adapters.modelSetupAdapterChain(removed, root.id).owner.data.params, original.owner.data.params);

      for (const kind of ['sharedOutput', 'competingInput']) {
        const unpacked = groups.unpackVisualOperationGroups(one);
        const existing = adapters.modelSetupAdapterChain(one, root.id).adapters[0];
        const duplicate = structuredClone(kind === 'sharedOutput' ? existing : original.owner);
        duplicate.id = `extra-${kind}`;
        unpacked.graph.nodes.push(duplicate);
        unpacked.graph.edges.push({
          id: `extra-${kind}-wire`,
          source: kind === 'sharedOutput' ? existing.id : duplicate.id,
          sourceHandle: kind === 'sharedOutput' ? 'output' : 'pipeline',
          target: kind === 'sharedOutput' ? duplicate.id : existing.id,
          targetHandle: 'pipeline',
        });
        for (const edge of unpacked.graph.edges.filter((edge) => edge.id === `extra-${kind}-wire`)) {
          const source = unpacked.graph.nodes.find((node) => node.id === edge.source).data.params[edge.sourceHandle];
          const target = unpacked.graph.nodes.find((node) => node.id === edge.target).data.params[edge.targetHandle];
          assert.equal(source.type, 'image_diffusion_pipeline');
          assert.equal(target.type, source.type);
        }
        const modified = groups.groupNewOperationGraph(unpacked.graph);
        const projected = groups.unpackVisualOperationGroups(modified);
        const setup = modified.nodes.find(
          (node) =>
            groups.visualOperationGroup(node) === 'setup' &&
            projected.members.get(node.id)?.some((id) => id.endsWith(`/stage-${original.owner.id}`)),
        );
        assert.ok(setup, 'The original owner remains in a valid derived setup.');
        const before = structuredClone(modified);
        assert.throws(() => add(modified, setup), /shared|competing|another loader|missing consumers/i);
        assert.deepEqual(modified, before);
      }
    });
});

test('actual image decode operation groups Cosmos output without changing executable leaves or saved standalone layout', () => {
  const { graph } = cases.get('cosmos3_super_text_to_image');
  assert.deepEqual(graph.nodes.map((node) => node.data.label).sort(), [
    'Denoise',
    'Encode Inputs',
    'Image Output',
    'Model Setup',
  ]);
  const output = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'output');
  assert.ok(output);
  const leaves = output.data.blockInstanceV2.effectiveGraph.nodes;
  assert.deepEqual(leaves.map((node) => node.data.action).sort(), ['Preview', 'WorkflowCosmos3OmniDecode']);
  const standalone = groups.unpackVisualOperationGroups(graph).graph;
  const saved = structuredClone(standalone);
  assert.equal(standalone.nodes.length, 5);
  assert.equal(standalone.nodes.filter((node) => groups.visualOperationGroup(node)).length, 0);
  const executable = (sourceGraph) => {
    const api = flowStore
      .getState()
      .exportGraph('metadata-image-grouping', undefined, { sourceGraph, randomizeSeeds: false });
    const names = new Map(Object.entries(api.nodes).map(([id, node]) => [id, `${node.module}.${node.action}`]));
    assert.equal(new Set(names.values()).size, names.size);
    return Object.fromEntries(
      Object.entries(api.nodes).map(([id, node]) => [
        names.get(id),
        {
          module: node.module,
          action: node.action,
          params: Object.fromEntries(
            Object.entries(node.params).map(([field, value]) => [
              field,
              value.sourceId ? { ...value, sourceId: names.get(value.sourceId) } : value,
            ]),
          ),
        },
      ]),
    );
  };
  assert.deepEqual(executable(graph), executable(standalone));
  assert.deepEqual(standalone, saved, 'Exporting/opening the saved standalone graph does not combine its stages.');
});

// Fixture setup must include these actual curated selections and the two actual
// published negative starters below. No positive adapterAuthoring DTO is made here.
const editPolicySelections = [
  {
    id: 'flux_kontext_edit',
    profileId: 'flux-kontext:modular',
    task: 'edit_image',
    tasks: ['edit_image'],
    repo: 'black-forest-labs/FLUX.1-Kontext-dev',
    revision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
    visibleLabels: ['Denoise', 'Encode Inputs', 'Image Output', 'Load Image', 'Model Setup'],
    referenceCount: 1,
    embeddedGuidance: 3.5,
    guiderEnabled: true,
  },
  {
    id: 'flux_kontext_multi_reference',
    profileId: 'flux-kontext:modular',
    task: 'multi_image_reference_edit',
    tasks: ['edit_image'],
    repo: 'black-forest-labs/FLUX.1-Kontext-dev',
    revision: '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
    visibleLabels: ['Compose References', 'Denoise', 'Encode Inputs', 'Image Output', 'Load Image', 'Model Setup'],
    referenceCount: 2,
    embeddedGuidance: 3.5,
    guiderEnabled: true,
  },
  ...[
    ['flux2_klein_text_to_image', 'text_to_image', 0],
    ['flux2_klein_edit', 'edit_image', 1],
    ['flux2_klein_multi_reference', 'multi_image_reference_edit', 2],
  ].map(([id, task, referenceCount]) => ({
    id,
    task,
    referenceCount,
    profileId: 'flux2-klein:modular',
    tasks: ['text_to_image', 'edit_image'],
    repo: 'black-forest-labs/FLUX.2-klein-4B',
    revision: 'e7b7dc27f91deacad38e78976d1f2b499d76a294',
    visibleLabels: [
      'Denoise',
      'Encode Inputs',
      'Image Output',
      'Model Setup',
      ...(referenceCount ? ['Load Image'] : []),
    ].sort(),
    embeddedGuidance: 1,
    guiderEnabled: null,
  })),
];
const editControlSelections = [
  {
    id: 'klein-base-native-negative',
    selection: {
      pipelineClass: 'Flux2KleinBaseModularPipeline',
      task: 'text_to_image',
      executionProfileId: 'flux2-klein-base:modular',
    },
  },
  {
    id: 'klein-kv-native-negative',
    selection: {
      pipelineClass: 'Flux2KleinModularPipeline',
      task: 'text_to_image',
      executionProfileId: 'flux2-klein-kv:t2i-modular',
    },
  },
];

test('actual selected Kontext and Klein policies authorize only their five original native templates', async (t) => {
  for (const selection of editPolicySelections)
    await t.test(selection.id, () => {
      const { graph, root } = cases.get(selection.id);
      const before = structuredClone(graph);
      const authorityBefore = structuredClone(authority);
      const chain = adapters.modelSetupAdapterChain(graph, root.id);
      const retained = adapters.modelSetupAdapterChain(
        cases.get(curatedFluxIds[0]).graph,
        cases.get(curatedFluxIds[0]).root.id,
      ).adapters;
      assert.equal(retained.length, 2);
      const values = retained.map((node, index) =>
        Object.fromEntries(
          ['model', 'revision', 'expected_sha256', 'weight_name', 'adapter_name', 'scale'].map((field) => [
            field,
            field === 'scale' ? ['0.8', '0.35'][index] : structuredClone(node.data.params[field].value),
          ]),
        ),
      );
      const next = add(add(graph, root, authority, values[0]), root, authority, values[1]);
      const { profile, policy } = publishedAliasPolicy(selection.profileId);
      assert.deepEqual(policy.tasks, selection.tasks);
      const currentOwner = currentEditOwnerContract(selection);
      const executionMode = Object.hasOwn(currentOwner.binding, 'executionMode')
        ? currentOwner.binding.executionMode
        : currentOwner.task;
      assert.ok(policy.tasks.includes(executionMode));
      assert.ok(profile.modes.includes(executionMode));
      assert.equal(policy.adapterNodeKey, 'modules.ModularDiffusers.Lora');
      assert.equal(policy.maxOwnedAdapters, 32);
      assert.deepEqual(policy.repositoryRevisions, [{ repo: selection.repo, revision: selection.revision }]);
      const changed = adapters.modelSetupAdapterChain(next, root.id);
      assert.equal(changed.native, true);
      assert.deepEqual(changed.owner.data.params, chain.owner.data.params);
      assert.equal(changed.owner.data.params.model_type.value, profile.pipeline_class);
      assert.deepEqual(changed.owner.data.params.repo_id.value, { source: 'hub', value: selection.repo });
      assert.equal(changed.owner.data.params.revision.value, selection.revision);
      assert.equal(adapters.modelSetupAdapterEditUnavailable(changed, authority), null);
      assert.equal(
        authority.studioModelCapabilities.find((item) => item.modelType === profile.pipeline_class).supportsLora,
        false,
      );
      assert.deepEqual(next.nodes.map((node) => node.data.label).sort(), selection.visibleLabels);
      const flat = groups.unpackVisualOperationGroups(next).graph;
      const guider = flat.nodes.find((node) => node.data.action === 'Guider');
      assert.equal(guider?.data.params.enabled.value ?? null, selection.guiderEnabled);
      assert.equal(
        flat.nodes.find((node) => node.data.action === 'Denoise').data.params.guidance_scale.value,
        selection.embeddedGuidance,
      );
      for (const [index, adapter] of changed.adapters.entries())
        for (const [field, value] of Object.entries(values[index]))
          assert.deepEqual(adapter.data.params[field].value, value);
      const exportApi = (sourceGraph) =>
        flowStore.getState().exportGraph('metadata-own-edit-policy', undefined, { sourceGraph, randomizeSeeds: false });
      const core = (sourceGraph) => {
        const api = exportApi(sourceGraph);
        return Object.fromEntries(
          Object.entries(api.nodes)
            .filter(([, node]) => node.action !== 'Lora')
            .map(([id, node]) => [
              id,
              {
                ...node,
                params: Object.fromEntries(Object.entries(node.params).filter(([field]) => field !== 'lora_list')),
              },
            ]),
        );
      };
      assert.deepEqual(
        core(next),
        core(graph),
        'All non-adapter executable fields, settings and ordinary wires remain unchanged.',
      );
      const moved = adapters.planModelSetupAdapterEdit(
        next,
        root.id,
        { kind: 'move', nodeId: changed.adapters[1].id, offset: -1 },
        authority,
      );
      assert.deepEqual(
        adapters.modelSetupAdapterChain(moved, root.id).adapters.map((node) => node.data.params.scale.value),
        ['0.35', '0.8'],
      );
      assert.deepEqual(core(moved), core(graph));
      let removed = moved;
      for (const adapter of adapters.modelSetupAdapterChain(moved, root.id).adapters)
        removed = adapters.planModelSetupAdapterEdit(removed, root.id, { kind: 'remove', nodeId: adapter.id });
      assert.deepEqual(
        exportApi(removed),
        exportApi(graph),
        'Whole ordinary API JSON is restored, including media and all creator settings.',
      );
      assert.deepEqual(graph, before);
      assert.deepEqual(
        authority,
        authorityBefore,
        'No support/qualification/Auto flags or other public metadata are promoted.',
      );
    });
});

test('selected edit policies reject missing, foreign, malformed, stale, ambiguous and wrong-task grants unchanged', async (t) => {
  for (const selection of editPolicySelections) {
    const { graph, root } = cases.get(selection.id);
    const { policy } = publishedAliasPolicy(selection.profileId);
    const foreignId = selection.profileId === 'flux-kontext:modular' ? 'flux2-klein:modular' : 'flux-kontext:modular';
    const variants = {
      absent: withPolicy(selection.profileId, undefined, { omit: true }),
      malformedPresent: withPolicy(selection.profileId, { ...policy, maxOwnedAdapters: 0 }),
      borrowedDense: withPolicy(selection.profileId, selectedFluxProfile().adapterAuthoring),
      borrowedOtherEditProfile: withPolicy(selection.profileId, publishedAliasPolicy(foreignId).policy),
      wrongTask: withPolicy(selection.profileId, {
        ...policy,
        tasks: policy.tasks.filter(
          (task) => task !== (selection.task === 'multi_image_reference_edit' ? 'edit_image' : selection.task),
        ),
      }),
      foreignPair: withPolicy(selection.profileId, {
        ...policy,
        repositoryRevisions: [
          { repo: 'black-forest-labs/FLUX.1-dev', revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21' },
        ],
      }),
      stalePin: withPolicy(selection.profileId, {
        ...policy,
        repositoryRevisions: [{ repo: selection.repo, revision: 'a'.repeat(40) }],
      }),
      missingPairs: withPolicy(selection.profileId, { ...policy, repositoryRevisions: [] }),
      pending: {
        ...authority,
        discoveryRequests: { ...authority.discoveryRequests, capabilities: { status: 'loading' } },
      },
      staleOperations: { ...authority, operationContracts: [] },
      staleSupport: { ...authority, pipelineSupport: [] },
      ambiguousProfile: {
        ...authority,
        studioModelCapabilities: authority.studioModelCapabilities.map((capability) => ({
          ...capability,
          executionProfiles: capability.executionProfiles?.flatMap((profile) =>
            profile.id === selection.profileId ? [profile, structuredClone(profile)] : [profile],
          ),
        })),
      },
      ambiguousCapability: {
        ...authority,
        studioModelCapabilities: [
          ...authority.studioModelCapabilities,
          structuredClone(
            authority.studioModelCapabilities.find(
              (capability) =>
                capability.modelType ===
                adapters.modelSetupAdapterChain(graph, root.id).owner.data.params.model_type.value,
            ),
          ),
        ],
      },
    };
    for (const [name, metadata] of Object.entries(variants))
      await t.test(`${selection.id}/${name}`, () => {
        const before = structuredClone(graph);
        assert.throws(() => add(graph, root, metadata), /policy|LoRA|profile|capabilities/i);
        assert.deepEqual(graph, before);
      });
    for (const [field, selected] of [
      ['repo_id', { source: 'hub', value: 'black-forest-labs/FLUX.1-dev' }],
      ['revision', 'a'.repeat(40)],
      ['workflow_id', selection.task === 'text_to_image' ? 'image_conditioned' : 'text2image'],
      ['model_type', 'UnknownPipeline'],
    ])
      await t.test(`${selection.id}/changed ${field}`, () => {
        const unpacked = groups.unpackVisualOperationGroups(graph);
        const owner = adapters.modelSetupAdapterChain(graph, root.id).owner;
        unpacked.graph.nodes.find((node) => node.id === owner.id).data.params[field].value = selected;
        const changed = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
        const before = structuredClone(changed);
        assert.throws(() => add(changed, root), /policy|LoRA|profile|revision|selector/i);
        assert.deepEqual(changed, before);
      });
    for (const field of ['model_type', 'repo_id', 'revision', 'workflow_id'])
      await t.test(`${selection.id}/connected ${field}`, () => {
        const unpacked = groups.unpackVisualOperationGroups(graph);
        const owner = adapters.modelSetupAdapterChain(graph, root.id).owner;
        unpacked.graph.nodes.push({
          id: `edit-policy-supplier-${field}`,
          type: 'custom',
          position: { x: -400, y: 0 },
          data: {
            module: 'modules.Test',
            action: 'Selector',
            params: { output: { type: 'string', display: 'output' } },
          },
        });
        unpacked.graph.edges.push({
          id: `edit-policy-selector-${field}`,
          source: `edit-policy-supplier-${field}`,
          sourceHandle: 'output',
          target: owner.id,
          targetHandle: field,
        });
        const connected = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
        const before = structuredClone(connected);
        assert.throws(() => add(connected, root), /policy|LoRA|profile|revision|selector/i);
        assert.deepEqual(connected, before);
      });
  }
});

test('native edit grants do not authorize Kontext NVFP4, Klein Base or Klein KV selectors', async (t) => {
  await t.test('Kontext NVFP4 exact reviewed pair remains excluded from dense policy', () => {
    const { graph, root } = cases.get('flux_kontext_edit');
    const unpacked = groups.unpackVisualOperationGroups(graph);
    const owner = adapters.modelSetupAdapterChain(graph, root.id).owner;
    const params = unpacked.graph.nodes.find((node) => node.id === owner.id).data.params;
    params.repo_id.value = { source: 'hub', value: 'black-forest-labs/FLUX.1-Kontext-dev-NVFP4' };
    params.revision.value = '7e9dee453a3454251216a394697a6dcea44f54f8';
    const changed = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
    const before = structuredClone(changed);
    assert.throws(() => add(changed, root), /policy|LoRA|profile|revision/i);
    assert.deepEqual(changed, before);
  });
  for (const control of editControlSelections)
    await t.test(control.id, () => {
      const { graph, root } = cases.get(control.id);
      const before = structuredClone(graph);
      // Studio intentionally filters model types without a presentation (KV).
      // Check the actual public declaration without inventing parsed authority.
      const publicProfiles = fixture.publicPayload.capabilities
        .flatMap((capability) => capability.executionProfiles ?? [])
        .filter((profile) => profile.id === control.selection.executionProfileId);
      assert.equal(publicProfiles.length, 1);
      assert.equal(Object.hasOwn(publicProfiles[0], 'adapterAuthoring'), false);
      assert.throws(() => add(graph, root), /policy|LoRA|profile/i);
      assert.deepEqual(graph, before);
    });
});

// Positive mode fields are NEVER synthesized into a fixture.
function currentEditOwnerContract(selection, metadata = authority) {
  const { graph, root } = cases.get(selection.id);
  const hint = adapters.modelSetupAdapterChain(graph, root.id).owner.data.operationAuthoring.operation;
  const rows = metadata.operationContracts.filter(
    (item) =>
      item.pipelineClass === hint.pipelineClass &&
      item.task === hint.task &&
      item.operationId === hint.operationId &&
      item.nodeKey === hint.nodeKey,
  );
  assert.equal(rows.length, 1);
  return rows[0];
}
function editAuthorityMode(selection, mode, omit = false) {
  const metadata = structuredClone(authority);
  const binding = currentEditOwnerContract(selection, metadata).binding;
  if (omit) delete binding.executionMode;
  else binding.executionMode = mode;
  return metadata;
}
test('five selected image policies use their exact current backend execution mode without expanding profile modes', async (t) => {
  for (const selection of editPolicySelections)
    await t.test(selection.id, () => {
      const expected = selection.task === 'multi_image_reference_edit' ? 'edit_image' : selection.task;
      const current = currentEditOwnerContract(selection);
      const { profile, policy } = publishedAliasPolicy(selection.profileId);
      if (selection.task === 'multi_image_reference_edit') {
        assert.equal(
          current.binding.executionMode,
          expected,
          'The alias mode must come from the real producer, not the graph hint or fixture injection.',
        );
      } else {
        assert.equal(
          Object.hasOwn(current.binding, 'executionMode'),
          false,
          'Exact T2I/edit owners preserve the existing absent field and exact-task fallback.',
        );
      }
      assert.deepEqual(profile.modes, ['text_to_image', 'edit_image']);
      assert.deepEqual(
        policy.tasks,
        selection.profileId === 'flux-kontext:modular' ? ['edit_image'] : ['text_to_image', 'edit_image'],
      );
      assert.ok(policy.tasks.includes(current.binding.executionMode ?? current.task));
      assert.ok(profile.modes.includes(current.binding.executionMode ?? current.task));
      assert.equal(policy.tasks.includes('multi_image_reference_edit'), false);
      const { graph, root } = cases.get(selection.id);
      assert.equal(
        adapters.modelSetupAdapterAddUnavailable(adapters.modelSetupAdapterChain(graph, root.id), authority),
        null,
      );
    });
});
test('absent execution mode falls back only to the exact task and saved hints cannot grant a multi-reference alias', async (t) => {
  for (const selection of editPolicySelections)
    await t.test(selection.id, () => {
      const { graph, root } = cases.get(selection.id);
      const metadata = editAuthorityMode(selection, undefined, true);
      const before = structuredClone(graph);
      if (selection.task === 'multi_image_reference_edit') {
        assert.throws(() => add(graph, root, metadata), /policy|LoRA|profile/i);
        const unpacked = groups.unpackVisualOperationGroups(graph);
        const ownerId = adapters.modelSetupAdapterChain(graph, root.id).owner.id;
        unpacked.graph.nodes.find(
          (node) => node.id === ownerId,
        ).data.operationAuthoring.operation.binding.executionMode = 'edit_image';
        const advisory = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
        const advisoryBefore = structuredClone(advisory);
        assert.throws(() => add(advisory, root, metadata), /policy|LoRA|profile/i);
        assert.deepEqual(advisory, advisoryBefore);
      } else {
        // Actual current own policy is retained; this is the backward-compatible
        // absence case, not a fabricated positive mode or policy.
        assert.equal(
          adapters.modelSetupAdapterAddUnavailable(adapters.modelSetupAdapterChain(graph, root.id), metadata),
          null,
        );
      }
      assert.deepEqual(graph, before);
    });
});
test('present invalid or foreign execution modes never fall back and foreign owner contracts cannot supply a mode', async (t) => {
  for (const selection of editPolicySelections) {
    const { graph, root } = cases.get(selection.id);
    for (const mode of [
      undefined,
      null,
      false,
      1,
      {},
      [],
      '',
      'inpaint',
      'audio_generation',
      'edit-image',
      'edit_image\n',
    ])
      await t.test(`${selection.id}/${String(mode)}`, () => {
        const before = structuredClone(graph);
        assert.throws(() => add(graph, root, editAuthorityMode(selection, mode)), /policy|LoRA|profile/i);
        assert.deepEqual(graph, before);
      });
    for (const field of ['pipelineClass', 'task', 'nodeKey'])
      await t.test(`${selection.id}/foreign ${field}`, () => {
        const metadata = structuredClone(authority);
        const owner = currentEditOwnerContract(selection, metadata);
        owner[field] =
          field === 'nodeKey' ? 'modules.Audio.LoadPipeline' : field === 'task' ? 'inpaint' : 'ForeignPipeline';
        const before = structuredClone(graph);
        assert.throws(() => add(graph, root, metadata), /policy|LoRA|profile|capabilities/i);
        assert.deepEqual(graph, before);
      });
  }
});

test('six actual staged image starters keep all three owned consumers through adapter Add, Move, Remove and persisted API export', async (t) => {
  const exported = (graph) =>
    flowStore.getState().exportGraph('staged-chain-contract', undefined, { sourceGraph: graph, randomizeSeeds: false });
  for (const id of integratedImageStageIds)
    await t.test(id, () => {
      const { graph, root } = cases.get(id),
        before = structuredClone(graph),
        original = exported(graph);
      const initial = adapters.modelSetupAdapterChain(graph, root.id);
      assert.equal(initial.tail.length, 3);
      assert.equal(adapters.modelSetupAdapterAddUnavailable(initial, authority), null);
      assert.equal(adapters.modelSetupAdapterEditUnavailable(initial, authority), null);
      const one = add(graph, root, authority, { scale: '0.8' }),
        two = add(one, root, authority, { scale: '0.35' });
      const current = adapters.modelSetupAdapterChain(two, root.id);
      assert.equal(current.adapters.length, 2);
      const moved = adapters.planModelSetupAdapterEdit(
        two,
        root.id,
        { kind: 'move', nodeId: current.adapters[1].id, offset: -1 },
        authority,
      );
      const saved = JSON.parse(JSON.stringify(moved));
      const state = adapters.modelSetupAdapterChain(saved, root.id);
      assert.deepEqual(
        state.adapters.map((node) => node.data.params.scale.value),
        ['0.35', '0.8'],
      );
      const api = exported(saved),
        ownerId = Object.keys(api.nodes).find((nodeId) => api.nodes[nodeId].action === 'LoadPipeline');
      const finalId = Object.keys(api.nodes).find(
        (nodeId) => api.nodes[nodeId].action === 'LoadAdapter' && api.nodes[nodeId].params.scale.value === '0.8',
      );
      assert.ok(ownerId && finalId);
      for (const action of ['EncodeInputs', 'Denoise', 'DecodeLatents']) {
        const stage = Object.values(api.nodes).find((node) => node.action === action);
        assert.equal(stage.params.pipeline.sourceId, finalId);
        assert.equal(stage.params.pipeline.sourceKey, 'output');
      }
      const denoiseId = Object.keys(api.nodes).find((nodeId) => api.nodes[nodeId].action === 'Denoise');
      const decoder = Object.values(api.nodes).find((node) => node.action === 'DecodeLatents');
      for (const [field, sourceKey] of [
        ['latents', 'latents_out'],
        ['latent_binding', 'latent_binding'],
        ['width', 'width_out'],
        ['height', 'height_out'],
      ]) {
        assert.equal(decoder.params[field].sourceId, denoiseId);
        assert.equal(decoder.params[field].sourceKey, sourceKey);
      }
      const visible = saved.nodes.filter((node) => !node.parentId && !node.data.blockProjectionOwnerId);
      assert.equal(visible.length, id.includes('fill') ? 6 : 5);
      for (const label of ['Model Setup', 'Encode Inputs', 'Denoise', 'Image Output'])
        assert.equal(visible.filter((node) => node.data.label === label).length, 1);
      const firstRemoved = adapters.planModelSetupAdapterEdit(saved, root.id, {
        kind: 'remove',
        nodeId: state.adapters[0].id,
      });
      const last = adapters.modelSetupAdapterChain(firstRemoved, root.id).adapters[0];
      const restored = adapters.planModelSetupAdapterEdit(firstRemoved, root.id, { kind: 'remove', nodeId: last.id });
      assert.deepEqual(exported(restored), original);
      assert.deepEqual(graph, before);
    });
});

test('staged image adapter authoring refuses malformed geometry and noncurrent stage authority without mutating the graph', async (t) => {
  for (const id of integratedImageStageIds)
    await t.test(id, () => {
      const { graph, root } = cases.get(id),
        before = structuredClone(graph);
      const unpacked = groups.unpackVisualOperationGroups(graph);
      const decoder = unpacked.graph.nodes.find((node) => node.data.action === 'DecodeLatents');
      for (const field of ['width', 'height', 'latent_binding']) {
        const missing = structuredClone(unpacked.graph);
        missing.edges = missing.edges.filter((edge) => !(edge.target === decoder.id && edge.targetHandle === field));
        assert.throws(() => add(groups.restoreVisualOperationGroups(missing, unpacked), root));
        const competing = structuredClone(unpacked.graph);
        const edge = competing.edges.find((edge) => edge.target === decoder.id && edge.targetHandle === field);
        competing.edges.push({ ...edge, id: `competing-${field}` });
        assert.throws(() => add(groups.restoreVisualOperationGroups(competing, unpacked), root));
      }
      const operation = decoder.data.operationAuthoring.operation;
      for (const kind of ['missing', 'duplicate', 'stale']) {
        const metadata = structuredClone(authority);
        const index = metadata.operationContracts.findIndex(
          (item) =>
            item.pipelineClass === operation.pipelineClass &&
            item.task === operation.task &&
            item.operationId === operation.operationId,
        );
        assert.ok(index >= 0);
        if (kind === 'missing') metadata.operationContracts.splice(index, 1);
        else if (kind === 'duplicate')
          metadata.operationContracts.push(structuredClone(metadata.operationContracts[index]));
        else
          metadata.operationContracts[index].binding = {
            ...metadata.operationContracts[index].binding,
            values: { ...metadata.operationContracts[index].binding?.values, seed: 7 },
          };
        assert.throws(() => add(graph, root, metadata));
      }
      assert.deepEqual(graph, before);
    });
});

const conditionalAdapterCases = [
  ['cosmos3_super_text_to_image', 'cosmos3-super-text-to-image:official-modular-workflow'],
  ['flux_redux_edit', 'flux-redux:direct'],
  ['flux_redux_multi_reference', 'flux-redux:direct'],
];
const conditionalAdapterProfile = (id) => {
  const found = authority.studioModelCapabilities
    .flatMap((item) => item.executionProfiles ?? [])
    .filter((p) => p.id === id);
  assert.equal(found.length, 1, 'Use one exact currently published selected profile.');
  return found[0];
};

test('required adapter control policy validates exact transport context and bounded own scalar grammar', () => {
  const profile = selectedFluxProfile();
  const parse = (policy, context = profile) =>
    runtimeProfiles.parseImageAdapterAuthoringPolicy(policy, profile.modes, profile.repository_revisions, context);
  assert.deepEqual(parse(profile.adapterAuthoring), profile.adapterAuthoring);
  assert.equal(Object.hasOwn(parse(profile.adapterAuthoring), 'requiredControls'), false);
  // These malformed maps are parser specimens, never installed as authoring grants.
  const specimen = { offload_mode: 'none', auto_offload: false, quant_config: null };
  assert.deepEqual(parse({ ...profile.adapterAuthoring, requiredControls: specimen }).requiredControls, specimen);
  for (const value of [
    {},
    null,
    undefined,
    [],
    { offload_mode: 0 },
    { offload_mode: NaN },
    { offload_mode: {} },
    { offload_mode: '' },
    { offload_mode: ' none' },
    { offload_mode: 'none ' },
    { offload_mode: 'a'.repeat(129) },
    { ['a'.repeat(65)]: null },
    { '1bad': null },
    { 'offload-mode': null },
    { Offload: null },
    { constructor: null },
    { prototype: null },
    Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`field_${i}`, null])),
    Object.assign(Object.create({ hidden: null }), specimen),
    { ...specimen, [Symbol('extra')]: null },
    Object.defineProperty({}, 'offload_mode', { value: 'none' }),
  ])
    assert.throws(() => parse({ ...profile.adapterAuthoring, requiredControls: value }));
  for (const control of ['\n', '\r', '\r\n', '\u0000', '\u001f', '\u007f', '\u009f', '\u2028', '\u2029'])
    assert.throws(() => parse({ ...profile.adapterAuthoring, requiredControls: { offload_mode: `none${control}` } }));
  let getterReads = 0;
  const accessor = Object.defineProperty({}, 'offload_mode', {
    enumerable: true,
    get() {
      getterReads++;
      return 'none';
    },
  });
  assert.throws(() => parse({ ...profile.adapterAuthoring, requiredControls: accessor }));
  assert.equal(getterReads, 0);
  assert.throws(() => parse(Object.assign(Object.create({ requiredControls: specimen }), profile.adapterAuthoring)));
  for (const context of [
    undefined,
    null,
    {},
    Object.create(profile),
    { ...profile, loader_action: 'LoadPipeline' },
    { ...profile, execution_path: 'direct-diffusers-image' },
  ])
    assert.throws(() =>
      runtimeProfiles.parseImageAdapterAuthoringPolicy(
        profile.adapterAuthoring,
        profile.modes,
        profile.repository_revisions,
        context,
      ),
    );
  for (const [, profileId] of conditionalAdapterCases) {
    const selected = conditionalAdapterProfile(profileId);
    assert.ok(selected.adapterAuthoring?.requiredControls, 'Require actual backend publication, not supportsLora.');
    assert.deepEqual(
      runtimeProfiles.parseImageAdapterAuthoringPolicy(
        selected.adapterAuthoring,
        selected.modes,
        selected.repository_revisions,
        selected,
      ),
      selected.adapterAuthoring,
    );
    const foreign = { ...selected, loader_module: 'modules.Foreign' };
    assert.throws(() =>
      runtimeProfiles.parseImageAdapterAuthoringPolicy(
        selected.adapterAuthoring,
        selected.modes,
        selected.repository_revisions,
        foreign,
      ),
    );
  }
});

test('actual conditional adapter policies bind literal optional inputs and pure recipe precedence before editing', async (t) => {
  for (const [id, profileId] of conditionalAdapterCases)
    await t.test(id, () => {
      const { graph, root } = cases.get(id),
        before = structuredClone(graph);
      const chain = adapters.modelSetupAdapterChain(graph, root.id);
      const profile = conditionalAdapterProfile(profileId);
      const controls = profile.adapterAuthoring?.requiredControls;
      assert.ok(controls, 'The selected current producer must declare the controls.');
      assert.equal(adapters.modelSetupAdapterAddUnavailable(chain, authority), null);
      const deny = (mutate) => {
        const changed = structuredClone(chain);
        mutate(changed);
        assert.notEqual(adapters.modelSetupAdapterAddUnavailable(changed, authority), null);
        assert.notEqual(adapters.modelSetupAdapterEditUnavailable(changed, authority), null);
      };
      for (const [name, expected] of Object.entries(controls)) {
        if (!(name === 'auto_offload' && !chain.native))
          deny((state) => {
            state.owner.data.params[name].value =
              expected === null ? 'foreign' : typeof expected === 'boolean' ? !expected : 'foreign';
          });
        deny((state) => {
          delete state.owner.data.params[name];
        });
        deny((state) => {
          state.unpacked.graph.edges.push({
            id: `connected-${name}`,
            source: state.owner.id,
            sourceHandle: 'pipeline',
            target: state.owner.id,
            targetHandle: name,
          });
        });
        if (expected !== null)
          deny((state) => {
            state.owner.data.params[name].value = null;
          });
      }
      const optional = structuredClone(chain);
      for (const [name, expected] of Object.entries(controls))
        if (expected === null) {
          delete optional.owner.data.params[name].value;
          delete optional.owner.data.params[name].default;
        }
      assert.equal(adapters.modelSetupAdapterAddUnavailable(optional, authority), null);
      if (chain.native) {
        const defaulted = structuredClone(chain);
        assert.equal(defaulted.owner.data.params.weight_loading_mode.default, 'cpu');
        delete defaulted.owner.data.params.weight_loading_mode.value;
        assert.equal(adapters.modelSetupAdapterAddUnavailable(defaulted, authority), null);
        deny((state) => {
          assert.equal(state.owner.data.params.trust_remote_code.default, undefined);
          delete state.owner.data.params.trust_remote_code.value;
        });
      } else {
        const recipe = (state) =>
          state.unpacked.graph.nodes.find(
            (n) => n.data.module === 'modules.DiffusersRuntime' && n.data.action === 'DiffusersExecutionRecipe',
          );
        assert.ok(recipe(chain));
        const overridden = structuredClone(chain);
        overridden.owner.data.params.offload_mode.value = 'group_cpu';
        overridden.owner.data.params.auto_offload.value = true;
        assert.equal(recipe(overridden).data.params.offload_mode.value, 'none');
        assert.equal(adapters.modelSetupAdapterAddUnavailable(overridden, authority), null);
        deny((state) => {
          recipe(state).data.params.offload_mode.value = 'group_cpu';
        });
        deny((state) => {
          state.owner.data.params.device_map.value = 'balanced';
        });
        deny((state) => {
          recipe(state).data.params.device_map.value = 'balanced';
        });
        deny((state) => {
          recipe(state).data.module = 'custom.Unreviewed';
        });
        deny((state) => {
          state.unpacked.graph.edges.push({
            id: 'computed-recipe',
            source: state.owner.id,
            sourceHandle: 'pipeline',
            target: recipe(state).id,
            targetHandle: 'offload_mode',
          });
        });
        deny((state) => {
          const edge = state.unpacked.graph.edges.find(
            (e) => e.target === state.owner.id && e.targetHandle === 'execution_recipe',
          );
          state.unpacked.graph.edges.push({ ...edge, id: 'duplicate-recipe' });
        });
        deny((state) => {
          state.unpacked.graph.edges = state.unpacked.graph.edges.filter(
            (e) => !(e.target === state.owner.id && e.targetHandle === 'execution_recipe'),
          );
          state.owner.data.params.execution_recipe.value = { offload_mode: 'none', device_map: 'none' };
        });
        const quantizer = (state) =>
          state.unpacked.graph.nodes.find(
            (n) => n.data.module === 'modules.DiffusersRuntime' && n.data.action === 'PipelineQuantizationConfigV2',
          );
        assert.ok(quantizer(chain));
        deny((state) => {
          quantizer(state).data.params.backend.value = 'bnb_4bit';
        });
        deny((state) => {
          quantizer(state).data.params.component_overrides.value = '{"transformer":{}}';
        });
        deny((state) => {
          state.unpacked.graph.edges.push({
            id: 'computed-quant',
            source: state.owner.id,
            sourceHandle: 'pipeline',
            target: quantizer(state).id,
            targetHandle: 'backend',
          });
        });
      }
      assert.deepEqual(graph, before);
    });
});

test('conditional Add2 Move and persistence preserve exports while unsafe controls allow Remove recovery only', async (t) => {
  const api = (graph) =>
    flowStore.getState().exportGraph('conditional-metadata', undefined, { sourceGraph: graph, randomizeSeeds: false });
  for (const [id] of conditionalAdapterCases)
    await t.test(id, () => {
      const { graph, root } = cases.get(id),
        before = structuredClone(graph);
      const first = add(graph, root, authority, { scale: '0.8' });
      const second = add(first, root, authority, { scale: '0.35' });
      const chain = adapters.modelSetupAdapterChain(second, root.id);
      const moved = adapters.planModelSetupAdapterEdit(
        second,
        root.id,
        { kind: 'move', nodeId: chain.adapters[1].id, offset: -1 },
        authority,
      );
      const restored = JSON.parse(JSON.stringify(moved));
      assert.deepEqual(
        adapters.modelSetupAdapterChain(restored, root.id).adapters.map((n) => n.id),
        [chain.adapters[1].id, chain.adapters[0].id],
      );
      const unpacked = groups.unpackVisualOperationGroups(restored),
        flat = unpacked.graph;
      if (chain.native) flat.nodes.find((n) => n.id === chain.owner.id).data.params.offload_mode.value = 'group_cpu';
      else
        flat.nodes.find(
          (n) => n.data.module === 'modules.DiffusersRuntime' && n.data.action === 'DiffusersExecutionRecipe',
        ).data.params.offload_mode.value = 'group_cpu';
      const unsafe = groups.restoreVisualOperationGroups(flat, unpacked),
        unsafeBefore = structuredClone(unsafe);
      assert.throws(() => add(unsafe, root));
      assert.throws(() =>
        adapters.planModelSetupAdapterEdit(
          unsafe,
          root.id,
          { kind: 'move', nodeId: chain.adapters[0].id, offset: -1 },
          authority,
        ),
      );
      assert.deepEqual(unsafe, unsafeBefore);
      const removedUnsafe = adapters.planModelSetupAdapterEdit(unsafe, root.id, {
        kind: 'remove',
        nodeId: chain.adapters[0].id,
      });
      assert.equal(adapters.modelSetupAdapterChain(removedUnsafe, root.id).adapters.length, 1);
      let removed = restored;
      for (const node of chain.adapters)
        removed = adapters.planModelSetupAdapterEdit(removed, root.id, { kind: 'remove', nodeId: node.id });
      assert.deepEqual(api(removed), api(graph));
      assert.deepEqual(graph, before);
    });
});

test('native adapter policy accepts fresh declared workflow selectors and the unchanged legacy blank representation', async (t) => {
  for (const id of ['flux_schnell_text_to_image', 'flux_kontext_edit', 'flux2_klein_edit']) {
    const { graph, root } = cases.get(id);
    const chain = adapters.modelSetupAdapterChain(graph, root.id);
    const operation = chain.owner.data.operationAuthoring.operation;
    assert.equal(chain.native, true);
    assert.equal(typeof operation.workflowId, 'string');
    assert.ok(operation.workflowId.length > 0);
    assert.equal(
      chain.owner.data.params.workflow_id.value,
      operation.workflowId,
      'The genuine current backend starter must author its exact resolved selector.',
    );
    for (const legacy of [false, true])
      await t.test(`${id}/${legacy ? 'legacy blank' : 'current declared'}`, () => {
        const unpacked = groups.unpackVisualOperationGroups(graph);
        if (legacy) unpacked.graph.nodes.find((node) => node.id === chain.owner.id).data.params.workflow_id.value = '';
        const candidate = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
        const before = structuredClone(candidate);
        assert.equal(
          adapters.modelSetupAdapterAddUnavailable(adapters.modelSetupAdapterChain(candidate, root.id), authority),
          null,
        );
        assert.deepEqual(candidate, before);
      });
  }
});

test('native adapter workflow authority keeps explicit bindings ahead of declarations and never adopts unknown values', async (t) => {
  const { graph, root } = cases.get('flux_schnell_text_to_image');
  const chain = adapters.modelSetupAdapterChain(graph, root.id);
  const operation = chain.owner.data.operationAuthoring.operation;
  const metadataWithBinding = (workflow) => {
    const metadata = structuredClone(authority);
    const current = metadata.operationContracts.find(
      (item) =>
        item.operationId === operation.operationId &&
        item.pipelineClass === operation.pipelineClass &&
        item.task === operation.task &&
        item.nodeKey === operation.nodeKey,
    );
    assert.ok(current);
    current.binding = { ...current.binding, values: { ...current.binding?.values, workflow_id: workflow } };
    return metadata;
  };
  await t.test('exact explicit binding', () => {
    assert.equal(adapters.modelSetupAdapterAddUnavailable(chain, metadataWithBinding(operation.workflowId)), null);
  });
  for (const value of ['image_conditioned', 'unknown_workflow', null])
    await t.test(`mismatched explicit binding ${value}`, () => {
      assert.match(adapters.modelSetupAdapterAddUnavailable(chain, metadataWithBinding(value)), /policy/);
    });
  const unpacked = groups.unpackVisualOperationGroups(graph);
  unpacked.graph.nodes.find((node) => node.id === chain.owner.id).data.params.workflow_id.value = '';
  const legacy = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
  assert.match(
    adapters.modelSetupAdapterAddUnavailable(
      adapters.modelSetupAdapterChain(legacy, root.id),
      metadataWithBinding(operation.workflowId),
    ),
    /policy/,
  );
  for (const workflow of ['image_conditioned', 'unknown_workflow'])
    await t.test(`wrong authored selector ${workflow}`, () => {
      const unpacked = groups.unpackVisualOperationGroups(graph);
      unpacked.graph.nodes.find((node) => node.id === chain.owner.id).data.params.workflow_id.value = workflow;
      const changed = groups.restoreVisualOperationGroups(unpacked.graph, unpacked);
      const before = structuredClone(changed);
      assert.match(
        adapters.modelSetupAdapterAddUnavailable(adapters.modelSetupAdapterChain(changed, root.id), authority),
        /policy/,
      );
      assert.deepEqual(changed, before);
    });
});
