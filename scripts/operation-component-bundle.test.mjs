import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

let server, authoring, bundle, visual, starters;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    localStorage: globalThis.localStorage,
    location: { origin: 'http://localhost:5191' },
    dispatchEvent: () => true,
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null, hmr: false },
    appType: 'custom',
  });
  authoring = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  bundle = await server.ssrLoadModule('/src/workflow/operationComponentBundle.ts');
  visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const backend = path.resolve('../MoDiff');
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const script = path.resolve('scripts/operation-starter-fixtures.py');
  starters = process.env.MODIFF_STARTER_FIXTURE
    ? JSON.parse(readFileSync(process.env.MODIFF_STARTER_FIXTURE, 'utf8'))
    : JSON.parse(
        execFileSync(
          process.platform === 'win32' ? python : path.join(backend, 'scripts/with-runtime-env.sh'),
          process.platform === 'win32' ? [script, '--image-audio'] : [python, script, '--image-audio'],
          { cwd: backend, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 },
        ),
      );
});
after(async () => server?.close());

function graph(pipeline = 'QwenImageModularPipeline') {
  return authoring.createOperationStarter(
    starters.find((item) => item.pipelineClass === pipeline && item.task === 'text_to_image'),
    { x: 0, y: 0 },
  );
}
function owner(graph) {
  return graph.nodes.find((node) => node.data.action === 'ModelsLoader');
}
function semanticEdges(graph) {
  // Expand only explicitly supplied component inputs for comparison. Real
  // bundle objects/ownership and raw override precedence are backend tests.
  return graph.edges
    .flatMap((edge) => {
      const target = graph.nodes.find((node) => node.id === edge.target);
      const operation = authoring.operationAuthoring(target)?.operation;
      const leaves = operation?.ports.filter((port) => port.semantics?.suppliedBy?.input === edge.targetHandle) ?? [];
      if (!leaves.length) return [edge];
      return leaves
        .filter(
          (port) => !graph.edges.some((other) => other.target === edge.target && other.targetHandle === port.name),
        )
        .map((port) => {
          const source = graph.nodes.find((node) => node.id === edge.source);
          const outputs = authoring
            .operationAuthoring(source)
            .operation.ports.filter(
              (output) =>
                output.direction === 'output' &&
                output.name !== edge.sourceHandle &&
                output.semantics.kind === 'component' &&
                port.semantics.members.every((member) =>
                  output.semantics.members.some(
                    (candidate) => candidate.name === member.name && candidate.type === member.type,
                  ),
                ),
            );
          assert.equal(outputs.length, 1);
          return { ...edge, sourceHandle: outputs[0].name, targetHandle: port.name };
        });
    })
    .map((edge) => [edge.source, edge.sourceHandle, edge.target, edge.targetHandle])
    .sort();
}

test('actual declared Qwen bundle rewires existing leaves reversibly without changing controls or guidance', () => {
  const ordinary = graph();
  const loader = owner(ordinary);
  ordinary.nodes.find((node) => node.data.action === 'EncodePrompt').data.params.prompt.value = 'Keep my prompt';
  ordinary.nodes.find((node) => node.data.action === 'Guider').data.params.guidance_scale.value = 0;
  const before = structuredClone(ordinary);
  assert.deepEqual(bundle.availableOperationComponentBundleActions(ordinary, loader.id), ['bundle']);
  const bundled = bundle.setOperationComponentBundle(ordinary, loader.id, 'bundle');
  assert.deepEqual(ordinary, before, 'planning is read-only');
  assert.deepEqual(bundled.nodes, before.nodes, 'no loader, stage, parameter or runtime identity is replaced');
  assert.equal(
    bundled.edges.length,
    ordinary.edges.length - 1,
    'four component fanout edges become three aggregate edges',
  );
  assert.equal(
    bundled.edges.filter((edge) => edge.source === loader.id && edge.sourceHandle === 'pipeline_components').length,
    3,
  );
  assert.deepEqual(semanticEdges(bundled), semanticEdges(before));
  assert.deepEqual(bundle.availableOperationComponentBundleActions(bundled, loader.id), ['components']);
  const exposed = bundle.setOperationComponentBundle(bundled, loader.id, 'components');
  assert.deepEqual(exposed.nodes, before.nodes);
  assert.deepEqual(semanticEdges(exposed), semanticEdges(before));
  assert.deepEqual(bundle.availableOperationComponentBundleActions(exposed, loader.id), ['bundle']);
});

