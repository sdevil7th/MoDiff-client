import { enqueueSnackbar } from '../ui/snackbar';
import { useState, type ReactNode } from 'react';
import { Download, Eraser, FolderOpen, Gauge, RefreshCw, Search, Settings } from 'lucide-react';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { runtimeFailureTargetsActiveWorkflow, useRunIssueStore } from '../stores/useRunIssueStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  advanceWorkflowOperationContext,
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
  useStudioStore,
} from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { createOrUpdateStudioGraph } from '../studio/graphBridge';
import { autoProofIsReady, formPatchForAutoCandidate } from '../studio/autoResource';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { getFormDefaultsForModel, getProfileForForm, STUDIO_OFFLOAD_RUNTIME_LABELS } from '../studio/modelProfiles';
import { studioLowMemoryFormValues } from '../studio/resourcePlanner';
import type { RunReadinessIssue, RuntimeFailure } from '../studio/types';
import { IssueCard, ModiffButton, ModiffDialog, ProgressBar, Spinner, type IssueCardTone } from '../ui';
import { cleanupGpuMemory } from '../utils/serverActions';

type CleanupState = 'idle' | 'running' | 'success' | 'error';

function issueTone(severity: RunReadinessIssue['severity']): IssueCardTone {
  if (severity === 'success') return 'success';
  if (severity === 'warning') return 'warning';
  if (severity === 'info') return 'info';
  return 'error';
}

