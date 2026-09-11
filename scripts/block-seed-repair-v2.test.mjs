import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, schema, runtime, repair, fixer;
before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  repair = await server.ssrLoadModule('/src/studio/blockSeedRepairV2.ts');
  fixer = {
    ...(await server.ssrLoadModule('/src/studio/graphFixer.ts')),
    ...(await server.ssrLoadModule('/src/studio/graphFixMaterialization.ts')),
  };
});
after(async () => server?.close());

function contracts() {
  return ['prepare', 'denoise'].map((id) => ({
    schemaVersion: 1,
    provider: 'diffusers',
    id: `upstream:${id}`,
    className: `${id}Step`,
    kind: 'block',
    contentHash: `upstream-contract:${id}`,
    description: '',
    inputs:
      id === 'prepare'
        ? [{ name: 'generator', type: 'Generator', required: false, default: null, description: '', kwargsType: null }]
        : [],
    variadicInputs: [],
    requiredInputs: [],
    outputs: [],
    components: [],
    configs: [],
  }));
}
function fixture() {
  const nodes = ['prepare', 'denoise'].map((id) => ({
    nodeId: id,
    nodeType: 'custom',
    data: {
      type: 'custom',
      module: 'modules.ModularDiffusers',
      action: 'ReviewedModularWorkflowStep',
      label: id,
      params: {
        state_in: { type: 'PIPELINE_STATE', display: 'input' },
        state_out: { type: 'PIPELINE_STATE', display: 'output' },
        ...(id === 'denoise'
          ? {
              seed: { type: 'int', display: 'random', value: 37 },
              prompt: { type: 'string', display: 'textarea', value: 'Intricate brass astrolabe in a museum workshop' },
            }
          : {}),
      },
    },
    modularDiffusers: {
      kind: 'upstream_block',
      pipelineClass: 'ExamplePipeline',
      blocksClass: 'ExampleBlocks',
      workflowId: 'text2image',
      libraryRevision: 'a'.repeat(40),
      runtimeRole: id,
      blockDefinitionId: `upstream:${id}`,
      blockClass: `${id}Step`,
      blockKind: 'block',
      blockContractHash: `upstream-contract:${id}`,
      placementPath: [id],
      componentNames: [],
    },
  }));
  const graph = {
    nodes,
    edges: [
      {
        edgeId: 'state',
        sourceNodeId: 'prepare',
        sourcePortId: 'state_out',
        targetNodeId: 'denoise',
        targetPortId: 'state_in',
      },
    ],
    executionOrder: ['prepare', 'denoise'],
  };
  const definition = {
    schemaVersion: 2,
    definitionId: 'user:old-seed-routing',
    displayName: 'Historical seed mapping',
    source: { kind: 'user' },
    graph: { ...graph, graphHash: schema.blockGraphHashV2(graph) },
    boundary: {
      mode: 'explicit',
      inputs: [],
      outputs: [
        {
          portId: 'state',
          label: 'State',
          valueType: 'PIPELINE_STATE',
          required: false,
          binding: { nodeId: 'denoise', fieldOrPortId: 'state_out' },
        },
      ],
    },
    controls: [
      {
        controlId: 'seed',
        order: 0,
        label: 'Seed',
        valueType: 'int',
        defaultValue: 37,
        binding: { nodeId: 'denoise', fieldId: 'seed' },
      },
    ],
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  definition.contentHash = schema.blockDefinitionContentHashV2(definition);
  return runtime.setBlockInstanceValueV2(
    schema.createBlockInstanceV2(definition, {
      instanceId: 'old-seed-instance',
      position: { x: 90, y: 170 },
      size: { width: 430, height: 540 },
    }),
    'seed',
    20260906,
  );
}

test('exact unused seed is diagnosed and its explicit repair preserves values, snapshots and geometry', () => {
  const current = fixture(),
    before = structuredClone(current);
  assert.deepEqual(
    repair
      .inspectBlockSeedBindingsV2(current, contracts())
      .map(({ nodeId, consumerNodeId, canRepair }) => ({ nodeId, consumerNodeId, canRepair })),
    [{ nodeId: 'denoise', consumerNodeId: 'prepare', canRepair: true }],
  );
  const next = repair.repairBlockSeedBindingV2(current, 'denoise', contracts());
  assert.deepEqual(current, before);
  assert.deepEqual(next.definitionSnapshot, before.definitionSnapshot);
  assert.deepEqual(next.definitionRef, before.definitionRef);
  assert.deepEqual(next.values, before.values);
  assert.deepEqual(next.presentation, before.presentation);
  assert.deepEqual(next.effectiveInterface.controls[0].binding, { nodeId: 'prepare', fieldId: 'seed' });
  assert.equal(next.effectiveGraph.nodes[1].data.params.seed, undefined);
  assert.deepEqual(next.effectiveGraph.nodes[0].data.params.seed, before.effectiveGraph.nodes[1].data.params.seed);
  assert.deepEqual(next.effectiveGraph.nodes[1].data.params.prompt, before.effectiveGraph.nodes[1].data.params.prompt);
  assert.deepEqual(next.effectiveGraph.edges, before.effectiveGraph.edges);
  assert.deepEqual(next.effectiveGraph.executionOrder, before.effectiveGraph.executionOrder);
  assert.deepEqual(repair.inspectBlockSeedBindingsV2(next, contracts()), []);
  assert.equal(next.customization.state, 'structure_changed');
  assert.doesNotThrow(() => schema.normalizeBlockInstanceV2(next));
});

test('repair follows actual state ancestry, never an unrelated generator in display order', () => {
  const current = fixture();
  const graph = structuredClone(current.effectiveGraph);
  graph.edges = [];
  const disconnected = runtime.replaceBlockEffectiveGraphV2(current, graph);
  assert.equal(repair.inspectBlockSeedBindingsV2(disconnected, contracts())[0].canRepair, false);
  assert.throws(
    () => repair.repairBlockSeedBindingV2(disconnected, 'denoise', contracts()),
    /consumer|ancestry|connected/i,
  );
});

test('sealed controls and already seeded consumers are never silently rebound or overwritten', () => {
  const current = fixture();
  const definition = structuredClone(current.definitionSnapshot);
  definition.controls[0].sealed = true;
  definition.contentHash = schema.blockDefinitionContentHashV2(definition);
  const sealed = schema.createBlockInstanceV2(definition, {
    instanceId: 'sealed-seed',
    position: { x: 0, y: 0 },
    size: { width: 400, height: 400 },
  });
  assert.throws(() => repair.repairBlockSeedBindingV2(sealed, 'denoise', contracts()), /sealed/i);
  const graph = structuredClone(current.effectiveGraph);
  graph.nodes[0].data.params.seed = { type: 'int', value: 123 };
  const occupied = runtime.replaceBlockEffectiveGraphV2(current, graph);
  assert.throws(() => repair.repairBlockSeedBindingV2(occupied, 'denoise', contracts()), /already|seed/i);
});

test('stale or absent upstream contracts cannot authorize a repair', () => {
  const current = fixture();
  const stale = contracts();
  stale[0].contentHash = 'different-contract';
  assert.throws(() => repair.repairBlockSeedBindingV2(current, 'denoise', stale));
  assert.throws(() => repair.repairBlockSeedBindingV2(current, 'denoise', []));
});

test('incoming seed wires and public seed sockets keep their identity and exact value source', () => {
  let current = fixture();
  const graph = structuredClone(current.effectiveGraph);
  graph.nodes.push({
    nodeId: 'number',
    nodeType: 'custom',
    data: {
      type: 'custom',
      module: 'modules.Primitive',
      action: 'Integer',
      params: { output: { type: 'int', display: 'output', value: 987 } },
    },
  });
  graph.executionOrder.unshift('number');
  graph.edges.push({
    edgeId: 'wired-seed',
    sourceNodeId: 'number',
    sourcePortId: 'output',
    targetNodeId: 'denoise',
    targetPortId: 'seed',
  });
  current = runtime.replaceBlockEffectiveGraphV2(current, graph);
  const boundary = structuredClone(current.effectiveInterface.boundary);
  boundary.inputs.push({
    portId: 'seed-input',
    label: 'Connected seed',
    valueType: 'int',
    required: false,
    binding: { nodeId: 'denoise', fieldOrPortId: 'seed' },
  });
  current = runtime.replaceBlockEffectiveInterfaceV2(current, {
    boundary,
    controls: current.effectiveInterface.controls,
  });
  const next = repair.repairBlockSeedBindingV2(current, 'denoise', contracts());
  assert.deepEqual(
    next.effectiveGraph.edges.find(({ edgeId }) => edgeId === 'wired-seed'),
    {
      edgeId: 'wired-seed',
      sourceNodeId: 'number',
      sourcePortId: 'output',
      targetNodeId: 'prepare',
      targetPortId: 'seed',
    },
  );
  assert.deepEqual(next.effectiveInterface.boundary.inputs[0], {
    ...boundary.inputs[0],
    binding: { nodeId: 'prepare', fieldOrPortId: 'seed' },
  });
  assert.deepEqual(next.values, current.values);
});

test('Fix is an explicit choice, materializes atomically and revalidates the exact contract at apply time', () => {
  const current = fixture();
  const context = {
    nodes: [runtime.createBlockRootNodeV2(current)],
    edges: [],
    registry: {},
    modularBlockDefinitions: contracts(),
  };
  const before = structuredClone(context.nodes);
  const plan = fixer.buildGraphFixPlan(context);
  const issue = plan.issues.find((entry) => entry.kind === 'block_seed');
  assert.ok(issue);
  assert.equal(issue.candidates[0].confidence, 'choice');
  const result = fixer.materializeGraphFixes(context, issue.candidates);
  assert.deepEqual(context.nodes, before);
  assert.deepEqual(result.nodes[0].data.blockInstanceV2.values, current.values);
  assert.ok(
    !fixer.buildGraphFixPlan({ ...context, nodes: result.nodes }).issues.some((entry) => entry.kind === 'block_seed'),
  );
  assert.throws(
    () => fixer.materializeGraphFixes({ ...context, modularBlockDefinitions: [] }, issue.candidates),
    /exact reviewed/,
  );
  assert.deepEqual(context.nodes, before);
});

test('one initializer is selected from multiple connected Generator consumers, never mirrored', () => {
  const current = fixture();
  const graph = structuredClone(current.effectiveGraph);
  const middle = structuredClone(graph.nodes[0]);
  middle.nodeId = 'middle';
  middle.modularDiffusers.placementPath = ['middle'];
  graph.nodes.splice(1, 0, middle);
  graph.edges[0].targetNodeId = 'middle';
  graph.edges.push({
    edgeId: 'middle-state',
    sourceNodeId: 'middle',
    sourcePortId: 'state_out',
    targetNodeId: 'denoise',
    targetPortId: 'state_in',
  });
  graph.executionOrder.splice(1, 0, 'middle');
  const next = repair.repairBlockSeedBindingV2(
    runtime.replaceBlockEffectiveGraphV2(current, graph),
    'denoise',
    contracts(),
  );
  assert.equal(next.effectiveInterface.controls[0].binding.nodeId, 'prepare');
  assert.deepEqual(
    next.effectiveGraph.nodes.filter((node) => node.data.params.seed).map((node) => node.nodeId),
    ['prepare'],
  );
});

test('local controls cannot be repaired by silently crossing their owning subtree', () => {
  const current = fixture();
  const graph = structuredClone(current.effectiveGraph);
  graph.nodes.push({
    nodeId: 'stage',
    nodeType: 'group',
    data: { type: 'group', params: {} },
    containerInterface: {
      schemaVersion: 1,
      boundary: { mode: 'explicit', inputs: [], outputs: [] },
      controls: [{ ...current.effectiveInterface.controls[0], controlId: 'local-seed' }],
    },
  });
  graph.nodes[1].parentNodeId = 'stage';
  delete graph.nodes.at(-1).containerInterface.controls[0].defaultValue;
  graph.nodes.at(-1).containerInterface.boundary.inputs.push({
    portId: 'state',
    label: 'State',
    valueType: 'PIPELINE_STATE',
    required: false,
    binding: { nodeId: 'denoise', fieldOrPortId: 'state_in' },
  });
  graph.executionOrder.unshift('stage');
  const scoped = runtime.replaceBlockEffectiveGraphV2(current, graph);
  const issue = repair.inspectBlockSeedBindingsV2(scoped, contracts())[0];
  assert.equal(issue.canRepair, false);
  assert.throws(() => repair.repairBlockSeedBindingV2(scoped, 'denoise', contracts()), /local interface/);
});
