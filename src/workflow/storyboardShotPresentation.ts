import type { OperationGraph } from './operationAuthoring';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { VisualOperationGroup } from './visualOperationGroupProjection';
import { createUserBlockDraftV2, prepareUserBlockCreationV2 } from '../studio/userBlockCreationV2';
import { replaceBlockEffectiveInterfaceV2, STORYBOARD_SHOT_PROVIDER } from '../studio/blockRuntimeV2';
import { blockDefinitionContentHashV2, normalizeBlockInstanceV2 } from '../studio/blockSchemaV2';

/** A disclosure container around existing stages, compiled by the ordinary V2 path. */
export function createStoryboardShotBlock(
  graph: OperationGraph,
  memberIds: ReadonlySet<string>,
  name: string,
  position: { x: number; y: number },
) {
  const draft = createUserBlockDraftV2(
    {
      nodes: graph.nodes.map((node) => ({ ...node, selected: memberIds.has(node.id) })),
      edges: graph.edges,
    },
    [],
  );
  if (!draft.ok) throw new Error(`The shot could not be grouped: ${draft.reason}`);
  const wrapped = prepareUserBlockCreationV2(draft, { ...draft.block, name });
  const root = wrapped.graph.nodes.find(
    (node) => node.data.blockInstanceV2 && !graph.nodes.some((old) => old.id === node.id),
  );
  if (!root) throw new Error('The shot needs a real editable Block.');
  const previous = root.data.blockInstanceV2!;
  const definition = structuredClone(previous.definitionSnapshot);
  definition.source.provider = STORYBOARD_SHOT_PROVIDER;
  definition.contentHash = blockDefinitionContentHashV2(definition);
  const instance = normalizeBlockInstanceV2({
    ...previous,
    definitionRef: { ...previous.definitionRef, contentHash: definition.contentHash },
    definitionSnapshot: definition,
  });
  const boundary = structuredClone(instance.effectiveInterface.boundary);
  boundary.inputs = boundary.inputs.filter((port) =>
    wrapped.graph.edges.some((edge) => edge.target === root.id && edge.targetHandle === port.portId),
  );
  boundary.outputs = boundary.outputs.filter((port) =>
    wrapped.graph.edges.some((edge) => edge.source === root.id && edge.sourceHandle === port.portId),
  );
  const duplicateEdges = new Set<string>();
  const controlsById = new Set(instance.effectiveInterface.controls.map((control) => control.controlId));
  const suppliers = new Map<string, (typeof boundary.inputs)[number]>();
  boundary.inputs = boundary.inputs.filter((port) => {
    if (controlsById.has(port.portId)) return true;
    const incoming = wrapped.graph.edges.filter((edge) => edge.target === root.id && edge.targetHandle === port.portId);
    if (incoming.length !== 1) return true;
    const edge = incoming[0]!;
    const key = JSON.stringify([edge.source, edge.sourceHandle, port.valueType, port.required, port.multiple]);
    const previous = suppliers.get(key);
    if (!previous) {
      suppliers.set(key, port);
      return true;
    }
    previous.mirrorBindings = [...(previous.mirrorBindings ?? []), port.binding, ...(port.mirrorBindings ?? [])].sort(
      (a, b) => (`${a.nodeId}\0${a.fieldOrPortId}` < `${b.nodeId}\0${b.fieldOrPortId}` ? -1 : 1),
    );
    duplicateEdges.add(edge.id);
    return false;
  });
  // Controls remain on the inner stages. Retain only real boundary suppliers.
  root.data.blockInstanceV2 = replaceBlockEffectiveInterfaceV2(instance, {
    boundary: { ...boundary, mode: 'explicit', derivation: undefined },
    controls: [],
  });
  root.position = position;
  root.data.blockInstanceV2.presentation.position = position;
  return {
    root,
    graph: { ...wrapped.graph, edges: wrapped.graph.edges.filter((edge) => !duplicateEdges.has(edge.id)) },
  };
}

