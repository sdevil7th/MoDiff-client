// Maintainer evidence reader only. No graph execution, Auto admission or qualification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import {
  validateAppliedAdapterItems,
  validateAppliedAdapterProof,
  validateAppliedAdapterSection,
} from './applied-adapter-provenance.mjs';

export const OBSERVED_WORKFLOW_AUTO_SOURCE = 'observed-workflow-auto-resource-v1';
export const OBSERVED_WORKFLOW_AUTO_LORA_SOURCE = 'observed-workflow-auto-lora-resource-v1';
export const OBSERVED_WORKFLOW_AUTO_AUDIO_SOURCE = 'observed-workflow-auto-audio-resource-v1';
export const OBSERVED_WORKFLOW_AUTO_IMAGE_SOURCE = 'observed-workflow-auto-image-resource-v1';
export const OBSERVED_WORKFLOW_AUTO_LEGACY_SOURCE = 'observed-workflow-auto-legacy-resource-v1';
export const isObservedWorkflowAutoSource = (source) =>
  source === OBSERVED_WORKFLOW_AUTO_SOURCE ||
  source === OBSERVED_WORKFLOW_AUTO_LORA_SOURCE ||
  source === OBSERVED_WORKFLOW_AUTO_AUDIO_SOURCE ||
  source === OBSERVED_WORKFLOW_AUTO_IMAGE_SOURCE ||
  source === OBSERVED_WORKFLOW_AUTO_LEGACY_SOURCE;
const same = (a, b) => assert.deepEqual(stableJsonValue(a), stableJsonValue(b));
const value = (node, key) => node.params?.[key]?.value;
const scope = (node) => `${node.module}.${node.action}`;
const ownerScope = 'modules.ModularDiffusers.ModelsLoader';
const core = ['ModelsLoader', 'EncodePrompt', 'Denoise', 'DecodeLatents']
  .map((a) => 'modules.ModularDiffusers.' + a)
  .concat('modules.Image.Preview');
const optional = 'modules.ModularDiffusers.Guider';
const encodeScope = 'modules.ModularDiffusers.EncodePrompt';
const descriptorScope = 'modules.ModularDiffusers.Lora';
const descriptorFields = new Set(
  'model weight_name revision expected_sha256 scale adapter_name previous_loras scheduler_class scheduler_config'.split(
    ' ',
  ),
);
const ownerFields = new Set(
  'reviewed_variant workflow_id revision repo_id model_type dtype device offload_mode auto_offload weight_loading_mode attention_backend vae_slicing vae_tiling weight_format inpaint_compatibility'.split(
    ' ',
  ),
);
const scalarFields = new Set('width height num_inference_steps guidance_scale strength'.split(' '));

function validateControlFields(kind, fields, imageConditioned) {
  if (kind === encodeScope) {
    assert(!imageConditioned);
    same(Object.keys(fields), ['max_sequence_length']);
    assert(Number.isSafeInteger(fields.max_sequence_length) && fields.max_sequence_length > 0);
  } else {
    assert(kind === ownerScope || kind === 'modules.ModularDiffusers.Denoise' || kind === optional);
    for (const key of Object.keys(fields)) assert((kind === ownerScope ? ownerFields : scalarFields).has(key));
  }
}

function finiteJson(value, depth = 0, seen = new Set()) {
  assert(depth <= 16);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    assert(Number.isFinite(value));
    return;
  }
  if (typeof value === 'string') {
    assert(Buffer.byteLength(value) <= 65536);
    return;
  }
  assert(value && typeof value === 'object' && !seen.has(value));
  assert(
    Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
  );
  assert(Object.keys(value).length <= 2048);
  seen.add(value);
  for (const item of Object.values(value)) finiteJson(item, depth + 1, seen);
  seen.delete(value);
}
export { finiteJson as assertFiniteObservedJson };

