import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let adapter;
let routes;
let reviewedGraph;
let runtime;
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
  adapter = await server.ssrLoadModule('/src/studio/registeredBlockAdapterV2.ts');
  routes = await server.ssrLoadModule('/src/studio/registeredBlockV2Routes.ts');
  reviewedGraph = await server.ssrLoadModule('/src/studio/reviewedModularGraphV2.ts');
  runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  schema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
});

after(async () => {
  await server?.close();
});

test('reviewed Modular block defaults are compact and content-aware without merging semantic nodes', () => {
  const node = (params) => ({ data: { params } });
  assert.deepEqual(reviewedGraph.reviewedModularNodeDefaultSizeV2(node({}), 'loop_before'), {
    width: 340,
    height: 132,
  });
  assert.deepEqual(
    reviewedGraph.reviewedModularNodeDefaultSizeV2(node({ steps: { type: 'int', value: 20 } }), 'timesteps'),
    { width: 340, height: 240 },
  );
  assert.deepEqual(
    reviewedGraph.reviewedModularNodeDefaultSizeV2(
      node({ prompt: { type: 'text', display: 'textarea', value: 'creator prompt' } }),
      'prompt',
    ),
    { width: 340, height: 400 },
  );
  assert.deepEqual(reviewedGraph.reviewedModularNodeDefaultSizeV2(node({}), 'models'), {
    width: 340,
    height: 400,
  });
});

test('explicit compact layout rewrites presentation only and keeps every Modular block separate', () => {
  const modular = (nodeId, semanticRole, params) => ({
    nodeId,
    nodeType: 'custom',
    semanticRole,
    data: { params },
    modularDiffusers: {
      kind: 'upstream_block',
      pipelineClass: 'QwenImageModularPipeline',
      blocksClass: 'QwenImageAutoBlocks',
      workflowId: 'text2image',
      libraryRevision: 'a'.repeat(40),
      runtimeRole: semanticRole,
    },
  });
  const instance = {
    definitionSnapshot: { source: { kind: 'diffusers_catalog' } },
    effectiveGraph: {
      nodes: [
        modular('models', 'models', {}),
        modular('prompt', 'prompt', { prompt: { type: 'text', display: 'textarea', value: 'kept' } }),
        modular('loop-before', 'loop_before', {}),
        modular('timesteps', 'timesteps', { steps: { type: 'int', value: 50 } }),
        modular('decode', 'decode', {}),
      ],
      edges: [{ edgeId: 'kept-edge' }],
      executionOrder: ['models', 'prompt', 'timesteps', 'loop-before', 'decode'],
    },
    presentation: {
      internalLayout: { models: { x: 999, y: 999, width: 900, height: 900 } },
    },
    values: { prompt: 'kept value' },
  };
  const semanticBefore = structuredClone({
    graph: instance.effectiveGraph,
    source: instance.definitionSnapshot.source,
    values: instance.values,
  });
  const layout = reviewedGraph.compactReviewedModularInternalLayoutV2(instance);

  assert.equal(Object.keys(layout).length, instance.effectiveGraph.nodes.length);
  assert.deepEqual(layout.models, { x: 48, y: 104, width: 340, height: 400 });
  assert.deepEqual(layout.prompt, { x: 438, y: 104, width: 340, height: 400 });
  assert.deepEqual(layout.timesteps, { x: 828, y: 104, width: 340, height: 240 });
  assert.deepEqual(layout['loop-before'], { x: 1218, y: 104, width: 340, height: 132 });
  assert.deepEqual(layout.decode, { x: 48, y: 576, width: 340, height: 132 });
  assert.deepEqual(
    { graph: instance.effectiveGraph, source: instance.definitionSnapshot.source, values: instance.values },
    semanticBefore,
  );
});

const field = (name, type, required, defaultValue, description = '') => ({
  name,
  type,
  required,
  default: defaultValue,
  description,
});

