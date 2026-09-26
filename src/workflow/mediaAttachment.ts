import { nanoid } from 'nanoid';
import type { NodeData } from '../stores/useNodeStore';
import type { OperationContract } from './operationContracts';
import { operationOwnsModel } from './operationContracts';
import {
  operationAuthoring,
  operationScope,
  planOperationChange,
  type OperationGraph,
  type OperationStarter,
} from './operationAuthoring';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { createNodeFromRegistry } from './nodeFactory';
import { planBlockOperationChange } from './operationBlockChange';
import { runtimeNodeType, blockOperationGraphV2 } from '../studio/blockRuntimeV2';
import { blockCrossingHandleV2, blockConnectionTargetsV2 } from '../studio/blockCrossingConnectionsV2';
import type { PipelineSupport } from './operationCatalog';
import { nodeConnectorParam } from '../studio/nodeConnectorResolution';
import {
  visualOperationGroup,
  visualGroupOwners,
  unpackVisualOperationGroups,
  restoreVisualOperationGroups,
} from './visualOperationGroups';

export function executableMediaOperations(operations: OperationContract[], support: PipelineSupport[]) {
  const admitted = new Set(
    support.flatMap((pipeline) =>
      pipeline.tasks
        .filter((task) => task.execution === 'adapter')
        .flatMap((task) => task.operationIds.map((id) => JSON.stringify([pipeline.pipelineClass, task.task, id]))),
    ),
  );
  return operations.filter((operation) =>
    admitted.has(JSON.stringify([operation.pipelineClass, operation.task, operation.operationId])),
  );
}

export type MediaAttachmentChoice = { key: string; task: string; role: string; kind: 'image' | 'audio'; label: string };

export function mediaAttachmentOwners(
  graph: OperationGraph,
  targetId: string,
  operations: OperationContract[],
  kind: 'image' | 'audio',
) {
  const target = graph.nodes.find((node) => node.id === targetId);
  if (!target) return [];
  const root = target.data.blockProjectionOwnerId
    ? graph.nodes.find((node) => node.id === target.data.blockProjectionOwnerId)
    : target;
  if (root && visualOperationGroup(root))
    return visualGroupOwners(graph, root.id).filter((node) =>
      mediaAttachmentChoices(operations, operationAuthoring(node)!.operation.pipelineClass).some(
        (choice) => choice.kind === kind,
      ),
    );
  const scope = root?.data.blockInstanceV2 ? blockOperationGraphV2(root.data.blockInstanceV2) : graph;
  return scope.nodes
    .filter((node) => {
      const operation = operationAuthoring(node)?.operation;
      if (!operationOwnsModel(operation) || !operation) return false;
      if (!mediaAttachmentChoices(operations, operation.pipelineClass).some((choice) => choice.kind === kind))
        return false;
      return root?.data.blockInstanceV2 || operationScope(scope, node.id).some((owned) => owned.id === targetId);
    })
    .map((node) =>
      root?.data.blockInstanceV2 ? { ...node, data: { ...node.data, blockProjectionOwnerId: root.id } } : node,
    );
}

