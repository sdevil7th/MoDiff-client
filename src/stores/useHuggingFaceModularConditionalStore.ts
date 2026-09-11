import { create } from 'zustand';

import config from '../../app.config';
import {
  parseHuggingFaceModularConditionalSnapshot,
  type HuggingFaceModularConditionalSnapshot,
} from '../studio/huggingFaceModularConditionals';
import { createLatestRequestGate, formatRequestError, requestJson } from '../utils/requestJson';

type HuggingFaceModularConditionalStore = {
  snapshot: HuggingFaceModularConditionalSnapshot | null;
  loaded: boolean;
  error: string | null;
  fetchSnapshot: () => Promise<void>;
};

const conditionalFetchGate = createLatestRequestGate<'conditional-snapshot'>();

export const useHuggingFaceModularConditionalStore = create<HuggingFaceModularConditionalStore>()((set) => ({
  snapshot: null,
  loaded: false,
  error: null,

  fetchSnapshot: async () => {
    const ticket = conditionalFetchGate.begin('conditional-snapshot');
    try {
      const snapshot = await requestJson(`${config.serverAddress}/huggingface/modular-conditionals`, {
        signal: ticket.signal,
        timeoutMs: 120_000,
        parse: parseHuggingFaceModularConditionalSnapshot,
      });
      if (!ticket.isLatest()) return;
      set({ snapshot, loaded: true, error: null });
    } catch (error) {
      if (!ticket.isLatest()) return;
      set({
        snapshot: null,
        loaded: true,
        error: formatRequestError(error, 'Could not load the reviewed Modular Diffusers conditional tree.'),
      });
    } finally {
      ticket.finish();
    }
  },
}));
