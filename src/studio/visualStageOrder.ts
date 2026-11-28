/** Restore the positions of ordinary leaves folded into a presentation Block.
 * Their relative order decides which independent inputs the exporter visits first. */
export function insertStageLeaves<T>(ordinary: T[], placed: { index: number; leaf: T }[]) {
  const ordered = [...ordinary];
  for (const { index, leaf } of placed.sort((a, b) => a.index - b.index)) ordered.splice(index, 0, leaf);
  return ordered;
}

export function visualStageSourceIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
