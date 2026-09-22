import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, authoring, requests, drafts, choices;
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
  drafts = await server.ssrLoadModule('/src/workflow/workflowDraft.ts');
  choices = await server.ssrLoadModule('/src/workflow/workflowChoices.ts');
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

test('literal media inputs and their fallback values survive compatible task changes', () => {
  const graph = authoring.createOperationStarter(starter(), { x: 0, y: 0 });
  graph.nodes[1].data.params.image.value = '@data/images/reference.webp';
  const before = structuredClone(graph);
  const plan = authoring.planOperationChange(graph, graph.nodes[0].id, starter('OtherPipeline'));
  assert.equal(plan.graph.nodes[1].data.params.image.value, '@data/images/reference.webp');
  assert.deepEqual(graph, before);
});

test('an explicitly selected replacement profile wins over same-pipeline model overrides', () => {
  const old = starter();
  Object.assign(old.nodes[0].node.params, {
    repo_id: { type: 'string', value: 'test/base' },
    revision: { type: 'string', value: 'a'.repeat(40) },
  });
  const graph = authoring.createOperationStarter(old, { x: 0, y: 0 });
  graph.nodes[0].data.params.repo_id.value = 'test/edited';
  const target = structuredClone(old);
  target.nodes[0].node.params.repo_id.value = 'test/selected';
  target.nodes[0].node.params.revision.value = 'b'.repeat(40);
  const plan = authoring.planOperationChange(graph, graph.nodes[0].id, target, { replaceModel: true });
  assert.equal(plan.graph.nodes[0].data.params.repo_id.value, 'test/selected');
  assert.equal(plan.graph.nodes[0].data.params.revision.value, 'b'.repeat(40));
  assert.ok(
    plan.graph.nodes[0].data.operationAuthoring.retained.some(
      (v) => v.field === 'repo_id' && v.value === 'test/edited',
    ),
  );
});

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

