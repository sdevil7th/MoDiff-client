import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let flowStore;
let runtime;
let schema;
let connectionTypes;
let connectorResolution;
let workflowConnections;
let interfaceEditing;
let controlPolicy;
let durableReferences;
let inspector;
let studioStore;
let settingsStore;
let visibility;
let fieldActions;
let server;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
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
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  flowStore = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  connectionTypes = await server.ssrLoadModule('/src/theme/connectionTypes.ts');
  connectorResolution = await server.ssrLoadModule('/src/studio/nodeConnectorResolution.ts');
  workflowConnections = await server.ssrLoadModule('/src/workflow/useWorkflowConnections.ts');
  interfaceEditing = await server.ssrLoadModule('/src/studio/blockInterfaceEditingV2.ts');
  controlPolicy = await server.ssrLoadModule('/src/studio/managedControlPolicy.ts');
  durableReferences = await server.ssrLoadModule('/src/stores/flowDurableReferences.ts');
  inspector = await server.ssrLoadModule('/src/studio/graphNodeControls.ts');
  studioStore = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  settingsStore = await server.ssrLoadModule('/src/stores/useSettingsStore.ts');
  visibility = await server.ssrLoadModule('/src/studio/workspaceVisibility.ts');
  fieldActions = await server.ssrLoadModule('/src/utils/fieldAction.ts');
});

after(async () => {
  await server?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
});

beforeEach(() => {
  flowStore.useFlowStore.setState({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
});

test('progress-only updates reuse policy and persistence inputs without caching semantic changes', () => {
  const node = {
    id: 'ordinary',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'test',
      action: 'Generate',
      label: 'Generate',
      params: { prompt: { value: 'keep me' } },
      uiState: { disabled: false },
    },
  };
  const select = durableReferences.createDurableNodesSelector();
  const initial = [node];
  assert.equal(select(initial), initial);
  for (let step = 0; step < 200; step++) {
    assert.equal(
      select([
        {
          ...node,
          selected: true,
          data: {
            ...node.data,
            progress: step,
            executionProgress: { currentStep: step },
            uiState: { disabled: false, validationMessage: `Step ${step}` },
          },
        },
      ]),
      initial,
    );
  }
  for (const changed of [
    { ...node, position: { x: 10, y: 0 } },
    { ...node, width: 800 },
    { ...node, parentId: 'new-parent' },
    { ...node, data: { ...node.data, params: { prompt: { value: 'changed' } } } },
    { ...node, data: { ...node.data, uiState: { disabled: true } } },
    { ...node, data: { ...node.data, uiState: { blockExpanded: true } } },
    { ...node, data: { ...node.data, blockInstanceV2: {} } },
    { ...node, data: { ...node.data, futureSemanticField: true } },
  ]) {
    select(initial);
    const replacement = [changed];
    assert.equal(select(replacement), replacement);
  }
  flowStore.useFlowStore.setState({ nodes: initial });
  const partialize = flowStore.useFlowStore.persist.getOptions().partialize;
  const saved = partialize(flowStore.useFlowStore.getState());
  flowStore.useFlowStore.getState().updateProgress('ordinary', 50, { executionStatus: 'running' });
  assert.equal(partialize(flowStore.useFlowStore.getState()), saved);
  flowStore.useFlowStore.getState().setParam('ordinary', 'prompt', 'changed');
  const edited = partialize(flowStore.useFlowStore.getState());
  assert.notEqual(edited, saved);
  assert.equal(edited.nodes[0].data.params.prompt.value, 'changed');
});

function definition() {
  const migrated = schema.migrateUserBlockDefinitionV1({
    id: 'renderer-v2-fixture',
    name: 'Renderer V2 fixture',
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
          params: {
            prompt: { type: 'string', display: 'textarea', value: 'creator prompt' },
            steps: { type: 'int', value: 8 },
            image: { type: 'image', display: 'output' },
          },
        },
      },
    ],
    edges: [],
    inputs: [{ id: 'prompt', label: 'Prompt', nodeId: 'generate', paramKey: 'prompt', type: 'string' }],
    outputs: [{ id: 'image', label: 'Image', nodeId: 'generate', paramKey: 'image', type: 'image' }],
    exposedParams: [{ id: 'prompt', kind: 'graph-param', label: 'Prompt', nodeId: 'generate', paramKey: 'prompt' }],
    createdAt: 1,
    updatedAt: 2,
  });
  const semantic = {
    ...migrated,
    suggestedInputs: [
      {
        suggestionId: 'creator-example',
        label: 'Creator example',
        source: 'https://huggingface.co/owner/model',
        values: { prompt: 'creator suggested prompt' },
      },
    ],
  };
  delete semantic.contentHash;
  return { ...semantic, contentHash: schema.blockDefinitionContentHashV2(semantic) };
}

function root(id = 'block-v2-one') {
  return runtime.createBlockRootNodeV2(
    schema.createBlockInstanceV2(definition(), {
      instanceId: id,
      position: { x: 100, y: 120 },
      size: { width: 420, height: 480 },
    }),
  );
}

test('workspace inspector resolves and edits declared Block controls without root params or cross-tab writes', () => {
  const block = root();
  const sibling = root('inspector-sibling');
  const before = structuredClone(block.data.blockInstanceV2);
  studioStore.useStudioStore.setState({ activeWorkflowTabId: 'inspector-workflow' });
  flowStore.useFlowStore.setState({ nodes: [block, sibling], edges: [] });
  const fields = inspector.graphNodeControlParams(block);
  assert.deepEqual(Object.keys(fields), ['prompt']);
  assert.equal(fields.prompt.value, 'creator prompt');
  assert.equal(fields.prompt.fieldOptions.suppressInitialFieldAction, true);
  assert.deepEqual(block.data.params, {});
  inspector.updateGraphNodeControl('another-workflow', block.id, 'prompt', 'stale edit');
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 0);
  inspector.updateGraphNodeControl('inspector-workflow', block.id, 'prompt', 'inspector edit');
  let state = flowStore.useFlowStore.getState();
  const edited = state.nodes.find(({ id }) => id === block.id);
  assert.equal(inspector.graphNodeControlParams(edited).prompt.value, 'inspector edit');
  assert.deepEqual(edited.data.params, {});
  assert.deepEqual(edited.data.blockInstanceV2.definitionSnapshot, before.definitionSnapshot);
  assert.deepEqual(edited.data.blockInstanceV2.effectiveGraph, before.effectiveGraph);
  assert.deepEqual(
    state.nodes.find(({ id }) => id === sibling.id),
    sibling,
  );
  assert.equal(state.historyPast.length, 1);
  state.undo();
  assert.equal(
    inspector.graphNodeControlParams(flowStore.useFlowStore.getState().nodes[0]).prompt.value,
    'creator prompt',
  );
  flowStore.useFlowStore.getState().redo();
  state = flowStore.useFlowStore.getState();
  const saved = runtime.canonicalizePersistedBlockGraphV2(state.nodes, state.edges);
  assert.equal(inspector.graphNodeControlParams(saved.nodes[0]).prompt.value, 'inspector edit');
  const pin = inspector.graphParamInputCandidates(saved.nodes).find(({ nodeId }) => nodeId === block.id).id;
  state.setBlockPresentationV2(block.id, { expanded: true });
  assert.ok(inspector.graphParamInputCandidates(flowStore.useFlowStore.getState().nodes).some(({ id }) => id === pin));
  flowStore.useFlowStore.getState().setBlockPresentationV2(block.id, { expanded: false });
  assert.ok(inspector.graphParamInputCandidates(flowStore.useFlowStore.getState().nodes).some(({ id }) => id === pin));
});

test('workspace inspector filters connectors and previews while retaining ordinary control contracts', () => {
  const node = ordinaryNode();
  node.data.params = {
    zero: { type: 'int', value: 0, min: 0, max: 100, step: 2 },
    off: { type: 'bool', value: false },
    locked: { type: 'string', value: '', disabled: true, onChange: 'schema_action' },
    secret: { hidden: true, value: 'hidden' },
    input: { isInput: true },
    output: { display: 'output' },
    preview: { display: 'ui_image' },
  };
  const before = structuredClone(node);
  const fields = inspector.graphNodeControlParams(node);
  assert.deepEqual(Object.keys(fields), ['zero', 'off', 'locked']);
  assert.equal(fields.zero.value, 0);
  assert.equal(fields.off.value, false);
  assert.equal(fields.locked.disabled, true);
  assert.equal(fields.locked.onChange, 'schema_action');
  assert.equal(fields.locked.fieldOptions.suppressInitialFieldAction, true);
  assert.deepEqual(node, before);
});

test('workspace reveal preserves explicit open tools and only reopens Studio when collapsed', () => {
  for (const tab of ['studio', 'queue', 'setup', 'block', 'compatibility']) {
    settingsStore.useSettingsStore.setState({ isRightPanelOpen: true, rightPanelTab: tab });
    visibility.revealWorkspaceForGraphEditing();
    assert.equal(settingsStore.useSettingsStore.getState().rightPanelTab, tab);
  }
  settingsStore.useSettingsStore.setState({ isRightPanelOpen: false, rightPanelTab: 'queue' });
  visibility.revealWorkspaceForGraphEditing();
  assert.equal(settingsStore.useSettingsStore.getState().isRightPanelOpen, true);
  assert.equal(settingsStore.useSettingsStore.getState().rightPanelTab, 'studio');
});

