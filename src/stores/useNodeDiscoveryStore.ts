import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useStudioStore, captureWorkflowOperationContext, type WorkflowOperationContext } from './useStudioStore';
import { useNodesStore } from './useNodeStore';
import type { NodeCatalogView } from '../studio/nodeCatalog';

type DiscoveryState = {
  view: NodeCatalogView;
  selection: { context: WorkflowOperationContext; pipeline: string; task: string } | null;
  setView: (view: NodeCatalogView) => void;
  select: (pipeline: string, task?: string) => void;
};

/** Transient browsing preferences, never an execution or workflow authority. */
export const useNodeDiscoveryStore = create<DiscoveryState>((set) => ({
  view: 'common',
  selection: null,
  setView: (view) => set({ view }),
  select: (pipeline, task = '') => set({ selection: { context: captureWorkflowOperationContext(), pipeline, task } }),
}));

export function useNodeDiscovery() {
  const state = useNodeDiscoveryStore(
    useShallow((s) => ({ view: s.view, selection: s.selection, setView: s.setView, select: s.select })),
  );
  const context = useStudioStore(
    useShallow((s) => ({
      workflowTabId: s.activeWorkflowTabId,
      canvasEpoch: s.workflowCanvasEpoch,
      model: s.graphBinding ? s.form.modelType : '',
      task: s.graphBinding ? s.form.mode : '',
    })),
  );
  const support = useNodesStore((s) => s.pipelineSupport);
  const selection =
    state.selection?.context.workflowTabId === context.workflowTabId &&
    state.selection.context.canvasEpoch === context.canvasEpoch
      ? state.selection
      : null;
  const inferred = support.find(
    (item) => item.pipelineClass === context.model && item.tasks.some((t) => t.task === context.task),
  );
  const entry = selection ? support.find((item) => item.pipelineClass === selection.pipeline) : inferred;
  const selected =
    entry?.tasks.find((item) => item.task === (selection?.task ?? context.task)) ??
    entry?.tasks.find((item) => item.operationIds.length > 0) ??
    entry?.tasks[0];
  return {
    ...state,
    selection,
    pipeline: entry?.pipelineClass ?? '',
    task: selected?.task ?? '',
    entry,
    selected,
    support,
  };
}
