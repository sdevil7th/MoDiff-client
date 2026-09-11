import {
  blockGraphParentIdsV2,
  blockGraphSubtreeNodeIdsV2,
  blockModularContainerNodeIdsV2,
  normalizeBlockInstanceV2,
  type BlockInstanceV2,
} from './blockSchemaV2';
import { blockRelativeInternalLayoutsV2, replaceBlockEffectiveGraphV2, setBlockPresentationV2 } from './blockRuntimeV2';

/** Reparent flat-graph nodes/subtrees without changing values, semantic IDs or wires. */
export function reparentOrdinaryBlockNodeV2(
  instanceValue: BlockInstanceV2,
  nodeId: string,
  parentNodeId: string | undefined,
  position: { x: number; y: number },
) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const source = instance.effectiveGraph.nodes.find((node) => node.nodeId === nodeId);
  if (!source) throw new Error('The internal node is no longer present.');
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y))
    throw new Error('The destination position must be finite.');
  const parents = blockGraphParentIdsV2(instance.effectiveGraph);
  const sameParent = parents.get(nodeId) === parentNodeId;
  if (parentNodeId && !blockModularContainerNodeIdsV2(instance.effectiveGraph).includes(parentNodeId))
    throw new Error('Choose an existing internal Block as the destination.');
  if (parentNodeId && blockGraphSubtreeNodeIdsV2(instance.effectiveGraph, nodeId).has(parentNodeId))
    throw new Error('A Block cannot be moved inside itself or its descendants.');
  const layouts = blockRelativeInternalLayoutsV2(instance);
  let next = instance;
  if (!sameParent) {
    const graph = structuredClone(instance.effectiveGraph);
    const moved = graph.nodes.find((node) => node.nodeId === nodeId)!;
    if (parentNodeId) moved.parentNodeId = parentNodeId;
    else delete moved.parentNodeId;
    if (source.modularDiffusers?.kind === 'upstream_block') {
      const oldPath = source.modularDiffusers.placementPath;
      if (!oldPath?.length) throw new Error('The moved upstream node has no exact placement path.');
      // User grouping is presentation ownership, not a fabricated upstream
      // Python block. Resolve the nearest genuine upstream execution parent.
      let ancestor = parentNodeId;
      let destinationPath: string[] = [];
      while (ancestor) {
        const parent = graph.nodes.find((node) => node.nodeId === ancestor)!;
        if (parent.modularDiffusers?.kind === 'upstream_block') {
          destinationPath = parent.modularDiffusers.placementPath ?? [];
          break;
        }
        ancestor = parents.get(ancestor);
      }
      const descendants = blockGraphSubtreeNodeIdsV2(instance.effectiveGraph, nodeId);
      const occupied = new Set(
        graph.nodes
          .filter((node) => !descendants.has(node.nodeId))
          .map((node) => node.modularDiffusers?.placementPath?.join('/')),
      );
      const leaf = oldPath[oldPath.length - 1]!;
      let newPath = [...destinationPath, leaf];
      let suffix = 2;
      while (occupied.has(newPath.join('/'))) newPath = [...destinationPath, `${leaf}_${suffix++}`];
      for (const node of graph.nodes) {
        const metadata = node.modularDiffusers;
        const path = metadata?.placementPath;
        if (!descendants.has(node.nodeId) || metadata?.kind !== 'upstream_block' || !path) continue;
        if (JSON.stringify(path.slice(0, oldPath.length)) !== JSON.stringify(oldPath))
          throw new Error(
            'The subtree contains a different upstream execution branch. Resolve its ownership before moving it.',
          );
        if (!metadata.sourceDefinitionId && instance.definitionSnapshot.source.manifestDefinitionId) {
          metadata.sourceDefinitionId = instance.definitionSnapshot.source.manifestDefinitionId;
          metadata.sourcePlacementPath = [...path];
          metadata.sourceExecutionScope = 'unpruned_pipeline';
        }
        metadata.placementPath = [...newPath, ...path.slice(oldPath.length)];
        const parentPath = metadata.placementPath.slice(0, -1);
        if (parentPath.length) metadata.parentPlacementPath = parentPath;
        else delete metadata.parentPlacementPath;
      }
    }
    // Local interfaces own descendants only. Moving a child transfers that
    // ownership; retaining its old control/port would create a stale binding.
    for (const container of graph.nodes) {
      const local = container.containerInterface;
      if (!local) continue;
      const scope = blockGraphSubtreeNodeIdsV2(graph, container.nodeId);
      const retain = <T extends { binding: { nodeId: string }; mirrorBindings?: Array<{ nodeId: string }> }>(
        items: T[],
      ): T[] =>
        items.flatMap((item) => {
          const bindings = [item.binding, ...(item.mirrorBindings ?? [])].filter((binding) =>
            scope.has(binding.nodeId),
          );
          if (!bindings.length) return [];
          const next = structuredClone(item);
          next.binding = bindings[0]!;
          delete next.mirrorBindings;
          if (bindings.length > 1) next.mirrorBindings = bindings.slice(1);
          return [next];
        });
      local.boundary.inputs = retain(local.boundary.inputs);
      local.boundary.outputs = retain(local.boundary.outputs);
      local.controls = retain(local.controls).map((control, order) => ({ ...control, order }));
      if (local.previews) local.previews = local.previews.filter((preview) => scope.has(preview.nodeId));
    }
    try {
      next = replaceBlockEffectiveGraphV2(instance, graph);
    } catch (error) {
      throw new Error(
        `Cannot move this node while its current internal interface still owns its fields. Rebind the affected controls, ports or previews in Configure Interface first. ${error instanceof Error ? error.message : ''}`,
      );
    }
  }
  return setBlockPresentationV2(next, {
    internalLayoutMode: 'hierarchical',
    internalLayout: { ...layouts, [nodeId]: { ...layouts[nodeId], ...position } },
  });
}
