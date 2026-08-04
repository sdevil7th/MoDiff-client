import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, DownloadCloud, LoaderCircle, Trash2, X, XCircle } from 'lucide-react';
import { useNodesStore } from '../stores/useNodeStore';
import { useTaskStore, type SessionRun } from '../stores/useTaskStore';
import { hasHfDownloadFailed, isHfDownloadActive, isHfDownloadComplete } from '../studio/modelInstall';
import { ProgressBar } from '../ui/ProgressBar';
import { ModiffButton, ModiffTooltip } from '../ui';
import { cx } from '../utils/classNames';
import { ModelDownloadProgressCard } from './ModelDownloadProgressCard';
import {
  openRunActivity,
  runActivityLabelForTask,
  runActivityTargetForTask,
  sortSessionRunsNewestFirst,
} from '../studio/runActivity';
import { useSettingsStore } from '../stores/useSettingsStore';
import { executionProgressDetail, executionProgressFrom } from '../studio/executionProgress';

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
  if (run.status === 'cancelled') return <XCircle size={15} className="text-modiff-subtle-text" />;
  return <Clock3 size={15} className="text-modiff-subtle-text" />;
}

function RunCard({ now, onDismiss, run }: { now: number; onDismiss: () => void; run: SessionRun }) {
  const activityPending = useSettingsStore((state) => state.runActivityPendingTaskId === (run.task_id || run.id));
  const active = run.status === 'running' || run.status === 'queued';
  const terminal = run.status && TERMINAL_STATUSES.has(run.status);
  const duration = runDuration(run, now);
  const label = runActivityLabelForTask(run, run.task_id || run.id);
  const progressDetail =
    executionProgressDetail(executionProgressFrom(run)) ||
    `${label} · ${statusLabel(run)} · ${formatDuration(duration)}`;

  return (
    <div className="group/notification relative min-w-0">
      <ModiffTooltip<HTMLButtonElement> content={progressDetail} placement="top">
        {(tooltipProps) => (
          <ModiffButton
            {...tooltipProps}
            align="left"
            fullWidth
            tone="secondary"
            loading={activityPending}
            data-testid={`session-run-${run.id}`}
            aria-label={`Open ${label} details, ${statusLabel(run)}, task ${run.task_id || run.id}`}
            onClick={() => {
              void openRunActivity(runActivityTargetForTask(run, run.id));
            }}
            className={cx(
              'h-auto! min-w-0 rounded-none bg-modiff-panel p-2 pr-8 shadow-modiff-panel',
              active && 'border-hf-yellow/70',
            )}
          >
            <span className="block min-w-0 flex-1">
              <span className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 flex-none">
                  <StatusIcon run={run} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold text-modiff-text">{label}</span>
                  <span
                    className={cx(
                      'mt-0.5 block truncate text-modiff-label text-modiff-subtle-text',
                      run.status === 'failed' && 'text-modiff-red',
                    )}
                  >
                    {statusLabel(run)}
                  </span>
                </span>
                <span className="flex-none text-modiff-label font-semibold text-modiff-subtle-text">
                  {formatDuration(duration)}
                </span>
              </span>
              {active ? (
                <ProgressBar value={run.status === 'running' ? (run.progress ?? null) : null} className="mt-2 h-1" />
              ) : terminal ? (
                <span
                  className={cx(
                    'mt-2 block h-1',
                    run.status === 'completed'
                      ? 'bg-modiff-green'
                      : run.status === 'failed'
                        ? 'bg-modiff-red'
                        : 'bg-modiff-disabled/40',
                  )}
                />
              ) : null}
            </span>
          </ModiffButton>
        )}
      </ModiffTooltip>
      <ModiffButton
        aria-label={`Dismiss ${label} notification`}
        data-testid={`dismiss-session-run-${run.id}`}
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        size="compact"
        tone="ghost"
        className="absolute right-1 top-1 h-7! w-7! rounded-none p-0 opacity-0 transition-opacity group-hover/notification:opacity-100 focus-visible:opacity-100"
        title="Dismiss notification"
      >
        <X size={13} />
      </ModiffButton>
    </div>
  );
}

const DISMISSED_ACTIVITY_STORAGE_KEY = 'modiff-dismissed-session-activity';

