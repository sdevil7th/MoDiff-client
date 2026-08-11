import config from '../../app.config';
import { executableFlowNodes, type FlowGraphNode } from '../stores/flowGraphExport';
import { deepEqual } from '../utils/deepEqual';
import { formatRequestError, requestJson } from '../utils/requestJson';
import { normalizeStudioDeviceOffloadPlan, studioOffloadPlanConflict } from './deviceOffload';
import { AUTO_RESOURCE_LOADER_TARGETS, AUTO_RESOURCE_TARGET_KEYS } from './resourcePlanner';
import type { StudioFormState, StudioOffloadMode, StudioResourcePreference } from './types';

export { autoProofIsReady } from './resourcePlanner';

export type StudioAutoResourceHealthBadge =
  | 'Ran here'
  | 'This should work'
  | 'Community option'
  | 'Needs setup'
  | 'Repair required'
  | 'Failed here before'
  | 'Expert only'
  | 'Not suitable locally'
  | string;

export type StudioAutoResourceProof = {
  status?:
    | 'passed'
    | 'failed'
    | 'unproven'
    | 'skipped'
    | 'declared_safe'
    | 'live_proven'
    | 'manual_only'
    | 'known_bad'
    | 'failed_here_before'
    | string;
  source?: string;
  message?: string | null;
  category?: string | null;
  errorCode?: string | null;
  checkedAt?: number | null;
};

export type StudioAutoResourceArtifactStatus = {
  installed?: boolean;
  complete?: boolean;
  repairRequired?: boolean;
  reason?: string | null;
  missingFiles?: string[];
  corruptFiles?: string[];
  activeFiles?: string[];
  snapshots?: unknown[];
};

export type StudioAutoResourceCandidate = {
  id: string;
  autoResourceSchemaVersion?: number;
  executionProfileId?: string;
  rank?: number;
  modelType?: string;
  mode?: string;
  loaderModule?: string;
  loaderAction?: string;
  executionPath?: string;
  pipelineClass?: string;
  studioExecutionSpecContract?: {
    schemaVersion?: number;
    id?: string;
    contentHash?: string;
    executionProfileId?: string;
  };
  artifact?: string;
  artifactRevision?: string;
  modelRepo?: string;
  resolvedArtifact?: string;
  baseArtifact?: string;
  artifactFormat?: string;
  artifactTrust?: string;
  requiresConfirmation?: boolean;
  preference?: StudioResourcePreference;
  preferenceRank?: number;
  artifactResolution?: {
    base?: { repo?: string; revision?: string | null };
    resolved?: {
      repo?: string;
      revision?: string | null;
      format?: string;
      bits?: number | null;
      quantization?: string;
      components?: string[];
    };
    substituted?: boolean;
  };
  compatibilityEvidence?: {
    level?: 'ran_here' | 'documented' | 'estimated' | 'community' | 'blocked' | string;
    label?: StudioAutoResourceHealthBadge;
    source?: string;
    message?: string;
    checkedAt?: number;
    popularity?: { downloads?: number | null; likes?: number | null } | null;
  };
  dtype?: StudioFormState['dtype'] | string;
  quantizationMode?: StudioFormState['quantizationMode'] | string;
  quantizedComponents?: string[];
  bnb4ComputeDtype?: StudioFormState['dtype'] | string;
  offloadMode?: StudioOffloadMode | string;
  autoOffload?: boolean;
  deviceMap?: string;
  attentionBackend?: string;
  regionalCompile?: boolean;
  denoiserCache?: string;
  channelsLast?: boolean;
  layerwiseCasting?: boolean;
  optimizationQualification?: {
    status?: string;
    workloadKey?: string;
    selection?: Record<string, unknown>;
  };
  qualityTier?: string;
  qualityScore?: number;
  reason?: string;
  generation?: {
    width?: number;
    height?: number;
    steps?: number;
    guidanceScale?: number;
    negativePrompt?: string;
    maxSequenceLength?: number;
    audioDuration?: number;
    shift?: number;
    qualityPreset?: string;
  };
  installTarget?: {
    repo?: string;
    label?: string;
    reason?: string;
    actionLabel?: string;
    repair?: boolean;
    candidateId?: string;
  };
  requirements?: Record<string, unknown>;
  requiredPackages?: string[];
  installed?: boolean;
  artifactStatus?: StudioAutoResourceArtifactStatus | null;
  artifactValidation?: StudioAutoResourceArtifactStatus | null;
  repairRequired?: boolean;
  healthBadge?: StudioAutoResourceHealthBadge;
  canAutoRun?: boolean;
  failureHistory?: Record<string, unknown> | null;
  successHistory?: Record<string, unknown> | null;
  requiresLocalProbe?: boolean;
  skipReason?: string | null;
  readiness?: 'ready' | 'needs_setup' | 'manual_only' | 'known_bad' | string;
  artifactSource?: string;
  candidateReasons?: string[];
  knownBadReasons?: string[];
  requirementsMatched?: string[];
  requirementsMissing?: string[];
  proof?: StudioAutoResourceProof;
};

