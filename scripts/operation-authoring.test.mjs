import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, authoring, requests;
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/cache$/u);
    assert.equal(options.method, 'DELETE');
    return new Response(JSON.stringify({ error: false, nodes: JSON.parse(options.body).nodes }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  authoring = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  requests = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
});
after(async () => {
  await server?.close();
  globalThis.fetch = originalFetch;
});

function starter(pipeline = 'FuturePipeline', task = 'text_to_image', steps = 20) {
  const stage = (id, params, loader = false) => {
    const node = {
      type: 'custom',
      module: 'modules.Test',
      action: loader ? 'Load' : 'Denoise',
      category: 'Test',
      label: loader ? 'Load models' : 'Denoise',
      params,
    };
    const ports = Object.entries(params).map(([name, p]) => ({
      name,
      semanticName: name,
      direction: p.display === 'output' ? 'output' : 'input',
      roles: ['value'],
      types: [p.type],
      required: false,
      hidden: false,
      semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
    }));
    return {
      node,
      operation: {
        pipelineClass: pipeline,
        task,
        operationId: `diffusion.${id}`,
        nodeKey: `${node.module}.${node.action}`,
        nodeType: loader ? 'loader' : 'denoise',
        blockName: loader ? null : 'denoise',
        decomposition: loader ? 'loader' : 'block',
        support: 'declared',
        workflowId: task,
        binding: { pipelineClass: pipeline, values: loader ? { pipeline_class: pipeline } : {} },
        ports,
      },
    };
  };
  const nodes = [
    stage(
      'load_models',
      { pipeline_class: { type: 'string', value: pipeline }, models: { display: 'output', type: 'models' } },
      true,
    ),
    stage('denoise', {
      models: { type: 'models', display: 'input' },
      prompt: { type: 'string', display: 'text', isInput: true, value: 'Default prompt' },
      steps: { type: 'int', display: 'number', isInput: true, value: steps, min: 1, max: 100 },
      image: { type: 'image', display: 'input' },
      old_control: { type: 'float', display: 'number', value: 1 },
    }),
  ];
  return {
    pipelineClass: pipeline,
    task,
    workflowId: task,
    nodes,
    edges: [
      { source: 'diffusion.load_models', sourceHandle: 'models', target: 'diffusion.denoise', targetHandle: 'models' },
    ],
    requiredInputs: [],
    upstreamBlocks: ['denoise'],
    sharedInputs: [],
  };
}
function graph() {
  return authoring.createOperationStarter(starter(), { x: 40, y: 60 });
}

test('model preview keeps prompts, connected values, positions and custom nodes without mutating the graph', () => {
  const g = graph();
  const [loader, denoise] = g.nodes;
  denoise.data.params.prompt.value = 'My actual prompt';
  denoise.data.params.old_control.value = 4;
  denoise.position = { x: 1200, y: 500 };
  const custom = {
    id: 'custom',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { module: 'custom.Local', action: 'Prompt', params: { value: { display: 'output', type: 'string' } } },
  };
  g.nodes.push(custom);
  g.edges.push({ id: 'external', source: 'custom', sourceHandle: 'value', target: denoise.id, targetHandle: 'prompt' });
  const before = structuredClone(g);
  const next = starter('OtherPipeline', 'text_to_image', 30);
  delete next.nodes[1].node.params.old_control;
  const result = authoring.planOperationChange(g, loader.id, next);
  assert.deepEqual(g, before);
  const adapted = result.graph.nodes.find((n) => n.id === denoise.id);
  assert.equal(adapted.data.params.prompt.value, 'My actual prompt');
  assert.equal(adapted.data.params.steps.value, 30);
  assert.deepEqual(adapted.position, denoise.position);
  assert.equal(adapted.data.operationAuthoring.retained[0].value, 4);
  assert.equal(adapted.data.params.old_control, undefined);
  assert.deepEqual(
    result.graph.edges.find((e) => e.id === 'external'),
    g.edges[1],
  );
  assert.equal(
    result.graph.nodes.find((n) => n.id === 'custom'),
    custom,
  );
});

