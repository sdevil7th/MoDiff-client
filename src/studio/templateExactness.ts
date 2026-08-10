import { getFormDefaultsForMode } from './modelProfiles';
import { coerceStudioTemplateId } from './outputContracts';
import templateGalleryContract from './templateGalleryContract.json';
import { resolveTemplateAssetUrl } from './templateAssets';
import { getPreset } from './templates';
import type {
  StudioFormState,
  StudioTemplate,
  StudioTemplateId,
  StudioTemplateLockedSettings,
  TemplateMediaType,
} from './types';
import { hashString, stableStringify } from './stableHash';
export { hashString, stableStringify } from './stableHash';

export const TEMPLATE_GALLERY_MANIFEST_PATH = resolveTemplateAssetUrl('/template-gallery/manifest.json') as string;

// Revocation follows the rejected proof, not the template id. A regenerated
// proof with a different decoded hash can qualify through the normal exactness
// and media-quality gates without a code change.
const REVOKED_TEMPLATE_MEDIA_HASHES = new Set([
  'sha256:decoded-video-framemd5:f679ba3e4fb4bedf3b0d3868462c6f9965b41bef76059164139e2373be3b8c2a',
  'sha256:decoded-video-framemd5:346b9ca1410359054c090c54f7238914997222f3999d836553cd3921817a07cf',
  'sha256:decoded-video-framemd5:7a8dd1467c1329a2908651182638d2fc26346da92d06c19dbfd97c6e303cd739',
  'sha256:decoded-video-framemd5:e82217fee5a001f021e135d148177e30138b6bb0ba25b83c17fd6612ca0d62c5',
  'sha256:decoded-video-rgba:1ef12155f87252ecf03a4e345d59bbb8852b1992f80663e03e235a7abed8fa74',
  'sha256:decoded-video-rgba:0b8c2f66c70c2d96d972177ccdf86f72f824a2aa4fe641d718d90e2e934e5a1f',
]);
const REVOKED_TEMPLATE_AUDIOVISUAL_IDENTITIES = [
  {
    decodedMediaHash: 'sha256:decoded-video-framemd5:f46d1387bd5848c62fe9343a800d813a906ea33e0139f43f50926cc822bb1de7',
    decodedAudioHash:
      'sha256:decoded-audio-pcm-s16le-48000-stereo:811cfa5f48a6b84410a861f25488709641f03d208092f60c6dbe6040f2b089aa',
  },
  {
    decodedMediaHash: 'sha256:decoded-video-framemd5:ce8d9c7a4dfdca142c3acdddfc316cc6945b315f3bf3482f0a71885e2ad272b0',
    decodedAudioHash:
      'sha256:decoded-audio-pcm-s16le-48000-stereo:e7b220a396afb0fd2c41037d83378fa097936bbcc1bc1889c6c45f24861f2633',
  },
];

export type TemplateGalleryManifestEntry = {
  templateId: StudioTemplateId;
  promptSettingsHash: string;
  templateLockHash: string;
  modelRevision: string;
  runtimeFingerprint: string;
  graphHash: string;
  proofLockHash: string;
  backendSourceFingerprint: string;
  backendContractFingerprint: string;
  modelCommit: string;
  modelSetHash?: string;
  inputArtifactsHash?: string;
  templateInputContractHash?: string;
  templateRevisionHash: string;
  provenancePath: string;
  provenanceHash: string;
  outputPath: string;
  thumbnailPath: string;
  cardPreviewPath?: string;
  cardPreviewSha256?: string;
  beforePath?: string;
  /** Byte hash of the public browser derivative at beforePath. */
  beforeMediaHash?: string;
  /** Byte hash of the provenance-bound source used to create a video beforePath derivative. */
  beforeSourceMediaHash?: string;
  afterPath?: string;
  posterPath?: string;
  mediaHash: string;
  decodedAudioHash?: string;
  audiovisualMediaHash?: string;
  mediaType: TemplateMediaType;
  verificationTimestamp: string;
  qualityReviewPath: string;
  qualityReviewHash: string;
  verificationStatus?: 'reviewed' | 'exact';
  qualityReviewStatus: 'approved_reviewed' | 'approved_exact';
  reviewer: string;
  reviewedAt: string;
  width?: number;
  height?: number;
  frames?: number;
  durationSeconds?: number;
};

