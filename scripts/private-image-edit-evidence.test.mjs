import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalJsonHash } from './canonical-json.mjs';
import { validateLateNativeImageVariantRun, validateNativeVariantRun } from './native-variant-run-evidence.mjs';
import { readCanonicalWorkflowEvidence } from './release-contract-core.mjs';
import {
  bindPrivateImageEditGraph,
  readPrivateImageEditEvidence,
  validatePrivateImageEditRuntimePlatform,
  verifyRetainedPngUpload,
} from './private-image-edit-evidence.mjs';

function archivedImage() {
  const target = { task: 'edit_image', modelType: 'LatentConsistencyModelPipeline' };
  const formSnapshot = { ...target, mode: target.task, resourceMode: 'expert' };
  const graphSnapshot = { nodes: [], edges: [] };
  const workflowSnapshot = { ...graphSnapshot, studioForm: formSnapshot };
  const hints = {
    clientRunId: 'client-run',
    runInputHash: 'run-input',
    workflowTabId: 'workflow',
    workflowCanvasEpoch: 2,
    workflowTitle: 'Private image test',
    workflowSnapshot,
  };
  const sid = 'native-session';
  const taskId = 'native-task';
  const apiGraphSnapshot = { sid, nodes: {}, paths: [], runtimeHints: hints };
  const item = { displayType: 'image', backendPath: '@data/studio/outputs/test.webp', byteSize: 10 };
  const earlyMedia = [{ ...item, durationSeconds: null }];
  const mediaItems = [{ ...item, label: 'Item 1' }];
  const backendIdentity = { source: 'backend-record', backendExecutionId: taskId, mediaHash: 'native-image-sha' };
  const runtimeFingerprint = { fingerprint: 'private-runtime' };
  const runtimeMeasurement = { elapsedSeconds: 1 };
  const runtimePreparation = null;
  const shared = {
    taskId,
    sid,
    id: 'native-image',
    attemptIndex: 0,
    clientRunId: hints.clientRunId,
    runInputHash: hints.runInputHash,
    workflowTabId: hints.workflowTabId,
    nodeId: 'preview',
    fieldKey: 'preview',
    displayType: 'image',
    formSnapshot,
    graphSnapshot,
    resolvedExecutionInputs: {},
    mediaHash: backendIdentity.mediaHash,
    mediaCollectionHash: 'native-collection-sha',
  };
  const output = {
    ...shared,
    apiGraphSnapshot,
    mediaItems,
    backendProvenance: { ...backendIdentity, mediaItems, capturedAt: 200, exactTemplateCompatible: false },
  };
  const early = {
    ...shared,
    mediaItems: earlyMedia,
    backendProvenance: { ...backendIdentity, mediaItems: earlyMedia, capturedAt: 100 },
  };
  const context = {
    client_run_id: hints.clientRunId,
    run_input_hash: hints.runInputHash,
    workflow_tab_id: hints.workflowTabId,
    workflow_canvas_epoch: hints.workflowCanvasEpoch,
  };
  const run = {
    task: {
      task_id: taskId,
      sid,
      status: 'completed',
      attempt_index: 0,
      resourceCandidateId: null,
      started_at: 100,
      completed_at: 200,
      ...context,
      runtimeFingerprint,
      runtimeMeasurement,
      runtimePreparation,
      workflow_snapshot: workflowSnapshot,
    },
    workflow_id: hints.workflowTabId,
    workflow_title: hints.workflowTitle,
    workflow_snapshot: workflowSnapshot,
    outputs: [early],
  };
  return {
    target,
    displayType: 'image',
    outputNodeId: 'preview',
    run,
    creator: { manifest: { packageType: 'modiff-workflow-share' }, metadata: { studio: formSnapshot } },
    outputPackage: {
      manifest: { packageType: 'modiff-output-package' },
      apiGraph: apiGraphSnapshot,
      graph: graphSnapshot,
      latestOutput: structuredClone(output),
    },
    graphCompleted: {
      type: 'graph_completed',
      task_id: taskId,
      sid,
      ...context,
      deterministicMode: null,
      resourceRetryHistory: [],
      runtimeBudget: { applied: false },
      runtimeFingerprint,
      runtimeMeasurement,
      runtimePreparation,
    },
    graphRequest: apiGraphSnapshot,
    graphAcknowledgment: { error: false, sid, task_id: taskId },
    persistedOutput: output,
  };
}

