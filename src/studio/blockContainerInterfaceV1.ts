import {
  blockGraphSubtreeNodeIdsV2,
  blockGraphParentIdsV2,
  normalizeBlockContainerInterfaceV1,
  type BlockContainerInterfaceV1,
  type BlockControlV2,
  type BlockGraphNodeV2,
  type BlockGraphV2,
  type BlockInstanceV2,
  type BlockJsonValue,
  type BlockPortV2,
} from './blockSchemaV2';
import { hashString } from './stableHash';

function record(value: unknown): value is Record<string, BlockJsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function blockContainerFieldV1(node: BlockGraphNodeV2 | undefined, fieldId: string) {
  const params = node?.data.params;
  const field = record(params) ? params[fieldId] : undefined;
  return record(field) ? field : undefined;
}

export function blockContainerPortIdV1(direction: 'input' | 'output', nodeId: string, fieldId: string) {
  return `${direction}:${hashString(`${nodeId}\0${fieldId}`)}`;
}

export function blockContainerControlIdV1(nodeId: string, fieldId: string) {
  return `control:${hashString(`${nodeId}\0${fieldId}`)}`;
}

export function blockContainerPortTargetsV1(port: BlockPortV2) {
  return [port.binding, ...(port.mirrorBindings ?? [])];
}

export function blockContainerControlTargetsV1(control: Pick<BlockControlV2, 'binding' | 'mirrorBindings'>) {
  return [control.binding, ...(control.mirrorBindings ?? [])];
}

