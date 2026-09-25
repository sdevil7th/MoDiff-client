import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import {
  blockDefinitionContentHashV2,
  blockGraphHashV2,
  createBlockInstanceV2,
  normalizeBlockDefinitionV2,
  normalizeBlockInstanceV2,
  type BlockControlV2,
  type BlockDefinitionV2,
  type BlockJsonObject,
  type BlockJsonValue,
  type BlockPortV2,
} from '../studio/blockSchemaV2';
import { blockOperationGraphV2, createBlockRootNodeV2 } from '../studio/blockRuntimeV2';
import { blockConnectionTargetsV2 } from '../studio/blockCrossingConnectionsV2';
import { setBlockFieldValuesV1 } from '../studio/blockContainerEditingV1';
import type { OperationGraph } from './operationAuthoring';
import { operationAuthoring } from './operationAuthoringHint';
import { operationScope } from './operationScope';
import { operationOwnsModel } from './operationContracts';
import { remapOperationAuthoring, sharedOperationInput } from './operationSharedInputs';
import { workflowTaskCategory } from './workflowTaskBrowser';

export type VisualOperationGroup = 'inputs' | 'guidance';
const PROVIDER = 'modiff.visual-stages.v1/';
const LABELS = { inputs: 'Encode Inputs', guidance: 'Guidance' };

/** Presentation provenance only; never execution permission or a model selector. */
export function visualOperationGroup(node: CustomNodeType): VisualOperationGroup | null {
  const source = node.data.blockInstanceV2?.definitionSnapshot.source;
  if (source?.kind !== 'user') return null;
  if (source.provider === `${PROVIDER}inputs`) return 'inputs';
  if (source.provider === `${PROVIDER}guidance`) return 'guidance';
  return null;
}

