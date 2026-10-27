import { appliedOrderCase, canonicalHookCase, legacyCreatorFactoryCases } from './canonical-provenance-fixtures.mjs';
import { canonicalJsonHash } from './canonical-json.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  backendSourceDriftBlocker,
  compareTemplateLock,
  isAttributedTaskComplete,
  pipeChildLogs,
  proofArtifactFields,
  resolveLiveProofConfig,
} from './live-qwen-proof.mjs';
import {
  backendSourceEvidence,
  backendSourceIdentity,
  canonicalGraphIdentity,
  compareRunProvenance,
  createRunProvenance,
  executionReceiptIdentity,
  executionPlanIdentity,
  modelSetIdentity,
  normalizeBackendRuntime,
  resolvedModelRepoFromOutput,
  resolvedModelReposFromOutput,
  selectBackendRuntimeFingerprintEvidence,
  selectInstalledModelIdentity,
  sha256Value,
  stableStringify,
  validateRunProvenance,
  validateAppliedAdapterProof,
} from './live-proof-provenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('optional native applied adapter proof locks exact order and distinguishes reuse without changing historical requirements', () => {
  const args = appliedOrderCase();
  const before = JSON.stringify(args);
  const proof = createRunProvenance(args);
  assert.deepEqual(proof.blockers, []);
  const application = validateAppliedAdapterProof(proof, { required: true }).owners[0].application;
  assert.deepEqual(
    application.adapters.map((item) => [item.adapterName, item.scale]),
    [
      ['protocol_0', 0],
      ['protocol_1', 1],
    ],
  );
  assert.equal(application.observation, 'activated');
  assert.equal(JSON.stringify(args), before);
  args.executedOutput.resolvedExecutionInputs.nodes[0].appliedAdapters.observation = 'reused';
  const reused = createRunProvenance(args);
  const observed = validateAppliedAdapterProof(reused, { required: true }).owners[0].application;
  assert.equal(observed.applicationId, application.applicationId);
  assert.equal(observed.stateSha256, application.stateSha256);
  assert.equal(observed.observation, 'reused');
  assert.notEqual(reused.adapterApplicationsHash, proof.adapterApplicationsHash);
  const historical = appliedOrderCase();
  delete historical.executedOutput.resolvedExecutionInputs;
  const old = createRunProvenance(historical);
  assert.deepEqual(old.blockers, []);
  assert.equal(old.adapterApplications, undefined);
  assert.equal(validateAppliedAdapterProof(old), null);
  assert.throws(
    () => validateAppliedAdapterProof(old, { required: true }),
    /Original applied adapter order evidence is required/,
  );
  const unavailable = appliedOrderCase();
  unavailable.executedOutput.resolvedExecutionInputs.nodes[0].appliedAdapters = {
    schemaVersion: 1,
    status: 'unavailable',
    reason: 'unobserved-application',
  };
  const incomplete = createRunProvenance(unavailable);
  assert.deepEqual(incomplete.blockers, []);
  assert.throws(() => validateAppliedAdapterProof(incomplete, { required: true }), /unavailable/);
});

