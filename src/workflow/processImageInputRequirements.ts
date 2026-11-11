import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import type { OperationContract, OperationPort } from './operationContracts';

const NODE_KEY = 'modules.ImageOperations.ProcessImage';

/** Read the selected facade's existing backend contract without changing its schema. */
export function processImageInputRequirements(
  node: Pick<CustomNodeType, 'id' | 'data'>,
  registry: Record<string, NodeData>,
  operations: readonly OperationContract[],
  edges: readonly Edge[],
): Record<string, Readonly<Pick<OperationPort, 'required' | 'hidden'>>> | null {
  if (`${node.data.module}.${node.data.action}` !== NODE_KEY) return null;
  const selection = (field: string) => {
    const saved = node.data.params[field];
    // A connected selector is computed by execution, not by inspection.
    if (saved?.isConnected || edges.some((edge) => edge.target === node.id && edge.targetHandle === field)) return null;
    const value = saved?.value ?? saved?.default ?? registry[NODE_KEY]?.params[field]?.default;
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const pipeline = selection('pipeline_class');
  const task = selection('operation');
  if (!pipeline || !task) return null;
  const matches = operations.filter(
    (operation) =>
      operation.nodeKey === NODE_KEY &&
      operation.pipelineClass === pipeline &&
      operation.task === task &&
      operation.decomposition === 'integrated',
  );
  const ports =
    matches.length === 1 && Array.isArray(matches[0]!.ports)
      ? matches[0]!.ports.filter((port) => port.direction === 'input' && ['image', 'mask'].includes(port.name))
      : [];
  if (
    ports.length !== 2 ||
    ports[0]!.name === ports[1]!.name ||
    ports.some(
      (port) =>
        typeof port.required !== 'boolean' ||
        typeof port.hidden !== 'boolean' ||
        !Array.isArray(port.types) ||
        !port.types.includes('image'),
    )
  )
    return null;
  return Object.fromEntries(ports.map((port) => [port.name, port]));
}
