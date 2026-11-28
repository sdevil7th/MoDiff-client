import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { assessRetainedTemplateAssociation, finalizeRetainedQualityReview } from './retained-template-association.mjs';
import { canonicalJsonHash, validateQualityReview } from './template-gallery-harness.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const templateId = 'marigold_depth_synthetic_ramp';
  const workflowId = 'MarigoldDepthPipeline:depth_estimation';
  const sourceTaskTemplateId = 'task-template:marigold-depth-lcm-v1-0:depth-estimation:v1';
  const model = { repoId: 'prs-eth/marigold-depth-lcm-v1-0', revision: 'a'.repeat(40) };
  const descriptorBytes = Buffer.from('verified descriptor');
  const input = Buffer.from('verified native input');
  const output = Buffer.from('verified native output');
  const inputSha256 = sha(input);
  const retainedGraphHash = `sha256:canonical-graph-v1:${'b'.repeat(64)}`;
  const catalogLock = {
    templateLockHash: 'tpl_00000000',
    galleryTemplateLockHash: 'tpl_11111111',
    promptSettingsHash: 'ps_00000000',
  };
  return {
    recipe: {
      workflowId,
      sourceTaskTemplateId,
      retainedGraphHash,
      originalReceiptSha256: sha(descriptorBytes),
      reviewedCatalogLock: { ...catalogLock },
      inputSha256,
      inputFileName: 'marigold-depth-source.png',
      template: {
        id: templateId,
        mode: 'depth_estimation',
        modelType: 'MarigoldDepthPipeline',
        modelArtifact: { value: model.repoId, revision: model.revision },
        example: { lockedSettings: { resourceMode: 'expert' }, expectedOutput: { width: 64, height: 48 } },
        inputBindings: [{ origin: 'user', field: 'referenceImages', count: 1 }],
      },
    },
    candidate: {
      templateId,
      workflowId,
      sourceTaskContractId: sourceTaskTemplateId,
      qualityDecision: 'accepted_with_disclosed_limitations',
      redistributionConfirmed: true,
      draftReviewSha256: 'c'.repeat(64),
      draftProvenanceSha256: 'd'.repeat(64),
    },
    native: {
      descriptorBytes,
      evidence: { inputs: [{ sourceValue: 'marigold-depth-source.png', file: { sha256: inputSha256 } }] },
      receipt: {
        workflowId,
        sourceTemplateId: sourceTaskTemplateId,
        proofKind: 'real_backend_input_bound_model_variant',
        modelType: 'MarigoldDepthPipeline',
        task: 'depth_estimation',
        modelSet: [model],
        graphHash: retainedGraphHash,
        resourceCandidateId: null,
        canonicalDefaultsExecuted: false,
        taskId: 'retained-private-task',
        outputHash: `sha256:bytes:${sha(output)}`,
        runtimeFingerprint: `sha256:stable-runtime-v1:${'e'.repeat(64)}`,
        inputBinding: { sha256: inputSha256 },
        decodedOutput: { width: 64, height: 48, hash: `sha256:decoded-rgba:${'f'.repeat(64)}` },
        executionDurationSeconds: 2.3,
        peakMemoryBytes: 16000000,
        observationLimits: { numericDepthPrediction: false, fullConsumedFieldAccounting: false },
        qualificationClaims: { publicTemplate: false, modelResourceQualified: false },
      },
    },
    galleryInput: { ref: { sha256: inputSha256 }, bytes: input },
    galleryOutput: { ref: { sha256: sha(output) }, bytes: output },
    catalogLock,
  };
}

test('binds an accepted source image and result to the observed recipe without inventing run locks', () => {
  const reviewed = fixture();
  const before = structuredClone(reviewed.native.receipt);
  const result = assessRetainedTemplateAssociation(reviewed);
  assert.equal(result.qualificationScope, 'exact_retained_recipe');
  assert.equal(result.originalTemplateLockHash, null);
  assert.equal(result.originalResourceCandidateId, null);
  assert.equal(result.releaseApprovalGranted, false);
  assert.equal(result.output.decodedMediaHash, before.decodedOutput.hash);
  assert.equal(result.observedExecution.peakMemoryBytes, before.peakMemoryBytes);
  assert.equal(result.observedExecution.observationLimits.numericDepthPrediction, false);
  assert.deepEqual(reviewed.native.receipt, before);
});

test('uses the normal Gallery verifier for the approved limited technical example', () => {
  const association = assessRetainedTemplateAssociation(fixture());
  const review = finalizeRetainedQualityReview({
    association,
    draft: {
      rubric: { taskAdherence: 3, artifactControl: 4, modalityQuality: 3 },
      scores: { promptAdherence: 3, composition: 3, technicalExecution: 4, templateUsefulness: 2 },
      hardFailures: [],
      objectiveChecks: { status: 'pass', checks: ['Image decodes at retained dimensions.'] },
      modalityReview: { status: 'pass', method: 'Review native output', findings: ['Preview is visible.'] },
      summary: 'The output demonstrates preview delivery at source size.',
      knownLimitations: ['The ramp provides no relative depth ground truth.'],
    },
    reviewer: 'Maintainer',
    reviewedAt: '2026-11-19T13:00:00.000Z',
  });
  const { maintainerAcceptance, ...accepted } = review;
  assert.equal(maintainerAcceptance.acceptedReviewHash, canonicalJsonHash(accepted));
  assert.equal(review.scores.templateUsefulness, 2);
  const changed = { ...review, scores: { ...review.scores, templateUsefulness: 3 } };
  assert.match(
    validateQualityReview(changed, {}, 'approved_reviewed').join(' '),
    /must bind the exact accepted review/u,
  );
});

test('rejects changed scope, approval, recipe, model or delivery', () => {
  for (const alter of [
    (value) => {
      value.recipe.template.id = 'shap_e_radio';
    },
    (value) => {
      value.candidate.redistributionConfirmed = false;
    },
    (value) => {
      value.candidate.qualityDecision = 'approved';
    },
    (value) => {
      value.recipe.retainedGraphHash += '-changed';
    },
    (value) => {
      value.catalogLock.templateLockHash = 'tpl_22222222';
    },
    (value) => {
      value.recipe.template.modelArtifact.revision = 'b'.repeat(40);
    },
    (value) => {
      value.recipe.template.example.lockedSettings.resourceMode = 'auto';
    },
    (value) => {
      value.recipe.template.example.expectedOutput.width = 65;
    },
    (value) => {
      value.galleryInput.ref.sha256 = 'f'.repeat(64);
    },
    (value) => {
      value.galleryOutput.ref.sha256 = 'f'.repeat(64);
    },
    (value) => {
      value.galleryOutput.bytes = Buffer.from('different bytes');
    },
    (value) => {
      value.native.descriptorBytes = Buffer.from('different descriptor');
    },
    (value) => {
      value.native.receipt.resourceCandidateId = 'unobserved-candidate';
    },
    (value) => {
      value.native.receipt.qualificationClaims.modelResourceQualified = true;
    },
  ]) {
    const value = fixture();
    alter(value);
    assert.throws(() => assessRetainedTemplateAssociation(value));
  }
});
