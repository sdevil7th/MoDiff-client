import config from '../../app.config';
import { requestBlob, requestJson } from '../utils/requestJson';
import type { MediaKind } from './mediaImport';

export type { MediaKind } from './mediaImport';

export type MediaFormatDescriptor = {
  value: string;
  label: string;
  extension: string;
  mimeType: string;
  preset?: string;
  sampleRates?: number[];
  supportsAlpha?: boolean;
  hasAudio?: boolean;
};

export type MediaCapabilities = {
  version: number;
  media: Record<
    MediaKind,
    {
      importExtensions: string[];
      exportFormats: MediaFormatDescriptor[];
    }
  >;
};

export type MediaExportSettings = {
  format: string;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  bitrate?: number;
  quality?: number;
  compression?: number;
  fps?: number;
  width?: number;
};

let capabilitiesRequest: Promise<MediaCapabilities> | null = null;

function mediaRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mediaString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`MoDiff returned an invalid media capability ${key}.`);
  }
  return value;
}

function parseExtension(value: unknown) {
  if (typeof value !== 'string' || !/^\.[A-Za-z0-9]{1,10}$/.test(value)) {
    throw new Error('MoDiff returned an invalid media file extension.');
  }
  return value.toLowerCase();
}

function parseMediaFormat(value: unknown): MediaFormatDescriptor {
  const record = mediaRecord(value);
  if (!record) throw new Error('MoDiff returned an invalid media export format.');
  const mimeType = mediaString(record, 'mimeType');
  if (!/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(mimeType)) {
    throw new Error('MoDiff returned an invalid media MIME type.');
  }
  const preset = record.preset;
  if (preset !== undefined && (typeof preset !== 'string' || !preset.trim())) {
    throw new Error('MoDiff returned an invalid media export preset.');
  }
  const sampleRates = record.sampleRates;
  if (
    sampleRates !== undefined &&
    (!Array.isArray(sampleRates) ||
      sampleRates.some((rate) => typeof rate !== 'number' || !Number.isInteger(rate) || rate <= 0))
  ) {
    throw new Error('MoDiff returned invalid media sample rates.');
  }
  for (const key of ['supportsAlpha', 'hasAudio'] as const) {
    if (record[key] !== undefined && typeof record[key] !== 'boolean') {
      throw new Error(`MoDiff returned an invalid media capability ${key}.`);
    }
  }
  return {
    value: mediaString(record, 'value'),
    label: mediaString(record, 'label'),
    extension: parseExtension(record.extension),
    mimeType,
    preset: preset as string | undefined,
    sampleRates: sampleRates as number[] | undefined,
    supportsAlpha: record.supportsAlpha as boolean | undefined,
    hasAudio: record.hasAudio as boolean | undefined,
  };
}

export function parseMediaCapabilities(value: unknown): MediaCapabilities {
  const record = mediaRecord(value);
  const media = record ? mediaRecord(record.media) : null;
  if (!record || record.version !== 1 || !media) {
    throw new Error('MoDiff returned an unsupported media capability contract.');
  }

  const parsedMedia = Object.fromEntries(
    (['image', 'video', 'audio'] as const).map((kind) => {
      const capability = mediaRecord(media[kind]);
      if (!capability || !Array.isArray(capability.importExtensions) || !Array.isArray(capability.exportFormats)) {
        throw new Error(`MoDiff returned invalid ${kind} media capabilities.`);
      }
      const importExtensions = capability.importExtensions.map(parseExtension);
      if (new Set(importExtensions).size !== importExtensions.length) {
        throw new Error(`MoDiff returned duplicate ${kind} import extensions.`);
      }
      const exportFormats = capability.exportFormats.map(parseMediaFormat);
      if (new Set(exportFormats.map((format) => format.value)).size !== exportFormats.length) {
        throw new Error(`MoDiff returned duplicate ${kind} export formats.`);
      }
      return [kind, { importExtensions, exportFormats }];
    }),
  ) as MediaCapabilities['media'];

  return { version: 1, media: parsedMedia };
}

export function loadMediaCapabilities() {
  if (!capabilitiesRequest) {
    capabilitiesRequest = requestJson(`${config.serverAddress}/media/capabilities`, {
      parse: parseMediaCapabilities,
      timeoutMs: 10_000,
    }).catch((error) => {
      capabilitiesRequest = null;
      throw error;
    });
  }
  return capabilitiesRequest;
}

export function resetMediaCapabilitiesCache() {
  capabilitiesRequest = null;
}

function backendUrl(source: string) {
  try {
    return new URL(source, config.serverAddress);
  } catch {
    return null;
  }
}

export function canTranscodeMediaSource(source: string) {
  const parsed = backendUrl(source);
  if (!parsed) return false;
  const backend = new URL(config.serverAddress);
  return (
    parsed.origin === backend.origin &&
    (parsed.pathname === '/file' || parsed.pathname === '/stream' || parsed.pathname.startsWith('/cache/'))
  );
}

