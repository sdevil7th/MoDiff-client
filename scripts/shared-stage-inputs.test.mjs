import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { canonicalGraphIdentity } from './live-proof-provenance.mjs';

let fixture, server, groups, drafts, authoring, exporter, schema, runtime;
const selections = [
  ['HunyuanVideo15ModularPipeline', 'text_to_video'],
  ['HunyuanVideo15ModularPipeline', 'image_to_video'],
  ['MiniMaxH3ModularPipeline', 'text_to_video_with_audio'],
  ['MiniMaxH3ModularPipeline', 'first_last_frame_to_video_with_audio'],
  ['MiniMaxH3ModularPipeline', 'reference_to_video_with_audio'],
  ['MiniMaxMusic3ModularPipeline', 'text_to_audio'],
  ['QwenImageModularPipeline', 'text_to_image'],
  ['MiniMaxH3ImageModularPipeline', 'text_to_image'],
];
before(async () => {
  const backend = process.env.MODIFF_BACKEND_DIR || path.resolve('../MoDiff');
  const python = process.env.MODIFF_BACKEND_PYTHON || path.join(backend, '.venv/Scripts/python.exe');
  fixture = JSON.parse(
    execFileSync(python, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: backend,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 ** 2,
      timeout: 120_000,
      input: JSON.stringify(
        selections.map(([pipelineClass, task]) => ({
          id: `${pipelineClass}:${task}`,
          selection: { pipelineClass, task },
        })),
      ),
      env: {
        ...process.env,
        MODIFF_BACKEND_DIR: backend,
        PYTHONDONTWRITEBYTECODE: '1',
        HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1',
        CUDA_VISIBLE_DEVICES: '',
      },
    }),
  );
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = { dispatchEvent: () => true, location: { origin: 'http://127.0.0.1:5191' }, localStorage };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  drafts = await server.ssrLoadModule('/src/workflow/workflowDraft.ts');
  authoring = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  exporter = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
});
after(async () => server?.close());

function fresh(row) {
  const graph = groups.unpackVisualOperationGroups(
    drafts.createWorkflowDraft(row.starter, fixture.registry).graph,
  ).graph;
  for (const node of graph.nodes) {
    if (node.data.params.offload_mode) node.data.params.offload_mode.value = 'none';
    if (node.data.params.auto_offload) node.data.params.auto_offload.value = false;
  }
  return groups.groupNewOperationGraph(graph);
}
function generate(graph) {
  return graph.nodes.find((node) => groups.visualOperationGroup(node) === 'generate');
}
function modelInputs(root) {
  return root.data.blockInstanceV2.effectiveInterface.boundary.inputs.filter(
    (port) => port.binding.fieldOrPortId === 'pipeline_components',
  );
}
function api(graph) {
  return canonicalGraphIdentity(
    exporter.useFlowStore
      .getState()
      .exportGraph('shared-stage-inputs', undefined, { sourceGraph: graph, randomizeSeeds: false }),
  );
}

// Historical automatic Generate definitions exposed one socket per consumer.
// Preserve the old baseline itself, not a reference to today's planner output.
function historicalSplit(graph, kind = 'generate') {
  const result = structuredClone(graph),
    root = result.nodes.find((node) => groups.visualOperationGroup(node) === kind),
    instance = root.data.blockInstanceV2;
  const definition = structuredClone(instance.definitionSnapshot);
  const replacements = new Map();
  definition.boundary.inputs = definition.boundary.inputs.flatMap((port) => {
    if (port.binding.fieldOrPortId !== 'pipeline_components' || !port.mirrorBindings?.length) return [port];
    const ports = [port.binding, ...port.mirrorBindings].map((binding) => ({
      ...port,
      binding,
      portId: `${binding.nodeId}:${binding.fieldOrPortId}`,
    }));
    for (const p of ports) delete p.mirrorBindings;
    replacements.set(
      port.portId,
      ports.map((p) => p.portId),
    );
    return ports;
  });
  definition.contentHash = schema.blockDefinitionContentHashV2(definition);
  const baseline = schema.normalizeBlockDefinitionV2(definition);
  const old = schema.createBlockInstanceV2(baseline, {
    instanceId: root.id,
    position: root.position,
    size: instance.presentation.size,
    internalLayout: instance.presentation.internalLayout,
  });
  const node = runtime.createBlockRootNodeV2(old);
  result.nodes = result.nodes
    .map((n) => (n.id === root.id ? node : n))
    .filter((n) => n.data.blockProjectionOwnerId !== root.id);
  result.edges = result.edges
    .filter((edge) => edge.data?.blockProjectionOwnerId !== root.id)
    .flatMap((edge) =>
      edge.target === root.id && replacements.has(edge.targetHandle)
        ? replacements
            .get(edge.targetHandle)
            .map((targetHandle, i) => ({ ...edge, id: `${edge.id}-historical-${i}`, targetHandle }))
        : [edge],
    );
  return result;
}

