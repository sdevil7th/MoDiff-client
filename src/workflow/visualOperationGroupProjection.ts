import type { CustomNodeType } from '../stores/useFlowStore';
import { insertStageLeaves, visualStageSourceIndex } from '../studio/visualStageOrder';
import type { NodeData } from '../stores/useNodeStore';
import { blockInstancePreviewBindingsV2, type BlockJsonValue } from '../studio/blockSchemaV2';
import { blockOperationGraphV2 } from '../studio/blockRuntimeV2';
import { blockConnectionTargetsV2 } from '../studio/blockCrossingConnectionsV2';
import { blockControlBindingV2 } from '../studio/blockControlConnectionsV2';
import { setBlockFieldValuesV1 } from '../studio/blockContainerEditingV1';
import type { OperationGraph } from './operationAuthoring';
import { remapOperationAuthoring, sharedOperationInput } from './operationSharedInputs';

/** Read-only visual projection and shared value writes used by the ordinary
 * renderer/store. Structural grouping stays in its on-demand planner module. */
export type VisualOperationGroup = keyof typeof VISUAL_STAGE_LABELS;
export const VISUAL_STAGE_PROVIDER = 'modiff.visual-stages.v1/';
export const COMBINED_INPUT_PROVIDER = 'modiff.visual-stages.v2/inputs';
export const VISUAL_STAGE_LABELS = {
  composite: 'Composite',
  imageInput: 'Image Input',
  videoInput: 'Video Input',
  references: 'Reference Images',
  generate: 'Generate',
  inputs: 'Encode Inputs',
  guidance: 'Guidance',
  setup: 'Model Setup',
  mask: 'Prepare Mask',
  output: 'Image Output',
};
export const VISUAL_STAGE_NAMES = {
  composite: 'image composition',
  imageInput: 'image input',
  videoInput: 'video input',
  references: 'reference image',
  generate: 'generation',
  inputs: 'encoding',
  guidance: 'guidance',
  setup: 'model setup',
  mask: 'mask preparation',
  output: 'image output',
};

/** Media changes presentation wording only; it never grants execution. */
export function visualStagePresentation(kind: VisualOperationGroup, media?: 'image' | 'audio' | 'video' | null) {
  return kind === 'output' && (media === 'audio' || media === 'video')
    ? media === 'video'
      ? { label: 'Video Output', name: 'video output' }
      : { label: 'Audio Output', name: 'audio output' }
    : { label: VISUAL_STAGE_LABELS[kind], name: VISUAL_STAGE_NAMES[kind] };
}

export function visualOperationGroupMedia(node: Pick<CustomNodeType, 'data'>): 'image' | 'audio' | 'video' | null {
  const instance = node.data.blockInstanceV2;
  const object = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const declaredMedia = new Set<'image' | 'audio' | 'video'>();
  for (const node of instance?.effectiveGraph.nodes ?? []) {
    const hint = node.data.operationAuthoring;
    const operation = object(hint) && hint.operation;
    if (
      !object(operation) ||
      !Array.isArray(operation.ports) ||
      !(
        operation.operationId === 'diffusion.decode_latents' ||
        operation.nodeType === 'decoder' ||
        operation.nodeType === 'decode'
      )
    )
      continue;
    for (const port of operation.ports) {
      if (!object(port) || port.direction !== 'output' || !Array.isArray(port.types)) continue;
      for (const media of ['image', 'audio', 'video'] as const)
        if (port.types.includes(media)) declaredMedia.add(media);
    }
  }
  // A decoder can now belong to Generate. An export-only stage retains its
  // declared media boundary even when its player/export member is removed.
  // This affects wording only; it grants no graph or execution authority.
  if (!declaredMedia.size) {
    const boundary = instance?.effectiveInterface?.boundary;
    for (const port of [...(boundary?.inputs ?? []), ...(boundary?.outputs ?? [])]) {
      const types = typeof port.valueType === 'string' ? port.valueType.split('|') : [];
      for (const media of ['image', 'audio', 'video'] as const) if (types.includes(media)) declaredMedia.add(media);
    }
  }
  // Removing or adding a player does not change the real output stage's media.
  // A joint video/audio decoder still delivers a video stage after its player
  // is removed. The soundtrack must not make its presentation ambiguous.
  if (declaredMedia.has('video')) return 'video';
  if (declaredMedia.size === 1) return declaredMedia.has('audio') ? 'audio' : 'image';
  const previews = instance ? blockInstancePreviewBindingsV2(instance.definitionSnapshot, instance.effectiveGraph) : [];
  const media = new Set(previews.map((preview) => preview.mediaType));
  if (media.has('video')) return 'video';
  return media.size === 1 && (media.has('image') || media.has('audio'))
    ? media.has('audio')
      ? 'audio'
      : 'image'
    : null;
}

