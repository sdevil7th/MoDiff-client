export type AcceleratorBackend = 'cuda' | 'rocm' | 'xpu' | 'mps' | 'cpu' | 'unknown';
export type AcceleratorVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'cpu' | 'unknown';

export type RuntimeDevice = {
  device: string;
  backend: AcceleratorBackend;
  vendor: AcceleratorVendor;
  architecture: string | null;
  memoryKind: 'dedicated' | 'shared' | 'unified' | 'system' | 'unknown';
  memoryTotal: number | null;
  memoryFree: number | null;
  name: string;
};

export type RuntimeProfileIssue = {
  code: string | null;
  severity: string | null;
  message: string;
};

export type RuntimeInstallationStep = {
  id: string | null;
  title: string | null;
  phase: string | null;
  status: string | null;
  explanation: string | null;
  automatic: boolean;
  requiresAdmin: boolean;
  requiresReboot: boolean;
  command: string | null;
  verification: string | null;
  documentationUrl: string | null;
  failureHelp: string | null;
};

export type RuntimeInstallation = {
  status: string | null;
  currentPhase: string | null;
  completedPhases: string[];
  steps: RuntimeInstallationStep[];
  rebootRequired: boolean;
  resumeCommand: string | null;
  updatedAt: string | number | null;
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
  issues: RuntimeProfileIssue[];
  installation: RuntimeInstallation | null;
  defaultDevice: string;
  devices: RuntimeDevice[];
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const boolean = (value: unknown) => (typeof value === 'boolean' ? value : null);

function backend(value: unknown, profile: string | null): AcceleratorBackend {
  if (value === 'cuda' && profile?.startsWith('amd-')) return 'rocm';
  return value === 'cuda' || value === 'rocm' || value === 'xpu' || value === 'mps' || value === 'cpu'
    ? value
    : 'unknown';
}

function vendor(value: unknown, resolvedBackend: AcceleratorBackend): AcceleratorVendor {
  if (value === 'nvidia' || value === 'amd' || value === 'intel' || value === 'apple' || value === 'cpu') return value;
  if (resolvedBackend === 'cuda') return 'nvidia';
  if (resolvedBackend === 'rocm') return 'amd';
  if (resolvedBackend === 'xpu') return 'intel';
  if (resolvedBackend === 'mps') return 'apple';
  if (resolvedBackend === 'cpu') return 'cpu';
  return 'unknown';
}

function memoryKind(value: unknown, resolvedBackend: AcceleratorBackend): RuntimeDevice['memoryKind'] {
  if (value === 'dedicated' || value === 'shared' || value === 'unified' || value === 'system') return value;
  if (resolvedBackend === 'cuda' || resolvedBackend === 'rocm') return 'dedicated';
  if (resolvedBackend === 'mps') return 'unified';
  if (resolvedBackend === 'xpu') return 'shared';
  if (resolvedBackend === 'cpu') return 'system';
  return 'unknown';
}

function parseIssues(value: unknown): RuntimeProfileIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const issue = record(item);
    const message = text(issue?.message);
    return issue && message ? [{ code: text(issue.code), severity: text(issue.severity), message }] : [];
  });
}

function parseInstallation(value: unknown): RuntimeInstallation | null {
  const installation = record(value);
  if (!installation) return null;
  const steps = Array.isArray(installation.steps)
    ? installation.steps.flatMap((item): RuntimeInstallationStep[] => {
        const step = record(item);
        if (!step) return [];
        return [
          {
            id: text(step.id),
            title: text(step.title),
            phase: text(step.phase),
            status: text(step.status),
            explanation: text(step.explanation),
            automatic: boolean(step.automatic) ?? false,
            requiresAdmin: boolean(step.requires_admin) ?? false,
            requiresReboot: boolean(step.requires_reboot) ?? false,
            command: text(step.command),
            verification: text(step.verification),
            documentationUrl: text(step.documentation_url),
            failureHelp: text(step.failure_help),
          },
        ];
      })
    : [];
  const completedPhases = Array.isArray(installation.completed_phases)
    ? installation.completed_phases.filter((item): item is string => typeof item === 'string')
    : [];
  const updatedAt = installation.updated_at;
  return {
    status: text(installation.status),
    currentPhase: text(installation.current_phase),
    completedPhases,
    steps,
    rebootRequired: boolean(installation.reboot_required) ?? false,
    resumeCommand: text(installation.resume_command),
    updatedAt: typeof updatedAt === 'string' || typeof updatedAt === 'number' ? updatedAt : null,
  };
}

