import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { OperationGraph } from './operationAuthoring';

const GUIDER_CONTEXT_PORT = 'guider_out';
const GUIDER_CONTEXT_HINT = 'Connect Guider to a reviewed Denoise model to edit model-specific guidance.';

function connectedContext(node: CustomNodeType, definition: NodeParams, graph: OperationGraph) {
  const peers = graph.edges.filter((edge) => edge.source === node.id && edge.sourceHandle === GUIDER_CONTEXT_PORT);
  if (!peers.length) return false;
  const allowed = definition.signalCompatibility?.values;
  if (!allowed) return false;
  const admits = (value: unknown) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(allowed, value);
  const live = node.data.params[GUIDER_CONTEXT_PORT]?.signal?.value;
  if (live != null) return admits(live);

  // Saved operation starters intentionally suppress signal callbacks. The exact
  // current peer declaration can corroborate their persisted context.
  const saved = node.data.params.model_type?.value;
  const ownOperation = node.data.operationAuthoring?.operation;
  if (!saved || !admits(saved) || saved !== ownOperation?.pipelineClass) return false;
  return peers.some(({ target, targetHandle }) => {
    const peer = graph.nodes.find(({ id }) => id === target);
    const operation = peer?.data.operationAuthoring?.operation;
    return (
      operation?.pipelineClass === saved &&
      operation.task === ownOperation.task &&
      operation.workflowId === ownOperation.workflowId &&
      operation.ports.some(({ name, direction, hidden }) => name === targetHandle && direction === 'input' && !hidden)
    );
  });
}

/** Project Guider visibility without adding presentation metadata to registered or saved definitions. */
export function unresolvedSignalControls(
  nodeId: string,
  registered: Record<string, NodeParams> | undefined,
  graph: OperationGraph,
) {
  const unresolved = new Map<string, string>();
  const definition = registered?.[GUIDER_CONTEXT_PORT];
  if (!registered || !definition) return unresolved;
  const node = graph.nodes.find(({ id }) => id === nodeId);
  if (node?.data.module !== 'modules.ModularDiffusers' || node.data.action !== 'Guider') return unresolved;
  if (connectedContext(node, definition, graph)) return unresolved;

  const dynamicFields = Object.keys(node.data.params).filter((field) => !(field in registered));
  for (const field of ['guider', 'layers_config', ...dynamicFields]) {
    unresolved.set(field, GUIDER_CONTEXT_HINT);
  }
  return unresolved;
}
