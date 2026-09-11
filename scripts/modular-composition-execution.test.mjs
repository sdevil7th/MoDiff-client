import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server,
  lowering,
  schema,
  runtime,
  persistence,
  library,
  snapshot,
  entries,
  diagnostics,
  repair,
  contextCompatibility,
  loopDiagnostics,
  loopRepair,
  reparenting;
before(async () => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:8088' } };
  server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null } });
  lowering = await server.ssrLoadModule('/src/studio/modularComposition.ts');
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  persistence = await server.ssrLoadModule('/src/studio/blockDefinitionPersistenceV2.ts');
  diagnostics = await server.ssrLoadModule('/src/studio/reviewedStateDiagnosticsV2.ts');
  repair = await server.ssrLoadModule('/src/studio/reviewedStateRepairV2.ts');
  contextCompatibility = await server.ssrLoadModule('/src/studio/reviewedBlockContextV2.ts');
  loopDiagnostics = await server.ssrLoadModule('/src/studio/reviewedLoopDiagnosticsV2.ts');
  loopRepair = await server.ssrLoadModule('/src/studio/reviewedLoopRepairV2.ts');
  reparenting = await server.ssrLoadModule('/src/studio/blockReparentingV2.ts');
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./run-python.mjs', import.meta.url)),
      '-c',
      'import json; from modiff.huggingface_node_library import reviewed_huggingface_node_library; print(json.dumps(reviewed_huggingface_node_library()))',
    ],
    { cwd: '../MoDiff', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr);
  library = JSON.parse(result.stdout);
  snapshot = JSON.parse(readFileSync('../MoDiff/data/modular-conditional-contracts.json', 'utf8'));
  entries = JSON.parse(gunzipSync(readFileSync('../MoDiff/modiff/registered_block_v2_catalog.v1.json.gz'))).entries;
});
after(async () => {
  await server?.close();
  delete globalThis.window;
});

function qwen() {
  const entry = entries.find((e) => e.catalogDefinitionId === 'diffusers.modular:QwenImageModularPipeline:text2image');
  assert.ok(entry);
  return schema.createBlockInstanceV2(entry.definition, {
    instanceId: 'demo',
    position: { x: 0, y: 0 },
    size: { width: 420, height: 560 },
  });
}

function insertedTextInput(instance) {
  const original = instance.effectiveGraph.nodes.find(
    (n) => n.modularDiffusers?.blockClass === 'QwenImageTextInputsStep',
  );
  assert.ok(original);
  const node = structuredClone(original);
  node.nodeId = 'added-text-input';
  const metadata = node.modularDiffusers;
  metadata.sourceDefinitionId = instance.definitionSnapshot.source.manifestDefinitionId;
  metadata.sourcePlacementPath = [...metadata.placementPath];
  metadata.sourceExecutionScope = 'unpruned_pipeline';
  metadata.placementPath[metadata.placementPath.length - 1] = 'demo_text_inputs';
  metadata.runtimeRole = `custom:${metadata.placementPath.join('/')}`;
  return runtime.addBlockEffectiveGraphNodeV2(instance, node);
}

test('cross-context compatibility follows requirements, not destination hierarchy membership', () => {
  const definition = snapshot.blockDefinitions.find((b) => b.className === 'ErnieImageSetTimestepsStep');
  const destination = { pipelineClass: 'QwenImageModularPipeline', libraryRevision: snapshot.diffusersRevision };
  const pipeline = snapshot.pipelines.find((p) => p.pipelineClass === destination.pipelineClass);
  assert.ok(!pipeline.placements.some((p) => p.blockDefinitionId === definition.id));
  const source = {
    pipelineClass: 'ErnieImageModularPipeline',
    libraryRevision: snapshot.diffusersRevision,
    blockDefinitionId: definition.id,
    blockContractHash: definition.contentHash,
  };
  assert.deepEqual(contextCompatibility.assessReviewedBlockContextV2(source, destination, snapshot), {
    status: 'compatible',
    issues: [],
  });
  const changed = structuredClone(snapshot);
  const root = changed.blockDefinitions.find((b) => b.id === pipeline.rootBlockDefinitionId);
  root.components.find((c) => c.name === 'scheduler').type = 'DifferentScheduler';
  const conflict = contextCompatibility.assessReviewedBlockContextV2(source, destination, changed);
  assert.equal(conflict.status, 'incompatible');
  assert.equal(conflict.issues[0].component, 'scheduler');
  assert.equal(
    contextCompatibility.reviewedBlockCanBeAuthoredV2(source, destination, changed),
    true,
    'incompatible drafts remain editable',
  );
  root.components = root.components.filter((c) => c.name !== 'scheduler');
  assert.equal(contextCompatibility.assessReviewedBlockContextV2(source, destination, changed).status, 'unresolved');
  assert.equal(contextCompatibility.reviewedBlockFitsContextV2(source, destination, changed), true);
  assert.equal(
    contextCompatibility.assessReviewedBlockContextV2({ ...source, blockContractHash: 'stale' }, destination, snapshot)
      .status,
    'unreviewed',
  );
});

