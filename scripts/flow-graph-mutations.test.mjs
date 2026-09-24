import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let flowStoreModule;
let nodeStoreModule;
let blockRuntimeModule;
let blockSchemaModule;
let snackbarModule;
let server;
let originalFetch;
let requests;

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
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  nodeStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  blockRuntimeModule = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  blockSchemaModule = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  snackbarModule = await server.ssrLoadModule('/src/ui/snackbar.ts');
  originalFetch = globalThis.fetch;
});

beforeEach(() => {
  requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    return new Response(JSON.stringify({ error: false, nodes: Array.isArray(body.nodes) ? body.nodes : [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  flowStoreModule.useFlowStore.setState({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    lastExecutionTime: 0,
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  nodeStoreModule.useNodesStore.setState({ nodesRegistry: {} });
  snackbarModule.closeSnackbar();
});

after(async () => {
  globalThis.fetch = originalFetch;
  await server?.close();
});

function node(id, params, extras = {}) {
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
      ...extras,
    },
  };
}

function edge(id, source, target, sourceHandle, targetHandle) {
  return { id, source, target, sourceHandle, targetHandle, type: 'default' };
}

function cacheRequests() {
  return requests.filter((request) => request.url.endsWith('/cache') && request.init.method === 'DELETE');
}

test('connection mutations enforce signal-driven component compatibility', () => {
  const schedulerOutput = (modelType) => ({
    scheduler: {
      display: 'output',
      type: 'diffusers_auto_model',
      connectionRole: 'scheduler',
      signal: { direction: 'output', value: modelType },
    },
  });
  const target = node('scheduler-modifier', {
    scheduler_in: {
      display: 'input',
      type: 'diffusers_auto_model',
      onSignal: {
        action: 'value',
        target: 'scheduler',
        prop: 'options',
        data: { StableDiffusionXLModularPipeline: ['EulerDiscreteScheduler'] },
      },
      signalCompatibility: {
        required: true,
        role: 'scheduler',
        values: { StableDiffusionXLModularPipeline: ['EulerDiscreteScheduler'] },
      },
    },
    scheduler: { type: 'string', value: 'EulerDiscreteScheduler' },
  });
  const incompatible = node('z-image-loader', schedulerOutput('ZImageModularPipeline'));
  const compatible = node('sdxl-loader', schedulerOutput('StableDiffusionXLModularPipeline'));
  const wrongRole = node('sdxl-unet-loader', {
    scheduler: {
      ...schedulerOutput('StableDiffusionXLModularPipeline').scheduler,
      connectionRole: 'denoiser',
    },
  });
  const connection = (source) => ({
    source,
    sourceHandle: 'scheduler',
    target: target.id,
    targetHandle: 'scheduler_in',
  });

  flowStoreModule.useFlowStore.setState({ nodes: [incompatible, compatible, wrongRole, target], edges: [] });
  flowStoreModule.useFlowStore.getState().onConnect(connection(incompatible.id));
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);
  flowStoreModule.useFlowStore.getState().onConnect(connection(wrongRole.id));
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);

  flowStoreModule.useFlowStore.getState().onConnect(connection(compatible.id));
  const existing = flowStoreModule.useFlowStore.getState().edges[0];
  assert.equal(existing.source, compatible.id);
  assert.throws(
    () => flowStoreModule.useFlowStore.getState().onReconnect(existing, connection(incompatible.id)),
    /missing, incompatible, or cross a Block boundary/,
  );
  assert.equal(flowStoreModule.useFlowStore.getState().edges[0].source, compatible.id);

  flowStoreModule.useFlowStore
    .getState()
    .setParam(compatible.id, 'scheduler', { direction: 'output', value: 'ZImageModularPipeline' }, 'signal');
  flowStoreModule.useFlowStore.getState().updateSignalValues(flowStoreModule.useFlowStore.getState().edges);
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);
  assert.equal(snackbarModule.getToastItems().at(-1)?.message, 'Disconnected unsupported model component link.');
});

function blockV2DeletionFixture(instanceId = 'block-v2-delete') {
  const semanticGraph = {
    nodes: [
      {
        nodeId: 'generate',
        nodeType: 'custom',
        semanticRole: 'generate',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          params: {
            prompt: { type: 'string', display: 'textarea', default: 'creator prompt' },
            images: { type: 'list[image]', display: 'output' },
          },
        },
      },
      {
        nodeId: 'utility',
        nodeType: 'custom',
        semanticRole: 'utility',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Utility',
          params: {
            images: { type: 'list[image]', display: 'input' },
            output: { type: 'list[image]', display: 'output' },
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
        edgeId: 'utility-input',
        sourceNodeId: 'generate',
        sourcePortId: 'images',
        targetNodeId: 'utility',
        targetPortId: 'images',
      },
      {
        edgeId: 'utility-preview',
        sourceNodeId: 'utility',
        sourcePortId: 'output',
        targetNodeId: 'preview',
        targetPortId: 'images',
      },
    ],
    executionOrder: ['generate', 'utility', 'preview'],
  };
  const graph = { ...semanticGraph, graphHash: blockSchemaModule.blockGraphHashV2(semanticGraph) };
  const semanticDefinition = {
    schemaVersion: 2,
    definitionId: 'user:block-v2-delete-fixture',
    displayName: 'Block V2 delete fixture',
    source: { kind: 'user' },
    graph,
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
        defaultValue: 'creator prompt',
        required: true,
        order: 0,
      },
    ],
    previews: [{ nodeId: 'preview', outputPortId: 'images', mediaType: 'image', primary: true }],
    ownership: { kind: 'user', definitionMutable: true },
  };
  const definition = {
    ...semanticDefinition,
    contentHash: blockSchemaModule.blockDefinitionContentHashV2(semanticDefinition),
  };
  let instance = blockSchemaModule.createBlockInstanceV2(definition, {
    instanceId,
    position: { x: 120, y: 80 },
    size: { width: 980, height: 620 },
    values: { prompt: 'instance prompt' },
    internalLayout: {
      generate: { x: 32, y: 80, width: 280, height: 240 },
      utility: { x: 350, y: 80, width: 280, height: 240 },
      preview: { x: 668, y: 80, width: 280, height: 240 },
    },
  });
  instance = blockRuntimeModule.setBlockPresentationV2(instance, { expanded: true });
  instance = blockSchemaModule.normalizeBlockInstanceV2({
    ...instance,
    authorities: [
      {
        kind: 'reviewed_execution',
        definitionId: instance.definitionRef.definitionId,
        definitionContentHash: instance.definitionRef.contentHash,
        effectiveGraphHash: instance.effectiveGraph.graphHash,
        executionParameterHash: 'delete-fixture-parameters',
        artifactRevisions: { 'owner/model': 'b'.repeat(40) },
        admissionId: 'diffusers:test:delete-fixture',
        issuedAt: '2026-09-01T00:00:00Z',
      },
    ],
  });
  const projection = blockRuntimeModule.materializeBlockProjectionV2(
    blockRuntimeModule.createBlockRootNodeV2(instance, { selected: true }),
  );
  const source = node('outside-source', { text: { type: 'string', display: 'output' } });
  const sink = node('outside-sink', { images: { type: 'list[image]', display: 'input' } });
  const externalEdges = [
    edge('external-input', source.id, instanceId, 'text', 'prompt'),
    edge('external-output', instanceId, sink.id, 'images', 'images'),
  ];
  return {
    rootId: instanceId,
    generateId: blockRuntimeModule.blockProjectionNodeIdV2(instanceId, 'generate'),
    utilityId: blockRuntimeModule.blockProjectionNodeIdV2(instanceId, 'utility'),
    previewId: blockRuntimeModule.blockProjectionNodeIdV2(instanceId, 'preview'),
    nodes: [source, ...projection.nodes, sink],
    edges: [...externalEdges, ...projection.edges],
  };
}

