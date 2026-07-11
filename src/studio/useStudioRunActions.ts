import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { enqueueSnackbar } from '../ui/snackbar';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import {
  createOrUpdateStudioGraph,
  ensureStudioGraphReadyForRun,
  getStudioGraphShapeKey,
  syncStudioGraphValues,
} from './graphBridge';
import { validateCurrentRun } from './runReadiness';
import {
  autoPlanIsReady,
  fetchAutoResourcePlan,
  formPatchForAutoCandidate,
  selectedAutoCandidate,
} from './autoResource';
import { coordinateGraphRun } from './runCoordinator';
import { STUDIO_TEMPLATES } from './templates';
import type { StudioFormState, StudioMode, StudioModelType, StudioResourceMode } from './types';

export async function ensureStudioAutoPlanReadyForRun() {
  const currentForm = useStudioStore.getState().form;
  if (currentForm.resourceMode !== 'auto') return true;

  const studio = useStudioStore.getState();
  studio.setAutoResourceCheck({
    status: 'checking',
    message: 'Choosing Auto resource plan...',
    startedAt: Date.now(),
  });

  try {
    const cachedPlan = useStudioStore.getState().autoResourcePlan;
    const plan = autoPlanIsReady(cachedPlan) ? cachedPlan : await fetchAutoResourcePlan(currentForm);
    useStudioStore.getState().setAutoResourcePlan(plan);

    if (!plan || !autoPlanIsReady(plan)) {
      const message =
        plan?.blockingReason || plan?.message || 'Auto could not choose a runnable local plan for this workflow.';
      useStudioStore.getState().setLastError(message);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
      return false;
    }

    const candidate = selectedAutoCandidate(plan);
    const patch = formPatchForAutoCandidate(candidate, currentForm);
    if (Object.keys(patch).length > 0) {
      useStudioStore.getState().updateForm(patch);
      useStudioStore.getState().setAutoResourcePlan(plan);
      const nextForm = useStudioStore.getState().form;
      syncStudioGraphValues(nextForm);
      await createOrUpdateStudioGraph(nextForm);
    }
    return true;
  } finally {
    useStudioStore.getState().setAutoResourceCheck({
      status: 'idle',
      message: null,
      startedAt: null,
    });
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

  managedGraphSyncTimer = globalThis.setTimeout(() => {
    managedGraphSyncTimer = null;
    if (!useStudioStore.getState().graphBinding) return;

    createOrUpdateStudioGraph(useStudioStore.getState().form).catch((error) => {
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
    const nextForm = { ...previousForm, ...values };
    const nextShapeKey = getStudioGraphShapeKey(nextForm);
    useStudioStore.getState().updateForm(values);
    syncStudioGraphValues(nextForm);
    if (previousShapeKey !== nextShapeKey) {
      scheduleManagedGraphRebuild();
    }
  }, []);

  const handleCreateGraph = useCallback(async () => {
    setIsWorking(true);
    try {
      await createOrUpdateStudioGraph();
      const finalization = useStudioStore.getState().graphFinalization;
      enqueueSnackbar(
        finalization?.status === 'pending' ? 'Studio graph created; finalizing fields' : 'Studio graph updated',
        { variant: finalization?.status === 'pending' ? 'info' : 'success', autoHideDuration: 2200 },
      );
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setIsWorking(false);
    }
  }, [setIsWorking]);

  const handleModeChange = useCallback(
    async (mode: StudioMode) => {
      useStudioStore.getState().selectMode(mode);
      setIsWorking(true);
      try {
        await createOrUpdateStudioGraph(useStudioStore.getState().form);
      } catch (error) {
        enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
      } finally {
        setIsWorking(false);
      }
    },
    [setIsWorking],
  );

  const handleModelTypeChange = useCallback(
    (modelType: StudioModelType) => {
      useStudioStore.getState().updateForm({ modelType });
      void handleCreateGraph();
    },
    [handleCreateGraph],
  );

  const handleResourceModeChange = useCallback(
    async (resourceMode: StudioResourceMode) => {
      useStudioStore.getState().updateForm({ resourceMode });
      const nextForm = useStudioStore.getState().form;
      syncStudioGraphValues(nextForm);

      if (!useStudioStore.getState().graphBinding) return;

      setIsWorking(true);
      try {
        await createOrUpdateStudioGraph(nextForm);
      } catch (error) {
        const message = String(error);
        useStudioStore.getState().setLastError(message);
        enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
      } finally {
        setIsWorking(false);
      }
    },
    [setIsWorking],
  );

  const ensureAutoPlanReady = useCallback(async () => {
    return ensureStudioAutoPlanReadyForRun();
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

    setIsWorking(true);
    try {
      const autoReady = await ensureAutoPlanReady();
      if (!autoReady) return;
      await ensureStudioGraphReadyForRun();
      const validation = validateCurrentRun({ sid, isConnected, includeStudio: true });
      if (!validation.canRun) {
        const message = validation.blocking[0]?.message || 'This Studio workflow is not ready to run.';
        useStudioStore.getState().setLastError(message);
        return;
      }

      useStudioStore.getState().addPromptHistory(useStudioStore.getState().form.prompt);
      await coordinateGraphRun({ sid, studioContext: {} });
    } catch (error) {
      const message = String(error);
      useStudioStore.getState().setLastError(message);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setIsWorking(false);
    }
  }, [ensureAutoPlanReady, isConnected, setIsWorking, sid]);

  const handleInstallMissingModel = useCallback(async () => {
    if (!missingInstallTarget) return;
    useStudioStore.getState().setLastError(null);
    try {
      await installHfModel(missingInstallTarget.repo, sid, { repair: missingInstallTarget.repair });
      if (useStudioStore.getState().form.resourceMode === 'auto') {
        const plan = await fetchAutoResourcePlan(useStudioStore.getState().form);
        useStudioStore.getState().setAutoResourcePlan(plan);
      }
    } catch (error) {
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
      useStudioStore.getState().applyTemplate(template);
      setIsWorking(true);
      try {
        await createOrUpdateStudioGraph(useStudioStore.getState().form);
      } catch (error) {
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
