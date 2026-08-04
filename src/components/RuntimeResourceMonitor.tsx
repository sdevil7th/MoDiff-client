import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, Gauge, HardDrive, MemoryStick } from 'lucide-react';

import {
  fetchRuntimeResourceSnapshot,
  formatResourceBytes,
  formatResourcePercent,
  runtimeResourcePressure,
  type RuntimeAcceleratorResource,
  type RuntimeResourceSnapshot,
} from '../studio/runtimeResources';
import { ModiffButton, ModiffPopover, ModiffTooltip } from '../ui';
import { cx } from '../utils/classNames';
import { useNodesStore } from '../stores/useNodeStore';

type RuntimeResourceMonitorProps = {
  active: boolean;
  connected: boolean;
};

function acceleratorMemoryPercent(accelerator?: RuntimeAcceleratorResource) {
  if (
    !accelerator ||
    accelerator.memoryUsedBytes === null ||
    accelerator.memoryTotalBytes === null ||
    accelerator.memoryTotalBytes <= 0
  ) {
    return null;
  }
  return (accelerator.memoryUsedBytes / accelerator.memoryTotalBytes) * 100;
}

function metricTone(pressure: number | null) {
  if (pressure !== null && pressure >= 95) return 'text-modiff-invalid';
  if (pressure !== null && pressure >= 85) return 'text-modiff-warning';
  return 'text-modiff-text';
}

function Metric({ label, value, pressure }: { label: string; pressure: number | null; value: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="text-modiff-label uppercase text-modiff-subtle-text">{label}</span>
      <span className={cx('text-xs font-semibold tabular-nums', metricTone(pressure))}>{value}</span>
    </span>
  );
}

function ResourceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 text-xs">
      <span className="text-modiff-subtle-text">{label}</span>
      <span className="text-right font-semibold tabular-nums text-modiff-text">{value}</span>
    </div>
  );
}

function AcceleratorSection({ accelerator, active }: { accelerator: RuntimeAcceleratorResource; active: boolean }) {
  return (
    <section className="grid gap-1.5 rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg/60 p-2">
      <div className="flex items-center gap-1.5 text-xs font-bold text-modiff-text">
        <MemoryStick size={14} />
        <span className="min-w-0 flex-1 truncate">{accelerator.name}</span>
        {active ? (
          <span className="rounded-modiff-compact bg-modiff-selected-surface px-1.5 py-0.5 text-modiff-label uppercase text-modiff-text">
            Active
          </span>
        ) : null}
      </div>
      <ResourceRow label="Backend" value={`${accelerator.backend.toUpperCase()} · ${accelerator.device}`} />
      <ResourceRow
        label="GPU compute"
        value={
          accelerator.utilizationPercent === null
            ? 'Utilization unavailable'
            : `${formatResourcePercent(accelerator.utilizationPercent)} (${accelerator.utilizationSource ?? 'runtime'})`
        }
      />
      <ResourceRow
        label={accelerator.memoryKind === 'shared' ? 'GPU memory (shared)' : 'GPU memory'}
        value={`${formatResourceBytes(accelerator.memoryUsedBytes)} / ${formatResourceBytes(accelerator.memoryTotalBytes)}`}
      />
      <ResourceRow label="Free" value={formatResourceBytes(accelerator.memoryFreeBytes)} />
      <ResourceRow label="MoDiff allocated" value={formatResourceBytes(accelerator.allocatedBytes)} />
      <ResourceRow label="MoDiff reserved" value={formatResourceBytes(accelerator.reservedBytes)} />
      <ResourceRow label="Peak allocated" value={formatResourceBytes(accelerator.peakAllocatedBytes)} />
      <ResourceRow label="Peak reserved" value={formatResourceBytes(accelerator.peakReservedBytes)} />
    </section>
  );
}

