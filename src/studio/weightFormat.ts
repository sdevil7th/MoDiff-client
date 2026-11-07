import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { WorkflowModelDescriptor } from '../workflow/workflowChoices';
import { parseWeightFormatSelections } from '../workflow/workflowModelInventory';
import { runtimeOptionValues } from './runtimeOptions';
import type { StudioFormState, StudioExecutionSpec, StudioModelProfile } from './types';

export type StudioWeightFormat = 'native' | 'fp8r' | 'nvfp4';

/** Missing historical values mean native; no quantization-mode inference. */
export function studioWeightFormat(value: unknown): StudioWeightFormat {
  if (value === undefined) return 'native';
  if (value !== 'native' && value !== 'fp8r' && value !== 'nvfp4')
    throw new Error('Choose a backend-declared weight format.');
  return value;
}

/** Persistence retains an unsupported selection as blocked, never as Native.
 * Runtime execution and field edits continue to use the strict parser above. */
export function persistedStudioWeightFormat(value: unknown): StudioWeightFormat | null {
  if (value === undefined) return 'native';
  return value === 'native' || value === 'fp8r' || value === 'nvfp4' ? value : null;
}

export const WEIGHT_FORMAT_AUTO_UNAVAILABLE =
  'This weight format has no backend Auto resource contract. Choose Expert explicitly; no hardware fit is implied.';

export function executionStudioWeightFormat(form: Pick<StudioFormState, 'weightFormat' | 'resourceMode'>) {
  const format = studioWeightFormat(form.weightFormat);
  if (format !== 'native' && form.resourceMode !== 'expert') throw new Error(WEIGHT_FORMAT_AUTO_UNAVAILABLE);
  return format;
}

export function assertStudioWeightFormatOptions(value: unknown, field?: Pick<NodeParams, 'options'>) {
  const format = studioWeightFormat(value);
  const allowed = field ? runtimeOptionValues(field.options) : [];
  if ((format !== 'native' || allowed.length > 0) && !allowed.includes(format))
    throw new Error('The selected weight format is not declared by the current loader fields.');
  return format;
}

/** Read the exact backend inventory, without granting install/runtime qualification. */
export function selectedNodeWeightFormatArtifact(
  node: Pick<CustomNodeType, 'data'>,
  descriptors: readonly WorkflowModelDescriptor[],
  executionProfileId?: string,
) {
  const params = node.data.params ?? {};
  const field = params.weight_format;
  const format = studioWeightFormat(field?.value !== undefined ? field.value : field?.default);
  if (format === 'native') return null;
  if (node.data.module !== 'modules.ModularDiffusers' || node.data.action !== 'ModelsLoader')
    throw new Error('This loader does not declare a weight-format artifact selection.');
  const value = (name: string) => params[name]?.value ?? params[name]?.default;
  const repository = value('repo_id');
  if (
    !repository ||
    typeof repository !== 'object' ||
    Array.isArray(repository) ||
    !('source' in repository) ||
    repository.source !== 'hub' ||
    !('value' in repository) ||
    typeof repository.value !== 'string'
  )
    throw new Error('A weight-format artifact requires one immutable Hub model selection.');
  // Ordinary loader graphs have no execution_profile_id parameter. Require a
  // unique current source declaration for the exact visible loader identity;
  // template callers can additionally bind their already-selected profile.
  const matching = descriptors
    .filter(
      (row) =>
        (executionProfileId === undefined || row.profileId === executionProfileId) &&
        row.pipeline === value('model_type') &&
        row.repo === repository.value,
    )
    .map((descriptor) => {
      const declared = parseWeightFormatSelections(descriptor.inventory?.weightFormatSelections) ?? [];
      const selection = declared.find(
        (row) => row.weightFormat === format && row.repo === repository.value && row.revision === value('revision'),
      );
      return { descriptor, declared, selection };
    })
    .filter((row) => row.selection !== undefined);
  if (matching.length !== 1)
    throw new Error(
      'Refresh exact backend model capabilities; the selected artifact does not declare one unambiguous weight format.',
    );
  const { descriptor, declared, selection } = matching[0]!;
  return { descriptor, selection: selection!, options: ['native', ...declared.map((row) => row.weightFormat)] };
}

