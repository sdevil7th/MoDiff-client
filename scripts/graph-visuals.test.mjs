import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Position, ReactFlowProvider } from '@xyflow/react';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let connectionTypes;
let graphConnectionSurface;
let graphBridge;
let graphFinalization;
let graphFixerModule;
let graphControls;
let graphLayout;
let graphTypedHandle;
let managedControlSync;
let modelSelection;
let nodeFactory;
let flowStoreModule;
let nodesStoreModule;
let runReadinessModule;
let runPreparationModule;
let studioStoreModule;
let websocketMessageHandler;
let userBlocksModule;
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
    cancelAnimationFrame: () => {},
    dispatchEvent: () => true,
    localStorage: globalThis.localStorage,
    location: { origin: 'http://127.0.0.1:5191' },
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 0),
    setTimeout: globalThis.setTimeout,
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  connectionTypes = await server.ssrLoadModule('/src/theme/connectionTypes.ts');
  graphConnectionSurface = await server.ssrLoadModule('/src/ui/GraphConnectionSurface.tsx');
  graphBridge = await server.ssrLoadModule('/src/studio/graphBridge.ts');
  graphFinalization = await server.ssrLoadModule('/src/studio/graphFinalization.ts');
  graphFixerModule = await server.ssrLoadModule('/src/studio/graphFixer.ts');
  graphControls = await server.ssrLoadModule('/src/ui/GraphControls.tsx');
  graphLayout = await server.ssrLoadModule('/src/workflow/graphLayout.ts');
  graphTypedHandle = await server.ssrLoadModule('/src/ui/GraphTypedHandle.tsx');
  managedControlSync = await server.ssrLoadModule('/src/studio/managedControlSync.ts');
  modelSelection = await server.ssrLoadModule('/src/studio/modelSelection.ts');
  nodeFactory = await server.ssrLoadModule('/src/workflow/nodeFactory.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  nodesStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  runReadinessModule = await server.ssrLoadModule('/src/studio/runReadiness.ts');
  runPreparationModule = await server.ssrLoadModule('/src/studio/runPreparation.ts');
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  websocketMessageHandler = await server.ssrLoadModule('/src/stores/websocketMessageHandler.ts');
  userBlocksModule = await server.ssrLoadModule('/src/studio/userBlocks.ts');
});

beforeEach(() => {
  flowStoreModule.useFlowStore.setState({
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
    layoutRevision: 0,
  });
  studioStoreModule.useStudioStore.setState({
    blueprints: [],
    workflowTabs: [],
    activeWorkflowTabId: null,
    graphBinding: null,
    graphFinalization: null,
  });
});

after(async () => {
  await server?.close();
});

function node(id, x = 0, y = 0, extras = {}) {
  return {
    id,
    type: extras.type ?? 'custom',
    position: { x, y },
    width: extras.width ?? 240,
    height: extras.height ?? 120,
    parentId: extras.parentId,
    data: {
      type: extras.type ?? 'custom',
      module: 'modules.Test',
      action: id,
      label: id,
      category: 'Test',
      params: extras.params ?? {},
    },
  };
}

function edge(id, source, target, sourceHandle = 'output', targetHandle = 'input') {
  return { id, source, target, sourceHandle, targetHandle, type: 'default' };
}

function managedNode(id, role, extras = {}) {
  const base = node(id, extras.x ?? 0, extras.y ?? 0, { params: extras.params ?? {} });
  return {
    ...base,
    data: {
      ...base.data,
      studioOwned: true,
      studioRole: role,
      executionStatus: extras.executionStatus,
      uiState: extras.uiState,
    },
  };
}

function managedContractNode(id, role, module, action, params) {
  const item = managedNode(id, role, { params });
  item.data.module = module;
  item.data.action = action;
  return item;
}

const FINALIZATION_PROOF_PARAM_KEYS = [
  'type',
  'display',
  'hidden',
  'required',
  'isInput',
  'spawn',
  'optionsSource',
  'min',
  'max',
  'step',
  'dataSource',
  'fieldOptions',
];

function orderedFinalizationProofValue(value) {
  if (Array.isArray(value)) return value.map(orderedFinalizationProofValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, orderedFinalizationProofValue(entryValue)]),
  );
}

function finalizationProofHash(value) {
  const serialized = JSON.stringify(orderedFinalizationProofValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `graph-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function craftedFinalizationProof(binding, roles) {
  const nodes = flowStoreModule.useFlowStore.getState().nodes;
  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  const fieldSchemaHash = finalizationProofHash({
    nodes: roles.map((role) => {
      const nodeId = binding.nodes[role];
      const item = nodeById.get(nodeId);
      return {
        role,
        id: nodeId,
        module: item?.data.module,
        action: item?.data.action,
        params: Object.fromEntries(
          Object.entries(item?.data.params ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, param]) => [
              key,
              Object.fromEntries(
                FINALIZATION_PROOF_PARAM_KEYS.map((paramKey) => [paramKey, param[paramKey]]).filter(
                  ([, paramValue]) => paramValue !== undefined,
                ),
              ),
            ]),
        ),
      };
    }),
  });
  const managedNodes = new Set(binding.managedNodeIds);
  const edgeSpecHash = finalizationProofHash(
    flowStoreModule.useFlowStore
      .getState()
      .edges.filter((item) => managedNodes.has(item.source) && managedNodes.has(item.target))
      .map((item) => `${item.source}:${item.sourceHandle ?? ''}->${item.target}:${item.targetHandle ?? ''}`)
      .sort(),
  );
  return { schemaVersion: 2, shapeKey: `${binding.fingerprint}:${roles.join('|')}`, fieldSchemaHash, edgeSpecHash };
}

function controlledFieldSchemaHash(binding) {
  const nodeById = new Map(flowStoreModule.useFlowStore.getState().nodes.map((item) => [item.id, item]));
  return finalizationProofHash(
    binding.managedNodeIds
      .map((nodeId) => {
        const item = nodeById.get(nodeId);
        return [
          nodeId,
          item?.data.studioRole,
          item?.data.module,
          item?.data.action,
          Object.fromEntries(
            Object.entries(item?.data.params ?? {})
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, param]) => [
                key,
                Object.fromEntries(
                  FINALIZATION_PROOF_PARAM_KEYS.map((paramKey) => [paramKey, param[paramKey]]).filter(
                    ([, paramValue]) => paramValue !== undefined,
                  ),
                ),
              ]),
          ),
        ];
      })
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

function graphContentSnapshot(state) {
  return {
    nodes: state.nodes.map((item) => ({
      id: item.id,
      type: item.type,
      parentId: item.parentId ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      data: {
        ...item.data,
        params: Object.fromEntries(
          Object.entries(item.data.params ?? {}).map(([key, param]) => {
            const { isConnected: _isConnected, ...authoredParam } = param;
            return [key, authoredParam];
          }),
        ),
      },
    })),
    edges: state.edges.map((item) => {
      const { connectionType: _connectionType, ...authoredData } = item.data ?? {};
      return {
        id: item.id,
        source: item.source,
        sourceHandle: item.sourceHandle ?? null,
        target: item.target,
        targetHandle: item.targetHandle ?? null,
        type: item.type,
        data: authoredData,
      };
    }),
  };
}

function intersects(left, right) {
  const leftSize = graphLayout.graphNodeSize(left);
  const rightSize = graphLayout.graphNodeSize(right);
  return !(
    left.position.x + leftSize.width <= right.position.x ||
    right.position.x + rightSize.width <= left.position.x ||
    left.position.y + leftSize.height <= right.position.y ||
    right.position.y + rightSize.height <= left.position.y
  );
}

function assertSiblingClearance(nodes, fixtureName) {
  const byParent = new Map();
  nodes.forEach((item) => {
    const parentId = item.parentId ?? '__root__';
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), item]);
  });
  byParent.forEach((siblings) => {
    for (let leftIndex = 0; leftIndex < siblings.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < siblings.length; rightIndex += 1) {
        const left = siblings[leftIndex];
        const right = siblings[rightIndex];
        const leftSize = graphLayout.graphNodeSize(left);
        const rightSize = graphLayout.graphNodeSize(right);
        const horizontalClearance = Math.max(
          right.position.x - (left.position.x + leftSize.width),
          left.position.x - (right.position.x + rightSize.width),
        );
        const verticalClearance = Math.max(
          right.position.y - (left.position.y + leftSize.height),
          left.position.y - (right.position.y + rightSize.height),
        );
        assert.ok(
          horizontalClearance >= graphLayout.GRAPH_LAYOUT_HORIZONTAL_GAP ||
            verticalClearance >= graphLayout.GRAPH_LAYOUT_VERTICAL_GAP,
          `${fixtureName}: ${left.id}/${right.id} must retain 140px horizontal or 72px vertical clearance`,
        );
      }
    }
  });
}

function backwardEdgeCount(nodes, edges) {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  return edges.filter((item) => {
    const source = byId.get(item.source);
    const target = byId.get(item.target);
    if (!source || !target || source.parentId !== target.parentId) return false;
    return source.position.x >= target.position.x;
  }).length;
}

function crossingCount(nodes, edges) {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  const endpoints = edges.flatMap((item) => {
    const source = byId.get(item.source);
    const target = byId.get(item.target);
    if (!source || !target || source.parentId !== target.parentId || source.position.x >= target.position.x) return [];
    return [
      {
        sourceX: source.position.x,
        sourceY: source.position.y + graphLayout.graphNodeSize(source).height / 2,
        targetX: target.position.x,
        targetY: target.position.y + graphLayout.graphNodeSize(target).height / 2,
      },
    ];
  });
  let crossings = 0;
  for (let left = 0; left < endpoints.length; left += 1) {
    for (let right = left + 1; right < endpoints.length; right += 1) {
      const a = endpoints[left];
      const b = endpoints[right];
      if (a.sourceX !== b.sourceX || a.targetX !== b.targetX) continue;
      if ((a.sourceY - b.sourceY) * (a.targetY - b.targetY) < 0) crossings += 1;
    }
  }
  return crossings;
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(left, right) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) / (Math.min(leftLuminance, rightLuminance) + 0.05);
}

test('closing a background workflow leaves the active canvas, volatile graph state, epochs, and history untouched', () => {
  const studio = studioStoreModule.useStudioStore.getState();
  studio.ensureWorkflowTabs();
  const activeId = studioStoreModule.useStudioStore.getState().activeWorkflowTabId;
  flowStoreModule.useFlowStore.getState().replaceGraph({ nodes: [node('active-node')], edges: [] });
  studioStoreModule.useStudioStore.getState().saveActiveWorkflowTab(true);
  const backgroundId = studioStoreModule.useStudioStore.getState().createWorkflowTab('Background');
  studioStoreModule.useStudioStore.getState().switchWorkflowTab(activeId);

  const historyEntry = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  flowStoreModule.useFlowStore.setState({ historyPast: [historyEntry] });
  studioStoreModule.useStudioStore.setState({ graphBinding: { fingerprint: 'active-binding' } });
  const before = studioStoreModule.captureWorkflowOperationContext();
  studioStoreModule.useStudioStore.getState().closeWorkflowTab(backgroundId);

  assert.deepEqual(
    flowStoreModule.useFlowStore.getState().nodes.map((item) => item.id),
    ['active-node'],
  );
  assert.equal(flowStoreModule.useFlowStore.getState().historyPast.length, 1);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.fingerprint, 'active-binding');
  assert.deepEqual(studioStoreModule.captureWorkflowOperationContext(), before);
});

test('workflow switching resets undo history and an A-to-B-to-A cycle cannot revive an old async owner', () => {
  const studio = studioStoreModule.useStudioStore.getState();
  studio.ensureWorkflowTabs();
  const firstId = studioStoreModule.useStudioStore.getState().activeWorkflowTabId;
  flowStoreModule.useFlowStore.getState().replaceGraph({ nodes: [node('first-node')], edges: [] });
  studioStoreModule.useStudioStore.getState().saveActiveWorkflowTab(true);
  const secondId = studioStoreModule.useStudioStore.getState().createWorkflowTab('Second');
  flowStoreModule.useFlowStore.getState().replaceGraph({ nodes: [node('second-node')], edges: [] });
  studioStoreModule.useStudioStore.getState().saveActiveWorkflowTab(true);
  studioStoreModule.useStudioStore.getState().switchWorkflowTab(firstId);
  flowStoreModule.useFlowStore.setState({
    historyPast: [{ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }],
  });
  const staleOwner = studioStoreModule.captureWorkflowOperationContext();

  studioStoreModule.useStudioStore.getState().switchWorkflowTab(secondId);
  studioStoreModule.useStudioStore.getState().switchWorkflowTab(firstId);

  assert.deepEqual(
    flowStoreModule.useFlowStore.getState().nodes.map((item) => item.id),
    ['first-node'],
  );
  assert.equal(flowStoreModule.useFlowStore.getState().historyPast.length, 0);
  assert.throws(() => studioStoreModule.assertWorkflowOperationContext(staleOwner), /workflow changed/i);
});

test('every declared concrete backend connection type has a non-neutral stable color', () => {
  const requiredConcreteTypes = [
    'audio',
    'audio_diffusion_pipeline',
    'bool',
    'collection',
    'custom_controlnet',
    'custom_guider',
    'custom_ip_adapter',
    'custom_lora',
    'diffusers_auto_model',
    'diffusers_auto_models',
    'diffusers_execution_recipe',
    'embeddings',
    'float',
    'image',
    'image_diffusion_pipeline',
    'image_embeds',
    'int',
    'latent',
    'latents',
    'layers_config',
    'modular_pipeline',
    'multimodal_text_model',
    'pipeline',
    'quant_config',
    'quantization_config',
    'str',
    'string',
    'tensor',
    'text',
    'video',
    'video_asset',
    'video_asset_collection',
    'video_collection',
    'video_diffusion_pipeline',
    'wan_vace_pipeline',
  ];
  const concreteTypes = Object.keys(connectionTypes.connectionTypeColors).filter(
    (type) => !['any', 'default', 'missing'].includes(type),
  );
  requiredConcreteTypes.forEach((type) => {
    assert.ok(concreteTypes.includes(type), `${type} must remain in the registered connection palette`);
  });
  const colors = concreteTypes.map((type) => {
    const color = connectionTypes.connectionColor(type);
    assert.notEqual(color, connectionTypes.NEUTRAL_CONNECTION_COLOR, type);
    assert.equal(color, connectionTypes.connectionColor(type), `${type} must be stable`);
    assert.ok(contrastRatio(color, '#0B0F19') >= 3, `${type} must remain legible on the graph canvas`);
    return color;
  });
  assert.equal(new Set(colors).size, colors.length, 'concrete connection types must have pairwise-distinct colors');
  const primitiveColor = connectionTypes.connectionColor('primitive');
  assert.notEqual(primitiveColor, connectionTypes.NEUTRAL_CONNECTION_COLOR);
  assert.equal(colors.includes(primitiveColor), false);
  assert.equal(connectionTypes.connectionColor('IMAGE'), connectionTypes.connectionColor('image'));
  assert.equal(connectionTypes.connectionColor('any'), connectionTypes.NEUTRAL_CONNECTION_COLOR);
  assert.equal(connectionTypes.connectionColor('missing'), connectionTypes.NEUTRAL_CONNECTION_COLOR);
});

test('every concrete type exposed by the mocked backend registry receives a distinct stable color', () => {
  const mockedStudioSource = fs.readFileSync(
    path.join(ROOT, 'tests', 'e2e', 'studio-mocked', 'studio-mocked.spec.ts'),
    'utf8',
  );
  const registryStart = mockedStudioSource.indexOf('const mockRegistry = {');
  const registryEnd = mockedStudioSource.indexOf('\n};', registryStart);
  assert.ok(registryStart >= 0 && registryEnd > registryStart, 'mocked backend registry must remain inspectable');
  const registrySource = mockedStudioSource.slice(registryStart, registryEnd);
  const registeredTypes = Array.from(
    new Set(
      [...registrySource.matchAll(/\btype:\s*'([^']+)'/g)]
        .flatMap((match) => connectionTypes.connectionTypes(match[1]))
        .filter((type) => !['any', 'default', 'missing'].includes(type)),
    ),
  ).sort();
  assert.ok(registeredTypes.length >= 20, 'the backend fixture must exercise a representative type inventory');

  const colors = registeredTypes.map((type) => {
    const color = connectionTypes.connectionColor(type);
    assert.notEqual(color, connectionTypes.NEUTRAL_CONNECTION_COLOR, type);
    assert.equal(color, connectionTypes.connectionColor(type), `${type} must remain stable`);
    return color;
  });
  assert.equal(
    new Set(colors).size,
    colors.length,
    'every concrete type currently exposed by the backend fixture must remain visually distinct',
  );
});

test('union connections resolve their exact payload and decorate stroke plus arrow consistently', () => {
  const nodes = [
    node('source', 0, 0, {
      params: { output: { display: 'output', type: ['image', 'video'] } },
    }),
    node('target', 0, 0, {
      params: { input: { display: 'input', type: 'video' } },
    }),
  ];
  const decorated = connectionTypes.decorateConnectionEdge(edge('edge', 'source', 'target'), nodes);
  assert.equal(decorated.data.connectionType, 'video');
  assert.equal(decorated.style.stroke, connectionTypes.connectionColor('video'));
  assert.equal(decorated.markerEnd.color, connectionTypes.connectionColor('video'));
  assert.match(connectionTypes.connectionTypeGradient(['image', 'video']), /linear-gradient/);
  assert.equal(connectionTypes.connectionTypesAreCompatible(['image', 'video'], 'video'), true);
  assert.equal(connectionTypes.connectionTypesAreCompatible('image', 'audio'), false);
  assert.equal(connectionTypes.connectionTypesAreCompatible('Text', 'text'), true);
  assert.equal(connectionTypes.connectionTypesAreCompatible('str', 'string'), false);
  assert.equal(connectionTypes.resolveConnectionType('any', 'audio'), 'audio');
  assert.deepEqual(connectionTypes.connectionTypes([' IMAGE ', 'image', 'DEFAULT', 'missing', 'Any', 'ANY']), [
    'any',
    'image',
  ]);
  assert.equal(
    connectionTypes.resolveConnectionType(['Any', 'IMAGE', 'default'], [' VIDEO ', 'image', 'missing']),
    'image',
  );
  const ambiguous = connectionTypes.resolveConnectionType(['video', 'image', 'any'], ['image', 'audio', 'video']);
  assert.deepEqual(ambiguous, ['image', 'video']);
  const ambiguousNodes = [
    node('ambiguous-source', 0, 0, {
      params: { output: { display: 'output', type: ['video', 'image', 'any'] } },
    }),
    node('ambiguous-target', 0, 0, {
      params: { input: { display: 'input', type: ['image', 'audio', 'video'] } },
    }),
  ];
  const ambiguousEdge = connectionTypes.decorateConnectionEdge(
    edge('ambiguous-edge', 'ambiguous-source', 'ambiguous-target'),
    ambiguousNodes,
  );
  assert.deepEqual(ambiguousEdge.data.connectionType, ['image', 'video']);
  assert.equal(ambiguousEdge.style.stroke, connectionTypes.connectionColor(['video', 'image']));
  assert.equal(ambiguousEdge.markerEnd.color, connectionTypes.connectionColor(['image', 'video']));
  assert.notEqual(ambiguousEdge.style.stroke, connectionTypes.connectionColor('image'));
  assert.notEqual(ambiguousEdge.style.stroke, connectionTypes.connectionColor('video'));
  assert.deepEqual(connectionTypes.resolveConnectionType('any', ['video', 'image']), ['image', 'video']);
  assert.deepEqual(connectionTypes.resolveConnectionType(['video', 'image'], 'any'), ['image', 'video']);
  assert.deepEqual(connectionTypes.resolveConnectionType(['video', 'image'], undefined), ['image', 'video']);
  assert.match(connectionTypes.connectionTypeGradient(ambiguous), /linear-gradient/);
  const normalizedGradient = connectionTypes.connectionTypeGradient(['IMAGE', ' image ', 'Any', 'DEFAULT', 'VIDEO']);
  assert.match(normalizedGradient, new RegExp(connectionTypes.connectionColor('image'), 'i'));
  assert.match(normalizedGradient, new RegExp(connectionTypes.connectionColor('video'), 'i'));
});

test('the resolved payload color reaches the rendered target socket, drag surface, edge, and arrow', () => {
  const nodes = [
    node('source', 0, 0, {
      params: { output: { display: 'output', type: ['image', 'video'] } },
    }),
    node('target', 400, 0, {
      params: { input: { display: 'input', type: 'video' } },
    }),
  ];
  const decorated = connectionTypes.decorateConnectionEdge(edge('edge', 'source', 'target'), nodes);
  const resolvedType = decorated.data.connectionType;
  const resolvedColor = connectionTypes.connectionColor(resolvedType);

  assert.equal(resolvedType, 'video');
  assert.equal(decorated.style.stroke, resolvedColor);
  assert.equal(decorated.markerEnd.color, resolvedColor);

  const dragSurfaceMarkup = renderToStaticMarkup(
    createElement(
      graphConnectionSurface.GraphConnectionSurface,
      { connectionColor: resolvedColor, 'data-testid': 'connection-drag-surface' },
      'drag surface',
    ),
  );
  assert.match(dragSurfaceMarkup, /data-testid="connection-drag-surface"/);
  assert.match(dragSurfaceMarkup, new RegExp(`--modiff-flow-connection-color:${resolvedColor}`, 'i'));

  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  let targetSocketMarkup;
  try {
    // React Flow reports the intentionally synthetic node id used by this
    // server-rendered fixture. The handle itself still renders its real style.
    console.error = () => {};
    console.warn = () => {};
    targetSocketMarkup = renderToStaticMarkup(
      createElement(
        ReactFlowProvider,
        null,
        createElement(graphTypedHandle.GraphTypedHandle, {
          connectionColor: resolvedColor,
          id: 'input',
          position: Position.Left,
          type: 'target',
        }),
      ),
    );
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
  assert.match(targetSocketMarkup, /data-handleid="input"/);
  assert.match(targetSocketMarkup, /target/);
  assert.match(targetSocketMarkup, new RegExp(`--modiff-flow-handle-color:${resolvedColor}`, 'i'));
});

test('unknown concrete types get deterministic contrast colors instead of neutral gray', () => {
  const first = connectionTypes.connectionColor('future_backend_payload');
  const second = connectionTypes.connectionColor('future_backend_payload');
  assert.equal(first, second);
  assert.match(first, /^hsl\(/);
  assert.notEqual(first, connectionTypes.NEUTRAL_CONNECTION_COLOR);
});

test('graph-safe controls preserve native semantics and centralize interaction states', () => {
  const buttonMarkup = renderToStaticMarkup(
    createElement(
      graphControls.GraphControlButton,
      {
        'aria-label': 'Remove node',
        'data-testid': 'remove-node',
        disabled: true,
      },
      'Remove',
    ),
  );
  assert.match(buttonMarkup, /type="button"/);
  assert.match(buttonMarkup, /aria-label="Remove node"/);
  assert.match(buttonMarkup, /data-testid="remove-node"/);
  assert.match(buttonMarkup, /disabled/);
  assert.match(buttonMarkup, /focus-visible:outline-modiff-focus/);
  assert.match(buttonMarkup, /disabled:pointer-events-none/);
  const titledButtonMarkup = renderToStaticMarkup(
    createElement(graphControls.GraphControlButton, { title: 'Open assets' }, 'icon'),
  );
  assert.match(titledButtonMarkup, /aria-label="Open assets"/);

  const inputMarkup = renderToStaticMarkup(
    createElement(graphControls.GraphControlInput, {
      'aria-invalid': true,
      max: 8,
      min: 1,
      name: 'steps',
      readOnly: true,
      step: 1,
      type: 'number',
      value: 4,
    }),
  );
  assert.match(inputMarkup, /type="number"/);
  assert.match(inputMarkup, /name="steps"/);
  assert.match(inputMarkup, /min="1"/);
  assert.match(inputMarkup, /max="8"/);
  assert.match(inputMarkup, /step="1"/);
  assert.match(inputMarkup, /readOnly/);
  assert.match(inputMarkup, /aria-invalid="true"/);
  assert.match(inputMarkup, /read-only:bg-modiff-disabled/);
  assert.match(inputMarkup, /aria-invalid:border-modiff-invalid/);

  const rangeMarkup = renderToStaticMarkup(
    createElement(graphControls.GraphControlInput, {
      'aria-label': 'Strength',
      max: 1,
      min: 0,
      step: 0.1,
      type: 'range',
      defaultValue: 0.5,
    }),
  );
  assert.match(rangeMarkup, /type="range"/);
  assert.match(rangeMarkup, /accent-hf-yellow/);
});

test('graph fields and overlays use graph-safe controls without losing specialized interaction contracts', () => {
  const scopedFiles = [
    ...fs
      .readdirSync(path.join(ROOT, 'src', 'fields'))
      .filter((entry) => entry.endsWith('.tsx'))
      .map((entry) => path.join('src', 'fields', entry)),
    'src/components/AnyNode.tsx',
    'src/components/CustomNode.tsx',
    'src/components/GraphFixDialog.tsx',
    'src/components/GraphList.tsx',
    'src/components/NodeContent.tsx',
    'src/components/NodeList.tsx',
    'src/components/NodeSearchDialog.tsx',
    'src/components/SelectionToolbar.tsx',
    'src/components/Workflow.tsx',
    'src/components/WorkflowTabsBar.tsx',
  ];
  const rawControlPattern = /<(?:button|input|textarea|select)\b/;
  const rawControls = scopedFiles.flatMap((relativePath) => {
    const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    return rawControlPattern.test(source) ? [relativePath] : [];
  });
  assert.deepEqual(rawControls, [], 'feature code must use shared controls rather than raw form elements');
  const customButtonRoles = scopedFiles.filter((relativePath) =>
    /role="button"/.test(fs.readFileSync(path.join(ROOT, relativePath), 'utf8')),
  );
  assert.deepEqual(customButtonRoles, [], 'feature code must keep interactive semantics inside shared controls');

  const numberField = fs.readFileSync(path.join(ROOT, 'src', 'fields', 'NumberField.tsx'), 'utf8');
  assert.match(numberField, /GraphControlInput/);
  assert.match(numberField, /className=.*nodrag/s);
  assert.match(numberField, /onBlur=\{handleBlur\}/);
  assert.match(numberField, /onKeyDown=\{handleKeyDown\}/);
  assert.match(numberField, /document\.addEventListener\('mousemove', handleMouseMove\)/);
  assert.match(numberField, /document\.removeEventListener\('mouseup', handleMouseUp\)/);
  assert.match(numberField, /updateStore\(fieldKey, nextValue\)/);

  const fileField = fs.readFileSync(path.join(ROOT, 'src', 'fields', 'FileBrowserField.tsx'), 'utf8');
  assert.match(fileField, /<GraphControlInput[\s\S]*type="file"/);
  assert.match(fileField, /ref=\{fileInputRef\}/);
  assert.match(fileField, /fileInputRef\.current\?\.click\(\)/);
  assert.match(fileField, /onDrop=\{handleFileDrop\}/);

  const selectionToolbar = fs.readFileSync(path.join(ROOT, 'src', 'components', 'SelectionToolbar.tsx'), 'utf8');
  assert.match(selectionToolbar, /nodrag nowheel/);
  assert.match(selectionToolbar, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(selectionToolbar, /onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);

  const nodeList = fs.readFileSync(path.join(ROOT, 'src', 'components', 'NodeList.tsx'), 'utf8');
  assert.match(nodeList, /<TreeButtonRow[\s\S]*data-testid=\{`user-block-row-[\s\S]*draggable[\s\S]*onDragStart=/);

  const selectField = fs.readFileSync(path.join(ROOT, 'src', 'fields', 'SelectField.tsx'), 'utf8');
  assert.doesNotMatch(selectField, /<(?:details|summary)\b/);
  assert.match(selectField, /<ModiffMultiSelect/);
  assert.doesNotMatch(selectField, /@headlessui\/react/);
  assert.match(selectField, /disabled=\{props\.disabled\}/);

  const selectDialogField = fs.readFileSync(path.join(ROOT, 'src', 'fields', 'SelectDialogField.tsx'), 'utf8');
  assert.match(selectDialogField, /<ModiffDialog/);
  assert.match(selectDialogField, /<ModiffCheckbox/);

  const handleField = fs.readFileSync(path.join(ROOT, 'src', 'fields', 'HandleField.tsx'), 'utf8');
  assert.match(handleField, /connectionTypeGradient\(visualType\)/);
  assert.match(handleField, /useShallow/);
  const nodeContent = fs.readFileSync(path.join(ROOT, 'src', 'components', 'NodeContent.tsx'), 'utf8');
  assert.match(nodeContent, /runtimeOptionValues\(options, \{ includeDisabled: true \}\)\.length > 0/);
  const workflow = fs.readFileSync(path.join(ROOT, 'src', 'components', 'Workflow.tsx'), 'utf8');
  assert.match(workflow, /connectionColor\(connectionDataType\)/);
});

test('layered layout is deterministic, separates ranks, and avoids sibling overlap', () => {
  const nodes = [node('a'), node('b'), node('c'), node('side')];
  const edges = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('aside', 'a', 'side')];
  const first = graphLayout.arrangeGraphNodes(nodes, edges);
  const second = graphLayout.arrangeGraphNodes(nodes, edges);
  assert.deepEqual(
    first.map(({ id, position }) => ({ id, position })),
    second.map(({ id, position }) => ({ id, position })),
  );
  const byId = new Map(first.map((item) => [item.id, item]));
  assert.ok(byId.get('b').position.x >= byId.get('a').position.x + 240 + 140);
  assert.ok(byId.get('c').position.x >= byId.get('b').position.x + 240 + 140);
  for (let left = 0; left < first.length; left += 1) {
    for (let right = left + 1; right < first.length; right += 1) {
      assert.equal(intersects(first[left], first[right]), false, `${first[left].id}/${first[right].id}`);
    }
  }
});

test('fan-in, Qwen outpaint, LoRA, and video-inpaint fixtures remain deterministic and readable', () => {
  const fixtures = [
    {
      name: 'fan-in',
      nodes: [
        node('source-a', 900, 0, { width: 260, height: 160 }),
        node('source-b', 900, 20, { width: 300, height: 220 }),
        node('merge', 420, 0, { width: 320, height: 260 }),
        node('output', 0, 0, { width: 240, height: 140 }),
      ],
      edges: [
        edge('a-merge', 'source-a', 'merge'),
        edge('b-merge', 'source-b', 'merge'),
        edge('merge-output', 'merge', 'output'),
      ],
    },
    {
      name: 'Qwen outpaint',
      nodes: [
        node('qwen-source', 1_000, 0, { width: 320, height: 260 }),
        node('qwen-mask', 1_000, 30, { width: 280, height: 190 }),
        node('qwen-runtime', 1_000, 60, { width: 360, height: 300 }),
        node('qwen-pipeline', 600, 0, { width: 340, height: 410 }),
        node('qwen-outpaint', 200, 0, { width: 420, height: 520 }),
        node('qwen-preview', -200, 0, { width: 260, height: 170 }),
      ],
      edges: [
        edge('qwen-runtime-pipeline', 'qwen-runtime', 'qwen-pipeline'),
        edge('qwen-pipeline-generate', 'qwen-pipeline', 'qwen-outpaint'),
        edge('qwen-source-generate', 'qwen-source', 'qwen-outpaint'),
        edge('qwen-mask-generate', 'qwen-mask', 'qwen-outpaint'),
        edge('qwen-generate-preview', 'qwen-outpaint', 'qwen-preview'),
      ],
    },
    {
      name: 'LoRA',
      nodes: [
        node('lora-quant', 1_200, 0, { width: 260, height: 210 }),
        node('lora-runtime', 900, 0, { width: 340, height: 320 }),
        node('lora-loader', 600, 0, { width: 360, height: 420 }),
        node('lora-adapter', 600, 40, { width: 300, height: 260 }),
        node('lora-generate', 200, 0, { width: 420, height: 500 }),
        node('lora-preview', -200, 0, { width: 260, height: 160 }),
      ],
      edges: [
        edge('lora-quant-runtime', 'lora-quant', 'lora-runtime'),
        edge('lora-runtime-loader', 'lora-runtime', 'lora-loader'),
        edge('lora-loader-generate', 'lora-loader', 'lora-generate'),
        edge('lora-adapter-generate', 'lora-adapter', 'lora-generate'),
        edge('lora-generate-preview', 'lora-generate', 'lora-preview'),
      ],
    },
    {
      name: 'video inpaint',
      nodes: [
        node('video-source', 900, 0, { width: 300, height: 230 }),
        node('video-mask', 900, 20, { width: 300, height: 230 }),
        node('video-pipeline', 900, 40, { width: 380, height: 440 }),
        node('video-inpaint', 350, 0, { width: 440, height: 540 }),
        node('video-export', -200, 0, { width: 280, height: 190 }),
      ],
      edges: [
        edge('video-source-inpaint', 'video-source', 'video-inpaint'),
        edge('video-mask-inpaint', 'video-mask', 'video-inpaint'),
        edge('video-pipeline-inpaint', 'video-pipeline', 'video-inpaint'),
        edge('video-inpaint-export', 'video-inpaint', 'video-export'),
      ],
    },
  ];

  fixtures.forEach((fixture) => {
    const beforeBackward = backwardEdgeCount(fixture.nodes, fixture.edges);
    const arranged = graphLayout.arrangeGraphNodes(fixture.nodes, fixture.edges);
    const repeated = graphLayout.arrangeGraphNodes(arranged, fixture.edges);
    assert.deepEqual(
      arranged.map(({ id, position, width, height }) => ({ id, position, width, height })),
      repeated.map(({ id, position, width, height }) => ({ id, position, width, height })),
      `${fixture.name} must reach a deterministic fixed point`,
    );
    assertSiblingClearance(arranged, fixture.name);
    assert.ok(
      backwardEdgeCount(arranged, fixture.edges) < beforeBackward,
      `${fixture.name} must reduce backward edges`,
    );
  });
});

