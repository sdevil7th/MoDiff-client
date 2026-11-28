import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJsonHash, validateQualityReview } from './template-gallery-harness.mjs';

function fixture() {
  const expected = {
    templateId: 'example_image',
    templateLockHash: 'tpl_example',
    promptSettingsHash: 'ps_example',
    modelRevision: 'example/model@' + 'a'.repeat(40),
    runtimeFingerprint: 'sha256:stable-runtime-v1:' + 'b'.repeat(64),
    graphHash: 'sha256:canonical-graph-v1:' + 'c'.repeat(64),
    proofLockHash: 'sha256:live-proof-lock-v1:' + 'd'.repeat(64),
    decodedMediaHash: 'sha256:decoded-rgba:' + 'e'.repeat(64),
  };
  const review = {
    schemaVersion: 2,
    ...expected,
    reviewStatus: 'approved_reviewed',
    reviewer: 'Example maintainer',
    reviewedAt: '2026-11-10T10:00:00.000Z',
    rubric: { taskAdherence: 3, artifactControl: 4, modalityQuality: 4 },
    scores: { promptAdherence: 3, composition: 4, technicalExecution: 4, templateUsefulness: 3 },
    hardFailures: [],
    objectiveChecks: { status: 'pass' },
    modalityReview: { status: 'pass' },
    summary: 'The maintainer accepts the useful example with its documented composition limitation.',
    knownLimitations: ['The person stands centrally instead of in the requested right third.'],
  };
  review.maintainerAcceptance = {
    schemaVersion: 1,
    decision: 'accepted_with_disclosed_limitations',
    reviewer: review.reviewer,
    acceptedAt: review.reviewedAt,
    statement: 'I accept this reviewed asset and request its registration with the disclosed limitations.',
    acceptedReviewHash: canonicalJsonHash(review),
  };
  return { review, expected };
}

test('explicit maintainer acceptance retains the original below-threshold quality scores', () => {
  const { review, expected } = fixture();
  assert.deepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  assert.equal(review.scores.promptAdherence, 3);
  assert.equal(review.rubric.taskAdherence, 3);
});

test('ordinary reviews retain the four-out-of-five minimum', () => {
  const { review, expected } = fixture();
  delete review.maintainerAcceptance;
  assert.match(validateQualityReview(review, expected, 'approved_reviewed').join('\n'), /between 4 and 5/);
});

for (const [name, mutate] of Object.entries({
  media: (r) => {
    r.decodedMediaHash += 'changed';
  },
  graph: (r) => {
    r.graphHash += 'changed';
  },
  score: (r) => {
    r.scores.promptAdherence = 2;
  },
  limitation: (r) => {
    r.knownLimitations[0] = 'A different defect.';
  },
  reviewer: (r) => {
    r.maintainerAcceptance.reviewer = 'Someone else';
  },
  timestamp: (r) => {
    r.maintainerAcceptance.acceptedAt = '2026-11-11T10:00:00.000Z';
  },
  statement: (r) => {
    r.maintainerAcceptance.statement = '';
  },
  decision: (r) => {
    r.maintainerAcceptance.decision = 'automatic';
  },
  extra: (r) => {
    r.maintainerAcceptance.skipTechnicalProof = true;
  },
  missing: (r) => {
    delete r.maintainerAcceptance.acceptedReviewHash;
  },
})) {
  test(`maintainer acceptance rejects a changed ${name}`, () => {
    const { review, expected } = fixture();
    mutate(review);
    assert.notDeepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  });
}

test('acceptance cannot waive invalid scores, hard failures or objective checks', () => {
  for (const mutate of [
    (r) => {
      r.scores.promptAdherence = 0;
    },
    (r) => {
      r.hardFailures = ['Missing requested output.'];
    },
    (r) => {
      r.objectiveChecks.status = 'fail';
    },
    (r) => {
      r.modalityReview.status = 'fail';
    },
    (r) => {
      r.knownLimitations = [];
    },
  ]) {
    const { review, expected } = fixture();
    mutate(review);
    const acceptance = review.maintainerAcceptance;
    delete review.maintainerAcceptance;
    acceptance.acceptedReviewHash = canonicalJsonHash(review);
    review.maintainerAcceptance = acceptance;
    assert.notDeepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  }
});

