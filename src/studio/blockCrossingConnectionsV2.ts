import type { Connection, Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import { blockGraphParentIdsV2, type BlockInstanceV2 } from './blockSchemaV2';
import { blockProjectionConnectionEndpointsV2, blockProjectionNodeIdV2 } from './blockRuntimeV2';
import { blockContainerFieldValueV1 } from './blockContainerInterfaceV1';
import { blockValueTypesAreCompatibleV2, normalizeBlockValueTypeV2 } from './blockValueTypeCompatibilityV2';

const PREFIX = 'block-crossing:';
export type BlockCrossingEndpointV2 = { nodeId: string; fieldOrPortId: string; direction: 'input' | 'output' };

/** Durable root handle: exact semantic identity, never a temporary canvas id. */
export function blockCrossingHandleV2(endpoint: BlockCrossingEndpointV2) {
  return `${PREFIX}${endpoint.direction}:${encodeURIComponent(endpoint.nodeId)}:${encodeURIComponent(endpoint.fieldOrPortId)}`;
}

export function parseBlockCrossingHandleV2(handle: string | null | undefined): BlockCrossingEndpointV2 | null {
  if (!handle?.startsWith(PREFIX)) return null;
  const parts = handle.slice(PREFIX.length).split(':');
  if (parts.length !== 3 || (parts[0] !== 'input' && parts[0] !== 'output'))
    throw new Error('Invalid Block crossing socket. Reconnect the affected wire.');
  let endpoint: BlockCrossingEndpointV2;
  try {
    endpoint = {
      direction: parts[0],
      nodeId: decodeURIComponent(parts[1]!),
      fieldOrPortId: decodeURIComponent(parts[2]!),
    };
  } catch {
    throw new Error('Invalid Block crossing socket encoding.');
  }
  if (!endpoint.nodeId || !endpoint.fieldOrPortId || blockCrossingHandleV2(endpoint) !== handle)
    throw new Error('Invalid Block crossing socket identity.');
  return endpoint;
}

export function blockCrossingParamV2(instance: BlockInstanceV2, endpoint: BlockCrossingEndpointV2): NodeParams {
  const node = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === endpoint.nodeId);
  const params = node?.data.params as Record<string, NodeParams> | undefined;
  const param = params?.[endpoint.fieldOrPortId];
  if (!node || !param || (endpoint.direction === 'output') !== (param.display === 'output'))
    throw new Error(
      `The connected Block field ${endpoint.nodeId}.${endpoint.fieldOrPortId} is missing or has changed direction.`,
    );
  return {
    ...param,
    type: normalizeBlockValueTypeV2(param.type) as NodeParams['type'],
    label: `${node.data.label || node.data.action || node.nodeId} / ${param.label || endpoint.fieldOrPortId}`,
    display: endpoint.direction,
    isInput: endpoint.direction === 'input',
    hidden: false,
    disabled: false,
    isConnected: true,
    ...(endpoint.direction === 'input'
      ? { value: blockContainerFieldValueV1(instance, endpoint.nodeId, endpoint.fieldOrPortId) }
      : {}),
    fieldOptions: { suppressInitialFieldAction: true },
    signal: undefined,
  };
}

export function blockConnectionTargetsV2(node: CustomNodeType, handle: string, direction: 'input' | 'output') {
  const crossing = parseBlockCrossingHandleV2(handle);
  if (crossing) {
    if (crossing.direction !== direction) throw new Error('The Block socket has the wrong direction.');
    return [{ nodeId: crossing.nodeId, fieldOrPortId: crossing.fieldOrPortId }];
  }
  if (node.data.blockInstanceV2) {
    const ports = node.data.blockInstanceV2.effectiveInterface.boundary[direction === 'input' ? 'inputs' : 'outputs'];
    const port = ports.find(({ portId }) => portId === handle);
    return port ? [port.binding, ...(direction === 'input' ? (port.mirrorBindings ?? []) : [])] : [];
  }
  return blockProjectionConnectionEndpointsV2(node, handle, direction);
}

/** Convert an outside-to-leaf gesture to stable root endpoints without editing an interface. */
export function canonicalBlockCrossingConnectionsV2(connection: Connection, nodes: CustomNodeType[]): Connection[] {
  const ends = (id: string, handle: string, direction: 'input' | 'output') => {
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node) throw new Error('A connection endpoint is no longer available.');
    if (!node.data.blockProjectionOwnerId) return [{ id, handle }];
    const targets = blockConnectionTargetsV2(node, handle, direction);
    if (!targets.length) throw new Error('The internal socket is no longer available.');
    return targets.map((target) => ({
      id: node.data.blockProjectionOwnerId!,
      handle: blockCrossingHandleV2({ ...target, direction }),
    }));
  };
  if (!connection.sourceHandle || !connection.targetHandle) throw new Error('Both connection sockets are required.');
  const sources = ends(connection.source, connection.sourceHandle, 'output');
  const targets = ends(connection.target, connection.targetHandle, 'input');
  return sources.flatMap((source) =>
    targets.map((target) => ({
      source: source.id,
      sourceHandle: source.handle,
      target: target.id,
      targetHandle: target.handle,
    })),
  );
}