test('barycentric sweeps reduce crossings without introducing backward edges', () => {
  const nodes = [
    node('source-1', 0, 0),
    node('source-2', 0, 220),
    node('source-3', 0, 440),
    node('target-1', 600, 0),
    node('target-2', 600, 220),
    node('target-3', 600, 440),
  ];
  const edges = [
    edge('cross-1', 'source-1', 'target-3'),
    edge('cross-2', 'source-2', 'target-2'),
    edge('cross-3', 'source-3', 'target-1'),
  ];
  const arranged = graphLayout.arrangeGraphNodes(nodes, edges);
  assert.ok(backwardEdgeCount(arranged, edges) <= backwardEdgeCount(nodes, edges));
  assert.ok(crossingCount(arranged, edges) < crossingCount(nodes, edges));
  assertSiblingClearance(arranged, 'crossing reduction');
});

test('cycles are collapsed into one rank and a loop is resized around locally arranged children', () => {
  const loop = node('loop', 0, 0, { type: 'loop', width: 360, height: 240 });
  loop.measured = { width: 360, height: 240 };
  const a = node('a', 0, 0, { parentId: 'loop' });
  const b = node('b', 0, 0, { parentId: 'loop' });
  const output = node('output');
  const nodes = [loop, a, b, output];
  const edges = [edge('ab', 'a', 'b'), edge('ba', 'b', 'a'), edge('out', 'b', 'output')];
  const arranged = graphLayout.arrangeGraphNodes(nodes, edges);
  const byId = new Map(arranged.map((item) => [item.id, item]));
  assert.equal(byId.get('a').position.x, byId.get('b').position.x);
  assert.ok(byId.get('b').position.y >= byId.get('a').position.y + 120 + graphLayout.GRAPH_LAYOUT_VERTICAL_GAP);
  assert.ok(byId.get('loop').width >= byId.get('a').position.x + 240 + 28);
  assert.ok(byId.get('loop').height >= byId.get('b').position.y + 120 + 64);
  assert.ok(byId.get('output').position.x >= byId.get('loop').position.x + byId.get('loop').width + 140);
});

test('measurement waiting requires two consecutive frames with identical dimensions', async () => {
  let reads = 0;
  const measuredNode = (width) =>
    node('measured', 0, 0, {
      width,
      height: 120,
    });
  await graphLayout.waitForGraphNodeMeasurements(() => {
    reads += 1;
    const current = measuredNode(reads === 1 ? 200 : 240);
    current.measured = { width: current.width, height: current.height };
    return [current];
  });
  assert.ok(reads >= 3, `expected a changed signature plus two stable frames, received ${reads} reads`);
});

test('graph finalization wait preserves failures and reports a bounded timeout', async () => {
  const failed = graphFinalization.settleGraphFinalization(Promise.reject(new Error('dynamic field failure')));
  const failedResult = await graphFinalization.waitForSettledGraphFinalization(failed, 100);
  assert.equal(failedResult.status, 'error');
  assert.equal(failedResult.error.message, 'dynamic field failure');

  let complete;
  const delayed = graphFinalization.settleGraphFinalization(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const timedOut = await graphFinalization.waitForSettledGraphFinalization(delayed, 1);
  assert.deepEqual(timedOut, { status: 'timeout' });
  complete('late topology');
  assert.deepEqual(await delayed, { status: 'complete', value: 'late topology' });
});

test('connection validity feedback overlays preserve the transmitted type color', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'theme', 'reactFlowStyles.ts'), 'utf8');
  const typeStroke = 'stroke: var(--modiff-flow-connection-color, var(--color-modiff-subtle-text));';
  const typeFill = 'fill: var(--modiff-flow-connection-color, var(--color-modiff-subtle-text));';
  const invalidPath = source.match(/\.invalid-connection \.react-flow__connection-path \{([\s\S]*?)\}/)?.[1] ?? '';
  const validPath = source.match(/\.valid-connection \.react-flow__connection-path \{([\s\S]*?)\}/)?.[1] ?? '';
  const invalidMarker = source.match(/\.invalid-connection #connection-marker rect \{([\s\S]*?)\}/)?.[1] ?? '';
  const validMarker = source.match(/\.valid-connection #connection-marker rect \{([\s\S]*?)\}/)?.[1] ?? '';

  assert.ok(invalidPath.includes(typeStroke));
  assert.ok(validPath.includes(typeStroke));
  assert.ok(invalidMarker.includes(typeFill));
  assert.ok(validMarker.includes(typeFill));
  assert.match(invalidPath, /drop-shadow\(.*--color-modiff-red/);
  assert.match(validPath, /drop-shadow\(.*--color-modiff-green/);
  assert.doesNotMatch(invalidPath, /stroke:\s*var\(--color-modiff-red\)/);
  assert.doesNotMatch(validPath, /stroke:\s*var\(--color-modiff-green\)/);
});

test('edge decoration survives restore, dynamic parameter replacement, connect, undo, and redo', () => {
  const nodes = [
    node('source', 0, 0, {
      params: { output: { display: 'output', type: ['video', 'image'] } },
    }),
    node('target', 400, 0, {
      params: { input: { display: 'input', type: ['image', 'video'] } },
    }),
  ];
  const rawEdge = edge('restored-edge', 'source', 'target');
  const store = flowStoreModule.useFlowStore.getState();
  store.replaceGraph({ nodes, edges: [rawEdge], viewport: { x: 0, y: 0, zoom: 1 } });
  assert.deepEqual(flowStoreModule.useFlowStore.getState().edges[0].data.connectionType, ['image', 'video']);

  flowStoreModule.useFlowStore.getState().setParam('target', 'input', 'video', 'type');
  assert.equal(flowStoreModule.useFlowStore.getState().edges[0].data.connectionType, 'video');

  flowStoreModule.useFlowStore.getState().replaceNodeParams('target', {
    input: { display: 'input', type: ['video', 'image'] },
  });
  assert.deepEqual(flowStoreModule.useFlowStore.getState().edges[0].data.connectionType, ['image', 'video']);

  flowStoreModule.useFlowStore.getState().onEdgesChange([{ id: 'restored-edge', type: 'remove' }]);
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);
  flowStoreModule.useFlowStore.getState().undo();
  assert.deepEqual(flowStoreModule.useFlowStore.getState().edges[0].data.connectionType, ['image', 'video']);
  flowStoreModule.useFlowStore.getState().redo();
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);

  flowStoreModule.useFlowStore.getState().onConnect({
    source: 'source',
    sourceHandle: 'output',
    target: 'target',
    targetHandle: 'input',
    edgeType: 'smoothstep',
  });
  const connected = flowStoreModule.useFlowStore.getState().edges[0];
  assert.deepEqual(connected.data.connectionType, ['image', 'video']);
  assert.equal(connected.style.stroke, connectionTypes.connectionColor(['image', 'video']));
  assert.equal(connected.markerEnd.color, connectionTypes.connectionColor(['image', 'video']));
});

