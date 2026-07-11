import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { RunReadinessIssue, RuntimeFailure } from '../studio/types';

type RunIssueState = {
  issues: RunReadinessIssue[];
  issueDialogOpen: boolean;
  failure: RuntimeFailure | null;
  failureDialogOpen: boolean;
};

type RunIssueActions = {
  showIssues: (issues: RunReadinessIssue[]) => void;
  closeIssues: () => void;
  clearIssues: () => void;
  reportFailure: (
    failure: Omit<RuntimeFailure, 'id' | 'createdAt'> & Partial<Pick<RuntimeFailure, 'id' | 'createdAt'>>,
  ) => void;
  closeFailure: () => void;
  clearFailure: () => void;
};

export const useRunIssueStore = create<RunIssueState & RunIssueActions>((set) => ({
  issues: [],
  issueDialogOpen: false,
  failure: null,
  failureDialogOpen: false,

  showIssues: (issues) => set({ issues, issueDialogOpen: true }),
  closeIssues: () => set({ issueDialogOpen: false }),
  clearIssues: () => set({ issues: [], issueDialogOpen: false }),
  reportFailure: (failure) =>
    set({
      failure: {
        id: failure.id ?? nanoid(),
        createdAt: failure.createdAt ?? Date.now(),
        ...failure,
      },
      failureDialogOpen: true,
    }),
  closeFailure: () => set({ failureDialogOpen: false }),
  clearFailure: () => set({ failure: null, failureDialogOpen: false }),
}));
