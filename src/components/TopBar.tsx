// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { createDurableNodesSelector } from '../stores/flowDurableReferences';
import {
  Boxes,
  ChevronDown,
  CloudDownload,
  Download,
  FileJson2,
  FilePlus2,
  GalleryVerticalEnd,
  Image,
  Info,
  ListPlus,
  LoaderCircle,
  Package,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Repeat,
  RotateCw,
  Save,
  SaveAll,
  Settings,
  Square,
  WandSparkles,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { enqueueSnackbar } from '../ui/snackbar';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
  latestOutputForWorkflow,
  useStudioStore,
} from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { validateCurrentRun } from '../studio/runReadiness';
import { useRunReadinessIssues } from '../studio/useRunReadinessIssues';
import {
  createOrUpdateStudioGraph,
  ensureStudioGraphReadyForRun,
  getStudioGraphShapeKey,
  inspectStudioGraphBindingDivergence,
  syncStudioGraphValues,
} from '../studio/graphBridge';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { prepareHuggingFaceClustersForRun } from '../studio/huggingFaceClusterPreparation';
import { applyStudioRuntimeHints } from '../studio/runPreparation';
import { ensureStudioAutoPlanReadyForRun } from '../studio/useStudioRunActions';
import { getDownloadPercent, hasHfDownloadFailed, isHfDownloadActive } from '../studio/modelInstall';
import { buildOutputWorkflowPackage, buildWorkflowPackage } from '../studio/workflowPackage';
import { cx } from '../utils/classNames';
import type { StudioResourceMode } from '../studio/types';
import { formatRequestError } from '../utils/requestJson';
import { requestExecutionStop } from '../utils/serverActions';
import { useGraphFixModule } from '../studio/useGraphFixModule';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useGraphFixStore } from '../stores/useGraphFixStore';
import {
  ModiffButton,
  ModiffIconButton,
  ModiffMenuAction,
  ModiffMenuRoot,
  ModiffMenuSeparator,
  ModiffMenuSurface,
  ModiffMenuTrigger,
  ModiffSwitch,
  ModiffSelect,
} from '../ui';
import RuntimeResourceMonitor from './RuntimeResourceMonitor';
import type { WorkflowSaveDestination } from './WorkflowSaveDialog';

const ServiceExportDialog = lazy(() => import('./ServiceExportDialog'));
const WorkflowSaveDialog = lazy(() => import('./WorkflowSaveDialog'));
import { saveWorkflowNow } from '../studio/useWorkflowBackendSync';
import { saveWorkflowSnapshotFile } from '../studio/workflowFileSave';
import { resolveTopBarAutoPolicyV2 } from '../studio/topBarAutoPolicyV2';

type ExecuteOption = {
  id: 'run' | 'auto' | 'loop';
  label: string;
  Icon: LucideIcon;
};

const executeOptions: ExecuteOption[] = [
  { id: 'run', label: 'Run', Icon: Play },
  { id: 'auto', label: 'Auto', Icon: RotateCw },
  { id: 'loop', label: 'Loop', Icon: Repeat },
];

type TopBarButtonProps = {
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  loading?: boolean;
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
  loading,
  onClick,
  title,
  testId,
  tone = 'quiet',
}: TopBarButtonProps) {
  return (
    <ModiffButton
      title={title}
      aria-label={title}
      data-testid={testId}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
      icon={icon}
      size="normal"
      tone={tone === 'primary' ? 'primary' : 'ghost'}
      className={cx(
        'flex-none rounded-none border border-transparent px-2.5',
        tone === 'quiet' && 'bg-modiff-panel/60 text-modiff-text hover:bg-modiff-surface-hover',
        tone === 'danger' && 'bg-modiff-panel/60 text-hf-yellow hover:bg-modiff-surface-hover',
        tone === 'active' && 'bg-hf-yellow/20 text-hf-yellow ring-1 ring-hf-yellow/60',
        tone === 'success' && 'bg-modiff-panel/60 text-modiff-green hover:bg-modiff-surface-hover',
        tone === 'error' && 'bg-modiff-panel/60 text-modiff-invalid hover:bg-modiff-surface-hover',
        className,
      )}
    >
      {children && <span className="truncate">{children}</span>}
    </ModiffButton>
  );
}

