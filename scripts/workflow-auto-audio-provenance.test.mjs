import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { canonicalizeApiGraph, executionPlanIdentity, executionReceiptIdentity } from './live-proof-provenance.mjs';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import {
  observedWorkflowAutoAudioProofMatches,
  observedWorkflowAutoResourceId,
} from './observed-workflow-auto-resource.mjs';

const literal = (value) => ({ value });
const connect = (sourceId, sourceKey) => ({ sourceId, sourceKey });
function workerHash(graph) {
  const text = JSON.stringify(stableJsonValue({ nodes: graph.nodes, paths: graph.paths })).replace(
    /[\u007f-\uffff]/gu,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  return 'sha256:workflow-auto-v1:' + createHash('sha256').update(text).digest('hex');
}

// Synthetic receipts describe no installed model, real execution, qualification or publication.
function audioWitness({ continuation = false, prefix = '', seed = 41, prompt = 'A three-beat song' } = {}) {
  const id = Object.fromEntries(
    ['quant', 'recipe', 'owner', 'generate', 'export', 'load', 'match', 'join'].map((key) => [key, prefix + key]),
  );
  const mode = continuation ? 'audio_continuation' : 'text_to_audio';
  const contract = {
    schemaVersion: 1,
    library: 'diffusers',
    mediaKind: 'audio',
    pipelineClass: 'ExampleAudioPipeline',
    repository: 'example/audio',
    mode,
    actions: { Generate: [mode] },
    sourceAudio: continuation ? 'required' : 'forbidden',
    referenceAudio: 'forbidden',
  };
  const form = {
    resourceMode: 'auto',
    mode,
    modelType: 'LegacyAudioDisplayAlias',
    quantizationMode: 'none',
    dtype: 'bfloat16',
    device: 'cuda:0',
    autoOffload: true,
    offloadMode: 'model_cpu',
    trustRemoteCode: false,
    audioDuration: 75,
    extensionDuration: 15,
    steps: 8,
    guidanceScale: 1,
    seed,
    prompt,
    lyrics: 'MoDiff—three beats',
    vocalLanguage: 'en',
    shift: 3,
    bpm: 170,
    keyscale: 'C# minor',
    timesignature: '3',
    sourceAudio: continuation ? '@data/audio/source.wav' : '',
  };
  const recipe = {
    device_map: 'none',
    max_memory: '{}',
    device_map_overrides: '{}',
    offload_mode: 'model_cpu',
    device: 'cuda:0',
    attention_backend: 'auto',
    attention_components: '',
    vae_slicing: true,
    vae_tiling: true,
    layerwise_casting: false,
    layerwise_casting_components: 'transformer',
    layerwise_storage_dtype: 'float8_e4m3fn',
    layerwise_compute_dtype: 'bfloat16',
    channels_last: false,
    channels_last_components: 'unet,vae',
    regional_compile: false,
    compile_components: 'transformer',
    compile_backend: 'inductor',
    compile_mode: 'default',
    compile_fullgraph: false,
    compile_dynamic: false,
    denoiser_cache: 'none',
    cache_threshold: 0.05,
    cache_options: '{}',
  };
  const owner = {
    model_id: { source: 'hub', value: 'example/audio' },
    pipeline_class: 'ExampleAudioPipeline',
    mode,
    audio_contract: contract,
    revision: 'a'.repeat(40),
    dtype: 'bfloat16',
    device: 'cuda:0',
    auto_offload: true,
    offload_mode: 'model_cpu',
    enable_vae_tiling: true,
    low_cpu_mem_usage: true,
  };
  const generate = {
    audio_contract: contract,
    task_type: continuation ? 'continuation' : 'text2music',
    prompt,
    lyrics: form.lyrics,
    audio_duration: 75,
    extension_duration: 15,
    vocal_language: 'en',
    num_inference_steps: 8,
    guidance_scale: 1,
    shift: 3,
    seed,
    bpm: 170,
    keyscale: 'C# minor',
    timesignature: '3',
    sample_rate: 48000,
    return_continuation_tail: continuation,
  };
  const node = (module, action, values) => ({
    module,
    action,
    params: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, literal(v)])),
  });
  const nodes = {
    [id.quant]: node('modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', {
      backend: 'none',
      components: ['transformer'],
      dtype: 'bfloat16',
      excluded_modules: '',
      component_overrides: '{}',
    }),
    [id.recipe]: node('modules.DiffusersRuntime', 'DiffusersExecutionRecipe', recipe),
    [id.owner]: node('modules.DiffusersAudio', 'LoadPipeline', owner),
    [id.generate]: node('modules.DiffusersAudio', 'Generate', generate),
    [id.export]: node('modules.Audio', 'Export', { filename: '{PATH:audio}/example.wav', sample_rate: 48000 }),
  };
  nodes[id.recipe].params.quantization_config = connect(id.quant, 'quantization_config');
  nodes[id.owner].params.execution_recipe = connect(id.recipe, 'execution_recipe');
  nodes[id.generate].params.pipeline = connect(id.owner, 'pipeline');
  nodes[id.export].params.audio = connect(id.generate, 'audio');
  nodes[id.export].params.preview = { display: 'ui_audio', sourceKey: 'file' };
  let order = [id.quant, id.recipe, id.owner, id.generate, id.export];
  if (continuation) {
    nodes[id.load] = node('modules.Audio', 'Load', { file: '@data/audio/source.wav' });
    nodes[id.load].params.preview = {
      display: 'ui_audio',
      sourceKey: 'filename',
      value: ['/file?file=%40data/audio/source.wav'],
    };
    nodes[id.generate].params.source_audio = connect(id.load, 'audio');
    nodes[id.match] = {
      module: 'modules.Audio',
      action: 'MatchLoudness',
      params: { audio: connect(id.generate, 'audio'), reference: connect(id.load, 'audio') },
    };
    nodes[id.join] = {
      module: 'modules.Audio',
      action: 'Join',
      params: {
        source: connect(id.load, 'audio'),
        continuation: connect(id.match, 'output'),
        boundary_fade_seconds: literal(0.01),
      },
    };
    nodes[id.export].params.audio = connect(id.join, 'output');
    order = [id.load, id.quant, id.recipe, id.owner, id.generate, id.match, id.join, id.export];
  }
  const graph = {
    sid: 'session',
    nodes,
    paths: [order],
    runtimeHints: {
      resourceMode: 'auto',
      workflowTabId: 'workflow',
      clientRunId: 'client',
      runInputHash: 'input',
      workflowSnapshot: { studioForm: form },
    },
  };
  graph.runtimeHints.workflowAutoPlan = { schemaVersion: 1, graphHash: workerHash(graph) };
  const capture = (values) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { source: 'literal', value }]));
  const ownerFields = Object.fromEntries(
    [
      'model_id',
      'pipeline_class',
      'revision',
      'dtype',
      'device',
      'auto_offload',
      'offload_mode',
      'enable_vae_tiling',
    ].map((key) => [key, key === 'model_id' ? owner.model_id.value : owner[key]]),
  );
  const rows = order.map((nodeId) => ({
    nodeId,
    module: nodes[nodeId].module,
    action: nodes[nodeId].action,
    fields: {},
    omittedFields: {},
  }));
  const byId = new Map(rows.map((row) => [row.nodeId, row]));
  byId.get(id.owner).fields = capture(ownerFields);
  byId.get(id.quant).fields = capture({ dtype: 'bfloat16' });
  byId.get(id.recipe).fields = capture(
    Object.fromEntries(
      ['device', 'offload_mode', 'attention_backend', 'vae_slicing', 'vae_tiling'].map((key) => [key, recipe[key]]),
    ),
  );
  byId.get(id.generate).fields = capture({
    ...Object.fromEntries(
      [
        'prompt',
        'lyrics',
        'vocal_language',
        'num_inference_steps',
        'guidance_scale',
        'shift',
        'seed',
        'bpm',
        'keyscale',
        'timesignature',
        'sample_rate',
      ].map((key) => [key, generate[key]]),
    ),
    audio_duration: continuation ? 90 : 75,
  });
  byId.get(id.export).fields = capture({ sample_rate: 48000 });
  const resolvedFields = {
    [id.owner]: Object.fromEntries(
      ['model_id', 'pipeline_class', 'revision', 'dtype', 'device', 'offload_mode', 'auto_offload', 'mode'].map(
        (key) => [key, owner[key]],
      ),
    ),
    [id.recipe]: Object.fromEntries(
      [
        'attention_backend',
        'regional_compile',
        'layerwise_casting',
        'channels_last',
        'device_map',
        'denoiser_cache',
        'max_memory',
        'device_map_overrides',
        'vae_slicing',
        'vae_tiling',
        'offload_mode',
        'device',
      ].map((key) => [key, recipe[key]]),
    ),
    [id.quant]: { backend: 'none', component_overrides: '{}' },
    [id.generate]: { num_inference_steps: 8, guidance_scale: 1, audio_duration: 75 },
  };
  const task = {
    task_id: 'task',
    status: 'completed',
    attempt_index: 0,
    sid: graph.sid,
    workflow_tab_id: 'workflow',
    client_run_id: 'client',
    run_input_hash: 'input',
    workflow_snapshot: structuredClone(graph.runtimeHints.workflowSnapshot),
    resourceCandidateId: null,
    runtimePreparation: {
      resourceMode: 'auto',
      workflowAuto: {
        strategy: 'dependency_order_retained_owners',
        schedule: null,
        cachePreparation: null,
        reusedOwnerIds: [],
        preparedDataNodes: [],
        appliedUpdates: [],
        releases: [],
        resolvedFields,
      },
    },
    runtimeMeasurement: { elapsedSeconds: 10, peakAllocatedBytes: 1024, backend: 'rocm', device: 'cuda:0' },
  };
  const output = {
    taskId: 'task',
    attemptIndex: 0,
    sid: graph.sid,
    workflowTabId: 'workflow',
    clientRunId: 'client',
    runInputHash: 'input',
    nodeId: id.export,
    apiGraphSnapshot: structuredClone(graph),
    formSnapshot: structuredClone(form),
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: 'task',
      attemptIndex: 0,
      nodeId: id.export,
      truncated: false,
      uncapturedNodeIds: [],
      nodes: rows,
    },
  };
  const context = {
    taskId: 'task',
    executionReceipt: task,
    executedOutput: output,
    modelIdentities: [
      {
        repoId: 'example/audio',
        selectedRevision: 'a'.repeat(40),
        modelRevision: 'example/audio@' + 'a'.repeat(40),
        fingerprint: 'sha256:' + 'b'.repeat(64),
      },
    ],
  };
  return { graph, context, id, task, output };
}

