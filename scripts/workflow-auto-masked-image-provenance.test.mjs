import assert from 'node:assert/strict';
import test from 'node:test';
import { workerGraphHash } from './observed-workflow-auto-resource.mjs';
import { executionPlanIdentity, executionReceiptIdentity } from './live-proof-provenance.mjs';
import {
  observedWorkflowAutoMaskedImagePlan as derive,
  observedWorkflowAutoMaskedImageResourceId as resourceId,
  observedWorkflowAutoMaskedImageProofMatches as matches,
} from './observed-workflow-auto-masked-image-resource.mjs';
function fixture() {
  const lit = (value) => ({ value }),
    wire = (sourceId, sourceKey) => ({ sourceId, sourceKey }),
    mod = (action, params, module = 'modules.ModularDiffusers') => ({
      module,
      action,
      params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, lit(v)])),
    });
  const form = {
    mode: 'inpaint',
    resourceMode: 'auto',
    modelType: 'ExampleModularPipeline',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    randomSeed: false,
    seed: 12,
    width: 64,
    height: 64,
    steps: 2,
    guidanceScale: 4,
    strength: 1,
    prompt: 'A fictional replacement chest.',
    negativePrompt: '',
    maxSequenceLength: 512,
    offloadMode: 'model_cpu',
    autoOffload: true,
    trustRemoteCode: false,
    referenceImages: ['@data/source.webp'],
    maskImage: '@data/mask.png',
  };
  const nodes = {
    source: mod('Load', { file: form.referenceImages, alpha_channel: 'ignore' }, 'modules.Image'),
    mask: mod('Load', { file: form.maskImage, alpha_channel: 'remove alpha' }, 'modules.Image'),
    guide: mod('Guider', {
      model_type: form.modelType,
      guider: 'ClassifierFreeGuidance',
      guidance_scale: 4,
      guidance_rescale: 0,
      use_original_formulation: false,
      enabled: true,
      start: 0,
      stop: 1,
      layers_config: null,
    }),
    owner: mod('ModelsLoader', {
      model_type: form.modelType,
      repo_id: { source: 'hub', value: 'example/base' },
      revision: 'a'.repeat(40),
      dtype: 'bfloat16',
      device: 'cuda:0',
      attention_backend: 'auto',
      vae_slicing: true,
      vae_tiling: true,
      inpaint_compatibility: 'whole_v1',
      trust_remote_code: false,
      workflow_id: 'image_conditioned_inpainting',
      auto_offload: true,
      offload_mode: 'group_cpu',
      weight_loading_mode: 'cpu',
      weight_format: 'native',
      unet: null,
      vae: null,
      controlnet: null,
      lora_list: null,
      quant_config: null,
    }),
    encode: mod('EncodePrompt', { prompt_input: null, prompt: form.prompt, negative_prompt: form.negativePrompt }),
    image: mod('ImageEncode', { seed: 12, padding_mask_crop: null, inpaint_compatibility: 'whole_v1' }),
    denoise: mod('Denoise', {
      width: 64,
      height: 64,
      seed: 12,
      num_inference_steps: 2,
      guidance_scale: 4,
      strength: 1,
    }),
    decode: mod('DecodeLatents', {}),
    preview: mod('Preview', { vae: null, device: 'cuda:0' }, 'modules.Image'),
  };
  const edges = [
    ['image', 'vae', 'owner', 'vae_out'],
    ['image', 'image', 'source', 'image'],
    ['image', 'mask_image', 'mask', 'image'],
    ['encode', 'text_encoders', 'owner', 'text_encoders'],
    ['encode', 'guider', 'guide', 'guider_out'],
    ['encode', 'image', 'source', 'image'],
    ['denoise', 'unet', 'owner', 'unet_out'],
    ['denoise', 'scheduler', 'owner', 'scheduler'],
    ['denoise', 'embeddings', 'encode', 'embeddings'],
    ['denoise', 'image_latents', 'image', 'image_latents'],
    ['denoise', 'route_state_in', 'image', 'route_state_out'],
    ['denoise', 'guider', 'guide', 'guider_out'],
    ['decode', 'vae', 'owner', 'vae_out'],
    ['decode', 'latents', 'denoise', 'latents'],
    ['decode', 'route_state_in', 'denoise', 'route_state_out'],
    ['preview', 'image', 'decode', 'images'],
  ];
  for (const [t, k, s, p] of edges) nodes[t].params[k] = wire(s, p);
  const snapshot = { studioForm: form };
  const api = {
    sid: 'synthetic-session',
    nodes,
    paths: [['source', 'mask', 'guide', 'owner', 'encode', 'image', 'denoise', 'decode', 'preview']],
    runtimeHints: {
      resourceMode: 'auto',
      workflowTabId: 'synthetic-workflow',
      clientRunId: 'synthetic-client',
      runInputHash: 'synthetic-input',
      workflowSnapshot: snapshot,
    },
  };
  api.runtimeHints.workflowAutoPlan = { schemaVersion: 1, graphHash: workerGraphHash(api) };
  const artifacts = [
    {
      role: 'referenceImages[0]',
      path: form.referenceImages[0],
      contentHash: 'sha256:bytes:' + 'b'.repeat(64),
      byteSize: 32,
    },
    { role: 'maskImage', path: form.maskImage, contentHash: 'sha256:bytes:' + 'c'.repeat(64), byteSize: 32 },
  ];
  const rows = Object.entries(nodes).map(([nodeId, n]) => ({
    nodeId,
    module: n.module,
    action: n.action,
    fields: {},
    omittedFields: {},
  }));
  for (const [id, keys] of [
    [
      'owner',
      'model_type repo_id revision dtype device auto_offload offload_mode quant_config weight_loading_mode attention_backend vae_slicing vae_tiling',
    ],
    ['guide', 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'],
    ['encode', 'prompt negative_prompt'],
    ['denoise', 'width height seed num_inference_steps guidance_scale strength'],
    ['image', 'seed'],
    ['preview', 'device'],
  ])
    for (const k of keys.split(' ')) {
      const v = nodes[id].params[k].value;
      rows.find((r) => r.nodeId === id).fields[k] = { source: 'literal', value: k === 'repo_id' ? v.value : v };
    }
  for (const [id, i, mode] of [
    ['source', 0, 'RGB'],
    ['mask', 1, 'L'],
  ])
    for (const [k, value] of Object.entries({
      alpha_channel: nodes[id].params.alpha_channel.value,
      source_hashes: [artifacts[i].contentHash.slice(13)],
      source_widths: [64],
      source_heights: [64],
      source_modes: [mode],
    }))
      rows.find((r) => r.nodeId === id).fields[k] = { source: 'literal', value };
  const auto = {
    strategy: 'dependency_order_retained_owners',
    schedule: null,
    cachePreparation: null,
    reusedOwnerIds: [],
    preparedDataNodes: [],
    appliedUpdates: [],
    releases: [],
    resolvedFields: {
      owner: { inpaint_compatibility: 'whole_v1', offload_mode: 'group_cpu' },
      guide: { guidance_scale: 4 },
      denoise: { width: 64, height: 64, num_inference_steps: 2, guidance_scale: 4, strength: 1 },
    },
  };
  const task = {
    task_id: 'synthetic-task',
    status: 'completed',
    attempt_index: 0,
    resourceCandidateId: null,
    sid: api.sid,
    workflow_tab_id: api.runtimeHints.workflowTabId,
    client_run_id: api.runtimeHints.clientRunId,
    run_input_hash: api.runtimeHints.runInputHash,
    workflow_snapshot: snapshot,
    runtimePreparation: {
      resourceMode: 'auto',
      performed: false,
      residentRecipeReusable: false,
      cleanup: null,
      workflowAuto: auto,
    },
  };
  const output = {
    taskId: task.task_id,
    attemptIndex: 0,
    nodeId: 'preview',
    sid: api.sid,
    workflowTabId: api.runtimeHints.workflowTabId,
    clientRunId: api.runtimeHints.clientRunId,
    runInputHash: api.runtimeHints.runInputHash,
    apiGraphSnapshot: api,
    formSnapshot: form,
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: task.task_id,
      attemptIndex: 0,
      nodeId: 'preview',
      truncated: false,
      uncapturedNodeIds: [],
      nodes: rows,
      graphTasks: [{ loaderId: 'owner', pipelineClass: form.modelType, task: 'inpaint' }],
    },
  };
  const models = [
    {
      repoId: 'example/base',
      selectedRevision: 'a'.repeat(40),
      modelRevision: 'example/base@' + 'a'.repeat(40),
      fingerprint: 'synthetic-model',
    },
  ];
  const context = {
    executionReceipt: task,
    executedOutput: output,
    taskId: task.task_id,
    modelIdentities: models,
    inputArtifacts: artifacts,
  };
  const provenance = {
    graph: { canonicalGraph: { nodes: Object.entries(nodes).map(([key, n]) => ({ key, ...n })), paths: api.paths } },
    template: { lockedSettings: form },
    inputs: { count: 2, items: artifacts },
    models: { items: models },
    output: { items: [{ mediaType: 'image', width: 64, height: 64 }] },
  };
  return { api, context, provenance, rows, auto };
}
test('whole-compatible native masked receipt preserves the actual graph and saved form loading distinction', () => {
  const f = fixture(),
    p = derive(f.api, f.context);
  assert(p);
  assert(resourceId(p));
  assert.equal(p.offloadMode, 'group_cpu');
  assert.equal(p.resourceObservation.requestedOffloadMode, 'model_cpu');
  assert.equal(matches(p, f.provenance), true);
  const ordinary = executionPlanIdentity(f.api, f.context);
  assert.deepEqual(ordinary.plan, p);
  assert.equal(executionReceiptIdentity(f.context.executionReceipt, p).resourceCandidateId, resourceId(p));
});
for (const [name, mutate] of [
  ['wrong mask connection', (f) => (f.api.nodes.image.params.mask_image.sourceId = 'source')],
  [
    'swapped input roles',
    (f) => {
      f.context.inputArtifacts[0].role = 'maskImage';
      f.context.inputArtifacts[1].role = 'referenceImages[0]';
    },
  ],
  [
    'different consumed source body',
    (f) => (f.rows.find((r) => r.nodeId === 'source').fields.source_hashes.value = ['d'.repeat(64)]),
  ],
  [
    'different consumed mask body',
    (f) => (f.rows.find((r) => r.nodeId === 'mask').fields.source_hashes.value = ['d'.repeat(64)]),
  ],
  ['changed native seed', (f) => (f.rows.find((r) => r.nodeId === 'denoise').fields.seed.value = 13)],
  [
    'changed native compatibility task',
    (f) => (f.context.executedOutput.resolvedExecutionInputs.graphTasks[0].task = null),
  ],
  [
    'missing native mask capture',
    (f) => (f.context.executedOutput.resolvedExecutionInputs.uncapturedNodeIds = ['mask']),
  ],
  ['unsupported extra node', (f) => (f.api.nodes.extra = structuredClone(f.api.nodes.source))],
  [
    'unknown connected graph control',
    (f) => (f.api.nodes.denoise.params.unreviewed = { sourceId: 'owner', sourceKey: 'unet_out' }),
  ],
  ['changed resolved compatibility', (f) => (f.auto.resolvedFields.owner.inpaint_compatibility = 'native')],
  ['changed resolved actual loading', (f) => (f.auto.resolvedFields.owner.offload_mode = 'model_cpu')],
  ['different model revision', (f) => (f.context.modelIdentities[0].selectedRevision = 'd'.repeat(40))],
  ['incomplete source geometry', (f) => (f.rows.find((r) => r.nodeId === 'source').fields.source_widths.value = [32])],
  ['different mask mode', (f) => (f.rows.find((r) => r.nodeId === 'mask').fields.source_modes.value = ['RGB'])],
  ['wrong output task', (f) => (f.context.executedOutput.taskId = 'other-task')],
  ['changed plan graph hash', (f) => (f.api.runtimeHints.workflowAutoPlan.graphHash = 'different')],
])
  test('native masked reader rejects ' + name, () => {
    const f = fixture();
    mutate(f);
    assert.equal(derive(f.api, f.context), null);
  });
for (const [name, mutate] of [
  ['unknown hardware authority', (p) => (p.hardwareQualified = true)],
  ['different root loading', (p) => (p.offloadMode = 'model_cpu')],
  ['invented compatibility basis', (p) => (p.resourceObservation.compatibilityBasis = 'native_official_call')],
  ['invalid mask digest', (p) => (p.resourceObservation.inputs[1].contentHash = 'missing')],
])
  test('native masked identifier rejects ' + name, () => {
    const f = fixture(),
      p = derive(f.api, f.context);
    assert(p);
    mutate(p);
    assert.equal(resourceId(p), null);
    assert.equal(matches(p, f.provenance), false);
  });
for (const [name, mutate] of [
  ['changed protected input', (p) => (p.inputs.items[0].contentHash = 'sha256:bytes:' + 'd'.repeat(64))],
  ['changed strength', (p) => (p.template.lockedSettings.strength = 0.5)],
  ['changed output size', (p) => (p.output.items[0].height = 32)],
])
  test('native masked final matcher rejects ' + name, () => {
    const f = fixture(),
      p = derive(f.api, f.context);
    assert(p);
    mutate(f.provenance);
    assert.equal(matches(p, f.provenance), false);
  });