/** Validate exact fields and competing public/direct/internal drivers before any mutation. */
export function assertBlockCrossingConnectionV2(
  connection: Connection,
  nodes: CustomNodeType[],
  edges: Edge[],
  ignoredIds: ReadonlySet<string> = new Set(),
) {
  const source = nodes.find(({ id }) => id === connection.source);
  const target = nodes.find(({ id }) => id === connection.target);
  if (!source || !target || !connection.sourceHandle || !connection.targetHandle)
    throw new Error('The connection is incomplete.');
  const param = (node: CustomNodeType, handle: string, direction: 'input' | 'output') => {
    if (!node.data.blockInstanceV2) return node.data.params[handle];
    const binding = blockConnectionTargetsV2(node, handle, direction)[0];
    return binding ? blockCrossingParamV2(node.data.blockInstanceV2, { ...binding, direction }) : undefined;
  };
  const sourceParam = param(source, connection.sourceHandle, 'output');
  const targetParam = param(target, connection.targetHandle, 'input');
  if (
    !sourceParam ||
    !targetParam ||
    sourceParam.display !== 'output' ||
    targetParam.display === 'output' ||
    !blockValueTypesAreCompatibleV2(sourceParam.type, targetParam.type)
  )
    throw new Error('The connection sockets have incompatible types or directions.');
  if (source.id === target.id) throw new Error('Connect the internal nodes directly inside the Block.');
  const instance = target.data.blockInstanceV2;
  if (!instance) return;
  for (const binding of blockConnectionTargetsV2(target, connection.targetHandle, 'input')) {
    const matches = (other: { nodeId: string; fieldOrPortId: string }) =>
      other.nodeId === binding.nodeId && other.fieldOrPortId === binding.fieldOrPortId;
    const controls = [
      ...instance.effectiveInterface.controls,
      ...instance.effectiveGraph.nodes.flatMap((node) => node.containerInterface?.controls ?? []),
    ];
    if (
      controls.some(
        (control) =>
          control.sealed &&
          [control.binding, ...(control.mirrorBindings ?? [])].some(
            (item) => item.nodeId === binding.nodeId && item.fieldId === binding.fieldOrPortId,
          ),
      )
    )
      throw new Error('Cannot connect a sealed Block control. Use its reviewed selector.');
    if (
      instance.effectiveGraph.edges.some(
        (edge) => edge.targetNodeId === binding.nodeId && edge.targetPortId === binding.fieldOrPortId,
      )
    )
      throw new Error('This internal input already has a driver. Disconnect it before adding an outside wire.');
    if (
      edges.some(
        (edge) =>
          !ignoredIds.has(edge.id) &&
          edge.target === target.id &&
          edge.targetHandle &&
          blockConnectionTargetsV2(target, edge.targetHandle, 'input').some(matches),
      )
    )
      throw new Error('Another Block connection already drives this input. Disconnect it before reconnecting.');
  }
}

type CrossingSurface = { edges: Edge[]; paramsByNodeId: Map<string, Record<string, NodeParams>> };
const surfaces = new WeakMap<CustomNodeType[], WeakMap<Edge[], CrossingSurface>>();

/** Display-only lifting. Durable edges stay on roots and survive unmounted internal nodes. */
export function blockCrossingSurfaceV2(nodes: CustomNodeType[], edges: Edge[]): CrossingSurface {
  const cached = surfaces.get(nodes)?.get(edges);
  if (cached) return cached;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const paramsByNodeId = new Map<string, Record<string, NodeParams>>();
  const lift = (id: string, handle: string | null | undefined, direction: 'input' | 'output') => {
    const endpoint = parseBlockCrossingHandleV2(handle);
    if (!endpoint) return { id, handle };
    const instance = byId.get(id)?.data.blockInstanceV2;
    if (!instance || endpoint.direction !== direction)
      throw new Error('The crossing connection has no valid owning Block.');
    const param = blockCrossingParamV2(instance, endpoint);
    let representative = id;
    let liftedHandle = handle;
    if (instance.presentation.expanded) {
      const parents = blockGraphParentIdsV2(instance.effectiveGraph);
      const collapsed = new Set(instance.presentation.collapsedContainerNodeIds ?? []);
      let semantic = endpoint.nodeId;
      let parent = parents.get(semantic);
      while (parent) {
        if (collapsed.has(parent)) semantic = parent;
        parent = parents.get(parent);
      }
      const projectedId = blockProjectionNodeIdV2(id, semantic);
      if (byId.has(projectedId)) {
        representative = projectedId;
        if (semantic === endpoint.nodeId) liftedHandle = endpoint.fieldOrPortId;
      }
    }
    if (liftedHandle === handle) {
      const params = paramsByNodeId.get(representative) ?? {};
      params[handle!] = param;
      paramsByNodeId.set(representative, params);
    }
    return { id: representative, handle: liftedHandle };
  };
  const projected = edges.map((edge) => {
    const source = lift(edge.source, edge.sourceHandle, 'output');
    const target = lift(edge.target, edge.targetHandle, 'input');
    return source.id === edge.source &&
      source.handle === edge.sourceHandle &&
      target.id === edge.target &&
      target.handle === edge.targetHandle
      ? edge
      : {
          ...edge,
          source: source.id,
          sourceHandle: source.handle,
          target: target.id,
          targetHandle: target.handle,
        };
  });
  const result = { edges: projected, paramsByNodeId };
  const byEdges = surfaces.get(nodes) ?? new WeakMap<Edge[], CrossingSurface>();
  byEdges.set(edges, result);
  surfaces.set(nodes, byEdges);
  return result;
}
