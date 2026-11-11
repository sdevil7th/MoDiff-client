import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJsonHash } from './canonical-json.mjs';
import { executionPlanIdentity, executionReceiptIdentity } from './live-proof-provenance.mjs';
import {
  observedRetainedModularImagePlan as derive,
  observedRetainedModularImageResourceId as resourceId,
  observedRetainedModularImageProofMatches as matches,
} from './retained-native-modular-image-resource.mjs';

// Entirely synthetic records. No real workflow, model, media, machine or owner ID.
function fixture({ adapter = false, previewDevice = 'cpu:0' } = {}) {
  const sha = (s) => createHash('sha256').update(s).digest('hex'),
    lit = (value) => ({ value }),
    wire = (sourceId, sourceKey) => ({ sourceId, sourceKey });
  const node = (module, action, params) => ({
    module,
    action,
    params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, lit(v)])),
  });
  const mod = (action, params) => node('modules.ModularDiffusers', action, params);
  const form = {
    mode: 'edit_image',
    modelType: 'ExampleModularPipeline',
    resourceMode: 'expert',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    randomSeed: false,
    seed: 12,
    width: 64,
    height: 64,
    steps: 2,
    guidanceScale: adapter ? 1 : 4,
    prompt: 'A fictional ceramic object.',
    negativePrompt: '',
    maxSequenceLength: 512,
    offloadMode: 'none',
    autoOffload: false,
    strength: 0.8,
    trustRemoteCode: false,
    referenceImages: ['@data/example.webp'],
  };
  const nodes = {
    load: node('modules.Image', 'Load', { file: form.referenceImages, alpha_channel: 'ignore' }),
    guide: mod('Guider', {
      model_type: form.modelType,
      guider: 'ClassifierFreeGuidance',
      guidance_scale: form.guidanceScale,
      guidance_rescale: 0,
      use_original_formulation: false,
      enabled: true,
      start: 0,
      stop: 1,
      layers_config: null,
    }),
    owner: mod('ModelsLoader', {
      model_type: form.modelType,
      repo_id: { source: 'hub', value: 'example/base' },
      revision: 'a'.repeat(40),
      dtype: 'bfloat16',
      device: 'cuda:0',
      auto_offload: false,
      offload_mode: 'none',
      attention_backend: 'inherit',
      vae_slicing: null,
      vae_tiling: null,
      trust_remote_code: false,
      workflow_id: 'image_conditioned',
      unet: null,
      vae: null,
      controlnet: null,
      lora_list: null,
      quant_config: null,
    }),
    encode: mod('EncodePrompt', { prompt: form.prompt, negative_prompt: form.negativePrompt }),
    image: mod('ImageEncode', { seed: 12, mask_image: null, padding_mask_crop: null, inpaint_compatibility: 'native' }),
    denoise: mod('Denoise', {
      width: 64,
      height: 64,
      seed: 12,
      num_inference_steps: 2,
      guidance_scale: form.guidanceScale,
    }),
    decode: mod('DecodeLatents', {}),
    preview: node('modules.Image', 'Preview', { device: previewDevice }),
  };
  const edges = [
    ['image', 'vae', 'owner', 'vae_out'],
    ['image', 'image', 'load', 'image'],
    ['encode', 'text_encoders', 'owner', 'text_encoders'],
    ['encode', 'guider', 'guide', 'guider_out'],
    ['encode', 'image', 'load', 'image'],
    ['denoise', 'unet', 'owner', 'unet_out'],
    ['denoise', 'scheduler', 'owner', 'scheduler'],
    ['denoise', 'embeddings', 'encode', 'embeddings'],
    ['denoise', 'image_latents', 'image', 'image_latents'],
    ['denoise', 'route_state_in', 'image', 'route_state_out'],
    ['denoise', 'guider', 'guide', 'guider_out'],
    ['decode', 'vae', 'owner', 'vae_out'],
    ['decode', 'latents', 'denoise', 'latents'],
    ['decode', 'route_state_in', 'denoise', 'route_state_out'],
    ['preview', 'image', 'decode', 'images'],
  ];
  for (const [t, k, s, p] of edges) nodes[t].params[k] = wire(s, p);
  const scheduler = {
    class: 'diffusers.schedulers.scheduling_flow_match_euler_discrete.FlowMatchEulerDiscreteScheduler',
    config: { shift: 1 },
  };
  const configuredName = 'reviewed-adapter';
  if (adapter) {
    nodes.lora = mod('Lora', {
      model: { source: 'hub', value: 'example/adapter' },
      revision: 'b'.repeat(40),
      weight_name: 'example.safetensors',
      expected_sha256: 'c'.repeat(64),
      previous_loras: null,
      scale: 1,
      adapter_name: configuredName,
      scheduler_class: 'FlowMatchEulerDiscreteScheduler',
      scheduler_config: JSON.stringify(scheduler.config),
    });
    nodes.owner.params.lora_list = wire('lora', 'lora');
  }
  const paths = [
    ['load', 'guide', ...(adapter ? ['lora'] : []), 'owner', 'encode', 'image', 'denoise', 'decode', 'preview'],
  ];
  const snapshot = { studioForm: form };
  const api = {
    sid: 'synthetic-session',
    nodes,
    paths,
    runtimeHints: {
      resourceMode: 'expert',
      workflowTabId: 'synthetic-workflow',
      clientRunId: 'synthetic-client',
      runInputHash: 'synthetic-input',
      workflowSnapshot: snapshot,
    },
  };
  const files = [{ path: 'modiff/example.py', sha256: 'd'.repeat(64) }],
    gitCommit = 'e'.repeat(40);
  const source = {
    gitCommit,
    files,
    fingerprint: 'sha256:backend-source-v1:' + canonicalJsonHash({ gitCommit, files }),
  };
  const contract = {
    fingerprint: 'sha256:backend-contract-v1:' + 'f'.repeat(64),
    contracts: [{ key: 'modules.ModularDiffusers.ModelsLoader', params: nodes.owner.params }],
  };
  const task = {
    task_id: 'synthetic-task',
    status: 'completed',
    attempt_index: 0,
    resourceCandidateId: null,
    sid: api.sid,
    workflow_tab_id: api.runtimeHints.workflowTabId,
    client_run_id: api.runtimeHints.clientRunId,
    run_input_hash: api.runtimeHints.runInputHash,
    workflow_snapshot: snapshot,
    started_at: 1700000000,
    completed_at: 1700000020,
    runtimePreparation: { resourceMode: 'expert' },
    runtimeFingerprint: { backendSource: { fingerprint: source.fingerprint, fileCount: 1, gitCommit } },
  };
  const inputArtifacts = [
    {
      role: 'referenceImages[0]',
      path: form.referenceImages[0],
      contentHash: 'sha256:bytes:' + '1'.repeat(64),
      byteSize: 32,
    },
  ];
  const pixel = { mode: 'RGB', size: [64, 64], sha256: '2'.repeat(64), decodedRgbaSha256: '3'.repeat(64) };
  const rowFor = (id, n) => ({ nodeId: id, module: n.module, action: n.action, fields: {}, omittedFields: {} });
  const captures = Object.entries(nodes).map(([id, n]) => rowFor(id, n));
  const consume = (id, keys) => {
    const row = captures.find((n) => n.nodeId === id);
    for (const k of keys.split(' ')) {
      const v = nodes[id].params[k]?.value;
      row.fields[k] = { source: 'literal', value: k === 'repo_id' ? v.value : (v ?? null) };
    }
  };
  consume(
    'owner',
    'model_type repo_id revision dtype device auto_offload offload_mode quant_config attention_backend vae_slicing vae_tiling',
  );
  consume('guide', 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop');
  consume('encode', 'prompt negative_prompt');
  consume('denoise', 'width height seed num_inference_steps guidance_scale');
  consume('image', 'seed');
  consume('preview', 'device');
  if (adapter) consume('lora', 'revision');
  const output = {
    taskId: task.task_id,
    attemptIndex: 0,
    nodeId: 'preview',
    sid: api.sid,
    workflowTabId: api.runtimeHints.workflowTabId,
    clientRunId: api.runtimeHints.clientRunId,
    runInputHash: api.runtimeHints.runInputHash,
    formSnapshot: form,
    apiGraphSnapshot: api,
    mediaItems: [{ width: 64, height: 64 }],
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: task.task_id,
      attemptIndex: 0,
      nodeId: 'preview',
      truncated: false,
      uncapturedNodeIds: [],
      nodes: captures,
      graphTasks: [{ loaderId: 'owner', pipelineClass: form.modelType, task: null }],
    },
  };
  const models = [
    {
      repoId: 'example/base',
      selectedRevision: 'a'.repeat(40),
      modelRevision: 'example/base@' + 'a'.repeat(40),
      fingerprint: 'synthetic-base',
    },
  ];
  if (adapter)
    models.push({
      repoId: 'example/adapter',
      selectedRevision: 'b'.repeat(40),
      modelRevision: 'example/adapter@' + 'b'.repeat(40),
      fingerprint: 'synthetic-adapter',
    });
  const at = (seconds) => new Date((task.started_at + seconds) * 1000).toISOString();
  const scope = (id) => nodes[id].module + '.' + nodes[id].action;
  const eventTask = (id) => ({
    task_id: task.task_id,
    attempt_index: 0,
    current_node: id,
    current_node_name: scope(id),
  });
  const guideConfig = Object.fromEntries(
    'guidance_scale guidance_rescale use_original_formulation enabled start stop'
      .split(' ')
      .map((k) => [k, nodes.guide.params[k].value]),
  );
  const calls = ['encode', 'image', 'denoise', 'decode'].map((id, i) => ({
    event: 'officialCallStarted',
    callId: String(i + 1).repeat(32),
    at: at(i * 3 + 2),
    task: eventTask(id),
    pipelineClass: 'diffusers.modular_pipelines.modular_pipeline.ModularPipeline',
    actualPipelineClass: 'diffusers.modular_pipelines.example.ExampleModularPipeline',
    generator: ['image', 'denoise'].includes(id) ? { device: 'cuda:0', initialSeed: 12, type: 'Generator' } : null,
    callInputs:
      id === 'encode'
        ? { prompt: form.prompt, negative_prompt: form.negativePrompt, image: pixel }
        : id === 'image'
          ? { image: pixel, mask_image: null, padding_mask_crop: null }
          : id === 'denoise'
            ? { num_inference_steps: 2, width: 64, height: 64 }
            : {},
    ...(['encode', 'denoise'].includes(id)
      ? { guider: { class: 'diffusers.guiders.classifier_free_guidance.ClassifierFreeGuidance', config: guideConfig } }
      : {}),
    ...(['image', 'decode'].includes(id) ? { vaeMemoryFlags: { use_slicing: false, use_tiling: false } } : {}),
    ...(id === 'denoise'
      ? {
          scheduler,
          peftComponentAdapterNames: adapter ? { transformer: [configuredName] } : {},
          peftLayerScaleHistograms: adapter ? { transformer: { [configuredName]: { 1: 1 } } } : {},
          wholePipelineAdapterScales: null,
        }
      : {}),
    ...(adapter && id === 'denoise'
      ? { peftComponentBindings: { transformer: { modelObjectId: 42, loadedAdapterNames: [configuredName] } } }
      : {}),
  }));
  const returns = calls.map((c, i) => ({
    event: 'officialCallReturned',
    callId: c.callId,
    at: at(i * 3 + 4),
    task: c.task,
    ...(c.task.current_node === 'decode' ? { images: [{ mode: 'RGB', size: [64, 64] }] } : {}),
  }));
  let events = calls.flatMap((c, i) => [c, returns[i]]);
  const den = calls[2];
  for (let i = 0; i < 2; i++)
    events.push(
      { event: 'schedulerStepStarted', task: den.task, at: at(8.2 + i * 0.5), stepIndex: i === 0 ? null : i },
      { event: 'schedulerStepReturned', task: den.task, at: at(8.4 + i * 0.5), stepIndex: i + 1 },
    );
  let adapterEvidence = null;
  if (adapter) {
    const actualWeight = {
      adapterName: configuredName,
      weightName: 'example.safetensors',
      actualFile: { sha256: 'c'.repeat(64), byteSize: 32 },
      revision: null,
    };
    const start = {
      event: 'loraWeightLoadStarted',
      at: at(0.1),
      callId: 'lora-call',
      pipelineObjectId: 99,
      task: eventTask('owner'),
      actualWeight,
    };
    const loaded = {
      event: 'loraWeightLoadReturned',
      at: at(0.2),
      callId: start.callId,
      pipelineObjectId: 99,
      task: start.task,
      actualWeight,
      runtimeAfter: {
        peftComponentBindings: { transformer: { modelObjectId: 42, loadedAdapterNames: [configuredName] } },
      },
    };
    const active = {
      event: 'loraSetAdaptersReturned',
      at: at(0.3),
      pipelineObjectId: 99,
      task: start.task,
      actualInputs: { adapter_names: [configuredName], adapter_weights: [1] },
      runtimeAfter: loaded.runtimeAfter,
    };
    const forwards = [0, 1].map((i) => ({
      event: 'actualQwenModelAdapters',
      at: at(8.25 + i * 0.5),
      task: den.task,
      modelObjectId: 42,
      peftBinding: {
        modelObjectId: 42,
        loadedAdapterNames: [configuredName],
        layers: [
          {
            name: 'synthetic-layer',
            activeAdapters: [configuredName],
            disableAdapters: false,
            mergedAdapters: [],
            loraAKeys: [configuredName],
            loraBKeys: [configuredName],
            scaling: { [configuredName]: 1 },
          },
        ],
      },
    }));
    events.push(start, loaded, active, ...forwards);
    adapterEvidence = {
      rawDescriptors: [
        {
          nodeId: 'lora',
          rawName: configuredName,
          rawNameFieldPresent: true,
          sha256: 'c'.repeat(64),
          weightName: 'example.safetensors',
          scale: 1,
          resolvedName: configuredName,
        },
      ],
      actualLoadedWeights: [loaded],
      actualActivation: active,
      actualConsumingForwards: forwards,
      consumedTransformerObjectId: 42,
    };
  }
  const records = {};
  const record = (name, value, journal = false) => {
    const text = journal ? value.map((x) => JSON.stringify(x)).join('\n') : JSON.stringify(value);
    records[name] = { text, sha256: sha(text) };
  };
  record('receipt', { task, outputs: [output] });
  record('requests', [{ path: '/graph', at: at(-1), body: api }]);
  record('responses', [
    { path: '/graph', status: 200, at: at(0.01), body: { error: false, task_id: task.task_id, sid: api.sid } },
  ]);
  record('journal', events, true);
  record('observer', {
    installedAt: at(-2),
    observerSha256: '4'.repeat(64),
    wrappedCalls: [{ kind: 'officialPipelineCall', class: calls[0].pipelineClass, sourceSha256: '5'.repeat(64) }],
  });
  record('comparison', {
    format: 'modiff.image-template-comparison-contract.v1',
    templateId: 'synthetic-template',
    task: 'edit_image',
    inputs: [{ sha256: '1'.repeat(64), role: 'referenceImage1' }],
    models: models.map((m) => ({
      repoId: m.repoId,
      revision: m.selectedRevision,
      ...(m.repoId === 'example/adapter' ? { weightName: 'example.safetensors', sha256: 'c'.repeat(64) } : {}),
    })),
    settings: { scheduler },
  });
  record('inputs', {
    schemaVersion: 1,
    sources: [
      {
        role: 'referenceImages[0]',
        contentHash: inputArtifacts[0].contentHash,
        byteSize: 32,
        originalContractRole: 'referenceImage1',
        decodedRgbaSha256: pixel.decodedRgbaSha256,
        size: pixel.size,
      },
    ],
  });
  record('derived', {
    taskId: task.task_id,
    evidenceHashes: {
      'run-receipt.json': records.receipt.sha256,
      'requests.json': records.requests.sha256,
      'responses.json': records.responses.sha256,
    },
    actualOfficialCalls: calls,
    actualDiffusersDirectUrl: {
      value: { url: 'https://github.com/huggingface/diffusers.git', vcs_info: { commit_id: '6'.repeat(40) } },
    },
    ...(adapter ? { generatedNamespaceLoadToConsumption: adapterEvidence } : {}),
  });
  const context = {
    executionReceipt: task,
    executedOutput: output,
    backendSource: source,
    backendContract: contract,
    modelIdentities: models,
    inputArtifacts,
    retainedNativeEvidence: records,
    taskId: task.task_id,
    templateId: 'synthetic-template',
  };
  const provenance = {
    graph: { canonicalGraph: { nodes: Object.entries(nodes).map(([key, n]) => ({ key, ...n })), paths } },
    template: { id: 'synthetic-template', lockedSettings: form },
    taskId: task.task_id,
    runtime: { backendSource: source, backendContract: contract },
    inputs: { items: inputArtifacts, count: 1 },
    models: { items: models },
    output: { items: [{ mediaType: 'image', width: 64, height: 64 }] },
  };
  const alterRecord = (name, mutate) => {
    const raw = records[name],
      journal = name === 'journal',
      value = journal ? raw.text.split('\n').map((x) => JSON.parse(x)) : JSON.parse(raw.text);
    mutate(value);
    record(name, value, journal);
  };
  return { api, context, provenance, alterRecord };
}

