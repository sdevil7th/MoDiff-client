// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { AlertTriangle } from 'lucide-react';
import { ModiffButton, ModiffDialog } from '../ui';

type AlertDialogOpener = {
  title: string | null;
  message: string;
  confirmText: string | null;
  cancelText: string | null;
  onConfirm: () => void;
  onCancel?: () => void | null;
} | null;

function AlertDialog({ opener, onClose }: { opener: AlertDialogOpener; onClose: () => void }) {
  const handleCancel = () => {
    opener?.onCancel?.();
    onClose();
  };

  const handleConfirm = () => {
    opener?.onConfirm();
    onClose();
  };

  if (!opener) return null;

  return (
    <ModiffDialog
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle size={20} className="shrink-0 text-modiff-warning" aria-hidden="true" />
          <span>{opener.title || 'Confirm action'}</span>
        </span>
      }
      panelClassName="max-w-lg"
      footer={
        <>
          <ModiffButton onClick={handleCancel}>{opener.cancelText || 'Cancel'}</ModiffButton>
          <ModiffButton onClick={handleConfirm} tone="primary">
            {opener.confirmText || 'Confirm'}
          </ModiffButton>
        </>
      }
    >
      <p className="text-sm leading-6 text-modiff-text">{opener.message}</p>
    </ModiffDialog>
  );
}

export default AlertDialog;
