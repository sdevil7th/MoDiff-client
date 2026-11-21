// Maintainer provenance inspection only. Never executes, plans or admits a model.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import { assertFiniteObservedJson, workerGraphHash } from './observed-workflow-auto-resource.mjs';

export const OBSERVED_NATIVE_AUTO_VIDEO_SOURCE = 'observed-native-auto-video-stages-v1';

const same = (a, b) => assert.deepEqual(stableJsonValue(a), stableJsonValue(b));
const kind = (n) => `${n.module}.${n.action}`;
const value = (n, key) => n.params?.[key]?.value;
const repo = (v) => (v?.source === 'hub' ? v.value : typeof v === 'string' ? v : null);
const standardScopes = new Set([
  ...['LoadPipeline', 'EncodeInputs', 'Denoise', 'DecodeLatents'].flatMap((a) =>
    ['modules.DiffusersImage', 'modules.DiffusersVideo'].map((m) => `${m}.${a}`),
  ),
  'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  'modules.Image.Load',
  'modules.Image.Preview',
  'modules.Video.Load',
  'modules.Video.Export',
  'modules.Video.ExportAsset',
  'modules.Video.Concatenate',
  'modules.VideoConditioning.Normalize',
  'modules.VideoConditioning.Storyboard',
  'modules.VideoConditioning.ShotPrompt',
  'modules.VideoConditioning.ShotInputs',
  'modules.Primitive.ToList',
  'modules.Spandrel.Upscaler',
]);
const audiovisualScopes = new Set([
  ...standardScopes,
  'modules.DiffusersAudio.LoadPipeline',
  'modules.DiffusersAudio.Generate',
  'modules.Audio.FitDuration',
  'modules.Audio.Export',
  'modules.Video.Trim',
  'modules.Video.LyricOverlay',
  'modules.Video.ExportWithAudio',
]);
const nativeAutoScopes = new Set([
  ...[...standardScopes].filter((s) => !s.startsWith('modules.DiffusersImage.') && s !== 'modules.Image.Preview'),
  'modules.DiffusersVideo.Generate',
  'modules.Video.ConcatenateAssets',
  'modules.VideoConditioning.OutpaintCanvas',
  'modules.VideoConditioning.AlignMask',
]);
const reviewedNativeVideo = {
  LTXConditionPipeline: ['Lightricks/LTX-Video-0.9.8-13B-distilled', '7c64400e1861cc0d7b98d570a1926d5408ec60cd'],
  WanPipeline: ['Wan-AI/Wan2.1-T2V-1.3B-Diffusers', '0fad780a534b6463e45facd96134c9f345acfa5b'],
  WanVideoToVideoPipeline: ['Wan-AI/Wan2.1-T2V-1.3B-Diffusers', '0fad780a534b6463e45facd96134c9f345acfa5b'],
  WanVACEPipeline: ['Wan-AI/Wan2.1-VACE-1.3B-diffusers', 'ec4d2cb062b548996b179d493fdd05340de702a1'],
};

export function capturedNativeGraphSubmission(submission) {
  assert.equal(submission?.method, 'POST');
  const url = new URL(submission.url);
  same(
    [url.protocol, url.hostname, url.pathname, url.search, url.hash, url.username, url.password],
    ['http:', '127.0.0.1', '/graph', '', '', '', ''],
  );
  assert.equal(submission.contentType?.split(';')[0].trim().toLowerCase(), 'application/json');
  assert.equal(typeof submission.body, 'string');
  const byteSize = Buffer.byteLength(submission.body, 'utf8');
  assert(byteSize > 0 && byteSize <= 16 * 1024 ** 2);
  const api = JSON.parse(submission.body);
  // A saved visual hierarchy is deeper than a resource plan. Bound this
  // captured request separately; retain the stricter resource-plan checks.
  const pending = [[api, 0]];
  let visited = 0;
  while (pending.length) {
    const [item, depth] = pending.pop();
    assert(depth <= 64 && ++visited <= 250000);
    if (typeof item === 'number') assert(Number.isFinite(item));
    if (item && typeof item === 'object') {
      assert(Object.keys(item).length <= 2048);
      for (const value of Object.values(item)) pending.push([value, depth + 1]);
    }
  }
  return {
    api,
    record: {
      source: 'captured-native-graph-post-v1',
      method: 'POST',
      url: url.href,
      contentType: submission.contentType,
      body: submission.body,
      byteSize,
      sha256: 'sha256:bytes:' + createHash('sha256').update(submission.body, 'utf8').digest('hex'),
    },
  };
}

