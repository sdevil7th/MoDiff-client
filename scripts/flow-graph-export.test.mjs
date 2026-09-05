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
    server: { middlewareMode: true, watch: null },
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
    const generatedSeed = 2_147_483_648;

    assert.deepEqual(seed, {
      display: 'random',
      value: generatedSeed,
    });
    assert.deepEqual(updates, [['generate', 'seed', { value: generatedSeed, isRandom: true }]]);
  } finally {
    Math.random = originalRandom;
  }
});

test('random-on-export values respect backend field bounds', () => {
  const originalRandom = Math.random;
  Math.random = () => 0.999_999_999_999;

  try {
    const seed = exportSeed({ value: 1234, isRandom: true });

    assert.equal(Number.isSafeInteger(seed.value), true);
    assert.equal(seed.value >= 0 && seed.value <= 4_294_967_295, true);
  } finally {
    Math.random = originalRandom;
  }
});

test('managed Studio seed consumers share one materialized random seed per export', () => {
  const originalRandom = Math.random;
  const updates = [];
  let calls = 0;
  Math.random = () => (calls++ === 0 ? 0.25 : 0.75);

  try {
    const managedSeedNode = (id, studioRole) => ({
      ...seedNode({ value: 42, isRandom: true }),
      id,
      data: {
        ...seedNode({ value: 42, isRandom: true }).data,
        studioOwned: true,
        studioRole,
      },
    });
    const graph = exportModule.buildApiGraphExport({
      nodes: [managedSeedNode('encode', 'imageEncode'), managedSeedNode('denoise', 'denoise')],
      edges: [],
      sid: 'managed-studio-seed-session',
      setParam: (...args) => updates.push(args),
    });
    const expected = 1_073_741_824;

    assert.equal(graph.nodes.encode.params.seed.value, expected);
    assert.equal(graph.nodes.denoise.params.seed.value, expected);
    assert.equal(calls, 1);
    assert.deepEqual(updates, [
      ['encode', 'seed', { value: expected, isRandom: true }],
      ['denoise', 'seed', { value: expected, isRandom: true }],
    ]);
  } finally {
    Math.random = originalRandom;
  }
});

test('manual random seed nodes remain independent', () => {
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => (calls++ === 0 ? 0.25 : 0.75);

  try {
    const first = seedNode({ value: 42, isRandom: true });
    first.id = 'first';
    const second = seedNode({ value: 42, isRandom: true });
    second.id = 'second';
    const graph = exportModule.buildApiGraphExport({
      nodes: [first, second],
      edges: [],
      sid: 'manual-independent-seed-session',
      setParam: () => {},
    });

    assert.equal(graph.nodes.first.params.seed.value, 1_073_741_824);
    assert.equal(graph.nodes.second.params.seed.value, 3_221_225_472);
    assert.equal(calls, 2);
  } finally {
    Math.random = originalRandom;
  }
});

test('graph export materializes untouched backend defaults without replacing explicit empty values', () => {
  const exactModel = {
    source: 'hub',
    value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
    revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
  };
  const graph = exportModule.buildApiGraphExport({
    nodes: [
      {
        id: 'upscaler',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Video',
          action: 'UpscaleVideo',
          params: {
            model_id: { type: 'string', default: exactModel },
            tile_overlap: { type: 'int', default: 0 },
            optional_label: { type: 'string', value: '', default: 'backend label' },
          },
        },
      },
    ],
    edges: [],
    sid: 'default-export-session',
    setParam: () => {},
  });
  const serialized = JSON.parse(JSON.stringify(graph));

  assert.deepEqual(serialized.nodes.upscaler.params.model_id.value, exactModel);
  assert.equal(serialized.nodes.upscaler.params.tile_overlap.value, 0);
  assert.equal(serialized.nodes.upscaler.params.optional_label.value, '');
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

test('graph export preserves a hidden opaque execution identity and ignores its transient output signal', () => {
  const identity = {
    version: 1,
    source: 'hub',
    repository: 'example/custom-modular',
    revision: 'a'.repeat(40),
    trust_remote_code: false,
    config_filename: 'modiff_pipeline_config.json',
    config_sha256: 'b'.repeat(64),
    execution_id: 'c'.repeat(64),
  };
  const graph = exportModule.buildApiGraphExport({
    nodes: [
      {
        id: 'custom-loader',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.ModularDiffusers',
          action: 'ModelsLoader',
          label: 'Models loader',
          params: {
            repository: { type: 'string', value: 'example/custom-modular' },
            modiff_pipeline_identity: { type: 'object', value: identity, hidden: true },
            components: {
              type: 'Components',
              display: 'output',
              signal: { direction: 'output', origin: 'modiff_pipeline_identity', value: identity },
            },
          },
        },
      },
    ],
    edges: [],
    sid: 'opaque-identity-session',
    setParam: () => {},
  });

  assert.deepEqual(graph.nodes['custom-loader'].params.modiff_pipeline_identity.value, identity);
  assert.equal(graph.nodes['custom-loader'].params.modiff_pipeline_identity.display, undefined);
  assert.equal(graph.nodes['custom-loader'].params.components, undefined);
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
        durable: { value: true },
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
      durable: true,
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