for (const continuation of [false, true]) {
  test(`ordinary Auto audio derives only the executed resource identity (${continuation ? 'joined continuation' : 'text'})`, () => {
    const w = audioWitness({ continuation });
    const before = JSON.stringify(w);
    const plan = executionPlanIdentity(w.graph, w.context).plan;
    assert.equal(plan.source, 'observed-workflow-auto-audio-resource-v1');
    assert.equal(plan.resourceMode, 'auto');
    assert.equal(plan.modelType, 'ExampleAudioPipeline');
    assert.equal(plan.modelRepo, 'example/audio');
    assert.equal(plan.modelRevision, 'a'.repeat(40));
    assert.equal(plan.resourceObservation.workload.effectiveAudioDuration, continuation ? 90 : 75);
    assert.match(
      executionReceiptIdentity(w.task, plan).resourceCandidateId,
      /^observed-workflow-auto-audio-resource-v1:/u,
    );
    assert.equal(w.task.resourceCandidateId, null);
    assert.equal(JSON.stringify(w), before, 'do not retrofit raw task or graph fields');
    assert.equal(plan.qualified, undefined);
  });
}

test('Auto audio resource identity ignores node labels, prompt and seed but retains effective duration', () => {
  const a = audioWitness(),
    b = audioWitness({ prefix: 'renamed-', seed: 52, prompt: 'A different song' });
  const first = executionPlanIdentity(a.graph, a.context).plan;
  const second = executionPlanIdentity(b.graph, b.context).plan;
  assert.equal(first.source, 'observed-workflow-auto-audio-resource-v1');
  assert.equal(first.observedResourceCandidateId, second.observedResourceCandidateId);
  const continuation = audioWitness({ continuation: true });
  assert.notEqual(
    first.observedResourceCandidateId,
    executionPlanIdentity(continuation.graph, continuation.context).plan.observedResourceCandidateId,
  );
});

