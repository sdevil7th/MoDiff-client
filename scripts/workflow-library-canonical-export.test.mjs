import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { sanitizeCanonicalWorkflowGraph, canonicalizeGraphIds } from './workflow-library-generator.mjs';
import { retainExistingCanonicalDeviceDefaults } from './workflow-library-contract.mjs';

let server, hooks, flowStore, groups, blockSchema, fixture, templates, builder, defaults, exactness, operations;
let requests;
let shared;
const ids = ['qwen_text_rendering', 'cosmos3_super_text_to_image', 'qwen_outpaint_aspect_template'];

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  const all = (await server.ssrLoadModule('/src/studio/templates.ts')).STUDIO_TEMPLATES;
  templates = ids.map((id) => all.find((item) => item.id === id));
  assert.ok(templates.every(Boolean));
  ({ useFlowStore: flowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  shared = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
  blockSchema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  builder = await server.ssrLoadModule('/src/studio/templateOperationWorkflow.ts');
  exactness = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  requests = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  operations = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  ({ DEFAULT_STUDIO_FORM: defaults } = await server.ssrLoadModule('/src/studio/modelProfiles.ts'));
  const e2e = await server.ssrLoadModule('/src/utils/e2eHooks.ts');
  e2e.installE2EHooks();
  hooks = window.__MODIFF_E2E__;
  assert.ok(hooks);
  const python = process.env.MODIFF_BACKEND_PYTHON;
  assert.ok(python, 'Use the declared ordinary CPU schema fixture environment.');
  fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: path.resolve('../MoDiff'),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      input: JSON.stringify(templates.map((item) => ({ id: item.id, selection: item.executionSelection }))),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }),
  );
});
after(async () => server?.close());

test('pair regeneration preserves canonical device defaults without changing authored controls or identities', () => {
  const loader = (device) => ({
    id: 'loader',
    data: {
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      params: { device: { type: 'str', value: 'cuda:0', options: { 'cpu:0': {}, 'cuda:0': {} } } },
      operationAuthoring: {
        operation: { operationId: 'diffusion.load_models', binding: { values: { model_type: 'Example' } } },
        defaults: { device, dtype: 'bfloat16' },
      },
    },
  });
  const preview = (device) => ({
    id: 'preview',
    data: {
      module: 'modules.Image',
      action: 'Preview',
      params: { device: { type: 'str', default: device, options: { 'cpu:0': {}, 'cuda:0': {} } } },
    },
  });
  const original = { nodes: [loader('cpu:0'), preview('cpu:0')], edges: [] };
  const regenerated = { nodes: [preview('cuda:0'), loader('cuda:0')], edges: [] };
  const before = structuredClone(regenerated);
  const retained = retainExistingCanonicalDeviceDefaults(regenerated, original);
  assert.equal(retained.nodes[0].data.params.device.default, 'cpu:0');
  assert.equal(retained.nodes[1].data.operationAuthoring.defaults.device, 'cpu:0');
  assert.equal(retained.nodes[1].data.params.device.value, 'cuda:0', 'The authored CUDA selection is retained.');
  assert.deepEqual(
    retained.nodes[1].data.operationAuthoring.operation,
    before.nodes[1].data.operationAuthoring.operation,
  );
  assert.deepEqual(retained.nodes[1].data.params, before.nodes[1].data.params);
  assert.deepEqual(retained.nodes[0].data.params.device.options, before.nodes[0].data.params.device.options);
  assert.deepEqual(
    original.nodes.map((node) => node.id),
    ['loader', 'preview'],
    'The existing graph is not mutated.',
  );
  const changedIdentity = structuredClone(before);
  changedIdentity.nodes[1].data.operationAuthoring.operation.binding.values.model_type = 'Different';
  retainExistingCanonicalDeviceDefaults(changedIdentity, original);
  assert.equal(changedIdentity.nodes[1].data.operationAuthoring.defaults.device, 'cuda:0');
  const ambiguous = structuredClone(before);
  ambiguous.nodes.push(structuredClone(ambiguous.nodes[0]));
  assert.throws(() => retainExistingCanonicalDeviceDefaults(ambiguous, original), /unambiguous/);
  assert.deepEqual(ambiguous.nodes[0], before.nodes[0], 'A rejected migration must not partially alter defaults.');
  const incompatible = structuredClone(before);
  incompatible.nodes[0].data.params.device.options = { 'cuda:0': {} };
  assert.throws(() => retainExistingCanonicalDeviceDefaults(incompatible, original), /unavailable/);
  assert.equal(incompatible.nodes[1].data.operationAuthoring.defaults.device, 'cuda:0');
  const added = preview('cuda:0');
  added.data.action = 'NewPreview';
  const freshStage = { nodes: [added], edges: [] };
  retainExistingCanonicalDeviceDefaults(freshStage, original);
  assert.equal(added.data.params.device.default, 'cuda:0', 'New stages retain their declared fresh defaults.');
});

