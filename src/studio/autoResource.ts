import config from '../../app.config';
import { formatRequestError, requestJson } from '../utils/requestJson';
import { getQwenAutoDimensions } from './resourcePlanner';
import type { StudioFormState, StudioOffloadMode } from './types';

export type StudioAutoResourceHealthBadge =
  | 'Works here'
  | 'Works with quantized artifact'
  | 'Needs setup'
  | 'Repair required'
  | 'Failed here before'
  | 'Expert only'
  | 'Will not work on this machine'
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
  rank?: number;
  modelType?: string;
  mode?: string;
  executionPath?: string;
  pipelineClass?: string;
  artifact?: string;
  modelRepo?: string;
  resolvedArtifact?: string;
  dtype?: StudioFormState['dtype'] | string;
  quantizationMode?: StudioFormState['quantizationMode'] | string;
  quantizedComponents?: string[];
  bnb4ComputeDtype?: StudioFormState['dtype'] | string;
  offloadMode?: StudioOffloadMode | string;
  autoOffload?: boolean;
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

export type StudioAutoResourcePlan = {
  error?: boolean;
  resourceMode?: 'auto';
  status?: 'ready' | 'checking_hardware' | 'finding_artifacts' | 'needs_setup' | string;
  readiness?: 'ready' | 'needs_setup' | 'manual_only' | 'known_bad' | string;
  statusLabel?: string;
  blockingReason?: string | null;
  willNotWorkReason?: string | null;
  healthBadge?: StudioAutoResourceHealthBadge;
  canAutoRun?: boolean;
  repairRequired?: boolean;
  selectedInstallTarget?: StudioAutoResourceInstallTarget | null;
  failureHistory?: Array<Record<string, unknown>>;
  selectedCandidate?: StudioAutoResourceCandidate | null;
  candidates?: StudioAutoResourceCandidate[];
  hardware?: Record<string, unknown>;
  hardwareSnapshot?: Record<string, unknown>;
  modelRequirements?: Record<string, unknown>;
  requirementsMatched?: string[];
  requirementsMissing?: string[];
  candidateReasons?: string[];
  knownBadReasons?: string[];
  message?: string;
  checkedAt?: number;
  planKey?: string;
  requestIndex?: number;
};

const READY_AUTO_PROOF_STATUSES = new Set(['passed', 'declared_safe', 'live_proven']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseAutoResourcePlan(value: unknown): StudioAutoResourcePlan {
  if (!isRecord(value)) {
    throw new Error('Auto resource planner returned an invalid response.');
  }
  return value as StudioAutoResourcePlan;
}

function parseAutoResourcePlans(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.plans)) {
    throw new Error('Auto resource planner returned an invalid plans response.');
  }
  return value.plans.map((plan, index) => {
    if (!isRecord(plan)) throw new Error(`Auto resource plan ${index + 1} is invalid.`);
    return plan as StudioAutoResourcePlan;
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
    return {
      error: true,
      status: 'needs_setup',
      statusLabel: 'Needs setup',
      message: formatRequestError(error, 'Auto resource plan request failed.'),
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
    | 'dtype'
    | 'quantizationMode'
    | 'offloadMode'
    | 'autoOffload'
    | 'width'
    | 'height'
    | 'steps'
    | 'guidanceScale'
  >,
) {
  return [
    form.modelType,
    form.mode,
    form.resourceMode,
    form.dtype,
    form.quantizationMode,
    form.offloadMode,
    form.autoOffload ? 'offload' : 'no-offload',
    form.width,
    form.height,
    form.steps,
    form.guidanceScale,
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

export function autoProofIsReady(proof: StudioAutoResourceProof | null | undefined) {
  return Boolean(proof?.status && READY_AUTO_PROOF_STATUSES.has(proof.status));
}

export function selectedAutoCandidate(plan: StudioAutoResourcePlan | null | undefined) {
  const selected = plan?.selectedCandidate;
  if (selected?.id && autoProofIsReady(selected.proof)) return selected;
  return plan?.candidates?.find((candidate) => autoProofIsReady(candidate.proof)) ?? null;
}

export function autoPlanIsReady(plan: StudioAutoResourcePlan | null | undefined) {
  const selected = selectedAutoCandidate(plan);
  if (!selected) return false;
  return plan?.status === 'ready' && autoProofIsReady(selected.proof);
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
): StudioAutoResourceInstallTarget | null {
  if (!plan || autoPlanIsReady(plan)) return null;
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
): StudioAutoResourceHealthBadge {
  if (!plan) return 'Needs setup';
  if (plan.healthBadge) return plan.healthBadge;
  const selected = selectedAutoCandidate(plan);
  if (selected?.healthBadge) return selected.healthBadge;
  if (autoResourceInstallTarget(plan)?.repair) return 'Repair required';
  if (plan.readiness === 'manual_only') return 'Expert only';
  if (plan.willNotWorkReason) return 'Will not work on this machine';
  return autoPlanIsReady(plan) ? 'Works here' : 'Needs setup';
}

export function formPatchForAutoCandidate(
  candidate: StudioAutoResourceCandidate | null | undefined,
  currentForm?: StudioFormState,
): Partial<StudioFormState> {
  if (!candidate) return {};
  const generation = candidate.generation ?? {};
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
  const qwenDimensions =
    currentForm?.modelType === 'QwenImageModularPipeline' && currentForm.mode === 'text_to_image'
      ? getQwenAutoDimensions(currentForm)
      : null;
  if (qwenDimensions) {
    patch.width = qwenDimensions.width;
    patch.height = qwenDimensions.height;
  } else {
    if (Number.isFinite(generation.width)) patch.width = Number(generation.width);
    if (Number.isFinite(generation.height)) patch.height = Number(generation.height);
  }
  if (Number.isFinite(generation.steps)) patch.steps = Number(generation.steps);
  if (Number.isFinite(generation.guidanceScale)) patch.guidanceScale = Number(generation.guidanceScale);
  if (typeof generation.negativePrompt === 'string') patch.negativePrompt = generation.negativePrompt;
  if (Number.isFinite(generation.maxSequenceLength)) patch.maxSequenceLength = Number(generation.maxSequenceLength);
  if (Number.isFinite(generation.audioDuration)) patch.audioDuration = Number(generation.audioDuration);
  if (Number.isFinite(generation.shift)) patch.shift = Number(generation.shift);
  return patch;
}
