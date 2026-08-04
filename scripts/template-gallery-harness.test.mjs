import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, test } from 'node:test';
import {
  buildTemplateCandidate,
  beforePreviewContractErrors,
  calculateMotionMetricsByProfile,
  canonicalJsonHash,
  cardPreviewContractErrors,
  decodedAudiovisualMediaHash,
  galleryExpectedOutput,
  loadTemplateRuntime,
  mergeManifestEntries,
  parseMediaProbe,
  redactPublicProvenance,
  selectTemplates,
  selectPrimaryRunFile,
  technicalMediaErrors,
  validateBeforeMedia,
  validateQualityReview,
  validateReviewedDerivative,
} from './template-gallery-harness.mjs';
import { repairDuplicateOutputItems } from './live-proof-provenance.mjs';

let runtime;

before(async () => {
  runtime = await loadTemplateRuntime();
});

test('media probe parsing derives video and audio metadata without ffprobe', () => {
  const video = parseMediaProbe(
    'Duration: 00:00:05.06, start: 0.000000, bitrate: 900 kb/s\nStream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 832x480, 16 fps, 16 tbr',
    'video',
  );
  assert.deepEqual(video, {
    width: 832,
    height: 480,
    fps: 16,
    durationSeconds: 5.06,
    hasAudio: false,
    codecName: 'h264',
    pixelFormat: 'yuv420p',
  });

  const muxedVideo = parseMediaProbe(
    'Duration: 00:00:05.06\nStream #0:0: Video: h264, yuv420p, 1280x704, 24 fps\nStream #0:1: Audio: aac, 48000 Hz, stereo',
    'video',
  );
  assert.equal(muxedVideo.hasAudio, true);

  const audio = parseMediaProbe(
    'Duration: 00:00:30.00, start: 0.000000\nStream #0:0: Audio: pcm_s16le, 48000 Hz, stereo, s16',
    'audio',
  );
  assert.deepEqual(audio, { sourceSampleRate: 48000, channels: 2, durationSeconds: 30 });
});

test('card preview contract requires browser-safe H.264 yuv420p video', () => {
  const valid = {
    width: 640,
    durationSeconds: 5.06,
    hasAudio: false,
    codecName: 'h264',
    pixelFormat: 'yuv420p',
  };
  assert.deepEqual(cardPreviewContractErrors(valid), []);
  assert.match(
    cardPreviewContractErrors({
      ...valid,
      hasAudio: true,
      codecName: 'hevc',
      pixelFormat: 'yuv444p',
    }).join('\n'),
    /audio stream[\s\S]*codec must be h264, got hevc[\s\S]*pixel format must be yuv420p, got yuv444p/,
  );
});

test('derived gallery media can override dimensions without changing the runtime output contract', () => {
  const template = {
    example: {
      expectedOutput: { width: 640, height: 640, requiresAudio: true },
      galleryExpectedOutput: { width: 1536, height: 1108 },
    },
  };

  assert.deepEqual(galleryExpectedOutput(template), {
    width: 1536,
    height: 1108,
    requiresAudio: true,
  });
});

test('before preview contract requires silent browser-safe H.264 yuv420p video', () => {
  const valid = {
    hasAudio: false,
    codecName: 'h264',
    pixelFormat: 'yuv420p',
  };
  assert.deepEqual(beforePreviewContractErrors(valid), []);
  assert.match(
    beforePreviewContractErrors({
      ...valid,
      hasAudio: true,
      codecName: 'mpeg4',
      pixelFormat: 'yuv444p',
    }).join('\n'),
    /audio stream[\s\S]*codec must be h264, got mpeg4[\s\S]*pixel format must be yuv420p, got yuv444p/,
  );
});

test('video technical gate rejects unique but visually static clips', () => {
  const expected = {
    frames: 160,
    durationSeconds: 10,
    minimumMotionCoverage: 0.5,
    minimumAdjacentMotionCoverage: 0.08,
    minimumEndToEndMotionCoverage: 0.45,
    minimumActiveMotionWindowRatio: 0.8,
    minimumStrongMotionWindowRatio: 0.65,
    maximumLowMotionFrameRatio: 0.2,
  };
  const staticErrors = technicalMediaErrors(
    {
      width: 1280,
      height: 720,
      frames: 160,
      durationSeconds: 10,
      uniqueFrameRatio: 1,
      adjacentChangedPixelRatio: 0.01,
      cumulativeChangedPixelRatio: 0.18,
      endToEndChangedPixelRatio: 0.1,
      activeMotionWindowRatio: 0.4,
      strongMotionWindowRatio: 0.1,
      lowMotionFrameRatio: 0.75,
      nearBlackRatio: 0,
      lumaStdDev: 20,
    },
    expected,
    'video',
  );
  assert.match(staticErrors.join('\n'), /cumulative motion coverage must be at least 50%/);
  assert.deepEqual(
    technicalMediaErrors(
      {
        width: 1280,
        height: 720,
        frames: 160,
        durationSeconds: 10,
        uniqueFrameRatio: 1,
        adjacentChangedPixelRatio: 0.12,
        cumulativeChangedPixelRatio: 0.72,
        endToEndChangedPixelRatio: 0.6,
        activeMotionWindowRatio: 0.95,
        strongMotionWindowRatio: 0.8,
        lowMotionFrameRatio: 0.05,
        nearBlackRatio: 0,
        lumaStdDev: 20,
      },
      expected,
      'video',
    ),
    [],
  );
});