test('all seven affected routes and H3 Image expose one shared model input without changing execution', async (t) => {
  for (const row of fixture.recipes)
    await t.test(row.id, () => {
      const graph = fresh(row),
        root = generate(graph),
        ports = modelInputs(root);
      assert.equal(ports.length, 1, 'the visible stage needs one component input');
      assert.equal(ports[0].mirrorBindings.length, 1, 'that input must still feed both real consumers');
      assert.deepEqual(api(graph), api(groups.unpackVisualOperationGroups(graph).graph));
      assert.deepEqual(
        api(JSON.parse(JSON.stringify(graph))),
        api(graph),
        'save/reopen retains the same executable graph',
      );
    });
});

test('shared stage connectors label distinct outputs by their operation without changing saved bindings', () => {
  let checked = 0;
  for (const row of fixture.recipes) {
    const graph = fresh(row);
    const saved = JSON.stringify(graph);
    for (const node of graph.nodes.filter(groups.visualOperationGroup)) {
      const instance = node.data.blockInstanceV2;
      const ports = instance.effectiveInterface.boundary.outputs;
      const projected = runtime.blockConnectorParamsV2(instance).outputs;
      assert.deepEqual(
        Object.keys(projected),
        ports.map(({ portId }) => portId),
      );
      for (const port of ports) {
        const collisions = ports.filter(({ label }) => label === port.label);
        if (collisions.length < 2) {
          assert.equal(projected[port.portId].label, port.label);
          continue;
        }
        const owner = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === port.binding.nodeId);
        assert.equal(projected[port.portId].label, `${owner.data.label} · ${port.label}`);
        assert.equal(projected[port.portId].fieldOptions.wrapConnectionLabel, true);
        assert.equal(new Set(collisions.map(({ portId }) => projected[portId].label)).size, collisions.length);
        checked++;
      }
    }
    assert.equal(JSON.stringify(graph), saved, 'labels are only a view of the saved graph');
    assert.deepEqual(api(graph), api(JSON.parse(saved)));
  }
  assert.ok(checked > 0, 'the released node schemas exercise at least one repeated output label');
});

test('saved automatic definitions repair locally, preserving baseline, values, preview, layout and Undo/Redo', async (t) => {
  for (const row of fixture.recipes)
    await t.test(row.id, () => {
      const old = historicalSplit(fresh(row)),
        original = structuredClone(old),
        root = generate(old);
      assert.equal(modelInputs(root).length, 2);
      const baseline = structuredClone(root.data.blockInstanceV2.definitionSnapshot);
      const next = groups.mergeVisualStageSharedInputs(old, root.id);
      assert.deepEqual(old, original, 'planning is pure');
      assert.equal(modelInputs(generate(next)).length, 1);
      assert.deepEqual(
        generate(next).data.blockInstanceV2.definitionSnapshot,
        baseline,
        'saved library baseline is immutable',
      );
      assert.deepEqual(generate(next).data.blockInstanceV2.presentation, root.data.blockInstanceV2.presentation);
      assert.deepEqual(api(next), api(old));
      assert.deepEqual(api(JSON.parse(JSON.stringify(next))), api(old));
      const store = exporter.useFlowStore,
        previous = store.getState();
      try {
        store.getState().replaceGraph(old);
        store.getState().replaceGraph(next, { historyLabel: 'Merge shared model inputs' });
        store.getState().undo();
        assert.equal(modelInputs(generate(store.getState().toObject())).length, 2);
        store.getState().redo();
        assert.equal(modelInputs(generate(store.getState().toObject())).length, 1);
        assert.deepEqual(api(store.getState().toObject()), api(old));
      } finally {
        store.setState(previous, true);
      }
    });
});