export type TemplateGalleryManifest = {
  schemaVersion: 2;
  generatedAt: string;
  runtimeFingerprint: string;
  examples: TemplateGalleryManifestEntry[];
};

type GalleryRecord = Record<string, unknown>;

function galleryRecord(value: unknown): GalleryRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as GalleryRecord) : null;
}

function validGalleryText(record: GalleryRecord, key: string, optional = false) {
  const value = record[key];
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`The template gallery manifest has an invalid ${key}.`);
  }
}

function validGalleryPath(record: GalleryRecord, key: string, optional = false) {
  validGalleryText(record, key, optional);
  const value = record[key];
  if (value === undefined) return;
  const path = value as string;
  if (
    !path.startsWith('/template-gallery/') ||
    path.includes('\\') ||
    path.includes('//') ||
    path.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`The template gallery manifest has an unsafe ${key}.`);
  }
}

export function parseTemplateGalleryManifest(value: unknown): TemplateGalleryManifest {
  const manifest = galleryRecord(value);
  if (!manifest || manifest.schemaVersion !== 2 || !Array.isArray(manifest.examples)) {
    throw new Error('The template gallery manifest is invalid.');
  }
  ['generatedAt', 'runtimeFingerprint'].forEach((key) => validGalleryText(manifest, key));
  if (!Number.isFinite(Date.parse(manifest.generatedAt as string))) throw new Error('Invalid gallery timestamp.');

  const seen = new Set<StudioTemplateId>();
  const requiredText = [
    'promptSettingsHash',
    'templateLockHash',
    'modelRevision',
    'runtimeFingerprint',
    'graphHash',
    'proofLockHash',
    'backendSourceFingerprint',
    'backendContractFingerprint',
    'modelCommit',
    'templateRevisionHash',
    'provenanceHash',
    'mediaHash',
    'verificationTimestamp',
    'qualityReviewHash',
    'qualityReviewStatus',
    'reviewer',
    'reviewedAt',
  ];
  const optionalText = [
    'modelSetHash',
    'inputArtifactsHash',
    'templateInputContractHash',
    'cardPreviewSha256',
    'beforeMediaHash',
    'beforeSourceMediaHash',
    'decodedAudioHash',
    'audiovisualMediaHash',
    'verificationStatus',
  ];
  const examples = manifest.examples.map((raw, index) => {
    const entry = galleryRecord(raw);
    if (!entry) throw new Error(`The template gallery manifest example ${index + 1} is invalid.`);
    validGalleryText(entry, 'templateId');
    validGalleryText(entry, 'mediaType');
    requiredText.forEach((key) => validGalleryText(entry, key));
    optionalText.forEach((key) => validGalleryText(entry, key, true));
    ['provenancePath', 'outputPath', 'thumbnailPath', 'qualityReviewPath'].forEach((key) =>
      validGalleryPath(entry, key),
    );
    ['cardPreviewPath', 'beforePath', 'afterPath', 'posterPath'].forEach((key) => validGalleryPath(entry, key, true));

    const templateId = coerceStudioTemplateId(entry.templateId);
    if (!templateId || templateId !== entry.templateId || seen.has(templateId)) {
      throw new Error(`The template gallery manifest has an invalid or duplicate templateId: ${entry.templateId}.`);
    }
    seen.add(templateId);
    if (!['image', 'video', 'audio', 'json'].includes(entry.mediaType as string)) throw new Error('Invalid mediaType.');
    if (entry.verificationStatus !== undefined && !['reviewed', 'exact'].includes(entry.verificationStatus as string)) {
      throw new Error('Invalid verificationStatus.');
    }
    if (!['approved_reviewed', 'approved_exact'].includes(entry.qualityReviewStatus as string)) {
      throw new Error('Invalid qualityReviewStatus.');
    }
    if (![entry.verificationTimestamp, entry.reviewedAt].every((item) => Number.isFinite(Date.parse(item as string)))) {
      throw new Error('Invalid review timestamp.');
    }
    ['width', 'height', 'frames', 'durationSeconds'].forEach((key) => {
      const metric = entry[key];
      if (metric !== undefined && (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0)) {
        throw new Error(`The template gallery manifest has an invalid ${key}.`);
      }
      if (metric !== undefined && key !== 'durationSeconds' && !Number.isInteger(metric)) {
        throw new Error(`The template gallery manifest has an invalid ${key}.`);
      }
    });
    return { ...entry, templateId } as TemplateGalleryManifestEntry;
  });
  return {
    schemaVersion: 2,
    generatedAt: manifest.generatedAt as string,
    runtimeFingerprint: manifest.runtimeFingerprint as string,
    examples,
  };
}

