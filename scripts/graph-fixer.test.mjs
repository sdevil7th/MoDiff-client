import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let graphFixer;
let blockSchema;
let blockRuntime;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  graphFixer = {
    ...(await server.ssrLoadModule('/src/studio/graphFixer.ts')),
    ...(await server.ssrLoadModule('/src/studio/graphFixMaterialization.ts')),
  };
  blockSchema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  blockRuntime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
});

after(async () => {
  await server?.close();
});

function definition(module, action, label, params, category = 'Test') {
  return { type: 'custom', module, action, label, category, params };
}

function node(id, data, x = 0, y = 0) {
  return { id, type: 'custom', position: { x, y }, data: structuredClone(data) };
}

function edge(id, source, sourceHandle, target, targetHandle) {
  return { id, source, sourceHandle, target, targetHandle, type: 'default' };
}

function blockV2Node(instanceId = 'v2-image-block', referenceDisplay = 'input') {
  const semanticGraph = {
    nodes: [
      {
        nodeId: 'generate',
        nodeType: 'custom',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          label: 'Generate',
          params: {
            reference: { display: referenceDisplay, type: 'image', label: 'Reference', required: true },
            image: { display: 'output', type: 'image', label: 'Image' },
          },
        },
      },
    ],
    edges: [],
    executionOrder: ['generate'],
  };
  const graph = { ...semanticGraph, graphHash: blockSchema.blockGraphHashV2(semanticGraph) };
  const withoutHash = {
    schemaVersion: 2,
    definitionId: 'diffusers:test:image',
    displayName: 'Diffusers image block',
    source: {
      kind: 'diffusers_catalog',
      catalogCategory: 'diffusers',
      provider: 'diffusers',
      library: 'diffusers',
      libraryRevision: 'test-revision',
      pipelineClass: 'TestPipeline',
      workflow: 'text2image',
      manifestDefinitionId: 'manifest:test:image',
      manifestContentHash: 'manifest-hash',
    },
    graph,
    boundary: {
      mode: 'explicit',
      inputs: [
        {
          portId: 'reference',
          label: 'Reference',
          valueType: 'image',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'reference' },
        },
      ],
      outputs: [
        {
          portId: 'image',
          label: 'Image',
          valueType: 'image',
          required: false,
          binding: { nodeId: 'generate', fieldOrPortId: 'image' },
        },
      ],
    },
    controls: [],
    previews: [{ nodeId: 'generate', outputPortId: 'image', mediaType: 'image', primary: true }],
    ownership: { kind: 'registered', definitionMutable: false },
  };
  const definitionV2 = {
    ...withoutHash,
    contentHash: blockSchema.blockDefinitionContentHashV2(withoutHash),
  };
  const instance = blockSchema.createBlockInstanceV2(definitionV2, {
    instanceId,
    position: { x: 0, y: 0 },
    size: { width: 360, height: 420 },
  });
  return blockRuntime.createBlockRootNodeV2(instance);
}

const imageSource = definition('modules.Test', 'GenerateImage', 'Generate image', {
  image: { display: 'output', type: 'image', label: 'Image' },
});
const imagePreview = definition('modules.Image', 'Preview', 'Preview image', {
  image: { display: 'input', type: 'image', label: 'Image', required: true },
});

test('a missing required Block media input offers targeted navigation, never an invented mask or mutation', () => {
  const root = blockV2Node();
  const before = structuredClone(root);
  const plan = graphFixer.buildGraphFixPlan({
    nodes: [root],
    edges: [],
    registry: {},
    readinessIssues: [
      {
        id: 'missing-mask',
        code: 'block_media_input_missing',
        category: 'asset',
        severity: 'error',
        blocking: true,
        nodeId: root.id,
        fieldId: 'reference',
        action: 'inspect_node',
        message: 'Choose Reference before running.',
        details: 'Required media input reference is empty.',
      },
    ],
  });
  const issue = plan.issues.find((item) => item.kind === 'missing_media');
  assert.equal(issue.targetNodeId, root.id);
  assert.equal(issue.targetHandle, 'reference');
  assert.equal(issue.candidates.length, 1);
  assert.deepEqual(issue.candidates[0].operations, [{ kind: 'external', action: 'inspect_node', nodeId: root.id }]);
  assert.deepEqual(root, before);
});

