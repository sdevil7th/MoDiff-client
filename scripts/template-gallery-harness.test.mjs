import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import {
  buildTemplateCandidate,
  loadTemplateRuntime,
  mergeManifestEntries,
  parseMediaProbe,
  redactPublicProvenance,
  selectTemplates,
  validateBeforeMedia,
  validateQualityReview,
} from './template-gallery-harness.mjs';

let runtime;

before(async () => {
  runtime = await loadTemplateRuntime();
});

test('media probe parsing derives video and audio metadata without ffprobe', () => {
  const video = parseMediaProbe(
    'Duration: 00:00:05.06, start: 0.000000, bitrate: 900 kb/s\nStream #0:0: Video: h264, yuv420p, 832x480, 16 fps, 16 tbr',
    'video',
  );
  assert.deepEqual(video, { width: 832, height: 480, fps: 16, durationSeconds: 5.06 });

  const audio = parseMediaProbe(
    'Duration: 00:00:30.00, start: 0.000000\nStream #0:0: Audio: pcm_s16le, 48000 Hz, stereo, s16',
    'audio',
  );
  assert.deepEqual(audio, { sourceSampleRate: 48000, channels: 2, durationSeconds: 30 });
});

test('public provenance redacts machine paths and source commit ids', () => {
  const redacted = redactPublicProvenance({
    runtime: {
      payload: {
        dataDir: 'C:\\Users\\example\\Codes\\MoDiff\\data',
        workDir: '/home/example/modiff/data',
      },
      backendSource: {
        gitCommit: '0123456789abcdef',
      },
    },
    outputPath: '/template-gallery/example.webp',
  });

  assert.deepEqual(redacted, {
    runtime: {
      payload: {
        dataDir: '<local-path>/data',
        workDir: '<local-path>/data',
      },
      backendSource: {
        gitCommit: '<redacted-source-commit>',
      },
    },
    outputPath: '/template-gallery/example.webp',
  });
});

test('gallery harness loads all Studio templates from the TypeScript runtime', () => {
  assert.equal(runtime.templates.length, 48);
  assert.equal(new Set(runtime.templates.map((template) => template.id)).size, 48);
});

test('Qwen gallery candidates use the runtime locked settings and hashes', () => {
  const expectedHashes = {
    qwen_low_vram_text_rendering: {
      width: 1024,
      height: 1024,
      promptSettingsHash: 'ps_c32e6c86',
      templateLockHash: 'tpl_6b3c93e2',
    },
    qwen_low_vram_product_concept: {
      width: 1024,
      height: 768,
      promptSettingsHash: 'ps_2eeea545',
      templateLockHash: 'tpl_b90c42f9',
    },
    qwen_low_vram_poster_layout: {
      width: 1024,
      height: 1024,
      promptSettingsHash: 'ps_85f9326f',
      templateLockHash: 'tpl_e28515fb',
    },
  };

  for (const [templateId, hashes] of Object.entries(expectedHashes)) {
    const template = runtime.templates.find((item) => item.id === templateId);
    assert.ok(template, `${templateId} loaded from STUDIO_TEMPLATES`);
    const candidate = buildTemplateCandidate(runtime, template);

    assert.deepEqual(candidate.lockedSettings, runtime.lockedSettingsForTemplate(template));
    assert.equal(candidate.promptSettingsHash, runtime.promptSettingsHash(template));
    assert.equal(candidate.templateLockHash, runtime.templateLockHash(template));
    assert.deepEqual(
      {
        mode: candidate.lockedSettings.mode,
        modelType: candidate.lockedSettings.modelType,
        width: candidate.lockedSettings.width,
        height: candidate.lockedSettings.height,
        steps: candidate.lockedSettings.steps,
        guidanceScale: candidate.lockedSettings.guidanceScale,
        resourceMode: candidate.lockedSettings.resourceMode,
        dtype: candidate.lockedSettings.dtype,
        quantizationMode: candidate.lockedSettings.quantizationMode,
        autoOffload: candidate.lockedSettings.autoOffload,
        offloadMode: candidate.lockedSettings.offloadMode,
      },
      {
        mode: 'text_to_image',
        modelType: 'QwenImageModularPipeline',
        width: hashes.width,
        height: hashes.height,
        steps: 50,
        guidanceScale: 4,
        resourceMode: 'auto',
        dtype: 'bfloat16',
        quantizationMode: 'none',
        autoOffload: true,
        offloadMode: 'model_cpu',
      },
    );
    assert.deepEqual(
      {
        promptSettingsHash: candidate.promptSettingsHash,
        templateLockHash: candidate.templateLockHash,
      },
      {
        promptSettingsHash: hashes.promptSettingsHash,
        templateLockHash: hashes.templateLockHash,
      },
    );
    assert.ok(Object.hasOwn(candidate.lockedSettings, 'outpaintLeft'));
    assert.ok(Object.hasOwn(candidate.lockedSettings, 'sourceAudio'));
  }
});

