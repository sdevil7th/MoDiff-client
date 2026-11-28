import type { NodeData } from '../stores/useNodeStore';
import { exactStudioExecutionSpecForForm } from './executionSpecs';
import { runtimeOptionValues } from './runtimeOptions';
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

function isSpeechTimestamp(value: unknown): value is StudioFormState['speechTimestamps'] {
  return value === 'none' || value === 'segment' || value === 'word';
}

// The bound backend field declares both the accepted choices and the default
// for a fresh authoring route. A saved graph retains its own authored value.
export function studioSpeechTimestampContract(
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
  metadata: {
    studioModelCapabilities: readonly StudioModelProfile[];
    studioExecutionSpecInvalid: boolean;
    nodesRegistry: Record<string, Pick<NodeData, 'params'>>;
  },
) {
  const spec = exactStudioExecutionSpecForForm(
    metadata.studioModelCapabilities,
    metadata.studioExecutionSpecInvalid,
    form,
  );
  const binding = spec?.bindings.find(([, , source]) => source === 'speechTimestamps');
  if (!binding) return undefined;
  const [role, field] = binding;
  const nodeKey = spec?.roles.find(([candidate]) => candidate === role)?.[1];
  if (!nodeKey) return undefined;
  const parameter = metadata.nodesRegistry[nodeKey]?.params[field];
  const defaultValue = parameter?.default;
  const options = runtimeOptionValues(parameter?.options).filter(isSpeechTimestamp);
  if (!isSpeechTimestamp(defaultValue) || !options.includes(defaultValue)) return undefined;
  return { options, defaultValue };
}
