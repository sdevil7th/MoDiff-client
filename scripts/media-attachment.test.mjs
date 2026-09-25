import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

let server, attachment, authoring, starters;
const root = process.cwd();
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://localhost:5191' },
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  attachment = await server.ssrLoadModule('/src/workflow/mediaAttachment.ts');
  authoring = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  const backend = path.resolve(root, '../MoDiff');
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const fixture = path.join(root, 'scripts/operation-starter-fixtures.py');
  starters = process.env.MODIFF_STARTER_FIXTURE
    ? JSON.parse(readFileSync(process.env.MODIFF_STARTER_FIXTURE, 'utf8'))
    : JSON.parse(
        execFileSync(
          process.platform === 'win32' ? python : path.join(backend, 'scripts/with-runtime-env.sh'),
          process.platform === 'win32' ? [fixture, '--image-audio'] : [python, fixture, '--image-audio'],
          { cwd: backend, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 },
        ),
      );
});
after(async () => server?.close());

const registry = {
  'modules.Image.Load': {
    type: 'custom',
    module: 'modules.Image',
    action: 'Load',
    category: 'Image',
    label: 'Load Image',
    params: { image: { type: 'image', display: 'output' }, mask: { type: 'image', display: 'output' } },
  },
};

test('removed dynamic Guidance controls stay hidden without resetting execution values', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  const { guidanceFields } = await server.ssrLoadModule('/src/workflow/guidanceNodeFields.ts');
  const starter = starters.find(
    (s) => s.pipelineClass === 'StableDiffusionXLModularPipeline' && s.task === 'text_to_image',
  );
  const grouped = visual.groupNewOperationGraph(authoring.createOperationStarter(starter, { x: 0, y: 0 }));
  const root = grouped.nodes.find((n) => visual.visualOperationGroup(n) === 'guidance');
  const unpacked = visual.unpackVisualOperationGroups(grouped, new Set([root.id]));
  const stage = unpacked.graph.nodes.find((n) => n.data.action === 'Guider');
  stage.data.params.dynamic_scale = { type: 'float', display: 'number', label: 'Dynamic Scale', default: 2.8 };
  const refreshed = visual.restoreVisualOperationGroups(unpacked.graph, unpacked);
  const instance = refreshed.nodes.find((n) => n.id === root.id).data.blockInstanceV2;
  const dynamic = instance.effectiveInterface.controls.find((c) => c.binding.fieldId === 'dynamic_scale');
  assert.ok(dynamic);
  assert.ok(!instance.definitionSnapshot.controls.some((c) => c.controlId === dynamic.controlId));
  const edited = runtime.setBlockInstanceValueV2(instance, dynamic.controlId, 4.2);
  // Public binding decoration is expected to disappear, but consumed fields,
  // stages and wires must remain identical.
  const execution = (instance) =>
    JSON.parse(
      JSON.stringify(runtime.blockOperationGraphV2(instance), (key, value) =>
        key === 'blockBindingV2' ? undefined : value,
      ),
    );
  const before = execution(edited);
  const removed = runtime.replaceBlockEffectiveInterfaceV2(
    edited,
    {
      boundary: edited.effectiveInterface.boundary,
      controls: edited.effectiveInterface.controls
        .filter((c) => c !== dynamic && c.controlId !== dynamic.controlId)
        .map((c, order) => ({ ...c, order })),
    },
    { rememberRemovedControls: true },
  );
  assert.ok(
    !guidanceFields(removed).some((f) => f.field === 'dynamic_scale'),
    'removed dynamic field must stay hidden',
  );
  assert.deepEqual(execution(removed), before, 'removing presentation must retain consumed values');
  assert.deepEqual(removed.definitionSnapshot, instance.definitionSnapshot);
  const reopened = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(removed)));
  assert.ok(!guidanceFields(reopened).some((f) => f.field === 'dynamic_scale'));
  refreshed.nodes.find((n) => n.id === root.id).data.blockInstanceV2 = reopened;
  const flat = visual.unpackVisualOperationGroups(refreshed, new Set([root.id]));
  const regrouped = visual.restoreVisualOperationGroups(flat.graph, flat).nodes.find((n) => n.id === root.id)
    .data.blockInstanceV2;
  assert.ok(
    !guidanceFields(regrouped).some((f) => f.field === 'dynamic_scale'),
    'metadata regroup must retain removal',
  );
  const { reusableBlockDefinitionFromInstanceV2 } = await server.ssrLoadModule(
    '/src/studio/blockDefinitionPersistenceV2.ts',
  );
  const saved = reusableBlockDefinitionFromInstanceV2(regrouped, {
    choice: 'new',
    definitionId: 'saved-guidance',
    displayName: 'Saved Guidance',
  });
  const reinserted = schema.createBlockInstanceV2(saved, {
    instanceId: 'reinserted',
    position: { x: 0, y: 0 },
    size: { width: 400, height: 420 },
  });
  assert.ok(!guidanceFields(reinserted).some((f) => f.field === 'dynamic_scale'), 'reusable node retains removed rows');
  assert.equal(
    runtime.blockOperationGraphV2(reinserted).nodes.find((n) => n.data.action === 'Guider').data.params.dynamic_scale
      .value,
    4.2,
  );
  const restored = runtime.replaceBlockEffectiveInterfaceV2(
    regrouped,
    {
      boundary: regrouped.effectiveInterface.boundary,
      controls: [
        ...regrouped.effectiveInterface.controls,
        { ...dynamic, defaultValue: 4.2, order: regrouped.effectiveInterface.controls.length },
      ],
    },
    { rememberRemovedControls: true },
  );
  assert.ok(guidanceFields(restored).some((f) => f.field === 'dynamic_scale'));
  assert.deepEqual(restored.presentation.removedControlBindings ?? [], []);
  // Historical omissions still receive the read-only fallback; opening is not consent to hide.
  const historical = structuredClone(removed);
  delete historical.presentation.removedControlBindings;
  assert.ok(guidanceFields(historical).some((f) => f.field === 'dynamic_scale'));
  const cases = JSON.parse(readFileSync('../MoDiff/tests/fixtures/block_removed_controls_v1.json', 'utf8'));
  for (const bindings of cases.valid) {
    const candidate = structuredClone(removed);
    candidate.presentation.removedControlBindings = bindings;
    assert.deepEqual(schema.normalizeBlockInstanceV2(candidate), candidate);
    const definition = { ...saved, removedControlBindings: bindings };
    assert.deepEqual(schema.normalizeBlockDefinitionV2(definition), definition);
    assert.equal(schema.blockDefinitionContentHashV2(definition), saved.contentHash);
  }
  for (const bindings of [
    ...cases.invalid,
    Array.from({ length: 4097 }, (_, i) => ({ nodeId: `node-${i}`, fieldId: 'scale' })),
  ]) {
    const candidate = structuredClone(removed);
    candidate.presentation.removedControlBindings = bindings;
    assert.throws(() => schema.normalizeBlockInstanceV2(candidate), /removedControlBindings/);
    assert.throws(
      () => schema.normalizeBlockDefinitionV2({ ...saved, removedControlBindings: bindings }),
      /removedControlBindings/,
    );
  }
});