test('distinct required media findings inside a collapsed Block retain unique Fix identities', () => {
  const root = blockV2Node();
  const readinessIssues = ['image', 'mask_image'].map((field) => ({
    id: `operation-media-input-missing:internal-encode:${field}`,
    code: 'operation_media_input_missing',
    category: 'asset',
    severity: 'error',
    blocking: true,
    nodeId: root.id,
    action: 'inspect_node',
    message: `Connect ${field} before running.`,
  }));
  const plan = graphFixer.buildGraphFixPlan({ nodes: [root], edges: [], registry: {}, readinessIssues });
  const issues = plan.issues.filter((i) => i.kind === 'missing_media');
  assert.equal(issues.length, 2);
  assert.equal(new Set(issues.map((i) => i.id)).size, 2);
  assert.equal(new Set(issues.flatMap((i) => i.candidates.map((c) => c.id))).size, 2);
  assert.ok(issues.every((i) => i.targetNodeId === root.id && i.targetHandle === undefined));
});

test('editable Block boundary controls do not receive mandatory connection repairs for blank values', () => {
  const catalog = JSON.parse(
    gunzipSync(readFileSync(path.resolve(ROOT, '../MoDiff/modiff/registered_block_v2_catalog.v1.json.gz'))),
  );
  const entry = catalog.entries.find(
    ({ definition }) => definition.source.manifestDefinitionId === 'diffusers.composite:FluxFillPipeline:outpaint',
  );
  assert.ok(entry);
  let instance = blockSchema.createBlockInstanceV2(entry.definition, {
    instanceId: 'required-fill-controls',
    position: { x: 0, y: 0 },
    size: { width: 360, height: 420 },
  });
  for (const [key, value] of Object.entries(entry.values))
    instance = blockRuntime.setBlockInstanceValueV2(instance, key, value);
  const root = blockRuntime.createBlockRootNodeV2(instance);
  const opaqueSource = definition('modules.Test', 'Configuration', 'Unrelated configuration', {
    value: { display: 'output', type: 'any', label: 'Configuration' },
  });
  const plan = graphFixer.buildGraphFixPlan({
    nodes: [root],
    edges: [],
    registry: { 'modules.Test.GenerateImage': imageSource, 'modules.Test.Configuration': opaqueSource },
  });
  assert.deepEqual(
    plan.issues.filter(
      (item) => item.kind === 'missing_input' && ['prompt', 'image', 'mask_image'].includes(item.targetHandle),
    ),
    [],
  );
});

test('adds and connects a compatible output node', () => {
  const source = node('source', imageSource, 0, 0);
  const registry = { 'modules.Image.Preview': imagePreview };
  const plan = graphFixer.buildGraphFixPlan({ nodes: [source], edges: [], registry });

  const outputIssue = plan.issues.find((issue) => issue.kind === 'missing_output');
  assert.ok(outputIssue);
  assert.equal(outputIssue.candidates[0].title, 'Add Preview image');

  const result = graphFixer.materializeGraphFixes(
    { nodes: [source], edges: [], registry },
    [outputIssue.candidates[0]],
    'smoothstep',
  );
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].source, 'source');
  assert.equal(result.edges[0].target, result.addedNodeIds[0]);
  assert.equal(result.edges[0].targetHandle, 'image');
  assert.equal(result.edges[0].type, 'smoothstep');
});

