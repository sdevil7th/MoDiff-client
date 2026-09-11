import { applyEdgeChanges, type Connection, type Edge, type EdgeChange } from '@xyflow/react';
import { nanoid } from 'nanoid';
import {
  assertBlockCrossingConnectionV2,
  blockConnectionTargetsV2,
  blockCrossingParamV2,
  canonicalBlockCrossingConnectionsV2,
  parseBlockCrossingHandleV2,
} from '../studio/blockCrossingConnectionsV2';

import {
  blockV2ConnectionScopeIsAllowed,
  isBlockRootV2Node,
  nodeConnectorParam,
  nodeConnectorParams,
} from '../studio/nodeConnectorResolution';
import {
  assertBlockInternalConnectionV2,
  createBlockRootNodeV2,
  materializeBlockProjectionV2,
  replaceBlockEffectiveGraphV2,
} from '../studio/blockRuntimeV2';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { decorateConnectionEdge, decorateConnectionEdges } from '../theme/connectionTypes';
import type { CustomConnection, CustomNodeType, FlowStore } from './useFlowStore';

type FlowStoreSet = (
  partial: Partial<FlowStore> | FlowStore | ((state: FlowStore) => Partial<FlowStore> | FlowStore),
) => void;

type FlowStoreGet = () => FlowStore;

function connectionParam(nodes: CustomNodeType[], node: CustomNodeType | undefined, handle: string | null | undefined) {
  const endpoint = parseBlockCrossingHandleV2(handle);
  const instance =
    node?.data.blockInstanceV2 ??
    nodes.find(({ id }) => id === node?.data.blockProjectionOwnerId)?.data.blockInstanceV2;
  return endpoint && instance ? blockCrossingParamV2(instance, endpoint) : nodeConnectorParam(node, handle);
}

function blockOwner(node: CustomNodeType) {
  return node.data.blockInstanceV2 ? node.id : node.data.blockProjectionOwnerId;
}

function isCrossingGesture(source: CustomNodeType, target: CustomNodeType, connection: Connection) {
  return (
    blockOwner(source) !== blockOwner(target) &&
    Boolean(
      source.data.blockProjectionOwnerId ||
      target.data.blockProjectionOwnerId ||
      parseBlockCrossingHandleV2(connection.sourceHandle) ||
      parseBlockCrossingHandleV2(connection.targetHandle),
    )
  );
}

function commitCrossingGraph(connection: Connection, nodes: CustomNodeType[], edges: Edge[], replaced?: Edge) {
  const connections = canonicalBlockCrossingConnectionsV2(connection, nodes);
  const replacedIds = new Set([
    ...(replaced ? [replaced.id] : []),
    ...edges
      .filter((edge) =>
        connections.some((conn) => edge.target === conn.target && edge.targetHandle === conn.targetHandle),
      )
      .map(({ id }) => id),
  ]);
  for (const conn of connections) assertBlockCrossingConnectionV2(conn, nodes, edges, replacedIds);
  const added = connections.map((conn, index) =>
    decorateConnectionEdge(
      {
        id: index === 0 && replaced ? replaced.id : `edge-${nanoid()}`,
        type: replaced?.type ?? 'default',
        ...conn,
      },
      nodes,
    ),
  );
  return { nodes, edges: [...edges.filter(({ id }) => !replacedIds.has(id)), ...added] };
}

