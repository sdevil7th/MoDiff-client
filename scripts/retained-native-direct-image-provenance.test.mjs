import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { canonicalJsonHash } from './canonical-json.mjs';
import {
  backendContractIdentity,
  canonicalizeApiGraph,
  executionPlanIdentity,
  executionReceiptIdentity,
} from './live-proof-provenance.mjs';
import {
  observedRetainedDirectImagePlan,
  observedRetainedDirectImageProofMatches,
  observedRetainedDirectImageResourceId,
} from './retained-native-direct-image-resource.mjs';
import { redactPublicProvenance } from './template-gallery-harness.mjs';

const SOURCE = 'observed-retained-direct-image-resource-v1';
const sha = (text) => createHash('sha256').update(text).digest('hex');

// Fictional records only. No private media, local runtime, model load or fit.
function witness({ control = false, canvas = false, embeddedGuidance = false, expert = false } = {}) {
  const lit = (value) => ({ value }),
    wire = (sourceId, sourceKey) => ({ sourceId, sourceKey });
  const form = {
    mode: control ? 'control_image' : canvas ? 'outpaint' : 'inpaint',
    modelType: 'LegacyExamplePipeline',
    resourceMode: expert ? 'expert' : 'auto',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    trustRemoteCode: false,
    randomSeed: false,
    width: 64,
    height: 64,
    steps: 2,
    maxSequenceLength: 512,
    seed: 12,
    guidanceScale: 4,
    prompt: 'A fictional ceramic workshop.',
    negativePrompt: 'Duplicate objects.',
    strength: 1,
    offloadMode: expert ? 'group_cpu' : 'model_cpu',
    autoOffload: true,
    referenceImages: ['/tmp/modiff-example/source.webp'],
    maskImage: '/tmp/modiff-example/mask.png',
    controlImage: '/tmp/modiff-example/control.png',
    outpaintLeft: 8,
    outpaintRight: 8,
    outpaintTop: 0,
    outpaintBottom: 0,
    outpaintOverlap: 2,
    outpaintFeather: 1,
    outpaintFillColor: 'black',
  };
  const n = (module, action, values) => ({
    module,
    action,
    params: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, lit(v)])),
  });
  const nodes = {
    quant: n('modules.DiffusersRuntime', 'PipelineQuantizationConfigV2', {
      backend: 'none',
      dtype: 'bfloat16',
      component_overrides: '{}',
    }),
    recipe: n('modules.DiffusersRuntime', 'DiffusersExecutionRecipe', {
      device_map: 'none',
      max_memory: '{}',
      device_map_overrides: '{}',
      device: 'cuda:0',
      attention_backend: 'auto',
      attention_components: '',
      vae_slicing: true,
      vae_tiling: true,
      offload_mode: form.offloadMode,
      layerwise_casting: false,
      channels_last: false,
      regional_compile: false,
      denoiser_cache: 'none',
    }),
    owner: n('modules.DiffusersImage', 'LoadPipeline', {
      model_id: { source: 'hub', value: 'example/model' },
      revision: 'a'.repeat(40),
      pipeline_class: 'ExamplePipeline',
      dtype: 'bfloat16',
      device: 'cuda:0',
      quantization_mode: 'none',
      quantized_components: [],
      conditioning_kind: 'none',
      conditioning_model_id: '',
      conditioning_revision: '',
      device_map: 'none',
      auto_offload: true,
      offload_mode: form.offloadMode,
      enable_vae_slicing: true,
      enable_vae_tiling: true,
      low_cpu_mem_usage: true,
      mode: form.mode,
    }),
    generate: n('modules.DiffusersImage', control ? 'ControlGenerate' : 'Inpaint', {
      prompt: form.prompt,
      negative_prompt: form.negativePrompt,
      width: 64,
      height: 64,
      num_inference_steps: 2,
      max_sequence_length: 512,
      seed: 12,
      guidance_scale: 4,
      output_type: 'pil',
      ...(control ? {} : { strength: 1 }),
    }),
    preview: n('modules.Image', 'Preview', { device: 'cpu:0' }),
    source: n('modules.Image', 'Load', {
      file: [control ? form.controlImage : form.referenceImages[0]],
      alpha_channel: 'ignore',
    }),
  };
  nodes.owner.params.execution_recipe = wire('recipe', 'execution_recipe');
  nodes.recipe.params.quantization_config = wire('quant', 'quantization_config');
  nodes.generate.params.pipeline = wire('owner', 'pipeline');
  nodes.preview.params.image = wire('generate', 'images');
  const sourceRole = control ? 'controlImage' : 'referenceImages[0]';
  const artifacts = [
    {
      role: sourceRole,
      path: control ? form.controlImage : form.referenceImages[0],
      contentHash: 'sha256:bytes:' + 'd'.repeat(64),
      byteSize: 100,
    },
  ];
  const sourcePixel = { mode: 'RGB', size: [64, 64], sha256: '1'.repeat(64), decodedRgbaSha256: '2'.repeat(64) };
  const maskPixel = { mode: 'L', size: [64, 64], sha256: '3'.repeat(64), decodedRgbaSha256: '4'.repeat(64) };
  const preparedPixel = { ...sourcePixel, sha256: '5'.repeat(64), decodedRgbaSha256: '6'.repeat(64) };
  const sources = [
    {
      role: sourceRole,
      contentHash: artifacts[0].contentHash,
      byteSize: 100,
      originalContractRole: 'referenceImage1',
      decodedRgbaSha256: sourcePixel.decodedRgbaSha256,
      size: [64, 64],
    },
  ];
  const policies = [{ role: 'referenceImage1', alphaChannel: 'ignore' }];
  let order = ['source', 'quant', 'recipe', 'owner', 'generate', 'preview'];
  if (canvas) {
    nodes.canvas = n('modules.DiffusersImage', 'OutpaintCanvas', {
      width: 64,
      height: 64,
      left: 8,
      right: 8,
      top: 0,
      bottom: 0,
      overlap: 2,
      feather: 1,
      fill_color: 'black',
    });
    nodes.canvas.params.image = wire('source', 'image');
    nodes.generate.params.image = wire('canvas', 'canvas');
    nodes.generate.params.mask_image = wire('canvas', 'mask_image');
    order = ['source', 'canvas', 'quant', 'recipe', 'owner', 'generate', 'preview'];
  } else if (!control) {
    // Scalar and one-item-array file values are distinct preserved legacy shapes.
    nodes.mask = n('modules.Image', 'Load', { file: form.maskImage, alpha_channel: 'remove alpha' });
    nodes.generate.params.image = wire('source', 'image');
    nodes.generate.params.mask_image = wire('mask', 'image');
    artifacts.push({
      role: 'maskImage',
      path: form.maskImage,
      contentHash: 'sha256:bytes:' + 'e'.repeat(64),
      byteSize: 80,
    });
    sources.push({
      role: 'maskImage',
      contentHash: artifacts[1].contentHash,
      byteSize: 80,
      originalContractRole: 'referenceImage2',
      decodedRgbaSha256: maskPixel.decodedRgbaSha256,
      size: [64, 64],
    });
    policies.push({ role: 'referenceImage2', alphaChannel: 'remove alpha' });
    order = ['source', 'mask', 'quant', 'recipe', 'owner', 'generate', 'preview'];
  } else nodes.generate.params.control_image = wire('source', 'image');
  const snapshot = {
    studioForm: form,
    nodes: Object.entries(nodes).map(([id, data]) => ({ id, data: structuredClone(data) })),
    edges: [],
  };
  const graph = {
    sid: 'example-session',
    nodes,
    paths: [order],
    runtimeHints: {
      clientRunId: 'example-run',
      workflowTabId: 'example-workflow',
      runInputHash: 'example-input',
      workflowSnapshot: snapshot,
    },
  };
  if (!expert) Object.assign(graph.runtimeHints, { resourceMode: 'auto', workflowAutoPlan: {} });
  const files = [
    { path: 'main.py', sha256: '7'.repeat(64) },
    { path: 'modules/DiffusersImage/main.py', sha256: '8'.repeat(64) },
  ];
  const source = {
    gitCommit: null,
    files,
    fingerprint: 'sha256:backend-source-v1:' + canonicalJsonHash({ gitCommit: null, files }),
  };
  const task = {
    task_id: 'example-task',
    status: 'completed',
    attempt_index: 0,
    sid: graph.sid,
    started_at: 1_000_000_000,
    completed_at: 1_000_000_020,
    client_run_id: 'example-run',
    workflow_tab_id: 'example-workflow',
    run_input_hash: 'example-input',
    resourceCandidateId: null,
    workflow_snapshot: snapshot,
    runtimeFingerprint: { backendSource: { fingerprint: source.fingerprint, fileCount: 2, gitCommit: null } },
    runtimePreparation: {
      resourceMode: form.resourceMode,
      performed: false,
      residentRecipeReusable: false,
      cleanup: null,
    },
  };
  if (!expert)
    task.runtimePreparation.workflowAuto = {
      strategy: 'dependency_order_retained_owners',
      reusedOwnerIds: [],
      releases: [],
      resolvedFields: {
        owner: {
          model_id: { source: 'hub', value: 'example/model' },
          pipeline_class: 'ExamplePipeline',
          revision: 'a'.repeat(40),
          dtype: 'bfloat16',
          device: 'cuda:0',
          offload_mode: form.offloadMode,
          auto_offload: true,
          quantization_mode: 'none',
          mode: form.mode,
        },
      },
    };
  const output = {
    taskId: task.task_id,
    sid: task.sid,
    workflowTabId: task.workflow_tab_id,
    clientRunId: task.client_run_id,
    runInputHash: task.run_input_hash,
    attemptIndex: 0,
    nodeId: 'preview',
    formSnapshot: form,
    apiGraphSnapshot: graph,
    mediaItems: [{ width: 64, height: 64 }],
  };
  const capture = (id, fields) => ({
    nodeId: id,
    module: nodes[id].module,
    action: nodes[id].action,
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { source: 'literal', value: v }])),
    omittedFields: {},
  });
  const ownFields = {
    model_id: 'example/model',
    pipeline_class: 'ExamplePipeline',
    revision: 'a'.repeat(40),
    dtype: 'bfloat16',
    device: 'cuda:0',
    auto_offload: true,
    offload_mode: form.offloadMode,
    enable_vae_slicing: true,
    enable_vae_tiling: true,
  };
  const recipeFields = {
    offload_mode: form.offloadMode,
    device: 'cuda:0',
    attention_backend: 'auto',
    vae_slicing: true,
    vae_tiling: true,
  };
  const genFields = {
    prompt: form.prompt,
    negative_prompt: embeddedGuidance ? null : form.negativePrompt,
    width: 64,
    height: 64,
    seed: 12,
    num_inference_steps: 2,
    max_sequence_length: 512,
    output_type: 'pil',
    guidance_scale: embeddedGuidance ? 4 : null,
    ...(embeddedGuidance ? {} : { true_cfg_scale: 4 }),
    ...(control ? {} : { strength: 1 }),
  };
  output.resolvedExecutionInputs = {
    schemaVersion: 1,
    source: 'backend-execution',
    taskId: task.task_id,
    attemptIndex: 0,
    nodeId: 'preview',
    truncated: false,
    uncapturedNodeIds: [],
    nodes: order.map((id) =>
      capture(
        id,
        id === 'owner'
          ? ownFields
          : id === 'recipe'
            ? recipeFields
            : id === 'quant'
              ? { dtype: 'bfloat16' }
              : id === 'generate'
                ? genFields
                : id === 'preview'
                  ? { device: 'cpu:0' }
                  : {},
      ),
    ),
  };
  const at = (s) => new Date((task.started_at + s) * 1000).toISOString();
  const callTask = {
    task_id: task.task_id,
    attempt_index: 0,
    current_node: 'generate',
    current_node_name: 'modules.DiffusersImage.' + nodes.generate.action,
  };
  const policy = { requested: null, applied: null, offloadMode: null, executionDevice: null };
  const call = {
    event: 'officialCallStarted',
    at: at(3),
    callId: '9'.repeat(32),
    task: callTask,
    actualPipelineClass: 'diffusers.pipelines.example.ExamplePipeline',
    pipelineClass: 'diffusers.pipelines.example.ExamplePipeline',
    generator: { device: 'cuda:0', initialSeed: 12, type: 'Generator' },
    peftComponentAdapterNames: {},
    peftComponentBindings: {},
    peftLayerScaleHistograms: {},
    wholePipelineAdapterScales: null,
    modiffLoraIdentities: null,
    controlnetComponent: null,
    callInputs: {
      prompt: form.prompt,
      width: 64,
      height: 64,
      num_inference_steps: 2,
      max_sequence_length: 512,
      output_type: 'pil',
      return_dict: true,
      callback_on_step_end_tensor_inputs: [],
      ...(embeddedGuidance ? { guidance_scale: 4 } : { true_cfg_scale: 4, negative_prompt: form.negativePrompt }),
      ...(control
        ? { control_image: sourcePixel }
        : { image: canvas ? preparedPixel : sourcePixel, mask_image: maskPixel, strength: 1 }),
    },
    declaredSignatureDefaults: embeddedGuidance ? { guidance_scale: 4 } : { true_cfg_scale: 4, negative_prompt: null },
    appliedRuntimeConfig: {
      attention: {
        applied: [],
        default_selection: true,
        registry_default: 'native',
        requested: 'auto',
        reset: ['transformer'],
        unsupported: [],
      },
      cache: { applied: [], disabled: [], requested: 'none' },
      channelsLast: { applied: [], requested: false },
      compile: { applied: [], requested: false },
      layerwiseCasting: { applied: [], requested: false },
      vae: {
        applied: [
          { enabled: true, feature: 'slicing' },
          { enabled: true, feature: 'tiling' },
        ],
        unsupported: [],
      },
    },
    componentRuntimePolicies: { transformer: { ...policy }, vae: { ...policy } },
    vaeMemoryFlags: { use_slicing: true, use_tiling: true },
    scheduler: {
      class: 'diffusers.schedulers.scheduling_flow_match_euler_discrete.FlowMatchEulerDiscreteScheduler',
      config: { shift: 1 },
    },
  };
  const journal = [call];
  for (let i = 0; i < 2; i++)
    journal.push(
      { event: 'schedulerStepStarted', at: at(4 + i), task: callTask, stepIndex: i === 0 ? null : i },
      { event: 'schedulerStepReturned', at: at(4.5 + i), task: callTask, stepIndex: i + 1 },
    );
  journal.push({
    event: 'officialCallReturned',
    at: at(7),
    task: callTask,
    callId: call.callId,
    images: [{ mode: 'RGB', size: [64, 64] }],
  });
  const observer = {
    installedAt: at(-1),
    observerSha256: 'b'.repeat(64),
    wrappedCalls: [{ kind: 'officialPipelineCall', class: call.pipelineClass, sourceSha256: 'c'.repeat(64) }],
  };
  const derived = {
    taskId: task.task_id,
    evidenceHashes: {},
    actualOfficialCalls: [call],
    actualDiffusersDirectUrl: {
      value: { url: 'https://github.com/huggingface/diffusers.git', vcs_info: { commit_id: 'f'.repeat(40) } },
    },
    specializedWholePipelineAuthority: {
      pipelineClass: call.pipelineClass,
      diffusersCommit: 'f'.repeat(40),
      sourceSha256: 'a'.repeat(64),
    },
  };
  if (canvas) {
    const t = { ...callTask, current_node: 'canvas', current_node_name: 'modules.DiffusersImage.OutpaintCanvas' };
    const start = {
      event: 'outpaintCanvasStarted',
      at: at(1),
      callId: 'd'.repeat(32),
      task: t,
      nodeObjectId: 100,
      actualInputs: {
        kwargs: {
          image: sourcePixel,
          ...Object.fromEntries(
            Object.entries(nodes.canvas.params)
              .filter(([k]) => k !== 'image')
              .map(([k, v]) => [k, v.value]),
          ),
        },
      },
    };
    const end = {
      event: 'outpaintCanvasReturned',
      at: at(2),
      callId: start.callId,
      task: t,
      nodeObjectId: 100,
      output: { canvas: preparedPixel, mask_image: maskPixel },
    };
    journal.unshift(start, end);
    derived.imagePreparationProofs = {
      outpaint: { actualStart: start, actualReturn: end, utilitySource: { sha256: files[1].sha256 } },
    };
    observer.wrappedCalls.push({
      kind: 'actualOutpaintCanvasCall',
      class: 'modules.DiffusersImage.OutpaintCanvas.execute',
      sourceSha256: files[1].sha256,
    });
  }
  return {
    templateId: 'example-template',
    graph,
    task,
    output,
    source,
    artifacts,
    sources,
    call,
    journal,
    observer,
    derived,
    models: [
      {
        repoId: 'example/model',
        selectedRevision: 'a'.repeat(40),
        modelRevision: 'example/model@' + 'a'.repeat(40),
        fingerprint: 'sha256:' + 'a'.repeat(64),
      },
    ],
    comparison: {
      format: 'modiff.image-template-comparison-contract.v1',
      templateId: 'example-template',
      task: control ? 'control_image' : 'inpaint',
      models: [{ repoId: 'example/model', revision: 'a'.repeat(40) }],
      settings: { sourceImagePolicies: policies },
      inputs: sources.map((x) => ({
        role: x.originalContractRole,
        sha256: x.contentHash.slice('sha256:bytes:'.length),
      })),
    },
    requests: [{ at: at(-0.1), path: '/graph', body: graph }],
    responses: [
      { at: at(0.1), path: '/graph', status: 200, body: { error: false, sid: graph.sid, task_id: task.task_id } },
    ],
  };
}

