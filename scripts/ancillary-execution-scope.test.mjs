import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
const ROOT = process.cwd();
const cache = mkdtempSync(path.join(tmpdir(), 'modiff-ancillary-scope-'));
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/ancillary-authoring.v1.json'), 'utf8'));
const fp32Fixture = JSON.parse(
  readFileSync(path.join(ROOT, 'tests/fixtures/ancillary-fp32-t2i-authoring.v1.json'), 'utf8'),
);
let server, select, exporter, hashes, runtime, schema, definitions, selectedStarter, previousWindow;
before(async () => {
  previousWindow = globalThis.window;
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:5191', hostname: '127.0.0.1', protocol: 'http:', port: '5191' },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    cacheDir: cache,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  ({ selectAncillaryExecutionScope: select } = await server.ssrLoadModule('/src/workflow/ancillaryExecutionScope.ts'));
  definitions = await server.ssrLoadModule('/src/workflow/ancillaryExecutionScope.ts');
  const actual = JSON.parse(readFileSync('tests/fixtures/ancillary-starter.v1.json', 'utf8'));
  const { parseOperationStarter } = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  selectedStarter = parseOperationStarter(
    actual.response,
    actual.selection.pipelineClass,
    actual.selection.task,
    actual.operationContracts,
    actual.selection,
  );
  exporter = await server.ssrLoadModule('/src/stores/flowGraphExport.ts');
  hashes = await server.ssrLoadModule('/src/studio/stableHash.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
});
after(async () => {
  await server?.close();
  rmSync(cache, { recursive: true, force: true });
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});
function setup(index = 0, document = fixture) {
  const row = document.parents[index],
    parent = JSON.parse(row.rawParentJson),
    contract = parent.ancillaryOperations[0],
    registry = structuredClone(row.registry);
  const binding = {
    contractId: contract.id,
    contentHash: contract.contentHash,
    parent: { ...contract.parent, authoringContentHash: parent.contentHash },
    parentRoleNodes: Object.fromEntries(parent.roles.map(([role]) => [role, `main-${role}`])),
    roleNodes: Object.fromEntries(contract.roles.map(([role]) => [role, `aux-${role}`])),
  };
  const nodes = [
    ...parent.roles.map((role) => [binding.parentRoleNodes, role]),
    ...contract.roles.map((role) => [binding.roleNodes, role]),
  ].map(([map, [role, key, x, y]]) => ({
    id: map[role],
    type: 'custom',
    position: { x, y },
    data: structuredClone(registry[key]),
  }));
  // Finite synthetic topology over actual registry declarations, not a loaded model.
  // Use explicit internally consistent CPU/Off controls; no GPU authority is mocked.
  for (const node of nodes) {
    if (node.data.params.offload_mode) node.data.params.offload_mode.value = 'none';
    if (node.data.params.auto_offload) node.data.params.auto_offload.value = false;
  }
  const byId = (id) => nodes.find((node) => node.id === id);
  const owner = byId(binding.parentRoleNodes[contract.bindings.owner.role]),
    request = byId(binding.roleNodes[contract.bindings.request.role]);
  owner.data.params[contract.bindings.owner.promptField].value = 'Authored raw prompt\nunchanged.';
  owner.data.params[contract.bindings.owner.layoutField].value = null;
  request.data.params[contract.bindings.request.promptField].value =
    owner.data.params[contract.bindings.owner.promptField].value;
  request.data.params[contract.bindings.request.layoutField].value = null;
  for (const [role, field, value] of contract.initialValues)
    byId(binding.roleNodes[role]).data.params[field].value = value;
  owner.data.operationAuthoring = { ancillaryBindings: [binding] };
  const edge = ([a, b, c, d], map, index) => ({
    id: `edge-${index}`,
    source: map[a],
    sourceHandle: b,
    target: map[c],
    targetHandle: d,
  });
  const edges = [
    ...parent.edges.map((row, i) => edge(row, binding.parentRoleNodes, i)),
    ...contract.edges.map((row, i) => edge(row, binding.roleNodes, parent.edges.length + i)),
  ];
  const reference = contract.bindings.owner.referenceSource;
  if (reference)
    edges.push({
      id: 'shared-reference',
      source: binding.parentRoleNodes[reference.role],
      sourceHandle: reference.field,
      target: request.id,
      targetHandle: contract.bindings.request.imagesField,
    });
  const target = {
    nodeId: binding.roleNodes[contract.bindings.output.role],
    outputField: contract.bindings.output.field,
  };
  return {
    nodes,
    edges,
    parent,
    contract,
    binding,
    owner,
    request,
    registry,
    target,
    parents: [{ recipe: parent, selection: row.selection }],
    kind: 'workflow',
  };
}
const ids = (values) => values.slice().sort();
const run = (flow, kind = 'workflow') =>
  select({ ...flow, kind, target: kind === 'explicit_preview' ? flow.target : undefined });
const api = (flow, targets) =>
  exporter.buildApiGraphExport({
    nodes: flow.nodes,
    edges: flow.edges,
    sid: 'unit',
    ...(targets ? { targetNodeIds: targets } : {}),
    randomizeSeeds: false,
    setParam() {
      throw Error('No seed mutations');
    },
  });
for (let index = 0; index < 4; index++) {
  test(`actual declaration ${index + 1} selects ordinary parent and exclusive Preview ancestry`, () => {
    const f = setup(index),
      before = JSON.stringify(f);
    const ordinary = run(f),
      preview = run(f, 'explicit_preview');
    assert.deepEqual(ids(ordinary.nodeIds), ids(Object.values(f.binding.parentRoleNodes)));
    const reference = f.contract.bindings.owner.referenceSource;
    assert.deepEqual(
      ids(preview.nodeIds),
      ids([...Object.values(f.binding.roleNodes), ...(reference ? [f.binding.parentRoleNodes[reference.role]] : [])]),
    );
    assert.equal(ordinary.purpose.target, null);
    assert.deepEqual(preview.purpose.target, f.target);
    assert.deepEqual(Object.keys(api(f, ordinary.targetNodeIds).nodes).sort(), ids(ordinary.nodeIds));
    assert.deepEqual(Object.keys(api(f, preview.targetNodeIds).nodes).sort(), ids(preview.nodeIds));
    assert.equal(JSON.stringify(f), before);
  });
}
test('actual FP32 T2I declaration selects only its provider Preview and preserves the ordinary image route', () => {
  const f = setup(0, fp32Fixture),
    before = JSON.stringify(f),
    runtime = f.contract.verification.runtimeInputs,
    request = f.contract.verification.requestInputs;
  assert.equal(f.parent.id, 'flux3-klein:text-to-image:prompt-preview-fp32-authoring:v1');
  assert.equal(f.contract.bindings.owner.referenceSource, null);
  assert.equal(f.parent.roles.length, 5);
  assert.equal(f.nodes.length, 7);
  assert.equal(f.edges.length, 8);
  const selected = (role, field) =>
    f.contract.initialValues.find(([actualRole, actualField]) => actualRole === role && actualField === field)?.[2];
  assert.equal(selected(runtime.role, runtime.dtypeField), 'float32');
  assert.equal(selected(runtime.role, runtime.deviceField), 'cuda:0');
  assert.equal(selected(runtime.role, runtime.quantizationField), 'none');
  assert.equal(selected(request.role, request.maxInputTokensField), 4096);
  const ordinary = run(f),
    preview = run(f, 'explicit_preview');
  assert.deepEqual(ids(ordinary.nodeIds), ids(Object.values(f.binding.parentRoleNodes)));
  assert.deepEqual(ids(preview.nodeIds), ids(Object.values(f.binding.roleNodes)));
  assert.deepEqual(Object.keys(api(f, ordinary.targetNodeIds).nodes).sort(), ids(ordinary.nodeIds));
  const previewApi = api(f, preview.targetNodeIds);
  assert.deepEqual(Object.keys(previewApi.nodes).sort(), ids(preview.nodeIds));
  const images = previewApi.nodes[f.request.id].params[f.contract.bindings.request.imagesField];
  assert.equal(images?.sourceId, undefined);
  assert.equal(images?.value ?? null, null);
  assert.equal(JSON.stringify(f), before);
});

for (const [name, field, value] of [
  ['dtype', 'dtypeField', 'bfloat16'],
  ['device', 'deviceField', 'cpu'],
  ['quantization', 'quantizationField', 'bnb_4bit'],
])
  test(`actual FP32 T2I Preview refuses a changed ${name} literal`, () => {
    const f = setup(0, fp32Fixture),
      runtime = f.contract.verification.runtimeInputs,
      provider = f.nodes.find((node) => node.id === f.binding.roleNodes[runtime.role]);
    provider.data.params[runtime[field]].value = value;
    assert.throws(() => run(f, 'explicit_preview'), /declared input selection changed/u);
    assert.deepEqual(ids(run(f).nodeIds), ids(Object.values(f.binding.parentRoleNodes)));
  });

test('actual FP32 T2I Preview refuses a changed input-token bound', () => {
  const f = setup(0, fp32Fixture),
    request = f.contract.verification.requestInputs;
  f.request.data.params[request.maxInputTokensField].value = 32768;
  assert.throws(() => run(f, 'explicit_preview'), /declared input selection changed/u);
});

test('current legacy T2I declaration retains its NF4 recipe and refuses FP32 substitution', () => {
  const f = setup(0, {
      parents: [{ ...fp32Fixture.currentLegacyParent, registry: fp32Fixture.parents[0].registry }],
    }),
    runtime = f.contract.verification.runtimeInputs,
    provider = f.nodes.find((node) => node.id === f.binding.roleNodes[runtime.role]);
  assert.equal(f.parent.id, 'flux3-klein:text-to-image:prompt-preview-authoring:v1');
  assert.equal(provider.data.params[runtime.dtypeField].value, 'bfloat16');
  assert.equal(provider.data.params[runtime.quantizationField].value, 'bnb_4bit');
  assert.deepEqual(ids(run(f, 'explicit_preview').nodeIds), ids(Object.values(f.binding.roleNodes)));
  provider.data.params[runtime.dtypeField].value = 'float32';
  provider.data.params[runtime.quantizationField].value = 'none';
  assert.throws(() => run(f, 'explicit_preview'), /declared input selection changed/u);
});

test('unclaimed graphs retain the original all-sinks export and leaf target semantics', () => {
  const f = setup();
  delete f.owner.data.operationAuthoring;
  const ordinary = run(f);
  assert.equal(ordinary.purpose, undefined);
  assert.equal(ordinary.targetNodeIds, undefined);
  assert.deepEqual(ids(ordinary.nodeIds), Object.keys(api(f).nodes).sort());
  const selected = exporter.selectFlowGraphExecutionScope({ ...f, targetNodeId: f.target.nodeId });
  assert.deepEqual(ids(selected.nodes.map((n) => n.id)), ids(Object.values(f.binding.roleNodes)));
  assert.throws(() => run(f, 'explicit_preview'));
});
test('ordinary scope keeps unrelated sinks/shared source and does not require an optional draft to be ready', () => {
  const f = setup(1),
    unrelated = structuredClone(f.nodes[0]);
  unrelated.id = 'unrelated';
  f.nodes.push(unrelated);
  f.request.data.params[f.contract.bindings.request.promptField].value = 'unfinished different prompt';
  f.request.data.params[f.contract.initialValues[0][1]].value = 'standard';
  assert.ok(run(f).nodeIds.includes('unrelated'));
  assert.throws(() => run(f, 'explicit_preview'), /authored input|input selection/u);
});
for (const [name, change] of [
  [
    'null claim',
    (f) => {
      f.owner.data.operationAuthoring.ancillaryBindings = null;
    },
  ],
  [
    'stale child',
    (f) => {
      f.binding.contentHash = 'studio-ancillary-v1-00000000';
    },
  ],
  [
    'stale final parent',
    (f) => {
      f.binding.parent.authoringContentHash = 'studio-authoring-v1-00000000';
    },
  ],
  [
    'stale base',
    (f) => {
      f.binding.parent.baseSpecContentHash = 'studio-spec-v1-00000000';
    },
  ],
  [
    'missing role',
    (f) => {
      delete f.binding.roleNodes[Object.keys(f.binding.roleNodes)[0]];
    },
  ],
  [
    'foreign role',
    (f) => {
      f.binding.roleNodes.foreign = 'foreign';
    },
  ],
  [
    'wrong native action',
    (f) => {
      f.request.data.action = 'Foreign';
    },
  ],
  [
    'foreign holder',
    (f) => {
      const h = f.owner.data.operationAuthoring;
      delete f.owner.data.operationAuthoring;
      f.nodes[0].data.operationAuthoring = h;
    },
  ],
  [
    'missing parent edge',
    (f) => {
      f.edges.shift();
    },
  ],
  [
    'missing child edge',
    (f) => {
      const i = f.edges.findIndex((e) => Object.values(f.binding.roleNodes).includes(e.source));
      f.edges.splice(i, 1);
    },
  ],
  [
    'duplicate child edge',
    (f) => {
      const e = f.edges.find((e) => Object.values(f.binding.roleNodes).includes(e.source));
      f.edges.push({ ...e, id: 'duplicate' });
    },
  ],
  [
    'foreign child output',
    (f) => {
      f.edges.push({
        id: 'foreign',
        source: f.target.nodeId,
        sourceHandle: f.target.outputField,
        target: f.owner.id,
        targetHandle: f.contract.bindings.owner.promptField,
      });
    },
  ],
  [
    'registered output type changed',
    (f) => {
      f.registry[`${f.request.data.module}.${f.request.data.action}`].params[f.target.outputField].type = 'object';
    },
  ],
  [
    'registered provider wire changed',
    (f) => {
      const e = f.contract.edges[0];
      const n = f.nodes.find((n) => n.id === f.binding.roleNodes[e[0]]);
      f.registry[`${n.data.module}.${n.data.action}`].params[e[1]].type = 'foreign';
    },
  ],
])
  test(`scope refuses ${name}`, () => {
    const f = setup();
    change(f);
    assert.throws(() => run(f));
  });
for (const [name, change] of [
  [
    'missing target',
    (f) => {
      f.target = undefined;
    },
  ],
  [
    'foreign target',
    (f) => {
      f.target = { ...f.target, nodeId: f.owner.id };
    },
  ],
  [
    'different output field',
    (f) => {
      f.target.outputField = 'result';
    },
  ],
  [
    'disabled role',
    (f) => {
      f.request.data.uiState = { disabled: true };
    },
  ],
  [
    'changed prompt',
    (f) => {
      f.request.data.params[f.contract.bindings.request.promptField].value = 'changed';
    },
  ],
  [
    'changed layout',
    (f) => {
      f.request.data.params[f.contract.bindings.request.layoutField].value = {};
    },
  ],
  [
    'changed initial selection',
    (f) => {
      const [role, field] = f.contract.initialValues[0];
      f.nodes.find((n) => n.id === f.binding.roleNodes[role]).data.params[field].value = 'standard';
    },
  ],
  [
    'connected authored prompt',
    (f) => {
      f.edges.push({
        id: 'external-prompt',
        source: f.nodes[0].id,
        sourceHandle: 'output',
        target: f.owner.id,
        targetHandle: f.contract.bindings.owner.promptField,
      });
    },
  ],
  [
    'text-only injected media',
    (f) => {
      f.request.data.params[f.contract.bindings.request.imagesField].value = 'unbound.png';
    },
  ],
])
  test(`Preview refuses ${name}`, () => {
    const f = setup();
    change(f);
    assert.throws(() => run(f, 'explicit_preview'));
  });
test('no current declaration and duplicate claims refuse rather than downgrade', () => {
  const f = setup();
  f.parents = [];
  assert.throws(() => run(f));
  const g = setup();
  g.owner.data.operationAuthoring.ancillaryBindings.push(structuredClone(g.binding));
  assert.throws(() => run(g));
});
test('child role vocabulary is declaration-selected, not provider/proposal frontend behavior', () => {
  const f = setup(),
    rename = new Map(f.contract.roles.map(([role], i) => [role, `optional_${i}`]));
  const c = f.contract;
  c.roles.forEach((row) => {
    row[0] = rename.get(row[0]);
  });
  c.edges.forEach((row) => {
    row[0] = rename.get(row[0]);
    row[2] = rename.get(row[2]);
  });
  c.initialValues.forEach((row) => {
    row[0] = rename.get(row[0]);
  });
  c.bindings.request.role = rename.get(c.bindings.request.role);
  c.bindings.output.role = rename.get(c.bindings.output.role);
  f.binding.roleNodes = Object.fromEntries(
    Object.entries(f.binding.roleNodes).map(([role, id]) => [rename.get(role), id]),
  );
  delete c.contentHash;
  c.contentHash = `studio-ancillary-v1-${hashes.hashString(hashes.stableStringify(c))}`;
  delete f.parent.contentHash;
  f.parent.contentHash = `studio-authoring-v1-${hashes.hashString(hashes.stableStringify(f.parent))}`;
  f.binding.contentHash = c.contentHash;
  f.binding.parent.authoringContentHash = f.parent.contentHash;
  assert.equal(run(f, 'explicit_preview').purpose.kind, 'explicit_preview');
});
test('real V2 effective leaves remap both maps and retain the same Preview closure after save/reinsert', () => {
  const f = setup(1);
  const graph = {
    nodes: f.nodes.map((n) => ({ nodeId: n.id, nodeType: 'custom', data: n.data })),
    edges: f.edges.map((e) => ({
      edgeId: e.id,
      sourceNodeId: e.source,
      sourcePortId: e.sourceHandle,
      targetNodeId: e.target,
      targetPortId: e.targetHandle,
    })),
    executionOrder: f.nodes.map((n) => n.id),
  };
  graph.graphHash = schema.blockGraphHashV2(graph);
  const definition = {
    schemaVersion: 2,
    definitionId: 'user:ancillary-source-fixture',
    displayName: 'Optional operation fixture',
    source: { kind: 'user' },
    graph,
    boundary: { mode: 'explicit', inputs: [], outputs: [] },
    controls: [],
    suggestedInputs: [],
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  definition.contentHash = schema.blockDefinitionContentHashV2(definition);
  const instance = schema.createBlockInstanceV2(definition, {
    instanceId: 'scope-block',
    position: { x: 0, y: 0 },
    size: { width: 640, height: 480 },
  });
  const root = runtime.createBlockRootNodeV2(JSON.parse(JSON.stringify(instance)));
  const effective = runtime.expandBlockGraphV2ForExecution([root], []);
  const holder = effective.nodes.find((n) => n.data.operationAuthoring?.ancillaryBindings);
  const b = holder.data.operationAuthoring.ancillaryBindings[0];
  assert.ok(Object.values(b.parentRoleNodes).every((id) => effective.nodes.some((n) => n.id === id)));
  assert.ok(Object.values(b.roleNodes).every((id) => effective.nodes.some((n) => n.id === id)));
  const target = { nodeId: b.roleNodes[f.contract.bindings.output.role], outputField: f.target.outputField };
  const result = select({ ...f, ...effective, target, kind: 'explicit_preview' });
  assert.deepEqual(
    ids(result.nodeIds),
    ids([...Object.values(b.roleNodes), b.parentRoleNodes[f.contract.bindings.owner.referenceSource.role]]),
  );
  assert.deepEqual(root.data.blockInstanceV2, instance);
});

test('Preview refuses real loop ancestry while ordinary container ancestry remains valid', () => {
  const f = setup();
  f.nodes.push({ id: 'iteration', type: 'loop', position: { x: 0, y: 0 }, data: { type: 'loop', params: {} } });
  f.request.parentId = 'iteration';
  assert.throws(() => run(f, 'explicit_preview'), /loop body/u);
  f.nodes.find((n) => n.id === 'iteration').data.type = 'group';
  assert.doesNotThrow(() => run(f, 'explicit_preview'));
});

function withoutGenericParentFields(f) {
  delete f.target;
  const key = `${f.owner.data.module}.${f.owner.data.action}`;
  for (const field of [f.contract.bindings.owner.promptField, f.contract.bindings.owner.layoutField])
    delete f.registry[key].params[field];
  return f;
}
test('fresh selected parent definitions cover wrapper inputs absent from generic registry without granting child fields', () => {
  const f = withoutGenericParentFields(setup());
  assert.throws(() => select(f), /registered/iu);
  const token = definitions.captureCurrentAncillaryParentDefinition(selectedStarter, f.binding, () => {});
  f.parents[0].definition = token;
  assert.deepEqual(select(f).nodeIds.sort(), Object.values(f.binding.parentRoleNodes).sort());
  delete f.registry[`${f.request.data.module}.${f.request.data.action}`].params[
    f.contract.bindings.request.promptField
  ];
  assert.throws(() => select(f), /registered/iu);
});
test('saved or cloned definition contexts cannot replace a fresh selected response; explicit renewal recovers', () => {
  const f = withoutGenericParentFields(setup());
  const token = definitions.captureCurrentAncillaryParentDefinition(selectedStarter, f.binding, () => {});
  for (const imported of [{}, structuredClone(token), JSON.parse(JSON.stringify(token))]) {
    f.parents[0].definition = imported;
    assert.throws(() => select(f), /context/iu);
  }
  f.parents[0].definition = definitions.captureCurrentAncillaryParentDefinition(selectedStarter, f.binding, () => {});
  assert.ok(select(f).nodeIds.length);
});
test('current selected definition is bound to document epoch and exact parent instance role map', () => {
  const f = withoutGenericParentFields(setup());
  let stale = false;
  const token = definitions.captureCurrentAncillaryParentDefinition(selectedStarter, f.binding, () => {
    if (stale) throw new Error('stale current document');
  });
  f.parents[0].definition = token;
  stale = true;
  assert.throws(() => select(f), /stale current document/iu);
  stale = false;
  const other = setup();
  other.binding.parentRoleNodes = Object.fromEntries(
    Object.entries(other.binding.parentRoleNodes).map(([role, id]) => [role, `other-${id}`]),
  );
  assert.throws(() => definitions.remapCurrentAncillaryParentDefinition(token, other.binding, f.binding), /remap/iu);
  const changed = structuredClone(f.binding);
  changed.parentRoleNodes.prompt = 'foreign-instance';
  f.binding.parentRoleNodes = changed.parentRoleNodes;
  assert.throws(() => select(f), /context/iu);
});
for (const [name, mutate] of [
  [
    'pipeline',
    (s) => {
      s.pipelineClass = 'OtherPipeline';
    },
  ],
  [
    'task',
    (s) => {
      s.task = 'other_task';
    },
  ],
  [
    'recipe digest',
    (s) => {
      s.authoring.contentHash = 'studio-authoring-v1-00000000';
    },
  ],
  [
    'operation selector',
    (s) => {
      s.nodes[0].operation.task = 'other_task';
    },
  ],
  [
    'registered node identity',
    (s) => {
      s.nodes[0].node.action = 'Other';
    },
  ],
])
  test(`selected parent definition rejects wrong ${name}`, () => {
    const f = setup(),
      wrong = structuredClone(selectedStarter);
    mutate(wrong);
    assert.throws(
      () => definitions.captureCurrentAncillaryParentDefinition(wrong, f.binding, () => {}),
      /Invalid|differ|hash/iu,
    );
  });
test('native effective-leaf ID remapping preserves a fresh definition but refuses collisions', () => {
  const f = withoutGenericParentFields(setup()),
    original = structuredClone(f.binding);
  const token = definitions.captureCurrentAncillaryParentDefinition(selectedStarter, original, () => {});
  const next = structuredClone(original);
  next.parentRoleNodes = Object.fromEntries(
    Object.entries(original.parentRoleNodes).map(([role, id]) => [role, `unpacked-${id}`]),
  );
  const bad = structuredClone(next);
  bad.parentRoleNodes.prompt = bad.parentRoleNodes.models;
  assert.throws(() => definitions.remapCurrentAncillaryParentDefinition(token, original, bad), /collid/iu);
  const remapped = definitions.remapCurrentAncillaryParentDefinition(token, original, next);
  const ids = new Map(
    Object.keys(original.parentRoleNodes).map((role) => [original.parentRoleNodes[role], next.parentRoleNodes[role]]),
  );
  for (const node of f.nodes) node.id = ids.get(node.id) ?? node.id;
  for (const edge of f.edges) {
    edge.source = ids.get(edge.source) ?? edge.source;
    edge.target = ids.get(edge.target) ?? edge.target;
  }
  f.binding.parentRoleNodes = next.parentRoleNodes;
  f.parents[0].definition = remapped;
  assert.deepEqual(select(f).nodeIds.sort(), Object.values(next.parentRoleNodes).sort());
});

for (const [name, change] of [
  [
    'profile',
    (binding) => {
      binding.parent.executionProfileId = 'wrong:profile';
    },
  ],
  [
    'spec digest',
    (binding) => {
      binding.parent.baseSpecContentHash = 'studio-spec-v1-00000000';
    },
  ],
  [
    'role vocabulary',
    (binding) => {
      delete binding.parentRoleNodes.prompt;
      binding.parentRoleNodes.other = 'main-prompt';
    },
  ],
  [
    'colliding roles',
    (binding) => {
      binding.parentRoleNodes.prompt = binding.parentRoleNodes.models;
    },
  ],
])
  test(`selected parent definition rejects wrong bound ${name}`, () => {
    const f = setup(),
      binding = structuredClone(f.binding);
    change(binding);
    assert.throws(
      () => definitions.captureCurrentAncillaryParentDefinition(selectedStarter, binding, () => {}),
      /Invalid|differ|collid|role/iu,
    );
  });
test('selected parent output direction cannot authorize an authored input', () => {
  const f = withoutGenericParentFields(setup()),
    wrong = structuredClone(selectedStarter);
  const ownerKey = `${f.owner.data.module}.${f.owner.data.action}`;
  wrong.nodes.find(({ operation }) => operation.nodeKey === ownerKey).node.params[
    f.contract.bindings.owner.promptField
  ].display = 'output';
  f.parents[0].definition = definitions.captureCurrentAncillaryParentDefinition(wrong, f.binding, () => {});
  assert.throws(() => select(f), /registered/iu);
});
