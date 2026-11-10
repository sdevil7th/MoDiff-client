import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeApiGraph,
  executionPlanIdentity,
  executionReceiptIdentity,
  validateRunProvenance,
  backendContractIdentity,
} from './live-proof-provenance.mjs';
import { createAppliedAdapterProof } from './applied-adapter-provenance.mjs';
import {
  observedWorkflowAutoLoraProofMatches,
  observedWorkflowAutoImageProofMatches,
  observedWorkflowAutoLegacyProofMatches,
  observedWorkflowAutoTextGeometryProofMatches,
  observedWorkflowAutoResourceId,
} from './observed-workflow-auto-resource.mjs';
import { canonicalJsonHash, stableJsonValue } from './canonical-json.mjs';

const literal = (value) => ({ value });
function graphHash(graph) {
  const material = JSON.stringify(stableJsonValue({ nodes: graph.nodes, paths: graph.paths })).replace(
    /[\u007f-\uffff]/gu,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  return 'sha256:workflow-auto-v1:' + createHash('sha256').update(material).digest('hex');
}
function witness({ prefix = '', width = 1024, prompt = 'A product photograph', seed = 4202, guider = false } = {}) {
  const ids = Object.fromEntries(['owner', 'encode', 'denoise', 'decode', 'preview'].map((k) => [k, prefix + k]));
  const connect = (id, key) => ({ sourceId: ids[id], sourceKey: key });
  const values = {
    reviewed_variant: 'example/native-image',
    workflow_id: 'text2image',
    revision: 'a'.repeat(40),
    repo_id: { source: 'hub', value: 'example/native-image' },
    model_type: 'ExampleModularPipeline',
    dtype: 'bfloat16',
    device: 'cuda:0',
    offload_mode: 'model_cpu',
    auto_offload: true,
    weight_loading_mode: 'cpu',
    attention_backend: 'auto',
    vae_slicing: true,
    vae_tiling: true,
    weight_format: 'native',
    inpaint_compatibility: 'native',
  };
  const form = {
    mode: 'text_to_image',
    modelType: values.model_type,
    resourceMode: 'auto',
    dtype: values.dtype,
    quantizationMode: 'none',
    trustRemoteCode: false,
    prompt,
    negativePrompt: '',
    width,
    height: 1024,
    seed,
  };
  const nodes = {
    [ids.owner]: {
      module: 'modules.ModularDiffusers',
      action: 'ModelsLoader',
      params: {
        ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, literal(v)])),
        trust_remote_code: literal(false),
        quant_config: literal(null),
        unet: literal(null),
        vae: literal(null),
        controlnet: literal(null),
        lora_list: literal(null),
      },
    },
    [ids.encode]: {
      module: 'modules.ModularDiffusers',
      action: 'EncodePrompt',
      params: {
        text_encoders: connect('owner', 'text_encoders'),
        prompt: literal(prompt),
        negative_prompt: literal(''),
      },
    },
    [ids.denoise]: {
      module: 'modules.ModularDiffusers',
      action: 'Denoise',
      params: {
        unet: connect('owner', 'unet_out'),
        scheduler: connect('owner', 'scheduler'),
        embeddings: connect('encode', 'embeddings'),
        width: literal(width),
        height: literal(1024),
        seed: literal(seed),
        num_inference_steps: literal(8),
        guidance_scale: literal(1),
        strength: literal(0.5),
      },
    },
    [ids.decode]: {
      module: 'modules.ModularDiffusers',
      action: 'DecodeLatents',
      params: { vae: connect('owner', 'vae_out'), latents: connect('denoise', 'latents') },
    },
    [ids.preview]: {
      module: 'modules.Image',
      action: 'Preview',
      params: { image: connect('decode', 'images'), device: literal('cuda:0') },
    },
  };
  const apiGraph = {
    sid: 'genuine-session',
    nodes,
    paths: [[ids.owner, ids.encode, ids.denoise, ids.decode, ids.preview]],
    runtimeHints: {
      resourceMode: 'auto',
      workflowTabId: 'workflow',
      clientRunId: 'client-run',
      runInputHash: 'run-input',
      workflowSnapshot: { nodes: [], edges: [], studioForm: form, activeTemplateId: 'example-template' },
    },
  };
  apiGraph.runtimeHints.workflowAutoPlan = { schemaVersion: 1, graphHash: graphHash(apiGraph) };
  const captured = (node, fields) => ({
    nodeId: node,
    module: nodes[node].module,
    action: nodes[node].action,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v, source: 'literal' }])),
  });
  const ownerTrace = { ...values, repo_id: values.repo_id.value, quant_config: null };
  delete ownerTrace.reviewed_variant;
  delete ownerTrace.workflow_id;
  delete ownerTrace.weight_format;
  delete ownerTrace.inpaint_compatibility;
  const denoiseTrace = Object.fromEntries(
    ['width', 'height', 'seed', 'num_inference_steps', 'guidance_scale', 'strength'].map((k) => [
      k,
      nodes[ids.denoise].params[k].value,
    ]),
  );
  const receipt = {
    source: 'backend-execution',
    taskId: 'task',
    attemptIndex: 0,
    nodeId: ids.preview,
    truncated: false,
    uncapturedNodeIds: [],
    graphTasks: [{ loaderId: ids.owner, pipelineClass: values.model_type, task: 'text_to_image' }],
    nodes: [
      captured(ids.owner, ownerTrace),
      captured(ids.encode, { prompt, negative_prompt: '' }),
      captured(ids.denoise, denoiseTrace),
      captured(ids.decode, {}),
      captured(ids.preview, { device: 'cuda:0' }),
    ],
  };
  const executionReceipt = {
    task_id: 'task',
    status: 'completed',
    attempt_index: 0,
    sid: apiGraph.sid,
    workflow_tab_id: 'workflow',
    client_run_id: 'client-run',
    run_input_hash: 'run-input',
    workflow_snapshot: apiGraph.runtimeHints.workflowSnapshot,
    resourceCandidateId: null,
    runtimeMeasurement: {
      elapsedSeconds: 54,
      peakMeasurementVersion: 2,
      peakAllocatedBytes: 24_000_000_000,
      backend: 'rocm',
      device: 'cuda:0',
    },
    runtimePreparation: {
      resourceMode: 'auto',
      workflowAuto: {
        strategy: 'dependency_order_retained_owners',
        schedule: null,
        cachePreparation: null,
        reusedOwnerIds: [],
        preparedDataNodes: [],
        appliedUpdates: [],
        releases: [],
        resolvedFields: {
          [ids.owner]: values,
          [ids.denoise]: Object.fromEntries(Object.entries(denoiseTrace).filter(([k]) => k !== 'seed')),
        },
      },
    },
  };
  const executedOutput = {
    taskId: 'task',
    attemptIndex: 0,
    sid: apiGraph.sid,
    workflowTabId: 'workflow',
    clientRunId: 'client-run',
    runInputHash: 'run-input',
    nodeId: ids.preview,
    apiGraphSnapshot: apiGraph,
    formSnapshot: form,
    resolvedExecutionInputs: receipt,
  };
  if (guider) {
    const id = prefix + 'guider';
    nodes[id] = { module: 'modules.ModularDiffusers', action: 'Guider', params: { guidance_scale: literal(1) } };
    apiGraph.paths[0].splice(1, 0, id);
    nodes[ids.denoise].params.guider = { sourceId: id, sourceKey: 'guider' };
    receipt.nodes.push(captured(id, { guidance_scale: 1 }));
    executionReceipt.runtimePreparation.workflowAuto.resolvedFields[id] = { guidance_scale: 1 };
    apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(apiGraph);
  }
  return { apiGraph, executionReceipt, executedOutput, ids };
}
const planFor = (w) => executionPlanIdentity(w.apiGraph, w).plan;

function nativeExpertWitness({ guider = false } = {}) {
  const w = witness({ guider }),
    form = w.executedOutput.formSnapshot;
  if (guider) w.apiGraph.nodes[w.ids.denoise].params.guider.sourceKey = 'guider_out';
  Object.assign(form, { resourceMode: 'expert', device: 'cuda:0', autoOffload: true, offloadMode: 'model_cpu' });
  delete w.apiGraph.runtimeHints.resourceMode;
  delete w.apiGraph.runtimeHints.workflowAutoPlan;
  w.executionReceipt.runtimePreparation = {
    resourceMode: 'expert',
    performed: false,
    residentRecipeReusable: false,
    cleanup: null,
  };
  w.modelIdentities = [
    {
      repoId: 'example/native-image',
      selectedRevision: 'a'.repeat(40),
      modelRevision: 'example/native-image@' + 'a'.repeat(40),
      fingerprint: 'sha256:example',
    },
  ];
  const parent = {
    pipelineClass: form.modelType,
    task: form.mode,
    executionProfileId: 'example:modular',
    authoringRecipeId: 'example-native:v1',
    baseSpecId: 'example:modular:spec',
    baseSpecContentHash: 'studio-spec-v1-12345678',
    authoringContentHash: 'studio-authoring-v1-12345678',
  };
  w.apiGraph.runtimeHints.workflowSnapshot.nodes = [
    {
      id: w.ids.encode,
      data: {
        module: 'modules.ModularDiffusers',
        action: 'EncodePrompt',
        operationAuthoring: {
          operation: { pipelineClass: form.modelType, task: form.mode },
          ancillaryParent: {
            schemaVersion: 1,
            parent,
            parentRoleNodes: {
              models: w.ids.owner,
              prompt: w.ids.encode,
              denoise: w.ids.denoise,
              decode: w.ids.decode,
            },
          },
        },
      },
    },
  ];
  const capture = w.executedOutput.resolvedExecutionInputs;
  capture.schemaVersion = 1;
  capture.appliedAdaptersStatus = { schemaVersion: 1, truncated: false };
  capture.nodes.find((row) => row.nodeId === w.ids.owner).appliedAdapters = {
    schemaVersion: 1,
    status: 'complete',
    source: 'backend-adapter-application',
    applicationId: '1'.repeat(32),
    observation: 'activated',
    adapters: [],
    stateSha256: 'sha256:applied-adapters-v1:' + canonicalJsonHash({ adapters: [] }),
  };
  return w;
}

