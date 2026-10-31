import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';

const ROOT = process.cwd();
const cache = mkdtempSync(path.join(tmpdir(), 'modiff-ancillary-operations-'));
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/ancillary-authoring.v1.json'), 'utf8'));
let server, api, parse, hashes, remap;
before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    cacheDir: cache,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  api = await server.ssrLoadModule('/src/studio/ancillaryOperations.ts');
  ({ parseOperationAuthoringRecipe: parse } = await server.ssrLoadModule('/src/studio/operationAuthoringRecipe.ts'));
  hashes = await server.ssrLoadModule('/src/studio/stableHash.ts');
  ({ remapOperationAuthoring: remap } = await server.ssrLoadModule('/src/workflow/operationSharedInputs.ts'));
});
after(async () => {
  await server?.close();
  rmSync(cache, { recursive: true, force: true });
});
const raw = (index = 0) => JSON.parse(fixture.parents[index].rawParentJson);
const authoredConstraint = JSON.parse(
  readFileSync('tests/fixtures/authored-layout-constraint.v1.json', 'utf8'),
).contract;
function rehash(parent) {
  for (const child of parent.ancillaryOperations ?? []) {
    delete child.contentHash;
    child.contentHash = `studio-ancillary-v1-${hashes.hashString(hashes.stableStringify(child))}`;
  }
  delete parent.contentHash;
  parent.contentHash = `studio-authoring-v1-${hashes.hashString(hashes.stableStringify(parent))}`;
  return parent;
}
function binding() {
  const parent = raw(),
    child = parent.ancillaryOperations[0];
  return {
    contractId: child.id,
    contentHash: child.contentHash,
    parent: { ...child.parent, authoringContentHash: parent.contentHash },
    parentRoleNodes: Object.fromEntries(parent.roles.map(([role]) => [role, `main:${role}`])),
    roleNodes: Object.fromEntries(child.roles.map(([role]) => [role, `aux:${role}`])),
  };
}
test('a constrained ancillary requires its hash-covered source contract and exact native operation', () => {
  const captured = JSON.parse(
    readFileSync('tests/fixtures/evaluation-prompt-enhancement-alternatives.v1.json', 'utf8'),
  );
  const starter = captured.starters.find(
    (row) => row.task === 'text_to_image' && row.authoring.ancillaryOperations[0].layoutPolicy,
  );
  const parent = structuredClone(starter.authoring);
  const child = parent.ancillaryOperations[0];
  child.layoutPolicy = authoredConstraint.layoutPolicy;
  child.authoredLayoutConstraint = structuredClone(authoredConstraint);
  child.initialValues.find(
    ([role, field]) =>
      role === child.verification.requestInputs.role && field === child.verification.requestInputs.operationField,
  )[2] = authoredConstraint.operation;
  rehash(parent);
  const context = { ...child.parent, parentRoles: parent.roles.map(([role]) => role) };
  assert.deepEqual(api.parseAncillaryOperations(parent.ancillaryOperations, context), parent.ancillaryOperations);
  for (const mutate of [
    (item) => {
      delete item.authoredLayoutConstraint;
    },
    (item) => {
      item.layoutPolicy = 'append-details-preserve-layout-v1';
    },
    (item) => {
      item.authoredLayoutConstraint.revision = 'a'.repeat(40);
    },
    (item) => {
      item.authoredLayoutConstraint.transformersVersion = '0.0.0';
    },
    (item) => {
      item.initialValues.find(
        ([role, field]) =>
          role === item.verification.requestInputs.role && field === item.verification.requestInputs.operationField,
      )[2] = 'enhance_prompt';
    },
    (item) => {
      item.authoredLayoutConstraint.extra = true;
    },
  ]) {
    const changed = structuredClone(parent);
    mutate(changed.ancillaryOperations[0]);
    rehash(changed);
    assert.throws(() => api.parseAncillaryOperations(changed.ancillaryOperations, context));
  }
});

