import { create } from 'zustand';
import config from '../../app.config';
import { normalizeBlockDefinitionV2, type BlockDefinitionV2 } from '../studio/blockSchemaV2';
import { blockDefinitionIsUserOwnedV2 } from '../studio/blockDefinitionPersistenceV2';
import type { UserBlockDefinition } from '../studio/types';
import { normalizeUserBlockDefinition } from '../studio/userBlocks';
import { enqueueSnackbar } from '../ui/snackbar';
import { createLatestRequestGate, formatRequestError, requestJson } from '../utils/requestJson';

type UserBlockStore = {
  blocks: UserBlockDefinition[];
  blockDefinitionsV2: BlockDefinitionV2[];
  loaded: boolean;
  error: string | null;
  revision: number;
  fetchBlocks: () => Promise<void>;
  saveBlock: (block: UserBlockDefinition) => Promise<UserBlockDefinition>;
  saveBlockDefinitionV2: (definition: BlockDefinitionV2) => Promise<BlockDefinitionV2>;
  upsertLocalBlock: (block: UserBlockDefinition) => void;
  upsertLocalBlockDefinitionV2: (definition: BlockDefinitionV2) => void;
  deleteBlock: (id: string) => Promise<void>;
  setBlocks: (blocks: UserBlockDefinition[]) => void;
  setBlockDefinitionsV2: (definitions: BlockDefinitionV2[]) => void;
};

const blockFetchGate = createLatestRequestGate<'blocks'>();
const blockMutationVersions = new Map<string, number>();
let nextBlockMutationVersion = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeBlocks(value: unknown): UserBlockDefinition[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
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
    )
    .map(normalizeUserBlockDefinition);
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
  const blocks: UserBlockDefinition[] = [];
  const blockDefinitionsV2: BlockDefinitionV2[] = [];
  payload.blocks.forEach((item) => {
    if (isRecord(item) && item.schemaVersion === 2) {
      blockDefinitionsV2.push(normalizeBlockDefinitionV2(item));
      return;
    }
    const block = safeBlocks([item])[0];
    if (!block) throw new Error('The user-block response contains an invalid block.');
    blocks.push(block);
  });
  return { blocks, blockDefinitionsV2 };
}

function parseSavedBlockResponse(value: unknown) {
  const payload = responseRecord(value, 'Could not save user block.');
  const block = safeBlocks([payload.block])[0];
  if (!block) throw new Error('The save response contains an invalid user block.');
  return block;
}

function parseSavedBlockDefinitionV2Response(value: unknown) {
  const payload = responseRecord(value, 'Could not save Block V2 definition.');
  return normalizeBlockDefinitionV2(payload.block);
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
  blockDefinitionsV2: [],
  loaded: false,
  error: null,
  revision: 0,

  setBlocks: (blocks) =>
    set((state) => ({
      blocks: blocks.map(normalizeUserBlockDefinition),
      loaded: true,
      error: null,
      revision: state.revision + 1,
    })),

  setBlockDefinitionsV2: (definitions) =>
    set((state) => ({
      blockDefinitionsV2: definitions.map(normalizeBlockDefinitionV2),
      loaded: true,
      error: null,
      revision: state.revision + 1,
    })),

  upsertLocalBlock: (block) =>
    set((state) => {
      const normalized = normalizeUserBlockDefinition(block);
      return {
        blocks: [normalized, ...state.blocks.filter((item) => item.id !== normalized.id)],
        loaded: true,
        error: null,
        revision: state.revision + 1,
      };
    }),

  upsertLocalBlockDefinitionV2: (definition) =>
    set((state) => {
      const normalized = normalizeBlockDefinitionV2(definition);
      return {
        blockDefinitionsV2: [
          normalized,
          ...state.blockDefinitionsV2.filter((item) => item.definitionId !== normalized.definitionId),
        ],
        loaded: true,
        error: null,
        revision: state.revision + 1,
      };
    }),

  fetchBlocks: async () => {
    const ticket = blockFetchGate.begin('blocks');
    const revision = get().revision;
    try {
      const response = await requestJson(`${config.serverAddress}/studio/blocks`, {
        signal: ticket.signal,
        parse: parseBlocksResponse,
      });
      if (!ticket.isLatest() || get().revision !== revision) return;
      set((state) => ({ ...response, loaded: true, error: null, revision: state.revision + 1 }));
    } catch (error) {
      if (!ticket.isLatest()) return;
      set({ loaded: true, error: formatRequestError(error, 'Could not load user blocks.') });
    } finally {
      ticket.finish();
    }
  },

  saveBlock: async (block) => {
    const normalizedBlock = normalizeUserBlockDefinition(block);
    const mutation = beginBlockMutation(normalizedBlock.id);
    const previousBlock = get().blocks.find((item) => item.id === normalizedBlock.id);
    get().upsertLocalBlock(normalizedBlock);
    try {
      const saved = await requestJson(`${config.serverAddress}/studio/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedBlock),
        parse: parseSavedBlockResponse,
      });
      if (mutation.isLatest()) get().upsertLocalBlock(saved);
      return saved;
    } catch (error) {
      const message = formatRequestError(error, 'Could not save user block.');
      if (mutation.isLatest()) {
        set((state) => ({
          blocks: previousBlock
            ? [previousBlock, ...state.blocks.filter((item) => item.id !== normalizedBlock.id)]
            : state.blocks.filter((item) => item.id !== normalizedBlock.id),
          error: message,
          revision: state.revision + 1,
        }));
      }
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 3600 });
      throw error;
    } finally {
      mutation.finish();
    }
  },

  saveBlockDefinitionV2: async (definition) => {
    const normalizedDefinition = normalizeBlockDefinitionV2(definition);
    if (!blockDefinitionIsUserOwnedV2(normalizedDefinition)) {
      throw new Error('Registered catalog definitions cannot be saved or overwritten through User Nodes.');
    }
    const id = normalizedDefinition.definitionId;
    const mutation = beginBlockMutation(id);
    const previousDefinition = get().blockDefinitionsV2.find((item) => item.definitionId === id);
    get().upsertLocalBlockDefinitionV2(normalizedDefinition);
    try {
      const saved = await requestJson(`${config.serverAddress}/studio/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedDefinition),
        parse: parseSavedBlockDefinitionV2Response,
      });
      if (mutation.isLatest()) get().upsertLocalBlockDefinitionV2(saved);
      return saved;
    } catch (error) {
      const message = formatRequestError(error, 'Could not save Block V2 definition.');
      if (mutation.isLatest()) {
        set((state) => ({
          blockDefinitionsV2: previousDefinition
            ? [previousDefinition, ...state.blockDefinitionsV2.filter((item) => item.definitionId !== id)]
            : state.blockDefinitionsV2.filter((item) => item.definitionId !== id),
          error: message,
          revision: state.revision + 1,
        }));
      }
      throw error;
    } finally {
      mutation.finish();
    }
  },

  deleteBlock: async (id) => {
    const mutation = beginBlockMutation(id);
    const previousBlock = get().blocks.find((item) => item.id === id);
    const previousDefinitionV2 = get().blockDefinitionsV2.find((item) => item.definitionId === id);
    set((state) => ({
      blocks: state.blocks.filter((item) => item.id !== id),
      blockDefinitionsV2: state.blockDefinitionsV2.filter((item) => item.definitionId !== id),
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
          blockDefinitionsV2:
            previousDefinitionV2 && !state.blockDefinitionsV2.some((item) => item.definitionId === id)
              ? [previousDefinitionV2, ...state.blockDefinitionsV2]
              : state.blockDefinitionsV2,
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
