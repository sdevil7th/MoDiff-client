import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { ModiffButton, ModiffFileInput } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { formatRequestError } from '../utils/requestJson';
import { readWorkflowJson } from '../workflow/readWorkflowJson';

export default function WorkflowFileImportButton({ onImported }: { onImported?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  async function openFile(file: File) {
    try {
      const { title, snapshot } = await readWorkflowJson(
        file,
        useSettingsStore.getState().edgeType,
        useStudioStore.getState().form,
      );
      useStudioStore.getState().createWorkflowTab(title, snapshot, 'import', file.name);
      onImported?.();
      useSettingsStore.getState().setRightPanelTab('studio');
      enqueueSnackbar('Workflow opened as a new tab', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Could not open the workflow.'), { variant: 'error' });
    }
  }
  return (
    <>
      <ModiffFileInput
        ref={input}
        className="hidden"
        aria-label="Workflow JSON file"
        accept=".json,application/json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void openFile(file);
        }}
      />
      <ModiffButton icon={<Upload size={14} />} onClick={() => input.current?.click()}>
        Import workflow file
      </ModiffButton>
    </>
  );
}
