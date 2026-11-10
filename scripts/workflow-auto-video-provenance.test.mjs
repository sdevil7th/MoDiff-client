import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeApiGraph, executionPlanIdentity, executionReceiptIdentity } from './live-proof-provenance.mjs';
import { workerGraphHash } from './observed-workflow-auto-resource.mjs';
import {
  OBSERVED_WORKFLOW_AUTO_VIDEO_SOURCE,
  observedWorkflowAutoVideoPlan,
  observedWorkflowAutoVideoProofMatches,
  observedWorkflowAutoVideoResourceId,
} from './observed-workflow-auto-video-resource.mjs';

// Synthetic contract fixture. It is not a model run or hardware observation.
function fixture() {
  const v = (value) => ({ value });
  const wire = (sourceId, sourceKey) => ({ sourceId, sourceKey, display: 'input' });
  const form = {
    mode: 'text_to_video',
    modelType: 'LTXVideoPipeline',
    resourceMode: 'auto',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    device: 'cuda:0',
    autoOffload: true,
    offloadMode: 'model_cpu',
    trustRemoteCode: false,
    prompt: 'Travel toward a tunnel in rain.',
    negativePrompt: '',
    width: 768,
    height: 512,
    numFrames: 121,
    fps: 24,
    steps: 8,
    seed: 8301,
    strength: 0.8,
    guidanceScale: 1,
    maxSequenceLength: 512,
  };
  const contract = {
    schemaVersion: 1,
    library: 'diffusers',
    mediaKind: 'video',
    pipelineClass: 'LTXConditionPipeline',
    actions: Object.fromEntries(['EncodeInputs', 'Denoise', 'DecodeLatents'].map((k) => [k, ['text_to_video']])),
  };
  const upscaler = {
    source: 'hub',
    value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
    revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
    sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
    byteSize: 67061725,
    license: 'bsd-3-clause',
  };
  const node = (module, action, params) => ({ module: 'modules.' + module, action, params });
  const graph = {
    sid: 'fixture-session',
    nodes: {
      quant: node('DiffusersRuntime', 'PipelineQuantizationConfigV2', {
        backend: v('none'),
        dtype: v('bfloat16'),
        component_overrides: v('{}'),
      }),
      recipe: node('DiffusersRuntime', 'DiffusersExecutionRecipe', {
        quantization_config: wire('quant', 'quantization_config'),
        ...Object.fromEntries(
          Object.entries({
            device: 'cuda:0',
            offload_mode: 'group_cpu',
            attention_backend: 'auto',
            vae_slicing: true,
            vae_tiling: true,
            device_map: 'none',
            max_memory: '{}',
            device_map_overrides: '{}',
            layerwise_casting: false,
            channels_last: false,
            regional_compile: false,
            denoiser_cache: 'none',
          }).map(([k, value]) => [k, v(value)]),
        ),
      }),
      loader: node('DiffusersVideo', 'LoadPipeline', {
        execution_recipe: wire('recipe', 'execution_recipe'),
        model_id: v({ source: 'hub', value: 'Lightricks/LTX-Video-0.9.8-13B-distilled' }),
        revision: v('7c64400e1861cc0d7b98d570a1926d5408ec60cd'),
        pipeline_class: v('LTXConditionPipeline'),
        execution_profile_id: v('ltx-video:direct'),
        dtype: v('bfloat16'),
        device: v('cuda:0'),
        offload_mode: v('group_cpu'),
        auto_offload: v(true),
        low_cpu_mem_usage: v(true),
        ...Object.fromEntries(
          ['motion_adapter_id', 'motion_adapter_revision', 'ic_lora_id', 'ic_lora_revision', 'ic_lora_weight_name'].map(
            (k) => [k, v('')],
          ),
        ),
      }),
      encode: node('DiffusersVideo', 'EncodeInputs', {
        pipeline: wire('loader', 'pipeline'),
        video: { display: 'input' },
        reference_images: { display: 'input' },
        video_contract: v(contract),
        mode: v('text_to_video'),
        prompt: v(form.prompt),
        negative_prompt: v(''),
        guidance_scale: v(1),
        max_sequence_length: v(512),
      }),
      denoise: node('DiffusersVideo', 'Denoise', {
        pipeline: wire('loader', 'pipeline'),
        encoded_inputs: wire('encode', 'encoded_inputs'),
        video_contract: v(contract),
        mode: v('text_to_video'),
        width: v(768),
        height: v(512),
        num_frames: v(121),
        frame_rate: v(24),
        num_inference_steps: v(8),
        seed: v(8301),
        guidance_scale: v(1),
        guidance_scale_2: v(0),
        use_guidance_scale_2: v(false),
        conditioning_scale: v(1),
        attention_kwargs_json: v(''),
        strength: v(0.8),
        denoise_strength: v(0.8),
        reference_strength: v(1),
        scheduler_flow_shift: v(0),
      }),
      decode: node('DiffusersVideo', 'DecodeLatents', {
        pipeline: wire('loader', 'pipeline'),
        latents: wire('denoise', 'latents_out'),
        latent_binding: wire('denoise', 'latent_binding'),
        output_type: v('pil'),
      }),
      upscale: node('Spandrel', 'Upscaler', {
        image: wire('decode', 'video_out'),
        model_id: v(upscaler),
        device: v('cuda:0'),
        downscale: v(1),
        tile_size: v(256),
        tile_overlap: v(32),
      }),
      export: node('Video', 'Export', { video: wire('upscale', 'output'), fps: v(24) }),
    },
    paths: [['quant', 'recipe', 'loader', 'encode', 'denoise', 'decode', 'upscale', 'export']],
  };
  const snapshot = { studioForm: form, nodes: [], edges: [] };
  graph.runtimeHints = {
    resourceMode: 'auto',
    workflowSnapshot: snapshot,
    workflowTabId: 'fixture-workflow',
    clientRunId: 'fixture-client',
    runInputHash: 'fixture-input',
    workflowAutoPlan: { schemaVersion: 1, graphHash: workerGraphHash(graph) },
  };
  const row = (id, fields) => ({
    nodeId: id,
    module: graph.nodes[id].module,
    action: graph.nodes[id].action,
    fields: Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, { source: 'literal', value }])),
    omittedFields: {},
  });
  const output = {
    taskId: 'fixture-task',
    attemptIndex: 0,
    nodeId: 'export',
    sid: graph.sid,
    workflowTabId: 'fixture-workflow',
    clientRunId: 'fixture-client',
    runInputHash: 'fixture-input',
    apiGraphSnapshot: graph,
    formSnapshot: form,
    mediaItems: [{ displayType: 'video', mediaMetadata: { width: 1536, height: 1024, frame_count: 121, fps: 24 } }],
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: 'fixture-task',
      attemptIndex: 0,
      nodeId: 'export',
      truncated: false,
      uncapturedNodeIds: [],
      graphTasks: [{ loaderId: 'loader', pipelineClass: 'LTXConditionPipeline', task: 'text_to_video' }],
      nodes: [
        row('quant', { dtype: 'bfloat16' }),
        row('recipe', {
          device: 'cuda:0',
          offload_mode: 'group_cpu',
          attention_backend: 'auto',
          vae_slicing: true,
          vae_tiling: true,
        }),
        row('loader', {
          model_id: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
          revision: '7c64400e1861cc0d7b98d570a1926d5408ec60cd',
          pipeline_class: 'LTXConditionPipeline',
          dtype: 'bfloat16',
          device: 'cuda:0',
          offload_mode: 'group_cpu',
          auto_offload: true,
        }),
        row('encode', {
          executed_task: 'text_to_video',
          prompt: form.prompt,
          negative_prompt: null,
          guidance_scale: 1,
          max_sequence_length: 128,
        }),
        row('denoise', {
          executed_task: 'text_to_video',
          width: 768,
          height: 512,
          num_frames: 121,
          frame_rate: 24,
          num_inference_steps: 8,
          guidance_scale: 1,
          seed: 8301,
          max_sequence_length: 128,
        }),
        row('decode', { executed_task: 'text_to_video', output_type: 'pil' }),
        row('upscale', { model_id: upscaler.value, device: 'cuda:0' }),
        row('export', { fps: 24 }),
      ],
    },
  };
  const task = {
    task_id: 'fixture-task',
    status: 'completed',
    attempt_index: 0,
    resourceCandidateId: null,
    sid: graph.sid,
    workflow_tab_id: 'fixture-workflow',
    client_run_id: 'fixture-client',
    run_input_hash: 'fixture-input',
    workflow_snapshot: snapshot,
    runtimePreparation: {
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
        resolvedFields: {
          loader: Object.fromEntries(
            ['revision', 'dtype', 'device', 'auto_offload', 'offload_mode', 'pipeline_class'].map((k) => [
              k,
              graph.nodes.loader.params[k].value,
            ]),
          ),
          recipe: Object.fromEntries(
            ['offload_mode', 'device', 'attention_backend', 'vae_slicing', 'vae_tiling'].map((k) => [
              k,
              graph.nodes.recipe.params[k].value,
            ]),
          ),
        },
      },
    },
  };
  const models = [
    ['Lightricks/LTX-Video-0.9.8-13B-distilled', '7c64400e1861cc0d7b98d570a1926d5408ec60cd'],
    ['nateraw/real-esrgan', upscaler.revision],
  ].map(([repoId, selectedRevision]) => ({
    repoId,
    selectedRevision,
    modelRevision: repoId + '@' + selectedRevision,
    fingerprint: 'sha256:fixture',
  }));
  return {
    graph,
    context: { executionReceipt: task, executedOutput: output, taskId: task.task_id, modelIdentities: models },
    form,
    task,
    output,
    models,
  };
}

