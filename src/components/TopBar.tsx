import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  Boxes,
  ChevronDown,
  CloudDownload,
  Download,
  FileJson2,
  FilePlus2,
  GalleryVerticalEnd,
  Image,
  LoaderCircle,
  Package,
  Play,
  Repeat,
  RotateCw,
  Settings,
  Square,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { enqueueSnackbar } from '../ui/snackbar';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { validateCurrentRun } from '../studio/runReadiness';
import { useRunReadinessIssues } from '../studio/useRunReadinessIssues';
import { createOrUpdateStudioGraph, syncStudioGraphValues } from '../studio/graphBridge';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { applyStudioRuntimeHints } from '../studio/runPreparation';
import { ensureStudioAutoPlanReadyForRun } from '../studio/useStudioRunActions';
import { getDownloadPercent, hasHfDownloadFailed, isHfDownloadActive } from '../studio/modelInstall';
import { buildOutputWorkflowPackage, buildWorkflowPackage } from '../studio/workflowPackage';
import { cx } from '../utils/classNames';
import type { StudioViewMode } from '../studio/types';
import { latestOutputForWorkflow } from '../stores/useStudioStore';
import { formatRequestError } from '../utils/requestJson';
import { requestExecutionStop } from '../utils/serverActions';

type ExecuteOption = {
  label: string;
  Icon: LucideIcon;
};

const executeOptions: ExecuteOption[] = [
  { label: 'Run', Icon: Play },
  { label: 'Auto', Icon: RotateCw },
  { label: 'Loop', Icon: Repeat },
];

type TopBarButtonProps = {
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  onClick?: () => void;
  title?: string;
  testId?: string;
  tone?: 'primary' | 'quiet' | 'danger' | 'active' | 'success' | 'error';
};

function TopBarButton({
  children,
  className,
  disabled,
  icon,
  onClick,
  title,
  testId,
  tone = 'quiet',
}: TopBarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-9 flex-none items-center justify-center gap-1.5 border border-transparent px-2.5 text-sm font-semibold leading-none text-white transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
        'disabled:pointer-events-none disabled:opacity-40',
        tone === 'primary' && 'bg-hf-yellow text-black hover:bg-hf-orange',
        tone === 'quiet' && 'bg-white/5 text-white hover:bg-white/10',
        tone === 'danger' && 'bg-white/5 text-hf-yellow hover:bg-white/10',
        tone === 'active' && 'bg-hf-yellow/20 text-hf-yellow ring-1 ring-hf-yellow/60',
        tone === 'success' && 'bg-white/5 text-modiff-green hover:bg-white/10',
        tone === 'error' && 'bg-white/5 text-modiff-red hover:bg-white/10',
        className,
      )}
    >
      {icon}
      {children && <span className="truncate">{children}</span>}
    </button>
  );
}

type AutoModeSwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

