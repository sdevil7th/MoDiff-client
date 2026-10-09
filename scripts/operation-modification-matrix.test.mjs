import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.resolve(root, '../MoDiff');
const python =
  process.env.MODIFF_BACKEND_PYTHON ||
  path.join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const fixture = path.join(root, 'scripts/operation-starter-fixtures.py');
const starters = JSON.parse(
  execFileSync(
    process.platform === 'win32' ? python : path.join(backend, 'scripts/with-runtime-env.sh'),
    process.platform === 'win32' ? [fixture, '--all-models'] : [python, fixture, '--all-models'],
    { cwd: backend, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  ),
);

test('every published model starter preserves its generic graph and unrelated diagnostics during a compatible change', async (t) => {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  try {
    const a = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
    const { operationOwnsModel } = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
    const schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
    const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
    const { planBlockOperationChange } = await server.ssrLoadModule('/src/workflow/operationBlockChange.ts');
    assert.ok(starters.length >= 250);
    for (const starter of starters) {
      const label = `${starter.pipelineClass}/${starter.task}`;
      await t.test(label, async () => {
        const graph = a.createOperationStarter(starter, { x: 80, y: 100 });
        const loader = graph.nodes.find((n) => operationOwnsModel(n.data.operationAuthoring.operation));
        const custom = {
          id: 'custom-diagnostic',
          type: 'custom',
          position: { x: 1, y: 1 },
          data: {
            type: 'custom',
            module: 'custom.Diagnostics',
            action: 'Observe',
            label: 'My diagnostic',
            params: { text: { type: 'str', value: 'retained diagnostic' } },
          },
        };
        graph.nodes.push(custom);
        const original = structuredClone(graph);
        const plan = a.planOperationChange(graph, loader.id, starter);
        assert.deepEqual(graph, original, label);
        assert.deepEqual(
          plan.graph.nodes.find((n) => n.id === custom.id),
          custom,
          label,
        );
        assert.equal(plan.graph.nodes.length, graph.nodes.length, label);
        assert.deepEqual(plan.diagnostics, [], label);
        assert.equal(
          new Set(plan.graph.edges.map((e) => `${e.target}:${e.targetHandle}`)).size,
          plan.graph.edges.length,
          label,
        );
        const semantic = JSON.parse(
          JSON.stringify({
            nodes: graph.nodes.map((n) => ({ nodeId: n.id, nodeType: n.type, data: n.data })),
            edges: graph.edges.map((e) => ({
              edgeId: e.id,
              sourceNodeId: e.source,
              sourcePortId: e.sourceHandle,
              targetNodeId: e.target,
              targetPortId: e.targetHandle,
            })),
          }),
        );
        semantic.graphHash = schema.blockGraphHashV2(semantic);
        const definition = {
          schemaVersion: 2,
          definitionId: 'user:matrix',
          displayName: 'Matrix Block',
          source: { kind: 'user' },
          graph: semantic,
          boundary: { mode: 'explicit', inputs: [], outputs: [] },
          controls: [],
          suggestedInputs: [],
          previews: [],
          ownership: { kind: 'user', definitionMutable: true },
        };
        definition.contentHash = schema.blockDefinitionContentHashV2(definition);
        const instance = schema.createBlockInstanceV2(definition, {
          instanceId: 'matrix-block',
          position: { x: 80, y: 100 },
          size: { width: 520, height: 640 },
        });
        const canvas = { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] };
        const changed = planBlockOperationChange(canvas, 'matrix-block', loader.id, starter);
        const next = schema.normalizeBlockInstanceV2(
          JSON.parse(JSON.stringify(changed.graph.nodes[0].data.blockInstanceV2)),
        );
        assert.deepEqual(next.definitionSnapshot, definition, label);
        assert.deepEqual(next.effectiveGraph.nodes.find((n) => n.nodeId === custom.id).data, custom.data, label);
        assert.equal(next.effectiveGraph.nodes.length, semantic.nodes.length, label);
        assert.deepEqual(canvas.nodes[0].data.blockInstanceV2, instance, label);
      });
    }
  } finally {
    await server.close();
  }
});