test('native Expert identity requires a fresh completed owner capture and preserves absent form weight format', () => {
  for (const guider of [false, true]) {
    const w = nativeExpertWitness({ guider }),
      before = structuredClone(w),
      plan = planFor(w);
    assert.equal(plan.source, 'executed-expert-modular-graph-v1');
    assert.equal(plan.weightFormat, 'native');
    assert.equal(plan.resourceMode, 'expert');
    assert.equal(
      executionReceiptIdentity(w.executionReceipt, plan).resourceCandidateId,
      'manual-resource-v1:ExampleModularPipeline|bfloat16|model_cpu|none',
    );
    assert.deepEqual(w, before);
    assert.equal(Object.hasOwn(w.executedOutput.formSnapshot, 'weightFormat'), false);
    assert.equal(w.executionReceipt.resourceCandidateId, null);
    assert.equal(executionPlanIdentity(w.apiGraph).plan.source, undefined, 'An authored graph alone is insufficient.');
    const ordinary = structuredClone(w);
    ordinary.apiGraph.runtimeHints.workflowSnapshot.nodes = [];
    delete ordinary.apiGraph.nodes[ordinary.ids.owner].params.quant_config.value;
    assert.equal(
      planFor(ordinary).source,
      'executed-expert-modular-graph-v1',
      'Fresh native execution does not invent missing ancillary authoring metadata.',
    );
    for (const mutate of [
      (x) => {
        x.executionReceipt.status = 'cancelled';
      },
      (x) => {
        x.executionReceipt.attempt_index = 1;
      },
      (x) => {
        x.executedOutput.taskId = 'other';
      },
      (x) => {
        x.executionReceipt.runtimePreparation.residentRecipeReusable = true;
      },
      (x) => {
        x.executedOutput.resolvedExecutionInputs.truncated = true;
      },
      (x) => {
        x.modelIdentities = [];
      },
      (x) => {
        x.executedOutput.resolvedExecutionInputs.nodes.find(
          (row) => row.nodeId === x.ids.owner,
        ).fields.offload_mode.value = 'group_cpu';
      },
      (x) => {
        x.executedOutput.resolvedExecutionInputs.nodes.find(
          (row) => row.nodeId === x.ids.owner,
        ).appliedAdapters.observation = 'inherited';
      },
      (x) => {
        x.apiGraph.nodes[x.ids.denoise].params.scheduler.sourceId = x.ids.decode;
      },
    ]) {
      const changed = structuredClone(w);
      mutate(changed);
      assert.equal(executionReceiptIdentity(changed.executionReceipt, planFor(changed)).resourceCandidateId, null);
    }
  }
});

test('native Expert upscale identity binds both installed models and the selected output ancestry', () => {
  const w = nativeExpertWitness({ guider: true }),
    g = w.apiGraph,
    output = w.executedOutput;
  g.nodes['base-preview'] = structuredClone(g.nodes[w.ids.preview]);
  g.nodes.upscaler = {
    module: 'modules.Spandrel',
    action: 'Upscaler',
    params: {
      image: { sourceId: w.ids.decode, sourceKey: 'images' },
      model_id: literal({ source: 'hub', value: 'example/upscaler/weights.pth' }),
      device: literal('cuda:0'),
      downscale: literal(0.5),
      tile_size: literal(256),
      tile_overlap: literal(32),
    },
  };
  g.nodes[w.ids.preview].params.image = { sourceId: 'upscaler', sourceKey: 'output' };
  const common = g.paths[0].slice(0, -1);
  g.paths = [
    [...common, 'base-preview'],
    [...common, 'upscaler', w.ids.preview],
  ];
  output.resolvedExecutionInputs.nodes.push({
    nodeId: 'upscaler',
    module: 'modules.Spandrel',
    action: 'Upscaler',
    fields: {
      model_id: { source: 'literal', value: 'example/upscaler/weights.pth' },
      device: { source: 'literal', value: 'cuda:0' },
    },
  });
  w.modelIdentities.push({
    repoId: 'example/upscaler',
    selectedRevision: 'b'.repeat(40),
    modelRevision: 'example/upscaler@' + 'b'.repeat(40),
    fingerprint: 'sha256:auxiliary',
  });
  assert.equal(planFor(w).source, 'executed-expert-modular-graph-v1');
  for (const mutate of [
    (x) => {
      x.modelIdentities.pop();
    },
    (x) => {
      x.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === 'upscaler').fields.model_id.value =
        'other/model/weights.pth';
    },
    (x) => {
      x.apiGraph.nodes['base-preview'].params.image.sourceId = 'upscaler';
    },
    (x) => {
      x.executedOutput.resolvedExecutionInputs.nodes = x.executedOutput.resolvedExecutionInputs.nodes.filter(
        (r) => r.nodeId !== 'upscaler',
      );
    },
  ]) {
    const changed = structuredClone(w);
    mutate(changed);
    assert.equal(executionReceiptIdentity(changed.executionReceipt, planFor(changed)).resourceCandidateId, null);
  }
});

test('native text Auto preserves an unexposed empty negative prompt without fabricating a capture', () => {
  const w = witness();
  delete w.apiGraph.nodes[w.ids.encode].params.negative_prompt;
  const row = w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.encode);
  delete row.fields.negative_prompt;
  w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
  assert.equal(planFor(w).source, 'observed-workflow-auto-resource-v1');
  const nonempty = structuredClone(w);
  nonempty.executedOutput.formSnapshot.negativePrompt = 'different';
  assert.notEqual(planFor(nonempty).source, 'observed-workflow-auto-resource-v1');
  row.fields.negative_prompt = { source: 'literal', value: '' };
  assert.notEqual(planFor(w).source, 'observed-workflow-auto-resource-v1');
});

test('native text Auto retains a legacy form label only with matching durable owner authoring', () => {
  const w = witness(),
    form = w.executedOutput.formSnapshot;
  form.modelType = 'LegacyExamplePipeline';
  w.apiGraph.runtimeHints.workflowSnapshot.nodes = [
    {
      id: w.ids.owner,
      data: {
        module: 'modules.ModularDiffusers',
        action: 'ModelsLoader',
        params: structuredClone(w.apiGraph.nodes[w.ids.owner].params),
        operationAuthoring: {
          schemaVersion: 1,
          operation: {
            pipelineClass: 'ExampleModularPipeline',
            task: 'text_to_image',
            nodeKey: 'modules.ModularDiffusers.ModelsLoader',
            binding: { pipelineClass: 'ExampleModularPipeline', values: { model_type: 'ExampleModularPipeline' } },
          },
        },
      },
    },
  ];
  Object.assign(w.apiGraph.runtimeHints.workflowSnapshot.nodes[0].data.params.model_type, {
    label: 'Pipeline Type',
    options: { ExampleModularPipeline: { label: 'Example' } },
  });
  const before = structuredClone(w),
    plan = planFor(w);
  assert.equal(plan.source, 'observed-workflow-auto-resource-v1');
  assert.equal(plan.modelType, 'ExampleModularPipeline');
  assert.equal(plan.resourceObservation.formModelType, 'LegacyExamplePipeline');
  assert.deepEqual(w, before);
  for (const mutate of [
    (g) => {
      delete g.runtimeHints.workflowSnapshot.nodes[0].data.operationAuthoring;
    },
    (g) => {
      g.runtimeHints.workflowSnapshot.nodes[0].data.operationAuthoring.operation.binding.values.model_type =
        'OtherPipeline';
    },
    (g) => {
      g.runtimeHints.workflowSnapshot.nodes[0].id = 'foreign-owner';
    },
  ]) {
    const changed = structuredClone(w);
    mutate(changed.apiGraph);
    assert.notEqual(planFor(changed).source, 'observed-workflow-auto-resource-v1');
  }
});

