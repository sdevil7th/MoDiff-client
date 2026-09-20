import { create } from 'zustand';
import config from '../../app.config';
import { parseRegisteredBlockInterfaces, type RegisteredBlockInterface } from '../studio/registeredBlockInterfaces';
import { formatRequestError, requestJson } from '../utils/requestJson';

type State = {
  entries: RegisteredBlockInterface[];
  loaded: boolean;
  error: string | null;
  fetch: () => Promise<void>;
};
let pending: Promise<void> | null = null;
export const useRegisteredBlockInterfacesStore = create<State>((set) => ({
  entries: [],
  loaded: false,
  error: null,
  fetch: () => {
    if (pending) return pending;
    pending = (async () => {
      try {
        const entries = await requestJson(`${config.serverAddress}/huggingface/registered-block-interfaces`, {
          parse: parseRegisteredBlockInterfaces,
          timeoutMs: 30000,
        });
        set({ entries, loaded: true, error: null });
      } catch (error) {
        set({ entries: [], loaded: true, error: formatRequestError(error, 'Could not load Block interfaces.') });
      }
    })().finally(() => {
      pending = null;
    });
    return pending;
  },
}));
