import { setTimeout as delay } from 'node:timers/promises';

type Sample = {
  path: string;
  at: string;
  milliseconds: number;
  status?: number;
  error?: string;
  taskId?: string | null;
  allocatorStatuses?: Array<string | null>;
};

export function startRuntimeResponsivenessProbe(baseUrl: string) {
  const controller = new AbortController();
  const samples: Sample[] = [];
  const paths = ['/health', '/queue', '/favicon.ico', '/runtime/resources'];
  const running = (async () => {
    while (!controller.signal.aborted) {
      await Promise.all(
        paths.map(async (path) => {
          const start = Date.now();
          try {
            const response = await fetch(new URL(path, baseUrl), {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)]),
            });
            // Queue snapshots are deliberately not retained: they may contain
            // large workflow payloads. This is latency evidence, not provenance.
            const body = await response.text();
            let taskId: string | null | undefined;
            let allocatorStatuses: Array<string | null> | undefined;
            if (path === '/runtime/resources') {
              const value = JSON.parse(body) as {
                currentRun?: { taskId?: string } | null;
                accelerators?: Array<{ allocatorStatsStatus?: string }>;
              };
              taskId = value.currentRun?.taskId ?? null;
              allocatorStatuses = value.accelerators?.map((item) => item.allocatorStatsStatus ?? null);
            }
            samples.push({
              path,
              at: new Date(start).toISOString(),
              milliseconds: Date.now() - start,
              status: response.status,
              taskId,
              allocatorStatuses,
            });
          } catch (error) {
            if (!controller.signal.aborted)
              samples.push({
                path,
                at: new Date(start).toISOString(),
                milliseconds: Date.now() - start,
                error: error instanceof Error ? error.name : String(error),
              });
          }
        }),
      );
      if (samples.length >= 100_000) throw new Error('Runtime responsiveness sample bound exceeded.');
      await delay(750, undefined, { signal: controller.signal }).catch(() => undefined);
    }
  })();
  return {
    async stop() {
      controller.abort();
      await running;
      return samples;
    },
  };
}
