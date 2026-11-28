// Read-only maintainer evidence. No loading, execution, Auto admission or fit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import { assertFiniteObservedJson } from './observed-workflow-auto-resource.mjs';
const SOURCE = 'observed-retained-modular-image-resource-v1';
const same = (a, b) => assert.deepEqual(stableJsonValue(a), stableJsonValue(b));
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const hash = (v) => assert.match(v, /^[a-f0-9]{64}$/u);
const names = ['receipt', 'requests', 'responses', 'derived', 'journal', 'observer', 'comparison', 'inputs'];
const scope = (n) => n.module + '.' + n.action;
const prefix = 'modules.ModularDiffusers.';
const absent = ['weight_format', 'weight_loading_mode'];
const limits = {
  independentMemoryMonitoring: false,
  originalTimeInstalledInventory: false,
  unrecordedLoadingControlsReconstructed: false,
  residencyOrHardwareFitClaimed: false,
};

function project(entries, paths, form, artifacts) {
  assert(['edit_image', 'multi_image_reference_edit'].includes(form.mode));
  assert(['auto', 'expert'].includes(form.resourceMode));
  same(form.dtype, 'bfloat16');
  same(form.quantizationMode, 'none');
  same(form.randomSeed, false);
  if (Object.hasOwn(form, 'trustRemoteCode')) same(form.trustRemoteCode, false);
  assert(Number.isSafeInteger(form.seed) && form.seed >= 0 && form.seed < 2 ** 32);
  for (const k of ['width', 'height', 'steps', 'maxSequenceLength'])
    assert(Number.isSafeInteger(form[k]) && form[k] > 0 && form[k] <= 4096);
  assert(Number.isFinite(form.guidanceScale) && form.guidanceScale >= 0 && form.guidanceScale <= 100);
  assert(Number.isFinite(form.strength) && form.strength >= 0 && form.strength <= 1);
  assert(entries.length === 8 || entries.length === 9);
  same(paths.length, 1);
  same(new Set(paths[0]).size, entries.length);
  same([...paths[0]].sort(), entries.map(([id]) => id).sort());
  const roles = new Map(entries.map(([id, node]) => [scope(node), { id, node }]));
  same(roles.size, entries.length);
  const role = (action) => {
    const r = roles.get(prefix + action);
    assert(r, action);
    return r;
  };
  const owner = role('ModelsLoader'),
    guide = role('Guider'),
    encode = role('EncodePrompt'),
    image = role('ImageEncode'),
    denoise = role('Denoise'),
    decode = role('DecodeLatents');
  const load = roles.get('modules.Image.Load'),
    preview = roles.get('modules.Image.Preview'),
    lora = roles.get(prefix + 'Lora') ?? null;
  assert(load && preview);
  same(roles.size, lora ? 9 : 8);
  const expectedScopes = [
    'ModelsLoader',
    'Guider',
    'EncodePrompt',
    'ImageEncode',
    'Denoise',
    'DecodeLatents',
    ...(lora ? ['Lora'] : []),
  ]
    .map((s) => prefix + s)
    .concat('modules.Image.Load', 'modules.Image.Preview');
  same([...roles.keys()].sort(), expectedScopes.sort());
  const value = (r, k) => {
    const p = r.node.params[k];
    assert(p && !p.sourceId && !p.sourceKey, r.node.action + '.' + k);
    return p.value;
  };
  for (const k of absent) assert(!Object.hasOwn(owner.node.params, k));
  const repo = value(owner, 'repo_id');
  same(repo.source, 'hub');
  assert.match(repo.value, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
  const revision = value(owner, 'revision');
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const modelType = value(owner, 'model_type');
  assert.match(modelType, /^[A-Za-z]\w*ModularPipeline$/u);
  same(modelType, form.modelType);
  same(value(owner, 'dtype'), 'bfloat16');
  same(value(owner, 'device'), 'cuda:0');
  same(value(owner, 'auto_offload'), form.autoOffload);
  same(value(owner, 'offload_mode'), form.offloadMode);
  assert(
    (form.autoOffload === false && form.offloadMode === 'none') ||
      (form.autoOffload === true && form.offloadMode === 'model_cpu'),
  );
  same(value(owner, 'attention_backend'), 'inherit');
  same(value(owner, 'vae_slicing'), null);
  same(value(owner, 'vae_tiling'), null);
  if (Object.hasOwn(owner.node.params, 'trust_remote_code')) same(value(owner, 'trust_remote_code'), false);
  const workflowId = value(owner, 'workflow_id');
  assert(['default', 'image_conditioned'].includes(workflowId));
  for (const k of [
    'unet',
    'vae',
    'controlnet',
    'text_encoders',
    'pipeline_components',
    'image_encoder',
    'quant_config',
  ]) {
    const p = owner.node.params[k];
    assert(!p?.sourceId && !p?.sourceKey && p?.value == null, k);
  }
  if (!lora) {
    const p = owner.node.params.lora_list;
    assert(!p?.sourceId && !p?.sourceKey && p?.value == null);
  }
  const connections = new Set();
  const wire = (target, k, supplier, port) => {
    const p = target.node.params[k];
    same({ id: p?.sourceId, port: p?.sourceKey }, { id: supplier.id, port });
    assert(!Object.hasOwn(p, 'value'));
    assert(paths[0].indexOf(supplier.id) < paths[0].indexOf(target.id));
    connections.add(target.id + ':' + k);
  };
  for (const [t, k, s, port] of [
    [image, 'vae', owner, 'vae_out'],
    [image, 'image', load, 'image'],
    [encode, 'text_encoders', owner, 'text_encoders'],
    [encode, 'guider', guide, 'guider_out'],
    [encode, 'image', load, 'image'],
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
  ])
    wire(t, k, s, port);
  if (lora) wire(owner, 'lora_list', lora, 'lora');
  for (const [id, n] of entries)
    for (const [k, p] of Object.entries(n.params))
      if (p.sourceId) assert(connections.has(id + ':' + k), 'Unexpected supplier ' + k);
      else if (p.sourceKey)
        assert(
          (id === preview.id && k === 'preview' && p.sourceKey === 'output' && p.display === 'ui_image') ||
            (id === image.id &&
              k === 'encode_summary' &&
              p.sourceKey === 'encode_summary_data' &&
              p.display === 'ui_text'),
        );
  assert(['cpu:0', 'cuda:0'].includes(value(preview, 'device')));
  same(value(load, 'alpha_channel'), 'ignore');
  const files = value(load, 'file');
  assert(Array.isArray(files) && (files.length === 1 || files.length === 2));
  same(artifacts.length, files.length);
  const inputs = files.map((file, i) => {
    assert(typeof file === 'string' && file.length > 0 && file.length <= 16384);
    const role = 'referenceImages[' + i + ']';
    const a = artifacts.filter((x) => x.role === role);
    same(a.length, 1);
    same(a[0].path, file);
    assert.match(a[0].contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
    assert(Number.isSafeInteger(a[0].byteSize) && a[0].byteSize > 0);
    if (form.referenceImages) same(form.referenceImages[i], file);
    return { role, contentHash: a[0].contentHash, byteSize: a[0].byteSize };
  });
  same(new Set(files).size, files.length);
  for (const [field, key] of [
    ['prompt', 'prompt'],
    ['negative_prompt', 'negativePrompt'],
  ])
    same(value(encode, field), form[key]);
  const dimensionPorts = ['width', 'height'].filter((k) => Object.hasOwn(denoise.node.params, k));
  assert(dimensionPorts.length === 0 || dimensionPorts.length === 2);
  const geometryRoute = dimensionPorts.length ? 'literal_dimensions' : 'native_image_state';
  for (const [field, key] of [
    ...(dimensionPorts.length
      ? [
          ['width', 'width'],
          ['height', 'height'],
        ]
      : []),
    ['seed', 'seed'],
    ['num_inference_steps', 'steps'],
    ['guidance_scale', 'guidanceScale'],
  ])
    same(value(denoise, field), form[key]);
  same(value(image, 'seed'), form.seed);
  for (const k of ['mask_image', 'padding_mask_crop']) {
    const p = image.node.params[k];
    assert(!p?.sourceId && !p?.sourceKey && p?.value == null, k);
  }
  if (Object.hasOwn(image.node.params, 'inpaint_compatibility')) same(value(image, 'inpaint_compatibility'), 'native');
  const guidance = Object.fromEntries(
    'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'
      .split(' ')
      .map((k) => [k, value(guide, k)]),
  );
  same(guidance, {
    model_type: modelType,
    guider: 'ClassifierFreeGuidance',
    guidance_scale: form.guidanceScale,
    guidance_rescale: 0,
    use_original_formulation: false,
    enabled: true,
    start: 0,
    stop: 1,
  });
  const labels = new Map(entries.map(([id, n]) => [id, n.action]));
  const projection = paths[0].map((id) => {
    const n = entries.find(([k]) => k === id)[1];
    return {
      role: labels.get(id),
      scope: scope(n),
      params: Object.fromEntries(
        Object.entries(n.params)
          .filter(([k, p]) => !['label', 'preview', 'export'].includes(k) && !p.display?.startsWith('ui_'))
          .map(([k, p]) => [
            k,
            p.sourceId
              ? { supplier: labels.get(p.sourceId), port: p.sourceKey }
              : { value: n === load.node && k === 'file' ? inputs.map((i) => i.role) : (p.value ?? null) },
          ]),
      ),
    };
  });
  let adapter = null;
  if (lora) {
    const selected = value(lora, 'model');
    same(selected.source, 'hub');
    assert.match(selected.value, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
    const rev = value(lora, 'revision'),
      weight = value(lora, 'weight_name'),
      body = value(lora, 'expected_sha256');
    assert.match(rev, /^[a-f0-9]{40}$/u);
    assert.match(weight, /^[\w.-]+\.safetensors$/u);
    hash(body);
    const previous = lora.node.params.previous_loras;
    assert(previous && !previous.sourceId && !previous.sourceKey && previous.value == null);
    const scale = value(lora, 'scale'),
      name = value(lora, 'adapter_name');
    assert(Number.isFinite(scale) && scale >= 0 && scale <= 2 && typeof name === 'string' && name.length <= 256);
    same(form.guidanceScale, 1);
    same(value(lora, 'scheduler_class'), 'FlowMatchEulerDiscreteScheduler');
    const scheduler = JSON.parse(value(lora, 'scheduler_config'));
    adapter = {
      repository: selected.value,
      revision: rev,
      weightName: weight,
      sha256: body,
      scale,
      configuredName: name,
      scheduler,
    };
  }
  const formKeys = [
    'mode',
    'modelType',
    'resourceMode',
    'dtype',
    'quantizationMode',
    'randomSeed',
    'seed',
    'width',
    'height',
    'steps',
    'guidanceScale',
    'prompt',
    'negativePrompt',
    'maxSequenceLength',
    'offloadMode',
    'autoOffload',
    'strength',
  ];
  return {
    role,
    owner,
    guide,
    encode,
    image,
    denoise,
    decode,
    load,
    preview,
    lora,
    value,
    inputs,
    adapter,
    graphControlsHash: canonicalJsonHash(projection),
    formControlsHash: canonicalJsonHash(Object.fromEntries(formKeys.map((k) => [k, form[k]]))),
    recipe: {
      modelType,
      repository: repo.value,
      revision,
      dtype: 'bfloat16',
      device: 'cuda:0',
      offloadMode: form.offloadMode,
      autoOffload: form.autoOffload,
      resourceMode: form.resourceMode,
      formMode: form.mode,
      originalWorkflowId: workflowId,
      geometry: { width: form.width, height: form.height },
      geometryRoute,
      absentLoaderControls: absent,
    },
  };
}

function pil(value) {
  assert(value && typeof value === 'object');
  hash(value.sha256);
  hash(value.decodedRgbaSha256);
  assert(['RGB', 'RGBA', 'L'].includes(value.mode));
  assert(
    Array.isArray(value.size) &&
      value.size.length === 2 &&
      value.size.every((n) => Number.isSafeInteger(n) && n > 0 && n <= 8192),
  );
  return { mode: value.mode, size: value.size, sha256: value.sha256, decodedRgbaSha256: value.decodedRgbaSha256 };
}
const images = (value) => (Array.isArray(value) ? value : [value]).map(pil);
const schedulerValue = (s) => ({
  ...s,
  config: Object.fromEntries(
    Object.entries(s.config).map(([k, v]) => [k, k === '_use_default_values' ? [...v].sort() : v]),
  ),
});

function proveAdapter(p, events, derived, call, task, models) {
  if (!p.adapter) {
    same(call.peftComponentAdapterNames, {});
    same(call.peftLayerScaleHistograms, {});
    same(call.wholePipelineAdapterScales, null);
    same(models.length, 1);
    return null;
  }
  const a = p.adapter,
    records = derived.generatedNamespaceLoadToConsumption;
  assert(records);
  same(records.rawDescriptors.length, 1);
  const descriptor = records.rawDescriptors[0];
  same(descriptor.nodeId, p.lora.id);
  same(descriptor.rawName, a.configuredName);
  same(descriptor.rawNameFieldPresent, true);
  same(descriptor.sha256, a.sha256);
  same(descriptor.weightName, a.weightName);
  same(descriptor.scale, a.scale);
  const slot = descriptor.resolvedName;
  assert(typeof slot === 'string' && slot.length > 0 && slot.length <= 512);
  if (a.configuredName) same(slot, a.configuredName);
  else same(descriptor.generated, true);
  const starts = events.filter((e) => e.event === 'loraWeightLoadStarted'),
    loaded = events.filter((e) => e.event === 'loraWeightLoadReturned'),
    activated = events.filter((e) => e.event === 'loraSetAdaptersReturned');
  same(starts.length, 1);
  same(loaded.length, 1);
  same(activated.length, 1);
  const start = starts[0],
    load = loaded[0],
    active = activated[0];
  same(records.actualLoadedWeights, [load]);
  same(records.actualActivation, active);
  same(start.callId, load.callId);
  same(start.pipelineObjectId, load.pipelineObjectId);
  same(active.pipelineObjectId, load.pipelineObjectId);
  same(load.task, {
    task_id: task.task_id,
    attempt_index: 0,
    current_node: p.owner.id,
    current_node_name: scope(p.owner.node),
  });
  same(start.task, load.task);
  same(active.task, load.task);
  assert(
    Date.parse(start.at) >= task.started_at * 1000 &&
      Date.parse(start.at) <= Date.parse(load.at) &&
      Date.parse(load.at) <= Date.parse(active.at) &&
      Date.parse(active.at) <= Date.parse(call.at),
  );
  const weight = load.actualWeight;
  same(weight, start.actualWeight);
  same(weight.adapterName, slot);
  same(weight.weightName, a.weightName);
  same(weight.actualFile.sha256, a.sha256);
  assert(Number.isSafeInteger(weight.actualFile.byteSize) && weight.actualFile.byteSize > 0);
  same(active.actualInputs, { adapter_names: [slot], adapter_weights: [a.scale] });
  const loadedTransformer = load.runtimeAfter.peftComponentBindings.transformer;
  assert(loadedTransformer && Number.isSafeInteger(loadedTransformer.modelObjectId));
  same(loadedTransformer.loadedAdapterNames, [slot]);
  same(active.runtimeAfter.peftComponentBindings.transformer.modelObjectId, loadedTransformer.modelObjectId);
  same(call.peftComponentAdapterNames, { transformer: [slot] });
  same(call.peftComponentBindings.transformer.modelObjectId, loadedTransformer.modelObjectId);
  same(call.peftComponentBindings.transformer.loadedAdapterNames, [slot]);
  same(call.wholePipelineAdapterScales, null);
  const forwards = events.filter((e) => e.event === 'actualQwenModelAdapters' && e.task.current_node === p.denoise.id);
  same(forwards, records.actualConsumingForwards);
  same(forwards.length, p.value(p.denoise, 'num_inference_steps'));
  same(records.consumedTransformerObjectId, loadedTransformer.modelObjectId);
  const denoiseReturns = events.filter((e) => e.event === 'officialCallReturned' && e.callId === call.callId);
  same(denoiseReturns.length, 1);
  let lastForwardAt = Date.parse(call.at);
  for (const forward of forwards) {
    const at = Date.parse(forward.at);
    assert(Number.isFinite(at) && at >= lastForwardAt && at <= Date.parse(denoiseReturns[0].at));
    lastForwardAt = at;
  }
  const rowNames = [];
  let layerCount = null;
  for (const forward of forwards) {
    same(forward.task, call.task);
    same(forward.modelObjectId, loadedTransformer.modelObjectId);
    same(forward.peftBinding.modelObjectId, loadedTransformer.modelObjectId);
    same(forward.peftBinding.loadedAdapterNames, [slot]);
    assert(Date.parse(forward.at) >= Date.parse(call.at));
    const layers = forward.peftBinding.layers;
    assert(Array.isArray(layers) && layers.length > 0 && layers.length <= 4096);
    if (layerCount === null) layerCount = layers.length;
    same(layers.length, layerCount);
    same(new Set(layers.map((r) => r.name)).size, layerCount);
    for (const layer of layers) {
      same(layer.activeAdapters, [slot]);
      same(layer.disableAdapters, false);
      same(layer.mergedAdapters, []);
      same(layer.loraAKeys, [slot]);
      same(layer.loraBKeys, [slot]);
      same(layer.scaling, { [slot]: a.scale });
    }
    const names = layers.map((r) => r.name);
    if (!rowNames.length) rowNames.push(...names);
    else same(names, rowNames);
  }
  same(Object.keys(call.peftLayerScaleHistograms), ['transformer']);
  same(Object.keys(call.peftLayerScaleHistograms.transformer), [slot]);
  const histogram = call.peftLayerScaleHistograms.transformer[slot];
  same(Object.keys(histogram).length, 1);
  const scaleLabel = Object.keys(histogram)[0];
  assert(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(scaleLabel));
  same(Number(scaleLabel), a.scale);
  same(histogram[scaleLabel], layerCount);
  same(models.length, 2);
  const selected = models.filter((m) => m.repoId === a.repository);
  same(selected.length, 1);
  same(selected[0].selectedRevision, a.revision);
  const actualConfig = Object.fromEntries(Object.entries(call.scheduler.config).filter(([k]) => !k.startsWith('_')));
  same(actualConfig, a.scheduler);
  return {
    ...a,
    actualName: slot,
    weightBytes: weight.actualFile.byteSize,
    transformerObjectId: loadedTransformer.modelObjectId,
    observedLayers: layerCount,
    observedForwards: forwards.length,
    originalLoadRevision: weight.revision,
  };
}

function derive(api, context) {
  const {
    executionReceipt: task,
    executedOutput: output,
    backendSource: source,
    backendContract: contract,
    modelIdentities: models,
    inputArtifacts: artifacts,
    retainedNativeEvidence: records,
  } = context;
  same(Object.keys(records).sort(), [...names].sort());
  let total = 0;
  const read = (name) => {
    const r = records[name];
    assert(r && typeof r.text === 'string');
    const size = Buffer.byteLength(r.text);
    total += size;
    assert(size <= (name === 'journal' ? 64 : name === 'inputs' ? 1 : 16) * 1024 ** 2 && total <= 112 * 1024 ** 2);
    same(sha(r.text), r.sha256);
    return name === 'journal'
      ? r.text
          .trim()
          .split('\n')
          .map((x) => JSON.parse(x))
      : JSON.parse(r.text);
  };
  const original = read('receipt'),
    requests = read('requests'),
    responses = read('responses'),
    derived = read('derived'),
    journal = read('journal'),
    observer = read('observer'),
    comparison = read('comparison'),
    inputEvidence = read('inputs');
  same(original.task, task);
  same(original.outputs, [output]);
  same(task.status, 'completed');
  same(task.attempt_index, 0);
  same(output.attemptIndex, 0);
  same(task.resourceCandidateId, null);
  same(task.task_id, context.taskId);
  same(output.taskId, task.task_id);
  const submitted = requests.filter((r) => r.path === '/graph'),
    accepted = responses.filter((r) => r.path === '/graph');
  same(submitted.length, 1);
  same(accepted.length, 1);
  same(submitted[0].body, api);
  same(accepted[0].status, 200);
  same(accepted[0].body.error, false);
  same(accepted[0].body.task_id, task.task_id);
  same(accepted[0].body.sid, api.sid);
  assert(
    Date.parse(submitted[0].at) <= task.started_at * 1000 &&
      Date.parse(accepted[0].at) >= Date.parse(submitted[0].at) &&
      Date.parse(accepted[0].at) <= task.completed_at * 1000,
  );
  if (Object.hasOwn(output, 'apiGraphSnapshot')) same(output.apiGraphSnapshot, api);
  assert(!Object.hasOwn(api, 'loops'));
  for (const [hint, tk, ok] of [
    ['sid', 'sid', 'sid'],
    ['workflowTabId', 'workflow_tab_id', 'workflowTabId'],
    ['clientRunId', 'client_run_id', 'clientRunId'],
    ['runInputHash', 'run_input_hash', 'runInputHash'],
  ]) {
    const v = hint === 'sid' ? api.sid : api.runtimeHints[hint];
    assert(typeof v === 'string' && v);
    same(task[tk], v);
    same(output[ok], v);
  }
  same(task.workflow_snapshot, api.runtimeHints.workflowSnapshot);
  same(output.formSnapshot, task.workflow_snapshot.studioForm);
  same(output.formSnapshot.trustRemoteCode, false);
  const form = output.formSnapshot,
    p = project(Object.entries(api.nodes), api.paths, form, artifacts);
  same(output.nodeId, p.preview.id);
  same(task.runtimePreparation.resourceMode, form.resourceMode);
  same(source.fingerprint, task.runtimeFingerprint.backendSource.fingerprint);
  same(source.files.length, task.runtimeFingerprint.backendSource.fileCount);
  same(source.gitCommit, task.runtimeFingerprint.backendSource.gitCommit);
  same(
    source.fingerprint,
    'sha256:backend-source-v1:' + canonicalJsonHash({ gitCommit: source.gitCommit, files: source.files }),
  );
  assert.match(contract.fingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
  const ownerContract = contract.contracts.filter((c) => c.key === prefix + 'ModelsLoader');
  same(ownerContract.length, 1);
  for (const key of absent) assert(!Object.hasOwn(ownerContract[0].params, key));
  const native = output.resolvedExecutionInputs;
  same(native.schemaVersion, 1);
  same(native.source, 'backend-execution');
  same(native.taskId, task.task_id);
  same(native.attemptIndex, 0);
  same(native.nodeId, output.nodeId);
  same(native.truncated, false);
  same(native.uncapturedNodeIds, []);
  same(native.nodes.length, Object.keys(api.nodes).length);
  const captures = new Map(native.nodes.map((n) => [n.nodeId, n]));
  same(captures.size, native.nodes.length);
  for (const [id, node] of Object.entries(api.nodes)) {
    same(captures.get(id)?.module, node.module);
    same(captures.get(id)?.action, node.action);
    same(captures.get(id)?.omittedFields, {});
  }
  const consumed = (r, k, v) => same(captures.get(r.id).fields[k], { source: 'literal', value: v });
  for (const key of absent) assert(!Object.hasOwn(captures.get(p.owner.id).fields, key));
  for (const key of 'model_type repo_id revision dtype device auto_offload offload_mode quant_config attention_backend vae_slicing vae_tiling'.split(
    ' ',
  ))
    consumed(
      p.owner,
      key,
      key === 'repo_id'
        ? p.recipe.repository
        : key === 'quant_config'
          ? (p.value(p.owner, key) ?? null)
          : p.value(p.owner, key),
    );
  for (const key of 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'.split(
    ' ',
  ))
    consumed(p.guide, key, p.value(p.guide, key));
  for (const key of ['prompt', 'negative_prompt']) consumed(p.encode, key, p.value(p.encode, key));
  for (const key of [
    ...(p.recipe.geometryRoute === 'literal_dimensions' ? ['width', 'height'] : []),
    'seed',
    'num_inference_steps',
    'guidance_scale',
    ...(Object.hasOwn(p.denoise.node.params, 'strength') ? ['strength'] : []),
  ])
    consumed(p.denoise, key, p.value(p.denoise, key));
  if (p.recipe.geometryRoute === 'native_image_state')
    for (const key of ['width', 'height']) assert(!Object.hasOwn(captures.get(p.denoise.id).fields, key));
  if (!Object.hasOwn(p.denoise.node.params, 'strength'))
    assert(!Object.hasOwn(captures.get(p.denoise.id).fields, 'strength'));
  consumed(p.image, 'seed', form.seed);
  consumed(p.preview, 'device', p.value(p.preview, 'device'));
  if (p.lora) {
    same(Object.keys(captures.get(p.lora.id).fields), ['revision']);
    consumed(p.lora, 'revision', p.adapter.revision);
  }
  same(native.graphTasks.length, 1);
  const reportedTask = native.graphTasks[0].task;
  assert(reportedTask === null || reportedTask === 'edit_image');
  same(native.graphTasks, [{ loaderId: p.owner.id, pipelineClass: p.recipe.modelType, task: reportedTask }]);
  same(derived.taskId, task.task_id);
  for (const name of ['receipt', 'requests', 'responses'])
    same(derived.evidenceHashes[name === 'receipt' ? 'run-receipt.json' : name + '.json'], records[name].sha256);
  const events = journal.filter((e) => e.task?.task_id === task.task_id),
    calls = events.filter((e) => e.event === 'officialCallStarted');
  same(calls, derived.actualOfficialCalls);
  same(calls.length, 4);
  assert(!events.some((e) => e.event === 'officialCallFailed'));
  const expectedOrder = api.paths[0].filter((id) => [p.encode.id, p.image.id, p.denoise.id, p.decode.id].includes(id));
  same(
    calls.map((c) => c.task.current_node),
    expectedOrder,
  );
  same(new Set(calls.map((c) => c.callId)).size, 4);
  const returns = [];
  for (const call of calls) {
    assert.match(call.callId, /^[a-f0-9]{32}$/u);
    same(call.task, {
      task_id: task.task_id,
      attempt_index: 0,
      current_node: call.task.current_node,
      current_node_name: scope(api.nodes[call.task.current_node]),
    });
    same(call.pipelineClass, 'diffusers.modular_pipelines.modular_pipeline.ModularPipeline');
    assert(
      call.actualPipelineClass.startsWith('diffusers.modular_pipelines.') &&
        call.actualPipelineClass.endsWith('.' + p.recipe.modelType),
    );
    const ret = events.filter((e) => e.event === 'officialCallReturned' && e.callId === call.callId);
    same(ret.length, 1);
    same(ret[0].task, call.task);
    assert(
      Date.parse(call.at) >= task.started_at * 1000 &&
        Date.parse(ret[0].at) >= Date.parse(call.at) &&
        Date.parse(ret[0].at) <= task.completed_at * 1000,
    );
    if (returns.length) assert(Date.parse(call.at) >= Date.parse(returns.at(-1).at));
    returns.push(ret[0]);
  }
  const find = (r) => calls.find((c) => c.task.current_node === r.id),
    enc = find(p.encode),
    img = find(p.image),
    den = find(p.denoise),
    dec = find(p.decode);
  const guideConfig = Object.fromEntries(
    Object.entries(p.guide.node.params)
      .filter(([k]) => !['model_type', 'guider', 'layers_config'].includes(k))
      .map(([k]) => [k, p.value(p.guide, k)]),
  );
  for (const c of [enc, den]) {
    same(c.guider.class, 'diffusers.guiders.classifier_free_guidance.ClassifierFreeGuidance');
    same(c.guider.config, guideConfig);
  }
  for (const c of [img, den]) same(c.generator, { device: 'cuda:0', initialSeed: form.seed, type: 'Generator' });
  same(enc.generator, null);
  same(dec.generator, null);
  same(enc.callInputs.prompt, form.prompt);
  same(enc.callInputs.negative_prompt, form.negativePrompt);
  same(den.callInputs.num_inference_steps, form.steps);
  if (p.recipe.geometryRoute === 'native_image_state')
    for (const key of ['width', 'height']) assert(!Object.hasOwn(den.callInputs, key));
  else for (const key of ['width', 'height']) same(den.callInputs[key], p.value(p.denoise, key));
  if (Object.hasOwn(den.callInputs, 'strength')) same(den.callInputs.strength, p.value(p.denoise, 'strength'));
  else if (!Object.hasOwn(p.denoise.node.params, 'strength')) assert(!Object.hasOwn(den.callInputs, 'strength'));
  for (const key of ['mask_image', 'padding_mask_crop'])
    if (Object.hasOwn(img.callInputs, key)) same(img.callInputs[key], null);
  for (const c of [img, dec]) same(c.vaeMemoryFlags, { use_slicing: false, use_tiling: false });
  const consumedPixels = images(img.callInputs.image);
  same(consumedPixels, images(enc.callInputs.image));
  same(consumedPixels.length, p.inputs.length);
  same(comparison.format, 'modiff.image-template-comparison-contract.v1');
  same(comparison.templateId, context.templateId);
  same(comparison.task, 'edit_image');
  same(inputEvidence.schemaVersion, 1);
  same(inputEvidence.sources.length, p.inputs.length);
  const inputs = p.inputs.map((input, i) => {
    const match = inputEvidence.sources.filter((x) => x.role === input.role);
    same(match.length, 1);
    const row = match[0];
    same(row.contentHash, input.contentHash);
    same(row.byteSize, input.byteSize);
    const old = comparison.inputs.filter((x) => x.sha256 === input.contentHash.slice('sha256:bytes:'.length));
    same(old.length, 1);
    same(old[0].role, row.originalContractRole);
    same(row.originalContractRole, 'referenceImage' + (i + 1));
    same(row.decodedRgbaSha256, consumedPixels[i].decodedRgbaSha256);
    same(row.size, consumedPixels[i].size);
    return { ...input, originalContractRole: row.originalContractRole, ...consumedPixels[i] };
  });
  const base = models.filter((m) => m.repoId === p.recipe.repository);
  same(base.length, 1);
  same(base[0].selectedRevision, p.recipe.revision);
  same(base[0].modelRevision, p.recipe.repository + '@' + p.recipe.revision);
  assert(base[0].fingerprint);
  same(
    models.map((m) => [m.repoId, m.selectedRevision]).sort(),
    comparison.models.map((m) => [m.repoId, m.revision]).sort(),
  );
  const adapter = proveAdapter(p, events, derived, den, task, models);
  if (adapter) {
    const declared = comparison.models.filter((m) => m.repoId === adapter.repository);
    same(declared.length, 1);
    same(declared[0].weightName, adapter.weightName);
    same(declared[0].sha256, adapter.sha256);
  }
  same(schedulerValue(den.scheduler), schedulerValue(comparison.settings.scheduler));
  const starts = events.filter((e) => e.event === 'schedulerStepStarted'),
    finished = events.filter((e) => e.event === 'schedulerStepReturned');
  same(starts.length, form.steps);
  same(finished.length, form.steps);
  same(
    starts.map((e) => e.stepIndex),
    [null, ...Array.from({ length: form.steps - 1 }, (_, i) => i + 1)],
  );
  same(
    finished.map((e) => e.stepIndex),
    Array.from({ length: form.steps }, (_, i) => i + 1),
  );
  const denReturn = returns.find((r) => r.callId === den.callId);
  for (const [i, e] of starts.entries()) {
    same(e.task, den.task);
    same(finished[i].task, den.task);
    assert(
      Date.parse(e.at) >= Date.parse(den.at) &&
        Date.parse(e.at) <= Date.parse(finished[i].at) &&
        Date.parse(finished[i].at) <= Date.parse(denReturn.at),
    );
    if (i) assert(Date.parse(e.at) >= Date.parse(finished[i - 1].at));
  }
  same(returns.find((r) => r.callId === dec.callId).images, [{ mode: 'RGB', size: [form.width, form.height] }]);
  same(output.mediaItems.length, 1);
  same(output.mediaItems[0].width, form.width);
  same(output.mediaItems[0].height, form.height);
  assert(Date.parse(observer.installedAt) <= task.started_at * 1000);
  hash(observer.observerSha256);
  const wrapped = observer.wrappedCalls.filter(
    (r) => r.kind === 'officialPipelineCall' && r.class === calls[0].pipelineClass,
  );
  same(wrapped.length, 1);
  hash(wrapped[0].sourceSha256);
  const upstream = derived.actualDiffusersDirectUrl.value;
  same(upstream.url, 'https://github.com/huggingface/diffusers.git');
  assert.match(upstream.vcs_info.commit_id, /^[a-f0-9]{40}$/u);
  const observation = {
    schemaVersion: 1,
    templateId: context.templateId,
    taskId: task.task_id,
    recipe: p.recipe,
    graphControlsHash: p.graphControlsHash,
    formControlsHash: p.formControlsHash,
    reportedGraphTask: reportedTask,
    configuredUnusedFields: {
      formStrength: form.strength,
      genericDenoiserStrengthPresent: Object.hasOwn(p.denoise.node.params, 'strength'),
      genericDenoiserStrength: Object.hasOwn(p.denoise.node.params, 'strength') ? p.value(p.denoise, 'strength') : null,
      formMaxSequenceLength: form.maxSequenceLength,
    },
    denoiserStrengthPassed: Object.hasOwn(den.callInputs, 'strength'),
    actualInheritedVaeFlags: { use_slicing: false, use_tiling: false },
    actualGuider: guideConfig,
    actualScheduler: den.scheduler,
    inputs,
    adapter,
    rawOfficialCalls: 4,
    rawSchedulerSteps: finished.length,
    backendSourceFingerprint: source.fingerprint,
    backendContractFingerprint: contract.fingerprint,
    rawRecordHashes: Object.fromEntries(names.map((n) => [n, records[n].sha256])),
    upstreamLibrary: {
      url: upstream.url,
      commit: upstream.vcs_info.commit_id,
      callSourceSha256: wrapped[0].sourceSha256,
    },
    historicalLimits: limits,
  };
  const plan = {
    source: SOURCE,
    modelType: p.recipe.modelType,
    pipelineClass: p.recipe.modelType,
    modelRepo: p.recipe.repository,
    modelRevision: p.recipe.revision,
    dtype: 'bfloat16',
    device: 'cuda:0',
    offloadMode: p.recipe.offloadMode,
    autoOffload: p.recipe.autoOffload,
    resourceMode: form.resourceMode,
    resolvedResourceMode: form.resourceMode,
    quantizationMode: 'none',
    quantizedComponents: [],
    resourceObservation: observation,
  };
  assert(resourceId(plan));
  return plan;
}

function keys(value, expected) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  same(Object.keys(value).sort(), expected.split(' ').sort());
}
function boundedString(value, max = 512) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= max);
}
function repository(value) {
  assert.match(value, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
}
function pin(value) {
  assert.match(value, /^[a-f0-9]{40}$/u);
}
function positive(value, max = Number.MAX_SAFE_INTEGER) {
  assert(Number.isSafeInteger(value) && value > 0 && value <= max);
}
function scalar(value, min, max) {
  assert(Number.isFinite(value) && value >= min && value <= max);
}
function descriptor(adapter) {
  return Object.fromEntries(
    Object.entries(adapter).filter(
      ([k]) =>
        ![
          'actualName',
          'weightBytes',
          'transformerObjectId',
          'observedLayers',
          'observedForwards',
          'originalLoadRevision',
        ].includes(k),
    ),
  );
}

function resourceId(plan) {
  try {
    assertFiniteObservedJson(plan);
    assert(Buffer.byteLength(JSON.stringify(plan)) <= 65536);
    keys(
      plan,
      'source modelType pipelineClass modelRepo modelRevision dtype device offloadMode autoOffload resourceMode resolvedResourceMode quantizationMode quantizedComponents resourceObservation',
    );
    same(plan.source, SOURCE);
    const o = plan.resourceObservation;
    keys(
      o,
      'schemaVersion templateId taskId recipe graphControlsHash formControlsHash reportedGraphTask configuredUnusedFields denoiserStrengthPassed actualInheritedVaeFlags actualGuider actualScheduler inputs adapter rawOfficialCalls rawSchedulerSteps backendSourceFingerprint backendContractFingerprint rawRecordHashes upstreamLibrary historicalLimits',
    );
    same(o.schemaVersion, 1);
    boundedString(o.templateId, 256);
    boundedString(o.taskId, 256);
    hash(o.graphControlsHash);
    hash(o.formControlsHash);
    const r = o.recipe;
    keys(
      r,
      'modelType repository revision dtype device offloadMode autoOffload resourceMode formMode originalWorkflowId geometry geometryRoute absentLoaderControls',
    );
    assert.match(r.modelType, /^[A-Za-z]\w*ModularPipeline$/u);
    repository(r.repository);
    pin(r.revision);
    for (const [field, value] of Object.entries({
      modelType: r.modelType,
      pipelineClass: r.modelType,
      modelRepo: r.repository,
      modelRevision: r.revision,
      dtype: 'bfloat16',
      device: 'cuda:0',
      offloadMode: r.offloadMode,
      autoOffload: r.autoOffload,
      resourceMode: r.resourceMode,
      resolvedResourceMode: r.resourceMode,
      quantizationMode: 'none',
      quantizedComponents: [],
    }))
      same(plan[field], value);
    same(r.dtype, 'bfloat16');
    same(r.device, 'cuda:0');
    assert(['auto', 'expert'].includes(r.resourceMode));
    assert(['edit_image', 'multi_image_reference_edit'].includes(r.formMode));
    assert(['default', 'image_conditioned'].includes(r.originalWorkflowId));
    assert(
      (r.offloadMode === 'none' && r.autoOffload === false) ||
        (r.offloadMode === 'model_cpu' && r.autoOffload === true),
    );
    keys(r.geometry, 'width height');
    positive(r.geometry.width, 4096);
    positive(r.geometry.height, 4096);
    assert(['literal_dimensions', 'native_image_state'].includes(r.geometryRoute));
    same(r.absentLoaderControls, absent);
    assert(o.reportedGraphTask === null || o.reportedGraphTask === 'edit_image');
    same(o.historicalLimits, limits);
    keys(
      o.configuredUnusedFields,
      'formStrength genericDenoiserStrengthPresent genericDenoiserStrength formMaxSequenceLength',
    );
    const u = o.configuredUnusedFields;
    scalar(u.formStrength, 0, 1);
    positive(u.formMaxSequenceLength, 4096);
    same(typeof u.genericDenoiserStrengthPresent, 'boolean');
    same(typeof o.denoiserStrengthPassed, 'boolean');
    if (u.genericDenoiserStrengthPresent) scalar(u.genericDenoiserStrength, 0, 1);
    else {
      same(u.genericDenoiserStrength, null);
      same(o.denoiserStrengthPassed, false);
    }
    same(o.actualInheritedVaeFlags, { use_slicing: false, use_tiling: false });
    keys(o.actualGuider, 'guidance_scale guidance_rescale use_original_formulation enabled start stop');
    scalar(o.actualGuider.guidance_scale, 0, 100);
    same(o.actualGuider.guidance_rescale, 0);
    same(o.actualGuider.use_original_formulation, false);
    same(o.actualGuider.enabled, true);
    same(o.actualGuider.start, 0);
    same(o.actualGuider.stop, 1);
    keys(o.actualScheduler, 'class config');
    assert.match(o.actualScheduler.class, /^diffusers\.schedulers\.[A-Za-z0-9_.]+$/u);
    assert(
      o.actualScheduler.config &&
        typeof o.actualScheduler.config === 'object' &&
        !Array.isArray(o.actualScheduler.config),
    );
    assert(Object.keys(o.actualScheduler.config).length <= 256);
    same(o.rawOfficialCalls, 4);
    positive(o.rawSchedulerSteps, 4096);
    assert.match(o.backendSourceFingerprint, /^sha256:backend-source-v1:[a-f0-9]{64}$/u);
    assert.match(o.backendContractFingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
    keys(o.rawRecordHashes, names.join(' '));
    for (const n of names) hash(o.rawRecordHashes[n]);
    keys(o.upstreamLibrary, 'url commit callSourceSha256');
    same(o.upstreamLibrary.url, 'https://github.com/huggingface/diffusers.git');
    pin(o.upstreamLibrary.commit);
    hash(o.upstreamLibrary.callSourceSha256);
    assert(Array.isArray(o.inputs) && (o.inputs.length === 1 || o.inputs.length === 2));
    for (const [i, input] of o.inputs.entries()) {
      keys(input, 'role contentHash byteSize originalContractRole mode size sha256 decodedRgbaSha256');
      same(input.role, 'referenceImages[' + i + ']');
      same(input.originalContractRole, 'referenceImage' + (i + 1));
      assert.match(input.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
      positive(input.byteSize, 256 * 1024 ** 2);
      same(pil(input), {
        mode: input.mode,
        size: input.size,
        sha256: input.sha256,
        decodedRgbaSha256: input.decodedRgbaSha256,
      });
    }
    if (o.adapter !== null) {
      const a = o.adapter;
      keys(
        a,
        'repository revision weightName sha256 scale configuredName scheduler actualName weightBytes transformerObjectId observedLayers observedForwards originalLoadRevision',
      );
      repository(a.repository);
      pin(a.revision);
      assert.match(a.weightName, /^[\w.-]+\.safetensors$/u);
      hash(a.sha256);
      scalar(a.scale, 0, 2);
      same(typeof a.configuredName, 'string');
      assert(a.configuredName.length <= 256);
      boundedString(a.actualName, 512);
      if (a.configuredName) same(a.actualName, a.configuredName);
      positive(a.weightBytes);
      positive(a.transformerObjectId);
      positive(a.observedLayers, 4096);
      same(a.observedForwards, o.rawSchedulerSteps);
      assert(a.originalLoadRevision === null || /^[a-f0-9]{40}$/u.test(a.originalLoadRevision));
      same(o.actualGuider.guidance_scale, 1);
      same(
        Object.fromEntries(Object.entries(o.actualScheduler.config).filter(([k]) => !k.startsWith('_'))),
        a.scheduler,
      );
    }
    return 'observed-retained-modular-image-v1:' + canonicalJsonHash(plan);
  } catch {
    return null;
  }
}
function proofMatches(plan, provenance) {
  try {
    assert(resourceId(plan));
    const o = plan.resourceObservation,
      g = provenance.graph.canonicalGraph,
      form = provenance.template.lockedSettings;
    const p = project(
      g.nodes.map((n) => [n.key, n]),
      g.paths,
      form,
      provenance.inputs.items,
    );
    same(p.recipe, o.recipe);
    same(p.graphControlsHash, o.graphControlsHash);
    same(p.formControlsHash, o.formControlsHash);
    same(provenance.template.id, o.templateId);
    same(provenance.taskId, o.taskId);
    same(provenance.runtime.backendSource.fingerprint, o.backendSourceFingerprint);
    same(provenance.runtime.backendContract.fingerprint, o.backendContractFingerprint);
    same(
      p.inputs,
      o.inputs.map(({ role, contentHash, byteSize }) => ({ role, contentHash, byteSize })),
    );
    same(provenance.inputs.count, p.inputs.length);
    same(
      provenance.models.items.map((m) => [m.repoId, m.selectedRevision]).sort(),
      [
        [p.recipe.repository, p.recipe.revision],
        ...(p.adapter ? [[p.adapter.repository, p.adapter.revision]] : []),
      ].sort(),
    );
    same(p.adapter, o.adapter === null ? null : descriptor(o.adapter));
    same(
      o.actualGuider,
      Object.fromEntries(
        Object.entries(p.guide.node.params)
          .filter(([k]) => !['model_type', 'guider', 'layers_config'].includes(k))
          .map(([k]) => [k, p.value(p.guide, k)]),
      ),
    );
    same(o.configuredUnusedFields, {
      formStrength: form.strength,
      genericDenoiserStrengthPresent: Object.hasOwn(p.denoise.node.params, 'strength'),
      genericDenoiserStrength: Object.hasOwn(p.denoise.node.params, 'strength') ? p.value(p.denoise, 'strength') : null,
      formMaxSequenceLength: form.maxSequenceLength,
    });
    same(provenance.output.items.length, 1);
    same(provenance.output.items[0].mediaType, 'image');
    same(provenance.output.items[0].width, p.recipe.geometry.width);
    same(provenance.output.items[0].height, p.recipe.geometry.height);
    same(form.steps, o.rawSchedulerSteps);
    return true;
  } catch {
    return false;
  }
}

export const OBSERVED_RETAINED_MODULAR_IMAGE_SOURCE = SOURCE;
export function observedRetainedModularImagePlan(api, context = {}) {
  try {
    return stableJsonValue(derive(api, context));
  } catch {
    return null;
  }
}
export const observedRetainedModularImageResourceId = resourceId;
export const observedRetainedModularImageProofMatches = proofMatches;
