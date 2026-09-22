import type { CustomNodeType } from '../stores/useFlowStore';
import type { OperationAuthoring } from './operationAuthoring';
import { parseOperationContracts } from './operationContracts';

/** Imported hints are untrusted and never change a legacy graph on restore. */
export function operationAuthoring(node: CustomNodeType): OperationAuthoring | null {
  const hint = node.data.operationAuthoring;
  if (
    !hint ||
    hint.schemaVersion !== 1 ||
    !hint.defaults ||
    typeof hint.defaults !== 'object' ||
    Array.isArray(hint.defaults) ||
    Object.keys(hint.defaults).length > 512 ||
    !Array.isArray(hint.retained) ||
    hint.retained.length > 512
  )
    return null;
  try {
    const [operation] = parseOperationContracts([hint.operation], 3);
    if (!operation || operation.nodeKey !== `${node.data.module}.${node.data.action}`) return null;
    if (
      hint.retained.some(
        (v) => !v || typeof v.field !== 'string' || typeof v.reason !== 'string' || typeof v.pipeline !== 'string',
      )
    )
      return null;
    return hint;
  } catch {
    return null;
  }
}
