// Maintainer evidence only. Uses native dispatch captures and grants no execution admission.
import assert from 'node:assert/strict';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import { assertFiniteObservedJson, workerGraphHash } from './observed-workflow-auto-resource.mjs';
export const OBSERVED_WORKFLOW_AUTO_CONTROL_SOURCE = 'observed-workflow-auto-control-resource-v1';
const same = (a, b) => assert.deepEqual(stableJsonValue(a), stableJsonValue(b));
const key = (n) => n.module + '.' + n.action;
const prefix = 'modules.ModularDiffusers.';
const kinds = ['AutoModelLoader', 'ModelsLoader', 'Controlnet', 'Guider', 'EncodePrompt', 'Denoise', 'DecodeLatents']
  .map((k) => prefix + k)
  .concat('modules.Image.Load', 'modules.Image.Preview');
function project(entries, paths, form, artifacts) {
  assert.equal(form.mode, 'control_image');
  assert.equal(form.resourceMode, 'auto');
  assert.equal(form.quantizationMode, 'none');
  if (Object.hasOwn(form, 'trustRemoteCode')) assert.equal(form.trustRemoteCode, false);
  assert.equal(form.randomSeed, false);
  assert.equal(entries.length, 9);
  assert.equal(paths.length, 1);
  same([...paths[0]].sort(), entries.map(([id]) => id).sort());
  assert.equal(new Set(paths[0]).size, 9);
  const roles = new Map(entries.map(([id, node]) => [key(node), { id, node }]));
  same([...roles.keys()].sort(), [...kinds].sort());
  const role = (k) => roles.get(k.includes('.') ? k : prefix + k);
  const val = (r, k) => {
    const p = r.node.params[k];
    assert(p && !p.sourceId && !p.sourceKey, r.node.action + '.' + k);
    return p.value;
  };
  const owner = role('ModelsLoader'),
    aux = role('AutoModelLoader'),
    control = role('Controlnet'),
    guide = role('Guider'),
    enc = role('EncodePrompt'),
    den = role('Denoise'),
    dec = role('DecodeLatents'),
    load = role('modules.Image.Load'),
    out = role('modules.Image.Preview');
  const edges = new Set();
  for (const [t, f, s, p] of [
    [control, 'control_image', load, 'image'],
    [control, 'controlnet', aux, 'model'],
    [control, 'vae', owner, 'vae_out'],
    [owner, 'controlnet', aux, 'model'],
    [enc, 'text_encoders', owner, 'text_encoders'],
    [enc, 'guider', guide, 'guider_out'],
    [den, 'unet', owner, 'unet_out'],
    [den, 'embeddings', enc, 'embeddings'],
    [den, 'controlnet_bundle', control, 'controlnet_bundle'],
    [den, 'route_state_in', control, 'route_state_out'],
    [den, 'guider', guide, 'guider_out'],
    [den, 'scheduler', owner, 'scheduler'],
    [dec, 'vae', owner, 'vae_out'],
    [dec, 'latents', den, 'latents'],
    [dec, 'route_state_in', den, 'route_state_out'],
    [out, 'image', dec, 'images'],
  ]) {
    const v = t.node.params[f];
    same({ id: v?.sourceId, port: v?.sourceKey }, { id: s.id, port: p });
    assert(!Object.hasOwn(v, 'value'));
    assert(paths[0].indexOf(s.id) < paths[0].indexOf(t.id));
    edges.add(t.id + ':' + f);
  }
  for (const [id, node] of entries)
    for (const [f, p] of Object.entries(node.params)) {
      if (p.sourceId) assert(edges.has(id + ':' + f));
      else if (p.sourceKey)
        assert(id === out.id && f === 'preview' && p.sourceKey === 'output' && p.display === 'ui_image');
    }
  same(val(owner, 'model_type'), form.modelType);
  same(val(owner, 'dtype'), form.dtype);
  same(val(owner, 'device'), 'cuda:0');
  same(val(owner, 'workflow_id'), 'controlnet_text2image');
  same(val(owner, 'trust_remote_code'), false);
  same(val(owner, 'weight_format'), 'native');
  same(val(owner, 'weight_loading_mode'), 'cpu');
  for (const f of ['unet', 'vae', 'lora_list', 'quant_config']) {
    const p = owner.node.params[f];
    assert(!p?.sourceId && !p?.sourceKey && p?.value == null);
  }
  const base = val(owner, 'repo_id'),
    auxiliary = val(aux, 'model_id');
  same(base.source, 'hub');
  same(auxiliary.source, 'hub');
  for (const repo of [base.value, auxiliary.value]) assert.match(repo, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
  const revision = val(owner, 'revision'),
    auxRevision = val(aux, 'revision');
  for (const v of [revision, auxRevision]) assert.match(v, /^[a-f0-9]{40}$/u);
  same(val(aux, 'model_type'), 'controlnet');
  same(val(aux, 'dtype'), form.dtype);
  same(val(aux, 'device'), 'cuda:0');
  same(val(aux, 'auto_offload'), false);
  same(val(aux, 'offload_mode'), 'none');
  same(val(aux, 'trust_remote_code'), false);
  for (const f of ['subfolder', 'variant', 'component_class']) same(val(aux, f), '');
  assert(['none', 'model_cpu', 'group_cpu'].includes(val(owner, 'offload_mode')));
  assert.equal(typeof val(owner, 'auto_offload'), 'boolean');
  assert(['bfloat16', 'float16'].includes(form.dtype));
  for (const [f, k] of [
    ['width', 'width'],
    ['height', 'height'],
    ['seed', 'seed'],
    ['num_inference_steps', 'steps'],
    ['strength', 'strength'],
  ])
    same(val(den, f), form[k]);
  for (const f of ['width', 'height', 'seed']) same(val(control, f), form[f]);
  same(val(control, 'model_type'), form.modelType);
  for (const f of ['width', 'height', 'steps', 'seed'])
    assert(Number.isSafeInteger(form[f]) && form[f] >= 0 && form[f] <= 2 ** 32);
  same(val(control, 'controlnet_conditioning_scale'), form.conditioningScale);
  same(val(control, 'control_guidance_start'), 0);
  same(val(control, 'control_guidance_end'), 1);
  assert(Number.isFinite(form.conditioningScale) && form.conditioningScale >= 0 && form.conditioningScale <= 2);
  assert(Number.isFinite(form.guidanceScale) && form.guidanceScale >= 0 && form.guidanceScale <= 100);
  assert(Number.isFinite(form.strength) && form.strength >= 0 && form.strength <= 1);
  for (const [f, k] of [
    ['prompt', 'prompt'],
    ['negative_prompt', 'negativePrompt'],
  ]) {
    if (Object.hasOwn(enc.node.params, f)) same(val(enc, f), form[k]);
    else same(form[k], '');
  }
  same(val(enc, 'max_sequence_length'), form.maxSequenceLength);
  same(val(guide, 'model_type'), form.modelType);
  same(val(guide, 'guider'), 'ClassifierFreeGuidance');
  same(val(guide, 'guidance_scale'), form.guidanceScale);
  assert(
    Number.isFinite(val(den, 'guidance_scale')) && val(den, 'guidance_scale') >= 0 && val(den, 'guidance_scale') <= 100,
  );
  for (const [f, v] of Object.entries({
    guidance_rescale: 0,
    use_original_formulation: false,
    enabled: true,
    start: 0,
    stop: 1,
  }))
    same(val(guide, f), v);
  same(val(load, 'alpha_channel'), 'ignore');
  const file = val(load, 'file');
  assert(typeof file === 'string' && file.length > 0 && file.length <= 16384);
  if (form.controlImage !== undefined) same(file, form.controlImage);
  same(artifacts.length, 1);
  const input = artifacts[0];
  same(input.role, 'controlImage');
  same(input.path, file);
  assert.match(input.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
  assert(Number.isSafeInteger(input.byteSize) && input.byteSize > 0);
  const labels = new Map(entries.map(([id, n]) => [id, key(n)]));
  const projection = paths[0].map((id) => {
    const n = entries.find(([k]) => k === id)[1];
    return {
      scope: key(n),
      params: Object.fromEntries(
        Object.entries(n.params)
          .filter(([k, p]) => k !== 'label' && !p.display?.startsWith('ui_'))
          .map(([k, p]) => [
            k,
            p.sourceId
              ? { supplier: labels.get(p.sourceId), port: p.sourceKey }
              : {
                  hasValue: Object.hasOwn(p, 'value'),
                  value: n === load.node && k === 'file' ? 'controlImage' : (p.value ?? null),
                },
          ]),
      ),
    };
  });
  const formFields = [
    'mode',
    'resourceMode',
    'modelType',
    'dtype',
    'quantizationMode',
    'randomSeed',
    'width',
    'height',
    'steps',
    'seed',
    'guidanceScale',
    'strength',
    'prompt',
    'negativePrompt',
    'conditioningScale',
    'maxSequenceLength',
  ];
  const observation = {
    schemaVersion: 1,
    graphControlsHash: canonicalJsonHash(projection),
    formControlsHash: canonicalJsonHash(Object.fromEntries(formFields.map((k) => [k, form[k]]))),
    geometry: { width: form.width, height: form.height },
    input: { role: input.role, contentHash: input.contentHash, byteSize: input.byteSize },
    auxiliary: {
      repo: auxiliary.value,
      revision: auxRevision,
      dtype: form.dtype,
      device: 'cuda:0',
      autoOffload: false,
      offloadMode: 'none',
    },
    authoredControlScale: form.conditioningScale,
    nativeControlScaleObserved: false,
    originalGraphTask: null,
    guiderScale: val(guide, 'guidance_scale'),
    denoiserGuidanceScale: val(den, 'guidance_scale'),
    requestedOffloadMode: form.offloadMode,
    requestedAutoOffload: form.autoOffload,
  };
  const plan = {
    source: OBSERVED_WORKFLOW_AUTO_CONTROL_SOURCE,
    modelType: form.modelType,
    modelRepo: base.value,
    modelRevision: revision,
    task: 'control_image',
    resourceMode: 'auto',
    resolvedResourceMode: 'auto',
    dtype: form.dtype,
    device: 'cuda:0',
    offloadMode: val(owner, 'offload_mode'),
    autoOffload: val(owner, 'auto_offload'),
    quantizationMode: 'none',
    quantizedComponents: [],
    resourceObservation: observation,
  };
  return { plan, roles, owner, aux, control, guide, enc, den, dec, load, out, val };
}
export function observedWorkflowAutoControlResourceId(plan) {
  try {
    assertFiniteObservedJson(plan);
    assert(Buffer.byteLength(JSON.stringify(plan)) <= 65536);
    same(
      Object.keys(plan).sort(),
      'source modelType modelRepo modelRevision task resourceMode resolvedResourceMode dtype device offloadMode autoOffload quantizationMode quantizedComponents resourceObservation'
        .split(' ')
        .sort(),
    );
    same(plan.source, OBSERVED_WORKFLOW_AUTO_CONTROL_SOURCE);
    same(plan.task, 'control_image');
    same(plan.resourceMode, 'auto');
    same(plan.resolvedResourceMode, 'auto');
    same(plan.quantizationMode, 'none');
    same(plan.quantizedComponents, []);
    assert.match(plan.modelType, /^[A-Za-z]\w*ModularPipeline$/u);
    assert.match(plan.modelRepo, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
    assert.match(plan.modelRevision, /^[a-f0-9]{40}$/u);
    assert(['bfloat16', 'float16'].includes(plan.dtype));
    same(plan.device, 'cuda:0');
    assert(['none', 'model_cpu', 'group_cpu'].includes(plan.offloadMode));
    assert.equal(typeof plan.autoOffload, 'boolean');
    const o = plan.resourceObservation;
    same(
      Object.keys(o).sort(),
      'schemaVersion graphControlsHash formControlsHash geometry input auxiliary authoredControlScale nativeControlScaleObserved originalGraphTask guiderScale denoiserGuidanceScale requestedOffloadMode requestedAutoOffload'
        .split(' ')
        .sort(),
    );
    same(o.schemaVersion, 1);
    for (const h of [o.graphControlsHash, o.formControlsHash]) assert.match(h, /^[a-f0-9]{64}$/u);
    same(Object.keys(o.geometry).sort(), ['height', 'width']);
    for (const n of Object.values(o.geometry)) assert(Number.isSafeInteger(n) && n > 0 && n <= 32768);
    same(Object.keys(o.input).sort(), ['byteSize', 'contentHash', 'role']);
    same(o.input.role, 'controlImage');
    assert.match(o.input.contentHash, /^sha256:bytes:[a-f0-9]{64}$/u);
    assert(Number.isSafeInteger(o.input.byteSize) && o.input.byteSize > 0);
    same(Object.keys(o.auxiliary).sort(), 'repo revision dtype device autoOffload offloadMode'.split(' ').sort());
    assert.match(o.auxiliary.repo, /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/u);
    assert.match(o.auxiliary.revision, /^[a-f0-9]{40}$/u);
    same(o.auxiliary.dtype, plan.dtype);
    same(o.auxiliary.device, 'cuda:0');
    same(o.auxiliary.autoOffload, false);
    same(o.auxiliary.offloadMode, 'none');
    same(o.nativeControlScaleObserved, false);
    same(o.originalGraphTask, null);
    assert(Number.isFinite(o.authoredControlScale) && o.authoredControlScale >= 0 && o.authoredControlScale <= 2);
    assert(Number.isFinite(o.guiderScale) && o.guiderScale >= 0 && o.guiderScale <= 100);
    assert(Number.isFinite(o.denoiserGuidanceScale) && o.denoiserGuidanceScale >= 0 && o.denoiserGuidanceScale <= 100);
    assert.equal(typeof o.requestedAutoOffload, 'boolean');
    assert(['none', 'model_cpu', 'group_cpu'].includes(o.requestedOffloadMode));
    return 'observed-workflow-auto-control-v1:' + canonicalJsonHash(plan);
  } catch {
    return null;
  }
}
export function observedWorkflowAutoControlPlan(api, context = {}) {
  try {
    const {
        executionReceipt: task,
        executedOutput: output,
        taskId,
        modelIdentities: models,
        inputArtifacts = [],
      } = context,
      hints = api.runtimeHints,
      form = hints.workflowSnapshot.studioForm;
    same(hints.resourceMode, 'auto');
    same(form.trustRemoteCode, false);
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
    same(output.nodeId, p.out.id);
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
    same(native.nodeId, p.out.id);
    same(native.truncated, false);
    same(native.uncapturedNodeIds, []);
    same(native.nodes.length, 9);
    const rows = new Map(native.nodes.map((n) => [n.nodeId, n]));
    same(rows.size, 9);
    for (const [id, n] of Object.entries(api.nodes)) {
      same(rows.get(id)?.module, n.module);
      same(rows.get(id)?.action, n.action);
      same(rows.get(id)?.omittedFields, {});
    }
    same(native.graphTasks, [{ loaderId: p.owner.id, pipelineClass: p.plan.modelType, task: null }]);
    const consumed = (r, k, v) => same(rows.get(r.id).fields[k], { source: 'literal', value: v });
    for (const [r, fields] of [
      [
        p.owner,
        'repo_id revision model_type dtype device offload_mode auto_offload weight_loading_mode attention_backend vae_slicing vae_tiling',
      ],
      [p.aux, 'model_type model_id revision dtype device offload_mode auto_offload'],
      [p.guide, 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'],
      [p.den, 'width height seed num_inference_steps guidance_scale strength'],
      [p.control, 'model_type width height seed control_guidance_start control_guidance_end'],
    ])
      for (const k of fields.split(' ')) {
        const v = p.val(r, k);
        consumed(r, k, ['repo_id', 'model_id'].includes(k) ? v.value : v);
      }
    consumed(p.owner, 'quant_config', null);
    consumed(p.enc, 'max_sequence_length', form.maxSequenceLength);
    consumed(p.load, 'alpha_channel', 'ignore');
    consumed(p.load, 'source_hashes', [p.plan.resourceObservation.input.contentHash.slice(13)]);
    for (const k of ['prompt', 'negative_prompt'])
      if (Object.hasOwn(p.enc.node.params, k)) consumed(p.enc, k, p.val(p.enc, k));
    assert(!Object.hasOwn(rows.get(p.control.id).fields, 'controlnet_conditioning_scale'));
    const expectedResolved = [p.owner, p.enc, p.guide, p.den, p.control, p.aux];
    same(Object.keys(auto.resolvedFields).sort(), expectedResolved.map((r) => r.id).sort());
    for (const r of expectedResolved)
      for (const [k, v] of Object.entries(auto.resolvedFields[r.id])) same(v, p.val(r, k));
    same(models.length, 2);
    for (const [repo, revision] of [
      [p.plan.modelRepo, p.plan.modelRevision],
      [p.plan.resourceObservation.auxiliary.repo, p.plan.resourceObservation.auxiliary.revision],
    ]) {
      const m = models.filter((m) => m.repoId === repo);
      same(m.length, 1);
      same(m[0].selectedRevision, revision);
      same(m[0].modelRevision, repo + '@' + revision);
      assert(m[0].fingerprint);
    }
    assert(observedWorkflowAutoControlResourceId(p.plan));
    return stableJsonValue(p.plan);
  } catch {
    return null;
  }
}
export function observedWorkflowAutoControlProofMatches(plan, provenance) {
  try {
    assert(observedWorkflowAutoControlResourceId(plan));
    const g = provenance.graph.canonicalGraph,
      p = project(
        g.nodes.map((n) => [n.key, n]),
        g.paths,
        provenance.template.lockedSettings,
        provenance.inputs.items,
      );
    p.plan.resourceObservation.requestedOffloadMode = plan.resourceObservation.requestedOffloadMode;
    p.plan.resourceObservation.requestedAutoOffload = plan.resourceObservation.requestedAutoOffload;
    same(p.plan, plan);
    same(provenance.inputs.count, 1);
    same(
      provenance.models.items.map((m) => [m.repoId, m.selectedRevision]).sort(),
      [
        [plan.modelRepo, plan.modelRevision],
        [plan.resourceObservation.auxiliary.repo, plan.resourceObservation.auxiliary.revision],
      ].sort(),
    );
    same(provenance.output.items.length, 1);
    same(provenance.output.items[0].mediaType, 'image');
    for (const k of ['width', 'height']) same(provenance.output.items[0][k], plan.resourceObservation.geometry[k]);
    return true;
  } catch {
    return false;
  }
}
