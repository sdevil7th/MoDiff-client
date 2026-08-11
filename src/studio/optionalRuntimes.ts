import {
  invalidRuntimeContract as invalid,
  runtimeRecord as record,
  runtimeText as string,
} from './runtimeOptimizations';

export type OptionalRuntimeRequirement = {
  schemaVersion: 1;
  delivery: 'base' | 'optional_overlay';
  requiredNow: boolean;
  profileIds: string[];
  executionProfileIds: string[];
  state:
    | 'active'
    | 'base_satisfied'
    | 'busy_recovery_only'
    | 'missing'
    | 'present_unqualified'
    | 'repair_required'
    | 'restart_required'
    | 'staged'
    | 'unavailable'
    | 'wrong_version';
  reason: string;
};

export type OptionalRuntimeProfileStatus = {
  id: string;
  label: string;
  specDigest: string;
  contractState: string;
  cutoverReady: boolean;
  installActionAvailable: boolean;
  activationAvailable: boolean;
  status: 'missing' | 'present_unqualified' | 'wrong_version';
  overlayStatus: 'active' | 'missing' | 'repair_required' | 'staged' | 'staged_unchecked';
};

export type OptionalRuntimeCatalog = {
  profiles: OptionalRuntimeProfileStatus[];
  processLoadStatus: 'active' | 'base' | 'busy_recovery_only' | 'repair_required' | 'restart_required';
};

type StudioRuntimeDtype = 'float32' | 'float16' | 'bfloat16';
type StudioRuntimeQuantization = 'bnb_4bit' | 'bnb_8bit' | 'quanto_float8' | 'torchao_float8';

export type StudioExpertCudaPolicy = {
  schema_version: 1;
  blocked_dtypes: StudioRuntimeDtype[];
  recommended_dtype: StudioRuntimeDtype;
  offloaded_vram_bytes: number;
  resident_vram_bytes: number;
  quantized_resident_vram_bytes: Array<[StudioRuntimeQuantization, number]>;
};

const runtimeId = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const executionId = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const delivery = /^(?:base|optional_overlay)$/;
const requirementState =
  /^(?:active|base_satisfied|busy_recovery_only|missing|present_unqualified|repair_required|restart_required|staged|unavailable|wrong_version)$/;
const runtimeDtype = /^(?:float32|float16|bfloat16)$/;
const runtimeQuantization = /^(?:bnb_4bit|bnb_8bit|quanto_float8|torchao_float8)$/;
const EXPERT_CUDA_POLICY_KEYS =
  'blocked_dtypes,offloaded_vram_bytes,quantized_resident_vram_bytes,recommended_dtype,resident_vram_bytes,schema_version';

function ids(value: unknown, pattern: RegExp, allowEmpty: boolean) {
  if (!Array.isArray(value) || value.length > 32 || (!allowEmpty && !value.length)) invalid();
  const result = value.map((id) => string(id, pattern));
  if (new Set(result).size !== result.length) invalid();
}

function contractKey(requirement: OptionalRuntimeRequirement) {
  return `${requirement.delivery}|${requirement.requiredNow}|${[...requirement.profileIds].sort().join(',')}|${requirement.state}|${requirement.reason}`;
}

export function parseRuntimeModes<T extends string>(value: unknown, isMode: (value: unknown) => value is T) {
  if (!Array.isArray(value) || value.length > 32 || value.some((mode) => typeof mode !== 'string')) invalid();
  const modes = value.filter(isMode);
  if (new Set(modes).size !== modes.length) invalid();
  return modes;
}

export function parseOptionalRuntimeRequirement(value: unknown): OptionalRuntimeRequirement {
  const item = record(value);
  if (Object.keys(item).length !== 7 || item.schemaVersion !== 1 || typeof item.requiredNow !== 'boolean') invalid();
  string(item.delivery, delivery);
  const base = item.delivery === 'base';
  ids(item.profileIds, runtimeId, base);
  ids(item.executionProfileIds, executionId, base);
  string(item.state, requirementState);
  if (
    (base && (item.requiredNow || item.state !== 'base_satisfied')) ||
    (!base && (!item.requiredNow || item.state === 'base_satisfied'))
  )
    invalid();
  string(item.reason, /^[a-z][a-z0-9_]{0,127}$/);
  return item as unknown as OptionalRuntimeRequirement;
}

function runtimeBytes(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 1024 ** 4) invalid();
  return value as number;
}

function parseExpertCudaPolicy(value: unknown): StudioExpertCudaPolicy {
  const item = record(value);
  if (Object.keys(item).sort().join() !== EXPERT_CUDA_POLICY_KEYS || item.schema_version !== 1) invalid();
  if (!Array.isArray(item.blocked_dtypes) || !item.blocked_dtypes.length || item.blocked_dtypes.length > 3) invalid();
  const blocked = item.blocked_dtypes.map((dtype) => string(dtype, runtimeDtype) as StudioRuntimeDtype);
  const recommended = string(item.recommended_dtype, runtimeDtype) as StudioRuntimeDtype;
  if (new Set(blocked).size !== blocked.length || blocked.includes(recommended)) invalid();
  if (!Array.isArray(item.quantized_resident_vram_bytes) || item.quantized_resident_vram_bytes.length > 4) invalid();
  const quantized = item.quantized_resident_vram_bytes.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) invalid();
    return [string(entry[0], runtimeQuantization), runtimeBytes(entry[1])] as [StudioRuntimeQuantization, number];
  });
  if (new Set(quantized.map(([mode]) => mode)).size !== quantized.length) invalid();
  return {
    schema_version: 1,
    blocked_dtypes: blocked,
    recommended_dtype: recommended,
    offloaded_vram_bytes: runtimeBytes(item.offloaded_vram_bytes),
    resident_vram_bytes: runtimeBytes(item.resident_vram_bytes),
    quantized_resident_vram_bytes: quantized,
  };
}

