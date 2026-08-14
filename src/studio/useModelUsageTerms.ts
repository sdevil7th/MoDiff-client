import { useRef, useState } from 'react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { usagePolicyAcknowledgementKey, type ResolvedModelUsagePolicy } from './modelUsagePolicies';

export type ModelUsageTermsAction = 'create' | 'install' | 'run';

export function useModelUsageTermsGate() {
  const acknowledgements = useSettingsStore((state) => state.modelTermsAcknowledgements);
  const acknowledge = useSettingsStore((state) => state.acknowledgeModelTerms);
  const next = useRef<(() => void | Promise<void>) | null>(null);
  const [pending, setPending] = useState<{
    action: ModelUsageTermsAction;
    policies: ResolvedModelUsagePolicy[];
  } | null>(null);
  const needsReview = (policies: readonly ResolvedModelUsagePolicy[]) => {
    const key = usagePolicyAcknowledgementKey(policies);
    return Boolean(key && !acknowledgements[key]);
  };
  const request = (
    action: ModelUsageTermsAction,
    policies: ResolvedModelUsagePolicy[],
    callback: () => void | Promise<void>,
  ) => {
    if (needsReview(policies)) {
      next.current = callback;
      setPending({ action, policies });
      return;
    }
    void callback();
  };
  const cancel = () => {
    next.current = null;
    setPending(null);
  };
  const confirm = () => {
    const key = usagePolicyAcknowledgementKey(pending?.policies ?? []);
    if (key) acknowledge(key);
    const callback = next.current;
    next.current = null;
    setPending(null);
    void callback?.();
  };
  return { pending, needsReview, request, cancel, confirm };
}