for (const adapter of [false, true])
  for (const previewDevice of ['cpu:0', 'cuda:0'])
    test(
      'retained modular ' +
        (adapter ? 'adapter' : 'base') +
        ' with ' +
        previewDevice +
        ' preview joins complete evidence',
      () => {
        const f = fixture({ adapter, previewDevice }),
          p = derive(f.api, f.context);
        assert(p);
        assert(resourceId(p));
        assert.equal(matches(p, f.provenance), true);
      },
    );

for (const [name, mutate] of [
  ['missing raw journal', (f) => delete f.context.retainedNativeEvidence.journal],
  ['changed exact input body', (f) => (f.context.inputArtifacts[0].contentHash = 'sha256:bytes:' + '9'.repeat(64))],
  ['unknown upstream graph supplier', (f) => (f.api.nodes.image.params.image.sourceId = 'other')],
  ['invented historical loader control', (f) => (f.api.nodes.owner.params.weight_format = { value: 'native' })],
  ['changed source files', (f) => (f.context.backendSource.files[0].sha256 = '0'.repeat(64))],
  [
    'missing native consumed control',
    (f) =>
      delete f.context.executedOutput.resolvedExecutionInputs.nodes.find((n) => n.nodeId === 'denoise').fields
        .num_inference_steps,
  ],
  [
    'incomplete native capture',
    (f) => (f.context.executedOutput.resolvedExecutionInputs.uncapturedNodeIds = ['image']),
  ],
  [
    'reordered scheduler calls',
    (f) => f.alterRecord('journal', (rows) => (rows.find((r) => r.event === 'schedulerStepReturned').stepIndex = 2)),
  ],
  [
    'wrong official pipeline class',
    (f) =>
      f.alterRecord(
        'journal',
        (rows) => (rows.find((r) => r.event === 'officialCallStarted').pipelineClass = 'untrusted.Pipeline'),
      ),
  ],
  [
    'same role with different original pixels',
    (f) => f.alterRecord('inputs', (v) => (v.sources[0].decodedRgbaSha256 = '9'.repeat(64))),
  ],
  ['incomplete native graph path', (f) => f.api.paths[0].pop()],
  [
    'later observer installation',
    (f) =>
      f.alterRecord(
        'observer',
        (v) => (v.installedAt = new Date((f.context.executionReceipt.started_at + 1) * 1000).toISOString()),
      ),
  ],
])
  test('retained modular rejects ' + name, () => {
    const f = fixture();
    mutate(f);
    assert.equal(derive(f.api, f.context), null);
  });

