import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let server, authoring, requests, drafts, choices;
const evaluationImageFixture = JSON.parse(
  fs.readFileSync(new URL('../tests/fixtures/evaluation-image-authoring.v1.json', import.meta.url), 'utf8'),
);
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

test('replaced native stages cannot overwrite exact whole-pipeline binding values', () => {
  const source = graph();
  source.nodes[1].data.params.prompt.value = 'Authored native prompt';
  const whole = starter('WholePipeline');
  whole.nodes[1].operation.operationId = 'diffusion.generate_image';
  whole.nodes[1].operation.decomposition = 'pipeline';
  whole.nodes[1].operation.nodeType = 'pipeline';
  whole.nodes[1].operation.blockName = null;
  whole.nodes[1].operation.binding.values.prompt = 'ExactBoundPrompt';
  whole.nodes[1].node.params.prompt.value = 'ExactBoundPrompt';
  whole.edges[0].target = 'diffusion.generate_image';
  const changed = authoring.planOperationChange(source, source.nodes[0].id, whole);
  const generation = changed.graph.nodes.find(
    (node) => node.data.operationAuthoring?.operation.operationId === 'diffusion.generate_image',
  );
  assert.equal(generation.data.params.prompt.value, 'ExactBoundPrompt');
  assert.ok(
    changed.graph.nodes.some((node) =>
      node.data.operationAuthoring?.retained.some((entry) => entry.value === 'Authored native prompt'),
    ),
  );
});

test('resolved operation schemas suppress family-default initialization but keep connection visibility actions', () => {
  const s = starter();
  const node = s.nodes[1].node;
  node.params.selector = { type: 'string', display: 'select', value: 'Variant', onChange: 'updateNode' };
  node.params.models.onSignal = 'updateNode';
  node.params.guider = { type: 'custom_guider', display: 'input', onChange: { true: [], false: ['guidance'] } };
  const before = structuredClone(s);
  const graph = authoring.createOperationStarter(s, { x: 0, y: 0 });
  const params = graph.nodes[1].data.params;
  assert.equal(params.selector.fieldOptions.suppressInitialFieldAction, true);
  assert.equal(params.models.fieldOptions.suppressAutomaticSignalAction, true);
  assert.equal(params.guider.fieldOptions?.suppressInitialFieldAction, undefined);
  assert.deepEqual(params.guider.onChange, node.params.guider.onChange);
  assert.deepEqual(s, before, 'The backend declaration is not mutated.');
});

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
  const adapted = result.graph.nodes.find((n) => n.data.action === 'Denoise');
  assert.notEqual(adapted.id, denoise.id, 'A different bound pipeline cannot inherit cached instance state.');
  assert.equal(adapted.data.params.prompt.value, 'My actual prompt');
  assert.equal(adapted.data.params.steps.value, 30);
  assert.deepEqual(adapted.position, denoise.position);
  assert.equal(adapted.data.operationAuthoring.retained[0].value, 4);
  assert.equal(adapted.data.params.old_control, undefined);
  assert.deepEqual(
    result.graph.edges.find((e) => e.id === 'external'),
    { ...g.edges[1], target: adapted.id },
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
  const returned = authoring.planOperationChange(result.graph, result.graph.nodes[0].id, starter());
  assert.equal(returned.graph.nodes.find((n) => n.data.action === 'Denoise').id, g.nodes[1].id);
  assert.equal(returned.graph.edges[0].target, g.nodes[1].id);
});

