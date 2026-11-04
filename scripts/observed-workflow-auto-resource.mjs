// Maintainer evidence reader only. No graph execution, Auto admission or qualification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';
import { validateAppliedAdapterItems, validateAppliedAdapterProof } from './applied-adapter-provenance.mjs';

export const OBSERVED_WORKFLOW_AUTO_SOURCE = 'observed-workflow-auto-resource-v1';
export const OBSERVED_WORKFLOW_AUTO_LORA_SOURCE = 'observed-workflow-auto-lora-resource-v1';
export const isObservedWorkflowAutoSource = (source) =>
  source === OBSERVED_WORKFLOW_AUTO_SOURCE || source === OBSERVED_WORKFLOW_AUTO_LORA_SOURCE;
const same = (a, b) => assert.deepEqual(stableJsonValue(a), stableJsonValue(b));
const value = (node, key) => node.params?.[key]?.value;
const scope = (node) => `${node.module}.${node.action}`;
const ownerScope = 'modules.ModularDiffusers.ModelsLoader';
const core = ['ModelsLoader', 'EncodePrompt', 'Denoise', 'DecodeLatents']
  .map((a) => 'modules.ModularDiffusers.' + a)
  .concat('modules.Image.Preview');
const optional = 'modules.ModularDiffusers.Guider';
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

