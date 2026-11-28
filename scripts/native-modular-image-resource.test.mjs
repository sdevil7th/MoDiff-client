import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  backendContractIdentity,
  canonicalizeApiGraph,
  executionPlanIdentity,
  executionReceiptIdentity,
  sha256Value,
} from './live-proof-provenance.mjs';
import { canonicalJsonHash } from './canonical-json.mjs';
import { workerGraphHash } from './observed-workflow-auto-resource.mjs';
import {
  observedNativeModularImageProofMatches,
  observedNativeModularImageResourceId,
} from './observed-native-modular-image-resource.mjs';

const SOURCE = 'observed-native-modular-image-resource-v1';
const literal = (value) => ({ value });
const wire = (sourceId, sourceKey) => ({ sourceId, sourceKey });

export function nativeImageWitness(mode = 'edit_image') {
  const layered = mode === 'layer_decomposition';
  const multi = mode === 'multi_image_reference_edit';
  const pipeline = layered ? 'QwenImageLayeredModularPipeline' : 'FluxKontextModularPipeline';
  const repository = layered ? 'example/layered' : 'example/material-edit';
  const resolution = layered ? 640 : 1024;
  const form = {
    mode,
    modelType: layered ? pipeline : 'FluxKontextPipeline',
    resourceMode: layered ? 'auto' : 'expert',
    dtype: 'bfloat16',
    device: 'cuda:0',
    autoOffload: true,
    offloadMode: layered ? 'model_cpu' : 'group_cpu',
    quantizationMode: 'none',
    trustRemoteCode: false,
    randomSeed: false,
    seed: 123,
    width: resolution,
    height: resolution,
    steps: 28,
    guidanceScale: 3.5,
    maxSequenceLength: 512,
    prompt: 'Preserve the photographed subject and change only the requested material.',
    negativePrompt: '',
    ...(layered ? { layers: 3 } : {}),
  };
  const add = (module, action, params) => ({ module, action, params });
  const modular = (action, params) => add('modules.ModularDiffusers', action, params);
  const inputArtifacts = Array.from({ length: multi ? 2 : 1 }, (_, index) => ({
    role: `referenceImages[${index}]`,
    path: `@data/input-${index}.png`,
    contentHash: 'sha256:bytes:' + String(index + 1).repeat(64),
    byteSize: 100 + index,
  }));
  const nodes = {
    load: add('modules.Image', 'Load', {
      file: literal(inputArtifacts.map((item) => item.path)),
      alpha_channel: literal(layered ? 'add alpha' : 'ignore'),
      label: { display: 'ui_label', value: 'Synthetic reference input' },
    }),
    models: modular('ModelsLoader', {
      model_type: literal(pipeline),
      repo_id: literal({ source: 'hub', value: repository }),
      revision: literal('a'.repeat(40)),
      reviewed_variant: literal(repository),
      workflow_id: literal('default'),
      dtype: literal(form.dtype),
      device: literal(form.device),
      auto_offload: literal(form.autoOffload),
      offload_mode: literal(form.offloadMode),
      weight_loading_mode: literal('cpu'),
      weight_format: literal('native'),
      attention_backend: literal('auto'),
      vae_slicing: literal(true),
      vae_tiling: literal(true),
      inpaint_compatibility: literal('native'),
      trust_remote_code: literal(false),
      refresh_pipeline_identity_button: { display: 'ui_button', value: true },
      ...Object.fromEntries(['unet', 'vae', 'controlnet', 'lora_list', 'quant_config'].map((k) => [k, literal(null)])),
    }),
    guider: modular('Guider', {
      model_type: literal(pipeline),
      guider: literal('ClassifierFreeGuidance'),
      guidance_scale: literal(form.guidanceScale),
      guidance_rescale: literal(0),
      use_original_formulation: literal(false),
      enabled: literal(true),
      start: literal(0),
      stop: literal(1),
      layers_config: literal(null),
    }),
    encode: modular('EncodePrompt', {
      text_encoders: wire('models', 'text_encoders'),
      guider: wire('guider', 'guider_out'),
      prompt: literal(form.prompt),
      prompt_input: literal(null),
      negative_prompt: literal(''),
      max_sequence_length: literal(512),
      ...(layered ? { image: wire('load', 'image'), resolution: literal(640), use_en_prompt: literal(false) } : {}),
    }),
    image: modular('ImageEncode', {
      vae: wire('models', 'vae_out'),
      image: wire(multi ? 'stitch' : 'load', multi ? 'output' : 'image'),
      seed: literal(form.seed),
      ...(layered ? { resolution: literal(640) } : {}),
    }),
    denoise: modular('Denoise', {
      unet: wire('models', 'unet_out'),
      scheduler: wire('models', 'scheduler'),
      embeddings: wire('encode', 'embeddings'),
      image_latents: wire('image', 'image_latents'),
      guider: wire('guider', 'guider_out'),
      seed: literal(form.seed),
      num_inference_steps: literal(form.steps),
      guidance_scale: literal(form.guidanceScale),
      ...(layered ? { layers: literal(3) } : { width: literal(1024), height: literal(1024) }),
    }),
    decode: modular('DecodeLatents', {
      vae: wire('models', 'vae_out'),
      latents: wire('denoise', 'latents'),
      ...(layered
        ? {}
        : {
            width: { ...wire('denoise', 'out_width'), value: 1024 },
            height: { ...wire('denoise', 'out_height'), value: 1024 },
          }),
    }),
    preview: add('modules.Image', 'Preview', {
      image: wire('decode', 'images'),
      device: literal('cpu:0'),
      export: literal('0'),
    }),
    ...(multi
      ? {
          stitch: add('modules.ImageOperations', 'StitchImages', {
            image: wire('load', 'image'),
            layout: literal('horizontal_reference'),
            columns: literal(2),
            spacing: literal(0),
            background: literal('white'),
            match_size: literal(true),
          }),
        }
      : {}),
  };
  const order = [
    'load',
    'models',
    'guider',
    'encode',
    ...(multi ? ['stitch'] : []),
    'image',
    'denoise',
    'decode',
    'preview',
  ];
  const snapshot = { studioForm: form, nodes: [], edges: [] };
  const hints = {
    clientRunId: 'client-run',
    workflowTabId: 'tab',
    runInputHash: 'input-hash',
    workflowSnapshot: snapshot,
  };
  const apiGraph = { sid: 'session', nodes, paths: [order], runtimeHints: hints };
  if (layered)
    Object.assign(hints, {
      resourceMode: 'auto',
      workflowAutoPlan: { schemaVersion: 1, graphHash: workerGraphHash(apiGraph) },
    });
  const capturedKeys = {
    models:
      'model_type repo_id revision dtype device auto_offload offload_mode quant_config weight_loading_mode attention_backend vae_slicing vae_tiling'.split(
        ' ',
      ),
    guider: 'model_type guider guidance_scale guidance_rescale use_original_formulation enabled start stop'.split(' '),
    encode: ['prompt', 'negative_prompt', 'max_sequence_length'],
    image: ['seed'],
    denoise: ['seed', 'num_inference_steps', 'guidance_scale', ...(layered ? [] : ['width', 'height'])],
    decode: layered ? [] : ['width', 'height'],
    preview: ['device'],
    stitch: [],
  };
  const sourceFiles = [{ path: 'main.py', sha256: 'b'.repeat(64) }];
  const backendSource = {
    gitCommit: null,
    files: sourceFiles,
    fingerprint: sha256Value('backend-source-v1', { gitCommit: null, files: sourceFiles }),
  };
  const startedAt = Date.parse('2026-11-12T02:00:00Z') / 1000;
  const task = {
    task_id: 'native-task',
    status: 'completed',
    attempt_index: 0,
    resourceCandidateId: null,
    sid: apiGraph.sid,
    client_run_id: hints.clientRunId,
    workflow_tab_id: hints.workflowTabId,
    run_input_hash: hints.runInputHash,
    started_at: startedAt,
    completed_at: startedAt + 60,
    workflow_snapshot: snapshot,
    runtimeFingerprint: {
      backendSource: {
        schemaVersion: 1,
        claim: 'process_start_backend_source_identity',
        fingerprint: backendSource.fingerprint,
        gitCommit: null,
        fileCount: 1,
        capturedAt: '2026-11-12T01:59:00Z',
      },
    },
    runtimeMeasurement: { elapsedSeconds: 60, processRssBytes: 1024 },
    runtimePreparation: {
      resourceMode: form.resourceMode,
      performed: false,
      residentRecipeReusable: !layered,
      cleanup: null,
      ...(layered
        ? {
            workflowAuto: {
              strategy: 'dependency_order_retained_owners',
              schedule: null,
              cachePreparation: null,
              reusedOwnerIds: [],
              preparedDataNodes: [],
              resolvedFields: {},
              appliedUpdates: [],
              releases: [],
            },
          }
        : {}),
    },
  };
  const captures = order.map((nodeId) => {
    const node = nodes[nodeId];
    const fields =
      nodeId === 'load'
        ? {
            alpha_channel: { source: 'literal', value: layered ? 'add alpha' : 'ignore' },
            source_hashes: { source: 'literal', value: inputArtifacts.map((x) => x.contentHash.slice(-64)) },
            source_widths: { source: 'literal', value: inputArtifacts.map(() => 1024) },
            source_heights: { source: 'literal', value: inputArtifacts.map(() => 1024) },
            source_modes: { source: 'literal', value: inputArtifacts.map(() => (layered ? 'RGBA' : 'RGB')) },
          }
        : Object.fromEntries(
            (capturedKeys[nodeId] ?? []).map((key) => [
              key,
              nodeId === 'decode'
                ? { source: 'connected', sourceNodeId: 'denoise', sourcePortId: 'out_' + key, value: resolution }
                : { source: 'literal', value: key === 'repo_id' ? repository : node.params[key].value },
            ]),
          );
    return {
      nodeId,
      module: node.module,
      action: node.action,
      fields,
      omittedFields: {},
      ...(nodeId === 'models'
        ? {
            appliedAdapters: layered
              ? {
                  schemaVersion: 1,
                  status: 'complete',
                  source: 'backend-adapter-application',
                  applicationId: '1'.repeat(32),
                  observation: 'activated',
                  adapters: [],
                  stateSha256: 'sha256:applied-adapters-v1:' + canonicalJsonHash({ adapters: [] }),
                }
              : { schemaVersion: 1, status: 'unavailable', reason: 'unsupported-owner' },
          }
        : {}),
    };
  });
  const mediaItems = Array.from({ length: layered ? 3 : 1 }, (_, index) => ({
    index,
    width: resolution,
    height: resolution,
    mediaHash: 'sha256:bytes:' + String(index + 5).repeat(64),
    byteSize: 50 + index,
  }));
  const output = {
    taskId: task.task_id,
    attemptIndex: 0,
    nodeId: 'preview',
    sid: apiGraph.sid,
    workflowTabId: hints.workflowTabId,
    clientRunId: hints.clientRunId,
    runInputHash: hints.runInputHash,
    apiGraphSnapshot: apiGraph,
    formSnapshot: form,
    mediaItems,
    resolvedExecutionInputs: {
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: task.task_id,
      attemptIndex: 0,
      nodeId: 'preview',
      truncated: false,
      uncapturedNodeIds: [],
      nodes: captures,
      graphTasks: [{ loaderId: 'models', pipelineClass: pipeline, task: layered ? 'layer_decomposition' : null }],
      appliedAdaptersStatus: { schemaVersion: 1, truncated: false },
    },
  };
  const modelIdentities = [
    {
      repoId: repository,
      selectedRevision: 'a'.repeat(40),
      modelRevision: repository + '@' + 'a'.repeat(40),
      fingerprint: 'sha256:test-model',
    },
  ];
  const backendContract = backendContractIdentity(
    Object.fromEntries(Object.values(nodes).map((node) => [node.module + '.' + node.action, node])),
    canonicalizeApiGraph(apiGraph),
  );
  return {
    apiGraph,
    context: {
      executionReceipt: task,
      executedOutput: output,
      taskId: task.task_id,
      modelIdentities,
      inputArtifacts,
      backendSource,
      backendContract,
    },
  };
}