function nativeVideoStructure(nodes, mode) {
  const entries = Object.entries(nodes);
  assert(entries.length >= 5 && entries.length <= 80);
  for (const [, node] of entries) assert(nativeAutoScopes.has(kind(node)));
  const single = (scope) => {
    const rows = entries.filter(([, node]) => kind(node) === scope);
    same(rows.length, 1);
    return { id: rows[0][0], node: rows[0][1] };
  };
  const owner = single('modules.DiffusersVideo.LoadPipeline');
  const recipe = single('modules.DiffusersRuntime.DiffusersExecutionRecipe');
  const quant = single('modules.DiffusersRuntime.PipelineQuantizationConfigV2');
  const wire = (node, field, id, port) =>
    same([node.params[field]?.sourceId, node.params[field]?.sourceKey], [id, port]);
  wire(owner.node, 'execution_recipe', recipe.id, 'execution_recipe');
  wire(recipe.node, 'quantization_config', quant.id, 'quantization_config');
  same(value(quant.node, 'backend'), 'none');
  same(value(quant.node, 'dtype'), 'bfloat16');
  const samplers = entries.filter(([, n]) =>
    ['modules.DiffusersVideo.Denoise', 'modules.DiffusersVideo.Generate'].includes(kind(n)),
  );
  const decoders = entries.filter(([, n]) => kind(n) === 'modules.DiffusersVideo.DecodeLatents');
  assert(samplers.length >= 1 && samplers.length <= 9);
  same(decoders.length, samplers.filter(([, n]) => n.action === 'Denoise').length);
  for (const [id, node] of samplers) {
    wire(node, 'pipeline', owner.id, 'pipeline');
    same(value(node, 'mode'), mode);
    const encodingId = node.params.encoded_inputs?.sourceId,
      encode = nodes[encodingId];
    same(kind(encode), 'modules.DiffusersVideo.EncodeInputs');
    wire(node, 'encoded_inputs', encodingId, 'encoded_inputs');
    wire(encode, 'pipeline', owner.id, 'pipeline');
    same(value(encode, 'mode'), mode);
    if (value(owner.node, 'pipeline_class') === 'WanVideoToVideoPipeline') {
      assert(['video_to_video', 'video_color_edit'].includes(mode));
      same(samplers.length, 1);
      const normalizeId = encode.params.video?.sourceId,
        normalize = nodes[normalizeId];
      same(kind(normalize), 'modules.VideoConditioning.Normalize');
      wire(encode, 'video', normalizeId, 'output');
      const sourceId = normalize.params.video?.sourceId;
      same(kind(nodes[sourceId]), 'modules.Video.Load');
      wire(normalize, 'video', sourceId, 'video');
    }
    if (node.action === 'Generate') {
      same(value(owner.node, 'pipeline_class'), 'WanVACEPipeline');
      same(value(node, 'output_type'), 'pil');
    } else {
      const matches = decoders.filter(([, n]) => n.params.latents?.sourceId === id);
      same(matches.length, 1);
      const decode = matches[0][1];
      wire(decode, 'pipeline', owner.id, 'pipeline');
      wire(decode, 'latents', id, 'latents_out');
      wire(decode, 'latent_binding', id, 'latent_binding');
      same(value(decode, 'output_type'), 'pil');
    }
  }
  same(
    entries.filter(([, n]) => ['modules.Video.Export', 'modules.Video.ConcatenateAssets'].includes(kind(n))).length,
    1,
  );
  return { owner, recipe };
}

function nativeVideoModels(nodes, models, owner) {
  const repository = repo(value(owner, 'model_id')),
    revision = value(owner, 'revision');
  same([repository, revision], reviewedNativeVideo[value(owner, 'pipeline_class')]);
  const expected = new Map([[repository, revision]]);
  for (const node of Object.values(nodes))
    if (kind(node) === 'modules.Spandrel.Upscaler') {
      const artifact = value(node, 'model_id');
      for (const [key, wanted] of Object.entries({
        source: 'hub',
        value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
        revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
        sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
        byteSize: 67061725,
      }))
        same(artifact?.[key], wanted);
      expected.set('nateraw/real-esrgan', artifact.revision);
    }
  same(models.map((m) => m.repoId).sort(), [...expected.keys()].sort());
  for (const model of models) same(model.selectedRevision, expected.get(model.repoId));
}
const audioScopes = new Set([
  'modules.ModularDiffusers.ModelsLoader',
  'modules.ModularDiffusers.WorkflowSemanticGeneration',
  'modules.ModularDiffusers.WorkflowDenoise',
  'modules.ModularDiffusers.WorkflowDecodeAudio',
  'modules.Audio.Export',
]);

function equalLiteral(actual, requested, field) {
  if (field === 'negative_prompt' && requested === '' && actual === null) return;
  if (requested?.source === 'hub') return same(actual, requested.value);
  // Ordinary numeric widgets persist strings; compare only to a captured number.
  if (typeof actual === 'number' && typeof requested === 'string' && /^-?\d+(?:\.\d+)?$/u.test(requested))
    return same(actual, Number(requested));
  return same(actual, requested);
}

