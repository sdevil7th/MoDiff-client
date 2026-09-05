import type { BlockBoundaryV2, BlockControlV2, BlockInstanceV2, BlockPortV2 } from './blockSchemaV2';
import { blockModularParentIdsV2 } from './blockRuntimeV2';

export type BlockInterfaceDraftV2 = { boundary: BlockBoundaryV2; controls: BlockControlV2[] };

/** Scope changes exposure through the owning Block, not its execution authority. */
export function blockInterfaceScopeNodeIdsV2(instance: BlockInstanceV2, subtreeId?: string): Set<string> {
  if (!subtreeId) return new Set(instance.effectiveGraph.nodes.map(({ nodeId }) => nodeId));
  if (!instance.effectiveGraph.nodes.some((node) => node.nodeId === subtreeId))
    throw new Error('This internal Block no longer exists. Reopen Configure Interface.');
  const parents = blockModularParentIdsV2(instance);
  const included = new Set([subtreeId]);
  for (const node of instance.effectiveGraph.nodes) {
    let parent = parents.get(node.nodeId);
    while (parent) {
      if (parent === subtreeId) included.add(node.nodeId);
      parent = parents.get(parent);
    }
  }
  return included;
}

function isScoped(entry: BlockPortV2 | BlockControlV2, included: ReadonlySet<string>) {
  return [entry.binding, ...(entry.mirrorBindings ?? [])].every(({ nodeId }) => included.has(nodeId));
}

export function blockInterfaceDraftV2(instance: BlockInstanceV2, subtreeId?: string): BlockInterfaceDraftV2 {
  const included = blockInterfaceScopeNodeIdsV2(instance, subtreeId);
  return structuredClone({
    boundary: {
      mode: 'explicit',
      inputs: instance.effectiveInterface.boundary.inputs.filter((port) => isScoped(port, included)),
      outputs: instance.effectiveInterface.boundary.outputs.filter((port) => isScoped(port, included)),
    },
    controls: instance.effectiveInterface.controls.filter((control) => isScoped(control, included)),
  });
}

/** Merge only fully owned entries. Shared mirror consumers require the root editor. */
export function mergeBlockInterfaceDraftV2(
  snapshot: BlockInstanceV2,
  current: BlockInstanceV2,
  draft: BlockInterfaceDraftV2,
  subtreeId?: string,
): BlockInterfaceDraftV2 {
  for (const key of ['instanceId', 'definitionRef', 'effectiveGraph', 'effectiveInterface', 'values'] as const) {
    if (JSON.stringify(snapshot[key]) !== JSON.stringify(current[key]))
      throw new Error('This Block changed while Configure Interface was open. Reopen it before applying.');
  }
  const included = blockInterfaceScopeNodeIdsV2(current, subtreeId);
  const merge = <T extends BlockPortV2 | BlockControlV2>(original: T[], edited: T[], id: (value: T) => string) => {
    const protectedIds = new Set(original.filter((entry) => !isScoped(entry, included)).map(id));
    if (edited.some((entry) => !isScoped(entry, included) || protectedIds.has(id(entry))))
      throw new Error('This interface change would affect another branch. Use the owning Block interface editor.');
    if (new Set(edited.map(id)).size !== edited.length) throw new Error('Interface entries must have unique IDs.');
    let nextIndex = 0;
    const merged = original.flatMap((entry) => {
      if (!isScoped(entry, included)) return [entry];
      return nextIndex < edited.length ? [edited[nextIndex++]!] : [];
    });
    return [...merged, ...edited.slice(nextIndex)];
  };
  return {
    boundary: {
      mode: 'explicit',
      inputs: merge(current.effectiveInterface.boundary.inputs, draft.boundary.inputs, (port) => port.portId),
      outputs: merge(current.effectiveInterface.boundary.outputs, draft.boundary.outputs, (port) => port.portId),
    },
    controls: merge(current.effectiveInterface.controls, draft.controls, (control) => control.controlId).map(
      (control, order) => ({ ...control, order }),
    ),
  };
}

/** Exposing a previously edited field must not reset it to an empty value. */
export function blockInterfaceFieldValueV2(instance: BlockInstanceV2, nodeId: string, fieldId: string) {
  for (const control of instance.effectiveInterface.controls) {
    if ([control.binding, ...(control.mirrorBindings ?? [])].some((b) => b.nodeId === nodeId && b.fieldId === fieldId))
      return Object.prototype.hasOwnProperty.call(instance.values, control.controlId)
        ? instance.values[control.controlId]
        : control.defaultValue;
  }
  for (const port of instance.effectiveInterface.boundary.inputs) {
    if (
      [port.binding, ...(port.mirrorBindings ?? [])].some((b) => b.nodeId === nodeId && b.fieldOrPortId === fieldId) &&
      Object.prototype.hasOwnProperty.call(instance.values, port.portId)
    )
      return instance.values[port.portId];
  }
  const params = instance.effectiveGraph.nodes.find((node) => node.nodeId === nodeId)?.data.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const field = params[fieldId];
  if (!field || typeof field !== 'object' || Array.isArray(field)) return undefined;
  return Object.prototype.hasOwnProperty.call(field, 'value') ? field.value : field.default;
}
