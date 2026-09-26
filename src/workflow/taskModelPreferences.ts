/** Bounded authoring preferences, never execution authority. */
const KEY = 'modiff.task-models';
const valid = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  [...value].every((character) => character.charCodeAt(0) >= 32);

function read(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k, v]) => valid(k) && valid(v))
        .slice(-64),
    );
  } catch {
    return {};
  }
}

export function preferredTaskModel(task: string): string | undefined {
  return read()[task];
}

export function rememberTaskModel(task: string, profile: string) {
  if (!valid(task) || !valid(profile)) return;
  const previous = read();
  delete previous[task];
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(Object.fromEntries([...Object.entries(previous), [task, profile]].slice(-64))),
    );
  } catch {
    /* Storage may be disabled; selecting a model must still succeed. */
  }
}