test('localized-subject motion metrics accept slow continuous movement without weakening global camera review', () => {
  const motionMetricsByProfile = calculateMotionMetricsByProfile(
    [0.023, 0.0056, 0.027, 0.026, 0.038, 0.025, 0.03, 0.0095, 0.0034, 0.00073],
    [...Array.from({ length: 87 }, () => 0.002), ...Array.from({ length: 33 }, () => 0.00025)],
  );
  assert.deepEqual(motionMetricsByProfile.localized_subject, {
    activeMotionWindowRatio: 0.9,
    strongMotionWindowRatio: 0.8,
    lowMotionFrameRatio: 0.275,
  });
  assert.deepEqual(motionMetricsByProfile.global_camera, {
    activeMotionWindowRatio: 0,
    strongMotionWindowRatio: 0,
    lowMotionFrameRatio: 1,
  });

  const slowContinuous = {
    width: 1536,
    height: 1024,
    frames: 121,
    durationSeconds: 5.04,
    uniqueFrameRatio: 1,
    adjacentChangedPixelRatio: 0.00275,
    cumulativeChangedPixelRatio: 0.944,
    endToEndChangedPixelRatio: 0.925,
    activeMotionWindowRatio: 0,
    strongMotionWindowRatio: 0,
    lowMotionFrameRatio: 1,
    motionMetricsByProfile,
    nearBlackRatio: 0.01,
    maximumNearBlackFrameRatio: 0.03,
    lumaStdDev: 76,
    isolatedLumaFlashRatio: 0,
  };
  const localizedContract = {
    frames: 121,
    durationSeconds: 5.04,
    motionReviewProfile: 'localized_subject',
    minimumMotionCoverage: 0.9,
    minimumAdjacentMotionCoverage: 0.0025,
    minimumEndToEndMotionCoverage: 0.9,
    minimumActiveMotionWindowRatio: 0.9,
    minimumStrongMotionWindowRatio: 0.8,
    maximumLowMotionFrameRatio: 0.35,
  };
  assert.deepEqual(technicalMediaErrors(slowContinuous, localizedContract, 'video'), []);

  const globalErrors = technicalMediaErrors(
    slowContinuous,
    {
      ...localizedContract,
      motionReviewProfile: 'global_camera',
      minimumAdjacentMotionCoverage: 0.08,
      minimumActiveMotionWindowRatio: 0.8,
      minimumStrongMotionWindowRatio: 0.65,
      maximumLowMotionFrameRatio: 0.2,
    },
    'video',
  );
  assert.match(globalErrors.join('\n'), /adjacent-frame motion coverage must be at least 8%/);
  assert.match(globalErrors.join('\n'), /active half-second motion windows must be at least 80%/);
  assert.match(globalErrors.join('\n'), /strong half-second motion windows must be at least 65%/);
  assert.match(globalErrors.join('\n'), /low-motion adjacent frames must be at most 20%/);
});

test('localized-subject motion review still rejects a static clip disguised by one cut', () => {
  const errors = technicalMediaErrors(
    {
      width: 1536,
      height: 1024,
      frames: 121,
      durationSeconds: 5.04,
      uniqueFrameRatio: 1,
      adjacentChangedPixelRatio: 0.01,
      cumulativeChangedPixelRatio: 0.95,
      endToEndChangedPixelRatio: 0.94,
      motionMetricsByProfile: {
        localized_subject: {
          activeMotionWindowRatio: 0.1,
          strongMotionWindowRatio: 0.1,
          lowMotionFrameRatio: 0.98,
        },
      },
      nearBlackRatio: 0,
      lumaStdDev: 30,
      isolatedLumaFlashRatio: 0,
    },
    {
      motionReviewProfile: 'localized_subject',
      minimumMotionCoverage: 0.9,
      minimumAdjacentMotionCoverage: 0.0025,
      minimumEndToEndMotionCoverage: 0.9,
      minimumActiveMotionWindowRatio: 0.9,
      minimumStrongMotionWindowRatio: 0.8,
      maximumLowMotionFrameRatio: 0.35,
    },
    'video',
  );
  assert.match(errors.join('\n'), /active half-second motion windows must be at least 90%/);
  assert.match(errors.join('\n'), /strong half-second motion windows must be at least 80%/);
  assert.match(errors.join('\n'), /low-motion adjacent frames must be at most 35%/);
});

test('soundtracked video gate requires audible, unclipped embedded audio', () => {
  const base = {
    width: 1280,
    height: 704,
    frames: 121,
    durationSeconds: 5.04,
    uniqueFrameRatio: 1,
    adjacentChangedPixelRatio: 0.2,
    cumulativeChangedPixelRatio: 0.9,
    endToEndChangedPixelRatio: 0.7,
    activeMotionWindowRatio: 1,
    strongMotionWindowRatio: 1,
    lowMotionFrameRatio: 0,
    lumaStdDev: 20,
    nearBlackRatio: 0,
    maximumNearBlackFrameRatio: 0,
    isolatedLumaFlashRatio: 0,
  };
  assert.match(technicalMediaErrors(base, { requiresAudio: true }, 'video').join('\n'), /embedded audio stream/);
  assert.deepEqual(
    technicalMediaErrors(
      {
        ...base,
        hasAudio: true,
        embeddedAudio: {
          hash: 'sha256:decoded-audio-pcm-s16le-48000-stereo:audio',
          peakAmplitude: 0.8,
          silenceRatio: 0.01,
          clippedSampleRatio: 0,
        },
        audiovisualMediaHash: 'sha256:decoded-av-v1:combined',
      },
      { requiresAudio: true },
      'video',
    ),
    [],
  );
});