test('Fix recognizes an internal connected output in collapsed, expanded and saved V2 Blocks', () => {
  for (const expanded of [false, true]) {
    for (const connected of [false, true]) {
      const root = blockV2Node('nested-output');
      const graph = structuredClone(root.data.blockInstanceV2.effectiveGraph);
      graph.nodes.push({ nodeId: 'preview', nodeType: 'custom', data: imagePreview });
      if (connected)
        graph.edges.push({
          edgeId: 'to-preview',
          sourceNodeId: 'generate',
          sourcePortId: 'image',
          targetNodeId: 'preview',
          targetPortId: 'image',
        });
      const instance = blockRuntime.setBlockPresentationV2(
        blockRuntime.replaceBlockEffectiveGraphV2(root.data.blockInstanceV2, graph),
        { expanded },
      );
      const projection = blockRuntime.materializeBlockProjectionV2(blockRuntime.createBlockRootNodeV2(instance));
      const restored = JSON.parse(JSON.stringify(projection));
      const plan = graphFixer.buildGraphFixPlan({ ...restored, registry: { 'modules.Image.Preview': imagePreview } });
      assert.equal(
        plan.issues.some(({ kind }) => kind === 'missing_output'),
        !connected,
        `expanded=${expanded}, connected=${connected}`,
      );
      assert.deepEqual(restored, projection);
    }
  }
});

test('required inputs with explicit values or defaults do not receive spurious connection repairs', () => {
  const text = definition('modules.Test', 'Text', 'Text', { text: { display: 'output', type: 'string' } });
  const target = definition('modules.Test', 'Generate', 'Generate', {
    prompt: { display: 'input', type: 'string', required: true, value: 'An original song' },
    seed: { display: 'input', type: 'int', required: true, default: 0 },
    enabled: { display: 'input', type: 'bool', required: true, value: false },
  });
  const plan = graphFixer.buildGraphFixPlan({
    nodes: [node('text', text), node('generate', target)],
    edges: [],
    registry: {},
  });
  assert.equal(
    plan.issues.some((issue) => issue.kind === 'missing_input'),
    false,
  );
});

test('connects an existing compatible pipeline to a required input', () => {
  const loaderDefinition = definition('modules.Test', 'LoadPipeline', 'Load pipeline', {
    pipeline: { display: 'output', type: 'image_pipeline', label: 'Pipeline' },
  });
  const generateDefinition = definition('modules.Test', 'Generate', 'Generate', {
    pipeline: { display: 'input', type: 'image_pipeline', label: 'Pipeline', required: true },
    image: { display: 'output', type: 'image', label: 'Image' },
  });
  const loader = node('loader', loaderDefinition, -300, 0);
  const generate = node('generate', generateDefinition, 0, 0);
  const preview = node('preview', imagePreview, 300, 0);
  const edges = [edge('image-preview', 'generate', 'image', 'preview', 'image')];
  const plan = graphFixer.buildGraphFixPlan({ nodes: [loader, generate, preview], edges, registry: {} });

  const inputIssue = plan.issues.find((issue) => issue.kind === 'missing_input');
  assert.ok(inputIssue);
  assert.equal(inputIssue.candidates[0].title, 'Connect Load pipeline');
  assert.equal(inputIssue.candidates[0].confidence, 'safe');
});

test('Graph Fix treats BlockDefinitionV2 boundary ports as ordinary canvas sockets', () => {
  const source = node('source', imageSource, -300, 0);
  const block = blockV2Node();
  const preview = node('preview', imagePreview, 400, 0);
  const edges = [edge('block-preview', block.id, 'image', preview.id, 'image')];

  const plan = graphFixer.buildGraphFixPlan({ nodes: [source, block, preview], edges, registry: {} });
  const missingInput = plan.issues.find(
    (issue) => issue.kind === 'missing_input' && issue.targetNodeId === block.id && issue.targetHandle === 'reference',
  );

  assert.ok(missingInput);
  assert.equal(missingInput.candidates[0].title, 'Connect Generate image');
  const result = graphFixer.materializeGraphFixes({ nodes: [source, block, preview], edges, registry: {} }, [
    missingInput.candidates[0],
  ]);
  assert.equal(
    result.edges.some((item) => item.source === 'source' && item.target === block.id),
    true,
  );
  assert.deepEqual(result.nodes.find((item) => item.id === block.id).data.params, {});

  const repaired = graphFixer.buildGraphFixPlan({ nodes: result.nodes, edges: result.edges, registry: {} });
  assert.equal(
    repaired.issues.some((issue) => issue.targetNodeId === block.id),
    false,
  );
});

