import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { canonicalGraphIdentity } from './live-proof-provenance.mjs';

const backend = resolve(process.env.MODIFF_BACKEND_DIR ?? '../MoDiff');
let server, flow, studio, packages, groups, blocks, specs, hash;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1' },
    localStorage: globalThis.localStorage,
    dispatchEvent: () => true,
  };
  globalThis.fetch = () => {
    throw new Error('Saved workflow compatibility tests cannot access the network.');
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  flow = (await server.ssrLoadModule('/src/stores/useFlowStore.ts')).useFlowStore;
  studio = (await server.ssrLoadModule('/src/stores/useStudioStore.ts')).useStudioStore;
  packages = await server.ssrLoadModule('/src/studio/workflowPackage.ts');
  groups = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  blocks = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  specs = await server.ssrLoadModule('/src/studio/executionSpecs.ts');
  hash = await server.ssrLoadModule('/src/studio/stableHash.ts');
});
after(async () => server?.close());

const recipeAction = 'DiffusersExecutionRecipe';
function attention(api) {
  const recipe = Object.values(api.nodes).find(({ action }) => action === recipeAction);
  assert.ok(recipe?.params.attention_backend);
  return recipe.params.attention_backend;
}
function exportGraph(sourceGraph) {
  return flow.getState().exportGraph('test', undefined, { sourceGraph, randomizeSeeds: false });
}
function openWorkflow(value) {
  const pkg = packages.parseWorkflowPackage(value);
  assert.ok(pkg, 'The normal workflow parser must accept the saved document.');
  studio.getState().createWorkflowTab(pkg.title, pkg.snapshot, 'import', pkg.sourceLabel);
  const { nodes, edges, viewport } = flow.getState();
  return { nodes, edges, viewport };
}
function compareOnlyAttention(before, after) {
  assert.equal(attention(before).value, '_native_math');
  assert.equal(attention(after).value, 'auto');
  const reverted = structuredClone(after);
  attention(reverted).value = '_native_math';
  assert.equal(canonicalGraphIdentity(reverted).hash, canonicalGraphIdentity(before).hash);
}
function savedPreset(folder, modelType, options = {}) {
  const graph = JSON.parse(readFileSync(join(backend, 'data/graphs/studio', folder, 'unconditional-image.json')));
  const recipe = graph.nodes.find(({ data }) => data.action === recipeAction);
  const loader = graph.nodes.find(({ data }) => data.action === 'LoadPipeline');
  recipe.data.params.attention_backend.value = '_native_math';
  if (options.otherRevision) loader.data.params.revision.value = 'a'.repeat(40);
  const grouped = groups.groupNewOperationGraph(graph);
  if (options.explicit) {
    const setup = grouped.nodes.find(({ data }) =>
      data.blockInstanceV2?.definitionSnapshot.source.provider.endsWith('/setup'),
    );
    const instance = setup.data.blockInstanceV2;
    const control = instance.effectiveInterface.controls.find(({ binding }) => binding.fieldId === 'attention_backend');
    setup.data.blockInstanceV2 = blocks.setBlockInstanceValueV2(instance, control.controlId, '_native_math');
  }
  return { graph: grouped, metadata: { studio: { mode: 'unconditional_image', modelType, resourceMode: 'expert' } } };
}

test('older stages restore tested defaults while explicit attention and unreviewed pins are preserved', () => {
  for (const [folder, modelType] of [
    ['ddpm-pipeline', 'DDPMPipeline'],
    ['consistency-model-pipeline', 'ConsistencyModelPipeline'],
  ]) {
    const value = savedPreset(folder, modelType);
    const restored = openWorkflow(value);
    compareOnlyAttention(exportGraph(value.graph), exportGraph(restored));
    assert.equal(
      canonicalGraphIdentity(exportGraph(openWorkflow({ ...value, graph: restored }))).hash,
      canonicalGraphIdentity(exportGraph(restored)).hash,
    );
    for (const options of [{ explicit: true }, { otherRevision: true }]) {
      const custom = savedPreset(folder, modelType, options);
      assert.equal(attention(exportGraph(openWorkflow(custom))).value, '_native_math');
    }
  }
});

