import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let layout;
let fields;
let schema;
let runtime;
let flow;
let studio;
let inspector;
let exporter;
let referenceContext;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    cacheDir: path.join(ROOT, 'reviews/layout-conditioning-test-cache'),
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  layout = await server.ssrLoadModule('/src/studio/layoutConditioning.ts');
  fields = await server.ssrLoadModule('/src/fields/LayoutConditioningField.tsx');
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  flow = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  studio = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  inspector = await server.ssrLoadModule('/src/studio/graphNodeControls.ts');
  exporter = await server.ssrLoadModule('/src/stores/flowGraphExport.ts');
  referenceContext = await server.ssrLoadModule('/src/studio/layoutReferenceContext.ts');
});

after(async () => {
  await server?.close();
  delete globalThis.localStorage;
  delete globalThis.window;
});

function region(overrides = {}) {
  return { id: 'subject', description: '  A red fox 🦊\n', targetBox: [0.1, 0.2, 0.7, 0.9], ...overrides };
}

function value(regions = [region()]) {
  return { schemaVersion: 1, coordinateSpace: 'normalized_xyxy', regions };
}

const support = { schemaVersion: 1, sourceRegions: false };

test('bound reference summaries have exact bounded data and never substitute for selected capability', () => {
  const summary = {
    schemaVersion: 1,
    ownerFingerprint: 'sha256:' + 'a'.repeat(64),
    bindingFingerprint: 'sha256:' + 'b'.repeat(64),
    taskId: 'reference_task',
    attemptIndex: 0,
    runInputHash: 'run_1234abcd',
    references: [{ referenceId: 'sha256:' + 'c'.repeat(64), sourceSize: [64, 48], processedSize: [64, 48] }],
  };
  assert.deepEqual(layout.parseLayoutReferenceSummary(summary), summary);
  for (const change of [
    { schemaVersion: true },
    { references: [] },
    { references: Array(11).fill(summary.references[0]) },
    { bindingFingerprint: ['sha256:' + 'b'.repeat(64)] },
    { taskId: null },
    { attemptIndex: true },
    { runInputHash: 'guessed' },
    { referenceCount: 1 },
  ])
    assert.throws(() => layout.parseLayoutReferenceSummary({ ...summary, ...change }));
  for (const change of [
    { sourceSize: [0, 48] },
    { processedSize: [100000, 100000] },
    { referenceId: 'sha256:' + 'C'.repeat(64) },
    { index: 0 },
  ])
    assert.throws(() =>
      layout.parseLayoutReferenceSummary({ ...summary, references: [{ ...summary.references[0], ...change }] }),
    );
  const selected = { schemaVersion: 2, sourceRegions: false, supportsBoundSourceRegions: true };
  assert.deepEqual(layout.parseLayoutConditioningSupport(selected), selected);
  for (const value of [
    { ...selected, supportsBoundSourceRegions: false },
    { ...selected, schemaVersion: 1 },
    { ...selected, referenceCount: 1 },
  ])
    assert.throws(() => layout.parseLayoutConditioningSupport(value));
  const source = {
    schemaVersion: 2,
    coordinateSpace: 'normalized_xyxy',
    regions: [
      {
        id: 'subject',
        action: 'remove',
        description: 'Remove exact source',
        targetBox: null,
        source: { referenceIndex: 0, box: [0, 0, 1, 1], expectedReferenceId: summary.references[0].referenceId },
      },
    ],
  };
  assert.throws(() => layout.validateLayoutConditioningSupport(source, selected), /unavailable/);
  const bound = { schemaVersion: 2, sourceRegions: true, references: summary.references };
  layout.validateLayoutConditioningSupport(source, bound);
  const changed = structuredClone(source);
  changed.regions[0].source.expectedReferenceId = summary.bindingFingerprint;
  assert.throws(() => layout.validateLayoutConditioningSupport(changed, bound), /rebind/);
});