test('Graph Fix resolves projected boundary values from the execution authority', () => {
  const root = blockV2Node('valued-expanded-block', 'textarea');
  const instance = blockRuntime.setBlockPresentationV2(
    blockRuntime.setBlockInstanceValueV2(root.data.blockInstanceV2, 'reference', 'reference.png'),
    { expanded: true },
  );
  const projection = blockRuntime.materializeBlockProjectionV2(blockRuntime.createBlockRootNodeV2(instance));
  const before = structuredClone(projection);
  const plan = graphFixer.buildGraphFixPlan({ ...projection, registry: {} });
  assert.equal(
    plan.issues.some((issue) => issue.kind === 'missing_input'),
    false,
  );
  assert.deepEqual(projection, before, 'Fix inspection must not rewrite presentation or durable values');
});

test('Graph Fix never loops a Block public output back into its own output child', () => {
  const root = blockV2Node('internal-preview-block');
  const graph = structuredClone(root.data.blockInstanceV2.effectiveGraph);
  graph.nodes.push({ nodeId: 'preview', nodeType: 'custom', data: imagePreview });
  const instance = blockRuntime.setBlockPresentationV2(
    blockRuntime.replaceBlockEffectiveGraphV2(root.data.blockInstanceV2, graph),
    { expanded: true },
  );
  const projection = blockRuntime.materializeBlockProjectionV2(blockRuntime.createBlockRootNodeV2(instance));
  const plan = graphFixer.buildGraphFixPlan({ ...projection, registry: {} });
  const output = plan.issues.find((issue) => issue.kind === 'missing_output');
  assert.ok(output?.candidates.length);
  for (const candidate of output.candidates) {
    assert.equal(
      candidate.operations.some((op) => op.kind === 'connect' && op.source.nodeId === root.id),
      false,
    );
  }
  const before = structuredClone(projection);
  const repaired = graphFixer.materializeGraphFixes({ ...projection, registry: {} }, [output.candidates[0]]);
  assert.deepEqual(projection, before);
  const repairedRoot = repaired.nodes.find((node) => node.id === root.id);
  assert.ok(
    repairedRoot.data.blockInstanceV2.effectiveGraph.edges.some(
      (edge) => edge.sourceNodeId === 'generate' && edge.targetNodeId === 'preview',
    ),
  );
  assert.deepEqual(repairedRoot.data.blockInstanceV2.definitionSnapshot, instance.definitionSnapshot);
  assert.doesNotThrow(() => blockRuntime.expandBlockGraphV2ForExecution(repaired.nodes, repaired.edges));
  const removed = graphFixer.materializeGraphFixes({ ...repaired, registry: {} }, [
    {
      id: 'remove-internal',
      issueId: 'remove-internal',
      title: 'Disconnect',
      description: '',
      confidence: 'safe',
      operations: [{ kind: 'remove_edges', edgeIds: repaired.edges.map((edge) => edge.id) }],
    },
  ]);
  assert.equal(removed.nodes.find((node) => node.id === root.id).data.blockInstanceV2.effectiveGraph.edges.length, 0);
  assert.doesNotThrow(() => blockRuntime.expandBlockGraphV2ForExecution(removed.nodes, removed.edges));
});

