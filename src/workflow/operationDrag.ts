import { useNodesStore } from '../stores/useNodeStore';
import { useNodeDiscoveryStore } from '../stores/useNodeDiscoveryStore';
import { assertWorkflowOperationContext, captureWorkflowOperationContext } from '../stores/useStudioStore';
import type { OperationContract } from './operationContracts';

export const OPERATION_DRAG_PREFIX = 'modiff-operation:';

function dragSnapshot(operation: OperationContract) {
  return {
    token: `${OPERATION_DRAG_PREFIX}${globalThis.crypto.randomUUID()}`,
    operation,
    context: captureWorkflowOperationContext(),
    selection: useNodeDiscoveryStore.getState().selection,
  };
}

let active: ReturnType<typeof dragSnapshot> | null = null;

/** Only a live library gesture carries authority to resolve this metadata. */
export function beginOperationDrag(operation: OperationContract) {
  active = dragSnapshot(operation);
  return active.token;
}

export function endOperationDrag() {
  active = null;
}

export function takeOperationDrag(token: string) {
  const drag = active;
  active = null;
  if (!drag || drag.token !== token) throw new Error('Drag the node again from the Nodes library.');
  assertOperationDrag(drag);
  return drag;
}

export function assertOperationDrag(drag: ReturnType<typeof dragSnapshot>) {
  assertWorkflowOperationContext(drag.context, { includeForm: false });
  if (
    useNodeDiscoveryStore.getState().selection !== drag.selection ||
    !useNodesStore.getState().operationContracts.includes(drag.operation)
  ) {
    throw new Error('The node selection changed. Drag the node again from the Nodes library.');
  }
}