for (const clustered of [false, true]) {
  test(`inspector field actions update hidden controls and connector signals (${clustered ? 'nested Block' : 'ordinary node'})`, async () => {
    studioStore.useStudioStore.setState({ activeWorkflowTabId: 'field-actions', graphBinding: null });
    const params = {
      quant_type: {
        type: 'string',
        value: 'bnb_4bit',
        onChange: { bnb_4bit: ['bnb_4bit_quant_type'], bnb_8bit: ['llm_int8_threshold'] },
      },
      bnb_4bit_quant_type: { type: 'string', value: 'nf4', hidden: false },
      llm_int8_threshold: { type: 'float', value: 6, hidden: true },
      model_type: { type: 'string', value: 'transformer', onChange: { action: 'signal', target: 'model' } },
      model: { type: 'string', display: 'output' },
    };
    let node = { ...ordinaryNode(), data: { ...ordinaryNode().data, params } };
    let originalDefinition;
    let sibling;
    if (clustered) {
      const candidate = structuredClone(nestedModularRoot().data.blockInstanceV2.definitionSnapshot);
      candidate.graph.nodes.find(({ nodeId }) => nodeId === 'generate').data.params = params;
      candidate.graph.graphHash = schema.blockGraphHashV2(candidate.graph);
      candidate.contentHash = schema.blockDefinitionContentHashV2(candidate);
      originalDefinition = structuredClone(candidate);
      const makeRoot = (id) =>
        runtime.createBlockRootNodeV2(
          runtime.setBlockPresentationV2(
            schema.createBlockInstanceV2(candidate, {
              instanceId: id,
              position: { x: 0, y: 0 },
              size: { width: 980, height: 760 },
              collapsedContainerNodeIds: [],
            }),
            { expanded: true },
          ),
        );
      const block = makeRoot('actions-block');
      sibling = makeRoot('actions-sibling');
      const projection = runtime.materializeBlockProjectionV2(block);
      flowStore.useFlowStore.setState({ nodes: [...projection.nodes, sibling], edges: projection.edges });
      node = projection.nodes.find(({ data }) => data.blockProjectionNodeId === 'generate');
    } else {
      flowStore.useFlowStore.setState({ nodes: [node], edges: [] });
    }
    const read = () => flowStore.useFlowStore.getState().nodes.find(({ id }) => id === node.id).data.params;
    const actionProps = (fieldKey) => ({
      ...fieldActions.buildFieldActionProps(node.id, fieldKey),
      updateStore: (...args) => inspector.updateGraphNodeControl('field-actions', node.id, ...args),
      updateFieldActionStore: (param, value, key) =>
        inspector.updateGraphNodeControl('field-actions', node.id, param, value, key, fieldKey),
    });
    inspector.updateGraphNodeControl('field-actions', node.id, 'llm_int8_threshold', 99);
    assert.equal(read().llm_int8_threshold.value, 6, 'hidden controls cannot be edited directly');
    for (const value of ['bnb_8bit', 'bnb_4bit', 'bnb_8bit']) {
      const props = actionProps('quant_type');
      props.updateStore('quant_type', value);
      await fieldActions.default(props, value);
      assert.equal(read().llm_int8_threshold.hidden, value !== 'bnb_8bit');
      assert.equal(read().bnb_4bit_quant_type.hidden, value !== 'bnb_4bit');
    }
    await fieldActions.default(actionProps('model_type'), 'transformer');
    assert.deepEqual(read().model.signal, { direction: 'output', origin: 'model_type', value: 'transformer' });
    await fieldActions.default(
      { ...actionProps('model_type'), onChange: { action: 'value', target: 'bnb_4bit_quant_type' } },
      'fp4',
    );
    assert.equal(read().bnb_4bit_quant_type.value, 'fp4', 'declared actions can update hidden values');
    inspector.updateGraphNodeControl('field-actions', node.id, 'absent', 1, 'value', 'quant_type');
    inspector.updateGraphNodeControl('field-actions', node.id, 'quant_type', 'bad', 'value', 'absent');
    assert.equal(read().absent, undefined);
    assert.equal(read().quant_type.value, 'bnb_8bit');
    const stale = actionProps('quant_type');
    const beforeSwitch = structuredClone(read());
    studioStore.useStudioStore.setState({ activeWorkflowTabId: 'other-workflow' });
    await fieldActions.default(stale, 'bnb_4bit');
    inspector.updateGraphNodeControl('field-actions', node.id, 'quant_type', 'bad', 'value', 'quant_type');
    assert.deepEqual(read(), beforeSwitch);
    if (clustered) {
      const nodes = flowStore.useFlowStore.getState().nodes;
      assert.deepEqual(
        nodes.find(({ id }) => id === sibling.id),
        sibling,
      );
      assert.deepEqual(
        nodes.find(({ id }) => id === 'actions-block').data.blockInstanceV2.definitionSnapshot,
        originalDefinition,
      );
    }
  });
}

function inputFanoutRoot(id = 'block-v2-input-fanout') {
  const candidate = structuredClone(definition());
  candidate.graph.nodes.push({
    nodeId: 'prepare',
    nodeType: 'custom',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Prepare',
      label: 'Prepare',
      category: 'Test',
      params: { prompt: { type: 'string', display: 'input' } },
    },
  });
  candidate.graph.executionOrder = [
    ...(candidate.graph.executionOrder ?? candidate.graph.nodes.slice(0, -1).map(({ nodeId }) => nodeId)),
    'prepare',
  ];
  candidate.boundary.inputs[0].mirrorBindings = [{ nodeId: 'prepare', fieldOrPortId: 'prompt' }];
  delete candidate.graph.graphHash;
  candidate.graph.graphHash = schema.blockGraphHashV2(candidate.graph);
  delete candidate.contentHash;
  candidate.contentHash = schema.blockDefinitionContentHashV2(candidate);
  const fanoutDefinition = schema.normalizeBlockDefinitionV2(candidate);
  return runtime.createBlockRootNodeV2(
    schema.createBlockInstanceV2(fanoutDefinition, {
      instanceId: id,
      position: { x: 100, y: 120 },
      size: { width: 720, height: 640 },
    }),
  );
}

function previewRoot(id = 'block-v2-preview') {
  const base = definition();
  const semantic = {
    ...base,
    previews: [{ nodeId: 'generate', outputPortId: 'image', mediaType: 'image', primary: true }],
  };
  delete semantic.contentHash;
  const previewDefinition = {
    ...semantic,
    contentHash: schema.blockDefinitionContentHashV2(semantic),
  };
  return runtime.createBlockRootNodeV2(
    schema.createBlockInstanceV2(previewDefinition, {
      instanceId: id,
      position: { x: 100, y: 120 },
      size: { width: 420, height: 480 },
    }),
  );
}

function ordinaryNode(id = 'ordinary-utility', position = { x: 420, y: 390 }) {
  return {
    id,
    type: 'custom',
    position,
    width: 260,
    height: 180,
    selected: true,
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Utility',
      label: 'Utility',
      category: 'Test',
      progress: 0.72,
      executionStatus: 'running',
      params: {
        input: { type: 'image', display: 'input', artifacts: [{ id: 'runtime-only' }] },
        output: { type: 'image', display: 'output' },
      },
    },
  };
}

function modularMetadata(runtimeRole, placementPath, parentPlacementPath, blockKind = 'block') {
  return {
    kind: 'upstream_block',
    pipelineClass: 'QwenImageModularPipeline',
    blocksClass: 'QwenImageAutoBlocks',
    workflowId: 'text2image',
    libraryRevision: 'a'.repeat(40),
    runtimeRole,
    blockDefinitionId: `diffusers.modular-block:${runtimeRole}:sha256:${'b'.repeat(64)}`,
    blockClass: `${runtimeRole.replace(/[^A-Za-z0-9_]/gu, '_')}Block`,
    blockKind,
    blockContractHash: `sha256:${'c'.repeat(64)}`,
    placementPath,
    ...(parentPlacementPath ? { parentPlacementPath } : {}),
    componentNames: [],
  };
}

function nestedModularRoot(id = 'nested-adoption-root') {
  const base = definition();
  const graph = structuredClone(base.graph);
  graph.nodes.unshift({
    nodeId: 'denoise',
    nodeType: 'group',
    data: { type: 'group', label: 'Denoise', params: {} },
    modularDiffusers: modularMetadata('denoise', ['denoise'], undefined, 'sequential'),
  });
  graph.nodes = graph.nodes.map((node) =>
    node.nodeId === 'generate'
      ? { ...node, modularDiffusers: modularMetadata('generate', ['denoise', 'generate'], ['denoise']) }
      : node,
  );
  graph.executionOrder = ['denoise', ...(graph.executionOrder ?? [])];
  delete graph.graphHash;
  graph.graphHash = schema.blockGraphHashV2(graph);
  const candidate = { ...base, graph };
  delete candidate.contentHash;
  candidate.contentHash = schema.blockDefinitionContentHashV2(candidate);
  const instance = schema.createBlockInstanceV2(schema.normalizeBlockDefinitionV2(candidate), {
    instanceId: id,
    position: { x: 100, y: 120 },
    size: { width: 980, height: 760 },
    internalLayoutMode: 'hierarchical',
    // This test exercises adoption rather than progressive disclosure.
    collapsedContainerNodeIds: [],
    internalLayout: {
      denoise: { x: 40, y: 80, width: 720, height: 520 },
      generate: { x: 28, y: 72, width: 320, height: 260 },
    },
  });
  return runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(instance, { expanded: true }));
}

function modularCatalogNode(id = 'catalog-modular-step', position = { x: 760, y: 420 }) {
  const node = ordinaryNode(id, position);
  return {
    ...node,
    data: {
      ...node.data,
      label: 'Qwen Image Extra Step',
      category: 'Modular Diffusers',
      modularDiffusersCatalogNode: {
        ...modularMetadata('catalog-extra', ['catalog', 'extra']),
        sourceDefinitionId: 'diffusers.modular:QwenImageModularPipeline:text2image',
        sourcePlacementPath: ['catalog', 'extra'],
        sourceExecutionScope: 'unpruned_pipeline',
      },
    },
  };
}

test('nested declared controls edit one logical value, preserve siblings and execution, and undo cleanly', () => {
  const block = nestedModularRoot('nested-controls');
  const sibling = nestedModularRoot('nested-controls-sibling');
  const before = structuredClone(block.data.blockInstanceV2);
  const beforeSibling = structuredClone(sibling.data.blockInstanceV2);
  const projections = [block, sibling].map((node) => runtime.materializeBlockProjectionV2(node));
  const materialized = { nodes: projections.flatMap((p) => p.nodes), edges: projections.flatMap((p) => p.edges) };
  flowStore.useFlowStore.setState({ nodes: materialized.nodes, edges: materialized.edges });
  const container = materialized.nodes.find(
    (node) => node.data.blockProjectionOwnerId === block.id && node.data.blockProjectionNodeId === 'denoise',
  );
  const [alias, control] = Object.entries(container.data.params).find(([key]) => key.startsWith('block-control:'));
  assert.equal(control.label, 'Prompt');
  assert.equal(control.value, before.effectiveInterface.controls[0].defaultValue);
  assert.equal(control.fieldOptions.suppressInitialFieldAction, true);
  assert.equal(control.fieldOptions.blockBindingV2.logicalId, 'prompt');
  assert.equal(controlPolicy.classifyManagedControl(undefined, alias, control).surface, 'main');
  assert.equal(
    controlPolicy.classifyManagedControl(undefined, alias, { ...control, display: 'input' }).surface,
    'hidden',
  );
  flowStore.useFlowStore.getState().setParamWithHistory(container.id, alias, 'Intricate copper observatory');
  const state = flowStore.useFlowStore.getState();
  const edited = state.nodes.find((node) => node.id === block.id).data.blockInstanceV2;
  assert.equal(edited.values.prompt, 'Intricate copper observatory');
  for (const key of ['definitionSnapshot', 'effectiveGraph', 'effectiveInterface', 'presentation'])
    assert.deepEqual(edited[key], before[key]);
  assert.deepEqual(state.nodes.find((node) => node.id === sibling.id).data.blockInstanceV2, beforeSibling);
  const execution = runtime.expandBlockGraphV2ForExecution(state.nodes, state.edges);
  for (const node of execution.nodes)
    assert.ok(Object.keys(node.data.params ?? {}).every((key) => !key.startsWith('block-control:')));
  assert.equal(state.historyPast.length, 1);
  state.undo();
  assert.deepEqual(
    flowStore.useFlowStore.getState().nodes.find((node) => node.id === block.id).data.blockInstanceV2,
    before,
  );
  flowStore.useFlowStore.getState().redo();
  assert.equal(
    flowStore.useFlowStore.getState().nodes.find((node) => node.id === block.id).data.blockInstanceV2.values.prompt,
    'Intricate copper observatory',
  );
});

