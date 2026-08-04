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
let studioStoreModule;
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
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
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
});

test('model selector offers installed models only when their class and connected family are compatible', () => {
  const installed = [
    {
      id: 'InstantX/Qwen-Image-ControlNet-Union',
      class_names: ['QwenImageControlNetModel'],
      installed: true,
      complete: true,
    },
    {
      id: 'diffusers/controlnet-depth-sdxl-1.0',
      class_names: ['ControlNetModel'],
      installed: true,
      complete: true,
    },
    {
      id: 'InstantX/Qwen-Image-ControlNet-Incomplete',
      class_names: ['QwenImageControlNetModel'],
      installed: false,
      complete: false,
    },
    {
      id: 'unrelated/not-a-control-model',
      class_names: ['AutoencoderKL'],
    },
  ];
  const classNameFilter = ['ControlNetModel', 'QwenImageControlNetModel', 'FluxControlNetModel'];

  assert.deepEqual(
    modelSelection.compatibleInstalledHubModels({
      classNameFilter,
      family: 'qwen',
      items: installed,
    }),
    ['InstantX/Qwen-Image-ControlNet-Union'],
  );
  assert.deepEqual(
    modelSelection.compatibleInstalledHubModels({
      classNameFilter,
      family: 'sdxl',
      items: installed,
    }),
    ['diffusers/controlnet-depth-sdxl-1.0'],
  );
});

test('model selector infers one family from connected pipeline loaders and ignores unrelated graph branches', () => {
  const componentLoader = node('component-loader');
  componentLoader.data.module = 'modules.ModularDiffusers';
  componentLoader.data.action = 'AutoModelLoader';
  componentLoader.data.params = {
    model_type: { value: 'controlnet' },
    model_id: { value: { source: 'hub', value: '' } },
  };
  const pipelineLoader = node('pipeline-loader');
  pipelineLoader.data.module = 'modules.ModularDiffusers';
  pipelineLoader.data.action = 'ModelsLoader';
  pipelineLoader.data.params = {
    repo_id: { value: { source: 'hub', value: 'Qwen/Qwen-Image-2512' } },
  };
  const unrelatedLoader = node('unrelated-loader');
  unrelatedLoader.data.module = 'modules.DiffusersImage';
  unrelatedLoader.data.action = 'LoadPipeline';
  unrelatedLoader.data.params = {
    model_id: { value: { source: 'hub', value: 'black-forest-labs/FLUX.1-dev' } },
  };

  assert.equal(
    modelSelection.connectedModelFamilyHint(
      [componentLoader, pipelineLoader, unrelatedLoader],
      [edge('component-pipeline', 'component-loader', 'pipeline-loader')],
      componentLoader.id,
    ),
    'qwen',
  );
});

test('model selector subscribes to discovered indexes and preserves the selected value during refresh', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'fields', 'ModelSelectField.tsx'), 'utf8');
  assert.doesNotMatch(source, /useNodesStore\.getState\(\)/);
  assert.match(source, /hfCache: state\.hfCache/);
  assert.match(source, /localModels: state\.localModels/);
  const refreshBody = source.match(/const handleRefresh = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.doesNotMatch(refreshBody, /updateStore\([^,]+,\s*\{[^}]*value/);
});

test('generic model loaders remove legacy implicit repositories without overwriting an explicit selection', () => {
  const implicitParams = {
    model_type: { value: 'controlnet' },
    model_id: {
      value: { source: 'hub', value: 'diffusers/controlnet-depth-sdxl-1.0' },
      default: { source: 'hub', value: 'diffusers/controlnet-depth-sdxl-1.0' },
    },
  };
  const migrated = modelSelection.normalizeGenericModelLoaderParams(
    'modules.ModularDiffusers',
    'AutoModelLoader',
    implicitParams,
  );
  assert.deepEqual(migrated.model_id.value, { source: 'hub', value: '' });
  assert.deepEqual(migrated.model_id.default, { source: 'hub', value: '' });

  const explicitParams = {
    ...implicitParams,
    model_id: {
      ...implicitParams.model_id,
      value: { source: 'hub', value: 'InstantX/Qwen-Image-ControlNet-Union' },
    },
  };
  const explicit = modelSelection.normalizeGenericModelLoaderParams(
    'modules.ModularDiffusers',
    'AutoModelLoader',
    explicitParams,
  );
  assert.deepEqual(explicit.model_id.value, {
    source: 'hub',
    value: 'InstantX/Qwen-Image-ControlNet-Union',
  });
  assert.deepEqual(explicit.model_id.default, { source: 'hub', value: '' });
});

test('adding an unrelated node cannot restore a legacy generic model default', () => {
  const loader = node('legacy-loader');
  loader.data.module = 'modules.ModularDiffusers';
  loader.data.action = 'AutoModelLoader';
  loader.data.params = {
    model_type: { value: 'controlnet' },
    model_id: {
      value: { source: 'hub', value: 'diffusers/controlnet-depth-sdxl-1.0' },
      default: { source: 'hub', value: 'diffusers/controlnet-depth-sdxl-1.0' },
    },
  };
  flowStoreModule.useFlowStore.setState({ nodes: [loader], edges: [] });
  flowStoreModule.useFlowStore.getState().addNode(node('unrelated'));

  const migrated = flowStoreModule.useFlowStore.getState().nodes.find((item) => item.id === loader.id);
  assert.deepEqual(migrated.data.params.model_id.value, { source: 'hub', value: '' });
  assert.deepEqual(migrated.data.params.model_id.default, { source: 'hub', value: '' });
});

test('new generic model nodes cannot inherit a non-empty backend example default', () => {
  const registryNode = node('registry-loader').data;
  registryNode.module = 'modules.ModularDiffusers';
  registryNode.action = 'AutoModelLoader';
  registryNode.params = {
    model_type: { value: 'controlnet' },
    model_id: {
      value: { source: 'hub', value: 'diffusers/controlnet-depth-sdxl-1.0' },
      default: { source: 'hub', value: 'diffusers/controlnet-depth-sdxl-1.0' },
    },
  };
  const created = nodeFactory.createNodeFromRegistry(
    'modules.ModularDiffusers.AutoModelLoader',
    { 'modules.ModularDiffusers.AutoModelLoader': registryNode },
    { x: 0, y: 0 },
  );
  assert.deepEqual(created.data.params.model_id.value, { source: 'hub', value: '' });
  assert.deepEqual(created.data.params.model_id.default, { source: 'hub', value: '' });

  const websocketSource = fs.readFileSync(path.join(ROOT, 'src', 'stores', 'websocketMessageHandler.ts'), 'utf8');
  assert.match(
    websocketSource,
    /normalizeGenericModelLoaderParams\(node\.data\.module,\s*node\.data\.action,\s*newParams\)/,
  );
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