function assertNoPublicBlockDriver(
  ownerId: string,
  target: { nodeId: string; fieldOrPortId: string },
  get: () => Pick<FlowStore, 'nodes' | 'edges'>,
) {
  const instance = get().nodes.find((node) => node.id === ownerId)?.data.blockInstanceV2;
  if (!instance) return;
  if (
    get().edges.some(
      (edge) =>
        edge.target === ownerId &&
        edge.targetHandle &&
        parseBlockCrossingHandleV2(edge.targetHandle)?.nodeId === target.nodeId &&
        parseBlockCrossingHandleV2(edge.targetHandle)?.fieldOrPortId === target.fieldOrPortId,
    )
  )
    throw new Error('This internal input already has an outside connection. Disconnect that wire first.');
  const portIds = new Set(
    instance.effectiveInterface.boundary.inputs
      .filter((port) =>
        [port.binding, ...(port.mirrorBindings ?? [])].some(
          (binding) => binding.nodeId === target.nodeId && binding.fieldOrPortId === target.fieldOrPortId,
        ),
      )
      .map((port) => port.portId),
  );
  if (get().edges.some((edge) => edge.target === ownerId && portIds.has(edge.targetHandle ?? '')))
    throw new Error(
      'This internal input is driven by a connected public Block input. Disconnect that public link before adding an internal driver.',
    );
}

function assertPublicBlockConnection(conn: Connection, get: FlowStoreGet, replacedEdgeId?: string) {
  const instance = get().nodes.find((node) => node.id === conn.target)?.data.blockInstanceV2;
  const port = instance?.effectiveInterface.boundary.inputs.find((entry) => entry.portId === conn.targetHandle);
  if (!instance || !port) return;
  const targets = [port.binding, ...(port.mirrorBindings ?? [])];
  for (const target of targets) {
    if (
      get().edges.some(
        (edge) =>
          edge.id !== replacedEdgeId &&
          edge.target === instance.instanceId &&
          edge.targetHandle &&
          parseBlockCrossingHandleV2(edge.targetHandle) &&
          blockConnectionTargetsV2(
            get().nodes.find(({ id }) => id === instance.instanceId)!,
            edge.targetHandle,
            'input',
          ).some((binding) => binding.nodeId === target.nodeId && binding.fieldOrPortId === target.fieldOrPortId),
      )
    )
      throw new Error('An outside connection already drives this internal field. Disconnect that wire first.');
    if (
      instance.effectiveGraph.edges.some(
        (edge) => edge.targetNodeId === target.nodeId && edge.targetPortId === target.fieldOrPortId,
      )
    )
      throw new Error(
        'This Block input already has an internal driver. Expand the Block and disconnect that link before connecting its public input.',
      );
    const sealed = [
      ...instance.effectiveInterface.controls,
      ...instance.effectiveGraph.nodes.flatMap((node) => node.containerInterface?.controls ?? []),
    ].find(
      (control) =>
        control.sealed &&
        [control.binding, ...(control.mirrorBindings ?? [])].some(
          (binding) => binding.nodeId === target.nodeId && binding.fieldId === target.fieldOrPortId,
        ),
    );
    if (sealed)
      throw new Error(
        `Cannot wire sealed Block control "${sealed.label}". Use its reviewed selector or replace the owning node explicitly.`,
      );
    const aliases = new Set(
      instance.effectiveInterface.boundary.inputs
        .filter(
          (other) =>
            other.portId !== port.portId &&
            [other.binding, ...(other.mirrorBindings ?? [])].some(
              (binding) => binding.nodeId === target.nodeId && binding.fieldOrPortId === target.fieldOrPortId,
            ),
        )
        .map((other) => other.portId),
    );
    if (
      get().edges.some(
        (edge) =>
          edge.id !== replacedEdgeId && edge.target === instance.instanceId && aliases.has(edge.targetHandle ?? ''),
      )
    )
      throw new Error(
        'Another public Block input already drives this field. Disconnect its link before connecting this alias.',
      );
  }
}

