import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';

/** Pure backend-declared requiredness. Inspection never resolves a wired selector. */
export function conditionalInputRequired(
  node: Pick<CustomNodeType, 'id' | 'data'>,
  param: NodeParams,
  registry: Record<string, NodeData>,
  edges: readonly Edge[],
): boolean | undefined {
  const when = param.requiredWhen;
  if (
    !when ||
    typeof when !== 'object' ||
    Array.isArray(when) ||
    typeof when.field !== 'string' ||
    !when.field ||
    typeof when.equals !== 'string'
  )
    return param.required;
  const definition = registry[`${node.data.module}.${node.data.action}`];
  const selector = node.data.params[when.field] ?? definition?.params[when.field];
  if (
    !selector ||
    selector.isConnected ||
    edges.some((edge) => edge.target === node.id && edge.targetHandle === when.field)
  )
    return param.required;
  const value = selector.value ?? selector.default ?? definition?.params[when.field]?.default;
  if (typeof value !== 'string') return param.required;
  return value === when.equals;
}
