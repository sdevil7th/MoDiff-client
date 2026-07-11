export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;

  const bothAreObjects = a && b && typeof a === 'object' && typeof b === 'object';
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return (
    bothAreObjects &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => deepEqual(left[key], right[key]))
  );
};
