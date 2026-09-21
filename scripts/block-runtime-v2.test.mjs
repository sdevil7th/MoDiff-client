import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let runtime;
let runReadiness;
let schema;
let flowStore;
let blockValueTypes;
let blockAuthority;
let connectionTypeCompatibility;
let nodeConnectorResolution;
let studioStore;
let server;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.window = {
    dispatchEvent: () => true,
    localStorage: globalThis.localStorage,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  runReadiness = await server.ssrLoadModule('/src/studio/runReadiness.ts');
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  flowStore = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  blockValueTypes = await server.ssrLoadModule('/src/studio/blockValueTypeCompatibilityV2.ts');
  blockAuthority = await server.ssrLoadModule('/src/studio/blockExecutionAuthorityV2.ts');
  connectionTypeCompatibility = await server.ssrLoadModule('/src/theme/connectionTypeCompatibility.ts');
  nodeConnectorResolution = await server.ssrLoadModule('/src/studio/nodeConnectorResolution.ts');
  studioStore = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
});

test('duplicating an ordinary projected leaf creates a durable independent semantic node', () => {
  const original = runtime.setBlockPresentationV2(instance('duplicate-leaf', { prompt: 'saved prompt', steps: 23 }), {
    expanded: true,
  });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(original));
  flowStore.useFlowStore.setState({ ...projection, history: [], historyIndex: -1 });
  const leaf = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const cloneId = flowStore.useFlowStore.getState().duplicateNode(leaf.id);
  const state = flowStore.useFlowStore.getState();
  const changed = state.nodes.find((node) => node.id === original.instanceId).data.blockInstanceV2;
  assert.equal(changed.effectiveGraph.nodes.length, original.effectiveGraph.nodes.length + 1);
  const cloned = changed.effectiveGraph.nodes.find(
    (node) => node.nodeId !== 'generate' && node.data.action === 'Generate',
  );
  assert.ok(cloned);
  // NanoID may start with '_' or '-'; semantic IDs require an alphanumeric prefix.
  assert.match(cloned.nodeId, /^node-[A-Za-z0-9_-]+$/u);
  assert.equal(cloned.data.params.prompt.value, 'saved prompt');
  assert.equal(cloned.data.params.steps.value, 23);
  assert.deepEqual(changed.effectiveGraph.edges, original.effectiveGraph.edges);
  assert.deepEqual(changed.effectiveInterface, original.effectiveInterface);
  assert.deepEqual(changed.values, original.values);
  assert.deepEqual(changed.definitionSnapshot, original.definitionSnapshot);
  assert.equal(state.nodes.find((node) => node.id === cloneId).data.blockProjectionNodeId, cloned.nodeId);
  const persisted = runtime.canonicalizePersistedBlockGraphV2(state.nodes, state.edges);
  const restored = runtime.materializeBlockProjectionV2(persisted.nodes[0]);
  assert.doesNotThrow(() => runtime.expandBlockGraphV2ForExecution(restored.nodes, restored.edges));
  assert.equal(restored.nodes.filter((node) => node.data.blockProjectionNodeId === cloned.nodeId).length, 1);
  state.undo();
  assert.deepEqual(
    flowStore.useFlowStore.getState().nodes.find((node) => node.id === original.instanceId).data.blockInstanceV2
      .effectiveGraph,
    original.effectiveGraph,
  );
  flowStore.useFlowStore.getState().redo();
  assert.deepEqual(
    flowStore.useFlowStore.getState().nodes.find((node) => node.id === original.instanceId).data.blockInstanceV2
      .effectiveGraph,
    changed.effectiveGraph,
  );
  const editedOriginal = runtime.setBlockInstanceValueV2(changed, 'prompt', 'original edited later');
  assert.equal(
    editedOriginal.effectiveGraph.nodes.find((node) => node.nodeId === cloned.nodeId).data.params.prompt.value,
    'saved prompt',
  );
});

test('new ordinary nodes and duplicated Block roots have adoption-safe IDs', async () => {
  const { createNodeFromRegistry } = await server.ssrLoadModule('/src/workflow/nodeFactory.ts');
  const created = createNodeFromRegistry('fixture', { fixture: { type: 'custom', params: {} } }, { x: 0, y: 0 });
  assert.match(created.id, /^node-[A-Za-z0-9_-]+$/u);
  const original = instance('duplicate-root', { prompt: 'saved prompt', steps: 23 });
  const root = runtime.createBlockRootNodeV2(original);
  flowStore.useFlowStore.setState({ nodes: [root], edges: [], history: [], historyIndex: -1 });
  const cloneId = flowStore.useFlowStore.getState().duplicateNode(root.id);
  assert.match(cloneId, /^node-[A-Za-z0-9_-]+$/u);
  const copied = flowStore.useFlowStore.getState().nodes.find((node) => node.id === cloneId).data.blockInstanceV2;
  assert.deepEqual(copied.values, original.values);
  assert.deepEqual(copied.effectiveGraph, original.effectiveGraph);
  assert.deepEqual(copied.definitionSnapshot, original.definitionSnapshot);
});

test('a public boundary socket does not erase its ordinary internal editable widget', () => {
  const original = runtime.setBlockPresentationV2(
    instance('public-leaf-widget', { prompt: 'saved prompt', steps: 23 }),
    {
      expanded: true,
    },
  );
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(original));
  const leaf = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  assert.equal(leaf.data.params.prompt.display, 'textarea', 'keep the editable widget alongside its boundary alias');
  const widget = Object.entries(leaf.data.params).find(
    ([, param]) =>
      !param.hidden && param.display === 'textarea' && param.fieldOptions?.blockBindingV2?.logicalId === 'prompt',
  );
  assert.ok(widget, 'the expanded internal node must still expose the authored Prompt control');
  assert.equal(widget[1].value, 'saved prompt');
  flowStore.useFlowStore.setState({ ...projection, history: [], historyIndex: -1 });
  flowStore.useFlowStore.getState().setParamWithHistory(leaf.id, widget[0], 'edited inside');
  const state = flowStore.useFlowStore.getState();
  const changed = state.nodes.find((node) => node.id === original.instanceId).data.blockInstanceV2;
  assert.deepEqual(changed.values, { prompt: 'edited inside', steps: 23 });
  assert.deepEqual(changed.effectiveGraph, original.effectiveGraph);
  assert.deepEqual(changed.definitionSnapshot, original.definitionSnapshot);
  const execution = runtime.expandBlockGraphV2ForExecution(state.nodes, state.edges);
  const executed = execution.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  assert.equal(executed.data.params.prompt.value, 'edited inside');
  assert.equal(
    Object.keys(executed.data.params).some((key) => key.startsWith('block-control:')),
    false,
  );
});

test('port-heavy ordinary leaves reserve controls and remain inside their root without rewriting saved sizes', () => {
  let original = instance('port-heavy-leaf', { prompt: 'saved prompt', steps: 23 });
  const graph = structuredClone(original.effectiveGraph);
  const source = graph.nodes.find((node) => node.nodeId === 'generate');
  for (let index = 0; index < 30; index += 1) {
    source.data.params[`optional_${index}`] = { type: 'tensor', display: 'input' };
  }
  original = runtime.replaceBlockEffectiveGraphV2(original, graph);
  original = runtime.setBlockPresentationV2(original, {
    expanded: true,
    internalLayout: { ...original.presentation.internalLayout, generate: { x: 20, y: 80, width: 340, height: 112 } },
  });
  const before = JSON.stringify(original);
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(original));
  const leaf = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const root = projection.nodes.find((node) => node.id === original.instanceId);
  assert.ok(leaf.height >= 44 + 32 + 30 * 24 + 120);
  assert.ok(root.height > leaf.position.y + leaf.height);
  assert.equal(JSON.stringify(original), before);
});

test('Block V2 public connector projection is reused for one immutable instance', () => {
  const current = instance('connector-cache', { prompt: 'one exact prompt', steps: 12 });
  const node = runtime.createBlockRootNodeV2(current);
  const first = nodeConnectorResolution.nodeConnectorParams(node);
  const second = nodeConnectorResolution.nodeConnectorParams(node);
  assert.equal(second, first);
  assert.deepEqual(Object.keys(first).sort(), ['images', 'prompt'].sort());

  const updated = runtime.setBlockInstanceValueV2(current, 'prompt', 'a different prompt');
  const updatedNode = runtime.createBlockRootNodeV2(updated);
  const third = nodeConnectorResolution.nodeConnectorParams(updatedNode);
  assert.notEqual(third, first);
  assert.equal(third.prompt.value, 'a different prompt');
});

test('projected leaf connectors use V2 scalar aliases without rewriting schemas or ordinary nodes', () => {
  const params = {
    prompt_2: { type: 'text', display: 'input' },
    output: { type: 'builtins.str', display: 'output' },
    references: { type: 'list[str]', display: 'input' },
  };
  const node = { data: { params, blockProjectionOwnerId: 'root', blockProjectionNodeId: 'leaf' } };
  const resolved = nodeConnectorResolution.nodeConnectorParams(node);
  assert.equal(resolved.prompt_2.type, 'string');
  assert.equal(resolved.output.type, 'string');
  assert.equal(resolved.references.type, 'list[str]');
  assert.equal(nodeConnectorResolution.nodeConnectorParams(node), resolved);
  assert.equal(params.prompt_2.type, 'text');
  assert.equal(nodeConnectorResolution.nodeConnectorParams({ data: { params } }), params);
  assert.equal(connectionTypeCompatibility.connectionTypesAreCompatible('string', resolved.prompt_2.type), true);
});

test('a rejected structural drag restores geometry without undoing current prompt edits or retaining new layout entries', () => {
  const before = instance('rejected-drag', { prompt: 'original', steps: 12 });
  const changedValue = runtime.setBlockInstanceValueV2(before, 'prompt', 'keep this current value');
  const dragged = runtime.setBlockPresentationV2(changedValue, {
    position: { x: 800, y: 700 },
    internalLayout: { generate: { x: 5000, y: 6000, width: 400, height: 500 } },
  });
  const restored = runtime.setBlockPresentationV2(
    dragged,
    runtime.rejectedBlockDragPresentationPatchV2(before.presentation, dragged.presentation),
  );
  assert.deepEqual(restored.presentation, before.presentation);
  assert.deepEqual(restored.values, changedValue.values);
  assert.deepEqual(restored.effectiveGraph, before.effectiveGraph);
  assert.deepEqual(restored.effectiveInterface, before.effectiveInterface);
});

test('runtime public projections revalidate each call and never reuse authority after caller mutation', () => {
  for (const name of [
    'blockViewModelV2',
    'blockControlParamsV2',
    'blockConnectorParamsV2',
    'blockPreviewViewsV2',
    'blockModularParentIdsV2',
    'blockExpandedProjectionSizeV2',
    'createBlockRootNodeV2',
  ]) {
    const current = instance(`strict-${name}`);
    const before = JSON.stringify(current);
    runtime[name](current);
    assert.equal(JSON.stringify(current), before, `${name} must not mutate its input`);
    current.effectiveGraph.nodes[0].data.label = 'tampered after validation';
    assert.throws(() => runtime[name](current), /graphHash/u, `${name} must reject the now-stale hash`);
  }
  for (const name of ['canonicalizePersistedBlockGraphV2', 'expandBlockGraphV2ForExecution']) {
    const root = runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(instance(), { expanded: true }));
    const graph = runtime.materializeBlockProjectionV2(root);
    runtime[name](graph.nodes, graph.edges);
    const forged = structuredClone(graph.edges);
    assert.ok(forged.length);
    forged[0].targetHandle = 'forged-handle-after-first-projection';
    assert.throws(() => runtime[name](graph.nodes, forged), /receipt and projected endpoints disagree/u);
  }
});

test('Block V2 and ordinary graphs share scalar aliases while retaining collection and numeric boundaries', () => {
  assert.equal(blockValueTypes.blockValueTypesAreCompatibleV2('builtins.str', 'text'), true);
  assert.equal(blockValueTypes.blockValueTypesAreCompatibleV2('str', 'string'), true);
  assert.equal(blockValueTypes.blockValueTypesAreCompatibleV2('builtins.boolean', 'bool'), true);
  assert.equal(blockValueTypes.blockValueTypesAreCompatibleV2('builtins.int', 'integer'), true);
  assert.equal(blockValueTypes.blockValueTypesAreCompatibleV2('builtins.int', 'float'), true);
  assert.equal(blockValueTypes.blockValueTypesAreCompatibleV2('float', 'int'), false);
  assert.equal(blockValueTypes.normalizeBlockValueTypeV2('builtins.float'), 'float');
  assert.equal(blockValueTypes.blockValueTypesAreCompatibleV2('builtins.str', 'dropdown'), true);
  assert.equal(blockValueTypes.normalizeBlockValueTypeV2('list[str]'), 'list[str]');
  assert.equal(blockValueTypes.blockValueTypesAreCompatibleV2('list[str]', 'string'), false);
  assert.equal(connectionTypeCompatibility.connectionTypesAreCompatible('str', 'string'), true);
  assert.equal(connectionTypeCompatibility.connectionTypesAreCompatible('text', 'string'), true);
  assert.equal(connectionTypeCompatibility.connectionTypesAreCompatible('list[str]', 'string'), false);
  assert.equal(connectionTypeCompatibility.connectionTypesAreCompatible('int', 'float'), false);
});