for (const mode of ['edit_image', 'multi_image_reference_edit', 'layer_decomposition']) {
  test(`native image receipt binds the actual ${mode} owner without changing original evidence`, () => {
    const w = nativeImageWitness(mode),
      before = structuredClone(w);
    const plan = executionPlanIdentity(w.apiGraph, w.context).plan;
    assert.equal(plan.source, SOURCE);
    assert.equal(plan.modelType, w.apiGraph.nodes.models.params.model_type.value);
    assert.equal(plan.resourceMode, mode === 'layer_decomposition' ? 'auto' : 'expert');
    assert.match(
      executionReceiptIdentity(w.context.executionReceipt, plan).resourceCandidateId,
      /^observed-native-image-v1:/u,
    );
    assert.deepEqual(w, before);
    assert.equal(w.context.executionReceipt.resourceCandidateId, null);
  });
}

test('nested saved Block metadata does not change the flat native image receipt', () => {
  const w = nativeImageWitness();
  let metadata = { preserved: true };
  for (let index = 0; index < 24; index++) metadata = { childDefinition: metadata };
  w.apiGraph.runtimeHints.workflowSnapshot.nodes.push({ data: metadata });
  assert.equal(executionPlanIdentity(w.apiGraph, w.context).plan.source, SOURCE);
});

