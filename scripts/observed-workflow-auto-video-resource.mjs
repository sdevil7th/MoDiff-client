// Maintainer evidence only: a fresh ordinary text-to-video path, never admission.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import { assertFiniteObservedJson, workerGraphHash } from './observed-workflow-auto-resource.mjs';

export const OBSERVED_WORKFLOW_AUTO_VIDEO_SOURCE = 'observed-workflow-auto-video-resource-v1';
const same = (a, b) => assert.deepEqual(stableJsonValue(a), stableJsonValue(b));
const scope = (node) => `${node.module}.${node.action}`;
const video = (action) => `modules.DiffusersVideo.${action}`;
const recipeScope = 'modules.DiffusersRuntime.DiffusersExecutionRecipe';
const quantScope = 'modules.DiffusersRuntime.PipelineQuantizationConfigV2';
const upScope = 'modules.Spandrel.Upscaler';
const outScope = 'modules.Video.Export';
const kinds = [
  quantScope,
  recipeScope,
  ...['LoadPipeline', 'EncodeInputs', 'Denoise', 'DecodeLatents'].map(video),
  upScope,
  outScope,
];

const normalizationPaths = [
  'modules/Video/main.py',
  'modules/VideoConditioning/main.py',
  'modules/DiffusersImage/stage_execution.py',
  'modules/DiffusersVideo/stage_execution.py',
];
function normalizationEvidence(evidence, input, base) {
  const keys =
    'schemaVersion sourceContentHash sourceByteSize sourceFrames sourceWidth sourceHeight sourceFps normalizedWidth normalizedHeight normalizedFrames fit descriptors normalizedPixelHash backendSourceFingerprint implementationFiles decoder'.split(
      ' ',
    );
  const n = Object.fromEntries(keys.map((k) => [k, evidence?.[k]]));
  same(n.schemaVersion, 1);
  same(n.sourceContentHash, input.contentHash);
  same(n.sourceByteSize, input.byteSize);
  for (const k of ['sourceFrames', 'sourceWidth', 'sourceHeight'])
    assert(Number.isSafeInteger(n[k]) && n[k] > 0 && n[k] <= 32768);
  assert(Number.isFinite(n.sourceFps) && n.sourceFps > 0 && n.sourceFps <= 120);
  same(n.normalizedWidth, base.width);
  same(n.normalizedHeight, base.height);
  same(n.normalizedFrames, base.frames);
  same(n.fit, 'cover');
  assert(n.normalizedFrames <= 241);
  same(n.descriptors.length, base.frames);
  for (const d of n.descriptors) {
    assert(Array.isArray(d));
    same(d.length, 3);
    same(d[0], 'RGB');
    same(d[1], [base.width, base.height]);
    assert.match(d[2], /^[a-f0-9]{64}$/u);
  }
  same(
    n.normalizedPixelHash,
    createHash('sha256').update('modiff-video-source-pixels-v1\0').update(JSON.stringify(n.descriptors)).digest('hex'),
  );
  assert.match(n.backendSourceFingerprint, /^sha256:backend-source-v1:[a-f0-9]{64}$/u);
  same(n.implementationFiles.length, 4);
  same(n.implementationFiles.map((f) => f.path).sort(), [...normalizationPaths].sort());
  for (const f of n.implementationFiles) {
    same(Object.keys(f).sort(), ['path', 'sha256']);
    assert.match(f.sha256, /^[a-f0-9]{64}$/u);
  }
  same(Object.keys(n.decoder).sort(), ['executableSHA256', 'imageioFfmpegVersion', 'imageioVersion']);
  assert.match(n.decoder.executableSHA256, /^[a-f0-9]{64}$/u);
  for (const k of ['imageioVersion', 'imageioFfmpegVersion'])
    assert(typeof n.decoder[k] === 'string' && n.decoder[k].length > 0 && n.decoder[k].length <= 64);
  return n;
}
function normalizationSourceMatches(n, source) {
  same(n.backendSourceFingerprint, source.fingerprint);
  for (const f of n.implementationFiles) {
    const rows = source.files.filter((r) => r.path === f.path);
    same(rows.length, 1);
    same(rows[0].sha256, f.sha256);
  }
}
function project(entries, paths, form, inputArtifacts = [], normalization) {
  assert.equal(form.resourceMode, 'auto');
  assert(['text_to_video', 'image_to_video', 'reference_to_video', 'video_to_video'].includes(form.mode));
  const remaster = form.mode === 'video_to_video';
  const conditioned = ['image_to_video', 'reference_to_video'].includes(form.mode);
  const inputCount = remaster ? 1 : form.mode === 'image_to_video' ? 1 : form.mode === 'reference_to_video' ? 2 : 0;
  const imageScope = 'modules.Image.Load';
  const sourceVideoScope = 'modules.Video.Load',
    normalizeScope = 'modules.VideoConditioning.Normalize';
  assert.equal(form.modelType, 'LTXVideoPipeline');
  assert.equal(form.dtype, 'bfloat16');
  assert.equal(form.quantizationMode, 'none');
  assert.equal(form.guidanceScale, 1);
  assert.equal(form.negativePrompt, '');
  assert.equal(typeof form.autoOffload, 'boolean');
  assert(['none', 'model_cpu', 'group_cpu'].includes(form.offloadMode));
  assert.equal(entries.length, remaster ? 10 : conditioned ? 9 : 8);
  assert.equal(paths.length, 1);
  const ids = entries.map(([id]) => id);
  same([...paths[0]].sort(), [...ids].sort());
  assert.equal(new Set(paths[0]).size, entries.length);
  const roles = new Map(entries.map(([id, node]) => [scope(node), { id, node }]));
  same(
    [...roles.keys()].sort(),
    [...kinds, ...(conditioned ? [imageScope] : []), ...(remaster ? [sourceVideoScope, normalizeScope] : [])].sort(),
  );
  const literal = (kind, field) => {
    const p = roles.get(kind).node.params[field];
    assert(p && !p.sourceId && !p.sourceKey, `${kind}.${field} must be literal`);
    return p.value;
  };
  const load = video('LoadPipeline'),
    enc = video('EncodeInputs'),
    den = video('Denoise'),
    dec = video('DecodeLatents');
  for (const [kind, fields] of [
    [
      load,
      'model_id revision dtype device auto_offload offload_mode execution_recipe low_cpu_mem_usage pipeline_class execution_profile_id motion_adapter_id motion_adapter_revision ic_lora_id ic_lora_revision ic_lora_weight_name',
    ],
    [
      enc,
      'pipeline prompt negative_prompt video reference_images guidance_scale max_sequence_length video_contract mode',
    ],
    [
      den,
      'pipeline conditioning_scale width height num_frames num_inference_steps guidance_scale guidance_scale_2 use_guidance_scale_2 seed attention_kwargs_json video_contract mode frame_rate strength denoise_strength reference_strength scheduler_flow_shift encoded_inputs',
    ],
    [dec, 'pipeline output_type latents latent_binding'],
    [upScope, 'image model_id downscale tile_size tile_overlap device'],
  ])
    same(Object.keys(roles.get(kind).node.params).sort(), fields.split(' ').sort());
  const wires = new Set();
  for (const [target, field, producer, port] of [
    [recipeScope, 'quantization_config', quantScope, 'quantization_config'],
    [load, 'execution_recipe', recipeScope, 'execution_recipe'],
    [enc, 'pipeline', load, 'pipeline'],
    [den, 'pipeline', load, 'pipeline'],
    [dec, 'pipeline', load, 'pipeline'],
    [den, 'encoded_inputs', enc, 'encoded_inputs'],
    [dec, 'latents', den, 'latents_out'],
    [dec, 'latent_binding', den, 'latent_binding'],
    [upScope, 'image', dec, 'video_out'],
    [outScope, 'video', upScope, 'output'],
    ...(conditioned ? [[enc, 'reference_images', imageScope, 'image']] : []),
    ...(remaster
      ? [
          [normalizeScope, 'video', sourceVideoScope, 'video'],
          [enc, 'video', normalizeScope, 'output'],
        ]
      : []),
  ]) {
    const p = roles.get(target).node.params[field];
    assert.equal(p?.sourceId, roles.get(producer).id);
    assert.equal(p.sourceKey, port);
    assert(!Object.hasOwn(p, 'value'));
    assert(paths[0].indexOf(p.sourceId) < paths[0].indexOf(roles.get(target).id));
    wires.add(`${target}:${field}`);
  }
  for (const [, node] of entries)
    for (const [field, p] of Object.entries(node.params))
      if (p.sourceId || p.sourceKey) {
        const presentation =
          scope(node) === outScope &&
          field === 'preview' &&
          p.display === 'ui_video' &&
          p.sourceKey === 'file' &&
          !p.sourceId;
        assert(wires.has(`${scope(node)}:${field}`) || presentation);
      }
  const repo = literal(load, 'model_id');
  same(repo, { source: 'hub', value: 'Lightricks/LTX-Video-0.9.8-13B-distilled' });
  const revision = literal(load, 'revision');
  assert.match(revision, /^[a-f0-9]{40}$/u);
  assert.equal(literal(load, 'pipeline_class'), 'LTXConditionPipeline');
  assert.equal(literal(load, 'execution_profile_id'), 'ltx-video:direct');
  for (const field of [
    'motion_adapter_id',
    'motion_adapter_revision',
    'ic_lora_id',
    'ic_lora_revision',
    'ic_lora_weight_name',
  ])
    assert.equal(literal(load, field), '');
  const dtype = literal(load, 'dtype'),
    device = literal(load, 'device'),
    offloadMode = literal(load, 'offload_mode'),
    autoOffload = literal(load, 'auto_offload');
  assert.equal(dtype, 'bfloat16');
  assert.equal(device, 'cuda:0');
  assert(['none', 'model_cpu', 'group_cpu'].includes(offloadMode));
  assert.equal(typeof autoOffload, 'boolean');
  assert.equal(literal(load, 'low_cpu_mem_usage'), true);
  for (const [field, expected] of Object.entries({
    device,
    offload_mode: offloadMode,
    attention_backend: 'auto',
    device_map: 'none',
    max_memory: '{}',
    device_map_overrides: '{}',
    layerwise_casting: false,
    channels_last: false,
    regional_compile: false,
    denoiser_cache: 'none',
  }))
    same(literal(recipeScope, field), expected);
  const vaeSlicing = literal(recipeScope, 'vae_slicing'),
    vaeTiling = literal(recipeScope, 'vae_tiling');
  assert.equal(typeof vaeSlicing, 'boolean');
  assert.equal(typeof vaeTiling, 'boolean');
  assert.equal(literal(quantScope, 'backend'), 'none');
  assert.equal(literal(quantScope, 'dtype'), dtype);
  assert.equal(literal(quantScope, 'component_overrides'), '{}');
  for (const field of [...(remaster ? [] : ['video']), ...(conditioned ? [] : ['reference_images'])]) {
    const p = roles.get(enc).node.params[field];
    assert(p && !p.sourceId && !p.sourceKey && p.value == null);
  }
  const contract = literal(enc, 'video_contract');
  same(contract, literal(den, 'video_contract'));
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.library, 'diffusers');
  assert.equal(contract.mediaKind, 'video');
  assert.equal(contract.pipelineClass, 'LTXConditionPipeline');
  for (const action of ['EncodeInputs', 'Denoise', 'DecodeLatents']) {
    assert(Array.isArray(contract.actions[action]));
    assert(contract.actions[action].includes(form.mode));
  }
  assert.equal(literal(enc, 'mode'), form.mode);
  assert.equal(literal(den, 'mode'), form.mode);
  same(inputArtifacts.length, inputCount);
  const inputs = [];
  if (remaster) {
    same(
      Object.keys(roles.get(sourceVideoScope).node.params).filter((k) => k !== 'label'),
      ['file'],
    );
    same(
      Object.keys(roles.get(normalizeScope).node.params).sort(),
      'video width height num_frames fit'.split(' ').sort(),
    );
    const path = literal(sourceVideoScope, 'file');
    assert(typeof path === 'string' && path.length > 0 && path.length <= 16384);
    if (form.sourceVideo) same(path, form.sourceVideo);
    const input = inputArtifacts[0];
    same(input.role, 'sourceVideo');
    same(input.path, path);
    assert.match(input.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
    assert(Number.isSafeInteger(input.byteSize) && input.byteSize > 0);
    inputs.push({ role: 'sourceVideo', contentHash: input.contentHash, byteSize: input.byteSize });
    for (const [k, v] of Object.entries({
      width: form.width,
      height: form.height,
      num_frames: form.numFrames,
      fit: 'cover',
    }))
      same(literal(normalizeScope, k), v);
    assert(Number.isFinite(form.strength) && form.strength >= 0 && form.strength <= 1);
  }
  if (conditioned) {
    const fields = Object.keys(roles.get(imageScope).node.params).filter((field) => field !== 'label');
    same(fields.sort(), ['alpha_channel', 'file']);
    same(literal(imageScope, 'alpha_channel'), 'ignore');
    const files = literal(imageScope, 'file');
    assert(Array.isArray(files));
    if (form.referenceImages !== undefined) same(files, form.referenceImages);
    same(files.length, inputCount);
    for (const [index, path] of files.entries()) {
      assert(typeof path === 'string' && path.length > 0 && path.length <= 16384);
      const role = `referenceImages[${index}]`;
      const matches = inputArtifacts.filter((item) => item.role === role);
      same(matches.length, 1);
      const input = matches[0];
      same(input.path, path);
      assert.match(input.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
      assert(Number.isSafeInteger(input.byteSize) && input.byteSize > 0);
      inputs.push({ role, contentHash: input.contentHash, byteSize: input.byteSize });
    }
    assert(Number.isFinite(form.strength) && form.strength >= 0 && form.strength <= 1);
  }
  same(literal(enc, 'prompt'), form.prompt);
  same(literal(enc, 'negative_prompt'), form.negativePrompt);
  const width = literal(den, 'width'),
    height = literal(den, 'height'),
    frames = literal(den, 'num_frames'),
    fps = literal(den, 'frame_rate');
  for (const n of [width, height, frames, form.steps, form.maxSequenceLength]) assert(Number.isSafeInteger(n) && n > 0);
  assert(Number.isFinite(fps) && fps > 0 && fps <= 120);
  for (const [field, expected] of Object.entries({
    width: form.width,
    height: form.height,
    num_frames: form.numFrames,
    frame_rate: form.fps,
    num_inference_steps: form.steps,
    seed: form.seed,
    guidance_scale: form.guidanceScale,
  }))
    same(literal(den, field), expected);
  same(literal(enc, 'guidance_scale'), form.guidanceScale);
  same(literal(enc, 'max_sequence_length'), form.maxSequenceLength);
  assert.equal(literal(den, 'use_guidance_scale_2'), false);
  assert.equal(literal(den, 'guidance_scale_2'), 0);
  for (const [field, expected] of Object.entries({
    conditioning_scale: form.mode === 'image_to_video' ? form.strength : 1,
    attention_kwargs_json: '',
    strength: remaster ? 1 : form.strength,
    denoise_strength: form.strength,
    reference_strength: 1,
    scheduler_flow_shift: 0,
  }))
    same(literal(den, field), expected);
  assert.equal(literal(dec, 'output_type'), 'pil');
  assert.equal(literal(outScope, 'fps'), fps);
  const upscaler = literal(upScope, 'model_id');
  same(upscaler, {
    source: 'hub',
    value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
    revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
    sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
    byteSize: 67061725,
    license: 'bsd-3-clause',
  });
  for (const [field, expected] of Object.entries({ downscale: 1, tile_size: 256, tile_overlap: 32, device }))
    same(literal(upScope, field), expected);
  const plan = {
    source: OBSERVED_WORKFLOW_AUTO_VIDEO_SOURCE,
    modelType: 'LTXConditionPipeline',
    pipelineClass: 'LTXConditionPipeline',
    modelRepo: repo.value,
    modelRevision: revision,
    task: form.mode,
    dtype,
    device,
    offloadMode,
    autoOffload,
    resourceMode: 'auto',
    resolvedResourceMode: 'auto',
    quantizationMode: 'none',
    quantizedComponents: [],
    requestedOffloadMode: form.offloadMode,
    requestedAutoOffload: form.autoOffload,
    resourceObservation: {
      base: { width, height, frames, fps },
      delivery: { width: width * 2, height: height * 2, frames, fps },
      requestedMaxSequenceLength: form.maxSequenceLength,
      maxSequenceLength: Math.min(form.maxSequenceLength, 128),
      vaeSlicing,
      vaeTiling,
      upscaler,
      ...(conditioned ? { inputs, conditioningStrength: form.strength } : {}),
      ...(remaster
        ? {
            inputs,
            conditioningStrength: 1,
            denoiseStrength: form.strength,
            unusedDenoiserStrength: 1,
            normalization: normalizationEvidence(normalization, inputs[0], { width, height, frames, fps }),
          }
        : {}),
    },
  };
  return { plan, roles, literal };
}

export function observedWorkflowAutoVideoResourceId(plan) {
  try {
    assert.equal(plan?.source, OBSERVED_WORKFLOW_AUTO_VIDEO_SOURCE);
    assertFiniteObservedJson(plan);
    assert(Buffer.byteLength(JSON.stringify(plan)) <= 65536);
    same(
      Object.keys(plan).sort(),
      'source modelType pipelineClass modelRepo modelRevision task dtype device offloadMode autoOffload resourceMode resolvedResourceMode quantizationMode quantizedComponents requestedOffloadMode requestedAutoOffload resourceObservation'
        .split(' ')
        .sort(),
    );
    for (const [field, expected] of Object.entries({
      modelType: 'LTXConditionPipeline',
      pipelineClass: 'LTXConditionPipeline',
      modelRepo: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
      dtype: 'bfloat16',
      device: 'cuda:0',
      resourceMode: 'auto',
      resolvedResourceMode: 'auto',
      quantizationMode: 'none',
    }))
      same(plan[field], expected);
    assert(['text_to_video', 'image_to_video', 'reference_to_video', 'video_to_video'].includes(plan.task));
    assert.match(plan.modelRevision, /^[a-f0-9]{40}$/u);
    same(plan.quantizedComponents, []);
    for (const field of ['offloadMode', 'requestedOffloadMode'])
      assert(['none', 'model_cpu', 'group_cpu'].includes(plan[field]));
    for (const field of ['autoOffload', 'requestedAutoOffload']) assert.equal(typeof plan[field], 'boolean');
    const o = plan.resourceObservation;
    same(
      Object.keys(o).sort(),
      (
        'base delivery requestedMaxSequenceLength maxSequenceLength vaeSlicing vaeTiling upscaler' +
        (plan.task === 'text_to_video' ? '' : ' inputs conditioningStrength') +
        (plan.task === 'video_to_video' ? ' denoiseStrength unusedDenoiserStrength normalization' : '')
      )
        .split(' ')
        .sort(),
    );
    if (plan.task !== 'text_to_video') {
      same(o.inputs.length, ['image_to_video', 'video_to_video'].includes(plan.task) ? 1 : 2);
      assert(Number.isFinite(o.conditioningStrength) && o.conditioningStrength >= 0 && o.conditioningStrength <= 1);
      for (const [index, input] of o.inputs.entries()) {
        same(Object.keys(input).sort(), ['byteSize', 'contentHash', 'role']);
        same(input.role, plan.task === 'video_to_video' ? 'sourceVideo' : `referenceImages[${index}]`);
        assert.match(input.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
        assert(Number.isSafeInteger(input.byteSize) && input.byteSize > 0);
      }
    }
    if (plan.task === 'video_to_video') {
      same(o.conditioningStrength, 1);
      same(o.unusedDenoiserStrength, 1);
      assert(Number.isFinite(o.denoiseStrength) && o.denoiseStrength >= 0 && o.denoiseStrength <= 1);
      same(o.normalization, normalizationEvidence(o.normalization, o.inputs[0], o.base));
    }
    assert(Number.isSafeInteger(o.requestedMaxSequenceLength) && o.requestedMaxSequenceLength > 0);
    assert.equal(o.maxSequenceLength, Math.min(o.requestedMaxSequenceLength, 128));
    for (const field of ['vaeSlicing', 'vaeTiling']) assert.equal(typeof o[field], 'boolean');
    for (const geometry of [o.base, o.delivery]) {
      same(Object.keys(geometry).sort(), ['fps', 'frames', 'height', 'width']);
      for (const field of ['width', 'height', 'frames'])
        assert(Number.isSafeInteger(geometry[field]) && geometry[field] > 0 && geometry[field] <= 32768);
      assert(Number.isFinite(geometry.fps) && geometry.fps > 0 && geometry.fps <= 120);
    }
    same(o.delivery, { width: o.base.width * 2, height: o.base.height * 2, frames: o.base.frames, fps: o.base.fps });
    same(o.upscaler, {
      source: 'hub',
      value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
      revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
      sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
      byteSize: 67061725,
      license: 'bsd-3-clause',
    });
    return `observed-workflow-auto-video-v1:${canonicalJsonHash(plan)}`;
  } catch {
    return null;
  }
}

export function observedWorkflowAutoVideoPlan(
  apiGraph,
  {
    executionReceipt: task,
    executedOutput: output,
    taskId,
    modelIdentities,
    inputArtifacts = [],
    backendSource,
    videoNormalizationEvidence,
  } = {},
) {
  try {
    const hints = apiGraph.runtimeHints,
      snapshot = hints.workflowSnapshot,
      form = snapshot.studioForm;
    assert.equal(hints.resourceMode, 'auto');
    assert.equal(form.trustRemoteCode, false);
    assert.equal(task.status, 'completed');
    assert.equal(task.attempt_index, 0);
    assert.equal(output.attemptIndex, 0);
    assert.equal(task.resourceCandidateId, null);
    assert.equal(output.taskId, task.task_id);
    if (taskId !== undefined) assert.equal(taskId, task.task_id);
    assert(typeof task.task_id === 'string' && task.task_id);
    for (const [hint, taskKey, outputKey] of [
      ['sid', 'sid', 'sid'],
      ['workflowTabId', 'workflow_tab_id', 'workflowTabId'],
      ['clientRunId', 'client_run_id', 'clientRunId'],
      ['runInputHash', 'run_input_hash', 'runInputHash'],
    ]) {
      const v = hint === 'sid' ? apiGraph.sid : hints[hint];
      assert(typeof v === 'string' && v);
      assert.equal(task[taskKey], v);
      assert.equal(output[outputKey], v);
    }
    same(output.apiGraphSnapshot, apiGraph);
    same(task.workflow_snapshot, snapshot);
    same(output.formSnapshot, form);
    assert(!Object.hasOwn(apiGraph, 'loops'));
    assert.equal(hints.workflowAutoPlan.schemaVersion, 1);
    assert.equal(hints.workflowAutoPlan.graphHash, workerGraphHash(apiGraph));
    const { plan, roles, literal } = project(
      Object.entries(apiGraph.nodes),
      apiGraph.paths,
      form,
      inputArtifacts,
      videoNormalizationEvidence,
    );
    if (form.mode === 'video_to_video')
      normalizationSourceMatches(plan.resourceObservation.normalization, backendSource);
    assert.equal(output.nodeId, roles.get(outScope).id);
    const prep = task.runtimePreparation;
    assert.equal(prep.resourceMode, 'auto');
    assert.equal(prep.performed, false);
    assert.equal(prep.residentRecipeReusable, false);
    assert.equal(prep.cleanup, null);
    const auto = prep.workflowAuto;
    assert.equal(auto.strategy, 'dependency_order_retained_owners');
    same(auto.schedule, null);
    same(auto.cachePreparation, null);
    for (const field of ['reusedOwnerIds', 'preparedDataNodes', 'appliedUpdates', 'releases']) same(auto[field], []);
    const receipt = output.resolvedExecutionInputs;
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.source, 'backend-execution');
    assert.equal(receipt.taskId, task.task_id);
    assert.equal(receipt.attemptIndex, 0);
    assert.equal(receipt.nodeId, output.nodeId);
    assert.equal(receipt.truncated, false);
    same(receipt.uncapturedNodeIds, []);
    same(receipt.graphTasks, [
      { loaderId: roles.get(video('LoadPipeline')).id, pipelineClass: 'LTXConditionPipeline', task: form.mode },
    ]);
    const rows = new Map(receipt.nodes.map((row) => [row.nodeId, row]));
    assert.equal(rows.size, Object.keys(apiGraph.nodes).length);
    assert.equal(receipt.nodes.length, rows.size);
    for (const [id, node] of Object.entries(apiGraph.nodes)) {
      assert.equal(rows.get(id).module, node.module);
      assert.equal(rows.get(id).action, node.action);
      same(rows.get(id).omittedFields, {});
    }
    const consumed = (kind, field, expected) => {
      const f = rows.get(roles.get(kind).id).fields[field];
      assert.equal(f.source, 'literal');
      same(f.value, expected);
    };
    for (const [kind, fields] of [
      [
        video('LoadPipeline'),
        ['model_id', 'revision', 'dtype', 'device', 'auto_offload', 'offload_mode', 'pipeline_class'],
      ],
      [recipeScope, ['offload_mode', 'device', 'attention_backend', 'vae_slicing', 'vae_tiling']],
      [quantScope, ['dtype']],
      [video('EncodeInputs'), ['prompt', 'negative_prompt', 'guidance_scale', 'max_sequence_length']],
      [
        video('Denoise'),
        ['width', 'height', 'num_frames', 'frame_rate', 'num_inference_steps', 'guidance_scale', 'seed'],
      ],
      [video('DecodeLatents'), ['output_type']],
      [upScope, ['model_id', 'device']],
      [outScope, ['fps']],
    ])
      for (const field of fields) {
        let expected = literal(kind, field);
        if (field === 'model_id') expected = expected.value;
        // The native stage normalizes the empty, inactive negative prompt to
        // null at guidance one. Keep the authored blank and actual null distinct.
        if (kind === video('EncodeInputs') && field === 'negative_prompt') expected = null;
        // LTX's declared 128-token adapter bound normalizes the shared 512
        // form default before both native stage captures.
        if (kind === video('EncodeInputs') && field === 'max_sequence_length')
          expected = plan.resourceObservation.maxSequenceLength;
        consumed(kind, field, expected);
      }
    for (const kind of [video('EncodeInputs'), video('Denoise'), video('DecodeLatents')])
      consumed(kind, 'executed_task', form.mode);
    if (form.mode === 'video_to_video') {
      consumed(video('Denoise'), 'conditioning_strength', 1);
      consumed(video('Denoise'), 'denoise_strength', form.strength);
      for (const [k, v] of Object.entries({ width: form.width, height: form.height, num_frames: form.numFrames }))
        consumed('modules.VideoConditioning.Normalize', k, v);
      const fields = rows.get(roles.get(video('EncodeInputs')).id).fields;
      for (const [k, v] of Object.entries({
        video_source_sha256: plan.resourceObservation.normalization.normalizedPixelHash,
        video_source_frames: form.numFrames,
      }))
        same(fields[k], {
          source: 'connected',
          value: v,
          sourceNodeId: roles.get('modules.VideoConditioning.Normalize').id,
          sourcePortId: 'output',
        });
    } else if (form.mode !== 'text_to_video') {
      consumed(video('Denoise'), 'conditioning_strength', form.strength);
      consumed('modules.Image.Load', 'alpha_channel', 'ignore');
      consumed(
        'modules.Image.Load',
        'source_hashes',
        plan.resourceObservation.inputs.map((i) => i.contentHash.slice(13)),
      );
    }
    consumed(video('Denoise'), 'max_sequence_length', plan.resourceObservation.maxSequenceLength);
    for (const kind of [video('LoadPipeline'), recipeScope])
      for (const field of kind === recipeScope
        ? ['offload_mode', 'device', 'attention_backend', 'vae_slicing', 'vae_tiling']
        : ['revision', 'dtype', 'device', 'auto_offload', 'offload_mode', 'pipeline_class'])
        same(auto.resolvedFields[roles.get(kind).id][field], literal(kind, field));
    assert.equal(output.mediaItems.length, 1);
    const media = output.mediaItems[0];
    assert.equal(media.displayType, 'video');
    for (const [field, expected] of Object.entries({
      width: plan.resourceObservation.delivery.width,
      height: plan.resourceObservation.delivery.height,
      frame_count: form.numFrames,
      fps: form.fps,
    }))
      same(media.mediaMetadata[field], expected);
    assert.equal(modelIdentities.length, 2);
    for (const [repo, rev] of [
      [plan.modelRepo, plan.modelRevision],
      ['nateraw/real-esrgan', plan.resourceObservation.upscaler.revision],
    ]) {
      const matches = modelIdentities.filter((m) => m.repoId === repo);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].selectedRevision, rev);
      assert.equal(matches[0].modelRevision, repo + '@' + rev);
      assert(matches[0].fingerprint);
    }
    assert(observedWorkflowAutoVideoResourceId(plan));
    return stableJsonValue(plan);
  } catch {
    return null;
  }
}

