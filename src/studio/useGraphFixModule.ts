import { useEffect, useState } from 'react';

type GraphFixModule = typeof import('./graphFixer');
let loaded: GraphFixModule | undefined;
let pending: Promise<GraphFixModule> | undefined;

/** Load repair planning on demand; normal startup need not parse every repair. */
export function useGraphFixModule(enabled: boolean) {
  const [module, setModule] = useState<GraphFixModule | undefined>(() => loaded);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || module) return;
    let active = true;
    pending ??= import('./graphFixer').then((value) => (loaded = value));
    void pending
      .then((value) => {
        if (active) setModule(value);
      })
      .catch(() => {
        pending = undefined;
        if (active) setError('Graph fixes could not be loaded. Refresh the app to retry.');
      });
    return () => {
      active = false;
    };
  }, [enabled, module]);
  return { module, error };
}