test('edge decoration survives graph repair and blueprint insertion', () => {
  const repairNodes = [
    node('repair-source', 0, 0, {
      params: { output: { display: 'output', type: ['image', 'video'] } },
    }),
    node('repair-target', 400, 0, {
      params: { input: { display: 'input', type: 'video' } },
    }),
  ];
  const repaired = graphFixerModule.materializeGraphFixes({ nodes: repairNodes, edges: [], registry: {} }, [
    {
      id: 'repair-connect',
      issueId: 'missing-input',
      title: 'Connect video',
      description: 'Restore the video input.',
      confidence: 'safe',
      operations: [
        {
          kind: 'connect',
          source: { nodeId: 'repair-source', handle: 'output' },
          target: { nodeId: 'repair-target', handle: 'input' },
        },
      ],
    },
  ]);
  flowStoreModule.useFlowStore
    .getState()
    .replaceGraph(
      { nodes: repaired.nodes, edges: repaired.edges },
      { historyLabel: 'Fix graph', clearRemovedCache: false },
    );
  let repairedEdge = flowStoreModule.useFlowStore.getState().edges[0];
  assert.equal(repairedEdge.data.connectionType, 'video');
  assert.equal(repairedEdge.style.stroke, connectionTypes.connectionColor('video'));
  assert.equal(repairedEdge.markerEnd.color, connectionTypes.connectionColor('video'));

  const blueprintNodes = [
    node('blueprint-source', 0, 0, {
      params: { output: { display: 'output', type: ['audio', 'image'] } },
    }),
    node('blueprint-target', 400, 0, {
      params: { input: { display: 'input', type: 'audio' } },
    }),
  ];
  studioStoreModule.useStudioStore.setState({
    blueprints: [
      {
        id: 'typed-blueprint',
        name: 'Typed blueprint',
        nodes: blueprintNodes,
        edges: [edge('blueprint-edge', 'blueprint-source', 'blueprint-target')],
        exposedInputs: [],
        exposedOutputs: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
  studioStoreModule.useStudioStore.getState().insertBlueprint('typed-blueprint');
  const blueprintEdge = flowStoreModule.useFlowStore
    .getState()
    .edges.find((item) => item.data?.connectionType === 'audio');
  assert.ok(blueprintEdge, 'inserted blueprint edge must be decorated');
  assert.equal(blueprintEdge.style.stroke, connectionTypes.connectionColor('audio'));
  assert.equal(blueprintEdge.markerEnd.color, connectionTypes.connectionColor('audio'));
});

test('blueprints cannot copy managed ownership and explicit binding membership survives a missing-node refresh', () => {
  const originalNodes = [
    { ...managedNode('managed-source', 'prompt'), selected: true },
    { ...managedNode('managed-target', 'preview', { x: 400 }), selected: true },
  ];
  const originalEdges = [edge('managed-edge', 'managed-source', 'managed-target')];
  flowStoreModule.useFlowStore.setState({ nodes: originalNodes, edges: originalEdges });

  const blueprintId = studioStoreModule.useStudioStore.getState().createBlueprintFromSelection('Managed copy');
  assert.ok(blueprintId);
  const blueprint = studioStoreModule.useStudioStore.getState().blueprints.find((item) => item.id === blueprintId);
  assert.ok(blueprint);
  assert.ok(
    blueprint.nodes.every((item) => item.data?.studioOwned === undefined && item.data?.studioRole === undefined),
    'stored blueprint nodes must not retain internal managed provenance',
  );

  const binding = {
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    nodes: { prompt: 'managed-source', preview: 'managed-target' },
    managedNodeIds: ['managed-source', 'managed-target'],
    managedEdgeIds: ['managed-edge'],
    fingerprint: 'managed-blueprint-test',
    createdAt: 1,
    updatedAt: 1,
  };
  studioStoreModule.useStudioStore.setState({
    graphBinding: binding,
    graphFinalization: { status: 'complete', managedEdgeCount: 1 },
  });
  studioStoreModule.useStudioStore.getState().insertBlueprint(blueprintId);

  const insertedNodes = flowStoreModule.useFlowStore
    .getState()
    .nodes.filter((item) => !binding.managedNodeIds.includes(item.id));
  assert.equal(insertedNodes.length, 2);
  assert.ok(
    insertedNodes.every((item) => item.data.studioOwned === undefined && item.data.studioRole === undefined),
    'inserted blueprint nodes must remain ordinary user graph nodes',
  );
  assert.equal(graphBridge.inspectStudioGraphBindingDivergence()?.kind, 'extra_graph_node');

  const extension = managedNode('managed-extension', 'upscaler', { x: 800 });
  flowStoreModule.useFlowStore.setState({ nodes: [...originalNodes, extension], edges: originalEdges });
  studioStoreModule.useStudioStore.setState({ graphBinding: binding });
  const registered = graphBridge.refreshStudioManagedGraphBinding(['managed-extension']);
  assert.deepEqual(registered?.managedNodeIds, ['managed-source', 'managed-target', 'managed-extension']);

  flowStoreModule.useFlowStore.setState({ nodes: [originalNodes[1], extension], edges: [] });
  const refreshed = graphBridge.refreshStudioManagedGraphBinding();
  assert.ok(
    refreshed?.managedNodeIds.includes('managed-source'),
    'an edge refresh must not erase missing managed membership before divergence can report it',
  );
  assert.equal(graphBridge.inspectStudioGraphBindingDivergence()?.kind, 'missing_managed_node');
});

test('backend execution specs materialize exact image, video, and audio recipes with sealed receipts', async () => {
  const roleRows = [
    ['diffusersQuantization', 'modules.DiffusersRuntime.PipelineQuantizationConfigV2', -1280, -80],
    ['diffusersRecipe', 'modules.DiffusersRuntime.DiffusersExecutionRecipe', -900, -80],
    ['diffusersImagePipeline', 'modules.DiffusersImage.LoadPipeline', -520, -80],
    ['diffusersImageGenerate', 'modules.DiffusersImage.Generate', -120, -80],
    ['preview', 'modules.Image.Preview', 980, -80],
  ];
  const edgeRows = [
    ['diffusersQuantization', 'quantization_config', 'diffusersRecipe', 'quantization_config'],
    ['diffusersRecipe', 'execution_recipe', 'diffusersImagePipeline', 'execution_recipe'],
    ['diffusersImagePipeline', 'pipeline', 'diffusersImageGenerate', 'pipeline'],
    ['diffusersImageGenerate', 'images', 'preview', 'image'],
  ];
  const bindingRows = [
    ['diffusersQuantization', 'backend', 'quantizationMode'],
    ['diffusersQuantization', 'components', 'quantizedComponents'],
    ['diffusersQuantization', 'dtype', 'dtype'],
    ['diffusersRecipe', 'device_map', 'deviceMapNone'],
    ['diffusersRecipe', 'offload_mode', 'offloadMode'],
    ['diffusersRecipe', 'device', 'device'],
    ['diffusersRecipe', 'attention_backend', 'attentionBackend'],
    ['diffusersRecipe', 'attention_components', 'empty'],
    ['diffusersRecipe', 'vae_slicing', 'true'],
    ['diffusersRecipe', 'vae_tiling', 'true'],
    ['diffusersRecipe', 'regional_compile', 'regionalCompile'],
    ['diffusersRecipe', 'denoiser_cache', 'denoiserCache'],
    ['diffusersRecipe', 'layerwise_casting', 'layerwiseCasting'],
    ['diffusersRecipe', 'channels_last', 'channelsLast'],
    ['diffusersImagePipeline', 'model_id', 'artifact'],
    ['diffusersImagePipeline', 'pipeline_class', 'pipelineClass'],
    ['diffusersImagePipeline', 'mode', 'mode'],
    ['diffusersImagePipeline', 'dtype', 'dtype'],
    ['diffusersImagePipeline', 'device', 'device'],
    ['diffusersImagePipeline', 'quantization_mode', 'quantizationMode'],
    ['diffusersImagePipeline', 'quantized_components', 'pipelineQuantizedComponents'],
    ['diffusersImagePipeline', 'auto_offload', 'autoOffload'],
    ['diffusersImagePipeline', 'offload_mode', 'offloadMode'],
    ['diffusersImageGenerate', 'prompt', 'prompt'],
    ['diffusersImageGenerate', 'negative_prompt', 'negativePrompt'],
    ['diffusersImageGenerate', 'width', 'width'],
    ['diffusersImageGenerate', 'height', 'height'],
    ['diffusersImageGenerate', 'seed', 'seed'],
    ['diffusersImageGenerate', 'num_inference_steps', 'steps'],
    ['diffusersImageGenerate', 'guidance_scale', 'guidanceScale'],
    ['diffusersImageGenerate', 'strength', 'strength'],
    ['diffusersImageGenerate', 'output_type', 'outputType'],
    ['diffusersImageGenerate', 'max_sequence_length', 'maxSequenceLength'],
  ];
  const autoFields = [
    'resolvedArtifact',
    'artifact',
    'installTarget.repo',
    'modelRepo',
    'pipelineClass',
    'dtype',
    'offloadMode',
    'quantizedComponents',
    'attentionBackend',
    'regionalCompile',
    'denoiserCache',
    'layerwiseCasting',
    'channelsLast',
  ];
  const makeSpec = (modelType, profileId, repo, contentHash) => ({
    schemaVersion: 1,
    canonicalizationVersion: 1,
    id: `${profileId.split(':')[0]}:text-to-image:v1`,
    modelType,
    mode: 'text_to_image',
    executionProfileId: profileId,
    loaderModule: 'modules.DiffusersImage',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-image',
    pipelineClass: 'FluxPipeline',
    defaultRepo: repo,
    roles: structuredClone(roleRows),
    edges: structuredClone(edgeRows),
    bindings: structuredClone(bindingRows),
    autoFields: [...autoFields],
    actions: [],
    contentHash,
  });
  const schnellSpec = makeSpec(
    'FluxSchnellPipeline',
    'flux-schnell:direct',
    'black-forest-labs/FLUX.1-schnell',
    'studio-spec-v1-9cd1abb5',
  );
  const devSpec = makeSpec(
    'FluxDevPipeline',
    'flux-dev:direct',
    'black-forest-labs/FLUX.1-dev',
    'studio-spec-v1-d5ee399d',
  );
  const kreaSpec = makeSpec(
    'FluxKreaPipeline',
    'flux-krea:direct',
    'black-forest-labs/FLUX.1-Krea-dev',
    'studio-spec-v1-34a1abeb',
  );
  const kleinSpec = {
    ...makeSpec(
      'Flux2KleinPipeline',
      'flux2-klein:direct',
      'black-forest-labs/FLUX.2-klein-4B',
      'studio-spec-v1-e11dfdc6',
    ),
    id: 'flux2-klein:text-to-image:v1',
    pipelineClass: 'Flux2KleinPipeline',
  };
  const depthRoleRows = [
    ...roleRows.slice(0, 3),
    ['loadImage', 'modules.Image.Load', -520, 300],
    ['diffusersImageControl', 'modules.DiffusersImage.ControlGenerate', -120, -80],
    roleRows[4],
  ];
  const depthEdgeRows = [
    ...edgeRows.slice(0, 2),
    ['diffusersImagePipeline', 'pipeline', 'diffusersImageControl', 'pipeline'],
    ['loadImage', 'image', 'diffusersImageControl', 'control_image'],
    ['diffusersImageControl', 'images', 'preview', 'image'],
  ];
  const depthBindingRows = [
    ...bindingRows.slice(0, 23),
    ['loadImage', 'file', 'controlImage'],
    ['loadImage', 'alpha_channel', 'alphaMode'],
    ...bindingRows.slice(23).map(([, param, source]) => ['diffusersImageControl', param, source]),
  ];
  const depthSpec = {
    ...makeSpec(
      'FluxDepthPipeline',
      'flux-depth:direct',
      'black-forest-labs/FLUX.1-Depth-dev',
      'studio-spec-v1-2d8b881e',
    ),
    id: 'flux-depth:control-image:v1',
    mode: 'control_image',
    pipelineClass: 'FluxControlPipeline',
    roles: depthRoleRows,
    edges: depthEdgeRows,
    bindings: depthBindingRows,
  };
  const cannySpec = {
    ...depthSpec,
    id: 'flux-canny:control-image:v1',
    modelType: 'FluxCannyPipeline',
    executionProfileId: 'flux-canny:direct',
    defaultRepo: 'black-forest-labs/FLUX.1-Canny-dev',
    contentHash: 'studio-spec-v1-82045f56',
  };
  const editRoleRows = [
    ...roleRows.slice(0, 3),
    ['loadImage', 'modules.Image.Load', -520, 300],
    ['diffusersImageEdit', 'modules.DiffusersImage.Edit', -120, -80],
    roleRows[4],
  ];
  const editEdgeRows = [
    ...edgeRows.slice(0, 2),
    ['diffusersImagePipeline', 'pipeline', 'diffusersImageEdit', 'pipeline'],
    ['loadImage', 'image', 'diffusersImageEdit', 'image'],
    ['diffusersImageEdit', 'images', 'preview', 'image'],
  ];
  const editBindingRows = [
    ...bindingRows.slice(0, 23),
    ['loadImage', 'file', 'referenceImages'],
    ['loadImage', 'alpha_channel', 'alphaMode'],
    ...bindingRows.slice(23, 31).map(([, param, source]) => ['diffusersImageEdit', param, source]),
    ['diffusersImageEdit', 'reference_strength', 'conditioningScale'],
    ...bindingRows.slice(31).map(([, param, source]) => ['diffusersImageEdit', param, source]),
  ];
  const kleinEditSpec = {
    ...kleinSpec,
    id: 'flux2-klein:edit-image:v1',
    mode: 'edit_image',
    roles: editRoleRows,
    edges: editEdgeRows,
    bindings: editBindingRows,
    contentHash: 'studio-spec-v1-ab4da919',
  };
  const kleinMultiSpec = {
    ...kleinEditSpec,
    id: 'flux2-klein:multi-image-reference-edit:v1',
    mode: 'multi_image_reference_edit',
    contentHash: 'studio-spec-v1-756c2d69',
  };
  const reduxSpec = {
    ...makeSpec(
      'FluxReduxPipeline',
      'flux-redux:direct',
      'black-forest-labs/FLUX.1-Redux-dev',
      'studio-spec-v1-18e2c4ac',
    ),
    id: 'flux-redux:edit-image:v1',
    mode: 'edit_image',
    pipelineClass: 'FluxReduxPipeline',
    roles: editRoleRows,
    edges: editEdgeRows,
    bindings: editBindingRows,
  };
  const kontextSpec = {
    ...reduxSpec,
    id: 'flux-kontext:edit-image:v1',
    modelType: 'FluxKontextPipeline',
    executionProfileId: 'flux-kontext:direct',
    pipelineClass: 'FluxKontextPipeline',
    defaultRepo: 'black-forest-labs/FLUX.1-Kontext-dev',
    contentHash: 'studio-spec-v1-393009a9',
  };
  const kontextMultiSpec = {
    ...kontextSpec,
    id: 'flux-kontext:multi-image-reference-edit:v1',
    mode: 'multi_image_reference_edit',
    contentHash: 'studio-spec-v1-aa060039',
  };
  const inpaintRoleRows = [
    ...roleRows.slice(0, 3),
    ['loadImage', 'modules.Image.Load', -520, 300],
    ['loadMask', 'modules.Image.Load', -520, 560],
    ['diffusersImageInpaint', 'modules.DiffusersImage.Inpaint', -120, -80],
    roleRows[4],
  ];
  const inpaintEdgeRows = [
    ...edgeRows.slice(0, 2),
    ['diffusersImagePipeline', 'pipeline', 'diffusersImageInpaint', 'pipeline'],
    ['loadImage', 'image', 'diffusersImageInpaint', 'image'],
    ['loadMask', 'image', 'diffusersImageInpaint', 'mask_image'],
    ['diffusersImageInpaint', 'images', 'preview', 'image'],
  ];
  const inpaintBindingRows = [
    ...bindingRows.slice(0, 23),
    ['loadImage', 'file', 'referenceImages'],
    ['loadImage', 'alpha_channel', 'alphaMode'],
    ['loadMask', 'file', 'maskImage'],
    ['loadMask', 'alpha_channel', 'removeAlpha'],
    ...bindingRows.slice(23, 31).map(([, param, source]) => ['diffusersImageInpaint', param, source]),
    ['diffusersImageInpaint', 'reference_strength', 'conditioningScale'],
    ...bindingRows.slice(31).map(([, param, source]) => ['diffusersImageInpaint', param, source]),
  ];
  const fillSpec = {
    ...makeSpec('FluxFillPipeline', 'flux-fill:direct', 'black-forest-labs/FLUX.1-Fill-dev', 'studio-spec-v1-ba8c8dd1'),
    id: 'flux-fill:inpaint:v1',
    mode: 'inpaint',
    pipelineClass: 'FluxFillPipeline',
    roles: inpaintRoleRows,
    edges: inpaintEdgeRows,
    bindings: inpaintBindingRows,
  };
  const fillOutpaintSpec = {
    ...fillSpec,
    id: 'flux-fill:outpaint:v1',
    mode: 'outpaint',
    contentHash: 'studio-spec-v1-5c0d7413',
  };
  const qwenInpaintSpec = {
    ...fillSpec,
    id: 'qwen-image-edit:inpaint:v1',
    modelType: 'QwenImageEditModularPipeline',
    executionProfileId: 'qwen-edit:direct-inpaint',
    pipelineClass: 'QwenImageEditInpaintPipeline',
    defaultRepo: 'Qwen/Qwen-Image-Edit',
    contentHash: 'studio-spec-v1-ac52abb3',
  };
  const videoRoleRows = [
    ['diffusersQuantization', 'modules.DiffusersRuntime.PipelineQuantizationConfigV2', -1280, -80],
    ['diffusersRecipe', 'modules.DiffusersRuntime.DiffusersExecutionRecipe', -900, -80],
    ['wanPipeline', 'modules.DiffusersVideo.LoadPipeline', -520, -80],
    ['wanGenerate', 'modules.DiffusersVideo.Generate', 220, -80],
    ['videoExport', 'modules.Video.Export', 640, -80],
  ];
  const videoEdgeRows = [
    ['diffusersQuantization', 'quantization_config', 'diffusersRecipe', 'quantization_config'],
    ['diffusersRecipe', 'execution_recipe', 'wanPipeline', 'execution_recipe'],
    ['wanPipeline', 'pipeline', 'wanGenerate', 'pipeline'],
    ['wanGenerate', 'video_out', 'videoExport', 'video'],
  ];
  const videoBindingRows = [
    ['diffusersQuantization', 'backend', 'quantizationMode'],
    ['diffusersQuantization', 'components', 'quantizedComponents'],
    ['diffusersQuantization', 'dtype', 'dtype'],
    ['diffusersRecipe', 'device_map', 'deviceMapNone'],
    ['diffusersRecipe', 'offload_mode', 'offloadMode'],
    ['diffusersRecipe', 'device', 'device'],
    ['diffusersRecipe', 'attention_backend', 'nativeFlashAttention'],
    ['diffusersRecipe', 'attention_components', 'transformer'],
    ['diffusersRecipe', 'vae_slicing', 'true'],
    ['diffusersRecipe', 'vae_tiling', 'videoVaeTiling'],
    ['diffusersRecipe', 'regional_compile', 'regionalCompile'],
    ['diffusersRecipe', 'denoiser_cache', 'denoiserCache'],
    ['diffusersRecipe', 'layerwise_casting', 'layerwiseCasting'],
    ['diffusersRecipe', 'channels_last', 'channelsLast'],
    ['wanPipeline', 'model_id', 'artifact'],
    ['wanPipeline', 'pipeline_class', 'pipelineClass'],
    ['wanPipeline', 'revision', 'empty'],
    ['wanPipeline', 'dtype', 'dtype'],
    ['wanPipeline', 'device', 'device'],
    ['wanPipeline', 'auto_offload', 'autoOffload'],
    ['wanPipeline', 'offload_mode', 'offloadMode'],
    ['wanGenerate', 'prompt', 'prompt'],
    ['wanGenerate', 'mode', 'mode'],
    ['wanGenerate', 'negative_prompt', 'negativePrompt'],
    ['wanGenerate', 'width', 'width'],
    ['wanGenerate', 'height', 'height'],
    ['wanGenerate', 'seed', 'seed'],
    ['wanGenerate', 'num_frames', 'numFrames'],
    ['wanGenerate', 'num_inference_steps', 'steps'],
    ['wanGenerate', 'guidance_scale', 'guidanceScale'],
    ['wanGenerate', 'scheduler_flow_shift', 'shift'],
    ['wanGenerate', 'conditioning_scale', 'conditioningScale'],
    ['wanGenerate', 'strength', 'strength'],
    ['wanGenerate', 'denoise_strength', 'strength'],
    ['wanGenerate', 'frame_rate', 'fps'],
    ['wanGenerate', 'guidance_scale_2', 'guidanceScale2'],
    ['wanGenerate', 'use_guidance_scale_2', 'useGuidanceScale2'],
    ['wanGenerate', 'output_type', 'outputType'],
    ['wanGenerate', 'max_sequence_length', 'maxSequenceLength'],
    ['wanGenerate', 'attention_kwargs_json', 'attentionKwargsJson'],
    ['videoExport', 'fps', 'fps'],
  ];
  const ti2vSpec = {
    ...makeSpec(
      'WanTI2VPipeline',
      'wan-22-ti2v-5b:direct',
      'Wan-AI/Wan2.2-TI2V-5B-Diffusers',
      'studio-spec-v1-da22e734',
    ),
    id: 'wan-22-ti2v-5b:text-to-video:v1',
    mode: 'text_to_video',
    executionPath: 'direct-diffusers-video',
    loaderModule: 'modules.DiffusersVideo',
    pipelineClass: 'WanTI2VPipeline',
    roles: videoRoleRows,
    edges: videoEdgeRows,
    bindings: videoBindingRows,
  };
  const wanT2vSpec = {
    ...ti2vSpec,
    id: 'wan-21-t2v-1.3b:text-to-video:v1',
    modelType: 'WanVideoPipeline',
    executionProfileId: 'wan-text-to-video:direct',
    pipelineClass: 'WanPipeline',
    defaultRepo: 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers',
    contentHash: 'studio-spec-v1-10c9a3f2',
  };
  const wanVaceT2vSpec = {
    ...wanT2vSpec,
    id: 'wan-vace-1.3b:text-to-video:v1',
    modelType: 'WanVACEPipeline',
    executionProfileId: 'wan-vace:direct',
    executionPath: 'direct-wan-vace',
    pipelineClass: 'WanVACEPipeline',
    defaultRepo: 'Wan-AI/Wan2.1-VACE-1.3B-diffusers',
    contentHash: 'studio-spec-v1-b4b251f0',
  };
  const wanV2vRoleRows = [
    ...videoRoleRows,
    ['loadVideo', 'modules.Video.Load', -520, 260],
    ['normalizeVideo', 'modules.VideoConditioning.Normalize', -160, 260],
  ];
  const wanV2vEdgeRows = [
    ...videoEdgeRows,
    ['loadVideo', 'video', 'normalizeVideo', 'video'],
    ['normalizeVideo', 'output', 'wanGenerate', 'video'],
  ];
  const wanV2vBindingRows = [
    ...videoBindingRows,
    ['loadVideo', 'file', 'sourceVideo'],
    ['normalizeVideo', 'width', 'width'],
    ['normalizeVideo', 'height', 'height'],
    ['normalizeVideo', 'num_frames', 'numFrames'],
  ];
  const wanV2vSpec = {
    ...wanT2vSpec,
    id: 'wan-21-t2v-1.3b:video-to-video:v1',
    mode: 'video_to_video',
    executionProfileId: 'wan-video-to-video:direct',
    pipelineClass: 'WanVideoToVideoPipeline',
    roles: wanV2vRoleRows,
    edges: wanV2vEdgeRows,
    bindings: wanV2vBindingRows,
    contentHash: 'studio-spec-v1-473c930e',
  };
  const wanColorSpec = {
    ...wanV2vSpec,
    id: 'wan-21-t2v-1.3b:video-color-edit:v1',
    mode: 'video_color_edit',
    contentHash: 'studio-spec-v1-0be460bc',
  };
  const ltxBindingRows = videoBindingRows
    .filter(([role, param]) => role !== 'wanGenerate' || param !== 'scheduler_flow_shift')
    .map(([role, param, source]) => [
      role,
      param,
      role === 'diffusersRecipe' && param === 'attention_backend'
        ? 'nativeMath'
        : role === 'diffusersRecipe' && param === 'attention_components'
          ? 'empty'
          : source,
    ]);
  const ltxSpec = {
    ...ti2vSpec,
    id: 'ltx-video-0.9.8-13b-distilled:text-to-video:v1',
    modelType: 'LTXVideoPipeline',
    executionProfileId: 'ltx-video:direct',
    pipelineClass: 'LTXConditionPipeline',
    defaultRepo: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
    bindings: ltxBindingRows,
    contentHash: 'studio-spec-v1-8f100d39',
  };
  const i2vRoleRows = [...videoRoleRows, ['loadImage', 'modules.Image.Load', -520, 300]];
  const i2vEdgeRows = [...videoEdgeRows, ['loadImage', 'image', 'wanGenerate', 'reference_images']];
  const i2vBindingRows = [
    ...videoBindingRows
      .filter(([role, param]) => role !== 'wanGenerate' || param !== 'scheduler_flow_shift')
      .map(([role, param, source]) => [
        role,
        param,
        role === 'diffusersQuantization' && param === 'components'
          ? 'dualQuantizedComponents'
          : role === 'diffusersRecipe' && param === 'attention_components'
            ? 'dualTransformer'
            : role === 'diffusersRecipe' && param === 'vae_tiling'
              ? 'true'
              : source,
      ]),
    ['loadImage', 'file', 'referenceImages'],
    ['loadImage', 'alpha_channel', 'alphaMode'],
  ];
  const i2vSpec = {
    ...makeSpec(
      'WanImageToVideoPipeline',
      'wan-22-image-to-video:direct',
      'Wan-AI/Wan2.2-I2V-A14B-Diffusers',
      'studio-spec-v1-fed2321d',
    ),
    id: 'wan-22-i2v-a14b:image-to-video:v1',
    mode: 'image_to_video',
    executionPath: 'direct-diffusers-video',
    loaderModule: 'modules.DiffusersVideo',
    pipelineClass: 'WanImageToVideoPipeline',
    roles: i2vRoleRows,
    edges: i2vEdgeRows,
    bindings: i2vBindingRows,
  };
  const ltxImageSpec = {
    ...ltxSpec,
    id: 'ltx-video-0.9.8-13b-distilled:image-to-video:v1',
    mode: 'image_to_video',
    roles: i2vRoleRows,
    edges: i2vEdgeRows,
    bindings: [
      ...ltxBindingRows,
      ['loadImage', 'file', 'referenceImages'],
      ['loadImage', 'alpha_channel', 'alphaMode'],
    ],
    contentHash: 'studio-spec-v1-71f17ad0',
  };
  const ltxVideoSpec = {
    ...ltxSpec,
    id: 'ltx-video-0.9.8-13b-distilled:video-to-video:v1',
    mode: 'video_to_video',
    roles: wanV2vRoleRows,
    edges: wanV2vEdgeRows,
    bindings: [
      ...ltxBindingRows.map(([role, param, source]) => [
        role,
        param,
        role === 'wanGenerate' && param === 'strength' ? 'conditioningScale' : source,
      ]),
      ['loadVideo', 'file', 'sourceVideo'],
      ['normalizeVideo', 'width', 'width'],
      ['normalizeVideo', 'height', 'height'],
      ['normalizeVideo', 'num_frames', 'numFrames'],
    ],
    contentHash: 'studio-spec-v1-ad97d224',
  };
  const ltxReferenceSpec = {
    ...ltxImageSpec,
    id: 'ltx-video-0.9.8-13b-distilled:reference-to-video:v1',
    mode: 'reference_to_video',
    contentHash: 'studio-spec-v1-0c5abd50',
  };
  const audioRoleRows = [
    ['diffusersQuantization', 'modules.DiffusersRuntime.PipelineQuantizationConfigV2', -1280, -80],
    ['diffusersRecipe', 'modules.DiffusersRuntime.DiffusersExecutionRecipe', -900, -80],
    ['audioPipeline', 'modules.DiffusersAudio.LoadPipeline', -520, -80],
    ['audioGenerate', 'modules.DiffusersAudio.Generate', -120, -80],
    ['audioExport', 'modules.Audio.Export', 1060, -80],
  ];
  const audioEdgeRows = [
    ['diffusersQuantization', 'quantization_config', 'diffusersRecipe', 'quantization_config'],
    ['diffusersRecipe', 'execution_recipe', 'audioPipeline', 'execution_recipe'],
    ['audioPipeline', 'pipeline', 'audioGenerate', 'pipeline'],
    ['audioGenerate', 'audio', 'audioExport', 'audio'],
  ];
  const audioBindingRows = [
    ...videoBindingRows
      .slice(0, 14)
      .map(([role, param, source]) => [
        role,
        param,
        source === 'nativeFlashAttention' ? 'attentionBackend' : source === 'transformer' ? 'empty' : source,
      ]),
    ['audioPipeline', 'model_id', 'artifact'],
    ['audioPipeline', 'pipeline_class', 'pipelineClass'],
    ['audioPipeline', 'mode', 'mode'],
    ['audioPipeline', 'dtype', 'dtype'],
    ['audioPipeline', 'device', 'device'],
    ['audioPipeline', 'auto_offload', 'autoOffload'],
    ['audioPipeline', 'offload_mode', 'offloadMode'],
    ['audioGenerate', 'task_type', 'text2music'],
    ['audioGenerate', 'prompt', 'prompt'],
    ['audioGenerate', 'negative_prompt', 'negativePrompt'],
    ['audioGenerate', 'lyrics', 'lyrics'],
    ['audioGenerate', 'audio_duration', 'audioDuration'],
    ['audioGenerate', 'extension_duration', 'extensionDuration'],
    ['audioGenerate', 'vocal_language', 'vocalLanguage'],
    ['audioGenerate', 'seed', 'seed'],
    ['audioGenerate', 'num_inference_steps', 'steps'],
    ['audioGenerate', 'guidance_scale', 'guidanceScale'],
    ['audioGenerate', 'shift', 'shift'],
    ['audioGenerate', 'bpm', 'bpmNormalized'],
    ['audioGenerate', 'keyscale', 'keyscale'],
    ['audioGenerate', 'timesignature', 'timesignature'],
    ['audioGenerate', 'repainting_start', 'repaintingStart'],
    ['audioGenerate', 'repainting_end', 'repaintingEnd'],
    ['audioGenerate', 'audio_cover_strength', 'audioCoverStrength'],
    ['audioGenerate', 'return_continuation_tail', 'false'],
    ['audioGenerate', 'sample_rate', 'sampleRate48000'],
    ['audioExport', 'sample_rate', 'sampleRate48000'],
  ];
  const audioVariationRoleRows = [['loadAudio', 'modules.Audio.Load', -520, 300], ...audioRoleRows];
  const audioVariationEdgeRows = [
    ['diffusersQuantization', 'quantization_config', 'diffusersRecipe', 'quantization_config'],
    ['diffusersRecipe', 'execution_recipe', 'audioPipeline', 'execution_recipe'],
    ['audioPipeline', 'pipeline', 'audioGenerate', 'pipeline'],
    ['loadAudio', 'audio', 'audioGenerate', 'source_audio'],
    ['audioGenerate', 'audio', 'audioExport', 'audio'],
  ];
  const audioVariationBindingRows = [
    ['loadAudio', 'file', 'sourceAudio'],
    ...audioBindingRows.map(([role, param, source]) => [
      role,
      param,
      role === 'audioGenerate' && param === 'task_type' ? 'cover' : source,
    ]),
  ];
  const audioContinuationRoleRows = [
    ...audioVariationRoleRows,
    ['audioLoudnessMatch', 'modules.Audio.MatchLoudness', 300, -80],
    ['audioJoin', 'modules.Audio.Join', 680, -80],
  ];
  const audioContinuationEdgeRows = [
    ['diffusersQuantization', 'quantization_config', 'diffusersRecipe', 'quantization_config'],
    ['diffusersRecipe', 'execution_recipe', 'audioPipeline', 'execution_recipe'],
    ['audioPipeline', 'pipeline', 'audioGenerate', 'pipeline'],
    ['loadAudio', 'audio', 'audioGenerate', 'source_audio'],
    ['audioGenerate', 'audio', 'audioLoudnessMatch', 'audio'],
    ['loadAudio', 'audio', 'audioLoudnessMatch', 'reference'],
    ['audioLoudnessMatch', 'output', 'audioJoin', 'continuation'],
    ['loadAudio', 'audio', 'audioJoin', 'source'],
    ['audioJoin', 'output', 'audioExport', 'audio'],
  ];
  const audioContinuationBindingRows = [
    ['loadAudio', 'file', 'sourceAudio'],
    ...audioBindingRows.map(([role, param, source]) => [
      role,
      param,
      role === 'audioGenerate' && param === 'task_type'
        ? 'continuation'
        : role === 'audioGenerate' && param === 'return_continuation_tail'
          ? 'true'
          : source,
    ]),
    ['audioLoudnessMatch', 'reference_window_seconds', 'referenceWindow15'],
    ['audioLoudnessMatch', 'target_peak_dbfs', 'targetPeakMinus1'],
    ['audioLoudnessMatch', 'max_adjustment_db', 'maxAdjustment12'],
    ['audioJoin', 'boundary_fade_seconds', 'boundaryFade001'],
  ];
  const audioRepaintBindingRows = [
    ['loadAudio', 'file', 'sourceAudio'],
    ...audioBindingRows.map(([role, param, source]) => [
      role,
      param,
      role === 'audioGenerate' && param === 'task_type' ? 'repaint' : source,
    ]),
  ];
  const aceSpec = {
    ...makeSpec(
      'AceStepAudioPipeline',
      'ace-step-audio:direct',
      'ACE-Step/acestep-v15-xl-turbo-diffusers',
      'studio-spec-v1-4bc8ed64',
    ),
    id: 'ace-step-v1.5-xl-turbo:text-to-audio:v1',
    mode: 'text_to_audio',
    loaderModule: 'modules.DiffusersAudio',
    executionPath: 'direct-diffusers-audio',
    pipelineClass: 'AceStepPipeline',
    roles: audioRoleRows,
    edges: audioEdgeRows,
    bindings: audioBindingRows,
  };
  const aceVariationSpec = {
    ...aceSpec,
    id: 'ace-step-v1.5-xl-turbo:audio-variation:v1',
    mode: 'audio_variation',
    roles: audioVariationRoleRows,
    edges: audioVariationEdgeRows,
    bindings: audioVariationBindingRows,
    contentHash: 'studio-spec-v1-eb222623',
  };
  const aceContinuationSpec = {
    ...aceSpec,
    id: 'ace-step-v1.5-xl-turbo:audio-continuation:v1',
    mode: 'audio_continuation',
    roles: audioContinuationRoleRows,
    edges: audioContinuationEdgeRows,
    bindings: audioContinuationBindingRows,
    contentHash: 'studio-spec-v1-541adefc',
  };
  const aceRepaintSpec = {
    ...aceSpec,
    id: 'ace-step-v1.5-xl-turbo:audio-repaint:v1',
    mode: 'audio_repaint',
    roles: audioVariationRoleRows,
    edges: audioVariationEdgeRows,
    bindings: audioRepaintBindingRows,
    contentHash: 'studio-spec-v1-8f5c37c7',
  };
  const profile = (spec) => ({
    id: spec.executionProfileId,
    model_type: spec.modelType,
    modes: [spec.mode],
    loader_module: spec.loaderModule,
    loader_action: spec.loaderAction,
    execution_path: spec.executionPath,
    backend_path: `${spec.loaderModule}.${spec.loaderAction}`,
    pipeline_class: spec.pipelineClass,
    default_repo: spec.defaultRepo,
    fallback_repo: null,
    quantizable_components: ['transformer', 'text_encoder_2'],
    default_quantized_components: [],
    supported_offload_modes: ['none', 'model_cpu'],
    retry_offload_modes: ['model_cpu'],
    live_proof: false,
  });
  const capability = (spec) => ({
    modelType: spec.modelType,
    modes: [spec.mode],
    runnableModes: [spec.mode],
    executionProfiles: [profile(spec)],
    studioExecutionSpecSchemaVersion: 1,
    studioExecutionSpecModes: [spec.mode],
    studioExecutionSpecs: [spec],
  });
  const kontextCapability = {
    ...capability(kontextSpec),
    modes: ['edit_image', 'multi_image_reference_edit'],
    runnableModes: ['edit_image', 'multi_image_reference_edit'],
    executionProfiles: [
      {
        ...profile(kontextSpec),
        modes: ['edit_image', 'multi_image_reference_edit'],
      },
    ],
    studioExecutionSpecModes: ['edit_image', 'multi_image_reference_edit'],
    studioExecutionSpecs: [kontextSpec, kontextMultiSpec],
  };
  const fillCapability = {
    ...capability(fillSpec),
    modes: ['inpaint', 'outpaint'],
    runnableModes: ['inpaint', 'outpaint'],
    executionProfiles: [{ ...profile(fillSpec), modes: ['inpaint', 'outpaint'] }],
    studioExecutionSpecModes: ['inpaint', 'outpaint'],
    studioExecutionSpecs: [fillSpec, fillOutpaintSpec],
  };
  const qwenInpaintCapability = {
    ...capability(qwenInpaintSpec),
    modes: ['edit_image', 'inpaint', 'outpaint'],
    runnableModes: ['edit_image', 'inpaint', 'outpaint'],
    executionProfiles: [
      {
        ...profile(qwenInpaintSpec),
        modes: ['inpaint', 'outpaint'],
        quantizable_components: ['transformer', 'text_encoder'],
        default_quantized_components: ['transformer', 'text_encoder'],
      },
    ],
  };
  const kleinCapability = {
    ...capability(kleinSpec),
    modes: ['text_to_image', 'edit_image', 'multi_image_reference_edit'],
    runnableModes: ['text_to_image', 'edit_image', 'multi_image_reference_edit'],
    executionProfiles: [
      {
        ...profile(kleinSpec),
        modes: ['text_to_image', 'edit_image', 'multi_image_reference_edit'],
      },
    ],
    studioExecutionSpecModes: ['text_to_image', 'edit_image', 'multi_image_reference_edit'],
    studioExecutionSpecs: [kleinSpec, kleinEditSpec, kleinMultiSpec],
  };
  const aceCapability = {
    ...capability(aceSpec),
    modes: ['text_to_audio', 'audio_variation', 'audio_continuation', 'audio_repaint'],
    runnableModes: ['text_to_audio', 'audio_variation', 'audio_continuation', 'audio_repaint'],
    executionProfiles: [
      {
        ...profile(aceSpec),
        modes: ['text_to_audio', 'audio_variation', 'audio_continuation', 'audio_repaint'],
        quantizable_components: [],
      },
    ],
    studioExecutionSpecModes: ['audio_continuation', 'audio_repaint', 'audio_variation', 'text_to_audio'],
    studioExecutionSpecs: [aceSpec, aceVariationSpec, aceContinuationSpec, aceRepaintSpec],
  };
  const scalar = (value = null) => ({ type: 'string', display: 'text', value });
  const registryRoleRows = [
    ...roleRows,
    ...depthRoleRows.filter(([role]) => !roleRows.some(([id]) => id === role)),
    ...editRoleRows.filter(([role]) => ![...roleRows, ...depthRoleRows].some(([id]) => id === role)),
    ...inpaintRoleRows.filter(
      ([role]) => ![...roleRows, ...depthRoleRows, ...editRoleRows].some(([id]) => id === role),
    ),
    ...videoRoleRows.filter(([role]) => ![...roleRows, ...depthRoleRows, ...editRoleRows].some(([id]) => id === role)),
    ...i2vRoleRows.filter(
      ([role]) => ![...roleRows, ...depthRoleRows, ...editRoleRows, ...videoRoleRows].some(([id]) => id === role),
    ),
    ['loadVideo', 'modules.Video.Load', -520, 260],
    ['normalizeVideo', 'modules.VideoConditioning.Normalize', -160, 260],
    ['audioPipeline', 'modules.DiffusersAudio.LoadPipeline', -520, -80],
    ['audioGenerate', 'modules.DiffusersAudio.Generate', -120, -80],
    ['audioExport', 'modules.Audio.Export', 1060, -80],
    ['loadAudio', 'modules.Audio.Load', -900, 300],
    ['audioLoudnessMatch', 'modules.Audio.MatchLoudness', 300, -80],
    ['audioJoin', 'modules.Audio.Join', 680, -80],
  ];
  const paramsByRole = Object.fromEntries(registryRoleRows.map(([role]) => [role, {}]));
  for (const [role, param] of [
    ...bindingRows,
    ...depthBindingRows,
    ...editBindingRows,
    ...inpaintBindingRows,
    ...videoBindingRows,
    ...i2vBindingRows,
    ...wanV2vBindingRows,
    ...ltxBindingRows,
    ...audioBindingRows,
    ...audioContinuationBindingRows,
  ])
    paramsByRole[role][param] = scalar();
  for (const [sourceRole, sourceHandle, targetRole, targetHandle] of [
    ...edgeRows,
    ...depthEdgeRows,
    ...editEdgeRows,
    ...inpaintEdgeRows,
    ...videoEdgeRows,
    ...i2vEdgeRows,
    ['loadVideo', 'video', 'normalizeVideo', 'video'],
    ['normalizeVideo', 'output', 'wanGenerate', 'video'],
    ...audioEdgeRows,
    ...audioContinuationEdgeRows,
  ]) {
    const type = sourceHandle;
    paramsByRole[sourceRole][sourceHandle] = { type, display: 'output' };
    paramsByRole[targetRole][targetHandle] = { type, display: 'input' };
  }
  paramsByRole.loadVideo.file = scalar();
  paramsByRole.normalizeVideo.width = scalar();
  paramsByRole.normalizeVideo.height = scalar();
  paramsByRole.normalizeVideo.num_frames = scalar();
  paramsByRole.audioExport.file = scalar();
  paramsByRole.loadAudio.file = scalar();
  paramsByRole.loadAudio.audio = { type: 'audio', display: 'output' };
  paramsByRole.audioGenerate.source_audio = { type: 'audio', display: 'input' };
  paramsByRole.audioGenerate.reference_audio = { type: 'audio', display: 'input' };
  paramsByRole.audioLoudnessMatch.output = { type: 'audio', display: 'output' };
  paramsByRole.audioJoin.continuation = { type: 'audio', display: 'input' };
  paramsByRole.audioJoin.output = { type: 'audio', display: 'output' };
  paramsByRole.audioExport.audio = { type: 'audio', display: 'input' };
  paramsByRole.diffusersImagePipeline.pipeline_class.value = 'FluxPipeline';
  const registry = Object.fromEntries(
    registryRoleRows.map(([role, nodeKey]) => {
      const [module, action] = nodeKey.split(/\.(?=[^.]+$)/);
      return [
        nodeKey,
        {
          type: 'custom',
          module,
          action,
          label: action,
          category: 'Test',
          params: structuredClone(paramsByRole[role]),
        },
      ];
    }),
  );
  const previousNodesState = nodesStoreModule.useNodesStore.getState();
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const topology = (binding) =>
    flowStoreModule.useFlowStore
      .getState()
      .edges.map((item) => [
        Object.entries(binding.nodes).find(([, id]) => id === item.source)?.[0],
        item.sourceHandle,
        Object.entries(binding.nodes).find(([, id]) => id === item.target)?.[0],
        item.targetHandle,
      ])
      .sort();
  const nativeWebSocket = globalThis.WebSocket;
  const nativeFetch = globalThis.fetch;
  globalThis.WebSocket = undefined;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: false, nodes: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  try {
    nodesStoreModule.useNodesStore.setState({
      nodesRegistry: registry,
      studioModelCapabilities: [
        capability(schnellSpec),
        capability(devSpec),
        capability(kreaSpec),
        kleinCapability,
        capability(depthSpec),
        capability(cannySpec),
        capability(reduxSpec),
        kontextCapability,
        fillCapability,
        qwenInpaintCapability,
        capability(i2vSpec),
        capability(ti2vSpec),
        {
          ...capability(wanT2vSpec),
          modes: ['text_to_video', 'video_to_video', 'video_color_edit'],
          runnableModes: ['text_to_video', 'video_to_video', 'video_color_edit'],
          executionProfiles: [
            profile(wanT2vSpec),
            {
              ...profile(wanV2vSpec),
              modes: ['video_to_video', 'video_color_edit'],
            },
          ],
          studioExecutionSpecModes: ['text_to_video', 'video_color_edit', 'video_to_video'],
          studioExecutionSpecs: [wanT2vSpec, wanV2vSpec, wanColorSpec],
        },
        {
          ...capability(wanVaceT2vSpec),
          modes: ['text_to_video', 'video_inpaint', 'video_outpaint', 'control_to_video'],
          runnableModes: ['text_to_video', 'video_inpaint', 'video_outpaint', 'control_to_video'],
          executionProfiles: [
            {
              ...profile(wanVaceT2vSpec),
              modes: ['text_to_video', 'video_inpaint', 'video_outpaint', 'control_to_video'],
            },
          ],
          studioExecutionSpecModes: ['text_to_video'],
          studioExecutionSpecs: [wanVaceT2vSpec],
        },
        {
          ...capability(ltxSpec),
          modes: ['text_to_video', 'image_to_video', 'video_to_video', 'reference_to_video'],
          runnableModes: ['text_to_video', 'image_to_video', 'video_to_video', 'reference_to_video'],
          executionProfiles: [
            {
              ...profile(ltxSpec),
              modes: ['text_to_video', 'image_to_video', 'video_to_video', 'reference_to_video'],
              fallback_repo: 'Lightricks/LTX-Video',
              quantizable_components: ['transformer', 'text_encoder'],
            },
          ],
          studioExecutionSpecModes: ['image_to_video', 'reference_to_video', 'text_to_video', 'video_to_video'],
          studioExecutionSpecs: [ltxSpec, ltxImageSpec, ltxVideoSpec, ltxReferenceSpec],
        },
        aceCapability,
      ],
      studioModelCapabilitiesAuthoritative: true,
      studioExecutionSpecInvalid: false,
    });
    const baseForm = {
      ...previousForm,
      mode: 'text_to_image',
      modelType: 'FluxSchnellPipeline',
      resourceMode: 'expert',
      quantizationMode: 'none',
      prompt: 'Form-owned prompt',
      width: 768,
      height: 640,
      steps: 4,
      guidanceScale: 0,
    };
    studioStoreModule.useStudioStore.setState({ form: baseForm, autoResourcePlan: null });
    await graphBridge.createOrUpdateStudioGraph(baseForm);
    const schnellBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    const schnellTopology = topology(schnellBinding);
    const schnellPipeline = flowStoreModule.useFlowStore
      .getState()
      .nodes.find((item) => item.id === schnellBinding.nodes.diffusersImagePipeline);
    assert.equal(schnellPipeline.data.params.model_id.value.value, schnellSpec.defaultRepo);
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(baseForm), null);

    const kreaForm = { ...baseForm, modelType: 'FluxKreaPipeline', steps: 24, guidanceScale: 3.5 };
    studioStoreModule.useStudioStore.setState({ form: kreaForm });
    await graphBridge.createOrUpdateStudioGraph(kreaForm);
    const kreaBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.deepEqual(kreaBinding.nodes, schnellBinding.nodes);
    assert.deepEqual(topology(kreaBinding), schnellTopology);
    assert.equal(kreaBinding.executionSpec.id, kreaSpec.id);
    assert.equal(kreaBinding.executionSpec.contentHash, kreaSpec.contentHash);
    assert.equal(
      flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === kreaBinding.nodes.diffusersImagePipeline)
        .data.params.model_id.value.value,
      kreaSpec.defaultRepo,
    );

    const kleinForm = {
      ...baseForm,
      modelType: 'Flux2KleinPipeline',
      steps: 4,
      guidanceScale: 1,
    };
    studioStoreModule.useStudioStore.setState({ form: kleinForm });
    await graphBridge.createOrUpdateStudioGraph(kleinForm);
    const kleinBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.deepEqual(kleinBinding.nodes, schnellBinding.nodes);
    assert.deepEqual(topology(kleinBinding), schnellTopology);
    assert.equal(kleinBinding.executionSpec.id, kleinSpec.id);
    assert.equal(kleinBinding.executionSpec.contentHash, kleinSpec.contentHash);
    assert.equal(
      flowStoreModule.useFlowStore
        .getState()
        .nodes.find((item) => item.id === kleinBinding.nodes.diffusersImagePipeline).data.params.pipeline_class.value,
      'Flux2KleinPipeline',
    );
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(kleinForm), null);

    const devForm = { ...baseForm, modelType: 'FluxDevPipeline', steps: 20, guidanceScale: 3.5 };
    studioStoreModule.useStudioStore.setState({ form: devForm });
    await graphBridge.createOrUpdateStudioGraph(devForm);
    const devBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.deepEqual(
      devBinding.nodes,
      schnellBinding.nodes,
      'the backend recipe keeps every graph role identity stable',
    );
    assert.deepEqual(topology(devBinding), schnellTopology, 'model switching changes data, not topology');
    assert.notEqual(devBinding.executionSpec.id, schnellBinding.executionSpec.id);
    assert.notEqual(devBinding.finalizationProof.shapeKey, schnellBinding.finalizationProof.shapeKey);
    const devPipeline = flowStoreModule.useFlowStore
      .getState()
      .nodes.find((item) => item.id === devBinding.nodes.diffusersImagePipeline);
    assert.equal(devPipeline.data.params.model_id.value.value, devSpec.defaultRepo);
    const hinted = runPreparationModule.applyStudioRuntimeHints({ nodes: {}, paths: [] });
    assert.deepEqual(hinted.runtimeHints.studioExecutionSpec, {
      schemaVersion: 1,
      id: devSpec.id,
      contentHash: devSpec.contentHash,
      nodes: Object.fromEntries(devSpec.roles.map(([role]) => [role, devBinding.nodes[role]])),
    });

    const candidate = {
      id: 'flux-dev-ready',
      executionProfileId: devSpec.executionProfileId,
      modelType: devSpec.modelType,
      mode: devSpec.mode,
      loaderModule: devSpec.loaderModule,
      loaderAction: devSpec.loaderAction,
      executionPath: devSpec.executionPath,
      pipelineClass: devSpec.pipelineClass,
      modelRepo: 'reviewed/flux-dev-auto',
      dtype: 'float16',
      generation: { prompt: 'candidate-controlled prompt', width: 64 },
    };
    const autoForm = { ...devForm, resourceMode: 'auto', prompt: 'Still form-owned', width: 777 };
    studioStoreModule.useStudioStore.setState({
      form: autoForm,
      autoResourcePlan: {
        schemaVersion: 2,
        selectedCandidate: candidate,
        candidates: [structuredClone(candidate)],
      },
    });
    assert.equal(graphBridge.syncStudioGraphValues(autoForm), true);
    const autoNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(
      autoNodes.find((item) => item.id === devBinding.nodes.diffusersImagePipeline).data.params.model_id.value.value,
      candidate.modelRepo,
    );
    const autoGenerate = autoNodes.find((item) => item.id === devBinding.nodes.diffusersImageGenerate).data.params;
    assert.equal(
      autoGenerate.prompt.value,
      autoForm.prompt,
      'undeclared candidate generation data cannot override form input',
    );
    assert.equal(autoGenerate.width.value, autoForm.width);

    const kleinEditForm = {
      ...kleinForm,
      mode: 'edit_image',
      referenceImages: ['@data/images/klein-edit.png'],
    };
    studioStoreModule.useStudioStore.setState({ form: kleinEditForm, autoResourcePlan: null });
    await graphBridge.createOrUpdateStudioGraph(kleinEditForm);
    const kleinEditBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(kleinEditBinding.executionSpec.id, kleinEditSpec.id);
    assert.equal(kleinEditBinding.executionSpec.contentHash, kleinEditSpec.contentHash);
    assert.ok(kleinEditBinding.nodes.loadImage);
    assert.ok(kleinEditBinding.nodes.diffusersImageEdit);
    assert.equal(
      flowStoreModule.useFlowStore
        .getState()
        .nodes.find((item) => item.id === kleinEditBinding.nodes.diffusersImagePipeline).data.params.pipeline_class
        .value,
      'Flux2KleinPipeline',
    );

    const kleinMultiForm = {
      ...kleinEditForm,
      mode: 'multi_image_reference_edit',
      referenceImages: ['@data/images/klein-a.png', '@data/images/klein-b.png'],
    };
    studioStoreModule.useStudioStore.setState({ form: kleinMultiForm });
    await graphBridge.createOrUpdateStudioGraph(kleinMultiForm);
    const kleinMultiBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(kleinMultiBinding.executionSpec.id, kleinMultiSpec.id);
    assert.equal(kleinMultiBinding.executionSpec.contentHash, kleinMultiSpec.contentHash);
    assert.ok(kleinMultiBinding.nodes.loadImage);
    assert.ok(kleinMultiBinding.nodes.diffusersImageEdit);

    const depthForm = {
      ...baseForm,
      modelType: 'FluxDepthPipeline',
      mode: 'control_image',
      resourceMode: 'expert',
      controlImage: '@data/images/depth.png',
      alphaMode: 'remove alpha',
      steps: 24,
      guidanceScale: 10,
    };
    studioStoreModule.useStudioStore.setState({ form: depthForm, autoResourcePlan: null });
    await graphBridge.createOrUpdateStudioGraph(depthForm);
    const depthBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(depthBinding.executionSpec.id, depthSpec.id);
    assert.equal(depthBinding.executionSpec.contentHash, depthSpec.contentHash);
    assert.equal(depthBinding.nodes.diffusersImageGenerate, undefined);
    assert.ok(depthBinding.nodes.loadImage);
    assert.ok(depthBinding.nodes.diffusersImageControl);
    assert.deepEqual(
      topology(depthBinding),
      depthEdgeRows
        .map(([source, sourceHandle, target, targetHandle]) => [source, sourceHandle, target, targetHandle])
        .sort(),
    );
    const depthNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(
      depthNodes.find((item) => item.id === depthBinding.nodes.diffusersImagePipeline).data.params.pipeline_class.value,
      'FluxControlPipeline',
    );
    assert.equal(
      depthNodes.find((item) => item.id === depthBinding.nodes.loadImage).data.params.file.value,
      depthForm.controlImage,
    );

    const cannyForm = { ...depthForm, modelType: 'FluxCannyPipeline' };
    studioStoreModule.useStudioStore.setState({ form: cannyForm });
    await graphBridge.createOrUpdateStudioGraph(cannyForm);
    const cannyBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.deepEqual(cannyBinding.nodes, depthBinding.nodes);
    assert.deepEqual(topology(cannyBinding), topology(depthBinding));
    assert.equal(cannyBinding.executionSpec.id, cannySpec.id);
    assert.equal(cannyBinding.executionSpec.contentHash, cannySpec.contentHash);
    assert.equal(
      flowStoreModule.useFlowStore
        .getState()
        .nodes.find((item) => item.id === cannyBinding.nodes.diffusersImagePipeline).data.params.model_id.value.value,
      cannySpec.defaultRepo,
    );

    const reduxForm = {
      ...depthForm,
      modelType: 'FluxReduxPipeline',
      mode: 'edit_image',
      referenceImages: ['@data/images/redux.png'],
      conditioningScale: 0.8,
    };
    studioStoreModule.useStudioStore.setState({ form: reduxForm });
    await graphBridge.createOrUpdateStudioGraph(reduxForm);
    const reduxBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(reduxBinding.executionSpec.id, reduxSpec.id);
    assert.equal(reduxBinding.executionSpec.contentHash, reduxSpec.contentHash);
    assert.equal(reduxBinding.nodes.diffusersImageControl, undefined);
    assert.ok(reduxBinding.nodes.diffusersImageEdit);
    assert.deepEqual(
      topology(reduxBinding),
      editEdgeRows
        .map(([source, sourceHandle, target, targetHandle]) => [source, sourceHandle, target, targetHandle])
        .sort(),
    );
    const reduxNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(
      reduxNodes.find((item) => item.id === reduxBinding.nodes.diffusersImagePipeline).data.params.pipeline_class.value,
      'FluxReduxPipeline',
    );
    assert.deepEqual(
      reduxNodes.find((item) => item.id === reduxBinding.nodes.loadImage).data.params.file.value,
      reduxForm.referenceImages,
    );
    assert.equal(
      reduxNodes.find((item) => item.id === reduxBinding.nodes.diffusersImageEdit).data.params.reference_strength.value,
      reduxForm.conditioningScale,
    );

    const kontextForm = {
      ...reduxForm,
      modelType: 'FluxKontextPipeline',
      referenceImages: ['@data/images/kontext.png'],
    };
    studioStoreModule.useStudioStore.setState({ form: kontextForm });
    await graphBridge.createOrUpdateStudioGraph(kontextForm);
    const kontextBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(kontextBinding.executionSpec.id, kontextSpec.id);
    assert.equal(kontextBinding.executionSpec.contentHash, kontextSpec.contentHash);
    assert.deepEqual(topology(kontextBinding), topology(reduxBinding));
    assert.equal(
      flowStoreModule.useFlowStore
        .getState()
        .nodes.find((item) => item.id === kontextBinding.nodes.diffusersImagePipeline).data.params.pipeline_class.value,
      'FluxKontextPipeline',
    );
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(kontextForm), null);

    const kontextMultiForm = {
      ...kontextForm,
      mode: 'multi_image_reference_edit',
      referenceImages: ['@data/images/kontext-a.png', '@data/images/kontext-b.png'],
    };
    studioStoreModule.useStudioStore.setState({ form: kontextMultiForm });
    await graphBridge.createOrUpdateStudioGraph(kontextMultiForm);
    const kontextMultiBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(kontextMultiBinding.executionSpec.id, kontextMultiSpec.id);
    assert.equal(kontextMultiBinding.executionSpec.contentHash, kontextMultiSpec.contentHash);
    assert.ok(kontextMultiBinding.nodes.loadImage);
    assert.ok(kontextMultiBinding.nodes.diffusersImageEdit);
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(kontextMultiForm), null);

    const fillForm = {
      ...baseForm,
      modelType: 'FluxFillPipeline',
      mode: 'inpaint',
      referenceImages: ['@data/images/fill-source.png'],
      maskImage: '@data/images/fill-mask.png',
      alphaMode: 'add alpha',
      strength: 0.72,
      conditioningScale: 0.65,
      steps: 24,
      guidanceScale: 30,
    };
    studioStoreModule.useStudioStore.setState({ form: fillForm });
    await graphBridge.createOrUpdateStudioGraph(fillForm);
    const fillBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(fillBinding.executionSpec.id, fillSpec.id);
    assert.equal(fillBinding.executionSpec.contentHash, fillSpec.contentHash);
    assert.deepEqual(
      topology(fillBinding),
      inpaintEdgeRows
        .map(([source, sourceHandle, target, targetHandle]) => [source, sourceHandle, target, targetHandle])
        .sort(),
    );
    const fillNodes = flowStoreModule.useFlowStore.getState().nodes;
    const fillSource = fillNodes.find((item) => item.id === fillBinding.nodes.loadImage).data.params;
    const fillMask = fillNodes.find((item) => item.id === fillBinding.nodes.loadMask).data.params;
    const fillInpaint = fillNodes.find((item) => item.id === fillBinding.nodes.diffusersImageInpaint).data.params;
    assert.deepEqual(fillSource.file.value, fillForm.referenceImages);
    assert.equal(fillSource.alpha_channel.value, fillForm.alphaMode);
    assert.equal(fillMask.file.value, fillForm.maskImage);
    assert.equal(fillMask.alpha_channel.value, 'remove alpha');
    assert.equal(fillInpaint.reference_strength.value, fillForm.conditioningScale);
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(fillForm), null);

    const qwenInpaintForm = {
      ...fillForm,
      modelType: 'QwenImageEditModularPipeline',
      referenceImages: ['qwen-source.png'],
      maskImage: 'qwen-mask.png',
    };
    studioStoreModule.useStudioStore.setState({ form: qwenInpaintForm });
    await graphBridge.createOrUpdateStudioGraph(qwenInpaintForm);
    const qwenInpaintBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    const qwenInpaintNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(qwenInpaintBinding.executionSpec.id, qwenInpaintSpec.id);
    assert.equal(qwenInpaintBinding.executionSpec.contentHash, qwenInpaintSpec.contentHash);
    assert.deepEqual(topology(qwenInpaintBinding), inpaintEdgeRows.map((row) => [...row]).sort());
    assert.equal(
      qwenInpaintNodes.find((item) => item.id === qwenInpaintBinding.nodes.diffusersImagePipeline).data.params
        .pipeline_class.value,
      'QwenImageEditInpaintPipeline',
    );
    assert.deepEqual(
      qwenInpaintNodes.find((item) => item.id === qwenInpaintBinding.nodes.loadImage).data.params.file.value,
      qwenInpaintForm.referenceImages,
    );
    assert.equal(
      qwenInpaintNodes.find((item) => item.id === qwenInpaintBinding.nodes.loadMask).data.params.file.value,
      qwenInpaintForm.maskImage,
    );
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(qwenInpaintForm), null);

    const fillOutpaintForm = { ...fillForm, mode: 'outpaint' };
    studioStoreModule.useStudioStore.setState({ form: fillOutpaintForm });
    await graphBridge.createOrUpdateStudioGraph(fillOutpaintForm);
    const fillOutpaintBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(fillOutpaintBinding.executionSpec.id, fillOutpaintSpec.id);
    assert.equal(fillOutpaintBinding.executionSpec.contentHash, fillOutpaintSpec.contentHash);
    assert.deepEqual(fillOutpaintBinding.nodes, fillBinding.nodes);
    assert.deepEqual(topology(fillOutpaintBinding), topology(fillBinding));
    assert.ok(fillOutpaintBinding.nodes.diffusersImageInpaint);
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(fillOutpaintForm), null);

    const i2vForm = {
      ...baseForm,
      modelType: 'WanImageToVideoPipeline',
      mode: 'image_to_video',
      device: 'cuda:0',
      offloadMode: 'none',
      width: 832,
      height: 480,
      numFrames: 81,
      fps: 16,
      steps: 40,
      guidanceScale: 3.5,
      guidanceScale2: 3.5,
      conditioningScale: 1,
      referenceImages: ['opening.png'],
      alphaMode: 'remove alpha',
      attentionKwargsJson: '',
    };
    studioStoreModule.useStudioStore.setState({ form: i2vForm });
    await graphBridge.createOrUpdateStudioGraph(i2vForm);
    const i2vBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(i2vBinding.executionSpec.id, i2vSpec.id);
    assert.equal(i2vBinding.executionSpec.contentHash, i2vSpec.contentHash);
    assert.deepEqual(
      topology(i2vBinding),
      i2vEdgeRows
        .map(([source, sourceHandle, target, targetHandle]) => [source, sourceHandle, target, targetHandle])
        .sort(),
    );
    const i2vNodes = flowStoreModule.useFlowStore.getState().nodes;
    const i2vQuantization = i2vNodes.find((item) => item.id === i2vBinding.nodes.diffusersQuantization).data.params;
    const i2vRecipe = i2vNodes.find((item) => item.id === i2vBinding.nodes.diffusersRecipe).data.params;
    const i2vPipeline = i2vNodes.find((item) => item.id === i2vBinding.nodes.wanPipeline).data.params;
    const i2vGenerate = i2vNodes.find((item) => item.id === i2vBinding.nodes.wanGenerate).data.params;
    const i2vImage = i2vNodes.find((item) => item.id === i2vBinding.nodes.loadImage).data.params;
    assert.deepEqual(i2vQuantization.components.value, ['transformer', 'transformer_2']);
    assert.equal(i2vRecipe.attention_backend.value, '_native_flash');
    assert.equal(i2vRecipe.attention_components.value, 'transformer,transformer_2');
    assert.equal(i2vRecipe.vae_tiling.value, true);
    assert.equal(i2vPipeline.pipeline_class.value, 'WanImageToVideoPipeline');
    assert.deepEqual(i2vPipeline.model_id.value, {
      source: 'hub',
      value: 'Wan-AI/Wan2.2-I2V-A14B-Diffusers',
    });
    assert.deepEqual(i2vImage.file.value, ['opening.png']);
    assert.equal(i2vImage.alpha_channel.value, 'remove alpha');
    assert.equal(i2vGenerate.guidance_scale_2.value, 3.5);
    assert.equal(i2vGenerate.use_guidance_scale_2.value, true);
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(i2vForm), null);

    const ti2vForm = {
      ...baseForm,
      modelType: 'WanTI2VPipeline',
      mode: 'text_to_video',
      device: 'cuda:0',
      offloadMode: 'none',
      width: 1280,
      height: 704,
      numFrames: 121,
      fps: 24,
      steps: 50,
      guidanceScale: 5,
      guidanceScale2: 0,
      shift: 8,
      conditioningScale: 1,
      attentionKwargsJson: '',
    };
    studioStoreModule.useStudioStore.setState({ form: ti2vForm });
    await graphBridge.createOrUpdateStudioGraph(ti2vForm);
    const ti2vBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(ti2vBinding.executionSpec.id, ti2vSpec.id);
    assert.equal(ti2vBinding.executionSpec.contentHash, ti2vSpec.contentHash);
    assert.deepEqual(
      topology(ti2vBinding),
      videoEdgeRows
        .map(([source, sourceHandle, target, targetHandle]) => [source, sourceHandle, target, targetHandle])
        .sort(),
    );
    const ti2vNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(
      ti2vNodes.find((item) => item.id === ti2vBinding.nodes.wanPipeline).data.params.pipeline_class.value,
      'WanTI2VPipeline',
    );
    const ti2vRecipe = ti2vNodes.find((item) => item.id === ti2vBinding.nodes.diffusersRecipe).data.params;
    assert.equal(ti2vRecipe.attention_backend.value, '_native_flash');
    assert.equal(ti2vRecipe.attention_components.value, 'transformer');
    assert.equal(ti2vRecipe.vae_tiling.value, true);
    const ti2vGenerate = ti2vNodes.find((item) => item.id === ti2vBinding.nodes.wanGenerate).data.params;
    assert.equal(ti2vGenerate.scheduler_flow_shift.value, 8);
    assert.equal(ti2vGenerate.use_guidance_scale_2.value, false);
    assert.equal(ti2vNodes.find((item) => item.id === ti2vBinding.nodes.videoExport).data.params.fps.value, 24);
    assert.deepEqual(ti2vNodes.find((item) => item.id === ti2vBinding.nodes.wanGenerate).position, { x: 220, y: -80 });
    assert.deepEqual(ti2vNodes.find((item) => item.id === ti2vBinding.nodes.videoExport).position, { x: 640, y: -80 });
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(ti2vForm), null);

    const cpuTi2vForm = { ...ti2vForm, device: 'cpu:0' };
    studioStoreModule.useStudioStore.setState({ form: cpuTi2vForm });
    await graphBridge.createOrUpdateStudioGraph(cpuTi2vForm);
    const cpuTi2vBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    const cpuTi2vRecipe = flowStoreModule.useFlowStore
      .getState()
      .nodes.find((item) => item.id === cpuTi2vBinding.nodes.diffusersRecipe).data.params;
    assert.equal(cpuTi2vRecipe.attention_backend.value, 'auto');
    assert.equal(cpuTi2vRecipe.attention_components.value, '');

    const wanT2vForm = {
      ...ti2vForm,
      modelType: 'WanVideoPipeline',
      width: 832,
      height: 480,
      numFrames: 81,
      fps: 15,
      steps: 50,
      guidanceScale: 5,
    };
    studioStoreModule.useStudioStore.setState({ form: wanT2vForm });
    await graphBridge.createOrUpdateStudioGraph(wanT2vForm);
    const wanT2vBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(wanT2vBinding.executionSpec.id, wanT2vSpec.id);
    assert.equal(wanT2vBinding.executionSpec.contentHash, wanT2vSpec.contentHash);
    assert.equal(
      flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === wanT2vBinding.nodes.wanPipeline).data
        .params.pipeline_class.value,
      'WanPipeline',
    );
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(wanT2vForm), null);

    const wanVaceT2vForm = { ...wanT2vForm, modelType: 'WanVACEPipeline', shift: 5 };
    studioStoreModule.useStudioStore.setState({ form: wanVaceT2vForm });
    await graphBridge.createOrUpdateStudioGraph(wanVaceT2vForm);
    const wanVaceT2vBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    const wanVaceT2vNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(wanVaceT2vBinding.executionSpec.id, wanVaceT2vSpec.id);
    assert.equal(wanVaceT2vBinding.executionSpec.contentHash, wanVaceT2vSpec.contentHash);
    assert.deepEqual(topology(wanVaceT2vBinding), topology(wanT2vBinding));
    assert.equal(
      wanVaceT2vNodes.find((item) => item.id === wanVaceT2vBinding.nodes.wanPipeline).data.params.pipeline_class.value,
      'WanVACEPipeline',
    );
    assert.equal(
      wanVaceT2vNodes.find((item) => item.id === wanVaceT2vBinding.nodes.wanPipeline).data.params.model_id.value.value,
      'Wan-AI/Wan2.1-VACE-1.3B-diffusers',
    );
    assert.equal(
      wanVaceT2vNodes.find((item) => item.id === wanVaceT2vBinding.nodes.wanGenerate).data.params.mode.value,
      'text_to_video',
    );
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(wanVaceT2vForm), null);

    const wanV2vForm = { ...wanT2vForm, mode: 'video_to_video', sourceVideo: '@data/videos/source.mp4' };
    studioStoreModule.useStudioStore.setState({ form: wanV2vForm });
    await graphBridge.createOrUpdateStudioGraph(wanV2vForm);
    const wanV2vBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
    assert.equal(wanV2vBinding.executionSpec.id, wanV2vSpec.id);
    assert.equal(wanV2vBinding.executionSpec.contentHash, wanV2vSpec.contentHash);
    assert.ok(wanV2vBinding.nodes.loadVideo);
    assert.ok(wanV2vBinding.nodes.normalizeVideo);
    assert.deepEqual(
      topology(wanV2vBinding),
      wanV2vEdgeRows
        .map(([source, sourceHandle, target, targetHandle]) => [source, sourceHandle, target, targetHandle])
        .sort(),
    );
    const wanV2vNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(
      wanV2vNodes.find((item) => item.id === wanV2vBinding.nodes.loadVideo).data.params.file.value,
      wanV2vForm.sourceVideo,
    );
    assert.equal(
      wanV2vNodes.find((item) => item.id === wanV2vBinding.nodes.wanPipeline).data.params.pipeline_class.value,
      'WanVideoToVideoPipeline',
    );
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(wanV2vForm), null);

    const wanColorForm = { ...wanV2vForm, mode: 'video_color_edit' };
    studioStoreModule.useStudioStore.setState({ form: wanColorForm });
    await graphBridge.createOrUpdateStudioGraph(wanColorForm);
    const wanColorBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    assert.equal(wanColorBinding.executionSpec.id, wanColorSpec.id);
    assert.equal(wanColorBinding.executionSpec.contentHash, wanColorSpec.contentHash);
    assert.notEqual(wanColorBinding.executionSpec.contentHash, wanV2vBinding.executionSpec.contentHash);
    assert.ok(wanColorBinding.nodes.loadVideo);
    assert.ok(wanColorBinding.nodes.normalizeVideo);
    assert.deepEqual(topology(wanColorBinding), topology(wanV2vBinding));

    const graphBridgeSource = fs.readFileSync(path.join(ROOT, 'src', 'studio', 'graphBridge.ts'), 'utf8');
    assert.doesNotMatch(graphBridgeSource, /WanVideoPipeline|WanVideoToVideoPipeline|WAN_T2V_1_3B_REPO/);

    const ltxForm = { ...wanT2vForm, modelType: 'LTXVideoPipeline', shift: 11 };
    studioStoreModule.useStudioStore.setState({ form: ltxForm });
    await graphBridge.createOrUpdateStudioGraph(ltxForm);
    const ltxBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    const ltxNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(ltxBinding.executionSpec.id, ltxSpec.id);
    assert.equal(ltxBinding.executionSpec.contentHash, ltxSpec.contentHash);
    assert.equal(
      ltxNodes.find((item) => item.id === ltxBinding.nodes.wanPipeline).data.params.pipeline_class.value,
      'LTXConditionPipeline',
    );
    assert.equal(
      ltxNodes.find((item) => item.id === ltxBinding.nodes.diffusersRecipe).data.params.attention_backend.value,
      '_native_math',
    );
    assert.notEqual(
      ltxNodes.find((item) => item.id === ltxBinding.nodes.wanGenerate).data.params.scheduler_flow_shift.value,
      ltxForm.shift,
    );

    const ltxImageForm = { ...ltxForm, mode: 'image_to_video', referenceImages: ['@data/images/source.png'] };
    studioStoreModule.useStudioStore.setState({ form: ltxImageForm });
    await graphBridge.createOrUpdateStudioGraph(ltxImageForm);
    const ltxImageBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    const ltxImageNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(ltxImageBinding.executionSpec.id, ltxImageSpec.id);
    assert.equal(ltxImageBinding.executionSpec.contentHash, ltxImageSpec.contentHash);
    assert.ok(ltxImageBinding.nodes.loadImage);
    assert.deepEqual(
      ltxImageNodes.find((item) => item.id === ltxImageBinding.nodes.loadImage).data.params.file.value,
      ltxImageForm.referenceImages,
    );
    assert.equal(
      ltxImageNodes.find((item) => item.id === ltxImageBinding.nodes.diffusersRecipe).data.params.attention_backend
        .value,
      '_native_math',
    );

    const ltxVideoForm = {
      ...ltxForm,
      mode: 'video_to_video',
      sourceVideo: '@data/videos/ltx-source.mp4',
      conditioningScale: 0.72,
      strength: 0.31,
    };
    studioStoreModule.useStudioStore.setState({ form: ltxVideoForm });
    await graphBridge.createOrUpdateStudioGraph(ltxVideoForm);
    const ltxVideoBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    const ltxVideoNodes = flowStoreModule.useFlowStore.getState().nodes;
    const ltxVideoGenerate = ltxVideoNodes.find((item) => item.id === ltxVideoBinding.nodes.wanGenerate).data.params;
    assert.equal(ltxVideoBinding.executionSpec.id, ltxVideoSpec.id);
    assert.equal(ltxVideoBinding.executionSpec.contentHash, ltxVideoSpec.contentHash);
    assert.equal(ltxVideoGenerate.strength.value, ltxVideoForm.conditioningScale);
    assert.equal(ltxVideoGenerate.denoise_strength.value, ltxVideoForm.strength);
    assert.equal(
      ltxVideoNodes.find((item) => item.id === ltxVideoBinding.nodes.loadVideo).data.params.file.value,
      ltxVideoForm.sourceVideo,
    );

    const ltxReferenceForm = {
      ...ltxImageForm,
      mode: 'reference_to_video',
      referenceImages: ['@data/images/reference-a.png', '@data/images/reference-b.png'],
    };
    studioStoreModule.useStudioStore.setState({ form: ltxReferenceForm });
    await graphBridge.createOrUpdateStudioGraph(ltxReferenceForm);
    const ltxReferenceBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    const ltxReferenceNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(ltxReferenceBinding.executionSpec.id, ltxReferenceSpec.id);
    assert.equal(ltxReferenceBinding.executionSpec.contentHash, ltxReferenceSpec.contentHash);
    assert.deepEqual(
      ltxReferenceNodes.find((item) => item.id === ltxReferenceBinding.nodes.loadImage).data.params.file.value,
      ltxReferenceForm.referenceImages,
    );

    const aceForm = {
      ...baseForm,
      mode: 'text_to_audio',
      modelType: 'AceStepAudioPipeline',
      prompt: 'Instrumental post-rock with a gradual crescendo',
      negativePrompt: 'clipping',
      lyrics: '[Instrumental]',
      audioDuration: 42,
      extensionDuration: 12,
      vocalLanguage: 'en',
      steps: 8,
      guidanceScale: 1,
      shift: 3,
      bpm: -1,
      keyscale: 'C',
      timesignature: '4/4',
      repaintingStart: 2,
      repaintingEnd: 8,
      audioCoverStrength: 0.75,
    };
    studioStoreModule.useStudioStore.setState({ form: aceForm });
    await graphBridge.createOrUpdateStudioGraph(aceForm);
    const aceBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    const aceNodes = flowStoreModule.useFlowStore.getState().nodes;
    const aceGenerate = aceNodes.find((item) => item.id === aceBinding.nodes.audioGenerate).data.params;
    assert.equal(aceBinding.executionSpec.id, aceSpec.id);
    assert.equal(aceBinding.executionSpec.contentHash, aceSpec.contentHash);
    assert.deepEqual(topology(aceBinding), audioEdgeRows.map((row) => [...row]).sort());
    assert.equal(
      aceNodes.find((item) => item.id === aceBinding.nodes.audioPipeline).data.params.pipeline_class.value,
      'AceStepPipeline',
    );
    assert.equal(aceGenerate.task_type.value, 'text2music');
    assert.equal(aceGenerate.audio_duration.value, 42);
    assert.equal(aceGenerate.bpm.value, 0);
    assert.equal(aceGenerate.return_continuation_tail.value, false);
    assert.equal(aceGenerate.sample_rate.value, 48000);
    assert.equal(
      aceNodes.find((item) => item.id === aceBinding.nodes.audioExport).data.params.sample_rate.value,
      48000,
    );
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(aceForm), null);

    const aceVariationForm = {
      ...aceForm,
      mode: 'audio_variation',
      sourceAudio: '@data/audio/source.wav',
    };
    studioStoreModule.useStudioStore.setState({ form: aceVariationForm });
    await graphBridge.createOrUpdateStudioGraph(aceVariationForm);
    const aceVariationBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    const aceVariationNodes = flowStoreModule.useFlowStore.getState().nodes;
    assert.equal(aceVariationBinding.executionSpec.id, aceVariationSpec.id);
    assert.equal(aceVariationBinding.executionSpec.contentHash, aceVariationSpec.contentHash);
    assert.ok(aceVariationBinding.nodes.loadAudio);
    assert.deepEqual(topology(aceVariationBinding), audioVariationEdgeRows.map((row) => [...row]).sort());
    assert.equal(
      aceVariationNodes.find((item) => item.id === aceVariationBinding.nodes.loadAudio).data.params.file.value,
      aceVariationForm.sourceAudio,
    );
    assert.equal(
      aceVariationNodes.find((item) => item.id === aceVariationBinding.nodes.audioGenerate).data.params.task_type.value,
      'cover',
    );
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(aceVariationForm), null);

    const aceContinuationForm = {
      ...aceVariationForm,
      mode: 'audio_continuation',
    };
    studioStoreModule.useStudioStore.setState({ form: aceContinuationForm });
    await graphBridge.createOrUpdateStudioGraph(aceContinuationForm);
    const aceContinuationBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    const aceContinuationNodes = flowStoreModule.useFlowStore.getState().nodes;
    const continuationGenerate = aceContinuationNodes.find(
      (item) => item.id === aceContinuationBinding.nodes.audioGenerate,
    ).data.params;
    const continuationMatch = aceContinuationNodes.find(
      (item) => item.id === aceContinuationBinding.nodes.audioLoudnessMatch,
    ).data.params;
    const continuationJoin = aceContinuationNodes.find((item) => item.id === aceContinuationBinding.nodes.audioJoin)
      .data.params;
    assert.equal(aceContinuationBinding.executionSpec.id, aceContinuationSpec.id);
    assert.equal(aceContinuationBinding.executionSpec.contentHash, aceContinuationSpec.contentHash);
    assert.deepEqual(topology(aceContinuationBinding), audioContinuationEdgeRows.map((row) => [...row]).sort());
    assert.equal(continuationGenerate.task_type.value, 'continuation');
    assert.equal(continuationGenerate.return_continuation_tail.value, true);
    assert.equal(continuationMatch.reference_window_seconds.value, 15);
    assert.equal(continuationMatch.target_peak_dbfs.value, -1);
    assert.equal(continuationMatch.max_adjustment_db.value, 12);
    assert.equal(continuationJoin.boundary_fade_seconds.value, 0.01);
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(aceContinuationForm), null);

    const aceRepaintForm = { ...aceContinuationForm, mode: 'audio_repaint' };
    studioStoreModule.useStudioStore.setState({ form: aceRepaintForm });
    await graphBridge.createOrUpdateStudioGraph(aceRepaintForm);
    const aceRepaintBinding = studioStoreModule.useStudioStore.getState().graphBinding;
    const aceRepaintNodes = flowStoreModule.useFlowStore.getState().nodes;
    const repaintGenerate = aceRepaintNodes.find((item) => item.id === aceRepaintBinding.nodes.audioGenerate).data
      .params;
    assert.equal(aceRepaintBinding.executionSpec.id, aceRepaintSpec.id);
    assert.equal(aceRepaintBinding.executionSpec.contentHash, aceRepaintSpec.contentHash);
    assert.deepEqual(topology(aceRepaintBinding), audioVariationEdgeRows.map((row) => [...row]).sort());
    assert.equal(repaintGenerate.task_type.value, 'repaint');
    assert.equal(repaintGenerate.repainting_start.value, 2);
    assert.equal(repaintGenerate.repainting_end.value, 8);
    assert.equal(graphBridge.getStudioGraphRunBlockingMessage(aceRepaintForm), null);

    studioStoreModule.useStudioStore.setState({ form: baseForm, autoResourcePlan: null });
    for (const mutate of [
      (spec) => ({
        ...spec,
        roles: spec.roles.map((row, index) => (index === 0 ? [row[0], 'modules.Missing.Node', row[2], row[3]] : row)),
      }),
      (spec) => ({ ...spec, bindings: [...spec.bindings, ['preview', 'missing_param', 'empty']] }),
      (spec) => ({ ...spec, bindings: [...spec.bindings, ['diffusersQuantization', 'quantization_config', 'empty']] }),
      (spec) => ({
        ...spec,
        edges: spec.edges.map((row, index) => (index === 0 ? [row[0], 'missing_output', row[2], row[3]] : row)),
      }),
    ]) {
      const malformed = mutate(structuredClone(schnellSpec));
      nodesStoreModule.useNodesStore.setState({
        studioModelCapabilities: [
          capability(malformed),
          capability(devSpec),
          capability(kreaSpec),
          capability(depthSpec),
          capability(cannySpec),
          capability(reduxSpec),
          kontextCapability,
          capability(i2vSpec),
          capability(ti2vSpec),
        ],
      });
      await assert.rejects(
        () => graphBridge.createOrUpdateStudioGraph(baseForm),
        /missing MoDiff node registry|does not match the current node registry/i,
      );
    }
    nodesStoreModule.useNodesStore.setState({
      nodesRegistry: {
        ...registry,
        'modules.DiffusersImage.LoadPipeline': {
          ...registry['modules.DiffusersImage.LoadPipeline'],
          module: 'modules.Unreviewed',
        },
      },
      studioModelCapabilities: [
        capability(schnellSpec),
        capability(devSpec),
        capability(kreaSpec),
        capability(depthSpec),
        capability(cannySpec),
        capability(reduxSpec),
        capability(i2vSpec),
        capability(ti2vSpec),
      ],
    });
    await assert.rejects(
      () => graphBridge.createOrUpdateStudioGraph(baseForm),
      /does not match the current node registry/i,
    );
    nodesStoreModule.useNodesStore.setState({ nodesRegistry: registry });
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [],
      studioExecutionSpecInvalid: true,
    });
    await assert.rejects(
      () => graphBridge.createOrUpdateStudioGraph(baseForm),
      /execution specification does not cover/i,
      'a malformed versioned response must not downgrade to the legacy graph recipe',
    );
  } finally {
    globalThis.WebSocket = nativeWebSocket;
    globalThis.fetch = nativeFetch;
    nodesStoreModule.useNodesStore.setState({
      nodesRegistry: previousNodesState.nodesRegistry,
      studioModelCapabilities: previousNodesState.studioModelCapabilities,
      studioModelCapabilitiesAuthoritative: previousNodesState.studioModelCapabilitiesAuthoritative,
      studioExecutionSpecInvalid: previousNodesState.studioExecutionSpecInvalid,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm, autoResourcePlan: null });
  }
});