function inspect(api, context, modularAudio, modularImage = false, observedAuto = false) {
  const { executionReceipt: task, executedOutput: output, taskId, modelIdentities, resolvedModelRepos } = context;
  const hints = api.runtimeHints;
  const snapshot = hints?.workflowSnapshot;
  const resourceMode = observedAuto ? 'auto' : 'expert';
  const audiovisual =
    !observedAuto &&
    !modularAudio &&
    !modularImage &&
    Object.values(api.nodes).some((node) => kind(node) === 'modules.DiffusersAudio.LoadPipeline') &&
    Object.values(api.nodes).some((node) => kind(node) === 'modules.DiffusersVideo.LoadPipeline');
  assert.equal(snapshot?.studioForm?.resourceMode, resourceMode);
  assert.equal(task.status, 'completed');
  assert.equal(task.attempt_index, 0);
  assert.equal(output.attemptIndex, 0);
  assert.equal(task.task_id, taskId);
  assert.equal(output.taskId, taskId);
  assert.equal(task.resourceCandidateId ?? null, null);
  // Older manual multi-owner tasks omitted preparation metadata. Their two
  // loaders' native consumed controls are the authority; no Auto claim follows.
  if (!audiovisual || task.runtimePreparation?.resourceMode !== undefined)
    assert.equal(task.runtimePreparation?.resourceMode, resourceMode);
  same(task.workflow_snapshot, snapshot);
  let graphSubmission = null;
  if (output.apiGraphSnapshot === undefined && observedAuto && context.nativeGraphSubmission) {
    const submission = capturedNativeGraphSubmission(context.nativeGraphSubmission);
    same(submission.api, api);
    graphSubmission = submission.record;
  } else same(output.apiGraphSnapshot, api);
  same(output.formSnapshot, snapshot.studioForm);
  for (const [key, a, b] of [
    ['sid', 'sid', 'sid'],
    ['workflowTabId', 'workflow_tab_id', 'workflowTabId'],
    ['clientRunId', 'client_run_id', 'clientRunId'],
    ['runInputHash', 'run_input_hash', 'runInputHash'],
  ]) {
    const expected = key === 'sid' ? api.sid : hints[key];
    assert.equal(typeof expected, 'string');
    assert(expected.length > 0);
    same(task[a], expected);
    same(output[b], expected);
  }
  assert(!api.loops && !api.loopContexts);
  const entries = Object.entries(api.nodes);
  assert(entries.length >= 5 && entries.length <= 80);
  assert(api.paths.length >= 1 && api.paths.length <= (audiovisual ? 11 : 10));
  same([...new Set(api.paths.flat())].sort(), entries.map(([id]) => id).sort());
  for (const order of api.paths) assert.equal(new Set(order).size, order.length);
  const workflowImageScopes = new Set(
    ['ModelsLoader', 'WorkflowTextEncode', 'WorkflowImageDenoise', 'WorkflowDecodeImage']
      .map((action) => `modules.ModularDiffusers.${action}`)
      .concat('modules.Image.Preview'),
  );
  const allowed = observedAuto
    ? nativeAutoScopes
    : modularAudio
      ? audioScopes
      : modularImage
        ? workflowImageScopes
        : audiovisual
          ? audiovisualScopes
          : new Set([...standardScopes, 'modules.Text.ProcessText']);
  for (const [id, node] of entries) {
    assert(allowed.has(kind(node)), kind(node));
    for (const p of Object.values(node.params)) {
      if (p.sourceId) {
        assert(api.nodes[p.sourceId]);
        assert.equal(typeof p.sourceKey, 'string');
        assert(p.sourceKey.length > 0);
        assert(
          api.paths.some(
            (order) =>
              order.includes(id) && order.includes(p.sourceId) && order.indexOf(p.sourceId) < order.indexOf(id),
          ),
        );
      }
    }
  }
  const receipt = output.resolvedExecutionInputs;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.source, 'backend-execution');
  assert.equal(receipt.taskId, taskId);
  assert.equal(receipt.nodeId, output.nodeId);
  assert.equal(receipt.attemptIndex, 0);
  assert.equal(receipt.truncated, false);
  same(receipt.uncapturedNodeIds, []);
  const captured = new Map(receipt.nodes.map((n) => [n.nodeId, n]));
  assert.equal(captured.size, receipt.nodes.length);
  const ancestors = new Set();
  const visit = (id) => {
    if (ancestors.has(id)) return;
    ancestors.add(id);
    for (const p of Object.values(api.nodes[id].params)) if (p.sourceId) visit(p.sourceId);
  };
  visit(output.nodeId);
  same([...captured.keys()].sort(), [...ancestors].sort());
  for (const [id, node] of entries) {
    if (ancestors.has(id)) continue;
    // A multi-shot export also saves each completed source shot. These terminal
    // siblings do not alter the assembled film's resource owner or ancestry.
    assert(
      ['modules.Video.Export', 'modules.Video.ExportAsset', ...(audiovisual ? ['modules.Audio.Export'] : [])].includes(
        kind(node),
      ),
    );
    assert(Object.values(node.params).some((p) => p.sourceId && ancestors.has(p.sourceId)));
  }
  for (const [id, node] of entries) {
    const row = captured.get(id);
    if (!row) continue;
    same([row.module, row.action], [node.module, node.action]);
    for (const [field, observed] of Object.entries(row.fields)) {
      const parameter = node.params[field];
      // Resource identity is narrower than complete field accounting. Inactive
      // strength and upstream-capped text lengths retain their distinct requested
      // and effective records; they must not be relabelled as consumed literals.
      const resourceField = [
        'repo_id',
        'model_id',
        'revision',
        'pipeline_class',
        'model_type',
        'dtype',
        'device',
        'auto_offload',
        'offload_mode',
        'backend',
        'weight_format',
        'weight_loading_mode',
        'trust_remote_code',
      ].includes(field);
      if (resourceField && parameter && Object.hasOwn(parameter, 'value') && !parameter.sourceId) {
        assert.equal(observed.source, 'literal');
        equalLiteral(observed.value, parameter.value, field);
      }
    }
  }
  const single = (scope) => {
    const rows = entries.filter(([, n]) => kind(n) === scope);
    assert.equal(rows.length, 1, scope);
    return { id: rows[0][0], node: rows[0][1] };
  };
  const requireCaptured = (role, fields) => {
    for (const field of fields) {
      const p = role.node.params[field];
      assert(p, field);
      const observed = captured.get(role.id).fields[field];
      assert(observed && !Object.hasOwn(captured.get(role.id).omittedFields ?? {}, field), field);
      if (p.sourceId) {
        same(observed.source, 'connected');
        same(observed.sourceNodeId, p.sourceId);
        same(observed.sourcePortId, p.sourceKey);
      } else {
        assert(Object.hasOwn(p, 'value'), field);
        assert.equal(observed.source, 'literal');
        equalLiteral(observed.value, p.value, field);
      }
    }
  };
  const wire = (consumer, field, producer, port) =>
    same(
      { nodeId: consumer.node.params[field]?.sourceId, port: consumer.node.params[field]?.sourceKey },
      { nodeId: producer.id, port },
    );
  const owner = single(
    modularAudio || modularImage
      ? 'modules.ModularDiffusers.ModelsLoader'
      : `${entries.some(([, n]) => n.module === 'modules.DiffusersVideo') ? 'modules.DiffusersVideo' : 'modules.DiffusersImage'}.LoadPipeline`,
  );
  const ownerRepo = repo(value(owner.node, modularAudio || modularImage ? 'repo_id' : 'model_id'));
  const revision = value(owner.node, 'revision');
  assert.match(ownerRepo, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const pipelineClass = value(owner.node, modularAudio || modularImage ? 'model_type' : 'pipeline_class');
  assert.match(pipelineClass, /^[A-Za-z]\w*Pipeline$/u);
  const jsonSuppliers = entries.filter(([, node]) => kind(node) === 'modules.Text.ProcessText');
  if (jsonSuppliers.length) {
    same(jsonSuppliers.length, 1);
    same(pipelineClass, 'FluxReduxPipeline');
    same(snapshot.studioForm.mode, 'multi_image_reference_edit');
    const supplier = jsonSuppliers[0][1];
    same(value(supplier, 'pipeline_class'), 'BuiltinDataOperationV1');
    same(value(supplier, 'operation'), 'data_conversion');
    same(value(supplier, 'target_type'), 'json');
    assert(typeof value(supplier, 'source') === 'string' && value(supplier, 'source').length <= 16384);
    assert(!supplier.params.source.sourceId);
    const weights = JSON.parse(value(supplier, 'source'));
    assert(Array.isArray(weights) && weights.length > 0 && weights.length <= 32);
    assert(weights.every((weight) => typeof weight === 'number' && Number.isFinite(weight)));
    const encode = single('modules.DiffusersImage.EncodeInputs');
    for (const field of ['prompt_embeds_scale', 'pooled_prompt_embeds_scale']) {
      wire(encode, field, { id: jsonSuppliers[0][0] }, 'output');
      requireCaptured(encode, [field]);
      same(captured.get(encode.id).fields[field].value, weights);
    }
  }
  same(receipt.graphTasks, [
    { loaderId: owner.id, pipelineClass, task: audiovisual ? 'image_to_video' : snapshot.studioForm.mode },
  ]);
  requireCaptured(owner, [
    modularAudio || modularImage ? 'repo_id' : 'model_id',
    'revision',
    modularAudio || modularImage ? 'model_type' : 'pipeline_class',
    'dtype',
    'device',
    'offload_mode',
    'auto_offload',
  ]);
  const primary = modelIdentities.find((m) => m.repoId === ownerRepo);
  assert(primary);
  same(primary.selectedRevision, revision);
  const dependencyEvidence = context.modelDependencyEvidence;
  const extraModels = modelIdentities.filter((m) => !resolvedModelRepos.includes(m.repoId));
  if (extraModels.length) {
    // Some reviewed backend adapters load a separately pinned dependency that
    // is not an editable graph loader. Require an explicit source-bound audit,
    // rather than dropping it from the complete executed model set.
    assert(dependencyEvidence);
    same(dependencyEvidence.pipelineClass, pipelineClass);
    same(dependencyEvidence.ownerRepoId, ownerRepo);
    same(dependencyEvidence.backendSourceFingerprint, context.backendSource.fingerprint);
    assert(dependencyEvidence.implementationFiles.length > 0);
    for (const file of dependencyEvidence.implementationFiles) {
      const source = context.backendSource.files.find((f) => f.path === file.path);
      assert(source);
      same(source.sha256, file.sha256);
    }
    same(
      dependencyEvidence.models,
      extraModels.map((m) => ({ repoId: m.repoId, revision: m.selectedRevision })),
    );
  } else assert(!dependencyEvidence || dependencyEvidence.models.length === 0);
  same(
    modelIdentities
      .filter((m) => !extraModels.includes(m))
      .map((m) => m.repoId)
      .sort(),
    [...resolvedModelRepos].sort(),
  );
  for (const m of modelIdentities) {
    assert.match(m.selectedRevision, /^[a-f0-9]{40}$/u);
    same(m.modelRevision, `${m.repoId}@${m.selectedRevision}`);
    assert(m.fingerprint);
  }
  assert.equal(value(owner.node, 'dtype'), 'bfloat16');
  let recipe = null;
  let audioOwner = null;
  const sourceVideoGeometry = [];
  if (modularImage) {
    same(snapshot.studioForm.mode, 'text_to_image');
    same(entries.length, 5);
    same(value(owner.node, 'weight_format'), 'native');
    same(value(owner.node, 'weight_loading_mode'), 'cpu');
    same(value(owner.node, 'trust_remote_code'), false);
    const quant = owner.node.params.quant_config;
    assert(quant && !quant.sourceId && !quant.sourceKey);
    assert(quant.value === undefined || quant.value === null);
    same(captured.get(owner.id).fields.quant_config, { source: 'literal', value: null });
    assert(!Object.hasOwn(captured.get(owner.id).omittedFields ?? {}, 'quant_config'));
    requireCaptured(owner, ['weight_loading_mode']);
    for (const key of ['unet', 'vae', 'controlnet', 'lora_list', 'modiff_pipeline_identity']) {
      const parameter = owner.node.params[key];
      assert(!parameter?.sourceId && !parameter?.sourceKey);
      assert(parameter?.value === undefined || parameter?.value === null);
    }
    const encode = single('modules.ModularDiffusers.WorkflowTextEncode');
    const denoise = single('modules.ModularDiffusers.WorkflowImageDenoise');
    const decode = single('modules.ModularDiffusers.WorkflowDecodeImage');
    const preview = single('modules.Image.Preview');
    for (const role of [encode, denoise, decode]) {
      requireCaptured(role, ['pipeline_class']);
      same(value(role.node, 'pipeline_class'), pipelineClass);
      wire(role, 'pipeline_components', owner, 'pipeline_components');
      same(value(role.node, 'workflow_id'), value(owner.node, 'workflow_id'));
    }
    same(value(owner.node, 'workflow_id'), 'text2image');
    requireCaptured(encode, ['prompt']);
    requireCaptured(denoise, ['width', 'height', 'seed', 'min_generation_area']);
    wire(denoise, 'state_in', encode, 'state_out');
    wire(decode, 'state_in', denoise, 'state_out');
    wire(preview, 'image', decode, 'images');
    same(output.nodeId, preview.id);
  } else if (modularAudio) {
    same(snapshot.studioForm.mode, 'text_to_audio');
    same(entries.length, 5);
    same(value(owner.node, 'weight_format'), 'native');
    same(value(owner.node, 'weight_loading_mode'), 'cpu');
    same(value(owner.node, 'trust_remote_code'), false);
    const semantic = single('modules.ModularDiffusers.WorkflowSemanticGeneration');
    const denoise = single('modules.ModularDiffusers.WorkflowDenoise');
    const decode = single('modules.ModularDiffusers.WorkflowDecodeAudio');
    const exported = single('modules.Audio.Export');
    for (const r of [semantic, denoise, decode]) {
      same(value(r.node, 'pipeline_class'), pipelineClass);
      wire(r, 'pipeline_components', owner, 'pipeline_components');
    }
    requireCaptured(semantic, ['pipeline_class', 'prompt', 'audio_duration', 'seed']);
    requireCaptured(denoise, ['pipeline_class', 'num_inference_steps']);
    wire(denoise, 'state_in', semantic, 'state_out');
    wire(decode, 'state_in', denoise, 'state_out');
    wire(exported, 'audio', decode, 'audio');
    same(output.nodeId, exported.id);
  } else {
    recipe = audiovisual
      ? {
          id: owner.node.params.execution_recipe?.sourceId,
          node: api.nodes[owner.node.params.execution_recipe?.sourceId],
        }
      : single('modules.DiffusersRuntime.DiffusersExecutionRecipe');
    assert(recipe.node && kind(recipe.node) === 'modules.DiffusersRuntime.DiffusersExecutionRecipe');
    const quant = audiovisual
      ? {
          id: recipe.node.params.quantization_config?.sourceId,
          node: api.nodes[recipe.node.params.quantization_config?.sourceId],
        }
      : single('modules.DiffusersRuntime.PipelineQuantizationConfigV2');
    assert(quant.node && kind(quant.node) === 'modules.DiffusersRuntime.PipelineQuantizationConfigV2');
    wire(owner, 'execution_recipe', recipe, 'execution_recipe');
    wire(recipe, 'quantization_config', quant, 'quantization_config');
    same(value(quant.node, 'backend'), 'none');
    same(value(quant.node, 'dtype'), 'bfloat16');
    requireCaptured(quant, ['dtype']);
    requireCaptured(recipe, ['offload_mode', 'device']);
    same(value(recipe.node, 'offload_mode'), value(owner.node, 'offload_mode'));
    same(value(recipe.node, 'device'), value(owner.node, 'device'));
    const module = owner.node.module;
    const denoisers = entries.filter(([, n]) => kind(n) === `${module}.Denoise`);
    const renders = observedAuto ? entries.filter(([, n]) => kind(n) === `${module}.Generate`) : [];
    assert(denoisers.length + renders.length >= 1 && denoisers.length + renders.length <= 9);
    if (renders.length) {
      same(pipelineClass, 'WanVACEPipeline');
      same(denoisers.length, 0);
      same(renders.length, 1);
    }
    const decoders = entries.filter(([, n]) => kind(n) === `${module}.DecodeLatents`);
    same(decoders.length, denoisers.length);
    for (const [id, node] of [...denoisers, ...renders]) {
      const denoise = { id, node };
      wire(denoise, 'pipeline', owner, 'pipeline');
      const encodeId = node.params.encoded_inputs?.sourceId;
      assert.equal(kind(api.nodes[encodeId]), `${module}.EncodeInputs`);
      const encode = { id: encodeId, node: api.nodes[encodeId] };
      wire(encode, 'pipeline', owner, 'pipeline');
      if (observedAuto) {
        same(value(encode.node, 'mode'), snapshot.studioForm.mode);
        same(captured.get(encode.id).fields.executed_task, { source: 'literal', value: snapshot.studioForm.mode });
        same(captured.get(denoise.id).fields.executed_task, { source: 'literal', value: snapshot.studioForm.mode });
      }
      requireCaptured(denoise, ['width', 'height', 'num_inference_steps', 'guidance_scale', 'seed']);
      if (Object.hasOwn(encode.node.params.prompt ?? {}, 'value')) requireCaptured(encode, ['prompt']);
      if (renders.some(([key]) => key === id)) {
        requireCaptured(denoise, ['output_type', 'num_frames']);
        same(value(node, 'output_type'), 'pil');
        same(value(node, 'mode'), snapshot.studioForm.mode);
        continue;
      }
      const latentPort = 'latents_out';
      const matches = decoders.filter(
        ([, n]) => n.params.latents?.sourceId === id && n.params.latents?.sourceKey === latentPort,
      );
      same(matches.length, 1);
      wire({ id: matches[0][0], node: matches[0][1] }, 'pipeline', owner, 'pipeline');
      if (audiovisual) {
        requireCaptured(denoise, ['num_frames']);
        wire({ id: matches[0][0], node: matches[0][1] }, 'latent_binding', denoise, 'latent_binding');
      }
      if (observedAuto) {
        const decode = { id: matches[0][0], node: matches[0][1] };
        wire(decode, 'latent_binding', denoise, 'latent_binding');
        requireCaptured(decode, ['output_type']);
        same(value(decode.node, 'output_type'), 'pil');
        if (pipelineClass === 'WanVideoToVideoPipeline') {
          // The official call consumes source video, not the inactive form's
          // num_frames. Bind the actual encoded length to its normalization.
          requireCaptured(denoise, ['strength']);
          const normalizeId = encode.node.params.video?.sourceId;
          const normalize = { id: normalizeId, node: api.nodes[normalizeId] };
          assert(normalize.node);
          requireCaptured(normalize, ['width', 'height', 'num_frames']);
          const source = captured.get(encode.id).fields;
          for (const field of ['video_source_frames', 'video_source_sha256']) {
            same(source[field]?.source, 'connected');
            same([source[field].sourceNodeId, source[field].sourcePortId], [normalizeId, 'output']);
          }
          const frames = source.video_source_frames.value;
          assert(Number.isSafeInteger(frames) && frames > 0 && frames <= 241 && (frames - 1) % 4 === 0);
          same(frames, Number(value(normalize.node, 'num_frames')));
          assert.match(source.video_source_sha256.value, /^[a-f0-9]{64}$/u);
          const dimensions = ['width', 'height'].map((field) => {
            const dimension = captured.get(denoise.id).fields[field].value;
            same(dimension, Number(value(normalize.node, field)));
            return dimension;
          });
          sourceVideoGeometry.push({ width: dimensions[0], height: dimensions[1], frames });
        } else requireCaptured(denoise, ['num_frames']);
        same(value(node, 'mode'), snapshot.studioForm.mode);
        same(captured.get(decode.id).fields.executed_task, { source: 'literal', value: snapshot.studioForm.mode });
      }
    }
    assert(
      (observedAuto
        ? ['modules.Video.Export', 'modules.Video.ConcatenateAssets']
        : ['modules.Image.Preview', 'modules.Video.Export', ...(audiovisual ? ['modules.Video.ExportWithAudio'] : [])]
      ).includes(kind(api.nodes[output.nodeId])),
    );
  }
  if (audiovisual) {
    same(snapshot.studioForm.mode, 'text_to_audio');
    same(pipelineClass, 'LTXConditionPipeline');
    same([ownerRepo, revision], reviewedNativeVideo.LTXConditionPipeline);
    audioOwner = single('modules.DiffusersAudio.LoadPipeline');
    same(value(audioOwner.node, 'pipeline_class'), 'AceStepPipeline');
    same(repo(value(audioOwner.node, 'model_id')), 'ACE-Step/acestep-v15-xl-turbo-diffusers');
    same(value(audioOwner.node, 'revision'), '200ba991ae448051e14b0183157e35c2d27c9fb0');
    requireCaptured(audioOwner, [
      'model_id',
      'pipeline_class',
      'revision',
      'dtype',
      'device',
      'auto_offload',
      'offload_mode',
    ]);
    for (const field of ['dtype', 'device', 'auto_offload', 'offload_mode'])
      same(value(audioOwner.node, field), value(owner.node, field));
    const audioRecipe = {
      id: audioOwner.node.params.execution_recipe?.sourceId,
      node: api.nodes[audioOwner.node.params.execution_recipe?.sourceId],
    };
    assert(audioRecipe.node && kind(audioRecipe.node) === 'modules.DiffusersRuntime.DiffusersExecutionRecipe');
    assert(audioRecipe.id !== recipe.id);
    wire(audioOwner, 'execution_recipe', audioRecipe, 'execution_recipe');
    const audioQuant = {
      id: audioRecipe.node.params.quantization_config?.sourceId,
      node: api.nodes[audioRecipe.node.params.quantization_config?.sourceId],
    };
    assert(audioQuant.node && kind(audioQuant.node) === 'modules.DiffusersRuntime.PipelineQuantizationConfigV2');
    wire(audioRecipe, 'quantization_config', audioQuant, 'quantization_config');
    same(value(audioQuant.node, 'backend'), 'none');
    same(value(audioQuant.node, 'dtype'), 'bfloat16');
    requireCaptured(audioRecipe, ['offload_mode', 'device']);
    for (const field of ['offload_mode', 'device']) same(value(audioRecipe.node, field), value(audioOwner.node, field));
    const song = single('modules.DiffusersAudio.Generate');
    wire(song, 'pipeline', audioOwner, 'pipeline');
    requireCaptured(song, [
      'prompt',
      'lyrics',
      'task_type',
      'audio_duration',
      'seed',
      'num_inference_steps',
      'guidance_scale',
      'shift',
      'bpm',
      'keyscale',
      'timesignature',
      'vocal_language',
    ]);
    const fit = single('modules.Audio.FitDuration'),
      overlay = single('modules.Video.LyricOverlay'),
      exported = single('modules.Video.ExportWithAudio');
    wire(fit, 'audio', song, 'audio');
    wire(exported, 'audio', fit, 'output');
    wire(exported, 'video', overlay, 'output');
    same(output.nodeId, exported.id);
    requireCaptured(exported, ['fps']);
  }
  if (observedAuto) {
    same(owner.node.module, 'modules.DiffusersVideo');
    nativeVideoStructure(api.nodes, snapshot.studioForm.mode);
    nativeVideoModels(api.nodes, modelIdentities, owner.node);
    same(hints.resourceMode, 'auto');
    same(hints.workflowAutoPlan.schemaVersion, 1);
    same(hints.workflowAutoPlan.graphHash, workerGraphHash(api));
    const preparation = task.runtimePreparation;
    const auto = preparation.workflowAuto;
    assert(['dependency_order_retained_owners', 'dependency_order_release_owners'].includes(auto.strategy));
    if (auto.strategy === 'dependency_order_release_owners') {
      const order = auto.schedule.executionOrder;
      same([...order].sort(), entries.map(([id]) => id).sort());
      same(new Set(order).size, order.length);
      for (const [id, node] of entries)
        for (const p of Object.values(node.params))
          if (p.sourceId) assert(order.indexOf(p.sourceId) < order.indexOf(id));
      for (const release of auto.schedule.releases) {
        same(order[release.afterIndex], release.afterNodeId);
        for (const id of release.nodeIds) assert(api.nodes[id]);
      }
    }
    assertFiniteObservedJson(preparation);
    for (const field of ['reusedOwnerIds', 'preparedDataNodes', 'appliedUpdates', 'releases'])
      assert(Array.isArray(auto[field]));
    assert(auto.resolvedFields && typeof auto.resolvedFields === 'object');
    for (const role of [owner, recipe]) {
      assert(auto.resolvedFields[role.id]);
      for (const field of role === owner
        ? ['revision', 'dtype', 'device', 'offload_mode', 'auto_offload', 'pipeline_class']
        : ['device', 'offload_mode']) {
        same(auto.resolvedFields[role.id][field], value(role.node, field));
      }
    }
    assert(context.nativeAutoBindings);
    for (const value of Object.values(context.nativeAutoBindings))
      assert(typeof value === 'string' && value.length > 0);
  }
  const proof = createHash('sha256')
    .update(JSON.stringify(stableJsonValue({ taskId, receipt, apiNodes: api.nodes, apiPaths: api.paths })))
    .digest('hex');
  return {
    source: observedAuto
      ? OBSERVED_NATIVE_AUTO_VIDEO_SOURCE
      : modularImage
        ? 'executed-expert-modular-image-workflow-v1'
        : audiovisual
          ? 'executed-expert-audiovisual-graph-v1'
          : modularAudio
            ? 'executed-expert-modular-audio-graph-v1'
            : 'executed-expert-standard-media-graph-v1',
    modelType: audioOwner ? value(audioOwner.node, 'pipeline_class') : pipelineClass,
    pipelineClass: audioOwner ? value(audioOwner.node, 'pipeline_class') : pipelineClass,
    modelRepo: audioOwner ? repo(value(audioOwner.node, 'model_id')) : ownerRepo,
    resolvedModelRepo: audioOwner ? repo(value(audioOwner.node, 'model_id')) : ownerRepo,
    resolvedArtifact: audioOwner ? repo(value(audioOwner.node, 'model_id')) : ownerRepo,
    dtype: value(owner.node, 'dtype'),
    device: value(owner.node, 'device'),
    autoOffload: value(owner.node, 'auto_offload'),
    offloadMode: value(owner.node, 'offload_mode'),
    resourceMode,
    resolvedResourceMode: resourceMode,
    quantizationMode: 'none',
    quantizedComponents: [],
    ...(recipe
      ? { deviceMap: value(recipe.node, 'device_map') }
      : { weightFormat: 'native', weightLoadingMode: 'cpu' }),
    observation: {
      taskId,
      nodeCount: entries.length,
      capturedInputsSHA256: proof,
      fullFieldAccountingClaimed: false,
      ...(dependencyEvidence ? { modelDependencyEvidence: dependencyEvidence } : {}),
      ...(modularAudio ? { lyricsCaptureClaimed: false } : {}),
      ...(modularImage ? { workflowSelectorCaptureClaimed: false, fixedSamplerCaptureClaimed: false } : {}),
      ...(jsonSuppliers.length
        ? { jsonSupplierControlsCaptured: false, referenceScaleConsumerValuesVerified: true }
        : {}),
      ...(audioOwner
        ? {
            audioGraphTaskCaptured: false,
            fittingControlsCaptured: false,
            preparationModeCaptured: task.runtimePreparation?.resourceMode !== undefined,
            mediaResourceOwners: [owner, audioOwner].map((role) => ({
              nodeId: role.id,
              pipelineClass: value(role.node, 'pipeline_class'),
              repoId: repo(value(role.node, 'model_id')),
              revision: value(role.node, 'revision'),
            })),
          }
        : {}),
      hardwareQualification: false,
      ...(sourceVideoGeometry.length ? { sourceVideoGeometry } : {}),
      ...(graphSubmission ? { outputApiGraphSnapshotCaptured: false, graphSubmission } : {}),
      ...(observedAuto ? { bindings: context.nativeAutoBindings, runtimePreparation: task.runtimePreparation } : {}),
    },
  };
}