test('same Python actions get pipeline-scoped runtime IDs and restore their original IDs on return', () => {
  const source = starter();
  const graph = authoring.createOperationStarter(source, { x: 30, y: 40 });
  const switched = authoring.planOperationChange(graph, graph.nodes[0].id, starter('OtherPipeline')).graph;
  for (let index = 0; index < graph.nodes.length; index++) {
    assert.equal(switched.nodes[index].data.action, graph.nodes[index].data.action);
    assert.notEqual(switched.nodes[index].id, graph.nodes[index].id);
    assert.deepEqual(switched.nodes[index].position, graph.nodes[index].position);
  }
  const returned = authoring.planOperationChange(switched, switched.nodes[0].id, source).graph;
  assert.deepEqual(
    returned.nodes.map((node) => node.id),
    graph.nodes.map((node) => node.id),
  );
  assert.deepEqual(
    returned.edges.map(({ source, target }) => ({ source, target })),
    graph.edges.map(({ source, target }) => ({ source, target })),
  );
  const same = authoring.planOperationChange(returned, returned.nodes[0].id, source).graph;
  assert.deepEqual(
    same.nodes.map((node) => node.id),
    returned.nodes.map((node) => node.id),
  );
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
  assert.match(result.diagnostics.join(' '), /Node · value → Denoise · image will be disconnected/);
  assert.doesNotMatch(result.diagnostics.join(' '), /custom|node-[A-Za-z0-9_-]+/);
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
  assert.notEqual(plan.graph.edges[0].source, loader.id);
  assert.equal(
    plan.graph.edges[0].source,
    plan.graph.nodes.find(
      (n) => n.data.operationAuthoring?.operation.pipelineClass === 'OtherPipeline' && n.data.action === 'Load',
    ).id,
  );
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

test('starter accepts declared dotted layer controls without relaxing port or other field identifiers', () => {
  const s = starter();
  const operation = s.nodes[1];
  const name = 'mid_block.attentions.0.transformer_blocks';
  operation.node.params.blocks_select = { display: 'select', options: [name], value: [name] };
  operation.node.params[name] = { display: 'layerconfig', value: { enabled: true, indices: '0,1' } };
  const operations = s.nodes.map((n) => n.operation);
  const parse = (value) => requests.parseOperationStarter(value, s.pipelineClass, s.task, operations);
  assert.doesNotThrow(() => parse({ schemaVersion: 1, ...s }));
  for (const mutate of [
    (params) => {
      params.blocks_select.options = [];
    },
    (params) => {
      params[name].display = 'text';
    },
    (params) => {
      params['mid_block.__proto__.0'] = params[name];
      params.blocks_select.options.push('mid_block.__proto__.0');
    },
    (params) => {
      params['mid_block..0'] = params[name];
      params.blocks_select.options.push('mid_block..0');
    },
  ]) {
    const bad = structuredClone({ schemaVersion: 1, ...s });
    mutate(bad.nodes[1].node.params);
    assert.throws(() => parse(bad));
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

test('review ignores derived operation availability but protects values, wires, bindings and layout', async () => {
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const { captureWorkflowOperationContext } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const { commitOperationGraph, operationGraphSignature } = await server.ssrLoadModule(
    '/src/workflow/operationGraphTransaction.ts',
  );
  const flow = useFlowStore.getState();
  flow.replaceGraph(graph());
  flow.resetHistory();
  const initial = flow.toObject();
  const sibling = structuredClone(initial.nodes[1]);
  sibling.id = 'independent-refiner';
  flow.replaceGraph({ ...initial, nodes: [...initial.nodes, sibling] });
  const before = flow.toObject();
  const signature = operationGraphSignature(before);
  const proposed = structuredClone(before);
  proposed.nodes[0].position.x += 100;
  flow.setParam(sibling.id, 'steps', true, 'hidden');
  flow.setParam(sibling.id, 'steps', true, 'disabled');
  assert.equal(operationGraphSignature(flow.toObject()), signature);
  commitOperationGraph(proposed, captureWorkflowOperationContext(), signature, 'Reviewed change');
  const retained = flow.toObject().nodes.find((node) => node.id === sibling.id);
  assert.equal(retained.data.params.steps.hidden, true);
  assert.equal(retained.data.params.steps.disabled, true);
  for (const mutate of [
    (value) => {
      value.nodes[1].data.params.steps.value = 123;
    },
    (value) => {
      value.edges = [];
    },
    (value) => {
      value.nodes[0].data.operationAuthoring.operation.pipelineClass = 'Changed';
    },
    (value) => {
      value.nodes[0].position.x += 1;
    },
    (value) => {
      value.nodes[1].data.params.steps.type = 'string';
    },
    (value) => {
      value.nodes[1].data.operationAuthoring.authored = ['steps'];
    },
  ]) {
    flow.replaceGraph(before);
    const changed = structuredClone(before);
    mutate(changed);
    flow.replaceGraph(changed);
    assert.throws(
      () => commitOperationGraph(proposed, captureWorkflowOperationContext(), signature, 'Stale'),
      /changed/,
    );
  }
});

test('a reviewed model change survives delayed empty uiState enrichment without losing Undo or sibling metadata', async () => {
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const { captureWorkflowOperationContext } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const { commitOperationGraph, operationGraphSignature } = await server.ssrLoadModule(
    '/src/workflow/operationGraphTransaction.ts',
  );
  const flow = useFlowStore.getState();
  flow.replaceGraph(graph());
  flow.resetHistory();
  let before = flow.toObject();
  delete before.nodes[0].data.uiState;
  delete before.nodes[1].data.uiState;
  const sibling = structuredClone(before.nodes[1]);
  sibling.id = 'independent-reviewed-stage';
  sibling.data.uiState = { disabled: false };
  delete sibling.data.operationAuthoring;
  before.nodes.push(sibling);
  flow.replaceGraph(before);
  before = flow.toObject();
  const context = captureWorkflowOperationContext();
  const signature = operationGraphSignature(before);
  const plan = authoring.planOperationChange(before, before.nodes[0].id, starter('OtherPipeline'));
  const liveBefore = JSON.stringify(useFlowStore.getState().nodes);
  const enriched = structuredClone(before);
  enriched.nodes[0].data.uiState = {};
  enriched.nodes[1].data.uiState = {};
  enriched.nodes[2].data.uiState = { disabled: false };
  flow.replaceGraph(enriched);
  for (const node of enriched.nodes.slice(0, 2))
    assert.deepEqual(useFlowStore.getState().nodes.find((live) => live.id === node.id).data.uiState, {});
  assert.notEqual(
    JSON.stringify(useFlowStore.getState().nodes),
    liveBefore,
    'Exercise the actual delayed metadata difference.',
  );
  assert.deepEqual(flow.toObject(), before, 'Empty presentation metadata is not a durable workflow edit.');
  assert.equal(operationGraphSignature(flow.toObject()), signature);
  commitOperationGraph(plan.graph, context, signature, 'Change model after presentation refresh');
  assert.equal(flow.toObject().nodes[0].data.params.pipeline_class.value, 'OtherPipeline');
  assert.equal(flow.toObject().nodes.find((node) => node.id === sibling.id).data.uiState.disabled, false);
  assert.deepEqual(
    flow.toObject().nodes.find((node) => node.id === sibling.id).data.params,
    enriched.nodes[2].data.params,
  );
  assert.equal(useFlowStore.getState().historyPast.length, 1);
  flow.undo();
  assert.equal(flow.toObject().nodes[0].data.params.pipeline_class.value, 'FuturePipeline');
  assert.equal(flow.toObject().nodes.find((node) => node.id === sibling.id).data.uiState.disabled, false);
  flow.redo();
  assert.equal(flow.toObject().nodes[0].data.params.pipeline_class.value, 'OtherPipeline');
  assert.equal(flow.toObject().nodes.find((node) => node.id === sibling.id).data.uiState.disabled, false);
});

test('preview normalization preserves every nonempty UI setting and authored graph mutation', async () => {
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const { captureWorkflowOperationContext } = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  const { commitOperationGraph, operationGraphSignature, operationGraphPreviewSignature } = await server.ssrLoadModule(
    '/src/workflow/operationGraphTransaction.ts',
  );
  const flow = useFlowStore.getState();
  flow.replaceGraph(graph());
  const original = flow.toObject();
  delete original.nodes[0].data.uiState;
  original.nodes[1].data.params.seed = { type: 'int', value: { value: 4109, isRandom: false } };
  const previewSignature = operationGraphPreviewSignature(original);
  const signature = operationGraphSignature(original);
  const empty = structuredClone(original);
  empty.nodes[0].data.uiState = {};
  assert.equal(operationGraphPreviewSignature(empty), previewSignature);
  assert.equal(operationGraphSignature(empty), signature);
  for (const mutate of [
    (value) => {
      value.nodes[0].data.uiState = { collapsed: false };
    },
    (value) => {
      value.nodes[0].data.uiState = { collapsed: true };
    },
    (value) => {
      value.nodes[0].data.uiState = { disabled: false };
    },
    (value) => {
      value.nodes[0].data.uiState = { disabled: true };
    },
    (value) => {
      value.nodes[0].data.uiState = { blockExpanded: false };
    },
    (value) => {
      value.nodes[0].data.params.pipeline_class.value = 'AnotherModel';
    },
    (value) => {
      value.nodes[1].data.params.seed.value.value = 4110;
    },
    (value) => {
      value.nodes[1].data.params.seed.value.isRandom = true;
    },
    (value) => {
      value.nodes[1].data.operationAuthoring.authored = ['prompt'];
    },
    (value) => {
      value.nodes[1].data.operationAuthoring.operation.binding.values = { task: 'image_to_image' };
    },
    (value) => {
      value.nodes[1].data.params.prompt.value = 'Edited prompt';
    },
    (value) => {
      value.nodes[0].position.x += 1;
    },
    (value) => {
      value.edges[0].targetHandle = 'different-port';
    },
    (value) => {
      value.nodes[0].data.label = 'Edited label';
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.notEqual(operationGraphPreviewSignature(changed), previewSignature);
    assert.notEqual(operationGraphSignature(changed), signature);
    flow.replaceGraph(changed);
    assert.throws(
      () => commitOperationGraph(original, captureWorkflowOperationContext(), signature, 'Stale'),
      /changed/,
    );
  }
  for (const uiState of [null, [], { arbitrary: {} }]) {
    const changed = structuredClone(original);
    changed.nodes[0].data.uiState = uiState;
    assert.notEqual(operationGraphPreviewSignature(changed), previewSignature);
    assert.notEqual(operationGraphSignature(changed), signature);
  }
  for (const field of ['hidden', 'disabled']) {
    const changed = structuredClone(original);
    changed.nodes[1].data.params.prompt[field] = true;
    assert.notEqual(
      operationGraphPreviewSignature(changed),
      previewSignature,
      'The UI preview check gains no broader availability waiver.',
    );
  }
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
  const seedPort = {
    ...source.nodes[1].operation.ports.find((port) => port.name === 'steps'),
    name: 'seed',
    semanticName: 'seed',
  };
  source.nodes[1].operation.ports.push(seedPort);
  const g = authoring.createOperationStarter(source, { x: 0, y: 0 });
  g.nodes[1].data.params.steps.value = 20; // NodeContent initializes the declared default.
  g.nodes[1].data.params.seed.value = { value: '4109', isRandom: false }; // Native RandomField form.
  const next = starter('OtherPipeline', 'text_to_image', 30);
  next.nodes[1].node.params.seed = { ...source.nodes[1].node.params.seed };
  next.nodes[1].operation.ports.push(structuredClone(seedPort));
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

test('public authoring offers retain exact per-task raw choices for known and generic workflow models', () => {
  const pipelineClass = 'FuturePipeline';
  const profileId = 'future:official:v1';
  const tasks = ['text_to_image', 'edit_image'];
  const offers = tasks.map((task) => ({
    executionProfileId: profileId,
    pipelineClass,
    task,
    authoringRecipeId: `future:${task}:append:v1`,
    rawAuthoringRecipeId: `future:${task}:raw:v1`,
    rawAuthoringRecipeChoices: [
      { authoringRecipeId: `future:${task}:raw:v1`, label: 'Raw FP32' },
      { authoringRecipeId: `future:${task}:raw-nf4:v1`, label: 'Raw NF4' },
    ],
    layoutAuthoringRecipeChoices: [
      { authoringRecipeId: `future:${task}:append:v1`, label: 'Append wording' },
      { authoringRecipeId: `future:${task}:constrained:v1`, label: 'Wording for authored regions' },
    ],
  }));
  const profile = {
    id: profileId,
    pipeline_class: pipelineClass,
    model_type: 'FutureModel',
    default_repo: 'review/future-model',
    modes: tasks,
    public: true,
    authoringRecipes: offers,
  };
  const model = {
    modelType: profile.model_type,
    label: 'Future model',
    defaultRepo: profile.default_repo,
    executionProfiles: [profile],
  };
  const support = [
    {
      pipelineClass,
      tasks: tasks.map((task) => ({
        task,
        operationIds: ['load', 'run'],
        executionProfileIds: [profileId],
      })),
    },
  ];
  const payload = { schemaVersion: 2, capabilities: [model] };
  const original = structuredClone(payload);
  for (const known of [[], [model]]) {
    const descriptors = choices.parseWorkflowModelDescriptors(payload, support, known);
    assert.equal(descriptors.length, 1);
    const [descriptor] = descriptors;
    assert.equal(descriptor.evaluationOnly, undefined);
    for (const offer of offers) {
      assert.equal(descriptor.authoringRecipes[offer.task], offer.authoringRecipeId);
      assert.equal(descriptor.rawPromptAuthoringRecipes[offer.task], offer.rawAuthoringRecipeId);
      assert.deepEqual(descriptor.rawPromptAuthoringChoices[offer.task], offer.rawAuthoringRecipeChoices);
      assert.deepEqual(descriptor.layoutPromptAuthoringChoices[offer.task], offer.layoutAuthoringRecipeChoices);
    }
    const rows = choices.workflowChoices(support, known, [], [], null, descriptors);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => !row.evaluationOnly));
    for (const row of rows)
      assert.equal(row.authoringRecipeId, offers.find((offer) => offer.task === row.task).authoringRecipeId);
  }
  assert.deepEqual(payload, original, 'Parsing cannot rewrite source metadata or promote private identities');
  for (const alter of [
    (rows) => {
      rows.push(structuredClone(rows[0]));
    },
    (rows) => {
      rows[0].executionProfileId = 'another:profile';
    },
    (rows) => {
      rows[0].pipelineClass = 'AnotherPipeline';
    },
    (rows) => {
      rows[0].task = 'unsupported_task';
    },
    (rows) => {
      rows[0].rawAuthoringRecipeChoices[0].label = ' padded ';
    },
    (rows) => {
      rows[0].rawAuthoringRecipeChoices[0].authoringRecipeId = 'undeclared:v1';
    },
    (rows) => {
      rows[0].rawAuthoringRecipeChoices[1].authoringRecipeId = rows[0].authoringRecipeId;
    },
  ]) {
    const bad = structuredClone(payload);
    alter(bad.capabilities[0].executionProfiles[0].authoringRecipes);
    assert.throws(() => choices.parseWorkflowModelDescriptors(bad, support, [model]));
  }
  const old = structuredClone(payload);
  delete old.capabilities[0].executionProfiles[0].authoringRecipes;
  assert.deepEqual(
    choices.parseWorkflowModelDescriptors(old, support, [model]),
    [],
    'Old known-model payloads keep their legacy presentation boundary',
  );
  const undeclaredPublic = structuredClone(payload);
  delete undeclaredPublic.capabilities[0].executionProfiles[0].public;
  assert.throws(() => choices.parseWorkflowModelDescriptors(undeclaredPublic, support, [model]));
  const privateOffer = structuredClone(payload);
  privateOffer.capabilities[0].executionProfiles[0].public = false;
  assert.deepEqual(
    choices.parseWorkflowModelDescriptors(privateOffer, support, [model]),
    [],
    'Private offers are never promoted through public descriptors',
  );
});

test('authored layout choices are explicit bounded offers and cannot overlap raw alternatives', async () => {
  const { parseAuthoringRecipeOffers } = await server.ssrLoadModule('/src/workflow/authoringRecipeOffers.ts');
  const profile = { id: 'future:official:v1', pipeline: 'FuturePipeline', modes: ['text_to_image'] };
  const row = {
    executionProfileId: profile.id,
    pipelineClass: profile.pipeline,
    task: profile.modes[0],
    authoringRecipeId: 'future:append:v1',
    rawAuthoringRecipeId: 'future:raw:v1',
    rawAuthoringRecipeChoices: [{ authoringRecipeId: 'future:raw:v1', label: 'Raw wording' }],
    layoutAuthoringRecipeChoices: [
      { authoringRecipeId: 'future:append:v1', label: 'Append wording; keep layout' },
      { authoringRecipeId: 'future:constrained:v1', label: 'Generate wording for authored regions' },
    ],
  };
  const support = [{ pipelineClass: profile.pipeline, tasks: [{ task: row.task, executionProfileIds: [profile.id] }] }];
  const invalid = () => {
    throw new Error('invalid offers');
  };
  const parsed = parseAuthoringRecipeOffers([row], [profile], support, invalid);
  assert.deepEqual(parsed.layoutChoices.get(profile.id)[row.task], row.layoutAuthoringRecipeChoices);
  assert.equal(
    parsed.recipes.get(profile.id)[row.task],
    row.authoringRecipeId,
    'Adding an explicit mode cannot change the default.',
  );
  const original = structuredClone(row);
  for (const alter of [
    (item) => {
      item.layoutAuthoringRecipeChoices = [];
    },
    (item) => {
      item.layoutAuthoringRecipeChoices[0].authoringRecipeId = 'another:v1';
    },
    (item) => {
      item.layoutAuthoringRecipeChoices[1].authoringRecipeId = item.authoringRecipeId;
    },
    (item) => {
      item.layoutAuthoringRecipeChoices[1].authoringRecipeId = item.rawAuthoringRecipeId;
    },
    (item) => {
      item.layoutAuthoringRecipeChoices[1].label = ' padded ';
    },
    (item) => {
      item.layoutAuthoringRecipeChoices.push(
        ...Array.from({ length: 3 }, (_, index) => ({ authoringRecipeId: `other:${index}`, label: 'Other' })),
      );
    },
    (item) => {
      Object.defineProperty(item.layoutAuthoringRecipeChoices, '0', {
        enumerable: true,
        get: () => original.layoutAuthoringRecipeChoices[0],
      });
    },
    (item) => {
      item.layoutAuthoringRecipeChoices.extra = true;
    },
  ]) {
    const bad = structuredClone(row);
    alter(bad);
    assert.throws(() => parseAuthoringRecipeOffers([bad], [profile], support, invalid));
  }
  assert.deepEqual(row, original, 'Metadata parsing cannot alter source offers.');
  const old = structuredClone(row);
  delete old.layoutAuthoringRecipeChoices;
  assert.equal(parseAuthoringRecipeOffers([old], [profile], support, invalid).layoutChoices.size, 0);
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

test('evaluation authoring is an explicit private Expert namespace and cannot promote public discovery', async () => {
  const evaluation = await server.ssrLoadModule('/src/workflow/evaluationAuthoring.ts');
  const operations = starter().nodes.map((node) => node.operation);
  const requirement = {
    schemaVersion: 1,
    delivery: 'base',
    requiredNow: false,
    profileIds: [],
    executionProfileIds: ['future-evaluation'],
    state: 'base_satisfied',
    reason: 'base_runtime_ready',
  };
  const pipeline = {
    pipelineClass: 'FuturePipeline',
    coverage: 'research-blocked',
    reason: 'Evaluation authoring only',
    equivalentTo: [],
    upstreamTasks: [{ task: 'text_to_image', source: 'modular', workflowId: 'text2image' }],
    tasks: [
      {
        task: 'text_to_image',
        execution: 'declared',
        decomposition: 'stages',
        operationIds: operations.map((op) => op.operationId),
        executionProfileIds: ['future-evaluation'],
        dependencies: 'ready',
        runtimeRequirements: [requirement],
      },
    ],
  };
  const publicSupport = [
    {
      ...pipeline,
      tasks: pipeline.tasks.map((task) => ({
        ...task,
        executionProfileIds: [],
        dependencies: 'unknown',
        runtimeRequirements: [],
      })),
    },
  ];
  const payload = {
    schemaVersion: 2,
    capabilities: [
      {
        modelType: 'FuturePipeline',
        label: 'Future image',
        executionProfiles: [],
        defaultRepo: 'owner/future',
        autoEligible: false,
        templateEligible: false,
        galleryEligible: false,
        liveProof: false,
      },
    ],
    evaluationAuthoring: {
      schemaVersion: 1,
      scope: 'expert-authoring',
      autoEligible: false,
      templateEligible: false,
      galleryEligible: false,
      executionProfiles: [
        {
          id: 'future-evaluation',
          model_type: 'FuturePipeline',
          pipeline_class: 'FuturePipeline',
          default_repo: 'owner/future',
          public: false,
          live_proof: false,
          modes: ['text_to_image'],
        },
      ],
      pipelineSupport: [pipeline],
    },
  };
  const before = structuredClone(payload);
  const parsed = evaluation.parseEvaluationAuthoring(payload, publicSupport, operations);
  assert.deepEqual(payload, before);
  assert.equal(parsed.descriptors.length, 1);
  assert.equal(parsed.descriptors[0].evaluationOnly, true);
  assert.equal(parsed.descriptors[0].profileId, 'future-evaluation');
  assert.deepEqual(choices.parseWorkflowModelDescriptors(payload, publicSupport), []);
  const rows = choices.workflowChoices(parsed.support, [], [], [], null, parsed.descriptors);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].evaluationOnly, true);
  const sharedPublicPipeline = structuredClone(publicSupport);
  sharedPublicPipeline[0].tasks[0].executionProfileIds = ['public-profile'];
  assert.throws(
    () => evaluation.parseEvaluationAuthoring(payload, sharedPublicPipeline, operations),
    /evaluation authoring/i,
    'private metadata cannot replace any existing public profile on the same pipeline',
  );
  assert.deepEqual(sharedPublicPipeline[0].tasks[0].executionProfileIds, ['public-profile']);
  const nodeStore = (await server.ssrLoadModule('/src/stores/useNodeStore.ts')).useNodesStore;
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ...payload,
          operationContractSchemaVersion: 3,
          operationContracts: operations,
          pipelineSupportSchemaVersion: 1,
          pipelineSupport: publicSupport,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    await nodeStore.getState().fetchStudioModelCapabilities();
    assert.equal(nodeStore.getState().discoveryRequests.capabilities.status, 'success');
    assert.deepEqual(nodeStore.getState().workflowModelDescriptors, parsed.descriptors);
    assert.deepEqual(nodeStore.getState().pipelineSupport, parsed.support);
    assert.equal(
      nodeStore.getState().studioModelCapabilities.some((model) => model.modelType === 'FuturePipeline'),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(
    evaluation.parseEvaluationAuthoring({ ...payload, evaluationAuthoring: undefined }, publicSupport, operations),
    { support: publicSupport, descriptors: [] },
  );
  for (const alter of [
    (p) => {
      p.evaluationAuthoring.autoEligible = true;
    },
    (p) => {
      p.evaluationAuthoring.scope = 'automatic';
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles[0].public = true;
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles[0].live_proof = true;
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles[0].modes = ['edit_image'];
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles[0].default_repo = 'owner/other';
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles[0].modes.push('text_to_image');
    },
    (p) => {
      p.evaluationAuthoring.pipelineSupport[0].tasks[0].executionProfileIds = ['other'];
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles.push(p.evaluationAuthoring.executionProfiles[0]);
    },
    (p) => {
      p.evaluationAuthoring.unreviewed = true;
    },
  ]) {
    const malformed = structuredClone(payload);
    alter(malformed);
    assert.throws(() => evaluation.parseEvaluationAuthoring(malformed, publicSupport, operations));
  }
});

function evaluationImagePayload() {
  return structuredClone({
    schemaVersion: 2,
    capabilities: evaluationImageFixture.capabilities,
    evaluationAuthoring: evaluationImageFixture.evaluationAuthoring,
  });
}

async function evaluationImageAuthority(payload = evaluationImagePayload()) {
  const { parseEvaluationAuthoring } = await server.ssrLoadModule('/src/workflow/evaluationAuthoring.ts');
  const parsed = parseEvaluationAuthoring(payload, [], evaluationImageFixture.operationContracts);
  return {
    nodesRegistry: {},
    studioModelCapabilities: [],
    studioModelCapabilitiesAuthoritative: true,
    studioExecutionSpecInvalid: false,
    operationContracts: evaluationImageFixture.operationContracts,
    pipelineSupport: parsed.support,
    workflowModelDescriptors: parsed.descriptors,
    resourceMode: 'expert',
    runtimeStatus: { ready: true, runtimeEnvironment: { profileVerified: true, executionReady: true } },
    discoveryRequests: {
      nodes: { status: 'success' },
      capabilities: { status: 'success' },
      runtime: { status: 'success' },
    },
  };
}

test('evaluation model discovery keeps declared choices searchable across spaces and dots without public promotion', async () => {
  const payload = evaluationImagePayload();
  const before = structuredClone(payload);
  const authority = await evaluationImageAuthority(payload);
  assert.deepEqual(payload, before, 'Parsing must not mutate the backend DTO.');
  const rows = choices.workflowChoices(authority.pipelineSupport, [], [], [], null, authority.workflowModelDescriptors);
  assert.equal(rows.length, 4);
  for (const query of ['FLUX3', 'flux 3', 'FLUX.3', 'black forest labs'])
    assert.equal(rows.filter((row) => choices.workflowModelMatchesQuery(row, query)).length, 4, query);
  assert.equal(rows.filter((row) => choices.workflowModelMatchesQuery(row, 'base')).length, 2);
  assert.equal(rows.filter((row) => choices.workflowModelMatchesQuery(row, 'unrelated')).length, 0);
  for (const row of rows) {
    assert.equal(row.evaluationOnly, true);
    assert.equal(
      row.authoringRecipeId,
      evaluationImageFixture.evaluationAuthoring.authoringRecipes.find(
        (recipe) => recipe.executionProfileId === row.profileId && recipe.task === row.task,
      ).authoringRecipeId,
    );
  }
  const { parseStudioModelCapabilities } = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  assert.deepEqual(
    parseStudioModelCapabilities(payload).capabilities,
    [],
    'Private execution profiles stay outside runnable Studio capabilities.',
  );
  assert.equal(
    choices.workflowModelMatchesQuery({ label: 'Future Vision.7', repo: 'another/future-vision-7' }, 'future vision7'),
    true,
  );
});

test('typed template identities preserve contract-only workflow discovery and reject inconsistent admissions', async () => {
  const { parseStudioModelCapabilities } = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  const profiles = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  const { STUDIO_TEMPLATES, PLANNING_STUDIO_TEMPLATES } = await server.ssrLoadModule('/src/studio/templates.ts');
  const payload = evaluationImagePayload();
  const before = structuredClone(payload);
  const original = await evaluationImageAuthority(payload);
  const baseline = choices.workflowChoices(
    original.pipelineSupport,
    [],
    [],
    [],
    null,
    original.workflowModelDescriptors,
  );
  const full = structuredClone(payload);
  for (const capability of full.capabilities)
    Object.assign(capability, {
      executionStatus: 'contract_only',
      modes: ['text_to_image', 'edit_image'],
      runnableModes: [],
      qualifiedModes: [],
    });
  for (const value of [payload, full]) {
    const parsed = parseStudioModelCapabilities(value);
    assert.deepEqual(parsed.capabilities, []);
    const authority = await evaluationImageAuthority(value);
    assert.deepEqual(
      choices.workflowChoices(
        authority.pipelineSupport,
        parsed.capabilities,
        [],
        [],
        null,
        authority.workflowModelDescriptors,
      ),
      baseline,
      'Task, profile, private recipe, cache and Custom-memory identity stay on the ordinary starter path.',
    );
  }
  assert.deepEqual(payload, before, 'The actual retained metadata is not rewritten.');
  assert.equal(baseline.length, 4);
  assert.ok(
    baseline.every(
      (row) => row.evaluationOnly && row.authoringRecipeId && ['text_to_image', 'edit_image'].includes(row.task),
    ),
  );
  for (const capability of payload.capabilities) {
    const profile = profiles.STUDIO_MODEL_PROFILES[capability.modelType];
    assert.equal(profile.catalogVisibility, 'internal');
    assert.equal(profile.defaultRepo, capability.defaultRepo);
    assert.deepEqual(profile.modes, ['text_to_image', 'edit_image']);
    assert.ok(
      [profile.autoEligible, profile.templateEligible, profile.galleryEligible, profile.liveProof].every(
        (flag) => flag === false,
      ),
    );
    assert.equal(
      profiles.isStudioModelVisibleInCatalog(capability.modelType, {
        includeWorkflowOnly: true,
        currentModelType: capability.modelType,
      }),
      false,
    );
    assert.equal(
      STUDIO_TEMPLATES.some((template) => template.modelType === capability.modelType),
      false,
      'Private fixture model types gain no visible Studio cards.',
    );
  }
  const privateProfileIds = new Set(payload.evaluationAuthoring.executionProfiles.map((profile) => profile.id));
  const privateRecipeIds = new Set(
    payload.evaluationAuthoring.authoringRecipes.map((recipe) => recipe.authoringRecipeId),
  );
  assert.equal(
    PLANNING_STUDIO_TEMPLATES.some(
      (template) =>
        privateProfileIds.has(template.executionSelection?.executionProfileId) ||
        privateRecipeIds.has(template.executionSelection?.authoringRecipeId),
    ),
    false,
    'Planning cards cannot promote this fixture private execution-profile or recipe authority.',
  );
  for (const alter of [
    (p) => {
      p.capabilities[0].autoEligible = true;
    },
    (p) => {
      p.capabilities[0].templateEligible = true;
    },
    (p) => {
      p.capabilities[0].galleryEligible = true;
    },
    (p) => {
      p.capabilities[0].liveProof = true;
    },
    (p) => {
      delete p.capabilities[0].liveProof;
    },
    (p) => {
      p.capabilities[0].executionProfiles = [{ id: 'unreviewed' }];
    },
    (p) => {
      p.capabilities[0].runnableModes = ['text_to_image'];
    },
    (p) => {
      p.capabilities[0].qualifiedModes = ['text_to_image'];
    },
    (p) => {
      p.schemaVersion = 1;
    },
  ]) {
    const invalid = structuredClone(full);
    alter(invalid);
    assert.throws(() => parseStudioModelCapabilities(invalid), /model.capabilities/i);
  }
  const publicProfile = structuredClone(profiles.STUDIO_MODEL_PROFILES.StableDiffusionPipeline);
  assert.equal(
    parseStudioModelCapabilities({ schemaVersion: 2, capabilities: [publicProfile] }).capabilities[0].modelType,
    'StableDiffusionPipeline',
  );
});

test('evaluation authoring validates selected policy and recipe bindings and rejects malformed extensions', async () => {
  const authority = await evaluationImageAuthority();
  assert.deepEqual(
    authority.workflowModelDescriptors.map((row) => row.adapterAuthoringProfile.adapterAuthoring),
    evaluationImageFixture.evaluationAuthoring.executionProfiles.map((row) => row.adapterAuthoring),
  );
  for (const alter of [
    (p) => {
      p.evaluationAuthoring.authoringRecipes.push(p.evaluationAuthoring.authoringRecipes[0]);
    },
    (p) => {
      p.evaluationAuthoring.authoringRecipes[0].executionProfileId = 'unpublished';
    },
    (p) => {
      p.evaluationAuthoring.authoringRecipes[0].pipelineClass = 'AnotherPipeline';
    },
    (p) => {
      p.evaluationAuthoring.authoringRecipes[0].task = 'unconditional_image';
    },
    (p) => {
      p.evaluationAuthoring.authoringRecipes[0].extraAuthority = true;
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles[0].adapterAuthoring =
        p.evaluationAuthoring.executionProfiles[1].adapterAuthoring;
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles[0].adapterAuthoring.maxOwnedAdapters = 33;
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles[0].adapterAuthoring.requiredControls.quant_config = {};
    },
    (p) => {
      p.evaluationAuthoring.executionProfiles[0].optionalRuntimeRequirement.executionProfileIds = ['other'];
    },
  ]) {
    const payload = evaluationImagePayload();
    alter(payload);
    await assert.rejects(() => evaluationImageAuthority(payload));
  }
  const old = evaluationImagePayload();
  delete old.evaluationAuthoring.authoringRecipes;
  for (const profile of old.evaluationAuthoring.executionProfiles) delete profile.adapterAuthoring;
  const parsed = await evaluationImageAuthority(old);
  assert.ok(parsed.workflowModelDescriptors.every((row) => !row.adapterAuthoringProfile && !row.authoringRecipes));
});

test('evaluation authoring retains an optional exact raw recipe per selected task without public promotion', async () => {
  const payload = evaluationImagePayload();
  for (const row of payload.evaluationAuthoring.authoringRecipes)
    row.rawAuthoringRecipeId = `${row.authoringRecipeId}:raw`;
  const before = structuredClone(payload);
  const parsed = await evaluationImageAuthority(payload);
  for (const row of payload.evaluationAuthoring.authoringRecipes) {
    const descriptor = parsed.workflowModelDescriptors.find(
      (descriptor) => descriptor.profileId === row.executionProfileId,
    );
    assert.equal(descriptor.rawPromptAuthoringRecipes[row.task], row.rawAuthoringRecipeId);
    assert.equal(descriptor.authoringRecipes[row.task], row.authoringRecipeId);
    assert.equal(descriptor.evaluationOnly, true);
  }
  assert.deepEqual(payload, before);
  for (const value of [
    null,
    '',
    17,
    'x'.repeat(257),
    payload.evaluationAuthoring.authoringRecipes[0].authoringRecipeId,
  ]) {
    const malformed = structuredClone(payload);
    malformed.evaluationAuthoring.authoringRecipes[0].rawAuthoringRecipeId = value;
    await assert.rejects(() => evaluationImageAuthority(malformed));
  }
  const malformed = structuredClone(payload);
  Object.defineProperty(malformed.evaluationAuthoring.authoringRecipes[0], 'rawAuthoringRecipeId', {
    enumerable: true,
    get: () => {
      throw new Error('getter executed');
    },
  });
  await assert.rejects(() => evaluationImageAuthority(malformed), /Invalid/);
});

test('declared raw enhancement choices retain labels and exact defaults while rejecting malformed alternatives', async () => {
  const payload = evaluationImagePayload();
  const row = payload.evaluationAuthoring.authoringRecipes[0];
  row.rawAuthoringRecipeId = `${row.authoringRecipeId}:raw`;
  row.rawAuthoringRecipeChoices = [
    { authoringRecipeId: row.rawAuthoringRecipeId, label: 'Raw wording: FP32' },
    { authoringRecipeId: `${row.authoringRecipeId}:nf4`, label: 'Raw wording: BF16 + NF4' },
  ];
  const before = structuredClone(payload);
  const parsed = await evaluationImageAuthority(payload);
  assert.deepEqual(
    parsed.workflowModelDescriptors.find((descriptor) => descriptor.profileId === row.executionProfileId)
      .rawPromptAuthoringChoices[row.task],
    row.rawAuthoringRecipeChoices,
  );
  assert.deepEqual(payload, before);
  for (const alter of [
    (r) => {
      delete r.rawAuthoringRecipeId;
    },
    (r) => {
      r.rawAuthoringRecipeChoices = [];
    },
    (r) => {
      r.rawAuthoringRecipeChoices = null;
    },
    (r) => {
      r.rawAuthoringRecipeChoices.push(...r.rawAuthoringRecipeChoices, r.rawAuthoringRecipeChoices[0]);
    },
    (r) => {
      r.rawAuthoringRecipeChoices[1] = r.rawAuthoringRecipeChoices[0];
    },
    (r) => {
      r.rawAuthoringRecipeChoices.shift();
    },
    (r) => {
      r.rawAuthoringRecipeChoices[1].authoringRecipeId = r.authoringRecipeId;
    },
    (r) => {
      r.rawAuthoringRecipeChoices[1].extra = true;
    },
    (r) => {
      r.rawAuthoringRecipeChoices[1].label = '';
    },
    (r) => {
      r.rawAuthoringRecipeChoices[1].label = ' Raw wording';
    },
    (r) => {
      r.rawAuthoringRecipeChoices[1].label = 'x'.repeat(129);
    },
    (r) => {
      delete r.rawAuthoringRecipeChoices[1];
    },
    (r) => {
      Object.defineProperty(r.rawAuthoringRecipeChoices[1], 'label', {
        enumerable: true,
        get: () => {
          throw new Error('getter executed');
        },
      });
    },
    (r) => {
      Object.defineProperty(r, 'rawAuthoringRecipeChoices', {
        enumerable: true,
        get: () => {
          throw new Error('getter executed');
        },
      });
    },
  ]) {
    const malformed = structuredClone(payload);
    alter(malformed.evaluationAuthoring.authoringRecipes[0]);
    await assert.rejects(() => evaluationImageAuthority(malformed), /Invalid/);
  }
});

test('evaluation selected native policy permits ordinary Add and Remove without rewriting the model or unrelated nodes', async () => {
  const adapters = await server.ssrLoadModule('/src/workflow/modelSetupAdapters.ts');
  const groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const authority = await evaluationImageAuthority();
  const raw = structuredClone(evaluationImageFixture.starter);
  delete raw.authoring;
  const selected = evaluationImageFixture.evaluationAuthoring.executionProfiles.find(
    (profile) => profile.pipeline_class === raw.pipelineClass,
  );
  const parsed = requests.parseOperationStarter(raw, raw.pipelineClass, raw.task, authority.operationContracts, {
    executionProfileId: selected.id,
    repository: selected.default_repo,
  });
  const owner = parsed.nodes.find((node) => node.operation.decomposition === 'loader').node;
  authority.nodesRegistry = Object.fromEntries(
    parsed.nodes.map((node) => [node.operation.nodeKey, structuredClone(node.node)]),
  );
  for (const [name, value] of Object.entries(selected.adapterAuthoring.requiredControls))
    owner.params[name].value = structuredClone(value);
  authority.nodesRegistry['modules.ModularDiffusers.Lora'] = {
    type: 'custom',
    module: 'modules.ModularDiffusers',
    action: 'Lora',
    category: 'loader',
    label: 'LoRA',
    params: {
      model: { type: 'string', value: { source: 'local', value: '' } },
      revision: { type: 'string', value: '' },
      expected_sha256: { type: 'string', value: '' },
      weight_name: { type: 'string', value: '' },
      adapter_name: { type: 'string', value: '' },
      scale: { type: 'float', value: 1 },
      previous_loras: { type: 'custom_lora', display: 'input' },
      lora: { type: 'custom_lora', display: 'output' },
    },
  };
  const graph = groups.groupNewOperationGraph(authoring.createOperationStarter(parsed, { x: 0, y: 0 }));
  const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'setup');
  const chain = adapters.modelSetupAdapterChain(graph, root.id);
  const before = structuredClone(graph);
  assert.equal(adapters.modelSetupAdapterAddUnavailable(chain, authority), null);
  const next = adapters.planModelSetupAdapterEdit(
    graph,
    root.id,
    {
      kind: 'add',
      registry: authority.nodesRegistry,
      values: { model: { source: 'local', value: 'metadata-only.safetensors' }, scale: '0.4' },
    },
    authority,
  );
  const added = adapters.modelSetupAdapterChain(next, root.id);
  assert.equal(added.adapters.length, 1);
  assert.deepEqual(added.owner.data.params, chain.owner.data.params);
  assert.equal(added.adapters[0].data.params.scale.value, '0.4');
  const restored = adapters.planModelSetupAdapterEdit(next, root.id, { kind: 'remove', nodeId: added.adapters[0].id });
  assert.deepEqual(adapters.modelSetupAdapterChain(restored, root.id).owner.data.params, chain.owner.data.params);
  assert.equal(adapters.modelSetupAdapterChain(restored, root.id).adapters.length, 0);
  assert.deepEqual(graph, before);
  for (const alter of [
    (a) => {
      a.resourceMode = 'auto';
    },
    (a) => {
      a.discoveryRequests.runtime.status = 'error';
    },
    (a) => {
      a.runtimeStatus.runtimeEnvironment.profileVerified = false;
    },
    (a) => {
      a.runtimeStatus.runtimeEnvironment.executionReady = false;
    },
    (a) => {
      a.discoveryRequests.capabilities.status = 'loading';
    },
    (a) => {
      a.workflowModelDescriptors = [];
    },
    (a) => {
      a.workflowModelDescriptors.push(structuredClone(a.workflowModelDescriptors[1]));
    },
    (a) => {
      a.workflowModelDescriptors[1].adapterAuthoringProfile.repository_revisions[0].revision = 'f'.repeat(40);
    },
    (a) => {
      a.workflowModelDescriptors[1].modelType = 'AnotherModel';
    },
    (a) => {
      delete a.workflowModelDescriptors[1].adapterAuthoringProfile;
    },
    (a) => {
      a.pipelineSupport
        .find((p) => p.pipelineClass === raw.pipelineClass)
        .tasks.find((t) => t.task === raw.task).dependencies = 'missing';
    },
  ]) {
    const invalid = structuredClone(authority);
    alter(invalid);
    assert.ok(adapters.modelSetupAdapterAddUnavailable(chain, invalid));
    assert.throws(() =>
      adapters.planModelSetupAdapterEdit(
        graph,
        root.id,
        {
          kind: 'add',
          registry: invalid.nodesRegistry,
          values: { model: { source: 'local', value: 'metadata-only.safetensors' } },
        },
        invalid,
      ),
    );
    assert.deepEqual(graph, before);
  }
});

test('fresh declared evaluation drafts attach the current optional enhancement offer after ordinary output completion', async () => {
  const authority = await evaluationImageAuthority();
  const raw = structuredClone(evaluationImageFixture.starter);
  const profile = evaluationImageFixture.evaluationAuthoring.executionProfiles.find(
    (p) => p.pipeline_class === raw.pipelineClass,
  );
  const selected = requests.parseOperationStarter(raw, raw.pipelineClass, raw.task, authority.operationContracts, {
    executionProfileId: profile.id,
    repository: profile.default_repo,
    authoringRecipeId: raw.authoring.id,
  });
  const registry = Object.fromEntries(selected.nodes.map((node) => [node.operation.nodeKey, node.node]));
  registry['modules.Image.Preview'] = {
    type: 'custom',
    module: 'modules.Image',
    action: 'Preview',
    category: 'image',
    label: 'Preview',
    params: { image: { type: 'image', display: 'input' } },
  };
  const before = structuredClone(selected);
  const draft = drafts.createWorkflowDraft(selected, registry);
  const { unpackVisualOperationGroups } = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const { promptEnhancementParentFromHint } = await server.ssrLoadModule('/src/studio/promptEnhancementAuthoring.ts');
  const unpacked = unpackVisualOperationGroups(draft.graph).graph;
  const offered = unpacked.nodes.filter((node) => promptEnhancementParentFromHint(node.data.operationAuthoring));
  assert.equal(offered.length, 1);
  const offer = promptEnhancementParentFromHint(offered[0].data.operationAuthoring);
  assert.equal(offer.parent.authoringRecipeId, raw.authoring.id);
  assert.equal(offer.parent.authoringContentHash, raw.authoring.contentHash);
  assert.equal(offer.parent.executionProfileId, profile.id);
  assert.ok(unpacked.nodes.some((node) => node.data.module === 'modules.Image' && node.data.action === 'Preview'));
  assert.equal(
    unpacked.nodes.some((node) => node.data.action === 'GenerateImageVideoText'),
    false,
    'An offer does not Enable a provider branch.',
  );
  assert.deepEqual(selected, before);
});

test('a previously unknown evaluation image model uses the same declared policy parser without a model-name branch', async () => {
  const source = evaluationImagePayload();
  const names = new Map([
    ['Flux3ModularPipeline', 'FutureImageModularPipeline'],
    ['Flux3DistilledModularPipeline', 'FutureCompactImageModularPipeline'],
  ]);
  const remap = (value) =>
    typeof value === 'string'
      ? (names.get(value) ?? value)
      : Array.isArray(value)
        ? value.map(remap)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]))
          : value;
  const evaluation = await server.ssrLoadModule('/src/workflow/evaluationAuthoring.ts');
  const parsed = evaluation.parseEvaluationAuthoring(
    remap(source),
    [],
    remap(evaluationImageFixture.operationContracts),
  );
  assert.equal(parsed.descriptors.length, 2);
  assert.ok(parsed.descriptors.every((row) => row.pipeline.startsWith('Future') && row.adapterAuthoringProfile));
  assert.deepEqual(
    parsed.descriptors.map((row) => row.adapterAuthoringProfile.adapterAuthoring),
    evaluationImageFixture.evaluationAuthoring.executionProfiles.map((row) => row.adapterAuthoring),
  );
});

test('evaluation authoring mock payload declares every operation task before the private namespace is decoded', async () => {
  const contracts = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  const catalog = await server.ssrLoadModule('/src/workflow/operationCatalog.ts');
  const evaluation = await server.ssrLoadModule('/src/workflow/evaluationAuthoring.ts');
  const publicStarter = starter();
  const payload = {
    ...structuredClone(evaluationImageFixture),
    operationContractSchemaVersion: 3,
    operationContracts: [
      ...publicStarter.nodes.map((row) => row.operation),
      ...evaluationImageFixture.operationContracts,
    ],
    pipelineSupportSchemaVersion: 1,
    pipelineSupport: [
      {
        pipelineClass: publicStarter.pipelineClass,
        coverage: 'local-adapter',
        reason: 'Native authoring fixture; execution unqualified',
        equivalentTo: [],
        upstreamTasks: [],
        tasks: [
          {
            task: publicStarter.task,
            execution: 'declared',
            decomposition: 'stages',
            operationIds: publicStarter.nodes.map((row) => row.operation.operationId),
            executionProfileIds: [],
            dependencies: 'unknown',
            runtimeRequirements: [],
          },
        ],
      },
      ...(evaluationImageFixture.pipelineSupport ?? []),
    ],
  };
  const operations = contracts.parseOperationContracts(
    payload.operationContracts,
    payload.operationContractSchemaVersion,
  );
  const support = catalog.parsePipelineSupport(
    payload.pipelineSupport,
    payload.pipelineSupportSchemaVersion,
    operations,
  );
  const privateRows = support.filter((row) => row.coverage === 'research-blocked');
  assert.equal(privateRows.length, 2);
  assert.equal(privateRows.flatMap((row) => row.tasks).length, 4);
  assert.ok(
    privateRows
      .flatMap((row) => row.tasks)
      .every((task) => task.dependencies === 'unknown' && task.executionProfileIds.length === 0),
  );
  assert.throws(
    () =>
      catalog.parsePipelineSupport(
        payload.pipelineSupport.filter((row) => row.coverage !== 'research-blocked'),
        1,
        operations,
      ),
    /Invalid backend operation contract/u,
  );
  const decoded = evaluation.parseEvaluationAuthoring(payload, support, operations);
  assert.equal(decoded.descriptors.length, 2);
  assert.equal(
    decoded.support
      .filter((row) => privateRows.some((privateRow) => privateRow.pipelineClass === row.pipelineClass))
      .flatMap((row) => row.tasks).length,
    4,
  );
});

test('imported runtime option presentation follows current registry availability in both directions without changing the document', async () => {
  const options = await server.ssrLoadModule('/src/studio/runtimeOptions.ts');
  const descriptor = (value, available) => ({
    schemaVersion: 1,
    value,
    label: value,
    compatibility: available ? 'compatible' : 'incompatible',
    availability: available ? 'installed' : 'unavailable',
    installationState: available ? 'installed' : 'unavailable',
    ...(available ? {} : { disabledReason: 'Other platform' }),
  });
  for (const [savedReady, currentReady] of [
    [false, true],
    [true, false],
  ]) {
    const saved = [descriptor('none', true), descriptor('reviewed-format', savedReady)];
    const current = [
      descriptor('none', true),
      descriptor('reviewed-format', currentReady),
      descriptor('new-format', true),
    ];
    const document = { value: 'none', options: saved, min: 0, hidden: false, source: 'saved', onChange: undefined };
    const original = structuredClone(document);
    const presented = options.runtimeOptionEntries(document.options, current);
    assert.equal(presented.find((row) => row.value === 'reviewed-format').disabled, !currentReady);
    assert.deepEqual(
      presented.map((row) => row.value),
      ['none', 'reviewed-format'],
      'Current metadata cannot expand authored membership.',
    );
    assert.deepEqual(document, original);
    const importedOnly = options.runtimeOptionEntries([descriptor('snapshot-only', true)], current);
    assert.equal(importedOnly[0].disabled, true, 'An import cannot enable an option absent from the current registry.');
  }
});

test('runtime option presentation preserves dynamic authority, dictionary membership and ambiguous-option refusal', async () => {
  const options = await server.ssrLoadModule('/src/studio/runtimeOptions.ts');
  const ready = (value) => ({
    schemaVersion: 1,
    value,
    label: value,
    compatibility: 'compatible',
    availability: 'installed',
    installationState: 'installed',
  });
  const saved = {
    __formats: 'Formats',
    reviewed: {
      ...ready('reviewed'),
      label: 'Saved label',
      group: 'Saved group',
      compatibility: 'incompatible',
      availability: 'unavailable',
    },
    imported: ready('imported'),
  };
  const before = structuredClone(saved);
  const live = { quantization: { options: [ready('reviewed')] } };
  const presented = options.registeredRuntimeOptionPresentation(saved, 'quantization', live);
  assert.deepEqual(Object.keys(presented), Object.keys(saved));
  assert.equal(presented.__formats, 'Formats');
  assert.equal(presented.reviewed.label, 'Saved label');
  assert.equal(presented.reviewed.group, 'Saved group');
  assert.equal(options.runtimeOptionEntries(presented).find((row) => row.value === 'reviewed').disabled, false);
  assert.equal(options.runtimeOptionEntries(presented).find((row) => row.value === 'imported').disabled, true);
  assert.equal(
    options.runtimeOptionEntries([ready('reviewed')], [ready('reviewed'), ready('reviewed')])[0].disabled,
    true,
  );
  assert.deepEqual(saved, before);
  for (const changes of [
    { quantization: { options: live.quantization.options, optionsSource: {} } },
    { other: { onChange: 'refresh_options' } },
    { other: { onSignal: [{ action: 'exec', data: 'refresh_options' }] } },
    { other: { onChange: { action: 'create', data: {} } } },
    { other: { onChange: { action: 'value', target: 'quantization', prop: 'options', data: {} } } },
  ]) {
    assert.equal(options.registeredRuntimeOptionPresentation(saved, 'quantization', { ...live, ...changes }), saved);
  }
  assert.equal(options.registeredRuntimeOptionPresentation(saved, 'quantization', undefined), saved);
  assert.deepEqual(options.runtimeOptionEntries(['legacy'], ['new']), options.runtimeOptionEntries(['legacy']));
});

test('generic model default weight format requires its exact declared immutable selection', async () => {
  const inventory = await server.ssrLoadModule('/src/workflow/workflowModelInventory.ts');
  const model = {
    defaultRepo: 'reviewed/future-image',
    defaultWeightFormat: 'fp8r',
    revisionCandidates: ['a'.repeat(40)],
    weightFormatSelections: [
      {
        weightFormat: 'fp8r',
        repo: 'reviewed/future-image',
        revision: 'a'.repeat(40),
        downloadFiles: ['model_index.json', 'variants/fp8r/model.safetensors'],
      },
    ],
  };
  const before = structuredClone(model);
  assert.equal(inventory.parseWorkflowModelInventory(model, model.defaultRepo).defaultWeightFormat, 'fp8r');
  assert.deepEqual(model, before);
  for (const invalid of [
    { ...model, defaultWeightFormat: null },
    { ...model, defaultWeightFormat: 'unsupported' },
    { ...model, defaultWeightFormat: 'nvfp4' },
    { ...model, defaultWeightFormat: 0 },
    { ...model, defaultWeightFormat: {} },
    { ...model, weightFormatSelections: undefined },
    { ...model, weightFormatSelections: [...model.weightFormatSelections, ...model.weightFormatSelections] },
    { ...model, revisionCandidates: undefined },
    { ...model, revisionCandidates: [] },
    { ...model, revisionCandidates: ['b'.repeat(40)] },
    { ...model, revisionCandidates: ['a'.repeat(40), 'b'.repeat(40)] },
    { ...model, weightFormatSelections: [{ ...model.weightFormatSelections[0], repo: 'other/model' }] },
    { ...model, weightFormatSelections: [{ ...model.weightFormatSelections[0], downloadFiles: [] }] },
  ])
    assert.throws(() => inventory.parseWorkflowModelInventory(invalid, model.defaultRepo), /Invalid workflow model/);
  const foreign = inventory.parseWorkflowModelInventory(model, 'another/model');
  assert.equal(foreign.defaultWeightFormat, undefined, 'a sibling repository cannot inherit a default selection');
  const historical = { ...model, defaultWeightFormat: undefined };
  assert.equal(inventory.parseWorkflowModelInventory(historical, model.defaultRepo).defaultWeightFormat, undefined);
  assert.equal(
    inventory.parseWorkflowModelInventory({ ...historical, defaultWeightFormat: 'native' }, model.defaultRepo)
      .defaultWeightFormat,
    'native',
  );
});

test('workflow inventory character guards preserve exact control and filename boundaries', async () => {
  const inventory = await server.ssrLoadModule('/src/workflow/workflowModelInventory.ts');
  const repo = 'reviewed/future-image';
  const selection = {
    weightFormat: 'fp8r',
    repo,
    revision: 'a'.repeat(40),
    downloadFiles: ['weights/model.safetensors'],
  };
  const model = {
    defaultRepo: repo,
    defaultWeightFormat: 'fp8r',
    revisionCandidates: [selection.revision],
    weightFormatSelections: [selection],
  };
  for (const character of ['\u0000', '\u001f', '\u007f', '\u009f']) {
    assert.throws(
      () => inventory.parseWorkflowModelInventory({ ...model, qualificationStatus: `declared${character}` }, repo),
      /Invalid workflow model/,
    );
  }
  for (const character of ['\u0000', '\u001f', '\u007f', '\u009f', ...'\\:*?[]{}']) {
    assert.throws(
      () =>
        inventory.parseWorkflowModelInventory(
          {
            ...model,
            weightFormatSelections: [{ ...selection, downloadFiles: [`weights/model${character}.safetensors`] }],
          },
          repo,
        ),
      /Invalid workflow model/,
    );
  }
  const allowed = ' !~\u00a0𝄞';
  const parsed = inventory.parseWorkflowModelInventory(
    {
      ...model,
      qualificationStatus: allowed,
      weightFormatSelections: [{ ...selection, downloadFiles: [`weights/model${allowed}.safetensors`] }],
    },
    repo,
  );
  assert.equal(parsed.qualificationStatus, allowed);
  assert.equal(parsed.defaultWeightFormat, 'fp8r');
  assert.equal(parsed.weightFormatSelections[0].downloadFiles[0], `weights/model${allowed}.safetensors`);
});

test('generic public model inventory preserves native defaults and exact additional format Install/Repair selections', async () => {
  const inventory = await server.ssrLoadModule('/src/workflow/workflowModelInventory.ts');
  const actual = JSON.parse(
    fs.readFileSync(new URL('../tests/fixtures/weight-format-selections.v1.json', import.meta.url), 'utf8'),
  );
  for (const row of actual.rows) {
    // A future public declaration exercises generic discovery. The file rows
    // are the actual backend selector output, not a public/runtime grant for
    // the private identities from which that pure fixture was captured.
    const model = {
      modelType: 'FutureNativePipeline',
      label: 'Future image',
      defaultRepo: row.repo,
      executionStatus: 'expert_only',
      qualificationStatus: 'graph-contract-only',
      autoEligible: false,
      templateEligible: false,
      revisionCandidates: [row.revision],
      downloadFiles: ['model_index.json', 'transformer/model.safetensors'],
      weightFormatSelections: row.weightFormatSelections,
      executionProfiles: [
        {
          id: 'future-native',
          model_type: 'FutureNativePipeline',
          pipeline_class: 'FutureNativePipeline',
          default_repo: row.repo,
          public: true,
        },
      ],
    };
    const support = [
      {
        pipelineClass: model.modelType,
        tasks: [
          {
            task: 'text_to_image',
            operationIds: ['load', 'encode', 'denoise', 'decode'],
            executionProfileIds: ['future-native'],
          },
        ],
      },
    ];
    const payload = { schemaVersion: 2, capabilities: [model] };
    const [descriptor] = choices.parseWorkflowModelDescriptors(payload, support);
    assert.ok(descriptor);
    const rows = inventory.workflowModelArtifactRows(descriptor);
    assert.deepEqual(
      rows.map((item) => item.weightFormat),
      ['native', 'fp8r', 'nvfp4'],
    );
    assert.equal(new Set(rows.map((item) => item.id)).size, 3);
    assert.deepEqual(rows[0].selection.downloadFiles, model.downloadFiles);
    for (const [index, format] of rows.entries()) {
      const state = inventory.workflowModelArtifactStatus(format, descriptor, [], [], null);
      assert.equal(state.installTarget.actionLabel, 'Install');
      assert.equal(state.installTarget.repo, index ? row.weightFormatSelections[index - 1].repo : row.repo);
      assert.equal(state.installTarget.revision, row.revision);
      assert.deepEqual(state.installTarget.files, format.selection.downloadFiles);
      assert.notEqual(state.installTarget.files, format.selection.downloadFiles);
      assert.match(state.reason, /readiness.*separately/);
      assert.equal(descriptor.autoEligible, undefined);
      assert.equal(descriptor.templateEligible, undefined);
    }
    const [native, fp8] = rows;
    const nativeCache = [
      {
        id: row.repo,
        complete: true,
        installed: true,
        planned_revision: row.revision,
        planned_files: native.selection.downloadFiles,
      },
    ];
    const repair = inventory.workflowModelArtifactStatus(fp8, descriptor, nativeCache, [], null);
    assert.equal(repair.installTarget.actionLabel, 'Repair');
    assert.deepEqual(repair.installTarget.files, row.weightFormatSelections[0].downloadFiles);
    const installed = inventory.workflowModelArtifactStatus(
      fp8,
      descriptor,
      [{ ...nativeCache[0], planned_files: fp8.selection.downloadFiles }],
      [],
      null,
    );
    assert.equal(installed.status.runnable, true);
    assert.equal(installed.installTarget, null);
    assert.match(installed.reason, /Execution readiness still depends/);
    const privatePayload = structuredClone(payload);
    privatePayload.capabilities[0].executionProfiles[0].public = false;
    privatePayload.capabilities[0].weightFormatSelections = [{ malicious: true }];
    assert.deepEqual(choices.parseWorkflowModelDescriptors(privatePayload, support), []);
    assert.deepEqual(choices.parseWorkflowModelDescriptors(payload, []), []);
    const foreignRepository = structuredClone(payload);
    foreignRepository.capabilities[0].executionProfiles[0].default_repo = 'another/model';
    const [foreignDescriptor] = choices.parseWorkflowModelDescriptors(foreignRepository, support);
    assert.equal(foreignDescriptor.inventory.nativeSelection, undefined);
    assert.equal(foreignDescriptor.inventory.weightFormatSelections, undefined);
    assert.deepEqual(
      inventory.workflowModelArtifactRows(foreignDescriptor).map((item) => item.weightFormat),
      ['native'],
    );
    assert.equal(
      inventory.workflowModelArtifactStatus(
        inventory.workflowModelArtifactRows(foreignDescriptor)[0],
        foreignDescriptor,
        [],
        [],
        null,
      ).installTarget,
      null,
    );
    assert.deepEqual(
      choices.parseWorkflowModelDescriptors(
        { ...payload, capabilities: [{ ...model, executionProfiles: [] }] },
        support,
      ),
      [],
    );
    const requirement = {
      schemaVersion: 1,
      delivery: 'optional_overlay',
      requiredNow: true,
      profileIds: ['reviewed-runtime'],
      executionProfileIds: ['future-native'],
      state: 'missing',
      reason: 'runtime_missing',
    };
    const runtimeDescriptor = {
      ...descriptor,
      inventory: { ...descriptor.inventory, optionalRuntimeRequirement: requirement },
    };
    const blocked = inventory.workflowModelArtifactStatus(fp8, runtimeDescriptor, [], [], null);
    assert.equal(blocked.installTarget, null);
    assert.match(blocked.reason, /runtime is missing/);
    runtimeDescriptor.inventory.optionalRuntimeRequirement.state = 'active';
    assert.ok(inventory.workflowModelArtifactStatus(fp8, runtimeDescriptor, [], [], null).installTarget);
    const rowComponent = (await server.ssrLoadModule('/src/components/WorkflowModelInventoryRow.tsx')).default;
    const markup = renderToStaticMarkup(
      React.createElement(rowComponent, {
        descriptor,
        cache: [],
        local: [],
        diagnostics: null,
        installProgress: {},
        activeInstallCount: 0,
        hfTokenConfigured: true,
        onConfigureHfToken: () => {},
        onInstall: async () => {},
      }),
    );
    assert.match(markup, /Weight format for Future image/);
    assert.match(markup, /Native/);
    assert.match(markup, /Install/);
    assert.doesNotMatch(markup, />Ready</);
  }
});

test('format inventory parser refuses malformed identity, file patterns and unreviewed runtime values', async () => {
  const inventory = await server.ssrLoadModule('/src/workflow/workflowModelInventory.ts');
  const valid = {
    weightFormat: 'fp8r',
    repo: 'owner/model',
    revision: 'a'.repeat(40),
    downloadFiles: ['config.json', 'variants/fp8r/model.safetensors'],
  };
  assert.equal(inventory.parseWeightFormatSelections(undefined), undefined);
  assert.deepEqual(inventory.parseWeightFormatSelections([valid]), [valid]);
  for (const malformed of [
    null,
    {},
    [],
    [valid, valid],
    [valid, { ...valid, weightFormat: 'nvfp4' }, valid],
    ...['native', ['fp8r'], null, true, 'FP8R'].map((weightFormat) => [{ ...valid, weightFormat }]),
    ...['main', 'A'.repeat(40), '', null].map((revision) => [{ ...valid, revision }]),
    ...['../model', 'owner/model/extra', '/owner/model', ['owner/model']].map((repo) => [{ ...valid, repo }]),
    ...[
      [],
      ['../model'],
      ['/model'],
      ['a//b'],
      ['a/./b'],
      ['a\\b'],
      ['*.safetensors'],
      ['a?.json'],
      ['a\u0000b'],
      ['same', 'same'],
    ].map((downloadFiles) => [{ ...valid, downloadFiles }]),
    [{ ...valid, unexpected: true }],
    [{ ...valid, sourceId: 'foreign' }],
  ])
    assert.throws(() => inventory.parseWeightFormatSelections(malformed), /artifact selection/);
  for (const entry of [
    Object.defineProperty({ ...valid }, 'repo', {
      get() {
        throw new Error('must not execute');
      },
      enumerable: true,
    }),
    Object.defineProperty({ ...valid }, 'hidden', { value: true }),
    { ...valid, [Symbol('foreign')]: true },
    Object.assign(Object.create(valid), { weightFormat: 'fp8r' }),
  ])
    assert.throws(() => inventory.parseWeightFormatSelections([entry]), /artifact selection/);
  assert.equal(inventory.parseWorkflowModelInventory({}, 'owner/model'), undefined);
  assert.deepEqual(
    inventory
      .workflowModelArtifactRows({ profileId: 'old', repo: 'owner/model', label: 'Old' })
      .map((row) => row.weightFormat),
    ['native'],
  );
  assert.equal(
    inventory.workflowModelArtifactStatus(
      inventory.workflowModelArtifactRows({ profileId: 'old', repo: 'owner/model', label: 'Old' })[0],
      { repo: 'owner/model', label: 'Old' },
      [],
      [],
      null,
    ).installTarget,
    null,
  );
  for (const executionStatus of [['supported'], true, 'unqualified', null])
    assert.throws(
      () => inventory.parseWorkflowModelInventory({ executionStatus }, 'owner/model'),
      /artifact selection/,
    );
  assert.throws(
    () => inventory.parseWorkflowModelInventory({ optionalRuntimeRequirement: { state: 'active' } }, 'owner/model'),
    /runtime contract/,
  );
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
  const moved = structuredClone(graph);
  moved.nodes[1].position.x += 70;
  assert.equal(
    authoring.planPristineOperationChange(moved, moved.nodes[0].id, old, next),
    null,
    'A moved stage is not pristine',
  );
  const grouped = structuredClone(graph);
  for (const node of grouped.nodes.slice(0, 2)) node.parentId = 'user-group';
  assert.throws(
    () => authoring.planPristineOperationChange(grouped, grouped.nodes[0].id, old, next),
    /top-level operation loader/,
    'Fast replacement must not ungroup user nodes',
  );
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

test('a user-authored value equal to the old default survives model switching and is not pristine', () => {
  const source = starter();
  const graph = authoring.createOperationStarter(source, { x: 0, y: 0 });
  graph.nodes[1].data.operationAuthoring.authored = ['steps'];
  const target = starter('OtherPipeline', 'text_to_image', 40);
  const plan = authoring.planOperationChange(graph, graph.nodes[0].id, target);
  assert.equal(plan.graph.nodes.find((node) => node.data.action === 'Denoise').data.params.steps.value, 20);
  assert.ok(
    plan.graph.nodes.find((node) => node.data.action === 'Denoise').data.operationAuthoring.authored.includes('steps'),
  );
});

test('Block public values equal to defaults survive a model change', async () => {
  const { runtime, instance, draft } = await operationBlock('explicit-default', starter());
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  let configured = runtime.replaceBlockEffectiveInterfaceV2(instance, {
    boundary: instance.effectiveInterface.boundary,
    controls: [
      {
        controlId: 'steps-control',
        label: 'Steps',
        valueType: 'int',
        binding: { nodeId: draft.nodes[1].id, fieldId: 'steps' },
        defaultValue: 20,
        order: 0,
      },
    ],
  });
  configured = runtime.setBlockInstanceValueV2(configured, 'steps-control', 20);
  const result = planBlockOperationChange(
    { nodes: [runtime.createBlockRootNodeV2(configured)], edges: [] },
    configured.instanceId,
    draft.nodes[0].id,
    starter('OtherPipeline', 'text_to_image', 40),
  );
  const updated = result.graph.nodes[0].data.blockInstanceV2;
  assert.equal(updated.values['steps-control'], 20);
  assert.equal(updated.effectiveGraph.nodes.find((node) => node.data.action === 'Denoise').data.params.steps.value, 20);
});

test('default-equal native edits carry authored provenance through undo and redo', async () => {
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const original = authoring.createOperationStarter(starter(), { x: 0, y: 0 });
  useFlowStore.getState().replaceGraph(original);
  const id = original.nodes[1].id;
  useFlowStore.getState().setParamWithHistory(id, 'steps', 20);
  assert.ok(
    useFlowStore
      .getState()
      .nodes.find((node) => node.id === id)
      .data.operationAuthoring.authored.includes('steps'),
  );
  useFlowStore.getState().undo();
  assert.ok(
    !useFlowStore
      .getState()
      .nodes.find((node) => node.id === id)
      .data.operationAuthoring.authored?.includes('steps'),
  );
  useFlowStore.getState().redo();
  assert.ok(
    useFlowStore
      .getState()
      .nodes.find((node) => node.id === id)
      .data.operationAuthoring.authored.includes('steps'),
  );
});

test('removed stages are archived and an exact model round trip restores their settings and position', () => {
  const source = starter();
  const graph = authoring.createOperationStarter(source, { x: 15, y: 30 });
  const prior = graph.nodes[1];
  prior.data.params.prompt.value = 'My original custom prompt';
  prior.position = { x: 850, y: 190 };
  const target = starter('WholePipeline');
  target.nodes[1].operation.operationId = 'diffusion.generate_image';
  target.nodes[1].operation.decomposition = 'pipeline';
  target.nodes[1].operation.nodeType = 'pipeline';
  target.nodes[1].operation.blockName = null;
  target.edges[0].target = 'diffusion.generate_image';
  const changed = authoring.planOperationChange(graph, graph.nodes[0].id, target);
  const owner = changed.graph.nodes.find((node) => node.data.action === 'Load');
  assert.equal(owner.data.operationAuthoring.inactiveDrafts.length, 1);
  const persisted = JSON.parse(JSON.stringify(changed.graph));
  const returned = authoring.planOperationChange(persisted, owner.id, source);
  const restored = returned.graph.nodes.find(
    (node) => node.data.operationAuthoring?.operation.operationId === 'diffusion.denoise',
  );
  assert.equal(restored.data.params.prompt.value, 'My original custom prompt');
  assert.deepEqual(restored.position, prior.position);
  assert.equal(restored.id, prior.id);
  assert.ok(authoring.operationAuthoring(returned.graph.nodes.find((node) => node.data.action === 'Load')));
});

test('explicit default-equal values retain authorship across a decomposition change and another model', () => {
  const graph = authoring.createOperationStarter(starter(), { x: 0, y: 0 });
  graph.nodes[1].data.operationAuthoring.authored = ['steps'];
  const target = starter('WholePipeline');
  target.nodes[1].operation.operationId = 'diffusion.generate_image';
  target.nodes[1].operation.decomposition = 'pipeline';
  target.nodes[1].operation.nodeType = 'pipeline';
  target.nodes[1].operation.blockName = null;
  target.edges[0].target = 'diffusion.generate_image';
  const changed = authoring.planOperationChange(graph, graph.nodes[0].id, target);
  const owner = changed.graph.nodes.find((node) => node.data.action === 'Load');
  const stage = changed.graph.nodes.find((node) => node.data.action === 'Denoise');
  assert.ok(stage.data.operationAuthoring.authored.includes('steps'));
  const next = authoring.planOperationChange(changed.graph, owner.id, starter('ThirdPipeline', 'text_to_image', 40));
  assert.equal(next.graph.nodes.find((node) => node.data.action === 'Denoise').data.params.steps.value, 20);
});

test('a whole-pipeline round trip restores custom text to the dedicated prompt socket, not its fallback widget', () => {
  const native = starter();
  native.nodes[1].node.params.prompt.isInput = false;
  native.nodes[1].node.params.prompt_input = { type: 'string', display: 'input' };
  native.nodes[1].operation.ports.push({
    ...native.nodes[1].operation.ports.find((port) => port.name === 'prompt'),
    name: 'prompt_input',
    semanticName: 'prompt',
  });
  const graph = authoring.createOperationStarter(native, { x: 0, y: 0 });
  const custom = {
    id: 'custom',
    type: 'custom',
    position: { x: 0, y: 200 },
    data: {
      module: 'custom.Prompt',
      action: 'Prefix',
      label: 'Custom prompt',
      params: {
        text: { display: 'output', type: 'string' },
      },
    },
  };
  graph.nodes.push(custom);
  const wire = {
    id: 'custom-prompt',
    source: custom.id,
    sourceHandle: 'text',
    target: graph.nodes[1].id,
    targetHandle: 'prompt_input',
  };
  graph.edges.push(wire);
  const whole = starter('WholePipeline');
  whole.nodes[1].operation.operationId = 'diffusion.generate_image';
  whole.nodes[1].operation.decomposition = 'pipeline';
  whole.nodes[1].operation.nodeType = 'pipeline';
  whole.nodes[1].operation.blockName = null;
  whole.edges[0].target = 'diffusion.generate_image';
  const changed = authoring.planOperationChange(graph, graph.nodes[0].id, whole);
  assert.equal(changed.graph.edges.find((edge) => edge.id === wire.id).targetHandle, 'prompt');
  const returned = authoring.planOperationChange(
    JSON.parse(JSON.stringify(changed.graph)),
    changed.graph.nodes[0].id,
    native,
  );
  assert.deepEqual(
    returned.graph.edges.find((edge) => edge.id === wire.id),
    wire,
  );
  assert.equal(returned.graph.nodes.find((node) => node.id === wire.target).data.params.prompt.isInput, false);
});

function declaredGuidance(pipeline = 'FuturePipeline', options = {}) {
  const item = starter(pipeline);
  const node = item.nodes[1];
  const controls = {
    guider: { type: 'string', display: 'select', value: 'ClassifierFreeGuidance' },
    enabled: { type: 'boolean', display: 'switch', value: true },
    use_original_formulation: { type: 'boolean', display: 'switch', value: false },
    guidance_scale: { type: 'float', display: 'number', value: 3.5 },
  };
  Object.assign(node.node.params, controls);
  const control = {
    technique: 'classifier_free',
    parameter: 'scale',
    compatibilityScope: 'diffusers.classifier_free.v1',
    scaleMeaning: 'cfg_prediction_mix',
    enabled: 'boolean_field',
    enabledField: 'enabled',
    formulation: 'boolean_field',
    formulationField: 'use_original_formulation',
    selectorField: 'guider',
    selectorValue: 'ClassifierFreeGuidance',
    negativeConditioning: 'pipeline_scoped_when_enabled',
    negativeConditioningScope: pipeline,
    ...options,
  };
  for (const [name, field] of Object.entries(controls)) {
    node.operation.ports.push({
      name,
      semanticName: name,
      direction: 'input',
      roles: ['value'],
      types: [field.type],
      required: false,
      hidden: false,
      semantics: {
        kind: 'value',
        scope: null,
        state: null,
        owner: 'none',
        members: [],
        ...(name === 'guidance_scale' ? { control } : {}),
      },
    });
  }
  return item;
}

test('an unchanged route attachment retains authored hidden runtime values while a new task adopts its defaults', () => {
  const recipe = starter();
  recipe.nodes[0].node.params.repo_id = {
    type: 'model',
    display: 'modelselect',
    value: { source: 'hub', value: 'org/model' },
  };
  for (const stage of recipe.nodes) {
    stage.node.params.runtime_variant = {
      type: 'string',
      display: 'select',
      hidden: true,
      options: ['native', 'compatible'],
      value: 'native',
    };
    stage.operation.ports.push({
      name: 'runtime_variant',
      semanticName: 'runtime_variant',
      direction: 'input',
      roles: ['value'],
      types: ['string'],
      required: false,
      hidden: true,
      semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
    });
  }
  const graph = authoring.createOperationStarter(recipe, { x: 0, y: 0 });
  graph.nodes.forEach((node) => {
    node.data.params.runtime_variant.value = 'compatible';
  });
  const preserved = authoring.planOperationChange(graph, graph.nodes[0].id, recipe, { preserveValues: true });
  assert.ok(preserved.graph.nodes.every((node) => node.data.params.runtime_variant.value === 'compatible'));
  const nextTask = structuredClone(recipe);
  nextTask.task = 'image_to_image';
  nextTask.workflowId = 'image_to_image';
  for (const stage of nextTask.nodes) {
    stage.operation.task = nextTask.task;
    stage.operation.workflowId = nextTask.workflowId;
  }
  const changed = authoring.planOperationChange(graph, graph.nodes[0].id, nextTask, { preserveValues: true });
  assert.ok(changed.graph.nodes.every((node) => node.data.params.runtime_variant.value === 'native'));
  const nextModel = structuredClone(recipe);
  nextModel.nodes[0].node.params.repo_id.value = { source: 'hub', value: 'org/other-model' };
  const replaced = authoring.planOperationChange(graph, graph.nodes[0].id, nextModel, {
    preserveValues: true,
    replaceModel: true,
  });
  assert.ok(replaced.graph.nodes.every((node) => node.data.params.runtime_variant.value === 'native'));
  const rebound = structuredClone(recipe);
  for (const stage of rebound.nodes) {
    stage.operation.binding = { ...stage.operation.binding, values: { runtime_variant: 'native' } };
  }
  const bound = authoring.planOperationChange(graph, graph.nodes[0].id, rebound, { preserveValues: true });
  assert.ok(bound.graph.nodes.every((node) => node.data.params.runtime_variant.value === 'native'));
  const reset = authoring.planOperationChange(graph, graph.nodes[0].id, recipe, {
    preserveValues: true,
    restoreDefaults: true,
  });
  assert.ok(reset.graph.nodes.every((node) => node.data.params.runtime_variant.value === 'native'));
  for (const [sourceSelector, targetSelector, expected] of [
    [{ source: 'local', value: '/models/model' }, { source: 'local', value: '/models/model' }, 'compatible'],
    ['org/model', 'org/model', 'compatible'],
    [{ source: 'hub', value: 'org/model' }, { source: 'local', value: 'org/model' }, 'native'],
    [{ source: 'unknown', value: 'org/model' }, { source: 'unknown', value: 'org/model' }, 'native'],
    [{ source: 'hub', value: '   ' }, { source: 'hub', value: '   ' }, 'native'],
    [{ source: 'hub', value: ['org/model'] }, { source: 'hub', value: ['org/model'] }, 'native'],
    [
      { source: 'hub', value: 'org/model', sha256: 'old' },
      { source: 'hub', value: 'org/model', sha256: 'new' },
      'native',
    ],
  ]) {
    const source = structuredClone(graph);
    source.nodes[0].data.params.repo_id.value = sourceSelector;
    const target = structuredClone(recipe);
    target.nodes[0].node.params.repo_id.value = targetSelector;
    const result = authoring.planOperationChange(source, source.nodes[0].id, target, { preserveValues: true });
    assert.ok(
      result.graph.nodes.every((node) => node.data.params.runtime_variant.value === expected),
      `Exact durable owner identity: ${JSON.stringify([sourceSelector, targetSelector])}`,
    );
  }
});

function archivedHiddenRuntimeFixture() {
  const recipe = starter();
  recipe.nodes[0].node.params.repo_id = {
    type: 'model',
    display: 'modelselect',
    value: { source: 'hub', value: 'org/model' },
  };
  for (const stage of recipe.nodes) {
    stage.node.params.runtime_variant = {
      type: 'string',
      display: 'select',
      hidden: true,
      options: ['native', 'compatible'],
      value: 'native',
    };
    stage.operation.ports.push({
      name: 'runtime_variant',
      semanticName: 'runtime_variant',
      direction: 'input',
      roles: ['value'],
      types: ['string'],
      required: false,
      hidden: true,
      semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
    });
  }
  const graph = authoring.createOperationStarter(recipe, { x: 0, y: 0 });
  graph.nodes.forEach((node) => {
    node.data.params.runtime_variant.value = 'compatible';
  });
  const next = structuredClone(recipe);
  next.task = next.workflowId = 'image_to_image';
  for (const stage of next.nodes) stage.operation.task = stage.operation.workflowId = next.task;
  const away = authoring.planOperationChange(graph, graph.nodes[0].id, next).graph;
  const owner = away.nodes.find((node) => node.data.action === 'Load');
  return { recipe, away, owner, archive: owner.data.operationAuthoring.inactiveDrafts[0] };
}

test('exact archived route return restores its authored hidden runtime literals together', () => {
  const { recipe, away, owner } = archivedHiddenRuntimeFixture();
  const before = structuredClone(away);
  const returned = authoring.planOperationChange(away, owner.id, recipe);
  assert.ok(returned.graph.nodes.every((node) => node.data.params.runtime_variant.value === 'compatible'));
  assert.ok(returned.review.preserved.some((message) => /runtime settings.*inactive draft/i.test(message)));
  assert.deepEqual(away, before, 'return preview must not alter the archive or current workflow');
  const reset = authoring.planOperationChange(away, owner.id, recipe, { restoreDefaults: true });
  assert.ok(reset.graph.nodes.every((node) => node.data.params.runtime_variant.value === 'native'));
});

test('bound hidden identity selectors stay under fresh binding authority during runtime draft recovery', () => {
  const { recipe, away, owner, archive } = archivedHiddenRuntimeFixture();
  for (const [index, stage] of recipe.nodes.entries()) {
    stage.node.params.bound_identity = { type: 'string', hidden: true, value: 'exact' };
    stage.operation.binding.values.bound_identity = 'exact';
    stage.operation.ports.push({
      name: 'bound_identity',
      semanticName: 'bound_identity',
      direction: 'input',
      roles: ['value'],
      types: ['string'],
      required: false,
      hidden: true,
      semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
    });
    archive.nodes[index].data.operationAuthoring.operation = structuredClone(stage.operation);
    archive.nodes[index].data.params.bound_identity = { ...stage.node.params.bound_identity, value: 'stale' };
    archive.nodes[index].data.operationAuthoring.authored = ['runtime_variant', 'bound_identity'];
  }
  const returned = authoring.planOperationChange(away, owner.id, recipe);
  assert.ok(returned.graph.nodes.every((node) => node.data.params.runtime_variant.value === 'compatible'));
  assert.ok(returned.graph.nodes.every((node) => node.data.params.bound_identity.value === 'exact'));
});

test('regrouping unchanged stages and returning to their snapshot derives the actual customization state', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const ordinary = graph();
  const grouped = visual.groupVisualStages(ordinary, [ordinary.nodes[1].id], 'inputs');
  const initial = structuredClone(grouped);
  const root = grouped.nodes.find((node) => node.data.blockInstanceV2);
  const same = visual.groupVisualStages(ordinary, [ordinary.nodes[1].id], 'inputs', root);
  const sameInstance = same.nodes.find((node) => node.id === root.id).data.blockInstanceV2;
  assert.equal(sameInstance.customization.state, 'unchanged');
  assert.deepEqual(sameInstance.definitionSnapshot, root.data.blockInstanceV2.definitionSnapshot);
  assert.deepEqual(sameInstance.effectiveGraph, root.data.blockInstanceV2.effectiveGraph);

  const promptControl = root.data.blockInstanceV2.effectiveInterface.controls.find(
    (control) => control.binding.fieldId === 'prompt',
  );
  const parameterEdit = structuredClone(grouped);
  const parameterRoot = parameterEdit.nodes.find((node) => node.id === root.id);
  parameterRoot.data.blockInstanceV2 = runtime.setBlockInstanceValueV2(
    parameterRoot.data.blockInstanceV2,
    promptControl.controlId,
    'Public override',
  );
  assert.equal(parameterRoot.data.blockInstanceV2.customization.state, 'parameters_changed');
  const parameterUnpacked = visual.unpackVisualOperationGroups(parameterEdit);
  const parameterRegrouped = visual.restoreVisualOperationGroups(parameterUnpacked.graph, parameterUnpacked);
  assert.equal(
    visual.unpackVisualOperationGroups(parameterRegrouped).graph.nodes.find((node) => node.data.action === 'Denoise')
      .data.params.prompt.value,
    'Public override',
    'regrouping materializes and keeps the public parameter override',
  );
  assert.equal(
    parameterRegrouped.nodes.find((node) => node.id === root.id).data.blockInstanceV2.customization.state,
    'structure_changed',
    'materialized parameter overrides differ from the immutable base graph',
  );

  const changed = structuredClone(ordinary);
  changed.nodes.find((node) => node.data.action === 'Denoise').data.params.prompt.value = 'Changed prompt';
  const edited = visual.groupVisualStages(changed, [ordinary.nodes[1].id], 'inputs', root);
  assert.equal(
    edited.nodes.find((node) => node.id === root.id).data.blockInstanceV2.customization.state,
    'structure_changed',
  );
  const restored = visual.groupVisualStages(
    ordinary,
    [ordinary.nodes[1].id],
    'inputs',
    edited.nodes.find((node) => node.id === root.id),
  );
  const restoredInstance = restored.nodes.find((node) => node.id === root.id).data.blockInstanceV2;
  assert.equal(restoredInstance.customization.state, 'unchanged');
  assert.deepEqual(restoredInstance.definitionSnapshot, root.data.blockInstanceV2.definitionSnapshot);
  assert.deepEqual(restoredInstance.effectiveGraph, root.data.blockInstanceV2.effectiveGraph);
  assert.deepEqual(grouped, initial, 'regrouping never mutates the reusable snapshot or original instance');
});

for (const [name, change] of [
  [
    'another archived owner',
    ({ archive }) => {
      archive.nodes[0].data.params.repo_id.value = { source: 'hub', value: 'org/other' };
    },
  ],
  [
    'another archived revision',
    ({ archive }) => {
      archive.nodes[0].data.params.revision = { type: 'string', value: 'other' };
    },
  ],
  [
    'another archived task',
    ({ archive }) => {
      archive.nodes[0].data.operationAuthoring.operation.task = 'outpaint';
    },
  ],
  [
    'changed archived binding',
    ({ archive }) => {
      archive.nodes[1].data.operationAuthoring.operation.binding.values.other = 'bound';
    },
  ],
  [
    'changed archived value port',
    ({ archive }) => {
      archive.nodes[1].data.operationAuthoring.operation.ports.find((p) => p.name === 'runtime_variant').semanticName =
        'another_runtime';
    },
  ],
  [
    'changed destination visibility',
    ({ recipe }) => {
      recipe.nodes[1].node.params.runtime_variant.hidden = false;
    },
  ],
  [
    'changed destination type',
    ({ recipe }) => {
      recipe.nodes[1].node.params.runtime_variant.type = 'int';
    },
  ],
  [
    'rejected destination value',
    ({ recipe }) => {
      recipe.nodes[1].node.params.runtime_variant.options = ['native'];
    },
  ],
  [
    'archived runtime wire',
    ({ archive }) => {
      archive.edges.push({
        id: 'runtime-wire',
        source: 'external',
        sourceHandle: 'value',
        target: archive.nodes[1].id,
        targetHandle: 'runtime_variant',
      });
    },
  ],
  [
    'archived connected marker',
    ({ archive }) => {
      archive.nodes[1].data.params.runtime_variant.isConnected = true;
    },
  ],
  [
    'fresh runtime wire',
    ({ recipe }) => {
      recipe.edges.push({
        source: 'diffusion.load_models',
        sourceHandle: 'models',
        target: 'diffusion.denoise',
        targetHandle: 'runtime_variant',
      });
    },
  ],
  [
    'removed destination runtime port',
    ({ recipe }) => {
      recipe.nodes[1].operation.ports = recipe.nodes[1].operation.ports.filter((p) => p.name !== 'runtime_variant');
    },
  ],
  [
    'fresh connected marker',
    ({ recipe }) => {
      recipe.nodes[1].node.params.runtime_variant.isConnected = true;
    },
  ],
  [
    'new bound runtime selector',
    ({ recipe }) => {
      recipe.nodes[1].operation.binding.values.runtime_variant = 'native';
    },
  ],
])
  test(`archived hidden runtime restoration is atomic and reviewed with ${name}`, () => {
    const value = archivedHiddenRuntimeFixture();
    change(value);
    const before = structuredClone(value.away);
    const result = authoring.planOperationChange(value.away, value.owner.id, value.recipe);
    assert.ok(result.graph.nodes.every((node) => node.data.params.runtime_variant.value === 'native'));
    assert.equal(result.review.required, true);
    assert.ok(result.review.attention.some((message) => /runtime settings.*archived.*defaults/i.test(message)));
    assert.deepEqual(value.away, before, 'failed restoration keeps the original archive intact');
  });

test('explicitly compatible CFG settings transfer across families without moving conditioning ownership', () => {
  const source = authoring.createOperationStarter(declaredGuidance(), { x: 0, y: 0 });
  source.nodes[1].data.params.guidance_scale.value = 7;
  const before = structuredClone(source);
  const changed = authoring.planOperationChange(source, source.nodes[0].id, declaredGuidance('OtherPipeline'));
  const stage = changed.graph.nodes.find((node) => node.data.action === 'Denoise');
  assert.equal(stage.data.params.guidance_scale.value, 7);
  assert.equal(stage.data.operationAuthoring.retained.length, 0);
  assert.equal(
    stage.data.operationAuthoring.operation.ports.find((p) => p.name === 'guidance_scale').semantics.control
      .negativeConditioningScope,
    'OtherPipeline',
  );
  assert.deepEqual(source, before, 'Preview does not mutate the original workflow.');
});

test('reviewed control aliases transfer by declared meaning rather than field labels', () => {
  const source = authoring.createOperationStarter(declaredGuidance(), { x: 0, y: 0 });
  source.nodes[1].data.params.guidance_scale.value = 7;
  const target = declaredGuidance('OtherPipeline');
  const node = target.nodes[1];
  node.node.params.true_cfg_scale = node.node.params.guidance_scale;
  delete node.node.params.guidance_scale;
  const port = node.operation.ports.find((p) => p.name === 'guidance_scale');
  port.name = 'true_cfg_scale';
  port.semanticName = 'true_cfg_scale';
  const changed = authoring.planOperationChange(source, source.nodes[0].id, target);
  const stage = changed.graph.nodes.find((node) => node.data.action === 'Denoise');
  assert.equal(stage.data.params.true_cfg_scale.value, 7);
  assert.equal(stage.data.operationAuthoring.retained.length, 0);
});

test('unchanged model attachment preserves unresolved distilled values and wires without authorizing model transfer', () => {
  const recipe = declaredGuidance();
  recipe.nodes[0].node.params.repo_id = {
    type: 'model',
    display: 'modelselect',
    value: { source: 'hub', value: 'org/model' },
  };
  recipe.nodes[1].operation.ports.find((p) => p.name === 'guidance_scale').semantics.control.enabled = 'model_config';
  recipe.nodes[1].operation.ports.find((p) => p.name === 'guidance_scale').semantics.control.enabledField = null;
  const source = authoring.createOperationStarter(recipe, { x: 0, y: 0 });
  source.nodes[1].data.params.guidance_scale.value = 7;
  source.nodes[1].data.params.guidance_scale.isInput = true;
  const input = {
    id: 'external-guidance',
    type: 'custom',
    position: { x: -400, y: 0 },
    data: {
      module: 'modules.Test',
      action: 'Scalar',
      label: 'Guidance value',
      params: { value: { type: 'float', display: 'output' } },
    },
  };
  source.nodes.push(input);
  source.edges.push({
    id: 'external-guidance-wire',
    source: input.id,
    sourceHandle: 'value',
    target: source.nodes[1].id,
    targetHandle: 'guidance_scale',
  });
  const preserved = authoring.planOperationChange(source, source.nodes[0].id, recipe, { preserveValues: true });
  assert.equal(preserved.graph.nodes.find((n) => n.data.action === 'Denoise').data.params.guidance_scale.value, 7);
  assert.ok(preserved.graph.edges.some((e) => e.id === 'external-guidance-wire'));
  const reset = authoring.planOperationChange(source, source.nodes[0].id, recipe, { restoreDefaults: true });
  assert.ok(
    reset.graph.edges.some((e) => e.id === 'external-guidance-wire'),
    "Resetting unconnected creative defaults preserves the unchanged model's connected distilled control.",
  );
  const different = structuredClone(recipe);
  different.nodes[0].node.params.repo_id.value = { source: 'hub', value: 'org/other-model' };
  const changed = authoring.planOperationChange(source, source.nodes[0].id, different, { replaceModel: true });
  assert.equal(changed.graph.nodes.find((n) => n.data.action === 'Denoise').data.params.guidance_scale.value, 3.5);
  assert.ok(!changed.graph.edges.some((e) => e.id === 'external-guidance-wire'));
});

test('empty negative text is a supplied condition, while wired or absent conditioning remains unresolved', () => {
  const direct = (negative) => {
    const value = declaredGuidance('OtherPipeline', {
      negativePromptField: 'negative_prompt',
      negativePromptPolicy: 'empty_string_is_condition',
    });
    value.nodes[1].node.params.negative_prompt = { type: 'string', display: 'text', value: negative };
    value.nodes[1].operation.ports.push({
      name: 'negative_prompt',
      semanticName: 'negative_prompt',
      direction: 'input',
      roles: ['value'],
      types: ['string'],
      required: false,
      hidden: false,
      semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
    });
    return value;
  };
  const source = authoring.createOperationStarter(declaredGuidance(), { x: 0, y: 0 });
  source.nodes[1].data.params.guidance_scale.value = 7;
  const supplied = authoring.planOperationChange(source, source.nodes[0].id, direct(''));
  assert.equal(supplied.graph.nodes.find((n) => n.data.action === 'Denoise').data.params.guidance_scale.value, 7);
  const absent = authoring.planOperationChange(source, source.nodes[0].id, direct(undefined));
  assert.equal(absent.graph.nodes.find((n) => n.data.action === 'Denoise').data.params.guidance_scale.value, 3.5);
});

test('a direct-pipeline scale must preserve the effective CFG switch after transfer', () => {
  const source = authoring.createOperationStarter(declaredGuidance(), { x: 0, y: 0 });
  source.nodes[1].data.params.guidance_scale.value = 0;
  const target = declaredGuidance('OtherPipeline', { enabled: 'scale_gt_one', enabledField: 'guidance_scale' });
  const changed = authoring.planOperationChange(source, source.nodes[0].id, target);
  const stage = changed.graph.nodes.find((node) => node.data.action === 'Denoise');
  assert.equal(stage.data.params.guidance_scale.value, 3.5);
  assert.ok(
    stage.data.operationAuthoring.retained.some((entry) => entry.field === 'guidance_scale' && entry.value === 0),
  );
  assert.equal(changed.review.required, true);
});

test('wired guidance policy is unresolved even if the inline fallback looks compatible', () => {
  const source = authoring.createOperationStarter(declaredGuidance(), { x: 0, y: 0 });
  source.nodes[1].data.params.guidance_scale.value = 7;
  source.nodes.push({
    id: 'policy',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      module: 'custom.Policy',
      action: 'Value',
      params: { value: { display: 'output', type: 'boolean' } },
    },
  });
  source.nodes[1].data.params.enabled.isInput = true;
  source.edges.push({
    id: 'enabled-wire',
    source: 'policy',
    sourceHandle: 'value',
    target: source.nodes[1].id,
    targetHandle: 'enabled',
  });
  const changed = authoring.planOperationChange(source, source.nodes[0].id, declaredGuidance('OtherPipeline'));
  const stage = changed.graph.nodes.find((node) => node.data.action === 'Denoise');
  assert.equal(stage.data.params.guidance_scale.value, 3.5);
  assert.ok(
    stage.data.operationAuthoring.retained.some((entry) => entry.field === 'guidance_scale' && entry.value === 7),
  );
  assert.equal(changed.review.required, true);
});

test('external CFG scale wiring is preserved only for an explicitly compatible target policy', () => {
  const source = authoring.createOperationStarter(declaredGuidance(), { x: 0, y: 0 });
  source.nodes[1].data.params.guidance_scale.value = 7;
  source.nodes.push({
    id: 'scale',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      module: 'custom.Scale',
      action: 'Value',
      params: { value: { display: 'output', type: 'float' } },
    },
  });
  source.nodes[1].data.params.guidance_scale.isInput = true;
  source.edges.push({
    id: 'scale-wire',
    source: 'scale',
    sourceHandle: 'value',
    target: source.nodes[1].id,
    targetHandle: 'guidance_scale',
  });
  const compatible = authoring.planOperationChange(source, source.nodes[0].id, declaredGuidance('OtherPipeline'));
  assert.ok(compatible.graph.edges.some((edge) => edge.id === 'scale-wire'));
  const target = declaredGuidance('OtherPipeline');
  target.nodes[1].node.params.use_original_formulation.value = true;
  const incompatible = authoring.planOperationChange(source, source.nodes[0].id, target);
  assert.ok(!incompatible.graph.edges.some((edge) => edge.id === 'scale-wire'));
  assert.ok(incompatible.graph.nodes.some((node) => node.id === 'scale'));
  assert.equal(incompatible.review.required, true);
  assert.ok(incompatible.review.attention.some((message) => /disconnect/i.test(message)));
  const threshold = authoring.planOperationChange(
    source,
    source.nodes[0].id,
    declaredGuidance('OtherPipeline', { enabled: 'scale_gt_one', enabledField: 'guidance_scale' }),
  );
  assert.ok(!threshold.graph.edges.some((edge) => edge.id === 'scale-wire'));
  assert.ok(threshold.graph.nodes.some((node) => node.id === 'scale'));
  assert.equal(threshold.review.required, true);
  assert.ok(threshold.review.attention.some((message) => /disconnect/i.test(message)));
});

test('actual CFG contracts never use a wired scale fallback to prove the destination activation policy', async () => {
  const { readFile } = await import('node:fs/promises');
  const fixture = JSON.parse(
    await readFile(new URL('../tests/fixtures/guidance-control-contract.v1.json', import.meta.url)),
  );
  const { compatibleOperationControlTransfer } = await server.ssrLoadModule(
    '/src/workflow/operationControlTransfer.ts',
  );
  const contract = (pipeline, nodeKey) => {
    const operation = fixture.contracts.find((item) => item.pipelineClass === pipeline && item.nodeKey === nodeKey);
    assert.ok(operation);
    return operation;
  };
  const node = (operation, values) => ({
    id: operation.pipelineClass,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      module: operation.nodeKey.slice(0, operation.nodeKey.lastIndexOf('.')),
      action: operation.nodeKey.split('.').at(-1),
      params: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, { value }])),
    },
  });
  const sourceContract = contract('StableDiffusionXLModularPipeline', 'modules.ModularDiffusers.Guider');
  const targetContract = contract('FluxPipeline', 'modules.DiffusersImage.Generate');
  const nativeContract = contract('FluxModularPipeline', 'modules.ModularDiffusers.Guider');
  const control = (operation) => operation.ports.find((port) => port.name === 'guidance_scale').semantics.control;
  const source = node(sourceContract, {
    guider: 'ClassifierFreeGuidance',
    enabled: true,
    use_original_formulation: false,
    guidance_scale: 7,
  });
  const target = node(targetContract, { guidance_scale: 7, negative_prompt: '' });
  const native = node(nativeContract, {
    guider: 'ClassifierFreeGuidance',
    enabled: true,
    use_original_formulation: false,
    guidance_scale: 7,
  });
  const compatible = (destination, destinationContract, connected = new Set()) =>
    compatibleOperationControlTransfer(
      source,
      'guidance_scale',
      control(sourceContract),
      destination,
      'guidance_scale',
      control(destinationContract),
      connected,
      new Set(),
    );
  assert.equal(compatible(target, targetContract), true, 'the known literal retains enabled CFG');
  assert.equal(
    compatible(target, targetContract, new Set(['guidance_scale'])),
    false,
    'a wire can supply zero regardless of its fallback',
  );
  assert.equal(
    compatible(native, nativeContract, new Set(['guidance_scale'])),
    true,
    'native boolean activation does not depend on the unknown scale',
  );
  source.data.params.guidance_scale.isConnected = true;
  assert.equal(compatible(target, targetContract), false, 'the connected field marker must also stay opaque');
  assert.equal(compatible(native, nativeContract), true);
});