test('a disconnected loader change preserves orphan nodes and an independent loader', () => {
  const g = graph();
  g.edges = [];
  const loader = g.nodes[0];
  const orphan = structuredClone(g.nodes[1]);
  const independent = { ...structuredClone(loader), id: 'independent-loader' };
  g.nodes.push(independent);
  const before = structuredClone(g);
  const plan = authoring.planOperationChange(g, loader.id, starter('OtherPipeline'));
  assert.deepEqual(g, before);
  assert.deepEqual(
    plan.graph.nodes.find((n) => n.id === orphan.id),
    orphan,
  );
  assert.deepEqual(
    plan.graph.nodes.find((n) => n.id === independent.id),
    independent,
  );
  assert.equal(plan.graph.edges.length, 1);
  assert.equal(plan.graph.edges[0].source, loader.id);
  assert.notEqual(plan.graph.edges[0].target, orphan.id);
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

test('workflow drafts connect concrete image, audio and video media without changing the starter', () => {
  for (const [type, key, input] of [
    ['image', 'modules.Image.Preview', 'image'],
    ['audio', 'modules.Audio.Preview', 'audio'],
    ['video_asset', 'modules.Video.ExportAsset', 'video'],
  ]) {
    const s = starter();
    s.nodes[1].node.params.result = { type, display: 'output' };
    s.nodes[1].operation.ports.push({
      name: 'result',
      direction: 'output',
      hidden: false,
      types: [type],
      semantics: { kind: 'media' },
    });
    const original = structuredClone(s);
    const registry = {
      [key]: {
        module: key.slice(0, key.lastIndexOf('.')),
        action: key.split('.').at(-1),
        label: 'Output',
        params: { [input]: { type, display: 'input' } },
      },
    };
    const { graph, notices } = drafts.createWorkflowDraft(s, registry);
    assert.deepEqual(s, original);
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);
    assert.equal(graph.edges[1].targetHandle, input);
    assert.equal(graph.edges[1].sourceHandle, 'result');
    assert.deepEqual(notices, []);
    registry[key].params[input].hidden = true;
    assert.equal(drafts.createWorkflowDraft(s, registry).graph.nodes.length, 2);
  }
});

test('workflow drafts keep unsupported or latent outputs explicit instead of inventing an output adapter', () => {
  const s = starter();
  s.nodes[1].node.params.result = { type: 'latent', display: 'output' };
  s.nodes[1].operation.ports.push({
    name: 'result',
    direction: 'output',
    types: ['latent'],
    semantics: { kind: 'state' },
  });
  const result = drafts.createWorkflowDraft(s, {});
  assert.equal(result.graph.nodes.length, 2);
  assert.match(result.notices[0], /No compatible output/);
});

test('workflow choices join exact execution profiles and retain task and pipeline distinctions', () => {
  const support = [
    {
      pipelineClass: 'FuturePipeline',
      tasks: ['text_to_image', 'edit_image'].map((task) => ({
        task,
        operationIds: ['load', 'run'],
        executionProfileIds: ['first', 'second'],
      })),
    },
    {
      pipelineClass: 'UnknownPipeline',
      tasks: [{ task: 'future_task', operationIds: ['load'], executionProfileIds: [] }],
    },
  ];
  const models = ['first', 'second'].map((id) => ({
    label: id,
    defaultRepo: `test/${id}`,
    executionProfiles: [{ id, default_repo: `test/${id}` }],
  }));
  const result = choices.workflowChoices(support, models, [], [], null);
  assert.equal(result.length, 5);
  assert.equal(new Set(result.map((c) => c.id)).size, 5);
  assert.equal(result.find((c) => c.task === 'edit_image' && c.profileId === 'second').repo, 'test/second');
  assert.equal(result.find((c) => c.task === 'future_task').repo, null);
  assert.equal(choices.workflowTaskLabel('future_task'), 'Future task');
});

async function operationBlock(instanceId = 'operation-block', selectedStarter = seededStarter(true)) {
  const schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const draft = authoring.createOperationStarter(selectedStarter, { x: 40, y: 80 });
  for (const node of draft.nodes.filter((n) => n.data.params.seed))
    node.data.params.seed.value = { value: 4109, isRandom: true };
  const graph = {
    nodes: draft.nodes.map((node) => ({ nodeId: node.id, nodeType: node.type, data: node.data })),
    edges: draft.edges.map((edge) => ({
      edgeId: edge.id,
      sourceNodeId: edge.source,
      sourcePortId: edge.sourceHandle,
      targetNodeId: edge.target,
      targetPortId: edge.targetHandle,
    })),
  };
  const definition = {
    schemaVersion: 2,
    definitionId: 'user:generic-operations',
    displayName: 'Generic operations',
    source: { kind: 'user' },
    graph: { ...graph, graphHash: schema.blockGraphHashV2(graph) },
    boundary: { mode: 'explicit', inputs: [], outputs: [] },
    controls: [],
    suggestedInputs: [],
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  definition.contentHash = schema.blockDefinitionContentHashV2(definition);
  const instance = schema.createBlockInstanceV2(definition, {
    instanceId,
    position: { x: 80, y: 90 },
    size: { width: 400, height: 600 },
    internalLayout: Object.fromEntries(
      draft.nodes.map((node) => [node.id, { ...node.position, width: 360, height: 400 }]),
    ),
  });
  return { schema, runtime, instance, draft };
}

async function derivedOperationBlock(instanceId = 'derived-operation-block') {
  const selected = seededStarter(true);
  const selectedDenoise = selected.nodes.find((node) => node.node.action === 'Denoise');
  selectedDenoise.node.params.guider = { type: 'custom_guider', display: 'input' };
  selectedDenoise.node.params.strength = { type: 'float', display: 'number', value: 1 };
  selectedDenoise.operation.ports.push(
    {
      name: 'guider',
      semanticName: 'guider',
      direction: 'input',
      roles: ['value'],
      types: ['custom_guider'],
      required: false,
      hidden: false,
      semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
    },
    {
      name: 'strength',
      semanticName: 'strength',
      direction: 'input',
      roles: ['value'],
      types: ['float'],
      required: false,
      hidden: false,
      semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
    },
  );
  const base = await operationBlock(instanceId, selected);
  const denoise = base.draft.nodes.find((node) => node.data.action === 'Denoise');
  const boundary = {
    mode: 'derived',
    inputs: [
      {
        portId: 'guider-in',
        label: 'Guider',
        valueType: 'custom_guider',
        required: false,
        binding: { nodeId: denoise.id, fieldOrPortId: 'guider' },
      },
    ],
    outputs: [],
    derivation: {
      algorithmVersion: 'legacy-user-block-boundary-v1',
      derivedAtDefinitionHash: base.instance.effectiveGraph.graphHash,
    },
  };
  const controls = [
    {
      controlId: 'strength-control',
      label: 'Strength',
      valueType: 'float',
      binding: { nodeId: denoise.id, fieldId: 'strength' },
      defaultValue: 1,
      order: 0,
    },
  ];
  const withoutHash = {
    ...base.instance.definitionSnapshot,
    boundary,
    controls,
  };
  const definition = {
    ...withoutHash,
    contentHash: base.schema.blockDefinitionContentHashV2(withoutHash),
  };
  const instance = base.schema.createBlockInstanceV2(definition, {
    instanceId,
    position: base.instance.presentation.position,
    size: base.instance.presentation.size,
    internalLayout: base.instance.presentation.internalLayout,
  });
  return { ...base, instance, denoise };
}

test('generic Block projections preserve operation hints and scope shared random seeds to each instance', async () => {
  const { schema, runtime, instance } = await operationBlock();
  const peer = schema.createBlockInstanceV2(instance.definitionSnapshot, {
    instanceId: 'peer-block',
    position: { x: 900, y: 90 },
    size: { width: 400, height: 600 },
  });
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  useFlowStore.getState().replaceGraph({
    nodes: [runtime.createBlockRootNodeV2(instance), runtime.createBlockRootNodeV2(peer)],
    edges: [],
  });
  const before = structuredClone(useFlowStore.getState().toObject());
  const expanded = runtime.expandBlockGraphV2ForExecution(before.nodes, before.edges);
  const seeds = expanded.nodes.filter((n) => n.data.params.seed);
  for (const node of seeds) assert.ok(authoring.operationAuthoring(node), 'operation metadata survives lowering');
  const { sharedOperationInput } = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
  const groups = seeds.map((n) => sharedOperationInput(expanded.nodes, expanded.edges, n.id, 'seed'));
  assert.ok(groups.every((group) => group?.members.length === 2));
  assert.equal(new Set(groups.map((group) => group.key)).size, 2);
  const exported = useFlowStore.getState().exportGraph('test');
  for (const owner of ['operation-block', 'peer-block']) {
    const values = Object.entries(exported.nodes)
      .filter(([id, n]) => id.includes(owner) && n.params.seed)
      .map(([, n]) => n.params.seed.value);
    assert.equal(values.length, 2);
    assert.equal(values[0], values[1]);
    assert.ok(Number.isSafeInteger(values[0]));
  }
  assert.deepEqual(
    useFlowStore
      .getState()
      .toObject()
      .nodes.map((n) => n.data.blockInstanceV2.definitionSnapshot),
    before.nodes.map((n) => n.data.blockInstanceV2.definitionSnapshot),
  );
});

test('editing one generic Block seed updates hidden peers atomically and survives persistence', async () => {
  const { runtime, instance } = await operationBlock();
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const root = runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(instance, { expanded: true }));
  useFlowStore.getState().replaceGraph(runtime.materializeBlockProjectionV2(root));
  useFlowStore.getState().resetHistory();
  const node = useFlowStore.getState().nodes.find((n) => n.data.params.seed);
  useFlowStore.getState().setParamWithHistory(node.id, 'seed', { value: 72, isRandom: false });
  const assertSeeds = (expected) => {
    const { nodes, edges } = useFlowStore.getState().toObject();
    for (const n of runtime.expandBlockGraphV2ForExecution(nodes, edges).nodes.filter((n) => n.data.params.seed))
      assert.equal(n.data.params.seed.value.value, expected);
  };
  assertSeeds(72);
  assert.equal(useFlowStore.getState().historyPast.length, 1);
  useFlowStore.getState().undo();
  assertSeeds(4109);
  useFlowStore.getState().redo();
  assertSeeds(72);
  useFlowStore.getState().replaceGraph(JSON.parse(JSON.stringify(useFlowStore.getState().toObject())));
  assertSeeds(72);
  assert.deepEqual(
    useFlowStore.getState().nodes[0].data.blockInstanceV2.definitionSnapshot,
    instance.definitionSnapshot,
  );
});

for (const surface of ['root', 'nested', 'sealed']) {
  test(`generic Block shared input respects ${surface} interface bindings`, async () => {
    const { runtime, instance, draft } = await operationBlock();
    const { configureBlockContainerInterfaceV1 } = await server.ssrLoadModule('/src/studio/blockContainerEditingV1.ts');
    const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
    const seedId = draft.nodes[1].id;
    const control = {
      controlId: 'seed',
      label: 'Seed',
      binding: { nodeId: seedId, fieldId: 'seed' },
      valueType: 'int',
      defaultValue: { value: 4109, isRandom: true },
      order: 0,
      ...(surface === 'sealed' ? { sealed: true } : {}),
    };
    let prepared;
    if (surface === 'nested') {
      const graph = structuredClone(instance.effectiveGraph);
      graph.nodes.forEach((n) => {
        n.parentNodeId = 'container';
      });
      graph.nodes.unshift({
        nodeId: 'container',
        nodeType: 'group',
        data: { type: 'group', label: 'Nested', params: {} },
      });
      prepared = runtime.replaceBlockEffectiveGraphV2(instance, graph);
      prepared = configureBlockContainerInterfaceV1(prepared, 'container', {
        boundary: { mode: 'explicit', inputs: [], outputs: [] },
        controls: [control],
      });
    } else {
      prepared = runtime.replaceBlockEffectiveInterfaceV2(instance, {
        boundary: instance.effectiveInterface.boundary,
        controls: [control],
      });
    }
    prepared = runtime.setBlockPresentationV2(prepared, { expanded: true });
    useFlowStore.getState().replaceGraph(runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(prepared)));
    useFlowStore.getState().resetHistory();
    const before = structuredClone(useFlowStore.getState().toObject());
    if (surface === 'sealed') {
      const other = useFlowStore.getState().nodes.find((n) => n.data.blockProjectionNodeId === draft.nodes[2].id);
      assert.throws(
        () => useFlowStore.getState().setParamWithHistory(other.id, 'seed', { value: 73, isRandom: false }),
        /sealed/,
      );
      assert.deepEqual(useFlowStore.getState().toObject(), before);
      assert.equal(useFlowStore.getState().historyPast.length, 0);
      return;
    }
    if (surface === 'root')
      useFlowStore.getState().setBlockInstanceValueV2(instance.instanceId, 'seed', { value: 73, isRandom: false });
    else {
      const container = useFlowStore.getState().nodes.find((n) => n.data.blockProjectionNodeId === 'container');
      const field = Object.keys(container.data.params).find(
        (k) => container.data.params[k].fieldOptions?.blockContainerControlV1?.controlId === 'seed',
      );
      assert.ok(field);
      useFlowStore.getState().setParamWithHistory(container.id, field, { value: 73, isRandom: false });
    }
    const saved = useFlowStore.getState().toObject();
    const lowered = runtime.expandBlockGraphV2ForExecution(saved.nodes, saved.edges);
    const seeds = lowered.nodes.filter((n) => n.data.params.seed);
    assert.equal(seeds.length, 2);
    for (const n of seeds) assert.equal(n.data.params.seed.value.value, 73);
    assert.equal(useFlowStore.getState().historyPast.length, 1);
    useFlowStore.getState().undo();
    assert.deepEqual(useFlowStore.getState().toObject(), before);
  });
}

