import { deepEqual } from '../utils/deepEqual';
import { blockDefinitionContentHashV2, createBlockInstanceV2, normalizeBlockInstanceV2 } from './blockSchemaV2';
import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { UserBlockDefinition } from './types';
import { blockConnectorParamsV2, blockControlParamsV2, canonicalizePersistedBlockGraphV2 } from './blockRuntimeV2';
import { createUserBlockFromSelection, createUserBlockNode, type BlockSelectionResult } from './userBlocks';
import { prepareLegacyBlockMovementV2 } from './legacyBlockMovementV2';

/** Prepare the native dialog from canonical roots, retaining nested effective content. */
export function createUserBlockDraftV2(
  graph: { nodes: CustomNodeType[]; edges: Edge[] },
  blocks: UserBlockDefinition[],
) {
  const canonical = canonicalizePersistedBlockGraphV2(graph.nodes, graph.edges);
  const selected = new Set(graph.nodes.filter((node) => node.selected).map((node) => node.id));
  const nodes = canonical.nodes.map((source) => {
    const node = { ...source, selected: selected.has(source.id) };
    const instance = node.data.blockInstanceV2;
    if (!instance || !node.selected) return node;
    const sockets = blockConnectorParamsV2(instance);
    return {
      ...node,
      data: { ...node.data, params: { ...blockControlParamsV2(instance), ...sockets.inputs, ...sockets.outputs } },
    };
  });
  return createUserBlockFromSelection({ nodes, edges: canonical.edges }, undefined, blocks);
}

/** The creation preview never writes stores or reusable definitions. */
export function prepareUserBlockCreationV2(
  result: Extract<BlockSelectionResult, { ok: true }>,
  block: UserBlockDefinition,
) {
  const node = createUserBlockNode(block, result.blockNode.position, result.blockNode.id);
  const graph = prepareLegacyBlockMovementV2(
    result.nodes.map((item) => (item.id === node.id ? node : item)),
    result.edges,
    [node.id],
    null,
  );
  const id = graph.remapped.get(node.id) ?? node.id;
  const root = graph.nodes.find((item) => item.id === id);
  if (!root?.data.blockInstanceV2) throw new Error('The selected graph could not be represented as a Block.');
  let instance = root.data.blockInstanceV2;
  if (
    !deepEqual(block.inputs, result.block.inputs) ||
    !deepEqual(block.outputs, result.block.outputs) ||
    !deepEqual(block.exposedParams, result.block.exposedParams)
  ) {
    // Choosing an interface in the dialog makes it a deliberate contract.
    const definition = structuredClone(instance.definitionSnapshot);
    definition.boundary.mode = 'explicit';
    delete definition.boundary.derivation;
    definition.contentHash = blockDefinitionContentHashV2(definition);
    instance = normalizeBlockInstanceV2({
      ...createBlockInstanceV2(definition, {
        instanceId: instance.instanceId,
        position: instance.presentation.position,
        size: instance.presentation.size,
        values: instance.values,
      }),
      presentation: instance.presentation,
      previewStates: instance.previewStates,
    });
  }
  return {
    graph: {
      nodes: graph.nodes.map((node) =>
        node.id === root.id ? { ...node, data: { ...node.data, blockInstanceV2: instance } } : node,
      ),
      edges: graph.edges,
    },
    definition: instance.definitionSnapshot,
  };
}