test('combined audiovisual identity changes when either decoded stream changes', () => {
  const first = decodedAudiovisualMediaHash('sha256:video:a', 'sha256:audio:a');
  assert.equal(first, decodedAudiovisualMediaHash('sha256:video:a', 'sha256:audio:a'));
  assert.notEqual(first, decodedAudiovisualMediaHash('sha256:video:b', 'sha256:audio:a'));
  assert.notEqual(first, decodedAudiovisualMediaHash('sha256:video:a', 'sha256:audio:b'));
  assert.equal(decodedAudiovisualMediaHash('sha256:video:a', null), null);
});

test('video technical gate rejects cut-heavy clips whose shots remain weakly animated', () => {
  const errors = technicalMediaErrors(
    {
      width: 1536,
      height: 1024,
      frames: 381,
      durationSeconds: 23.81,
      uniqueFrameRatio: 1,
      adjacentChangedPixelRatio: 0.12,
      cumulativeChangedPixelRatio: 1,
      endToEndChangedPixelRatio: 0.9,
      activeMotionWindowRatio: 0.96,
      strongMotionWindowRatio: 0.3,
      lowMotionFrameRatio: 0.02,
      nearBlackRatio: 0,
      lumaStdDev: 30,
    },
    {
      frames: 381,
      durationSeconds: 23.81,
      minimumMotionCoverage: 0.5,
      minimumAdjacentMotionCoverage: 0.08,
      minimumEndToEndMotionCoverage: 0.45,
      minimumActiveMotionWindowRatio: 0.8,
      minimumStrongMotionWindowRatio: 0.65,
      maximumLowMotionFrameRatio: 0.2,
    },
    'video',
  );
  assert.match(errors.join('\n'), /strong half-second motion windows must be at least 65%/);
});

test('video technical gate rejects a corrupted dark frame hidden by strong aggregate motion', () => {
  const errors = technicalMediaErrors(
    {
      width: 1664,
      height: 960,
      frames: 161,
      durationSeconds: 10.06,
      uniqueFrameRatio: 1,
      adjacentChangedPixelRatio: 0.23,
      cumulativeChangedPixelRatio: 0.99,
      endToEndChangedPixelRatio: 0.78,
      activeMotionWindowRatio: 1,
      strongMotionWindowRatio: 1,
      lowMotionFrameRatio: 0,
      nearBlackRatio: 0.06,
      maximumNearBlackFrameRatio: 0.52,
      lumaStdDev: 65,
    },
    { maximumNearBlackFrameRatio: 0.35 },
    'video',
  );
  assert.match(errors.join('\n'), /maximum per-frame near-black area must be at most 35%/);
});

test('video technical gate rejects isolated one-frame luminance glitches', () => {
  const errors = technicalMediaErrors(
    {
      width: 1280,
      height: 720,
      frames: 160,
      durationSeconds: 10,
      uniqueFrameRatio: 1,
      adjacentChangedPixelRatio: 0.2,
      cumulativeChangedPixelRatio: 0.8,
      endToEndChangedPixelRatio: 0.6,
      activeMotionWindowRatio: 1,
      strongMotionWindowRatio: 1,
      lowMotionFrameRatio: 0,
      nearBlackRatio: 0,
      lumaStdDev: 20,
      isolatedLumaFlashRatio: 1 / 158,
    },
    {},
    'video',
  );
  assert.match(errors.join('\n'), /isolated full-frame luminance flashes/);
});