/** Choices come from backend ports, not a model-family list in the browser. */
export function mediaAttachmentChoices(operations: OperationContract[], pipeline: string): MediaAttachmentChoice[] {
  const choices = new Map<string, MediaAttachmentChoice>();
  for (const operation of operations) {
    if (operation.pipelineClass !== pipeline || !operation.task || operation.task.includes('video')) continue;
    for (const port of operation.ports) {
      if (
        port.direction !== 'input' ||
        port.hidden ||
        port.roles.includes('component') ||
        port.semantics?.owner === 'same_loader'
      )
        continue;
      const kind = port.types.includes('image') ? 'image' : port.types.includes('audio') ? 'audio' : null;
      if (!kind) continue;
      const key = JSON.stringify([operation.task, port.semanticName, kind]);
      choices.set(key, {
        key,
        task: operation.task,
        role: port.semanticName,
        kind,
        label: `${operation.task.replace(/_/gu, ' ')} · ${port.semanticName.replace(/_/gu, ' ')}`,
      });
    }
  }
  return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** A media attachment lowers to ordinary nodes and wires in the SAME graph. */
export function planMediaAttachment(
  graph: OperationGraph,
  ownerId: string,
  starter: OperationStarter,
  choice: MediaAttachmentChoice,
  registry: Record<string, NodeData>,
  source?: { nodeId: string; handleId: string },
): OperationGraph {
  if (graph.nodes.some(visualOperationGroup)) {
    const unpacked = unpackVisualOperationGroups(graph);
    const attached = planMediaAttachment(unpacked.graph, ownerId, starter, choice, registry, source);
    return restoreVisualOperationGroups(attached, unpacked);
  }
  const owner = graph.nodes.find((node) => node.id === ownerId);
  const hint = owner && operationAuthoring(owner);
  if (!owner || !hint || !operationOwnsModel(hint.operation) || owner.parentId || owner.data.blockProjectionOwnerId)
    throw new Error('Select an ordinary operation loader. Expand or edit a saved Block before attaching this input.');
  if (starter.pipelineClass !== hint.operation.pipelineClass || starter.task !== choice.task)
    throw new Error('The selected input does not belong to this pipeline.');
  const declared = mediaAttachmentChoices(
    starter.nodes.map((item) => item.operation),
    starter.pipelineClass,
  );
  if (!declared.some((item) => item.key === choice.key)) throw new Error('This input is no longer supported.');
  const plan =
    starter.task === hint.operation.task
      ? null
      : planOperationChange(graph, ownerId, starter, { preserveValues: true });
  if (plan?.review.required)
    throw new Error(
      'This change needs a model/task review. Use Change model / task to resolve its reported differences first.',
    );
  const next = structuredClone(plan?.graph ?? graph);
  const nextOwnerId = plan?.replacements[ownerId] ?? ownerId;
  const nextOwner = next.nodes.find((node) => node.id === nextOwnerId) ?? owner;
  // Follow only the selected owner's operation component graph, never another branch.
  const scope = new Set([nextOwner.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of next.edges) {
      if (!scope.has(edge.source) || scope.has(edge.target)) continue;
      const target = next.nodes.find((node) => node.id === edge.target);
      const operation = target && operationAuthoring(target)?.operation;
      if (
        operation &&
        operation.pipelineClass === starter.pipelineClass &&
        operation.task === starter.task &&
        !operationOwnsModel(operation)
      ) {
        scope.add(edge.target);
        changed = true;
      }
    }
  }
  const wired = new Set(starter.edges.map((edge) => `${edge.target}:${edge.targetHandle}`));
  const targets = next.nodes
    .filter((node) => scope.has(node.id))
    .flatMap((node) => {
      const operation = operationAuthoring(node)?.operation;
      return (operation?.ports ?? [])
        .filter(
          (port) =>
            port.direction === 'input' &&
            !port.hidden &&
            port.semanticName === choice.role &&
            port.types.includes(choice.kind) &&
            !wired.has(`${operation!.operationId}:${port.name}`),
        )
        .map((port) => ({ node, port }));
    });
  if (!targets.length) throw new Error('This graph has no exposed input for that role. Nothing changed.');
  let input = source && next.nodes.find((node) => node.id === source.nodeId);
  const handle = source?.handleId ?? choice.kind;
  if (!source) {
    const key = choice.kind === 'image' ? 'modules.Image.Load' : 'modules.Audio.Load';
    input =
      createNodeFromRegistry(key, registry, { x: owner.position.x - 420, y: owner.position.y + 280 }) ?? undefined;
    if (!input) throw new Error('The media loader is unavailable in the node registry.');
    // A separately loaded black/white mask is pixel data, not the loader's
    // alpha-derived mask. Alpha masks remain an explicit existing-source choice.
    if (choice.role.includes('mask')) input.data.label = 'Load Mask';
    next.nodes.push(input);
  }
  if (!input) throw new Error('The media source was removed.');
  const output = nodeConnectorParam(input, handle);
  if (!output || output.display !== 'output') throw new Error('Select a media output socket.');
  for (const { node, port } of targets) {
    if (!connectionTypesAreCompatible(output.type, node.data.params[port.name]?.type))
      throw new Error('Media input types no longer match.');
    if (node.id === input.id) throw new Error('A node cannot supply its own input.');
    const existing = next.edges.find((edge) => edge.target === node.id && edge.targetHandle === port.name);
    if (existing) {
      if (existing.source === input.id && existing.sourceHandle === handle) continue;
      throw new Error('This input is already connected. Disconnect or reconnect that input explicitly.');
    }
    node.data.params[port.name] = { ...node.data.params[port.name], isInput: true };
    next.edges.push({
      id: `edge-${nanoid()}`,
      source: input.id,
      sourceHandle: handle,
      target: node.id,
      targetHandle: port.name,
      type: 'default',
    });
  }
  assertAcyclicMediaGraph(next);
  return next;
}

function assertAcyclicMediaGraph(next: OperationGraph) {
  // Reject a source downstream of a newly attached target; do not create a cycle.
  const visited = new Set<string>(),
    active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw new Error('That attachment would create a cycle.');
    if (visited.has(id)) return;
    active.add(id);
    for (const edge of next.edges) if (edge.source === id) visit(edge.target);
    active.delete(id);
    visited.add(id);
  }
  for (const node of next.nodes) visit(node.id);
}