test('managed video extensions re-seal only after their exact route is complete', () => {
  const input = (type) => ({ type, display: 'input' });
  const output = (type) => ({ type, display: 'output' });
  const quantization = managedContractNode(
    'proof-video-quantization',
    'diffusersQuantization',
    'modules.DiffusersRuntime',
    'PipelineQuantizationConfigV2',
    { quantization_config: output('quantization_config') },
  );
  const recipe = managedContractNode(
    'proof-video-recipe',
    'diffusersRecipe',
    'modules.DiffusersRuntime',
    'DiffusersExecutionRecipe',
    {
      quantization_config: input('quantization_config'),
      execution_recipe: output('execution_recipe'),
    },
  );
  const pipeline = managedContractNode(
    'proof-video-pipeline',
    'wanPipeline',
    'modules.DiffusersVideo',
    'LoadPipeline',
    { execution_recipe: input('execution_recipe'), pipeline: output('pipeline') },
  );
  const generate = managedContractNode('proof-video-generate', 'wanGenerate', 'modules.DiffusersVideo', 'Generate', {
    pipeline: input('pipeline'),
    video_out: output('video'),
  });
  const exporter = managedContractNode('proof-video-export', 'videoExport', 'modules.Video', 'Export', {
    video: input('video'),
  });
  const nodes = [quantization, recipe, pipeline, generate, exporter];
  const edges = [
    edge('proof-video-edge-1', quantization.id, recipe.id, 'quantization_config', 'quantization_config'),
    edge('proof-video-edge-2', recipe.id, pipeline.id, 'execution_recipe', 'execution_recipe'),
    edge('proof-video-edge-3', pipeline.id, generate.id, 'pipeline', 'pipeline'),
    edge('proof-video-edge-4', generate.id, exporter.id, 'video_out', 'video'),
  ];
  const form = {
    ...studioStoreModule.useStudioStore.getState().form,
    mode: 'text_to_video',
    modelType: 'WanVideoPipeline',
    resourceMode: 'expert',
    quantizationMode: 'none',
  };
  const binding = {
    mode: form.mode,
    modelType: form.modelType,
    nodes: {
      diffusersQuantization: quantization.id,
      diffusersRecipe: recipe.id,
      wanPipeline: pipeline.id,
      wanGenerate: generate.id,
      videoExport: exporter.id,
    },
    managedNodeIds: nodes.map((item) => item.id),
    managedEdgeIds: edges.map((item) => item.id),
    fingerprint: `${form.mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}`,
    createdAt: 1,
    updatedAt: 1,
  };
  flowStoreModule.useFlowStore.setState({ nodes, edges });
  const shapeKey = graphBridge.getStudioGraphShapeKey(form);
  binding.finalizationProof = {
    ...craftedFinalizationProof(binding, shapeKey.split(':').at(-1).split('|')),
    shapeKey,
    finalizedAt: 1,
  };
  studioStoreModule.useStudioStore.setState({
    form,
    graphBinding: binding,
    graphFinalization: { status: 'complete', managedEdgeCount: edges.length, finalizedAt: 1 },
  });
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(form), null);

  const upscaler = managedContractNode('proof-video-upscaler', 'upscaler', 'modules.Spandrel', 'Upscaler', {
    image: input('video'),
    output: output('video'),
  });
  flowStoreModule.useFlowStore.setState({ nodes: [...nodes, upscaler] });
  const originalProof = binding.finalizationProof;
  assert.equal(graphBridge.refreshStudioManagedGraphBinding([upscaler.id])?.finalizationProof, originalProof);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(form), /graph changed/i);

  flowStoreModule.useFlowStore.setState({
    edges: [...edges.slice(0, -1), edge('proof-video-edge-5', generate.id, upscaler.id, 'video_out', 'image')],
  });
  assert.equal(graphBridge.refreshStudioManagedGraphBinding()?.finalizationProof, originalProof);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(form), /graph changed/i);

  flowStoreModule.useFlowStore.setState((state) => ({
    edges: [...state.edges, edge('proof-video-edge-6', upscaler.id, exporter.id, 'output', 'video')],
  }));
  const finalized = graphBridge.refreshStudioManagedGraphBinding();
  assert.notEqual(finalized?.finalizationProof?.edgeSpecHash, originalProof.edgeSpecHash);
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(form), null);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.managedEdgeCount, 5);

  flowStoreModule.useFlowStore.getState().setParam(generate.id, 'video_out', true, 'disabled');
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(form), null, 'field busy state is not graph schema');
  const proofBeforeSchemaDrift = studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof;
  flowStoreModule.useFlowStore.getState().setParam(generate.id, 'video_out', 'tampered', 'type');
  assert.equal(graphBridge.refreshStudioManagedGraphBinding()?.finalizationProof, proofBeforeSchemaDrift);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(form), /graph changed/i);
  flowStoreModule.useFlowStore.getState().setParam(generate.id, 'video_out', 'video', 'type');
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(form), null);

  flowStoreModule.useFlowStore.setState((state) => ({
    edges: state.edges.filter((item) => item.id !== 'proof-video-edge-6'),
  }));
  const sealedProof = studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof;
  assert.equal(graphBridge.refreshStudioManagedGraphBinding()?.finalizationProof, sealedProof);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(form), /graph changed/i);
});