function context(w) {
  const record = (text) => ({ text, sha256: sha(text) });
  const records = {
    receipt: record(JSON.stringify({ task: w.task, outputs: [w.output] })),
    requests: record(JSON.stringify(w.requests)),
    responses: record(JSON.stringify(w.responses)),
    journal: record(w.journal.map((x) => JSON.stringify(x)).join('\n') + '\n'),
    observer: record(JSON.stringify(w.observer)),
    comparison: record(JSON.stringify(w.comparison)),
    inputs: record(JSON.stringify({ schemaVersion: 1, sources: w.sources })),
  };
  w.derived.evidenceHashes = Object.fromEntries(
    ['receipt', 'requests', 'responses'].map((k) => [
      k === 'receipt' ? 'run-receipt.json' : k + '.json',
      records[k].sha256,
    ]),
  );
  records.derived = record(JSON.stringify(w.derived));
  const payload = Object.fromEntries(Object.values(w.graph.nodes).map((n) => [n.module + '.' + n.action, n]));
  return {
    templateId: w.templateId,
    executionReceipt: w.task,
    executedOutput: w.output,
    taskId: w.task.task_id,
    modelIdentities: w.models,
    backendSource: w.source,
    backendContract: backendContractIdentity(payload, canonicalizeApiGraph(w.graph)),
    retainedNativeEvidence: records,
    inputArtifacts: w.artifacts,
  };
}
function provenance(w, c) {
  const locked = structuredClone(w.output.formSnapshot);
  for (const k of ['trustRemoteCode', 'referenceImages', 'maskImage', 'controlImage']) delete locked[k];
  return {
    taskId: w.task.task_id,
    template: { id: w.templateId, lockedSettings: locked },
    graph: { canonicalGraph: canonicalizeApiGraph(w.graph) },
    runtime: { backendSource: w.source, backendContract: c.backendContract },
    models: { items: w.models },
    inputs: { items: w.artifacts },
    output: { items: [{ mediaType: 'image', width: 64, height: 64 }] },
  };
}