test('constraint metadata stays bounded and cannot execute accessors or widen token/deadline scope', async () => {
  const { parseAuthoredLayoutConstraint } = await server.ssrLoadModule('/src/studio/promptEnhancementConstraints.ts');
  assert.deepEqual(parseAuthoredLayoutConstraint(authoredConstraint), authoredConstraint);
  for (const mutate of [
    (item) => {
      item.limits.lookup_seconds = 3;
    },
    (item) => {
      item.limits.max_new_tokens = 3585;
    },
    (item) => {
      item.deadlineSeconds = 1801;
    },
    (item) => {
      item.preparationRamBytes = 268435457;
    },
    (item) => {
      delete item.sourcePreTokenizerSha256;
    },
    (item) => {
      item.effectivePreTokenizerSha256 = false;
    },
    (item) => {
      item.reservedAddedTokenIds[0] = 0;
    },
    (item) => {
      item.effectiveEosTokenIds[0] = 1;
    },
    (item) => {
      item.artifacts[0].path = '../tokenizer.json';
    },
    (item) => {
      item.artifacts[0].byteSize = true;
    },
    (item) => {
      Object.defineProperty(item, 'limits', { enumerable: true, get: () => assert.fail('No getter may execute') });
    },
    (item) => {
      Object.defineProperty(item.artifacts, '0', { enumerable: true, get: () => assert.fail('No getter may execute') });
    },
  ]) {
    const bad = structuredClone(authoredConstraint);
    mutate(bad);
    assert.throws(() => parseAuthoredLayoutConstraint(bad), /constraint contract/);
  }
});
for (const [index, row] of fixture.parents.entries()) {
  test(`actual captured parent ${index + 1} retains exact optional child/hash`, () =>
    assert.deepEqual(parse(raw(index), row.selection), raw(index)));
  test(`absent child ${index + 1} retains the historical parent hash domain`, () => {
    const parent = raw(index);
    delete parent.ancillaryOperations;
    rehash(parent);
    assert.deepEqual(parse(parent, row.selection), parent);
    assert.equal(Object.hasOwn(parse(parent, row.selection), 'ancillaryOperations'), false);
  });
}
for (const [name, mutate] of [
  [
    'null claim',
    (p) => {
      p.ancillaryOperations = null;
    },
  ],
  [
    'empty claim',
    (p) => {
      p.ancillaryOperations = [];
    },
  ],
  [
    'too many children',
    (p) => {
      p.ancillaryOperations = Array(5).fill(p.ancillaryOperations[0]);
    },
  ],
  [
    'unknown child key',
    (p) => {
      p.ancillaryOperations[0].extra = true;
    },
  ],
  [
    'wrong parent task',
    (p) => {
      p.ancillaryOperations[0].parent.task = 'foreign';
    },
  ],
  [
    'wrong base identity',
    (p) => {
      p.ancillaryOperations[0].parent.baseSpecContentHash = 'studio-spec-v1-00000000';
    },
  ],
  [
    'unsupported purpose',
    (p) => {
      p.ancillaryOperations[0].executionPurpose = 'workflow';
    },
  ],
  [
    'source authority',
    (p) => {
      p.ancillaryOperations[0].sourceRegions = true;
    },
  ],
  [
    'duplicate roles',
    (p) => {
      p.ancillaryOperations[0].roles.push(p.ancillaryOperations[0].roles[0]);
    },
  ],
  [
    'foreign bound role',
    (p) => {
      p.ancillaryOperations[0].bindings.request.role = 'foreign';
    },
  ],
  [
    'identity initial value',
    (p) => {
      const c = p.ancillaryOperations[0];
      c.initialValues.push([c.roles[0][0], 'revision', 'a'.repeat(40)]);
    },
  ],
  [
    'adapter digest',
    (p) => {
      p.ancillaryOperations[0].adapter.declarationSha256 = 'a'.repeat(64);
    },
  ],
  [
    'cyclic edge',
    (p) => {
      const c = p.ancillaryOperations[0],
        e = c.edges[0];
      c.edges.push([e[2], 'cycle', e[0], 'cycle']);
    },
  ],
  [
    'duplicate input target',
    (p) => {
      const c = p.ancillaryOperations[0];
      c.edges.push(c.edges[0]);
    },
  ],
  [
    'nonfinite position',
    (p) => {
      p.ancillaryOperations[0].roles[0][2] = Infinity;
    },
  ],
  [
    'unpaired Unicode',
    (p) => {
      p.ancillaryOperations[0].initialValues[0][2] = '\ud800';
    },
  ],
])
  test(`closed metadata refuses ${name}`, () => {
    const p = raw();
    mutate(p);
    rehash(p);
    assert.throws(() => parse(p, fixture.parents[0].selection));
  });
