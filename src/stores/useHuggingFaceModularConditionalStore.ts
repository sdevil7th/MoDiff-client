import { create } from 'zustand';

import config from '../../app.config';
import {
  parseHuggingFaceModularConditionalSnapshot,
  type HuggingFaceModularConditionalSnapshot,
} from '../studio/huggingFaceModularConditionals';
import { formatRequestError, requestJson } from '../utils/requestJson';

type HuggingFaceModularConditionalStore = {
  snapshot: HuggingFaceModularConditionalSnapshot | null;
  loaded: boolean;
  error: string | null;
  fetchSnapshot: () => Promise<void>;
};

let pendingSnapshot: Promise<void> | null = null;

export const useHuggingFaceModularConditionalStore = create<HuggingFaceModularConditionalStore>()((set) => ({
  snapshot: null,
  loaded: false,
  error: null,

  fetchSnapshot: () => {
    // The library, picker and Block factory need the same result. An earlier
    // caller must not finish before the shared snapshot becomes available.
    if (pendingSnapshot) return pendingSnapshot;
    pendingSnapshot = (async () => {
      try {
        const snapshot = await requestJson(`${config.serverAddress}/huggingface/modular-conditionals`, {
          timeoutMs: 120_000,
          parse: parseHuggingFaceModularConditionalSnapshot,
        });
        set({ snapshot, loaded: true, error: null });
      } catch (error) {
        set({
          snapshot: null,
          loaded: true,
          error: formatRequestError(error, 'Could not load the reviewed Modular Diffusers conditional tree.'),
        });
      }
    })().finally(() => {
      pendingSnapshot = null;
    });
    return pendingSnapshot;
  },
}));
