import { nanoid } from 'nanoid';
import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { AppModeInput, UserBlockDefinition, UserBlockPort, WorkflowBlueprint } from './types';

type FlowGraph = {
  nodes: CustomNodeType[];
  edges: Edge[];
};

export const USER_BLOCK_DRAG_PREFIX = 'modiff-user-block:';

type BlockSelectionResult =
  | { ok: true; block: UserBlockDefinition; blockNode: CustomNodeType; nodes: CustomNodeType[]; edges: Edge[] }
  | { ok: false; reason: string };

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeHandle(value: string | null | undefined, fallback: string) {
  return (value && value.replace(/[^a-zA-Z0-9_-]+/g, '_')) || fallback;
}

function nodeLabel(node: CustomNodeType) {
  return node.data.label || `${node.data.module}.${node.data.action}` || node.id;
}

function paramLabel(node: CustomNodeType, key: string) {
  return node.data.params?.[key]?.label || key;
}

function editableParamEntries(node: CustomNodeType) {
  return Object.entries(node.data.params ?? {}).filter(
    ([key, param]) =>
      param.display !== 'input' &&
      param.display !== 'output' &&
      !param.hidden &&
      !param.isInput &&
      !['image', 'output', 'images', 'latents'].includes(key),
  );
}

function selectedActionNodes(nodes: CustomNodeType[]) {
  return nodes.filter((node) => node.selected && node.data.type !== 'group');
}

function selectedNodeSet(nodes: CustomNodeType[]) {
  return new Set(nodes.map((node) => node.id));
}