function fixtureDefinition(provider = 'diffusers') {
  const diffusers = provider === 'diffusers';
  const definitionId = diffusers
    ? 'diffusers.modular:FixturePipeline:text2image'
    : 'transformers.composite:FixtureSpeechPipeline:speech_to_text';
  const admissionId = diffusers
    ? 'diffusers.cluster-admission:FixturePipeline:text2image:mode:text_to_image'
    : 'transformers.cluster-admission:FixtureSpeechPipeline:speech_to_text';
  const adapterContractId = diffusers
    ? 'diffusers.modular-adapter:FixturePipeline:text2image:mode:text_to_image'
    : 'transformers.composite-adapter:FixtureSpeechPipeline:speech_to_text';
  const pipelineClass = diffusers ? 'FixturePipeline' : 'FixtureSpeechPipeline';
  const artifactRepo = diffusers ? 'fixture/image-model' : 'fixture/speech-model';
  const revision = diffusers ? 'a'.repeat(40) : 'b'.repeat(40);
  const admission = {
    schemaVersion: 4,
    id: admissionId,
    definitionId,
    studioMode: diffusers ? 'text_to_image' : 'speech_to_text',
    bindingSources: ['artifact', 'doSample', 'negativePrompt', 'prompt', 'revision', 'seed', 'steps'],
    instanceInputBindings: [
      { bindingSource: 'prompt', input: 'prompt' },
      { bindingSource: 'negativePrompt', input: 'negativePrompt' },
    ],
    executionParameterSources: ['steps', 'doSample', 'seed'],
    sealedBindingValues: { artifact: artifactRepo, revision },
    modelDependencies: [{ id: 'model', kind: 'model', repo: artifactRepo, revision }],
    dynamicFieldActions: [],
    adapterContractId,
    studioExecutionSpec: {
      id: `${pipelineClass}.fixture`,
      contentHash: 'studio-spec-v1-1234abcd',
      executionProfileId: 'fixture-profile',
    },
    artifact: { repo: artifactRepo, revision },
    status: 'admitted',
    claim: 'static_graph_contract_compatible',
    executable: false,
    publication: {
      schemaVersion: 1,
      readiness: 'graph_qualified',
      insertable: true,
      executable: false,
      autoEligible: false,
      liveProof: false,
      reasons: [],
    },
    reasons: [],
  };
  return {
    schemaVersion: 6,
    id: definitionId,
    provider,
    publisher: 'huggingface',
    surface: diffusers ? 'diffusers_cluster_nodes' : 'transformers_cluster_nodes',
    definitionKind: diffusers ? 'modular_pipeline_workflow' : 'studio_execution_composite',
    ownership: 'library',
    mutable: false,
    libraryRevision: 'c'.repeat(40),
    pipelineClass,
    blocksClass: diffusers ? 'FixtureBlocks' : 'AutomaticSpeechRecognitionPipeline',
    pipelineKind: 'sequential',
    workflowId: diffusers ? 'text2image' : 'speech_to_text',
    workflowKind: 'sequential',
    taskId: diffusers ? 'text_to_image' : 'speech_to_text',
    taskContractId: diffusers ? 'diffusers.task.text_to_image.v1' : 'transformers.task.speech_to_text.v1',
    label: diffusers ? 'Fixture — Text To Image' : 'Fixture — Speech To Text',
    description: 'Registered fixture used to prove the shared V2 adapter.',
    integrationStatus: diffusers ? 'reviewed_modiff_contract' : 'reviewed_transformers_contract',
    executionClaim: 'discovery_only',
    executionAdmissions: [admission],
    graphAdapterContracts: [
      {
        schemaVersion: 1,
        id: adapterContractId,
        source: diffusers ? 'mode' : 'workflow',
        adapterId: diffusers ? 'text_to_image' : 'speech_to_text',
        upstreamWorkflowId: diffusers ? 'text2image' : 'speech_to_text',
        requiredInputs: ['prompt'],
        actionSequence: ['loadModels', 'generate', 'preview'],
        stateEdges: [],
        upstreamBlockSequence: [],
      },
    ],
    inputs: [
      field('prompt', 'str', true, '', 'Creator prompt.'),
      field('negativePrompt', 'str', false, '', 'Creator negative prompt.'),
    ],
    outputs: [field('images', 'list[image]', true, null)],
    requiredInputs: ['prompt'],
    requiredInputAlternatives: [],
    stateKeys: [],
    components: [],
    steps: [],
    blockContractHash: `sha256:${'d'.repeat(64)}`,
    rootBlockDefinitionId: diffusers
      ? `diffusers.modular-block:FixtureBlocks:sha256:${'e'.repeat(64)}`
      : `transformers.composite-block:AutomaticSpeechRecognitionPipeline:sha256:${'e'.repeat(64)}`,
    blockPlacements: [],
    suggestedInputs: {
      schemaVersion: 1,
      values: { prompt: 'A publisher-provided lighthouse at blue hour.' },
      source: {
        kind: 'publisher_example',
        label: 'Fixture model card example',
        url: 'https://huggingface.co/fixture/model',
      },
    },
    contentHash: `sha256:${'f'.repeat(64)}`,
  };
}

function binding(admissionId, source, persistence, input) {
  return {
    schemaVersion: 1,
    admissionId,
    source,
    persistence,
    ...(input ? { input } : {}),
  };
}

