import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJsonHash } from './canonical-json.mjs';
import { readCanonicalEvidenceFile } from './release-contract-core.mjs';
import { verifyRetainedStructuredText } from './retained-structured-text-evidence.mjs';
import { canonicalJsonHash as galleryJsonHash, validateQualityReview } from './template-gallery-harness.mjs';

const SCOPES = {
  marigold_depth_synthetic_ramp: {
    folder: 'marigold',
    proofKind: 'real_backend_input_bound_model_variant',
    output: 'output.original.webp',
    input: 'input.original.png',
    decision: 'accepted_with_disclosed_limitations',
  },
  smollm2_rain_gauge: {
    folder: 'smollm2',
    proofKind: 'real_backend_prompt_bound_model_variant',
    output: 'output.original.json',
    decision: 'approved',
  },
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readBoundedRecord(path) {
  const stat = lstatSync(path);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 65536,
    'Retained template review data must be a bounded regular file.',
  );
  const bytes = readFileSync(path);
  assert.equal(bytes.length, stat.size, 'Retained template review data changed while reading.');
  return { value: JSON.parse(bytes), sha256: digest(bytes) };
}

export function assessRetainedTemplateAssociation({
  recipe,
  candidate,
  native,
  galleryOutput,
  galleryInput,
  catalogLock,
}) {
  const { template } = recipe;
  const scope = SCOPES[template.id];
  assert.ok(scope, 'Retained Gallery template scope is not reviewed.');
  const { evidence, receipt, evidenceRoot, descriptorBytes } = native;
  assert.equal(candidate.templateId, template.id);
  assert.equal(candidate.workflowId, recipe.workflowId);
  assert.equal(recipe.sourceTaskTemplateId, receipt.sourceTemplateId);
  assert.equal(candidate.sourceTaskContractId, receipt.sourceTemplateId);
  assert.equal(candidate.qualityDecision, scope.decision);
  assert.equal(candidate.redistributionConfirmed, true);
  assert.equal(receipt.workflowId, recipe.workflowId);
  assert.equal(receipt.proofKind, scope.proofKind);
  assert.equal(receipt.modelType, template.modelType);
  assert.equal(receipt.task, template.mode);
  assert.deepEqual(receipt.modelSet, [
    { repoId: template.modelArtifact.value, revision: template.modelArtifact.revision },
  ]);
  assert.equal(receipt.graphHash, recipe.retainedGraphHash);
  assert.equal(receipt.resourceCandidateId, null);
  assert.equal(receipt.canonicalDefaultsExecuted, false);
  assert.ok(Number.isFinite(receipt.executionDurationSeconds) && receipt.executionDurationSeconds > 0);
  assert.ok(Number.isSafeInteger(receipt.peakMemoryBytes) && receipt.peakMemoryBytes > 0);
  assert.equal(template.example.lockedSettings.resourceMode, 'expert');
  assert.equal(receipt.qualificationClaims.publicTemplate, false);
  assert.equal(receipt.qualificationClaims.modelResourceQualified, false);
  assert.deepEqual(
    catalogLock,
    recipe.reviewedCatalogLock,
    'The staged release recipe differs from its reviewed locks.',
  );
  assert.match(catalogLock.templateLockHash, /^tpl_[a-f0-9]{8}$/u);
  assert.match(catalogLock.galleryTemplateLockHash, /^tpl_[a-f0-9]{8}$/u);
  assert.match(catalogLock.promptSettingsHash, /^ps_[a-f0-9]{8}$/u);
  assert.equal(digest(galleryOutput.bytes), galleryOutput.ref.sha256);

  let output;
  if (scope.input) {
    assert.equal(digest(galleryInput.bytes), galleryInput.ref.sha256);
    assert.equal(galleryInput.ref.sha256, receipt.inputBinding.sha256);
    assert.equal(galleryInput.ref.sha256, recipe.inputSha256);
    assert.deepEqual(
      [template.example.expectedOutput.width, template.example.expectedOutput.height],
      [receipt.decodedOutput.width, receipt.decodedOutput.height],
    );
    const source = evidence.inputs[0];
    assert.equal(evidence.inputs.length, 1);
    assert.equal(source.file.sha256, recipe.inputSha256);
    assert.equal(source.sourceValue, recipe.inputFileName);
    assert.equal(template.inputBindings.length, 1);
    const [binding] = template.inputBindings;
    assert.equal(binding.origin, 'user');
    assert.equal(binding.field, 'referenceImages');
    assert.equal(binding.count, 1);
    assert.equal(`sha256:bytes:${galleryOutput.ref.sha256}`, receipt.outputHash);
    output = {
      mediaType: 'image',
      sourceOutputHash: receipt.outputHash,
      outputEncodedSha256: receipt.outputHash,
      decodedMediaHash: receipt.decodedOutput.hash,
      outputBytes: galleryOutput.bytes.length,
      inputEncodedSha256: `sha256:bytes:${galleryInput.ref.sha256}`,
    };
  } else {
    assert.equal(receipt.promptBinding.sha256, recipe.promptSha256);
    assert.equal(digest(template.prompt), recipe.promptSha256);
    assert.ok(template.outputKinds.includes('json'));
    assert.equal(evidence.outputs.length, 1);
    const transport = readCanonicalEvidenceFile(evidenceRoot, evidence.outputs[0].file, 2 * 1024 * 1024);
    output = {
      mediaType: 'json',
      ...verifyRetainedStructuredText({
        receipt,
        transportBytes: transport.bytes,
        structuredBytes: galleryOutput.bytes,
        outputSha256: galleryOutput.ref.sha256,
      }),
    };
  }
  assert.equal(digest(descriptorBytes), recipe.originalReceiptSha256);
  const association = {
    schemaVersion: 1,
    format: 'modiff.retained-template-association.v1',
    templateId: template.id,
    workflowId: receipt.workflowId,
    nativeSourceTaskContractId: receipt.sourceTemplateId,
    catalogTemplateLockHash: catalogLock.templateLockHash,
    galleryTemplateLockHash: catalogLock.galleryTemplateLockHash,
    catalogPromptSettingsHash: catalogLock.promptSettingsHash,
    originalTaskId: receipt.taskId,
    originalGraphHash: receipt.graphHash,
    originalTemplateLockHash: null,
    originalResourceCandidateId: null,
    originalEvidenceSha256: recipe.originalReceiptSha256,
    observedExecution: {
      modelSet: receipt.modelSet,
      runtimeFingerprint: receipt.runtimeFingerprint,
      executionDurationSeconds: receipt.executionDurationSeconds,
      peakMemoryBytes: receipt.peakMemoryBytes,
      observationLimits: receipt.observationLimits,
    },
    output,
    review: {
      qualityDecision: candidate.qualityDecision,
      redistributionConfirmed: true,
      draftReviewSha256: candidate.draftReviewSha256,
      draftProvenanceSha256: candidate.draftProvenanceSha256,
    },
    qualificationScope: 'exact_retained_recipe',
    releaseApprovalGranted: false,
  };
  return {
    ...association,
    associationHash: `sha256:retained-template-association-v1:${canonicalJsonHash(association)}`,
  };
}