test('reused node provenance never becomes the destination execution context', () => {
  const instance = qwen();
  const provenance = {
    pipelineClass: 'ErnieImageModularPipeline',
    workflowId: 'text2image',
    libraryRevision: snapshot.diffusersRevision,
  };
  const context = contextCompatibility.reviewedDestinationContextV2(instance, provenance);
  assert.equal(context.pipelineClass, 'QwenImageModularPipeline');
  const node = {
    nodeId: 'reused',
    nodeType: 'custom',
    modularDiffusers: provenance,
    data: {
      params: {
        pipeline_class: { value: provenance.pipelineClass },
        workflow_id: { value: provenance.workflowId },
        prompt: { value: 'Keep this' },
      },
    },
  };
  const once = contextCompatibility.bindReviewedNodeContextV2(node, context);
  const twice = contextCompatibility.bindReviewedNodeContextV2(
    once,
    contextCompatibility.reviewedDestinationContextV2(instance, once.modularDiffusers),
  );
  assert.deepEqual(twice, once);
  assert.deepEqual(twice.modularDiffusers, provenance);
  assert.equal(twice.data.params.pipeline_class.value, 'QwenImageModularPipeline');
  assert.equal(twice.data.params.prompt.value, 'Keep this');
  assert.equal(node.data.params.pipeline_class.value, provenance.pipelineClass);
});

test('broken loop drafts survive save/reload and retain exact member/socket diagnostics', () => {
  const instance = qwen();
  const definitions = [...library.blockDefinitions, ...snapshot.blockDefinitions];
  assert.deepEqual(loopDiagnostics.inspectReviewedLoopV2(instance, definitions), []);
  const member = instance.effectiveGraph.nodes.find(
    (node) => node.modularDiffusers?.blockClass === 'QwenImageLoopDenoiser',
  );
  const edge = instance.effectiveGraph.edges.find(
    (item) => item.targetNodeId === member.nodeId && item.targetPortId === 'loop_members_in',
  );
  assert.ok(edge);
  const broken = runtime.replaceBlockEffectiveGraphV2(instance, {
    ...instance.effectiveGraph,
    edges: instance.effectiveGraph.edges.filter((item) => item.edgeId !== edge.edgeId),
  });
  const restored = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(broken)));
  const issues = loopDiagnostics.inspectReviewedLoopV2(restored, definitions);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].nodeId, member.nodeId);
  assert.equal(issues[0].fieldId, 'loop_members_in');
  assert.equal(issues[0].code, 'modular_loop_members_disconnected');
  assert.deepEqual(loopRepair.reviewedLoopRepairEdgeV2(restored, member.nodeId, definitions), edge);
  const repaired = loopRepair.repairReviewedLoopV2(
    restored,
    member.nodeId,
    restored.effectiveGraph.graphHash,
    definitions,
  );
  assert.deepEqual(loopDiagnostics.inspectReviewedLoopV2(repaired, definitions), []);
  assert.deepEqual(repaired.values, instance.values);
  assert.deepEqual(repaired.effectiveGraph.nodes, restored.effectiveGraph.nodes);
  assert.deepEqual(repaired.definitionSnapshot, restored.definitionSnapshot);
  assert.throws(
    () => loopRepair.repairReviewedLoopV2(repaired, member.nodeId, restored.effectiveGraph.graphHash, definitions),
    /changed/,
  );
});