test('strict output verification accepts a separately joined late native image snapshot', () => {
  const options = archivedImage();
  const before = structuredClone(options);
  assert.throws(() => validateNativeVariantRun(options), /native output apiGraphSnapshot differs/u);
  const { task, output } = validateLateNativeImageVariantRun(options);
  assert.equal(task.task_id, 'native-task');
  assert.equal(output.apiGraphSnapshot.sid, 'native-session');
  assert.deepEqual(options, before);
});

test('the late native image join rejects a changed task, capture, graph or output', () => {
  const scenarios = [
    [
      ({ persistedOutput }) => {
        persistedOutput.taskId = 'different-task';
      },
      /changed taskId/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.apiGraphSnapshot = undefined;
      },
      /snapshot is missing/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.apiGraphSnapshot = { ...persistedOutput.apiGraphSnapshot, sid: 'different' };
      },
      /apiGraphSnapshot differs/u,
    ],
    [
      ({ run }) => {
        run.outputs[0].resolvedExecutionInputs = { swapped: true };
      },
      /changed resolvedExecutionInputs/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.mediaItems[0].byteSize = 11;
      },
      /image identity changed/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.backendProvenance.backendExecutionId = 'stale-task';
      },
      /provenance identity changed/u,
    ],
    [
      ({ persistedOutput }) => {
        persistedOutput.backendProvenance.exactTemplateCompatible = true;
      },
      /false/u,
    ],
  ];
  for (const [mutate, error] of scenarios) {
    const options = archivedImage();
    mutate(options);
    assert.throws(() => validateLateNativeImageVariantRun(options), error);
  }
});

test('private direct image edit graph binds exactly one empty file and one empty prompt', () => {
  const expected = {
    sid: 'canonical',
    nodes: {
      quantization: { module: 'modules.DiffusersRuntime', action: 'PipelineQuantizationConfigV2', params: {} },
      recipe: { module: 'modules.DiffusersRuntime', action: 'DiffusersExecutionRecipe', params: {} },
      loader: { module: 'modules.DiffusersImage', action: 'LoadPipeline', params: {} },
      source: { module: 'modules.Image', action: 'Load', params: { file: { value: [], display: 'filebrowser' } } },
      edit: {
        module: 'modules.DiffusersImage',
        action: 'Edit',
        params: {
          prompt: { value: '' },
          strength: { value: 0.8 },
          image: { display: 'input', sourceId: 'source', sourceKey: 'image' },
        },
      },
      preview: { module: 'modules.Image', action: 'Preview', params: {} },
    },
    paths: [['quantization', 'recipe', 'loader', 'source', 'edit', 'preview']],
  };
  const input = { nodeId: 'source', field: 'file', sourceValue: 'source.webp' };
  const submitted = structuredClone(expected);
  submitted.nodes.source.params.file.value = [input.sourceValue];
  submitted.nodes.edit.params.prompt.value = 'A lake at dawn.';
  const invoke = () => bindPrivateImageEditGraph({ expected, submitted, input });
  assert.equal(invoke().prompt, 'A lake at dawn.');
  assert.deepEqual(expected.nodes.source.params.file.value, []);
  submitted.nodes.edit.params.strength.value = 0.7;
  assert.throws(invoke, /changed|differs outside/u);
  const strengthVariant = { original: 0.8, retained: 0.7 };
  const bindVariant = (variant = strengthVariant) =>
    bindPrivateImageEditGraph({ expected, submitted, input, strengthVariant: variant });
  assert.equal(bindVariant().edit.node.params.strength.value, 0.7);
  assert.equal(expected.nodes.edit.params.strength.value, 0.8);
  assert.throws(() => bindVariant({ ...strengthVariant, original: 0.5 }));
  submitted.nodes.edit.params.strength.value = 0.8;
  assert.throws(() => bindVariant(), /differs outside/u);
  const scoped = { ...input, sourceValue: '@data/images/source.webp' };
  submitted.nodes.source.params.file.value = [scoped.sourceValue];
  assert.equal(
    bindPrivateImageEditGraph({ expected, submitted, input: scoped, inputPathPrefix: '@data/images/' }).prompt,
    'A lake at dawn.',
  );
  for (const sourceValue of ['source.webp', '@data/videos/source.webp', '@data/images/../source.webp']) {
    submitted.nodes.source.params.file.value = [sourceValue];
    assert.throws(() =>
      bindPrivateImageEditGraph({
        expected,
        submitted,
        input: { ...scoped, sourceValue },
        inputPathPrefix: '@data/images/',
      }),
    );
  }
  submitted.nodes.source.params.file.value = [input.sourceValue];
  submitted.nodes.edit.params.image.sourceKey = 'mask';
  assert.throws(invoke, /differs outside/u);
  submitted.loops = [];
  assert.throws(invoke, /Unexpected evidence fields/u);
});

