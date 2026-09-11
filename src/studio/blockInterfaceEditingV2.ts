import type {
  BlockBoundaryV2,
  BlockControlV2,
  BlockInstanceV2,
  BlockPortV2,
  BlockPreviewBindingV2,
} from './blockSchemaV2';
import { blockModularParentIdsV2 } from './blockRuntimeV2';
import { normalizeBlockContainerInterfaceV1 } from './blockSchemaV2';
import { blockContainerInterfaceV1, blockContainerFieldValueV1 } from './blockContainerInterfaceV1';

export type BlockInterfaceDraftV2 = {
  boundary: BlockBoundaryV2;
  controls: BlockControlV2[];
  /** Local surfaces only. Omitted preserves bindings; an explicit [] clears them. */
  previews?: BlockPreviewBindingV2[];
};

/** Scope selects a durable internal surface within the same execution graph. */
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
  if (subtreeId) {
    const { boundary, controls, previews } = blockContainerInterfaceV1(instance, subtreeId);
    return structuredClone({ boundary, controls, previews: previews ?? [] });
  }
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
  if (subtreeId) {
    const previews = draft.previews ?? blockContainerInterfaceV1(current, subtreeId).previews;
    const {
      boundary,
      controls,
      previews: parsedPreviews,
    } = normalizeBlockContainerInterfaceV1(
      {
        schemaVersion: 1,
        boundary: draft.boundary,
        controls: draft.controls.map((control) => {
          const local = structuredClone(control);
          delete local.defaultValue;
          return local;
        }),
        ...(previews === undefined ? {} : { previews }),
      },
      current.effectiveGraph,
      subtreeId,
    );
    return { boundary, controls, ...(parsedPreviews === undefined ? {} : { previews: parsedPreviews }) };
  }
  if (draft.previews !== undefined)
    throw new Error('Root preview bindings belong to the Block definition, not its effective interface.');
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
  return blockContainerFieldValueV1(instance, nodeId, fieldId);
}