test('applied adapter proof rejects valid-digest order, scale, artifact and owner forgeries', () => {
  const mutations = {
    order: (args, app) => {
      app.adapters.reverse();
    },
    scale: (args, app) => {
      app.adapters[0].scale = 1;
    },
    artifact: (args, app) => {
      app.adapters[0].artifact.sha256 = 'c'.repeat(64);
    },
    revision: (args, app) => {
      app.adapters[0].artifact.revision = 'c'.repeat(40);
    },
    scheduler: (args, app) => {
      app.adapters[0].scheduler = { className: 'Unknown', configSha256: `sha256:${'a'.repeat(64)}` };
    },
    owner: (args) => {
      args.executedOutput.resolvedExecutionInputs.nodes[0].nodeId = 'adapter-0';
    },
    task: (args) => {
      args.executionReceipt.task_id = 'other';
    },
    'missing native version': (args) => {
      delete args.executedOutput.resolvedExecutionInputs.schemaVersion;
    },
    'unknown native version': (args) => {
      args.executedOutput.resolvedExecutionInputs.schemaVersion = 2;
    },
    snapshot: (args) => {
      args.executedOutput.apiGraphSnapshot.nodes['adapter-0'].params.scale.value = 0.5;
    },
    attempt: (args) => {
      args.executedOutput.attemptIndex = 1;
    },
    model: (args) => {
      args.modelIdentities[0].selectedRevision = 'c'.repeat(40);
    },
    duplicate: (args, app) => {
      app.adapters[1].adapterName = app.adapters[0].adapterName;
    },
    unknown: (args, app) => {
      app.path = '/private';
    },
    detached: (args) => {
      args.apiGraph.nodes.loader.params.lora_list.sourceId = 'adapter-0';
    },
    unexecuted: (args) => {
      args.apiGraph.paths[0] = ['loader', 'preview'];
    },
    cycle: (args) => {
      args.apiGraph.nodes['adapter-0'].params.previous_loras = { sourceId: 'adapter-1', sourceKey: 'lora' };
    },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const args = appliedOrderCase();
    const app = args.executedOutput.resolvedExecutionInputs.nodes[0].appliedAdapters;
    mutate(args, app);
    app.stateSha256 = `sha256:applied-adapters-v1:${canonicalJsonHash({ adapters: app.adapters })}`;
    assert.throws(
      () => {
        const proof = createRunProvenance(args);
        assert.deepEqual(proof.blockers, []);
        validateAppliedAdapterProof(proof, { required: true });
      },
      undefined,
      label,
    );
  }
  const forged = createRunProvenance(appliedOrderCase());
  forged.adapterApplications.owners[0].application.observation = 'reused';
  assert.ok(validateRunProvenance(forged).some((blocker) => /adapter/i.test(blocker)));
});

test('optional applied observations do not impose explicit order-case requirements on existing template proofs', () => {
  const args = appliedOrderCase();
  // Existing generated adapter names are a supported loader behavior. The
  // observation remains retainable; the new strict literal-order case is held.
  args.apiGraph.nodes['adapter-0'].params.adapter_name.value = '';
  args.executedOutput.apiGraphSnapshot = structuredClone(args.apiGraph);
  const proof = createRunProvenance(args);
  assert.deepEqual(proof.blockers, []);
  assert.ok(validateAppliedAdapterProof(proof));
  assert.throws(() => validateAppliedAdapterProof(proof, { required: true }), /Generated adapter names/);
  const detached = appliedOrderCase();
  detached.apiGraph.nodes.preview.params.image = { value: 'unrelated' };
  detached.executedOutput.apiGraphSnapshot = structuredClone(detached.apiGraph);
  assert.ok(createRunProvenance(detached).blockers.some((blocker) => /detached/.test(blocker)));
});

