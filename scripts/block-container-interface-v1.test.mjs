import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { gunzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let schema;
let server;
let fixture, previewFixture;
let runtime, editing, surfaces, persistence, flowStore, drops, connections, interfaceEditing, previewOptions;

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
  editing = await server.ssrLoadModule('/src/studio/blockContainerEditingV1.ts');
  surfaces = await server.ssrLoadModule('/src/studio/blockContainerInterfaceV1.ts');
  persistence = await server.ssrLoadModule('/src/studio/blockDefinitionPersistenceV2.ts');
  flowStore = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  drops = await server.ssrLoadModule('/src/studio/blockDropTargetsV2.ts');
  connections = await server.ssrLoadModule('/src/studio/blockControlConnectionsV2.ts');
  interfaceEditing = await server.ssrLoadModule('/src/studio/blockInterfaceEditingV2.ts');
  previewOptions = await server.ssrLoadModule('/src/studio/blockPreviewOptionsV2.ts');
  fixture = JSON.parse(
    await readFile(path.join(ROOT, '../MoDiff/tests/fixtures/block_container_interface_v1.json'), 'utf8'),
  );
  previewFixture = JSON.parse(
    await readFile(path.join(ROOT, '../MoDiff/tests/fixtures/block_container_previews_v1.json'), 'utf8'),
  );
});

function instance(definition = fixture) {
  return schema.createBlockInstanceV2(definition, {
    instanceId: 'nested-instance',
    position: { x: 0, y: 0 },
    size: { width: 400, height: 320 },
    expanded: true,
  });
}
function project(current) {
  return runtime.materializeBlockProjectionV2(
    runtime.createBlockRootNodeV2(
      runtime.setBlockPresentationV2(current, { expanded: true, collapsedContainerNodeIds: ['stage'] }),
    ),
  );
}
function semanticNode(current, id) {
  return current.effectiveGraph.nodes.find((node) => node.nodeId === id);
}
function local(current) {
  return semanticNode(current, 'stage').containerInterface;
}
function loadStore(current) {
  flowStore.useFlowStore.setState(project(current));
  flowStore.useFlowStore.getState().resetHistory();
  return flowStore.useFlowStore.getState;
}
function handle(node, direction, fieldId) {
  return (
    Object.entries(node.data.blockProjectionPortBindings ?? {}).find(
      ([, binding]) => binding.direction === direction && binding.fieldOrPortId === fieldId,
    )?.[0] ?? fieldId
  );
}

test('configuring a container changes only its declaration and not root ports, parameters or sibling nodes', () => {
  const current = instance();
  const draft = structuredClone(local(current));
  draft.controls[0].label = 'Complex scene';
  const next = editing.configureBlockContainerInterfaceV1(current, 'stage', draft);
  assert.deepEqual(next.effectiveInterface, current.effectiveInterface);
  assert.deepEqual(next.values, current.values);
  assert.deepEqual(semanticNode(next, 'generate'), semanticNode(current, 'generate'));
  assert.deepEqual(semanticNode(next, 'sibling'), semanticNode(current, 'sibling'));
  assert.equal(local(next).controls[0].label, 'Complex scene');
  assert.deepEqual(editing.configureBlockContainerInterfaceV1(next, 'stage', local(next)), next);
});

function publicPromptFixture() {
  const definition = structuredClone(fixture);
  definition.boundary.inputs = structuredClone(definition.graph.nodes[0].containerInterface.boundary.inputs);
  definition.controls = [
    { ...structuredClone(definition.graph.nodes[0].containerInterface.controls[0]), defaultValue: 'saved fallback' },
  ];
  return instance(rehash(definition));
}

test('shared nested previews have canonical hashes and one root-owned inventory with independent surface selection', () => {
  assert.equal(schema.blockGraphHashV2(previewFixture.graph), 'block-graph-v2-10f27c84');
  assert.equal(schema.blockDefinitionContentHashV2(previewFixture), 'block-definition-v2-16703f94');
  assert.deepEqual(schema.normalizeBlockDefinitionV2(previewFixture), previewFixture);
  let current = instance(previewFixture);
  assert.deepEqual(current.previewStates, [
    { binding: previewFixture.previews[0], status: 'idle' },
    { binding: { nodeId: 'caption', outputPortId: 'text', mediaType: 'text' }, status: 'idle' },
  ]);
  current = runtime.setBlockPreviewStateV2(
    current,
    { nodeId: 'caption', outputPortId: 'text' },
    { mediaReference: 'A detailed captured caption', taskId: 'nested-run', status: 'complete' },
  );
  current = runtime.setBlockPreviewStateV2(
    current,
    { nodeId: 'generate', outputPortId: 'images' },
    { mediaReference: '/data/nested-image.webp', taskId: 'nested-run', status: 'complete' },
  );
  assert.equal(runtime.blockPreviewViewsV2(current).length, 1, 'root keeps only its own selected previews');
  const rootView = runtime.blockPreviewViewsV2(current)[0];
  assert.equal(Object.values(rootView.params)[0].value, '/data/nested-image.webp');
  const projected = project(current);
  const stage = projected.nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  const localPreviews = Object.values(stage.data.params).filter((field) => field.fieldOptions?.blockPreviewBindingV2);
  assert.equal(localPreviews.length, 2);
  assert.deepEqual(
    localPreviews.map((field) => field.value),
    ['/data/nested-image.webp', 'A detailed captured caption'],
  );
  assert.equal(current.previewStates.length, 2, 'shared root/local image never duplicates runtime state');
  assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(current))), current);
  const edited = editing.configureBlockContainerInterfaceV1(current, 'stage', {
    boundary: local(current).boundary,
    controls: local(current).controls,
  });
  assert.deepEqual(local(edited).previews, local(current).previews);
  assert.deepEqual(edited.previewStates, current.previewStates);
  const saved = persistence.reusableBlockDefinitionFromSubtreeV2(current, {
    rootNodeId: 'stage',
    definitionId: 'user:nested-preview-saved',
    displayName: 'My image and caption',
  });
  assert.deepEqual(saved.previews, local(current).previews);
  const reused = instance(saved);
  assert.equal(reused.previewStates.length, 2);
  assert.equal(reused.previewStates[1].binding.primary, true, 'the saved subtree promotes its own primary selection');
  assert.ok(
    reused.previewStates.every((state) => !state.mediaReference),
    'saving a definition does not publish/copy run state',
  );
});

test('Configure Interface explicitly selects, reorders and removes local previews without changing root output or inputs', () => {
  let current = instance(previewFixture);
  current = runtime.setBlockPreviewStateV2(
    current,
    { nodeId: 'caption', outputPortId: 'text' },
    {
      mediaReference: 'The actual caption',
      taskId: 'preview-edit-proof',
      status: 'complete',
    },
  );
  const draft = interfaceEditing.blockInterfaceDraftV2(current, 'stage');
  assert.deepEqual(draft.previews, local(current).previews);
  draft.previews = [
    { nodeId: 'caption', outputPortId: 'text', mediaType: 'text' },
    { nodeId: 'generate', outputPortId: 'images', mediaType: 'image', primary: true },
  ];
  const merged = interfaceEditing.mergeBlockInterfaceDraftV2(current, current, draft, 'stage');
  const next = editing.configureBlockContainerInterfaceV1(current, 'stage', merged);
  assert.deepEqual(local(next).previews, draft.previews);
  assert.deepEqual(next.effectiveInterface, current.effectiveInterface);
  assert.deepEqual(next.values, current.values);
  assert.deepEqual(semanticNode(next, 'generate'), semanticNode(current, 'generate'));
  assert.deepEqual(semanticNode(next, 'sibling'), semanticNode(current, 'sibling'));
  assert.deepEqual(next.previewStates, current.previewStates, 'surface selection never resets shared run state');
  assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(next))), next);
  const saved = persistence.reusableBlockDefinitionFromSubtreeV2(next, {
    rootNodeId: 'stage',
    definitionId: 'user:configured-preview',
    displayName: 'Configured previews',
  });
  assert.deepEqual(saved.previews, draft.previews);
  const cleared = editing.configureBlockContainerInterfaceV1(next, 'stage', { ...merged, previews: [] });
  assert.deepEqual(local(cleared).previews, []);
  assert.deepEqual(cleared.previewStates, current.previewStates.slice(0, 1), 'root-owned image remains available');
  assert.deepEqual(cleared.definitionSnapshot.previews, current.definitionSnapshot.previews);
});

test('preview configuration rejects stale snapshots, out-of-scope targets, duplicates and invalid primary selection', () => {
  const current = instance(previewFixture);
  const draft = interfaceEditing.blockInterfaceDraftV2(current, 'stage');
  for (const previews of [
    [{ nodeId: 'sibling', outputPortId: 'text', mediaType: 'text' }],
    [{ nodeId: 'caption', outputPortId: 'missing', mediaType: 'text' }],
    [{ nodeId: 'generate', outputPortId: 'prompt', mediaType: 'text' }],
    [{ nodeId: 'caption', outputPortId: 'text', mediaType: 'audio' }],
    [local(current).previews[0], local(current).previews[0]],
    local(current).previews.map((preview) => ({ ...preview, primary: true })),
  ]) {
    assert.throws(() => interfaceEditing.mergeBlockInterfaceDraftV2(current, current, { ...draft, previews }, 'stage'));
  }
  const changed = editing.configureBlockContainerInterfaceV1(current, 'stage', { ...draft, previews: [] });
  assert.throws(() => interfaceEditing.mergeBlockInterfaceDraftV2(current, changed, draft, 'stage'), /changed while/);
  const rootDraft = interfaceEditing.blockInterfaceDraftV2(current);
  assert.equal(rootDraft.previews, undefined);
  assert.throws(
    () => interfaceEditing.mergeBlockInterfaceDraftV2(current, current, { ...rootDraft, previews: [] }),
    /root.*preview/i,
  );
  const get = loadStore(current);
  const before = structuredClone(get().nodes);
  assert.throws(
    () => get().configureBlockInterfaceV2(current.instanceId, { ...rootDraft, previews: [] }),
    /root.*preview/i,
  );
  assert.deepEqual(get().nodes, before);
});

test('preview picker offers only schema-valid media outputs in its own subtree, including transported widgets', () => {
  const current = instance(previewFixture);
  assert.deepEqual(
    previewOptions.blockPreviewOptionsV2(current, 'stage').map(({ binding }) => binding),
    [
      { nodeId: 'generate', outputPortId: 'images', mediaType: 'image' },
      { nodeId: 'caption', outputPortId: 'text', mediaType: 'text' },
    ],
  );
  const definition = structuredClone(previewFixture);
  const fields = definition.graph.nodes.find((node) => node.nodeId === 'caption').data.params;
  fields.videoPreview = { display: 'ui_video', type: 'url' };
  fields.audioPreview = { display: 'ui_audio' };
  fields.tensorInput = { display: 'input', type: 'image' };
  fields.numericalOutput = { display: 'output', type: 'float' };
  fields.mismatchedWidget = { display: 'ui_audio', type: 'image' };
  const parsed = instance(rehash(definition));
  const offered = previewOptions.blockPreviewOptionsV2(parsed, 'stage');
  assert.deepEqual(
    offered.map(({ binding }) => binding),
    [
      { nodeId: 'generate', outputPortId: 'images', mediaType: 'image' },
      { nodeId: 'caption', outputPortId: 'text', mediaType: 'text' },
      { nodeId: 'caption', outputPortId: 'videoPreview', mediaType: 'video' },
      { nodeId: 'caption', outputPortId: 'audioPreview', mediaType: 'audio' },
    ],
  );
  assert.equal(new Set(offered.map(({ key }) => key)).size, offered.length);
});

test('preview-bearing structural edits preserve unrelated states and protect retained local bindings', () => {
  const original = instance();
  const complete = runtime.replaceBlockEffectiveGraphV2(original, previewFixture.graph);
  assert.equal(complete.previewStates.length, 2);
  assert.throws(() => runtime.removeBlockEffectiveGraphNodesV2(complete, ['caption']), /internal Block.*preview/);
  const caption = structuredClone(semanticNode(complete, 'caption'));
  caption.nodeId = 'new-caption';
  caption.data.label = 'Replacement caption';
  const replaced = runtime.replaceBlockEffectiveGraphNodeV2(complete, 'caption', caption);
  assert.equal(semanticNode(replaced, 'caption').data.label, 'Replacement caption');
  assert.equal(semanticNode(replaced, 'new-caption'), undefined, 'a protected source retains its identity');
  assert.deepEqual(replaced.previewStates, complete.previewStates);
  const removed = runtime.removeBlockEffectiveGraphNodesV2(complete, ['stage', 'generate', 'caption']);
  assert.deepEqual(removed.previewStates, [], 'removing a whole local surface removes only its local run states');
  assert.deepEqual(
    removed.effectiveGraph.nodes.map((node) => node.nodeId),
    ['sibling'],
  );
  assert.deepEqual(original.previewStates, []);
});

