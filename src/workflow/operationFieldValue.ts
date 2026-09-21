import type { NodeParams } from '../stores/useNodeStore';
import { deepEqual } from '../utils/deepEqual';

export function acceptsOperationValue(field: NodeParams, value: unknown): boolean {
  if (field.display === 'random' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const seed = value as Record<string, unknown>;
    return (
      Object.keys(seed).length === 2 &&
      typeof seed.isRandom === 'boolean' &&
      acceptsOperationValue({ ...field, display: 'number' }, seed.value)
    );
  }
  const types = Array.isArray(field.type) ? field.type : [field.type];
  if (
    typeof value === 'number' ||
    (typeof value === 'string' &&
      value.trim() &&
      Number.isFinite(Number(value)) &&
      types.some((t) => ['int', 'float', 'number'].includes(t ?? '')))
  ) {
    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      (types.includes('int') && !Number.isInteger(number)) ||
      (field.min !== undefined && number < field.min) ||
      (field.max !== undefined && number > field.max)
    )
      return false;
  }
  if (
    types.some((t) => ['int', 'float', 'number'].includes(t ?? '')) &&
    !(typeof value === 'number' || (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))))
  )
    return false;
  if (types.some((t) => ['bool', 'boolean'].includes(t ?? '')) && typeof value !== 'boolean') return false;
  if (field.options) {
    const options = Array.isArray(field.options) ? field.options : Object.keys(field.options);
    if (
      options.length &&
      !options.some(
        (option) =>
          deepEqual(option, value) ||
          (typeof option === 'object' && option !== null && 'value' in option && deepEqual(option.value, value)),
      )
    )
      return false;
  }
  return true;
}
