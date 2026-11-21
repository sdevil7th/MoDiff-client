import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJsonHash } from './canonical-json.mjs';
import {
  backendContractIdentity,
  canonicalizeApiGraph,
  createRunProvenance,
  executionPlanIdentity,
  executionReceiptIdentity,
} from './live-proof-provenance.mjs';
import {
  observedRetainedExpertTextProofMatches,
  observedRetainedExpertTextResourceId,
} from './retained-native-text-resource.mjs';

const SOURCE = 'observed-retained-expert-text-resource-v1';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const scope = 'modules.ModularDiffusers.';

// Synthetic records only: no private files, model execution or hardware proof.
function witness() {
  const literal = (value) => ({ value });
  const wire = (sourceId, sourceKey) => ({ sourceId, sourceKey });
  const form = {
    mode: 'text_to_image',
    modelType: 'LegacyExamplePipeline',
    resourceMode: 'expert',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    trustRemoteCode: false,
    device: 'cuda:0',
    autoOffload: true,
    offloadMode: 'group_cpu',
    width: 64,
    height: 64,
    steps: 2,
    seed: 12,
    randomSeed: false,
    guidanceScale: 3.5,
    prompt: 'A fictional ceramic workshop.',
    negativePrompt: '',
    maxSequenceLength: 512,
  };
  const node = (action, params) => ({ module: 'modules.ModularDiffusers', action, params });
  const guide = {
    model_type: 'ExampleModularPipeline',
    guider: 'ClassifierFreeGuidance',
    guidance_scale: 3.5,
    guidance_rescale: 0,
    use_original_formulation: false,
    enabled: true,
    start: 0,
    stop: 1,
  };
  const graph = {
    sid: 'example-session',
    nodes: {
      owner: node(
        'ModelsLoader',
        Object.fromEntries(
          Object.entries({
            model_type: 'ExampleModularPipeline',
            repo_id: { source: 'hub', value: 'example/model' },
            revision: 'a'.repeat(40),
            dtype: 'bfloat16',
            device: 'cuda:0',
            offload_mode: 'group_cpu',
            auto_offload: true,
            attention_backend: 'auto',
            trust_remote_code: false,
            workflow_id: '',
            vae_slicing: true,
            vae_tiling: true,
            quant_config: null,
            lora_list: null,
            unet: null,
            vae: null,
            controlnet: null,
          }).map(([k, v]) => [k, literal(v)]),
        ),
      ),
      guide: node('Guider', Object.fromEntries(Object.entries(guide).map(([k, v]) => [k, literal(v)]))),
      encode: node('EncodePrompt', {
        prompt: literal(form.prompt),
        negative_prompt: literal(''),
        max_sequence_length: literal(512),
        text_encoders: wire('owner', 'text_encoders'),
        guider: wire('guide', 'guider_out'),
      }),
      denoise: node('Denoise', {
        width: literal(64),
        height: literal(64),
        seed: literal(12),
        num_inference_steps: literal(2),
        guidance_scale: literal(3.5),
        strength: literal(0.5),
        image_latents: literal(null),
        unet: wire('owner', 'unet_out'),
        scheduler: wire('owner', 'scheduler'),
        embeddings: wire('encode', 'embeddings'),
        guider: wire('guide', 'guider_out'),
      }),
      decode: node('DecodeLatents', {
        vae: wire('owner', 'vae_out'),
        latents: wire('denoise', 'latents'),
        width: wire('denoise', 'out_width'),
        height: wire('denoise', 'out_height'),
      }),
      preview: {
        module: 'modules.Image',
        action: 'Preview',
        params: { image: wire('decode', 'images'), device: literal('cpu:0') },
      },
    },
    paths: [['owner', 'guide', 'encode', 'denoise', 'decode', 'preview']],
  };
  const ownerData = {
    ...structuredClone(graph.nodes.owner),
    operationAuthoring: {
      schemaVersion: 1,
      operation: {
        pipelineClass: 'ExampleModularPipeline',
        task: 'text_to_image',
        nodeKey: scope + 'ModelsLoader',
        binding: { pipelineClass: 'ExampleModularPipeline', values: { model_type: 'ExampleModularPipeline' } },
      },
    },
  };
  const snapshot = { studioForm: form, nodes: [{ id: 'owner', data: ownerData }], edges: [] };
  graph.runtimeHints = {
    clientRunId: 'example-client',
    runInputHash: 'example-input',
    workflowTabId: 'example-workflow',
    workflowSnapshot: snapshot,
  };
  const files = [{ path: 'main.py', sha256: 'f'.repeat(64) }];
  const source = {
    gitCommit: null,
    files,
    fingerprint: 'sha256:backend-source-v1:' + canonicalJsonHash({ gitCommit: null, files }),
  };
  const task = {
    task_id: 'example-task',
    sid: graph.sid,
    status: 'completed',
    attempt_index: 0,
    started_at: 1_000_000_000,
    completed_at: 1_000_000_010,
    resourceCandidateId: null,
    workflow_tab_id: 'example-workflow',
    client_run_id: 'example-client',
    run_input_hash: 'example-input',
    workflow_snapshot: snapshot,
    runtimeFingerprint: { backendSource: { fingerprint: source.fingerprint, gitCommit: null, fileCount: 1 } },
    runtimePreparation: { resourceMode: 'expert', performed: false, residentRecipeReusable: false, cleanup: null },
  };
  const output = {
    taskId: task.task_id,
    sid: graph.sid,
    workflowTabId: task.workflow_tab_id,
    clientRunId: task.client_run_id,
    runInputHash: task.run_input_hash,
    attemptIndex: 0,
    nodeId: 'preview',
    formSnapshot: form,
    mediaItems: [{ width: 64, height: 64 }],
  };
  const captured = (action, fields) => ({
    nodeId: action,
    module: graph.nodes[action].module,
    action: graph.nodes[action].action,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { source: 'literal', value: v }])),
    omittedFields: {},
  });
  const ownerFields = Object.fromEntries(
    'model_type repo_id revision dtype device auto_offload offload_mode quant_config attention_backend vae_slicing vae_tiling'
      .split(' ')
      .map((k) => [k, k === 'repo_id' ? 'example/model' : graph.nodes.owner.params[k].value]),
  );
  output.resolvedExecutionInputs = {
    schemaVersion: 1,
    source: 'backend-execution',
    taskId: task.task_id,
    attemptIndex: 0,
    nodeId: 'preview',
    truncated: false,
    uncapturedNodeIds: [],
    graphTasks: [{ loaderId: 'owner', pipelineClass: 'ExampleModularPipeline', task: 'text_to_image' }],
    nodes: [
      captured('owner', ownerFields),
      captured('guide', guide),
      captured('encode', { prompt: form.prompt, negative_prompt: '', max_sequence_length: 512 }),
      captured('denoise', {
        width: 64,
        height: 64,
        seed: 12,
        num_inference_steps: 2,
        guidance_scale: 3.5,
        strength: 0.5,
      }),
      {
        ...captured('decode', {}),
        fields: Object.fromEntries(
          ['width', 'height'].map((k) => [
            k,
            { source: 'connected', sourceNodeId: 'denoise', sourcePortId: 'out_' + k, value: 64 },
          ]),
        ),
      },
      captured('preview', { device: 'cpu:0' }),
    ],
  };
  const at = (seconds) => new Date((task.started_at + seconds) * 1000).toISOString();
  const nativeGuide = {
    class: 'diffusers.guiders.classifier_free_guidance.ClassifierFreeGuidance',
    config: Object.fromEntries(Object.entries(guide).filter(([k]) => !['model_type', 'guider'].includes(k))),
  };
  const policy = (applied = {}) => ({
    executionDevice: 'cuda:0',
    offloadMode: 'group_cpu',
    applied,
    requested: applied,
  });
  const stages = ['EncodePrompt', 'Denoise', 'DecodeLatents'];
  const ids = ['encode', 'denoise', 'decode'];
  const calls = stages.map((stage, i) => ({
    event: 'officialCallStarted',
    at: at(i + 1),
    callId: String(i + 1).repeat(32),
    pipelineClass: 'diffusers.modular_pipelines.modular_pipeline.ModularPipeline',
    actualPipelineClass: 'diffusers.modular_pipelines.example.ExampleModularPipeline',
    task: { task_id: task.task_id, attempt_index: 0, current_node: ids[i], current_node_name: scope + stage },
    callInputs:
      i === 0
        ? { prompt: form.prompt, negative_prompt: '', max_sequence_length: 512 }
        : i === 1
          ? { width: 64, height: 64, num_inference_steps: 2, guidance_scale: 3.5 }
          : {},
    generator: i === 1 ? { device: 'cuda:0', initialSeed: 12, type: 'Generator' } : null,
    guider: i < 2 ? nativeGuide : null,
    peftComponentAdapterNames: {},
    peftLayerScaleHistograms: {},
    wholePipelineAdapterScales: null,
    scheduler:
      i === 1
        ? {
            class: 'diffusers.schedulers.scheduling_flow_match_euler_discrete.FlowMatchEulerDiscreteScheduler',
            config: { num_train_timesteps: 1000 },
          }
        : null,
    componentRuntimePolicies:
      i === 0
        ? { text_encoder: policy(), text_encoder_2: policy() }
        : i === 1
          ? { transformer: policy({ attention_backend: 'auto' }) }
          : { vae: policy({ vae_slicing: true, vae_tiling: true }) },
    vaeMemoryFlags: i === 2 ? { use_slicing: true, use_tiling: true } : { use_slicing: null, use_tiling: null },
  }));
  const journal = calls.flatMap((c, i) => [
    c,
    {
      event: 'officialCallReturned',
      at: at(i + 1.5),
      callId: c.callId,
      task: c.task,
      images: i === 2 ? [{ mode: 'RGB', size: [64, 64] }] : { type: 'NoneType' },
    },
  ]);
  for (let i = 0; i < 2; i++)
    journal.push(
      { event: 'schedulerStepStarted', at: at(2.1 + i / 10), task: calls[1].task, stepIndex: i === 0 ? null : i },
      { event: 'schedulerStepReturned', at: at(2.15 + i / 10), task: calls[1].task, stepIndex: i + 1 },
    );
  const observer = {
    installedAt: at(-1),
    observerSha256: 'c'.repeat(64),
    wrappedCalls: [{ kind: 'officialPipelineCall', class: calls[0].pipelineClass }],
  };
  const model = {
    repoId: 'example/model',
    selectedRevision: 'a'.repeat(40),
    modelRevision: 'example/model@' + 'a'.repeat(40),
    fingerprint: 'sha256:' + 'e'.repeat(64),
  };
  const w = {
    graph,
    task,
    output,
    source,
    models: [model],
    calls,
    journal,
    observer,
    requests: [{ at: at(-0.1), path: '/graph', body: graph }],
    responses: [
      { at: at(0.1), path: '/graph', status: 200, body: { error: false, sid: graph.sid, task_id: task.task_id } },
    ],
    derived: {
      taskId: task.task_id,
      evidenceHashes: {},
      actualOfficialCalls: calls,
      actualDiffusersDirectUrl: {
        value: { url: 'https://github.com/huggingface/diffusers.git', vcs_info: { commit_id: 'b'.repeat(40) } },
      },
    },
  };
  return w;
}

