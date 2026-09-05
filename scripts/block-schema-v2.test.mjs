import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = 'a'.repeat(40);

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
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
});

after(async () => {
  await server?.close();
});

function graph(nodes = null, edges = null) {
  const semantic = {
    nodes: nodes ?? [
      {
        nodeId: 'loader',
        nodeType: 'custom',
        data: { action: 'Load', module: 'modules.Test', params: { model: { value: 'owner/model' } } },
        semanticRole: 'loader',
      },
      {
        nodeId: 'generate',
        nodeType: 'custom',
        data: {
          action: 'Generate',
          module: 'modules.Test',
          params: {
            prompt: { default: 'starter prompt', type: 'string' },
            image: { display: 'ui_image', type: 'image' },
          },
        },
        semanticRole: 'generate',
      },
    ],
    edges: edges ?? [
      {
        edgeId: 'model-link',
        sourceNodeId: 'loader',
        sourcePortId: 'pipeline',
        targetNodeId: 'generate',
        targetPortId: 'pipeline',
      },
    ],
    executionOrder: ['loader', 'generate'],
  };
  return { ...semantic, graphHash: schema.blockGraphHashV2(semantic) };
}

function source(kind) {
  if (kind === 'diffusers_catalog') {
    return {
      kind,
      catalogCategory: 'diffusers',
      provider: 'diffusers',
      library: 'diffusers',
      libraryRevision: 'diffusers-main-2026-08-23',
      pipelineClass: 'TestModularPipeline',
      workflow: 'text2image',
      manifestDefinitionId: 'diffusers:TestModularPipeline:text2image',
      manifestContentHash: 'manifest-content-a',
      executionAdmissionId: 'diffusers:admission:TestModularPipeline:text2image',
    };
  }
  if (kind === 'transformers_catalog') {
    return {
      kind,
      catalogCategory: 'transformers',
      provider: 'transformers',
      library: 'transformers',
      libraryRevision: 'transformers-main-2026-08-23',
      pipelineClass: 'AutomaticSpeechRecognitionPipeline',
      workflow: 'speech_to_text',
      manifestDefinitionId: 'transformers:AutomaticSpeechRecognitionPipeline:speech_to_text',
      manifestContentHash: 'manifest-content-b',
      executionAdmissionId: 'transformers:admission:AutomaticSpeechRecognitionPipeline:speech_to_text',
    };
  }
  if (kind === 'hub_import') {
    return {
      kind,
      provider: 'diffusers',
      library: 'diffusers',
      repository: 'owner/custom-block',
      repositoryRevision: COMMIT,
    };
  }
  return { kind: 'user' };
}

function definition(kind = 'diffusers_catalog') {
  const blockGraph = graph();
  const registered = kind === 'diffusers_catalog' || kind === 'transformers_catalog';
  const boundary = {
    mode: registered || kind === 'hub_import' ? 'explicit' : 'derived',
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
        portId: 'image',
        label: 'Image',
        valueType: 'image',
        required: false,
        binding: { nodeId: 'generate', fieldOrPortId: 'image' },
      },
    ],
    ...(registered || kind === 'hub_import'
      ? {}
      : {
          derivation: {
            algorithmVersion: 'selection-boundary-v1',
            derivedAtDefinitionHash: blockGraph.graphHash,
          },
        }),
  };
  const withoutHash = {
    schemaVersion: 2,
    definitionId: `${kind}:test-block`,
    displayName: 'Test block',
    description: 'Presentation-only description',
    source: source(kind),
    graph: blockGraph,
    boundary,
    controls: [
      {
        controlId: 'prompt',
        label: 'Prompt',
        binding: { nodeId: 'generate', fieldId: 'prompt' },
        valueType: 'string',
        defaultValue: 'starter prompt',
        required: true,
        order: 0,
      },
    ],
    suggestedInputs: [
      {
        suggestionId: 'publisher-example',
        label: 'Publisher example',
        source: 'https://huggingface.co/owner/model',
        values: { prompt: 'suggested prompt' },
      },
    ],
    previews: [{ nodeId: 'generate', outputPortId: 'image', mediaType: 'image', primary: true }],
    ownership: registered
      ? { kind: 'registered', definitionMutable: false }
      : { kind: 'user', definitionMutable: true },
  };
  return { ...withoutHash, contentHash: schema.blockDefinitionContentHashV2(withoutHash) };
}

