import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import { deepEqual } from '../utils/deepEqual';
import { blockContainerFieldValueV1 } from '../studio/blockContainerInterfaceV1';
import {
  blockConnectionTargetsV2,
  blockCrossingParamV2,
  parseBlockCrossingHandleV2,
} from '../studio/blockCrossingConnectionsV2';
import { blockValueTypesAreCompatibleV2 } from '../studio/blockValueTypeCompatibilityV2';
import {
  runtimeNodeType,
  addBlockEffectiveGraphNodeV2,
  createBlockRootNodeV2,
  replaceBlockEffectiveGraphNodeV2,
  replaceBlockEffectiveGraphV2,
} from '../studio/blockRuntimeV2';
import { remapOperationAuthoring } from './operationSharedInputs';
import {
  operationAuthoring,
  operationScope,
  planOperationChange,
  type OperationChangePlan,
  type OperationGraph,
  type OperationStarter,
} from './operationAuthoring';

/** Preview against current instance values; commit still belongs to the canvas transaction. */
export function planBlockOperationChange(
  graph: OperationGraph,
  blockId: string,
  loaderId: string,
  starter: OperationStarter,
): OperationChangePlan {
  const root = graph.nodes.find((node) => node.id === blockId);
  const original = root?.data.blockInstanceV2;
  if (!root || !original) throw new Error('The owning Block is no longer available.');
  if (original.previewStates.some((state) => state.status === 'running' || state.status === 'queued'))
    throw new Error('Wait for this Block to finish before changing its model or task.');
  const internal: OperationGraph = {
    nodes: original.effectiveGraph.nodes.map((node): CustomNodeType => {
      const data = structuredClone(node.data) as NodeData;
      data.params = Object.fromEntries(
        Object.entries(data.params ?? {}).map(([field, param]) => [
          field,
          { ...param, value: blockContainerFieldValueV1(original, node.nodeId, field) },
        ]),
      );
      return {
        id: node.nodeId,
        type: runtimeNodeType(node),
        data,
        position: original.presentation.internalLayout[node.nodeId] ?? { x: 0, y: 0 },
      };
    }),
    edges: original.effectiveGraph.edges.map((edge) => ({
      id: edge.edgeId,
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePortId,
      target: edge.targetNodeId,
      targetHandle: edge.targetPortId,
    })),
  };
  const scope = new Set(operationScope(internal, loaderId).map((node) => node.id));
  if (original.effectiveGraph.nodes.some((node) => scope.has(node.nodeId) && node.modularDiffusers))
    throw new Error('Edit this Modular composition through its Block interface before changing its operation graph.');
  const plan = planOperationChange(internal, loaderId, starter);
  // Canvas node replacements get new IDs. Internal implementations keep their
  // semantic roles so public ports, previews, layouts and crossing sockets survive.
  const semanticIds = new Map(Object.entries(plan.replacements).map(([oldId, newId]) => [newId, oldId]));
  const semanticId = (id: string) => semanticIds.get(id) ?? id;
  const planned = plan.graph.nodes.map((node) => {
    const hint = remapOperationAuthoring(node.data.operationAuthoring, semanticId);
    return { ...node, id: semanticId(node.id), data: { ...node.data, ...(hint ? { operationAuthoring: hint } : {}) } };
  });
  const edges = plan.graph.edges.map((edge) => ({
    edgeId: edge.id,
    sourceNodeId: semanticId(edge.source),
    sourcePortId: edge.sourceHandle!,
    targetNodeId: semanticId(edge.target),
    targetPortId: edge.targetHandle!,
  }));
  for (const wire of graph.edges.filter((edge) => edge.target === blockId)) {
    for (const target of blockConnectionTargetsV2(root, wire.targetHandle ?? '', 'input')) {
      if (!scope.has(target.nodeId)) continue;
      const supplies = (edge: (typeof edges)[number]) =>
        edge.targetNodeId === target.nodeId && edge.targetPortId === target.fieldOrPortId;
      if (edges.some(supplies) && !original.effectiveGraph.edges.some(supplies))
        throw new Error(
          `The new task adds an internal connection to externally connected ${target.fieldOrPortId}. Review that connection before retrying.`,
        );
      const members = (nodes: CustomNodeType[]) => {
        const owner = nodes.find((node) => node.id === target.nodeId);
        const hint = (owner ? operationAuthoring(owner) : null)?.sharedInputs?.find(
          (binding) => binding.field === target.fieldOrPortId,
        );
        return nodes
          .flatMap(
            (node) =>
              operationAuthoring(node)
                ?.sharedInputs?.filter(
                  (binding) => hint && binding.loaderId === hint.loaderId && binding.groupId === hint.groupId,
                )
                .map((binding) => `${node.id}:${binding.field}`) ?? [],
          )
          .sort();
      };
      if (!deepEqual(members(internal.nodes), members(planned)))
        throw new Error(
          `The shared ${target.fieldOrPortId} connections change. Review the externally connected group before retrying.`,
        );
    }
  }
  // Temporarily detach reviewed internal connections before replacing field
  // contracts. Each replacement still validates every public/nested binding.
  let instance = replaceBlockEffectiveGraphV2(original, {
    ...original.effectiveGraph,
    edges: original.effectiveGraph.edges.filter(
      (edge) => !scope.has(edge.sourceNodeId) && !scope.has(edge.targetNodeId),
    ),
  });
  const parentNodeId = original.effectiveGraph.nodes.find((node) => node.nodeId === loaderId)?.parentNodeId;
  for (const node of planned) {
    const previous = original.effectiveGraph.nodes.find((candidate) => candidate.nodeId === node.id);
    if (previous && !scope.has(node.id)) continue;
    const replacement = {
      ...(previous ?? {}),
      nodeId: node.id,
      nodeType: node.type ?? 'custom',
      data: JSON.parse(JSON.stringify(node.data)),
      ...(!previous && parentNodeId ? { parentNodeId } : {}),
    };
    try {
      instance = previous
        ? replaceBlockEffectiveGraphNodeV2(instance, node.id, replacement)
        : addBlockEffectiveGraphNodeV2(instance, replacement, {
            layout: { ...node.position, width: 360, height: 400 },
          });
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} Review Configure Interface before retrying.`,
      );
    }
  }
  instance = replaceBlockEffectiveGraphV2(instance, { ...instance.effectiveGraph, edges });
  for (const node of planned.filter(
    (node) => scope.has(node.id) || !internal.nodes.some((old) => old.id === node.id),
  )) {
    for (const [field, param] of Object.entries(node.data.params)) {
      if (param.display === 'output') continue;
      if (
        !deepEqual(
          blockContainerFieldValueV1(instance, node.id, field),
          Object.prototype.hasOwnProperty.call(param, 'value') ? param.value : param.default,
        )
      )
        throw new Error(
          `The Block control for ${node.data.label}.${field} overrides the replacement value. Review Configure Interface before retrying.`,
        );
    }
  }
  // A crossing socket is a durable interface too. Reject incompatible changes
  // instead of leaving a wire whose type now means something different.
  for (const edge of graph.edges) {
    for (const [id, handle] of [
      [edge.source, edge.sourceHandle],
      [edge.target, edge.targetHandle],
    ]) {
      if (id !== blockId) continue;
      const endpoint = parseBlockCrossingHandleV2(handle);
      if (!endpoint) continue;
      const before = blockCrossingParamV2(original, endpoint);
      const after = blockCrossingParamV2(instance, endpoint);
      if (!blockValueTypesAreCompatibleV2(before.type, after.type))
        throw new Error(
          `The connected Block field ${endpoint.fieldOrPortId} changes type. Reconnect it before retrying.`,
        );
    }
  }
  const next = createBlockRootNodeV2(instance);
  return {
    ...plan,
    graph: {
      nodes: graph.nodes.map((node) =>
        node.id === blockId ? { ...node, data: { ...node.data, ...next.data } } : node,
      ),
      edges: graph.edges,
    },
    changes: [
      ...plan.changes,
      'Update this Block instance; keep its saved definition, public interface and other instances.',
    ],
  };
}
