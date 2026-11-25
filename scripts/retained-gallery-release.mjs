import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readCanonicalEvidenceFile } from './release-contract-core.mjs';
import {
  canonicalJsonHash as galleryJsonHash,
  decodedAudiovisualMediaHash,
  galleryVerificationScope,
  validateQualityReview,
} from './template-gallery-harness.mjs';
import {
  retainedGalleryFileLimit,
  validateRetainedGalleryProvenance,
  verifyRetainedApprovedFiles,
} from './retained-gallery-provenance.mjs';
import { verifyRetainedSpeechGalleryEvidence } from './retained-speech-gallery-evidence.mjs';

const same = (actual, expected, label) => assert.deepEqual(actual, expected, label);

export function assertRetainedVideoAdjustment(nativeReceipt, output, label) {
  const { videoAdjustment, video } = output;
  const source = nativeReceipt.decodedOutput;
  assert.equal(source.kind, 'video', label);
  assert.equal(output.sourceOutputHash, nativeReceipt.outputHash, label);
  assert.notEqual(output.outputEncodedSha256, nativeReceipt.outputHash, label);
  assert.equal(videoAdjustment.schemaVersion, 1, label);
  assert.equal(videoAdjustment.sourceVideoHash, source.hash, label);
  for (const key of ['width', 'height', 'frames', 'fps', 'durationSeconds']) {
    assert.equal(video[key], source[key], label);
  }
  if (videoAdjustment.kind === 'exposure_deflicker') {
    assert.equal(source.audio, undefined, label);
    assert.equal(video.hasAudio, false, label);
    assert.equal(video.audio ?? null, null, label);
    assert.equal(videoAdjustment.sourceAudioHash, undefined, label);
    assert.notEqual(output.decodedMediaHash, source.hash, label);
  } else {
    assert.equal(videoAdjustment.kind, 'audio_gain', label);
    assert.ok(source.audio?.hash && video.audio?.hash && video.hasAudio, label);
    assert.equal(videoAdjustment.sourceAudioHash, source.audio.hash, label);
    assert.equal(output.decodedMediaHash, source.hash, label);
    assert.equal(video.audio.sourceSampleRate, source.audio.sourceSampleRate, label);
    assert.equal(video.audio.channels, source.audio.channels, label);
    assert.notEqual(video.audio.hash, source.audio.hash, label);
  }
}

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

export function assertRetainedVideoReference(recipe, approvedFiles, nativeReceipt) {
  const { referenceImageSha256 } = recipe;
  assert.equal(approvedFiles.approvedReferenceImagePath?.sha256, referenceImageSha256);
  if (referenceImageSha256 === undefined) return;
  assert.match(referenceImageSha256, /^[a-f0-9]{64}$/u);
  assert.equal(recipe.secondaryReferenceSha256, undefined);
  const { inputBindings = [], inputRequirements } = recipe.template;
  assert.ok(inputRequirements?.sourceVideo || inputBindings.some(({ field }) => field === 'sourceVideo'));
  const imageBinding = inputBindings.find(
    ({ field, mediaType }) => field === 'referenceImages' && mediaType === 'image',
  );
  assert.equal(
    inputRequirements?.referenceImages ?? imageBinding?.count,
    1,
    'The retained video recipe must declare its reference image.',
  );
  if (nativeReceipt) {
    same(
      nativeReceipt.referenceBindings?.map(({ inputIndex, sha256 }) => ({ inputIndex, sha256 })),
      [{ inputIndex: 0, sha256: referenceImageSha256 }],
      'Published video reference differs from the saved input.',
    );
  }
}

const motionInputRoles = [
  ['face', 'faceVideo', 'face_video', 'approvedFaceVideoPath'],
  ['pose', 'poseVideo', 'pose_video', 'approvedPoseVideoPath'],
  ['background', 'backgroundVideo', 'background_video', 'approvedBackgroundVideoPath'],
  ['mask', 'maskVideo', 'mask', 'approvedMaskVideoPath'],
];