test('every supported cross-model change uses readable review text and carries common authored prompts', async () => {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  try {
    const a = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
    const { operationOwnsModel } = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
    let comparisons = 0;
    for (const source of starters) {
      for (const target of starters) {
        if (source.task !== target.task || source.pipelineClass === target.pipelineClass) continue;
        const graph = a.createOperationStarter(source, { x: 80, y: 100 });
        const loader = graph.nodes.find((node) => operationOwnsModel(node.data.operationAuthoring.operation));
        const sourcePrompt = graph.nodes.find(
          (node) =>
            node.data.params.prompt && !node.data.params.prompt.hidden && node.data.params.prompt.display !== 'output',
        );
        const targetPrompts = target.nodes.filter(
          ({ node }) => node.params.prompt && !node.params.prompt.hidden && node.params.prompt.display !== 'output',
        );
        const authoredPrompt = `Cross-model prompt ${comparisons}`;
        const testPromptMigration = Boolean(sourcePrompt && targetPrompts.length === 1);
        if (testPromptMigration) sourcePrompt.data.params.prompt.value = authoredPrompt;
        const original = structuredClone(graph);
        const plan = a.planOperationChange(graph, loader.id, target, { replaceModel: true, baseline: source });
        assert.deepEqual(graph, original, `${source.pipelineClass} -> ${target.pipelineClass} mutated its source`);
        const text = JSON.stringify(plan.review);
        for (const node of graph.nodes)
          assert.equal(
            text.includes(node.id),
            false,
            `${source.pipelineClass} -> ${target.pipelineClass} exposed internal node id ${node.id}`,
          );
        assert.deepEqual(
          plan.diagnostics,
          [],
          `${source.pipelineClass} -> ${target.pipelineClass} reported a problem for a compatible default graph`,
        );
        if (testPromptMigration)
          assert.ok(
            plan.graph.nodes.some((node) => node.data.params.prompt?.value === authoredPrompt),
            `${source.pipelineClass} -> ${target.pipelineClass} discarded the authored prompt`,
          );
        const sourceShape = source.nodes.some(({ operation }) =>
          ['pipeline', 'integrated'].includes(operation.decomposition),
        );
        const targetShape = target.nodes.some(({ operation }) =>
          ['pipeline', 'integrated'].includes(operation.decomposition),
        );
        if (sourceShape !== targetShape) {
          assert.equal(plan.review.required, true);
          assert.ok(plan.review.changes.some((message) => /because this model uses/u.test(message)));
          assert.equal(
            plan.graph.nodes.some((node) => node.data.uiState?.disabled && node.data.operationAuthoring),
            false,
            `${source.pipelineClass} -> ${target.pipelineClass} left obsolete managed nodes disabled`,
          );
        }
        comparisons += 1;
      }
    }
    assert.ok(comparisons >= 4_000, `Only ${comparisons} cross-model changes were checked`);
  } finally {
    await server.close();
  }
});

test('modular image graph to GLM keeps authored controls, custom prompt wiring and preview wiring', async () => {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  try {
    const a = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
    const source = starters.find(
      (starter) => starter.pipelineClass === 'ZImageModularPipeline' && starter.task === 'text_to_image',
    );
    const target = starters.find(
      (starter) => starter.pipelineClass === 'GlmImagePipeline' && starter.task === 'text_to_image',
    );
    assert.ok(source && target);
    const graph = a.createOperationStarter(source, { x: 80, y: 100 });
    const loader = graph.nodes.find((node) => node.data.action === 'ModelsLoader');
    const encode = graph.nodes.find((node) => node.data.action === 'EncodePrompt');
    const denoise = graph.nodes.find((node) => node.data.action === 'Denoise');
    const decode = graph.nodes.find((node) => node.data.action === 'DecodeLatents');
    encode.data.params.prompt.value = 'User-edited GLM migration prompt';
    denoise.data.params.width.value = 768;
    denoise.data.params.num_inference_steps.value = 19;
    graph.nodes.push(
      {
        id: 'custom-prefix',
        type: 'custom',
        position: { x: -400, y: 0 },
        data: {
          label: 'Prompt Prefix',
          module: 'custom.Test',
          action: 'Prefix',
          params: { result: { label: 'Prompt', type: 'string', display: 'output' } },
        },
      },
      {
        id: 'preview',
        type: 'custom',
        position: { x: 1600, y: 0 },
        data: {
          label: 'Preview Image',
          module: 'modules.Image',
          action: 'Preview',
          params: { image: { label: 'Image', type: 'image', display: 'input' } },
        },
      },
    );
    graph.edges.push(
      {
        id: 'custom-prompt',
        source: 'custom-prefix',
        sourceHandle: 'result',
        target: encode.id,
        targetHandle: 'prompt_input',
      },
      {
        id: 'preview-image',
        source: decode.id,
        sourceHandle: 'images',
        target: 'preview',
        targetHandle: 'image',
      },
    );
    const plan = a.planOperationChange(graph, loader.id, target, {
      replaceModel: true,
      baseline: source,
    });
    assert.deepEqual(plan.diagnostics, []);
    assert.equal(
      plan.graph.nodes.some((node) => node.data.uiState?.disabled),
      false,
    );
    const generate = plan.graph.nodes.find((node) => node.data.label === 'Generate Image');
    assert.ok(generate);
    assert.equal(generate.data.params.prompt.value, 'User-edited GLM migration prompt');
    assert.equal(generate.data.params.width.value, 768);
    assert.equal(generate.data.params.num_inference_steps.value, 19);
    assert.ok(
      plan.graph.edges.some(
        (edge) => edge.source === 'custom-prefix' && edge.target === generate.id && edge.targetHandle === 'prompt',
      ),
    );
    assert.ok(
      plan.graph.edges.some(
        (edge) => edge.source === generate.id && edge.sourceHandle === 'images' && edge.target === 'preview',
      ),
    );
    assert.match(plan.review.changes.join(' '), /whole-pipeline nodes/u);
    assert.match(plan.review.preserved.join(' '), /Width: 768/u);
    assert.doesNotMatch(JSON.stringify(plan.review), /node-[A-Za-z0-9_-]+/u);
  } finally {
    await server.close();
  }
});