for (const [name, mutate] of [
  [
    'adapter was never activated',
    (f) =>
      f.alterRecord('journal', (rows) =>
        rows.splice(
          rows.findIndex((r) => r.event === 'loraSetAdaptersReturned'),
          1,
        ),
      ),
  ],
  [
    'adapter scale changed at consuming layer',
    (f) =>
      f.alterRecord(
        'journal',
        (rows) =>
          (rows.find((r) => r.event === 'actualQwenModelAdapters').peftBinding.layers[0].scaling['reviewed-adapter'] =
            0.5),
      ),
  ],
  [
    'adapter forward outside native task interval',
    (f) => {
      const stamp = new Date((f.context.executionReceipt.completed_at + 1) * 1000).toISOString();
      f.alterRecord('journal', (rows) => (rows.find((r) => r.event === 'actualQwenModelAdapters').at = stamp));
      f.alterRecord('derived', (v) => (v.generatedNamespaceLoadToConsumption.actualConsumingForwards[0].at = stamp));
    },
  ],
  [
    'adapter body differs from pinned file',
    (f) =>
      f.alterRecord(
        'journal',
        (rows) =>
          (rows.find((r) => r.event === 'loraWeightLoadReturned').actualWeight.actualFile.sha256 = '9'.repeat(64)),
      ),
  ],
])
  test('retained modular rejects ' + name, () => {
    const f = fixture({ adapter: true });
    mutate(f);
    assert.equal(derive(f.api, f.context), null);
  });

