import { getFormDefaultsForMode } from './modelProfiles';
import { coerceStudioTemplateId } from './outputContracts';
import { getPreset } from './templates';
import type {
  StudioFormState,
  StudioTemplate,
  StudioTemplateId,
  StudioTemplateLockedSettings,
  TemplateMediaType,
} from './types';

export const TEMPLATE_GALLERY_MANIFEST_PATH = '/template-gallery/manifest.json';

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
  templateRevisionHash: string;
  provenancePath: string;
  provenanceHash: string;
  outputPath: string;
  thumbnailPath: string;
  beforePath?: string;
  beforeMediaHash?: string;
  afterPath?: string;
  posterPath?: string;
  mediaHash: string;
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
  durationSeconds?: number;
};

export type TemplateGalleryManifest = {
  schemaVersion: 2;
  generatedAt: string;
  runtimeFingerprint: string;
  examples: TemplateGalleryManifestEntry[];
};

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

function orderedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, orderedValue(entryValue)]),
  );
}

export function stableStringify(value: unknown) {
  return JSON.stringify(orderedValue(value));
}

export function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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

export function findManifestEntry(template: StudioTemplate, manifest: TemplateGalleryManifest | null | undefined) {
  if (!manifest || manifest.schemaVersion !== 2) return undefined;
  const promptSettingsHash = getPromptSettingsHash(getTemplateLockedSettings(template));
  return manifest.examples.find(
    (entry) =>
      coerceStudioTemplateId(entry.templateId) === template.id &&
      entry.templateLockHash === getTemplateLockHash(template, entry.modelRevision) &&
      entry.promptSettingsHash === promptSettingsHash &&
      ['approved_reviewed', 'approved_exact'].includes(entry.qualityReviewStatus) &&
      Boolean(entry.qualityReviewHash) &&
      Boolean(entry.provenanceHash) &&
      Boolean(entry.graphHash) &&
      Boolean(entry.mediaHash),
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
  if (!path) return undefined;
  return path.startsWith('/') ? path : `/${path.replace(/^public\//, '')}`;
}