test('Encode Inputs also shares model components across native encoders and repairs saved split ports', async (t) => {
  for (const row of fixture.recipes)
    await t.test(row.id, () => {
      const graph = fresh(row);
      const root = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs');
      if (!root) {
        assert.equal(row.starter.pipelineClass, 'MiniMaxMusic3ModularPipeline', 'Music encodes inside Generate');
        return;
      }
      const ports = modelInputs(root);
      assert.ok(ports.length <= 1, 'Encode Inputs needs one socket for the same model supplier');
      if (!ports[0]?.mirrorBindings?.length) return;
      const old = historicalSplit(graph, 'inputs');
      const baseline = structuredClone(old);
      const next = groups.mergeVisualStageSharedInputs(old, root.id);
      assert.deepEqual(old, baseline);
      const repaired = next.nodes.find((node) => node.id === root.id);
      assert.equal(modelInputs(repaired).length, 1);
      assert.deepEqual(
        repaired.data.blockInstanceV2.definitionSnapshot,
        old.nodes.find((node) => node.id === root.id).data.blockInstanceV2.definitionSnapshot,
      );
      assert.deepEqual(api(next), api(old));
      assert.deepEqual(api(JSON.parse(JSON.stringify(next))), api(old));
    });
});

test('model/task switching keeps shared inputs merged, including repaired historical stages', async (t) => {
  for (const pipeline of ['HunyuanVideo15ModularPipeline', 'MiniMaxH3ModularPipeline'])
    await t.test(pipeline, () => {
      const rows = fixture.recipes.filter((row) => row.starter.pipelineClass === pipeline);
      let graph = fresh(rows[0]);
      graph = groups.mergeVisualStageSharedInputs(historicalSplit(graph), generate(graph).id);
      for (const row of [...rows.slice(1), rows[0]]) {
        const owner = groups
          .unpackVisualOperationGroups(graph)
          .graph.nodes.find((node) => node.data.action === 'ModelsLoader');
        const plan = authoring.planOperationChange(graph, owner.id, row.starter);
        graph = plan.graph;
        assert.equal(modelInputs(generate(graph)).length, 1);
        assert.equal(modelInputs(generate(graph))[0].mirrorBindings.length, 1);
        const inputs = graph.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs');
        if (inputs) {
          const flat = groups.unpackVisualOperationGroups(graph).graph;
          const connected = modelInputs(inputs).filter((port) =>
            [port.binding, ...(port.mirrorBindings ?? [])].some((binding) =>
              flat.edges.some(
                (edge) =>
                  edge.target === `${inputs.id}/${binding.nodeId}` && edge.targetHandle === binding.fieldOrPortId,
              ),
            ),
          );
          // The preservation planner may retain disconnected image encoders
          // after returning to text-only. Those are not shared live suppliers.
          assert.equal(connected.length, 1, 'The active model supplier stays one shared input');
        }
        assert.deepEqual(api(graph), api(groups.unpackVisualOperationGroups(graph).graph));
      }
    });
});

