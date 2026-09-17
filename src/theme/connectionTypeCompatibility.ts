import { normalizeDataType } from '../utils/dataTypeCategory';

/** Normalize a backend-declared connector type into a stable set. */
export function connectionTypes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((item) => {
          const type = normalizeDataType(item).toLowerCase();
          // Backend field schemas use both Python and UI scalar spellings.
          // Collections and model-owned objects retain their exact type.
          return (
            (
              {
                str: 'string',
                text: 'string',
                boolean: 'bool',
                integer: 'int',
                double: 'float',
                number: 'float',
              } as Record<string, string>
            )[type] ?? type
          );
        })
        .filter((item) => item && item !== 'default' && item !== 'missing'),
    ),
  ).sort();
}

/** `any` and untyped handles accept a concrete type from the other side. */
export function connectionTypesAreCompatible(sourceType: unknown, targetType: unknown) {
  const source = connectionTypes(sourceType);
  const target = connectionTypes(targetType);
  return (
    source.length === 0 ||
    target.length === 0 ||
    source.includes('any') ||
    target.includes('any') ||
    source.some((item) => target.includes(item))
  );
}