export type StudioAutoResourceInstallTarget = {
  repo: string;
  label: string;
  reason?: string;
  actionLabel?: string;
  repair?: boolean;
  candidateId?: string;
};

export type StudioCompatibilityAssessment = {
  state: 'checking' | 'ready' | 'needs_model' | 'needs_setup' | 'expert_only' | 'unsuitable';
  severity: 'success' | 'info' | 'warning' | 'error';
  code: string;
  summary: string;
  detail: string;
  action?: {
    type: string;
    label: string;
    repo?: string | null;
    candidateId?: string | null;
    command?: string | null;
  } | null;
  source: 'backend_auto_planner';
};

export type StudioAutoResourcePlan = {
  error?: boolean;
  schemaVersion?: number;
  resourceMode?: 'auto';
  resourcePreference?: StudioResourcePreference | string;
  status?: 'ready' | 'checking_hardware' | 'finding_artifacts' | 'needs_setup' | string;
  readiness?: 'ready' | 'needs_setup' | 'manual_only' | 'known_bad' | string;
  statusLabel?: string;
  blockingReason?: string | null;
  willNotWorkReason?: string | null;
  healthBadge?: StudioAutoResourceHealthBadge;
  compatibility?: StudioCompatibilityAssessment;
  canAutoRun?: boolean;
  repairRequired?: boolean;
  selectedInstallTarget?: StudioAutoResourceInstallTarget | null;
  failureHistory?: Array<Record<string, unknown>>;
  selectedCandidate?: StudioAutoResourceCandidate | null;
  candidates?: StudioAutoResourceCandidate[];
  nextCandidate?: StudioAutoResourceCandidate | null;
  hardware?: Record<string, unknown>;
  hardwareSnapshot?: Record<string, unknown>;
  modelRequirements?: Record<string, unknown>;
  requirementsMatched?: string[];
  requirementsMissing?: string[];
  candidateReasons?: string[];
  knownBadReasons?: string[];
  message?: string;
  issue?: {
    code?: string;
    category?: 'environment' | 'package' | 'model' | 'device' | string;
    message?: string;
    issues?: Array<{ code?: string; severity?: string; message?: string }>;
  };
  repairAction?: {
    type?: 'open_setup' | 'open_model_manager' | string;
    label?: string;
    command?: string | null;
  };
  runtimeProfile?: Record<string, unknown>;
  checkedAt?: number;
  planKey?: string;
  requestIndex?: number;
};

export type LocalRuntimeEstimate = {
  label: string;
  observedSeconds: number;
  sampleCount: number;
  title: string;
};

export function autoPlanHasRuntimeIssue(plan: StudioAutoResourcePlan | null | undefined) {
  return plan?.issue?.category === 'environment' || plan?.issue?.code === 'runtime_profile_mismatch';
}

const INVALID_AUTO_PLAN = 'Invalid response.';
const AUTO_CANDIDATE_ID = /^[a-z\d][\w.:-]{0,127}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSchemaV2<T extends { schemaVersion?: unknown } | null | undefined>(
  value: T,
): value is T & { schemaVersion: number } {
  return typeof value?.schemaVersion === 'number' && value.schemaVersion >= 2;
}