test('missing or conflicting raw Auto audio authority stays held', () => {
  for (const mutate of [
    (w) => {
      w.task.status = 'failed';
    },
    (w) => {
      w.task.attempt_index = 1;
    },
    (w) => {
      w.output.taskId = 'other';
    },
    (w) => {
      w.output.sid = 'other';
    },
    (w) => {
      delete w.task.runtimePreparation;
    },
    (w) => {
      w.task.runtimePreparation.workflowAuto.reusedOwnerIds = [w.id.owner];
    },
    (w) => {
      w.task.runtimePreparation.workflowAuto.preparedDataNodes = [w.id.load];
    },
    (w) => {
      w.task.runtimePreparation.workflowAuto.appliedUpdates = [{}];
    },
    (w) => {
      delete w.output.resolvedExecutionInputs.nodes.find((row) => row.nodeId === w.id.generate).fields.lyrics;
    },
    (w) => {
      w.output.resolvedExecutionInputs.nodes.find((row) => row.nodeId === w.id.generate).fields.seed.value++;
    },
    (w) => {
      w.task.runtimePreparation.workflowAuto.resolvedFields[w.id.owner].revision = 'b'.repeat(40);
    },
    (w) => {
      w.context.modelIdentities = [];
    },
    (w) => {
      w.task.resourceCandidateId = 'contradictory-primary-candidate';
    },
    (w) => {
      w.output.resolvedExecutionInputs.schemaVersion = 2;
    },
    (w) => {
      w.output.resolvedExecutionInputs.truncated = true;
    },
    (w) => {
      w.output.resolvedExecutionInputs.nodes.push(w.output.resolvedExecutionInputs.nodes[0]);
    },
    (w) => {
      w.task.runtimePreparation.workflowAuto.schedule = {};
    },
    (w) => {
      w.task.runtimePreparation.workflowAuto.cachePreparation = {};
    },
    (w) => {
      w.task.runtimePreparation.workflowAuto.releases = [w.id.owner];
    },
    (w) => {
      w.graph.runtimeHints.workflowAutoPlan.graphHash = 'sha256:other';
    },
  ]) {
    const w = audioWitness({ continuation: true });
    mutate(w);
    assert.notEqual(executionPlanIdentity(w.graph, w.context).plan.source, 'observed-workflow-auto-audio-resource-v1');
  }
});