test('invalid local previews and forged inventory entries fail closed', () => {
  for (const mutate of [
    (d) => {
      d.graph.nodes[0].containerInterface.previews[0].nodeId = 'sibling';
    },
    (d) => {
      d.graph.nodes[0].containerInterface.previews[0].outputPortId = 'missing';
    },
    (d) => {
      d.graph.nodes[0].containerInterface.previews[0].mediaType = 'audio';
    },
    (d) => {
      d.graph.nodes[0].containerInterface.previews[0].primary = true;
    },
    (d) => {
      d.graph.nodes[0].containerInterface.previews.push(d.graph.nodes[0].containerInterface.previews[0]);
    },
    (d) => {
      d.previews[0].mediaType = 'text';
    },
    (d) => {
      d.graph.nodes[0].containerInterface.previews[0].value = '/fake-state.webp';
    },
  ]) {
    const d = structuredClone(previewFixture);
    mutate(d);
    assert.throws(() => schema.normalizeBlockDefinitionV2(rehash(d)));
  }
  for (const mutate of [
    (i) => i.previewStates.pop(),
    (i) => i.previewStates.reverse(),
    (i) => {
      i.previewStates[1].binding.primary = true;
    },
    (i) => i.previewStates.push(i.previewStates[0]),
  ]) {
    const current = instance(previewFixture);
    mutate(current);
    assert.throws(() => schema.normalizeBlockInstanceV2(current));
  }
});

test('root and nested controls name internal drivers without changing saved fallbacks', () => {
  const original = publicPromptFixture();
  const graph = structuredClone(original.effectiveGraph);
  graph.edges.push({
    edgeId: 'prompt-wire',
    sourceNodeId: 'sibling',
    sourcePortId: 'text',
    targetNodeId: 'generate',
    targetPortId: 'prompt',
  });
  const current = runtime.replaceBlockEffectiveGraphV2(original, graph);
  const before = JSON.stringify(current);
  for (const expanded of [false, true]) {
    const projection = runtime.materializeBlockProjectionV2(
      runtime.createBlockRootNodeV2(
        runtime.setBlockPresentationV2(current, { expanded, collapsedContainerNodeIds: ['stage'] }),
      ),
    );
    const root = projection.nodes.find((node) => node.id === current.instanceId);
    const rootParams = runtime.blockControlParamsV2(current);
    const rootNotes = connections.blockControlConnectionNotesV2(root, rootParams, projection.nodes, projection.edges);
    assert.match(rootNotes.prompt, /Connected from Sibling.text/);
    assert.match(rootNotes.prompt, /saved fallback, not the connected execution value/);
    assert.equal(rootParams.prompt.value, 'saved fallback');
    const stage = projection.nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
    const localNotes =
      stage && connections.blockControlConnectionNotesV2(stage, stage.data.params, projection.nodes, projection.edges);
    if (expanded) assert.equal(Object.values(localNotes)[0], rootNotes.prompt);
    else assert.equal(stage, undefined);
  }
  assert.equal(JSON.stringify(current), before);
  const disconnected = project(original);
  assert.deepEqual(
    connections.blockControlConnectionNotesV2(
      disconnected.nodes[0],
      runtime.blockControlParamsV2(original),
      disconnected.nodes,
      disconnected.edges,
    ),
    {},
  );
});

test('connected control hints include public drivers and partial mirror targets without evaluating source nodes', () => {
  const definition = structuredClone(publicPromptFixture().definitionSnapshot);
  const second = structuredClone(definition.graph.nodes[1]);
  second.nodeId = 'generate2';
  second.modularDiffusers.placementPath = ['stage', 'generate2'];
  second.modularDiffusers.runtimeRole = 'generate2';
  definition.graph.nodes.push(second);
  definition.graph.executionOrder.push(second.nodeId);
  definition.controls[0].mirrorBindings = [{ nodeId: 'generate2', fieldId: 'prompt' }];
  const current = instance(rehash(definition));
  const projection = project(current);
  const source = {
    id: 'external',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { type: 'custom', label: 'My text', params: { text: { type: 'string', display: 'output' } } },
  };
  const edges = [
    ...projection.edges,
    {
      id: 'external-wire',
      source: source.id,
      sourceHandle: 'text',
      target: current.instanceId,
      targetHandle: 'prompt',
    },
  ];
  const notes = connections.blockControlConnectionNotesV2(
    projection.nodes[0],
    runtime.blockControlParamsV2(current),
    [...projection.nodes, source],
    edges,
  );
  assert.match(notes.prompt, /My text.text/);
  assert.match(notes.prompt, /1 of 2 targets/);
  assert.match(notes.prompt, /remaining targets use the saved fallback/);
  assert.equal(schema.blockInstanceValueV2(current, 'prompt'), 'saved fallback');
});

test('internal and public driver conflicts reject atomically in both insertion directions', () => {
  for (const internalFirst of [false, true]) {
    const current = publicPromptFixture();
    const get = loadStore(current);
    const source = {
      id: 'external',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { type: 'custom', label: 'My text', params: { text: { type: 'string', display: 'output' } } },
    };
    flowStore.useFlowStore.setState({ nodes: [...get().nodes, source] });
    const internal = get().nodes.find((node) => node.data.blockProjectionNodeId === 'sibling');
    const stage = get().nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
    const inside = {
      source: internal.id,
      sourceHandle: 'text',
      target: stage.id,
      targetHandle: handle(stage, 'input', 'prompt'),
    };
    const outside = { source: source.id, sourceHandle: 'text', target: current.instanceId, targetHandle: 'prompt' };
    get().onConnect(internalFirst ? inside : outside);
    const before = JSON.stringify({ nodes: get().nodes, edges: get().edges });
    assert.throws(
      () => get().onConnect(internalFirst ? outside : inside),
      /internal driver|connected public Block input/,
    );
    assert.equal(JSON.stringify({ nodes: get().nodes, edges: get().edges }), before);
  }
});

test('wiring cannot bypass a sealed root or nested control', () => {
  for (const location of ['root', 'local']) {
    const definition = structuredClone(publicPromptFixture().definitionSnapshot);
    (location === 'root' ? definition.controls : definition.graph.nodes[0].containerInterface.controls)[0].sealed =
      true;
    const current = instance(rehash(definition));
    assert.throws(
      () =>
        runtime.assertBlockInternalConnectionV2(
          current,
          { nodeId: 'sibling', fieldOrPortId: 'text' },
          { nodeId: 'generate', fieldOrPortId: 'prompt' },
        ),
      /sealed Block control/,
    );
    const get = loadStore(current);
    const source = {
      id: 'external',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { type: 'custom', params: { text: { type: 'string', display: 'output' } } },
    };
    flowStore.useFlowStore.setState({ nodes: [...get().nodes, source] });
    const before = JSON.stringify(get().edges);
    assert.throws(
      () =>
        get().onConnect({
          source: source.id,
          sourceHandle: 'text',
          target: current.instanceId,
          targetHandle: 'prompt',
        }),
      /sealed Block control/,
    );
    assert.equal(JSON.stringify(get().edges), before);
  }
});

test('local controls edit original fields without replacing ports, nodes, links or other values', () => {
  const current = instance();
  const next = editing.setBlockContainerControlValueV1(
    current,
    'stage',
    'prompt',
    'An intricate glass observatory at dusk',
  );
  assert.equal(semanticNode(next, 'generate').data.params.prompt.value, 'An intricate glass observatory at dusk');
  assert.equal(semanticNode(next, 'generate').data.params.steps.value, 20);
  assert.deepEqual(local(next), local(current));
  assert.deepEqual(next.effectiveInterface, current.effectiveInterface);
  assert.deepEqual(next.values, {});
  assert.deepEqual(semanticNode(next, 'sibling'), semanticNode(current, 'sibling'));
  const actual = structuredClone(next.effectiveGraph);
  actual.nodes.find((node) => node.nodeId === 'generate').data.params.prompt.value = semanticNode(
    current,
    'generate',
  ).data.params.prompt.value;
  actual.graphHash = schema.blockGraphHashV2(actual);
  assert.deepEqual(actual, current.effectiveGraph);
});

test('collapsed declared surfaces expose both ports and current controls without changing execution', () => {
  const current = instance();
  const graph = project(current);
  const stage = graph.nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  assert.ok(stage);
  assert.deepEqual(runtime.blockProjectionConnectionEndpointsV2(stage, handle(stage, 'input', 'prompt'), 'input'), [
    { nodeId: 'generate', fieldOrPortId: 'prompt' },
  ]);
  assert.deepEqual(runtime.blockProjectionConnectionEndpointsV2(stage, handle(stage, 'output', 'images'), 'output'), [
    { nodeId: 'generate', fieldOrPortId: 'images' },
  ]);
  const control = Object.entries(stage.data.params).find(([, field]) => field.fieldOptions?.blockContainerControlV1);
  assert.equal(control?.[1].value, 'a detailed greenhouse');
  const get = loadStore(current);
  get().setParamWithHistory(stage.id, control[0], 'Changed through the normal field editor');
  const updated = get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
  assert.equal(semanticNode(updated, 'generate').data.params.prompt.value, 'Changed through the normal field editor');
  assert.deepEqual(updated.effectiveGraph.edges, current.effectiveGraph.edges);
});

test('declared mirrored sockets connect, reconnect and disconnect as one visible edge without losing ports', () => {
  const definition = structuredClone(fixture);
  const clone = structuredClone(definition.graph.nodes[1]);
  clone.nodeId = 'generate2';
  clone.modularDiffusers.placementPath = ['stage', 'generate2'];
  clone.modularDiffusers.runtimeRole = 'generate2';
  definition.graph.nodes.push(clone);
  definition.graph.executionOrder.push('generate2');
  definition.graph.nodes[0].containerInterface.boundary.inputs[0].mirrorBindings = [
    { nodeId: 'generate2', fieldOrPortId: 'prompt' },
  ];
  definition.graph.nodes[0].containerInterface.controls[0].mirrorBindings = [
    { nodeId: 'generate2', fieldId: 'prompt' },
  ];
  definition.graph.nodes[2].data.params.text2 = { type: 'string', display: 'output' };
  const current = instance(rehash(definition));
  const get = loadStore(current);
  const stage = get().nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  const source = get().nodes.find((node) => node.data.blockProjectionNodeId === 'sibling');
  const conn = {
    source: source.id,
    sourceHandle: 'text',
    target: stage.id,
    targetHandle: handle(stage, 'input', 'prompt'),
  };
  get().onConnect(conn);
  let root = get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
  assert.equal(root.effectiveGraph.edges.length, 2);
  let edges = get().edges.filter((edge) => edge.data?.blockProjectionKind === 'internal');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].data.blockProjectionEdgeIds.length, 2);
  const ids = root.effectiveGraph.edges.map(({ edgeId }) => edgeId).sort();
  get().onReconnect(edges[0], { ...conn, sourceHandle: 'text2' });
  root = get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
  assert.deepEqual(root.effectiveGraph.edges.map(({ edgeId }) => edgeId).sort(), ids);
  assert.ok(root.effectiveGraph.edges.every((edge) => edge.sourcePortId === 'text2'));
  edges = get().edges.filter((edge) => edge.data?.blockProjectionKind === 'internal');
  get().onEdgesChange([{ type: 'remove', id: edges[0].id }]);
  root = get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
  assert.equal(root.effectiveGraph.edges.length, 0);
  assert.deepEqual(local(root), local(current));
  const reloaded = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(root)));
  const reloadedStage = project(reloaded).nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  assert.equal(runtime.blockProjectionConnectionEndpointsV2(reloadedStage, conn.targetHandle, 'input').length, 2);
});