test('stale child and parent hashes each refuse independently', () => {
  const p = raw();
  p.ancillaryOperations[0].contentHash = 'studio-ancillary-v1-00000000';
  assert.throws(() => parse(p, fixture.parents[0].selection));
  const q = raw();
  q.contentHash = 'studio-authoring-v1-00000000';
  assert.throws(() => parse(q, fixture.parents[0].selection));
});
test('multiline nonidentity initial values remain exact finite JSON', () => {
  const p = raw(),
    c = p.ancillaryOperations[0];
  c.initialValues.push([c.roles[0][0], 'note', 'line one\nline two\tunchanged']);
  rehash(p);
  assert.deepEqual(parse(p, fixture.parents[0].selection), p);
});
test('claims with accessors, symbols, inherited or hidden properties fail without executing code', () => {
  for (const decorate of [
    (p) =>
      Object.defineProperty(p, 'ancillaryOperations', {
        get() {
          throw Error('getter executed');
        },
        enumerable: true,
      }),
    (p) => {
      const value = p.ancillaryOperations;
      delete p.ancillaryOperations;
      Object.setPrototypeOf(p, { ancillaryOperations: value });
    },
    (p) => Object.defineProperty(p, 'ancillaryOperations', { value: p.ancillaryOperations, enumerable: false }),
    (p) => {
      p.ancillaryOperations[0][Symbol('foreign')] = true;
    },
  ]) {
    const p = raw();
    decorate(p);
    assert.throws(() => parse(p, fixture.parents[0].selection));
  }
});
test('both maps and archived draft hints remap through the existing graph ID function', () => {
  const b = binding(),
    hint = { schemaVersion: 1, ancillaryBindings: [b], customLabel: 'retained' };
  const value = {
    ...hint,
    inactiveDrafts: [
      {
        nodes: [{ id: 'saved', parentId: 'container', data: { operationAuthoring: hint } }],
        edges: [{ source: 'saved', target: 'peer' }],
      },
    ],
  };
  const result = remap(value, (id) => `copy/${id}`);
  for (const map of ['parentRoleNodes', 'roleNodes']) {
    const expected = Object.fromEntries(Object.entries(b[map]).map(([role, id]) => [role, `copy/${id}`]));
    assert.deepEqual(result.ancillaryBindings[0][map], expected);
    assert.deepEqual(result.inactiveDrafts[0].nodes[0].data.operationAuthoring.ancillaryBindings[0][map], expected);
  }
  assert.equal(result.customLabel, 'retained');
  assert.equal(result.inactiveDrafts[0].nodes[0].id, 'copy/saved');
  assert.deepEqual(value.ancillaryBindings[0], b);
});
for (const [name, mutate] of [
  ['null', () => null],
  ['empty', () => []],
  ['duplicate contracts', (b) => [b, b]],
  [
    'colliding maps',
    (b) => {
      b.roleNodes[Object.keys(b.roleNodes)[0]] = Object.values(b.parentRoleNodes)[0];
      return [b];
    },
  ],
  ['foreign field', (b) => [{ ...b, unknown: true }]],
  ['malformed hash', (b) => [{ ...b, contentHash: 'bad' }]],
  [
    'oversized native identity',
    (b) => {
      b.roleNodes[Object.keys(b.roleNodes)[0]] = 'x'.repeat(513);
      return [b];
    },
  ],
])
  test(`instance claim refuses ${name}`, () =>
    assert.throws(() => remap({ ancillaryBindings: mutate(binding()) }, (id) => id)));
test('malformed inherited/accessor binding claims cannot downgrade to legacy hints', () => {
  const inherited = Object.create({ ancillaryBindings: [binding()] });
  assert.throws(() => api.ancillaryBindingsFromHint(inherited));
  assert.throws(() =>
    api.ancillaryBindingsFromHint(
      Object.defineProperty({}, 'ancillaryBindings', {
        enumerable: true,
        get() {
          throw Error('getter executed');
        },
      }),
    ),
  );
});
test('remapping collisions are refused; legacy hints without a claim stay unchanged', () => {
  assert.throws(() => remap({ ancillaryBindings: [binding()] }, () => 'collision'));
  const old = {
    schemaVersion: 1,
    defaults: { prompt: 'raw' },
    retained: [],
    sharedInputs: [{ field: 'seed', loaderId: 'source', groupId: 'g', name: 'seed' }],
  };
  assert.deepEqual(
    remap(old, (id) => `copy/${id}`),
    { ...old, sharedInputs: [{ ...old.sharedInputs[0], loaderId: 'copy/source' }] },
  );
});

test('accessor array claims never execute and malformed array hints cannot downgrade', () => {
  const parent = raw(),
    children = parent.ancillaryOperations;
  Object.defineProperty(children, '0', {
    enumerable: true,
    get() {
      throw Error('getter executed');
    },
  });
  assert.throws(() => parse(parent, fixture.parents[0].selection), /data array members/u);
  const hint = [];
  hint.ancillaryBindings = [binding()];
  assert.throws(() => remap(hint, (id) => id), /object hint/u);
});

test('saved workflow hints do not eagerly load declaration or enhancement planners', async () => {
  const boundary = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  try {
    await boundary.ssrLoadModule('/src/workflow/operationAuthoringHint.ts');
    await boundary.ssrLoadModule('/src/workflow/operationSharedInputs.ts');
    const evaluated = [...boundary.moduleGraph.idToModuleMap.values()]
      .filter((module) => module.ssrModule)
      .map((module) => module.id?.replaceAll('\\', '/'));
    for (const deferred of ['ancillaryOperations.ts', 'promptEnhancementAuthoring.ts']) {
      assert.equal(
        evaluated.some((id) => id?.endsWith(`/src/studio/${deferred}`)),
        false,
        deferred,
      );
    }
    const bindings = await boundary.ssrLoadModule('/src/studio/ancillaryBindings.ts');
    const declaration = await boundary.ssrLoadModule('/src/studio/ancillaryOperations.ts');
    for (const key of ['parseAncillaryBindings', 'ancillaryBindingsFromHint', 'invalidAncillary'])
      assert.equal(declaration[key], bindings[key], `shared implementation: ${key}`);
    const parent = await boundary.ssrLoadModule('/src/studio/promptEnhancementParent.ts');
    const planner = await boundary.ssrLoadModule('/src/studio/promptEnhancementAuthoring.ts');
    for (const key of [
      'parsePromptEnhancementParent',
      'promptEnhancementParentFromHint',
      'remapPromptEnhancementParent',
    ])
      assert.equal(planner[key], parent[key], `shared implementation: ${key}`);
  } finally {
    await boundary.close();
  }
});
