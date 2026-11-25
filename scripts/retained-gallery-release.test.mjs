import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { canonicalJsonHash } from './canonical-json.mjs';
import { canonicalWorkflowContract } from './release-contract-core.mjs';
import {
  assertRetainedVideoAdjustment,
  createRetainedGalleryReleaseReader,
  verifiedRetainedGalleryAssetIndex,
} from './retained-gallery-release.mjs';
import { createHash } from 'node:crypto';
import { validateRetainedGalleryProvenance, verifyRetainedApprovedFiles } from './retained-gallery-provenance.mjs';
import { loadTemplateRuntime } from './template-gallery-harness.mjs';

const hash = (value) => `sha256:canonical-json:${canonicalJsonHash(value)}`;

test('an exposure-corrected retained video stays bound to its silent source and frame cadence', () => {
  const video = { width: 512, height: 512, frames: 16, fps: 8, durationSeconds: 2 };
  const native = { outputHash: 'native-file', decodedOutput: { kind: 'video', hash: 'native-video', ...video } };
  const output = {
    sourceOutputHash: 'native-file',
    outputEncodedSha256: 'corrected-file',
    decodedMediaHash: 'corrected-video',
    video: { ...video, hasAudio: false },
    videoAdjustment: { schemaVersion: 1, kind: 'exposure_deflicker', sourceVideoHash: 'native-video' },
  };
  assert.doesNotThrow(() => assertRetainedVideoAdjustment(native, output));
  assert.doesNotThrow(() =>
    assertRetainedVideoAdjustment(native, { ...output, video: { ...output.video, audio: null } }),
  );
  for (const modification of [
    { sourceOutputHash: 'different-file' },
    { outputEncodedSha256: 'native-file' },
    { decodedMediaHash: 'native-video' },
    { video: { ...output.video, frames: 15 } },
    { video: { ...output.video, fps: 16 } },
    { video: { ...output.video, hasAudio: true } },
    { video: { ...output.video, audio: { hash: 'unexpected-audio' } } },
    { videoAdjustment: { ...output.videoAdjustment, sourceVideoHash: 'different-video' } },
    { videoAdjustment: { ...output.videoAdjustment, kind: 'replace_video' } },
  ]) {
    assert.throws(() => assertRetainedVideoAdjustment(native, { ...output, ...modification }));
  }
});

test('an audio-gain adjustment retains the exact video and recorded original audio', () => {
  const video = { width: 768, height: 512, frames: 81, fps: 24, durationSeconds: 3.38 };
  const audio = { sourceSampleRate: 24000, channels: 2, hash: 'native-audio' };
  const native = { outputHash: 'native-file', decodedOutput: { kind: 'video', hash: 'native-video', ...video, audio } };
  const output = {
    sourceOutputHash: 'native-file',
    outputEncodedSha256: 'adjusted-file',
    decodedMediaHash: 'native-video',
    video: { ...video, hasAudio: true, audio: { ...audio, hash: 'adjusted-audio' } },
    videoAdjustment: {
      schemaVersion: 1,
      kind: 'audio_gain',
      sourceVideoHash: 'native-video',
      sourceAudioHash: audio.hash,
    },
  };
  assert.doesNotThrow(() => assertRetainedVideoAdjustment(native, output));
  for (const modification of [
    { decodedMediaHash: 'changed-video' },
    { video: { ...output.video, audio } },
    { video: { ...output.video, audio: { ...output.video.audio, sourceSampleRate: 48000 } } },
    { video: { ...output.video, audio: { ...output.video.audio, channels: 1 } } },
    { videoAdjustment: { ...output.videoAdjustment, sourceAudioHash: 'different-audio' } },
  ]) {
    assert.throws(() => assertRetainedVideoAdjustment(native, { ...output, ...modification }));
  }
});

