import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readCanonicalEvidenceFile } from './release-contract-core.mjs';
import {
  canonicalJsonHash as galleryJsonHash,
  galleryVerificationScope,
  validateQualityReview,
} from './template-gallery-harness.mjs';
import { validateRetainedGalleryProvenance, verifyRetainedApprovedFiles } from './retained-gallery-provenance.mjs';
import { verifyRetainedSpeechGalleryEvidence } from './retained-speech-gallery-evidence.mjs';

const same = (actual, expected, label) => assert.deepEqual(actual, expected, label);

function assertRetainedNativeIdentity(association, entry, nativeReceipt, label) {
  const { observedExecution, output } = association;
  const expected = {
    sourceTemplateId: association.nativeSourceTaskContractId,
    workflowId: association.workflowId,
    proofKind: association.nativeProofKind ?? 'real_backend_input_bound_model_variant',
    capturedAt: entry.verificationTimestamp,
    backendSourceFingerprint: entry.backendSourceFingerprint,
    canonicalWorkflowHash: association.originalCanonicalWorkflowHash,
    graphHash: association.originalGraphHash,
    evidenceSha256: association.originalEvidenceSha256,
    modelSet: observedExecution.modelSet,
    ...(association.nativeProofKind !== 'real_backend_weights' && {
      observationLimits: observedExecution.observationLimits,
    }),
    outputHash: output.sourceOutputHash,
    runtimeFingerprint: observedExecution.runtimeFingerprint,
    executionDurationSeconds: observedExecution.executionDurationSeconds,
    peakMemoryBytes: observedExecution.peakMemoryBytes,
    resourceCandidateId: association.originalResourceCandidateId,
  };
  const actual = Object.fromEntries(Object.keys(expected).map((key) => [key, nativeReceipt[key]]));
  same(actual, expected, label);
}