/** Presentation provenance only; never execution permission or a model selector. */
export function visualOperationGroup(node: CustomNodeType): VisualOperationGroup | null {
  const source = node.data.blockInstanceV2?.definitionSnapshot.source;
  if (source?.kind !== 'user') return null;
  if (source.provider === COMBINED_INPUT_PROVIDER) return 'inputs';
  return (
    (Object.keys(VISUAL_STAGE_LABELS) as VisualOperationGroup[]).find(
      (kind) => source.provider === `${VISUAL_STAGE_PROVIDER}${kind}`,
    ) ?? null
  );
}

/** Value edits may cross disclosure containers without adapting their graph. */
function readableUserBlockRoot(node: CustomNodeType) {
  const instance = node.data.blockInstanceV2;
  return Boolean(
    instance &&
    node.id === instance.instanceId &&
    instance.definitionSnapshot.source.kind === 'user' &&
    instance.definitionSnapshot.ownership.kind === 'user',
  );
}

/** A projected visual loader still owns the complete surrounding workflow. */
export function visualOperationOwnerId(graph: OperationGraph, ownerId: string, blockId?: string) {
  const root = blockId && graph.nodes.find((node) => node.id === blockId);
  return root && visualOperationGroup(root) ? `${root.id}/${ownerId}` : ownerId;
}

function plainNode(node: CustomNodeType, id: string): CustomNodeType {
  const data = structuredClone(node.data);
  delete data.blockProjectionOwnerId;
  delete data.blockProjectionNodeId;
  delete data.blockProjectionKind;
  for (const field of Object.values(data.params)) {
    if (field.fieldOptions) {
      delete field.fieldOptions.blockBindingV2;
    }
  }
  return { id, type: node.type, position: { ...node.position }, data };
}

/** Read the current effective graph (including public overrides), without Run validation. */
export function unpackVisualOperationGroups(graph: OperationGraph, onlyIds?: ReadonlySet<string>) {
  return projectVisualOperationGroups(graph, onlyIds, true);
}

