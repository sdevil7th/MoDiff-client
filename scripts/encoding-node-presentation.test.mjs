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
    doc: { type: 'string', display: 'output', isConnected: false },
    connected_doc: { type: 'string', display: 'output', isConnected: true },
    custom: { type: 'string', display: 'output' },
  };
  const ports = [
    { portId: 'doc', binding: { fieldOrPortId: 'doc' } },
    { portId: 'connected_doc', binding: { fieldOrPortId: 'doc' } },
    { portId: 'custom', binding: { fieldOrPortId: 'custom' } },
  ];
  const before = structuredClone(params);
  assert.deepEqual(Object.keys(presentation.encodingVisibleConnectors(params, ports)), [
    'doc',
    'connected_doc',
    'custom',
  ]);
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
    definitionSnapshot: { source: { provider: 'modiff.visual-stages.v1/guidance' } },
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