test('video delivery floor accepts native Wan resolution without weakening template dimension locks', () => {
  const decoded = {
    width: 768,
    height: 512,
    frames: 81,
    durationSeconds: 5.06,
    uniqueFrameRatio: 1,
    nearBlackRatio: 0,
    lumaStdDev: 20,
    isolatedLumaFlashRatio: 0,
  };
  assert.deepEqual(technicalMediaErrors(decoded, { width: 768, height: 512 }, 'video'), []);

  const lowResolution = technicalMediaErrors({ ...decoded, width: 640, height: 360 }, {}, 'video');
  assert.match(lowResolution.join('\n'), /at least 768x480/);
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
  assert.equal(runtime.templates.length, 77);
  assert.equal(new Set(runtime.templates.map((template) => template.id)).size, 77);
  assert.equal(
    runtime.templates.some((template) => template.id === 'wan_22_i2v_seed_vault'),
    true,
  );
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
      width: 768,
      height: 1024,
      promptSettingsHash: 'ps_124204d1',
      templateLockHash: 'tpl_bc67f109',
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

test('returned gallery assets require concrete physical, diversity, motion, and typography evidence', () => {
  const expected = {
    templateId: 'wan_vace_cinematic_text_to_video',
    templateLockHash: 'tpl_test',
    promptSettingsHash: 'ps_test',
    modelRevision: 'repo@commit',
    runtimeFingerprint: 'runtime_test',
    graphHash: 'sha256:canonical-graph-v1:test',
    proofLockHash: 'sha256:live-proof-lock-v1:test',
    decodedMediaHash: 'sha256:decoded-video:test',
  };
  const review = {
    schemaVersion: 4,
    ...expected,
    reviewStatus: 'approved_reviewed',
    reviewer: 'Test reviewer',
    reviewedAt: '2026-07-17T01:00:00.000Z',
    rubric: { taskAdherence: 5, artifactControl: 5, modalityQuality: 5 },
    scores: { promptAdherence: 5, composition: 5, technicalExecution: 5, templateUsefulness: 5 },
    hardFailures: [],
    objectiveChecks: { status: 'pass' },
    modalityReview: { status: 'pass' },
    physicalConsistency: { status: 'pass', checks: ['Stable horizon.', 'Plausible light.', 'No malformed objects.'] },
    visualDiversity: {
      status: 'pass',
      themeId: 'fixed-lighthouse-weather',
      nearestTemplateId: 'wan_vace_grayscale_control',
      distinctFromNearest: true,
    },
    motionContinuity: {
      status: 'pass',
      fullPlaybackReviewed: true,
      rigidBodyScaleDrift: 'none',
      geometryMorphing: 'none',
      temporalGlitches: 'none',
    },
    motionReview: {
      status: 'pass',
      fullPlaybackReviewed: true,
      frameCount: 160,
      durationSeconds: 10,
      sceneMotionCoveragePercent: 72,
      visibleMotionMilestones: ['Boat enters foreground.', 'Boat crosses lighthouse axis.', 'Boat clears frame.'],
      temporalDefects: [],
    },
    cardPreviewReview: {
      status: 'pass',
      reviewedAtCardSize: true,
      readsAsMovingVideo: true,
      foregroundMotionMilestones: ['Train enters.', 'Train crosses.', 'Train exits.'],
    },
    temporalGeometryReview: {
      status: 'pass',
      subjectMorphing: 'none',
      scaleDrift: 'none',
      contactSliding: 'none',
      frameGlitches: 'none',
    },
    sourcePreservationReview: {
      status: 'pass',
      fullSourceCompared: true,
      subjectIdentity: 'preserved',
      cameraPath: 'preserved',
      unmaskedRegions: 'preserved',
      timing: 'preserved',
      comparisonMilestones: ['Opening geometry matches.', 'Midpoint camera path matches.', 'Final timing matches.'],
    },
    visualIntent: 'photoreal',
    realismReview: {
      status: 'pass',
      looksPhotographic: true,
      physicallyPlausibleLighting: true,
      physicallyPlausibleMaterials: true,
      physicallyPlausibleDynamics: true,
    },
    userFeedbackResolution: {
      status: 'pass',
      replacementOutput: true,
      resolvedIssues: ['Replaced the synthetic water dynamics.', 'Added large card-visible subject travel.'],
    },
    summary: 'Full playback and sampled frames satisfy the strict visual acceptance contract.',
  };

  assert.deepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  assert.match(
    validateQualityReview(
      { ...review, motionContinuity: { ...review.motionContinuity, rigidBodyScaleDrift: 'visible' } },
      expected,
      'approved_reviewed',
    ).join('\n'),
    /rigidBodyScaleDrift must be none/,
  );
  assert.match(
    validateQualityReview({ ...review, schemaVersion: 3 }, expected, 'approved_reviewed').join('\n'),
    /schemaVersion must be 4/,
  );
  assert.match(
    validateQualityReview(
      { ...review, motionReview: { ...review.motionReview, sceneMotionCoveragePercent: 20 } },
      expected,
      'approved_reviewed',
    ).join('\n'),
    /visible motion across at least half/,
  );
  assert.match(
    validateQualityReview({ ...review, userFeedbackResolution: undefined }, expected, 'approved_reviewed').join('\n'),
    /replacement-specific feedback resolution/,
  );

  const subwayExpected = {
    ...expected,
    templateId: 'wan_22_ti2v_5b_seed_vault',
    decodedMediaHash: 'sha256:decoded-video-framemd5:f46d1387bd5848c62fe9343a800d813a906ea33e0139f43f50926cc822bb1de7',
    decodedAudioHash:
      'sha256:decoded-audio-pcm-s16le-48000-stereo:7971158f3e9988632c8c2100cd1f485c3477dbdb1006e9814d52fcbb1c84db3d',
    audiovisualMediaHash: 'sha256:decoded-av-v1:abb6bde8c9ac4d302e1741e51eb38bc139d873ae6914b5de548058a00c4bb476',
  };
  const subwayReview = {
    ...review,
    ...subwayExpected,
    reviewedAt: '2026-07-24T15:00:00.000Z',
  };
  assert.deepEqual(validateQualityReview(subwayReview, subwayExpected, 'approved_reviewed'), []);
  const rejectedSubwayExpected = {
    ...subwayExpected,
    decodedAudioHash:
      'sha256:decoded-audio-pcm-s16le-48000-stereo:811cfa5f48a6b84410a861f25488709641f03d208092f60c6dbe6040f2b089aa',
  };
  assert.match(
    validateQualityReview(
      { ...subwayReview, ...rejectedSubwayExpected },
      rejectedSubwayExpected,
      'approved_reviewed',
    ).join('\n'),
    /user-rejected video output cannot be republished/,
  );
});

test('lyric video approval cannot bypass listening-based cue alignment review', () => {
  const expected = {
    templateId: 'ace_step_lyric_music_video',
    templateLockHash: 'tpl_lyrics',
    promptSettingsHash: 'ps_lyrics',
    modelRevision: 'ace@commit | ltx@commit',
    runtimeFingerprint: 'runtime_test',
    graphHash: 'sha256:canonical-graph-v1:lyrics',
    proofLockHash: 'sha256:live-proof-lock-v1:lyrics',
    decodedMediaHash: 'sha256:decoded-video-framemd5:lyrics',
  };
  const errors = validateQualityReview(
    {
      schemaVersion: 4,
      ...expected,
      reviewStatus: 'approved_reviewed',
      reviewer: 'Test reviewer',
      reviewedAt: '2026-07-16T00:00:00.000Z',
      rubric: { taskAdherence: 5, artifactControl: 5, modalityQuality: 5 },
      summary: 'Deliberately incomplete review used to verify the listening gate.',
    },
    expected,
    'approved_reviewed',
  );
  assert.match(errors.join('\n'), /listening-based audio alignment review/);
  assert.match(errors.join('\n'), /at least six exact lyric overlay cues/);
});

test('multi-reference product approval enforces human-scale bicycle geometry', () => {
  const expected = {
    templateId: 'qwen_multi_reference_product',
    templateLockHash: 'tpl_bicycle',
    promptSettingsHash: 'ps_bicycle',
    modelRevision: 'repo@commit',
    runtimeFingerprint: 'runtime_test',
    graphHash: 'sha256:canonical-graph-v1:bicycle',
    proofLockHash: 'sha256:live-proof-lock-v1:bicycle',
    decodedMediaHash: 'sha256:decoded-image:bicycle',
  };
  const review = {
    schemaVersion: 3,
    ...expected,
    reviewStatus: 'approved_reviewed',
    reviewer: 'Test reviewer',
    reviewedAt: '2026-07-14T00:00:00.000Z',
    rubric: { taskAdherence: 5, artifactControl: 5, modalityQuality: 5 },
    scores: { promptAdherence: 5, composition: 5, technicalExecution: 5, templateUsefulness: 5 },
    hardFailures: [],
    objectiveChecks: { status: 'pass' },
    modalityReview: { status: 'pass' },
    physicalConsistency: { status: 'pass', checks: ['Equal wheels.', 'Coherent frame.', 'Ground contact.'] },
    visualDiversity: {
      status: 'pass',
      themeId: 'canal-bicycle-courtyard',
      nearestTemplateId: 'reference_fusion',
      distinctFromNearest: true,
    },
    scaleConsistency: {
      status: 'pass',
      bicycleImageWidthPercent: 92,
      wheelDiameterMismatchPercent: 3,
      fullBicycleVisible: true,
      completeFrameTriangle: true,
      exactWordmark: 'VELA',
    },
    summary: 'The bicycle is complete, mechanically coherent, and anchored to the standard doorway.',
  };

  assert.deepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  assert.match(
    validateQualityReview(
      { ...review, scaleConsistency: { ...review.scaleConsistency, exactWordmark: 'DMC' } },
      expected,
      'approved_reviewed',
    ).join('\n'),
    /exactWordmark must be VELA/,
  );
});

test('scale-sensitive Wan proofs always require the strict schema and measured anchors', () => {
  const expected = {
    templateId: 'wan_vace_grayscale_control',
    templateLockHash: 'tpl_wan_control',
    promptSettingsHash: 'ps_wan_control',
    modelRevision: 'repo@commit',
    runtimeFingerprint: 'runtime_test',
    graphHash: 'sha256:canonical-graph-v1:wan-control',
    proofLockHash: 'sha256:live-proof-lock-v1:wan-control',
    decodedMediaHash: 'sha256:decoded-video-rgba:wan-control',
  };
  const review = {
    schemaVersion: 4,
    ...expected,
    reviewStatus: 'approved_reviewed',
    reviewer: 'Test reviewer',
    reviewedAt: '2026-07-15T00:00:00.000Z',
    rubric: { taskAdherence: 5, artifactControl: 5, modalityQuality: 5 },
    scores: { promptAdherence: 5, composition: 5, technicalExecution: 5, templateUsefulness: 5 },
    hardFailures: [],
    objectiveChecks: { status: 'pass' },
    modalityReview: { status: 'pass' },
    physicalConsistency: { status: 'pass', checks: ['Stable horizon.', 'Plausible light.', 'No malformed objects.'] },
    visualDiversity: {
      status: 'pass',
      themeId: 'working-harbor-control',
      nearestTemplateId: 'wan_vace_cinematic_text_to_video',
      distinctFromNearest: true,
    },
    scaleContextReview: {
      status: 'pass',
      anchorMeasurements: [
        { anchor: 'boat to person', observedRelationship: 'Boat remains seven person-heights long.', verdict: 'pass' },
        { anchor: 'people to dock', observedRelationship: 'All feet share the same dock plane.', verdict: 'pass' },
      ],
      subjectProportionsPlausible: true,
      perspectiveScaleConsistent: true,
      supportAndContact: 'pass',
      supportRationale: 'People remain grounded and both vessels remain supported by a stable waterline.',
    },
    motionContinuity: {
      status: 'pass',
      fullPlaybackReviewed: true,
      rigidBodyScaleDrift: 'none',
      geometryMorphing: 'none',
      temporalGlitches: 'none',
    },
    motionReview: {
      status: 'pass',
      fullPlaybackReviewed: true,
      frameCount: 160,
      durationSeconds: 10,
      sceneMotionCoveragePercent: 68,
      visibleMotionMilestones: ['Vessel enters.', 'People cross dock.', 'Wake reaches foreground.'],
      temporalDefects: [],
    },
    cardPreviewReview: {
      status: 'pass',
      reviewedAtCardSize: true,
      readsAsMovingVideo: true,
      foregroundMotionMilestones: ['Vessel enters.', 'People cross.', 'Wake expands.'],
    },
    temporalGeometryReview: {
      status: 'pass',
      subjectMorphing: 'none',
      scaleDrift: 'none',
      contactSliding: 'none',
      frameGlitches: 'none',
    },
    sourcePreservationReview: {
      status: 'pass',
      fullSourceCompared: true,
      subjectIdentity: 'preserved',
      cameraPath: 'preserved',
      unmaskedRegions: 'preserved',
      timing: 'preserved',
      comparisonMilestones: ['Opening geometry matches.', 'Midpoint camera path matches.', 'Final timing matches.'],
    },
    visualIntent: 'photoreal',
    realismReview: {
      status: 'pass',
      looksPhotographic: true,
      physicallyPlausibleLighting: true,
      physicallyPlausibleMaterials: true,
      physicallyPlausibleDynamics: true,
    },
    summary: 'The complete video satisfies the strict scale, motion, and visual quality contract.',
  };

  assert.deepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  assert.match(
    validateQualityReview({ ...review, schemaVersion: 2 }, expected, 'approved_reviewed').join('\n'),
    /schemaVersion must be 4/,
  );
  assert.match(
    validateQualityReview({ ...review, scaleContextReview: undefined }, expected, 'approved_reviewed').join('\n'),
    /strict scale-context review status must be pass/,
  );
  assert.match(
    validateQualityReview({ ...review, sourcePreservationReview: undefined }, expected, 'approved_reviewed').join('\n'),
    /requires passing source preservation review/,
  );
});

test('pending source-conditioned assets require measured context-scale anchors', () => {
  const expected = {
    templateId: 'qwen_layered_portrait',
    templateLockHash: 'tpl_layers',
    promptSettingsHash: 'ps_layers',
    modelRevision: 'repo@commit',
    runtimeFingerprint: 'runtime_test',
    graphHash: 'sha256:canonical-graph-v1:layers',
    proofLockHash: 'sha256:live-proof-lock-v1:layers',
    decodedMediaHash: 'sha256:decoded-image:layers',
  };
  const review = {
    schemaVersion: 3,
    ...expected,
    reviewStatus: 'approved_reviewed',
    reviewer: 'Test reviewer',
    reviewedAt: '2026-07-14T00:00:00.000Z',
    rubric: { taskAdherence: 5, artifactControl: 5, modalityQuality: 5 },
    scores: { promptAdherence: 5, composition: 5, technicalExecution: 5, templateUsefulness: 5 },
    hardFailures: [],
    objectiveChecks: { status: 'pass' },
    modalityReview: { status: 'pass' },
    physicalConsistency: { status: 'pass', checks: ['Stable face.', 'Plausible hands.', 'Complete microphone.'] },
    visualDiversity: {
      status: 'pass',
      themeId: 'coastal-singer-layer-decomposition',
      nearestTemplateId: 'character_edit',
      distinctFromNearest: true,
    },
    scaleContextReview: {
      status: 'pass',
      anchorMeasurements: [
        {
          anchor: 'microphone to hand',
          observedRelationship: 'Matches the source grip and palm width.',
          verdict: 'pass',
        },
        {
          anchor: 'head to shoulder width',
          observedRelationship: 'Matches the source portrait proportions.',
          verdict: 'pass',
        },
      ],
      subjectProportionsPlausible: true,
      perspectiveScaleConsistent: true,
      supportAndContact: 'not_applicable',
      supportRationale:
        'Transparent decomposition layers preserve the source contacts without introducing a new surface.',
    },
    summary: 'Every exported layer preserves the source portrait scale and remains independently editable.',
  };

  assert.deepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  assert.match(
    validateQualityReview(
      { ...review, scaleContextReview: { ...review.scaleContextReview, anchorMeasurements: [] } },
      expected,
      'approved_reviewed',
    ).join('\n'),
    /requires at least two measured visual anchors/,
  );
});

test('layered gallery derivatives stay bound to every captured layer and the source input', () => {
  const processorPath = fileURLToPath(new URL('./template-gallery-layer-sheet.py', import.meta.url));
  const processorHash = `sha256:bytes:${createHash('sha256').update(readFileSync(processorPath)).digest('hex')}`;
  const provenance = {
    template: { id: 'qwen_layered_portrait' },
    inputs: { items: [{ contentHash: 'sha256:bytes:source' }] },
    output: {
      collectionHash: 'sha256:collection:layers',
      items: [
        { decodedSha256: 'sha256:layer:1' },
        { decodedSha256: 'sha256:layer:2' },
        { decodedSha256: 'sha256:layer:3' },
      ],
    },
  };
  const derivative = {
    schemaVersion: 1,
    format: 'modiff.gallery.reviewed-derivative.v1',
    templateId: 'qwen_layered_portrait',
    kind: 'layered_contact_sheet',
    layout: 'source-recomposition-three-layers-metrics-3x2',
    sourceOutputCollectionHash: 'sha256:collection:layers',
    sourceItemHashes: ['sha256:layer:1', 'sha256:layer:2', 'sha256:layer:3'],
    sourceInputHash: 'sha256:bytes:source',
    decodedMediaHash: 'sha256:decoded:sheet',
    processor: { path: 'scripts/template-gallery-layer-sheet.py', contentHash: processorHash },
    recomposition: { meanAbsoluteRgb: [4.1, 4.2, 4.3], maxMeanAbsoluteError: 4.3, threshold: 8, status: 'pass' },
  };
  const expected = { templateId: 'qwen_layered_portrait', decodedMediaHash: 'sha256:decoded:sheet' };

  assert.deepEqual(validateReviewedDerivative(provenance, derivative, expected), []);
  assert.match(
    validateReviewedDerivative(provenance, { ...derivative, sourceItemHashes: ['sha256:layer:1'] }, expected).join(
      '\n',
    ),
    /sourceItemHashes mismatch/,
  );
  assert.match(
    validateReviewedDerivative(
      provenance,
      { ...derivative, recomposition: { ...derivative.recomposition, maxMeanAbsoluteError: 8.1 } },
      expected,
    ).join('\n'),
    /8\/255 mean-absolute-error boundary/,
  );
});

test('reviewed audio remux derivatives bind source video, replacement audio, operation, and final AV identity', () => {
  const processorPath = fileURLToPath(new URL('./align-subway-strum-review.py', import.meta.url));
  const processorHash = `sha256:bytes:${createHash('sha256').update(readFileSync(processorPath)).digest('hex')}`;
  const decodedMediaHash = 'sha256:decoded-video-framemd5:video';
  const decodedAudioHash = 'sha256:decoded-audio-pcm-s16le-48000-stereo:audio';
  const audiovisualMediaHash = decodedAudiovisualMediaHash(decodedMediaHash, decodedAudioHash);
  const provenance = {
    template: { id: 'wan_22_ti2v_5b_seed_vault', promptSettingsHash: 'ps_source' },
    templateLockHash: 'tpl_source',
    mediaHash: decodedMediaHash,
    output: { collectionHash: 'sha256:collection:source', items: [{ decodedSha256: decodedMediaHash }] },
  };
  const expected = {
    templateId: 'wan_22_ti2v_5b_seed_vault',
    templateLockHash: 'tpl_current',
    promptSettingsHash: 'ps_current',
    decodedMediaHash,
    decodedAudioHash,
    audiovisualMediaHash,
  };
  const operation = { name: 'delay_and_remux_audio', parameters: { delaySeconds: 1 / 6, videoCodec: 'copy' } };
  const derivative = {
    schemaVersion: 1,
    format: 'modiff.gallery.reviewed-derivative.v1',
    templateId: expected.templateId,
    kind: 'audio_remux',
    sourceOutputCollectionHash: provenance.output.collectionHash,
    sourceVideoHash: provenance.mediaHash,
    sourceTemplateLockHash: provenance.templateLockHash,
    sourcePromptSettingsHash: provenance.template.promptSettingsHash,
    templateLockHash: expected.templateLockHash,
    promptSettingsHash: expected.promptSettingsHash,
    decodedMediaHash,
    decodedAudioHash,
    audiovisualMediaHash,
    replacementAudio: {
      encodedSha256: 'sha256:bytes:replacement-wav',
      decodedSha256: 'sha256:decoded-audio-pcm-s16le-48000-stereo:replacement-wav',
      provenanceSha256: 'sha256:bytes:alignment-record',
    },
    processor: { path: 'scripts/align-subway-strum-review.py', contentHash: processorHash },
    operation,
    operationHash: canonicalJsonHash(operation),
  };

  assert.deepEqual(validateReviewedDerivative(provenance, derivative, expected), []);
  assert.match(
    validateReviewedDerivative(
      provenance,
      { ...derivative, operation: { ...operation, parameters: { ...operation.parameters, delaySeconds: 0 } } },
      expected,
    ).join('\n'),
    /operationHash mismatch/,
  );
  assert.match(
    validateReviewedDerivative(
      provenance,
      { ...derivative, decodedAudioHash: 'sha256:decoded-audio-pcm-s16le-48000-stereo:other' },
      expected,
    ).join('\n'),
    /decodedAudioHash mismatch[\s\S]*audiovisualMediaHash is not derived/,
  );
});

test('AV replacement derivatives bind a pinned visual rerun, approved audio provenance, and six timed lyric cues', () => {
  const decodedMediaHash = 'sha256:decoded-video-framemd5:lyric-video';
  const decodedAudioHash = 'sha256:decoded-audio-pcm-s16le-48000-stereo:lyric-audio';
  const audiovisualMediaHash = decodedAudiovisualMediaHash(decodedMediaHash, decodedAudioHash);
  const provenance = {
    template: { id: 'ace_step_lyric_music_video', promptSettingsHash: 'ps_source' },
    templateLockHash: 'tpl_source',
    mediaHash: 'sha256:decoded-video-framemd5:source-video',
    output: { collectionHash: 'sha256:collection:lyric-source', items: [] },
  };
  const expected = {
    templateId: 'ace_step_lyric_music_video',
    templateLockHash: 'tpl_current',
    promptSettingsHash: 'ps_current',
    decodedMediaHash,
    decodedAudioHash,
    audiovisualMediaHash,
  };
  const derivative = {
    schemaVersion: 1,
    format: 'modiff.gallery.av-replacement-derivative.v1',
    templateId: expected.templateId,
    operation: 'pinned_visual_rerun_with_audio_derived_caption_timeline',
    sourceOutputCollectionHash: provenance.output.collectionHash,
    sourceVideoHash: provenance.mediaHash,
    sourceTemplateLockHash: provenance.templateLockHash,
    sourcePromptSettingsHash: provenance.template.promptSettingsHash,
    templateLockHash: expected.templateLockHash,
    promptSettingsHash: expected.promptSettingsHash,
    decodedMediaHash,
    decodedAudioHash,
    audiovisualMediaHash,
    output: { encodedSha256: 'sha256:bytes:final-video' },
    visual: {
      regenerated: true,
      graphRequestSha256: 'sha256:bytes:graph-request',
      sourceProvenanceSha256: 'sha256:bytes:visual-provenance',
    },
    audio: {
      encodedSha256: 'sha256:bytes:approved-wav',
      decodedSha256: 'sha256:decoded-audio-pcm-s16le-48000-stereo:approved-wav',
      sourceProvenanceSha256: 'sha256:bytes:audio-provenance',
    },
    captions: {
      source: 'delivery_audio_asr_line_intervals',
      cueCount: 6,
      lrc: [
        '[00:00.00]Daylight leaves the garden wall',
        '[00:03.26]Silver buds begin to call',
        '[00:07.44]White petals turn into the night',
        '[00:11.38]Every vine unfolds its light',
        '[00:15.08]Stars grow pale above the lawn',
        '[00:18.90]Moonflowers hold until the dawn',
      ].join('\n'),
      maxScheduledFrameLatenessSeconds: 0.061,
    },
  };

  assert.deepEqual(validateReviewedDerivative(provenance, derivative, expected), []);
  assert.match(
    validateReviewedDerivative(
      provenance,
      { ...derivative, captions: { ...derivative.captions, lrc: '[00:00.00]Only one cue' } },
      expected,
    ).join('\n'),
    /at least six caption cues/,
  );
});

test('gallery publication selects the primary run asset instead of a collection item', () => {
  const selected = selectPrimaryRunFile(
    [
      'qwen_layered_portrait.run1.item1.webp',
      'qwen_layered_portrait.run1.recomposed.png',
      'qwen_layered_portrait.run1.webp',
    ],
    'qwen_layered_portrait',
    1,
    new Set(['.png', '.webp']),
  );
  assert.equal(selected, 'qwen_layered_portrait.run1.webp');
});

test('duplicate collection URLs can be repaired without changing unique decoded outputs', () => {
  const provenance = {
    format: 'modiff.live-proof.provenance.v1',
    proofLockHash: 'old',
    inputArtifactsHash: 'inputs',
    template: { revisionHash: 'revision', resolvedTemplateLockHash: 'template-lock' },
    graph: { hash: 'graph', executionPlanHash: 'plan' },
    model: { modelRevision: 'repo@commit', fingerprint: 'model' },
    models: { hash: 'models' },
    runtime: {
      lockFingerprint: 'runtime',
      backendSource: { fingerprint: 'source' },
      backendContract: { fingerprint: 'contract' },
      deterministic: { fingerprint: 'deterministic' },
    },
    output: {
      items: [
        { index: 0, mediaType: 'image', encodedSha256: 'sha256:a', decodedSha256: 'decoded:a' },
        { index: 1, mediaType: 'image', encodedSha256: 'sha256:a', decodedSha256: 'decoded:a' },
        { index: 2, mediaType: 'image', encodedSha256: 'sha256:b', decodedSha256: 'decoded:b' },
      ],
    },
  };
  const repaired = repairDuplicateOutputItems(provenance, {
    mediaItems: [{ mediaHash: 'backend:a' }, { mediaHash: 'backend:b' }],
  });
  assert.equal(repaired.output.count, 2);
  assert.deepEqual(
    repaired.output.items.map((item) => [item.index, item.encodedSha256, item.backendMediaHash]),
    [
      [0, 'sha256:a', 'backend:a'],
      [1, 'sha256:b', 'backend:b'],
    ],
  );
  assert.notEqual(repaired.proofLockHash, 'old');
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
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'modiff-before-media-'));
  try {
    const inputPath = join(temporaryDirectory, 'input.png');
    const bytes = Buffer.from('synthetic comparison input');
    writeFileSync(inputPath, bytes);
    const contentHash = `sha256:bytes:${createHash('sha256').update(bytes).digest('hex')}`;
    const valid = validateBeforeMedia(inputPath, { inputs: { items: [{ contentHash }] } });
    assert.deepEqual(valid.errors, []);
    assert.equal(valid.hash, contentHash);
    assert.match(
      validateBeforeMedia(inputPath, { inputs: { items: [{ contentHash: 'sha256:bytes:other' }] } }).errors.join('\n'),
      /does not match any pinned provenance input/i,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
