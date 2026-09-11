import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let capabilities;
let schema;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  capabilities = await server.ssrLoadModule('/src/studio/compositeBlockCapabilitiesV2.ts');
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
});

after(async () => {
  await server?.close();
});

const FULL_PERMISSIONS = Object.freeze({
  editWorkflow: true,
  configureInterfaces: true,
  createUserDefinitions: true,
  updateUserDefinitions: true,
});

function definition(kind = 'diffusers_catalog') {
  const registered = kind === 'diffusers_catalog' || kind === 'transformers_catalog';
  const graphWithoutHash = {
    nodes: [
      {
        nodeId: 'generate',
        nodeType: 'custom',
        data: {
          action: 'Generate',
          module: 'modules.Fixture',
          params: { prompt: { default: 'starter prompt', type: 'string' } },
        },
        semanticRole: 'generate',
      },
    ],
    edges: [],
    executionOrder: ['generate'],
  };
  const graph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
  const source =
    kind === 'diffusers_catalog'
      ? {
          kind,
          catalogCategory: 'diffusers',
          provider: 'diffusers',
          library: 'diffusers',
          libraryRevision: 'a'.repeat(40),
          pipelineClass: 'FixtureModularPipeline',
          blocksClass: 'FixtureAutoBlocks',
          workflow: 'text2image',
          manifestDefinitionId: 'diffusers:FixtureModularPipeline:text2image',
          manifestContentHash: 'manifest-fixture-image',
        }
      : kind === 'transformers_catalog'
        ? {
            kind,
            catalogCategory: 'transformers',
            provider: 'transformers',
            library: 'transformers',
            libraryRevision: 'b'.repeat(40),
            pipelineClass: 'AutomaticSpeechRecognitionPipeline',
            blocksClass: 'AutomaticSpeechRecognitionPipeline',
            workflow: 'speech_to_text',
            manifestDefinitionId: 'transformers:AutomaticSpeechRecognitionPipeline:speech_to_text',
            manifestContentHash: 'manifest-fixture-speech',
          }
        : { kind: 'user' };
  const withoutHash = {
    schemaVersion: 2,
    definitionId: `${kind}:fixture`,
    displayName: registered ? 'Registered fixture' : 'User fixture',
    source,
    graph,
    boundary: {
      mode: registered ? 'explicit' : 'derived',
      inputs: [
        {
          portId: 'prompt',
          label: 'Prompt',
          valueType: 'string',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'prompt' },
        },
      ],
      outputs: [
        {
          portId: 'asset',
          label: 'Asset',
          valueType: 'file',
          required: false,
          binding: { nodeId: 'generate', fieldOrPortId: 'asset' },
        },
      ],
      ...(registered
        ? {}
        : {
            derivation: {
              algorithmVersion: 'selection-boundary-v1',
              derivedAtDefinitionHash: graph.graphHash,
            },
          }),
    },
    controls: [
      {
        controlId: 'prompt',
        label: 'Prompt',
        binding: { nodeId: 'generate', fieldId: 'prompt' },
        valueType: 'string',
        defaultValue: 'starter prompt',
        order: 0,
      },
    ],
    previews: [{ nodeId: 'generate', outputPortId: 'asset', mediaType: 'file', primary: true }],
    ownership: registered
      ? { kind: 'registered', definitionMutable: false }
      : { kind: 'user', definitionMutable: true },
  };
  return schema.normalizeBlockDefinitionV2({
    ...withoutHash,
    contentHash: schema.blockDefinitionContentHashV2(withoutHash),
  });
}

function instance(blockDefinition, instanceId = 'fixture-instance', values) {
  return schema.createBlockInstanceV2(blockDefinition, {
    instanceId,
    position: { x: 40, y: 80 },
    size: { width: 420, height: 460 },
    ...(values ? { values } : {}),
  });
}

