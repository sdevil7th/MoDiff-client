import { create } from 'zustand';

import type { GraphFixCandidate } from '../studio/graphFixer';

type GraphFixUiState = {
  dialogOpen: boolean;
  previewCandidate: GraphFixCandidate | null;
  issueTargets: Array<{ nodeId: string; handle?: string }>;
  openDialog: () => void;
  closeDialog: () => void;
  setPreviewCandidate: (candidate: GraphFixCandidate | null) => void;
  setIssueTargets: (targets: Array<{ nodeId: string; handle?: string }>) => void;
};

export const useGraphFixStore = create<GraphFixUiState>((set) => ({
  dialogOpen: false,
  previewCandidate: null,
  issueTargets: [],
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false, previewCandidate: null, issueTargets: [] }),
  setPreviewCandidate: (previewCandidate) => set({ previewCandidate }),
  setIssueTargets: (issueTargets) => set({ issueTargets }),
}));