function AutoModeSwitch({ checked, onCheckedChange }: AutoModeSwitchProps) {
  return (
    <div className="flex h-9 items-center gap-2 px-1">
      <span className="text-xs font-bold text-modiff-text">Auto</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={checked ? 'Turn Auto off' : 'Turn Auto on'}
        title={checked ? 'Auto is on' : 'Auto is off'}
        data-testid="topbar-auto-switch"
        onClick={() => onCheckedChange(!checked)}
        className={cx(
          'relative h-6 w-11 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
          checked ? 'border-hf-yellow bg-hf-yellow' : 'border-modiff-border bg-modiff-panel hover:border-hf-yellow/70',
        )}
      >
        <span
          className={cx(
            'absolute top-1/2 size-4 -translate-y-1/2 rounded-full transition-transform',
            checked ? 'left-6 bg-black' : 'left-1 bg-modiff-muted',
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function ProgressBadge({ progress, taskCount }: { progress: number; taskCount: number }) {
  const clampedProgress = Math.max(0, Math.min(progress, 100));
  const label = taskCount < 100 ? taskCount || '0' : '99+';

  return (
    <div
      className="relative grid h-10 w-10 flex-none place-items-center text-xs font-bold text-modiff-muted"
      title="Queue progress"
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-10 w-10 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" pathLength="100" className="stroke-white/10" />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="3"
          pathLength="100"
          strokeDasharray={`${clampedProgress} 100`}
          strokeLinecap="round"
          className="stroke-modiff-green transition-[stroke-dasharray] duration-75"
        />
      </svg>
      <span className="relative">{label}</span>
    </div>
  );
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function aggregateDownloadPercent(downloads: ReturnType<typeof useNodesStore.getState>['hfDownloadProgress']) {
  const activeDownloads = Object.values(downloads).filter(isHfDownloadActive);
  if (activeDownloads.length === 0) return null;

  const knownByteDownloads = activeDownloads.filter((progress) => progress.total_bytes && progress.total_bytes > 0);
  if (knownByteDownloads.length > 0) {
    const downloaded = knownByteDownloads.reduce(
      (sum, progress) => sum + Math.min(progress.downloaded_bytes ?? 0, progress.total_bytes ?? 0),
      0,
    );
    const total = knownByteDownloads.reduce((sum, progress) => sum + (progress.total_bytes ?? 0), 0);
    return total > 0 ? Math.max(0, Math.min(100, Math.round((downloaded / total) * 100))) : null;
  }

  const percents = activeDownloads
    .map(getDownloadPercent)
    .filter((value): value is number => typeof value === 'number');
  if (percents.length === 0) return null;
  return Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length);
}

function TopBar() {
  const executeMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [executeMenuOpen, setExecuteMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const {
    executeButtonIndex,
    runningState,
    studioViewMode,
    setExecuteButtonIndex,
    setGalleryLibraryOpen,
    setModelManagerOpener,
    setTemplateBrowserOpen,
    setRunningState,
    setSettingsOpener,
    setStudioViewMode,
  } = useSettingsStore();
  const { sid, isConnected, connect, disconnect } = useWebsocketStore();
  const { currentTask, taskCount } = useTaskStore();
  const hfDownloadProgress = useNodesStore((state) => state.hfDownloadProgress);

  const { setViewport } = useReactFlow();
  const clearWorkflow = useFlowStore((state) => state.clearWorkflow);
  const exportGraph = useFlowStore((state) => state.exportGraph);
  const resetStudioWorkflowSession = useStudioStore((state) => state.resetWorkflowSession);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const studioForm = useStudioStore((state) => state.form);
  const studioOutputs = useStudioStore((state) => state.outputs);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const formResourceMode = studioForm.resourceMode;
  const updateStudioForm = useStudioStore((state) => state.updateForm);
  const createWorkflowTab = useStudioStore((state) => state.createWorkflowTab);
  const autoResourceCheck = useStudioStore((state) => state.autoResourceCheck);

  const selectedExecuteOption = executeOptions[executeButtonIndex] ?? executeOptions[0]!;
  const ExecuteIcon = selectedExecuteOption.Icon;
  const isRepeating = runningState === 'auto_queue' || runningState === 'loop';
  const autoResourceCheckActive = autoResourceCheck.status !== 'idle';
  const stopDisabled =
    !isConnected ||
    (!autoResourceCheckActive &&
      ((runningState === 'one_shot' && !taskCount) || (executeButtonIndex === 1 && runningState !== 'auto_queue')));
  const activeDownloadCount = Object.values(hfDownloadProgress).filter(isHfDownloadActive).length;
  const failedDownloadCount = Object.values(hfDownloadProgress).filter(hasHfDownloadFailed).length;
  const downloadPercent = aggregateDownloadPercent(hfDownloadProgress);
  const runReadiness = useRunReadinessIssues({ sid, isConnected, includeStudio: Boolean(graphBinding) });
  const blockingRunIssue = runReadiness.blockingIssues[0] ?? null;
  const runDisabled = autoResourceCheckActive || !runReadiness.canRun;
  const latestWorkflowOutput = useMemo(
    () => latestOutputForWorkflow(studioOutputs, activeWorkflowTabId, { includeUnscopedFallback: false }),
    [activeWorkflowTabId, studioOutputs],
  );

  const handleExecuteOptionClick = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, executeOptions.length - 1));
    setExecuteButtonIndex(nextIndex);
    setRunningState('one_shot');
    setExecuteMenuOpen(false);
  };

  const handleConnect = () => {
    if (isConnected) return;
    disconnect();
    connect();
  };

  const handleShowDownloads = () => {
    window.dispatchEvent(new CustomEvent('modiff:show-downloads'));
  };

  const handleNewClick = useCallback(() => {
    createWorkflowTab();
    clearWorkflow();
    resetStudioWorkflowSession();
    setViewport({ x: 0, y: 0, zoom: 1 });
  }, [clearWorkflow, createWorkflowTab, resetStudioWorkflowSession, setViewport]);

  const buildTopBarWorkflowPackage = useCallback(
    () =>
      buildWorkflowPackage({
        form: useStudioStore.getState().form,
        graph: useFlowStore.getState().toObject(),
        apiGraph: sid ? (graphBinding ? applyStudioRuntimeHints(exportGraph(sid)) : exportGraph(sid)) : null,
        latestOutput: latestWorkflowOutput,
        packageType: 'modiff-workflow-share',
      }),
    [exportGraph, graphBinding, latestWorkflowOutput, sid],
  );

  const handleWorkflowPackageExportClick = useCallback(() => {
    downloadJson('modiff-workflow-package.json', buildTopBarWorkflowPackage());
    setExportMenuOpen(false);
  }, [buildTopBarWorkflowPackage]);

  const handleLatestOutputPackageExportClick = useCallback(() => {
    if (!latestWorkflowOutput) return;
    downloadJson(
      `modiff-${latestWorkflowOutput.modelType}-${latestWorkflowOutput.id}-workflow.json`,
      buildOutputWorkflowPackage(latestWorkflowOutput),
    );
    setExportMenuOpen(false);
  }, [latestWorkflowOutput]);

  const handleOpenGalleryClick = useCallback(() => {
    setGalleryLibraryOpen(true);
    setExportMenuOpen(false);
  }, [setGalleryLibraryOpen]);

  const handleRawWorkflowExportClick = useCallback(() => {
    downloadJson('modiff-workflow-graph.json', useFlowStore.getState().toObject());
    setExportMenuOpen(false);
  }, []);

  const handleApiExportClick = () => {
    if (!sid) {
      enqueueSnackbar('Connect to the MoDiff server before exporting the API graph.', {
        variant: 'error',
        autoHideDuration: 3000,
      });
      return;
    }

    const apiGraph = graphBinding ? applyStudioRuntimeHints(exportGraph(sid)) : exportGraph(sid);
    downloadJson('modiff-api-graph.json', apiGraph);
    setExportMenuOpen(false);
  };

  const handleStudioViewModeChange = (mode: StudioViewMode) => {
    setStudioViewMode(mode);
    const nextForm = { ...useStudioStore.getState().form, resourceMode: mode };
    updateStudioForm({ resourceMode: mode });
    syncStudioGraphValues(nextForm);
    if (useStudioStore.getState().graphBinding) {
      void createOrUpdateStudioGraph(nextForm).catch((error) => {
        useStudioStore.getState().setLastError(String(error));
      });
    }
  };

  const handleAutoSwitchChange = (checked: boolean) => {
    handleStudioViewModeChange(checked ? 'auto' : 'expert');
  };

  const handleExecuteClick = async () => {
    if (!sid || !isConnected) {
      validateCurrentRun({ sid, isConnected, includeStudio: Boolean(graphBinding) });
      return;
    }

    const validation = validateCurrentRun({ sid, isConnected, includeStudio: Boolean(graphBinding) });
    if (!validation.canRun) return;

    if (graphBinding) {
      const autoReady = await ensureStudioAutoPlanReadyForRun();
      if (!autoReady) return;
    }

    if (executeButtonIndex === 0) {
      setRunningState('one_shot');
    } else if (executeButtonIndex === 1) {
      setRunningState('auto_queue');
    } else if (executeButtonIndex === 2) {
      setRunningState('loop');
    }

    await coordinateGraphRun({
      sid,
      studioContext: graphBinding ? {} : undefined,
    });
  };

  const handleStopClick = async () => {
    setRunningState('one_shot');

    try {
      const data = await requestExecutionStop();
      const message = typeof data.message === 'string' ? data.message : 'Stop requested';
      enqueueSnackbar(message, { variant: 'success', autoHideDuration: message.length * 80 });
    } catch (error) {
      const message = formatRequestError(error, 'Error stopping the execution.');
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: message.length * 80 });
      console.error(message);
    }
  };

  useEffect(() => {
    if (executeButtonIndex < 0 || executeButtonIndex >= executeOptions.length) {
      setExecuteButtonIndex(0);
    }
  }, [executeButtonIndex, setExecuteButtonIndex]);

  useEffect(() => {
    if (!executeMenuOpen) return;

    const closeOnOutsideInteraction = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && executeMenuRef.current?.contains(target)) return;
      setExecuteMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExecuteMenuOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [executeMenuOpen]);

  useEffect(() => {
    if (formResourceMode !== studioViewMode) {
      setStudioViewMode(formResourceMode);
    }
  }, [formResourceMode, setStudioViewMode, studioViewMode]);

  useEffect(() => {
    if (!exportMenuOpen) return;

    const closeOnOutsideInteraction = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && exportMenuRef.current?.contains(target)) return;
      setExportMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportMenuOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsideInteraction);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideInteraction);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [exportMenuOpen]);

  return (
    <div className="flex h-full w-full items-center justify-between gap-3 overflow-x-auto overflow-y-hidden px-4 py-2 text-white">
      <div className="flex flex-none items-center gap-2">
        <img src="/assets/modiff-icon-128.png" alt="MoDiff" className="h-9 w-9 flex-none object-contain" />
        <div className="mr-2 text-lg font-bold leading-none tracking-normal">MoDiff</div>

        <TopBarButton icon={<FilePlus2 size={16} />} onClick={handleNewClick}>
          New
        </TopBarButton>
        <div ref={exportMenuRef} className="relative">
          <TopBarButton
            icon={<Download size={16} />}
            onClick={() => setExportMenuOpen((open) => !open)}
            title="Export"
            testId="topbar-export"
          >
            Export
          </TopBarButton>
          {exportMenuOpen && (
            <div
              className="absolute left-0 top-full z-50 mt-1 min-w-52 border border-modiff-border bg-modiff-surface p-1 text-sm text-white shadow-modiff-panel"
              data-testid="topbar-export-menu"
            >
              <button
                type="button"
                onClick={handleWorkflowPackageExportClick}
                data-testid="topbar-export-workflow-package"
                className="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
              >
                <Package size={16} />
                Workflow package
              </button>
              <button
                type="button"
                disabled={!latestWorkflowOutput}
                onClick={handleLatestOutputPackageExportClick}
                data-testid="topbar-export-latest-output"
                title={
                  latestWorkflowOutput
                    ? 'Export the latest active workflow output package'
                    : 'No active workflow output yet'
                }
                className="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40 focus-visible:bg-white/10 focus-visible:outline-none"
              >
                <Image size={16} />
                Latest output package
              </button>
              <button
                type="button"
                onClick={handleOpenGalleryClick}
                data-testid="topbar-export-open-gallery"
                className="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
              >
                <GalleryVerticalEnd size={16} />
                Open Gallery
              </button>
              {studioViewMode === 'expert' && (
                <>
                  <div className="my-1 border-t border-modiff-border" />
                  <button
                    type="button"
                    onClick={handleRawWorkflowExportClick}
                    data-testid="topbar-export-raw-workflow"
                    className="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                  >
                    <FileJson2 size={16} />
                    Workflow JSON
                  </button>
                  <button
                    type="button"
                    disabled={!sid}
                    onClick={handleApiExportClick}
                    data-testid="topbar-export-api-graph"
                    title="Executable backend API graph JSON"
                    className="flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40 focus-visible:bg-white/10 focus-visible:outline-none"
                  >
                    <FileJson2 size={16} />
                    API graph JSON
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-none items-center gap-2">
        <AutoModeSwitch checked={studioViewMode === 'auto'} onCheckedChange={handleAutoSwitchChange} />
        <div className="flex items-center">
          <TopBarButton
            disabled={runDisabled}
            icon={
              isRepeating || autoResourceCheckActive ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <ExecuteIcon size={16} />
              )
            }
            onClick={() => {
              void handleExecuteClick();
            }}
            tone="primary"
            title={blockingRunIssue?.message ?? (isConnected ? 'Run current graph' : 'Backend is not connected')}
            testId="studio-run"
            className="rounded-r-none border-r-black/10"
          >
            {autoResourceCheckActive ? 'Checking Auto' : selectedExecuteOption.label}
          </TopBarButton>
          <div ref={executeMenuRef} className="relative">
            <button
              type="button"
              disabled={!isConnected}
              onClick={() => setExecuteMenuOpen((open) => !open)}
              className="inline-flex h-9 w-8 items-center justify-center bg-hf-yellow text-black transition-colors hover:bg-hf-orange disabled:pointer-events-none disabled:opacity-40"
              title="Run mode"
              aria-label="Run mode"
              aria-expanded={executeMenuOpen}
            >
              <ChevronDown size={16} />
            </button>
            {executeMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-36 border border-modiff-border bg-modiff-surface p-1 text-sm text-white shadow-modiff-panel">
                {executeOptions.map((option, index) => {
                  const Icon = option.Icon;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => handleExecuteOptionClick(index)}
                      className={cx(
                        'flex w-full items-center gap-2 px-2 py-2 text-left transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none',
                        executeButtonIndex === index && 'text-hf-yellow',
                      )}
                    >
                      <Icon size={16} />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <TopBarButton
          disabled={stopDisabled}
          icon={<Square size={16} />}
          onClick={() => {
            void handleStopClick();
          }}
          title="Stop"
          tone="danger"
        />
        <ProgressBadge progress={currentTask?.progress ?? 0} taskCount={taskCount} />
      </div>

      <div className="flex flex-none items-center gap-2">
        {(activeDownloadCount > 0 || failedDownloadCount > 0) && (
          <TopBarButton
            icon={
              activeDownloadCount > 0 ? (
                <LoaderCircle size={17} className="animate-spin" />
              ) : (
                <CloudDownload size={17} />
              )
            }
            onClick={handleShowDownloads}
            title="Model downloads"
            testId="topbar-download-activity"
            tone={failedDownloadCount > 0 ? 'error' : 'active'}
          >
            {activeDownloadCount > 0
              ? `${activeDownloadCount} ${downloadPercent !== null ? `${downloadPercent}%` : 'downloading'}`
              : `${failedDownloadCount} failed`}
          </TopBarButton>
        )}
        <TopBarButton
          icon={<Boxes size={17} />}
          onClick={() => setModelManagerOpener({ nodeId: null, fieldKey: null })}
          testId="topbar-models"
          title="Models"
        />
        <TopBarButton
          icon={<GalleryVerticalEnd size={17} />}
          onClick={() => setTemplateBrowserOpen(true)}
          title="Templates"
          testId="topbar-templates"
        />
        <TopBarButton icon={<Settings size={17} />} onClick={() => setSettingsOpener(true)} title="Settings" />
        <TopBarButton
          icon={<Image size={17} />}
          onClick={() => setGalleryLibraryOpen(true)}
          testId="topbar-gallery"
          title="Gallery"
          tone="quiet"
        />
        <TopBarButton
          icon={isConnected ? <Wifi size={17} /> : <WifiOff size={17} />}
          onClick={handleConnect}
          title={isConnected ? 'Connected' : 'Disconnected'}
          tone={isConnected ? 'success' : 'error'}
        />
      </div>
    </div>
  );
}

export default TopBar;