test('Graph Fix offers an explicit reviewed-structure recovery and preserves compatible custom additions', () => {
  const original = blockV2Node('broken-v2-image-block');
  const graph = structuredClone(original.data.blockInstanceV2.effectiveGraph);
  delete graph.nodes.find(({ nodeId }) => nodeId === 'generate').data.params.reference;
  graph.nodes.push({
    nodeId: 'custom-note',
    nodeType: 'custom',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Note',
      label: 'Custom note',
      params: {},
    },
  });
  const brokenInstance = blockRuntime.replaceBlockEffectiveGraphV2(original.data.blockInstanceV2, graph);
  const broken = blockRuntime.createBlockRootNodeV2(brokenInstance);

  const plan = graphFixer.buildGraphFixPlan({ nodes: [broken], edges: [], registry: {} });
  const issue = plan.issues.find((candidate) => candidate.kind === 'block_structure');
  assert.ok(issue);
  assert.equal(issue.targetNodeId, broken.id);
  assert.equal(issue.candidates[0].confidence, 'choice');
  assert.equal(issue.candidates[0].title, 'Restore reviewed internal structure');

  const result = graphFixer.materializeGraphFixes({ nodes: [broken], edges: [], registry: {} }, [issue.candidates[0]]);
  const repaired = result.nodes.find(({ id }) => id === broken.id);
  assert.ok(repaired?.data.blockInstanceV2);
  assert.ok(
    repaired.data.blockInstanceV2.effectiveGraph.nodes.find(({ nodeId }) => nodeId === 'generate').data.params
      .reference,
  );
  assert.equal(
    repaired.data.blockInstanceV2.effectiveGraph.nodes.some(({ nodeId }) => nodeId === 'custom-note'),
    true,
  );
  assert.doesNotThrow(() => blockRuntime.expandBlockGraphV2ForExecution([repaired], []));
  assert.equal(
    graphFixer
      .buildGraphFixPlan({ nodes: [repaired], edges: [], registry: {} })
      .issues.some((candidate) => candidate.kind === 'block_structure'),
    false,
  );
});

test('Graph Fix targets the exact expanded internal node named by a structural error', () => {
  const original = blockV2Node('expanded-broken-v2-image-block');
  const graph = structuredClone(original.data.blockInstanceV2.effectiveGraph);
  delete graph.nodes.find(({ nodeId }) => nodeId === 'generate').data.params.reference;
  const brokenInstance = blockRuntime.setBlockPresentationV2(
    blockRuntime.replaceBlockEffectiveGraphV2(original.data.blockInstanceV2, graph),
    { expanded: true },
  );
  const projection = blockRuntime.materializeBlockProjectionV2(blockRuntime.createBlockRootNodeV2(brokenInstance));
  const internal = projection.nodes.find(({ data }) => data.blockProjectionNodeId === 'generate');
  const plan = graphFixer.buildGraphFixPlan({ nodes: projection.nodes, edges: projection.edges, registry: {} });
  const issue = plan.issues.find((candidate) => candidate.kind === 'block_structure');
  assert.ok(issue);
  assert.equal(issue.targetNodeId, internal.id);
  assert.equal(issue.candidates[0].targetNodeId, internal.id);
  assert.deepEqual(issue.candidates[0].operations, [{ kind: 'restore_block_structure', rootNodeId: original.id }]);
});

test('ranks a typed bridge for an incompatible connection', () => {
  const videoPreview = definition('modules.Video', 'Preview', 'Preview video', {
    video: { display: 'input', type: 'video', label: 'Video', required: true },
  });
  const converter = definition('modules.Test', 'Animate', 'Animate image', {
    image: { display: 'input', type: 'image', label: 'Image', required: true },
    video: { display: 'output', type: 'video', label: 'Video' },
  });
  const source = node('source', imageSource, 0, 0);
  const preview = node('preview', videoPreview, 600, 0);
  const edges = [edge('wrong', 'source', 'image', 'preview', 'video')];
  const registry = { 'modules.Test.Animate': converter };
  const plan = graphFixer.buildGraphFixPlan({ nodes: [source, preview], edges, registry });

  const mismatch = plan.issues.find((issue) => issue.kind === 'type_mismatch');
  assert.ok(mismatch);
  assert.equal(mismatch.candidates[0].title, 'Insert Animate image');
  const result = graphFixer.materializeGraphFixes({ nodes: [source, preview], edges, registry }, [
    mismatch.candidates[0],
  ]);
  assert.equal(result.nodes.length, 3);
  assert.equal(result.edges.length, 2);
  assert.equal(
    result.edges.some((item) => item.id === 'wrong'),
    false,
  );
});

