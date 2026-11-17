import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  capturedNativeGraphSubmission,
  executedNativeMediaPlan,
  observedNativeAutoVideoPlan,
  observedNativeAutoVideoResourceId,
  observedNativeAutoVideoProofMatches,
} from './executed-native-media-resource.mjs';
import {
  executionPlanIdentity,
  executionReceiptIdentity,
  canonicalGraphIdentity,
  modelSetIdentity,
} from './live-proof-provenance.mjs';
import { workerGraphHash } from './observed-workflow-auto-resource.mjs';
import { canonicalJsonHash } from './canonical-json.mjs';

test('native Auto can bind a missing client graph snapshot to the exact captured graph POST', () => {
  const { api, context } = nativeAutoFixture('WanVideoToVideoPipeline', 'video_color_edit');
  api.runtimeHints.workflowSnapshot.savedHierarchy = Array.from({ length: 24 }).reduce((v) => ({ child: v }), {});
  delete context.executedOutput.apiGraphSnapshot;
  assert.equal(observedNativeAutoVideoPlan(api, context), null);
  context.nativeGraphSubmission = {
    method: 'POST',
    url: 'http://127.0.0.1:8278/graph',
    contentType: 'application/json',
    body: JSON.stringify(api),
  };
  const before = JSON.stringify(context);
  const plan = observedNativeAutoVideoPlan(api, context);
  assert(plan);
  assert.equal(plan.observation.outputApiGraphSnapshotCaptured, false);
  assert.equal(plan.observation.graphSubmission.body, context.nativeGraphSubmission.body);
  assert.equal(JSON.stringify(context), before);
  assert.equal(executionPlanIdentity(api, context).plan.source, plan.source);
  const provenance = {
    taskId: context.taskId,
    template: { lockedSettings: { mode: 'video_color_edit' } },
    graph: canonicalGraphIdentity(api),
    models: { hash: context.nativeAutoBindings.modelSetHash, items: context.modelIdentities },
    inputs: { hash: context.nativeAutoBindings.inputArtifactsHash },
    runtime: { backendSource: context.backendSource },
  };
  const submittedGraphIdentity = canonicalGraphIdentity(api);
  assert.equal(observedNativeAutoVideoProofMatches(plan, provenance), false);
  assert(observedNativeAutoVideoProofMatches(plan, provenance, { submittedGraphIdentity }));
  const alteredPlan = structuredClone(plan);
  const alteredApi = JSON.parse(alteredPlan.observation.graphSubmission.body);
  alteredApi.nodes.denoise.params.seed.value++;
  alteredPlan.observation.graphSubmission = capturedNativeGraphSubmission({
    ...alteredPlan.observation.graphSubmission,
    body: JSON.stringify(alteredApi),
  }).record;
  assert.equal(
    observedNativeAutoVideoProofMatches(alteredPlan, provenance, {
      submittedGraphIdentity: canonicalGraphIdentity(alteredApi),
    }),
    false,
  );
  for (const change of [
    (s) => (s.method = 'GET'),
    (s) => (s.url = 'https://example.com/graph'),
    (s) => (s.contentType = 'text/plain'),
    (s) => (s.body = '{'),
    (s) => (s.body = JSON.stringify({ ...api, sid: 'another-session' })),
    (s) => (s.body = JSON.stringify(Array.from({ length: 65 }).reduce((v) => [v], {}))),
    (s) => (s.body = '{"value":1e999}'),
  ]) {
    const altered = structuredClone(context);
    change(altered.nativeGraphSubmission);
    assert.equal(observedNativeAutoVideoPlan(api, altered), null);
  }
  context.executedOutput.apiGraphSnapshot = { ...api, sid: 'contradictory-snapshot' };
  assert.equal(observedNativeAutoVideoPlan(api, context), null);
});

function workflowImageFixture() {
  const state = fixture(true);
  const { api, context } = state;
  const literal = (value) => ({ value });
  api.runtimeHints.workflowSnapshot.studioForm.mode = 'text_to_image';
  const nodes = api.nodes;
  nodes.owner.params.workflow_id = literal('text2image');
  nodes.owner.params.quant_config = { display: 'input' };
  nodes.semantic.action = 'WorkflowTextEncode';
  for (const key of ['lyrics', 'audio_duration', 'seed']) delete nodes.semantic.params[key];
  nodes.denoise.action = 'WorkflowImageDenoise';
  delete nodes.denoise.params.num_inference_steps;
  Object.assign(nodes.denoise.params, {
    width: literal(2048),
    height: literal(2048),
    seed: literal(12),
    min_generation_area: literal(4194304),
  });
  nodes.decode.action = 'WorkflowDecodeImage';
  for (const id of ['semantic', 'denoise', 'decode']) nodes[id].params.workflow_id = literal('text2image');
  nodes.output.module = 'modules.Image';
  nodes.output.action = 'Preview';
  nodes.output.params = { image: { sourceId: 'decode', sourceKey: 'images', display: 'input' } };
  const receipt = context.executedOutput.resolvedExecutionInputs;
  receipt.graphTasks[0].task = 'text_to_image';
  receipt.nodes = api.paths[0].map((nodeId) => ({
    nodeId,
    module: nodes[nodeId].module,
    action: nodes[nodeId].action,
    omittedFields: {},
    fields: Object.fromEntries(
      Object.entries(nodes[nodeId].params)
        .filter(([, p]) => Object.hasOwn(p, 'value'))
        .map(([key, p]) => [key, { source: 'literal', value: p.value?.source === 'hub' ? p.value.value : p.value }]),
    ),
  }));
  receipt.nodes.find((row) => row.nodeId === 'owner').fields.quant_config = { source: 'literal', value: null };
  return state;
}