test('preserved direct-image records yield an observation instead of an invented manual candidate', () => {
  const w = witness(),
    c = context(w),
    before = structuredClone({ w, c });
  const plan = executionPlanIdentity(w.graph, c).plan;
  assert.equal(plan.source, SOURCE);
  assert.match(executionReceiptIdentity(w.task, plan).resourceCandidateId, /^observed-retained-direct-image-v1:/u);
  assert.equal(w.task.resourceCandidateId, null);
  assert.deepEqual({ w, c }, before);
});

test('direct masked, prepared outpaint, embedded guidance and control routes preserve their actual distinctions', () => {
  for (const options of [
    {},
    { canvas: true },
    { expert: true, embeddedGuidance: true },
    { control: true, expert: true, embeddedGuidance: true },
  ]) {
    const w = witness(options),
      c = context(w),
      plan = observedRetainedDirectImagePlan(w.graph, c);
    assert(plan);
    assert(observedRetainedDirectImageProofMatches(plan, provenance(w, c)));
    assert(observedRetainedDirectImageProofMatches(plan, redactPublicProvenance(provenance(w, c))));
    assert.equal(plan.resourceObservation.negativePromptPassed, !options.embeddedGuidance);
    assert.equal(plan.resourceObservation.inputRoute, options.canvas ? 'outpaint_canvas' : 'direct');
    assert.equal(
      plan.resourceObservation.guidanceKeyword,
      options.embeddedGuidance ? 'guidance_scale' : 'true_cfg_scale',
    );
    assert(Object.values(plan.resourceObservation.historicalLimits).every((x) => x === false));
  }
});