test('strict V2 definitions round-trip every source kind and boundary mode', () => {
  for (const kind of ['diffusers_catalog', 'transformers_catalog', 'hub_import', 'user']) {
    const fixture = definition(kind);
    const parsed = schema.normalizeBlockDefinitionV2(JSON.parse(JSON.stringify(fixture)));
    assert.deepEqual(parsed, fixture);
    assert.notEqual(parsed, fixture);
  }
});

test('V2 bindings preserve exact private-style backend field ids', () => {
  const fixture = definition('diffusers_catalog');
  fixture.graph.nodes[1].data.params._auto_resize = { type: 'boolean', default: true };
  fixture.boundary.inputs[0] = {
    ...fixture.boundary.inputs[0],
    valueType: 'boolean',
    binding: { nodeId: 'generate', fieldOrPortId: '_auto_resize' },
  };
  fixture.controls[0] = {
    ...fixture.controls[0],
    valueType: 'boolean',
    defaultValue: true,
    binding: { nodeId: 'generate', fieldId: '_auto_resize' },
  };
  fixture.graph.graphHash = schema.blockGraphHashV2(fixture.graph);
  fixture.contentHash = schema.blockDefinitionContentHashV2(fixture);

  const parsed = schema.normalizeBlockDefinitionV2(fixture);
  assert.equal(parsed.boundary.inputs[0].binding.fieldOrPortId, '_auto_resize');
  assert.equal(parsed.controls[0].binding.fieldId, '_auto_resize');
});

test('client hashes match the backend BlockDefinitionV2 parity fixture', () => {
  // Keep this semantic payload aligned with block_definition_v2() and the
  // asserted hashes in MoDiff/tests/test_studio_blocks.py. The fixed strings
  // make a one-runtime canonicalizer change fail in both repositories.
  const graphWithoutHash = {
    nodes: [
      {
        nodeId: 'load',
        nodeType: 'Diffusers.LoadPipeline',
        data: { params: { enabled: false, count: 0, optional: null } },
        semanticRole: 'loader',
      },
      {
        nodeId: 'generate',
        nodeType: 'Diffusers.Generate',
        data: { params: {} },
        semanticRole: 'denoise',
      },
    ],
    edges: [
      {
        edgeId: 'pipeline-edge',
        sourceNodeId: 'load',
        sourcePortId: 'pipeline',
        targetNodeId: 'generate',
        targetPortId: 'pipeline',
      },
    ],
    executionOrder: ['load', 'generate'],
  };
  const parityGraph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
  const withoutContentHash = {
    schemaVersion: 2,
    definitionId: 'user-block-v2',
    displayName: 'Unit Block V2',
    description: 'A persisted common composite-node definition.',
    source: { kind: 'user' },
    graph: parityGraph,
    boundary: {
      mode: 'explicit',
      inputs: [
        {
          portId: 'prompt-in',
          label: 'Prompt',
          valueType: 'string',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'prompt' },
        },
      ],
      outputs: [
        {
          portId: 'image-out',
          label: 'Image',
          valueType: 'image',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'image' },
        },
      ],
    },
    controls: [
      {
        controlId: 'prompt',
        label: 'Prompt',
        binding: { nodeId: 'generate', fieldId: 'prompt' },
        valueType: 'string',
        defaultValue: '',
        required: true,
        sealed: false,
        order: 0,
        group: 'Generation',
        help: 'Prompt sent to the model.',
      },
      {
        controlId: 'seed',
        label: 'Seed',
        binding: { nodeId: 'generate', fieldId: 'seed' },
        valueType: 'integer',
        defaultValue: 0,
        order: 1,
      },
    ],
    suggestedInputs: [
      {
        suggestionId: 'creator-example',
        label: 'Creator example',
        source: 'Model card',
        values: { prompt: 'A detailed test image', seed: 0 },
      },
    ],
    previews: [{ nodeId: 'generate', outputPortId: 'image', mediaType: 'image', primary: true }],
    ownership: { kind: 'user', definitionMutable: true },
  };
  const parityDefinition = {
    ...withoutContentHash,
    contentHash: schema.blockDefinitionContentHashV2(withoutContentHash),
  };

  assert.equal(parityGraph.graphHash, 'block-graph-v2-d23b144c');
  assert.equal(parityDefinition.contentHash, 'block-definition-v2-dde5d4d9');
  assert.deepEqual(schema.normalizeBlockDefinitionV2(parityDefinition), parityDefinition);
});