test('canonical sanitization preserves weight-loading selectors and existing portable device semantics', () => {
  for (const mode of ['cpu', 'cuda']) {
    const selector = {
      type: 'string',
      default: mode,
      value: mode,
      options: [
        { schemaVersion: 1, value: 'cpu', label: 'cpu', compatibility: 'compatible' },
        { schemaVersion: 1, value: 'cuda', label: 'cuda', compatibility: 'compatible' },
      ],
      fieldOptions: { controlTier: 'advanced' },
    };
    const graph = {
      nodes: [
        {
          id: 'models',
          data: {
            module: 'modules.ModularDiffusers',
            action: 'ModelsLoader',
            params: {
              weight_loading_mode: selector,
              device: { default: 'cuda:1', value: 'cuda:1', options: ['cpu:0', 'cuda:1'] },
              device_map: { default: 'cpu', value: 'cuda', options: ['cpu', 'cuda'] },
              unrelated: { value: 'cuda:1' },
            },
            operationAuthoring: { defaults: { weight_loading_mode: mode, device: 'cuda:1' } },
          },
        },
      ],
      edges: [],
    };
    const before = structuredClone(graph);
    const data = sanitizeCanonicalWorkflowGraph(graph).nodes[0].data;
    assert.deepEqual(data.params.weight_loading_mode, selector, 'Enum values/defaults/options are not device IDs.');
    assert.deepEqual(data.operationAuthoring.defaults, graph.nodes[0].data.operationAuthoring.defaults);
    assert.deepEqual(data.params.device, graph.nodes[0].data.params.device);
    assert.deepEqual(data.params.device_map, graph.nodes[0].data.params.device_map);
    assert.equal(data.params.unrelated.value, 'cpu:0', 'Existing unrelated device-token normalization is retained.');
    assert.deepEqual(graph, before, 'Canonical sanitization does not mutate the saved graph.');
  }
});

function build(id) {
  const template = templates.find((item) => item.id === id);
  const row = fixture.recipes.find((item) => item.id === id);
  const contracts = operations.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const starter = requests.parseOperationStarter(
    row.starter,
    row.starter.pipelineClass,
    row.starter.task,
    contracts,
    template.executionSelection,
  );
  const device = starter.nodes.find((item) => item.operation.decomposition === 'loader').node.params.device;
  const form = {
    ...defaults,
    ...exactness.getTemplateLockedSettings(template),
    device: device.value ?? device.default,
    autoOffload: false,
    offloadMode: 'none',
  };
  return builder.createTemplateOperationGraph(
    template,
    form,
    starter,
    fixture.registry,
    row.spec,
    fixture.capabilities.find((item) => item.modelType === template.modelType),
  );
}

function semanticApi(graph) {
  const api = flowStore
    .getState()
    .exportGraph('canonical-export-contract', undefined, { sourceGraph: graph, randomizeSeeds: false });
  const names = new Map(Object.entries(api.nodes).map(([id, node]) => [id, `${node.module}.${node.action}`]));
  assert.equal(new Set(names.values()).size, names.size, 'These independently chosen witnesses have unique actions.');
  return Object.entries(api.nodes)
    .map(([id, node]) => ({
      identity: names.get(id),
      params: Object.fromEntries(
        Object.entries(node.params).map(([key, param]) => [
          key,
          param && typeof param === 'object' && 'sourceId' in param
            ? { ...param, sourceId: names.get(param.sourceId) }
            : param,
        ]),
      ),
    }))
    .sort((a, b) => a.identity.localeCompare(b.identity));
}

