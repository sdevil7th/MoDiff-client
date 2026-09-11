import { uploadBackendFile } from '../utils/backendUpload';
import { requestBlob } from '../utils/requestJson';
import { resolveTemplateAssetUrl } from './templateAssets';
import type {
  StudioTemplate,
  StudioTemplateDefaultInputAsset,
  StudioTemplateInputBinding,
  StudioTemplateInputFormField,
  StudioTemplateInputFormPatch,
} from './types';

type TemplateInputRequirement = {
  field: StudioTemplateInputFormField;
  label: string;
  count: number;
};

export type TemplateInputResolution = {
  missingLabels: string[];
  templateDefaultBindings: Array<Extract<StudioTemplateInputBinding, { origin: 'template' }>>;
  downstreamBindings: Array<Extract<StudioTemplateInputBinding, { origin: 'graph' }>>;
};

export type TemplateInputMaterializer = {
  load: (asset: StudioTemplateDefaultInputAsset) => Promise<Blob>;
  upload: (file: File, mediaType: StudioTemplateDefaultInputAsset['mediaType']) => Promise<string>;
  sha256: (blob: Blob) => Promise<`sha256:bytes:${string}`>;
};

const FORM_FIELD_LABELS: Record<StudioTemplateInputFormField, string> = {
  referenceImages: 'Reference image',
  maskImage: 'Mask image',
  controlImage: 'Control image',
  ipAdapterImage: 'IP-Adapter image',
  sourceVideo: 'Source video',
  maskVideo: 'Mask video',
  controlVideo: 'Control video',
  sourceAudio: 'Source audio',
  referenceAudio: 'Reference audio',
};

function legacyRequirements(template: StudioTemplate): TemplateInputRequirement[] {
  const requirements = template.inputRequirements;
  if (!requirements) return [];

  const values: TemplateInputRequirement[] = [];
  if (requirements.sourceImage) {
    values.push({ field: 'referenceImages', label: 'Source image', count: 1 });
  }
  if (requirements.referenceImages) {
    values.push({
      field: 'referenceImages',
      label: `${requirements.referenceImages} reference image${requirements.referenceImages === 1 ? '' : 's'}`,
      count: requirements.referenceImages,
    });
  }
  if (requirements.controlImage) values.push({ field: 'controlImage', label: 'Control image', count: 1 });
  if (requirements.maskImage) values.push({ field: 'maskImage', label: 'Mask image', count: 1 });
  if (requirements.sourceVideo) values.push({ field: 'sourceVideo', label: 'Source video', count: 1 });
  if (requirements.maskVideo) values.push({ field: 'maskVideo', label: 'Mask video', count: 1 });
  if (requirements.controlVideo) values.push({ field: 'controlVideo', label: 'Control video', count: 1 });
  if (requirements.sourceAudio) values.push({ field: 'sourceAudio', label: 'Source audio', count: 1 });
  if (requirements.referenceAudio) values.push({ field: 'referenceAudio', label: 'Reference audio', count: 1 });
  return values;
}

function workflowStartRequirements(template: StudioTemplate) {
  const requirements = legacyRequirements(template);
  for (const binding of template.inputBindings ?? []) {
    if (binding.requiredAt !== 'workflow_start') continue;
    if (requirements.some((requirement) => requirement.field === binding.field)) continue;
    requirements.push({
      field: binding.field,
      label: binding.label || FORM_FIELD_LABELS[binding.field],
      count: binding.origin === 'user' ? (binding.count ?? 1) : Math.max(binding.defaultAssets.length, 1),
    });
  }
  return requirements;
}

/**
 * Resolves the template's own declared inputs. It deliberately does not look
 * at the currently open Studio form: assets from one workflow must not make an
 * unrelated template card appear runnable.
 */