test('mirrored controls have cross-runtime hashes and strict canonical bindings', () => {
  const graphWithoutHash = {
    nodes: [
      {
        nodeId: 'generate',
        nodeType: 'Diffusers.Generate',
        data: { params: { prompt: { type: 'string' }, image: { type: 'image', display: 'output' } } },
        semanticRole: 'denoise',
      },
      {
        nodeId: 'prepare',
        nodeType: 'Diffusers.Prepare',
        data: { params: { prompt: { type: 'text' }, image: { type: 'image', display: 'output' } } },
        semanticRole: 'prepare',
      },
    ],
    edges: [],
    executionOrder: ['prepare', 'generate'],
  };
  const mirrorGraph = { ...graphWithoutHash, graphHash: schema.blockGraphHashV2(graphWithoutHash) };
  const withoutHash = {
    schemaVersion: 2,
    definitionId: 'mirrored-control-v2',
    displayName: 'Mirrored Control V2',
    source: { kind: 'user' },
    graph: mirrorGraph,
    boundary: {
      mode: 'explicit',
      inputs: [
        {
          portId: 'prompt',
          label: 'Prompt',
          valueType: 'string',
          required: true,
          binding: { nodeId: 'generate', fieldOrPortId: 'prompt' },
          mirrorBindings: [{ nodeId: 'prepare', fieldOrPortId: 'prompt' }],
        },
      ],
      outputs: [],
    },
    controls: [
      {
        controlId: 'prompt',
        label: 'Prompt',
        binding: { nodeId: 'generate', fieldId: 'prompt' },
        mirrorBindings: [{ nodeId: 'prepare', fieldId: 'prompt' }],
        valueType: 'string',
        defaultValue: '',
        order: 0,
      },
    ],
    suggestedInputs: [],
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  const fixture = { ...withoutHash, contentHash: schema.blockDefinitionContentHashV2(withoutHash) };
  assert.equal(mirrorGraph.graphHash, 'block-graph-v2-79cf79b4');
  assert.equal(fixture.contentHash, 'block-definition-v2-20917ee9');
  assert.deepEqual(schema.normalizeBlockDefinitionV2(fixture), fixture);

  const malformed = [
    { mirrorBindings: [] },
    { mirrorBindings: [{ nodeId: 'generate', fieldId: 'prompt' }] },
    { mirrorBindings: [{ nodeId: 'missing', fieldId: 'prompt' }] },
    { mirrorBindings: [{ nodeId: 'prepare', fieldId: 'image' }] },
    {
      mirrorBindings: [
        { nodeId: 'prepare', fieldId: 'prompt' },
        { nodeId: 'generate', fieldId: 'image' },
      ],
    },
  ];
  malformed.forEach((change) => {
    const candidate = structuredClone(fixture);
    Object.assign(candidate.controls[0], change);
    candidate.contentHash = schema.blockDefinitionContentHashV2(candidate);
    assert.throws(() => schema.normalizeBlockDefinitionV2(candidate), /mirrorBindings|output field/u);
  });

  for (const mirrorBindings of [
    [],
    [{ nodeId: 'generate', fieldOrPortId: 'prompt' }],
    [{ nodeId: 'prepare', fieldOrPortId: 'image' }],
  ]) {
    const candidate = structuredClone(fixture);
    candidate.boundary.inputs[0].mirrorBindings = mirrorBindings;
    candidate.contentHash = schema.blockDefinitionContentHashV2(candidate);
    assert.throws(() => schema.normalizeBlockDefinitionV2(candidate), /mirrorBindings|output field/u);
  }
  const outputMirror = structuredClone(fixture);
  outputMirror.boundary.outputs.push({
    portId: 'image',
    label: 'Image',
    valueType: 'image',
    required: false,
    binding: { nodeId: 'generate', fieldOrPortId: 'image' },
    mirrorBindings: [{ nodeId: 'prepare', fieldOrPortId: 'image' }],
  });
  outputMirror.contentHash = schema.blockDefinitionContentHashV2(outputMirror);
  assert.throws(() => schema.normalizeBlockDefinitionV2(outputMirror), /supported only for public inputs/u);
});

test('canonical hashes ignore array/key ordering and presentation-only definition fields', () => {
  const fixture = definition();
  const reorderedGraph = {
    nodes: [...fixture.graph.nodes]
      .reverse()
      .map((node) => ({ ...node, data: Object.fromEntries(Object.entries(node.data).reverse()) })),
    edges: [...fixture.graph.edges].reverse(),
    executionOrder: fixture.graph.executionOrder,
  };
  assert.equal(schema.blockGraphHashV2(reorderedGraph), fixture.graph.graphHash);
  const presentationVariant = {
    ...fixture,
    displayName: 'Renamed without changing identity',
    description: 'Another description',
    suggestedInputs: [{ suggestionId: 'another', label: 'Another', values: { prompt: 'suggested' } }],
  };
  assert.equal(schema.blockDefinitionContentHashV2(presentationVariant), fixture.contentHash);
  const semanticVariant = structuredClone(fixture);
  semanticVariant.controls[0].defaultValue = 'changed default';
  assert.notEqual(schema.blockDefinitionContentHashV2(semanticVariant), fixture.contentHash);
});

test('presentation is hash-independent and inserted instances do not share values', () => {
  const fixture = definition();
  const first = schema.createBlockInstanceV2(fixture, {
    instanceId: 'instance-one',
    position: { x: 10, y: 20 },
    size: { width: 340, height: 360 },
    values: { prompt: 'first prompt' },
  });
  const second = schema.createBlockInstanceV2(fixture, {
    instanceId: 'instance-two',
    position: { x: 500, y: 20 },
    size: { width: 340, height: 360 },
    values: { prompt: 'second prompt' },
  });
  first.values.prompt = 'edited first prompt';
  assert.equal(second.values.prompt, 'second prompt');
  assert.deepEqual(first.definitionSnapshot, second.definitionSnapshot);
  const moved = structuredClone(first);
  moved.presentation.expanded = true;
  moved.presentation.size = { width: 900, height: 700 };
  moved.presentation.internalLayout.generate = { x: 456, y: 234, width: 500, height: 300 };
  const parsed = schema.normalizeBlockInstanceV2(moved);
  assert.equal(parsed.definitionSnapshot.contentHash, fixture.contentHash);
  assert.equal(parsed.effectiveGraph.graphHash, fixture.graph.graphHash);
});

test('explicit empty values survive round-trip and do not fall back to defaults', () => {
  for (const [suffix, value] of [
    ['empty', ''],
    ['false', false],
    ['zero', 0],
    ['null', null],
  ]) {
    const instance = schema.createBlockInstanceV2(definition(), {
      instanceId: `instance-${suffix}`,
      position: { x: 0, y: 0 },
      size: { width: 340, height: 360 },
      values: { prompt: value },
    });
    const parsed = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(instance)));
    assert.equal(schema.blockInstanceValueV2(parsed, 'prompt'), value);
    assert.equal(parsed.customization.state, 'parameters_changed');
  }
  const missing = schema.createBlockInstanceV2(definition(), {
    instanceId: 'instance-missing',
    position: { x: 0, y: 0 },
    size: { width: 340, height: 360 },
  });
  assert.equal(schema.blockInstanceValueV2(missing, 'prompt'), 'starter prompt');
});