export function inspectExecutedNativeMedia(api, context) {
  const modularAudio = Object.values(api?.nodes ?? {}).some(
    (n) => kind(n) === 'modules.ModularDiffusers.WorkflowSemanticGeneration',
  );
  const modularImage = Object.values(api?.nodes ?? {}).some(
    (n) => kind(n) === 'modules.ModularDiffusers.WorkflowImageDenoise',
  );
  return inspect(api, context, modularAudio, modularImage);
}

export function executedNativeMediaPlan(api, context) {
  try {
    return inspectExecutedNativeMedia(api, context);
  } catch {
    return null;
  }
}

export function observedNativeAutoVideoPlan(api, context) {
  try {
    return inspectObservedNativeAutoVideo(api, context);
  } catch {
    return null;
  }
}

export function inspectObservedNativeAutoVideo(api, context) {
  return inspect(api, context, false, false, true);
}

export function observedNativeAutoVideoResourceId(plan) {
  if (
    plan?.source !== OBSERVED_NATIVE_AUTO_VIDEO_SOURCE ||
    plan.resourceMode !== 'auto' ||
    !plan.observation?.bindings ||
    !plan.observation?.runtimePreparation
  )
    return null;
  return `observed-native-auto-video-v1:${canonicalJsonHash(plan)}`;
}