function context(w) {
  const record = (text) => ({ text, sha256: sha(text) });
  const records = {
    receipt: record(JSON.stringify({ task: w.task, outputs: [w.output] })),
    requests: record(JSON.stringify(w.requests)),
    responses: record(JSON.stringify(w.responses)),
    journal: record(w.journal.map((x) => JSON.stringify(x)).join('\n') + '\n'),
    observer: record(JSON.stringify(w.observer)),
  };
  w.derived.evidenceHashes = {
    'run-receipt.json': records.receipt.sha256,
    'requests.json': records.requests.sha256,
    'responses.json': records.responses.sha256,
  };
  records.derived = record(JSON.stringify(w.derived));
  const payload = Object.fromEntries(Object.values(w.graph.nodes).map((n) => [n.module + '.' + n.action, n]));
  return {
    executionReceipt: w.task,
    executedOutput: w.output,
    taskId: w.task.task_id,
    modelIdentities: w.models,
    backendSource: w.source,
    backendContract: backendContractIdentity(payload, canonicalizeApiGraph(w.graph)),
    retainedNativeEvidence: records,
  };
}

test('retained Expert text records use their original request and native calls without fabricating missing fields', () => {
  const w = witness();
  const c = context(w),
    before = structuredClone({ w, c });
  const plan = executionPlanIdentity(w.graph, c).plan;
  assert.equal(plan.source, SOURCE);
  assert.equal(plan.resourceObservation.recipe.originalLoaderWorkflowId, '');
  assert.deepEqual(plan.resourceObservation.recipe.absentLoaderControls, ['weight_format', 'weight_loading_mode']);
  assert.equal(Object.hasOwn(w.output, 'apiGraphSnapshot'), false);
  assert.equal(w.task.resourceCandidateId, null);
  assert.deepEqual({ w, c }, before);
});