function fixtureSkeleton(definition, instanceId, overrides = {}) {
  const admission = definition.executionAdmissions[0];
  const node = (role, x, params) => ({
    id: `${instanceId}__${role}`,
    type: 'custom',
    parentId: instanceId,
    position: { x: x + (overrides.positionOffset ?? 0), y: 24 },
    width: 320 + (overrides.widthOffset ?? 0),
    height: 240,
    selected: Boolean(overrides.selected),
    dragging: Boolean(overrides.selected),
    hidden: Boolean(overrides.hidden),
    data: {
      type: 'custom',
      module: 'modules.Fixture',
      action: role,
      label: `Presentation label ${role}`,
      category: 'Presentation category',
      description: 'Presentation-only copy.',
      params,
      progress: overrides.progress ?? 0,
      activeTaskId: overrides.taskId ?? null,
      executionStatus: overrides.executionStatus ?? 'queued',
      executionProgress: { current: overrides.progress ?? 0, total: 10 },
      uiState: {
        disabled: true,
        validationSeverity: 'warning',
        validationMessage: overrides.validationMessage ?? 'Volatile runtime state.',
      },
      huggingFaceClusterRole: 'execution',
      huggingFaceClusterInstanceId: instanceId,
      huggingFaceClusterSemanticId: `${instanceId}:${role}`,
      huggingFaceClusterExecutionAdmissionId: admission.id,
      huggingFaceClusterExecutionSpecId: admission.studioExecutionSpec.id,
      huggingFaceClusterExecutionRole: role,
      huggingFaceClusterExecutionPosition: { x, y: 24 },
    },
  });
  const load = node('loadModels', 0, {
    repository: {
      type: 'string',
      value: admission.artifact.repo,
      disabled: true,
      fieldOptions: {
        huggingFaceClusterBinding: binding(admission.id, 'artifact', 'sealed'),
        suppressInitialFieldAction: true,
      },
    },
    revision: {
      type: 'string',
      value: admission.artifact.revision,
      disabled: true,
      fieldOptions: { huggingFaceClusterBinding: binding(admission.id, 'revision', 'sealed') },
    },
    components: { display: 'output', type: 'pipeline_components', value: overrides.outputArtifact },
  });
  const generate = node('generate', 380, {
    components: { display: 'input', type: 'pipeline_components', isConnected: true, signal: { value: {} } },
    prompt: {
      type: 'string',
      display: 'textarea',
      value: overrides.prompt ?? 'A current workflow prompt.',
      default: '',
      required: true,
      fieldOptions: { huggingFaceClusterBinding: binding(admission.id, 'prompt', 'instance_input', 'prompt') },
    },
    negative_prompt: {
      type: 'string',
      display: 'textarea',
      value: Object.hasOwn(overrides, 'negativePrompt') ? overrides.negativePrompt : '',
      default: '',
      fieldOptions: {
        huggingFaceClusterBinding: binding(admission.id, 'negativePrompt', 'instance_input', 'negativePrompt'),
      },
    },
    steps: {
      type: 'int',
      value: overrides.steps ?? 8,
      default: 28,
      fieldOptions: { huggingFaceClusterBinding: binding(admission.id, 'steps', 'execution_parameter') },
    },
    do_sample: {
      type: 'bool',
      value: Object.hasOwn(overrides, 'doSample') ? overrides.doSample : false,
      default: true,
      fieldOptions: { huggingFaceClusterBinding: binding(admission.id, 'doSample', 'execution_parameter') },
    },
    seed: {
      type: 'int',
      value: Object.hasOwn(overrides, 'seed') ? overrides.seed : null,
      default: null,
      fieldOptions: { huggingFaceClusterBinding: binding(admission.id, 'seed', 'execution_parameter') },
    },
    images: {
      display: 'output',
      type: 'list[image]',
      value: overrides.outputArtifact ?? '/volatile/output-a.png',
      artifacts: [{ path: overrides.outputArtifact ?? '/volatile/output-a.png' }],
    },
  });
  const preview = node('preview', 760, {
    images: {
      display: 'ui_image',
      type: 'list[image]',
      value: overrides.outputArtifact ?? '/volatile/output-a.png',
      artifacts: [{ path: overrides.outputArtifact ?? '/volatile/output-a.png' }],
      isConnected: true,
    },
  });
  const edges = [
    {
      id: `${instanceId}__edge-components`,
      source: load.id,
      sourceHandle: 'components',
      target: generate.id,
      targetHandle: 'components',
      hidden: Boolean(overrides.hidden),
    },
    {
      id: `${instanceId}__edge-images`,
      source: generate.id,
      sourceHandle: 'images',
      target: preview.id,
      targetHandle: 'images',
      hidden: Boolean(overrides.hidden),
    },
  ];
  return {
    schemaVersion: 1,
    definitionId: definition.id,
    instanceId,
    admissionId: admission.id,
    adapterContractId: admission.adapterContractId,
    studioExecutionSpec: { ...admission.studioExecutionSpec },
    claim: 'materialized_graph_skeleton',
    executable: false,
    bindingsComplete: true,
    nodes: [load, generate, preview],
    edges,
    nodeIdsByRole: { loadModels: load.id, generate: generate.id, preview: preview.id },
    missingBindingSources: [],
    pendingFields: [],
  };
}