function appendSettings(url: URL, kind: MediaKind, settings: MediaExportSettings) {
  url.searchParams.set('download_format', settings.format);
  url.searchParams.set('media_kind', kind);
  const values: Array<[string, number | undefined]> = [
    ['sample_rate', settings.sampleRate],
    ['channels', settings.channels],
    ['bit_depth', settings.bitDepth],
    ['bitrate', settings.bitrate],
    ['quality', settings.quality],
    ['compression', settings.compression],
    ['fps', settings.fps],
    ['width', settings.width],
  ];
  values.forEach(([key, value]) => {
    if (value !== undefined && Number.isFinite(value)) url.searchParams.set(key, String(value));
  });
}

export function mediaExportSource(source: string, kind: MediaKind, settings: MediaExportSettings) {
  if (settings.format === 'original') return source;
  const parsed = backendUrl(source);
  if (!parsed) throw new Error('This output does not have a downloadable media URL.');
  const backend = new URL(config.serverAddress);
  if (parsed.origin !== backend.origin) {
    throw new Error('Converted downloads are available for MoDiff-managed media. Download this source as Original.');
  }
  if (parsed.pathname === '/stream') {
    const file = parsed.searchParams.get('file');
    if (!file) throw new Error('This video source does not identify its backing file.');
    parsed.pathname = '/file';
    parsed.search = '';
    parsed.searchParams.set('file', file);
  }
  if (parsed.pathname !== '/file' && !parsed.pathname.startsWith('/cache/')) {
    throw new Error('Converted downloads are not available for this source. Download it as Original.');
  }
  appendSettings(parsed, kind, settings);
  return parsed.toString();
}

function cleanStem(filename: string, kind: MediaKind) {
  const fallback = `MoDiff-${kind}`;
  const leaf = filename.replace(/\\/g, '/').split('/').filter(Boolean).pop() || fallback;
  const printableLeaf = Array.from(leaf, (character) => (character.charCodeAt(0) < 32 ? '-' : character)).join('');
  const stem = printableLeaf
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .trim();
  const resolved = stem || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(resolved) ? `_${resolved}` : resolved;
}

export function mediaExportFilename(
  filename: string,
  kind: MediaKind,
  descriptor: MediaFormatDescriptor | null,
  settings: MediaExportSettings,
) {
  if (settings.format === 'original' || !descriptor) {
    const fallback = `MoDiff-${kind}`;
    const leaf = filename.replace(/\\/g, '/').split('/').filter(Boolean).pop() || fallback;
    const portable = Array.from(leaf, (character) => (character.charCodeAt(0) < 32 ? '-' : character))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/[. ]+$/, '')
      .trim();
    const resolved = portable || fallback;
    const stem = resolved.replace(/\.[A-Za-z0-9]{1,10}$/, '');
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem) ? `_${resolved}` : resolved;
  }
  const rate =
    kind === 'audio' && settings.sampleRate
      ? `-${settings.sampleRate % 1000 === 0 ? settings.sampleRate / 1000 : settings.sampleRate / 1000}kHz`
      : '';
  return `${cleanStem(filename, kind)}${rate}${descriptor.extension}`;
}

type SaveFileHandle = {
  createWritable: () => Promise<{ write: (value: Blob) => Promise<void>; close: () => Promise<void> }>;
};

function chooseSaveFile(filename: string, descriptor: MediaFormatDescriptor | null) {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName?: string;
        types?: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<SaveFileHandle>;
    }
  ).showSaveFilePicker;
  if (!picker) return null;
  return picker.call(window, {
    suggestedName: filename,
    types:
      descriptor?.mimeType && descriptor.extension
        ? [
            {
              description: `${descriptor.label} file`,
              accept: { [descriptor.mimeType]: [descriptor.extension] },
            },
          ]
        : undefined,
  });
}

async function saveWithHandle(blob: Blob, handle: SaveFileHandle) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function exportMedia(
  source: string,
  filename: string,
  kind: MediaKind,
  descriptor: MediaFormatDescriptor | null,
  settings: MediaExportSettings,
) {
  const requestUrl = mediaExportSource(source, kind, settings);
  const outputName = mediaExportFilename(filename, kind, descriptor, settings);
  let handle: SaveFileHandle | null = null;
  try {
    // File pickers require transient user activation. Start the picker before
    // the potentially long transcode request, then write only after it finishes.
    const handleRequest = chooseSaveFile(outputName, descriptor);
    handle = handleRequest ? await handleRequest : null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    // Browsers can reject the native picker for policy/activation reasons.
    // The normal download anchor remains a safe fallback in that case.
    handle = null;
  }
  const blob = await requestBlob(requestUrl, { timeoutMs: 3_600_000 });
  if (handle) {
    await saveWithHandle(blob, handle);
    return true;
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = outputName;
    anchor.rel = 'noopener noreferrer';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  return true;
}

const LAST_SETTINGS_KEY = 'modiff.media-export.v1';

export function savedMediaExportSettings(kind: MediaKind): Partial<MediaExportSettings> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_SETTINGS_KEY) || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const value = (parsed as Record<string, unknown>)[kind];
    return value && typeof value === 'object' ? (value as Partial<MediaExportSettings>) : {};
  } catch {
    return {};
  }
}

export function saveMediaExportSettings(kind: MediaKind, settings: MediaExportSettings) {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_SETTINGS_KEY) || '{}') as unknown;
    const current = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify({ ...current, [kind]: settings }));
  } catch {
    // Downloads still work when storage is disabled.
  }
}
