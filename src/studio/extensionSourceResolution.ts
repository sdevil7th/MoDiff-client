import config from '../../app.config';
import { requestJson } from '../utils/requestJson';
import type { ResolvedExtensionSource } from './customExtensions';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseResolvedExtensionSource(value: unknown): ResolvedExtensionSource {
  const source = record(value) ? value.source : null;
  if (
    !record(source) ||
    source.kind !== 'hub' ||
    typeof source.source !== 'string' ||
    source.source.length > 256 ||
    source.source.includes('..') ||
    !/^[\p{L}\p{N}_][\p{L}\p{N}_.-]*(?:\/[\p{L}\p{N}_][\p{L}\p{N}_.-]*)?$/u.test(source.source) ||
    typeof source.requestedRevision !== 'string' ||
    !source.requestedRevision ||
    source.requestedRevision.length > 256 ||
    typeof source.revision !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(source.revision)
  )
    throw new Error('The backend did not return an exact Hugging Face source revision.');
  return source as ResolvedExtensionSource;
}

export function resolveExtensionSource(source: string, revision: string, signal?: AbortSignal) {
  return requestJson(`${config.serverAddress}/custom_modules/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, ...(revision.trim() ? { revision: revision.trim() } : {}) }),
    signal,
    timeoutMs: 30_000,
    parse: parseResolvedExtensionSource,
  });
}
