import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeApiGraph, executionPlanIdentity, executionReceiptIdentity } from './live-proof-provenance.mjs';
import { workerGraphHash } from './observed-workflow-auto-resource.mjs';
import {
  observedWorkflowAutoControlPlan,
  observedWorkflowAutoControlProofMatches,
  observedWorkflowAutoControlResourceId,
} from './observed-workflow-auto-control-resource.mjs';
function fixture() {
  const lit = (value) => ({ value }),
    wire = (sourceId, sourceKey) => ({ sourceId, sourceKey });
  const form = {
    mode: 'control_image',
    resourceMode: 'auto',
    quantizationMode: 'none',
    trustRemoteCode: false,
    randomSeed: false,
    modelType: 'ExampleModularPipeline',
    dtype: 'bfloat16',
    width: 64,
    height: 64,
    seed: 12,
    steps: 2,
    guidanceScale: 4,
    strength: 0.8,
    prompt: 'A fictional carton.',
    negativePrompt: '',
    maxSequenceLength: 512,
    conditioningScale: 1.2,
    offloadMode: 'none',
    autoOffload: false,
    controlImage: '@data/control.png',
  };
  const node = (action, values, module = 'modules.ModularDiffusers') => ({
    module,
    action,
    params: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, lit(v)])),
  });
  const nodes = {
    input: node('Load', { file: form.controlImage, alpha_channel: 'ignore' }, 'modules.Image'),
    aux: node('AutoModelLoader', {
      model_type: 'controlnet',
      model_id: { source: 'hub', value: 'example/control' },
      revision: 'b'.repeat(40),
      dtype: 'bfloat16',
      device: 'cuda:0',
      auto_offload: false,
      offload_mode: 'none',
      trust_remote_code: false,
      subfolder: '',
      variant: '',
      component_class: '',
    }),
    owner: node('ModelsLoader', {
      model_type: form.modelType,
      repo_id: { source: 'hub', value: 'example/base' },
      revision: 'a'.repeat(40),
      dtype: 'bfloat16',
      device: 'cuda:0',
      workflow_id: 'controlnet_text2image',
      trust_remote_code: false,
      weight_format: 'native',
      weight_loading_mode: 'cpu',
      auto_offload: true,
      offload_mode: 'group_cpu',
      attention_backend: 'inherit',
      vae_slicing: null,
      vae_tiling: null,
      quant_config: null,
      unet: null,
      vae: null,
      lora_list: null,
    }),
    control: node('Controlnet', {
      model_type: form.modelType,
      width: 64,
      height: 64,
      seed: 12,
      controlnet_conditioning_scale: 1.2,
      control_guidance_start: 0,
      control_guidance_end: 1,
    }),
    guide: node('Guider', {
      model_type: form.modelType,
      guider: 'ClassifierFreeGuidance',
      guidance_scale: 4,
      guidance_rescale: 0,
      use_original_formulation: false,
      enabled: true,
      start: 0,
      stop: 1,
    }),
    encode: node('EncodePrompt', { prompt: form.prompt, max_sequence_length: 512 }),
    denoise: node('Denoise', {
      width: 64,
      height: 64,
      seed: 12,
      num_inference_steps: 2,
      guidance_scale: 4.5,
      strength: 0.8,
    }),
    decode: node('DecodeLatents', {}),
    output: node('Preview', {}, 'modules.Image'),
  };
  for (const [t, k, s, p] of [
    ['owner', 'controlnet', 'aux', 'model'],
    ['control', 'control_image', 'input', 'image'],
    ['control', 'controlnet', 'aux', 'model'],
    ['control', 'vae', 'owner', 'vae_out'],
    ['encode', 'text_encoders', 'owner', 'text_encoders'],
    ['encode', 'guider', 'guide', 'guider_out'],
    ['denoise', 'unet', 'owner', 'unet_out'],
    ['denoise', 'embeddings', 'encode', 'embeddings'],
    ['denoise', 'controlnet_bundle', 'control', 'controlnet_bundle'],
    ['denoise', 'route_state_in', 'control', 'route_state_out'],
    ['denoise', 'guider', 'guide', 'guider_out'],
    ['denoise', 'scheduler', 'owner', 'scheduler'],
    ['decode', 'vae', 'owner', 'vae_out'],
    ['decode', 'latents', 'denoise', 'latents'],
    ['decode', 'route_state_in', 'denoise', 'route_state_out'],
    ['output', 'image', 'decode', 'images'],
  ])
    nodes[t].params[k] = wire(s, p);
  const graph = {
    sid: 'example-session',
    nodes,
    paths: [['input', 'aux', 'owner', 'control', 'guide', 'encode', 'denoise', 'decode', 'output']],
  };
  graph.runtimeHints = {
    resourceMode: 'auto',
    workflowSnapshot: { studioForm: form, nodes: [], edges: [] },
    workflowTabId: 'example-workflow',
    clientRunId: 'example-run',
    runInputHash: 'example-input',
  };
  graph.runtimeHints.workflowAutoPlan = { schemaVersion: 1, graphHash: workerGraphHash(graph) };
  const rows = Object.entries(nodes).map(([nodeId, n]) => ({
    nodeId,
    module: n.module,
    action: n.action,
    omittedFields: {},
    fields: Object.fromEntries(
      Object.entries(n.params)
        .filter(([, p]) => !p.sourceId)
        .map(([k, p]) => [
          k,
          { source: 'literal', value: ['repo_id', 'model_id'].includes(k) ? p.value.value : p.value },
        ]),
    ),
  }));
  delete rows.find((r) => r.nodeId === 'control').fields.controlnet_conditioning_scale;
  rows.find((r) => r.nodeId === 'input').fields.source_hashes = { source: 'literal', value: ['c'.repeat(64)] };
  const output = {
    taskId: 'example-task',
    attemptIndex: 0,
    nodeId: 'output',
    sid: graph.sid,
    workflowTabId: 'example-workflow',
    clientRunId: 'example-run',
    runInputHash: 'example-input',
    apiGraphSnapshot: graph,
    formSnapshot: form,
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: 'example-task',
      attemptIndex: 0,
      nodeId: 'output',
      truncated: false,
      uncapturedNodeIds: [],
      nodes: rows,
      graphTasks: [{ loaderId: 'owner', pipelineClass: form.modelType, task: null }],
    },
  };
  const auto = {
    strategy: 'dependency_order_retained_owners',
    schedule: null,
    cachePreparation: null,
    reusedOwnerIds: [],
    preparedDataNodes: [],
    appliedUpdates: [],
    releases: [],
    resolvedFields: Object.fromEntries(
      ['owner', 'encode', 'guide', 'denoise', 'control', 'aux'].map((id) => [
        id,
        Object.fromEntries(
          Object.entries(nodes[id].params)
            .filter(([, p]) => !p.sourceId)
            .map(([k, p]) => [k, p.value]),
        ),
      ]),
    ),
  };
  const task = {
    task_id: 'example-task',
    status: 'completed',
    attempt_index: 0,
    resourceCandidateId: null,
    sid: graph.sid,
    workflow_tab_id: 'example-workflow',
    client_run_id: 'example-run',
    run_input_hash: 'example-input',
    workflow_snapshot: graph.runtimeHints.workflowSnapshot,
    runtimePreparation: {
      resourceMode: 'auto',
      performed: false,
      residentRecipeReusable: false,
      cleanup: null,
      workflowAuto: auto,
    },
  };
  const models = [
    ['example/base', 'a'],
    ['example/control', 'b'],
  ].map(([repoId, h]) => ({
    repoId,
    selectedRevision: h.repeat(40),
    modelRevision: repoId + '@' + h.repeat(40),
    fingerprint: 'sha256:example',
  }));
  const inputs = [
    { role: 'controlImage', path: form.controlImage, contentHash: 'sha256:bytes:' + 'c'.repeat(64), byteSize: 100 },
  ];
  return {
    graph,
    form,
    task,
    output,
    models,
    inputs,
    context: {
      executionReceipt: task,
      executedOutput: output,
      taskId: task.task_id,
      modelIdentities: models,
      inputArtifacts: inputs,
    },
  };
}
function proof(f) {
  return {
    graph: { canonicalGraph: canonicalizeApiGraph(f.graph) },
    template: { lockedSettings: f.form },
    inputs: { count: 1, items: f.inputs },
    models: { items: f.models },
    output: { items: [{ mediaType: 'image', width: 64, height: 64 }] },
  };
}
test('control proof retains actual loading, original null task and uncaptured control-scale telemetry', () => {
  const f = fixture(),
    before = structuredClone(f),
    plan = observedWorkflowAutoControlPlan(f.graph, f.context);
  assert(plan);
  assert.equal(plan.resourceObservation.nativeControlScaleObserved, false);
  assert.equal(plan.resourceObservation.originalGraphTask, null);
  assert.equal(plan.resourceObservation.guiderScale, 4);
  assert.equal(plan.resourceObservation.denoiserGuidanceScale, 4.5);
  assert(observedWorkflowAutoControlProofMatches(plan, proof(f)));
  assert.equal(executionPlanIdentity(f.graph, f.context).plan.source, plan.source);
  assert.equal(executionReceiptIdentity(f.task, plan).resourceCandidateId, observedWorkflowAutoControlResourceId(plan));
  assert.deepEqual(f, before);
  const p = proof(f);
  p.template.lockedSettings = { ...f.form, autoOffload: true, offloadMode: 'model_cpu' };
  assert(observedWorkflowAutoControlProofMatches(plan, p));
  assert.equal(plan.offloadMode, 'group_cpu');
});
for (const [name, mutate] of Object.entries({
  session: (f) => {
    f.task.sid = 'wrong';
  },
  input: (f) => {
    f.inputs[0].contentHash = 'sha256:bytes:' + 'd'.repeat(64);
  },
  auxiliary: (f) => {
    f.models[1].selectedRevision = 'd'.repeat(40);
  },
  scale: (f) => {
    f.graph.nodes.control.params.controlnet_conditioning_scale.value = 0.8;
  },
  inventedTelemetry: (f) => {
    f.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'control').fields.controlnet_conditioning_scale = {
      source: 'literal',
      value: 1.2,
    };
  },
  guider: (f) => {
    f.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'guide').fields.guidance_scale.value = 4.5;
  },
  sourceRole: (f) => {
    f.inputs[0].role = 'referenceImages[0]';
  },
  supplier: (f) => {
    f.graph.nodes.denoise.params.controlnet_bundle.sourceKey = 'unet_out';
  },
  candidate: (f) => {
    f.task.resourceCandidateId = 'invented';
  },
}))
  test('control proof rejects changed ' + name, () => {
    const f = fixture();
    mutate(f);
    assert.equal(observedWorkflowAutoControlPlan(f.graph, f.context), null);
  });
test('published control projection rejects graph, model, input and output substitutions', () => {
  const f = fixture(),
    plan = observedWorkflowAutoControlPlan(f.graph, f.context);
  assert(plan);
  for (const mutate of [
    (p) => {
      p.inputs.items[0].contentHash += 'changed';
    },
    (p) => {
      p.models.items[1].selectedRevision = 'd'.repeat(40);
    },
    (p) => {
      p.output.items[0].width = 128;
    },
    (p) => {
      p.template.lockedSettings.prompt = 'Changed scene.';
    },
  ]) {
    const p = structuredClone(proof(f));
    mutate(p);
    assert.equal(observedWorkflowAutoControlProofMatches(plan, p), false);
  }
  for (const mutate of [
    (p) => {
      p.resourceObservation.nativeControlScaleObserved = true;
    },
    (p) => {
      p.resourceObservation.originalGraphTask = 'control_image';
    },
    (p) => {
      p.resourceObservation.extra = true;
    },
    (p) => {
      p.modelRevision = 'main';
    },
  ]) {
    const p = structuredClone(plan);
    mutate(p);
    assert.equal(observedWorkflowAutoControlResourceId(p), null);
  }
});
