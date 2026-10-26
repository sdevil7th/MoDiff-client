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
const publicSelections = ['Flux3DistilledModularPipeline', 'Flux3ModularPipeline'].flatMap((pipelineClass) =>
  ['text_to_image', 'edit_image'].map((task) => ({
    id: `${pipelineClass}:${task}`,
    selection: {
      pipelineClass,
      task,
      executionProfileId: `${pipelineClass === 'Flux3DistilledModularPipeline' ? 'flux3-klein' : 'flux3-klein-base'}:official-provider:v1`,
    },
  })),
);
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
    drafts: '/src/workflow/workflowDraft.ts',
    choices: '/src/workflow/workflowChoices.ts',
    catalog: '/src/workflow/operationCatalog.ts',
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
      input: JSON.stringify([{ id: 'z_image_quick_concept', selection }, ...publicSelections]),
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

function freshPublicGraph(id) {
  const selected = publicSelections.find((item) => item.id === id).selection;
  const source = fixture.recipes.find((item) => item.id === id).starter;
  const contracts = modules.operations.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const resolved = modules.requests.parseOperationStarter(
    structuredClone(source),
    selected.pipelineClass,
    selected.task,
    contracts,
    selected,
  );
  const draft = modules.drafts.createWorkflowDraft(resolved, fixture.registry);
  assert.deepEqual(draft.notices, []);
  return draft.graph;
}

test('current public profiles seed bounded defaults through ordinary backend starters without changing authored graphs', () => {
  const contracts = modules.operations.parseOperationContracts(
    fixture.publicPayload.operationContracts,
    fixture.publicPayload.operationContractSchemaVersion,
  );
  const support = modules.catalog.parsePipelineSupport(
    fixture.publicPayload.pipelineSupport,
    fixture.publicPayload.pipelineSupportSchemaVersion,
    contracts,
  );
  const descriptors = modules.choices.parseWorkflowModelDescriptors(fixture.publicPayload, support);
  for (const { id, selection: selected } of publicSelections) {
    const before = flow().toObject();
    const graph = freshPublicGraph(id);
    assert.deepEqual(flow().toObject(), before, 'creating a new draft cannot rewrite the current document');
    const descriptor = descriptors.find((item) => item.profileId === selected.executionProfileId);
    assert.equal(descriptor.inventory.defaultWeightFormat, 'fp8r');
    const effective = modules.flow.expandFlowExecutionGraph(graph.nodes, graph.edges);
    const owner = effective.nodes.find((node) => node.data.action === 'ModelsLoader');
    const denoise = effective.nodes.find((node) => node.data.action === 'Denoise');
    const value = (node, field) => node.data.params[field].value ?? node.data.params[field].default;
    assert.equal(value(owner, 'model_type'), selected.pipelineClass);
    assert.equal(value(owner, 'weight_format'), 'fp8r');
    assert.equal(value(owner, 'dtype'), 'bfloat16');
    assert.deepEqual([value(denoise, 'width'), value(denoise, 'height')], [512, 512]);
    assert.equal(value(denoise, 'num_inference_steps'), id.includes('Distilled') ? 16 : 50);
    if (selected.pipelineClass === 'Flux3ModularPipeline') {
      const guider = effective.nodes.find((node) => node.data.action === 'Guider');
      assert.equal(value(guider, 'guidance_scale'), 3.5);
      assert.equal(value(guider, 'guidance_rescale'), 0);
    }
    assert.equal(
      effective.nodes.some((node) => node.data.action === 'ImageEncode'),
      selected.task === 'edit_image',
    );
  }
});