function toArray<T>(value: T | T[]) {
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function projectUpdatedBlockV2(
  ownerId: string,
  nextInstance: NonNullable<CustomNodeType['data']['blockInstanceV2']>,
  get: () => Pick<FlowStore, 'nodes' | 'edges'>,
) {
  const currentRoot = get().nodes.find((node) => node.id === ownerId);
  if (!currentRoot?.data.blockInstanceV2) return null;
  const projection = materializeBlockProjectionV2(
    createBlockRootNodeV2(nextInstance, { selected: currentRoot.selected }),
  );
  const [canonicalRoot, ...children] = projection.nodes;
  if (!canonicalRoot) return null;
  const root = {
    ...canonicalRoot,
    ...(currentRoot.selected === undefined ? {} : { selected: currentRoot.selected }),
    ...(currentRoot.zIndex === undefined ? {} : { zIndex: currentRoot.zIndex }),
  };
  const nodes = get().nodes.flatMap((node) => {
    if (node.id === ownerId) return [root, ...children];
    if (node.data.blockProjectionOwnerId === ownerId) return [];
    return [node];
  });
  const retainedEdges = get().edges.filter((edge) => {
    const data = isRecord(edge.data) ? edge.data : {};
    return data.blockProjectionOwnerId !== ownerId;
  });
  return { nodes, edges: decorateConnectionEdges(nodes, [...retainedEdges, ...projection.edges]) };
}

/** Pure, atomic internal wiring shared by native gestures and reviewed Fix actions. */
export function connectBlockInternalGraphV2(conn: CustomConnection, nodes: CustomNodeType[], edges: Edge[]) {
  const get = () => ({ nodes, edges });
  const sourceNode = nodes.find((node) => node.id === conn.source);
  const targetNode = nodes.find((node) => node.id === conn.target);
  if (!sourceNode || !targetNode) return null;
  const ownerId = blockOwner(sourceNode);
  const sourceEndpoint = conn.sourceHandle
    ? blockConnectionTargetsV2(sourceNode, conn.sourceHandle, 'output')[0]
    : null;
  const targetEndpoints = conn.targetHandle ? blockConnectionTargetsV2(targetNode, conn.targetHandle, 'input') : [];
  if (
    !ownerId ||
    blockOwner(targetNode) !== ownerId ||
    !sourceEndpoint ||
    !targetEndpoints.length ||
    !conn.sourceHandle ||
    !conn.targetHandle
  )
    return null;
  const root = get().nodes.find((node) => node.id === ownerId);
  if (!root?.data.blockInstanceV2) return null;
  const effectiveGraph = root.data.blockInstanceV2.effectiveGraph;
  const replacements = targetEndpoints.map((targetEndpoint) => {
    assertNoPublicBlockDriver(ownerId, targetEndpoint, get);
    assertBlockInternalConnectionV2(root.data.blockInstanceV2!, sourceEndpoint, targetEndpoint);
    const writers = effectiveGraph.edges.filter(
      (edge) => edge.targetNodeId === targetEndpoint.nodeId && edge.targetPortId === targetEndpoint.fieldOrPortId,
    );
    if (writers.length > 1)
      throw new Error(
        'Cannot replace this Block connection: the internal input has multiple writers. Disconnect the conflicting edges first.',
      );
    return {
      edgeId: writers[0]?.edgeId ?? `workflow-edge-${nanoid()}`,
      sourceNodeId: sourceEndpoint.nodeId,
      sourcePortId: sourceEndpoint.fieldOrPortId,
      targetNodeId: targetEndpoint.nodeId,
      targetPortId: targetEndpoint.fieldOrPortId,
    };
  });
  if (
    replacements.every((replacement) =>
      effectiveGraph.edges.some(
        (edge) =>
          edge.edgeId === replacement.edgeId &&
          edge.sourceNodeId === replacement.sourceNodeId &&
          edge.sourcePortId === replacement.sourcePortId,
      ),
    )
  )
    return { nodes, edges };
  const replacementById = new Map(replacements.map((edge) => [edge.edgeId, edge]));
  const existingIds = new Set(effectiveGraph.edges.map(({ edgeId }) => edgeId));
  // A visible leaf and its ancestor boundary are aliases of one semantic
  // socket. Validate the complete replacement before committing anything;
  // removing a canvas edge first can also remove the very alias being used.
  const nextInstance = replaceBlockEffectiveGraphV2(root.data.blockInstanceV2, {
    ...effectiveGraph,
    edges: [
      ...effectiveGraph.edges.map((edge) => replacementById.get(edge.edgeId) ?? edge),
      ...replacements.filter(({ edgeId }) => !existingIds.has(edgeId)),
    ],
  });
  return projectUpdatedBlockV2(ownerId, nextInstance, get);
}

export function removeBlockInternalGraphEdgesV2(removedEdges: Edge[], nodes: CustomNodeType[], edges: Edge[]) {
  let graph = { nodes, edges };
  const get = () => graph;
  const byOwner = new Map<string, Set<string>>();
  removedEdges.forEach((edge) => {
    const data = isRecord(edge.data) ? edge.data : {};
    if (
      data.blockProjectionKind !== 'internal' ||
      typeof data.blockProjectionOwnerId !== 'string' ||
      typeof data.blockProjectionEdgeId !== 'string'
    )
      return;
    const ids = byOwner.get(data.blockProjectionOwnerId) ?? new Set<string>();
    ids.add(data.blockProjectionEdgeId);
    if (Array.isArray(data.blockProjectionEdgeIds))
      data.blockProjectionEdgeIds.forEach((id) => {
        if (typeof id === 'string') ids.add(id);
      });
    byOwner.set(data.blockProjectionOwnerId, ids);
  });
  byOwner.forEach((edgeIds, ownerId) => {
    const root = get().nodes.find((node) => node.id === ownerId);
    if (!root?.data.blockInstanceV2) return;
    const effectiveGraph = root.data.blockInstanceV2.effectiveGraph;
    const nextInstance = replaceBlockEffectiveGraphV2(root.data.blockInstanceV2, {
      ...effectiveGraph,
      edges: effectiveGraph.edges.filter((edge) => !edgeIds.has(edge.edgeId)),
    });
    const projected = projectUpdatedBlockV2(ownerId, nextInstance, get);
    if (projected) graph = projected;
  });
  return graph;
}

function removeSpawnedField(get: FlowStoreGet, set: FlowStoreSet, targetNodeId: string, targetHandle: string) {
  if (isBlockRootV2Node(get().nodes.find((node) => node.id === targetNodeId))) return;
  set({
    nodes: get().nodes.map((node) =>
      node.id === targetNodeId
        ? {
            ...node,
            data: {
              ...node.data,
              params: Object.fromEntries(Object.entries(node.data.params).filter(([key]) => key !== targetHandle)),
            },
          }
        : node,
    ),
  });
}

export function handleEdgesChange(changes: EdgeChange<Edge>[], set: FlowStoreSet, get: FlowStoreGet) {
  const removedEdges: Edge[] = [];

  changes
    .filter((change) => change.type === 'remove')
    .forEach((change) => {
      const edge = get().edges.find((item) => item.id === change.id);
      if (edge) {
        removedEdges.push(edge);
      }

      if (!edge?.targetHandle) {
        return;
      }

      const node = get().nodes.find((item) => item.id === edge.target);
      if (!node) {
        return;
      }

      const targetParam = nodeConnectorParam(node, edge.targetHandle);
      if (!isBlockRootV2Node(node) && targetParam?.isInput) {
        get().setParam(node.id, edge.targetHandle, false, 'isInput');
      }

      if (!isBlockRootV2Node(node) && targetParam?.spawn) {
        removeSpawnedField(get, set, edge.target, edge.targetHandle);
      }
    });

  set(removeBlockInternalGraphEdgesV2(removedEdges, get().nodes, get().edges));

  const newEdges = decorateConnectionEdges(get().nodes, applyEdgeChanges(changes, get().edges));
  set({ edges: newEdges });

  if (removedEdges.length > 0) {
    get().updateHandleConnectionStatus();
    get().updateSignalValues(removedEdges);
  }
}

function buildEdgeFromConnection(conn: CustomConnection, get: FlowStoreGet) {
  return decorateConnectionEdge(
    {
      ...conn,
      id: nanoid(),
      type: conn.edgeType || 'default',
    },
    get().nodes,
  );
}

function updateSpawnReplacement(conn: CustomConnection, edgeToUpdate: Edge, get: FlowStoreGet, set: FlowStoreSet) {
  const updatedEdge = decorateConnectionEdge(
    {
      ...edgeToUpdate,
      source: conn.source,
      sourceHandle: conn.sourceHandle,
    },
    get().nodes,
  );

  set({ edges: get().edges.map((edge) => (edge.id === edgeToUpdate.id ? updatedEdge : edge)) });
  get().updateHandleConnectionStatus();
  get().updateSignalValues(updatedEdge);
}

function appendConnection(conn: CustomConnection, get: FlowStoreGet, set: FlowStoreSet) {
  const newEdge = buildEdgeFromConnection(conn, get);
  maybeAddSpawnField(conn, get, set);

  set({ edges: [...get().edges, newEdge] });
  get().updateHandleConnectionStatus();
  get().updateSignalValues(newEdge);
}

function maybeAddSpawnField(conn: CustomConnection, get: FlowStoreGet, set: FlowStoreSet) {
  if (!conn.targetHandle) {
    return;
  }

  const targetNode = get().nodes.find((node) => node.id === conn.target);
  if (isBlockRootV2Node(targetNode)) {
    return;
  }
  const isSpawn = get().getParam(conn.target, conn.targetHandle, 'spawn');
  if (!targetNode || !isSpawn) {
    return;
  }

  const keyBaseName = conn.targetHandle.split('>>>')[0] ?? conn.targetHandle;
  const spawnFields = Object.keys(targetNode.data.params).filter((key) => key.startsWith(keyBaseName));
  if (spawnFields.length > 63) {
    return;
  }

  const nodeParams = targetNode.data.params[conn.targetHandle];
  if (!nodeParams) {
    return;
  }

  const newKeyName = `${keyBaseName}>>>${nanoid(6)}`;
  const paramsForSpawn = {
    ...nodeParams,
    label: nodeParams.label || keyBaseName.charAt(0).toUpperCase() + keyBaseName.slice(1),
  };
  const newParams: typeof targetNode.data.params = {};

  Object.entries(targetNode.data.params).forEach(([key, value]) => {
    newParams[key] = value;
    if (key === conn.targetHandle) {
      newParams[newKeyName] = paramsForSpawn;
    }
  });

  set({
    nodes: get().nodes.map((node) =>
      node.id === targetNode.id ? { ...node, data: { ...node.data, params: newParams } } : node,
    ),
  });
}

export function handleConnect(conn: CustomConnection, set: FlowStoreSet, get: FlowStoreGet) {
  if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) {
    return;
  }

  const sourceNode = get().nodes.find((node) => node.id === conn.source);
  const targetNode = get().nodes.find((node) => node.id === conn.target);
  const sourceParam = connectionParam(get().nodes, sourceNode, conn.sourceHandle);
  const targetParam = connectionParam(get().nodes, targetNode, conn.targetHandle);
  if (
    !sourceNode ||
    !targetNode ||
    !sourceParam ||
    !targetParam ||
    sourceParam.display !== 'output' ||
    (targetParam.display !== 'input' && !targetParam.isInput) ||
    !connectionTypesAreCompatible(sourceParam.type, targetParam.type) ||
    !blockV2ConnectionScopeIsAllowed(get().nodes, conn.source, conn.target)
  ) {
    return;
  }

  if (isCrossingGesture(sourceNode, targetNode, conn)) {
    set(commitCrossingGraph(conn, get().nodes, get().edges));
    get().updateHandleConnectionStatus();
    return;
  }
  if (sourceNode.data.blockProjectionOwnerId || targetNode.data.blockProjectionOwnerId) {
    const graph = connectBlockInternalGraphV2(conn, get().nodes, get().edges);
    if (graph) {
      set(graph);
      get().updateHandleConnectionStatus();
    }
    return;
  }

  assertPublicBlockConnection(conn, get);

  const edgesToRemove = get().edges.filter(
    (edge) => edge.target === conn.target && edge.targetHandle === conn.targetHandle,
  );
  const isReplace = edgesToRemove.length > 0;

  if (isReplace) {
    const isSpawn = get().getParam(conn.target, conn.targetHandle, 'spawn');
    if (isSpawn) {
      const edgeToUpdate = edgesToRemove[0];
      if (!edgeToUpdate) {
        return;
      }

      updateSpawnReplacement(conn, edgeToUpdate, get, set);
      return;
    }

    handleEdgesChange(
      edgesToRemove.map((edge) => ({ id: edge.id, type: 'remove' })),
      set,
      get,
    );
    appendConnection(conn, get, set);
    return;
  }

  appendConnection(conn, get, set);
}

