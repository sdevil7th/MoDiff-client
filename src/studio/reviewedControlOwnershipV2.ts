import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';

type Placement = {
  placement: { path: readonly string[]; order: number };
  block: HuggingFaceNodeLibraryBlockDefinition;
};

/** Caller arguments initialize state; a producing step owns subsequent values.
 * Loop members execute inside their owner, not as independent state consumers.
 * No class/family heuristic and no mutation of an existing graph is involved.
 */
export function reviewedCallerInputOwnersV2<T extends Placement>(placements: readonly T[], name: string): T[] | null {
  const ordered = placements
    .filter(({ placement }) => placement.path.length === 1)
    .sort((left, right) => left.placement.order - right.placement.order);
  const writerIndex = ordered.findIndex(
    ({ block }) =>
      block.inputs.some((input) => input.name === name) && block.outputs.some((output) => output.name === name),
  );
  if (writerIndex < 0) return null;
  return ordered.slice(0, writerIndex + 1).filter(({ block }) => block.inputs.some((input) => input.name === name));
}
