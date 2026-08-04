import type { HfDownloadProgress } from '../stores/useNodeStore';

const ACTIVE_HF_DOWNLOAD_STATUSES = new Set([
  'queued',
  'joined',
  'planning',
  'starting',
  'downloading',
  'retrying',
  'repairing_from_verified_source',
  'verifying',
]);
const COMPLETE_HF_DOWNLOAD_STATUSES = new Set(['complete', 'completed']);

export type HfDownloadFailureKind = 'access' | 'network' | 'cache' | 'unknown';

export function isHfDownloadActive(progress?: HfDownloadProgress) {
  if (!progress) return false;
  if (progress.error || progress.status === 'error' || isHfDownloadComplete(progress)) return false;
  if (progress.status && ACTIVE_HF_DOWNLOAD_STATUSES.has(progress.status)) return true;
  return typeof progress.progress === 'number' && progress.progress >= 0 && progress.progress < 1;
}

export function hasHfDownloadFailed(progress?: HfDownloadProgress) {
  return Boolean(progress?.error || progress?.status === 'error');
}

export function classifyHfDownloadFailure(progress?: HfDownloadProgress): HfDownloadFailureKind {
  const text = `${progress?.error ?? ''} ${progress?.plan_error ?? ''} ${progress?.status ?? ''}`.toLowerCase();
  if (
    text.includes('403') ||
    text.includes('401') ||
    text.includes('gated') ||
    text.includes('private') ||
    text.includes('not authorized') ||
    text.includes('unauthorized') ||
    text.includes('forbidden') ||
    text.includes('access') ||
    text.includes('token')
  ) {
    return 'access';
  }
  if (
    text.includes('network') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('connection') ||
    text.includes('dns')
  ) {
    return 'network';
  }
  if (
    text.includes('incomplete') ||
    text.includes('corrupt') ||
    text.includes('checksum') ||
    text.includes('size mismatch') ||
    text.includes('missing shard') ||
    text.includes('snapshot')
  ) {
    return 'cache';
  }
  return 'unknown';
}

export function compactHfDownloadFailureLabel(progress?: HfDownloadProgress) {
  switch (classifyHfDownloadFailure(progress)) {
    case 'access':
      return 'Access required';
    case 'network':
      return 'Network failed';
    case 'cache':
      return 'Repair required';
    default:
      return 'Download failed';
  }
}

export function isHfDownloadComplete(progress?: HfDownloadProgress) {
  return Boolean(progress?.status && COMPLETE_HF_DOWNLOAD_STATUSES.has(progress.status));
}

export function formatDownloadBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDownloadEta(seconds?: number) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)} sec`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return `${hours} hr ${minutes} min`;
}

export function formatDownloadDuration(startedAt?: number, completedAt?: number, now = Date.now()) {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return '';
  const endMs = typeof completedAt === 'number' && Number.isFinite(completedAt) ? completedAt * 1000 : now;
  const elapsedSeconds = Math.max(0, (endMs - startedAt * 1000) / 1000);
  return formatDownloadEta(elapsedSeconds);
}

export function getDownloadPercent(progress?: HfDownloadProgress) {
  if (!progress || typeof progress.progress !== 'number' || !Number.isFinite(progress.progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress.progress * 100)));
}

export function getDisplayCompletedFileCount(progress?: HfDownloadProgress) {
  if (!progress) return 0;
  const raw = progress.completed_file_count ?? progress.file_count ?? 0;
  if (!progress.total_file_count) return raw;
  return Math.max(0, Math.min(raw, progress.total_file_count));
}

export function formatDownloadProgress(progress?: HfDownloadProgress) {
  if (!progress) return '';
  const downloaded = formatDownloadBytes(progress.downloaded_bytes);
  const total = progress.total_bytes ? formatDownloadBytes(progress.total_bytes) : 'total unknown';
  const files = progress.total_file_count
    ? `${getDisplayCompletedFileCount(progress)}/${progress.total_file_count} files`
    : `${progress.file_count ?? 0} files seen`;
  const percent = getDownloadPercent(progress);
  const percentText = percent !== null ? ` | ${percent}%` : '';
  const eta = formatDownloadEta(progress.eta_seconds ?? undefined);
  const speed = progress.bytes_per_second ? ` | ${formatDownloadBytes(progress.bytes_per_second)}/s` : '';
  const currentFile = progress.current_file ? ` | ${progress.current_file}` : '';
  const error = progress.error ? ` | ${progress.error}` : '';
  return `${progress.status ?? 'downloading'}${percentText} | ${downloaded} of ${total} | ${files}${eta ? ` | ETA ${eta}` : ''}${speed}${currentFile}${progress.cache_dir ? ` | ${progress.cache_dir}` : ''}${error}`;
}