test('ordinary same-pipeline profile and task Apply retains exact workflow bindings through visual groups', async () => {
  const selections = [
    ['nano-image', 'text_to_image', 'cosmos3-nano:official-modular-workflow'],
    ['super-image', 'text_to_image', 'cosmos3-super-text-to-image:official-modular-workflow'],
    ['nano-video', 'text_to_video', 'cosmos3-nano:official-modular-workflow'],
  ].map(([id, task, executionProfileId]) => ({
    id,
    selection: {
      pipelineClass: 'Cosmos3OmniModularPipeline',
      task,
      executionProfileId,
      bindingSpec: { modelType: 'Cosmos3OmniModularPipeline', mode: task },
    },
  }));
  const profiles = JSON.parse(
    execFileSync(
      process.platform === 'win32' ? python : path.join(backend, 'scripts/with-runtime-env.sh'),
      process.platform === 'win32'
        ? [path.join(root, 'scripts/template-operation-fixtures.py')]
        : [python, path.join(root, 'scripts/template-operation-fixtures.py')],
      { cwd: backend, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input: JSON.stringify(selections) },
    ),
  );
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    define: { 'import.meta.env.VITE_SERVER_ADDRESS': JSON.stringify('http://127.0.0.1:5191') },
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  try {
    const a = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
    const contracts = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
    const request = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
    const groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
    const operations = contracts.parseOperationContracts(
      profiles.publicPayload.operationContracts,
      profiles.publicPayload.operationContractSchemaVersion,
    );
    const recipes = profiles.recipes.map((row) =>
      request.parseOperationStarter(row.starter, row.starter.pipelineClass, row.starter.task, operations),
    );
    const owner = (graph) =>
      graph.nodes.find((node) => contracts.operationOwnsModel(a.operationAuthoring(node)?.operation));
    function checkBindings(graph, recipe) {
      const flat = groups.unpackVisualOperationGroups(graph).graph;
      for (const { operation } of recipe.nodes) {
        const node = flat.nodes.find((n) => a.operationAuthoring(n)?.operation.operationId === operation.operationId);
        assert.ok(node, operation.operationId);
        assert.deepEqual(a.operationAuthoring(node).operation.binding, operation.binding);
        for (const [name, value] of Object.entries(operation.binding.values))
          assert.equal(a.operationFieldValue(node.data.params[name]), value, `${operation.operationId}.${name}`);
      }
      const loader = owner(flat);
      assert.equal(loader.data.params.workflow_id.value, recipe.workflowId);
      assert.equal(a.operationAuthoring(loader).operation.binding.values.workflow_id, recipe.workflowId);
      return flat;
    }
    for (const grouped of [false, true]) {
      let graph = a.createOperationStarter(recipes[0], { x: 80, y: 100 });
      const loader = owner(graph);
      // The actual failed production starter had an empty hidden loader field.
      // A fresh reviewed Apply must replace that stored value with its binding.
      loader.data.params.workflow_id.value = '';
      loader.data.operationAuthoring.authored = ['workflow_id'];
      const prompt = graph.nodes.find((node) => node.data.params.prompt);
      prompt.data.params.prompt.value = 'Keep my authored caption through model and task changes.';
      prompt.data.operationAuthoring.authored = ['prompt'];
      if (grouped) graph = groups.groupNewOperationGraph(graph);
      const before = structuredClone(graph);
      const ownerId = loader.id;
      for (const preserveValues of [false, true]) {
        const plan = a.planOperationChange(graph, ownerId, recipes[1], { replaceModel: true, preserveValues });
        const next = checkBindings(plan.graph, recipes[1]);
        assert.equal(owner(next).data.params.repo_id.value.value, 'nvidia/Cosmos3-Super-Text2Image');
        assert.equal(owner(next).data.params.reviewed_variant.value, 'nvidia/Cosmos3-Super-Text2Image');
        assert.equal(
          next.nodes.find((node) => node.data.params.prompt).data.params.prompt.value,
          'Keep my authored caption through model and task changes.',
        );
        assert.equal(owner(next).data.params.revision.value, 'daf3d374804be4c512c2135568a7cb95d4341d79');
        assert.deepEqual(graph, before, 'Previewing a change must not mutate the source graph.');
        const video = a.planOperationChange(plan.graph, ownerId, recipes[2], { replaceModel: true });
        checkBindings(video.graph, recipes[2]);
        const returned = a.planOperationChange(video.graph, ownerId, recipes[0], { replaceModel: true });
        checkBindings(returned.graph, recipes[0]);
        const reset = a.planOperationChange(returned.graph, ownerId, recipes[0], { restoreDefaults: true });
        checkBindings(reset.graph, recipes[0]);
      }
    }
  } finally {
    await server.close();
  }
});