test('registered Block V2 Auto authority is exact and Expert/manual readiness never requires it', () => {
  const nowMs = Date.parse('2026-09-01T12:00:00Z');
  const current = instance('auto-authority', { prompt: 'one exact prompt', steps: 12 });
  assert.deepEqual(blockAuthority.registeredBlockAutoAuthorityStatusV2(current, nowMs), {
    required: true,
    ready: false,
    code: 'missing',
    instanceId: current.instanceId,
    reason: 'No planner-issued Auto receipt is attached to this workflow instance.',
  });

  const authorized = withAutoAuthority(current, {}, nowMs);
  assert.equal(blockAuthority.registeredBlockAutoAuthorityStatusV2(authorized, nowMs).ready, true);
  assert.equal(
    blockAuthority.registeredBlockAutoAuthorityStatusV2(
      withAutoAuthority(current, { artifactRevisions: { 'owner/model': 'c'.repeat(40) } }, nowMs),
      nowMs,
    ).code,
    'stale',
  );
  assert.equal(
    blockAuthority.registeredBlockAutoAuthorityStatusV2(
      withAutoAuthority(
        current,
        {
          issuedAt: new Date(nowMs - 120_000).toISOString(),
          expiresAt: new Date(nowMs - 1).toISOString(),
        },
        nowMs,
      ),
      nowMs,
    ).code,
    'stale',
  );
  const changedWithoutReceiptRefresh = schema.normalizeBlockInstanceV2({
    ...authorized,
    values: { ...authorized.values, prompt: 'changed after planning' },
  });
  assert.equal(blockAuthority.registeredBlockAutoAuthorityStatusV2(changedWithoutReceiptRefresh, nowMs).code, 'stale');

  flowStore.useFlowStore.setState({ nodes: [runtime.createBlockRootNodeV2(current)], edges: [] });
  const currentForm = studioStore.useStudioStore.getState().form;
  studioStore.useStudioStore.setState({ form: { ...currentForm, resourceMode: 'auto' } });
  let issues = runReadiness.collectRunReadinessIssues({
    sid: 'auto-authority',
    isConnected: true,
    includeStudio: false,
  });
  assert.equal(
    issues.some(({ code, blocking }) => code === 'workflow_auto_plan_pending' && !blocking),
    true,
  );

  studioStore.useStudioStore.setState({ form: { ...currentForm, resourceMode: 'expert' } });
  issues = runReadiness.collectRunReadinessIssues({
    sid: 'manual-authority',
    isConnected: true,
    includeStudio: false,
  });
  assert.equal(
    issues.some(({ code }) => code?.startsWith('block_v2_auto_authority_')),
    false,
  );

  const readyForReadiness = withAutoAuthority(current, {}, Date.now());
  flowStore.useFlowStore.setState({ nodes: [runtime.createBlockRootNodeV2(readyForReadiness)], edges: [] });
  studioStore.useStudioStore.setState({ form: { ...currentForm, resourceMode: 'auto' } });
  issues = runReadiness.collectRunReadinessIssues({
    sid: 'ready-authority',
    isConnected: true,
    includeStudio: false,
  });
  assert.equal(
    issues.some(({ code }) => code?.startsWith('block_v2_auto_authority_')),
    false,
  );
  studioStore.useStudioStore.setState({ form: currentForm });
});

after(async () => {
  await server?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
});

function graph() {
  const semantic = {
    nodes: [
      {
        nodeId: 'load',
        nodeType: 'custom',
        semanticRole: 'loadModels',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Load',
          params: {
            repository: { type: 'string', value: 'owner/model', disabled: true },
            components: { type: 'pipeline_components', display: 'output' },
          },
        },
      },
      {
        nodeId: 'generate',
        nodeType: 'custom',
        semanticRole: 'generate',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          params: {
            components: { type: 'pipeline_components', display: 'input' },
            prompt: { type: 'string', display: 'textarea', default: 'creator default', required: true },
            steps: { type: 'int', default: 28, min: 1, max: 100 },
            images: { type: 'list[image]', display: 'output' },
          },
        },
      },
      {
        nodeId: 'preview',
        nodeType: 'custom',
        semanticRole: 'preview',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Preview',
          params: { images: { type: 'list[image]', display: 'ui_image' } },
        },
      },
    ],
    edges: [
      {
        edgeId: 'components',
        sourceNodeId: 'load',
        sourcePortId: 'components',
        targetNodeId: 'generate',
        targetPortId: 'components',
      },
      {
        edgeId: 'preview-images',
        sourceNodeId: 'generate',
        sourcePortId: 'images',
        targetNodeId: 'preview',
        targetPortId: 'images',
      },
    ],
    executionOrder: ['load', 'generate', 'preview'],
  };
  return { ...semantic, graphHash: schema.blockGraphHashV2(semantic) };
}

function definition() {
  const blockGraph = graph();
  const withoutHash = {
    schemaVersion: 2,
    definitionId: 'diffusers:test:text2image',
    displayName: 'Test — Text To Image',
    description: 'One source-neutral V2 composite fixture.',
    source: {
      kind: 'diffusers_catalog',
      catalogCategory: 'diffusers',
      provider: 'huggingface',
      library: 'diffusers',
      libraryRevision: 'a'.repeat(40),
      pipelineClass: 'TestModularPipeline',
      blocksClass: 'TestBlocks',
      workflow: 'text2image',
      manifestDefinitionId: 'diffusers:TestModularPipeline:text2image',
      manifestContentHash: 'manifest-content-v2',
      executionAdmissionId: 'diffusers:test-admission:text2image',
      repository: 'owner/model',
      repositoryRevision: 'b'.repeat(40),
    },
    graph: blockGraph,
    boundary: {
      mode: 'explicit',
      inputs: [
        {
          portId: 'prompt',
          label: 'Prompt',
          valueType: 'string',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'prompt' },
        },
      ],
      outputs: [
        {
          portId: 'images',
          label: 'Images',
          valueType: 'list[image]',
          required: true,
          multiple: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'images' },
        },
      ],
    },
    controls: [
      {
        controlId: 'prompt',
        label: 'Prompt',
        binding: { nodeId: 'generate', fieldId: 'prompt' },
        valueType: 'string',
        defaultValue: 'creator default',
        required: true,
        order: 0,
      },
      {
        controlId: 'steps',
        label: 'Steps',
        binding: { nodeId: 'generate', fieldId: 'steps' },
        valueType: 'int',
        defaultValue: 28,
        order: 1,
      },
      {
        controlId: 'repository',
        label: 'Repository',
        binding: { nodeId: 'load', fieldId: 'repository' },
        valueType: 'string',
        defaultValue: 'owner/model',
        sealed: true,
        order: 2,
      },
    ],
    suggestedInputs: [
      {
        suggestionId: 'creator-example',
        label: 'Creator example',
        source: 'https://huggingface.co/owner/model',
        values: { prompt: 'A creator-provided copper observatory.' },
      },
    ],
    previews: [{ nodeId: 'preview', outputPortId: 'images', mediaType: 'image', primary: true }],
    ownership: { kind: 'registered', definitionMutable: false },
  };
  return { ...withoutHash, contentHash: schema.blockDefinitionContentHashV2(withoutHash) };
}

function instance(id = 'instance-a', values = { prompt: '', steps: 0 }) {
  return schema.createBlockInstanceV2(definition(), {
    instanceId: id,
    position: { x: 100, y: 200 },
    size: { width: 640, height: 720 },
    values,
    internalLayout: {
      load: { x: 32, y: 80, width: 300, height: 220 },
      generate: { x: 380, y: 80, width: 320, height: 280 },
      preview: { x: 748, y: 80, width: 300, height: 240 },
    },
  });
}

test('outside LoRA connects to an undeclared internal input and survives collapse, persistence and explicit moves', async () => {
  const crossing = await server.ssrLoadModule('/src/studio/blockCrossingConnectionsV2.ts');
  const persistence = await server.ssrLoadModule('/src/studio/blockDefinitionPersistenceV2.ts');
  let current = instance('outside-lora', { prompt: 'keep prompt', steps: 23 });
  const graph = structuredClone(current.effectiveGraph);
  graph.nodes.find((node) => node.nodeId === 'load').data.params.lora = {
    display: 'input',
    type: 'custom_lora',
  };
  current = runtime.setBlockPresentationV2(runtime.replaceBlockEffectiveGraphV2(current, graph), { expanded: true });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current));
  const outside = {
    id: 'external-lora',
    type: 'custom',
    position: { x: -400, y: 100 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Lora',
      params: {
        lora: { display: 'output', type: 'custom_lora' },
      },
    },
  };
  flowStore.useFlowStore.setState({
    ...projection,
    nodes: [outside, ...projection.nodes],
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  flowStore.useFlowStore.getState().onConnect({
    source: outside.id,
    sourceHandle: 'lora',
    target: runtime.blockProjectionNodeIdV2(current.instanceId, 'load'),
    targetHandle: 'lora',
  });
  let state = flowStore.useFlowStore.getState();
  assert.ok(
    state.edges.some((edge) => edge.source === outside.id),
    'native connection must be committed',
  );
  const visible = crossing.blockCrossingSurfaceV2(state.nodes, state.edges);
  assert.equal(
    visible.edges.find((edge) => edge.source === outside.id).target,
    runtime.blockProjectionNodeIdV2(current.instanceId, 'load'),
  );
  const before = runtime.canonicalizePersistedBlockGraphV2(state.nodes, state.edges);
  assert.deepEqual(
    before.nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2.effectiveInterface,
    current.effectiveInterface,
  );
  state.toggleUserBlockExpanded(current.instanceId);
  state = flowStore.useFlowStore.getState();
  assert.equal(
    Object.keys(crossing.blockCrossingSurfaceV2(state.nodes, state.edges).paramsByNodeId.get(current.instanceId))
      .length,
    1,
  );
  const saved = runtime.canonicalizePersistedBlockGraphV2(state.nodes, state.edges);
  const execution = runtime.expandBlockGraphV2ForExecution(saved.nodes, saved.edges);
  assert.ok(
    execution.edges.some(
      (edge) =>
        edge.source === outside.id &&
        edge.target === runtime.blockProjectionNodeIdV2(current.instanceId, 'load') &&
        edge.targetHandle === 'lora',
    ),
  );
  const isolated = state.exportGraph('scope-test', current.instanceId);
  assert.ok(isolated.nodes[outside.id], 'Run Block must honor its connected outside LoRA');
  const whole = state.exportGraph('scope-test');
  assert.ok(whole.nodes[outside.id], 'whole graph must include outside LoRA');
  const reusable = persistence.reusableBlockDefinitionFromInstanceV2(
    state.nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2,
    { choice: 'new', definitionId: 'user:without-outside-lora', displayName: 'My Qwen Block' },
  );
  assert.deepEqual(reusable.boundary, current.effectiveInterface.boundary);
  assert.equal(
    reusable.graph.nodes.some((node) => node.nodeId === outside.id),
    false,
  );
  state.toggleUserBlockExpanded(current.instanceId);
  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(outside.id, current.instanceId);
  state = flowStore.useFlowStore.getState();
  assert.ok(
    state.exportGraph('scope-test', current.instanceId).nodes[
      runtime.blockProjectionNodeIdV2(current.instanceId, outside.id)
    ],
    'a source moved inside participates in Run Block',
  );
  const moved = state.moveNodeOutOfBlockV2(runtime.blockProjectionNodeIdV2(current.instanceId, outside.id), {
    x: -400,
    y: 100,
  });
  state = flowStore.useFlowStore.getState();
  assert.ok(state.edges.some((edge) => edge.source === moved));
  assert.ok(state.exportGraph('scope-test', current.instanceId).nodes[moved]);
  state.removeEdges(state.edges.find((edge) => edge.source === outside.id).id);
  assert.equal(
    flowStore.useFlowStore.getState().edges.some((edge) => edge.source === outside.id),
    false,
  );
  const disconnected = flowStore.useFlowStore.getState();
  assert.equal(crossing.blockCrossingSurfaceV2(disconnected.nodes, disconnected.edges).paramsByNodeId.size, 0);
});

function withAutoAuthority(instanceValue, overrides = {}, nowMs = Date.parse('2026-09-01T12:00:00Z')) {
  return schema.normalizeBlockInstanceV2({
    ...instanceValue,
    authorities: [
      {
        kind: 'auto',
        definitionId: instanceValue.definitionRef.definitionId,
        definitionContentHash: instanceValue.definitionRef.contentHash,
        effectiveGraphHash: instanceValue.effectiveGraph.graphHash,
        executionParameterHash: blockAuthority.blockExecutionParameterHashV2(instanceValue),
        artifactRevisions: { 'owner/model': 'b'.repeat(40) },
        admissionId: instanceValue.definitionSnapshot.source.executionAdmissionId,
        issuedAt: new Date(nowMs - 60_000).toISOString(),
        expiresAt: new Date(nowMs + 60_000).toISOString(),
        ...overrides,
      },
    ],
  });
}

function ordinaryNode(id, params) {
  return {
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: id,
      label: id,
      category: 'Test',
      params,
    },
  };
}

