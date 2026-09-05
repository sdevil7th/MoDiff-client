import { create } from 'zustand';
import config from '../../app.config';
import { parseHuggingFaceNodeLibrary, type HuggingFaceNodeLibrary } from '../studio/huggingFaceNodeLibrary';
import { createLatestRequestGate, formatRequestError, requestJson } from '../utils/requestJson';

type HuggingFaceNodeLibraryStore = {
  library: HuggingFaceNodeLibrary | null;
  loaded: boolean;
  error: string | null;
  fetchLibrary: () => Promise<void>;
};

const libraryFetchGate = createLatestRequestGate<'library'>();

export const useHuggingFaceNodeLibraryStore = create<HuggingFaceNodeLibraryStore>()((set) => ({
  library: null,
  loaded: false,
  error: null,

  fetchLibrary: async () => {
    const ticket = libraryFetchGate.begin('library');
    try {
      const library = await requestJson(`${config.serverAddress}/huggingface/node-library`, {
        signal: ticket.signal,
        timeoutMs: 120_000,
        parse: parseHuggingFaceNodeLibrary,
      });
      if (!ticket.isLatest()) return;
      set({ library, loaded: true, error: null });
    } catch (error) {
      if (!ticket.isLatest()) return;
      set({
        library: null,
        loaded: true,
        error: formatRequestError(error, 'Could not load the Hugging Face node library.'),
      });
    } finally {
      ticket.finish();
    }
  },
}));
