import { create } from 'zustand';
import { useFlowStore } from './useFlowStore';
import { captureWorkflowOperationContext, type WorkflowOperationContext } from './useStudioStore';
import { useSettingsStore } from './useSettingsStore';
import type { BlockInstanceV2 } from '../studio/blockSchemaV2';

type BlockEditorTarget = {
  requestId: number;
  mode: 'save' | 'interface';
  nodeId: string;
  snapshot: BlockInstanceV2;
  subtreeId?: string;
  context: WorkflowOperationContext;
};
let requestId = 0;

export const useBlockEditorStore = create<{
  target: BlockEditorTarget | null;
  open: (nodeId: string, mode: BlockEditorTarget['mode']) => void;
  close: () => void;
}>((set) => ({
  target: null,
  open: (nodeId, mode) => {
    const nodes = useFlowStore.getState().nodes;
    const selected = nodes.find((node) => node.id === nodeId);
    const ownerId = selected?.data.blockInstanceV2 ? nodeId : selected?.data.blockProjectionOwnerId;
    const instance = nodes.find((node) => node.id === ownerId)?.data.blockInstanceV2;
    if (!instance) return;
    set({
      target: {
        requestId: ++requestId,
        mode,
        nodeId,
        snapshot: structuredClone(instance),
        subtreeId: selected?.data.blockProjectionNodeId,
        context: captureWorkflowOperationContext(),
      },
    });
    useSettingsStore.getState().setRightPanelTab('block');
    useSettingsStore.getState().setRightPanelOpen(true);
  },
  close: () => {
    set({ target: null });
    if (useSettingsStore.getState().rightPanelTab === 'block') useSettingsStore.getState().setRightPanelTab('studio');
  },
}));