test('empty, detached, wrong-convention and forked loop drafts name their exact affected nodes', () => {
  const original = qwen();
  const definitions = [...library.blockDefinitions, ...snapshot.blockDefinitions];
  const owner = original.effectiveGraph.nodes.find((node) => node.data.params?.execution_kind?.value === 'loop_owner');
  const members = original.effectiveGraph.nodes.filter(
    (node) => node.data.params?.execution_kind?.value === 'loop_member',
  );
  assert.ok(owner && members.length);
  const empty = structuredClone(original);
  empty.effectiveGraph.nodes = empty.effectiveGraph.nodes.filter(
    (node) => !members.some((member) => member.nodeId === node.nodeId),
  );
  empty.effectiveGraph.edges = empty.effectiveGraph.edges.filter(
    (edge) => !members.some((member) => [edge.sourceNodeId, edge.targetNodeId].includes(member.nodeId)),
  );
  assert.ok(
    loopDiagnostics
      .inspectReviewedLoopV2(empty, definitions)
      .some((issue) => issue.nodeId === owner.nodeId && issue.code === 'modular_loop_empty'),
  );
  const detached = structuredClone(original);
  const member = detached.effectiveGraph.nodes.find((node) => node.nodeId === members[0].nodeId);
  member.modularDiffusers.placementPath = ['moved_out', 'member'];
  assert.ok(
    loopDiagnostics
      .inspectReviewedLoopV2(detached, definitions)
      .some((issue) => issue.nodeId === member.nodeId && issue.code === 'modular_loop_scope_invalid'),
  );
  member.modularDiffusers.placementPath = [...owner.modularDiffusers.placementPath, 'wrong_convention'];
  member.data.params.execution_kind.value = 'step';
  assert.ok(
    loopDiagnostics
      .inspectReviewedLoopV2(detached, definitions)
      .some((issue) => issue.nodeId === member.nodeId && issue.code === 'modular_loop_scope_invalid'),
  );
  const forked = structuredClone(original);
  forked.effectiveGraph.edges.push({
    edgeId: 'fork',
    sourceNodeId: members[0].nodeId,
    sourcePortId: 'loop_members',
    targetNodeId: owner.nodeId,
    targetPortId: 'loop_members_in',
  });
  assert.ok(
    loopDiagnostics
      .inspectReviewedLoopV2(forked, definitions)
      .some((issue) => issue.nodeId === members[0].nodeId && issue.code === 'modular_loop_fork_invalid'),
  );
  assert.deepEqual(loopDiagnostics.inspectReviewedLoopV2(original, definitions), []);
});

test('an upstream placement moves between nested owners without changing its values, identity or wires', () => {
  const original = qwen();
  const source = original.effectiveGraph.nodes.find(
    (node) => node.modularDiffusers?.blockClass === 'QwenImageTextInputsStep',
  );
  const destination = original.effectiveGraph.nodes.find(
    (node) => node.modularDiffusers?.blockClass === 'QwenImageDecodeStep',
  );
  assert.ok(source && destination);
  const updated = reparenting.reparentOrdinaryBlockNodeV2(original, source.nodeId, destination.nodeId, {
    x: 40,
    y: 100,
  });
  const moved = updated.effectiveGraph.nodes.find((node) => node.nodeId === source.nodeId);
  assert.deepEqual(moved.data, source.data);
  assert.equal(moved.modularDiffusers.blockDefinitionId, source.modularDiffusers.blockDefinitionId);
  assert.equal(moved.modularDiffusers.blockContractHash, source.modularDiffusers.blockContractHash);
  assert.deepEqual(moved.modularDiffusers.placementPath.slice(0, -1), destination.modularDiffusers.placementPath);
  assert.deepEqual(updated.effectiveGraph.edges, original.effectiveGraph.edges);
  assert.deepEqual(updated.values, original.values);
  const recipe = lowering.executionCompositionRecipeV2(updated, library, snapshot);
  assert.ok(
    recipe.operations.some(
      (op) => op.kind === 'move' && JSON.stringify(op.path) === JSON.stringify(source.modularDiffusers.placementPath),
    ),
  );
  assert.deepEqual(
    schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(updated))).effectiveGraph,
    updated.effectiveGraph,
  );
  let reused = updated;
  for (let index = 0; index < 2; index++) {
    const saved = persistence.reusableBlockDefinitionFromInstanceV2(reused, {
      choice: 'new',
      definitionId: `moved-save-${index}`,
      displayName: `Moved Qwen ${index}`,
    });
    reused = schema.createBlockInstanceV2(saved, {
      instanceId: `moved-reuse-${index}`,
      position: { x: 0, y: 0 },
      size: { width: 420, height: 560 },
    });
    assert.deepEqual(lowering.executionCompositionRecipeV2(reused, library, snapshot), recipe);
    assert.deepEqual(reused.effectiveGraph.edges, updated.effectiveGraph.edges);
  }
});