test('registered compilation freezes one explicit semantic definition and keeps insertion state separate', () => {
  const definition = fixtureDefinition();
  const skeleton = fixtureSkeleton(definition, 'legacy-cluster-a', {
    prompt: 'A workflow-specific copper observatory.',
    negativePrompt: '',
    steps: 0,
    doSample: false,
    seed: null,
    outputArtifact: '/tmp/private-preview.png',
    progress: 7,
    taskId: 'volatile-task',
    selected: true,
  });
  const compiled = adapter.compileRegisteredBlockV2(definition, skeleton, {
    instanceId: 'block-instance-a',
    position: { x: 100, y: 200 },
    size: { width: 640, height: 720 },
    expanded: true,
  });

  assert.deepEqual(schema.normalizeBlockDefinitionV2(compiled.definition), compiled.definition);
  assert.deepEqual(schema.normalizeBlockInstanceV2(compiled.instance), compiled.instance);
  assert.equal(compiled.definition.definitionId, definition.executionAdmissions[0].id);
  assert.equal(compiled.definition.source.kind, 'diffusers_catalog');
  assert.equal(compiled.definition.source.catalogCategory, 'diffusers');
  assert.equal(compiled.definition.source.provider, 'huggingface');
  assert.equal(compiled.definition.source.libraryRevision, definition.libraryRevision);
  assert.equal(compiled.definition.source.manifestDefinitionId, definition.id);
  assert.equal(compiled.definition.source.executionAdmissionId, definition.executionAdmissions[0].id);
  assert.equal(compiled.definition.source.manifestContentHash, definition.contentHash);
  assert.equal(compiled.definition.source.repository, definition.executionAdmissions[0].artifact.repo);
  assert.equal(compiled.definition.source.repositoryRevision, definition.executionAdmissions[0].artifact.revision);
  assert.deepEqual(compiled.definition.ownership, { kind: 'registered', definitionMutable: false });
  assert.equal(compiled.definition.boundary.mode, 'explicit');
  assert.deepEqual(
    compiled.definition.boundary.inputs.map(({ portId }) => portId),
    ['prompt', 'negativePrompt'],
  );
  assert.deepEqual(
    compiled.definition.boundary.outputs.map(({ portId }) => portId),
    ['images'],
  );
  assert.deepEqual(
    compiled.definition.controls.map(({ controlId, order }) => [controlId, order]),
    [
      ['prompt', 0],
      ['negativePrompt', 1],
      ['steps', 2],
      ['doSample', 3],
      ['seed', 4],
    ],
  );
  assert.deepEqual(compiled.definition.suggestedInputs, [
    {
      suggestionId: 'creator-example',
      label: 'Fixture model card example',
      source: 'https://huggingface.co/fixture/model',
      values: { prompt: 'A publisher-provided lighthouse at blue hour.' },
    },
  ]);
  assert.deepEqual(compiled.definition.previews, [
    { nodeId: 'preview', outputPortId: 'images', mediaType: 'image', primary: true },
  ]);
  assert.deepEqual(compiled.instance.values, {
    prompt: 'A workflow-specific copper observatory.',
    negativePrompt: '',
    steps: 0,
    doSample: false,
    seed: null,
  });
  // Values materialized by the reviewed route compiler establish this
  // insertion's baseline. Only a later workflow edit makes it customized.
  assert.equal(compiled.instance.customization.state, 'unchanged');
  assert.deepEqual(compiled.instance.presentation.position, { x: 100, y: 200 });
  assert.deepEqual(compiled.instance.presentation.size, { width: 640, height: 720 });
  assert.equal(compiled.instance.presentation.expanded, true);
  assert.deepEqual(compiled.instance.authorities, []);
  assert.deepEqual(compiled.instance.previewStates, [
    {
      binding: { nodeId: 'preview', outputPortId: 'images', mediaType: 'image', primary: true },
      status: 'idle',
    },
  ]);
  assert.notStrictEqual(compiled.instance.definitionSnapshot, compiled.definition);
  assert.equal(schema.blockGraphHashV2(compiled.definition.graph), compiled.definition.graph.graphHash);
  assert.equal(schema.blockDefinitionContentHashV2(compiled.definition), compiled.definition.contentHash);

  const serializedDefinition = JSON.stringify(compiled.definition);
  assert.doesNotMatch(serializedDefinition, /legacy-cluster-a|volatile-task|private-preview|progress|uiState/u);
  assert.doesNotMatch(
    serializedDefinition,
    /huggingFaceCluster/u,
    'the source-neutral V2 graph must not retain legacy Cluster binding or admission authority',
  );
  assert.doesNotMatch(serializedDefinition, /workflow-specific copper observatory/u);
  assert.match(serializedDefinition, new RegExp(definition.executionAdmissions[0].artifact.repo, 'u'));
});

test('same-family model selection is one ordinary value edit and preserves the exact graph and layout', () => {
  const definition = fixtureDefinition();
  const admission = definition.executionAdmissions[0];
  admission.bindingSources.push('modelVariant');
  admission.executionParameterSources.push('modelVariant');
  const skeleton = fixtureSkeleton(definition, 'legacy-model-variant');
  const loader = skeleton.nodes.find((node) => node.data.huggingFaceClusterExecutionRole === 'loadModels');
  loader.data.params.reviewed_variant = {
    type: 'string',
    label: 'Model',
    value: 'Qwen/Qwen-Image-2512',
    default: 'Qwen/Qwen-Image-2512',
    options: ['Qwen/Qwen-Image', 'Qwen/Qwen-Image-2512'],
    fieldOptions: {
      huggingFaceClusterBinding: binding(admission.id, 'modelVariant', 'execution_parameter'),
    },
  };
  const compiled = adapter.compileRegisteredBlockV2(definition, skeleton, {
    instanceId: 'same-family-model-instance',
  });
  const control = compiled.definition.controls.find(({ controlId }) => controlId === 'modelVariant');
  assert.ok(control);
  assert.equal(control.sealed, undefined);
  assert.deepEqual(control.binding, { nodeId: 'loadModels', fieldId: 'reviewed_variant' });
  const reviewedVariantParam = compiled.definition.graph.nodes.find(({ nodeId }) => nodeId === 'loadModels').data.params
    .reviewed_variant;
  assert.deepEqual(reviewedVariantParam.options, ['Qwen/Qwen-Image', 'Qwen/Qwen-Image-2512']);
  assert.equal(reviewedVariantParam.disabled, undefined);
  const projectedModelControl = runtime.blockViewModelV2(compiled.instance).controlParams.modelVariant;
  assert.equal(projectedModelControl.label, 'Model');
  assert.equal(projectedModelControl.hidden, false);

  const before = structuredClone(compiled.instance);
  const switched = runtime.setBlockInstanceValueV2(before, 'modelVariant', 'Qwen/Qwen-Image');
  assert.equal(switched.values.modelVariant, 'Qwen/Qwen-Image');
  assert.equal(switched.definitionRef.definitionId, before.definitionRef.definitionId);
  assert.equal(switched.definitionRef.contentHash, before.definitionRef.contentHash);
  assert.deepEqual(switched.definitionSnapshot, before.definitionSnapshot);
  assert.deepEqual(switched.effectiveGraph, before.effectiveGraph);
  assert.deepEqual(switched.effectiveInterface, before.effectiveInterface);
  assert.deepEqual(switched.presentation, before.presentation);
  assert.equal(switched.customization.state, 'parameters_changed');

  const restored = schema.normalizeBlockInstanceV2(JSON.parse(JSON.stringify(switched)));
  assert.equal(restored.values.modelVariant, 'Qwen/Qwen-Image');
  assert.deepEqual(restored.effectiveGraph, before.effectiveGraph);
  assert.deepEqual(restored.presentation.internalLayout, before.presentation.internalLayout);
});

