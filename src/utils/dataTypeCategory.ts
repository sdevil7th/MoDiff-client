export function normalizeDataType(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw ?? 'default').trim();
  if (!text) return 'default';
  return (
    text
      .split('.')
      .pop()
      ?.replace(/[^\w-]/g, '_') || 'default'
  );
}

export function dataTypeClass(value: unknown) {
  return `category-${normalizeDataType(value)}`;
}
