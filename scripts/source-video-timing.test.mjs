import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourceVideoTimingMatches } from '../src/studio/sourceVideoTiming.ts';
import {
  canonicalJsonHash,
  loadTemplateRuntime,
  technicalMediaErrors,
  validateQualityReview,
} from './template-gallery-harness.mjs';

const sourceTiming = { schemaVersion: 1, sourceMediaHash: 'sha256:bytes:' + 'a'.repeat(64), frames: 25, fps: 7 };
test('short source timing requires the original frame count and cadence', () => {
  const media = { frames: 25, durationSeconds: 25 / 7, fps: 7 };
  assert.equal(sourceVideoTimingMatches(sourceTiming, media), true);
  assert.equal(sourceVideoTimingMatches(sourceTiming, { ...media, durationSeconds: 3.57 }), true);
  assert.equal(sourceVideoTimingMatches(sourceTiming, { frames: 25, durationSeconds: 3.57 }), false);
  for (const change of [{ frames: 81 }, { durationSeconds: 5 }, { fps: 16 }])
    assert.equal(sourceVideoTimingMatches(sourceTiming, { ...media, ...change }), false);
  assert.equal(sourceVideoTimingMatches({ ...sourceTiming, sourceMediaHash: 'unverified' }, media), false);
  assert.equal(sourceVideoTimingMatches(undefined, media), false);
});
test('ordinary video retains its minimum duration; a declared complete source keeps its timing', () => {
  const decoded = {
    frames: 25,
    fps: 7,
    durationSeconds: 25 / 7,
    width: 1536,
    height: 1024,
    nearBlackRatio: 0,
    lumaStdDev: 20,
    uniqueFrameRatio: 1,
    isolatedLumaFlashRatio: 0,
  };
  assert(technicalMediaErrors(decoded, {}, 'video').some((x) => x.includes('at least 5 seconds')));
  assert(!technicalMediaErrors(decoded, { sourceTiming }, 'video').some((x) => x.includes('at least 5 seconds')));
  assert(
    technicalMediaErrors({ ...decoded, frames: 24 }, { sourceTiming }, 'video').some((x) =>
      x.includes('at least 5 seconds'),
    ),
  );
});
test('audio delivery rate comes from the source stream, independently of normalized PCM comparison', () => {
  const audio = {
    sampleRate: 48000,
    sourceSampleRate: 44100,
    durationSeconds: 60,
    peakAmplitude: 0.5,
    silenceRatio: 0.1,
    clippedSampleRatio: 0,
  };
  assert.deepEqual(technicalMediaErrors(audio, { sampleRate: 44100 }, 'audio'), []);
  assert(technicalMediaErrors(audio, { sampleRate: 48000 }, 'audio').some((x) => x.includes('got 44100')));
  assert.deepEqual(technicalMediaErrors({ ...audio, sourceSampleRate: undefined }, { sampleRate: 48000 }, 'audio'), []);
});

test('qualitative acceptance keeps absent scores absent and requires an exact maintainer binding', () => {
  const expected = {
    templateId: 'ace_step_audio_variation',
    templateLockHash: 'tpl_test',
    promptSettingsHash: 'ps_test',
    modelRevision: 'example/model@' + 'a'.repeat(40),
    runtimeFingerprint: 'runtime',
    graphHash: 'graph',
    proofLockHash: 'proof',
    decodedMediaHash: 'decoded',
  };
  const review = {
    schemaVersion: 2,
    ...expected,
    reviewStatus: 'approved_reviewed',
    reviewer: 'Test maintainer',
    reviewedAt: '2026-11-13T00:00:00Z',
    ratingMethod: 'maintainer_qualitative_acceptance',
    rubric: { taskAdherence: null, artifactControl: null, modalityQuality: null },
    scores: { promptAdherence: null, composition: null, technicalExecution: null, templateUsefulness: null },
    hardFailures: [],
    objectiveChecks: { status: 'pass' },
    modalityReview: { status: 'pass' },
    knownLimitations: ['No numeric scores were supplied by the maintainer.'],
    summary: 'The maintainer accepted this exact asset and authorized its registration.',
  };
  assert(validateQualityReview(review, expected, 'approved_reviewed').some((x) => x.includes('rubric')));
  review.maintainerAcceptance = {
    schemaVersion: 1,
    decision: 'accepted_with_disclosed_limitations',
    reviewer: review.reviewer,
    acceptedAt: review.reviewedAt,
    statement: review.summary,
    acceptedReviewHash: canonicalJsonHash(review),
  };
  assert.deepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  review.summary += ' Changed after acceptance.';
  assert(validateQualityReview(review, expected, 'approved_reviewed').some((x) => x.includes('maintainerAcceptance')));
});

test('Gallery selection accepts a complete short source only with its matching source identity', async () => {
  const runtime = await loadTemplateRuntime();
  const template = runtime.templates.find((item) => item.id === 'ltx_video_video_to_video');
  const entry = {
    templateId: template.id,
    modelRevision: 'example/model@' + 'a'.repeat(40),
    promptSettingsHash: runtime.promptSettingsHash(template),
    templateInputContractHash: runtime.templateInputContractHash(template),
    qualityReviewStatus: 'approved_reviewed',
    qualityReviewHash: 'quality',
    provenanceHash: 'provenance',
    graphHash: 'graph',
    mediaHash: 'new-reviewed-source-video',
    mediaType: 'video',
    width: 1536,
    height: 1024,
    frames: 25,
    durationSeconds: 25 / 7,
    beforeSourceMediaHash: template.example.expectedOutput.sourceTiming.sourceMediaHash,
    cardPreviewPath: '/template-gallery/example.card-preview.mp4',
    cardPreviewSha256: 'card',
  };
  entry.templateLockHash = runtime.templateLockHash(template, entry.modelRevision);
  const selected = (candidate) => runtime.findManifestEntry(template, { schemaVersion: 2, examples: [candidate] });
  assert.ok(selected(entry));
  for (const change of [
    { beforeSourceMediaHash: 'sha256:bytes:' + 'b'.repeat(64) },
    { frames: 24 },
    { durationSeconds: 25 / 16 },
    { cardPreviewSha256: undefined },
    { width: 320, height: 240 },
  ])
    assert.equal(selected({ ...entry, ...change }), undefined);
});
