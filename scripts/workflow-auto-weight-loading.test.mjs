import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

const selection = {
  pipelineClass: 'ZImageModularPipeline',
  task: 'text_to_image',
  executionProfileId: 'z-image:modular',
  authoringRecipeId: 'retained-z-image-text-to-image:v1',
  bindingSpec: { modelType: 'ZImageModularPipeline', mode: 'modular_text_to_image' },
};
let server, fixture, row, starter, template, form, modules, originalFetch;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    localStorage: globalThis.localStorage,
    location: { origin: 'http://127.0.0.1:5191' },
    dispatchEvent: () => true,
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  const paths = {
    operations: '/src/workflow/operationContracts.ts',
    requests: '/src/workflow/operationStarterRequest.ts',
    factory: '/src/workflow/nodeFactory.ts',
    authoring: '/src/studio/templateOperationWorkflow.ts',
    groups: '/src/workflow/visualOperationGroups.ts',
    templates: '/src/studio/templates.ts',
    profiles: '/src/studio/modelProfiles.ts',
    exactness: '/src/studio/templateExactness.ts',
    flow: '/src/stores/useFlowStore.ts',
    studio: '/src/stores/useStudioStore.ts',
    tasks: '/src/stores/useTaskStore.ts',
    coordinator: '/src/studio/runCoordinator.ts',
    auto: '/src/studio/workflowAutoExecutionV2.ts',
    schema: '/src/studio/blockSchemaV2.ts',
    block: '/src/studio/blockRuntimeV2.ts',
  };
  modules = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([name, file]) => [name, await server.ssrLoadModule(file)])),
  );
  const backend = path.resolve('../MoDiff');
  const python = process.env.MODIFF_BACKEND_PYTHON || path.join(backend, '.venv', 'Scripts/python.exe');
  fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: backend,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      input: JSON.stringify([{ id: 'z_image_quick_concept', selection }]),
    }),
  );
  row = fixture.recipes[0];
  const contracts = modules.operations.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  starter = modules.requests.parseOperationStarter(
    row.starter,
    selection.pipelineClass,
    selection.task,
    contracts,
    selection,
  );
  template = structuredClone(modules.templates.STUDIO_TEMPLATES.find((item) => item.id === row.id));
  const device = row.starter.nodes.find((node) => node.operation.decomposition === 'loader').node.params.device;
  form = {
    ...modules.profiles.DEFAULT_STUDIO_FORM,
    ...modules.exactness.getTemplateLockedSettings(template),
    modelType: selection.bindingSpec.modelType,
    mode: selection.bindingSpec.mode,
    device: device.value ?? device.default,
    autoOffload: false,
    offloadMode: 'none',
    resourceMode: 'auto',
  };
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  modules.studio.useStudioStore.setState({
    form,
    activeWorkflowTabId: 'weight-loading-workflow',
    workflowTabs: [],
    workflowCanvasHydrated: true,
    workflowCanvasEpoch: 0,
    workflowFormEpoch: 0,
    graphBinding: null,
    currentRunContext: null,
    runContextsByClientRunId: {},
    runContextsByTaskId: {},
    outputs: [],
  });
  modules.tasks.useTaskStore.setState({
    queuedTasks: {},
    currentTask: undefined,
    failedTasks: {},
    sessionRuns: [],
    taskCount: 0,
  });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function freshGraph() {
  return modules.authoring.createTemplateOperationGraph(
    template,
    form,
    starter,
    fixture.registry,
    row.spec,
    row.capability,
  );
}
const flow = () => modules.flow.useFlowStore.getState();
const exported = () => flow().exportGraph('', undefined, { randomizeSeeds: false });
const loaderId = (graph) => Object.keys(graph.nodes).find((id) => graph.nodes[id].action === 'ModelsLoader');
const response = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const plan = (patches) => ({
  schemaVersion: 1,
  graphHash: `sha256:workflow-auto-v1:${'a'.repeat(64)}`,
  plannedGraphHash: `sha256:workflow-auto-v1:${'b'.repeat(64)}`,
  canAutoRun: true,
  issues: [],
  message: 'Transport fixture, not a hardware admission',
  patches,
  loaders: [],
  requirements: {},
  available: {},
  sharedMemory: false,
});