test('normal ordinary and Block projection binds summaries to exact source ancestry and actual task snapshot', () => {
  const source = {
    id: 'reference',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      category: 'Fixture',
      label: 'Reference',
      module: 'modules.Test',
      action: 'EncodeReference',
      params: {
        file: { type: 'string', display: 'text', value: 'reference-a.png' },
        reference_binding: { type: 'reference_conditioning', display: 'output' },
        layout_reference_summary: { type: 'string', display: 'output', hidden: true },
      },
    },
  };
  const encode = {
    id: 'prompt',
    type: 'custom',
    position: { x: 400, y: 0 },
    data: {
      type: 'custom',
      category: 'Fixture',
      label: 'Prompt',
      module: 'modules.Test',
      action: 'EncodePrompt',
      params: {
        prompt: { type: 'string', value: 'Raw <subject>' },
        layout: { type: 'layout_conditioning', display: 'layout', value: null },
        reference_binding: { type: 'reference_conditioning', display: 'input' },
      },
    },
  };
  const edges = [
    {
      id: 'binding',
      source: 'reference',
      sourceHandle: 'reference_binding',
      target: 'prompt',
      targetHandle: 'reference_binding',
    },
  ];
  const definition = schema.migrateUserBlockDefinitionV1({
    id: 'source-context',
    name: 'Encode Inputs',
    version: 1,
    nodes: [source, encode],
    edges,
    inputs: [],
    outputs: [],
    exposedParams: [{ id: 'layout', kind: 'graph-param', label: 'Layout', nodeId: 'prompt', paramKey: 'layout' }],
    createdAt: 1,
    updatedAt: 1,
  });
  const grouped = runtime.createBlockRootNodeV2(
    schema.createBlockInstanceV2(definition, {
      instanceId: 'group',
      position: { x: 0, y: 0 },
      size: { width: 368, height: 480 },
    }),
  );
  for (const graph of [
    { nodes: [source, encode], edges, nodeId: 'prompt' },
    { nodes: [grouped], edges: [], nodeId: 'group' },
  ]) {
    const context = referenceContext.layoutReferenceContext(graph.nodes, graph.edges, graph.nodeId, 'layout');
    assert.ok(context);
    assert.notEqual(context.summaryNodeId, context.nodeId, 'the normal cache belongs to the actual image supplier');
    const summary = {
      schemaVersion: 1,
      ownerFingerprint: 'sha256:' + 'a'.repeat(64),
      bindingFingerprint: 'sha256:' + 'b'.repeat(64),
      taskId: 'actual-task',
      attemptIndex: 0,
      runInputHash: 'run_1234abcd',
      references: [],
    };
    const record = {
      task: { task_id: 'actual-task', attempt_index: 0, run_input_hash: 'run_1234abcd' },
      workflow_id: 'tab',
      workflow_snapshot: { nodes: graph.nodes, edges: graph.edges },
    };
    referenceContext.validateLayoutReferenceRun(record, summary, context, graph.nodeId, 'layout', 'tab');
    for (const change of [
      { workflow_id: 'foreign' },
      { task: { ...record.task, task_id: 'foreign' } },
      { task: { ...record.task, run_input_hash: 'run_00000000' } },
      { workflow_snapshot: { nodes: [], edges: [] } },
    ])
      assert.throws(() =>
        referenceContext.validateLayoutReferenceRun(
          { ...record, ...change },
          summary,
          context,
          graph.nodeId,
          'layout',
          'tab',
        ),
      );
  }
  const before = referenceContext.layoutReferenceContext([source, encode], edges, 'prompt', 'layout');
  const afterPrompt = structuredClone(encode);
  afterPrompt.data.params.prompt.value = 'Changed raw prompt';
  afterPrompt.data.params.layout.value = { schemaVersion: 2, coordinateSpace: 'normalized_xyxy', regions: [] };
  assert.equal(
    referenceContext.layoutReferenceContext([source, afterPrompt], edges, 'prompt', 'layout').key,
    before.key,
  );
  const changedSource = structuredClone(source);
  changedSource.data.params.file.value = 'reference-b.png';
  assert.notEqual(
    referenceContext.layoutReferenceContext([changedSource, encode], edges, 'prompt', 'layout').key,
    before.key,
  );
  assert.equal(
    referenceContext.layoutReferenceContext(
      [source, encode],
      [...edges, { ...edges[0], id: 'duplicate' }],
      'prompt',
      'layout',
    ),
    null,
  );
  for (const alter of [
    (node) => {
      delete node.data.params.layout_reference_summary;
    },
    (node) => {
      node.data.params.layout_reference_summary.type = 'reference_conditioning';
    },
    (node) => {
      node.data.params.layout_reference_summary.display = 'input';
    },
    (node) => {
      node.data.params.reference_binding.type = 'string';
    },
  ]) {
    const missingDeclaration = structuredClone(source);
    alter(missingDeclaration);
    assert.equal(
      referenceContext.layoutReferenceContext([missingDeclaration, encode], edges, 'prompt', 'layout'),
      null,
    );
  }
});