test('routes missing models to the chooser without mutating the graph', () => {
  const source = node('source', imageSource);
  const preview = node('preview', imagePreview, 300, 0);
  const edges = [edge('valid', 'source', 'image', 'preview', 'image')];
  const readinessIssues = [
    {
      id: 'model',
      category: 'model',
      severity: 'error',
      blocking: true,
      nodeId: 'source',
      repoId: 'owner/model',
      message: 'owner/model is required.',
    },
  ];
  const plan = graphFixer.buildGraphFixPlan({ nodes: [source, preview], edges, registry: {}, readinessIssues });

  assert.equal(plan.issues.length, 1);
  assert.equal(plan.issues[0].kind, 'missing_model');
  const result = graphFixer.materializeGraphFixes({ nodes: [source, preview], edges, registry: {} }, [
    plan.issues[0].candidates[0],
  ]);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  assert.equal(result.externalActions[0].action, 'open_model_manager');
});

test('keeps Expert-mode model warnings actionable without making them blocking', () => {
  const source = node('source', imageSource);
  const preview = node('preview', imagePreview, 300, 0);
  const edges = [edge('valid', 'source', 'image', 'preview', 'image')];
  const readinessIssues = [
    {
      id: 'model-warning',
      category: 'model',
      severity: 'warning',
      blocking: false,
      nodeId: 'source',
      repoId: 'owner/model',
      message: 'owner/model is required.',
    },
  ];

  const plan = graphFixer.buildGraphFixPlan({ nodes: [source, preview], edges, registry: {}, readinessIssues });

  assert.equal(plan.issues.length, 1);
  assert.equal(plan.issues[0].kind, 'missing_model');
  assert.equal(plan.issues[0].candidates[0].operations[0].action, 'open_model_manager');
});

test('routes managed runtime mismatches to Setup before model repair', () => {
  const source = node('source', imageSource);
  const preview = node('preview', imagePreview, 300, 0);
  const edges = [edge('valid', 'source', 'image', 'preview', 'image')];
  const readinessIssues = [
    {
      id: 'runtime',
      category: 'environment',
      severity: 'error',
      blocking: true,
      action: 'open_setup',
      message: 'Requested amd-rocm-linux, but installed Torch resolves to nvidia-cuda.',
      details: 'python -m modiff.install --accelerator amd --repair',
    },
  ];

  const plan = graphFixer.buildGraphFixPlan({
    nodes: [source, preview],
    edges,
    registry: {},
    readinessIssues,
  });

  assert.equal(plan.issues.length, 1);
  assert.equal(plan.issues[0].kind, 'environment');
  assert.equal(plan.issues[0].candidates[0].title, 'Open Setup');
  const result = graphFixer.materializeGraphFixes({ nodes: [source, preview], edges, registry: {} }, [
    plan.issues[0].candidates[0],
  ]);
  assert.equal(result.nodes.length, 2);
  assert.equal(result.edges.length, 1);
  assert.equal(result.externalActions[0].action, 'open_setup');
});

test('deduplicates repeated readiness reports for the same prerequisite', () => {
  const source = node('source', imageSource);
  const preview = node('preview', imagePreview, 300, 0);
  const edges = [edge('valid', 'source', 'image', 'preview', 'image')];
  const missingModel = {
    id: 'model-a',
    category: 'model',
    severity: 'error',
    blocking: true,
    nodeId: 'source',
    repoId: 'owner/model',
    message: 'owner/model is required.',
  };

  const plan = graphFixer.buildGraphFixPlan({
    nodes: [source, preview],
    edges,
    registry: {},
    readinessIssues: [missingModel, { ...missingModel, id: 'model-b' }],
  });

  assert.equal(plan.issues.length, 1);
  assert.equal(plan.issues[0].kind, 'missing_model');
});

test('does not invent a connection for an explicitly optional input', () => {
  const optionalConditioner = definition('modules.Test', 'OptionalConditioner', 'Optional conditioner', {
    reference: { display: 'input', type: 'image', label: 'Reference', required: false },
    image: { display: 'output', type: 'image', label: 'Image' },
  });
  const source = node('source', optionalConditioner);
  const preview = node('preview', imagePreview, 300, 0);
  const edges = [edge('valid', 'source', 'image', 'preview', 'image')];

  const plan = graphFixer.buildGraphFixPlan({ nodes: [source, preview], edges, registry: {} });

  assert.equal(plan.canFix, false);
  assert.deepEqual(plan.issues, []);
});

