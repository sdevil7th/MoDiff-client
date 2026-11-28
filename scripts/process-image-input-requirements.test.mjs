import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server, buildGraphFixPlan, inspectRequiredGraphInputs;
before(async () => {
  server = await createServer({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  ({ buildGraphFixPlan } = await server.ssrLoadModule('/src/studio/graphFixer.ts'));
  ({ inspectRequiredGraphInputs } = await server.ssrLoadModule('/src/studio/requiredGraphInputs.ts'));
});
after(async () => server?.close());

// The shared palette declaration intentionally differs from the exact backend
// task overlay (integrated_operation_fields): only composite requires a mask.
const rawDefinition = {
  module: 'modules.ImageOperations',
  action: 'ProcessImage',
  label: 'Process Image',
  params: {
    image: { label: 'Image', type: 'image', display: 'input' },
    mask: { label: 'Mask', type: 'image', display: 'input' },
    pipeline_class: { type: 'string', default: 'BuiltinImageOperationV1', hidden: true },
    operation: {
      type: 'string',
      default: 'image_adjustment',
      options: [
        'image_adjustment',
        'image_filter',
        'image_crop',
        'image_upscale',
        'image_stitch',
        'image_tile',
        'image_channels',
        'mask_composite',
      ],
    },
    output: { type: 'image', display: 'output' },
  },
};
const operationContracts = rawDefinition.params.operation.options.map((task) => ({
  pipelineClass: 'BuiltinImageOperationV1',
  task,
  operationId: 'image.process',
  nodeKey: 'modules.ImageOperations.ProcessImage',
  nodeType: 'integrated',
  decomposition: 'integrated',
  support: 'declared',
  blockName: null,
  ports: ['image', 'mask'].map((name) => ({
    name,
    semanticName: name,
    direction: 'input',
    roles: ['value'],
    types: ['image'],
    required: name === 'image' || task === 'mask_composite',
    hidden: name === 'mask' && task !== 'mask_composite',
  })),
}));

function fixture(task) {
  const process = { id: 'process', type: 'custom', position: { x: 200, y: 0 }, data: structuredClone(rawDefinition) };
  process.data.params.operation.value = task;
  const source = {
    id: 'source',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      module: 'modules.Test',
      action: 'Source',
      label: 'Source',
      params: { image: { type: 'image', display: 'output' } },
    },
  };
  const preview = {
    id: 'preview',
    type: 'custom',
    position: { x: 400, y: 0 },
    data: {
      module: 'modules.Image',
      action: 'Preview',
      label: 'Preview',
      params: { image: { type: 'image', display: 'input' } },
    },
  };
  const graph = {
    nodes: [source, process, preview],
    edges: [
      { id: 'in', source: 'source', sourceHandle: 'image', target: 'process', targetHandle: 'image' },
      { id: 'out', source: 'process', sourceHandle: 'output', target: 'preview', targetHandle: 'image' },
    ],
  };
  return { graph, process, registry: { 'modules.ImageOperations.ProcessImage': structuredClone(rawDefinition) } };
}
function findings(f, contracts = operationContracts) {
  return {
    fixes: buildGraphFixPlan({ ...f.graph, registry: f.registry, operationContracts: contracts }).issues.filter(
      (issue) => issue.targetNodeId === 'process' && issue.kind === 'missing_input',
    ),
    required: inspectRequiredGraphInputs(f.graph.nodes, f.graph, f.registry, contracts),
  };
}

test('raw palette Stitch does not request an unused mask', () => {
  const f = fixture('image_stitch');
  const before = structuredClone(f);
  assert.deepEqual(findings(f).fixes, [], 'Stitch consumes image only; do not propose a mask connection');
  assert.deepEqual(findings(f).required, []);
  assert.deepEqual(f, before, 'inspection must not mutate the saved graph or registry');
});

test('adjustment and tile keep mask optional while composite requires it in both inspectors', () => {
  for (const task of ['image_adjustment', 'image_tile', 'image_stitch', 'mask_composite']) {
    const f = fixture(task);
    const found = findings(f);
    assert.deepEqual(
      found.fixes.map((issue) => issue.targetHandle),
      task === 'mask_composite' ? ['mask'] : [],
      task,
    );
    assert.deepEqual(
      found.required.map((issue) => issue.fieldId),
      task === 'mask_composite' ? ['mask'] : [],
      task,
    );
  }
});

test('all selected image tasks still require their image source', () => {
  for (const task of rawDefinition.params.operation.options) {
    const f = fixture(task);
    f.graph.edges = f.graph.edges.filter((edge) => edge.id !== 'in');
    assert.ok(
      findings(f).fixes.some((issue) => issue.targetHandle === 'image'),
      task,
    );
    assert.ok(
      findings(f).required.some((issue) => issue.fieldId === 'image'),
      task,
    );
  }
});

test('current selected task overrides stale saved mask metadata in either direction without rewriting it', () => {
  const f = fixture('image_stitch');
  f.process.data.params.mask.required = true;
  assert.deepEqual(findings(f).fixes, []);
  assert.deepEqual(findings(f).required, []);
  f.process.data.params.operation.value = 'mask_composite';
  f.process.data.params.mask = { ...f.process.data.params.mask, required: false, hidden: true };
  const before = structuredClone(f);
  assert.deepEqual(
    findings(f).fixes.map((issue) => issue.targetHandle),
    ['mask'],
  );
  assert.deepEqual(
    findings(f).required.map((issue) => issue.fieldId),
    ['mask'],
  );
  assert.deepEqual(f, before);
});

test('composite accepts an enabled compatible mask source but keeps disabled or incompatible sources blocking', () => {
  const f = fixture('mask_composite');
  const mask = structuredClone(f.graph.nodes[0]);
  mask.id = 'mask';
  f.graph.nodes.push(mask);
  f.graph.edges.push({ id: 'mask-in', source: 'mask', sourceHandle: 'image', target: 'process', targetHandle: 'mask' });
  assert.deepEqual(findings(f).fixes, []);
  assert.deepEqual(findings(f).required, []);
  mask.data.uiState = { disabled: true };
  assert.deepEqual(
    findings(f).required.map((issue) => issue.fieldId),
    ['mask'],
  );
  delete mask.data.uiState;
  mask.data.params.image.type = 'string';
  assert.deepEqual(
    findings(f).required.map((issue) => issue.fieldId),
    ['mask'],
  );
});

test('unknown, malformed, computed or ambiguous selection preserves conservative legacy inspection', () => {
  const cases = [
    (f) => {
      f.process.data.params.operation.value = 'unknown_task';
    },
    (f) => {
      f.process.data.params.operation.value = { task: 'image_stitch' };
    },
    (f) => {
      f.process.data.params.pipeline_class.value = 'UnknownPipeline';
    },
    (f) => {
      f.process.data.params.operation.isConnected = true;
    },
    (f) => {
      f.graph.edges.push({
        id: 'task-in',
        source: 'source',
        sourceHandle: 'image',
        target: 'process',
        targetHandle: 'operation',
      });
    },
  ];
  for (const mutate of cases) {
    const f = fixture('image_stitch');
    mutate(f);
    assert.deepEqual(findings(f), findings(f, []));
    assert.ok(findings(f).fixes.some((issue) => issue.targetHandle === 'mask'));
  }
  const f = fixture('image_stitch');
  const duplicate = [...operationContracts, operationContracts.find((operation) => operation.task === 'image_stitch')];
  assert.deepEqual(findings(f, duplicate), findings(f, []));
  const malformed = structuredClone(operationContracts);
  delete malformed.find((operation) => operation.task === 'image_stitch').ports[1].required;
  assert.deepEqual(findings(f, malformed), findings(f, []));
});

test('default selector values resolve and unrelated generic nodes retain their legacy requirements', () => {
  const f = fixture('image_stitch');
  delete f.process.data.params.operation.value;
  assert.deepEqual(findings(f).fixes, []);
  f.process.data.module = 'custom.ImageOperations';
  assert.ok(findings(f).fixes.some((issue) => issue.targetHandle === 'mask'));
});
