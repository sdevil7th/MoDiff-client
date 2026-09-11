import {
  blockDefinitionContentHashV2,
  blockGraphHashV2,
  canonicalBlockStringifyV2,
  createBlockInstanceV2,
  blockInstancePreviewBindingsV2,
  normalizeBlockDefinitionV2,
  normalizeBlockInstanceV2,
  type BlockDefinitionV2,
  type BlockInstanceV2,
  type BlockPreviewStateV2,
  type BlockSourceV2,
} from './blockSchemaV2';
import { blockInputPortBindingsV2, blockModularParentIdsV2 } from './blockRuntimeV2';
import {
  blockContainerFieldV1,
  blockContainerFieldValueV1,
  blockContainerInterfaceV1,
} from './blockContainerInterfaceV1';

export type ReusableBlockDefinitionChoiceV2 = 'new' | 'update';

/**
 * Materialize one selected Modular Diffusers placement and every descendant
 * placement as an independent, top-level User Node definition. This is a
 * semantic copy: it never embeds another Block/Cluster instance. Crossing
 * edges are omitted; only deliberately declared sockets are reusable.
 */
export function reusableBlockDefinitionFromSubtreeV2(
  instanceValue: BlockInstanceV2,
  { rootNodeId, definitionId, displayName }: { rootNodeId: string; definitionId: string; displayName: string },
): BlockDefinitionV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const rootNode = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === rootNodeId);
  if (!rootNode) throw new Error('The selected subtree is no longer present in this Block.');
  const parents = blockModularParentIdsV2(instance);
  const included = new Set<string>([rootNodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    parents.forEach((parentId, nodeId) => {
      if (included.has(parentId) && !included.has(nodeId)) {
        included.add(nodeId);
        changed = true;
      }
    });
  }
  const nodes = structuredClone(instance.effectiveGraph.nodes.filter(({ nodeId }) => included.has(nodeId)));
  // Bake workflow-owned values into the copied fields, including controls
  // deliberately hidden from the selected container's public interface.
  nodes.forEach((node) => {
    if (node.parentNodeId && !included.has(node.parentNodeId)) delete node.parentNodeId;
    const params = node.data.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return;
    Object.keys(params).forEach((fieldId) => {
      const field = blockContainerFieldV1(node, fieldId);
      const value = blockContainerFieldValueV1(instance, node.nodeId, fieldId);
      if (field && value !== undefined) field.value = structuredClone(value);
    });
  });
  const internalEdges = instance.effectiveGraph.edges.filter(
    ({ sourceNodeId, targetNodeId }) => included.has(sourceNodeId) && included.has(targetNodeId),
  );
  const withoutGraphHash = {
    nodes,
    edges: internalEdges,
    ...(instance.effectiveGraph.executionOrder
      ? { executionOrder: instance.effectiveGraph.executionOrder.filter((nodeId) => included.has(nodeId)) }
      : {}),
  };
  const graph = { ...withoutGraphHash, graphHash: blockGraphHashV2(withoutGraphHash) };

  const inputPorts = instance.effectiveInterface.boundary.inputs.flatMap((port) => {
    const targets = blockInputPortBindingsV2(port).filter(({ nodeId }) => included.has(nodeId));
    if (!targets.length) return [];
    // Rebuild fan-out from the retained targets. Spreading the source port
    // without clearing its mirrors leaves references outside the saved graph
    // when only one target survives this subtree boundary.
    const retainedPort = { ...port };
    delete retainedPort.mirrorBindings;
    return [
      { ...retainedPort, binding: targets[0]!, ...(targets.length > 1 ? { mirrorBindings: targets.slice(1) } : {}) },
    ];
  });
  const outputPorts = instance.effectiveInterface.boundary.outputs.filter(({ binding }) =>
    included.has(binding.nodeId),
  );
  const controls = instance.effectiveInterface.controls.flatMap((control) => {
    const targets = [control.binding, ...(control.mirrorBindings ?? [])].filter(({ nodeId }) => included.has(nodeId));
    if (!targets.length) return [];
    const retainedControl = { ...control };
    delete retainedControl.mirrorBindings;
    return [
      {
        ...retainedControl,
        binding: targets[0]!,
        ...(targets.length > 1 ? { mirrorBindings: targets.slice(1) } : {}),
        ...(hasOwn(instance.values, control.controlId) ? { defaultValue: instance.values[control.controlId] } : {}),
      },
    ];
  });
  const controlIds = new Set(controls.map(({ controlId }) => controlId));
  inputPorts.forEach((port, order) => {
    if (!hasOwn(instance.values, port.portId) || controlIds.has(port.portId)) return;
    controls.push({
      controlId: port.portId,
      label: port.label,
      binding: { nodeId: port.binding.nodeId, fieldId: port.binding.fieldOrPortId },
      ...(port.mirrorBindings?.length
        ? {
            mirrorBindings: port.mirrorBindings.map(({ nodeId, fieldOrPortId }) => ({
              nodeId,
              fieldId: fieldOrPortId,
            })),
          }
        : {}),
      valueType: port.valueType,
      defaultValue: instance.values[port.portId],
      required: port.required,
      order: controls.length + order,
    });
    controlIds.add(port.portId);
  });

  const current = instance.definitionSnapshot;
  const local =
    rootNode.containerInterface ??
    (rootNode.modularDiffusers?.kind === 'upstream_block'
      ? undefined
      : blockContainerInterfaceV1(instance, rootNodeId, { includeCrossings: false }));
  const savedControls = local
    ? local.controls.map((control) => {
        const value = blockContainerFieldValueV1(instance, control.binding.nodeId, control.binding.fieldId);
        return { ...control, ...(value === undefined ? {} : { defaultValue: value }) };
      })
    : controls;
  const savedControlIds = new Set(savedControls.map(({ controlId }) => controlId));
  const withoutHash: Omit<BlockDefinitionV2, 'contentHash'> = {
    schemaVersion: 2,
    definitionId,
    displayName,
    description: `${rootNode.modularDiffusers?.blockClass ?? rootNode.data.label ?? rootNode.nodeId} subtree saved from ${current.displayName}.`,
    source: userSourceWithDirectParent(current),
    graph,
    boundary: local ? structuredClone(local.boundary) : { mode: 'explicit', inputs: inputPorts, outputs: outputPorts },
    // Filtering a subtree can leave gaps in the source control order. Keep
    // relative order, but give the independent definition a contiguous order.
    controls: savedControls.map((control, order) => ({ ...control, order })),
    ...(current.suggestedInputs
      ? {
          suggestedInputs: current.suggestedInputs
            .map((suggestion) => ({
              ...suggestion,
              values: Object.fromEntries(
                Object.entries(suggestion.values).filter(([controlId]) => savedControlIds.has(controlId)),
              ),
            }))
            .filter((suggestion) => Object.keys(suggestion.values).length),
        }
      : {}),
    previews: local?.previews ?? current.previews.filter(({ nodeId }) => included.has(nodeId)),
    ownership: { kind: 'user', definitionMutable: true },
  };
  return normalizeBlockDefinitionV2({ ...withoutHash, contentHash: blockDefinitionContentHashV2(withoutHash) });
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function blockDefinitionIsUserOwnedV2(definitionValue: BlockDefinitionV2) {
  const definition = normalizeBlockDefinitionV2(definitionValue);
  return (
    (definition.source.kind === 'user' || definition.source.kind === 'hub_import') &&
    definition.ownership.kind === 'user' &&
    definition.ownership.definitionMutable
  );
}

function userSourceWithDirectParent(definition: BlockDefinitionV2): BlockSourceV2 {
  const source = definition.source;
  return {
    kind: 'user',
    ...(source.provider ? { provider: source.provider } : {}),
    ...(source.library ? { library: source.library } : {}),
    ...(source.libraryRevision ? { libraryRevision: source.libraryRevision } : {}),
    ...(source.pipelineClass ? { pipelineClass: source.pipelineClass } : {}),
    ...(source.blocksClass ? { blocksClass: source.blocksClass } : {}),
    ...(source.workflow ? { workflow: source.workflow } : {}),
    ...(source.manifestDefinitionId ? { manifestDefinitionId: source.manifestDefinitionId } : {}),
    ...(source.manifestContentHash ? { manifestContentHash: source.manifestContentHash } : {}),
    ...(source.executionAdmissionId ? { executionAdmissionId: source.executionAdmissionId } : {}),
    ...(source.repository ? { repository: source.repository } : {}),
    ...(source.repositoryRevision ? { repositoryRevision: source.repositoryRevision } : {}),
    parent: {
      definitionId: definition.definitionId,
      contentHash: definition.contentHash,
      sourceKind: definition.source.kind,
    },
  };
}

/**
 * Build the exact reusable definition represented by one workflow instance.
 *
 * The effective graph becomes the reusable graph, the already-declared public
 * interface is preserved explicitly, and explicit instance values become
 * reusable defaults where the definition declares a control. BlockPortV2 has
 * no default field, so a valued boundary-only input fails closed instead of
 * producing a reusable definition that would reset on its next insertion.
 * Preview media/task state is intentionally excluded; preview bindings remain
 * part of the definition.
 */
export function reusableBlockDefinitionFromInstanceV2(
  instanceValue: BlockInstanceV2,
  {
    choice,
    definitionId,
    displayName,
  }: {
    choice: ReusableBlockDefinitionChoiceV2;
    definitionId: string;
    displayName: string;
  },
): BlockDefinitionV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const current = instance.definitionSnapshot;
  if (choice === 'update' && !blockDefinitionIsUserOwnedV2(current)) {
    throw new Error('Only a mutable user-owned Block V2 definition can be updated.');
  }

  const effectiveInterface = instance.effectiveInterface;
  const controlIds = new Set(effectiveInterface.controls.map(({ controlId }) => controlId));
  const boundaryOnlyValues = effectiveInterface.boundary.inputs
    .map(({ portId }) => portId)
    .filter((portId) => hasOwn(instance.values, portId) && !controlIds.has(portId));
  if (boundaryOnlyValues.length) {
    throw new Error(
      `Cannot save reusable Block V2 defaults for boundary-only input(s): ${boundaryOnlyValues.join(', ')}. ` +
        'Expose each input as a declared control or keep the changes only in this workflow.',
    );
  }

  const controls = effectiveInterface.controls.map((control) =>
    hasOwn(instance.values, control.controlId)
      ? { ...control, defaultValue: instance.values[control.controlId] }
      : control,
  );
  const withoutHash: Omit<BlockDefinitionV2, 'contentHash'> = {
    schemaVersion: 2,
    definitionId,
    displayName,
    ...(current.description ? { description: current.description } : {}),
    source: choice === 'new' ? userSourceWithDirectParent(current) : current.source,
    graph: instance.effectiveGraph,
    boundary: {
      mode: 'explicit',
      inputs: effectiveInterface.boundary.inputs,
      outputs: effectiveInterface.boundary.outputs,
    },
    controls,
    ...(current.suggestedInputs
      ? {
          suggestedInputs: current.suggestedInputs
            .map((suggestion) => ({
              ...suggestion,
              values: Object.fromEntries(
                Object.entries(suggestion.values).filter(([controlId]) => controlIds.has(controlId)),
              ),
            }))
            .filter((suggestion) => Object.keys(suggestion.values).length > 0),
        }
      : {}),
    previews: current.previews.filter((binding) =>
      instance.effectiveGraph.nodes.some((node) => node.nodeId === binding.nodeId),
    ),
    ownership: { kind: 'user', definitionMutable: true },
  };
  return normalizeBlockDefinitionV2({
    ...withoutHash,
    contentHash: blockDefinitionContentHashV2(withoutHash),
  });
}