function proofFor(w, plan) {
  return {
    taskId: w.context.taskId,
    capturedAt: new Date(w.context.executionReceipt.completed_at * 1000).toISOString(),
    graph: { canonicalGraph: canonicalizeApiGraph(w.apiGraph) },
    models: { items: w.context.modelIdentities },
    inputs: { items: w.context.inputArtifacts },
    runtime: { backendSource: w.context.backendSource, backendContract: w.context.backendContract },
    execution: { resourceCandidateId: observedNativeModularImageResourceId(plan) },
    output: {
      items: w.context.executedOutput.mediaItems.map((item) => ({
        width: item.width,
        height: item.height,
        byteSize: item.byteSize,
        encodedSha256: item.mediaHash,
      })),
    },
  };
}

for (const mode of ['edit_image', 'multi_image_reference_edit', 'layer_decomposition']) {
  test(`canonical public-proof join retains native ${mode} controls and declared-only limitations`, () => {
    const w = nativeImageWitness(mode),
      plan = executionPlanIdentity(w.apiGraph, w.context).plan;
    assert(observedNativeModularImageProofMatches(plan, proofFor(w, plan)));
    assert.equal(plan.resourceObservation.completeFieldAccountingClaimed, false);
    assert.equal(plan.resourceObservation.hardwareQualificationClaimed, false);
    const missing = plan.resourceObservation.declaredOnlyControls;
    assert(missing.some((item) => item.role === 'ModelsLoader' && item.field === 'weight_format'));
    if (mode === 'layer_decomposition') {
      assert(missing.some((item) => item.role === 'ImageEncode' && item.field === 'resolution'));
      assert(missing.some((item) => item.role === 'Denoise' && item.field === 'layers'));
    } else {
      assert.equal(plan.resourceObservation.adapterApplicationObserved, false);
      const decoder = plan.resourceObservation.capturedNodes.find((row) => row.role === 'DecodeLatents');
      assert.deepEqual(decoder.fields.width, {
        source: 'connected',
        value: 1024,
        sourceRole: 'Denoise',
        sourcePortId: 'out_width',
      });
    }
  });
}