/** Presentation can diagnose an invalid imported value without treating it as valid. */
export function hasNonNativeStudioWeightFormat(form: Pick<StudioFormState, 'weightFormat'>) {
  return form.weightFormat !== undefined && form.weightFormat !== 'native';
}

/** Omit native from old hash-covered settings; explicit non-native values bind proofs. */
export function explicitStudioWeightFormat(form: Pick<StudioFormState, 'weightFormat'>) {
  const format = persistedStudioWeightFormat(form.weightFormat);
  return format === 'native' ? undefined : format;
}

/** Refuse incompatible model changes before managed graph creation/mutation. */
export function assertFormWeightFormatSelection(
  form: StudioFormState,
  spec: StudioExecutionSpec | null | undefined,
  capability: StudioModelProfile | undefined,
  descriptors: readonly WorkflowModelDescriptor[],
) {
  const format = executionStudioWeightFormat(form);
  if (format === 'native') return null;
  if (
    !spec ||
    !spec.bindings.some(([, , source]) => source === 'weightFormat') ||
    !capability ||
    capability.modelType !== form.modelType ||
    capability.revisionCandidates?.length !== 1
  )
    throw new Error(
      'This model does not declare the selected weight format. Choose Native explicitly; the graph is unchanged.',
    );
  const repository = form.modelRepo ?? spec.defaultRepo;
  const matching = descriptors.filter(
    (row) =>
      row.profileId === spec.executionProfileId && row.pipeline === spec.pipelineClass && row.repo === repository,
  );
  if (matching.length !== 1)
    throw new Error(
      'This model does not declare the selected weight format. Choose Native explicitly; the graph is unchanged.',
    );
  const descriptor = matching[0]!;
  const declared = parseWeightFormatSelections(descriptor.inventory?.weightFormatSelections) ?? [];
  const choices = declared.filter(
    (row) =>
      row.weightFormat === format && row.repo === repository && row.revision === capability.revisionCandidates![0],
  );
  if (choices.length !== 1)
    throw new Error(
      'This model does not declare the selected weight format. Choose Native explicitly; the graph is unchanged.',
    );
  return { descriptor, selection: choices[0]!, options: ['native', ...declared.map((row) => row.weightFormat)] };
}

/** Project the existing profile into the exact selected artifact for summaries.
 * A missing/invalid declaration returns no profile, never the native fallback. */
export function studioWeightFormatProfile(
  form: StudioFormState,
  nativeProfile: StudioModelProfile,
  capabilities: readonly StudioModelProfile[],
  descriptors: readonly WorkflowModelDescriptor[],
  invalid = false,
): StudioModelProfile | null {
  try {
    if (!hasNonNativeStudioWeightFormat(form)) return nativeProfile;
    if (invalid) return null;
    const matches = capabilities.filter((item) => item.modelType === form.modelType);
    if (matches.length !== 1) return null;
    const capability = matches[0]!;
    const specs = capability.studioExecutionSpecs?.filter((item) => item.mode === form.mode) ?? [];
    if (specs.length !== 1) return null;
    const selected = assertFormWeightFormatSelection(form, specs[0], capability, descriptors);
    if (!selected) return null;
    return {
      ...nativeProfile,
      ...capability,
      label: `${nativeProfile.label} · ${studioWeightFormat(form.weightFormat).toUpperCase()}`,
      defaultRepo: selected.selection.repo,
      revisionCandidates: [selected.selection.revision],
      downloadFiles: [...selected.selection.downloadFiles],
    };
  } catch {
    return null;
  }
}
