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

test('server-retained images require the original Run exchange and matching backend records', () => {
  const options = archivedImage();
  const retainedServerOutput = structuredClone(options.run.outputs[0]);
  const retained = { ...options, outputPackage: undefined, retainedServerOutput };
  assert.deepEqual(validateNativeVariantRun(retained).output, retainedServerOutput);
  assert.throws(
    () => validateNativeVariantRun({ ...retained, graphRequest: undefined }),
    /requires the original Run exchange/u,
  );
  assert.throws(
    () =>
      validateNativeVariantRun({
        ...retained,
        graphAcknowledgment: { ...retained.graphAcknowledgment, task_id: 'stale' },
      }),
    assert.AssertionError,
  );
  options.run.outputs[0].mediaHash = 'unrelated-output';
  assert.throws(() => validateNativeVariantRun(retained), /Original native output mediaHash differs/u);
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

test('only the reviewed edit and masked routes accept the observed Windows CUDA runtime', () => {
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
  assert.doesNotThrow(() =>
    validatePrivateImageEditRuntimePlatform('StableDiffusionXLPipeline:inpaint', windows, 'cuda'),
  );
  assert.throws(() => validatePrivateImageEditRuntimePlatform('StableDiffusionXLPipeline:inpaint', windows, 'rocm'));
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

test('SDXL masked evidence requires the reviewed checkpoint before reading its descriptor', () =>
  assertPinnedPrivateEdit({
    modelType: 'StableDiffusionXLPipeline',
    task: 'inpaint',
    graphPath: 'studio/stable-diffusion-xl-pipeline/inpaint.json',
    sourceTemplateId: 'task-template:sdxl-base:inpaint:v1',
    repo: 'stabilityai/stable-diffusion-xl-base-1.0',
    exactRevision: '462165984030d82259a11f4367a4eed129e94a7b',
  }));

const retainedSdxlEvidence = process.env.MODIFF_SDXL_EDIT_NATIVE_PNG_EVIDENCE;
test(
  'saved SDXL edit binds the original PNG upload and consumed RGB input',
  { skip: !retainedSdxlEvidence },
  async () => {
    const clientRoot = fileURLToPath(new URL('..', import.meta.url));
    const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '..', 'MoDiff'));
    const evidencePath = resolve(retainedSdxlEvidence);
    const args = { clientRoot, backendRoot, workflowId: 'StableDiffusionXLPipeline:edit_image', evidencePath };
    const original = await readCanonicalWorkflowEvidence(args);
    const { receipt } = original;
    assert.equal(receipt.inputBinding.sha256, 'e75c20f0e8a74e283b996bf526e6ea74535ed24125ad97c2d92508d3435d7a87');
    assert.equal(receipt.inputBinding.decodedImage.mode, 'RGB');
    assert.ok(Object.values(receipt.qualificationClaims).every((flag) => flag === false));

    const root = mkdtempSync(join(tmpdir(), 'modiff-sdxl-edit-evidence-'));
    try {
      for (const file of original.retainedFiles) {
        assert.equal(basename(file.path), file.path);
        copyFileSync(file.absolutePath, join(root, file.path));
      }
      const descriptor = JSON.parse(original.descriptorBytes);
      const uploadPath = join(root, descriptor.inputUpload.path);
      const upload = JSON.parse(readFileSync(uploadPath, 'utf8'));
      upload.media.sha256 = '0'.repeat(64);
      const changedUpload = Buffer.from(JSON.stringify(upload));
      writeFileSync(uploadPath, changedUpload);
      descriptor.inputUpload.bytes = changedUpload.length;
      descriptor.inputUpload.sha256 = createHash('sha256').update(changedUpload).digest('hex');
      const changedPath = join(root, 'evidence.json');
      writeFileSync(changedPath, JSON.stringify(descriptor));
      await assert.rejects(readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

const retainedMaskEvidence = process.env.MODIFF_SD15_INPAINT_EVIDENCE;
const retainedDreamLiteEdit = process.env.MODIFF_DREAMLITE_MOBILE_PRIVATE_EVIDENCE;

test('DreamLite Mobile verifies its private saved edit and input bytes', { skip: !retainedDreamLiteEdit }, async () => {
  const clientRoot = fileURLToPath(new URL('..', import.meta.url));
  const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '..', 'MoDiff'));
  const { receipt } = await readCanonicalWorkflowEvidence({
    clientRoot,
    backendRoot,
    workflowId: 'DreamLiteMobilePipeline:edit_image',
    evidencePath: resolve(retainedDreamLiteEdit),
  });
  assert.equal(receipt.taskId, 'UkIOy4hkWvBa');
  assert.equal(receipt.inputBinding.sha256, 'b0c9f07333c2fc9a5de03f2b8f28d07bfaff162e38920d2f3bc70806be4be309');
  assert.ok(Object.values(receipt.qualificationClaims).every((value) => value === false));
});

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

for (const [workflowId, variable, hasMask, unobserved] of [
  ['ChromaInpaintPipeline:inpaint', 'MODIFF_SAVED_CHROMA_INPAINT_EVIDENCE', true, []],
  [
    'StableDiffusionXLInstructPix2PixPipeline:edit_image',
    'MODIFF_SAVED_PIX2PIX_EVIDENCE',
    false,
    ['image_guidance_scale'],
  ],
  [
    'StableDiffusionPAGPipeline:edit_image',
    'MODIFF_SAVED_PAG_EDIT_EVIDENCE',
    false,
    ['pag_scale', 'pag_adaptive_scale'],
  ],
  [
    'StableDiffusionPAGPipeline:inpaint',
    'MODIFF_SAVED_PAG_INPAINT_EVIDENCE',
    true,
    ['pag_scale', 'pag_adaptive_scale'],
  ],
  ['ZImageModularPipeline:edit_image', 'MODIFF_SAVED_ZIMAGE_EDIT_EVIDENCE', false, []],
  ['QwenImageEditPlusPipeline:edit_image', 'MODIFF_SAVED_QWEN_AMBER_EVIDENCE', false, []],
  ['QwenImageEditPipeline:edit_image', 'MODIFF_SAVED_QWEN_SLATE_EVIDENCE', false, []],
  ['QwenImageModularPipeline:inpaint', 'MODIFF_SAVED_QWEN_SCRATCH_EVIDENCE', true, []],
  ['FluxDevPipeline:inpaint', 'MODIFF_SAVED_FLUX_DEV_REPAIR_EVIDENCE', true, []],
  ['LongCatImageEditPipeline:edit_image', 'MODIFF_SAVED_LONGCAT_EDIT_EVIDENCE', false, []],
  ['QwenImageModularPipeline:edit_image', 'MODIFF_QWEN_BOOKSHOP_EDIT_EVIDENCE', false, []],
  ['ChromaImg2ImgPipeline:edit_image', 'MODIFF_CHROMA_LARCH_EDIT_EVIDENCE', false, []],
  ['DreamLitePipeline:edit_image', 'MODIFF_SAVED_DREAMLITE_COPPER_EDIT_EVIDENCE', false, []],
  ['JoyImageEditPipeline:edit_image', 'MODIFF_SAVED_JOY_BASE_EDIT_EVIDENCE', false, []],
  ['StableDiffusionXLPipeline:edit_image', 'MODIFF_SDXL_LINEN_EDIT_EVIDENCE', false, []],
  ['FluxDevPipeline:edit_image', 'MODIFF_SAVED_FLUX_DEV_TEAPOT_EVIDENCE', false, []],
  ['FluxKontextInpaintPipeline:inpaint', 'MODIFF_SAVED_KONTEXT_WINDOW_EVIDENCE', true, []],
  [
    'FluxKontextInpaintPipeline:outpaint',
    'MODIFF_SAVED_KONTEXT_PANORAMA_EVIDENCE',
    false,
    ['left', 'right', 'top', 'bottom', 'overlap', 'feather', 'fill_color'],
  ],
  [
    'ChromaInpaintPipeline:outpaint',
    'MODIFF_SAVED_CHROMA_PANORAMA_EVIDENCE',
    false,
    ['left', 'right', 'top', 'bottom', 'overlap', 'feather', 'fill_color'],
  ],
  [
    'StableDiffusionXLPAGPipeline:edit_image',
    'MODIFF_SAVED_SDXL_PAG_AMBER_EDIT_EVIDENCE',
    false,
    ['pag_scale', 'pag_adaptive_scale'],
  ],
  [
    'StableDiffusionXLPAGPipeline:edit_image',
    'MODIFF_SAVED_SDXL_PAG_GRAPHITE_EDIT_EVIDENCE',
    false,
    ['pag_scale', 'pag_adaptive_scale'],
  ],
  ['ZImageInpaintPipeline:inpaint', 'MODIFF_SAVED_ZIMAGE_REPAIR_EVIDENCE', true, []],
  ['Flux2KleinInpaintPipeline:inpaint', 'MODIFF_SAVED_FLUX_KLEIN_REPAIR_EVIDENCE', true, []],
  [
    'Flux2KleinInpaintPipeline:outpaint',
    'MODIFF_SAVED_FLUX_KLEIN_OUTPAINT_EVIDENCE',
    false,
    ['left', 'right', 'top', 'bottom', 'overlap', 'feather', 'fill_color'],
  ],
  [
    'ZImageInpaintPipeline:outpaint',
    'MODIFF_SAVED_ZIMAGE_OUTPAINT_EVIDENCE',
    false,
    ['left', 'right', 'top', 'bottom', 'overlap', 'feather', 'fill_color'],
  ],
  [
    'StableDiffusionXLPAGPipeline:inpaint',
    'MODIFF_SAVED_SDXL_PAG_REPAIR_EVIDENCE',
    true,
    ['pag_scale', 'pag_adaptive_scale'],
  ],
]) {
  const saved = process.env[variable];
  test(
    `${workflowId} retains the original source identity with disclosed sampler limits`,
    { skip: !saved },
    async () => {
      const clientRoot = fileURLToPath(new URL('..', import.meta.url));
      const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '..', 'MoDiff'));
      const evidencePath = resolve(saved);
      const args = { clientRoot, backendRoot, workflowId, evidencePath };
      const original = await readCanonicalWorkflowEvidence(args);
      const { receipt } = original;
      const hostFileWitness = workflowId === 'JoyImageEditPipeline:edit_image';
      const samplerSourceProjection = workflowId === 'StableDiffusionXLPipeline:edit_image';
      assert.equal(receipt.observationLimits.independentConsumerPixels, samplerSourceProjection);
      assert.equal(
        receipt.observationLimits.sourceByteWitness,
        hostFileWitness
          ? 'retained-host-file-with-native-load-and-typed-wire'
          : samplerSourceProjection
            ? 'native-load-consumer-and-upload'
            : 'native-load-and-upload-with-typed-wire',
      );
      if (hostFileWitness) assert.equal(receipt.observationLimits.originalUploadResponseObserved, false);
      assert.deepEqual(receipt.observationLimits.configuredUnobservedControls, unobserved);
      assert.equal(Boolean(receipt.maskBinding), hasMask);
      const root = mkdtempSync(join(tmpdir(), 'modiff-retained-edit-'));
      try {
        for (const file of original.retainedFiles) {
          assert.equal(basename(file.path), file.path);
          copyFileSync(file.absolutePath, join(root, file.path));
        }
        const descriptor = JSON.parse(original.descriptorBytes);
        const changedPath = join(root, 'evidence.json');
        if (variable === 'MODIFF_SAVED_SDXL_PAG_GRAPHITE_EDIT_EVIDENCE') {
          const altered = structuredClone(descriptor);
          const path = join(root, altered.graphRequest.path);
          const originalRequest = readFileSync(path);
          const graph = JSON.parse(originalRequest);
          const edit = Object.values(graph.nodes).find(({ action }) => action === 'Edit');
          assert.equal(edit.params.strength.value, 0.85);
          edit.params.strength.value = 0.8;
          const bytes = Buffer.from(JSON.stringify(graph));
          Object.assign(altered.graphRequest, {
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          });
          writeFileSync(path, bytes);
          writeFileSync(changedPath, JSON.stringify(altered));
          await assert.rejects(
            readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
            /outside its declared file, prompt and reviewed control variant/u,
          );
          writeFileSync(path, originalRequest);
        }
        if (receipt.observationLimits.fullSourceDecodeRecordObserved === false) {
          const changed = structuredClone(descriptor);
          const capturePath = join(root, changed.capture.path);
          const captureBytes = readFileSync(capturePath);
          const capture = JSON.parse(captureBytes);
          const nodesPath = join(root, capture.nodes.path);
          const nodesBytes = readFileSync(nodesPath);
          const replacement = Buffer.concat([nodesBytes, Buffer.from('\n')]);
          Object.assign(capture.nodes, {
            bytes: replacement.length,
            sha256: createHash('sha256').update(replacement).digest('hex'),
          });
          const changedCapture = Buffer.from(JSON.stringify(capture));
          Object.assign(changed.capture, {
            bytes: changedCapture.length,
            sha256: createHash('sha256').update(changedCapture).digest('hex'),
          });
          writeFileSync(nodesPath, replacement);
          writeFileSync(capturePath, changedCapture);
          writeFileSync(changedPath, JSON.stringify(changed));
          await assert.rejects(
            readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
            /node registry does not match the saved runtime source/u,
          );
          writeFileSync(nodesPath, nodesBytes);
          writeFileSync(capturePath, captureBytes);
        }
        if (hostFileWitness) {
          const changed = structuredClone(descriptor);
          const path = join(root, changed.hostInputFiles.path);
          const originalBytes = readFileSync(path);
          const witness = JSON.parse(originalBytes);
          witness.files[0].sha256 = 'a'.repeat(64);
          const bytes = Buffer.from(JSON.stringify(witness));
          Object.assign(changed.hostInputFiles, {
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          });
          writeFileSync(path, bytes);
          writeFileSync(changedPath, JSON.stringify(changed));
          await assert.rejects(
            readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
            /Original host inputs differ/u,
          );
          writeFileSync(path, originalBytes);
        }
        if (workflowId.endsWith(':outpaint')) {
          assert.equal(receipt.observationLimits.canvasSizeObserved, true);
          assert.equal(receipt.observationLimits.canvasPixelsObserved, false);
          assert.equal(receipt.observationLimits.derivedMaskPixelsObserved, false);
          assert.deepEqual(
            [receipt.decodedOutput.width, receipt.decodedOutput.height],
            [workflowId === 'ChromaInpaintPipeline:outpaint' ? 1024 : 1344, 768],
          );
          const altered = structuredClone(descriptor);
          const path = join(root, altered.graphRequest.path);
          const originalRequest = readFileSync(path);
          const graph = JSON.parse(originalRequest);
          const inpaint = Object.values(graph.nodes).find(({ action }) => action === 'Inpaint');
          inpaint.params.mask_image.sourceKey = 'canvas';
          const bytes = Buffer.from(JSON.stringify(graph));
          Object.assign(altered.graphRequest, {
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          });
          writeFileSync(path, bytes);
          writeFileSync(changedPath, JSON.stringify(altered));
          await assert.rejects(readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }), /declared file/u);
          writeFileSync(path, originalRequest);
        }
        const ref = descriptor.registryReplay ?? descriptor.persistedOutputs;
        const proof = JSON.parse(readFileSync(join(root, ref.path)));
        if (descriptor.registryReplay) {
          proof.nodeHash = 'a'.repeat(64);
        } else {
          if (workflowId === 'StableDiffusionXLPAGPipeline:inpaint') {
            assert.ok(proof.outputs.some(({ taskId }) => taskId !== receipt.taskId));
          }
          proof.outputs.push(proof.outputs.find(({ taskId }) => taskId === receipt.taskId));
        }
        const bytes = Buffer.from(JSON.stringify(proof));
        Object.assign(ref, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
        writeFileSync(join(root, ref.path), bytes);
        writeFileSync(changedPath, JSON.stringify(descriptor));
        await assert.rejects(
          readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }),
          descriptor.registryReplay ? /strictly equal/u : /exactly one result for the task/u,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
}

const retainedCpuEdit = process.env.MODIFF_SAVED_KANDINSKY_CPU_EDIT_EVIDENCE;
test('Kandinsky CPU edit joins archived pixels and sampled worker memory', { skip: !retainedCpuEdit }, async () => {
  const clientRoot = fileURLToPath(new URL('..', import.meta.url));
  const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '..', 'MoDiff'));
  const args = {
    clientRoot,
    backendRoot,
    workflowId: 'Kandinsky3Pipeline:edit_image',
    evidencePath: resolve(retainedCpuEdit),
  };
  const original = await readCanonicalWorkflowEvidence(args);
  assert.equal(original.receipt.observationLimits.executionDevice, 'cpu:0');
  assert.equal(original.receipt.observationLimits.peakMemorySource, 'sampled-worker-rss');
  assert.equal(original.receipt.peakMemoryBytes, 62254313472);
  assert.equal(original.receipt.qualificationClaims.hardwareQualified, false);
  const root = mkdtempSync(join(tmpdir(), 'modiff-retained-cpu-edit-'));
  try {
    for (const file of original.retainedFiles) {
      assert.equal(basename(file.path), file.path);
      copyFileSync(file.absolutePath, join(root, file.path));
    }
    const descriptor = JSON.parse(original.descriptorBytes);
    const ref = descriptor.resourceSamples;
    const samples = readFileSync(join(root, ref.path), 'utf8').trim().split(/\r?\n/u);
    const reduced = samples.map((line) => JSON.stringify({ ...JSON.parse(line), workerRss: 1 }));
    const bytes = Buffer.from(reduced.join('\n') + '\n');
    Object.assign(ref, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    writeFileSync(join(root, ref.path), bytes);
    const changed = join(root, 'evidence.json');
    writeFileSync(changed, JSON.stringify(descriptor));
    await assert.rejects(readCanonicalWorkflowEvidence({ ...args, evidencePath: changed }), /peak >=/u);
  } finally {
    assert.equal(dirname(root), resolve(tmpdir()));
    rmSync(root, { recursive: true, force: true });
  }
});

const serverRetainedEdit = process.env.MODIFF_SERVER_RETAINED_OMNIGEN_EDIT_EVIDENCE;
test('saved OmniGen joins the server capture and one original input', { skip: !serverRetainedEdit }, async () => {
  const clientRoot = fileURLToPath(new URL('..', import.meta.url));
  const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '..', 'MoDiff'));
  const result = await readCanonicalWorkflowEvidence({
    clientRoot,
    backendRoot,
    workflowId: 'OmniGenPipeline:edit_image',
    evidencePath: resolve(serverRetainedEdit),
  });
  assert.equal(result.receipt.observationLimits.serverOutputStoreMatched, true);
  assert.equal(result.receipt.observationLimits.clientApiSnapshotObserved, false);
  assert.equal(result.receipt.observationLimits.nativeInputMarkerBound, true);
  assert.deepEqual(result.receipt.observationLimits.configuredUnobservedControls, ['image_guidance_scale']);
  assert.equal(result.receipt.qualificationClaims.hardwareQualified, false);
});

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

