import type { StudioOutput } from './types';
import config from '../../app.config';
import { resolveTemplateAssetUrl } from './templateAssets';
import { bundledTemplateInputPreviewUrl } from './templateInputPreview';
import { outputMediaSizeLabel, outputNumericInputValue } from './resolvedExecutionInputs';

const IMAGE_EXTENSIONS = /\.(jpe?g|png|apng|webp|gif|bmp|ico|tiff|svg)(\?.*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|mkv|m4v)(\?.*)?$/i;
const AUDIO_EXTENSIONS = /\.(wav|mp3|flac|ogg|m4a|aac)(\?.*)?$/i;

/**
 * Runtime template defaults are uploaded under the backend data root and
 * represented by safe `@data/<relative>` identifiers. Their byte-identical
 * source is also available through the configured public template-asset
 * source. Prefer that public URL for previews so a backend reconnect or page
 * refresh cannot turn a valid template input into an "Image not found"
 * placeholder.
 */
export function bundledPublicAssetUrl(value: string) {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/template-gallery/')) return resolveTemplateAssetUrl(normalized) ?? normalized;
  const publicMarker = '/public/';
  const publicIndex = normalized.lastIndexOf(publicMarker);
  if (publicIndex >= 0) {
    const publicPath = normalized.slice(publicIndex + publicMarker.length);
    if (publicPath.startsWith('template-gallery/')) return resolveTemplateAssetUrl(publicPath) ?? `/${publicPath}`;
  }
  return bundledTemplateInputPreviewUrl(normalized);
}

export function isLikelyImageValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return (
      value.startsWith('data:image/') ||
      value.startsWith('/cache/') ||
      value.includes('/cache/') ||
      IMAGE_EXTENSIONS.test(value)
    );
  }

  if (Array.isArray(value)) {
    return value.some(isLikelyImageValue);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(isLikelyImageValue);
  }

  return false;
}

export function isLikelyVideoValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return (
      value.startsWith('data:video/') ||
      value.includes('/cache/') ||
      value.includes('/file?') ||
      VIDEO_EXTENSIONS.test(value)
    );
  }

  if (Array.isArray(value)) {
    return value.some(isLikelyVideoValue);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(isLikelyVideoValue);
  }

  return false;
}

export function isLikelyAudioValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return (
      value.startsWith('data:audio/') ||
      value.includes('/cache/') ||
      value.includes('/file?') ||
      AUDIO_EXTENSIONS.test(value)
    );
  }

  if (Array.isArray(value)) {
    return value.some(isLikelyAudioValue);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(isLikelyAudioValue);
  }

  return false;
}

export function firstVideoValue(value: unknown): string | null {
  if (typeof value === 'string' && isLikelyVideoValue(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const video = firstVideoValue(item);
      if (video) return video;
    }
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const video = firstVideoValue(item);
      if (video) return video;
    }
  }

  return null;
}

export function firstImageValue(value: unknown): string | null {
  if (typeof value === 'string' && isLikelyImageValue(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const image = firstImageValue(item);
      if (image) return image;
    }
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const image = firstImageValue(item);
      if (image) return image;
    }
  }

  return null;
}

export function firstAudioValue(value: unknown): string | null {
  if (typeof value === 'string' && isLikelyAudioValue(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const audio = firstAudioValue(item);
      if (audio) return audio;
    }
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const audio = firstAudioValue(item);
      if (audio) return audio;
    }
  }

  return null;
}

export function resolveStudioImageUrl(value: string, nodeId?: string, fieldKey?: string) {
  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  ) {
    return value;
  }

  const bundledAssetUrl = bundledPublicAssetUrl(value);
  if (bundledAssetUrl) return bundledAssetUrl;

  if (value.startsWith('/')) {
    return `${config.serverAddress}${value}`;
  }

  if (IMAGE_EXTENSIONS.test(value)) {
    return `${config.serverAddress}/preview?file=${encodeURIComponent(value)}`;
  }

  if (nodeId && fieldKey) {
    return `${config.serverAddress}/cache/${nodeId}/${fieldKey}`;
  }

  return value;
}

export function resolveStudioVideoUrl(value: string, nodeId?: string, fieldKey?: string) {
  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  ) {
    return value;
  }

  const bundledAssetUrl = bundledPublicAssetUrl(value);
  if (bundledAssetUrl) return bundledAssetUrl;

  if (value.startsWith('/')) {
    return `${config.serverAddress}${value}`;
  }

  if (VIDEO_EXTENSIONS.test(value)) {
    return `${config.serverAddress}/file?file=${encodeURIComponent(value)}`;
  }

  if (nodeId && fieldKey) {
    return `${config.serverAddress}/cache/${nodeId}/${fieldKey}`;
  }

  return value;
}

export function resolveStudioAudioUrl(value: string, nodeId?: string, fieldKey?: string) {
  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  ) {
    return value;
  }

  const bundledAssetUrl = bundledPublicAssetUrl(value);
  if (bundledAssetUrl) return bundledAssetUrl;

  if (value.startsWith('/')) {
    return `${config.serverAddress}${value}`;
  }

  if (AUDIO_EXTENSIONS.test(value)) {
    return `${config.serverAddress}/file?file=${encodeURIComponent(value)}`;
  }

  if (nodeId && fieldKey) {
    return `${config.serverAddress}/cache/${nodeId}/${fieldKey}`;
  }

  return value;
}

/** Measured media is display evidence; it must never rewrite rerun settings. */
export function encodedVideoMetadata(output: StudioOutput) {
  const item =
    output.mediaItems?.find((candidate) => candidate.url === output.url) ??
    output.mediaItems?.find((candidate) => candidate.displayType === 'video');
  return item?.mediaMetadata;
}

export function videoOutputSummary(output: StudioOutput) {
  const metadata = encodedVideoMetadata(output);
  if (metadata) {
    const details = [
      metadata.width && metadata.height ? `${metadata.width}x${metadata.height}` : undefined,
      metadata.frame_count ? `${metadata.frame_count} frames` : undefined,
      metadata.fps ? `${metadata.fps}fps` : undefined,
    ].filter(Boolean);
    if (details.length > 0) return details.join(' | ');
    if (metadata.duration_seconds) return `${metadata.duration_seconds} sec`;
  }
  const size = outputMediaSizeLabel(output);
  const frames = outputNumericInputValue(output, 'numFrames');
  const fps = outputNumericInputValue(output, 'fps');
  const details = [
    size,
    frames === undefined ? undefined : `${frames} frames`,
    fps === undefined ? undefined : `${fps}fps`,
  ]
    .filter(Boolean)
    .join(' | ');
  return details
    ? `${output.resolvedExecutionInputs ? 'Resolved' : 'Requested'} ${details}`
    : 'Video metadata not captured';
}
