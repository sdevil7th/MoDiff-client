import { nanoid } from 'nanoid';
import { connectBlockInternalGraphV2, removeBlockInternalGraphEdgesV2 } from '../stores/flowConnectionMutations';
import type { CustomNodeType } from '../stores/useFlowStore';
import { dataTypeClass } from '../utils/dataTypeCategory';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { nodeConnectionSemanticsAreCompatible } from '../workflow/nodeConnectionMatching';
import { createBlockRootNodeV2, expandBlockGraphV2ForExecution, replaceBlockEffectiveGraphV2 } from './blockRuntimeV2';
import { repairBlockSeedBindingV2 } from './blockSeedRepairV2';
import { repairBlockDerivedControlV2 } from './blockDerivedControlMutationV2';
import { repairReviewedStateV2 } from './reviewedStateRepairV2';
import { repairReviewedLoopV2 } from './reviewedLoopRepairV2';
import { isBlockRootV2Node, nodeConnectorParam } from './nodeConnectorResolution';
import type { GraphFixContext, GraphFixCandidate, GraphFixOperation, GraphFixMaterialization } from './graphFixer';

function resolvedNodeId(nodeId: string, refs: Map<string, string>) {
  return refs.get(nodeId) ?? nodeId;
}

/**
 * Recover reviewed structure without discarding compatible user additions.
 * Base nodes and edges are authoritative; custom nodes/edges are retained one
 * at a time only when the complete candidate remains executable.
 */
function restoreReviewedBlockStructure(node: CustomNodeType) {
  if (!isBlockRootV2Node(node) || !node.data.blockInstanceV2)
    throw new Error('The Block selected for structural repair no longer exists.');
  const instance = node.data.blockInstanceV2;
  const reviewed = instance.definitionSnapshot.graph;
  const reviewedNodeIds = new Set(reviewed.nodes.map(({ nodeId }) => nodeId));
  const reviewedEdgeIds = new Set(reviewed.edges.map(({ edgeId }) => edgeId));
  let graph = {
    nodes: structuredClone(reviewed.nodes),
    edges: structuredClone(reviewed.edges),
    ...(reviewed.executionOrder ? { executionOrder: structuredClone(reviewed.executionOrder) } : {}),
  };

  const accepts = (candidate: typeof graph) => {
    try {
      const candidateInstance = replaceBlockEffectiveGraphV2(instance, candidate);
      expandBlockGraphV2ForExecution([createBlockRootNodeV2(candidateInstance)], []);
      return candidateInstance;
    } catch {
      return null;
    }
  };
  let repaired = accepts(graph);
  if (!repaired)
    throw new Error('The reviewed Block definition is not executable and cannot be restored automatically.');

  instance.effectiveGraph.nodes
    .filter(({ nodeId }) => !reviewedNodeIds.has(nodeId))
    .forEach((customNode) => {
      const candidate = { ...graph, nodes: [...graph.nodes, structuredClone(customNode)] };
      const accepted = accepts(candidate);
      if (!accepted) return;
      graph = candidate;
      repaired = accepted;
    });
  instance.effectiveGraph.edges
    .filter(({ edgeId }) => !reviewedEdgeIds.has(edgeId))
    .forEach((customEdge) => {
      const candidate = { ...graph, edges: [...graph.edges, structuredClone(customEdge)] };
      const accepted = accepts(candidate);
      if (!accepted) return;
      graph = candidate;
      repaired = accepted;
    });
  return createBlockRootNodeV2(repaired, { selected: node.selected });
}

