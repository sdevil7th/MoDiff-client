import type { WorkflowTabSnapshot } from './types';

export type WorkflowFileSaveResult = 'saved' | 'downloaded' | 'cancelled';

type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
};

type WritableFileStream = {
  close: () => Promise<void>;
  write: (data: Blob) => Promise<void>;
};

type SaveFileHandle = {
  createWritable: () => Promise<WritableFileStream>;
};

type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;
};

export function workflowFilename(title: string) {
  const stem = title
    .trim()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return `${stem || 'workflow'}.json`;
}

function downloadWorkflow(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isPickerCancellation(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Save a portable MoDiff workflow snapshot. The native picker is preferred
 * because it lets the user choose an exact local path without exposing that
 * path to MoDiff. Browsers without the API fall back to a normal download.
 */
export async function saveWorkflowSnapshotFile(
  title: string,
  snapshot: WorkflowTabSnapshot,
): Promise<WorkflowFileSaveResult> {
  const filename = workflowFilename(title);
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const picker = (window as WindowWithSaveFilePicker).showSaveFilePicker;

  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName: filename,
        types: [
          {
            description: 'MoDiff workflow',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (error) {
      if (isPickerCancellation(error)) return 'cancelled';
      throw error;
    }
  }

  downloadWorkflow(filename, blob);
  return 'downloaded';
}