function boundedJson(value: unknown, budget = 65_536, maxDepth = 8) {
  const visit = (item: unknown, depth: number): boolean =>
    depth <= maxDepth &&
    (!item || typeof item !== 'object' || Object.values(item).every((child) => visit(child, depth + 1)));
  return JSON.stringify(value)!.length <= budget && visit(value, -1);
}

function candidateTargetIsConsistent(candidate: StudioAutoResourceCandidate) {
  return (
    AUTO_RESOURCE_LOADER_TARGETS.includes(
      `${candidate.loaderModule}.${candidate.loaderAction}.${candidate.executionPath}` as (typeof AUTO_RESOURCE_LOADER_TARGETS)[number],
    ) &&
    (candidate.loaderAction !== 'ModelsLoader' || candidate.pipelineClass === candidate.modelType)
  );
}

function validCandidateBoundary(value: unknown, targetRequired: boolean) {
  if (!isRecord(value) || !boundedJson(value) || typeof value.id !== 'string' || !AUTO_CANDIDATE_ID.test(value.id)) {
    return false;
  }
  if (!targetRequired) return true;
  return (
    AUTO_RESOURCE_TARGET_KEYS.every((key) => {
      const item = value[key];
      return typeof item === 'string' && item && item === item.trim() && item.length < 513;
    }) && candidateTargetIsConsistent(value as StudioAutoResourceCandidate)
  );
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function runtimeBound(seconds: number, direction: 'down' | 'up') {
  if (seconds < 120) {
    const increment = seconds < 20 ? 1 : 5;
    const rounded = direction === 'down' ? Math.floor(seconds / increment) : Math.ceil(seconds / increment);
    return `${Math.max(1, rounded) * increment} sec`;
  }
  if (seconds < 7_200) {
    const minutes = seconds / 60;
    const rounded = direction === 'down' ? Math.floor(minutes) : Math.ceil(minutes);
    return `${Math.max(1, rounded)} min`;
  }
  const hours = seconds / 3_600;
  const rounded = (direction === 'down' ? Math.floor(hours * 2) : Math.ceil(hours * 2)) / 2;
  return `${Math.max(0.5, rounded)} hr`;
}

export function localRuntimeEstimate(plan: StudioAutoResourcePlan | null | undefined): LocalRuntimeEstimate | null {
  if (!plan || plan.error) return null;
  const candidates = [plan.selectedCandidate, ...(plan.candidates ?? [])].filter(
    (candidate, index, values): candidate is StudioAutoResourceCandidate =>
      Boolean(candidate) && values.findIndex((value) => value?.id === candidate?.id) === index,
  );
  const candidate = candidates.find((item) => {
    const history = item.successHistory;
    const lastMeasurement = isRecord(history?.lastMeasurement) ? history.lastMeasurement : null;
    return positiveNumber(lastMeasurement?.elapsedSeconds) !== null;
  });
  if (!candidate?.successHistory) return null;
  const history = candidate.successHistory;
  const lastMeasurement = isRecord(history.lastMeasurement) ? history.lastMeasurement : null;
  const last = positiveNumber(lastMeasurement?.elapsedSeconds);
  if (last === null) return null;
  const best = positiveNumber(history.bestElapsedSeconds) ?? last;
  const minimumObserved = Math.min(best, last);
  const maximumObserved = Math.max(best, last);
  // A cold/warm or runtime-recipe spread larger than this is not a useful
  // prediction. Hide it until matching local measurements become stable.
  if (maximumObserved / minimumObserved > 4) return null;
  const sampleCount = Math.max(1, Math.floor(positiveNumber(history.successCount) ?? 1));
  const lower = runtimeBound(minimumObserved * 0.5, 'down');
  const upper = runtimeBound(maximumObserved * 2, 'up');
  return {
    label: `~${lower}–${upper} locally`,
    observedSeconds: last,
    sampleCount,
    title: `Estimated from ${sampleCount} matching successful local run${sampleCount === 1 ? '' : 's'} on this hardware and runtime.`,
  };
}

function parseAutoResourcePlan(value: unknown): StudioAutoResourcePlan {
  if (!isRecord(value)) {
    throw new Error(INVALID_AUTO_PLAN);
  }
  if (isSchemaV2(value)) {
    const compatibility = value.compatibility;
    const candidates = value.candidates;
    if (
      !isRecord(compatibility) ||
      typeof compatibility.state !== 'string' ||
      typeof compatibility.severity !== 'string' ||
      typeof compatibility.code !== 'string' ||
      typeof compatibility.summary !== 'string' ||
      typeof compatibility.detail !== 'string' ||
      compatibility.source !== 'backend_auto_planner'
    ) {
      throw new Error(INVALID_AUTO_PLAN);
    }
    if (
      ('candidates' in value && (!Array.isArray(candidates) || candidates.length > 64)) ||
      !boundedJson(value, 1e6, 10) ||
      [value.selectedCandidate, value.nextCandidate].some(
        (candidate) => candidate != null && !validCandidateBoundary(candidate, true),
      ) ||
      (Array.isArray(candidates) &&
        (candidates.some(
          (candidate) =>
            !validCandidateBoundary(candidate, !isRecord(candidate) || candidate.exactPairDeclared !== false),
        ) ||
          new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length))
    ) {
      throw new Error(INVALID_AUTO_PLAN);
    }
  }
  return value as StudioAutoResourcePlan;
}

function parseAutoResourcePlans(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.plans)) {
    throw new Error(INVALID_AUTO_PLAN);
  }
  return value.plans.map((plan) => {
    if (!isRecord(plan)) throw new Error(INVALID_AUTO_PLAN);
    return parseAutoResourcePlan(plan);
  });
}