test('canonical library projection preserves real Cosmos/Qwen controls, wires and owner identity without rewriting grouped saves', async () => {
  for (const id of ids) {
    const graph = build(id);
    const expectedApi = semanticApi(graph);
    const expectedOwners = groups
      .unpackVisualOperationGroups(graph)
      .graph.nodes.filter((node) => node.data.operationAuthoring?.operation.decomposition === 'loader')
      .map((node) => node.data.operationAuthoring.operation.binding);
    assert.ok(graph.nodes.some(groups.visualOperationGroup));
    flowStore.setState({ nodes: structuredClone(graph.nodes), edges: structuredClone(graph.edges) });
    const ordinarySave = await hooks.prepareWorkflowGraphForExport();
    const definitionHashes = ordinarySave.nodes
      .filter(groups.visualOperationGroup)
      .map((node) => node.data.blockInstanceV2.definitionSnapshot.contentHash);
    const exported = await hooks.prepareWorkflowGraphForExport({ canonicalLibrary: true });
    assert.equal(exported.nodes.some(groups.visualOperationGroup), false, id);
    assert.deepEqual(semanticApi(exported), expectedApi, id);
    assert.deepEqual(
      exported.nodes
        .filter((node) => node.data.operationAuthoring?.operation.decomposition === 'loader')
        .map((node) => node.data.operationAuthoring.operation.binding),
      expectedOwners,
      id,
    );
    const sanitized = sanitizeCanonicalWorkflowGraph(exported);
    assert.deepEqual(semanticApi(sanitized), expectedApi, 'Only transient UI/preview state may be removed.');
    if (id === ids[2]) {
      const encoder = sanitized.nodes.find((node) => node.data.action === 'ImageEncode');
      assert.equal(
        shared.sharedOperationInput(sanitized.nodes, sanitized.edges, encoder.id, 'seed')?.members.length,
        2,
        'The actual masked workflow exposes its single state-owned seed before ID canonicalization.',
      );
    }
    const canonical = canonicalizeGraphIds(structuredClone(sanitized), shared.remapOperationAuthoring);
    assert.deepEqual(
      semanticApi(canonical),
      expectedApi,
      'Canonical IDs preserve every executable parameter and wire.',
    );
    for (const node of canonical.nodes) {
      for (const binding of node.data.operationAuthoring?.sharedInputs ?? []) {
        assert.ok(
          canonical.nodes.some((owner) => owner.id === binding.loaderId),
          'The editing owner must use its canonical ID.',
        );
      }
    }
    if (id === ids[2]) {
      const encoder = canonical.nodes.find((node) => node.data.action === 'ImageEncode');
      assert.equal(
        shared.sharedOperationInput(canonical.nodes, canonical.edges, encoder.id, 'seed')?.members.length,
        2,
      );
    }
    assert.deepEqual(
      flowStore
        .getState()
        .nodes.filter(groups.visualOperationGroup)
        .map((node) => node.data.blockInstanceV2.definitionSnapshot.contentHash),
      definitionHashes,
    );
    assert.ok((await hooks.prepareWorkflowGraphForExport()).nodes.some(groups.visualOperationGroup));
  }
});

test('canonical projection leaves user Blocks intact and rejects malformed visual definition hashes', async () => {
  const graph = build(ids[0]);
  const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs');
  const definition = structuredClone(root.data.blockInstanceV2.definitionSnapshot);
  definition.source.provider = 'operator-authored-example';
  definition.contentHash = blockSchema.blockDefinitionContentHashV2(definition);
  root.data.blockInstanceV2.definitionSnapshot = blockSchema.normalizeBlockDefinitionV2(definition);
  root.data.blockInstanceV2.definitionRef.contentHash = definition.contentHash;
  flowStore.setState({ nodes: structuredClone(graph.nodes), edges: structuredClone(graph.edges) });
  const exported = await hooks.prepareWorkflowGraphForExport({ canonicalLibrary: true });
  const retained = exported.nodes.find((node) => node.id === root.id);
  assert.ok(retained?.data.blockInstanceV2);
  assert.deepEqual(retained.data.blockInstanceV2.definitionSnapshot, definition);
  const malformed = build(ids[0]);
  flowStore.setState({ nodes: malformed.nodes, edges: malformed.edges });
  flowStore.getState().nodes.find(groups.visualOperationGroup).data.blockInstanceV2.definitionSnapshot.contentHash =
    'block-definition-v2-00000000';
  await assert.rejects(hooks.prepareWorkflowGraphForExport({ canonicalLibrary: true }), /contentHash/);
});