// Existing Gallery quality rules also apply to the approved technical preview.
// The final binding describes this reviewed association after execution. It
// does not supply template or resource fields to the original native run.
export function finalizeRetainedQualityReview({ association, draft, reviewer, reviewedAt }) {
  const bindings = {
    templateId: association.templateId,
    templateLockHash: association.galleryTemplateLockHash,
    promptSettingsHash: association.catalogPromptSettingsHash,
    proofLockHash: association.associationHash,
    modelRevision: association.observedExecution.modelSet
      .map(({ repoId, revision }) => `${repoId}@${revision}`)
      .join(' | '),
    runtimeFingerprint: association.observedExecution.runtimeFingerprint,
    graphHash: association.originalGraphHash,
    decodedMediaHash: association.output.decodedMediaHash,
  };
  const review = {
    schemaVersion: 2,
    ...bindings,
    reviewStatus: 'approved_reviewed',
    reviewer,
    reviewedAt,
    rubric: draft.rubric,
    scores: draft.scores,
    hardFailures: draft.hardFailures,
    objectiveChecks: draft.objectiveChecks,
    modalityReview: draft.modalityReview,
    summary: draft.summary,
    knownLimitations: draft.knownLimitations,
  };
  if (association.review.qualityDecision === 'accepted_with_disclosed_limitations') {
    review.maintainerAcceptance = {
      schemaVersion: 1,
      decision: 'accepted_with_disclosed_limitations',
      reviewer,
      acceptedAt: reviewedAt,
      statement:
        'Accepted as a technical depth preview with the reviewed scores and the disclosed limits of the synthetic ramp.',
      acceptedReviewHash: galleryJsonHash(review),
    };
  }
  const errors = validateQualityReview(review, bindings, 'approved_reviewed');
  assert.deepEqual(errors, [], 'The finalized review does not meet Gallery quality rules.');
  return review;
}