function imageConditionedWitness(options = {}) {
  const w = witness(options);
  const { apiGraph: graph, executionReceipt: task, executedOutput: output, ids } = w;
  ids.images = (options.prefix ?? '') + 'images';
  ids.imageEncode = (options.prefix ?? '') + 'image-encode';
  const form = output.formSnapshot;
  form.mode = 'multi_image_reference_edit';
  form.modelType = 'LegacyExamplePipeline'; // Presentation label is not loader authority.
  Object.assign(form, { device: 'cuda:0', offloadMode: 'model_cpu', autoOffload: true, steps: 8, guidanceScale: 1 });
  graph.nodes[ids.owner].params.workflow_id = literal('image_conditioned');
  task.runtimePreparation.workflowAuto.resolvedFields[ids.owner].workflow_id = 'image_conditioned';
  graph.nodes[ids.images] = {
    module: 'modules.Image',
    action: 'Load',
    params: {
      file: literal(['@data/images/first.webp', '@data/images/second.webp']),
      alpha_channel: literal('ignore'),
    },
  };
  graph.nodes[ids.imageEncode] = {
    module: 'modules.ModularDiffusers',
    action: 'ImageEncode',
    params: {
      image: { sourceId: ids.images, sourceKey: 'image' },
      vae: { sourceId: ids.owner, sourceKey: 'vae_out' },
      seed: literal(form.seed),
      encode_summary: { display: 'ui_text', sourceKey: 'encode_summary_data' },
    },
  };
  graph.nodes[ids.denoise].params.image_latents = { sourceId: ids.imageEncode, sourceKey: 'image_latents' };
  delete graph.nodes[ids.denoise].params.strength;
  delete task.runtimePreparation.workflowAuto.resolvedFields[ids.denoise].strength;
  delete graph.nodes[ids.encode].params.negative_prompt;
  graph.paths[0].unshift(ids.images);
  graph.paths[0].splice(2, 0, ids.imageEncode);
  const receipt = output.resolvedExecutionInputs;
  receipt.schemaVersion = 1;
  receipt.appliedAdaptersStatus = { schemaVersion: 1, truncated: false };
  receipt.graphTasks[0].task = null; // Retain the historical capture's missing task classification.
  delete receipt.nodes.find((row) => row.nodeId === ids.encode).fields.negative_prompt;
  delete receipt.nodes.find((row) => row.nodeId === ids.denoise).fields.strength;
  const captured = (value) => ({ value, source: 'literal' });
  receipt.nodes.push({
    nodeId: ids.imageEncode,
    module: 'modules.ModularDiffusers',
    action: 'ImageEncode',
    fields: { seed: captured(form.seed) },
    omittedFields: {},
  });
  receipt.nodes.push({
    nodeId: ids.images,
    module: 'modules.Image',
    action: 'Load',
    fields: {
      alpha_channel: captured('ignore'),
      source_hashes: captured(['1'.repeat(64), '2'.repeat(64)]),
      source_widths: captured([1024, 1024]),
      source_heights: captured([1024, 1024]),
      source_modes: captured(['RGB', 'RGB']),
    },
    omittedFields: {},
  });
  receipt.nodes.find((row) => row.nodeId === ids.owner).appliedAdapters = {
    schemaVersion: 1,
    status: 'complete',
    source: 'backend-adapter-application',
    applicationId: '1'.repeat(32),
    observation: 'activated',
    adapters: [],
    stateSha256: 'sha256:applied-adapters-v1:' + canonicalJsonHash({ adapters: [] }),
  };
  graph.runtimeHints.workflowAutoPlan.graphHash = graphHash(graph);
  return w;
}

test('two-image Auto observation retains original null IDs and binds the consumed image-conditioned owner', () => {
  const w = imageConditionedWitness(),
    before = structuredClone(w),
    plan = planFor(w);
  assert.equal(plan.source, 'observed-workflow-auto-image-resource-v1');
  assert.equal(plan.modelType, 'ExampleModularPipeline');
  assert.equal(plan.task, 'multi_image_reference_edit');
  assert.equal(plan.resourceObservation.reportedGraphTask, null);
  assert.equal(plan.resourceObservation.references.length, 2);
  assert.match(
    executionReceiptIdentity(w.executionReceipt, plan).resourceCandidateId,
    /^observed-workflow-auto-image-resource-v1:[a-f0-9]{64}$/u,
  );
  assert.deepEqual(w, before);
  assert.equal(w.executionReceipt.resourceCandidateId, null);
  assert.equal(w.executedOutput.resolvedExecutionInputs.graphTasks[0].task, null);
});

test('two-image observed recipes retain ordered source hashes without manufacturing IDs from prompts or node labels', () => {
  const first = imageConditionedWitness(),
    renamed = imageConditionedWitness({ prefix: 'renamed-', prompt: 'Another material', seed: 15 });
  const id = (w) => executionReceiptIdentity(w.executionReceipt, planFor(w)).resourceCandidateId;
  assert.equal(id(first), id(renamed));
  const swapped = imageConditionedWitness();
  swapped.executedOutput.resolvedExecutionInputs.nodes
    .find((row) => row.nodeId === swapped.ids.images)
    .fields.source_hashes.value.reverse();
  assert.notEqual(id(first), id(swapped));
});

test('two-image observations reject incomplete, conflicting, borrowed or nonfresh evidence', () => {
  const mutations = {
    candidateClaim: (w) => {
      w.executionReceipt.resourceCandidateId = 'claimed-primary';
    },
    missingCandidate: (w) => {
      delete w.executionReceipt.resourceCandidateId;
    },
    missingTaskClass: (w) => {
      delete w.executedOutput.resolvedExecutionInputs.graphTasks[0].task;
    },
    wrongTaskClass: (w) => {
      w.executedOutput.resolvedExecutionInputs.graphTasks[0].task = 'text_to_image';
    },
    wrongWorkflow: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.workflow_id.value = 'text2image';
    },
    wrongOwner: (w) => {
      w.executedOutput.resolvedExecutionInputs.graphTasks[0].loaderId = w.ids.imageEncode;
    },
    wrongAttempt: (w) => {
      w.executionReceipt.attempt_index = 1;
    },
    wrongSession: (w) => {
      w.executionReceipt.sid = 'other';
    },
    wrongOutput: (w) => {
      w.executedOutput.taskId = 'other';
    },
    truncated: (w) => {
      w.executedOutput.resolvedExecutionInputs.truncated = true;
    },
    missingInputCapture: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes = w.executedOutput.resolvedExecutionInputs.nodes.filter(
        (r) => r.nodeId !== w.ids.images,
      );
    },
    omittedHashes: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find(
        (r) => r.nodeId === w.ids.images,
      ).omittedFields.source_hashes = 'unavailable';
    },
    badHash: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find(
        (r) => r.nodeId === w.ids.images,
      ).fields.source_hashes.value[0] = 'unknown';
    },
    duplicateImage: (w) => {
      const f = w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.images).fields;
      f.source_hashes.value[1] = f.source_hashes.value[0];
    },
    missingImage: (w) => {
      w.apiGraph.nodes[w.ids.images].params.file.value.pop();
    },
    extraImage: (w) => {
      w.apiGraph.nodes[w.ids.images].params.file.value.push('@data/images/third.webp');
    },
    missingGeometry: (w) => {
      delete w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.images).fields.source_widths;
    },
    invalidGeometry: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find(
        (r) => r.nodeId === w.ids.images,
      ).fields.source_heights.value[0] = 0;
    },
    wrongMode: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find(
        (r) => r.nodeId === w.ids.images,
      ).fields.source_modes.value[0] = 'RGBA';
    },
    wrongImageSeed: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.imageEncode).fields.seed.value++;
    },
    borrowedVae: (w) => {
      w.apiGraph.nodes[w.ids.imageEncode].params.vae.sourceId = w.ids.decode;
    },
    bypassImageEncode: (w) => {
      w.apiGraph.nodes[w.ids.denoise].params.image_latents.sourceId = w.ids.images;
    },
    extraWire: (w) => {
      w.apiGraph.nodes[w.ids.encode].params.prompt_input = { sourceId: w.ids.images, sourceKey: 'image' };
    },
    unknownControl: (w) => {
      w.apiGraph.nodes[w.ids.imageEncode].params.unreviewed = literal(true);
    },
    negativePrompt: (w) => {
      w.executedOutput.formSnapshot.negativePrompt = 'unsupported';
    },
    changedForm: (w) => {
      w.executedOutput.formSnapshot.steps = 7;
    },
    ambiguous: (w) => {
      w.executedOutput.resolvedExecutionInputs.ambiguousFields = ['width'];
    },
    conflictingSummary: (w) => {
      w.executedOutput.resolvedExecutionInputs.summary = { imageSourceHashes: [] };
    },
    staleApplication: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.owner).appliedAdapters.observation =
        'reused';
    },
    badApplicationHash: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.owner).appliedAdapters.stateSha256 =
        'sha256:applied-adapters-v1:' + '0'.repeat(64);
    },
    reusedOwner: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.reusedOwnerIds = [w.ids.owner];
    },
    deferred: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.preparedDataNodes = [w.ids.images];
    },
    patched: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.appliedUpdates = [{}];
    },
    connectedIdentity: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.repo_id.sourceId = w.ids.images;
    },
    quantized: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.quant_config = literal({ backend: 'bnb_4bit' });
    },
    remoteCode: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.trust_remote_code.value = true;
    },
    mutableRevision: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.revision.value = 'main';
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const w = imageConditionedWitness();
    mutate(w);
    w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
    assert.notEqual(planFor(w).source, 'observed-workflow-auto-image-resource-v1', name);
  }
});

function imageProof(w) {
  const plan = planFor(w),
    canonicalGraph = canonicalizeApiGraph(w.apiGraph);
  const applied = createAppliedAdapterProof({
    apiGraph: w.apiGraph,
    canonicalGraph,
    executedOutput: w.executedOutput,
    executionReceipt: w.executionReceipt,
    taskId: 'task',
  });
  return {
    schemaVersion: 2,
    taskId: 'task',
    graph: { canonicalGraph, executionPlan: plan },
    execution: executionReceiptIdentity(w.executionReceipt, plan),
    models: {
      items: [
        {
          repoId: 'example/native-image',
          selectedRevision: 'a'.repeat(40),
          modelRevision: 'example/native-image@' + 'a'.repeat(40),
        },
      ],
    },
    template: { lockedSettings: structuredClone(w.executedOutput.formSnapshot) },
    inputs: {
      items: [0, 1].map((index) => ({
        role: `referenceImages[${index}]`,
        path: w.apiGraph.nodes[w.ids.images].params.file.value[index],
        contentHash: 'sha256:bytes:' + String(index + 1).repeat(64),
        byteSize: 1000 + index,
      })),
    },
    output: { items: [{ width: 1024, height: 1024 }] },
    adapterApplications: applied.proof,
    adapterApplicationsHash: applied.hash,
  };
}