test('Auto audio refuses unsupported authored controls even with matching task snapshots', () => {
  for (const mutate of [
    (w) => {
      w.graph.nodes[w.id.recipe].params.attention_backend.value = '_native_math';
    },
    (w) => {
      w.graph.nodes[w.id.recipe].params.regional_compile.value = true;
    },
    (w) => {
      w.graph.nodes[w.id.recipe].params.max_memory.value = '{"0":100}';
    },
    (w) => {
      w.graph.nodes[w.id.quant].params.backend.value = 'bitsandbytes';
    },
    (w) => {
      w.graph.nodes[w.id.generate].params.return_continuation_tail.value = false;
    },
    (w) => {
      w.graph.nodes[w.id.export].params.audio.sourceId = w.id.generate;
    },
    (w) => {
      w.graph.nodes[w.id.generate].params.source_audio.sourceId = w.id.export;
    },
    (w) => {
      w.graph.nodes[w.id.load].params.file = { sourceId: w.id.export, sourceKey: 'file' };
    },
    (w) => {
      w.graph.nodes[w.id.load].params.file.value = '@data/audio/other.wav';
    },
    (w) => {
      w.graph.runtimeHints.workflowSnapshot.studioForm.extensionDuration = 30;
    },
    (w) => {
      w.graph.nodes[w.id.owner].params.revision.value = 'main';
    },
    (w) => {
      w.graph.loops = [];
    },
  ]) {
    const w = audioWitness({ continuation: true });
    mutate(w);
    w.graph.runtimeHints.workflowAutoPlan.graphHash = workerHash(w.graph);
    w.output.apiGraphSnapshot = structuredClone(w.graph);
    w.output.formSnapshot = structuredClone(w.graph.runtimeHints.workflowSnapshot.studioForm);
    w.task.workflow_snapshot = structuredClone(w.graph.runtimeHints.workflowSnapshot);
    assert.notEqual(executionPlanIdentity(w.graph, w.context).plan.source, 'observed-workflow-auto-audio-resource-v1');
  }
});