function ProgressBadge({ progress, taskCount }: { progress: number; taskCount: number }) {
  const clampedProgress = Math.max(0, Math.min(progress, 100));
  const label = taskCount < 100 ? taskCount || '0' : '99+';

  return (
    <div
      className="relative grid h-10 w-10 flex-none place-items-center text-xs font-bold text-modiff-subtle-text"
      title="Queue progress"
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-10 w-10 -rotate-90" aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="3"
          pathLength="100"
          className="stroke-modiff-border-subtle"
        />
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

const selectPolicyNodes = createDurableNodesSelector();

function TopBar() {
  const {
    isRightPanelOpen,
    setRightPanelOpen,
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
  const { currentTask, taskCount, fetchSupervisorTasks } = useTaskStore();
  const hfDownloadProgress = useNodesStore((state) => state.hfDownloadProgress);
  const nodesRegistry = useNodesStore((state) => state.nodesRegistry);

  const { setViewport } = useReactFlow();
  const clearWorkflow = useFlowStore((state) => state.clearWorkflow);
  const graphFixNodes = useFlowStore((state) => selectPolicyNodes(state.nodes));
  const modularBlockDefinitions = useHuggingFaceNodeLibraryStore((state) => state.library?.blockDefinitions);
  const graphFixEdges = useFlowStore((state) => state.edges);
  const exportGraph = useFlowStore((state) => state.exportGraph);
  const resetStudioWorkflowSession = useStudioStore((state) => state.resetWorkflowSession);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const graphFinalization = useStudioStore((state) => state.graphFinalization);
  const canvasTransition = useStudioStore((state) => state.canvasTransition);
  const workflowCanvasHydrated = useStudioStore((state) => state.workflowCanvasHydrated);
  const detachManagedGraph = useStudioStore((state) => state.detachManagedGraph);
  const studioForm = useStudioStore((state) => state.form);
  const studioOutputs = useStudioStore((state) => state.outputs);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const formResourceMode = studioForm.resourceMode;
  const updateStudioForm = useStudioStore((state) => state.updateForm);
  const createWorkflowTab = useStudioStore((state) => state.createWorkflowTab);
  const renameWorkflowTab = useStudioStore((state) => state.renameWorkflowTab);
  const saveActiveWorkflowTab = useStudioStore((state) => state.saveActiveWorkflowTab);
  const workflowTabs = useStudioStore((state) => state.workflowTabs);
  const autoResourceCheck = useStudioStore((state) => state.autoResourceCheck);
  const openGraphFixDialog = useGraphFixStore((state) => state.openDialog);
  const runSubmissionRef = useRef(false);
  const [isSubmittingRun, setIsSubmittingRun] = useState(false);
  const queueIsBusy = taskCount > 0;
  const visibleExecuteOptions = queueIsBusy
    ? executeOptions.map((option) => (option.id === 'run' ? { ...option, label: 'Queue', Icon: ListPlus } : option))
    : executeOptions;
  const selectedExecuteOption = visibleExecuteOptions[executeButtonIndex] ?? visibleExecuteOptions[0]!;
  const ExecuteIcon = selectedExecuteOption.Icon;
  const isRepeating = runningState === 'auto_queue' || runningState === 'loop';
  const autoResourceCheckActive = autoResourceCheck.status !== 'idle';
  const stopDisabled =
    isConnected &&
    !autoResourceCheckActive &&
    ((runningState === 'one_shot' && !taskCount) || (executeButtonIndex === 1 && runningState !== 'auto_queue'));
  const activeDownloadCount = Object.values(hfDownloadProgress).filter(isHfDownloadActive).length;
  const failedDownloadCount = Object.values(hfDownloadProgress).filter(hasHfDownloadFailed).length;
  const downloadPercent = aggregateDownloadPercent(hfDownloadProgress);
  const runReadiness = useRunReadinessIssues({
    sid,
    isConnected,
    includeStudio: Boolean(graphBinding || graphFinalization),
  });
  const graphFix = useGraphFixModule(graphFixNodes.length > 0 || runReadiness.issues.length > 0);
  const graphFixPlan = useMemo(
    () =>
      graphFix.module?.buildGraphFixPlan({
        nodes: graphFixNodes,
        edges: graphFixEdges,
        registry: nodesRegistry,
        modularBlockDefinitions,
        readinessIssues: runReadiness.issues,
      }) ?? { issues: [], candidateCount: 0, canFix: false },
    [graphFix.module, graphFixEdges, graphFixNodes, nodesRegistry, runReadiness.issues, modularBlockDefinitions],
  );
  const blockingRunIssue = runReadiness.blockingIssues[0] ?? null;
  // Auto planning happens during startup/template preparation and whenever a
  // resource-relevant form key changes. Do not turn Run into a second planner
  // button: it is enabled only after the plan is ready and then submits in the
  // same click.
  const runDisabled = isSubmittingRun || autoResourceCheckActive || !runReadiness.canRun;
  const graphBindingDivergence =
    workflowCanvasHydrated &&
    graphBinding &&
    graphFinalization?.status !== 'pending' &&
    canvasTransition?.type !== 'template_graph_building'
      ? inspectStudioGraphBindingDivergence(graphBinding)
      : null;
  const topBarAutoPolicy = useMemo(
    () =>
      resolveTopBarAutoPolicyV2({
        workflowCanvasHydrated,
        graphBindingPresent: Boolean(graphBinding),
        graphBindingDiverged: Boolean(graphBindingDivergence),
        templateGraphBuilding: canvasTransition?.type === 'template_graph_building',
        nodes: graphFixNodes,
        edges: graphFixEdges,
      }),
    [canvasTransition, graphBinding, graphBindingDivergence, graphFixEdges, graphFixNodes, workflowCanvasHydrated],
  );
  const customGraphAutoUnavailable = topBarAutoPolicy.autoUnavailable;
  const customGraphAutoUnavailableReason = graphBindingDivergence
    ? 'This managed graph changed. Review its resource requirements before using automatic planning.'
    : topBarAutoPolicy.registeredBlockEligibility.reason;
  const latestWorkflowOutput = useMemo(
    () => latestOutputForWorkflow(studioOutputs, activeWorkflowTabId, { includeUnscopedFallback: false }),
    [activeWorkflowTabId, studioOutputs],
  );
  const activeWorkflowTab = useMemo(
    () => workflowTabs.find((tab) => tab.id === activeWorkflowTabId) ?? null,
    [activeWorkflowTabId, workflowTabs],
  );
  const [serviceExportOpen, setServiceExportOpen] = useState(false);
  const [saveDialog, setSaveDialog] = useState<{
    destination: WorkflowSaveDestination;
    renameCurrent: boolean;
  } | null>(null);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  const handleExecuteOptionClick = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, executeOptions.length - 1));
    setExecuteButtonIndex(nextIndex);
    setRunningState('one_shot');
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

  const captureActiveWorkflow = useCallback(() => {
    saveActiveWorkflowTab(true);
    const state = useStudioStore.getState();
    return state.workflowTabs.find((tab) => tab.id === state.activeWorkflowTabId) ?? null;
  }, [saveActiveWorkflowTab]);

  const persistCurrentWorkflow = useCallback(async () => {
    const tab = captureActiveWorkflow();
    if (!tab) return;
    const unnamed = tab.source === 'new' && /^Workflow \d+$/.test(tab.title);
    if (unnamed) {
      setSaveDialog({ destination: 'library', renameCurrent: true });
      return;
    }
    setSavingWorkflow(true);
    try {
      await saveWorkflowNow(tab);
      enqueueSnackbar(`Saved ${tab.title} to My workflows`, { variant: 'success', autoHideDuration: 2600 });
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, `Could not save ${tab.title}.`), {
        variant: 'error',
        autoHideDuration: 6000,
      });
    } finally {
      setSavingWorkflow(false);
    }
  }, [captureActiveWorkflow]);

  const openSaveAs = useCallback((destination: WorkflowSaveDestination) => {
    setSaveDialog({ destination, renameCurrent: false });
  }, []);

  const handleSaveAs = useCallback(
    async (name: string, destination: WorkflowSaveDestination) => {
      const sourceTab = captureActiveWorkflow();
      if (!sourceTab) return;
      setSavingWorkflow(true);
      try {
        if (destination === 'file') {
          const result = await saveWorkflowSnapshotFile(name, sourceTab.snapshot);
          if (result === 'cancelled') return;
          enqueueSnackbar(result === 'saved' ? `Saved ${name}.json` : `Downloaded ${name}.json`, {
            variant: 'success',
            autoHideDuration: 2600,
          });
          setSaveDialog(null);
          return;
        }

        let targetId = sourceTab.id;
        if (saveDialog?.renameCurrent) {
          renameWorkflowTab(sourceTab.id, name);
          saveActiveWorkflowTab(true);
        } else {
          targetId = createWorkflowTab(name, sourceTab.snapshot, 'manual', sourceTab.sourceLabel);
        }
        const target = useStudioStore.getState().workflowTabs.find((tab) => tab.id === targetId);
        if (!target) throw new Error('The workflow copy could not be created.');
        await saveWorkflowNow(target);
        enqueueSnackbar(`Saved ${name} to My workflows`, { variant: 'success', autoHideDuration: 2600 });
        setSaveDialog(null);
      } catch (error) {
        enqueueSnackbar(formatRequestError(error, `Could not save ${name}.`), {
          variant: 'error',
          autoHideDuration: 6000,
        });
      } finally {
        setSavingWorkflow(false);
      }
    },
    [captureActiveWorkflow, createWorkflowTab, renameWorkflowTab, saveActiveWorkflowTab, saveDialog?.renameCurrent],
  );

  const buildTopBarWorkflowPackage = useCallback(async () => {
    const context = captureWorkflowOperationContext();
    const flow = useFlowStore.getState();
    let apiGraph = sid ? exportGraph(sid, undefined, { randomizeSeeds: false }) : null;
    if (apiGraph && graphBinding) apiGraph = applyStudioRuntimeHints(apiGraph);
    if (
      apiGraph &&
      flow.nodes.some((node) =>
        node.data.blockInstanceV2?.effectiveGraph.nodes.some(
          (child) => child.modularDiffusers?.kind === 'upstream_block',
        ),
      )
    ) {
      const lower = await (await import('../studio/modularComposition')).prepareModularCompositionExecutionV2(flow);
      apiGraph = lower(apiGraph);
      assertWorkflowOperationContext(context);
    }
    return {
      ...buildWorkflowPackage({
        form: useStudioStore.getState().form,
        graph: flow.toObject(),
        apiGraph,
        latestOutput: latestWorkflowOutput,
        packageType: 'modiff-workflow-share',
      }),
      apiGraph,
    };
  }, [exportGraph, graphBinding, latestWorkflowOutput, sid]);

  const handleWorkflowPackageExportClick = useCallback(async () => {
    try {
      downloadJson('modiff-workflow-package.json', await buildTopBarWorkflowPackage());
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Could not export this workflow.'), { variant: 'error' });
    }
  }, [buildTopBarWorkflowPackage]);

  const handleLatestOutputPackageExportClick = useCallback(() => {
    if (!latestWorkflowOutput) return;
    downloadJson(
      `modiff-${latestWorkflowOutput.modelType}-${latestWorkflowOutput.id}-workflow.json`,
      buildOutputWorkflowPackage(latestWorkflowOutput),
    );
  }, [latestWorkflowOutput]);

  const handleOpenGalleryClick = useCallback(() => {
    setGalleryLibraryOpen(true);
  }, [setGalleryLibraryOpen]);

  const handleRawWorkflowExportClick = useCallback(() => {
    downloadJson('modiff-workflow-graph.json', useFlowStore.getState().toObject());
  }, []);

  const handleApiExportClick = async () => {
    if (!sid) {
      enqueueSnackbar('Connect to the MoDiff server before exporting the API graph.', {
        variant: 'error',
        autoHideDuration: 3000,
      });
      return;
    }

    try {
      downloadJson('modiff-api-graph.json', (await buildTopBarWorkflowPackage()).apiGraph);
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, 'Could not export this API graph.'), { variant: 'error' });
    }
  };

  const handleResourceModeChange = (mode: StudioResourceMode) => {
    if (mode === formResourceMode || (mode === 'auto' && customGraphAutoUnavailable)) return;
    const previousShapeKey = getStudioGraphShapeKey(useStudioStore.getState().form);
    updateStudioForm({ resourceMode: mode });
    const nextForm = useStudioStore.getState().form;
    syncStudioGraphValues(nextForm);
    if (
      graphBinding &&
      (previousShapeKey !== getStudioGraphShapeKey(nextForm) ||
        useStudioStore.getState().graphFinalization?.status === 'pending')
    ) {
      const context = captureWorkflowOperationContext();
      void createOrUpdateStudioGraph(nextForm, context).catch((error) => {
        if (isWorkflowOperationCancelled(error)) return;
        const message = String(error);
        useStudioStore.getState().setLastError(message);
        enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
      });
    }
  };

  const handleExecuteClick = async () => {
    if (!sid || !isConnected) {
      validateCurrentRun({ sid, isConnected, includeStudio: Boolean(graphBinding) });
      return;
    }
    if (runSubmissionRef.current) return;

    const requestedOption = selectedExecuteOption;
    const deferCanvasOwnership = queueIsBusy;
    runSubmissionRef.current = true;
    setIsSubmittingRun(true);
    const context = captureWorkflowOperationContext();
    try {
      if (graphBinding) {
        const autoReady = await ensureStudioAutoPlanReadyForRun(context);
        if (!autoReady) {
          validateCurrentRun({ sid, isConnected, includeStudio: true });
          return;
        }
        await ensureStudioGraphReadyForRun(useStudioStore.getState().form, context);
      }
      await prepareHuggingFaceClustersForRun();
      const validation = validateCurrentRun({ sid, isConnected, includeStudio: Boolean(graphBinding) });
      if (!validation.canRun) return;

      if (requestedOption.id === 'run') {
        setRunningState('one_shot');
      } else if (requestedOption.id === 'auto') {
        setRunningState('auto_queue');
      } else if (requestedOption.id === 'loop') {
        setRunningState('loop');
      }

      const result = await coordinateGraphRun({
        sid,
        studioContext: graphBinding ? { clearChangedPreviews: !deferCanvasOwnership } : undefined,
        workflowContext: context,
        deferCanvasOwnership,
      });
      if (requestedOption.id === 'run' && deferCanvasOwnership && !result.response.error) {
        enqueueSnackbar('Run added to the queue. The current run will continue.', {
          variant: 'success',
          autoHideDuration: 3200,
        });
      }
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      runSubmissionRef.current = false;
      setIsSubmittingRun(false);
    }
  };

  const handleStopClick = async () => {
    setRunningState('one_shot');

    try {
      const data = await requestExecutionStop();
      // The process-external supervisor has already persisted the terminal
      // queue snapshot before it responds. Read it immediately so stopped
      // nodes and notifications settle without waiting for websocket recovery.
      await fetchSupervisorTasks();
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
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (event.shiftKey) {
        openSaveAs('library');
      } else {
        void persistCurrentWorkflow();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut, { capture: true });
    return () => window.removeEventListener('keydown', handleSaveShortcut, { capture: true });
  }, [openSaveAs, persistCurrentWorkflow]);

  useEffect(() => {
    if (graphBindingDivergence) detachManagedGraph();
  }, [detachManagedGraph, graphBindingDivergence]);

  return (
    <div className="flex h-full w-full items-center justify-between gap-3 overflow-x-auto overflow-y-hidden px-4 py-2 text-modiff-text">
      <div className="flex flex-none items-center gap-2">
        <img src="/assets/modiff-icon-128.png" alt="MoDiff" className="h-9 w-9 flex-none object-contain" />
        <div className="mr-2 text-lg font-bold leading-none tracking-normal">MoDiff</div>

        <TopBarButton icon={<FilePlus2 size={16} />} onClick={handleNewClick} testId="topbar-new-workflow">
          New
        </TopBarButton>
        <div className="flex items-center">
          <TopBarButton
            disabled={!activeWorkflowTab || savingWorkflow}
            icon={<Save size={16} />}
            loading={savingWorkflow}
            onClick={() => {
              void persistCurrentWorkflow();
            }}
            title={
              activeWorkflowTab ? `Save ${activeWorkflowTab.title} to My workflows (Ctrl/⌘+S)` : 'No workflow to save'
            }
            testId="topbar-save-workflow"
            className="rounded-r-none"
          >
            Save
          </TopBarButton>
          <ModiffMenuRoot>
            <ModiffMenuTrigger>
              <ModiffIconButton
                label="Workflow save options"
                disabled={!activeWorkflowTab}
                size="normal"
                tone="ghost"
                className="rounded-none border border-transparent bg-modiff-panel/60"
                data-testid="topbar-save-workflow-options"
              >
                <ChevronDown size={14} />
              </ModiffIconButton>
            </ModiffMenuTrigger>
            <ModiffMenuSurface anchor="bottom start" className="min-w-52" data-testid="topbar-save-workflow-menu">
              <ModiffMenuAction
                onClick={() => void persistCurrentWorkflow()}
                icon={<Save size={16} />}
                data-testid="topbar-save-current-workflow"
              >
                Save
                <span className="ml-auto text-modiff-label text-modiff-subtle-text">Ctrl/⌘+S</span>
              </ModiffMenuAction>
              <ModiffMenuAction
                onClick={() => openSaveAs('library')}
                icon={<SaveAll size={16} />}
                data-testid="topbar-save-workflow-as"
              >
                Save as…
                <span className="ml-auto text-modiff-label text-modiff-subtle-text">Ctrl/⌘+Shift+S</span>
              </ModiffMenuAction>
              <ModiffMenuAction
                onClick={() => openSaveAs('file')}
                icon={<FileJson2 size={16} />}
                data-testid="topbar-save-workflow-file"
              >
                Save JSON copy…
              </ModiffMenuAction>
            </ModiffMenuSurface>
          </ModiffMenuRoot>
        </div>
        <ModiffMenuRoot>
          <ModiffMenuTrigger>
            <ModiffButton
              icon={<Download size={16} />}
              size="normal"
              tone="ghost"
              className="flex-none rounded-none border border-transparent bg-modiff-panel/60 px-2.5 text-modiff-text hover:bg-modiff-surface-hover"
              data-testid="topbar-export"
            >
              Export
              <ChevronDown size={14} aria-hidden="true" />
            </ModiffButton>
          </ModiffMenuTrigger>
          <ModiffMenuSurface anchor="bottom start" className="min-w-52" data-testid="topbar-export-menu">
            <ModiffMenuAction
              onClick={handleWorkflowPackageExportClick}
              data-testid="topbar-export-workflow-package"
              icon={<Package size={16} />}
            >
              Workflow package
            </ModiffMenuAction>
            <ModiffMenuAction
              disabled={!latestWorkflowOutput}
              onClick={handleLatestOutputPackageExportClick}
              data-testid="topbar-export-latest-output"
              icon={<Image size={16} />}
              title={
                latestWorkflowOutput
                  ? 'Export the latest active workflow output package'
                  : 'No active workflow output yet'
              }
            >
              Latest output package
            </ModiffMenuAction>
            <ModiffMenuAction
              onClick={handleOpenGalleryClick}
              data-testid="topbar-export-open-gallery"
              icon={<GalleryVerticalEnd size={16} />}
            >
              Open Gallery
            </ModiffMenuAction>
            {studioViewMode === 'expert' && (
              <>
                <ModiffMenuSeparator />
                <ModiffMenuAction
                  onClick={handleRawWorkflowExportClick}
                  data-testid="topbar-export-raw-workflow"
                  icon={<FileJson2 size={16} />}
                >
                  Workflow JSON
                </ModiffMenuAction>
                <ModiffMenuAction
                  disabled={!sid}
                  onClick={handleApiExportClick}
                  data-testid="topbar-export-api-graph"
                  title="Executable backend API graph JSON"
                  icon={<FileJson2 size={16} />}
                >
                  API graph JSON
                </ModiffMenuAction>
                <ModiffMenuAction
                  disabled={!sid}
                  onClick={() => setServiceExportOpen(true)}
                  data-testid="topbar-export-service"
                  icon={<Package size={16} />}
                >
                  Service package
                </ModiffMenuAction>
              </>
            )}
          </ModiffMenuSurface>
        </ModiffMenuRoot>
      </div>

      <div className="flex flex-none items-center gap-2">
        <ModiffIconButton
          label="Workflow resources"
          title="Assess this workflow’s resources"
          data-testid="topbar-workflow-resources"
          onClick={() => {
            useSettingsStore.getState().setRightPanelTab('compatibility');
            useSettingsStore.getState().setRightPanelOpen(true);
          }}
        >
          <Info size={15} />
        </ModiffIconButton>
        <ModiffSwitch
          checked={studioViewMode === 'auto'}
          onCheckedChange={(checked) => setStudioViewMode(checked ? 'auto' : 'expert')}
          label={
            <span className="text-xs font-bold text-modiff-text">
              {studioViewMode === 'auto' ? 'Auto view' : 'Expert view'}
            </span>
          }
          className="h-9 flex-row-reverse px-1"
          aria-label={studioViewMode === 'auto' ? 'Use Expert view' : 'Use Auto view'}
          title="Change editing tools while keeping this workflow’s resource policy."
          data-testid="topbar-auto-switch"
        />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-modiff-subtle-text">Resources</span>
          <ModiffSelect
            aria-label="Workflow resource policy"
            data-testid="topbar-resource-policy"
            className="w-36"
            value={formResourceMode}
            title={customGraphAutoUnavailable ? customGraphAutoUnavailableReason : 'Resource policy for this workflow'}
            onValueChange={(value) => {
              if (value === 'auto' || value === 'expert') handleResourceModeChange(value);
            }}
            options={[
              { value: 'auto', label: 'Automatic', disabled: customGraphAutoUnavailable },
              { value: 'expert', label: 'Expert overrides' },
            ]}
          />
        </div>
        <TopBarButton
          disabled={graphFixPlan.issues.length === 0}
          icon={
            !graphFix.module && !graphFix.error && graphFixNodes.length > 0 ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              <WandSparkles size={16} />
            )
          }
          onClick={openGraphFixDialog}
          title={
            graphFix.error ??
            (!graphFix.module && graphFixNodes.length > 0
              ? 'Loading graph fixes…'
              : graphFixPlan.issues.length > 0
                ? `Fix ${graphFixPlan.issues.length} graph ${graphFixPlan.issues.length === 1 ? 'issue' : 'issues'}`
                : 'No deterministic graph fixes available')
          }
          testId="graph-fix"
          tone={graphFixPlan.issues.length > 0 ? 'active' : 'quiet'}
        >
          Fix
        </TopBarButton>
        <div className="flex items-center">
          <TopBarButton
            disabled={runDisabled}
            icon={
              isRepeating || autoResourceCheckActive || isSubmittingRun ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <ExecuteIcon size={16} />
              )
            }
            onClick={() => {
              void handleExecuteClick();
            }}
            tone="primary"
            title={
              runReadiness.isPreparing
                ? 'Preparing graph'
                : isSubmittingRun
                  ? 'Submitting graph to the queue'
                  : (blockingRunIssue?.message ??
                    (isConnected
                      ? selectedExecuteOption.id === 'run' && queueIsBusy
                        ? 'Queue current graph without interrupting active work'
                        : 'Run current graph'
                      : 'Backend is not connected'))
            }
            testId="studio-run"
            className="rounded-r-none border-r-modiff-on-accent/10"
          >
            {autoResourceCheckActive || isSubmittingRun
              ? selectedExecuteOption.id === 'run' && queueIsBusy
                ? 'Queueing...'
                : 'Starting...'
              : selectedExecuteOption.label}
          </TopBarButton>
          <ModiffMenuRoot>
            <ModiffMenuTrigger>
              <ModiffIconButton
                label="Run mode"
                disabled={!isConnected || isSubmittingRun}
                size="normal"
                tone="primary"
                className="rounded-none"
              >
                <ChevronDown size={16} />
              </ModiffIconButton>
            </ModiffMenuTrigger>
            <ModiffMenuSurface anchor="bottom end" className="min-w-36" data-testid="run-mode-menu">
              {visibleExecuteOptions.map((option, index) => {
                const Icon = option.Icon;
                return (
                  <ModiffMenuAction
                    key={option.id}
                    data-testid={`run-mode-${option.id}`}
                    selected={executeButtonIndex === index}
                    onClick={() => handleExecuteOptionClick(index)}
                    icon={<Icon size={16} />}
                  >
                    {option.label}
                  </ModiffMenuAction>
                );
              })}
            </ModiffMenuSurface>
          </ModiffMenuRoot>
        </div>

        <TopBarButton
          disabled={stopDisabled}
          icon={<Square size={16} />}
          onClick={() => {
            void handleStopClick();
          }}
          title={isConnected ? 'Stop' : 'Stop run and restart unresponsive backend'}
          tone="danger"
        />
        <ProgressBadge progress={currentTask?.progress ?? 0} taskCount={taskCount} />
      </div>

      <div className="flex flex-none items-center gap-2">
        <TopBarButton
          icon={isRightPanelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          title={isRightPanelOpen ? 'Collapse workspace' : 'Open workspace'}
          testId="topbar-toggle-workspace"
          onClick={() => setRightPanelOpen(!isRightPanelOpen)}
          tone={isRightPanelOpen ? 'active' : 'quiet'}
        />
        <RuntimeResourceMonitor active={Boolean(currentTask)} connected={isConnected} />
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

      <Suspense fallback={null}>
        {serviceExportOpen && (
          <ServiceExportDialog getGraph={buildTopBarWorkflowPackage} onClose={() => setServiceExportOpen(false)} />
        )}
        {saveDialog && (
          <WorkflowSaveDialog
            open
            initialName={activeWorkflowTab?.title ?? 'Workflow'}
            initialDestination={saveDialog.destination}
            loading={savingWorkflow}
            onClose={() => setSaveDialog(null)}
            onSave={(name, destination) => {
              void handleSaveAs(name, destination);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

export default TopBar;