test('retained text refuses contradictory original witnesses after their record hashes are recomputed', async (t) => {
  const mutations = {
    'wrong original task response': (w) => {
      w.responses[0].body.task_id = 'other-task';
    },
    'wrong session': (w) => {
      w.output.sid = 'other-session';
    },
    'failed original task': (w) => {
      w.task.status = 'failed';
    },
    'retried original task': (w) => {
      w.task.attempt_index = 1;
    },
    'borrowed VAE': (w) => {
      w.graph.nodes.owner.params.vae = { sourceId: 'decode', sourceKey: 'images' };
    },
    'invented loading port': (w) => {
      w.graph.nodes.owner.params.weight_loading_mode = { value: 'cpu' };
    },
    'invented weight format': (w) => {
      w.graph.nodes.owner.params.weight_format = { value: 'native' };
    },
    'invented form loading mode': (w) => {
      w.output.formSnapshot.weightLoadingMode = 'cpu';
    },
    'wrong Preview device': (w) => {
      w.graph.nodes.preview.params.device.value = 'cpu';
    },
    'wrong consumed Preview device': (w) => {
      w.output.resolvedExecutionInputs.nodes.find((x) => x.nodeId === 'preview').fields.device.value = 'cpu';
    },
    'wrong returned image size': (w) => {
      w.journal.find((x) => x.event === 'officialCallReturned' && x.callId === w.calls[2].callId).images[0].size = [
        128, 64,
      ];
    },
    'wrong returned image node': (w) => {
      w.journal.find((x) => x.event === 'officialCallReturned').task = { ...w.calls[2].task };
    },
    'scheduler borrowed from other node': (w) => {
      w.journal.find((x) => x.event === 'schedulerStepStarted').task = { ...w.calls[0].task };
    },
    'scheduler returned outside denoise': (w) => {
      w.journal.find((x) => x.event === 'schedulerStepReturned').at = w.journal.find(
        (x) => x.event === 'officialCallReturned' && x.callId === w.calls[2].callId,
      ).at;
    },
    'missing durable owner binding': (w) => {
      delete w.task.workflow_snapshot.nodes[0].data.operationAuthoring;
    },
    'missing decoder geometry origin': (w) => {
      delete w.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'decode').fields.width.sourceNodeId;
    },
    'contradictory consumed geometry': (w) => {
      w.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields.width.value = 128;
    },
    'missing official return': (w) => {
      w.journal = w.journal.filter((e) => e.event !== 'officialCallReturned' || e.callId !== w.calls[2].callId);
    },
    'duplicated official return': (w) => {
      w.journal.push(structuredClone(w.journal.find((e) => e.event === 'officialCallReturned')));
    },
    'failed selected official call': (w) => {
      w.journal.push({ event: 'officialCallFailed', task: w.calls[1].task });
    },
    'wrong actual pipeline owner': (w) => {
      w.calls[1].actualPipelineClass = 'custom.ExampleModularPipeline';
    },
    'hidden applied adapter': (w) => {
      w.calls[1].peftComponentAdapterNames = { transformer: ['hidden'] };
    },
    'wrong actual placement': (w) => {
      w.calls[1].componentRuntimePolicies.transformer.offloadMode = 'group_disk';
    },
    'missing applied attention': (w) => {
      w.calls[1].componentRuntimePolicies.transformer.applied = {};
    },
    'contradictory requested VAE flags': (w) => {
      w.calls[2].componentRuntimePolicies.vae.requested = { vae_slicing: false, vae_tiling: true };
    },
    'wrong actual guider': (w) => {
      w.calls[0].guider.config.guidance_scale = 2.5;
    },
    'missing scheduler step': (w) => {
      w.journal = w.journal.filter((e) => e.event !== 'schedulerStepReturned' || e.stepIndex !== 2);
    },
    'invented zero initial scheduler index': (w) => {
      w.journal.find((e) => e.event === 'schedulerStepStarted').stepIndex = 0;
    },
    'different immutable model': (w) => {
      w.models[0].selectedRevision = 'b'.repeat(40);
    },
    'different source file count': (w) => {
      w.task.runtimeFingerprint.backendSource.fileCount = 2;
    },
    'library ownership changed': (w) => {
      w.derived.actualDiffusersDirectUrl.value.url = 'https://example.invalid/diffusers.git';
    },
    'original output snapshot contradicts request': (w) => {
      w.output.apiGraphSnapshot = { sid: 'other-session' };
    },
    'observer installed after run': (w) => {
      w.observer.installedAt = new Date((w.task.completed_at + 1) * 1000).toISOString();
    },
    'native call outside task interval': (w) => {
      w.calls[1].at = new Date((w.task.started_at - 1) * 1000).toISOString();
    },
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, () => {
      const w = witness();
      mutate(w);
      const c = context(w);
      assert.notEqual(executionPlanIdentity(w.graph, c).plan.source, SOURCE);
    });
});

