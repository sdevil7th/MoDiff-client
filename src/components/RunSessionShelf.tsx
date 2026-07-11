import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, DownloadCloud, LoaderCircle, Trash2, XCircle } from 'lucide-react';
import { useNodesStore } from '../stores/useNodeStore';
import { useTaskStore, type SessionRun } from '../stores/useTaskStore';
import { hasHfDownloadFailed, isHfDownloadActive, isHfDownloadComplete } from '../studio/modelInstall';
import { ProgressBar } from '../ui/ProgressBar';
import { cx } from '../utils/classNames';
import { ModelDownloadProgressCard } from './ModelDownloadProgressCard';

const TERMINAL_STATUSES = new Set<SessionRun['status']>(['completed', 'failed', 'cancelled']);

function formatDuration(ms: number | undefined) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function runDuration(run: SessionRun, now: number) {
  if (typeof run.durationMs === 'number') return run.durationMs;
  if (run.status === 'running' && run.startedAtMs) return now - run.startedAtMs;
  return undefined;
}

function statusLabel(run: SessionRun) {
  if (run.status === 'running') return run.message || 'Running';
  if (run.status === 'completed') return 'Completed';
  if (run.status === 'failed') return run.error || run.message || 'Failed';
  if (run.status === 'cancelled') return 'Cancelled';
  return 'Queued';
}

function StatusIcon({ run }: { run: SessionRun }) {
  if (run.status === 'running') return <LoaderCircle size={15} className="animate-spin text-hf-yellow" />;
  if (run.status === 'completed') return <CheckCircle2 size={15} className="text-modiff-green" />;
  if (run.status === 'failed') return <AlertCircle size={15} className="text-modiff-red" />;
  if (run.status === 'cancelled') return <XCircle size={15} className="text-modiff-muted" />;
  return <Clock3 size={15} className="text-modiff-muted" />;
}

function RunCard({ now, run }: { now: number; run: SessionRun }) {
  const active = run.status === 'running' || run.status === 'queued';
  const terminal = run.status && TERMINAL_STATUSES.has(run.status);
  const duration = runDuration(run, now);

  return (
    <div
      data-testid={`session-run-${run.id}`}
      className={cx(
        'min-w-0 border border-modiff-border bg-modiff-panel/95 p-2 shadow-modiff-panel backdrop-blur',
        active && 'border-hf-yellow/70',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="mt-0.5 flex-none">
          <StatusIcon run={run} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-white">{run.name || run.task_id || 'Graph execution'}</div>
          <div
            className={cx(
              'mt-0.5 truncate text-[11px] text-modiff-muted',
              run.status === 'failed' && 'text-modiff-red',
            )}
          >
            {statusLabel(run)}
          </div>
        </div>
        <div className="flex-none text-[11px] font-semibold text-modiff-muted">{formatDuration(duration)}</div>
      </div>
      {active ? (
        <ProgressBar value={run.status === 'running' ? (run.progress ?? null) : null} className="mt-2 h-1" />
      ) : terminal ? (
        <div
          className={cx(
            'mt-2 h-1',
            run.status === 'completed' ? 'bg-modiff-green' : run.status === 'failed' ? 'bg-modiff-red' : 'bg-white/20',
          )}
        />
      ) : null}
    </div>
  );
}

export default function RunSessionShelf() {
  const sessionRuns = useTaskStore((state) => state.sessionRuns);
  const clearCompletedSessionRuns = useTaskStore((state) => state.clearCompletedSessionRuns);
  const hfDownloadProgress = useNodesStore((state) => state.hfDownloadProgress);
  const hasActiveRun = sessionRuns.some((run) => run.status === 'running' || run.status === 'queued');
  const hasActiveDownload = Object.values(hfDownloadProgress).some(isHfDownloadActive);
  const hasActiveActivity = hasActiveRun || hasActiveDownload;
  const [highlightDownloads, setHighlightDownloads] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasActiveActivity) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveActivity]);

  useEffect(() => {
    const handleShowDownloads = () => {
      setHighlightDownloads(true);
      window.setTimeout(() => setHighlightDownloads(false), 1800);
    };
    window.addEventListener('modiff:show-downloads', handleShowDownloads);
    return () => window.removeEventListener('modiff:show-downloads', handleShowDownloads);
  }, []);

  const visibleRuns = useMemo(() => sessionRuns.slice(0, 4), [sessionRuns]);
  const visibleDownloads = useMemo(
    () =>
      Object.values(hfDownloadProgress)
        .filter(
          (progress) => isHfDownloadActive(progress) || hasHfDownloadFailed(progress) || isHfDownloadComplete(progress),
        )
        .sort(
          (left, right) =>
            (right.updated_at ?? right.completed_at ?? right.started_at ?? 0) -
            (left.updated_at ?? left.completed_at ?? left.started_at ?? 0),
        )
        .slice(0, 4),
    [hfDownloadProgress],
  );
  const finishedCount = sessionRuns.filter((run) => run.status && TERMINAL_STATUSES.has(run.status)).length;
  const finishedDownloadCount = visibleDownloads.filter(isHfDownloadComplete).length;
  if (visibleRuns.length === 0 && visibleDownloads.length === 0) return null;

  return (
    <section
      aria-label="Session activity"
      data-testid="run-session-shelf"
      className="pointer-events-none absolute bottom-4 left-4 z-30 w-[min(360px,calc(100%-32px))] text-modiff-text"
    >
      <div className="pointer-events-auto border border-modiff-border bg-modiff-bg/90 p-2 shadow-modiff-panel backdrop-blur">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock3 size={15} className="text-hf-yellow" />
            <div>
              <div className="text-xs font-bold text-white">Session activity</div>
              <div className="text-[11px] text-modiff-muted">
                {hasActiveActivity ? 'Active now' : `${finishedCount + finishedDownloadCount} finished`}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={clearCompletedSessionRuns}
            disabled={finishedCount === 0}
            className="inline-flex h-7 items-center gap-1.5 px-2 text-[11px] font-semibold text-modiff-muted transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
            title="Clear finished session runs"
          >
            <Trash2 size={13} />
            <span>Clear</span>
          </button>
        </div>
        {visibleDownloads.length > 0 ? (
          <div
            className={cx(
              'mb-2 grid gap-1.5 border border-transparent p-1 transition-colors',
              highlightDownloads && 'border-hf-yellow/70 bg-hf-yellow/10',
            )}
            data-testid="download-session-list"
          >
            <div className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-normal text-modiff-muted">
              <DownloadCloud size={13} />
              Downloads
            </div>
            {visibleDownloads.map((progress) => (
              <ModelDownloadProgressCard
                key={progress.repo_id}
                repoId={progress.repo_id}
                progress={progress}
                compact
                showTechnicalDetails={false}
                testId={`session-download-${progress.repo_id}`}
              />
            ))}
          </div>
        ) : null}
        {visibleRuns.length > 0 ? (
          <div className="grid gap-1.5">
            {visibleRuns.map((run) => (
              <RunCard key={run.id} run={run} now={now} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
