// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { create } from 'zustand';
import config from '../../app.config';
import { createLatestRequestGate, formatRequestError, requestJson } from '../utils/requestJson';
import { useFlowStore } from './useFlowStore';
import { useRunIssueStore } from './useRunIssueStore';
import { useStudioStore } from './useStudioStore';
import { runtimeProgressTarget } from '../studio/userBlocks';
import { executionProgressFrom } from '../studio/executionProgress';

export type Task = {
  name: string;
  queue_position?: number;
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
  component?: string;
  shard_current?: number;
  shard_total?: number;
  eta_seconds?: number;
  average_step_seconds?: number;
  elapsed_seconds?: number;
  last_heartbeat_at?: number;
  resource_snapshot?: Record<string, unknown>;
  phase_timings?: Record<string, number>;
  sid?: string;
  task_id?: string;
  client_run_id?: string;
  run_input_hash?: string;
  workflow_tab_id?: string;
  workflow_title?: string;
  workflow_snapshot?: unknown;
  node_id?: string;
  runtimeFingerprint?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  message?: string;
  exception_type?: string;
  category?: string;
  error_code?: string;
  recovery_hint?: string;
  oom?: boolean;
};

const TASK_STATUSES = new Set<Task['status']>(['queued', 'running', 'completed', 'failed', 'cancelled']);
const TERMINAL_TASK_STATUSES = new Set<Task['status']>(['completed', 'failed', 'cancelled']);
const MAX_SESSION_RUNS = 30;
const RECOVERED_WORKER_FAILURE_FRESHNESS_MS = 30 * 60 * 1000;
const RECOVERED_WORKER_NOTICES_STORAGE_KEY = 'modiff-recovered-worker-failure-notices';
const queueRequestGate = createLatestRequestGate<'queue'>();
const supervisorQueueRequestGate = createLatestRequestGate<'supervisorQueue'>();
let supervisorQueueRequest: Promise<void> | null = null;

export function isTerminalTaskStatus(status: Task['status']): status is 'completed' | 'failed' | 'cancelled' {
  return Boolean(status && TERMINAL_TASK_STATUSES.has(status));
}

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

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function optionalTaskStatus(value: unknown): Task['status'] | undefined {
  return typeof value === 'string' && TASK_STATUSES.has(value as Task['status'])
    ? (value as Task['status'])
    : undefined;
}