function singleReferenceWitness({ requestedOffloadMode = 'model_cpu' } = {}) {
  const w = imageConditionedWitness();
  w.executedOutput.formSnapshot.mode = 'edit_image';
  w.executedOutput.formSnapshot.offloadMode = requestedOffloadMode;
  w.apiGraph.nodes[w.ids.images].params.file.value.pop();
  const fields = w.executedOutput.resolvedExecutionInputs.nodes.find((row) => row.nodeId === w.ids.images).fields;
  for (const key of ['source_hashes', 'source_widths', 'source_heights', 'source_modes']) fields[key].value.pop();
  w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
  return w;
}

function routedSingleReferenceWitness() {
  const w = singleReferenceWitness(),
    g = w.apiGraph,
    receipt = w.executedOutput.resolvedExecutionInputs;
  const id = 'routed-guider';
  w.ids.guider = id;
  const fields = {
    model_type: 'ExampleModularPipeline',
    guider: 'ClassifierFreeGuidance',
    guidance_scale: 1,
    guidance_rescale: 0,
    use_original_formulation: false,
    enabled: true,
    start: 0,
    stop: 1,
  };
  g.nodes[id] = {
    module: 'modules.ModularDiffusers',
    action: 'Guider',
    params: {
      ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, literal(v)])),
      layers_config: literal(null),
    },
  };
  receipt.nodes.push({
    nodeId: id,
    module: 'modules.ModularDiffusers',
    action: 'Guider',
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { source: 'literal', value: v }])),
  });
  Object.assign(g.nodes[w.ids.encode].params, {
    guider: { sourceId: id, sourceKey: 'guider_out' },
    image: { sourceId: w.ids.images, sourceKey: 'image' },
    negative_prompt: literal('avoid identity drift'),
  });
  w.executedOutput.formSnapshot.negativePrompt = 'avoid identity drift';
  receipt.nodes.find((r) => r.nodeId === w.ids.encode).fields.negative_prompt = {
    source: 'literal',
    value: 'avoid identity drift',
  };
  Object.assign(g.nodes[w.ids.imageEncode].params, {
    mask_image: literal(null),
    padding_mask_crop: literal(null),
    inpaint_compatibility: literal('native'),
  });
  Object.assign(g.nodes[w.ids.denoise].params, {
    guider: { sourceId: id, sourceKey: 'guider_out' },
    route_state_in: { sourceId: w.ids.imageEncode, sourceKey: 'route_state_out' },
    strength: literal(0.5),
  });
  g.nodes[w.ids.decode].params.route_state_in = { sourceId: w.ids.denoise, sourceKey: 'route_state_out' };
  receipt.nodes.find((r) => r.nodeId === w.ids.denoise).fields.strength = { source: 'literal', value: 0.5 };
  w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[id] = { guidance_scale: 1 };
  w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.denoise].strength = 0.5;
  g.paths[0].splice(2, 0, id);
  receipt.graphTasks[0].task = 'edit_image';
  g.runtimeHints.workflowAutoPlan.graphHash = graphHash(g);
  return w;
}

test('single-reference native route retains its actual task, Guider, route state and negative prompt', () => {
  const w = routedSingleReferenceWitness(),
    before = structuredClone(w),
    plan = planFor(w);
  assert.equal(plan.source, 'observed-workflow-auto-image-resource-v1');
  assert.equal(plan.resourceObservation.reportedGraphTask, 'edit_image');
  assert.equal(plan.resourceObservation.imageRoute, 'native_state');
  assert.equal(
    plan.resourceObservation.controls.find((c) => c.scope === 'modules.ModularDiffusers.Guider').fields.guidance_scale,
    1,
  );
  assert.deepEqual(w, before);
  const emptyLayerSlot = structuredClone(w);
  delete emptyLayerSlot.apiGraph.nodes[emptyLayerSlot.ids.guider].params.layers_config.value;
  emptyLayerSlot.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(emptyLayerSlot.apiGraph);
  assert.equal(planFor(emptyLayerSlot).source, 'observed-workflow-auto-image-resource-v1');
  const proof = imageProof(w);
  proof.inputs.items = proof.inputs.items.slice(0, 1);
  assert(observedWorkflowAutoImageProofMatches(plan, proof));
  proof.graph.canonicalGraph.nodes.find((n) => n.action === 'Guider').params.enabled.value = false;
  assert.equal(observedWorkflowAutoImageProofMatches(plan, proof), false);
});

test('single-reference native route rejects missing state, hidden masks and conflicting native controls', () => {
  for (const mutate of [
    (w) => {
      w.apiGraph.nodes[w.ids.denoise].params.route_state_in.sourceId = w.ids.owner;
    },
    (w) => {
      delete w.apiGraph.nodes[w.ids.decode].params.route_state_in;
    },
    (w) => {
      w.apiGraph.nodes[w.ids.imageEncode].params.mask_image = { sourceId: w.ids.images, sourceKey: 'image' };
    },
    (w) => {
      w.executedOutput.resolvedExecutionInputs.graphTasks[0].task = null;
    },
    (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find(
        (r) => r.nodeId === w.ids.guider,
      ).fields.guidance_scale.value = 2;
    },
    (w) => {
      delete w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.guider).fields.enabled;
    },
    (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find(
        (r) => r.nodeId === w.ids.encode,
      ).fields.negative_prompt.value = 'different';
    },
  ]) {
    const w = routedSingleReferenceWitness();
    mutate(w);
    w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
    assert.notEqual(planFor(w).source, 'observed-workflow-auto-image-resource-v1');
  }
});

test('single-reference Auto edit binds the consumed owner and preserves an explicit requested loading policy', () => {
  for (const requestedOffloadMode of ['model_cpu', 'group_cpu']) {
    const w = singleReferenceWitness({ requestedOffloadMode }),
      before = structuredClone(w),
      plan = planFor(w);
    assert.equal(plan.source, 'observed-workflow-auto-image-resource-v1');
    assert.equal(plan.task, 'edit_image');
    assert.equal(plan.offloadMode, 'model_cpu');
    assert.equal(plan.resourceObservation.requestedOffloadMode, requestedOffloadMode);
    assert.equal(plan.resourceObservation.references.length, 1);
    assert.equal(w.executionReceipt.resourceCandidateId, null);
    assert.deepEqual(w, before);
    const proof = imageProof(w);
    proof.inputs.items = proof.inputs.items.slice(0, 1);
    assert(observedWorkflowAutoImageProofMatches(plan, proof));
    proof.template.lockedSettings.offloadMode = 'group_disk';
    assert.equal(observedWorkflowAutoImageProofMatches(plan, proof), false);
  }
});

test('single-reference Auto edit rejects incomplete, unjoined, borrowed and altered source evidence', () => {
  const mutations = [
    (w) => {
      w.executionReceipt.attempt_index = 1;
    },
    (w) => {
      w.executedOutput.taskId = 'another-task';
    },
    (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.reusedOwnerIds = [w.ids.owner];
    },
    (w) => {
      w.apiGraph.nodes[w.ids.imageEncode].params.vae.sourceId = w.ids.decode;
    },
    (w) => {
      w.apiGraph.nodes[w.ids.images].params.file.value.push('@data/images/extra.webp');
    },
    (w) => {
      delete w.executedOutput.resolvedExecutionInputs.nodes.find((row) => row.nodeId === w.ids.images).fields
        .source_hashes;
    },
    (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find(
        (row) => row.nodeId === w.ids.images,
      ).fields.source_modes.value = ['L'];
    },
  ];
  for (const mutate of mutations) {
    const w = singleReferenceWitness();
    mutate(w);
    w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
    assert.notEqual(planFor(w).source, 'observed-workflow-auto-image-resource-v1');
  }
  const w = singleReferenceWitness(),
    proof = imageProof(w);
  proof.inputs.items = proof.inputs.items.slice(0, 1);
  proof.inputs.items[0].contentHash = 'sha256:bytes:' + 'f'.repeat(64);
  assert.equal(observedWorkflowAutoImageProofMatches(planFor(w), proof), false);
});