test('ordinary full native video retains an observed resource identity without rewriting its null task candidate', () => {
  const f = fixture(),
    before = structuredClone(f);
  const identity = executionPlanIdentity(f.graph, f.context);
  assert.equal(identity.plan.source, OBSERVED_WORKFLOW_AUTO_VIDEO_SOURCE);
  assert.equal(identity.plan.resourceObservation.requestedMaxSequenceLength, 512);
  assert.equal(identity.plan.resourceObservation.maxSequenceLength, 128);
  assert.equal(
    executionReceiptIdentity(f.task, identity.plan).resourceCandidateId,
    observedWorkflowAutoVideoResourceId(identity.plan),
  );
  assert.equal(f.task.resourceCandidateId, null);
  assert.deepEqual(f, before);
});

test('native video refuses a missing or contradictory original witness', async (t) => {
  for (const [name, mutate] of Object.entries({
    'wrong session': (f) => {
      f.task.sid = 'other';
    },
    'undeclared loading argument': (f) => {
      f.graph.nodes.loader.params.trust_remote_code = { value: true };
    },
    'changed attention kwargs': (f) => {
      f.graph.nodes.denoise.params.attention_kwargs_json.value = '{}';
    },
    'invented 512-token dispatch': (f) => {
      f.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'encode').fields.max_sequence_length.value = 512;
    },
    'invented blank consumed negative': (f) => {
      f.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'encode').fields.negative_prompt.value = '';
    },
    'reused owner': (f) => {
      f.task.runtimePreparation.workflowAuto.reusedOwnerIds = ['loader'];
    },
    'uncaptured owner': (f) => {
      f.output.resolvedExecutionInputs.nodes = f.output.resolvedExecutionInputs.nodes.filter(
        (n) => n.nodeId !== 'loader',
      );
    },
    'missing consumed frame count': (f) => {
      delete f.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields.num_frames;
    },
    'contradictory consumed fps': (f) => {
      f.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields.frame_rate.value = 16;
    },
    'wrong backend-resolved offload': (f) => {
      f.task.runtimePreparation.workflowAuto.resolvedFields.loader.offload_mode = 'none';
    },
    'wrong delivered frame count': (f) => {
      f.output.mediaItems[0].mediaMetadata.frame_count = 81;
    },
    'missing installed upscaler': (f) => {
      f.models.pop();
    },
  }))
    await t.test(name, () => {
      const f = fixture();
      mutate(f);
      // A recomputed browser-side hash cannot repair an unsupported graph or
      // substitute for its original native consumed controls.
      f.graph.runtimeHints.workflowAutoPlan.graphHash = workerGraphHash(f.graph);
      assert.equal(observedWorkflowAutoVideoPlan(f.graph, f.context), null);
    });
});