test('real public ordinary graphs retain authored values through one accepted Auto submission and Expert bypass', async () => {
  for (const { id } of publicSelections) {
    const graph = modules.groups.unpackVisualOperationGroups(freshPublicGraph(id)).graph;
    const owner = graph.nodes.find((node) => node.data.action === 'ModelsLoader');
    const encoder = graph.nodes.find((node) => node.data.action === 'EncodePrompt');
    const denoise = graph.nodes.find((node) => node.data.action === 'Denoise');
    // This is mocked transport, not a CUDA/runtime claim. The pure fixture
    // intentionally reports CPU only, which cannot export CPU-offload hooks.
    owner.data.params.device.value = 'cuda';
    encoder.data.params.prompt.value = `Authored ${id} prompt`;
    denoise.data.params.seed.value = { value: 4109, random: false };
    const image = graph.nodes.find((node) => node.data.module === 'modules.Image' && node.data.action === 'Load');
    if (image) image.data.params.file.value = ['unit-managed-inputs/cobalt.png', 'unit-managed-inputs/layout.png'];
    flow().replaceGraph(graph);
    const before = exported();
    const submissions = [],
      requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push(String(url));
      const body = JSON.parse(init.body);
      if (String(url).endsWith('/auto_resource/workflow')) {
        assert.deepEqual(body.graph.nodes, JSON.parse(JSON.stringify(before.nodes)));
        return response({
          ...plan([]),
          loaders: [
            {
              nodeId: owner.id,
              modelType: owner.data.params.model_type.value,
              repository: owner.data.params.repo_id.value.value,
              consumers: [denoise.id],
              candidateId: 'mock-public-fp8r-transport',
            },
          ],
          requirements: { ramGb: 24, vramGb: 8, diskGb: 0 },
          available: { ramGb: 28, vramGb: 12, diskGb: 64 },
        });
      }
      assert.ok(String(url).endsWith('/graph'));
      submissions.push(body);
      return response({ task_id: `mock-transport-${id}`, sid: 'session-1', message: 'queued' });
    };
    modules.studio.useStudioStore.setState({ form: { ...form, resourceMode: 'auto' } });
    const result = await modules.coordinator.coordinateGraphRun({ sid: 'session-1' });
    assert.equal(requests.length, 2);
    assert.equal(submissions.length, 1);
    assert.deepEqual(result.submittedGraph.nodes, before.nodes);
    assert.deepEqual(result.submittedGraph.paths, before.paths);
    assert.equal(result.submittedGraph.runtimeHints.resourceMode, 'auto');
    assert.equal(result.submittedGraph.runtimeHints.workflowAutoPlan.graphHash, plan([]).plannedGraphHash);
    assert.deepEqual(exported(), before);
    modules.studio.useStudioStore.setState({ form: { ...form, resourceMode: 'expert' } });
    await modules.coordinator.coordinateGraphRun({ sid: 'session-1' });
    assert.equal(requests.length, 3, 'Expert adds one submission and never requests an Auto plan');
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[1].nodes, JSON.parse(JSON.stringify(before.nodes)));
  }
});

test('public Auto refusal retains exact authored graph and creates no task or submission', async () => {
  for (const { id } of publicSelections) {
    const graph = modules.groups.unpackVisualOperationGroups(freshPublicGraph(id)).graph;
    const owner = graph.nodes.find((node) => node.data.action === 'ModelsLoader');
    owner.data.params.device.value = 'cuda';
    flow().replaceGraph(graph);
    const before = exported();
    const requests = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      assert.ok(String(url).endsWith('/auto_resource/workflow'));
      return response({
        ...plan([]),
        canAutoRun: false,
        issues: ['No exact qualified FP8r recipe fits this preserved reference workload'],
        available: { ramGb: 28, vramGb: 0, diskGb: 64 },
      });
    };
    await assert.rejects(
      modules.coordinator.coordinateGraphRun({ sid: 'session-1' }),
      /No exact qualified FP8r recipe/,
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(exported(), before);
    assert.equal(modules.studio.useStudioStore.getState().currentRunContext, null);
    assert.deepEqual(modules.tasks.useTaskStore.getState().queuedTasks, {});
  }
});

for (const change of ['graph', 'tab', 'policy', 'cancelled-request'])
  test(`a pending public Auto plan cannot submit after ${change}`, async () => {
    const graph = modules.groups.unpackVisualOperationGroups(freshPublicGraph(publicSelections[0].id)).graph;
    const owner = graph.nodes.find((node) => node.data.action === 'ModelsLoader');
    const encoder = graph.nodes.find((node) => node.data.action === 'EncodePrompt');
    owner.data.params.device.value = 'cuda';
    flow().replaceGraph(graph);
    let release, reject, started;
    const pending = new Promise((resolve, fail) => {
      release = resolve;
      reject = fail;
    });
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    let requests = 0;
    globalThis.fetch = async (url) => {
      requests++;
      assert.ok(String(url).endsWith('/auto_resource/workflow'));
      started();
      return pending;
    };
    const run = modules.coordinator.coordinateGraphRun({ sid: 'session-1' });
    await ready;
    if (change === 'graph') flow().setParamWithHistory(encoder.id, 'prompt', 'A newer authored prompt');
    if (change === 'tab') modules.studio.useStudioStore.setState({ activeWorkflowTabId: 'newer-workflow' });
    if (change === 'policy') modules.studio.useStudioStore.setState({ form: { ...form, resourceMode: 'expert' } });
    const current = flow().toObject();
    if (change === 'cancelled-request') reject(new DOMException('Planning cancelled', 'AbortError'));
    else release(response(plan([])));
    await assert.rejects(run, change === 'cancelled-request' ? /abort|cancel/iu : /workflow or mode changed/);
    assert.equal(requests, 1);
    assert.deepEqual(flow().toObject(), current);
    assert.equal(modules.studio.useStudioStore.getState().currentRunContext, null);
    assert.deepEqual(modules.tasks.useTaskStore.getState().queuedTasks, {});
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
