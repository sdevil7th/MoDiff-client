// Maintainer evidence reader only: no loading, execution, Auto admission or fit.
import assert from 'node:assert/strict';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import { assertFiniteObservedJson, workerGraphHash } from './observed-workflow-auto-resource.mjs';
import { validateAppliedAdapterSection } from './applied-adapter-provenance.mjs';

export const OBSERVED_NATIVE_MODULAR_IMAGE_SOURCE = 'observed-native-modular-image-resource-v1';
const prefix = 'modules.ModularDiffusers.';
const same = (left, right) => assert.deepEqual(stableJsonValue(left), stableJsonValue(right));
const scopes = Object.fromEntries(
  ['ModelsLoader', 'Guider', 'EncodePrompt', 'ImageEncode', 'Denoise', 'DecodeLatents']
    .map((action) => [action, prefix + action])
    .concat([
      ['Load', 'modules.Image.Load'],
      ['Preview', 'modules.Image.Preview'],
      ['StitchImages', 'modules.ImageOperations.StitchImages'],
    ]),
);
const fields = {
  ModelsLoader:
    'model_type repo_id revision reviewed_variant workflow_id dtype device auto_offload offload_mode weight_loading_mode weight_format attention_backend vae_slicing vae_tiling inpaint_compatibility trust_remote_code unet vae controlnet lora_list quant_config text_encoders pipeline_components image_encoder modiff_pipeline_identity refresh_pipeline_identity_button',
  Guider: 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop layers_config',
  EncodePrompt:
    'text_encoders guider prompt prompt_input negative_prompt max_sequence_length image resolution use_en_prompt',
  ImageEncode: 'vae image seed resolution encode_summary',
  Denoise: 'unet scheduler embeddings image_latents guider seed num_inference_steps guidance_scale width height layers',
  DecodeLatents: 'vae latents width height',
  Load: 'file alpha_channel label',
  Preview: 'image vae device preview export',
  StitchImages: 'image layout columns spacing background match_size',
};
const ignored = new Set(['label', 'modiff_pipeline_identity', 'refresh_pipeline_identity_button', 'prompt_input']);
const formKeys =
  'mode modelType resourceMode dtype device autoOffload offloadMode quantizationMode trustRemoteCode randomSeed seed width height steps guidanceScale maxSequenceLength prompt negativePrompt'.split(
    ' ',
  );
const integer = (value) => assert(Number.isSafeInteger(value) && value > 0);
const hash = (value) => assert.match(value, /^[a-f0-9]{64}$/u);
const keys = (value, expected) => same(Object.keys(value).sort(), expected.toSorted());
const kind = (node) => node.module + '.' + node.action;
const encodedHash = (value) => {
  const matched = /^(?:sha256:(?:bytes:)?)?([a-f0-9]{64})$/u.exec(value);
  assert(matched);
  return matched[1];
};

