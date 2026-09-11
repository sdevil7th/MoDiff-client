// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useSettingsStore } from './stores/useSettingsStore';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useSnackbar } from './ui/snackbar';
import { AppWindow, Boxes, GalleryVerticalEnd, LayoutTemplate, Workflow as WorkflowIcon } from 'lucide-react';

import Workflow from './components/Workflow';
import TopBar from './components/TopBar';
import { useNodesStore } from './stores/useNodeStore';
import { useWebsocketStore } from './stores/useWebsocketStore.ts';
import TaskLauncher from './components/TaskLauncher.tsx';
import RunSessionShelf from './components/RunSessionShelf.tsx';
import StartupWorkspaceGate from './components/StartupWorkspaceGate.tsx';
import WorkflowTabsBar from './components/WorkflowTabsBar.tsx';
import { useFlowStore } from './stores/useFlowStore.ts';
import { useStudioStore } from './stores/useStudioStore.ts';
import { useTaskStore } from './stores/useTaskStore.ts';
import { useGraphFixStore } from './stores/useGraphFixStore.ts';
import { useRunIssueStore } from './stores/useRunIssueStore.ts';
import { modiffLayout } from './theme';
import { cx } from './utils/classNames';
import { ModiffIconButton } from './ui';
import { openRunActivity } from './studio/runActivity.ts';
import { useAutoResourcePlanSync } from './studio/useAutoResourcePlanSync.ts';
import { useWorkflowBackendSync } from './studio/useWorkflowBackendSync.ts';

const GraphFixDialog = lazy(() => import('./components/GraphFixDialog.tsx'));
const RunIssuesDialog = lazy(() => import('./components/RunIssuesDialog.tsx'));
const TemplateBrowserDialog = lazy(() => import('./components/TemplateBrowserDialog.tsx'));
const GalleryLibraryDialog = lazy(() => import('./components/GalleryLibraryDialog.tsx'));
const MediaViewerDialog = lazy(() => import('./components/MediaViewerDialog.tsx'));
const MediaExportDialog = lazy(() => import('./components/MediaExportDialog.tsx'));
const WorkspacePanel = lazy(() => import('./components/WorkspacePanel.tsx'));
const NodeList = lazy(() => import('./components/NodeList.tsx'));
const GraphList = lazy(() => import('./components/GraphList.tsx'));
const TemplateLibraryPanel = lazy(() =>
  import('./components/LeftLibraryPanels.tsx').then(({ TemplateLibraryPanel }) => ({
    default: TemplateLibraryPanel,
  })),
);
const AssetsLibraryPanel = lazy(() =>
  import('./components/LeftLibraryPanels.tsx').then(({ AssetsLibraryPanel }) => ({
    default: AssetsLibraryPanel,
  })),
);
const ModelsLibraryPanel = lazy(() =>
  import('./components/LeftLibraryPanels.tsx').then(({ ModelsLibraryPanel }) => ({
    default: ModelsLibraryPanel,
  })),
);

const TAB_BAR_WIDTH = modiffLayout.tabBarWidth;
const WORKSPACE_MIN_WIDTH = modiffLayout.workspaceMinWidth;
const SUPERVISOR_STARTUP_TIMEOUT_MS = 5_000;