test('contradictory retained direct-image records remain rejected after their record hashes are recomputed', async (t) => {
  const mutations = {
    'other response task': (w) => {
      w.responses[0].body.task_id = 'other';
    },
    'wrong response session': (w) => {
      w.responses[0].body.sid = 'other';
    },
    'failed task': (w) => {
      w.task.status = 'failed';
    },
    'retried task': (w) => {
      w.task.attempt_index = 1;
    },
    'missing source count': (w) => {
      w.task.runtimeFingerprint.backendSource.fileCount = 1;
    },
    'wrong source body': (w) => {
      w.source.files[0].sha256 = '0'.repeat(64);
    },
    'native trace truncated': (w) => {
      w.output.resolvedExecutionInputs.truncated = true;
    },
    'native leaf missing': (w) => {
      w.output.resolvedExecutionInputs.nodes.pop();
    },
    'native duplicate leaf': (w) => {
      w.output.resolvedExecutionInputs.nodes[0] = w.output.resolvedExecutionInputs.nodes[1];
    },
    'native omission': (w) => {
      w.output.resolvedExecutionInputs.nodes[0].omittedFields = { file: 'omitted' };
    },
    'different native prompt': (w) => {
      w.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'generate').fields.prompt.value = 'Other';
    },
    'different actual prompt': (w) => {
      w.call.callInputs.prompt = 'Other';
    },
    'different actual seed': (w) => {
      w.call.generator.initialSeed = 13;
    },
    'different native guidance alias': (w) => {
      w.output.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'generate').fields.true_cfg_scale.value = 5;
    },
    'two active guidance keywords': (w) => {
      w.call.callInputs.guidance_scale = 3;
    },
    'missing original PIL hash': (w) => {
      delete w.call.callInputs.image.decodedRgbaSha256;
    },
    'source bytes changed': (w) => {
      w.artifacts[0].contentHash = 'sha256:bytes:' + '0'.repeat(64);
    },
    'source pixels changed': (w) => {
      w.sources[0].decodedRgbaSha256 = '0'.repeat(64);
    },
    'mask pixels changed': (w) => {
      w.call.callInputs.mask_image.decodedRgbaSha256 = '0'.repeat(64);
    },
    'mask substituted source role': (w) => {
      w.sources[1].role = 'referenceImages[0]';
    },
    'wrong positional original input': (w) => {
      w.sources[1].originalContractRole = 'referenceImage1';
    },
    'wrong source alpha policy': (w) => {
      w.comparison.settings.sourceImagePolicies[1].alphaChannel = 'ignore';
    },
    'unsupported alpha operation': (w) => {
      w.graph.nodes.mask.params.alpha_channel.value = 'add alpha';
    },
    'empty source list': (w) => {
      w.sources = [];
    },
    'extra source descriptor': (w) => {
      w.sources.push({ ...w.sources[0] });
    },
    'unrecorded auxiliary owner': (w) => {
      w.graph.nodes.owner.params.image_prompt_adapter = { sourceId: 'mask', sourceKey: 'image' };
    },
    'unexpected execution loop': (w) => {
      w.graph.loops = [];
    },
    'extra node': (w) => {
      w.graph.nodes.extra = { ...w.graph.nodes.source };
    },
    'different immutable model': (w) => {
      w.models[0].selectedRevision = 'b'.repeat(40);
    },
    'missing full model identity': (w) => {
      w.models = [];
    },
    'wrong comparison template': (w) => {
      w.comparison.templateId = 'other';
    },
    'wrong model repository': (w) => {
      w.comparison.models[0].repoId = 'example/other';
    },
    'hidden adapter': (w) => {
      w.call.peftComponentAdapterNames = { transformer: ['hidden'] };
    },
    'hidden bound adapter': (w) => {
      w.call.peftComponentBindings = { transformer: { loadedAdapterNames: ['hidden'] } };
    },
    'unowned conditioning supplier': (w) => {
      w.call.controlnetComponent = { class: 'example.HiddenModel' };
    },
    'hidden PEFT scale': (w) => {
      w.call.peftLayerScaleHistograms = { transformer: { hidden: { 1: 2 } } };
    },
    'hidden compile': (w) => {
      w.call.appliedRuntimeConfig.compile.requested = true;
    },
    'missing applied VAE': (w) => {
      w.call.appliedRuntimeConfig.vae.applied = [];
    },
    'invented observed hook': (w) => {
      w.call.componentRuntimePolicies.transformer.offloadMode = 'group_cpu';
    },
    'unknown runtime feature': (w) => {
      w.call.appliedRuntimeConfig.hidden = true;
    },
    'unowned official class': (w) => {
      w.call.actualPipelineClass = 'custom.ExamplePipeline';
    },
    'different upstream library': (w) => {
      w.derived.actualDiffusersDirectUrl.value.url = 'https://example.invalid/model.git';
    },
    'mutable upstream commit': (w) => {
      w.derived.actualDiffusersDirectUrl.value.vcs_info.commit_id = 'main';
    },
    'reviewed source contradicts installed commit': (w) => {
      w.derived.specializedWholePipelineAuthority.diffusersCommit = 'e'.repeat(40);
    },
    'observer installed too late': (w) => {
      w.observer.installedAt = new Date((w.task.completed_at + 1) * 1000).toISOString();
    },
    'missing wrapped call': (w) => {
      w.observer.wrappedCalls = [];
    },
    'missing official return': (w) => {
      w.journal = w.journal.filter((e) => e.event !== 'officialCallReturned');
    },
    'duplicate official return': (w) => {
      w.journal.push(structuredClone(w.journal.at(-1)));
    },
    'failed official call': (w) => {
      w.journal.push({ event: 'officialCallFailed', task: w.call.task });
    },
    'borrowed output geometry': (w) => {
      w.journal.at(-1).images[0].size = [128, 64];
    },
    'missing full step': (w) => {
      w.journal = w.journal.filter((e) => e.event !== 'schedulerStepReturned' || e.stepIndex !== 2);
    },
    'invented first scheduler index': (w) => {
      w.journal.find((e) => e.event === 'schedulerStepStarted').stepIndex = 0;
    },
    'other scheduler owner': (w) => {
      w.journal.find((e) => e.event === 'schedulerStepReturned').task = { ...w.call.task, current_node: 'owner' };
    },
    'step after returned call': (w) => {
      w.journal.find((e) => e.event === 'schedulerStepReturned').at = new Date(
        (w.task.completed_at + 1) * 1000,
      ).toISOString();
    },
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, () => {
      const w = witness();
      mutate(w);
      const c = context(w);
      assert.equal(observedRetainedDirectImagePlan(w.graph, c), null);
    });
});