test('definition and hashes ignore workflow ids, mutable values, layout, previews, and run UI state', () => {
  const source = fixtureDefinition();
  const left = adapter.compileRegisteredBlockV2(
    source,
    fixtureSkeleton(source, 'legacy-left', {
      prompt: 'Left prompt',
      steps: 4,
      outputArtifact: '/tmp/left.png',
      progress: 1,
      validationMessage: 'Left run',
    }),
    { instanceId: 'instance-left', position: { x: 0, y: 0 } },
  );
  const right = adapter.compileRegisteredBlockV2(
    source,
    fixtureSkeleton(source, 'legacy-right', {
      prompt: 'Right prompt',
      steps: 17,
      outputArtifact: '/tmp/right.png',
      positionOffset: 900,
      widthOffset: 140,
      hidden: true,
      selected: true,
      progress: 9,
      validationMessage: 'Right run',
    }),
    { instanceId: 'instance-right', position: { x: 500, y: 700 } },
  );

  assert.deepEqual(left.definition, right.definition);
  assert.equal(left.definition.graph.graphHash, right.definition.graph.graphHash);
  assert.equal(left.definition.contentHash, right.definition.contentHash);
  assert.notDeepEqual(left.instance.values, right.instance.values);
  assert.notDeepEqual(left.instance.presentation.internalLayout, right.instance.presentation.internalLayout);
  assert.notEqual(left.instance.instanceId, right.instance.instanceId);
  assert.deepEqual(left.semanticNodeIdsByMaterializedNodeId, {
    'legacy-left__loadModels': 'loadModels',
    'legacy-left__generate': 'generate',
    'legacy-left__preview': 'preview',
  });
  assert.deepEqual(right.semanticNodeIdsByMaterializedNodeId, {
    'legacy-right__loadModels': 'loadModels',
    'legacy-right__generate': 'generate',
    'legacy-right__preview': 'preview',
  });

  const leftDefinitionBeforeMutation = structuredClone(left.definition);
  left.instance.values.prompt = 'Mutated after compilation';
  left.instance.definitionSnapshot.graph.nodes[0].data.instanceOnlyMutation = true;
  assert.deepEqual(left.definition, leftDefinitionBeforeMutation);
  assert.equal(right.instance.values.prompt, 'Right prompt');
  assert.equal('instanceOnlyMutation' in right.instance.definitionSnapshot.graph.nodes[0].data, false);
});

test('explicit false field-action busy flags are non-semantic while disabled true remains reviewed schema', () => {
  const source = fixtureDefinition();
  const absentSkeleton = fixtureSkeleton(source, 'legacy-disabled-absent');
  const falseSkeleton = fixtureSkeleton(source, 'legacy-disabled-false');
  const trueSkeleton = fixtureSkeleton(source, 'legacy-disabled-true');
  const absentSteps = absentSkeleton.nodes.find((node) => node.data.huggingFaceClusterExecutionRole === 'generate').data
    .params.steps;
  const falseSteps = falseSkeleton.nodes.find((node) => node.data.huggingFaceClusterExecutionRole === 'generate').data
    .params.steps;
  const trueSteps = trueSkeleton.nodes.find((node) => node.data.huggingFaceClusterExecutionRole === 'generate').data
    .params.steps;
  assert.equal(Object.hasOwn(absentSteps, 'disabled'), false);
  falseSteps.disabled = false;
  trueSteps.disabled = true;

  const absent = adapter.compileRegisteredBlockV2(source, absentSkeleton, {
    instanceId: 'disabled-absent-instance',
  });
  const explicitFalse = adapter.compileRegisteredBlockV2(source, falseSkeleton, {
    instanceId: 'disabled-false-instance',
  });
  const explicitTrue = adapter.compileRegisteredBlockV2(source, trueSkeleton, {
    instanceId: 'disabled-true-instance',
  });

  assert.deepEqual(explicitFalse.definition, absent.definition);
  assert.equal(explicitFalse.definition.graph.graphHash, absent.definition.graph.graphHash);
  assert.equal(explicitFalse.definition.contentHash, absent.definition.contentHash);
  assert.notEqual(explicitTrue.definition.graph.graphHash, absent.definition.graph.graphHash);
  assert.notEqual(explicitTrue.definition.contentHash, absent.definition.contentHash);
  assert.equal(
    explicitTrue.definition.graph.nodes.find(({ nodeId }) => nodeId === 'generate').data.params.steps.disabled,
    true,
  );
});

test('semantic definition order is stable when the materialized node and edge arrays are permuted', () => {
  const source = fixtureDefinition();
  const canonicalSkeleton = fixtureSkeleton(source, 'legacy-canonical', { prompt: 'Same prompt', steps: 12 });
  const permutedSkeleton = fixtureSkeleton(source, 'legacy-permuted', { prompt: 'Same prompt', steps: 12 });
  permutedSkeleton.nodes.reverse();
  permutedSkeleton.edges.reverse();
  permutedSkeleton.nodes.forEach((node) => {
    node.data.params = Object.fromEntries(Object.entries(node.data.params).reverse());
  });
  const canonical = adapter.compileRegisteredBlockV2(source, canonicalSkeleton, {
    instanceId: 'canonical-instance',
  });
  const permuted = adapter.compileRegisteredBlockV2(source, permutedSkeleton, {
    instanceId: 'permuted-instance',
  });
  assert.deepEqual(permuted.definition, canonical.definition);
  assert.equal(permuted.definition.graph.graphHash, canonical.definition.graph.graphHash);
  assert.equal(permuted.definition.contentHash, canonical.definition.contentHash);
  assert.deepEqual(permuted.definition.graph.executionOrder, ['loadModels', 'generate', 'preview']);
});