test('actual backend weight-loading descriptor survives factory, fresh Model Setup and API serialization', () => {
  const key = 'modules.ModularDiffusers.ModelsLoader';
  const descriptor = fixture.registry[key].params.weight_loading_mode;
  assert.ok(descriptor, 'The backend must publish the descriptor; no synthetic substitute is accepted.');
  assert.equal(descriptor.type, 'string');
  assert.equal(descriptor.value ?? descriptor.default, 'cpu');
  assert.deepEqual(
    Array.isArray(descriptor.options)
      ? descriptor.options.map((option) => (typeof option === 'string' ? option : option.value))
      : Object.keys(descriptor.options),
    ['cpu', 'cuda'],
  );
  assert.equal(descriptor.fieldOptions.controlTier, 'advanced');
  const node = modules.factory.createNodeFromRegistry(key, fixture.registry, { x: 0, y: 0 });
  assert.deepEqual(node.data.params.weight_loading_mode, descriptor);
  node.data.params.weight_loading_mode.value = 'cuda';
  assert.equal(descriptor.value ?? descriptor.default, 'cpu');
  const graph = freshGraph();
  assert.equal(graph.nodes.filter((node) => !node.data.blockProjectionOwnerId).length, 4);
  flow().replaceGraph(graph);
  const api = exported();
  const id = loaderId(api);
  assert.equal(api.nodes[id].params.weight_loading_mode.value, 'cpu');
  assert.equal(JSON.parse(JSON.stringify(api)).nodes[id].params.weight_loading_mode.value, 'cpu');
  const owner = modules.groups
    .unpackVisualOperationGroups(graph)
    .graph.nodes.find((node) => node.data.action === 'ModelsLoader');
  const declared = row.starter.nodes.find((node) => node.operation.decomposition === 'loader').node.params
    .weight_loading_mode;
  // Ordinary Block projection applies its instance value and prevents the
  // mounted field from overwriting the already-resolved starter contract.
  assert.deepEqual(owner.data.params.weight_loading_mode, {
    ...declared,
    value: 'cpu',
    fieldOptions: { ...declared.fieldOptions, suppressInitialFieldAction: true },
  });
});

test('fresh image coordinator serializes the enum patch and preserves model and creative fields with one Undo', async () => {
  flow().replaceGraph(freshGraph());
  const before = exported(),
    id = loaderId(before),
    requests = [];
  const originalDefinition = structuredClone(
    flow().nodes.find((node) =>
      node.data.blockInstanceV2?.effectiveGraph.nodes.some((child) => child.data.action === 'ModelsLoader'),
    ).data.blockInstanceV2.definitionSnapshot,
  );
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    if (String(url).endsWith('/auto_resource/workflow'))
      return response(plan([{ nodeId: id, field: 'weight_loading_mode', value: 'cuda' }]));
    assert.ok(String(url).endsWith('/graph'));
    return response({ task_id: 'metadata-transport-only', sid: 'session-1', message: 'queued' });
  };
  const result = await modules.coordinator.coordinateGraphRun({
    sid: 'session-1',
    preparedGraph: before,
    studioContext: { applyRuntimeMetadata: false, clearChangedPreviews: false },
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.graph.nodes[id].params.weight_loading_mode.value, 'cpu');
  assert.equal(requests[1].body.nodes[id].params.weight_loading_mode.value, 'cuda');
  const expected = structuredClone(before.nodes);
  expected[id].params.weight_loading_mode.value = 'cuda';
  assert.deepEqual(result.submittedGraph.nodes, expected);
  assert.deepEqual(exported().nodes, expected);
  assert.equal(result.submittedGraph.runtimeHints.workflowAutoPlan.graphHash, plan([]).plannedGraphHash);
  assert.deepEqual(
    flow().nodes.find((node) =>
      node.data.blockInstanceV2?.effectiveGraph.nodes.some((child) => child.data.action === 'ModelsLoader'),
    ).data.blockInstanceV2.definitionSnapshot,
    originalDefinition,
  );
  flow().undo();
  assert.deepEqual(exported(), before);
  flow().redo();
  assert.deepEqual(exported().nodes, expected);
});

