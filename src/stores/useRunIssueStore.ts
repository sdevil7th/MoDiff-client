import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { RunReadinessIssue, RuntimeFailure, StudioRunContext, WorkflowTab } from '../studio/types';

type RunIssueState = {
  issues: RunReadinessIssue[];
  issueDialogOpen: boolean;
  failure: RuntimeFailure | null;
  failureDialogOpen: boolean;
  failuresByTaskId: Record<string, RuntimeFailure>;
};

type RunIssueActions = {
  showIssues: (issues: RunReadinessIssue[]) => void;
  closeIssues: () => void;
  clearIssues: () => void;
  reportFailure: (
    failure: Omit<RuntimeFailure, 'id' | 'createdAt'> & Partial<Pick<RuntimeFailure, 'id' | 'createdAt'>>,
    open?: boolean,
  ) => void;
  selectFailure: (taskId: string) => void;
  openFailure: (taskId?: string | null) => void;
  closeFailure: () => void;
  clearFailure: (taskId?: string | null) => void;
};

export const MAX_RUNTIME_FAILURE_HISTORY = 30;

export function runtimeFailureTargetsActiveWorkflow(
  failure: RuntimeFailure | null,
  failureRunContext: StudioRunContext | null,
  workflowState: {
    activeWorkflowTabId: string | null;
    currentRunContext: StudioRunContext | null;
    workflowCanvasHydrated: boolean;
    workflowTabs: Array<Pick<WorkflowTab, 'id'>>;
  },
) {
  const { activeWorkflowTabId, currentRunContext, workflowCanvasHydrated, workflowTabs } = workflowState;
  if (!failure || !workflowCanvasHydrated || !activeWorkflowTabId) return false;
  if (!failureRunContext) {
    // Run contexts are intentionally volatile. After a reload, allow the same
    // recovery actions only when the failure carries an exact workflow origin,
    // that document is open and active, and no newer captured run supersedes it.
    return Boolean(
      failure.workflowTabId &&
      failure.workflowTabId === activeWorkflowTabId &&
      workflowTabs.some((tab) => tab.id === failure.workflowTabId) &&
      !currentRunContext,
    );
  }
  return Boolean(
    failureRunContext.workflowTabId === activeWorkflowTabId &&
    currentRunContext?.clientRunId === failureRunContext.clientRunId &&
    workflowTabs.some((tab) => tab.id === failureRunContext.workflowTabId) &&
    (!failure.taskId || failureRunContext.run?.taskId === failure.taskId) &&
    (!failure.clientRunId || failureRunContext.clientRunId === failure.clientRunId) &&
    (!failure.runInputHash || failureRunContext.runInputHash === failure.runInputHash) &&
    (!failure.workflowTabId || failureRunContext.workflowTabId === failure.workflowTabId),
  );
}

function normalizedTaskId(taskId?: string | null) {
  return typeof taskId === 'string' && taskId.trim() ? taskId.trim() : null;
}

function withBoundedFailure(failuresByTaskId: Record<string, RuntimeFailure>, taskId: string, failure: RuntimeFailure) {
  return Object.fromEntries(
    [...Object.entries(failuresByTaskId).filter(([key]) => key !== taskId), [taskId, failure]].slice(
      -MAX_RUNTIME_FAILURE_HISTORY,
    ),
  );
}

export const useRunIssueStore = create<RunIssueState & RunIssueActions>((set) => ({
  issues: [],
  issueDialogOpen: false,
  failure: null,
  failureDialogOpen: false,
  failuresByTaskId: {},

  showIssues: (issues) => set({ issues, issueDialogOpen: true }),
  closeIssues: () => set({ issueDialogOpen: false }),
  clearIssues: () => set({ issues: [], issueDialogOpen: false }),
  reportFailure: (failure, open = true) =>
    set((state) => {
      const nextFailure: RuntimeFailure = {
        ...failure,
        id: failure.id ?? nanoid(),
        createdAt: failure.createdAt ?? Date.now(),
      };
      const taskId = normalizedTaskId(nextFailure.taskId);
      if (taskId) nextFailure.taskId = taskId;
      // Queue reconciliation can precede websocket failure details. A passive
      // update must not dismiss the dialog the user just opened, nor replace
      // it with a different workflow's background failure.
      const keepOpenSelection = !open && state.failureDialogOpen && state.failure;
      const sameSelectedTask = taskId && normalizedTaskId(state.failure?.taskId) === taskId;
      return {
        failure: keepOpenSelection && !sameSelectedTask ? state.failure : nextFailure,
        failuresByTaskId: taskId
          ? withBoundedFailure(state.failuresByTaskId, taskId, nextFailure)
          : state.failuresByTaskId,
        failureDialogOpen: open || Boolean(keepOpenSelection),
      };
    }),
  selectFailure: (taskId) =>
    set((state) => {
      const normalizedId = normalizedTaskId(taskId);
      const selectedFailure = normalizedId ? state.failuresByTaskId[normalizedId] : undefined;
      return selectedFailure ? { failure: selectedFailure } : { failure: null, failureDialogOpen: false };
    }),
  openFailure: (taskId) =>
    set((state) => {
      const normalizedId = normalizedTaskId(taskId);
      const selectedFailure = normalizedId ? state.failuresByTaskId[normalizedId] : state.failure;
      return selectedFailure
        ? { failure: selectedFailure, failureDialogOpen: true }
        : { failure: null, failureDialogOpen: false };
    }),
  closeFailure: () => set({ failureDialogOpen: false }),
  clearFailure: (taskId) =>
    set((state) => {
      const normalizedId = normalizedTaskId(taskId) ?? normalizedTaskId(state.failure?.taskId);
      if (!normalizedId) return { failure: null, failureDialogOpen: false };
      const failuresByTaskId = { ...state.failuresByTaskId };
      delete failuresByTaskId[normalizedId];
      const clearsSelectedFailure = normalizedTaskId(state.failure?.taskId) === normalizedId;
      return {
        failuresByTaskId,
        ...(clearsSelectedFailure ? { failure: null, failureDialogOpen: false } : {}),
      };
    }),
}));
