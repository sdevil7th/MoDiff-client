import { create } from 'zustand';

import type { HuggingFaceClusterRuntimeAuthority } from '../studio/huggingFaceClusterRuntime';

type HuggingFaceClusterRuntimeState = {
  authorities: Record<string, HuggingFaceClusterRuntimeAuthority>;
  setAuthority: (authority: HuggingFaceClusterRuntimeAuthority) => void;
  clearAuthority: (instanceId: string) => void;
  clearAuthorities: () => void;
};

/**
 * Volatile execution authority for prepared Diffusers Cluster Nodes.
 *
 * This store is deliberately not persisted. A refresh must re-check the live
 * backend runtime, optional overlay, installed artifact, and resource plan
 * before derived execution children may be enabled again.
 */
export const useHuggingFaceClusterRuntimeStore = create<HuggingFaceClusterRuntimeState>((set) => ({
  authorities: {},
  setAuthority: (authority) =>
    set((state) => ({
      authorities: { ...state.authorities, [authority.instanceId]: authority },
    })),
  clearAuthority: (instanceId) =>
    set((state) => {
      if (!state.authorities[instanceId]) return state;
      const authorities = { ...state.authorities };
      delete authorities[instanceId];
      return { authorities };
    }),
  clearAuthorities: () => set({ authorities: {} }),
}));
