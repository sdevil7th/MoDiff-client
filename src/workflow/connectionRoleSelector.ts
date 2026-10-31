export type ConnectionRoleSelector = { field: string; values: Record<string, string> };
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Resolve a declared component kind without evaluating a supplier or field action. */
export function isConnectionRoleSelector(value: unknown): value is ConnectionRoleSelector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const selector = value as Record<string, unknown>;
  if (
    Object.keys(selector).length !== 2 ||
    !owns(selector, 'field') ||
    !owns(selector, 'values') ||
    typeof selector.field !== 'string' ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(selector.field)
  )
    return false;
  if (!selector.values || typeof selector.values !== 'object' || Array.isArray(selector.values)) return false;
  const values = Object.entries(selector.values);
  return (
    values.length > 0 &&
    values.length <= 16 &&
    values.every(
      ([key, role]) =>
        /^[a-z][a-z0-9_]{0,63}$/.test(key) && typeof role === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(role),
    )
  );
}

export function selectedConnectionRole(
  selector: unknown,
  params: Record<string, { value?: unknown; default?: unknown; isConnected?: boolean }>,
) {
  if (!isConnectionRoleSelector(selector)) return undefined;
  const field = params[selector.field];
  if (!field || field.isConnected) return undefined;
  const value = field.value ?? field.default;
  return typeof value === 'string' && owns(selector.values, value) ? selector.values[value] : undefined;
}
