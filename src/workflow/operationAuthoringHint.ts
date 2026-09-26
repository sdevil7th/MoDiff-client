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
    hint.retained.length > 512 ||
    (hint.authored !== undefined &&
      (!Array.isArray(hint.authored) ||
        hint.authored.length > 512 ||
        hint.authored.some((name) => typeof name !== 'string' || name.length > 128))) ||
    (hint.inactiveDrafts !== undefined &&
      (!Array.isArray(hint.inactiveDrafts) ||
        hint.inactiveDrafts.length > 16 ||
        hint.inactiveDrafts.some(
          (draft) =>
            !draft ||
            typeof draft.routeKey !== 'string' ||
            draft.routeKey.length > 4096 ||
            !Array.isArray(draft.nodes) ||
            draft.nodes.length > 64 ||
            !Array.isArray(draft.edges) ||
            draft.edges.length > 512 ||
            draft.edges.some(
              (edge) =>
                !edge ||
                typeof edge.id !== 'string' ||
                typeof edge.source !== 'string' ||
                typeof edge.target !== 'string' ||
                (edge.sourceHandle != null && typeof edge.sourceHandle !== 'string') ||
                (edge.targetHandle != null && typeof edge.targetHandle !== 'string'),
            ) ||
            draft.nodes.some(
              (item) =>
                !item?.data ||
                typeof item.id !== 'string' ||
                !Number.isFinite(item.position?.x) ||
                !Number.isFinite(item.position?.y) ||
                item.data.operationAuthoring?.inactiveDrafts !== undefined ||
                !operationAuthoring(item),
            ),
        )))
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
