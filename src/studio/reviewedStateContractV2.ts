import type { BlockGraphNodeV2 } from './blockSchemaV2';
import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';

export function reviewedStateParamsV2(node: BlockGraphNodeV2) {
  const value = node.data.params;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Repairs require the saved block's exact contract, never a same-name guess. */
export function exactReviewedStateContractV2(
  node: BlockGraphNodeV2,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
) {
  const metadata = node.modularDiffusers;
  if (metadata?.kind !== 'upstream_block' || node.data.action !== 'ReviewedModularWorkflowStep') return;
  return definitions.find(
    (item) => item.id === metadata.blockDefinitionId && item.contentHash === metadata.blockContractHash,
  );
}