for (const [name, mutate] of [
  ['flat base identity contradiction', (p) => (p.modelRepo = 'example/different')],
  ['flat pipeline contradiction', (p) => (p.pipelineClass = 'OtherModularPipeline')],
  ['unknown hardware qualification flag', (p) => (p.hardwareQualified = true)],
  [
    'invented original installed inventory',
    (p) => (p.resourceObservation.historicalLimits.originalTimeInstalledInventory = true),
  ],
  [
    'wrong official library owner',
    (p) => (p.resourceObservation.upstreamLibrary.url = 'https://example.test/diffusers'),
  ],
  ['invalid source pixel digest', (p) => (p.resourceObservation.inputs[0].sha256 = 'missing')],
  ['unknown journal authority', (p) => (p.resourceObservation.rawRecordHashes.other = 'a'.repeat(64))],
])
  test('retained modular identifier rejects ' + name, () => {
    const f = fixture(),
      p = derive(f.api, f.context);
    assert(p);
    mutate(p);
    assert.equal(resourceId(p), null);
    assert.equal(matches(p, f.provenance), false);
  });

for (const [name, mutate] of [
  ['unused form strength changed', (p) => (p.resourceObservation.configuredUnusedFields.formStrength = 0.1)],
  [
    'unused sequence control changed',
    (p) => (p.resourceObservation.configuredUnusedFields.formMaxSequenceLength = 256),
  ],
  ['adapter pinned bytes changed', (p) => (p.resourceObservation.adapter.sha256 = '9'.repeat(64))],
  ['adapter scale changed', (p) => (p.resourceObservation.adapter.scale = 0.5)],
])
  test('retained modular final matcher rejects ' + name, () => {
    const f = fixture({ adapter: true }),
      p = derive(f.api, f.context);
    assert(p);
    mutate(p);
    assert.equal(matches(p, f.provenance), false);
  });

test('ordinary provenance selects the retained modular factory and exact observation identity', () => {
  const f = fixture({ adapter: true }),
    observed = derive(f.api, f.context),
    actual = executionPlanIdentity(f.api, f.context);
  assert.deepEqual(actual.plan, observed);
  assert.equal(
    executionReceiptIdentity(f.context.executionReceipt, actual.plan).resourceCandidateId,
    resourceId(observed),
  );
});
test('invalid retained records cannot fall through to an Expert or manual identity', () => {
  const f = fixture();
  delete f.context.retainedNativeEvidence.journal;
  const p = executionPlanIdentity(f.api, f.context);
  assert.deepEqual(p.plan, {});
  assert.equal(executionReceiptIdentity(f.context.executionReceipt, p.plan).resourceCandidateId, null);
});
