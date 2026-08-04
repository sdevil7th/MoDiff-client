import type { ExecutionProgress } from './types';
import { formatResourceBytes, parseRuntimeResourceSnapshot } from './runtimeResources';

type ProgressLike = {
  status?: ExecutionProgress['status'];
  phase?: string;
  message?: string;
  component?: string | null;
  shard_current?: number | null;
  shard_total?: number | null;
  current_step?: number | null;
  total_steps?: number | null;
  average_step_seconds?: number | null;
  eta_seconds?: number | null;
  elapsed_seconds?: number | null;
  attempt_index?: number;
  last_heartbeat_at?: number;
  updated_at?: number;
  resource_snapshot?: unknown | null;
  phase_timings?: Record<string, number>;
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function executionProgressFrom(value: ProgressLike): ExecutionProgress {
  return {
    schemaVersion: 1,
    status: value.status,
    phase: value.phase,
    message: value.message,
    component: value.component ?? undefined,
    shard:
      finite(value.shard_current) && finite(value.shard_total)
        ? { current: value.shard_current, total: value.shard_total }
        : undefined,
    step:
      finite(value.current_step) && finite(value.total_steps)
        ? {
            current: value.current_step,
            total: value.total_steps,
            averageSeconds: finite(value.average_step_seconds) ? value.average_step_seconds : undefined,
            etaSeconds: finite(value.eta_seconds) ? value.eta_seconds : undefined,
          }
        : undefined,
    elapsedSeconds: finite(value.elapsed_seconds) ? value.elapsed_seconds : undefined,
    attemptIndex: finite(value.attempt_index) ? value.attempt_index : undefined,
    lastHeartbeatAt: finite(value.last_heartbeat_at)
      ? value.last_heartbeat_at
      : finite(value.updated_at)
        ? value.updated_at
        : undefined,
    resourceSnapshot: value.resource_snapshot ?? undefined,
    phaseTimings: value.phase_timings,
  };
}

function duration(value: number | undefined) {
  if (!finite(value)) return null;
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}m ${seconds}s`;
}

export function executionProgressDetail(progress: ExecutionProgress | undefined) {
  if (!progress) return '';
  let resourceDetail: string | null = null;
  if (progress.resourceSnapshot) {
    try {
      const snapshot = parseRuntimeResourceSnapshot(progress.resourceSnapshot);
      const accelerator = snapshot.accelerators.find((item) => item.active) ?? snapshot.accelerators[0];
      if (accelerator) {
        resourceDetail = `GPU memory ${formatResourceBytes(accelerator.memoryUsedBytes)} / ${formatResourceBytes(accelerator.memoryTotalBytes)}`;
      } else {
        resourceDetail = `RAM ${formatResourceBytes(snapshot.system.ramUsedBytes)} / ${formatResourceBytes(snapshot.system.ramTotalBytes)}`;
      }
    } catch {
      resourceDetail = null;
    }
  }
  const phaseTimingDetail = progress.phaseTimings
    ? Object.entries(progress.phaseTimings)
        .filter(([, seconds]) => finite(seconds))
        .map(([phase, seconds]) => `${phase.replace(/_/g, ' ')} ${duration(seconds)}`)
        .join(', ')
    : null;
  const details = [
    progress.message,
    progress.phase ? `Phase: ${progress.phase.replace(/_/g, ' ')}` : null,
    progress.component ? `Component: ${progress.component}` : null,
    progress.shard ? `Shard ${progress.shard.current}/${progress.shard.total}` : null,
    progress.step ? `Step ${progress.step.current}/${progress.step.total}` : null,
    progress.elapsedSeconds !== undefined ? `Elapsed ${duration(progress.elapsedSeconds)}` : null,
    progress.step?.etaSeconds !== undefined ? `ETA ${duration(progress.step.etaSeconds)}` : null,
    progress.attemptIndex !== undefined && progress.attemptIndex > 0 ? `Retry ${progress.attemptIndex}` : null,
    progress.lastHeartbeatAt ? `Last update ${new Date(progress.lastHeartbeatAt * 1000).toLocaleTimeString()}` : null,
    resourceDetail,
    phaseTimingDetail ? `Phase timings: ${phaseTimingDetail}` : null,
  ].filter((detail): detail is string => Boolean(detail));
  return Array.from(new Set(details)).join(' · ');
}
