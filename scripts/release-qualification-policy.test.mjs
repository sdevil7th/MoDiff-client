import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyResourceRecipeReleaseLanes,
  captureQualificationStatus,
  evaluateSupportedProfileCoverage,
  hardwareReceiptIsCurrent,
  hardwareReceiptQualifies,
} from './release-qualification-policy.mjs';

test('experimental, conditional, and preview captures remain observations', () => {
  assert.equal(captureQualificationStatus('experimental'), 'observed');
  assert.equal(captureQualificationStatus('conditional'), 'observed');
  assert.equal(captureQualificationStatus('preview'), 'observed');
  assert.equal(captureQualificationStatus('supported'), 'qualified');
});

test('hardware evidence must match the supported tier, profile, and manifest revision', () => {
  const receipt = {
    status: 'qualified',
    supportTierAtCapture: 'supported',
    profileId: 'nvidia-cuda',
    manifestRevision: 'revision-2',
  };
  assert.equal(hardwareReceiptQualifies(receipt, 'nvidia-cuda', 'revision-2'), true);
  assert.equal(hardwareReceiptQualifies(receipt, 'nvidia-cuda', 'revision-1'), false);
  assert.equal(hardwareReceiptQualifies(receipt, 'apple-mps', 'revision-2'), false);
  assert.equal(
    hardwareReceiptQualifies({ ...receipt, supportTierAtCapture: 'experimental' }, 'nvidia-cuda', 'revision-2'),
    false,
  );
  assert.equal(
    hardwareReceiptIsCurrent(
      {
        status: 'observed',
        supportTierAtCapture: 'experimental',
        profileId: 'amd-rocm-linux',
        manifestRevision: 'revision-2',
      },
      'revision-2',
    ),
    true,
  );
});

test('the hardware gate cannot pass with no supported profile', () => {
  const coverage = evaluateSupportedProfileCoverage({ cpu: { tier: 'preview' } }, [], 'revision-2');
  assert.equal(coverage.hasSupportedProfile, false);
  assert.equal(coverage.allSupportedProfilesQualified, false);
});

test('every advertised supported profile requires current physical evidence', () => {
  const profiles = {
    cpu: { tier: 'supported' },
    'nvidia-cuda': { tier: 'supported' },
    'amd-rocm-linux': { tier: 'conditional' },
  };
  const coverage = evaluateSupportedProfileCoverage(
    profiles,
    [
      {
        status: 'qualified',
        supportTierAtCapture: 'supported',
        profileId: 'cpu',
        manifestRevision: 'revision-2',
      },
      {
        status: 'qualified',
        supportTierAtCapture: 'supported',
        profileId: 'nvidia-cuda',
        manifestRevision: 'revision-1',
      },
      {
        status: 'observed',
        supportTierAtCapture: 'conditional',
        profileId: 'amd-rocm-linux',
        manifestRevision: 'revision-2',
      },
    ],
    'revision-2',
  );
  assert.deepEqual(coverage.advertisedSupportedProfiles, ['cpu', 'nvidia-cuda']);
  assert.deepEqual(coverage.physicallyQualifiedProfiles, ['cpu']);
  assert.deepEqual(coverage.physicallyObservedProfiles, ['amd-rocm-linux', 'cpu']);
  assert.deepEqual(coverage.unqualifiedSupportedProfiles, ['nvidia-cuda']);
  assert.deepEqual(coverage.profileTiers, {
    'amd-rocm-linux': 'conditional',
    cpu: 'supported',
    'nvidia-cuda': 'supported',
  });
  assert.equal(coverage.allSupportedProfilesQualified, false);
});

test('resource recipe coverage separates release-eligible alternatives from deferred work', () => {
  const result = classifyResourceRecipeReleaseLanes(
    [
      { id: 'native', templates: ['fast-image'], status: 'qualified' },
      { id: 'offload', templates: ['fast-image', 'deferred-video'], status: 'missing' },
      { id: 'video-native', templates: ['deferred-video'], status: 'qualified' },
      { id: 'video-offload', templates: ['deferred-video'], status: 'missing' },
    ],
    new Set(['fast-image']),
  );

  assert.deepEqual(
    result.recipes.map(({ id, releaseLane }) => ({ id, releaseLane })),
    [
      { id: 'native', releaseLane: 'release_eligible' },
      { id: 'offload', releaseLane: 'release_eligible' },
      { id: 'video-native', releaseLane: 'deferred' },
      { id: 'video-offload', releaseLane: 'deferred' },
    ],
  );
  assert.deepEqual(result.coverage, {
    releaseEligible: { required: 2, qualified: 1, missing: 1 },
    deferred: { required: 2, qualified: 1, missing: 1 },
  });
});