export function resolveTemplateInputs(template: StudioTemplate): TemplateInputResolution {
  const bindings = template.inputBindings ?? [];
  const templateDefaultBindings = bindings.filter(
    (binding): binding is Extract<StudioTemplateInputBinding, { origin: 'template' }> => binding.origin === 'template',
  );
  const downstreamBindings = bindings.filter(
    (binding): binding is Extract<StudioTemplateInputBinding, { origin: 'graph' }> => binding.origin === 'graph',
  );
  const missingLabels = workflowStartRequirements(template)
    .filter((requirement) => {
      const defaultCount = templateDefaultBindings
        .filter((binding) => binding.field === requirement.field)
        .reduce((count, binding) => count + binding.defaultAssets.length, 0);
      return defaultCount < requirement.count;
    })
    .map((requirement) => requirement.label);

  return {
    missingLabels: Array.from(new Set(missingLabels)),
    templateDefaultBindings,
    downstreamBindings,
  };
}

function bytesHash(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Blob(blob: Blob): Promise<`sha256:bytes:${string}`> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser cannot verify bundled template input checksums.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return `sha256:bytes:${bytesHash(digest)}`;
}

function assetFileName(asset: StudioTemplateDefaultInputAsset) {
  if (asset.fileName?.trim()) return asset.fileName.trim();
  const pathname = new URL(asset.runtimePath, 'http://modiff.local').pathname;
  const parts = pathname.split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] ?? `${asset.id}.bin`);
}

function backendUploadType(mediaType: StudioTemplateDefaultInputAsset['mediaType']) {
  if (mediaType === 'video') return 'videos';
  if (mediaType === 'audio') return 'audio';
  return 'images';
}

const DEFAULT_MATERIALIZER: TemplateInputMaterializer = {
  load: (asset) => requestBlob(resolveTemplateAssetUrl(asset.runtimePath) ?? asset.runtimePath, { timeoutMs: 60_000 }),
  upload: async (file, mediaType) => {
    const [path] = await uploadBackendFile(file, backendUploadType(mediaType));
    if (!path) throw new Error(`MoDiff did not return a path for ${file.name}.`);
    return path;
  },
  sha256: sha256Blob,
};

function setInputPatchField(patch: StudioTemplateInputFormPatch, field: StudioTemplateInputFormField, paths: string[]) {
  if (field === 'referenceImages') {
    patch.referenceImages = [...(patch.referenceImages ?? []), ...paths];
    return;
  }
  const path = paths[0];
  if (!path) throw new Error(`Template input ${FORM_FIELD_LABELS[field]} has no runtime asset.`);
  patch[field] = path;
}

/**
 * Fetches byte-pinned template inputs and persists them through MoDiff's normal
 * upload API. Returned values are backend-readable paths, never browser URLs.
 */
export async function materializeTemplateDefaultInputs(
  template: StudioTemplate,
  materializer: TemplateInputMaterializer = DEFAULT_MATERIALIZER,
): Promise<StudioTemplateInputFormPatch> {
  const patch: StudioTemplateInputFormPatch = {};
  const { templateDefaultBindings } = resolveTemplateInputs(template);

  const preparedBindings = await Promise.all(
    templateDefaultBindings.map(async (binding) => ({
      binding,
      assets: await Promise.all(
        binding.defaultAssets.map(async (asset) => {
          const blob = await materializer.load(asset);
          const actualHash = await materializer.sha256(blob);
          if (actualHash !== asset.runtimeSha256) {
            throw new Error(
              `${asset.label} failed checksum verification (expected ${asset.runtimeSha256}, received ${actualHash}).`,
            );
          }
          return {
            asset,
            file: new File([blob], assetFileName(asset), {
              type: blob.type || `${asset.mediaType}/*`,
              lastModified: 0,
            }),
          };
        }),
      ),
    })),
  );

  for (const { assets, binding } of preparedBindings) {
    const paths = await Promise.all(assets.map(({ asset, file }) => materializer.upload(file, asset.mediaType)));
    setInputPatchField(patch, binding.field, paths);
  }

  return patch;
}