/** A legacy derived surface becomes durable only at an explicit interface/wiring edit. */
export function blockContainerInterfaceV1(
  instance: BlockInstanceV2,
  ownerNodeId: string,
  options: { ignoreDeclared?: boolean; includeEffectiveEdges?: boolean; includeCrossings?: boolean } = {},
): BlockContainerInterfaceV1 {
  const owner = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === ownerNodeId);
  if (!owner) throw new Error(`This internal Block no longer exists: ${ownerNodeId}.`);
  if (owner.containerInterface && !options.ignoreDeclared)
    return normalizeBlockContainerInterfaceV1(owner.containerInterface, instance.effectiveGraph, ownerNodeId);
  const included = blockGraphSubtreeNodeIdsV2(instance.effectiveGraph, ownerNodeId);
  const nodesById = new Map(instance.effectiveGraph.nodes.map((node) => [node.nodeId, node]));
  // A whole registered Block nested inside a generic host retains its public
  // interface on that wrapper. Descendant views must inherit that nearest
  // local surface too, not only the outermost instance's public controls.
  const parents = blockGraphParentIdsV2(instance.effectiveGraph);
  const inheritedSurfaces: Array<Pick<BlockContainerInterfaceV1, 'boundary' | 'controls'>> = [];
  let ancestorId = parents.get(ownerNodeId);
  while (ancestorId) {
    const declaration = nodesById.get(ancestorId)?.containerInterface;
    if (declaration) inheritedSurfaces.push(declaration);
    ancestorId = parents.get(ancestorId);
  }
  inheritedSurfaces.push(instance.effectiveInterface);
  const inputs: BlockPortV2[] = [];
  const outputs: BlockPortV2[] = [];
  const add = (direction: 'input' | 'output', nodeId: string, fieldId: string, preferred?: BlockPortV2) => {
    if (!included.has(nodeId)) return;
    const field = blockContainerFieldV1(nodesById.get(nodeId), fieldId);
    if (!field || (direction === 'output') !== (field.display === 'output')) return;
    const ports = direction === 'input' ? inputs : outputs;
    if (
      ports.some((port) =>
        blockContainerPortTargetsV1(port).some(
          (binding) => binding.nodeId === nodeId && binding.fieldOrPortId === fieldId,
        ),
      )
    )
      return;
    const valueType =
      typeof field.type === 'string'
        ? field.type
        : Array.isArray(field.type)
          ? field.type.filter((type) => typeof type === 'string').join('|')
          : 'any';
    ports.push({
      portId: blockContainerPortIdV1(direction, nodeId, fieldId),
      label: preferred?.label ?? (typeof field.label === 'string' ? field.label : fieldId.replace(/_/gu, ' ')),
      valueType: preferred?.valueType ?? valueType,
      required: preferred?.required ?? field.required === true,
      binding: { nodeId, fieldOrPortId: fieldId },
    });
  };
  for (const surface of inheritedSurfaces) {
    for (const port of surface.boundary.inputs) {
      // A public fan-out is one logical socket, including on a descendant
      // view. Restrict its targets to this subtree without splitting it into
      // a separate identically-labelled socket for every implementation step.
      const targets = blockContainerPortTargetsV1(port).filter(
        (binding) =>
          included.has(binding.nodeId) &&
          !inputs.some((existing) =>
            blockContainerPortTargetsV1(existing).some(
              (other) => other.nodeId === binding.nodeId && other.fieldOrPortId === binding.fieldOrPortId,
            ),
          ),
      );
      if (!targets.length) continue;
      const first = targets[0]!;
      add('input', first.nodeId, first.fieldOrPortId, port);
      const added = inputs.find(
        (candidate) =>
          candidate.binding.nodeId === first.nodeId && candidate.binding.fieldOrPortId === first.fieldOrPortId,
      );
      if (added && targets.length > 1) added.mirrorBindings = structuredClone(targets.slice(1));
      if (added && port.multiple !== undefined) added.multiple = port.multiple;
    }
    for (const port of surface.boundary.outputs) add('output', port.binding.nodeId, port.binding.fieldOrPortId, port);
  }
  for (const edge of options.includeCrossings === false
    ? []
    : [
        ...instance.definitionSnapshot.graph.edges,
        ...(options.includeEffectiveEdges === false ? [] : instance.effectiveGraph.edges),
      ]) {
    if (!included.has(edge.sourceNodeId)) add('input', edge.targetNodeId, edge.targetPortId);
    if (!included.has(edge.targetNodeId)) add('output', edge.sourceNodeId, edge.sourcePortId);
  }
  for (const [fieldId, field] of Object.entries(record(owner.data.params) ? owner.data.params : {})) {
    if (!record(field)) continue;
    if (field.display === 'output') add('output', ownerNodeId, fieldId);
    else if (field.display === 'input' || field.isInput) add('input', ownerNodeId, fieldId);
  }
  for (const ports of [inputs, outputs]) {
    const repeated = new Set(
      ports
        .filter((port, index) => ports.some((other, otherIndex) => otherIndex !== index && other.label === port.label))
        .map(({ label }) => label),
    );
    for (const port of ports) {
      if (repeated.has(port.label)) port.label = `${port.label} · ${port.binding.nodeId}`;
    }
  }
  const controls: BlockContainerInterfaceV1['controls'] = [];
  const controlled = new Set<string>();
  for (const control of inheritedSurfaces.flatMap((surface) => surface.controls)) {
    const targets = blockContainerControlTargetsV1(control).filter(
      ({ nodeId, fieldId }) => included.has(nodeId) && !controlled.has(`${nodeId}\0${fieldId}`),
    );
    if (!targets.length) continue;
    const view: BlockControlV2 = structuredClone(control);
    delete view.defaultValue;
    delete view.mirrorBindings;
    controls.push({
      ...view,
      ...(controls.some(({ controlId }) => controlId === view.controlId)
        ? { controlId: blockContainerControlIdV1(targets[0]!.nodeId, targets[0]!.fieldId) }
        : {}),
      binding: targets[0]!,
      ...(targets.length > 1 ? { mirrorBindings: targets.slice(1) } : {}),
      order: controls.length,
    });
    targets.forEach(({ nodeId, fieldId }) => controlled.add(`${nodeId}\0${fieldId}`));
  }
  for (const [fieldId, field] of Object.entries(record(owner.data.params) ? owner.data.params : {})) {
    if (
      !record(field) ||
      field.hidden ||
      field.display === 'output' ||
      field.display === 'input' ||
      field.display === 'ui_button' ||
      field.display === 'ui_image' ||
      field.display === 'ui_text' ||
      typeof field.type !== 'string' ||
      controlled.has(`${ownerNodeId}\0${fieldId}`)
    )
      continue;
    controls.push({
      controlId: blockContainerControlIdV1(ownerNodeId, fieldId),
      label: typeof field.label === 'string' ? field.label : fieldId.replace(/_/gu, ' '),
      valueType: field.type,
      binding: { nodeId: ownerNodeId, fieldId },
      order: controls.length,
      ...(field.disabled === true ? { sealed: true } : {}),
    });
  }
  return normalizeBlockContainerInterfaceV1(
    { schemaVersion: 1, boundary: { mode: 'explicit', inputs, outputs }, controls },
    instance.effectiveGraph,
    ownerNodeId,
  );
}

/** Exact field values; local interfaces never supply independent defaults. */
export function blockContainerFieldValueV1(
  instance: BlockInstanceV2,
  nodeId: string,
  fieldId: string,
): BlockJsonValue | undefined {
  for (const control of instance.effectiveInterface.controls) {
    if (
      blockContainerControlTargetsV1(control).some(
        (binding) => binding.nodeId === nodeId && binding.fieldId === fieldId,
      )
    ) {
      if (hasOwn(instance.values, control.controlId)) return instance.values[control.controlId];
      if (hasOwn(control, 'defaultValue')) return control.defaultValue;
    }
  }
  for (const port of instance.effectiveInterface.boundary.inputs) {
    if (
      hasOwn(instance.values, port.portId) &&
      blockContainerPortTargetsV1(port).some(
        (binding) => binding.nodeId === nodeId && binding.fieldOrPortId === fieldId,
      )
    )
      return instance.values[port.portId];
  }
  const field = blockContainerFieldV1(
    instance.effectiveGraph.nodes.find((node) => node.nodeId === nodeId),
    fieldId,
  );
  return field && (hasOwn(field, 'value') ? field.value : field.default);
}

