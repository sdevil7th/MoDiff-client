import { useCallback, useEffect, useRef, useState } from 'react';
import config from '../../app.config';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  parseOptionalRuntimeJobResponse,
  parseOptionalRuntimeMutation,
  stagedOptionalRuntimeEnvironment,
  type OptionalRuntimeCatalog,
  type OptionalRuntimeJob,
  type OptionalRuntimeProfileStatus,
} from '../studio/optionalRuntimes';
import { formatRequestError, requestJson } from '../utils/requestJson';
import { enqueueSnackbar, ModiffButton, ModiffDisclosure } from '../ui';
import {
  parseOptimizationCatalog,
  parseOptimizationMutationResponse,
  parseOptimizationReceipts,
  safeOptimizationDocumentationUrl,
  type OptimizationCatalog,
  type OptimizationReceipt,
} from '../studio/runtimeOptimizations';

function post<T>(path: string, body: Record<string, unknown>, parse: (value: unknown) => T) {
  return requestJson(`${config.serverAddress}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
    parse,
  });
}

function optionalRuntimeStatus(
  profile: OptionalRuntimeProfileStatus,
  process: OptionalRuntimeCatalog['processLoadStatus'],
) {
  const qualified =
    process === 'active' &&
    profile.overlayStatus === 'active' &&
    profile.cutoverReady &&
    profile.contractState === 'qualified';
  const state =
    process !== 'active' && process !== 'base'
      ? process
      : qualified
        ? 'active'
        : profile.contractState !== 'qualified' || !profile.cutoverReady
          ? 'unavailable'
          : profile.overlayStatus;
  return `${state.replace(/_/g, ' ')}${state === 'unavailable' ? ` (${profile.contractState})` : ''}.`;
}

function optionalRuntimeTarget(profile: OptionalRuntimeProfileStatus) {
  const platform = profile.platform === 'macos' ? 'macOS' : profile.platform === 'windows' ? 'Windows' : 'Linux';
  const machine = profile.machine === 'arm64' ? 'ARM64' : 'x86-64';
  return `${platform} ${machine}`;
}

export default function RuntimeOptimizationsCard() {
  const optionalRuntimeCatalog = useNodesStore((state) => state.optionalRuntimeCatalog);
  const optionalRuntimeRequest = useNodesStore((state) => state.discoveryRequests.optionalRuntimes);
  const fetchOptionalRuntimes = useNodesStore((state) => state.fetchOptionalRuntimes);
  const setAlertOpener = useSettingsStore((state) => state.setAlertOpener);
  const [catalog, setCatalog] = useState<OptimizationCatalog | null>(null);
  const [receipts, setReceipts] = useState<OptimizationReceipt[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runtimeJob, setRuntimeJob] = useState<OptionalRuntimeJob | null>(null);
  const refreshRevision = useRef(0);
  const mutationInFlight = useRef(false);
  const runtimePolls = useRef(0);

  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    setLoading(true);
    try {
      const [nextCatalog, nextReceipts] = await Promise.all([
        requestJson(`${config.serverAddress}/runtime/optimizations`, {
          timeoutMs: 15_000,
          parse: parseOptimizationCatalog,
        }),
        requestJson(`${config.serverAddress}/runtime/optimizations/receipts`, {
          timeoutMs: 15_000,
          parse: parseOptimizationReceipts,
        }),
      ]);
      if (revision !== refreshRevision.current) return;
      setCatalog(nextCatalog);
      setReceipts(nextReceipts.receipts);
      setLoadError(null);
    } catch (error) {
      if (revision === refreshRevision.current) {
        setLoadError(formatRequestError(error, 'Could not load runtime optimizations.'));
      }
      throw error;
    } finally {
      if (revision === refreshRevision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!runtimeJob || ['cancelled', 'failed', 'ready'].includes(runtimeJob.status)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (++runtimePolls.current > 2400) {
        enqueueSnackbar('Runtime setup polling stopped. Refresh status to continue.', { variant: 'warning' });
        return;
      }
      try {
        const next = await requestJson(
          `${config.serverAddress}/runtime/optional-runtimes/jobs/${encodeURIComponent(runtimeJob.id)}`,
          { signal: controller.signal, parse: parseOptionalRuntimeJobResponse },
        );
        if (
          next.id !== runtimeJob.id ||
          next.profileId !== runtimeJob.profileId ||
          next.specDigest !== runtimeJob.specDigest
        )
          throw new Error('The optional-runtime job identity changed.');
        setRuntimeJob(next);
        if (['cancelled', 'failed', 'ready'].includes(next.status)) void fetchOptionalRuntimes();
      } catch {
        if (!controller.signal.aborted) {
          setRuntimeJob({ ...runtimeJob });
        }
      }
    }, 750);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [fetchOptionalRuntimes, runtimeJob]);

  const runAction = async (busyKey: string, action: () => Promise<void>) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusyId(busyKey);
    try {
      await action();
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Action failed.'), { variant: 'error' });
    } finally {
      mutationInFlight.current = false;
      setBusyId(null);
    }
  };

  const mutate = (busyKey: string, path: string, body: Record<string, unknown>) =>
    runAction(busyKey, async () => {
      const response = await post(path, body, parseOptimizationMutationResponse);
      enqueueSnackbar(response.message ?? 'Updated.', { variant: 'success' });
      void refresh().catch(() => undefined);
    });

  const consent = (title: string, message: string, confirmText: string, action: () => Promise<void>) =>
    setAlertOpener({
      title,
      message,
      confirmText,
      cancelText: 'Cancel',
      onConfirm: () => {
        setAlertOpener(null);
        void runAction(confirmText.toLowerCase(), action);
      },
      onCancel: () => setAlertOpener(null),
    });

  const changeRuntime = (profile: OptionalRuntimeProfileStatus, environmentId?: string) => {
    const label = environmentId ? 'Activate' : profile.overlayStatus === 'repair_required' ? 'Repair' : 'Install';
    consent(
      `${label} optional runtime?`,
      environmentId
        ? `Activate validated ${profile.label} and restart MoDiff.`
        : `Install ${profile.label} from reviewed, locked artifacts. Activation is separate.`,
      label,
      environmentId
        ? async () => {
            const result = await post(
              '/runtime/optional-runtimes/activate',
              { environmentId, profileId: profile.id, specDigest: profile.specDigest, consent: true },
              parseOptionalRuntimeMutation,
            );
            enqueueSnackbar(result.message ?? 'Activation selected.', { variant: 'success' });
            setRuntimeJob(null);
            await fetchOptionalRuntimes();
          }
        : async () => {
            const job = await post(
              '/runtime/optional-runtimes/install',
              { profileId: profile.id, specDigest: profile.specDigest, consent: true },
              parseOptionalRuntimeJobResponse,
            );
            if (job.profileId !== profile.id || job.specDigest !== profile.specDigest)
              throw new Error('Runtime job mismatch.');
            runtimePolls.current = 0;
            setRuntimeJob(job);
            await fetchOptionalRuntimes();
          },
    );
  };

  const cancelRuntime = () => {
    if (!runtimeJob) return;
    void runAction('cancel', async () => {
      const job = await post(
        `/runtime/optional-runtimes/jobs/${encodeURIComponent(runtimeJob.id)}/cancel`,
        {},
        parseOptionalRuntimeJobResponse,
      );
      if (job.id !== runtimeJob.id) throw new Error('The cancellation response does not match the active job.');
      setRuntimeJob(job);
      if (['cancelled', 'failed'].includes(job.status)) await fetchOptionalRuntimes();
    });
  };

  const observedReceipts = receipts.filter((receipt) => receipt.kind === 'workload' && receipt.status === 'observed');

  return (
    <section className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3">
      <div className="grid gap-1 pb-2">
        <strong>Optional runtimes</strong>
        {optionalRuntimeRequest.error ? (
          <p className="text-xs text-modiff-warning">{optionalRuntimeRequest.error}</p>
        ) : optionalRuntimeRequest.status === 'loading' ? (
          <p className="text-xs text-modiff-subtle-text">Loading optional runtimes...</p>
        ) : optionalRuntimeRequest.status === 'success' && optionalRuntimeCatalog ? (
          optionalRuntimeCatalog.profiles.map((profile) => {
            const staged = stagedOptionalRuntimeEnvironment(optionalRuntimeCatalog, profile);
            const completedEnvironment =
              runtimeJob?.profileId === profile.id && runtimeJob.specDigest === profile.specDigest
                ? runtimeJob.result?.environmentId
                : undefined;
            const canAct = profile.contractState === 'qualified' && profile.cutoverReady;
            const environmentId = completedEnvironment ?? staged;
            const action = environmentId
              ? 'Activate'
              : profile.overlayStatus === 'repair_required'
                ? 'Repair'
                : 'Install';
            const actionable =
              canAct &&
              (environmentId
                ? profile.activationAvailable
                : profile.installActionAvailable && profile.overlayStatus !== 'active');
            return (
              <div key={profile.id} className="grid gap-1 text-xs text-modiff-text">
                <span>
                  {profile.label} ({optionalRuntimeTarget(profile)}):{' '}
                  {optionalRuntimeStatus(profile, optionalRuntimeCatalog.processLoadStatus)}
                </span>
                {runtimeJob?.profileId === profile.id ? (
                  <div className="flex items-center gap-2" data-testid="optional-runtime-progress">
                    <span>{runtimeJob.progress.message}</span>
                    {['queued', 'running'].includes(runtimeJob.status) ? (
                      <ModiffButton size="compact" disabled={busyId !== null} onClick={cancelRuntime}>
                        Cancel
                      </ModiffButton>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex gap-1.5">
                  {actionable ? (
                    <ModiffButton
                      size="compact"
                      disabled={busyId !== null || optionalRuntimeCatalog.installBusy}
                      loading={busyId === action.toLowerCase()}
                      onClick={() => changeRuntime(profile, environmentId)}
                    >
                      {action}
                    </ModiffButton>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-modiff-subtle-text">No optional runtimes.</p>
        )}
        {optionalRuntimeCatalog?.previousEnvironmentId &&
        optionalRuntimeCatalog.profiles.some(
          (profile) => profile.activationAvailable && profile.cutoverReady && profile.contractState === 'qualified',
        ) ? (
          <ModiffButton
            size="compact"
            disabled={busyId !== null || optionalRuntimeCatalog.installBusy}
            loading={busyId === 'rollback'}
            onClick={() =>
              consent(
                'Roll back optional runtime?',
                'Select the previous validated optional environment and restart MoDiff. Active and queued runs must be stopped first.',
                'Rollback',
                async () => {
                  const result = await post(
                    '/runtime/optional-runtimes/rollback',
                    { consent: true },
                    parseOptionalRuntimeMutation,
                  );
                  enqueueSnackbar(result.message ?? 'Optional runtime rollback selected.', { variant: 'success' });
                  await fetchOptionalRuntimes();
                },
              )
            }
          >
            Rollback
          </ModiffButton>
        ) : null}
      </div>
      <ModiffDisclosure label="Optimizations" panelClassName="grid gap-2 pt-2">
        {loadError ? (
          <div className="flex items-center justify-between gap-2 rounded-modiff-compact border border-modiff-warning p-2">
            <span className="text-xs text-modiff-warning">{loadError}</span>
            <ModiffButton size="compact" loading={loading} onClick={() => void refresh().catch(() => undefined)}>
              Retry
            </ModiffButton>
          </div>
        ) : loading && !catalog ? (
          <p className="text-xs text-modiff-subtle-text">Loading runtime optimizations…</p>
        ) : null}
        {catalog?.capabilities.map((capability) => {
          const documentationUrl = safeOptimizationDocumentationUrl(capability.documentation);
          return (
            <div
              key={capability.id}
              className="grid gap-2 rounded-modiff-compact border border-modiff-border-subtle p-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-modiff-text">{capability.label}</span>
                  <p className="mt-1 text-xs text-modiff-subtle-text">{capability.summary}</p>
                  {capability.disabledReason ? (
                    <p className="mt-1 text-xs text-modiff-warning">{capability.disabledReason}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <ModiffButton
                    size="compact"
                    disabled={!documentationUrl || busyId !== null}
                    onClick={() => {
                      if (documentationUrl) window.open(documentationUrl, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    Docs
                  </ModiffButton>
                  {capability.canEnable ? (
                    <>
                      <ModiffButton
                        size="compact"
                        disabled={busyId !== null}
                        tone={capability.enabled ? 'primary' : 'secondary'}
                        loading={busyId === `toggle:${capability.id}`}
                        onClick={() =>
                          void mutate(`toggle:${capability.id}`, '/runtime/optimizations/enable', {
                            capabilityId: capability.id,
                            enabled: !capability.enabled,
                          })
                        }
                      >
                        {capability.enabled ? 'Enabled' : 'Enable'}
                      </ModiffButton>
                      <ModiffButton
                        size="compact"
                        disabled={busyId !== null}
                        loading={busyId === `probe:${capability.id}`}
                        onClick={() =>
                          void mutate(`probe:${capability.id}`, '/runtime/optimizations/probe', {
                            capabilityId: capability.id,
                          })
                        }
                      >
                        Probe
                      </ModiffButton>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {observedReceipts.map((receipt) => (
          <div
            key={receipt.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-modiff-compact border border-modiff-border-subtle p-2"
          >
            <span className="text-xs text-modiff-text">
              Review {receipt.capabilityId} · {receipt.modelType || receipt.artifact || 'workload'}
            </span>
            <ModiffButton
              size="compact"
              loading={busyId === `qualify:${receipt.id}`}
              disabled={busyId !== null}
              onClick={() =>
                void mutate(`qualify:${receipt.id}`, '/runtime/optimizations/qualify', {
                  receiptId: receipt.id,
                  outputReviewed: true,
                })
              }
            >
              Reviewed
            </ModiffButton>
          </div>
        ))}
      </ModiffDisclosure>
    </section>
  );
}
