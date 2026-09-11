import type { CustomNodeType } from './useFlowStore';

const transientNodeKeys = new Set(['selected', 'dragging', 'measured', 'data']);
const transientDataKeys = new Set([
  'isCached',
  'progress',
  'activeTaskId',
  'attemptIndex',
  'executionStatus',
  'executionPhase',
  'progressMessage',
  'executionProgress',
  'executionTime',
  'memoryUsage',
  'uiState',
]);
const durableUiKeys = [
  'collapsed',
  'blockExpanded',
  'blockCollapsedWidth',
  'blockCollapsedHeight',
  'clusterCollapsedWidth',
  'clusterCollapsedHeight',
  'disabled',
] as const;

function sameFields(a: object, b: object, ignored: Set<string>) {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(
    (key) => ignored.has(key) || left[key] === right[key],
  );
}

/** Immutable-store fast path only: all semantic fields still invalidate.
 * No content-hash/validation result is cached, and unknown fields fail open
 * to recomputation. Keep exclusions aligned with durableFlowNodeSnapshot.
 */
export function createDurableNodesSelector() {
  let previous: CustomNodeType[] | undefined;
  return (nodes: CustomNodeType[]) => {
    if (
      previous &&
      previous.length === nodes.length &&
      nodes.every((node, index) => {
        const old = previous![index]!;
        return (
          node === old ||
          (sameFields(node, old, transientNodeKeys) &&
            sameFields(node.data, old.data, transientDataKeys) &&
            durableUiKeys.every((key) => node.data.uiState?.[key] === old.data.uiState?.[key]))
        );
      })
    )
      return previous;
    previous = nodes;
    return nodes;
  };
}
