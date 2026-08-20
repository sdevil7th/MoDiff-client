import { type Edge, getIncomers, getOutgoers, type Node } from '@xyflow/react';
import type { ApiGraphExport, NodeParamValue } from '../types/api';
import { studioOffloadPlanConflict } from '../studio/deviceOffload';
import type { NodeData, NodeParams } from './useNodeStore';

export type FlowGraphNode = Node<NodeData, NodeData['type']>;

type SetNodeParam = <K extends keyof NodeParams = 'value'>(
  id: string,
  param: string,
  value: NodeParams[K],
  key?: K,
) => void;

type BuildApiGraphExportOptions = {
  nodes: FlowGraphNode[];
  edges: Edge[];
  sid: string;
  targetNodeId?: string;
  setParam: SetNodeParam;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveRandomFieldValue(
  node: FlowGraphNode,
  paramName: string,
  paramData: NodeParams,
  setParam: SetNodeParam,
) {
  const randomValue = isRecord(paramData.value) ? paramData.value : null;
  const fieldValue = randomValue && 'value' in randomValue ? randomValue.value : paramData.value;
  const isRandom = randomValue && 'isRandom' in randomValue ? Boolean(randomValue.isRandom) : false;

  if (!isRandom) {
    return { isRandom, value: fieldValue };
  }

  const generatedValue = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  setParam(node.id, paramName, { value: generatedValue, isRandom });
  return { isRandom, value: generatedValue };
}

function isNodeDisabled(node: FlowGraphNode) {
  return Boolean(node.data.uiState?.disabled);
}

function hasContainerAncestor(node: FlowGraphNode, ancestorId: string, nodes: FlowGraphNode[]) {
  let parentId = node.parentId;
  let remaining = nodes.length;
  while (parentId && remaining--) {
    if (parentId === ancestorId) return true;
    parentId = nodes.find((candidate) => candidate.id === parentId)?.parentId;
  }
  return false;
}

export function executableFlowNodes(nodes: FlowGraphNode[]) {
  const disabledContainers = nodes.filter(
    (node) => (node.data.type === 'group' || node.data.type === 'loop') && isNodeDisabled(node),
  );
  return nodes.filter(
    (node) =>
      node.data.type !== 'group' &&
      node.data.type !== 'loop' &&
      !isNodeDisabled(node) &&
      !disabledContainers.some((container) => hasContainerAncestor(node, container.id, nodes)) &&
      node.data.module &&
      node.data.action,
  );
}

function paramNumber(node: FlowGraphNode, key: string, fallback: number) {
  const parsed = Number(node.data.params[key]?.value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function paramBoolean(node: FlowGraphNode, key: string, fallback: boolean) {
  const value = node.data.params[key]?.value;
  return typeof value === 'boolean' ? value : fallback;
}

function assertExecutableDeviceOffloadPlan(node: FlowGraphNode) {
  const device = node.data.params.device?.value ?? node.data.params.device?.default;
  if (typeof device !== 'string' || !device.trim()) return;
  const autoOffload = node.data.params.auto_offload?.value ?? node.data.params.auto_offload?.default;
  const rawOffloadMode = node.data.params.offload_mode?.value ?? node.data.params.offload_mode?.default;
  const offloadMode =
    rawOffloadMode === 'none' ||
    rawOffloadMode === 'model_cpu' ||
    rawOffloadMode === 'sequential_cpu' ||
    rawOffloadMode === 'group_cpu' ||
    rawOffloadMode === 'group_disk'
      ? rawOffloadMode
      : undefined;
  const conflict = studioOffloadPlanConflict({
    device,
    autoOffload: typeof autoOffload === 'boolean' ? autoOffload : undefined,
    offloadMode,
  });
  if (conflict) {
    throw new Error(`${node.data.label || node.data.action || node.id} cannot be exported: ${conflict}`);
  }
}

export function buildApiGraphExport({
  nodes,
  edges,
  sid,
  targetNodeId,
  setParam,
}: BuildApiGraphExportOptions): ApiGraphExport {
  const sessionId = sid || '';

  const executableNodes = executableFlowNodes(nodes);

  if (executableNodes.length === 0) {
    return {
      sid: sessionId,
      nodes: {},
      paths: [],
    };
  }

  let targetNode: FlowGraphNode | undefined;
  if (targetNodeId) {
    targetNode = executableNodes.find((node) => node.id === targetNodeId);
    if (!targetNode) {
      throw new Error(`Target node with id ${targetNodeId} not found in executable nodes`);
    }
  }

  const getIncomingNodes = (nodeId: string): FlowGraphNode[] => {
    const node = executableNodes.find((n) => n.id === nodeId);
    if (!node) return [];
    return getIncomers(node, executableNodes, edges);
  };

  const getOutgoingNodes = (nodeId: string): FlowGraphNode[] => {
    const node = executableNodes.find((n) => n.id === nodeId);
    if (!node) return [];
    return getOutgoers(node, executableNodes, edges);
  };

  const walkBackwards = (nodeId: string, visited = new Set<string>()): string[] => {
    if (visited.has(nodeId)) {
      return [];
    }

    visited.add(nodeId);
    const incomingNodes = getIncomingNodes(nodeId);
    const dependencies: string[] = [];
    for (const node of incomingNodes) {
      dependencies.push(...walkBackwards(node.id, visited));
    }

    dependencies.push(nodeId);
    return dependencies;
  };

  let nodesToInclude: string[] = [];

  if (targetNodeId && targetNode) {
    nodesToInclude = walkBackwards(targetNodeId);
  } else {
    const outputNodes = executableNodes.filter((node) => {
      const outgoers = getOutgoingNodes(node.id);
      return outgoers.length === 0;
    });

    const endNodes = outputNodes.length > 0 ? outputNodes : executableNodes;
    const allPathNodes = new Set<string>();
    endNodes.forEach((node) => {
      const path = walkBackwards(node.id);
      path.forEach((nodeId) => allPathNodes.add(nodeId));
    });

    nodesToInclude = Array.from(allPathNodes);
  }

  const filteredExecutableNodes = executableNodes.filter((node) => nodesToInclude.includes(node.id));
  filteredExecutableNodes.forEach(assertExecutableDeviceOffloadPlan);
  const includedNodeIds = new Set(filteredExecutableNodes.map((node) => node.id));

  const nodesExport: ApiGraphExport['nodes'] = {};

  filteredExecutableNodes.forEach((node) => {
    const params: ApiGraphExport['nodes'][string]['params'] = {};

    Object.entries(node.data.params || {}).forEach(([paramName, paramData]) => {
      if (paramData.display === 'output') {
        return;
      }

      const randomField =
        paramData.display === 'random' ? resolveRandomFieldValue(node, paramName, paramData, setParam) : null;
      // The executable graph contains values, not the full registry schema.
      // Preserve backend-owned defaults when a field has not been edited;
      // otherwise JSON serialization drops `undefined` and the worker sees an
      // empty parameter instead of the exact structured model selection.
      const exportValue = randomField ? randomField.value : (paramData.value ?? paramData.default);

      const param: ApiGraphExport['nodes'][string]['params'][string] = {
        value: exportValue as NodeParamValue,
      };
      if (paramData.display !== 'random' || randomField?.isRandom) {
        param.display = paramData.display;
      }
      if (paramData.spawn) {
        param.spawn = true;
      }

      const incomingEdge = edges.find(
        (edge) => edge.target === node.id && edge.targetHandle === paramName && includedNodeIds.has(edge.source),
      );

      if (incomingEdge) {
        param.sourceId = incomingEdge.source;
        param.sourceKey = incomingEdge.sourceHandle || undefined;
      } else if (paramData.dataSource) {
        param.sourceKey = paramData.dataSource;
      }

      params[paramName] = param;
    });

    nodesExport[node.id] = {
      module: node.data.module,
      action: node.data.action,
      params,
    };
  });

  const paths: string[][] = [];

  if (targetNodeId && targetNode) {
    const path = walkBackwards(targetNodeId);
    if (path.length > 0) {
      paths.push(path);
    }
  } else {
    const outputNodes = executableNodes.filter((node) => {
      const outgoers = getOutgoingNodes(node.id);
      return outgoers.length === 0;
    });

    const endNodes = outputNodes.length > 0 ? outputNodes : executableNodes;
    endNodes.forEach((node) => {
      const path = walkBackwards(node.id);
      if (path.length > 0) {
        paths.push(path);
      }
    });
  }

  const loops = nodes
    .filter((node) => node.data.type === 'loop' && !isNodeDisabled(node))
    .map((loopNode) => {
      const body = filteredExecutableNodes.filter((node) => hasContainerAncestor(node, loopNode.id, nodes));
      if (body.length === 0) return null;
      const directBody = body.filter((node) => node.parentId === loopNode.id);
      const inputs = directBody.filter(
        (node) => node.data.module === 'modules.WorkflowControl' && node.data.action === 'LoopInput',
      );
      const indexes = directBody.filter(
        (node) => node.data.module === 'modules.WorkflowControl' && node.data.action === 'LoopIndex',
      );
      const items = directBody.filter(
        (node) => node.data.module === 'modules.WorkflowControl' && node.data.action === 'LoopItems',
      );
      const results = directBody.filter(
        (node) => node.data.module === 'modules.WorkflowControl' && node.data.action === 'LoopResult',
      );
      if (inputs.length > 1 || indexes.length > 1 || items.length > 1 || results.length !== 1) {
        throw new Error(
          `${loopNode.data.label || 'Loop'} needs exactly one Loop Result and at most one Loop Input, Loop Index, and Loop Items node.`,
        );
      }
      const maxIterations = paramNumber(loopNode, 'max_iterations', 100);
      const iterations = paramNumber(loopNode, 'iterations', 1);
      const iterationMode: 'count' | 'collection' =
        loopNode.data.params.iteration_mode?.value === 'collection' ? 'collection' : 'count';
      if (iterationMode === 'collection' && items.length !== 1) {
        throw new Error(`${loopNode.data.label || 'Loop'} needs one Loop Items node in collection mode.`);
      }
      if (maxIterations < 1 || maxIterations > 10000 || iterations < 1 || iterations > maxIterations) {
        throw new Error(`${loopNode.data.label || 'Loop'} iterations must be between 1 and its maximum (up to 10000).`);
      }
      return {
        id: loopNode.id,
        bodyNodeIds: body.map((node) => node.id),
        iterations,
        maxIterations,
        ...(inputs[0] ? { inputNodeId: inputs[0].id } : {}),
        ...(indexes[0] ? { indexNodeId: indexes[0].id } : {}),
        ...(items[0] ? { itemNodeId: items[0].id } : {}),
        resultNodeId: results[0]!.id,
        iterationMode,
        carry: paramBoolean(loopNode, 'carry', true),
        collect: paramBoolean(loopNode, 'collect', true),
        durable: paramBoolean(loopNode, 'durable', false),
        maxRetries: Math.max(0, Math.min(10, paramNumber(loopNode, 'max_retries', 1))),
        ...(loopNode.parentId ? { parentLoopId: loopNode.parentId } : {}),
      };
    })
    .filter((loop): loop is NonNullable<typeof loop> => Boolean(loop));

  return {
    sid: sessionId,
    nodes: nodesExport,
    paths,
    ...(loops.length > 0 ? { loops } : {}),
  };
}