test('retained native records cannot be mixed with a different accounting proof route', () => {
  assert.throws(
    () => createRunProvenance({ canonicalAccountingProof: {}, retainedNativeEvidence: {} }),
    /must be reviewed separately/u,
  );
});

test('missing or damaged records do not fall through to a fabricated manual candidate', () => {
  for (const mutate of [
    (c) => {
      delete c.retainedNativeEvidence;
    },
    (c) => {
      delete c.retainedNativeEvidence.responses;
    },
    (c) => {
      c.retainedNativeEvidence.requests.text += ' ';
    },
  ]) {
    const w = witness(),
      c = context(w);
    mutate(c);
    const plan = executionPlanIdentity(w.graph, c).plan;
    assert.notEqual(plan.source, SOURCE);
    assert.equal(executionReceiptIdentity(w.task, plan).resourceCandidateId, null);
  }
  const w = witness(),
    plan = executionPlanIdentity(w.graph, context(w)).plan;
  plan.resourceObservation.historicalLimits.independentMemoryMonitoring = true;
  assert.equal(observedRetainedExpertTextResourceId(plan), null);
  assert.equal(executionReceiptIdentity(w.task, plan).resourceCandidateId, null);
});

test('retained text resource identity excludes creative content while keeping its record proof distinct', () => {
  const a = witness(),
    b = witness();
  b.output.formSnapshot.prompt = 'A different fictional workshop.';
  b.graph.nodes.encode.params.prompt.value = b.output.formSnapshot.prompt;
  b.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'encode').fields.prompt.value =
    b.output.formSnapshot.prompt;
  b.calls[0].callInputs.prompt = b.output.formSnapshot.prompt;
  b.output.formSnapshot.seed = 99;
  b.graph.nodes.denoise.params.seed.value = 99;
  b.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields.seed.value = 99;
  b.calls[1].generator.initialSeed = 99;
  const left = executionPlanIdentity(a.graph, context(a)),
    right = executionPlanIdentity(b.graph, context(b));
  assert.equal(left.plan.source, SOURCE);
  assert.equal(right.plan.source, SOURCE);
  assert.equal(observedRetainedExpertTextResourceId(left.plan), observedRetainedExpertTextResourceId(right.plan));
  assert.notEqual(left.hash, right.hash);
});

