import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { enqueueSnackbar } from '../ui/snackbar';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  advanceWorkflowOperationContext,
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
  useStudioStore,
  workflowOperationContextIsCurrent,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import {
  createOrUpdateStudioGraph,
  ensureStudioGraphReadyForRun,
  getStudioGraphShapeKey,
  syncStudioGraphValues,
} from './graphBridge';
import { validateCurrentRun } from './runReadiness';
import {
  autoPlanIsReady,
  autoPlanKeyForForm,
  fetchAutoResourcePlan,
  formPatchForAutoCandidate,
  selectedAutoCandidate,
} from './autoResource';
import { coordinateGraphRun } from './runCoordinator';
import { materializeTemplateDefaultInputs } from './templateInputs';
import { STUDIO_TEMPLATES } from './templates';
import { exactStudioExecutionProfileForForm } from './executionSpecs';
import type { StudioFormState, StudioMode, StudioModelType, StudioResourceMode } from './types';

export async function ensureStudioAutoPlanReadyForRun(
  context: WorkflowOperationContext = captureWorkflowOperationContext(),
) {
  assertWorkflowOperationContext(context);
  const currentForm = useStudioStore.getState().form;
  if (currentForm.resourceMode !== 'auto') return true;

  const studio = useStudioStore.getState();
  const planKey = autoPlanKeyForForm(currentForm);
  const currentPlan =
    (autoPlanIsReady(studio.autoResourcePlan, currentForm) ? studio.autoResourcePlan : null) ??
    studio.autoResourcePlans[planKey] ??
    null;

  // Auto recipe selection is performed when the app starts, a template is
  // created, or a resource-relevant form key changes. Run should consume that
  // committed recipe instead of issuing the same planning request again.
  // The backend still samples live RAM/VRAM and releases stale MoDiff-owned
  // caches atomically for every submitted Auto graph.
  if (currentPlan && autoPlanIsReady(currentPlan, currentForm)) {
    const previousShapeKey = getStudioGraphShapeKey(currentForm);
    const patch = formPatchForAutoCandidate(selectedAutoCandidate(currentPlan, currentForm), currentForm);
    studio.applyAutoResourcePlan(currentPlan, patch);
    advanceWorkflowOperationContext(context);
    const nextForm = useStudioStore.getState().form;
    syncStudioGraphValues(nextForm);
    if (previousShapeKey !== getStudioGraphShapeKey(nextForm)) {
      await createOrUpdateStudioGraph(nextForm, context);
    }
    assertWorkflowOperationContext(context);
    return true;
  }

  studio.setAutoResourceCheck({
    status: 'checking',
    message: 'Choosing Auto resource plan...',
    startedAt: Date.now(),
  });

  try {
    // Non-toolbar entry points (rerun, loop, app mode, and test harnesses) can
    // reach this function before background planning has completed. Prepare
    // the missing recipe once so those paths remain self-contained.
    const plan = await fetchAutoResourcePlan(currentForm);
    assertWorkflowOperationContext(context);

    if (!plan || !autoPlanIsReady(plan, currentForm)) {
      useStudioStore.getState().setAutoResourcePlan(plan);
      const message =
        plan?.blockingReason || plan?.message || 'Auto could not choose a runnable local plan for this workflow.';
      useStudioStore.getState().setLastError(message);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
      return false;
    }

    const candidate = selectedAutoCandidate(plan, currentForm);
    const previousShapeKey = getStudioGraphShapeKey(currentForm);
    const patch = formPatchForAutoCandidate(candidate, currentForm);
    useStudioStore.getState().applyAutoResourcePlan(plan, patch);
    advanceWorkflowOperationContext(context);
    const nextForm = useStudioStore.getState().form;
    syncStudioGraphValues(nextForm);
    if (previousShapeKey !== getStudioGraphShapeKey(nextForm)) {
      await createOrUpdateStudioGraph(nextForm, context);
    }
    assertWorkflowOperationContext(context);
    return true;
  } finally {
    if (workflowOperationContextIsCurrent(context, { includeForm: false })) {
      useStudioStore.getState().setAutoResourceCheck({
        status: 'idle',
        message: null,
        startedAt: null,
      });
    }
  }
}

