import { AlertCircle, LoaderCircle, RotateCw } from 'lucide-react';
import { ModiffButton, ModiffDialog, ModiffStatusOverlay } from '../ui';

type StartupWorkspaceGateProps = {
  error?: string | null;
  phase: string;
  retry: () => void;
  dismiss?: () => void;
};

export default function StartupWorkspaceGate({ dismiss, error, phase, retry }: StartupWorkspaceGateProps) {
  const content = (
    <div className="flex items-start gap-3" role={error ? 'alert' : undefined}>
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-modiff-panel">
        {error ? (
          <AlertCircle size={20} className="text-modiff-red" aria-hidden="true" />
        ) : (
          <LoaderCircle size={20} className="animate-spin text-hf-yellow" aria-hidden="true" />
        )}
      </span>
      <p className="min-w-0 flex-1 text-sm text-modiff-subtle-text">{error || phase}</p>
    </div>
  );
  if (!error) {
    return (
      <ModiffStatusOverlay title="Loading workspace" testId="startup-workspace-gate">
        {content}
      </ModiffStatusOverlay>
    );
  }
  const canDismiss = Boolean(error && dismiss);
  return (
    <ModiffDialog
      open
      onClose={dismiss ?? (() => undefined)}
      title={error ? 'Could not finish loading' : 'Loading workspace'}
      testId="startup-workspace-gate"
      panelClassName="max-w-sm"
      bodyClassName="min-h-0"
      dismissible={canDismiss}
      closeLabel="Close loading error and start with an empty workflow"
      footer={
        error ? (
          <ModiffButton tone="primary" icon={<RotateCw size={15} />} onClick={retry}>
            Retry
          </ModiffButton>
        ) : undefined
      }
    >
      {content}
    </ModiffDialog>
  );
}
