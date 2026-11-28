import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import type { OperationContract } from './operationContracts';

/** Only a literal, unambiguous backend-selected block or bundle can narrow the socket union. */
export function selectedBlockInputRequirements(
  node: Pick<CustomNodeType, 'id' | 'data'>,
  registry: Record<string, NodeData>,
  operations: readonly OperationContract[],
  edges: readonly Edge[],
): Map<string, boolean> | null {
  const key = `${node.data.module}.${node.data.action}`;
  const hint = node.data.operationAuthoring;
  // The hint selects only an identity. Requiredness always comes from the
  // current backend; saved port metadata grants no authority.
  const selected =
    hint?.schemaVersion === 1 && hint.operation?.nodeKey === key && hint.operation.decomposition === 'bundle'
      ? hint.operation
      : null;
  const bundles = selected
    ? operations.filter(
        (operation) =>
          operation.nodeKey === key &&
          operation.decomposition === 'bundle' &&
          operation.pipelineClass === selected.pipelineClass &&
          operation.task === selected.task &&
          operation.operationId === selected.operationId,
      )
    : [];
  if (selected && bundles.length !== 1) return null;
  const fields = selected
    ? Object.keys(bundles[0]!.binding?.values ?? {})
    : ['pipeline_class', 'workflow_id', 'block_path'];
  const values = fields.map((field) => {
    const param = node.data.params[field];
    if (param?.isConnected || edges.some((edge) => edge.target === node.id && edge.targetHandle === field)) return null;
    const value = param?.value ?? param?.default ?? registry[key]?.params[field]?.default;
    return typeof value === 'string' && value.length ? value : null;
  });
  if (values.some((value) => value === null)) return null;
  const matches = selected
    ? bundles.filter((operation) => fields.every((field, index) => operation.binding?.values[field] === values[index]))
    : operations.filter(
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
  if (!selected)
    for (const field of Object.keys(registry[key]?.params ?? {})) {
      if (!required.has(field)) required.set(field, false);
    }
  return required;
}