test('fresh image/audio workflows connect required media from separate loaders', async () => {
  const { createWorkflowDraft } = await server.ssrLoadModule('/src/workflow/workflowDraft.ts');
  const { unpackVisualOperationGroups } = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const { workflowTaskCategory } = await server.ssrLoadModule('/src/workflow/workflowTaskBrowser.ts');
  const mediaRegistry = {
    ...registry,
    'modules.Audio.Load': {
      ...registry['modules.Image.Load'],
      module: 'modules.Audio',
      label: 'Load Audio',
      params: { audio: { type: 'audio', display: 'output' } },
    },
  };
  let checked = 0;
  for (const starter of starters) {
    if (!['Image', 'Audio'].includes(workflowTaskCategory(starter.task))) continue;
    const before = structuredClone(starter);
    const { graph } = createWorkflowDraft(starter, mediaRegistry);
    const flat = unpackVisualOperationGroups(graph).graph;
    for (const required of starter.requiredInputs) {
      const target = flat.nodes.find((n) => n.data.operationAuthoring?.operation.operationId === required.operationId);
      const port = target?.data.operationAuthoring.operation.ports.find(
        (p) => p.name === required.field && p.direction === 'input',
      );
      if (!port || port.hidden || !port.types.some((t) => ['image', 'audio'].includes(t))) continue;
      const wire = flat.edges.find((e) => e.target === target.id && e.targetHandle === port.name);
      assert.ok(wire, `${starter.pipelineClass}/${starter.task}: missing ${port.name} source`);
      const source = flat.nodes.find((n) => n.id === wire.source);
      assert.equal(source.data.action, 'Load');
      assert.equal(source.parentId, undefined);
      checked++;
    }
    assert.deepEqual(starter, before);
    if (['text_to_image', 'text_to_audio'].includes(starter.task))
      assert.equal(flat.nodes.filter((n) => n.data.action === 'Load').length, 0);
  }
  assert.ok(checked >= 5, `Expected meaningful image/audio coverage, got ${checked}`);
});

