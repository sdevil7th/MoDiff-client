export type SettledGraphFinalization<T> = { status: 'complete'; value: T } | { status: 'error'; error: Error };

export type GraphFinalizationWaitResult<T> = SettledGraphFinalization<T> | { status: 'timeout' };

function normalizedError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Converts a background finalizer into a promise that always settles cleanly.
 * Its failure remains explicit in the value, preventing an unobserved
 * background rejection without turning that failure into success.
 */
export function settleGraphFinalization<T>(promise: Promise<T>): Promise<SettledGraphFinalization<T>> {
  return promise.then(
    (value) => ({ status: 'complete', value }),
    (error) => ({ status: 'error', error: normalizedError(error) }),
  );
}

export async function waitForSettledGraphFinalization<T>(
  promise: Promise<SettledGraphFinalization<T>>,
  timeoutMs: number,
): Promise<GraphFinalizationWaitResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ status: 'timeout' }>((resolve) => {
    timeoutId = globalThis.setTimeout(() => resolve({ status: 'timeout' }), Math.max(0, timeoutMs));
  });
  const result = await Promise.race([promise, timeout]);
  if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  return result;
}