test('backend Git identity accepts only its exact repository and linked worktree', () => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'modiff-exact-git-root-'));
  const repository = resolve(temporary, 'repository');
  const worktree = resolve(temporary, 'linked');
  const backend = resolve(ROOT, '../MoDiff');
  const python =
    process.env.MODIFF_BACKEND_PYTHON ||
    resolve(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  let linked = false;
  function git(...args) {
    const result = spawnSync('git', ['-c', 'core.hooksPath=', ...args], {
      cwd: repository,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  }
  function agreesWithWorker(root) {
    const observed = spawnSync(
      python,
      [
        '-I',
        '-B',
        '-c',
        'import json,sys; sys.path.insert(0,sys.argv[1]); from modiff.backend_source_identity import backend_source_identity; print(json.dumps(backend_source_identity(sys.argv[2])))',
        backend,
        root,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(observed.status, 0, observed.stderr || observed.error?.message);
    const worker = JSON.parse(observed.stdout);
    const client = backendSourceIdentity(root);
    assert.equal(worker.gitCommit, client.gitCommit);
    assert.equal(worker.fingerprint, client.fingerprint);
    return client;
  }
  try {
    mkdirSync(repository);
    writeFileSync(resolve(repository, 'main.py'), "print('identity')\n");
    writeFileSync(resolve(repository, 'pyproject.toml'), '[project]\nname = "identity"\n');
    git('init', '--template=');
    git('add', 'main.py', 'pyproject.toml');
    git(
      '-c',
      'user.name=MoDiff fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--no-gpg-sign',
      '-m',
      'source fixture',
    );
    const commit = git('rev-parse', 'HEAD');
    assert.equal(agreesWithWorker(repository).gitCommit, commit);
    git('worktree', 'add', '--detach', worktree, 'HEAD');
    linked = true;
    assert.equal(agreesWithWorker(worktree).gitCommit, commit);
    const copied = resolve(repository, 'copied-backend');
    mkdirSync(copied);
    for (const name of ['main.py', 'pyproject.toml'])
      writeFileSync(resolve(copied, name), readFileSync(resolve(repository, name)));
    assert.equal(agreesWithWorker(copied).gitCommit, null);
  } finally {
    if (linked) git('worktree', 'remove', '--force', worktree);
    assert.equal(dirname(temporary), resolve(tmpdir()));
    rmSync(temporary, { recursive: true, force: true });
  }
});

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

test('retained Expert execution identity is recovered only from agreeing executed Diffusers resource nodes', () => {
  const graph = retainedExpertGraph();
  const recovered = executionPlanIdentity(graph).plan;

  assert.equal(recovered.source, 'executed-expert-diffusers-graph-v1');
  assert.equal(recovered.modelType, 'QwenImageModularPipeline');
  assert.equal(recovered.modelRepo, 'Qwen/Qwen-Image-2512');
  assert.equal(recovered.pipelineClass, 'QwenImagePipeline');
  assert.equal(recovered.dtype, 'bfloat16');
  assert.equal(recovered.resourceMode, 'expert');
  assert.equal(recovered.quantizationMode, 'none');
  assert.equal(recovered.offloadMode, 'none');
  assert.equal(
    executionReceiptIdentity(
      { runtimeMeasurement: { elapsedSeconds: 444.7, peakAllocatedBytes: 58_395_649_536 } },
      recovered,
    ).resourceCandidateId,
    'manual-resource-v1:QwenImageModularPipeline|bfloat16|none|none',
  );

  const mismatchedForm = structuredClone(graph);
  mismatchedForm.runtimeHints.workflowSnapshot.studioForm.dtype = 'float16';
  assert.deepEqual(executionPlanIdentity(mismatchedForm).plan, {});

  const disconnectedRecipe = structuredClone(graph);
  disconnectedRecipe.nodes.loader.params.execution_recipe.sourceId = 'missing';
  assert.deepEqual(executionPlanIdentity(disconnectedRecipe).plan, {});

  const ambiguous = structuredClone(graph);
  ambiguous.nodes.loaderTwo = structuredClone(ambiguous.nodes.loader);
  ambiguous.paths[0].push('loaderTwo');
  assert.deepEqual(executionPlanIdentity(ambiguous).plan, {});
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

test('live proof rejects missing or changing backend source identity', () => {
  const stable = { fingerprint: 'sha256:backend-source:stable' };
  assert.equal(backendSourceDriftBlocker(stable, stable), null);
  assert.match(
    backendSourceDriftBlocker(stable, { fingerprint: 'sha256:backend-source:changed' }),
    /changed while the live proof was running/,
  );
  assert.match(backendSourceDriftBlocker(stable, null), /could not be captured/);
});

test('backend source identity orders normalized paths before hashing shared directory prefixes', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'modiff-source-identity-'));
  const sources = [
    ['main.py', "print('identity')\n"],
    ['pyproject.toml', '[project]\nname = "identity"\n'],
    ['modules/ImageFilters/main.py', 'FILTER = 1\n'],
    ['modules/ImageOperations/main.py', 'OPERATION = 1\n'],
    ['modules/Image/main.py', 'IMAGE = 1\n'],
    ['modules/VideoColor/main.py', 'COLOR = 1\n'],
    ['modules/VideoConditioning/main.py', 'CONDITIONING = 1\n'],
    ['modules/Video/main.py', 'VIDEO = 1\n'],
  ];
  try {
    for (const [relativePath, contents] of sources) {
      const target = resolve(root, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents, 'utf8');
    }
    const expectedFiles = [...sources]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([relativePath, contents]) => ({
        path: relativePath,
        sha256: createHash('sha256').update(contents).digest('hex'),
      }));
    const identity = backendSourceIdentity(root);
    assert.equal(identity.gitCommit, null);
    assert.deepEqual(identity.files, expectedFiles);
    assert.equal(
      identity.fingerprint,
      sha256Value('backend-source-v1', {
        files: expectedFiles,
        gitCommit: null,
      }),
    );

    writeFileSync(resolve(root, 'modules/Image/main.py'), 'IMAGE = 2\n', 'utf8');
    assert.notEqual(backendSourceIdentity(root).fingerprint, identity.fingerprint);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source evidence binds both filesystem snapshots to the executing worker startup claim', () => {
  const sourceFiles = [{ path: 'main.py', sha256: 'c'.repeat(64) }];
  const source = {
    gitCommit: 'a'.repeat(40),
    fingerprint: sha256Value('backend-source-v1', { gitCommit: 'a'.repeat(40), files: sourceFiles }),
    files: sourceFiles,
  };
  const runtimeFingerprint = {
    backendSource: {
      schemaVersion: 1,
      claim: 'process_start_backend_source_identity',
      gitCommit: source.gitCommit,
      fingerprint: source.fingerprint,
      fileCount: 1,
      capturedAt: '2026-09-02T10:00:00Z',
    },
  };

  const exact = backendSourceEvidence({ before: source, after: structuredClone(source), runtimeFingerprint });
  assert.deepEqual(exact.identity, source);
  assert.deepEqual(exact.blockers, []);

  const staleWorker = structuredClone(runtimeFingerprint);
  staleWorker.backendSource.fingerprint = `sha256:backend-source-v1:${'d'.repeat(64)}`;
  const stale = backendSourceEvidence({
    before: source,
    after: structuredClone(source),
    runtimeFingerprint: staleWorker,
  });
  assert.equal(stale.identity, null);
  assert.match(stale.blockers.join(' '), /worker loaded a different backend source identity/u);

  const changedAfter = structuredClone(source);
  changedAfter.fingerprint = `sha256:backend-source-v1:${'e'.repeat(64)}`;
  assert.match(
    backendSourceEvidence({ before: source, after: changedAfter, runtimeFingerprint }).blockers.join(' '),
    /source files changed/u,
  );
  assert.match(
    backendSourceEvidence({ before: source, after: source, runtimeFingerprint: null }).blockers.join(' '),
    /did not emit a valid process-start/u,
  );

  const corruptedInventory = structuredClone(source);
  corruptedInventory.files[0].sha256 = 'f'.repeat(64);
  assert.match(
    backendSourceEvidence({ before: corruptedInventory, after: source, runtimeFingerprint }).blockers.join(' '),
    /fingerprint does not match its retained file inventory/u,
  );
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

test('live proof owns a stable non-HMR frontend unless reuse is explicit', () => {
  const source = readFileSync(resolve(ROOT, 'scripts', 'live-qwen-proof.mjs'), 'utf8');
  assert.match(source, /MODIFF_LIVE_FRONTEND_PORT \|\| 5193/);
  assert.match(source, /MODIFF_GALLERY_STABLE: '1'/);
  assert.match(source, /MODIFF_LIVE_FRONTEND_REUSE === '1'/);
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
        module: 'modules.DiffusersImage',
        action: 'LoadPipeline',
        params: {
          model_id: { value: { source: 'hub', value: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit' } },
          dtype: { value: 'bfloat16' },
        },
      },
      [generateId]: {
        module: 'modules.DiffusersImage',
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
      executionPath: 'direct-diffusers-image',
      autoResourceCandidateId: 'qwen-low-vram-bnb4-model-offload',
      dtype: 'bfloat16',
      offloadMode: 'model_cpu',
      cudaMemoryFreeBytes: 12,
    },
  };
}

const syntheticBackendSourceFiles = [{ path: 'main.py', sha256: 'c'.repeat(64) }];
const syntheticBackendSource = {
  gitCommit: 'a'.repeat(40),
  fingerprint: sha256Value('backend-source-v1', {
    gitCommit: 'a'.repeat(40),
    files: syntheticBackendSourceFiles,
  }),
  files: syntheticBackendSourceFiles,
};

function syntheticRuntime(freeBytes = 12) {
  return {
    fingerprint: `sha256:volatile-${freeBytes}`,
    backendSource: {
      schemaVersion: 1,
      claim: 'process_start_backend_source_identity',
      gitCommit: syntheticBackendSource.gitCommit,
      fingerprint: syntheticBackendSource.fingerprint,
      fileCount: syntheticBackendSource.files.length,
      capturedAt: '2026-09-02T10:00:00Z',
    },
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

function retainedExpertGraph() {
  const quant = 'quant';
  const recipe = 'recipe';
  const loader = 'loader';
  return {
    nodes: {
      [quant]: {
        module: 'modules.DiffusersRuntime',
        action: 'PipelineQuantizationConfigV2',
        params: {
          backend: { value: 'none' },
          components: { value: ['transformer'] },
          dtype: { value: 'bfloat16' },
        },
      },
      [recipe]: {
        module: 'modules.DiffusersRuntime',
        action: 'DiffusersExecutionRecipe',
        params: {
          quantization_config: { sourceId: quant, sourceKey: 'quantization_config' },
          device: { value: 'cuda:0' },
          device_map: { value: 'none' },
          offload_mode: { value: 'none' },
          attention_backend: { value: 'auto' },
          regional_compile: { value: false },
          denoiser_cache: { value: 'none' },
          channels_last: { value: false },
          layerwise_casting: { value: false },
        },
      },
      [loader]: {
        module: 'modules.DiffusersImage',
        action: 'LoadPipeline',
        params: {
          model_id: { value: { source: 'hub', value: 'Qwen/Qwen-Image-2512' } },
          pipeline_class: { value: 'QwenImagePipeline' },
          dtype: { value: 'bfloat16' },
          device: { value: 'cuda:0' },
          quantization_mode: { value: 'none' },
          quantized_components: { value: [] },
          execution_recipe: { sourceId: recipe, sourceKey: 'execution_recipe' },
          device_map: { value: 'none' },
          auto_offload: { value: false },
          offload_mode: { value: 'none' },
        },
      },
    },
    paths: [[quant, recipe, loader]],
    runtimeHints: {
      clientRunId: 'retained-run',
      workflowSnapshot: {
        studioForm: {
          modelType: 'QwenImageModularPipeline',
          resourceMode: 'expert',
          dtype: 'bfloat16',
          quantizationMode: 'none',
          offloadMode: 'none',
          autoOffload: false,
          device: 'cuda:0',
        },
        studioGraphBinding: { modelType: 'QwenImageModularPipeline' },
      },
    },
  };
}

const syntheticNodesPayload = {
  nodes: {
    'modules.DiffusersImage.LoadPipeline': {
      module: 'modules.DiffusersImage',
      action: 'LoadPipeline',
      type: 'custom',
      params: {
        model_id: { type: 'string', display: 'modelselect' },
        dtype: { type: 'string', default: 'bfloat16' },
      },
    },
    'modules.DiffusersImage.Generate': {
      module: 'modules.DiffusersImage',
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
    backendSource: syntheticBackendSource,
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
    executionReceipt:
      overrides.executionReceipt === undefined
        ? {
            runtimeMeasurement: {
              elapsedSeconds: 12.5,
              peakAllocatedBytes: 8_589_934_592,
            },
          }
        : overrides.executionReceipt,
    taskId: overrides.taskId ?? 'task-a',
    expectedOutput: overrides.expectedOutput ?? { width: 1024, height: 768 },
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

test('stable runtime lock uses applied deterministic settings over a stale hardware snapshot', () => {
  const stale = syntheticRuntime(12);
  stale.torch.cudnn_deterministic = false;
  stale.torch.deterministic_algorithms = false;
  const fresh = syntheticRuntime(12);
  fresh.torch.cudnn_deterministic = true;
  fresh.torch.deterministic_algorithms = true;
  const deterministicMode = {
    enabled: true,
    settings: {
      cudnn_benchmark: false,
      cudnn_deterministic: true,
      torch_deterministic_algorithms: true,
    },
  };

  assert.equal(
    normalizeBackendRuntime(stale, deterministicMode).lockFingerprint,
    normalizeBackendRuntime(fresh, deterministicMode).lockFingerprint,
  );
});

test('runtime evidence keeps the complete graph-completion payload over compact queue fingerprints', () => {
  const completion = syntheticRuntime(9_999_999);
  const earlier = syntheticRuntime(12);
  const selected = selectBackendRuntimeFingerprintEvidence([completion, earlier, completion.fingerprint]);

  assert.equal(selected, completion);
  assert.equal(normalizeBackendRuntime(selected).lockFingerprint, normalizeBackendRuntime(earlier).lockFingerprint);
  assert.equal(selectBackendRuntimeFingerprintEvidence([completion.fingerprint]), null);
  assert.equal(selectBackendRuntimeFingerprintEvidence([completion, 'sha256:unrelated']), null);

  const changedRuntime = syntheticRuntime(12);
  changedRuntime.packages.diffusers = '0.40.0.dev0';
  assert.equal(selectBackendRuntimeFingerprintEvidence([completion, changedRuntime]), null);
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

test('composite pipeline dependencies are included in the executed model set', () => {
  const graph = syntheticApiGraph();
  graph.runtimeHints.modelDependencies = [{ id: 'redux-base', kind: 'base', repo: 'black-forest-labs/FLUX.1-dev' }];
  assert.deepEqual(resolvedModelReposFromOutput({ apiGraphSnapshot: graph }), [
    'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
    'black-forest-labs/FLUX.1-dev',
  ]);
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

  const missingWorkerAttestation = structuredClone(baseline);
  delete missingWorkerAttestation.runtime.backendSourceAttestation;
  assert.match(validateRunProvenance(missingWorkerAttestation).join(' '), /backendSourceAttestation/u);

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
      backendSource: syntheticBackendSource,
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
      executionReceipt: {
        runtimeMeasurement: {
          elapsedSeconds: 30,
          peakAllocatedBytes: 4_294_967_296,
        },
      },
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

test('qualification provenance records the applied candidate, duration, and peak memory', () => {
  const provenance = syntheticProvenance();
  assert.equal(provenance.schemaVersion, 2);
  assert.equal(provenance.execution.resourceCandidateId, 'qwen-low-vram-bnb4-model-offload');
  assert.equal(provenance.execution.elapsedSeconds, 12.5);
  assert.equal(provenance.execution.peakMemoryBytes, 8_589_934_592);
  assert.deepEqual(provenance.blockers, []);

  const manualGraph = syntheticApiGraph();
  delete manualGraph.runtimeHints.autoResourceCandidateId;
  const manualProvenance = syntheticProvenance({ apiGraph: manualGraph });
  assert.equal(
    manualProvenance.execution.resourceCandidateId,
    'manual-resource-v1:QwenImageModularPipeline|bfloat16|model_cpu|none',
  );
  assert.deepEqual(manualProvenance.blockers, []);

  const missingMeasurement = syntheticProvenance({
    executionReceipt: null,
  });
  assert.ok(missingMeasurement.blockers.some((item) => item.includes('execution.peakMemoryBytes')));
});

test('qualification provenance rejects output dimensions that violate the template contract', () => {
  const provenance = syntheticProvenance({ width: 1328, height: 1328 });
  assert.ok(
    provenance.blockers.some((item) =>
      item.includes('output.items.0.width does not match the template contract: expected 1024, got 1328'),
    ),
  );
  assert.ok(
    provenance.blockers.some((item) =>
      item.includes('output.items.0.height does not match the template contract: expected 768, got 1328'),
    ),
  );
});

test('canonical factory hook derives the actual DDIM owner without runtime hints', () => {
  const args = canonicalHookCase();
  const before = JSON.stringify(args);
  const proof = createRunProvenance(args);
  assert.equal(proof.graph.executionPlan.source, 'executed-canonical-accounting-v1');
  assert.equal(proof.graph.executionPlan.modelType, 'DDIMPipeline');
  assert.equal(proof.graph.executionPlan.device, 'cuda:0');
  assert.equal(proof.graph.executionPlan.deviceMap, 'cuda');
  assert.equal(proof.execution.resourceCandidateId, 'manual-resource-v1:DDIMPipeline|float32|none|none');
  assert.equal(proof.taskId, args.executionReceipt.task_id);
  assert.deepEqual(proof.blockers, []);
  assert.equal(args.apiGraph.runtimeHints, undefined);
  assert.equal(JSON.stringify(args), before);
});

test('canonical hook rejects detached task, output, accounting and model evidence', () => {
  const mutations = {
    'wrong factory task': (args) => {
      args.taskId = 'other';
    },
    'wrong raw task': (args) => {
      args.canonicalAccountingProof.run.task.task_id = 'other';
    },
    'failed task': (args) => {
      args.executionReceipt.status = 'failed';
    },
    retry: (args) => {
      args.executionReceipt.attempt_index = 1;
    },
    'different measured task': (args) => {
      args.executionReceipt = { ...args.executionReceipt, completed_at: 102 };
    },
    'contradictory Expert candidate': (args) => {
      args.executionReceipt.resourceCandidateId = 'auto-candidate';
    },
    'invented task hints': (args) => {
      args.executionReceipt.runtimeHints = { autoResourceCandidateId: 'invented' };
    },
    'output task': (args) => {
      args.executedOutput.taskId = 'other';
    },
    'output attempt': (args) => {
      args.executedOutput.attemptIndex = 1;
    },
    'wrong workflow': (args) => {
      args.canonicalAccountingProof.run.workflow_id = 'other';
    },
    'missing raw output': (args) => {
      args.canonicalAccountingProof.run.outputs = [];
    },
    'duplicate raw output': (args) => {
      args.canonicalAccountingProof.run.outputs.push(structuredClone(args.executedOutput));
    },
    'detached output receipt': (args) => {
      args.canonicalAccountingProof.run.outputs = [structuredClone(args.executedOutput)];
      args.executedOutput.resolvedExecutionInputs.nodes[0].fieldAccounting.complete = false;
    },
    'consumed task': (args) => {
      args.executedOutput.resolvedExecutionInputs.taskId = 'other';
    },
    'consumed attempt': (args) => {
      args.executedOutput.resolvedExecutionInputs.attemptIndex = 1;
    },
    'consumed output owner': (args) => {
      args.executedOutput.nodeId = 'node-04';
    },
    'untrusted changed graph': (args) => {
      args.canonicalAccountingProof.expectedApiGraph.nodes['node-04'].params.seed.value = 43;
    },
    'caller plan': (args) => {
      args.canonicalAccountingProof.plan = { device: 'cpu:0' };
    },
    'missing accounting': (args) => {
      delete args.executedOutput.resolvedExecutionInputs.nodes[0].fieldAccounting;
    },
    'wrong effective control': (args) => {
      args.executedOutput.resolvedExecutionInputs.nodes.find(
        (row) => row.action === 'LoadPipeline',
      ).fieldAccounting.fields.device.value = 'cpu:0';
    },
    'wrong installed model': (args) => {
      args.modelIdentities[0].selectedRevision = 'a'.repeat(40);
    },
    'different runtime': (args) => {
      args.runtimeFingerprint = { ...args.runtimeFingerprint, fingerprint: 'other' };
    },
    'missing duration': (args) => {
      delete args.executionReceipt.completed_at;
    },
    'wrong completion time': (args) => {
      args.capturedAt = '2026-10-27T00:00:00.000Z';
    },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const args = canonicalHookCase();
    mutate(args);
    assert.throws(() => createRunProvenance(args), undefined, label);
  }
});

test('default factory output remains byte identical for all ten grouped and ordinary FLUX3 creators', async () => {
  const expected = JSON.parse(
    readFileSync(new URL('../tests/fixtures/legacy-provenance-factory.v1.json', import.meta.url), 'utf8'),
  );
  const observed = [];
  for (const { id, args } of await legacyCreatorFactoryCases()) {
    assert.equal(Object.hasOwn(args, 'canonicalAccountingProof'), false);
    const bytes = Buffer.from(stableStringify(createRunProvenance(args)));
    observed.push({ id, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  assert.deepEqual(observed, expected.vectors);
});