test('video resource identity excludes prompt, seed and labels but retains delivered geometry', () => {
  const original = fixture();
  const changed = fixture();
  changed.form.prompt = 'A different fictional rail journey.';
  changed.form.seed = 42;
  changed.graph.nodes.encode.params.prompt.value = changed.form.prompt;
  changed.graph.nodes.denoise.params.seed.value = 42;
  changed.graph.nodes.denoise.label = 'Renamed sampling stage';
  changed.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'encode').fields.prompt.value =
    changed.form.prompt;
  changed.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields.seed.value = 42;
  changed.graph.runtimeHints.workflowAutoPlan.graphHash = workerGraphHash(changed.graph);
  const a = observedWorkflowAutoVideoPlan(original.graph, original.context);
  const b = observedWorkflowAutoVideoPlan(changed.graph, changed.context);
  assert(a && b);
  assert.equal(observedWorkflowAutoVideoResourceId(a), observedWorkflowAutoVideoResourceId(b));
  changed.form.width = 1024;
  changed.graph.nodes.denoise.params.width.value = 1024;
  changed.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields.width.value = 1024;
  changed.output.mediaItems[0].mediaMetadata.width = 2048;
  changed.graph.runtimeHints.workflowAutoPlan.graphHash = workerGraphHash(changed.graph);
  const geometry = observedWorkflowAutoVideoPlan(changed.graph, changed.context);
  assert(geometry);
  assert.notEqual(observedWorkflowAutoVideoResourceId(a), observedWorkflowAutoVideoResourceId(geometry));
});