export function coerceTask(value: unknown): Task | undefined {
  if (!isRecord(value)) return undefined;
  const runtimeHints = isRecord(value.runtimeHints)
    ? value.runtimeHints
    : isRecord(value.runtime_hints)
      ? value.runtime_hints
      : {};
  return {
    name: optionalString(value.name) ?? optionalString(value.task_id) ?? optionalString(value.sid) ?? 'Task',
    queue_position: optionalNumber(value.queue_position),
    queued_at: optionalNumber(value.queued_at),
    started_at: optionalNumber(value.started_at),
    completed_at: optionalNumber(value.completed_at),
    updated_at: optionalNumber(value.updated_at),
    progress: optionalNumber(value.progress),
    node_progress: optionalNumber(value.node_progress),
    attempt_index: optionalNumber(value.attempt_index),
    current_node: optionalString(value.current_node) ?? optionalString(value.node),
    current_node_name: optionalString(value.current_node_name) ?? optionalString(value.node_name),
    phase: optionalString(value.phase),
    current_step: optionalNumber(value.current_step),
    total_steps: optionalNumber(value.total_steps),
    component: optionalString(value.component),
    shard_current: optionalNumber(value.shard_current),
    shard_total: optionalNumber(value.shard_total),
    eta_seconds: optionalNumber(value.eta_seconds),
    average_step_seconds: optionalNumber(value.average_step_seconds),
    elapsed_seconds: optionalNumber(value.elapsed_seconds),
    last_heartbeat_at: optionalNumber(value.last_heartbeat_at),
    resource_snapshot: isRecord(value.resource_snapshot) ? value.resource_snapshot : undefined,
    phase_timings: isRecord(value.phase_timings)
      ? Object.fromEntries(
          Object.entries(value.phase_timings).filter(
            (entry): entry is [string, number] => optionalNumber(entry[1]) !== undefined,
          ),
        )
      : undefined,
    sid: optionalString(value.sid),
    task_id: optionalString(value.task_id),
    client_run_id: optionalString(value.client_run_id) ?? optionalString(runtimeHints.clientRunId),
    run_input_hash: optionalString(value.run_input_hash) ?? optionalString(runtimeHints.runInputHash),
    workflow_tab_id: optionalString(value.workflow_tab_id) ?? optionalString(runtimeHints.workflowTabId),
    workflow_title: optionalString(value.workflow_title) ?? optionalString(runtimeHints.workflowTitle),
    workflow_snapshot: value.workflow_snapshot ?? runtimeHints.workflowSnapshot,
    node_id: optionalString(value.node_id) ?? optionalString(runtimeHints.nodeId),
    runtimeFingerprint: optionalString(value.runtimeFingerprint),
    status: optionalTaskStatus(value.status),
    error: optionalString(value.error),
    message: optionalString(value.message),
    exception_type: optionalString(value.exception_type),
    category: optionalString(value.category),
    error_code: optionalString(value.error_code),
    recovery_hint: optionalString(value.recovery_hint),
    oom: optionalBoolean(value.oom) ?? (value.category === 'oom' ? true : undefined),
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
  focusedTaskId: string | null;
}

interface TaskActions {
  setTasks: (current: Task | undefined, queued: Record<string, Task>, recent?: Task[]) => void;
  fetchTasks: () => Promise<void>;
  fetchSupervisorTasks: () => Promise<void>;
  updateProgress: (task_id: string, progress: number, message?: string, details?: Partial<Task>) => void;
  markTaskFailed: (task: Task) => void;
  markTaskCompleted: (task: Task) => void;
  recordTaskSnapshot: (task: Task, status?: Task['status'], message?: string) => void;
  clearCompletedSessionRuns: () => void;
  setFocusedTaskId: (taskId: string | null) => void;
  //getCurrentTask: () => Task | undefined;
}

function timestampToMs(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function gibibytes(value: number) {
  return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

export function recoveredWorkerFailureMemorySummary(task: Task) {
  if (task.error_code !== 'backend_worker_exited') return null;
  const snapshot = recordValue(task.resource_snapshot);
  if (!snapshot) return null;
  const process = recordValue(snapshot.process);
  const system = recordValue(snapshot.system);
  const accelerators = Array.isArray(snapshot.accelerators)
    ? snapshot.accelerators.map(recordValue).filter((value): value is Record<string, unknown> => Boolean(value))
    : [];
  const accelerator = accelerators[0] ?? null;
  const processRss = finiteNumber(process?.rssBytes);
  const acceleratorAllocated = finiteNumber(accelerator?.allocatedBytes);
  const acceleratorReserved = finiteNumber(accelerator?.reservedBytes);
  const systemAvailable = finiteNumber(system?.ramAvailableBytes);
  const facts = [
    processRss !== null ? `worker RAM ${gibibytes(processRss)}` : null,
    acceleratorAllocated !== null
      ? `accelerator allocations ${gibibytes(acceleratorAllocated)}`
      : acceleratorReserved !== null
        ? `accelerator reservations ${gibibytes(acceleratorReserved)}`
        : null,
    systemAvailable !== null ? `system RAM available ${gibibytes(systemAvailable)}` : null,
  ].filter((value): value is string => Boolean(value));
  if (facts.length === 0) return null;
  return `Last recorded before the native worker stopped: ${facts.join(', ')}. This evidence indicates memory pressure but cannot identify the native driver failure with certainty.`;
}

export function shouldOpenRecoveredWorkerFailure(task: Task, nowMs = Date.now()) {
  if (task.status !== 'failed' || task.error_code !== 'backend_worker_exited') return false;
  const completedAtMs = timestampToMs(task.completed_at ?? task.updated_at);
  return (
    completedAtMs !== undefined &&
    nowMs - completedAtMs >= 0 &&
    nowMs - completedAtMs <= RECOVERED_WORKER_FAILURE_FRESHNESS_MS
  );
}

function markRecoveredWorkerFailureNotified(taskId: string) {
  try {
    const storage = window.sessionStorage;
    const raw = storage.getItem(RECOVERED_WORKER_NOTICES_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const notified = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (notified.includes(taskId)) return false;
    storage.setItem(RECOVERED_WORKER_NOTICES_STORAGE_KEY, JSON.stringify([...notified, taskId].slice(-30)));
  } catch {
    // Tests and storage-restricted browsers still get the in-memory notice.
  }
  return true;
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
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<SessionRun> & { id: string };
  const mergedValues = { ...existing, ...definedPatch };
  const merged: SessionRun = {
    ...mergedValues,
    name: mergedValues.name ?? patch.id,
    id: patch.id,
    status,
    createdAtMs: existing?.createdAtMs ?? patch.createdAtMs ?? now,
    queuedAtMs: patch.queuedAtMs ?? existing?.queuedAtMs,
    startedAtMs,
    completedAtMs,
    durationMs,
  };
  const nextRuns = [merged, ...runs.filter((run) => run.id !== patch.id)];
  // Queue snapshots can contain more history than the visible list, in either
  // order. Rehydrating an older item must not promote it above newer work or
  // evict the active run before that run's next progress event arrives.
  const activityTime = (run: SessionRun) => run.completedAtMs ?? run.startedAtMs ?? run.queuedAtMs ?? run.createdAtMs;
  const activityPriority = (run: SessionRun) =>
    run.status === 'running' ? 2 : TERMINAL_TASK_STATUSES.has(run.status) ? 0 : 1;
  nextRuns.sort((first, second) => {
    return activityPriority(second) - activityPriority(first) || activityTime(second) - activityTime(first);
  });
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
  focusedTaskId: null,
  setFocusedTaskId: (taskId) => set({ focusedTaskId: taskId }),

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

  fetchSupervisorTasks: () => {
    if (supervisorQueueRequest) return supervisorQueueRequest;
    const ticket = supervisorQueueRequestGate.begin('supervisorQueue');
    const queueRevision = get().queueRevision;
    const request = (async () => {
      try {
        const payload = await requestJson(`${config.supervisorAddress}/queue`, {
          signal: ticket.signal,
          timeoutMs: 2_000,
          parse: parseQueueResponse,
        });
        if (!ticket.isLatest()) return;
        // A websocket queue snapshot that arrived while this emergency request
        // was in flight is newer and must remain authoritative.
        if (get().queueRevision === queueRevision) {
          get().setTasks(payload.current, payload.queued, payload.recent);
        }
      } catch {
        // The control plane is an emergency fallback. Normal websocket/HTTP
        // connectivity owns visible connection errors.
      } finally {
        ticket.finish();
        supervisorQueueRequest = null;
      }
    })();
    supervisorQueueRequest = request;
    return request;
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
    if (current?.current_node && !isTerminalTaskStatus(current.status)) {
      const flow = useFlowStore.getState();
      const progressNodeId = runtimeProgressTarget(flow.nodes, current.current_node, current.current_node_name);
      if (progressNodeId) {
        flow.updateProgress(progressNodeId, current.node_progress ?? 0, {
          activeTaskId: current.task_id ?? null,
          attemptIndex: current.attempt_index,
          executionStatus: current.status ?? 'running',
          executionPhase: current.phase,
          progressMessage: current.message,
          executionProgress: executionProgressFrom(current),
        });
      }
    }
    let recoveredFailureToOpen: string | null = null;
    recent.forEach((task) => {
      if (!task.task_id || !isTerminalTaskStatus(task.status)) return;
      useFlowStore.getState().resetExecutionProgress(task.task_id);
      useStudioStore.getState().markRunContextStatus(task.task_id, task.client_run_id, task.status!);
      const failureAlreadyKnown = Boolean(useRunIssueStore.getState().failuresByTaskId[task.task_id]);
      if (task.status === 'failed' && !failureAlreadyKnown) {
        useRunIssueStore.getState().reportFailure(
          {
            taskId: task.task_id,
            clientRunId: task.client_run_id ?? null,
            workflowTabId: task.workflow_tab_id ?? null,
            runInputHash: task.run_input_hash ?? null,
            nodeId: task.current_node ?? task.node_id ?? null,
            nodeName: task.current_node_name ?? null,
            message: task.message || task.error || 'Run failed.',
            exceptionType: task.exception_type ?? null,
            category: task.category ?? null,
            errorCode: task.error_code ?? null,
            recoveryHint: task.recovery_hint ?? null,
            oom: task.oom ?? false,
            memorySummary: recoveredWorkerFailureMemorySummary(task),
          },
          false,
        );
        if (
          recoveredFailureToOpen === null &&
          shouldOpenRecoveredWorkerFailure(task) &&
          markRecoveredWorkerFailureNotified(task.task_id)
        ) {
          recoveredFailureToOpen = task.task_id;
        }
      }
    });
    if (recoveredFailureToOpen) useRunIssueStore.getState().openFailure(recoveredFailureToOpen);
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

    const definedDetails = Object.fromEntries(
      Object.entries(details).filter(([, value]) => value !== undefined),
    ) as Partial<Task>;
    const preservedIdentity = Object.fromEntries(
      (['client_run_id', 'run_input_hash', 'workflow_tab_id', 'node_id'] as const)
        .map((key) => [key, currentTask[key]] as const)
        .filter(([, value]) => value !== undefined),
    ) as Partial<Task>;
    const updatedTask = {
      ...currentTask,
      ...definedDetails,
      ...preservedIdentity,
      progress,
      message: message ?? definedDetails.message ?? currentTask.message,
    };
    set((state) => ({
      currentTask: updatedTask,
      sessionRuns: mergeSessionRun(state.sessionRuns, taskPatch(updatedTask, 'running', message)),
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
    const current = get().currentTask;
    const fallback = !task.task_id || !current?.task_id || task.task_id === current.task_id ? current : undefined;
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
    set((state) => {
      const completesCurrent = Boolean(
        completed.task_id && state.currentTask?.task_id && completed.task_id === state.currentTask.task_id,
      );
      return {
        currentTask: completesCurrent ? undefined : state.currentTask,
        taskCount: Object.keys(state.queuedTasks).length + (completesCurrent ? 0 : state.currentTask ? 1 : 0),
        sessionRuns: mergeSessionRun(state.sessionRuns, taskPatch(completed, 'completed')),
      };
    });
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
