// Native receipt vocabulary only. This module never executes or admits a model.
import assert from 'node:assert/strict';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import { assertFiniteObservedJson, workerGraphHash } from './observed-workflow-auto-resource.mjs';
export const OBSERVED_WORKFLOW_AUTO_MASKED_IMAGE_SOURCE = 'observed-workflow-auto-masked-image-resource-v1';
const same = (a, b) => assert.deepEqual(stableJsonValue(a), stableJsonValue(b));
const prefix = 'modules.ModularDiffusers.';
function project(entries, paths, form, artifacts) {
  same(form.mode, 'inpaint');
  same(form.resourceMode, 'auto');
  same(form.dtype, 'bfloat16');
  same(form.quantizationMode, 'none');
  same(form.randomSeed, false);
  if (Object.hasOwn(form, 'trustRemoteCode')) same(form.trustRemoteCode, false);
  for (const k of ['width', 'height', 'steps', 'maxSequenceLength'])
    assert(Number.isSafeInteger(form[k]) && form[k] > 0 && form[k] <= 4096);
  assert(Number.isSafeInteger(form.seed) && form.seed >= 0 && form.seed < 2 ** 32);
  for (const [k, max] of [
    ['guidanceScale', 100],
    ['strength', 1],
  ])
    assert(Number.isFinite(form[k]) && form[k] >= 0 && form[k] <= max);
  same(entries.length, 9);
  same(paths.length, 1);
  same(new Set(paths[0]).size, 9);
  same([...paths[0]].sort(), entries.map(([id]) => id).sort());
  const byId = new Map(entries.map(([id, node]) => [id, { id, node }]));
  same(byId.size, 9);
  const get = (scope) => {
    const rows = entries.filter(([, n]) => n.module + '.' + n.action === scope);
    same(rows.length, 1);
    return byId.get(rows[0][0]);
  };
  const owner = get(prefix + 'ModelsLoader'),
    guide = get(prefix + 'Guider'),
    encode = get(prefix + 'EncodePrompt'),
    image = get(prefix + 'ImageEncode'),
    denoise = get(prefix + 'Denoise'),
    decode = get(prefix + 'DecodeLatents'),
    preview = get('modules.Image.Preview');
  const source = byId.get(image.node.params.image?.sourceId),
    mask = byId.get(image.node.params.mask_image?.sourceId);
  assert(source && mask && source.id !== mask.id);
  for (const r of [source, mask]) {
    same(r.node.module, 'modules.Image');
    same(r.node.action, 'Load');
  }
  same(new Set([owner, guide, encode, image, denoise, decode, preview, source, mask].map((r) => r.id)).size, 9);
  const value = (r, k) => {
    const p = r.node.params[k];
    assert(p && !p.sourceId && !p.sourceKey);
    return p.value;
  };
  const literal = (r, k, v) => same(value(r, k), v);
  const edges = [
    [image, 'vae', owner, 'vae_out'],
    [image, 'image', source, 'image'],
    [image, 'mask_image', mask, 'image'],
    [encode, 'text_encoders', owner, 'text_encoders'],
    [encode, 'guider', guide, 'guider_out'],
    [encode, 'image', source, 'image'],
    [denoise, 'unet', owner, 'unet_out'],
    [denoise, 'scheduler', owner, 'scheduler'],
    [denoise, 'embeddings', encode, 'embeddings'],
    [denoise, 'image_latents', image, 'image_latents'],
    [denoise, 'route_state_in', image, 'route_state_out'],
    [denoise, 'guider', guide, 'guider_out'],
    [decode, 'vae', owner, 'vae_out'],
    [decode, 'latents', denoise, 'latents'],
    [decode, 'route_state_in', denoise, 'route_state_out'],
    [preview, 'image', decode, 'images'],
  ];
  const wires = new Set();
  for (const [t, k, s, port] of edges) {
    const p = t.node.params[k];
    same({ id: p?.sourceId, port: p?.sourceKey }, { id: s.id, port });
    assert(!Object.hasOwn(p, 'value'));
    assert(paths[0].indexOf(s.id) < paths[0].indexOf(t.id));
    wires.add(t.id + ':' + k);
  }
  const fields = new Map(
    [
      [
        owner.id,
        'model_type repo_id reviewed_variant revision dtype device attention_backend vae_slicing vae_tiling inpaint_compatibility trust_remote_code workflow_id modiff_pipeline_identity refresh_pipeline_identity_button auto_offload offload_mode weight_loading_mode weight_format unet vae controlnet lora_list quant_config',
      ],
      [
        guide.id,
        'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop layers_config',
      ],
      [encode.id, 'text_encoders prompt_input guider prompt negative_prompt image'],
      [image.id, 'vae encode_summary image mask_image padding_mask_crop seed inpaint_compatibility'],
      [
        denoise.id,
        'unet embeddings width height seed num_inference_steps guidance_scale image_latents strength route_state_in guider scheduler',
      ],
      [decode.id, 'vae latents route_state_in'],
      [preview.id, 'vae device image preview export'],
      [source.id, 'label file alpha_channel'],
      [mask.id, 'label file alpha_channel'],
    ].map(([id, keys]) => [id, new Set(keys.split(' '))]),
  );
  for (const [id, n] of entries)
    for (const [k, p] of Object.entries(n.params)) {
      assert(fields.get(id).has(k), 'Unexpected parameter ' + k);
      if (p.sourceId) assert(wires.has(id + ':' + k));
      else if (p.sourceKey)
        assert(
          (id === preview.id && k === 'preview' && p.sourceKey === 'output' && p.display === 'ui_image') ||
            (id === image.id &&
              k === 'encode_summary' &&
              p.sourceKey === 'encode_summary_data' &&
              p.display === 'ui_text'),
        );
    }
  const repo = value(owner, 'repo_id');
  same(repo.source, 'hub');
  assert.match(repo.value, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
  const revision = value(owner, 'revision');
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const modelType = value(owner, 'model_type');
  assert.match(modelType, /^[A-Za-z]\w*ModularPipeline$/u);
  same(modelType, form.modelType);
  for (const [k, v] of Object.entries({
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
  }))
    literal(owner, k, v);
  for (const k of ['unet', 'vae', 'controlnet', 'lora_list', 'quant_config']) assert(value(owner, k) == null);
  for (const [r, k] of [
    [guide, 'layers_config'],
    [encode, 'prompt_input'],
    [image, 'padding_mask_crop'],
    [preview, 'vae'],
  ]) {
    const p = r.node.params[k];
    assert(!p?.sourceId && !p?.sourceKey && p?.value == null);
  }
  literal(image, 'inpaint_compatibility', 'whole_v1');
  literal(image, 'seed', form.seed);
  literal(preview, 'device', 'cuda:0');
  literal(source, 'alpha_channel', 'ignore');
  literal(mask, 'alpha_channel', 'remove alpha');
  literal(encode, 'prompt', form.prompt);
  literal(encode, 'negative_prompt', form.negativePrompt);
  for (const [k, f] of [
    ['width', 'width'],
    ['height', 'height'],
    ['seed', 'seed'],
    ['num_inference_steps', 'steps'],
    ['guidance_scale', 'guidanceScale'],
    ['strength', 'strength'],
  ])
    literal(denoise, k, form[f]);
  for (const [k, v] of Object.entries({
    model_type: modelType,
    guider: 'ClassifierFreeGuidance',
    guidance_scale: form.guidanceScale,
    guidance_rescale: 0,
    use_original_formulation: false,
    enabled: true,
    start: 0,
    stop: 1,
  }))
    literal(guide, k, v);
  const sourceFiles = value(source, 'file');
  assert(Array.isArray(sourceFiles) && sourceFiles.length === 1);
  const maskFile = value(mask, 'file');
  assert(typeof maskFile === 'string' && maskFile);
  if (form.referenceImages !== undefined) same(form.referenceImages, sourceFiles);
  if (form.maskImage !== undefined) same(form.maskImage, maskFile);
  same(artifacts.length, 2);
  const inputs = [
    [source, 'referenceImages[0]', sourceFiles[0]],
    [mask, 'maskImage', maskFile],
  ].map(([r, role, path]) => {
    assert(typeof path === 'string' && path.length > 0 && path.length <= 16384);
    const matches = artifacts.filter((a) => a.role === role);
    same(matches.length, 1);
    same(matches[0].path, path);
    assert.match(matches[0].contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
    assert(Number.isSafeInteger(matches[0].byteSize) && matches[0].byteSize > 0);
    return { role, contentHash: matches[0].contentHash, byteSize: matches[0].byteSize };
  });
  assert(sourceFiles[0] !== maskFile);
  const roles = new Map([
    [owner.id, 'owner'],
    [guide.id, 'guide'],
    [encode.id, 'encode'],
    [image.id, 'image'],
    [denoise.id, 'denoise'],
    [decode.id, 'decode'],
    [preview.id, 'preview'],
    [source.id, 'source'],
    [mask.id, 'mask'],
  ]);
  const projection = paths[0].map((id) => ({
    role: roles.get(id),
    module: byId.get(id).node.module,
    action: byId.get(id).node.action,
    params: Object.fromEntries(
      Object.entries(byId.get(id).node.params)
        .filter(([k, p]) => !['label', 'preview', 'export'].includes(k) && !p.display?.startsWith('ui_'))
        .map(([k, p]) => [
          k,
          p.sourceId
            ? { supplier: roles.get(p.sourceId), port: p.sourceKey }
            : { value: k === 'file' ? [roles.get(id)] : (p.value ?? null) },
        ]),
    ),
  }));
  const formKeys =
    'mode modelType resourceMode dtype quantizationMode randomSeed seed width height steps guidanceScale prompt negativePrompt maxSequenceLength offloadMode autoOffload strength'.split(
      ' ',
    );
  assert(['none', 'model_cpu', 'group_cpu'].includes(form.offloadMode));
  assert(typeof form.autoOffload === 'boolean');
  const plan = {
    source: OBSERVED_WORKFLOW_AUTO_MASKED_IMAGE_SOURCE,
    modelType,
    pipelineClass: modelType,
    modelRepo: repo.value,
    modelRevision: revision,
    dtype: 'bfloat16',
    device: 'cuda:0',
    offloadMode: 'group_cpu',
    autoOffload: true,
    resourceMode: 'auto',
    resolvedResourceMode: 'auto',
    quantizationMode: 'none',
    quantizedComponents: [],
    resourceObservation: {
      schemaVersion: 1,
      graphControlsHash: canonicalJsonHash(projection),
      formControlsHash: canonicalJsonHash(Object.fromEntries(formKeys.map((k) => [k, form[k]]))),
      inputs,
      geometry: { width: form.width, height: form.height },
      steps: form.steps,
      seed: form.seed,
      guidanceScale: form.guidanceScale,
      strength: form.strength,
      requestedOffloadMode: form.offloadMode,
      requestedAutoOffload: form.autoOffload,
      compatibility: 'whole_v1',
      compatibilityBasis: 'original_graph_and_auto_resolution',
      nativeGraphTask: 'inpaint',
      unusedFormMaxSequenceLength: form.maxSequenceLength,
    },
  };
  return { plan, owner, guide, encode, image, denoise, decode, preview, source, mask, value };
}
export function observedWorkflowAutoMaskedImageResourceId(plan) {
  try {
    assertFiniteObservedJson(plan);
    assert(Buffer.byteLength(JSON.stringify(plan)) <= 16384);
    same(
      Object.keys(plan).sort(),
      'source modelType pipelineClass modelRepo modelRevision dtype device offloadMode autoOffload resourceMode resolvedResourceMode quantizationMode quantizedComponents resourceObservation'
        .split(' ')
        .sort(),
    );
    same(plan.source, OBSERVED_WORKFLOW_AUTO_MASKED_IMAGE_SOURCE);
    same(plan.pipelineClass, plan.modelType);
    assert.match(plan.modelType, /^[A-Za-z]\w*ModularPipeline$/u);
    assert.match(plan.modelRepo, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
    assert.match(plan.modelRevision, /^[a-f0-9]{40}$/u);
    for (const [k, v] of Object.entries({
      dtype: 'bfloat16',
      device: 'cuda:0',
      offloadMode: 'group_cpu',
      autoOffload: true,
      resourceMode: 'auto',
      resolvedResourceMode: 'auto',
      quantizationMode: 'none',
      quantizedComponents: [],
    }))
      same(plan[k], v);
    const o = plan.resourceObservation;
    same(
      Object.keys(o).sort(),
      'schemaVersion graphControlsHash formControlsHash inputs geometry steps seed guidanceScale strength requestedOffloadMode requestedAutoOffload compatibility compatibilityBasis nativeGraphTask unusedFormMaxSequenceLength'
        .split(' ')
        .sort(),
    );
    same(o.schemaVersion, 1);
    for (const k of ['graphControlsHash', 'formControlsHash']) assert.match(o[k], /^[a-f0-9]{64}$/u);
    same(o.compatibility, 'whole_v1');
    same(o.compatibilityBasis, 'original_graph_and_auto_resolution');
    same(o.nativeGraphTask, 'inpaint');
    same(Object.keys(o.geometry).sort(), ['height', 'width']);
    for (const n of [o.geometry.width, o.geometry.height, o.steps, o.unusedFormMaxSequenceLength])
      assert(Number.isSafeInteger(n) && n > 0 && n <= 4096);
    assert(Number.isSafeInteger(o.seed) && o.seed >= 0 && o.seed < 2 ** 32);
    for (const [k, max] of [
      ['guidanceScale', 100],
      ['strength', 1],
    ])
      assert(Number.isFinite(o[k]) && o[k] >= 0 && o[k] <= max);
    assert(['none', 'model_cpu', 'group_cpu'].includes(o.requestedOffloadMode));
    same(typeof o.requestedAutoOffload, 'boolean');
    same(o.inputs.length, 2);
    for (const [i, input] of o.inputs.entries()) {
      same(Object.keys(input).sort(), ['byteSize', 'contentHash', 'role']);
      same(input.role, i === 0 ? 'referenceImages[0]' : 'maskImage');
      assert.match(input.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
      assert(Number.isSafeInteger(input.byteSize) && input.byteSize > 0);
    }
    return 'observed-workflow-auto-masked-image-v1:' + canonicalJsonHash(plan);
  } catch {
    return null;
  }
}
export function observedWorkflowAutoMaskedImagePlan(api, context = {}) {
  try {
    const { executionReceipt: task, executedOutput: output, modelIdentities: models, inputArtifacts = [] } = context,
      hints = api.runtimeHints,
      form = hints.workflowSnapshot.studioForm;
    same(hints.resourceMode, 'auto');
    same(task.status, 'completed');
    same(task.attempt_index, 0);
    same(output.attemptIndex, 0);
    same(task.resourceCandidateId, null);
    same(task.task_id, output.taskId);
    if (context.taskId !== undefined) same(task.task_id, context.taskId);
    for (const [h, t, o] of [
      ['sid', 'sid', 'sid'],
      ['workflowTabId', 'workflow_tab_id', 'workflowTabId'],
      ['clientRunId', 'client_run_id', 'clientRunId'],
      ['runInputHash', 'run_input_hash', 'runInputHash'],
    ]) {
      const v = h === 'sid' ? api.sid : hints[h];
      assert(typeof v === 'string' && v);
      same(task[t], v);
      same(output[o], v);
    }
    same(output.apiGraphSnapshot, api);
    same(task.workflow_snapshot, hints.workflowSnapshot);
    same(output.formSnapshot, form);
    same(hints.workflowAutoPlan.schemaVersion, 1);
    same(hints.workflowAutoPlan.graphHash, workerGraphHash(api));
    assert(!Object.hasOwn(api, 'loops'));
    const p = project(Object.entries(api.nodes), api.paths, form, inputArtifacts);
    same(output.nodeId, p.preview.id);
    const prep = task.runtimePreparation;
    same(prep.resourceMode, 'auto');
    same(prep.performed, false);
    same(prep.residentRecipeReusable, false);
    same(prep.cleanup, null);
    const auto = prep.workflowAuto;
    same(auto.strategy, 'dependency_order_retained_owners');
    same(auto.schedule, null);
    same(auto.cachePreparation, null);
    for (const k of ['reusedOwnerIds', 'preparedDataNodes', 'appliedUpdates', 'releases']) same(auto[k], []);
    const native = output.resolvedExecutionInputs;
    same(native.schemaVersion, 1);
    same(native.source, 'backend-execution');
    same(native.taskId, task.task_id);
    same(native.attemptIndex, 0);
    same(native.nodeId, p.preview.id);
    same(native.truncated, false);
    same(native.uncapturedNodeIds, []);
    same(native.nodes.length, 9);
    same(native.graphTasks, [{ loaderId: p.owner.id, pipelineClass: p.plan.modelType, task: 'inpaint' }]);
    const rows = new Map(native.nodes.map((n) => [n.nodeId, n]));
    same(rows.size, 9);
    for (const [id, n] of Object.entries(api.nodes)) {
      same(rows.get(id)?.module, n.module);
      same(rows.get(id)?.action, n.action);
      same(rows.get(id)?.omittedFields, {});
    }
    const consumed = (r, k, v) => same(rows.get(r.id).fields[k], { source: 'literal', value: v });
    for (const [r, keys] of [
      [
        p.owner,
        'model_type repo_id revision dtype device auto_offload offload_mode quant_config weight_loading_mode attention_backend vae_slicing vae_tiling',
      ],
      [p.guide, 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'],
      [p.encode, 'prompt negative_prompt'],
      [p.denoise, 'width height seed num_inference_steps guidance_scale strength'],
      [p.image, 'seed'],
      [p.preview, 'device'],
    ])
      for (const k of keys.split(' ')) {
        const v = p.value(r, k);
        consumed(r, k, k === 'repo_id' ? v.value : (v ?? null));
      }
    for (const [r, i, mode] of [
      [p.source, 0, 'RGB'],
      [p.mask, 1, 'L'],
    ]) {
      consumed(r, 'alpha_channel', p.value(r, 'alpha_channel'));
      consumed(r, 'source_hashes', [p.plan.resourceObservation.inputs[i].contentHash.slice(13)]);
      consumed(r, 'source_widths', [form.width]);
      consumed(r, 'source_heights', [form.height]);
      consumed(r, 'source_modes', [mode]);
    }
    same(Object.keys(auto.resolvedFields).sort(), [p.owner.id, p.guide.id, p.denoise.id].sort());
    for (const r of [p.owner, p.guide, p.denoise])
      for (const [k, v] of Object.entries(auto.resolvedFields[r.id])) same(v, p.value(r, k));
    same(auto.resolvedFields[p.owner.id].inpaint_compatibility, 'whole_v1');
    same(auto.resolvedFields[p.owner.id].offload_mode, 'group_cpu');
    same(models.length, 1);
    same(models[0].repoId, p.plan.modelRepo);
    same(models[0].selectedRevision, p.plan.modelRevision);
    same(models[0].modelRevision, p.plan.modelRepo + '@' + p.plan.modelRevision);
    assert(models[0].fingerprint);
    assert(observedWorkflowAutoMaskedImageResourceId(p.plan));
    return stableJsonValue(p.plan);
  } catch {
    return null;
  }
}
export function observedWorkflowAutoMaskedImageProofMatches(plan, provenance) {
  try {
    assert(observedWorkflowAutoMaskedImageResourceId(plan));
    const g = provenance.graph.canonicalGraph,
      p = project(
        g.nodes.map((n) => [n.key, n]),
        g.paths,
        provenance.template.lockedSettings,
        provenance.inputs.items,
      );
    same(p.plan, plan);
    same(provenance.inputs.count, 2);
    same(
      provenance.models.items.map((m) => [m.repoId, m.selectedRevision]),
      [[plan.modelRepo, plan.modelRevision]],
    );
    same(provenance.output.items.length, 1);
    same(provenance.output.items[0].mediaType, 'image');
    for (const k of ['width', 'height']) same(provenance.output.items[0][k], plan.resourceObservation.geometry[k]);
    return true;
  } catch {
    return false;
  }
}
