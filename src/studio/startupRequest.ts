export type StartupRequestCache<T> = {
  hasRejected: () => boolean;
  load: (refresh?: boolean) => Promise<T>;
};

/**
 * Keeps successful startup discovery cached for the application lifetime while
 * clearing a rejected request so one bounded readiness-triggered retry can
 * recover from the frontend starting before the backend.
 */
export function createStartupRequestCache<T>(loader: () => Promise<T>): StartupRequestCache<T> {
  let request: Promise<T> | null = null;
  let rejected = false;

  return {
    hasRejected: () => rejected,
    load: (refresh = false) => {
      if (request && !refresh) return request;
      rejected = false;
      const next = loader();
      request = next;
      void next.then(
        () => {
          if (request === next) rejected = false;
        },
        () => {
          if (request === next) {
            request = null;
            rejected = true;
          }
        },
      );
      return next;
    },
  };
}

export function shouldRetryStartupRequest(options: {
  attempted: boolean;
  backendReady: boolean;
  discoveryRefreshing: boolean;
  failed: boolean;
}) {
  return options.failed && options.backendReady && !options.discoveryRefreshing && !options.attempted;
}

export function shouldRetryStaticStartupRequest(options: { attempted: boolean; failed: boolean }) {
  return options.failed && !options.attempted;
}
