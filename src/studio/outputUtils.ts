import config from '../../app.config';

const IMAGE_EXTENSIONS = /\.(jpe?g|png|apng|webp|gif|bmp|ico|tiff|svg)(\?.*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|mkv|m4v)(\?.*)?$/i;
const AUDIO_EXTENSIONS = /\.(wav|mp3|flac|ogg|m4a|aac)(\?.*)?$/i;

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