// Same compact sorted ASCII-JSON wire domain as the worker. A representation
// mismatch remains unsupported; it is never repaired by replacing the receipt.
function workerGraphHash(graph) {
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
    const o = plan.resourceObservation;
    finiteJson(o);
    assert.equal(o.schemaVersion, 1);
    assert.equal(typeof o.modelType, 'string');
    assert(o.modelType.length > 0);
    assert.equal(typeof o.repo, 'string');
    assert(o.repo.length > 0);
    assert.match(o.revision, /^[0-9a-f]{40}$/u);
    assert.equal(o.task, 'text_to_image');
    assert(['bfloat16', 'float16', 'float32'].includes(o.dtype));
    assert.equal(typeof o.device, 'string');
    assert(o.device.length > 0);
    assert.equal(typeof o.autoOffload, 'boolean');
    assert(['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'].includes(o.offloadMode));
    assert(['cpu', 'cuda'].includes(o.weightLoadingMode));
    for (const key of ['width', 'height'])
      assert(Number.isInteger(o.geometry[key]) && o.geometry[key] > 0 && o.geometry[key] <= 32768);
    assert.equal(o.strategy, 'dependency_order_retained_owners');
    assert(Array.isArray(o.controls) && o.controls.length >= 2 && o.controls.length <= 3);
    const controls = new Map(o.controls.map((c) => [c.scope, c.fields]));
    assert.equal(controls.size, o.controls.length);
    assert(controls.has(ownerScope));
    const denoiseFields = controls.get('modules.ModularDiffusers.Denoise');
    assert(denoiseFields);
    for (const key of ['width', 'height']) same(denoiseFields[key], o.geometry[key]);
    for (const [kind, fields] of controls) {
      assert(kind === ownerScope || kind === 'modules.ModularDiffusers.Denoise' || kind === optional);
      for (const key of Object.keys(fields)) assert((kind === ownerScope ? ownerFields : scalarFields).has(key));
    }
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
        assert(Object.hasOwn(primary, key));
        same(primary[key], o[observed]);
      }
      assert.equal(primary.weight_format, 'native');
    } else assert(!Object.hasOwn(o, 'adapters'));
    const id = plan.source + ':' + canonicalJsonHash(o);
    assert.equal(plan.observedResourceCandidateId, id);
    return id;
  } catch {
    return null;
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
export function observedWorkflowAutoPlan(
  apiGraph,
  { executionReceipt: task, executedOutput: output, taskId, adapterProofContext } = {},
) {
  try {
    const hints = apiGraph.runtimeHints,
      snapshot = hints.workflowSnapshot,
      form = snapshot.studioForm;
    assert.equal(hints.resourceMode, 'auto');
    assert.equal(form.resourceMode, 'auto');
    assert.equal(form.mode, 'text_to_image');
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
    assert(entries.length <= 7);
    const scopes = new Map();
    for (const [id, node] of entries) {
      const key = scope(node);
      assert(core.includes(key) || key === optional || key === descriptorScope);
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
    same(receipt.graphTasks, [{ loaderId: ownerId, pipelineClass: value(owner, 'model_type'), task: 'text_to_image' }]);
    assert.equal(form.modelType, value(owner, 'model_type'));
    assert.equal(form.quantizationMode, 'none');
    assert.equal(form.trustRemoteCode, false);
    assert.equal(value(owner, 'trust_remote_code'), false);
    assert.equal(value(owner, 'weight_format'), 'native');
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
      assert.equal(trace[key].source, 'literal');
      same(trace[key].value, key === 'repo_id' ? repo.value : value(owner, key));
    }
    assert.equal(trace.quant_config.source, 'literal');
    assert.equal(trace.quant_config.value, null);
    assert(['bfloat16', 'float16', 'float32'].includes(value(owner, 'dtype')));
    assert.equal(typeof value(owner, 'auto_offload'), 'boolean');
    assert.equal(typeof value(owner, 'device'), 'string');
    assert(['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'].includes(value(owner, 'offload_mode')));
    assert(['cpu', 'cuda'].includes(value(owner, 'weight_loading_mode')));
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
    ])
      assert(Object.hasOwn(auto.resolvedFields[ownerId], key));
    const denoiseOwner = scopes.get('modules.ModularDiffusers.Denoise').id;
    for (const key of ['width', 'height']) assert(Object.hasOwn(auto.resolvedFields[denoiseOwner], key));
    const controls = [];
    for (const [id, fields] of Object.entries(auto.resolvedFields)) {
      const node = apiGraph.nodes[id];
      assert(node);
      const kind = scope(node);
      assert(kind === ownerScope || kind === 'modules.ModularDiffusers.Denoise' || kind === optional);
      for (const [key, v] of Object.entries(fields)) {
        assert((kind === ownerScope ? ownerFields : scalarFields).has(key));
        assert(!node.params[key]?.sourceId && !node.params[key]?.sourceKey);
        same(v, value(node, key));
        const captured = rows.get(id).fields[key];
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
    for (const [key, formKey] of [
      ['prompt', 'prompt'],
      ['negative_prompt', 'negativePrompt'],
    ]) {
      assert.equal(rows.get(encoded.id).fields[key].source, 'literal');
      same(rows.get(encoded.id).fields[key].value, value(encoded.node, key));
      same(value(encoded.node, key), form[formKey]);
    }
    const plan = {
      source: adapters ? OBSERVED_WORKFLOW_AUTO_LORA_SOURCE : OBSERVED_WORKFLOW_AUTO_SOURCE,
      modelType: value(owner, 'model_type'),
      pipelineClass: value(owner, 'model_type'),
      modelRepo: repo.value,
      resolvedModelRepo: repo.value,
      resolvedArtifact: repo.value,
      modelRevision: revision,
      task: 'text_to_image',
      resourceMode: 'auto',
      resolvedResourceMode: 'auto',
      dtype: value(owner, 'dtype'),
      device: value(owner, 'device'),
      offloadMode: value(owner, 'offload_mode'),
      autoOffload: value(owner, 'auto_offload'),
      weightLoadingMode: value(owner, 'weight_loading_mode'),
      attentionBackend: value(owner, 'attention_backend'),
      vaeSlicing: value(owner, 'vae_slicing'),
      vaeTiling: value(owner, 'vae_tiling'),
      quantizationMode: 'none',
      quantizedComponents: [],
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
      weightLoadingMode: plan.weightLoadingMode,
      attentionBackend: plan.attentionBackend,
      vaeSlicing: plan.vaeSlicing,
      vaeTiling: plan.vaeTiling,
      geometry: { width: d.width.value, height: d.height.value },
      strategy: auto.strategy,
      controls,
      ...(adapters ? { adapters } : {}),
    };
    return {
      ...plan,
      resourceObservation: observation,
      observedResourceCandidateId: plan.source + ':' + canonicalJsonHash(observation),
    };
  } catch {
    return null;
  }
}