function restoredDismissedActivity() {
  try {
    const value = window.sessionStorage.getItem(DISMISSED_ACTIVITY_STORAGE_KEY);
    const parsed = value ? (JSON.parse(value) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

export default function RunSessionShelf() {
  const sessionRuns = useTaskStore((state) => state.sessionRuns);
  const hfDownloadProgress = useNodesStore((state) => state.hfDownloadProgress);
  const hasActiveRun = sessionRuns.some((run) => run.status === 'running' || run.status === 'queued');
  const hasActiveDownload = Object.values(hfDownloadProgress).some(isHfDownloadActive);
  const hasActiveActivity = hasActiveRun || hasActiveDownload;
  const [highlightDownloads, setHighlightDownloads] = useState(false);
  const [dismissedActivity, setDismissedActivity] = useState(restoredDismissedActivity);
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

  useEffect(() => {
    window.sessionStorage.setItem(DISMISSED_ACTIVITY_STORAGE_KEY, JSON.stringify([...dismissedActivity]));
  }, [dismissedActivity]);

  const dismissActivity = (key: string) => {
    setDismissedActivity((current) => new Set(current).add(key));
  };

  const visibleRuns = useMemo(
    () => sortSessionRunsNewestFirst(sessionRuns).filter((run) => !dismissedActivity.has(`run:${run.id}`)),
    [dismissedActivity, sessionRuns],
  );
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
        .filter((progress) => !dismissedActivity.has(`download:${progress.repo_id}`)),
    [dismissedActivity, hfDownloadProgress],
  );
  const finishedCount = visibleRuns.filter((run) => run.status && TERMINAL_STATUSES.has(run.status)).length;
  const finishedDownloadCount = visibleDownloads.filter(isHfDownloadComplete).length;
  const failedDownloadCount = visibleDownloads.filter(hasHfDownloadFailed).length;
  const clearableCount = finishedCount + finishedDownloadCount + failedDownloadCount;
  const clearFinishedNotifications = () => {
    setDismissedActivity((current) => {
      const next = new Set(current);
      visibleRuns.forEach((run) => {
        if (run.status && TERMINAL_STATUSES.has(run.status)) next.add(`run:${run.id}`);
      });
      visibleDownloads.forEach((progress) => {
        if (isHfDownloadComplete(progress) || hasHfDownloadFailed(progress)) {
          next.add(`download:${progress.repo_id}`);
        }
      });
      return next;
    });
  };
  if (visibleRuns.length === 0 && visibleDownloads.length === 0) return null;

  return (
    <section
      aria-label="Session activity"
      data-testid="run-session-shelf"
      className="pointer-events-none absolute bottom-4 left-4 z-30 w-[min(360px,calc(100%-32px))] text-modiff-text"
    >
      <div className="pointer-events-auto border border-modiff-border bg-modiff-bg p-2 shadow-modiff-panel">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock3 size={15} className="text-hf-yellow" />
            <div>
              <div className="text-xs font-bold text-modiff-text">Session activity</div>
              <div className="text-modiff-label text-modiff-subtle-text">
                {hasActiveActivity ? 'Active now' : `${finishedCount + finishedDownloadCount} finished`}
              </div>
            </div>
          </div>
          <ModiffButton
            tone="ghost"
            size="compact"
            onClick={clearFinishedNotifications}
            disabled={clearableCount === 0}
            title="Clear finished notifications"
            icon={<Trash2 size={13} />}
            className="px-2 text-modiff-label"
          >
            <span>Clear</span>
          </ModiffButton>
        </div>
        <div
          className="modiff-scrollbar-thin max-h-[min(45vh,352px)] overflow-y-auto overscroll-contain pr-1"
          data-testid="run-session-scrollport"
        >
          {visibleDownloads.length > 0 ? (
            <div
              className={cx(
                'mb-2 grid gap-1.5 border border-transparent p-1 transition-colors',
                highlightDownloads && 'border-hf-yellow/70 bg-hf-yellow/10',
              )}
              data-testid="download-session-list"
            >
              <div className="flex items-center gap-1.5 px-1 text-modiff-label font-bold uppercase tracking-normal text-modiff-subtle-text">
                <DownloadCloud size={13} />
                Downloads
              </div>
              {visibleDownloads.map((progress) => (
                <div key={progress.repo_id} className="group/notification relative">
                  <ModelDownloadProgressCard
                    repoId={progress.repo_id}
                    progress={progress}
                    compact
                    showTechnicalDetails={false}
                    testId={`session-download-${progress.repo_id}`}
                    className="pr-8"
                  />
                  <ModiffButton
                    aria-label={`Dismiss ${progress.repo_id} download notification`}
                    data-testid={`dismiss-session-download-${progress.repo_id}`}
                    onClick={() => dismissActivity(`download:${progress.repo_id}`)}
                    size="compact"
                    tone="ghost"
                    className="absolute right-1 top-1 h-7! w-7! rounded-none p-0 opacity-0 transition-opacity group-hover/notification:opacity-100 focus-visible:opacity-100"
                    title="Dismiss notification"
                  >
                    <X size={13} />
                  </ModiffButton>
                </div>
              ))}
            </div>
          ) : null}
          {visibleRuns.length > 0 ? (
            <div className="grid gap-1.5">
              {visibleRuns.map((run) => (
                <RunCard key={run.id} run={run} now={now} onDismiss={() => dismissActivity(`run:${run.id}`)} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
