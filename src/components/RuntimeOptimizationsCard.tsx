import { useCallback, useEffect, useRef, useState } from 'react';
import config from '../../app.config';
import { useNodesStore } from '../stores/useNodeStore';
import type { OptionalRuntimeCatalog, OptionalRuntimeProfileStatus } from '../studio/optionalRuntimes';
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

function post(path: string, body: Record<string, unknown>) {
  return requestJson(`${config.serverAddress}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 30_000,
    parse: parseOptimizationMutationResponse,
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
  const state = process !== 'active' && process !== 'base' ? process : qualified ? 'active' : 'unavailable';
  return `${state.replace(/_/g, ' ')}${state === 'unavailable' ? ` (${profile.contractState})` : ''}.`;
}

export default function RuntimeOptimizationsCard() {
  const optionalRuntimeCatalog = useNodesStore((state) => state.optionalRuntimeCatalog);
  const optionalRuntimeRequest = useNodesStore((state) => state.discoveryRequests.optionalRuntimes);
  const [catalog, setCatalog] = useState<OptimizationCatalog | null>(null);
  const [receipts, setReceipts] = useState<OptimizationReceipt[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const mutate = async (busyKey: string, path: string, body: Record<string, unknown>) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusyId(busyKey);
    try {
      const response = await post(path, body);
      enqueueSnackbar(response.message ?? 'Updated.', {
        variant: 'success',
      });
      void refresh().catch(() => undefined);
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Action failed.'), { variant: 'error' });
    } finally {
      mutationInFlight.current = false;
      setBusyId(null);
    }
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
            return (
              <p key={profile.id} className="text-xs text-modiff-text">
                {profile.label}: {optionalRuntimeStatus(profile, optionalRuntimeCatalog.processLoadStatus)}
              </p>
            );
          })
        ) : (
          <p className="text-xs text-modiff-subtle-text">No optional runtimes.</p>
        )}
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
