import { type Edge, getIncomers, getOutgoers, type Node } from '@xyflow/react';
import type { ApiGraphExport, NodeParamValue } from '../types/api';
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

export function buildApiGraphExport({
  nodes,
  edges,
  sid,
  targetNodeId,
  setParam,
}: BuildApiGraphExportOptions): ApiGraphExport {
  const sessionId = sid || '';

  const executableNodes = nodes.filter(
    (node) => node.data.type !== 'group' && !isNodeDisabled(node) && node.data.module && node.data.action,
  );

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
      const exportValue = randomField ? randomField.value : paramData.value;

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

  return {
    sid: sessionId,
    nodes: nodesExport,
    paths,
  };
}
