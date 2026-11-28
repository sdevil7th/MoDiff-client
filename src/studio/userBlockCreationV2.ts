import { deepEqual } from '../utils/deepEqual';
import { blockDefinitionContentHashV2, createBlockInstanceV2, normalizeBlockInstanceV2 } from './blockSchemaV2';
import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { UserBlockDefinition } from './types';
import { blockConnectorParamsV2, blockControlParamsV2, canonicalizePersistedBlockGraphV2 } from './blockRuntimeV2';
import { createUserBlockFromSelection, createUserBlockNode, type BlockSelectionResult } from './userBlocks';
import { prepareLegacyBlockMovementV2 } from './legacyBlockMovementCoreV2';

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

/** New authoring defaults only. Existing Block definitions own their published interface. */
export function suggestNewBlockInterface(result: Extract<BlockSelectionResult, { ok: true }>) {
  const connectedInputs = new Set(
    result.edges.filter((edge) => edge.target === result.blockNode.id).map((edge) => edge.targetHandle),
  );
  const connectedOutputs = new Set(
    result.edges.filter((edge) => edge.source === result.blockNode.id).map((edge) => edge.sourceHandle),
  );
  const nodes = new Map((result.block.nodes as CustomNodeType[]).map((node) => [node.id, node]));
  const usedOutputs = new Set(
    (result.block.edges as Edge[]).map((edge) => JSON.stringify([edge.source, edge.sourceHandle])),
  );
  const suggestedPorts = (direction: 'inputs' | 'outputs', connected: typeof connectedInputs) => {
    const ports = result.block[direction];
    const pinned = ports.filter(
      (port) =>
        connected.has(port.id) ||
        (direction === 'inputs' && nodes.get(port.nodeId)?.data.params[port.paramKey]?.required),
    );
    if (connected.size) return new Set(pinned.map((port) => port.id));

    // For a self-contained selection, offer open media and terminal results first.
    // Intermediate model components and diagnostics remain available in Customize.
    const available = ports.filter(
      (port) =>
        (direction === 'inputs' || !usedOutputs.has(JSON.stringify([port.nodeId, port.paramKey]))) &&
        !/^(?:doc|route state(?: in| out)?|latent binding)$/iu.test(
          port.label.split(' / ').pop()?.replace(/_/gu, ' ') ?? '',
        ),
    );
    const primary = available.filter((port) =>
      (Array.isArray(port.type) ? port.type : [port.type]).some(
        (type) => type && /^(?:images?|audio|video|mask|frames|text|string|str|file|filepath|data)$/iu.test(type),
      ),
    );
    const suggested = primary.length
      ? primary
      : available.length === 1 || direction === 'outputs'
        ? available.slice(0, 1)
        : [];
    return new Set([...pinned, ...suggested].map((port) => port.id));
  };
  const mainControls =
    /^(?:prompt|negative prompt|strength|denoise strength|seed|steps|guidance(?: scale)?|width|height|frames|frame rate|fps|file(?: name)?|image|video|audio|text|value)$/iu;
  const selected = new Set(
    result.block.exposedParams
      .filter((control) => {
        const label = control.label.split(' / ').pop()?.replace(/_/gu, ' ');
        const field = control.paramKey?.replace(/_/gu, ' ');
        return mainControls.test(label ?? '') || mainControls.test(field ?? '');
      })
      .map((control) => control.id),
  );
  return {
    connectedInputs,
    connectedOutputs,
    exposedInputIds: suggestedPorts('inputs', connectedInputs),
    exposedOutputIds: suggestedPorts('outputs', connectedOutputs),
    exposedParamIds: selected,
  };
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
    // The legacy conversion derives every available port. Apply the author's chosen V2 interface afterwards.
    const inputs = new Set(block.inputs.map((port) => port.id));
    const outputs = new Set(block.outputs.map((port) => port.id));
    for (const edge of result.edges) {
      if (
        (edge.target === result.blockNode.id && edge.targetHandle && !inputs.has(edge.targetHandle)) ||
        (edge.source === result.blockNode.id && edge.sourceHandle && !outputs.has(edge.sourceHandle))
      )
        throw new Error('Keep externally connected ports in the Block interface.');
    }
    definition.boundary.inputs = definition.boundary.inputs.filter((port) => inputs.has(port.portId));
    definition.boundary.outputs = definition.boundary.outputs.filter((port) => outputs.has(port.portId));
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
