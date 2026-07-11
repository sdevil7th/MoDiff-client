import { create } from 'zustand';
import config from '../../app.config';
import { createLatestRequestGate, formatRequestError, requestJson } from '../utils/requestJson';
import { useFlowStore } from './useFlowStore';

export type Task = {
  name: string;
  queued_at?: number;
  started_at?: number;
  completed_at?: number;
  updated_at?: number;
  progress?: number;
  node_progress?: number;
  attempt_index?: number;
  current_node?: string;
  current_node_name?: string;
  phase?: string;
  current_step?: number;
  total_steps?: number;
  eta_seconds?: number;
  average_step_seconds?: number;
  elapsed_seconds?: number;
  sid?: string;
  task_id?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  message?: string;
};

const TASK_STATUSES = new Set<Task['status']>(['queued', 'running', 'completed', 'failed', 'cancelled']);
const TERMINAL_TASK_STATUSES = new Set<Task['status']>(['completed', 'failed', 'cancelled']);
const MAX_SESSION_RUNS = 30;
const queueRequestGate = createLatestRequestGate<'queue'>();

export type QueueFetchState = {
  status: 'error' | 'idle' | 'loading' | 'success';
  error: string | null;
  requestId: number | null;
};

export type SessionRun = Task & {
  id: string;
  createdAtMs: number;
  queuedAtMs?: number;
  startedAtMs?: number;
  completedAtMs?: number;
  durationMs?: number;
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalTaskStatus(value: unknown): Task['status'] | undefined {
  return typeof value === 'string' && TASK_STATUSES.has(value as Task['status'])
    ? (value as Task['status'])
    : undefined;
}

export function coerceTask(value: unknown): Task | undefined {
  if (!isRecord(value)) return undefined;
  return {
    name: optionalString(value.name) ?? optionalString(value.task_id) ?? optionalString(value.sid) ?? 'Task',
    queued_at: optionalNumber(value.queued_at),
    started_at: optionalNumber(value.started_at),
    completed_at: optionalNumber(value.completed_at),
    updated_at: optionalNumber(value.updated_at),
    progress: optionalNumber(value.progress),
    node_progress: optionalNumber(value.node_progress),
    attempt_index: optionalNumber(value.attempt_index),
    current_node: optionalString(value.current_node),
    current_node_name: optionalString(value.current_node_name),
    phase: optionalString(value.phase),
    current_step: optionalNumber(value.current_step),
    total_steps: optionalNumber(value.total_steps),
    eta_seconds: optionalNumber(value.eta_seconds),
    average_step_seconds: optionalNumber(value.average_step_seconds),
    elapsed_seconds: optionalNumber(value.elapsed_seconds),
    sid: optionalString(value.sid),
    task_id: optionalString(value.task_id),
    status: optionalTaskStatus(value.status),
    error: optionalString(value.error),
    message: optionalString(value.message),
  };
}

export function coerceTaskRecord(value: unknown): Record<string, Task> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, task]) => [key, coerceTask(task)] as const)
      .filter((entry): entry is readonly [string, Task] => Boolean(entry[1])),
  );
}

function parseQueueResponse(value: unknown) {
  if (!isRecord(value)) throw new Error('The task queue response is invalid.');
  const current = value.current == null ? undefined : coerceTask(value.current);
  if (value.current != null && !current) throw new Error('The current task response is invalid.');
  if (!isRecord(value.queued)) throw new Error('The queued task response is invalid.');
  const queued = coerceTaskRecord(value.queued);
  if (Object.keys(queued).length !== Object.keys(value.queued).length) {
    throw new Error('The queued task response contains an invalid task.');
  }
  const recent = Array.isArray(value.recent)
    ? value.recent.map(coerceTask).filter((task): task is Task => Boolean(task))
    : [];
  return { current, queued, recent };
}

interface TaskState {
  queuedTasks: Record<string, Task>;
  currentTask: Task | undefined;
  failedTasks: Record<string, Task>;
  sessionRuns: SessionRun[];
  taskCount: number;
  queueRevision: number;
  fetchState: QueueFetchState;
}