test('effective interface migrates deterministically and rejects stale hashes or bindings', () => {
  const fixture = definition();
  const created = schema.createBlockInstanceV2(fixture, {
    instanceId: 'effective-interface-instance',
    position: { x: 0, y: 0 },
    size: { width: 420, height: 460 },
  });
  const legacy = structuredClone(created);
  delete legacy.effectiveInterface;
  const migrated = schema.normalizeBlockInstanceV2(legacy);
  const baseHash = schema.blockInterfaceHashV2({ boundary: fixture.boundary, controls: fixture.controls });
  assert.deepEqual(migrated.effectiveInterface.boundary, fixture.boundary);
  assert.deepEqual(migrated.effectiveInterface.controls, fixture.controls);
  assert.equal(migrated.effectiveInterface.baseInterfaceHash, baseHash);
  assert.equal(migrated.effectiveInterface.effectiveInterfaceHash, baseHash);

  const renamed = structuredClone(migrated);
  renamed.effectiveInterface.boundary.inputs[0].label = 'Workflow prompt';
  renamed.effectiveInterface.effectiveInterfaceHash = schema.blockInterfaceHashV2(renamed.effectiveInterface);
  renamed.customization.state = 'structure_changed';
  assert.equal(schema.normalizeBlockInstanceV2(renamed).effectiveInterface.boundary.inputs[0].label, 'Workflow prompt');

  const stale = structuredClone(renamed);
  stale.effectiveInterface.effectiveInterfaceHash = 'block-interface-v2-stale';
  assert.throws(() => schema.normalizeBlockInstanceV2(stale), /effectiveInterfaceHash.*must be/u);
  const unknownBinding = structuredClone(renamed);
  unknownBinding.effectiveInterface.boundary.inputs[0].binding.nodeId = 'missing-node';
  unknownBinding.effectiveInterface.effectiveInterfaceHash = schema.blockInterfaceHashV2(
    unknownBinding.effectiveInterface,
  );
  assert.throws(() => schema.normalizeBlockInstanceV2(unknownBinding), /references unknown node/u);
  const wrongState = structuredClone(renamed);
  wrongState.customization.state = 'unchanged';
  assert.throws(() => schema.normalizeBlockInstanceV2(wrongState), /only structure_changed/u);
});

