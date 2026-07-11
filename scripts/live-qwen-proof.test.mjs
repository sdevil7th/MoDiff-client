import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import {
  compareTemplateLock,
  isAttributedTaskComplete,
  pipeChildLogs,
  proofArtifactFields,
  resolveLiveProofConfig,
} from './live-qwen-proof.mjs';
import {
  canonicalGraphIdentity,
  compareRunProvenance,
  createRunProvenance,
  executionPlanIdentity,
  modelSetIdentity,
  normalizeBackendRuntime,
  resolvedModelRepoFromOutput,
  resolvedModelReposFromOutput,
  selectInstalledModelIdentity,
} from './live-proof-provenance.mjs';

test('execution identity ignores admission-proof status while locking the actual resource plan', () => {
  const graph = {
    runtimeHints: {
      modelType: 'WanVACEPipeline',
      modelRepo: 'Wan-AI/Wan2.1-VACE-1.3B-diffusers',
      dtype: 'bfloat16',
      offloadMode: 'model_cpu',
      autoResourceCandidateId: 'wan-vace-1.3b',
      autoResourceProofStatus: 'declared_safe',
    },
  };
  const before = executionPlanIdentity(graph);
  const after = executionPlanIdentity({
    ...graph,
    runtimeHints: { ...graph.runtimeHints, autoResourceProofStatus: 'live_proven' },
  });

  assert.equal(before.hash, after.hash);
  assert.equal(before.plan.autoResourceProofStatus, undefined);
});

test('default live Qwen proof requests the locked template without diagnostic overrides', () => {
  const config = resolveLiveProofConfig({});

  assert.equal(config.proofMode, 'template');
  assert.equal(config.templateId, 'qwen_low_vram_product_concept');
  assert.deepEqual(config.applyOverrides, {});
  assert.equal(config.diagnosticOverrides, null);
  assert.equal(config.templateLockPreserved, true);
  assert.equal(config.exactnessStatus, 'unverified');
  assert.equal(config.exactProof, false);
});

test('live proof can select another installed Qwen text-to-image template explicitly', () => {
  const config = resolveLiveProofConfig({
    MODIFF_LIVE_PROOF_TEMPLATE_ID: 'qwen_low_vram_text_rendering',
  });

  assert.equal(config.templateId, 'qwen_low_vram_text_rendering');
  assert.equal(config.proofMode, 'template');
  assert.deepEqual(config.applyOverrides, {});
  assert.throws(() => resolveLiveProofConfig({ MODIFF_LIVE_PROOF_TEMPLATE_ID: '   ' }), /cannot be empty/i);
});

test('control-image proof records its required deterministic input separately from smoke overrides', () => {
  const config = resolveLiveProofConfig({
    MODIFF_LIVE_PROOF_TEMPLATE_ID: 'qwen_control_image_layout',
    MODIFF_LIVE_PROOF_CONTROL_IMAGE: 'images/qwen-carton-layout-control.png',
  });

  assert.deepEqual(config.applyOverrides, {
    controlImage: 'images/qwen-carton-layout-control.png',
  });
  assert.deepEqual(config.exactInputs, {
    controlImage: 'images/qwen-carton-layout-control.png',
  });
  assert.equal(config.diagnosticOverrides, null);
});

test('template proof compares the applied form against every locked setting', () => {
  const expected = { width: 1024, height: 768, steps: 50, prompt: 'Directed brief' };
  assert.deepEqual(compareTemplateLock({ ...expected }, expected), {
    matches: true,
    comparedFields: 4,
    mismatches: [],
  });
  assert.deepEqual(compareTemplateLock({ ...expected, height: 1024 }, expected), {
    matches: false,
    comparedFields: 4,
    mismatches: [{ field: 'height', expected: 768, actual: 1024 }],
  });
});

