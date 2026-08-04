import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let graphFixer;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  graphFixer = await server.ssrLoadModule('/src/studio/graphFixer.ts');
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

const imageSource = definition('modules.Test', 'GenerateImage', 'Generate image', {
  image: { display: 'output', type: 'image', label: 'Image' },
});
const imagePreview = definition('modules.Image', 'Preview', 'Preview image', {
  image: { display: 'input', type: 'image', label: 'Image', required: true },
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