test('nesting and reusing a generic Block remaps loader references without modifying its saved definition', async () => {
  const { schema, runtime, instance } = await operationBlock();
  const { reusableBlockDefinitionFromInstanceV2 } = await server.ssrLoadModule(
    '/src/studio/blockDefinitionPersistenceV2.ts',
  );
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const host = schema.createBlockInstanceV2(instance.definitionSnapshot, {
    instanceId: 'host-block',
    position: { x: 1100, y: 100 },
    size: { width: 800, height: 800 },
  });
  useFlowStore.getState().replaceGraph({
    nodes: [
      runtime.createBlockRootNodeV2(instance),
      runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(host, { expanded: true })),
    ],
    edges: [],
  });
  useFlowStore.getState().resetHistory();
  useFlowStore.getState().adoptBlockFragmentIntoBlockV2(instance.instanceId, host.instanceId);
  const saved = useFlowStore.getState().toObject();
  const owner = saved.nodes.find((n) => n.id === host.instanceId).data.blockInstanceV2;
  assert.deepEqual(owner.definitionSnapshot, host.definitionSnapshot);
  const { sharedOperationInput } = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
  const assertGroups = (value) => {
    const graph = runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(value)], []);
    const groups = graph.nodes
      .filter((n) => n.data.params.seed)
      .map((n) => sharedOperationInput(graph.nodes, graph.edges, n.id, 'seed'));
    assert.equal(groups.length, 4);
    assert.ok(groups.every((g) => g?.members.length === 2));
    assert.equal(new Set(groups.map((g) => g.key)).size, 2);
  };
  assertGroups(owner);
  const definition = reusableBlockDefinitionFromInstanceV2(owner, {
    definitionId: 'user:reused-operations',
    displayName: 'Reused operations',
  });
  const reinserted = schema.createBlockInstanceV2(definition, {
    instanceId: 'reinserted',
    position: { x: 0, y: 0 },
    size: { width: 500, height: 500 },
  });
  assertGroups(reinserted);
  useFlowStore.getState().undo();
  assert.equal(useFlowStore.getState().toObject().nodes.length, 2);
});

test('nested shared seed conflicts still block export and cannot borrow a different loader', async () => {
  const { runtime, instance, draft } = await operationBlock();
  const { sharedOperationInput } = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const graph = structuredClone(instance.effectiveGraph);
  graph.nodes[1].data.params.seed.value = { value: 999, isRandom: false };
  useFlowStore.getState().replaceGraph({
    nodes: [runtime.createBlockRootNodeV2(runtime.replaceBlockEffectiveGraphV2(instance, graph))],
    edges: [],
  });
  assert.throws(() => useFlowStore.getState().exportGraph('test'), /Shared seed controls disagree/);
  const lowered = runtime.blockOperationGraphV2(instance);
  const loader = lowered.nodes[0];
  lowered.nodes.push({ ...structuredClone(loader), id: 'another-loader' });
  lowered.edges.push({ ...lowered.edges[0], id: 'competing', source: 'another-loader' });
  assert.equal(
    sharedOperationInput(
      lowered.nodes,
      lowered.edges,
      runtime.blockProjectionNodeIdV2(instance.instanceId, draft.nodes[1].id),
      'seed',
    ),
    null,
  );
});

test('nested adoption preserves an invalid advisory hint without interpreting it as a shared input', async () => {
  const { schema, runtime, instance } = await operationBlock();
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const graph = structuredClone(instance.effectiveGraph);
  graph.nodes[0].data.operationAuthoring = 'legacy invalid hint';
  const fragment = runtime.replaceBlockEffectiveGraphV2(instance, graph);
  const host = schema.createBlockInstanceV2(instance.definitionSnapshot, {
    instanceId: 'hint-host',
    position: { x: 0, y: 0 },
    size: { width: 600, height: 600 },
  });
  useFlowStore.getState().replaceGraph({
    nodes: [
      runtime.createBlockRootNodeV2(fragment),
      runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(host, { expanded: true })),
    ],
    edges: [],
  });
  useFlowStore.getState().adoptBlockFragmentIntoBlockV2(fragment.instanceId, host.instanceId);
  const saved = useFlowStore.getState().toObject();
  assert.ok(
    saved.nodes[0].data.blockInstanceV2.effectiveGraph.nodes.some(
      (n) => n.data.operationAuthoring === 'legacy invalid hint',
    ),
  );
});

test('owning Block model changes preserve semantic roles, shared values, siblings and immutable definitions', async () => {
  const { runtime, instance, draft } = await operationBlock();
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const peer = await operationBlock('untouched-peer');
  const graph = {
    nodes: [runtime.createBlockRootNodeV2(instance), runtime.createBlockRootNodeV2(peer.instance)],
    edges: [],
  };
  const before = structuredClone(graph);
  const next = seededStarter(true);
  for (const item of next.nodes) {
    item.operation.pipelineClass = 'AnotherSupportedPipeline';
    item.operation.binding.pipelineClass = 'AnotherSupportedPipeline';
    item.node.action += 'Next';
    item.operation.nodeKey = `${item.node.module}.${item.node.action}`;
  }
  next.pipelineClass = 'AnotherSupportedPipeline';
  const plan = planBlockOperationChange(graph, instance.instanceId, draft.nodes[0].id, next);
  assert.deepEqual(graph, before, 'preview is read-only');
  const updated = plan.graph.nodes[0].data.blockInstanceV2;
  assert.deepEqual(updated.definitionSnapshot, instance.definitionSnapshot);
  assert.deepEqual(plan.graph.nodes[1], graph.nodes[1]);
  assert.deepEqual(
    updated.effectiveGraph.nodes.map((n) => n.nodeId),
    instance.effectiveGraph.nodes.map((n) => n.nodeId),
  );
  assert.deepEqual(updated.presentation, instance.presentation);
  for (const node of updated.effectiveGraph.nodes) {
    assert.ok(node.data.action.endsWith('Next'));
    for (const hint of node.data.operationAuthoring.sharedInputs ?? []) assert.equal(hint.loaderId, draft.nodes[0].id);
    if (node.data.params.seed) assert.deepEqual(node.data.params.seed.value, { value: 4109, isRandom: true });
  }
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const studio = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const { commitOperationGraph } = await server.ssrLoadModule('/src/workflow/operationGraphTransaction.ts');
  useFlowStore.getState().replaceGraph(graph);
  const snapshot = useFlowStore.getState().toObject();
  commitOperationGraph(
    plan.graph,
    studio.captureWorkflowOperationContext(),
    JSON.stringify(snapshot),
    'Change Block model',
  );
  assert.deepEqual(useFlowStore.getState().toObject().nodes[0].data.blockInstanceV2, updated);
  useFlowStore.getState().undo();
  assert.deepEqual(useFlowStore.getState().toObject().nodes[0].data.blockInstanceV2, instance);
  useFlowStore.getState().redo();
  const saved = JSON.parse(JSON.stringify(useFlowStore.getState().toObject()));
  useFlowStore.getState().replaceGraph(saved);
  assert.deepEqual(useFlowStore.getState().toObject().nodes[0].data.blockInstanceV2, updated);
});

test('owning Block model changes remove only untouched unavailable fields from a derived interface', async () => {
  const { runtime, instance, draft } = await derivedOperationBlock();
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const target = seededStarter(true);
  const plan = planBlockOperationChange(
    { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] },
    instance.instanceId,
    draft.nodes[0].id,
    target,
  );
  const updated = plan.graph.nodes[0].data.blockInstanceV2;
  assert.deepEqual(updated.effectiveInterface.boundary.inputs, []);
  assert.deepEqual(updated.effectiveInterface.controls, []);
  assert.deepEqual(updated.definitionSnapshot, instance.definitionSnapshot);
  assert.match(plan.changes.join(' '), /input Guider/u);
  assert.match(plan.changes.join(' '), /control Strength/u);
});