test('changed runtime classes receive fresh IDs and preserve compatible external connections', () => {
  const g = graph();
  const next = starter('OtherPipeline');
  next.nodes[1].node.action = 'NewDenoise';
  next.nodes[1].operation.nodeKey = 'modules.Test.NewDenoise';
  const result = authoring.planOperationChange(g, g.nodes[0].id, next);
  const denoise = result.graph.nodes.find((n) => n.data.action === 'NewDenoise');
  assert.notEqual(denoise.id, g.nodes[1].id);
  assert.equal(result.graph.edges[0].target, denoise.id);
  assert.equal(result.graph.nodes.length, 2);
});

test('incompatible custom wires are diagnosed and the custom node is retained', () => {
  const g = graph();
  g.nodes.push({
    id: 'custom',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { params: { value: { display: 'output', type: 'image' } } },
  });
  g.edges.push({
    id: 'external',
    source: 'custom',
    sourceHandle: 'value',
    target: g.nodes[1].id,
    targetHandle: 'image',
  });
  const next = starter('AudioPipeline');
  next.nodes[1].node.params.image.type = 'audio';
  const result = authoring.planOperationChange(g, g.nodes[0].id, next);
  assert.equal(result.graph.edges.length, 1);
  assert.equal(result.graph.nodes[2].id, 'custom');
  assert.match(result.diagnostics.join(' '), /Disconnect custom.value/);
});

test('invalid numeric overrides are retained outside execution and target selectors win', () => {
  const g = graph();
  g.nodes[1].data.params.steps.value = '80';
  g.nodes[0].data.params.pipeline_class.value = 'UserChanged';
  const next = starter('OtherPipeline');
  next.nodes[1].node.params.steps.max = 40;
  const result = authoring.planOperationChange(g, g.nodes[0].id, next);
  assert.equal(result.graph.nodes[0].data.params.pipeline_class.value, 'OtherPipeline');
  assert.equal(result.graph.nodes[1].data.params.steps.value, 20);
  assert.equal(result.graph.nodes[1].data.operationAuthoring.retained[0].value, '80');
});

test('duplicate stages, shared loader ownership and nested Blocks are rejected before mutation', () => {
  const g = graph();
  const loader = g.nodes[0];
  g.nodes.push({ ...structuredClone(g.nodes[1]), id: 'duplicate' });
  g.edges.push({ ...g.edges[0], id: 'second', target: 'duplicate' });
  assert.throws(() => authoring.planOperationChange(g, loader.id, starter('OtherPipeline')), /several instances/);
  g.nodes.pop();
  g.edges.pop();
  loader.parentId = 'block';
  assert.throws(() => authoring.planOperationChange(g, loader.id, starter()), /top-level/);
  delete loader.parentId;
  g.nodes.push({ ...structuredClone(loader), id: 'other-loader' });
  g.edges.push({ ...g.edges[0], id: 'shared', source: 'other-loader' });
  assert.throws(() => authoring.planOperationChange(g, loader.id, starter()), /another loader/);
});

test('starter parser rejects stale bindings, competing writers, cycles and absent endpoints', () => {
  const s = starter();
  const operations = s.nodes.map((n) => n.operation);
  const payload = { schemaVersion: 1, ...s };
  assert.deepEqual(requests.parseOperationStarter(payload, s.pipelineClass, s.task, operations), s);
  for (const mutate of [
    (v) => {
      v.pipelineClass = 'OtherPipeline';
    },
    (v) => {
      v.edges.push({ ...v.edges[0] });
    },
    (v) => {
      v.edges[0].targetHandle = 'missing';
    },
    (v) => {
      v.nodes[0].node.params.pipeline_class.value = 'OtherPipeline';
    },
    (v) => {
      v.nodes.pop();
    },
    (v) => {
      v.nodes[0].node.params.models.display = 'input';
    },
    (v) => {
      v.requiredInputs = [{ operationId: 'diffusion.denoise', field: 'missing' }];
    },
  ]) {
    const value = structuredClone(payload);
    mutate(value);
    assert.throws(() => requests.parseOperationStarter(value, s.pipelineClass, s.task, operations));
  }
});