test('workspace pins survive nested Block collapse and reveal without rewriting execution or definitions', () => {
  const block = nestedModularRoot('pinned-nested');
  const materialized = runtime.materializeBlockProjectionV2(block);
  studioStore.useStudioStore.setState({ activeWorkflowTabId: 'pinned-workflow' });
  flowStore.useFlowStore.setState({ nodes: materialized.nodes, edges: materialized.edges });
  const pin = inspector
    .graphParamInputCandidates(materialized.nodes)
    .find(({ node, paramKey }) => node.data.blockProjectionNodeId === 'generate' && paramKey === 'prompt');
  assert.ok(pin);
  const before = structuredClone(block.data.blockInstanceV2);
  flowStore.useFlowStore.getState().setBlockPresentationV2(block.id, {
    expanded: false,
    collapsedContainerNodeIds: ['denoise'],
  });
  const collapsed = flowStore.useFlowStore.getState();
  const beforeRead = structuredClone(collapsed.nodes);
  const resolved = inspector.graphParamInputCandidates(collapsed.nodes, [pin.id]).find(({ id }) => id === pin.id);
  assert.ok(resolved);
  assert.equal(resolved.param.value, pin.param.value);
  assert.deepEqual(flowStore.useFlowStore.getState().nodes, beforeRead);
  inspector.updateGraphNodeControl('pinned-workflow', pin.nodeId, pin.paramKey, 'cannot edit absent node');
  assert.deepEqual(flowStore.useFlowStore.getState().nodes, beforeRead);
  inspector.revealPinnedGraphInput('other-workflow', resolved.node);
  assert.deepEqual(flowStore.useFlowStore.getState().nodes, beforeRead);
  inspector.revealPinnedGraphInput('pinned-workflow', resolved.node);
  const revealed = flowStore.useFlowStore.getState();
  assert.ok(revealed.nodes.some(({ id }) => id === pin.nodeId));
  const instance = revealed.nodes.find(({ id }) => id === block.id).data.blockInstanceV2;
  for (const key of ['definitionSnapshot', 'effectiveGraph', 'effectiveInterface', 'values'])
    assert.deepEqual(instance[key], before[key]);
  inspector.updateGraphNodeControl('pinned-workflow', pin.nodeId, pin.paramKey, 'nested inspector edit');
  assert.equal(
    flowStore.useFlowStore.getState().nodes.find(({ id }) => id === block.id).data.blockInstanceV2.values.prompt,
    'nested inspector edit',
  );
});

test('internal interface drafts are local and reject cross-branch consumers and stale values', () => {
  const original = nestedModularRoot('scope').data.blockInstanceV2;
  const graph = structuredClone(original.effectiveGraph);
  graph.nodes.push({
    nodeId: 'outside',
    nodeType: 'custom',
    data: { type: 'custom', params: { other: { type: 'string', value: 'keep' } } },
  });
  graph.executionOrder.push('outside');
  const current = runtime.replaceBlockEffectiveGraphV2(original, graph);
  const boundary = structuredClone(current.effectiveInterface.boundary);
  boundary.inputs.push({
    portId: 'outside',
    label: 'Outside',
    valueType: 'string',
    required: false,
    binding: { nodeId: 'outside', fieldOrPortId: 'other' },
  });
  const source = runtime.replaceBlockEffectiveInterfaceV2(current, {
    boundary,
    controls: current.effectiveInterface.controls,
  });
  const draft = interfaceEditing.blockInterfaceDraftV2(source, 'denoise');
  assert.deepEqual(
    draft.boundary.inputs.map((port) => port.binding),
    [{ nodeId: 'generate', fieldOrPortId: 'prompt' }],
  );
  draft.controls[0].label = 'Scene description';
  const merged = interfaceEditing.mergeBlockInterfaceDraftV2(source, source, draft, 'denoise');
  assert.equal(
    merged.boundary.inputs.some((port) => port.portId === 'outside'),
    false,
  );
  assert.deepEqual(source.effectiveInterface.boundary, boundary);
  assert.equal(merged.controls[0].label, 'Scene description');
  const bad = structuredClone(draft);
  bad.controls[0].mirrorBindings = [{ nodeId: 'outside', fieldId: 'other' }];
  assert.throws(() => interfaceEditing.mergeBlockInterfaceDraftV2(source, source, bad, 'denoise'), /unknown node/);
  const stale = runtime.setBlockInstanceValueV2(source, 'prompt', 'changed after opening');
  assert.throws(() => interfaceEditing.mergeBlockInterfaceDraftV2(source, stale, draft, 'denoise'), /changed while/);
  assert.throws(() => interfaceEditing.blockInterfaceDraftV2(source, 'removed'), /no longer exists/);
});

test('a local interface declares only its branch without changing shared root mirror bindings', () => {
  const source = inputFanoutRoot('scope-mirror').data.blockInstanceV2;
  const draft = interfaceEditing.blockInterfaceDraftV2(source, 'generate');
  assert.equal(draft.boundary.inputs.length, 1);
  assert.deepEqual(draft.boundary.inputs[0].binding, { nodeId: 'generate', fieldOrPortId: 'prompt' });
  assert.equal(draft.boundary.inputs[0].mirrorBindings, undefined);
  draft.boundary.inputs = [];
  const merged = interfaceEditing.mergeBlockInterfaceDraftV2(source, source, draft, 'generate');
  assert.deepEqual(merged.boundary.inputs, []);
  assert.equal(source.effectiveInterface.boundary.inputs[0].mirrorBindings.length, 1);
});

test('new interface controls seed current values including null, zero, and empty strings', () => {
  const source = nestedModularRoot('control-defaults').data.blockInstanceV2;
  assert.equal(interfaceEditing.blockInterfaceFieldValueV2(source, 'generate', 'steps'), 8);
  for (const value of ['', 'edited prompt']) {
    const edited = runtime.setBlockInstanceValueV2(source, 'prompt', value);
    assert.equal(interfaceEditing.blockInterfaceFieldValueV2(edited, 'generate', 'prompt'), value);
  }
  for (const value of [null, 0, '']) {
    const changed = structuredClone(source);
    changed.effectiveGraph.nodes.find((node) => node.nodeId === 'generate').data.params.steps.value = value;
    assert.equal(interfaceEditing.blockInterfaceFieldValueV2(changed, 'generate', 'steps'), value);
  }
});

function modularCatalogFragment(id = 'catalog-modular-fragment', position = { x: 760, y: 420 }) {
  const sourceDefinitionId = 'diffusers.modular:QwenImageModularPipeline:text2image';
  const source = {
    kind: 'diffusers_catalog',
    catalogCategory: 'diffusers',
    provider: 'huggingface',
    library: 'diffusers',
    libraryRevision: 'a'.repeat(40),
    pipelineClass: 'QwenImageModularPipeline',
    blocksClass: 'QwenImageAutoBlocks',
    workflow: 'text2image',
    manifestDefinitionId: sourceDefinitionId,
    manifestContentHash: `sha256:${'d'.repeat(64)}`,
  };
  const withSource = (metadata, sourcePlacementPath) => ({
    ...metadata,
    sourceDefinitionId,
    sourcePlacementPath,
    sourceExecutionScope: 'unpruned_pipeline',
  });
  const graphSemantic = {
    nodes: [
      {
        nodeId: 'fragment-root',
        nodeType: 'group',
        data: { type: 'group', label: 'Extra sequence', params: {}, resizable: true },
        modularDiffusers: withSource(modularMetadata('catalog-extra', ['catalog-extra'], undefined, 'sequential'), [
          'catalog-extra',
        ]),
      },
      {
        nodeId: 'fragment-leaf',
        nodeType: 'custom',
        data: modularCatalogNode('unused').data,
        modularDiffusers: withSource(
          modularMetadata('catalog-extra-leaf', ['catalog-extra', 'leaf'], ['catalog-extra']),
          ['catalog-extra', 'leaf'],
        ),
      },
    ],
    edges: [],
    executionOrder: ['fragment-root', 'fragment-leaf'],
  };
  const graph = { ...graphSemantic, graphHash: schema.blockGraphHashV2(graphSemantic) };
  const draft = {
    schemaVersion: 2,
    definitionId: 'diffusers.modular-fragment:QwenImageModularPipeline:extra',
    displayName: 'Qwen extra sequence',
    description: 'Exact nested catalog fragment.',
    source,
    graph,
    boundary: { mode: 'explicit', inputs: [], outputs: [] },
    controls: [],
    previews: [],
    ownership: { kind: 'registered', definitionMutable: false },
  };
  const blockDefinition = schema.normalizeBlockDefinitionV2({
    ...draft,
    contentHash: schema.blockDefinitionContentHashV2(draft),
  });
  return runtime.createBlockRootNodeV2(
    schema.createBlockInstanceV2(blockDefinition, {
      instanceId: id,
      position,
      size: { width: 520, height: 480 },
      internalLayoutMode: 'hierarchical',
      internalLayout: {
        'fragment-root': { x: 30, y: 80, width: 360, height: 300 },
        'fragment-leaf': { x: 24, y: 70, width: 260, height: 160 },
      },
    }),
  );
}

test('the shared store edits V2 values without creating a second NodeData authority', () => {
  const first = root();
  const second = root('block-v2-two');
  flowStore.useFlowStore.setState({ nodes: [first, second], edges: [] });

  flowStore.useFlowStore.getState().setBlockInstanceValueV2(first.id, 'prompt', 'instance-only edit');
  let state = flowStore.useFlowStore.getState();
  const edited = state.nodes.find((node) => node.id === first.id);
  const untouched = state.nodes.find((node) => node.id === second.id);
  assert.equal(edited.data.blockInstanceV2.values.prompt, 'instance-only edit');
  assert.deepEqual(edited.data.params, {});
  assert.equal(untouched.data.blockInstanceV2.values.prompt, undefined);

  flowStore.useFlowStore.getState().applyBlockSuggestedInputsV2(first.id, 'creator-example');
  state = flowStore.useFlowStore.getState();
  assert.equal(
    state.nodes.find((node) => node.id === first.id).data.blockInstanceV2.values.prompt,
    'creator suggested prompt',
  );
});

test('backend preview state stays instance-local, non-history, and outside root params', () => {
  const first = previewRoot();
  const second = previewRoot('block-v2-preview-sibling');
  flowStore.useFlowStore.setState({ nodes: [first, second], edges: [], historyPast: [] });

  flowStore.useFlowStore.getState().setBlockPreviewStateV2(
    first.id,
    { nodeId: 'generate', outputPortId: 'image' },
    {
      mediaReference: '/data/generated/block-v2-preview.png',
      taskId: 'task-block-v2-preview',
      status: 'complete',
    },
  );

  const state = flowStore.useFlowStore.getState();
  const updated = state.nodes.find((node) => node.id === first.id);
  const untouched = state.nodes.find((node) => node.id === second.id);
  assert.deepEqual(updated.data.blockInstanceV2.previewStates[0], {
    binding: first.data.blockInstanceV2.previewStates[0].binding,
    mediaReference: '/data/generated/block-v2-preview.png',
    taskId: 'task-block-v2-preview',
    status: 'complete',
  });
  assert.deepEqual(updated.data.params, {});
  assert.equal(untouched.data.blockInstanceV2.previewStates[0].status, 'idle');
  assert.equal(untouched.data.blockInstanceV2.previewStates[0].mediaReference, undefined);
  assert.equal(state.historyPast.length, 0);
});

test('expand, internal edits, layout persistence, collapse, and rematerialization stay on one V2 instance', () => {
  const block = root();
  flowStore.useFlowStore.setState({ nodes: [block], edges: [] });
  flowStore.useFlowStore.getState().toggleUserBlockExpanded(block.id);
  let state = flowStore.useFlowStore.getState();
  let child = state.nodes.find((node) => node.data.blockProjectionOwnerId === block.id);
  assert.ok(child);
  assert.equal(child.parentId, block.id);

  flowStore.useFlowStore.getState().setParamWithHistory(child.id, 'prompt', 'expanded edit');
  state = flowStore.useFlowStore.getState();
  assert.equal(state.nodes.find((node) => node.id === block.id).data.blockInstanceV2.values.prompt, 'expanded edit');

  child = state.nodes.find((node) => node.data.blockProjectionOwnerId === block.id);
  flowStore.useFlowStore.setState({
    nodes: state.nodes.map((node) => (node.id === child.id ? { ...node, position: { x: 222, y: 144 } } : node)),
  });
  flowStore.useFlowStore.getState().persistBlockCanvasPresentationV2(child.id);
  state = flowStore.useFlowStore.getState();
  assert.deepEqual(
    state.nodes.find((node) => node.id === block.id).data.blockInstanceV2.presentation.internalLayout.generate,
    { x: 222, y: 144, width: child.width, height: child.height },
  );

  flowStore.useFlowStore.getState().toggleUserBlockExpanded(block.id);
  assert.equal(
    flowStore.useFlowStore.getState().nodes.some((node) => node.data.blockProjectionOwnerId === block.id),
    false,
  );
  flowStore.useFlowStore.getState().toggleUserBlockExpanded(block.id);
  child = flowStore.useFlowStore.getState().nodes.find((node) => node.data.blockProjectionOwnerId === block.id);
  assert.deepEqual(child.position, { x: 222, y: 144 });
  assert.equal(child.data.userBlockInstanceId, undefined);
  assert.equal(child.data.huggingFaceClusterInstanceId, undefined);
});

