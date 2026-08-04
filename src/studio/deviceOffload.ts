import type { StudioOffloadMode } from './types';

export type StudioDeviceOffloadPlan = {
  device: string;
  autoOffload: boolean;
  offloadMode: StudioOffloadMode;
};

export function supportsStudioCpuOffload(device: unknown) {
  // PyTorch exposes AMD ROCm through the CUDA device type. Keep this contract
  // aligned with the backend's CPU_OFFLOAD_ACCELERATOR_TYPES.
  return /^cuda(?::\d+)?$/i.test(String(device ?? '').trim());
}

export function normalizeStudioDeviceOffloadPlan<T extends StudioDeviceOffloadPlan>(plan: T): T {
  if (!supportsStudioCpuOffload(plan.device) || !plan.autoOffload || plan.offloadMode === 'none') {
    return {
      ...plan,
      autoOffload: false,
      offloadMode: 'none',
    };
  }
  return plan;
}

export function studioDeviceOffloadConflict(
  plan: Partial<StudioDeviceOffloadPlan> & Pick<StudioDeviceOffloadPlan, 'device'>,
) {
  if (supportsStudioCpuOffload(plan.device)) return null;
  if (plan.autoOffload !== true && (!plan.offloadMode || plan.offloadMode === 'none')) return null;
  const device = String(plan.device || 'This device');
  return `${device} execution cannot use ${plan.offloadMode && plan.offloadMode !== 'none' ? plan.offloadMode : 'automatic CPU'} offload. Diffusers CPU-offload hooks require a CUDA or ROCm execution device; otherwise turn off offload.`;
}

export function studioOffloadPlanConflict(
  plan: Partial<StudioDeviceOffloadPlan> & Pick<StudioDeviceOffloadPlan, 'device'>,
) {
  if (typeof plan.autoOffload === 'boolean' && plan.offloadMode && plan.autoOffload !== (plan.offloadMode !== 'none')) {
    return `Auto offload is ${plan.autoOffload ? 'enabled' : 'disabled'}, but the selected offload mode is ${plan.offloadMode}. Keep the switch and mode consistent.`;
  }
  return studioDeviceOffloadConflict(plan);
}