/** Atomically reconnect an existing edge, including durable V2 internals. */
export function handleReconnect(oldEdge: Edge, conn: Connection, set: FlowStoreSet, get: FlowStoreGet) {
  const currentEdge = get().edges.find((edge) => edge.id === oldEdge.id);
  if (!currentEdge) throw new Error(`Cannot reconnect unknown edge "${oldEdge.id}".`);
  // Do not trust captured projection metadata after collapse, Undo or reflow.
  oldEdge = currentEdge;
  if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle)
    throw new Error('Cannot reconnect an edge without complete source and target handles.');
  const sourceNode = get().nodes.find((node) => node.id === conn.source);
  const targetNode = get().nodes.find((node) => node.id === conn.target);
  const sourceParam = connectionParam(get().nodes, sourceNode, conn.sourceHandle);
  const targetParam = connectionParam(get().nodes, targetNode, conn.targetHandle);
  if (
    !sourceNode ||
    !targetNode ||
    !sourceParam ||
    !targetParam ||
    sourceParam.display !== 'output' ||
    (targetParam.display !== 'input' && !targetParam.isInput) ||
    !connectionTypesAreCompatible(sourceParam.type, targetParam.type) ||
    !blockV2ConnectionScopeIsAllowed(get().nodes, conn.source, conn.target)
  )
    throw new Error(
      'Cannot reconnect this edge: the selected handles are missing, incompatible, or cross a Block boundary.',
    );

  const oldData = isRecord(oldEdge.data) ? oldEdge.data : {};
  if (isCrossingGesture(sourceNode, targetNode, conn)) {
    const graph = removeBlockInternalGraphEdgesV2([oldEdge], get().nodes, get().edges);
    set(commitCrossingGraph(conn, graph.nodes, graph.edges, oldEdge));
    get().updateHandleConnectionStatus();
    return;
  }
  const oldInternal =
    oldData.blockProjectionKind === 'internal' &&
    typeof oldData.blockProjectionOwnerId === 'string' &&
    typeof oldData.blockProjectionEdgeId === 'string';
  const newOwnerId = blockOwner(sourceNode);
  const sourceEndpoint = blockConnectionTargetsV2(sourceNode, conn.sourceHandle, 'output')[0];
  const targetEndpoints = blockConnectionTargetsV2(targetNode, conn.targetHandle, 'input');
  const newInternal = Boolean(
    newOwnerId && sourceEndpoint && blockOwner(targetNode) === newOwnerId && targetEndpoints.length,
  );
  if (newInternal && !oldInternal) {
    const remaining = get().edges.filter((edge) => edge.id !== oldEdge.id);
    const graph = connectBlockInternalGraphV2(conn, get().nodes, remaining);
    if (!graph) throw new Error('Cannot reconnect this internal input.');
    set(graph);
    get().updateHandleConnectionStatus();
    return;
  }
  if (oldInternal !== newInternal)
    throw new Error('Cannot reconnect an edge across a Block boundary. Use the Block public interface.');

  if (oldInternal) {
    const ownerId = oldData.blockProjectionOwnerId as string;
    if (newOwnerId !== ownerId) throw new Error('Cannot reconnect an internal edge into a different Block instance.');
    const root = get().nodes.find((node) => node.id === ownerId);
    if (!root?.data.blockInstanceV2) throw new Error(`Cannot reconnect edge: Block owner "${ownerId}" is invalid.`);
    const semanticIds = new Set([
      oldData.blockProjectionEdgeId as string,
      ...(Array.isArray(oldData.blockProjectionEdgeIds)
        ? oldData.blockProjectionEdgeIds.filter((id): id is string => typeof id === 'string')
        : []),
    ]);
    const graphEdges = root.data.blockInstanceV2.effectiveGraph.edges;
    const semantics = graphEdges.filter(({ edgeId }) => semanticIds.has(edgeId));
    if (semantics.length !== semanticIds.size) throw new Error('Cannot reconnect unknown Block V2 internal edge.');
    if (!sourceEndpoint || !targetEndpoints.length)
      throw new Error('Cannot reconnect this Block edge: the projected boundary handle is invalid.');
    targetEndpoints.forEach((targetEndpoint) => {
      assertNoPublicBlockDriver(ownerId, targetEndpoint, get);
      assertBlockInternalConnectionV2(root.data.blockInstanceV2!, sourceEndpoint, targetEndpoint);
      if (
        graphEdges.some(
          (edge) =>
            !semanticIds.has(edge.edgeId) &&
            edge.targetNodeId === targetEndpoint.nodeId &&
            edge.targetPortId === targetEndpoint.fieldOrPortId,
        )
      )
        throw new Error('Cannot reconnect this Block edge: the selected internal input already has a connection.');
    });
    const reservedIds = new Set<string>();
    const replacements = targetEndpoints.map((targetEndpoint) => {
      const previous = semantics.find(
        (edge) => edge.targetNodeId === targetEndpoint.nodeId && edge.targetPortId === targetEndpoint.fieldOrPortId,
      );
      if (previous) reservedIds.add(previous.edgeId);
      return {
        edgeId: previous?.edgeId ?? '',
        sourceNodeId: sourceEndpoint.nodeId,
        sourcePortId: sourceEndpoint.fieldOrPortId,
        targetNodeId: targetEndpoint.nodeId,
        targetPortId: targetEndpoint.fieldOrPortId,
      };
    });
    replacements.forEach((edge) => {
      if (edge.edgeId) return;
      edge.edgeId = semantics.find(({ edgeId }) => !reservedIds.has(edgeId))?.edgeId ?? `workflow-edge-${nanoid()}`;
      reservedIds.add(edge.edgeId);
    });
    if (
      replacements.length === semantics.length &&
      replacements.every((replacement) =>
        semantics.some(
          (edge) =>
            edge.edgeId === replacement.edgeId &&
            edge.sourceNodeId === replacement.sourceNodeId &&
            edge.sourcePortId === replacement.sourcePortId &&
            edge.targetNodeId === replacement.targetNodeId &&
            edge.targetPortId === replacement.targetPortId,
        ),
      )
    )
      return;
    const replacementById = new Map(replacements.map((edge) => [edge.edgeId, edge]));
    const nextInstance = replaceBlockEffectiveGraphV2(root.data.blockInstanceV2, {
      ...root.data.blockInstanceV2.effectiveGraph,
      edges: [
        ...graphEdges.flatMap((edge) =>
          semanticIds.has(edge.edgeId)
            ? replacementById.has(edge.edgeId)
              ? [replacementById.get(edge.edgeId)!]
              : []
            : [edge],
        ),
        ...replacements.filter(({ edgeId }) => !semanticIds.has(edgeId)),
      ],
    });
    const graph = projectUpdatedBlockV2(ownerId, nextInstance, get);
    if (!graph) throw new Error('Cannot reconnect this Block edge because projection failed.');
    set(graph);
    get().updateHandleConnectionStatus();
    return;
  }

  assertPublicBlockConnection(conn, get, oldEdge.id);
  if (
    get().edges.some(
      (edge) => edge.id !== oldEdge.id && edge.target === conn.target && edge.targetHandle === conn.targetHandle,
    )
  )
    throw new Error('Cannot reconnect this edge: the selected input already has a connection.');
  const replacement = decorateConnectionEdge({ ...oldEdge, ...conn, data: oldEdge.data }, get().nodes);
  set({ edges: get().edges.map((edge) => (edge.id === oldEdge.id ? replacement : edge)) });
  get().updateHandleConnectionStatus();
  get().updateSignalValues([oldEdge, replacement]);
}