test('connected local port removal is rejected before changing the graph', () => {
  let current = instance();
  current = runtime.replaceBlockEffectiveGraphV2(current, {
    ...current.effectiveGraph,
    edges: [
      {
        edgeId: 'external-input',
        sourceNodeId: 'sibling',
        sourcePortId: 'text',
        targetNodeId: 'generate',
        targetPortId: 'prompt',
      },
    ],
  });
  const draft = structuredClone(local(current));
  draft.boundary.inputs = [];
  assert.equal(editing.blockContainerInterfaceEdgeImpactsV1(current, 'stage', draft).length, 1);
  assert.throws(() => editing.configureBlockContainerInterfaceV1(current, 'stage', draft), /connected edge/);
});

test('new crossing sockets disappear after disconnect and cannot be forged in a grouped receipt', () => {
  const definition = structuredClone(fixture);
  delete definition.graph.nodes[0].containerInterface;
  const current = instance(rehash(definition));
  const connected = runtime.replaceBlockEffectiveGraphV2(current, {
    ...current.effectiveGraph,
    edges: [
      {
        edgeId: 'new-wire',
        sourceNodeId: 'sibling',
        sourcePortId: 'text',
        targetNodeId: 'generate',
        targetPortId: 'prompt',
      },
    ],
  });
  assert.equal(local(connected), undefined, 'connecting must not silently declare a reusable interface');
  const connectedStage = project(connected).nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  assert.ok(handle(connectedStage, 'input', 'prompt'));
  const disconnected = runtime.replaceBlockEffectiveGraphV2(connected, { ...connected.effectiveGraph, edges: [] });
  assert.deepEqual(local(disconnected), local(connected));
  const reloaded = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(disconnected)));
  const stage = project(reloaded).nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  assert.equal(
    Object.values(stage.data.blockProjectionPortBindings ?? {}).some(
      (binding) => binding.direction === 'input' && binding.fieldOrPortId === 'prompt',
    ),
    false,
  );
  const projection = project(connected);
  projection.edges[0].data.blockProjectionEdgeIds = ['new-wire', 'unrelated-wire'];
  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution(projection.nodes, projection.edges),
    /receipt and projected endpoints disagree/,
  );
});

test('local exposure of a shared root control retains one value identity and cannot bypass sealing', () => {
  const definition = structuredClone(fixture);
  definition.controls = [
    {
      ...definition.graph.nodes[0].containerInterface.controls[0],
      mirrorBindings: [{ nodeId: 'sibling', fieldId: 'prompt' }],
      defaultValue: 'shared prompt',
    },
  ];
  const current = instance(rehash(definition));
  const changed = editing.setBlockContainerControlValueV1(current, 'stage', 'prompt', 'updated shared prompt');
  assert.deepEqual(changed.effectiveGraph, current.effectiveGraph);
  assert.deepEqual(changed.values, { prompt: 'updated shared prompt' });
  assert.equal(surfaces.blockContainerFieldValueV1(changed, 'sibling', 'prompt'), 'updated shared prompt');
  definition.controls[0].sealed = true;
  const sealed = instance(rehash(definition));
  assert.throws(() => editing.setBlockContainerControlValueV1(sealed, 'stage', 'prompt', 'bypass'), /sealed/);
});

test('replacement rebases local declarations and deletion explains the declarations that must be rebound', () => {
  const current = instance();
  const replacement = { ...structuredClone(semanticNode(current, 'generate')), nodeId: 'replacement' };
  const next = runtime.replaceBlockEffectiveGraphNodeV2(current, 'generate', replacement);
  assert.equal(local(next).controls[0].binding.nodeId, 'replacement');
  assert.equal(local(next).boundary.inputs[0].binding.nodeId, 'replacement');
  assert.throws(() => runtime.removeBlockEffectiveGraphNodesV2(next, ['replacement']), /internal Block "stage"/);
  const removed = runtime.removeBlockEffectiveGraphNodesV2(next, ['stage', 'replacement']);
  assert.deepEqual(
    removed.effectiveGraph.nodes.map(({ nodeId }) => nodeId),
    ['sibling'],
  );
});

test('saving a configured subtree preserves its exact public surface and edited field values', () => {
  const current = editing.setBlockContainerControlValueV1(
    instance(),
    'stage',
    'prompt',
    'A complex hand-built mechanical planetarium',
  );
  const saved = persistence.reusableBlockDefinitionFromSubtreeV2(current, {
    rootNodeId: 'stage',
    definitionId: 'user:saved-stage',
    displayName: 'My Stage',
  });
  assert.deepEqual(saved.boundary, local(current).boundary);
  assert.equal(saved.controls[0].defaultValue, 'A complex hand-built mechanical planetarium');
  const inserted = instance(saved);
  assert.equal(surfaces.blockContainerFieldValueV1(inserted, 'generate', 'prompt'), saved.controls[0].defaultValue);
  assert.deepEqual(local(inserted), local(current));
});

test('an entire declared subtree is adopted atomically, including forward references to its children', () => {
  const definition = structuredClone(fixture);
  definition.graph.nodes = [definition.graph.nodes[2]];
  definition.graph.executionOrder = ['sibling'];
  const target = instance(rehash(definition));
  const inserted = runtime.addBlockEffectiveGraphSubtreeV2(target, fixture.graph.nodes.slice(0, 2), []);
  assert.deepEqual(local(inserted), fixture.graph.nodes[0].containerInterface);
  assert.equal(inserted.effectiveGraph.nodes.length, 3);
});

test('generic parent ownership round-trips across runtimes without fabricated upstream identity', async () => {
  const definition = JSON.parse(
    await readFile(path.join(ROOT, '../MoDiff/tests/fixtures/block_parent_node_v2.json'), 'utf8'),
  );
  assert.deepEqual(schema.normalizeBlockDefinitionV2(definition), definition);
  assert.equal(schema.blockGraphHashV2(definition.graph), 'block-graph-v2-4e607b61');
  assert.equal(schema.blockDefinitionContentHashV2(definition), 'block-definition-v2-46ad65c1');
  assert.deepEqual(
    [...schema.blockGraphParentIdsV2(definition.graph)],
    [
      ['inner', 'outer'],
      ['leaf', 'inner'],
    ],
  );
  const current = instance(definition);
  assert.deepEqual(current.presentation.collapsedContainerNodeIds, ['inner', 'outer']);
  const saved = persistence.reusableBlockDefinitionFromSubtreeV2(current, {
    rootNodeId: 'inner',
    definitionId: 'user:saved-inner',
    displayName: 'Inner saved',
  });
  assert.equal(saved.graph.nodes.find((n) => n.nodeId === 'inner').parentNodeId, undefined);
  assert.equal(saved.graph.nodes.find((n) => n.nodeId === 'leaf').parentNodeId, 'inner');
  assert.equal(saved.controls[0].defaultValue, 'An intricate botanical observatory');
  assert.ok(saved.graph.nodes.every((n) => !n.modularDiffusers));
  for (const badParent of ['missing', '', null, 42]) {
    const bad = structuredClone(definition);
    bad.graph.nodes[2].parentNodeId = badParent;
    assert.throws(() => schema.normalizeBlockDefinitionV2(rehash(bad)));
  }
  for (const badParent of ['outer', 'inner', 'leaf']) {
    const bad = structuredClone(definition);
    bad.graph.nodes[0].parentNodeId = badParent;
    assert.throws(() => schema.normalizeBlockDefinitionV2(rehash(bad)), /Cyclic|not a container/);
  }
});

test('ordinary palette nodes adopt into the selected internal container atomically, retain values, and undo once', () => {
  const current = runtime.setBlockPresentationV2(instance(), { expanded: true, collapsedContainerNodeIds: [] });
  flowStore.useFlowStore.setState(runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current)));
  const get = flowStore.useFlowStore.getState;
  get().resetHistory();
  const target = get().nodes.find((n) => n.data.blockProjectionNodeId === 'stage');
  const utility = {
    id: 'ordinary-text',
    type: 'custom',
    position: { x: 60, y: 150 },
    data: {
      type: 'custom',
      module: 'modules.Primitive',
      action: 'TextValue',
      params: {
        text: { type: 'string', display: 'text', value: 'Retain my detailed prompt' },
        output: { type: 'string', display: 'output' },
      },
    },
  };
  drops.insertNodeAtBlockTargetV2(utility, target, get(), (n) => get().addNode(n));
  const adopted = get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2;
  const leaf = semanticNode(adopted, utility.id);
  assert.equal(leaf.parentNodeId, 'stage');
  assert.equal(leaf.modularDiffusers, undefined);
  assert.deepEqual(leaf.data, utility.data);
  assert.deepEqual(adopted.values, current.values);
  assert.deepEqual(adopted.effectiveInterface, current.effectiveInterface);
  assert.deepEqual(adopted.effectiveGraph.edges, current.effectiveGraph.edges);
  const saved = persistence.reusableBlockDefinitionFromSubtreeV2(adopted, {
    rootNodeId: 'stage',
    definitionId: 'user:with-utility',
    displayName: 'Stage with utility',
  });
  assert.equal(
    saved.graph.nodes.find((n) => n.nodeId === utility.id).data.params.text.value,
    'Retain my detailed prompt',
  );
  assert.equal(get().historyPast.length, 1);
  get().undo();
  assert.ok(!get().nodes.some((n) => n.id === utility.id || n.data.blockProjectionNodeId === utility.id));
  get().redo();
  assert.equal(
    get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2.effectiveGraph.graphHash,
    adopted.effectiveGraph.graphHash,
  );
  const replacement = { ...leaf, nodeId: 'replacement-text' };
  delete replacement.parentNodeId;
  const replaced = runtime.replaceBlockEffectiveGraphNodeV2(adopted, utility.id, replacement);
  assert.equal(semanticNode(replaced, 'replacement-text').parentNodeId, 'stage');
  assert.throws(() => runtime.removeBlockEffectiveGraphNodesV2(adopted, ['stage']), /child ordinary-text/);
  const before = JSON.stringify(get().nodes);
  assert.throws(() =>
    drops.insertNodeAtBlockTargetV2({ ...utility, id: 'bad-node', type: 'unsupported' }, target, get(), (n) =>
      get().addNode(n),
    ),
  );
  assert.equal(JSON.stringify(get().nodes), before);
});

test('drop targeting uses the deepest visible parent in absolute graph coordinates', () => {
  const current = runtime.setBlockPresentationV2(instance(), {
    expanded: true,
    collapsedContainerNodeIds: [],
    position: { x: 100, y: 200 },
  });
  const nodes = runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current)).nodes;
  const root = nodes[0];
  const stage = nodes.find((n) => n.data.blockProjectionNodeId === 'stage');
  const point = { x: root.position.x + stage.position.x + 4, y: root.position.y + stage.position.y + 4 };
  assert.equal(drops.expandedBlockV2AtPosition(nodes, point).id, stage.id);
  stage.data.blockProjectionContainerExpanded = false;
  assert.equal(drops.expandedBlockV2AtPosition(nodes, point).id, root.id);
  assert.equal(drops.expandedBlockV2AtPosition(nodes, { x: -100, y: -100 }), null);
});

test('saved User subtrees with ordinary descendants retain current controls and interfaces when nested again', async () => {
  const definition = JSON.parse(
    await readFile(path.join(ROOT, '../MoDiff/tests/fixtures/block_parent_node_v2.json'), 'utf8'),
  );
  const saved = persistence.reusableBlockDefinitionFromSubtreeV2(instance(definition), {
    rootNodeId: 'inner',
    definitionId: 'user:inner-reusable',
    displayName: 'Inner reusable',
  });
  const fragment = runtime.setBlockInstanceValueV2(
    schema.createBlockInstanceV2(saved, {
      instanceId: 'saved-fragment',
      position: { x: 60, y: 100 },
      size: { width: 400, height: 320 },
    }),
    'text',
    'An updated, intricate observatory with brass doors',
  );
  const current = runtime.setBlockPresentationV2(instance(), { expanded: true, collapsedContainerNodeIds: [] });
  flowStore.useFlowStore.setState(runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current)));
  const get = flowStore.useFlowStore.getState;
  get().resetHistory();
  const target = get().nodes.find((n) => n.data.blockProjectionNodeId === 'stage');
  drops.insertNodeAtBlockTargetV2(runtime.createBlockRootNodeV2(fragment), target, get(), (n) => get().addNode(n));
  const adopted = get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2;
  const originalIds = new Set(current.effectiveGraph.nodes.map((n) => n.nodeId));
  const added = adopted.effectiveGraph.nodes.filter((n) => !originalIds.has(n.nodeId));
  assert.equal(added.length, 2);
  const group = added.find((n) => n.nodeType === 'group');
  const text = added.find((n) => n.nodeType === 'custom');
  assert.equal(group.parentNodeId, 'stage');
  assert.equal(text.parentNodeId, group.nodeId);
  assert.equal(text.data.params.text.value, 'An updated, intricate observatory with brass doors');
  assert.ok(added.every((n) => !n.modularDiffusers));
  assert.equal(group.containerInterface.controls[0].binding.nodeId, text.nodeId);
  assert.equal(group.containerInterface.controls[0].defaultValue, undefined);
  assert.deepEqual(adopted.values, current.values);
  assert.deepEqual(adopted.effectiveInterface, current.effectiveInterface);
  assert.equal(get().historyPast.length, 1);
  const reusable = persistence.reusableBlockDefinitionFromSubtreeV2(adopted, {
    rootNodeId: group.nodeId,
    definitionId: 'user:copied-again',
    displayName: 'Copied again',
  });
  assert.equal(reusable.controls[0].defaultValue, 'An updated, intricate observatory with brass doors');
  assert.equal(reusable.graph.nodes.find((n) => n.nodeId === group.nodeId).parentNodeId, undefined);
});