test('owning Block model changes protect configured, connected and edited derived fields', async () => {
  const { runtime, instance, draft } = await derivedOperationBlock();
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const target = seededStarter(true);
  const configured = runtime.replaceBlockEffectiveInterfaceV2(instance, {
    boundary: { ...instance.effectiveInterface.boundary, mode: 'explicit', derivation: undefined },
    controls: instance.effectiveInterface.controls,
  });
  assert.throws(
    () =>
      planBlockOperationChange(
        { nodes: [runtime.createBlockRootNodeV2(configured)], edges: [] },
        instance.instanceId,
        draft.nodes[0].id,
        target,
      ),
    /Configure Interface/u,
  );

  const connectedGraph = {
    nodes: [runtime.createBlockRootNodeV2(instance), outsideValue('outside', 'custom_guider', 'guider')],
    edges: [
      {
        id: 'connected-guider',
        source: 'outside',
        sourceHandle: 'guider',
        target: instance.instanceId,
        targetHandle: 'guider-in',
      },
    ],
  };
  assert.throws(
    () => planBlockOperationChange(connectedGraph, instance.instanceId, draft.nodes[0].id, target),
    /connected input guider-in/u,
  );

  const edited = runtime.setBlockInstanceValueV2(instance, 'strength-control', 0.5);
  assert.throws(
    () =>
      planBlockOperationChange(
        { nodes: [runtime.createBlockRootNodeV2(edited)], edges: [] },
        instance.instanceId,
        draft.nodes[0].id,
        target,
      ),
    /Configure Interface/u,
  );
});

test('owning Block preview rejects incompatible public controls and conflicting bound model values atomically', async () => {
  const { runtime, instance, draft } = await operationBlock();
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const withControl = runtime.replaceBlockEffectiveInterfaceV2(instance, {
    boundary: instance.effectiveInterface.boundary,
    controls: [
      {
        controlId: 'pipeline',
        label: 'Pipeline',
        sealed: true,
        binding: { nodeId: draft.nodes[0].id, fieldId: 'pipeline_class' },
        valueType: 'string',
        defaultValue: 'FuturePipeline',
        order: 0,
      },
    ],
  });
  const graph = { nodes: [runtime.createBlockRootNodeV2(withControl)], edges: [] };
  const before = structuredClone(graph);
  assert.throws(
    () => planBlockOperationChange(graph, instance.instanceId, draft.nodes[0].id, starter('OtherPipeline')),
    /overrides the replacement value/u,
  );
  const missing = starter();
  delete missing.nodes[0].node.params.pipeline_class;
  assert.throws(
    () => planBlockOperationChange(graph, instance.instanceId, draft.nodes[0].id, missing),
    /Configure Interface/u,
  );
  assert.deepEqual(graph, before);
});

test('owning Block task changes retain nested ownership and custom nodes while adding new operations', async () => {
  const { runtime, instance, draft } = await operationBlock();
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  let nested = runtime.addBlockEffectiveGraphNodeV2(instance, {
    nodeId: 'container',
    nodeType: 'group',
    data: { label: 'Nested', params: {} },
  });
  nested = runtime.replaceBlockEffectiveGraphV2(nested, {
    ...nested.effectiveGraph,
    nodes: nested.effectiveGraph.nodes.map((n) => (n.nodeId === 'container' ? n : { ...n, parentNodeId: 'container' })),
  });
  nested = runtime.addBlockEffectiveGraphNodeV2(nested, {
    nodeId: 'custom',
    nodeType: 'custom',
    parentNodeId: 'container',
    data: { module: 'custom.Local', action: 'Prompt', params: { value: { type: 'string', display: 'output' } } },
  });
  const next = starter('FuturePipeline', 'image_to_image');
  const extra = structuredClone(next.nodes[1]);
  extra.operation.operationId = 'diffusion.encode_image';
  next.nodes.push(extra);
  const result = planBlockOperationChange(
    { nodes: [runtime.createBlockRootNodeV2(nested)], edges: [] },
    instance.instanceId,
    draft.nodes[0].id,
    next,
  ).graph.nodes[0].data.blockInstanceV2;
  const added = result.effectiveGraph.nodes.find(
    (n) => n.data.operationAuthoring?.operation.operationId === 'diffusion.encode_image',
  );
  assert.equal(added.parentNodeId, 'container');
  assert.deepEqual(
    result.effectiveGraph.nodes.find((n) => n.nodeId === 'custom'),
    nested.effectiveGraph.nodes.find((n) => n.nodeId === 'custom'),
  );
  assert.deepEqual(result.definitionSnapshot, nested.definitionSnapshot);
});

test('owning Block crossing wires survive compatible changes and reject incompatible fields', async () => {
  const { runtime, instance, draft } = await operationBlock();
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const { blockCrossingHandleV2 } = await server.ssrLoadModule('/src/studio/blockCrossingConnectionsV2.ts');
  const graph = {
    nodes: [runtime.createBlockRootNodeV2(instance), outsideValue('outside', 'string', 'text')],
    edges: [
      {
        id: 'outside',
        source: 'outside',
        sourceHandle: 'text',
        target: instance.instanceId,
        targetHandle: blockCrossingHandleV2({
          nodeId: draft.nodes.find((n) => n.data.action === 'Denoise').id,
          fieldOrPortId: 'prompt',
          direction: 'input',
        }),
      },
    ],
  };
  const next = starter('OtherPipeline');
  const plan = planBlockOperationChange(graph, instance.instanceId, draft.nodes[0].id, next);
  assert.deepEqual(plan.graph.edges, graph.edges);
  next.nodes[1].node.params.prompt.type = 'image';
  assert.throws(() => planBlockOperationChange(graph, instance.instanceId, draft.nodes[0].id, next), /changes type/u);
});

test('owning Block task preview preserves an outside image driver instead of adding a competing internal driver on an outside socket', async () => {
  const { runtime, instance, draft } = await operationBlock();
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const { blockCrossingHandleV2 } = await server.ssrLoadModule('/src/studio/blockCrossingConnectionsV2.ts');
  const denoise = draft.nodes.find((node) => node.data.action === 'Denoise');
  const detached = runtime.replaceBlockEffectiveGraphV2(instance, {
    ...instance.effectiveGraph,
    edges: instance.effectiveGraph.edges.filter((edge) => edge.targetPortId !== 'image'),
  });
  const graph = {
    nodes: [runtime.createBlockRootNodeV2(detached), outsideValue('outside', 'image', 'image')],
    edges: [
      {
        id: 'image',
        source: 'outside',
        sourceHandle: 'image',
        target: instance.instanceId,
        targetHandle: blockCrossingHandleV2({ nodeId: denoise.id, fieldOrPortId: 'image', direction: 'input' }),
      },
    ],
  };
  const before = structuredClone(graph);
  const result = planBlockOperationChange(graph, instance.instanceId, draft.nodes[0].id, seededStarter(true));
  assert.deepEqual(result.graph.edges, graph.edges);
  assert.ok(
    !result.graph.nodes[0].data.blockInstanceV2.effectiveGraph.edges.some(
      (edge) => edge.targetNodeId === denoise.id && edge.targetPortId === 'image',
    ),
  );
  assert.deepEqual(graph, before);
});

function outsideValue(id = 'outside', type = 'int', field = 'value') {
  return {
    id,
    type: 'custom',
    position: { x: -400, y: 80 },
    data: {
      type: 'custom',
      module: 'custom.Test',
      action: 'Value',
      label: 'Outside value',
      params: { [field]: { type, display: 'output' } },
    },
  };
}

