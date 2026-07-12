export type AcceleratorBackend = 'cuda' | 'rocm' | 'mps' | 'cpu' | 'unknown';
export type AcceleratorVendor = 'nvidia' | 'amd' | 'apple' | 'cpu' | 'unknown';

export type RuntimeDevice = {
  device: string;
  backend: AcceleratorBackend;
  vendor: AcceleratorVendor;
  architecture: string | null;
  memoryKind: 'dedicated' | 'unified' | 'system' | 'unknown';
  memoryTotal: number | null;
  memoryFree: number | null;
  name: string;
};

export type RuntimeEnvironment = {
  schemaVersion: 1 | 2;
  profileVerified: boolean;
  executionReady: boolean;
  requestedProfile: string | null;
  installedProfile: string | null;
  status: string;
  supportTier: string;
  repairCommand: string | null;
  defaultDevice: string;
  devices: RuntimeDevice[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function backend(value: unknown): AcceleratorBackend {
  return value === 'cuda' || value === 'rocm' || value === 'mps' || value === 'cpu' ? value : 'unknown';
}

function vendor(value: unknown, resolvedBackend: AcceleratorBackend): AcceleratorVendor {
  if (value === 'nvidia' || value === 'amd' || value === 'apple' || value === 'cpu') return value;
  return resolvedBackend === 'cuda' ? 'nvidia' : resolvedBackend === 'rocm' ? 'amd' : resolvedBackend === 'mps' ? 'apple' : resolvedBackend === 'cpu' ? 'cpu' : 'unknown';
}

export function parseRuntimeEnvironment(value: unknown): RuntimeEnvironment {
  const payload = record(value);
  if (!payload) throw new Error('The runtime status response is invalid.');
  const hardware = record(payload.hardware) ?? {};
  const profile = record(payload.runtime_profile);
  const torch = record(record(payload.packages)?.torch);
  const rawDevices = Array.isArray(hardware.devices) ? hardware.devices : [];
  const devices = rawDevices.flatMap((item): RuntimeDevice[] => {
    const source = record(item);
    const device = text(source?.device);
    if (!source || !device) return [];
    const resolvedBackend = backend(source.backend ?? source.type);
    return [{
      device,
      backend: resolvedBackend,
      vendor: vendor(source.vendor, resolvedBackend),
      architecture: text(source.architecture),
      memoryKind: source.memory_kind === 'dedicated' || source.memory_kind === 'unified' || source.memory_kind === 'system' ? source.memory_kind : 'unknown',
      memoryTotal: number(source.memory_total ?? source.vram_total),
      memoryFree: number(source.memory_free ?? source.vram_free),
      name: text(source.name) ?? device,
    }];
  });
  if (devices.length === 0) {
    if (torch?.cuda_available === true) devices.push({ device: 'cuda:0', backend: 'cuda', vendor: 'nvidia', architecture: null, memoryKind: 'dedicated', memoryTotal: number(torch.cuda_device_total_memory), memoryFree: number(torch.cuda_memory_free_bytes), name: text(torch.cuda_device_name) ?? 'CUDA' });
    else if (torch?.mps_available === true) devices.push({ device: 'mps:0', backend: 'mps', vendor: 'apple', architecture: null, memoryKind: 'unified', memoryTotal: null, memoryFree: null, name: 'Apple MPS' });
    devices.push({ device: 'cpu:0', backend: 'cpu', vendor: 'cpu', architecture: null, memoryKind: 'system', memoryTotal: null, memoryFree: null, name: 'CPU' });
  }
  const schemaVersion = payload.schema_version === 2 || hardware.schema_version === 2 ? 2 : 1;
  return {
    schemaVersion,
    profileVerified: Boolean(profile),
    executionReady: profile ? profile.execution_ready === true : payload.ready !== false,
    requestedProfile: text(profile?.requested),
    installedProfile: text(profile?.installed),
    status: text(profile?.status) ?? (payload.ready === false ? 'setup-required' : 'unverified'),
    supportTier: text(profile?.support_tier) ?? 'unverified',
    repairCommand: text(profile?.repair_command),
    defaultDevice: text(hardware.default_device) ?? devices[0]?.device ?? 'cpu:0',
    devices,
  };
}