test('whole multi-root Blocks nest atomically with public values, local previews, layout and completed media intact', () => {
  const definition = structuredClone(previewFixture);
  const originalSurface = definition.graph.nodes[0].containerInterface;
  definition.boundary = structuredClone(originalSurface.boundary);
  definition.controls = [{ ...structuredClone(originalSurface.controls[0]), defaultValue: 'Creator scene' }];
  let fragment = schema.createBlockInstanceV2(rehash(definition), {
    instanceId: 'whole-fragment',
    position: { x: 500, y: 800 },
    size: { width: 720, height: 620 },
    values: { prompt: 'A complex observatory with brass doors and a stained-glass roof' },
  });
  fragment = runtime.setBlockPresentationV2(fragment, {
    internalLayout: {
      stage: { x: 100, y: 100 },
      generate: { x: 125, y: 180 },
      sibling: { x: 700, y: 100 },
      caption: { x: 125, y: 300 },
    },
  });
  fragment = runtime.setBlockPreviewStateV2(
    fragment,
    { nodeId: 'generate', outputPortId: 'images' },
    {
      status: 'complete',
      mediaReference: '/data/completed-observatory.webp',
      taskId: 'completed-task',
    },
  );
  fragment = runtime.setBlockPreviewStateV2(
    fragment,
    { nodeId: 'caption', outputPortId: 'text' },
    {
      status: 'running',
      taskId: 'in-flight-task',
    },
  );
  const before = structuredClone(fragment);
  const current = runtime.setBlockPresentationV2(instance(), { expanded: true, collapsedContainerNodeIds: [] });
  flowStore.useFlowStore.setState(runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current)));
  const get = flowStore.useFlowStore.getState;
  get().resetHistory();
  drops.insertNodeAtBlockTargetV2(runtime.createBlockRootNodeV2(fragment), get().nodes[0], get(), (n) =>
    get().addNode(n),
  );
  const adopted = get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2;
  const added = adopted.effectiveGraph.nodes.filter(
    (n) => !current.effectiveGraph.nodes.some((old) => old.nodeId === n.nodeId),
  );
  assert.equal(added.length, fragment.effectiveGraph.nodes.length + 1);
  const wrapper = added.find((n) => n.nodeType === 'group' && !n.modularDiffusers);
  const stage = added.find((n) => n.modularDiffusers?.blockClass === 'ExampleStage');
  const generate = added.find((n) => n.data.action === 'Generate');
  const caption = added.find((n) => n.data.label === 'Caption');
  assert.equal(stage.parentNodeId, wrapper.nodeId);
  assert.equal(generate.parentNodeId, stage.nodeId);
  assert.equal(generate.data.params.prompt.value, before.values.prompt);
  assert.equal(wrapper.containerInterface.controls[0].defaultValue, undefined);
  assert.equal(wrapper.containerInterface.controls[0].binding.nodeId, generate.nodeId);
  assert.equal(stage.containerInterface.previews[1].nodeId, caption.nodeId);
  assert.deepEqual(adopted.values, current.values);
  assert.deepEqual(adopted.effectiveInterface, current.effectiveInterface);
  assert.deepEqual(fragment, before);
  assert.equal(adopted.presentation.internalLayoutMode, 'hierarchical');
  assert.deepEqual(adopted.presentation.internalLayout[generate.nodeId], { x: 25, y: 80 });
  assert.ok(adopted.presentation.collapsedContainerNodeIds.includes(wrapper.nodeId));
  const complete = adopted.previewStates.find((p) => p.binding.nodeId === generate.nodeId);
  assert.equal(complete.mediaReference, '/data/completed-observatory.webp');
  assert.equal(complete.taskId, 'completed-task');
  assert.equal(adopted.previewStates.find((p) => p.binding.nodeId === caption.nodeId).status, 'idle');
  assert.equal(
    get().nodes.some((n) => n.id === fragment.instanceId),
    false,
  );
  assert.equal(get().nodes.filter((n) => n.data.blockInstanceV2).length, 1, 'one execution/value authority');
  assert.equal(get().historyPast.length, 1);
  const restored = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(adopted)));
  assert.deepEqual(restored, adopted);
  const view = runtime.blockContainerPreviewViewsV2(restored, wrapper.nodeId);
  assert.equal(Object.values(view[0].params)[0].value, complete.mediaReference);
  const saved = persistence.reusableBlockDefinitionFromSubtreeV2(restored, {
    rootNodeId: wrapper.nodeId,
    definitionId: 'user:whole-reusable',
    displayName: 'Whole reusable',
  });
  assert.equal(saved.controls[0].defaultValue, before.values.prompt);
  assert.equal(saved.previews[0].nodeId, generate.nodeId);
  assert.ok(
    !JSON.stringify(saved).includes('completed-observatory'),
    'a reusable definition does not bake transient run media',
  );
  get().undo();
  assert.deepEqual(get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2, current);
  get().redo();
  assert.equal(
    get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2.effectiveGraph.graphHash,
    adopted.effectiveGraph.graphHash,
  );
});

test('nested Run targets every local terminal, includes dependencies, and excludes unrelated siblings', () => {
  const current = instance(previewFixture);
  const get = loadStore(current);
  const stage = get().nodes.find((n) => n.data.blockProjectionNodeId === 'stage');
  const targets = flowStore.resolveFlowExecutionTargetNodeIds(get().nodes, stage.id);
  assert.deepEqual(
    new Set(targets),
    new Set(['generate', 'caption'].map((id) => runtime.blockProjectionNodeIdV2(current.instanceId, id))),
  );
  const exported = get().exportGraph('nested-run', stage.id);
  assert.deepEqual(new Set(Object.keys(exported.nodes)), new Set(targets));
  assert.equal(exported.paths.length, 2);
  assert.ok(!Object.keys(exported.nodes).some((id) => id.endsWith('sibling')));
  get().setBlockPreviewStateV2(
    current.instanceId,
    { nodeId: 'caption', outputPortId: 'text' },
    {
      mediaReference: 'Caption arrived without reprojecting',
      status: 'complete',
      taskId: 'local-task',
    },
  );
  assert.equal(
    get().nodes.find((n) => n.id === stage.id),
    stage,
    'run updates do not rebuild canvas nodes',
  );
  const views = runtime.blockContainerPreviewViewsV2(get().nodes[0].data.blockInstanceV2, 'stage');
  assert.equal(Object.values(views[1].params)[0].value, 'Caption arrived without reprojecting');
});

test('an empty generic container stays expandable and accepts an ordinary node without upstream metadata', async () => {
  const definition = JSON.parse(
    await readFile(path.join(ROOT, '../MoDiff/tests/fixtures/block_parent_node_v2.json'), 'utf8'),
  );
  definition.graph.nodes = definition.graph.nodes.slice(0, 2);
  definition.graph.executionOrder = ['outer', 'inner'];
  delete definition.graph.nodes[1].containerInterface;
  const current = runtime.setBlockPresentationV2(instance(rehash(definition)), {
    expanded: true,
    collapsedContainerNodeIds: ['inner'],
  });
  assert.deepEqual(schema.blockModularContainerNodeIdsV2(current.effectiveGraph), ['inner', 'outer']);
  flowStore.useFlowStore.setState(runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current)));
  const get = flowStore.useFlowStore.getState;
  const id = runtime.blockProjectionNodeIdV2(current.instanceId, 'inner');
  assert.equal(get().nodes.find((n) => n.id === id).data.blockProjectionChildCount, 0);
  assert.equal(get().nodes.find((n) => n.id === id).data.blockProjectionContainer, true);
  get().setBlockPresentationV2(current.instanceId, { collapsedContainerNodeIds: [] });
  get().resetHistory();
  const utility = {
    id: 'empty-host-text',
    type: 'custom',
    position: { x: 80, y: 100 },
    data: {
      type: 'custom',
      module: 'modules.Primitive',
      action: 'TextValue',
      params: {
        text: { type: 'string', value: 'Retain the empty container' },
        output: { type: 'string', display: 'output' },
      },
    },
  };
  drops.insertNodeAtBlockTargetV2(
    utility,
    get().nodes.find((n) => n.id === id),
    get(),
    (n) => get().addNode(n),
  );
  const adopted = get().nodes[0].data.blockInstanceV2;
  assert.equal(semanticNode(adopted, utility.id).parentNodeId, 'inner');
  assert.equal(semanticNode(adopted, utility.id).modularDiffusers, undefined);
  assert.equal(get().historyPast.length, 1);
  get().undo();
  get().ensureBlockProjectionV2(current.instanceId);
  assert.equal(get().nodes.find((n) => n.id === id).data.blockProjectionContainer, true);
  assert.equal(get().nodes.find((n) => n.id === id).data.blockProjectionChildCount, 0);
});

test('deeper collapsed Blocks inherit the nearest local controls and sockets after whole-Block nesting', () => {
  const definition = structuredClone(fixture);
  const stage = definition.graph.nodes[0];
  const surface = stage.containerInterface;
  delete stage.containerInterface;
  stage.parentNodeId = 'wrapper';
  definition.graph.nodes.unshift({
    nodeId: 'wrapper',
    nodeType: 'group',
    data: { type: 'group', label: 'Nested whole Block', params: {} },
    containerInterface: surface,
  });
  definition.graph.executionOrder.unshift('wrapper');
  const current = instance(rehash(definition));
  const get = loadStore(current);
  const projected = get().nodes.find((n) => n.data.blockProjectionNodeId === 'stage');
  const [key, control] = Object.entries(projected.data.params).find(
    ([, p]) => p.fieldOptions?.blockContainerControlV1?.controlId === 'prompt',
  );
  assert.equal(control.value, 'a detailed greenhouse');
  assert.equal(control.label, 'Scene');
  assert.ok(
    Object.values(projected.data.blockProjectionPortBindings).some(
      (b) => b.nodeId === 'generate' && b.fieldOrPortId === 'prompt',
    ),
  );
  const before = current.effectiveGraph;
  get().setParamWithHistory(projected.id, key, 'A complex nested observatory with copper and brass details');
  const edited = get().nodes[0].data.blockInstanceV2;
  assert.equal(
    semanticNode(edited, 'generate').data.params.prompt.value,
    'A complex nested observatory with copper and brass details',
  );
  assert.deepEqual(
    semanticNode(edited, 'sibling'),
    before.nodes.find((n) => n.nodeId === 'sibling'),
  );
  assert.deepEqual(semanticNode(edited, 'wrapper').containerInterface, surface);
  assert.equal(
    semanticNode(edited, 'stage').containerInterface,
    undefined,
    'editing a value does not invent a new local interface',
  );
  assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(edited))), edited);
});

