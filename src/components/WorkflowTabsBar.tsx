import { useEffect, useLayoutEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { cx } from '../utils/classNames';
import { handleHorizontalWheel, revealHorizontalItem } from '../utils/horizontalWheel';
import { ModiffHorizontalScrollbar, ModiffIconButton, ModiffTab, ModiffTabList } from '../ui';
import { markWorkflowTabClosed } from '../studio/useWorkflowBackendSync';

export default function WorkflowTabsBar() {
  const tabListRef = useRef<HTMLDivElement>(null);
  const pendingSnapshotSaveRef = useRef(false);
  const {
    workflowTabs,
    activeWorkflowTabId,
    ensureWorkflowTabs,
    createWorkflowTab,
    switchWorkflowTab,
    closeWorkflowTab,
    saveActiveWorkflowTab,
  } = useStudioStore(
    useShallow((state) => ({
      workflowTabs: state.workflowTabs,
      activeWorkflowTabId: state.activeWorkflowTabId,
      ensureWorkflowTabs: state.ensureWorkflowTabs,
      createWorkflowTab: state.createWorkflowTab,
      switchWorkflowTab: state.switchWorkflowTab,
      closeWorkflowTab: state.closeWorkflowTab,
      saveActiveWorkflowTab: state.saveActiveWorkflowTab,
    })),
  );
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const viewport = useFlowStore((state) => state.viewport);
  const form = useStudioStore((state) => state.form);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const workflowCanvasHydrated = useStudioStore((state) => state.workflowCanvasHydrated);

  useEffect(() => {
    if (!workflowCanvasHydrated) return;
    ensureWorkflowTabs();
  }, [ensureWorkflowTabs, workflowCanvasHydrated]);

  useEffect(() => {
    if (!workflowCanvasHydrated) return;
    pendingSnapshotSaveRef.current = true;
    const timer = window.setTimeout(() => {
      saveActiveWorkflowTab(true);
      pendingSnapshotSaveRef.current = false;
    }, 350);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, viewport, form, graphBinding, saveActiveWorkflowTab, workflowCanvasHydrated]);

  useEffect(() => {
    if (!workflowCanvasHydrated) return;
    const flushPendingSnapshot = () => {
      if (!pendingSnapshotSaveRef.current) return;
      saveActiveWorkflowTab(true);
      pendingSnapshotSaveRef.current = false;
    };
    window.addEventListener('pagehide', flushPendingSnapshot);
    return () => window.removeEventListener('pagehide', flushPendingSnapshot);
  }, [saveActiveWorkflowTab, workflowCanvasHydrated]);

  useLayoutEffect(() => {
    const tabList = tabListRef.current;
    const activeTab = tabList?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement;
    if (tabList && activeTab) revealHorizontalItem(tabList, activeTab);
  }, [activeWorkflowTabId, workflowTabs.length]);

  if (workflowTabs.length === 0 || !activeWorkflowTabId) return null;

  return (
    <div
      data-testid="workflow-tabs-bar"
      className="flex h-[38px] flex-none items-center overflow-hidden border-b border-modiff-border bg-modiff-bg"
    >
      <div className="relative h-full min-w-0 flex-1 overflow-hidden">
        <ModiffTabList
          ref={tabListRef}
          id="workflow-tabs-list"
          aria-label="Workflow tabs"
          data-testid="workflow-tabs-scroll"
          className="modiff-overlay-scrollport-x h-full min-w-0 flex-nowrap! gap-0 overflow-x-auto overflow-y-hidden"
          onWheel={handleHorizontalWheel}
        >
          {workflowTabs.map((tab) => {
            const selected = tab.id === activeWorkflowTabId;

            return (
              <div
                key={tab.id}
                data-dirty={tab.dirty || undefined}
                data-selected={selected || undefined}
                className={cx(
                  'group flex h-full max-w-[220px] flex-none items-center border-r border-modiff-border text-xs',
                  selected
                    ? 'bg-modiff-selected-surface'
                    : 'text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-modiff-text',
                )}
              >
                <ModiffTab
                  appearance="surface"
                  id={`workflow-tab-${tab.id}`}
                  aria-controls="workflow-canvas-panel"
                  selected={selected}
                  data-testid={`workflow-tab-${tab.id}`}
                  onSelect={() => switchWorkflowTab(tab.id)}
                  onFocus={(event) => {
                    const tabList = event.currentTarget.closest<HTMLElement>('[data-testid="workflow-tabs-scroll"]');
                    const tabItem = event.currentTarget.parentElement;
                    if (tabList && tabItem) revealHorizontalItem(tabList, tabItem);
                  }}
                  className="min-w-0 flex-1 justify-start rounded-none px-2 text-left text-xs leading-none focus-visible:outline-inset"
                >
                  <span className="block truncate">
                    {tab.dirty ? '* ' : ''}
                    {tab.title}
                  </span>
                </ModiffTab>
                <ModiffIconButton
                  label={`Close ${tab.title}`}
                  size="compact"
                  onClick={(event) => {
                    event.stopPropagation();
                    markWorkflowTabClosed(tab.id);
                    closeWorkflowTab(tab.id);
                  }}
                  className="rounded-none text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-modiff-text focus-visible:outline-inset"
                >
                  <X size={14} />
                </ModiffIconButton>
              </div>
            );
          })}
        </ModiffTabList>
        <ModiffHorizontalScrollbar
          controls="workflow-tabs-list"
          label="Scroll workflow tabs"
          scrollRef={tabListRef}
          testId="workflow-tabs-scrollbar"
        />
      </div>
      <ModiffIconButton
        label="New workflow tab"
        data-testid="workflow-tab-new"
        onClick={() => createWorkflowTab()}
        className="h-full w-10 rounded-none text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-hf-yellow focus-visible:outline-inset"
      >
        <Plus size={16} />
      </ModiffIconButton>
    </div>
  );
}
