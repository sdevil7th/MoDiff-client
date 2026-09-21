import { ModiffDialog } from '../ui';
import type { ExtensionSource } from '../studio/customExtensions';
import CustomExtensionsPanel from './CustomExtensionsPanel';

export default function CustomExtensionsDialog({
  onClose,
  initialKind,
}: {
  onClose: () => void;
  initialKind?: ExtensionSource['kind'];
}) {
  return (
    <ModiffDialog
      open
      onClose={onClose}
      title="Custom nodes"
      panelClassName="max-w-2xl"
      testId="custom-extensions-dialog"
    >
      <CustomExtensionsPanel initialKind={initialKind} />
    </ModiffDialog>
  );
}