export type TemplateExampleUiState = {
  status: 'reviewed' | 'exact' | 'modified' | 'blocked' | 'unverified' | 'non_exact';
  label: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
  modifiedFields: Array<keyof StudioTemplateLockedSettings>;
  manifestEntry?: TemplateGalleryManifestEntry;
};

const LOCKED_FIELDS = [
  'mode',
  'modelType',
  'prompt',
  'negativePrompt',
  'width',
  'height',
  'seed',
  'randomSeed',
  'steps',
  'guidanceScale',
  'resourceMode',
  'dtype',
  'quantizationMode',
  'autoOffload',
  'offloadMode',
  'strength',
  'layers',
  'outpaintLeft',
  'outpaintRight',
  'outpaintTop',
  'outpaintBottom',
  'outpaintOverlap',
  'outpaintFeather',
  'outpaintFillColor',
  'sourceVideo',
  'maskVideo',
  'controlVideo',
  'sourceAudio',
  'referenceAudio',
  'lyrics',
  'audioDuration',
  'extensionDuration',
  'vocalLanguage',
  'repaintingStart',
  'repaintingEnd',
  'audioCoverStrength',
  'shift',
  'bpm',
  'keyscale',
  'timesignature',
  'numFrames',
  'fps',
  'conditioningScale',
  'guidanceScale2',
  'outputType',
  'maxSequenceLength',
  'attentionKwargsJson',
] satisfies Array<keyof StudioTemplateLockedSettings>;

export function getTemplateInputContractHash(template: StudioTemplate) {
  const defaults = (template.inputBindings ?? [])
    .filter((binding) => binding.origin === 'template')
    .map((binding) => ({
      id: binding.id,
      field: binding.field,
      mediaType: binding.mediaType,
      assets: binding.defaultAssets.map((asset) => ({
        id: asset.id,
        mediaType: asset.mediaType,
        runtimeSha256: asset.runtimeSha256,
      })),
    }));
  if (defaults.length === 0) return undefined;
  return `tic_${hashString(stableStringify(defaults))}`;
}

export function getTemplateLockedSettings(template: StudioTemplate): StudioTemplateLockedSettings {
  const defaults = getFormDefaultsForMode(template.mode, template.modelType);
  const presetValues = getPreset(template.presetId)?.values ?? {};
  const lockedSettings = template.example?.lockedSettings ?? {};
  const merged: StudioFormState = {
    ...defaults,
    ...presetValues,
    ...lockedSettings,
    mode: template.mode,
    modelType: template.modelType,
    prompt: template.prompt,
    negativePrompt: template.negativePrompt ?? '',
    seed: template.example?.lockedSeed ?? lockedSettings.seed ?? defaults.seed,
    randomSeed: false,
  };

  return LOCKED_FIELDS.reduce(
    (settings, field) => ({
      ...settings,
      [field]: merged[field],
    }),
    {} as StudioTemplateLockedSettings,
  );
}