function assertRetainedBatchEvidence({
  recipe,
  sourceWorkflow,
  association,
  entry,
  native,
  nativeReceipt,
  outputBytes,
}) {
  assert.equal(association.originalCanonicalWorkflowHash, sourceWorkflow.contract.graphHash);
  assert.equal(association.originalEvidenceSha256, recipe.originalReceiptSha256);
  assert.equal(association.originalGraphHash, recipe.retainedGraphHash);
  assert.equal(
    association.originalResourceCandidateId,
    recipe.workflowId === 'DDIMPipeline:unconditional_image'
      ? 'manual-resource-v1:DDIMPipeline|float32|none|none'
      : null,
  );
  assert.equal(association.originalTemplateLockHash, null);
  assert.equal(association.observedExecution.backendContractFingerprint, entry.backendContractFingerprint);
  assert.equal(association.observedExecution.observationLimits.physicalPlatformQualification, false);
  assert.equal(association.review.redistributionConfirmed, true);
  assert.equal(association.approvedFiles.approvedOriginalReviewPath.sha256, association.review.draftReviewSha256);
  assert.equal(
    association.approvedFiles.approvedOriginalProvenancePath.sha256,
    association.review.draftProvenanceSha256,
  );
  const inputHash =
    association.output.inputEncodedSha256?.replace(/^sha256:bytes:/u, '') ??
    association.approvedFiles.approvedSourcePath?.sha256 ??
    association.privateSourceSha256;
  assert.equal(inputHash, recipe.inputSha256);
  assert.equal(association.approvedFiles.approvedMaskPath?.sha256, recipe.maskSha256);
  assert.equal(association.approvedFiles.approvedGuidePath?.sha256, recipe.guideSha256);
  assert.equal(association.approvedFiles.approvedClosingFramePath?.sha256, recipe.lastFrameSha256);
  assert.equal(
    association.output.maskEncodedSha256,
    recipe.maskSha256 ? 'sha256:bytes:' + recipe.maskSha256 : undefined,
  );
  if (!nativeReceipt) return;
  const label = 'Published Gallery batch proof differs from the verified native receipt.';
  assertRetainedNativeIdentity(association, entry, nativeReceipt, label);
  if (recipe.workflowId === 'DDIMPipeline:unconditional_image') {
    assert.equal(nativeReceipt.proofKind, 'real_backend_weights', label);
    assert.equal(nativeReceipt.backendContractFingerprint, entry.backendContractFingerprint, label);
    assert.equal(native.provenance.output.collectionHash, nativeReceipt.outputHash, label);
    const [image] = native.provenance.output.items;
    assert.equal(native.provenance.output.count, 1, label);
    assert.equal(image.backendMediaHash, association.output.outputEncodedSha256, label);
    assert.equal(image.decodedSha256, association.output.decodedMediaHash, label);
    assert.deepEqual([image.width, image.height], [entry.width, entry.height], label);
    return;
  }
  assert.equal(nativeReceipt.canonicalDefaultsExecuted, false, label);
  if (recipe.workflowId === 'HuggingFaceSpeechRecognitionModel:speech_translation') {
    const verified = verifyRetainedSpeechGalleryEvidence({
      recipe,
      native,
      galleryOutput: {
        bytes: outputBytes,
        ref: {
          bytes: association.output.outputBytes,
          sha256: association.output.outputEncodedSha256.slice('sha256:bytes:'.length),
        },
      },
    });
    assert.deepEqual(verified.output, association.output, label);
    assert.equal(verified.backendContractFingerprint, entry.backendContractFingerprint, label);
    return;
  }
  assert.equal(nativeReceipt.backendContractFingerprint, entry.backendContractFingerprint, label);
  assert.equal(nativeReceipt.promptBinding.sha256, recipe.promptSha256, label);
  assert.equal(nativeReceipt.inputBinding?.sha256, recipe.inputSha256, label);
  assert.equal(nativeReceipt.maskBinding?.sha256, recipe.maskSha256, label);
  assert.equal(nativeReceipt.guideBinding?.sha256, recipe.guideSha256, label);
  assert.equal(nativeReceipt.lastFrameBinding?.sha256, recipe.lastFrameSha256, label);
  if (recipe.workflowId === 'QwenImageLayeredPipeline:layer_decomposition') {
    const { orderedLayerItems } = association.output;
    same(nativeReceipt.decodedOutput, { kind: 'image_collection', items: orderedLayerItems }, label);
    assert.equal(orderedLayerItems.length, recipe.template.example.lockedSettings.layers, label);
    for (const [index, layer] of orderedLayerItems.entries()) {
      assert.equal(association.approvedFiles[`approvedLayer${index + 1}Path`]?.sha256, layer.encodedSha256, label);
    }
  } else if (association.output.mediaType === 'image') {
    assert.equal(nativeReceipt.decodedOutput.hash, association.output.decodedMediaHash, label);
  }
  if (association.output.mediaType === 'audio') {
    const { decodedMediaHash, durationSeconds, sampleRate, channels, outputEncodedSha256 } = association.output;
    same(
      nativeReceipt.decodedOutput,
      { kind: 'audio', hash: decodedMediaHash, durationSeconds, sampleRate, channels },
      label,
    );
    assert.equal(outputEncodedSha256, nativeReceipt.outputHash, label);
  }
  if (association.output.mediaType === 'video') {
    const { decodedMediaHash, outputEncodedSha256, video } = association.output;
    const { hasAudio, ...videoMetadata } = video;
    assert.equal(hasAudio, false, label);
    same(nativeReceipt.decodedOutput, { kind: 'video', hash: decodedMediaHash, ...videoMetadata }, label);
    assert.equal(outputEncodedSha256, nativeReceipt.outputHash, label);
  }
}

function assertRetainedSpandrelEvidence({ recipe, sourceWorkflow, association, entry, nativeReceipt }) {
  const { observedExecution, output } = association;
  const { modelArtifact, observationLimits } = observedExecution;
  assert.equal(association.originalCanonicalWorkflowHash, sourceWorkflow.contract.graphHash);
  assert.equal(association.originalEvidenceSha256, recipe.originalReceiptSha256);
  assert.equal(association.originalGraphHash, recipe.retainedGraphHash);
  same(
    observationLimits,
    { fullConsumedFieldAccounting: false, physicalPlatformQualification: false },
    'Spandrel retained evidence has a broader scope than its saved run.',
  );
  assert.equal(association.originalResourceCandidateId, null);
  assert.equal(association.originalTemplateLockHash, null);
  const { modelArtifact: selected } = recipe.template;
  same(
    modelArtifact.artifact,
    {
      source: 'hub',
      repository: selected.value,
      revision: selected.revision,
      weightName: 'RealESRGAN_x2plus.pth',
      sha256: selected.sha256,
    },
    'Spandrel retained checkpoint differs from the template.',
  );
  assert.equal(modelArtifact.byteSize, selected.byteSize);
  assert.equal(output.inputEncodedSha256, `sha256:bytes:${recipe.inputSha256}`);
  if (!nativeReceipt) return;
  const label = 'Published Spandrel proof differs from the verified native receipt.';
  assertRetainedNativeIdentity(association, entry, nativeReceipt, label);
  same(nativeReceipt.modelArtifact, modelArtifact, label);
  assert.equal(nativeReceipt.decodedOutput?.hash, output.decodedMediaHash, label);
  assert.equal(nativeReceipt.inputBinding?.sha256, recipe.inputSha256);
}