export default function RunIssuesDialog() {
  const issues = useRunIssueStore((state) => state.issues);
  const issueDialogOpen = useRunIssueStore((state) => state.issueDialogOpen);
  const closeIssues = useRunIssueStore((state) => state.closeIssues);
  const failure = useRunIssueStore((state) => state.failure);
  const failureDialogOpen = useRunIssueStore((state) => state.failureDialogOpen);
  const closeFailure = useRunIssueStore((state) => state.closeFailure);
  const installHfModel = useNodesStore((state) => state.installHfModel);
  const refreshModelIndexes = useNodesStore((state) => state.refreshModelIndexes);
  const sid = useWebsocketStore((state) => state.sid);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const setStudioViewMode = useSettingsStore((state) => state.setStudioViewMode);
  const setWorkflowFocusRequest = useSettingsStore((state) => state.setWorkflowFocusRequest);
  const setModelManagerOpener = useSettingsStore((state) => state.setModelManagerOpener);
  const form = useStudioStore((state) => state.form);
  const updateForm = useStudioStore((state) => state.updateForm);
  const applyAutoResourcePlan = useStudioStore((state) => state.applyAutoResourcePlan);
  const detachManagedGraph = useStudioStore((state) => state.detachManagedGraph);
  const autoResourcePlan = useStudioStore((state) => state.autoResourcePlan);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const currentRunContext = useStudioStore((state) => state.currentRunContext);
  const workflowCanvasHydrated = useStudioStore((state) => state.workflowCanvasHydrated);
  const workflowTabs = useStudioStore((state) => state.workflowTabs);
  const failureRunContext = useStudioStore((state) => {
    const taskId = failure?.taskId?.trim();
    if (taskId) return state.runContextsByTaskId[taskId] ?? null;
    const clientRunId = failure?.clientRunId?.trim();
    return clientRunId ? (state.runContextsByClientRunId[clientRunId] ?? null) : null;
  });
  const [cleanupState, setCleanupState] = useState<CleanupState>('idle');
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const cleanupRunning = cleanupState === 'running';
  const hasCleanupIssue = issues.some((item) => item.action === 'cleanup_gpu');
  const nextCandidate = autoResourcePlan?.nextCandidate;
  const failureTargetsActiveWorkflow = runtimeFailureTargetsActiveWorkflow(failure, failureRunContext, {
    activeWorkflowTabId,
    currentRunContext,
    workflowCanvasHydrated,
    workflowTabs,
  });

  const retryWithNextCandidate = async () => {
    if (!nextCandidate || !failureTargetsActiveWorkflow) return;
    if (nextCandidate.installed === false || nextCandidate.repairRequired) {
      setRightPanelOpen(true);
      setRightPanelTab('compatibility');
      closeFailure();
      return;
    }
    if (!sid) {
      enqueueSnackbar('Connect to the MoDiff backend before retrying.', { variant: 'error' });
      return;
    }
    const patch = formPatchForAutoCandidate(nextCandidate, form);
    const followingCandidate =
      autoResourcePlan.candidates?.find(
        (candidate) =>
          candidate.id !== nextCandidate.id &&
          candidate.id !== autoResourcePlan.selectedCandidate?.id &&
          autoProofIsReady(candidate.proof),
      ) ?? null;
    const nextPlan = {
      ...autoResourcePlan,
      selectedCandidate: nextCandidate,
      nextCandidate: followingCandidate,
    };
    const context = captureWorkflowOperationContext();
    try {
      applyAutoResourcePlan(nextPlan, patch);
      advanceWorkflowOperationContext(context);
      await createOrUpdateStudioGraph(useStudioStore.getState().form, context);
      await coordinateGraphRun({ sid, studioContext: {}, workflowContext: context });
      closeFailure();
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    }
  };

  const openSetup = () => {
    setRightPanelOpen(true);
    setRightPanelTab('setup');
    closeIssues();
    closeFailure();
  };

  const openStudio = () => {
    setRightPanelOpen(true);
    setRightPanelTab('studio');
    closeIssues();
    closeFailure();
  };

  const inspectNode = (nodeId: string | null | undefined, source: 'issues' | 'failure') => {
    setRightPanelOpen(true);
    setRightPanelTab('studio');
    if (nodeId) {
      setStudioViewMode('expert');
      const flow = useFlowStore.getState();
      if (flow.nodes.some((node) => node.id === nodeId)) {
        void flow.onNodesChange(
          flow.nodes.map((node) => ({
            id: node.id,
            type: 'select' as const,
            selected: node.id === nodeId,
          })),
        );
      }
      if (activeWorkflowTabId) {
        setWorkflowFocusRequest({
          workflowTabId: activeWorkflowTabId,
          nodeId,
          requestId: Date.now(),
          requestedAt: Date.now(),
        });
      }
    } else if (activeWorkflowTabId) {
      setWorkflowFocusRequest({
        workflowTabId: activeWorkflowTabId,
        nodeId: null,
        requestId: Date.now(),
        requestedAt: Date.now(),
      });
      enqueueSnackbar('Graph centered. Readiness details remain visible in Studio.', {
        variant: 'info',
        autoHideDuration: 2600,
      });
    }
    if (source === 'issues') closeIssues();
    else closeFailure();
  };

  const openModelManager = () => {
    setRightPanelOpen(true);
    setRightPanelTab('setup');
    setModelManagerOpener({ nodeId: null, fieldKey: null });
    closeIssues();
    closeFailure();
  };

  const handleInstall = async (repoId: string) => {
    try {
      await installHfModel(repoId, sid);
    } catch (error) {
      console.error(error);
    }
  };

  const handleRefresh = async () => {
    await refreshModelIndexes(true);
    enqueueSnackbar('Model cache refreshed', { variant: 'success', autoHideDuration: 2200 });
  };

  const handleCleanupGpu = async () => {
    if (cleanupRunning) return;

    setCleanupState('running');
    setCleanupMessage('Releasing cached models, nodes, and accelerator memory...');

    try {
      const data: unknown = await cleanupGpuMemory();
      const responseMessage = cleanupResponseMessage(data);
      if (cleanupResponseHasError(data)) {
        throw new Error(responseMessage ?? 'Accelerator cleanup failed.');
      }
      const message =
        responseMessage ??
        'Accelerator cache released. Cached model state was dropped, so rerun the workflow to rebuild outputs; this action does not intentionally stop the backend.';
      setCleanupState('success');
      setCleanupMessage(message);
      enqueueSnackbar(message, { variant: 'success', autoHideDuration: 5200 });
    } catch (error) {
      const message = cleanupErrorMessage(error);
      setCleanupState('error');
      setCleanupMessage(message);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 8000 });
    }
  };

  const applyLowVramPreset = () => {
    const profile = getProfileForForm(form);
    const values = studioLowMemoryFormValues(form);

    updateForm(values);
    void createOrUpdateStudioGraph({ ...form, ...values });
    setRightPanelOpen(true);
    setRightPanelTab('studio');
    closeIssues();
    closeFailure();
    const offloadLabel = STUDIO_OFFLOAD_RUNTIME_LABELS[values.offloadMode!];
    enqueueSnackbar(`Applied ${profile.label} low-VRAM defaults with ${offloadLabel}.`, {
      variant: 'success',
      autoHideDuration: 4200,
    });
  };

  const applyFailureLowVramPreset = () => {
    if (!failureTargetsActiveWorkflow) return;
    applyLowVramPreset();
  };

  const switchToZImage = () => {
    const defaults = getFormDefaultsForModel('ZImageModularPipeline');
    const values = {
      ...defaults,
      prompt: form.prompt,
      negativePrompt: form.negativePrompt,
      width: Math.min(form.width, defaults.width),
      height: Math.min(form.height, defaults.height),
      aspectRatio:
        form.width <= defaults.width && form.height <= defaults.height ? form.aspectRatio : defaults.aspectRatio,
    };

    updateForm(values);
    void createOrUpdateStudioGraph(values);
    setRightPanelOpen(true);
    setRightPanelTab('studio');
    closeIssues();
    closeFailure();
    enqueueSnackbar('Switched to Z-Image Turbo with safer local settings.', {
      variant: 'success',
      autoHideDuration: 3600,
    });
  };

  const cleanupButton = (
    <ModiffButton
      tone="primary"
      icon={cleanupRunning ? <Spinner size={15} /> : <Eraser size={15} />}
      onClick={() => {
        void handleCleanupGpu();
      }}
      disabled={cleanupRunning}
    >
      {cleanupRunning ? 'Releasing...' : 'Release accelerator cache'}
    </ModiffButton>
  );

  return (
    <>
      <RunModal
        open={issueDialogOpen}
        onClose={closeIssues}
        title="Run blocked"
        testId="run-issues-dialog"
        footer={
          <RunDialogFooter cleanupMessage={cleanupMessage} cleanupState={cleanupState}>
            {hasCleanupIssue ? cleanupButton : null}
            <ModiffButton onClick={closeIssues}>Close</ModiffButton>
          </RunDialogFooter>
        }
      >
        {issues.map((item) => (
          <IssueCard
            key={item.id}
            tone={issueTone(item.severity)}
            title={item.message}
            meta={
              item.blocking ? 'Required before this run can start.' : 'This run can continue, but the setting is risky.'
            }
            testId={`run-issue-${item.id}`}
          >
            <div className="grid min-w-0 gap-2">
              {item.details && <p className="whitespace-pre-wrap break-words">{item.details}</p>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.action === 'install_model' && item.repoId && (
                <ModiffButton
                  tone="primary"
                  icon={<Download size={15} />}
                  onClick={() => {
                    void handleInstall(item.repoId!);
                  }}
                >
                  Install
                </ModiffButton>
              )}
              {item.action === 'refresh_cache' && (
                <ModiffButton
                  icon={<RefreshCw size={15} />}
                  onClick={() => {
                    void handleRefresh();
                  }}
                >
                  Refresh cache
                </ModiffButton>
              )}
              {item.action === 'select_image' && (
                <ModiffButton icon={<FolderOpen size={15} />} onClick={openStudio}>
                  Open Studio inputs
                </ModiffButton>
              )}
              {item.action === 'inspect_node' && (
                <ModiffButton icon={<Search size={15} />} onClick={() => inspectNode(item.nodeId, 'issues')}>
                  {item.nodeId ? 'Inspect node' : 'Inspect graph'}
                </ModiffButton>
              )}
              {item.action === 'detach_graph' && (
                <ModiffButton
                  icon={<Eraser size={15} />}
                  onClick={() => {
                    detachManagedGraph();
                    closeIssues();
                  }}
                >
                  Detach invalid receipt
                </ModiffButton>
              )}
              {item.action === 'open_model_manager' && (
                <ModiffButton tone="primary" icon={<Settings size={15} />} onClick={openModelManager}>
                  Models
                </ModiffButton>
              )}
              {item.action === 'apply_low_vram_preset' && (
                <ModiffButton tone="primary" icon={<Gauge size={15} />} onClick={applyLowVramPreset}>
                  Use low-VRAM preset
                </ModiffButton>
              )}
              {item.action === 'switch_to_z_image' && (
                <ModiffButton tone="primary" icon={<Gauge size={15} />} onClick={switchToZImage}>
                  Use Z-Image Turbo
                </ModiffButton>
              )}
              {(item.action === 'open_setup' || item.action === 'install_model') && (
                <ModiffButton tone="ghost" icon={<Settings size={15} />} onClick={openSetup}>
                  Setup
                </ModiffButton>
              )}
            </div>
          </IssueCard>
        ))}
      </RunModal>

      <RunModal
        open={failureDialogOpen}
        onClose={closeFailure}
        title="Run failed"
        testId="run-failure-dialog"
        footer={
          <RunDialogFooter cleanupMessage={cleanupMessage} cleanupState={cleanupState}>
            {nextCandidate && failureTargetsActiveWorkflow ? (
              <ModiffButton
                icon={<RefreshCw size={15} />}
                onClick={() => void retryWithNextCandidate()}
                disabled={cleanupRunning}
              >
                Retry with next option
              </ModiffButton>
            ) : null}
            {failure?.oom ? cleanupButton : null}
            {failure?.oom && failureTargetsActiveWorkflow ? (
              <ModiffButton icon={<Gauge size={15} />} onClick={applyFailureLowVramPreset} disabled={cleanupRunning}>
                Low-VRAM preset
              </ModiffButton>
            ) : null}
            {failure?.nodeId && failureTargetsActiveWorkflow ? (
              <ModiffButton icon={<Search size={15} />} onClick={() => inspectNode(failure.nodeId, 'failure')}>
                Inspect node
              </ModiffButton>
            ) : null}
            <ModiffButton icon={<Settings size={15} />} onClick={openSetup} disabled={cleanupRunning}>
              Setup
            </ModiffButton>
            <ModiffButton onClick={closeFailure}>Close</ModiffButton>
          </RunDialogFooter>
        }
      >
        {failure && (
          <div>
            <IssueCard tone={failure.oom ? 'warning' : 'error'} title={failureTitle(failure)}>
              <p className="break-words">{failureUserMessage(failure)}</p>
              {failure.message.trim() && failure.message.trim() !== failureUserMessage(failure) ? (
                <p
                  className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-xs text-modiff-text"
                  data-testid="run-failure-message"
                >
                  {failure.message}
                </p>
              ) : null}
              {failure.recoveryHint && (
                <p className="mt-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-xs text-modiff-text">
                  {failure.recoveryHint}
                </p>
              )}
            </IssueCard>
          </div>
        )}
      </RunModal>
    </>
  );
}