const key = (node: CustomNodeType) => `${node.data.module}.${node.data.action}`;

/** Restore authored storyboard branches from their actual saved dependencies.
 * Repeated contracts remain distinct; this never relaxes model-editing scope. */
export function groupStoryboardShots(
  graph: OperationGraph,
  groupStage: (graph: OperationGraph, ids: readonly string[], kind: VisualOperationGroup) => OperationGraph,
): OperationGraph {
  const controls = graph.nodes.filter((node) => !node.parentId && key(node) === 'modules.VideoConditioning.ShotInputs');
  if (controls.length < 2) return graph;
  const ancestors = (id: string, found = new Set<string>()): Set<string> => {
    if (found.has(id)) return found;
    found.add(id);
    for (const edge of graph.edges.filter((edge) => edge.target === id)) ancestors(edge.source, found);
    return found;
  };
  const lists = graph.nodes.filter((node) => key(node) === 'modules.Primitive.ToList');
  const shotLists = lists.flatMap((list) => {
    const terminals = graph.edges.filter((edge) => edge.target === list.id).map((edge) => edge.source);
    return terminals.length === controls.length &&
      terminals.every((id) => {
        const branch = ancestors(id);
        return controls.filter((control) => branch.has(control.id)).length === 1;
      })
      ? [terminals]
      : [];
  });
  if (shotLists.length !== 1) throw new Error('The storyboard needs one unambiguous ordered shot collection.');
  const branches = shotLists[0]!.map((id) => {
    const branch = ancestors(id);
    // Save Shot is an independent terminal when assembly consumes native frames.
    for (const node of graph.nodes.filter((node) =>
      ['modules.Video.ExportAsset', 'modules.Video.Export'].includes(key(node)),
    )) {
      const dependencies = ancestors(node.id);
      dependencies.delete(node.id);
      if (dependencies.size && [...dependencies].every((dependency) => branch.has(dependency))) branch.add(node.id);
    }
    return branch;
  });
  const shared = new Set(
    graph.nodes.filter((node) => branches.filter((ids) => ids.has(node.id)).length > 1).map((node) => node.id),
  );
  const seen = new Set<number>();
  let result = graph;
  for (const branch of branches) {
    const members = graph.nodes.filter((node) => branch.has(node.id) && !shared.has(node.id));
    const one = (kind: string) => {
      const matches = members.filter((node) => key(node) === kind);
      if (matches.length !== 1) throw new Error(`The storyboard shot needs one ${kind}.`);
      return matches[0]!;
    };
    const control = one('modules.VideoConditioning.ShotInputs');
    const index = control.data.params.index?.value ?? control.data.params.index?.default;
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= controls.length ||
      seen.has(index)
    )
      throw new Error('The storyboard needs distinct consecutive shot indices.');
    seen.add(index);
    const encoder = one('modules.DiffusersVideo.EncodeInputs');
    const sampler = one('modules.DiffusersVideo.Denoise');
    const decoder = one('modules.DiffusersVideo.DecodeLatents');
    const prompt = one('modules.VideoConditioning.ShotPrompt');
    const before = new Set(result.nodes.map((node) => node.id));
    result = groupStage(result, [encoder.id, prompt.id], 'inputs');
    result = groupStage(result, [sampler.id, decoder.id, control.id], 'generate');
    const images = members.filter((node) => key(node) === 'modules.Image.Load');
    if (images.length)
      result = groupStage(
        result,
        images.map((node) => node.id),
        'imageInput',
      );
    const ids = new Set(members.map((node) => node.id));
    for (const node of result.nodes) if (!before.has(node.id)) ids.add(node.id);
    const wrapped = createStoryboardShotBlock(result, ids, `Shot ${index + 1}`, {
      x: 1000,
      y: 120 + index * 720,
    });
    result = wrapped.graph;
  }
  return result;
}