test('Arrange graph moves V2 roots durably without rearranging nested projections or changing execution', async () => {
  const initial = nestedModularRoot('arrange-nested-root');
  const projection = runtime.materializeBlockProjectionV2(initial);
  flowStore.useFlowStore.setState({ nodes: [...projection.nodes, ordinaryNode()], edges: projection.edges });
  const instanceBefore = structuredClone(initial.data.blockInstanceV2);
  const childrenBefore = structuredClone(projection.nodes.filter((node) => node.id !== initial.id));
  await flowStore.useFlowStore.getState().arrangeGraph();
  let state = flowStore.useFlowStore.getState();
  const arrangedRoot = state.nodes.find((node) => node.id === initial.id);
  const arranged = arrangedRoot.data.blockInstanceV2;
  assert.deepEqual(arranged.presentation.position, arrangedRoot.position);
  assert.notDeepEqual(arrangedRoot.position, initial.position);
  assert.deepEqual(arranged.presentation.internalLayout, instanceBefore.presentation.internalLayout);
  assert.deepEqual(arranged.presentation.size, instanceBefore.presentation.size);
  assert.deepEqual(arranged.effectiveGraph, instanceBefore.effectiveGraph);
  assert.deepEqual(arranged.effectiveInterface, instanceBefore.effectiveInterface);
  assert.deepEqual(arranged.values, instanceBefore.values);
  assert.deepEqual(
    state.nodes.filter((node) => node.data.blockProjectionOwnerId === initial.id),
    childrenBefore,
  );
  const persisted = JSON.parse(JSON.stringify(arranged));
  const restored = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(persisted));
  assert.deepEqual(restored.nodes[0].position, arrangedRoot.position);
  assert.deepEqual(
    restored.nodes.filter((node) => node.id !== initial.id),
    childrenBefore,
  );
  state.undo();
  state = flowStore.useFlowStore.getState();
  assert.deepEqual(state.nodes.find((node) => node.id === initial.id).data.blockInstanceV2, instanceBefore);
});

test('a disconnected top-level node adopts into an expanded V2 Block as one durable undoable edit', () => {
  const initialRoot = root('block-v2-adoption');
  const initialBoundary = structuredClone(initialRoot.data.blockInstanceV2.definitionSnapshot.boundary);
  const expandedInstance = runtime.setBlockPresentationV2(initialRoot.data.blockInstanceV2, { expanded: true });
  const expanded = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expandedInstance));
  const ordinary = ordinaryNode();
  flowStore.useFlowStore.setState({
    nodes: [...expanded.nodes, ordinary],
    edges: expanded.edges,
    historyPast: [],
    historyFuture: [],
  });

  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(ordinary.id, expandedInstance.instanceId);
  let state = flowStore.useFlowStore.getState();
  let adoptedRoot = state.nodes.find((node) => node.id === expandedInstance.instanceId);
  let adopted = state.nodes.find((node) => node.data.blockProjectionNodeId === ordinary.id);
  assert.equal(
    state.nodes.some((node) => node.id === ordinary.id),
    false,
  );
  assert.ok(adoptedRoot);
  assert.ok(adopted);
  assert.equal(adopted.parentId, adoptedRoot.id);
  const preferredPosition = {
    x: ordinary.position.x - initialRoot.position.x,
    y: ordinary.position.y - initialRoot.position.y,
  };
  assert.equal(adopted.position.y, preferredPosition.y);
  assert.ok(adopted.position.x >= preferredPosition.x);
  const fittedPosition = { ...adopted.position };
  const stored = adoptedRoot.data.blockInstanceV2.presentation.internalLayout[ordinary.id];
  assert.deepEqual({ x: stored.x, y: stored.y }, preferredPosition);
  assert.equal(adopted.width, ordinary.width);
  assert.equal(adopted.height, ordinary.height);
  const semantic = adoptedRoot.data.blockInstanceV2.effectiveGraph.nodes.find((node) => node.nodeId === ordinary.id);
  assert.ok(semantic);
  assert.equal(semantic.data.progress, undefined);
  assert.equal(semantic.data.executionStatus, undefined);
  assert.equal(semantic.data.params.input.artifacts, undefined);
  assert.deepEqual(adoptedRoot.data.blockInstanceV2.definitionSnapshot.boundary, initialBoundary);
  assert.equal(adoptedRoot.data.blockInstanceV2.customization.state, 'structure_changed');
  assert.deepEqual(adoptedRoot.data.params, {});
  assert.equal(state.historyPast.length, 1);

  state.undo();
  state = flowStore.useFlowStore.getState();
  assert.ok(state.nodes.find((node) => node.id === ordinary.id));
  assert.equal(
    state.nodes
      .find((node) => node.id === expandedInstance.instanceId)
      .data.blockInstanceV2.effectiveGraph.nodes.some((node) => node.nodeId === ordinary.id),
    false,
  );
  state.redo();
  state = flowStore.useFlowStore.getState();
  assert.equal(
    state.nodes.some((node) => node.id === ordinary.id),
    false,
  );
  assert.equal(
    state.nodes
      .find((node) => node.id === expandedInstance.instanceId)
      .data.blockInstanceV2.effectiveGraph.nodes.some((node) => node.nodeId === ordinary.id),
    true,
  );

  const saved = flowStore.normalizePersistedFlowState(state);
  assert.deepEqual(
    saved.nodes.map((node) => node.id),
    [expandedInstance.instanceId],
  );
  assert.equal(saved.edges.length, 0);
  flowStore.useFlowStore.setState({
    ...saved,
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  flowStore.useFlowStore.getState().ensureBlockProjectionV2(expandedInstance.instanceId);
  state = flowStore.useFlowStore.getState();
  adoptedRoot = state.nodes.find((node) => node.id === expandedInstance.instanceId);
  adopted = state.nodes.find((node) => node.data.blockProjectionNodeId === ordinary.id);
  assert.ok(adopted);
  assert.equal(adopted.parentId, expandedInstance.instanceId);
  assert.deepEqual(adopted.position, fittedPosition);
  assert.deepEqual(adoptedRoot.data.blockInstanceV2.definitionSnapshot.boundary, initialBoundary);
});

test('a catalog Modular Diffusers node adopts into the selected nested container and survives projection refresh', () => {
  const initial = nestedModularRoot();
  const projection = runtime.materializeBlockProjectionV2(initial);
  const catalogNode = modularCatalogNode();
  flowStore.useFlowStore.setState({
    nodes: [...projection.nodes, catalogNode],
    edges: projection.edges,
    historyPast: [],
  });

  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(catalogNode.id, initial.id, 'denoise');
  let state = flowStore.useFlowStore.getState();
  const rootNode = state.nodes.find((node) => node.id === initial.id);
  const adoptedSemantic = rootNode.data.blockInstanceV2.effectiveGraph.nodes.find(
    ({ nodeId }) => nodeId === catalogNode.id,
  );
  assert.deepEqual(adoptedSemantic.modularDiffusers.placementPath, ['denoise', 'extra']);
  assert.deepEqual(adoptedSemantic.modularDiffusers.parentPlacementPath, ['denoise']);
  assert.equal(
    adoptedSemantic.modularDiffusers.sourceDefinitionId,
    'diffusers.modular:QwenImageModularPipeline:text2image',
  );
  assert.deepEqual(adoptedSemantic.modularDiffusers.sourcePlacementPath, ['catalog', 'extra']);
  assert.equal(adoptedSemantic.modularDiffusers.sourceExecutionScope, 'unpruned_pipeline');
  const denoiseProjection = state.nodes.find(
    (node) => node.data.blockProjectionOwnerId === initial.id && node.data.blockProjectionNodeId === 'denoise',
  );
  const adoptedProjection = state.nodes.find(
    (node) => node.data.blockProjectionOwnerId === initial.id && node.data.blockProjectionNodeId === catalogNode.id,
  );
  assert.equal(adoptedProjection.parentId, denoiseProjection.id);
  assert.equal(state.historyPast.length, 1);

  const persisted = flowStore.normalizePersistedFlowState(state);
  flowStore.useFlowStore.setState({ ...persisted, historyPast: [], historyFuture: [] });
  flowStore.useFlowStore.getState().ensureBlockProjectionV2(initial.id);
  state = flowStore.useFlowStore.getState();
  const refreshedContainer = state.nodes.find(
    (node) => node.data.blockProjectionOwnerId === initial.id && node.data.blockProjectionNodeId === 'denoise',
  );
  const refreshedAdopted = state.nodes.find(
    (node) => node.data.blockProjectionOwnerId === initial.id && node.data.blockProjectionNodeId === catalogNode.id,
  );
  assert.equal(refreshedAdopted.parentId, refreshedContainer.id);
  assert.equal(state.nodes.find((node) => node.id === initial.id).data.blockInstanceV2.effectiveGraph.nodes.length, 3);
});

test('moving a Modular leaf out and back preserves exact source identity instead of downgrading it to an untyped utility', () => {
  const initial = nestedModularRoot('move-out-source-identity');
  const projection = runtime.materializeBlockProjectionV2(initial);
  const source = modularCatalogNode('retained-catalog-identity');
  flowStore.useFlowStore.setState({ nodes: [...projection.nodes, source], edges: projection.edges });
  const get = flowStore.useFlowStore.getState;
  get().resetHistory();
  get().adoptNodeIntoBlockV2(source.id, initial.id, 'denoise');
  const projected = get().nodes.find((n) => n.data.blockProjectionNodeId === source.id);
  const metadata = get()
    .nodes.find((n) => n.id === initial.id)
    .data.blockInstanceV2.effectiveGraph.nodes.find((n) => n.nodeId === source.id).modularDiffusers;
  const movedId = get().moveNodeOutOfBlockV2(projected.id, { x: 1200, y: 800 });
  const moved = get().nodes.find((n) => n.id === movedId);
  assert.deepEqual(moved.data.modularDiffusersCatalogNode, metadata);
  assert.equal(moved.data.blockProjectionOwnerId, undefined);
  assert.equal(moved.data.blockProjectionModular, undefined);
  get().adoptNodeIntoBlockV2(movedId, initial.id, 'denoise');
  const returned = get()
    .nodes.find((n) => n.id === initial.id)
    .data.blockInstanceV2.effectiveGraph.nodes.find((n) => n.nodeId === movedId);
  assert.deepEqual(returned.modularDiffusers, metadata);
  assert.equal(returned.data.modularDiffusersCatalogNode, undefined);
});