function connectedSelection(nodes: CustomNodeType[], edges: Edge[]) {
  if (nodes.length <= 1) return true;
  const ids = selectedNodeSet(nodes);
  const adjacency = new Map<string, Set<string>>();
  ids.forEach((id) => adjacency.set(id, new Set()));
  edges.forEach((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  const first = nodes[0]?.id;
  if (!first) return false;
  const seen = new Set<string>();
  const stack = [first];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    adjacency.get(id)?.forEach((next) => {
      if (!seen.has(next)) stack.push(next);
    });
  }
  return seen.size === nodes.length;
}

function boundsForNodes(nodes: CustomNodeType[]) {
  const left = Math.min(...nodes.map((node) => node.position.x));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const right = Math.max(...nodes.map((node) => node.position.x + (node.width ?? node.measured?.width ?? 260)));
  const bottom = Math.max(...nodes.map((node) => node.position.y + (node.height ?? node.measured?.height ?? 160)));
  return { left, top, width: right - left, height: bottom - top };
}

function portFromEdge(
  node: CustomNodeType,
  handle: string | null | undefined,
  direction: 'input' | 'output',
  index: number,
): UserBlockPort {
  const key = safeHandle(handle, `${direction}-${index + 1}`);
  const param = node.data.params?.[key];
  return {
    id: key,
    label: paramLabel(node, key),
    nodeId: node.id,
    paramKey: key,
    type: param?.type,
  };
}

function dedupePorts(ports: UserBlockPort[]) {
  const seen = new Set<string>();
  return ports.filter((port) => {
    const key = `${port.id}:${port.nodeId}:${port.paramKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function exposedParamsForNodes(nodes: CustomNodeType[]): AppModeInput[] {
  return nodes.flatMap((node) =>
    editableParamEntries(node).map(([key, param]) => ({
      id: `${node.id}__${key}`,
      kind: 'graph-param' as const,
      label: `${nodeLabel(node)} / ${param.label || key}`,
      nodeId: node.id,
      paramKey: key,
    })),
  );
}

function exposedParamToNodeParam(nodesById: Map<string, CustomNodeType>, input: AppModeInput): NodeParams | null {
  if (!input.nodeId || !input.paramKey) return null;
  const source = nodesById.get(input.nodeId)?.data.params?.[input.paramKey];
  if (!source) return null;
  return {
    ...cloneJson(source),
    label: input.label,
    display: source.display === 'input' || source.display === 'output' ? undefined : source.display,
  };
}

export function createUserBlockNode(block: UserBlockDefinition, position: CustomNodeType['position']): CustomNodeType {
  const nodesById = new Map(block.nodes.filter(isFlowNodeLike).map((node) => [node.id, node as CustomNodeType]));
  const params: Record<string, NodeParams> = {};

  block.inputs.forEach((port) => {
    params[port.id] = {
      label: port.label,
      display: 'input',
      type: port.type,
      isConnected: false,
    };
  });
  block.exposedParams.forEach((input) => {
    const param = exposedParamToNodeParam(nodesById, input);
    if (param) params[input.id] = param;
  });
  block.outputs.forEach((port) => {
    params[port.id] = {
      label: port.label,
      display: 'output',
      type: port.type,
      isConnected: false,
    };
  });

  return {
    id: nanoid(),
    type: 'custom',
    position,
    selected: true,
    data: {
      type: 'custom',
      module: 'modiff.user_blocks',
      action: block.id,
      label: block.name,
      category: 'User Nodes',
      description: 'Reusable user block',
      params,
      resizable: true,
      userBlockId: block.id,
      style: {},
    },
  };
}

function isFlowNodeLike(value: unknown): value is { id: string; data?: unknown; position?: unknown } {
  return isRecord(value) && typeof value.id === 'string' && isRecord(value.data);
}

export function validateUserBlockSelection(graph: FlowGraph) {
  const selectedNodes = selectedActionNodes(graph.nodes);
  if (selectedNodes.length === 0) return 'Select nodes first';
  if (!connectedSelection(selectedNodes, graph.edges)) return 'Selection has separate islands';
  return null;
}

export function createUserBlockFromSelection(graph: FlowGraph, name?: string): BlockSelectionResult {
  const reason = validateUserBlockSelection(graph);
  if (reason) return { ok: false, reason };

  const selectedNodes = selectedActionNodes(graph.nodes);
  const selectedIds = selectedNodeSet(selectedNodes);
  const internalEdges = graph.edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const incomingEdges = graph.edges.filter((edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const outgoingEdges = graph.edges.filter((edge) => selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  const selectedById = new Map(selectedNodes.map((node) => [node.id, node]));
  const bounds = boundsForNodes(selectedNodes);
  const blockId = nanoid();
  const createdAt = Date.now();
  const blockName = name?.trim() || `User Block ${createdAt.toString().slice(-4)}`;
  const normalizedNodes = cloneJson(selectedNodes).map((node) => ({
    ...node,
    selected: false,
    dragging: false,
    position: {
      x: node.position.x - bounds.left,
      y: node.position.y - bounds.top,
    },
  }));

  const inputPorts = incomingEdges.map((edge, index) =>
    portFromEdge(selectedById.get(edge.target)!, edge.targetHandle, 'input', index),
  );
  const outputPorts = outgoingEdges.map((edge, index) =>
    portFromEdge(selectedById.get(edge.source)!, edge.sourceHandle, 'output', index),
  );

  const block: UserBlockDefinition = {
    id: blockId,
    name: blockName,
    version: 1,
    nodes: normalizedNodes,
    edges: cloneJson(internalEdges),
    inputs: dedupePorts(inputPorts),
    outputs: dedupePorts(outputPorts),
    exposedParams: exposedParamsForNodes(selectedNodes),
    createdAt,
    updatedAt: createdAt,
  };

  const blockNode = createUserBlockNode(block, {
    x: bounds.left + Math.max(0, bounds.width / 2 - 140),
    y: bounds.top + Math.max(0, bounds.height / 2 - 80),
  });

  const nextEdges: Edge[] = graph.edges
    .filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target))
    .map(cloneJson);

  incomingEdges.forEach((edge, index) => {
    const port = inputPorts[index];
    if (!port) return;
    nextEdges.push({
      ...cloneJson(edge),
      id: nanoid(),
      target: blockNode.id,
      targetHandle: port.id,
    });
  });
  outgoingEdges.forEach((edge, index) => {
    const port = outputPorts[index];
    if (!port) return;
    nextEdges.push({
      ...cloneJson(edge),
      id: nanoid(),
      source: blockNode.id,
      sourceHandle: port.id,
    });
  });

  const nextNodes = [
    ...graph.nodes.filter((node) => !selectedIds.has(node.id)).map((node) => ({ ...node, selected: false })),
    blockNode,
  ] as CustomNodeType[];

  return { ok: true, block, blockNode, nodes: nextNodes, edges: nextEdges };
}

export function workflowBlueprintToUserBlock(blueprint: WorkflowBlueprint): UserBlockDefinition {
  const createdAt = blueprint.createdAt || Date.now();
  return {
    id: blueprint.id,
    name: blueprint.name,
    version: 1,
    nodes: cloneJson(blueprint.nodes),
    edges: cloneJson(blueprint.edges),
    inputs: blueprint.exposedInputs
      .filter((input) => input.nodeId && input.paramKey)
      .map((input) => ({
        id: input.id.replace(/[^a-zA-Z0-9_-]+/g, '_'),
        label: input.label,
        nodeId: input.nodeId!,
        paramKey: input.paramKey!,
      })),
    outputs: blueprint.exposedOutputs.map((output) => ({
      id: output.fieldKey || output.id.replace(/[^a-zA-Z0-9_-]+/g, '_'),
      label: output.label,
      nodeId: output.nodeId,
      paramKey: output.fieldKey || 'output',
    })),
    exposedParams: cloneJson(blueprint.exposedInputs),
    createdAt,
    updatedAt: blueprint.updatedAt || createdAt,
  };
}

function remapId(blockNodeId: string, id: string) {
  return `${blockNodeId}__${id}`;
}

function expandOnePass(graph: FlowGraph, blocks: Map<string, UserBlockDefinition>): FlowGraph {
  const nextNodes: CustomNodeType[] = [];
  const nextEdges: Edge[] = [];
  const blockNodes = graph.nodes.filter((node) => node.data.userBlockId && blocks.has(node.data.userBlockId));
  const blockIds = new Set(blockNodes.map((node) => node.id));

  graph.nodes.forEach((node) => {
    const block = node.data.userBlockId ? blocks.get(node.data.userBlockId) : undefined;
    if (!block) {
      nextNodes.push(node);
      return;
    }

    block.nodes.filter(isFlowNodeLike).forEach((inner) => {
      const innerNode = cloneJson(inner) as CustomNodeType;
      const params = cloneJson(innerNode.data.params ?? {});
      block.exposedParams.forEach((input) => {
        if (input.nodeId !== innerNode.id || !input.paramKey) return;
        const blockParam = node.data.params?.[input.id];
        if (!blockParam || !params[input.paramKey]) return;
        params[input.paramKey] = {
          ...params[input.paramKey],
          value: blockParam.value,
        };
      });
      nextNodes.push({
        ...innerNode,
        id: remapId(node.id, innerNode.id),
        selected: false,
        position: {
          x: node.position.x + (innerNode.position?.x ?? 0),
          y: node.position.y + (innerNode.position?.y ?? 0),
        },
        data: {
          ...innerNode.data,
          params,
        },
      });
    });

    block.edges.forEach((edge) => {
      if (!isRecord(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string') return;
      nextEdges.push({
        ...(cloneJson(edge) as Edge),
        id: nanoid(),
        source: remapId(node.id, edge.source),
        target: remapId(node.id, edge.target),
      });
    });
  });

  graph.edges.forEach((edge) => {
    if (blockIds.has(edge.source)) {
      const blockNode = blockNodes.find((node) => node.id === edge.source);
      const block = blockNode?.data.userBlockId ? blocks.get(blockNode.data.userBlockId) : undefined;
      const port = block?.outputs.find((item) => item.id === edge.sourceHandle);
      if (!blockNode || !port) return;
      nextEdges.push({
        ...cloneJson(edge),
        id: nanoid(),
        source: remapId(blockNode.id, port.nodeId),
        sourceHandle: port.paramKey,
      });
      return;
    }
    if (blockIds.has(edge.target)) {
      const blockNode = blockNodes.find((node) => node.id === edge.target);
      const block = blockNode?.data.userBlockId ? blocks.get(blockNode.data.userBlockId) : undefined;
      const port = block?.inputs.find((item) => item.id === edge.targetHandle);
      if (!blockNode || !port) return;
      nextEdges.push({
        ...cloneJson(edge),
        id: nanoid(),
        target: remapId(blockNode.id, port.nodeId),
        targetHandle: port.paramKey,
      });
      return;
    }
    nextEdges.push(edge);
  });

  return { nodes: nextNodes, edges: nextEdges };
}

export function expandUserBlockGraph(nodes: CustomNodeType[], edges: Edge[], blocks: UserBlockDefinition[]): FlowGraph {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  let graph: FlowGraph = { nodes, edges };
  for (let depth = 0; depth < 6; depth += 1) {
    if (!graph.nodes.some((node) => node.data.userBlockId && blockMap.has(node.data.userBlockId))) break;
    graph = expandOnePass(graph, blockMap);
  }
  return graph;
}