test('schema-v3 controlled commits roll back partial routes and seal extension execution identity', async () => {
  const input = (type) => ({ type, display: 'input' });
  const output = (type) => ({ type, display: 'output' });
  const quantization = managedContractNode(
    'v3-quantization',
    'diffusersQuantization',
    'modules.DiffusersRuntime',
    'PipelineQuantizationConfigV2',
    { quantization_config: output('quantization_config') },
  );
  const recipe = managedContractNode(
    'v3-recipe',
    'diffusersRecipe',
    'modules.DiffusersRuntime',
    'DiffusersExecutionRecipe',
    {
      quantization_config: input('quantization_config'),
      execution_recipe: output('execution_recipe'),
    },
  );
  const pipeline = managedContractNode('v3-pipeline', 'wanPipeline', 'modules.DiffusersVideo', 'LoadPipeline', {
    execution_recipe: input('execution_recipe'),
    pipeline: output('pipeline'),
  });
  const generate = managedContractNode('v3-generate', 'wanGenerate', 'modules.DiffusersVideo', 'Generate', {
    pipeline: input('pipeline'),
    video_out: output('video'),
  });
  const exporter = managedContractNode('v3-export', 'videoExport', 'modules.Video', 'Export', {
    video: input('video'),
    format: { type: 'string', display: 'select', value: 'mp4' },
  });
  const nodes = [quantization, recipe, pipeline, generate, exporter];
  const edges = [
    edge('v3-edge-1', quantization.id, recipe.id, 'quantization_config', 'quantization_config'),
    edge('v3-edge-2', recipe.id, pipeline.id, 'execution_recipe', 'execution_recipe'),
    edge('v3-edge-3', pipeline.id, generate.id, 'pipeline', 'pipeline'),
    edge('v3-edge-4', generate.id, exporter.id, 'video_out', 'video'),
  ];
  const form = {
    ...studioStoreModule.useStudioStore.getState().form,
    mode: 'text_to_video',
    modelType: 'WanVideoPipeline',
    resourceMode: 'expert',
    quantizationMode: 'none',
  };
  const binding = {
    mode: form.mode,
    modelType: form.modelType,
    nodes: {
      diffusersQuantization: quantization.id,
      diffusersRecipe: recipe.id,
      wanPipeline: pipeline.id,
      wanGenerate: generate.id,
      videoExport: exporter.id,
    },
    managedNodeIds: nodes.map((item) => item.id),
    managedEdgeIds: edges.map((item) => item.id),
    fingerprint: `${form.mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}`,
    createdAt: 1,
    updatedAt: 1,
  };
  flowStoreModule.useFlowStore.setState({ nodes, edges });
  const shapeKey = graphBridge.getStudioGraphShapeKey(form);
  binding.finalizationProof = {
    ...craftedFinalizationProof(binding, shapeKey.split(':').at(-1).split('|')),
    shapeKey,
    finalizedAt: 1,
  };
  studioStoreModule.useStudioStore.setState({
    form,
    graphBinding: binding,
    graphFinalization: {
      status: 'complete',
      bindingFingerprint: binding.fingerprint,
      startedAt: 1,
      timedOutGroups: [],
      managedEdgeCount: edges.length,
    },
  });

  const upscaler = managedContractNode('v3-upscaler', 'upscaler', 'modules.Spandrel', 'Upscaler', {
    image: input('video'),
    output: output('video'),
  });
  nodesStoreModule.useNodesStore.setState((state) => ({
    nodesRegistry: {
      ...state.nodesRegistry,
      ...Object.fromEntries(
        [...nodes, upscaler].map((item) => [
          `${item.data.module}.${item.data.action}`,
          { ...item.data, studioOwned: undefined, studioRole: undefined },
        ]),
      ),
    },
  }));
  const transaction = graphBridge.beginControlledGraphTransaction(
    studioStoreModule.captureWorkflowOperationContext(),
    'upscale.video.v1',
  );
  flowStoreModule.useFlowStore.setState({
    nodes: [...nodes, upscaler],
    edges: [
      ...edges.slice(0, -1),
      edge('v3-edge-5', generate.id, upscaler.id, 'video_out', 'image'),
      edge('v3-edge-6', upscaler.id, exporter.id, 'output', 'video'),
    ],
  });
  const finalized = graphBridge.commitControlledGraphTransaction(transaction);
  assert.equal(finalized.finalizationProof.schemaVersion, 3);
  assert.deepEqual(finalized.controlled.contractIds, ['upscale.video.v1']);
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(form), null);

  const reviewedNodes = structuredClone(flowStoreModule.useFlowStore.getState().nodes);
  const reviewedBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
  flowStoreModule.useFlowStore.getState().setParam(upscaler.id, 'image', true, 'spawn');
  const forgedBinding = structuredClone(reviewedBinding);
  forgedBinding.finalizationProof.fieldSchemaHash = controlledFieldSchemaHash(forgedBinding);
  studioStoreModule.useStudioStore.setState({ graphBinding: forgedBinding });
  assert.match(
    graphBridge.getStudioGraphRunBlockingMessage(form),
    /graph changed/i,
    'a recomputed hash cannot authorize execution metadata absent from the reviewed registry',
  );
  flowStoreModule.useFlowStore.setState({ nodes: reviewedNodes });
  studioStoreModule.useStudioStore.setState({ graphBinding: reviewedBinding });
  flowStoreModule.useFlowStore.getState().setParam(upscaler.id, 'image', 'output', 'display');
  const forgedDisplayBinding = structuredClone(reviewedBinding);
  forgedDisplayBinding.finalizationProof.fieldSchemaHash = controlledFieldSchemaHash(forgedDisplayBinding);
  studioStoreModule.useStudioStore.setState({ graphBinding: forgedDisplayBinding });
  assert.match(
    graphBridge.getStudioGraphRunBlockingMessage(form),
    /graph changed/i,
    'a recomputed hash cannot turn a reviewed extension input into an omitted output',
  );
  flowStoreModule.useFlowStore.setState({ nodes: reviewedNodes });
  studioStoreModule.useStudioStore.setState({ graphBinding: reviewedBinding });
  flowStoreModule.useFlowStore.getState().setParam(exporter.id, 'format', 'output', 'display');
  const forgedBaseDisplayBinding = structuredClone(reviewedBinding);
  forgedBaseDisplayBinding.finalizationProof.fieldSchemaHash = controlledFieldSchemaHash(forgedBaseDisplayBinding);
  studioStoreModule.useStudioStore.setState({ graphBinding: forgedBaseDisplayBinding });
  assert.match(
    graphBridge.getStudioGraphRunBlockingMessage(form),
    /graph changed/i,
    'a recomputed hash cannot turn a reviewed base input into an omitted output',
  );
  flowStoreModule.useFlowStore.setState({ nodes: reviewedNodes });
  studioStoreModule.useStudioStore.setState({ graphBinding: reviewedBinding });
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(form), null);

  flowStoreModule.useFlowStore.getState().setParam(upscaler.id, 'output', true, 'disabled');
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(form), null, 'field disabled remains transient UI state');

  assert.equal(graphBridge.markStudioGraphDefinitionPending(upscaler.id, ['display']), true);
  flowStoreModule.useFlowStore.getState().setParam(upscaler.id, 'output', 'input', 'display');
  assert.equal(graphBridge.syncStudioGraphDefinition(form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  flowStoreModule.useFlowStore.getState().setParam(upscaler.id, 'output', 'output', 'display');
  assert.equal(graphBridge.markStudioGraphDefinitionPending(upscaler.id, ['display']), true);
  assert.equal(graphBridge.syncStudioGraphDefinition(form), true);

  assert.equal(graphBridge.markStudioGraphDefinitionPending(upscaler.id, ['type']), true);
  flowStoreModule.useFlowStore.getState().setParam(upscaler.id, 'output', 'audio', 'type');
  assert.equal(graphBridge.syncStudioGraphDefinition(form), false);
  flowStoreModule.useFlowStore.getState().setParam(upscaler.id, 'output', 'video', 'type');
  assert.equal(graphBridge.markStudioGraphDefinitionPending(upscaler.id, ['type']), true);
  assert.equal(graphBridge.syncStudioGraphDefinition(form), true);

  assert.equal(graphBridge.markStudioGraphDefinitionPending(upscaler.id, ['hidden']), true);
  studioStoreModule.useStudioStore.getState().updateForm({ prompt: 'Updated while schema settles' });
  assert.equal(graphBridge.syncStudioGraphDefinition(), true, 'value-only form edits do not strand schema authority');

  studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: 'v3-tab', workflowCanvasEpoch: 1 });
  assert.equal(graphBridge.markStudioGraphDefinitionPending(upscaler.id, ['hidden']), true);
  studioStoreModule.useStudioStore.setState({ workflowCanvasEpoch: 3 });
  assert.equal(
    graphBridge.syncStudioGraphDefinition(),
    true,
    'returning to the same workflow after a tab switch resumes its exact pending schema receipt',
  );
  studioStoreModule.useStudioStore.setState({ activeWorkflowTabId: null, workflowCanvasEpoch: 4 });

  const authorizedNodes = structuredClone(flowStoreModule.useFlowStore.getState().nodes);
  const authorizedEdges = structuredClone(flowStoreModule.useFlowStore.getState().edges);
  const authorizedBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
  const authorizedFinalization = structuredClone(studioStoreModule.useStudioStore.getState().graphFinalization);
  assert.equal(graphBridge.markStudioGraphDefinitionPending(upscaler.id, ['hidden']), true);
  const untrackedLoop = node('v3-untracked-loop', 0, 0, { type: 'loop' });
  flowStoreModule.useFlowStore.setState((state) => ({
    nodes: [
      ...state.nodes.map((item) => (item.id === pipeline.id ? { ...item, parentId: untrackedLoop.id } : item)),
      untrackedLoop,
    ],
  }));
  assert.equal(graphBridge.syncStudioGraphDefinition(form), false, 'schema refresh cannot bless topology drift');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  flowStoreModule.useFlowStore.setState({ nodes: authorizedNodes, edges: authorizedEdges });
  studioStoreModule.useStudioStore.setState({
    graphBinding: authorizedBinding,
    graphFinalization: authorizedFinalization,
  });
  assert.equal(graphBridge.markStudioGraphDefinitionPending(upscaler.id, ['hidden']), true);
  assert.equal(graphBridge.syncStudioGraphDefinition(form), true);

  const rogue = node('v3-rogue', 0, 0);
  rogue.type = 'group';
  flowStoreModule.useFlowStore.setState((state) => ({ nodes: [...state.nodes, rogue] }));
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(form), /graph changed/i);
  flowStoreModule.useFlowStore.setState((state) => ({ nodes: state.nodes.filter((item) => item.id !== rogue.id) }));
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(form), null);

  flowStoreModule.useFlowStore.getState().setNodeUiState(upscaler.id, { disabled: true });
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(form), /graph changed/i);
  flowStoreModule.useFlowStore.getState().setNodeUiState(upscaler.id, { disabled: false });
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(form), null);

  const beforeGraph = graphContentSnapshot(flowStoreModule.useFlowStore.getState());
  const beforeBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
  const beforeHistory = structuredClone(flowStoreModule.useFlowStore.getState().historyPast);
  const rejected = graphBridge.beginControlledGraphTransaction(
    studioStoreModule.captureWorkflowOperationContext(),
    'upscale.video.v1',
  );
  flowStoreModule.useFlowStore.setState((state) => ({
    nodes: state.nodes.map((item) =>
      item.id === upscaler.id ? { ...item, data: { ...item.data, action: 'UnreviewedUpscaler' } } : item,
    ),
    edges: state.edges.filter((item) => item.target !== exporter.id),
  }));
  assert.throws(() => graphBridge.commitControlledGraphTransaction(rejected), /reviewed graph contract/i);
  assert.deepEqual(graphContentSnapshot(flowStoreModule.useFlowStore.getState()), beforeGraph);
  assert.deepEqual(studioStoreModule.useStudioStore.getState().graphBinding, beforeBinding);
  assert.deepEqual(flowStoreModule.useFlowStore.getState().historyPast, beforeHistory);

  const containerRejected = graphBridge.beginControlledGraphTransaction(
    studioStoreModule.captureWorkflowOperationContext(),
    'upscale.video.v1',
  );
  flowStoreModule.useFlowStore.setState((state) => ({
    nodes: state.nodes.map((item) =>
      item.id === upscaler.id ? { ...item, type: 'group', data: { ...item.data, type: 'group' } } : item,
    ),
  }));
  assert.throws(() => graphBridge.commitControlledGraphTransaction(containerRejected), /reviewed graph contract/i);
  assert.deepEqual(graphContentSnapshot(flowStoreModule.useFlowStore.getState()), beforeGraph);
  assert.deepEqual(studioStoreModule.useStudioStore.getState().graphBinding, beforeBinding);

  const saveAction = studioStoreModule.useStudioStore.getState().saveActiveWorkflowTab;
  studioStoreModule.useStudioStore.setState({
    saveActiveWorkflowTab: () => {
      throw new Error('persist failed');
    },
  });
  const persistFailureGraph = graphContentSnapshot(flowStoreModule.useFlowStore.getState());
  const persistFailureBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
  const persistFailureHistory = structuredClone(flowStoreModule.useFlowStore.getState().historyPast);
  try {
    const persistFailure = graphBridge.beginControlledGraphTransaction(
      studioStoreModule.captureWorkflowOperationContext(),
      'upscale.video.v1',
    );
    assert.throws(() => graphBridge.commitControlledGraphTransaction(persistFailure), /persist failed/i);
  } finally {
    studioStoreModule.useStudioStore.setState({ saveActiveWorkflowTab: saveAction });
  }
  assert.deepEqual(graphContentSnapshot(flowStoreModule.useFlowStore.getState()), persistFailureGraph);
  assert.deepEqual(studioStoreModule.useStudioStore.getState().graphBinding, persistFailureBinding);
  assert.deepEqual(flowStoreModule.useFlowStore.getState().historyPast, persistFailureHistory);

  flowStoreModule.useFlowStore.setState((state) => ({
    edges: state.edges.map((item) => (item.id === 'v3-edge-6' ? { ...item, id: 'v3-edge-replaced' } : item)),
  }));
  assert.match(
    graphBridge.getStudioGraphRunBlockingMessage(form),
    /graph changed/i,
    'edge identity replacement is sealed',
  );
  assert.equal(graphBridge.markStudioGraphDefinitionPending(upscaler.id, ['hidden']), false);

  flowStoreModule.useFlowStore.setState({ nodes, edges });
  const quarantined = { ...binding, finalizationProofInvalid: true };
  studioStoreModule.useStudioStore.setState({ graphBinding: quarantined, graphFinalization: null });
  assert.equal(await graphBridge.waitForStudioGraphFinalization(100), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProofInvalid, true);
  assert.deepEqual(
    studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof,
    binding.finalizationProof,
  );
  assert.equal(
    runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((issue) => issue.action === 'detach_graph')?.blocking,
    true,
  );
  await assert.rejects(() => graphBridge.createOrUpdateStudioGraph(form), /saved Studio graph proof is invalid/i);
});

test('Blocks expand from embedded snapshots, resize, collapse, export, and flatten without nesting', () => {
  const source = node('source', -400, 0, {
    params: { output: { display: 'output', type: 'image' } },
  });
  const first = node('first', 0, 0, {
    params: {
      input: { display: 'input', type: 'image' },
      prompt: { display: 'textarea', label: 'Prompt', value: 'Initial' },
      output: { display: 'output', type: 'image' },
    },
  });
  const second = node('second', 360, 0, {
    params: {
      input: { display: 'input', type: 'image' },
      output: { display: 'output', type: 'image' },
      preview: { display: 'ui_image', type: 'url', value: '/outputs/current.webp' },
    },
  });
  const output = node('output', 800, 0, {
    params: { input: { display: 'input', type: 'image' } },
  });
  first.selected = true;
  second.selected = true;
  const created = userBlocksModule.createUserBlockFromSelection(
    {
      nodes: [source, first, second, output],
      edges: [
        edge('source-first', 'source', 'first'),
        edge('first-second', 'first', 'second'),
        edge('second-output', 'second', 'output'),
      ],
    },
    'Reusable image block',
  );
  assert.equal(created.ok, true);
  assert.equal(created.blockNode.data.userBlockSnapshot.name, 'Reusable image block');
  assert.equal(
    created.nodes.some((item) => item.data.type === 'block'),
    true,
  );
  assert.equal(
    created.nodes.some((item) => item.id === 'first' || item.id === 'second'),
    false,
  );
  assert.equal(created.block.inputs.length, 1);
  assert.equal(created.block.outputs.length, 2);
  assert.ok(
    Object.keys(created.blockNode.data.params).some((key) =>
      key.startsWith(userBlocksModule.USER_BLOCK_PREVIEW_PREFIX),
    ),
    'collapsed blocks must surface an internal preview',
  );
  const collapsedGroups = userBlocksModule.userBlockCollapsedContentGroups(
    created.block,
    created.blockNode.data.params,
  );
  const promptGroupIndex = collapsedGroups.findIndex((group) =>
    Object.keys(group.controlParams).includes('first__prompt'),
  );
  const previewGroupIndex = collapsedGroups.findIndex((group) => Object.keys(group.previewParams).length > 0);
  assert.ok(promptGroupIndex >= 0, 'collapsed blocks must expose editable prompt controls');
  assert.ok(
    previewGroupIndex > promptGroupIndex,
    'collapsed content must follow execution order before showing previews',
  );

  const legacyNegativeDefinition = {
    ...created.block,
    nodes: created.block.nodes.map((item) => ({
      ...item,
      position: {
        x: item.position.x - 880,
        y: item.position.y - 337,
      },
    })),
  };
  const normalizedLegacy = userBlocksModule.normalizeUserBlockDefinition(legacyNegativeDefinition);
  assert.equal(Math.min(...normalizedLegacy.nodes.map((item) => item.position.x)), 0);
  assert.equal(Math.min(...normalizedLegacy.nodes.map((item) => item.position.y)), 0);
  const legacyBlockNode = userBlocksModule.createUserBlockNode(legacyNegativeDefinition, { x: 600, y: 400 });
  const expandedLegacy = userBlocksModule.expandUserBlockInstance(
    { nodes: [legacyBlockNode], edges: [] },
    legacyBlockNode.id,
    [],
  );
  const expandedLegacyParent = expandedLegacy.nodes.find((item) => item.id === legacyBlockNode.id);
  const expandedLegacyChildren = expandedLegacy.nodes.filter(
    (item) => item.data.userBlockInstanceId === legacyBlockNode.id,
  );
  expandedLegacyChildren.forEach((child) => {
    assert.ok(child.position.x >= userBlocksModule.USER_BLOCK_CHILD_LEFT);
    assert.ok(child.position.y >= userBlocksModule.USER_BLOCK_CHILD_TOP);
    assert.ok(
      child.position.x +
        (child.measured?.width ?? child.width ?? 260) +
        userBlocksModule.USER_BLOCK_HORIZONTAL_PADDING <=
        expandedLegacyParent.width,
    );
    assert.ok(
      child.position.y +
        (child.measured?.height ?? child.height ?? 160) +
        userBlocksModule.USER_BLOCK_VERTICAL_PADDING <=
        expandedLegacyParent.height,
    );
  });

  const expanded = userBlocksModule.expandUserBlockInstance(
    { nodes: created.nodes, edges: created.edges },
    created.blockNode.id,
    [],
  );
  const expandedParent = expanded.nodes.find((item) => item.id === created.blockNode.id);
  const children = expanded.nodes.filter((item) => item.data.userBlockInstanceId === created.blockNode.id);
  assert.equal(expandedParent.data.uiState.blockExpanded, true);
  assert.equal(children.length, 2);
  const outside = node('outside', 1000, 0);
  assert.equal(
    userBlocksModule.connectionCrossesUserBlockBoundary([...expanded.nodes, outside], children[0].id, children[1].id),
    false,
  );
  assert.equal(
    userBlocksModule.connectionCrossesUserBlockBoundary([...expanded.nodes, outside], children[0].id, outside.id),
    true,
  );
  assert.equal(
    userBlocksModule.connectionCrossesUserBlockBoundary([...expanded.nodes, outside], created.blockNode.id, outside.id),
    false,
  );
  assert.equal(
    userBlocksModule.connectionCrossesUserBlockBoundary(
      [...expanded.nodes, outside],
      children[0].id,
      created.blockNode.id,
    ),
    true,
  );
  assert.equal(
    expanded.edges.some((item) => item.data?.userBlockBridge === true),
    false,
  );
  assert.ok(expanded.edges.some((item) => item.data?.userBlockInternal === true));
  assert.ok(expanded.edges.some((item) => item.source === 'source' && item.target === children[0].id));
  assert.ok(expanded.edges.some((item) => item.source === children[1].id && item.target === 'output'));

  children[1].position = { x: 920, y: 440 };
  const fitted = userBlocksModule.fitUserBlockInstance(expanded, created.blockNode.id);
  const fittedParent = fitted.nodes.find((item) => item.id === created.blockNode.id);
  assert.ok(fittedParent.width > userBlocksModule.USER_BLOCK_COLLAPSED_WIDTH);
  assert.ok(fittedParent.height > userBlocksModule.USER_BLOCK_COLLAPSED_HEIGHT);
  const escapedChild = fitted.nodes.find((item) => item.data.userBlockInstanceId === created.blockNode.id);
  escapedChild.position = { x: -240, y: -180 };
  const refitted = userBlocksModule.fitUserBlockInstance(fitted, created.blockNode.id);
  const refittedParent = refitted.nodes.find((item) => item.id === created.blockNode.id);
  const refittedChildren = refitted.nodes.filter((item) => item.data.userBlockInstanceId === created.blockNode.id);
  assert.ok(refittedParent.position.x < fittedParent.position.x);
  assert.ok(refittedParent.position.y < fittedParent.position.y);
  assert.ok(refittedChildren.every((item) => item.position.x >= userBlocksModule.USER_BLOCK_CHILD_LEFT));
  assert.ok(refittedChildren.every((item) => item.position.y >= userBlocksModule.USER_BLOCK_CHILD_TOP));

  const collapsed = userBlocksModule.collapseUserBlockInstance(refitted, created.blockNode.id, []);
  const collapsedParent = collapsed.nodes.find((item) => item.id === created.blockNode.id);
  assert.equal(collapsedParent.data.uiState.blockExpanded, false);
  assert.equal(
    collapsed.nodes.some((item) => item.data.userBlockInstanceId === created.blockNode.id),
    false,
  );
  assert.equal(collapsedParent.data.userBlockSnapshot.nodes.length, 2);
  assert.ok(
    collapsed.edges.some(
      (item) =>
        item.source === 'source' &&
        item.target === collapsedParent.id &&
        item.targetHandle === collapsedParent.data.userBlockSnapshot.inputs[0].id,
    ),
  );
  assert.ok(
    collapsed.edges.some(
      (item) =>
        item.source === collapsedParent.id &&
        item.target === 'output' &&
        item.sourceHandle === collapsedParent.data.userBlockSnapshot.outputs[0].id,
    ),
  );

  const exported = userBlocksModule.expandUserBlockGraph(collapsed.nodes, collapsed.edges, []);
  assert.equal(
    exported.nodes.some((item) => item.data.type === 'block'),
    false,
  );
  assert.equal(exported.nodes.length, 4);
  assert.ok(exported.edges.some((item) => item.source === 'source'));
  assert.ok(exported.edges.some((item) => item.target === 'output'));

  const blockForFlattening = collapsed.nodes.find((item) => item.id === created.blockNode.id);
  const extra = node('extra', blockForFlattening.position.x + 500, blockForFlattening.position.y, {
    params: {
      input: { display: 'input', type: 'image' },
      output: { display: 'output', type: 'image' },
    },
  });
  blockForFlattening.selected = true;
  extra.selected = true;
  const flattenedGraph = {
    nodes: [...collapsed.nodes, extra],
    edges: [
      ...collapsed.edges.filter((item) => item.target !== 'output'),
      edge('block-extra', blockForFlattening.id, 'extra', created.block.outputs[0].id, 'input'),
      edge('extra-output', 'extra', 'output'),
    ],
  };
  const recreated = userBlocksModule.createUserBlockFromSelection(flattenedGraph, 'Flattened block', []);
  assert.equal(recreated.ok, true);
  assert.equal(recreated.block.nodes.length, 3);
  assert.equal(
    recreated.block.nodes.some(
      (item) => item.type === 'block' || item.data?.type === 'block' || item.data?.userBlockId,
    ),
    false,
  );
});

test('Closed blocks derive possible frontier sockets and route collapsed preview updates', () => {
  const loader = node('loader', 0, 0, {
    params: {
      model: { display: 'input', type: 'pipeline' },
      pipeline: { display: 'output', type: 'pipeline' },
    },
  });
  const generate = node('generate', 360, 0, {
    params: {
      pipeline: { display: 'input', type: 'pipeline' },
      prompt: { display: 'textarea', type: 'text', value: 'Initial prompt' },
      images: { display: 'output', type: 'image' },
    },
  });
  const preview = node('preview', 720, 0, {
    params: {
      image: { display: 'input', type: 'image' },
      preview: { display: 'ui_image', type: 'url', value: null },
      selected: { display: 'output', type: 'image' },
    },
  });
  loader.selected = true;
  generate.selected = true;
  preview.selected = true;
  const created = userBlocksModule.createUserBlockFromSelection(
    {
      nodes: [loader, generate, preview],
      edges: [
        edge('loader-generate', 'loader', 'generate', 'pipeline', 'pipeline'),
        edge('generate-preview', 'generate', 'preview', 'images', 'image'),
      ],
    },
    'Closed render block',
  );
  assert.equal(created.ok, true);
  assert.deepEqual(
    created.block.inputs.map((port) => [port.nodeId, port.paramKey]),
    [['loader', 'model']],
  );
  assert.deepEqual(
    created.block.outputs.map((port) => [port.nodeId, port.paramKey]),
    [
      ['loader', 'pipeline'],
      ['generate', 'images'],
      ['preview', 'selected'],
    ],
  );
  const runtimePreviewNodeId = `${created.blockNode.id}__preview`;
  const previewTarget = userBlocksModule.collapsedUserBlockPreviewTarget(
    created.nodes,
    runtimePreviewNodeId,
    'preview',
  );
  assert.deepEqual(previewTarget, {
    nodeId: created.blockNode.id,
    fieldKey: userBlocksModule.userBlockPreviewParamId('preview', 'preview'),
  });
  assert.equal(
    userBlocksModule.runtimeProgressTarget(created.nodes, `${created.blockNode.id}__generate`, 'Generate'),
    created.blockNode.id,
    'a collapsed block owns progress from its materialized runtime child',
  );
  assert.equal(
    userBlocksModule.runtimeProgressTarget(created.nodes, 'unknown-runtime-id', 'Closed render block'),
    created.blockNode.id,
    'a unique visible label can restore progress after a durable queue snapshot',
  );
});

test('Block edits, expansion, deletion, and resize participate in graph undo and redo', async () => {
  const render = node('render', 0, 0, {
    params: {
      prompt: { display: 'textarea', type: 'text', value: 'Before' },
      image: { display: 'output', type: 'image' },
    },
  });
  render.selected = true;
  const created = userBlocksModule.createUserBlockFromSelection({ nodes: [render], edges: [] }, 'Undoable block');
  assert.equal(created.ok, true);
  const blockId = created.blockNode.id;
  const promptKey = created.block.exposedParams.find((input) => input.paramKey === 'prompt').id;
  flowStoreModule.useFlowStore.setState({
    nodes: created.nodes,
    edges: created.edges,
    historyPast: [],
    historyFuture: [],
  });

  flowStoreModule.useFlowStore.getState().setParamWithHistory(blockId, promptKey, 'After');
  assert.equal(flowStoreModule.useFlowStore.getState().nodes[0].data.params[promptKey].value, 'After');
  flowStoreModule.useFlowStore.getState().undo();
  assert.equal(flowStoreModule.useFlowStore.getState().nodes[0].data.params[promptKey].value, 'Before');
  flowStoreModule.useFlowStore.getState().redo();
  assert.equal(flowStoreModule.useFlowStore.getState().nodes[0].data.params[promptKey].value, 'After');

  flowStoreModule.useFlowStore.getState().toggleUserBlockExpanded(blockId);
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === blockId).data.uiState.blockExpanded,
    true,
  );
  flowStoreModule.useFlowStore.getState().clearNodeUiStates();
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === blockId).data.uiState.blockExpanded,
    true,
    'readiness cleanup must preserve the expanded block state',
  );
  flowStoreModule.useFlowStore.setState((state) => ({
    nodes: state.nodes.map((item) =>
      item.id === blockId
        ? {
            ...item,
            data: {
              ...item.data,
              uiState: {
                ...item.data.uiState,
                blockExpanded: undefined,
              },
            },
          }
        : item,
    ),
  }));
  assert.equal(
    userBlocksModule.isUserBlockExpandedInstance(flowStoreModule.useFlowStore.getState(), blockId),
    true,
    'materialized children must repair legacy expanded state',
  );
  flowStoreModule.useFlowStore.setState({ historyPast: [], historyFuture: [] });
  flowStoreModule.useFlowStore.getState().toggleUserBlockExpanded(blockId);
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === blockId).data.uiState.blockExpanded,
    false,
  );
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.some((item) => item.data.userBlockInstanceId === blockId),
    false,
    'collapsing a repaired block must remove its materialized children',
  );
  flowStoreModule.useFlowStore.getState().undo();
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === blockId).data.uiState.blockExpanded,
    undefined,
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: false, nodes: [blockId] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  flowStoreModule.useFlowStore.getState().removeNodes(blockId);
  await new Promise((resolve) => setTimeout(resolve, 0));
  globalThis.fetch = originalFetch;
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.some((item) => item.id === blockId),
    false,
  );
  flowStoreModule.useFlowStore.getState().undo();
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.some((item) => item.id === blockId),
    true,
  );
});

test('collapsed blocks contain their connector rows and node height has no arbitrary upper cap', () => {
  const blockSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'BlockNode.tsx'), 'utf8');
  const nodeSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'CustomNode.tsx'), 'utf8');
  const frameSource = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'CustomNodeFrame.tsx'), 'utf8');

  assert.match(blockSource, /connectorRef\.current\?\.offsetHeight/);
  assert.match(blockSource, /syncCollapsedMinimumHeight/);
  assert.doesNotMatch(blockSource, /Math\.min\(900/);
  assert.doesNotMatch(nodeSource, /MAX_NODE_HEIGHT/);
  assert.match(frameSource, /maxHeight:\s*'none'/);
});

test('Auto canvas renders the exact workflow graph instead of a projected facade', () => {
  const workflowSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'Workflow.tsx'), 'utf8');
  const bridgeSource = fs.readFileSync(path.join(ROOT, 'src', 'studio', 'graphBridge.ts'), 'utf8');
  const runPreparation = bridgeSource.match(
    /export async function ensureStudioGraphReadyForRun[\s\S]*?\n\}\n\nexport \{/,
  )?.[0];
  assert.doesNotMatch(workflowSource, /buildManagedWorkflowPresentation|managedAutoCanvas|ManagedWorkflowStageNode/);
  assert.match(workflowSource, /nodes=\{exactVisibleNodes\}/);
  assert.match(workflowSource, /edges=\{exactVisibleEdges\}/);
  assert.match(workflowSource, /nodesDraggable[\s\S]*nodesConnectable[\s\S]*elementsSelectable/);
  assert.ok(runPreparation);
  assert.doesNotMatch(runPreparation, /createOrUpdateStudioGraph/);
  assert.match(
    runPreparation,
    /const currentForm = useStudioStore\.getState\(\)\.form[\s\S]*validateStudioGraphReadyForRun\(currentForm\)/,
  );
  assert.doesNotMatch(runPreparation, /validateStudioGraphReadyForRun\(form\);\s*\}/);
});

test('managed control synchronization keeps live exact-graph aliases and extension groups distinct', () => {
  const prompt = managedNode('prompt-primary', 'qwenGenerate', {
    params: { prompt: { type: 'text', display: 'textarea', value: 'Before' } },
  });
  const promptAlias = managedNode('prompt-alias', 'diffusersImageGenerate', {
    params: { prompt: { type: 'text', display: 'textarea', value: 'Before alias' } },
  });
  const imageLoader = managedNode('control-image', 'loadImage', {
    params: { file: { type: 'string', display: 'filebrowser', value: '' } },
  });
  const binding = {
    mode: 'control_image',
    modelType: 'QwenImageModularPipeline',
    nodes: { qwenGenerate: prompt.id, loadImage: imageLoader.id },
    managedNodeIds: [prompt.id, promptAlias.id, imageLoader.id],
    managedEdgeIds: [],
    fingerprint: 'managed-control-sync',
    createdAt: 1,
    updatedAt: 1,
  };
  flowStoreModule.useFlowStore.setState({ nodes: [prompt, promptAlias, imageLoader], edges: [] });

  assert.equal(managedControlSync.managedControlFormKey(prompt, 'prompt', binding), 'prompt');
  assert.equal(managedControlSync.managedControlFormKey(imageLoader, 'file', binding), 'controlImage');
  managedControlSync.syncManagedControlGroup(binding, 'form:prompt', 'After');
  assert.deepEqual(
    flowStoreModule.useFlowStore
      .getState()
      .nodes.slice(0, 2)
      .map((item) => item.data.params.prompt.value),
    ['After', 'After'],
  );

  const soundtrack = managedNode('soundtrack', 'soundtrackGenerate', {
    params: { prompt: { type: 'text', display: 'textarea', value: '' } },
  });
  assert.equal(
    managedControlSync.managedControlSyncGroup(soundtrack, 'prompt', {
      ...binding,
      mode: 'text_to_video',
      modelType: 'WanVideoPipeline',
    }),
    'soundtrack:prompt',
  );

  const lyricOverlay = managedNode('lyric-overlay', 'lyricOverlay', {
    params: { fps: { type: 'int', value: 24 } },
  });
  assert.equal(
    managedControlSync.managedControlSyncGroup(lyricOverlay, 'fps', {
      ...binding,
      mode: 'text_to_audio',
      modelType: 'AceStepAudioPipeline',
    }),
    'lyric-visual:fps',
  );

  const ltxGenerate = managedNode('ltx-generate', 'wanGenerate', {
    params: { strength: { type: 'float', value: 0.8 } },
  });
  assert.equal(
    managedControlSync.managedControlFormKey(ltxGenerate, 'strength', {
      ...binding,
      mode: 'video_to_video',
      modelType: 'LTXVideoPipeline',
    }),
    'conditioningScale',
  );
});