test('changed-task encoder mirrors refuse partial bindings and a foreign declared task', () => {
  const rows = fixture.recipes.filter((row) => row.starter.pipelineClass === 'HunyuanVideo15ModularPipeline');
  const initial = fresh(rows[0]);
  const owner = groups
    .unpackVisualOperationGroups(initial)
    .graph.nodes.find((node) => node.data.action === 'ModelsLoader');
  const changed = authoring.planOperationChange(initial, owner.id, rows[1].starter).graph;
  const inputs = changed.nodes.find((node) => groups.visualOperationGroup(node) === 'inputs');
  assert.equal(modelInputs(inputs)[0].mirrorBindings.length, 2);
  for (const fault of ['partial', 'task']) {
    const previous = structuredClone(inputs);
    if (fault === 'partial') modelInputs(previous)[0].mirrorBindings.pop();
    else previous.data.blockInstanceV2.effectiveGraph.nodes[0].data.operationAuthoring.operation.task = 'foreign-task';
    const unpacked = groups.unpackVisualOperationGroups(changed);
    assert.throws(
      () => groups.groupVisualStages(unpacked.graph, unpacked.members.get(inputs.id), 'inputs', previous),
      /mirrored custom interface/,
      fault,
    );
  }
});

test('different sources, duplicate incoming wires and unrelated value inputs are never merged', () => {
  const row = fixture.recipes[0];
  for (const fault of ['source', 'ambiguous', 'type']) {
    const graph = groups.unpackVisualOperationGroups(fresh(row)).graph;
    const children = graph.nodes.filter((n) => /WorkflowHunyuanVideo15(Denoise|Decode)$/.test(n.data.action));
    const wire = graph.edges.find(
      (edge) => edge.target === children[1].id && edge.targetHandle === 'pipeline_components',
    );
    if (fault === 'source') wire.source += '-different';
    if (fault === 'ambiguous') graph.edges.push({ ...wire, id: 'ambiguous-owner' });
    if (fault === 'type') children[1].data.params.pipeline_components.type = 'string';
    const old = structuredClone(graph);
    const result = groups.groupVisualStages(
      graph,
      children.map((n) => n.id),
      'generate',
    );
    assert.equal(modelInputs(generate(result)).length, 2, fault);
    assert.deepEqual(graph, old);
  }
});

test('empty alternatives remain separate when required, authored or missing their common owner', () => {
  const row = fixture.recipes.find((row) => row.starter.pipelineClass === 'QwenImageModularPipeline');
  for (const fault of ['required', 'authored', 'owner']) {
    const graph = groups.unpackVisualOperationGroups(fresh(row)).graph;
    const children = graph.nodes.filter(
      (n) => n.data.module === 'modules.ModularDiffusers' && ['Denoise', 'DecodeLatents'].includes(n.data.action),
    );
    if (fault === 'required') children[1].data.params.pipeline_components.required = true;
    if (fault === 'authored') children[1].data.params.pipeline_components.value = { source: 'different' };
    if (fault === 'owner') graph.nodes = graph.nodes.filter((n) => n.data.action !== 'ModelsLoader');
    const result = groups.groupVisualStages(
      graph,
      children.map((n) => n.id),
      'generate',
    );
    assert.equal(modelInputs(generate(result)).length, 2, fault);
  }
});

test('Qwen and H3 Image model switching keeps one component input and an unchanged source draft', () => {
  const rows = ['QwenImageModularPipeline', 'MiniMaxH3ImageModularPipeline'].map((name) =>
    fixture.recipes.find((row) => row.starter.pipelineClass === name),
  );
  for (const [source, target] of [rows, [...rows].reverse()]) {
    const graph = fresh(source),
      before = structuredClone(graph);
    const owner = groups
      .unpackVisualOperationGroups(graph)
      .graph.nodes.find((node) => node.data.action === 'ModelsLoader');
    const plan = authoring.planOperationChange(graph, owner.id, target.starter, {
      replaceModel: true,
      baseline: source.starter,
    });
    assert.deepEqual(graph, before);
    assert.equal(modelInputs(generate(plan.graph)).length, 1);
    assert.deepEqual(api(plan.graph), api(groups.unpackVisualOperationGroups(plan.graph).graph));
  }
});