test('inherited fan-out is one socket and one connection gesture on a deeper collapsed Block', () => {
  for (const declarationOwner of ['root', 'wrapper']) {
    const definition = structuredClone(fixture);
    const stage = definition.graph.nodes[0];
    const surface = stage.containerInterface;
    delete stage.containerInterface;
    const second = structuredClone(definition.graph.nodes[1]);
    second.nodeId = 'generate2';
    second.modularDiffusers.placementPath = ['stage', 'generate2'];
    second.modularDiffusers.runtimeRole = 'generate2';
    definition.graph.nodes.push(second);
    definition.graph.executionOrder.push('generate2');
    surface.boundary.inputs[0].mirrorBindings = [{ nodeId: 'generate2', fieldOrPortId: 'prompt' }];
    surface.controls[0].mirrorBindings = [{ nodeId: 'generate2', fieldId: 'prompt' }];
    if (declarationOwner === 'root') {
      definition.boundary = surface.boundary;
      definition.controls = surface.controls;
    } else {
      stage.parentNodeId = 'wrapper';
      definition.graph.nodes.unshift({
        nodeId: 'wrapper',
        nodeType: 'group',
        data: { type: 'group', label: 'Wrapper', params: {} },
        containerInterface: surface,
      });
      definition.graph.executionOrder.unshift('wrapper');
    }
    const current = instance(rehash(definition));
    const derived = surfaces.blockContainerInterfaceV1(current, 'stage');
    assert.equal(derived.boundary.inputs.length, 1, declarationOwner);
    assert.equal(derived.boundary.inputs[0].mirrorBindings.length, 1);
    assert.equal(derived.boundary.inputs[0].label, 'Scene');
    const get = loadStore(current);
    const projected = get().nodes.find((n) => n.data.blockProjectionNodeId === 'stage');
    const inputs = Object.entries(projected.data.blockProjectionPortBindings).filter(
      ([, b]) => b.direction === 'input',
    );
    assert.equal(inputs.length, 1, declarationOwner);
    assert.equal(projected.data.params[inputs[0][0]].label, 'Scene');
    assert.equal(runtime.blockProjectionConnectionEndpointsV2(projected, inputs[0][0], 'input').length, 2);
    const source = get().nodes.find((n) => n.data.blockProjectionNodeId === 'sibling');
    get().onConnect({ source: source.id, sourceHandle: 'text', target: projected.id, targetHandle: inputs[0][0] });
    const edited = get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2;
    assert.equal(edited.effectiveGraph.edges.length, 2);
    assert.equal(get().edges.filter((e) => e.data?.blockProjectionKind === 'internal').length, 1);
    assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(edited))), edited);
  }
});

test('imported conflicting or sealed input drivers fail execution instead of silently choosing the first wire', () => {
  let current = publicPromptFixture();
  const graph = structuredClone(current.effectiveGraph);
  graph.edges.push({
    edgeId: 'internal-driver',
    sourceNodeId: 'sibling',
    sourcePortId: 'text',
    targetNodeId: 'generate',
    targetPortId: 'prompt',
  });
  current = runtime.replaceBlockEffectiveGraphV2(current, graph);
  const external = {
    id: 'external-driver',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      label: 'External source',
      module: 'modules.Primitive',
      action: 'TextValue',
      params: { text: { type: 'string', value: 'another scene' }, output: { type: 'string', display: 'output' } },
    },
  };
  for (const expanded of [false, true]) {
    const root = runtime.createBlockRootNodeV2(runtime.setBlockPresentationV2(current, { expanded }));
    const projected = runtime.materializeBlockProjectionV2(root);
    const edges = [
      ...projected.edges,
      { id: 'public-driver', source: external.id, sourceHandle: 'output', target: root.id, targetHandle: 'prompt' },
    ];
    assert.throws(
      () => runtime.expandBlockGraphV2ForExecution([...projected.nodes, external], edges),
      /both drive the same field/,
    );
  }
  const duplicate = structuredClone(graph);
  duplicate.edges.push({ ...duplicate.edges[0], edgeId: 'duplicate-driver' });
  const conflicting = runtime.replaceBlockEffectiveGraphV2(current, duplicate);
  assert.throws(
    () => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(conflicting)], []),
    /both drive the same field/,
  );
  for (const declarationOwner of ['root', 'stage']) {
    const definition = structuredClone(fixture);
    const control = definition.graph.nodes[0].containerInterface.controls[0];
    control.sealed = true;
    if (declarationOwner === 'root') {
      definition.controls = [structuredClone(control)];
      definition.graph.nodes[0].containerInterface.controls[0].sealed = false;
    }
    const sealed = runtime.replaceBlockEffectiveGraphV2(instance(rehash(definition)), graph);
    // Put the declaration on the actual effective graph too, as a saved import would.
    if (declarationOwner === 'stage') sealed.effectiveGraph.nodes[0].containerInterface.controls[0].sealed = true;
    sealed.effectiveGraph.graphHash = schema.blockGraphHashV2(sealed.effectiveGraph);
    sealed.customization.effectiveGraphHash = sealed.effectiveGraph.graphHash;
    assert.throws(
      () => runtime.expandBlockGraphV2ForExecution([runtime.createBlockRootNodeV2(sealed)], []),
      /sealed Block control/,
    );
  }
});

test('ordinary internal reparenting preserves fields, links, IDs and local values with one Undo', () => {
  const definition = structuredClone(fixture);
  definition.graph.nodes.push({
    nodeId: 'empty-user-stage',
    nodeType: 'group',
    data: { type: 'group', label: 'Empty user stage', params: {} },
  });
  definition.graph.executionOrder.push('empty-user-stage');
  const current = runtime.setBlockPresentationV2(instance(rehash(definition)), {
    expanded: true,
    collapsedContainerNodeIds: [],
  });
  const get = loadStore(current);
  get().setBlockPresentationV2(current.instanceId, { collapsedContainerNodeIds: [] });
  get().resetHistory();
  const projectedId = runtime.blockProjectionNodeIdV2(current.instanceId, 'sibling');
  const before = get().exportGraph('reparent');
  get().reparentNodeInBlockV2(projectedId, 'empty-user-stage', { x: 680, y: 420 });
  let updated = get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
  assert.equal(semanticNode(updated, 'sibling').parentNodeId, 'empty-user-stage');
  assert.deepEqual(semanticNode(updated, 'sibling').data, semanticNode(current, 'sibling').data);
  assert.deepEqual(updated.effectiveGraph.edges, current.effectiveGraph.edges);
  assert.deepEqual(updated.values, current.values);
  assert.deepEqual(get().exportGraph('reparent'), before);
  assert.equal(get().historyPast.length, 1);
  assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(updated))), updated);
  get().undo();
  get().ensureBlockProjectionV2(current.instanceId);
  assert.equal(semanticNode(get().nodes[0].data.blockInstanceV2, 'sibling').parentNodeId, undefined);
  get().redo();
  get().ensureBlockProjectionV2(current.instanceId);
  get().reparentNodeInBlockV2(projectedId, undefined, { x: 620, y: 400 });
  updated = get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
  assert.equal(semanticNode(updated, 'sibling').parentNodeId, undefined);
  assert.deepEqual(get().exportGraph('reparent'), before);
});

test('internal reparenting rejects cycles and transfers local field ownership without changing the original', async () => {
  const { reparentOrdinaryBlockNodeV2 } = await server.ssrLoadModule('/src/studio/blockReparentingV2.ts');
  const definition = JSON.parse(
    await readFile(path.join(ROOT, '../MoDiff/tests/fixtures/block_parent_node_v2.json'), 'utf8'),
  );
  const current = instance(definition);
  const before = JSON.stringify(current);
  assert.throws(
    () => reparentOrdinaryBlockNodeV2(current, 'outer', 'inner', { x: 20, y: 70 }),
    /itself or its descendants/,
  );
  const leaf = current.effectiveGraph.nodes.find((node) => node.parentNodeId === 'inner');
  const moved = reparentOrdinaryBlockNodeV2(current, leaf.nodeId, undefined, { x: 20, y: 70 });
  assert.equal(schema.blockGraphParentIdsV2(moved.effectiveGraph).has(leaf.nodeId), false);
  assert.deepEqual(moved.definitionSnapshot, current.definitionSnapshot);
  assert.equal(
    moved.effectiveGraph.nodes.find((node) => node.nodeId === 'inner').containerInterface.controls.length,
    0,
  );
  assert.equal(JSON.stringify(current), before);
});

test('moving a whole internal subtree out retains its fields, local interfaces and completed previews without a library write', () => {
  let current = instance(previewFixture);
  current = runtime.setBlockPreviewStateV2(
    current,
    { nodeId: 'caption', outputPortId: 'text' },
    {
      status: 'complete',
      mediaReference: 'saved-caption-reference',
      taskId: 'completed-subtree-task',
    },
  );
  // This local-only preview is movable; root-owned outputs remain protected.
  const definition = structuredClone(current.definitionSnapshot);
  definition.previews = [];
  current = instance(rehash(definition));
  current = runtime.setBlockPreviewStateV2(
    current,
    { nodeId: 'caption', outputPortId: 'text' },
    {
      status: 'complete',
      mediaReference: 'saved-caption-reference',
      taskId: 'completed-subtree-task',
    },
  );
  const get = loadStore(current);
  const before = JSON.stringify(current);
  const beforeStored = structuredClone(get().nodes[0].data.blockInstanceV2);
  const id = get().moveNodeOutOfBlockV2(runtime.blockProjectionNodeIdV2(current.instanceId, 'stage'), {
    x: 900,
    y: 80,
  });
  const detached = get().nodes.find((node) => node.id === id).data.blockInstanceV2;
  const retained = get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
  assert.equal(detached.definitionSnapshot.source.kind, 'user');
  assert.equal(detached.presentation.expanded, false);
  assert.equal(detached.effectiveGraph.nodes.length, 3);
  assert.deepEqual(
    detached.effectiveGraph.nodes.find((node) => node.nodeId === 'stage').containerInterface,
    local(current),
  );
  assert.deepEqual(
    detached.previewStates.find(({ binding }) => binding.nodeId === 'caption'),
    {
      binding: { nodeId: 'caption', outputPortId: 'text', mediaType: 'text', primary: true },
      status: 'complete',
      mediaReference: 'saved-caption-reference',
      taskId: 'completed-subtree-task',
    },
  );
  assert.deepEqual(
    retained.effectiveGraph.nodes.map(({ nodeId }) => nodeId),
    ['sibling'],
  );
  assert.equal(get().historyPast.length, 1);
  assert.equal(JSON.stringify(current), before);
  assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(detached))), detached);
  get().undo();
  assert.equal(
    get().nodes.some((node) => node.id === id),
    false,
  );
  assert.deepEqual(get().nodes[0].data.blockInstanceV2, beforeStored);
});

test('subtree move-out preserves root previews and undeclared crossing wires and supports Undo', () => {
  for (const previewOwner of [true, false]) {
    const current = previewOwner
      ? instance(previewFixture)
      : runtime.replaceBlockEffectiveGraphV2(instance(), {
          ...instance().effectiveGraph,
          edges: [
            {
              edgeId: 'incoming',
              sourceNodeId: 'sibling',
              sourcePortId: 'text',
              targetNodeId: 'generate',
              targetPortId: 'prompt',
            },
          ],
        });
    const get = loadStore(current);
    const before = structuredClone(get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2);
    const movedId = get().moveNodeOutOfBlockV2(runtime.blockProjectionNodeIdV2(current.instanceId, 'stage'), {
      x: 900,
      y: 80,
    });
    const detached = get().nodes.find((node) => node.id === movedId).data.blockInstanceV2;
    const retained = get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
    assert.deepEqual(retained.definitionSnapshot, current.definitionSnapshot);
    if (previewOwner) {
      assert.ok(detached.previewStates.some((state) => state.binding.nodeId === 'generate'));
      assert.ok(!retained.previewStates.some((state) => state.binding.nodeId === 'generate'));
    } else {
      const expanded = runtime.expandBlockGraphV2ForExecution(get().nodes, get().edges);
      assert.ok(
        expanded.edges.some(
          (edge) =>
            edge.target === runtime.blockProjectionNodeIdV2(movedId, 'generate') && edge.targetHandle === 'prompt',
        ),
      );
    }
    assert.equal(get().historyPast.length, 1);
    get().undo();
    assert.deepEqual(get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2, before);
    assert.ok(!get().nodes.some((node) => node.id === movedId));
  }
});