const nativeRow = (w, nodeId) =>
  w.context.executedOutput.resolvedExecutionInputs.nodes.find((row) => row.nodeId === nodeId);
const invalidContexts = {
  'failed task': (w) => {
    w.context.executionReceipt.status = 'failed';
  },
  'retried attempt': (w) => {
    w.context.executionReceipt.attempt_index = 1;
  },
  'invented native candidate': (w) => {
    w.context.executionReceipt.resourceCandidateId = 'made-up';
  },
  'different output task': (w) => {
    w.context.executedOutput.taskId = 'other';
  },
  'different output attempt': (w) => {
    w.context.executedOutput.attemptIndex = 1;
  },
  'different run correlation': (w) => {
    w.context.executionReceipt.client_run_id = 'other';
  },
  'missing model': (w) => {
    w.context.modelIdentities = [];
  },
  'extra model': (w) => {
    w.context.modelIdentities.push(structuredClone(w.context.modelIdentities[0]));
  },
  'wrong selected revision': (w) => {
    w.context.modelIdentities[0].selectedRevision = 'b'.repeat(40);
  },
  'wrong source identity': (w) => {
    w.context.backendSource.fingerprint = 'sha256:backend-source-v1:' + '0'.repeat(64);
  },
  'borrowed model component': (w) => {
    w.apiGraph.nodes.models.params.unet = wire('decode', 'images');
  },
  'remote code': (w) => {
    w.apiGraph.nodes.models.params.trust_remote_code.value = true;
  },
  'unreviewed packed weights': (w) => {
    w.apiGraph.nodes.models.params.weight_format.value = 'fp8r';
  },
  'extra execution authority': (w) => {
    w.apiGraph.runtimeHints.retryPlan = [];
  },
  'loop authority': (w) => {
    w.apiGraph.loops = [{ hidden: true }];
  },
  'duplicate execution path': (w) => {
    w.apiGraph.paths[0].push('models');
  },
  'unknown consumer control': (w) => {
    w.apiGraph.nodes.denoise.params.custom_code = literal('ignored');
  },
  'scalar supplier replacing seed': (w) => {
    w.apiGraph.nodes.denoise.params.seed = wire('decode', 'width');
  },
  'wrong decoder port': (w) => {
    w.apiGraph.nodes.decode.params.width.sourceKey = 'width';
  },
  'wrong decoder receipt producer': (w) => {
    nativeRow(w, 'decode').fields.width.sourceNodeId = 'models';
  },
  'wrong consumed seed': (w) => {
    nativeRow(w, 'denoise').fields.seed.value = 42;
  },
  'missing consumed step': (w) => {
    delete nativeRow(w, 'denoise').fields.num_inference_steps;
  },
  'omitted consumed control': (w) => {
    nativeRow(w, 'denoise').omittedFields.seed = 'missing';
  },
  'truncated native receipt': (w) => {
    w.context.executedOutput.resolvedExecutionInputs.truncated = true;
  },
  'uncaptured node': (w) => {
    w.context.executedOutput.resolvedExecutionInputs.uncapturedNodeIds = ['denoise'];
  },
  'ambiguous native inputs': (w) => {
    w.context.executedOutput.resolvedExecutionInputs.ambiguousFields = ['seed'];
  },
  'contradictory summary': (w) => {
    w.context.executedOutput.resolvedExecutionInputs.summary = { seed: 456 };
  },
  'wrong input byte identity': (w) => {
    w.context.inputArtifacts[0].contentHash = 'sha256:bytes:' + '0'.repeat(64);
  },
  'fabricated adapter availability': (w) => {
    nativeRow(w, 'models').appliedAdapters = { schemaVersion: 1, status: 'unavailable', reason: 'owner-invalidated' };
  },
  'wrong delivered dimensions': (w) => {
    w.context.executedOutput.mediaItems[0].width = 16;
  },
};
for (const [name, mutate] of Object.entries(invalidContexts))
  test(`native image reader holds ${name}`, () => {
    const w = nativeImageWitness();
    mutate(w);
    assert.notEqual(executionPlanIdentity(w.apiGraph, w.context).plan.source, SOURCE);
  });