export function observedWorkflowAutoVideoProofMatches(plan, provenance) {
  try {
    assert(observedWorkflowAutoVideoResourceId(plan));
    const graph = provenance.graph.canonicalGraph;
    const projected = project(
      graph.nodes.map((n) => [n.key, n]),
      graph.paths,
      provenance.template.lockedSettings,
      provenance.inputs.items ?? [],
      plan.resourceObservation.normalization,
    ).plan;
    same(plan, projected);
    if (plan.task === 'video_to_video')
      normalizationSourceMatches(plan.resourceObservation.normalization, provenance.runtime.backendSource);
    assert.equal(provenance.inputs.count, plan.resourceObservation.inputs?.length ?? 0);
    assert.equal(provenance.models.items.length, 2);
    for (const [repo, rev] of [
      [plan.modelRepo, plan.modelRevision],
      ['nateraw/real-esrgan', plan.resourceObservation.upscaler.revision],
    ]) {
      const matches = provenance.models.items.filter((m) => m.repoId === repo);
      assert.equal(matches.length, 1);
      assert.equal(matches[0].selectedRevision, rev);
    }
    assert.equal(provenance.output.items.length, 1);
    const output = provenance.output.items[0];
    same(output.width, plan.resourceObservation.delivery.width);
    same(output.height, plan.resourceObservation.delivery.height);
    same(output.frames, plan.resourceObservation.delivery.frames);
    return true;
  } catch {
    return false;
  }
}