function failureTitle(failure: RuntimeFailure) {
  if (failure.oom || failure.category === 'oom') return 'The run ran out of available accelerator memory';
  if (failure.category === 'missing_model') return 'A required model is missing';
  if (failure.category === 'missing_dependency') return 'A backend dependency is missing';
  if (failure.category === 'backend_unavailable') return 'The backend became unavailable';
  return 'The backend stopped this run';
}

function failureUserMessage(failure: RuntimeFailure) {
  if (failure.oom || failure.category === 'oom') {
    return 'This graph needs more available memory than the current settings allow.';
  }
  if (failure.category === 'missing_model') return 'Install or select the model needed by this workflow.';
  if (failure.category === 'missing_dependency') return 'Complete the required setup, then try the run again.';
  if (failure.category === 'backend_unavailable') return 'Reconnect to MoDiff, then check the queue before retrying.';
  return 'The generation could not finish. Check the highlighted step and try again.';
}

function cleanupResponseHasError(data: unknown) {
  return isRecord(data) && Boolean(data.error);
}

function cleanupResponseMessage(data: unknown) {
  if (!isRecord(data)) return null;
  return stringValue(data.message) ?? stringValue(data.error);
}

function cleanupErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Failed to fetch')) {
    return 'MoDiff backend did not answer the cleanup request. This button does not intentionally stop the backend; restart the backend if it is no longer running, then rerun the workflow.';
  }
  return message || 'Accelerator cleanup failed.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function RunDialogFooter({
  children,
  cleanupMessage,
  cleanupState,
}: {
  children: ReactNode;
  cleanupMessage: string | null;
  cleanupState: CleanupState;
}) {
  const hasCleanupStatus = cleanupState === 'running' || Boolean(cleanupMessage);
  const statusClass =
    cleanupState === 'error'
      ? 'text-modiff-red'
      : cleanupState === 'success'
        ? 'text-modiff-green'
        : 'text-modiff-subtle-text';

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
      {hasCleanupStatus ? (
        <div className="min-w-0 flex-1 text-xs">
          <p className={statusClass}>{cleanupMessage}</p>
          {cleanupState === 'running' ? (
            <ProgressBar value={null} className="mt-2 max-w-80 rounded-modiff-compact" />
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">{children}</div>
    </div>
  );
}

function RunModal({
  children,
  footer,
  onClose,
  open,
  testId,
  title,
}: {
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
  testId: string;
  title: string;
}) {
  if (!open) return null;

  return (
    <ModiffDialog
      open={open}
      onClose={onClose}
      title={title}
      footer={footer}
      panelClassName="max-w-xl"
      bodyClassName="min-h-0"
      testId={testId}
    >
      {children}
    </ModiffDialog>
  );
}