test('direct encoder connection retains effective prompt defaults, values and custom branches', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const direct = await server.ssrLoadModule('/src/workflow/encodingNodeConnection.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const baseline = starters.find(
    (s) => s.pipelineClass === 'StableDiffusionXLModularPipeline' && s.task === 'text_to_image',
  );
  const destination = starters.find((s) => s.pipelineClass === baseline.pipelineClass && s.task === 'image_to_image');
  const plain = authoring.createOperationStarter(baseline, { x: 10, y: 20 });
  const prompt = plain.nodes.find((n) => n.data.action === 'EncodePrompt');
  // Default-backed text is still the user's visible prompt, not permission to
  // replace it with a fresh route's creative example.
  prompt.data.params.prompt.default = 'Keep this unedited default prompt exactly';
  delete prompt.data.params.prompt.value;
  prompt.data.operationAuthoring.defaults.prompt = prompt.data.params.prompt.default;
  const graph = visual.groupNewOperationGraph(plain);
  const root = graph.nodes.find((n) => n.data.label === 'Encode Inputs');
  graph.nodes.push({ id: 'source', type: 'custom', position: { x: 1, y: 2 }, data: registry['modules.Image.Load'] });
  graph.nodes.push({
    id: 'custom-consumer',
    type: 'custom',
    position: { x: 3, y: 4 },
    data: { ...registry['modules.Image.Load'], params: { image: { type: 'image', display: 'input' } } },
  });
  graph.edges.push({
    id: 'custom-branch',
    source: 'source',
    sourceHandle: 'image',
    target: 'custom-consumer',
    targetHandle: 'image',
  });
  const operations = [baseline, destination].flatMap((s) => s.nodes.map((n) => n.operation));
  const support = [
    {
      pipelineClass: baseline.pipelineClass,
      tasks: [baseline, destination].map((s) => ({
        task: s.task,
        execution: 'adapter',
        operationIds: s.nodes.map((n) => n.operation.operationId),
      })),
    },
  ];
  const connection = {
    source: 'source',
    sourceHandle: 'image',
    target: root.id,
    targetHandle: 'modiff-encoding-input:image',
  };
  const original = structuredClone(graph);
  const route = direct.encodingConnectionRoute(graph, connection, operations, support);
  const next = direct.planEncodingConnection(graph, connection, route, destination);
  assert.deepEqual(graph, original);
  assert.deepEqual(
    next.edges.find((e) => e.id === 'custom-branch'),
    original.edges.find((e) => e.id === 'custom-branch'),
  );
  const flat = visual.unpackVisualOperationGroups(next).graph;
  const retained = flat.nodes.find((n) => n.data.action === 'EncodePrompt');
  assert.equal(authoring.operationFieldValue(retained.data.params.prompt), 'Keep this unedited default prompt exactly');
  assert.equal(flat.nodes.filter((n) => n.data.action === 'ImageEncode').length, 1);
  assert.ok(flat.edges.some((e) => e.source === 'source' && e.targetHandle === 'image'));
  assert.doesNotThrow(() => runtime.expandBlockGraphV2ForExecution(next.nodes, next.edges));
});

test('visual encoders and guidance preserve executable stages, typed wires, and instance values', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const presentation = await server.ssrLoadModule('/src/workflow/encodingNodePresentation.ts');
  const starter = starters.find(
    (item) => item.pipelineClass === 'StableDiffusionXLModularPipeline' && item.task === 'text_to_image',
  );
  const graph = authoring.createOperationStarter(starter, { x: 80, y: 120 });
  const before = structuredClone(graph);
  const grouped = visual.groupNewOperationGraph(graph);
  assert.deepEqual(graph, before);
  const input = grouped.nodes.find((node) => visual.visualOperationGroup(node) === 'inputs');
  const guidance = grouped.nodes.find((node) => visual.visualOperationGroup(node) === 'guidance');
  assert.ok(
    input,
    JSON.stringify(starter.nodes.map((item) => [item.operation.nodeType, item.operation.decomposition])),
  );
  assert.ok(
    guidance,
    JSON.stringify(starter.nodes.map((item) => [item.operation.nodeType, item.operation.decomposition])),
  );
  assert.equal(grouped.nodes.length, graph.nodes.length - 1);
  assert.equal(presentation.isFocusedGuidance(guidance.data.blockInstanceV2), true);
  assert.deepEqual(guidance.data.blockInstanceV2.effectiveGraph.nodes.map((n) => n.data.action).sort(), [
    'Guider',
    'Layers',
  ]);
  assert.ok(input.data.blockInstanceV2.effectiveInterface.boundary.outputs.every((port) => port.valueType !== 'any'));
  const expanded = runtime.expandBlockGraphV2ForExecution(grouped.nodes, grouped.edges);
  assert.equal(expanded.nodes.length, graph.nodes.length);
  assert.equal(expanded.edges.length, graph.edges.length);
  const prompt = input.data.blockInstanceV2.effectiveInterface.controls.find(
    (control) => control.binding.fieldId === 'prompt',
  );
  assert.ok(prompt);
  input.data.blockInstanceV2 = runtime.setBlockInstanceValueV2(
    input.data.blockInstanceV2,
    prompt.controlId,
    'A red evening gown on a rainy city street',
  );
  const flat = visual.unpackVisualOperationGroups(JSON.parse(JSON.stringify(grouped))).graph;
  assert.equal(
    flat.nodes.find((node) => node.data.params.prompt)?.data.params.prompt.value,
    'A red evening gown on a rainy city street',
  );
  assert.equal(flat.nodes.length, graph.nodes.length);
  assert.equal(flat.edges.length, graph.edges.length);
});

test('fresh sources keep masks distinct and share the same declared image across consumers', async () => {
  const { createWorkflowDraft } = await server.ssrLoadModule('/src/workflow/workflowDraft.ts');
  const { unpackVisualOperationGroups } = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const starter = starters.find((s) => s.pipelineClass === 'StableDiffusionXLModularPipeline' && s.task === 'inpaint');
  const { graph } = createWorkflowDraft(starter, registry);
  const flat = unpackVisualOperationGroups(graph).graph;
  const loaders = flat.nodes.filter((n) => n.data.action === 'Load');
  assert.equal(loaders.length, 2);
  const mask = loaders.find((n) => n.data.label === 'Load Mask');
  assert.ok(mask);
  assert.ok(
    flat.edges.some((e) => e.source === mask.id && e.sourceHandle === 'image' && e.targetHandle === 'mask_image'),
  );
  assert.ok(!flat.edges.some((e) => loaders.some((n) => n.id === e.source) && e.sourceHandle === 'mask'));
  const without = createWorkflowDraft(starter, {});
  assert.ok(without.notices.some((n) => n.includes('loader is unavailable or incompatible')));
  assert.equal(
    unpackVisualOperationGroups(without.graph).graph.nodes.filter((n) => n.data.action === 'Load').length,
    0,
  );
});

