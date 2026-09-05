import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let definitionPersistence;
let flowStore;
let persistence;
let runtime;
let schema;
let server;
let studioStore;
let userBlockStore;
let originalFetch;

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
  definitionPersistence = await server.ssrLoadModule('/src/studio/blockDefinitionPersistenceV2.ts');
  persistence = await server.ssrLoadModule('/src/studio/blockPersistenceV2.ts');
  flowStore = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  studioStore = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  userBlockStore = await server.ssrLoadModule('/src/stores/useUserBlockStore.ts');
  originalFetch = globalThis.fetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
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
  userBlockStore.useUserBlockStore.setState({
    blocks: [],
    blockDefinitionsV2: [],
    loaded: false,
    error: null,
    revision: 0,
  });
  studioStore.useStudioStore.setState((state) => ({
    workflowTabs: [],
    activeWorkflowTabId: null,
    workflowCanvasEpoch: state.workflowCanvasEpoch + 1,
    workflowFormEpoch: state.workflowFormEpoch + 1,
  }));
  globalThis.fetch = originalFetch;
});

test('a selected Modular subtree becomes one independent top-level User Node with current defaults', () => {
  const base = definition();
  const modular = (runtimeRole, placementPath, parentPlacementPath, blockKind = 'block') => ({
    kind: 'upstream_block',
    pipelineClass: 'QwenImageModularPipeline',
    blocksClass: 'QwenImageAutoBlocks',
    workflowId: 'text2image',
    libraryRevision: 'a'.repeat(40),
    runtimeRole,
    blockDefinitionId: `diffusers.modular-block:${runtimeRole}:sha256:${'d'.repeat(64)}`,
    blockClass: `${runtimeRole}Block`,
    blockKind,
    blockContractHash: `sha256:${'e'.repeat(64)}`,
    placementPath,
    ...(parentPlacementPath ? { parentPlacementPath } : {}),
    componentNames: [],
  });
  const parent = {
    ...base.graph.nodes[0],
    nodeId: 'denoise',
    semanticRole: 'denoise',
    modularDiffusers: modular('denoise', ['denoise'], undefined, 'sequential'),
    data: {
      ...base.graph.nodes[0].data,
      params: {
        prompt: { type: 'string', display: 'textarea', value: 'creator default' },
        state_in: { type: 'modular_workflow_state', display: 'input' },
        state_out: { type: 'modular_workflow_state', display: 'output' },
      },
    },
  };
  const child = {
    ...base.graph.nodes[0],
    nodeId: 'denoise-step',
    semanticRole: 'denoise-step',
    modularDiffusers: modular('denoise-step', ['denoise', 'step'], ['denoise']),
    data: {
      ...base.graph.nodes[0].data,
      params: {
        state_in: { type: 'modular_workflow_state', display: 'input' },
        image: { type: 'image', display: 'output' },
      },
    },
  };
  const outside = {
    ...parent,
    nodeId: 'outside',
    semanticRole: 'outside',
    modularDiffusers: modular('outside', ['outside']),
  };
  const graphWithoutHash = {
    nodes: [outside, parent, child],
    edges: [
      {
        edgeId: 'parent-child',
        sourceNodeId: 'denoise',
        sourcePortId: 'state_out',
        targetNodeId: 'denoise-step',
        targetPortId: 'state_in',
      },
    ],
    executionOrder: ['outside', 'denoise', 'denoise-step'],
  };
  const graph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
  const withoutHash = {
    ...base,
    graph,
    boundary: {
      mode: 'explicit',
      inputs: [
        {
          portId: 'prompt',
          label: 'Prompt',
          valueType: 'string',
          required: true,
          binding: { nodeId: 'denoise', fieldOrPortId: 'prompt' },
          mirrorBindings: [{ nodeId: 'outside', fieldOrPortId: 'prompt' }],
        },
      ],
      outputs: [
        {
          portId: 'image',
          label: 'Image',
          valueType: 'image',
          required: true,
          binding: { nodeId: 'denoise-step', fieldOrPortId: 'image' },
        },
      ],
    },
    controls: base.controls.map((control) => ({
      ...control,
      binding: { ...control.binding, nodeId: 'denoise' },
      ...(control.controlId === 'prompt' ? { mirrorBindings: [{ ...control.binding, nodeId: 'outside' }] } : {}),
    })),
    previews: [{ nodeId: 'denoise-step', outputPortId: 'image', mediaType: 'image', primary: true }],
  };
  delete withoutHash.contentHash;
  const sourceDefinition = schema.normalizeBlockDefinitionV2({
    ...withoutHash,
    contentHash: schema.blockDefinitionContentHashV2(withoutHash),
  });
  const instance = runtime.setBlockInstanceValueV2(
    schema.createBlockInstanceV2(sourceDefinition, {
      instanceId: 'subtree-owner',
      position: { x: 0, y: 0 },
      size: { width: 420, height: 480 },
    }),
    'prompt',
    'workflow-specific prompt',
  );
  const saved = definitionPersistence.reusableBlockDefinitionFromSubtreeV2(instance, {
    rootNodeId: 'denoise',
    definitionId: 'user-subtree',
    displayName: 'Denoise — Workflow',
  });

  assert.equal(saved.ownership.kind, 'user');
  assert.equal(saved.source.kind, 'user');
  assert.deepEqual(
    saved.graph.nodes.map(({ nodeId }) => nodeId),
    ['denoise', 'denoise-step'],
  );
  assert.deepEqual(
    saved.graph.edges.map(({ edgeId }) => edgeId),
    ['parent-child'],
  );
  assert.equal(saved.controls.find(({ controlId }) => controlId === 'prompt').defaultValue, 'workflow-specific prompt');
  assert.equal(saved.boundary.inputs[0].binding.nodeId, 'denoise');
  assert.equal(saved.boundary.inputs[0].mirrorBindings, undefined);
  assert.equal(saved.controls.find(({ controlId }) => controlId === 'prompt').mirrorBindings, undefined);
  assert.equal(saved.boundary.outputs[0].binding.nodeId, 'denoise-step');
  assert.doesNotThrow(() => schema.normalizeBlockDefinitionV2(saved));
});