function structurallyCustomizedInstance(blockDefinition, instanceId) {
  const blockInstance = instance(blockDefinition, instanceId);
  const effectiveGraphWithoutHash = {
    nodes: [
      ...blockInstance.effectiveGraph.nodes,
      {
        nodeId: 'inspect',
        nodeType: 'custom',
        data: { action: 'Inspect', module: 'modules.Fixture', params: {} },
        semanticRole: 'inspect',
      },
    ],
    edges: [
      ...blockInstance.effectiveGraph.edges,
      {
        edgeId: 'generated-asset-to-inspector',
        sourceNodeId: 'generate',
        sourcePortId: 'asset',
        targetNodeId: 'inspect',
        targetPortId: 'asset',
      },
    ],
    executionOrder: ['generate', 'inspect'],
  };
  const effectiveGraph = {
    ...effectiveGraphWithoutHash,
    graphHash: schema.blockGraphHashV2(effectiveGraphWithoutHash),
  };
  return schema.normalizeBlockInstanceV2({
    ...blockInstance,
    effectiveGraph,
    customization: {
      state: 'structure_changed',
      baseGraphHash: blockDefinition.graph.graphHash,
      effectiveGraphHash: effectiveGraph.graphHash,
    },
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

test('registered Diffusers and Transformers blocks share instance actions but never definition update', () => {
  for (const kind of ['diffusers_catalog', 'transformers_catalog']) {
    const blockDefinition = definition(kind);
    const blockInstance = instance(blockDefinition, `${kind}:instance`);
    assert.deepEqual(
      capabilities.resolveCompositeBlockCapabilitiesV2(blockDefinition, blockInstance, FULL_PERMISSIONS),
      {
        editInstanceValues: true,
        editInstanceStructure: true,
        configureInterface: true,
        keepWorkflowOnly: true,
        saveAsNewUserNode: true,
        updateReusableDefinition: false,
      },
    );
  }
  const diffusersDefinition = definition('diffusers_catalog');
  const structurallyCustomized = structurallyCustomizedInstance(diffusersDefinition, 'diffusers-structure-instance');
  assert.deepEqual(
    capabilities.resolveCompositeBlockCapabilitiesV2(diffusersDefinition, structurallyCustomized, FULL_PERMISSIONS),
    {
      editInstanceValues: true,
      editInstanceStructure: true,
      configureInterface: true,
      keepWorkflowOnly: true,
      saveAsNewUserNode: true,
      updateReusableDefinition: false,
    },
  );
});

test('a user-owned definition supports all explicit save choices', () => {
  const blockDefinition = definition('user');
  const blockInstance = instance(blockDefinition, 'user-instance', { prompt: 'workflow-specific prompt' });
  assert.equal(blockInstance.customization.state, 'parameters_changed');
  assert.deepEqual(capabilities.resolveCompositeBlockCapabilitiesV2(blockDefinition, blockInstance, FULL_PERMISSIONS), {
    editInstanceValues: true,
    editInstanceStructure: true,
    configureInterface: true,
    keepWorkflowOnly: true,
    saveAsNewUserNode: true,
    updateReusableDefinition: true,
  });
});

test('workspace and user permissions fail closed without changing ownership semantics', () => {
  const blockDefinition = definition('user');
  const blockInstance = instance(blockDefinition, 'permission-instance');
  assert.deepEqual(
    capabilities.resolveCompositeBlockCapabilitiesV2(blockDefinition, blockInstance, {
      editWorkflow: true,
      configureInterfaces: false,
      createUserDefinitions: false,
      updateUserDefinitions: true,
    }),
    {
      editInstanceValues: true,
      editInstanceStructure: true,
      configureInterface: false,
      keepWorkflowOnly: true,
      saveAsNewUserNode: false,
      updateReusableDefinition: true,
    },
  );
  assert.deepEqual(
    capabilities.resolveCompositeBlockCapabilitiesV2(blockDefinition, blockInstance, {
      editWorkflow: false,
      configureInterfaces: true,
      createUserDefinitions: true,
      updateUserDefinitions: true,
    }),
    {
      editInstanceValues: false,
      editInstanceStructure: false,
      configureInterface: false,
      keepWorkflowOnly: false,
      saveAsNewUserNode: false,
      updateReusableDefinition: false,
    },
  );
});

test('a definition-instance identity mismatch disables every action', () => {
  const blockDefinition = definition();
  const blockInstance = instance(blockDefinition, 'mismatch-instance');
  const mismatchedDefinition = { ...blockDefinition, definitionId: 'diffusers_catalog:other-fixture' };
  assert.deepEqual(
    capabilities.resolveCompositeBlockCapabilitiesV2(mismatchedDefinition, blockInstance, FULL_PERMISSIONS),
    {
      editInstanceValues: false,
      editInstanceStructure: false,
      configureInterface: false,
      keepWorkflowOnly: false,
      saveAsNewUserNode: false,
      updateReusableDefinition: false,
    },
  );
});

test('capability resolution cannot mutate hashes, instance state, previews, or authorities', () => {
  const blockDefinition = definition();
  const blockInstance = instance(blockDefinition, 'immutable-instance');
  blockInstance.previewStates = [
    {
      binding: blockDefinition.previews[0],
      mediaReference: 'data/outputs/fixture.png',
      taskId: 'task-fixture',
      status: 'complete',
    },
  ];
  blockInstance.authorities = [
    {
      kind: 'reviewed_execution',
      definitionId: blockDefinition.definitionId,
      definitionContentHash: blockDefinition.contentHash,
      effectiveGraphHash: blockInstance.effectiveGraph.graphHash,
      executionParameterHash: 'parameters-fixture',
      artifactRevisions: { 'fixture/model': 'c'.repeat(40) },
      admissionId: 'fixture-admission',
      issuedAt: '2026-09-01T00:00:00.000Z',
    },
  ];
  const definitionBefore = structuredClone(blockDefinition);
  const instanceBefore = structuredClone(blockInstance);
  const contentHashBefore = schema.blockDefinitionContentHashV2(blockDefinition);
  const graphHashBefore = schema.blockGraphHashV2(blockInstance.effectiveGraph);

  deepFreeze(blockDefinition);
  deepFreeze(blockInstance);
  const resolved = capabilities.resolveCompositeBlockCapabilitiesV2(blockDefinition, blockInstance, FULL_PERMISSIONS);

  assert.deepEqual(blockDefinition, definitionBefore);
  assert.deepEqual(blockInstance, instanceBefore);
  assert.equal(schema.blockDefinitionContentHashV2(blockDefinition), contentHashBefore);
  assert.equal(schema.blockGraphHashV2(blockInstance.effectiveGraph), graphHashBefore);
  assert.deepEqual(blockInstance.authorities, instanceBefore.authorities);
  assert.equal(Object.hasOwn(blockDefinition, 'capabilities'), false);
  assert.equal(Object.hasOwn(blockInstance, 'capabilities'), false);
  assert.deepEqual(Object.keys(resolved).sort(), [
    'configureInterface',
    'editInstanceStructure',
    'editInstanceValues',
    'keepWorkflowOnly',
    'saveAsNewUserNode',
    'updateReusableDefinition',
  ]);
});
