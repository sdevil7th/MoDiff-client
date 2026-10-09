import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import type { BlockJsonValue } from '../studio/blockSchemaV2';
import { blockOperationGraphV2 } from '../studio/blockRuntimeV2';
import { blockConnectionTargetsV2 } from '../studio/blockCrossingConnectionsV2';
import { setBlockFieldValuesV1 } from '../studio/blockContainerEditingV1';
import type { OperationGraph } from './operationAuthoring';
import { remapOperationAuthoring, sharedOperationInput } from './operationSharedInputs';

/** Read-only visual projection and shared value writes used by the ordinary
 * renderer/store. Structural grouping stays in its on-demand planner module. */
export type VisualOperationGroup = 'inputs' | 'guidance' | 'setup' | 'mask' | 'output';
export const VISUAL_STAGE_PROVIDER = 'modiff.visual-stages.v1/';
export const VISUAL_STAGE_LABELS = {
  inputs: 'Encode Inputs',
  guidance: 'Guidance',
  setup: 'Model Setup',
  mask: 'Prepare Mask',
  output: 'Image Output',
};
export const VISUAL_STAGE_NAMES = {
  inputs: 'encoding',
  guidance: 'guidance',
  setup: 'model setup',
  mask: 'mask preparation',
  output: 'image output',
};

/** Presentation provenance only; never execution permission or a model selector. */
export function visualOperationGroup(node: CustomNodeType): VisualOperationGroup | null {
  const source = node.data.blockInstanceV2?.definitionSnapshot.source;
  if (source?.kind !== 'user') return null;
  return (
    (Object.keys(VISUAL_STAGE_LABELS) as VisualOperationGroup[]).find(
      (kind) => source.provider === `${VISUAL_STAGE_PROVIDER}${kind}`,
    ) ?? null
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
  const roots = graph.nodes.filter((node) => visualOperationGroup(node) && (!onlyIds || onlyIds.has(node.id)));
  const ids = new Set(roots.map((node) => node.id));
  const members = new Map<string, string[]>();
  const projected = new Map<string, string>();
  const semantic = new Map<string, Map<string, string>>();
  const nodes = graph.nodes.filter((node) => !ids.has(node.id) && !ids.has(node.data.blockProjectionOwnerId ?? ''));
  const internalEdges: OperationGraph['edges'] = [];
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
  const result = { nodes, edges: [...edges, ...internalEdges] };
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length)
    throw new Error('Visual group node identity collision.');
  return { graph: result, roots, members };
}

/** Shared seed/value edits still span the loader's complete ordinary graph. */
export function planVisualSharedInput(graph: OperationGraph, nodeId: string, field: string, value: unknown) {
  if (!graph.nodes.some(visualOperationGroup)) return null;
  const source = graph.nodes.find((node) => node.id === nodeId);
  let targetId = nodeId;
  if (source?.data.blockProjectionOwnerId) {
    const owner = graph.nodes.find((node) => node.id === source.data.blockProjectionOwnerId);
    if (!owner || !visualOperationGroup(owner)) return null;
    targetId = `${owner.id}/${source.data.blockProjectionNodeId}`;
  } else if (source && visualOperationGroup(source)) {
    const surface = source.data.blockInstanceV2!.effectiveInterface;
    const control = surface.controls.find((item) => item.controlId === field);
    const port = surface.boundary.inputs.find((item) => item.portId === field);
    const binding = control
      ? { nodeId: control.binding.nodeId, fieldId: control.binding.fieldId }
      : port
        ? { nodeId: port.binding.nodeId, fieldId: port.binding.fieldOrPortId }
        : null;
    if (!binding) return null;
    targetId = `${source.id}/${binding.nodeId}`;
    field = binding.fieldId;
  } else if (!source?.data.operationAuthoring?.sharedInputs?.some((item) => item.field === field)) return null;
  const unpacked = projectVisualOperationGroups(graph, undefined, false);
  const shared = sharedOperationInput(unpacked.graph.nodes, unpacked.graph.edges, targetId, field);
  if (!shared) return null;
  const updates = new Map<string, Array<{ nodeId: string; fieldId: string }>>();
  const ordinary = new Map<string, string>();
  for (const member of shared.members) {
    const root = unpacked.roots.find((root) => unpacked.members.get(root.id)?.includes(member.node.id));
    if (root) {
      const targets = updates.get(root.id) ?? [];
      targets.push({ nodeId: member.node.id.slice(root.id.length + 1), fieldId: member.field });
      updates.set(root.id, targets);
    } else {
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