// Value edits only read this projection; they never adapt or regroup its nodes.
function projectVisualOperationGroups(
  graph: OperationGraph,
  onlyIds: ReadonlySet<string> | undefined,
  adapting: boolean,
) {
  const roots = graph.nodes.filter(
    (node) =>
      (visualOperationGroup(node) || (!adapting && readableUserBlockRoot(node))) && (!onlyIds || onlyIds.has(node.id)),
  );
  const ids = new Set(roots.map((node) => node.id));
  const members = new Map<string, string[]>();
  const projected = new Map<string, string>();
  const semantic = new Map<string, Map<string, string>>();
  const nodes = graph.nodes.filter((node) => !ids.has(node.id) && !ids.has(node.data.blockProjectionOwnerId ?? ''));
  const externalCount = nodes.length;
  const internalEdges: OperationGraph['edges'] = [];
  // Resolve references across all groups before reading a leaf. Otherwise an
  // input group preceding Model Setup can retain an obsolete loader reference.
  for (const root of roots) {
    const instance = root.data.blockInstanceV2!;
    for (const node of blockOperationGraphV2(instance).nodes)
      projected.set(node.id, `${root.id}/${node.data.blockProjectionNodeId}`);
  }
  for (const root of roots) {
    const instance = root.data.blockInstanceV2!;
    if (
      adapting &&
      instance.effectiveGraph.nodes.some(
        (node) => node.parentNodeId || node.containerInterface || node.modularDiffusers,
      )
    )
      throw new Error('Ungroup nested additions before adapting this visual stage group. Nothing changed.');
    const view = blockOperationGraphV2(instance);
    const map = new Map(instance.effectiveGraph.nodes.map((node) => [node.nodeId, `${root.id}/${node.nodeId}`]));
    semantic.set(root.id, map);
    members.set(root.id, [...map.values()]);
    for (const node of view.nodes) projected.set(node.id, map.get(node.data.blockProjectionNodeId!)!);
    for (const node of view.nodes) {
      const semanticId = node.data.blockProjectionNodeId!;
      const raw = instance.effectiveGraph.nodes.find((member) => member.nodeId === semanticId)!;
      const plain = plainNode(
        { ...node, data: { ...(raw.data as unknown as NodeData), ...node.data } },
        map.get(semanticId)!,
      );
      for (const preview of instance.previewStates) {
        if (preview.binding.nodeId !== semanticId || !preview.mediaReference) continue;
        const field = plain.data.params[preview.binding.outputPortId];
        if (field?.display?.startsWith('ui_')) field.value = preview.mediaReference;
      }
      const hint = remapOperationAuthoring(node.data.operationAuthoring, (id) => projected.get(id) ?? id);
      if (hint) plain.data.operationAuthoring = hint;
      const layout = instance.presentation.internalLayout[semanticId] ?? { x: 24, y: 100 };
      plain.position = { x: root.position.x + layout.x, y: root.position.y + layout.y };
      nodes.push(plain);
    }
    internalEdges.push(
      ...view.edges.map((edge) => ({
        ...edge,
        id: `${root.id}/${edge.id}`,
        source: projected.get(edge.source)!,
        target: projected.get(edge.target)!,
      })),
    );
  }
  const rootById = new Map(roots.map((node) => [node.id, node]));
  const edges = graph.edges
    .filter((edge) => !ids.has(String(edge.data?.blockProjectionOwnerId ?? '')))
    .flatMap((edge) => {
      const endpoints = (id: string, handle: string | null | undefined, direction: 'input' | 'output') => {
        const root = rootById.get(id);
        if (!root) return [{ id: projected.get(id) ?? id, handle }];
        if (!handle) throw new Error('A visual group connection is missing its socket.');
        const targets = blockConnectionTargetsV2(root, handle, direction);
        if (!targets.length) throw new Error('A visual group connection no longer resolves. Nothing changed.');
        return targets.map((target) => ({ id: semantic.get(id)!.get(target.nodeId)!, handle: target.fieldOrPortId }));
      };
      const sources = endpoints(edge.source, edge.sourceHandle, 'output');
      const targets = endpoints(edge.target, edge.targetHandle, 'input');
      return sources.flatMap((source) =>
        targets.map((target, index) => ({
          ...edge,
          id: index ? `${edge.id}/mirror-${index}` : edge.id,
          source: source.id,
          sourceHandle: source.handle,
          target: target.id,
          targetHandle: target.handle,
        })),
      );
    });
  const children = nodes.slice(externalCount);
  const ordinary = insertStageLeaves(
    nodes.slice(0, externalCount),
    children.flatMap((leaf) =>
      visualStageSourceIndex(leaf.data.visualStageSourceIndex)
        ? [{ index: leaf.data.visualStageSourceIndex, leaf }]
        : [],
    ),
  );
  const result = {
    nodes: [...ordinary, ...children.filter((n) => !visualStageSourceIndex(n.data.visualStageSourceIndex))].map(
      (node) => {
        const hint = remapOperationAuthoring(node.data.operationAuthoring, (id) => projected.get(id) ?? id);
        return hint ? { ...node, data: { ...node.data, operationAuthoring: hint } } : node;
      },
    ),
    edges: [...edges, ...internalEdges],
  };
  if (onlyIds && graph.nodes.some((node) => visualOperationGroup(node) && !ids.has(node.id))) {
    // Remaining roots (including Shot containers) represent several leaf
    // positions, not one slot. Use the compiler's existing source-order hints
    // as placeholders, without importing another group's values or references.
    const allRoots = graph.nodes.filter((node) => node.data.blockInstanceV2);
    const allRootIds = new Set(allRoots.map((node) => node.id));
    const order = insertStageLeaves(
      graph.nodes
        .filter((node) => !allRootIds.has(node.id) && !allRootIds.has(node.data.blockProjectionOwnerId ?? ''))
        .map((node) => ({ id: node.id })),
      allRoots.flatMap((root) =>
        root.data.blockInstanceV2!.definitionSnapshot.source.provider?.startsWith('modiff.visual-stages.')
          ? root.data.blockInstanceV2!.effectiveGraph.nodes.flatMap((child) =>
              visualStageSourceIndex(child.data.visualStageSourceIndex)
                ? [{ index: child.data.visualStageSourceIndex, leaf: { id: `${root.id}/${child.nodeId}` } }]
                : [],
            )
          : [],
      ),
    );
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const ordered = order.flatMap((node) => (byId.has(node.id) ? [byId.get(node.id)!] : []));
    const placed = new Set(ordered.map((node) => node.id));
    result.nodes = [...ordered, ...result.nodes.filter((node) => !placed.has(node.id))];
  }
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length)
    throw new Error('Visual group node identity collision.');
  return { graph: result, roots, members };
}

