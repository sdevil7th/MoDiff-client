import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { enqueueSnackbar } from '../ui/snackbar';
import { CheckCircle2, Clock3, RefreshCw, Square, Trash2, XCircle } from 'lucide-react';
import { useTaskStore, type SessionRun } from '../stores/useTaskStore';
import { ProgressBar } from '../ui/ProgressBar';
import { StatusBox } from '../ui/StatusBox';
import { formatRequestError } from '../utils/requestJson';
import { cancelQueuedTask, requestExecutionStop } from '../utils/serverActions';

type QueueButtonProps = {
  children: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
  testId?: string;
};

function QueueButton({ children, disabled, icon, onClick, testId }: QueueButtonProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 items-center justify-center gap-1.5 bg-hf-yellow px-3 text-sm font-semibold text-black transition hover:bg-hf-orange disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

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

function formatSeconds(seconds: number | undefined) {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? formatDuration(seconds * 1000) : null;
}

function sessionRunDuration(run: SessionRun) {
  if (typeof run.durationMs === 'number') return run.durationMs;
  if (run.completedAtMs && run.startedAtMs) return Math.max(0, run.completedAtMs - run.startedAtMs);
  return undefined;
}

export default function RunQueuePanel() {
  const currentTask = useTaskStore((state) => state.currentTask);
  const queuedTasks = useTaskStore((state) => state.queuedTasks);
  const failedTasks = useTaskStore((state) => state.failedTasks);
  const sessionRuns = useTaskStore((state) => state.sessionRuns);
  const fetchTasks = useTaskStore((state) => state.fetchTasks);
  const clearCompletedSessionRuns = useTaskStore((state) => state.clearCompletedSessionRuns);
  const queued = Object.entries(queuedTasks);
  const failed = Object.entries(failedTasks).slice(0, 8);
  const finishedSessionRuns = sessionRuns
    .filter((run) => run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled')
    .slice(0, 10);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const handleStop = async () => {
    try {
      const data = await requestExecutionStop();
      enqueueSnackbar(data.message || 'Stop requested', {
        variant: 'success',
        autoHideDuration: 3000,
      });
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Could not stop the current execution.'), {
        variant: 'error',
        autoHideDuration: 5000,
      });
    }
  };

  const handleCancelQueued = async (taskId: string) => {
    try {
      await cancelQueuedTask(taskId);
      enqueueSnackbar('Queued task cancelled', { variant: 'success', autoHideDuration: 2200 });
      await fetchTasks();
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Could not cancel the queued task.'), {
        variant: 'error',
        autoHideDuration: 5000,
      });
    }
  };

  return (
    <div className="p-3 text-sm text-modiff-text" data-testid="queue-panel">
      <div className="mb-2 flex flex-wrap gap-2">
        <QueueButton
          icon={<RefreshCw size={15} />}
          testId="queue-refresh"
          onClick={() => {
            void fetchTasks();
          }}
        >
          Refresh
        </QueueButton>
        <QueueButton
          icon={<Square size={15} />}
          testId="queue-stop"
          onClick={() => {
            void handleStop();
          }}
          disabled={!currentTask}
        >
          Stop
        </QueueButton>
      </div>

      <h2 className="mb-2 text-sm font-bold">Current run</h2>
      {currentTask ? (
        <StatusBox sx={{ mb: 2 }} testId="queue-current-run">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm">{currentTask.name || currentTask.task_id || 'Running task'}</div>
              <div className="truncate text-xs text-modiff-muted">
                {currentTask.message || currentTask.task_id || currentTask.sid}
              </div>
            </div>
            <Clock3 size={16} className="flex-none text-hf-yellow" />
          </div>
          {(currentTask.current_step || currentTask.eta_seconds || currentTask.average_step_seconds) && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-modiff-muted">
              {currentTask.current_step && currentTask.total_steps ? (
                <span>{`Step ${currentTask.current_step}/${currentTask.total_steps}`}</span>
              ) : null}
              {formatSeconds(currentTask.eta_seconds) ? (
                <span>{`ETA ${formatSeconds(currentTask.eta_seconds)}`}</span>
              ) : null}
              {formatSeconds(currentTask.average_step_seconds) ? (
                <span>{`${formatSeconds(currentTask.average_step_seconds)}/step`}</span>
              ) : null}
            </div>
          )}
          <ProgressBar value={currentTask.progress} className="mt-2" />
        </StatusBox>
      ) : (
        <p className="mb-4 text-xs text-modiff-muted">No current run.</p>
      )}

      <h2 className="mb-2 text-sm font-bold">Queued runs</h2>
      {queued.length === 0 ? (
        <p className="text-xs text-modiff-muted">No queued runs.</p>
      ) : (
        <div className="grid gap-2">
          {queued.map(([id, task]) => (
            <StatusBox key={id} testId={`queue-run-${id}`}>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{task.name || id}</div>
                  <div className="truncate text-xs text-modiff-muted">{task.task_id || task.sid}</div>
                </div>
                <button
                  type="button"
                  title="Cancel queued task"
                  onClick={() => {
                    void handleCancelQueued(id);
                  }}
                  className="inline-flex h-8 flex-none items-center gap-1.5 px-2 text-sm font-semibold text-gray-300 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
                >
                  <XCircle size={15} />
                  <span>Cancel</span>
                </button>
              </div>
            </StatusBox>
          ))}
        </div>
      )}

      <div className="mb-2 mt-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Session history</h2>
        <button
          type="button"
          disabled={finishedSessionRuns.length === 0}
          onClick={clearCompletedSessionRuns}
          className="inline-flex h-8 items-center gap-1.5 px-2 text-xs font-semibold text-modiff-muted transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
        >
          <Trash2 size={14} />
          Clear finished
        </button>
      </div>
      {finishedSessionRuns.length === 0 ? (
        <p className="text-xs text-modiff-muted">Completed runs will appear here for this browser session.</p>
      ) : (
        <div className="grid gap-2">
          {finishedSessionRuns.map((run) => (
            <StatusBox
              key={run.id}
              severity={run.status === 'failed' ? 'error' : run.status === 'completed' ? 'success' : 'default'}
              testId={`queue-session-run-${run.id}`}
            >
              <div className="flex items-start gap-2">
                {run.status === 'completed' ? (
                  <CheckCircle2 size={16} className="mt-0.5 flex-none text-modiff-green" />
                ) : (
                  <XCircle size={16} className="mt-0.5 flex-none text-modiff-red" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{run.name || run.task_id || 'Graph execution'}</div>
                  <div className="truncate text-xs text-modiff-muted">
                    {run.error || run.message || run.task_id || run.sid}
                  </div>
                </div>
                <div className="flex-none text-xs font-semibold text-modiff-muted">
                  {formatDuration(sessionRunDuration(run))}
                </div>
              </div>
            </StatusBox>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-4 text-sm font-bold">Failed runs</h2>
      {failed.length === 0 ? (
        <p className="text-xs text-modiff-muted">No failed runs recorded in this session.</p>
      ) : (
        <div className="grid gap-2">
          {failed.map(([id, task]) => (
            <StatusBox key={id} severity="error" testId={`queue-failed-run-${id}`}>
              <div className="truncate text-sm text-modiff-red">{task.name || id}</div>
              <div className="break-all text-xs text-modiff-muted">{task.task_id || task.sid}</div>
              {task.error && <div className="break-words text-xs text-modiff-red">{task.error}</div>}
            </StatusBox>
          ))}
        </div>
      )}
    </div>
  );
}