async function postAutoResourcePlan(body: Record<string, unknown>, signal?: AbortSignal) {
  try {
    return await requestJson(`${config.serverAddress}/auto_resource/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      // Cache inspection can legitimately take longer than the generic UI
      // request budget on large local model stores. A run must not be reported
      // as failed merely because Auto is still resolving installed artifacts.
      timeoutMs: 60_000,
      parse: parseAutoResourcePlan,
    });
  } catch (error) {
    const message = formatRequestError(error, 'Auto resource plan request failed.');
    return {
      error: true,
      schemaVersion: 2,
      status: 'needs_setup',
      statusLabel: 'Needs setup',
      message,
      compatibility: {
        state: 'checking',
        severity: 'info',
        code: 'auto_planner_unavailable',
        summary: 'Checking compatibility',
        detail: message,
        action: null,
        source: 'backend_auto_planner',
      },
    } satisfies StudioAutoResourcePlan;
  }
}

export function fetchAutoResourcePlan(form: StudioFormState, signal?: AbortSignal) {
  return postAutoResourcePlan({ form }, signal);
}

export async function clearAutoResourceHistory(filters: { modelType?: string; mode?: string; artifact?: string }) {
  const params = new URLSearchParams();
  if (filters.modelType) params.set('modelType', filters.modelType);
  if (filters.mode) params.set('mode', filters.mode);
  if (filters.artifact) params.set('artifact', filters.artifact);
  return requestJson(`${config.serverAddress}/auto_resource/history?${params.toString()}`, {
    method: 'DELETE',
    parse: (value) => {
      if (!isRecord(value)) throw new Error('Auto history clear returned an invalid response.');
      return value;
    },
  });
}

export function autoPlanKeyForForm(
  form: Pick<
    StudioFormState,
    | 'modelType'
    | 'mode'
    | 'resourceMode'
    | 'resourcePreference'
    | 'confirmedCommunityArtifact'
    | 'device'
    | 'dtype'
    | 'quantizationMode'
    | 'offloadMode'
    | 'autoOffload'
    | 'width'
    | 'height'
  >,
) {
  return [
    form.modelType,
    form.mode,
    form.resourceMode,
    form.resourcePreference ?? 'recommended',
    form.confirmedCommunityArtifact ?? '',
    form.device,
    form.dtype,
    form.quantizationMode,
    form.offloadMode,
    form.autoOffload ? 'offload' : 'no-offload',
    form.width,
    form.height,
  ].join(':');
}

export function fetchAutoResourcePlans(forms: StudioFormState[], keys: string[] = [], signal?: AbortSignal) {
  return requestJson(`${config.serverAddress}/auto_resource/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forms, keys }),
    signal,
    parse: parseAutoResourcePlans,
  });
}