test('a disconnected Qwen draft survives round-trip and gets a minimal state repair', () => {
  const instance = qwen();
  const definitions = [...library.blockDefinitions, ...snapshot.blockDefinitions];
  assert.deepEqual(diagnostics.inspectReviewedStateV2(instance, definitions), []);
  const target = instance.effectiveGraph.nodes.find(
    (node) => node.modularDiffusers?.blockClass === 'QwenImageTextInputsStep',
  );
  const edge = instance.effectiveGraph.edges.find(
    (edge) => edge.targetNodeId === target.nodeId && edge.targetPortId === 'state_in',
  );
  assert.ok(edge);
  const draft = runtime.replaceBlockEffectiveGraphV2(instance, {
    ...instance.effectiveGraph,
    edges: instance.effectiveGraph.edges.filter((item) => item.edgeId !== edge.edgeId),
  });
  const restored = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(draft)));
  const issue = diagnostics.inspectReviewedStateV2(restored, definitions).find((item) => item.nodeId === target.nodeId);
  assert.ok(issue.missing.includes('prompt_embeds'));
  assert.deepEqual(issue.reconnectFrom, [edge.sourceNodeId]);
  const fixed = repair.repairReviewedStateV2(
    restored,
    edge.sourceNodeId,
    target.nodeId,
    restored.effectiveGraph.graphHash,
    definitions,
  );
  assert.deepEqual(diagnostics.inspectReviewedStateV2(fixed, definitions), []);
  assert.deepEqual(fixed.values, draft.values);
  assert.deepEqual(fixed.definitionSnapshot, draft.definitionSnapshot);
  assert.deepEqual(fixed.effectiveGraph.nodes, draft.effectiveGraph.nodes);
  assert.equal(fixed.effectiveGraph.edges.length, draft.effectiveGraph.edges.length + 1);
  assert.throws(
    () =>
      repair.repairReviewedStateV2(
        fixed,
        edge.sourceNodeId,
        target.nodeId,
        draft.effectiveGraph.graphHash,
        definitions,
      ),
    /changed/,
  );
});

test('shared Qwen Edit block contracts lower into T2I without transferring foreign Pipeline State', () => {
  let instance = insertedTextInput(qwen());
  const editedGraph = structuredClone(instance.effectiveGraph);
  const added = editedGraph.nodes.find((node) => node.nodeId === 'added-text-input');
  const source = library.definitions.find(
    (definition) => definition.id === 'diffusers.modular:QwenImageEditModularPipeline:image_conditioned',
  );
  const placement = source.blockPlacements.find(
    (p) => p.blockDefinitionId === added.modularDiffusers.blockDefinitionId,
  );
  assert.ok(placement);
  added.modularDiffusers.pipelineClass = source.pipelineClass;
  added.modularDiffusers.workflowId = source.workflowId;
  added.modularDiffusers.sourceDefinitionId = source.id;
  added.modularDiffusers.sourcePlacementPath = placement.path;
  added.modularDiffusers.sourceExecutionScope = 'selected_workflow';
  const destination = { pipelineClass: 'QwenImageModularPipeline', libraryRevision: snapshot.diffusersRevision };
  assert.equal(contextCompatibility.reviewedBlockFitsContextV2(added.modularDiffusers, destination, snapshot), true);
  assert.equal(
    contextCompatibility.reviewedBlockFitsContextV2(
      { ...added.modularDiffusers, blockContractHash: 'stale' },
      destination,
      snapshot,
    ),
    false,
  );
  instance = runtime.replaceBlockEffectiveGraphV2(instance, editedGraph);
  const id = runtime.blockProjectionNodeIdV2(instance.instanceId, added.nodeId);
  const graph = {
    nodes: { [id]: { module: 'modules.ModularDiffusers', action: 'ReviewedModularWorkflowStep', params: {} } },
    paths: [[id]],
  };
  const output = lowering.applyModularCompositionExecutionV2(
    graph,
    [runtime.createBlockRootNodeV2(instance)],
    library,
    snapshot,
  );
  assert.equal(output.nodes[id].params.pipeline_class.value, destination.pipelineClass);
  assert.equal(output.nodes[id].params.composition_recipe.value.operations.at(-1).sourceDefinitionId, source.id);
});

