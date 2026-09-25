import type { Connection } from '@xyflow/react';
import { nanoid } from 'nanoid';
import { isOptionalEncodingHandle } from './encodingOptionalInput';
import { optionalEncodingRoute } from './encodingImageRoute';
import {
  operationAuthoring,
  planOperationChange,
  type OperationGraph,
  type OperationStarter,
} from './operationAuthoring';
import { visualGroupOwners } from './visualOperationGroups';
import type { OperationContract } from './operationContracts';
import type { PipelineSupport } from './operationCatalog';
import { nodeConnectorParam } from '../studio/nodeConnectorResolution';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';

export function encodingConnectionRoute(
  graph: OperationGraph,
  connection: Connection,
  operations: OperationContract[],
  support: PipelineSupport[],
) {
  const encodingId = isOptionalEncodingHandle(connection.targetHandle) ? connection.target : connection.source;
  const node = graph.nodes.find((item) => item.id === encodingId);
  const operation = optionalEncodingRoute(node?.data.blockInstanceV2, operations, support);
  if (!operation)
    throw new Error('This model has no unambiguous supported image encoder for this connection. Nothing changed.');
  const owners = visualGroupOwners(graph, encodingId);
  if (owners.length !== 1)
    throw new Error(
      'Connect Encode Inputs to one model loader before connecting its image encoding ports. Nothing changed.',
    );
  return { encodingId, operation, owner: owners[0]! };
}

/** Reuse the reviewed backend route, retaining the selected node's identity and
 * exact socket intent. Never route an Image socket through pipeline-wide media
 * choices. The caller commits this whole preparation + wire as one gesture. */
export function planEncodingConnection(
  graph: OperationGraph,
  connection: Connection,
  route: ReturnType<typeof encodingConnectionRoute>,
  starter: OperationStarter,
): OperationGraph {
  if (starter.pipelineClass !== route.operation.pipelineClass || starter.task !== route.operation.task)
    throw new Error('The image encoding route changed. Nothing changed.');
  const plan = planOperationChange(graph, route.owner.id, starter, { preserveValues: true });
  if (plan.review.required)
    throw new Error(
      `Cannot connect without changing existing work: ${plan.review.attention.join(' ')} Nothing changed.`,
    );
  const next = plan.graph;
  function endpoint(id: string, handle: string | null, direction: 'input' | 'output') {
    if (!handle) throw new Error('The connection is missing a socket.');
    if (!isOptionalEncodingHandle(handle)) return { id: plan.replacements[id] ?? id, handle };
    const root = next.nodes.find((node) => node.id === id);
    const instance = root?.data.blockInstanceV2;
    const field = handle.slice(handle.indexOf(':') + 1);
    const ports = instance?.effectiveInterface.boundary[direction === 'input' ? 'inputs' : 'outputs'].filter(
      (port) =>
        port.binding.fieldOrPortId === field &&
        instance.effectiveGraph.nodes.some(
          (stage) =>
            stage.nodeId === port.binding.nodeId &&
            (stage.data.operationAuthoring as { operation?: OperationContract } | undefined)?.operation?.operationId ===
              route.operation.operationId,
        ),
    );
    if (ports?.length !== 1)
      throw new Error('The prepared encoder does not expose the selected socket. Nothing changed.');
    return { id, handle: ports[0]!.portId };
  }
  const source = endpoint(connection.source, connection.sourceHandle, 'output');
  const target = endpoint(connection.target, connection.targetHandle, 'input');
  const output = nodeConnectorParam(
    next.nodes.find((node) => node.id === source.id),
    source.handle,
  );
  const input = nodeConnectorParam(
    next.nodes.find((node) => node.id === target.id),
    target.handle,
  );
  if (
    !output ||
    !input ||
    output.display !== 'output' ||
    !(input.display === 'input' || input.isInput) ||
    !connectionTypesAreCompatible(output.type, input.type)
  )
    throw new Error('These sockets are no longer compatible. Nothing changed.');
  // Normal input replacement; an existing outgoing branch of the same source is
  // never removed. Preparation may already have supplied this exact edge.
  next.edges = next.edges.filter((edge) => edge.target !== target.id || edge.targetHandle !== target.handle);
  next.edges.push({
    id: `edge-${nanoid()}`,
    source: source.id,
    sourceHandle: source.handle,
    target: target.id,
    targetHandle: target.handle,
    type: 'default',
  });
  const seen = new Set<string>();
  const pending = [target.id];
  while (pending.length) {
    const id = pending.pop()!;
    if (id === source.id) throw new Error('That connection would create a cycle. Nothing changed.');
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of next.edges) if (edge.source === id) pending.push(edge.target);
  }
  return next;
}

export function encodingOwnerProfile(owner: OperationGraph['nodes'][number]) {
  const value = owner.data.params.execution_profile_id?.value ?? owner.data.params.execution_profile_id?.default;
  if (!operationAuthoring(owner)) throw new Error('The model loader no longer exists.');
  return typeof value === 'string' && value ? value : undefined;
}