export function autoCandidateSupportsExecutionDevice(
  candidate: StudioAutoResourceCandidate | null | undefined,
  form: Pick<StudioFormState, 'device' | 'autoOffload' | 'offloadMode'>,
) {
  if (!candidate) return false;
  const offloadMode = formPatchForAutoCandidate(candidate).offloadMode ?? form.offloadMode;
  return !studioOffloadPlanConflict({
    device: form.device,
    autoOffload: candidate.autoOffload ?? offloadMode !== 'none',
    offloadMode,
  });
}

export function selectedAutoCandidate(
  plan: StudioAutoResourcePlan | null | undefined,
  form?: Pick<StudioFormState, 'device' | 'autoOffload' | 'offloadMode'>,
) {
  const selected = plan?.selectedCandidate;
  if (isSchemaV2(plan)) {
    if (!selected?.id || !Array.isArray(plan.candidates)) return null;
    const sameId = plan.candidates.filter((candidate) => candidate.id === selected.id);
    if (
      sameId.length !== 1 ||
      !deepEqual(sameId[0], selected) ||
      !candidateTargetIsConsistent(selected) ||
      (form && !autoCandidateSupportsExecutionDevice(selected, form))
    ) {
      return null;
    }
    return selected;
  }
  if (selected?.id && (!form || autoCandidateSupportsExecutionDevice(selected, form))) {
    return selected;
  }
  return plan?.candidates?.find((candidate) => !form || autoCandidateSupportsExecutionDevice(candidate, form)) ?? null;
}

export function autoResourcePlanTargetMatches(
  plan: StudioAutoResourcePlan | null | undefined,
  nodes: FlowGraphNode[],
  managedNodeIds: readonly string[] | null | undefined,
  expected: {
    modelType: string;
    mode: string;
    spec?: { schemaVersion: number; id: string; contentHash: string; executionProfileId: string };
  },
): boolean {
  if (!isSchemaV2(plan)) return true;
  const selected = selectedAutoCandidate(plan);
  if (!selected) return !(plan.selectedCandidate || plan.compatibility?.state === 'ready');
  if (selected.modelType !== expected.modelType || selected.mode !== expected.mode) return false;
  if (
    (expected.spec && selected.executionProfileId !== expected.spec.executionProfileId) ||
    !deepEqual(selected.studioExecutionSpecContract, expected.spec)
  )
    return false;
  const identityKey = selected.loaderAction === 'ModelsLoader' ? 'model_type' : 'pipeline_class';
  const expectedIdentity = identityKey === 'model_type' ? selected.modelType : selected.pipelineClass;
  return executableFlowNodes(nodes).some((node) => {
    const field = node.data.params[identityKey];
    return (
      managedNodeIds?.includes(node.id) &&
      node.data.module === selected.loaderModule &&
      node.data.action === selected.loaderAction &&
      (field?.value ?? field?.default) === expectedIdentity
    );
  });
}

export function autoPlanIsReady(
  plan: StudioAutoResourcePlan | null | undefined,
  form?: Pick<StudioFormState, 'device' | 'autoOffload' | 'offloadMode'>,
) {
  if (isSchemaV2(plan) && plan.compatibility?.state !== 'ready') return false;
  const selected = selectedAutoCandidate(plan, form);
  if (!selected) return false;
  return (
    plan?.error !== true &&
    !autoPlanHasRuntimeIssue(plan) &&
    plan?.issue?.category !== 'package' &&
    plan?.issue?.category !== 'device' &&
    selected.installed !== false &&
    selected.artifactStatus?.installed !== false &&
    selected.artifactStatus?.complete !== false &&
    selected.repairRequired !== true &&
    selected.artifactStatus?.repairRequired !== true &&
    selected.artifactValidation?.repairRequired !== true &&
    selected.proof?.status !== 'known_bad' &&
    selected.readiness !== 'known_bad'
  );
}

function candidateRepo(candidate: StudioAutoResourceCandidate | null | undefined) {
  return (
    candidate?.installTarget?.repo || candidate?.resolvedArtifact || candidate?.artifact || candidate?.modelRepo || ''
  );
}

