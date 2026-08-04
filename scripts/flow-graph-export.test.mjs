import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let exportModule;
let userBlocksModule;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  exportModule = await server.ssrLoadModule('/src/stores/flowGraphExport.ts');
  userBlocksModule = await server.ssrLoadModule('/src/studio/userBlocks.ts');
});

after(async () => {
  await server?.close();
});

function seedNode(value) {
  return {
    id: 'generate',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.DiffusersImage',
      action: 'Generate',
      params: {
        seed: {
          type: 'int',
          display: 'random',
          value,
        },
      },
    },
  };
}

function exportSeed(value, setParam = () => {}) {
  const graph = exportModule.buildApiGraphExport({
    nodes: [seedNode(value)],
    edges: [],
    sid: 'test-session',
    setParam,
  });
  return graph.nodes.generate.params.seed;
}

test('locked random-field seeds export without the random display marker', () => {
  const seed = exportSeed({ value: 1234, isRandom: false });

  assert.equal(seed.value, 1234);
  assert.equal('display' in seed, false);
});

test('random-on-export seeds retain random behavior and metadata', () => {
  const originalRandom = Math.random;
  const updates = [];
  Math.random = () => 0.5;

  try {
    const seed = exportSeed({ value: 1234, isRandom: true }, (...args) => updates.push(args));
    const generatedSeed = Math.floor(0.5 * Number.MAX_SAFE_INTEGER);

    assert.deepEqual(seed, {
      display: 'random',
      value: generatedSeed,
    });
    assert.deepEqual(updates, [['generate', 'seed', { value: generatedSeed, isRandom: true }]]);
  } finally {
    Math.random = originalRandom;
  }
});

function loaderNode({ autoOffload, device, offloadMode }) {
  return {
    id: 'loader',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.DiffusersImage',
      action: 'LoadPipeline',
      label: 'Load pipeline',
      params: {
        device: { value: device },
        ...(typeof autoOffload === 'boolean' ? { auto_offload: { value: autoOffload } } : {}),
        ...(offloadMode ? { offload_mode: { value: offloadMode } } : {}),
      },
    },
  };
}

function exportLoader(options) {
  return exportModule.buildApiGraphExport({
    nodes: [loaderNode(options)],
    edges: [],
    sid: 'offload-session',
    setParam: () => {},
  });
}

test('graph export rejects unsupported device offload and inconsistent switch/mode combinations', () => {
  for (const device of ['cpu:0', 'mps:0', 'xpu:0']) {
    assert.throws(
      () => exportLoader({ autoOffload: true, device, offloadMode: 'model_cpu' }),
      /cannot be exported.*CUDA or ROCm/,
      device,
    );
  }
  assert.throws(
    () => exportLoader({ device: 'cpu:0', offloadMode: 'sequential_cpu' }),
    /cannot be exported.*sequential_cpu/,
  );
  assert.throws(
    () => exportLoader({ autoOffload: false, device: 'cuda:0', offloadMode: 'model_cpu' }),
    /cannot be exported.*Keep the switch and mode consistent/,
  );
});

test('graph export preserves safe CUDA/ROCm offload and non-offloaded CPU execution', () => {
  const cudaGraph = exportLoader({ autoOffload: true, device: 'cuda:0', offloadMode: 'model_cpu' });
  assert.equal(cudaGraph.nodes.loader.params.device.value, 'cuda:0');
  assert.equal(cudaGraph.nodes.loader.params.auto_offload.value, true);
  assert.equal(cudaGraph.nodes.loader.params.offload_mode.value, 'model_cpu');

  const cpuGraph = exportLoader({ autoOffload: false, device: 'cpu:0', offloadMode: 'none' });
  assert.equal(cpuGraph.nodes.loader.params.device.value, 'cpu:0');
  assert.equal(cpuGraph.nodes.loader.params.auto_offload.value, false);
  assert.equal(cpuGraph.nodes.loader.params.offload_mode.value, 'none');
});

test('visual loop containers export bounded executor metadata and direct child nodes', () => {
  const loop = {
    id: 'loop-container',
    type: 'loop',
    position: { x: 0, y: 0 },
    data: {
      type: 'loop',
      module: '',
      action: '',
      label: 'Loop',
      params: {
        iterations: { value: 4 },
        max_iterations: { value: 20 },
        carry: { value: true },
        collect: { value: true },
        max_retries: { value: 2 },
      },
    },
  };
  const controlNode = (id, action, params) => ({
    id,
    type: 'custom',
    parentId: 'loop-container',
    position: { x: 20, y: 60 },
    data: {
      type: 'custom',
      module: 'modules.WorkflowControl',
      action,
      label: action,
      params,
    },
  });
  const input = controlNode('loop-input', 'LoopInput', {
    initial: { display: 'input', value: 'start' },
    value: { display: 'output' },
  });
  const index = controlNode('loop-index', 'LoopIndex', {
    index_value: { value: 0 },
    iteration_count: { value: 1 },
    index: { display: 'output' },
  });
  const result = controlNode('loop-result', 'LoopResult', {
    value_input: { display: 'input' },
    stop_input: { display: 'input', value: false },
    value: { display: 'output' },
    collection: { display: 'output' },
  });
  const graph = exportModule.buildApiGraphExport({
    nodes: [loop, input, index, result],
    edges: [
      {
        id: 'index-result',
        source: 'loop-index',
        sourceHandle: 'index',
        target: 'loop-result',
        targetHandle: 'value_input',
      },
    ],
    sid: 'loop-session',
    setParam: () => {},
  });

  assert.equal('loop-container' in graph.nodes, false);
  assert.deepEqual(graph.loops, [
    {
      id: 'loop-container',
      bodyNodeIds: ['loop-input', 'loop-index', 'loop-result'],
      iterations: 4,
      maxIterations: 20,
      inputNodeId: 'loop-input',
      indexNodeId: 'loop-index',
      resultNodeId: 'loop-result',
      iterationMode: 'count',
      carry: true,
      collect: true,
      maxRetries: 2,
    },
  ]);
});