test('records native text-to-image workflow phases without inferring fixed sampler or selector capture', () => {
  const { api, context } = workflowImageFixture();
  const plan = executedNativeMediaPlan(api, context);
  assert.equal(plan?.source, 'executed-expert-modular-image-workflow-v1');
  assert.equal(plan.observation.fixedSamplerCaptureClaimed, false);
  assert.equal(plan.observation.workflowSelectorCaptureClaimed, false);
  assert.equal(plan.observation.fullFieldAccountingClaimed, false);
});

test('workflow image evidence rejects altered native controls, model state, phase wiring and task type', () => {
  for (const mutate of [
    ({ api }) => {
      api.nodes.owner.params.quant_config.value = { backend: 'bnb' };
    },
    ({ api }) => {
      api.nodes.owner.params.unet = { value: 'borrowed' };
    },
    ({ api }) => {
      api.nodes.decode.params.state_in.sourceKey = 'other';
    },
    ({ api }) => {
      api.nodes.semantic.params.workflow_id.value = 'image_conditioned';
    },
    ({ api }) => {
      api.runtimeHints.workflowSnapshot.studioForm.mode = 'edit_image';
    },
    ({ context }) => {
      context.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields.seed.value++;
    },
    ({ context }) => {
      context.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'owner').fields.quant_config.value =
        {};
    },
  ]) {
    const state = workflowImageFixture();
    mutate(state);
    assert.equal(executedNativeMediaPlan(state.api, state.context), null);
  }
});

function fixture(modularAudio = false) {
  const literal = (v) => ({ value: v });
  const wire = (sourceId, sourceKey) => ({ sourceId, sourceKey, display: 'input' });
  const node = (module, action, params) => ({ module, action, params });
  const scope = modularAudio ? 'modules.ModularDiffusers' : 'modules.DiffusersImage';
  const pipelineClass = modularAudio ? 'ExampleModularPipeline' : 'ExampleImagePipeline';
  const mode = modularAudio ? 'text_to_audio' : 'edit_image';
  const nodes = {};
  nodes.owner = node(scope, modularAudio ? 'ModelsLoader' : 'LoadPipeline', {
    [modularAudio ? 'repo_id' : 'model_id']: literal({ source: 'hub', value: 'example/model' }),
    revision: literal('a'.repeat(40)),
    [modularAudio ? 'model_type' : 'pipeline_class']: literal(pipelineClass),
    dtype: literal('bfloat16'),
    device: literal('cuda:0'),
    auto_offload: literal(true),
    offload_mode: literal('model_cpu'),
    ...(modularAudio
      ? { weight_format: literal('native'), weight_loading_mode: literal('cpu'), trust_remote_code: literal(false) }
      : { execution_recipe: wire('recipe', 'execution_recipe') }),
  });
  if (modularAudio) {
    nodes.semantic = node(scope, 'WorkflowSemanticGeneration', {
      pipeline_components: wire('owner', 'pipeline_components'),
      pipeline_class: literal(pipelineClass),
      prompt: literal('Original song'),
      lyrics: literal('Original lyrics'),
      audio_duration: literal(60),
      seed: literal(12),
    });
    nodes.denoise = node(scope, 'WorkflowDenoise', {
      pipeline_components: wire('owner', 'pipeline_components'),
      pipeline_class: literal(pipelineClass),
      state_in: wire('semantic', 'state_out'),
      num_inference_steps: literal(30),
    });
    nodes.decode = node(scope, 'WorkflowDecodeAudio', {
      pipeline_components: wire('owner', 'pipeline_components'),
      pipeline_class: literal(pipelineClass),
      state_in: wire('denoise', 'state_out'),
    });
    nodes.output = node('modules.Audio', 'Export', { audio: wire('decode', 'audio'), sample_rate: literal(44100) });
  } else {
    nodes.quant = node('modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', {
      backend: literal('none'),
      dtype: literal('bfloat16'),
    });
    nodes.recipe = node('modules.DiffusersRuntime', 'DiffusersExecutionRecipe', {
      quantization_config: wire('quant', 'quantization_config'),
      device: literal('cuda:0'),
      offload_mode: literal('model_cpu'),
      device_map: literal('none'),
    });
    nodes.encode = node(scope, 'EncodeInputs', {
      pipeline: wire('owner', 'pipeline'),
      prompt: literal('Original scene'),
    });
    nodes.denoise = node(scope, 'Denoise', {
      pipeline: wire('owner', 'pipeline'),
      encoded_inputs: wire('encode', 'encoded_inputs'),
      width: literal(1024),
      height: literal(1024),
      num_inference_steps: literal(28),
      guidance_scale: literal(3.5),
      seed: literal(12),
    });
    nodes.decode = node(scope, 'DecodeLatents', {
      pipeline: wire('owner', 'pipeline'),
      latents: wire('denoise', 'latents_out'),
    });
    nodes.output = node('modules.Image', 'Preview', { image: wire('decode', 'images') });
  }
  const order = modularAudio
    ? ['owner', 'semantic', 'denoise', 'decode', 'output']
    : ['quant', 'recipe', 'owner', 'encode', 'denoise', 'decode', 'output'];
  const snapshot = { studioForm: { resourceMode: 'expert', mode }, nodes: [] };
  const api = {
    sid: 'native',
    nodes,
    paths: [order],
    runtimeHints: {
      workflowSnapshot: snapshot,
      workflowTabId: 'workflow',
      clientRunId: 'client',
      runInputHash: 'inputs',
    },
  };
  const captured = order.map((nodeId) => ({
    nodeId,
    module: nodes[nodeId].module,
    action: nodes[nodeId].action,
    omittedFields: {},
    fields: Object.fromEntries(
      Object.entries(nodes[nodeId].params)
        .filter(([key, p]) => Object.hasOwn(p, 'value') && !(modularAudio && key === 'lyrics'))
        .map(([key, p]) => [key, { source: 'literal', value: p.value?.source === 'hub' ? p.value.value : p.value }]),
    ),
  }));
  const output = {
    nodeId: 'output',
    taskId: 'task',
    attemptIndex: 0,
    sid: 'native',
    workflowTabId: 'workflow',
    clientRunId: 'client',
    runInputHash: 'inputs',
    apiGraphSnapshot: api,
    formSnapshot: snapshot.studioForm,
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: 'task',
      nodeId: 'output',
      attemptIndex: 0,
      truncated: false,
      uncapturedNodeIds: [],
      nodes: captured,
      graphTasks: [{ loaderId: 'owner', pipelineClass, task: mode }],
    },
  };
  const task = {
    task_id: 'task',
    status: 'completed',
    attempt_index: 0,
    sid: 'native',
    workflow_tab_id: 'workflow',
    client_run_id: 'client',
    run_input_hash: 'inputs',
    resourceCandidateId: null,
    runtimePreparation: { resourceMode: 'expert' },
    workflow_snapshot: snapshot,
  };
  const model = {
    repoId: 'example/model',
    selectedRevision: 'a'.repeat(40),
    modelRevision: 'example/model@' + 'a'.repeat(40),
    fingerprint: 'sha256:' + 'b'.repeat(64),
  };
  return {
    api,
    context: {
      taskId: 'task',
      executionReceipt: task,
      executedOutput: output,
      modelIdentities: [model],
      resolvedModelRepos: ['example/model'],
      backendSource: { fingerprint: 'sha256:backend-source-v1:' + 'c'.repeat(64), files: [] },
    },
  };
}

