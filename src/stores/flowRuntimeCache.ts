import type { CustomNodeType } from './useFlowStore';
import { runtimeProgressTarget } from '../studio/userBlocks';

/** Cache flags are a replaceable view of the last server snapshot and current graph authority. */
export function projectFlowCacheStatus(nodes: CustomNodeType[], cached: readonly string[] | null | undefined) {
  if (cached == null) return nodes;
  const targets = new Set(cached.map((id) => runtimeProgressTarget(nodes, id)));
  return nodes.map((node) => {
    const isCached = targets.has(node.id);
    return Boolean(node.data.isCached) === isCached ? node : { ...node, data: { ...node.data, isCached } };
  });
}
