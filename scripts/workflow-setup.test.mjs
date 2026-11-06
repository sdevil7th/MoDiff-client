import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, runtimes, setup, flow, nodes, studio;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    localStorage,
    sessionStorage: localStorage,
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  runtimes = await server.ssrLoadModule('/src/studio/optionalRuntimes.ts');
  setup = await server.ssrLoadModule('/src/studio/workflowSetup.ts');
  ({ useFlowStore: flow } = await server.ssrLoadModule('/src/stores/useFlowStore.ts'));
  ({ useNodesStore: nodes } = await server.ssrLoadModule('/src/stores/useNodeStore.ts'));
  ({ useStudioStore: studio } = await server.ssrLoadModule('/src/stores/useStudioStore.ts'));
});

const base = {
  schemaVersion: 1,
  delivery: 'base',
  requiredNow: false,
  profileIds: [],
  executionProfileIds: [],
  state: 'base_satisfied',
  reason: 'base_runtime',
};
const hash = 'sha256:workflow-auto-v1:' + 'a'.repeat(64);
const model = (revision) => ({
  module: 'modules.Test',
  action: 'Load',
  params: {
    model_id: { value: { source: 'hub', value: 'owner/model' } },
    revision: { value: revision },
  },
});

test('shared artifacts deduplicate by exact revision while a second immutable selection stays separate', () => {
  const graph = {
    nodes: { a: model('a'.repeat(40)), b: model('a'.repeat(40)), c: model('b'.repeat(40)) },
    paths: [['a'], ['b'], ['c']],
  };
  const requirements = setup.workflowSetupArtifacts(graph);
  assert.equal(requirements.length, 2);
  assert.deepEqual(
    requirements.map((row) => row.installTarget.revision),
    ['a'.repeat(40), 'b'.repeat(40)],
  );
  graph.nodes.c.params.model_id = { sourceId: 'a', sourceKey: 'model', value: 'unrelated/default' };
  assert.equal(setup.workflowSetupArtifacts(graph).length, 1);
});

test('malformed, duplicate and unbounded setup observations never become ready', () => {
  const good = {
    schemaVersion: 1,
    instance: 'worker',
    graphHash: hash,
    requirements: [{ nodeIds: ['a'], requirement: base }],
  };
  assert.equal(setup.parseWorkflowSetup(good).requirements[0].requirement.delivery, 'base');
  for (const bad of [
    { ...good, instance: '' },
    { ...good, graphHash: 'forged' },
    { ...good, requirements: [...good.requirements, ...good.requirements] },
    { ...good, requirements: [{ nodeIds: ['a'], requirement: { ...base, state: 'active' } }] },
  ])
    assert.throws(() => setup.parseWorkflowSetup(bad));
});

test('exact cached artifacts remain ready and another revision retains its repair requirement', () => {
  const graph = { nodes: { a: model('a'.repeat(40)) }, paths: [['a']] };
  const previous = nodes.getState().hfCache;
  nodes.setState({ hfCache: [{ id: 'owner/model', planned_revision: 'a'.repeat(40), complete: true }] });
  try {
    const ready = setup.workflowSetupArtifacts(graph)[0];
    assert.equal(ready.status.runnable, true);
    assert.equal(ready.primaryAction, 'Ready');
    assert.equal(ready.revision, 'a'.repeat(40));
    graph.nodes.a.params.revision.value = 'b'.repeat(40);
    const incomplete = setup.workflowSetupArtifacts(graph)[0];
    assert.equal(incomplete.status.runnable, false);
    assert.equal(incomplete.primaryAction, 'Repair');
    assert.equal(incomplete.installTarget.revision, 'b'.repeat(40));
  } finally {
    nodes.setState({ hfCache: previous });
  }
});

test('a repository job is never relabelled as another revision or unreported file selection', () => {
  const job = { repo_id: 'owner/model', status: 'downloading', revision: 'a'.repeat(40), total_bytes: 123 };
  assert.deepEqual(setup.workflowSetupDownload({ revision: 'a'.repeat(40) }, job), { progress: job, blocked: false });
  for (const requirement of [{ revision: 'b'.repeat(40) }, { revision: 'a'.repeat(40), files: ['one.safetensors'] }]) {
    assert.deepEqual(setup.workflowSetupDownload(requirement, job), { progress: undefined, blocked: true });
    assert.equal(setup.workflowSetupDownload(requirement, { ...job, status: 'complete' }).blocked, false);
  }
});