function definition(sourceKind = 'diffusers_catalog', definitionId = 'registered-qwen-v2') {
  const graphWithoutHash = {
    nodes: [
      {
        nodeId: 'generate',
        nodeType: 'custom',
        semanticRole: 'generate',
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          label: 'Generate',
          category: 'Test',
          params: {
            prompt: { type: 'string', display: 'textarea', value: 'creator default' },
            seed: { type: 'int', value: 7 },
            image: { type: 'image', display: 'output' },
          },
        },
      },
    ],
    edges: [],
    executionOrder: ['generate'],
  };
  const graph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
  const catalog = sourceKind === 'diffusers_catalog';
  const source = catalog
    ? {
        kind: 'diffusers_catalog',
        catalogCategory: 'diffusers',
        provider: 'huggingface',
        library: 'diffusers',
        libraryRevision: 'a'.repeat(40),
        pipelineClass: 'QwenImageModularPipeline',
        blocksClass: 'QwenImageAutoBlocks',
        workflow: 'text_to_image',
        manifestDefinitionId: 'qwen:text-to-image',
        manifestContentHash: `sha256:${'b'.repeat(64)}`,
        repository: 'Qwen/Qwen-Image',
        repositoryRevision: 'c'.repeat(40),
      }
    : {
        kind: 'user',
        provider: 'huggingface',
        library: 'diffusers',
        pipelineClass: 'QwenImageModularPipeline',
        parent: {
          definitionId: 'registered-qwen-v2',
          contentHash: 'block-definition-v2-parent',
          sourceKind: 'diffusers_catalog',
        },
      };
  const withoutHash = {
    schemaVersion: 2,
    definitionId,
    displayName: catalog ? 'Qwen Image — Text To Image' : 'Saved Qwen User Node',
    description: 'Block V2 persistence fixture.',
    source,
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
          portId: 'image',
          label: 'Image',
          valueType: 'image',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'image' },
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
        order: 0,
      },
      {
        controlId: 'seed',
        label: 'Seed',
        binding: { nodeId: 'generate', fieldId: 'seed' },
        valueType: 'integer',
        defaultValue: 7,
        order: 1,
      },
    ],
    suggestedInputs: [
      {
        suggestionId: 'creator-example',
        label: 'Creator example',
        source: 'Model card',
        values: { prompt: 'creator suggestion', seed: 7 },
      },
    ],
    previews: [{ nodeId: 'generate', outputPortId: 'image', mediaType: 'image', primary: true }],
    ownership: catalog ? { kind: 'registered', definitionMutable: false } : { kind: 'user', definitionMutable: true },
  };
  return schema.normalizeBlockDefinitionV2({
    ...withoutHash,
    contentHash: schema.blockDefinitionContentHashV2(withoutHash),
  });
}