test('Transformers registrations use the same schema and renderer-neutral source contract', () => {
  const definition = fixtureDefinition('transformers');
  const compiled = adapter.compileRegisteredBlockV2(
    definition,
    fixtureSkeleton(definition, 'legacy-transformers', { prompt: 'Transcribe the clip.' }),
    { instanceId: 'transformers-instance' },
  );
  assert.equal(compiled.definition.source.kind, 'transformers_catalog');
  assert.equal(compiled.definition.source.catalogCategory, 'transformers');
  assert.equal(compiled.definition.source.library, 'transformers');
  assert.deepEqual(compiled.definition.ownership, { kind: 'registered', definitionMutable: false });
  assert.equal(compiled.definition.boundary.mode, 'explicit');
  assert.deepEqual(schema.normalizeBlockInstanceV2(compiled.instance), compiled.instance);
});

test('reviewed execution-parameter fan-out compiles one logical mirrored control and rejects drift', () => {
  const definition = fixtureDefinition();
  const skeleton = fixtureSkeleton(definition, 'legacy-fan-out', { steps: 12 });
  skeleton.nodes[2].data.params.steps = {
    type: 'integer',
    value: 12,
    default: 28,
    fieldOptions: {
      huggingFaceClusterBinding: binding(definition.executionAdmissions[0].id, 'steps', 'execution_parameter'),
    },
  };
  const route = {
    boundary: {
      outputs: [
        { portId: 'images', role: 'generate', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' },
      ],
    },
    controlFanOuts: [
      {
        source: 'steps',
        persistence: 'execution_parameter',
        primary: { role: 'generate', fieldId: 'steps' },
        mirrors: [{ role: 'preview', fieldId: 'steps' }],
      },
    ],
  };
  assert.throws(
    () => adapter.compileRegisteredBlockV2(definition, skeleton, { instanceId: 'fan-out-unreviewed' }),
    /one exact reviewed fan-out/u,
  );
  const compiled = adapter.compileRegisteredBlockV2(definition, skeleton, {
    instanceId: 'fan-out-reviewed',
    route,
  });
  const steps = compiled.definition.controls.find(({ controlId }) => controlId === 'steps');
  assert.deepEqual(steps.binding, { nodeId: 'generate', fieldId: 'steps' });
  assert.deepEqual(steps.mirrorBindings, [{ nodeId: 'preview', fieldId: 'steps' }]);
  assert.equal(compiled.instance.values.steps, 12);

  const drifted = structuredClone(skeleton);
  drifted.nodes[2].data.params.steps.value = 13;
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, drifted, {
        instanceId: 'fan-out-value-drift',
        route,
      }),
    /disagreeing defaults or initial values/u,
  );

  const publicInputFanOut = fixtureSkeleton(definition, 'legacy-public-input-fan-out');
  publicInputFanOut.nodes[2].data.params.prompt = {
    type: 'string',
    value: 'A current workflow prompt.',
    default: '',
    fieldOptions: {
      huggingFaceClusterBinding: binding(definition.executionAdmissions[0].id, 'prompt', 'instance_input', 'prompt'),
    },
  };
  const publicInputCompiled = adapter.compileRegisteredBlockV2(definition, publicInputFanOut, {
    instanceId: 'public-input-fan-out',
    route: {
      boundary: route.boundary,
      controlFanOuts: [
        {
          source: 'prompt',
          persistence: 'instance_input',
          primary: { role: 'generate', fieldId: 'prompt' },
          mirrors: [{ role: 'preview', fieldId: 'prompt' }],
        },
      ],
    },
  });
  const promptControl = publicInputCompiled.definition.controls.find(({ controlId }) => controlId === 'prompt');
  const promptPort = publicInputCompiled.definition.boundary.inputs.find(({ portId }) => portId === 'prompt');
  assert.deepEqual(promptControl.mirrorBindings, [{ nodeId: 'preview', fieldId: 'prompt' }]);
  assert.deepEqual(promptPort.mirrorBindings, [{ nodeId: 'preview', fieldOrPortId: 'prompt' }]);
});

test('mutable output receipts remain observations and cannot become mirror destinations', () => {
  const definition = fixtureDefinition();
  const skeleton = fixtureSkeleton(definition, 'legacy-observed-output', { steps: 12 });
  skeleton.nodes[2].data.params.observed_steps = {
    display: 'output',
    type: 'int',
    fieldOptions: {
      huggingFaceClusterBinding: binding(definition.executionAdmissions[0].id, 'steps', 'execution_parameter'),
    },
  };
  const compiled = adapter.compileRegisteredBlockV2(definition, skeleton, {
    instanceId: 'observed-output',
  });
  const steps = compiled.definition.controls.find(({ controlId }) => controlId === 'steps');
  assert.deepEqual(steps.binding, { nodeId: 'generate', fieldId: 'steps' });
  assert.equal(steps.mirrorBindings, undefined);

  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, skeleton, {
        instanceId: 'observed-output-smuggled',
        route: {
          boundary: {
            outputs: [
              {
                portId: 'images',
                role: 'generate',
                fieldId: 'images',
                adaptation: 'direct_media',
                mediaType: 'image',
              },
            ],
          },
          controlFanOuts: [
            {
              source: 'steps',
              persistence: 'execution_parameter',
              primary: { role: 'generate', fieldId: 'steps' },
              mirrors: [{ role: 'preview', fieldId: 'observed_steps' }],
            },
          ],
        },
      }),
    /declares fan-out but resolves to one graph field/u,
  );
});

