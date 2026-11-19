import { createHash } from 'node:crypto';
import { canonicalJsonHash } from './canonical-json.mjs';

export const RETAINED_GALLERY_PROVENANCE_FORMAT = 'modiff.gallery.retained-template-provenance.v1';

// The public copy omits the original task ID and all underlying capture files.
// Pin the exact redacted associations that the maintainer reviewed against the
// original runs, so a rewritten association cannot approve itself.
const backendSourceFingerprint =
  'sha256:backend-source-v1:8dd9a4d61d2c9c484e4167e38e7360d6b64a37d278e49771630e428189f5448b';
const pinsByTemplate = new Map(
  Object.entries({
    marigold_depth_synthetic_ramp: {
      associationSha256: '9bf40847cebd0424cc17f8af5f87d7ce3a9e463ed0593177c1483f62a3a9e945',
      backendContractFingerprint:
        'sha256:backend-contract-v1:d159675b024e7b008f6347cf9655169efaa55dc928ddd7e17aae1fab5ca6fb29',
      templateRevisionHash: '4e43813ae0e4b664e4982545884644ec097eb0cc25e8f13ff549ac24c2f49ce1',
      capturedAt: '2026-11-19T07:35:33.324Z',
      inputSize: { width: 64, height: 48 },
      outputExtension: 'webp',
    },
    smollm2_rain_gauge: {
      associationSha256: 'a31b55bc4524f2e5999ac84a3c5a9f62350f45c807a1f03a0c14904b31e19c8d',
      backendContractFingerprint:
        'sha256:backend-contract-v1:cb7aeec701fb0aba61ab0c4fdffd3efbbde9f359f0b22b127d29c83cd44c1d00',
      templateRevisionHash: 'aab7cfcf15db94d4e3d1415e963cabc0cf7e6a4baafd243d4095539b1004545b',
      capturedAt: '2026-11-19T07:50:15.253Z',
      outputExtension: 'json',
    },
  }),
);

export function retainedGalleryProvenancePins(templateId) {
  const pins = pinsByTemplate.get(templateId);
  return pins && { ...pins, inputSize: pins.inputSize && { ...pins.inputSize }, backendSourceFingerprint };
}

export function buildRetainedGalleryProvenance(association) {
  const { originalTaskId: _privateTaskId, ...publicAssociation } = association;
  const { templateId } = publicAssociation;
  const pins = pinsByTemplate.get(templateId);
  if (!pins || canonicalJsonHash(publicAssociation) !== pins.associationSha256) {
    throw new Error('Retained Gallery association differs from the approved observation.');
  }
  return {
    schemaVersion: 1,
    format: RETAINED_GALLERY_PROVENANCE_FORMAT,
    templateId,
    association: publicAssociation,
  };
}

function encodedHash(bytes) {
  return Buffer.isBuffer(bytes) ? 'sha256:bytes:' + createHash('sha256').update(bytes).digest('hex') : null;
}

// The normal Gallery verifier still checks the decoded output, full sidecar
// hash and quality rubric. This branch establishes the retained run bindings
// against the current catalog and the encoded bytes that were approved.
export function validateRetainedGalleryProvenance(bundle, entry, { templateRevisionHash, outputBytes, beforeBytes }) {
  const pins = retainedGalleryProvenancePins(entry.templateId);
  if (
    !pins ||
    bundle?.schemaVersion !== 1 ||
    bundle.format !== RETAINED_GALLERY_PROVENANCE_FORMAT ||
    bundle.templateId !== entry.templateId ||
    Object.keys(bundle).sort().join(',') !== 'association,format,schemaVersion,templateId' ||
    !bundle.association ||
    canonicalJsonHash(bundle.association) !== pins.associationSha256
  ) {
    return ['retained Gallery provenance is outside the exact approved association'];
  }
  const association = bundle.association;
  const { output, observedExecution } = association;
  const [model] = observedExecution.modelSet;
  const base = '/template-gallery/';
  const stem = entry.templateId;
  const outputPath = base + stem + '.' + pins.outputExtension;
  const expected = {
    templateRevisionHash: pins.templateRevisionHash,
    proofLockHash: association.associationHash,
    graphHash: association.originalGraphHash,
    backendSourceFingerprint: pins.backendSourceFingerprint,
    backendContractFingerprint: pins.backendContractFingerprint,
    templateLockHash: association.galleryTemplateLockHash,
    promptSettingsHash: association.catalogPromptSettingsHash,
    runtimeFingerprint: observedExecution.runtimeFingerprint,
    modelRevision: model.repoId + '@' + model.revision,
    modelCommit: model.revision,
    mediaType: output.mediaType,
    mediaHash: output.decodedMediaHash,
    outputPath,
    thumbnailPath: outputPath,
    provenancePath: base + 'reviews/' + stem + '.retained-template-provenance.json',
    qualityReviewPath: base + 'reviews/' + stem + '.quality-review.json',
    qualityReviewHash: association.qualityReviewHash,
    qualityReviewStatus: 'approved_reviewed',
    verificationStatus: 'reviewed',
    verificationTimestamp: pins.capturedAt,
    beforePath: pins.inputSize ? base + 'inputs/' + stem + '.before.png' : undefined,
    afterPath: pins.inputSize ? outputPath : undefined,
    beforeMediaHash: output.inputEncodedSha256,
    width: pins.inputSize?.width,
    height: pins.inputSize?.height,
  };
  const errors = Object.entries(expected)
    .filter(([field, value]) => entry[field] !== value)
    .map(([field]) => 'retained Gallery manifest ' + field + ' differs from the approved observation');
  if (templateRevisionHash !== pins.templateRevisionHash) {
    errors.push('retained Gallery recipe does not match the current template');
  }
  if (outputBytes?.length !== output.outputBytes || encodedHash(outputBytes) !== output.outputEncodedSha256) {
    errors.push('retained Gallery output bytes differ from the approved artifact');
  }
  if (pins.inputSize ? encodedHash(beforeBytes) !== output.inputEncodedSha256 : beforeBytes !== undefined) {
    errors.push('retained Gallery source bytes differ from the approved artifact');
  }
  if (
    [
      'modelSetHash',
      'inputArtifactsHash',
      'templateInputContractHash',
      'beforeSourceMediaHash',
      'cardPreviewPath',
      'cardPreviewSha256',
      'posterPath',
      'decodedAudioHash',
      'audiovisualMediaHash',
      'durationSeconds',
      'frames',
    ].some((field) => entry[field] !== undefined)
  ) {
    errors.push('retained Gallery entry has unreviewed asset or capture fields');
  }
  return errors;
}