test('inspection uses selected Run dependency closure without seeds, installs, field actions or graph submission', async () => {
  const make = (id, params = {}, disabled = false) => ({
    id,
    position: { x: 0, y: 0 },
    type: 'custom',
    data: {
      type: 'custom',
      module: 'modules.Test',
      action: 'Load',
      label: id,
      category: '',
      params,
      uiState: { disabled },
    },
  });
  flow.getState().replaceGraph({
    nodes: [
      make('input', { seed: { value: { value: 17, isRandom: true } }, output: { display: 'output' } }),
      make('output', { input: { display: 'input' } }),
      make('unrelated', model('b'.repeat(40)).params),
      make('disabled', {}, true),
    ],
    edges: [{ id: 'wire', source: 'input', sourceHandle: 'output', target: 'output', targetHandle: 'input' }],
  });
  studio.setState({ form: { ...studio.getState().form, resourceMode: 'expert' } });
  nodes.setState({ instance: 'worker' });
  const original = JSON.stringify(flow.getState().toObject());
  const oldFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/runtime\/workflow-setup$/);
    requests.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        instance: 'worker',
        graphHash: hash,
        requirements: [{ nodeIds: Object.keys(requests.at(-1).graph.nodes), requirement: base }],
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  try {
    const result = await setup.inspectWorkflowSetup('output');
    assert.deepEqual(Object.keys(result.graph.nodes).sort(), ['input', 'output']);
    assert.equal(requests.length, 1);
    assert.equal(JSON.stringify(flow.getState().toObject()), original);
    globalThis.fetch = async () => {
      nodes.setState({ instance: 'another-worker' });
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          instance: 'worker',
          graphHash: hash,
          requirements: [{ nodeIds: ['input', 'output'], requirement: base }],
        }),
      );
    };
    await assert.rejects(() => setup.inspectWorkflowSetup('output'), /backend or execution scope changed/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
after(async () => server?.close());

const digest = 'sha256:' + 'a'.repeat(64);
const profile = (id, overlayStatus = 'active') => ({
  id,
  specDigest: digest,
  overlayStatus,
  contractState: 'qualified',
  cutoverReady: true,
  status: 'missing',
});

test('runtime status prioritizes recovery and does not call an unqualified stage installed and ready', () => {
  const staged = profile('codec', 'staged');
  assert.match(
    runtimes.optionalRuntimeSetupStatus(
      staged,
      { processLoadStatus: 'repair_required', activeOptionalRuntimeSpecs: [] },
      true,
    ),
    /repair required/,
  );
  assert.match(
    runtimes.optionalRuntimeSetupStatus(
      { ...staged, contractState: 'candidate_unqualified', cutoverReady: false },
      { processLoadStatus: 'base', activeOptionalRuntimeSpecs: [] },
      true,
    ),
    /unavailable/,
  );
  const active = profile('codec');
  const catalog = {
    processLoadStatus: 'active',
    activeOptionalRuntimeSpecs: [{ profileId: 'codec', specDigest: digest }],
  };
  assert.match(runtimes.optionalRuntimeSetupStatus(active, catalog, false), /verifying worker readiness/);
  assert.match(runtimes.optionalRuntimeSetupStatus(active, catalog, true), /active — verified/);
  assert.match(
    runtimes.optionalRuntimeSetupStatus(active, { ...catalog, activeOptionalRuntimeSpecs: [] }, true),
    /unavailable/,
  );
});

test('a workflow needing two runtime contracts is not ready when only one is active', () => {
  const requirement = { requiredNow: true, state: 'active', profileIds: ['codec', 'quantizer'] };
  const catalog = {
    processLoadStatus: 'active',
    profiles: [profile('codec'), profile('quantizer', 'staged')],
    activeOptionalRuntimeSpecs: [{ profileId: 'codec', specDigest: digest }],
  };
  assert.equal(runtimes.optionalRuntimeBlockState(requirement, catalog), 'staged');
  catalog.profiles[1].overlayStatus = 'active';
  catalog.activeOptionalRuntimeSpecs.push({ profileId: 'quantizer', specDigest: digest });
  assert.equal(runtimes.optionalRuntimeBlockState(requirement, catalog), null);
  catalog.activeOptionalRuntimeSpecs[1].specDigest = 'sha256:' + 'b'.repeat(64);
  assert.equal(runtimes.optionalRuntimeBlockState(requirement, catalog), 'unavailable');
});