test('manifest matching binds an exact template to the entry model revision', () => {
  const template = runtime.templates.find((item) => item.id === 'qwen_low_vram_product_concept');
  assert.ok(template);
  const modelRevision = '25468b98e3276ca6700de15c6628e51b7de54a26';
  const candidate = buildTemplateCandidate(runtime, template, modelRevision);
  const entry = {
    templateId: template.id,
    promptSettingsHash: candidate.promptSettingsHash,
    templateLockHash: candidate.templateLockHash,
    modelRevision,
    runtimeFingerprint: 'test-runtime',
    graphHash: 'sha256:canonical-graph-v1:test',
    proofLockHash: 'sha256:live-proof-lock-v1:test',
    backendSourceFingerprint: 'sha256:backend-source-v1:test',
    backendContractFingerprint: 'sha256:backend-contract-v1:test',
    modelCommit: '25468b98e3276ca6700de15c6628e51b7de54a26',
    templateRevisionHash: 'sha256:template-revision-v1:test',
    provenancePath: '/template-gallery/reviews/qwen.duplicate-provenance.json',
    provenanceHash: 'sha256:canonical-json:provenance-test',
    outputPath: '/template-gallery/qwen.webp',
    thumbnailPath: '/template-gallery/qwen.webp',
    mediaHash: 'sha256:decoded-rgba:test',
    mediaType: 'image',
    verificationTimestamp: '2026-07-10T00:00:00.000Z',
    qualityReviewPath: '/template-gallery/reviews/qwen.quality-review.json',
    qualityReviewHash: 'sha256:canonical-json:test',
    qualityReviewStatus: 'approved_exact',
    reviewer: 'Test reviewer',
    reviewedAt: '2026-07-10T00:00:00.000Z',
  };
  const manifest = {
    schemaVersion: 2,
    generatedAt: '2026-07-10T00:00:00.000Z',
    runtimeFingerprint: 'test-runtime',
    examples: [entry],
  };

  assert.equal(runtime.findManifestEntry(template, manifest), entry);
  assert.equal(
    runtime.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...entry, modelRevision: 'tampered-revision' }],
    }),
    undefined,
  );
});

test('quality approval is bound to the exact template, model, runtime, and decoded media', () => {
  const expected = {
    templateId: 'qwen_low_vram_product_concept',
    templateLockHash: 'tpl_test',
    promptSettingsHash: 'ps_test',
    modelRevision: '25468b98e3276ca6700de15c6628e51b7de54a26',
    runtimeFingerprint: 'runtime_test',
    graphHash: 'sha256:canonical-graph-v1:test',
    proofLockHash: 'sha256:live-proof-lock-v1:test',
    decodedMediaHash: 'sha256:decoded-rgba:test',
  };
  const review = {
    schemaVersion: 1,
    ...expected,
    reviewStatus: 'approved_exact',
    reviewer: 'Test reviewer',
    reviewedAt: '2026-07-10T00:00:00.000Z',
    rubric: {
      taskAdherence: 4,
      artifactControl: 4,
      modalityQuality: 4,
    },
    summary: 'The output satisfies the locked brief and exact publication quality gate.',
    knownLimitations: [],
  };

  assert.deepEqual(validateQualityReview(review, expected), []);
  assert.match(
    validateQualityReview({ ...review, decodedMediaHash: 'sha256:decoded-rgba:other' }, expected).join('\n'),
    /decodedMediaHash mismatch/,
  );
  assert.match(
    validateQualityReview({ ...review, reviewStatus: 'pass_for_duplicate_proof' }, expected).join('\n'),
    /status must be approved_exact/,
  );
  assert.match(
    validateQualityReview({ ...review, runtimeFingerprint: 'unverified-local' }, expected).join('\n'),
    /runtimeFingerprint mismatch|must be verified/,
  );
});

test('gallery template selection rejects zero catalogs and unknown requested ids', () => {
  assert.throws(() => selectTemplates([]), /zero runtime templates/i);
  assert.throws(
    () => selectTemplates(runtime.templates, ['qwen_low_vram_product_concept', 'missing-template']),
    /requested Studio template id\(s\) were not found: missing-template/i,
  );
  assert.deepEqual(
    selectTemplates(runtime.templates, ['qwen_low_vram_product_concept']).map((template) => template.id),
    ['qwen_low_vram_product_concept'],
  );
});

test('publishing one template preserves other exact entries and replaces only the same template id', () => {
  const existing = [
    { templateId: 'qwen_low_vram_product_concept', mediaHash: 'product-old' },
    { templateId: 'z_image_quick_concept', mediaHash: 'z-stays' },
  ];
  const verified = [
    { templateId: 'qwen_low_vram_product_concept', mediaHash: 'product-new' },
    { templateId: 'qwen_low_vram_text_rendering', mediaHash: 'text-new' },
  ];

  assert.deepEqual(mergeManifestEntries(existing, verified), [
    { templateId: 'qwen_low_vram_product_concept', mediaHash: 'product-new' },
    { templateId: 'qwen_low_vram_text_rendering', mediaHash: 'text-new' },
    { templateId: 'z_image_quick_concept', mediaHash: 'z-stays' },
  ]);
});

test('comparison before media must match a byte-locked provenance input', () => {
  const inputPath = fileURLToPath(
    new URL('../public/template-gallery/inputs/qwen-carton-layout-control.png', import.meta.url),
  );
  const contentHash = 'sha256:bytes:b748201353f02543c2a48920bb514c2741366151df45bf6c4904aeb0f32f1a67';
  const valid = validateBeforeMedia(inputPath, { inputs: { items: [{ contentHash }] } });
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.hash, contentHash);
  assert.match(
    validateBeforeMedia(inputPath, { inputs: { items: [{ contentHash: 'sha256:bytes:other' }] } }).errors.join('\n'),
    /does not match any pinned provenance input/i,
  );
});
