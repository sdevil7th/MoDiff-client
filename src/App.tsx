import { useSettingsStore } from './stores/useSettingsStore';
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useSnackbar } from './ui/snackbar';
import { AppWindow, Boxes, GalleryVerticalEnd, LayoutTemplate, Workflow as WorkflowIcon } from 'lucide-react';

import Workflow from './components/Workflow';
import TopBar from './components/TopBar';
import NodeList from './components/NodeList';
import { useNodesStore } from './stores/useNodeStore';
import { useWebsocketStore } from './stores/useWebsocketStore.ts';
import GraphList from './components/GraphList.tsx';
import WorkspacePanel from './components/WorkspacePanel.tsx';
import TaskLauncher from './components/TaskLauncher.tsx';
import RunIssuesDialog from './components/RunIssuesDialog.tsx';
import RunSessionShelf from './components/RunSessionShelf.tsx';
import WorkflowTabsBar from './components/WorkflowTabsBar.tsx';
import TemplateBrowserDialog from './components/TemplateBrowserDialog.tsx';
import GalleryLibraryDialog from './components/GalleryLibraryDialog.tsx';
import { AssetsLibraryPanel, ModelsLibraryPanel, TemplateLibraryPanel } from './components/LeftLibraryPanels.tsx';
import { useFlowStore } from './stores/useFlowStore.ts';
import { useStudioStore } from './stores/useStudioStore.ts';
import { installE2EHooks } from './utils/e2eHooks.ts';
import { modiffLayout } from './theme';
import { cx } from './utils/classNames';

const TAB_BAR_WIDTH = modiffLayout.tabBarWidth;
const WORKSPACE_MIN_WIDTH = modiffLayout.workspaceMinWidth;

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
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cx(
        'grid h-[50px] w-[54px] place-items-center text-gray-300 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-hf-yellow',
        active && 'bg-modiff-panel text-hf-yellow',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function App() {
  installE2EHooks();

  const {
    isLeftPanelOpen,
    isRightPanelOpen,
    leftPanelWidth,
    leftPanelTabIndex,
    rightPanelWidth,
    setLeftPanelOpen,
    setLeftPanelWidth,
    setLeftPanelTabIndex,
    setRightPanelOpen,
    setRightPanelWidth,
    setRightPanelTab,
  } = useSettingsStore();

  const { connect: websocketConnect, disconnect: websocketDisconnect } = useWebsocketStore();
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const launcherDismissed = useStudioStore((state) => state.launcherDismissed);
  const fetchBackendOutputs = useStudioStore((state) => state.fetchBackendOutputs);

  const { enqueueSnackbar } = useSnackbar();
  const { error: nodesStoreError, fetchRegistry } = useNodesStore();
  const activePanelRef = useRef<'left' | 'right' | null>(null);

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

  // Fetch nodes from API server
  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  useEffect(() => {
    void fetchBackendOutputs();
  }, [fetchBackendOutputs]);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('share')) return;
    setRightPanelOpen(true);
    setRightPanelTab('share');
  }, [setRightPanelOpen, setRightPanelTab]);

  // Connect to websocket server
  useEffect(() => {
    websocketConnect();

    return () => {
      websocketDisconnect();
    };
  }, [websocketConnect, websocketDisconnect]);

  // Log error if there is one
  useEffect(() => {
    if (nodesStoreError) {
      enqueueSnackbar(nodesStoreError, { variant: 'error', autoHideDuration: nodesStoreError.length * 80 });
    }
  }, [nodesStoreError, enqueueSnackbar]);

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
      <div className="h-[58px] flex-none bg-modiff-surface text-white">
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
        <div className="relative w-[var(--modiff-left-panel-width)] flex-none overflow-y-auto overflow-x-hidden border-r border-modiff-border bg-modiff-bg">
          {leftPanelTabIndex === 0 && <NodeList />}

          {leftPanelTabIndex === 2 && <AssetsLibraryPanel />}

          {leftPanelTabIndex === 1 && <TemplateLibraryPanel />}

          {leftPanelTabIndex === 3 && <ModelsLibraryPanel />}

          {leftPanelTabIndex === 4 && <GraphList />}

          {/* Resize handle */}
          <div
            className="absolute right-0 top-0 h-full w-[6px] cursor-col-resize hover:bg-white/25"
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
          {isRightPanelOpen && <WorkspacePanel />}

          {/* Resize handle */}
          {isRightPanelOpen && (
            <div
              className="absolute left-0 top-0 h-full w-[6px] cursor-col-resize hover:bg-white/25"
              onMouseDown={(e) => startResize('right', e)}
            />
          )}
        </div>
      </div>
      <RunIssuesDialog />
      <TemplateBrowserDialog />
      <GalleryLibraryDialog />
    </div>
  );
}