test('backend declarative field bindings synchronize opaque managed fields without model identity branches', () => {
  const resolutionBinding = {
    schemaVersion: 1,
    group: 'source-resolution',
    formFields: ['width', 'height'],
    transform: 'nearest-option-to-long-edge',
  };
  const promptNode = managedNode('opaque-action-a', 'prompt', { params: {} });
  const imageNode = managedNode('opaque-action-b', 'imageEncode', { params: {} });
  const binding = {
    mode: 'layer_decomposition',
    modelType: 'OpaqueSyntheticPipelineIdentity',
    nodes: { prompt: promptNode.id, imageEncode: imageNode.id },
    managedNodeIds: [promptNode.id, imageNode.id],
    managedEdgeIds: [],
    fingerprint: 'opaque-declarative-binding',
    createdAt: 1,
    updatedAt: 1,
  };
  flowStoreModule.useFlowStore.setState({ nodes: [promptNode, imageNode], edges: [] });
  studioStoreModule.useStudioStore.setState({
    graphBinding: binding,
    form: {
      ...studioStoreModule.useStudioStore.getState().form,
      width: 1000,
      height: 512,
      maxSequenceLength: 777,
    },
  });

  // Simulate two backend node-definition responses arriving after an opaque
  // model selection. Field names are intentionally unrelated to any model or
  // known parameter alias; the backend metadata is the only binding source.
  flowStoreModule.useFlowStore.getState().replaceNodeParams(promptNode.id, {
    contract_alpha: {
      type: 'int',
      default: 640,
      options: [640, 1024],
      fieldOptions: { studioBinding: resolutionBinding },
    },
    contract_tokens: {
      type: 'int',
      default: 1024,
      fieldOptions: {
        studioBinding: {
          schemaVersion: 1,
          group: 'maximum-sequence-length',
          formFields: ['maxSequenceLength'],
          transform: 'identity',
        },
      },
    },
  });
  flowStoreModule.useFlowStore.getState().replaceNodeParams(imageNode.id, {
    contract_omega: {
      type: 'int',
      default: 640,
      options: [640, 1024],
      fieldOptions: { studioBinding: resolutionBinding },
    },
  });

  let form = studioStoreModule.useStudioStore.getState().form;
  managedControlSync.syncManagedFormControlAliases(form, binding);
  let nodes = flowStoreModule.useFlowStore.getState().nodes;
  assert.equal(nodes[0].data.params.contract_alpha.value, 1024);
  assert.equal(nodes[1].data.params.contract_omega.value, 1024);
  assert.equal(nodes[0].data.params.contract_tokens.value, 777);

  studioStoreModule.useStudioStore.getState().updateForm({ width: 640, height: 640 });
  form = studioStoreModule.useStudioStore.getState().form;
  managedControlSync.syncManagedFormControlAliases(form, binding);
  nodes = flowStoreModule.useFlowStore.getState().nodes;
  assert.equal(nodes[0].data.params.contract_alpha.value, 640);
  assert.equal(nodes[1].data.params.contract_omega.value, 640);

  managedControlSync.syncManagedNodeControlChange(promptNode.id, 'contract_alpha', 1024);
  nodes = flowStoreModule.useFlowStore.getState().nodes;
  assert.equal(nodes[0].data.params.contract_alpha.value, 1024);
  assert.equal(nodes[1].data.params.contract_omega.value, 1024);

  managedControlSync.syncManagedNodeControlChange(promptNode.id, 'contract_tokens', 896);
  assert.equal(studioStoreModule.useStudioStore.getState().form.maxSequenceLength, 896);
  assert.equal(flowStoreModule.useFlowStore.getState().nodes[0].data.params.contract_tokens.value, 896);

  const malformed = managedNode('malformed-binding', 'qwenGenerate', {
    params: {
      max_sequence_length: {
        type: 'int',
        value: 111,
        fieldOptions: {
          studioBinding: {
            schemaVersion: 1,
            group: 'maximum-sequence-length',
            formFields: ['maxSequenceLength'],
            transform: 'identity',
            unexpected: true,
          },
        },
      },
    },
  });
  flowStoreModule.useFlowStore.setState((state) => ({ nodes: [...state.nodes, malformed] }));
  const malformedBinding = {
    ...binding,
    managedNodeIds: [...binding.managedNodeIds, malformed.id],
  };
  assert.equal(
    managedControlSync.managedControlSyncGroup(malformed, 'max_sequence_length', malformedBinding),
    undefined,
  );
  assert.equal(managedControlSync.managedControlFormKey(malformed, 'max_sequence_length', malformedBinding), undefined);
  managedControlSync.syncManagedFormControlAliases(studioStoreModule.useStudioStore.getState().form, malformedBinding);
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === malformed.id).data.params
      .max_sequence_length.value,
    111,
  );

  const oversized = managedNode('oversized-binding', 'imageEncode', {
    params: {
      attacker_dimension: {
        type: 'int',
        value: 321,
        options: [640, 1_000_000],
        fieldOptions: { studioBinding: resolutionBinding },
      },
    },
  });
  const oversizedBinding = {
    ...binding,
    managedNodeIds: [...binding.managedNodeIds, oversized.id],
  };
  flowStoreModule.useFlowStore.setState((state) => ({ nodes: [...state.nodes, oversized] }));
  assert.equal(
    managedControlSync.managedControlSyncGroup(oversized, 'attacker_dimension', oversizedBinding),
    undefined,
  );
  managedControlSync.syncManagedFormControlAliases(studioStoreModule.useStudioStore.getState().form, oversizedBinding);
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === oversized.id).data.params
      .attacker_dimension.value,
    321,
  );

  const directDimension = managedNode('direct-dimension-binding', 'imageEncode', {
    params: {
      attacker_width: {
        type: 'int',
        value: 320,
        fieldOptions: {
          studioBinding: {
            schemaVersion: 1,
            group: 'direct-dimension',
            formFields: ['width'],
            transform: 'identity',
          },
        },
      },
    },
  });
  const directDimensionBinding = {
    ...binding,
    managedNodeIds: [...binding.managedNodeIds, directDimension.id],
  };
  flowStoreModule.useFlowStore.setState((state) => ({ nodes: [...state.nodes, directDimension] }));
  assert.equal(
    managedControlSync.managedControlSyncGroup(directDimension, 'attacker_width', directDimensionBinding),
    undefined,
  );
  managedControlSync.syncManagedNodeControlChange(directDimension.id, 'attacker_width', 1_000_000);
  assert.equal(studioStoreModule.useStudioStore.getState().form.width, 640);
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === directDimension.id).data.params
      .attacker_width.value,
    320,
  );

  const bridgeSource = fs.readFileSync(path.join(ROOT, 'src', 'studio', 'graphBridge.ts'), 'utf8');
  assert.doesNotMatch(bridgeSource, /QwenImageLayeredModularPipeline/);
});

test('managed modular topology follows opaque route handles and retains the inpaint mask fallback', async () => {
  const input = (type) => ({ type, display: 'input' });
  const output = (type) => ({ type, display: 'output' });
  const route = 'opaque_modular_route';
  const buildFixture = (
    mode,
    {
      promptImage = true,
      routeHandles = false,
      includeImage = true,
      includeControl = mode === 'control_image',
      distinctControlImage = true,
      fixtureId = '',
    } = {},
  ) => {
    const prefix = `route-${mode}${fixtureId ? `-${fixtureId}` : ''}`;
    const models = managedContractNode(`${prefix}-models`, 'models', 'modules.ModularDiffusers', 'ModelsLoader', {
      model_type: { type: 'string', value: 'QwenImageLayeredModularPipeline' },
      repo_id: { type: 'string', value: '' },
      text_encoders: output('TextEncoders'),
      unet_out: output('DenoiseModel'),
      vae_out: output('VAE'),
      scheduler: output('Scheduler'),
    });
    const prompt = managedContractNode(`${prefix}-prompt`, 'prompt', 'modules.ModularDiffusers', 'EncodePrompt', {
      text_encoders: input('TextEncoders'),
      prompt: { type: 'text', value: '' },
      embeddings: output('TextEmbeddings'),
      ...(promptImage ? { image: input('image') } : {}),
    });
    const denoise = managedContractNode(`${prefix}-denoise`, 'denoise', 'modules.ModularDiffusers', 'Denoise', {
      unet: input('DenoiseModel'),
      scheduler: input('Scheduler'),
      embeddings: input('TextEmbeddings'),
      image_latents: input('Latents'),
      ...(includeControl ? { controlnet_bundle: input('custom_controlnet') } : {}),
      latents: output('Latents'),
      width: { type: 'int', value: 512 },
      height: { type: 'int', value: 512 },
      seed: { type: 'int', value: { value: 0, isRandom: true } },
      ...(routeHandles ? { route_state_in: input(route), route_state_out: output(route) } : {}),
    });
    const decode = managedContractNode(`${prefix}-decode`, 'decode', 'modules.ModularDiffusers', 'DecodeLatents', {
      vae: input('VAE'),
      latents: input('Latents'),
      images: output('image'),
      ...(routeHandles ? { route_state_in: input(route) } : {}),
    });
    const preview = managedContractNode(`${prefix}-preview`, 'preview', 'modules.Image', 'Preview', {
      image: input('image'),
    });
    const nodes = [models, prompt, denoise, decode, preview];
    const roles = {
      models: models.id,
      prompt: prompt.id,
      denoise: denoise.id,
      decode: decode.id,
      preview: preview.id,
    };
    if (includeImage || includeControl) {
      const loadImage = managedContractNode(`${prefix}-source`, 'loadImage', 'modules.Image', 'Load', {
        file: { type: 'string', value: '' },
        image: output('image'),
      });
      nodes.push(loadImage);
      roles.loadImage = loadImage.id;
    }
    if (includeImage && includeControl && distinctControlImage) {
      const loadControlImage = managedContractNode(
        `${prefix}-control-source`,
        'loadControlImage',
        'modules.Image',
        'Load',
        {
          file: { type: 'string', value: '' },
          image: output('image'),
        },
      );
      nodes.push(loadControlImage);
      roles.loadControlImage = loadControlImage.id;
    }
    if (includeImage) {
      const imageEncode = managedContractNode(
        `${prefix}-encode`,
        'imageEncode',
        'modules.ModularDiffusers',
        'ImageEncode',
        {
          vae: input('VAE'),
          image: input('image'),
          image_latents: output('Latents'),
          width: { type: 'int', value: 512 },
          height: { type: 'int', value: 512 },
          seed: { type: 'int', value: { value: 0, isRandom: true } },
          ...(routeHandles ? { route_state_out: output(route) } : {}),
        },
      );
      nodes.push(imageEncode);
      roles.imageEncode = imageEncode.id;
    }
    if (mode === 'inpaint') {
      const loadMask = managedContractNode(`${prefix}-mask`, 'loadMask', 'modules.Image', 'Load', {
        file: { type: 'string', value: '' },
        image: output('image'),
      });
      const applyMask = managedContractNode(`${prefix}-apply`, 'applyMask', 'modules.Image', 'ApplyMask', {
        image: input('image'),
        mask: input('image'),
        output: output('image'),
      });
      nodes.push(loadMask, applyMask);
      roles.loadMask = loadMask.id;
      roles.applyMask = applyMask.id;
    }
    if (includeControl) {
      const controlnetModel = managedContractNode(
        `${prefix}-control-model`,
        'controlnetModel',
        'modules.ModularDiffusers',
        'AutoModelLoader',
        {
          model_id: { type: 'string', value: '' },
          model: output('ControlNetModel'),
        },
      );
      const controlnet = managedContractNode(
        `${prefix}-controlnet`,
        'controlnet',
        'modules.ModularDiffusers',
        'Controlnet',
        {
          vae: input('VAE'),
          control_image: input('image'),
          controlnet: input('ControlNetModel'),
          controlnet_bundle: output('custom_controlnet'),
          width: { type: 'int', value: 512 },
          height: { type: 'int', value: 512 },
          seed: { type: 'int', value: { value: 0, isRandom: true } },
          controlnet_conditioning_scale: { type: 'float', value: 1 },
        },
      );
      nodes.push(controlnetModel, controlnet);
      roles.controlnetModel = controlnetModel.id;
      roles.controlnet = controlnet.id;
    }
    const form = {
      ...studioStoreModule.useStudioStore.getState().form,
      mode,
      modelType: 'QwenImageLayeredModularPipeline',
      resourceMode: 'expert',
      quantizationMode: 'none',
      referenceImages: ['opaque-source.png'],
      controlImage: 'opaque-control.png',
      maskImage: 'opaque-mask.png',
      width: 768,
      height: 640,
      seed: 321,
      randomSeed: false,
    };
    const binding = {
      mode,
      modelType: form.modelType,
      nodes: roles,
      managedNodeIds: nodes.map((item) => item.id),
      managedEdgeIds: [],
      fingerprint: `${mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}`,
      createdAt: 1,
      updatedAt: 1,
    };
    flowStoreModule.useFlowStore.setState({ nodes, edges: [] });
    studioStoreModule.useStudioStore.setState({
      form,
      graphBinding: binding,
      graphFinalization: null,
      autoFieldOverrides: {},
      autoResourcePlan: null,
    });
    return { binding, form, roles };
  };
  const addParams = (nodeId, params) => {
    const node = flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === nodeId);
    flowStoreModule.useFlowStore.getState().replaceNodeParams(nodeId, { ...node.data.params, ...params });
  };
  const removeParams = (nodeId, keys) => {
    const node = flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === nodeId);
    flowStoreModule.useFlowStore
      .getState()
      .replaceNodeParams(
        nodeId,
        Object.fromEntries(Object.entries(node.data.params).filter(([key]) => !keys.includes(key))),
      );
  };
  const hasEdge = (source, sourceHandle, target, targetHandle) =>
    flowStoreModule.useFlowStore
      .getState()
      .edges.some(
        (edge) =>
          edge.source === source &&
          edge.sourceHandle === sourceHandle &&
          edge.target === target &&
          edge.targetHandle === targetHandle,
      );

  const inpaint = buildFixture('inpaint');
  assert.equal(graphBridge.markStudioGraphDefinitionPending(), true);
  assert.equal(graphBridge.syncStudioGraphDefinition(inpaint.form), true);
  assert.equal(
    hasEdge(inpaint.roles.loadImage, 'image', inpaint.roles.applyMask, 'image'),
    true,
    'contracts without route handles retain ApplyMask',
  );
  assert.equal(hasEdge(inpaint.roles.applyMask, 'output', inpaint.roles.imageEncode, 'image'), true);
  let imageParams = flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === inpaint.roles.imageEncode)
    .data.params;
  assert.equal(imageParams.width.value, 768);
  assert.equal(imageParams.height.value, 640);
  assert.deepEqual(imageParams.seed.value, { value: 321, isRandom: false });
  const fallbackProof = studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof.fieldSchemaHash;

  const decodeNode = flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === inpaint.roles.decode);
  nodesStoreModule.useNodesStore.setState({
    nodesRegistry: {
      'modules.ModularDiffusers.DecodeLatents': { ...decodeNode.data, params: { ...decodeNode.data.params } },
    },
  });
  studioStoreModule.useStudioStore.getState().ensureWorkflowTabs();
  const originalTab = studioStoreModule.useStudioStore.getState().activeWorkflowTabId;
  websocketMessageHandler.handleWebsocketMessage(
    {
      type: 'node_definition',
      node: inpaint.roles.decode,
      params: { route_state_in: input(route) },
    },
    { sid: null },
  );
  const otherTab = studioStoreModule.useStudioStore.getState().createWorkflowTab('Definition timer owner');
  studioStoreModule.useStudioStore.getState().switchWorkflowTab(originalTab);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.notEqual(otherTab, originalTab);
  assert.equal(
    studioStoreModule.useStudioStore.getState().graphFinalization,
    null,
    'the definition timer captured before A-to-B-to-A cannot reconcile the restored canvas',
  );
  assert.equal(graphBridge.syncStudioGraphDefinition(inpaint.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(hasEdge(inpaint.roles.loadImage, 'image', inpaint.roles.applyMask, 'image'), true);

  addParams(inpaint.roles.imageEncode, {
    mask_image: input('image'),
    route_state_out: output(route),
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(inpaint.form), false);
  assert.equal(hasEdge(inpaint.roles.applyMask, 'output', inpaint.roles.imageEncode, 'image'), true);

  addParams(inpaint.roles.denoise, {
    route_state_in: input(route),
    route_state_out: output(route),
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(inpaint.form), true);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'complete');
  assert.equal(hasEdge(inpaint.roles.loadImage, 'image', inpaint.roles.imageEncode, 'image'), true);
  assert.equal(hasEdge(inpaint.roles.loadMask, 'image', inpaint.roles.imageEncode, 'mask_image'), true);
  assert.equal(hasEdge(inpaint.roles.imageEncode, 'route_state_out', inpaint.roles.denoise, 'route_state_in'), true);
  assert.equal(hasEdge(inpaint.roles.denoise, 'route_state_out', inpaint.roles.decode, 'route_state_in'), true);
  assert.equal(hasEdge(inpaint.roles.denoise, 'latents', inpaint.roles.decode, 'latents'), true);
  assert.equal(
    flowStoreModule.useFlowStore
      .getState()
      .edges.some((edge) => edge.source === inpaint.roles.applyMask || edge.target === inpaint.roles.applyMask),
    false,
  );
  const nativeBinding = studioStoreModule.useStudioStore.getState().graphBinding;
  assert.equal(nativeBinding.managedEdgeIds.length, 14, 'the route-only Qwen inpaint edge ledger remains unchanged');
  assert.equal(nativeBinding.finalizationProof.schemaVersion, 2);
  assert.match(nativeBinding.finalizationProof.edgeSpecHash, /^graph-v1-/);
  assert.notEqual(nativeBinding.finalizationProof.fieldSchemaHash, fallbackProof);
  assert.deepEqual(
    [...nativeBinding.managedEdgeIds].sort(),
    flowStoreModule.useFlowStore
      .getState()
      .edges.map((edge) => edge.id)
      .sort(),
  );

  const nativeEdges = flowStoreModule.useFlowStore.getState().edges;
  const nativeRouteEdge = nativeEdges.find(
    (edge) => edge.source === inpaint.roles.denoise && edge.sourceHandle === 'route_state_out',
  );
  assert.ok(nativeRouteEdge);
  flowStoreModule.useFlowStore.setState({
    edges: nativeEdges.map((edge) => (edge.id === nativeRouteEdge.id ? { ...edge, targetHandle: 'latents' } : edge)),
  });
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(inpaint.form), /graph changed/i);
  const previousFinalizedAt = nativeBinding.finalizationProof.finalizedAt;
  studioStoreModule.useStudioStore.setState({ graphFinalization: null });
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(await graphBridge.waitForStudioGraphFinalization(2_000), true);
  const repairedState = studioStoreModule.useStudioStore.getState();
  assert.equal(repairedState.graphFinalization.status, 'complete');
  assert.ok(repairedState.graphBinding.finalizationProof.finalizedAt > previousFinalizedAt);
  assert.equal(
    hasEdge(inpaint.roles.denoise, 'route_state_out', inpaint.roles.decode, 'route_state_in'),
    true,
    'restore revalidation repairs the exact endpoint before readiness returns',
  );
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(inpaint.form), null);

  const typedInpaint = buildFixture('inpaint', {
    fixtureId: 'typed-state',
    promptImage: false,
    routeHandles: true,
  });
  addParams(typedInpaint.roles.imageEncode, {
    mask_image: input('image'),
    mask: output('OpaqueMaskState'),
    masked_image_latents: output('OpaqueMaskedLatents'),
  });
  addParams(typedInpaint.roles.denoise, {
    vae: input('VAE'),
    mask: input('OpaqueMaskState'),
    masked_image_latents: input('OpaqueMaskedLatents'),
  });
  flowStoreModule.useFlowStore.getState().replaceNodeParams(typedInpaint.roles.applyMask, {});
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(typedInpaint.form), true);
  const typedState = studioStoreModule.useStudioStore.getState();
  const typedEdgeLedger = [
    [typedInpaint.roles.models, 'text_encoders', typedInpaint.roles.prompt, 'text_encoders'],
    [typedInpaint.roles.models, 'unet_out', typedInpaint.roles.denoise, 'unet'],
    [typedInpaint.roles.models, 'scheduler', typedInpaint.roles.denoise, 'scheduler'],
    [typedInpaint.roles.models, 'vae_out', typedInpaint.roles.denoise, 'vae'],
    [typedInpaint.roles.models, 'vae_out', typedInpaint.roles.decode, 'vae'],
    [typedInpaint.roles.prompt, 'embeddings', typedInpaint.roles.denoise, 'embeddings'],
    [typedInpaint.roles.denoise, 'latents', typedInpaint.roles.decode, 'latents'],
    [typedInpaint.roles.decode, 'images', typedInpaint.roles.preview, 'image'],
    [typedInpaint.roles.denoise, 'route_state_out', typedInpaint.roles.decode, 'route_state_in'],
    [typedInpaint.roles.models, 'vae_out', typedInpaint.roles.imageEncode, 'vae'],
    [typedInpaint.roles.loadImage, 'image', typedInpaint.roles.imageEncode, 'image'],
    [typedInpaint.roles.loadMask, 'image', typedInpaint.roles.imageEncode, 'mask_image'],
    [typedInpaint.roles.imageEncode, 'image_latents', typedInpaint.roles.denoise, 'image_latents'],
    [typedInpaint.roles.imageEncode, 'route_state_out', typedInpaint.roles.denoise, 'route_state_in'],
    [typedInpaint.roles.imageEncode, 'mask', typedInpaint.roles.denoise, 'mask'],
    [typedInpaint.roles.imageEncode, 'masked_image_latents', typedInpaint.roles.denoise, 'masked_image_latents'],
  ]
    .map(([source, sourceHandle, target, targetHandle]) => `${source}:${sourceHandle}->${target}:${targetHandle}`)
    .sort();
  assert.deepEqual(
    flowStoreModule.useFlowStore
      .getState()
      .edges.map((edge) => `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`)
      .sort(),
    typedEdgeLedger,
  );
  assert.equal(typedState.graphBinding.managedEdgeIds.length, 16);
  assert.equal(typedState.graphBinding.finalizationProof.schemaVersion, 2);
  assert.equal(
    flowStoreModule.useFlowStore
      .getState()
      .edges.some(
        (edge) => edge.source === typedInpaint.roles.applyMask || edge.target === typedInpaint.roles.applyMask,
      ),
    false,
    'native typed state does not require ApplyMask fields or connections',
  );
  assert.equal(
    flowStoreModule.useFlowStore
      .getState()
      .edges.some((edge) => edge.target === typedInpaint.roles.prompt && edge.targetHandle === 'image'),
    false,
    'the optional prompt image is absent from the exact native state ledger',
  );

  const sealedTypedEdges = structuredClone(flowStoreModule.useFlowStore.getState().edges);
  const sealedTypedProof = typedState.graphBinding.finalizationProof;
  const maskStateEdge = sealedTypedEdges.find(
    (edge) => edge.source === typedInpaint.roles.imageEncode && edge.sourceHandle === 'mask',
  );
  assert.ok(maskStateEdge);
  flowStoreModule.useFlowStore.setState({
    edges: sealedTypedEdges.map((edge) =>
      edge.id === maskStateEdge.id ? { ...edge, targetHandle: 'image_latents' } : edge,
    ),
  });
  assert.match(
    graphBridge.getStudioGraphRunBlockingMessage(typedInpaint.form),
    /graph changed/i,
    'the typed-state proof seals exact edge endpoints',
  );
  flowStoreModule.useFlowStore.setState({ edges: sealedTypedEdges });
  addParams(typedInpaint.roles.denoise, { mask: input(' OpaqueMaskState') });
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(typedInpaint.form), /graph changed/i);
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(typedInpaint.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(
    flowStoreModule.useFlowStore
      .getState()
      .edges.some(
        (edge) => edge.source === typedInpaint.roles.applyMask || edge.target === typedInpaint.roles.applyMask,
      ),
    false,
    'a padded typed-state mismatch cannot downgrade to ApplyMask',
  );
  addParams(typedInpaint.roles.denoise, { mask: input('OpaqueMaskState') });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(typedInpaint.form), true);
  assert.notStrictEqual(
    studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof,
    sealedTypedProof,
    'schema repair mints a fresh proof',
  );

  removeParams(typedInpaint.roles.imageEncode, ['mask', 'masked_image_latents']);
  removeParams(typedInpaint.roles.denoise, ['vae', 'mask', 'masked_image_latents']);
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(typedInpaint.form), false);
  const strippedTypedState = studioStoreModule.useStudioStore.getState();
  assert.equal(strippedTypedState.graphFinalization.status, 'pending');
  assert.equal(strippedTypedState.graphBinding.finalizationProof, undefined);
  assert.equal(hasEdge(typedInpaint.roles.loadImage, 'image', typedInpaint.roles.applyMask, 'image'), false);
  assert.equal(
    hasEdge(typedInpaint.roles.imageEncode, 'route_state_out', typedInpaint.roles.denoise, 'route_state_in'),
    true,
  );

  const routeOnlyQwenForm = {
    ...typedInpaint.form,
    modelType: 'QwenImageEditPlusModularPipeline',
  };
  addParams(typedInpaint.roles.prompt, { image: input('image') });
  studioStoreModule.useStudioStore.setState({
    form: routeOnlyQwenForm,
    graphBinding: {
      ...strippedTypedState.graphBinding,
      modelType: routeOnlyQwenForm.modelType,
      fingerprint: `${routeOnlyQwenForm.mode}:${routeOnlyQwenForm.modelType}:${routeOnlyQwenForm.resourceMode}:${routeOnlyQwenForm.quantizationMode}`,
      finalizationProof: undefined,
    },
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(routeOnlyQwenForm), true);
  const routeOnlyQwenState = studioStoreModule.useStudioStore.getState();
  assert.equal(routeOnlyQwenState.graphFinalization.status, 'complete');
  assert.equal(routeOnlyQwenState.graphBinding.finalizationProof.schemaVersion, 2);
  assert.equal(routeOnlyQwenState.graphBinding.managedEdgeIds.length, 14);
  assert.equal(routeOnlyQwenState.graphBinding.createdAt, typedState.graphBinding.createdAt);
  assert.equal(routeOnlyQwenState.graphBinding.nodes.denoise, typedState.graphBinding.nodes.denoise);
  assert.equal(routeOnlyQwenState.graphBinding.nodes.imageEncode, typedState.graphBinding.nodes.imageEncode);
  assert.equal(
    hasEdge(typedInpaint.roles.imageEncode, 'route_state_out', typedInpaint.roles.denoise, 'route_state_in'),
    true,
  );
  assert.equal(
    flowStoreModule.useFlowStore
      .getState()
      .edges.some(
        (edge) =>
          (edge.source === typedInpaint.roles.models &&
            edge.sourceHandle === 'vae_out' &&
            edge.target === typedInpaint.roles.denoise) ||
          (edge.source === typedInpaint.roles.imageEncode &&
            ['mask', 'masked_image_latents'].includes(edge.sourceHandle)),
      ),
    false,
    'a new route-only fingerprint does not inherit the prior typed-state latch',
  );
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(routeOnlyQwenForm), null);

  const lateTyped = buildFixture('inpaint', {
    fixtureId: 'late-state',
    promptImage: false,
    routeHandles: true,
  });
  addParams(lateTyped.roles.imageEncode, { mask_image: input('image') });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(lateTyped.form), true);
  assert.ok(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof);
  addParams(lateTyped.roles.denoise, { vae: input('VAE') });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(lateTyped.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(
    hasEdge(lateTyped.roles.loadImage, 'image', lateTyped.roles.applyMask, 'image'),
    false,
    'the Denoise VAE marker requires the complete typed inpaint state instead of legacy fallback',
  );
  addParams(lateTyped.roles.imageEncode, {
    mask: output('OpaqueMaskState'),
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(lateTyped.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(hasEdge(lateTyped.roles.loadImage, 'image', lateTyped.roles.applyMask, 'image'), false);
  addParams(lateTyped.roles.imageEncode, { masked_image_latents: output('OpaqueMaskedLatents') });
  addParams(lateTyped.roles.denoise, {
    mask: input('OpaqueMaskState'),
    masked_image_latents: input('OpaqueMaskedLatents'),
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(lateTyped.form), true);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.managedEdgeIds.length, 16);
  addParams(lateTyped.roles.imageEncode, {
    masked_image_latents: { type: 'OpaqueMaskedLatents', display: 'input' },
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(lateTyped.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  addParams(lateTyped.roles.imageEncode, { masked_image_latents: output('OpaqueMaskedLatents') });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(lateTyped.form), true);
  addParams(lateTyped.roles.denoise, { mask: input('') });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(lateTyped.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  addParams(lateTyped.roles.denoise, { mask: input('OpaqueMaskState') });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(lateTyped.form), true);

  const persistedTypedEvidence = buildFixture('inpaint', {
    fixtureId: 'persisted-state-edge',
    promptImage: false,
    routeHandles: true,
  });
  addParams(persistedTypedEvidence.roles.imageEncode, { mask_image: input('image') });
  const persistedVaeEdge = {
    id: 'persisted-native-denoise-vae-edge',
    source: persistedTypedEvidence.roles.models,
    sourceHandle: 'vae_out',
    target: persistedTypedEvidence.roles.denoise,
    targetHandle: 'vae',
    type: 'default',
  };
  flowStoreModule.useFlowStore.setState({ edges: [persistedVaeEdge] });
  studioStoreModule.useStudioStore.setState({
    graphBinding: { ...persistedTypedEvidence.binding, managedEdgeIds: [persistedVaeEdge.id] },
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(persistedTypedEvidence.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(
    hasEdge(persistedTypedEvidence.roles.loadImage, 'image', persistedTypedEvidence.roles.applyMask, 'image'),
    false,
  );

  const edit = buildFixture('edit_image', { promptImage: false, routeHandles: true });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(edit.form), true);
  assert.equal(hasEdge(edit.roles.imageEncode, 'route_state_out', edit.roles.denoise, 'route_state_in'), true);
  assert.equal(hasEdge(edit.roles.denoise, 'route_state_out', edit.roles.decode, 'route_state_in'), true);
  assert.equal(hasEdge(edit.roles.denoise, 'latents', edit.roles.decode, 'latents'), true);
  assert.equal(
    flowStoreModule.useFlowStore
      .getState()
      .edges.some((edge) => edge.target === edit.roles.prompt && edge.targetHandle === 'image'),
    false,
    'image-conditioned prompt input remains optional',
  );

  const textControl = buildFixture('control_image', { includeImage: false, routeHandles: true });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(textControl.form), true);
  assert.equal(
    hasEdge(textControl.roles.controlnet, 'controlnet_bundle', textControl.roles.denoise, 'controlnet_bundle'),
    true,
    'legacy bundle-only ControlNet definitions remain unchanged',
  );
  assert.equal(
    hasEdge(textControl.roles.controlnet, 'route_state_out', textControl.roles.denoise, 'route_state_in'),
    false,
  );
  assert.equal(hasEdge(textControl.roles.denoise, 'route_state_out', textControl.roles.decode, 'route_state_in'), true);
  addParams(textControl.roles.controlnet, { route_state_in: input(route) });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(textControl.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(
    hasEdge(textControl.roles.controlnet, 'controlnet_bundle', textControl.roles.denoise, 'controlnet_bundle'),
    true,
    'a partial route publication retains the last stable bundle topology',
  );
  addParams(textControl.roles.controlnet, { route_state_out: output(route) });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(textControl.form), true);
  assert.equal(
    hasEdge(textControl.roles.controlnet, 'route_state_out', textControl.roles.denoise, 'route_state_in'),
    true,
  );
  assert.equal(hasEdge(textControl.roles.denoise, 'route_state_out', textControl.roles.decode, 'route_state_in'), true);
  assert.equal(
    flowStoreModule.useFlowStore
      .getState()
      .edges.some((edge) => edge.target === textControl.roles.controlnet && edge.targetHandle === 'route_state_in'),
    false,
    'an unused ControlNet route input does not invent an ImageEncode prefix',
  );
  const textControlParams = flowStoreModule.useFlowStore
    .getState()
    .nodes.find((item) => item.id === textControl.roles.controlnet).data.params;
  assert.deepEqual(textControlParams.seed.value, { value: 321, isRandom: false });
  assert.equal(textControl.roles.loadControlImage, undefined);
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === textControl.roles.loadImage).data.params
      .file.value,
    'opaque-control.png',
  );

  const missingControlLoader = buildFixture('edit_image', {
    includeControl: true,
    routeHandles: true,
    distinctControlImage: false,
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(missingControlLoader.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(
    hasEdge(missingControlLoader.roles.loadImage, 'image', missingControlLoader.roles.controlnet, 'control_image'),
    false,
    'a combined image and ControlNet graph never reuses the source image loader as control input',
  );

  for (const mode of ['layer_decomposition', 'multi_image_reference_edit', 'outpaint']) {
    const unsupportedCombined = buildFixture(mode, { includeControl: true, routeHandles: true });
    graphBridge.markStudioGraphDefinitionPending();
    assert.equal(graphBridge.syncStudioGraphDefinition(unsupportedCombined.form), false);
    const unsupportedState = studioStoreModule.useStudioStore.getState();
    assert.equal(unsupportedState.graphFinalization.status, 'pending');
    assert.equal(unsupportedState.graphBinding.finalizationProof, undefined);
    assert.match(graphBridge.getStudioGraphRunBlockingMessage(unsupportedCombined.form), /route pending/i);
    assert.equal(
      flowStoreModule.useFlowStore
        .getState()
        .edges.some(
          (item) =>
            item.source === unsupportedCombined.roles.loadControlImage ||
            item.source === unsupportedCombined.roles.controlnet ||
            item.target === unsupportedCombined.roles.controlnet,
        ),
      false,
      `${mode} cannot adopt combined ControlNet topology`,
    );
    assert.doesNotMatch(
      graphBridge.getStudioGraphShapeKey(unsupportedCombined.form),
      /loadControlImage|controlnetModel|controlnet/,
    );
  }

  const imageControl = buildFixture('edit_image', { includeControl: true, routeHandles: true });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(imageControl.form), true);
  assert.equal(
    hasEdge(imageControl.roles.imageEncode, 'route_state_out', imageControl.roles.denoise, 'route_state_in'),
    true,
    'ControlNet definitions with no route handles preserve the legacy image route',
  );
  const legacyImageControlProof =
    studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof.edgeSpecHash;
  addParams(imageControl.roles.controlnet, { route_state_out: output(route) });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(imageControl.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(
    hasEdge(imageControl.roles.imageEncode, 'image_latents', imageControl.roles.denoise, 'image_latents'),
    true,
  );
  assert.equal(
    hasEdge(imageControl.roles.controlnet, 'controlnet_bundle', imageControl.roles.denoise, 'controlnet_bundle'),
    true,
  );
  assert.equal(hasEdge(imageControl.roles.loadImage, 'image', imageControl.roles.imageEncode, 'image'), true);
  assert.equal(
    hasEdge(imageControl.roles.loadControlImage, 'image', imageControl.roles.controlnet, 'control_image'),
    true,
  );
  assert.equal(hasEdge(imageControl.roles.loadImage, 'image', imageControl.roles.controlnet, 'control_image'), false);
  assert.equal(
    hasEdge(imageControl.roles.imageEncode, 'route_state_out', imageControl.roles.denoise, 'route_state_in'),
    true,
    'the incomplete ControlNet action retains the last stable direct image route',
  );
  addParams(imageControl.roles.controlnet, { route_state_in: input(`${route}_mismatch`) });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(imageControl.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  addParams(imageControl.roles.controlnet, { route_state_in: input(route) });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(imageControl.form), true);
  assert.equal(
    hasEdge(imageControl.roles.imageEncode, 'route_state_out', imageControl.roles.controlnet, 'route_state_in'),
    true,
  );
  assert.equal(
    hasEdge(imageControl.roles.imageEncode, 'route_state_out', imageControl.roles.denoise, 'route_state_in'),
    false,
    'a routed ImageEncode feeds ControlNet instead of bypassing it',
  );
  assert.equal(
    hasEdge(imageControl.roles.controlnet, 'route_state_out', imageControl.roles.denoise, 'route_state_in'),
    true,
  );
  assert.equal(
    hasEdge(imageControl.roles.denoise, 'route_state_out', imageControl.roles.decode, 'route_state_in'),
    true,
  );
  const routedImageControlState = studioStoreModule.useStudioStore.getState();
  const routedImageControlEdges = flowStoreModule.useFlowStore.getState().edges;
  const routedControlEdge = routedImageControlEdges.find(
    (edge) =>
      edge.source === imageControl.roles.controlnet &&
      edge.sourceHandle === 'route_state_out' &&
      edge.target === imageControl.roles.denoise &&
      edge.targetHandle === 'route_state_in',
  );
  assert.equal(routedImageControlState.graphBinding.finalizationProof.schemaVersion, 2);
  assert.notEqual(routedImageControlState.graphBinding.finalizationProof.edgeSpecHash, legacyImageControlProof);
  assert.ok(routedControlEdge);
  assert.ok(routedImageControlState.graphBinding.managedEdgeIds.includes(routedControlEdge.id));
  for (const nodeId of [imageControl.roles.imageEncode, imageControl.roles.controlnet, imageControl.roles.denoise]) {
    const params = flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === nodeId).data.params;
    assert.deepEqual(params.seed.value, { value: 321, isRandom: false });
  }
  const imageControlNodes = flowStoreModule.useFlowStore.getState().nodes;
  assert.deepEqual(imageControlNodes.find((item) => item.id === imageControl.roles.loadImage).data.params.file.value, [
    'opaque-source.png',
  ]);
  assert.equal(
    imageControlNodes.find((item) => item.id === imageControl.roles.loadControlImage).data.params.file.value,
    'opaque-control.png',
  );

  const sealedImageControlState = studioStoreModule.useStudioStore.getState();
  const sealedImageControlBinding = structuredClone(sealedImageControlState.graphBinding);
  const sealedImageControlNodes = structuredClone(flowStoreModule.useFlowStore.getState().nodes);
  const sealedImageControlEdges = structuredClone(flowStoreModule.useFlowStore.getState().edges);
  const staleLayerForm = { ...imageControl.form, mode: 'layer_decomposition' };
  flowStoreModule.useFlowStore.setState({ edges: [] });
  studioStoreModule.useStudioStore.setState({
    form: staleLayerForm,
    graphBinding: { ...structuredClone(sealedImageControlBinding), finalizationProof: undefined },
    graphFinalization: null,
  });
  assert.equal(graphBridge.syncStudioGraphDefinition(staleLayerForm), false);
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(staleLayerForm), /graph changed/i);
  assert.match(
    graphBridge.getStudioGraphRunBlockingMessage({ ...staleLayerForm, modelType: 'FluxSchnellPipeline' }),
    /graph changed/i,
  );
  assert.equal(await graphBridge.waitForStudioGraphFinalization(500), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);

  flowStoreModule.useFlowStore.setState({ nodes: sealedImageControlNodes, edges: sealedImageControlEdges });
  studioStoreModule.useStudioStore.setState({
    form: imageControl.form,
    graphBinding: sealedImageControlBinding,
    graphFinalization: structuredClone(sealedImageControlState.graphFinalization),
  });
  const detachedOptionalIds = new Set([
    imageControl.roles.loadControlImage,
    imageControl.roles.controlnetModel,
    imageControl.roles.controlnet,
  ]);
  const detachedBindingNodes = { ...sealedImageControlBinding.nodes };
  delete detachedBindingNodes.loadControlImage;
  delete detachedBindingNodes.controlnetModel;
  delete detachedBindingNodes.controlnet;
  flowStoreModule.useFlowStore.setState((state) => ({
    edges: state.edges.filter((item) => !detachedOptionalIds.has(item.source) && !detachedOptionalIds.has(item.target)),
  }));
  studioStoreModule.useStudioStore.setState({
    graphBinding: {
      ...sealedImageControlBinding,
      nodes: detachedBindingNodes,
      finalizationProof: undefined,
    },
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(imageControl.form), false);
  const detachedState = studioStoreModule.useStudioStore.getState();
  assert.equal(detachedState.graphFinalization.status, 'pending');
  assert.equal(detachedState.graphBinding.finalizationProof, undefined);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(imageControl.form), /graph changed/i);
  assert.equal(await graphBridge.waitForStudioGraphFinalization(1_000), false);
  const detachedWaitState = studioStoreModule.useStudioStore.getState();
  assert.notEqual(detachedWaitState.graphFinalization.status, 'complete');
  assert.equal(detachedWaitState.graphBinding.finalizationProof, undefined);

  const controlInpaint = buildFixture('inpaint', {
    includeControl: true,
    routeHandles: true,
  });
  addParams(controlInpaint.roles.imageEncode, { mask_image: input('image') });
  addParams(controlInpaint.roles.controlnet, {
    route_state_in: input(route),
    route_state_out: output(route),
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(controlInpaint.form), true);
  assert.equal(hasEdge(controlInpaint.roles.loadImage, 'image', controlInpaint.roles.imageEncode, 'image'), true);
  assert.equal(hasEdge(controlInpaint.roles.loadMask, 'image', controlInpaint.roles.imageEncode, 'mask_image'), true);
  assert.equal(
    hasEdge(controlInpaint.roles.loadControlImage, 'image', controlInpaint.roles.controlnet, 'control_image'),
    true,
  );
  assert.equal(
    hasEdge(controlInpaint.roles.imageEncode, 'image_latents', controlInpaint.roles.denoise, 'image_latents'),
    true,
  );
  assert.equal(
    hasEdge(controlInpaint.roles.imageEncode, 'route_state_out', controlInpaint.roles.controlnet, 'route_state_in'),
    true,
  );
  assert.equal(
    hasEdge(controlInpaint.roles.controlnet, 'controlnet_bundle', controlInpaint.roles.denoise, 'controlnet_bundle'),
    true,
  );
  assert.equal(
    hasEdge(controlInpaint.roles.controlnet, 'route_state_out', controlInpaint.roles.denoise, 'route_state_in'),
    true,
  );
  assert.equal(
    hasEdge(controlInpaint.roles.denoise, 'route_state_out', controlInpaint.roles.decode, 'route_state_in'),
    true,
  );
  assert.equal(
    flowStoreModule.useFlowStore
      .getState()
      .edges.some(
        (edge) =>
          edge.source === controlInpaint.roles.applyMask ||
          edge.target === controlInpaint.roles.applyMask ||
          (edge.source === controlInpaint.roles.imageEncode &&
            edge.sourceHandle === 'route_state_out' &&
            edge.target === controlInpaint.roles.denoise),
      ),
    false,
  );
  const controlInpaintState = studioStoreModule.useStudioStore.getState();
  const controlInpaintNodes = flowStoreModule.useFlowStore.getState().nodes;
  assert.equal(controlInpaintState.graphFinalization.status, 'complete');
  assert.equal(controlInpaintState.graphBinding.finalizationProof.schemaVersion, 2);
  assert.match(controlInpaintState.graphBinding.finalizationProof.edgeSpecHash, /^graph-v1-/);
  assert.ok(controlInpaintState.graphBinding.managedNodeIds.includes(controlInpaint.roles.loadControlImage));
  assert.deepEqual(
    [...controlInpaintState.graphBinding.managedEdgeIds].sort(),
    flowStoreModule.useFlowStore
      .getState()
      .edges.map((edge) => edge.id)
      .sort(),
  );
  assert.deepEqual(
    controlInpaintNodes.find((item) => item.id === controlInpaint.roles.loadImage).data.params.file.value,
    ['opaque-source.png'],
  );
  assert.equal(
    controlInpaintNodes.find((item) => item.id === controlInpaint.roles.loadControlImage).data.params.file.value,
    'opaque-control.png',
  );
  assert.equal(
    controlInpaintNodes.find((item) => item.id === controlInpaint.roles.loadMask).data.params.file.value,
    'opaque-mask.png',
  );
  for (const nodeId of [
    controlInpaint.roles.imageEncode,
    controlInpaint.roles.controlnet,
    controlInpaint.roles.denoise,
  ]) {
    const params = controlInpaintNodes.find((item) => item.id === nodeId).data.params;
    assert.deepEqual(params.seed.value, { value: 321, isRandom: false });
  }

  nodesStoreModule.useNodesStore.setState({
    nodesRegistry: Object.fromEntries(
      controlInpaintNodes.map((item) => [`${item.data.module}.${item.data.action}`, structuredClone(item.data)]),
    ),
  });
  const removedControlLoaderId = controlInpaint.roles.loadControlImage;
  flowStoreModule.useFlowStore.setState((state) => ({
    nodes: state.nodes.filter((item) => item.id !== removedControlLoaderId),
    edges: state.edges.filter(
      (item) => item.source !== removedControlLoaderId && item.target !== removedControlLoaderId,
    ),
  }));
  const nativeWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = undefined;
  try {
    await graphBridge.createOrUpdateStudioGraph(controlInpaint.form);
  } finally {
    globalThis.WebSocket = nativeWebSocket;
  }
  const rebuiltState = studioStoreModule.useStudioStore.getState();
  const rebuiltBinding = rebuiltState.graphBinding;
  const rebuiltControlLoaderId = rebuiltBinding.nodes.loadControlImage;
  const participatingControlRoles = [
    'models',
    'prompt',
    'denoise',
    'decode',
    'preview',
    'loadImage',
    'loadMask',
    'applyMask',
    'imageEncode',
    'loadControlImage',
    'controlnetModel',
    'controlnet',
  ];
  assert.notEqual(rebuiltControlLoaderId, removedControlLoaderId, 'a missing optional loader is reconstructed');
  assert.equal(rebuiltState.graphFinalization.status, 'complete');
  assert.match(rebuiltBinding.finalizationProof.shapeKey, /\|loadControlImage\|controlnetModel\|controlnet$/);
  assert.doesNotMatch(
    graphBridge.getStudioGraphShapeKey(controlInpaint.form),
    /loadControlImage|controlnetModel|controlnet/,
  );
  for (const role of participatingControlRoles) {
    assert.ok(rebuiltBinding.nodes[role], `${role} survives binding rebuild`);
    assert.ok(rebuiltBinding.managedNodeIds.includes(rebuiltBinding.nodes[role]), `${role} remains managed`);
  }
  assert.equal(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === rebuiltControlLoaderId).data.params.file
      .value,
    'opaque-control.png',
  );

  const restoredProof = structuredClone(rebuiltBinding.finalizationProof);
  studioStoreModule.useStudioStore.setState({ graphFinalization: null });
  assert.equal(await graphBridge.waitForStudioGraphFinalization(2_000), true);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'complete');
  assert.deepEqual(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, restoredProof);

  const finalizedBinding = structuredClone(studioStoreModule.useStudioStore.getState().graphBinding);
  const finalizedNodes = structuredClone(flowStoreModule.useFlowStore.getState().nodes);
  const optionalRoleMutations = [
    ['loadControlImage', (data) => ({ ...data, module: 'modules.MutatedImage' })],
    ['controlnetModel', (data) => ({ ...data, action: 'MutatedLoader' })],
    [
      'controlnet',
      (data) => ({
        ...data,
        params: {
          ...data.params,
          control_image: { ...data.params.control_image, type: 'mutated_image' },
        },
      }),
    ],
  ];
  for (const [role, mutate] of optionalRoleMutations) {
    flowStoreModule.useFlowStore.setState({ nodes: structuredClone(finalizedNodes) });
    studioStoreModule.useStudioStore.setState({
      graphBinding: structuredClone(finalizedBinding),
      graphFinalization: { ...rebuiltState.graphFinalization },
    });
    const roleId = finalizedBinding.nodes[role];
    flowStoreModule.useFlowStore.setState((state) => ({
      nodes: state.nodes.map((item) => (item.id === roleId ? { ...item, data: mutate(item.data) } : item)),
    }));
    assert.match(
      graphBridge.getStudioGraphRunBlockingMessage(controlInpaint.form),
      /graph changed/i,
      `${role} schema mutations invalidate the combined graph proof`,
    );
    assert.equal(graphBridge.markStudioGraphDefinitionPending(), true);
    assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  }

  const bridgeSource = fs.readFileSync(path.join(ROOT, 'src', 'studio', 'graphBridge.ts'), 'utf8');
  const routeTopologySource = bridgeSource.match(
    /function modularRouteTopology[\s\S]*?\n\}\n\nfunction desiredBaseEdgeSpecs/,
  )?.[0];
  assert.ok(routeTopologySource);
  assert.doesNotMatch(routeTopologySource, /Qwen|SDXL|modelType/);
  assert.doesNotMatch(bridgeSource, /usesQwenDirect(?:TextToImage|Inpaint|Outpaint)/);
  assert.doesNotMatch(
    bridgeSource,
    /finalizeDirectQwen|desiredQwen(?:TextToImage|Inpaint|Outpaint)EdgeSpecs|usesQwenDirectInpaintPipeline/,
    'literal-false direct Qwen branches do not retain unreachable edge or finalization implementations',
  );

  const text = buildFixture('text_to_image', { includeImage: false });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(text.form), true);
  const textFallbackProof = studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof.fieldSchemaHash;
  addParams(text.roles.denoise, { route_state_out: output(route) });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(text.form), false);
  assert.equal(hasEdge(text.roles.denoise, 'route_state_out', text.roles.decode, 'route_state_in'), false);
  addParams(text.roles.decode, { route_state_in: input(route) });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(text.form), true);
  assert.equal(hasEdge(text.roles.denoise, 'route_state_out', text.roles.decode, 'route_state_in'), true);
  assert.notEqual(
    studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof.fieldSchemaHash,
    textFallbackProof,
    'late opaque text route handles mint a new proof only after both endpoints exist',
  );

  const textMismatch = buildFixture('text_to_image', { includeImage: false });
  assert.equal(graphBridge.syncStudioGraphDefinition(textMismatch.form), true);
  addParams(textMismatch.roles.denoise, { route_state_out: output('opaque_route_alpha') });
  addParams(textMismatch.roles.decode, { route_state_in: input('opaque_route_beta') });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(textMismatch.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(
    hasEdge(textMismatch.roles.denoise, 'route_state_out', textMismatch.roles.decode, 'route_state_in'),
    false,
  );

  const malformed = buildFixture('inpaint');
  assert.equal(graphBridge.syncStudioGraphDefinition(malformed.form), true);
  const setCompleteRoute = (
    imageType,
    denoiseInputType,
    denoiseOutputType,
    decodeType,
    maskType = 'image',
    denoiseInputDisplay = 'input',
  ) => {
    addParams(malformed.roles.imageEncode, {
      mask_image: input(maskType),
      route_state_out: output(imageType),
    });
    addParams(malformed.roles.denoise, {
      route_state_in: { type: denoiseInputType, display: denoiseInputDisplay },
      route_state_out: output(denoiseOutputType),
    });
    addParams(malformed.roles.decode, { route_state_in: input(decodeType) });
    graphBridge.markStudioGraphDefinitionPending();
    return graphBridge.syncStudioGraphDefinition(malformed.form);
  };
  const assertMalformedPending = () => {
    assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
    assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
    assert.equal(hasEdge(malformed.roles.loadImage, 'image', malformed.roles.applyMask, 'image'), true);
    assert.equal(
      hasEdge(malformed.roles.imageEncode, 'route_state_out', malformed.roles.denoise, 'route_state_in'),
      false,
    );
  };

  assert.equal(
    setCompleteRoute('opaque_route_alpha', 'opaque_route_alpha', 'opaque_route_beta', 'opaque_route_beta'),
    false,
  );
  assertMalformedPending();
  assert.equal(setCompleteRoute(' opaque_route', 'opaque_route', 'opaque_route', 'opaque_route'), false);
  assertMalformedPending();
  assert.equal(setCompleteRoute(['opaque_route'], 'opaque_route', 'opaque_route', 'opaque_route'), false);
  assertMalformedPending();
  assert.equal(
    setCompleteRoute('opaque_route', 'opaque_route', 'opaque_route', 'opaque_route', 'image', 'output'),
    false,
  );
  assertMalformedPending();
  assert.equal(setCompleteRoute('opaque_route', 'opaque_route', 'opaque_route', 'opaque_route', 'other_image'), false);
  assertMalformedPending();
  const partialBinding = studioStoreModule.useStudioStore.getState().graphBinding;
  const forgedProof = craftedFinalizationProof(partialBinding, [
    'models',
    'prompt',
    'denoise',
    'decode',
    'preview',
    'loadImage',
    'loadMask',
    'applyMask',
    'imageEncode',
  ]);
  studioStoreModule.useStudioStore.setState({
    graphBinding: {
      ...partialBinding,
      finalizationProof: { ...forgedProof, finalizedAt: Date.now() },
    },
    graphFinalization: {
      status: 'complete',
      bindingFingerprint: partialBinding.fingerprint,
      startedAt: null,
      timedOutGroups: [],
      managedEdgeCount: partialBinding.managedEdgeIds.length,
    },
  });
  assert.match(
    graphBridge.getStudioGraphRunBlockingMessage(malformed.form),
    /graph changed/i,
    'a recomputed checksum cannot authorize a semantically incomplete route contract',
  );
  assert.equal(setCompleteRoute('opaque_route', 'opaque_route', 'opaque_route', 'opaque_route'), true);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'complete');
});