for (const surface of ['public', 'crossing']) {
  test(`Block task extension preserves a ${surface} seed wire and connects its new shared member`, async () => {
    const { runtime, instance, draft } = await operationBlock('operation-block', seededStarter(false));
    const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
    const { blockCrossingHandleV2, blockConnectionTargetsV2 } = await server.ssrLoadModule(
      '/src/studio/blockCrossingConnectionsV2.ts',
    );
    const denoise = draft.nodes.find((n) => n.data.action === 'Denoise');
    const bound = runtime.replaceBlockEffectiveInterfaceV2(instance, {
      boundary: {
        mode: 'explicit',
        outputs: [],
        inputs: [
          {
            portId: 'seed-in',
            required: false,
            label: 'Seed',
            binding: { nodeId: denoise.id, fieldOrPortId: 'seed' },
            valueType: 'int',
          },
        ],
      },
      controls: [],
    });
    const source = { ...outsideValue(), width: 10000, measured: { width: 10000, height: 600 } };
    const wire = {
      id: 'authored-seed',
      source: source.id,
      sourceHandle: 'value',
      target: instance.instanceId,
      targetHandle:
        surface === 'public'
          ? 'seed-in'
          : blockCrossingHandleV2({ nodeId: denoise.id, fieldOrPortId: 'seed', direction: 'input' }),
    };
    const graph = { nodes: [runtime.createBlockRootNodeV2(bound), source], edges: [wire] };
    const before = structuredClone(graph);
    const result = planBlockOperationChange(graph, instance.instanceId, draft.nodes[0].id, seededStarter(true));
    assert.deepEqual(graph, before);
    assert.deepEqual(result.graph.nodes[1], source);
    assert.deepEqual(
      result.graph.edges.find((e) => e.id === wire.id),
      wire,
    );
    assert.equal(result.graph.edges.length, 2);
    const root = result.graph.nodes[0];
    const updated = root.data.blockInstanceV2;
    assert.ok(
      Object.values(updated.presentation.internalLayout).every((layout) => layout.x < 10000),
      'outside source dimensions do not change internal placement',
    );
    assert.deepEqual(updated.effectiveInterface, bound.effectiveInterface);
    assert.deepEqual(updated.definitionSnapshot, bound.definitionSnapshot);
    const targets = result.graph.edges.flatMap((e) => blockConnectionTargetsV2(root, e.targetHandle, 'input'));
    assert.equal(new Set(targets.map((t) => t.nodeId)).size, 2);
    assert.ok(targets.every((t) => t.fieldOrPortId === 'seed'));
    assert.ok(updated.effectiveGraph.nodes.every((n) => !n.nodeId.startsWith('boundary-')));
    const lowered = runtime.expandBlockGraphV2ForExecution(result.graph.nodes, result.graph.edges);
    const drivers = lowered.edges.filter((e) => e.source === source.id);
    assert.equal(drivers.length, 2);
    assert.equal(new Set(drivers.map((e) => e.target)).size, 2);
    assert.ok(drivers.every((e) => e.targetHandle === 'seed'));
  });
}

test('Block shared-input adaptation rejects competing outside sources without changing the graph', async () => {
  const { runtime, instance, draft } = await operationBlock();
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const { blockCrossingHandleV2 } = await server.ssrLoadModule('/src/studio/blockCrossingConnectionsV2.ts');
  const sources = [outsideValue('first'), outsideValue('second')];
  const graph = {
    nodes: [runtime.createBlockRootNodeV2(instance), ...sources],
    edges: draft.nodes
      .filter((n) => n.data.params.seed)
      .map((n, i) => ({
        id: `seed-${i}`,
        source: sources[i].id,
        sourceHandle: 'value',
        target: instance.instanceId,
        targetHandle: blockCrossingHandleV2({ nodeId: n.id, fieldOrPortId: 'seed', direction: 'input' }),
      })),
  };
  const before = structuredClone(graph);
  assert.throws(
    () => planBlockOperationChange(graph, instance.instanceId, draft.nodes[0].id, seededStarter(true)),
    /several input sources/u,
  );
  assert.deepEqual(graph, before);
});

test('new shared connections cannot override a sealed Block control', async () => {
  const original = seededStarter(true);
  original.sharedInputs = [];
  const { runtime, instance, draft } = await operationBlock('operation-block', original);
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const { blockCrossingHandleV2 } = await server.ssrLoadModule('/src/studio/blockCrossingConnectionsV2.ts');
  const encoder = draft.nodes.find((n) => n.data.action === 'Encode');
  const denoise = draft.nodes.find((n) => n.data.action === 'Denoise');
  const sealed = runtime.replaceBlockEffectiveInterfaceV2(instance, {
    boundary: instance.effectiveInterface.boundary,
    controls: [
      {
        controlId: 'locked-seed',
        label: 'Locked seed',
        valueType: 'int',
        binding: { nodeId: encoder.id, fieldId: 'seed' },
        defaultValue: { value: 4109, isRandom: true },
        order: 0,
        sealed: true,
      },
    ],
  });
  const graph = {
    nodes: [runtime.createBlockRootNodeV2(sealed), outsideValue()],
    edges: [
      {
        id: 'external',
        source: 'outside',
        sourceHandle: 'value',
        target: instance.instanceId,
        targetHandle: blockCrossingHandleV2({ nodeId: denoise.id, fieldOrPortId: 'seed', direction: 'input' }),
      },
    ],
  };
  const before = structuredClone(graph);
  assert.throws(
    () => planBlockOperationChange(graph, instance.instanceId, draft.nodes[0].id, seededStarter(true)),
    /sealed Block control/u,
  );
  assert.deepEqual(graph, before);
});

test('an outside loader remains a competing owner rather than becoming an untyped value source', async () => {
  const { runtime, instance, draft } = await operationBlock();
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const { blockCrossingHandleV2 } = await server.ssrLoadModule('/src/studio/blockCrossingConnectionsV2.ts');
  const source = graph().nodes[0];
  const denoise = draft.nodes.find((n) => n.data.action === 'Denoise');
  const canvas = {
    nodes: [runtime.createBlockRootNodeV2(instance), source],
    edges: [
      {
        id: 'external',
        source: source.id,
        sourceHandle: 'models',
        target: instance.instanceId,
        targetHandle: blockCrossingHandleV2({ nodeId: denoise.id, fieldOrPortId: 'models', direction: 'input' }),
      },
    ],
  };
  const before = structuredClone(canvas);
  assert.throws(
    () => planBlockOperationChange(canvas, instance.instanceId, draft.nodes[0].id, seededStarter(true)),
    /another loader too/u,
  );
  assert.deepEqual(canvas, before);
});

test('a nested outside Block source preserves its interface and is never adopted during task adaptation', async () => {
  const { runtime, instance, draft } = await operationBlock('target', seededStarter(false));
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const { blockCrossingHandleV2 } = await server.ssrLoadModule('/src/studio/blockCrossingConnectionsV2.ts');
  const peer = await operationBlock('source');
  let source = runtime.addBlockEffectiveGraphNodeV2(peer.instance, {
    nodeId: 'value',
    nodeType: 'custom',
    data: outsideValue().data,
  });
  source = runtime.replaceBlockEffectiveInterfaceV2(source, {
    boundary: {
      mode: 'explicit',
      inputs: [],
      outputs: [
        {
          portId: 'value-out',
          label: 'Value',
          required: false,
          valueType: 'int',
          binding: { nodeId: 'value', fieldOrPortId: 'value' },
        },
      ],
    },
    controls: [],
  });
  const canvas = {
    nodes: [runtime.createBlockRootNodeV2(instance), runtime.createBlockRootNodeV2(source)],
    edges: [
      {
        id: 'external',
        source: source.instanceId,
        sourceHandle: 'value-out',
        target: instance.instanceId,
        targetHandle: blockCrossingHandleV2({ nodeId: draft.nodes[1].id, fieldOrPortId: 'seed', direction: 'input' }),
      },
    ],
  };
  const result = planBlockOperationChange(canvas, instance.instanceId, draft.nodes[0].id, seededStarter(true));
  assert.deepEqual(result.graph.nodes[1], canvas.nodes[1]);
  assert.equal(result.graph.edges.length, 2);
  assert.ok(result.graph.edges.every((edge) => edge.source === 'source' && edge.sourceHandle === 'value-out'));
  assert.deepEqual(result.graph.nodes[0].data.blockInstanceV2.definitionSnapshot, instance.definitionSnapshot);
});