test('a final V2 projection move is absorbed by its durable root and survives persistence', async () => {
  const fixture = blockV2DeletionFixture('block-v2-move');
  flowStoreModule.useFlowStore.setState({ nodes: fixture.nodes, edges: fixture.edges });
  const originalRoot = fixture.nodes.find((item) => item.id === fixture.rootId);
  const originalUtilityLayout = originalRoot.data.blockInstanceV2.presentation.internalLayout.utility;

  await flowStoreModule.useFlowStore.getState().onNodesChange([
    {
      id: fixture.utilityId,
      type: 'position',
      position: { x: 424, y: 146 },
      dragging: true,
    },
  ]);
  let state = flowStoreModule.useFlowStore.getState();
  let root = state.nodes.find((item) => item.id === fixture.rootId);
  assert.deepEqual(root.data.blockInstanceV2.presentation.internalLayout.utility, originalUtilityLayout);

  await state.onNodesChange([
    {
      id: fixture.utilityId,
      type: 'position',
      position: { x: 424, y: 146 },
      dragging: false,
    },
  ]);
  state = flowStoreModule.useFlowStore.getState();
  root = state.nodes.find((item) => item.id === fixture.rootId);
  assert.deepEqual(root.data.blockInstanceV2.presentation.internalLayout.utility, {
    x: 424,
    y: 146,
    width: 280,
    height: 240,
  });
  assert.equal(root.data.blockInstanceV2.authorities.length, 1);
  assert.deepEqual(state.nodes.find((item) => item.id === fixture.utilityId).position, { x: 424, y: 146 });

  state.toggleUserBlockExpanded(fixture.rootId);
  const saved = state.toObject();
  assert.equal(
    saved.nodes.some((item) => item.data.blockProjectionOwnerId === fixture.rootId),
    false,
  );
  const restored = flowStoreModule.normalizePersistedFlowState(saved);
  flowStoreModule.useFlowStore.setState({
    ...restored,
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  flowStoreModule.useFlowStore.getState().toggleUserBlockExpanded(fixture.rootId);
  state = flowStoreModule.useFlowStore.getState();
  root = state.nodes.find((item) => item.id === fixture.rootId);
  assert.deepEqual(root.data.blockInstanceV2.presentation.internalLayout.utility, {
    x: 424,
    y: 146,
    width: 280,
    height: 240,
  });
  assert.deepEqual(state.nodes.find((item) => item.id === fixture.utilityId).position, { x: 424, y: 146 });
});

test('graph replacement restores missing live UI preview contracts without replacing saved values', () => {
  nodeStoreModule.useNodesStore.setState({
    nodesRegistry: {
      'modules.Test.Preview': {
        type: 'custom',
        module: 'modules.Test',
        action: 'Preview',
        label: 'Preview',
        category: 'Test',
        params: {
          title: {
            display: 'ui_label',
            label: 'Current label',
            value: 'Live fallback',
            fieldOptions: { tone: 'subtle' },
          },
          preview: {
            display: 'ui_video',
            type: 'url',
            dataSource: 'file',
          },
          file: {
            display: 'output',
            type: 'video',
          },
        },
      },
    },
  });

  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      node('Preview', {
        title: {
          display: 'ui_label',
          label: 'Stale label',
          value: 'Saved workflow title',
          fieldOptions: { tone: 'old' },
        },
        file: { display: 'output', type: 'video' },
      }),
    ],
    edges: [],
  });
  let params = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  let preview = params.preview;
  assert.deepEqual(preview, {
    display: 'ui_video',
    type: 'url',
    dataSource: 'file',
  });
  assert.deepEqual(params.title, {
    display: 'ui_label',
    label: 'Current label',
    value: 'Saved workflow title',
    fieldOptions: { tone: 'subtle' },
  });

  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      node('Preview', {
        file: { display: 'output', type: 'video' },
        preview: { value: '/file?file=previous.mp4' },
      }),
    ],
    edges: [],
  });
  params = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  preview = params.preview;
  assert.equal(preview.display, 'ui_video');
  assert.equal(preview.dataSource, 'file');
  assert.equal(preview.value, '/file?file=previous.mp4');
});