test('validators reject unstable sources, derived registered boundaries, bad hashes, and nested composites', () => {
  const fixture = definition();
  assert.throws(
    () => schema.normalizeBlockDefinitionV2({ ...fixture, source: { ...fixture.source, libraryRevision: undefined } }),
    /registered catalog source requires/u,
  );
  assert.throws(
    () =>
      schema.normalizeBlockDefinitionV2({
        ...fixture,
        boundary: {
          ...fixture.boundary,
          mode: 'derived',
          derivation: { algorithmVersion: 'bad', derivedAtDefinitionHash: fixture.graph.graphHash },
        },
      }),
    /require an explicit boundary/u,
  );
  assert.throws(
    () => schema.normalizeBlockDefinitionV2({ ...fixture, contentHash: 'wrong-hash' }),
    /contentHash must be/u,
  );
  const conflictingSharedField = structuredClone(fixture);
  conflictingSharedField.controls[0].binding = { nodeId: 'loader', fieldId: 'model' };
  conflictingSharedField.contentHash = schema.blockDefinitionContentHashV2(conflictingSharedField);
  assert.throws(
    () => schema.normalizeBlockDefinitionV2(conflictingSharedField),
    /share an id but bind different graph fields/u,
  );
  const collidingPublicPorts = structuredClone(fixture);
  collidingPublicPorts.boundary.outputs[0].portId = collidingPublicPorts.boundary.inputs[0].portId;
  collidingPublicPorts.contentHash = schema.blockDefinitionContentHashV2(collidingPublicPorts);
  assert.throws(() => schema.normalizeBlockDefinitionV2(collidingPublicPorts), /public ports.*duplicate/u);
  const nestedNodes = fixture.graph.nodes.map((node) =>
    node.nodeId === 'generate' ? { ...node, data: { ...node.data, userBlockSnapshot: {} } } : node,
  );
  const nestedUnhashedGraph = { ...fixture.graph, nodes: nestedNodes };
  delete nestedUnhashedGraph.graphHash;
  const nestedGraph = { ...nestedUnhashedGraph, graphHash: schema.blockGraphHashV2(nestedUnhashedGraph) };
  const nestedWithoutHash = { ...fixture, graph: nestedGraph };
  delete nestedWithoutHash.contentHash;
  assert.throws(
    () =>
      schema.normalizeBlockDefinitionV2({
        ...nestedWithoutHash,
        contentHash: schema.blockDefinitionContentHashV2(nestedWithoutHash),
      }),
    /nested User Nodes and Cluster Nodes/u,
  );
  const imported = definition('hub_import');
  const unpinned = { ...imported, source: { ...imported.source, repositoryRevision: 'main' } };
  delete unpinned.contentHash;
  assert.throws(
    () =>
      schema.normalizeBlockDefinitionV2({ ...unpinned, contentHash: schema.blockDefinitionContentHashV2(unpinned) }),
    /repositoryRevision.*malformed/u,
  );
});