function sortedExecution(graphValue) {
  return {
    nodes: [...graphValue.nodes]
      .map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        module: node.data.module,
        action: node.data.action,
        params: node.data.params,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...graphValue.edges]
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: edge.target,
        targetHandle: edge.targetHandle,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

test('one source-neutral block root is canonical for every V2 source', () => {
  const root = runtime.createBlockRootNodeV2(instance(), { selected: true });
  assert.equal(runtime.isBlockRootV2(root), true);
  assert.equal(root.id, 'instance-a');
  assert.equal(root.type, 'block');
  assert.equal(root.data.type, 'block');
  assert.equal(root.data.module, 'MoDiff');
  assert.equal(root.data.action, 'BlockV2');
  assert.equal(root.data.category, 'Diffusers');
  assert.deepEqual(root.data.params, {});
  assert.deepEqual(root.position, { x: 100, y: 200 });
  assert.equal(root.width, 640);
  assert.equal(root.height, 720);
  assert.equal(root.data.userBlockSnapshot, undefined);
  assert.equal(root.data.huggingFaceClusterInstance, undefined);

  for (const [field, value] of [
    ['userBlockSnapshot', {}],
    ['userBlockInstanceId', 'legacy-user-instance'],
    ['huggingFaceClusterExecutionRole', 'generate'],
    ['huggingFaceClusterPath', 'root.denoise'],
  ]) {
    const dualAuthority = structuredClone(root);
    dualAuthority.data[field] = value;
    assert.equal(runtime.isBlockRootV2(dualAuthority), false);
    assert.throws(() => runtime.canonicalizePersistedBlockRootV2(dualAuthority), /legacy authority/u);
  }
});

test('controls and connectors are separate projections even when a logical id is shared', () => {
  const current = instance();
  const controls = runtime.blockControlParamsV2(current);
  const connectors = runtime.blockConnectorParamsV2(current);
  const view = runtime.blockViewModelV2(current);

  assert.equal(controls.prompt.display, 'textarea');
  assert.equal(controls.prompt.value, '');
  assert.equal(controls.steps.value, 0);
  assert.equal(controls.repository.disabled, true);
  assert.equal(connectors.inputs.prompt.display, 'input');
  assert.equal(connectors.inputs.prompt.value, '');
  assert.equal(connectors.outputs.images.display, 'output');
  assert.notStrictEqual(controls.prompt, connectors.inputs.prompt);
  assert.equal(controls.prompt.fieldOptions.blockBindingV2.logicalId, 'prompt');
  assert.equal(connectors.inputs.prompt.fieldOptions.blockBindingV2.logicalId, 'prompt');
  assert.equal(view.controlParams.prompt.display, 'textarea');
  assert.equal(view.connectorParams.inputs.prompt.display, 'input');
  assert.equal(view.suggestedInputs[0].values.prompt, 'A creator-provided copper observatory.');
});

test('expanded materialization creates ordinary linked nodes and applies exact instance values', () => {
  const expanded = runtime.setBlockPresentationV2(instance(), { expanded: true });
  const root = runtime.createBlockRootNodeV2(expanded);
  const projection = runtime.materializeBlockProjectionV2(root);

  assert.match(root.className, /\bmodiff-block-v2-expanded-root\b/u);
  assert.match(root.className, /\bpointer-events-none\b/u);
  assert.equal(projection.nodes[0].className, root.className);
  assert.equal(projection.nodes.length, 4);
  assert.equal(projection.edges.length, 2);
  const generated = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  assert.equal(generated.type, 'custom');
  assert.equal(generated.parentId, root.id);
  assert.deepEqual(generated.position, { x: 380, y: 80 });
  assert.equal(generated.width, 320);
  assert.equal(generated.data.params.prompt.value, '');
  assert.equal(generated.data.params.steps.value, 0);
  assert.equal(generated.data.params.prompt.fieldOptions.suppressInitialFieldAction, true);
  assert.equal(generated.data.params.steps.fieldOptions.suppressInitialFieldAction, true);
  assert.ok(
    projection.nodes
      .filter((node) => node.data.blockProjectionOwnerId === root.id)
      .every((node) =>
        Object.values(node.data.params).every((param) => param.fieldOptions?.suppressInitialFieldAction === true),
      ),
  );
  assert.equal(generated.data.blockProjectionOwnerId, root.id);
  assert.equal(projection.edges[0].data.blockProjectionOwnerId, root.id);

  const collapsed = runtime.createBlockRootNodeV2(instance());
  assert.equal(collapsed.className, undefined);
  assert.deepEqual(runtime.materializeBlockProjectionV2(collapsed), { nodes: [collapsed], edges: [] });
});

test('hierarchical Modular Diffusers projection nests placements and preserves local geometry', () => {
  const base = instance('nested-modular');
  const metadata = (runtimeRole, placementPath, parentPlacementPath) => ({
    kind: 'upstream_block',
    pipelineClass: 'QwenImageModularPipeline',
    blocksClass: 'QwenImageAutoBlocks',
    workflowId: 'text2image',
    libraryRevision: 'a'.repeat(40),
    runtimeRole,
    blockDefinitionId: `diffusers.modular-block:${runtimeRole}:sha256:${'b'.repeat(64)}`,
    blockClass: `${runtimeRole}Block`,
    blockKind: parentPlacementPath ? 'block' : 'sequential',
    blockContractHash: `sha256:${'c'.repeat(64)}`,
    placementPath,
    ...(parentPlacementPath ? { parentPlacementPath } : {}),
    componentNames: [],
  });
  const graphWithoutHash = {
    ...base.effectiveGraph,
    nodes: [
      ...base.effectiveGraph.nodes.map((node) =>
        node.nodeId === 'generate'
          ? { ...node, modularDiffusers: metadata('generate', ['denoise']) }
          : node.nodeId === 'preview'
            ? { ...node, modularDiffusers: metadata('preview', ['denoise', 'preview'], ['denoise']) }
            : node,
      ),
      {
        nodeId: 'inactive-vae',
        nodeType: 'group',
        data: {
          type: 'group',
          module: 'MoDiff',
          action: 'Group',
          label: 'Skipped optional VAE',
          category: 'Diffusers',
          params: {},
        },
        modularDiffusers: metadata('inactive-vae', ['optional_vae']),
      },
    ],
    executionOrder: [...base.effectiveGraph.executionOrder, 'inactive-vae'],
  };
  delete graphWithoutHash.graphHash;
  const graph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
  const definitionWithoutHash = { ...base.definitionSnapshot, graph };
  delete definitionWithoutHash.contentHash;
  const definition = {
    ...definitionWithoutHash,
    contentHash: schema.blockDefinitionContentHashV2(definitionWithoutHash),
  };
  const current = schema.normalizeBlockInstanceV2({
    ...base,
    definitionRef: { definitionId: definition.definitionId, contentHash: definition.contentHash },
    definitionSnapshot: definition,
    effectiveGraph: graph,
    customization: { ...base.customization, baseGraphHash: graph.graphHash, effectiveGraphHash: graph.graphHash },
    presentation: {
      ...base.presentation,
      expanded: true,
      internalLayoutMode: 'hierarchical',
      internalLayout: {
        load: { x: 28, y: 76, width: 320, height: 280 },
        generate: { x: 380, y: 76, width: 760, height: 680 },
        preview: { x: 28, y: 360, width: 320, height: 240 },
      },
    },
  });
  const root = runtime.createBlockRootNodeV2(current);
  const projection = runtime.materializeBlockProjectionV2(root);
  const generated = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const preview = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'preview');
  assert.equal(
    projection.nodes.some((node) => node.data.blockProjectionNodeId === 'inactive-vae'),
    false,
    'an inert skipped structural branch from an unchanged registered snapshot is presentation-only',
  );
  assert.equal(generated.parentId, root.id);
  assert.equal(generated.data.blockProjectionContainer, true);
  assert.equal(generated.data.blockProjectionChildCount, 1);
  assert.equal(preview.parentId, generated.id);
  assert.deepEqual(preview.position, { x: 28, y: 360 });
  assert.equal(preview.data.blockProjectionDepth, 1);
  assert.ok(root.width >= generated.position.x + preview.position.x + preview.width);
  assert.ok(projection.edges.length > 0);
  assert.ok(
    projection.edges.every((edge) => edge.zIndex === -1),
    'nested internal edges stay below their node and container controls',
  );

  const executable = runtime.expandBlockGraphV2ForExecution([root], []);
  const executablePreview = executable.nodes.find((node) => node.data.blockProjectionNodeId === 'preview');
  assert.equal(executablePreview.parentId, undefined);
  assert.deepEqual(executablePreview.position, {
    x: current.presentation.position.x + 380 + 28,
    y: current.presentation.position.y + 76 + 360,
  });
});

function nestedConnectionInstance(expanded = false) {
  const base = definition();
  const metadata = {
    kind: 'upstream_block',
    pipelineClass: 'TestModularPipeline',
    blocksClass: 'TestBlocks',
    workflowId: 'text2image',
    libraryRevision: 'a'.repeat(40),
    runtimeRole: 'stage',
    blockDefinitionId: `diffusers.modular-block:TestStep:sha256:${'b'.repeat(64)}`,
    blockClass: 'TestStep',
    blockKind: 'sequential',
    blockContractHash: `sha256:${'c'.repeat(64)}`,
    placementPath: ['stage'],
    componentNames: [],
  };
  const nodes = base.graph.nodes.map((node) => {
    if (node.nodeId === 'load') return node;
    return {
      ...node,
      data: {
        ...node.data,
        label: 'Step',
        params: { ...node.data.params, prompt: { type: 'string', display: 'textarea', default: 'creator default' } },
      },
      modularDiffusers: {
        ...metadata,
        blockKind: 'block',
        placementPath: ['stage', node.nodeId],
        parentPlacementPath: ['stage'],
      },
    };
  });
  nodes.push({ ...structuredClone(nodes[0]), nodeId: 'alternate-load' });
  nodes.push({
    nodeId: 'stage',
    nodeType: 'group',
    data: { type: 'group', label: 'Stage', params: {} },
    modularDiffusers: metadata,
  });
  const graph = {
    nodes,
    edges: base.graph.edges,
    executionOrder: ['load', 'alternate-load', 'stage', 'generate', 'preview'],
  };
  base.graph = { ...graph, graphHash: schema.blockGraphHashV2(graph) };
  base.boundary.inputs[0].mirrorBindings = [{ nodeId: 'preview', fieldOrPortId: 'prompt' }];
  base.controls[0].mirrorBindings = [{ nodeId: 'preview', fieldId: 'prompt' }];
  base.contentHash = schema.blockDefinitionContentHashV2(base);
  return runtime.setBlockPresentationV2(
    schema.createBlockInstanceV2(base, {
      instanceId: 'nested-connections',
      position: { x: 0, y: 0 },
      size: { width: 640, height: 720 },
    }),
    { expanded: true, internalLayoutMode: 'hierarchical', collapsedContainerNodeIds: expanded ? [] : ['stage'] },
  );
}

test('nested mirror sockets retain every exact consumer behind one logical port at every disclosure level', () => {
  const current = nestedConnectionInstance();
  const original = JSON.stringify(current);
  const project = (value) => runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(value));
  const collapsed = project(current).nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  const expanded = project(runtime.setBlockPresentationV2(current, { collapsedContainerNodeIds: [] })).nodes.find(
    (node) => node.data.blockProjectionNodeId === 'stage',
  );
  const promptSockets = Object.entries(collapsed.data.blockProjectionPortBindings).filter(
    ([, binding]) => binding.fieldOrPortId === 'prompt',
  );
  assert.equal(promptSockets.length, 1, 'one logical public prompt is not split into duplicate sockets');
  const labels = promptSockets.map(([id]) => collapsed.data.params[id].label);
  assert.equal(new Set(labels).size, 1);
  for (const [handle, endpoint] of promptSockets) {
    assert.match(collapsed.data.params[handle].label, /Prompt/u);
    assert.match(collapsed.data.params[handle].fieldOptions.connectionDescription, new RegExp(endpoint.nodeId));
    assert.equal(expanded.data.params[handle].label, collapsed.data.params[handle].label);
    assert.deepEqual(expanded.data.blockProjectionPortBindings[handle], endpoint);
    assert.deepEqual(runtime.blockProjectionConnectionEndpointV2(collapsed, handle, 'input'), {
      nodeId: endpoint.nodeId,
      fieldOrPortId: 'prompt',
    });
    assert.deepEqual(runtime.blockProjectionConnectionEndpointsV2(collapsed, handle, 'input'), [
      { nodeId: 'generate', fieldOrPortId: 'prompt' },
      { nodeId: 'preview', fieldOrPortId: 'prompt' },
    ]);
  }
  assert.equal(JSON.stringify(current), original, 'labels are projection only');
});

test('connecting through a visible ancestor replaces the leaf writer atomically and is undoable', () => {
  for (const expanded of [false, true]) {
    const current = nestedConnectionInstance(expanded);
    const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current));
    const state = flowStore.useFlowStore;
    state.setState({ nodes: projection.nodes, edges: projection.edges });
    state.getState().resetHistory();
    const target = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
    const source = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'alternate-load');
    const targetHandle = Object.entries(target.data.blockProjectionPortBindings).find(
      ([, endpoint]) => endpoint.nodeId === 'generate' && endpoint.fieldOrPortId === 'components',
    )[0];
    const connection = { source: source.id, sourceHandle: 'components', target: target.id, targetHandle };
    state.getState().onConnect(connection);
    const next = state.getState().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
    const writers = next.effectiveGraph.edges.filter(
      (edge) => edge.targetNodeId === 'generate' && edge.targetPortId === 'components',
    );
    assert.equal(writers.length, 1, 'ancestor and leaf are aliases, not two different inputs');
    assert.equal(writers[0].sourceNodeId, 'alternate-load');
    assert.equal(writers[0].edgeId, 'components', 'a replacement retains the existing semantic edge ID');
    assert.deepEqual(next.values, current.values);
    assert.deepEqual(next.effectiveInterface, current.effectiveInterface);
    assert.deepEqual(next.definitionSnapshot, current.definitionSnapshot);
    assert.equal(state.getState().historyPast.length, 1);
    state.getState().onConnect(connection);
    assert.equal(state.getState().historyPast.length, 1, 'same connection is a no-op');
    state.getState().undo();
    assert.deepEqual(
      state.getState().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2,
      current,
    );
    state.getState().redo();
    const execution = runtime.expandBlockGraphV2ForExecution(state.getState().nodes, state.getState().edges);
    assert.equal(execution.edges.length, current.effectiveGraph.edges.length);
    assert.equal(execution.edges.filter((edge) => edge.targetHandle === 'components').length, 1);
  }
});

test('projected endpoint resolution rejects missing handles and direction mismatches', () => {
  const projection = runtime.materializeBlockProjectionV2(
    runtime.createBlockRootNodeV2(nestedConnectionInstance(true)),
  );
  const leaf = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  assert.equal(runtime.blockProjectionConnectionEndpointV2(leaf, 'nonexistent', 'input'), null);
  assert.equal(runtime.blockProjectionConnectionEndpointV2(leaf, 'components', 'output'), null);
  assert.equal(runtime.blockProjectionConnectionEndpointV2(leaf, 'images', 'input'), null);
});

test('invalid nested replacement leaves the old writer, history, values and other instances intact', () => {
  const current = nestedConnectionInstance(true);
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current));
  const sibling = runtime.createBlockRootNodeV2(instance('unrelated-instance'));
  const state = flowStore.useFlowStore;
  state.setState({ nodes: [...projection.nodes, sibling], edges: projection.edges });
  state.getState().resetHistory();
  const source = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'alternate-load');
  const target = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const before = JSON.stringify({ nodes: state.getState().nodes, edges: state.getState().edges });
  for (const conn of [
    { source: source.id, sourceHandle: 'missing', target: target.id, targetHandle: 'components' },
    { source: source.id, sourceHandle: 'components', target: target.id, targetHandle: 'missing' },
    { source: sibling.id, sourceHandle: 'images', target: target.id, targetHandle: 'components' },
  ]) {
    state.getState().onConnect(conn);
    assert.equal(JSON.stringify({ nodes: state.getState().nodes, edges: state.getState().edges }), before);
    assert.equal(state.getState().historyPast.length, 0);
  }
  // Simulate a stale/inconsistent canvas field that appears compatible. Strict
  // semantic validation must fail before removing the existing connection.
  state.setState({
    nodes: state.getState().nodes.map((node) =>
      node.id === source.id
        ? {
            ...node,
            data: {
              ...node.data,
              params: { ...node.data.params, nonexistent: { type: 'pipeline_components', display: 'output' } },
            },
          }
        : node,
    ),
  });
  const beforeInvalid = JSON.stringify({ nodes: state.getState().nodes, edges: state.getState().edges });
  assert.throws(() =>
    state
      .getState()
      .onConnect({ source: source.id, sourceHandle: 'nonexistent', target: target.id, targetHandle: 'components' }),
  );
  assert.equal(JSON.stringify({ nodes: state.getState().nodes, edges: state.getState().edges }), beforeInvalid);
  assert.equal(state.getState().historyPast.length, 0);
});

test('reconnecting the identical nested endpoint is a no-op even through an ancestor alias', () => {
  const current = nestedConnectionInstance(true);
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current));
  const state = flowStore.useFlowStore;
  state.setState({ nodes: projection.nodes, edges: projection.edges });
  state.getState().resetHistory();
  const edge = projection.edges.find((edge) => edge.data?.blockProjectionEdgeId === 'components');
  const target = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  const handle = Object.entries(target.data.blockProjectionPortBindings).find(
    ([, endpoint]) => endpoint.nodeId === 'generate' && endpoint.fieldOrPortId === 'components',
  )[0];
  // The stale object must not be allowed to nominate a different semantic edge.
  state.getState().onReconnect(
    { ...edge, data: { ...edge.data, blockProjectionEdgeId: 'preview-images' } },
    {
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: target.id,
      targetHandle: handle,
    },
  );
  assert.deepEqual(state.getState().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2, current);
  assert.equal(state.getState().historyPast.length, 0);
});