test('video resource IDs reject incomplete, oversized, cyclic and inconsistent projections', () => {
  assert.equal(observedWorkflowAutoVideoResourceId({ source: OBSERVED_WORKFLOW_AUTO_VIDEO_SOURCE }), null);
  const f = fixture(),
    plan = observedWorkflowAutoVideoPlan(f.graph, f.context);
  assert(plan);
  for (const mutate of [
    (p) => {
      p.self = p;
    },
    (p) => {
      p.resourceObservation.extra = 'x'.repeat(65537);
    },
    (p) => {
      p.resourceObservation.maxSequenceLength = 512;
    },
    (p) => {
      p.resourceObservation.delivery.width = 768;
    },
    (p) => {
      p.resourceObservation.upscaler.sha256 = '0'.repeat(64);
    },
    (p) => {
      p.resourceObservation.base.fps = '24';
    },
    (p) => {
      delete p.requestedOffloadMode;
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    assert.equal(observedWorkflowAutoVideoResourceId(changed), null);
  }
});

test('video proof rejects rehashed graph, model and geometry substitutions', async (t) => {
  const f = fixture(),
    plan = observedWorkflowAutoVideoPlan(f.graph, f.context);
  assert(plan);
  const p = {
    graph: { canonicalGraph: canonicalizeApiGraph(f.graph) },
    template: { lockedSettings: f.form },
    models: { items: f.models },
    inputs: { count: 0 },
    output: { items: [{ width: 1536, height: 1024, frames: 121 }] },
  };
  assert(observedWorkflowAutoVideoProofMatches(plan, p));
  for (const [name, mutate] of Object.entries({
    'changed tile policy': (v) => {
      v.graph.canonicalGraph.nodes.find((n) => n.action === 'Upscaler').params.tile_size.value = 512;
    },
    'changed latent binding': (v) => {
      v.graph.canonicalGraph.nodes.find((n) => n.action === 'DecodeLatents').params.latent_binding.sourceKey =
        'latents_out';
    },
    'changed immutable model': (v) => {
      v.models.items[0].selectedRevision = 'a'.repeat(40);
    },
    'false full delivery': (v) => {
      v.output.items[0].frames = 81;
    },
  }))
    await t.test(name, () => {
      const changed = structuredClone(p);
      mutate(changed);
      assert.equal(observedWorkflowAutoVideoProofMatches(plan, changed), false);
    });
});