function assertRetainedTechnicalRecipe({ recipe, sourceWorkflow, association, entry, nativeReceipt }) {
  const { observedExecution, output, recipeObservation } = association;
  const speech = output.mediaType === 'json';
  assert.equal(association.originalCanonicalWorkflowHash, sourceWorkflow.contract.graphHash);
  assert.equal(association.originalEvidenceSha256, recipe.originalReceiptSha256);
  assert.equal(association.originalGraphHash, recipe.retainedGraphHash);
  assert.equal(association.originalResourceCandidateId, null);
  assert.equal(association.originalTemplateLockHash, null);
  assert.equal(observedExecution.backendContractFingerprint, entry.backendContractFingerprint);
  assert.equal(observedExecution.observationLimits.physicalPlatformQualification, false);
  if (speech) {
    assert.equal(recipeObservation.input.sha256, recipe.inputSha256);
    assert.equal(recipeObservation.input.galleryScope, 'private_source_hash_only');
    assert.equal(entry.beforePath, undefined);
  } else {
    assert.equal(output.inputEncodedSha256, `sha256:bytes:${recipe.inputSha256}`);
    assert.equal(recipeObservation.observedEditControls.prompt, recipe.template.prompt);
    assert.equal(observedExecution.observationLimits.sourceGeometryQualified, false);
  }
  if (!nativeReceipt) return;
  assertRetainedNativeIdentity(
    association,
    entry,
    nativeReceipt,
    'Published recipe differs from the verified native receipt.',
  );
  assert.equal(nativeReceipt.canonicalDefaultsExecuted, false);
  assert.equal(nativeReceipt.inputBinding?.sha256, recipe.inputSha256);
  if (speech) {
    same(nativeReceipt.transcriptEvidence, recipeObservation.transcript, 'Published transcript observations differ.');
  } else {
    assert.equal(nativeReceipt.backendContractFingerprint, entry.backendContractFingerprint);
    assert.equal(nativeReceipt.promptBinding.sha256, recipe.promptSha256);
    assert.equal(nativeReceipt.decodedOutput.hash, output.decodedMediaHash);
  }
}

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

  return ({ recipe, entry, sourceWorkflow, templateRevisionHash, localAssociation, native, nativeReceipt }) => {
    if (!sourceWorkflow || !entry?.proofLockHash?.startsWith('sha256:retained-template-association-v1:')) return null;
    if (!approved) {
      approved = verifiedRetainedGalleryAssetIndex(clientRoot, source);
      same(JSON.parse(open('/template-gallery/manifest.json')), registry, 'Registered Gallery manifest differs.');
    }
    assert.equal(sourceWorkflow.manifest.id, recipe.workflowId);
    assert.equal(sourceWorkflow.manifest.sourceTemplateId, recipe.sourceTaskTemplateId);
    const bundle = JSON.parse(open(entry.provenancePath));
    const outputBytes = open(entry.outputPath);
    assert.equal(galleryJsonHash(bundle), entry.provenanceHash);
    same(
      validateRetainedGalleryProvenance(bundle, entry, {
        templateRevisionHash,
        outputBytes,
        beforeBytes: entry.beforePath ? open(entry.beforePath) : undefined,
      }),
      [],
      'Retained Gallery provenance differs from the approved recipe.',
    );
    assert.equal(entry.thumbnailPath, entry.outputPath, 'The published retained example uses an unreviewed thumbnail.');
    const { association } = bundle;
    assert.equal(association.workflowId, recipe.workflowId);
    assert.equal(association.nativeSourceTaskContractId, sourceWorkflow.manifest.sourceTemplateId);
    const spandrel = recipe.workflowId === 'SpandrelImageUpscale:image_upscale';
    if (spandrel) assertRetainedSpandrelEvidence({ recipe, sourceWorkflow, association, entry, nativeReceipt });
    if (association.recipeObservation) {
      assertRetainedTechnicalRecipe({ recipe, sourceWorkflow, association, entry, nativeReceipt });
    }
    if (association.approvedFiles) {
      assertRetainedBatchEvidence({ recipe, sourceWorkflow, association, entry, native, nativeReceipt, outputBytes });
      verifyRetainedApprovedFiles(association.approvedFiles, open);
    }
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
      ...(spandrel
        ? { modelArtifact: observedExecution.modelArtifact, observationLimits: observedExecution.observationLimits }
        : {}),
      ...(association.recipeObservation || observedExecution.observationLimits?.memoryMeasurement
        ? { observationLimits: observedExecution.observationLimits }
        : {}),
      evidenceMatch: 'current_reviewed_retained_recipe',
    };
  };
}