export function materializeGraphFixes(
  context: Pick<GraphFixContext, 'nodes' | 'edges' | 'registry' | 'modularBlockDefinitions'>,
  candidates: GraphFixCandidate[],
  edgeType = 'default',
): GraphFixMaterialization {
  let nodes = context.nodes.map((node) => structuredClone(node));
  let edges = context.edges.map((edge) => structuredClone(edge));
  const refs = new Map<string, string>();
  const addedNodeIds: string[] = [];
  const externalActions: Array<Extract<GraphFixOperation, { kind: 'external' }>> = [];

  candidates.forEach((candidate) => {
    candidate.operations.forEach((operation) => {
      if (operation.kind === 'remove_edges') {
        const removed = new Set(operation.edgeIds);
        const graph = removeBlockInternalGraphEdgesV2(
          edges.filter((edge) => removed.has(edge.id)),
          nodes,
          edges.filter((edge) => !removed.has(edge.id)),
        );
        nodes = graph.nodes;
        edges = graph.edges;
      } else if (operation.kind === 'add_node') {
        const registryNode = createNodeFromRegistry(operation.nodeKey, context.registry, operation.position);
        if (!registryNode) throw new Error(`Node ${operation.nodeKey} is no longer available.`);
        const created: CustomNodeType = { ...registryNode, id: nanoid(), selected: true };
        refs.set(operation.ref, created.id);
        addedNodeIds.push(created.id);
        nodes.push(created);
      } else if (operation.kind === 'connect') {
        const source = resolvedNodeId(operation.source.nodeId, refs);
        const target = resolvedNodeId(operation.target.nodeId, refs);
        const sourceNode = nodes.find((node) => node.id === source);
        const targetNode = nodes.find((node) => node.id === target);
        if (!sourceNode || !targetNode) {
          throw new Error('A proposed connection references a node that no longer exists.');
        }
        const sourceParam = nodeConnectorParam(sourceNode, operation.source.handle);
        const targetParam = nodeConnectorParam(targetNode, operation.target.handle);
        if (
          !sourceParam ||
          !targetParam ||
          !connectionTypesAreCompatible(sourceParam.type, targetParam.type) ||
          !nodeConnectionSemanticsAreCompatible(
            sourceNode.data,
            operation.source.handle,
            targetNode.data,
            operation.target.handle,
          )
        )
          throw new Error('The proposed connection no longer satisfies the socket type or component capabilities.');
        if (nodes.some((node) => [source, target].includes(node.id) && node.data.blockProjectionOwnerId)) {
          const graph = connectBlockInternalGraphV2(
            { source, target, sourceHandle: operation.source.handle, targetHandle: operation.target.handle },
            nodes,
            edges,
          );
          if (!graph) throw new Error('This repair crosses a Block boundary. Use its public interface instead.');
          nodes = graph.nodes;
          edges = graph.edges;
          return;
        }
        edges = edges.filter((edge) => !(edge.target === target && edge.targetHandle === operation.target.handle));
        edges.push({
          id: nanoid(),
          source,
          sourceHandle: operation.source.handle,
          target,
          targetHandle: operation.target.handle,
          type: edgeType,
          className: dataTypeClass(sourceParam?.type ?? 'any'),
        });
      } else if (
        operation.kind === 'repair_block_derived_control' ||
        operation.kind === 'repair_block_seed' ||
        operation.kind === 'repair_block_state' ||
        operation.kind === 'repair_block_loop'
      ) {
        const index = nodes.findIndex(({ id }) => id === operation.rootNodeId);
        const current = nodes[index];
        if (!current?.data.blockInstanceV2 || !isBlockRootV2Node(current))
          throw new Error('The Block selected for repair no longer exists.');
        const definitions = context.modularBlockDefinitions ?? [];
        const instance =
          operation.kind === 'repair_block_state'
            ? repairReviewedStateV2(
                current.data.blockInstanceV2,
                operation.sourceNodeId,
                operation.targetNodeId,
                operation.graphHash,
                definitions,
              )
            : operation.kind === 'repair_block_loop'
              ? repairReviewedLoopV2(
                  current.data.blockInstanceV2,
                  operation.targetNodeId,
                  operation.graphHash,
                  definitions,
                )
              : operation.kind === 'repair_block_seed'
                ? repairBlockSeedBindingV2(current.data.blockInstanceV2, operation.sourceNodeId, definitions)
                : repairBlockDerivedControlV2(
                    current.data.blockInstanceV2,
                    operation.sourceNodeId,
                    operation.fieldId,
                    definitions,
                  );
        const repaired = createBlockRootNodeV2(instance);
        // A local reconnection must not require unrelated draft errors to be
        // repaired first. repairReviewedStateV2 validates this exact edge and
        // rechecks its proposal against the current graph hash.
        if (operation.kind !== 'repair_block_state' && operation.kind !== 'repair_block_loop')
          expandBlockGraphV2ForExecution([repaired], []);
        nodes[index] = { ...current, ...repaired, selected: current.selected };
      } else if (operation.kind === 'restore_block_structure') {
        const index = nodes.findIndex(({ id }) => id === operation.rootNodeId);
        const current = nodes[index];
        if (!current) throw new Error('The Block selected for structural repair no longer exists.');
        nodes[index] = restoreReviewedBlockStructure(current);
      } else {
        externalActions.push(operation);
      }
    });
  });

  return { nodes, edges, addedNodeIds, externalActions };
}