test('version two shared action grammar preserves removal and ten-reference drafts without granting source authority', async (t) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/layout-conditioning.v2.json'), 'utf8'));
  const currentSupport = layout.parseLayoutConditioningSupport({ schemaVersion: 2, sourceRegions: false });
  for (const item of fixture.valid)
    await t.test(item.name, () => {
      const parsed = layout.parseLayoutConditioning(item.layout);
      assert.deepEqual(parsed, item.layout);
      if (parsed.regions.some((region) => region.source))
        assert.throws(() => layout.validateLayoutConditioningSupport(parsed, currentSupport), /unavailable/);
      else layout.validateLayoutConditioningSupport(parsed, currentSupport);
    });
  for (const item of fixture.invalid)
    await t.test(item.name, () => assert.throws(() => layout.parseLayoutConditioning(item.layout)));
  const removal = structuredClone(fixture.valid[1].layout);
  for (const index of [0, 7, 8, 9]) {
    removal.regions[0].source.referenceIndex = index;
    assert.deepEqual(layout.parseLayoutConditioning(removal), removal);
  }
  for (const invalid of [10, -1, true, '9']) {
    removal.regions[0].source.referenceIndex = invalid;
    assert.throws(() => layout.parseLayoutConditioning(removal));
  }
  removal.regions[0].source.referenceIndex = 9;
  for (const invalid of ['', 'sha256:' + 'A'.repeat(64), null, ['sha256:' + 'a'.repeat(64)]]) {
    removal.regions[0].source.expectedReferenceId = invalid;
    assert.throws(() => layout.parseLayoutConditioning(removal));
  }
  assert.throws(() =>
    layout.parseLayoutConditioningSupport({ schemaVersion: 2, sourceRegions: true, referenceCount: 10 }),
  );
});

test('shared backend fixture agrees on generic draft validation, with source execution capability separate', async (t) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/layout-conditioning.v1.json'), 'utf8'));
  for (const item of fixture.valid) {
    await t.test(item.name, () => {
      const parsed = layout.parseLayoutConditioning(item.layout);
      assert.deepEqual(parsed, item.layout);
      if (item.referenceCount) {
        assert.throws(() => layout.validateLayoutConditioningSupport(parsed, support), /unavailable/);
      } else layout.validateLayoutConditioningSupport(parsed, support);
    });
  }
  for (const item of fixture.invalid) {
    await t.test(item.name, () => assert.throws(() => layout.parseLayoutConditioning(item.layout)));
  }
});

test('raw mode is only null; structured values preserve region order, description bytes and normalized coordinates', () => {
  assert.equal(layout.parseLayoutConditioning(null), null);
  const input = value([region(), region({ id: 'background', description: '背景', targetBox: [0, 0, 1, 1] })]);
  const parsed = layout.parseLayoutConditioning(input);
  assert.deepEqual(parsed, input);
  parsed.regions[0].targetBox[0] = 0;
  assert.equal(input.regions[0].targetBox[0], 0.1);
  assert.deepEqual(layout.parseLayoutConditioning(value([])), value([]));
});