test('workflow discovery retains backend models absent from the legacy Studio union', () => {
  const support = [
    {
      pipelineClass: 'FutureAutoModel',
      tasks: [
        { task: 'depth_estimation', operationIds: ['load', 'predict'], executionProfileIds: ['relative', 'metric'] },
      ],
    },
  ];
  const payload = {
    schemaVersion: 2,
    capabilities: ['relative', 'metric'].map((id) => ({
      modelType: id,
      label: `Future ${id}`,
      executionProfiles: [
        { id, model_type: id, pipeline_class: 'FutureAutoModel', default_repo: `owner/${id}`, public: true },
      ],
    })),
  };
  const descriptors = choices.parseWorkflowModelDescriptors(payload, support);
  const result = choices.workflowChoices(support, [], [], [], null, descriptors);
  assert.deepEqual(result.map((c) => [c.label, c.repo, c.profileId]).sort(), [
    ['Future metric', 'owner/metric', 'metric'],
    ['Future relative', 'owner/relative', 'relative'],
  ]);
  assert.equal(result.length, 2);
  const legacy = structuredClone(payload);
  delete legacy.capabilities[0].label;
  assert.deepEqual(
    choices.parseWorkflowModelDescriptors(legacy, support, [{ modelType: 'relative' }]),
    descriptors.filter((d) => d.profileId === 'metric'),
  );
  assert.deepEqual(
    choices.parseWorkflowModelDescriptors(
      { schemaVersion: 2, capabilities: [{ modelType: 'legacy', executionProfiles: [{ id: 'unreferenced' }] }] },
      [],
    ),
    [],
  );
  assert.deepEqual(choices.parseWorkflowModelDescriptors({ ...payload, schemaVersion: 1 }, support), []);
  for (const alter of [
    (p) => {
      p.capabilities[0].executionProfiles[0].model_type = 'wrong';
    },
    (p) => {
      p.capabilities[0].label = {};
    },
    (p) => {
      p.capabilities.push(p.capabilities[0]);
    },
  ]) {
    const malformed = structuredClone(payload);
    alter(malformed);
    assert.throws(() => choices.parseWorkflowModelDescriptors(malformed, support), /workflow model/i);
  }
  const unavailable = structuredClone(payload);
  unavailable.capabilities[0].executionProfiles[0].public = false;
  unavailable.capabilities[1].executionProfiles[0].pipeline_class = 'OtherPipeline';
  assert.deepEqual(choices.parseWorkflowModelDescriptors(unavailable, support), []);
});

for (const prefix of ['node-', '_', '-']) {
  test(`native saved ordinary Block supports atomic model replacement with ${prefix} identities`, async () => {
    const { createUserBlockFromSelection, createUserBlockNode } =
      await server.ssrLoadModule('/src/studio/userBlocks.ts');
    const { prepareOperationBlockGraph, planOwnerBlockOperationChange } = await server.ssrLoadModule(
      '/src/workflow/operationLegacyBlockChange.ts',
    );
    const { useUserBlockStore } = await server.ssrLoadModule('/src/stores/useUserBlockStore.ts');
    const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
    const studio = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
    const { commitOperationGraph } = await server.ssrLoadModule('/src/workflow/operationGraphTransaction.ts');
    const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
    const { remapOperationAuthoring } = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
    const old = seededStarter(true);
    Object.assign(old.nodes[0].node.params, {
      repo_id: { type: 'string', display: 'text', value: 'test/base' },
      revision: { type: 'string', display: 'text', value: 'a'.repeat(40) },
    });
    const draft = authoring.createOperationStarter(old, { x: 80, y: 80 });
    const ids = new Map(draft.nodes.map((node, index) => [node.id, `${prefix}${index}`]));
    draft.nodes = draft.nodes.map((node) => ({
      ...node,
      id: ids.get(node.id),
      selected: true,
      data: {
        ...node.data,
        operationAuthoring: remapOperationAuthoring(node.data.operationAuthoring, (id) => ids.get(id) ?? id),
      },
    }));
    draft.edges = draft.edges.map((edge) => ({ ...edge, source: ids.get(edge.source), target: ids.get(edge.target) }));
    draft.nodes[1].data.params.prompt.value = 'Keep this carefully edited prompt';
    const saved = createUserBlockFromSelection(draft, 'Saved ordinary graph');
    assert.equal(saved.ok, true);
    const savedSnapshot = structuredClone(saved.block);
    const root = createUserBlockNode(saved.block, { x: 300, y: 200 }, `${prefix}instance`);
    const graph = { nodes: [root], edges: [] };
    const snapshot = structuredClone(graph);
    const library = structuredClone(useUserBlockStore.getState().blocks);
    assert.equal(root.data.blockInstanceV2, undefined, 'exercise the actual v1 Save path');
    const prepared = prepareOperationBlockGraph(graph, root.id);
    const loader = prepared.root.data.blockInstanceV2.effectiveGraph.nodes.find(
      (node) => node.data.operationAuthoring?.operation.decomposition === 'loader',
    );
    const { operationModelSource } = await server.ssrLoadModule('/src/workflow/operationModelSource.ts');
    const control = prepared.root.data.blockInstanceV2.effectiveInterface.controls.find(
      (c) => c.binding.nodeId === loader.nodeId && c.binding.fieldId === 'repo_id',
    );
    assert.ok(control, 'model is exposed on the saved Block');
    const legacyOwner = operationModelSource(root, control.controlId);
    assert.equal(legacyOwner?.data.blockProjectionOwnerId, root.id);
    assert.equal(legacyOwner?.data.blockProjectionNodeId, loader.nodeId);
    const owner = operationModelSource(prepared.root, control.controlId);
    assert.equal(owner?.data.blockProjectionOwnerId, prepared.root.id);
    assert.equal(owner?.data.blockProjectionNodeId, loader.nodeId);
    assert.equal(operationModelSource(prepared.root, 'unknown'), null);
    assert.deepEqual(graph, snapshot, 'field lookup must never migrate a saved document');
    const target = structuredClone(old);
    target.nodes[0].node.params.repo_id.value = 'test/selected';
    target.nodes[0].node.params.revision.value = 'b'.repeat(40);
    const plan = planOwnerBlockOperationChange(graph, root.id, loader.nodeId, target, { replaceModel: true });
    assert.match(plan.diagnostics.join(' '), /legacy workflow instance/u);
    assert.deepEqual(graph, snapshot, 'preview and cancellation leave legacy bytes unchanged');
    assert.deepEqual(useUserBlockStore.getState().blocks, library);
    const updated = plan.graph.nodes.find((node) => node.data.blockInstanceV2);
    const effective = runtime.blockOperationGraphV2(updated.data.blockInstanceV2);
    assert.equal(effective.nodes[0].data.params.repo_id.value, 'test/selected');
    assert.equal(effective.nodes[0].data.params.revision.value, 'b'.repeat(40));
    assert.equal(effective.nodes[1].data.params.prompt.value, 'Keep this carefully edited prompt');
    for (const node of updated.data.blockInstanceV2.effectiveGraph.nodes)
      for (const hint of node.data.operationAuthoring.sharedInputs ?? []) assert.equal(hint.loaderId, loader.nodeId);
    useFlowStore.getState().replaceGraph(graph);
    useFlowStore.getState().resetHistory();
    const before = useFlowStore.getState().toObject();
    commitOperationGraph(
      plan.graph,
      studio.captureWorkflowOperationContext(),
      JSON.stringify(before),
      'Change saved Block model',
    );
    assert.equal(useFlowStore.getState().historyPast.length, 1);
    useFlowStore.getState().undo();
    assert.deepEqual(useFlowStore.getState().toObject(), before);
    useFlowStore.getState().redo();
    const applied = JSON.parse(JSON.stringify(useFlowStore.getState().toObject()));
    useFlowStore.getState().replaceGraph(applied);
    assert.deepEqual(useFlowStore.getState().toObject(), applied);
    assert.deepEqual(useUserBlockStore.getState().blocks, library);
    assert.deepEqual(saved.block, savedSnapshot);
  });
}