test('graph replacement preserves dynamic visibility and required inputs even when registry defaults hide them', () => {
  nodeStoreModule.useNodesStore.setState({
    nodesRegistry: {
      'modules.Test.Preview': {
        type: 'custom',
        module: 'modules.Test',
        action: 'Preview',
        label: 'Preview',
        category: 'Test',
        params: {
          source: { type: 'audio', display: 'input', hidden: true, required: false, onSignal: 'current_contract' },
          strength: { type: 'float', hidden: true, default: 0.75 },
          missing_identity: { type: 'string', hidden: true, default: '' },
        },
      },
    },
  });
  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      node('Preview', {
        source: { type: 'audio', display: 'input', hidden: false, required: true, onSignal: 'untrusted_saved_action' },
        strength: { type: 'float', hidden: false, value: 0.65, min: 0, max: 1 },
      }),
    ],
    edges: [],
  });
  const params = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  assert.equal(params.source.hidden, false);
  assert.equal(params.source.required, true);
  assert.equal(params.source.onSignal, 'current_contract');
  assert.equal(params.strength.hidden, false);
  assert.equal(params.strength.value, 0.65);
  assert.equal(params.strength.max, 1);
  assert.equal(params.missing_identity.hidden, true);
});

test('pre-registry graph replacement strips stored behavior and restores only the arriving live contract', () => {
  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      node('startup-loader', {
        repository: {
          type: 'string',
          display: 'modelselect',
          value: { source: 'hub', value: 'example/custom-modular' },
          onChange: 'saved_repository_action',
        },
        components: {
          display: 'input',
          type: 'Components',
          onSignal: { action: 'value', target: 'saved_identity' },
        },
        spawned_input: {
          type: 'string',
          spawn: true,
          value: 'saved execution data',
          onChange: 'saved_spawn_action',
        },
      }),
    ],
    edges: [],
  });

  let state = flowStoreModule.useFlowStore.getState();
  let params = state.nodes[0].data.params;
  assert.equal(params.repository.onChange, undefined);
  assert.equal(params.components.onSignal, undefined);
  assert.deepEqual(params.spawned_input, {
    type: 'string',
    spawn: true,
    value: 'saved execution data',
  });

  nodeStoreModule.useNodesStore.setState({
    nodesRegistry: {
      'modules.Test.startup-loader': {
        type: 'custom',
        module: 'modules.Test',
        action: 'startup-loader',
        label: 'Startup loader',
        category: 'Test',
        params: {
          repository: {
            type: 'string',
            display: 'modelselect',
            value: { source: 'hub', value: 'live/default' },
            onChange: 'resolve_execution_identity',
          },
          components: {
            display: 'input',
            type: 'Components',
            onSignal: { action: 'value', target: 'modiff_pipeline_identity' },
          },
        },
      },
    },
  });
  state.replaceGraph({ nodes: state.nodes, edges: state.edges, viewport: state.viewport });

  params = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  assert.deepEqual(params.repository.value, { source: 'hub', value: 'example/custom-modular' });
  assert.equal(params.repository.onChange, 'resolve_execution_identity');
  assert.deepEqual(params.components.onSignal, {
    action: 'value',
    target: 'modiff_pipeline_identity',
  });
  assert.deepEqual(params.spawned_input, {
    type: 'string',
    spawn: true,
    value: 'saved execution data',
  });
});

test('unknown nodes remain inert after registry discovery', () => {
  nodeStoreModule.useNodesStore.setState({
    nodesRegistry: {
      'modules.Test.known-node': node('known-node', {}).data,
    },
  });
  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      node('unknown-node', {
        prompt: {
          type: 'string',
          value: 'saved prompt',
          onChange: { action: 'exec', data: 'untrusted_saved_action' },
          onSignal: { action: 'value', target: 'untrusted_saved_target' },
        },
      }),
    ],
    edges: [],
  });

  assert.deepEqual(flowStoreModule.useFlowStore.getState().nodes[0].data.params.prompt, {
    type: 'string',
    value: 'saved prompt',
  });
});

test('legacy graph replacement rebases live field actions and restores hidden execution state without replacing saved values', () => {
  const savedIdentity = {
    version: 1,
    source: 'hub',
    repository: 'example/custom-modular',
    revision: 'a'.repeat(40),
    trust_remote_code: false,
    config_filename: 'modiff_pipeline_config.json',
    config_sha256: 'b'.repeat(64),
    execution_id: 'c'.repeat(64),
  };
  nodeStoreModule.useNodesStore.setState({
    nodesRegistry: {
      'modules.Test.legacy-loader': {
        type: 'custom',
        module: 'modules.Test',
        action: 'legacy-loader',
        label: 'Current loader',
        category: 'Test',
        params: {
          repository: {
            label: 'Repository',
            type: 'string',
            value: 'live/default',
            onChange: 'resolve_execution_identity',
          },
          components: {
            display: 'input',
            type: 'Components',
            onSignal: { action: 'value', target: 'modiff_pipeline_identity' },
          },
          inert_setting: {
            type: 'string',
            value: 'live-default',
          },
          modiff_pipeline_identity: {
            type: 'object',
            value: null,
            hidden: true,
          },
          missing_hidden_state: {
            type: 'string',
            value: 'live-hidden-default',
            hidden: true,
          },
          new_visible_field: {
            type: 'string',
            value: 'not-restored-without-a-node-definition-update',
          },
        },
      },
    },
  });

  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      node('legacy-loader', {
        repository: {
          label: 'Saved repository',
          type: 'string',
          value: 'example/custom-modular',
          onChange: 'stale_resolver',
        },
        components: {
          display: 'input',
          type: 'Components',
          value: 'saved-components',
          onChange: 'stale_component_action',
          onSignal: { action: 'value', target: 'stale_identity' },
        },
        inert_setting: {
          type: 'string',
          value: 'saved-setting',
          onChange: 'removed_backend_action',
          onSignal: { action: 'value', target: 'removed_target' },
        },
        removed_field: {
          type: 'string',
          spawn: true,
          value: 'saved-execution-data',
          onChange: 'removed_field_action',
          onSignal: { action: 'value', target: 'removed_field_target' },
        },
        modiff_pipeline_identity: {
          value: savedIdentity,
        },
      }),
    ],
    edges: [],
  });

  const params = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  assert.deepEqual(params.repository, {
    label: 'Saved repository',
    type: 'string',
    value: 'example/custom-modular',
    onChange: 'resolve_execution_identity',
  });
  assert.deepEqual(params.components, {
    display: 'input',
    type: 'Components',
    value: 'saved-components',
    isConnected: false,
    onSignal: { action: 'value', target: 'modiff_pipeline_identity' },
  });
  assert.deepEqual(params.inert_setting, {
    type: 'string',
    value: 'saved-setting',
  });
  assert.deepEqual(params.removed_field, {
    type: 'string',
    spawn: true,
    value: 'saved-execution-data',
  });
  assert.deepEqual(params.modiff_pipeline_identity, {
    type: 'object',
    value: savedIdentity,
    hidden: true,
  });
  assert.deepEqual(params.missing_hidden_state, {
    type: 'string',
    value: 'live-hidden-default',
    hidden: true,
  });
  assert.equal(params.new_visible_field, undefined);
});