function instanceRoot(id, sourceKind = 'diffusers_catalog', definitionId) {
  let instance = schema.createBlockInstanceV2(definition(sourceKind, definitionId), {
    instanceId: id,
    position: { x: 100, y: 120 },
    size: { width: 480, height: 560 },
    values: { prompt: '', seed: 42 },
  });
  const changedGraph = structuredClone(instance.effectiveGraph);
  changedGraph.nodes[0].data.params.seed.value = 42;
  instance = runtime.replaceBlockEffectiveGraphV2(instance, changedGraph);
  instance = runtime.setBlockPresentationV2(instance, {
    expanded: true,
    internalLayout: { generate: { x: 64, y: 96, width: 350, height: 280 } },
  });
  instance = runtime.setBlockPreviewStateV2(
    instance,
    { nodeId: 'generate', outputPortId: 'image' },
    { mediaReference: '/data/generated/qwen.png', taskId: 'task-qwen', status: 'complete' },
  );
  return runtime.createBlockRootNodeV2(instance);
}

function legacyBlock(id = 'legacy-user-block') {
  return {
    id,
    name: 'Legacy User Block',
    version: 1,
    nodes: [],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
  };
}

function modularSelection(sourceKind = 'diffusers_catalog') {
  const original = instanceRoot('subtree-owner', sourceKind);
  const graph = structuredClone(original.data.blockInstanceV2.effectiveGraph);
  graph.nodes[0].modularDiffusers = {
    kind: 'upstream_block',
    pipelineClass: 'QwenImageModularPipeline',
    blocksClass: 'QwenImageAutoBlocks',
    workflowId: 'text2image',
    libraryRevision: 'a'.repeat(40),
    runtimeRole: 'generate',
    blockDefinitionId: `diffusers.modular-block:generate:sha256:${'d'.repeat(64)}`,
    blockClass: 'QwenGenerateBlock',
    blockKind: 'block',
    blockContractHash: `sha256:${'e'.repeat(64)}`,
    placementPath: ['generate'],
    componentNames: [],
  };
  const owner = runtime.createBlockRootNodeV2(
    runtime.replaceBlockEffectiveGraphV2(original.data.blockInstanceV2, graph),
  );
  const selected = {
    id: runtime.blockProjectionNodeIdV2(owner.id, 'generate'),
    type: 'custom',
    position: { x: 64, y: 96 },
    data: {
      label: 'Nested generator',
      params: {},
      blockProjectionKind: 'internal',
      blockProjectionOwnerId: owner.id,
      blockProjectionNodeId: 'generate',
      blockProjectionModular: true,
    },
  };
  const sibling = instanceRoot('independent-sibling');
  flowStore.useFlowStore.setState({ nodes: [owner, selected, sibling], edges: [] });
  return { owner, selected, sibling };
}

test('nested save choices preserve the owner and save only the selected current subtree', async () => {
  const { owner, selected, sibling } = modularSelection();
  const sourceBefore = structuredClone(owner.data.blockInstanceV2);
  const siblingBefore = structuredClone(sibling.data.blockInstanceV2);
  let writes = 0;
  const save = async (candidate) => {
    writes++;
    return structuredClone(candidate);
  };
  const kept = await persistence.persistBlockSelectionV2Choice({ nodeId: selected.id, choice: 'workflow' }, save);
  assert.equal(kept.definition, null);
  assert.equal(writes, 0);
  const result = await persistence.persistBlockSelectionV2Choice({ nodeId: selected.id, choice: 'new' }, save);
  assert.equal(writes, 1);
  assert.deepEqual(
    result.definition.graph.nodes.map(({ nodeId }) => nodeId),
    ['generate'],
  );
  assert.equal(result.definition.controls.find(({ controlId }) => controlId === 'prompt').defaultValue, '');
  assert.equal(result.definition.controls.find(({ controlId }) => controlId === 'seed').defaultValue, 42);
  assert.deepEqual(
    flowStore.useFlowStore.getState().nodes.find(({ id }) => id === owner.id).data.blockInstanceV2,
    sourceBefore,
  );
  assert.deepEqual(
    flowStore.useFlowStore.getState().nodes.find(({ id }) => id === sibling.id).data.blockInstanceV2,
    siblingBefore,
  );
});

