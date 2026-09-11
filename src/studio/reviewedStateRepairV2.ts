import type { BlockInstanceV2 } from './blockSchemaV2';
import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';
import { assertBlockInternalConnectionV2, replaceBlockEffectiveGraphV2 } from './blockRuntimeV2';
import { inspectReviewedStateV2 } from './reviewedStateDiagnosticsV2';

export function repairReviewedStateV2(
  instance: BlockInstanceV2,
  sourceId: string,
  targetId: string,
  expectedHash: string,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
) {
  if (instance.effectiveGraph.graphHash !== expectedHash)
    throw new Error('The Block changed after this repair was proposed. Reopen Fix.');
  const issue = inspectReviewedStateV2(instance, definitions).find((item) => item.nodeId === targetId);
  if (!issue?.reconnectFrom.includes(sourceId))
    throw new Error('This state reconnection is no longer a valid minimal repair. Reopen Fix.');
  assertBlockInternalConnectionV2(
    instance,
    { nodeId: sourceId, fieldOrPortId: 'state_out' },
    { nodeId: targetId, fieldOrPortId: 'state_in' },
  );
  let edgeId = 'repair-state-connection';
  while (instance.effectiveGraph.edges.some((edge) => edge.edgeId === edgeId)) edgeId += '-next';
  return replaceBlockEffectiveGraphV2(instance, {
    ...instance.effectiveGraph,
    edges: [
      ...instance.effectiveGraph.edges,
      { edgeId, sourceNodeId: sourceId, sourcePortId: 'state_out', targetNodeId: targetId, targetPortId: 'state_in' },
    ],
  });
}
