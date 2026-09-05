import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';

const PENDING_WIDTH = 360;
const PENDING_HEIGHT = 132;

/**
 * Put immediate, non-durable feedback at the requested canvas position while
 * the checked-in registered BlockDefinitionV2 is fetched and verified.
 */
export function beginBlockInsertionFeedbackV2(label: string, position: CustomNodeType['position']) {
  const id = `block-v2-pending:${globalThis.crypto.randomUUID()}`;
  const pending: CustomNodeType = {
    id,
    type: 'block',
    position: { ...position },
    width: PENDING_WIDTH,
    height: PENDING_HEIGHT,
    draggable: false,
    selectable: false,
    deletable: false,
    data: {
      type: 'block',
      module: 'modiff.block_compiler',
      action: 'PendingBlockInsertionV2',
      label,
      category: 'Block insertion',
      params: {},
      blockCompilationTransientV2: id,
      blockInsertionPendingV2: {
        label,
        message: 'Loading the registered Block definition and adding nodes…',
      },
      uiState: { disabled: true },
    },
  };
  useFlowStore.setState((state) => ({ nodes: [...state.nodes, pending] }));
  return id;
}

export function cancelBlockInsertionFeedbackV2(id: string) {
  useFlowStore.setState((state) => {
    if (!state.nodes.some((node) => node.id === id)) return state;
    return {
      nodes: state.nodes.filter((node) => node.id !== id),
      edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
    };
  });
}

/**
 * Remove feedback before using the ordinary addNode action. That keeps the
 * placeholder out of the history snapshot, so Undo removes the real inserted
 * Block and can never resurrect an endless loading card.
 */
export function completeBlockInsertionFeedbackV2(id: string, block: CustomNodeType) {
  cancelBlockInsertionFeedbackV2(id);
  useFlowStore.getState().addNode(block);
}