/** Saved Blocks keep their internal stages and durable crossing sockets. */
export function planBlockMediaAttachment(
  graph: OperationGraph,
  blockId: string,
  ownerId: string,
  starter: OperationStarter,
  choice: MediaAttachmentChoice,
  registry: Record<string, NodeData>,
  source?: { nodeId: string; handleId: string },
): OperationGraph {
  const original = graph.nodes.find((node) => node.id === blockId);
  const owner = original?.data.blockInstanceV2?.effectiveGraph.nodes.find((node) => node.nodeId === ownerId);
  if (!original || !owner) throw new Error('The Block loader is no longer available.');
  const operation = (owner.data as unknown as NodeData).operationAuthoring?.operation;
  const change =
    operation?.task === choice.task
      ? null
      : planBlockOperationChange(graph, blockId, ownerId, starter, { preserveValues: true });
  if (change?.review.required)
    throw new Error('This Block needs a model/task review before attaching this input. Nothing changed.');
  const next = structuredClone(change?.graph ?? graph);
  const root = next.nodes.find((node) => node.id === blockId)!;
  const instance = root.data.blockInstanceV2!;
  const internal: OperationGraph = {
    nodes: instance.effectiveGraph.nodes.map((node) => ({
      id: node.nodeId,
      type: runtimeNodeType(node),
      data: structuredClone(node.data) as unknown as NodeData,
      position: instance.presentation.internalLayout[node.nodeId] ?? { x: 0, y: 0 },
    })),
    edges: instance.effectiveGraph.edges.map((edge) => ({
      id: edge.edgeId,
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePortId,
      target: edge.targetNodeId,
      targetHandle: edge.targetPortId,
    })),
  };
  const proxyId = `media-source-${nanoid()}`;
  if (source) {
    const input = next.nodes.find((node) => node.id === source.nodeId);
    if (!input || input.id === blockId || input.data.blockProjectionOwnerId)
      throw new Error('Choose a media source outside this Block.');
    internal.nodes.push({ ...structuredClone(input), id: proxyId, parentId: undefined });
  }
  const attached = planMediaAttachment(
    internal,
    ownerId,
    starter,
    choice,
    registry,
    source ? { nodeId: proxyId, handleId: source.handleId } : undefined,
  );
  const originalIds = new Set(internal.nodes.map((node) => node.id));
  for (const input of attached.nodes.filter((node) => !originalIds.has(node.id)))
    next.nodes.push({ ...input, position: { x: root.position.x - 420, y: root.position.y + 280 } });
  const oldEdges = new Set(internal.edges.map((edge) => edge.id));
  for (const edge of attached.edges.filter((edge) => !oldEdges.has(edge.id))) {
    const sourceId = edge.source === proxyId ? source!.nodeId : edge.source;
    const existing = next.edges.find(
      (candidate) =>
        candidate.target === blockId &&
        candidate.targetHandle &&
        blockConnectionTargetsV2(root, candidate.targetHandle, 'input').some(
          (target) => target.nodeId === edge.target && target.fieldOrPortId === edge.targetHandle,
        ),
    );
    if (existing) {
      if (existing.source === sourceId && existing.sourceHandle === edge.sourceHandle) continue;
      throw new Error('This Block input is already connected. Disconnect it explicitly first.');
    }
    next.edges.push({
      ...edge,
      source: sourceId,
      target: blockId,
      targetHandle: blockCrossingHandleV2({
        direction: 'input',
        nodeId: edge.target,
        fieldOrPortId: edge.targetHandle!,
      }),
    });
  }
  assertAcyclicMediaGraph(next);
  return next;
}
