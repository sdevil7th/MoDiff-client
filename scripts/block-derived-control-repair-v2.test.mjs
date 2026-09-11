import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, schema, runtime, repair, ownership, fixer;
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
  repair = {
    ...(await server.ssrLoadModule('/src/studio/blockDerivedControlRepairV2.ts')),
    ...(await server.ssrLoadModule('/src/studio/blockDerivedControlMutationV2.ts')),
  };
  ownership = await server.ssrLoadModule('/src/studio/reviewedControlOwnershipV2.ts');
  fixer = {
    ...(await server.ssrLoadModule('/src/studio/graphFixer.ts')),
    ...(await server.ssrLoadModule('/src/studio/graphFixMaterialization.ts')),
  };
});
after(async () => server?.close());
const field = {
  name: 'num_inference_steps',
  type: 'builtins.int',
  required: true,
  default: 50,
  description: '',
  kwargsType: null,
};
function contracts() {
  return ['scheduler', 'bridge', 'loop'].map((id) => ({
    id,
    className: `${id}Step`,
    kind: id === 'loop' ? 'loop' : 'block',
    contentHash: `exact:${id}`,
    description: '',
    inputs: id === 'bridge' ? [] : [field],
    outputs: id === 'scheduler' ? [field] : [],
    variadicInputs: [],
    requiredInputs: [],
    components: [],
    configs: [],
  }));
}
function fixture() {
  const nodes = contracts().map((contract) => ({
    nodeId: contract.id,
    nodeType: 'custom',
    data: {
      type: 'custom',
      module: 'modules.ModularDiffusers',
      action: 'ReviewedModularWorkflowStep',
      label: contract.id,
      params: {
        state_in: { type: 'PIPELINE_STATE', display: 'input' },
        state_out: { type: 'PIPELINE_STATE', display: 'output' },
        ...(contract.id !== 'bridge' ? { num_inference_steps: { type: 'int', default: 50 } } : {}),
        ...(contract.id === 'loop'
          ? { prompt: { type: 'string', value: 'Intricate ceramic miniature interior' } }
          : {}),
      },
    },
    modularDiffusers: {
      kind: 'upstream_block',
      pipelineClass: 'ExamplePipeline',
      blocksClass: 'ExampleBlocks',
      workflowId: 'image2image',
      libraryRevision: 'a'.repeat(40),
      runtimeRole: contract.id,
      blockDefinitionId: contract.id,
      blockClass: contract.className,
      blockKind: contract.kind,
      blockContractHash: contract.contentHash,
      placementPath: [contract.id],
      componentNames: [],
    },
  }));
  const graph = {
    nodes,
    edges: ['scheduler', 'bridge'].map((id, index) => ({
      edgeId: `state-${index}`,
      sourceNodeId: id,
      sourcePortId: 'state_out',
      targetNodeId: nodes[index + 1].nodeId,
      targetPortId: 'state_in',
    })),
    executionOrder: nodes.map((node) => node.nodeId),
  };
  const definition = {
    schemaVersion: 2,
    definitionId: 'user:historical-count',
    displayName: 'Historical mirrored count',
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
          binding: { nodeId: 'loop', fieldOrPortId: 'state_out' },
        },
      ],
    },
    controls: [
      {
        controlId: 'steps',
        label: 'Steps',
        order: 0,
        valueType: 'int',
        defaultValue: 50,
        binding: { nodeId: 'loop', fieldId: field.name },
        mirrorBindings: [{ nodeId: 'scheduler', fieldId: field.name }],
      },
    ],
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  definition.contentHash = schema.blockDefinitionContentHashV2(definition);
  return runtime.setBlockInstanceValueV2(
    schema.createBlockInstanceV2(definition, {
      instanceId: 'historical-count-instance',
      position: { x: 120, y: 240 },
      size: { width: 430, height: 600 },
    }),
    'steps',
    37,
  );
}

test('caller fan-out stops at the first exact input/output writer, excluding nested loop members', () => {
  const placements = contracts().map((block, order) => ({ block, placement: { path: [block.id], order } }));
  placements.push({ block: contracts()[2], placement: { path: ['loop', 'member'], order: 0 } });
  assert.deepEqual(
    ownership.reviewedCallerInputOwnersV2(placements, field.name).map(({ block }) => block.id),
    ['scheduler'],
  );
  assert.equal(ownership.reviewedCallerInputOwnersV2(placements, 'width'), null);
  placements[0].block.outputs = [];
  assert.equal(ownership.reviewedCallerInputOwnersV2(placements, field.name), null);
});

