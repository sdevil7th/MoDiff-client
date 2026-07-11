import type { RuntimeStatus } from '../stores/useNodeStore';
import {
  formatVram,
  getPreferredRuntimeDevice,
  getRuntimeCudaDevice,
  getRuntimeMpsDevice,
  QWEN_MIN_CUDA_TOTAL_BYTES,
} from './runReadiness';
import { getStudioModelArtifactNote, getStudioModelDisplayName } from './modelProfiles';
import type { StudioModelProfile } from './types';

const GIB = 1024 ** 3;
const Z_IMAGE_MIN_CUDA_TOTAL_BYTES = 8 * GIB;
const Z_IMAGE_RECOMMENDED_CUDA_TOTAL_BYTES = 12 * GIB;
const QWEN_RECOMMENDED_CUDA_TOTAL_BYTES = 24 * GIB;
const WAN_MIN_CUDA_TOTAL_BYTES = 8 * GIB;
const WAN_RECOMMENDED_CUDA_TOTAL_BYTES = 16 * GIB;
const ACE_AUDIO_MIN_CUDA_TOTAL_BYTES = 12 * GIB;
const ACE_AUDIO_RECOMMENDED_CUDA_TOTAL_BYTES = 16 * GIB;
const FLUX_SCHNELL_MIN_CUDA_TOTAL_BYTES = 12 * GIB;
const FLUX_SCHNELL_RECOMMENDED_CUDA_TOTAL_BYTES = 16 * GIB;
const FLUX_NATIVE_RECOMMENDED_CUDA_TOTAL_BYTES = 24 * GIB;

export type ModelHardwareFitStatus = 'ready' | 'warning' | 'blocked' | 'unknown';

export type ModelHardwareFit = {
  status: ModelHardwareFitStatus;
  label: string;
  message: string;
  details?: string;
};

function cudaRuleForProfile(profile: StudioModelProfile) {
  if (profile.family === 'Qwen Image') {
    return {
      minimumBytes: QWEN_MIN_CUDA_TOTAL_BYTES,
      recommendedBytes: QWEN_RECOMMENDED_CUDA_TOTAL_BYTES,
      fallback: `${getStudioModelDisplayName(profile)} should use Diffusers 4-bit BnB quantization, bfloat16, auto-offload, and backend VRAM budgeting on smaller CUDA devices. A successful low-memory run on the same machine usually means an FP8/GGUF or otherwise quantized path, not this bfloat16 Diffusers repo. ${getStudioModelArtifactNote(profile)}.`,
    };
  }

  if (profile.family === 'Wan Video') {
    return {
      minimumBytes: WAN_MIN_CUDA_TOTAL_BYTES,
      recommendedBytes: WAN_RECOMMENDED_CUDA_TOTAL_BYTES,
      fallback:
        'Use Video preview or Video low VRAM, keep bfloat16 and auto-offload enabled, or reduce frames before running.',
    };
  }

  if (profile.family === 'ACE Audio') {
    return {
      minimumBytes: ACE_AUDIO_MIN_CUDA_TOTAL_BYTES,
      recommendedBytes: ACE_AUDIO_RECOMMENDED_CUDA_TOTAL_BYTES,
      fallback:
        'Use Auto with bfloat16, model CPU offload, shorter durations, and SSD-backed emergency offload only if RAM pressure is high. CPU execution is only a slow smoke fallback.',
    };
  }

  if (profile.family === 'FLUX Image') {
    const isSchnell = profile.modelType === 'FluxSchnellPipeline';
    return {
      minimumBytes: isSchnell ? FLUX_SCHNELL_MIN_CUDA_TOTAL_BYTES : FLUX_SCHNELL_RECOMMENDED_CUDA_TOTAL_BYTES,
      recommendedBytes: isSchnell
        ? FLUX_SCHNELL_RECOMMENDED_CUDA_TOTAL_BYTES
        : FLUX_NATIVE_RECOMMENDED_CUDA_TOTAL_BYTES,
      fallback: isSchnell
        ? 'Use Auto with bfloat16, 4 steps, and model CPU offload. This is the FLUX candidate intended for 16 GB VRAM.'
        : 'Use a quantized artifact such as FP8/NVFP4 where available, or switch to Expert on a larger GPU. Auto should not install the native bfloat16 repo on constrained hardware unless a compatibility probe passes.',
    };
  }

  return {
    minimumBytes: Z_IMAGE_MIN_CUDA_TOTAL_BYTES,
    recommendedBytes: Z_IMAGE_RECOMMENDED_CUDA_TOTAL_BYTES,
    fallback:
      'Use Auto, enable Expert offload, install a compatible artifact, or use a larger CUDA device for more reliable runs.',
  };
}