// Same compact sorted ASCII-JSON wire domain as the worker. A representation
// mismatch remains unsupported; it is never repaired by replacing the receipt.
export function workerGraphHash(graph) {
  const material = { nodes: graph.nodes, paths: graph.paths };
  finiteJson(material);
  const text = JSON.stringify(stableJsonValue(material)).replace(
    /[\u007f-\uffff]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  assert(Buffer.byteLength(text) <= 8 * 1024 ** 2);
  return 'sha256:workflow-auto-v1:' + createHash('sha256').update(text).digest('hex');
}

export function observedWorkflowAutoResourceId(plan) {
  try {
    assert(isObservedWorkflowAutoSource(plan.source));
    if (plan.source === OBSERVED_WORKFLOW_AUTO_AUDIO_SOURCE) return audioResourceId(plan);
    const o = plan.resourceObservation;
    finiteJson(o);
    assert.equal(o.schemaVersion, 1);
    assert.equal(typeof o.modelType, 'string');
    assert(o.modelType.length > 0);
    assert.equal(typeof o.repo, 'string');
    assert(o.repo.length > 0);
    assert.match(o.revision, /^[0-9a-f]{40}$/u);
    const imageConditioned = plan.source === OBSERVED_WORKFLOW_AUTO_IMAGE_SOURCE;
    const legacy = plan.source === OBSERVED_WORKFLOW_AUTO_LEGACY_SOURCE;
    if (o.decoderGeometryRoute !== undefined) {
      assert(!imageConditioned);
      assert.equal(o.decoderGeometryRoute, 'denoiser_dimensions');
    }
    if (imageConditioned) assert(['edit_image', 'multi_image_reference_edit'].includes(o.task));
    else {
      assert.equal(o.task, 'text_to_image');
      if (o.formModelType !== undefined) {
        assert(typeof o.formModelType === 'string' && o.formModelType.length > 0 && o.formModelType.length <= 256);
        assert.notEqual(o.formModelType, o.modelType);
      }
    }
    if (imageConditioned) {
      if (o.imageRoute === 'native_state') {
        assert.equal(o.task, 'edit_image');
        assert.equal(o.reportedGraphTask, 'edit_image');
      } else {
        assert(!Object.hasOwn(o, 'imageRoute'));
        assert.equal(o.reportedGraphTask, null);
      }
      assert.equal(o.workflowId, 'image_conditioned');
      assert(typeof o.formModelType === 'string' && o.formModelType.length > 0 && o.formModelType.length <= 256);
      assert(Array.isArray(o.references) && o.references.length === (o.task === 'edit_image' ? 1 : 2));
      for (const [index, reference] of o.references.entries()) {
        same(Object.keys(reference).sort(), ['contentHash', 'role']);
        assert.equal(reference.role, `referenceImages[${index}]`);
        assert.match(reference.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
      }
      if (o.references.length === 2) assert.notEqual(o.references[0].contentHash, o.references[1].contentHash);
      if (o.task === 'edit_image') {
        assert(['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'].includes(o.requestedOffloadMode));
        assert.equal(typeof o.requestedAutoOffload, 'boolean');
      }
    }
    assert(['bfloat16', 'float16', 'float32'].includes(o.dtype));
    assert.equal(typeof o.device, 'string');
    assert(o.device.length > 0);
    assert.equal(typeof o.autoOffload, 'boolean');
    assert(['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'].includes(o.offloadMode));
    if (legacy) {
      assert(!Object.hasOwn(o, 'weightLoadingMode') && !Object.hasOwn(plan, 'weightLoadingMode'));
      same(o.absentLoaderControls, ['weight_format', 'weight_loading_mode']);
      assert.match(o.backendSourceFingerprint, /^sha256:backend-source-v1:[a-f0-9]{64}$/u);
      assert.match(o.backendContractFingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
      if (o.guiderConfiguration !== undefined) {
        same(
          Object.keys(o.guiderConfiguration).sort(),
          'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'
            .split(' ')
            .sort(),
        );
        const g = o.guiderConfiguration;
        same(g.model_type, o.modelType);
        same(g.guider, 'ClassifierFreeGuidance');
        same(g.guidance_rescale, 0);
        same(g.use_original_formulation, false);
        assert.equal(typeof g.enabled, 'boolean');
        same(g.start, 0);
        same(g.stop, 1);
        assert(Number.isFinite(g.guidance_scale) && g.guidance_scale >= 0);
      }
    } else assert(['cpu', 'cuda'].includes(o.weightLoadingMode));
    for (const key of ['width', 'height'])
      assert(Number.isInteger(o.geometry[key]) && o.geometry[key] > 0 && o.geometry[key] <= 32768);
    assert.equal(o.strategy, 'dependency_order_retained_owners');
    assert(Array.isArray(o.controls) && o.controls.length >= 2 && o.controls.length <= (imageConditioned ? 3 : 4));
    const controls = new Map(o.controls.map((c) => [c.scope, c.fields]));
    assert.equal(controls.size, o.controls.length);
    assert(controls.has(ownerScope));
    if (imageConditioned) assert.equal(controls.get(ownerScope).workflow_id, o.workflowId);
    const denoiseFields = controls.get('modules.ModularDiffusers.Denoise');
    assert(denoiseFields);
    for (const key of ['width', 'height']) same(denoiseFields[key], o.geometry[key]);
    for (const [kind, fields] of controls) validateControlFields(kind, fields, imageConditioned);
    if (legacy) {
      const primary = controls.get(ownerScope);
      for (const field of o.absentLoaderControls) assert(!Object.hasOwn(primary, field));
      for (const field of [
        'repo_id',
        'revision',
        'model_type',
        'dtype',
        'device',
        'offload_mode',
        'auto_offload',
        'attention_backend',
        'vae_slicing',
        'vae_tiling',
      ])
        assert(Object.hasOwn(primary, field));
    }
    if (controls.has(encodeScope)) same(plan.maxSequenceLength, controls.get(encodeScope).max_sequence_length);
    else assert(!Object.hasOwn(plan, 'maxSequenceLength'));
    for (const [key, other] of Object.entries({
      modelType: 'modelType',
      modelRepo: 'repo',
      modelRevision: 'revision',
      task: 'task',
      dtype: 'dtype',
      device: 'device',
      offloadMode: 'offloadMode',
      autoOffload: 'autoOffload',
      weightLoadingMode: 'weightLoadingMode',
      attentionBackend: 'attentionBackend',
      vaeSlicing: 'vaeSlicing',
      vaeTiling: 'vaeTiling',
    }))
      same(plan[key], o[other]);
    assert.equal(plan.resolvedModelRepo, o.repo);
    assert.equal(plan.resolvedArtifact, o.repo);
    assert.equal(plan.pipelineClass, o.modelType);
    assert.equal(plan.resourceMode, 'auto');
    assert.equal(plan.resolvedResourceMode, 'auto');
    assert.equal(plan.quantizationMode, 'none');
    same(plan.quantizedComponents, []);
    if (plan.source === OBSERVED_WORKFLOW_AUTO_LORA_SOURCE) {
      validateAppliedAdapterItems(o.adapters);
      assert.equal(o.adapters.length, 1);
      assert.equal(o.adapters[0].artifact.source, 'hub');
      assert.equal(o.adapters[0].scheduler, null);
    } else assert(!Object.hasOwn(o, 'adapters'));
    if (plan.source === OBSERVED_WORKFLOW_AUTO_LORA_SOURCE || imageConditioned || legacy) {
      const primary = controls.get(ownerScope);
      assert.equal(primary.repo_id?.source, 'hub');
      same(primary.repo_id.value, o.repo);
      for (const [key, observed] of Object.entries({
        model_type: 'modelType',
        revision: 'revision',
        dtype: 'dtype',
        device: 'device',
        auto_offload: 'autoOffload',
        offload_mode: 'offloadMode',
        weight_loading_mode: 'weightLoadingMode',
        attention_backend: 'attentionBackend',
        vae_slicing: 'vaeSlicing',
        vae_tiling: 'vaeTiling',
      })) {
        if (legacy && key === 'weight_loading_mode') continue;
        assert(Object.hasOwn(primary, key));
        same(primary[key], o[observed]);
      }
      if (!legacy) assert.equal(primary.weight_format, 'native');
    }
    const id = plan.source + ':' + canonicalJsonHash(o);
    assert.equal(plan.observedResourceCandidateId, id);
    return id;
  } catch {
    return null;
  }
}

const audioControlFields = new Map(
  [
    [
      'modules.DiffusersAudio.LoadPipeline',
      'model_id pipeline_class revision dtype device offload_mode auto_offload mode',
    ],
    [
      'modules.DiffusersRuntime.DiffusersExecutionRecipe',
      'attention_backend regional_compile layerwise_casting channels_last device_map denoiser_cache max_memory device_map_overrides vae_slicing vae_tiling offload_mode device',
    ],
    ['modules.DiffusersRuntime.PipelineQuantizationConfigV2', 'backend component_overrides'],
    ['modules.DiffusersAudio.Generate', 'num_inference_steps guidance_scale audio_duration'],
  ].map(([kind, fields]) => [kind, fields.split(' ').sort()]),
);

// This is an observed recipe identity, never a new Auto admission or fit claim.
function audioResourceId(plan) {
  const o = plan.resourceObservation;
  finiteJson(o);
  assert.equal(o.schemaVersion, 1);
  assert.equal(o.strategy, 'dependency_order_retained_owners');
  assert(['text_to_audio', 'audio_continuation'].includes(o.task));
  assert.match(o.repo, /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u);
  assert.match(o.revision, /^[0-9a-f]{40}$/u);
  assert.equal(typeof o.modelType, 'string');
  assert(o.modelType.length > 0);
  assert(['bfloat16', 'float16', 'float32'].includes(o.dtype));
  assert.equal(typeof o.device, 'string');
  assert(o.device.length > 0);
  assert(['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'].includes(o.offloadMode));
  assert.equal(typeof o.autoOffload, 'boolean');
  assert.equal(o.attentionBackend, 'auto');
  for (const [field, observed] of Object.entries({
    modelType: 'modelType',
    pipelineClass: 'modelType',
    modelRepo: 'repo',
    resolvedModelRepo: 'repo',
    resolvedArtifact: 'repo',
    modelRevision: 'revision',
    task: 'task',
    dtype: 'dtype',
    device: 'device',
    offloadMode: 'offloadMode',
    autoOffload: 'autoOffload',
    deviceMap: 'deviceMap',
    attentionBackend: 'attentionBackend',
  }))
    same(plan[field], o[observed]);
  assert.equal(plan.resourceMode, 'auto');
  assert.equal(plan.resolvedResourceMode, 'auto');
  assert.equal(plan.quantizationMode, 'none');
  same(plan.quantizedComponents, []);
  const w = o.workload;
  for (const field of ['requestedAudioDuration', 'effectiveAudioDuration', 'steps', 'guidanceScale', 'sampleRate'])
    assert(Number.isFinite(w[field]) && w[field] > 0);
  assert(Number.isInteger(w.steps) && Number.isInteger(w.sampleRate));
  if (o.task === 'text_to_audio') {
    assert.equal(w.extensionDuration, null);
    assert.equal(w.requestedAudioDuration, w.effectiveAudioDuration);
  } else {
    assert(Number.isFinite(w.extensionDuration) && w.extensionDuration > 0);
    assert.equal(w.effectiveAudioDuration, w.requestedAudioDuration + w.extensionDuration);
  }
  assert(Array.isArray(o.controls) && o.controls.length === 4);
  const controls = new Map(o.controls.map((control) => [control.scope, control.fields]));
  assert.equal(controls.size, 4);
  for (const control of o.controls) {
    assert(audioControlFields.has(control.scope));
    assert(control.fields && !Array.isArray(control.fields));
    same(Object.keys(control.fields).sort(), audioControlFields.get(control.scope));
  }
  const owner = controls.get('modules.DiffusersAudio.LoadPipeline');
  for (const [field, observed] of Object.entries({
    model_id: { source: 'hub', value: o.repo },
    pipeline_class: o.modelType,
    revision: o.revision,
    dtype: o.dtype,
    device: o.device,
    offload_mode: o.offloadMode,
    auto_offload: o.autoOffload,
    mode: o.task,
  }))
    same(owner[field], observed);
  const recipe = controls.get('modules.DiffusersRuntime.DiffusersExecutionRecipe');
  for (const [field, observed] of Object.entries({
    attention_backend: o.attentionBackend,
    device_map: o.deviceMap,
    offload_mode: o.offloadMode,
    device: o.device,
    regional_compile: false,
    layerwise_casting: false,
    channels_last: false,
    denoiser_cache: 'none',
    max_memory: '{}',
    device_map_overrides: '{}',
  }))
    same(recipe[field], observed);
  for (const field of ['vae_slicing', 'vae_tiling']) assert.equal(typeof recipe[field], 'boolean');
  for (const [field, observed] of Object.entries({
    regionalCompile: false,
    layerwiseCasting: false,
    channelsLast: false,
    denoiserCache: 'none',
  }))
    same(plan[field], observed);
  same(controls.get('modules.DiffusersRuntime.PipelineQuantizationConfigV2'), {
    backend: 'none',
    component_overrides: '{}',
  });
  same(controls.get('modules.DiffusersAudio.Generate'), {
    audio_duration: w.requestedAudioDuration,
    num_inference_steps: w.steps,
    guidance_scale: w.guidanceScale,
  });
  const id = plan.source + ':' + canonicalJsonHash(o);
  assert.equal(plan.observedResourceCandidateId, id);
  return id;
}

/** Keep a recomputed observed ID bound to the original canonical graph/model/output. */
export function observedWorkflowAutoAudioProofMatches(plan, provenance) {
  try {
    assert.equal(plan.source, OBSERVED_WORKFLOW_AUTO_AUDIO_SOURCE);
    assert(audioResourceId(plan));
    const nodes = provenance.graph.canonicalGraph.nodes;
    assert.equal(nodes.length, plan.task === 'text_to_audio' ? 5 : 8);
    const unique = (kind) => {
      const matches = nodes.filter((node) => scope(node) === kind);
      assert.equal(matches.length, 1);
      return matches[0];
    };
    const owner = unique('modules.DiffusersAudio.LoadPipeline');
    same(value(owner, 'model_id'), { source: 'hub', value: plan.modelRepo });
    same(value(owner, 'revision'), plan.modelRevision);
    same(value(owner, 'pipeline_class'), plan.modelType);
    same(value(owner, 'mode'), plan.task);
    assert.equal(provenance.models.items.length, 1);
    const model = provenance.models.items[0];
    assert.equal(model.repoId, plan.modelRepo);
    assert.equal(model.selectedRevision, plan.modelRevision);
    for (const control of plan.resourceObservation.controls) {
      const node = unique(control.scope);
      for (const [field, observed] of Object.entries(control.fields)) {
        assert(!node.params[field]?.sourceId && !node.params[field]?.sourceKey);
        same(value(node, field), observed);
      }
    }
    const generate = unique('modules.DiffusersAudio.Generate'),
      w = plan.resourceObservation.workload;
    assert.equal(provenance.output.items.length, 1);
    same(value(unique('modules.DiffusersRuntime.PipelineQuantizationConfigV2'), 'dtype'), plan.dtype);
    same(value(unique('modules.Audio.Export'), 'sample_rate'), w.sampleRate);
    for (const [field, observed] of Object.entries({
      audio_duration: w.requestedAudioDuration,
      num_inference_steps: w.steps,
      guidance_scale: w.guidanceScale,
      sample_rate: w.sampleRate,
    }))
      same(value(generate, field), observed);
    if (plan.task === 'audio_continuation') same(value(generate, 'extension_duration'), w.extensionDuration);
    same(provenance.output.items[0].durationSeconds, w.effectiveAudioDuration);
    same(provenance.output.items[0].sampleRate, w.sampleRate);
    return true;
  } catch {
    return false;
  }
}

/** Keep absent historical loader controls absent, with source/contract bindings. */
export function observedWorkflowAutoLegacyProofMatches(plan, provenance) {
  try {
    assert.equal(plan.source, OBSERVED_WORKFLOW_AUTO_LEGACY_SOURCE);
    assert(observedWorkflowAutoResourceId(plan));
    const o = plan.resourceObservation;
    same(o.backendSourceFingerprint, provenance.runtime.backendSource.fingerprint);
    same(o.backendContractFingerprint, provenance.runtime.backendContract.fingerprint);
    const nodes = provenance.graph.canonicalGraph.nodes;
    assert(nodes.length === 5 || nodes.length === 6);
    const unique = (kind) => {
      const matches = nodes.filter((node) => scope(node) === kind);
      assert.equal(matches.length, 1);
      return matches[0];
    };
    const owner = unique(ownerScope),
      encode = unique(encodeScope);
    const denoise = unique('modules.ModularDiffusers.Denoise');
    const decode = unique('modules.ModularDiffusers.DecodeLatents');
    const preview = unique('modules.Image.Preview');
    assert(nodes.every((node) => core.includes(scope(node)) || scope(node) === optional));
    const contract = provenance.runtime.backendContract.contracts.filter((item) => item.key === ownerScope);
    assert.equal(contract.length, 1);
    for (const field of o.absentLoaderControls) {
      assert(!Object.hasOwn(owner.params, field));
      assert(!Object.hasOwn(contract[0].params, field));
    }
    for (const control of o.controls) {
      const node = unique(control.scope);
      for (const [field, observed] of Object.entries(control.fields)) {
        assert(!node.params[field]?.sourceId && !node.params[field]?.sourceKey);
        same(value(node, field), observed);
      }
    }
    const connected = new Set();
    const wire = (node, field, supplier, output) => {
      connected.add(node.key + ':' + field);
      assert.equal(node.params[field]?.sourceId, supplier.key);
      assert.equal(node.params[field]?.sourceKey, output);
      if (Object.hasOwn(node.params[field], 'value')) {
        assert(node === decode && ['width', 'height'].includes(field));
        same(node.params[field].value, o.geometry[field]);
      }
    };
    wire(encode, 'text_encoders', owner, 'text_encoders');
    wire(denoise, 'unet', owner, 'unet_out');
    wire(denoise, 'scheduler', owner, 'scheduler');
    wire(denoise, 'embeddings', encode, 'embeddings');
    wire(decode, 'vae', owner, 'vae_out');
    wire(decode, 'latents', denoise, 'latents');
    if (o.decoderGeometryRoute === 'denoiser_dimensions') {
      wire(decode, 'width', denoise, 'out_width');
      wire(decode, 'height', denoise, 'out_height');
    }
    wire(preview, 'image', decode, 'images');
    if (nodes.length === 6) {
      const guider = unique(optional);
      assert(o.guiderConfiguration);
      wire(denoise, 'guider', guider, 'guider_out');
      wire(encode, 'guider', guider, 'guider_out');
      for (const [field, observed] of Object.entries(o.guiderConfiguration)) same(value(guider, field), observed);
      same(o.guiderConfiguration.guidance_scale, value(denoise, 'guidance_scale'));
    } else assert(!Object.hasOwn(o, 'guiderConfiguration'));
    for (const node of nodes)
      for (const [field, param] of Object.entries(node.params)) {
        if (param.sourceId) assert(connected.has(node.key + ':' + field));
      }
    same(value(owner, 'repo_id'), { source: 'hub', value: plan.modelRepo });
    same(value(owner, 'revision'), plan.modelRevision);
    same(value(owner, 'model_type'), plan.modelType);
    for (const field of [
      'quant_config',
      'lora_list',
      'unet',
      'vae',
      'controlnet',
      'text_encoders',
      'pipeline_components',
      'image_encoder',
    ]) {
      assert(!owner.params[field]?.sourceId && !owner.params[field]?.sourceKey);
      assert(value(owner, field) == null);
    }
    assert.equal(provenance.models.items.length, 1);
    const model = provenance.models.items[0];
    same(model.repoId, plan.modelRepo);
    same(model.selectedRevision, plan.modelRevision);
    const form = provenance.template.lockedSettings;
    same(form.mode, 'text_to_image');
    same(form.modelType, o.formModelType ?? plan.modelType);
    same(form.dtype, plan.dtype);
    same(form.quantizationMode, 'none');
    same(value(owner, 'trust_remote_code'), false);
    if (Object.hasOwn(form, 'trustRemoteCode')) same(form.trustRemoteCode, false);
    assert(!Object.hasOwn(form, 'weightFormat'));
    for (const [field, formKey] of [
      ['width', 'width'],
      ['height', 'height'],
      ['seed', 'seed'],
      ['num_inference_steps', 'steps'],
      ['guidance_scale', 'guidanceScale'],
    ]) {
      same(value(denoise, field), form[formKey]);
    }
    same(value(encode, 'prompt'), form.prompt);
    same(value(encode, 'negative_prompt') ?? '', form.negativePrompt);
    if (plan.maxSequenceLength !== undefined) same(plan.maxSequenceLength, form.maxSequenceLength);
    assert.equal(provenance.inputs.items.length, 0);
    assert.equal(provenance.output.items.length, 1);
    same(provenance.output.items[0].mediaType, 'image');
    for (const field of ['width', 'height']) same(provenance.output.items[0][field], o.geometry[field]);
    return true;
  } catch {
    return false;
  }
}

/** Recheck the connected decoder route after hashes have been recomputed. */
export function observedWorkflowAutoTextGeometryProofMatches(plan, provenance) {
  try {
    assert([OBSERVED_WORKFLOW_AUTO_SOURCE, OBSERVED_WORKFLOW_AUTO_LORA_SOURCE].includes(plan.source));
    assert(observedWorkflowAutoResourceId(plan));
    assert.equal(plan.resourceObservation.decoderGeometryRoute, 'denoiser_dimensions');
    const nodes = provenance.graph.canonicalGraph.nodes;
    assert(nodes.length >= 5 && nodes.length <= 7);
    const roles = new Map(nodes.map((node) => [scope(node), node]));
    assert.equal(roles.size, nodes.length);
    assert(nodes.every((node) => core.includes(scope(node)) || [optional, descriptorScope].includes(scope(node))));
    for (const kind of core) assert(roles.has(kind));
    assert.equal(roles.has(descriptorScope), plan.source === OBSERVED_WORKFLOW_AUTO_LORA_SOURCE);
    const owner = roles.get(ownerScope),
      denoise = roles.get('modules.ModularDiffusers.Denoise');
    const decode = roles.get('modules.ModularDiffusers.DecodeLatents'),
      preview = roles.get('modules.Image.Preview');
    for (const [node, field, supplier, port] of [
      [decode, 'vae', owner, 'vae_out'],
      [decode, 'latents', denoise, 'latents'],
      [preview, 'image', decode, 'images'],
    ]) {
      assert.equal(node.params[field]?.sourceId, supplier.key);
      assert.equal(node.params[field].sourceKey, port);
      assert(!Object.hasOwn(node.params[field], 'value'));
    }
    assert.equal(provenance.output.items.length, 1);
    for (const field of ['width', 'height']) {
      const actual = plan.resourceObservation.geometry[field],
        p = decode.params[field];
      assert.equal(p?.sourceId, denoise.key);
      assert.equal(p.sourceKey, 'out_' + field);
      if (Object.hasOwn(p, 'value')) same(p.value, actual);
      assert(!denoise.params[field]?.sourceId && !denoise.params[field]?.sourceKey);
      same(value(denoise, field), actual);
      same(provenance.output.items[0][field], actual);
      same(provenance.template.lockedSettings[field], actual);
    }
    same(value(owner, 'repo_id'), { source: 'hub', value: plan.modelRepo });
    same(value(owner, 'revision'), plan.modelRevision);
    same(value(owner, 'model_type'), plan.modelType);
    assert.equal(provenance.template.lockedSettings.mode, 'text_to_image');
    assert.equal(provenance.template.lockedSettings.resourceMode, 'auto');
    assert(Array.isArray(provenance.inputs.items) && provenance.inputs.items.length === 0);
    return true;
  } catch {
    return false;
  }
}

/** A projected adapter identity is useful only with the existing strict native proof. */
export function observedWorkflowAutoLoraProofMatches(plan, provenance) {
  try {
    assert.equal(plan.source, OBSERVED_WORKFLOW_AUTO_LORA_SOURCE);
    const proof = validateAppliedAdapterProof(provenance, { required: true });
    assert.equal(proof.owners.length, 1);
    const application = proof.owners[0].application;
    assert.equal(application.status, 'complete');
    assert.equal(application.observation, 'activated');
    same(plan.resourceObservation.adapters, application.adapters);
    const graph = provenance.graph.canonicalGraph;
    const owner = graph.nodes.find((node) => node.key === proof.owners[0].nodeKey);
    assert.equal(owner.module + '.' + owner.action, ownerScope);
    same(value(owner, 'repo_id'), { source: 'hub', value: plan.modelRepo });
    same(value(owner, 'revision'), plan.modelRevision);
    same(value(owner, 'model_type'), plan.modelType);
    assert(
      provenance.models.items.some(
        (item) =>
          item.repoId === plan.modelRepo &&
          item.selectedRevision === plan.modelRevision &&
          item.modelRevision === `${plan.modelRepo}@${plan.modelRevision}`,
      ),
    );
    for (const control of plan.resourceObservation.controls) {
      const matching = graph.nodes.filter((node) => scope(node) === control.scope);
      assert.equal(matching.length, 1);
      for (const [key, field] of Object.entries(control.fields)) {
        const param = matching[0].params[key];
        assert(param && !param.sourceId && !param.sourceKey && Object.hasOwn(param, 'value'));
        same(field, param.value);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Recover only a fresh, literal, unquantized native image T2I owner. Unknown,
 * connected, composite, deferred, reused and runtime-patched cases stay held. */
function durableTextOwnerAuthoringMatches(snapshot, ownerId, owner) {
  const matches = [];
  const visit = (nodes, localIds = null) => {
    assert(Array.isArray(nodes));
    for (const node of nodes) {
      const data = node?.data;
      if (!data || data.blockProjectionOwnerId) continue;
      if (data.blockInstanceV2) {
        assert.equal(localIds, null);
        const instance = data.blockInstanceV2,
          children = instance.effectiveGraph?.nodes;
        assert(typeof instance.instanceId === 'string' && Array.isArray(children));
        const ids = new Map(
          children.map((child) => {
            assert.equal(typeof child.nodeId, 'string');
            return [
              child.nodeId,
              `block-v2-node:${instance.instanceId.length}:${instance.instanceId}:${child.nodeId.length}:${child.nodeId}`,
            ];
          }),
        );
        assert.equal(ids.size, children.length);
        visit(children, ids);
      } else if (scope(data) === ownerScope) matches.push({ id: localIds?.get(node.nodeId) ?? node.id, data });
    }
  };
  visit(snapshot.nodes);
  assert.equal(matches.length, 1);
  const { id, data } = matches[0],
    authoring = data.operationAuthoring,
    operation = authoring?.operation;
  assert.equal(id, ownerId);
  assert.equal(authoring?.schemaVersion, 1);
  assert.equal(operation?.pipelineClass, value(owner, 'model_type'));
  assert.equal(operation.task, 'text_to_image');
  assert.equal(operation.nodeKey, ownerScope);
  assert.equal(operation.binding?.pipelineClass, value(owner, 'model_type'));
  same(operation.binding?.values?.model_type, value(owner, 'model_type'));
  assert(!data.params?.model_type?.sourceId && !data.params?.model_type?.sourceKey);
  same(data.params?.model_type?.value, value(owner, 'model_type'));
  return true;
}

export function observedWorkflowAutoPlan(
  apiGraph,
  { executionReceipt: task, executedOutput: output, taskId, adapterProofContext, backendSource, backendContract } = {},
) {
  try {
    const hints = apiGraph.runtimeHints,
      snapshot = hints.workflowSnapshot,
      form = snapshot.studioForm;
    assert.equal(hints.resourceMode, 'auto');
    assert.equal(form.resourceMode, 'auto');
    const imageConditioned = ['edit_image', 'multi_image_reference_edit'].includes(form.mode);
    assert(form.mode === 'text_to_image' || imageConditioned);
    if (imageConditioned) assert.equal(task.resourceCandidateId, null);
    assert.equal(task.status, 'completed');
    assert.equal(task.attempt_index, 0);
    assert.equal(output.attemptIndex, 0);
    for (const [key, taskKey, outputKey] of [
      ['sid', 'sid', 'sid'],
      ['workflowTabId', 'workflow_tab_id', 'workflowTabId'],
      ['clientRunId', 'client_run_id', 'clientRunId'],
      ['runInputHash', 'run_input_hash', 'runInputHash'],
    ]) {
      const v = key === 'sid' ? apiGraph.sid : hints[key];
      assert.equal(typeof v, 'string');
      assert(v.length > 0);
      assert.equal(task[taskKey], v);
      assert.equal(output[outputKey], v);
    }
    assert.equal(typeof task.task_id, 'string');
    assert(task.task_id);
    if (taskId !== undefined) assert.equal(taskId, task.task_id);
    assert.equal(output.taskId, task.task_id);
    same(output.apiGraphSnapshot, apiGraph);
    same(task.workflow_snapshot, snapshot);
    same(output.formSnapshot, form);
    assert.equal(hints.workflowAutoPlan.schemaVersion, 1);
    assert(!Object.hasOwn(apiGraph, 'loops'));
    assert.equal(hints.workflowAutoPlan.graphHash, workerGraphHash(apiGraph));
    const entries = Object.entries(apiGraph.nodes),
      ids = new Set(entries.map(([id]) => id));
    const order = [...new Set(apiGraph.paths.flat())];
    same([...ids].sort(), [...order].sort());
    assert(entries.length <= (form.mode === 'edit_image' ? 8 : 7));
    const scopes = new Map();
    for (const [id, node] of entries) {
      const key = scope(node);
      assert(
        core.includes(key) ||
          (imageConditioned
            ? key === 'modules.ModularDiffusers.ImageEncode' ||
              key === 'modules.Image.Load' ||
              (form.mode === 'edit_image' && key === optional)
            : key === optional || key === descriptorScope),
      );
      assert(!scopes.has(key));
      scopes.set(key, { id, node });
      for (const param of Object.values(node.params))
        if (param.sourceId) {
          assert(ids.has(param.sourceId));
          assert(order.indexOf(param.sourceId) < order.indexOf(id));
        }
    }
    for (const key of core) assert(scopes.has(key));
    const { id: ownerId, node: owner } = scopes.get(ownerScope),
      { id: previewId } = scopes.get('modules.Image.Preview');
    const descriptor = scopes.get(descriptorScope);
    const legacy =
      !imageConditioned &&
      !descriptor &&
      !Object.hasOwn(owner.params, 'weight_format') &&
      !Object.hasOwn(owner.params, 'weight_loading_mode');
    assert.equal(output.nodeId, previewId);
    const receipt = output.resolvedExecutionInputs;
    assert.equal(receipt.source, 'backend-execution');
    assert.equal(receipt.taskId, task.task_id);
    assert.equal(receipt.attemptIndex, 0);
    assert.equal(receipt.nodeId, previewId);
    assert.equal(receipt.truncated, false);
    same(receipt.uncapturedNodeIds, []);
    assert.equal(receipt.nodes.length, entries.length);
    const rows = new Map(receipt.nodes.map((row) => [row.nodeId, row]));
    same([...rows.keys()].sort(), [...ids].sort());
    for (const [id, node] of entries) {
      assert.equal(rows.get(id).module, node.module);
      assert.equal(rows.get(id).action, node.action);
    }
    const routedImage = imageConditioned && scopes.has(optional);
    same(receipt.graphTasks, [
      {
        loaderId: ownerId,
        pipelineClass: value(owner, 'model_type'),
        task: imageConditioned ? (routedImage ? 'edit_image' : null) : 'text_to_image',
      },
    ]);
    assert(typeof form.modelType === 'string' && form.modelType.length > 0 && form.modelType.length <= 256);
    const legacyTextLabel = !imageConditioned && form.modelType !== value(owner, 'model_type');
    if (legacyTextLabel) assert(durableTextOwnerAuthoringMatches(snapshot, ownerId, owner));
    assert.equal(form.quantizationMode, 'none');
    assert.equal(form.trustRemoteCode, false);
    assert.equal(value(owner, 'trust_remote_code'), false);
    if (legacy) {
      assert(!Object.hasOwn(form, 'weightFormat'));
      assert.equal(task.resourceCandidateId, null);
      assert.equal(task.runtimePreparation.performed, false);
      assert.equal(task.runtimePreparation.residentRecipeReusable, false);
      assert.equal(backendSource?.fingerprint, task.runtimeFingerprint?.backendSource?.fingerprint);
      assert.match(backendSource?.fingerprint, /^sha256:backend-source-v1:[a-f0-9]{64}$/u);
      assert(Array.isArray(backendSource.files) && backendSource.files.length > 0);
      assert.equal(backendSource.gitCommit, task.runtimeFingerprint.backendSource.gitCommit);
      assert.equal(backendSource.files.length, task.runtimeFingerprint.backendSource.fileCount);
      const contracts = backendContract?.contracts?.filter((item) => item.key === ownerScope);
      assert.equal(contracts?.length, 1);
      assert.match(backendContract.fingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
      for (const key of ['weight_format', 'weight_loading_mode']) {
        assert(!Object.hasOwn(contracts[0].params, key));
        assert(!Object.hasOwn(rows.get(ownerId).fields, key));
        assert(!Object.hasOwn(rows.get(ownerId).omittedFields ?? {}, key));
        assert(!Object.hasOwn(task.runtimePreparation.workflowAuto.resolvedFields[ownerId], key));
      }
    } else assert.equal(value(owner, 'weight_format'), 'native');
    for (const key of [
      'repo_id',
      'revision',
      'model_type',
      'dtype',
      'device',
      'offload_mode',
      'auto_offload',
      'weight_loading_mode',
      'trust_remote_code',
      'weight_format',
    ])
      assert(!owner.params[key]?.sourceId && !owner.params[key]?.sourceKey);
    for (const key of [
      'quant_config',
      'unet',
      'vae',
      'controlnet',
      'text_encoders',
      'pipeline_components',
      'image_encoder',
    ]) {
      assert(!owner.params[key]?.sourceId && !owner.params[key]?.sourceKey);
      assert(value(owner, key) == null);
    }
    let adapters;
    if (descriptor) {
      const connection = owner.params.lora_list;
      assert.equal(connection?.sourceId, descriptor.id);
      assert.equal(connection.sourceKey, 'lora');
      assert(!Object.hasOwn(connection, 'value'));
      const node = descriptor.node;
      assert(Object.keys(node.params).every((key) => descriptorFields.has(key)));
      for (const param of Object.values(node.params)) assert(!param.sourceId && !param.sourceKey);
      assert(value(node, 'previous_loras') == null);
      assert.equal(value(node, 'scheduler_class'), '');
      assert.equal(value(node, 'scheduler_config'), '{}');
      assert.equal(receipt.schemaVersion, 1);
      assert.equal(receipt.appliedAdaptersStatus?.schemaVersion, 1);
      assert.equal(receipt.appliedAdaptersStatus.truncated, false);
      const row = rows.get(descriptor.id);
      assert.equal(row.fields.revision.source, 'literal');
      same(row.fields.revision.value, value(node, 'revision'));
      assert(!Object.hasOwn(row.omittedFields ?? {}, 'revision'));
      const proof = validateAppliedAdapterProof(adapterProofContext, { required: true });
      assert.equal(proof.owners.length, 1);
      const application = rows.get(ownerId).appliedAdapters;
      same(proof.owners[0].application, application);
      assert.equal(application.status, 'complete');
      assert.equal(application.observation, 'activated');
      assert.equal(application.adapters.length, 1);
      adapters = structuredClone(application.adapters);
      for (const [id, other] of entries)
        for (const [key, param] of Object.entries(other.params)) {
          if (param.sourceId === descriptor.id)
            assert(id === ownerId && key === 'lora_list' && param.sourceKey === 'lora');
        }
    } else {
      assert(!owner.params.lora_list?.sourceId && !owner.params.lora_list?.sourceKey);
      assert(value(owner, 'lora_list') == null);
    }
    const repo = value(owner, 'repo_id');
    assert.equal(repo.source, 'hub');
    assert.equal(typeof repo.value, 'string');
    assert(repo.value);
    const revision = value(owner, 'revision');
    assert.match(revision, /^[0-9a-f]{40}$/u);
    if (adapters)
      assert(
        adapterProofContext.models.items.some(
          (item) =>
            item.repoId === repo.value &&
            item.selectedRevision === revision &&
            item.modelRevision === `${repo.value}@${revision}`,
        ),
      );
    const trace = rows.get(ownerId).fields;
    for (const key of [
      'repo_id',
      'revision',
      'model_type',
      'dtype',
      'device',
      'offload_mode',
      'auto_offload',
      'weight_loading_mode',
      'attention_backend',
      'vae_slicing',
      'vae_tiling',
    ]) {
      if (legacy && key === 'weight_loading_mode') continue;
      assert.equal(trace[key].source, 'literal');
      same(trace[key].value, key === 'repo_id' ? repo.value : value(owner, key));
    }
    assert.equal(trace.quant_config.source, 'literal');
    assert.equal(trace.quant_config.value, null);
    assert(['bfloat16', 'float16', 'float32'].includes(value(owner, 'dtype')));
    assert.equal(typeof value(owner, 'auto_offload'), 'boolean');
    assert.equal(typeof value(owner, 'device'), 'string');
    assert(['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'].includes(value(owner, 'offload_mode')));
    if (!legacy) assert(['cpu', 'cuda'].includes(value(owner, 'weight_loading_mode')));
    const prep = task.runtimePreparation;
    assert.equal(prep.resourceMode, 'auto');
    const auto = prep.workflowAuto;
    assert.equal(auto.strategy, 'dependency_order_retained_owners');
    assert.equal(auto.schedule, null);
    assert.equal(auto.cachePreparation, null);
    for (const key of ['reusedOwnerIds', 'preparedDataNodes', 'appliedUpdates', 'releases']) same(auto[key], []);
    assert(auto.resolvedFields[ownerId]);
    for (const key of [
      'repo_id',
      'revision',
      'model_type',
      'dtype',
      'device',
      'offload_mode',
      'auto_offload',
      'weight_loading_mode',
      'weight_format',
      'attention_backend',
      'vae_slicing',
      'vae_tiling',
    ].filter((key) => !legacy || !['weight_loading_mode', 'weight_format'].includes(key)))
      assert(Object.hasOwn(auto.resolvedFields[ownerId], key));
    const denoiseOwner = scopes.get('modules.ModularDiffusers.Denoise').id;
    for (const key of ['width', 'height']) assert(Object.hasOwn(auto.resolvedFields[denoiseOwner], key));
    const controls = [];
    let connectedDecoderRoute = false;
    let legacyGuiderConfiguration;
    if (legacy && scopes.has(optional)) {
      const guider = scopes.get(optional),
        fields = rows.get(guider.id).fields;
      legacyGuiderConfiguration = {};
      for (const key of 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'.split(
        ' ',
      )) {
        assert(!guider.node.params[key]?.sourceId && !guider.node.params[key]?.sourceKey);
        assert.equal(fields[key]?.source, 'literal');
        assert(!Object.hasOwn(rows.get(guider.id).omittedFields ?? {}, key));
        same(fields[key].value, value(guider.node, key));
        legacyGuiderConfiguration[key] = fields[key].value;
      }
      const layers = guider.node.params.layers_config;
      assert(!layers?.sourceId && !layers?.sourceKey);
      assert(layers?.value == null);
    }
    for (const [id, fields] of Object.entries(auto.resolvedFields)) {
      const node = apiGraph.nodes[id];
      assert(node);
      const kind = scope(node);
      if (!imageConditioned && kind === 'modules.ModularDiffusers.DecodeLatents') {
        same(Object.keys(fields).sort(), ['height', 'width']);
        for (const key of ['width', 'height']) {
          const param = node.params[key],
            captured = rows.get(id).fields[key];
          assert.equal(param.sourceId, denoiseOwner);
          assert.equal(param.sourceKey, 'out_' + key);
          if (Object.hasOwn(param, 'value')) same(param.value, fields[key]);
          assert.equal(captured.source, 'connected');
          assert.equal(captured.sourceNodeId, denoiseOwner);
          assert.equal(captured.sourcePortId, 'out_' + key);
          same(captured.value, fields[key]);
          same(fields[key], value(apiGraph.nodes[denoiseOwner], key));
          assert(!Object.hasOwn(rows.get(id).omittedFields ?? {}, key));
        }
        connectedDecoderRoute = true;
        continue;
      }
      validateControlFields(kind, fields, imageConditioned);
      for (const [key, v] of Object.entries(fields)) {
        assert(!node.params[key]?.sourceId && !node.params[key]?.sourceKey);
        same(v, value(node, key));
        const captured = rows.get(id).fields[key];
        if (legacy) {
          assert(captured);
          assert(!Object.hasOwn(rows.get(id).omittedFields ?? {}, key));
        }
        if (kind === encodeScope) {
          assert(captured);
          assert(!Object.hasOwn(rows.get(id).omittedFields ?? {}, key));
          same(v, form.maxSequenceLength);
        }
        if (captured) {
          assert.equal(captured.source, 'literal');
          same(captured.value, key === 'repo_id' ? repo.value : v);
        }
      }
      controls.push({ scope: kind, fields: structuredClone(fields) });
    }
    controls.sort((a, b) => a.scope.localeCompare(b.scope));
    const denoise = scopes.get('modules.ModularDiffusers.Denoise'),
      d = rows.get(denoise.id).fields;
    for (const key of ['width', 'height', 'seed', 'num_inference_steps', 'guidance_scale']) {
      assert.equal(d[key].source, 'literal');
      same(d[key].value, value(denoise.node, key));
    }
    for (const key of ['width', 'height'])
      assert(Number.isInteger(d[key].value) && d[key].value > 0 && d[key].value <= 32768);
    const encoded = scopes.get('modules.ModularDiffusers.EncodePrompt');
    const exposesNegativePrompt = Object.hasOwn(encoded.node.params, 'negative_prompt');
    if (!exposesNegativePrompt) {
      assert.equal(form.negativePrompt, '');
      assert(!Object.hasOwn(rows.get(encoded.id).fields, 'negative_prompt'));
      assert(!Object.hasOwn(rows.get(encoded.id).omittedFields ?? {}, 'negative_prompt'));
    }
    for (const [key, formKey] of !exposesNegativePrompt
      ? [['prompt', 'prompt']]
      : [
          ['prompt', 'prompt'],
          ['negative_prompt', 'negativePrompt'],
        ]) {
      assert.equal(rows.get(encoded.id).fields[key].source, 'literal');
      same(rows.get(encoded.id).fields[key].value, value(encoded.node, key));
      same(value(encoded.node, key), form[formKey]);
    }
    const references = imageConditioned ? observedImageReferences(apiGraph, receipt, form) : null;
    const plan = {
      source: legacy
        ? OBSERVED_WORKFLOW_AUTO_LEGACY_SOURCE
        : imageConditioned
          ? OBSERVED_WORKFLOW_AUTO_IMAGE_SOURCE
          : adapters
            ? OBSERVED_WORKFLOW_AUTO_LORA_SOURCE
            : OBSERVED_WORKFLOW_AUTO_SOURCE,
      modelType: value(owner, 'model_type'),
      pipelineClass: value(owner, 'model_type'),
      modelRepo: repo.value,
      resolvedModelRepo: repo.value,
      resolvedArtifact: repo.value,
      modelRevision: revision,
      task: imageConditioned ? form.mode : 'text_to_image',
      resourceMode: 'auto',
      resolvedResourceMode: 'auto',
      dtype: value(owner, 'dtype'),
      device: value(owner, 'device'),
      offloadMode: value(owner, 'offload_mode'),
      autoOffload: value(owner, 'auto_offload'),
      ...(!legacy ? { weightLoadingMode: value(owner, 'weight_loading_mode') } : {}),
      attentionBackend: value(owner, 'attention_backend'),
      vaeSlicing: value(owner, 'vae_slicing'),
      vaeTiling: value(owner, 'vae_tiling'),
      quantizationMode: 'none',
      quantizedComponents: [],
      ...(auto.resolvedFields[encoded.id]
        ? { maxSequenceLength: auto.resolvedFields[encoded.id].max_sequence_length }
        : {}),
    };
    const observation = {
      schemaVersion: 1,
      modelType: plan.modelType,
      repo: repo.value,
      revision,
      task: plan.task,
      dtype: plan.dtype,
      device: plan.device,
      offloadMode: plan.offloadMode,
      autoOffload: plan.autoOffload,
      ...(!legacy ? { weightLoadingMode: plan.weightLoadingMode } : {}),
      attentionBackend: plan.attentionBackend,
      vaeSlicing: plan.vaeSlicing,
      vaeTiling: plan.vaeTiling,
      geometry: { width: d.width.value, height: d.height.value },
      strategy: auto.strategy,
      controls,
      ...(connectedDecoderRoute ? { decoderGeometryRoute: 'denoiser_dimensions' } : {}),
      ...(legacy
        ? {
            absentLoaderControls: ['weight_format', 'weight_loading_mode'],
            backendSourceFingerprint: backendSource.fingerprint,
            backendContractFingerprint: backendContract.fingerprint,
            ...(legacyGuiderConfiguration ? { guiderConfiguration: legacyGuiderConfiguration } : {}),
          }
        : {}),
      ...(imageConditioned
        ? {
            references,
            formModelType: form.modelType,
            reportedGraphTask: receipt.graphTasks[0].task,
            workflowId: 'image_conditioned',
          }
        : {}),
      ...(routedImage ? { imageRoute: 'native_state' } : {}),
      ...(imageConditioned && form.mode === 'edit_image'
        ? { requestedOffloadMode: form.offloadMode, requestedAutoOffload: form.autoOffload }
        : {}),
      ...(legacyTextLabel ? { formModelType: form.modelType } : {}),
      ...(adapters ? { adapters } : {}),
    };
    const result = {
      ...plan,
      resourceObservation: observation,
      observedResourceCandidateId: plan.source + ':' + canonicalJsonHash(observation),
    };
    if (imageConditioned || legacy) assert(observedWorkflowAutoResourceId(result));
    return result;
  } catch {
    return null;
  }
}

// Explicit one- and two-reference paths. These are declarations and receipts,
// never executable suppliers or a fallback task classifier in the application.
function imageConditionedRoles(entries, referenceCount = 2, routed = false) {
  assert(referenceCount === 1 || referenceCount === 2);
  if (routed) assert.equal(referenceCount, 1);
  const roles = new Map(entries.map(([id, node]) => [scope(node), { id, node }]));
  assert.equal(entries.length, routed ? 8 : 7);
  assert.equal(roles.size, routed ? 8 : 7);
  const get = (kind) => {
    const role = roles.get(kind);
    assert(role);
    return role;
  };
  const owner = get(ownerScope),
    load = get('modules.Image.Load'),
    image = get('modules.ModularDiffusers.ImageEncode'),
    encode = get('modules.ModularDiffusers.EncodePrompt'),
    denoise = get('modules.ModularDiffusers.Denoise'),
    decode = get('modules.ModularDiffusers.DecodeLatents'),
    preview = get('modules.Image.Preview');
  const wires = new Map([
    [owner.id, {}],
    [load.id, {}],
    [image.id, { image: [load.id, 'image'], vae: [owner.id, 'vae_out'] }],
    [encode.id, { text_encoders: [owner.id, 'text_encoders'] }],
    [
      denoise.id,
      {
        unet: [owner.id, 'unet_out'],
        scheduler: [owner.id, 'scheduler'],
        embeddings: [encode.id, 'embeddings'],
        image_latents: [image.id, 'image_latents'],
      },
    ],
    [decode.id, { vae: [owner.id, 'vae_out'], latents: [denoise.id, 'latents'] }],
    [preview.id, { image: [decode.id, 'images'] }],
  ]);
  const fields = new Map([
    [
      owner.id,
      new Set([
        ...ownerFields,
        'trust_remote_code',
        'quant_config',
        'unet',
        'vae',
        'controlnet',
        'lora_list',
        'text_encoders',
        'pipeline_components',
        'image_encoder',
        'modiff_pipeline_identity',
        'refresh_pipeline_identity_button',
      ]),
    ],
    [load.id, new Set(['file', 'alpha_channel', 'label'])],
    [image.id, new Set(['image', 'vae', 'seed', 'encode_summary'])],
    [encode.id, new Set(['text_encoders', 'prompt', 'prompt_input', 'guider'])],
    [
      denoise.id,
      new Set([
        'unet',
        'scheduler',
        'embeddings',
        'image_latents',
        'width',
        'height',
        'seed',
        'num_inference_steps',
        'guidance_scale',
      ]),
    ],
    [decode.id, new Set(['vae', 'latents'])],
    [preview.id, new Set(['image', 'vae', 'device', 'preview', 'export'])],
  ]);
  const guider = routed ? get(optional) : null;
  if (routed) {
    wires.set(guider.id, {});
    Object.assign(wires.get(encode.id), { guider: [guider.id, 'guider_out'], image: [load.id, 'image'] });
    Object.assign(wires.get(denoise.id), {
      guider: [guider.id, 'guider_out'],
      route_state_in: [image.id, 'route_state_out'],
    });
    Object.assign(wires.get(decode.id), { route_state_in: [denoise.id, 'route_state_out'] });
    for (const key of ['mask_image', 'padding_mask_crop', 'inpaint_compatibility']) fields.get(image.id).add(key);
    for (const key of ['image', 'negative_prompt']) fields.get(encode.id).add(key);
    for (const key of ['guider', 'strength', 'route_state_in']) fields.get(denoise.id).add(key);
    fields.get(decode.id).add('route_state_in');
    fields.set(
      guider.id,
      new Set(
        'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop layers_config'.split(
          ' ',
        ),
      ),
    );
    validateRoutedGuider(guider.node, owner.node);
    for (const key of ['mask_image', 'padding_mask_crop']) assert(value(image.node, key) == null);
    assert.equal(value(image.node, 'inpaint_compatibility'), 'native');
  }
  for (const [id, node] of entries) {
    const expected = wires.get(id);
    for (const [field, param] of Object.entries(node.params)) {
      assert(fields.get(id).has(field));
      if (param.sourceId || param.sourceKey) {
        const presentation =
          !param.sourceId &&
          ((id === image.id &&
            field === 'encode_summary' &&
            param.display === 'ui_text' &&
            param.sourceKey === 'encode_summary_data') ||
            (id === preview.id && field === 'preview' && param.display === 'ui_image' && param.sourceKey === 'output'));
        assert(Object.hasOwn(expected, field) || presentation);
      }
    }
    for (const [field, [producer, port]] of Object.entries(expected)) {
      assert.equal(node.params[field]?.sourceId, producer);
      assert.equal(node.params[field]?.sourceKey, port);
      assert(!Object.hasOwn(node.params[field], 'value'));
    }
  }
  for (const [role, field] of [[encode, 'prompt_input'], ...(routed ? [] : [[encode, 'guider']]), [preview, 'vae']])
    assert(value(role.node, field) == null);
  assert.equal(value(owner.node, 'workflow_id'), 'image_conditioned');
  assert.equal(value(load.node, 'alpha_channel'), 'ignore');
  const files = value(load.node, 'file');
  assert(Array.isArray(files) && files.length === referenceCount);
  assert(files.every((file) => typeof file === 'string' && file.length > 0 && file.length <= 16384));
  if (referenceCount === 2) assert.notEqual(files[0], files[1]);
  return { owner, load, image, encode, denoise, decode, preview, files, guider };
}

function validateRoutedGuider(node, owner) {
  for (const param of Object.values(node.params)) assert(!param.sourceId && !param.sourceKey);
  for (const [key, expected] of Object.entries({
    model_type: value(owner, 'model_type'),
    guider: 'ClassifierFreeGuidance',
    guidance_rescale: 0,
    use_original_formulation: false,
    enabled: true,
    start: 0,
    stop: 1,
  }))
    same(value(node, key), expected);
  assert(value(node, 'layers_config') == null);
  assert(Number.isFinite(value(node, 'guidance_scale')) && value(node, 'guidance_scale') > 0);
}

function observedImageReferences(apiGraph, receipt, form) {
  assert.equal(apiGraph.paths.length, 1);
  const routed = Object.values(apiGraph.nodes).some((node) => scope(node) === optional);
  assert.equal(apiGraph.paths[0].length, routed ? 8 : 7);
  assert.equal(new Set(apiGraph.paths[0]).size, routed ? 8 : 7);
  const referenceCount = form.mode === 'edit_image' ? 1 : 2;
  const roles = imageConditionedRoles(Object.entries(apiGraph.nodes), referenceCount, routed);
  const { owner, load, image, denoise } = roles;
  for (const field of ['ambiguousFields', 'unavailableFields'])
    if (receipt[field] !== undefined) same(receipt[field], []);
  if (routed) same(value(roles.encode.node, 'negative_prompt'), form.negativePrompt);
  else assert.equal(form.negativePrompt, '');
  for (const [key, formKey] of [
    ['dtype', 'dtype'],
    ['device', 'device'],
    ...(referenceCount === 2
      ? [
          ['offload_mode', 'offloadMode'],
          ['auto_offload', 'autoOffload'],
        ]
      : []),
  ])
    same(value(owner.node, key), form[formKey]);
  for (const [key, formKey] of [
    ['width', 'width'],
    ['height', 'height'],
    ['seed', 'seed'],
    ['num_inference_steps', 'steps'],
    ['guidance_scale', 'guidanceScale'],
  ])
    same(value(denoise.node, key), form[formKey]);
  same(value(image.node, 'seed'), form.seed);
  const rows = new Map(receipt.nodes.map((row) => [row.nodeId, row]));
  if (routed)
    for (const key of 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'.split(
      ' ',
    )) {
      const row = rows.get(roles.guider.id),
        field = row.fields[key];
      assert.equal(field.source, 'literal');
      same(field.value, value(roles.guider.node, key));
      assert(!Object.hasOwn(row.omittedFields ?? {}, key));
    }
  const imageRow = rows.get(image.id);
  assert.equal(imageRow.fields.seed.source, 'literal');
  same(imageRow.fields.seed.value, form.seed);
  assert(!Object.hasOwn(imageRow.omittedFields ?? {}, 'seed'));
  assert.equal(receipt.appliedAdaptersStatus?.schemaVersion, 1);
  assert.equal(receipt.appliedAdaptersStatus.truncated, false);
  const application = validateAppliedAdapterSection(rows.get(owner.id).appliedAdapters);
  assert.equal(application.status, 'complete');
  assert.equal(application.observation, 'activated');
  same(application.adapters, []);
  const read = (key) => {
    const row = rows.get(load.id);
    assert.equal(row.fields[key].source, 'literal');
    assert(!Object.hasOwn(row.omittedFields ?? {}, key));
    return row.fields[key].value;
  };
  assert.equal(read('alpha_channel'), 'ignore');
  const hashes = read('source_hashes'),
    widths = read('source_widths'),
    heights = read('source_heights'),
    modes = read('source_modes');
  for (const values of [hashes, widths, heights, modes])
    assert(Array.isArray(values) && values.length === referenceCount);
  if (receipt.summary) {
    for (const [key, expected] of Object.entries({
      imageAlphaChannel: 'ignore',
      imageSourceHashes: hashes,
      imageSourceWidths: widths,
      imageSourceHeights: heights,
      imageSourceModes: modes,
    }))
      same(receipt.summary[key], expected);
  }
  return hashes.map((hash, index) => {
    assert.match(hash, /^[a-f0-9]{64}$/u);
    for (const size of [widths[index], heights[index]]) assert(Number.isInteger(size) && size > 0 && size <= 32768);
    assert.equal(modes[index], 'RGB');
    return { role: `referenceImages[${index}]`, contentHash: 'sha256:bytes:' + hash };
  });
}

/** Rehashed observations still need the original canonical graph/model/inputs.
 * The legacy form label and null graph-task classification remain explicit;
 * neither is substituted for the actual executed model owner. */
export function observedWorkflowAutoImageProofMatches(plan, provenance) {
  try {
    assert.equal(plan.source, OBSERVED_WORKFLOW_AUTO_IMAGE_SOURCE);
    assert(observedWorkflowAutoResourceId(plan));
    const referenceCount = plan.task === 'edit_image' ? 1 : 2;
    const roles = imageConditionedRoles(
      provenance.graph.canonicalGraph.nodes.map((node) => [node.key, node]),
      referenceCount,
      plan.resourceObservation.imageRoute === 'native_state',
    );
    const observation = plan.resourceObservation;
    const { owner, denoise } = roles;
    assert.equal(provenance.models.items.length, 1);
    const model = provenance.models.items[0];
    assert.equal(model.repoId, plan.modelRepo);
    assert.equal(model.selectedRevision, plan.modelRevision);
    assert.equal(model.modelRevision, `${plan.modelRepo}@${plan.modelRevision}`);
    same(value(owner.node, 'repo_id'), { source: 'hub', value: plan.modelRepo });
    same(value(owner.node, 'revision'), plan.modelRevision);
    same(value(owner.node, 'model_type'), plan.modelType);
    same(value(owner.node, 'trust_remote_code'), false);
    same(value(owner.node, 'weight_format'), 'native');
    for (const key of [
      'quant_config',
      'unet',
      'vae',
      'controlnet',
      'lora_list',
      'text_encoders',
      'pipeline_components',
      'image_encoder',
    ])
      assert(value(owner.node, key) == null);
    const applied = validateAppliedAdapterProof(provenance, { required: true });
    assert.equal(applied.owners.length, 1);
    assert.equal(applied.owners[0].nodeKey, owner.id);
    same(applied.owners[0].application.adapters, []);
    assert.equal(applied.owners[0].application.observation, 'activated');
    for (const control of observation.controls) {
      const node = provenance.graph.canonicalGraph.nodes.find((node) => scope(node) === control.scope);
      assert(node);
      for (const [field, observed] of Object.entries(control.fields)) {
        assert(!node.params[field]?.sourceId && !node.params[field]?.sourceKey);
        same(value(node, field), observed);
      }
    }
    const form = provenance.template.lockedSettings;
    assert.equal(form.mode, plan.task);
    assert.equal(form.modelType, observation.formModelType);
    assert.equal(form.resourceMode, 'auto');
    assert.equal(form.quantizationMode, 'none');
    // Device and remote-code safety are bound by the immutable owner above;
    // they are not part of the portable template's locked-settings projection.
    for (const [key, formKey] of [
      ['dtype', 'dtype'],
      ...(referenceCount === 2
        ? [
            ['offload_mode', 'offloadMode'],
            ['auto_offload', 'autoOffload'],
          ]
        : []),
    ])
      same(value(owner.node, key), form[formKey]);
    if (referenceCount === 1) {
      same(form.offloadMode, observation.requestedOffloadMode);
      same(form.autoOffload, observation.requestedAutoOffload);
    }
    for (const [key, formKey] of [
      ['width', 'width'],
      ['height', 'height'],
      ['seed', 'seed'],
      ['num_inference_steps', 'steps'],
      ['guidance_scale', 'guidanceScale'],
    ])
      same(value(denoise.node, key), form[formKey]);
    same(value(roles.image.node, 'seed'), form.seed);
    same(value(roles.encode.node, 'prompt'), form.prompt);
    if (roles.guider) same(value(roles.encode.node, 'negative_prompt'), form.negativePrompt);
    else assert.equal(form.negativePrompt, '');
    assert.equal(provenance.inputs.items.length, referenceCount);
    for (const [index, input] of provenance.inputs.items.entries()) {
      assert.equal(input.role, `referenceImages[${index}]`);
      assert.equal(input.path, roles.files[index]);
      assert.equal(input.contentHash, observation.references[index].contentHash);
      assert(Number.isSafeInteger(input.byteSize) && input.byteSize > 0);
    }
    assert.equal(provenance.output.items.length, 1);
    for (const key of ['width', 'height']) same(provenance.output.items[0][key], observation.geometry[key]);
    return true;
  } catch {
    return false;
  }
}