test('a saved subtree binds destination context after baking source hidden values', () => {
  const target = nestedModularRoot('context-target');
  const fragment = modularCatalogFragment('context-source');
  const current = fragment.data.blockInstanceV2;
  const changed = structuredClone(current.effectiveGraph);
  const leaf = changed.nodes.find((n) => n.nodeId === 'fragment-leaf');
  leaf.data.params.pipeline_class = {
    type: 'string',
    display: 'text',
    hidden: true,
    value: 'QwenImageModularPipeline',
  };
  leaf.data.params.workflow_id = { type: 'string', display: 'text', hidden: true, value: 'image_conditioned' };
  fragment.data.blockInstanceV2 = runtime.replaceBlockEffectiveGraphV2(current, changed);
  const projection = runtime.materializeBlockProjectionV2(target);
  flowStore.useFlowStore.setState({ nodes: [...projection.nodes, fragment], edges: projection.edges });
  flowStore.useFlowStore.getState().adoptBlockFragmentIntoBlockV2(fragment.id, target.id, 'denoise');
  const instance = flowStore.useFlowStore.getState().nodes.find((n) => n.id === target.id).data.blockInstanceV2;
  const adopted = instance.effectiveGraph.nodes.find(
    (n) => n.modularDiffusers?.runtimeRole === 'custom:denoise/catalog-extra/leaf',
  );
  assert.equal(adopted.data.params.workflow_id.value, 'text2image');
  assert.equal(adopted.data.params.pipeline_class.value, 'QwenImageModularPipeline');
  for (const [key, field] of Object.entries(leaf.data.params)) {
    if (!['pipeline_class', 'workflow_id'].includes(key)) assert.deepEqual(adopted.data.params[key], field);
  }
  assert.deepEqual(adopted.modularDiffusers.sourcePlacementPath, ['catalog-extra', 'leaf']);
  const restored = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(instance)));
  assert.deepEqual(restored.effectiveGraph, instance.effectiveGraph);
});

test('a catalog Modular subtree flattens into ordinary internal nodes and survives Save/refresh', () => {
  const target = nestedModularRoot('nested-fragment-target');
  const projection = runtime.materializeBlockProjectionV2(target);
  const fragment = modularCatalogFragment();
  flowStore.useFlowStore.setState({
    nodes: [...projection.nodes, fragment],
    edges: projection.edges,
    historyPast: [],
    historyFuture: [],
  });

  flowStore.useFlowStore.getState().adoptBlockFragmentIntoBlockV2(fragment.id, target.id, 'denoise');
  let state = flowStore.useFlowStore.getState();
  assert.equal(
    state.nodes.some(({ id }) => id === fragment.id),
    false,
  );
  const changedRoot = state.nodes.find(({ id }) => id === target.id);
  const adopted = changedRoot.data.blockInstanceV2.effectiveGraph.nodes.filter(({ modularDiffusers }) =>
    modularDiffusers?.runtimeRole.startsWith('custom:denoise/catalog-extra'),
  );
  assert.equal(adopted.length, 2);
  assert.equal(
    adopted.some(({ nodeType }) => nodeType === 'block' || nodeType === 'cluster'),
    false,
  );
  const adoptedRoot = adopted.find(
    ({ modularDiffusers }) => modularDiffusers.placementPath.join('/') === 'denoise/catalog-extra',
  );
  const adoptedLeaf = adopted.find(
    ({ modularDiffusers }) => modularDiffusers.placementPath.join('/') === 'denoise/catalog-extra/leaf',
  );
  assert.ok(adoptedRoot);
  assert.ok(adoptedLeaf);
  assert.deepEqual(adoptedLeaf.modularDiffusers.parentPlacementPath, ['denoise', 'catalog-extra']);
  assert.deepEqual(adoptedLeaf.modularDiffusers.sourcePlacementPath, ['catalog-extra', 'leaf']);
  const adoptedRootProjection = state.nodes.find(
    ({ data }) => data.blockProjectionOwnerId === target.id && data.blockProjectionNodeId === adoptedRoot.nodeId,
  );
  assert.equal(
    adoptedRootProjection.data.blockProjectionContainerExpanded,
    false,
    'a newly nested Block starts collapsed',
  );
  assert.equal(
    state.nodes.some(({ data }) => data.blockProjectionNodeId === adoptedLeaf.nodeId),
    false,
  );
  assert.equal(state.historyPast.length, 1);
  state.toggleBlockContainerExpandedV2(target.id, adoptedRoot.nodeId);
  state = flowStore.useFlowStore.getState();
  const adoptedLeafProjection = state.nodes.find(
    ({ data }) => data.blockProjectionOwnerId === target.id && data.blockProjectionNodeId === adoptedLeaf.nodeId,
  );
  assert.equal(adoptedLeafProjection.parentId, adoptedRootProjection.id);
  assert.equal(state.historyPast.length, 2);

  const persisted = flowStore.normalizePersistedFlowState(state);
  assert.deepEqual(
    persisted.nodes.map(({ id }) => id),
    [target.id],
  );
  flowStore.useFlowStore.setState({ ...persisted, historyPast: [], historyFuture: [] });
  flowStore.useFlowStore.getState().ensureBlockProjectionV2(target.id);
  state = flowStore.useFlowStore.getState();
  const restoredRoot = state.nodes.find(({ id }) => id === target.id);
  assert.equal(
    restoredRoot.data.blockInstanceV2.effectiveGraph.nodes.filter(({ modularDiffusers }) =>
      modularDiffusers?.runtimeRole.startsWith('custom:denoise/catalog-extra'),
    ).length,
    2,
  );
});

test('connected adoption consumes an existing Block public edge without inferring a new interface', () => {
  const initial = root('block-v2-public-crossing');
  const expandedInstance = runtime.setBlockPresentationV2(initial.data.blockInstanceV2, { expanded: true });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expandedInstance));
  const utility = ordinaryNode('public-crossing-utility');
  flowStore.useFlowStore.setState({ nodes: [...projection.nodes, utility], edges: projection.edges, historyPast: [] });
  flowStore.useFlowStore.getState().onConnect({
    source: initial.id,
    sourceHandle: 'image',
    target: utility.id,
    targetHandle: 'input',
  });
  const interfaceBefore = structuredClone(expandedInstance.effectiveInterface);
  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(utility.id, initial.id);
  let state = flowStore.useFlowStore.getState();
  const authoritative = state.nodes.find((node) => node.id === initial.id).data.blockInstanceV2;
  assert.deepEqual(authoritative.effectiveInterface.boundary, interfaceBefore.boundary);
  assert.equal(
    authoritative.effectiveGraph.nodes.some(({ nodeId }) => nodeId === utility.id),
    true,
  );
  assert.equal(
    authoritative.effectiveGraph.edges.some(
      ({ sourceNodeId, sourcePortId, targetNodeId, targetPortId }) =>
        sourceNodeId === 'generate' &&
        sourcePortId === 'image' &&
        targetNodeId === utility.id &&
        targetPortId === 'input',
    ),
    true,
  );
  assert.equal(
    state.edges.some((edge) => edge.source === initial.id && edge.target === utility.id),
    false,
  );
  assert.equal(state.historyPast.length, 2);
  state.undo();
  state = flowStore.useFlowStore.getState();
  assert.ok(state.nodes.find((node) => node.id === utility.id));
  assert.equal(
    state.edges.some((edge) => edge.source === initial.id && edge.target === utility.id),
    true,
  );
});

test('legacy punctuation-prefixed ordinary IDs remain adoptable with exact crossing edges and Undo', () => {
  for (const id of ['_legacy-node', '-legacy-node']) {
    const initial = root('block-v2-legacy-id');
    const expanded = runtime.setBlockPresentationV2(initial.data.blockInstanceV2, { expanded: true });
    const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expanded));
    const utility = ordinaryNode(id);
    flowStore.useFlowStore.setState({
      nodes: [...projection.nodes, utility],
      edges: projection.edges,
      historyPast: [],
    });
    flowStore.useFlowStore.getState().onConnect({
      source: initial.id,
      sourceHandle: 'image',
      target: id,
      targetHandle: 'input',
    });
    flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(id, initial.id);
    let state = flowStore.useFlowStore.getState();
    const instance = state.nodes.find((node) => node.id === initial.id).data.blockInstanceV2;
    const adopted = instance.effectiveGraph.nodes.find((node) => node.nodeId === `node-${id}`);
    assert.ok(adopted);
    for (const [key, param] of Object.entries(utility.data.params)) {
      assert.equal(adopted.data.params[key].type, param.type);
      assert.equal(adopted.data.params[key].display, param.display);
      assert.deepEqual(adopted.data.params[key].value, param.value);
    }
    assert.deepEqual(instance.values, expanded.values);
    assert.deepEqual(instance.definitionSnapshot, expanded.definitionSnapshot);
    assert.deepEqual(instance.effectiveInterface, expanded.effectiveInterface);
    assert.ok(
      instance.effectiveGraph.edges.some(
        (edge) =>
          edge.sourceNodeId === 'generate' &&
          edge.sourcePortId === 'image' &&
          edge.targetNodeId === adopted.nodeId &&
          edge.targetPortId === 'input',
      ),
    );
    assert.doesNotThrow(() => runtime.expandBlockGraphV2ForExecution(state.nodes, state.edges));
    state.undo();
    const undone = flowStore.useFlowStore.getState();
    assert.ok(undone.nodes.some((node) => node.id === id));
    assert.deepEqual(undone.nodes.find((node) => node.id === id).position, utility.position);
    assert.deepEqual(
      undone.nodes.find((node) => node.id === initial.id).data.blockInstanceV2.effectiveGraph,
      expanded.effectiveGraph,
    );
    assert.ok(undone.edges.some((edge) => edge.source === initial.id && edge.target === id));
    flowStore.useFlowStore.getState().redo();
    state = flowStore.useFlowStore.getState();
    assert.deepEqual(state.nodes.find((node) => node.id === initial.id).data.blockInstanceV2, instance);
  }
});

test('public-input fan-out adoption materializes every declared target and move-out coalesces one root edge', () => {
  const initial = inputFanoutRoot();
  const expandedInstance = runtime.setBlockPresentationV2(initial.data.blockInstanceV2, { expanded: true });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expandedInstance));
  const source = {
    id: 'fanout-source',
    type: 'custom',
    position: { x: 0, y: 360 },
    width: 240,
    height: 160,
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'TextSource',
      label: 'Text source',
      category: 'Test',
      params: { text: { type: 'string', display: 'output' } },
    },
  };
  flowStore.useFlowStore.setState({ nodes: [...projection.nodes, source], edges: projection.edges, historyPast: [] });
  flowStore.useFlowStore.getState().onConnect({
    source: source.id,
    sourceHandle: 'text',
    target: initial.id,
    targetHandle: 'prompt',
  });
  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(source.id, initial.id);

  let state = flowStore.useFlowStore.getState();
  let instance = state.nodes.find((node) => node.id === initial.id).data.blockInstanceV2;
  assert.deepEqual(
    instance.effectiveGraph.edges
      .filter(({ sourceNodeId }) => sourceNodeId === source.id)
      .map(({ sourcePortId, targetNodeId, targetPortId }) => `${sourcePortId}>${targetNodeId}:${targetPortId}`)
      .sort(),
    ['text>generate:prompt', 'text>prepare:prompt'],
  );
  assert.equal(
    state.edges.some((edge) => edge.source === source.id && edge.target === initial.id),
    false,
  );

  const projectedSource = state.nodes.find((node) => node.data.blockProjectionNodeId === source.id);
  assert.ok(projectedSource);
  const movedId = state.moveNodeOutOfBlockV2(projectedSource.id, { x: 980, y: 420 });
  state = flowStore.useFlowStore.getState();
  instance = state.nodes.find((node) => node.id === initial.id).data.blockInstanceV2;
  assert.equal(movedId, source.id);
  assert.equal(
    instance.effectiveGraph.nodes.some(({ nodeId }) => nodeId === source.id),
    false,
  );
  assert.deepEqual(
    state.edges
      .filter((edge) => edge.source === source.id && edge.target === initial.id)
      .map(({ sourceHandle, targetHandle }) => `${sourceHandle}>${targetHandle}`),
    ['text>prompt'],
  );
});