/** Shared seed/value edits still span the loader's complete ordinary graph. */
export function planVisualSharedInput(graph: OperationGraph, nodeId: string, field: string, value: unknown) {
  if (!graph.nodes.some(readableUserBlockRoot)) return null;
  const source = graph.nodes.find((node) => node.id === nodeId);
  let targets = [{ nodeId, field }];
  if (source?.data.blockProjectionOwnerId) {
    const owner = graph.nodes.find((node) => node.id === source.data.blockProjectionOwnerId);
    if (!owner || !readableUserBlockRoot(owner)) return null;
    const param = source.data.params[field];
    if (!param) return null;
    const bound = blockControlBindingV2(source, field, param, graph.nodes);
    if (bound) {
      targets = [bound.control.binding, ...(bound.control.mirrorBindings ?? [])].map((binding) => ({
        nodeId: `${owner.id}/${binding.nodeId}`,
        field: binding.fieldId,
      }));
    } else {
      if (param.fieldOptions?.blockContainerControlV1 !== undefined)
        throw new Error('This internal control has an invalid binding. Reopen the Block.');
      targets = [{ nodeId: `${owner.id}/${source.data.blockProjectionNodeId}`, field }];
    }
  } else if (source && readableUserBlockRoot(source)) {
    const surface = source.data.blockInstanceV2!.effectiveInterface;
    const control = surface.controls.find((item) => item.controlId === field);
    const port = surface.boundary.inputs.find((item) => item.portId === field);
    const bindings = control
      ? [control.binding, ...(control.mirrorBindings ?? [])]
      : port
        ? blockConnectionTargetsV2(source, field, 'input').map((binding) => ({
            nodeId: binding.nodeId,
            fieldId: binding.fieldOrPortId,
          }))
        : [];
    if (!bindings.length) return null;
    targets = bindings.map((binding) => ({ nodeId: `${source.id}/${binding.nodeId}`, field: binding.fieldId }));
  } else if (!source?.data.operationAuthoring?.sharedInputs?.some((item) => item.field === field)) return null;
  const unpacked = projectVisualOperationGroups(graph, undefined, false);
  if (new Set(unpacked.graph.nodes.map((node) => node.id)).size !== unpacked.graph.nodes.length)
    throw new Error('The grouped input references collide. Reopen the workflow before editing it.');
  const groups = targets.map((target) =>
    sharedOperationInput(unpacked.graph.nodes, unpacked.graph.edges, target.nodeId, target.field),
  );
  if (!groups.some(Boolean)) return null;
  const members = new Map(
    groups.flatMap((group) => group?.members ?? []).map((member) => [`${member.node.id}\0${member.field}`, member]),
  );
  for (const target of targets) {
    const node = unpacked.graph.nodes.find((node) => node.id === target.nodeId);
    if (!node?.data.params[target.field])
      throw new Error('This shared control target no longer exists. Reopen the Block.');
    members.set(`${node.id}\0${target.field}`, { node, field: target.field });
  }
  const updates = new Map<string, Array<{ nodeId: string; fieldId: string }>>();
  const ordinary = new Map<string, string>();
  for (const member of members.values()) {
    const root = unpacked.roots.find((root) => unpacked.members.get(root.id)?.includes(member.node.id));
    if (root) {
      const targets = updates.get(root.id) ?? [];
      targets.push({ nodeId: member.node.id.slice(root.id.length + 1), fieldId: member.field });
      updates.set(root.id, targets);
    } else {
      if (member.node.data.blockProjectionOwnerId)
        throw new Error('Cannot edit a shared input through an unresolved or protected Block interface.');
      if (member.node.data.params[member.field]?.disabled) throw new Error('Cannot change a disabled shared input.');
      ordinary.set(member.node.id, member.field);
    }
  }
  return {
    nodes: graph.nodes.map((node) => {
      const targets = updates.get(node.id);
      if (targets) {
        const instance = setBlockFieldValuesV1(node.data.blockInstanceV2!, targets, value as BlockJsonValue);
        return { ...node, data: { ...node.data, blockInstanceV2: instance } };
      }
      const key = ordinary.get(node.id);
      if (!key) return node;
      const hint = node.data.operationAuthoring!;
      return {
        ...node,
        data: {
          ...node.data,
          params: { ...node.data.params, [key]: { ...node.data.params[key], value: value as never } },
          operationAuthoring: { ...hint, authored: [...new Set([...(hint.authored ?? []), key])] },
        },
      };
    }),
    edges: graph.edges,
  };
}