for (const [model, task, variable] of [
  ['JoyImageEditPlusPipeline', 'edit_image', 'MODIFF_SAVED_JOY_PLUS_EDIT_EVIDENCE'],
  ['JoyImageEditPlusPipeline', 'multi_image_reference_edit', 'MODIFF_SAVED_JOY_PLUS_REFERENCES_EVIDENCE'],
  ['QwenImageEditPlusPipeline', 'multi_image_reference_edit', 'MODIFF_SAVED_QWEN_TERRACOTTA_EVIDENCE'],
  ['OmniGenPipeline', 'multi_image_reference_edit', 'MODIFF_SAVED_OMNIGEN_ORDERED_REFERENCES_EVIDENCE'],
]) {
  const evidencePath = process.env[variable];
  test(`${model} verifies exact references in ${task}`, { skip: !evidencePath }, async () => {
    const clientRoot = fileURLToPath(new URL('..', import.meta.url));
    const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '..', 'MoDiff'));
    const args = {
      clientRoot,
      backendRoot,
      workflowId: model + ':' + task,
      evidencePath: resolve(evidencePath),
    };
    const result = await readCanonicalWorkflowEvidence(args);
    const { receipt } = result;
    assert.equal(receipt.observationLimits.independentConsumerPixels, false);
    assert.equal(receipt.inputBinding.decodedImage.mode, 'RGB');
    if (task === 'edit_image') {
      assert.equal(receipt.referenceBindings, undefined);
      return;
    }
    assert.equal(receipt.referenceBindings.length, 1);
    const [material] = receipt.referenceBindings;
    assert.equal(material.inputIndex, 1);
    assert.equal(material.nodeId, receipt.inputBinding.nodeId);
    assert.notEqual(material.sha256, receipt.inputBinding.sha256);
    assert.equal(receipt.observationLimits.retainedStudioFormMode, 'edit_image');
    const root = mkdtempSync(join(tmpdir(), 'modiff-reference-proof-'));
    try {
      for (const file of result.retainedFiles) {
        assert.equal(basename(file.path), file.path);
        copyFileSync(file.absolutePath, join(root, file.path));
      }
      const descriptor = JSON.parse(result.descriptorBytes);
      const [materialUpload] = descriptor.referenceUploads;
      descriptor.referenceUploads[0] = descriptor.inputUpload;
      descriptor.inputUpload = materialUpload;
      const substituted = join(root, 'evidence.json');
      writeFileSync(substituted, JSON.stringify(descriptor));
      await assert.rejects(
        readCanonicalWorkflowEvidence({ ...args, evidencePath: substituted }),
        assert.AssertionError,
      );
    } finally {
      assert.equal(dirname(root), resolve(tmpdir()));
      rmSync(root, { recursive: true, force: true });
    }
  });
}