test('a committed model change is one Undo/Redo step, persists hints, and rejects stale previews', async () => {
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const { captureWorkflowOperationContext } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const { commitOperationGraph } = await server.ssrLoadModule('/src/workflow/operationGraphTransaction.ts');
  const flow = useFlowStore.getState();
  flow.replaceGraph(graph());
  flow.resetHistory();
  const initial = flow.toObject();
  const plan = authoring.planOperationChange(initial, initial.nodes[0].id, starter('OtherPipeline'));
  commitOperationGraph(plan.graph, captureWorkflowOperationContext(), JSON.stringify(initial), 'Change model');
  assert.equal(useFlowStore.getState().historyPast.length, 1);
  flow.undo();
  assert.equal(flow.toObject().nodes[0].data.params.pipeline_class.value, 'FuturePipeline');
  flow.redo();
  assert.equal(flow.toObject().nodes[0].data.params.pipeline_class.value, 'OtherPipeline');
  const saved = JSON.parse(JSON.stringify(flow.toObject()));
  flow.replaceGraph(saved);
  assert.equal(authoring.operationAuthoring(flow.toObject().nodes[0]).operation.pipelineClass, 'OtherPipeline');
  assert.throws(
    () => commitOperationGraph(plan.graph, captureWorkflowOperationContext(), JSON.stringify(initial), 'Stale'),
    /changed/,
  );
});

test('an application failure rolls the whole graph back and does not create a history entry', async () => {
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const { captureWorkflowOperationContext } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const { commitOperationGraph } = await server.ssrLoadModule('/src/workflow/operationGraphTransaction.ts');
  const flow = useFlowStore.getState();
  flow.replaceGraph(graph());
  flow.resetHistory();
  const initial = flow.toObject();
  const plan = authoring.planOperationChange(initial, initial.nodes[0].id, starter('OtherPipeline'));
  useFlowStore.setState({
    replaceGraph: (replacement) => {
      flow.replaceGraph(replacement);
      throw new Error('Failed reconciliation');
    },
  });
  try {
    assert.throws(
      () => commitOperationGraph(plan.graph, captureWorkflowOperationContext(), JSON.stringify(initial), 'Change'),
      /Failed reconciliation/,
    );
  } finally {
    useFlowStore.setState({ replaceGraph: flow.replaceGraph });
  }
  assert.deepEqual(flow.toObject(), initial);
  assert.equal(useFlowStore.getState().historyPast.length, 0);
});

test('plain scalar aliases allow compatible prompt wires and retain overrides across backend spellings', async () => {
  const { connectionTypesAreCompatible } = await server.ssrLoadModule('/src/theme/connectionTypeCompatibility.ts');
  assert.equal(connectionTypesAreCompatible('string', 'text'), true);
  assert.equal(connectionTypesAreCompatible('builtins.str', 'text'), true);
  assert.equal(connectionTypesAreCompatible('bool', 'boolean'), true);
  assert.equal(connectionTypesAreCompatible('list[str]', 'string'), false);
  assert.equal(connectionTypesAreCompatible('float', 'int'), false);
  const g = graph();
  g.nodes[1].data.params.prompt.value = 'Retain this prompt';
  const next = starter('OtherPipeline');
  next.nodes[1].node.params.prompt.type = 'text';
  const result = authoring.planOperationChange(g, g.nodes[0].id, next);
  assert.equal(result.graph.nodes[1].data.params.prompt.value, 'Retain this prompt');
});