/** Preserve newly introduced crossing sockets without manufacturing or restoring any wire. */
export function retainBlockContainerCrossingsV1(instance: BlockInstanceV2, graph: BlockGraphV2): BlockGraphV2 {
  const key = (edge: BlockGraphV2['edges'][number]) =>
    `${edge.sourceNodeId}\0${edge.sourcePortId}\0${edge.targetNodeId}\0${edge.targetPortId}`;
  const beforeKeys = new Set(instance.effectiveGraph.edges.map(key));
  const afterKeys = new Set(graph.edges.map(key));
  const changes = [
    ...instance.effectiveGraph.edges.filter((edge) => !afterKeys.has(key(edge))),
    ...graph.edges.filter((edge) => !beforeKeys.has(key(edge))),
  ];
  if (!changes.length) return graph;
  const next = structuredClone(graph);
  // The union captures a just-disconnected socket too; derivation only retains
  // endpoints whose own node/field survives in the candidate graph.
  const surfaceInstance = {
    ...instance,
    effectiveGraph: { ...next, edges: [...instance.effectiveGraph.edges, ...graph.edges] },
  };
  for (const node of next.nodes) {
    const included = blockGraphSubtreeNodeIdsV2(next, node.nodeId);
    if (included.size < 2 && !node.containerInterface) continue;
    const needed = changes.flatMap((edge) => {
      const sourceInside = included.has(edge.sourceNodeId);
      const targetInside = included.has(edge.targetNodeId);
      return [
        ...(targetInside && (!sourceInside || edge.targetNodeId === node.nodeId)
          ? [{ direction: 'input' as const, nodeId: edge.targetNodeId, fieldId: edge.targetPortId }]
          : []),
        ...(sourceInside && (!targetInside || edge.sourceNodeId === node.nodeId)
          ? [{ direction: 'output' as const, nodeId: edge.sourceNodeId, fieldId: edge.sourcePortId }]
          : []),
      ];
    });
    if (!needed.length) continue;
    const current =
      node.containerInterface ??
      blockContainerInterfaceV1(surfaceInstance, node.nodeId, { includeEffectiveEdges: false });
    const derived = blockContainerInterfaceV1(surfaceInstance, node.nodeId, { ignoreDeclared: true });
    let declaration = node.containerInterface ? structuredClone(current) : null;
    for (const endpoint of needed) {
      const side = endpoint.direction === 'input' ? 'inputs' : 'outputs';
      const matches = (port: BlockPortV2) =>
        blockContainerPortTargetsV1(port).some(
          (binding) => binding.nodeId === endpoint.nodeId && binding.fieldOrPortId === endpoint.fieldId,
        );
      if ((declaration ?? current).boundary[side].some(matches)) continue;
      const added = derived.boundary[side].find(matches);
      if (!added) continue;
      if (!declaration) declaration = structuredClone(derived);
      else declaration.boundary[side].push(structuredClone(added));
    }
    if (declaration) node.containerInterface = declaration;
  }
  return next;
}

/** Rebase bindings together with their semantic nodes on adoption/replacement. */
export function remapBlockContainerInterfaceV1(
  value: BlockContainerInterfaceV1,
  nodeIds: ReadonlyMap<string, string>,
): BlockContainerInterfaceV1 {
  const mapBinding = <T extends { nodeId: string }>(binding: T): T => ({
    ...binding,
    nodeId: nodeIds.get(binding.nodeId) ?? binding.nodeId,
  });
  const mapEntry = <
    T extends {
      binding: { nodeId: string };
      mirrorBindings?: { nodeId: string; fieldId?: string; fieldOrPortId?: string }[];
    },
  >(
    entry: T,
  ): T => ({
    ...structuredClone(entry),
    binding: mapBinding(entry.binding),
    ...(entry.mirrorBindings
      ? {
          mirrorBindings: entry.mirrorBindings.map(mapBinding).sort((a, b) => {
            const left = `${a.nodeId}\0${a.fieldId ?? a.fieldOrPortId}`;
            const right = `${b.nodeId}\0${b.fieldId ?? b.fieldOrPortId}`;
            return left < right ? -1 : left > right ? 1 : 0;
          }),
        }
      : {}),
  });
  return {
    schemaVersion: 1,
    boundary: {
      mode: 'explicit',
      inputs: value.boundary.inputs.map(mapEntry),
      outputs: value.boundary.outputs.map(mapEntry),
    },
    controls: value.controls.map(mapEntry),
    ...(value.previews ? { previews: value.previews.map(mapBinding) } : {}),
  };
}