test('rehashed two-image observations stay bound to original canonical model, controls, ordered inputs and output', () => {
  const proof = imageProof(imageConditionedWitness()),
    plan = proof.graph.executionPlan;
  delete proof.template.lockedSettings.device;
  delete proof.template.lockedSettings.trustRemoteCode;
  assert(observedWorkflowAutoImageProofMatches(plan, proof));
  const message = 'execution image resource observation does not match the original graph/model/input/output proof.';
  assert(!validateRunProvenance(proof).includes(message));
  const mutations = {
    reorderedInputs: (p) => {
      p.inputs.items.reverse();
    },
    changedSource: (p) => {
      p.inputs.items[0].contentHash = 'sha256:bytes:' + 'f'.repeat(64);
    },
    swappedFiles: (p) => {
      p.graph.canonicalGraph.nodes.find((n) => n.action === 'Load').params.file.value.reverse();
    },
    inventedReportedTask: (p) => {
      p.graph.executionPlan.resourceObservation.reportedGraphTask = 'multi_image_reference_edit';
    },
    differentModel: (p) => {
      p.models.items[0].repoId = 'example/other';
    },
    forgedPrecision: (p) => {
      const plan = p.graph.executionPlan;
      plan.dtype = plan.resourceObservation.dtype = 'float32';
    },
    wrongOutput: (p) => {
      p.output.items[0].width = 512;
    },
    missingInputs: (p) => {
      p.inputs.items.pop();
    },
    missingApplication: (p) => {
      p.adapterApplications = null;
    },
    staleForm: (p) => {
      p.template.lockedSettings.modelType = 'different-label';
    },
    unsafeOwner: (p) => {
      p.graph.canonicalGraph.nodes.find((node) => node.action === 'ModelsLoader').params.trust_remote_code.value = true;
    },
    wrongLockedDtype: (p) => {
      p.template.lockedSettings.dtype = 'float32';
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const p = structuredClone(proof);
    mutate(p);
    const plan = p.graph.executionPlan;
    plan.observedResourceCandidateId = plan.source + ':' + canonicalJsonHash(plan.resourceObservation);
    p.execution.resourceCandidateId = plan.observedResourceCandidateId;
    assert.equal(observedWorkflowAutoImageProofMatches(plan, p), false, name);
    assert(validateRunProvenance(p).includes(message), name);
  }
});

function loraWitness(options = {}) {
  const w = witness({ ...options, guider: options.guider ?? true });
  const id = (options.prefix ?? '') + 'lora';
  w.ids.lora = id;
  const artifact = {
    source: 'hub',
    repository: 'example/style-adapter',
    revision: 'b'.repeat(40),
    weightName: 'style.safetensors',
    sha256: 'c'.repeat(64),
  };
  const adapter = { adapterName: 'style', scale: 0.65, descriptorSha256: 'd'.repeat(64), artifact, scheduler: null };
  w.modelIdentities = [
    {
      repoId: 'example/native-image',
      selectedRevision: 'a'.repeat(40),
      modelRevision: 'example/native-image@' + 'a'.repeat(40),
    },
    {
      repoId: artifact.repository,
      selectedRevision: artifact.revision,
      modelRevision: artifact.repository + '@' + artifact.revision,
    },
  ];
  w.apiGraph.nodes[id] = {
    module: 'modules.ModularDiffusers',
    action: 'Lora',
    params: {
      model: literal({ source: 'hub', value: artifact.repository }),
      revision: literal(artifact.revision),
      weight_name: literal(artifact.weightName),
      expected_sha256: literal(artifact.sha256),
      scale: literal(adapter.scale),
      adapter_name: literal(adapter.adapterName),
      previous_loras: {},
      scheduler_class: literal(''),
      scheduler_config: literal('{}'),
    },
  };
  w.apiGraph.paths[0].unshift(id);
  w.apiGraph.nodes[w.ids.owner].params.lora_list = { sourceId: id, sourceKey: 'lora' };
  const receipt = w.executedOutput.resolvedExecutionInputs;
  receipt.schemaVersion = 1;
  receipt.appliedAdaptersStatus = { schemaVersion: 1, truncated: false };
  receipt.nodes.push({
    nodeId: id,
    module: 'modules.ModularDiffusers',
    action: 'Lora',
    fields: { revision: { value: artifact.revision, source: 'literal' } },
    omittedFields: {},
  });
  receipt.nodes.find((row) => row.nodeId === w.ids.owner).appliedAdapters = {
    schemaVersion: 1,
    status: 'complete',
    source: 'backend-adapter-application',
    applicationId: '1'.repeat(32),
    observation: 'activated',
    adapters: [adapter],
    stateSha256: 'sha256:applied-adapters-v1:' + canonicalJsonHash({ adapters: [adapter] }),
  };
  w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
  return w;
}

test('a fresh pinned single-LoRA Auto observation retains its separate resource identity without raw rewrites', () => {
  const w = loraWitness(),
    before = structuredClone(w),
    plan = planFor(w);
  assert.equal(plan.source, 'observed-workflow-auto-lora-resource-v1');
  assert.equal(plan.resourceObservation.adapters[0].artifact.revision, 'b'.repeat(40));
  const execution = executionReceiptIdentity(w.executionReceipt, plan);
  assert.match(execution.resourceCandidateId, /^observed-workflow-auto-lora-resource-v1:[0-9a-f]{64}$/u);
  assert.equal(w.executionReceipt.resourceCandidateId, null);
  assert.deepEqual(w, before);
  const withoutGuider = loraWitness({ guider: false });
  assert.equal(planFor(withoutGuider).source, plan.source);
  assert.notEqual(
    executionReceiptIdentity(withoutGuider.executionReceipt, planFor(withoutGuider)).resourceCandidateId,
    execution.resourceCandidateId,
    'optional guidance remains part of the observed resource controls',
  );
  const renamed = loraWitness({ prefix: 'other-', prompt: 'Another photograph', seed: 9 });
  assert.equal(
    executionReceiptIdentity(renamed.executionReceipt, planFor(renamed)).resourceCandidateId,
    execution.resourceCandidateId,
  );
  const anotherApplication = loraWitness();
  anotherApplication.executedOutput.resolvedExecutionInputs.nodes.find(
    (r) => r.nodeId === anotherApplication.ids.owner,
  ).appliedAdapters.applicationId = '2'.repeat(32);
  assert.equal(
    executionReceiptIdentity(anotherApplication.executionReceipt, planFor(anotherApplication)).resourceCandidateId,
    execution.resourceCandidateId,
  );
});

test('the single-LoRA observation rejects missing native state, mismatched artifacts and unsupported descriptor authority', () => {
  const application = (w) =>
    w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.owner).appliedAdapters;
  const mutations = {
    absent: (w) => {
      delete w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.owner).appliedAdapters;
    },
    reused: (w) => {
      application(w).observation = 'reused';
    },
    truncated: (w) => {
      w.executedOutput.resolvedExecutionInputs.appliedAdaptersStatus.truncated = true;
    },
    wrongPin: (w) => {
      application(w).adapters[0].artifact.revision = 'e'.repeat(40);
    },
    wrongScale: (w) => {
      application(w).adapters[0].scale = 0.8;
    },
    wrongName: (w) => {
      application(w).adapters[0].adapterName = 'other';
    },
    wrongSha: (w) => {
      application(w).adapters[0].artifact.sha256 = 'f'.repeat(64);
    },
    wrongPort: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.lora_list.sourceKey = 'other';
    },
    ambiguousList: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.lora_list.value = [];
    },
    unconnected: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.lora_list = literal(null);
    },
    opaquePredecessor: (w) => {
      w.apiGraph.nodes[w.ids.lora].params.previous_loras = literal([]);
    },
    scheduler: (w) => {
      w.apiGraph.nodes[w.ids.lora].params.scheduler_class.value = 'OtherScheduler';
    },
    schedulerConfig: (w) => {
      w.apiGraph.nodes[w.ids.lora].params.scheduler_config.value = '{"shift":2}';
    },
    custom: (w) => {
      w.apiGraph.nodes[w.ids.lora].module = 'custom.ModularDiffusers';
    },
    connectedControl: (w) => {
      w.apiGraph.nodes[w.ids.lora].params.revision.sourceId = w.ids.encode;
    },
    omittedPin: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.lora).omittedFields.revision =
        'unsupported-value';
    },
    unknownControl: (w) => {
      w.apiGraph.nodes[w.ids.lora].params.unknown = literal(true);
    },
    missingBaseObservation: (w) => {
      w.modelIdentities = w.modelIdentities.slice(1);
    },
    missingAdapterObservation: (w) => {
      w.modelIdentities = w.modelIdentities.slice(0, 1);
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const w = loraWitness();
    mutate(w);
    const app = application(w);
    if (app) app.stateSha256 = 'sha256:applied-adapters-v1:' + canonicalJsonHash({ adapters: app.adapters });
    w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
    assert.notEqual(planFor(w).source, 'observed-workflow-auto-lora-resource-v1', name);
  }
});

test('LoRA resource projections bind to the existing strict proof even after a self-hashed forgery', () => {
  const w = loraWitness(),
    plan = planFor(w);
  const canonicalGraph = canonicalizeApiGraph(w.apiGraph);
  const applied = createAppliedAdapterProof({
    apiGraph: w.apiGraph,
    canonicalGraph,
    executedOutput: w.executedOutput,
    executionReceipt: w.executionReceipt,
    taskId: 'task',
  });
  const provenance = {
    schemaVersion: 2,
    taskId: 'task',
    models: { items: w.modelIdentities },
    graph: { canonicalGraph, executionPlan: plan },
    adapterApplications: applied.proof,
    adapterApplicationsHash: applied.hash,
    execution: executionReceiptIdentity(w.executionReceipt, plan),
  };
  assert(observedWorkflowAutoLoraProofMatches(plan, provenance));
  const blockers = validateRunProvenance(provenance);
  assert(!blockers.includes('execution LoRA resource observation does not match the original applied adapter proof.'));
  const missingBase = structuredClone(provenance);
  missingBase.models.items = missingBase.models.items.slice(1);
  assert.equal(observedWorkflowAutoLoraProofMatches(plan, missingBase), false);
  const forgedBase = structuredClone(provenance);
  forgedBase.graph.executionPlan.modelRepo = 'example/forged-base';
  forgedBase.graph.executionPlan.resourceObservation.repo = 'example/forged-base';
  forgedBase.graph.executionPlan.resourceObservation.controls.find(
    (control) => control.scope === 'modules.ModularDiffusers.ModelsLoader',
  ).fields.repo_id.value = 'example/forged-base';
  forgedBase.models.items[0] = {
    ...forgedBase.models.items[0],
    repoId: 'example/forged-base',
    modelRevision: 'example/forged-base@' + 'a'.repeat(40),
  };
  assert.equal(observedWorkflowAutoLoraProofMatches(forgedBase.graph.executionPlan, forgedBase), false);
  const forgedPrecision = structuredClone(plan);
  forgedPrecision.dtype = forgedPrecision.resourceObservation.dtype = 'float32';
  forgedPrecision.observedResourceCandidateId =
    forgedPrecision.source + ':' + canonicalJsonHash(forgedPrecision.resourceObservation);
  assert.equal(executionReceiptIdentity(w.executionReceipt, forgedPrecision).resourceCandidateId, null);
  forgedPrecision.resourceObservation.controls.find(
    (control) => control.scope === 'modules.ModularDiffusers.ModelsLoader',
  ).fields.dtype = 'float32';
  assert.equal(observedWorkflowAutoLoraProofMatches(forgedPrecision, provenance), false);
  plan.resourceObservation.adapters[0].artifact.revision = 'f'.repeat(40);
  plan.observedResourceCandidateId = plan.source + ':' + canonicalJsonHash(plan.resourceObservation);
  provenance.execution.resourceCandidateId = plan.observedResourceCandidateId;
  assert.equal(observedWorkflowAutoLoraProofMatches(plan, provenance), false);
  assert(
    validateRunProvenance(provenance).includes(
      'execution LoRA resource observation does not match the original applied adapter proof.',
    ),
  );
});

