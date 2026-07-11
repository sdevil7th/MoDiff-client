import { create } from 'zustand';
import config from '../../app.config';
import type { UserBlockDefinition } from '../studio/types';
import { enqueueSnackbar } from '../ui/snackbar';
import { createLatestRequestGate, formatRequestError, requestJson } from '../utils/requestJson';

type UserBlockStore = {
  blocks: UserBlockDefinition[];
  loaded: boolean;
  error: string | null;
  revision: number;
  fetchBlocks: () => Promise<void>;
  saveBlock: (block: UserBlockDefinition) => Promise<UserBlockDefinition>;
  upsertLocalBlock: (block: UserBlockDefinition) => void;
  deleteBlock: (id: string) => Promise<void>;
  setBlocks: (blocks: UserBlockDefinition[]) => void;
};

const blockFetchGate = createLatestRequestGate<'blocks'>();
const blockMutationVersions = new Map<string, number>();
let nextBlockMutationVersion = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeBlocks(value: unknown): UserBlockDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is UserBlockDefinition =>
      isRecord(item) &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      item.version === 1 &&
      Array.isArray(item.nodes) &&
      Array.isArray(item.edges) &&
      Array.isArray(item.inputs) &&
      Array.isArray(item.outputs) &&
      Array.isArray(item.exposedParams),
  );
}

function responseRecord(value: unknown, fallbackMessage: string) {
  if (!isRecord(value)) throw new Error(fallbackMessage);
  if (value.error) {
    throw new Error(typeof value.message === 'string' ? value.message : fallbackMessage);
  }
  return value;
}

function parseBlocksResponse(value: unknown) {
  const payload = responseRecord(value, 'Could not load user blocks.');
  if (!Array.isArray(payload.blocks)) throw new Error('The user-block response has no blocks array.');
  const blocks = safeBlocks(payload.blocks);
  if (blocks.length !== payload.blocks.length) throw new Error('The user-block response contains an invalid block.');
  return blocks;
}

function parseSavedBlockResponse(value: unknown) {
  const payload = responseRecord(value, 'Could not save user block.');
  const block = safeBlocks([payload.block])[0];
  if (!block) throw new Error('The save response contains an invalid user block.');
  return block;
}

function beginBlockMutation(id: string) {
  const version = ++nextBlockMutationVersion;
  blockMutationVersions.set(id, version);
  return {
    isLatest: () => blockMutationVersions.get(id) === version,
    finish: () => {
      if (blockMutationVersions.get(id) === version) blockMutationVersions.delete(id);
    },
  };
}

export const useUserBlockStore = create<UserBlockStore>()((set, get) => ({
  blocks: [],
  loaded: false,
  error: null,
  revision: 0,

  setBlocks: (blocks) => set((state) => ({ blocks, loaded: true, error: null, revision: state.revision + 1 })),

  upsertLocalBlock: (block) =>
    set((state) => ({
      blocks: [block, ...state.blocks.filter((item) => item.id !== block.id)],
      loaded: true,
      error: null,
      revision: state.revision + 1,
    })),

  fetchBlocks: async () => {
    const ticket = blockFetchGate.begin('blocks');
    const revision = get().revision;
    try {
      const blocks = await requestJson(`${config.serverAddress}/studio/blocks`, {
        signal: ticket.signal,
        parse: parseBlocksResponse,
      });
      if (!ticket.isLatest() || get().revision !== revision) return;
      set((state) => ({ blocks, loaded: true, error: null, revision: state.revision + 1 }));
    } catch (error) {
      if (!ticket.isLatest()) return;
      set({ loaded: true, error: formatRequestError(error, 'Could not load user blocks.') });
    } finally {
      ticket.finish();
    }
  },

  saveBlock: async (block) => {
    const mutation = beginBlockMutation(block.id);
    get().upsertLocalBlock(block);
    try {
      const saved = await requestJson(`${config.serverAddress}/studio/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(block),
        parse: parseSavedBlockResponse,
      });
      if (mutation.isLatest()) get().upsertLocalBlock(saved);
      return saved;
    } catch (error) {
      const message = formatRequestError(error, 'Could not save user block.');
      if (mutation.isLatest()) set({ error: message });
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 3600 });
      throw error;
    } finally {
      mutation.finish();
    }
  },

  deleteBlock: async (id) => {
    const mutation = beginBlockMutation(id);
    const previousBlock = get().blocks.find((item) => item.id === id);
    set((state) => ({
      blocks: state.blocks.filter((item) => item.id !== id),
      revision: state.revision + 1,
    }));
    try {
      await requestJson(`${config.serverAddress}/studio/blocks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        parse: (value) => responseRecord(value, 'Could not delete user block.'),
      });
      if (mutation.isLatest()) set({ error: null });
    } catch (error) {
      const message = formatRequestError(error, 'Could not delete user block.');
      if (mutation.isLatest()) {
        set((state) => ({
          blocks:
            previousBlock && !state.blocks.some((item) => item.id === id)
              ? [previousBlock, ...state.blocks]
              : state.blocks,
          revision: state.revision + 1,
          error: message,
        }));
      }
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 3600 });
      throw error;
    } finally {
      mutation.finish();
    }
  },
}));