test('unchanged Qwen admissions and parameter-only edits keep their existing runtime tree', () => {
  for (const entry of entries.filter((e) => e.definition.source.pipelineClass?.startsWith('Qwen'))) {
    const instance = schema.createBlockInstanceV2(entry.definition, {
      instanceId: 'demo',
      position: { x: 0, y: 0 },
      size: { width: 420, height: 560 },
    });
    assert.equal(lowering.executionCompositionRecipeV2(instance, library, snapshot), null, entry.catalogDefinitionId);
  }
  const instance = qwen();
  instance.values.prompt = 'Keep this literal edit';
  assert.equal(lowering.executionCompositionRecipeV2(instance, library, snapshot), null);
});

test('an inserted upstream block produces a recipe and survives a saved User Node baseline', () => {
  const instance = insertedTextInput(qwen());
  const before = JSON.stringify(instance);
  const recipe = lowering.executionCompositionRecipeV2(instance, library, snapshot);
  assert.deepEqual(
    recipe.operations.map((op) => op.kind),
    ['insert'],
  );
  assert.equal(recipe.operations[0].name, 'demo_text_inputs');
  const saved = persistence.reusableBlockDefinitionFromInstanceV2(instance, {
    choice: 'new',
    definitionId: 'demo-saved',
    displayName: 'Demo saved',
  });
  const reused = schema.createBlockInstanceV2(saved, {
    instanceId: 'reused',
    position: { x: 0, y: 0 },
    size: { width: 420, height: 560 },
  });
  assert.deepEqual(lowering.executionCompositionRecipeV2(reused, library, snapshot), recipe);
  assert.equal(JSON.stringify(instance), before);
});

test('an unchanged registered snapshot does not need a second hierarchy representation', () => {
  const instance = qwen();
  assert.equal(lowering.executionCompositionRecipeV2(instance, library, null), null);
  instance.values.prompt = 'Parameter-only edit preserves the admitted topology';
  assert.equal(lowering.executionCompositionRecipeV2(instance, library, null), null);
  assert.throws(() => lowering.executionCompositionRecipeV2(insertedTextInput(instance), library, null), /hierarchy/);
});

test('all eleven Qwen admissions retain exact backend contracts after a compatible upstream insertion', () => {
  const payload = entries
    .filter((e) => e.definition.source.pipelineClass?.startsWith('Qwen'))
    .map((entry) => {
      const instance = insertedTextInput(
        schema.createBlockInstanceV2(entry.definition, {
          instanceId: 'family-contract',
          position: { x: 0, y: 0 },
          size: { width: 420, height: 560 },
        }),
      );
      return {
        admission: entry.catalogDefinitionId,
        recipe: lowering.executionCompositionRecipeV2(instance, library, snapshot),
        placements: instance.effectiveGraph.nodes
          .filter((n) => n.modularDiffusers?.kind === 'upstream_block')
          .map((n) => ({
            path: n.modularDiffusers.placementPath,
            blockDefinitionId: n.modularDiffusers.blockDefinitionId,
          })),
      };
    });
  assert.equal(payload.length, 11);
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./run-python.mjs', import.meta.url)),
      '-c',
      `
import json, sys
from modiff.modular_composition import validate_modular_composition_recipe
for item in json.load(sys.stdin):
    validated = validate_modular_composition_recipe(item['recipe'])
    contracts = {tuple(p['path']): p['blockDefinitionId'] for p in validated['composedPlacements']}
    for placement in item['placements']:
        path = tuple(placement['path'])
        assert contracts.get(path) == placement['blockDefinitionId'], (item['admission'], path)
print('11 Qwen admission composition contracts matched')
`,
    ],
    { cwd: '../MoDiff', encoding: 'utf8', input: JSON.stringify(payload), maxBuffer: 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /11 Qwen admission/);
});