test('custom mirrored interfaces reject adaptation without mutating their source or values', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const baseline = starters.find(
    (s) => s.pipelineClass === 'StableDiffusionXLModularPipeline' && s.task === 'text_to_image',
  );
  const destination = starters.find((s) => s.pipelineClass === baseline.pipelineClass && s.task === 'image_to_image');
  const graph = visual.groupNewOperationGraph(authoring.createOperationStarter(baseline, { x: 0, y: 0 }));
  const input = graph.nodes.find((n) => n.data.label === 'Encode Inputs');
  const port = input.data.blockInstanceV2.effectiveInterface.boundary.inputs[0];
  port.mirrorBindings = [structuredClone(port.binding)];
  const before = structuredClone(graph);
  const owner = graph.nodes.find((n) => n.data.action === 'ModelsLoader');
  assert.throws(() => authoring.planOperationChange(graph, owner.id, destination), /mirrored/);
  assert.deepEqual(graph, before);
});

test('grouped image attachment adds only a visible source and retains the immutable definition', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const baseline = starters.find(
    (item) => item.pipelineClass === 'StableDiffusionXLModularPipeline' && item.task === 'text_to_image',
  );
  const target = starters.find(
    (item) => item.pipelineClass === baseline.pipelineClass && item.task === 'image_to_image',
  );
  const graph = visual.groupNewOperationGraph(authoring.createOperationStarter(baseline, { x: 80, y: 120 }));
  const owner = graph.nodes.find((node) => node.data.operationAuthoring?.operation.decomposition === 'loader');
  const input = graph.nodes.find((node) => visual.visualOperationGroup(node) === 'inputs');
  const definition = structuredClone(input.data.blockInstanceV2.definitionSnapshot);
  const choice = attachment
    .mediaAttachmentChoices(
      target.nodes.map((item) => item.operation),
      target.pipelineClass,
    )
    .find((item) => item.role === 'image');
  assert.ok(choice);
  const next = attachment.planMediaAttachment(graph, owner.id, target, choice, registry);
  assert.equal(next.nodes.length, graph.nodes.length + 1);
  const result = next.nodes.find((node) => node.id === input.id);
  assert.deepEqual(result.data.blockInstanceV2.definitionSnapshot, definition);
  assert.ok(result.data.blockInstanceV2.effectiveGraph.nodes.some((node) => node.data.action === 'ImageEncode'));
  const expanded = runtime.expandBlockGraphV2ForExecution(next.nodes, next.edges);
  assert.ok(
    expanded.edges.some(
      (edge) =>
        expanded.nodes.find((node) => node.id === edge.source)?.data.action === 'Load' &&
        expanded.nodes.find((node) => node.id === edge.target)?.data.action === 'ImageEncode',
    ),
  );
  assert.deepEqual(
    attachment
      .mediaAttachmentOwners(
        graph,
        input.id,
        target.nodes.map((item) => item.operation),
        'image',
      )
      .map((node) => node.id),
    [owner.id],
  );
});

test('whole-pipeline audio stays unchanged rather than inventing encoders', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const starter = starters.find((item) => item.pipelineClass === 'AceStepPipeline' && item.task === 'text_to_audio');
  const graph = authoring.createOperationStarter(starter, { x: 0, y: 0 });
  assert.deepEqual(visual.groupNewOperationGraph(graph), graph);
});

test('grouped model changes retain prompts, a custom output branch and group identity', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const baseline = starters.find(
    (item) => item.pipelineClass === 'StableDiffusionXLModularPipeline' && item.task === 'text_to_image',
  );
  const target = starters.find((item) => item.pipelineClass === 'FluxModularPipeline' && item.task === 'text_to_image');
  const draft = authoring.createOperationStarter(baseline, { x: 0, y: 0 });
  const encoder = draft.nodes.find((node) => node.data.params.prompt);
  encoder.data.params.prompt.value = 'Detailed architectural photograph at blue hour';
  const output = encoder.data.operationAuthoring.operation.ports.find(
    (port) => port.direction === 'output' && !port.hidden,
  );
  draft.nodes.push({
    id: 'custom-branch',
    type: 'custom',
    position: { x: 0, y: 800 },
    data: {
      module: 'custom.Proof',
      action: 'Inspect',
      params: { input: { type: output.types, display: 'input' } },
    },
  });
  draft.edges.push({
    id: 'custom-wire',
    source: encoder.id,
    sourceHandle: output.name,
    target: 'custom-branch',
    targetHandle: 'input',
  });
  const graph = visual.groupNewOperationGraph(draft);
  const owner = graph.nodes.find((node) => node.data.operationAuthoring?.operation.decomposition === 'loader');
  const input = graph.nodes.find((node) => visual.visualOperationGroup(node) === 'inputs');
  const before = structuredClone(graph);
  const plan = authoring.planOperationChange(graph, owner.id, target);
  assert.deepEqual(graph, before);
  const result = plan.graph.nodes.find((node) => node.id === input.id);
  assert.ok(result);
  assert.deepEqual(result.data.blockInstanceV2.definitionSnapshot, input.data.blockInstanceV2.definitionSnapshot);
  const flat = visual.unpackVisualOperationGroups(plan.graph).graph;
  assert.equal(
    flat.nodes.find((node) => node.data.params.prompt)?.data.params.prompt.value,
    encoder.data.params.prompt.value,
  );
  assert.ok(flat.nodes.some((node) => node.id === 'custom-branch'));
  // Incompatible cross-family wires must be reviewed, never disguised as valid.
  assert.ok(flat.edges.some((edge) => edge.id === 'custom-wire') || plan.review.required);
  runtime.expandBlockGraphV2ForExecution(plan.graph.nodes, plan.graph.edges);
});