test('disconnecting a baseline crossing keeps its nested socket available without restoring the wire', () => {
  const original = nestedConnectionInstance();
  const project = (instance) => runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(instance));
  const before = project(original);
  const stageBefore = before.nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  const disconnected = runtime.replaceBlockEffectiveGraphV2(original, {
    ...original.effectiveGraph,
    edges: original.effectiveGraph.edges.filter((edge) => edge.edgeId !== 'components'),
  });
  const after = project(disconnected);
  const stageAfter = after.nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  assert.deepEqual(stageAfter.data.blockProjectionPortBindings, stageBefore.data.blockProjectionPortBindings);
  assert.equal(
    after.edges.some((edge) => edge.data?.blockProjectionEdgeId === 'components'),
    false,
  );
  assert.equal(
    runtime.expandBlockGraphV2ForExecution(after.nodes, after.edges).edges.length,
    original.effectiveGraph.edges.length - 1,
  );
  const restored = project(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(disconnected))));
  assert.deepEqual(
    restored.nodes.find((node) => node.data.blockProjectionNodeId === 'stage').data.blockProjectionPortBindings,
    stageBefore.data.blockProjectionPortBindings,
  );
});

test('hierarchical Modular Diffusers containers collapse descendants without changing semantic graph or layout', () => {
  const base = instance('collapsed-modular-container');
  const parentMetadata = {
    kind: 'upstream_block',
    pipelineClass: 'QwenImageModularPipeline',
    blocksClass: 'QwenImageAutoBlocks',
    workflowId: 'text2image',
    libraryRevision: 'a'.repeat(40),
    runtimeRole: 'denoise',
    blockDefinitionId: `diffusers.modular-block:QwenImageDenoiseBlocks:sha256:${'b'.repeat(64)}`,
    blockClass: 'QwenImageDenoiseBlocks',
    blockKind: 'sequential',
    blockContractHash: `sha256:${'c'.repeat(64)}`,
    placementPath: ['denoise'],
    componentNames: [],
  };
  const childMetadata = {
    ...parentMetadata,
    runtimeRole: 'denoiser',
    blockDefinitionId: `diffusers.modular-block:QwenImageDenoiseStep:sha256:${'d'.repeat(64)}`,
    blockClass: 'QwenImageDenoiseStep',
    blockKind: 'block',
    placementPath: ['denoise', 'denoiser'],
    parentPlacementPath: ['denoise'],
  };
  const graphWithoutHash = {
    ...base.effectiveGraph,
    nodes: [
      ...base.effectiveGraph.nodes.map((node) =>
        node.nodeId === 'generate'
          ? {
              ...node,
              modularDiffusers: parentMetadata,
            }
          : node.nodeId === 'preview'
            ? {
                ...node,
                data: {
                  ...node.data,
                  params: {
                    ...node.data.params,
                    components: { type: 'pipeline_components', display: 'input' },
                    result: { type: 'list[image]', display: 'output' },
                  },
                },
                modularDiffusers: childMetadata,
              }
            : node,
      ),
      {
        nodeId: 'sink',
        nodeType: 'custom',
        semanticRole: 'sink',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Sink',
          params: { result: { type: 'list[image]', display: 'input' } },
        },
      },
    ],
    edges: [
      ...base.effectiveGraph.edges,
      {
        edgeId: 'collapsed-input-crossing',
        sourceNodeId: 'load',
        sourcePortId: 'components',
        targetNodeId: 'preview',
        targetPortId: 'components',
      },
      {
        edgeId: 'collapsed-output-crossing',
        sourceNodeId: 'preview',
        sourcePortId: 'result',
        targetNodeId: 'sink',
        targetPortId: 'result',
      },
    ],
    executionOrder: [...base.effectiveGraph.executionOrder, 'sink'],
  };
  delete graphWithoutHash.graphHash;
  const graph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
  const definitionWithoutHash = { ...base.definitionSnapshot, graph };
  delete definitionWithoutHash.contentHash;
  const definition = {
    ...definitionWithoutHash,
    contentHash: schema.blockDefinitionContentHashV2(definitionWithoutHash),
  };
  const fresh = schema.createBlockInstanceV2(definition, {
    instanceId: 'fresh-progressive-disclosure',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 720 },
  });
  assert.deepEqual(fresh.presentation.collapsedContainerNodeIds, ['generate']);
  const current = schema.normalizeBlockInstanceV2({
    ...base,
    definitionRef: { definitionId: definition.definitionId, contentHash: definition.contentHash },
    definitionSnapshot: definition,
    effectiveGraph: graph,
    customization: { ...base.customization, baseGraphHash: graph.graphHash, effectiveGraphHash: graph.graphHash },
    presentation: {
      ...base.presentation,
      expanded: true,
      internalLayoutMode: 'hierarchical',
      collapsedContainerNodeIds: ['generate'],
      internalLayout: {
        ...base.presentation.internalLayout,
        generate: { x: 380, y: 76, width: 760, height: 680 },
        preview: { x: 28, y: 360, width: 320, height: 240 },
        sink: { x: 1180, y: 76, width: 320, height: 240 },
      },
    },
  });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current));
  const generated = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');

  assert.equal(runtime.blockProjectedChildCountV2(current), 3);
  assert.equal(
    projection.nodes.some((node) => node.data.blockProjectionNodeId === 'preview'),
    false,
  );
  assert.equal(generated.data.blockProjectionContainerExpanded, false);
  assert.ok(generated.height < 680, 'collapsed container does not reuse its legacy recursive footprint');
  assert.equal(generated.data.blockProjectionModular, true);
  assert.ok(
    Object.values(generated.data.blockProjectionPortBindings).some(
      (binding) =>
        binding.direction === 'input' && binding.nodeId === 'preview' && binding.fieldOrPortId === 'components',
    ),
  );
  assert.ok(
    Object.values(generated.data.blockProjectionPortBindings).some(
      (binding) => binding.direction === 'output' && binding.nodeId === 'preview' && binding.fieldOrPortId === 'result',
    ),
  );
  assert.equal(projection.edges.length, 3);
  assert.ok(
    projection.edges.some(
      (edge) => edge.target === generated.id && String(edge.targetHandle).startsWith('block-boundary-in:'),
    ),
  );
  assert.ok(
    projection.edges.some(
      (edge) => edge.source === generated.id && String(edge.sourceHandle).startsWith('block-boundary-out:'),
    ),
  );
  const collapsedOutputEdge = projection.edges.find((edge) =>
    String(edge.sourceHandle).startsWith('block-boundary-out:'),
  );
  flowStore.useFlowStore.setState({ nodes: projection.nodes, edges: projection.edges });
  flowStore.useFlowStore.getState().onReconnect(collapsedOutputEdge, {
    source: collapsedOutputEdge.source,
    sourceHandle: collapsedOutputEdge.sourceHandle,
    target: collapsedOutputEdge.target,
    targetHandle: collapsedOutputEdge.targetHandle,
  });
  const reconnectedOwner = flowStore.useFlowStore.getState().nodes.find((node) => node.id === current.instanceId)
    .data.blockInstanceV2;
  assert.ok(
    reconnectedOwner.effectiveGraph.edges.some(
      (edge) =>
        edge.edgeId === 'collapsed-output-crossing' &&
        edge.sourceNodeId === 'preview' &&
        edge.sourcePortId === 'result' &&
        edge.targetNodeId === 'sink' &&
        edge.targetPortId === 'result',
    ),
    'reconnecting a lifted boundary edge preserves its exact semantic leaf sockets',
  );
  assert.equal(
    projection.edges.some((edge) => edge.source.includes('generate') && edge.target.includes('preview')),
    false,
  );
  assert.equal(current.effectiveGraph.nodes.length, base.effectiveGraph.nodes.length + 1);
  assert.deepEqual(current.presentation.internalLayout.generate, { x: 380, y: 76, width: 760, height: 680 });

  const execution = runtime.expandBlockGraphV2ForExecution(projection.nodes, projection.edges);
  assert.equal(execution.edges.length, 4);
  assert.ok(
    execution.edges.some(
      (edge) =>
        edge.id.includes('collapsed-input-crossing') &&
        edge.target.endsWith(':7:preview') &&
        edge.targetHandle === 'components',
    ),
  );
  assert.ok(
    execution.edges.some(
      (edge) =>
        edge.id.includes('collapsed-output-crossing') &&
        edge.source.endsWith(':7:preview') &&
        edge.sourceHandle === 'result',
    ),
  );

  const reopened = runtime.setBlockPresentationV2(current, { collapsedContainerNodeIds: [] });
  assert.equal(runtime.blockProjectedChildCountV2(reopened), 4);
  const reopenedProjection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(reopened));
  const reopenedGenerate = reopenedProjection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const reopenedPreview = reopenedProjection.nodes.find((node) => node.data.blockProjectionNodeId === 'preview');
  const reopenedSink = reopenedProjection.nodes.find((node) => node.data.blockProjectionNodeId === 'sink');
  assert.ok(reopenedPreview);
  assert.ok(
    Object.values(reopenedGenerate.data.blockProjectionPortBindings).some(
      (binding) =>
        binding.direction === 'input' && binding.nodeId === 'preview' && binding.fieldOrPortId === 'components',
    ),
    'an expanded internal Block retains its typed subtree input',
  );
  assert.ok(
    Object.values(reopenedGenerate.data.blockProjectionPortBindings).some(
      (binding) => binding.direction === 'output' && binding.nodeId === 'preview' && binding.fieldOrPortId === 'result',
    ),
    'an expanded internal Block retains its typed subtree output',
  );
  assert.ok(reopenedGenerate.width >= reopenedPreview.position.x + reopenedPreview.width + 28);
  assert.ok(reopenedGenerate.height >= reopenedPreview.position.y + reopenedPreview.height + 96);
  assert.ok(
    reopenedGenerate.position.x + reopenedGenerate.width + 36 <= reopenedSink.position.x ||
      reopenedSink.position.x + reopenedSink.width + 36 <= reopenedGenerate.position.x ||
      reopenedGenerate.position.y + reopenedGenerate.height + 36 <= reopenedSink.position.y ||
      reopenedSink.position.y + reopenedSink.height + 36 <= reopenedGenerate.position.y,
    'opening a nested container cannot overlap a root sibling',
  );
  const completeExecution = runtime.expandBlockGraphV2ForExecution(projection.nodes, projection.edges);
  assert.equal(
    completeExecution.nodes.filter((node) => node.data.blockProjectionOwnerId === current.instanceId).length,
    current.effectiveGraph.nodes.length,
    'collapsed presentation cannot omit semantic descendants during execution',
  );
});

test('expanded materialization reserves the shared Block header without changing relative reviewed layout', () => {
  const current = instance();
  const shifted = runtime.setBlockPresentationV2(current, {
    expanded: true,
    internalLayout: {
      load: { x: 24, y: 24, width: 320, height: 280 },
      generate: { x: 380, y: 24, width: 320, height: 280 },
      preview: { x: 736, y: 324, width: 320, height: 280 },
    },
  });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(shifted));
  const bySemanticId = Object.fromEntries(
    projection.nodes
      .filter((node) => node.data.blockProjectionNodeId)
      .map((node) => [node.data.blockProjectionNodeId, node]),
  );

  assert.deepEqual(bySemanticId.load.position, { x: 24, y: 76 });
  assert.deepEqual(bySemanticId.generate.position, { x: 380, y: 76 });
  assert.deepEqual(bySemanticId.preview.position, { x: 736, y: 376 });
  assert.deepEqual(shifted.presentation.internalLayout.load, { x: 24, y: 24, width: 320, height: 280 });
});

test('expanded Block frame contains every projected child and collapse restores the exact saved size', () => {
  const current = instance();
  const expanded = runtime.setBlockPresentationV2(current, {
    expanded: true,
    internalLayout: {
      load: { x: 28, y: 76, width: 300, height: 420 },
      generate: { x: 420, y: 76, width: 420, height: 680 },
      preview: { x: 920, y: 76, width: 280, height: 360 },
    },
  });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expanded));
  const root = projection.nodes[0];

  projection.nodes.slice(1).forEach((child) => {
    assert.equal(child.parentId, root.id);
    assert.ok(child.position.x >= 0);
    assert.ok(child.position.y >= 44);
    assert.ok(child.position.x + child.width <= root.width);
    assert.ok(child.position.y + child.height <= root.height);
  });

  assert.deepEqual(expanded.presentation.size, current.presentation.size);
  const collapsed = runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(expanded, { expanded: false }));
  assert.equal(collapsed.width, current.presentation.size.width);
  assert.equal(collapsed.height, current.presentation.size.height);
});

test('instance reducers are copy-on-write and keep presentation separate from semantic customization', () => {
  const first = instance('first', { prompt: 'first prompt', steps: 8 });
  const second = instance('second', { prompt: 'second prompt', steps: 8 });
  const authorized = schema.normalizeBlockInstanceV2({
    ...first,
    authorities: [
      {
        kind: 'reviewed_execution',
        definitionId: first.definitionRef.definitionId,
        definitionContentHash: first.definitionRef.contentHash,
        effectiveGraphHash: first.effectiveGraph.graphHash,
        executionParameterHash: 'execution-parameters-a',
        artifactRevisions: { 'owner/model': 'b'.repeat(40) },
        admissionId: 'diffusers:test:text2image',
        issuedAt: '2026-09-01T00:00:00Z',
      },
    ],
  });
  const presentationOnly = runtime.setBlockPresentationV2(authorized, {
    position: { x: 777, y: 333 },
    internalLayout: { generate: { x: 444, y: 222, width: 500, height: 360 } },
  });
  assert.deepEqual(presentationOnly.authorities, authorized.authorities);
  assert.equal(presentationOnly.definitionSnapshot.contentHash, authorized.definitionSnapshot.contentHash);
  assert.equal(presentationOnly.effectiveGraph.graphHash, authorized.effectiveGraph.graphHash);
  assert.equal(presentationOnly.customization.state, authorized.customization.state);

  const edited = runtime.setBlockInstanceValueV2(first, 'prompt', 'edited first prompt');
  const exactExpectedEdit = structuredClone(first);
  exactExpectedEdit.values.prompt = 'edited first prompt';
  exactExpectedEdit.customization.state = 'parameters_changed';
  assert.deepEqual(
    edited,
    exactExpectedEdit,
    'a parameter edit may change only that value and the explicit customization state',
  );
  assert.equal(edited.values.prompt, 'edited first prompt');
  assert.equal(second.values.prompt, 'second prompt');
  assert.equal(edited.customization.state, 'parameters_changed');
  assert.deepEqual(edited.definitionSnapshot, first.definitionSnapshot);

  const moved = runtime.setBlockPresentationV2(edited, {
    expanded: true,
    position: { x: 900, y: 500 },
    internalLayout: { generate: { x: 444, y: 222, width: 500, height: 360 } },
  });
  assert.equal(moved.customization.state, 'parameters_changed');
  assert.equal(moved.effectiveGraph.graphHash, edited.effectiveGraph.graphHash);
  assert.deepEqual(moved.presentation.internalLayout.generate, { x: 444, y: 222, width: 500, height: 360 });
  assert.deepEqual(first.presentation.internalLayout.generate, { x: 380, y: 80, width: 320, height: 280 });

  const structuralGraph = structuredClone(moved.effectiveGraph);
  structuralGraph.nodes = structuralGraph.nodes.filter(({ nodeId }) => nodeId !== 'preview');
  structuralGraph.edges = structuralGraph.edges.filter(({ targetNodeId }) => targetNodeId !== 'preview');
  structuralGraph.executionOrder = structuralGraph.executionOrder.filter((nodeId) => nodeId !== 'preview');
  const structural = runtime.replaceBlockEffectiveGraphV2(moved, structuralGraph);
  assert.equal(structural.customization.state, 'structure_changed');
  assert.notEqual(structural.effectiveGraph.graphHash, moved.effectiveGraph.graphHash);
  assert.equal(structural.definitionSnapshot.graph.nodes.length, 3);
  assert.equal(structural.effectiveGraph.nodes.length, 2);
  assert.equal(structural.presentation.internalLayout.preview, undefined);
  assert.equal(runtime.setBlockInstanceValueV2(structural, 'steps', 12).customization.state, 'structure_changed');
  assert.deepEqual(runtime.setBlockInstanceValueV2(authorized, 'steps', 12).authorities, []);
  assert.throws(() => runtime.setBlockInstanceValueV2(first, 'repository', 'other/model'), /sealed/u);
});

