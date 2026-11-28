import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, presentation;
test('Encode Inputs has a dedicated node renderer, not a conditional Block skin', () => {
  const renderer = readFileSync('src/components/EncodingNode.tsx', 'utf8');
  assert.match(renderer, /<CustomNode\s/);
  assert.doesNotMatch(renderer, /BlockNodeFrame|BlockNodeV2|toggleUserBlockExpanded/);
  assert.match(readFileSync('src/components/Workflow.tsx', 'utf8'), /encoding: EncodingNode/);
});
before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  presentation = await server.ssrLoadModule('/src/workflow/encodingNodePresentation.ts');
});
after(async () => server?.close());

test('documentation sockets are presentation-only and connected/custom sockets survive', () => {
  const params = {
    doc: { type: 'string', label: 'Doc' },
    wiredDoc: { type: 'string', label: 'My documentation', isConnected: true },
    route: { type: 'string' },
    optionalDoc: { type: 'str', label: 'Doc', fieldOptions: { encodingImplementationOutput: 'doc' } },
    requiredRoute: { type: 'route' },
    layers: { type: 'layers' },
    guidanceLayers: { type: 'layers' },
    custom: { type: 'string' },
  };
  const outputs = [
    ['doc', 'doc', 'text'],
    ['wiredDoc', 'doc', 'guidance'],
    ['route', 'route_state_out', 'text'],
    ['layers', 'layers', 'text'],
    ['guidanceLayers', 'layers', 'guidance'],
    ['custom', 'custom', 'text'],
  ].map(([portId, fieldOrPortId, nodeId]) => ({ portId, binding: { fieldOrPortId, nodeId } }));
  const instance = {
    effectiveGraph: {
      nodes: [
        { nodeId: 'text', data: { label: 'Text Encoder' } },
        { nodeId: 'guidance', data: { operationAuthoring: { operation: { nodeType: 'guidance_layers' } } } },
      ],
    },
    effectiveInterface: {
      boundary: {
        outputs,
        inputs: [
          { portId: 'requiredRoute', binding: { fieldOrPortId: 'route_state_in', nodeId: 'text' }, required: true },
        ],
      },
    },
  };
  const before = structuredClone(params);
  const visible = presentation.encodingVisibleConnectors(params, instance);
  assert.deepEqual(Object.keys(visible), ['wiredDoc', 'requiredRoute', 'layers', 'custom']);
  assert.equal(visible.wiredDoc.label, 'My documentation');
  const advanced = presentation.encodingVisibleConnectors(params, instance, true);
  assert.deepEqual(Object.keys(advanced), Object.keys(params));
  assert.equal(advanced.optionalDoc.label, 'Documentation · Image encoder');
  assert.equal(advanced.doc.label, 'Documentation · Text Encoder');
  assert.deepEqual(params, before);
});

test('connected prompt retains local value, disabling only its fallback field', () => {
  const control = { binding: { fieldId: 'prompt', nodeId: 'text' } };
  const local = { value: 'keep this prompt', disabled: false };
  const rendered = presentation.encodingControlParam(control, local, true);
  assert.equal(rendered.value, local.value);
  assert.equal(rendered.disabled, true);
  assert.equal(local.disabled, false);
  assert.equal(presentation.encodingControlParam({ binding: { fieldId: 'seed' } }, local, true), local);
  assert.equal(presentation.encodingControlParam(control, local, false), local);
});

test('custom implementation additions do not turn the generic encoder back into a generic Block', () => {
  const instance = {
    definitionSnapshot: { source: { provider: 'modiff.visual-stages.v1/inputs' } },
    effectiveGraph: {
      nodes: [
        { data: { operationAuthoring: { operation: { nodeType: 'text_encoder', task: 'text_to_image' } } } },
        { data: { label: 'User coded transform' } },
      ],
    },
  };
  assert.equal(presentation.isFocusedImageEncoding(instance), true);
  assert.equal(presentation.isFocusedImageEncoding(undefined), false);
  assert.equal(presentation.isFocusedImageEncoding({ ...instance, effectiveGraph: { nodes: [] } }), false);
});

