import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readCanonicalEvidenceFile } from './release-contract-core.mjs';
import {
  canonicalJsonHash as galleryJsonHash,
  galleryVerificationScope,
  validateQualityReview,
} from './template-gallery-harness.mjs';
import { validateRetainedGalleryProvenance } from './retained-gallery-provenance.mjs';

const same = (actual, expected, label) => assert.deepEqual(actual, expected, label);

export function verifiedRetainedGalleryAssetIndex(clientRoot, expectedSource) {
  const { source, assets } = galleryVerificationScope(clientRoot);
  same(source, expectedSource, 'Retained release evidence differs from the activated Gallery source.');
  assert.equal(source.mode, 'huggingface', 'Retained release evidence requires an activated public Gallery.');
  return new Map(assets.map((asset) => [asset.path, asset]));
}

export function createRetainedGalleryReleaseReader({ clientRoot, source, registry }) {
  let approved;
  const open = (path) => {
    assert.ok(typeof path === 'string' && path.startsWith('/template-gallery/'), 'Invalid retained Gallery path.');
    const asset = approved.get(path.slice(1));
    assert.ok(
      asset && /^sha256:bytes:[a-f0-9]{64}$/u.test(asset.sha256),
      'Retained Gallery asset is unapproved or unregistered.',
    );
    return readCanonicalEvidenceFile(
      join(clientRoot, 'public'),
      {
        path: asset.path,
        bytes: asset.size,
        sha256: asset.sha256.slice('sha256:bytes:'.length),
      },
      2 * 1024 * 1024,
    ).bytes;
  };

  return ({ recipe, entry, sourceWorkflow, templateRevisionHash, localAssociation }) => {
    if (!sourceWorkflow || !entry?.proofLockHash?.startsWith('sha256:retained-template-association-v1:')) return null;
    if (!approved) {
      approved = verifiedRetainedGalleryAssetIndex(clientRoot, source);
      same(JSON.parse(open('/template-gallery/manifest.json')), registry, 'Registered Gallery manifest differs.');
    }
    assert.equal(sourceWorkflow.manifest.id, recipe.workflowId);
    assert.equal(sourceWorkflow.manifest.sourceTemplateId, recipe.sourceTaskTemplateId);
    const bundle = JSON.parse(open(entry.provenancePath));
    assert.equal(galleryJsonHash(bundle), entry.provenanceHash);
    same(
      validateRetainedGalleryProvenance(bundle, entry, {
        templateRevisionHash,
        outputBytes: open(entry.outputPath),
        beforeBytes: entry.beforePath ? open(entry.beforePath) : undefined,
      }),
      [],
      'Retained Gallery provenance differs from the approved recipe.',
    );
    assert.equal(entry.thumbnailPath, entry.outputPath, 'The published retained example uses an unreviewed thumbnail.');
    const { association } = bundle;
    assert.equal(association.workflowId, recipe.workflowId);
    assert.equal(association.nativeSourceTaskContractId, sourceWorkflow.manifest.sourceTemplateId);
    if (localAssociation) {
      const { originalTaskId, ...redacted } = localAssociation;
      same(association, redacted, 'Published Gallery proof differs from the locally revalidated saved run.');
    }
    const review = JSON.parse(open(entry.qualityReviewPath));
    assert.equal(galleryJsonHash(review), entry.qualityReviewHash);
    assert.equal(association.qualityReviewHash, entry.qualityReviewHash);
    const reviewBindings = Object.fromEntries(
      [
        'templateId',
        'templateLockHash',
        'promptSettingsHash',
        'modelRevision',
        'runtimeFingerprint',
        'graphHash',
        'proofLockHash',
      ].map((key) => [key, entry[key]]),
    );
    assert.equal(entry.reviewer, review.reviewer);
    assert.equal(entry.reviewedAt, review.reviewedAt);
    same(
      validateQualityReview(
        review,
        {
          ...reviewBindings,
          decodedMediaHash: entry.mediaHash,
        },
        'approved_reviewed',
      ),
      [],
      'Retained Gallery quality review failed.',
    );
    const { observedExecution } = association;
    assert.ok(
      Number.isFinite(observedExecution.executionDurationSeconds) && observedExecution.executionDurationSeconds > 0,
    );
    assert.ok(Number.isSafeInteger(observedExecution.peakMemoryBytes) && observedExecution.peakMemoryBytes > 0);
    return {
      templateId: entry.templateId,
      proofKind: 'reviewed_retained_template_execution',
      proofFormat: bundle.format,
      capturedAt: entry.verificationTimestamp,
      graphHash: association.originalGraphHash,
      canonicalWorkflowHash: sourceWorkflow.contract.graphHash,
      backendNodes: sourceWorkflow.contract.backendNodes,
      catalogTemplateLockHash: association.catalogTemplateLockHash,
      promptSettingsHash: association.catalogPromptSettingsHash,
      modelRevision: entry.modelRevision,
      runtimeFingerprint: observedExecution.runtimeFingerprint,
      backendSourceFingerprint: entry.backendSourceFingerprint,
      backendContractFingerprint: entry.backendContractFingerprint,
      resourceCandidateId: null,
      executionDurationSeconds: observedExecution.executionDurationSeconds,
      peakMemoryBytes: observedExecution.peakMemoryBytes,
      mediaHash: entry.mediaHash,
      outputHash: entry.mediaHash,
      outputPath: entry.outputPath,
      provenancePath: entry.provenancePath,
      provenanceHash: entry.provenanceHash,
      verificationStatus: entry.verificationStatus,
      qualityReviewStatus: entry.qualityReviewStatus,
      evidenceMatch: 'current_reviewed_retained_recipe',
    };
  };
}