function refreshCapturedFixture({ api, context }, connectedValues = {}) {
  const receipt = context.executedOutput.resolvedExecutionInputs;
  receipt.nodes = api.paths[0].map((nodeId) => ({
    nodeId,
    module: api.nodes[nodeId].module,
    action: api.nodes[nodeId].action,
    omittedFields: {},
    fields: Object.fromEntries(
      Object.entries(api.nodes[nodeId].params)
        .filter(([, p]) => Object.hasOwn(p, 'value') || p.sourceId)
        .map(([key, p]) => [
          key,
          p.sourceId
            ? {
                source: 'connected',
                sourceNodeId: p.sourceId,
                sourcePortId: p.sourceKey,
                value: connectedValues[key] ?? null,
              }
            : { source: 'literal', value: p.value?.source === 'hub' ? p.value.value : p.value },
        ]),
    ),
  }));
}

function weightedReferenceFixture() {
  const state = fixture();
  const { api, context } = state;
  api.nodes.owner.params.pipeline_class.value = 'FluxReduxPipeline';
  api.runtimeHints.workflowSnapshot.studioForm.mode = 'multi_image_reference_edit';
  context.executedOutput.resolvedExecutionInputs.graphTasks[0] = {
    loaderId: 'owner',
    pipelineClass: 'FluxReduxPipeline',
    task: 'multi_image_reference_edit',
  };
  api.nodes.weights = {
    module: 'modules.Text',
    action: 'ProcessText',
    params: {
      pipeline_class: { value: 'BuiltinDataOperationV1' },
      operation: { value: 'data_conversion' },
      target_type: { value: 'json' },
      source: { value: '[0.8,0.2]' },
    },
  };
  for (const field of ['prompt_embeds_scale', 'pooled_prompt_embeds_scale'])
    api.nodes.encode.params[field] = { sourceId: 'weights', sourceKey: 'output', display: 'input' };
  api.paths[0].splice(3, 0, 'weights');
  refreshCapturedFixture(state, { prompt_embeds_scale: [0.8, 0.2], pooled_prompt_embeds_scale: [0.8, 0.2] });
  return state;
}

test('weighted reference evidence joins a deterministic JSON supplier to both observed scale arrays', () => {
  const { api, context } = weightedReferenceFixture();
  assert(executedNativeMediaPlan(api, context));
});

test('weighted reference evidence rejects changed JSON, missing consumers and executable suppliers', () => {
  for (const mutate of [
    ({ api }) => {
      api.nodes.weights.params.source.value = '[0.2,0.8]';
    },
    ({ api }) => {
      api.nodes.weights.params.source.value = '[0.8,1e999]';
    },
    ({ api }) => {
      api.nodes.weights.params.operation.value = 'select';
    },
    ({ api }) => {
      api.nodes.encode.params.pooled_prompt_embeds_scale.sourceKey = 'other';
    },
    ({ context }) => {
      delete context.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'encode').fields
        .prompt_embeds_scale;
    },
    ({ api }) => {
      api.nodes.weights.module = 'custom.Unreviewed';
    },
  ]) {
    const state = weightedReferenceFixture();
    mutate(state);
    assert.equal(executedNativeMediaPlan(state.api, state.context), null);
  }
});

