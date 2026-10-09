import { formatRequestError, RequestError } from '../utils/requestJson';

export type OptionalRuntimePollingFailure = {
  message: string;
  failures: number;
  retryDelayMs: number | null;
};

/** A lost status read never changes the durable job's outcome or identity. */
export function optionalRuntimePollingFailure(error: unknown, failures: number): OptionalRuntimePollingFailure {
  const transient =
    error instanceof RequestError &&
    (error.kind === 'network' ||
      error.kind === 'timeout' ||
      (error.kind === 'http' &&
        error.status !== undefined &&
        ([408, 425, 429].includes(error.status) || error.status >= 500)));
  return {
    message: formatRequestError(error, 'Could not verify the setup status.'),
    failures,
    // Retry ordinary worker cutover failures, but stop a persistent outage
    // from polling forever. Explicit Retry status reads the same job again.
    retryDelayMs: transient && failures < 8 ? Math.min(750 * 2 ** Math.min(failures, 3), 5_000) : null,
  };
}