export function updateSignalsForEdges(edges: Edge | Edge[], get: FlowStoreGet) {
  const edgesArray = toArray(edges);

  edgesArray.forEach((edge) => {
    const sourceHandle = edge.sourceHandle;
    const targetHandle = edge.targetHandle;
    if (!sourceHandle || !targetHandle) {
      return;
    }

    const sourceNode = get().nodes.find((node) => node.id === edge.source);
    const targetNode = get().nodes.find((node) => node.id === edge.target);
    if (!sourceNode || !targetNode) {
      return;
    }

    const sourceParam = nodeConnectorParam(sourceNode, sourceHandle);
    const targetParam = nodeConnectorParam(targetNode, targetHandle);
    const sourceSignal = sourceParam?.signal;
    const targetSignal = targetParam?.signal;

    if (sourceParam?.disabled || targetParam?.disabled) {
      return;
    }

    if (sourceSignal) {
      if (!sourceParam?.isConnected && !sourceSignal.origin) {
        get().setParam(edge.source, sourceHandle, { ...sourceSignal, value: undefined }, 'signal');
      }

      if (
        sourceParam?.isConnected &&
        sourceSignal.direction === 'output' &&
        !(targetSignal?.direction === 'input' && targetSignal.origin)
      ) {
        get().setParam(edge.target, targetHandle, { ...sourceSignal, origin: undefined }, 'signal');
      }
    }

    if (targetSignal) {
      if (!targetParam?.isConnected && !targetSignal.origin) {
        get().setParam(edge.target, targetHandle, { ...targetSignal, value: undefined }, 'signal');
      }

      if (
        targetParam?.isConnected &&
        targetSignal.direction === 'input' &&
        !(sourceSignal?.direction === 'output' && sourceSignal.origin)
      ) {
        get().setParam(edge.source, sourceHandle, { ...targetSignal, origin: undefined }, 'signal');
      }
    }
  });
}