test('the connected decoder consumes its supplier, preserving a different inactive saved fallback', () => {
  const w = nativeImageWitness();
  w.apiGraph.nodes.decode.params.width.value = 17;
  const plan = executionPlanIdentity(w.apiGraph, w.context).plan;
  assert.equal(plan.source, SOURCE);
  assert(observedNativeModularImageProofMatches(plan, proofFor(w, plan)));
  assert.equal(w.apiGraph.nodes.decode.params.width.value, 17);
});

test('two-reference order is bound to the native input bodies and stitch contract', () => {
  const w = nativeImageWitness('multi_image_reference_edit');
  w.context.inputArtifacts.reverse();
  assert.notEqual(executionPlanIdentity(w.apiGraph, w.context).plan.source, SOURCE);
});

test('Auto layered observations reject an unrelated override, missing layer or fabricated history field', () => {
  for (const mutate of [
    (w) => {
      w.context.executionReceipt.runtimePreparation.workflowAuto.resolvedFields.denoise = { layers: 2 };
    },
    (w) => {
      w.context.executionReceipt.runtimePreparation.workflowAuto.appliedUpdates.push({ hidden: true });
    },
    (w) => {
      w.context.executedOutput.mediaItems.pop();
    },
    (w) => {
      nativeRow(w, 'denoise').fields.layers = { source: 'literal', value: 3 };
    },
    (w) => {
      w.apiGraph.runtimeHints.workflowAutoPlan.graphHash = 'stale';
    },
  ]) {
    const w = nativeImageWitness('layer_decomposition');
    mutate(w);
    assert.notEqual(executionPlanIdentity(w.apiGraph, w.context).plan.source, SOURCE);
  }
});

test('rehashed observations cannot switch the original model, source, input, image or claim level', () => {
  const w = nativeImageWitness(),
    plan = executionPlanIdentity(w.apiGraph, w.context).plan;
  for (const mutate of [
    (p) => {
      p.models.items[0].repoId = 'other/model';
    },
    (p) => {
      p.runtime.backendSource.fingerprint = 'sha256:backend-source-v1:' + '0'.repeat(64);
    },
    (p) => {
      p.inputs.items[0].contentHash = 'sha256:bytes:' + '0'.repeat(64);
    },
    (p) => {
      p.output.items[0].encodedSha256 = 'sha256:bytes:' + '0'.repeat(64);
    },
    (p) => {
      p.taskId = 'other-task';
    },
  ]) {
    const changed = structuredClone(proofFor(w, plan));
    mutate(changed);
    assert(!observedNativeModularImageProofMatches(plan, changed));
  }
  for (const mutate of [
    (p) => {
      p.resourceObservation.completeFieldAccountingClaimed = true;
    },
    (p) => {
      p.resourceObservation.hardwareQualificationClaimed = true;
    },
    (p) => {
      p.resourceObservation.adapterApplicationObserved = true;
    },
    (p) => {
      p.resourceObservation.extraAuthority = true;
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    assert.equal(observedNativeModularImageResourceId(changed), null);
  }
});