test('nested update cannot overwrite even a user-owned parent definition', async () => {
  const { selected } = modularSelection('user');
  let writes = 0;
  await assert.rejects(
    persistence.persistBlockSelectionV2Choice({ nodeId: selected.id, choice: 'update' }, async (candidate) => {
      writes++;
      return candidate;
    }),
    /no independent reusable definition/,
  );
  assert.equal(writes, 0);
});

test('stale save-dialog workflow context is rejected before any library write', async () => {
  const { owner, selected } = modularSelection();
  const context = studioStore.captureWorkflowOperationContext();
  studioStore.useStudioStore.setState((state) => ({ workflowCanvasEpoch: state.workflowCanvasEpoch + 1 }));
  let writes = 0;
  const save = async (candidate) => {
    writes++;
    return candidate;
  };
  for (const nodeId of [owner.id, selected.id]) {
    await assert.rejects(
      persistence.persistBlockSelectionV2Choice({ nodeId, choice: 'new', context }, save),
      /workflow|canvas/i,
    );
  }
  await assert.rejects(
    persistence.saveBlockInstanceV2AsNewUserDefinition({ instanceId: owner.id, context }, save),
    /workflow|canvas/i,
  );
  await assert.rejects(
    persistence.saveBlockSubtreeV2AsNewUserDefinition(
      { instanceId: owner.id, rootNodeId: 'generate', label: 'Nested', context },
      save,
    ),
    /workflow|canvas/i,
  );
  assert.equal(writes, 0);
});

test('removed or forged projected selections cannot save a different subtree', async () => {
  const { selected } = modularSelection();
  let writes = 0;
  const save = async (candidate) => {
    writes++;
    return candidate;
  };
  await assert.rejects(
    persistence.persistBlockSelectionV2Choice({ nodeId: 'removed', choice: 'new' }, save),
    /no longer available/,
  );
  flowStore.useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => (node.id === selected.id ? { ...node, id: 'forged-id' } : node)),
  }));
  await assert.rejects(
    persistence.persistBlockSelectionV2Choice({ nodeId: 'forged-id', choice: 'new' }, save),
    /invalid projection identity/,
  );
  assert.equal(writes, 0);
});

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

test('save as new preserves the effective graph, explicit interface, current defaults, previews, and ancestry', async () => {
  let target = instanceRoot('target-new');
  const configuredBoundary = structuredClone(target.data.blockInstanceV2.effectiveInterface.boundary);
  configuredBoundary.inputs[0].label = 'Workflow prompt';
  target = runtime.createBlockRootNodeV2(
    runtime.replaceBlockEffectiveInterfaceV2(target.data.blockInstanceV2, {
      boundary: configuredBoundary,
      controls: target.data.blockInstanceV2.effectiveInterface.controls,
    }),
  );
  const sibling = instanceRoot('sibling-new');
  const siblingBefore = JSON.stringify(sibling);
  flowStore.useFlowStore.setState({ nodes: [target, sibling], edges: [] });
  let written;

  const result = await persistence.persistBlockInstanceV2Choice(
    { instanceId: target.id, choice: 'new', workflowTitle: 'Portrait workflow' },
    async (candidate) => {
      written = candidate;
      return structuredClone(candidate);
    },
  );

  assert.ok(written.definitionId.startsWith('user-block-v2-'));
  assert.equal(written.displayName, 'Qwen Image — Text To Image — Portrait workflow');
  assert.equal(written.source.kind, 'user');
  assert.equal(written.source.catalogCategory, undefined);
  assert.deepEqual(written.source.parent, {
    definitionId: target.data.blockInstanceV2.definitionRef.definitionId,
    contentHash: target.data.blockInstanceV2.definitionRef.contentHash,
    sourceKind: 'diffusers_catalog',
  });
  assert.deepEqual(written.graph, target.data.blockInstanceV2.effectiveGraph);
  assert.equal(written.boundary.mode, 'explicit');
  assert.deepEqual(written.boundary.inputs, target.data.blockInstanceV2.effectiveInterface.boundary.inputs);
  assert.deepEqual(written.boundary.outputs, target.data.blockInstanceV2.effectiveInterface.boundary.outputs);
  assert.equal(written.boundary.inputs[0].label, 'Workflow prompt');
  assert.equal(written.controls.find(({ controlId }) => controlId === 'prompt').defaultValue, '');
  assert.equal(written.controls.find(({ controlId }) => controlId === 'seed').defaultValue, 42);
  assert.deepEqual(written.previews, target.data.blockInstanceV2.definitionSnapshot.previews);
  assert.equal(result.definition.contentHash, written.contentHash);

  const state = flowStore.useFlowStore.getState();
  const rebased = state.nodes.find((node) => node.id === target.id).data.blockInstanceV2;
  assert.equal(rebased.definitionRef.definitionId, written.definitionId);
  assert.equal(rebased.values.prompt, '');
  assert.equal(rebased.values.seed, 42);
  assert.deepEqual(rebased.presentation, target.data.blockInstanceV2.presentation);
  assert.deepEqual(rebased.previewStates, target.data.blockInstanceV2.previewStates);
  assert.deepEqual(rebased.authorities, []);
  assert.equal(JSON.stringify(state.nodes.find((node) => node.id === sibling.id)), siblingBefore);
});