test('reviewed public aliases keep catalog labels and bindings while making port ids unique', () => {
  const definition = fixtureDefinition();
  const skeleton = fixtureSkeleton(definition, 'legacy-public-alias');
  const route = {
    boundary: {
      inputs: [
        {
          portId: 'prompt_input',
          inputName: 'prompt',
          role: 'generate',
          fieldId: 'prompt',
        },
      ],
      outputs: [
        {
          portId: 'images_output',
          outputName: 'images',
          role: 'generate',
          fieldId: 'images',
          adaptation: 'direct_media',
          mediaType: 'image',
        },
      ],
    },
  };
  const compiled = adapter.compileRegisteredBlockV2(definition, skeleton, {
    instanceId: 'public-alias',
    route,
  });
  const input = compiled.definition.boundary.inputs.find(({ portId }) => portId === 'prompt_input');
  const output = compiled.definition.boundary.outputs.find(({ portId }) => portId === 'images_output');
  assert.deepEqual(
    { label: input.label, binding: input.binding },
    { label: 'prompt', binding: { nodeId: 'generate', fieldOrPortId: 'prompt' } },
  );
  assert.deepEqual(
    { label: output.label, binding: output.binding },
    { label: 'images', binding: { nodeId: 'generate', fieldOrPortId: 'images' } },
  );

  const tampered = structuredClone(route);
  tampered.boundary.inputs[0].inputName = 'not_a_catalog_input';
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, skeleton, { instanceId: 'public-alias-tampered', route: tampered }),
    /targets an unexposed input/u,
  );
});

test('an exact media-path review adapts a generic collection input to one multiple file field', () => {
  const definition = fixtureDefinition();
  const admission = definition.executionAdmissions[0];
  definition.inputs.push(
    field('reference_conditions', 'builtins.list', false, [], 'Reviewed reference-video conditions.'),
  );
  admission.bindingSources.push('referenceVideos');
  admission.instanceInputBindings.push({
    bindingSource: 'referenceVideos',
    input: 'reference_conditions',
  });
  const skeleton = fixtureSkeleton(definition, 'legacy-reference-conditions');
  const generate = skeleton.nodes.find((node) => node.data.huggingFaceClusterExecutionRole === 'generate');
  generate.data.params.reference_file = {
    type: 'str',
    display: 'filebrowser',
    value: '/reviewed/reference.mp4',
    default: '',
    fieldOptions: {
      huggingFaceClusterBinding: binding(admission.id, 'referenceVideos', 'instance_input', 'reference_conditions'),
    },
  };
  const route = {
    boundary: {
      inputs: [
        {
          portId: 'reference_conditions',
          role: 'generate',
          fieldId: 'reference_file',
          adaptation: 'media_file_path',
          mediaType: 'video',
        },
      ],
      outputs: [
        { portId: 'images', role: 'generate', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' },
      ],
    },
  };
  const compiled = adapter.compileRegisteredBlockV2(definition, skeleton, {
    instanceId: 'reference-conditions',
    route,
  });
  assert.deepEqual(
    compiled.definition.boundary.inputs.find(({ portId }) => portId === 'reference_conditions'),
    {
      portId: 'reference_conditions',
      label: 'reference conditions',
      valueType: 'string',
      required: false,
      multiple: true,
      binding: { nodeId: 'generate', fieldOrPortId: 'reference_file' },
    },
  );

  const undeclared = structuredClone(route);
  delete undeclared.boundary.inputs[0].adaptation;
  delete undeclared.boundary.inputs[0].mediaType;
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, skeleton, {
        instanceId: 'reference-conditions-undeclared',
        route: undeclared,
      }),
    /registered input reference_conditions is incompatible/u,
  );
});

test('reviewed media-file export exposes an exact terminal asset and rejects an undeclared coercion', () => {
  const definition = fixtureDefinition();
  definition.outputs = [field('videos', 'list[list[PIL.Image.Image]]', true, null)];
  const skeleton = fixtureSkeleton(definition, 'legacy-video-export');
  skeleton.nodes[2].data.params.images = {
    display: 'input',
    type: 'video',
    isConnected: true,
  };
  skeleton.nodes[2].data.params.file = {
    display: 'output',
    type: 'video',
  };
  const route = {
    boundary: {
      outputs: [
        {
          portId: 'videos',
          role: 'preview',
          fieldId: 'file',
          adaptation: 'media_file_export',
          mediaType: 'video',
        },
      ],
    },
  };
  const compiled = adapter.compileRegisteredBlockV2(definition, skeleton, {
    instanceId: 'video-export',
    route,
  });
  assert.deepEqual(compiled.definition.boundary.outputs, [
    {
      portId: 'videos',
      label: 'videos',
      valueType: 'video',
      required: true,
      binding: { nodeId: 'preview', fieldOrPortId: 'file' },
    },
  ]);

  const undeclared = structuredClone(route);
  delete undeclared.boundary.outputs[0].adaptation;
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, skeleton, {
        instanceId: 'video-export-undeclared',
        route: undeclared,
      }),
    /registered output videos must declare an explicit reviewed media adaptation/u,
  );
  const wrongMedia = structuredClone(route);
  wrongMedia.boundary.outputs[0].mediaType = 'audio';
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, skeleton, {
        instanceId: 'video-export-wrong-media',
        route: wrongMedia,
      }),
    /registered output videos is incompatible/u,
  );
});

