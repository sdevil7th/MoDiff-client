import type { RuntimeStatus } from '../stores/useNodeStore';
import { StatusActionChip } from '../ui';

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

export function RuntimeEnvironmentCard({ error, status }: { error?: string | null; status: RuntimeStatus | null }) {
  const environment = status?.runtimeEnvironment;
  const selected = environment?.devices.find((item) => item.device === environment.defaultDevice);
  const ready = Boolean(status?.ready && environment?.executionReady);
  const experimental = environment?.supportTier === 'experimental';
  const installation = environment?.installation;
  const issueSummary = environment?.issues.map((issue) => issue.message).join(' ');
  const visibleSteps =
    installation?.steps?.filter((step) => step.status !== 'complete' && step.status !== 'skipped') ?? [];
  return (
    <section
      className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
      data-testid="runtime-environment-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-modiff-text">Runtime environment</h3>
        <StatusActionChip
          label={ready ? 'Ready' : 'Needs setup'}
          tone={ready ? 'success' : 'error'}
          title={error || issueSummary || environment?.status}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusActionChip
          label={`${environment?.installedProfile ?? 'Profile unverified'} · ${environment?.supportTier ?? 'unverified'}`}
          tone={experimental || !environment?.profileVerified ? 'warning' : 'neutral'}
          title={
            environment?.profileVerified
              ? `Requested: ${environment.requestedProfile ?? 'auto'}. Qualification: ${environment.supportTier}.`
              : 'Legacy backend: installation profile cannot be verified.'
          }
        />
        <StatusActionChip
          label={selected ? `${selected.backend} · ${selected.device}` : 'Detecting hardware'}
          tone={selected && selected.backend !== 'cpu' ? 'success' : 'neutral'}
          title={
            selected
              ? `${selected.name} · ${selected.vendor} · ${selected.memoryKind} memory`
              : 'Hardware has not been reported.'
          }
        />
        <StatusActionChip
          label={`Torch ${status?.packages?.torch?.version ?? 'unknown'}`}
          tone="neutral"
          title={`Torch ${status?.packages?.torch?.version ?? 'unknown'}`}
        />
      </div>
      {experimental && (
        <p className="mt-2 text-xs text-modiff-warning">
          Experimental means this host passed local checks but is not an advertised supported platform.
        </p>
      )}
      {visibleSteps.length > 0 && (
        <ol className="mt-3 grid gap-2" data-testid="runtime-installation-checklist">
          {visibleSteps.map((step, index) => (
            <li
              key={step.id ?? `${step.phase ?? 'step'}-${index}`}
              className="rounded-modiff-compact border border-modiff-border-subtle p-2 text-xs text-modiff-text"
            >
              <div className="font-semibold">
                {index + 1}. {step.title ?? step.id}
              </div>
              {step.explanation && <p className="mt-1 text-modiff-text-muted">{step.explanation}</p>}
              {step.requiresAdmin && <p className="mt-1 text-modiff-warning">Administrator approval required.</p>}
              {step.requiresReboot && (
                <p className="mt-1 text-modiff-warning">Resume after reboot or complete sign-out.</p>
              )}
              {step.command && (
                <div className="mt-2 flex items-start gap-2">
                  <code className="min-w-0 flex-1 select-all break-all text-modiff-text-muted">{step.command}</code>
                  <button
                    type="button"
                    className="rounded-modiff-compact border border-modiff-border px-2 py-1 font-semibold hover:bg-modiff-surface-hover"
                    onClick={() => copyText(step.command!)}
                  >
                    Copy
                  </button>
                </div>
              )}
              {step.verification && <p className="mt-1 text-modiff-text-muted">Verify: {step.verification}</p>}
              {step.failureHelp && <p className="mt-1 text-modiff-text-muted">{step.failureHelp}</p>}
            </li>
          ))}
        </ol>
      )}
      {installation?.resumeCommand && installation.status !== 'complete' && (
        <div className="mt-2 flex items-start gap-2">
          <code className="min-w-0 flex-1 select-all break-all text-xs text-modiff-text-muted">
            {installation.resumeCommand}
          </code>
          <button
            type="button"
            className="rounded-modiff-compact border border-modiff-border px-2 py-1 text-xs font-semibold hover:bg-modiff-surface-hover"
            onClick={() => copyText(installation.resumeCommand!)}
          >
            Copy resume
          </button>
        </div>
      )}
      {!installation?.resumeCommand && environment?.repairCommand && !ready && (
        <code className="mt-2 block select-all break-all text-xs text-modiff-text-muted">
          {environment.repairCommand}
        </code>
      )}
    </section>
  );
}