test('actual loader descriptor supports atomic mirrored controls and runtime previous-value agreement', async () => {
  const realLoader = modules.groups
    .unpackVisualOperationGroups(freshGraph())
    .graph.nodes.find((node) => node.data.action === 'ModelsLoader');
  const nodes = ['loader', 'peer'].map((nodeId) => ({
    nodeId,
    nodeType: 'custom',
    data: structuredClone(realLoader.data),
  }));
  const graph = { nodes, edges: [], executionOrder: ['loader', 'peer'] };
  graph.graphHash = modules.schema.blockGraphHashV2(graph);
  const definition = {
    schemaVersion: 2,
    definitionId: 'user:weight-loading',
    displayName: 'Weight loading',
    source: { kind: 'user' },
    graph,
    boundary: { mode: 'explicit', inputs: [], outputs: [] },
    controls: [
      {
        controlId: 'weight-loading',
        label: 'Weight loading',
        valueType: 'string',
        defaultValue: 'cpu',
        required: false,
        order: 0,
        binding: { nodeId: 'loader', fieldId: 'weight_loading_mode' },
        mirrorBindings: [{ nodeId: 'peer', fieldId: 'weight_loading_mode' }],
      },
    ],
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  definition.contentHash = modules.schema.blockDefinitionContentHashV2(definition);
  const root = modules.block.createBlockRootNodeV2(
    modules.schema.createBlockInstanceV2(definition, {
      instanceId: 'mirrored-weight-loading',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 320 },
      values: { 'weight-loading': 'cpu' },
    }),
  );
  flow().replaceGraph({ nodes: [root], edges: [] });
  const before = exported();
  const patches = ['loader', 'peer'].map((nodeId) => ({
    nodeId: modules.block.blockProjectionNodeIdV2(root.id, nodeId),
    field: 'weight_loading_mode',
    value: 'cuda',
  }));
  globalThis.fetch = async () => response(plan(patches));
  const submitted = await modules.auto.prepareWorkflowAutoExecutionV2(before);
  assert.deepEqual(submitted.runtimeHints.workflowAutoPlan.resourceControlGroups, [
    patches.map(({ nodeId, field }) => ({ nodeId, field })),
  ]);
  assert.deepEqual(exported().nodes, submitted.nodes);
  assert.throws(
    () =>
      modules.auto.applyRuntimeWorkflowAutoSettingsV2(
        patches.map((patch, index) => ({ ...patch, value: index ? 'cpu' : 'cuda', previousValue: 'cuda' })),
      ),
    /shared resource control/,
  );
  assert.deepEqual(exported().nodes, submitted.nodes);
  flow().undo();
  assert.deepEqual(exported(), before);
});

test('legacy missing and connected actual loader settings are preserved before any mock Graph submission', async () => {
  for (const connected of [false, true]) {
    const graph = modules.groups.unpackVisualOperationGroups(freshGraph()).graph;
    const owner = graph.nodes.find((node) => node.data.action === 'ModelsLoader');
    if (!connected) delete owner.data.params.weight_loading_mode;
    flow().replaceGraph(graph);
    const before = exported(),
      id = loaderId(before),
      requests = [];
    if (connected) before.nodes[id].params.weight_loading_mode = { sourceId: 'external-author', sourceKey: 'mode' };
    const snapshot = structuredClone(flow().toObject());
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      assert.ok(String(url).endsWith('/auto_resource/workflow'));
      return response(plan([{ nodeId: id, field: 'weight_loading_mode', value: 'cuda' }]));
    };
    await assert.rejects(
      modules.coordinator.coordinateGraphRun({
        sid: 'session-1',
        preparedGraph: before,
        studioContext: { applyRuntimeMetadata: false, clearChangedPreviews: false },
      }),
      /missing, connected or repeated/,
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(flow().toObject(), snapshot);
  }
});