function audiovisualFixture() {
  const state = fixture();
  const { api, context } = state;
  const lit = (value) => ({ value });
  const wire = (sourceId, sourceKey) => ({ sourceId, sourceKey, display: 'input' });
  const node = (module, action, params) => ({ module, action, params });
  for (const value of Object.values(api.nodes))
    if (value.module === 'modules.DiffusersImage') value.module = 'modules.DiffusersVideo';
  api.nodes.owner.params.pipeline_class = lit('LTXConditionPipeline');
  api.nodes.owner.params.model_id = lit({ source: 'hub', value: 'Lightricks/LTX-Video-0.9.8-13B-distilled' });
  api.nodes.owner.params.revision = lit('7c64400e1861cc0d7b98d570a1926d5408ec60cd');
  api.nodes.denoise.params.num_frames = lit(81);
  api.nodes.decode.params.latent_binding = wire('denoise', 'latent_binding');
  api.nodes.audioOwner = node('modules.DiffusersAudio', 'LoadPipeline', {
    model_id: lit({ source: 'hub', value: 'ACE-Step/acestep-v15-xl-turbo-diffusers' }),
    revision: lit('200ba991ae448051e14b0183157e35c2d27c9fb0'),
    pipeline_class: lit('AceStepPipeline'),
    dtype: lit('bfloat16'),
    device: lit('cuda:0'),
    offload_mode: lit('model_cpu'),
    auto_offload: lit(true),
    execution_recipe: wire('audioRecipe', 'execution_recipe'),
  });
  api.nodes.audioQuant = structuredClone(api.nodes.quant);
  api.nodes.audioRecipe = structuredClone(api.nodes.recipe);
  api.nodes.audioRecipe.params.quantization_config = wire('audioQuant', 'quantization_config');
  api.nodes.song = node('modules.DiffusersAudio', 'Generate', {
    pipeline: wire('audioOwner', 'pipeline'),
    prompt: lit('Original song'),
    lyrics: lit('Original words'),
    task_type: lit('text2music'),
    audio_duration: lit(45),
    seed: lit(12),
    num_inference_steps: lit(8),
    guidance_scale: lit(1),
    shift: lit(3),
    bpm: lit(96),
    keyscale: lit('D major'),
    timesignature: lit('4'),
    vocal_language: lit('en'),
  });
  api.nodes.fit = node('modules.Audio', 'FitDuration', { audio: wire('song', 'audio') });
  api.nodes.overlay = node('modules.Video', 'LyricOverlay', {
    video: wire('decode', 'frames'),
    enabled: lit(false),
    lrc: lit(''),
    fps: lit(16),
  });
  api.nodes.output = node('modules.Video', 'ExportWithAudio', {
    video: wire('overlay', 'output'),
    audio: wire('fit', 'output'),
    fps: lit(16),
  });
  api.paths = [
    [
      'quant',
      'recipe',
      'owner',
      'encode',
      'denoise',
      'decode',
      'audioQuant',
      'audioRecipe',
      'audioOwner',
      'song',
      'fit',
      'overlay',
      'output',
    ],
  ];
  api.runtimeHints.workflowSnapshot.studioForm.mode = 'text_to_audio';
  context.executedOutput.resolvedExecutionInputs.graphTasks = [
    { loaderId: 'owner', pipelineClass: 'LTXConditionPipeline', task: 'image_to_video' },
  ];
  context.modelIdentities = [
    {
      ...context.modelIdentities[0],
      repoId: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
      selectedRevision: '7c64400e1861cc0d7b98d570a1926d5408ec60cd',
      modelRevision: 'Lightricks/LTX-Video-0.9.8-13B-distilled@7c64400e1861cc0d7b98d570a1926d5408ec60cd',
    },
    {
      ...context.modelIdentities[0],
      repoId: 'ACE-Step/acestep-v15-xl-turbo-diffusers',
      selectedRevision: '200ba991ae448051e14b0183157e35c2d27c9fb0',
      modelRevision: 'ACE-Step/acestep-v15-xl-turbo-diffusers@200ba991ae448051e14b0183157e35c2d27c9fb0',
    },
  ];
  context.resolvedModelRepos = context.modelIdentities.map((m) => m.repoId);
  refreshCapturedFixture(state);
  return state;
}

test('audiovisual evidence binds both executed owners without inventing audio task or fitting-control captures', () => {
  const { api, context } = audiovisualFixture();
  const plan = executedNativeMediaPlan(api, context);
  assert.equal(plan?.source, 'executed-expert-audiovisual-graph-v1');
  assert.equal(plan.modelType, 'AceStepPipeline');
  assert.equal(plan.observation.mediaResourceOwners.length, 2);
  assert.equal(plan.observation.audioGraphTaskCaptured, false);
  assert.equal(plan.observation.fittingControlsCaptured, false);
  assert.equal(plan.observation.fullFieldAccountingClaimed, false);
  delete context.executionReceipt.runtimePreparation;
  assert.equal(executedNativeMediaPlan(api, context).observation.preparationModeCaptured, false);
  context.executionReceipt.runtimePreparation = { resourceMode: 'auto' };
  assert.equal(executedNativeMediaPlan(api, context), null);
});

