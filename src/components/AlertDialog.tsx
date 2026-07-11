import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cx } from '../utils/classNames';

type AlertDialogOpener = {
  title: string | null;
  message: string;
  confirmText: string | null;
  cancelText: string | null;
  onConfirm: () => void;
  onCancel?: () => void | null;
} | null;

function AlertButton({
  children,
  onClick,
  tone = 'secondary',
}: {
  children: string;
  onClick: () => void;
  tone?: 'primary' | 'secondary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex h-8 items-center justify-center px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
        tone === 'primary' && 'bg-hf-yellow text-black hover:bg-hf-orange',
        tone === 'secondary' &&
          'border border-modiff-border bg-modiff-surface text-gray-200 hover:border-hf-yellow/70 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

function AlertDialog({ opener, onClose }: { opener: AlertDialogOpener; onClose: () => void }) {
  const handleCancel = () => {
    opener?.onCancel?.();
    onClose();
  };

  const handleConfirm = () => {
    opener?.onConfirm();
    onClose();
  };

  useEffect(() => {
    if (!opener) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, opener]);

  if (!opener) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={opener.title ? 'modiff-alert-title' : undefined}
        aria-describedby="modiff-alert-message"
        className="w-full max-w-lg border border-modiff-border bg-modiff-surface shadow-modiff-node"
      >
        {opener.title && (
          <header className="flex items-center gap-3 border-b border-modiff-border bg-modiff-panel px-4 py-3">
            <AlertTriangle size={28} className="flex-none text-hf-orange" />
            <h2 id="modiff-alert-title" className="min-w-0 truncate text-lg font-bold text-modiff-text">
              {opener.title}
            </h2>
          </header>
        )}
        <div className="px-4 py-4">
          <p id="modiff-alert-message" className="text-sm leading-6 text-modiff-text">
            {opener.message}
          </p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-modiff-border px-4 py-3">
          <AlertButton onClick={handleCancel}>{opener.cancelText || 'Cancel'}</AlertButton>
          <AlertButton onClick={handleConfirm} tone="primary">
            {opener.confirmText || 'Confirm'}
          </AlertButton>
        </footer>
      </section>
    </div>
  );
}

export default AlertDialog;