function stageKind(node: CustomNodeType): VisualOperationGroup | null {
  const operation = operationAuthoring(node)?.operation;
  if (!operation || !['block', 'bundle'].includes(operation.decomposition) || operation.task?.includes('video'))
    return null;
  if (['text_encoder', 'vae_encoder', 'image_encoder'].includes(operation.nodeType)) return 'inputs';
  if (['guidance', 'guidance_layers'].includes(operation.nodeType)) return 'guidance';
  return null;
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

/** Compose ordinary leaves into the existing V2 contract; no library write. */
export function groupVisualStages(
  graph: OperationGraph,
  memberIds: readonly string[],
  kind: VisualOperationGroup,
  previous?: CustomNodeType,
): OperationGraph {
  const selected = new Set(memberIds);
  const members = graph.nodes.filter((node) => selected.has(node.id));
  if (!members.length) return graph;
  if (
    members.length !== selected.size ||
    members.some((node) => node.parentId || node.data.blockInstanceV2 || node.data.blockProjectionOwnerId)
  )
    throw new Error('Choose ordinary stage nodes from one model branch.');
  const rootId = previous?.id ?? `visual-${nanoid()}`;
  const old = previous?.data.blockInstanceV2;
  if (old) {
    const customized =
      [...old.effectiveInterface.boundary.inputs, ...old.effectiveInterface.boundary.outputs].some(
        (port) => port.mirrorBindings?.length,
      ) || old.effectiveInterface.controls.some((control) => control.mirrorBindings?.length);
    if (customized)
      throw new Error(
        'This group has a mirrored custom interface. Ungroup its stages before changing the task; its bindings have not been changed.',
      );
  }
  const remap = (id: string) =>
    selected.has(id) ? (id.startsWith(`${rootId}/`) ? id.slice(rootId.length + 1) : `stage-${id}`) : id;
  const position = previous?.position ?? {
    x: Math.min(...members.map((node) => node.position.x)),
    y: Math.min(...members.map((node) => node.position.y)),
  };
  const bound = new Set(
    graph.edges
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .map((edge) => `${edge.target}\0${edge.targetHandle}`),
  );
  const inputs: BlockPortV2[] = [],
    outputs: BlockPortV2[] = [],
    controls: BlockControlV2[] = [];
  for (const node of members) {
    for (const [field, param] of Object.entries(node.data.params)) {
      const connected = graph.edges.some(
        (edge) =>
          (edge.source === node.id && edge.sourceHandle === field && !selected.has(edge.target)) ||
          (edge.target === node.id && edge.targetHandle === field && !selected.has(edge.source)),
      );
      if ((param.hidden && !connected) || param.display?.startsWith('ui_')) continue;
      const type = Array.isArray(param.type)
        ? param.type.join('|')
        : (param.type ?? (param.display === 'layerconfig' ? 'dict' : undefined));
      if (!type) continue;
      const id = `${remap(node.id)}:${field}`;
      const label = param.label ?? field;
      if (
        param.display === 'output' ||
        (!bound.has(`${node.id}\0${field}`) && (param.display === 'input' || param.isInput || connected))
      ) {
        (param.display === 'output' ? outputs : inputs).push({
          portId: id,
          label,
          valueType: type,
          required: false,
          binding: { nodeId: remap(node.id), fieldOrPortId: field },
        });
      }
      if (
        (param.display || (kind === 'guidance' && !param.isInput)) &&
        !['input', 'output'].includes(param.display ?? '') &&
        !param.signal &&
        !bound.has(`${node.id}\0${field}`)
      ) {
        if (
          kind === 'guidance' &&
          (old?.presentation.removedControlBindings?.some((b) => b.nodeId === remap(node.id) && b.fieldId === field) ||
            old?.definitionSnapshot.controls.some(
              (c) => c.binding.nodeId === remap(node.id) && c.binding.fieldId === field,
            )) &&
          !old?.effectiveInterface.controls.some(
            (c) => c.binding.nodeId === remap(node.id) && c.binding.fieldId === field,
          )
        )
          continue;
        const value = param.value ?? param.default;
        controls.push({
          controlId: id,
          label,
          valueType: type,
          order: controls.length,
          binding: { nodeId: remap(node.id), fieldId: field },
          ...(value === undefined ? {} : { defaultValue: JSON.parse(JSON.stringify(value)) }),
          group:
            stageKind(node) === 'inputs'
              ? operationAuthoring(node)?.operation.nodeType === 'text_encoder'
                ? 'Text'
                : 'Image'
              : 'Guidance',
        });
      }
    }
  }
  const innerGraph = {
    nodes: members.map((node) => {
      const data = structuredClone(node.data);
      const hint = remapOperationAuthoring(data.operationAuthoring, remap);
      if (hint) data.operationAuthoring = hint;
      return {
        nodeId: remap(node.id),
        nodeType: node.type ?? 'custom',
        data: JSON.parse(JSON.stringify(data)) as BlockJsonObject,
      };
    }),
    edges: graph.edges
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .map((edge) => ({
        edgeId: edge.id.startsWith(`${rootId}/`) ? edge.id.slice(rootId.length + 1) : `edge-${edge.id}`,
        sourceNodeId: remap(edge.source),
        sourcePortId: edge.sourceHandle!,
        targetNodeId: remap(edge.target),
        targetPortId: edge.targetHandle!,
      })),
  };
  const graphHash = blockGraphHashV2(innerGraph);
  if (old) {
    // Preserve configured labels and sealed controls when their exact bindings
    // survive. Connected wires are lowered to those same leaves before adapting.
    for (const direction of ['inputs', 'outputs'] as const) {
      const ports = direction === 'inputs' ? inputs : outputs;
      for (const port of ports) {
        const prior = old.effectiveInterface.boundary[direction].find(
          (candidate) =>
            candidate.binding.nodeId === port.binding.nodeId &&
            candidate.binding.fieldOrPortId === port.binding.fieldOrPortId,
        );
        if (prior) {
          port.label = prior.label;
          port.required = prior.required;
        }
      }
    }
    for (const control of controls) {
      const prior = old.effectiveInterface.controls.find(
        (candidate) =>
          candidate.binding.nodeId === control.binding.nodeId && candidate.binding.fieldId === control.binding.fieldId,
      );
      if (prior) {
        control.label = prior.label;
        if (prior.group) control.group = prior.group;
        if (prior.sealed) control.sealed = true;
      }
    }
  }
  const base: Omit<BlockDefinitionV2, 'contentHash'> = {
    schemaVersion: 2,
    definitionId: `definition-${rootId}`,
    displayName: old?.definitionSnapshot.displayName ?? LABELS[kind],
    source: { kind: 'user', provider: `${PROVIDER}${kind}` },
    graph: { ...innerGraph, graphHash },
    boundary: { mode: 'explicit', inputs, outputs },
    controls,
    previews: [],
    ownership: { kind: 'user', definitionMutable: true },
  };
  const definition = normalizeBlockDefinitionV2({ ...base, contentHash: blockDefinitionContentHashV2(base) });
  let instance = createBlockInstanceV2(definition, {
    instanceId: rootId,
    position,
    // Compact new text-only image encoders; preserve every existing/user size.
    // The renderer measures controls and grows safely when a route needs more.
    size: old?.presentation.size ?? {
      width: 400,
      height:
        kind === 'inputs'
          ? members.length === 1 &&
            operationAuthoring(members[0]!)?.operation.nodeType === 'text_encoder' &&
            workflowTaskCategory(operationAuthoring(members[0]!)?.operation.task ?? '') === 'Image'
            ? 400
            : 540
          : 420,
    },
    internalLayout: Object.fromEntries(
      members.map((node, index) => [
        remap(node.id),
        old?.presentation.internalLayout[remap(node.id)] ?? { x: 28 + index * 420, y: 110, width: 360, height: 460 },
      ]),
    ),
  });
  if (old) {
    // The reusable definition is immutable. Adapt only this workflow's effective
    // graph/interface; current public values were materialized by unpack above.
    instance = normalizeBlockInstanceV2({
      ...instance,
      definitionRef: old.definitionRef,
      definitionSnapshot: old.definitionSnapshot,
      effectiveInterface: {
        ...instance.effectiveInterface,
        baseInterfaceHash: old.effectiveInterface.baseInterfaceHash,
      },
      customization: {
        state: 'structure_changed',
        baseGraphHash: old.customization.baseGraphHash,
        effectiveGraphHash: graphHash,
      },
      presentation: {
        ...instance.presentation,
        expanded: old.presentation.expanded,
        ...(old.presentation.removedControlBindings
          ? { removedControlBindings: structuredClone(old.presentation.removedControlBindings) }
          : {}),
      },
    });
  }
  const root = createBlockRootNodeV2(instance, { selected: previous?.selected });
  const endpoint = (id: string, handle: string | null | undefined) => `${remap(id)}:${handle}`;
  return {
    nodes: [...graph.nodes.filter((node) => !selected.has(node.id)), root],
    edges: graph.edges
      .filter((edge) => !(selected.has(edge.source) && selected.has(edge.target)))
      .map((edge) => ({
        ...edge,
        ...(selected.has(edge.source)
          ? { source: rootId, sourceHandle: endpoint(edge.source, edge.sourceHandle) }
          : {}),
        ...(selected.has(edge.target)
          ? { target: rootId, targetHandle: endpoint(edge.target, edge.targetHandle) }
          : {}),
      })),
  };
}

export function groupOperationStages(
  graph: OperationGraph,
  ownerId: string,
  kinds: VisualOperationGroup[] = ['inputs', 'guidance'],
) {
  const scope = operationScope(graph, ownerId);
  let next = graph;
  for (const kind of kinds) {
    const members = scope.filter((node) => stageKind(node) === kind);
    if (
      kind === 'guidance' &&
      (members.length < 2 ||
        !graph.edges.some(
          (edge) => members.some((node) => node.id === edge.source) && members.some((node) => node.id === edge.target),
        ))
    )
      continue;
    if (members.length)
      next = groupVisualStages(
        next,
        members.map((node) => node.id),
        kind,
      );
  }
  return next;
}

export function groupNewOperationGraph(graph: OperationGraph) {
  let next = graph;
  for (const owner of graph.nodes.filter((node) => operationOwnsModel(operationAuthoring(node)?.operation)))
    next = groupOperationStages(next, owner.id);
  return next;
}

/** Planner adapter only: flatten the same effective graph, apply, then retain its presentation. */
export function restoreVisualOperationGroups(
  next: OperationGraph,
  unpacked: ReturnType<typeof unpackVisualOperationGroups>,
  replacements: Record<string, string> = {},
) {
  // Keep replacement runtime identities: a different pipeline must not reuse
  // a Python encoder instance merely to retain a visual wrapper's identity.
  let graph = next;
  for (const root of unpacked.roots) {
    const previousMembers = unpacked.members.get(root.id)!;
    const retained = previousMembers
      .map((id) => replacements[id] ?? id)
      .filter((id) => graph.nodes.some((node) => node.id === id));
    const kind = visualOperationGroup(root)!;
    const previousOwner = unpacked.graph.nodes.find(
      (node) =>
        operationOwnsModel(operationAuthoring(node)?.operation) &&
        operationScope(unpacked.graph, node.id).some((member) => previousMembers.includes(member.id)),
    );
    const owner =
      previousOwner && graph.nodes.find((node) => node.id === (replacements[previousOwner.id] ?? previousOwner.id));
    const added = owner
      ? operationScope(graph, owner.id)
          .filter((node) => stageKind(node) === kind)
          .map((node) => node.id)
      : [];
    graph = groupVisualStages(graph, [...new Set([...retained, ...added])], kind, root);
  }
  return graph;
}

export function visualGroupOwners(graph: OperationGraph, groupId: string) {
  const unpacked = unpackVisualOperationGroups(graph);
  const members = unpacked.members.get(groupId) ?? [];
  return unpacked.graph.nodes.filter(
    (node) =>
      operationOwnsModel(operationAuthoring(node)?.operation) &&
      operationScope(unpacked.graph, node.id).some((member) => members.includes(member.id)),
  );
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