test('adopting a connected node normalizes legacy edge IDs without changing its definition or undo snapshot', () => {
  for (const edgeId of ['-legacy-edge', '_legacy-edge']) {
    const block = inputFanoutRoot();
    const projection = runtime.materializeBlockProjectionV2(
      runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(block.data.blockInstanceV2, { expanded: true })),
    );
    const source = ordinaryNode('legacy-edge-source');
    source.data.params = { text: { type: 'string', display: 'output' } };
    const edge = { id: edgeId, source: source.id, sourceHandle: 'text', target: block.id, targetHandle: 'prompt' };
    flowStore.useFlowStore.setState({
      nodes: [...projection.nodes, source],
      edges: [...projection.edges, edge],
      historyPast: [],
    });
    flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(source.id, block.id);
    const instance = flowStore.useFlowStore.getState().nodes.find(({ id }) => id === block.id).data.blockInstanceV2;
    assert.deepEqual(instance.definitionSnapshot, block.data.blockInstanceV2.definitionSnapshot);
    assert.equal(instance.effectiveGraph.edges.filter(({ sourceNodeId }) => sourceNodeId === source.id).length, 2);
    assert.ok(instance.effectiveGraph.edges.some((edge) => edge.edgeId === `edge-${edgeId}`));
    flowStore.useFlowStore.getState().undo();
    const restored = flowStore.useFlowStore.getState().edges.find(({ id }) => id === edgeId);
    assert.deepEqual(Object.fromEntries(Object.keys(edge).map((key) => [key, restored[key]])), edge);
  }
});

test('move-out preserves a partial fan-out through its exact internal input', () => {
  const initial = inputFanoutRoot('block-v2-input-fanout-incomplete');
  const expandedInstance = runtime.setBlockPresentationV2(initial.data.blockInstanceV2, { expanded: true });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expandedInstance));
  const source = {
    id: 'incomplete-fanout-source',
    type: 'custom',
    position: { x: 0, y: 360 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'TextSource',
      label: 'Text source',
      category: 'Test',
      params: { text: { type: 'string', display: 'output' } },
    },
  };
  flowStore.useFlowStore.setState({ nodes: [...projection.nodes, source], edges: projection.edges, historyPast: [] });
  flowStore.useFlowStore.getState().onConnect({
    source: source.id,
    sourceHandle: 'text',
    target: initial.id,
    targetHandle: 'prompt',
  });
  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(source.id, initial.id);
  let state = flowStore.useFlowStore.getState();
  const rootBeforeRemoval = state.nodes.find((node) => node.id === initial.id);
  const removeEdge = rootBeforeRemoval.data.blockInstanceV2.effectiveGraph.edges.find(
    ({ sourceNodeId, targetNodeId }) => sourceNodeId === source.id && targetNodeId === 'prepare',
  );
  assert.ok(removeEdge);
  const projectedEdge = state.edges.find((edge) => edge.data?.blockProjectionEdgeId === removeEdge.edgeId);
  assert.ok(projectedEdge);
  state.onEdgesChange([{ id: projectedEdge.id, type: 'remove' }]);
  state = flowStore.useFlowStore.getState();
  const projectedSource = state.nodes.find((node) => node.data.blockProjectionNodeId === source.id);
  const beforeMove = flowStore.normalizePersistedFlowState(state);
  const historyBeforeMove = state.historyPast.length;
  state.moveNodeOutOfBlockV2(projectedSource.id, { x: 980, y: 420 });
  state = flowStore.useFlowStore.getState();
  const crossing = state.edges.find((edge) => edge.source === source.id);
  assert.equal(crossing.targetHandle, 'block-crossing:input:generate:prompt');
  assert.equal(state.historyPast.length, historyBeforeMove + 1);
  state.undo();
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), beforeMove);
});

test('V2 Block adoption rejects unsafe sources and targets without partial graph or history mutation', () => {
  const assertRejected = ({ source = ordinaryNode(), target = root('block-v2-reject'), edges = [], pattern }) => {
    const expandedTarget = runtime.createBlockRootNodeV2(
      runtime.setBlockPresentationV2(target.data.blockInstanceV2, { expanded: true }),
    );
    const projection = runtime.materializeBlockProjectionV2(expandedTarget);
    flowStore.useFlowStore.setState({
      nodes: [...projection.nodes, source],
      edges: [...projection.edges, ...edges],
      historyPast: [],
      historyFuture: [],
      historyTransaction: null,
    });
    const before = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
    assert.throws(() => flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(source.id, expandedTarget.id), pattern);
    const after = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
    assert.deepEqual(after, before);
    assert.equal(flowStore.useFlowStore.getState().historyPast.length, 0);
  };

  const connected = ordinaryNode('connected-source');
  const sink = ordinaryNode('connected-sink', { x: 800, y: 390 });
  const target = root('block-v2-connected-reject');
  const targetProjection = runtime.materializeBlockProjectionV2(
    runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(target.data.blockInstanceV2, { expanded: true })),
  );
  flowStore.useFlowStore.setState({
    nodes: [...targetProjection.nodes, connected, sink],
    edges: [
      ...targetProjection.edges,
      {
        id: 'connected-edge',
        source: connected.id,
        sourceHandle: 'output',
        target: sink.id,
        targetHandle: 'input',
      },
    ],
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  flowStore.useFlowStore.getState().refreshConnectionVisuals();
  flowStore.useFlowStore.getState().updateHandleConnectionStatus();
  const connectedBefore = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(connected.id, target.id);
  assert.equal(flowStore.useFlowStore.getState().edges.find((edge) => edge.target === sink.id).source, target.id);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 1);
  flowStore.useFlowStore.getState().undo();
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), connectedBefore);

  assertRejected({ source: ordinaryNode('malformed semantic id'), pattern: /valid stable semantic nodeId/u });
  assertRejected({
    source: {
      ...ordinaryNode('owned-source'),
      parentId: 'former-owner',
      data: { ...ordinaryNode('owned-source').data, userBlockInstanceId: 'former-owner' },
    },
    pattern: /top-level nodes/u,
  });
  assertRejected({
    source: root('nested-block-source'),
    pattern: /cannot be nested/u,
  });

  const projectionTarget = root('block-v2-projection-reject');
  const projectedGraph = runtime.materializeBlockProjectionV2(
    runtime.createBlockRootNodeV2(
      runtime.setBlockPresentationV2(projectionTarget.data.blockInstanceV2, { expanded: true }),
    ),
  );
  flowStore.useFlowStore.setState({
    nodes: projectedGraph.nodes,
    edges: projectedGraph.edges,
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  const projectedChild = projectedGraph.nodes.find((node) => node.data.blockProjectionOwnerId === projectionTarget.id);
  const projectionBefore = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  assert.throws(
    () => flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(projectedChild.id, projectionTarget.id),
    /top-level nodes/u,
  );
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), projectionBefore);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 0);

  const collapsed = root('block-v2-collapsed-reject');
  const ordinary = ordinaryNode('collapsed-source');
  flowStore.useFlowStore.setState({ nodes: [collapsed, ordinary], edges: [], historyPast: [] });
  const collapsedBefore = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  assert.throws(
    () => flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(ordinary.id, collapsed.id),
    /expand the Block/u,
  );
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), collapsedBefore);
  assert.throws(
    () => flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(ordinary.id, 'missing-block'),
    /no longer exists/u,
  );
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), collapsedBefore);
});

test('refresh projection recovery is idempotent, non-history, and preserves root canvas stacking', () => {
  const instance = runtime.setBlockPresentationV2(root().data.blockInstanceV2, { expanded: true });
  const expandedRoot = { ...runtime.createBlockRootNodeV2(instance), selected: true, zIndex: 17 };
  flowStore.useFlowStore.setState({ nodes: [expandedRoot], edges: [], historyPast: [] });

  flowStore.useFlowStore.getState().ensureBlockProjectionV2(expandedRoot.id);
  const first = flowStore.useFlowStore.getState();
  assert.equal(first.historyPast.length, 0);
  assert.equal(first.nodes.find((node) => node.id === expandedRoot.id).selected, true);
  assert.equal(first.nodes.find((node) => node.id === expandedRoot.id).zIndex, 17);
  const snapshot = JSON.stringify(first.nodes);

  flowStore.useFlowStore.getState().ensureBlockProjectionV2(expandedRoot.id);
  assert.equal(JSON.stringify(flowStore.useFlowStore.getState().nodes), snapshot);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 0);
});

test('flat-layout Blocks separate overlapping ordinary nodes without changing saved layout or execution', () => {
  let instance = root().data.blockInstanceV2;
  instance = runtime.addBlockEffectiveGraphSubtreeV2(
    instance,
    [{ ...structuredClone(instance.effectiveGraph.nodes[0]), nodeId: 'second' }],
    [],
    { second: { x: 150, y: 80, width: 520, height: 800 } },
  );
  instance = runtime.setBlockPresentationV2(instance, {
    expanded: true,
    internalLayout: { generate: { x: 24, y: 80, width: 520, height: 700 } },
  });
  assert.notEqual(instance.presentation.internalLayoutMode, 'hierarchical');
  const before = structuredClone(instance);
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(instance));
  const children = projection.nodes.filter((node) => node.parentId === instance.instanceId);
  assert.equal(children.length, 2);
  assert.ok(children[1].position.x >= children[0].position.x + children[0].width);
  assert.deepEqual(instance, before);
  flowStore.useFlowStore.setState({ nodes: projection.nodes, edges: projection.edges });
  flowStore.useFlowStore.getState().setNodeSize(children[0].id, 900, 1000);
  const resized = flowStore.useFlowStore.getState().nodes.filter((node) => node.parentId === instance.instanceId);
  assert.ok(resized[1].position.x >= resized[0].position.x + resized[0].width);
  const after = flowStore.useFlowStore.getState().nodes.find((node) => node.id === instance.instanceId)
    .data.blockInstanceV2;
  assert.deepEqual(after.effectiveGraph, before.effectiveGraph);
  assert.deepEqual(after.values, before.values);
});

test('collapsed minimum height is authority-backed and never creates an undo entry', () => {
  const block = root();
  flowStore.useFlowStore.setState({ nodes: [block], edges: [], historyPast: [] });
  flowStore.useFlowStore.getState().ensureBlockMinimumHeightV2(block.id, 640);
  const state = flowStore.useFlowStore.getState();
  const resized = state.nodes.find((node) => node.id === block.id);
  assert.equal(resized.height, 640);
  assert.equal(resized.data.blockInstanceV2.presentation.size.height, 640);
  assert.equal(state.historyPast.length, 0);
});

test('automatic projected-node measurements preserve Redo while explicit resizing stays undoable', () => {
  const instance = runtime.setBlockPresentationV2(root().data.blockInstanceV2, { expanded: true });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(instance));
  flowStore.useFlowStore.setState({ nodes: projection.nodes, edges: projection.edges });
  const child = projection.nodes.find((node) => node.parentId === instance.instanceId);
  assert.ok(child);
  const flow = flowStore.useFlowStore.getState();
  flow.setNodeSize(child.id, 800, 900);
  flow.undo();
  flow.ensureBlockProjectionV2(instance.instanceId);
  const before = flowStore.useFlowStore.getState();
  assert.equal(before.historyFuture.length, 1);
  const values = structuredClone(
    before.nodes.find((node) => node.id === instance.instanceId).data.blockInstanceV2.values,
  );
  flow.setNodeSize(child.id, 520, 720, { history: false });
  assert.equal(flowStore.useFlowStore.getState().historyFuture, before.historyFuture);
  assert.equal(flowStore.useFlowStore.getState().historyPast, before.historyPast);
  flow.redo();
  flow.ensureBlockProjectionV2(instance.instanceId);
  const resized = flowStore.useFlowStore.getState().nodes.find((node) => node.id === child.id);
  assert.equal(resized.width, 800);
  assert.equal(resized.height, 900);
  assert.deepEqual(
    flowStore.useFlowStore.getState().nodes.find((node) => node.id === instance.instanceId).data.blockInstanceV2.values,
    values,
  );
  const source = fs.readFileSync(path.join(ROOT, 'src/components/ProjectedBlockNodeV2.tsx'), 'utf8');
  assert.match(source, /setNodeSize\(node\.id, current\.width \?\? 280, minimumHeight, \{ history: false \}\)/u);
});