test('audiovisual evidence rejects borrowed owners, altered native audio values, incomplete captures and detached outputs', () => {
  for (const mutate of [
    ({ api }) => {
      api.nodes.song.params.pipeline.sourceId = 'owner';
    },
    ({ api }) => {
      api.nodes.audioOwner.params.execution_recipe.sourceId = 'recipe';
    },
    ({ api }) => {
      api.nodes.output.params.audio.sourceId = 'song';
    },
    ({ context }) => {
      context.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'song').fields.lyrics.value =
        'Changed';
    },
    ({ context }) => {
      context.modelIdentities.pop();
    },
    ({ context }) => {
      context.executedOutput.resolvedExecutionInputs.uncapturedNodeIds = ['song'];
    },
    ({ api }) => {
      api.nodes.audioOwner.params.revision.value = 'main';
    },
    ({ api }) => {
      api.runtimeHints.workflowSnapshot.studioForm.resourceMode = 'auto';
    },
  ]) {
    const state = audiovisualFixture();
    mutate(state);
    assert.equal(executedNativeMediaPlan(state.api, state.context), null);
  }
});

test('detached ordinary image and modular audio recover a native manual identity', () => {
  for (const audio of [false, true]) {
    const { api, context } = fixture(audio);
    const plan = executedNativeMediaPlan(api, context);
    assert(plan);
    assert.equal(plan.dtype, 'bfloat16');
    assert.equal(plan.observation.fullFieldAccountingClaimed, false);
    assert.equal(plan.observation.hardwareQualification, false);
    if (audio) assert.equal(plan.observation.lyricsCaptureClaimed, false);
    const recovered = executionPlanIdentity(api, context).plan;
    assert.equal(recovered.source, plan.source);
  }
});
test('native evidence rejects altered task, pin, controls, paths and capture', () => {
  const changes = [
    ({ context }) => {
      context.executionReceipt.status = 'failed';
    },
    ({ context }) => {
      context.executedOutput.sid = 'foreign';
    },
    ({ context }) => {
      context.modelIdentities[0].selectedRevision = 'd'.repeat(40);
    },
    ({ api }) => {
      api.nodes.denoise.params.seed.value = 13;
    },
    ({ api }) => {
      api.nodes.denoise.params.encoded_inputs.sourceId = 'owner';
    },
    ({ api }) => {
      api.paths[0].reverse();
    },
    ({ context }) => {
      context.executedOutput.resolvedExecutionInputs.truncated = true;
    },
    ({ context }) => {
      context.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields.seed = undefined;
    },
    ({ api }) => {
      api.nodes.encode.action = 'RunArbitraryCode';
    },
    ({ context }) => {
      context.modelIdentities.push({ ...context.modelIdentities[0], repoId: 'extra/model' });
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.equal(executedNativeMediaPlan(f.api, f.context), null);
  }
});
test('hidden adapter dependencies require a matching source-bound declaration', () => {
  const f = fixture();
  const extra = {
    repoId: 'example/base',
    selectedRevision: 'd'.repeat(40),
    modelRevision: 'example/base@' + 'd'.repeat(40),
    fingerprint: 'sha256:' + 'e'.repeat(64),
  };
  f.context.modelIdentities.push(extra);
  f.context.backendSource.files = [{ path: 'modules/Example/main.py', sha256: 'f'.repeat(64) }];
  f.context.modelDependencyEvidence = {
    pipelineClass: 'ExampleImagePipeline',
    ownerRepoId: 'example/model',
    backendSourceFingerprint: f.context.backendSource.fingerprint,
    implementationFiles: [...f.context.backendSource.files],
    models: [{ repoId: extra.repoId, revision: extra.selectedRevision }],
  };
  assert(executedNativeMediaPlan(f.api, f.context));
  f.context.modelDependencyEvidence.implementationFiles[0] = {
    path: 'modules/Example/main.py',
    sha256: '0'.repeat(64),
  };
  assert.equal(executedNativeMediaPlan(f.api, f.context), null);
});

function nativeAutoFixture(pipelineClass, mode, shots = 1, assets = false) {
  const state = fixture();
  const { api, context } = state;
  const literal = (value) => ({ value });
  const wire = (sourceId, sourceKey) => ({ sourceId, sourceKey });
  const nodes = api.nodes;
  const [repository, revision] =
    pipelineClass === 'LTXConditionPipeline'
      ? ['Lightricks/LTX-Video-0.9.8-13B-distilled', '7c64400e1861cc0d7b98d570a1926d5408ec60cd']
      : pipelineClass === 'WanVACEPipeline'
        ? ['Wan-AI/Wan2.1-VACE-1.3B-diffusers', 'ec4d2cb062b548996b179d493fdd05340de702a1']
        : ['Wan-AI/Wan2.1-T2V-1.3B-Diffusers', '0fad780a534b6463e45facd96134c9f345acfa5b'];
  for (const id of ['owner', 'encode', 'denoise', 'decode']) nodes[id].module = 'modules.DiffusersVideo';
  Object.assign(nodes.owner.params, {
    model_id: literal({ source: 'hub', value: repository }),
    revision: literal(revision),
    pipeline_class: literal(pipelineClass),
  });
  nodes.denoise.params.mode = literal(mode);
  nodes.encode.params.mode = literal(mode);
  nodes.denoise.params.num_frames = literal(81);
  nodes.decode.params.output_type = literal('pil');
  nodes.decode.params.latent_binding = wire('denoise', 'latent_binding');
  if (pipelineClass === 'WanVideoToVideoPipeline') {
    nodes.source = { module: 'modules.Video', action: 'Load', params: { file: literal('@data/videos/source.mp4') } };
    nodes.normalize = {
      module: 'modules.VideoConditioning',
      action: 'Normalize',
      params: {
        video: wire('source', 'video'),
        width: nodes.denoise.params.width,
        height: nodes.denoise.params.height,
        num_frames: literal(81),
        fit: literal('cover'),
      },
    };
    nodes.encode.params.video = wire('normalize', 'output');
    nodes.denoise.params.strength = literal(0.2);
  }
  nodes.output.module = 'modules.Video';
  nodes.output.action = 'Export';
  nodes.output.params = { video: wire('decode', 'video_out') };
  let previous = 'decode',
    port = 'video_out';
  if (pipelineClass === 'WanVACEPipeline') {
    nodes.denoise.action = 'Generate';
    nodes.denoise.params.output_type = literal('pil');
    delete nodes.decode;
    previous = 'denoise';
  }
  if (shots > 1) {
    const items = {};
    for (let index = 0; index < shots; index++) {
      const id = index === 0 ? 'decode' : `decode${index}`;
      if (index) {
        nodes[`encode${index}`] = structuredClone(nodes.encode);
        nodes[`denoise${index}`] = structuredClone(nodes.denoise);
        nodes[`denoise${index}`].params.encoded_inputs.sourceId = `encode${index}`;
        nodes[id] = structuredClone(nodes.decode);
        nodes[id].params.latents.sourceId = `denoise${index}`;
        nodes[id].params.latent_binding.sourceId = `denoise${index}`;
      }
      let sourceId = id,
        sourceKey = 'video_out';
      if (assets) {
        sourceId = `save${index}`;
        sourceKey = 'asset';
        nodes[sourceId] = { module: 'modules.Video', action: 'ExportAsset', params: { video: wire(id, 'video_out') } };
      }
      items[index ? `item>>>${index}` : 'item'] = wire(sourceId, sourceKey);
    }
    nodes.clips = { module: 'modules.Primitive', action: 'ToList', params: items };
    if (assets) {
      nodes.output.action = 'ConcatenateAssets';
      nodes.output.params = { clips: wire('clips', 'list') };
    } else {
      nodes.compose = { module: 'modules.Video', action: 'Concatenate', params: { clips: wire('clips', 'list') } };
      previous = 'compose';
      port = 'output';
    }
  }
  if (!assets) nodes.output.params.video = wire(previous, port);
  const ordered = [],
    seen = new Set();
  function visit(id) {
    if (seen.has(id)) return;
    seen.add(id);
    for (const p of Object.values(nodes[id].params)) if (p.sourceId) visit(p.sourceId);
    ordered.push(id);
  }
  visit('output');
  api.paths = [ordered];
  api.runtimeHints.workflowSnapshot.studioForm = { resourceMode: 'auto', mode };
  api.runtimeHints.resourceMode = 'auto';
  api.runtimeHints.workflowAutoPlan = { schemaVersion: 1, graphHash: workerGraphHash(api) };
  context.executionReceipt.runtimePreparation = {
    resourceMode: 'auto',
    performed: false,
    residentRecipeReusable: false,
    cleanup: null,
    workflowAuto: {
      strategy: 'dependency_order_retained_owners',
      schedule: null,
      cachePreparation: null,
      reusedOwnerIds: [],
      preparedDataNodes: [],
      appliedUpdates: [],
      releases: [],
      resolvedFields: Object.fromEntries(
        ['owner', 'recipe'].map((id) => [
          id,
          Object.fromEntries(
            Object.entries(nodes[id].params)
              .filter(([, p]) => Object.hasOwn(p, 'value'))
              .map(([key, p]) => [key, p.value]),
          ),
        ]),
      ),
    },
  };
  const receipt = context.executedOutput.resolvedExecutionInputs;
  receipt.graphTasks = [{ loaderId: 'owner', pipelineClass, task: mode }];
  receipt.nodes = ordered.map((nodeId) => ({
    nodeId,
    module: nodes[nodeId].module,
    action: nodes[nodeId].action,
    omittedFields: {},
    fields: Object.fromEntries(
      Object.entries(nodes[nodeId].params).map(([key, p]) => [
        key,
        p.sourceId
          ? { source: 'connected', sourceNodeId: p.sourceId, sourcePortId: p.sourceKey, value: null }
          : { source: 'literal', value: p.value?.source === 'hub' ? p.value.value : p.value },
      ]),
    ),
  }));
  context.executedOutput.formSnapshot = api.runtimeHints.workflowSnapshot.studioForm;
  for (const row of receipt.nodes) {
    if (pipelineClass === 'WanVideoToVideoPipeline') {
      if (row.action === 'Denoise') delete row.fields.num_frames;
      if (row.action === 'Normalize') delete row.fields.fit;
      if (row.action === 'EncodeInputs') {
        row.fields.video_source_frames = {
          source: 'connected',
          sourceNodeId: 'normalize',
          sourcePortId: 'output',
          value: 81,
        };
        row.fields.video_source_sha256 = {
          source: 'connected',
          sourceNodeId: 'normalize',
          sourcePortId: 'output',
          value: 'a'.repeat(64),
        };
      }
    }
    if (
      row.module === 'modules.DiffusersVideo' &&
      ['EncodeInputs', 'Denoise', 'DecodeLatents', 'Generate'].includes(row.action)
    ) {
      delete row.fields.mode;
      row.fields.executed_task = { source: 'literal', value: mode };
    }
  }
  context.modelIdentities = [
    {
      ...context.modelIdentities[0],
      repoId: repository,
      selectedRevision: revision,
      modelRevision: repository + '@' + revision,
    },
  ];
  context.resolvedModelRepos = [repository];
  context.nativeAutoBindings = {
    canonicalGraphHash: canonicalGraphIdentity(api).hash,
    modelSetHash: modelSetIdentity(context.modelIdentities).hash,
    inputArtifactsHash: 'empty-inputs',
    backendSourceFingerprint: context.backendSource.fingerprint,
  };
  return state;
}

test('native Auto video observations cover shot films, Wan sampling and encoded VACE renders', () => {
  for (const args of [
    ['LTXConditionPipeline', 'text_to_video', 3],
    ['LTXConditionPipeline', 'image_to_video', 6, true],
    ['WanPipeline', 'text_to_video'],
    ['WanVACEPipeline', 'control_to_video'],
    ['WanVACEPipeline', 'video_outpaint'],
    ['WanVideoToVideoPipeline', 'video_color_edit'],
    ['WanVideoToVideoPipeline', 'video_to_video'],
  ]) {
    const { api, context } = nativeAutoFixture(...args);
    const before = JSON.stringify({ api, context });
    const plan = observedNativeAutoVideoPlan(api, context);
    assert(plan, args.join(' / '));
    assert.equal(plan.resourceMode, 'auto');
    assert.equal(plan.observation.hardwareQualification, false);
    assert.equal(plan.observation.fullFieldAccountingClaimed, false);
    assert(observedNativeAutoVideoResourceId(plan));
    assert.equal(JSON.stringify({ api, context }), before);
    const provenance = {
      taskId: context.taskId,
      template: { lockedSettings: { mode: api.runtimeHints.workflowSnapshot.studioForm.mode } },
      graph: {
        hash: context.nativeAutoBindings.canonicalGraphHash,
        canonicalGraph: canonicalGraphIdentity(api).canonicalGraph,
      },
      models: { hash: context.nativeAutoBindings.modelSetHash, items: context.modelIdentities },
      inputs: { hash: 'empty-inputs' },
      runtime: { backendSource: context.backendSource },
    };
    assert(observedNativeAutoVideoProofMatches(plan, provenance));
    provenance.inputs.hash = 'changed';
    assert.equal(observedNativeAutoVideoProofMatches(plan, provenance), false);
    const recovered = executionPlanIdentity(api, context).plan;
    assert.equal(recovered.source, plan.source);
    assert.equal(
      executionReceiptIdentity(context.executionReceipt, recovered).resourceCandidateId,
      observedNativeAutoVideoResourceId(recovered),
    );
  }
});

test('Wan source-derived frame evidence rejects missing or contradictory consumed geometry', () => {
  for (const change of [
    (s) =>
      delete s.context.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.action === 'EncodeInputs').fields
        .video_source_frames,
    (s) =>
      (s.context.executedOutput.resolvedExecutionInputs.nodes.find(
        (n) => n.action === 'EncodeInputs',
      ).fields.video_source_frames.value = 77),
    (s) =>
      (s.context.executedOutput.resolvedExecutionInputs.nodes.find(
        (n) => n.action === 'EncodeInputs',
      ).fields.video_source_sha256.sourcePortId = 'unrelated'),
    (s) =>
      delete s.context.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.action === 'Denoise').fields.strength,
  ]) {
    const state = nativeAutoFixture('WanVideoToVideoPipeline', 'video_to_video');
    change(state);
    assert.equal(observedNativeAutoVideoPlan(state.api, state.context), null);
  }
});