test('outpaint preparation must join the original source pixels, utility, controls and consumed output', async (t) => {
  const mutations = {
    'wrong canvas source': (w) => {
      w.journal[0].actualInputs.kwargs.image.decodedRgbaSha256 = '0'.repeat(64);
    },
    'wrong consumed canvas': (w) => {
      w.call.callInputs.image = { ...w.call.callInputs.image, sha256: '0'.repeat(64) };
    },
    'wrong mask return': (w) => {
      w.journal[1].output.mask_image = { ...w.journal[1].output.mask_image, sha256: '0'.repeat(64) };
    },
    'wrong preparation controls': (w) => {
      w.journal[0].actualInputs.kwargs.left = 9;
    },
    'wrong locked margins': (w) => {
      w.output.formSnapshot.outpaintLeft = 9;
    },
    'wrong utility identity': (w) => {
      w.derived.imagePreparationProofs.outpaint.utilitySource.sha256 = '0'.repeat(64);
    },
    'unobserved utility source': (w) => {
      w.observer.wrappedCalls.pop();
    },
    'utility ran after model call': (w) => {
      w.journal[1].at = w.call.at;
      w.journal[0].at = new Date((w.task.started_at + 4) * 1000).toISOString();
    },
    'duplicate utility return': (w) => {
      w.journal.push(structuredClone(w.journal[1]));
    },
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, () => {
      const w = witness({ canvas: true });
      mutate(w);
      assert.equal(observedRetainedDirectImagePlan(w.graph, context(w)), null);
    });
});