test('field initialization is a default, while a natively edited random seed is an override', () => {
  const source = starter();
  delete source.nodes[1].node.params.steps.value;
  source.nodes[1].node.params.steps.default = 20;
  source.nodes[1].node.params.seed = { type: 'int', display: 'random', default: 0, min: 0, max: 4294967295 };
  const g = authoring.createOperationStarter(source, { x: 0, y: 0 });
  g.nodes[1].data.params.steps.value = 20; // NodeContent initializes the declared default.
  g.nodes[1].data.params.seed.value = { value: '4109', isRandom: false }; // Native RandomField form.
  const next = starter('OtherPipeline', 'text_to_image', 30);
  next.nodes[1].node.params.seed = { ...source.nodes[1].node.params.seed };
  const result = authoring.planOperationChange(g, g.nodes[0].id, next);
  assert.equal(result.graph.nodes[1].data.params.steps.value, 30);
  assert.deepEqual(result.graph.nodes[1].data.params.seed.value, { value: '4109', isRandom: false });
  assert.equal(result.graph.nodes[1].data.operationAuthoring.retained.length, 0);
});

function seededStarter(imageTask = false) {
  const s = starter('FuturePipeline', imageTask ? 'image_to_image' : 'text_to_image');
  const denoise = s.nodes[1];
  denoise.node.params.seed = { type: 'int', display: 'random', default: 0, min: 0, max: 4294967295 };
  denoise.operation.ports.push({
    name: 'seed',
    semanticName: 'seed',
    direction: 'input',
    roles: ['value'],
    types: ['int'],
    required: false,
    hidden: false,
    semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
  });
  if (imageTask) {
    const encoder = structuredClone(denoise);
    encoder.node.action = 'Encode';
    encoder.node.label = 'Encode image';
    encoder.operation.nodeKey = 'modules.Test.Encode';
    encoder.operation.operationId = 'diffusion.encode_image';
    encoder.node.params.output = { display: 'output', type: 'image' };
    encoder.operation.ports.push({
      name: 'output',
      semanticName: 'image',
      direction: 'output',
      roles: ['value'],
      types: ['image'],
      required: false,
      hidden: false,
      semantics: { kind: 'media', scope: null, state: null, owner: 'none', members: [] },
    });
    s.nodes.splice(1, 0, encoder);
    s.edges.push(
      {
        source: 'diffusion.load_models',
        sourceHandle: 'models',
        target: 'diffusion.encode_image',
        targetHandle: 'models',
      },
      { source: 'diffusion.encode_image', sourceHandle: 'output', target: 'diffusion.denoise', targetHandle: 'image' },
    );
    s.sharedInputs = [
      {
        name: 'seed',
        members: [
          { operationId: 'diffusion.encode_image', field: 'seed' },
          { operationId: 'diffusion.denoise', field: 'seed' },
        ],
      },
    ];
  }
  return s;
}

test('task extension carries the seed, shared edits undo together, and random mode exports one draw', async () => {
  const old = authoring.createOperationStarter(seededStarter(), { x: 0, y: 0 });
  old.nodes[1].data.params.seed.value = { value: '4109', isRandom: false };
  const planned = authoring.planOperationChange(old, old.nodes[0].id, seededStarter(true));
  const stages = planned.graph.nodes.filter((n) => n.data.params.seed);
  assert.equal(stages.length, 2);
  for (const n of stages) assert.deepEqual(n.data.params.seed.value, { value: '4109', isRandom: false });
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  useFlowStore.getState().replaceGraph(planned.graph);
  useFlowStore.getState().resetHistory();
  useFlowStore.getState().setParamWithHistory(stages[0].id, 'seed', { value: '4111', isRandom: false });
  for (const n of useFlowStore.getState().nodes.filter((n) => n.data.params.seed))
    assert.equal(n.data.params.seed.value.value, '4111');
  assert.equal(useFlowStore.getState().historyPast.length, 1);
  useFlowStore.getState().undo();
  for (const n of useFlowStore.getState().nodes.filter((n) => n.data.params.seed))
    assert.equal(n.data.params.seed.value.value, '4109');
  useFlowStore.getState().setParamWithHistory(stages[1].id, 'seed', { value: '4109', isRandom: true });
  const exported = useFlowStore.getState().exportGraph('test');
  const seeds = Object.values(exported.nodes)
    .filter((n) => n.params.seed)
    .map((n) => n.params.seed.value);
  assert.equal(seeds.length, 2);
  assert.equal(seeds[0], seeds[1]);
  assert(Number.isSafeInteger(seeds[0]));
  const saved = useFlowStore.getState().toObject();
  const parsed = JSON.parse(JSON.stringify(saved));
  useFlowStore.getState().replaceGraph(parsed);
  useFlowStore.getState().setParamWithHistory(stages[0].id, 'seed', { value: 12, isRandom: false });
  for (const n of useFlowStore.getState().nodes.filter((n) => n.data.params.seed))
    assert.equal(n.data.params.seed.value.value, 12);
});