test('both composite generations use one shared frame and V2 stays on the block renderer', () => {
  const blockSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'BlockNode.tsx'), 'utf8');
  const legacySource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'LegacyUserBlockNode.tsx'), 'utf8');
  const frameSource = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'BlockNodeFrame.tsx'), 'utf8');
  const v2Source = fs.readFileSync(path.join(ROOT, 'src', 'components', 'BlockNodeV2.tsx'), 'utf8');
  const interfaceSource = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'BlockInterfaceDialogContentV2.tsx'),
    'utf8',
  );
  const projectedSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'ProjectedBlockNodeV2.tsx'), 'utf8');
  const workflowSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'Workflow.tsx'), 'utf8');
  assert.match(legacySource, /<BlockNodeFrame/);
  assert.match(v2Source, /<BlockNodeFrame/);
  assert.match(projectedSource, /<BlockNodeFrame/);
  assert.match(projectedSource, /<BlockSaveDialogV2/);
  assert.match(v2Source, /<BlockSaveDialogV2/);
  assert.match(projectedSource, /toggleBlockContainerExpandedV2/);
  assert.match(projectedSource, /mode="controls"/);
  assert.match(projectedSource, /mode="connectors"/);
  assert.match(
    frameSource,
    /ref=\{connectorRef\} className="shrink-0 pb-7"/,
    'collapsed Blocks reserve the resize grip below their final connector row',
  );
  assert.match(workflowSource, /blockProjectionModular === true \? <ProjectedBlockNodeV2/);
  assert.match(blockSource, /if \(node.data.blockInstanceV2\) return <BlockNodeV2/);
  assert.match(workflowSource, /block: BlockNode/);
  assert.match(v2Source, /params=\{view\.controlParams\}/);
  assert.match(v2Source, /params=\{connectorParams\}/);
  assert.match(v2Source, /view\.previewViews\.map/);
  assert.match(v2Source, /params=\{preview\.params\}/);
  assert.match(v2Source, /Configure public inputs, outputs, and controls/);
  assert.match(v2Source, /<BlockInterfaceDialogV2/);
  assert.match(projectedSource, /<BlockInterfaceDialogV2/);
  assert.match(interfaceSource, /Apply interface/);
  assert.match(interfaceSource, /Add another internal consumer/);
  assert.match(interfaceSource, /blockValueTypesAreCompatibleV2/);
  assert.match(interfaceSource, /mirrorBindings: \[/);
  assert.match(interfaceSource, /moveInterfaceEntryV2/);
  assert.match(v2Source, /connectorsWhenExpanded/);
  assert.match(frameSource, /schemaVersion === 2 && expanded/);
  assert.match(frameSource, /data-block-expanded/);
  assert.match(workflowSource, /elevateEdgesOnSelect/);
  const saveDialogSource = fs.readFileSync(
    path.join(ROOT, 'src', 'components', 'BlockSaveDialogContentV2.tsx'),
    'utf8',
  );
  assert.match(saveDialogSource, /Save as new Block/);
  assert.match(v2Source, /headerRef\.current\?\.offsetHeight/);
  assert.match(v2Source, /connectorRef\.current\?\.offsetHeight/);
  assert.match(v2Source, /headerHeight \+ connectorHeight \+ 96 \+ 4/);
  assert.doesNotMatch(v2Source, /Math\.max\(180/);
  assert.doesNotMatch(v2Source, /type:\s*['"]cluster['"]/);
});

test('public V2 sockets retain their declared edge payload type without root params', () => {
  const block = root();
  const sink = {
    id: 'sink',
    type: 'custom',
    position: { x: 800, y: 100 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Sink',
      label: 'Sink',
      category: 'Test',
      params: { image: { type: 'image', display: 'input' } },
    },
  };
  const edge = { id: 'image-edge', source: block.id, sourceHandle: 'image', target: sink.id, targetHandle: 'image' };
  assert.deepEqual(block.data.params, {});
  assert.equal(connectionTypes.edgeConnectionType(edge, [block, sink]), 'image');
});

test('V2 public sockets connect in both directions without mirroring connector state into root params', () => {
  const block = root();
  const source = {
    id: 'text-source',
    type: 'custom',
    position: { x: 0, y: 100 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'TextSource',
      label: 'Text source',
      category: 'Test',
      params: { text: { type: 'string', display: 'output' } },
    },
  };
  const sink = {
    id: 'image-sink',
    type: 'custom',
    position: { x: 800, y: 100 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'ImageSink',
      label: 'Image sink',
      category: 'Test',
      params: { image: { type: 'image', display: 'input' } },
    },
  };
  flowStore.useFlowStore.setState({ nodes: [source, block, sink], edges: [] });

  const publicParams = connectorResolution.nodeConnectorParams(block);
  assert.equal(publicParams.prompt.display, 'input');
  assert.equal(publicParams.prompt.type, 'string');
  assert.equal(publicParams.image.display, 'output');
  assert.equal(publicParams.image.type, 'image');
  assert.equal(flowStore.useFlowStore.getState().getParam(block.id, 'prompt', 'type'), 'string');
  assert.equal(flowStore.useFlowStore.getState().getParam(block.id, 'image', 'type'), 'image');
  assert.deepEqual(block.data.params, {});

  let legacyFallbackReads = 0;
  const legacyFallback = (nodeId, fieldId, key) => {
    legacyFallbackReads += 1;
    return [source, block, sink].find((node) => node.id === nodeId)?.data.params?.[fieldId]?.[key] ?? null;
  };
  assert.equal(
    workflowConnections.workflowConnectionParam([source, block, sink], legacyFallback, block.id, 'prompt', 'type'),
    'string',
  );
  assert.equal(
    workflowConnections.workflowConnectionParam([source, block, sink], legacyFallback, block.id, 'image', 'type'),
    'image',
  );
  assert.equal(legacyFallbackReads, 0);
  assert.equal(
    workflowConnections.workflowConnectionParam([source, block, sink], legacyFallback, block.id, 'missing', 'type'),
    null,
  );
  assert.equal(legacyFallbackReads, 1);

  const inboundDrop = workflowConnections.captureWorkflowDropHandle(block, 'prompt', 'target');
  const outboundDrop = workflowConnections.captureWorkflowDropHandle(block, 'image', 'source');
  assert.deepEqual(inboundDrop, {
    nodeId: block.id,
    node: block.data,
    handleId: 'prompt',
    handleType: 'target',
    dataType: 'string',
  });
  assert.deepEqual(outboundDrop, {
    nodeId: block.id,
    node: block.data,
    handleId: 'image',
    handleType: 'source',
    dataType: 'image',
  });
  assert.equal(workflowConnections.captureWorkflowDropHandle(block, 'missing', 'source'), null);

  flowStore.useFlowStore.getState().onConnect({
    source: source.id,
    sourceHandle: 'text',
    target: block.id,
    targetHandle: 'prompt',
    edgeType: 'smoothstep',
  });
  flowStore.useFlowStore.getState().onConnect({
    source: block.id,
    sourceHandle: 'image',
    target: sink.id,
    targetHandle: 'image',
    edgeType: 'smoothstep',
  });

  let state = flowStore.useFlowStore.getState();
  assert.equal(state.edges.length, 2);
  assert.equal(connectionTypes.edgeConnectionType(state.edges[0], state.nodes), 'string');
  assert.equal(connectionTypes.edgeConnectionType(state.edges[1], state.nodes), 'image');
  assert.equal(state.edges[1].style.stroke, connectionTypes.connectionColor('image'));
  assert.deepEqual(state.nodes.find((node) => node.id === block.id).data.params, {});

  state.updateHandleConnectionStatus();
  state.setParam(block.id, 'image', true, 'isConnected');
  state.setParam(block.id, 'prompt', { direction: 'input', value: 'runtime-only' }, 'signal');
  assert.deepEqual(flowStore.useFlowStore.getState().nodes.find((node) => node.id === block.id).data.params, {});

  flowStore.useFlowStore.getState().onConnect({
    source: source.id,
    sourceHandle: 'missing',
    target: block.id,
    targetHandle: 'prompt',
    edgeType: 'smoothstep',
  });
  flowStore.useFlowStore.getState().onConnect({
    source: block.id,
    sourceHandle: 'image',
    target: sink.id,
    targetHandle: 'missing',
    edgeType: 'smoothstep',
  });
  assert.equal(flowStore.useFlowStore.getState().edges.length, 2, 'unknown explicit handles are rejected');

  flowStore.useFlowStore
    .getState()
    .onEdgesChange(flowStore.useFlowStore.getState().edges.map((edge) => ({ id: edge.id, type: 'remove' })));
  assert.deepEqual(flowStore.useFlowStore.getState().nodes.find((node) => node.id === block.id).data.params, {});
});

test('V2 projection children accept outside links alongside same-owner internal links', () => {
  const migrated = schema.migrateUserBlockDefinitionV1({
    id: 'connection-boundary-v2',
    name: 'Connection boundary V2',
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
          params: {
            prompt: { type: 'string', display: 'input' },
            image: { type: 'image', display: 'output' },
          },
        },
      },
      {
        id: 'preview',
        type: 'custom',
        position: { x: 360, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Preview',
          label: 'Preview',
          category: 'Test',
          params: { image: { type: 'image', display: 'input' } },
        },
      },
    ],
    edges: [],
    inputs: [{ id: 'prompt', label: 'Prompt', nodeId: 'generate', paramKey: 'prompt', type: 'string' }],
    outputs: [{ id: 'image', label: 'Image', nodeId: 'generate', paramKey: 'image', type: 'image' }],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 2,
  });
  const expandedInstance = runtime.setBlockPresentationV2(
    schema.createBlockInstanceV2(migrated, {
      instanceId: 'boundary-root-v2',
      position: { x: 200, y: 100 },
      size: { width: 720, height: 600 },
    }),
    { expanded: true },
  );
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expandedInstance));
  const generate = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const preview = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'preview');
  assert.ok(generate);
  assert.ok(preview);
  const source = {
    id: 'outside-text-source',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'TextSource',
      label: 'Text source',
      category: 'Test',
      params: { text: { type: 'string', display: 'output' } },
    },
  };
  const sink = {
    id: 'outside-image-sink',
    type: 'custom',
    position: { x: 900, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'ImageSink',
      label: 'Image sink',
      category: 'Test',
      params: { image: { type: 'image', display: 'input' } },
    },
  };
  const nodes = [...projection.nodes, source, sink];
  flowStore.useFlowStore.setState({ nodes, edges: projection.edges });

  assert.equal(connectorResolution.blockV2ConnectionScopeIsAllowed(nodes, source.id, generate.id), true);
  assert.equal(connectorResolution.blockV2ConnectionScopeIsAllowed(nodes, generate.id, sink.id), true);
  assert.equal(connectorResolution.blockV2ConnectionScopeIsAllowed(nodes, generate.id, preview.id), true);

  flowStore.useFlowStore.getState().onConnect({
    source: source.id,
    sourceHandle: 'text',
    target: generate.id,
    targetHandle: 'prompt',
    edgeType: 'smoothstep',
  });
  flowStore.useFlowStore.getState().onConnect({
    source: generate.id,
    sourceHandle: 'image',
    target: sink.id,
    targetHandle: 'image',
    edgeType: 'smoothstep',
  });
  assert.equal(flowStore.useFlowStore.getState().edges.length, 2, 'outside links use stable Block endpoints');

  flowStore.useFlowStore.getState().onConnect({
    source: generate.id,
    sourceHandle: 'image',
    target: preview.id,
    targetHandle: 'image',
    edgeType: 'smoothstep',
  });
  const internal = flowStore.useFlowStore
    .getState()
    .edges.filter((edge) => edge.data?.blockProjectionKind === 'internal');
  assert.equal(internal.length, 1);
  assert.equal(internal[0].source, generate.id);
  assert.equal(internal[0].target, preview.id);
  assert.equal(connectionTypes.edgeConnectionType(internal[0], flowStore.useFlowStore.getState().nodes), 'image');
  let authoritativeRoot = flowStore.useFlowStore
    .getState()
    .nodes.find((node) => node.id === expandedInstance.instanceId);
  assert.equal(authoritativeRoot.data.blockInstanceV2.effectiveGraph.edges.length, 1);
  assert.equal(authoritativeRoot.data.blockInstanceV2.customization.state, 'structure_changed');
  assert.deepEqual(authoritativeRoot.data.params, {});

  flowStore.useFlowStore.getState().onEdgesChange([{ id: internal[0].id, type: 'remove' }]);
  authoritativeRoot = flowStore.useFlowStore.getState().nodes.find((node) => node.id === expandedInstance.instanceId);
  assert.equal(authoritativeRoot.data.blockInstanceV2.effectiveGraph.edges.length, 0);
  assert.deepEqual(authoritativeRoot.data.params, {});
  assert.equal(flowStore.useFlowStore.getState().edges.length, 2);
});