test('rehashed native video observations cannot substitute resource controls while preserving original graph bindings', () => {
  const { api, context } = nativeAutoFixture('WanPipeline', 'text_to_video');
  const plan = observedNativeAutoVideoPlan(api, context);
  const provenance = {
    taskId: context.taskId,
    template: { lockedSettings: { mode: 'text_to_video' } },
    graph: canonicalGraphIdentity(api),
    models: modelSetIdentity(context.modelIdentities),
    inputs: { hash: 'empty-inputs' },
    runtime: { backendSource: context.backendSource },
  };
  assert(observedNativeAutoVideoProofMatches(plan, provenance));
  for (const mutate of [
    (p) => {
      p.dtype = 'float16';
    },
    (p) => {
      p.device = 'cpu';
    },
    (p) => {
      p.offloadMode = 'none';
    },
    (p) => {
      p.modelRepo = 'other/model';
    },
    (p) => {
      p.pipelineClass = 'OtherPipeline';
    },
    (p) => {
      p.observation.hardwareQualification = true;
    },
    (p) => {
      p.observation.fullFieldAccountingClaimed = true;
    },
    (p) => {
      p.observation.runtimePreparation.resourceMode = 'expert';
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    assert(observedNativeAutoVideoResourceId(changed));
    assert.equal(observedNativeAutoVideoProofMatches(changed, provenance), false);
  }
  const changed = structuredClone(plan),
    edited = structuredClone(provenance);
  const graph = edited.graph.canonicalGraph;
  graph.nodes.find((n) => n.action === 'DecodeLatents').params.latent_binding.sourceId = graph.nodes.find(
    (n) => n.action === 'LoadPipeline',
  ).key;
  edited.graph.hash = 'sha256:canonical-graph-v1:' + canonicalJsonHash(graph);
  changed.observation.bindings.canonicalGraphHash = edited.graph.hash;
  assert.equal(observedNativeAutoVideoProofMatches(changed, edited), false);
});

test('native Auto reader refuses stale hashes, borrowed bindings, missing captures and resource substitutions', () => {
  for (const mutate of [
    ({ api }) => {
      api.runtimeHints.workflowAutoPlan.graphHash = 'stale';
    },
    ({ api }) => {
      api.nodes.decode.params.latent_binding.sourceId = 'owner';
    },
    ({ context }) => {
      context.executionReceipt.runtimePreparation.workflowAuto.resolvedFields.owner.offload_mode = 'none';
    },
    ({ context }) => {
      context.executedOutput.resolvedExecutionInputs.uncapturedNodeIds = ['encode'];
    },
    ({ context }) => {
      context.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields.seed.value++;
    },
    ({ context }) => {
      context.executionReceipt.runtimePreparation.resourceMode = 'expert';
    },
    ({ api }) => {
      api.nodes.encode.action = 'Other';
    },
    ({ context }) => {
      context.modelIdentities[0].selectedRevision = 'b'.repeat(40);
    },
  ]) {
    const state = nativeAutoFixture('WanPipeline', 'text_to_video');
    mutate(state);
    if (state.api.runtimeHints.workflowAutoPlan.graphHash !== 'stale')
      state.api.runtimeHints.workflowAutoPlan.graphHash = workerGraphHash(state.api);
    assert.equal(observedNativeAutoVideoPlan(state.api, state.context), null);
  }
});

test('native Auto joins the upscaler artifact and its immutable installed model instead of accepting an unrelated pin', () => {
  const { api, context } = nativeAutoFixture('WanPipeline', 'text_to_video');
  const artifact = {
    source: 'hub',
    value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
    revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
    sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
    byteSize: 67061725,
  };
  api.nodes.upscale = {
    module: 'modules.Spandrel',
    action: 'Upscaler',
    params: {
      image: { sourceId: 'decode', sourceKey: 'video_out' },
      model_id: { value: artifact },
    },
  };
  api.nodes.output.params.video = { sourceId: 'upscale', sourceKey: 'output' };
  api.paths[0].splice(-1, 0, 'upscale');
  context.executedOutput.resolvedExecutionInputs.nodes.push({
    nodeId: 'upscale',
    module: 'modules.Spandrel',
    action: 'Upscaler',
    fields: { model_id: { source: 'literal', value: artifact.value } },
    omittedFields: {},
  });
  context.modelIdentities.push({
    repoId: 'nateraw/real-esrgan',
    selectedRevision: artifact.revision,
    modelRevision: 'nateraw/real-esrgan@' + artifact.revision,
    fingerprint: 'sha256:' + 'f'.repeat(64),
  });
  context.resolvedModelRepos.push('nateraw/real-esrgan');
  api.runtimeHints.workflowAutoPlan.graphHash = workerGraphHash(api);
  assert(observedNativeAutoVideoPlan(api, context));
  const model = context.modelIdentities[1];
  model.selectedRevision = 'a'.repeat(40);
  model.modelRevision = model.repoId + '@' + model.selectedRevision;
  assert.equal(observedNativeAutoVideoPlan(api, context), null);
  model.selectedRevision = artifact.revision;
  model.modelRevision = model.repoId + '@' + artifact.revision;
  artifact.sha256 = 'b'.repeat(64);
  api.runtimeHints.workflowAutoPlan.graphHash = workerGraphHash(api);
  assert.equal(observedNativeAutoVideoPlan(api, context), null);
});

test('native Auto observation preserves the real owner release schedule and refuses reordered dependencies', () => {
  const { api, context } = nativeAutoFixture('LTXConditionPipeline', 'text_to_video', 3);
  const auto = context.executionReceipt.runtimePreparation.workflowAuto;
  auto.strategy = 'dependency_order_release_owners';
  auto.schedule = {
    executionOrder: [...api.paths[0]],
    owners: [{ ownerId: 'owner' }],
    releases: [
      {
        afterIndex: api.paths[0].indexOf('decode2'),
        afterNodeId: 'decode2',
        nodeIds: ['owner', 'encode', 'denoise', 'decode'],
        retainOutputs: { decode: ['video_out'] },
      },
    ],
  };
  const plan = observedNativeAutoVideoPlan(api, context);
  assert(plan);
  assert.deepEqual(plan.observation.runtimePreparation, context.executionReceipt.runtimePreparation);
  auto.schedule.executionOrder.reverse();
  assert.equal(observedNativeAutoVideoPlan(api, context), null);
});
