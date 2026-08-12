import {
  invalidRuntimeContract as invalid,
  runtimeRecord as record,
  runtimeText as string,
} from './runtimeOptimizations';
import { REPO_ID } from './executionSpecs';

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
  platform: 'linux' | 'macos' | 'windows';
  machine: 'arm64' | 'x86_64';
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
  stagedEnvironmentIds: Record<string, string>;
  previousEnvironmentId: string | null;
  installBusy: boolean;
};

export type OptionalRuntimeJob = {
  id: string;
  profileId: string;
  specDigest: string;
  status: 'queued' | 'running' | 'cancelling' | 'cancelled' | 'failed' | 'ready';
  progress: {
    phase:
      | 'queued'
      | 'copying'
      | 'downloading'
      | 'installing'
      | 'validating'
      | 'promoting'
      | 'ready'
      | 'cancelling'
      | 'cancelled'
      | 'failed';
    message: string;
  };
  result?: {
    environmentId: string;
    requiresActivation: boolean;
  };
};

export type OptionalRuntimeMutation = {
  restartRequired: boolean;
  restarting: boolean;
  message?: string;
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

export type StudioExpertQuantizationPolicy = {
  schema_version: 1;
  quantization_mode: 'bnb_4bit';
  offload_mode: 'model_cpu' | 'sequential_cpu' | 'group_cpu' | 'group_disk';
  modular_node: string;
  subfolder: string;
  component: string;
  four_bit_quant_type: 'nf4' | 'fp4';
  compute_dtype: StudioRuntimeDtype;
  double_quant: boolean;
};

export type StudioExpertMpsPolicy = {
  schema_version: 1;
  qualification: 'unqualified' | 'experimental';
  fallback_action: 'open_setup' | 'switch_to_z_image';
};

const runtimeId = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const executionId = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const environmentId = /^runtime-[0-9]{1,16}-[0-9a-f]{8}$/;
const jobId = /^optjob-[A-Za-z0-9_-]{12}$/;
const specDigest = /^sha256:[0-9a-f]{64}$/;
const delivery = /^(?:base|optional_overlay)$/;
const requirementState =
  /^(?:active|base_satisfied|busy_recovery_only|missing|present_unqualified|repair_required|restart_required|staged|unavailable|wrong_version)$/;
const runtimeDtype = /^(?:float32|float16|bfloat16)$/;
const runtimeQuantization = /^(?:bnb_4bit|bnb_8bit|quanto_float8|torchao_float8)$/;
const EXPERT_CUDA_POLICY_KEYS =
  'blocked_dtypes,offloaded_vram_bytes,quantized_resident_vram_bytes,recommended_dtype,resident_vram_bytes,schema_version';
const EXPERT_QUANTIZATION_POLICY_KEYS =
  'component,compute_dtype,double_quant,four_bit_quant_type,modular_node,offload_mode,quantization_mode,schema_version,subfolder';
const EXPERT_MPS_POLICY_KEYS = 'fallback_action,qualification,schema_version';

function ids(value: unknown, pattern: RegExp, allowEmpty: boolean) {
  if (!Array.isArray(value) || value.length > 32 || (!allowEmpty && !value.length)) invalid();
  const result = value.map((id) => string(id, pattern));
  if (new Set(result).size !== result.length) invalid();
  return result;
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

function parseExpertQuantizationPolicy(value: unknown): StudioExpertQuantizationPolicy {
  const item = record(value);
  if (
    Object.keys(item).sort().join() !== EXPERT_QUANTIZATION_POLICY_KEYS ||
    item.schema_version !== 1 ||
    item.quantization_mode !== 'bnb_4bit' ||
    typeof item.double_quant !== 'boolean'
  )
    invalid();
  return {
    schema_version: 1,
    quantization_mode: 'bnb_4bit',
    offload_mode: string(
      item.offload_mode,
      /^(?:model_cpu|sequential_cpu|group_cpu|group_disk)$/,
    ) as StudioExpertQuantizationPolicy['offload_mode'],
    modular_node: string(item.modular_node, /^modules\.[A-Za-z\d_]+\.[A-Za-z\d_]+$/)!,
    subfolder: string(item.subfolder, /^[a-z][a-z\d_]{0,63}$/)!,
    component: string(item.component, /^[a-z][a-z\d_]{0,63}$/)!,
    four_bit_quant_type: string(item.four_bit_quant_type, /^(?:nf4|fp4)$/) as 'nf4' | 'fp4',
    compute_dtype: string(item.compute_dtype, runtimeDtype) as StudioRuntimeDtype,
    double_quant: item.double_quant,
  };
}

function parseExpertMpsPolicy(value: unknown): StudioExpertMpsPolicy {
  const item = record(value);
  if (Object.keys(item).sort().join() !== EXPERT_MPS_POLICY_KEYS || item.schema_version !== 1) invalid();
  return {
    schema_version: 1,
    qualification: string(
      item.qualification,
      /^(?:unqualified|experimental)$/,
    ) as StudioExpertMpsPolicy['qualification'],
    fallback_action: string(
      item.fallback_action,
      /^(?:open_setup|switch_to_z_image)$/,
    ) as StudioExpertMpsPolicy['fallback_action'],
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
    for (const repo of [profile.default_repo, profile.fallback_repo]) if (repo != null) string(repo, REPO_ID);
    if (profile.compatible_repos !== undefined) ids(profile.compatible_repos, REPO_ID, true);
    if (profile.optionalRuntimeRequirement !== undefined && profile.optional_runtime_requirement !== undefined)
      invalid();
    const rawRequirement = profile.optionalRuntimeRequirement ?? profile.optional_runtime_requirement;
    const requirement = rawRequirement === undefined ? undefined : parseOptionalRuntimeRequirement(rawRequirement);
    const expertCudaPolicy =
      profile.expert_cuda_policy === undefined ? undefined : parseExpertCudaPolicy(profile.expert_cuda_policy);
    const expertQuantizationPolicy =
      profile.expert_quantization_policy === undefined
        ? undefined
        : parseExpertQuantizationPolicy(profile.expert_quantization_policy);
    const expertMpsPolicy =
      profile.expert_mps_policy === undefined ? undefined : parseExpertMpsPolicy(profile.expert_mps_policy);
    const expertQuantizationModes =
      profile.expert_quantization_modes === undefined
        ? undefined
        : (ids(profile.expert_quantization_modes, runtimeQuantization, false) as StudioRuntimeQuantization[]);
    if (expertQuantizationModes && expertQuantizationModes.length > 4) invalid();
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
    if (expertQuantizationPolicy) profile.expert_quantization_policy = expertQuantizationPolicy;
    if (expertMpsPolicy) profile.expert_mps_policy = expertMpsPolicy;
    if (expertQuantizationModes) profile.expert_quantization_modes = expertQuantizationModes;
    return profile as Record<string, unknown> & {
      id: string;
      modes: T[];
      optionalRuntimeRequirement?: OptionalRuntimeRequirement;
      expert_cuda_policy?: StudioExpertCudaPolicy;
      expert_quantization_policy?: StudioExpertQuantizationPolicy;
      expert_mps_policy?: StudioExpertMpsPolicy;
      expert_quantization_modes?: StudioRuntimeQuantization[];
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
  string(item.platform, /^(?:linux|macos|windows)$/);
  string(item.machine, /^(?:arm64|x86_64)$/);
  string(item.specDigest, specDigest);
  string(item.contractState);
  string(item.status, /^(?:missing|present_unqualified|wrong_version)$/);
  string(item.overlayStatus, /^(?:active|missing|repair_required|staged|staged_unchecked)$/);
  return item as unknown as OptionalRuntimeProfileStatus;
}

function nullableId(value: unknown, pattern: RegExp) {
  return value === null ? null : string(value, pattern)!;
}

export function parseOptionalRuntimeCatalog(value: unknown): OptionalRuntimeCatalog {
  const payload = record(value);
  const overlay = record(payload.overlay);
  const state = record(overlay.state);
  if (
    payload.schemaVersion !== 1 ||
    !Array.isArray(payload.profiles) ||
    payload.profiles.length > 32 ||
    !Array.isArray(overlay.environments) ||
    overlay.environments.length > 64
  )
    invalid();
  const profiles = payload.profiles.map(parseProfile);
  if (new Set(profiles.map(({ id }) => id)).size !== profiles.length) invalid();
  nullableId(state.activeEnvironmentId, environmentId);
  const stagedEnvironmentIds: Record<string, string> = {};
  const ambiguousSpecs = new Set<string>();
  const seenEnvironments = new Set<string>();
  for (const rawEnvironment of overlay.environments) {
    const environment = record(rawEnvironment);
    const id = string(environment.id, environmentId)!;
    const status = string(
      environment.status,
      /^(?:legacy_unqualified|missing|ready|repair_required|staged_unchecked)$/,
    );
    if (
      seenEnvironments.has(id) ||
      typeof environment.active !== 'boolean' ||
      !Array.isArray(environment.specs) ||
      environment.specs.length > 32
    )
      invalid();
    seenEnvironments.add(id);
    for (const rawSpec of environment.specs) {
      const spec = record(rawSpec);
      if (!['optimization', 'optional_runtime'].includes(spec.kind as string)) invalid();
      const profileId = string(spec.id, runtimeId)!;
      const digest = string(spec.specDigest, specDigest)!;
      if (spec.kind === 'optional_runtime' && !environment.active && ['ready', 'staged_unchecked'].includes(status!)) {
        const key = profileId + digest;
        if (stagedEnvironmentIds[key]) {
          delete stagedEnvironmentIds[key];
          ambiguousSpecs.add(key);
        } else if (!ambiguousSpecs.has(key)) stagedEnvironmentIds[key] = id;
      }
    }
  }
  if (payload.activeInstallJob !== null) {
    const activeJob = record(payload.activeInstallJob);
    if (activeJob.ownerKind !== null && !['optional_runtime', 'optimization'].includes(activeJob.ownerKind as string))
      invalid();
    if (activeJob.ownerId !== null) string(activeJob.ownerId, runtimeId);
  }
  return {
    profiles,
    processLoadStatus: string(
      overlay.processLoadStatus,
      /^(?:active|base|busy_recovery_only|repair_required|restart_required)$/,
    ) as OptionalRuntimeCatalog['processLoadStatus'],
    stagedEnvironmentIds,
    previousEnvironmentId: nullableId(state.previousEnvironmentId, environmentId),
    installBusy: payload.activeInstallJob !== null,
  };
}

function parseJob(value: unknown): OptionalRuntimeJob {
  const item = record(value);
  const progress = record(item.progress);
  const parsed: OptionalRuntimeJob = {
    id: string(item.id, jobId)!,
    profileId: string(item.profileId, runtimeId)!,
    specDigest: string(item.specDigest, specDigest)!,
    status: string(
      item.status,
      /^(?:queued|running|cancelling|cancelled|failed|ready)$/,
    ) as OptionalRuntimeJob['status'],
    progress: {
      phase: string(
        progress.phase,
        /^(?:queued|copying|downloading|installing|validating|promoting|ready|cancelling|cancelled|failed)$/,
      ) as OptionalRuntimeJob['progress']['phase'],
      message: string(progress.message)!,
    },
  };
  if (item.result !== undefined) {
    const result = record(item.result);
    if (typeof result.requiresActivation !== 'boolean') invalid();
    parsed.result = {
      environmentId: string(result.environmentId, environmentId)!,
      requiresActivation: result.requiresActivation,
    };
  }
  return parsed;
}

export function parseOptionalRuntimeJobResponse(value: unknown) {
  const payload = record(value);
  if (payload.error !== false) invalid();
  return parseJob(payload.job);
}

export function parseOptionalRuntimeMutation(value: unknown): OptionalRuntimeMutation {
  const payload = record(value);
  if (
    payload.error !== false ||
    typeof payload.restartRequired !== 'boolean' ||
    typeof payload.restarting !== 'boolean'
  )
    invalid();
  return {
    restartRequired: payload.restartRequired,
    restarting: payload.restarting,
    message: string(payload.message, undefined, true),
  };
}

export function stagedOptionalRuntimeEnvironment(
  catalog: OptionalRuntimeCatalog,
  profile: OptionalRuntimeProfileStatus,
) {
  return catalog.stagedEnvironmentIds[profile.id + profile.specDigest];
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
