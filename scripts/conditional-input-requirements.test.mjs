import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

let server, fixer, readiness;
before(async () => {
  server = await createServer({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  fixer = await server.ssrLoadModule('/src/studio/graphFixer.ts');
  readiness = await server.ssrLoadModule('/src/studio/requiredGraphInputs.ts');
});
after(async () => {
  await server?.close();
});

function fixture(kind = 'image') {
  const metadata = JSON.parse(
    readFileSync(new URL('./fixtures/reference-input-requirements.json', import.meta.url), 'utf8'),
  );
  const params = {
    references_in: { display: 'input', type: 'ordered_media', required: false },
    reference_kind: { type: 'string', default: 'image', options: ['image', 'video', 'audio'] },
    references: { display: 'output', type: 'ordered_media' },
  };
  for (const type of ['image', 'video', 'audio'])
    params[type] = {
      display: 'input',
      type,
      ...metadata[type],
    };
  const definition = {
    type: 'custom',
    module: 'modules.Test',
    action: 'Assemble',
    label: 'Ordered reference',
    skipParamsCheck: true,
    params,
  };
  const helper = { id: 'ref', type: 'custom', position: { x: 0, y: 0 }, data: structuredClone(definition) };
  // The user's saved helper predates the registry correction. Inspection must
  // use live requiredness without migrating the saved body or trusting this flag.
  helper.data.skipParamsCheck = false;
  for (const param of Object.values(helper.data.params)) {
    delete param.required;
    delete param.requiredWhen;
  }
  helper.data.params.reference_kind.value = kind;
  const sink = {
    id: 'out',
    type: 'custom',
    position: { x: 400, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Preview',
      label: 'Preview',
      params: { references: { display: 'input', type: 'ordered_media' } },
    },
  };
  const registry = { 'modules.Test.Assemble': definition };
  for (const type of ['image', 'video', 'audio'])
    registry[`modules.Test.Load${type}`] = {
      type: 'custom',
      module: 'modules.Test',
      action: `Load${type}`,
      label: `Load ${type}`,
      params: { value: { display: 'output', type } },
    };
  return {
    nodes: [helper, sink],
    edges: [{ id: 'result', source: 'ref', sourceHandle: 'references', target: 'out', targetHandle: 'references' }],
    registry,
  };
}

for (const kind of ['image', 'video', 'audio'])
  test(`${kind} mode requires only the selected medium in saved graphs`, () => {
    const context = fixture(kind);
    const before = JSON.stringify(context.nodes);
    const missing = fixer.buildGraphFixPlan(context).issues.filter((i) => i.kind === 'missing_input');
    assert.deepEqual(
      missing.map((i) => i.targetHandle),
      [kind],
    );
    const required = readiness.inspectRequiredGraphInputs(context.nodes, context, context.registry);
    assert.deepEqual(
      required.map((i) => i.fieldId),
      [kind],
    );
    assert.equal(JSON.stringify(context.nodes), before, 'inspection must not migrate saved values/metadata');
    const source = {
      id: 'media',
      type: 'custom',
      position: { x: -300, y: 0 },
      data: {
        type: 'custom',
        module: 'modules.Test',
        action: 'Load',
        label: 'Load media',
        params: { value: { type: kind, display: 'output' } },
      },
    };
    context.nodes.push(source);
    context.edges.push({ id: 'media', source: 'media', sourceHandle: 'value', target: 'ref', targetHandle: kind });
    assert.deepEqual(fixer.buildGraphFixPlan(context).issues, []);
    assert.deepEqual(readiness.inspectRequiredGraphInputs(context.nodes, context, context.registry), []);
    assert(!context.edges.some((e) => e.targetHandle === 'references_in'), 'first item needs no prior list');
  });

test('changing mode recomputes requirements without erasing existing wires or assuming a connected selector', () => {
  const context = fixture('image');
  context.nodes[0].data.params.reference_kind.value = 'video';
  assert.deepEqual(
    readiness.inspectRequiredGraphInputs(context.nodes, context, context.registry).map((i) => i.fieldId),
    ['video'],
  );
  context.nodes[0].data.params.reference_kind.isConnected = true;
  assert.deepEqual(readiness.inspectRequiredGraphInputs(context.nodes, context, context.registry), []);
  assert.deepEqual(fixer.buildGraphFixPlan(context).issues, []);
});

test('malformed conditional metadata does not suppress an unconditional required input', () => {
  const context = fixture('image');
  context.registry['modules.Test.Assemble'].params.video.required = true;
  context.registry['modules.Test.Assemble'].params.video.requiredWhen = { field: 99, equals: 'image' };
  assert.deepEqual(
    readiness.inspectRequiredGraphInputs(context.nodes, context, context.registry).map((i) => i.fieldId),
    ['image', 'video'],
  );
});

test('fresh optional-reference metadata still requires the selected medium despite skipParamsCheck', () => {
  const context = fixture('image');
  context.nodes[0].data = structuredClone(context.registry['modules.Test.Assemble']);
  assert.equal(context.nodes[0].data.skipParamsCheck, true);
  assert.deepEqual(
    fixer.buildGraphFixPlan(context).issues.map((i) => i.targetHandle),
    ['image'],
  );
  context.nodes[0].data.params.reference_kind.value = 'audio';
  assert.deepEqual(
    readiness.inspectRequiredGraphInputs(context.nodes, context, context.registry).map((i) => i.fieldId),
    ['audio'],
  );
});

test('a live schema without requiredness retains a saved explicit optional declaration', () => {
  const context = fixture('image');
  context.nodes[0].data.params.audio.required = false;
  delete context.registry['modules.Test.Assemble'].params.audio.required;
  delete context.registry['modules.Test.Assemble'].params.audio.requiredWhen;
  assert.deepEqual(
    fixer.buildGraphFixPlan(context).issues.map((i) => i.targetHandle),
    ['image'],
  );
});

test('a live schema without requiredness retains a saved explicit required declaration on a dynamic node', () => {
  const context = fixture('image');
  context.nodes[0].data.skipParamsCheck = true;
  context.nodes[0].data.params.video.required = true;
  delete context.registry['modules.Test.Assemble'].params.video.required;
  delete context.registry['modules.Test.Assemble'].params.video.requiredWhen;
  assert.deepEqual(
    fixer.buildGraphFixPlan(context).issues.map((i) => i.targetHandle),
    ['image', 'video'],
  );
});

for (const medium of ['image', 'video', 'audio'])
  test(`required ${medium} file editors block empty saved inputs without inventing a connection repair`, () => {
    const definition = {
      type: 'custom',
      module: 'modules.Test',
      action: 'LoadFile',
      label: `Load ${medium}`,
      params: {
        file: { display: 'filebrowser', type: 'str', required: true },
        result: { display: 'output', type: medium },
      },
    };
    const node = { id: 'load', type: 'custom', position: { x: 0, y: 0 }, data: structuredClone(definition) };
    delete node.data.params.file.required; // old saved metadata must use the current declaration
    const graph = { nodes: [node], edges: [] },
      registry = { 'modules.Test.LoadFile': definition };
    for (const value of [undefined, '', '  ', [], [''], ['a.png', '  '], false, 42, {}]) {
      node.data.params.file.value = value;
      const before = JSON.stringify(node);
      const issues = readiness.inspectRequiredGraphInputs(graph.nodes, graph, registry);
      assert.deepEqual(
        issues.map((i) => i.fieldId),
        ['file'],
      );
      assert.match(issues[0].details, /Select/);
      assert.equal(JSON.stringify(node), before);
    }
    for (const value of ['@data/inputs/source.png', ['a.png', 'b.png']]) {
      node.data.params.file.value = value;
      assert.deepEqual(readiness.inspectRequiredGraphInputs(graph.nodes, graph, registry), []);
    }
    node.data.params.file.value = '';
    definition.params.file.required = false;
    assert.deepEqual(readiness.inspectRequiredGraphInputs(graph.nodes, graph, registry), []);
    definition.params.file.required = true;
    node.data.uiState = { disabled: true };
    assert.deepEqual(readiness.inspectRequiredGraphInputs(graph.nodes, graph, registry), []);
  });