export function getTemplateLockHash(
  template: StudioTemplate,
  modelRevision = template.example?.modelRevision ?? 'unlocked',
) {
  const workflowLock = template.workflowBlocks?.length
    ? {
        blocks: template.workflowBlocks,
        settings: template.workflowBlockSettings ?? {},
      }
    : undefined;
  return `tpl_${hashString(
    stableStringify({
      templateId: template.id,
      lockedSettings: getTemplateLockedSettings(template),
      modelRevision,
      mediaType: template.example?.mediaType ?? 'image',
      ...(workflowLock ? { workflow: workflowLock } : {}),
    }),
  )}`;
}

export function getPromptSettingsHash(settings: StudioTemplateLockedSettings | StudioFormState) {
  const promptSettings = LOCKED_FIELDS.reduce(
    (locked, field) => ({
      ...locked,
      [field]: settings[field],
    }),
    {} as StudioTemplateLockedSettings,
  );

  return `ps_${hashString(stableStringify(promptSettings))}`;
}

export function getTemplateModifiedFields(template: StudioTemplate, form: StudioFormState) {
  const locked = getTemplateLockedSettings(template);
  return LOCKED_FIELDS.filter((field) => {
    const lockedValue = locked[field];
    const formValue = form[field];
    return String(lockedValue) !== String(formValue);
  });
}

export function isTemplateExactEligible(template: StudioTemplate, form: StudioFormState) {
  return getTemplateModifiedFields(template, form).length === 0;
}

function matchesTemplateMediaContract(template: StudioTemplate, entry: TemplateGalleryManifestEntry) {
  if (entry.mediaType !== 'video') return true;

  const contract = templateGalleryContract.video;
  const expected = {
    ...(template.example?.expectedOutput ?? {}),
    ...(template.example?.galleryExpectedOutput ?? {}),
  };
  const width = Number(entry.width ?? 0);
  const height = Number(entry.height ?? 0);
  const frames = Number(entry.frames ?? 0);
  const durationSeconds = Number(entry.durationSeconds ?? 0);
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  if (
    durationSeconds < contract.minimumDurationSeconds ||
    frames < contract.minimumFrames ||
    shortEdge < contract.minimumShortEdge ||
    longEdge < contract.minimumLongEdge
  ) {
    return false;
  }
  if (expected.requiresAudio === true && (!entry.decodedAudioHash || !entry.audiovisualMediaHash)) {
    return false;
  }

  if (expected?.width !== undefined && width !== Number(expected.width)) return false;
  if (expected?.height !== undefined && height !== Number(expected.height)) return false;
  if (expected?.frames !== undefined && frames !== Number(expected.frames)) return false;
  if (
    expected?.durationSeconds !== undefined &&
    Math.abs(durationSeconds - Number(expected.durationSeconds)) > contract.durationToleranceSeconds
  ) {
    return false;
  }
  return true;
}

function isRevokedTemplateMedia(entry: TemplateGalleryManifestEntry) {
  if (REVOKED_TEMPLATE_MEDIA_HASHES.has(entry.mediaHash)) return true;
  return REVOKED_TEMPLATE_AUDIOVISUAL_IDENTITIES.some(
    (identity) => identity.decodedMediaHash === entry.mediaHash && identity.decodedAudioHash === entry.decodedAudioHash,
  );
}

export function findManifestEntry(
  template: StudioTemplate,
  manifest: TemplateGalleryManifest | null | undefined,
  options: { requireCardPreview?: boolean } = {},
) {
  if (!manifest || manifest.schemaVersion !== 2) return undefined;
  const requireCardPreview = options.requireCardPreview ?? true;
  const promptSettingsHash = getPromptSettingsHash(getTemplateLockedSettings(template));
  const templateInputContractHash = getTemplateInputContractHash(template);
  return manifest.examples.find(
    (entry) =>
      coerceStudioTemplateId(entry.templateId) === template.id &&
      entry.templateLockHash === getTemplateLockHash(template, entry.modelRevision) &&
      entry.promptSettingsHash === promptSettingsHash &&
      entry.templateInputContractHash === templateInputContractHash &&
      ['approved_reviewed', 'approved_exact'].includes(entry.qualityReviewStatus) &&
      Boolean(entry.qualityReviewHash) &&
      Boolean(entry.provenanceHash) &&
      Boolean(entry.graphHash) &&
      Boolean(entry.mediaHash) &&
      !isRevokedTemplateMedia(entry) &&
      matchesTemplateMediaContract(template, entry) &&
      (entry.mediaType !== 'video' ||
        !requireCardPreview ||
        (Boolean(entry.cardPreviewPath) && Boolean(entry.cardPreviewSha256))),
  );
}