interface TaskActions {
  setTasks: (current: Task | undefined, queued: Record<string, Task>, recent?: Task[]) => void;
  fetchTasks: () => Promise<void>;
  updateProgress: (task_id: string, progress: number, message?: string, details?: Partial<Task>) => void;
  markTaskFailed: (task: Task) => void;
  markTaskCompleted: (task: Task) => void;
  recordTaskSnapshot: (task: Task, status?: Task['status'], message?: string) => void;
  clearCompletedSessionRuns: () => void;
  //getCurrentTask: () => Task | undefined;
}

function timestampToMs(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function taskIdentity(task: Pick<Task, 'task_id' | 'sid' | 'name'>, fallback: string) {
  return task.task_id || task.sid || task.name || fallback;
}

function taskPatch(task: Task, status?: Task['status'], message?: string): Partial<SessionRun> & { id: string } {
  const now = Date.now();
  const id = taskIdentity(task, `task-${now}`);
  const nextStatus = status ?? task.status;
  const startedAtMs = timestampToMs(task.started_at);
  const completedAtMs = timestampToMs(task.completed_at);
  return {
    ...task,
    id,
    status: nextStatus,
    message: message ?? task.message,
    queuedAtMs: timestampToMs(task.queued_at),
    startedAtMs,
    completedAtMs,
    durationMs: completedAtMs && startedAtMs ? Math.max(0, completedAtMs - startedAtMs) : undefined,
    createdAtMs: now,
  };
}

function mergeSessionRun(runs: SessionRun[], patch: Partial<SessionRun> & { id: string }) {
  const now = Date.now();
  const existing = runs.find((run) => run.id === patch.id);
  const existingTerminal = existing?.status && TERMINAL_TASK_STATUSES.has(existing.status);
  const patchTerminal = patch.status && TERMINAL_TASK_STATUSES.has(patch.status);
  const status = existingTerminal && !patchTerminal ? existing.status : (patch.status ?? existing?.status ?? 'queued');
  const startedAtMs = patch.startedAtMs ?? existing?.startedAtMs ?? (status === 'running' ? now : undefined);
  const completedAtMs = patch.completedAtMs ?? existing?.completedAtMs ?? (patchTerminal ? now : undefined);
  const durationMs =
    completedAtMs && startedAtMs
      ? Math.max(0, completedAtMs - startedAtMs)
      : (patch.durationMs ?? existing?.durationMs);
  const merged: SessionRun = {
    name: patch.name ?? existing?.name ?? patch.id,
    task_id: patch.task_id ?? existing?.task_id,
    sid: patch.sid ?? existing?.sid,
    progress: patch.progress ?? existing?.progress,
    queued_at: patch.queued_at ?? existing?.queued_at,
    started_at: patch.started_at ?? existing?.started_at,
    completed_at: patch.completed_at ?? existing?.completed_at,
    error: patch.error ?? existing?.error,
    message: patch.message ?? existing?.message,
    id: patch.id,
    status,
    createdAtMs: existing?.createdAtMs ?? patch.createdAtMs ?? now,
    queuedAtMs: patch.queuedAtMs ?? existing?.queuedAtMs,
    startedAtMs,
    completedAtMs,
    durationMs,
  };
  const nextRuns = [merged, ...runs.filter((run) => run.id !== patch.id)];
  return nextRuns.slice(0, MAX_SESSION_RUNS);
}

export const useTaskStore = create<TaskState & TaskActions>((set, get) => ({
  queuedTasks: {},
  currentTask: undefined,
  failedTasks: {},
  sessionRuns: [],
  taskCount: 0,
  queueRevision: 0,
  fetchState: { status: 'idle', error: null, requestId: null },

  fetchTasks: async () => {
    const ticket = queueRequestGate.begin('queue');
    const queueRevision = get().queueRevision;
    set({ fetchState: { status: 'loading', error: null, requestId: ticket.id } });
    try {
      const payload = await requestJson(`${config.serverAddress}/queue`, {
        signal: ticket.signal,
        parse: parseQueueResponse,
      });
      if (!ticket.isLatest()) return;
      if (get().queueRevision === queueRevision) get().setTasks(payload.current, payload.queued, payload.recent);
      set({ fetchState: { status: 'success', error: null, requestId: ticket.id } });
    } catch (error) {
      if (!ticket.isLatest()) return;
      set({
        fetchState: {
          status: 'error',
          error: formatRequestError(error, 'Could not read the task queue.'),
          requestId: ticket.id,
        },
      });
    } finally {
      ticket.finish();
    }
  },

  setTasks: (current, queued, recent = []) => {
    set((state) => {
      let sessionRuns = state.sessionRuns;
      const failedTasks = { ...state.failedTasks };
      recent.forEach((task) => {
        const status = task.status ?? 'completed';
        sessionRuns = mergeSessionRun(sessionRuns, taskPatch(task, status));
        if (status === 'failed' && task.task_id) failedTasks[task.task_id] = task;
      });
      Object.values(queued).forEach((task) => {
        sessionRuns = mergeSessionRun(sessionRuns, taskPatch(task, 'queued'));
      });
      if (current) {
        sessionRuns = mergeSessionRun(sessionRuns, taskPatch(current, current.status ?? 'running'));
      }
      return {
        queuedTasks: queued,
        currentTask: current,
        failedTasks,
        sessionRuns,
        taskCount: Object.keys(queued).length + (current ? 1 : 0),
        queueRevision: state.queueRevision + 1,
      };
    });
    if (current?.current_node) {
      useFlowStore.getState().updateProgress(current.current_node, current.node_progress ?? 0, {
        activeTaskId: current.task_id ?? null,
        attemptIndex: current.attempt_index,
        executionStatus: current.status ?? 'running',
        executionPhase: current.phase,
        progressMessage: current.message,
      });
    }
  },

  updateProgress: (task_id, progress, message, details = {}) => {
    const currentTask = get().currentTask;
    if (currentTask === undefined || task_id !== currentTask.task_id) {
      set((state) => ({
        sessionRuns: mergeSessionRun(state.sessionRuns, {
          id: task_id,
          task_id,
          name: task_id,
          progress,
          message,
          status: 'running',
          ...details,
        }),
      }));
      return;
    }

    set((state) => ({
      currentTask: { ...currentTask, ...details, progress, message: message ?? details.message ?? currentTask.message },
      sessionRuns: mergeSessionRun(
        state.sessionRuns,
        taskPatch({ ...currentTask, ...details, progress, message }, 'running', message),
      ),
    }));
  },
  markTaskFailed: (task) => {
    const taskId = task.task_id || `failed-${Date.now()}`;
    set((state) => ({
      currentTask: state.currentTask?.task_id === taskId ? undefined : state.currentTask,
      failedTasks: {
        [taskId]: {
          ...task,
          task_id: taskId,
          status: 'failed',
          completed_at: task.completed_at ?? Date.now() / 1000,
        },
        ...state.failedTasks,
      },
      sessionRuns: mergeSessionRun(
        state.sessionRuns,
        taskPatch(
          {
            ...task,
            task_id: taskId,
            name: task.name || 'Graph execution',
            status: 'failed',
            completed_at: task.completed_at ?? Date.now() / 1000,
          },
          'failed',
          task.error ?? task.message,
        ),
      ),
      taskCount:
        Object.keys(state.queuedTasks).length + (state.currentTask?.task_id === taskId ? 0 : state.currentTask ? 1 : 0),
    }));
  },
  markTaskCompleted: (task) => {
    const fallback = get().currentTask;
    const completed = {
      ...(fallback ?? {}),
      ...task,
      name: task.name || fallback?.name || task.task_id || 'Graph execution',
      task_id: task.task_id || fallback?.task_id,
      sid: task.sid || fallback?.sid,
      progress: 100,
      status: 'completed' as const,
      completed_at: task.completed_at ?? Date.now() / 1000,
    };
    set((state) => ({
      sessionRuns: mergeSessionRun(state.sessionRuns, taskPatch(completed, 'completed')),
    }));
  },
  recordTaskSnapshot: (task, status, message) => {
    set((state) => ({
      sessionRuns: mergeSessionRun(state.sessionRuns, taskPatch(task, status, message)),
    }));
  },
  clearCompletedSessionRuns: () => {
    set((state) => ({
      sessionRuns: state.sessionRuns.filter((run) => !run.status || !TERMINAL_TASK_STATUSES.has(run.status)),
    }));
  },
}));
