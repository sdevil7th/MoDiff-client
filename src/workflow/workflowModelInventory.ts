import type { ModelCacheDiagnostics } from '../stores/useNodeStore';
import { getRepoCacheStatus, type ReviewedExpertInstallTarget } from '../studio/modelCache';
import { parseOptionalRuntimeRequirement, type OptionalRuntimeRequirement } from '../studio/optionalRuntimes';

export type WeightFormatSelection = {
  weightFormat: 'fp8r' | 'nvfp4';
  repo: string;
  revision: string;
  downloadFiles: string[];
};

export type WorkflowModelInventory = {
  executionStatus?: 'expert_only' | 'supported' | 'supported_with_model';
  qualificationStatus?: string;
  optionalRuntimeRequirement?: OptionalRuntimeRequirement;
  nativeSelection?: Omit<WeightFormatSelection, 'weightFormat'>;
  weightFormatSelections?: WeightFormatSelection[];
};

function invalid(): never {
  throw new Error('Invalid workflow model artifact selection.');
}

function ownRecord(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (key) =>
        typeof key !== 'string' ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'),
    )
  )
    invalid();
  return value as Record<string, unknown>;
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u.test(value))
    invalid();
  return value;
}

function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) invalid();
  return value;
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
}

function files(value: unknown, allowEmpty = false): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && !value.length) ||
    value.length > 4096 ||
    new Set(value).size !== value.length ||
    value.some(
      (file) =>
        typeof file !== 'string' ||
        !file.length ||
        file.length > 512 ||
        hasControlCharacters(file) ||
        Array.from(file).some((character) => '\\:*?[]{}'.includes(character)) ||
        file.split('/').some((part) => !part || part === '.' || part === '..'),
    )
  )
    invalid();
  return [...value] as string[];
}

/** Exact additional inventories; absence preserves the existing native selection. */
export function parseWeightFormatSelections(value: unknown): WeightFormatSelection[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > 2) invalid();
  const seen = new Set<string>();
  return value.map((raw) => {
    const item = ownRecord(raw);
    if (
      Object.keys(item).sort().join() !== 'downloadFiles,repo,revision,weightFormat' ||
      (item.weightFormat !== 'fp8r' && item.weightFormat !== 'nvfp4') ||
      seen.has(item.weightFormat)
    )
      invalid();
    seen.add(item.weightFormat);
    return {
      weightFormat: item.weightFormat,
      repo: repository(item.repo),
      revision: revision(item.revision),
      downloadFiles: files(item.downloadFiles),
    };
  });
}

/** Display/install metadata cannot make a private or unselected profile public. */
export function parseWorkflowModelInventory(
  value: Record<string, unknown>,
  repo: string,
): WorkflowModelInventory | undefined {
  const keys = [
    'executionStatus',
    'qualificationStatus',
    'optionalRuntimeRequirement',
    'revisionCandidates',
    'downloadFiles',
    'weightFormatSelections',
  ];
  if (!keys.some((key) => value[key] !== undefined)) return undefined;
  const result: WorkflowModelInventory = {};
  if (value.executionStatus !== undefined) {
    if (
      value.executionStatus !== 'expert_only' &&
      value.executionStatus !== 'supported' &&
      value.executionStatus !== 'supported_with_model'
    )
      invalid();
    result.executionStatus = value.executionStatus;
  }
  if (value.qualificationStatus !== undefined) {
    if (
      typeof value.qualificationStatus !== 'string' ||
      !value.qualificationStatus.length ||
      value.qualificationStatus.length > 256 ||
      hasControlCharacters(value.qualificationStatus)
    )
      invalid();
    result.qualificationStatus = value.qualificationStatus;
  }
  if (value.optionalRuntimeRequirement !== undefined)
    result.optionalRuntimeRequirement = parseOptionalRuntimeRequirement(value.optionalRuntimeRequirement);
  if (
    value.revisionCandidates !== undefined &&
    (!Array.isArray(value.revisionCandidates) ||
      value.revisionCandidates.length > 32 ||
      new Set(value.revisionCandidates).size !== value.revisionCandidates.length)
  )
    invalid();
  const revisions = value.revisionCandidates === undefined ? [] : (value.revisionCandidates as unknown[]).map(revision);
  const nativeFiles = value.downloadFiles === undefined ? undefined : files(value.downloadFiles, true);
  // Only the capability's own exact repository can use its native manifest.
  if (revisions.length === 1 && nativeFiles?.length && value.defaultRepo === repo)
    result.nativeSelection = { repo: repository(repo), revision: revisions[0]!, downloadFiles: nativeFiles };
  const selections = parseWeightFormatSelections(value.weightFormatSelections);
  if (selections && value.defaultRepo === repo) result.weightFormatSelections = selections;
  return result;
}

export function workflowModelArtifactRows(descriptor: {
  profileId: string;
  label: string;
  repo: string;
  inventory?: WorkflowModelInventory;
}) {
  const native = descriptor.inventory?.nativeSelection;
  return [
    { id: `${descriptor.profileId}:native`, weightFormat: 'native' as const, label: 'Native', selection: native },
    ...(descriptor.inventory?.weightFormatSelections ?? []).map((selection) => ({
      id: `${descriptor.profileId}:${selection.weightFormat}`,
      weightFormat: selection.weightFormat,
      label: selection.weightFormat.toUpperCase(),
      selection,
    })),
  ];
}

export function workflowModelArtifactStatus(
  row: ReturnType<typeof workflowModelArtifactRows>[number],
  descriptor: { repo: string; label: string; inventory?: WorkflowModelInventory },
  cache: unknown[],
  local: unknown[],
  diagnostics: ModelCacheDiagnostics | null,
): {
  status: ReturnType<typeof getRepoCacheStatus>;
  installTarget: ReviewedExpertInstallTarget | null;
  reason: string;
} {
  const selection = row.selection;
  const status = getRepoCacheStatus(
    selection?.repo ?? descriptor.repo,
    cache,
    local,
    diagnostics,
    selection ? { revision: selection.revision, files: selection.downloadFiles } : undefined,
  );
  const runtime = descriptor.inventory?.optionalRuntimeRequirement;
  const reason = !selection
    ? 'No exact reviewed artifact selection was published for this format.'
    : !descriptor.inventory?.executionStatus
      ? 'Execution support has not been declared.'
      : runtime?.requiredNow && runtime.state !== 'active'
        ? `The required runtime is ${runtime.state.replace(/_/gu, ' ')}. Configure it before installing model files.`
        : status.runnable
          ? 'The exact artifact selection is installed. Execution readiness still depends on the backend runtime and workflow.'
          : `Install the exact ${row.label} artifact selection. Execution readiness is evaluated separately by the backend.`;
  const allowed = Boolean(
    selection && descriptor.inventory?.executionStatus && (!runtime?.requiredNow || runtime.state === 'active'),
  );
  return {
    status,
    reason,
    installTarget:
      allowed && !status.runnable && selection
        ? {
            repo: selection.repo,
            label: `${descriptor.label} · ${row.label}`,
            revision: selection.revision,
            files: [...selection.downloadFiles],
            repair: status.repairRequired,
            actionLabel: status.repairRequired ? 'Repair' : 'Install',
            reason,
          }
        : null,
  };
}