test('bundle and breakout preserve explicit component overrides and an unrelated branch', () => {
  const ordinary = graph(),
    loader = owner(ordinary);
  const denoise = ordinary.nodes.find((node) => node.data.action === 'Denoise');
  ordinary.nodes.push({
    id: 'override',
    type: 'custom',
    position: { x: -400, y: 0 },
    data: {
      module: 'custom.Components',
      action: 'Transformer',
      params: { model: { type: denoise.data.params.unet.type, display: 'output' } },
    },
  });
  ordinary.nodes.push({
    id: 'unrelated',
    type: 'custom',
    position: { x: -400, y: 400 },
    data: {
      module: 'custom.Text',
      action: 'Value',
      params: { value: { type: 'string', display: 'text', value: 'untouched' } },
    },
  });
  ordinary.edges = ordinary.edges.filter((edge) => !(edge.target === denoise.id && edge.targetHandle === 'unet'));
  const override = {
    id: 'explicit-override',
    source: 'override',
    sourceHandle: 'model',
    target: denoise.id,
    targetHandle: 'unet',
  };
  ordinary.edges.push(override);
  const before = structuredClone(ordinary),
    unrelated = ordinary.nodes.at(-1);
  const bundled = bundle.setOperationComponentBundle(ordinary, loader.id, 'bundle');
  assert.deepEqual(
    bundled.edges.find((edge) => edge.id === override.id),
    override,
  );
  assert.equal(
    bundled.nodes.find((node) => node.id === unrelated.id),
    unrelated,
  );
  assert.deepEqual(semanticEdges(bundled), semanticEdges(before));
  const exposed = bundle.setOperationComponentBundle(bundled, loader.id, 'components');
  assert.deepEqual(
    exposed.edges.find((edge) => edge.id === override.id),
    override,
  );
  assert.deepEqual(semanticEdges(exposed), semanticEdges(before));
});

test('component rewiring uses visual stage projection while keeping wrappers, values and canonical leaves', () => {
  const ordinary = graph(),
    loader = owner(ordinary);
  const grouped = visual.groupNewOperationGraph(ordinary);
  const roots = grouped.nodes.filter((node) => visual.visualOperationGroup(node));
  const before = visual.unpackVisualOperationGroups(grouped).graph;
  const bundled = bundle.setOperationComponentBundle(grouped, loader.id, 'bundle');
  for (const root of roots) {
    const after = bundled.nodes.find((node) => node.id === root.id);
    assert.equal(visual.visualOperationGroup(after), visual.visualOperationGroup(root));
    assert.deepEqual(
      after.data.blockInstanceV2.definitionSnapshot,
      root.data.blockInstanceV2.definitionSnapshot,
      'immutable reusable definition content remains unchanged',
    );
  }
  const lowered = visual.unpackVisualOperationGroups(bundled).graph;
  assert.deepEqual(lowered.nodes.map((node) => node.id).sort(), before.nodes.map((node) => node.id).sort());
  assert.deepEqual(semanticEdges(lowered), semanticEdges(before));
  const exposed = visual.unpackVisualOperationGroups(
    bundle.setOperationComponentBundle(bundled, loader.id, 'components'),
  ).graph;
  assert.deepEqual(semanticEdges(exposed), semanticEdges(before));
});

test('an aggregate alone, missing exact supplied members, or a custom bundle grants no rewrite authority', () => {
  const other = graph('FluxModularPipeline');
  assert.deepEqual(bundle.availableOperationComponentBundleActions(other, owner(other).id), []);
  const ordinary = graph(),
    loader = owner(ordinary);
  loader.data.operationAuthoring.operation.ports
    .find((port) => port.name === 'pipeline_components')
    .semantics.members.forEach((member) => (member.type = 'custom.Unreviewed'));
  assert.deepEqual(bundle.availableOperationComponentBundleActions(ordinary, loader.id), []);
  assert.throws(() => bundle.setOperationComponentBundle(ordinary, loader.id, 'bundle'), /No declared component/);
  const literal = graph(),
    literalOwner = owner(literal);
  const literalDenoise = literal.nodes.find((node) => node.data.action === 'Denoise');
  literalDenoise.data.params.pipeline_components.value = { reference: 'explicit opaque bundle' };
  const literalResult = bundle.setOperationComponentBundle(literal, literalOwner.id, 'bundle');
  assert.ok(
    !literalResult.edges.some(
      (edge) => edge.target === literalDenoise.id && edge.targetHandle === 'pipeline_components',
    ),
  );
  assert.deepEqual(literalResult.nodes, literal.nodes, 'a literal aggregate remains unchanged');
  const custom = graph(),
    customOwner = owner(custom),
    encode = custom.nodes.find((node) => node.data.action === 'EncodePrompt');
  custom.nodes.push({
    id: 'custom-bundle',
    type: 'custom',
    position: { x: 0, y: 500 },
    data: {
      module: 'custom.Components',
      action: 'Bundle',
      params: { output: { type: 'diffusers_modular_pipeline_components', display: 'output' } },
    },
  });
  const edge = {
    id: 'custom-bundle-wire',
    source: 'custom-bundle',
    sourceHandle: 'output',
    target: encode.id,
    targetHandle: 'pipeline_components',
  };
  custom.edges.push(edge);
  const bundled = bundle.setOperationComponentBundle(custom, customOwner.id, 'bundle');
  assert.deepEqual(
    bundled.edges.find((item) => item.id === edge.id),
    edge,
  );
  assert.ok(
    bundled.edges.some((item) => item.target === encode.id && item.targetHandle === 'text_encoders'),
    'explicit alternate aggregate preserves its raw fallback',
  );
});
