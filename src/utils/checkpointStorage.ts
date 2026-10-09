import type { StateStorage } from 'zustand/middleware';
import { closeSnackbar, enqueueSnackbar } from '../ui/snackbar';

const CHECKPOINT_WRITE_WARNING_KEY = 'studio-checkpoint-write-failed';
const failedCheckpointKeys = new Set<string>();

function checkpointRecovered(name: string) {
  if (failedCheckpointKeys.delete(name) && failedCheckpointKeys.size === 0) {
    closeSnackbar(CHECKPOINT_WRITE_WARNING_KEY);
  }
}

/** Keep workspace mutations usable when a browser checkpoint cannot be written. */
export function createResilientCheckpointStorage(): StateStorage {
  // Resolve here so createJSONStorage preserves its usual unavailable-storage
  // behavior during SSR. Each method still reads the storage object's current API.
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
        const firstFailure = failedCheckpointKeys.size === 0;
        if (!failedCheckpointKeys.has(name)) {
          console.warn('Could not update the local workspace checkpoint.', name, error);
        }
        failedCheckpointKeys.add(name);
        if (firstFailure) {
          enqueueSnackbar(
            'Changes could not be stored in this browser. Save or export unsaved workflows before refreshing.',
            { key: CHECKPOINT_WRITE_WARNING_KEY, variant: 'warning', persist: true },
          );
        }
      }
    },
  };
}