test('retained registration binds the exact approved review, provenance and mask files', () => {
  const archive = new Map([
    ['/template-gallery/reviews/example.original-review.json', Buffer.from('{"review":"accepted"}\n')],
    ['/template-gallery/reviews/example.original-provenance.json', Buffer.from('{"source":"saved run"}\n')],
    ['/template-gallery/inputs/example.mask.png', Buffer.from('original mask bytes')],
  ]);
  const approved = Object.fromEntries(
    [...archive].map(([path, bytes], index) => [
      index,
      { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    ]),
  );
  assert.doesNotThrow(() => verifyRetainedApprovedFiles(approved, (path) => archive.get(path)));
  for (const [path, bytes] of archive) {
    const changed = Buffer.from(bytes);
    changed[0] ^= 1;
    assert.throws(
      () => verifyRetainedApprovedFiles(approved, (key) => (key === path ? changed : archive.get(key))),
      /exact approved bytes/u,
    );
    assert.throws(
      () => verifyRetainedApprovedFiles(approved, (key) => (key === path ? undefined : archive.get(key))),
      /exact approved bytes/u,
    );
  }
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'retained-gallery-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'src', 'studio'), { recursive: true });
  const available = { path: 'template-gallery/retained.json', size: 10, sha256: `sha256:bytes:${'a'.repeat(64)}` };
  const held = { path: 'template-gallery/withheld.webp', size: 20, sha256: `sha256:bytes:${'b'.repeat(64)}` };
  const payload = { schemaVersion: 1, assetVersion: 'v1', assets: [available, held] };
  const inventory = {
    ...payload,
    status: 'ready',
    assetSetId: hash(payload),
    assetCount: 2,
    totalBytes: 30,
    missingAssets: [],
  };
  const source = {
    schemaVersion: 1,
    mode: 'huggingface',
    localBasePath: '/template-gallery',
    repoType: 'dataset',
    repoId: 'maintainer/gallery',
    revision: 'c'.repeat(40),
    pathPrefix: 'template-gallery',
    assetManifestPath: '_modiff/template-assets.v1.json',
    assetSetId: hash({ ...payload, assets: [available] }),
    completeAssetSetId: inventory.assetSetId,
    unavailableAssets: [held.path],
  };
  const rights = {
    schemaVersion: 1,
    assetSetId: inventory.assetSetId,
    records: [
      { path: available.path, sha256: available.sha256, publishDecision: 'approved' },
      { path: held.path, sha256: held.sha256, publishDecision: 'hold', holdReason: 'existing rights hold' },
    ],
  };
  const write = () => {
    for (const [name, value] of [
      ['src/studio/templateAssetSource.json', source],
      ['config/template-assets.v1.json', inventory],
      ['config/template-asset-rights.v1.json', rights],
    ])
      writeFileSync(join(root, name), JSON.stringify(value));
  };
  return { root, source, inventory, rights, available, held, write };
}

test('retained publication resolves only exact registered rights-approved assets', (t) => {
  const { root, source, available, held, write } = fixture(t);
  write();
  const approved = verifiedRetainedGalleryAssetIndex(root, source);
  assert.deepEqual(approved.get(available.path), available);
  assert.equal(approved.has(held.path), false);
  assert.throws(
    () => verifiedRetainedGalleryAssetIndex(root, { ...source, revision: 'd'.repeat(40) }),
    /differs from the activated Gallery source/u,
  );
});

test('retained release refuses stale Gallery inventory, unbound rights and changed holds', (t) => {
  for (const alter of [
    (value) => {
      value.source.assetSetId = 'sha256:canonical-json:' + 'd'.repeat(64);
    },
    (value) => {
      value.inventory.assets[0].size += 1;
    },
    (value) => {
      value.rights.records[0].sha256 = value.held.sha256;
    },
    (value) => {
      value.rights.records[1].publishDecision = 'approved';
    },
    (value) => {
      value.source.unavailableAssets = [];
    },
  ]) {
    const value = fixture(t);
    alter(value);
    value.write();
    assert.throws(() => verifiedRetainedGalleryAssetIndex(value.root, value.source));
  }
});

test(
  'the staged Spandrel preview qualifies only the locked recipe and original saved execution',
  {
    skip: !process.env.MODIFF_VERIFY_SPANDREL_GALLERY_STAGE,
  },
  async () => {
    const clientRoot = resolve(import.meta.dirname, '..');
    const backend = resolve(process.env.MODIFF_BACKEND_DIR || join(clientRoot, '..', 'MoDiff'));
    const stage = resolve(process.env.MODIFF_VERIFY_SPANDREL_GALLERY_STAGE);
    const json = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
    const runtime = await loadTemplateRuntime(clientRoot);
    const template = runtime.templates.find(({ id }) => id === 'spandrel_x2_synthetic_gradient');
    const registry = json(stage, 'public/template-gallery/manifest.json');
    const source = json(stage, 'src/studio/templateAssetSource.json');
    const entry = runtime.findManifestEntry(template, registry);
    assert.ok(entry, 'The saved Gallery preview must match its current technical recipe.');
    const workflowId = 'SpandrelImageUpscale:image_upscale';
    const manifest = json(backend, 'data/workflow-library-manifest.json').workflows.find(({ id }) => id === workflowId);
    const graph = json(backend, `data/graphs/${manifest.graphPath}`);
    const receiptRegistry = json(backend, 'data/qualification/release/canonical-workflow-run-receipts.v1.json');
    const nativeReceipt = receiptRegistry.receipts.find((row) => row.workflowId === workflowId);
    assert.ok(nativeReceipt);
    const proof = {
      recipe: {
        template,
        workflowId,
        sourceTaskTemplateId: manifest.sourceTemplateId,
        originalReceiptSha256: nativeReceipt.evidenceSha256,
        retainedGraphHash: nativeReceipt.graphHash,
        inputSha256: nativeReceipt.inputBinding.sha256,
      },
      entry,
      sourceWorkflow: { manifest, contract: canonicalWorkflowContract(manifest, graph) },
      templateRevisionHash: canonicalJsonHash({ template, settings: runtime.lockedSettingsForTemplate(template) }),
      nativeReceipt,
    };
    const read = createRetainedGalleryReleaseReader({ clientRoot: stage, source, registry });
    const retained = read(proof);
    assert.equal(retained.proofKind, 'reviewed_retained_template_execution');
    assert.equal(retained.resourceCandidateId, null);
    assert.deepEqual(retained.observationLimits, nativeReceipt.observationLimits);
    assert.deepEqual(retained.modelArtifact, nativeReceipt.modelArtifact);
    assert.deepEqual(read({ ...proof, nativeReceipt: undefined }), retained);
    for (const changes of [
      { graphHash: 'different executed graph' },
      { evidenceSha256: 'a'.repeat(64) },
      { capturedAt: 'changed capture timestamp' },
      { backendSourceFingerprint: 'changed source fingerprint' },
      { modelArtifact: { ...nativeReceipt.modelArtifact, byteSize: 1 } },
      { peakMemoryBytes: 1 },
    ]) {
      assert.throws(
        () => read({ ...proof, nativeReceipt: { ...nativeReceipt, ...changes } }),
        /Published Spandrel proof differs from the verified native receipt/u,
      );
    }
  },
);

test(
  'approved retained speech and edit examples bind exact bytes and native observations',
  { skip: !process.env.MODIFF_VERIFY_WHISPER_LCM_GALLERY_STAGE && !process.env.MODIFF_VERIFY_SANA_GALLERY_STAGE },
  async () => {
    const clientRoot = resolve(import.meta.dirname, '..');
    const backend = resolve(process.env.MODIFF_BACKEND_DIR || join(clientRoot, '..', 'MoDiff'));
    const whisperLcmStage = process.env.MODIFF_VERIFY_WHISPER_LCM_GALLERY_STAGE;
    const sanaStage = process.env.MODIFF_VERIFY_SANA_GALLERY_STAGE;
    const json = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
    const manifest = json(backend, 'data/workflow-library-manifest.json');
    const receiptRegistry = json(backend, 'data/qualification/release/canonical-workflow-run-receipts.v1.json');
    const runtime = await loadTemplateRuntime(clientRoot);
    for (const [id, workflowId, stagePath] of [
      ['whisper_tiny_blue_cup_transcription', 'HuggingFaceSpeechRecognitionModel:speech_to_text', whisperLcmStage],
      ['lcm_dawn_alpine_lake', 'LatentConsistencyModelPipeline:edit_image', whisperLcmStage],
      ['sana_sprint_monochrome_tiger', 'SanaSprintPipeline:edit_image', sanaStage],
    ]) {
      if (!stagePath) continue;
      const stage = resolve(stagePath);
      const registry = json(stage, 'public/template-gallery/manifest.json');
      const source = json(stage, 'src/studio/templateAssetSource.json');
      const read = createRetainedGalleryReleaseReader({ clientRoot: stage, source, registry });
      const template = runtime.templates.find((item) => item.id === id);
      const entry = runtime.findManifestEntry(template, registry);
      const workflow = manifest.workflows.find((item) => item.id === workflowId);
      const graph = json(backend, `data/graphs/${workflow.graphPath}`);
      const nativeReceipt = receiptRegistry.receipts.find((item) => item.workflowId === workflowId);
      assert.ok(entry);
      const proof = {
        recipe: {
          template,
          workflowId,
          sourceTaskTemplateId: workflow.sourceTemplateId,
          originalReceiptSha256: nativeReceipt.evidenceSha256,
          retainedGraphHash: nativeReceipt.graphHash,
          inputSha256: nativeReceipt.inputBinding.sha256,
          promptSha256: nativeReceipt.promptBinding?.sha256,
        },
        entry,
        sourceWorkflow: { manifest: workflow, contract: canonicalWorkflowContract(workflow, graph) },
        templateRevisionHash: canonicalJsonHash({ template, settings: runtime.lockedSettingsForTemplate(template) }),
        nativeReceipt,
      };
      const retained = read(proof);
      assert.equal(retained.proofKind, 'reviewed_retained_template_execution');
      assert.equal(retained.resourceCandidateId, null);
      assert.deepEqual(retained.observationLimits, nativeReceipt.observationLimits);
      assert.deepEqual(read({ ...proof, nativeReceipt: undefined }), retained);
      assert.throws(
        () => read({ ...proof, nativeReceipt: { ...nativeReceipt, resourceCandidateId: 'made-up' } }),
        /Published recipe differs from the verified native receipt/u,
      );
      const provenance = json(stage, `public${entry.provenancePath}`);
      const outputBytes = readFileSync(join(stage, `public${entry.outputPath}`));
      const beforeBytes = entry.beforePath && readFileSync(join(stage, `public${entry.beforePath}`));
      const check = { templateRevisionHash: proof.templateRevisionHash, outputBytes, beforeBytes };
      const changed = Buffer.from('not the original media');
      assert.deepEqual(validateRetainedGalleryProvenance(provenance, entry, check), []);
      assert.ok(validateRetainedGalleryProvenance(provenance, entry, { ...check, outputBytes: changed }).length);
      assert.ok(validateRetainedGalleryProvenance(provenance, entry, { ...check, beforeBytes: changed }).length);
      assert.equal('originalTaskId' in provenance.association, false);
      if (workflowId.startsWith('HuggingFace')) {
        assert.equal(entry.beforePath, undefined);
        assert.equal(provenance.association.recipeObservation.input.galleryScope, 'private_source_hash_only');
      } else {
        const review = json(stage, `public${entry.qualityReviewPath}`);
        assert.match(entry.beforePath, /\.before\.webp$/u);
        const sana = id === 'sana_sprint_monochrome_tiger';
        assert.equal(review.scores.promptAdherence, sana ? 4 : 3);
        assert.equal(review.maintainerAcceptance.decision, 'accepted_with_disclosed_limitations');
        if (sana) {
          const { observedEditControls, modelTerms } = provenance.association.recipeObservation;
          assert.equal(observedEditControls.strength, 0.75);
          assert.equal(modelTerms.textEncoder, 'Gemma-2-2B-IT');
          const stock = structuredClone(provenance);
          stock.association.recipeObservation.observedEditControls.strength = 0.5;
          assert.ok(validateRetainedGalleryProvenance(stock, entry, check).length);
        }
      }
    }
  },
);
