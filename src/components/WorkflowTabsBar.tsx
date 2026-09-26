import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { cx } from '../utils/classNames';
import { handleHorizontalWheel, revealHorizontalItem } from '../utils/horizontalWheel';
import { ModiffHorizontalScrollbar, ModiffIconButton, ModiffTab, ModiffTabList } from '../ui';
import { markWorkflowTabClosed } from '../studio/useWorkflowBackendSync';
import { useWorkflowTabReorder } from './useWorkflowTabReorder';

export default function WorkflowTabsBar() {
  const tabListRef = useRef<HTMLDivElement>(null);
  const pendingTabRevealRef = useRef<number | null>(null);
  const pendingSnapshotSaveRef = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const {
    workflowTabs,
    activeWorkflowTabId,
    ensureWorkflowTabs,
    createWorkflowTab,
    switchWorkflowTab,
    closeWorkflowTab,
    moveWorkflowTab,
    saveActiveWorkflowTab,
  } = useStudioStore(
    useShallow((state) => ({
      workflowTabs: state.workflowTabs,
      activeWorkflowTabId: state.activeWorkflowTabId,
      ensureWorkflowTabs: state.ensureWorkflowTabs,
      createWorkflowTab: state.createWorkflowTab,
      switchWorkflowTab: state.switchWorkflowTab,
      closeWorkflowTab: state.closeWorkflowTab,
      moveWorkflowTab: state.moveWorkflowTab,
      saveActiveWorkflowTab: state.saveActiveWorkflowTab,
    })),
  );
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const viewport = useFlowStore((state) => state.viewport);
  const form = useStudioStore((state) => state.form);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const workflowCanvasHydrated = useStudioStore((state) => state.workflowCanvasHydrated);
  const moveTab = (id: string, targetId: string, placement: 'before' | 'after') => {
    moveWorkflowTab(id, targetId, placement);
    const tabs = useStudioStore.getState().workflowTabs;
    const index = tabs.findIndex((tab) => tab.id === id);
    const tab = tabs[index];
    if (tab) setAnnouncement(`${tab.title}, position ${index + 1} of ${tabs.length}`);
  };
  const reorder = useWorkflowTabReorder(tabListRef, JSON.stringify(workflowTabs.map((tab) => tab.id)), moveTab);

  const revealTabItem = useCallback((tabItem: HTMLElement) => {
    const tabList = tabListRef.current;
    if (!tabList) return;

    if (pendingTabRevealRef.current !== null) {
      window.cancelAnimationFrame(pendingTabRevealRef.current);
    }

    revealHorizontalItem(tabList, tabItem);
    pendingTabRevealRef.current = window.requestAnimationFrame(() => {
      pendingTabRevealRef.current = null;
      if (!tabItem.isConnected || !tabList.contains(tabItem)) return;
      // Native focus scrolling can run after the focus event and reveal only
      // the tab button. Recheck after layout so the adjacent close action is
      // kept inside the horizontal scrollport as well.
      revealHorizontalItem(tabList, tabItem);
    });
  }, []);

  useEffect(
    () => () => {
      if (pendingTabRevealRef.current !== null) {
        window.cancelAnimationFrame(pendingTabRevealRef.current);
      }
    },
    [],
  );

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
    if (activeTab) revealTabItem(activeTab);
  }, [activeWorkflowTabId, revealTabItem, workflowTabs.length]);

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
                data-workflow-tab-id={tab.id}
                className={cx(
                  'group relative flex h-full max-w-[220px] flex-none items-center border-r border-modiff-border text-xs',
                  reorder.preview?.sourceId === tab.id && 'opacity-50',
                  selected
                    ? 'bg-modiff-selected-surface'
                    : 'text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-modiff-text',
                )}
              >
                {reorder.preview?.id === tab.id && (
                  <span
                    aria-hidden="true"
                    data-testid="workflow-tab-drop-indicator"
                    className={cx(
                      'pointer-events-none absolute inset-y-1 z-10 w-0.5 rounded-full bg-hf-yellow',
                      reorder.preview.placement === 'before' ? 'left-0' : 'right-0',
                    )}
                  />
                )}
                <ModiffTab
                  appearance="surface"
                  id={`workflow-tab-${tab.id}`}
                  aria-controls="workflow-canvas-panel"
                  aria-label={`${tab.title}${tab.dirty ? ' (unsaved changes)' : ''}`}
                  aria-describedby="workflow-tab-reorder-help"
                  aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight"
                  title="Drag to reorder · Alt+Shift+Left/Right"
                  selected={selected}
                  data-testid={`workflow-tab-${tab.id}`}
                  onSelect={() => {
                    if (reorder.shouldSelect()) switchWorkflowTab(tab.id);
                  }}
                  onPointerDown={(event) => reorder.onPointerDown(event, tab.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') reorder.allowKeyboardSelection();
                    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    const index = workflowTabs.findIndex((item) => item.id === tab.id);
                    const direction = event.key === 'ArrowLeft' ? -1 : 1;
                    const target = workflowTabs[index + direction];
                    if (!target) return;
                    moveTab(tab.id, target.id, direction === -1 ? 'before' : 'after');
                    const item = event.currentTarget.parentElement;
                    if (item) revealTabItem(item);
                  }}
                  onFocus={(event) => {
                    const tabItem = event.currentTarget.parentElement;
                    if (tabItem) revealTabItem(tabItem);
                  }}
                  className="min-w-0 flex-1 touch-none select-none cursor-grab justify-start rounded-none px-2 text-left text-xs leading-none active:cursor-grabbing focus-visible:outline-inset"
                >
                  <span className="relative block min-w-0 truncate pl-2">
                    <span
                      aria-hidden="true"
                      className={cx(
                        'pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 transition-opacity',
                        tab.dirty ? 'opacity-100' : 'opacity-0',
                      )}
                    >
                      *
                    </span>
                    <span>{tab.title}</span>
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
      <span id="workflow-tab-reorder-help" className="sr-only">
        Drag to reorder, or press Alt+Shift+Left or Right. Escape cancels dragging.
      </span>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
