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
const WAV2VEC2_TEMPLATE_ID = 'wav2vec2_station_announcement';
const WAV2VEC2_REVIEW_SCOPE = {
  folder: 'wav2vec2',
  proofKind: 'real_backend_input_bound_model_variant',
  output: 'transcript.json',
  reviewFile: 'review.json',
  provenanceFile: 'technical-record.json',
  decision: 'accepted_with_disclosed_limitations',
  technicalRecipe: 'speech_transcription',
  acceptanceStatement:
    'Accepted the exact saved station announcement transcript and word timestamps with the disclosed limitations.',
};
const SANA_TEMPLATE_ID = 'sana_sprint_monochrome_tiger';
const SANA_WORKFLOW_ID = 'SanaSprintPipeline:edit_image';
const SANA_REVIEW_SCOPE_SHA256 = '09c91c7aa04229e591a86849d399dcf557ca61bdecfc3ac25e7b935795113263';
const SANA_REVIEW_SCOPE = {
  proofKind: 'real_backend_input_bound_model_variant',
  input: `${SANA_TEMPLATE_ID}.before.webp`,
  output: `${SANA_TEMPLATE_ID}.webp`,
  decision: 'accepted_with_disclosed_limitations',
  technicalRecipe: 'source_bound_image_edit',
  acceptanceStatement:
    'Accepted as a creative monochrome edit with the disclosed changes to facial proportions, stripes, crop and background.',
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

function verifiedSanaRecipe(draft, native, recipe) {
  const { evidence, receipt, evidenceRoot } = native;
  const capture = JSON.parse(readCanonicalEvidenceFile(evidenceRoot, evidence.capture).bytes);
  const run = JSON.parse(readCanonicalEvidenceFile(evidenceRoot, capture.runDetail).bytes);
  const [nativeOutput] = run.outputs;
  const [source] = capture.inputs;
  const original = nativeOutput.resolvedExecutionInputs.nodes;
  const parameters = (action, disposition) =>
    Object.fromEntries(
      Object.entries(original.find((node) => node.action === action).fieldAccounting.fields)
        .filter(([, field]) => field.disposition === disposition)
        .map(([key, field]) => [key, field.value]),
    );
  const loaded = parameters('LoadPipeline', 'consumed');
  const execution = parameters('DiffusersExecutionRecipe', 'consumed');
  const submittedLoaderSettings = {
    dtype: loaded.dtype,
    device: execution.device,
    device_map: execution.device_map,
    attention_backend: execution.attention_backend,
    offload_mode: execution.offload_mode,
    quantization_mode: loaded.quantization_mode,
    low_cpu_mem_usage: loaded.low_cpu_mem_usage,
    vae_slicing: execution.vae_slicing,
    vae_tiling: execution.vae_tiling,
  };
  assert.equal(draft.format, 'modiff.gallery.retained-template-provenance-draft.v1');
  assert.equal(draft.verificationStatus, 'pending_maintainer_review');
  assert.equal(draft.evidenceDescriptorSha256, evidence.capture.sha256);
  assert.equal(draft.nativeRuntimeFingerprint, run.task.runtimeFingerprint.fingerprint);
  assert.equal(draft.originalGraphHash, receipt.graphHash);
  assert.equal(`sha256:workflow-graph-v1:${draft.sourceGraphManifestSha256}`, receipt.canonicalWorkflowHash);
  assert.equal(draft.verificationTimestamp, new Date(nativeOutput.createdAt).toISOString());
  assert.equal(draft.canonicalDefaultsExecuted, receipt.canonicalDefaultsExecuted);
  assert.deepEqual(draft.qualificationClaims, receipt.qualificationClaims);
  assert.deepEqual(draft.modelSet, receipt.modelSet);
  assert.equal(draft.effectivePipelineClass, loaded.pipeline_class);
  assert.deepEqual(draft.submittedLoading, submittedLoaderSettings);
  assert.deepEqual(draft.observedEditControls, parameters('Edit', 'consumed'));
  assert.deepEqual(draft.inactiveAuthoredEditControls, parameters('Edit', 'inactive'));
  assert.equal(draft.observedEditControls.prompt, recipe.template.prompt);
  assert.equal(draft.observedEditControls.strength, 0.75);
  assert.deepEqual(draft.controlledVariant.strength, { field: 'strength', from: 0.5, to: 0.75 });
  const { width, height, mode, sha256 } = receipt.inputBinding.decodedImage;
  assert.deepEqual(
    [draft.source.width, draft.source.height, draft.source.decodedMode, draft.source.decodedSha256],
    [width, height, mode, sha256],
  );
  assert.equal(draft.source.bytes, source.file.bytes);
  assert.equal(draft.source.encodedSha256, receipt.inputBinding.sha256);
  assert.deepEqual(
    [draft.output.width, draft.output.height],
    [receipt.decodedOutput.width, receipt.decodedOutput.height],
  );
  const { runtimeMeasurement } = run.task;
  assert.equal(draft.runtime.backend, runtimeMeasurement.backend);
  assert.equal(draft.runtime.resourceMode, run.task.runtimePreparation.resourceMode);
  assert.equal(draft.runtime.executionDurationSeconds, receipt.executionDurationSeconds);
  assert.equal(draft.runtime.peakAllocatedAcceleratorBytes, receipt.peakMemoryBytes);
  assert.equal(draft.runtime.peakReservedAcceleratorBytes, runtimeMeasurement.peakReservedBytes);
  return {
    backendContractFingerprint: receipt.backendContractFingerprint,
    recipeObservation: {
      source: {
        width,
        height,
        encodedSha256: draft.source.encodedSha256,
        decodedSha256: sha256,
        creation: draft.source.creation,
      },
      observedEditControls: draft.observedEditControls,
      inactiveAuthoredEditControls: draft.inactiveAuthoredEditControls,
      submittedLoaderSettings,
      modelTerms: {
        license: 'Apache-2.0',
        licenseUrl:
          'https://huggingface.co/Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers/blob/aa76e7f4f4928f378716b6716a2130fba3caf5b1/LICENSE',
        textEncoder: 'Gemma-2-2B-IT',
        textEncoderTermsUrl: 'https://ai.google.dev/gemma/terms',
        textEncoderProhibitedUsePolicyUrl: 'https://ai.google.dev/gemma/prohibited_use_policy',
      },
    },
  };
}

function verifiedWav2Vec2Recipe(draft, receipt, output, speech) {
  assert.equal(draft.status, 'private_review_candidate');
  assert.equal(draft.workflowId, receipt.workflowId);
  assert.deepEqual([{ repoId: draft.model.repoId, revision: draft.model.revision }], receipt.modelSet);
  assert.equal(draft.model.publisherLicenseDeclaration, 'Apache-2.0');
  assert.equal(draft.platform, 'Windows CUDA');
  assert.equal(draft.graphHash, receipt.graphHash);
  assert.equal(draft.runtimeFingerprint, receipt.runtimeFingerprint);
  assert.equal(draft.measuredElapsedSeconds, receipt.executionDurationSeconds);
  assert.equal(draft.measuredPeakAllocatedBytes, receipt.peakMemoryBytes);
  assert.deepEqual(draft.observedSettings, {
    timestamps: receipt.transcriptEvidence.timestampMode,
    chunkLengthSeconds: 30,
    chunkStrideSeconds: 5,
  });
  assert.deepEqual(draft.input, {
    origin: 'synthetic station announcement',
    format: 'PCM16 WAV',
    sampleRate: receipt.inputBinding.decodedAudio.sampleRate,
    channels: receipt.inputBinding.decodedAudio.shape[1],
    durationSeconds: receipt.transcriptEvidence.durationSeconds,
    sha256: speech.inputSha256,
  });
  assert.deepEqual(draft.output, {
    path: WAV2VEC2_REVIEW_SCOPE.output,
    mediaType: output.mediaType,
    sha256: output.outputEncodedSha256.slice('sha256:bytes:'.length),
    byteSize: output.outputBytes,
    nativeTransportSha256: output.sourceOutputHash.slice('sha256:bytes:'.length),
    projection: 'Exact UTF-8 bytes of the single JSON string in the native text result.',
  });
  return {
    backendContractFingerprint: speech.backendContractFingerprint,
    recipeObservation: {
      platform: draft.platform,
      modelPublisherLicense: draft.model.publisherLicenseDeclaration,
      input: { ...draft.input, galleryScope: 'private_source_hash_only' },
      settings: draft.observedSettings,
      transcript: receipt.transcriptEvidence,
      outputProjection: draft.output.projection,
    },
  };
}

function verifiedTechnicalRecipe({ scope, recipe, candidate, native, reviewedRecipe, output, speech }) {
  const { bytes, ref } = reviewedRecipe;
  const { receipt } = native;
  assert.equal(digest(bytes), ref.sha256);
  assert.equal(ref.sha256, candidate.draftProvenanceSha256);
  const draft = JSON.parse(bytes);
  assert.equal(draft.schemaVersion, 1);
  if (scope === WAV2VEC2_REVIEW_SCOPE) return verifiedWav2Vec2Recipe(draft, receipt, output, speech);
  assert.equal(draft.templateId, recipe.template.id);
  assert.equal(draft.workflowId, receipt.workflowId);
  assert.equal(draft.sourceTaskContractId, receipt.sourceTemplateId);
  assert.equal(draft.backendSourceFingerprint, receipt.backendSourceFingerprint);
  assert.equal(
    draft.output.decodedMediaHash ?? `sha256:decoded-rgba:${draft.output.decodedSha256}`,
    output.decodedMediaHash,
  );
  assert.equal(`sha256:bytes:${draft.output.sha256 ?? draft.output.encodedSha256}`, output.outputEncodedSha256);
  assert.equal(draft.output.byteSize ?? draft.output.bytes, output.outputBytes);
  if (scope === SANA_REVIEW_SCOPE) return verifiedSanaRecipe(draft, native, recipe);
  assert.equal(draft.runtimeFingerprint, receipt.runtimeFingerprint);
  assert.deepEqual(draft.observationLimits, receipt.observationLimits);
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
    : template.id === SANA_TEMPLATE_ID
      ? SANA_REVIEW_SCOPE
      : template.id === WAV2VEC2_TEMPLATE_ID
        ? WAV2VEC2_REVIEW_SCOPE
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
  const wav2vec2 = association.templateId === WAV2VEC2_TEMPLATE_ID;
  const qualitative = spandrel || wav2vec2;
  if (qualitative) assert.equal(draft.ratingMethod, 'maintainer_qualitative_acceptance');
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
    ...(qualitative ? { ratingMethod: draft.ratingMethod } : {}),
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
        (association.templateId === SANA_TEMPLATE_ID
          ? SANA_REVIEW_SCOPE.acceptanceStatement
          : wav2vec2
            ? WAV2VEC2_REVIEW_SCOPE.acceptanceStatement
            : WHISPER_LCM_REVIEW_SCOPES[association.templateId]?.acceptanceStatement) ??
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

function projectApprovedWav2Vec2Review(original, receipt, template) {
  assert.equal(original.schemaVersion, 1);
  assert.equal(original.reviewStatus, 'pending_review');
  assert.equal(original.approved, false);
  assert.equal(original.redistributionApproved, false);
  const [contentCheck, timingCheck, receiptCheck] = original.observations;
  return {
    schemaVersion: 2,
    outputSha256: original.outputSha256,
    graphHash: receipt.graphHash,
    runtimeFingerprint: receipt.runtimeFingerprint,
    modelRevision: template.modelArtifact.value + '@' + template.modelArtifact.revision,
    ratingMethod: 'maintainer_qualitative_acceptance',
    rubric: { taskAdherence: null, artifactControl: null, modalityQuality: null },
    scores: { promptAdherence: null, composition: null, technicalExecution: null, templateUsefulness: null },
    hardFailures: [],
    objectiveChecks: { status: 'pass', checks: [receiptCheck] },
    modalityReview: { status: 'pass', checks: [contentCheck, timingCheck] },
    summary: original.observations.join(' '),
    knownLimitations: original.limitations,
  };
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
    const reviewFile = scope.reviewFile ?? 'proposed-review.json';
    const provenanceFile = scope.provenanceFile ?? 'proposed-provenance.json';
    const names = [scope.output, reviewFile, provenanceFile];
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
    assert.equal(files.get(reviewFile).ref.sha256, candidate.draftReviewSha256);
    assert.equal(files.get(provenanceFile).ref.sha256, candidate.draftProvenanceSha256);
    const native = nativeBySha.get(recipe.originalReceiptSha256);
    assert.ok(native, 'The approved original native receipt could not be verified.');
    const media = files.get(scope.output);
    const original = JSON.parse(files.get(reviewFile).bytes);
    const wav2vec2 = scope === WAV2VEC2_REVIEW_SCOPE;
    const draft = wav2vec2 ? projectApprovedWav2Vec2Review(original, native.receipt, template) : original;
    assert.equal(draft.outputSha256, media.ref.sha256);
    assert.equal(draft.graphHash, native.receipt.graphHash);
    assert.equal(draft.runtimeFingerprint, native.receipt.runtimeFingerprint);
    assert.equal(draft.modelRevision, `${template.modelArtifact.value}@${template.modelArtifact.revision}`);
    assert.ok(
      !draft.reviewer && !draft.reviewedAt,
      'The reviewed draft must preserve original pending review metadata.',
    );
    if (scope.technicalRecipe && !wav2vec2) {
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
      reviewedRecipe: files.get(provenanceFile),
      catalogLock: {
        templateLockHash: getTemplateLockHash(template),
        galleryTemplateLockHash: getTemplateLockHash(template, draft.modelRevision),
        promptSettingsHash: getPromptSettingsHash(settings),
      },
    });
    if (!wav2vec2) assert.equal(draft.decodedMediaHash, association.output.decodedMediaHash);
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

export function readApprovedWav2Vec2Review(args) {
  return readReviewBatch({
    ...args,
    scopes: { [WAV2VEC2_TEMPLATE_ID]: WAV2VEC2_REVIEW_SCOPE },
    approvalSha256: '5a790d4a6c9f82b2e00140b8d1c62fc3721c0b66856e4e2e7f2440890772b0e0',
  });
}

export async function readApprovedSanaReview({ approvalRoot, vite, nativeBySha }) {
  const approvalPath = join(approvalRoot, 'approval.v1.json');
  if (!existsSync(approvalPath)) return null;
  const { value: approval, sha256: approvalHash } = readBoundedRecord(approvalPath);
  assert.equal(
    approvalHash,
    '40060ba701188a6d287df07e0852c6497d109885495e6fc85a19e8371ef73906',
    'Sana Sprint approval digest differs.',
  );
  assert.equal(approval.schemaVersion, 1);
  assert.equal(approval.format, 'modiff.private.gallery-candidate-approval.v1');
  assert.ok(typeof approval.reviewer === 'string' && approval.reviewer.trim());
  assert.ok(Number.isFinite(Date.parse(approval.reviewedAt)));
  assert.equal(approval.reviewScopeSha256, SANA_REVIEW_SCOPE_SHA256);
  assert.equal(approval.candidates.length, 1);
  const [candidate] = approval.candidates;
  assert.equal(candidate.templateId, SANA_TEMPLATE_ID);
  assert.equal(candidate.workflowId, SANA_WORKFLOW_ID);
  const { value: scope, sha256: scopeHash } = readBoundedRecord(join(approvalRoot, 'review-scope.json'));
  assert.equal(scopeHash, SANA_REVIEW_SCOPE_SHA256);
  assert.equal(scope.status, 'pending_review_and_redistribution_rights');
  assert.deepEqual(candidate.files, scope.files);
  const { RETAINED_GALLERY_TEMPLATES } = await vite.ssrLoadModule('/src/studio/retainedGalleryTemplates.ts');
  const { getTemplateLockHash, getPromptSettingsHash, getTemplateLockedSettings } = await vite.ssrLoadModule(
    '/src/studio/templateExactness.ts',
  );
  const matches = RETAINED_GALLERY_TEMPLATES.filter(({ template }) => template.id === SANA_TEMPLATE_ID);
  assert.equal(matches.length, 1);
  const [recipe] = matches;
  const { template } = recipe;
  const settings = getTemplateLockedSettings(template);
  assert.equal(canonicalJsonHash({ template, settings }), recipe.reviewedTemplateSha256);
  const native = nativeBySha.get(recipe.originalReceiptSha256);
  assert.ok(native, 'The approved original Sana Sprint receipt could not be verified.');
  const before = SANA_REVIEW_SCOPE.input;
  const after = SANA_REVIEW_SCOPE.output;
  const review = `${SANA_TEMPLATE_ID}.proposed-review.json`;
  const provenance = `${SANA_TEMPLATE_ID}.proposed-provenance.json`;
  assert.equal(candidate.files.length, 4);
  const files = new Map(
    [before, after, review, provenance].map((name) => {
      const refs = candidate.files.filter((item) => item.path === name);
      assert.equal(refs.length, 1);
      const [ref] = refs;
      return [name, { ref, ...readCanonicalEvidenceFile(join(approvalRoot, 'reviewed'), ref, 2 * 1024 * 1024) }];
    }),
  );
  const draftReview = JSON.parse(files.get(review).bytes);
  assert.equal(draftReview.schemaVersion, 2);
  assert.equal(draftReview.templateId, SANA_TEMPLATE_ID);
  assert.equal(draftReview.reviewStatus, 'pending_maintainer_review');
  assert.equal(draftReview.proposedDecision, SANA_REVIEW_SCOPE.decision);
  assert.ok(!draftReview.reviewer && !draftReview.reviewedAt);
  assert.equal(draftReview.graphHash, native.receipt.graphHash);
  const capture = JSON.parse(readCanonicalEvidenceFile(native.evidenceRoot, native.evidence.capture).bytes);
  const run = JSON.parse(readCanonicalEvidenceFile(native.evidenceRoot, capture.runDetail).bytes);
  assert.equal(draftReview.nativeRuntimeFingerprint, run.task.runtimeFingerprint.fingerprint);
  assert.equal(draftReview.modelRevision, `${template.modelArtifact.value}@${template.modelArtifact.revision}`);
  assert.equal(draftReview.outputSha256, files.get(after).ref.sha256);
  assert.equal(draftReview.sourceSha256, files.get(before).ref.sha256);
  const association = assessRetainedTemplateAssociation({
    recipe,
    candidate: {
      ...candidate,
      sourceTaskContractId: recipe.sourceTaskTemplateId,
      draftReviewSha256: files.get(review).ref.sha256,
      draftProvenanceSha256: files.get(provenance).ref.sha256,
    },
    native,
    galleryOutput: files.get(after),
    galleryInput: files.get(before),
    reviewedRecipe: files.get(provenance),
    catalogLock: {
      templateLockHash: getTemplateLockHash(template),
      galleryTemplateLockHash: getTemplateLockHash(template, draftReview.modelRevision),
      promptSettingsHash: getPromptSettingsHash(settings),
    },
  });
  assert.equal(draftReview.decodedMediaHash, association.output.decodedMediaHash);
  const qualityReview = finalizeRetainedQualityReview({
    association,
    draft: draftReview,
    reviewer: approval.reviewer,
    reviewedAt: approval.reviewedAt,
  });
  return {
    association: { ...association, qualityReviewHash: galleryJsonHash(qualityReview) },
    qualityReview,
    recipe,
    receipt: native.receipt,
    outputBytes: files.get(after).bytes,
    beforeBytes: files.get(before).bytes,
  };
}

export async function readReviewedBoundTemplateAssociations({ approvalRoot, vite, nativeBySha }) {
  const current = await readReviewBatch({ approvalRoot, vite, nativeBySha, scopes: BOUND_REVIEW_SCOPES });
  const audited = await readApprovedWhisperLcmBatch({
    approvalRoot: join(approvalRoot, 'whisper-lcm'),
    vite,
    nativeBySha,
  });
  const sana = await readApprovedSanaReview({ approvalRoot: join(approvalRoot, 'sana-sprint'), vite, nativeBySha });
  const wav2vec2 = await readApprovedWav2Vec2Review({
    approvalRoot: join(approvalRoot, 'wav2vec2'),
    vite,
    nativeBySha,
  });
  const records = [...current, ...audited, ...wav2vec2];
  if (sana) records.push(sana);
  const associations = new Map();
  for (const { association } of records) {
    assert.ok(!associations.has(association.workflowId), 'Retained Gallery workflow association is duplicated.');
    associations.set(association.workflowId, association);
  }
  return associations;
}