type MissingInstallTarget = {
  repo: string;
  label: string;
  reason?: string;
  actionLabel?: string;
  repair?: boolean;
} | null;

let managedGraphSyncTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

function scheduleManagedGraphRebuild() {
  if (!useStudioStore.getState().graphBinding) return;
  if (managedGraphSyncTimer) {
    globalThis.clearTimeout(managedGraphSyncTimer);
  }

  const form = useStudioStore.getState().form;
  const context = captureWorkflowOperationContext();
  managedGraphSyncTimer = globalThis.setTimeout(() => {
    managedGraphSyncTimer = null;
    if (!useStudioStore.getState().graphBinding || !workflowOperationContextIsCurrent(context)) return;

    createOrUpdateStudioGraph(form, context).catch((error) => {
      if (isWorkflowOperationCancelled(error)) return;
      const message = String(error);
      useStudioStore.getState().setLastError(message);
      console.error('Studio graph auto-sync failed', error);
    });
  }, 120);
}

type StudioRunActionsOptions = {
  sid?: string | null;
  isConnected: boolean;
  missingInstallTarget: MissingInstallTarget;
  installHfModel: (repoId: string, sid?: string | null, options?: { repair?: boolean }) => Promise<unknown>;
  setIsWorking: Dispatch<SetStateAction<boolean>>;
};