export function getStudioModelHardwareFit(
  profile: StudioModelProfile,
  runtimeStatus: RuntimeStatus | null,
  device = getPreferredRuntimeDevice(runtimeStatus),
): ModelHardwareFit {
  if (!runtimeStatus) {
    return {
      status: 'unknown',
      label: 'Hardware pending',
      message: 'Runtime hardware has not been checked yet.',
    };
  }

  if (device.toLowerCase().startsWith('mps')) {
    const torchStatus = runtimeStatus.packages?.torch;
    if (!torchStatus?.mps_available || !getRuntimeMpsDevice(runtimeStatus, device)) {
      return {
        status: 'blocked',
        label: 'MPS unavailable',
        message: `${getStudioModelDisplayName(profile)} is not runnable on Apple MPS because this backend did not report MPS availability.`,
        details:
          'Use a CUDA backend, choose CPU for a very slow smoke test, or install a PyTorch build with Apple Metal support.',
      };
    }

    if (
      profile.family === 'Qwen Image' ||
      profile.family === 'Wan Video' ||
      profile.family === 'ACE Audio' ||
      profile.family === 'FLUX Image'
    ) {
      return {
        status: 'blocked',
        label: 'MPS unverified',
        message: `${getStudioModelDisplayName(profile)} is guarded on Apple MPS until a real model run is validated.`,
        details:
          profile.family === 'Wan Video'
            ? 'Wan video workflows are CUDA-oriented and should run on a Linux/Windows CUDA backend for now.'
            : 'Use Z-Image Turbo for local text-to-image smoke testing, CPU for a slow experiment, or run this profile on a CUDA backend.',
      };
    }

    return {
      status: 'warning',
      label: 'MPS experimental',
      message: `${getStudioModelDisplayName(profile)} may run on Apple MPS, but output quality, speed, and memory behavior are not certified yet.`,
      details: 'Keep sizes and steps low until an Apple Silicon workflow produces verified outputs.',
    };
  }

  if (!device.toLowerCase().startsWith('cuda')) {
    return {
      status: 'warning',
      label: 'CPU selected',
      message: `${getStudioModelDisplayName(profile)} can be downloaded, but CPU runs are expected to be very slow.`,
      details: 'Switch to a CUDA device before downloading if this model is only useful on the current machine.',
    };
  }

  const torchStatus = runtimeStatus.packages?.torch;
  if (!torchStatus?.cuda_available) {
    return {
      status: 'blocked',
      label: 'CUDA unavailable',
      message: `${getStudioModelDisplayName(profile)} is unlikely to be usable on this machine without CUDA.`,
      details: 'Download only if you plan to move the cache to another compatible machine or run a very slow CPU test.',
    };
  }

  const cudaDevice = getRuntimeCudaDevice(runtimeStatus, device);
  const totalBytes = cudaDevice?.memory_total_bytes ?? cudaDevice?.total_memory ?? null;
  const freeBytes = cudaDevice?.memory_free_bytes ?? null;
  if (!totalBytes) {
    return {
      status: 'unknown',
      label: 'VRAM unknown',
      message: `${getStudioModelDisplayName(profile)} compatibility cannot be estimated because CUDA memory was not reported.`,
    };
  }

  const rule = cudaRuleForProfile(profile);
  const memoryLabel = freeBytes
    ? `${formatVram(freeBytes)} free / ${formatVram(totalBytes)} total`
    : `${formatVram(totalBytes)} total`;

  if (totalBytes < rule.minimumBytes) {
    if (profile.family === 'Qwen Image') {
      return {
        status: 'warning',
        label: 'Constrained hardware',
        message: `${getStudioModelDisplayName(profile)} needs a hardware-aware Auto recipe on this ${memoryLabel} CUDA device.`,
        details: rule.fallback,
      };
    }

    return {
      status: 'blocked',
      label: 'Likely blocked',
      message: `${getStudioModelDisplayName(profile)} is likely not runnable on this ${memoryLabel} CUDA device.`,
      details: rule.fallback,
    };
  }

  if (
    profile.family === 'FLUX Image' &&
    profile.modelType !== 'FluxSchnellPipeline' &&
    totalBytes < rule.recommendedBytes
  ) {
    return {
      status: 'warning',
      label: 'Works with quantized artifact',
      message: `${getStudioModelDisplayName(profile)} native bfloat16 is not a good fit for this ${memoryLabel} CUDA device.`,
      details: rule.fallback,
    };
  }

  if (totalBytes < rule.recommendedBytes) {
    return {
      status: 'warning',
      label:
        profile.family === 'ACE Audio' || profile.family === 'FLUX Image'
          ? 'Works here with Auto'
          : 'Constrained hardware',
      message: `${getStudioModelDisplayName(profile)} may need Auto offload or a compatible artifact on this ${memoryLabel} CUDA device.`,
      details: rule.fallback,
    };
  }

  return {
    status: 'ready',
    label: 'Hardware fit',
    message: `${getStudioModelDisplayName(profile)} looks compatible with this ${memoryLabel} CUDA device.`,
  };
}