export default function RuntimeResourceMonitor({ active, connected }: RuntimeResourceMonitorProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<RuntimeResourceSnapshot | null>(null);
  const [stale, setStale] = useState(false);
  const [sustainedPressure, setSustainedPressure] = useState<number | null>(null);
  const pressureSamples = useRef<number[]>([]);
  const pollRevision = useRef(0);
  const setRuntimeResources = useNodesStore((state) => state.setRuntimeResources);

  const poll = useCallback(
    async (signal: AbortSignal) => {
      if (!connected || document.visibilityState === 'hidden') return;
      const revision = ++pollRevision.current;
      try {
        const next = await fetchRuntimeResourceSnapshot(signal);
        if (signal.aborted || revision !== pollRevision.current) return;
        const nextPressure = runtimeResourcePressure(next);
        pressureSamples.current = nextPressure === null ? [] : [...pressureSamples.current, nextPressure].slice(-3);
        const sustainedSamples = pressureSamples.current;
        setSustainedPressure(
          sustainedSamples.length >= 3 && sustainedSamples.every((value) => value >= 95)
            ? Math.max(...sustainedSamples)
            : sustainedSamples.length >= 3 && sustainedSamples.every((value) => value >= 85)
              ? Math.max(...sustainedSamples)
              : null,
        );
        setSnapshot(next);
        setRuntimeResources(next);
        setStale(false);
      } catch {
        if (!signal.aborted && revision === pollRevision.current) setStale(true);
      }
    },
    [connected, setRuntimeResources],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | null = null;
    const schedule = () => {
      if (controller.signal.aborted) return;
      timer = window.setTimeout(
        async () => {
          await poll(controller.signal);
          schedule();
        },
        active ? 2_000 : 5_000,
      );
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void poll(controller.signal);
    };
    void poll(controller.signal);
    schedule();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      pollRevision.current += 1;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [active, poll]);

  const accelerator = useMemo(
    () => snapshot?.accelerators.find((item) => item.active) ?? snapshot?.accelerators[0],
    [snapshot],
  );
  const gpuMemoryPercent = acceleratorMemoryPercent(accelerator);
  const sharedGpuMemory = accelerator?.memoryKind === 'shared';
  const storageLabel = snapshot?.storage.kind === 'ssd' ? 'SSD' : snapshot?.storage.kind === 'hdd' ? 'HDD' : 'DISK';
  const pressure = runtimeResourcePressure(snapshot);
  const tooltip = snapshot
    ? `System CPU ${formatResourcePercent(snapshot.system.cpuPercent)}, RAM ${formatResourcePercent(snapshot.system.ramPercent)}, GPU compute ${formatResourcePercent(accelerator?.utilizationPercent ?? null)}, disk active time ${formatResourcePercent(snapshot.storage.activePercent)}, GPU memory${sharedGpuMemory ? ' (shared)' : ''} ${formatResourcePercent(gpuMemoryPercent)}`
    : connected
      ? 'Reading system resources'
      : 'Resource monitor unavailable while disconnected';

  return (
    <>
      <ModiffTooltip<HTMLButtonElement> content={tooltip}>
        {(tooltipProps) => (
          <ModiffButton
            {...tooltipProps}
            ref={anchorRef}
            type="button"
            size="normal"
            tone="secondary"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label="System resource usage"
            className={cx(
              'flex-none gap-2 px-2',
              stale && 'border-modiff-warning/60',
              sustainedPressure !== null && sustainedPressure >= 95 && 'border-modiff-invalid text-modiff-invalid',
              sustainedPressure !== null &&
                sustainedPressure >= 85 &&
                sustainedPressure < 95 &&
                'border-modiff-warning text-modiff-warning',
            )}
            data-testid="topbar-resource-monitor"
            onClick={() => setOpen((value) => !value)}
          >
            <Gauge size={16} className={metricTone(sustainedPressure)} />
            <span className="hidden items-center gap-2 2xl:flex">
              <Metric
                label="CPU"
                value={formatResourcePercent(snapshot?.system.cpuPercent ?? null)}
                pressure={snapshot?.system.cpuPercent ?? null}
              />
              <Metric
                label="RAM"
                value={formatResourcePercent(snapshot?.system.ramPercent ?? null)}
                pressure={snapshot?.system.ramPercent ?? null}
              />
              {accelerator ? (
                <>
                  <Metric
                    label="GPU"
                    value={formatResourcePercent(accelerator.utilizationPercent)}
                    pressure={accelerator.utilizationPercent}
                  />
                  <Metric
                    label="DISK"
                    value={formatResourcePercent(snapshot?.storage.activePercent ?? null)}
                    pressure={snapshot?.storage.activePercent ?? null}
                  />
                </>
              ) : null}
            </span>
            <span className={cx('text-xs font-semibold tabular-nums 2xl:hidden', metricTone(sustainedPressure))}>
              {formatResourcePercent(pressure)}
            </span>
          </ModiffButton>
        )}
      </ModiffTooltip>

      <ModiffPopover
        anchorRef={anchorRef}
        ariaLabel="System resource usage"
        onClose={() => setOpen(false)}
        open={open}
        panelClassName="w-80 p-3"
        placement="bottom-end"
        testId="topbar-resource-popover"
      >
        <div className="grid gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-modiff-text">Resource usage</div>
              <div className="text-xs text-modiff-subtle-text">
                {stale
                  ? 'Last sample — connection is stale'
                  : snapshot
                    ? `Updated ${new Date(snapshot.sampledAt * 1000).toLocaleTimeString()}`
                    : 'Waiting for the first sample'}
              </div>
            </div>
            <Gauge size={18} className={metricTone(sustainedPressure)} />
          </div>

          <section className="grid gap-1.5 rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg/60 p-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-modiff-text">
              <Cpu size={14} />
              System
            </div>
            <ResourceRow label="CPU" value={formatResourcePercent(snapshot?.system.cpuPercent ?? null)} />
            <ResourceRow
              label="RAM"
              value={`${formatResourceBytes(snapshot?.system.ramUsedBytes ?? null)} / ${formatResourceBytes(snapshot?.system.ramTotalBytes ?? null)}`}
            />
            <ResourceRow label="MoDiff CPU" value={formatResourcePercent(snapshot?.process.cpuPercent ?? null)} />
            <ResourceRow label="MoDiff RAM" value={formatResourceBytes(snapshot?.process.rssBytes ?? null)} />
          </section>

          <section className="grid gap-1.5 rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg/60 p-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-modiff-text">
              <HardDrive size={14} />
              Storage
            </div>
            <ResourceRow
              label={storageLabel}
              value={`${formatResourceBytes(snapshot?.storage.usedBytes ?? null)} / ${formatResourceBytes(snapshot?.storage.totalBytes ?? null)}`}
            />
            <ResourceRow label="Active time" value={formatResourcePercent(snapshot?.storage.activePercent ?? null)} />
            <ResourceRow label="Free" value={formatResourceBytes(snapshot?.storage.freeBytes ?? null)} />
            {snapshot?.storage.path ? <ResourceRow label="MoDiff data volume" value={snapshot.storage.path} /> : null}
          </section>

          {snapshot?.accelerators.length ? (
            <div className="modiff-scrollbar-thin grid max-h-72 gap-2 overflow-y-auto pr-1">
              {snapshot.accelerators.map((item) => (
                <AcceleratorSection
                  key={item.device}
                  accelerator={item}
                  active={item.device === snapshot.activeDevice}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-modiff-compact border border-modiff-border-subtle p-2 text-xs text-modiff-subtle-text">
              No accelerator is available. CPU and RAM telemetry remain active.
            </div>
          )}

          {snapshot?.currentRun ? (
            <ResourceRow
              label="Current run"
              value={`${snapshot.currentRun.name ?? 'Workflow'} · ${formatResourcePercent(snapshot.currentRun.progress)}`}
            />
          ) : null}
        </div>
      </ModiffPopover>
    </>
  );
}
