import config from '../../app.config';
import { requestJson } from '../utils/requestJson';

export type RuntimeResourceSystem = {
  cpuPercent: number | null;
  ramAvailableBytes: number | null;
  ramPercent: number | null;
  ramTotalBytes: number | null;
  ramUsedBytes: number | null;
};

export type RuntimeResourceProcess = {
  cpuPercent: number | null;
  rssBytes: number | null;
};

export type RuntimeStorageResource = {
  activePercent: number | null;
  activitySource: string | null;
  detectionSource: string | null;
  freeBytes: number | null;
  kind: 'hdd' | 'ssd' | 'unknown';
  path: string | null;
  percent: number | null;
  totalBytes: number | null;
  usedBytes: number | null;
};

export type RuntimeAcceleratorResource = {
  active?: boolean;
  allocatedBytes: number | null;
  backend: string;
  device: string;
  index: number | null;
  memoryFreeBytes: number | null;
  memoryKind: 'dedicated' | 'shared' | 'unified' | 'system' | 'unknown';
  memoryTotalBytes: number | null;
  memoryUsedBytes: number | null;
  name: string;
  peakAllocatedBytes: number | null;
  peakReservedBytes: number | null;
  reservedBytes: number | null;
  utilizationPercent: number | null;
  utilizationSource: string | null;
};

export type RuntimeResourceSnapshot = {
  accelerators: RuntimeAcceleratorResource[];
  activeDevice: string | null;
  currentRun: {
    name: string | null;
    progress: number | null;
    startedAt: number | null;
    taskId: string | null;
  } | null;
  errors: string[];
  process: RuntimeResourceProcess;
  sampledAt: number;
  schemaVersion: 1;
  storage: RuntimeStorageResource;
  system: RuntimeResourceSystem;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function memoryKind(value: unknown): RuntimeAcceleratorResource['memoryKind'] {
  return value === 'dedicated' || value === 'shared' || value === 'unified' || value === 'system' ? value : 'unknown';
}

function storageKind(value: unknown): RuntimeStorageResource['kind'] {
  return value === 'ssd' || value === 'hdd' ? value : 'unknown';
}

export function parseRuntimeResourceSnapshot(value: unknown): RuntimeResourceSnapshot {
  const payload = record(value);
  if (!payload) throw new Error('The runtime resource response is invalid.');
  if (payload.schemaVersion !== undefined && payload.schemaVersion !== 1) {
    throw new Error(`Unsupported runtime resource schema: ${String(payload.schemaVersion)}`);
  }
  const system = record(payload.system) ?? {};
  const process = record(payload.process) ?? {};
  const storage = record(payload.storage) ?? {};
  const currentRun = record(payload.currentRun);
  const activeDevice = text(payload.activeDevice);
  const accelerators = Array.isArray(payload.accelerators)
    ? payload.accelerators.flatMap((item): RuntimeAcceleratorResource[] => {
        const accelerator = record(item);
        const device = text(accelerator?.device);
        if (!accelerator || !device) return [];
        return [
          {
            active: activeDevice === device,
            allocatedBytes: finite(accelerator.allocatedBytes),
            backend: text(accelerator.backend) ?? 'unknown',
            device,
            index: finite(accelerator.index),
            memoryFreeBytes: finite(accelerator.memoryFreeBytes),
            memoryKind: memoryKind(accelerator.memoryKind),
            memoryTotalBytes: finite(accelerator.memoryTotalBytes),
            memoryUsedBytes: finite(accelerator.memoryUsedBytes),
            name: text(accelerator.name) ?? device,
            peakAllocatedBytes: finite(accelerator.peakAllocatedBytes),
            peakReservedBytes: finite(accelerator.peakReservedBytes),
            reservedBytes: finite(accelerator.reservedBytes),
            utilizationPercent: finite(accelerator.utilizationPercent),
            utilizationSource: text(accelerator.utilizationSource),
          },
        ];
      })
    : [];
  return {
    accelerators,
    activeDevice,
    currentRun: currentRun
      ? {
          name: text(currentRun.name),
          progress: finite(currentRun.progress),
          startedAt: finite(currentRun.startedAt),
          taskId: text(currentRun.taskId),
        }
      : null,
    errors: Array.isArray(payload.errors)
      ? payload.errors.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : [],
    process: {
      cpuPercent: finite(process.cpuPercent),
      rssBytes: finite(process.rssBytes),
    },
    sampledAt: finite(payload.sampledAt) ?? Date.now() / 1000,
    schemaVersion: 1,
    storage: {
      activePercent: finite(storage.activePercent),
      activitySource: text(storage.activitySource),
      detectionSource: text(storage.detectionSource),
      freeBytes: finite(storage.freeBytes),
      kind: storageKind(storage.kind),
      path: text(storage.path),
      percent: finite(storage.percent),
      totalBytes: finite(storage.totalBytes),
      usedBytes: finite(storage.usedBytes),
    },
    system: {
      cpuPercent: finite(system.cpuPercent),
      ramAvailableBytes: finite(system.ramAvailableBytes),
      ramPercent: finite(system.ramPercent),
      ramTotalBytes: finite(system.ramTotalBytes),
      ramUsedBytes: finite(system.ramUsedBytes),
    },
  };
}

export function fetchRuntimeResourceSnapshot(signal?: AbortSignal) {
  return requestJson(`${config.serverAddress}/runtime/resources`, {
    signal,
    timeoutMs: 4_000,
    parse: parseRuntimeResourceSnapshot,
  });
}

export function formatResourceBytes(bytes: number | null, compact = false) {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  const gib = bytes / 1024 ** 3;
  if (compact) return `${gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)}G`;
  return `${gib >= 10 ? gib.toFixed(1) : gib.toFixed(2)} GiB`;
}

export function formatResourcePercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export function runtimeResourcePressure(snapshot: RuntimeResourceSnapshot | null) {
  if (!snapshot) return null;
  const active = snapshot.accelerators.find((item) => item.active) ?? snapshot.accelerators[0];
  const gpuMemoryPercent =
    active?.memoryUsedBytes !== null &&
    active?.memoryUsedBytes !== undefined &&
    active.memoryTotalBytes !== null &&
    active.memoryTotalBytes > 0
      ? (active.memoryUsedBytes / active.memoryTotalBytes) * 100
      : null;
  return Math.max(
    snapshot.system.cpuPercent ?? 0,
    snapshot.system.ramPercent ?? 0,
    snapshot.storage.activePercent ?? 0,
    active?.utilizationPercent ?? 0,
    gpuMemoryPercent ?? 0,
  );
}