test('save active route as a User Node copy leaves the workflow instance byte-identical for a following route switch', async () => {
  const target = instanceRoot('target-copy');
  const sibling = instanceRoot('sibling-copy');
  flowStore.useFlowStore.setState({ nodes: [target, sibling], edges: [] });
  const targetBefore = JSON.stringify(target.data.blockInstanceV2);
  const siblingBefore = JSON.stringify(sibling);
  let written;

  const saved = await persistence.saveBlockInstanceV2AsNewUserDefinition(
    { instanceId: target.id, workflowTitle: 'Generic image workflow' },
    async (candidate) => {
      written = candidate;
      return structuredClone(candidate);
    },
  );

  assert.equal(saved.definitionId, written.definitionId);
  assert.equal(saved.displayName, 'Qwen Image — Text To Image — Generic image workflow');
  assert.equal(saved.source.kind, 'user');
  assert.equal(
    JSON.stringify(flowStore.useFlowStore.getState().nodes.find((node) => node.id === target.id).data.blockInstanceV2),
    targetBefore,
  );
  assert.equal(
    JSON.stringify(flowStore.useFlowStore.getState().nodes.find((node) => node.id === sibling.id)),
    siblingBefore,
  );
});

test('workflow-only save performs no reusable-definition write and leaves every instance byte-identical', async () => {
  const target = instanceRoot('target-workflow');
  const sibling = instanceRoot('sibling-workflow');
  flowStore.useFlowStore.setState({ nodes: [target, sibling], edges: [] });
  const before = JSON.stringify(flowStore.useFlowStore.getState().nodes);
  let writes = 0;

  const result = await persistence.persistBlockInstanceV2Choice(
    { instanceId: target.id, choice: 'workflow' },
    async () => {
      writes += 1;
      throw new Error('must not write');
    },
  );

  assert.equal(writes, 0);
  assert.equal(result.definition, null);
  assert.equal(JSON.stringify(flowStore.useFlowStore.getState().nodes), before);
});