export function useStudioRunActions({
  sid,
  isConnected,
  missingInstallTarget,
  installHfModel,
  setIsWorking,
}: StudioRunActionsOptions) {
  const updateAndSync = useCallback((values: Partial<StudioFormState>) => {
    const previousForm = useStudioStore.getState().form;
    const previousShapeKey = getStudioGraphShapeKey(previousForm);
    useStudioStore.getState().updateForm(values);
    // updateForm owns device/offload normalization. Read its committed value
    // before touching the graph so a device rebase cannot momentarily write an
    // invalid CPU/MPS/XPU + CPU-offload combination into managed nodes.
    const nextForm = useStudioStore.getState().form;
    const nextShapeKey = getStudioGraphShapeKey(nextForm);
    syncStudioGraphValues(nextForm);
    if (previousShapeKey !== nextShapeKey || useStudioStore.getState().graphFinalization?.status === 'pending') {
      scheduleManagedGraphRebuild();
    }
  }, []);

  const handleCreateGraph = useCallback(async () => {
    const context = captureWorkflowOperationContext();
    setIsWorking(true);
    try {
      await createOrUpdateStudioGraph(useStudioStore.getState().form, context);
      assertWorkflowOperationContext(context);
      const finalization = useStudioStore.getState().graphFinalization;
      enqueueSnackbar(
        finalization?.status === 'pending' ? 'Studio graph created; finalizing fields' : 'Studio graph updated',
        { variant: finalization?.status === 'pending' ? 'info' : 'success', autoHideDuration: 2200 },
      );
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setIsWorking(false);
    }
  }, [setIsWorking]);

  const handleModeChange = useCallback(
    async (mode: StudioMode) => {
      useStudioStore.getState().selectMode(mode);
      const context = captureWorkflowOperationContext();
      setIsWorking(true);
      try {
        await createOrUpdateStudioGraph(useStudioStore.getState().form, context);
      } catch (error) {
        if (isWorkflowOperationCancelled(error)) return;
        enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
      } finally {
        setIsWorking(false);
      }
    },
    [setIsWorking],
  );

  const handleModelTypeChange = useCallback(
    (modelType: StudioModelType) => {
      const current = useStudioStore.getState().form;
      const nodeStore = useNodesStore.getState();
      const quantizationMode = exactStudioExecutionProfileForForm(
        nodeStore.studioModelCapabilities,
        nodeStore.studioExecutionSpecInvalid,
        { modelType, mode: current.mode },
      )?.expert_quantization_modes?.includes(
        current.quantizationMode as Exclude<StudioFormState['quantizationMode'], 'none'>,
      )
        ? current.quantizationMode
        : 'none';
      useStudioStore.getState().updateForm({ modelType, quantizationMode });
      void handleCreateGraph();
    },
    [handleCreateGraph],
  );

  const handleResourceModeChange = useCallback(async (resourceMode: StudioResourceMode) => {
    useStudioStore.getState().updateForm({ resourceMode });
    const nextForm = useStudioStore.getState().form;
    syncStudioGraphValues(nextForm);
  }, []);

  const ensureAutoPlanReady = useCallback(async (context?: WorkflowOperationContext) => {
    return ensureStudioAutoPlanReadyForRun(context);
  }, []);

  const handleRun = useCallback(async () => {
    const studio = useStudioStore.getState();
    if (!sid || !isConnected) {
      const validation = validateCurrentRun({ sid, isConnected, includeStudio: true });
      const message = validation.blocking[0]?.message || 'Connect to the MoDiff server before running the graph.';
      studio.setLastError(message);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 5000 });
      return;
    }

    const context = captureWorkflowOperationContext();
    setIsWorking(true);
    try {
      const autoReady = await ensureAutoPlanReady(context);
      if (!autoReady) return;
      await ensureStudioGraphReadyForRun(useStudioStore.getState().form, context);
      assertWorkflowOperationContext(context);
      const validation = validateCurrentRun({ sid, isConnected, includeStudio: true });
      if (!validation.canRun) {
        const message = validation.blocking[0]?.message || 'This Studio workflow is not ready to run.';
        useStudioStore.getState().setLastError(message);
        return;
      }

      useStudioStore.getState().addPromptHistory(useStudioStore.getState().form.prompt);
      await coordinateGraphRun({ sid, studioContext: {}, workflowContext: context });
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      const message = String(error);
      useStudioStore.getState().setLastError(message);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setIsWorking(false);
    }
  }, [ensureAutoPlanReady, isConnected, setIsWorking, sid]);

  const handleInstallMissingModel = useCallback(async () => {
    if (!missingInstallTarget) return;
    const context = captureWorkflowOperationContext();
    useStudioStore.getState().setLastError(null);
    try {
      await installHfModel(missingInstallTarget.repo, sid, { repair: missingInstallTarget.repair });
      assertWorkflowOperationContext(context);
      if (useStudioStore.getState().form.resourceMode === 'auto') {
        const plan = await fetchAutoResourcePlan(useStudioStore.getState().form);
        assertWorkflowOperationContext(context);
        useStudioStore.getState().setAutoResourcePlan(plan);
      }
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      useStudioStore.getState().setLastError(message);
      console.error(error);
    }
  }, [installHfModel, missingInstallTarget, sid]);

  const openSetup = useCallback(() => {
    useSettingsStore.getState().setRightPanelOpen(true);
    useSettingsStore.getState().setRightPanelTab('setup');
  }, []);

  const applyTemplateAndSync = useCallback(
    async (templateId: string) => {
      const template = STUDIO_TEMPLATES.find((item) => item.id === templateId);
      if (!template) return;
      if (useFlowStore.getState().nodes.length > 0) {
        useStudioStore.getState().createWorkflowTab(template.label, undefined, 'template', template.id);
      }
      const context = captureWorkflowOperationContext();
      setIsWorking(true);
      try {
        const inputDefaults = await materializeTemplateDefaultInputs(template);
        assertWorkflowOperationContext(context);
        useStudioStore.getState().applyTemplate(template, inputDefaults);
        advanceWorkflowOperationContext(context);
        await createOrUpdateStudioGraph(useStudioStore.getState().form, context);
      } catch (error) {
        if (isWorkflowOperationCancelled(error)) return;
        const message = String(error);
        useStudioStore.getState().setLastError(message);
        enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
      } finally {
        setIsWorking(false);
      }
    },
    [setIsWorking],
  );

  return {
    updateAndSync,
    handleCreateGraph,
    handleModeChange,
    handleModelTypeChange,
    handleResourceModeChange,
    handleRun,
    handleInstallMissingModel,
    openSetup,
    applyTemplateAndSync,
  };
}