test('LoRA resource identity uses native numeric scale, preserves decimal source text and rejects a corrupt projection', () => {
  const first = loraWitness(),
    changed = loraWitness();
  const id = (w) => executionReceiptIdentity(w.executionReceipt, planFor(w)).resourceCandidateId;
  const before = id(first);
  first.apiGraph.nodes[first.ids.lora].params.scale.value = '6.5e-1';
  first.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(first.apiGraph);
  assert.equal(id(first), before);
  const application = changed.executedOutput.resolvedExecutionInputs.nodes.find(
    (r) => r.nodeId === changed.ids.owner,
  ).appliedAdapters;
  changed.apiGraph.nodes[changed.ids.lora].params.scale.value = application.adapters[0].scale = 0.8;
  application.stateSha256 = 'sha256:applied-adapters-v1:' + canonicalJsonHash({ adapters: application.adapters });
  changed.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(changed.apiGraph);
  assert.notEqual(id(changed), before);
  const plan = planFor(changed);
  plan.resourceObservation.adapters[0].scale = '0.8';
  plan.observedResourceCandidateId = plan.source + ':' + canonicalJsonHash(plan.resourceObservation);
  assert.equal(
    executionReceiptIdentity(changed.executionReceipt, plan).resourceCandidateId,
    null,
    'no manual fallback for a corrupt observed plan',
  );
});

test('a completed whole-workflow Auto trace retains its actual resource identity without rewriting the raw candidate', () => {
  const w = witness(),
    before = structuredClone(w),
    plan = planFor(w);
  assert.equal(plan.modelType, 'ExampleModularPipeline');
  assert.equal(plan.modelRepo, 'example/native-image');
  assert.equal(plan.modelRevision, 'a'.repeat(40));
  assert.equal(plan.offloadMode, 'model_cpu');
  assert.equal(plan.weightLoadingMode, 'cpu');
  assert.equal(plan.resourceMode, 'auto');
  assert.equal(plan.source, 'observed-workflow-auto-resource-v1');
  assert.equal(plan.autoResourceCandidateId, undefined, 'An observed recipe is not a primary catalog Auto candidate.');
  const execution = executionReceiptIdentity(w.executionReceipt, plan);
  assert.match(execution.resourceCandidateId, /^observed-workflow-auto-resource-v1:[0-9a-f]{64}$/u);
  assert.deepEqual(w, before);
  assert.equal(w.executionReceipt.resourceCandidateId, null);
});

test('resource observation ignores node IDs, prompt and seed, while retaining geometry', () => {
  const first = witness(),
    second = witness({ prefix: 'other-', prompt: 'A different photograph', seed: 1234 });
  const id = (w) => executionReceiptIdentity(w.executionReceipt, planFor(w)).resourceCandidateId;
  assert.ok(id(first));
  assert.equal(id(first), id(second));
  assert.notEqual(id(first), id(witness({ width: 1536 })));
});

test('client Auto hints alone cannot manufacture the backend execution observation', () => {
  const w = witness();
  assert.equal(executionPlanIdentity(w.apiGraph).plan.source, undefined);
  assert.equal(executionReceiptIdentity({}, executionPlanIdentity(w.apiGraph).plan).resourceCandidateId, null);
});

test('incomplete, conflicting, connected or reused execution evidence remains held', () => {
  const mutations = {
    missingTask: (w) => {
      delete w.executionReceipt;
    },
    wrongFactoryTask: (w) => {
      w.taskId = 'other';
    },
    missingResolvedDtype: (w) => {
      delete w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.owner].dtype;
    },
    unfinished: (w) => {
      w.executionReceipt.status = 'running';
    },
    wrongOutputTask: (w) => {
      w.executedOutput.taskId = 'other';
    },
    wrongOutputAttempt: (w) => {
      w.executedOutput.attemptIndex = 1;
    },
    wrongSession: (w) => {
      w.executionReceipt.sid = 'other';
    },
    wrongWorkflow: (w) => {
      w.executedOutput.workflowTabId = 'other';
    },
    wrongClientRun: (w) => {
      w.executionReceipt.client_run_id = 'other';
    },
    wrongInputHash: (w) => {
      w.executionReceipt.run_input_hash = 'other';
    },
    truncated: (w) => {
      w.executedOutput.resolvedExecutionInputs.truncated = true;
    },
    missingNode: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.pop();
    },
    uncaptured: (w) => {
      w.executedOutput.resolvedExecutionInputs.uncapturedNodeIds = [w.ids.owner];
    },
    wrongTaskMode: (w) => {
      w.executedOutput.resolvedExecutionInputs.graphTasks[0].task = 'edit_image';
    },
    wrongPipeline: (w) => {
      w.executedOutput.resolvedExecutionInputs.graphTasks[0].pipelineClass = 'OtherPipeline';
    },
    wrongOwner: (w) => {
      w.executedOutput.resolvedExecutionInputs.graphTasks[0].loaderId = w.ids.encode;
    },
    noBackendPlan: (w) => {
      delete w.executionReceipt.runtimePreparation.workflowAuto;
    },
    changedStrategy: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.strategy = 'unknown';
    },
    ownerReuse: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.reusedOwnerIds = [w.ids.owner];
    },
    deferredData: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.preparedDataNodes = [w.ids.encode];
    },
    runtimePatches: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.appliedUpdates = [{}];
    },
    changedTrace: (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes[0].fields.dtype.value = 'float32';
    },
    changedResolved: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.owner].offload_mode = 'none';
    },
    mutableRevision: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.revision.value = 'main';
    },
    connectedIdentity: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.repo_id.sourceId = w.ids.encode;
    },
    unsafeCode: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.trust_remote_code.value = true;
    },
    borrowedComponent: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.vae.sourceId = w.ids.decode;
    },
    quantized: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.quant_config.value = { backend: 'other' };
    },
    forgedHash: (w) => {
      w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = 'sha256:workflow-auto-v1:' + '0'.repeat(64);
    },
    nonfinite: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.extra = { value: NaN };
      w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
    },
    unknownResolvedField: (w) => {
      w.apiGraph.nodes[w.ids.owner].params.unknown = { value: true };
      w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.owner].unknown = true;
      w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
    },
    clientCustomMode: (w) => {
      w.apiGraph.runtimeHints.resourceMode = 'expert';
    },
    backendCustomMode: (w) => {
      w.executionReceipt.runtimePreparation.resourceMode = 'expert';
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const w = witness();
    mutate(w);
    assert.notEqual(planFor(w).source, 'observed-workflow-auto-resource-v1', name);
  }
});

test('a changed observed recipe cannot fall back to a manual candidate', () => {
  const w = witness(),
    plan = planFor(w);
  assert.equal(plan.source, 'observed-workflow-auto-resource-v1');
  plan.offloadMode = 'none';
  assert.equal(executionReceiptIdentity(w.executionReceipt, plan).resourceCandidateId, null);
});

test('a self-hashed incomplete observation cannot manufacture an executed resource identity', () => {
  for (const change of [
    (p) => {
      delete p.resourceObservation.geometry;
    },
    (p) => {
      p.resourceObservation.revision = p.modelRevision = 'main';
    },
    (p) => {
      p.pipelineClass = 'OtherPipeline';
    },
    (p) => {
      p.quantizedComponents = ['transformer'];
    },
    (p) => {
      p.resourceObservation.controls = [];
    },
  ]) {
    const w = witness(),
      plan = planFor(w);
    change(plan);
    plan.observedResourceCandidateId =
      'observed-workflow-auto-resource-v1:' + canonicalJsonHash(plan.resourceObservation);
    assert.equal(executionReceiptIdentity(w.executionReceipt, plan).resourceCandidateId, null);
  }
});

test('optional guidance remains part of the exact backend resource observation', () => {
  const w = witness({ guider: true });
  const plan = planFor(w);
  assert.equal(plan.source, 'observed-workflow-auto-resource-v1');
  assert.equal(plan.resourceObservation.controls.length, 3);
});

function withPromptLength(w, length = 512) {
  w.apiGraph.nodes[w.ids.encode].params.max_sequence_length = literal(length);
  w.executedOutput.formSnapshot.maxSequenceLength = length;
  w.executedOutput.resolvedExecutionInputs.nodes.find((row) => row.nodeId === w.ids.encode).fields.max_sequence_length =
    {
      value: length,
      source: 'literal',
    };
  w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.encode] = { max_sequence_length: length };
  w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
  return w;
}

test('native prompt length remains part of the observed text-to-image recipe with optional guidance', () => {
  for (const guider of [false, true]) {
    const w = withPromptLength(witness({ guider })),
      before = structuredClone(w),
      plan = planFor(w);
    assert.equal(plan.source, 'observed-workflow-auto-resource-v1');
    assert.equal(plan.resourceObservation.controls.length, guider ? 4 : 3);
    assert.deepEqual(
      plan.resourceObservation.controls.find((c) => c.scope === 'modules.ModularDiffusers.EncodePrompt'),
      {
        scope: 'modules.ModularDiffusers.EncodePrompt',
        fields: { max_sequence_length: 512 },
      },
    );
    const id = executionReceiptIdentity(w.executionReceipt, plan).resourceCandidateId;
    assert(id);
    assert.notEqual(id, executionReceiptIdentity(w.executionReceipt, planFor(witness({ guider }))).resourceCandidateId);
    const longer = withPromptLength(witness({ guider }), 1024);
    assert.notEqual(id, executionReceiptIdentity(longer.executionReceipt, planFor(longer)).resourceCandidateId);
    assert.deepEqual(w, before, 'original native task and graph remain unchanged');
  }
});

