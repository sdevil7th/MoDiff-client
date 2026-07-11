import { enqueueSnackbar } from '../ui/snackbar';
import { useState, type ReactNode } from 'react';
import { Download, Eraser, FolderOpen, Gauge, RefreshCw, Settings } from 'lucide-react';
import { useNodesStore } from '../stores/useNodeStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { createOrUpdateStudioGraph } from '../studio/graphBridge';
import {
  getFormDefaultsForModel,
  getProfileForForm,
  QWEN_LOW_VRAM_OFFLOAD_MODE,
  STUDIO_OFFLOAD_RUNTIME_LABELS,
} from '../studio/modelProfiles';
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
  const setModelManagerOpener = useSettingsStore((state) => state.setModelManagerOpener);
  const form = useStudioStore((state) => state.form);
  const updateForm = useStudioStore((state) => state.updateForm);
  const [cleanupState, setCleanupState] = useState<CleanupState>('idle');
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const cleanupRunning = cleanupState === 'running';
  const hasCleanupIssue = issues.some((item) => item.action === 'cleanup_gpu');

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
    if (profile.family === 'Wan Video') {
      const values = {
        width: 832,
        height: 480,
        aspectRatio: '16:9' as const,
        numFrames: 49,
        fps: 16,
        steps: profile.lowVram.steps,
        guidanceScale: 4.5,
        conditioningScale: 1,
        resourceMode: 'auto' as const,
        dtype: profile.lowVram.dtype,
        quantizationMode: 'none' as const,
        autoOffload: true,
        offloadMode: profile.lowVram.offloadMode ?? profile.offloadSupport.lowVram,
      };
      updateForm(values);
      void createOrUpdateStudioGraph({ ...form, ...values });
      setRightPanelOpen(true);
      setRightPanelTab('studio');
      closeIssues();
      closeFailure();
      enqueueSnackbar('Applied video low-VRAM preset: 832x480, 49 frames, bfloat16 with offload.', {
        variant: 'success',
        autoHideDuration: 4200,
      });
      return;
    }

    const width = profile.family === 'Qwen Image' ? profile.defaultSize.width : form.width;
    const height = profile.family === 'Qwen Image' ? profile.defaultSize.height : form.height;
    const values = {
      width,
      height,
      steps: profile.lowVram.steps,
      resourceMode: 'auto' as const,
      dtype: profile.lowVram.dtype,
      quantizationMode: 'none' as const,
      autoOffload: true,
      offloadMode: profile.lowVram.offloadMode ?? profile.offloadSupport.lowVram,
    };

    updateForm(values);
    void createOrUpdateStudioGraph({ ...form, ...values });
    setRightPanelOpen(true);
    setRightPanelTab('studio');
    closeIssues();
    closeFailure();
    const offloadLabel =
      values.offloadMode === QWEN_LOW_VRAM_OFFLOAD_MODE
        ? 'RAM/CPU model offload'
        : STUDIO_OFFLOAD_RUNTIME_LABELS[values.offloadMode];
    enqueueSnackbar(
      `Applied Auto resource plan defaults: ${width}x${height}, ${profile.lowVram.steps} steps, ${offloadLabel}.`,
      { variant: 'success', autoHideDuration: 4200 },
    );
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
            <div className="grid gap-2">
              {item.details && <p className="break-words">{item.details}</p>}
              {(item.repoId || item.modelPath || item.nodeId) && (
                <details className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2">
                  <summary className="cursor-pointer text-xs font-semibold text-modiff-text">
                    Technical reference
                  </summary>
                  <p className="mt-1 break-all text-xs text-modiff-muted">
                    {item.repoId ? `Repo: ${item.repoId}` : ''}
                    {item.repoId && (item.modelPath || item.nodeId) ? ' | ' : ''}
                    {item.modelPath ? `Path: ${item.modelPath}` : ''}
                    {item.modelPath && item.nodeId ? ' | ' : ''}
                    {item.nodeId ? `Node: ${item.nodeId}` : ''}
                  </p>
                </details>
              )}
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
            {failure?.oom ? cleanupButton : null}
            {failure?.oom ? (
              <ModiffButton icon={<Gauge size={15} />} onClick={applyLowVramPreset} disabled={cleanupRunning}>
                Low-VRAM preset
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
            <IssueCard
              tone={failure.oom ? 'warning' : 'error'}
              title={failureTitle(failure)}
              meta={failureMeta(failure)}
            >
              <p className="break-words">{failure.message}</p>
              {failure.recoveryHint && (
                <p className="mt-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-xs text-modiff-text">
                  {failure.recoveryHint}
                </p>
              )}
              {failure.memorySummary && (
                <div className="mt-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-xs text-gray-300">
                  {failure.memorySummary}
                </div>
              )}
              {runtimeHintSummary(failure) && (
                <div className="mt-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-xs text-gray-300">
                  {runtimeHintSummary(failure)}
                </div>
              )}
              {cudaMemorySummary(failure) && (
                <div className="mt-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-xs text-gray-300">
                  {cudaMemorySummary(failure)}
                </div>
              )}
              {gpuProcessSummary(failure) && (
                <div className="mt-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-xs text-gray-300">
                  {gpuProcessSummary(failure)}
                </div>
              )}
              <details className="mt-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2">
                <summary className="cursor-pointer text-xs font-semibold text-modiff-text">Run reference</summary>
                <div className="mt-1 grid gap-1 break-all text-xs text-modiff-muted">
                  <div>
                    {failure.nodeId ? `Node ${failure.nodeId}` : 'Graph run'}
                    {failure.taskId ? ` | Task ${failure.taskId}` : ''}
                  </div>
                  {(failure.category || failure.errorCode) && (
                    <div>
                      {failure.category ? `Category: ${failure.category}` : ''}
                      {failure.category && failure.errorCode ? ' | ' : ''}
                      {failure.errorCode ? `Code: ${failure.errorCode}` : ''}
                    </div>
                  )}
                </div>
              </details>
            </IssueCard>
            {hasRuntimeDiagnostics(failure) && (
              <details className="mt-3 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3">
                <summary className="cursor-pointer text-xs font-semibold text-modiff-text">
                  Accelerator diagnostics
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-gray-300">
                  {formatDiagnostics(failure)}
                </pre>
              </details>
            )}
            {failure.traceback && (
              <details className="mt-3 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3">
                <summary className="cursor-pointer text-xs font-semibold text-modiff-text">Traceback details</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-gray-300">
                  {failure.traceback}
                </pre>
              </details>
            )}
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

function failureMeta(failure: RuntimeFailure) {
  const parts = [failure.exceptionType || 'Runtime error'];
  if (failure.errorCode) parts.push(failure.errorCode);
  return parts.join(' | ');
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

function formatBytes(bytes?: number | null) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function cudaMemorySummary(failure: RuntimeFailure) {
  const snapshot = failure.cudaMemorySnapshot;
  if (!snapshot) return null;
  const device = snapshot.devices?.[0];
  const freeBytes = snapshot.free_bytes ?? device?.free_bytes;
  const totalBytes = snapshot.total_bytes ?? device?.total_bytes;
  const allocatedBytes = snapshot.allocated_bytes ?? device?.allocated_bytes;
  const free = formatBytes(freeBytes);
  const total = formatBytes(totalBytes);
  const allocated = formatBytes(allocatedBytes);
  if (free && total) {
    return `CUDA at failure: ${free} free / ${total} total${allocated ? `, ${allocated} allocated by MoDiff` : ''}.`;
  }
  if (snapshot.error) return `CUDA memory snapshot unavailable: ${snapshot.error}`;
  if (snapshot.available === false) return 'CUDA memory snapshot is not available from this backend.';
  return null;
}

function gpuProcessSummary(failure: RuntimeFailure) {
  const processes = failure.gpuProcesses?.processes ?? [];
  if (processes.length === 0) return null;
  const visible = processes.slice(0, 3).map((process) => {
    const name = process.process_name || (process.pid ? `PID ${process.pid}` : 'Unknown process');
    return process.used_memory_mb ? `${name} (${process.used_memory_mb} MB)` : name;
  });
  return `${processes.length} GPU process${processes.length === 1 ? '' : 'es'} visible through nvidia-smi: ${visible.join(', ')}.`;
}

function hasRuntimeDiagnostics(failure: RuntimeFailure) {
  return Boolean(
    failure.cudaMemorySnapshot ||
    failure.gpuProcesses ||
    failure.runtimeHints ||
    failure.runtimeBudget ||
    failure.loaderDiagnostics,
  );
}

function formatDiagnostics(failure: RuntimeFailure) {
  return JSON.stringify(
    {
      cuda_memory_snapshot: failure.cudaMemorySnapshot ?? null,
      gpu_processes: failure.gpuProcesses ?? null,
      runtime_hints: failure.runtimeHints ?? null,
      runtime_budget: failure.runtimeBudget ?? null,
      loader_diagnostics: failure.loaderDiagnostics ?? null,
    },
    null,
    2,
  );
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function runtimeHintSummary(failure: RuntimeFailure) {
  const hints = failure.runtimeHints;
  if (!hints) return null;
  const name = stringValue(hints.modelName) ?? stringValue(hints.modelRepo);
  const repo = stringValue(hints.modelRepo);
  const resolvedArtifact = stringValue(hints.resolvedArtifact);
  const executionPath = stringValue(hints.executionPath);
  const compatibilityStatus = stringValue(hints.compatibilityStatus);
  const dtype = stringValue(hints.dtype);
  const resourceMode = stringValue(hints.resourceMode);
  const resolvedResourceMode = stringValue(hints.resolvedResourceMode);
  const quantization = stringValue(hints.quantizationMode);
  const quantizedComponents = stringArrayValue(hints.quantizedComponents);
  const device = stringValue(hints.device);
  const autoOffload = booleanValue(hints.autoOffload);
  const offloadMode = stringValue(hints.offloadMode);
  const offloadDiskPath = stringValue(hints.offloadDiskPath);
  const offload =
    autoOffload === null
      ? null
      : autoOffload
        ? offloadMode
          ? offloadMode.replace(/_/g, '-')
          : 'model-cpu'
        : 'offload disabled';
  const quantizationLabel =
    quantization && quantization !== 'none'
      ? `${quantization}${quantizedComponents.length ? `(${quantizedComponents.join(',')})` : ''}`
      : null;
  const budget =
    typeof failure.runtimeBudget?.applied_budget_bytes === 'number'
      ? formatBytes(failure.runtimeBudget.applied_budget_bytes)
      : null;
  const retryAttempt = typeof hints.resourceRetryAttempt === 'number' ? hints.resourceRetryAttempt : null;
  const bits = [
    name ? `Model: ${name}` : null,
    repo && repo !== name ? repo : null,
    resolvedArtifact && resolvedArtifact !== repo ? `artifact ${resolvedArtifact}` : null,
    executionPath,
    resourceMode
      ? `resource ${resourceMode}${resolvedResourceMode && resolvedResourceMode !== resourceMode ? `/${resolvedResourceMode}` : ''}`
      : null,
    dtype,
    quantizationLabel,
    offload,
    offloadDiskPath && offloadMode === 'group_disk' ? `disk ${offloadDiskPath}` : null,
    device,
    compatibilityStatus ? `compat ${compatibilityStatus}` : null,
    budget ? `budget ${budget}` : null,
    retryAttempt ? `retry ${retryAttempt}` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(' | ') : null;
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
        : 'text-modiff-muted';

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
