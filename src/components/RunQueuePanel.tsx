import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { enqueueSnackbar } from '../ui/snackbar';
import { CheckCircle2, Clock3, RefreshCw, Square, Trash2, XCircle } from 'lucide-react';
import { useTaskStore, type SessionRun, type Task } from '../stores/useTaskStore';
import { ProgressBar } from '../ui/ProgressBar';
import { formatRequestError } from '../utils/requestJson';
import { cancelQueuedTask, requestExecutionStop } from '../utils/serverActions';
import { ModiffButton, ModiffTooltip } from '../ui';
import {
  openRunActivity,
  runActivityLabelForTask,
  runActivityTargetForTask,
  type RunActivityStatus,
} from '../studio/runActivity';
import { useSettingsStore } from '../stores/useSettingsStore';
import { cx } from '../utils/classNames';
import { executionProgressDetail, executionProgressFrom } from '../studio/executionProgress';

type QueueButtonProps = {
  children: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
  testId?: string;
};

function QueueButton({ children, disabled, icon, onClick, testId }: QueueButtonProps) {
  return (
    <ModiffButton tone="primary" icon={icon} data-testid={testId} disabled={disabled} onClick={onClick}>
      <span>{children}</span>
    </ModiffButton>
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

type RunActivityRowProps = {
  children: ReactNode;
  fallbackStatus: RunActivityStatus;
  focused?: boolean;
  pending?: boolean;
  severity?: 'default' | 'success' | 'error';
  task: SessionRun | Task | undefined;
  taskId: string;
  testId: string;
};

function RunActivityRow({
  children,
  fallbackStatus,
  focused = false,
  pending = false,
  severity = 'default',
  task,
  taskId,
  testId,
}: RunActivityRowProps) {
  if (!task) return null;
  const label = runActivityLabelForTask(task, taskId);
  const detail =
    executionProgressDetail(executionProgressFrom(task)) ||
    task.error ||
    task.message ||
    `${label} · ${fallbackStatus}`;
  return (
    <ModiffTooltip<HTMLButtonElement> content={detail} placement="top">
      {(tooltipProps) => (
        <ModiffButton
          {...tooltipProps}
          align="left"
          fullWidth
          tone="secondary"
          loading={pending}
          data-testid={testId}
          aria-label={`Open ${label} run details. ${detail}`}
          onClick={() => {
            void openRunActivity(runActivityTargetForTask(task, taskId, fallbackStatus));
          }}
          className={cx(
            'h-auto! min-w-0 rounded-none p-2',
            severity === 'success' && 'border-modiff-green/60',
            severity === 'error' && 'border-modiff-red/70 bg-modiff-red/10 hover:border-modiff-red',
            focused && 'ring-2 ring-hf-yellow',
          )}
        >
          {children}
        </ModiffButton>
      )}
    </ModiffTooltip>
  );
}

export default function RunQueuePanel() {
  const currentTask = useTaskStore((state) => state.currentTask);
  const queuedTasks = useTaskStore((state) => state.queuedTasks);
  const failedTasks = useTaskStore((state) => state.failedTasks);
  const sessionRuns = useTaskStore((state) => state.sessionRuns);
  const fetchTasks = useTaskStore((state) => state.fetchTasks);
  const clearCompletedSessionRuns = useTaskStore((state) => state.clearCompletedSessionRuns);
  const focusedTaskId = useTaskStore((state) => state.focusedTaskId);
  const activityPendingTaskId = useSettingsStore((state) => state.runActivityPendingTaskId);
  const queued = Object.entries(queuedTasks);
  const failed = Object.entries(failedTasks).slice(0, 8);
  const finishedSessionRuns = sessionRuns
    .filter((run) => run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled')
    .slice(0, 10);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!focusedTaskId) return;
    document.getElementById(`queue-task-${focusedTaskId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedTaskId, currentTask, queuedTasks, sessionRuns, failedTasks]);

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
        <RunActivityRow
          fallbackStatus="running"
          focused={focusedTaskId === currentTask.task_id}
          pending={activityPendingTaskId === currentTask.task_id}
          task={currentTask}
          taskId={currentTask.task_id || 'current'}
          testId="queue-current-run"
        >
          <span id={`queue-task-${currentTask.task_id || 'current'}`} className="block min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate text-sm">
                  {runActivityLabelForTask(currentTask, currentTask.task_id || 'Running task')}
                </span>
                <span className="block truncate text-xs text-modiff-subtle-text">
                  {currentTask.message || currentTask.task_id || currentTask.sid}
                </span>
              </span>
              <Clock3 size={16} className="flex-none text-hf-yellow" />
            </span>
            {(currentTask.current_step || currentTask.eta_seconds || currentTask.average_step_seconds) && (
              <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-modiff-subtle-text">
                {currentTask.current_step && currentTask.total_steps ? (
                  <span>{`Step ${currentTask.current_step}/${currentTask.total_steps}`}</span>
                ) : null}
                {formatSeconds(currentTask.eta_seconds) ? (
                  <span>{`ETA ${formatSeconds(currentTask.eta_seconds)}`}</span>
                ) : null}
                {formatSeconds(currentTask.average_step_seconds) ? (
                  <span>{`${formatSeconds(currentTask.average_step_seconds)}/step`}</span>
                ) : null}
              </span>
            )}
            <ProgressBar value={currentTask.progress} className="mt-2" />
          </span>
        </RunActivityRow>
      ) : (
        <p className="mb-4 text-xs text-modiff-subtle-text">No current run.</p>
      )}

      <h2 className="mb-2 text-sm font-bold">Queued runs</h2>
      {queued.length === 0 ? (
        <p className="text-xs text-modiff-subtle-text">No queued runs.</p>
      ) : (
        <div className="grid gap-2">
          {queued.map(([id, task]) => (
            <div
              key={id}
              id={`queue-task-${id}`}
              data-testid={`queue-run-${id}`}
              className={cx(
                'flex items-stretch border border-modiff-border bg-modiff-surface',
                focusedTaskId === id && 'ring-2 ring-hf-yellow',
              )}
            >
              <ModiffButton
                align="left"
                fullWidth
                tone="ghost"
                loading={activityPendingTaskId === (task.task_id || id)}
                aria-label={`Open ${runActivityLabelForTask(task, id)} run details`}
                onClick={() => {
                  void openRunActivity(runActivityTargetForTask(task, id, 'queued'));
                }}
                className="h-auto! min-w-0 flex-1 rounded-none p-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{runActivityLabelForTask(task, id)}</span>
                  <span className="block truncate text-xs text-modiff-subtle-text">{task.task_id || task.sid}</span>
                </span>
              </ModiffButton>
              <ModiffButton
                tone="ghost"
                size="dense"
                title="Cancel queued task"
                onClick={() => {
                  void handleCancelQueued(id);
                }}
                icon={<XCircle size={15} />}
                className="h-auto! flex-none rounded-none border-l border-modiff-border px-2 text-modiff-subtle-text"
              >
                <span>Cancel</span>
              </ModiffButton>
            </div>
          ))}
        </div>
      )}

      <div className="mb-2 mt-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Session history</h2>
        <ModiffButton
          tone="ghost"
          size="dense"
          disabled={finishedSessionRuns.length === 0}
          onClick={clearCompletedSessionRuns}
          icon={<Trash2 size={14} />}
          className="px-2 text-xs"
        >
          Clear finished
        </ModiffButton>
      </div>
      {finishedSessionRuns.length === 0 ? (
        <p className="text-xs text-modiff-subtle-text">Completed runs will appear here for this browser session.</p>
      ) : (
        <div className="grid gap-2">
          {finishedSessionRuns.map((run) => (
            <RunActivityRow
              key={run.id}
              fallbackStatus={run.status ?? 'completed'}
              focused={focusedTaskId === (run.task_id || run.id)}
              pending={activityPendingTaskId === (run.task_id || run.id)}
              severity={run.status === 'failed' ? 'error' : run.status === 'completed' ? 'success' : 'default'}
              task={run}
              taskId={run.task_id || run.id}
              testId={`queue-session-run-${run.id}`}
            >
              <span id={`queue-task-${run.task_id || run.id}`} className="block min-w-0 flex-1">
                <span className="flex items-start gap-2">
                  {run.status === 'completed' ? (
                    <CheckCircle2 size={16} className="mt-0.5 flex-none text-modiff-green" />
                  ) : (
                    <XCircle size={16} className="mt-0.5 flex-none text-modiff-red" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {runActivityLabelForTask(run, run.task_id || run.id)}
                    </span>
                    <span className="block truncate text-xs text-modiff-subtle-text">
                      {run.error || run.message || run.task_id || run.sid}
                    </span>
                  </span>
                  <span className="flex-none text-xs font-semibold text-modiff-subtle-text">
                    {formatDuration(sessionRunDuration(run))}
                  </span>
                </span>
              </span>
            </RunActivityRow>
          ))}
        </div>
      )}

      <h2 className="mb-2 mt-4 text-sm font-bold">Failed runs</h2>
      {failed.length === 0 ? (
        <p className="text-xs text-modiff-subtle-text">No failed runs recorded in this session.</p>
      ) : (
        <div className="grid gap-2">
          {failed.map(([id, task]) => (
            <RunActivityRow
              key={id}
              fallbackStatus="failed"
              focused={focusedTaskId === id}
              pending={activityPendingTaskId === (task.task_id || id)}
              severity="error"
              task={task}
              taskId={id}
              testId={`queue-failed-run-${id}`}
            >
              <span id={`queue-task-${id}`} className="block min-w-0 flex-1">
                <span className="block truncate text-sm text-modiff-red">{runActivityLabelForTask(task, id)}</span>
                <span className="block break-all text-xs text-modiff-subtle-text">{task.task_id || task.sid}</span>
                {task.error && <span className="block break-words text-xs text-modiff-red">{task.error}</span>}
              </span>
            </RunActivityRow>
          ))}
        </div>
      )}
    </div>
  );
}
