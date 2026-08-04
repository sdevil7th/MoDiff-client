import { requestBlob } from './requestJson';

export const AUDIO_DOWNLOAD_SAMPLE_RATES = [44100, 48000, 88200, 96000] as const;

function basename(value: string) {
  const normalized = value.replace(/\\/g, '/');
  const name = normalized.split('/').filter(Boolean).pop();
  return name ? decodeURIComponent(name) : '';
}

export function mediaDownloadName(source: string, fallback: string) {
  try {
    const parsed = new URL(source, window.location.origin);
    const file = parsed.searchParams.get('file');
    const candidate = basename(file || parsed.pathname);
    return candidate.includes('.') ? candidate : fallback;
  } catch {
    const candidate = basename(source);
    return candidate.includes('.') ? candidate : fallback;
  }
}

export function requiresSeekableAudioBuffer(value: string) {
  try {
    return new URL(value, 'http://modiff.local').pathname.includes('/cache/');
  } catch {
    return false;
  }
}

export function normalizedAudioDownloadSampleRate(value: unknown): number | null {
  const sampleRate = Number(value);
  return AUDIO_DOWNLOAD_SAMPLE_RATES.includes(sampleRate as (typeof AUDIO_DOWNLOAD_SAMPLE_RATES)[number])
    ? sampleRate
    : null;
}

export function audioDownloadSource(source: string, sampleRate: unknown) {
  const normalizedSampleRate = normalizedAudioDownloadSampleRate(sampleRate);
  if (!normalizedSampleRate) return source;
  try {
    const parsed = new URL(source, window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return source;
    parsed.searchParams.set('download_sample_rate', String(normalizedSampleRate));
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString();
  } catch {
    return source;
  }
}

export function audioDownloadName(filename: string, sampleRate: unknown) {
  const normalizedSampleRate = normalizedAudioDownloadSampleRate(sampleRate);
  if (!normalizedSampleRate) return filename;
  const label =
    normalizedSampleRate === 44100
      ? '44.1kHz'
      : normalizedSampleRate === 88200
        ? '88.2kHz'
        : `${normalizedSampleRate / 1000}kHz`;
  const extensionIndex = filename.toLowerCase().lastIndexOf('.wav');
  const stem = extensionIndex >= 0 ? filename.slice(0, extensionIndex) : filename;
  return `${stem}-${label}.wav`;
}

export async function downloadMedia(source: string, filename: string, audioSampleRate?: unknown) {
  const downloadSource = audioDownloadSource(source, audioSampleRate);
  const blob = await requestBlob(downloadSource, { timeoutMs: 60_000 });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = audioSampleRate === undefined ? filename : audioDownloadName(filename, audioSampleRate);
    anchor.rel = 'noopener noreferrer';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