test('shared image seed edits cross the visual boundary and export uses one shared random draw', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const shared = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
  const starter = starters.find(
    (item) => item.pipelineClass === 'StableDiffusionXLModularPipeline' && item.task === 'image_to_image',
  );
  const graph = visual.groupNewOperationGraph(authoring.createOperationStarter(starter, { x: 0, y: 0 }));
  const input = graph.nodes.find((node) => visual.visualOperationGroup(node) === 'inputs');
  const seed = input.data.blockInstanceV2.effectiveInterface.controls.find(
    (control) => control.binding.fieldId === 'seed',
  );
  assert.ok(seed);
  const next = visual.planVisualSharedInput(graph, input.id, seed.controlId, { value: 8241, isRandom: false });
  assert.ok(next);
  const flat = runtime.expandBlockGraphV2ForExecution(next.nodes, next.edges);
  const image = flat.nodes.find((node) => node.data.action === 'ImageEncode');
  const group = shared.sharedOperationInput(flat.nodes, flat.edges, image.id, 'seed');
  assert.ok(group, 'execution still resolves the shared loader across the group boundary');
  assert.ok(group.members.length >= 2);
  for (const member of group.members)
    assert.deepEqual(member.node.data.params[member.field].value, { value: 8241, isRandom: false });
  shared.assertSharedOperationInput(group, flat.edges);
});

test('shared value edits preserve unrelated customized groups without rebuilding interfaces', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const starter = starters.find(
    (s) => s.pipelineClass === 'StableDiffusionXLModularPipeline' && s.task === 'image_to_image',
  );
  const first = visual.groupNewOperationGraph(authoring.createOperationStarter(starter, { x: 0, y: 0 }));
  const other = visual.groupNewOperationGraph(authoring.createOperationStarter(starter, { x: 0, y: 1000 }));
  const guide = other.nodes.find((n) => visual.visualOperationGroup(n) === 'guidance');
  let instance = runtime.addBlockEffectiveGraphNodeV2(
    guide.data.blockInstanceV2,
    {
      nodeId: 'custom-bool',
      nodeType: 'custom',
      data: {
        type: 'custom',
        module: 'custom.Proof',
        action: 'Bool',
        params: { enabled: { type: 'boolean', default: true } },
      },
    },
    { layout: { x: 0, y: 0, width: 300, height: 200 } },
  );
  instance = runtime.replaceBlockEffectiveInterfaceV2(instance, {
    boundary: instance.effectiveInterface.boundary,
    controls: instance.effectiveInterface.controls.map((c) =>
      c.binding.fieldId === 'enabled' ? { ...c, mirrorBindings: [{ nodeId: 'custom-bool', fieldId: 'enabled' }] } : c,
    ),
  });
  other.nodes = other.nodes.map((n) => (n.id === guide.id ? runtime.createBlockRootNodeV2(instance) : n));
  const graph = { nodes: [...first.nodes, ...other.nodes], edges: [...first.edges, ...other.edges] };
  const before = structuredClone(graph);
  const input = first.nodes.find((n) => visual.visualOperationGroup(n) === 'inputs');
  const seed = input.data.blockInstanceV2.effectiveInterface.controls.find((c) => c.binding.fieldId === 'seed');
  const next = visual.planVisualSharedInput(graph, input.id, seed.controlId, { value: 555, isRandom: false });
  assert.ok(next);
  assert.deepEqual(graph, before, 'planner is atomic and does not mutate its input');
  assert.deepEqual(next.edges, graph.edges, 'value edits never rewrite wires');
  for (const node of other.nodes)
    assert.deepEqual(
      next.nodes.find((n) => n.id === node.id),
      node,
    );
  const edited = next.nodes.find((n) => n.id === input.id).data.blockInstanceV2;
  assert.deepEqual(edited.definitionSnapshot, input.data.blockInstanceV2.definitionSnapshot);
  assert.deepEqual(edited.effectiveInterface, input.data.blockInstanceV2.effectiveInterface);
  assert.deepEqual(edited.presentation, input.data.blockInstanceV2.presentation);
  assert.deepEqual(edited.values[seed.controlId], { value: 555, isRandom: false });

  // A valid nested addition in the other branch must not block ordinary edits.
  instance = runtime.addBlockEffectiveGraphNodeV2(instance, {
    nodeId: 'custom-container',
    nodeType: 'group',
    data: { type: 'group', label: 'Custom group', params: {} },
    containerInterface: { schemaVersion: 1, boundary: { mode: 'explicit', inputs: [], outputs: [] }, controls: [] },
  });
  const nestedGraph = structuredClone(instance.effectiveGraph);
  nestedGraph.nodes.find((n) => n.nodeId === 'custom-bool').parentNodeId = 'custom-container';
  instance = runtime.replaceBlockEffectiveGraphV2(instance, nestedGraph);
  const nested = {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === guide.id ? runtime.createBlockRootNodeV2(instance) : n)),
  };
  const nestedNext = visual.planVisualSharedInput(nested, input.id, seed.controlId, { value: 777, isRandom: false });
  assert.deepEqual(
    nestedNext.nodes.find((n) => n.id === guide.id),
    nested.nodes.find((n) => n.id === guide.id),
  );
  const prompt = input.data.blockInstanceV2.effectiveInterface.controls.find((c) => c.binding.fieldId === 'prompt');
  assert.equal(visual.planVisualSharedInput(nested, input.id, prompt.controlId, 'new prompt'), null);

  const sealed = runtime.replaceBlockEffectiveInterfaceV2(input.data.blockInstanceV2, {
    boundary: input.data.blockInstanceV2.effectiveInterface.boundary,
    controls: input.data.blockInstanceV2.effectiveInterface.controls.map((c) =>
      c.controlId === seed.controlId ? { ...c, sealed: true } : c,
    ),
  });
  const protectedGraph = {
    ...nested,
    nodes: nested.nodes.map((n) => (n.id === input.id ? runtime.createBlockRootNodeV2(sealed) : n)),
  };
  const protectedBefore = structuredClone(protectedGraph);
  assert.throws(
    () => visual.planVisualSharedInput(protectedGraph, input.id, seed.controlId, { value: 999, isRandom: false }),
    /sealed/,
  );
  assert.deepEqual(protectedGraph, protectedBefore);
});