// The retained native reader must already have revalidated the original
// evidence descriptor and all inputs, output, runtime and source receipts.
export async function readReviewedBoundTemplateAssociations({ approvalRoot, vite, nativeBySha }) {
  const approvalPath = join(approvalRoot, 'approval.v1.json');
  if (!existsSync(approvalPath)) return new Map();
  const { value: approval } = readBoundedRecord(approvalPath);
  assert.equal(approval.schemaVersion, 1);
  assert.equal(approval.format, 'modiff.private.gallery-candidate-approval.v1');
  assert.equal(approval.publicationStatus, 'private_staging');
  assert.deepEqual(approval.excludedWorkflowIds, ['ShapEPipeline:text_to_3d']);
  assert.ok(
    typeof approval.reviewer === 'string' &&
      approval.reviewer.trim() &&
      Number.isFinite(Date.parse(approval.recordedAt)),
  );
  assert.match(approval.reviewScopeSha256, /^[a-f0-9]{64}$/u);
  assert.ok(Array.isArray(approval.candidates) && approval.candidates.length === Object.keys(SCOPES).length);
  const reviewedScope = readBoundedRecord(join(approvalRoot, 'review-scope.json'));
  assert.equal(reviewedScope.sha256, approval.reviewScopeSha256, 'Original review inventory hash differs.');
  assert.equal(reviewedScope.value.status, 'private_review_only');
  const indexedFiles = new Map(reviewedScope.value.files.map((item) => [item.path, item]));
  assert.equal(indexedFiles.size, reviewedScope.value.files.length, 'Review inventory contains duplicate files.');

  const { RETAINED_GALLERY_TEMPLATES } = await vite.ssrLoadModule('/src/studio/retainedGalleryTemplates.ts');
  const { getTemplateLockHash, getPromptSettingsHash, getTemplateLockedSettings } = await vite.ssrLoadModule(
    '/src/studio/templateExactness.ts',
  );
  const associations = new Map();
  for (const recipe of RETAINED_GALLERY_TEMPLATES) {
    const { template } = recipe;
    const scope = SCOPES[template.id];
    assert.ok(scope, 'Retained Gallery template scope is not reviewed.');
    const matches = approval.candidates.filter((item) => item.templateId === template.id);
    assert.equal(matches.length, 1, 'Exact retained Gallery approval is missing or ambiguous.');
    const [candidate] = matches;
    const settings = getTemplateLockedSettings(template);
    assert.equal(
      canonicalJsonHash({ template, settings }),
      recipe.reviewedTemplateSha256,
      'The staged template definition differs from the reviewed recipe.',
    );
    const names = [scope.output, 'proposed-review.json', 'proposed-provenance.json'];
    if (scope.input) names.push(scope.input);
    assert.ok(Array.isArray(candidate.files) && candidate.files.length === names.length);
    const files = new Map(
      names.map((name) => {
        const refs = candidate.files.filter((item) => item.path === `${scope.folder}/${name}`);
        assert.equal(refs.length, 1, 'Approved Gallery file is missing or ambiguous.');
        const [ref] = refs;
        assert.deepEqual(
          ref,
          indexedFiles.get(ref.path),
          'Approval refers to a file outside the exact review inventory.',
        );
        return [name, { ref, ...readCanonicalEvidenceFile(join(approvalRoot, 'reviewed'), ref, 2 * 1024 * 1024) }];
      }),
    );
    assert.equal(files.get('proposed-review.json').ref.sha256, candidate.draftReviewSha256);
    assert.equal(files.get('proposed-provenance.json').ref.sha256, candidate.draftProvenanceSha256);
    const native = nativeBySha.get(recipe.originalReceiptSha256);
    assert.ok(native, 'The approved original native receipt could not be verified.');
    const media = files.get(scope.output);
    const draft = JSON.parse(files.get('proposed-review.json').bytes);
    assert.equal(draft.outputSha256, media.ref.sha256);
    assert.equal(draft.graphHash, native.receipt.graphHash);
    assert.equal(draft.runtimeFingerprint, native.receipt.runtimeFingerprint);
    assert.equal(draft.modelRevision, `${template.modelArtifact.value}@${template.modelArtifact.revision}`);
    assert.ok(
      !draft.reviewer && !draft.reviewedAt,
      'The reviewed draft must preserve original pending review metadata.',
    );
    const association = assessRetainedTemplateAssociation({
      recipe,
      candidate,
      native,
      galleryOutput: media,
      galleryInput: scope.input ? files.get(scope.input) : undefined,
      catalogLock: {
        templateLockHash: getTemplateLockHash(template),
        galleryTemplateLockHash: getTemplateLockHash(template, draft.modelRevision),
        promptSettingsHash: getPromptSettingsHash(settings),
      },
    });
    assert.equal(draft.decodedMediaHash, association.output.decodedMediaHash);
    const qualityReview = finalizeRetainedQualityReview({
      association,
      draft,
      reviewer: approval.reviewer,
      reviewedAt: approval.recordedAt,
    });
    assert.ok(!associations.has(association.workflowId), 'Retained Gallery workflow association is duplicated.');
    associations.set(association.workflowId, { ...association, qualityReviewHash: galleryJsonHash(qualityReview) });
  }
  assert.equal(associations.size, approval.candidates.length);
  assert.equal(
    indexedFiles.size,
    approval.candidates.reduce((total, item) => total + item.files.length, 0),
  );
  return associations;
}
