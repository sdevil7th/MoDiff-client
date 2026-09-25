import { ModiffDialog } from '../ui';
import type { ExtensionSource } from '../studio/customExtensions';
import CustomExtensionsPanel from './CustomExtensionsPanel';

export default function CustomExtensionsDialog({
  onClose,
  initialKind,
  initialView,
}: {
  onClose: () => void;
  initialKind?: ExtensionSource['kind'];
  initialView?: 'add' | 'manage';
}) {
  return (
    <ModiffDialog
      open
      onClose={onClose}
      title={initialView === 'manage' ? 'Manage custom nodes' : 'Add custom node'}
      panelClassName="max-w-2xl"
      testId="custom-extensions-dialog"
    >
      <CustomExtensionsPanel initialKind={initialKind} initialView={initialView} />
    </ModiffDialog>
  );
}