test('live proof waits for attributed media or graph completion after task completion', () => {
  assert.equal(isAttributedTaskComplete({ taskCompleted: true, graphCompleted: false, currentOutputCount: 0 }), false);
  assert.equal(isAttributedTaskComplete({ taskCompleted: true, graphCompleted: false, currentOutputCount: 1 }), true);
  assert.equal(isAttributedTaskComplete({ taskCompleted: true, graphCompleted: true, currentOutputCount: 0 }), true);
  assert.equal(isAttributedTaskComplete({ taskCompleted: false, graphCompleted: true, currentOutputCount: 1 }), false);
});

test('child stdout and stderr share one proof log without ending it prematurely', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const output = new PassThrough();
  let captured = '';
  output.on('data', (chunk) => {
    captured += chunk.toString('utf8');
  });

  pipeChildLogs(child, output, 'backend');
  child.stdout.end('stdout line\n');
  child.stderr.end('stderr line\n');
  await Promise.all([
    new Promise((resolve) => child.stdout.on('end', resolve)),
    new Promise((resolve) => child.stderr.on('end', resolve)),
  ]);
  const finished = new Promise((resolve) => output.on('end', resolve));
  child.emit('close', 1, null);
  await finished;

  assert.match(captured, /stdout line/);
  assert.match(captured, /stderr line/);
  assert.match(captured, /\[backend\] exited code=1 signal=null/);
});

test('generation overrides are rejected unless smoke mode is explicit', () => {
  assert.throws(
    () => resolveLiveProofConfig({ MODIFF_LIVE_PROOF_WIDTH: '512' }),
    /require MODIFF_LIVE_PROOF_MODE=smoke.*MODIFF_LIVE_PROOF_WIDTH/i,
  );
  assert.throws(
    () => resolveLiveProofConfig({ MODIFF_LIVE_PROOF_MODE: 'exact' }),
    /must be either "template" or "smoke"/i,
  );
});

test('smoke overrides are explicit and always recorded as non-exact', () => {
  const config = resolveLiveProofConfig({
    MODIFF_LIVE_PROOF_MODE: 'smoke',
    MODIFF_LIVE_PROOF_WIDTH: '640',
    MODIFF_LIVE_PROOF_HEIGHT: '384',
    MODIFF_LIVE_PROOF_STEPS: '6',
    MODIFF_LIVE_PROOF_SEED: '777',
    MODIFF_LIVE_PROOF_PROMPT: 'Diagnostic prompt',
    MODIFF_LIVE_PROOF_NEGATIVE_PROMPT: 'Diagnostic negative prompt',
  });

  assert.deepEqual(config.applyOverrides, {
    resourceMode: 'auto',
    width: 640,
    height: 384,
    steps: 6,
    randomSeed: false,
    seed: 777,
    prompt: 'Diagnostic prompt',
    negativePrompt: 'Diagnostic negative prompt',
  });
  assert.deepEqual(config.diagnosticOverrides, config.applyOverrides);
  assert.deepEqual(proofArtifactFields(config), {
    proofMode: 'smoke',
    templateId: 'qwen_low_vram_product_concept',
    diagnosticOverrides: config.applyOverrides,
    exactInputs: null,
    templateLockPreserved: false,
    exactnessStatus: 'non_exact',
    exactProof: false,
    exactnessReason:
      'Diagnostic smoke mode overrides locked template generation settings and cannot be presented as Exact proof.',
  });
});