test('restored modular video groups require exact typed I2V and first-last-frame state routes', () => {
  const input = (type) => ({ type, display: 'input' });
  const output = (type) => ({ type, display: 'output' });
  const scalar = (display) => ({ type: 'int', ...(display ? { display } : {}) });
  let fixtureSequence = 0;
  const buildFixture = ({ flf = false, omit = null } = {}) => {
    fixtureSequence += 1;
    const prefix = `modular-video-${fixtureSequence}`;
    const routeType = 'opaque_video_route';
    const models = managedContractNode(prefix + '-models', 'models', 'modules.ModularDiffusers', 'ModelsLoader', {
      model_type: { type: 'string', value: 'opaque-modular-video' },
      text_encoders: output('diffusers_auto_models'),
      image_encoder: output('diffusers_auto_model'),
      unet_out: output('diffusers_auto_model'),
      scheduler: output('diffusers_auto_model'),
      vae_out: output('diffusers_auto_model'),
    });
    const prompt = managedContractNode(prefix + '-prompt', 'prompt', 'modules.ModularDiffusers', 'EncodePrompt', {
      text_encoders: input('diffusers_auto_models'),
      prompt: { type: 'string', display: 'textarea', value: '' },
      negative_prompt: { type: 'string', display: 'textarea', value: '' },
      embeddings: output('embeddings'),
    });
    const loadImage = managedContractNode(prefix + '-opening', 'loadImage', 'modules.Image', 'Load', {
      file: { type: 'string', value: ['opening.png'] },
      alpha_channel: { type: 'string', value: 'remove alpha' },
      image: output('image'),
    });
    const imageEmbeddings = managedContractNode(
      prefix + '-image-embeddings',
      'imageEmbeddings',
      'modules.ModularDiffusers',
      'ImageEmbeddings',
      {
        image: input('image'),
        last_image: input('image'),
        image_encoder: input('diffusers_auto_model'),
        width: scalar(),
        height: scalar(),
        image_embeds: output('image_embeds'),
        route_state_out: output(routeType),
      },
    );
    const imageEncode = managedContractNode(
      prefix + '-image-encode',
      'imageEncode',
      'modules.ModularDiffusers',
      'ImageEncode',
      {
        image: input('image'),
        last_image: input('image'),
        vae: input('diffusers_auto_model'),
        width: scalar(),
        height: scalar(),
        num_frames: scalar('slider'),
        seed: scalar('random'),
        route_state_in: input(routeType),
        image_condition_latents: output('video_condition_latents'),
        route_state_out: output(routeType),
      },
    );
    const denoise = managedContractNode(prefix + '-denoise', 'denoise', 'modules.ModularDiffusers', 'Denoise', {
      unet: input('diffusers_auto_model'),
      scheduler: input('diffusers_auto_model'),
      vae: input('diffusers_auto_model'),
      embeddings: input('embeddings'),
      image_embeds: input('image_embeds'),
      image_condition_latents: input('video_condition_latents'),
      width: scalar(),
      height: scalar(),
      num_frames: scalar('slider'),
      seed: scalar('random'),
      num_inference_steps: { type: 'int', display: 'slider' },
      guidance_scale: { type: 'float', display: 'slider' },
      route_state_in: input(routeType),
      latents: output('latents'),
      route_state_out: output(routeType),
    });
    const decode = managedContractNode(prefix + '-decode', 'decode', 'modules.ModularDiffusers', 'DecodeLatents', {
      vae: input('diffusers_auto_model'),
      latents: input('latents'),
      route_state_in: input(routeType),
      videos: output('video'),
    });
    const videoExport = managedContractNode(prefix + '-export', 'videoExport', 'modules.Video', 'Export', {
      video: input('video'),
      fps: { type: 'int', value: 16 },
      output: output('video'),
    });
    const nodes = [models, prompt, loadImage, imageEmbeddings, imageEncode, denoise, decode, videoExport];
    const roles = {
      models: models.id,
      prompt: prompt.id,
      loadImage: loadImage.id,
      imageEmbeddings: imageEmbeddings.id,
      imageEncode: imageEncode.id,
      denoise: denoise.id,
      decode: decode.id,
      videoExport: videoExport.id,
    };
    if (flf) {
      const loadLastImage = managedContractNode(prefix + '-ending', 'loadLastImage', 'modules.Image', 'Load', {
        file: { type: 'string', value: ['ending.png'] },
        alpha_channel: { type: 'string', value: 'remove alpha' },
        image: output('image'),
      });
      nodes.push(loadLastImage);
      roles.loadLastImage = loadLastImage.id;
    }
    if (omit) {
      const target = nodes.find((item) => item.data.studioRole === omit.role);
      delete target.data.params[omit.field];
    }
    const form = {
      ...studioStoreModule.useStudioStore.getState().form,
      mode: 'image_to_video',
      modelType: 'WanImageToVideoPipeline',
      resourceMode: 'expert',
      quantizationMode: 'none',
      referenceImages: ['opening-from-form.png'],
      width: 832,
      height: 480,
      numFrames: 81,
      seed: 1234,
      randomSeed: false,
      steps: 40,
      guidanceScale: 3.5,
      fps: 16,
    };
    const binding = {
      mode: form.mode,
      modelType: form.modelType,
      nodes: roles,
      managedNodeIds: nodes.map((item) => item.id),
      managedEdgeIds: [],
      fingerprint: `${form.mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}`,
      createdAt: fixtureSequence,
      updatedAt: 1,
    };
    flowStoreModule.useFlowStore.setState({ nodes, edges: [] });
    studioStoreModule.useStudioStore.setState({
      form,
      graphBinding: binding,
      graphFinalization: null,
      autoFieldOverrides: {},
      autoResourcePlan: null,
    });
    return { binding, form, roles };
  };
  const replaceParam = (nodeId, field, param) => {
    const item = flowStoreModule.useFlowStore.getState().nodes.find((node) => node.id === nodeId);
    flowStoreModule.useFlowStore.getState().replaceNodeParams(nodeId, { ...item.data.params, [field]: param });
  };
  const ledger = () =>
    flowStoreModule.useFlowStore
      .getState()
      .edges.map((item) => `${item.source}:${item.sourceHandle}->${item.target}:${item.targetHandle}`)
      .sort();

  const i2v = buildFixture();
  assert.equal(graphBridge.markStudioGraphDefinitionPending(), true);
  assert.equal(graphBridge.syncStudioGraphDefinition(i2v.form), true);
  const i2vState = studioStoreModule.useStudioStore.getState();
  assert.equal(i2vState.graphFinalization.status, 'complete');
  assert.equal(i2vState.graphBinding.managedEdgeIds.length, 17);
  assert.equal(i2vState.graphBinding.finalizationProof.schemaVersion, 2);
  assert.match(i2vState.graphBinding.finalizationProof.shapeKey, /imageEmbeddings\|imageEncode/);
  assert.deepEqual(
    ledger(),
    [
      [i2v.roles.models, 'text_encoders', i2v.roles.prompt, 'text_encoders'],
      [i2v.roles.models, 'image_encoder', i2v.roles.imageEmbeddings, 'image_encoder'],
      [i2v.roles.models, 'vae_out', i2v.roles.imageEncode, 'vae'],
      [i2v.roles.models, 'unet_out', i2v.roles.denoise, 'unet'],
      [i2v.roles.models, 'scheduler', i2v.roles.denoise, 'scheduler'],
      [i2v.roles.models, 'vae_out', i2v.roles.denoise, 'vae'],
      [i2v.roles.models, 'vae_out', i2v.roles.decode, 'vae'],
      [i2v.roles.loadImage, 'image', i2v.roles.imageEmbeddings, 'image'],
      [i2v.roles.loadImage, 'image', i2v.roles.imageEncode, 'image'],
      [i2v.roles.prompt, 'embeddings', i2v.roles.denoise, 'embeddings'],
      [i2v.roles.imageEmbeddings, 'image_embeds', i2v.roles.denoise, 'image_embeds'],
      [i2v.roles.imageEmbeddings, 'route_state_out', i2v.roles.imageEncode, 'route_state_in'],
      [i2v.roles.imageEncode, 'image_condition_latents', i2v.roles.denoise, 'image_condition_latents'],
      [i2v.roles.imageEncode, 'route_state_out', i2v.roles.denoise, 'route_state_in'],
      [i2v.roles.denoise, 'latents', i2v.roles.decode, 'latents'],
      [i2v.roles.denoise, 'route_state_out', i2v.roles.decode, 'route_state_in'],
      [i2v.roles.decode, 'videos', i2v.roles.videoExport, 'video'],
    ]
      .map(([source, sourceHandle, target, targetHandle]) => `${source}:${sourceHandle}->${target}:${targetHandle}`)
      .sort(),
  );
  assert.equal(
    flowStoreModule.useFlowStore.getState().edges.some((item) => item.sourceHandle === 'first_last_frame_latents'),
    false,
  );
  const i2vNodes = flowStoreModule.useFlowStore.getState().nodes;
  assert.deepEqual(i2vNodes.find((item) => item.id === i2v.roles.loadImage).data.params.file.value, [
    'opening-from-form.png',
  ]);
  for (const role of ['imageEmbeddings', 'imageEncode', 'denoise']) {
    const params = i2vNodes.find((item) => item.id === i2v.roles[role]).data.params;
    assert.equal(params.width.value, 832);
    assert.equal(params.height.value, 480);
  }
  for (const role of ['imageEncode', 'denoise']) {
    const params = i2vNodes.find((item) => item.id === i2v.roles[role]).data.params;
    assert.equal(params.num_frames.value, 81);
    assert.deepEqual(params.seed.value, { value: 1234, isRandom: false });
  }
  managedControlSync.syncManagedNodeControlChange(i2v.roles.imageEmbeddings, 'width', 768);
  assert.equal(studioStoreModule.useStudioStore.getState().form.width, 768);
  for (const role of ['imageEmbeddings', 'imageEncode', 'denoise']) {
    assert.equal(
      flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === i2v.roles[role]).data.params.width.value,
      768,
    );
  }

  const sealedI2v = structuredClone(i2vState.graphBinding);
  const sealedI2vEdges = structuredClone(flowStoreModule.useFlowStore.getState().edges);
  replaceParam(i2v.roles.denoise, 'vae', input('mutated_vae'));
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(i2v.form), /graph changed/i);
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(i2v.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.deepEqual(
    ledger(),
    sealedI2vEdges.map((item) => `${item.source}:${item.sourceHandle}->${item.target}:${item.targetHandle}`).sort(),
  );
  replaceParam(i2v.roles.denoise, 'vae', input('diffusers_auto_model'));
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(i2v.form), true);
  assert.notDeepEqual(
    studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof,
    sealedI2v.finalizationProof,
  );

  const segmentedRoute = buildFixture();
  replaceParam(segmentedRoute.roles.imageEmbeddings, 'route_state_out', output('route_alpha'));
  replaceParam(segmentedRoute.roles.imageEncode, 'route_state_in', input('route_alpha'));
  replaceParam(segmentedRoute.roles.imageEncode, 'route_state_out', output('route_beta'));
  replaceParam(segmentedRoute.roles.denoise, 'route_state_in', input('route_beta'));
  replaceParam(segmentedRoute.roles.denoise, 'route_state_out', output('route_gamma'));
  replaceParam(segmentedRoute.roles.decode, 'route_state_in', input('route_gamma'));
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(segmentedRoute.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(
    flowStoreModule.useFlowStore.getState().edges.length,
    0,
    'pairwise-valid route segments cannot mint three unrelated route identities',
  );

  const malformedContracts = [
    ['imageEmbeddings', 'image_embeds', { type: 'image_embeds', display: 'input' }],
    ['imageEncode', 'image_condition_latents', output(' video_condition_latents')],
    ['imageEncode', 'seed', scalar('slider')],
    ['loadImage', 'image', input('image')],
    ['denoise', 'route_state_out', output('')],
  ];
  for (const [role, field, param] of malformedContracts) {
    const malformedContract = buildFixture();
    replaceParam(malformedContract.roles[role], field, param);
    graphBridge.markStudioGraphDefinitionPending();
    assert.equal(
      graphBridge.syncStudioGraphDefinition(malformedContract.form),
      false,
      `${role}.${field} malformed type/display remains pending`,
    );
    assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
    assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);
  }

  const duplicateRole = buildFixture();
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(duplicateRole.form), true);
  const duplicate = managedContractNode(
    'duplicate-hidden-image-embeddings',
    'imageEmbeddings',
    'modules.ModularDiffusers',
    'ImageEmbeddings',
    {},
  );
  flowStoreModule.useFlowStore.setState((state) => ({ nodes: [...state.nodes, duplicate] }));
  assert.match(
    graphBridge.getStudioGraphRunBlockingMessage(duplicateRole.form),
    /graph changed/i,
    'an unsealed duplicate modular-video role invalidates the proof',
  );
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(duplicateRole.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);

  const missingCoreMap = buildFixture();
  const deletedCoreNodes = { ...missingCoreMap.binding.nodes };
  delete deletedCoreNodes.imageEmbeddings;
  studioStoreModule.useStudioStore.setState({
    graphBinding: { ...missingCoreMap.binding, nodes: deletedCoreNodes },
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(missingCoreMap.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(missingCoreMap.form), /route pending/i);

  studioStoreModule.useStudioStore.setState({
    graphBinding: {
      ...missingCoreMap.binding,
      nodes: { ...missingCoreMap.binding.nodes, imageEmbeddings: missingCoreMap.roles.denoise },
    },
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(missingCoreMap.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(missingCoreMap.form), /route pending/i);

  const flf = buildFixture({ flf: true, omit: { role: 'imageEncode', field: 'last_image' } });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(flf.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0, 'partial FLF never falls back to I2V edges');
  replaceParam(flf.roles.imageEncode, 'last_image', input('image'));
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(flf.form), true);
  const flfState = studioStoreModule.useStudioStore.getState();
  assert.equal(flfState.graphBinding.managedEdgeIds.length, 19);
  assert.match(flfState.graphBinding.finalizationProof.shapeKey, /\|loadLastImage$/);
  assert.ok(ledger().includes(`${flf.roles.loadLastImage}:image->${flf.roles.imageEmbeddings}:last_image`));
  assert.ok(ledger().includes(`${flf.roles.loadLastImage}:image->${flf.roles.imageEncode}:last_image`));
  assert.deepEqual(
    flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === flf.roles.loadLastImage).data.params.file
      .value,
    ['ending.png'],
    'form synchronization never aliases the opening image into the ending-image loader',
  );

  const flfNodeIds = new Set([flf.roles.loadLastImage]);
  const strippedNodes = { ...flfState.graphBinding.nodes };
  delete strippedNodes.loadLastImage;
  flowStoreModule.useFlowStore.setState((state) => ({
    nodes: state.nodes.filter((item) => !flfNodeIds.has(item.id)),
    edges: state.edges.filter((item) => !flfNodeIds.has(item.source) && !flfNodeIds.has(item.target)),
  }));
  studioStoreModule.useStudioStore.setState({
    graphBinding: {
      ...flfState.graphBinding,
      nodes: strippedNodes,
      managedNodeIds: flfState.graphBinding.managedNodeIds.filter((id) => !flfNodeIds.has(id)),
      managedEdgeIds: flowStoreModule.useFlowStore.getState().edges.map((item) => item.id),
      finalizationProof: undefined,
    },
  });
  graphBridge.markStudioGraphDefinitionPending();
  assert.equal(graphBridge.syncStudioGraphDefinition(flf.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(flf.form), /route pending/i);

  const partialLast = managedContractNode('partial-last-only', 'loadLastImage', 'modules.Image', 'Load', {
    file: { type: 'string', value: ['ending-only.png'] },
    image: output('image'),
  });
  const partialLastBinding = {
    mode: flf.form.mode,
    modelType: flf.form.modelType,
    nodes: {},
    managedNodeIds: [partialLast.id],
    managedEdgeIds: [],
    fingerprint: flfState.graphBinding.fingerprint,
    createdAt: 99_999,
    updatedAt: 1,
  };
  flowStoreModule.useFlowStore.setState({ nodes: [partialLast], edges: [] });
  studioStoreModule.useStudioStore.setState({ graphBinding: partialLastBinding, graphFinalization: null });
  assert.equal(
    graphBridge.markStudioGraphDefinitionPending(),
    true,
    'a live managed ending-image role is Modular evidence even without its binding map or route edges',
  );
  assert.equal(graphBridge.syncStudioGraphDefinition(flf.form), false);
  assert.equal(studioStoreModule.useStudioStore.getState().graphFinalization.status, 'pending');
  assert.equal(studioStoreModule.useStudioStore.getState().graphBinding.finalizationProof, undefined);
  assert.equal(flowStoreModule.useFlowStore.getState().edges.length, 0);
  assert.match(graphBridge.getStudioGraphRunBlockingMessage(flf.form), /route pending/i);

  const replacementWanPipeline = managedContractNode(
    'replacement-standard-pipeline',
    'wanPipeline',
    'modules.DiffusersVideo',
    'LoadPipeline',
    {},
  );
  const replacementGenerate = managedContractNode(
    'replacement-standard-generate',
    'wanGenerate',
    'modules.DiffusersVideo',
    'Generate',
    {},
  );
  const replacementExport = managedContractNode(flf.roles.videoExport, 'videoExport', 'modules.Video', 'Export', {});
  const replacementRecipe = managedContractNode(
    'replacement-standard-recipe',
    'diffusersRecipe',
    'modules.DiffusersRuntime',
    'DiffusersExecutionRecipe',
    {},
  );
  const replacementQuantization = managedContractNode(
    'replacement-standard-quantization',
    'diffusersQuantization',
    'modules.DiffusersRuntime',
    'PipelineQuantizationConfigV2',
    {},
  );
  const replacementNodes = [
    replacementQuantization,
    replacementRecipe,
    replacementWanPipeline,
    replacementGenerate,
    replacementExport,
  ];
  flowStoreModule.useFlowStore.setState({ nodes: replacementNodes, edges: [] });
  studioStoreModule.useStudioStore.setState({
    graphBinding: {
      mode: flfState.graphBinding.mode,
      modelType: flfState.graphBinding.modelType,
      nodes: {
        diffusersQuantization: replacementQuantization.id,
        diffusersRecipe: replacementRecipe.id,
        wanPipeline: replacementWanPipeline.id,
        wanGenerate: replacementGenerate.id,
        videoExport: replacementExport.id,
      },
      managedNodeIds: replacementNodes.map((item) => item.id),
      managedEdgeIds: [],
      fingerprint: flfState.graphBinding.fingerprint,
      createdAt: flfState.graphBinding.createdAt,
      updatedAt: flfState.graphBinding.updatedAt,
    },
    graphFinalization: null,
  });
  assert.equal(
    graphBridge.markStudioGraphDefinitionPending(),
    false,
    'a distinct standard-video node group cannot inherit the prior Modular/FLF latch',
  );
  assert.equal(graphBridge.getStudioGraphRunBlockingMessage(flf.form), null);

  const standardForm = {
    ...flf.form,
    modelType: 'WanTI2VPipeline',
    mode: 'image_to_video',
  };
  assert.match(graphBridge.getStudioGraphShapeKey(standardForm), /wanPipeline\|wanGenerate\|videoExport/);
  assert.doesNotMatch(graphBridge.getStudioGraphShapeKey(standardForm), /imageEmbeddings|loadLastImage/);
  const bridgeSource = fs.readFileSync(path.join(ROOT, 'src', 'studio', 'graphBridge.ts'), 'utf8');
  const modularVideoObservationSource = bridgeSource.match(
    /function modularVideoGroupObserved[\s\S]*?\n\}\n\nfunction participatingRoles/,
  )?.[0];
  const modularVideoTopologySource = bridgeSource.match(
    /const MODULAR_VIDEO_I2V_EDGE_HANDLES[\s\S]*?\n\}\n\nfunction modularTopologyPending/,
  )?.[0];
  assert.ok(modularVideoObservationSource);
  assert.ok(modularVideoTopologySource);
  assert.doesNotMatch(modularVideoObservationSource, /Wan|modelType|repo|pipelineClass/);
  assert.doesNotMatch(modularVideoTopologySource, /Wan|modelType|repo|pipelineClass/);
});

