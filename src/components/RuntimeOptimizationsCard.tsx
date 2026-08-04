import { useCallback, useEffect, useRef, useState } from 'react';
import config from '../../app.config';
import { formatRequestError, requestJson } from '../utils/requestJson';
import { enqueueSnackbar, ModiffButton, ModiffDisclosure } from '../ui';
import {
  parseOptimizationCatalog,
  parseOptimizationJobResponse,
  parseOptimizationMutationResponse,
  parseOptimizationReceipts,
  safeOptimizationDocumentationUrl,
  type OptimizationCatalog,
  type OptimizationJob,
  type OptimizationReceipt,
} from '../studio/runtimeOptimizations';

function post(path: string, body: Record<string, unknown>) {
  return requestJson(`${config.serverAddress}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
    parse: parseOptimizationMutationResponse,
  });
}

export default function RuntimeOptimizationsCard() {
  const [catalog, setCatalog] = useState<OptimizationCatalog | null>(null);
  const [receipts, setReceipts] = useState<OptimizationReceipt[]>([]);
  const [jobs, setJobs] = useState<Record<string, OptimizationJob>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refreshRevision = useRef(0);
  const mutationInFlight = useRef(false);

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
    const activeJobs = Object.values(jobs).filter((job) => ['queued', 'running'].includes(job.status));
    if (!activeJobs.length) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const responses = await Promise.all(
          activeJobs.map((job) =>
            requestJson(`${config.serverAddress}/runtime/optimizations/jobs/${encodeURIComponent(job.id)}`, {
              timeoutMs: 15_000,
              parse: parseOptimizationJobResponse,
            }),
          ),
        );
        if (cancelled) return;
        setJobs((current) => ({
          ...current,
          ...Object.fromEntries(responses.map(({ job }) => [job.id, job])),
        }));
        if (responses.some(({ job }) => job.status === 'ready' || job.status === 'failed')) void refresh();
      } catch {
        // A later poll retries while the staged installer remains active.
      } finally {
        if (!cancelled) setPollTick((current) => current + 1);
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobs, pollTick, refresh]);

  const mutate = async (busyKey: string, path: string, body: Record<string, unknown>, refreshAfter = false) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusyId(busyKey);
    try {
      const response = await post(path, body);
      const job = response.job;
      if (job) setJobs((current) => ({ ...current, [job.id]: job }));
      enqueueSnackbar(response.message ?? 'Updated.', {
        variant: response.job ? 'info' : 'success',
      });
      if (refreshAfter) void refresh().catch(() => undefined);
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Action failed.'), { variant: 'error' });
    } finally {
      mutationInFlight.current = false;
      setBusyId(null);
    }
  };

  const stagedEnvironments =
    catalog?.environments.filter((environment) => !environment.active && environment.validation?.status === 'passed') ??
    [];
  const observedReceipts = receipts.filter((receipt) => receipt.kind === 'workload' && receipt.status === 'observed');

  return (
    <section className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3">
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
          const capabilityJob = Object.values(jobs).find((job) => job.capabilityId === capability.id);
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
                  {capabilityJob?.progress?.message ? (
                    <p className="mt-1 text-xs text-modiff-warning">{capabilityJob.progress.message}</p>
                  ) : capability.disabledReason ? (
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
                  {capability.canInstall && !capability.installed ? (
                    <ModiffButton
                      size="compact"
                      disabled={busyId !== null}
                      loading={busyId === capability.id || capabilityJob?.status === 'running'}
                      onClick={() =>
                        void mutate(capability.id, '/runtime/optimizations/install', {
                          capabilityId: capability.id,
                        })
                      }
                    >
                      Install
                    </ModiffButton>
                  ) : null}
                  {capability.canEnable ? (
                    <>
                      <ModiffButton
                        size="compact"
                        disabled={busyId !== null}
                        tone={capability.enabled ? 'primary' : 'secondary'}
                        loading={busyId === `toggle:${capability.id}`}
                        onClick={() =>
                          void mutate(
                            `toggle:${capability.id}`,
                            '/runtime/optimizations/enable',
                            { capabilityId: capability.id, enabled: !capability.enabled },
                            true,
                          )
                        }
                      >
                        {capability.enabled ? 'Enabled' : 'Enable'}
                      </ModiffButton>
                      <ModiffButton
                        size="compact"
                        disabled={busyId !== null}
                        loading={busyId === `probe:${capability.id}`}
                        onClick={() =>
                          void mutate(
                            `probe:${capability.id}`,
                            '/runtime/optimizations/probe',
                            { capabilityId: capability.id },
                            true,
                          )
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

        {stagedEnvironments.map((environment) => (
          <div
            key={environment.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-modiff-compact border border-modiff-green p-2"
          >
            <span className="text-xs text-modiff-text">Ready: {environment.capabilities.join(', ')}</span>
            <ModiffButton
              size="compact"
              loading={busyId === `activate:${environment.id}`}
              disabled={busyId !== null}
              onClick={() =>
                void mutate(
                  `activate:${environment.id}`,
                  '/runtime/optimizations/activate',
                  {
                    environmentId: environment.id,
                  },
                  true,
                )
              }
            >
              Activate
            </ModiffButton>
          </div>
        ))}

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
                void mutate(
                  `qualify:${receipt.id}`,
                  '/runtime/optimizations/qualify',
                  { receiptId: receipt.id, outputReviewed: true },
                  true,
                )
              }
            >
              Reviewed
            </ModiffButton>
          </div>
        ))}

        {catalog?.state.previousEnvironmentId ? (
          <div className="flex justify-end">
            <ModiffButton
              size="compact"
              loading={busyId === 'rollback'}
              disabled={busyId !== null}
              onClick={() => void mutate('rollback', '/runtime/optimizations/rollback', {}, true)}
            >
              Roll back
            </ModiffButton>
          </div>
        ) : null}
      </ModiffDisclosure>
    </section>
  );
}