test('a whole subtree crossing an explicit public input retains the complete mirrored fan-out on detachment', () => {
  for (const mirrored of [false, true]) {
    const definition = structuredClone(fixture);
    const stage = definition.graph.nodes[0];
    definition.boundary.outputs = [
      {
        portId: 'scene',
        label: 'Scene source',
        valueType: 'string',
        required: false,
        binding: { nodeId: 'sibling', fieldOrPortId: 'text' },
      },
    ];
    if (mirrored) {
      const second = structuredClone(definition.graph.nodes[1]);
      second.nodeId = 'generate2';
      second.modularDiffusers.placementPath = ['stage', 'generate2'];
      second.modularDiffusers.runtimeRole = 'generate2';
      definition.graph.nodes.push(second);
      definition.graph.executionOrder.push('generate2');
      stage.containerInterface.boundary.inputs[0].mirrorBindings = [{ nodeId: 'generate2', fieldOrPortId: 'prompt' }];
      stage.containerInterface.controls[0].mirrorBindings = [{ nodeId: 'generate2', fieldId: 'prompt' }];
    }
    const targets = mirrored ? ['generate', 'generate2'] : ['generate'];
    definition.graph.edges = targets.map((target) => ({
      edgeId: `scene-${target}`,
      sourceNodeId: 'sibling',
      sourcePortId: 'text',
      targetNodeId: target,
      targetPortId: 'prompt',
    }));
    const current = instance(rehash(definition));
    const get = loadStore(current);
    const detachedId = get().moveNodeOutOfBlockV2(runtime.blockProjectionNodeIdV2(current.instanceId, 'stage'), {
      x: 900,
      y: 80,
    });
    const wire = get().edges.filter((edge) => edge.source === current.instanceId && edge.target === detachedId);
    assert.equal(wire.length, 1, 'one logical canvas wire carries the exact fan-out');
    const expanded = runtime.expandBlockGraphV2ForExecution(get().nodes, get().edges);
    const promptEdges = expanded.edges.filter((edge) => edge.targetHandle === 'prompt');
    assert.equal(promptEdges.length, targets.length);
    assert.deepEqual(
      new Set(promptEdges.map((edge) => edge.target)),
      new Set(targets.map((target) => runtime.blockProjectionNodeIdV2(detachedId, target))),
    );
    assert.ok(
      promptEdges.every((edge) => edge.source === runtime.blockProjectionNodeIdV2(current.instanceId, 'sibling')),
    );
    get().undo();
    assert.equal(get().nodes.filter((node) => node.data.blockInstanceV2).length, 1);
    get().redo();
    assert.equal(get().nodes.filter((node) => node.data.blockInstanceV2).length, 2);
  }
});

test('automatic frame fitting leaves the original drop boundary unchanged while a projected child is dragged', async () => {
  const current = instance();
  const get = loadStore(current);
  const child = get().nodes.find((node) => node.data.blockProjectionNodeId === 'stage');
  const before = structuredClone(get().nodes.find((node) => node.id === current.instanceId));
  await get().onNodesChange([{ type: 'position', id: child.id, position: { x: 5000, y: 5000 }, dragging: true }]);
  get().fitBlockProjectionToChildrenV2(current.instanceId);
  const root = get().nodes.find((node) => node.id === current.instanceId);
  assert.equal(root.width, before.width);
  assert.equal(root.height, before.height);
  assert.deepEqual(root.data.blockInstanceV2, before.data.blockInstanceV2, 'drag frames do not persist a new layout');
  get().growBlockContainersForDragV2(child.id);
  const grown = get().nodes.find((node) => node.id === current.instanceId);
  assert.ok(grown.width > 5000 && grown.height > 5000);
  assert.deepEqual(
    grown.data.blockInstanceV2,
    before.data.blockInstanceV2,
    'live frame growth does not change membership or durable values',
  );
});

test('ordinary layout drags grow left and up without changing ownership or sibling world positions', async () => {
  const { repositionBlockChildV2 } = await server.ssrLoadModule('/src/studio/blockLayoutDragV2.ts');
  const definition = JSON.parse(
    await readFile(path.join(ROOT, '../MoDiff/tests/fixtures/block_parent_node_v2.json'), 'utf8'),
  );
  const current = instance(definition);
  const parentIds = schema.blockGraphParentIdsV2(current.effectiveGraph);
  const beforeLayouts = runtime.blockRelativeInternalLayoutsV2(current);
  const leaf = current.effectiveGraph.nodes.find((node) => parentIds.get(node.nodeId) === 'inner');
  const moved = repositionBlockChildV2(current, leaf.nodeId, { x: -250, y: -180 });
  const layouts = runtime.blockRelativeInternalLayoutsV2(moved);
  const absolute = (instance, all, id) => {
    const point = { ...instance.presentation.position };
    while (id) {
      point.x += all[id].x;
      point.y += all[id].y;
      id = parentIds.get(id);
    }
    return point;
  };
  assert.deepEqual(moved.effectiveGraph, current.effectiveGraph);
  assert.deepEqual(moved.effectiveInterface, current.effectiveInterface);
  assert.deepEqual(moved.values, current.values);
  assert.ok(layouts[leaf.nodeId].x >= 32 && layouts[leaf.nodeId].y >= 80);
  const expected = absolute(current, { ...beforeLayouts, [leaf.nodeId]: { x: -250, y: -180 } }, leaf.nodeId);
  assert.deepEqual(absolute(moved, layouts, leaf.nodeId), expected);
  for (const node of current.effectiveGraph.nodes) {
    if (node.nodeId === leaf.nodeId || node.nodeType === 'group') continue;
    assert.deepEqual(absolute(moved, layouts, node.nodeId), absolute(current, beforeLayouts, node.nodeId));
  }
});

test('nesting a connected whole Block converts its destination wire and retains third-party wires', () => {
  const destination = publicPromptFixture();
  const definition = structuredClone(fixture);
  definition.graph.nodes = [definition.graph.nodes.find((node) => node.nodeId === 'sibling')];
  definition.graph.executionOrder = ['sibling'];
  definition.boundary.inputs = [
    {
      portId: 'prompt',
      label: 'Text',
      valueType: 'string',
      required: false,
      binding: { nodeId: 'sibling', fieldOrPortId: 'prompt' },
    },
  ];
  definition.boundary.outputs = [
    {
      portId: 'text',
      label: 'Text',
      valueType: 'string',
      required: false,
      binding: { nodeId: 'sibling', fieldOrPortId: 'text' },
    },
  ];
  const fragment = schema.createBlockInstanceV2(rehash(definition), {
    instanceId: 'connected-fragment',
    position: { x: 500, y: 800 },
    size: { width: 400, height: 320 },
  });
  const source = {
    id: 'outside-text',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Primitive',
      action: 'TextValue',
      params: { text: { type: 'string', value: 'outside text' }, output: { type: 'string', display: 'output' } },
    },
  };
  const get = loadStore(destination);
  get().addNode(runtime.createBlockRootNodeV2(fragment));
  get().addNode(source);
  get().onConnect({ source: source.id, sourceHandle: 'output', target: fragment.instanceId, targetHandle: 'prompt' });
  get().onConnect({
    source: fragment.instanceId,
    sourceHandle: 'text',
    target: destination.instanceId,
    targetHandle: 'prompt',
  });
  get().resetHistory();
  get().adoptBlockFragmentIntoBlockV2(fragment.instanceId, destination.instanceId);
  const owner = get().nodes.find((node) => node.id === destination.instanceId).data.blockInstanceV2;
  const moved = owner.effectiveGraph.nodes.find(
    (node) => node.nodeId.startsWith('adopted-') && node.data.action === 'Text',
  );
  assert.ok(moved);
  assert.ok(
    owner.effectiveGraph.edges.some((edge) => edge.sourceNodeId === moved.nodeId && edge.targetNodeId === 'generate'),
  );
  const expanded = runtime.expandBlockGraphV2ForExecution(get().nodes, get().edges);
  assert.ok(
    expanded.edges.some(
      (edge) =>
        edge.source === source.id &&
        edge.target === runtime.blockProjectionNodeIdV2(destination.instanceId, moved.nodeId),
    ),
  );
  assert.deepEqual(owner.effectiveInterface, destination.effectiveInterface);
  get().undo();
  assert.ok(get().nodes.some((node) => node.id === fragment.instanceId));
  get().redo();
  assert.ok(!get().nodes.some((node) => node.id === fragment.instanceId));
});

test('root Run includes every local branch even without a preview and never runs unrelated workflow nodes', () => {
  for (const previews of [previewFixture.previews, []]) {
    const definition = structuredClone(previewFixture);
    definition.previews = previews;
    const current = instance(rehash(definition));
    const get = loadStore(current);
    get().addNode({
      id: 'outside-workflow-node',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        type: 'custom',
        module: 'modules.Test',
        action: 'Text',
        params: { text: { type: 'string', value: 'Unrelated workflow branch' } },
      },
    });
    const exported = get().exportGraph('root-run', current.instanceId);
    assert.equal(Object.keys(exported.nodes).length, 3);
    assert.equal(exported.nodes['outside-workflow-node'], undefined);
    assert.equal(exported.paths.length, 3);
    const representative = flowStore.resolveFlowExecutionTargetNodeId(get().nodes, current.instanceId);
    assert.ok(representative);
    assert.ok(exported.nodes[representative]);
    assert.deepEqual(
      exported,
      (() => {
        get().setBlockPresentationV2(current.instanceId, { expanded: false });
        return get().exportGraph('root-run', current.instanceId);
      })(),
    );
  }
});

test('nested Run excludes disabled children and explains an entirely disabled subtree', () => {
  const definition = structuredClone(previewFixture);
  definition.graph.nodes.find((n) => n.nodeId === 'caption').data.uiState = { disabled: true };
  const current = instance(rehash(definition));
  const get = loadStore(current);
  const stage = get().nodes.find((n) => n.data.blockProjectionNodeId === 'stage');
  assert.deepEqual(flowStore.resolveFlowExecutionTargetNodeIds(get().nodes, stage.id), [
    runtime.blockProjectionNodeIdV2(current.instanceId, 'generate'),
  ]);
  assert.equal(Object.keys(get().exportGraph('disabled-child', stage.id).nodes).length, 1);
  definition.graph.nodes.find((n) => n.nodeId === 'stage').data.uiState = { disabled: true };
  loadStore(instance(rehash(definition)));
  assert.throws(() => get().exportGraph('disabled-stage', stage.id), /no enabled executable terminal/u);
  const workflow = get().exportGraph('disabled-whole-workflow');
  assert.equal(
    Object.keys(workflow.nodes).length,
    1,
    'whole-workflow Run must skip disabled container descendants too',
  );
  assert.ok(workflow.nodes[runtime.blockProjectionNodeIdV2(current.instanceId, 'sibling')]);
});

test('nesting does not overwrite a sole child container with a different local preview or interface selection', () => {
  const definition = structuredClone(previewFixture);
  definition.graph.nodes = definition.graph.nodes.filter((n) => n.nodeId !== 'sibling');
  definition.graph.executionOrder = definition.graph.executionOrder.filter((id) => id !== 'sibling');
  const fragment = schema.createBlockInstanceV2(rehash(definition), {
    instanceId: 'different-local-surface',
    position: { x: 50, y: 100 },
    size: { width: 400, height: 320 },
  });
  const current = instance();
  const get = loadStore(current);
  drops.insertNodeAtBlockTargetV2(runtime.createBlockRootNodeV2(fragment), get().nodes[0], get(), (n) =>
    get().addNode(n),
  );
  const adopted = get().nodes[0].data.blockInstanceV2;
  const added = adopted.effectiveGraph.nodes.filter(
    (n) => !current.effectiveGraph.nodes.some((old) => old.nodeId === n.nodeId),
  );
  assert.equal(added.length, 4);
  const wrapper = added.find((n) => n.nodeType === 'group' && !n.modularDiffusers);
  const stage = added.find((n) => n.modularDiffusers?.blockClass === 'ExampleStage');
  assert.equal(wrapper.containerInterface.previews.length, 1);
  assert.equal(stage.containerInterface.previews.length, 2);
  assert.equal(stage.parentNodeId, wrapper.nodeId);
});

test('local media sockets share file-picker controls without accepting wrong modality or arbitrary strings', () => {
  for (const [media, valueType] of [
    ['image', 'image'],
    ['video', 'video'],
    ['audio', 'audio'],
    ['video', 'list[PIL.Image.Image]'],
  ]) {
    const definition = structuredClone(fixture);
    const [stage, generate] = definition.graph.nodes;
    generate.data.params.file = {
      type: 'string',
      display: 'filebrowser',
      value: '',
      fieldOptions: { fileTypes: [media] },
    };
    stage.containerInterface.boundary.inputs.push({
      portId: 'source',
      label: 'Source',
      valueType,
      required: true,
      binding: { nodeId: 'generate', fieldOrPortId: 'file' },
    });
    stage.containerInterface.controls.push({
      controlId: 'source',
      label: 'Source',
      valueType: 'string',
      order: 1,
      binding: { nodeId: 'generate', fieldId: 'file' },
    });
    const validate = (value) => {
      value.graph.graphHash = schema.blockGraphHashV2(value.graph);
      value.contentHash = schema.blockDefinitionContentHashV2(value);
      return schema.normalizeBlockDefinitionV2(value);
    };
    assert.deepEqual(validate(definition), definition);
    for (const field of [
      { type: 'string', display: 'filebrowser', fieldOptions: { fileTypes: ['text'] } },
      { type: 'string', display: 'textarea', fieldOptions: { fileTypes: [media] } },
      { type: 'string', display: 'filebrowser', fieldOptions: { fileTypes: media } },
      { type: 'int', display: 'filebrowser', fieldOptions: { fileTypes: [media] } },
    ]) {
      const broken = structuredClone(definition);
      broken.graph.nodes[1].data.params.file = field;
      assert.throws(() => validate(broken), /incompatible type/u);
    }
  }
});