for (const [name, change] of [
  [
    'different formulation',
    (item) => {
      item.nodes[1].node.params.use_original_formulation.value = true;
    },
  ],
  [
    'disabled guidance',
    (item) => {
      item.nodes[1].node.params.enabled.value = false;
    },
  ],
  [
    'another guider technique',
    (item) => {
      item.nodes[1].node.params.guider.value = 'OtherGuidance';
    },
  ],
  [
    'unknown component enablement',
    (item) => {
      const control = item.nodes[1].operation.ports.find((p) => p.name === 'guidance_scale').semantics.control;
      control.enabled = 'model_config';
      control.enabledField = null;
    },
  ],
  [
    'unrelated compatibility scope',
    (item) => {
      item.nodes[1].operation.ports.find((p) => p.name === 'guidance_scale').semantics.control.compatibilityScope =
        'reviewed.unrelated.v1';
    },
  ],
]) {
  test(`guidance transfer retains the edited value for review with ${name}`, () => {
    const source = authoring.createOperationStarter(declaredGuidance(), { x: 0, y: 0 });
    source.nodes[1].data.params.guidance_scale.value = 7;
    const target = declaredGuidance('OtherPipeline');
    change(target);
    const changed = authoring.planOperationChange(source, source.nodes[0].id, target);
    const stage = changed.graph.nodes.find((node) => node.data.action === 'Denoise');
    assert.equal(stage.data.params.guidance_scale.value, 3.5);
    assert.ok(
      stage.data.operationAuthoring.retained.some((entry) => entry.field === 'guidance_scale' && entry.value === 7),
    );
    assert.equal(changed.review.required, true);
  });
}

