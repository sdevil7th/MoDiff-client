import { STUDIO_MODEL_LABELS, STUDIO_MODE_LABELS } from './modelProfiles';
import type { StudioMode, StudioModelProfile, StudioModelType } from './types';

export type ExactStudioCapabilitySupport = {
  capability: StudioModelProfile | null;
  modes: StudioMode[];
  reason: 'capabilities_unavailable' | 'mode_not_advertised' | 'model_not_advertised' | 'supported';
  status: 'supported' | 'unknown' | 'unsupported';
};

export function isStudioMode(value: unknown): value is StudioMode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STUDIO_MODE_LABELS, value);
}

export function isStudioModelType(value: unknown): value is StudioModelType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STUDIO_MODEL_LABELS, value);
}

export function advertisedStudioModes(capability: StudioModelProfile): StudioMode[] {
  // Schema v2 deliberately distinguishes an explicit empty runnableModes list
  // from an older capability record that has no runnableModes field.
  return capability.runnableModes !== undefined ? capability.runnableModes : capability.modes;
}

export function exactStudioCapabilitySupport(
  capabilities: StudioModelProfile[],
  authoritative: boolean,
  modelType: StudioModelType,
  mode: StudioMode,
): ExactStudioCapabilitySupport {
  const capability = authoritative ? (capabilities.find((item) => item.modelType === modelType) ?? null) : null;
  const modes = capability ? advertisedStudioModes(capability) : [];
  const supported = Boolean(capability && modes.includes(mode));
  return {
    capability,
    modes,
    reason: !authoritative
      ? 'capabilities_unavailable'
      : !capability
        ? 'model_not_advertised'
        : supported
          ? 'supported'
          : 'mode_not_advertised',
    status: !authoritative ? 'unknown' : supported ? 'supported' : 'unsupported',
  };
}

export function exactStudioCapabilityUnsupportedMessage(
  modelType: StudioModelType,
  mode: StudioMode,
  support: ExactStudioCapabilitySupport,
) {
  if (support.status !== 'unsupported') return '';
  if (support.reason === 'model_not_advertised') {
    return `${STUDIO_MODEL_LABELS[modelType]} is not advertised by the connected backend.`;
  }
  return `${STUDIO_MODEL_LABELS[modelType]} does not support ${STUDIO_MODE_LABELS[mode]} on the connected backend.`;
}