export function parseOptionalRuntimeExecutionProfiles<T extends string>(
  value: unknown,
  aggregate: OptionalRuntimeRequirement | undefined,
  isMode: (value: unknown) => value is T,
) {
  if (!Array.isArray(value) || value.length > 32) invalid();
  const profiles = value.map((raw) => {
    const profile = record(raw);
    const id = string(profile.id, executionId);
    const modes = parseRuntimeModes(profile.modes, isMode);
    if (profile.optionalRuntimeRequirement !== undefined && profile.optional_runtime_requirement !== undefined)
      invalid();
    const rawRequirement = profile.optionalRuntimeRequirement ?? profile.optional_runtime_requirement;
    const requirement = rawRequirement === undefined ? undefined : parseOptionalRuntimeRequirement(rawRequirement);
    const expertCudaPolicy =
      profile.expert_cuda_policy === undefined ? undefined : parseExpertCudaPolicy(profile.expert_cuda_policy);
    if (
      (profile.optional_runtime_delivery !== undefined &&
        !delivery.test(profile.optional_runtime_delivery as string)) ||
      (requirement &&
        (requirement.executionProfileIds.length !== 1 ||
          requirement.executionProfileIds[0] !== id ||
          (profile.optional_runtime_delivery !== undefined &&
            profile.optional_runtime_delivery !== requirement.delivery)))
    )
      invalid();
    delete profile.optional_runtime_requirement;
    profile.modes = modes;
    profile.optionalRuntimeRequirement = requirement;
    if (expertCudaPolicy) profile.expert_cuda_policy = expertCudaPolicy;
    return profile as Record<string, unknown> & {
      id: string;
      modes: T[];
      optionalRuntimeRequirement?: OptionalRuntimeRequirement;
      expert_cuda_policy?: StudioExpertCudaPolicy;
    };
  });
  if (new Set(profiles.map(({ id }) => id)).size !== profiles.length) invalid();
  const withRequirement = profiles.filter((profile) => profile.optionalRuntimeRequirement).length;
  if (
    (withRequirement > 0 && withRequirement < profiles.length) ||
    (aggregate && (!profiles.length || !withRequirement))
  )
    invalid();
  if (aggregate) {
    const actualIds = profiles.map(({ id }) => id).sort();
    if (actualIds.join('|') !== [...aggregate.executionProfileIds].sort().join('|')) invalid();
  }
  const contracts = profiles.map(({ optionalRuntimeRequirement }) =>
    optionalRuntimeRequirement ? contractKey(optionalRuntimeRequirement) : '',
  );
  if (aggregate && new Set(contracts).size === 1 && contracts[0] !== contractKey(aggregate)) invalid();
  for (const mode of new Set(profiles.flatMap(({ modes }) => modes))) {
    if (
      new Set(profiles.flatMap((profile, index) => (profile.modes.includes(mode) ? [contracts[index]] : []))).size > 1
    )
      invalid();
  }
  return profiles;
}

function parseProfile(value: unknown): OptionalRuntimeProfileStatus {
  const item = record(value);
  if (
    item.schemaVersion !== 1 ||
    ['cutoverReady', 'installActionAvailable', 'activationAvailable'].some((key) => typeof item[key] !== 'boolean')
  )
    invalid();
  string(item.id, runtimeId);
  string(item.label);
  string(item.specDigest, /^sha256:[0-9a-f]{64}$/);
  string(item.contractState);
  string(item.status, /^(?:missing|present_unqualified|wrong_version)$/);
  string(item.overlayStatus, /^(?:active|missing|repair_required|staged|staged_unchecked)$/);
  return item as unknown as OptionalRuntimeProfileStatus;
}

export function parseOptionalRuntimeCatalog(value: unknown): OptionalRuntimeCatalog {
  const payload = record(value);
  const overlay = record(payload.overlay);
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.profiles) || payload.profiles.length > 32) invalid();
  const profiles = payload.profiles.map(parseProfile);
  if (new Set(profiles.map(({ id }) => id)).size !== profiles.length) invalid();
  return {
    profiles,
    processLoadStatus: string(
      overlay.processLoadStatus,
      /^(?:active|base|busy_recovery_only|repair_required|restart_required)$/,
    ) as OptionalRuntimeCatalog['processLoadStatus'],
  };
}

export function optionalRuntimeBlockState(
  requirement: OptionalRuntimeRequirement | undefined,
  catalog: OptionalRuntimeCatalog | null,
): OptionalRuntimeRequirement['state'] | null {
  if (!requirement?.requiredNow) return null;
  if (requirement.state !== 'active') return requirement.state;
  if (!catalog || catalog.processLoadStatus === 'base') return 'unavailable';
  if (catalog.processLoadStatus !== 'active') return catalog.processLoadStatus;
  for (const profileId of requirement.profileIds) {
    const profile = catalog.profiles.find(({ id }) => id === profileId);
    if (!profile?.cutoverReady || profile.contractState !== 'qualified') return 'unavailable';
    if (profile.overlayStatus !== 'active') {
      if (profile.overlayStatus === 'staged' || profile.overlayStatus === 'repair_required')
        return profile.overlayStatus;
      return profile.status;
    }
  }
  return null;
}