test('reviewed compiler starter values are a clean baseline and exact reversion becomes clean again', () => {
  const baseline = schema.createBlockInstanceV2(definition(), {
    instanceId: 'reviewed-baseline',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 720 },
    values: { prompt: 'creator default', steps: 28 },
    baselineValues: true,
  });
  assert.equal(baseline.customization.state, 'unchanged');

  const edited = runtime.setBlockInstanceValueV2(baseline, 'prompt', 'workflow-only prompt');
  assert.equal(edited.customization.state, 'parameters_changed');
  assert.deepEqual(edited.values, { prompt: 'workflow-only prompt', steps: 28 });

  const restored = runtime.setBlockInstanceValueV2(edited, 'prompt', 'creator default');
  assert.equal(restored.customization.state, 'unchanged');
  assert.deepEqual(restored.values, baseline.values);
  assert.deepEqual(restored.definitionSnapshot, baseline.definitionSnapshot);
  assert.deepEqual(restored.effectiveGraph, baseline.effectiveGraph);
  assert.deepEqual(restored.effectiveInterface, baseline.effectiveInterface);
});

test('a media-shaped public input may bind only to its matching internal media file browser', () => {
  const base = structuredClone(definition());
  const load = base.graph.nodes.find(({ nodeId }) => nodeId === 'load');
  load.data.params.file = {
    type: 'str',
    display: 'filebrowser',
    fieldOptions: { fileTypes: ['image'], multiple: true },
  };
  base.graph.graphHash = schema.blockGraphHashV2(base.graph);
  base.boundary.inputs.push({
    portId: 'image',
    label: 'Image',
    valueType: 'UnionType[PIL.Image.Image,list[PIL.Image.Image]]',
    required: true,
    multiple: true,
    binding: { nodeId: 'load', fieldOrPortId: 'file' },
  });
  base.contentHash = schema.blockDefinitionContentHashV2(base);
  const media = schema.createBlockInstanceV2(base, {
    instanceId: 'media-file-boundary',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 720 },
    values: { image: ['@data/images/reference.webp'] },
    baselineValues: true,
  });
  assert.doesNotThrow(() => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(media)], []));

  const wrongMedia = structuredClone(media);
  wrongMedia.effectiveGraph.nodes.find(({ nodeId }) => nodeId === 'load').data.params.file.fieldOptions.fileTypes = [
    'audio',
  ];
  wrongMedia.effectiveGraph.graphHash = schema.blockGraphHashV2(wrongMedia.effectiveGraph);
  wrongMedia.customization.effectiveGraphHash = wrongMedia.effectiveGraph.graphHash;
  wrongMedia.customization.state = 'structure_changed';
  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(wrongMedia)], []),
    /public input image has an incompatible effective field type/u,
  );
});

test('ordinary internal-node adoption is source-neutral, copy-on-write, and collision safe', () => {
  const current = instance('add-runtime-node');
  const authorized = schema.normalizeBlockInstanceV2({
    ...current,
    authorities: [
      {
        kind: 'reviewed_execution',
        definitionId: current.definitionRef.definitionId,
        definitionContentHash: current.definitionRef.contentHash,
        effectiveGraphHash: current.effectiveGraph.graphHash,
        executionParameterHash: 'add-node-parameters',
        artifactRevisions: { 'owner/model': 'b'.repeat(40) },
        admissionId: 'diffusers:test:add-node',
        issuedAt: '2026-09-01T00:00:00Z',
      },
    ],
  });
  const original = structuredClone(authorized);
  const utility = {
    nodeId: 'utility',
    nodeType: 'custom',
    semanticRole: 'utility',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Utility',
      label: 'Utility',
      params: {
        input: { type: 'image', display: 'input' },
        output: { type: 'image', display: 'output' },
      },
    },
  };
  const layout = { x: 512, y: 360, width: 300, height: 220 };

  const added = runtime.addBlockEffectiveGraphNodeV2(authorized, utility, { executionIndex: 1, layout });
  assert.deepEqual(authorized, original);
  assert.equal(added.definitionSnapshot.contentHash, authorized.definitionSnapshot.contentHash);
  assert.deepEqual(added.definitionSnapshot.graph, authorized.definitionSnapshot.graph);
  assert.equal(added.effectiveGraph.nodes.at(-1).nodeId, 'utility');
  assert.deepEqual(added.effectiveGraph.edges, authorized.effectiveGraph.edges);
  assert.deepEqual(added.effectiveGraph.executionOrder, ['load', 'utility', 'generate', 'preview']);
  assert.deepEqual(added.presentation.internalLayout.utility, layout);
  assert.equal(added.customization.state, 'structure_changed');
  assert.equal(added.customization.effectiveGraphHash, added.effectiveGraph.graphHash);
  assert.equal(added.effectiveGraph.graphHash, schema.blockGraphHashV2(added.effectiveGraph));
  assert.notEqual(added.effectiveGraph.graphHash, authorized.effectiveGraph.graphHash);
  assert.deepEqual(added.authorities, []);
  const expanded = runtime.materializeBlockProjectionV2(
    runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(added, { expanded: true })),
  );
  const projected = expanded.nodes.find((node) => node.data.blockProjectionNodeId === 'utility');
  assert.ok(projected);
  assert.equal(projected.type, 'custom');
  assert.deepEqual(projected.position, { x: layout.x, y: layout.y });

  const addedSnapshot = structuredClone(added);
  assert.throws(() => runtime.addBlockEffectiveGraphNodeV2(added, utility), /duplicate.*"utility"/u);
  assert.deepEqual(added, addedSnapshot);
  assert.throws(
    () => runtime.addBlockEffectiveGraphNodeV2(authorized, { ...utility, nodeId: 'invalid semantic id' }),
    /valid stable semantic nodeId/u,
  );
  assert.throws(
    () =>
      runtime.addBlockEffectiveGraphNodeV2(authorized, {
        ...utility,
        nodeId: 'nested-block',
        nodeType: 'block',
        data: { ...utility.data, type: 'block' },
      }),
    /nested composites/u,
  );
  assert.throws(
    () =>
      runtime.addBlockEffectiveGraphNodeV2(authorized, {
        ...utility,
        nodeId: 'owned-projection',
        data: { ...utility.data, blockProjectionOwnerId: authorized.instanceId },
      }),
    /owned projection nodes/u,
  );
  assert.throws(
    () =>
      runtime.addBlockEffectiveGraphNodeV2(authorized, {
        ...utility,
        nodeId: runtime.blockProjectionNodeIdV2(authorized.instanceId, 'generate'),
      }),
    /reserved canvas projection namespace/u,
  );
  assert.throws(
    () => runtime.addBlockEffectiveGraphNodeV2(authorized, utility, { executionIndex: 99 }),
    /executionIndex must be between 0 and 3/u,
  );
  assert.throws(
    () => runtime.addBlockEffectiveGraphNodeV2(authorized, utility, { layout: { x: Number.NaN, y: 0 } }),
    /internalLayout\.utility\.x/u,
  );
  assert.deepEqual(authorized, original);
});

test('internal-node deletion is copy-on-write and protects the explicit public interface', () => {
  const current = instance('delete-runtime-node');
  const graphWithUtility = structuredClone(current.effectiveGraph);
  graphWithUtility.nodes.push({
    nodeId: 'utility',
    nodeType: 'custom',
    semanticRole: 'utility',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Utility',
      params: {
        components: { type: 'pipeline_components', display: 'input' },
        output: { type: 'pipeline_components', display: 'output' },
      },
    },
  });
  graphWithUtility.edges = [
    ...graphWithUtility.edges.filter(({ edgeId }) => edgeId !== 'components'),
    {
      edgeId: 'utility-input',
      sourceNodeId: 'load',
      sourcePortId: 'components',
      targetNodeId: 'utility',
      targetPortId: 'components',
    },
    {
      edgeId: 'utility-output',
      sourceNodeId: 'utility',
      sourcePortId: 'output',
      targetNodeId: 'generate',
      targetPortId: 'components',
    },
  ];
  graphWithUtility.executionOrder = ['load', 'utility', 'generate', 'preview'];
  let customized = runtime.replaceBlockEffectiveGraphV2(current, graphWithUtility);
  customized = runtime.setBlockPresentationV2(customized, {
    internalLayout: { utility: { x: 250, y: 360, width: 280, height: 220 } },
  });
  customized = schema.normalizeBlockInstanceV2({
    ...customized,
    authorities: [
      {
        kind: 'reviewed_execution',
        definitionId: customized.definitionRef.definitionId,
        definitionContentHash: customized.definitionRef.contentHash,
        effectiveGraphHash: customized.effectiveGraph.graphHash,
        executionParameterHash: 'delete-node-parameters',
        artifactRevisions: { 'owner/model': 'b'.repeat(40) },
        admissionId: 'diffusers:test:delete-node',
        issuedAt: '2026-09-01T00:00:00Z',
      },
    ],
  });
  const original = structuredClone(customized);

  const deleted = runtime.removeBlockEffectiveGraphNodesV2(customized, ['utility']);
  assert.equal(
    deleted.effectiveGraph.nodes.some(({ nodeId }) => nodeId === 'utility'),
    false,
  );
  assert.equal(
    deleted.effectiveGraph.edges.some(
      ({ sourceNodeId, targetNodeId }) => sourceNodeId === 'utility' || targetNodeId === 'utility',
    ),
    false,
  );
  assert.deepEqual(deleted.effectiveGraph.executionOrder, ['load', 'generate', 'preview']);
  assert.equal(deleted.presentation.internalLayout.utility, undefined);
  assert.deepEqual(deleted.authorities, []);
  assert.equal(deleted.customization.state, 'structure_changed');
  assert.equal(deleted.definitionSnapshot.graph.nodes.length, 3);
  assert.deepEqual(customized, original);

  assert.throws(
    () => runtime.removeBlockEffectiveGraphNodesV2(customized, ['generate']),
    /public input "Prompt".*public output "Images".*exposed control "Prompt"/u,
  );
  assert.throws(() => runtime.removeBlockEffectiveGraphNodesV2(customized, ['load']), /exposed control "Repository"/u);
  assert.throws(
    () => runtime.removeBlockEffectiveGraphNodesV2(customized, ['preview']),
    /image preview \(preview\.images\)/u,
  );
  assert.throws(
    () => runtime.removeBlockEffectiveGraphNodesV2(customized, ['missing']),
    /unknown Block V2 internal node "missing"/u,
  );
  assert.deepEqual(customized, original);
});

test('effective-interface edits are copy-on-write, hash checked, and immediately executable', () => {
  const original = instance('interface-edit');
  const boundary = structuredClone(original.effectiveInterface.boundary);
  boundary.inputs[0].label = 'Workflow prompt';
  boundary.inputs.push({
    portId: 'steps',
    label: 'Workflow steps',
    valueType: 'int',
    required: false,
    binding: { nodeId: 'generate', fieldOrPortId: 'steps' },
  });
  const edited = runtime.replaceBlockEffectiveInterfaceV2(original, {
    boundary,
    controls: original.effectiveInterface.controls,
  });
  assert.equal(edited.effectiveInterface.boundary.inputs[0].label, 'Workflow prompt');
  assert.equal(edited.effectiveInterface.boundary.inputs[1].portId, 'steps');
  assert.notEqual(edited.effectiveInterface.effectiveInterfaceHash, edited.effectiveInterface.baseInterfaceHash);
  assert.equal(edited.customization.state, 'structure_changed');
  assert.deepEqual(
    original.effectiveInterface.boundary.inputs.map(({ portId }) => portId),
    ['prompt'],
  );
  assert.deepEqual(Object.keys(runtime.blockConnectorParamsV2(edited).inputs), ['prompt', 'steps']);
  assert.doesNotThrow(() => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(edited)], []));

  const incompatible = structuredClone(boundary);
  incompatible.inputs[1].binding.fieldOrPortId = 'images';
  assert.throws(
    () =>
      runtime.replaceBlockEffectiveInterfaceV2(original, {
        boundary: incompatible,
        controls: original.effectiveInterface.controls,
      }),
    /field type is incompatible|is an output/u,
  );
  assert.throws(
    () =>
      runtime.replaceBlockEffectiveInterfaceV2(original, {
        boundary: original.effectiveInterface.boundary,
        controls: original.effectiveInterface.controls.filter(({ controlId }) => controlId !== 'repository'),
      }),
    /sealed Block V2 control repository/u,
  );
});