test('explicit repair preserves requested values, immutable definitions, geometry and state wires', () => {
  const current = fixture(),
    before = structuredClone(current);
  const issues = repair.inspectBlockDerivedControlsV2(current, contracts());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].canRepair, true);
  assert.equal(issues[0].writerNodeId, 'scheduler');
  const next = repair.repairBlockDerivedControlV2(current, 'loop', field.name, contracts());
  assert.deepEqual(current, before);
  for (const key of ['definitionSnapshot', 'definitionRef', 'values', 'presentation'])
    assert.deepEqual(next[key], before[key]);
  assert.deepEqual(next.effectiveGraph.edges, before.effectiveGraph.edges);
  assert.deepEqual(next.effectiveGraph.nodes[2].data.params.prompt, before.effectiveGraph.nodes[2].data.params.prompt);
  assert.equal(next.effectiveGraph.nodes[2].data.params.num_inference_steps, undefined);
  assert.deepEqual(next.effectiveInterface.controls[0].binding, { nodeId: 'scheduler', fieldId: field.name });
  assert.equal(next.effectiveInterface.controls[0].mirrorBindings, undefined);
  assert.deepEqual(repair.inspectBlockDerivedControlsV2(next, contracts()), []);
  assert.equal(next.customization.state, 'structure_changed');
  assert.doesNotThrow(() => schema.normalizeBlockInstanceV2(next));
});

test('sealed control and explicit field wires prevent a guessed repair', () => {
  const sealed = fixture();
  sealed.effectiveInterface.controls[0].sealed = true;
  assert.equal(repair.inspectBlockDerivedControlsV2(sealed, contracts())[0].canRepair, false);
  const wired = fixture();
  wired.effectiveGraph.edges.push({
    edgeId: 'explicit-override',
    sourceNodeId: 'scheduler',
    sourcePortId: 'state_out',
    targetNodeId: 'loop',
    targetPortId: field.name,
  });
  assert.equal(repair.inspectBlockDerivedControlsV2(wired, contracts())[0].canRepair, false);
});

test('disconnected, cyclic or differently pinned ancestry never produces a guessed writer', () => {
  const disconnected = fixture();
  disconnected.effectiveGraph.edges = [];
  assert.deepEqual(repair.inspectBlockDerivedControlsV2(disconnected, contracts()), []);
  const changed = fixture();
  changed.effectiveGraph.nodes[1].modularDiffusers.libraryRevision = 'b'.repeat(40);
  assert.deepEqual(repair.inspectBlockDerivedControlsV2(changed, contracts()), []);
  const cyclic = fixture();
  cyclic.effectiveGraph.edges[0].sourceNodeId = 'loop';
  assert.deepEqual(repair.inspectBlockDerivedControlsV2(cyclic, contracts()), []);
});

test('independent downstream controls are retained, not relabeled as broken mirrors', () => {
  const independent = fixture();
  independent.effectiveInterface.controls[0].mirrorBindings = [];
  assert.deepEqual(repair.inspectBlockDerivedControlsV2(independent, contracts()), []);
});

test('Graph Fix offers an explicit atomic repair and refuses stale contracts at apply time', () => {
  const current = fixture();
  const context = {
    nodes: [runtime.createBlockRootNodeV2(current)],
    edges: [],
    registry: {},
    modularBlockDefinitions: contracts(),
  };
  const before = structuredClone(context.nodes);
  const issue = fixer.buildGraphFixPlan(context).issues.find((issue) => issue.kind === 'block_derived_control');
  assert.ok(issue);
  assert.equal(issue.candidates[0].confidence, 'choice');
  const result = fixer.materializeGraphFixes(context, issue.candidates);
  assert.deepEqual(context.nodes, before);
  assert.deepEqual(result.nodes[0].data.blockInstanceV2.values, current.values);
  assert.deepEqual(repair.inspectBlockDerivedControlsV2(result.nodes[0].data.blockInstanceV2, contracts()), []);
  assert.throws(
    () => fixer.materializeGraphFixes({ ...context, modularBlockDefinitions: [] }, issue.candidates),
    /exact|verified/,
  );
  assert.deepEqual(context.nodes, before);
});

test('multiple state writers repair in either order without changing the shared caller value', () => {
  const definitions = contracts();
  definitions[1].inputs = [field];
  definitions[1].outputs = [field];
  const definition = structuredClone(fixture().definitionSnapshot);
  definition.graph.nodes[1].data.params.num_inference_steps = { type: 'int', default: 50 };
  definition.controls[0].mirrorBindings = [
    { nodeId: 'bridge', fieldId: field.name },
    { nodeId: 'scheduler', fieldId: field.name },
  ];
  definition.graph.graphHash = schema.blockGraphHashV2(definition.graph);
  definition.contentHash = schema.blockDefinitionContentHashV2(definition);
  const current = runtime.setBlockInstanceValueV2(
    schema.createBlockInstanceV2(definition, {
      instanceId: 'multi-writer',
      position: { x: 120, y: 240 },
      size: { width: 430, height: 600 },
    }),
    'steps',
    37,
  );
  const before = structuredClone(current);
  const results = [];
  for (const order of [
    ['bridge', 'loop'],
    ['loop', 'bridge'],
  ]) {
    let next = current;
    for (const id of order) next = repair.repairBlockDerivedControlV2(next, id, field.name, definitions);
    assert.deepEqual(repair.inspectBlockDerivedControlsV2(next, definitions), []);
    assert.equal(next.values.steps, 37);
    assert.deepEqual(next.definitionSnapshot, before.definitionSnapshot);
    assert.deepEqual(next.effectiveGraph.edges, before.effectiveGraph.edges);
    assert.deepEqual(next.effectiveInterface.controls[0].binding, { nodeId: 'scheduler', fieldId: field.name });
    results.push(next);
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(current, before);
});