export function observedNativeAutoVideoProofMatches(plan, provenance, submissionContext = {}) {
  try {
    assert(observedNativeAutoVideoResourceId(plan));
    same(plan.observation.bindings, {
      canonicalGraphHash: provenance.graph.hash,
      modelSetHash: provenance.models.hash,
      inputArtifactsHash: provenance.inputs.hash,
      backendSourceFingerprint: provenance.runtime.backendSource.fingerprint,
    });
    const graph = provenance.graph.canonicalGraph;
    if (plan.observation.graphSubmission) {
      same(plan.observation.outputApiGraphSnapshotCaptured, false);
      same(capturedNativeGraphSubmission(plan.observation.graphSubmission).record, plan.observation.graphSubmission);
      same(submissionContext.submittedGraphIdentity?.hash, provenance.graph.hash);
      same(submissionContext.submittedGraphIdentity?.canonicalGraph, graph);
    } else assert(plan.observation.outputApiGraphSnapshotCaptured === undefined);
    same(provenance.graph.hash, 'sha256:canonical-graph-v1:' + canonicalJsonHash(graph));
    const nodes = Object.fromEntries(graph.nodes.map((n) => [n.key, n]));
    const { owner, recipe } = nativeVideoStructure(nodes, provenance.template.lockedSettings.mode);
    nativeVideoModels(nodes, provenance.models.items, owner.node);
    if (value(owner.node, 'pipeline_class') === 'WanVideoToVideoPipeline') {
      const normalize = graph.nodes.filter((n) => kind(n) === 'modules.VideoConditioning.Normalize');
      same(normalize.length, 1);
      same(plan.observation.sourceVideoGeometry, [
        {
          width: Number(value(normalize[0], 'width')),
          height: Number(value(normalize[0], 'height')),
          frames: Number(value(normalize[0], 'num_frames')),
        },
      ]);
    } else assert(plan.observation.sourceVideoGeometry === undefined);
    const repository = repo(value(owner.node, 'model_id'));
    for (const [field, expected] of Object.entries({
      modelType: value(owner.node, 'pipeline_class'),
      pipelineClass: value(owner.node, 'pipeline_class'),
      modelRepo: repository,
      resolvedModelRepo: repository,
      resolvedArtifact: repository,
      dtype: value(owner.node, 'dtype'),
      device: value(owner.node, 'device'),
      autoOffload: value(owner.node, 'auto_offload'),
      offloadMode: value(owner.node, 'offload_mode'),
      resourceMode: 'auto',
      resolvedResourceMode: 'auto',
      quantizationMode: 'none',
      quantizedComponents: [],
      deviceMap: value(recipe.node, 'device_map'),
    }))
      same(plan[field], expected);
    same(plan.observation.taskId, provenance.taskId);
    same(plan.observation.nodeCount, graph.nodes.length);
    same(plan.observation.hardwareQualification, false);
    same(plan.observation.fullFieldAccountingClaimed, false);
    const preparation = plan.observation.runtimePreparation;
    assertFiniteObservedJson(preparation);
    same(preparation.resourceMode, 'auto');
    const candidates = Object.values(preparation.workflowAuto.resolvedFields).filter(
      (r) => r.pipeline_class === plan.pipelineClass && repo(r.model_id) === repository,
    );
    same(candidates.length, 1);
    for (const field of ['revision', 'dtype', 'device', 'auto_offload', 'offload_mode', 'pipeline_class'])
      same(candidates[0][field], value(owner.node, field));
    return true;
  } catch {
    return false;
  }
}