test('update existing is limited to mutable user-owned definitions and does not refresh sibling snapshots', async () => {
  const target = instanceRoot('target-update', 'user', 'saved-user-v2');
  const sibling = instanceRoot('sibling-update', 'user', 'saved-user-v2');
  const siblingBefore = JSON.stringify(sibling);
  flowStore.useFlowStore.setState({ nodes: [target, sibling], edges: [] });

  const result = await persistence.persistBlockInstanceV2Choice(
    { instanceId: target.id, choice: 'update' },
    async (candidate) => structuredClone(candidate),
  );
  assert.equal(result.definition.definitionId, 'saved-user-v2');
  assert.equal(result.definition.source.kind, 'user');
  assert.equal(result.definition.controls.find(({ controlId }) => controlId === 'seed').defaultValue, 42);
  const state = flowStore.useFlowStore.getState();
  assert.equal(
    state.nodes.find((node) => node.id === target.id).data.blockInstanceV2.definitionRef.contentHash,
    result.definition.contentHash,
  );
  assert.equal(JSON.stringify(state.nodes.find((node) => node.id === sibling.id)), siblingBefore);

  flowStore.useFlowStore.setState({ nodes: [instanceRoot('registered-update')], edges: [] });
  let writes = 0;
  await assert.rejects(
    persistence.persistBlockInstanceV2Choice(
      { instanceId: 'registered-update', choice: 'update' },
      async (candidate) => {
        writes += 1;
        return candidate;
      },
    ),
    /Registered catalog definitions cannot be overwritten/,
  );
  assert.equal(writes, 0);
});

test('reusable save fails closed for a valued boundary-only input', () => {
  const base = definition('user', 'boundary-only-user-v2');
  const boundaryInput = {
    portId: 'adapter',
    label: 'Adapter',
    valueType: 'model',
    required: false,
    binding: { nodeId: 'generate', fieldOrPortId: 'adapter' },
  };
  const semantic = {
    ...base,
    boundary: { ...base.boundary, inputs: [...base.boundary.inputs, boundaryInput] },
  };
  delete semantic.contentHash;
  const withBoundaryOnly = schema.normalizeBlockDefinitionV2({
    ...semantic,
    contentHash: schema.blockDefinitionContentHashV2(semantic),
  });
  const instance = schema.createBlockInstanceV2(withBoundaryOnly, {
    instanceId: 'boundary-only-instance',
    position: { x: 0, y: 0 },
    size: { width: 420, height: 480 },
    values: { adapter: 'adapter-a' },
  });
  assert.throws(
    () =>
      definitionPersistence.reusableBlockDefinitionFromInstanceV2(instance, {
        choice: 'update',
        definitionId: withBoundaryOnly.definitionId,
        displayName: withBoundaryOnly.displayName,
      }),
    /boundary-only input\(s\): adapter/,
  );
});

test('a semantic edit during an awaited save cannot rebase the changed workflow instance', async () => {
  const target = instanceRoot('target-race');
  flowStore.useFlowStore.setState({ nodes: [target], edges: [] });

  await assert.rejects(
    persistence.persistBlockInstanceV2Choice({ instanceId: target.id, choice: 'new' }, async (candidate) => {
      flowStore.useFlowStore.getState().setBlockInstanceValueV2(target.id, 'prompt', 'changed during save');
      return candidate;
    }),
    /changed while its reusable definition was saving/,
  );
  const instance = flowStore.useFlowStore.getState().nodes.find((node) => node.id === target.id).data.blockInstanceV2;
  assert.equal(instance.definitionRef.definitionId, 'registered-qwen-v2');
  assert.equal(instance.values.prompt, 'changed during save');
});

test('a failed reusable-definition API write rolls back the library and leaves the workflow insertion untouched', async () => {
  const target = instanceRoot('target-api-failure');
  const targetBefore = JSON.stringify(target);
  flowStore.useFlowStore.setState({ nodes: [target], edges: [] });
  globalThis.fetch = async () => jsonResponse({ message: 'Definition storage is unavailable.' }, 503);

  await assert.rejects(
    persistence.persistBlockInstanceV2Choice({ instanceId: target.id, choice: 'new' }),
    /Definition storage is unavailable/,
  );

  const state = flowStore.useFlowStore.getState();
  assert.equal(JSON.stringify(state.nodes.find((node) => node.id === target.id)), targetBefore);
  assert.deepEqual(userBlockStore.useUserBlockStore.getState().blockDefinitionsV2, []);
  assert.match(userBlockStore.useUserBlockStore.getState().error, /Definition storage is unavailable/);
});