test('every actual registered admission nests with its declared preview transport and exact public values', async () => {
  const catalog = JSON.parse(
    gunzipSync(await readFile(path.join(ROOT, '../MoDiff/modiff/registered_block_v2_catalog.v1.json.gz'))),
  );
  assert.ok(catalog.entries.length >= 90);
  for (const entry of catalog.entries) {
    const current = instance();
    const get = loadStore(current);
    const source = schema.createBlockInstanceV2(entry.definition, {
      instanceId: 'whole-catalog-fragment',
      position: { x: 100, y: 100 },
      size: { width: 420, height: 480 },
      values: entry.values,
      internalLayout: entry.internalLayout,
      internalLayoutMode: entry.internalLayoutMode,
      baselineValues: true,
    });
    const original = JSON.stringify(source);
    assert.doesNotThrow(
      () =>
        drops.insertNodeAtBlockTargetV2(runtime.createBlockRootNodeV2(source), get().nodes[0], get(), (n) =>
          get().addNode(n),
        ),
      entry.admissionId,
    );
    const target = get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2;
    assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(target))), target, entry.admissionId);
    const wrapper = target.effectiveGraph.nodes.find((n) => n.nodeType === 'group' && !n.modularDiffusers);
    assert.ok(wrapper, entry.admissionId);
    assert.equal(
      wrapper.containerInterface.previews.length,
      source.definitionSnapshot.previews.length,
      entry.admissionId,
    );
    const generated = target.effectiveGraph.nodes.filter(
      (n) => !current.effectiveGraph.nodes.some((old) => old.nodeId === n.nodeId),
    );
    assert.equal(generated.length, source.effectiveGraph.nodes.length + 1, entry.admissionId);
    const saved = persistence.reusableBlockDefinitionFromSubtreeV2(target, {
      rootNodeId: wrapper.nodeId,
      definitionId: 'user:catalog-nested-copy',
      displayName: 'Nested catalog copy',
    });
    assert.equal(saved.previews.length, source.definitionSnapshot.previews.length, entry.admissionId);
    for (const control of source.effectiveInterface.controls) {
      const sourceValue = schema.blockInstanceValueV2(source, control.controlId);
      assert.deepEqual(
        saved.controls.find((c) => c.controlId === control.controlId)?.defaultValue,
        sourceValue,
        `${entry.admissionId}: ${control.controlId}`,
      );
    }
    assert.equal(JSON.stringify(source), original);
  }
});
test('an upstream subtree mixed with an ordinary utility can be saved and nested again without identity loss', () => {
  const current = runtime.setBlockPresentationV2(instance(), { expanded: true, collapsedContainerNodeIds: [] });
  flowStore.useFlowStore.setState(runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(current)));
  const get = flowStore.useFlowStore.getState;
  get().resetHistory();
  const utility = {
    id: 'mixed-text',
    type: 'custom',
    position: { x: 80, y: 120 },
    data: {
      type: 'custom',
      label: 'Text',
      module: 'modules.Primitive',
      action: 'TextValue',
      params: {
        text: { type: 'string', value: 'A complex retained scene' },
        output: { type: 'string', display: 'output' },
      },
    },
  };
  drops.insertNodeAtBlockTargetV2(
    utility,
    get().nodes.find((n) => n.data.blockProjectionNodeId === 'stage'),
    get(),
    (n) => get().addNode(n),
  );
  const edited = get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2;
  const saved = persistence.reusableBlockDefinitionFromSubtreeV2(edited, {
    rootNodeId: 'stage',
    definitionId: 'user:mixed',
    displayName: 'Mixed subtree',
  });
  const fragment = schema.createBlockInstanceV2(saved, {
    instanceId: 'mixed-fragment',
    position: { x: 80, y: 120 },
    size: { width: 400, height: 320 },
  });
  drops.insertNodeAtBlockTargetV2(
    runtime.createBlockRootNodeV2(fragment),
    get().nodes.find((n) => n.data.blockProjectionNodeId === 'stage'),
    get(),
    (n) => get().addNode(n),
  );
  const adopted = get().nodes.find((n) => n.id === current.instanceId).data.blockInstanceV2;
  const added = adopted.effectiveGraph.nodes.filter(
    (n) => !edited.effectiveGraph.nodes.some((original) => original.nodeId === n.nodeId),
  );
  assert.equal(added.length, 3);
  const addedStage = added.find((n) => n.nodeType === 'group');
  assert.equal(addedStage.parentNodeId, 'stage');
  assert.deepEqual(addedStage.modularDiffusers.placementPath, ['stage', 'stage']);
  const addedUtility = added.find((n) => n.data.action === 'TextValue');
  assert.equal(addedUtility.parentNodeId, addedStage.nodeId);
  assert.equal(addedUtility.modularDiffusers, undefined);
  assert.equal(addedUtility.data.params.text.value, 'A complex retained scene');
  const generated = added.find((n) => n.data.action === 'Generate');
  assert.equal(generated.parentNodeId, addedStage.nodeId);
  assert.equal(generated.modularDiffusers.blockDefinitionId, 'example:generate');
  assert.deepEqual(generated.modularDiffusers.placementPath, ['stage', 'stage', 'generate']);
  assert.equal(addedStage.containerInterface.controls[0].binding.nodeId, generated.nodeId);
  assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(adopted))), adopted);
});

after(async () => {
  await server?.close();
});

function rehash(value) {
  value.graph.graphHash = schema.blockGraphHashV2(value.graph);
  value.contentHash = schema.blockDefinitionContentHashV2(value);
  return value;
}

test('durable container interface round-trips the shared backend fixture and hash', () => {
  const current = structuredClone(fixture);
  assert.equal(schema.blockGraphHashV2(current.graph), current.graph.graphHash);
  assert.equal(schema.blockDefinitionContentHashV2(current), current.contentHash);
  assert.deepEqual(schema.normalizeBlockDefinitionV2(current), current);
  assert.deepEqual([...schema.blockGraphSubtreeNodeIdsV2(current.graph, 'stage')].sort(), ['generate', 'stage']);
  const instance = schema.createBlockInstanceV2(current, {
    instanceId: 'nested-instance',
    position: { x: 0, y: 0 },
    size: { width: 400, height: 320 },
  });
  assert.deepEqual(schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(instance))), instance);
});

test('absent optional container declarations preserve existing definition bytes and hashes', () => {
  const current = structuredClone(fixture);
  delete current.graph.nodes[0].containerInterface;
  rehash(current);
  assert.deepEqual(schema.normalizeBlockDefinitionV2(current), current);
  assert.equal(Object.hasOwn(schema.normalizeBlockDefinitionV2(current).graph.nodes[0], 'containerInterface'), false);
  const edited = structuredClone(fixture);
  edited.graph.nodes[0].containerInterface.controls[0].label = 'A different label';
  assert.notEqual(schema.blockGraphHashV2(edited.graph), fixture.graph.graphHash);
});

test('container declarations reject sibling, missing, wrong-direction, type, duplicate and hidden-value authority', () => {
  const edits = [
    (local) => {
      local.schemaVersion = 2;
    },
    (local) => {
      local.values = {};
    },
    (local) => {
      local.boundary.inputs[0].binding.nodeId = 'sibling';
    },
    (local) => {
      local.boundary.inputs[0].binding.fieldOrPortId = 'missing';
    },
    (local) => {
      local.boundary.inputs[0].binding.fieldOrPortId = 'images';
    },
    (local) => {
      local.boundary.inputs[0].valueType = 'image';
    },
    (local) => {
      local.controls[0].defaultValue = 'must not override';
    },
    (local) => {
      local.controls[0].binding.fieldId = 'steps';
    },
    (local) => {
      local.boundary.outputs[0].portId = 'prompt';
    },
    (local) => {
      local.boundary.inputs.push({ ...local.boundary.inputs[0], portId: 'duplicate-target' });
    },
    (local) => {
      local.controls.push({ ...local.controls[0], controlId: 'duplicate-target', order: 1 });
    },
    (local) => {
      local.controls[0].mirrorBindings = [{ nodeId: 'sibling', fieldId: 'prompt' }];
    },
  ];
  for (const edit of edits) {
    const current = structuredClone(fixture);
    edit(current.graph.nodes[0].containerInterface);
    rehash(current);
    assert.throws(() => schema.normalizeBlockDefinitionV2(current));
  }
});

test('selection moves retain both connected items and roll back the entire failed batch', async () => {
  const moves = await server.ssrLoadModule('/src/studio/blockSelectionMovesV2.ts');
  const definition = structuredClone(fixture);
  for (const node of definition.graph.nodes) delete node.modularDiffusers;
  definition.graph.nodes.find((node) => node.nodeId === 'generate').parentNodeId = 'stage';
  definition.graph.nodes.find((node) => node.nodeId === 'sibling').parentNodeId = 'stage';
  definition.graph.edges = [
    {
      edgeId: 'text-prompt',
      sourceNodeId: 'sibling',
      sourcePortId: 'text',
      targetNodeId: 'generate',
      targetPortId: 'prompt',
    },
  ];
  const current = instance(rehash(definition));
  const get = loadStore(current);
  get().setBlockPresentationV2(current.instanceId, { collapsedContainerNodeIds: [] });
  get().resetHistory();
  const ids = ['generate', 'sibling'].map((id) => runtime.blockProjectionNodeIdV2(current.instanceId, id));
  const before = get().toObject();
  const originalReparent = get().reparentNodeInBlockV2;
  let calls = 0;
  flowStore.useFlowStore.setState({
    reparentNodeInBlockV2: (...args) => {
      if (++calls === 2) throw new Error('Destination changed');
      originalReparent(...args);
    },
  });
  try {
    assert.throws(() => moves.moveBlockSelectionV2(ids, null, 'out'), /Destination changed/);
    assert.deepEqual(get().toObject(), before);
    assert.equal(get().historyPast.length, 0);
  } finally {
    flowStore.useFlowStore.setState({ reparentNodeInBlockV2: originalReparent });
  }
  moves.moveBlockSelectionV2(ids, null, 'out');
  const after = get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2;
  assert.equal(after.effectiveGraph.nodes.find((node) => node.nodeId === 'generate').parentNodeId, undefined);
  assert.equal(after.effectiveGraph.nodes.find((node) => node.nodeId === 'sibling').parentNodeId, undefined);
  assert.deepEqual(after.effectiveGraph.edges, current.effectiveGraph.edges);
  assert.equal(get().historyPast.length, 1);
  get().undo();
  assert.deepEqual(get().toObject(), before);
  get().redo();
  assert.deepEqual(
    get().nodes.find((node) => node.id === current.instanceId).data.blockInstanceV2.effectiveGraph,
    after.effectiveGraph,
  );
});

test('selection excludes descendants and transfers crossing wires when both endpoints leave a Block', async () => {
  const moves = await server.ssrLoadModule('/src/studio/blockSelectionMovesV2.ts');
  const definition = structuredClone(fixture);
  for (const node of definition.graph.nodes) delete node.modularDiffusers;
  definition.graph.nodes.find((node) => node.nodeId === 'generate').parentNodeId = 'stage';
  definition.graph.edges = [
    {
      edgeId: 'text-prompt',
      sourceNodeId: 'sibling',
      sourcePortId: 'text',
      targetNodeId: 'generate',
      targetPortId: 'prompt',
    },
  ];
  const current = instance(rehash(definition));
  const get = loadStore(current);
  get().setBlockPresentationV2(current.instanceId, { collapsedContainerNodeIds: [] });
  get().resetHistory();
  const id = (semantic) => runtime.blockProjectionNodeIdV2(current.instanceId, semantic);
  assert.deepEqual(
    moves
      .topLevelBlockSelectionV2(get().nodes, [id('stage'), id('generate'), id('sibling')])
      .map((node) => node.id)
      .sort(),
    [id('stage'), id('sibling')].sort(),
  );
  const moved = moves.moveBlockSelectionV2([id('generate'), id('sibling')], null);
  assert.equal(moved.length, 2);
  const source = get().nodes.find((node) => moved.includes(node.id) && node.data.label === 'Sibling');
  const target = get().nodes.find((node) => moved.includes(node.id) && node.data.label === 'Generate');
  assert.ok(source && target);
  assert.ok(
    get().edges.some(
      (edge) =>
        edge.source === source.id &&
        edge.target === target.id &&
        edge.sourceHandle === 'text' &&
        edge.targetHandle === 'prompt',
    ),
  );
  assert.equal(get().historyPast.length, 1);
});

