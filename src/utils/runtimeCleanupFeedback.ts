import type { GpuCleanupResult } from './serverActions';

/** Cleanup warnings do not establish released-file counts or remaining ownership. */
export function runtimeCleanupFeedback(result: GpuCleanupResult): { state: 'success' | 'warning'; message: string } {
  const errors = result.cleanup_errors === undefined ? [] : result.cleanup_errors;
  if (
    !Array.isArray(errors) ||
    errors.length > 64 ||
    errors.some((error) => typeof error !== 'string' || error.length > 8192)
  ) {
    throw new Error('The accelerator cleanup response has invalid cleanup details.');
  }
  const message =
    typeof result.message === 'string' && result.message.trim()
      ? result.message
      : 'Accelerator cache released. Cached model state was dropped, so rerun the workflow to rebuild outputs; this action does not intentionally stop the backend.';
  const warnings = errors.filter((error) => error.trim());
  return { state: warnings.length ? 'warning' : 'success', message: [message, ...warnings].join('\n') };
}