test('nested visual loops export strictly contained bodies and parent identity', () => {
  const loopNode = (id, parentId) => ({
    id,
    type: 'loop',
    ...(parentId ? { parentId } : {}),
    position: { x: 0, y: 0 },
    data: {
      type: 'loop',
      module: '',
      action: '',
      label: id,
      params: {
        iterations: { value: 2 },
        max_iterations: { value: 10 },
        carry: { value: true },
        collect: { value: true },
        max_retries: { value: 1 },
      },
    },
  });
  const control = (id, action, parentId) => ({
    id,
    type: 'custom',
    parentId,
    position: { x: 20, y: 60 },
    data: {
      type: 'custom',
      module: 'modules.WorkflowControl',
      action,
      label: action,
      params: {
        ...(action === 'LoopIndex'
          ? { index_value: { value: 0 }, iteration_count: { value: 1 }, index: { display: 'output' } }
          : {
              value_input: { display: 'input' },
              stop_input: { display: 'input', value: false },
              value: { display: 'output' },
            }),
      },
    },
  });
  const outer = loopNode('outer');
  const inner = loopNode('inner', 'outer');
  const outerIndex = control('outer-index', 'LoopIndex', 'outer');
  const innerIndex = control('inner-index', 'LoopIndex', 'inner');
  const innerResult = control('inner-result', 'LoopResult', 'inner');
  const outerResult = control('outer-result', 'LoopResult', 'outer');
  const graph = exportModule.buildApiGraphExport({
    nodes: [outer, inner, outerIndex, innerIndex, innerResult, outerResult],
    edges: [
      {
        id: 'inner-value',
        source: 'inner-index',
        sourceHandle: 'index',
        target: 'inner-result',
        targetHandle: 'value_input',
      },
      {
        id: 'outer-value',
        source: 'inner-result',
        sourceHandle: 'value',
        target: 'outer-result',
        targetHandle: 'value_input',
      },
    ],
    sid: 'nested-loop-session',
    setParam: () => {},
  });

  const outerExport = graph.loops.find((loop) => loop.id === 'outer');
  const innerExport = graph.loops.find((loop) => loop.id === 'inner');
  assert.deepEqual(
    new Set(outerExport.bodyNodeIds),
    new Set(['outer-index', 'inner-index', 'inner-result', 'outer-result']),
  );
  assert.deepEqual(innerExport.bodyNodeIds, ['inner-index', 'inner-result']);
  assert.equal(innerExport.parentLoopId, 'outer');
});

test('collapsed user blocks inside loops retain loop ancestry when expanded for execution', () => {
  const loop = {
    id: 'loop-container',
    type: 'loop',
    position: { x: 0, y: 0 },
    data: {
      type: 'loop',
      module: '',
      action: '',
      label: 'Loop',
      params: {
        iterations: { value: 2 },
        max_iterations: { value: 10 },
        carry: { value: true },
        collect: { value: true },
        max_retries: { value: 1 },
      },
    },
  };
  const result = {
    id: 'loop-result',
    type: 'custom',
    parentId: 'loop-container',
    position: { x: 20, y: 60 },
    data: {
      type: 'custom',
      module: 'modules.WorkflowControl',
      action: 'LoopResult',
      label: 'Loop Result',
      params: {
        value_input: { display: 'input' },
        stop_input: { display: 'input', value: false },
        value: { display: 'output' },
      },
    },
  };
  const definition = {
    id: 'reusable-step',
    name: 'Reusable step',
    version: 1,
    nodes: [
      {
        id: 'generate',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          label: 'Generate',
          category: 'Test',
          params: {},
        },
      },
    ],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const block = userBlocksModule.createUserBlockNode(definition, { x: 100, y: 100 }, 'block-step');
  block.parentId = 'loop-container';

  const expanded = userBlocksModule.expandUserBlockGraph([loop, block, result], [], []);
  const expandedChild = expanded.nodes.find((node) => node.id === 'block-step__generate');
  assert.equal(expandedChild?.parentId, 'loop-container');

  const graph = exportModule.buildApiGraphExport({
    nodes: expanded.nodes,
    edges: expanded.edges,
    sid: 'block-loop-session',
    setParam: () => {},
  });
  assert.deepEqual(new Set(graph.loops[0].bodyNodeIds), new Set(['block-step__generate', 'loop-result']));
});
