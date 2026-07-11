import { useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { cx } from '../utils/classNames';
import { handleHorizontalWheel } from '../utils/horizontalWheel';

export default function WorkflowTabsBar() {
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

  useEffect(() => {
    ensureWorkflowTabs();
  }, [ensureWorkflowTabs]);

  useEffect(() => {
    const timer = window.setTimeout(() => saveActiveWorkflowTab(true), 350);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, viewport, form, graphBinding, saveActiveWorkflowTab]);

  if (workflowTabs.length === 0 || !activeWorkflowTabId) return null;

  return (
    <div
      data-testid="workflow-tabs-bar"
      className="flex h-[38px] flex-none items-center border-b border-modiff-border bg-modiff-bg"
    >
      <div
        role="tablist"
        aria-label="Workflow tabs"
        className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
        onWheel={handleHorizontalWheel}
      >
        {workflowTabs.map((tab) => {
          const selected = tab.id === activeWorkflowTabId;

          return (
            <div
              key={tab.id}
              className={cx(
                'group flex h-[38px] max-w-[220px] flex-none items-center border-r border-modiff-border text-xs',
                selected ? 'bg-modiff-panel text-hf-yellow' : 'text-gray-300 hover:bg-white/5 hover:text-white',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                data-testid={`workflow-tab-${tab.id}`}
                onClick={() => switchWorkflowTab(tab.id)}
                className="min-w-0 flex-1 px-2 text-left font-semibold leading-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-hf-yellow"
              >
                <span className="block truncate">
                  {tab.dirty ? '* ' : ''}
                  {tab.title}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                title="Close workflow"
                onClick={(event) => {
                  event.stopPropagation();
                  closeWorkflowTab(tab.id);
                }}
                className="grid size-7 flex-none place-items-center text-gray-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-hf-yellow"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New workflow tab"
        title="New workflow tab"
        data-testid="workflow-tab-new"
        onClick={() => createWorkflowTab()}
        className="grid h-[38px] w-10 flex-none place-items-center text-gray-300 transition hover:bg-white/10 hover:text-hf-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-hf-yellow"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
