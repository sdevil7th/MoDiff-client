import { CircleAlert, CircleCheck, Clock, FileDown } from 'lucide-react';

import type { HfDownloadProgress } from '../stores/useNodeStore';
import {
  formatDownloadBytes,
  formatDownloadDuration,
  formatDownloadEta,
  formatDownloadProgress,
  getDisplayCompletedFileCount,
  getDownloadPercent,
  hasHfDownloadFailed,
  isHfDownloadActive,
  isHfDownloadComplete,
  compactHfDownloadFailureLabel,
} from '../studio/modelInstall';
import { ProgressBar } from '../ui/ProgressBar';
import { cx } from '../utils/classNames';

type ModelDownloadProgressCardProps = {
  progress: HfDownloadProgress;
  repoId?: string;
  compact?: boolean;
  testId?: string;
  className?: string;
  showActions?: boolean;
  showTechnicalDetails?: boolean;
};

function statusLabel(progress: HfDownloadProgress) {
  if (hasHfDownloadFailed(progress)) return compactHfDownloadFailureLabel(progress);
  if (isHfDownloadComplete(progress)) return 'Complete';
  const phase = progress.phase ?? progress.status;
  if (phase === 'waiting_for_model_io') return 'Waiting for active generation';
  if (phase === 'retrying') return 'Retrying download';
  if (phase === 'repairing_from_verified_source') return 'Repairing from verified source';
  if (phase === 'verifying') return 'Verifying local snapshot';
  if (isHfDownloadActive(progress)) return 'Downloading';
  return progress.status || 'Download';
}

export function ModelDownloadProgressCard({
  progress,
  repoId,
  compact = false,
  testId,
  className,
  showTechnicalDetails = true,
}: ModelDownloadProgressCardProps) {
  const failed = hasHfDownloadFailed(progress);
  const active = isHfDownloadActive(progress);
  const complete = isHfDownloadComplete(progress);
  const percent = getDownloadPercent(progress);
  const knownPercent = percent !== null && percent > 0;
  const total = progress.total_bytes ? formatDownloadBytes(progress.total_bytes) : 'total unknown';
  const downloaded = formatDownloadBytes(progress.downloaded_bytes);
  const fileCount = progress.total_file_count
    ? `${getDisplayCompletedFileCount(progress)}/${progress.total_file_count} files`
    : `${progress.file_count ?? 0} files seen`;
  const eta = formatDownloadEta(progress.eta_seconds ?? undefined);
  const speed = progress.bytes_per_second ? `${formatDownloadBytes(progress.bytes_per_second)}/s` : '';
  const duration = formatDownloadDuration(progress.started_at, progress.completed_at ?? undefined);
  const title = repoId ?? progress.repo_id ?? 'Hugging Face download';
  const detailTitle = progress.error ? `${title} | ${progress.error}` : title;

  const Icon = failed ? CircleAlert : complete ? CircleCheck : active ? FileDown : Clock;

  return (
    <div
      data-testid={testId}
      title={detailTitle}
      className={cx(
        'border bg-modiff-bg p-2 text-xs text-modiff-text',
        failed && 'border-modiff-red/70',
        complete && 'border-modiff-green/60',
        active && !failed && !complete && 'border-hf-yellow/70',
        !active && !failed && !complete && 'border-modiff-border',
        className,
      )}
    >
      <div className="mb-2 flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon
              size={15}
              className={cx(
                'shrink-0',
                failed && 'text-modiff-red',
                complete && 'text-modiff-green',
                active && !failed && !complete && 'text-hf-yellow',
                !active && !failed && !complete && 'text-modiff-subtle-text',
              )}
            />
            <strong className="break-all text-sm">{title}</strong>
          </div>
          <p
            className={cx(
              'mt-0.5 break-words leading-5',
              failed ? 'text-modiff-red' : complete ? 'text-modiff-green' : 'text-modiff-subtle-text',
            )}
          >
            {statusLabel(progress)}
            {percent !== null ? ` | ${percent}%` : ''}
          </p>
        </div>
        {progress.task_id && !compact ? (
          <span className="shrink-0 border border-modiff-border bg-modiff-surface px-1.5 py-0.5 font-mono text-xs text-modiff-subtle-text">
            {progress.task_id}
          </span>
        ) : null}
      </div>
      {!failed ? (
        <ProgressBar value={complete ? 100 : knownPercent ? percent : null} tone={complete ? 'success' : 'default'} />
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-modiff-subtle-text">
        <span>
          {downloaded} of {total}
        </span>
        <span>{fileCount}</span>
        {eta ? <span>ETA {eta}</span> : null}
        {speed && active ? <span>{speed}</span> : null}
        {duration && !active ? <span>{complete ? `Completed in ${duration}` : duration}</span> : null}
      </div>
      {progress.current_file ? (
        <p className="mt-1 break-all text-modiff-subtle-text">Current file: {progress.current_file}</p>
      ) : null}
      {!compact && showTechnicalDetails && progress.cache_dir ? (
        <p className="mt-1 break-all text-modiff-subtle-text">Cache: {progress.cache_dir}</p>
      ) : null}
      {progress.error ? (
        <p className="mt-1 truncate text-modiff-red" title={progress.error}>
          {compactHfDownloadFailureLabel(progress)}
        </p>
      ) : null}
      {!compact && showTechnicalDetails && !progress.error ? (
        <p className="mt-1 break-words text-modiff-subtle-text">{formatDownloadProgress(progress)}</p>
      ) : null}
    </div>
  );
}
