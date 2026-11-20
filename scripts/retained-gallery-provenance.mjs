import { createHash } from 'node:crypto';
import { canonicalJsonHash } from './canonical-json.mjs';

export const RETAINED_GALLERY_PROVENANCE_FORMAT = 'modiff.gallery.retained-template-provenance.v1';

// The public copy omits the original task ID and all underlying capture files.
// Pin the exact redacted associations that the maintainer reviewed against the
// original runs, so a rewritten association cannot approve itself.
const originalBackendSourceFingerprint =
  'sha256:backend-source-v1:8dd9a4d61d2c9c484e4167e38e7360d6b64a37d278e49771630e428189f5448b';
const pinsByTemplate = new Map(
  Object.entries({
    marigold_depth_synthetic_ramp: {
      associationSha256: '9bf40847cebd0424cc17f8af5f87d7ce3a9e463ed0593177c1483f62a3a9e945',
      backendSourceFingerprint: originalBackendSourceFingerprint,
      backendContractFingerprint:
        'sha256:backend-contract-v1:d159675b024e7b008f6347cf9655169efaa55dc928ddd7e17aae1fab5ca6fb29',
      templateRevisionHash: '4e43813ae0e4b664e4982545884644ec097eb0cc25e8f13ff549ac24c2f49ce1',
      capturedAt: '2026-11-19T07:35:33.324Z',
      inputSize: { width: 64, height: 48 },
      outputSize: { width: 64, height: 48 },
      outputExtension: 'webp',
    },
    smollm2_rain_gauge: {
      associationSha256: 'a31b55bc4524f2e5999ac84a3c5a9f62350f45c807a1f03a0c14904b31e19c8d',
      backendSourceFingerprint: originalBackendSourceFingerprint,
      backendContractFingerprint:
        'sha256:backend-contract-v1:cb7aeec701fb0aba61ab0c4fdffd3efbbde9f359f0b22b127d29c83cd44c1d00',
      templateRevisionHash: 'aab7cfcf15db94d4e3d1415e963cabc0cf7e6a4baafd243d4095539b1004545b',
      capturedAt: '2026-11-19T07:50:15.253Z',
      outputExtension: 'json',
    },
    spandrel_x2_synthetic_gradient: {
      associationSha256: 'bc51ecc479d2996d44954e4283d8cdad857f72ea1d5e35af7ef5afcecd7c1fb0',
      backendSourceFingerprint:
        'sha256:backend-source-v1:fd16f3acc76e08525b28215b603104d281e8ab26169b03076a112edbb7d100bb',
      backendContractFingerprint:
        'sha256:backend-contract-v1:bb13de17797e5bf1f3427f45b91f253013f7f0e590749710332783f28d251566',
      templateRevisionHash: '8de95b8b13a0636a37a7db672fbced2199e00e6719517c282f68f685bc5fd482',
      capturedAt: '2026-11-19T06:05:44.894Z',
      inputSize: { width: 64, height: 48 },
      outputSize: { width: 128, height: 96 },
      outputExtension: 'webp',
    },
    whisper_tiny_blue_cup_transcription: {
      associationSha256: '17998ed9f920a3656b4b30178f18b03ef3c709dcaf6e43cfdd7c0804fa5c7b8c',
      backendSourceFingerprint:
        'sha256:backend-source-v1:674f8959f84e6b26f6ff04d8c7cdd2af9d9a5f4e438a325ecd4c042ecda9eeab',
      backendContractFingerprint:
        'sha256:backend-contract-v1:a54ff5dae2f71449c7a5b7cbb9f3db0277594d7e5117f892ecc21d4ce676f98f',
      templateRevisionHash: 'f9e6bd0b708cc08d7068555be9f4094f68cc9aa6115639792339f50b38c2e35c',
      capturedAt: '2026-11-20T15:39:15.190Z',
      outputExtension: 'json',
    },
    lcm_dawn_alpine_lake: {
      associationSha256: '33a841dd30dfa18c0de548283a9adbcb92b7a89fc28a0defe3975b79f0cbeb10',
      backendSourceFingerprint:
        'sha256:backend-source-v1:56db5ad14d640c084f94cafa1e746939ebff60ac39d214f5d413dca61b94df66',
      backendContractFingerprint:
        'sha256:backend-contract-v1:315617df789a8a5f57426692318e197c13786098718305edd1927471b5b9c194',
      templateRevisionHash: '79ee258770b00a581d8e006b743cacd78ad992739353bcfcd724a920eb41fc8e',
      capturedAt: '2026-11-20T16:22:50.650Z',
      inputSize: { width: 512, height: 512 },
      outputSize: { width: 512, height: 512 },
      beforeExtension: 'webp',
      outputExtension: 'webp',
    },
  }),
);

export function retainedGalleryProvenancePins(templateId) {
  const pins = pinsByTemplate.get(templateId);
  return (
    pins && {
      ...pins,
      inputSize: pins.inputSize && { ...pins.inputSize },
      outputSize: pins.outputSize && { ...pins.outputSize },
    }
  );
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
    beforePath: pins.inputSize ? base + 'inputs/' + stem + '.before.' + (pins.beforeExtension ?? 'png') : undefined,
    afterPath: pins.inputSize ? outputPath : undefined,
    beforeMediaHash: output.inputEncodedSha256,
    width: pins.outputSize?.width,
    height: pins.outputSize?.height,
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