test('all representative backend starters preserve their complete API parameters and edges when grouped', async (t) => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const exporter = await server.ssrLoadModule('/src/stores/flowGraphExport.ts');
  const canonical = (graph) => {
    const api = exporter.buildApiGraphExport({ ...graph, sid: 'proof', randomizeSeeds: false, setParam: () => {} });
    const identity = (id) => {
      const node = graph.nodes.find((node) => node.id === id);
      return node?.data.operationAuthoring?.operation.operationId ?? id;
    };
    return Object.fromEntries(
      Object.entries(api.nodes).map(([id, node]) => [
        identity(id),
        {
          ...node,
          params: Object.fromEntries(
            Object.entries(node.params).map(([name, field]) => [
              name,
              {
                ...field,
                ...(field.sourceId ? { sourceId: identity(field.sourceId) } : {}),
              },
            ]),
          ),
        },
      ]),
    );
  };
  // Schema defaults reflect the host GPU inventory. Exercise explicit valid
  // plans on every host instead of requiring CI to have a CUDA device. These
  // are export-only fixtures: no hardware probing or model execution occurs.
  for (const plan of [
    { device: 'cpu:0', auto_offload: false, offload_mode: 'none' },
    { device: 'cuda:0', auto_offload: true, offload_mode: 'model_cpu' },
  ]) {
    for (const starter of starters) {
      await t.test(`${plan.device}/${starter.pipelineClass}/${starter.task}`, () => {
        const before = authoring.createOperationStarter(starter, { x: 0, y: 0 });
        for (const node of before.nodes) {
          for (const [field, value] of Object.entries(plan)) {
            if (node.data.params[field]) node.data.params[field].value = value;
          }
        }
        const original = structuredClone(before);
        const expected = canonical(before);
        const grouped = visual.groupNewOperationGraph(before);
        const after = runtime.expandBlockGraphV2ForExecution(grouped.nodes, grouped.edges);
        assert.deepEqual(canonical(after), expected);
        assert.deepEqual(before, original, 'Grouping must not change the source graph');
      });
    }
  }
});

test('grouping preserves rejection of CPU execution with GPU-only offload', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const exporter = await server.ssrLoadModule('/src/stores/flowGraphExport.ts');
  const starter = starters.find(
    (item) => item.pipelineClass === 'StableDiffusionXLModularPipeline' && item.task === 'text_to_image',
  );
  const graph = authoring.createOperationStarter(starter, { x: 0, y: 0 });
  const loader = graph.nodes.find((node) => node.data.params.auto_offload && node.data.params.offload_mode);
  assert.ok(loader, 'Fixture must contain the real backend offload controls');
  loader.data.params.device.value = 'cpu:0';
  loader.data.params.auto_offload.value = true;
  loader.data.params.offload_mode.value = 'model_cpu';
  const original = structuredClone(graph);
  const grouped = visual.groupNewOperationGraph(graph);
  const expanded = runtime.expandBlockGraphV2ForExecution(grouped.nodes, grouped.edges);
  for (const candidate of [graph, expanded]) {
    assert.throws(
      () => exporter.buildApiGraphExport({ ...candidate, sid: 'proof', randomizeSeeds: false, setParam: () => {} }),
      /cpu:0 execution cannot use model_cpu offload/,
    );
  }
  assert.deepEqual(graph, original);
});