function assertPinnedPrivateEdit({ modelType, task = 'edit_image', graphPath, sourceTemplateId, repo, exactRevision }) {
  const makeOptions = (revision) => {
    const graph = {
      nodes: [
        {
          id: 'model',
          data: {
            module: 'modules.DiffusersImage',
            action: 'LoadPipeline',
            params: { model_id: { value: { source: 'hub', value: repo } }, revision: { value: revision } },
          },
        },
      ],
      edges: [],
    };
    const manifest = {
      id: modelType + ':' + task,
      modelType,
      mode: task,
      graphPath,
      graphHash: canonicalJsonHash(graph),
      sourceTemplateId,
      requiredArtifacts: [repo],
    };
    const authoring = {
      id: 'template-authoring:' + manifest.id,
      canonicalWorkflowId: manifest.id,
      modelType,
      mode: manifest.mode,
      canonicalGraph: { path: manifest.graphPath, sha256: manifest.graphHash },
      defaultsPlan: { sourceGraphSha256: manifest.graphHash },
      artifactPlan: { requiredArtifacts: [repo] },
      outputPlan: { mediaKinds: ['image'], minimumAssetCount: 1 },
    };
    return { manifest, graph, authoring, evidencePath: '' };
  };
  return Promise.all([
    assert.rejects(readPrivateImageEditEvidence(makeOptions(exactRevision)), { code: 'ENOENT' }),
    assert.rejects(readPrivateImageEditEvidence(makeOptions('0'.repeat(40))), /Private edit model pin differs/u),
  ]);
}

test('SDXL private Edit evidence requires the reviewed checkpoint before reading its descriptor', () =>
  assertPinnedPrivateEdit({
    modelType: 'StableDiffusionXLPipeline',
    graphPath: 'studio/stable-diffusion-xl-pipeline/edit-image.json',
    sourceTemplateId: 'task-template:sdxl-base:edit-image:v1',
    repo: 'stabilityai/stable-diffusion-xl-base-1.0',
    exactRevision: '462165984030d82259a11f4367a4eed129e94a7b',
  }));

test('SD1.5 private Edit evidence requires the reviewed checkpoint before reading its descriptor', () =>
  assertPinnedPrivateEdit({
    modelType: 'StableDiffusionPipeline',
    graphPath: 'studio/stable-diffusion-pipeline/edit-image.json',
    sourceTemplateId: 'task-template:sd15-base:edit-image:v1',
    repo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
    exactRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
  }));

test('only the scoped SD1.5 Edit and Inpaint routes accept the observed Windows CUDA runtime', () => {
  const sd15 = 'StableDiffusionPipeline:edit_image';
  const sdxl = 'StableDiffusionXLPipeline:edit_image';
  const windows = 'Windows-11-10.0.26300-SP0';
  const linux = 'Linux-7.0.0-38-generic-x86_64-with-glibc2.43';
  assert.doesNotThrow(() => validatePrivateImageEditRuntimePlatform(sd15, windows, 'cuda'));
  assert.doesNotThrow(() => validatePrivateImageEditRuntimePlatform(sd15, linux, 'rocm'));
  assert.throws(() => validatePrivateImageEditRuntimePlatform(sd15, windows, 'rocm'));
  assert.throws(() => validatePrivateImageEditRuntimePlatform(sd15, linux, 'cuda'));
  assert.throws(() => validatePrivateImageEditRuntimePlatform(sd15, 'Darwin-26.0', 'mps'));
  assert.doesNotThrow(() =>
    validatePrivateImageEditRuntimePlatform('StableDiffusionPipeline:inpaint', windows, 'cuda'),
  );
  assert.throws(() =>
    validatePrivateImageEditRuntimePlatform('StableDiffusionPipeline:control_inpaint', windows, 'cuda'),
  );
  assert.doesNotThrow(() => validatePrivateImageEditRuntimePlatform(sdxl, linux, 'rocm'));
  assert.throws(() => validatePrivateImageEditRuntimePlatform(sdxl, windows, 'cuda'));
});