test('model replacement accepts the actual legacy graph returned by Create Block', async () => {
  const { createUserBlockFromSelection } = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  const { planOwnerBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationLegacyBlockChange.ts');
  const old = graph();
  old.nodes.forEach((node) => {
    node.selected = true;
  });
  const saved = createUserBlockFromSelection(old, 'Native save regression');
  assert.equal(saved.ok, true);
  assert.equal(saved.blockNode.data.blockInstanceV2, undefined);
  const planned = planOwnerBlockOperationChange(
    { nodes: saved.nodes, edges: saved.edges },
    saved.blockNode.id,
    old.nodes[0].id,
    starter(),
  );
  assert.ok(planned.graph.nodes.some((node) => node.data.blockInstanceV2));
});

for (const scope of ['agreed', 'unrelated', 'conflicting', 'sealed']) {
  test(`Block replacement protects ${scope} mirrored model controls`, async () => {
    const { runtime, instance, draft } = await operationBlock('model-controls', starter());
    const { planOwnerBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationLegacyBlockChange.ts');
    let base = instance;
    const mirrorId = scope === 'unrelated' ? 'unrelated-node' : draft.nodes[1].id;
    if (scope === 'unrelated')
      base = runtime.addBlockEffectiveGraphNodeV2(base, {
        nodeId: mirrorId,
        nodeType: 'custom',
        data: { label: 'Unrelated', params: { pipeline_class: { type: 'string', value: 'FuturePipeline' } } },
      });
    else {
      const graph = structuredClone(base.effectiveGraph);
      graph.nodes[1].data.params.pipeline_class = { type: 'string', value: 'FuturePipeline' };
      base = runtime.replaceBlockEffectiveGraphV2(base, graph);
    }
    base = runtime.replaceBlockEffectiveInterfaceV2(base, {
      boundary: base.effectiveInterface.boundary,
      controls: [
        {
          controlId: 'pipeline',
          label: 'Pipeline',
          binding: { nodeId: draft.nodes[0].id, fieldId: 'pipeline_class' },
          mirrorBindings: [{ nodeId: mirrorId, fieldId: 'pipeline_class' }],
          valueType: 'string',
          defaultValue: 'FuturePipeline',
          order: 0,
          ...(scope === 'sealed' ? { sealed: true } : {}),
        },
      ],
    });
    const graph = { nodes: [runtime.createBlockRootNodeV2(base)], edges: [] };
    const snapshot = structuredClone(graph);
    const target = starter('OtherPipeline');
    target.nodes[1].node.params.pipeline_class = {
      type: 'string',
      value: scope === 'conflicting' ? 'ConflictingPipeline' : 'OtherPipeline',
    };
    target.nodes[1].operation.binding.values.pipeline_class = target.nodes[1].node.params.pipeline_class.value;
    if (scope === 'agreed') {
      const result = planOwnerBlockOperationChange(graph, base.instanceId, draft.nodes[0].id, target);
      assert.equal(result.graph.nodes[0].data.blockInstanceV2.values.pipeline, 'OtherPipeline');
    } else
      assert.throws(
        () => planOwnerBlockOperationChange(graph, base.instanceId, draft.nodes[0].id, target),
        /overrides the replacement value/,
      );
    assert.deepEqual(graph, snapshot);
  });
}

for (const status of ['running', 'queued']) {
  test(`legacy model-change preview rejects a ${status} owner without converting it`, async () => {
    const { createUserBlockFromSelection } = await server.ssrLoadModule('/src/studio/userBlocks.ts');
    const { prepareOperationBlockGraph } = await server.ssrLoadModule('/src/workflow/operationLegacyBlockChange.ts');
    const draft = graph();
    draft.nodes.forEach((node) => {
      node.selected = true;
    });
    const saved = createUserBlockFromSelection(draft, 'Busy Block');
    assert.equal(saved.ok, true);
    saved.blockNode.data.executionStatus = status;
    const before = structuredClone(saved.nodes);
    assert.throws(
      () => prepareOperationBlockGraph({ nodes: saved.nodes, edges: saved.edges }, saved.blockNode.id),
      /Wait for this Block/,
    );
    assert.deepEqual(saved.nodes, before);
  });
}

test('legacy nested snapshot conversion retains each advisory loader scope', async () => {
  const { createUserBlockFromSelection } = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  const { migrateLegacyHierarchyV2 } = await server.ssrLoadModule('/src/studio/legacyBlockMovementV2.ts');
  const draft = authoring.createOperationStarter(seededStarter(true), { x: 40, y: 60 });
  draft.nodes.forEach((node) => {
    node.selected = true;
  });
  const saved = createUserBlockFromSelection(draft, 'Inner saved graph');
  assert.equal(saved.ok, true);
  const root = { ...saved.blockNode, id: 'inner' };
  const wrapper = {
    ...structuredClone(saved.block),
    id: 'outer',
    nodes: [root],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
  };
  const before = structuredClone(wrapper);
  const converted = migrateLegacyHierarchyV2(wrapper, []);
  const loader = converted.graph.nodes.find(
    (node) => node.data.operationAuthoring?.operation.decomposition === 'loader',
  );
  assert.ok(loader.nodeId.startsWith('inner::'));
  for (const node of converted.graph.nodes)
    for (const hint of node.data.operationAuthoring?.sharedInputs ?? []) assert.equal(hint.loaderId, loader.nodeId);
  assert.deepEqual(wrapper, before);
});

test('integrated model operations author, parse and replace without a synthetic loader', () => {
  const base = starter('IntegratedPipeline', 'image_upscale');
  const entry = base.nodes[0];
  Object.assign(entry.node, {
    action: 'Upscale',
    label: 'Upscale',
    params: {
      model_id: { type: 'string', display: 'modelselect', value: { source: 'hub', value: 'test/model' } },
      image: { type: 'image', display: 'input', required: true },
      output: { type: 'image', display: 'output' },
      downscale: { type: 'float', value: 1, min: 0.1, max: 1 },
    },
  });
  Object.assign(entry.operation, {
    operationId: 'image.upscale',
    nodeKey: 'modules.Test.Upscale',
    nodeType: 'integrated',
    decomposition: 'integrated',
    workflowId: null,
    binding: { pipelineClass: 'IntegratedPipeline', values: {} },
    ports: Object.entries(entry.node.params).map(([name, field]) => ({
      name,
      semanticName: name,
      direction: field.display === 'output' ? 'output' : 'input',
      roles: ['value'],
      types: [field.type],
      required: field.required === true,
      hidden: false,
      semantics: {
        kind: field.type === 'image' ? 'media' : 'value',
        scope: null,
        state: null,
        owner: 'none',
        members: [],
      },
    })),
  });
  const draft = {
    ...base,
    workflowId: null,
    nodes: [entry],
    edges: [],
    requiredInputs: [{ operationId: 'image.upscale', field: 'image' }],
    upstreamBlocks: [],
  };
  assert.deepEqual(
    requests.parseOperationStarter({ schemaVersion: 1, ...draft }, draft.pipelineClass, draft.task, [entry.operation]),
    draft,
  );
  const graph = authoring.createOperationStarter(draft, { x: 100, y: 100 });
  assert.equal(graph.nodes.length, 1);
  const owner = graph.nodes[0];
  owner.data.params.downscale.value = 0.5;
  owner.data.params.image.value = '@data/images/reference.webp';
  assert.deepEqual(
    authoring.operationScope(graph, owner.id).map((node) => node.id),
    [owner.id],
  );
  const target = structuredClone(draft);
  target.nodes[0].node.params.model_id.value = { source: 'hub', value: 'test/selected-model' };
  const before = structuredClone(graph);
  const plan = authoring.planOperationChange(graph, owner.id, target, { replaceModel: true });
  assert.deepEqual(graph, before);
  assert.equal(plan.graph.nodes.length, 1);
  assert.equal(plan.graph.nodes[0].data.params.model_id.value.value, 'test/selected-model');
  assert.equal(plan.graph.nodes[0].data.params.downscale.value, 0.5);
  assert.equal(plan.graph.nodes[0].data.params.image.value, '@data/images/reference.webp');
  const invalid = structuredClone(draft);
  invalid.nodes[0].operation.nodeType = 'pipeline';
  assert.throws(() =>
    requests.parseOperationStarter({ schemaVersion: 1, ...invalid }, draft.pipelineClass, draft.task, [
      entry.operation,
    ]),
  );
});

test('pristine route replacement reconnects preview across decomposition and refuses authored graphs', () => {
  const old = starter();
  const output = { type: 'image', display: 'output' };
  old.nodes[1].node.params.images = output;
  old.nodes[1].operation.ports.push({
    name: 'images',
    semanticName: 'images',
    direction: 'output',
    roles: ['value'],
    types: ['image'],
    required: false,
    hidden: false,
    semantics: { kind: 'media', scope: null, state: null, owner: 'none', members: [] },
  });
  const next = structuredClone(old);
  next.pipelineClass = 'WholePipeline';
  for (const n of next.nodes) n.operation.pipelineClass = 'WholePipeline';
  next.nodes[1].operation.operationId = 'diffusion.generate_image';
  next.nodes[1].operation.decomposition = 'pipeline';
  next.nodes[1].operation.nodeType = 'pipeline';
  next.nodes[1].operation.blockName = null;
  next.edges[0].target = 'diffusion.generate_image';
  const graph = authoring.createOperationStarter(old, { x: 80, y: 120 });
  const preview = {
    id: 'preview',
    type: 'custom',
    position: { x: 1500, y: 120 },
    data: {
      module: 'modules.Image',
      action: 'Preview',
      params: { image: { type: 'image', display: 'input' } },
    },
  };
  graph.nodes.push(preview);
  graph.edges.push({
    id: 'preview-edge',
    source: graph.nodes[1].id,
    sourceHandle: 'images',
    target: 'preview',
    targetHandle: 'image',
  });
  const before = structuredClone(graph);
  const plan = authoring.planPristineOperationChange(graph, graph.nodes[0].id, old, next);
  assert.ok(plan);
  assert.equal(plan.graph.nodes.length, 3);
  assert.equal(plan.diagnostics.length, 0);
  assert.deepEqual(
    plan.graph.nodes.find((n) => n.id === 'preview'),
    preview,
  );
  const generation = plan.graph.nodes.find(
    (n) => n.data.operationAuthoring?.operation.operationId === 'diffusion.generate_image',
  );
  assert.equal(plan.graph.edges.find((e) => e.target === 'preview').source, generation.id);
  assert.deepEqual(graph, before);
  const edited = structuredClone(graph);
  edited.nodes[1].data.params.prompt.value = '';
  assert.equal(
    authoring.planPristineOperationChange(edited, edited.nodes[0].id, old, next),
    null,
    'Intentionally empty prompt is authored',
  );
  const rewired = structuredClone(graph);
  rewired.edges[0].sourceHandle = 'custom';
  assert.equal(authoring.planPristineOperationChange(rewired, rewired.nodes[0].id, old, next), null);
  const custom = structuredClone(graph);
  custom.nodes.find((n) => n.id === 'preview').data.module = 'custom.Review';
  assert.equal(authoring.planPristineOperationChange(custom, custom.nodes[0].id, old, next), null);
});

test('explicit model defaults restore creative controls while preserving wired inputs and loader policy', () => {
  const source = starter();
  source.nodes[0].node.params.dtype = { type: 'string', display: 'text', value: 'bfloat16' };
  const graph = authoring.createOperationStarter(source, { x: 0, y: 0 });
  const [loader, denoise] = graph.nodes;
  loader.data.params.dtype.value = 'float32';
  denoise.data.params.prompt.value = 'Keep this connected prompt';
  denoise.data.params.steps.value = 47;
  graph.nodes.push({
    id: 'custom',
    type: 'custom',
    position: { x: -50, y: 0 },
    data: {
      module: 'custom.Prompt',
      action: 'Prompt',
      params: { output: { type: 'string', display: 'output' } },
    },
  });
  graph.edges.push({
    id: 'custom-prompt',
    source: 'custom',
    sourceHandle: 'output',
    target: denoise.id,
    targetHandle: 'prompt',
  });
  const original = structuredClone(graph);
  const plan = authoring.planOperationChange(graph, loader.id, source, { restoreDefaults: true });
  assert.equal(plan.graph.nodes.find((n) => n.id === denoise.id).data.params.steps.value, 20);
  assert.equal(
    plan.graph.nodes.find((n) => n.id === denoise.id).data.params.prompt.value,
    'Keep this connected prompt',
  );
  assert.equal(plan.graph.nodes.find((n) => n.id === loader.id).data.params.dtype.value, 'float32');
  assert.deepEqual(
    plan.graph.nodes.find((n) => n.id === 'custom'),
    original.nodes[2],
  );
  assert.ok(plan.graph.edges.some((e) => e.id === 'custom-prompt'));
  assert.deepEqual(graph, original);
});

test('model grouping keeps exact backend routes available without duplicate repository rows', () => {
  const route = (id, decomposition, repo = 'org/model') => ({
    id,
    task: 'text_to_image',
    repo,
    support: { decomposition, dependencies: 'ready' },
  });
  const source = [route('whole', 'pipeline'), route('modular', 'stages'), route('another', 'pipeline', 'org/another')];
  assert.equal(choices.groupWorkflowModels(source).length, 2);
  assert.equal(choices.groupWorkflowModels(source)[0].primary.id, 'modular');
  assert.equal(choices.groupWorkflowModels(source, 'whole')[0].primary.id, 'whole');
  assert.deepEqual(
    choices.groupWorkflowModels(source)[0].routes.map((r) => r.id),
    ['modular', 'whole'],
  );
  assert.equal(source[0].id, 'whole');
});

test('task model preferences are bounded advisory identities and tolerate corrupt or unavailable storage', async () => {
  const preferences = await server.ssrLoadModule('/src/workflow/taskModelPreferences.ts');
  localStorage.setItem('modiff.task-models', '[]');
  assert.equal(preferences.preferredTaskModel('text_to_image'), undefined);
  preferences.rememberTaskModel('text_to_image', 'flux-schnell:direct');
  assert.equal(preferences.preferredTaskModel('text_to_image'), 'flux-schnell:direct');
  preferences.rememberTaskModel('text_to_image', 'bad\nidentity');
  assert.equal(preferences.preferredTaskModel('text_to_image'), 'flux-schnell:direct');
  for (let i = 0; i < 80; i++) preferences.rememberTaskModel(`task_${i}`, `profile_${i}`);
  assert.equal(Object.keys(JSON.parse(localStorage.getItem('modiff.task-models'))).length, 64);
});