test('one logical control projects atomically to canonical mirror bindings and survives topology edits', () => {
  const original = instance('mirrored-control', { steps: 13 });
  const mirrorNode = {
    nodeId: 'prepare',
    nodeType: 'custom',
    semanticRole: 'prepare',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Prepare',
      params: { steps: { type: 'integer', default: 28 } },
    },
  };
  const adopted = runtime.addBlockEffectiveGraphNodeV2(original, mirrorNode, {
    layout: { x: 740, y: 0, width: 320, height: 220 },
  });
  const controls = adopted.effectiveInterface.controls.map((control) =>
    control.controlId === 'steps' ? { ...control, mirrorBindings: [{ nodeId: 'prepare', fieldId: 'steps' }] } : control,
  );
  const mirrored = runtime.replaceBlockEffectiveInterfaceV2(adopted, {
    boundary: adopted.effectiveInterface.boundary,
    controls,
  });
  const projection = runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(mirrored)], []);
  const generate = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const prepare = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'prepare');
  assert.equal(generate.data.params.steps.value, 13);
  assert.equal(prepare.data.params.steps.value, 13);

  const relabeledControls = mirrored.effectiveInterface.controls.map((control) => {
    if (control.controlId !== 'steps') return control;
    const { mirrorBindings: _omitted, ...withoutMirrors } = control;
    return { ...withoutMirrors, label: 'Iterations' };
  });
  const preserved = runtime.replaceBlockEffectiveInterfaceV2(mirrored, {
    boundary: mirrored.effectiveInterface.boundary,
    controls: relabeledControls,
  });
  assert.deepEqual(
    preserved.effectiveInterface.controls.find(({ controlId }) => controlId === 'steps').mirrorBindings,
    [{ nodeId: 'prepare', fieldId: 'steps' }],
  );
  const cleared = runtime.replaceBlockEffectiveInterfaceV2(
    mirrored,
    {
      boundary: mirrored.effectiveInterface.boundary,
      controls: relabeledControls,
    },
    { preserveOmittedMirrors: false },
  );
  assert.equal(
    cleared.effectiveInterface.controls.find(({ controlId }) => controlId === 'steps').mirrorBindings,
    undefined,
  );

  assert.throws(
    () => runtime.removeBlockEffectiveGraphNodesV2(mirrored, ['prepare']),
    /exposed control "Steps" \(steps\)/u,
  );
  const replacement = {
    ...mirrorNode,
    nodeId: 'prepare-v2',
    data: { ...mirrorNode.data, action: 'PrepareV2' },
  };
  const replaced = runtime.replaceBlockEffectiveGraphNodeV2(mirrored, 'prepare', replacement);
  assert.deepEqual(replaced.effectiveInterface.controls.find(({ controlId }) => controlId === 'steps').mirrorBindings, [
    { nodeId: 'prepare-v2', fieldId: 'steps' },
  ]);

  const conflictingBoundary = structuredClone(mirrored.effectiveInterface.boundary);
  conflictingBoundary.inputs.push({
    portId: 'other-steps',
    label: 'Other steps',
    valueType: 'int',
    required: false,
    binding: { nodeId: 'prepare', fieldOrPortId: 'steps' },
  });
  const conflictingInterface = runtime.replaceBlockEffectiveInterfaceV2(mirrored, {
    boundary: conflictingBoundary,
    controls: mirrored.effectiveInterface.controls,
  });
  const conflicting = schema.normalizeBlockInstanceV2({
    ...conflictingInterface,
    values: { ...conflictingInterface.values, 'other-steps': 99 },
  });
  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(conflicting)], []),
    /bind conflicting values to prepare\.steps/u,
  );
  assert.deepEqual(original.values, { steps: 13 });
});

test('public input mirrors fan out stored values and ordinary external edges deterministically', () => {
  const original = instance('mirrored-input', { prompt: 'one shared prompt', steps: 8 });
  const receiver = {
    nodeId: 'prepare-prompt',
    nodeType: 'custom',
    semanticRole: 'prepare prompt',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'PreparePrompt',
      params: { prompt: { type: 'text', default: '' } },
    },
  };
  const adopted = runtime.addBlockEffectiveGraphNodeV2(original, receiver);
  const boundary = structuredClone(adopted.effectiveInterface.boundary);
  boundary.inputs[0].mirrorBindings = [{ nodeId: 'prepare-prompt', fieldOrPortId: 'prompt' }];
  const mirrored = runtime.replaceBlockEffectiveInterfaceV2(adopted, {
    boundary,
    controls: adopted.effectiveInterface.controls,
  });
  const root = runtime.createBlockRootNodeV2(mirrored);
  const source = ordinaryNode('prompt-source', { text: { type: 'string', display: 'output' } });
  const externalEdge = {
    id: 'external-prompt',
    source: source.id,
    sourceHandle: 'text',
    target: root.id,
    targetHandle: 'prompt',
  };
  const expanded = runtime.expandBlockGraphV2ForExecution([source, root], [externalEdge]);
  const generate = expanded.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const prepare = expanded.nodes.find((node) => node.data.blockProjectionNodeId === 'prepare-prompt');
  assert.equal(generate.data.params.prompt.value, 'one shared prompt');
  assert.equal(prepare.data.params.prompt.value, 'one shared prompt');
  const translated = expanded.edges.filter(({ source: sourceId }) => sourceId === source.id);
  assert.equal(translated.length, 2);
  assert.deepEqual(
    translated.map(({ id, target, targetHandle }) => [id, target, targetHandle]),
    [
      ['external-prompt', runtime.blockProjectionNodeIdV2(root.id, 'generate'), 'prompt'],
      [
        'block-v2-input-mirror:15:external-prompt:14:mirrored-input:14:prepare-prompt:6:prompt:1',
        runtime.blockProjectionNodeIdV2(root.id, 'prepare-prompt'),
        'prompt',
      ],
    ],
  );

  const preservedBoundary = structuredClone(mirrored.effectiveInterface.boundary);
  delete preservedBoundary.inputs[0].mirrorBindings;
  const preserved = runtime.replaceBlockEffectiveInterfaceV2(mirrored, {
    boundary: preservedBoundary,
    controls: mirrored.effectiveInterface.controls,
  });
  assert.deepEqual(preserved.effectiveInterface.boundary.inputs[0].mirrorBindings, [
    { nodeId: 'prepare-prompt', fieldOrPortId: 'prompt' },
  ]);
  const cleared = runtime.replaceBlockEffectiveInterfaceV2(
    mirrored,
    {
      boundary: preservedBoundary,
      controls: mirrored.effectiveInterface.controls,
    },
    { preserveOmittedMirrors: false },
  );
  assert.equal(cleared.effectiveInterface.boundary.inputs[0].mirrorBindings, undefined);
  assert.throws(
    () => runtime.removeBlockEffectiveGraphNodesV2(mirrored, ['prepare-prompt']),
    /public input "Prompt" \(prompt\)/u,
  );

  const replacement = {
    ...receiver,
    nodeId: 'prepare-prompt-v2',
    data: { ...receiver.data, action: 'PreparePromptV2' },
  };
  const replaced = runtime.replaceBlockEffectiveGraphNodeV2(mirrored, 'prepare-prompt', replacement);
  assert.deepEqual(replaced.effectiveInterface.boundary.inputs[0].mirrorBindings, [
    { nodeId: 'prepare-prompt-v2', fieldOrPortId: 'prompt' },
  ]);

  const reboundBoundary = structuredClone(mirrored.effectiveInterface.boundary);
  reboundBoundary.inputs[0].binding = { nodeId: 'prepare-prompt', fieldOrPortId: 'prompt' };
  delete reboundBoundary.inputs[0].mirrorBindings;
  const reboundControls = mirrored.effectiveInterface.controls.map((control) =>
    control.controlId === 'prompt' ? { ...control, binding: { nodeId: 'prepare-prompt', fieldId: 'prompt' } } : control,
  );
  const rebound = runtime.replaceBlockEffectiveInterfaceV2(mirrored, {
    boundary: reboundBoundary,
    controls: reboundControls,
  });
  assert.equal(rebound.effectiveInterface.boundary.inputs[0].mirrorBindings, undefined);
});

test('root-to-root public input fan-out duplicates one external edge to every reviewed target', () => {
  const sourceRoot = runtime.createBlockRootNodeV2(instance('image-source'));
  const receiverNode = (nodeId) => ({
    nodeId,
    nodeType: 'custom',
    semanticRole: nodeId,
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'ReceiveImage',
      params: { image: { type: 'list[image]', display: 'input' } },
    },
  });
  let target = instance('image-target');
  target = runtime.addBlockEffectiveGraphNodeV2(target, receiverNode('receive-a'));
  target = runtime.addBlockEffectiveGraphNodeV2(target, receiverNode('receive-b'));
  const boundary = structuredClone(target.effectiveInterface.boundary);
  boundary.inputs.push({
    portId: 'image-in',
    label: 'Image input',
    valueType: 'list[image]',
    required: true,
    binding: { nodeId: 'receive-a', fieldOrPortId: 'image' },
    mirrorBindings: [{ nodeId: 'receive-b', fieldOrPortId: 'image' }],
  });
  target = runtime.replaceBlockEffectiveInterfaceV2(target, {
    boundary,
    controls: target.effectiveInterface.controls,
  });
  const targetRoot = runtime.createBlockRootNodeV2(target);
  const expanded = runtime.expandBlockGraphV2ForExecution(
    [sourceRoot, targetRoot],
    [
      {
        id: 'root-to-root',
        source: sourceRoot.id,
        sourceHandle: 'images',
        target: targetRoot.id,
        targetHandle: 'image-in',
      },
    ],
  );
  const translated = expanded.edges.filter(
    ({ source, target }) =>
      source === runtime.blockProjectionNodeIdV2(sourceRoot.id, 'generate') &&
      [
        runtime.blockProjectionNodeIdV2(targetRoot.id, 'receive-a'),
        runtime.blockProjectionNodeIdV2(targetRoot.id, 'receive-b'),
      ].includes(target),
  );
  assert.deepEqual(
    translated.map(({ target, targetHandle }) => [target, targetHandle]),
    [
      [runtime.blockProjectionNodeIdV2(targetRoot.id, 'receive-a'), 'image'],
      [runtime.blockProjectionNodeIdV2(targetRoot.id, 'receive-b'), 'image'],
    ],
  );
  assert.equal(new Set(translated.map(({ id }) => id)).size, 2);
});

test('compatible internal-node replacement preserves edge and interface identities atomically', () => {
  const original = instance('node-replacement');
  const replacement = {
    nodeId: 'generate-v2',
    nodeType: 'custom',
    semanticRole: 'generate replacement',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'GenerateV2',
      params: {
        components: { type: 'pipeline_components', display: 'input' },
        prompt: { type: 'string', display: 'textarea' },
        steps: { type: 'int' },
        images: { type: 'list[image]', display: 'output' },
      },
    },
  };
  const replaced = runtime.replaceBlockEffectiveGraphNodeV2(original, 'generate', replacement);
  assert.equal(
    replaced.effectiveGraph.nodes.some(({ nodeId }) => nodeId === 'generate'),
    false,
  );
  assert.equal(
    replaced.effectiveGraph.nodes.some(({ nodeId }) => nodeId === 'generate-v2'),
    true,
  );
  assert.equal(replaced.effectiveGraph.edges.find(({ edgeId }) => edgeId === 'components').targetNodeId, 'generate-v2');
  assert.equal(
    replaced.effectiveGraph.edges.find(({ edgeId }) => edgeId === 'preview-images').sourceNodeId,
    'generate-v2',
  );
  assert.equal(replaced.effectiveInterface.boundary.inputs[0].portId, 'prompt');
  assert.equal(replaced.effectiveInterface.boundary.inputs[0].binding.nodeId, 'generate-v2');
  assert.equal(replaced.effectiveInterface.boundary.outputs[0].portId, 'images');
  assert.equal(
    replaced.effectiveInterface.controls.find(({ controlId }) => controlId === 'steps').binding.nodeId,
    'generate-v2',
  );
  assert.equal(
    replaced.definitionSnapshot.graph.nodes.some(({ nodeId }) => nodeId === 'generate'),
    true,
  );
  assert.equal(replaced.customization.state, 'structure_changed');
  assert.doesNotThrow(() => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(replaced)], []));

  const missingField = structuredClone(replacement);
  missingField.nodeId = 'generate-broken';
  delete missingField.data.params.steps;
  assert.throws(
    () => runtime.replaceBlockEffectiveGraphNodeV2(original, 'generate', missingField),
    /replacement field steps is missing or incompatible/u,
  );
  assert.equal(original.effectiveGraph.graphHash, original.definitionSnapshot.graph.graphHash);
});

test('preview and sealed-control owners use identity-preserving compatible replacement', () => {
  const original = instance('protected-node-replacement', {
    prompt: 'protected replacement prompt',
    steps: 8,
  });
  const withPreview = runtime.setBlockPreviewStateV2(
    original,
    { nodeId: 'preview', outputPortId: 'images' },
    {
      mediaReference: '/data/generated/stale-before-replacement.png',
      taskId: 'stale-preview-task',
      status: 'complete',
    },
  );
  const authorized = withAutoAuthority(withPreview, {}, Date.now());
  const authorizedSnapshot = structuredClone(authorized);

  const previewCandidate = {
    nodeId: 'preview-v2-candidate',
    nodeType: 'custom',
    semanticRole: 'preview replacement',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'PreviewV2',
      params: { images: { type: 'list[image]', display: 'ui_image' } },
    },
  };
  const previewReplaced = runtime.replaceBlockEffectiveGraphNodeV2(authorized, 'preview', previewCandidate);
  const protectedPreview = previewReplaced.effectiveGraph.nodes.find(({ nodeId }) => nodeId === 'preview');
  assert.equal(protectedPreview.data.action, 'PreviewV2');
  assert.equal(
    previewReplaced.effectiveGraph.nodes.some(({ nodeId }) => nodeId === previewCandidate.nodeId),
    false,
  );
  assert.deepEqual(previewReplaced.previewStates, [
    {
      binding: authorized.previewStates[0].binding,
      status: 'idle',
    },
  ]);
  assert.deepEqual(previewReplaced.definitionSnapshot.previews, authorized.definitionSnapshot.previews);
  assert.deepEqual(previewReplaced.authorities, []);
  assert.equal(previewReplaced.customization.state, 'structure_changed');
  assert.doesNotThrow(() =>
    runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(previewReplaced)], []),
  );

  const wrongPreviewType = structuredClone(previewCandidate);
  wrongPreviewType.nodeId = 'preview-wrong-type';
  wrongPreviewType.data.params.images.type = 'audio';
  assert.throws(
    () => runtime.replaceBlockEffectiveGraphNodeV2(authorized, 'preview', wrongPreviewType),
    /preview field images is missing or incompatible with image preview output/u,
  );
  const wrongPreviewRole = structuredClone(previewCandidate);
  wrongPreviewRole.nodeId = 'preview-wrong-role';
  wrongPreviewRole.data.params.images.display = 'output';
  assert.throws(
    () => runtime.replaceBlockEffectiveGraphNodeV2(authorized, 'preview', wrongPreviewRole),
    /preview field images must preserve display role ui_image/u,
  );

  const loaderCandidate = {
    nodeId: 'load-v2-candidate',
    nodeType: 'custom',
    semanticRole: 'loader replacement',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'LoadV2',
      params: {
        repository: { type: 'string', value: 'untrusted/replacement-value' },
        components: { type: 'pipeline_components', display: 'output' },
      },
    },
  };
  const loaderReplaced = runtime.replaceBlockEffectiveGraphNodeV2(authorized, 'load', loaderCandidate);
  const protectedLoader = loaderReplaced.effectiveGraph.nodes.find(({ nodeId }) => nodeId === 'load');
  assert.equal(protectedLoader.data.action, 'LoadV2');
  assert.equal(
    loaderReplaced.effectiveGraph.nodes.some(({ nodeId }) => nodeId === loaderCandidate.nodeId),
    false,
  );
  const repositoryControl = loaderReplaced.effectiveInterface.controls.find(
    ({ controlId }) => controlId === 'repository',
  );
  assert.deepEqual(repositoryControl.binding, { nodeId: 'load', fieldId: 'repository' });
  assert.equal(repositoryControl.sealed, true);
  assert.equal(runtime.blockControlParamsV2(loaderReplaced).repository.disabled, true);
  const execution = runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(loaderReplaced)], []);
  const projectedLoader = execution.nodes.find((node) => node.data.blockProjectionNodeId === 'load');
  assert.equal(projectedLoader.data.params.repository.value, 'owner/model');
  assert.deepEqual(loaderReplaced.definitionSnapshot, authorized.definitionSnapshot);
  assert.deepEqual(loaderReplaced.authorities, []);

  const missingSealedField = structuredClone(loaderCandidate);
  missingSealedField.nodeId = 'load-missing-repository';
  delete missingSealedField.data.params.repository;
  assert.throws(
    () => runtime.replaceBlockEffectiveGraphNodeV2(authorized, 'load', missingSealedField),
    /replacement field repository is missing or incompatible/u,
  );
  assert.deepEqual(authorized, authorizedSnapshot);
});