export function reconcileGraphConnections(get: FlowStoreGet) {
  refreshHandleConnectionStatus(get);

  get().nodes.forEach((node) => {
    if (isBlockRootV2Node(node)) return;
    Object.entries(nodeConnectorParams(node)).forEach(([key, param]) => {
      if (param.isConnected || !param.signal || param.signal.origin) return;
      if (param.signal.value !== undefined) {
        get().setParam(node.id, key, { ...param.signal, value: undefined }, 'signal');
      }
    });
  });

  updateSignalsForEdges(get().edges, get);
}

export function refreshHandleConnectionStatus(get: FlowStoreGet) {
  const edges = get().edges;

  get().nodes.forEach((node) => {
    if (isBlockRootV2Node(node)) return;
    const params = nodeConnectorParams(node);
    Object.keys(params)
      .filter((key) => {
        const param = params[key];
        return param?.display === 'input' || param?.display === 'output';
      })
      .forEach((key) => {
        const param = params[key];
        if (!param) {
          return;
        }

        let isConnected = false;
        if (param.display === 'input') {
          isConnected = edges.some((edge) => edge.target === node.id && edge.targetHandle === key);
        } else if (param.display === 'output') {
          isConnected = edges.some((edge) => edge.source === node.id && edge.sourceHandle === key);
        }

        get().setParam(node.id, key, isConnected, 'isConnected');
      });
  });
}
