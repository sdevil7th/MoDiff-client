import { useCallback, useEffect, useRef, useState } from 'react';
import { Images, RefreshCw } from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  fetchTemplateGalleryInstallPlan,
  fetchTemplateGalleryInstallStatus,
  installTemplateGallery,
  type TemplateGalleryInstallStatus,
} from '../studio/templateGalleryInstall';
import { enqueueSnackbar, ModiffButton, StatusActionChip } from '../ui';
import { formatRequestError } from '../utils/requestJson';

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusLabel(status: TemplateGalleryInstallStatus | null, loading: boolean) {
  if (loading && !status) return 'Checking';
  if (!status) return 'Unavailable';
  if (status.status === 'ready') return 'Ready';
  if (status.status === 'installing') return 'Installing';
  if (status.status === 'repair_required') return 'Repair required';
  if (status.status === 'missing') return 'Not installed';
  return 'Unavailable';
}

export function TemplateGallerySetupCard() {
  const setAlertOpener = useSettingsStore((state) => state.setAlertOpener);
  const [status, setStatus] = useState<TemplateGalleryInstallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshRevision = useRef(0);

  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    setLoading(true);
    try {
      const next = await fetchTemplateGalleryInstallStatus();
      if (revision !== refreshRevision.current) return;
      setStatus(next);
      setError(null);
    } catch (requestError) {
      if (revision !== refreshRevision.current) return;
      setError(formatRequestError(requestError, 'Could not inspect Template Gallery assets.'));
    } finally {
      if (revision === refreshRevision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const beginInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const plan = await fetchTemplateGalleryInstallPlan();
      if (!plan.sizeKnown || !plan.fitsWithQueue) {
        throw new Error(
          `The verified ${formatBytes(plan.reservationBytes)} Gallery reservation does not fit alongside ` +
            `${formatBytes(plan.queuedReservationBytes)} of active model reservations and the ` +
            `${formatBytes(plan.reserveBytes)} safety reserve.`,
        );
      }
      setAlertOpener({
        title: plan.repairRequired ? 'Repair Template Gallery assets?' : 'Install Template Gallery assets?',
        message:
          `Download and hash-verify ${plan.assetCount} files (${formatBytes(plan.totalBytes)}) from ` +
          `${plan.repoId} at immutable revision ${plan.revision.slice(0, 12)}. ` +
          'Existing model downloads and cached models will not be removed.',
        confirmText: plan.repairRequired ? 'Repair' : 'Install',
        cancelText: 'Cancel',
        onConfirm: () => {
          setAlertOpener(null);
          void (async () => {
            try {
              const result = await installTemplateGallery();
              enqueueSnackbar(
                result.result?.restartRequired
                  ? 'Template Gallery installed. Restart MoDiff after active downloads finish to serve it locally.'
                  : 'Template Gallery is already installed.',
                { variant: 'success' },
              );
              await refresh();
            } catch (requestError) {
              const message = formatRequestError(requestError, 'Template Gallery installation failed.');
              setError(message);
              enqueueSnackbar(message, { variant: 'error' });
            } finally {
              setInstalling(false);
            }
          })();
        },
        onCancel: () => {
          setAlertOpener(null);
          setInstalling(false);
        },
      });
    } catch (requestError) {
      const message = formatRequestError(requestError, 'Could not plan the Template Gallery installation.');
      setError(message);
      enqueueSnackbar(message, { variant: 'error' });
      setInstalling(false);
    }
  };

  const ready = status?.status === 'ready';
  const actionable = status?.status === 'missing' || status?.status === 'repair_required';
  return (
    <section
      className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3"
      data-testid="template-gallery-setup-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Images size={15} className="text-hf-yellow" />
          <h3 className="text-sm font-bold text-modiff-text">Template Gallery assets</h3>
        </div>
        <StatusActionChip
          label={statusLabel(status, loading)}
          tone={ready ? 'success' : error || status?.repairRequired ? 'error' : 'warning'}
          title={error || status?.message || status?.assetSetId}
        />
      </div>
      <p className="mt-2 text-xs leading-5 text-modiff-subtle-text">
        Byte-pinned Gallery previews and default workflow inputs are installed from the app&apos;s immutable public
        Dataset. Model caches are separate and are never removed by this action.
      </p>
      {status?.complete && (
        <p className="mt-1 text-xs text-modiff-green">
          {status.assetCount ?? 0} files · {formatBytes(status.totalBytes)} · {status.revision?.slice(0, 12)}
        </p>
      )}
      {error && <p className="mt-1 break-words text-xs text-modiff-red">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {actionable && (
          <ModiffButton
            size="compact"
            loading={installing || status?.installing}
            disabled={loading || installing || status?.installing}
            onClick={() => void beginInstall()}
            data-testid="template-gallery-install"
          >
            {status?.repairRequired ? 'Check & repair' : 'Check & install'}
          </ModiffButton>
        )}
        <ModiffButton
          size="compact"
          tone="secondary"
          icon={<RefreshCw size={14} />}
          disabled={loading || installing}
          onClick={() => void refresh()}
          data-testid="template-gallery-refresh"
        >
          Refresh
        </ModiffButton>
      </div>
    </section>
  );
}
