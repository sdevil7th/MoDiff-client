import config from '../../app.config';

export type ImageArtifact = {
  url?: string;
  nodeId?: string;
  fieldKey?: string;
  index?: number;
  mimeType?: string;
  filename?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  displayType?: 'image' | 'video' | 'audio' | 'text' | 'json' | 'unknown';
  clientRunId?: string;
  runInputHash?: string;
  attemptIndex?: number;
  taskId?: string | null;
  source?: 'cache' | 'file' | 'data' | 'url' | string;
};

export type MediaArtifact = ImageArtifact;

export type NormalizedImageArtifact = ImageArtifact & {
  url: string;
  index: number;
  filename: string;
  mimeType: string;
};

function isAbsoluteUrl(value: string) {
  return /^(?:https?:|data:|blob:)/i.test(value);
}

export function absoluteImageUrl(value: string) {
  if (isAbsoluteUrl(value)) return value;
  if (value.startsWith('/')) return `${config.serverAddress}${value}`;
  return value;
}

function isSafeImageDataUrl(value: string) {
  const mimeType = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(value)?.[1]?.trim().toLowerCase();
  return Boolean(mimeType?.startsWith('image/') && mimeType !== 'image/svg+xml');
}

export function sanitizeImageArtifactUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const candidate = absoluteImageUrl(value.trim());
  if (/^data:/i.test(candidate)) return isSafeImageDataUrl(candidate) ? candidate : null;
  try {
    const parsed = new URL(candidate, config.serverAddress);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
}

function extensionFromMime(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('webp')) return 'webp';
  return 'png';
}

function extensionFromUrl(url: string) {
  const path = url.split('?')[0] ?? '';
  const match = path.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function fallbackFilename(artifact: Partial<ImageArtifact>, index: number, mimeType: string) {
  const ext = extensionFromUrl(artifact.url ?? '') ?? extensionFromMime(mimeType);
  const node = artifact.nodeId || 'node';
  const field = artifact.fieldKey || 'image';
  return `modiff-${node}-${field}-${index}.${ext}`;
}

export function normalizeImageArtifacts(options: {
  value: unknown;
  artifacts?: unknown;
  dataType: string | null;
  mimeType: string;
  nodeId?: string;
  fieldKey?: string;
}): NormalizedImageArtifact[] {
  const values = (Array.isArray(options.value) ? options.value : [options.value]).filter(
    (image) => image !== '' && image !== null && image !== undefined,
  );
  const artifacts = Array.isArray(options.artifacts) ? options.artifacts : [];

  return values
    .map((value, index): NormalizedImageArtifact | null => {
      const rawArtifact = artifacts[index];
      const artifact = rawArtifact && typeof rawArtifact === 'object' ? (rawArtifact as ImageArtifact) : {};
      let url = typeof artifact.url === 'string' ? artifact.url : '';

      if (!url && typeof value === 'string') {
        if (options.dataType === 'url') {
          url = value;
        } else if (value.startsWith('data:')) {
          url = value;
        } else {
          url = `data:${artifact.mimeType || options.mimeType};base64,${value}`;
        }
      }

      if (!url) return null;

      const mimeType = artifact.mimeType || options.mimeType;
      const safeUrl = sanitizeImageArtifactUrl(url);
      if (!safeUrl) return null;
      const normalized = {
        ...artifact,
        nodeId: artifact.nodeId || options.nodeId,
        fieldKey: artifact.fieldKey || options.fieldKey,
        index: typeof artifact.index === 'number' ? artifact.index : index,
        mimeType,
        url: safeUrl,
      };

      return {
        ...normalized,
        filename: artifact.filename || fallbackFilename(normalized, index, mimeType),
      };
    })
    .filter((image): image is NormalizedImageArtifact => Boolean(image));
}
