import type { Connection, Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { UserBlockDefinition } from '../studio/types';
import { expandUserBlockGraph } from '../studio/userBlocks';
import { blockProjectionNodeIdV2, expandBlockGraphV2ForExecution } from '../studio/blockRuntimeV2';
import { blockConnectionTargetsV2, canonicalBlockCrossingConnectionsV2 } from '../studio/blockCrossingConnectionsV2';
import { expandHuggingFaceClusterBoundaryEdges } from '../studio/huggingFaceClusterGraph';

/** Check a proposed wire on executable leaves without persisting a fake projection edge. */
export function connectionCreatesExecutionCycle(
  nodes: CustomNodeType[],
  edges: Edge[],
  connection: Connection,
  blocks: UserBlockDefinition[] = [],
) {
  const marker = 'connectionCyclePreview';
  const candidates = canonicalBlockCrossingConnectionsV2(connection, nodes).map((wire, index) => ({
    ...wire,
    id: `connection-cycle-preview-${index}`,
    data: { [marker]: true },
  }));
  const legacy = expandUserBlockGraph(
    nodes,
    [...edges.map((edge) => ({ ...edge, data: { ...edge.data, [marker]: false } })), ...candidates],
    blocks,
  );
  const clusters = expandHuggingFaceClusterBoundaryEdges(legacy);
  const proposed = clusters.edges.filter((edge) => edge.data?.[marker]);
  const graph = expandBlockGraphV2ForExecution(
    clusters.nodes,
    clusters.edges.filter((edge) => !edge.data?.[marker]),
  );
  const endpoint = (id: string, handle: string | null | undefined, direction: 'input' | 'output') => {
    const root = clusters.nodes.find((node) => node.id === id && node.data.blockInstanceV2);
    if (!root) return [{ id, handle }];
    return blockConnectionTargetsV2(root, handle ?? '', direction).map((binding) => ({
      id: blockProjectionNodeIdV2(root.id, binding.nodeId),
      handle: binding.fieldOrPortId,
    }));
  };
  const wires = proposed.flatMap((wire) =>
    endpoint(wire.source, wire.sourceHandle, 'output').flatMap((source) =>
      endpoint(wire.target, wire.targetHandle, 'input').map((target) => ({ source, target })),
    ),
  );
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    // A reconnect replaces the incoming driver at its destination.
    if (wires.some(({ target }) => target.id === edge.target && target.handle === edge.targetHandle)) continue;
    const next = outgoing.get(edge.source) ?? [];
    next.push(edge.target);
    outgoing.set(edge.source, next);
  }
  for (const { source, target } of wires) {
    const next = outgoing.get(source.id) ?? [];
    next.push(target.id);
    outgoing.set(source.id, next);
  }
  return wires.some(({ source, target }) => {
    const pending = [target.id],
      seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === source.id) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(outgoing.get(id) ?? []));
    }
    return false;
  });
}
