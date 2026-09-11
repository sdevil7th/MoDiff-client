import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let inspect;
let projectionId;
before(async () => {
  server = await createServer({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  ({ inspectBlockMediaInputsV2: inspect } = await server.ssrLoadModule('/src/studio/blockMediaReadinessV2.ts'));
  ({ blockProjectionNodeIdV2: projectionId } = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts'));
});
after(async () => {
  await server?.close();
});

function fixture(value, overrides = {}) {
  const port = {
    portId: 'mask_image',
    label: 'Mask image',
    valueType: 'image',
    required: true,
    binding: { nodeId: 'loadMask', fieldOrPortId: 'file' },
    ...overrides,
  };
  const instance = {
    instanceId: 'root',
    effectiveInterface: { boundary: { inputs: [port] } },
    effectiveGraph: { nodes: [] },
  };
  const root = { id: 'root', data: { blockInstanceV2: instance }, hidden: false };
  const leaf = {
    id: projectionId('root', 'loadMask'),
    data: {
      module: 'modules.Image',
      action: 'Load',
      params: { file: { display: 'filebrowser', type: 'str', fieldOptions: { fileTypes: ['image'] }, value } },
    },
  };
  return { roots: [root], graph: { nodes: [leaf], edges: [] }, root, leaf, port, instance };
}

test('required empty file boundary is actionable before execution; inspection does not mutate the draft', () => {
  const f = fixture('');
  const before = structuredClone(f);
  const issues = inspect(f.roots, f.graph);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'block_media_input_missing');
  assert.equal(issues[0].nodeId, 'root');
  assert.equal(issues[0].fieldId, 'mask_image');
  assert.equal(issues[0].blocking, true);
  assert.match(issues[0].message, /Mask image/);
  assert.match(issues[0].details, /loadMask.file/);
  assert.deepEqual(f, before);
});

test('media inspection respects the selected execution closure, not unrelated visible drafts', () => {
  const f = fixture('');
  const before = structuredClone(f);
  assert.equal(inspect(f.roots, { nodes: [], edges: [] }).length, 0);
  // When the same leaf is an upstream dependency, it remains required.
  assert.equal(inspect(f.roots, f.graph).length, 1);
  assert.deepEqual(f, before);
});

test('blank strings, undefined, null and empty picker arrays are missing, not an upstream tensor diagnosis', () => {
  for (const value of [undefined, null, '', '  ', [], ['', null, ' ']]) {
    const f = fixture(value);
    assert.equal(inspect(f.roots, f.graph).length, 1, JSON.stringify(value));
  }
  for (const value of ['@data/images/mask.png', ['@data/images/mask.png'], { futureValue: true }]) {
    const f = fixture(value);
    assert.equal(inspect(f.roots, f.graph).length, 0);
  }
});

test('connected inputs, optional inputs and disabled roots or leaves are not falsely blocked', () => {
  for (const mode of ['connection', 'optional', 'root-disabled', 'leaf-disabled']) {
    const f = fixture('');
    if (mode === 'connection') {
      f.graph.nodes.push({ id: 'producer', data: {} });
      f.graph.edges.push({ source: 'producer', target: f.leaf.id, targetHandle: 'file' });
    }
    if (mode === 'optional') f.port.required = false;
    if (mode === 'root-disabled') f.root.data.uiState = { disabled: true };
    if (mode === 'leaf-disabled') f.leaf.data.uiState = { disabled: true };
    assert.equal(inspect(f.roots, f.graph).length, 0, mode);
  }
});

test('a disabled producer cannot satisfy a required file boundary', () => {
  const f = fixture('');
  f.graph.nodes.push({ id: 'producer', data: { uiState: { disabled: true } } });
  f.graph.edges.push({ source: 'producer', target: f.leaf.id, targetHandle: 'file' });
  assert.equal(inspect(f.roots, f.graph).length, 1);
});

test('resolved leaf default values count; non-file fields and conditional tensor/state ports are left alone', () => {
  const f = fixture(undefined);
  f.leaf.data.params.file.default = '@data/images/default-mask.png';
  assert.equal(inspect(f.roots, f.graph).length, 0);
  delete f.leaf.data.params.file.default;
  f.leaf.data.params.file.display = 'input';
  assert.equal(inspect(f.roots, f.graph).length, 0);
});

test('same contract supports audio and video without model-specific branches', () => {
  for (const media of ['audio', 'video']) {
    const f = fixture('', { valueType: media });
    f.leaf.data.params.file.fieldOptions.fileTypes = [media];
    assert.equal(inspect(f.roots, f.graph).length, 1, media);
  }
});

test('nested boundaries deduplicate the same leaf and target its visible node when expanded', () => {
  const f = fixture('');
  f.instance.effectiveGraph.nodes.push({ nodeId: 'nested', containerInterface: { boundary: { inputs: [f.port] } } });
  const visible = { ...f.leaf, data: { ...f.leaf.data, blockProjectionOwnerId: 'root' } };
  f.roots.push(visible);
  const issues = inspect(f.roots, f.graph);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].nodeId, f.leaf.id);
  assert.equal(issues[0].fieldId, 'file');
});

test('an unexposed nested required file is diagnosed, and only the missing mirrored binding is reported', () => {
  const f = fixture('');
  f.instance.effectiveInterface.boundary.inputs = [];
  f.instance.effectiveGraph.nodes.push({ nodeId: 'nested', containerInterface: { boundary: { inputs: [f.port] } } });
  assert.equal(inspect(f.roots, f.graph).length, 1);
  assert.equal(inspect(f.roots, f.graph)[0].fieldId, undefined, 'do not highlight an unexposed root socket');
  f.roots.push({ id: projectionId('root', 'nested'), data: { blockProjectionOwnerId: 'root' } });
  assert.equal(inspect(f.roots, f.graph)[0].nodeId, projectionId('root', 'nested'));
  assert.equal(inspect(f.roots, f.graph)[0].fieldId, 'mask_image');
  f.instance.effectiveInterface.boundary.inputs = [
    { ...f.port, binding: { nodeId: 'supplied', fieldOrPortId: 'file' }, mirrorBindings: [f.port.binding] },
  ];
  f.instance.effectiveGraph.nodes = [];
  assert.equal(inspect(f.roots, f.graph).length, 1);
});
