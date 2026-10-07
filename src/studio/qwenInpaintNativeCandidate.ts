import type { NodeData } from '../stores/useNodeStore';
import type { OperationGraph, OperationStarter } from '../workflow/operationAuthoring';
import { createTemplateOperationGraph } from './templateOperationWorkflow';
import { qwenInpaintNativeCandidateSelection } from './templateOperationSelections';
import type { StudioExecutionSpec, StudioFormState, StudioModelProfile, StudioTemplate } from './types';

/** Parity tooling delegates to the same ordinary builder as fresh templates.
 * Explicit crop overrides remain useful for bounded differential tests. */
export function createQwenInpaintNativeCandidateGraph(
  template: StudioTemplate,
  form: StudioFormState & { paddingMaskCrop?: number | null },
  starter: OperationStarter,
  registry: Record<string, NodeData>,
  spec: StudioExecutionSpec,
  capability: StudioModelProfile,
  options: { paddingMaskCrop?: number | null } = {},
): OperationGraph {
  const selection = qwenInpaintNativeCandidateSelection(template.id);
  const candidate = { ...template, executionSelection: selection };
  const paddingMaskCrop =
    options.paddingMaskCrop !== undefined ? options.paddingMaskCrop : (form.paddingMaskCrop ?? null);
  if (
    paddingMaskCrop !== null &&
    (!Number.isSafeInteger(paddingMaskCrop) || paddingMaskCrop < 0 || paddingMaskCrop > 8192)
  )
    throw new Error('The Qwen candidate crop padding must be a bounded nonnegative integer or null.');
  const candidateForm = { ...form, paddingMaskCrop };
  return createTemplateOperationGraph(candidate, candidateForm, starter, registry, spec, capability);
}