function project(entries, paths, form, artifacts) {
  assert(['edit_image', 'multi_image_reference_edit', 'layer_decomposition'].includes(form.mode));
  const layered = form.mode === 'layer_decomposition',
    multi = form.mode === 'multi_image_reference_edit';
  const pipeline = layered ? 'QwenImageLayeredModularPipeline' : 'FluxKontextModularPipeline';
  same(form.modelType, layered ? pipeline : 'FluxKontextPipeline');
  same(form.resourceMode, layered ? 'auto' : 'expert');
  same(form.dtype, 'bfloat16');
  same(form.device, 'cuda:0');
  same(form.quantizationMode, 'none');
  same(form.trustRemoteCode, false);
  same(form.randomSeed, false);
  same(form.autoOffload, true);
  same(form.offloadMode, layered ? 'model_cpu' : 'group_cpu');
  for (const key of ['width', 'height', 'steps', 'maxSequenceLength']) integer(form[key]);
  assert(Number.isSafeInteger(form.seed) && form.seed >= 0 && form.seed < 2 ** 32);
  assert(Number.isFinite(form.guidanceScale) && form.guidanceScale > 0 && form.guidanceScale <= 100);
  assert(typeof form.prompt === 'string' && form.prompt && typeof form.negativePrompt === 'string');
  if (Object.hasOwn(form, 'weightFormat')) same(form.weightFormat, 'native');
  same(entries.length, multi ? 9 : 8);
  same(paths.length, 1);
  same(new Set(paths[0]).size, entries.length);
  same([...paths[0]].sort(), entries.map(([id]) => id).sort());
  const byScope = new Map(entries.map(([id, node]) => [kind(node), { id, node }]));
  same(byScope.size, entries.length);
  const roles = Object.fromEntries(
    Object.entries(scopes)
      .filter(([role]) => multi || role !== 'StitchImages')
      .map(([role, scope]) => {
        const selected = byScope.get(scope);
        assert(selected, scope);
        return [role, selected];
      }),
  );
  const value = (role, key, optional = false) => {
    const param = roles[role].node.params[key];
    if (optional && param === undefined) return null;
    assert(param && !param.sourceId && !param.sourceKey, role + '.' + key);
    if (!optional) assert(Object.hasOwn(param, 'value'), role + '.' + key);
    return param.value ?? null;
  };
  const connections = new Set();
  const connect = (role, field, producer, port) => {
    const param = roles[role].node.params[field];
    same({ id: param?.sourceId, port: param?.sourceKey }, { id: roles[producer].id, port });
    // Scalar ports retain an inactive UI fallback alongside their connection.
    // The consumed receipt must still identify the actual producer/port.
    if (!(role === 'DecodeLatents' && ['width', 'height'].includes(field))) assert(!Object.hasOwn(param, 'value'));
    assert(paths[0].indexOf(roles[producer].id) < paths[0].indexOf(roles[role].id));
    connections.add(role + '.' + field);
  };
  for (const args of [
    ['EncodePrompt', 'text_encoders', 'ModelsLoader', 'text_encoders'],
    ['EncodePrompt', 'guider', 'Guider', 'guider_out'],
    ['ImageEncode', 'vae', 'ModelsLoader', 'vae_out'],
    ['ImageEncode', 'image', multi ? 'StitchImages' : 'Load', multi ? 'output' : 'image'],
    ['Denoise', 'unet', 'ModelsLoader', 'unet_out'],
    ['Denoise', 'scheduler', 'ModelsLoader', 'scheduler'],
    ['Denoise', 'embeddings', 'EncodePrompt', 'embeddings'],
    ['Denoise', 'image_latents', 'ImageEncode', 'image_latents'],
    ['Denoise', 'guider', 'Guider', 'guider_out'],
    ['DecodeLatents', 'vae', 'ModelsLoader', 'vae_out'],
    ['DecodeLatents', 'latents', 'Denoise', 'latents'],
    ['Preview', 'image', 'DecodeLatents', 'images'],
    ...(multi ? [['StitchImages', 'image', 'Load', 'image']] : []),
    ...(layered ? [['EncodePrompt', 'image', 'Load', 'image']] : []),
  ])
    connect(...args);
  if (!layered)
    for (const key of ['width', 'height']) {
      same(value('Denoise', key), form[key]);
      if (roles.DecodeLatents.node.params[key]?.sourceId) connect('DecodeLatents', key, 'Denoise', 'out_' + key);
      else same(value('DecodeLatents', key), form[key]);
    }
  const presentation = (role, key, param) =>
    !param.sourceId &&
    ((role === 'ImageEncode' &&
      key === 'encode_summary' &&
      param.display === 'ui_text' &&
      param.sourceKey === 'encode_summary_data') ||
      (role === 'Preview' && key === 'preview' && param.display === 'ui_image' && param.sourceKey === 'output'));
  for (const [role, { node }] of Object.entries(roles))
    for (const [key, param] of Object.entries(node.params)) {
      assert(fields[role].split(' ').includes(key), role + '.' + key);
      if (param.sourceId || param.sourceKey)
        assert(connections.has(role + '.' + key) || presentation(role, key, param));
    }
  same(value('ModelsLoader', 'model_type'), pipeline);
  const repo = value('ModelsLoader', 'repo_id'),
    revision = value('ModelsLoader', 'revision');
  same(Object.keys(repo).sort(), ['source', 'value']);
  same(repo.source, 'hub');
  assert.match(repo.value, /^[\w.-]+\/[\w.-]+$/u);
  assert.match(revision, /^[a-f0-9]{40}$/u);
  same(value('ModelsLoader', 'weight_format'), 'native');
  same(value('ModelsLoader', 'trust_remote_code'), false);
  for (const key of [
    'unet',
    'vae',
    'controlnet',
    'lora_list',
    'quant_config',
    'text_encoders',
    'pipeline_components',
    'image_encoder',
  ])
    same(value('ModelsLoader', key, true), null);
  for (const [key, expected] of Object.entries({
    dtype: form.dtype,
    device: form.device,
    auto_offload: true,
    offload_mode: form.offloadMode,
    weight_loading_mode: 'cpu',
    inpaint_compatibility: 'native',
  }))
    same(value('ModelsLoader', key), expected);
  const workflowId = value('ModelsLoader', 'workflow_id');
  assert(['default', 'image_conditioned'].includes(workflowId));
  same(value('Guider', 'model_type'), pipeline);
  for (const [key, expected] of Object.entries({
    guider: 'ClassifierFreeGuidance',
    guidance_scale: form.guidanceScale,
    guidance_rescale: 0,
    use_original_formulation: false,
    enabled: true,
    start: 0,
    stop: 1,
  }))
    same(value('Guider', key), expected);
  same(value('Guider', 'layers_config', true), null);
  same(value('EncodePrompt', 'prompt_input', true), null);
  for (const [key, expected] of Object.entries({
    prompt: form.prompt,
    negative_prompt: form.negativePrompt,
    max_sequence_length: form.maxSequenceLength,
  }))
    same(value('EncodePrompt', key), expected);
  for (const [key, expected] of Object.entries({
    seed: form.seed,
    num_inference_steps: form.steps,
    guidance_scale: form.guidanceScale,
  }))
    same(value('Denoise', key), expected);
  same(value('ImageEncode', 'seed'), form.seed);
  if (layered) {
    same(form.width, form.height);
    integer(form.layers);
    same(value('ImageEncode', 'resolution'), form.width);
    same(value('EncodePrompt', 'resolution'), form.width);
    same(value('Denoise', 'layers'), form.layers);
    assert(typeof value('EncodePrompt', 'use_en_prompt') === 'boolean');
    for (const role of ['Denoise', 'DecodeLatents'])
      for (const key of ['width', 'height']) assert(!Object.hasOwn(roles[role].node.params, key));
  } else {
    assert(!Object.hasOwn(roles.Denoise.node.params, 'layers'));
    for (const key of ['resolution', 'image', 'use_en_prompt'])
      assert(!Object.hasOwn(roles.EncodePrompt.node.params, key));
    assert(!Object.hasOwn(roles.ImageEncode.node.params, 'resolution'));
  }
  if (multi) {
    same(value('StitchImages', 'layout'), 'horizontal_reference');
    same(value('StitchImages', 'columns'), 2);
    same(value('StitchImages', 'spacing'), 0);
    assert(typeof value('StitchImages', 'background') === 'string');
    same(value('StitchImages', 'match_size'), true);
  }
  const files = value('Load', 'file');
  assert(Array.isArray(files));
  same(files.length, multi ? 2 : 1);
  same(artifacts.length, files.length);
  same(new Set(files).size, files.length);
  const references = artifacts.map((artifact, index) => {
    same(artifact.path, files[index]);
    same(artifact.role, `referenceImages[${index}]`);
    assert(typeof artifact.path === 'string' && artifact.path.length <= 16384);
    assert.match(artifact.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
    integer(artifact.byteSize);
    return { role: artifact.role, contentHash: artifact.contentHash, byteSize: artifact.byteSize };
  });
  same(value('Load', 'alpha_channel'), layered ? 'add alpha' : 'ignore');
  assert(['cpu:0', 'cuda:0'].includes(value('Preview', 'device')));
  same(value('Preview', 'vae', true), null);
  // This is the image export-index string, not a boolean model control.
  assert(/^(?:|0|[1-9]\d*)$/u.test(value('Preview', 'export')));
  const labels = new Map(Object.entries(roles).map(([role, { id }]) => [id, role]));
  const graphControls = Object.entries(roles).map(([role, { node }]) => ({
    role,
    scope: kind(node),
    params: Object.fromEntries(
      Object.entries(node.params).map(([key, param]) => [
        key,
        presentation(role, key, param) || (ignored.has(key) && param.display?.startsWith('ui_'))
          ? { presentation: true }
          : param.sourceId
            ? {
                producer: labels.get(param.sourceId),
                port: param.sourceKey,
                ...(Object.hasOwn(param, 'value') ? { inactiveFallback: param.value } : {}),
              }
            : { value: role === 'Load' && key === 'file' ? references : (param.value ?? null) },
      ]),
    ),
  }));
  const formControls = Object.fromEntries([...formKeys, ...(layered ? ['layers'] : [])].map((key) => [key, form[key]]));
  return {
    roles,
    value,
    layered,
    multi,
    pipeline,
    repo: repo.value,
    revision,
    references,
    formControls,
    workflowId,
    graphControlsHash: canonicalJsonHash(graphControls),
  };
}

function validateCaptures(p, captures) {
  const byRole = new Map(captures.map((row) => [row.role, row]));
  same(byRole.size, Object.keys(p.roles).length);
  same(captures.length, byRole.size);
  const expectedKeys = {
    ModelsLoader:
      'model_type repo_id revision dtype device auto_offload offload_mode quant_config weight_loading_mode attention_backend vae_slicing vae_tiling'.split(
        ' ',
      ),
    Guider: 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'.split(' '),
    EncodePrompt: ['prompt', 'negative_prompt', 'max_sequence_length'],
    ImageEncode: ['seed'],
    Denoise: ['seed', 'num_inference_steps', 'guidance_scale', ...(p.layered ? [] : ['width', 'height'])],
    DecodeLatents: p.layered ? [] : ['width', 'height'],
    Preview: ['device'],
    StitchImages: [],
    Load: ['alpha_channel', 'source_hashes', 'source_widths', 'source_heights', 'source_modes'],
  };
  const missing = [];
  for (const [role, { node }] of Object.entries(p.roles)) {
    const row = byRole.get(role);
    assert(row);
    same(row.scope, kind(node));
    keys(row, ['role', 'scope', 'fields', ...(role === 'ModelsLoader' ? ['adapterApplication'] : [])]);
    same(Object.keys(row.fields).sort(), expectedKeys[role].toSorted());
    for (const [key, capture] of Object.entries(row.fields)) {
      const connectedGeometry =
        role === 'DecodeLatents' && ['width', 'height'].includes(key) && node.params[key]?.sourceId;
      if (connectedGeometry) {
        same(Object.keys(capture).sort(), ['source', 'sourcePortId', 'sourceRole', 'value']);
        same(capture.source, 'connected');
        same(capture.sourceRole, 'Denoise');
        same(capture.sourcePortId, 'out_' + key);
      } else {
        same(Object.keys(capture).sort(), ['source', 'value']);
        same(capture.source, 'literal');
      }
      if (role === 'Load' && key !== 'alpha_channel') continue;
      const expected = connectedGeometry
        ? p.formControls[key]
        : key === 'repo_id'
          ? p.repo
          : p.value(role, key, key === 'quant_config');
      same(capture.value, expected);
    }
    for (const [key, param] of Object.entries(node.params))
      if (!param.sourceId && !param.sourceKey && !ignored.has(key) && !Object.hasOwn(row.fields, key))
        missing.push({ role, field: key });
  }
  const load = byRole.get('Load').fields,
    count = p.references.length;
  for (const key of ['source_hashes', 'source_widths', 'source_heights', 'source_modes']) {
    assert(Array.isArray(load[key].value));
    same(load[key].value.length, count);
  }
  same(
    load.source_hashes.value,
    p.references.map((item) => encodedHash(item.contentHash)),
  );
  for (const values of [load.source_widths.value, load.source_heights.value]) for (const size of values) integer(size);
  for (const mode of load.source_modes.value) same(mode, p.layered ? 'RGBA' : 'RGB');
  const application = byRole.get('ModelsLoader').adapterApplication;
  validateAppliedAdapterSection(application);
  if (p.layered) {
    same(application.status, 'complete');
    same(application.observation, 'activated');
    same(application.adapters, []);
  } else {
    same(application.status, 'unavailable');
    assert(['unsupported-owner', 'unobserved-application'].includes(application.reason));
  }
  return missing.sort((a, b) => (a.role + '.' + a.field).localeCompare(b.role + '.' + b.field));
}

function projectedItems(items) {
  assert(Array.isArray(items) && items.length > 0);
  return items.map((item, index) => {
    same(item.index, index);
    integer(item.width);
    integer(item.height);
    integer(item.byteSize);
    assert.match(item.mediaHash, /^sha256:bytes:[a-f0-9]{64}$/u);
    return {
      index,
      width: item.width,
      height: item.height,
      byteSize: item.byteSize,
      byteHash: encodedHash(item.mediaHash),
    };
  });
}

export function deriveObservedNativeModularImagePlan(api, context) {
  const {
    executionReceipt: task,
    executedOutput: output,
    taskId,
    modelIdentities: models,
    inputArtifacts,
    backendSource,
    backendContract,
  } = context;
  // Saved Block metadata can be deeply nested. Only the already lowered,
  // executable envelope uses the observation's shallow finite-value contract.
  assertFiniteObservedJson({ nodes: api.nodes, paths: api.paths });
  same(Object.keys(api).sort(), ['nodes', 'paths', 'runtimeHints', 'sid']);
  const hints = api.runtimeHints,
    form = hints.workflowSnapshot.studioForm;
  const allowedHints =
    'clientRunId runInputHash workflowTabId workflowCanvasEpoch workflowTitle workflowSnapshot resourceMode workflowAutoPlan'.split(
      ' ',
    );
  for (const key of Object.keys(hints)) assert(allowedHints.includes(key));
  same(task.status, 'completed');
  same(task.attempt_index, 0);
  same(task.resourceCandidateId, null);
  same(output.attemptIndex, 0);
  same(task.task_id, output.taskId);
  if (taskId !== undefined) same(taskId, task.task_id);
  for (const [h, t, o] of [
    ['sid', 'sid', 'sid'],
    ['workflowTabId', 'workflow_tab_id', 'workflowTabId'],
    ['clientRunId', 'client_run_id', 'clientRunId'],
    ['runInputHash', 'run_input_hash', 'runInputHash'],
  ]) {
    const identity = h === 'sid' ? api.sid : hints[h];
    assert(typeof identity === 'string' && identity);
    same(task[t], identity);
    same(output[o], identity);
  }
  same(output.apiGraphSnapshot, api);
  same(task.workflow_snapshot, hints.workflowSnapshot);
  same(output.formSnapshot, form);
  assert(
    Number.isFinite(task.started_at) && Number.isFinite(task.completed_at) && task.completed_at >= task.started_at,
  );
  same(backendSource.fingerprint, task.runtimeFingerprint.backendSource.fingerprint);
  same(backendSource.gitCommit, task.runtimeFingerprint.backendSource.gitCommit);
  same(backendSource.files.length, task.runtimeFingerprint.backendSource.fileCount);
  assert.match(backendSource.fingerprint, /^sha256:backend-source-v1:[a-f0-9]{64}$/u);
  assert.match(backendContract.fingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
  const p = project(Object.entries(api.nodes), api.paths, form, inputArtifacts);
  same(models.length, 1);
  same(models[0].repoId, p.repo);
  same(models[0].selectedRevision, p.revision);
  same(models[0].modelRevision, p.repo + '@' + p.revision);
  same(output.nodeId, p.roles.Preview.id);
  const prep = task.runtimePreparation;
  same(prep.resourceMode, form.resourceMode);
  same(prep.performed, false);
  same(prep.cleanup, null);
  assert(typeof prep.residentRecipeReusable === 'boolean');
  if (p.layered) {
    same(hints.resourceMode, 'auto');
    same(hints.workflowAutoPlan.schemaVersion, 1);
    same(hints.workflowAutoPlan.graphHash, workerGraphHash(api));
    same(prep.residentRecipeReusable, false);
    const auto = prep.workflowAuto;
    same(auto.strategy, 'dependency_order_retained_owners');
    same(auto.schedule, null);
    same(auto.cachePreparation, null);
    for (const key of ['reusedOwnerIds', 'preparedDataNodes', 'appliedUpdates', 'releases']) same(auto[key], []);
    for (const [id, values] of Object.entries(auto.resolvedFields)) {
      const role = Object.keys(p.roles).find((name) => p.roles[name].id === id);
      assert(['ModelsLoader', 'EncodePrompt', 'Guider', 'Denoise'].includes(role));
      for (const [key, value] of Object.entries(values)) same(value, p.value(role, key));
    }
  } else {
    assert(hints.resourceMode === undefined || hints.resourceMode === 'expert');
    assert(hints.workflowAutoPlan === undefined);
  }
  const native = output.resolvedExecutionInputs;
  same(native.schemaVersion, 1);
  same(native.source, 'backend-execution');
  same(native.taskId, task.task_id);
  same(native.attemptIndex, 0);
  same(native.nodeId, output.nodeId);
  same(native.truncated, false);
  same(native.uncapturedNodeIds, []);
  for (const key of ['ambiguousFields', 'unavailableFields']) if (native[key] !== undefined) same(native[key], []);
  same(native.graphTasks, [
    { loaderId: p.roles.ModelsLoader.id, pipelineClass: p.pipeline, task: p.layered ? 'layer_decomposition' : null },
  ]);
  same(native.appliedAdaptersStatus, { schemaVersion: 1, truncated: false });
  const rolesById = new Map(Object.entries(p.roles).map(([role, { id }]) => [id, role]));
  same(native.nodes.length, rolesById.size);
  same(new Set(native.nodes.map((row) => row.nodeId)).size, rolesById.size);
  const captures = native.nodes
    .map((row) => {
      const role = rolesById.get(row.nodeId);
      assert(role);
      same(kind(row), kind(p.roles[role].node));
      same(row.omittedFields ?? {}, {});
      const fields = Object.fromEntries(
        Object.entries(row.fields).map(([key, field]) => {
          if (field.source !== 'connected') return [key, structuredClone(field)];
          same(Object.keys(field).sort(), ['source', 'sourceNodeId', 'sourcePortId', 'value']);
          const sourceRole = rolesById.get(field.sourceNodeId);
          assert(sourceRole);
          return [key, { source: field.source, value: field.value, sourceRole, sourcePortId: field.sourcePortId }];
        }),
      );
      return {
        role,
        scope: kind(row),
        fields,
        ...(role === 'ModelsLoader' ? { adapterApplication: structuredClone(row.appliedAdapters) } : {}),
      };
    })
    .sort((a, b) => a.role.localeCompare(b.role));
  const declaredOnlyControls = validateCaptures(p, captures);
  if (native.summary !== undefined) {
    const loader = captures.find((row) => row.role === 'ModelsLoader').fields;
    const load = captures.find((row) => row.role === 'Load').fields;
    const expected = {
      modelType: p.pipeline,
      repo: p.repo,
      revision: p.revision,
      dtype: loader.dtype.value,
      device: loader.device.value,
      autoOffload: loader.auto_offload.value,
      offloadMode: loader.offload_mode.value,
      quantConfig: null,
      weightLoadingMode: 'cpu',
      attentionBackend: loader.attention_backend.value,
      vaeSlicing: loader.vae_slicing.value,
      vaeTiling: loader.vae_tiling.value,
      width: form.width,
      height: form.height,
      prompt: form.prompt,
      negativePrompt: form.negativePrompt,
      maxSequenceLength: form.maxSequenceLength,
      seed: form.seed,
      steps: form.steps,
      guidanceScale: form.guidanceScale,
      guiderType: 'ClassifierFreeGuidance',
      guidanceRescale: 0,
      guidanceOriginalFormulation: false,
      guidanceEnabled: true,
      guidanceStart: 0,
      guidanceStop: 1,
      imageAlphaChannel: load.alpha_channel.value,
      imageSourceHashes: load.source_hashes.value,
      imageSourceWidths: load.source_widths.value,
      imageSourceHeights: load.source_heights.value,
      imageSourceModes: load.source_modes.value,
    };
    // Corroborate available summaries; never create absent summary fields.
    for (const [key, value] of Object.entries(expected))
      if (Object.hasOwn(native.summary, key)) same(native.summary[key], value);
  }
  const items = projectedItems(output.mediaItems);
  same(items.length, p.layered ? form.layers : 1);
  for (const item of items) {
    same(item.width, form.width);
    same(item.height, form.height);
  }
  const observation = {
    schemaVersion: 1,
    taskId: task.task_id,
    attemptIndex: 0,
    completedAt: task.completed_at,
    graphControlsHash: p.graphControlsHash,
    formControls: p.formControls,
    references: p.references,
    capturedNodes: captures,
    declaredOnlyControls,
    reportedGraphTask: p.layered ? 'layer_decomposition' : null,
    nativeReceiptHash: canonicalJsonHash(native),
    nativeItems: items,
    backendSourceFingerprint: backendSource.fingerprint,
    backendContractFingerprint: backendContract.fingerprint,
    residentRecipeReusable: prep.residentRecipeReusable,
    adapterApplicationObserved: p.layered,
    completeFieldAccountingClaimed: false,
    hardwareQualificationClaimed: false,
  };
  const loader = captures.find((row) => row.role === 'ModelsLoader').fields;
  return {
    source: OBSERVED_NATIVE_MODULAR_IMAGE_SOURCE,
    modelType: p.pipeline,
    modelRepo: p.repo,
    modelRevision: p.revision,
    task: form.mode,
    dtype: loader.dtype.value,
    device: loader.device.value,
    autoOffload: loader.auto_offload.value,
    offloadMode: loader.offload_mode.value,
    weightLoadingMode: loader.weight_loading_mode.value,
    resourceMode: form.resourceMode,
    resolvedResourceMode: form.resourceMode,
    quantizationMode: 'none',
    quantizedComponents: [],
    resourceObservation: observation,
  };
}

export function observedNativeModularImagePlan(api, context = {}) {
  try {
    const plan = deriveObservedNativeModularImagePlan(api, context);
    assert(observedNativeModularImageResourceId(plan));
    return plan;
  } catch {
    return null;
  }
}

export function observedNativeModularImageResourceId(plan) {
  try {
    assertFiniteObservedJson(plan);
    assert(Buffer.byteLength(JSON.stringify(plan)) <= 65536);
    keys(
      plan,
      'source modelType modelRepo modelRevision task dtype device autoOffload offloadMode weightLoadingMode resourceMode resolvedResourceMode quantizationMode quantizedComponents resourceObservation'.split(
        ' ',
      ),
    );
    same(plan.source, OBSERVED_NATIVE_MODULAR_IMAGE_SOURCE);
    same(plan.resourceMode, plan.resolvedResourceMode);
    same(plan.quantizationMode, 'none');
    same(plan.quantizedComponents, []);
    const o = plan.resourceObservation;
    same(o.schemaVersion, 1);
    same(o.attemptIndex, 0);
    keys(
      o,
      'schemaVersion taskId attemptIndex completedAt graphControlsHash formControls references capturedNodes declaredOnlyControls reportedGraphTask nativeReceiptHash nativeItems backendSourceFingerprint backendContractFingerprint residentRecipeReusable adapterApplicationObserved completeFieldAccountingClaimed hardwareQualificationClaimed'.split(
        ' ',
      ),
    );
    same(o.completeFieldAccountingClaimed, false);
    same(o.hardwareQualificationClaimed, false);
    for (const digest of [o.graphControlsHash, o.nativeReceiptHash]) hash(digest);
    assert(typeof o.taskId === 'string' && o.taskId && Number.isFinite(o.completedAt));
    same(plan.task, o.formControls.mode);
    same(plan.resourceMode, o.formControls.resourceMode);
    same(plan.dtype, o.formControls.dtype);
    same(plan.device, o.formControls.device);
    same(plan.autoOffload, o.formControls.autoOffload);
    same(plan.offloadMode, o.formControls.offloadMode);
    same(plan.weightLoadingMode, 'cpu');
    assert.match(o.backendSourceFingerprint, /^sha256:backend-source-v1:[a-f0-9]{64}$/u);
    assert.match(o.backendContractFingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
    assert(typeof o.residentRecipeReusable === 'boolean');
    same(o.adapterApplicationObserved, plan.task === 'layer_decomposition');
    return 'observed-native-image-v1:' + canonicalJsonHash(plan);
  } catch {
    return null;
  }
}

export function assertNativeModularImageProof(plan, provenance) {
  assert(observedNativeModularImageResourceId(plan));
  const o = plan.resourceObservation;
  const p = project(
    provenance.graph.canonicalGraph.nodes.map((node) => [node.key, node]),
    provenance.graph.canonicalGraph.paths,
    o.formControls,
    provenance.inputs.items,
  );
  same(p.graphControlsHash, o.graphControlsHash);
  same(p.references, o.references);
  same(validateCaptures(p, o.capturedNodes), o.declaredOnlyControls);
  same(p.pipeline, plan.modelType);
  same(p.repo, plan.modelRepo);
  same(p.revision, plan.modelRevision);
  same(o.taskId, provenance.taskId);
  same(new Date(o.completedAt * 1000).toISOString(), provenance.capturedAt);
  same(o.backendSourceFingerprint, provenance.runtime.backendSource.fingerprint);
  same(o.backendContractFingerprint, provenance.runtime.backendContract.fingerprint);
  same(provenance.models.items.length, 1);
  const model = provenance.models.items[0];
  same(model.repoId, p.repo);
  same(model.selectedRevision, p.revision);
  same(model.modelRevision, p.repo + '@' + p.revision);
  const items = provenance.output.items.map((item, index) => ({
    index,
    width: item.width,
    height: item.height,
    byteSize: item.byteSize,
    byteHash: encodedHash(item.encodedSha256),
  }));
  same(items, o.nativeItems);
  same(items.length, p.layered ? o.formControls.layers : 1);
  same(o.adapterApplicationObserved, p.layered);
  same(o.reportedGraphTask, p.layered ? 'layer_decomposition' : null);
  return true;
}

export function observedNativeModularImageProofMatches(plan, provenance) {
  try {
    return assertNativeModularImageProof(plan, provenance);
  } catch {
    return false;
  }
}
