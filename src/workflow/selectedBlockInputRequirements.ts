import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import type { OperationContract } from './operationContracts';

/** Only a literal, unambiguous backend-selected block can narrow the generic socket union. */
export function selectedBlockInputRequirements(
  node: Pick<CustomNodeType, 'id' | 'data'>,
  registry: Record<string, NodeData>,
  operations: readonly OperationContract[],
  edges: readonly Edge[],
): Map<string, boolean> | null {
  const key = `${node.data.module}.${node.data.action}`;
  const fields = ['pipeline_class', 'workflow_id', 'block_path'];
  const values = fields.map((field) => {
    const param = node.data.params[field];
    if (param?.isConnected || edges.some((edge) => edge.target === node.id && edge.targetHandle === field)) return null;
    const value = param?.value ?? param?.default ?? registry[key]?.params[field]?.default;
    return typeof value === 'string' && value.length ? value : null;
  });
  if (values.some((value) => value === null)) return null;
  const matches = operations.filter(
    (operation) =>
      operation.nodeKey === key &&
      operation.decomposition === 'block' &&
      operation.pipelineClass === values[0] &&
      operation.binding?.pipelineClass === values[0] &&
      fields.every((field, index) => operation.binding?.values[field] === values[index]),
  );
  const inputs = matches.map((operation) =>
    operation.ports.filter((port) => port.direction === 'input').sort((a, b) => a.name.localeCompare(b.name)),
  );
  if (!inputs.length || inputs.some((ports) => JSON.stringify(ports) !== JSON.stringify(inputs[0]))) return null;
  const required = new Map(inputs[0]!.map((port) => [port.name, port.required]));
  // A generic node's registry is a union of selected schemas. An absent socket
  // is inactive only under the exact authoritative declaration selected above.
  for (const field of Object.keys(registry[key]?.params ?? {})) {
    if (!required.has(field)) required.set(field, false);
  }
  return required;
}