test('Guidance presentation excludes unrelated recipes and scopes to image/audio', () => {
  const instance = {
    definitionSnapshot: { source: { kind: 'user', provider: 'modiff.visual-stages.v1/guidance' } },
    effectiveGraph: {
      nodes: [
        { data: { operationAuthoring: { operation: { nodeType: 'guidance', task: 'text_to_image' } } } },
        { data: { operationAuthoring: { operation: { nodeType: 'guidance_layers', task: 'text_to_image' } } } },
      ],
    },
  };
  assert.equal(presentation.isFocusedStageNode(instance), true);
  assert.equal(presentation.isFocusedImageEncoding(instance), false);
  const unrelated = structuredClone(instance);
  unrelated.definitionSnapshot.source.provider = 'user-custom';
  assert.equal(presentation.isFocusedStageNode(unrelated), false);
  const outside = structuredClone(instance);
  outside.effectiveGraph.nodes.forEach((n) => (n.data.operationAuthoring.operation.task = 'other_task'));
  assert.equal(presentation.isFocusedStageNode(outside), false);
});

test('built-in stages use one ordinary node across modalities, including video encoding and generation', () => {
  for (const kind of [
    'assemble',
    'assembleExport',
    'setup',
    'inputs',
    'generate',
    'imageInput',
    'videoInput',
    'references',
    'mask',
    'composite',
    'output',
  ]) {
    const instance = {
      definitionSnapshot: {
        displayName: 'My stage',
        source: { kind: 'user', provider: `modiff.visual-stages.v1/${kind}` },
      },
      effectiveGraph: {
        nodes: [{ data: { operationAuthoring: { operation: { nodeType: 'text_encoder', task: 'image_to_video' } } } }],
      },
    };
    assert.equal(presentation.isFocusedStageNode(instance), true);
    assert.equal(presentation.isFocusedStageNode({ ...instance, effectiveGraph: { nodes: [] } }), false);
  }
  assert.equal(
    presentation.isFocusedStageNode({
      definitionSnapshot: { source: { provider: 'user' } },
      effectiveGraph: { nodes: [{ data: {} }] },
    }),
    false,
  );
});

test('a saved stage with an authored nested composition can still expand as a Block', () => {
  const instance = {
    definitionSnapshot: { source: { kind: 'user', provider: 'modiff.visual-stages.v1/generate' } },
    effectiveGraph: {
      nodes: [
        { nodeId: 'sampler', data: {} },
        { nodeId: 'custom-wrapper', containerInterface: {}, data: {} },
        { nodeId: 'custom-transform', parentNodeId: 'custom-wrapper', data: {} },
      ],
    },
    presentation: { expanded: true },
  };
  assert.equal(presentation.isFocusedStageNode(instance), false);
  assert.equal(
    presentation.isFocusedStageNode({
      ...instance,
      effectiveGraph: { nodes: instance.effectiveGraph.nodes.slice(0, 1) },
    }),
    true,
  );
});

test('GPU options use the physical runtime identity without changing the PyTorch key', async () => {
  const { workflowDeviceLabel } = await server.ssrLoadModule('/src/studio/runtimeOptions.ts');
  const torch = {
    cuda_devices: [
      { index: 0, name: 'Radeon 8060S', backend: 'hip' },
      { index: 1, name: 'NVIDIA A100', backend: 'cuda' },
    ],
  };
  assert.equal(workflowDeviceLabel('cuda:0', 'cuda:0', torch), 'Radeon 8060S · ROCm (cuda:0)');
  assert.equal(workflowDeviceLabel('cuda:1', 'cuda:1', torch), 'NVIDIA A100 · CUDA (cuda:1)');
  assert.equal(workflowDeviceLabel('cuda:2', 'cuda:2', torch), 'cuda:2');
  assert.equal(workflowDeviceLabel('cpu', 'cpu', undefined), 'CPU');
});