test('prompt-length observations require exact literal graph, native capture and requested-form agreement', () => {
  const mutations = {
    missingCapture: (w, row) => {
      delete row.fields.max_sequence_length;
    },
    omittedCapture: (w, row) => {
      row.omittedFields = { max_sequence_length: 'uncaptured' };
    },
    connectedCapture: (w, row) => {
      row.fields.max_sequence_length.source = 'connection';
    },
    changedCapture: (w, row) => {
      row.fields.max_sequence_length.value = 256;
    },
    changedForm: (w) => {
      w.executedOutput.formSnapshot.maxSequenceLength = 256;
    },
    missingForm: (w) => {
      delete w.executedOutput.formSnapshot.maxSequenceLength;
    },
    changedGraph: (w) => {
      w.apiGraph.nodes[w.ids.encode].params.max_sequence_length.value = 256;
    },
    connectedGraph: (w) => {
      w.apiGraph.nodes[w.ids.encode].params.max_sequence_length.sourceId = w.ids.owner;
    },
    unknownField: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.encode].unknown = true;
    },
    emptyFields: (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.encode] = {};
    },
    wrongScope: (w) => {
      const fields = w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields;
      fields[w.ids.denoise].max_sequence_length = fields[w.ids.encode].max_sequence_length;
      delete fields[w.ids.encode];
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const w = withPromptLength(witness({ guider: true }));
    const row = w.executedOutput.resolvedExecutionInputs.nodes.find((r) => r.nodeId === w.ids.encode);
    mutate(w, row);
    w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
    assert.notEqual(planFor(w).source, 'observed-workflow-auto-resource-v1', name);
  }
  for (const length of [0, -1, 1.5, '512', true, null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.notEqual(
      planFor(withPromptLength(witness(), length)).source,
      'observed-workflow-auto-resource-v1',
      String(length),
    );
  }
  assert.notEqual(
    planFor(withPromptLength(imageConditionedWitness())).source,
    'observed-workflow-auto-image-resource-v1',
  );
});

test('a pinned single-adapter text recipe retains the same strict prompt-length capture', () => {
  const w = withPromptLength(loraWitness()),
    before = structuredClone(w),
    plan = planFor(w);
  assert.equal(plan.source, 'observed-workflow-auto-lora-resource-v1');
  assert.equal(plan.maxSequenceLength, 512);
  assert(executionReceiptIdentity(w.executionReceipt, plan).resourceCandidateId);
  assert.equal(plan.resourceObservation.adapters[0].artifact.revision, 'b'.repeat(40));
  assert.deepEqual(w, before);
});

test('self-hashed prompt-length projections reject unsupported scope, fields and values', () => {
  for (const change of [
    (c) => {
      c.scope = 'modules.ModularDiffusers.DecodeLatents';
    },
    (c) => {
      c.fields.prompt = 'unrelated';
    },
    (c) => {
      c.fields = {};
    },
    (c) => {
      c.fields.max_sequence_length = 1024;
    },
    ...[0, -1, 1.5, '512', true, null, Number.MAX_SAFE_INTEGER + 1].map((v) => (c) => {
      c.fields.max_sequence_length = v;
    }),
  ]) {
    const w = withPromptLength(witness({ guider: true })),
      plan = planFor(w);
    assert.equal(plan.source, 'observed-workflow-auto-resource-v1');
    change(plan.resourceObservation.controls.find((c) => c.scope === 'modules.ModularDiffusers.EncodePrompt'));
    plan.observedResourceCandidateId = plan.source + ':' + canonicalJsonHash(plan.resourceObservation);
    assert.equal(executionReceiptIdentity(w.executionReceipt, plan).resourceCandidateId, null);
  }
});

test('ordinary and Unicode requests use the actual worker hash protocol', () => {
  const python = process.env.MODIFF_BACKEND_PYTHON;
  assert(python, 'Set the declared ordinary CPU MODIFF_BACKEND_PYTHON for backend protocol checks.');
  const backend = resolve(
    process.env.MODIFF_BACKEND_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../../MoDiff'),
  );
  const witnesses = [witness(), witness({ prompt: 'Café 🌅 — tabletop photograph' }), witness({ guider: true })];
  const code = `import ast,hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); parsed=ast.parse(p.read_text(encoding='utf8'))
functions=[n for n in parsed.body if isinstance(n,ast.FunctionDef) and n.name in {'graph_material','workflow_graph_hash'}]
assert len(functions)==2
namespace={'hashlib':hashlib,'json':json}
exec(compile(ast.Module(body=functions,type_ignores=[]),str(p),'exec'),namespace)
print(json.dumps([namespace['workflow_graph_hash'](g) for g in json.load(sys.stdin)]))`;
  const result = spawnSync(
    python,
    ['-X', 'utf8', '-B', '-c', code, resolve(backend, 'modiff/workflow_auto_resource.py')],
    { encoding: 'utf8', input: JSON.stringify(witnesses.map((w) => w.apiGraph)), timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const hashes = JSON.parse(result.stdout);
  for (const [i, w] of witnesses.entries()) {
    w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = hashes[i];
    assert.equal(planFor(w).source, 'observed-workflow-auto-resource-v1');
  }
});

function legacyTextWitness() {
  const w = witness();
  for (const field of ['reviewed_variant', 'workflow_id', 'inpaint_compatibility']) {
    delete w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.owner][field];
  }
  for (const field of ['weight_format', 'weight_loading_mode']) {
    delete w.apiGraph.nodes[w.ids.owner].params[field];
    delete w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.owner][field];
    delete w.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === w.ids.owner).fields[field];
  }
  Object.assign(w.executedOutput.formSnapshot, { steps: 8, guidanceScale: 1 });
  Object.assign(w.executionReceipt.runtimePreparation, { performed: false, residentRecipeReusable: false });
  w.backendSource = {
    fingerprint: 'sha256:backend-source-v1:' + 'b'.repeat(64),
    gitCommit: null,
    files: [{ path: 'main.py', sha256: 'c'.repeat(64) }],
  };
  w.executionReceipt.runtimeFingerprint = {
    backendSource: { fingerprint: w.backendSource.fingerprint, gitCommit: null, fileCount: 1 },
  };
  w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
  const payload = Object.fromEntries(Object.values(w.apiGraph.nodes).map((n) => [n.module + '.' + n.action, n]));
  w.backendContract = backendContractIdentity(payload, canonicalizeApiGraph(w.apiGraph));
  return w;
}
function legacyTextProof(w, plan) {
  return {
    runtime: { backendSource: w.backendSource, backendContract: w.backendContract },
    graph: { canonicalGraph: canonicalizeApiGraph(w.apiGraph) },
    models: { items: [{ repoId: plan.modelRepo, selectedRevision: plan.modelRevision }] },
    template: { lockedSettings: w.executedOutput.formSnapshot },
    inputs: { items: [] },
    output: { items: [{ mediaType: 'image', width: 1024, height: 1024 }] },
  };
}
test('historical text observations preserve absent loader controls and bind the recovered source contract', () => {
  const w = legacyTextWitness(),
    plan = planFor(w);
  assert.equal(plan.source, 'observed-workflow-auto-legacy-resource-v1');
  assert(!Object.hasOwn(plan, 'weightLoadingMode'));
  assert(!Object.hasOwn(plan.resourceObservation, 'weightLoadingMode'));
  assert.deepEqual(plan.resourceObservation.absentLoaderControls, ['weight_format', 'weight_loading_mode']);
  assert(observedWorkflowAutoResourceId(plan));
  assert(observedWorkflowAutoLegacyProofMatches(plan, legacyTextProof(w, plan)));
});
test('historical text observations reject missing authority, partial controls, reuse and contradictory captures', () => {
  for (const mutate of [
    (w) => {
      delete w.backendSource;
    },
    (w) => {
      delete w.backendContract;
    },
    (w) => {
      w.backendSource.fingerprint = 'sha256:backend-source-v1:' + 'd'.repeat(64);
    },
    (w) => {
      w.backendSource.gitCommit = 'a'.repeat(40);
    },
    (w) => {
      w.executionReceipt.runtimeFingerprint.backendSource.fileCount = 2;
    },
    (w) => {
      w.backendContract.contracts.find((n) => n.key.endsWith('.ModelsLoader')).params.weight_format = {};
    },
    (w) => {
      w.apiGraph.nodes[w.ids.owner].params.weight_format = literal('native');
    },
    (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.owner].weight_loading_mode = 'cpu';
    },
    (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === w.ids.owner).fields.weight_loading_mode =
        { source: 'literal', value: 'cpu' };
    },
    (w) => {
      w.executedOutput.formSnapshot.weightFormat = 'native';
    },
    (w) => {
      w.executionReceipt.runtimePreparation.residentRecipeReusable = true;
    },
    (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.reusedOwnerIds = [w.ids.owner];
    },
    (w) => {
      w.executionReceipt.runtimePreparation.performed = true;
    },
    (w) => {
      w.executionReceipt.resourceCandidateId = 'invented';
    },
  ]) {
    const w = legacyTextWitness();
    mutate(w);
    assert.notEqual(planFor(w).source, 'observed-workflow-auto-legacy-resource-v1');
  }
});
test('rehashing a historical observation cannot replace its graph, source, contract, model or output', () => {
  const w = legacyTextWitness(),
    plan = planFor(w),
    proof = legacyTextProof(w, plan);
  for (const mutate of [
    (p) => {
      p.runtime.backendSource.fingerprint = 'sha256:backend-source-v1:' + 'd'.repeat(64);
    },
    (p) => {
      p.runtime.backendContract.fingerprint = 'sha256:backend-contract-v1:' + 'd'.repeat(64);
    },
    (p) => {
      p.runtime.backendContract.contracts.find((n) => n.key.endsWith('.ModelsLoader')).params.weight_loading_mode = {};
    },
    (p) => {
      p.models.items[0].selectedRevision = 'd'.repeat(40);
    },
    (p) => {
      p.output.items[0].width = 512;
    },
    (p) => {
      p.template.lockedSettings.steps = 4;
    },
    (p) => {
      p.graph.canonicalGraph.nodes.find((n) => n.action === 'Denoise').params.embeddings.sourceKey = 'wrong';
    },
    (p) => {
      p.inputs.items.push({ role: 'referenceImages[0]' });
    },
  ]) {
    const altered = structuredClone(proof);
    mutate(altered);
    assert.equal(observedWorkflowAutoLegacyProofMatches(plan, altered), false);
  }
  const altered = structuredClone(plan);
  altered.device = altered.resourceObservation.device = 'cpu';
  altered.observedResourceCandidateId = altered.source + ':' + canonicalJsonHash(altered.resourceObservation);
  assert.equal(observedWorkflowAutoResourceId(altered), null);
});