function syntheticApiGraph(ids = ['loader-a', 'generate-a', 'preview-a']) {
  const [loaderId, generateId, previewId] = ids;
  return {
    sid: 'ephemeral-session',
    nodes: {
      [loaderId]: {
        module: 'modules.QwenImage',
        action: 'LoadPipeline',
        params: {
          model_id: { value: { source: 'hub', value: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit' } },
          dtype: { value: 'bfloat16' },
        },
      },
      [generateId]: {
        module: 'modules.QwenImage',
        action: 'Generate',
        params: {
          pipeline: { sourceId: loaderId, sourceKey: 'pipeline' },
          prompt: { value: 'Locked product brief' },
          width: { value: 1024 },
          height: { value: 768 },
          seed: { value: 5112 },
          num_inference_steps: { value: 50 },
        },
      },
      [previewId]: {
        module: 'modules.Image',
        action: 'Preview',
        params: {
          image: { sourceId: generateId, sourceKey: 'images' },
          preview: { display: 'ui_image', sourceKey: 'output' },
        },
      },
    },
    paths: [[loaderId, generateId, previewId]],
    deterministicMode: { enabled: true, strict: true, seed: 5112 },
    runtimeHints: {
      modelType: 'QwenImageModularPipeline',
      resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
      executionPath: 'direct-qwen-image',
      dtype: 'bfloat16',
      offloadMode: 'model_cpu',
      cudaMemoryFreeBytes: 12,
    },
  };
}

function syntheticRuntime(freeBytes = 12) {
  return {
    fingerprint: `sha256:volatile-${freeBytes}`,
    packages: {
      python: '3.12.11',
      diffusers: '0.39.0.dev0',
      transformers: '5.10.1',
      torch: '2.11.0+cu128',
    },
    torch: {
      cuda_available: true,
      cuda_device_count: 1,
      cuda_device_name: 'NVIDIA GeForce RTX 4080',
      cuda_device_total_memory_bytes: 17170956288,
      cuda_memory_total_bytes: 17170956288,
      cuda_memory_free_bytes: freeBytes,
      cuda_device_capability: '8.9',
    },
    work_dir: 'C:/MoDiff/data',
    data_dir: 'C:/MoDiff/data',
  };
}

const syntheticNodesPayload = {
  nodes: {
    'modules.QwenImage.LoadPipeline': {
      module: 'modules.QwenImage',
      action: 'LoadPipeline',
      type: 'custom',
      params: {
        model_id: { type: 'string', display: 'modelselect' },
        dtype: { type: 'string', default: 'bfloat16' },
      },
    },
    'modules.QwenImage.Generate': {
      module: 'modules.QwenImage',
      action: 'Generate',
      type: 'custom',
      params: {
        pipeline: { type: 'qwen_image_pipeline', display: 'input' },
        prompt: { type: 'text', display: 'textarea' },
        width: { type: 'int', default: 1024 },
        height: { type: 'int', default: 1024 },
        seed: { type: 'int', display: 'random' },
        num_inference_steps: { type: 'int', default: 50 },
      },
    },
    'modules.Image.Preview': {
      module: 'modules.Image',
      action: 'Preview',
      type: 'custom',
      params: { image: { type: 'image', display: 'input' } },
    },
  },
};

const syntheticModel = {
  repoId: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
  selectedRevision: 'f50b8c24fe21e9265509b15113b7cca82d0a4443',
  modelRevision: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit@f50b8c24fe21e9265509b15113b7cca82d0a4443',
  fingerprint: 'sha256:model-fingerprint',
  revisions: [{ hash: 'f50b8c24fe21e9265509b15113b7cca82d0a4443', size: 123, lastModified: null }],
};

function syntheticProvenance(overrides = {}) {
  const graph = overrides.apiGraph ?? syntheticApiGraph();
  return createRunProvenance({
    templateId: 'qwen_low_vram_product_concept',
    lockedSettings: { width: 1024, height: 768, steps: 50, seed: 5112 },
    promptSettingsHash: 'ps_locked',
    catalogTemplateLockHash: 'tpl_catalog',
    resolvedTemplateLockHash: 'tpl_resolved',
    apiGraph: graph,
    nodesPayload: syntheticNodesPayload,
    modelIdentity: overrides.modelIdentity ?? syntheticModel,
    modelIdentities: overrides.modelIdentities,
    inputArtifacts: overrides.inputArtifacts ?? [],
    runtimeFingerprint: overrides.runtimeFingerprint ?? syntheticRuntime(),
    deterministicMode: graph.deterministicMode,
    backendSource: { gitCommit: 'backend-commit', fingerprint: 'sha256:backend-source', files: [] },
    outputAnalysis: {
      analyses: [
        {
          width: overrides.width ?? 1024,
          height: overrides.height ?? 768,
          byteSize: 100,
          encodedSha256: 'sha256:encoded:test',
          decodedSha256: overrides.decodedSha256 ?? 'sha256:decoded-rgba:test',
        },
      ],
    },
    executedOutput: {
      mediaHash: 'sha256:bytes:test',
      mediaCollectionHash: 'sha256:collection:test',
      mediaItems: [{ mediaHash: 'sha256:bytes:test' }],
    },
    taskId: overrides.taskId ?? 'task-a',
    capturedAt: overrides.capturedAt ?? '2026-07-10T00:00:00.000Z',
  });
}

test('canonical graph identity ignores ephemeral node and session ids', () => {
  const left = canonicalGraphIdentity(syntheticApiGraph(['left-load', 'left-generate', 'left-preview']));
  const right = canonicalGraphIdentity(syntheticApiGraph(['right-load', 'right-generate', 'right-preview']));

  assert.equal(left.hash, right.hash);
  assert.deepEqual(left.canonicalGraph, right.canonicalGraph);

  const changed = syntheticApiGraph();
  changed.nodes['generate-a'].params.num_inference_steps.value = 40;
  assert.notEqual(left.hash, canonicalGraphIdentity(changed).hash);
});

test('canonical graph identity ignores previously rendered UI preview values', () => {
  const leftGraph = syntheticApiGraph();
  const rightGraph = syntheticApiGraph();
  leftGraph.nodes['preview-a'].params.preview.value = ['/cache/first/output.webp?t=1'];
  rightGraph.nodes['preview-a'].params.preview.value = ['/cache/second/output.webp?t=2'];

  const left = canonicalGraphIdentity(leftGraph);
  const right = canonicalGraphIdentity(rightGraph);

  assert.equal(left.hash, right.hash);
  assert.deepEqual(left.canonicalGraph, right.canonicalGraph);
  assert.equal(left.canonicalGraph.nodes[2].params.preview.value, undefined);
});

test('stable runtime lock excludes volatile free-memory observations', () => {
  const left = normalizeBackendRuntime(syntheticRuntime(12));
  const right = normalizeBackendRuntime(syntheticRuntime(9_999_999));

  assert.notEqual(left.reportedFingerprint, right.reportedFingerprint);
  assert.equal(left.lockFingerprint, right.lockFingerprint);
});

test('resolved model identity follows the graph artifact actually executed', () => {
  const output = { apiGraphSnapshot: syntheticApiGraph() };
  assert.equal(resolvedModelRepoFromOutput(output), 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit');

  const payload = {
    models: [
      { repoId: 'Qwen/Qwen-Image-2512', installed: true, selectedRevision: 'official', modelRevision: 'official' },
      { ...syntheticModel, installed: true },
    ],
  };
  assert.deepEqual(selectInstalledModelIdentity(payload, 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit'), syntheticModel);
});

test('multi-model graphs pin every executed loader and build an order-independent model set', () => {
  const graph = syntheticApiGraph();
  graph.nodes['control-loader'] = {
    module: 'modules.ModularDiffusers',
    action: 'AutoModelLoader',
    params: {
      model_id: { value: { source: 'hub', value: 'InstantX/Qwen-Image-ControlNet-Union' } },
    },
  };
  graph.paths = [['loader-a', 'control-loader', 'generate-a', 'preview-a']];
  assert.deepEqual(resolvedModelReposFromOutput({ apiGraphSnapshot: graph }), [
    'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
    'InstantX/Qwen-Image-ControlNet-Union',
  ]);

  const controlIdentity = {
    repoId: 'InstantX/Qwen-Image-ControlNet-Union',
    selectedRevision: 'control-commit',
    modelRevision: 'InstantX/Qwen-Image-ControlNet-Union@control-commit',
    fingerprint: 'sha256:control',
    revisions: [],
  };
  assert.deepEqual(
    modelSetIdentity([syntheticModel, controlIdentity]),
    modelSetIdentity([controlIdentity, syntheticModel]),
  );
  assert.equal(modelSetIdentity([syntheticModel, controlIdentity]).count, 2);
});

test('duplicate provenance compares graph, runtime, model, template, and decoded output identity', () => {
  const baseline = syntheticProvenance();
  const sameRun = syntheticProvenance({
    taskId: 'task-b',
    capturedAt: '2026-07-10T00:05:00.000Z',
    runtimeFingerprint: syntheticRuntime(9_999_999),
  });
  const comparison = compareRunProvenance(baseline, sameRun);

  assert.equal(comparison.matches, true);
  assert.equal(comparison.candidateExact, true);
  assert.equal(comparison.comparedFields, 25);

  const changedOutput = compareRunProvenance(
    baseline,
    syntheticProvenance({ decodedSha256: 'sha256:decoded-rgba:different', width: 768 }),
  );
  assert.equal(changedOutput.matches, false);
  assert.equal(changedOutput.candidateExact, false);
  assert.deepEqual(
    changedOutput.mismatches.map((item) => item.field),
    ['output.collectionHash', 'output.items.0.decodedSha256', 'output.items.0.width'],
  );
});

test('audio provenance validates sample-domain identity without fake image dimensions', () => {
  const makeAudio = (sampleRate = 48000) => {
    const graph = syntheticApiGraph();
    return createRunProvenance({
      templateId: 'ace_step_text_to_audio',
      lockedSettings: { audioDuration: 30, steps: 8, seed: 8301 },
      promptSettingsHash: 'ps_audio',
      catalogTemplateLockHash: 'tpl_audio_catalog',
      resolvedTemplateLockHash: 'tpl_audio_resolved',
      apiGraph: graph,
      nodesPayload: syntheticNodesPayload,
      modelIdentity: syntheticModel,
      runtimeFingerprint: syntheticRuntime(),
      deterministicMode: graph.deterministicMode,
      backendSource: { gitCommit: 'backend-commit', fingerprint: 'sha256:backend-source', files: [] },
      outputAnalysis: {
        analyses: [
          {
            mediaType: 'audio',
            sampleRate,
            channels: 2,
            durationSeconds: 30,
            byteSize: 5_760_044,
            encodedSha256: 'sha256:encoded-audio',
            decodedSha256: 'sha256:decoded-audio:test',
          },
        ],
      },
      executedOutput: { displayType: 'audio', mediaItems: [] },
      taskId: 'task-audio',
    });
  };

  const baseline = makeAudio();
  assert.deepEqual(baseline.blockers, []);
  assert.equal(baseline.width, null);
  assert.equal(baseline.sampleRate, 48000);
  assert.equal(compareRunProvenance(baseline, makeAudio()).candidateExact, true);
  assert.ok(
    compareRunProvenance(baseline, makeAudio(44100)).mismatches.some(
      (item) => item.field === 'output.items.0.sampleRate',
    ),
  );
});

test('duplicate provenance rejects changed deterministic input bytes', () => {
  const input = {
    role: 'control_image',
    path: 'images/control.png',
    contentHash: 'sha256:bytes:input-a',
    byteSize: 100,
  };
  const baseline = syntheticProvenance({ inputArtifacts: [input] });
  const same = syntheticProvenance({ inputArtifacts: [input], taskId: 'task-b' });
  assert.equal(compareRunProvenance(baseline, same).candidateExact, true);

  const changed = compareRunProvenance(
    baseline,
    syntheticProvenance({
      inputArtifacts: [{ ...input, contentHash: 'sha256:bytes:input-b' }],
    }),
  );
  assert.equal(changed.candidateExact, false);
  assert.ok(changed.mismatches.some((item) => item.field === 'inputs.hash'));
});
