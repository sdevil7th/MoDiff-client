import { exactStudioExecutionSpecForForm } from './executionSpecs';
import type { StudioFormState, StudioModelProfile, StudioTemplate } from './types';

export function studioSupportsStrength(
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
  capabilities: readonly StudioModelProfile[],
  template?: StudioTemplate,
): boolean {
  if (!/(?:image_to_image|edit_image|inpaint(?:ing)?|outpaint)$/.test(form.mode)) return false;
  const selection =
    template?.modelType === form.modelType && template.mode === form.mode ? template.executionSelection : undefined;
  const spec = exactStudioExecutionSpecForForm(capabilities, false, selection?.bindingSpec ?? form);
  if (
    selection &&
    (spec?.pipelineClass !== selection.pipelineClass || spec.executionProfileId !== selection.executionProfileId)
  )
    return false;
  // An image input or an aggregate node port does not establish that the
  // selected task consumes this control. Use the reviewed execution binding.
  return spec?.bindings.some(([, , source]) => source === 'strength') === true;
}