async function boundedSupervisorStartup(fetchSupervisorTasks: () => Promise<void>) {
  let timeoutId: number | undefined;
  try {
    await Promise.race([
      fetchSupervisorTasks(),
      new Promise<void>((resolve) => {
        timeoutId = window.setTimeout(resolve, SUPERVISOR_STARTUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

if (import.meta.env.DEV) {
  void import('./utils/e2eHooks.ts').then(({ installE2EHooks }) => installE2EHooks());
}

function LeftRailButton({
  active,
  children,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <ModiffIconButton
      label={label}
      data-testid={testId}
      className={cx(
        'h-[50px] w-[54px] rounded-none text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-modiff-text focus-visible:outline-inset',
        active && 'bg-modiff-panel text-hf-yellow',
      )}
      onClick={onClick}
    >
      {children}
    </ModiffIconButton>
  );
}

export default function App() {
  useAutoResourcePlanSync();
  useWorkflowBackendSync();

  const {
    isLeftPanelOpen,
    isRightPanelOpen,
    leftPanelWidth,
    leftPanelTabIndex,
    rightPanelWidth,
    templateBrowserOpen,
    galleryLibraryOpen,
    mediaViewerOpener,
    mediaExportOpener,
    setLeftPanelOpen,
    setLeftPanelWidth,
    setLeftPanelTabIndex,
    setRightPanelOpen,
    setRightPanelWidth,
    setRightPanelTab,
  } = useSettingsStore();

  const { connect: websocketConnect, disconnect: websocketDisconnect } = useWebsocketStore();
  const websocketConnected = useWebsocketStore((state) => state.isConnected);
  const fetchSupervisorTasks = useTaskStore((state) => state.fetchSupervisorTasks);
  const currentTask = useTaskStore((state) => state.currentTask);
  const taskCount = useTaskStore((state) => state.taskCount);
  const graphFixDialogOpen = useGraphFixStore((state) => state.dialogOpen);
  const runIssuesDialogOpen = useRunIssueStore((state) => state.issueDialogOpen || state.failureDialogOpen);
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const launcherDismissed = useStudioStore((state) => state.launcherDismissed);
  const fetchBackendOutputs = useStudioStore((state) => state.fetchBackendOutputs);
  const workflowCanvasHydrated = useStudioStore((state) => state.workflowCanvasHydrated);
  const hydrateActiveWorkflowCanvas = useStudioStore((state) => state.hydrateActiveWorkflowCanvas);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const resourceMode = useStudioStore((state) => state.form.resourceMode);
  const autoResourcePlan = useStudioStore((state) => state.autoResourcePlan);
  const discoveryRequests = useNodesStore((state) => state.discoveryRequests);

  const { enqueueSnackbar } = useSnackbar();
  const { error: nodesStoreError, fetchRegistry } = useNodesStore();
  const activePanelRef = useRef<'left' | 'right' | null>(null);
  const initialRegistryRequestedRef = useRef(false);
  const initialOutputsRequestedRef = useRef(false);
  const initialActiveRunRestoreRequestedRef = useRef(false);
  const [registryStartupStatus, setRegistryStartupStatus] = useState<'loading' | 'settled'>('loading');
  const [outputsStartupStatus, setOutputsStartupStatus] = useState<'loading' | 'settled'>('loading');
  const [supervisorStartupStatus, setSupervisorStartupStatus] = useState<'loading' | 'settled'>('loading');
  const [startupComplete, setStartupComplete] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--modiff-left-panel-width',
      isLeftPanelOpen ? `${leftPanelWidth}px` : '0px',
    );
    document.documentElement.style.setProperty(
      '--modiff-right-panel-width',
      isRightPanelOpen ? `${rightPanelWidth}px` : '0px',
    );
  }, [isLeftPanelOpen, isRightPanelOpen, leftPanelWidth, rightPanelWidth]);

  const handlePanelResize = useCallback(
    (e: MouseEvent) => {
      if (!activePanelRef.current) return;

      if (activePanelRef.current === 'left') {
        const newWidth = e.clientX - TAB_BAR_WIDTH;
        const workspaceWidth = window.innerWidth - newWidth;

        if (workspaceWidth < WORKSPACE_MIN_WIDTH) {
          return;
        }

        setLeftPanelWidth(newWidth);
      } else if (activePanelRef.current === 'right') {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth >= WORKSPACE_MIN_WIDTH) {
          setRightPanelWidth(newWidth);
        } else {
          setRightPanelWidth(WORKSPACE_MIN_WIDTH);
        }
      }
    },
    [setLeftPanelWidth, setRightPanelWidth],
  );

  const stopResize = useCallback(() => {
    document.querySelector('.modiff-resize-handle-active')?.classList.remove('modiff-resize-handle-active');
    activePanelRef.current = null;
    document.removeEventListener('mousemove', handlePanelResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = 'default';
  }, [handlePanelResize]);

  const startResize = useCallback(
    (panel: 'left' | 'right', e: ReactMouseEvent) => {
      if (e.target instanceof HTMLElement) {
        e.target.classList.add('modiff-resize-handle-active');
      }
      activePanelRef.current = panel;
      document.addEventListener('mousemove', handlePanelResize);
      document.addEventListener('mouseup', stopResize);
      document.body.style.cursor = 'col-resize';
    },
    [handlePanelResize, stopResize],
  );

  const loadRegistry = useCallback(async () => {
    setRegistryStartupStatus('loading');
    try {
      await fetchRegistry();
      const flow = useFlowStore.getState();
      flow.replaceGraph({
        nodes: flow.nodes,
        edges: flow.edges,
        viewport: flow.viewport,
      });
    } finally {
      setRegistryStartupStatus('settled');
    }
  }, [fetchRegistry]);

  // Fetch nodes and startup model/runtime indexes from the API server.
  useEffect(() => {
    if (initialRegistryRequestedRef.current) return;
    initialRegistryRequestedRef.current = true;
    void loadRegistry();
  }, [loadRegistry]);

  const loadBackendOutputs = useCallback(async () => {
    setOutputsStartupStatus('loading');
    try {
      await fetchBackendOutputs();
    } finally {
      setOutputsStartupStatus('settled');
    }
  }, [fetchBackendOutputs]);

  useEffect(() => {
    if (initialOutputsRequestedRef.current) return;
    initialOutputsRequestedRef.current = true;
    void loadBackendOutputs();
  }, [loadBackendOutputs]);

  useEffect(() => {
    if (!workflowCanvasHydrated) {
      hydrateActiveWorkflowCanvas();
    }
  }, [hydrateActiveWorkflowCanvas, workflowCanvasHydrated]);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('share')) return;
    setRightPanelOpen(true);
    setRightPanelTab('share');
  }, [setRightPanelOpen, setRightPanelTab]);

  // The execution worker can be busy inside a native model load and unable to
  // serve websocket/HTTP requests. Read the process-external supervisor once
  // at startup and restore the running workflow snapshot before relying on the
  // normal websocket lifecycle, but only when there is no selected document to
  // restore. Queue recovery is not authority to replace a saved editing tab.
  useEffect(() => {
    if (initialActiveRunRestoreRequestedRef.current) return;
    initialActiveRunRestoreRequestedRef.current = true;
    const restoreActiveRun = async () => {
      const initialStudio = useStudioStore.getState();
      const initialTabId = initialStudio.activeWorkflowTabId;
      const initialCanvasEpoch = initialStudio.workflowCanvasEpoch;
      const initialFormEpoch = initialStudio.workflowFormEpoch;
      setSupervisorStartupStatus('loading');
      try {
        await boundedSupervisorStartup(fetchSupervisorTasks);
        const studio = useStudioStore.getState();
        const selectedTab = studio.workflowTabs.find((tab) => tab.id === studio.activeWorkflowTabId);
        if (
          studio.activeWorkflowTabId !== initialTabId ||
          studio.workflowCanvasEpoch !== initialCanvasEpoch ||
          studio.workflowFormEpoch !== initialFormEpoch ||
          (selectedTab &&
            (selectedTab.snapshot.nodes.length > 0 || selectedTab.dirty || (selectedTab.backendRevision ?? 0) > 0))
        ) {
          // Keep reporting the run in the activity shelf. Opening it is an
          // explicit action, including when the run belongs to another client.
          return;
        }
        const task = useTaskStore.getState().currentTask;
        if (
          !task?.task_id ||
          task.status === 'completed' ||
          task.status === 'failed' ||
          task.status === 'cancelled' ||
          !task.workflow_tab_id ||
          !task.workflow_snapshot
        ) {
          return;
        }
        await openRunActivity({
          taskId: task.task_id,
          clientRunId: task.client_run_id,
          workflowTabId: task.workflow_tab_id,
          nodeId: task.node_id || task.current_node,
          status: task.status ?? 'running',
          name: task.workflow_title || task.name,
        });
      } finally {
        // Do not suppress this completion during React Strict Mode's
        // development-only effect cleanup. The request is process-external and
        // intentionally shared; its result still belongs to this startup.
        setSupervisorStartupStatus('settled');
      }
    };
    void restoreActiveRun();
  }, [fetchSupervisorTasks]);

  // Connect to websocket server
  useEffect(() => {
    websocketConnect();

    return () => {
      websocketDisconnect();
    };
  }, [websocketConnect, websocketDisconnect]);

  useEffect(() => {
    // Native model loading can hold the worker event loop long enough for a
    // task_started websocket message to be delayed even though the socket
    // remains connected. Reconcile active runs through the process-external
    // supervisor until the queue is empty; this keeps the visible task state
    // truthful without navigating away from the user's current workflow.
    if (websocketConnected && taskCount === 0) return;
    let disposed = false;
    let timer: number | undefined;
    const pollSupervisor = async () => {
      await fetchSupervisorTasks();
      if (!disposed) {
        timer = window.setTimeout(
          () => {
            void pollSupervisor();
          },
          websocketConnected ? 2000 : 1000,
        );
      }
    };
    void pollSupervisor();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [fetchSupervisorTasks, taskCount, websocketConnected]);

  const criticalDiscoveryKeys = useMemo(
    () => ['nodes', 'runtime', 'hfCache', 'localModels', 'modelCache', 'capabilities'] as const,
    [],
  );
  const failedDiscovery = criticalDiscoveryKeys.find((key) => discoveryRequests[key].status === 'error');
  const discoveryReady = criticalDiscoveryKeys.every((key) => discoveryRequests[key].status === 'success');
  const activeRunRestored = Boolean(
    currentTask &&
    currentTask.status !== 'completed' &&
    currentTask.status !== 'failed' &&
    currentTask.status !== 'cancelled',
  );
  const autoPlanRequired = Boolean(resourceMode === 'auto' && graphBinding && nodeCount > 0 && !activeRunRestored);
  const coreStartupReady =
    workflowCanvasHydrated &&
    supervisorStartupStatus === 'settled' &&
    (activeRunRestored ||
      (registryStartupStatus === 'settled' &&
        outputsStartupStatus === 'settled' &&
        discoveryReady &&
        (!autoPlanRequired || autoResourcePlan !== null)));

  useEffect(() => {
    if (coreStartupReady) setStartupComplete(true);
  }, [coreStartupReady]);

  const startupError =
    !startupComplete && !activeRunRestored && registryStartupStatus === 'settled' && failedDiscovery
      ? discoveryRequests[failedDiscovery].error || 'MoDiff could not load the backend runtime and model indexes.'
      : null;
  const startupPhase = !workflowCanvasHydrated
    ? 'Restoring your workspace…'
    : supervisorStartupStatus !== 'settled'
      ? 'Restoring active and recent runs…'
      : registryStartupStatus !== 'settled' || !discoveryReady
        ? 'Loading nodes, models, and runtime information…'
        : outputsStartupStatus !== 'settled'
          ? 'Loading output history…'
          : autoPlanRequired && autoResourcePlan === null
            ? 'Choosing a compatible local plan…'
            : 'Finishing startup…';

  const retryStartup = useCallback(() => {
    useStudioStore.getState().invalidateAutoResourcePlans();
    setStartupComplete(false);
    void loadRegistry();
    void loadBackendOutputs();
    setSupervisorStartupStatus('loading');
    void boundedSupervisorStartup(fetchSupervisorTasks).finally(() => setSupervisorStartupStatus('settled'));
  }, [fetchSupervisorTasks, loadBackendOutputs, loadRegistry]);

  const dismissStartupError = useCallback(() => {
    if (!startupError) return;
    // Keep the failed/restored document in its existing tab and open a fresh
    // empty workflow. Dismissing a load error must never destroy the user's
    // saved graph merely to make the canvas usable again.
    useStudioStore.getState().createWorkflowTab();
    setStartupComplete(true);
  }, [startupError]);

  // Log error if there is one
  useEffect(() => {
    if (nodesStoreError && startupComplete) {
      enqueueSnackbar(nodesStoreError, { variant: 'error', autoHideDuration: nodesStoreError.length * 80 });
    }
  }, [nodesStoreError, enqueueSnackbar, startupComplete]);

  // Cleanup listeners if component unmounts while resizing
  useEffect(() => {
    return () => {
      if (activePanelRef.current) {
        stopResize();
      }
    };
  }, [stopResize]);

  const handleTabChange = useCallback(
    (index: number) => {
      if (index === leftPanelTabIndex) {
        setLeftPanelOpen(false);
        setLeftPanelTabIndex(-1);
      } else {
        setLeftPanelOpen(true);
        setLeftPanelTabIndex(index);
      }
    },
    [setLeftPanelTabIndex, setLeftPanelOpen, leftPanelTabIndex],
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-modiff-bg text-modiff-text">
      {/* Top Navigation Bar */}
      <div className="h-[58px] flex-none bg-modiff-surface text-modiff-text">
        <TopBar />
      </div>

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        {/* Icon Tab Bar */}
        <div className="flex w-[54px] flex-none flex-col items-center justify-center bg-modiff-bg">
          <LeftRailButton
            active={leftPanelTabIndex === 0}
            label="Node library"
            onClick={() => handleTabChange(0)}
            testId="left-tab-nodes"
          >
            <AppWindow size={20} />
          </LeftRailButton>

          <LeftRailButton
            active={leftPanelTabIndex === 1}
            label="Templates library"
            onClick={() => handleTabChange(1)}
            testId="left-tab-templates"
          >
            <LayoutTemplate size={20} />
          </LeftRailButton>

          <LeftRailButton
            active={leftPanelTabIndex === 2}
            label="Gallery"
            onClick={() => handleTabChange(2)}
            testId="left-tab-assets"
          >
            <GalleryVerticalEnd size={20} />
          </LeftRailButton>

          <LeftRailButton
            active={leftPanelTabIndex === 3}
            label="Models library"
            onClick={() => handleTabChange(3)}
            testId="left-tab-models"
          >
            <Boxes size={20} />
          </LeftRailButton>

          <LeftRailButton
            active={leftPanelTabIndex === 4}
            label="Workflow library"
            onClick={() => handleTabChange(4)}
            testId="left-tab-workflows"
          >
            <WorkflowIcon size={20} />
          </LeftRailButton>
        </div>

        {/* Left Panel */}
        <div
          className="relative min-w-0 w-[var(--modiff-left-panel-width)] flex-none overflow-y-auto overflow-x-hidden border-r border-modiff-border bg-modiff-bg"
          data-testid="left-panel"
        >
          <Suspense
            fallback={
              <div className="px-3 py-4 text-xs text-modiff-subtle-text" data-testid="left-panel-loading">
                Loading library…
              </div>
            }
          >
            {leftPanelTabIndex === 0 && <NodeList />}

            {leftPanelTabIndex === 2 && <AssetsLibraryPanel />}

            {leftPanelTabIndex === 1 && <TemplateLibraryPanel />}

            {leftPanelTabIndex === 3 && <ModelsLibraryPanel />}

            {leftPanelTabIndex === 4 && <GraphList />}
          </Suspense>

          {/* Resize handle */}
          <div
            className="absolute right-0 top-0 h-full w-[6px] cursor-col-resize hover:bg-modiff-focus/25"
            data-testid="left-panel-resize-handle"
            onMouseDown={(e) => startResize('left', e)}
          />
        </div>

        {/* Main Content */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <WorkflowTabsBar />
          <div className="relative min-h-0 flex-1">
            <Workflow />
            {nodeCount === 0 && !launcherDismissed && <TaskLauncher />}
            <RunSessionShelf />
          </div>
        </div>

        {/* Right Panel */}
        <div className="relative w-[var(--modiff-right-panel-width)] flex-none overflow-y-auto overflow-x-hidden bg-modiff-bg">
          {isRightPanelOpen ? (
            <Suspense fallback={null}>
              <WorkspacePanel />
            </Suspense>
          ) : null}

          {/* Resize handle */}
          {isRightPanelOpen && (
            <div
              className="absolute left-0 top-0 h-full w-[6px] cursor-col-resize hover:bg-modiff-focus/25"
              onMouseDown={(e) => startResize('right', e)}
            />
          )}
        </div>
      </div>
      <Suspense fallback={null}>
        {runIssuesDialogOpen ? <RunIssuesDialog /> : null}
        {graphFixDialogOpen ? <GraphFixDialog /> : null}
        {templateBrowserOpen ? <TemplateBrowserDialog /> : null}
        {galleryLibraryOpen ? <GalleryLibraryDialog /> : null}
        {mediaViewerOpener ? <MediaViewerDialog /> : null}
        {mediaExportOpener ? <MediaExportDialog /> : null}
      </Suspense>
      {!startupComplete ? (
        <StartupWorkspaceGate
          dismiss={startupError ? dismissStartupError : undefined}
          error={startupError}
          phase={startupPhase}
          retry={retryStartup}
        />
      ) : null}
    </div>
  );
}