function publicProof(w, c, plan) {
  return {
    taskId: w.task.task_id,
    graph: { canonicalGraph: canonicalizeApiGraph(w.graph) },
    runtime: { backendSource: w.source, backendContract: c.backendContract },
    template: { lockedSettings: structuredClone(w.output.formSnapshot) },
    models: { items: w.models },
    inputs: { items: [] },
    output: { items: [{ mediaType: 'image', width: 64, height: 64 }] },
    execution: { resourceCandidateId: observedRetainedExpertTextResourceId(plan) },
  };
}

test('rehashed projections remain bound to the canonical source, owner, model and output', async (t) => {
  const w = witness(),
    c = context(w),
    plan = executionPlanIdentity(w.graph, c).plan;
  const p = publicProof(w, c, plan);
  assert.equal(observedRetainedExpertTextProofMatches(plan, p), true);
  for (const [name, mutate] of Object.entries({
    'decoder port': (x) => {
      x.graph.canonicalGraph.nodes.find((n) => n.action === 'DecodeLatents').params.width.sourceKey = 'wrong';
    },
    'model pin': (x) => {
      x.models.items[0].selectedRevision = 'b'.repeat(40);
    },
    'output geometry': (x) => {
      x.output.items[0].width = 128;
    },
    'extra output': (x) => {
      x.output.items.push({ ...x.output.items[0] });
    },
    'external input': (x) => {
      x.inputs.items.push({ role: 'referenceImages[0]' });
    },
    'source fingerprint': (x) => {
      x.runtime.backendSource.fingerprint = 'sha256:backend-source-v1:' + 'd'.repeat(64);
    },
    'old contract gains absent port': (x) => {
      x.runtime.backendContract.contracts.find((n) => n.key === scope + 'ModelsLoader').params.weight_format = {};
    },
    'locked step count': (x) => {
      x.template.lockedSettings.steps = 3;
    },
  }))
    await t.test(name, () => {
      const changed = structuredClone(p);
      mutate(changed);
      assert.equal(observedRetainedExpertTextProofMatches(plan, changed), false);
    });
  for (const mutate of [
    (x) => {
      x.resourceObservation.recipe.absentLoaderControls = [];
    },
    (x) => {
      x.resourceObservation.upstreamLibrary.url = 'https://example.invalid/';
    },
    (x) => {
      x.resourceObservation.rawRecordHashes.extra = 'a'.repeat(64);
    },
    (x) => {
      x.resourceObservation.extra = 'x'.repeat(65537);
    },
    (x) => {
      x.self = x;
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    assert.equal(observedRetainedExpertTextResourceId(changed), null);
  }
});

test('unrelated journal failures stay outside the selected task and Expert records never become Auto', () => {
  const w = witness();
  w.journal.push({ event: 'officialCallFailed', task: { task_id: 'unrelated-task' } });
  assert.equal(executionPlanIdentity(w.graph, context(w)).plan.source, SOURCE);
  w.output.formSnapshot.resourceMode = 'auto';
  w.task.runtimePreparation.resourceMode = 'auto';
  assert.notEqual(executionPlanIdentity(w.graph, context(w)).plan.source, SOURCE);
});

test('retained execution controls cannot be changed together in the graph and public settings', async (t) => {
  const w = witness(),
    c = context(w),
    plan = executionPlanIdentity(w.graph, c).plan;
  for (const [name, change] of Object.entries({
    prompt: (p) => {
      p.template.lockedSettings.prompt = 'Changed scene';
      p.graph.canonicalGraph.nodes.find((n) => n.action === 'EncodePrompt').params.prompt.value = 'Changed scene';
    },
    seed: (p) => {
      p.template.lockedSettings.seed = 27;
      p.graph.canonicalGraph.nodes.find((n) => n.action === 'Denoise').params.seed.value = 27;
    },
    VAE: (p) => {
      p.graph.canonicalGraph.nodes.find((n) => n.action === 'ModelsLoader').params.vae_tiling.value = false;
    },
  }))
    await t.test(name, () => {
      const p = publicProof(w, c, plan);
      change(p);
      assert.equal(observedRetainedExpertTextProofMatches(plan, p), false);
    });
});