function candidateNeedsArtifactInstall(candidate: StudioAutoResourceCandidate) {
  const status = candidate.artifactStatus;
  if (candidate.installed === false) return true;
  if (status?.installed === false) return true;
  if (status?.installed && status.complete === false) return true;
  const text = [
    candidate.skipReason,
    candidate.proof?.message,
    ...(candidate.requirementsMissing ?? []),
    status?.reason,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return (
    text.includes('not installed') ||
    text.includes('artifact is not installed') ||
    text.includes('snapshot is incomplete') ||
    text.includes('cached artifact snapshot is incomplete') ||
    text.includes('local weight files') ||
    text.includes('.safetensors')
  );
}

function candidateHasResourceBlock(candidate: StudioAutoResourceCandidate) {
  const text = (candidate.requirementsMissing ?? []).join(' ').toLowerCase();
  return (
    text.includes('gpu memory requires') ||
    text.includes('system memory requires') ||
    text.includes('offload disk requires') ||
    text.includes('requires cuda') ||
    text.includes('requires apple mps') ||
    text.includes('accelerator requires')
  );
}

export function autoResourceInstallTarget(
  plan: StudioAutoResourcePlan | null | undefined,
  form?: Pick<StudioFormState, 'device' | 'autoOffload' | 'offloadMode'>,
): StudioAutoResourceInstallTarget | null {
  if (!plan || autoPlanIsReady(plan, form)) return null;
  if (plan.selectedInstallTarget?.repo) return plan.selectedInstallTarget;
  const candidates = [...(plan.candidates ?? [])].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const candidate = candidates.find((item) => {
    const status = item.proof?.status;
    return (
      candidateRepo(item) &&
      candidateNeedsArtifactInstall(item) &&
      status !== 'failed_here_before' &&
      status !== 'known_bad' &&
      status !== 'manual_only' &&
      (!candidateHasResourceBlock(item) || Boolean(item.repairRequired))
    );
  });
  if (!candidate) return null;
  const repo = candidateRepo(candidate);
  const incomplete = candidate.artifactStatus?.installed && candidate.artifactStatus.complete === false;
  return {
    repo,
    label: candidate.installTarget?.label || (incomplete ? 'Auto artifact' : 'Auto model'),
    reason:
      candidate.installTarget?.reason ||
      candidate.artifactStatus?.reason ||
      candidate.skipReason ||
      candidate.proof?.message ||
      plan.blockingReason ||
      undefined,
    actionLabel:
      candidate.installTarget?.actionLabel || (incomplete ? 'Repair Auto artifact' : 'Install Auto artifact'),
    repair: candidate.installTarget?.repair ?? incomplete,
    candidateId: candidate.id,
  };
}

export function autoResourceHealthBadge(
  plan: StudioAutoResourcePlan | null | undefined,
  form?: Pick<StudioFormState, 'device' | 'autoOffload' | 'offloadMode'>,
): StudioAutoResourceHealthBadge {
  if (!plan) return 'Needs setup';
  if (plan.healthBadge) return plan.healthBadge;
  const selected = selectedAutoCandidate(plan, form);
  if (selected?.healthBadge) return selected.healthBadge;
  if (autoResourceInstallTarget(plan, form)?.repair) return 'Repair required';
  if (plan.readiness === 'manual_only') return 'Expert only';
  if (plan.willNotWorkReason) return 'Not suitable locally';
  return autoPlanIsReady(plan, form) ? 'This should work' : 'Needs setup';
}

export function autoResourceCompatibility(
  plan: StudioAutoResourcePlan | null | undefined,
  form?: Pick<StudioFormState, 'device' | 'autoOffload' | 'offloadMode'>,
): StudioCompatibilityAssessment {
  if (!plan) {
    return {
      state: 'checking',
      severity: 'info',
      code: 'auto_plan_pending',
      summary: 'Checking compatibility',
      detail: 'Waiting for the backend Auto planner to assess this workflow on the current runtime.',
      action: null,
      source: 'backend_auto_planner',
    };
  }
  if (plan.compatibility) return plan.compatibility;

  // Backward compatibility for an older backend. This intentionally derives
  // only from the backend plan; it never re-evaluates local hardware limits.
  const installTarget = autoResourceInstallTarget(plan, form);
  if (autoPlanIsReady(plan, form)) {
    return {
      state: 'ready',
      severity: 'success',
      code: 'legacy_auto_recipe_ready',
      summary: plan.statusLabel || 'Ready with local Auto recipe',
      detail: plan.selectedCandidate?.proof?.message || 'Auto selected a runnable local recipe.',
      action: null,
      source: 'backend_auto_planner',
    };
  }
  if (installTarget) {
    return {
      state: 'needs_model',
      severity: 'warning',
      code: installTarget.repair ? 'model_repair_required' : 'model_install_required',
      summary: installTarget.repair ? 'Repair required' : 'Model setup required',
      detail: installTarget.reason || plan.blockingReason || 'Install the selected Auto artifact.',
      action: {
        type: installTarget.repair ? 'repair_model' : 'install_model',
        label: installTarget.actionLabel || (installTarget.repair ? 'Repair Auto artifact' : 'Install Auto artifact'),
        repo: installTarget.repo,
        candidateId: installTarget.candidateId,
      },
      source: 'backend_auto_planner',
    };
  }
  const unsuitable = Boolean(plan.willNotWorkReason) || autoResourceHealthBadge(plan, form) === 'Not suitable locally';
  return {
    state: plan.error
      ? 'checking'
      : plan.readiness === 'manual_only'
        ? 'expert_only'
        : unsuitable
          ? 'unsuitable'
          : 'needs_setup',
    severity: plan.error ? 'info' : unsuitable ? 'error' : 'warning',
    code: plan.error
      ? 'auto_planner_unavailable'
      : plan.readiness === 'manual_only'
        ? 'expert_configuration_required'
        : unsuitable
          ? 'no_qualified_local_recipe'
          : 'auto_setup_required',
    summary: plan.error
      ? 'Checking compatibility'
      : plan.statusLabel || (unsuitable ? 'Not suitable on this runtime' : 'Needs setup'),
    detail:
      plan.willNotWorkReason ||
      plan.blockingReason ||
      plan.message ||
      'Auto cannot choose a runnable local recipe for this workflow.',
    action: plan.error ? null : { type: 'open_setup', label: 'Open Setup' },
    source: 'backend_auto_planner',
  };
}

export function formPatchForAutoCandidate(
  candidate: StudioAutoResourceCandidate | null | undefined,
  currentForm?: StudioFormState,
  pinnedFormKeys?: ReadonlySet<keyof StudioFormState>,
): Partial<StudioFormState> {
  if (!candidate) return {};
  const patch: Partial<StudioFormState> = {
    resourceMode: 'auto',
  };
  if (candidate.dtype === 'float32' || candidate.dtype === 'float16' || candidate.dtype === 'bfloat16') {
    patch.dtype = candidate.dtype;
  }
  if (
    candidate.quantizationMode === 'none' ||
    candidate.quantizationMode === 'bnb_4bit' ||
    candidate.quantizationMode === 'bnb_8bit' ||
    candidate.quantizationMode === 'quanto_float8' ||
    candidate.quantizationMode === 'torchao_float8'
  ) {
    patch.quantizationMode = candidate.quantizationMode;
  }
  if (
    candidate.offloadMode === 'none' ||
    candidate.offloadMode === 'model_cpu' ||
    candidate.offloadMode === 'sequential_cpu' ||
    candidate.offloadMode === 'group_cpu' ||
    candidate.offloadMode === 'group_disk'
  ) {
    patch.offloadMode = candidate.offloadMode;
    patch.autoOffload = candidate.offloadMode !== 'none';
  }
  // Auto owns the technical execution recipe only. Creative and generation
  // controls (including dimensions, sampling, duration, prompt, and seed)
  // always remain the workflow's explicit values.
  if (currentForm) {
    const execution = normalizeStudioDeviceOffloadPlan({
      device: currentForm.device,
      autoOffload: patch.autoOffload ?? currentForm.autoOffload,
      offloadMode: patch.offloadMode ?? currentForm.offloadMode,
    });
    patch.autoOffload = execution.autoOffload;
    patch.offloadMode = execution.offloadMode;
  }
  return Object.fromEntries(
    Object.entries(patch).filter(
      ([key]) => key === 'resourceMode' || !pinnedFormKeys?.has(key as keyof StudioFormState),
    ),
  ) as Partial<StudioFormState>;
}