test('strict layout grammar refuses malformed JSON data without invoking getters', async (t) => {
  let invoked = false;
  const accessor = { ...value() };
  Object.defineProperty(accessor, 'regions', {
    enumerable: true,
    get() {
      invoked = true;
      return [];
    },
  });
  const cases = [
    undefined,
    '',
    'null',
    [],
    true,
    1,
    { ...value(), schemaVersion: true },
    { ...value(), coordinateSpace: ['normalized_xyxy'] },
    { ...value(), mode: 'structured' },
    { ...value(), regions: undefined },
    Object.create(value()),
    accessor,
    Object.defineProperty(value(), 'regions', { enumerable: false, value: [] }),
    Object.assign(value(), { [Symbol('extra')]: 1 }),
    value(Array(1)),
    value(Object.assign([region()], { extra: true })),
    value([region({ source: null })]),
    value([region({ source: undefined })]),
    value([region({ unknown: 1 })]),
  ];
  for (const [index, input] of cases.entries()) {
    await t.test(String(index), () => assert.throws(() => layout.parseLayoutConditioning(input), /Invalid layout/));
  }
  assert.equal(invoked, false);
});

test('IDs, Unicode text and box boundaries are validated without rewriting content', async (t) => {
  for (const id of ['', '1subject', 'has space', 'é', 'ref_image_0', 'ref_image_100', 'a'.repeat(65), 'subject\n']) {
    await t.test(`ID ${JSON.stringify(id)}`, () =>
      assert.throws(() => layout.parseLayoutConditioning(value([region({ id })]))),
    );
  }
  assert.throws(() => layout.parseLayoutConditioning(value([region(), region()])), /unique/);
  for (const description of [
    '',
    ' \t\n',
    '\u0085',
    '\u001c',
    '\ud800',
    '\udc00',
    'x\ud800y',
    'a'.repeat(4097),
    '🦊'.repeat(4097),
  ]) {
    await t.test(`description ${description.length}`, () =>
      assert.throws(() => layout.parseLayoutConditioning(value([region({ description })]))),
    );
  }
  assert.equal(
    layout.parseLayoutConditioning(value([region({ description: '🦊'.repeat(4096) })])).regions[0].description.length,
    8192,
  );
  assert.equal(
    layout.parseLayoutConditioning(value([region({ description: '\ufeff' })])).regions[0].description,
    '\ufeff',
  );
  for (const targetBox of [
    [0, 0, 0, 1],
    [0, 1, 1, 0],
    [0, 0, 1],
    [0, 0, 1, 1, 1],
    [-0.1, 0, 1, 1],
    [0, 0, 1.1, 1],
    [false, 0, 1, 1],
    ['0', 0, 1, 1],
    [NaN, 0, 1, 1],
    [0, 0, Infinity, 1],
  ]) {
    await t.test(`box ${JSON.stringify(targetBox)}`, () =>
      assert.throws(() => layout.parseLayoutConditioning(value([region({ targetBox })]))),
    );
  }
});

test('region count and total serialized UTF-8 byte cap are independent of JavaScript string length', () => {
  const many = Array.from({ length: 32 }, (_, index) => region({ id: `r${index}`, description: 'x' }));
  assert.equal(layout.parseLayoutConditioning(value(many)).regions.length, 32);
  assert.throws(() => layout.parseLayoutConditioning(value([...many, region({ id: 'extra' })])));
  const unicode = value(
    Array.from({ length: 8 }, (_, index) => region({ id: `r${index}`, description: '🦊'.repeat(2200) })),
  );
  assert.ok(JSON.stringify(unicode).length < 65536);
  assert.throws(() => layout.parseLayoutConditioning(unicode), /64 KiB/);
  const base = value(
    Array.from({ length: 15 }, (_, index) =>
      region({ id: `r${index}`, description: 'a'.repeat(4096), targetBox: [0, 0, 1, 1] }),
    ),
  );
  base.regions.push(region({ id: 'last', description: 'a', targetBox: [1e-7, 0, 1.0, 1.0] }));
  const padding = 65536 - Buffer.byteLength(JSON.stringify(base));
  base.regions.at(-1).description += 'a'.repeat(padding);
  assert.equal(Buffer.byteLength(JSON.stringify(base)), 65536);
  assert.deepEqual(layout.parseLayoutConditioning(base), base);
  base.regions.at(-1).description += 'a';
  assert.throws(() => layout.parseLayoutConditioning(base), /64 KiB/);
});