test('a saved User Node can be reinserted as independent Block V2 instances with the saved graph and defaults', async () => {
  const target = instanceRoot('target-reinsert');
  flowStore.useFlowStore.setState({ nodes: [target], edges: [] });
  globalThis.fetch = async (_url, options = {}) => jsonResponse({ block: JSON.parse(options.body) });

  const result = await persistence.persistBlockInstanceV2Choice({
    instanceId: target.id,
    choice: 'new',
    workflowTitle: 'Reusable portrait',
  });
  const stored = userBlockStore.useUserBlockStore
    .getState()
    .blockDefinitionsV2.find(({ definitionId }) => definitionId === result.definition.definitionId);
  assert.ok(stored);

  const first = schema.createBlockInstanceV2(stored, {
    instanceId: 'reinserted-first',
    position: { x: 10, y: 20 },
    size: { width: 420, height: 480 },
  });
  const second = schema.createBlockInstanceV2(stored, {
    instanceId: 'reinserted-second',
    position: { x: 500, y: 20 },
    size: { width: 420, height: 480 },
  });

  assert.deepEqual(first.effectiveGraph, target.data.blockInstanceV2.effectiveGraph);
  assert.deepEqual(second.effectiveGraph, target.data.blockInstanceV2.effectiveGraph);
  assert.equal(schema.blockInstanceValueV2(first, 'prompt'), '');
  assert.equal(schema.blockInstanceValueV2(first, 'seed'), 42);
  assert.notEqual(first.instanceId, second.instanceId);

  const changedFirst = runtime.setBlockInstanceValueV2(first, 'prompt', 'first insertion only');
  assert.equal(changedFirst.values.prompt, 'first insertion only');
  assert.equal(schema.blockInstanceValueV2(second, 'prompt'), '');
  assert.equal(stored.controls.find(({ controlId }) => controlId === 'prompt').defaultValue, '');
});

test('saving one Block V2 insertion does not mutate another open workflow snapshot', async () => {
  const first = instanceRoot('first-workflow-instance', 'user', 'shared-user-v2');
  const second = instanceRoot('second-workflow-instance', 'user', 'shared-user-v2');
  flowStore.useFlowStore.setState({ nodes: [first], edges: [] });
  studioStore.useStudioStore.getState().ensureWorkflowTabs();
  const firstWorkflowId = studioStore.useStudioStore.getState().activeWorkflowTabId;
  studioStore.useStudioStore.getState().saveActiveWorkflowTab(true);

  const secondWorkflowId = studioStore.useStudioStore.getState().createWorkflowTab('Other open workflow');
  flowStore.useFlowStore.setState({ nodes: [second], edges: [] });
  studioStore.useStudioStore.getState().saveActiveWorkflowTab(true);
  const secondBefore = structuredClone(
    studioStore.useStudioStore.getState().workflowTabs.find(({ id }) => id === secondWorkflowId).snapshot,
  );
  studioStore.useStudioStore.getState().switchWorkflowTab(firstWorkflowId);

  await persistence.persistBlockInstanceV2Choice({ instanceId: first.id, choice: 'update' }, async (candidate) =>
    structuredClone(candidate),
  );

  assert.deepEqual(
    studioStore.useStudioStore.getState().workflowTabs.find(({ id }) => id === secondWorkflowId).snapshot,
    secondBefore,
  );
});

test('the User Node store parses mixed V1/V2 lists and persists only user-owned V2 definitions', async () => {
  const userDefinition = definition('user', 'stored-user-v2');
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (!options.method) return jsonResponse({ blocks: [legacyBlock(), userDefinition] });
    return jsonResponse({ block: JSON.parse(options.body) });
  };

  await userBlockStore.useUserBlockStore.getState().fetchBlocks();
  let state = userBlockStore.useUserBlockStore.getState();
  assert.deepEqual(
    state.blocks.map(({ id }) => id),
    ['legacy-user-block'],
  );
  assert.deepEqual(
    state.blockDefinitionsV2.map(({ definitionId }) => definitionId),
    ['stored-user-v2'],
  );

  const saved = await state.saveBlockDefinitionV2(userDefinition);
  assert.equal(saved.definitionId, 'stored-user-v2');
  assert.equal(JSON.parse(requests.at(-1).options.body).schemaVersion, 2);

  let registeredRequests = 0;
  globalThis.fetch = async () => {
    registeredRequests += 1;
    return jsonResponse({ block: definition() });
  };
  await assert.rejects(state.saveBlockDefinitionV2(definition()), /Registered catalog definitions cannot be saved/);
  assert.equal(registeredRequests, 0);
});