test('every reviewed direct-media projection is explicit and undeclared media has no route authority', () => {
  const definition = fixtureDefinition();
  definition.outputs = [field('videos', 'list[list[PIL.Image.Image]]', true, null)];
  const skeleton = fixtureSkeleton(definition, 'direct-video-output');
  skeleton.nodes[2].data.params.videos = {
    display: 'output',
    type: 'video',
  };
  const route = {
    boundary: {
      outputs: [
        {
          portId: 'videos',
          role: 'preview',
          fieldId: 'videos',
          adaptation: 'direct_media',
          mediaType: 'video',
        },
      ],
    },
  };
  const compiled = adapter.compileRegisteredBlockV2(definition, skeleton, {
    instanceId: 'direct-video-output',
    route,
  });
  assert.deepEqual(compiled.definition.boundary.outputs, [
    {
      portId: 'videos',
      label: 'videos',
      valueType: 'video',
      required: true,
      binding: { nodeId: 'preview', fieldOrPortId: 'videos' },
    },
  ]);

  const undeclared = structuredClone(route);
  delete undeclared.boundary.outputs[0].adaptation;
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, skeleton, {
        instanceId: 'direct-video-output-undeclared',
        route: undeclared,
      }),
    /registered output videos must declare an explicit reviewed media adaptation/u,
  );

  const reviewedMediaBindings = routes.REGISTERED_BLOCK_V2_ROUTES.flatMap((registeredRoute) =>
    registeredRoute.boundary.outputs
      .filter(({ mediaType }) => mediaType !== undefined)
      .map((binding) => ({ registeredRoute, binding })),
  );
  assert.equal(reviewedMediaBindings.length, 80);
  assert.equal(
    reviewedMediaBindings.every(({ binding }) => binding.adaptation !== undefined),
    true,
  );

  const directMediaBindings = reviewedMediaBindings.filter(({ binding }) => binding.adaptation === 'direct_media');
  assert.equal(directMediaBindings.length, 55);
  assert.equal(new Set(directMediaBindings.map(({ registeredRoute }) => registeredRoute.definitionId)).size, 51);
  for (const { registeredRoute, binding } of directMediaBindings) {
    assert.notEqual(binding.fieldId, 'file', `${registeredRoute.definitionId} must use a reviewed export for files`);
    assert.notEqual(binding.role, 'videoExport', `${registeredRoute.definitionId} must not bypass its export node`);
  }

  const h3Bindings = directMediaBindings.filter(
    ({ registeredRoute }) => registeredRoute.pipelineClass === 'MiniMaxH3ModularPipeline',
  );
  assert.equal(h3Bindings.length, 6);
  for (const { registeredRoute, binding } of h3Bindings) {
    assert.ok(['t2va', 'fl2va', 'ref2va'].includes(registeredRoute.workflowId));
    assert.equal(binding.role, 'decode');
    assert.ok(
      (binding.fieldId === 'video' && binding.mediaType === 'video') ||
        (binding.fieldId === 'audio' && binding.mediaType === 'audio'),
    );
  }
  for (const registeredRoute of routes.REGISTERED_BLOCK_V2_ROUTES) {
    assert.equal(
      registeredRoute.boundary.outputs.some(
        ({ mediaType, adaptation }) => mediaType !== undefined && adaptation === undefined,
      ),
      false,
      `${registeredRoute.definitionId} must not rely on implicit media authority`,
    );
  }
});

test('incomplete, stale, or non-immutable registered skeletons fail closed', () => {
  const definition = fixtureDefinition();
  const skeleton = fixtureSkeleton(definition, 'legacy-invalid');
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(
        definition,
        { ...skeleton, bindingsComplete: false, pendingFields: [{ role: 'generate', field: 'prompt' }] },
        { instanceId: 'invalid-instance-a' },
      ),
    /incomplete or stale/u,
  );
  const stale = structuredClone(skeleton);
  stale.nodes[1].data.huggingFaceClusterInstanceId = 'somebody-else';
  assert.throws(
    () => adapter.compileRegisteredBlockV2(definition, stale, { instanceId: 'invalid-instance-b' }),
    /stale or duplicate semantic ownership/u,
  );
  const mutableRevision = structuredClone(definition);
  mutableRevision.executionAdmissions[0].artifact.revision = 'main';
  const mutableSkeleton = fixtureSkeleton(mutableRevision, 'legacy-mutable');
  assert.throws(
    () => adapter.compileRegisteredBlockV2(mutableRevision, mutableSkeleton, { instanceId: 'invalid-instance-c' }),
    /immutable 40-character commits/u,
  );

  const tamperedSealedValue = fixtureSkeleton(definition, 'legacy-tampered-sealed');
  tamperedSealedValue.nodes[0].data.params.repository.value = 'attacker/different-model';
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, tamperedSealedValue, {
        instanceId: 'invalid-instance-d',
      }),
    /sealed binding artifact disagrees with the reviewed admission/u,
  );

  const incompatibleInput = fixtureSkeleton(definition, 'legacy-incompatible-input');
  incompatibleInput.nodes[1].data.params.prompt.type = 'int';
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, incompatibleInput, {
        instanceId: 'invalid-instance-e',
      }),
    /registered input prompt is incompatible/u,
  );

  const incompatibleOutput = fixtureSkeleton(definition, 'legacy-incompatible-output');
  incompatibleOutput.nodes[1].data.params.images.type = 'list[audio]';
  assert.throws(
    () =>
      adapter.compileRegisteredBlockV2(definition, incompatibleOutput, {
        instanceId: 'invalid-instance-f',
      }),
    /registered output images is incompatible/u,
  );
});
