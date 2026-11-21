// Maintainer evidence only. Preserved native records never grant execution or fit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import { assertFiniteObservedJson } from './observed-workflow-auto-resource.mjs';

const same = (a, b) => assert.deepEqual(stableJsonValue(a), stableJsonValue(b));
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
export const OBSERVED_RETAINED_EXPERT_TEXT_SOURCE = 'observed-retained-expert-text-resource-v1';
const prefix = 'modules.ModularDiffusers.';
const scopes = ['ModelsLoader', 'Guider', 'EncodePrompt', 'Denoise', 'DecodeLatents']
  .map((a) => prefix + a)
  .concat('modules.Image.Preview');
const absent = ['weight_format', 'weight_loading_mode'];

function project(entries, paths, form) {
  assert.equal(form.mode, 'text_to_image');
  assert.equal(form.resourceMode, 'expert');
  assert.equal(form.dtype, 'bfloat16');
  assert.equal(form.quantizationMode, 'none');
  if (Object.hasOwn(form, 'trustRemoteCode')) assert.equal(form.trustRemoteCode, false);
  for (const key of ['weightFormat', 'weightLoadingMode']) assert(!Object.hasOwn(form, key));
  assert.equal(entries.length, 6);
  assert.equal(paths.length, 1);
  same([...paths[0]].sort(), entries.map(([id]) => id).sort());
  assert.equal(new Set(paths[0]).size, 6);
  const roles = new Map(entries.map(([id, n]) => [n.module + '.' + n.action, { id, node: n }]));
  same([...roles.keys()].sort(), [...scopes].sort());
  const role = (action) => roles.get(prefix + action);
  const lit = (action, field) => {
    const p = role(action).node.params[field];
    assert(p && !p.sourceId && !p.sourceKey, action + '.' + field);
    return p.value;
  };
  const owner = role('ModelsLoader');
  for (const field of absent) assert(!Object.hasOwn(owner.node.params, field));
  const modelType = lit('ModelsLoader', 'model_type');
  assert.equal(typeof modelType, 'string');
  const repo = lit('ModelsLoader', 'repo_id');
  assert.equal(repo?.source, 'hub');
  assert.match(repo.value, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
  const revision = lit('ModelsLoader', 'revision');
  assert.match(revision, /^[a-f0-9]{40}$/u);
  for (const [field, expected] of Object.entries({
    dtype: 'bfloat16',
    device: 'cuda:0',
    offload_mode: 'group_cpu',
    auto_offload: true,
    attention_backend: 'auto',
    trust_remote_code: false,
  }))
    same(lit('ModelsLoader', field), expected);
  assert(['', 'text2image'].includes(lit('ModelsLoader', 'workflow_id')));
  for (const field of [
    'quant_config',
    'unet',
    'vae',
    'controlnet',
    'lora_list',
    'text_encoders',
    'pipeline_components',
    'image_encoder',
  ]) {
    const p = owner.node.params[field];
    assert(!p?.sourceId && !p?.sourceKey && p?.value == null);
  }
  for (const field of ['vae_slicing', 'vae_tiling']) assert.equal(typeof lit('ModelsLoader', field), 'boolean');
  if (Object.hasOwn(form, 'device')) same(form.device, lit('ModelsLoader', 'device'));
  same(form.offloadMode, lit('ModelsLoader', 'offload_mode'));
  same(form.autoOffload, lit('ModelsLoader', 'auto_offload'));
  for (const field of ['width', 'height', 'steps', 'maxSequenceLength'])
    assert(Number.isSafeInteger(form[field]) && form[field] > 0 && form[field] <= 4096);
  assert(Number.isSafeInteger(form.seed) && form.seed >= 0 && form.seed < 2 ** 32 && form.randomSeed === false);
  assert(Number.isFinite(form.guidanceScale) && form.guidanceScale >= 0 && form.guidanceScale <= 100);
  for (const [field, key] of [
    ['width', 'width'],
    ['height', 'height'],
    ['seed', 'seed'],
    ['num_inference_steps', 'steps'],
    ['guidance_scale', 'guidanceScale'],
  ])
    same(lit('Denoise', field), form[key]);
  assert(
    role('Denoise').node.params.image_latents?.value == null && !role('Denoise').node.params.image_latents?.sourceId,
  );
  for (const [field, key] of [
    ['prompt', 'prompt'],
    ['negative_prompt', 'negativePrompt'],
    ['max_sequence_length', 'maxSequenceLength'],
  ])
    same(lit('EncodePrompt', field), form[key]);
  const guide = Object.fromEntries(
    'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'
      .split(' ')
      .map((key) => [key, lit('Guider', key)]),
  );
  same(guide, {
    model_type: modelType,
    guider: 'ClassifierFreeGuidance',
    guidance_scale: form.guidanceScale,
    guidance_rescale: 0,
    use_original_formulation: false,
    enabled: true,
    start: 0,
    stop: 1,
  });
  const allowed = new Set();
  for (const [target, field, supplier, port] of [
    ['EncodePrompt', 'text_encoders', 'ModelsLoader', 'text_encoders'],
    ['EncodePrompt', 'guider', 'Guider', 'guider_out'],
    ['Denoise', 'unet', 'ModelsLoader', 'unet_out'],
    ['Denoise', 'scheduler', 'ModelsLoader', 'scheduler'],
    ['Denoise', 'embeddings', 'EncodePrompt', 'embeddings'],
    ['Denoise', 'guider', 'Guider', 'guider_out'],
    ['DecodeLatents', 'vae', 'ModelsLoader', 'vae_out'],
    ['DecodeLatents', 'latents', 'Denoise', 'latents'],
    ['DecodeLatents', 'width', 'Denoise', 'out_width'],
    ['DecodeLatents', 'height', 'Denoise', 'out_height'],
  ]) {
    const t = role(target),
      s = role(supplier),
      p = t.node.params[field];
    same({ sourceId: p?.sourceId, sourceKey: p?.sourceKey }, { sourceId: s.id, sourceKey: port });
    if (Object.hasOwn(p, 'value')) {
      assert(target === 'DecodeLatents' && ['width', 'height'].includes(field));
      same(p.value, form[field]);
    }
    assert(paths[0].indexOf(s.id) < paths[0].indexOf(t.id));
    allowed.add(t.id + ':' + field);
  }
  const preview = roles.get('modules.Image.Preview'),
    decode = role('DecodeLatents');
  same(preview.node.params.device, { value: 'cpu:0' });
  same(
    { sourceId: preview.node.params.image?.sourceId, sourceKey: preview.node.params.image?.sourceKey },
    { sourceId: decode.id, sourceKey: 'images' },
  );
  allowed.add(preview.id + ':image');
  for (const [id, node] of entries)
    for (const [key, p] of Object.entries(node.params)) if (p.sourceId) assert(allowed.has(id + ':' + key));
  return {
    roles,
    role,
    lit,
    guide,
    preview,
    executedControlsHash: canonicalJsonHash({
      prompt: lit('EncodePrompt', 'prompt'),
      negativePrompt: lit('EncodePrompt', 'negative_prompt'),
      maxSequenceLength: lit('EncodePrompt', 'max_sequence_length'),
      seed: lit('Denoise', 'seed'),
      steps: lit('Denoise', 'num_inference_steps'),
      guidanceScale: lit('Denoise', 'guidance_scale'),
      strength: lit('Denoise', 'strength'),
      vaeSlicing: lit('ModelsLoader', 'vae_slicing'),
      vaeTiling: lit('ModelsLoader', 'vae_tiling'),
    }),
    recipe: {
      modelType,
      repository: repo.value,
      revision,
      dtype: 'bfloat16',
      device: 'cuda:0',
      offloadMode: 'group_cpu',
      autoOffload: true,
      originalLoaderWorkflowId: lit('ModelsLoader', 'workflow_id'),
      geometry: { width: form.width, height: form.height },
      absentLoaderControls: absent,
    },
  };
}

function deriveRetainedTextPlan(api, context) {
  const {
    executionReceipt: task,
    executedOutput: output,
    backendSource: source,
    backendContract: contract,
    modelIdentities: models,
    retainedNativeEvidence: records,
  } = context;
  assert.equal(output.formSnapshot.trustRemoteCode, false);
  if (context.taskId !== undefined) assert.equal(context.taskId, task.task_id);
  let total = 0;
  const read = (name) => {
    const r = records[name];
    assert(r && typeof r.text === 'string');
    const length = Buffer.byteLength(r.text);
    total += length;
    assert(length <= 16 * 1024 ** 2 && total <= 48 * 1024 ** 2);
    assert.equal(sha(r.text), r.sha256);
    return name === 'journal'
      ? r.text
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : JSON.parse(r.text);
  };
  const original = read('receipt'),
    requests = read('requests'),
    responses = read('responses');
  const derived = read('derived'),
    journal = read('journal'),
    observer = read('observer');
  same(original.task, task);
  assert.equal(original.outputs.length, 1);
  same(original.outputs[0], output);
  assert.equal(task.status, 'completed');
  assert.equal(task.attempt_index, 0);
  assert.equal(output.attemptIndex, 0);
  assert.equal(task.resourceCandidateId, null);
  for (const [key, expected] of Object.entries({
    resourceMode: 'expert',
    performed: false,
    residentRecipeReusable: false,
    cleanup: null,
  }))
    same(task.runtimePreparation[key], expected);
  const graphRequests = requests.filter((r) => r.path === '/graph');
  assert.equal(graphRequests.length, 1);
  same(graphRequests[0].body, api);
  const graphResponses = responses.filter((r) => r.path === '/graph');
  assert.equal(graphResponses.length, 1);
  assert.equal(graphResponses[0].status, 200);
  assert.equal(graphResponses[0].body.error, false);
  assert.equal(graphResponses[0].body.task_id, task.task_id);
  assert.equal(graphResponses[0].body.sid, api.sid);
  assert(
    Date.parse(graphRequests[0].at) <= task.started_at * 1000 &&
      Date.parse(graphResponses[0].at) <= task.completed_at * 1000,
  );
  if (Object.hasOwn(output, 'apiGraphSnapshot')) same(output.apiGraphSnapshot, api);
  assert(!Object.hasOwn(api.runtimeHints, 'resourceMode') && !Object.hasOwn(api, 'loops'));
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
  const form = output.formSnapshot,
    p = project(Object.entries(api.nodes), api.paths, form);
  const authoredOwners = task.workflow_snapshot.nodes.filter(
    (n) =>
      n.id === p.role('ModelsLoader').id &&
      !n.data?.blockProjectionOwnerId &&
      n.data?.module === 'modules.ModularDiffusers' &&
      n.data?.action === 'ModelsLoader',
  );
  assert.equal(authoredOwners.length, 1);
  const authored = authoredOwners[0].data;
  assert.equal(authored.operationAuthoring?.schemaVersion, 1);
  assert.equal(authored.operationAuthoring.operation?.pipelineClass, p.recipe.modelType);
  assert.equal(authored.operationAuthoring.operation.task, 'text_to_image');
  assert.equal(authored.operationAuthoring.operation.nodeKey, prefix + 'ModelsLoader');
  assert.equal(authored.operationAuthoring.operation.binding?.pipelineClass, p.recipe.modelType);
  assert.equal(authored.operationAuthoring.operation.binding.values?.model_type, p.recipe.modelType);
  assert.equal(authored.params.model_type?.value, p.recipe.modelType);
  assert(!authored.params.model_type?.sourceId && !authored.params.model_type?.sourceKey);
  assert.equal(output.taskId, task.task_id);
  assert.equal(output.nodeId, p.preview.id);
  assert.equal(source.fingerprint, task.runtimeFingerprint.backendSource.fingerprint);
  assert.equal(source.files.length, task.runtimeFingerprint.backendSource.fileCount);
  same(source.gitCommit, task.runtimeFingerprint.backendSource.gitCommit);
  assert.equal(
    source.fingerprint,
    'sha256:backend-source-v1:' + canonicalJsonHash({ gitCommit: source.gitCommit, files: source.files }),
  );
  assert.match(contract.fingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
  const ownerContract = contract.contracts.filter((c) => c.key === prefix + 'ModelsLoader');
  assert.equal(ownerContract.length, 1);
  for (const key of absent) assert(!Object.hasOwn(ownerContract[0].params, key));
  const receipt = output.resolvedExecutionInputs;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.source, 'backend-execution');
  assert.equal(receipt.taskId, task.task_id);
  assert.equal(receipt.attemptIndex, 0);
  assert.equal(receipt.nodeId, output.nodeId);
  assert.equal(receipt.truncated, false);
  same(receipt.uncapturedNodeIds, []);
  assert.equal(receipt.nodes.length, 6);
  const captured = new Map(receipt.nodes.map((r) => [r.nodeId, r]));
  assert.equal(captured.size, 6);
  for (const [id, node] of Object.entries(api.nodes)) {
    assert.equal(captured.get(id).module, node.module);
    assert.equal(captured.get(id).action, node.action);
    same(captured.get(id).omittedFields, {});
  }
  same(receipt.graphTasks, [
    { loaderId: p.role('ModelsLoader').id, pipelineClass: p.recipe.modelType, task: 'text_to_image' },
  ]);
  const ownerRow = captured.get(p.role('ModelsLoader').id);
  for (const key of absent) assert(!Object.hasOwn(ownerRow.fields, key));
  const consumed = (action, field, value) => {
    const f = captured.get(p.role(action).id).fields[field];
    assert.equal(f.source, 'literal');
    same(f.value, value);
  };
  same(captured.get(p.preview.id).fields.device, { source: 'literal', value: 'cpu:0' });
  for (const field of 'model_type repo_id revision dtype device auto_offload offload_mode quant_config attention_backend vae_slicing vae_tiling'.split(
    ' ',
  ))
    consumed(
      'ModelsLoader',
      field,
      field === 'repo_id'
        ? p.recipe.repository
        : field === 'quant_config' && p.lit('ModelsLoader', field) == null
          ? null
          : p.lit('ModelsLoader', field),
    );
  for (const field of ['prompt', 'negative_prompt', 'max_sequence_length'])
    consumed('EncodePrompt', field, p.lit('EncodePrompt', field));
  for (const field of Object.keys(p.guide)) consumed('Guider', field, p.guide[field]);
  for (const field of 'width height seed num_inference_steps guidance_scale strength'.split(' '))
    consumed('Denoise', field, p.lit('Denoise', field));
  for (const field of ['width', 'height']) {
    const f = captured.get(p.role('DecodeLatents').id).fields[field];
    same(f.value, form[field]);
    assert.equal(f.source, 'connected');
    assert.equal(f.sourceNodeId, p.role('Denoise').id);
    assert.equal(f.sourcePortId, 'out_' + field);
  }
  assert.equal(derived.taskId, task.task_id);
  for (const name of ['receipt', 'requests', 'responses'])
    assert.equal(
      derived.evidenceHashes[name === 'receipt' ? 'run-receipt.json' : name + '.json'],
      records[name].sha256,
    );
  const events = journal.filter((e) => e.task?.task_id === task.task_id),
    calls = events.filter((e) => e.event === 'officialCallStarted');
  same(calls, derived.actualOfficialCalls);
  assert.equal(calls.length, 3);
  assert(!events.some((e) => e.event === 'officialCallFailed'));
  const roleNames = ['EncodePrompt', 'Denoise', 'DecodeLatents'];
  assert.equal(new Set(calls.map((call) => call.callId)).size, 3);
  for (const [i, call] of calls.entries()) {
    assert.match(call.callId, /^[a-f0-9]{32}$/u);
    assert.equal(call.task.current_node, p.role(roleNames[i]).id);
    assert.equal(call.task.current_node_name, prefix + roleNames[i]);
    assert.equal(call.task.attempt_index, 0);
    assert(
      call.actualPipelineClass.startsWith('diffusers.modular_pipelines.') &&
        call.actualPipelineClass.endsWith('.' + p.recipe.modelType),
    );
    assert.equal(call.pipelineClass, 'diffusers.modular_pipelines.modular_pipeline.ModularPipeline');
    const returned = events.filter((e) => e.event === 'officialCallReturned' && e.callId === call.callId);
    assert.equal(returned.length, 1);
    same(returned[0].task, call.task);
    assert(Date.parse(returned[0].at) >= Date.parse(call.at));
    assert(Date.parse(call.at) >= task.started_at * 1000 && Date.parse(returned[0].at) <= task.completed_at * 1000);
    if (i === 2) same(returned[0].images, [{ mode: 'RGB', size: [form.width, form.height] }]);
    same(call.peftComponentAdapterNames, {});
    same(call.peftLayerScaleHistograms, {});
    same(call.wholePipelineAdapterScales, null);
    const components = i === 0 ? ['text_encoder', 'text_encoder_2'] : i === 1 ? ['transformer'] : ['vae'];
    for (const c of components) {
      const policy = call.componentRuntimePolicies[c];
      assert.equal(policy.offloadMode, p.recipe.offloadMode);
      assert.equal(policy.executionDevice, p.recipe.device);
      const expected =
        i === 0
          ? {}
          : i === 1
            ? { attention_backend: 'auto' }
            : { vae_slicing: p.lit('ModelsLoader', 'vae_slicing'), vae_tiling: p.lit('ModelsLoader', 'vae_tiling') };
      same(policy.applied, expected);
      same(policy.requested, expected);
    }
  }
  const denoise = calls[1];
  same(denoise.generator, { device: p.recipe.device, initialSeed: form.seed, type: 'Generator' });
  for (const [key, expected] of Object.entries({
    width: form.width,
    height: form.height,
    num_inference_steps: form.steps,
    guidance_scale: form.guidanceScale,
  }))
    same(denoise.callInputs[key], expected);
  for (const [key, expected] of Object.entries({
    prompt: form.prompt,
    negative_prompt: form.negativePrompt,
    max_sequence_length: form.maxSequenceLength,
  }))
    same(calls[0].callInputs[key], expected);
  const expectedGuide = Object.fromEntries(
    Object.entries(p.guide).filter(([key]) => !['model_type', 'guider'].includes(key)),
  );
  for (const call of calls.slice(0, 2)) {
    assert.equal(call.guider.class, 'diffusers.guiders.classifier_free_guidance.ClassifierFreeGuidance');
    same(call.guider.config, expectedGuide);
  }
  same(calls[2].vaeMemoryFlags, {
    use_slicing: p.lit('ModelsLoader', 'vae_slicing'),
    use_tiling: p.lit('ModelsLoader', 'vae_tiling'),
  });
  assert.equal(
    denoise.scheduler.class,
    'diffusers.schedulers.scheduling_flow_match_euler_discrete.FlowMatchEulerDiscreteScheduler',
  );
  const schedStarted = events.filter((e) => e.event === 'schedulerStepStarted');
  const sched = events.filter((e) => e.event === 'schedulerStepReturned');
  assert.equal(schedStarted.length, form.steps);
  assert.equal(sched.length, form.steps);
  // The original scheduler initializes its index inside the first call and
  // increments it before returning. Preserve both actual conventions.
  same(
    schedStarted.map((e) => e.stepIndex),
    [null, ...Array.from({ length: form.steps - 1 }, (_, i) => i + 1)],
  );
  same(
    sched.map((e) => e.stepIndex),
    Array.from({ length: form.steps }, (_, i) => i + 1),
  );
  const denoiseReturned = events.find((e) => e.event === 'officialCallReturned' && e.callId === denoise.callId);
  for (const [i, started] of schedStarted.entries()) {
    same(started.task, denoise.task);
    same(sched[i].task, denoise.task);
    assert(Date.parse(started.at) >= Date.parse(denoise.at));
    assert(Date.parse(started.at) <= Date.parse(sched[i].at));
    assert(Date.parse(sched[i].at) <= Date.parse(denoiseReturned.at));
    if (i) assert(Date.parse(started.at) >= Date.parse(sched[i - 1].at));
  }
  assert(Date.parse(observer.installedAt) <= task.started_at * 1000);
  assert.match(observer.observerSha256, /^[a-f0-9]{64}$/u);
  assert(observer.wrappedCalls.some((x) => x.kind === 'officialPipelineCall' && x.class === calls[0].pipelineClass));
  assert.equal(derived.actualDiffusersDirectUrl.value.url, 'https://github.com/huggingface/diffusers.git');
  assert.match(derived.actualDiffusersDirectUrl.value.vcs_info.commit_id, /^[a-f0-9]{40}$/u);
  assert.equal(models.length, 1);
  assert.equal(models[0].repoId, p.recipe.repository);
  assert.equal(models[0].selectedRevision, p.recipe.revision);
  assert.equal(models[0].modelRevision, p.recipe.repository + '@' + p.recipe.revision);
  assert(models[0].fingerprint);
  assert.equal(output.mediaItems.length, 1);
  same(output.mediaItems[0].width, form.width);
  same(output.mediaItems[0].height, form.height);
  const observation = {
    schemaVersion: 1,
    recipe: p.recipe,
    formModelType: form.modelType,
    executedControlsHash: p.executedControlsHash,
    actualScheduler: denoise.scheduler,
    actualGuider: expectedGuide,
    backendSourceFingerprint: source.fingerprint,
    backendContractFingerprint: contract.fingerprint,
    taskId: task.task_id,
    outputGraphSnapshotOriginallyPresent: Object.hasOwn(output, 'apiGraphSnapshot'),
    rawRecordHashes: Object.fromEntries(Object.entries(records).map(([name, r]) => [name, r.sha256])),
    rawOfficialCalls: 3,
    rawSchedulerSteps: sched.length,
    upstreamLibrary: {
      url: derived.actualDiffusersDirectUrl.value.url,
      commit: derived.actualDiffusersDirectUrl.value.vcs_info.commit_id,
    },
    historicalLimits: {
      independentMemoryMonitoring: false,
      originalTimeInstalledInventory: false,
      unrecordedLoadingControlsReconstructed: false,
      residencyOrHardwareFitClaimed: false,
    },
  };
  const plan = {
    source: OBSERVED_RETAINED_EXPERT_TEXT_SOURCE,
    modelType: p.recipe.modelType,
    pipelineClass: p.recipe.modelType,
    modelRepo: p.recipe.repository,
    modelRevision: p.recipe.revision,
    dtype: p.recipe.dtype,
    device: p.recipe.device,
    offloadMode: p.recipe.offloadMode,
    autoOffload: p.recipe.autoOffload,
    resourceMode: 'expert',
    resolvedResourceMode: 'expert',
    quantizationMode: 'none',
    quantizedComponents: [],
    resourceObservation: observation,
  };
  assert(observedRetainedExpertTextResourceId(plan));
  return plan;
}

export function observedRetainedExpertTextPlan(api, context) {
  try {
    return deriveRetainedTextPlan(api, context);
  } catch {
    return null;
  }
}

export function observedRetainedExpertTextResourceId(plan) {
  try {
    assert.equal(plan?.source, OBSERVED_RETAINED_EXPERT_TEXT_SOURCE);
    assertFiniteObservedJson(plan);
    assert(Buffer.byteLength(JSON.stringify(plan)) <= 65536);
    same(
      Object.keys(plan).sort(),
      'source modelType pipelineClass modelRepo modelRevision dtype device offloadMode autoOffload resourceMode resolvedResourceMode quantizationMode quantizedComponents resourceObservation'
        .split(' ')
        .sort(),
    );
    const o = plan.resourceObservation,
      r = o.recipe;
    same(
      Object.keys(o).sort(),
      'schemaVersion recipe formModelType executedControlsHash actualScheduler actualGuider backendSourceFingerprint backendContractFingerprint taskId outputGraphSnapshotOriginallyPresent rawRecordHashes rawOfficialCalls rawSchedulerSteps upstreamLibrary historicalLimits'
        .split(' ')
        .sort(),
    );
    same(
      Object.keys(r).sort(),
      'modelType repository revision dtype device offloadMode autoOffload originalLoaderWorkflowId geometry absentLoaderControls'
        .split(' ')
        .sort(),
    );
    assert.equal(o.schemaVersion, 1);
    assert(typeof o.formModelType === 'string' && o.formModelType.length > 0 && o.formModelType.length <= 256);
    assert.match(o.executedControlsHash, /^[a-f0-9]{64}$/u);
    assert(typeof o.taskId === 'string' && o.taskId.length > 0 && o.taskId.length <= 128);
    assert.equal(typeof o.outputGraphSnapshotOriginallyPresent, 'boolean');
    assert.equal(r.dtype, 'bfloat16');
    assert.equal(r.device, 'cuda:0');
    assert.equal(r.offloadMode, 'group_cpu');
    assert.equal(r.autoOffload, true);
    assert(typeof r.modelType === 'string' && r.modelType.length > 0 && r.modelType.length <= 256);
    assert.match(r.repository, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
    assert.match(r.revision, /^[a-f0-9]{40}$/u);
    assert(['', 'text2image'].includes(r.originalLoaderWorkflowId));
    same(r.absentLoaderControls, absent);
    same(Object.keys(r.geometry).sort(), ['height', 'width']);
    for (const n of Object.values(r.geometry)) assert(Number.isSafeInteger(n) && n > 0 && n <= 4096);
    for (const [key, recipeKey] of Object.entries({
      modelType: 'modelType',
      pipelineClass: 'modelType',
      modelRepo: 'repository',
      modelRevision: 'revision',
      dtype: 'dtype',
      device: 'device',
      offloadMode: 'offloadMode',
      autoOffload: 'autoOffload',
    }))
      same(plan[key], r[recipeKey]);
    assert.equal(plan.resourceMode, 'expert');
    assert.equal(plan.resolvedResourceMode, 'expert');
    assert.equal(plan.quantizationMode, 'none');
    same(plan.quantizedComponents, []);
    assert.match(o.backendSourceFingerprint, /^sha256:backend-source-v1:[a-f0-9]{64}$/u);
    assert.match(o.backendContractFingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
    same(Object.keys(o.rawRecordHashes).sort(), ['derived', 'journal', 'observer', 'receipt', 'requests', 'responses']);
    for (const hash of Object.values(o.rawRecordHashes)) assert.match(hash, /^[a-f0-9]{64}$/u);
    assert.equal(o.rawOfficialCalls, 3);
    assert(Number.isSafeInteger(o.rawSchedulerSteps) && o.rawSchedulerSteps > 0 && o.rawSchedulerSteps <= 4096);
    same(o.historicalLimits, {
      independentMemoryMonitoring: false,
      originalTimeInstalledInventory: false,
      unrecordedLoadingControlsReconstructed: false,
      residencyOrHardwareFitClaimed: false,
    });
    same(Object.keys(o.upstreamLibrary).sort(), ['commit', 'url']);
    assert.equal(o.upstreamLibrary.url, 'https://github.com/huggingface/diffusers.git');
    assert.match(o.upstreamLibrary.commit, /^[a-f0-9]{40}$/u);
    assert.equal(
      o.actualScheduler.class,
      'diffusers.schedulers.scheduling_flow_match_euler_discrete.FlowMatchEulerDiscreteScheduler',
    );
    same(
      Object.keys(o.actualGuider).sort(),
      'guidance_scale guidance_rescale use_original_formulation enabled start stop'.split(' ').sort(),
    );
    same(
      { ...o.actualGuider, guidance_scale: 0 },
      { guidance_scale: 0, guidance_rescale: 0, use_original_formulation: false, enabled: true, start: 0, stop: 1 },
    );
    assert(
      Number.isFinite(o.actualGuider.guidance_scale) &&
        o.actualGuider.guidance_scale >= 0 &&
        o.actualGuider.guidance_scale <= 100,
    );
    return (
      'observed-retained-expert-text-v1:' +
      canonicalJsonHash({
        recipe: r,
        actualScheduler: o.actualScheduler,
        actualGuider: o.actualGuider,
        backendSourceFingerprint: o.backendSourceFingerprint,
        backendContractFingerprint: o.backendContractFingerprint,
        upstreamLibrary: o.upstreamLibrary,
      })
    );
  } catch {
    return null;
  }
}

export function observedRetainedExpertTextProofMatches(plan, provenance) {
  try {
    assert(observedRetainedExpertTextResourceId(plan));
    const o = plan.resourceObservation,
      graph = provenance.graph.canonicalGraph;
    const p = project(
      graph.nodes.map((node) => [node.key, node]),
      graph.paths,
      provenance.template.lockedSettings,
    );
    same(p.recipe, o.recipe);
    same(p.executedControlsHash, o.executedControlsHash);
    same(provenance.template.lockedSettings.modelType, o.formModelType);
    same(
      Object.fromEntries(Object.entries(p.guide).filter(([key]) => !['model_type', 'guider'].includes(key))),
      o.actualGuider,
    );
    same(provenance.template.lockedSettings.steps, o.rawSchedulerSteps);
    same(provenance.taskId, o.taskId);
    same(o.backendSourceFingerprint, provenance.runtime.backendSource.fingerprint);
    same(o.backendContractFingerprint, provenance.runtime.backendContract.fingerprint);
    const ownerContracts = provenance.runtime.backendContract.contracts.filter(
      (x) => x.key === prefix + 'ModelsLoader',
    );
    assert.equal(ownerContracts.length, 1);
    for (const key of absent) assert(!Object.hasOwn(ownerContracts[0].params, key));
    assert.equal(provenance.models.items.length, 1);
    const model = provenance.models.items[0];
    same(model.repoId, p.recipe.repository);
    same(model.selectedRevision, p.recipe.revision);
    assert.equal(provenance.inputs.items.length, 0);
    assert.equal(provenance.output.items.length, 1);
    const media = provenance.output.items[0];
    assert.equal(media.mediaType, 'image');
    same(media.width, p.recipe.geometry.width);
    same(media.height, p.recipe.geometry.height);
    return true;
  } catch {
    return false;
  }
}