export function parseRuntimeEnvironment(value: unknown): RuntimeEnvironment {
  const payload = record(value);
  if (!payload) throw new Error('The runtime status response is invalid.');
  const hardware = record(payload.hardware) ?? {};
  const profile = record(payload.runtime_profile);
  const torch = record(record(payload.packages)?.torch);
  const requestedProfile = text(profile?.requested);
  const installedProfile = text(profile?.installed);
  const detectedProfile = text(profile?.detected);
  const resolvedProfile = installedProfile ?? requestedProfile ?? detectedProfile;
  const rawDevices = Array.isArray(hardware.devices) ? hardware.devices : [];
  const devices = rawDevices.flatMap((item): RuntimeDevice[] => {
    const source = record(item);
    const device = text(source?.device);
    if (!source || !device) return [];
    const resolvedBackend = backend(source.backend ?? source.type, resolvedProfile);
    return [
      {
        device,
        backend: resolvedBackend,
        vendor: vendor(source.vendor, resolvedBackend),
        architecture: text(source.architecture),
        memoryKind: memoryKind(source.memory_kind, resolvedBackend),
        memoryTotal: number(source.memory_total ?? source.vram_total),
        memoryFree: number(source.memory_free ?? source.vram_free),
        name: text(source.name) ?? device,
      },
    ];
  });
  if (devices.length === 0) {
    if (torch?.cuda_available === true) {
      const resolvedBackend = backend('cuda', resolvedProfile);
      devices.push({
        device: 'cuda:0',
        backend: resolvedBackend,
        vendor: vendor(null, resolvedBackend),
        architecture: null,
        memoryKind: 'dedicated',
        memoryTotal: number(torch.cuda_device_total_memory ?? torch.cuda_memory_total_bytes),
        memoryFree: number(torch.cuda_memory_free_bytes),
        name: text(torch.cuda_device_name) ?? (resolvedBackend === 'rocm' ? 'AMD ROCm' : 'CUDA'),
      });
    } else if (torch?.xpu_available === true) {
      devices.push({
        device: 'xpu:0',
        backend: 'xpu',
        vendor: 'intel',
        architecture: null,
        memoryKind: 'shared',
        memoryTotal: null,
        memoryFree: null,
        name: 'Intel XPU',
      });
    } else if (torch?.mps_available === true) {
      devices.push({
        device: 'mps:0',
        backend: 'mps',
        vendor: 'apple',
        architecture: null,
        memoryKind: 'unified',
        memoryTotal: null,
        memoryFree: null,
        name: 'Apple MPS',
      });
    }
    devices.push({
      device: 'cpu:0',
      backend: 'cpu',
      vendor: 'cpu',
      architecture: null,
      memoryKind: 'system',
      memoryTotal: null,
      memoryFree: null,
      name: 'CPU',
    });
  }
  const schemaVersion = payload.schema_version === 2 || hardware.schema_version === 2 ? 2 : 1;
  const profileExecutionReady = boolean(profile?.execution_ready);
  const installation = parseInstallation(profile?.installation ?? payload.installation);
  return {
    schemaVersion,
    profileVerified: Boolean(profile),
    executionReady: profileExecutionReady ?? payload.ready !== false,
    requestedProfile,
    installedProfile,
    status: text(profile?.status) ?? (payload.ready === false ? 'setup-required' : 'unverified'),
    supportTier: text(profile?.support_tier) ?? 'unverified',
    repairCommand: text(profile?.repair_command),
    issues: parseIssues(profile?.issues),
    installation,
    defaultDevice: text(hardware.default_device) ?? devices[0]?.device ?? 'cpu:0',
    devices,
  };
}