export function assertRetainedMotionInputs(recipe, approvedFiles, nativeReceipt) {
  const expected = [];
  const hashes = recipe.videoConditionerHashes ?? {};
  for (const [role, field, consumerPort, approvalKey] of motionInputRoles) {
    const sha256 = hashes[role];
    assert.equal(approvedFiles[approvalKey]?.sha256, sha256);
    if (sha256 === undefined) continue;
    assert.match(sha256, /^[a-f0-9]{64}$/u);
    assert.ok(
      recipe.template.inputBindings?.some((binding) => binding.field === field && binding.mediaType === 'video'),
      'The retained recipe must declare its motion video input.',
    );
    expected.push({ role, consumerPort, sha256 });
  }
  assert.equal(Object.keys(hashes).length, expected.length, 'Unknown retained motion input role.');
  if (expected.length && nativeReceipt) {
    const observed = nativeReceipt.videoConditionBindings?.map(({ role, consumerPort, sha256 }) => ({
      role,
      consumerPort,
      sha256,
    }));
    same(observed, expected, 'Published motion input differs from the saved typed binding.');
  }
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
    (recipe.inputSha256 === recipe.guideSha256 ? association.approvedFiles.approvedGuidePath?.sha256 : undefined) ??
    association.privateSourceSha256;
  assert.equal(inputHash, recipe.inputSha256);
  assert.equal(association.approvedFiles.approvedMaskPath?.sha256, recipe.maskSha256);
  assert.equal(association.approvedFiles.approvedGuidePath?.sha256, recipe.guideSha256);
  assert.equal(association.approvedFiles.approvedClosingFramePath?.sha256, recipe.lastFrameSha256);
  assert.equal(association.approvedFiles.approvedSecondaryReferencePath?.sha256, recipe.secondaryReferenceSha256);
  assertRetainedVideoReference(recipe, association.approvedFiles, nativeReceipt);
  assertRetainedMotionInputs(recipe, association.approvedFiles, nativeReceipt);
  if (recipe.secondaryReferenceSha256) {
    assert.equal(recipe.template.mode, 'multi_image_reference_edit');
    same(
      association.output.orderedReferenceHashes,
      [recipe.inputSha256, recipe.secondaryReferenceSha256].map((hash) => 'sha256:bytes:' + hash),
      'Retained Gallery reference order differs from the template.',
    );
  }
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
  if (recipe.workflowId !== 'SpandrelVideoUpscale:video_upscale') {
    assert.equal(nativeReceipt.backendContractFingerprint, entry.backendContractFingerprint, label);
  }
  assert.equal(nativeReceipt.promptBinding?.sha256, recipe.promptSha256, label);
  assert.equal(nativeReceipt.inputBinding?.sha256, recipe.inputSha256, label);
  assert.equal(nativeReceipt.maskBinding?.sha256, recipe.maskSha256, label);
  assert.equal(nativeReceipt.guideBinding?.sha256, recipe.guideSha256, label);
  assert.equal(nativeReceipt.lastFrameBinding?.sha256, recipe.lastFrameSha256, label);
  if (recipe.secondaryReferenceSha256) {
    same(
      nativeReceipt.referenceBindings?.map(({ inputIndex, sha256 }) => ({ inputIndex, sha256 })),
      [{ inputIndex: 1, sha256: recipe.secondaryReferenceSha256 }],
      label,
    );
    assert.equal(nativeReceipt.inputBinding?.nodeId, nativeReceipt.referenceBindings[0].nodeId, label);
  }
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
    assert.equal(hasAudio, Boolean(videoMetadata.audio), label);
    assert.equal(entry.decodedAudioHash, videoMetadata.audio?.hash, label);
    assert.equal(
      entry.audiovisualMediaHash,
      decodedAudiovisualMediaHash(decodedMediaHash, entry.decodedAudioHash) ?? undefined,
      label,
    );
    if (association.output.videoAdjustment) {
      assertRetainedVideoAdjustment(nativeReceipt, association.output, label);
      return;
    }
    if (recipe.workflowId === 'SpandrelVideoUpscale:video_upscale') {
      const { width, height, frames, fps } = videoMetadata;
      same(nativeReceipt.decodedOutput, { hash: decodedMediaHash, width, height, frameCount: frames, fps }, label);
      assert.equal(width, 2 * nativeReceipt.inputBinding.width, label);
      assert.equal(height, 2 * nativeReceipt.inputBinding.height, label);
    } else {
      same(nativeReceipt.decodedOutput, { kind: 'video', hash: decodedMediaHash, ...videoMetadata }, label);
    }
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
      retainedGalleryFileLimit(asset.path),
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
    const spandrel = ['SpandrelImageUpscale:image_upscale', 'SpandrelVideoUpscale:video_upscale'].includes(
      recipe.workflowId,
    );
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
          ...(entry.decodedAudioHash && {
            decodedAudioHash: entry.decodedAudioHash,
            audiovisualMediaHash: entry.audiovisualMediaHash,
          }),
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
