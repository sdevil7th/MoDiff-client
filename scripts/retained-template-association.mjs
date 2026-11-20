import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJsonHash } from './canonical-json.mjs';
import { readCanonicalEvidenceFile } from './release-contract-core.mjs';
import { verifyRetainedSpeechGalleryEvidence } from './retained-speech-gallery-evidence.mjs';
import { verifyRetainedStructuredText } from './retained-structured-text-evidence.mjs';
import { canonicalJsonHash as galleryJsonHash, validateQualityReview } from './template-gallery-harness.mjs';

const BOUND_REVIEW_SCOPES = {
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
const WHISPER_LCM_REVIEW_SCOPES = {
  whisper_tiny_blue_cup_transcription: {
    folder: 'whisper',
    proofKind: 'real_backend_input_bound_model_variant',
    output: 'output.original.json',
    decision: 'approved',
    technicalRecipe: 'speech_transcription',
  },
  lcm_dawn_alpine_lake: {
    folder: 'lcm',
    proofKind: 'real_backend_input_bound_model_variant',
    output: 'output.original.webp',
    input: 'input.original.webp',
    decision: 'accepted_with_disclosed_limitations',
    technicalRecipe: 'source_bound_image_edit',
    acceptanceStatement:
      'Accepted as a creative dawn reinterpretation with the disclosed terrain changes and stronger alpenglow.',
  },
};
const SPANDREL_TEMPLATE_ID = 'spandrel_x2_synthetic_gradient';
const SPANDREL_REVIEW_HASH = '357594a299efcda4b9b9e7c4fa65c3d016db3ffe1634fdfe8dfe360789c4d0d4';
const SPANDREL_SCOPE = {
  proofKind: 'real_backend_input_bound_model_variant',
  input: true,
  decision: 'accepted_with_disclosed_limitations',
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

function verifiedTechnicalRecipe({ scope, recipe, candidate, native, reviewedRecipe, output, speech }) {
  const { bytes, ref } = reviewedRecipe;
  const { receipt } = native;
  assert.equal(digest(bytes), ref.sha256);
  assert.equal(ref.sha256, candidate.draftProvenanceSha256);
  const draft = JSON.parse(bytes);
  assert.equal(draft.schemaVersion, 1);
  assert.equal(draft.templateId, recipe.template.id);
  assert.equal(draft.workflowId, receipt.workflowId);
  assert.equal(draft.sourceTaskContractId, receipt.sourceTemplateId);
  assert.equal(draft.runtimeFingerprint, receipt.runtimeFingerprint);
  assert.equal(draft.backendSourceFingerprint, receipt.backendSourceFingerprint);
  assert.deepEqual(draft.observationLimits, receipt.observationLimits);
  assert.equal(
    draft.output.decodedMediaHash ?? `sha256:decoded-rgba:${draft.output.decodedSha256}`,
    output.decodedMediaHash,
  );
  assert.equal(`sha256:bytes:${draft.output.sha256 ?? draft.output.encodedSha256}`, output.outputEncodedSha256);
  assert.equal(draft.output.byteSize ?? draft.output.bytes, output.outputBytes);
  const { templateLockHash, galleryTemplateLockHash, promptSettingsHash } = recipe.reviewedCatalogLock;
  if (scope.technicalRecipe === 'speech_transcription') {
    assert.equal(draft.format, 'modiff.gallery.retained-speech-review-draft.v1');
    assert.equal(draft.reviewStatus, 'pending_review');
    assert.equal(draft.proposedTemplateRevisionSha256, recipe.reviewedTemplateSha256);
    assert.deepEqual(draft.proposedCatalogLock, recipe.reviewedCatalogLock);
    assert.equal(draft.canonicalWorkflowHash, receipt.canonicalWorkflowHash);
    assert.equal(draft.graphHash, receipt.graphHash);
    assert.equal(draft.backendContractFingerprint, speech.backendContractFingerprint);
    assert.equal(draft.output.nativeTransportSha256, output.sourceOutputHash);
    assert.equal(
      draft.modelRevision,
      receipt.modelSet.map(({ repoId, revision }) => `${repoId}@${revision}`).join(' | '),
    );
    assert.equal(Date.parse(draft.capturedAt), Date.parse(receipt.capturedAt));
    assert.equal(draft.executionDurationSeconds, receipt.executionDurationSeconds);
    assert.equal(draft.peakMemoryBytes, receipt.peakMemoryBytes);
    assert.deepEqual(draft.input, {
      origin: 'Synthetic English speech',
      format: 'PCM16 WAV',
      byteSize: receipt.inputBinding.byteSize,
      sampleRate: receipt.inputBinding.decodedAudio.sampleRate,
      channels: receipt.inputBinding.decodedAudio.shape[1],
      durationSeconds: receipt.transcriptEvidence.durationSeconds,
      sha256: speech.inputSha256,
      galleryScope: 'private_source_hash_only',
    });
    return {
      backendContractFingerprint: speech.backendContractFingerprint,
      recipeObservation: { input: draft.input, settings: draft.settings, transcript: receipt.transcriptEvidence },
    };
  }
  assert.equal(draft.format, 'modiff.gallery.retained-template-provenance-draft.v1');
  assert.equal(draft.verificationStatus, 'pending_maintainer_review');
  assert.equal(draft.templateRevisionHash, recipe.reviewedTemplateSha256);
  assert.equal(draft.templateLockHash, galleryTemplateLockHash);
  assert.equal(draft.catalogTemplateLockHash, templateLockHash);
  assert.equal(draft.promptSettingsHash, promptSettingsHash);
  assert.equal(draft.originalCanonicalWorkflowHash, receipt.canonicalWorkflowHash);
  assert.equal(draft.originalGraphHash, receipt.graphHash);
  assert.equal(draft.evidenceDescriptorSha256, recipe.originalReceiptSha256);
  assert.equal(draft.backendContractFingerprint, receipt.backendContractFingerprint);
  assert.equal(Date.parse(draft.verificationTimestamp), Date.parse(receipt.capturedAt));
  assert.equal(draft.runtime.executionDurationSeconds, receipt.executionDurationSeconds);
  assert.equal(draft.runtime.peakMemoryBytes, receipt.peakMemoryBytes);
  assert.deepEqual(draft.modelSet, receipt.modelSet);
  assert.deepEqual(draft.qualificationClaims, receipt.qualificationClaims);
  assert.equal(draft.canonicalDefaultsExecuted, false);
  const { width, height } = receipt.inputBinding.decodedImage;
  assert.deepEqual([draft.source.width, draft.source.height], [width, height]);
  assert.equal(draft.source.encodedSha256, recipe.inputSha256);
  assert.equal(draft.source.decodedSha256, receipt.inputBinding.decodedImage.sha256);
  assert.equal(draft.source.sourceFileName, recipe.inputFileName);
  assert.deepEqual(
    [draft.output.width, draft.output.height],
    [receipt.decodedOutput.width, receipt.decodedOutput.height],
  );
  assert.equal(draft.observedEditControls.prompt, recipe.template.prompt);
  return {
    backendContractFingerprint: receipt.backendContractFingerprint,
    recipeObservation: {
      source: {
        width,
        height,
        encodedSha256: draft.source.encodedSha256,
        decodedSha256: draft.source.decodedSha256,
        creation: draft.source.creation,
      },
      observedEditControls: draft.observedEditControls,
      inactiveAuthoredEditControls: draft.inactiveAuthoredEditControls,
      submittedLoaderSettings: draft.submittedLoaderSettings,
      modelTerms: draft.modelTerms,
    },
  };
}

export function assessRetainedTemplateAssociation({
  recipe,
  candidate,
  native,
  galleryOutput,
  galleryInput,
  catalogLock,
  reviewedRecipe,
}) {
  const { template } = recipe;
  const spandrel = template.id === SPANDREL_TEMPLATE_ID;
  const scope = spandrel
    ? SPANDREL_SCOPE
    : (BOUND_REVIEW_SCOPES[template.id] ?? WHISPER_LCM_REVIEW_SCOPES[template.id]);
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

  if (spandrel) {
    const reviewedRecipeBytes = reviewedRecipe?.bytes;
    assert.ok(
      Buffer.isBuffer(reviewedRecipeBytes) && reviewedRecipeBytes.length > 0 && reviewedRecipeBytes.length <= 65536,
    );
    assert.equal(digest(reviewedRecipeBytes), reviewedRecipe.ref.sha256);
    assert.equal(candidate.draftProvenanceSha256, reviewedRecipe.ref.sha256);
    const { recipeReviewSha256, ...draft } = JSON.parse(reviewedRecipeBytes);
    assert.equal(draft.format, 'modiff.private-technical-preview-recipe-review.v1');
    assert.equal(recipeReviewSha256, SPANDREL_REVIEW_HASH);
    assert.equal(candidate.recipeReviewSha256, recipeReviewSha256);
    assert.equal(canonicalJsonHash(draft), recipeReviewSha256);
    assert.equal(draft.workflowId, receipt.workflowId);
    assert.equal(draft.input.sha256, receipt.inputBinding.sha256);
    assert.deepEqual(
      [draft.input.width, draft.input.height],
      [receipt.inputBinding.width, receipt.inputBinding.height],
    );
    assert.equal(draft.output.fileHash, receipt.outputHash);
    assert.equal(draft.output.decodedHash, receipt.decodedOutput.hash);
    assert.deepEqual(
      [draft.output.width, draft.output.height],
      [receipt.decodedOutput.width, receipt.decodedOutput.height],
    );
    assert.deepEqual(draft.controls.model, evidence.modelArtifact);
    const { artifact, byteSize, descriptorSha256 } = receipt.modelArtifact;
    assert.deepEqual(artifact, {
      source: 'hub',
      repository: template.modelArtifact.value,
      revision: template.modelArtifact.revision,
      weightName: 'RealESRGAN_x2plus.pth',
      sha256: draft.controls.model.sha256,
    });
    assert.equal(draft.controls.model.value, `${artifact.repository}/${artifact.weightName}`);
    assert.equal(byteSize, draft.controls.model.byteSize);
    assert.equal(template.modelArtifact.sha256, artifact.sha256);
    assert.equal(template.modelArtifact.byteSize, byteSize);
    assert.equal(template.modelArtifact.license, draft.controls.model.license);
    assert.match(descriptorSha256, /^[a-f0-9]{64}$/u);
    assert.equal(draft.proof.sourceTaskTemplateId, receipt.sourceTemplateId);
    assert.equal(draft.proof.canonicalWorkflowHash, receipt.canonicalWorkflowHash);
    assert.equal(draft.proof.populatedGraphHash, receipt.graphHash);
    assert.equal(draft.proof.evidenceDescriptorSha256, recipe.originalReceiptSha256);
    assert.equal(draft.proof.savedCreatorPackageSha256, evidence.creatorPackage.sha256);
    const creator = JSON.parse(readCanonicalEvidenceFile(evidenceRoot, evidence.creatorPackage).bytes);
    const upscaler = Object.values(creator.apiGraph.nodes).find(
      (node) => node.module === 'modules.Spandrel' && node.action === 'Upscaler',
    );
    assert.equal(creator.apiGraph.nodes[receipt.inputBinding.nodeId].params.alpha_channel.value, draft.input.alphaMode);
    assert.deepEqual(
      [upscaler.params.tile_size.value, upscaler.params.tile_overlap.value, upscaler.params.downscale.value],
      [draft.controls.tileSize, draft.controls.tileOverlap, draft.controls.downscale],
    );
    assert.deepEqual(receipt.observationLimits, {
      fullConsumedFieldAccounting: false,
      physicalPlatformQualification: false,
    });
  }

  let output;
  let speech;
  if (scope.technicalRecipe === 'speech_transcription') {
    speech = verifyRetainedSpeechGalleryEvidence({ recipe, native, galleryOutput, galleryInput });
    output = speech.output;
  } else if (scope.input) {
    assert.equal(digest(galleryInput.bytes), galleryInput.ref.sha256);
    assert.equal(galleryInput.ref.sha256, receipt.inputBinding.sha256);
    assert.equal(galleryInput.ref.sha256, recipe.inputSha256);
    assert.deepEqual(
      [template.example.expectedOutput.width, template.example.expectedOutput.height],
      [receipt.decodedOutput.width, receipt.decodedOutput.height],
    );
    const capture =
      scope.technicalRecipe === 'source_bound_image_edit'
        ? JSON.parse(readCanonicalEvidenceFile(evidenceRoot, evidence.capture).bytes)
        : evidence;
    const source = capture.inputs[0];
    assert.equal(capture.inputs.length, 1);
    assert.equal(source.file.sha256, recipe.inputSha256);
    assert.equal(source.sourceValue, recipe.inputFileName);
    assert.equal(template.inputBindings.length, 1);
    const [binding] = template.inputBindings;
    assert.equal(binding.origin, 'user');
    assert.equal(binding.field, 'referenceImages');
    assert.equal(binding.count, 1);
    assert.equal(`sha256:bytes:${galleryOutput.ref.sha256}`, receipt.outputHash);
    if (scope.technicalRecipe === 'source_bound_image_edit') {
      assert.equal(digest(template.prompt), recipe.promptSha256);
      assert.equal(receipt.promptBinding.sha256, recipe.promptSha256);
    }
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
  const technicalRecipe = scope.technicalRecipe
    ? verifiedTechnicalRecipe({ scope, recipe, candidate, native, reviewedRecipe, output, speech })
    : null;
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
    ...(spandrel || technicalRecipe ? { originalCanonicalWorkflowHash: receipt.canonicalWorkflowHash } : {}),
    originalTemplateLockHash: null,
    originalResourceCandidateId: null,
    originalEvidenceSha256: recipe.originalReceiptSha256,
    observedExecution: {
      modelSet: receipt.modelSet,
      ...(spandrel ? { modelArtifact: receipt.modelArtifact } : {}),
      runtimeFingerprint: receipt.runtimeFingerprint,
      executionDurationSeconds: receipt.executionDurationSeconds,
      peakMemoryBytes: receipt.peakMemoryBytes,
      observationLimits: receipt.observationLimits,
      ...(technicalRecipe ? { backendContractFingerprint: technicalRecipe.backendContractFingerprint } : {}),
    },
    output,
    ...(technicalRecipe ? { recipeObservation: technicalRecipe.recipeObservation } : {}),
    review: {
      qualityDecision: candidate.qualityDecision,
      redistributionConfirmed: true,
      draftReviewSha256: candidate.draftReviewSha256,
      draftProvenanceSha256: candidate.draftProvenanceSha256,
      ...(spandrel ? { recipeReviewSha256: candidate.recipeReviewSha256 } : {}),
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
  const spandrel = association.templateId === SPANDREL_TEMPLATE_ID;
  if (spandrel) assert.equal(draft.ratingMethod, 'maintainer_qualitative_acceptance');
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
    ...(spandrel ? { ratingMethod: draft.ratingMethod } : {}),
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
        WHISPER_LCM_REVIEW_SCOPES[association.templateId]?.acceptanceStatement ??
        (spandrel
          ? 'Accepted as a technical preview of the exact saved synthetic gradient and 2× delivery with the disclosed limitations.'
          : 'Accepted as a technical depth preview with the reviewed scores and the disclosed limits of the synthetic ramp.'),
      acceptedReviewHash: galleryJsonHash(review),
    };
  }
  const errors = validateQualityReview(review, bindings, 'approved_reviewed');
  assert.deepEqual(errors, [], 'The finalized review does not meet Gallery quality rules.');
  return review;
}

async function readReviewBatch({ approvalRoot, vite, nativeBySha, scopes, approvalSha256 }) {
  const approvalPath = join(approvalRoot, 'approval.v1.json');
  if (!existsSync(approvalPath)) return [];
  const { value: approval, sha256: approvalDigest } = readBoundedRecord(approvalPath);
  if (approvalSha256) assert.equal(approvalDigest, approvalSha256, 'The retained batch approval differs.');
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
  assert.ok(Array.isArray(approval.candidates) && approval.candidates.length === Object.keys(scopes).length);
  const reviewedScope = readBoundedRecord(join(approvalRoot, 'review-scope.json'));
  assert.equal(reviewedScope.sha256, approval.reviewScopeSha256, 'Original review inventory hash differs.');
  assert.equal(reviewedScope.value.status, 'private_review_only');
  const indexedFiles = new Map(reviewedScope.value.files.map((item) => [item.path, item]));
  assert.equal(indexedFiles.size, reviewedScope.value.files.length, 'Review inventory contains duplicate files.');

  const { RETAINED_GALLERY_TEMPLATES } = await vite.ssrLoadModule('/src/studio/retainedGalleryTemplates.ts');
  const { getTemplateLockHash, getPromptSettingsHash, getTemplateLockedSettings } = await vite.ssrLoadModule(
    '/src/studio/templateExactness.ts',
  );
  const records = [];
  for (const recipe of RETAINED_GALLERY_TEMPLATES.filter(({ template }) => Object.hasOwn(scopes, template.id))) {
    const { template } = recipe;
    const scope = scopes[template.id];
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
    if (scope.technicalRecipe) {
      assert.deepEqual(draft.scores, candidate.reviewedScores);
      assert.equal(draft.schemaVersion, 2);
      if (scope.input) {
        assert.equal(draft.sourceSha256, files.get(scope.input).ref.sha256);
        assert.equal(draft.proposedDecision, scope.decision);
      }
    }
    const association = assessRetainedTemplateAssociation({
      recipe,
      candidate,
      native,
      galleryOutput: media,
      galleryInput: scope.input ? files.get(scope.input) : undefined,
      reviewedRecipe: files.get('proposed-provenance.json'),
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
    records.push({
      association: { ...association, qualityReviewHash: galleryJsonHash(qualityReview) },
      qualityReview,
      recipe,
      receipt: native.receipt,
      outputBytes: media.bytes,
      beforeBytes: scope.input ? files.get(scope.input).bytes : undefined,
    });
  }
  assert.equal(records.length, approval.candidates.length);
  assert.equal(
    indexedFiles.size,
    approval.candidates.reduce((total, item) => total + item.files.length, 0),
  );
  return records;
}

// The retained native reader must already have revalidated the original
// evidence descriptor and all inputs, output, runtime and source receipts.
export function readApprovedWhisperLcmBatch(args) {
  return readReviewBatch({
    ...args,
    scopes: WHISPER_LCM_REVIEW_SCOPES,
    approvalSha256: 'ba369c5fff89e379be66714d3ecbf1a0e3a9555e2b5ffbc9cb54210d862ec30b',
  });
}

export async function readReviewedBoundTemplateAssociations({ approvalRoot, vite, nativeBySha }) {
  const current = await readReviewBatch({ approvalRoot, vite, nativeBySha, scopes: BOUND_REVIEW_SCOPES });
  const audited = await readApprovedWhisperLcmBatch({
    approvalRoot: join(approvalRoot, 'whisper-lcm'),
    vite,
    nativeBySha,
  });
  const associations = new Map();
  for (const { association } of [...current, ...audited]) {
    assert.ok(!associations.has(association.workflowId), 'Retained Gallery workflow association is duplicated.');
    associations.set(association.workflowId, association);
  }
  return associations;
}
