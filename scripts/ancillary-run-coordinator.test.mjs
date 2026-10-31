import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

const ROOT = process.cwd();
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/ancillary-authoring.v1.json'), 'utf8'));
const actual = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/ancillary-starter.v1.json'), 'utf8'));
const cache = mkdtempSync(path.join(tmpdir(), 'modiff-ancillary-coordinator-'));
let server,
  flow,
  studio,
  nodesStore,
  coordinator,
  scopes,
  transport,
  preparation,
  runtime,
  schema,
  originalFetch,
  sent,
  metadata,
  reply;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.window = { dispatchEvent: () => true, localStorage, location: { origin: 'http://127.0.0.1:5191' } };
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Network forbidden during module loading');
  };
  server = await createServer({
    root: ROOT,
    cacheDir: cache,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  ({ useFlowStore: flow } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  ({ useStudioStore: studio } = await server.ssrLoadModule('/src/stores/useStudioStore.ts'));
  ({ useNodesStore: nodesStore } = await server.ssrLoadModule('/src/stores/useNodeStore.ts'));
  ({ coordinateGraphRun: coordinator } = await server.ssrLoadModule('/src/studio/runCoordinator.ts'));
  scopes = await server.ssrLoadModule('/src/workflow/prepareExecutionScope.ts');
  transport = await server.ssrLoadModule('/src/utils/runGraph.ts');
  preparation = await server.ssrLoadModule('/src/studio/runPreparation.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
});
beforeEach(() => {
  studio.setState({
    form: { ...studio.getState().form, resourceMode: 'expert' },
    activeWorkflowTabId: 'source-unit-tab',
    workflowCanvasHydrated: true,
    workflowCanvasEpoch: 0,
    workflowFormEpoch: 0,
    activeTemplateId: null,
    graphBinding: null,
    workflowTabs: [],
    currentRunContext: null,
    outputs: [],
    runContextsByClientRunId: {},
    runContextsByTaskId: {},
  });
  sent = [];
  metadata = [];
  reply = structuredClone(actual.response);
  globalThis.fetch = async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    const body = JSON.parse(init.body);
    if (endpoint === '/operations/starter') {
      metadata.push(body);
      assert.deepEqual({ ...body, repository: undefined }, { ...actual.selection, repository: undefined });
      if (body.repository) assert.equal(body.repository, actual.response.nodes[0].node.params.repo_id.value.value);
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(endpoint, '/graph', 'No server or external model traffic is permitted.');
    sent.push(body);
    return new Response(
      JSON.stringify({
        error: false,
        message: 'Synthetic transport receipt only',
        sid: 'unit',
        task_id: `unit-task-${sent.length}`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
  rmSync(cache, { recursive: true, force: true });
});
function setup(claim = true) {
  const row = fixture.parents[0],
    parent = JSON.parse(row.rawParentJson),
    child = parent.ancillaryOperations[0];
  assert.deepEqual(
    parent,
    actual.response.authoring,
    'Actual source-produced starter and parent recipe must stay paired.',
  );
  const binding = {
    contractId: child.id,
    contentHash: child.contentHash,
    parent: { ...child.parent, authoringContentHash: parent.contentHash },
    parentRoleNodes: Object.fromEntries(parent.roles.map(([r]) => [r, `main-${r}`])),
    roleNodes: Object.fromEntries(child.roles.map(([r]) => [r, `aux-${r}`])),
  };
  const registry = {
    ...structuredClone(row.registry),
    ...Object.fromEntries(
      actual.response.nodes.map(({ operation, node }) => [operation.nodeKey, structuredClone(node)]),
    ),
  };
  const nodes = [
    ...parent.roles.map((r) => [binding.parentRoleNodes, r]),
    ...child.roles.map((r) => [binding.roleNodes, r]),
  ].map(([map, [r, key, x, y]]) => ({
    id: map[r],
    type: 'custom',
    position: { x, y },
    data: structuredClone(registry[key]),
  }));
  for (const node of nodes) {
    if (node.data.params.offload_mode) node.data.params.offload_mode.value = 'none';
    if (node.data.params.auto_offload) node.data.params.auto_offload.value = false;
  }
  if (claim)
    nodes.find((n) => n.id === binding.parentRoleNodes[child.bindings.owner.role]).data.operationAuthoring = {
      ancillaryBindings: [binding],
    };
  const edges = [
    ...parent.edges.map((r) => [binding.parentRoleNodes, r]),
    ...child.edges.map((r) => [binding.roleNodes, r]),
  ].map(([map, [a, b, c, d]], index) => ({
    id: `e-${index}`,
    source: map[a],
    sourceHandle: b,
    target: map[c],
    targetHandle: d,
  }));
  for (const [role, name, value] of child.initialValues)
    nodes.find((n) => n.id === binding.roleNodes[role]).data.params[name].value = structuredClone(value);
  flow.setState({ nodes, edges });
  nodesStore.setState({ nodesRegistry: registry, operationContracts: actual.operationContracts });
  return { nodes, edges, parent, child, binding, target: binding.roleNodes[child.bindings.output.role] };
}
test('claimed synchronous export refuses without a current declaration witness', () => {
  setup();
  assert.throws(() => flow.getState().exportGraph('unit', undefined, { randomizeSeeds: false }), /scope|declaration/iu);
  assert.equal(metadata.length, 0);
});
test('runtime resource updates preserve ancillary claims without requesting execution authority', async () => {
  const f = setup();
  const auto = await server.ssrLoadModule('/src/studio/workflowAutoExecutionV2.ts');
  const nodeId = f.binding.parentRoleNodes.models;
  flow.getState().setParam(nodeId, 'device', 'cuda:0');
  const before = flow.getState().toObject();
  const historyLength = flow.getState().historyPast.length;
  auto.applyRuntimeWorkflowAutoSettingsV2([
    { nodeId, field: 'offload_mode', previousValue: 'none', value: 'model_cpu' },
    { nodeId, field: 'auto_offload', previousValue: false, value: true },
  ]);
  assert.equal(flow.getState().nodes.find((node) => node.id === nodeId).data.params.offload_mode.value, 'model_cpu');
  assert.throws(
    () =>
      auto.applyRuntimeWorkflowAutoSettingsV2([
        { nodeId, field: 'offload_mode', previousValue: 'none', value: 'group_disk' },
      ]),
    /newer workflow edits/u,
  );
  assert.equal(metadata.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(flow.getState().historyPast.length, historyLength + 1);
  flow.getState().undo();
  const loader = flow.getState().nodes.find((node) => node.id === nodeId);
  assert.equal(loader.data.params.offload_mode.value, 'none');
  assert.equal(loader.data.params.auto_offload.value, false);
  assert.deepEqual(
    flow.getState().nodes.map((node) => node.data.operationAuthoring),
    before.nodes.map((node) => node.data.operationAuthoring),
  );
  assert.throws(() => flow.getState().exportGraph('unit', undefined, { randomizeSeeds: false }), /scope|declaration/iu);
});
test('actual coordinator ordinary submission excludes only declared branch and preserves durable document', async () => {
  const f = setup(),
    before = JSON.stringify(flow.getState().toObject());
  const result = await coordinator({ sid: 'unit' });
  assert.equal(JSON.stringify(flow.getState().toObject()), before);
  assert.deepEqual(Object.keys(result.submittedGraph.nodes).sort(), Object.values(f.binding.parentRoleNodes).sort());
  assert.equal(result.submittedGraph.runtimeHints.executionPurpose.kind, 'workflow');
  assert.equal(result.submittedGraph.runtimeHints.resourceMode, 'expert');
  assert.equal(studio.getState().form.resourceMode, 'expert');
  assert.equal(metadata.length, 2);
  assert.equal(sent.length, 1);
});
test('queued claimed run uses the same declared ordinary scope', async () => {
  const f = setup(),
    result = await coordinator({ sid: 'unit', deferCanvasOwnership: true });
  assert.deepEqual(Object.keys(result.submittedGraph.nodes).sort(), Object.values(f.binding.parentRoleNodes).sort());
});
test('Preview is selected from actual declared output and does not run image owner', async () => {
  const f = setup();
  const owner = f.nodes.find((node) => node.id === f.binding.parentRoleNodes[f.child.bindings.owner.role]);
  const request = f.nodes.find((node) => node.id === f.binding.roleNodes[f.child.bindings.request.role]);
  for (const [a, b] of [
    [f.child.bindings.owner.promptField, f.child.bindings.request.promptField],
    [f.child.bindings.owner.layoutField, f.child.bindings.request.layoutField],
  ])
    request.data.params[b].value = owner.data.params[a].value ?? owner.data.params[a].default ?? null;
  const result = await coordinator({
    sid: 'unit',
    previewTarget: { nodeId: f.target, outputField: f.child.bindings.output.field },
  });
  assert.deepEqual(Object.keys(result.submittedGraph.nodes).sort(), Object.values(f.binding.roleNodes).sort());
  assert.equal(result.submittedGraph.runtimeHints.executionPurpose.kind, 'explicit_preview');
  assert.equal(result.submittedGraph.runtimeHints.resourceMode, 'expert');
  assert.equal(studio.getState().form.resourceMode, 'expert');
});
for (const change of ['loops-empty', 'loops-foreign', 'purpose-kind', 'purpose-absent'])
  test(`prepared graph cannot replace claimed ${change}`, async () => {
    const f = setup(),
      scope = await scopes.prepareExecutionScope();
    const prepared = flow.getState().exportGraph('unit', undefined, { executionScope: scope, randomizeSeeds: false });
    if (change === 'loops-empty') prepared.loops = [];
    if (change === 'loops-foreign') prepared.loops = [{ id: 'foreign', bodyNodeIds: [f.target] }];
    if (change === 'purpose-kind')
      prepared.runtimeHints.executionPurpose = { ...prepared.runtimeHints.executionPurpose, kind: 'explicit_preview' };
    if (change === 'purpose-absent') delete prepared.runtimeHints.executionPurpose;
    await assert.rejects(
      coordinator({ sid: 'unit', executionScope: scope, preparedGraph: prepared }),
      /scope|loop|purpose/iu,
    );
    assert.equal(sent.length, 0);
  });
test('unavailable private endpoint refuses before seeds, preparation, history or dispatch', async () => {
  setup();
  const before = JSON.stringify(flow.getState().toObject());
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Unavailable private execution profile' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  await assert.rejects(coordinator({ sid: 'unit' }), /Unavailable|400|request/iu);
  assert.equal(JSON.stringify(flow.getState().toObject()), before);
  assert.equal(sent.length, 0);
});
test('metadata cannot be used after a concurrent authored edit', async () => {
  const f = setup(),
    original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const result = await original(...args);
    flow
      .getState()
      .setParam(
        f.binding.parentRoleNodes[f.child.bindings.owner.role],
        f.child.bindings.owner.promptField,
        'new authored caption',
      );
    return result;
  };
  await assert.rejects(coordinator({ sid: 'unit' }), /changed/iu);
  assert.equal(sent.length, 0);
});
test('metadata cannot be used after a tab or resource-mode epoch changes', async () => {
  setup();
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const result = await original(...args);
    studio.setState({ workflowFormEpoch: 1 });
    return result;
  };
  await assert.rejects(coordinator({ sid: 'unit' }), /changed/iu);
  assert.equal(sent.length, 0);
});
test('a changed selected registry cannot adopt an in-flight declaration response', async () => {
  setup();
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const result = await original(...args);
    const registry = structuredClone(nodesStore.getState().nodesRegistry);
    registry[actual.response.nodes[0].operation.nodeKey].params.revision.label = 'new metadata';
    nodesStore.setState({ nodesRegistry: registry });
    return result;
  };
  await assert.rejects(coordinator({ sid: 'unit' }), /metadata changed/iu);
  assert.equal(sent.length, 0);
});
test('serialized witness and stale literal revision refuse', async () => {
  const f = setup(),
    scope = await scopes.prepareExecutionScope();
  assert.throws(
    () => flow.getState().exportGraph('unit', undefined, { executionScope: JSON.parse(JSON.stringify(scope)) }),
    /scope/iu,
  );
  const model = f.nodes.find((node) => node.id === f.binding.parentRoleNodes.models);
  model.data.params.revision.value = '1'.repeat(40);
  await assert.rejects(scopes.prepareExecutionScope(), /revision/iu);
  assert.equal(sent.length, 0);
});
test('node target cannot silently convert an image substage or child into Preview', async () => {
  const f = setup();
  await assert.rejects(
    coordinator({ sid: 'unit', targetNodeId: f.target }),
    /Preview|parent|scope|executable output/iu,
  );
  await assert.rejects(coordinator({ sid: 'unit', targetNodeId: f.binding.parentRoleNodes.models }), /parent|scope/iu);
  assert.equal(sent.length, 0);
});
test('forged low-level claimed API graph needs the same witness', async () => {
  const f = setup();
  await assert.rejects(
    transport.runGraph('unit', undefined, {
      sid: 'unit',
      nodes: {},
      paths: [],
      runtimeHints: { executionPurpose: { schemaVersion: 1, kind: 'workflow', bindings: [f.binding], target: null } },
    }),
    /scope/iu,
  );
});
test('unclaimed all-sinks, explicit leaf and Queue retain old export behavior without metadata', async () => {
  const f = setup(false);
  const all = await coordinator({ sid: 'unit' });
  assert.deepEqual(Object.keys(all.submittedGraph.nodes).sort(), f.nodes.map((n) => n.id).sort());
  const leaf = await coordinator({ sid: 'unit', targetNodeId: f.target });
  assert.deepEqual(Object.keys(leaf.submittedGraph.nodes).sort(), Object.values(f.binding.roleNodes).sort());
  const queue = await coordinator({ sid: 'unit', deferCanvasOwnership: true });
  assert.deepEqual(Object.keys(queue.submittedGraph.nodes).sort(), f.nodes.map((n) => n.id).sort());
  assert.equal(metadata.length, 0);
});
test('run-input identity includes claimed loops/purpose but leaves old graph hash domain unchanged', async () => {
  setup();
  const scope = await scopes.prepareExecutionScope();
  const graph = flow.getState().exportGraph('unit', undefined, { executionScope: scope, randomizeSeeds: false });
  const hash = preparation.getStudioRunInputHash(studio.getState().form, graph);
  assert.notEqual(hash, preparation.getStudioRunInputHash(studio.getState().form, { ...graph, loops: [] }));
  const old = { ...graph, runtimeHints: undefined };
  assert.equal(
    preparation.getStudioRunInputHash(studio.getState().form, old),
    preparation.getStudioRunInputHash(studio.getState().form, { ...old, loops: [] }),
  );
});

test('actual native Block leaves keep both remapped role maps across ordinary Block Run and portable reinsertion', async () => {
  const f = setup();
  const graph = {
    nodes: f.nodes.map((n) => ({ nodeId: n.id, nodeType: 'custom', data: n.data })),
    edges: f.edges.map((e) => ({
      edgeId: e.id,
      sourceNodeId: e.source,
      sourcePortId: e.sourceHandle,
      targetNodeId: e.target,
      targetPortId: e.targetHandle,
    })),
    executionOrder: f.nodes.map((n) => n.id),
  };
  graph.graphHash = schema.blockGraphHashV2(graph);
  const definition = {
    schemaVersion: 2,
    definitionId: 'user:ancillary-coordinator-fixture',
    displayName: 'Optional operation fixture',
    source: { kind: 'user' },
    graph,
    boundary: { mode: 'explicit', inputs: [], outputs: [] },
    controls: [],
    suggestedInputs: [],
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  definition.contentHash = schema.blockDefinitionContentHashV2(definition);
  const instance = schema.createBlockInstanceV2(definition, {
    instanceId: 'scope-block',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 480 },
  });
  const root = runtime.createBlockRootNodeV2(JSON.parse(JSON.stringify(instance)));
  flow.setState({ nodes: [root], edges: [] });
  const before = JSON.stringify(flow.getState().toObject());
  const result = await coordinator({ sid: 'unit', targetNodeId: root.id });
  assert.deepEqual(
    Object.keys(result.submittedGraph.nodes).sort(),
    Object.values(f.binding.parentRoleNodes)
      .map((id) => runtime.blockProjectionNodeIdV2(root.id, id))
      .sort(),
  );
  assert.equal(JSON.stringify(flow.getState().toObject()), before);
  const saved = JSON.parse(JSON.stringify(flow.getState().toObject()));
  flow.setState(saved);
  const repeated = await coordinator({ sid: 'unit' });
  assert.deepEqual(repeated.submittedGraph.nodes, result.submittedGraph.nodes);
  assert.deepEqual(
    repeated.submittedGraph.runtimeHints.executionPurpose,
    result.submittedGraph.runtimeHints.executionPurpose,
  );
});

test('ordinary scope retains an unrelated sink and real lowered loop plan with exact purpose', async () => {
  const f = setup();
  const loop = {
    id: 'loop-container',
    type: 'loop',
    position: { x: 0, y: 0 },
    data: { type: 'loop', module: '', action: '', params: { iterations: { value: 2 }, max_iterations: { value: 4 } } },
  };
  const index = {
    id: 'loop-index',
    type: 'custom',
    parentId: loop.id,
    position: { x: 0, y: 0 },
    data: {
      module: 'modules.WorkflowControl',
      action: 'LoopIndex',
      type: 'custom',
      params: { index: { display: 'output' }, index_value: { value: 0 }, iteration_count: { value: 1 } },
    },
  };
  const result = {
    id: 'loop-result',
    type: 'custom',
    parentId: loop.id,
    position: { x: 0, y: 0 },
    data: {
      module: 'modules.WorkflowControl',
      action: 'LoopResult',
      type: 'custom',
      params: {
        value_input: { display: 'input' },
        stop_input: { display: 'input', value: false },
        value: { display: 'output' },
        collection: { display: 'output' },
      },
    },
  };
  f.nodes.push(loop, index, result);
  f.edges.push({
    id: 'loop-edge',
    source: index.id,
    sourceHandle: 'index',
    target: result.id,
    targetHandle: 'value_input',
  });
  flow.setState({ nodes: f.nodes, edges: f.edges });
  const run = await coordinator({ sid: 'unit' });
  assert.deepEqual(run.submittedGraph.loops[0].bodyNodeIds.sort(), [index.id, result.id].sort());
  assert.equal(run.submittedGraph.loops[0].iterations, 2);
  assert.equal(run.submittedGraph.runtimeHints.executionPurpose.kind, 'workflow');
  assert.ok(!Object.keys(run.submittedGraph.nodes).includes(f.target));
  assert.ok(Object.values(f.binding.parentRoleNodes).every((id) => run.submittedGraph.nodes[id]));
});

test('claimed workflow Auto receives exact purpose and retains it without switching Expert', async () => {
  setup();
  studio.setState({ form: { ...studio.getState().form, resourceMode: 'auto' } });
  const original = globalThis.fetch,
    plans = [];
  globalThis.fetch = async (url, init) => {
    if (new URL(String(url)).pathname !== '/auto_resource/workflow') return original(url, init);
    const body = JSON.parse(init.body);
    plans.push(body);
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        graphHash: `sha256:workflow-auto-v1:${'1'.repeat(64)}`,
        plannedGraphHash: `sha256:workflow-auto-v1:${'2'.repeat(64)}`,
        canAutoRun: true,
        issues: [],
        message: 'Synthetic planner transport only; no runtime qualification.',
        patches: [],
        loaders: [],
        requirements: {},
        available: {},
        sharedMemory: false,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const result = await coordinator({ sid: 'unit' });
  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].graph.runtimeHints.executionPurpose, result.submittedGraph.runtimeHints.executionPurpose);
  assert.equal(studio.getState().form.resourceMode, 'auto');
  assert.ok(result.submittedGraph.runtimeHints.workflowAutoPlan);
});

test('Auto refusal cannot become an Expert submission or erase the purpose', async () => {
  setup();
  studio.setState({ form: { ...studio.getState().form, resourceMode: 'auto' } });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    new URL(String(url)).pathname === '/auto_resource/workflow'
      ? new Response(JSON.stringify({ error: 'No reviewed recipe for optional operation' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      : original(url, init);
  await assert.rejects(coordinator({ sid: 'unit' }), /reviewed recipe/iu);
  assert.equal(sent.length, 0);
  assert.equal(studio.getState().form.resourceMode, 'auto');
});

test('normal selected starter fields remain current without generic registry wrapper fields after portable reload', async () => {
  const f = setup();
  const key = f.parent.roles.find(([role]) => role === f.child.bindings.owner.role)[1];
  const nextRegistry = structuredClone(nodesStore.getState().nodesRegistry);
  delete nextRegistry[key].params[f.child.bindings.owner.promptField];
  delete nextRegistry[key].params[f.child.bindings.owner.layoutField];
  nodesStore.setState({ nodesRegistry: nextRegistry });
  const portable = JSON.parse(JSON.stringify(flow.getState().toObject()));
  flow.setState(portable);
  assert.throws(() => flow.getState().exportGraph('unit'), /scope|declaration/iu);
  const result = await coordinator({ sid: 'unit' });
  assert.equal(result.submittedGraph.runtimeHints.resourceMode, 'expert');
  assert.deepEqual(Object.keys(result.submittedGraph.nodes).sort(), Object.values(f.binding.parentRoleNodes).sort());
  assert.deepEqual(
    nodesStore.getState().nodesRegistry,
    nextRegistry,
    'Selected schema is never merged into the global registry.',
  );
});