function videoFixture() {
  const { review, expected } = fixture();
  expected.templateId = 'ltx_video_text_to_video';
  expected.decodedMediaHash = 'sha256:decoded-video:' + 'e'.repeat(64);
  Object.assign(review, expected, {
    schemaVersion: 4,
    physicalConsistency: { status: 'pass', checks: ['Coherent track.', 'Stable forest.', 'Plausible horizon.'] },
    visualDiversity: {
      status: 'pass',
      themeId: 'forest-rail',
      nearestTemplateId: 'other_video',
      distinctFromNearest: true,
    },
    visualIntent: 'photoreal',
    realismReview: {
      status: 'pass',
      looksPhotographic: true,
      physicallyPlausibleLighting: true,
      physicallyPlausibleMaterials: true,
      physicallyPlausibleDynamics: true,
    },
    motionReview: {
      status: 'limited',
      fullPlaybackReviewed: true,
      frameCount: 121,
      durationSeconds: 5.041667,
      sceneMotionCoveragePercent: 60,
      visibleMotionMilestones: ['Sleepers pass.', 'Post passes.', 'Tunnel approaches.'],
      temporalDefects: ['Minor overhead-wire deformation.'],
    },
    temporalGeometryReview: {
      status: 'limited',
      subjectMorphing: 'visible',
      scaleDrift: 'none',
      contactSliding: 'none',
      frameGlitches: 'none',
    },
    cardPreviewReview: {
      status: 'pass',
      reviewedAtCardSize: true,
      readsAsMovingVideo: true,
      foregroundMotionMilestones: ['Sleepers pass.', 'Post passes.', 'Tunnel approaches.'],
    },
    userFeedbackResolution: {
      status: 'pass',
      replacementOutput: true,
      resolvedIssues: ['The replacement has continuous scene travel.', 'Foreground posts visibly pass the camera.'],
    },
  });
  const acceptance = review.maintainerAcceptance;
  delete review.maintainerAcceptance;
  acceptance.acceptedFindings = [
    'dynamic video review motionReview.status must be pass',
    'dynamic video review temporalDefects must be an empty array',
    'dynamic video review requires passing temporal geometry review',
    'dynamic video temporalGeometryReview.subjectMorphing must be none',
  ];
  acceptance.acceptedReviewHash = canonicalJsonHash(review);
  review.maintainerAcceptance = acceptance;
  return { review, expected };
}

test('a maintainer can retain expressly accepted temporal findings in a reviewed video', () => {
  const { review, expected } = videoFixture();
  assert.deepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  assert.equal(review.temporalGeometryReview.subjectMorphing, 'visible');
  delete review.maintainerAcceptance;
  assert.match(validateQualityReview(review, expected, 'approved_reviewed').join('\n'), /subjectMorphing/);
});

test('visual acceptance still requires playback, card review and technical duration evidence', () => {
  for (const mutate of [
    (r) => {
      r.motionReview.fullPlaybackReviewed = false;
    },
    (r) => {
      r.cardPreviewReview.reviewedAtCardSize = false;
    },
    (r) => {
      r.motionReview.frameCount = 1;
    },
    (r) => {
      r.motionReview.durationSeconds = 1;
    },
  ]) {
    const { review, expected } = videoFixture();
    mutate(review);
    const acceptance = review.maintainerAcceptance;
    delete review.maintainerAcceptance;
    acceptance.acceptedReviewHash = canonicalJsonHash(review);
    review.maintainerAcceptance = acceptance;
    assert.notDeepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
  }
  const { review, expected } = videoFixture();
  review.maintainerAcceptance.acceptedFindings.push('execution.resourceCandidateId is missing.');
  assert.notDeepEqual(validateQualityReview(review, expected, 'approved_reviewed'), []);
});