test('V1 migration preserves the materialized boundary and removes presentation state from graph identity', () => {
  const legacy = {
    id: 'legacy-user-node',
    name: 'Legacy User Node',
    version: 1,
    nodes: [
      {
        id: 'generate',
        type: 'custom',
        position: { x: 500, y: 700 },
        selected: true,
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Generate',
          uiState: { expanded: true },
          executionProgress: { step: 5 },
          params: {
            prompt: { type: 'string', value: 'legacy starter' },
            image: { display: 'ui_image', type: 'image' },
          },
        },
      },
    ],
    edges: [],
    inputs: [{ id: 'public-prompt', label: 'Prompt', nodeId: 'generate', paramKey: 'prompt', type: 'string' }],
    outputs: [{ id: 'public-image', label: 'Image', nodeId: 'generate', paramKey: 'image', type: 'image' }],
    exposedParams: [
      { id: 'prompt-control', kind: 'graph-param', label: 'Prompt', nodeId: 'generate', paramKey: 'prompt' },
    ],
    createdAt: 1,
    updatedAt: 2,
  };
  const migrated = schema.migrateUserBlockDefinitionV1(legacy);
  assert.equal(migrated.boundary.mode, 'derived');
  assert.deepEqual(
    migrated.boundary.inputs.map(({ portId }) => portId),
    ['public-prompt'],
  );
  assert.deepEqual(
    migrated.boundary.outputs.map(({ portId }) => portId),
    ['public-image'],
  );
  assert.equal(migrated.controls[0].defaultValue, 'legacy starter');
  assert.equal(migrated.previews[0].outputPortId, 'image');
  assert.equal('position' in migrated.graph.nodes[0], false);
  assert.equal('uiState' in migrated.graph.nodes[0].data, false);
  assert.equal('executionProgress' in migrated.graph.nodes[0].data, false);
  assert.deepEqual(schema.normalizeBlockDefinitionV2(JSON.parse(JSON.stringify(migrated))), migrated);
});

test('client and backend V1 migration fixtures share the effective-interface hash', () => {
  const legacy = {
    id: 'portrait-user-node',
    name: 'Portrait User Node',
    version: 1,
    nodes: [
      {
        id: 'generate',
        type: 'custom',
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        data: {
          type: 'custom',
          module: 'modules.Test',
          action: 'Pass',
          label: 'generate',
          params: {
            prompt: { label: 'Prompt', type: 'string', value: 'creator default' },
            image: { label: 'Image', type: 'image', value: null, display: 'output' },
          },
        },
      },
    ],
    edges: [],
    inputs: [{ id: 'prompt-in', label: 'Prompt', nodeId: 'generate', paramKey: 'prompt', type: 'string' }],
    outputs: [{ id: 'image-out', label: 'Image', nodeId: 'generate', paramKey: 'image', type: 'image' }],
    exposedParams: [],
    createdAt: 1,
    updatedAt: 2,
    origin: {
      schemaVersion: 1,
      kind: 'hugging_face_cluster_fork',
      provider: 'diffusers',
      definitionId: 'qwen:text-to-image',
      libraryRevision: 'a'.repeat(40),
      contentHash: `sha256:${'b'.repeat(64)}`,
      pipelineClass: 'QwenImageModularPipeline',
      workflowId: 'text_to_image',
      importedAt: 1,
    },
  };
  const migrated = schema.migrateUserBlockDefinitionV1(legacy);
  assert.equal(migrated.graph.graphHash, 'block-graph-v2-02237c60');
  assert.equal(migrated.contentHash, 'block-definition-v2-f1da4518');
  assert.equal(
    schema.blockInterfaceHashV2({ boundary: migrated.boundary, controls: migrated.controls }),
    'block-interface-v2-63fe84a5',
  );
});
