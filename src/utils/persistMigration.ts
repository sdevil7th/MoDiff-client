const migratedKeys = new Set<string>();

export function migrateLocalStorageKey(legacyKey: string, nextKey: string) {
  const migrationKey = `${legacyKey}->${nextKey}`;
  if (migratedKeys.has(migrationKey)) return;
  migratedKeys.add(migrationKey);

  if (typeof window === 'undefined') return;

  try {
    const storage = window.localStorage;
    if (!storage || storage.getItem(nextKey) !== null) return;

    const legacyValue = storage.getItem(legacyKey);
    if (legacyValue === null) return;

    storage.setItem(nextKey, legacyValue);
  } catch {
    // Persistence migration should never block app startup.
  }
}
