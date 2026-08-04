import { AlertCircle, LoaderCircle, RotateCw } from 'lucide-react';
import { ModiffButton } from '../ui';

type StartupWorkspaceGateProps = {
  error?: string | null;
  phase: string;
  retry: () => void;
};

export default function StartupWorkspaceGate({ error, phase, retry }: StartupWorkspaceGateProps) {
  return (
    <div
      className="fixed inset-0 z-[200] grid place-items-center bg-modiff-dialog-backdrop/85 p-6 backdrop-blur-sm"
      data-testid="startup-workspace-gate"
      role={error ? 'alertdialog' : 'status'}
      aria-busy={!error}
      aria-live="polite"
      aria-label={error ? 'Workspace loading failed' : 'Loading workspace'}
    >
      <div className="w-full max-w-sm rounded-modiff-panel border border-modiff-border bg-modiff-surface p-5 text-modiff-text shadow-modiff-node">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-modiff-panel">
            {error ? (
              <AlertCircle size={20} className="text-modiff-red" aria-hidden="true" />
            ) : (
              <LoaderCircle size={20} className="animate-spin text-hf-yellow" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">{error ? 'Could not finish loading' : 'Loading workspace'}</h2>
            <p className="mt-1 text-sm text-modiff-subtle-text">{error || phase}</p>
          </div>
        </div>
        {error ? (
          <div className="mt-4 flex justify-end">
            <ModiffButton tone="primary" icon={<RotateCw size={15} />} onClick={retry}>
              Retry
            </ModiffButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