function previewStateForDefinition(
  states: BlockPreviewStateV2[],
  binding: BlockDefinitionV2['previews'][number],
): BlockPreviewStateV2 {
  const exact = states.find(
    (state) =>
      state.binding.nodeId === binding.nodeId &&
      state.binding.outputPortId === binding.outputPortId &&
      state.binding.mediaType === binding.mediaType &&
      Boolean(state.binding.primary) === Boolean(binding.primary),
  );
  return exact ? { ...exact, binding } : { binding, status: 'idle' };
}

/** Repoint only one workflow insertion after its reusable definition saved. */
export function rebaseBlockInstanceV2ToDefinition(
  instanceValue: BlockInstanceV2,
  definitionValue: BlockDefinitionV2,
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const definition = normalizeBlockDefinitionV2(definitionValue);
  if (!blockDefinitionIsUserOwnedV2(definition)) {
    throw new Error('A workflow instance can only be rebased to a mutable user-owned Block V2 definition.');
  }
  if (definition.graph.graphHash !== instance.effectiveGraph.graphHash) {
    throw new Error('The saved Block V2 definition does not match the instance effective graph.');
  }
  if (
    canonicalBlockStringifyV2(definition.boundary.inputs) !==
      canonicalBlockStringifyV2(instance.effectiveInterface.boundary.inputs) ||
    canonicalBlockStringifyV2(definition.boundary.outputs) !==
      canonicalBlockStringifyV2(instance.effectiveInterface.boundary.outputs) ||
    canonicalBlockStringifyV2(definition.controls) !==
      canonicalBlockStringifyV2(
        instance.effectiveInterface.controls.map((control) =>
          hasOwn(instance.values, control.controlId)
            ? { ...control, defaultValue: instance.values[control.controlId] }
            : control,
        ),
      )
  ) {
    throw new Error('The saved Block V2 definition does not preserve the instance public interface.');
  }

  const rebased = createBlockInstanceV2(definition, {
    instanceId: instance.instanceId,
    position: instance.presentation.position,
    size: instance.presentation.size,
    values: instance.values,
    internalLayout: instance.presentation.internalLayout,
  });
  return normalizeBlockInstanceV2({
    ...rebased,
    presentation: instance.presentation,
    previewStates: blockInstancePreviewBindingsV2(definition, definition.graph).map((binding) =>
      previewStateForDefinition(instance.previewStates, binding),
    ),
    // Reusable-definition identity changed. Reviewed execution, Auto, and
    // publication authority must be recalculated independently.
    authorities: [],
  });
}

/** Semantic race signature; presentation/preview progress may change safely. */
export function blockDefinitionPersistenceSignatureV2(instanceValue: BlockInstanceV2) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  return canonicalBlockStringifyV2({
    definitionRef: instance.definitionRef,
    definitionSnapshot: instance.definitionSnapshot,
    effectiveGraph: instance.effectiveGraph,
    effectiveInterface: instance.effectiveInterface,
    values: instance.values,
    customization: instance.customization,
  });
}
