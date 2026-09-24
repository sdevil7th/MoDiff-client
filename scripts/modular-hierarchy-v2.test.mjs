import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_ROOT = path.resolve(ROOT, '..', 'MoDiff');
const BACKEND_DATA = path.join(BACKEND_ROOT, 'data');
const BACKEND_PYTHON =
  process.env.MODIFF_BACKEND_PYTHON ||
  path.join(BACKEND_ROOT, '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
const RUNTIME_LAUNCHER =
  process.platform === 'win32' ? BACKEND_PYTHON : path.join(BACKEND_ROOT, 'scripts', 'with-runtime-env.sh');

let conditionalModule;
let catalogModule;
let catalogOnlyCompiler;
let reviewedGraphModule;
let blockRuntimeModule;
let blockSchemaModule;
let blockPersistenceModule;
let blockContainerInterfaceModule;
let graphLayoutModule;
let nodeLibraryModule;
let reviewedLibrary;
let server;

function executionContract(graph) {
  return {
    nodes: graph.nodes.map(({ id, type, data }) => ({
      id,
      type,
      module: data.module,
      action: data.action,
      params: data.params,
    })),
    edges: graph.edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({
      id,
      source,
      sourceHandle,
      target,
      targetHandle,
    })),
  };
}

before(async () => {
  if (!existsSync(BACKEND_PYTHON)) throw new Error(`MoDiff backend Python is missing: ${BACKEND_PYTHON}`);
  if (!existsSync(RUNTIME_LAUNCHER)) throw new Error(`MoDiff runtime launcher is missing: ${RUNTIME_LAUNCHER}`);
  const libraryResult = spawnSync(
    RUNTIME_LAUNCHER,
    [
      ...(process.platform === 'win32' ? [] : [BACKEND_PYTHON]),
      '-c',
      'import json; from modiff.huggingface_node_library import build_huggingface_node_library; print(json.dumps(build_huggingface_node_library(), separators=(",", ":")))',
    ],
    {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: BACKEND_ROOT },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (libraryResult.status !== 0)
    throw new Error(`Could not build the reviewed Hugging Face library:\n${libraryResult.stderr}`);
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  conditionalModule = await server.ssrLoadModule('/src/studio/huggingFaceModularConditionals.ts');
  catalogModule = await server.ssrLoadModule('/src/studio/huggingFaceNodeCatalog.ts');
  catalogOnlyCompiler = await server.ssrLoadModule('/src/studio/catalogOnlyModularBlockV2.ts');
  reviewedGraphModule = await server.ssrLoadModule('/src/studio/reviewedModularGraphV2.ts');
  blockRuntimeModule = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  blockSchemaModule = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  blockPersistenceModule = await server.ssrLoadModule('/src/studio/blockDefinitionPersistenceV2.ts');
  blockContainerInterfaceModule = await server.ssrLoadModule('/src/studio/blockContainerInterfaceV1.ts');
  graphLayoutModule = await server.ssrLoadModule('/src/workflow/graphLayout.ts');
  nodeLibraryModule = await server.ssrLoadModule('/src/studio/huggingFaceNodeLibrary.ts');
  reviewedLibrary = nodeLibraryModule.parseHuggingFaceNodeLibrary(JSON.parse(libraryResult.stdout));
});

test('the Modular Diffusers catalog exposes every exact block once and retains all placement contexts', () => {
  const conditional = conditionalModule.parseHuggingFaceModularConditionalSnapshot(
    JSON.parse(readFileSync(path.join(BACKEND_DATA, 'modular-conditional-contracts.json'), 'utf8')),
  );
  const selected = JSON.parse(readFileSync(path.join(BACKEND_DATA, 'modular-block-contracts.json'), 'utf8'));
  const blockById = new Map(conditional.blockDefinitions.map((block) => [block.id, block]));
  const definitions = selected.workflows.map((workflow) => {
    const pipeline = conditional.pipelines.find((candidate) => candidate.pipelineClass === workflow.pipelineClass);
    return {
      id: `diffusers.modular:${workflow.pipelineClass}:${workflow.workflowId}`,
      provider: 'diffusers',
      pipelineClass: workflow.pipelineClass,
      blocksClass: blockById.get(pipeline.rootBlockDefinitionId).className,
      workflowId: workflow.workflowId,
      label: `${workflow.pipelineClass} — ${workflow.workflowId}`,
      description: '',
      taskId: 'test',
      taskContractId: 'diffusers.task.test.v1',
      inputs: [],
      outputs: [],
      steps: [],
      components: [],
      graphAdapterContracts: [],
      executionAdmissions: [],
      integrationStatus: 'contract_only',
    };
  });
  const library = {
    diffusersRevision: conditional.diffusersRevision,
    definitions,
    blockDefinitions: selected.blockDefinitions,
  };
  const section = catalogModule
    .buildHuggingFaceCatalogSections(library, conditional)
    .find(({ id }) => id === 'modular_diffusers_block_nodes');
  const expectedPlacements = conditional.pipelines.reduce((total, pipeline) => total + pipeline.placements.length, 0);
  const expectedDefinitions = new Set(
    conditional.pipelines.flatMap((pipeline) => pipeline.placements.map(({ blockDefinitionId }) => blockDefinitionId)),
  );

  assert.equal(expectedPlacements, 1051);
  assert.equal(expectedDefinitions.size, 598);
  assert.equal(section.entries.length, expectedDefinitions.size);
  assert.equal(new Set(section.entries.map(({ id }) => id)).size, expectedDefinitions.size);
  assert.equal(
    new Set(section.entries.map(({ modularBlockPlacement }) => modularBlockPlacement.placement.blockDefinitionId)).size,
    expectedDefinitions.size,
  );
  assert.equal(
    section.entries.reduce((total, entry) => total + (entry.modularBlockContexts?.length ?? 0), 0),
    expectedPlacements,
  );
  assert.equal(
    new Set(
      section.entries.flatMap((entry) =>
        (entry.modularBlockContexts ?? []).map(
          (context) =>
            `${context.pipelineClass}:${context.workflowId}:${context.executionScope}:${context.placement.path.join('/')}`,
        ),
      ),
    ).size,
    expectedPlacements,
  );
  assert.ok(section.entries.every(({ id }) => id.startsWith('modular-block:diffusers.modular-block:')));
  assert.ok(section.entries.every(({ groupPath }) => groupPath.length === 3));
  assert.ok(section.entries.every(({ insertable, readiness }) => insertable && readiness === 'composable'));
  assert.ok(section.entries.some(({ detail }) => detail.includes('conditional')));
  assert.ok(section.entries.some(({ detail }) => detail.includes('sequential')));
  assert.ok(section.entries.some(({ detail }) => detail.includes('loop')));
});

after(async () => {
  await server?.close();
});

test('all 94 reviewed workflows map every selected step into the exact unpruned hierarchy', () => {
  const conditional = conditionalModule.parseHuggingFaceModularConditionalSnapshot(
    JSON.parse(readFileSync(path.join(BACKEND_DATA, 'modular-conditional-contracts.json'), 'utf8')),
  );
  const selected = JSON.parse(readFileSync(path.join(BACKEND_DATA, 'modular-block-contracts.json'), 'utf8'));
  assert.equal(selected.diffusersRevision, conditional.diffusersRevision);
  assert.equal(selected.workflows.length, 94);

  let maximumDepth = 0;
  let structuralPlacements = 0;
  for (const workflow of selected.workflows) {
    const definition = {
      provider: 'diffusers',
      libraryRevision: selected.diffusersRevision,
      pipelineClass: workflow.pipelineClass,
      workflowId: workflow.workflowId,
      blockPlacements: workflow.placements,
    };
    let hierarchy;
    try {
      hierarchy = reviewedGraphModule.reviewedWorkflowHierarchyV2(conditional, definition);
    } catch (error) {
      throw new Error(`${workflow.pipelineClass}.${workflow.workflowId}: ${error.message}`, { cause: error });
    }
    assert.ok(hierarchy, `${workflow.pipelineClass}.${workflow.workflowId} has no unpruned hierarchy`);
    assert.equal(
      hierarchy.fullPlacementBySelectedPath.size,
      workflow.placements.length,
      `${workflow.pipelineClass}.${workflow.workflowId} did not map every executable placement`,
    );
    structuralPlacements += hierarchy.structuralPlacements.length;
    for (const { placement } of hierarchy.structuralPlacements) {
      assert.ok(
        [...hierarchy.fullPlacementBySelectedPath.values()].some(
          (selectedPlacement) =>
            selectedPlacement.path.length > placement.path.length &&
            placement.path.every((segment, index) => selectedPlacement.path[index] === segment),
        ),
        `${workflow.pipelineClass}.${workflow.workflowId} exposed inactive structural placement ${placement.path.join('/')}`,
      );
    }
    for (const placement of hierarchy.fullPlacementBySelectedPath.values()) {
      maximumDepth = Math.max(maximumDepth, placement.path.length);
    }
    for (const { placement } of hierarchy.structuralPlacements) {
      maximumDepth = Math.max(maximumDepth, placement.path.length);
    }
  }

  assert.equal(maximumDepth, 5);
  assert.ok(structuralPlacements > 400, 'the audit unexpectedly flattened away reviewed containers');
});

test('all 94 reviewed workflows compile to one V2 graph with progressively projected nested containers', () => {
  const conditional = conditionalModule.parseHuggingFaceModularConditionalSnapshot(
    JSON.parse(readFileSync(path.join(BACKEND_DATA, 'modular-conditional-contracts.json'), 'utf8')),
  );
  const selected = JSON.parse(readFileSync(path.join(BACKEND_DATA, 'modular-block-contracts.json'), 'utf8'));
  const allBlocks = new Map(
    [...conditional.blockDefinitions, ...selected.blockDefinitions].map((block) => [block.id, block]),
  );
  const params = {
    pipeline_components: { type: 'diffusers_modular_pipeline_components', display: 'input' },
    state_in: { type: 'modular_workflow_state', display: 'input' },
    state_out: { type: 'modular_workflow_state', display: 'output' },
    loop_members_in: { type: 'modular_loop_members', display: 'input' },
    loop_members: { type: 'modular_loop_members', display: 'output' },
    pipeline_class: { type: 'string' },
    workflow_id: { type: 'string' },
    execution_scope: { type: 'string' },
    placement_path: { type: 'object' },
    block_definition_id: { type: 'string' },
    block_class: { type: 'string' },
    block_contract_hash: { type: 'string' },
    execution_kind: { type: 'string' },
    seed: { type: 'int', default: 0 },
  };
  for (const block of allBlocks.values()) {
    for (const input of block.inputs) {
      const field = input.name === 'generator' ? 'seed' : input.name;
      params[field] ??= {
        type: input.type,
        display: input.name === 'generator' ? undefined : 'input',
        default: input.name === 'generator' ? 0 : input.default,
      };
    }
    for (const output of block.outputs) params[output.name] ??= { type: output.type, display: 'output' };
  }
  const registry = {
    'modules.ModularDiffusers.ModelsLoader': {
      type: 'custom',
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      label: 'Models Loader',
      category: 'Modular Diffusers Blocks',
      params: {
        model_type: { type: 'string' },
        pipeline_class: { type: 'string' },
        workflow_id: { type: 'string' },
        repo_id: { type: 'string', display: 'modelselect' },
        revision: { type: 'string' },
        pipeline_components: { type: 'diffusers_modular_pipeline_components', display: 'output' },
      },
    },
    'modules.ModularDiffusers.ReviewedModularWorkflowStep': {
      type: 'custom',
      module: 'modules.ModularDiffusers',
      action: 'ReviewedModularWorkflowStep',
      label: 'Reviewed Modular Workflow Step',
      category: 'Modular Diffusers Blocks',
      params,
    },
  };
  const definitions = reviewedLibrary.definitions.filter(
    (definition) => definition.provider === 'diffusers' && definition.definitionKind === 'modular_pipeline_workflow',
  );
  const library = reviewedLibrary;
  let nodeCount = 0;
  let maximumDepth = 0;
  let parameterLocalityChecks = 0;
  let subtreeSaveChecks = 0;
  const workflowAudit = [];
  for (const definition of definitions) {
    let root;
    try {
      root = catalogOnlyCompiler.createCatalogOnlyModularBlockRootV2(definition, library, registry, conditional, {
        x: 0,
        y: 0,
      });
    } catch (error) {
      throw new Error(`${definition.pipelineClass}.${definition.workflowId}: ${error.message}`, { cause: error });
    }
    const instance = root.data.blockInstanceV2;
    assert.equal(root.data.type, 'block');
    assert.equal(instance.definitionSnapshot.source.kind, 'diffusers_catalog');
    assert.equal(instance.authorities.length, 0);
    assert.equal(
      instance.effectiveGraph.nodes.some(({ nodeType }) => nodeType === 'block' || nodeType === 'cluster'),
      false,
    );
    assert.ok(
      instance.effectiveInterface.boundary.inputs.length > 0,
      `${definition.pipelineClass}.${definition.workflowId} has no public inputs`,
    );
    assert.ok(
      instance.effectiveInterface.boundary.outputs.length > 0,
      `${definition.pipelineClass}.${definition.workflowId} has no public outputs`,
    );
    const incidentExecutionNodeIds = new Set(
      instance.effectiveGraph.edges.flatMap(({ sourceNodeId, targetNodeId }) => [sourceNodeId, targetNodeId]),
    );
    const disconnectedExecutionLeaves = instance.effectiveGraph.nodes
      .filter(({ nodeType }) => nodeType !== 'group')
      .filter(({ nodeId }) => !incidentExecutionNodeIds.has(nodeId))
      .map(({ nodeId }) => nodeId);
    assert.deepEqual(
      disconnectedExecutionLeaves,
      [],
      `${definition.pipelineClass}.${definition.workflowId} exposes disconnected active execution leaves`,
    );
    const incomingRuntimeSockets = new Set(
      instance.effectiveGraph.edges.map(({ targetNodeId, targetPortId }) => `${targetNodeId}\0${targetPortId}`),
    );
    const interfaceBoundRuntimeSockets = new Set([
      ...instance.effectiveInterface.boundary.inputs.map(
        ({ binding }) => `${binding.nodeId}\0${binding.fieldOrPortId}`,
      ),
      ...instance.effectiveInterface.controls.map(({ binding }) => `${binding.nodeId}\0${binding.fieldId}`),
    ]);
    const unboundRequiredRuntimeInputs = instance.effectiveGraph.nodes.flatMap((node) =>
      node.data.params?.execution_kind?.value === 'loop_member'
        ? []
        : Object.entries(node.data.params ?? {}).flatMap(([fieldId, param]) =>
            param?.display === 'input' &&
            param.required === true &&
            !incomingRuntimeSockets.has(`${node.nodeId}\0${fieldId}`) &&
            !interfaceBoundRuntimeSockets.has(`${node.nodeId}\0${fieldId}`) &&
            // Ordinary upstream inputs are read from the shared PipelineState.
            // They need a direct graph edge only when this leaf has no incoming
            // state path and the field is not an effective-interface binding.
            !incomingRuntimeSockets.has(`${node.nodeId}\0state_in`) &&
            !incomingRuntimeSockets.has(`${node.nodeId}\0loop_members_in`)
              ? [`${node.nodeId}.${fieldId}`]
              : [],
          ),
    );
    assert.deepEqual(
      unboundRequiredRuntimeInputs,
      [],
      `${definition.pipelineClass}.${definition.workflowId} leaves required runtime inputs unbound`,
    );
    const containerIds = blockSchemaModule.blockModularContainerNodeIdsV2(instance.effectiveGraph);
    assert.deepEqual(
      instance.presentation.collapsedContainerNodeIds ?? [],
      containerIds,
      `${definition.pipelineClass}.${definition.workflowId} must start with every nested container collapsed`,
    );

    const collapsedExecution = blockRuntimeModule.expandBlockGraphV2ForExecution([root], []);
    const progressivelyExpanded = blockRuntimeModule.setBlockPresentationV2(instance, { expanded: true });
    const progressiveProjection = blockRuntimeModule.materializeBlockProjectionV2(
      blockRuntimeModule.createBlockRootNodeV2(progressivelyExpanded),
    );
    const progressiveChildren = progressiveProjection.nodes.filter(({ id }) => id !== instance.instanceId);
    const disconnected = blockRuntimeModule.replaceBlockEffectiveGraphV2(progressivelyExpanded, {
      ...instance.effectiveGraph,
      edges: [],
    });
    const disconnectedProjection = blockRuntimeModule.materializeBlockProjectionV2(
      blockRuntimeModule.createBlockRootNodeV2(disconnected),
    );
    assert.equal(disconnectedProjection.edges.length, 0, `${definition.id}: must not restore deleted wires`);
    for (const node of progressiveChildren.filter(({ data }) => data.blockProjectionContainer)) {
      const disconnectedNode = disconnectedProjection.nodes.find((candidate) => candidate.id === node.id);
      assert.deepEqual(
        disconnectedNode.data.blockProjectionPortBindings,
        node.data.blockProjectionPortBindings,
        `${definition.id}: disconnecting must not hide baseline boundary sockets`,
      );
    }
    if (containerIds.length > 0) {
      assert.ok(
        progressiveChildren.length < instance.effectiveGraph.nodes.length,
        `${definition.pipelineClass}.${definition.workflowId} flattened all descendants on first expansion`,
      );
    }
    progressiveChildren
      .filter(({ data }) => data.blockProjectionContainer)
      .forEach(({ data }) => {
        assert.ok(
          Object.keys(data.blockProjectionPortBindings ?? {}).length > 0,
          `${definition.pipelineClass}.${definition.workflowId} projected portless container ${data.blockProjectionNodeId}`,
        );
        assert.equal(data.blockProjectionContainerExpanded, false);
      });

    const fullyExpanded = blockRuntimeModule.setBlockPresentationV2(instance, {
      expanded: true,
      collapsedContainerNodeIds: [],
    });
    const fullProjection = blockRuntimeModule.materializeBlockProjectionV2(
      blockRuntimeModule.createBlockRootNodeV2(fullyExpanded),
    );
    const fullChildren = fullProjection.nodes.filter(({ id }) => id !== instance.instanceId);
    // Labels may be shared upstream, but two visible handles on one side of a
    // container must identify distinct consumers. IDs and semantic endpoints
    // cannot change as the same container is opened.
    for (const projection of [progressiveProjection, fullProjection]) {
      for (const node of projection.nodes.filter(({ data }) => data.blockProjectionContainer)) {
        const labels = new Set();
        for (const [handle, param] of Object.entries(node.data.params)) {
          const direction =
            param.display === 'output' ? 'output' : param.display === 'input' || param.isInput ? 'input' : null;
          if (!direction || param.hidden) continue;
          const key = `${direction}:${param.label}`;
          assert.ok(!labels.has(key), `${definition.id}: ambiguous ${key} on ${node.data.blockProjectionNodeId}`);
          labels.add(key);
          const endpoint = blockRuntimeModule.blockProjectionConnectionEndpointV2(node, handle, direction);
          assert.ok(endpoint, `${definition.id}: unresolved ${handle}`);
          assert.ok(instance.effectiveGraph.nodes.some(({ nodeId }) => nodeId === endpoint.nodeId));
        }
      }
    }
    for (const initial of progressiveChildren.filter(({ data }) => data.blockProjectionContainer)) {
      const opened = fullChildren.find((node) => node.id === initial.id);
      for (const [handle, binding] of Object.entries(initial.data.blockProjectionPortBindings ?? {})) {
        assert.deepEqual(
          opened.data.blockProjectionPortBindings[handle],
          binding,
          `${definition.id}: ${handle} changed target`,
        );
        assert.equal(
          opened.data.params[handle].label,
          initial.data.params[handle].label,
          `${definition.id}: ${handle} changed label`,
        );
      }
    }
    // Every declared control must remain editable at every containing depth,
    // not just on a collapsed root or its fully expanded leaf.
    const parentIds = blockRuntimeModule.blockModularParentIdsV2(instance);
    for (const control of instance.effectiveInterface.controls) {
      const ancestors = new Set();
      for (const binding of [control.binding, ...(control.mirrorBindings ?? [])]) {
        let parent = parentIds.get(binding.nodeId);
        while (parent) {
          ancestors.add(parent);
          parent = parentIds.get(parent);
        }
      }
      for (const ancestor of ancestors) {
        const projected = fullChildren.find((node) => node.data.blockProjectionNodeId === ancestor);
        const aliases = Object.entries(projected.data.params).filter(
          ([, param]) =>
            !param.hidden &&
            param.display !== 'input' &&
            param.display !== 'output' &&
            param.fieldOptions?.blockBindingV2?.logicalId === control.controlId,
        );
        assert.equal(aliases.length, 1, `${definition.id}: ${ancestor} must expose ${control.controlId} exactly once`);
        assert.equal(aliases[0][1].hidden, false);
        assert.equal(aliases[0][1].fieldOptions.blockBindingV2.ownerId, instance.instanceId);
        assert.deepEqual(aliases[0][1].value, blockSchemaModule.blockInstanceValueV2(instance, control.controlId));
      }
    }
    const arranged = graphLayoutModule.arrangeGraphNodes(fullProjection.nodes, fullProjection.edges);
    assert.deepEqual(
      arranged.filter(({ id }) => id !== instance.instanceId),
      fullChildren,
      `${definition.pipelineClass}.${definition.workflowId} global arrangement must preserve recursive internal layout`,
    );
    assert.equal(
      fullChildren.length,
      instance.effectiveGraph.nodes.length,
      `${definition.pipelineClass}.${definition.workflowId} did not reveal every active semantic node`,
    );
    fullChildren
      .filter(({ data }) => data.blockProjectionContainer)
      .forEach(({ data }) =>
        assert.ok(
          Object.keys(data.blockProjectionPortBindings ?? {}).length > 0,
          `${definition.pipelineClass}.${definition.workflowId} projected portless container ${data.blockProjectionNodeId}`,
        ),
      );

    const byProjectedId = new Map(fullProjection.nodes.map((node) => [node.id, node]));
    fullChildren.forEach((child) => {
      const parent = byProjectedId.get(child.parentId);
      assert.ok(
        parent,
        `${definition.pipelineClass}.${definition.workflowId} has missing projected parent ${child.parentId}`,
      );
      const childWidth = child.width ?? 0;
      const childHeight = child.height ?? 0;
      const parentWidth = parent.width ?? 0;
      const parentHeight = parent.height ?? 0;
      assert.ok(
        child.position.x >= 0 && child.position.y >= 0,
        `${definition.pipelineClass}.${definition.workflowId} places ${child.id} before its parent origin`,
      );
      assert.ok(
        child.position.x + childWidth <= parentWidth + 1,
        `${definition.pipelineClass}.${definition.workflowId} lets ${child.id} escape the right edge of ${parent.id}`,
      );
      assert.ok(
        child.position.y + childHeight <= parentHeight + 1,
        `${definition.pipelineClass}.${definition.workflowId} lets ${child.id} escape the bottom edge of ${parent.id}`,
      );
      const parentPorts = parent.data.blockInstanceV2
        ? Object.values(blockRuntimeModule.blockConnectorParamsV2(parent.data.blockInstanceV2)).flatMap(Object.values)
        : Object.values(parent.data.params ?? {});
      const connectorRows = Math.max(
        parentPorts.filter((param) => param.isInput || param.display === 'input').length,
        parentPorts.filter((param) => !param.isInput && param.display === 'output').length,
      );
      const connectorTrayHeight = connectorRows ? connectorRows * 24 + 9 : 0;
      assert.ok(
        child.position.y + childHeight + connectorTrayHeight + 28 <= parentHeight + 1,
        `${definition.pipelineClass}.${definition.workflowId} overlaps ${parent.id}'s connector tray with ${child.id}`,
      );
    });

    const expandedExecution = blockRuntimeModule.expandBlockGraphV2ForExecution(
      fullProjection.nodes,
      fullProjection.edges,
    );
    assert.deepEqual(
      executionContract(expandedExecution),
      executionContract(collapsedExecution),
      `${definition.pipelineClass}.${definition.workflowId} changed execution when its hierarchy expanded`,
    );

    const editableControl = instance.effectiveInterface.controls.find((control) => {
      if (control.sealed) return false;
      const value = instance.values[control.controlId] ?? control.defaultValue;
      return ['boolean', 'number', 'string'].includes(typeof value);
    });
    if (editableControl) {
      const current = instance.values[editableControl.controlId] ?? editableControl.defaultValue;
      const editedValue =
        typeof current === 'boolean'
          ? !current
          : typeof current === 'number'
            ? current + 1
            : `${current} — parameter locality audit`;
      const edited = blockRuntimeModule.setBlockInstanceValueV2(instance, editableControl.controlId, editedValue);
      assert.deepEqual(edited.definitionSnapshot, instance.definitionSnapshot);
      assert.deepEqual(edited.definitionRef, instance.definitionRef);
      assert.deepEqual(edited.effectiveGraph, instance.effectiveGraph);
      assert.deepEqual(edited.effectiveInterface, instance.effectiveInterface);
      assert.deepEqual(edited.presentation, instance.presentation);
      assert.equal(edited.values[editableControl.controlId], editedValue);
      assert.equal(edited.customization.state, 'parameters_changed');
      assert.deepEqual(edited.authorities, []);
      parameterLocalityChecks += 1;
    }
    const beforeSubtreeSaves = JSON.stringify(instance);
    const declaredGraph = structuredClone(instance.effectiveGraph);
    for (const node of declaredGraph.nodes) {
      if (containerIds.includes(node.nodeId))
        node.containerInterface = blockContainerInterfaceModule.blockContainerInterfaceV1(instance, node.nodeId);
    }
    const declared = blockRuntimeModule.replaceBlockEffectiveGraphV2(instance, declaredGraph);
    const declaredReloaded = blockSchemaModule.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(declared)));
    assert.deepEqual(declaredReloaded.effectiveInterface, instance.effectiveInterface);
    assert.deepEqual(declaredReloaded.values, instance.values);
    for (const collapsedContainerNodeIds of [containerIds, []]) {
      const declaredProjection = blockRuntimeModule.materializeBlockProjectionV2(
        blockRuntimeModule.createBlockRootNodeV2(
          blockRuntimeModule.setBlockPresentationV2(declaredReloaded, { expanded: true, collapsedContainerNodeIds }),
        ),
      );
      assert.deepEqual(
        executionContract(
          blockRuntimeModule.expandBlockGraphV2ForExecution(declaredProjection.nodes, declaredProjection.edges),
        ),
        executionContract(collapsedExecution),
        `${definition.id}: declaring durable internal interfaces changed execution`,
      );
    }
    // The upstream identity is not an admission requirement for ordinary
    // utilities: every family must retain a source-neutral nested Text Value.
    const utilityId = 'ordinary-ownership-audit';
    const utilityParent = containerIds[0];
    const withUtility = blockRuntimeModule.addBlockEffectiveGraphNodeV2(declaredReloaded, {
      nodeId: utilityId,
      nodeType: 'custom',
      ...(utilityParent ? { parentNodeId: utilityParent } : {}),
      data: {
        type: 'custom',
        label: 'Text Value',
        module: 'modules.Primitive',
        action: 'TextValue',
        params: {
          text: { type: 'string', display: 'text', value: `Retained ordinary text for ${definition.id}` },
          output: { type: 'string', display: 'output' },
        },
      },
    });
    const reloadedUtility = blockSchemaModule.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(withUtility)));
    assert.deepEqual(reloadedUtility.definitionSnapshot, instance.definitionSnapshot);
    assert.deepEqual(reloadedUtility.effectiveInterface, instance.effectiveInterface);
    assert.deepEqual(reloadedUtility.values, instance.values);
    assert.equal(reloadedUtility.effectiveGraph.nodes.find((n) => n.nodeId === utilityId).modularDiffusers, undefined);
    let utilityExecution;
    for (const expanded of [false, true]) {
      const projection = blockRuntimeModule.materializeBlockProjectionV2(
        blockRuntimeModule.createBlockRootNodeV2(
          blockRuntimeModule.setBlockPresentationV2(reloadedUtility, { expanded, collapsedContainerNodeIds: [] }),
        ),
      );
      const execution = executionContract(
        blockRuntimeModule.expandBlockGraphV2ForExecution(projection.nodes, projection.edges),
      );
      if (utilityExecution)
        assert.deepEqual(execution, utilityExecution, `${definition.id}: ordinary nested utility changed on expand`);
      utilityExecution = execution;
      if (expanded && utilityParent) {
        const utility = projection.nodes.find((n) => n.data.blockProjectionNodeId === utilityId);
        const parent = projection.nodes.find((n) => n.data.blockProjectionNodeId === utilityParent);
        assert.equal(utility.parentId, parent.id, `${definition.id}: ordinary utility escaped its semantic parent`);
      }
    }
    const savedWithUtility = blockPersistenceModule.reusableBlockDefinitionFromSubtreeV2(reloadedUtility, {
      rootNodeId: utilityParent ?? utilityId,
      definitionId: `ordinary-subtree-${workflowAudit.length}`,
      displayName: 'Ordinary subtree',
    });
    assert.ok(
      savedWithUtility.graph.nodes.some((n) => n.nodeId === utilityId),
      `${definition.id}: subtree save dropped its ordinary child`,
    );
    assert.equal(
      savedWithUtility.graph.nodes.find((n) => n.nodeId === utilityId).data.params.text.value,
      `Retained ordinary text for ${definition.id}`,
    );

    let workflowSubtreeSaveChecks = 0;
    for (const node of instance.effectiveGraph.nodes) {
      if (node.modularDiffusers?.kind !== 'upstream_block') continue;
      const label = `${definition.pipelineClass}.${definition.workflowId}/${node.nodeId}`;
      let saved;
      try {
        saved = blockPersistenceModule.reusableBlockDefinitionFromSubtreeV2(instance, {
          rootNodeId: node.nodeId,
          definitionId: `subtree-audit-${subtreeSaveChecks}`,
          displayName: label,
        });
      } catch (error) {
        throw new Error(`${label} cannot be saved independently: ${error.message}`, { cause: error });
      }
      assert.equal(saved.source.kind, 'user', label);
      const reused = blockSchemaModule.createBlockInstanceV2(saved, {
        instanceId: `subtree-reuse-${subtreeSaveChecks}`,
        position: { x: 0, y: 0 },
        size: { width: 420, height: 480 },
      });
      assert.deepEqual(reused.effectiveGraph, saved.graph, label);
      assert.deepEqual(reused.effectiveInterface.boundary, saved.boundary, label);
      subtreeSaveChecks += 1;
      workflowSubtreeSaveChecks += 1;
    }
    assert.equal(JSON.stringify(instance), beforeSubtreeSaves, 'Saving a subtree mutated its source instance');
    nodeCount += instance.effectiveGraph.nodes.length;
    const workflowMaximumDepth = Math.max(
      ...instance.effectiveGraph.nodes.map((node) => node.modularDiffusers?.placementPath?.length ?? 0),
    );
    maximumDepth = Math.max(maximumDepth, workflowMaximumDepth);
    workflowAudit.push({
      definitionId: definition.id,
      effectiveNodeCount: instance.effectiveGraph.nodes.length,
      effectiveEdgeCount: instance.effectiveGraph.edges.length,
      nestedContainerCount: containerIds.length,
      maximumPlacementPathDepth: workflowMaximumDepth,
      boundaryInputCount: instance.effectiveInterface.boundary.inputs.length,
      boundaryOutputCount: instance.effectiveInterface.boundary.outputs.length,
      disconnectedActiveExecutionLeafCount: disconnectedExecutionLeaves.length,
      unboundRequiredRuntimeInputCount: unboundRequiredRuntimeInputs.length,
      collapsedExpandedExecutionEquivalent: true,
      parameterLocalityVerified: Boolean(editableControl),
      independentSubtreeSaveAndReuseChecks: workflowSubtreeSaveChecks,
      durableContainerInterfaceChecks: containerIds.length,
      ordinaryNodeOwnershipRoundTrip: true,
      ordinaryNodeNestedParent: utilityParent ?? null,
    });
  }
  assert.equal(definitions.length, 94);
  assert.equal(nodeCount, 1796);
  assert.equal(maximumDepth, 5);
  assert.equal(parameterLocalityChecks, 94);
  assert.ok(subtreeSaveChecks > 1400);
  if (process.env.MODIFF_HIERARCHY_AUDIT_OUTPUT) {
    writeFileSync(
      path.resolve(process.env.MODIFF_HIERARCHY_AUDIT_OUTPUT),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          workflowCount: definitions.length,
          effectiveNodeCount: nodeCount,
          maximumPlacementPathDepth: maximumDepth,
          independentSubtreeSaveAndReuseChecks: subtreeSaveChecks,
          workflows: workflowAudit,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
});
