import config from '../../app.config';
import { requestJson } from '../utils/requestJson';
import type { StudioFormState } from './types';

export type HuggingFaceClusterArtifactQualification = {
  repo: string;
  revision: string;
  installed: boolean;
  complete: boolean;
  exactRevisionComplete: boolean;
  repairRequired: boolean;
  reason: string;
  missingFiles: string[];
  corruptFiles: string[];
  activeFiles: string[];
};

export type HuggingFaceClusterExpertQualificationReceipt = {
  schemaVersion: 1;
  claim: 'expert_cluster_runtime_qualified';
  publicationExecutable: false;
  checkedAt: number;
  qualificationFingerprint: string;
  definitionId: string;
  admissionId: string;
  executionProfileId: string;
  modelType: string;
  mode: string;
  pipelineClass: string;
  loaderModule: string;
  loaderAction: string;
  executionPath: string;
  runtimeFingerprint: string;
  resourceFingerprint: string;
  artifactStatus: HuggingFaceClusterArtifactQualification;
  dependencies: Array<{
    id: string;
    kind: string;
    artifactStatus: HuggingFaceClusterArtifactQualification;
  }>;
  optionalRuntimeRequirement: Record<string, unknown>;
  recipe: Pick<StudioFormState, 'device' | 'dtype' | 'quantizationMode' | 'autoOffload' | 'offloadMode'>;
};

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const RECEIPT_KEYS = [
  'schemaVersion',
  'claim',
  'publicationExecutable',
  'checkedAt',
  'qualificationFingerprint',
  'definitionId',
  'admissionId',
  'executionProfileId',
  'modelType',
  'mode',
  'pipelineClass',
  'loaderModule',
  'loaderAction',
  'executionPath',
  'runtimeFingerprint',
  'resourceFingerprint',
  'artifactStatus',
  'dependencies',
  'optionalRuntimeRequirement',
  'recipe',
] as const;
const ARTIFACT_KEYS = [
  'repo',
  'revision',
  'installed',
  'complete',
  'exactRevisionComplete',
  'repairRequired',
  'reason',
  'missingFiles',
  'corruptFiles',
  'activeFiles',
] as const;
const RECIPE_KEYS = ['device', 'dtype', 'quantizationMode', 'autoOffload', 'offloadMode'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function invalid(): never {
  throw new Error('Invalid Hugging Face Cluster runtime qualification response.');
}

function strings(value: unknown, maximum = 25) {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== 'string')) invalid();
  return [...value] as string[];
}

function artifact(value: unknown): HuggingFaceClusterArtifactQualification {
  if (!record(value) || !exactKeys(value, ARTIFACT_KEYS)) invalid();
  if (
    typeof value.repo !== 'string' ||
    !value.repo ||
    value.repo.length > 256 ||
    typeof value.revision !== 'string' ||
    !REVISION.test(value.revision) ||
    typeof value.installed !== 'boolean' ||
    typeof value.complete !== 'boolean' ||
    typeof value.exactRevisionComplete !== 'boolean' ||
    typeof value.repairRequired !== 'boolean' ||
    typeof value.reason !== 'string' ||
    value.reason.length > 2048
  )
    invalid();
  return {
    repo: value.repo,
    revision: value.revision,
    installed: value.installed,
    complete: value.complete,
    exactRevisionComplete: value.exactRevisionComplete,
    repairRequired: value.repairRequired,
    reason: value.reason,
    missingFiles: strings(value.missingFiles),
    corruptFiles: strings(value.corruptFiles),
    activeFiles: strings(value.activeFiles),
  };
}

function parseReceipt(value: unknown): HuggingFaceClusterExpertQualificationReceipt {
  if (!record(value) || !exactKeys(value, ['error', 'receipt']) || value.error !== false || !record(value.receipt))
    invalid();
  const receipt = value.receipt;
  if (
    !exactKeys(receipt, RECEIPT_KEYS) ||
    receipt.schemaVersion !== 1 ||
    receipt.claim !== 'expert_cluster_runtime_qualified' ||
    receipt.publicationExecutable !== false ||
    typeof receipt.checkedAt !== 'number' ||
    !Number.isFinite(receipt.checkedAt) ||
    typeof receipt.qualificationFingerprint !== 'string' ||
    !SHA256.test(receipt.qualificationFingerprint) ||
    typeof receipt.runtimeFingerprint !== 'string' ||
    !SHA256.test(receipt.runtimeFingerprint) ||
    typeof receipt.resourceFingerprint !== 'string' ||
    !SHA256.test(receipt.resourceFingerprint) ||
    typeof receipt.loaderModule !== 'string' ||
    !receipt.loaderModule ||
    receipt.loaderModule.length > 256 ||
    typeof receipt.loaderAction !== 'string' ||
    !receipt.loaderAction ||
    receipt.loaderAction.length > 256 ||
    typeof receipt.executionPath !== 'string' ||
    !receipt.executionPath ||
    receipt.executionPath.length > 256 ||
    !record(receipt.optionalRuntimeRequirement) ||
    !record(receipt.recipe) ||
    !exactKeys(receipt.recipe, RECIPE_KEYS) ||
    typeof receipt.recipe.device !== 'string' ||
    !['float32', 'float16', 'bfloat16'].includes(String(receipt.recipe.dtype)) ||
    typeof receipt.recipe.quantizationMode !== 'string' ||
    typeof receipt.recipe.autoOffload !== 'boolean' ||
    typeof receipt.recipe.offloadMode !== 'string' ||
    !Array.isArray(receipt.dependencies) ||
    receipt.dependencies.length > 32
  )
    invalid();
  for (const key of ['definitionId', 'admissionId', 'executionProfileId', 'modelType', 'mode', 'pipelineClass']) {
    if (typeof receipt[key] !== 'string' || !receipt[key] || receipt[key].length > 512) invalid();
  }
  const dependencies = receipt.dependencies.map((item) => {
    if (!record(item) || !exactKeys(item, ['id', 'kind', 'artifactStatus'])) invalid();
    if (typeof item.id !== 'string' || !item.id || typeof item.kind !== 'string' || !item.kind) invalid();
    return { id: item.id, kind: item.kind, artifactStatus: artifact(item.artifactStatus) };
  });
  return {
    ...(receipt as unknown as Omit<HuggingFaceClusterExpertQualificationReceipt, 'artifactStatus' | 'dependencies'>),
    artifactStatus: artifact(receipt.artifactStatus),
    dependencies,
  };
}

export function fetchHuggingFaceClusterExpertQualification(input: {
  definitionId: string;
  admissionId: string;
  form: StudioFormState;
  artifactRepo?: string;
}) {
  const { form } = input;
  return requestJson(`${config.serverAddress}/huggingface/cluster/runtime-qualification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      definitionId: input.definitionId,
      admissionId: input.admissionId,
      ...(input.artifactRepo ? { artifactRepo: input.artifactRepo } : {}),
      resourceMode: 'expert',
      recipe: {
        device: form.device,
        dtype: form.dtype,
        quantizationMode: form.quantizationMode,
        autoOffload: form.autoOffload,
        offloadMode: form.offloadMode,
      },
    }),
    timeoutMs: 60_000,
    parse: parseReceipt,
  });
}