test('saved Block previews resolve exact retained media without changing graph or borrowing another run', async () => {
  const { withDurableBlockPreviewsV2 } = await server.ssrLoadModule('/src/studio/blockPreviewPersistenceV2.ts');
  const original = runtime.setBlockPreviewStateV2(
    instance('retained-preview'),
    { nodeId: 'preview', outputPortId: 'images' },
    { mediaReference: '/cache/execution/0', taskId: 'retained-task', status: 'complete' },
  );
  const nodes = [runtime.createBlockRootNodeV2(original)];
  const output = {
    taskId: 'retained-task',
    nodeId: runtime.blockProjectionNodeIdV2('retained-preview', 'preview'),
    fieldKey: 'images',
    value: ['/cache/execution/0'],
    url: '/file?file=retained.webp',
    backendMediaPath: '@data/studio/outputs/retained.webp',
    mediaItems: [
      {
        index: 0,
        value: '/cache/execution/0',
        url: '/file?file=retained.webp',
        backendPath: '@data/studio/outputs/retained.webp',
      },
    ],
  };
  assert.equal(withDurableBlockPreviewsV2(nodes, [{ ...output, taskId: 'newer-task' }]), nodes);
  assert.equal(withDurableBlockPreviewsV2(nodes, [{ ...output, backendMediaPath: undefined, mediaItems: [] }]), nodes);
  const retained = withDurableBlockPreviewsV2(nodes, [output]);
  assert.equal(retained[0].data.blockInstanceV2.previewStates[0].mediaReference, output.url);
  assert.deepEqual({ ...retained[0].data.blockInstanceV2, previewStates: original.previewStates }, original);
  assert.equal(withDurableBlockPreviewsV2(retained, [output]), retained);
  assert.equal(nodes[0].data.blockInstanceV2.previewStates[0].mediaReference, '/cache/execution/0');
  const copied = [{ ...nodes[0], id: 'copied-block' }];
  assert.equal(
    withDurableBlockPreviewsV2(copied, [output])[0].data.blockInstanceV2.previewStates[0].mediaReference,
    output.url,
  );
  const collection = {
    ...output,
    mediaItems: [
      { ...output.mediaItems[0], value: '/cache/execution/1', url: '/file?file=other.webp' },
      output.mediaItems[0],
    ],
  };
  assert.equal(
    withDurableBlockPreviewsV2(nodes, [collection])[0].data.blockInstanceV2.previewStates[0].mediaReference,
    output.url,
  );
  const newer = {
    ...output,
    id: 'new-current-output',
    taskId: 'new-current-task',
    url: '/file?file=newer.webp',
    mediaItems: [],
  };
  const slot = {
    workflowTabId: 'this-workflow',
    nodeId: output.nodeId,
    fieldKey: output.fieldKey,
    status: 'ready',
    currentOutputId: newer.id,
  };
  const current = { workflowTabId: 'this-workflow', previewSlots: { key: slot } };
  const advanced = withDurableBlockPreviewsV2(nodes, [newer, output], current);
  assert.equal(advanced[0].data.blockInstanceV2.previewStates[0].taskId, newer.taskId);
  assert.equal(advanced[0].data.blockInstanceV2.previewStates[0].mediaReference, newer.url);
  assert.equal(withDurableBlockPreviewsV2(nodes, [newer], { ...current, workflowTabId: 'another-workflow' }), nodes);
  assert.equal(
    withDurableBlockPreviewsV2(nodes, [newer], { ...current, previewSlots: { key: { ...slot, status: 'pending' } } }),
    nodes,
  );
  const canonical = runtime.canonicalizePersistedBlockGraphV2(retained, []);
  const reopened = runtime.materializeBlockProjectionV2(JSON.parse(JSON.stringify(canonical.nodes[0])));
  assert.equal(reopened.nodes[0].data.blockInstanceV2.previewStates[0].mediaReference, output.url);
});

test('preview updates remain instance-local run state and preserve semantic authority', () => {
  const current = instance('preview-instance', { prompt: 'preview prompt', steps: 8 });
  const authorized = schema.normalizeBlockInstanceV2({
    ...current,
    authorities: [
      {
        kind: 'reviewed_execution',
        definitionId: current.definitionRef.definitionId,
        definitionContentHash: current.definitionRef.contentHash,
        effectiveGraphHash: current.effectiveGraph.graphHash,
        executionParameterHash: 'execution-parameters-preview',
        artifactRevisions: { 'owner/model': 'b'.repeat(40) },
        admissionId: 'diffusers:test:text2image',
        issuedAt: '2026-09-01T00:00:00Z',
      },
    ],
  });
  const updated = runtime.setBlockPreviewStateV2(
    authorized,
    { nodeId: 'preview', outputPortId: 'images' },
    { mediaReference: '/data/generated/preview.png', taskId: 'task-preview', status: 'complete' },
  );

  assert.deepEqual(updated.previewStates[0], {
    binding: authorized.previewStates[0].binding,
    mediaReference: '/data/generated/preview.png',
    taskId: 'task-preview',
    status: 'complete',
  });
  assert.deepEqual(updated.authorities, authorized.authorities);
  assert.equal(updated.definitionRef.contentHash, authorized.definitionRef.contentHash);
  assert.equal(updated.effectiveGraph.graphHash, authorized.effectiveGraph.graphHash);
  assert.deepEqual(updated.values, authorized.values);
  assert.equal(authorized.previewStates[0].mediaReference, undefined);
  const previewView = runtime.blockPreviewViewsV2(updated)[0];
  assert.equal(previewView.status, 'complete');
  assert.equal(previewView.taskId, 'task-preview');
  assert.equal(previewView.params[previewView.previewId].display, 'ui_image');
  assert.equal(previewView.params[previewView.previewId].value, '/data/generated/preview.png');
  assert.deepEqual(previewView.params[previewView.previewId].fieldOptions.blockPreviewBindingV2, {
    schemaVersion: 2,
    ownerId: 'preview-instance',
    nodeId: 'preview',
    outputPortId: 'images',
    mediaType: 'image',
  });

  const cleared = runtime.setBlockPreviewStateV2(
    updated,
    { nodeId: 'preview', outputPortId: 'images' },
    { mediaReference: null, taskId: null, status: 'idle' },
  );
  assert.deepEqual(cleared.previewStates[0], {
    binding: authorized.previewStates[0].binding,
    status: 'idle',
  });
  assert.throws(
    () =>
      runtime.setBlockPreviewStateV2(authorized, { nodeId: 'missing', outputPortId: 'images' }, { status: 'failed' }),
    /expected one declared binding, found 0/u,
  );
});

test('collapsed and expanded canvas projections compile to one identical execution graph', () => {
  const source = ordinaryNode('source', { text: { type: 'string', display: 'output' } });
  const sink = ordinaryNode('sink', { images: { type: 'list[image]', display: 'input' } });
  const root = runtime.createBlockRootNodeV2(instance());
  const externalEdges = [
    {
      id: 'prompt-edge',
      source: source.id,
      sourceHandle: 'text',
      target: root.id,
      targetHandle: 'prompt',
    },
    {
      id: 'image-edge',
      source: root.id,
      sourceHandle: 'images',
      target: sink.id,
      targetHandle: 'images',
    },
  ];
  const collapsedExecution = runtime.expandBlockGraphV2ForExecution([source, root, sink], externalEdges);

  const expandedInstance = runtime.setBlockPresentationV2(root.data.blockInstanceV2, { expanded: true });
  const expandedRoot = runtime.createBlockRootNodeV2(expandedInstance);
  const projection = runtime.materializeBlockProjectionV2(expandedRoot);
  const expandedExecution = runtime.expandBlockGraphV2ForExecution(
    [source, ...projection.nodes, sink],
    [...externalEdges, ...projection.edges],
  );

  assert.deepEqual(sortedExecution(expandedExecution), sortedExecution(collapsedExecution));
  assert.equal(
    collapsedExecution.nodes.some((node) => node.id === root.id),
    false,
  );
  assert.equal(
    collapsedExecution.nodes.some((node) => node.data.blockProjectionNodeId === 'generate'),
    true,
  );
  assert.deepEqual(
    collapsedExecution.edges.find(({ id }) => id === 'prompt-edge'),
    {
      id: 'prompt-edge',
      source: 'source',
      sourceHandle: 'text',
      target: runtime.blockProjectionNodeIdV2(root.id, 'generate'),
      targetHandle: 'prompt',
    },
  );
  assert.equal(
    collapsedExecution.edges.find(({ id }) => id === 'image-edge').source,
    runtime.blockProjectionNodeIdV2(root.id, 'generate'),
  );
});

test('flow export and readiness compile collapsed and expanded V2 roots to the same concrete API graph', () => {
  const collapsedRoot = runtime.createBlockRootNodeV2(
    instance('export-root', { prompt: 'exported copper observatory', steps: 12 }),
  );
  flowStore.useFlowStore.setState({ nodes: [collapsedRoot], edges: [] });
  const collapsedExport = flowStore.useFlowStore.getState().exportGraph('block-v2-export', collapsedRoot.id);
  const collapsedInspection = runReadiness.inspectCurrentGraph();

  const expandedInstance = runtime.setBlockPresentationV2(collapsedRoot.data.blockInstanceV2, { expanded: true });
  const expandedRoot = runtime.createBlockRootNodeV2(expandedInstance);
  const projection = runtime.materializeBlockProjectionV2(expandedRoot);
  flowStore.useFlowStore.setState({ nodes: projection.nodes, edges: projection.edges });
  const expandedExport = flowStore.useFlowStore.getState().exportGraph('block-v2-export', expandedRoot.id);
  const expandedInspection = runReadiness.inspectCurrentGraph();

  assert.deepEqual(expandedExport, collapsedExport);
  assert.equal(collapsedInspection.enabledExecutableCount, 3);
  assert.equal(collapsedInspection.outputPathCount, 1);
  assert.equal(expandedInspection.enabledExecutableCount, collapsedInspection.enabledExecutableCount);
  assert.equal(expandedInspection.outputPathCount, collapsedInspection.outputPathCount);
  assert.deepEqual(expandedInspection.outputNodeIds, collapsedInspection.outputNodeIds);
  assert.deepEqual(expandedInspection.connectedOutputNodeIds, collapsedInspection.connectedOutputNodeIds);
  assert.deepEqual(expandedInspection.modelRefs, collapsedInspection.modelRefs);
  assert.deepEqual(expandedInspection.blockingIssues, collapsedInspection.blockingIssues);
  const target = runtime.blockProjectionNodeIdV2(collapsedRoot.id, 'preview');
  assert.equal(collapsedExport.paths.length, 1);
  assert.equal(collapsedExport.paths[0].at(-1), target);
  assert.equal(
    collapsedExport.nodes[runtime.blockProjectionNodeIdV2(collapsedRoot.id, 'generate')].params.prompt.value,
    'exported copper observatory',
  );
  assert.equal(
    collapsedExport.nodes[runtime.blockProjectionNodeIdV2(collapsedRoot.id, 'generate')].params.steps.value,
    12,
  );
  const serialized = JSON.stringify(collapsedExport);
  assert.equal(serialized.includes('blockInstanceV2'), false);
  assert.equal(serialized.includes('blockProjectionOwnerId'), false);
  assert.equal(serialized.includes('blockProjectionNodeId'), false);
  assert.equal(serialized.includes('blockProjectionKind'), false);
  assert.equal(serialized.includes('MoDiff.BlockV2'), false);
});

test('malformed V2 authority blocks readiness and export instead of leaking a wrapper graph', () => {
  const malformed = runtime.createBlockRootNodeV2(instance('malformed-export-root'));
  flowStore.useFlowStore.setState({ nodes: [malformed], edges: [] });
  // Simulate corrupt in-memory authority after hydration. Persist middleware
  // already rejects this mutation at its boundary, so do not use setState to
  // manufacture a value that a real saved workflow could never contain.
  flowStore.useFlowStore.getState().nodes[0].data.params = {
    duplicate_authority: { type: 'string', value: 'must fail closed' },
  };

  assert.throws(
    () => flowStore.useFlowStore.getState().exportGraph('malformed-block-v2', malformed.id),
    /NodeData\.params cannot be a second persisted value store/u,
  );
  const issues = runReadiness.collectRunReadinessIssues({
    sid: 'malformed-block-v2',
    isConnected: true,
    includeStudio: false,
  });
  const executionIssue = issues.find(({ code }) => code === 'composite_execution_graph_invalid');
  assert.ok(executionIssue);
  assert.equal(executionIssue.blocking, true);
  assert.equal(executionIssue.nodeId, malformed.id);
  assert.match(executionIssue.details, /NodeData\.params cannot be a second persisted value store/u);
  const inspection = runReadiness.inspectCurrentGraph();
  assert.equal(inspection.enabledExecutableCount, 0);
  assert.equal(inspection.blockingIssues[0].code, 'composite_execution_graph_invalid');
});

