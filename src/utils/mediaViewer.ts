import type { LightboxOpener, MediaViewerItem } from '../stores/useSettingsStore';

/** Resolved output URLs must not use the raw-base64 node image representation. */
export function imageUrlLightboxOpener(images: string[], currentIndex = 0): NonNullable<LightboxOpener> {
  return { images, currentIndex, dataType: 'url', mimeType: null };
}

export const MEDIA_PLACEHOLDER_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'%3E%3Cpath fill='%2320252d' d='M0 0h2v2H0z'/%3E%3Cpath fill='%23343b47' d='M0 0h1v1H0zm1 1h1v1H1z'/%3E%3C/svg%3E";

const MEDIA_VIEWER_KINDS = new Set<MediaViewerItem['kind']>(['image', 'video', 'audio', 'text']);
const NAVIGATION_CONTROL_SELECTOR = [
  'audio',
  'video',
  'input',
  'textarea',
  'select',
  'option',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="textbox"]',
].join(',');

function dataUrlMatchesKind(value: string, kind: MediaViewerItem['kind']) {
  const mimeType = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(value)?.[1]?.trim().toLowerCase();
  if (!mimeType) return false;
  if (kind === 'image') return mimeType.startsWith('image/') && mimeType !== 'image/svg+xml';
  if (kind === 'video') return mimeType.startsWith('video/');
  if (kind === 'audio') return mimeType.startsWith('audio/');
  return mimeType === 'text/plain' || mimeType === 'application/json';
}

export function sanitizeMediaViewerUrl(value: unknown, kind: MediaViewerItem['kind'], baseUrl: string): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate) return null;
  if (/^data:/i.test(candidate)) return dataUrlMatchesKind(candidate, kind) ? candidate : null;

  try {
    const url = new URL(candidate, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sanitizeMediaViewerItems(items: MediaViewerItem[], baseUrl: string): MediaViewerItem[] {
  const sanitized: MediaViewerItem[] = [];
  items.forEach((item) => {
    if (!MEDIA_VIEWER_KINDS.has(item.kind)) return;
    if (item.kind === 'text') {
      if (typeof item.text === 'string') sanitized.push({ ...item, url: undefined });
      return;
    }
    const url = sanitizeMediaViewerUrl(item.url, item.kind, baseUrl);
    if (url) sanitized.push({ ...item, url });
  });
  return sanitized;
}

export function clampMediaViewerIndex(index: number, itemCount: number) {
  if (itemCount <= 0) return 0;
  const finiteIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(finiteIndex, 0), itemCount - 1);
}

export function compactResolvedMediaUrls(value: unknown, resolve: (candidate: string) => string | null): string[] {
  const candidates = Array.isArray(value) ? value : [value];
  return candidates
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    .map((candidate) => resolve(candidate))
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
}

export function shouldIgnoreMediaViewerArrowTarget(target: EventTarget | null) {
  const candidate = target as unknown as { closest?: (selector: string) => unknown } | null;
  if (typeof candidate?.closest !== 'function') return false;
  return Boolean(candidate.closest(NAVIGATION_CONTROL_SELECTOR));
}