test('saved visual Block preserves grouping identity and declared values on independent reinsertion', async () => {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  const persistence = await server.ssrLoadModule('/src/studio/blockDefinitionPersistenceV2.ts');
  const starter = starters.find(
    (item) => item.pipelineClass === 'StableDiffusionXLModularPipeline' && item.task === 'text_to_image',
  );
  const graph = visual.groupNewOperationGraph(authoring.createOperationStarter(starter, { x: 0, y: 0 }));
  const root = graph.nodes.find((node) => visual.visualOperationGroup(node) === 'inputs');
  const control = root.data.blockInstanceV2.effectiveInterface.controls.find(
    (control) => control.binding.fieldId === 'prompt',
  );
  const instance = runtime.setBlockInstanceValueV2(
    root.data.blockInstanceV2,
    control.controlId,
    'Retained reusable prompt',
  );
  const definition = persistence.reusableBlockDefinitionFromInstanceV2(instance, {
    choice: 'new',
    definitionId: 'saved-inputs',
    displayName: 'My input preparation',
  });
  const inserted = runtime.createBlockRootNodeV2(
    schema.createBlockInstanceV2(definition, {
      instanceId: 'new-inputs',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 540 },
    }),
  );
  assert.equal(visual.visualOperationGroup(inserted), 'inputs');
  assert.equal(
    visual
      .unpackVisualOperationGroups({ nodes: [inserted], edges: [] })
      .graph.nodes.find((node) => node.data.params.prompt)?.data.params.prompt.value,
    'Retained reusable prompt',
  );
  assert.notDeepEqual(instance.values, root.data.blockInstanceV2.values);
});
test('SDXL source attachment reuses existing stages and preserves prompt/custom siblings', () => {
  const baseline = starters.find(
    (item) => item.pipelineClass === 'StableDiffusionXLModularPipeline' && item.task === 'text_to_image',
  );
  const target = starters.find(
    (item) => item.pipelineClass === baseline.pipelineClass && item.task === 'image_to_image',
  );
  const graph = authoring.createOperationStarter(baseline, { x: 400, y: 120 });
  const owner = graph.nodes.find((node) => node.data.operationAuthoring.operation.decomposition === 'loader');
  const prompt = graph.nodes.find((node) => node.data.params.prompt);
  prompt.data.params.prompt.value = 'A detailed editorial photograph on a rainy city street';
  const sibling = {
    id: 'custom-sibling',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { module: 'custom.Test', action: 'Keep', params: { amount: { value: 0.65 } } },
  };
  graph.nodes.push(sibling);
  const before = structuredClone(graph);
  const choices = attachment.mediaAttachmentChoices(
    target.nodes.map((item) => item.operation),
    target.pipelineClass,
  );
  const choice = choices.find((item) => item.kind === 'image' && !item.role.includes('mask'));
  assert.ok(choice);
  const result = attachment.planMediaAttachment(graph, owner.id, target, choice, registry);
  assert.deepEqual(graph, before, 'preview must not mutate its source');
  assert.deepEqual(
    result.nodes.find((node) => node.id === sibling.id),
    sibling,
  );
  assert.equal(
    result.nodes.find((node) => node.data.params.prompt)?.data.params.prompt.value,
    prompt.data.params.prompt.value,
  );
  const input = result.nodes.find((node) => node.data.module === 'modules.Image' && node.data.action === 'Load');
  assert.ok(input);
  assert.ok(result.edges.some((edge) => edge.source === input.id));
  assert.ok(result.nodes.some((node) => node.data.action === 'ImageEncode'));
});

test('a newly attached mask uses mask pixels, not an unrelated alpha channel', () => {
  const target = starters.find(
    (item) => item.pipelineClass === 'StableDiffusionXLModularPipeline' && item.task === 'inpaint',
  );
  const graph = authoring.createOperationStarter(target, { x: 400, y: 0 });
  const owner = graph.nodes.find((node) => node.data.operationAuthoring.operation.decomposition === 'loader');
  const choice = attachment
    .mediaAttachmentChoices(
      target.nodes.map((item) => item.operation),
      target.pipelineClass,
    )
    .find((item) => item.role.includes('mask'));
  assert.ok(choice);
  const result = attachment.planMediaAttachment(graph, owner.id, target, choice, registry);
  const source = result.nodes.find((node) => node.data.label === 'Load Mask');
  assert.ok(source);
  assert.ok(result.edges.some((edge) => edge.source === source.id && edge.sourceHandle === 'image'));
  assert.ok(!result.edges.some((edge) => edge.source === source.id && edge.sourceHandle === 'mask'));
});

test('attachment choices reject undeclared roles and do not advertise video transport', () => {
  for (const starter of starters) {
    const choices = attachment.mediaAttachmentChoices(
      starter.nodes.map((item) => item.operation),
      starter.pipelineClass,
    );
    assert.ok(choices.every((choice) => ['image', 'audio'].includes(choice.kind)));
  }
  assert.deepEqual(attachment.mediaAttachmentChoices([], 'UnknownPipeline'), []);
});

