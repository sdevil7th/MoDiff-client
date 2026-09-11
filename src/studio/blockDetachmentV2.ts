import type { Edge } from '@xyflow/react';
import {
  blockGraphHashV2,
  blockInterfaceHashV2,
  blockInstancePreviewBindingsV2,
  normalizeBlockInstanceV2,
  type BlockBoundaryV2,
  type BlockControlV2,
  type BlockInstanceV2,
} from './blockSchemaV2';
import { blockCrossingHandleV2, blockConnectionTargetsV2 } from './blockCrossingConnectionsV2';
import type { CustomNodeType } from '../stores/useFlowStore';
import { parameterCustomizationState } from './blockRuntimeV2';

/** Moving a node also moves ownership of its controls and previews. The
 * original library snapshot remains intact; only this instance is edited. */
export function detachBlockGraphNodesV2(value: BlockInstanceV2, removed: ReadonlySet<string>): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(value);
  for (const id of removed)
    if (!instance.effectiveGraph.nodes.some((node) => node.nodeId === id))
      throw new Error(`Cannot move missing internal node ${id}.`);
  const retain = <T extends { binding: { nodeId: string }; mirrorBindings?: Array<{ nodeId: string }> }>(
    items: T[],
  ): T[] =>
    items.flatMap((item) => {
      const targets = [item.binding, ...(item.mirrorBindings ?? [])].filter((binding) => !removed.has(binding.nodeId));
      if (!targets.length) return [];
      const result = structuredClone(item);
      result.binding = targets[0]!;
      delete result.mirrorBindings;
      if (targets.length > 1) result.mirrorBindings = targets.slice(1);
      return [result];
    });
  const boundary = (value: BlockBoundaryV2): BlockBoundaryV2 => ({
    ...value,
    inputs: retain(value.inputs),
    outputs: retain(value.outputs),
  });
  const controls = (items: BlockControlV2[]) => retain(items).map((item, order) => ({ ...item, order }));
  const graph = {
    ...instance.effectiveGraph,
    nodes: instance.effectiveGraph.nodes
      .filter((node) => !removed.has(node.nodeId))
      .map((node) => {
        if (node.parentNodeId && removed.has(node.parentNodeId))
          throw new Error('Move the complete subtree, including its children.');
        const local = node.containerInterface;
        return local
          ? {
              ...node,
              containerInterface: {
                ...local,
                boundary: boundary(local.boundary),
                controls: controls(local.controls),
                ...(local.previews
                  ? { previews: local.previews.filter((preview) => !removed.has(preview.nodeId)) }
                  : {}),
              },
            }
          : node;
      }),
    edges: instance.effectiveGraph.edges.filter(
      (edge) => !removed.has(edge.sourceNodeId) && !removed.has(edge.targetNodeId),
    ),
    ...(instance.effectiveGraph.executionOrder
      ? { executionOrder: instance.effectiveGraph.executionOrder.filter((id) => !removed.has(id)) }
      : {}),
  };
  graph.graphHash = blockGraphHashV2(graph);
  const surface = {
    boundary: boundary(instance.effectiveInterface.boundary),
    controls: controls(instance.effectiveInterface.controls),
  };
  const valueIds = new Set([
    ...surface.boundary.inputs.map((port) => port.portId),
    ...surface.controls.map((control) => control.controlId),
  ]);
  const previews = blockInstancePreviewBindingsV2(instance.definitionSnapshot, graph);
  const next: BlockInstanceV2 = {
    ...instance,
    effectiveGraph: graph,
    effectiveInterface: {
      ...surface,
      baseInterfaceHash: instance.effectiveInterface.baseInterfaceHash,
      effectiveInterfaceHash: blockInterfaceHashV2(surface),
    },
    values: Object.fromEntries(Object.entries(instance.values).filter(([id]) => valueIds.has(id))),
    previewStates: instance.previewStates.filter((state) =>
      previews.some(
        (binding) => binding.nodeId === state.binding.nodeId && binding.outputPortId === state.binding.outputPortId,
      ),
    ),
    authorities: [],
    customization: { ...instance.customization, state: 'structure_changed', effectiveGraphHash: graph.graphHash },
    presentation: {
      ...instance.presentation,
      internalLayout: Object.fromEntries(
        Object.entries(instance.presentation.internalLayout).filter(([id]) => !removed.has(id)),
      ),
      ...(instance.presentation.collapsedContainerNodeIds
        ? {
            collapsedContainerNodeIds: instance.presentation.collapsedContainerNodeIds.filter((id) => !removed.has(id)),
          }
        : {}),
    },
  };
  next.customization.state = parameterCustomizationState(next);
  return normalizeBlockInstanceV2(next);
}

/** Split a public fan-out only when its consumers move to different owners. */
export function remapDetachedBlockEdgesV2(
  edges: Edge[],
  root: CustomNodeType,
  removed: ReadonlySet<string>,
  detachedId: string,
  asBlock: boolean,
): Edge[] {
  const endpoints = (id: string, handle: string | null | undefined, direction: 'input' | 'output') => {
    if (id !== root.id || !handle) return [{ id, handle }];
    const bindings = blockConnectionTargetsV2(root, handle, direction);
    if (!bindings.some((binding) => removed.has(binding.nodeId))) return [{ id, handle }];
    return bindings.map((binding) => ({
      id: removed.has(binding.nodeId) ? detachedId : root.id,
      handle:
        removed.has(binding.nodeId) && !asBlock
          ? binding.fieldOrPortId
          : blockCrossingHandleV2({ ...binding, direction }),
    }));
  };
  return edges.flatMap((edge) =>
    endpoints(edge.source, edge.sourceHandle, 'output').flatMap((source, sourceIndex) =>
      endpoints(edge.target, edge.targetHandle, 'input').map((target, targetIndex) => ({
        ...edge,
        id: sourceIndex || targetIndex ? `${edge.id}:moved:${sourceIndex}:${targetIndex}` : edge.id,
        source: source.id,
        sourceHandle: source.handle,
        target: target.id,
        targetHandle: target.handle,
      })),
    ),
  );
}