test('draft source regions need a strict declared capability and current reference count', () => {
  const withSource = layout.parseLayoutConditioning(
    value([region({ source: { referenceIndex: 1, box: [0, 0.1, 0.5, 1] } })]),
  );
  assert.throws(() => layout.validateLayoutConditioningSupport(withSource, support), /unavailable/);
  layout.validateLayoutConditioningSupport(
    withSource,
    layout.parseLayoutConditioningSupport({ schemaVersion: 1, sourceRegions: true, referenceCount: 2 }),
  );
  assert.throws(
    () =>
      layout.validateLayoutConditioningSupport(withSource, {
        schemaVersion: 1,
        sourceRegions: true,
        referenceCount: 1,
      }),
    /no longer bound/,
  );
  for (const input of [
    undefined,
    {},
    { ...support, referenceCount: 0 },
    { ...support, sourceRegions: 'false' },
    { schemaVersion: 1, sourceRegions: true },
    { schemaVersion: 1, sourceRegions: true, referenceCount: 9 },
  ]) {
    assert.throws(() => layout.parseLayoutConditioningSupport(input));
  }
  for (const referenceIndex of [-1, 8, 0.5, false, '0']) {
    assert.throws(() =>
      layout.parseLayoutConditioning(value([region({ source: { referenceIndex, box: [0, 0, 1, 1] } })])),
    );
  }
});

function fieldProps(value, overrides = {}) {
  return {
    nodeId: 'encode',
    fieldKey: 'layout_conditioning',
    label: 'Layout',
    display: 'layout',
    disabled: false,
    hidden: false,
    style: {},
    value,
    default: null,
    options: [],
    dataType: 'layout_conditioning',
    fieldType: 'layout',
    module: 'modules.Test',
    action: 'EncodeInputs',
    updateStore: () => assert.fail('Rendering must not mutate the graph.'),
    fieldOptions: { layoutConditioning: support },
    ...overrides,
  };
}

test('actual layout field renders raw mode, accessible ordered regions, errors and disabled controls', () => {
  const raw = renderToStaticMarkup(React.createElement(fields.default, fieldProps(null)));
  assert.match(raw, /Raw prompt/);
  assert.doesNotMatch(raw, /Target region layout|Add region/);
  const structured = renderToStaticMarkup(React.createElement(fields.default, fieldProps(value(), { disabled: true })));
  assert.equal(
    renderToStaticMarkup(
      React.createElement(fields.default, fieldProps(undefined, { default: value(), disabled: true })),
    ),
    structured,
    'An untouched structured default must render the same selected mode as its effective value.',
  );
  assert.match(structured, /Target region layout/);
  assert.match(structured, /Edit subject/);
  assert.match(structured, /Remove subject/);
  assert.match(structured, /disabled=""/);
  assert.ok(structured.indexOf('Edit subject') < structured.indexOf('Add region'));
  const unsupported = renderToStaticMarkup(
    React.createElement(fields.default, fieldProps(value(), { fieldOptions: {} })),
  );
  assert.match(unsupported, /role="alert"/);
  assert.doesNotMatch(unsupported, /Add region/);
  const row = renderToStaticMarkup(
    React.createElement(fields.LayoutRegionEditor, {
      region: region(),
      support,
      disabled: false,
      onApply: () => {},
      onCancel: () => {},
    }),
  );
  for (const label of [
    'Region ID',
    'Region description',
    'Target box left',
    'Target box top',
    'Target box right',
    'Target box bottom',
    'Apply region',
    'Cancel',
  ])
    assert.ok(row.includes(label));
  assert.doesNotMatch(row, /Source reference index/);
  assert.match(row, /Source regions are unavailable/);
});