test('matching guidance labels do not establish cross-family guidance semantics', () => {
  const source = starter();
  const target = starter('DistilledPipeline');
  for (const item of [source, target]) {
    item.nodes[1].node.params.guidance_scale = { type: 'float', display: 'number', value: 3.5 };
    item.nodes[1].operation.ports.push({
      ...item.nodes[1].operation.ports.find((port) => port.name === 'steps'),
      name: 'guidance_scale',
      semanticName: 'guidance_scale',
      types: ['float'],
    });
  }
  const graph = authoring.createOperationStarter(source, { x: 0, y: 0 });
  graph.nodes[1].data.params.guidance_scale.value = 7;
  const result = authoring.planOperationChange(graph, graph.nodes[0].id, target);
  const stage = result.graph.nodes.find((node) => node.data.action === 'Denoise');
  assert.equal(stage.data.params.guidance_scale.value, 3.5);
  assert.ok(
    stage.data.operationAuthoring.retained.some((field) => field.field === 'guidance_scale' && field.value === 7),
  );
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

test('model changes retire unused derived outputs but preserve connected and configured outputs', async () => {
  const { schema, runtime, instance, draft } = await derivedOperationBlock();
  const raw = structuredClone(instance.definitionSnapshot);
  const denoise = raw.graph.nodes.find((n) => n.data.action === 'Denoise');
  denoise.data.params.route_state_out = { type: 'modular_route_state', display: 'output' };
  raw.boundary.outputs.push({
    portId: 'route',
    label: 'Route State',
    valueType: 'modular_route_state',
    required: false,
    binding: { nodeId: denoise.nodeId, fieldOrPortId: 'route_state_out' },
  });
  raw.graph.graphHash = schema.blockGraphHashV2(raw.graph);
  raw.contentHash = schema.blockDefinitionContentHashV2(raw);
  const base = schema.createBlockInstanceV2(raw, {
    instanceId: instance.instanceId,
    position: instance.presentation.position,
    size: instance.presentation.size,
  });
  const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
  const graph = { nodes: [runtime.createBlockRootNodeV2(base)], edges: [] };
  const before = structuredClone(graph);
  const plan = planBlockOperationChange(graph, base.instanceId, draft.nodes[0].id, seededStarter(true));
  assert.deepEqual(plan.graph.nodes[0].data.blockInstanceV2.effectiveInterface.boundary.outputs, []);
  assert.match(plan.changes.join(' '), /output Route State/);
  assert.deepEqual(graph, before);
  const sink = {
    id: 'sink',
    type: 'custom',
    position: { x: 600, y: 0 },
    data: { module: 'test', action: 'sink', params: { state: { type: 'modular_route_state', display: 'input' } } },
  };
  assert.throws(
    () =>
      planBlockOperationChange(
        {
          nodes: [...graph.nodes, sink],
          edges: [
            { id: 'outside', source: base.instanceId, sourceHandle: 'route', target: 'sink', targetHandle: 'state' },
          ],
        },
        base.instanceId,
        draft.nodes[0].id,
        seededStarter(true),
      ),
    /missing|incompatible/,
  );
  const explicit = runtime.replaceBlockEffectiveInterfaceV2(base, {
    boundary: { ...base.effectiveInterface.boundary, mode: 'explicit', derivation: undefined },
    controls: base.effectiveInterface.controls,
  });
  assert.throws(
    () =>
      planBlockOperationChange(
        { nodes: [runtime.createBlockRootNodeV2(explicit)], edges: [] },
        base.instanceId,
        draft.nodes[0].id,
        seededStarter(true),
      ),
    /missing|incompatible/,
  );
});
