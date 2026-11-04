import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executionPlanIdentity, executionReceiptIdentity } from './live-proof-provenance.mjs';
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