test('malformed expanded V2 graph readiness targets the exact internal node named by validation', () => {
  const current = runtime.setBlockPresentationV2(instance('malformed-expanded-root'), { expanded: true });
  const root = runtime.createBlockRootNodeV2(current);
  const projection = runtime.materializeBlockProjectionV2(root);
  flowStore.useFlowStore.setState({ nodes: projection.nodes, edges: projection.edges });

  const storedRoot = flowStore.useFlowStore.getState().nodes.find(({ id }) => id === root.id);
  storedRoot.data.blockInstanceV2.effectiveGraph.nodes.find(({ nodeId }) => nodeId === 'generate').nodeType =
    'unsupported-runtime-node';
  storedRoot.data.blockInstanceV2.effectiveGraph.graphHash = schema.blockGraphHashV2(
    storedRoot.data.blockInstanceV2.effectiveGraph,
  );
  storedRoot.data.blockInstanceV2.customization.effectiveGraphHash =
    storedRoot.data.blockInstanceV2.effectiveGraph.graphHash;
  storedRoot.data.blockInstanceV2.customization.state = 'structure_changed';

  const issues = runReadiness.collectRunReadinessIssues({
    sid: 'malformed-expanded-v2',
    isConnected: true,
    includeStudio: false,
  });
  const executionIssue = issues.find(({ code }) => code === 'composite_execution_graph_invalid');
  assert.ok(executionIssue);
  assert.equal(executionIssue.nodeId, runtime.blockProjectionNodeIdV2(root.id, 'generate'));
  assert.match(executionIssue.details, /Block V2 node generate/u);
});

test('two independently inserted roots never share ids, values, layout, or projected execution state', () => {
  const firstInstance = instance('first-root', { prompt: 'first prompt', steps: 8 });
  const secondBase = instance('second-root', { prompt: 'second prompt', steps: 16 });
  const secondInstance = runtime.setBlockPresentationV2(secondBase, {
    position: { x: 1400, y: 200 },
    internalLayout: { generate: { x: 520, y: 160, width: 420, height: 300 } },
  });
  const first = runtime.createBlockRootNodeV2(firstInstance);
  const second = runtime.createBlockRootNodeV2(secondInstance);
  const secondBefore = JSON.stringify(second.data.blockInstanceV2);
  const editedFirst = runtime.createBlockRootNodeV2(
    runtime.setBlockInstanceValueV2(first.data.blockInstanceV2, 'prompt', 'edited first prompt'),
  );
  assert.equal(JSON.stringify(second.data.blockInstanceV2), secondBefore);

  const execution = runtime.expandBlockGraphV2ForExecution(
    [editedFirst, second],
    [
      {
        id: 'block-chain',
        source: editedFirst.id,
        sourceHandle: 'images',
        target: second.id,
        targetHandle: 'prompt',
      },
    ],
  );
  const firstGenerate = execution.nodes.find(
    (node) => node.id === runtime.blockProjectionNodeIdV2(first.id, 'generate'),
  );
  const secondGenerate = execution.nodes.find(
    (node) => node.id === runtime.blockProjectionNodeIdV2(second.id, 'generate'),
  );
  assert.ok(firstGenerate);
  assert.ok(secondGenerate);
  assert.notEqual(firstGenerate.id, secondGenerate.id);
  assert.equal(firstGenerate.data.params.prompt.value, 'edited first prompt');
  assert.equal(secondGenerate.data.params.prompt.value, 'second prompt');
  assert.deepEqual(secondGenerate.position, { x: 1920, y: 360 });
  assert.deepEqual(
    execution.edges.find(({ id }) => id === 'block-chain'),
    {
      id: 'block-chain',
      source: firstGenerate.id,
      sourceHandle: 'images',
      target: secondGenerate.id,
      targetHandle: 'prompt',
    },
  );
});

test('persistence removes projections and rebuilds the durable root from its instance', () => {
  const source = ordinaryNode('source', { text: { type: 'string', display: 'output' } });
  const expanded = runtime.setBlockPresentationV2(instance(), { expanded: true });
  const root = runtime.createBlockRootNodeV2(expanded);
  const projection = runtime.materializeBlockProjectionV2(root);
  const driftedRoot = {
    ...projection.nodes[0],
    position: { x: 9999, y: 9999 },
    width: 42,
    height: 42,
    selected: true,
  };
  const external = {
    id: 'external',
    source: source.id,
    sourceHandle: 'text',
    target: root.id,
    targetHandle: 'prompt',
  };
  const persisted = flowStore.normalizePersistedFlowState({
    nodes: [source, driftedRoot, ...projection.nodes.slice(1)],
    edges: [external, ...projection.edges],
    viewport: { x: 12, y: 34, zoom: 0.8 },
  });

  assert.equal(persisted.nodes.length, 2);
  const savedRoot = persisted.nodes.find(({ id }) => id === root.id);
  assert.equal(runtime.isBlockRootV2(savedRoot), true);
  assert.deepEqual(savedRoot.position, { x: 100, y: 200 });
  assert.deepEqual(
    { width: savedRoot.width, height: savedRoot.height },
    runtime.blockExpandedProjectionSizeV2(expanded),
  );
  assert.deepEqual(savedRoot.data.blockInstanceV2.presentation.size, { width: 640, height: 720 });
  assert.equal(savedRoot.selected, undefined);
  assert.deepEqual(savedRoot.data.blockInstanceV2.values, { prompt: '', steps: 0 });
  assert.deepEqual(persisted.edges, [external]);
  assert.deepEqual(persisted.viewport, { x: 12, y: 34, zoom: 0.8 });

  const hydratedRoot = JSON.parse(JSON.stringify(savedRoot));
  assert.equal(runtime.isBlockRootV2(hydratedRoot), true);
  const hydratedProjection = runtime.materializeBlockProjectionV2(hydratedRoot);
  assert.equal(hydratedProjection.nodes.length, 4);
  assert.deepEqual(hydratedProjection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate').position, {
    x: 380,
    y: 80,
  });
});

test('execution expansion reports broken configured boundaries instead of silently dropping them', () => {
  const current = instance();
  const brokenGraph = structuredClone(current.effectiveGraph);
  const generate = brokenGraph.nodes.find(({ nodeId }) => nodeId === 'generate');
  delete generate.data.params.images;
  const broken = runtime.replaceBlockEffectiveGraphV2(current, brokenGraph);
  const root = runtime.createBlockRootNodeV2(broken);
  const sink = ordinaryNode('sink', { images: { type: 'list[image]', display: 'input' } });
  assert.throws(
    () =>
      runtime.expandBlockGraphV2ForExecution(
        [root, sink],
        [{ id: 'broken', source: root.id, sourceHandle: 'images', target: sink.id, targetHandle: 'images' }],
      ),
    /public output images no longer binds/u,
  );
});

test('projection ownership is validated before derived nodes or edges can be stripped or executed', () => {
  const expanded = runtime.setBlockPresentationV2(instance(), { expanded: true });
  const root = runtime.createBlockRootNodeV2(expanded);
  const projection = runtime.materializeBlockProjectionV2(root);
  const children = projection.nodes.slice(1);

  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution(children, projection.edges),
    /authoritative root instance-a is absent/u,
  );
  assert.throws(
    () =>
      flowStore.normalizePersistedFlowState({
        nodes: children,
        edges: projection.edges,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    /authoritative root instance-a is absent/u,
  );

  const partiallySpoofed = ordinaryNode('ordinary-spoof', {});
  partiallySpoofed.data.blockProjectionOwnerId = root.id;
  assert.throws(
    () => runtime.canonicalizePersistedBlockGraphV2([root, partiallySpoofed], []),
    /malformed ownership receipt/u,
  );

  const markedRoot = structuredClone(root);
  markedRoot.data.blockProjectionOwnerId = root.id;
  markedRoot.data.blockProjectionNodeId = 'generate';
  markedRoot.data.blockProjectionKind = 'internal';
  assert.throws(
    () => runtime.canonicalizePersistedBlockGraphV2([markedRoot], []),
    /durable root cannot also be a derived projection/u,
  );

  const source = ordinaryNode('source', { text: { type: 'string', display: 'output' } });
  assert.throws(
    () =>
      runtime.expandBlockGraphV2ForExecution(
        [source, ...projection.nodes],
        [
          ...projection.edges,
          {
            id: 'illegal-child-edge',
            source: source.id,
            sourceHandle: 'text',
            target: runtime.blockProjectionNodeIdV2(root.id, 'generate'),
            targetHandle: 'prompt',
          },
        ],
      ),
    /targets a derived child/u,
  );
});

test('execution validates every sealed control, public port, internal handle, and internal type without edge triggers', () => {
  const current = instance();

  const missingSealedGraph = structuredClone(current.effectiveGraph);
  delete missingSealedGraph.nodes.find(({ nodeId }) => nodeId === 'load').data.params.repository;
  const missingSealed = runtime.replaceBlockEffectiveGraphV2(current, missingSealedGraph);
  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(missingSealed)], []),
    /control repository no longer binds/u,
  );

  const missingInputGraph = structuredClone(current.effectiveGraph);
  delete missingInputGraph.nodes.find(({ nodeId }) => nodeId === 'generate').data.params.prompt;
  const missingInput = runtime.replaceBlockEffectiveGraphV2(current, missingInputGraph);
  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(missingInput)], []),
    /control prompt no longer binds/u,
  );

  const invalidHandleGraph = structuredClone(current.effectiveGraph);
  invalidHandleGraph.edges[0].sourcePortId = 'missing_components';
  const invalidHandle = runtime.replaceBlockEffectiveGraphV2(current, invalidHandleGraph);
  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(invalidHandle)], []),
    /internal edge components source no longer binds/u,
  );

  const incompatibleGraph = structuredClone(current.effectiveGraph);
  incompatibleGraph.nodes.find(({ nodeId }) => nodeId === 'generate').data.params.components.type = 'image';
  const incompatible = runtime.replaceBlockEffectiveGraphV2(current, incompatibleGraph);
  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(incompatible)], []),
    /internal edge components connects incompatible types/u,
  );

  const unsupportedGraph = structuredClone(current.effectiveGraph);
  unsupportedGraph.nodes[0].nodeType = 'arbitrary-renderer';
  unsupportedGraph.nodes[0].data.type = 'arbitrary-renderer';
  const unsupported = runtime.replaceBlockEffectiveGraphV2(current, unsupportedGraph);
  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(unsupported)], []),
    /unsupported node type arbitrary-renderer/u,
  );
});

test('graph identity checks reject duplicates and projection ids are delimiter-collision safe', () => {
  const root = runtime.createBlockRootNodeV2(instance());
  const duplicate = ordinaryNode(root.id, {});
  assert.throws(() => runtime.expandBlockGraphV2ForExecution([root, duplicate], []), /duplicate or empty node id/u);
  assert.throws(
    () =>
      runtime.canonicalizePersistedBlockGraphV2(
        [root],
        [
          { id: 'duplicate-edge', source: root.id, sourceHandle: 'images', target: root.id, targetHandle: 'prompt' },
          { id: 'duplicate-edge', source: root.id, sourceHandle: 'images', target: root.id, targetHandle: 'prompt' },
        ],
      ),
    /duplicate or empty edge id/u,
  );
  assert.notEqual(runtime.blockProjectionNodeIdV2('a:b', 'c'), runtime.blockProjectionNodeIdV2('a', 'b:c'));
});

test('selected Block execution retains transitive outside inputs and excludes downstream or unrelated drafts', () => {
  for (const expanded of [false, true]) {
    const root = runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(instance(), { expanded }));
    const projection = runtime.materializeBlockProjectionV2(root);
    const source = ordinaryNode('source', { text: { type: 'string', display: 'output' } });
    const convert = ordinaryNode('convert', {
      input: { type: 'string', display: 'input' },
      text: { type: 'string', display: 'output' },
    });
    const sink = ordinaryNode('sink', { images: { type: 'list[image]', display: 'input' } });
    const broken = runtime.createBlockRootNodeV2(instance('unrelated-broken'));
    broken.data.blockInstanceV2.effectiveGraph.graphHash = 'invalid';
    const nodes = [...projection.nodes, source, convert, sink, broken];
    const edges = [
      ...projection.edges,
      { id: 'convert', source: source.id, sourceHandle: 'text', target: convert.id, targetHandle: 'input' },
      { id: 'prompt', source: convert.id, sourceHandle: 'text', target: root.id, targetHandle: 'prompt' },
      { id: 'outside-preview', source: root.id, sourceHandle: 'images', target: sink.id, targetHandle: 'images' },
    ];
    const before = structuredClone({ nodes, edges });
    const execution = runtime.expandBlockGraphV2ForExecution(nodes, edges, root.id);
    assert.ok(execution.nodes.some(({ id }) => id === source.id));
    assert.ok(execution.nodes.some(({ id }) => id === convert.id));
    assert.ok(!execution.nodes.some(({ id }) => id === sink.id || id.includes('unrelated-broken')));
    assert.ok(
      execution.edges.some(
        (edge) =>
          edge.source === convert.id &&
          edge.target === runtime.blockProjectionNodeIdV2(root.id, 'generate') &&
          edge.targetHandle === 'prompt',
      ),
    );
    assert.deepEqual({ nodes, edges }, before);
  }
});

test('selected nested Block retains sibling component dependencies and mirrored external inputs', () => {
  const current = nestedConnectionInstance(true);
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current));
  const target = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  const source = ordinaryNode('outside-prompt', { text: { type: 'string', display: 'output' } });
  const nodes = [...projection.nodes, source];
  const edges = [
    ...projection.edges,
    { id: 'outside', source: source.id, sourceHandle: 'text', target: current.instanceId, targetHandle: 'prompt' },
  ];
  const before = structuredClone({ nodes, edges });
  const execution = runtime.expandBlockGraphV2ForExecution(nodes, edges, target.id);
  assert.ok(execution.nodes.some((node) => node.data.blockProjectionNodeId === 'load'));
  assert.ok(!execution.nodes.some((node) => node.data.blockProjectionNodeId === 'alternate-load'));
  assert.ok(execution.nodes.some((node) => node.id === source.id));
  assert.equal(execution.edges.filter((edge) => edge.source === source.id).length, 2);
  flowStore.useFlowStore.setState({ nodes, edges });
  const exported = flowStore.useFlowStore.getState().exportGraph('nested-dependencies', target.id);
  assert.ok(exported.nodes[source.id]);
  assert.ok(exported.nodes[runtime.blockProjectionNodeIdV2(current.instanceId, 'load')]);
  assert.deepEqual({ nodes, edges }, before);
});

test('selected Block retains another Block supplying its input through the existing exporter', () => {
  const first = runtime.createBlockRootNodeV2(instance('upstream'));
  const second = runtime.createBlockRootNodeV2(instance('selected'));
  const nodes = [first, second];
  const edges = [
    { id: 'crossing', source: first.id, sourceHandle: 'images', target: second.id, targetHandle: 'prompt' },
  ];
  // Execution closure preserves supplied edges; connector validation owns types.
  flowStore.useFlowStore.setState({ nodes, edges });
  const exported = flowStore.useFlowStore.getState().exportGraph('block-dependencies', second.id);
  assert.ok(exported.nodes[runtime.blockProjectionNodeIdV2(first.id, 'generate')]);
  assert.equal(exported.nodes[runtime.blockProjectionNodeIdV2(first.id, 'preview')], undefined);
  assert.ok(exported.nodes[runtime.blockProjectionNodeIdV2(second.id, 'preview')]);
});