function legacyDecoderWitness() {
  const w = legacyTextWitness();
  const decode = w.apiGraph.nodes[w.ids.decode];
  const fields = {};
  for (const field of ['width', 'height']) {
    decode.params[field] = { value: 1024, display: 'input', sourceId: w.ids.denoise, sourceKey: 'out_' + field };
    fields[field] = { value: 1024, source: 'connected', sourceNodeId: w.ids.denoise, sourcePortId: 'out_' + field };
  }
  w.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === w.ids.decode).fields = fields;
  w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.decode] = { width: 1024, height: 1024 };
  w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
  return w;
}

function nativeDecoderWitness(w = witness()) {
  const decode = w.apiGraph.nodes[w.ids.decode];
  const fields = {};
  for (const field of ['width', 'height']) {
    const actual = w.apiGraph.nodes[w.ids.denoise].params[field].value;
    decode.params[field] = { value: actual, display: 'input', sourceId: w.ids.denoise, sourceKey: 'out_' + field };
    fields[field] = { value: actual, source: 'connected', sourceNodeId: w.ids.denoise, sourcePortId: 'out_' + field };
  }
  w.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === w.ids.decode).fields = fields;
  w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.decode] = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, field.value]),
  );
  w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
  return w;
}

test('fresh native Auto decoder retains connected geometry for plain and single-adapter text graphs', () => {
  for (const w of [nativeDecoderWitness(), nativeDecoderWitness(loraWitness())]) {
    const before = structuredClone(w);
    const plan = planFor(w);
    assert.equal(
      plan.source,
      w.ids.lora ? 'observed-workflow-auto-lora-resource-v1' : 'observed-workflow-auto-resource-v1',
    );
    assert.equal(plan.resourceObservation.decoderGeometryRoute, 'denoiser_dimensions');
    assert(observedWorkflowAutoResourceId(plan));
    assert(observedWorkflowAutoTextGeometryProofMatches(plan, legacyTextProof(w, plan)));
    assert.deepEqual(w, before);
  }
});

test('fresh connected decoder geometry rejects missing, stale and substituted native values', () => {
  for (const make of [() => nativeDecoderWitness(), () => nativeDecoderWitness(loraWitness())])
    for (const mutate of [
      (w) => {
        w.apiGraph.nodes[w.ids.decode].params.width.sourceKey = 'latents';
      },
      (w) => {
        w.apiGraph.nodes[w.ids.decode].params.width.value = 512;
      },
      (w) => {
        delete w.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === w.ids.decode).fields.width;
      },
      (w) => {
        w.executedOutput.resolvedExecutionInputs.nodes.find(
          (n) => n.nodeId === w.ids.decode,
        ).fields.width.sourcePortId = 'width';
      },
      (w) => {
        w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.decode].height = 512;
      },
    ]) {
      const w = make();
      mutate(w);
      w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
      assert(
        !['observed-workflow-auto-resource-v1', 'observed-workflow-auto-lora-resource-v1'].includes(planFor(w).source),
      );
    }
});

test('rehashed text decoder observations remain bound to canonical geometry and cannot hide their route', () => {
  const w = nativeDecoderWitness(),
    plan = planFor(w),
    proof = legacyTextProof(w, plan);
  for (const mutate of [
    (p) => {
      p.graph.canonicalGraph.nodes.find((n) => n.action === 'DecodeLatents').params.width.sourceKey = 'latents';
    },
    (p) => {
      p.output.items[0].width = 512;
    },
    (p) => {
      p.template.lockedSettings.height = 512;
    },
    (p) => {
      p.inputs.items.push({ role: 'referenceImages[0]' });
    },
  ]) {
    const changed = structuredClone(proof);
    mutate(changed);
    assert.equal(observedWorkflowAutoTextGeometryProofMatches(plan, changed), false);
  }
  const hidden = structuredClone(proof);
  hidden.schemaVersion = 2;
  hidden.graph.executionPlan = structuredClone(plan);
  delete hidden.graph.executionPlan.resourceObservation.decoderGeometryRoute;
  hidden.graph.executionPlan.observedResourceCandidateId =
    plan.source + ':' + canonicalJsonHash(hidden.graph.executionPlan.resourceObservation);
  hidden.execution = { resourceCandidateId: observedWorkflowAutoResourceId(hidden.graph.executionPlan) };
  assert(hidden.execution.resourceCandidateId);
  assert(
    validateRunProvenance(hidden).includes(
      'execution text decoder geometry observation does not match the original connected graph/output proof.',
    ),
  );
});
test('historical decoder geometry requires the exact connected denoiser output and native values', () => {
  const w = legacyDecoderWitness(),
    plan = planFor(w),
    proof = legacyTextProof(w, plan);
  assert.equal(plan.resourceObservation.decoderGeometryRoute, 'denoiser_dimensions');
  assert(observedWorkflowAutoLegacyProofMatches(plan, proof));
  delete proof.template.lockedSettings.trustRemoteCode;
  assert(observedWorkflowAutoLegacyProofMatches(plan, proof));
  for (const mutate of [
    (w) => {
      w.apiGraph.nodes[w.ids.decode].params.width.sourceKey = 'latents';
    },
    (w) => {
      w.apiGraph.nodes[w.ids.decode].params.width.value = 512;
    },
    (w) => {
      w.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === w.ids.decode).fields.width.sourcePortId =
        'width';
    },
    (w) => {
      delete w.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === w.ids.decode).fields.width;
    },
    (w) => {
      w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[w.ids.decode].width = 512;
    },
  ]) {
    const altered = legacyDecoderWitness();
    mutate(altered);
    altered.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(altered.apiGraph);
    assert.notEqual(planFor(altered).source, 'observed-workflow-auto-legacy-resource-v1');
  }
  proof.graph.canonicalGraph.nodes.find((n) => n.action === 'Denoise').params.hidden_route = {
    sourceId: proof.graph.canonicalGraph.nodes.find((n) => n.action === 'EncodePrompt').key,
    sourceKey: 'embeddings',
  };
  assert.equal(observedWorkflowAutoLegacyProofMatches(plan, proof), false);
});
function legacyGuiderWitness() {
  const w = legacyTextWitness(),
    id = 'guider';
  const values = {
    model_type: 'ExampleModularPipeline',
    guider: 'ClassifierFreeGuidance',
    guidance_scale: 1,
    guidance_rescale: 0,
    use_original_formulation: false,
    enabled: true,
    start: 0,
    stop: 1,
  };
  w.apiGraph.nodes[id] = {
    module: 'modules.ModularDiffusers',
    action: 'Guider',
    params: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, literal(v)])),
  };
  for (const role of ['encode', 'denoise'])
    w.apiGraph.nodes[w.ids[role]].params.guider = { sourceId: id, sourceKey: 'guider_out' };
  w.apiGraph.paths[0].splice(1, 0, id);
  w.executedOutput.resolvedExecutionInputs.nodes.push({
    nodeId: id,
    module: 'modules.ModularDiffusers',
    action: 'Guider',
    fields: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { source: 'literal', value: v }])),
  });
  w.executionReceipt.runtimePreparation.workflowAuto.resolvedFields[id] = { guidance_scale: 1 };
  w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = graphHash(w.apiGraph);
  return w;
}
test('historical Guider configurations require all native controls and both consuming paths', () => {
  const w = legacyGuiderWitness(),
    plan = planFor(w),
    proof = legacyTextProof(w, plan);
  assert.equal(plan.source, 'observed-workflow-auto-legacy-resource-v1');
  assert(observedWorkflowAutoLegacyProofMatches(plan, proof));
  const bad = legacyGuiderWitness();
  delete bad.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'guider').fields.enabled;
  assert.notEqual(planFor(bad).source, 'observed-workflow-auto-legacy-resource-v1');
  const changed = structuredClone(proof);
  changed.graph.canonicalGraph.nodes.find((n) => n.action === 'Guider').params.enabled.value = false;
  assert.equal(observedWorkflowAutoLegacyProofMatches(plan, changed), false);
  delete proof.graph.canonicalGraph.nodes.find((n) => n.action === 'EncodePrompt').params.guider;
  assert.equal(observedWorkflowAutoLegacyProofMatches(plan, proof), false);
});