test('restored managed receipts use current authoring while keeping the original exact Run identity', () => {
  const archives = ['unconditional', 'video-attention'].flatMap(
    (kind) => JSON.parse(readFileSync(join(backend, `data/${kind}-studio-spec-compatibility.v1.json`))).specifications,
  );
  const manifest = JSON.parse(readFileSync(join(backend, 'data/workflow-library-manifest.json')));
  const paths = new Map(manifest.workflows.map(({ id, graphPath }) => [id, graphPath]));
  for (const { specification: previous } of archives) {
    const { contentHash, ...semantic } = previous;
    const current = {
      ...semantic,
      bindings: semantic.bindings.map(([role, field, source]) => [
        role,
        field,
        role === 'diffusersRecipe' && field === 'attention_backend' ? 'attentionBackend' : source,
      ]),
    };
    current.contentHash = `studio-spec-v1-${hash.hashString(hash.stableStringify(current))}`;
    const capabilities = [
      {
        modelType: previous.modelType,
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: [previous.mode],
        studioExecutionSpecs: [current],
      },
    ];
    const graphPath = paths.get(`${previous.modelType}:${previous.mode}`);
    assert.ok(graphPath, previous.id);
    const graph = JSON.parse(readFileSync(join(backend, 'data/graphs', graphPath)));
    graph.nodes.find(({ data }) => data.action === recipeAction).data.params.attention_backend.value = '_native_math';
    const device = graph.nodes.find(({ data }) => data.action === recipeAction).data.params.device.value;
    const nodes = Object.fromEntries(graph.nodes.map(({ data, id }) => [data.studioRole, id]));
    const form = {
      mode: previous.mode,
      modelType: previous.modelType,
      resourceMode: 'expert',
      quantizationMode: 'none',
      device,
      offloadMode: 'none',
    };
    const identity = {
      schemaVersion: 1,
      id: previous.id,
      contentHash,
      executionProfileId: previous.executionProfileId,
    };
    const binding = {
      mode: form.mode,
      modelType: form.modelType,
      nodes,
      executionSpec: identity,
      managedNodeIds: graph.nodes.map(({ id }) => id),
      managedEdgeIds: graph.edges.map(({ id }) => id),
      fingerprint: `${form.mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}:${previous.id}:${contentHash}`,
      createdAt: 1,
      updatedAt: 1,
    };
    const value = { graph, metadata: { studio: form }, restore: { graphBindingSnapshot: binding } };
    const restored = openWorkflow(value);
    const active = studio.getState().graphBinding;
    assert.deepEqual(active.executionSpec, identity);
    assert.equal(active.fingerprint, binding.fingerprint);
    if (previous.mode === 'unconditional_image') {
      compareOnlyAttention(exportGraph(graph), exportGraph(restored));
    } else {
      const before = exportGraph(graph);
      const after = exportGraph(restored);
      assert.equal(attention(after).value, '_native_math');
      assert.equal(canonicalGraphIdentity(after).hash, canonicalGraphIdentity(before).hash);
    }
    assert.equal(specs.exactStudioExecutionSpecForBinding(capabilities, false, active), current);
    assert.deepEqual(specs.studioExecutionSpecRuntimeReceipt(active, capabilities), {
      schemaVersion: 1,
      id: previous.id,
      contentHash,
      nodes,
    });
    for (const changes of [{ contentHash: 'studio-spec-v1-ffffffff' }, { executionProfileId: 'unknown' }]) {
      const unknown = { ...active, executionSpec: { ...identity, ...changes } };
      assert.throws(() => specs.studioExecutionSpecRuntimeReceipt(unknown, capabilities), /stale/);
    }
    const explicit = { ...value, metadata: { studio: { ...form, attentionBackend: '_native_math' } } };
    assert.equal(attention(exportGraph(openWorkflow(explicit))).value, '_native_math');
  }
});

const originalArchive = process.env.MODIFF_SAVED_ATTENTION_WORKFLOW;
test(
  'the original failing saved workflow opens, exports and reopens without changing the archive',
  { skip: !originalArchive },
  () => {
    const original = readFileSync(originalArchive);
    const saved = JSON.parse(original);
    const restored = openWorkflow(saved);
    const current = exportGraph(restored);
    compareOnlyAttention(saved.apiGraph, current);
    assert.equal(
      canonicalGraphIdentity(exportGraph(openWorkflow({ ...saved, graph: restored }))).hash,
      canonicalGraphIdentity(current).hash,
    );
    assert.equal(
      createHash('sha256').update(readFileSync(originalArchive)).digest('hex'),
      createHash('sha256').update(original).digest('hex'),
    );
  },
);