test('Configure Interface persists one instance snapshot and protects connected public ports', () => {
  const block = root('block-v2-interface');
  const source = {
    id: 'interface-source',
    type: 'custom',
    position: { x: 0, y: 100 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'TextSource',
      label: 'Text source',
      category: 'Test',
      params: { text: { type: 'string', display: 'output' } },
    },
  };
  flowStore.useFlowStore.setState({ nodes: [source, block], edges: [], historyPast: [] });
  flowStore.useFlowStore.getState().onConnect({
    source: source.id,
    sourceHandle: 'text',
    target: block.id,
    targetHandle: 'prompt',
  });
  let state = flowStore.useFlowStore.getState();
  const original = state.nodes.find((node) => node.id === block.id).data.blockInstanceV2;
  const boundary = structuredClone(original.effectiveInterface.boundary);
  boundary.inputs[0].label = 'Workflow prompt';
  state.configureBlockInterfaceV2(block.id, { boundary, controls: original.effectiveInterface.controls });
  state = flowStore.useFlowStore.getState();
  const configured = state.nodes.find((node) => node.id === block.id).data.blockInstanceV2;
  assert.equal(configured.effectiveInterface.boundary.inputs[0].label, 'Workflow prompt');
  assert.equal(configured.customization.state, 'structure_changed');
  assert.equal(state.edges[0].targetHandle, 'prompt');
  assert.equal(state.historyPast.length, 2, 'connect and interface edit are independently undoable');

  const beforeRejected = flowStore.normalizePersistedFlowState(state);
  assert.throws(
    () =>
      state.configureBlockInterfaceV2(block.id, {
        boundary: { ...boundary, inputs: [] },
        controls: configured.effectiveInterface.controls,
      }),
    /connected Block port/u,
  );
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), beforeRejected);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 2);

  const saved = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  flowStore.useFlowStore.setState({ ...saved, historyPast: [], historyFuture: [], historyTransaction: null });
  const restored = flowStore.useFlowStore.getState().nodes.find((node) => node.id === block.id).data.blockInstanceV2;
  assert.equal(restored.effectiveInterface.boundary.inputs[0].label, 'Workflow prompt');
  assert.equal(
    restored.effectiveInterface.effectiveInterfaceHash,
    configured.effectiveInterface.effectiveInterfaceHash,
  );
});

test('node replacement keeps one Block root, stable ports, undo, and atomic failure', () => {
  const initial = root('block-v2-replacement');
  const expanded = runtime.materializeBlockProjectionV2(
    runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(initial.data.blockInstanceV2, { expanded: true })),
  );
  const replacement = {
    id: 'replacement-generate',
    type: 'custom',
    position: { x: 900, y: 300 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'GenerateV2',
      label: 'Generate V2',
      category: 'Test',
      params: {
        prompt: { type: 'string', display: 'textarea' },
        steps: { type: 'int' },
        image: { type: 'image', display: 'output' },
      },
    },
  };
  flowStore.useFlowStore.setState({ nodes: [...expanded.nodes, replacement], edges: expanded.edges, historyPast: [] });
  const projected = expanded.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  flowStore.useFlowStore.getState().replaceNodeInBlockV2(replacement.id, projected.id);
  let state = flowStore.useFlowStore.getState();
  let authoritative = state.nodes.find((node) => node.id === initial.id).data.blockInstanceV2;
  assert.equal(
    state.nodes.some((node) => node.id === replacement.id),
    false,
  );
  assert.equal(authoritative.effectiveGraph.nodes[0].nodeId, replacement.id);
  assert.equal(authoritative.effectiveInterface.boundary.inputs[0].portId, 'prompt');
  assert.equal(authoritative.effectiveInterface.boundary.inputs[0].binding.nodeId, replacement.id);
  assert.equal(authoritative.effectiveInterface.boundary.outputs[0].portId, 'image');
  assert.equal(state.historyPast.length, 1);
  state.undo();
  state = flowStore.useFlowStore.getState();
  assert.ok(state.nodes.find((node) => node.id === replacement.id));
  assert.equal(
    state.nodes.find((node) => node.id === initial.id).data.blockInstanceV2.effectiveGraph.nodes[0].nodeId,
    'generate',
  );

  const broken = { ...replacement, id: 'broken-replacement', data: { ...replacement.data, params: {} } };
  flowStore.useFlowStore.setState({ nodes: [...expanded.nodes, broken], edges: expanded.edges, historyPast: [] });
  const before = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  assert.throws(
    () => flowStore.useFlowStore.getState().replaceNodeInBlockV2(broken.id, projected.id),
    /replacement field prompt is missing or incompatible/u,
  );
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), before);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 0);
});

test('move-out translates compatible internal links through an existing public port and survives undo/save', () => {
  const initial = root('block-v2-move-out');
  const expandedInstance = runtime.setBlockPresentationV2(initial.data.blockInstanceV2, { expanded: true });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expandedInstance));
  const utility = ordinaryNode('move-out-utility');
  flowStore.useFlowStore.setState({ nodes: [...projection.nodes, utility], edges: projection.edges, historyPast: [] });
  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(utility.id, initial.id);
  let state = flowStore.useFlowStore.getState();
  const generate = state.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const adopted = state.nodes.find((node) => node.data.blockProjectionNodeId === utility.id);
  state.onConnect({
    source: generate.id,
    sourceHandle: 'image',
    target: adopted.id,
    targetHandle: 'input',
  });
  state = flowStore.useFlowStore.getState();
  const movedId = state.moveNodeOutOfBlockV2(adopted.id, { x: 980, y: 420 });
  state = flowStore.useFlowStore.getState();
  assert.equal(movedId, utility.id);
  assert.ok(state.nodes.find((node) => node.id === movedId && !node.parentId));
  assert.equal(
    state.nodes
      .find((node) => node.id === initial.id)
      .data.blockInstanceV2.effectiveGraph.nodes.some(({ nodeId }) => nodeId === utility.id),
    false,
  );
  const crossing = state.edges.find((edge) => edge.source === initial.id && edge.target === movedId);
  assert.ok(crossing);
  assert.equal(crossing.sourceHandle, 'image');
  assert.equal(crossing.targetHandle, 'input');
  state.undo();
  flowStore.useFlowStore.getState().ensureBlockProjectionV2(initial.id);
  state = flowStore.useFlowStore.getState();
  assert.ok(state.nodes.find((node) => node.data.blockProjectionNodeId === utility.id));
  state.redo();
  const saved = flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState());
  assert.ok(saved.nodes.find((node) => node.id === movedId));
  assert.equal(
    saved.edges.some((edge) => edge.source === initial.id && edge.target === movedId),
    true,
  );
});

test('edge reconnection is durable for V2 internals and rejects cross-boundary updates atomically', () => {
  const initial = root('block-v2-reconnect');
  const expandedInstance = runtime.setBlockPresentationV2(initial.data.blockInstanceV2, { expanded: true });
  const projection = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(expandedInstance));
  const first = ordinaryNode('reconnect-first');
  const second = ordinaryNode('reconnect-second', { x: 720, y: 390 });
  flowStore.useFlowStore.setState({
    nodes: [...projection.nodes, first, second],
    edges: projection.edges,
    historyPast: [],
  });
  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(first.id, initial.id);
  flowStore.useFlowStore.getState().adoptNodeIntoBlockV2(second.id, initial.id);
  let state = flowStore.useFlowStore.getState();
  const generate = state.nodes.find((node) => node.data.blockProjectionNodeId === 'generate');
  const firstChild = state.nodes.find((node) => node.data.blockProjectionNodeId === first.id);
  const secondChild = state.nodes.find((node) => node.data.blockProjectionNodeId === second.id);
  state.onConnect({ source: generate.id, sourceHandle: 'image', target: firstChild.id, targetHandle: 'input' });
  state = flowStore.useFlowStore.getState();
  const internalEdge = state.edges.find((edge) => edge.data?.blockProjectionKind === 'internal');
  state.onReconnect(internalEdge, {
    source: generate.id,
    sourceHandle: 'image',
    target: secondChild.id,
    targetHandle: 'input',
  });
  state = flowStore.useFlowStore.getState();
  const semanticEdge = state.nodes
    .find((node) => node.id === initial.id)
    .data.blockInstanceV2.effectiveGraph.edges.find(({ edgeId }) => edgeId === internalEdge.data.blockProjectionEdgeId);
  assert.equal(semanticEdge.targetNodeId, second.id);
  assert.equal(state.historyPast.length, 4, 'two adoptions, connect, and reconnect are undoable');

  state.onConnect({ source: generate.id, sourceHandle: 'image', target: firstChild.id, targetHandle: 'input' });
  state = flowStore.useFlowStore.getState();
  const beforeOccupiedFailure = flowStore.normalizePersistedFlowState(state);
  assert.throws(
    () =>
      state.onReconnect(
        state.edges.find(
          (edge) =>
            edge.data?.blockProjectionKind === 'internal' &&
            edge.data?.blockProjectionEdgeId === internalEdge.data.blockProjectionEdgeId,
        ),
        {
          source: generate.id,
          sourceHandle: 'image',
          target: firstChild.id,
          targetHandle: 'input',
        },
      ),
    /internal input already has a connection/u,
  );
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), beforeOccupiedFailure);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 5);

  const before = flowStore.normalizePersistedFlowState(state);
  assert.throws(
    () =>
      state.onReconnect(
        state.edges.find((edge) => edge.data?.blockProjectionKind === 'internal'),
        {
          source: generate.id,
          sourceHandle: 'image',
          target: initial.id,
          targetHandle: 'prompt',
        },
      ),
    /cross a Block boundary|missing, incompatible/u,
  );
  assert.deepEqual(flowStore.normalizePersistedFlowState(flowStore.useFlowStore.getState()), before);
  assert.equal(flowStore.useFlowStore.getState().historyPast.length, 5);
});