test('opaque output signals update connected inputs, stay transient, and clear on disconnect', () => {
  const identityA = {
    version: 1,
    source: 'hub',
    repository: 'example/custom-a',
    revision: 'a'.repeat(40),
    execution_id: '1'.repeat(64),
  };
  const identityB = {
    version: 1,
    source: 'local',
    repository: 'D:/models/custom-b',
    revision: null,
    execution_id: '2'.repeat(64),
  };
  const connection = edge('identity-edge', 'source', 'target', 'components', 'components');
  flowStoreModule.useFlowStore.setState({
    nodes: [
      node('source', {
        modiff_pipeline_identity: {
          type: 'object',
          hidden: true,
          value: identityA,
        },
        components: {
          display: 'output',
          type: 'Components',
          isConnected: true,
          signal: { direction: 'output', origin: 'modiff_pipeline_identity', value: identityA },
        },
      }),
      node('target', {
        components: {
          display: 'input',
          type: 'Components',
          isInput: true,
          isConnected: true,
          signal: {
            direction: 'output',
            origin: 'legacy-propagated-origin',
            value: { execution_id: 'stale' },
          },
        },
      }),
    ],
    edges: [connection],
  });

  let flow = flowStoreModule.useFlowStore.getState();
  flow.updateSignalValues(connection);
  assert.deepEqual(flowStoreModule.useFlowStore.getState().getParam('target', 'components', 'signal'), {
    direction: 'output',
    origin: undefined,
    value: identityA,
  });

  flowStoreModule.useFlowStore
    .getState()
    .setParam(
      'source',
      'components',
      { direction: 'output', origin: 'modiff_pipeline_identity', value: identityB },
      'signal',
    );
  flowStoreModule.useFlowStore.getState().setParam('source', 'modiff_pipeline_identity', identityB, 'value');
  flow = flowStoreModule.useFlowStore.getState();
  flow.updateSignalValues(connection);
  assert.deepEqual(flowStoreModule.useFlowStore.getState().getSignalValue('target', 'components'), identityB);

  const durable = flowStoreModule.useFlowStore.getState().toObject();
  assert.deepEqual(
    durable.nodes.find((item) => item.id === 'source').data.params.modiff_pipeline_identity.value,
    identityB,
  );
  assert.equal(durable.nodes.find((item) => item.id === 'source').data.params.components.signal.value, undefined);
  assert.equal(durable.nodes.find((item) => item.id === 'target').data.params.components.signal.value, undefined);

  flowStoreModule.useFlowStore.getState().removeEdges('identity-edge');
  assert.equal(flowStoreModule.useFlowStore.getState().getSignalValue('target', 'components'), undefined);
  assert.deepEqual(flowStoreModule.useFlowStore.getState().getSignalValue('source', 'components'), identityB);
});

test('node deletion cleans edges, spawned inputs, signals, handles, cache, and round-trips through history', () => {
  const source = node(
    'source',
    {
      output: {
        display: 'output',
        isConnected: true,
        signal: { direction: 'output', value: 'propagated' },
        artifacts: [{ url: '/cache/source/output' }],
      },
    },
    {
      isCached: true,
      progress: 67,
      executionStatus: 'running',
      executionTime: { last: 12 },
      memoryUsage: { last: 1024 },
      uiState: { collapsed: true, validationSeverity: 'error', validationMessage: 'old runtime error' },
    },
  );
  const dynamicTarget = node('dynamic-target', {
    'input>>>spawned': {
      display: 'input',
      spawn: true,
      isInput: true,
      isConnected: true,
      signal: { direction: 'input', value: 'propagated' },
    },
  });
  const regularTarget = node('regular-target', {
    input: {
      display: 'input',
      isInput: true,
      isConnected: true,
      signal: { direction: 'input', value: 'propagated' },
    },
  });
  flowStoreModule.useFlowStore.setState({
    nodes: [source, dynamicTarget, regularTarget],
    edges: [
      edge('edge-dynamic', 'source', 'dynamic-target', 'output', 'input>>>spawned'),
      edge('edge-regular', 'source', 'regular-target', 'output', 'input'),
    ],
  });

  flowStoreModule.useFlowStore.getState().removeNodes('source');

  let state = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(
    state.nodes.map((item) => item.id),
    ['dynamic-target', 'regular-target'],
  );
  assert.equal(state.edges.length, 0);
  assert.equal(state.nodes[0].data.params['input>>>spawned'], undefined);
  assert.equal(state.nodes[1].data.params.input.isInput, false);
  assert.equal(state.nodes[1].data.params.input.isConnected, false);
  assert.equal(state.nodes[1].data.params.input.signal.value, undefined);
  assert.equal(state.historyPast.length, 1);
  assert.equal(cacheRequests().length, 1);
  assert.deepEqual(JSON.parse(cacheRequests()[0].init.body), { nodes: ['source'] });
  assert.equal(cacheRequests()[0].init.headers['Content-Type'], 'application/json');

  state.undo();
  state = flowStoreModule.useFlowStore.getState();
  const restoredSource = state.nodes.find((item) => item.id === 'source');
  assert.equal(state.edges.length, 2);
  assert.ok(state.nodes.find((item) => item.id === 'dynamic-target').data.params['input>>>spawned']);
  assert.equal(restoredSource.data.params.output.isConnected, true);
  assert.equal(restoredSource.data.isCached, undefined);
  assert.equal(restoredSource.data.progress, undefined);
  assert.equal(restoredSource.data.executionStatus, undefined);
  assert.equal(restoredSource.data.executionTime, undefined);
  assert.equal(restoredSource.data.memoryUsage, undefined);
  assert.equal(restoredSource.data.uiState.collapsed, true);
  assert.equal(restoredSource.data.uiState.validationMessage, undefined);
  assert.equal(restoredSource.data.params.output.artifacts, undefined);
  assert.equal(restoredSource.data.params.output.signal.value, undefined);
  assert.equal(cacheRequests().length, 1);

  state.redo();
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(
    state.nodes.some((item) => item.id === 'source'),
    false,
  );
  assert.equal(state.edges.length, 0);
  assert.equal(cacheRequests().length, 2);
});