test('SD1.5 masked evidence requires the reviewed checkpoint before reading its descriptor', () =>
  assertPinnedPrivateEdit({
    modelType: 'StableDiffusionPipeline',
    task: 'inpaint',
    graphPath: 'studio/stable-diffusion-pipeline/inpaint.json',
    sourceTemplateId: 'task-template:sd15-base:inpaint:v1',
    repo: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
    exactRevision: '451f4fe16113bff5a5d2269ed5ad43b0592e9a14',
  }));

const retainedMaskEvidence = process.env.MODIFF_SD15_INPAINT_EVIDENCE;
test(
  'saved Inpaint evidence binds two original PNG uploads to their distinct consumed ports',
  {
    skip: !retainedMaskEvidence,
  },
  async () => {
    const clientRoot = fileURLToPath(new URL('..', import.meta.url));
    const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '..', 'MoDiff'));
    const evidencePath = resolve(retainedMaskEvidence);
    const args = { clientRoot, backendRoot, workflowId: 'StableDiffusionPipeline:inpaint', evidencePath };
    const original = await readCanonicalWorkflowEvidence(args);
    const { receipt } = original;
    assert.equal(receipt.inputBinding.decodedImage.mode, 'RGB');
    assert.equal(receipt.maskBinding.decodedImage.mode, 'L');
    assert.notEqual(receipt.inputBinding.sha256, receipt.maskBinding.sha256);
    assert.ok(Object.values(receipt.qualificationClaims).every((flag) => flag === false));

    const root = mkdtempSync(join(tmpdir(), 'modiff-inpaint-evidence-'));
    try {
      for (const file of original.retainedFiles) {
        assert.equal(basename(file.path), file.path);
        copyFileSync(file.absolutePath, join(root, file.path));
      }
      const swapped = JSON.parse(original.descriptorBytes);
      [swapped.inputUpload, swapped.maskUpload] = [swapped.maskUpload, swapped.inputUpload];
      const changedPath = join(root, 'evidence.json');
      writeFileSync(changedPath, JSON.stringify(swapped));
      await assert.rejects(readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }));
      assert.deepEqual(readFileSync(evidencePath), original.descriptorBytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('retained native PNG upload binds an exact safe path, file bytes and decoded dimensions', () => {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0AMAAAAASUVORK5CYII=',
    'base64',
  );
  const sourceValue = '@data/images/study.png';
  const metadata = { width: 1, height: 1 };
  const upload = {
    error: false,
    path: sourceValue,
    media: {
      filename: 'study.png',
      extension: '.png',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      kind: 'image',
      mimeType: 'image/png',
      ...metadata,
      frames: 1,
    },
  };
  verifyRetainedPngUpload(upload, { sourceValue }, metadata, bytes);
  for (const bad of [
    { ...upload, path: '@data/images/other.png' },
    { ...upload, media: { ...upload.media, sha256: 'a'.repeat(64) } },
    { ...upload, media: { ...upload.media, width: 2 } },
    { ...upload, media: { ...upload.media, mimeType: 'image/webp' } },
  ]) {
    assert.throws(() => verifyRetainedPngUpload(bad, { sourceValue }, metadata, bytes));
  }
  const wrongMagic = Buffer.from(bytes);
  wrongMagic[0] = 0;
  const magicWitness = {
    ...upload,
    media: { ...upload.media, sha256: createHash('sha256').update(wrongMagic).digest('hex') },
  };
  assert.throws(() => verifyRetainedPngUpload(magicWitness, { sourceValue }, metadata, wrongMagic), /not PNG/u);
});
