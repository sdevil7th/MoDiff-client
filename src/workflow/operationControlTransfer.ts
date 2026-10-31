import type { CustomNodeType } from '../stores/useFlowStore';
import type { OperationControl } from './operationContracts';

function controlPolicy(
  control: OperationControl,
  node: CustomNodeType,
  connected: ReadonlySet<string>,
  override?: { field: string; value: unknown },
) {
  const value = (name: string | null): unknown => {
    if (!name || connected.has(name) || node.data.params[name]?.isConnected) return undefined;
    if (override?.field === name) return override.value;
    const field = node.data.params[name];
    return field?.value ?? field?.default;
  };
  if (control.selectorField && value(control.selectorField) !== control.selectorValue) return null;
  if (control.negativePromptField && typeof value(control.negativePromptField) !== 'string') return null;
  let enabled: boolean;
  if (control.enabled === 'always') enabled = true;
  else if (control.enabled === 'boolean_field') {
    const field = value(control.enabledField);
    if (typeof field !== 'boolean') return null;
    enabled = field;
  } else if (control.enabled === 'scale_gt_one') {
    const field = value(control.enabledField);
    if (!(typeof field === 'number' || (typeof field === 'string' && field.trim())) || !Number.isFinite(Number(field)))
      return null;
    enabled = Number(field) > 1;
  } else return null; // Component configuration cannot be inferred from a stored scalar.
  let formulation = control.formulation;
  if (formulation === 'boolean_field') {
    const field = value(control.formulationField);
    if (typeof field !== 'boolean') return null;
    formulation = field ? 'original' : 'diffusers';
  }
  return { enabled, formulation };
}

/** Check the prospective destination policy, including a transferred toggle or scale. */
export function compatibleOperationControlTransfer(
  source: CustomNodeType,
  sourceField: string,
  sourceControl: OperationControl,
  target: CustomNodeType,
  targetField: string,
  targetControl: OperationControl,
  sourceConnected: ReadonlySet<string>,
  targetConnected: ReadonlySet<string>,
) {
  if (
    sourceControl.technique !== targetControl.technique ||
    sourceControl.parameter !== targetControl.parameter ||
    sourceControl.compatibilityScope !== targetControl.compatibilityScope ||
    sourceControl.scaleMeaning !== targetControl.scaleMeaning ||
    sourceControl.negativeConditioning !== targetControl.negativeConditioning
  )
    return false;
  const a = controlPolicy(sourceControl, source, sourceConnected);
  const field = source.data.params[sourceField];
  const b = controlPolicy(targetControl, target, targetConnected, {
    field: targetField,
    // A connected value can differ from its stored fallback. It remains
    // opaque only when the destination activation/formulation needs it.
    value: sourceConnected.has(sourceField) || field?.isConnected ? undefined : (field?.value ?? field?.default),
  });
  // Negative tensors keep their distinct pipeline ownership. This only transfers a scalar policy.
  return Boolean(a && b && a.enabled === b.enabled && a.formulation === b.formulation);
}
