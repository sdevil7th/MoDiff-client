import { FileJson2, Folder } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ModiffButton, ModiffDialog, ModiffFieldShell, ModiffInput, ModiffRadioCardGroup } from '../ui';

export type WorkflowSaveDestination = 'library' | 'file';

type WorkflowSaveDialogProps = {
  initialDestination?: WorkflowSaveDestination;
  initialName: string;
  loading?: boolean;
  onClose: () => void;
  onSave: (name: string, destination: WorkflowSaveDestination) => void;
  open: boolean;
};

const destinationOptions = [
  {
    value: 'library',
    label: 'My workflows',
    description: 'Create a named workflow in MoDiff that stays available across sessions.',
    meta: 'Recommended',
  },
  {
    value: 'file',
    label: 'JSON file',
    description: 'Choose a folder and filename on this device. Unsupported browsers use Downloads.',
  },
] as const;

export default function WorkflowSaveDialog({
  initialDestination = 'library',
  initialName,
  loading = false,
  onClose,
  onSave,
  open,
}: WorkflowSaveDialogProps) {
  const [name, setName] = useState(initialName);
  const [destination, setDestination] = useState<WorkflowSaveDestination>(initialDestination);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDestination(initialDestination);
  }, [initialDestination, initialName, open]);

  const trimmedName = name.trim();

  return (
    <ModiffDialog
      open={open}
      onClose={loading ? () => undefined : onClose}
      title="Save workflow as"
      testId="save-workflow-dialog"
      panelClassName="max-w-lg"
      footer={
        <>
          <ModiffButton disabled={loading} onClick={onClose}>
            Cancel
          </ModiffButton>
          <ModiffButton
            data-testid="confirm-save-workflow"
            disabled={!trimmedName}
            loading={loading}
            onClick={() => onSave(trimmedName, destination)}
            tone="primary"
            icon={destination === 'library' ? <Folder size={16} /> : <FileJson2 size={16} />}
          >
            {destination === 'library' ? 'Save to My workflows' : 'Choose location'}
          </ModiffButton>
        </>
      }
    >
      <div className="grid gap-4">
        <ModiffFieldShell
          label="Workflow name"
          description={
            destination === 'file'
              ? 'This name is used as the suggested JSON filename.'
              : 'You can rename it later from My workflows.'
          }
          required
        >
          <ModiffInput
            autoFocus
            data-testid="save-workflow-name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmedName && !loading) {
                event.preventDefault();
                onSave(trimmedName, destination);
              }
            }}
          />
        </ModiffFieldShell>
        <ModiffFieldShell label="Save to">
          <ModiffRadioCardGroup
            aria-label="Workflow save destination"
            disabled={loading}
            value={destination}
            onValueChange={(value) => setDestination(value as WorkflowSaveDestination)}
            options={destinationOptions}
          />
        </ModiffFieldShell>
        <p className="text-modiff-metadata leading-5 text-modiff-subtle-text">
          MoDiff keeps recovery snapshots automatically. Save creates a named workflow; saving a JSON copy is for
          portable backups and sharing.
        </p>
      </div>
    </ModiffDialog>
  );
}