test('task changes preserve a shared connected seed and reject competing values or sources', () => {
  const old = authoring.createOperationStarter(seededStarter(), { x: 0, y: 0 });
  old.nodes[1].data.params.seed.isInput = true;
  old.nodes.push({
    id: 'seed-source',
    type: 'custom',
    position: { x: 0, y: 50 },
    data: { module: 'custom', action: 'Seed', params: { output: { type: 'int', display: 'output' } } },
  });
  old.edges.push({
    id: 'seed-driver',
    source: 'seed-source',
    sourceHandle: 'output',
    target: old.nodes[1].id,
    targetHandle: 'seed',
  });
  const plan = authoring.planOperationChange(old, old.nodes[0].id, seededStarter(true));
  assert.equal(plan.graph.edges.filter((e) => e.source === 'seed-source').length, 2);
  assert.equal(
    plan.graph.nodes.find((n) => n.id === 'seed-source'),
    old.nodes[2],
  );
  const conflict = authoring.createOperationStarter(seededStarter(true), { x: 0, y: 0 });
  conflict.nodes[1].data.params.seed.value = { value: 4, isRandom: false };
  conflict.nodes[2].data.params.seed.value = { value: 8, isRandom: false };
  assert.throws(
    () => authoring.planOperationChange(conflict, conflict.nodes[0].id, seededStarter(true)),
    /conflicting/,
  );
});

test('shared seed hints cannot cross loader branches or act on malformed or detached imports', async () => {
  const { sharedOperationInput } = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
  const a = authoring.createOperationStarter(seededStarter(true), { x: 0, y: 0 });
  const b = authoring.createOperationStarter(seededStarter(true), { x: 900, y: 0 });
  const nodes = [...a.nodes, ...b.nodes],
    edges = [...a.edges, ...b.edges];
  assert.equal(sharedOperationInput(nodes, edges, a.nodes[1].id, 'seed').members.length, 2);
  assert.equal(sharedOperationInput(nodes, edges, b.nodes[1].id, 'seed').members.length, 2);
  assert.notEqual(
    sharedOperationInput(nodes, edges, a.nodes[1].id, 'seed').key,
    sharedOperationInput(nodes, edges, b.nodes[1].id, 'seed').key,
  );
  const malformed = structuredClone(a);
  delete malformed.nodes[0].data.operationAuthoring.operation.binding.values;
  assert.equal(sharedOperationInput(malformed.nodes, malformed.edges, malformed.nodes[1].id, 'seed'), null);
  a.nodes[1].parentId = 'block';
  assert.equal(sharedOperationInput(a.nodes, a.edges, a.nodes[1].id, 'seed'), null);
  b.nodes[0].data.params.pipeline_class.value = 'ChangedOutsidePreview';
  assert.equal(sharedOperationInput(b.nodes, b.edges, b.nodes[1].id, 'seed'), null);
});
