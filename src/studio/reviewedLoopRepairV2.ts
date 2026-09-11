import type { BlockInstanceV2 } from './blockSchemaV2';
import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';
import { replaceBlockEffectiveGraphV2 } from './blockRuntimeV2';
import { inspectReviewedLoopV2 } from './reviewedLoopDiagnosticsV2';

/** Offer only an exact retained baseline edge; do not guess a different member order. */
export function reviewedLoopRepairEdgeV2(
  instance: BlockInstanceV2,
  targetId: string,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
) {
  const issues = inspectReviewedLoopV2(instance, definitions);
  if (!issues.some((issue) => issue.nodeId === targetId && issue.code === 'modular_loop_members_disconnected'))
    return null;
  const graph = instance.effectiveGraph;
  if (graph.edges.some((edge) => edge.targetNodeId === targetId && edge.targetPortId === 'loop_members_in'))
    return null;
  const edge = instance.definitionSnapshot.graph.edges.find(
    (edge) =>
      edge.targetNodeId === targetId && edge.targetPortId === 'loop_members_in' && edge.sourcePortId === 'loop_members',
  );
  if (
    !edge ||
    !graph.nodes.some((node) => node.nodeId === edge.sourceNodeId) ||
    graph.edges.some((item) => item.edgeId === edge.edgeId)
  )
    return null;
  // A rewired source may already feed another successor. Keep that edit rather
  // than using an old snapshot edge to create a fork.
  if (graph.edges.some((item) => item.sourceNodeId === edge.sourceNodeId && item.sourcePortId === 'loop_members'))
    return null;
  const candidate = replaceBlockEffectiveGraphV2(instance, {
    ...graph,
    edges: [...graph.edges, structuredClone(edge)],
  });
  if (inspectReviewedLoopV2(candidate, definitions).length >= issues.length) return null;
  return edge;
}

export function repairReviewedLoopV2(
  instance: BlockInstanceV2,
  targetId: string,
  graphHash: string,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
) {
  if (instance.effectiveGraph.graphHash !== graphHash)
    throw new Error('The Block changed after this loop repair was proposed. Open Fix again.');
  const edge = reviewedLoopRepairEdgeV2(instance, targetId, definitions);
  if (!edge)
    throw new Error('The exact single-edge loop repair is no longer applicable. Inspect the current member order.');
  return replaceBlockEffectiveGraphV2(instance, {
    ...instance.effectiveGraph,
    edges: [...instance.effectiveGraph.edges, structuredClone(edge)],
  });
}