test('uses the live registry contract when a saved graph predates required metadata', () => {
  const staleDefinition = definition('modules.Test', 'OptionalConditioner', 'Optional conditioner', {
    reference: { display: 'input', type: 'image', label: 'Reference' },
    image: { display: 'output', type: 'image', label: 'Image' },
  });
  const liveDefinition = definition('modules.Test', 'OptionalConditioner', 'Optional conditioner', {
    reference: { display: 'input', type: 'image', label: 'Reference', required: false },
    image: { display: 'output', type: 'image', label: 'Image' },
  });
  const source = node('source', staleDefinition);
  const preview = node('preview', imagePreview, 300, 0);
  const edges = [edge('valid', 'source', 'image', 'preview', 'image')];

  const plan = graphFixer.buildGraphFixPlan({
    nodes: [source, preview],
    edges,
    registry: { 'modules.Test.OptionalConditioner': liveDefinition },
  });

  assert.equal(plan.canFix, false);
  assert.deepEqual(plan.issues, []);
});

test('does not infer required sockets for runtime-dynamic node schemas', () => {
  const dynamicDefinition = {
    ...definition('modules.Test', 'Dynamic', 'Dynamic node', {
      optional_runtime_input: { display: 'input', type: 'image', label: 'Runtime input' },
      image: { display: 'output', type: 'image', label: 'Image' },
    }),
    skipParamsCheck: true,
  };
  const source = node('source', dynamicDefinition);
  const preview = node('preview', imagePreview, 300, 0);
  const edges = [edge('valid', 'source', 'image', 'preview', 'image')];

  const plan = graphFixer.buildGraphFixPlan({ nodes: [source, preview], edges, registry: {} });

  assert.equal(plan.canFix, false);
  assert.deepEqual(plan.issues, []);
});

test('does not offer a fix for an already complete graph', () => {
  const source = node('source', imageSource);
  const preview = node('preview', imagePreview, 300, 0);
  const edges = [edge('valid', 'source', 'image', 'preview', 'image')];
  const plan = graphFixer.buildGraphFixPlan({ nodes: [source, preview], edges, registry: {} });
  assert.equal(plan.canFix, false);
  assert.deepEqual(plan.issues, []);
});

test('Fix retains a component explanation even when no safe automatic replacement exists', () => {
  const readiness = {
    category: 'graph',
    code: 'modular_component_requirement',
    nodeId: 'foreign',
    severity: 'warning',
    blocking: false,
    action: 'inspect_node',
    message: 'Foreign decoder requires a different VAE.',
    details: 'Connect a compatible component; do not change the model automatically.',
  };
  const plan = graphFixer.buildGraphFixPlan({ nodes: [], edges: [], registry: {}, readinessIssues: [readiness] });
  assert.equal(plan.canFix, false);
  assert.equal(plan.candidateCount, 0);
  assert.equal(plan.issues.length, 1);
  assert.equal(plan.issues[0].targetNodeId, 'foreign');
  assert.match(plan.issues[0].description, /requires a different VAE/);
  assert.deepEqual(plan.issues[0].candidates, []);
});

test('Fix retains a runtime-only loop failure without guessing an initial tensor', () => {
  const readiness = {
    id: 'failed-loop-run',
    category: 'graph',
    code: 'modular_runtime_failure',
    nodeId: 'denoise',
    severity: 'warning',
    blocking: false,
    action: 'inspect_node',
    message:
      'Loop member denoise/before: previous-iteration connection needs initial state noise_pred for iteration 0.',
    details: 'Inspect the initial state or correct the carried-value connection; no tensor is guessed.',
  };
  const plan = graphFixer.buildGraphFixPlan({ nodes: [], edges: [], registry: {}, readinessIssues: [readiness] });
  assert.equal(plan.canFix, false);
  assert.equal(plan.candidateCount, 0);
  assert.equal(plan.issues.length, 1);
  assert.equal(plan.issues[0].targetNodeId, 'denoise');
  assert.match(plan.issues[0].description, /noise_pred/);
  assert.deepEqual(plan.issues[0].candidates, []);
});