function projection(w) {
  const plan = executionPlanIdentity(w.graph, w.context).plan;
  const provenance = {
    graph: { canonicalGraph: canonicalizeApiGraph(w.graph) },
    models: { items: w.context.modelIdentities },
    output: {
      items: [{ durationSeconds: plan.resourceObservation.workload.effectiveAudioDuration, sampleRate: 48000 }],
    },
  };
  return { plan, provenance };
}

test('rehashed incomplete or contradictory audio observations cannot supply resource IDs', () => {
  for (const mutate of [
    (p) => {
      p.resourceObservation.controls[0].fields = {};
    },
    (p) => {
      p.resourceObservation.controls.pop();
    },
    (p) => {
      p.resourceObservation.controls[0].fields.extra = true;
    },
    (p) => {
      p.resourceObservation.workload.steps++;
    },
    (p) => {
      p.resourceObservation.workload.effectiveAudioDuration++;
    },
    (p) => {
      p.resourceObservation.controls.find((c) => c.scope.endsWith('.Generate')).fields.audio_duration = 90;
    },
    (p) => {
      p.resourceObservation.controls.find((c) => c.scope.endsWith('.LoadPipeline')).fields.revision = 'b'.repeat(40);
    },
    (p) => {
      p.resourceObservation.controls.find((c) =>
        c.scope.endsWith('.DiffusersExecutionRecipe'),
      ).fields.regional_compile = true;
    },
    (p) => {
      p.resourceObservation.controls.find((c) => c.scope.endsWith('.PipelineQuantizationConfigV2')).fields.backend =
        'other';
    },
  ]) {
    const { plan } = projection(audioWitness({ continuation: true }));
    mutate(plan);
    plan.observedResourceCandidateId = plan.source + ':' + canonicalJsonHash(plan.resourceObservation);
    assert.equal(observedWorkflowAutoResourceId(plan), null);
  }
});

test('audio projection remains bound to canonical controls, model pin and delivery duration', () => {
  for (const continuation of [false, true]) {
    const { plan: validPlan, provenance: validProof } = projection(audioWitness({ continuation }));
    assert.equal(observedWorkflowAutoAudioProofMatches(validPlan, validProof), true);
    for (const mutate of [
      (p) => {
        p.models.items[0].selectedRevision = 'b'.repeat(40);
      },
      (p) => {
        p.output.items[0].durationSeconds = 15;
      },
      (p) => {
        p.output.items[0].sampleRate = 44100;
      },
      (p) => {
        p.graph.canonicalGraph.nodes.find((n) => n.action === 'Generate').params.audio_duration.value = 15;
      },
      (p) => {
        p.graph.canonicalGraph.nodes.find((n) => n.action === 'Export').params.sample_rate.value = 44100;
      },
      (p) => {
        p.graph.canonicalGraph.nodes.find((n) => n.action === 'DiffusersExecutionRecipe').params.offload_mode.value =
          'none';
      },
    ]) {
      const { plan, provenance } = projection(audioWitness({ continuation }));
      mutate(provenance);
      assert.equal(observedWorkflowAutoAudioProofMatches(plan, provenance), false);
    }
  }
});