test('invalid retained records cannot fall through to a declared or manual candidate', () => {
  for (const mutate of [
    (c) => {
      c.retainedNativeEvidence.receipt.text += ' ';
    },
    (c) => {
      delete c.retainedNativeEvidence.journal;
    },
    (c) => {
      c.retainedNativeEvidence.inputs = { text: ' '.repeat(1024 ** 2 + 1), sha256: '0'.repeat(64) };
    },
    (c) => {
      c.retainedNativeEvidence.extra = { text: '{}', sha256: sha('{}') };
    },
  ]) {
    const w = witness(),
      c = context(w);
    mutate(c);
    const plan = executionPlanIdentity(w.graph, c).plan;
    assert.notEqual(plan.source, SOURCE);
    assert.equal(executionReceiptIdentity(w.task, plan).resourceCandidateId, null);
  }
});

test('final proof rejects matching graph and form substitutions after ordinary graph hashes are recomputed', () => {
  for (const mutate of [
    (w) => {
      w.output.formSnapshot.prompt = 'Other';
      w.graph.nodes.generate.params.prompt.value = 'Other';
    },
    (w) => {
      w.output.formSnapshot.seed = 13;
      w.graph.nodes.generate.params.seed.value = 13;
    },
    (w) => {
      w.graph.nodes.owner.params.offload_mode.value = 'none';
    },
    (w) => {
      w.artifacts[0].byteSize++;
    },
    (w) => {
      w.templateId = 'other';
    },
    (w) => {
      w.models[0].selectedRevision = 'e'.repeat(40);
    },
  ]) {
    const w = witness(),
      c = context(w),
      plan = observedRetainedDirectImagePlan(w.graph, c);
    assert(plan);
    mutate(w);
    assert.equal(observedRetainedDirectImageProofMatches(plan, provenance(w, c)), false);
  }
});

test('resource observation remains bounded and cannot claim hardware or undocumented controls', () => {
  const w = witness(),
    plan = observedRetainedDirectImagePlan(w.graph, context(w));
  assert(plan);
  for (const mutate of [
    (p) => {
      p.resourceObservation.historicalLimits.independentMemoryMonitoring = true;
    },
    (p) => {
      p.resourceObservation.historicalLimits.nativeOffloadHookPlacementObserved = true;
    },
    (p) => {
      p.extra = 'invented';
    },
    (p) => {
      p.resourceObservation.upstreamLibrary.commit = 'main';
    },
    (p) => {
      p.resourceObservation.rawRecordHashes.journal = 'missing';
    },
    (p) => {
      p.resourceObservation.recipe.geometry.width = Infinity;
    },
    (p) => {
      p.resourceObservation.inputPixels[0].size = [1, 2, 3];
    },
    (p) => {
      p.resourceObservation.inputPixels[0].decodedRgbaSha256 = '0'.repeat(64);
    },
  ]) {
    const altered = structuredClone(plan);
    mutate(altered);
    assert.equal(observedRetainedDirectImageResourceId(altered), null);
  }
});