test('eligible V2 internal deletion is undoable and survives collapse, persistence, and rematerialization', () => {
  const fixture = blockV2DeletionFixture();
  flowStoreModule.useFlowStore.setState({ nodes: fixture.nodes, edges: fixture.edges });
  const originalRoot = fixture.nodes.find((item) => item.id === fixture.rootId);

  flowStoreModule.useFlowStore.getState().removeNodes(fixture.utilityId);

  let state = flowStoreModule.useFlowStore.getState();
  let root = state.nodes.find((item) => item.id === fixture.rootId);
  assert.equal(
    state.nodes.some((item) => item.id === fixture.utilityId),
    false,
  );
  assert.equal(
    root.data.blockInstanceV2.effectiveGraph.nodes.some(({ nodeId }) => nodeId === 'utility'),
    false,
  );
  assert.equal(
    root.data.blockInstanceV2.effectiveGraph.edges.some(
      ({ sourceNodeId, targetNodeId }) => sourceNodeId === 'utility' || targetNodeId === 'utility',
    ),
    false,
  );
  assert.deepEqual(root.data.blockInstanceV2.effectiveGraph.executionOrder, ['generate', 'preview']);
  assert.equal(root.data.blockInstanceV2.presentation.internalLayout.utility, undefined);
  assert.deepEqual(root.data.blockInstanceV2.authorities, []);
  assert.equal(root.data.blockInstanceV2.customization.state, 'structure_changed');
  assert.deepEqual(
    root.data.blockInstanceV2.presentation.position,
    originalRoot.data.blockInstanceV2.presentation.position,
  );
  assert.deepEqual(root.data.blockInstanceV2.presentation.size, originalRoot.data.blockInstanceV2.presentation.size);
  assert.equal(root.selected, true);
  assert.deepEqual(state.edges.map(({ id }) => id).sort(), ['external-input', 'external-output']);
  assert.equal(state.historyPast.length, 1);
  assert.deepEqual(JSON.parse(cacheRequests()[0].init.body), { nodes: [fixture.utilityId] });

  state.undo();
  flowStoreModule.useFlowStore.getState().ensureBlockProjectionV2(fixture.rootId);
  state = flowStoreModule.useFlowStore.getState();
  root = state.nodes.find((item) => item.id === fixture.rootId);
  assert.equal(
    state.nodes.some((item) => item.id === fixture.utilityId),
    true,
  );
  assert.equal(
    root.data.blockInstanceV2.effectiveGraph.nodes.some(({ nodeId }) => nodeId === 'utility'),
    true,
  );
  assert.equal(root.data.blockInstanceV2.authorities.length, 1);

  state.redo();
  flowStoreModule.useFlowStore.getState().ensureBlockProjectionV2(fixture.rootId);
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(
    state.nodes.some((item) => item.id === fixture.utilityId),
    false,
  );

  state.toggleUserBlockExpanded(fixture.rootId);
  const saved = flowStoreModule.useFlowStore.getState().toObject();
  assert.equal(
    saved.nodes.some((item) => item.data.blockProjectionOwnerId === fixture.rootId),
    false,
  );
  const restored = flowStoreModule.normalizePersistedFlowState(saved);
  flowStoreModule.useFlowStore.setState({
    ...restored,
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
  flowStoreModule.useFlowStore.getState().toggleUserBlockExpanded(fixture.rootId);
  state = flowStoreModule.useFlowStore.getState();
  root = state.nodes.find((item) => item.id === fixture.rootId);
  assert.equal(root.data.blockInstanceV2.presentation.expanded, true);
  assert.equal(
    root.data.blockInstanceV2.effectiveGraph.nodes.some(({ nodeId }) => nodeId === 'utility'),
    false,
  );
  assert.equal(
    state.nodes.some((item) => item.id === fixture.utilityId),
    false,
  );
  assert.deepEqual(
    state.edges
      .filter(({ id }) => id.startsWith('external-'))
      .map(({ id }) => id)
      .sort(),
    ['external-input', 'external-output'],
  );
});

test('V2 internal deletion rejects public bindings atomically and surfaces the exact blockers', () => {
  const fixture = blockV2DeletionFixture('block-v2-protected-delete');
  flowStoreModule.useFlowStore.setState({ nodes: fixture.nodes, edges: fixture.edges });
  const before = flowStoreModule.useFlowStore.getState().toObject();

  flowStoreModule.useFlowStore.getState().removeNodes([fixture.generateId, fixture.utilityId]);

  const state = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(state.toObject(), before);
  assert.equal(
    state.nodes.some((item) => item.id === fixture.generateId),
    true,
  );
  assert.equal(
    state.nodes.some((item) => item.id === fixture.utilityId),
    true,
  );
  assert.equal(state.historyPast.length, 0);
  assert.equal(cacheRequests().length, 0);
  const toast = snackbarModule.getToastItems().at(-1);
  assert.equal(toast.variant, 'error');
  assert.match(String(toast.message), /public input "Prompt"/u);
  assert.match(String(toast.message), /public output "Images"/u);
  assert.match(String(toast.message), /exposed control "Prompt"/u);
  assert.match(String(toast.message), /Rebind those public declarations first/u);
});

test('deleting a V2 root removes the complete composite instead of structurally editing its children', () => {
  const fixture = blockV2DeletionFixture('block-v2-root-delete');
  flowStoreModule.useFlowStore.setState({ nodes: fixture.nodes, edges: fixture.edges });

  flowStoreModule.useFlowStore.getState().removeNodes(fixture.rootId);

  const state = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(state.nodes.map(({ id }) => id).sort(), ['outside-sink', 'outside-source']);
  assert.equal(state.edges.length, 0);
  assert.equal(state.historyPast.length, 1);
  const deletedCacheIds = JSON.parse(cacheRequests()[0].init.body).nodes;
  assert.deepEqual(
    deletedCacheIds.sort(),
    [fixture.rootId, fixture.generateId, fixture.utilityId, fixture.previewId].sort(),
  );
});

test('collapsed V2 deletion clears hidden runtime nodes and preserves unrelated cache owners', () => {
  const fixture = blockV2DeletionFixture('collapsed-cache-owner');
  const root = fixture.nodes.find((item) => item.id === fixture.rootId);
  const instance = blockRuntimeModule.setBlockPresentationV2(root.data.blockInstanceV2, { expanded: false });
  flowStoreModule.useFlowStore.setState({
    nodes: [blockRuntimeModule.createBlockRootNodeV2(instance), node('unrelated', {})],
    edges: [],
  });
  flowStoreModule.useFlowStore.getState().removeNodes(fixture.rootId);
  assert.deepEqual(
    JSON.parse(cacheRequests()[0].init.body).nodes.sort(),
    [fixture.rootId, fixture.generateId, fixture.utilityId, fixture.previewId].sort(),
  );
  assert.deepEqual(
    flowStoreModule.useFlowStore.getState().nodes.map(({ id }) => id),
    ['unrelated'],
  );
});

test('graph replacement clears removed hidden V2 runtimes but not a retained collapsed instance', () => {
  const fixture = blockV2DeletionFixture('replacement-cache-owner');
  const root = fixture.nodes.find((item) => item.id === fixture.rootId);
  const instance = blockRuntimeModule.setBlockPresentationV2(root.data.blockInstanceV2, { expanded: false });
  const collapsed = blockRuntimeModule.createBlockRootNodeV2(instance);
  flowStoreModule.useFlowStore.setState({
    nodes: fixture.nodes.filter((item) => !item.id.startsWith('outside-')),
    edges: [],
  });
  flowStoreModule.useFlowStore.getState().replaceGraph({ nodes: [collapsed], edges: [] }, { clearRemovedCache: true });
  assert.equal(cacheRequests().length, 0);
  flowStoreModule.useFlowStore.getState().replaceGraph({ nodes: [], edges: [] }, { clearRemovedCache: true });
  assert.deepEqual(
    JSON.parse(cacheRequests()[0].init.body).nodes.sort(),
    [fixture.rootId, fixture.generateId, fixture.utilityId, fixture.previewId].sort(),
  );
});

test('terminal cleanup is task-scoped and durable graph snapshots never retain execution state', () => {
  const completedTaskNode = node(
    'completed-task-node',
    {
      output: {
        display: 'output',
        type: 'image',
        artifacts: [{ url: '/cache/completed/output' }],
        signal: { direction: 'output', value: 'runtime-only' },
      },
    },
    {
      progress: -1,
      activeTaskId: 'task-completed',
      attemptIndex: 2,
      executionStatus: 'running',
      executionPhase: 'decoding',
      progressMessage: 'Decoding',
    },
  );
  const newerTaskNode = node(
    'newer-task-node',
    {},
    {
      progress: 35,
      activeTaskId: 'task-newer',
      attemptIndex: 0,
      executionStatus: 'running',
      executionPhase: 'denoising',
      progressMessage: 'Denoising',
    },
  );
  flowStoreModule.useFlowStore.setState({ nodes: [completedTaskNode, newerTaskNode], edges: [] });

  flowStoreModule.useFlowStore.getState().resetExecutionProgress('task-completed');

  const state = flowStoreModule.useFlowStore.getState();
  const cleared = state.nodes.find((item) => item.id === 'completed-task-node');
  const active = state.nodes.find((item) => item.id === 'newer-task-node');
  assert.equal(cleared.data.progress, 0);
  assert.equal(cleared.data.activeTaskId, null);
  assert.equal(cleared.data.attemptIndex, undefined);
  assert.equal(cleared.data.executionStatus, undefined);
  assert.equal(cleared.data.executionPhase, undefined);
  assert.equal(cleared.data.progressMessage, undefined);
  assert.equal(active.data.progress, 35);
  assert.equal(active.data.activeTaskId, 'task-newer');
  assert.equal(active.data.executionStatus, 'running');

  const durable = state.toObject();
  const durableActive = durable.nodes.find((item) => item.id === 'newer-task-node');
  const durableCleared = durable.nodes.find((item) => item.id === 'completed-task-node');
  assert.equal(durableActive.data.progress, undefined);
  assert.equal(durableActive.data.activeTaskId, undefined);
  assert.equal(durableActive.data.attemptIndex, undefined);
  assert.equal(durableActive.data.executionStatus, undefined);
  assert.equal(durableActive.data.executionPhase, undefined);
  assert.equal(durableActive.data.progressMessage, undefined);
  assert.equal(durableCleared.data.params.output.artifacts, undefined);
  assert.equal(durableCleared.data.params.output.signal.value, undefined);

  const persisted = JSON.parse(globalThis.localStorage.getItem('modiff.flow')).state;
  const persistedActive = persisted.nodes.find((item) => item.id === 'newer-task-node');
  assert.equal(persistedActive.data.progress, undefined);
  assert.equal(persistedActive.data.activeTaskId, undefined);
  assert.equal(persistedActive.data.executionStatus, undefined);
});

test('advancing a task retires the previous node progress indicator', () => {
  flowStoreModule.useFlowStore.setState({
    nodes: [node('config', {}), node('loader', {})],
    edges: [],
  });

  const flow = flowStoreModule.useFlowStore.getState();
  flow.updateProgress('config', -1, {
    activeTaskId: 'stale-or-missing-task-identity',
    attemptIndex: 0,
    executionStatus: 'running',
    executionPhase: 'preparing',
    progressMessage: 'Building execution recipe',
    executionProgress: { phase: 'preparing', message: 'Building execution recipe' },
  });
  flow.updateProgress('loader', 23, {
    activeTaskId: 'task-sequential',
    attemptIndex: 0,
    executionStatus: 'running',
    executionPhase: 'loading',
    progressMessage: 'Loading weights 91/398',
    executionProgress: { phase: 'loading', message: 'Loading weights 91/398' },
  });

  const state = flowStoreModule.useFlowStore.getState();
  const config = state.nodes.find((item) => item.id === 'config');
  const loader = state.nodes.find((item) => item.id === 'loader');
  assert.equal(config.data.progress, 0);
  assert.equal(config.data.activeTaskId, null);
  assert.equal(config.data.executionStatus, undefined);
  assert.equal(config.data.executionPhase, undefined);
  assert.equal(config.data.progressMessage, undefined);
  assert.equal(config.data.executionProgress, undefined);
  assert.equal(loader.data.progress, 23);
  assert.equal(loader.data.activeTaskId, 'task-sequential');
  assert.equal(loader.data.executionStatus, 'running');
  assert.equal(loader.data.progressMessage, 'Loading weights 91/398');
});

test('persisted flow hydration versions, strips behavior, and filters malformed graph state', async () => {
  const valid = node('persisted-valid', {
    prompt: {
      value: 'restored',
      onChange: 'persisted_action',
      onSignal: { action: 'value', target: 'persisted_target' },
    },
  });
  globalThis.localStorage.setItem(
    'modiff.flow',
    JSON.stringify({
      version: 1,
      state: {
        nodes: [
          valid,
          { id: 'invalid-node', position: null, data: { params: {} } },
          {
            ...node('invalid-param-node'),
            data: { ...node('invalid-param-node').data, params: { prompt: null } },
          },
        ],
        edges: [
          edge('valid-edge', 'persisted-valid', 'persisted-valid', 'output', 'input'),
          edge('dangling-edge', 'persisted-valid', 'missing-node', 'output', 'input'),
        ],
        viewport: { x: 12, y: Number.NaN, zoom: -4 },
      },
    }),
  );

  await flowStoreModule.useFlowStore.persist.rehydrate();

  const restored = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(
    restored.nodes.map((item) => item.id),
    ['persisted-valid'],
  );
  assert.deepEqual(
    restored.edges.map((item) => item.id),
    ['valid-edge'],
  );
  assert.deepEqual(restored.viewport, { x: 12, y: 0, zoom: 1 });
  assert.deepEqual(restored.nodes[0].data.params.prompt, { value: 'restored' });
  assert.equal(restored.historyPast.length, 0);
  assert.equal(restored.historyFuture.length, 0);
});

test('cache status reset is atomic and never publishes an empty graph during reconnect', () => {
  const managedNode = node(
    'managed-generate',
    {},
    {
      studioRole: 'generate',
      progress: 42,
      activeTaskId: 'task-running',
      attemptIndex: 0,
      executionStatus: 'running',
      executionPhase: 'denoising',
      progressMessage: 'Denoising',
    },
  );
  const outputNode = node('managed-output', {}, { studioRole: 'output', isCached: true });
  const connection = edge('managed-edge', managedNode.id, outputNode.id, 'image', 'image');
  const viewport = { x: 21, y: -13, zoom: 0.82 };
  flowStoreModule.useFlowStore.setState({
    nodes: [managedNode, outputNode],
    edges: [connection],
    viewport,
    lastExecutionTime: 1250,
  });

  const publications = [];
  const unsubscribe = flowStoreModule.useFlowStore.subscribe((state) => {
    publications.push({
      nodeIds: state.nodes.map((item) => item.id),
      edgeIds: state.edges.map((item) => item.id),
      viewport: state.viewport,
    });
  });
  flowStoreModule.useFlowStore.getState().resetStatus(['managed-generate']);
  unsubscribe();

  assert.ok(publications.length > 0);
  assert.ok(publications.every((publication) => publication.nodeIds.length === 2));
  assert.ok(publications.every((publication) => publication.edgeIds.length === 1));
  assert.ok(publications.every((publication) => publication.viewport === viewport));

  const state = flowStoreModule.useFlowStore.getState();
  const generate = state.nodes.find((item) => item.id === 'managed-generate');
  const output = state.nodes.find((item) => item.id === 'managed-output');
  assert.equal(generate.data.studioRole, 'generate');
  assert.equal(generate.data.isCached, true);
  assert.equal(generate.data.progress, 0);
  assert.equal(generate.data.activeTaskId, null);
  assert.equal(generate.data.attemptIndex, undefined);
  assert.equal(generate.data.executionStatus, undefined);
  assert.equal(generate.data.executionPhase, undefined);
  assert.equal(generate.data.progressMessage, undefined);
  assert.equal(output.data.studioRole, 'output');
  assert.equal(output.data.isCached, false);
  assert.deepEqual(state.edges, [connection]);
  assert.equal(state.viewport, viewport);
  assert.equal(state.lastExecutionTime, 0);
});

test('React Flow removal deletes group descendants through the same invariant path', () => {
  const group = {
    ...node('group', {}),
    type: 'group',
    data: { ...node('group', {}).data, type: 'group' },
  };
  const child = { ...node('child', {}), parentId: 'group', extent: 'parent' };
  flowStoreModule.useFlowStore.setState({ nodes: [group, child], edges: [] });

  flowStoreModule.useFlowStore.getState().onNodesChange([{ id: 'group', type: 'remove' }]);

  assert.equal(flowStoreModule.useFlowStore.getState().nodes.length, 0);
  assert.deepEqual(JSON.parse(cacheRequests()[0].init.body), { nodes: ['group', 'child'] });
});

test('loop creation keeps selected nodes visible as direct container children and can be reversed', () => {
  const first = { ...node('first', {}), position: { x: 100, y: 120 }, width: 180, height: 100, selected: true };
  const second = { ...node('second', {}), position: { x: 360, y: 180 }, width: 180, height: 100, selected: true };
  flowStoreModule.useFlowStore.setState({ nodes: [first, second], edges: [] });

  flowStoreModule.useFlowStore.getState().loopNodes(['first', 'second']);

  let state = flowStoreModule.useFlowStore.getState();
  const loop = state.nodes.find((item) => item.data.type === 'loop');
  assert.ok(loop);
  assert.equal(state.nodes.find((item) => item.id === 'first').parentId, loop.id);
  assert.equal(state.nodes.find((item) => item.id === 'second').parentId, loop.id);
  assert.equal(loop.data.params.iterations.value, 2);

  state.ungroupNodes(loop.id);
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(
    state.nodes.some((item) => item.id === loop.id),
    false,
  );
  assert.equal(state.nodes.find((item) => item.id === 'first').parentId, undefined);
  assert.deepEqual(state.nodes.find((item) => item.id === 'first').position, { x: 100, y: 120 });
});

test('graph replacement filters dangling edges and reconciles disconnected runtime state', () => {
  const oldNode = node('old', { output: { display: 'output', isConnected: true } });
  flowStoreModule.useFlowStore.setState({ nodes: [oldNode], edges: [] });
  const importedTarget = node('imported-target', {
    input: {
      display: 'input',
      isConnected: true,
      signal: { direction: 'input', value: 'stale' },
    },
  });

  flowStoreModule.useFlowStore.getState().replaceGraph(
    {
      nodes: [importedTarget],
      edges: [edge('dangling', 'missing-source', 'imported-target', 'output', 'input')],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    },
    { historyLabel: 'Import graph', clearRemovedCache: true },
  );

  const state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.edges.length, 0);
  assert.deepEqual(state.viewport, { x: 10, y: 20, zoom: 0.8 });
  assert.equal(state.nodes[0].data.params.input.isConnected, false);
  assert.equal(state.nodes[0].data.params.input.signal.value, undefined);
  assert.equal(state.historyPast.length, 1);
  assert.deepEqual(JSON.parse(cacheRequests()[0].init.body), { nodes: ['old'] });
});

test('dynamic parameter replacement preserves compatible edge identities and removes only invalid handles', () => {
  const source = node('source', {
    keep: { display: 'output', isConnected: true },
    remove: { display: 'output', isConnected: true, signal: { direction: 'output', value: 'stale' } },
  });
  const target = node('target', {
    keep: { display: 'input', isInput: true, isConnected: true },
    remove: {
      display: 'input',
      isInput: true,
      isConnected: true,
      signal: { direction: 'input', value: 'stale' },
    },
  });
  flowStoreModule.useFlowStore.setState({
    nodes: [source, target],
    edges: [
      edge('keep-edge', 'source', 'target', 'keep', 'keep'),
      edge('remove-edge', 'source', 'target', 'remove', 'remove'),
    ],
  });

  flowStoreModule.useFlowStore.getState().replaceNodeParams('target', {
    keep: { display: 'input', isInput: true, isConnected: true },
  });

  const state = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(
    state.edges.map((item) => item.id),
    ['keep-edge'],
  );
  assert.equal(state.nodes.find((item) => item.id === 'source').data.params.remove.isConnected, false);
  assert.equal(state.nodes.find((item) => item.id === 'source').data.params.remove.signal.value, undefined);
  assert.equal(state.nodes.find((item) => item.id === 'target').data.params.remove, undefined);
  assert.equal(state.historyPast.length, 0);
});

for (const direction of ['source', 'target']) {
  test(`search insertion connects a saved Block from a ${direction} port in one undoable edit`, () => {
    const fixture = blockV2DeletionFixture('saved-search-block');
    const root = fixture.nodes.find((item) => item.id === fixture.rootId);
    const external = fixture.nodes.find(
      (item) => item.id === (direction === 'source' ? 'outside-source' : 'outside-sink'),
    );
    const store = flowStoreModule.useFlowStore;
    store.setState({ nodes: [external], edges: [] });
    store.getState().updateHandleConnectionStatus();
    const before = JSON.stringify({ nodes: store.getState().nodes, edges: store.getState().edges });
    const connection =
      direction === 'source'
        ? { source: external.id, sourceHandle: 'text', target: root.id, targetHandle: 'prompt', edgeType: 'default' }
        : { source: root.id, sourceHandle: 'images', target: external.id, targetHandle: 'images', edgeType: 'default' };
    store.getState().addNodeWithConnection(root, connection);
    assert.equal(store.getState().edges.length, 1);
    assert.equal(store.getState().historyPast.length, 1);
    assert.deepEqual(store.getState().nodes.find((item) => item.id === root.id).data.params, {});
    assert.deepEqual(
      store.getState().nodes.find((item) => item.id === root.id).data.blockInstanceV2.definitionRef,
      root.data.blockInstanceV2.definitionRef,
    );
    store.getState().undo();
    assert.equal(JSON.stringify({ nodes: store.getState().nodes, edges: store.getState().edges }), before);
    store.getState().redo();
    assert.equal(store.getState().edges.length, 1);
    assert.ok(store.getState().nodes.some((item) => item.id === root.id));
  });
}

test('rejected search connections restore the graph and history instead of leaving a disconnected insertion', () => {
  const source = node('source', { output: { display: 'output', type: 'image' } });
  const target = node('target', { input: { display: 'input', type: 'string' } });
  const store = flowStoreModule.useFlowStore;
  store.setState({ nodes: [source], edges: [] });
  store.getState().updateHandleConnectionStatus();
  const before = JSON.stringify({ nodes: store.getState().nodes, edges: store.getState().edges });
  for (const sourceId of ['source', 'removed']) {
    assert.throws(
      () =>
        store.getState().addNodeWithConnection(target, {
          source: sourceId,
          sourceHandle: 'output',
          target: target.id,
          targetHandle: 'input',
          edgeType: 'default',
        }),
      /no longer be connected/,
    );
    assert.equal(JSON.stringify({ nodes: store.getState().nodes, edges: store.getState().edges }), before);
    assert.equal(store.getState().historyPast.length, 0);
    assert.equal(store.getState().historyTransaction, null);
  }
});