test('ACE audio variation connects an audio source and preserves text and unrelated nodes', () => {
  const baseline = starters.find((item) => item.pipelineClass === 'AceStepPipeline' && item.task === 'text_to_audio');
  const target = starters.find(
    (item) => item.pipelineClass === baseline.pipelineClass && item.task === 'audio_variation',
  );
  const graph = authoring.createOperationStarter(baseline, { x: 400, y: 0 });
  const owner = graph.nodes.find((node) => node.data.operationAuthoring.operation.decomposition === 'loader');
  const prompt = graph.nodes.find((node) => node.data.params.prompt);
  if (prompt) prompt.data.params.prompt.value = 'Jazz piano with gentle percussion';
  const choice = attachment
    .mediaAttachmentChoices(
      target.nodes.map((item) => item.operation),
      target.pipelineClass,
    )
    .find((item) => item.kind === 'audio');
  const audio = {
    'modules.Audio.Load': {
      type: 'custom',
      module: 'modules.Audio',
      action: 'Load',
      label: 'Load Audio',
      params: { audio: { type: 'audio', display: 'output' } },
    },
  };
  assert.ok(choice);
  const next = attachment.planMediaAttachment(graph, owner.id, target, choice, audio);
  const input = next.nodes.find((node) => node.data.module === 'modules.Audio');
  assert.ok(next.edges.some((edge) => edge.source === input.id && edge.targetHandle === 'source_audio'));
  if (prompt)
    assert.equal(
      next.nodes.find((node) => node.data.params.prompt)?.data.params.prompt.value,
      prompt.data.params.prompt.value,
    );
});

test('saved Block attachment preserves its definition, exposes exact image crossing and rejects duplicate drivers', async () => {
  const schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const baseline = starters.find(
    (item) => item.pipelineClass === 'StableDiffusionXLModularPipeline' && item.task === 'text_to_image',
  );
  const target = starters.find(
    (item) => item.pipelineClass === baseline.pipelineClass && item.task === 'image_to_image',
  );
  const draft = authoring.createOperationStarter(baseline, { x: 0, y: 0 });
  const owner = draft.nodes.find((node) => node.data.operationAuthoring.operation.decomposition === 'loader');
  const inner = {
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
    definitionId: 'user:media-test',
    displayName: 'Media test',
    source: { kind: 'user' },
    graph: { ...inner, graphHash: schema.blockGraphHashV2(inner) },
    boundary: { mode: 'explicit', inputs: [], outputs: [] },
    controls: [],
    suggestedInputs: [],
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  definition.contentHash = schema.blockDefinitionContentHashV2(definition);
  const instance = schema.createBlockInstanceV2(definition, {
    instanceId: 'media-block',
    position: { x: 400, y: 80 },
    size: { width: 400, height: 600 },
    internalLayout: Object.fromEntries(
      draft.nodes.map((node) => [node.id, { ...node.position, width: 360, height: 400 }]),
    ),
  });
  const graph = { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] };
  const choice = attachment
    .mediaAttachmentChoices(
      target.nodes.map((item) => item.operation),
      target.pipelineClass,
    )
    .find((item) => item.role === 'image');
  assert.ok(choice);
  const next = attachment.planBlockMediaAttachment(graph, 'media-block', owner.id, target, choice, registry);
  assert.equal(graph.nodes.length, 1);
  assert.deepEqual(next.nodes[0].data.blockInstanceV2.definitionSnapshot, instance.definitionSnapshot);
  assert.ok(
    next.edges.some((edge) => edge.target === 'media-block' && edge.targetHandle.startsWith('block-crossing:input:')),
  );
  assert.doesNotThrow(() => runtime.expandBlockGraphV2ForExecution(next.nodes, next.edges));
  const crossing = await server.ssrLoadModule('/src/studio/blockCrossingConnectionsV2.ts');
  const producer = runtime.createBlockRootNodeV2({ ...structuredClone(instance), instanceId: 'producer-block' });
  const decoder = draft.nodes.find((node) => node.data.action === 'DecodeLatents');
  const output = Object.entries(decoder.data.params).find(
    ([, param]) => param.display === 'output' && param.type === 'image',
  )[0];
  const handle = crossing.blockCrossingHandleV2({ direction: 'output', nodeId: decoder.id, fieldOrPortId: output });
  const reused = attachment.planBlockMediaAttachment(
    { nodes: [...graph.nodes, producer], edges: [] },
    'media-block',
    owner.id,
    target,
    choice,
    registry,
    { nodeId: producer.id, handleId: handle },
  );
  assert.equal(reused.nodes.length, 2, 'reuse a declared Block output instead of creating another loader');
  assert.ok(reused.edges.some((edge) => edge.source === producer.id && edge.sourceHandle === handle));
  assert.doesNotThrow(() => runtime.expandBlockGraphV2ForExecution(reused.nodes, reused.edges));
  assert.throws(
    () => attachment.planBlockMediaAttachment(next, 'media-block', owner.id, target, choice, registry),
    /already connected/u,
  );
});

test('single-file import names and workspace conversion are bounded and non-destructive', async () => {
  const { extensionName, pythonFileImport } = await server.ssrLoadModule('/src/studio/customExtensions.ts');
  const { unifiedWorkspaceSettings } = await server.ssrLoadModule('/src/studio/workspaceMode.ts');
  assert.equal(extensionName('my-node.py'), 'my_node');
  assert.match(extensionName('7 nodes.py'), /^[A-Za-z][A-Za-z0-9_]*$/u);
  await assert.rejects(pythonFileImport(new File(['{}'], 'workflow.json')), /Python node/u);
  const previous = {
    workspaceMode: 'creator',
    studioViewMode: 'auto',
    workspacePanelPreferences: {},
    leftPanelWidth: 420,
    resourceMode: 'expert',
  };
  assert.deepEqual(unifiedWorkspaceSettings(previous), { leftPanelWidth: 420, resourceMode: 'expert' });
  assert.equal(previous.workspaceMode, 'creator');
});