test('submission uses exact nested runtime paths and preserves unrelated graph bytes', () => {
  const instance = insertedTextInput(qwen());
  const root = runtime.createBlockRootNodeV2(instance);
  const graph = { sid: 'test', paths: [], nodes: {} };
  for (const n of instance.effectiveGraph.nodes.filter((n) => n.nodeType === 'custom')) {
    graph.nodes[runtime.blockProjectionNodeIdV2(instance.instanceId, n.nodeId)] = {
      module: n.data.module,
      action: n.data.action,
      params: structuredClone(n.data.params),
    };
  }
  const before = JSON.stringify(graph);
  const lowered = lowering.applyModularCompositionExecutionV2(graph, [root], library, snapshot);
  const step = lowered.nodes[runtime.blockProjectionNodeIdV2(instance.instanceId, 'added-text-input')];
  assert.equal(step.params.composition_recipe.value.operations[0].kind, 'insert');
  assert.equal(step.params.execution_scope.value, 'unpruned_pipeline');
  assert.equal(step.params.placement_path.value.at(-1), 'demo_text_inputs');
  assert.equal(JSON.stringify(graph), before);
});

test('loop rewiring changes upstream order; incomplete chains get a named actionable error', () => {
  const instance = qwen();
  const owner = instance.effectiveGraph.nodes.find((n) => n.modularDiffusers?.blockKind === 'loop');
  const members = instance.effectiveGraph.nodes.filter(
    (n) => n.modularDiffusers?.parentPlacementPath?.join('/') === owner.modularDiffusers.placementPath.join('/'),
  );
  const originalEdges = instance.effectiveGraph.edges.filter((e) => e.targetPortId === 'loop_members_in');
  assert.equal(originalEdges.length, members.length);
  instance.effectiveGraph.edges = instance.effectiveGraph.edges.filter((e) => e.targetPortId !== 'loop_members_in');
  assert.throws(() => lowering.executionCompositionRecipeV2(instance, library, snapshot), /Loop denoise.*disconnected/);
  const reversed = [...members].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  for (let index = 0; index < reversed.length; index++)
    instance.effectiveGraph.edges.push({
      edgeId: `demo-loop-${index}`,
      sourceNodeId: reversed[index].nodeId,
      sourcePortId: 'loop_members',
      targetNodeId: reversed[index + 1]?.nodeId ?? owner.nodeId,
      targetPortId: 'loop_members_in',
    });
  const recipe = lowering.executionCompositionRecipeV2(instance, library, snapshot);
  assert.deepEqual(
    recipe.operations.map((op) => op.kind),
    ['move', 'move', 'move'],
  );
  assert.deepEqual(
    recipe.operations.map((op) => op.path),
    reversed.map((n) => n.modularDiffusers.placementPath),
  );
});

test('preparation fails closed on catalog loss or an edit during metadata loading', async () => {
  const { useFlowStore } = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  const { useHuggingFaceNodeLibraryStore: catalogs } = await server.ssrLoadModule(
    '/src/stores/useHuggingFaceNodeLibraryStore.ts',
  );
  const { useHuggingFaceModularConditionalStore: hierarchies } = await server.ssrLoadModule(
    '/src/stores/useHuggingFaceModularConditionalStore.ts',
  );
  const original = [useFlowStore.getState(), catalogs.getState(), hierarchies.getState()];
  try {
    const root = runtime.createBlockRootNodeV2(insertedTextInput(qwen()));
    useFlowStore.setState({ nodes: [root], edges: [] });
    catalogs.setState({ library: null, fetchLibrary: async () => {} });
    hierarchies.setState({ snapshot });
    await assert.rejects(lowering.prepareModularCompositionExecutionV2(useFlowStore.getState()), /could not be loaded/);
    catalogs.setState({ library });
    hierarchies.setState({
      snapshot: null,
      fetchSnapshot: async () => {
        const changed = structuredClone(root);
        changed.data.blockInstanceV2.values.prompt = 'User changed this during loading';
        useFlowStore.setState({ nodes: [changed] });
        hierarchies.setState({ snapshot });
      },
    });
    await assert.rejects(lowering.prepareModularCompositionExecutionV2(useFlowStore.getState()), /graph changed/);
    assert.equal(
      useFlowStore.getState().nodes[0].data.blockInstanceV2.values.prompt,
      'User changed this during loading',
    );
  } finally {
    useFlowStore.setState(original[0]);
    catalogs.setState(original[1]);
    hierarchies.setState(original[2]);
  }
});
