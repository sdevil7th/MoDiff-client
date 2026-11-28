import type { StateStorage } from 'zustand/middleware';
import { closeSnackbar, enqueueSnackbar } from '../ui/snackbar';

const CHECKPOINT_WRITE_WARNING_KEY = 'studio-checkpoint-write-failed';
const failedCheckpointKeys = new Set<string>();

function checkpointRecovered(name: string) {
  if (failedCheckpointKeys.delete(name) && failedCheckpointKeys.size === 0) {
    closeSnackbar(CHECKPOINT_WRITE_WARNING_KEY);
  }
}

function checkpointFailed(name: string, error: unknown) {
  const firstFailure = failedCheckpointKeys.size === 0;
  if (!failedCheckpointKeys.has(name)) console.warn('Could not update the local workspace checkpoint.', name, error);
  failedCheckpointKeys.add(name);
  if (firstFailure) {
    enqueueSnackbar(
      'Changes could not be stored in this browser. Save or export unsaved workflows before refreshing.',
      { key: CHECKPOINT_WRITE_WARNING_KEY, variant: 'warning', persist: true },
    );
  }
}

/** Keep shared preferences usable when their browser checkpoint cannot be written. */
export function createResilientCheckpointStorage(): StateStorage {
  // Resolve here so createJSONStorage preserves its usual unavailable-storage behavior during SSR.
  const storage = localStorage;
  return {
    getItem: (name) => storage.getItem(name),
    removeItem: (name) => {
      storage.removeItem(name);
      checkpointRecovered(name);
    },
    setItem: (name, value) => {
      try {
        storage.setItem(name, value);
        checkpointRecovered(name);
      } catch (error) {
        checkpointFailed(name, error);
      }
    },
  };
}

/** A browser page owns its workspace; shared old checkpoints are recovery input only. */
export function createPageCheckpointStorage(legacyKey: string): StateStorage {
  // Browser storage getters may throw. SSR still takes createJSONStorage's normal unavailable path.
  if (typeof window === 'undefined' || !('sessionStorage' in window))
    throw new Error('Page checkpoint storage is unavailable outside a browser.');
  let storage: Storage | undefined;
  let unavailable: unknown;
  try {
    storage = window.sessionStorage;
  } catch (error) {
    unavailable = error;
  }
  const initialized = new Set<string>();
  const recoveryKey = (name: string) => `${name}.legacy-recovered.v1`;
  function pageStorage() {
    if (!storage) throw unavailable ?? new Error('Page checkpoint storage is unavailable.');
    return storage;
  }
  return {
    getItem: (name) => {
      try {
        const page = pageStorage();
        const current = page.getItem(name);
        if (current !== null) return current;
        if (initialized.has(name) || page.getItem(recoveryKey(name)) !== null) return null;
        initialized.add(name);
        // Prefer the current key over its legacy alias. Copy bytes exactly; never mutate either shared key.
        let recovered: string | null = null;
        try {
          recovered = window.localStorage.getItem(name) ?? window.localStorage.getItem(legacyKey);
        } catch {
          /* A new page can still work when old shared recovery storage is inaccessible. */
        }
        try {
          if (recovered !== null) page.setItem(name, recovered);
          page.setItem(recoveryKey(name), '1');
          checkpointRecovered(name);
        } catch (error) {
          checkpointFailed(name, error);
        }
        return recovered;
      } catch (error) {
        checkpointFailed(name, error);
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        pageStorage().setItem(name, value);
        checkpointRecovered(name);
      } catch (error) {
        checkpointFailed(name, error);
      }
    },
    removeItem: (name) => {
      initialized.add(name);
      try {
        const page = pageStorage();
        page.setItem(recoveryKey(name), '1');
        page.removeItem(name);
        checkpointRecovered(name);
      } catch (error) {
        checkpointFailed(name, error);
      }
    },
  };
}