export function getTemplateExampleUiState(
  template: StudioTemplate,
  form: StudioFormState,
  activeTemplateId: StudioTemplateId | null,
  manifest: TemplateGalleryManifest | null | undefined,
): TemplateExampleUiState {
  const modifiedFields = activeTemplateId === template.id ? getTemplateModifiedFields(template, form) : [];
  if (modifiedFields.length > 0) {
    return { status: 'modified', label: 'Modified', tone: 'warning', modifiedFields };
  }

  const manifestEntry = findManifestEntry(template, manifest);
  if (manifestEntry) {
    const verificationStatus =
      manifestEntry.verificationStatus ??
      (manifestEntry.qualityReviewStatus === 'approved_exact' ? 'exact' : 'reviewed');
    return {
      status: verificationStatus,
      label: verificationStatus === 'exact' ? 'Exact' : 'Reviewed',
      tone: 'success',
      modifiedFields,
      manifestEntry,
    };
  }

  if (template.example?.status === 'blocked') {
    return { status: 'blocked', label: 'Blocked', tone: 'error', modifiedFields };
  }

  if (template.example?.status === 'non_exact') {
    return { status: 'non_exact', label: 'Non-exact', tone: 'neutral', modifiedFields };
  }

  return { status: 'unverified', label: 'Unverified', tone: 'neutral', modifiedFields };
}

export function templateManifestPath(path: string | undefined) {
  return resolveTemplateAssetUrl(path);
}

export type TemplateCardMedia = {
  beforePath?: string;
  mediaPath?: string;
  thumbnailPath?: string;
};

/**
 * Resolves card media through the same exactness gate used to qualify a
 * published example. Card browsing is independent from the active form: a
 * user editing an instantiated workflow must not invalidate the immutable
 * base-template preview. Conversely, a stale, revoked, or mismatched manifest
 * entry must not contribute any generated card media.
 *
 * A template-owned thumbnail remains an editorial fallback for recipes that
 * do not yet have a qualifying generated proof.
 */
export function getTemplateCardMedia(
  template: StudioTemplate,
  manifest: TemplateGalleryManifest | null | undefined,
): TemplateCardMedia {
  const manifestEntry = findManifestEntry(template, manifest);
  const bundledSourcePreview =
    template.outputKinds?.[0] === 'audio'
      ? template.inputBindings
          ?.filter((binding) => binding.origin === 'template')
          .flatMap((binding) => binding.defaultAssets)
          .find((asset) => asset.previewPath)?.previewPath
      : undefined;
  const thumbnailPath =
    templateManifestPath(manifestEntry?.thumbnailPath ?? manifestEntry?.posterPath) ??
    templateManifestPath(template.example?.thumbnailPath ?? template.example?.outputPath);
  const selectedAudioExample =
    template.outputKinds?.[0] === 'audio' ? templateManifestPath(template.example?.outputPath) : undefined;
  const generatedOutputPath =
    templateManifestPath(manifestEntry?.afterPath ?? manifestEntry?.outputPath) ?? selectedAudioExample;
  const isVideo = template.outputKinds?.[0] === 'video' || manifestEntry?.mediaType === 'video';

  return {
    beforePath: templateManifestPath(manifestEntry?.beforePath ?? bundledSourcePreview),
    mediaPath: isVideo ? templateManifestPath(manifestEntry?.cardPreviewPath) : generatedOutputPath,
    thumbnailPath,
  };
}
