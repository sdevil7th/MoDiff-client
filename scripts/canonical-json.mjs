import { createHash } from 'node:crypto';

export function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

export function canonicalJsonHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(stableJsonValue(value)))
    .digest('hex');
}