test('mixed legacy/current selection converts only involved instances and retains wires through Undo', async () => {
  const moves = await server.ssrLoadModule('/src/studio/blockSelectionMovesV2.ts');
  const users = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  const ordinary = (id, text) => ({
    id,
    type: 'custom',
    position: { x: 32, y: 80 },
    data: {
      type: 'custom',
      module: 'modules.Text',
      action: 'TextToList',
      label: id,
      params: { text: { value: text, type: 'string' }, output: { display: 'output', type: 'string' } },
    },
  });
  const definition = {
    id: 'legacy-definition',
    name: 'Existing saved block',
    version: 1,
    nodes: [ordinary('text', 'stored value')],
    edges: [],
    inputs: [],
    outputs: [{ id: 'output', label: 'Text', type: 'string', nodeId: 'text', paramKey: 'output' }],
    exposedParams: [{ id: 'text-control', label: 'Text', kind: 'graph-param', nodeId: 'text', paramKey: 'text' }],
    createdAt: 1,
    updatedAt: 1,
  };
  const legacy = users.createUserBlockNode(definition, { x: 700, y: 80 }, 'legacy-instance');
  const savedDefinition = structuredClone(legacy.data.userBlockSnapshot);
  legacy.data.params['text-control'].value = 'edited value';
  const current = project(instance());
  const get = flowStore.useFlowStore.getState;
  get().replaceGraph({
    nodes: [...current.nodes, legacy, ordinary('outside', 'outside')],
    edges: [
      ...current.edges,
      { id: 'crossing', source: legacy.id, sourceHandle: 'output', target: 'outside', targetHandle: 'text' },
    ],
  });
  get().resetHistory();
  const before = get().toObject();
  const moved = moves.moveBlockSelectionV2([legacy.id, 'outside'], 'nested-instance');
  assert.equal(moved.length, 2);
  const expanded = runtime.expandBlockGraphV2ForExecution(get().nodes, get().edges);
  assert.ok(expanded.nodes.some((node) => node.data.params.text?.value === 'edited value'));
  assert.ok(expanded.edges.some((edge) => edge.sourceHandle === 'output' && edge.targetHandle === 'text'));
  assert.deepEqual(legacy.data.userBlockSnapshot, savedDefinition);
  assert.equal(get().historyPast.length, 1);
  get().undo();
  assert.deepEqual(get().toObject(), before);
  get().redo();
  assert.equal(
    get().nodes.some((node) => node.id === legacy.id),
    false,
  );
});

test('legacy destination supports a connected multiple-node move and toolbar detachment', async () => {
  const moves = await server.ssrLoadModule('/src/studio/blockSelectionMovesV2.ts');
  const users = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  const ordinary = (id) => ({
    id,
    type: 'custom',
    position: { x: 64, y: 120 },
    data: {
      type: 'custom',
      module: 'modules.Text',
      action: 'TextToList',
      label: id,
      params: { text: { value: id, type: 'string' }, output: { display: 'output', type: 'string' } },
    },
  });
  const definition = {
    id: 'legacy-target-definition',
    name: 'Legacy target',
    version: 1,
    nodes: [ordinary('inside')],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const root = users.createUserBlockNode(definition, { x: 0, y: 0 }, 'legacy-target');
  const graph = users.expandUserBlockInstance(
    {
      nodes: [root, ordinary('first'), ordinary('second')],
      edges: [{ id: 'between', source: 'first', sourceHandle: 'output', target: 'second', targetHandle: 'text' }],
    },
    root.id,
    [],
  );
  const get = flowStore.useFlowStore.getState;
  get().replaceGraph(graph);
  get().resetHistory();
  assert.equal(moves.blockSelectionDropTargetV2(get().nodes, ['first', 'second'], 'first')?.id, root.id);
  const moved = moves.moveBlockSelectionV2(['first', 'second'], root.id);
  assert.equal(moved.length, 2);
  assert.ok(get().nodes.find((node) => node.id === root.id).data.blockInstanceV2);
  const out = moves.moveBlockSelectionV2(moved, null, 'out');
  assert.equal(out.length, 2);
  assert.ok(get().edges.some((edge) => out.includes(edge.source) && out.includes(edge.target)));
});

test('materialized legacy Cluster conversion preserves execution values, preview and public links without saving a library copy', async () => {
  const legacy = await server.ssrLoadModule('/src/studio/legacyBlockMovementV2.ts');
  const users = await server.ssrLoadModule('/src/stores/useUserBlockStore.ts');
  const saved = users.useUserBlockStore.getState().blocks;
  const root = {
    id: 'old-cluster',
    type: 'block',
    position: { x: 100, y: 100 },
    data: {
      type: 'block',
      label: 'Old cluster',
      huggingFaceClusterRole: 'root',
      params: {
        image: {
          type: 'image',
          display: 'output',
          fieldOptions: {
            huggingFaceClusterPortDirection: 'output',
            huggingFaceClusterPortNodeId: 'old-cluster__preview',
            huggingFaceClusterPortField: 'image',
          },
        },
      },
      huggingFaceClusterInstance: {
        execution: { admissionId: 'admission', studioExecutionSpec: { id: 'spec' } },
        definition: { id: 'old-definition', contentHash: 'unchanged' },
        presentation: { expanded: true },
      },
    },
  };
  const child = {
    id: 'old-cluster__preview',
    type: 'custom',
    parentId: root.id,
    position: { x: 30, y: 80 },
    data: {
      type: 'custom',
      module: 'modules.Image',
      action: 'Preview',
      params: { image: { type: 'image', display: 'ui_image', value: '@data/images/retained.webp' } },
      huggingFaceClusterRole: 'execution',
      huggingFaceClusterInstanceId: root.id,
      huggingFaceClusterExecutionAdmissionId: 'admission',
      huggingFaceClusterExecutionSpecId: 'spec',
      uiState: { disabled: false },
    },
  };
  const result = legacy.prepareLegacyBlockMovementV2(
    [
      root,
      child,
      {
        ...child,
        id: 'outside',
        parentId: undefined,
        data: {
          type: 'custom',
          module: 'modules.Image',
          action: 'Preview',
          params: { image: { type: 'image', display: 'input' } },
        },
      },
    ],
    [
      { id: 'outside-wire', source: root.id, sourceHandle: 'image', target: 'outside', targetHandle: 'image' },
      { id: 'direct-crossing', source: child.id, sourceHandle: 'image', target: 'outside', targetHandle: 'extra' },
    ],
    [child.id],
    null,
  );
  const converted = result.nodes.find((node) => node.id === root.id).data.blockInstanceV2;
  assert.equal(converted.effectiveGraph.nodes[0].data.params.image.value, '@data/images/retained.webp');
  assert.equal(converted.previewStates[0].mediaReference, '@data/images/retained.webp');
  assert.equal(result.edges.find((edge) => edge.target === 'outside').sourceHandle, 'port-image');
  assert.equal(result.ids[0], runtime.blockProjectionNodeIdV2(root.id, 'preview'));
  assert.equal(result.edges.find((edge) => edge.id === 'direct-crossing').source, result.ids[0]);
  assert.equal(converted.effectiveInterface.boundary.outputs.length, 1);
  assert.equal(users.useUserBlockStore.getState().blocks, saved);
  assert.equal(root.data.blockInstanceV2, undefined);
});

test('historic NanoID prefixes convert deterministically and failed batch moves leave the original graph intact', async () => {
  const moves = await server.ssrLoadModule('/src/studio/blockSelectionMovesV2.ts');
  const users = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  const child = {
    id: '_text',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Primitive',
      action: 'String',
      params: { value: { type: 'string', value: 'retained' } },
    },
  };
  const definition = {
    id: '_definition',
    name: 'Historic',
    version: 1,
    nodes: [child],
    edges: [],
    inputs: [],
    outputs: [],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const root = users.createUserBlockNode(definition, { x: 600, y: 0 }, '_root');
  const current = project(instance());
  const get = flowStore.useFlowStore.getState;
  get().replaceGraph({ nodes: [...current.nodes, root], edges: current.edges });
  get().resetHistory();
  const before = get().toObject();
  assert.throws(() => moves.moveBlockSelectionV2([root.id], 'absent'), /destination/);
  assert.deepEqual(get().toObject(), before);
  const result = moves.moveBlockSelectionV2([root.id], 'nested-instance');
  assert.equal(result.length, 1);
  const expanded = runtime.expandBlockGraphV2ForExecution(get().nodes, get().edges);
  assert.ok(expanded.nodes.some((node) => node.data.params.value?.value === 'retained'));
  get().undo();
  assert.deepEqual(get().toObject(), before);
});

test('nested legacy definitions migrate without manual expansion and preserve local controls', async () => {
  const legacy = await server.ssrLoadModule('/src/studio/legacyBlockMovementV2.ts');
  const users = await server.ssrLoadModule('/src/studio/userBlocks.ts');
  const leaf = {
    id: 'leaf',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Primitive',
      action: 'TextValue',
      params: { text: { type: 'string', value: 'original' }, output: { type: 'string', display: 'output' } },
    },
  };
  const inner = {
    id: 'inner-definition',
    name: 'Inner',
    version: 1,
    nodes: [leaf],
    edges: [],
    inputs: [],
    outputs: [{ id: 'result', label: 'Result', type: 'string', nodeId: 'leaf', paramKey: 'output' }],
    exposedParams: [{ id: 'content', label: 'Content', kind: 'graph-param', nodeId: 'leaf', paramKey: 'text' }],
    createdAt: 1,
    updatedAt: 1,
  };
  const nested = users.createUserBlockNode(inner, { x: 20, y: 40 }, 'nested');
  nested.data.params.content.value = 'current nested edit';
  const outer = {
    ...inner,
    id: 'outer-definition',
    name: 'Outer',
    nodes: [nested],
    outputs: [{ id: 'result', label: 'Result', type: 'string', nodeId: 'nested', paramKey: 'result' }],
    exposedParams: [],
  };
  const migrated = legacy.migrateLegacyHierarchyV2(outer, []);
  const child = migrated.graph.nodes.find((node) => node.nodeId === 'nested::leaf');
  assert.equal(child.parentNodeId, 'nested');
  assert.equal(child.data.params.text.value, 'current nested edit');
  assert.equal(
    migrated.graph.nodes.find((node) => node.nodeId === 'nested').containerInterface.boundary.outputs[0].binding.nodeId,
    'nested::leaf',
  );
  assert.equal(outer.nodes[0].data.userBlockSnapshot.nodes[0].data.params.text.value, 'original');
  const root = users.createUserBlockNode(outer, { x: 0, y: 0 }, 'outer-instance');
  let expanded = users.expandUserBlockInstance({ nodes: [root], edges: [] }, root.id, []);
  const nestedRoot = expanded.nodes.find((node) => node.data.userBlockSourceNodeId === 'nested');
  expanded = users.expandUserBlockInstance(expanded, nestedRoot.id, []);
  const liveLeaf = expanded.nodes.find((node) => node.data.userBlockSourceNodeId === 'leaf');
  liveLeaf.data.params.text.value = 'edited while expanded';
  const converted = legacy.prepareLegacyBlockMovementV2(expanded.nodes, expanded.edges, [liveLeaf.id], null);
  const owner = converted.nodes.find((node) => node.data.blockInstanceV2).data.blockInstanceV2;
  assert.equal(
    owner.effectiveGraph.nodes.find((node) => node.nodeId === 'nested::leaf').data.params.text.value,
    'edited while expanded',
  );
  assert.equal(converted.ids[0], runtime.blockProjectionNodeIdV2(root.id, 'nested::leaf'));
});