test('managed graph entry points wait for finalization and Auto only rebuilds when graph shape changes', () => {
  const bridgeSource = fs.readFileSync(path.join(ROOT, 'src', 'studio', 'graphBridge.ts'), 'utf8');
  const runActionsSource = fs.readFileSync(path.join(ROOT, 'src', 'studio', 'useStudioRunActions.ts'), 'utf8');
  const studioPanelSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'StudioPanel.tsx'), 'utf8');
  const issuesDialogSource = fs.readFileSync(path.join(ROOT, 'src', 'components', 'RunIssuesDialog.tsx'), 'utf8');
  const createGraph = bridgeSource.match(
    /export async function createOrUpdateStudioGraph[\s\S]*?\n\}\n\nexport async function waitForStudioGraphFinalization/,
  )?.[0];
  const waitForFinalization = bridgeSource.match(
    /export async function waitForStudioGraphFinalization[\s\S]*?\n\}\n\nexport function getStudioGraphRunBlockingMessage/,
  )?.[0];
  const autoRunPreparation = runActionsSource.match(
    /export async function ensureStudioAutoPlanReadyForRun[\s\S]*?\n\}\n\ntype MissingInstallTarget/,
  )?.[0];

  assert.ok(createGraph);
  assert.ok(waitForFinalization);
  assert.ok(autoRunPreparation);
  assert.equal((createGraph.match(/await waitForStudioGraphFinalization/g) ?? []).length, 1);
  assert.match(waitForFinalization, /status === 'pending'[\s\S]*scheduleStudioGraphFinalization/);
  assert.match(
    autoRunPreparation,
    /autoPlanIsReady\(currentPlan, currentForm\)[\s\S]*return true;[\s\S]*Non-toolbar entry points/,
  );
  assert.match(
    autoRunPreparation,
    /previousShapeKey !== getStudioGraphShapeKey\(nextForm\)[\s\S]*await createOrUpdateStudioGraph\(nextForm, context\)/,
  );
  assert.match(
    studioPanelSource,
    /previousShapeKey !== getStudioGraphShapeKey\(nextForm\)[\s\S]*createOrUpdateStudioGraph\(nextForm, context\)/,
  );
  assert.match(issuesDialogSource, /setWorkflowFocusRequest\(\{[\s\S]*nodeId: null/);
  assert.match(
    issuesDialogSource,
    /item\.action === 'detach_graph'[\s\S]*detachManagedGraph\(\)[\s\S]*Detach invalid receipt/,
    'an invalid persisted proof has an explicit operator recovery action',
  );
});

test('model selector applies only backend class and id filters to opaque installed models', () => {
  const installed = [
    {
      id: 'org/opaque-alpha',
      class_names: ['ClassAlpha'],
      installed: true,
      complete: true,
    },
    {
      id: 'org/opaque-beta',
      class_names: ['ClassBeta'],
      installed: true,
      complete: true,
    },
    {
      id: 'org/opaque-incomplete',
      class_names: ['ClassAlpha'],
      installed: false,
      complete: false,
    },
    {
      id: 'another/installed-model',
      class_names: ['ClassGamma'],
    },
  ];

  assert.deepEqual(
    modelSelection.compatibleInstalledHubModels({
      classNameFilter: ['ClassAlpha'],
      idFilter: '^org/',
      items: installed,
    }),
    ['org/opaque-alpha'],
  );
  assert.deepEqual(
    modelSelection.compatibleInstalledHubModels({
      items: installed,
    }),
    ['another/installed-model', 'org/opaque-alpha', 'org/opaque-beta'],
  );
  assert.deepEqual(
    modelSelection.compatibleInstalledHubModels({
      classNameFilter: '[invalid',
      items: installed,
    }),
    [],
  );
  assert.deepEqual(
    modelSelection.compatibleInstalledHubModels({
      idFilter: '[invalid',
      items: installed,
    }),
    [],
  );
  for (const invalidFilter of [{}, 42, ['ClassAlpha', 42], ['']]) {
    assert.deepEqual(
      modelSelection.compatibleInstalledHubModels({
        classNameFilter: invalidFilter,
        items: installed,
      }),
      [],
    );
  }
  for (const invalidFilter of [{}, 42, ['org/opaque-alpha', 42], ['']]) {
    assert.deepEqual(
      modelSelection.compatibleInstalledHubModels({
        idFilter: invalidFilter,
        items: installed,
      }),
      [],
    );
  }
  assert.deepEqual(
    modelSelection.compatibleInstalledHubModels({
      idFilter: ['org/opaque-beta', 'org/opaque-alpha'],
      items: installed,
    }),
    ['org/opaque-alpha', 'org/opaque-beta'],
  );
  for (const noFilter of [undefined, null, '', '   ', []]) {
    assert.deepEqual(
      modelSelection.compatibleInstalledHubModels({
        classNameFilter: noFilter,
        idFilter: noFilter,
        items: installed,
      }),
      ['another/installed-model', 'org/opaque-alpha', 'org/opaque-beta'],
    );
  }
  assert.deepEqual(
    modelSelection.compatibleInstalledLocalModels({
      idFilter: 'alpha$',
      items: ['local/opaque-beta', 'local/opaque-alpha', 'local/opaque-alpha'],
    }),
    ['local/opaque-alpha'],
  );
  assert.deepEqual(
    modelSelection.compatibleInstalledLocalModels({
      classNameFilter: ['ClassAlpha'],
      idFilter: 'alpha$',
      items: ['local/opaque-beta', 'local/opaque-alpha'],
    }),
    [],
  );
  assert.deepEqual(
    modelSelection.compatibleInstalledLocalModels({
      idFilter: '[invalid',
      items: ['local/opaque-alpha'],
    }),
    [],
  );
  assert.deepEqual(
    modelSelection.compatibleInstalledLocalModels({
      idFilter: ['local/opaque-beta'],
      items: ['local/opaque-alpha', 'local/opaque-beta'],
    }),
    ['local/opaque-beta'],
  );
  for (const invalidFilter of [{}, 42, ['local/opaque-alpha', 42], ['']]) {
    assert.deepEqual(
      modelSelection.compatibleInstalledLocalModels({
        idFilter: invalidFilter,
        items: ['local/opaque-alpha'],
      }),
      [],
    );
  }
  for (const noFilter of [undefined, null, '', '   ', []]) {
    assert.deepEqual(
      modelSelection.compatibleInstalledLocalModels({
        classNameFilter: noFilter,
        items: ['local/opaque-beta', 'local/opaque-alpha'],
      }),
      ['local/opaque-alpha', 'local/opaque-beta'],
    );
  }
  for (const invalidClassFilter of [{}, 42, ['ClassAlpha', 42], ['']]) {
    assert.deepEqual(
      modelSelection.compatibleInstalledLocalModels({
        classNameFilter: invalidClassFilter,
        items: ['local/opaque-alpha'],
      }),
      [],
    );
  }

  for (const absentFilter of [undefined, null, {}, { hub: null, local: null }, { hub: {}, local: {} }]) {
    assert.deepEqual(modelSelection.parseModelSelectionFilters(absentFilter), {
      hub: { valid: true },
      local: { valid: true },
    });
  }
  for (const invalidRoot of [[], 42, 'hub']) {
    const parsed = modelSelection.parseModelSelectionFilters(invalidRoot);
    assert.deepEqual(parsed, { hub: { valid: false }, local: { valid: false } });
    assert.deepEqual(
      modelSelection.compatibleInstalledHubModels({
        ...parsed.hub,
        filterValid: parsed.hub.valid,
        items: installed,
      }),
      [],
    );
    assert.deepEqual(
      modelSelection.compatibleInstalledLocalModels({
        ...parsed.local,
        filterValid: parsed.local.valid,
        items: ['local/opaque-alpha'],
      }),
      [],
    );
  }
  for (const invalidHub of [[], 42, 'hub']) {
    const parsed = modelSelection.parseModelSelectionFilters({ hub: invalidHub });
    assert.deepEqual(parsed, {
      hub: { valid: false },
      local: { valid: true },
    });
    assert.deepEqual(
      modelSelection.compatibleInstalledHubModels({ filterValid: parsed.hub.valid, items: installed }),
      [],
    );
    assert.deepEqual(
      modelSelection.compatibleInstalledLocalModels({
        filterValid: parsed.local.valid,
        items: ['local/opaque-alpha'],
      }),
      ['local/opaque-alpha'],
    );
  }
  for (const invalidLocal of [[], 42, 'local']) {
    const parsed = modelSelection.parseModelSelectionFilters({ local: invalidLocal });
    assert.deepEqual(parsed, {
      hub: { valid: true },
      local: { valid: false },
    });
    assert.deepEqual(modelSelection.compatibleInstalledHubModels({ filterValid: parsed.hub.valid, items: installed }), [
      'another/installed-model',
      'org/opaque-alpha',
      'org/opaque-beta',
    ]);
    assert.deepEqual(
      modelSelection.compatibleInstalledLocalModels({
        filterValid: parsed.local.valid,
        items: ['local/opaque-alpha'],
      }),
      [],
    );
  }
  const parsedFilters = modelSelection.parseModelSelectionFilters({
    hub: { className: ['ClassAlpha'], id: '^org/' },
    local: { id: 'opaque-alpha$' },
  });
  assert.deepEqual(parsedFilters, {
    hub: { className: ['ClassAlpha'], id: '^org/', valid: true },
    local: { id: 'opaque-alpha$', valid: true },
  });
});

test('model selector contains no client-owned model-family inference', () => {
  const selectionSource = fs.readFileSync(path.join(ROOT, 'src', 'studio', 'modelSelection.ts'), 'utf8');
  const fieldSource = fs.readFileSync(path.join(ROOT, 'src', 'fields', 'ModelSelectField.tsx'), 'utf8');
  assert.doesNotMatch(selectionSource, /ModelFamilyHint|modelFamilyHint|connectedModelFamilyHint/);
  assert.doesNotMatch(fieldSource, /getProfileForForm|useStudioStore|connectedModelFamilyHint|modelFamilyHint/);
  assert.match(fieldSource, /parseModelSelectionFilters\(props\.fieldOptions\?\.filter\)/);
  assert.match(fieldSource, /filterValid: hubFilter\.valid/);
  assert.match(fieldSource, /filterValid: localFilter\.valid/);
});

test('model selector subscribes to discovered indexes and preserves the selected value during refresh', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'fields', 'ModelSelectField.tsx'), 'utf8');
  assert.doesNotMatch(source, /useNodesStore\.getState\(\)/);
  assert.match(source, /hfCache: state\.hfCache/);
  assert.match(source, /localModels: state\.localModels/);
  const refreshBody = source.match(/const handleRefresh = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.doesNotMatch(refreshBody, /updateStore\([^,]+,\s*\{[^}]*value/);
});

test('generic model nodes preserve backend-owned repository defaults without client rewriting', () => {
  const registryNode = node('registry-loader').data;
  registryNode.module = 'modules.ModularDiffusers';
  registryNode.action = 'AutoModelLoader';
  registryNode.params = {
    component_type: { value: 'ClassFuture' },
    model_id: {
      value: { source: 'hub', value: 'future/default-repository' },
      default: { source: 'hub', value: 'future/default-repository' },
    },
  };
  const created = nodeFactory.createNodeFromRegistry(
    'modules.ModularDiffusers.AutoModelLoader',
    { 'modules.ModularDiffusers.AutoModelLoader': registryNode },
    { x: 0, y: 0 },
  );
  assert.deepEqual(created.data.params.model_id.value, { source: 'hub', value: 'future/default-repository' });
  assert.deepEqual(created.data.params.model_id.default, { source: 'hub', value: 'future/default-repository' });

  const restored = {
    ...created,
    id: 'restored-loader',
    data: {
      ...created.data,
      params: JSON.parse(JSON.stringify(created.data.params)),
    },
  };
  flowStoreModule.useFlowStore.getState().replaceGraph({ nodes: [restored], edges: [] });
  const preserved = flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === restored.id);
  assert.deepEqual(preserved.data.params.model_id.value, { source: 'hub', value: 'future/default-repository' });
  assert.deepEqual(preserved.data.params.model_id.default, { source: 'hub', value: 'future/default-repository' });

  const websocketSource = fs.readFileSync(path.join(ROOT, 'src', 'stores', 'websocketMessageHandler.ts'), 'utf8');
  assert.doesNotMatch(websocketSource, /AutoModelLoader|normalizeGenericModelLoaderParams/);
});

test('managed Qwen ControlNet sync pins AutoModelLoader to the controlnet component kind', () => {
  const controlLoader = managedNode('control-loader', 'controlnetModel', {
    params: {
      model_type: {
        label: 'Model Type',
        value: 'QwenImageModularPipeline',
      },
      model_id: {
        label: 'Model ID',
        display: 'modelselect',
        value: { source: 'hub', value: 'InstantX/Qwen-Image-ControlNet-Union' },
      },
      dtype: { value: 'bfloat16' },
      trust_remote_code: { value: false },
      device: { value: 'cuda:0' },
      auto_offload: { value: true },
      offload_mode: { value: 'model_cpu' },
      model: {
        display: 'output',
        type: 'diffusers_auto_model',
        signal: {
          direction: 'output',
          origin: 'model_type',
          value: 'QwenImageModularPipeline',
        },
      },
    },
  });
  controlLoader.data.module = 'modules.ModularDiffusers';
  controlLoader.data.action = 'AutoModelLoader';
  flowStoreModule.useFlowStore.setState({ nodes: [controlLoader], edges: [] });
  const binding = {
    mode: 'control_image',
    modelType: 'QwenImageModularPipeline',
    nodes: { controlnetModel: controlLoader.id },
    managedNodeIds: [controlLoader.id],
    managedEdgeIds: [],
    fingerprint: 'qwen-control-loader-contract',
    createdAt: 1,
    updatedAt: 1,
  };
  const currentForm = studioStoreModule.useStudioStore.getState().form;
  studioStoreModule.useStudioStore.setState({ graphBinding: binding });

  assert.equal(
    graphBridge.syncStudioGraphValues({
      ...currentForm,
      mode: 'control_image',
      modelType: 'QwenImageModularPipeline',
      dtype: 'bfloat16',
      device: 'cuda:0',
      autoOffload: true,
      offloadMode: 'model_cpu',
    }),
    true,
  );

  const params = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  assert.equal(params.model_type.value, 'controlnet');
  assert.deepEqual(params.model_id.value, {
    source: 'hub',
    value: 'InstantX/Qwen-Image-ControlNet-Union',
  });
  assert.equal(params.model.signal.direction, 'output');
  assert.equal(params.model.signal.value, 'controlnet');
});

test('managed graph reconciliation preserves pinned Auto sample-rate overrides', () => {
  const audioGenerate = managedNode('audio-generate', 'audioGenerate', {
    params: {
      sample_rate: { label: 'Sample Rate', type: 'int', value: 44100 },
    },
  });
  const audioExport = managedNode('audio-export', 'audioExport', {
    params: {
      sample_rate: { label: 'Export Sample Rate', type: 'int', value: 44100 },
    },
  });
  flowStoreModule.useFlowStore.setState({ nodes: [audioGenerate, audioExport], edges: [] });

  const currentForm = studioStoreModule.useStudioStore.getState().form;
  const form = {
    ...currentForm,
    mode: 'audio_continuation',
    modelType: 'AceStepAudioPipeline',
    resourceMode: 'auto',
  };
  const binding = {
    mode: form.mode,
    modelType: form.modelType,
    nodes: {
      audioGenerate: audioGenerate.id,
      audioExport: audioExport.id,
    },
    managedNodeIds: [audioGenerate.id, audioExport.id],
    managedEdgeIds: [],
    fingerprint: 'audio-sample-rate-override-contract',
    createdAt: 1,
    updatedAt: 1,
  };
  const override = (nodeId) => ({
    schemaVersion: 1,
    nodeId,
    fieldKey: 'sample_rate',
    value: 44100,
    updatedAt: 1,
  });
  studioStoreModule.useStudioStore.setState({
    form,
    graphBinding: binding,
    autoFieldOverrides: {
      [studioStoreModule.autoFieldOverrideKey(audioGenerate.id, 'sample_rate')]: override(audioGenerate.id),
      [studioStoreModule.autoFieldOverrideKey(audioExport.id, 'sample_rate')]: override(audioExport.id),
    },
  });

  assert.equal(graphBridge.syncStudioGraphValues(form), true);
  const [generateAfterSync, exportAfterSync] = flowStoreModule.useFlowStore
    .getState()
    .nodes.map((item) => item.data.params.sample_rate.value);
  assert.equal(generateAfterSync, 44100);
  assert.equal(exportAfterSync, 44100);

  studioStoreModule.useStudioStore.setState({ autoFieldOverrides: {} });
  assert.equal(graphBridge.syncStudioGraphValues(form), true);
  const [generateAfterReset, exportAfterReset] = flowStoreModule.useFlowStore
    .getState()
    .nodes.map((item) => item.data.params.sample_rate.value);
  assert.equal(generateAfterReset, 48000);
  assert.equal(exportAfterReset, 48000);
});

test('managed ACE-Step nodes hide controls that the active pipeline does not consume', () => {
  const audioGenerate = managedNode('audio-generate-visibility', 'audioGenerate', {
    params: Object.fromEntries(
      [
        'task_type',
        'prompt',
        'negative_prompt',
        'lyrics',
        'audio_duration',
        'extension_duration',
        'vocal_language',
        'num_inference_steps',
        'guidance_scale',
        'lora_scale',
        'shift',
        'seed',
        'bpm',
        'keyscale',
        'timesignature',
        'repainting_start',
        'repainting_end',
        'audio_cover_strength',
        'return_continuation_tail',
        'sample_rate',
        'stable_audio_steps',
        'stable_audio_guidance',
        'num_waveforms',
      ].map((key) => [key, { label: key, value: null, hidden: false }]),
    ),
  });
  flowStoreModule.useFlowStore.setState({ nodes: [audioGenerate], edges: [] });

  const currentForm = studioStoreModule.useStudioStore.getState().form;
  const form = {
    ...currentForm,
    mode: 'text_to_audio',
    modelType: 'AceStepAudioPipeline',
    resourceMode: 'expert',
  };
  studioStoreModule.useStudioStore.setState({
    form,
    autoFieldOverrides: {},
    autoResourcePlan: null,
    graphBinding: {
      mode: form.mode,
      modelType: form.modelType,
      nodes: { audioGenerate: audioGenerate.id },
      managedNodeIds: [audioGenerate.id],
      managedEdgeIds: [],
      fingerprint: 'audio-field-visibility-contract',
      createdAt: 1,
      updatedAt: 1,
    },
  });

  assert.equal(graphBridge.syncStudioGraphValues(form), true);
  const params = flowStoreModule.useFlowStore.getState().nodes[0].data.params;
  assert.equal(params.lora_scale.hidden, true);
  assert.equal(params.stable_audio_steps.hidden, true);
  assert.equal(params.stable_audio_guidance.hidden, true);
  assert.equal(params.num_waveforms.hidden, true);
  assert.equal(params.negative_prompt.hidden, true);
  assert.equal(params.extension_duration.hidden, true);
  assert.equal(params.repainting_start.hidden, true);
  assert.equal(params.audio_cover_strength.hidden, true);
  assert.equal(params.prompt.hidden, false);
  assert.equal(params.lyrics.hidden, false);
  assert.equal(params.num_inference_steps.hidden, false);
  assert.equal(params.guidance_scale.hidden, false);
});

test('Arrange graph is one undoable history action', async () => {
  const nodes = [
    node('a', 10, 20, {
      params: {
        output: { display: 'output', type: ['image', 'video'], value: 'immutable-output' },
      },
    }),
    node('b', 10, 20, {
      params: {
        input: { display: 'input', type: 'video', value: 'immutable-input' },
      },
    }),
  ];
  const edges = [
    {
      ...edge('ab', 'a', 'b'),
      data: { connectionType: 'video', immutableMetadata: 'preserve-me' },
      markerEnd: { color: '#06B6D4', type: 'arrowclosed' },
      style: { stroke: '#06B6D4', strokeWidth: 2 },
    },
  ];
  flowStoreModule.useFlowStore.setState({ nodes, edges });
  const beforeContent = structuredClone(graphContentSnapshot(flowStoreModule.useFlowStore.getState()));

  await flowStoreModule.useFlowStore.getState().arrangeGraph();
  let state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.historyPast.length, 1);
  assert.equal(state.layoutRevision, 1);
  assert.deepEqual(graphContentSnapshot(state), beforeContent);
  assert.notDeepEqual(
    state.nodes.map((item) => item.position),
    nodes.map((item) => item.position),
  );

  state.undo();
  state = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(
    state.nodes.map((item) => item.position),
    nodes.map((item) => item.position),
  );
  assert.deepEqual(graphContentSnapshot(state), beforeContent);
});

test('restoring a saved graph preserves its supplied positions until Arrange graph is requested', async () => {
  const nodes = [node('a', -940, 315), node('b', 875, -210)];
  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes,
    edges: [edge('ab', 'a', 'b')],
    viewport: { x: 73, y: -41, zoom: 0.72 },
  });

  let state = flowStoreModule.useFlowStore.getState();
  assert.deepEqual(
    state.nodes.map((item) => item.position),
    nodes.map((item) => item.position),
  );
  assert.deepEqual(state.viewport, { x: 73, y: -41, zoom: 0.72 });
  assert.equal(state.layoutRevision, 0);

  await state.arrangeGraph();
  state = flowStoreModule.useFlowStore.getState();
  assert.equal(state.layoutRevision, 1);
  assert.notDeepEqual(
    state.nodes.map((item) => item.position),
    nodes.map((item) => item.position),
  );
});

test('template creation arranges exactly once after finalization and measurement while its canvas is suspended', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'studio', 'templateWorkflow.ts'), 'utf8');
  const arrangeCalls = source.match(/\.arrangeGraph\(\{ history: false \}\)/g) ?? [];
  const finalizationIndex = source.indexOf('await waitForStudioGraphFinalization');
  const timeoutFailureIndex = source.indexOf('No incomplete graph was kept');
  const measurementIndex = source.indexOf('await waitForGraphNodeMeasurements');
  const arrangeIndex = source.indexOf('.arrangeGraph({ history: false })');
  const revealIndex = source.indexOf('setCanvasTransition(null)');

  assert.equal(arrangeCalls.length, 1);
  assert.ok(finalizationIndex >= 0 && finalizationIndex < measurementIndex);
  assert.ok(timeoutFailureIndex >= 0 && timeoutFailureIndex < measurementIndex);
  assert.ok(measurementIndex < arrangeIndex);
  assert.ok(arrangeIndex < revealIndex);
});

test('canonical workflow generation persists the final layout and library open does not rearrange it', () => {
  const generator = fs.readFileSync(path.join(ROOT, 'scripts', 'workflow-library-generator.mjs'), 'utf8');
  const graphList = fs.readFileSync(path.join(ROOT, 'src', 'components', 'GraphList.tsx'), 'utf8');
  const verifier = fs.readFileSync(path.join(ROOT, 'scripts', 'workflow-library-verify.mjs'), 'utf8');

  const ephemeralStorageIndex = generator.indexOf('await installEphemeralWorkflowStorage(page)');
  const navigationIndex = generator.indexOf("await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' })");
  const prepareIndex = generator.indexOf('prepareWorkflowGraphForExport');
  const preCanonicalArrangeIndex = generator.indexOf('const arrangedBeforeCanonicalIds = await arrangeSnapshot(graph)');
  const canonicalizeIndex = generator.indexOf('canonicalizeGraphIds(arrangedBeforeCanonicalIds)');
  const metadataIndex = generator.indexOf('addLayoutMetadata(repeated)');
  assert.match(generator, /new Set\(\['modiff\.studio', 'modiff\.flow'\]\)/);
  assert.match(generator, /this === localStorage && generatedGraphKeys\.has\(String\(key\)\)/);
  assert.ok(ephemeralStorageIndex >= 0 && ephemeralStorageIndex < navigationIndex);
  assert.ok(prepareIndex >= 0);
  assert.ok(preCanonicalArrangeIndex >= 0 && canonicalizeIndex > preCanonicalArrangeIndex);
  assert.ok(metadataIndex > canonicalizeIndex);
  assert.doesNotMatch(graphList, /isCanonicalGraphPath|arrangeGraph\(\{ history: false \}\)/);
  assert.match(verifier, /ssrLoadModule\('\/src\/workflow\/graphLayout\.ts'\)/);
  assert.match(verifier, /does not equal a deterministic re-layout/);
  assert.match(verifier, /LAYOUT_HORIZONTAL_GAP = 140/);
  assert.match(verifier, /LAYOUT_VERTICAL_GAP = 72/);
});
