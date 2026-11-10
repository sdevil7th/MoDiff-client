// Maintainer evidence only. No execution, admission, benchmark or hardware proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import { assertFiniteObservedJson } from './observed-workflow-auto-resource.mjs';

export const OBSERVED_RETAINED_DIRECT_IMAGE_SOURCE = 'observed-retained-direct-image-resource-v1';
const same = (a, b) => assert.deepEqual(stableJsonValue(a), stableJsonValue(b));
const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const hash = (value) => assert.match(value, /^[a-f0-9]{64}$/u);
const keys = (value, expected) => same(Object.keys(value).sort(), [...expected].sort());
const limits = {
  independentMemoryMonitoring: false,
  originalTimeInstalledInventory: false,
  nativeOffloadHookPlacementObserved: false,
  residencyOrHardwareFitClaimed: false,
  unrecordedLoadingControlsReconstructed: false,
  wrapperSourceProvesUnwrappedImplementation: false,
};
const recordNames = ['receipt', 'requests', 'responses', 'derived', 'journal', 'observer', 'comparison', 'inputs'];
const scope = (node) => node.module + '.' + node.action;
const imageScope = 'modules.DiffusersImage.';
const runtimeScope = 'modules.DiffusersRuntime.';

function project(entries, paths, form, artifacts) {
  assert(['inpaint', 'outpaint', 'control_image'].includes(form.mode));
  assert(['auto', 'expert'].includes(form.resourceMode));
  same(form.dtype, 'bfloat16');
  same(form.quantizationMode, 'none');
  if (Object.hasOwn(form, 'trustRemoteCode')) assert.equal(form.trustRemoteCode, false);
  assert.equal(form.randomSeed, false);
  assert(Number.isSafeInteger(form.seed) && form.seed >= 0 && form.seed < 2 ** 32);
  for (const field of ['width', 'height', 'steps', 'maxSequenceLength'])
    assert(Number.isSafeInteger(form[field]) && form[field] > 0 && form[field] <= 4096);
  assert(Number.isFinite(form.guidanceScale) && form.guidanceScale >= 0 && form.guidanceScale <= 100);
  assert(typeof form.prompt === 'string' && typeof form.negativePrompt === 'string');
  assert(entries.length >= 6 && entries.length <= 7 && paths.length === 1);
  same([...paths[0]].sort(), entries.map(([id]) => id).sort());
  assert.equal(new Set(paths[0]).size, entries.length);
  const byId = new Map(entries),
    labels = new Map();
  const single = (name, label) => {
    const rows = entries.filter(([, n]) => scope(n) === name);
    assert.equal(rows.length, 1, name);
    const [id, node] = rows[0];
    labels.set(id, label);
    return { id, node };
  };
  const owner = single(imageScope + 'LoadPipeline', 'owner');
  const recipe = single(runtimeScope + 'DiffusersExecutionRecipe', 'recipe');
  const quant = single(runtimeScope + 'PipelineQuantizationConfigV2', 'quant');
  const generator = single(imageScope + (form.mode === 'control_image' ? 'ControlGenerate' : 'Inpaint'), 'generate');
  const preview = single('modules.Image.Preview', 'preview');
  const canvases = entries.filter(([, n]) => scope(n) === imageScope + 'OutpaintCanvas');
  assert(canvases.length <= 1);
  const canvas = canvases.length ? single(imageScope + 'OutpaintCanvas', 'canvas') : null;
  if (canvas) assert.equal(form.mode, 'outpaint');
  const value = (role, field) => {
    const p = role.node.params[field];
    assert(p && !p.sourceId && !p.sourceKey, role.node.action + '.' + field);
    return p.value;
  };
  const wires = new Map(entries.map(([id]) => [id, {}]));
  const wire = (target, field, supplier, port) => {
    const p = target.node.params[field];
    same({ sourceId: p?.sourceId, sourceKey: p?.sourceKey }, { sourceId: supplier.id, sourceKey: port });
    assert(!Object.hasOwn(p, 'value'));
    assert(paths[0].indexOf(supplier.id) < paths[0].indexOf(target.id));
    wires.get(target.id)[field] = [supplier.id, port];
  };
  wire(owner, 'execution_recipe', recipe, 'execution_recipe');
  wire(recipe, 'quantization_config', quant, 'quantization_config');
  wire(generator, 'pipeline', owner, 'pipeline');
  wire(preview, 'image', generator, 'images');
  same(value(preview, 'device'), 'cpu:0');
  for (const [field, expected] of Object.entries({
    dtype: 'bfloat16',
    device: 'cuda:0',
    quantization_mode: 'none',
    conditioning_kind: 'none',
    conditioning_model_id: '',
    conditioning_revision: '',
    quantized_components: [],
    device_map: 'none',
    auto_offload: true,
    low_cpu_mem_usage: true,
    enable_vae_slicing: true,
    enable_vae_tiling: true,
  }))
    same(value(owner, field), expected);
  for (const field of ['prequantized_transformer', 'image_prompt_adapter', 'control_components']) {
    const p = owner.node.params[field];
    assert(!p?.sourceId && !p?.sourceKey && p?.value == null);
  }
  for (const [field, expected] of Object.entries({
    device_map: 'none',
    max_memory: '{}',
    device_map_overrides: '{}',
    device: 'cuda:0',
    attention_backend: 'auto',
    attention_components: '',
    vae_slicing: true,
    vae_tiling: true,
    layerwise_casting: false,
    channels_last: false,
    regional_compile: false,
    denoiser_cache: 'none',
  }))
    same(value(recipe, field), expected);
  const offloadMode = value(recipe, 'offload_mode');
  assert(['model_cpu', 'group_cpu'].includes(offloadMode));
  same(form.offloadMode, offloadMode);
  same(form.autoOffload, true);
  same(value(quant, 'backend'), 'none');
  same(value(quant, 'dtype'), 'bfloat16');
  same(value(quant, 'component_overrides'), '{}');
  const repo = value(owner, 'model_id');
  same(repo.source, 'hub');
  assert.match(repo.value, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
  const revision = value(owner, 'revision');
  assert.match(revision, /^[a-f0-9]{40}$/u);
  const pipelineClass = value(owner, 'pipeline_class');
  assert.match(pipelineClass, /^[A-Za-z]\w*Pipeline$/u);
  same(value(owner, 'mode'), form.mode);
  for (const [field, formField] of [
    ['prompt', 'prompt'],
    ['negative_prompt', 'negativePrompt'],
    ['width', 'width'],
    ['height', 'height'],
    ['num_inference_steps', 'steps'],
    ['seed', 'seed'],
    ['guidance_scale', 'guidanceScale'],
    ['max_sequence_length', 'maxSequenceLength'],
  ])
    same(value(generator, field), form[formField]);
  same(value(generator, 'output_type'), 'pil');
  if (generator.node.action === 'Inpaint') same(value(generator, 'strength'), form.strength);
  const inputs = [];
  const attach = (target, field, role) => {
    const id = target.node.params[field]?.sourceId,
      node = byId.get(id);
    assert(node && scope(node) === 'modules.Image.Load' && !labels.has(id));
    const load = { id, node };
    labels.set(id, role);
    wire(target, field, load, 'image');
    const alphaChannel = value(load, 'alpha_channel');
    assert(['ignore', 'remove alpha'].includes(alphaChannel));
    const originalFiles = value(load, 'file');
    const files = typeof originalFiles === 'string' ? [originalFiles] : originalFiles;
    assert(Array.isArray(files) && files.length === 1);
    assert(typeof files[0] === 'string' && files[0].length > 0 && files[0].length <= 16384);
    const formPath = role === 'referenceImages[0]' ? form.referenceImages?.[0] : form[role];
    if (formPath !== undefined) same(files[0], formPath);
    const matches = artifacts.filter((a) => a.role === role);
    assert.equal(matches.length, 1);
    const artifact = matches[0];
    same(artifact.path, files[0]);
    assert.match(artifact.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
    assert(Number.isSafeInteger(artifact.byteSize) && artifact.byteSize > 0);
    inputs.push({ role, contentHash: artifact.contentHash, byteSize: artifact.byteSize, alphaChannel });
  };
  if (canvas) {
    wire(generator, 'image', canvas, 'canvas');
    wire(generator, 'mask_image', canvas, 'mask_image');
    attach(canvas, 'image', 'referenceImages[0]');
    for (const field of ['width', 'height']) same(value(canvas, field), form[field]);
    for (const field of ['left', 'right', 'top', 'bottom', 'overlap', 'feather', 'fill_color'])
      same(
        value(canvas, field),
        form[
          'outpaint' +
            field
              .split('_')
              .map((x) => x[0].toUpperCase() + x.slice(1))
              .join('')
        ],
      );
  } else if (generator.node.action === 'Inpaint') {
    attach(generator, 'image', 'referenceImages[0]');
    attach(generator, 'mask_image', 'maskImage');
  } else attach(generator, 'control_image', 'controlImage');
  same(artifacts.map((a) => a.role).sort(), inputs.map((a) => a.role).sort());
  assert.equal(labels.size, entries.length);
  for (const [id, node] of entries) {
    const expected = wires.get(id);
    for (const [field, param] of Object.entries(node.params)) {
      if (param.sourceId) assert(Object.hasOwn(expected, field), 'Unexpected supplier: ' + field);
      else if (param.sourceKey)
        assert(
          id === preview.id && field === 'preview' && param.sourceKey === 'output' && param.display === 'ui_image',
        );
    }
  }
  // Bind every authored parameter, including inactive fallbacks, while making
  // file paths and node IDs portable. Presentation values are not execution.
  const projection = paths[0].map((id) => {
    const node = byId.get(id);
    const params = Object.fromEntries(
      Object.entries(node.params)
        .filter(
          ([field, p]) =>
            !['label', 'preview', 'export', 'image_contract'].includes(field) && !p.display?.startsWith('ui_'),
        )
        .map(([field, p]) => [
          field,
          p.sourceId
            ? { supplier: labels.get(p.sourceId), port: p.sourceKey }
            : { value: field === 'file' && node.action === 'Load' ? labels.get(id) : (p.value ?? null) },
        ]),
    );
    return { role: labels.get(id), scope: scope(node), params };
  });
  const recipeValue = {
    pipelineClass,
    formModelType: form.modelType,
    mode: form.mode,
    operation: generator.node.action,
    repository: repo.value,
    revision,
    dtype: 'bfloat16',
    device: 'cuda:0',
    offloadMode,
    autoOffload: true,
    geometry: { width: form.width, height: form.height },
  };
  return {
    owner,
    recipe,
    quant,
    generator,
    preview,
    canvas,
    value,
    inputs,
    recipeValue,
    graphControlsHash: canonicalJsonHash(projection),
    formControlsHash: canonicalJsonHash(
      Object.fromEntries(
        [
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
          ...(generator.node.action === 'Inpaint' ? ['strength'] : []),
        ].map((k) => [k, form[k]]),
      ),
    ),
  };
}

function pixels(value) {
  assert(value && typeof value === 'object');
  hash(value.sha256);
  hash(value.decodedRgbaSha256);
  assert(['RGB', 'RGBA', 'L'].includes(value.mode));
  assert(Array.isArray(value.size) && value.size.length === 2);
  for (const n of value.size) assert(Number.isSafeInteger(n) && n > 0 && n <= 8192);
  return { mode: value.mode, size: value.size, sha256: value.sha256, decodedRgbaSha256: value.decodedRgbaSha256 };
}

function deriveRetainedDirectImagePlan(api, context) {
  const {
    executionReceipt: task,
    executedOutput: output,
    backendSource: source,
    backendContract: contract,
    modelIdentities: models,
    retainedNativeEvidence: records,
    inputArtifacts: artifacts,
  } = context;
  keys(records, recordNames);
  let total = 0;
  const read = (name) => {
    const record = records[name];
    assert(record && typeof record.text === 'string');
    const size = Buffer.byteLength(record.text);
    total += size;
    assert(size <= (name === 'journal' ? 64 : name === 'inputs' ? 1 : 16) * 1024 ** 2 && total <= 112 * 1024 ** 2);
    same(digest(record.text), record.sha256);
    return name === 'journal'
      ? record.text
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : JSON.parse(record.text);
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
  if (context.taskId !== undefined) same(context.taskId, task.task_id);
  assert(
    Number.isFinite(task.started_at) && Number.isFinite(task.completed_at) && task.completed_at >= task.started_at,
  );
  const submitted = requests.filter((r) => r.path === '/graph'),
    accepted = responses.filter((r) => r.path === '/graph');
  assert.equal(submitted.length, 1);
  assert.equal(accepted.length, 1);
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
    const value = hint === 'sid' ? api.sid : api.runtimeHints[hint];
    assert(typeof value === 'string' && value);
    same(task[tk], value);
    same(output[ok], value);
  }
  same(task.workflow_snapshot, api.runtimeHints.workflowSnapshot);
  same(output.formSnapshot, task.workflow_snapshot.studioForm);
  assert.equal(output.formSnapshot.trustRemoteCode, false);
  const form = output.formSnapshot,
    p = project(Object.entries(api.nodes), api.paths, form, artifacts);
  same(task.runtimePreparation.resourceMode, form.resourceMode);
  same(task.runtimePreparation.cleanup, null);
  same(task.runtimePreparation.residentRecipeReusable, false);
  if (form.resourceMode === 'expert') {
    same(task.runtimePreparation.performed, false);
    assert(!Object.hasOwn(api.runtimeHints, 'resourceMode') && !Object.hasOwn(api.runtimeHints, 'workflowAutoPlan'));
  } else {
    same(api.runtimeHints.resourceMode, 'auto');
    const auto = task.runtimePreparation.workflowAuto;
    same(auto.strategy, 'dependency_order_retained_owners');
    same(auto.reusedOwnerIds, []);
    same(auto.releases, []);
    const resolved = auto.resolvedFields[p.owner.id];
    for (const [field, expected] of Object.entries({
      pipeline_class: p.recipeValue.pipelineClass,
      revision: p.recipeValue.revision,
      dtype: 'bfloat16',
      device: 'cuda:0',
      offload_mode: p.recipeValue.offloadMode,
      auto_offload: true,
      quantization_mode: 'none',
      mode: form.mode,
    }))
      same(resolved[field], expected);
    same(resolved.model_id, p.value(p.owner, 'model_id'));
  }
  same(output.taskId, task.task_id);
  same(output.nodeId, p.preview.id);
  same(source.fingerprint, task.runtimeFingerprint.backendSource.fingerprint);
  same(source.files.length, task.runtimeFingerprint.backendSource.fileCount);
  same(source.gitCommit, task.runtimeFingerprint.backendSource.gitCommit);
  same(
    source.fingerprint,
    'sha256:backend-source-v1:' + canonicalJsonHash({ gitCommit: source.gitCommit, files: source.files }),
  );
  assert.match(contract.fingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
  const native = output.resolvedExecutionInputs;
  same(native.schemaVersion, 1);
  same(native.source, 'backend-execution');
  same(native.taskId, task.task_id);
  same(native.attemptIndex, 0);
  same(native.nodeId, output.nodeId);
  same(native.truncated, false);
  same(native.uncapturedNodeIds, []);
  same(native.nodes.length, Object.keys(api.nodes).length);
  const rows = new Map(native.nodes.map((n) => [n.nodeId, n]));
  same(rows.size, native.nodes.length);
  for (const [id, node] of Object.entries(api.nodes)) {
    same(rows.get(id)?.module, node.module);
    same(rows.get(id)?.action, node.action);
    same(rows.get(id)?.omittedFields, {});
  }
  const consumed = (role, field, expected) =>
    same(rows.get(role.id).fields[field], { source: 'literal', value: expected });
  for (const [field, expected] of Object.entries({
    model_id: p.recipeValue.repository,
    pipeline_class: p.recipeValue.pipelineClass,
    revision: p.recipeValue.revision,
    dtype: 'bfloat16',
    device: 'cuda:0',
    auto_offload: true,
    offload_mode: p.recipeValue.offloadMode,
    enable_vae_slicing: true,
    enable_vae_tiling: true,
  }))
    consumed(p.owner, field, expected);
  for (const field of ['offload_mode', 'device', 'attention_backend', 'vae_slicing', 'vae_tiling'])
    consumed(p.recipe, field, p.value(p.recipe, field));
  consumed(p.quant, 'dtype', 'bfloat16');
  consumed(p.preview, 'device', 'cpu:0');
  same(derived.taskId, task.task_id);
  for (const name of ['receipt', 'requests', 'responses'])
    same(derived.evidenceHashes[name === 'receipt' ? 'run-receipt.json' : name + '.json'], records[name].sha256);
  const events = journal.filter((e) => e.task?.task_id === task.task_id),
    calls = events.filter((e) => e.event === 'officialCallStarted');
  same(calls, derived.actualOfficialCalls);
  same(calls.length, 1);
  assert(!events.some((e) => e.event === 'officialCallFailed'));
  const call = calls[0];
  assert.match(call.callId, /^[a-f0-9]{32}$/u);
  same(call.task, {
    task_id: task.task_id,
    attempt_index: 0,
    current_node: p.generator.id,
    current_node_name: scope(p.generator.node),
  });
  same(call.actualPipelineClass, call.pipelineClass);
  assert(
    call.actualPipelineClass.startsWith('diffusers.pipelines.') &&
      call.actualPipelineClass.endsWith('.' + p.recipeValue.pipelineClass),
  );
  const returned = events.filter((e) => e.event === 'officialCallReturned' && e.callId === call.callId);
  same(returned.length, 1);
  same(returned[0].task, call.task);
  assert(
    Date.parse(call.at) >= task.started_at * 1000 &&
      Date.parse(returned[0].at) >= Date.parse(call.at) &&
      Date.parse(returned[0].at) <= task.completed_at * 1000,
  );
  same(returned[0].images, [{ mode: 'RGB', size: [form.width, form.height] }]);
  same(call.peftComponentAdapterNames, {});
  same(call.peftComponentBindings, {});
  same(call.peftLayerScaleHistograms, {});
  same(call.wholePipelineAdapterScales, null);
  same(call.modiffLoraIdentities, null);
  same(call.controlnetComponent, null);
  same(call.generator, { device: 'cuda:0', initialSeed: form.seed, type: 'Generator' });
  consumed(p.generator, 'seed', form.seed);
  for (const field of [
    'prompt',
    'width',
    'height',
    'num_inference_steps',
    'max_sequence_length',
    'output_type',
    ...(p.generator.node.action === 'Inpaint' ? ['strength'] : []),
  ]) {
    same(call.callInputs[field], p.value(p.generator, field));
    consumed(p.generator, field, call.callInputs[field]);
  }
  const guidance = ['guidance_scale', 'true_cfg_scale'].filter((k) => call.callInputs[k] != null);
  same(guidance.length, 1);
  const guidanceKeyword = guidance[0];
  same(call.callInputs[guidanceKeyword], form.guidanceScale);
  consumed(p.generator, guidanceKeyword, form.guidanceScale);
  if (guidanceKeyword === 'true_cfg_scale') consumed(p.generator, 'guidance_scale', null);
  const negativePromptPassed = Object.hasOwn(call.callInputs, 'negative_prompt');
  consumed(p.generator, 'negative_prompt', negativePromptPassed ? form.negativePrompt : null);
  if (negativePromptPassed) same(call.callInputs.negative_prompt, form.negativePrompt);
  else assert(!Object.hasOwn(call.declaredSignatureDefaults, 'negative_prompt'));
  const args = [
    'callback_on_step_end_tensor_inputs',
    'height',
    'width',
    'prompt',
    'num_inference_steps',
    'max_sequence_length',
    'output_type',
    'return_dict',
    guidanceKeyword,
    ...(negativePromptPassed ? ['negative_prompt'] : []),
    ...(p.generator.node.action === 'Inpaint' ? ['image', 'mask_image', 'strength'] : ['control_image']),
  ];
  keys(call.callInputs, args);
  same(call.callInputs.return_dict, true);
  same(call.callInputs.callback_on_step_end_tensor_inputs, []);
  const runtime = call.appliedRuntimeConfig;
  same(runtime.attention, {
    applied: [],
    default_selection: true,
    registry_default: 'native',
    requested: 'auto',
    reset: ['transformer'],
    unsupported: [],
  });
  same(runtime.cache, { applied: [], disabled: [], requested: 'none' });
  for (const field of ['channelsLast', 'compile', 'layerwiseCasting'])
    same(runtime[field], { applied: [], requested: false });
  keys(runtime, [
    'attention',
    'cache',
    'channelsLast',
    'compile',
    'layerwiseCasting',
    'vae',
    ...(Object.hasOwn(runtime, 'rocmVisionAttention') ? ['rocmVisionAttention'] : []),
  ]);
  if (Object.hasOwn(runtime, 'rocmVisionAttention')) same(runtime.rocmVisionAttention, ['text_encoder']);
  same(runtime.vae, {
    applied: [
      { enabled: true, feature: 'slicing' },
      { enabled: true, feature: 'tiling' },
    ],
    unsupported: [],
  });
  same(call.vaeMemoryFlags, { use_slicing: true, use_tiling: true });
  assert(
    Object.hasOwn(call.componentRuntimePolicies, 'transformer') && Object.hasOwn(call.componentRuntimePolicies, 'vae'),
  );
  for (const policy of Object.values(call.componentRuntimePolicies))
    same(policy, { requested: null, applied: null, offloadMode: null, executionDevice: null });
  const started = events.filter((e) => e.event === 'schedulerStepStarted'),
    finished = events.filter((e) => e.event === 'schedulerStepReturned');
  same(started.length, form.steps);
  same(finished.length, form.steps);
  same(
    started.map((e) => e.stepIndex),
    [null, ...Array.from({ length: form.steps - 1 }, (_, i) => i + 1)],
  );
  same(
    finished.map((e) => e.stepIndex),
    Array.from({ length: form.steps }, (_, i) => i + 1),
  );
  for (const [i, event] of started.entries()) {
    same(event.task, call.task);
    same(finished[i].task, call.task);
    assert(
      Date.parse(event.at) >= Date.parse(call.at) &&
        Date.parse(event.at) <= Date.parse(finished[i].at) &&
        Date.parse(finished[i].at) <= Date.parse(returned[0].at),
    );
    if (i) assert(Date.parse(event.at) >= Date.parse(finished[i - 1].at));
  }
  same(
    call.scheduler.class,
    'diffusers.schedulers.scheduling_flow_match_euler_discrete.FlowMatchEulerDiscreteScheduler',
  );
  assert(Date.parse(observer.installedAt) <= task.started_at * 1000);
  hash(observer.observerSha256);
  const wrapped = observer.wrappedCalls.filter(
    (r) => r.kind === 'officialPipelineCall' && r.class === call.pipelineClass,
  );
  same(wrapped.length, 1);
  hash(wrapped[0].sourceSha256);
  const upstream = derived.actualDiffusersDirectUrl.value;
  same(upstream.url, 'https://github.com/huggingface/diffusers.git');
  const commit = upstream.vcs_info.commit_id;
  assert.match(commit, /^[a-f0-9]{40}$/u);
  const authority = derived.specializedWholePipelineAuthority;
  same(authority.pipelineClass, call.actualPipelineClass);
  same(authority.diffusersCommit, commit);
  hash(authority.sourceSha256);
  same(models.length, 1);
  const model = models[0];
  same(model.repoId, p.recipeValue.repository);
  same(model.selectedRevision, p.recipeValue.revision);
  same(model.modelRevision, p.recipeValue.repository + '@' + p.recipeValue.revision);
  assert(typeof model.fingerprint === 'string' && model.fingerprint);
  same(comparison.format, 'modiff.image-template-comparison-contract.v1');
  same(comparison.templateId, context.templateId);
  same(comparison.task, p.generator.node.action === 'Inpaint' ? 'inpaint' : 'control_image');
  same(
    comparison.models.map((m) => [m.repoId, m.revision]),
    [[model.repoId, model.selectedRevision]],
  );
  same(inputEvidence.schemaVersion, 1);
  same(inputEvidence.sources.length, p.inputs.length);
  const inputs = p.inputs.map((input) => {
    const current = inputEvidence.sources.filter((x) => x.role === input.role);
    same(current.length, 1);
    const row = current[0];
    same(row.contentHash, input.contentHash);
    same(row.byteSize, input.byteSize);
    hash(row.decodedRgbaSha256);
    const old = comparison.inputs.filter((x) => x.sha256 === input.contentHash.slice('sha256:bytes:'.length));
    same(old.length, 1);
    same(row.originalContractRole, old[0].role);
    const policies = comparison.settings.sourceImagePolicies.filter((x) => x.role === old[0].role);
    same(policies.length, 1);
    same(policies[0].alphaChannel, input.alphaChannel);
    assert(
      Array.isArray(row.size) &&
        row.size.length === 2 &&
        row.size.every((n) => Number.isSafeInteger(n) && n > 0 && n <= 8192),
    );
    return { ...input, originalContractRole: old[0].role, decodedRgbaSha256: row.decodedRgbaSha256, size: row.size };
  });
  const inputPixels = [];
  if (p.canvas) {
    const starts = events.filter((e) => e.event === 'outpaintCanvasStarted'),
      ends = events.filter((e) => e.event === 'outpaintCanvasReturned');
    same(starts.length, 1);
    same(ends.length, 1);
    const start = starts[0],
      end = ends[0];
    same(start.callId, end.callId);
    same(start.nodeObjectId, end.nodeObjectId);
    same(start.task, { ...call.task, current_node: p.canvas.id, current_node_name: scope(p.canvas.node) });
    same(end.task, start.task);
    assert(
      Date.parse(start.at) >= task.started_at * 1000 &&
        Date.parse(start.at) <= Date.parse(end.at) &&
        Date.parse(end.at) <= Date.parse(call.at),
    );
    const kwargs = start.actualInputs.kwargs;
    const controls = Object.fromEntries(
      Object.entries(p.canvas.node.params)
        .filter(([key]) => key !== 'image')
        .map(([key]) => [key, p.value(p.canvas, key)]),
    );
    same(Object.fromEntries(Object.entries(kwargs).filter(([key]) => key !== 'image')), controls);
    same(pixels(kwargs.image).decodedRgbaSha256, inputs[0].decodedRgbaSha256);
    same(kwargs.image.size, inputs[0].size);
    for (const [role, port] of [
      ['image', 'canvas'],
      ['mask_image', 'mask_image'],
    ]) {
      const prepared = pixels(end.output[port]);
      same(prepared, pixels(call.callInputs[role]));
      inputPixels.push({ role, ...prepared });
    }
    const proof = derived.imagePreparationProofs.outpaint;
    same(proof.actualStart, start);
    same(proof.actualReturn, end);
    const sourceFile = source.files.filter((f) => f.path === 'modules/DiffusersImage/main.py');
    same(sourceFile.length, 1);
    same(sourceFile[0].sha256, proof.utilitySource.sha256);
    const utility = observer.wrappedCalls.filter(
      (r) => r.kind === 'actualOutpaintCanvasCall' && r.class === 'modules.DiffusersImage.OutpaintCanvas.execute',
    );
    same(utility.length, 1);
    same(utility[0].sourceSha256, sourceFile[0].sha256);
  } else
    for (const [role, inputRole] of p.generator.node.action === 'Inpaint'
      ? [
          ['image', 'referenceImages[0]'],
          ['mask_image', 'maskImage'],
        ]
      : [['control_image', 'controlImage']]) {
      const actual = pixels(call.callInputs[role]),
        input = inputs.find((x) => x.role === inputRole);
      same(actual.decodedRgbaSha256, input.decodedRgbaSha256);
      same(actual.size, input.size);
      inputPixels.push({ role, ...actual });
    }
  same(output.mediaItems.length, 1);
  same(output.mediaItems[0].width, form.width);
  same(output.mediaItems[0].height, form.height);
  const observation = {
    schemaVersion: 1,
    templateId: context.templateId,
    recipe: p.recipeValue,
    graphControlsHash: p.graphControlsHash,
    formControlsHash: p.formControlsHash,
    backendSourceFingerprint: source.fingerprint,
    backendContractFingerprint: contract.fingerprint,
    taskId: task.task_id,
    rawRecordHashes: Object.fromEntries(recordNames.map((name) => [name, records[name].sha256])),
    rawOfficialCalls: 1,
    rawSchedulerSteps: finished.length,
    upstreamLibrary: {
      url: upstream.url,
      commit,
      reviewedImplementationSourceSha256: authority.sourceSha256,
      observerCallSourceSha256: wrapped[0].sourceSha256,
    },
    inputs,
    inputPixels,
    inputRoute: p.canvas ? 'outpaint_canvas' : 'direct',
    guidanceKeyword,
    negativePromptPassed,
    appliedRuntimeConfigHash: canonicalJsonHash(runtime),
    historicalLimits: limits,
  };
  const plan = {
    source: OBSERVED_RETAINED_DIRECT_IMAGE_SOURCE,
    modelType: p.recipeValue.pipelineClass,
    pipelineClass: p.recipeValue.pipelineClass,
    modelRepo: model.repoId,
    modelRevision: model.selectedRevision,
    dtype: 'bfloat16',
    device: 'cuda:0',
    offloadMode: p.recipeValue.offloadMode,
    autoOffload: true,
    resourceMode: form.resourceMode,
    resolvedResourceMode: form.resourceMode,
    quantizationMode: 'none',
    quantizedComponents: [],
    resourceObservation: observation,
  };
  assert(observedRetainedDirectImageResourceId(plan));
  return plan;
}

export function observedRetainedDirectImagePlan(api, context) {
  try {
    return deriveRetainedDirectImagePlan(api, context);
  } catch {
    return null;
  }
}

export function observedRetainedDirectImageResourceId(plan) {
  try {
    same(plan.source, OBSERVED_RETAINED_DIRECT_IMAGE_SOURCE);
    assertFiniteObservedJson(plan);
    assert(Buffer.byteLength(JSON.stringify(plan)) <= 65536);
    keys(
      plan,
      'source modelType pipelineClass modelRepo modelRevision dtype device offloadMode autoOffload resourceMode resolvedResourceMode quantizationMode quantizedComponents resourceObservation'.split(
        ' ',
      ),
    );
    const o = plan.resourceObservation,
      r = o.recipe;
    keys(
      o,
      'schemaVersion templateId recipe graphControlsHash formControlsHash backendSourceFingerprint backendContractFingerprint taskId rawRecordHashes rawOfficialCalls rawSchedulerSteps upstreamLibrary inputs inputPixels inputRoute guidanceKeyword negativePromptPassed appliedRuntimeConfigHash historicalLimits'.split(
        ' ',
      ),
    );
    keys(
      r,
      'pipelineClass formModelType mode operation repository revision dtype device offloadMode autoOffload geometry'.split(
        ' ',
      ),
    );
    same(o.schemaVersion, 1);
    assert(typeof o.templateId === 'string' && o.templateId.length > 0 && o.templateId.length <= 128);
    same(o.rawOfficialCalls, 1);
    assert(Number.isSafeInteger(o.rawSchedulerSteps) && o.rawSchedulerSteps > 0 && o.rawSchedulerSteps <= 4096);
    for (const v of [o.graphControlsHash, o.formControlsHash, o.appliedRuntimeConfigHash]) hash(v);
    assert.match(o.backendSourceFingerprint, /^sha256:backend-source-v1:[a-f0-9]{64}$/u);
    assert.match(o.backendContractFingerprint, /^sha256:backend-contract-v1:[a-f0-9]{64}$/u);
    assert(typeof o.taskId === 'string' && o.taskId.length > 0 && o.taskId.length <= 128);
    keys(o.rawRecordHashes, recordNames);
    Object.values(o.rawRecordHashes).forEach(hash);
    same(o.historicalLimits, limits);
    same(r.dtype, 'bfloat16');
    same(r.device, 'cuda:0');
    same(r.autoOffload, true);
    assert(['model_cpu', 'group_cpu'].includes(r.offloadMode));
    assert(['inpaint', 'outpaint', 'control_image'].includes(r.mode));
    same(r.operation, r.mode === 'control_image' ? 'ControlGenerate' : 'Inpaint');
    assert.match(r.pipelineClass, /^[A-Za-z]\w*Pipeline$/u);
    assert(typeof r.formModelType === 'string' && r.formModelType.length > 0 && r.formModelType.length <= 256);
    assert.match(r.repository, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
    assert.match(r.revision, /^[a-f0-9]{40}$/u);
    keys(r.geometry, ['width', 'height']);
    for (const n of Object.values(r.geometry)) assert(Number.isSafeInteger(n) && n > 0 && n <= 4096);
    for (const [key, rkey] of Object.entries({
      modelType: 'pipelineClass',
      pipelineClass: 'pipelineClass',
      modelRepo: 'repository',
      modelRevision: 'revision',
      dtype: 'dtype',
      device: 'device',
      offloadMode: 'offloadMode',
      autoOffload: 'autoOffload',
    }))
      same(plan[key], r[rkey]);
    assert(['auto', 'expert'].includes(plan.resourceMode));
    same(plan.resourceMode, plan.resolvedResourceMode);
    same(plan.quantizationMode, 'none');
    same(plan.quantizedComponents, []);
    keys(o.upstreamLibrary, ['url', 'commit', 'reviewedImplementationSourceSha256', 'observerCallSourceSha256']);
    same(o.upstreamLibrary.url, 'https://github.com/huggingface/diffusers.git');
    assert.match(o.upstreamLibrary.commit, /^[a-f0-9]{40}$/u);
    hash(o.upstreamLibrary.reviewedImplementationSourceSha256);
    hash(o.upstreamLibrary.observerCallSourceSha256);
    assert(['direct', 'outpaint_canvas'].includes(o.inputRoute));
    assert(['guidance_scale', 'true_cfg_scale'].includes(o.guidanceKeyword));
    same(typeof o.negativePromptPassed, 'boolean');
    assert(Array.isArray(o.inputs) && o.inputs.length >= 1 && o.inputs.length <= 2);
    assert(new Set(o.inputs.map((i) => i.role)).size === o.inputs.length);
    for (const i of o.inputs) {
      keys(i, ['role', 'contentHash', 'byteSize', 'alphaChannel', 'originalContractRole', 'decodedRgbaSha256', 'size']);
      assert(['referenceImages[0]', 'maskImage', 'controlImage'].includes(i.role));
      assert(['ignore', 'remove alpha'].includes(i.alphaChannel));
      assert.match(i.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
      assert(Number.isSafeInteger(i.byteSize) && i.byteSize > 0);
      hash(i.decodedRgbaSha256);
      assert.match(i.originalContractRole, /^referenceImage[12]$/u);
      assert(i.size.length === 2 && i.size.every((n) => Number.isSafeInteger(n) && n > 0 && n <= 8192));
    }
    assert(Array.isArray(o.inputPixels) && o.inputPixels.length === (r.operation === 'Inpaint' ? 2 : 1));
    same(
      o.inputPixels.map((i) => i.role).sort(),
      r.operation === 'Inpaint' ? ['image', 'mask_image'] : ['control_image'],
    );
    for (const i of o.inputPixels) {
      keys(i, ['role', 'mode', 'size', 'sha256', 'decodedRgbaSha256']);
      pixels(i);
    }
    same(
      o.inputs.map((i) => i.role).sort(),
      r.operation === 'ControlGenerate'
        ? ['controlImage']
        : o.inputRoute === 'outpaint_canvas'
          ? ['referenceImages[0]']
          : ['maskImage', 'referenceImages[0]'],
    );
    if (o.inputRoute === 'outpaint_canvas') {
      same(r.mode, 'outpaint');
      for (const i of o.inputPixels) same(i.size, [r.geometry.width, r.geometry.height]);
    } else {
      for (const i of o.inputPixels) {
        const role = i.role === 'image' ? 'referenceImages[0]' : i.role === 'mask_image' ? 'maskImage' : 'controlImage';
        const source = o.inputs.find((item) => item.role === role);
        same(i.decodedRgbaSha256, source.decodedRgbaSha256);
        same(i.size, source.size);
      }
    }
    return (
      'observed-retained-direct-image-v1:' +
      canonicalJsonHash({
        recipe: r,
        upstreamLibrary: o.upstreamLibrary,
        appliedRuntimeConfigHash: o.appliedRuntimeConfigHash,
        backendSourceFingerprint: o.backendSourceFingerprint,
        backendContractFingerprint: o.backendContractFingerprint,
      })
    );
  } catch {
    return null;
  }
}

export function observedRetainedDirectImageProofMatches(plan, provenance) {
  try {
    assert(observedRetainedDirectImageResourceId(plan));
    const o = plan.resourceObservation,
      g = provenance.graph.canonicalGraph;
    const p = project(
      g.nodes.map((n) => [n.key, n]),
      g.paths,
      provenance.template.lockedSettings,
      provenance.inputs.items,
    );
    same(p.recipeValue, o.recipe);
    same(p.graphControlsHash, o.graphControlsHash);
    same(p.formControlsHash, o.formControlsHash);
    same(o.inputRoute, p.canvas ? 'outpaint_canvas' : 'direct');
    same(
      p.inputs,
      o.inputs.map(({ role, contentHash, byteSize, alphaChannel }) => ({ role, contentHash, byteSize, alphaChannel })),
    );
    same(provenance.template.id, o.templateId);
    same(provenance.taskId, o.taskId);
    same(provenance.template.lockedSettings.steps, o.rawSchedulerSteps);
    same(provenance.runtime.backendSource.fingerprint, o.backendSourceFingerprint);
    same(provenance.runtime.backendContract.fingerprint, o.backendContractFingerprint);
    same(provenance.models.items.length, 1);
    const m = provenance.models.items[0];
    same(m.repoId, o.recipe.repository);
    same(m.selectedRevision, o.recipe.revision);
    same(provenance.output.items.length, 1);
    same(provenance.output.items[0].mediaType, 'image');
    same(provenance.output.items[0].width, o.recipe.geometry.width);
    same(provenance.output.items[0].height, o.recipe.geometry.height);
    return true;
  } catch {
    return false;
  }
}
