import { useEffect, useMemo } from 'react';

import {
  advanceWorkflowOperationContext,
  captureWorkflowOperationContext,
  currentAutoResourcePlanTarget,
  isWorkflowOperationCancelled,
  useStudioStore,
  workflowOperationContextIsCurrent,
} from '../stores/useStudioStore';
import { useFlowStore } from '../stores/useFlowStore';
import { createOrUpdateStudioGraph, getStudioGraphShapeKey, syncStudioGraphValues } from './graphBridge';
import {
  autoPlanIsReady,
  autoPlanKeyForForm,
  fetchAutoResourcePlan,
  formPatchForAutoCandidate,
  selectedAutoCandidate,
} from './autoResource';
import type { StudioFormState } from './types';

/**
 * Keep Auto resource planning attached to the application lifecycle.
 *
 * Planning used to live in StudioPanel, so closing the right sidebar could
 * leave startup waiting forever and later form changes without a plan. This
 * hook has no presentation responsibilities and is intentionally mounted by
 * App instead.
 */
export function useAutoResourcePlanSync() {
  const form = useStudioStore((state) => state.form);
  const autoResourcePlan = useStudioStore((state) => state.autoResourcePlan);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const launcherDismissed = useStudioStore((state) => state.launcherDismissed);
  const graphBindingFingerprint = useStudioStore((state) => state.graphBinding?.fingerprint);
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const setAutoResourcePlan = useStudioStore((state) => state.setAutoResourcePlan);
  const autoPlanExecution = useMemo(
    () => ({
      device: form.device,
      autoOffload: form.autoOffload,
      offloadMode: form.offloadMode,
    }),
    [form.autoOffload, form.device, form.offloadMode],
  );
  const autoPlanCheckedAt = autoResourcePlan?.checkedAt;

  useEffect(() => {
    let cancelled = false;
    const context = captureWorkflowOperationContext();
    if (!launcherDismissed && !graphBindingFingerprint && nodeCount === 0) {
      setAutoResourcePlan(null);
      return () => {
        cancelled = true;
      };
    }
    if (form.resourceMode !== 'auto') {
      setAutoResourcePlan(null);
      return () => {
        cancelled = true;
      };
    }

    const planKey = autoPlanKeyForForm(form);
    const cachedPlan = useStudioStore.getState().autoResourcePlans[planKey];
    if (cachedPlan) {
      if (autoResourcePlan !== cachedPlan) setAutoResourcePlan(cachedPlan);
      return () => {
        cancelled = true;
      };
    }

    const retryingTransientFailure = autoResourcePlan?.error === true;
    const timer = window.setTimeout(
      () => {
        void fetchAutoResourcePlan(form)
          .then((plan) => {
            if (cancelled || !workflowOperationContextIsCurrent(context)) return;
            if (!plan.error) {
              useStudioStore.getState().setAutoResourcePlans({ [planKey]: plan });
            }
            setAutoResourcePlan(plan);
          })
          .catch((error) => {
            if (cancelled || !workflowOperationContextIsCurrent(context)) return;
            setAutoResourcePlan({
              error: true,
              status: 'needs_setup',
              statusLabel: 'Needs setup',
              message: String(error),
            });
          });
      },
      retryingTransientFailure ? 3_000 : 250,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeWorkflowTabId,
    autoResourcePlan,
    form,
    graphBindingFingerprint,
    launcherDismissed,
    nodeCount,
    setAutoResourcePlan,
  ]);

  useEffect(() => {
    if (
      form.resourceMode !== 'auto' ||
      !graphBindingFingerprint ||
      !autoResourcePlan ||
      !autoPlanIsReady(autoResourcePlan, autoPlanExecution)
    ) {
      return;
    }

    const context = captureWorkflowOperationContext();
    const { form: currentForm, graphBinding: binding } = useStudioStore.getState();
    const target = currentAutoResourcePlanTarget(autoResourcePlan, currentForm, binding);
    if (target) return;
    const candidate = selectedAutoCandidate(autoResourcePlan, autoPlanExecution);
    const previousShapeKey = getStudioGraphShapeKey(currentForm);
    const patch = formPatchForAutoCandidate(candidate, currentForm);
    const changed = Object.entries(patch).some(([key, value]) => currentForm[key as keyof StudioFormState] !== value);
    if (changed) {
      useStudioStore.getState().applyAutoResourcePlan(autoResourcePlan, patch);
      advanceWorkflowOperationContext(context);
    }
    const nextForm = useStudioStore.getState().form;
    syncStudioGraphValues(nextForm);
    if (previousShapeKey !== getStudioGraphShapeKey(nextForm)) {
      void createOrUpdateStudioGraph(nextForm, context).catch((error) => {
        if (isWorkflowOperationCancelled(error)) return;
        useStudioStore.getState().setLastError(String(error));
      });
    }
  }, [autoPlanCheckedAt, autoPlanExecution, autoResourcePlan, form.resourceMode, graphBindingFingerprint]);
}