test('ordinary and grouped JSON layout values survive real control updates, Undo, persistence and API export without changing prompts', () => {
  const originalFlow = flow.useFlowStore.getState();
  const originalStudio = studio.useStudioStore.getState();
  try {
    const prompt = '  Original <subject> prompt\n[{"id": raw syntax remains raw}]  ';
    const definition = schema.migrateUserBlockDefinitionV1({
      id: 'layout-test',
      name: 'Encode Inputs',
      version: 1,
      nodes: [
        {
          id: 'encode',
          type: 'custom',
          position: { x: 0, y: 0 },
          data: {
            type: 'custom',
            module: 'modules.Test',
            action: 'EncodeInputs',
            label: 'Encode Inputs',
            params: {
              prompt: { type: 'string', display: 'textarea', value: prompt },
              layout_conditioning: {
                type: 'layout_conditioning',
                display: 'layout',
                value: null,
                default: null,
                fieldOptions: { layoutConditioning: support },
              },
              embeddings: { type: 'embeddings', display: 'output' },
            },
          },
        },
      ],
      edges: [],
      inputs: [],
      outputs: [],
      exposedParams: [
        { id: 'layout', kind: 'graph-param', label: 'Layout', nodeId: 'encode', paramKey: 'layout_conditioning' },
      ],
      createdAt: 1,
      updatedAt: 2,
    });
    const block = runtime.createBlockRootNodeV2(
      schema.createBlockInstanceV2(definition, {
        instanceId: 'layout-block',
        position: { x: 100, y: 120 },
        size: { width: 420, height: 480 },
      }),
    );
    const ordinary = {
      id: 'ordinary-encode',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: structuredClone(definition.graph.nodes[0].data),
    };
    flow.useFlowStore.setState({
      nodes: [ordinary],
      edges: [],
      historyPast: [],
      historyFuture: [],
      historyTransaction: null,
    });
    flow.useFlowStore.getState().setParam(ordinary.id, 'layout_conditioning', layout.parseLayoutConditioning(value()));
    const ordinaryApi = exporter.buildApiGraphExport({
      nodes: flow.useFlowStore.getState().nodes,
      edges: [],
      sid: 'test',
      setParam: () => {},
    });
    assert.deepEqual(ordinaryApi.nodes[ordinary.id].params.layout_conditioning.value, value());
    assert.equal(ordinaryApi.nodes[ordinary.id].params.prompt.value, prompt);
    flow.useFlowStore.setState({
      nodes: [block],
      edges: [],
      historyPast: [],
      historyFuture: [],
      historyTransaction: null,
    });
    studio.useStudioStore.setState({ activeWorkflowTabId: 'layout-workflow' });
    inspector.updateGraphNodeControl('layout-workflow', block.id, 'layout', layout.parseLayoutConditioning(value()));
    let state = flow.useFlowStore.getState();
    assert.equal(state.historyPast.length, 1);
    assert.deepEqual(inspector.graphNodeControlParams(state.nodes[0]).layout.value, value());
    const api = state.exportGraph('test', undefined, { randomizeSeeds: false });
    const leaf = Object.values(api.nodes)[0];
    assert.equal(leaf.params.prompt.value, prompt);
    assert.deepEqual(leaf.params.layout_conditioning.value, value());
    state.undo();
    assert.equal(inspector.graphNodeControlParams(flow.useFlowStore.getState().nodes[0]).layout.value, null);
    flow.useFlowStore.getState().redo();
    state = flow.useFlowStore.getState();
    const persisted = JSON.parse(JSON.stringify(runtime.canonicalizePersistedBlockGraphV2(state.nodes, state.edges)));
    assert.deepEqual(inspector.graphNodeControlParams(persisted.nodes[0]).layout.value, value());
    const restored = state.exportGraph('test', undefined, { sourceGraph: persisted, randomizeSeeds: false });
    assert.deepEqual(restored, api);
    inspector.updateGraphNodeControl('layout-workflow', block.id, 'layout', null);
    const raw = flow.useFlowStore.getState().exportGraph('test', undefined, { randomizeSeeds: false });
    assert.equal(Object.values(raw.nodes)[0].params.prompt.value, prompt);
    assert.equal(Object.values(raw.nodes)[0].params.layout_conditioning.value, null);
  } finally {
    flow.useFlowStore.setState(originalFlow, true);
    studio.useStudioStore.setState(originalStudio, true);
  }
});
