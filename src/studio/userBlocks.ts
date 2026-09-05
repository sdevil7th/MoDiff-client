import { nanoid } from 'nanoid';
import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { AppModeInput, UserBlockDefinition, UserBlockPort, WorkflowBlueprint } from './types';
import { classifyManagedControl } from './managedControlPolicy';
import { arrangeGraphNodes } from '../workflow/graphLayout';
import { compositeChildNodeId, compositeInstanceChildren } from './compositeNodes';
import { connectionTypes, connectionTypesAreCompatible } from '../theme/connectionTypes';
import { blockProjectionNodeIdV2, isBlockRootV2 } from './blockRuntimeV2';

type FlowGraph = {
  nodes: CustomNodeType[];
  edges: Edge[];
};

export const USER_BLOCK_DRAG_PREFIX = 'modiff-user-block:';
export const USER_BLOCK_CHILD_LEFT = 32;
export const USER_BLOCK_CHILD_TOP = 64;
export const USER_BLOCK_HORIZONTAL_PADDING = 64;
export const USER_BLOCK_VERTICAL_PADDING = 96;
export const USER_BLOCK_COLLAPSED_WIDTH = 340;
export const USER_BLOCK_COLLAPSED_HEIGHT = 360;
export const USER_BLOCK_INPUT_BRIDGE_PREFIX = '__block_input__';
export const USER_BLOCK_OUTPUT_BRIDGE_PREFIX = '__block_output__';
export const USER_BLOCK_PREVIEW_PREFIX = '__block_preview__';

const USER_BLOCK_PREVIEW_DISPLAYS = new Set(['ui_image', 'ui_video', 'ui_audio', 'ui_text', 'ui_imagecompare']);

export type BlockSelectionResult =
  | { ok: true; block: UserBlockDefinition; blockNode: CustomNodeType; nodes: CustomNodeType[]; edges: Edge[] }
  | { ok: false; reason: string };

export type UserBlockCompositionIssue = {
  id: string;
  kind: 'nested_container' | 'broken_link' | 'invalid_direction' | 'type_mismatch' | 'state_identity_mismatch';
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type UserBlockInsertionSuggestion = {
  id: string;
  nodeId: string;
  edgeId: string;
  sourceNodeId: string;
  sourceHandle: string;
  inputHandle: string;
  outputHandle: string;
  targetNodeId: string;
  targetHandle: string;
  label: string;
  score: number;
};

export type UserBlockCompositionReport = {
  valid: boolean;
  issues: UserBlockCompositionIssue[];
  insertionSuggestions: UserBlockInsertionSuggestion[];
};

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
  return nodes.filter((node) => node.selected && node.data.type !== 'group' && node.data.type !== 'loop');
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

function paramDirection(param: NodeParams): 'input' | 'output' | null {
  const display = param.isInput ? 'input' : param.display;
  return display === 'input' || display === 'output' ? display : null;
}

function parameterValue(node: CustomNodeType, key: string) {
  const parameter = node.data.params?.[key];
  return parameter?.value ?? parameter?.default;
}

function exactTypeMatch(left: unknown, right: unknown) {
  const leftTypes = connectionTypes(left).filter((item) => item !== 'any');
  const rightTypes = connectionTypes(right).filter((item) => item !== 'any');
  return leftTypes.some((item) => rightTypes.includes(item));
}

function internalUserBlockEdges(graph: FlowGraph, instanceId: string) {
  const children = new Set(
    graph.nodes.filter((node) => node.data.userBlockInstanceId === instanceId).map((node) => node.id),
  );
  return graph.edges.filter((edge) => children.has(edge.source) && children.has(edge.target));
}

function modularWorkflowIdentity(node: CustomNodeType) {
  const pipelineClass = parameterValue(node, 'pipeline_class');
  const workflowId = parameterValue(node, 'workflow_id');
  return {
    pipelineClass: typeof pipelineClass === 'string' && pipelineClass ? pipelineClass : null,
    workflowId: typeof workflowId === 'string' && workflowId ? workflowId : null,
  };
}

function modularWorkflowStateConnection(source: NodeParams | undefined, target: NodeParams | undefined) {
  const types = new Set([...connectionTypes(source?.type), ...connectionTypes(target?.type)]);
  return types.has('modular_workflow_state');
}

function compatibleInsertionSuggestions(
  graph: FlowGraph,
  instanceId: string,
  children: CustomNodeType[],
  issuesByEdge: Set<string>,
) {
  const nodesById = new Map(children.map((node) => [node.id, node]));
  const internalEdges = internalUserBlockEdges(graph, instanceId).filter((edge) => !issuesByEdge.has(edge.id));
  const connectedNodeIds = new Set(internalEdges.flatMap((edge) => [edge.source, edge.target]));
  return children
    .filter((node) => !connectedNodeIds.has(node.id))
    .flatMap((candidate) => {
      const inputs = Object.entries(candidate.data.params ?? {}).filter(
        ([, param]) => !param.hidden && paramDirection(param) === 'input',
      );
      const outputs = Object.entries(candidate.data.params ?? {}).filter(
        ([, param]) => !param.hidden && paramDirection(param) === 'output',
      );
      if (!inputs.length || !outputs.length) return [];
      return internalEdges.flatMap((edge) => {
        const source = nodesById.get(edge.source);
        const target = nodesById.get(edge.target);
        const sourceHandle = edge.sourceHandle ?? '';
        const targetHandle = edge.targetHandle ?? '';
        const sourceParam = source?.data.params?.[sourceHandle];
        const targetParam = target?.data.params?.[targetHandle];
        if (!source || !target || !sourceParam || !targetParam) return [];
        return inputs.flatMap(([inputHandle, inputParam]) =>
          outputs.flatMap(([outputHandle, outputParam]) => {
            if (
              !connectionTypesAreCompatible(sourceParam.type, inputParam.type) ||
              !connectionTypesAreCompatible(outputParam.type, targetParam.type)
            )
              return [];
            const score =
              (exactTypeMatch(sourceParam.type, inputParam.type) ? 2 : 0) +
              (exactTypeMatch(outputParam.type, targetParam.type) ? 2 : 0);
            return [
              {
                id: `${candidate.id}\u0000${edge.id}\u0000${inputHandle}\u0000${outputHandle}`,
                nodeId: candidate.id,
                edgeId: edge.id,
                sourceNodeId: source.id,
                sourceHandle,
                inputHandle,
                outputHandle,
                targetNodeId: target.id,
                targetHandle,
                label: `Insert ${nodeLabel(candidate)} between ${nodeLabel(source)} and ${nodeLabel(target)}`,
                score,
              } satisfies UserBlockInsertionSuggestion,
            ];
          }),
        );
      });
    })
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
}

/**
 * Validate the graph that an expanded User Node will persist and execute.
 *
 * This is the MoDiff graph composition boundary. It validates concrete node
 * sockets and the sealed process-local Modular workflow-state identity. It does
 * not claim that an arbitrary MoDiff node is an upstream
 * `ModularPipelineBlocks` object; reviewed upstream block-tree edits use their
 * separate pinned composition receipt and `init_pipeline()` validation.
 */
export function inspectUserBlockComposition(graph: FlowGraph, instanceId: string): UserBlockCompositionReport {
  const root = graph.nodes.find((node) => node.id === instanceId && node.data.type === 'block');
  if (!root) {
    return {
      valid: false,
      issues: [{ id: `missing-root:${instanceId}`, kind: 'broken_link', message: 'The User Node root is missing.' }],
      insertionSuggestions: [],
    };
  }
  const children = graph.nodes.filter((node) => node.data.userBlockInstanceId === instanceId);
  const nodesById = new Map(children.map((node) => [node.id, node]));
  const issues: UserBlockCompositionIssue[] = [];
  const issuesByEdge = new Set<string>();

  children.forEach((node) => {
    if (node.data.type !== 'block' && node.data.type !== 'cluster') return;
    issues.push({
      id: `nested:${node.id}`,
      kind: 'nested_container',
      nodeId: node.id,
      message: `${nodeLabel(node)} cannot be nested inside a User Node. Add its ordinary internal nodes instead.`,
    });
  });

  internalUserBlockEdges(graph, instanceId).forEach((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    const sourceHandle = edge.sourceHandle ?? '';
    const targetHandle = edge.targetHandle ?? '';
    const sourceParam = source?.data.params?.[sourceHandle];
    const targetParam = target?.data.params?.[targetHandle];
    if (!source || !target || !sourceHandle || !targetHandle || !sourceParam || !targetParam) {
      issuesByEdge.add(edge.id);
      issues.push({
        id: `broken:${edge.id}`,
        kind: 'broken_link',
        edgeId: edge.id,
        message: 'A User Node connection points to a node or socket that no longer exists.',
      });
      return;
    }
    if (paramDirection(sourceParam) !== 'output' || paramDirection(targetParam) !== 'input') {
      issuesByEdge.add(edge.id);
      issues.push({
        id: `direction:${edge.id}`,
        kind: 'invalid_direction',
        edgeId: edge.id,
        nodeId: target.id,
        message: `${nodeLabel(source)}.${sourceHandle} must connect from an output to an input socket.`,
      });
      return;
    }
    if (!connectionTypesAreCompatible(sourceParam.type, targetParam.type)) {
      issuesByEdge.add(edge.id);
      const sourceTypes = connectionTypes(sourceParam.type).join(' or ') || 'untyped';
      const targetTypes = connectionTypes(targetParam.type).join(' or ') || 'untyped';
      issues.push({
        id: `type:${edge.id}`,
        kind: 'type_mismatch',
        edgeId: edge.id,
        nodeId: target.id,
        message: `${nodeLabel(source)}.${sourceHandle} (${sourceTypes}) cannot connect to ${nodeLabel(target)}.${targetHandle} (${targetTypes}).`,
      });
      return;
    }
    if (modularWorkflowStateConnection(sourceParam, targetParam)) {
      const sourceIdentity = modularWorkflowIdentity(source);
      const targetIdentity = modularWorkflowIdentity(target);
      if (
        (sourceIdentity.pipelineClass &&
          targetIdentity.pipelineClass &&
          sourceIdentity.pipelineClass !== targetIdentity.pipelineClass) ||
        (sourceIdentity.workflowId &&
          targetIdentity.workflowId &&
          sourceIdentity.workflowId !== targetIdentity.workflowId)
      ) {
        issuesByEdge.add(edge.id);
        issues.push({
          id: `state-identity:${edge.id}`,
          kind: 'state_identity_mismatch',
          edgeId: edge.id,
          nodeId: target.id,
          message: `The Modular workflow state from ${nodeLabel(source)} belongs to ${sourceIdentity.pipelineClass ?? 'another pipeline'}/${sourceIdentity.workflowId ?? 'another workflow'}, not ${targetIdentity.pipelineClass ?? 'this pipeline'}/${targetIdentity.workflowId ?? 'this workflow'}.`,
        });
      }
    }
  });

  return {
    valid: issues.length === 0,
    issues,
    insertionSuggestions: compatibleInsertionSuggestions(graph, instanceId, children, issuesByEdge),
  };
}

export function inspectUserBlockCompositions(
  graph: FlowGraph,
  blocks: UserBlockDefinition[] = [],
): Array<{ instanceId: string; label: string; report: UserBlockCompositionReport }> {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  return graph.nodes
    .filter((node) => node.data.type === 'block')
    .map((root) => {
      const definition = blockDefinitionForNode(root, blockMap);
      if (!definition) {
        return {
          instanceId: root.id,
          label: nodeLabel(root),
          report: {
            valid: false,
            issues: [
              {
                id: `missing-definition:${root.id}`,
                kind: 'broken_link' as const,
                message: `${nodeLabel(root)} has no embedded or reusable User Node definition.`,
              },
            ],
            insertionSuggestions: [],
          },
        };
      }
      const children = materializedBlockChildren(graph, root, definition);
      const edges = materializedBlockInternalEdges(graph, root, definition, children);
      return {
        instanceId: root.id,
        label: nodeLabel(root),
        report: inspectUserBlockComposition({ nodes: [root, ...children], edges }, root.id),
      };
    });
}

export function insertNodeAtUserBlockSuggestion(
  graph: FlowGraph,
  instanceId: string,
  suggestion: UserBlockInsertionSuggestion,
): FlowGraph {
  const report = inspectUserBlockComposition(graph, instanceId);
  const current = report.insertionSuggestions.find((item) => item.id === suggestion.id);
  if (!current) throw new Error('That compatible User Node insertion point is no longer available.');
  const replaced = graph.edges.find((edge) => edge.id === current.edgeId);
  if (!replaced) throw new Error('The User Node connection selected for insertion no longer exists.');
  const internalData = {
    ...(isRecord(replaced.data) ? replaced.data : {}),
    userBlockInstanceId: instanceId,
    userBlockInternal: true,
  };
  return {
    nodes: graph.nodes,
    edges: [
      ...graph.edges.filter((edge) => edge.id !== replaced.id),
      {
        ...cloneJson(replaced),
        id: nanoid(),
        target: current.nodeId,
        targetHandle: current.inputHandle,
        data: internalData,
      },
      {
        ...cloneJson(replaced),
        id: nanoid(),
        source: current.nodeId,
        sourceHandle: current.outputHandle,
        data: internalData,
      },
    ],
  };
}

function portIdentity(port: Pick<UserBlockPort, 'nodeId' | 'paramKey'>) {
  return `${port.nodeId}\u0000${port.paramKey}`;
}

function uniquePortId(nodeId: string, paramKey: string, direction: 'input' | 'output', usedIds: Set<string>) {
  const base = `${safeHandle(nodeId, direction)}__${safeHandle(paramKey, direction)}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function edgeHandle(edge: unknown, direction: 'input' | 'output') {
  if (!isRecord(edge)) return null;
  const value = direction === 'input' ? edge.targetHandle : edge.sourceHandle;
  return typeof value === 'string' && value ? value : null;
}

function internalHandleIdentities(edges: unknown[], direction: 'input' | 'output') {
  const identities = new Set<string>();
  edges.forEach((edge) => {
    if (!isRecord(edge)) return;
    const nodeId = direction === 'input' ? edge.target : edge.source;
    const handle = edgeHandle(edge, direction);
    if (typeof nodeId === 'string' && handle) identities.add(`${nodeId}\u0000${handle}`);
  });
  return identities;
}

function normalizedBoundaryPorts(
  nodes: CustomNodeType[],
  edges: unknown[],
  existing: UserBlockPort[],
  direction: 'input' | 'output',
) {
  const usedIds = new Set<string>();
  const byIdentity = new Map<string, UserBlockPort>();
  const internallyConnected = internalHandleIdentities(edges, direction);
  existing.forEach((port) => {
    if (!port?.nodeId || !port?.paramKey || byIdentity.has(portIdentity(port))) return;
    if (direction === 'input' && internallyConnected.has(portIdentity(port))) return;
    let id = safeHandle(port.id, `${direction}-${byIdentity.size + 1}`);
    if (usedIds.has(id)) id = uniquePortId(port.nodeId, port.paramKey, direction, usedIds);
    else usedIds.add(id);
    byIdentity.set(portIdentity(port), { ...cloneJson(port), id });
  });

  nodes.forEach((node) => {
    Object.entries(node.data.params ?? {}).forEach(([paramKey, param]) => {
      if (param.hidden || paramDirection(param) !== direction) return;
      const identity = `${node.id}\u0000${paramKey}`;
      // Inputs already supplied by an internal edge are not valid block
      // injection points. Outputs remain exposable because graph outputs can
      // fan out even when another internal node already consumes them.
      if ((direction === 'input' && internallyConnected.has(identity)) || byIdentity.has(identity)) return;
      byIdentity.set(identity, {
        id: uniquePortId(node.id, paramKey, direction, usedIds),
        label: paramLabel(node, paramKey),
        nodeId: node.id,
        paramKey,
        type: param.type,
      });
    });
  });
  return [...byIdentity.values()];
}

function normalizedBlockNodePositions(nodes: CustomNodeType[]) {
  const roots = nodes.filter((node) => !node.parentId);
  if (roots.length === 0) return nodes;
  const minX = Math.min(...roots.map((node) => node.position.x));
  const minY = Math.min(...roots.map((node) => node.position.y));
  if (minX === 0 && minY === 0) return nodes;
  return nodes.map((node) =>
    node.parentId
      ? node
      : {
          ...node,
          position: {
            x: node.position.x - minX,
            y: node.position.y - minY,
          },
        },
  );
}

/**
 * Repairs legacy block definitions and derives the sockets a closed selected
 * subgraph can expose. A concrete internal handle is a block boundary handle
 * when no internal edge consumes it (input) or leaves it (output).
 */
export function normalizeUserBlockDefinition(block: UserBlockDefinition): UserBlockDefinition {
  const cloned = cloneJson(block);
  const sourceNodes = cloned.nodes.filter(isFlowNodeLike).map((node) => node as CustomNodeType);
  const repairLegacyLayout =
    sourceNodes.length > 1 && (cloned.inputs?.length ?? 0) === 0 && (cloned.outputs?.length ?? 0) === 0;
  const laidOutNodes = repairLegacyLayout
    ? arrangeGraphNodes(
        sourceNodes.map((node) => ({ ...node, parentId: undefined })),
        cloned.edges.filter(isRecord).map((edge) => edge as unknown as Edge),
      )
    : sourceNodes;
  const nodes = normalizedBlockNodePositions(laidOutNodes);
  return {
    ...cloned,
    nodes,
    inputs: normalizedBoundaryPorts(nodes, cloned.edges, cloned.inputs ?? [], 'input'),
    outputs: normalizedBoundaryPorts(nodes, cloned.edges, cloned.outputs ?? [], 'output'),
  };
}

export function userBlockPreviewParamId(nodeId: string, paramKey: string) {
  return `${USER_BLOCK_PREVIEW_PREFIX}${safeHandle(nodeId, 'node')}__${safeHandle(paramKey, 'preview')}`;
}

export function userBlockPreviewSource(
  blockNodeId: string,
  blockFieldKey: string,
  fieldOptions: Record<string, unknown> | undefined,
) {
  const sourceNodeId =
    typeof fieldOptions?.userBlockSourceNodeId === 'string' ? fieldOptions.userBlockSourceNodeId : null;
  const sourceFieldKey =
    typeof fieldOptions?.userBlockSourceFieldKey === 'string' ? fieldOptions.userBlockSourceFieldKey : blockFieldKey;
  return {
    nodeId: sourceNodeId ? instanceChildId(blockNodeId, sourceNodeId) : blockNodeId,
    fieldKey: sourceFieldKey,
  };
}

export function collapsedUserBlockPreviewTarget(
  nodes: CustomNodeType[],
  runtimeNodeId: string,
  fieldKey: string,
): { nodeId: string; fieldKey: string } | null {
  for (const blockNode of nodes) {
    if (blockNode.data.type !== 'block' || blockNode.data.uiState?.blockExpanded) continue;
    const definition = blockNode.data.userBlockSnapshot
      ? normalizeUserBlockDefinition(blockNode.data.userBlockSnapshot)
      : null;
    if (!definition) continue;
    const source = definition.nodes
      .filter(isFlowNodeLike)
      .map((node) => node as CustomNodeType)
      .find(
        (node) =>
          instanceChildId(blockNode.id, node.id) === runtimeNodeId &&
          USER_BLOCK_PREVIEW_DISPLAYS.has(node.data.params?.[fieldKey]?.display ?? ''),
      );
    if (!source) continue;
    return {
      nodeId: blockNode.id,
      fieldKey: userBlockPreviewParamId(source.id, fieldKey),
    };
  }
  return null;
}

export type BlockPreviewTargetV2 = {
  rootId: string;
  nodeId: string;
  outputPortId: string;
  mediaType: 'image' | 'video' | 'audio' | 'text' | 'file';
};

/**
 * Resolve a concrete runtime output back to its declared Block V2 preview.
 * Runtime node ids are deterministic projections; preview state remains on
 * the owning BlockInstanceV2 whether its canvas projection is open or closed.
 */
export function blockPreviewTargetV2(
  nodes: CustomNodeType[],
  runtimeNodeId: string,
  outputPortId: string,
): BlockPreviewTargetV2 | null {
  const matches = nodes.flatMap((node): BlockPreviewTargetV2[] => {
    if (!isBlockRootV2(node)) return [];
    const instance = node.data.blockInstanceV2;
    if (!instance) return [];
    const preview = instance.previewStates.find(
      (candidate) =>
        blockProjectionNodeIdV2(instance.instanceId, candidate.binding.nodeId) === runtimeNodeId &&
        candidate.binding.outputPortId === outputPortId,
    );
    return preview
      ? [
          {
            rootId: node.id,
            nodeId: preview.binding.nodeId,
            outputPortId: preview.binding.outputPortId,
            mediaType: preview.binding.mediaType,
          },
        ]
      : [];
  });
  // Duplicate canvas ids or ambiguous preview ownership is invalid state. Do
  // not let a runtime message guess which durable instance it may mutate.
  return matches.length === 1 ? matches[0]! : null;
}

export function runtimeProgressTarget(nodes: CustomNodeType[], runtimeNodeId: string, currentNodeName?: string | null) {
  const directNode = nodes.find((node) => node.id === runtimeNodeId);
  if (directNode?.data.huggingFaceClusterRole === 'execution') {
    const root = nodes.find(
      (node) => node.id === directNode.data.huggingFaceClusterInstanceId && node.data.huggingFaceClusterRole === 'root',
    );
    if (root && !root.data.huggingFaceClusterInstance?.presentation.expanded) return root.id;
  }
  if (directNode) return runtimeNodeId;

  for (const blockNode of nodes) {
    if (!isBlockRootV2(blockNode)) continue;
    const instance = blockNode.data.blockInstanceV2;
    if (!instance || instance.presentation.expanded) continue;
    if (
      instance.effectiveGraph.nodes.some(
        ({ nodeId }) => blockProjectionNodeIdV2(instance.instanceId, nodeId) === runtimeNodeId,
      )
    )
      return blockNode.id;
  }

  for (const blockNode of nodes) {
    if (blockNode.data.type !== 'block' || blockNode.data.uiState?.blockExpanded) continue;
    const definition = blockNode.data.userBlockSnapshot
      ? normalizeUserBlockDefinition(blockNode.data.userBlockSnapshot)
      : null;
    if (!definition) continue;
    const ownsRuntimeNode = definition.nodes
      .filter(isFlowNodeLike)
      .some((node) => instanceChildId(blockNode.id, node.id) === runtimeNodeId);
    if (ownsRuntimeNode) return blockNode.id;
  }

  const normalizedName = String(currentNodeName ?? '').trim();
  if (!normalizedName) return null;
  const exactMatches = nodes.filter(
    (node) => `${node.data.module}.${node.data.action}` === normalizedName || node.data.label === normalizedName,
  );
  return exactMatches.length === 1 ? exactMatches[0]!.id : null;
}

function previewParamsForNodes(nodes: CustomNodeType[]) {
  return nodes.flatMap((node) =>
    Object.entries(node.data.params ?? {})
      .filter(([, param]) => USER_BLOCK_PREVIEW_DISPLAYS.has(param.display ?? ''))
      .map(([paramKey, param]) => {
        const id = userBlockPreviewParamId(node.id, paramKey);
        return [
          id,
          {
            ...cloneJson(param),
            label: param.label || nodeLabel(node),
            fieldOptions: {
              ...(param.fieldOptions ?? {}),
              compactPreview: true,
              userBlockSourceNodeId: node.id,
              userBlockSourceFieldKey: paramKey,
            },
          } satisfies NodeParams,
        ] as const;
      }),
  );
}

export type UserBlockContentGroup = {
  id: string;
  label: string;
  module: string;
  action: string;
  controlParams: Record<string, NodeParams>;
  previewParams: Record<string, NodeParams>;
};

function blockNodesInExecutionOrder(definition: UserBlockDefinition) {
  const nodes = definition.nodes.filter(isFlowNodeLike).map((node) => node as CustomNodeType);
  const ids = new Set(nodes.map((item) => item.id));
  const index = new Map(nodes.map((item, order) => [item.id, order]));
  const incoming = new Map(nodes.map((item) => [item.id, 0]));
  const outgoing = new Map(nodes.map((item) => [item.id, [] as string[]]));

  definition.edges.forEach((value) => {
    if (!isRecord(value) || typeof value.source !== 'string' || typeof value.target !== 'string') return;
    if (!ids.has(value.source) || !ids.has(value.target)) return;
    outgoing.get(value.source)?.push(value.target);
    incoming.set(value.target, (incoming.get(value.target) ?? 0) + 1);
  });

  const ready = nodes.filter((item) => incoming.get(item.id) === 0);
  const ordered: CustomNodeType[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => (index.get(left.id) ?? 0) - (index.get(right.id) ?? 0));
    const current = ready.shift();
    if (!current) break;
    ordered.push(current);
    outgoing.get(current.id)?.forEach((targetId) => {
      const nextCount = (incoming.get(targetId) ?? 1) - 1;
      incoming.set(targetId, nextCount);
      if (nextCount === 0) {
        const target = nodes.find((item) => item.id === targetId);
        if (target) ready.push(target);
      }
    });
  }

  const included = new Set(ordered.map((item) => item.id));
  return [...ordered, ...nodes.filter((item) => !included.has(item.id))];
}

export function userBlockCollapsedContentGroups(
  definition: UserBlockDefinition,
  params: Record<string, NodeParams>,
): UserBlockContentGroup[] {
  const exposedByNode = new Map<string, typeof definition.exposedParams>();
  definition.exposedParams.forEach((input) => {
    if (!input.nodeId) return;
    const current = exposedByNode.get(input.nodeId) ?? [];
    current.push(input);
    exposedByNode.set(input.nodeId, current);
  });
  const previewsByNode = new Map<string, Record<string, NodeParams>>();
  Object.entries(params).forEach(([key, param]) => {
    if (!key.startsWith(USER_BLOCK_PREVIEW_PREFIX)) return;
    const sourceNodeId =
      typeof param.fieldOptions?.userBlockSourceNodeId === 'string' ? param.fieldOptions.userBlockSourceNodeId : null;
    if (!sourceNodeId) return;
    const current = previewsByNode.get(sourceNodeId) ?? {};
    current[key] = param;
    previewsByNode.set(sourceNodeId, current);
  });

  return blockNodesInExecutionOrder(definition).flatMap((sourceNode) => {
    const inputs = exposedByNode.get(sourceNode.id) ?? [];
    const controlParams = Object.fromEntries(
      inputs.flatMap((input) => {
        const blockParam = params[input.id];
        if (!blockParam || !input.paramKey) return [];
        const sourceParam = sourceNode.data.params?.[input.paramKey];
        return [
          [
            input.id,
            {
              ...blockParam,
              label:
                sourceParam?.label ??
                input.paramKey.charAt(0).toUpperCase() + input.paramKey.slice(1).replace(/_/g, ' '),
            },
          ],
        ];
      }),
    );
    const previewParams = previewsByNode.get(sourceNode.id) ?? {};
    if (Object.keys(controlParams).length === 0 && Object.keys(previewParams).length === 0) return [];
    return [
      {
        id: sourceNode.id,
        label: sourceNode.data.label || `${sourceNode.data.module}.${sourceNode.data.action}`,
        module: sourceNode.data.module,
        action: sourceNode.data.action,
        controlParams,
        previewParams,
      },
    ];
  });
}

function exposedParamsForNodes(nodes: CustomNodeType[], includeAdvanced = false): AppModeInput[] {
  return nodes.flatMap((node) =>
    editableParamEntries(node)
      .filter(([key, param]) => {
        if (!node.data.studioRole) return true;
        const surface = classifyManagedControl(node.data.studioRole, key, param).surface;
        return surface === 'main' || (includeAdvanced && surface === 'advanced');
      })
      .map(([key, param]) => ({
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

export function createUserBlockNode(
  block: UserBlockDefinition,
  position: CustomNodeType['position'],
  id = nanoid(),
): CustomNodeType {
  const normalizedBlock = normalizeUserBlockDefinition(block);
  const sourceNodes = normalizedBlock.nodes.filter(isFlowNodeLike).map((node) => node as CustomNodeType);
  const nodesById = new Map(sourceNodes.map((node) => [node.id, node]));
  const params: Record<string, NodeParams> = {};

  normalizedBlock.inputs.forEach((port) => {
    params[port.id] = {
      label: port.label,
      display: 'input',
      type: port.type,
      isConnected: false,
    };
  });
  previewParamsForNodes(sourceNodes).forEach(([id, param]) => {
    params[id] = param;
  });
  normalizedBlock.exposedParams.forEach((input) => {
    const param = exposedParamToNodeParam(nodesById, input);
    if (param) params[input.id] = param;
  });
  normalizedBlock.outputs.forEach((port) => {
    params[port.id] = {
      label: port.label,
      display: 'output',
      type: port.type,
      isConnected: false,
    };
  });

  return {
    id,
    type: 'block',
    position,
    selected: true,
    width: USER_BLOCK_COLLAPSED_WIDTH,
    height: USER_BLOCK_COLLAPSED_HEIGHT,
    data: {
      type: 'block',
      module: 'modiff.user_blocks',
      action: normalizedBlock.id,
      label: normalizedBlock.name,
      category: 'User Nodes',
      description: 'Reusable user block',
      params,
      resizable: true,
      userBlockId: normalizedBlock.id,
      userBlockSnapshot: normalizedBlock,
      uiState: {
        blockExpanded: false,
        blockCollapsedWidth: USER_BLOCK_COLLAPSED_WIDTH,
        blockCollapsedHeight: USER_BLOCK_COLLAPSED_HEIGHT,
      },
      style: {},
    },
  };
}

function isFlowNodeLike(value: unknown): value is { id: string; data?: unknown; position?: unknown } {
  return isRecord(value) && typeof value.id === 'string' && isRecord(value.data);
}

function blockDefinitionForNode(
  node: CustomNodeType,
  blocks: Map<string, UserBlockDefinition>,
): UserBlockDefinition | undefined {
  if (node.data.userBlockSnapshot) return normalizeUserBlockDefinition(node.data.userBlockSnapshot);
  const definition = node.data.userBlockId ? blocks.get(node.data.userBlockId) : undefined;
  return definition ? normalizeUserBlockDefinition(definition) : undefined;
}

function stripBlockInstanceData(node: CustomNodeType, sourceId: string, position: CustomNodeType['position']) {
  const data = { ...cloneJson(node.data) };
  const clonedNode = cloneJson(node);
  delete clonedNode.measured;
  delete data.userBlockInstanceId;
  delete data.userBlockSourceNodeId;
  return {
    ...clonedNode,
    id: sourceId,
    parentId: undefined,
    extent: undefined,
    expandParent: undefined,
    selected: false,
    dragging: false,
    position,
    data,
  } satisfies CustomNodeType;
}

function stripBlockEdgeData(edge: Edge) {
  const data = isRecord(edge.data) ? { ...edge.data } : undefined;
  if (data) {
    delete data.userBlockInstanceId;
    delete data.userBlockBridge;
    delete data.userBlockInternal;
  }
  return {
    ...cloneJson(edge),
    data: data && Object.keys(data).length > 0 ? data : undefined,
  } satisfies Edge;
}

function isBlockBridgeEdge(edge: Edge, instanceId?: string) {
  return Boolean(
    isRecord(edge.data) &&
    edge.data.userBlockBridge === true &&
    (!instanceId || edge.data.userBlockInstanceId === instanceId),
  );
}

function isBlockInternalEdge(edge: Edge, instanceId?: string) {
  return Boolean(
    isRecord(edge.data) &&
    edge.data.userBlockInternal === true &&
    (!instanceId || edge.data.userBlockInstanceId === instanceId),
  );
}

function sourceNodeId(node: CustomNodeType) {
  return node.data.userBlockSourceNodeId || node.id;
}

function instanceChildId(instanceId: string, definitionNodeId: string) {
  return compositeChildNodeId(instanceId, definitionNodeId);
}

function materializedBlockChildren(
  graph: FlowGraph,
  blockNode: CustomNodeType,
  definition: UserBlockDefinition,
  options: { selected?: boolean; absolute?: boolean } = {},
) {
  const existingChildren = graph.nodes.filter((node) => node.data.userBlockInstanceId === blockNode.id);
  if (existingChildren.length > 0) {
    return existingChildren.map((node) => {
      const rootChild = !node.parentId || node.parentId === blockNode.id;
      return {
        ...cloneJson(node),
        selected: options.selected ?? node.selected,
        parentId: rootChild ? (options.absolute ? blockNode.parentId : blockNode.id) : node.parentId,
        position:
          options.absolute && rootChild
            ? {
                x: blockNode.position.x + node.position.x,
                y: blockNode.position.y + node.position.y,
              }
            : node.position,
      };
    });
  }

  return definition.nodes.filter(isFlowNodeLike).map((value) => {
    const source = cloneJson(value) as CustomNodeType;
    const params = cloneJson(source.data.params ?? {});
    definition.exposedParams.forEach((input) => {
      if (input.nodeId !== source.id || !input.paramKey) return;
      const blockParam = blockNode.data.params?.[input.id];
      if (!blockParam || !params[input.paramKey]) return;
      params[input.paramKey] = {
        ...params[input.paramKey],
        value: blockParam.value,
      };
    });
    return {
      ...source,
      id: instanceChildId(blockNode.id, source.id),
      parentId: source.parentId
        ? instanceChildId(blockNode.id, source.parentId)
        : options.absolute
          ? blockNode.parentId
          : blockNode.id,
      extent: undefined,
      expandParent: options.absolute ? undefined : true,
      selected: options.selected ?? false,
      position: source.parentId
        ? source.position
        : options.absolute
          ? {
              x: blockNode.position.x + USER_BLOCK_CHILD_LEFT + (source.position?.x ?? 0),
              y: blockNode.position.y + USER_BLOCK_CHILD_TOP + (source.position?.y ?? 0),
            }
          : {
              x: USER_BLOCK_CHILD_LEFT + (source.position?.x ?? 0),
              y: USER_BLOCK_CHILD_TOP + (source.position?.y ?? 0),
            },
      data: {
        ...source.data,
        params,
        userBlockInstanceId: blockNode.id,
        userBlockSourceNodeId: source.id,
      },
    } satisfies CustomNodeType;
  });
}

function materializedBlockInternalEdges(
  graph: FlowGraph,
  blockNode: CustomNodeType,
  definition: UserBlockDefinition,
  children: CustomNodeType[],
) {
  const childIds = new Set(children.map((node) => node.id));
  const existing = graph.edges.filter(
    (edge) =>
      isBlockInternalEdge(edge, blockNode.id) ||
      (!isBlockBridgeEdge(edge, blockNode.id) && childIds.has(edge.source) && childIds.has(edge.target)),
  );
  if (existing.length > 0) return existing.map(cloneJson);
  const idBySource = new Map(children.map((node) => [sourceNodeId(node), node.id]));
  return definition.edges.flatMap((value) => {
    if (!isRecord(value) || typeof value.source !== 'string' || typeof value.target !== 'string') return [];
    const source = idBySource.get(value.source);
    const target = idBySource.get(value.target);
    if (!source || !target) return [];
    const edge = cloneJson(value) as Edge;
    return [
      {
        ...edge,
        id: nanoid(),
        source,
        target,
        data: {
          ...(isRecord(edge.data) ? edge.data : {}),
          userBlockInstanceId: blockNode.id,
          userBlockInternal: true,
        },
      },
    ];
  });
}

function expandedBlockExternalEdges(
  graph: FlowGraph,
  blockNode: CustomNodeType,
  definition: UserBlockDefinition,
  children: CustomNodeType[],
) {
  const idBySource = new Map(children.map((node) => [sourceNodeId(node), node.id]));
  const childIds = new Set(children.map((node) => node.id));
  const result: Edge[] = [];
  graph.edges
    .filter((edge) => {
      if (isBlockBridgeEdge(edge, blockNode.id) || isBlockInternalEdge(edge, blockNode.id)) return false;
      const sourceChild = childIds.has(edge.source);
      const targetChild = childIds.has(edge.target);
      return sourceChild !== targetChild && edge.source !== blockNode.id && edge.target !== blockNode.id;
    })
    .forEach((edge) => result.push(cloneJson(edge)));
  graph.edges
    .filter(
      (edge) =>
        !isBlockBridgeEdge(edge, blockNode.id) &&
        !isBlockInternalEdge(edge, blockNode.id) &&
        (edge.source === blockNode.id || edge.target === blockNode.id),
    )
    .forEach((edge) => {
      if (edge.source === blockNode.id) {
        const port = definition.outputs.find((item) => item.id === edge.sourceHandle);
        const source = port ? idBySource.get(port.nodeId) : undefined;
        if (source) {
          result.push({ ...cloneJson(edge), id: nanoid(), source, sourceHandle: port?.paramKey ?? edge.sourceHandle });
        }
        return;
      }
      const port = definition.inputs.find((item) => item.id === edge.targetHandle);
      const target = port ? idBySource.get(port.nodeId) : undefined;
      if (target) {
        result.push({ ...cloneJson(edge), id: nanoid(), target, targetHandle: port?.paramKey ?? edge.targetHandle });
      }
    });
  return result;
}

function flattenSelectedBlockNodes(graph: FlowGraph, blocks: UserBlockDefinition[]) {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  let next = graph;
  const selectedBlockIds = graph.nodes
    .filter((node) => node.selected && node.data.type === 'block' && node.data.userBlockId)
    .map((node) => node.id);

  selectedBlockIds.forEach((blockNodeId) => {
    const blockNode = next.nodes.find((node) => node.id === blockNodeId);
    if (!blockNode) return;
    const definition = blockDefinitionForNode(blockNode, blockMap);
    if (!definition) return;
    const children = materializedBlockChildren(next, blockNode, definition, { selected: true, absolute: true });
    const internal = materializedBlockInternalEdges(next, blockNode, definition, children);
    const childIds = new Set(
      next.nodes.filter((node) => node.data.userBlockInstanceId === blockNode.id).map((node) => node.id),
    );
    const external = expandedBlockExternalEdges(next, blockNode, definition, children);
    const flattenedChildren = children.map((node) => {
      const data = { ...node.data };
      delete data.userBlockInstanceId;
      delete data.userBlockSourceNodeId;
      return { ...node, parentId: undefined, expandParent: undefined, data };
    });
    next = {
      nodes: [...next.nodes.filter((node) => node.id !== blockNode.id && !childIds.has(node.id)), ...flattenedChildren],
      edges: [
        ...next.edges.filter(
          (edge) =>
            edge.source !== blockNode.id &&
            edge.target !== blockNode.id &&
            !childIds.has(edge.source) &&
            !childIds.has(edge.target) &&
            !isBlockBridgeEdge(edge, blockNode.id) &&
            !isBlockInternalEdge(edge, blockNode.id),
        ),
        ...internal.map((edge) => stripBlockEdgeData(edge)),
        ...external,
      ],
    };
  });
  return next;
}

export function validateUserBlockSelection(graph: FlowGraph, blocks: UserBlockDefinition[] = []) {
  const flattened = flattenSelectedBlockNodes(graph, blocks);
  const selectedNodes = selectedActionNodes(flattened.nodes);
  if (selectedNodes.length === 0) return 'Select nodes first';
  if (
    selectedNodes.some(
      (node) =>
        node.parentId && flattened.nodes.some((parent) => parent.id === node.parentId && parent.data.type === 'block'),
    )
  ) {
    return 'Select the whole block before creating another block';
  }
  if (!connectedSelection(selectedNodes, flattened.edges)) return 'Selection has separate islands';
  return null;
}

export function createUserBlockFromSelection(
  graph: FlowGraph,
  name?: string,
  blocks: UserBlockDefinition[] = [],
): BlockSelectionResult {
  const flattened = flattenSelectedBlockNodes(graph, blocks);
  const reason = validateUserBlockSelection(flattened);
  if (reason) return { ok: false, reason };

  const selectedNodes = selectedActionNodes(flattened.nodes);
  const selectedIds = selectedNodeSet(selectedNodes);
  const internalEdges = flattened.edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const incomingEdges = flattened.edges.filter((edge) => !selectedIds.has(edge.source) && selectedIds.has(edge.target));
  const outgoingEdges = flattened.edges.filter((edge) => selectedIds.has(edge.source) && !selectedIds.has(edge.target));
  const selectedById = new Map(selectedNodes.map((node) => [node.id, node]));
  const bounds = boundsForNodes(selectedNodes);
  const blockId = nanoid();
  const createdAt = Date.now();
  const blockName = name?.trim() || `User Block ${createdAt.toString().slice(-4)}`;
  const normalizedNodes = arrangeGraphNodes(
    cloneJson(selectedNodes).map((node) =>
      stripBlockInstanceData(node, sourceNodeId(node), {
        x: node.position.x - bounds.left,
        y: node.position.y - bounds.top,
      }),
    ),
    internalEdges,
  );

  const crossingInputPorts = incomingEdges.map((edge, index) =>
    portFromEdge(selectedById.get(edge.target)!, edge.targetHandle, 'input', index),
  );
  const crossingOutputPorts = outgoingEdges.map((edge, index) =>
    portFromEdge(selectedById.get(edge.source)!, edge.sourceHandle, 'output', index),
  );

  const block = normalizeUserBlockDefinition({
    id: blockId,
    name: blockName,
    version: 1,
    nodes: normalizedNodes,
    edges: cloneJson(internalEdges),
    inputs: dedupePorts(crossingInputPorts),
    outputs: dedupePorts(crossingOutputPorts),
    exposedParams: exposedParamsForNodes(selectedNodes),
    createdAt,
    updatedAt: createdAt,
  });

  const blockNode = createUserBlockNode(block, {
    x: bounds.left + Math.max(0, bounds.width / 2 - 140),
    y: bounds.top + Math.max(0, bounds.height / 2 - 80),
  });

  const nextEdges: Edge[] = flattened.edges
    .filter((edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target))
    .map(cloneJson);

  incomingEdges.forEach((edge, index) => {
    const crossingPort = crossingInputPorts[index];
    const port = block.inputs.find(
      (candidate) => candidate.nodeId === crossingPort?.nodeId && candidate.paramKey === crossingPort?.paramKey,
    );
    if (!port) return;
    nextEdges.push({
      ...cloneJson(edge),
      id: nanoid(),
      target: blockNode.id,
      targetHandle: port.id,
    });
  });
  outgoingEdges.forEach((edge, index) => {
    const crossingPort = crossingOutputPorts[index];
    const port = block.outputs.find(
      (candidate) => candidate.nodeId === crossingPort?.nodeId && candidate.paramKey === crossingPort?.paramKey,
    );
    if (!port) return;
    nextEdges.push({
      ...cloneJson(edge),
      id: nanoid(),
      source: blockNode.id,
      sourceHandle: port.id,
    });
  });

  const nextNodes = [
    ...flattened.nodes.filter((node) => !selectedIds.has(node.id)).map((node) => ({ ...node, selected: false })),
    blockNode,
  ] as CustomNodeType[];

  return { ok: true, block, blockNode, nodes: nextNodes, edges: nextEdges };
}

export function blockInputBridgeHandle(portId: string) {
  return `${USER_BLOCK_INPUT_BRIDGE_PREFIX}${portId}`;
}

export function blockOutputBridgeHandle(portId: string) {
  return `${USER_BLOCK_OUTPUT_BRIDGE_PREFIX}${portId}`;
}

function blockInstanceChildren(graph: FlowGraph, instanceId: string) {
  return compositeInstanceChildren(graph.nodes, instanceId, (node) => node.data.userBlockInstanceId);
}

export function isUserBlockExpandedInstance(graph: FlowGraph, instanceId: string) {
  const blockNode = graph.nodes.find((node) => node.id === instanceId && node.data.type === 'block');
  if (!blockNode) return false;
  return Boolean(blockNode.data.uiState?.blockExpanded || blockInstanceChildren(graph, instanceId).length > 0);
}

export function expandedUserBlockAtPosition(
  nodes: CustomNodeType[],
  position: CustomNodeType['position'],
): CustomNodeType | null {
  const candidates = nodes
    .filter(
      (node) =>
        node.data.type === 'block' && !node.parentId && isUserBlockExpandedInstance({ nodes, edges: [] }, node.id),
    )
    .filter((node) => {
      const width = node.measured?.width ?? node.width ?? USER_BLOCK_COLLAPSED_WIDTH;
      const height = node.measured?.height ?? node.height ?? USER_BLOCK_COLLAPSED_HEIGHT;
      return (
        position.x >= node.position.x &&
        position.x <= node.position.x + width &&
        position.y >= node.position.y &&
        position.y <= node.position.y + height
      );
    })
    .sort((left, right) => {
      const leftArea =
        (left.measured?.width ?? left.width ?? USER_BLOCK_COLLAPSED_WIDTH) *
        (left.measured?.height ?? left.height ?? USER_BLOCK_COLLAPSED_HEIGHT);
      const rightArea =
        (right.measured?.width ?? right.width ?? USER_BLOCK_COLLAPSED_WIDTH) *
        (right.measured?.height ?? right.height ?? USER_BLOCK_COLLAPSED_HEIGHT);
      return leftArea - rightArea;
    });
  return candidates[0] ?? null;
}

export function placeNodeInsideExpandedUserBlock(
  node: CustomNodeType,
  blockNode: CustomNodeType,
  absolutePosition: CustomNodeType['position'] = node.position,
): CustomNodeType {
  if (blockNode.data.type !== 'block') throw new Error('The target is not a User Node.');
  if (node.data.type === 'block') throw new Error('Nested User Nodes are not supported.');
  return {
    ...node,
    parentId: blockNode.id,
    extent: undefined,
    expandParent: true,
    position: {
      x: Math.max(USER_BLOCK_CHILD_LEFT, absolutePosition.x - blockNode.position.x),
      y: Math.max(USER_BLOCK_CHILD_TOP, absolutePosition.y - blockNode.position.y),
    },
    data: {
      ...node.data,
      userBlockInstanceId: blockNode.id,
      userBlockSourceNodeId: node.id,
    },
  };
}

function absoluteNodePosition(nodes: CustomNodeType[], node: CustomNodeType) {
  let position = { ...node.position };
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodes.find((candidate) => candidate.id === parentId);
    if (!parent) break;
    position = {
      x: position.x + parent.position.x,
      y: position.y + parent.position.y,
    };
    parentId = parent.parentId;
  }
  return position;
}

export function placeExistingNodeInsideExpandedUserBlock(graph: FlowGraph, nodeId: string, blockId: string): FlowGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const blockNode = graph.nodes.find((candidate) => candidate.id === blockId);
  if (!node || !blockNode || blockNode.data.type !== 'block') return graph;
  if (!isUserBlockExpandedInstance(graph, blockId)) return graph;
  if (node.id === blockId || node.data.type === 'block' || node.data.type === 'cluster') return graph;
  if (node.data.huggingFaceClusterInstanceId || node.data.huggingFaceClusterRole) return graph;
  const currentParent = node.parentId ? graph.nodes.find((candidate) => candidate.id === node.parentId) : undefined;
  if (currentParent && currentParent.data.type !== 'block') return graph;
  if (currentParent?.id === blockId && node.data.userBlockInstanceId === blockId) return graph;

  const absolute = absoluteNodePosition(graph.nodes, node);
  const adopted = placeNodeInsideExpandedUserBlock(
    {
      ...node,
      parentId: undefined,
      data: {
        ...node.data,
        userBlockSourceNodeId: node.id,
      },
    },
    blockNode,
    absolute,
  );
  const previousBlockId = node.data.userBlockInstanceId;
  const withoutAdopted = graph.nodes.filter((candidate) => candidate.id !== nodeId);
  const blockIndex = withoutAdopted.findIndex((candidate) => candidate.id === blockId);
  const orderedNodes = [...withoutAdopted];
  orderedNodes.splice(blockIndex + 1, 0, adopted);
  let next: FlowGraph = {
    nodes: orderedNodes,
    edges: graph.edges,
  };
  if (previousBlockId && previousBlockId !== blockId) {
    next = fitUserBlockInstance(next, previousBlockId);
  }
  return fitUserBlockInstance(next, blockId);
}

function blockExpandedSize(children: CustomNodeType[]) {
  const right = Math.max(
    USER_BLOCK_COLLAPSED_WIDTH,
    ...children.map(
      (node) => node.position.x + (node.measured?.width ?? node.width ?? 260) + USER_BLOCK_HORIZONTAL_PADDING,
    ),
  );
  const bottom = Math.max(
    USER_BLOCK_COLLAPSED_HEIGHT,
    ...children.map(
      (node) => node.position.y + (node.measured?.height ?? node.height ?? 160) + USER_BLOCK_VERTICAL_PADDING,
    ),
  );
  return {
    width: Math.ceil(right),
    height: Math.ceil(bottom),
  };
}

function alignBlockChildren(children: CustomNodeType[]) {
  if (children.length === 0) {
    return {
      children,
      shiftX: 0,
      shiftY: 0,
      size: {
        width: USER_BLOCK_COLLAPSED_WIDTH,
        height: USER_BLOCK_COLLAPSED_HEIGHT,
      },
    };
  }
  const minX = Math.min(...children.map((node) => node.position.x));
  const minY = Math.min(...children.map((node) => node.position.y));
  const shiftX = minX - USER_BLOCK_CHILD_LEFT;
  const shiftY = minY - USER_BLOCK_CHILD_TOP;
  const alignedChildren =
    shiftX || shiftY
      ? children.map((node) => ({
          ...node,
          position: {
            x: node.position.x - shiftX,
            y: node.position.y - shiftY,
          },
        }))
      : children;
  return {
    children: alignedChildren,
    shiftX,
    shiftY,
    size: blockExpandedSize(alignedChildren),
  };
}

export function expandUserBlockInstance(
  graph: FlowGraph,
  instanceId: string,
  blocks: UserBlockDefinition[],
): FlowGraph {
  const blockNode = graph.nodes.find((node) => node.id === instanceId && node.data.type === 'block');
  if (!blockNode || isUserBlockExpandedInstance(graph, instanceId)) return graph;
  const definition = blockDefinitionForNode(blockNode, new Map(blocks.map((block) => [block.id, block])));
  if (!definition) return graph;

  const materializedChildren = materializedBlockChildren(graph, blockNode, definition);
  const { children, size } = alignBlockChildren(materializedChildren);
  const internalEdges = materializedBlockInternalEdges(graph, blockNode, definition, children);
  const externalEdges = expandedBlockExternalEdges(graph, blockNode, definition, children);
  const parent = {
    ...blockNode,
    width: size.width,
    height: size.height,
    data: {
      ...blockNode.data,
      userBlockSnapshot: definition,
      uiState: {
        ...blockNode.data.uiState,
        blockExpanded: true,
        blockCollapsedWidth: blockNode.width ?? USER_BLOCK_COLLAPSED_WIDTH,
        blockCollapsedHeight: blockNode.height ?? USER_BLOCK_COLLAPSED_HEIGHT,
      },
    },
  } satisfies CustomNodeType;

  return {
    nodes: [
      ...graph.nodes.map((node) => (node.id === instanceId ? parent : node)),
      ...children.filter((child) => !graph.nodes.some((node) => node.id === child.id)),
    ],
    edges: [
      ...graph.edges.filter(
        (edge) =>
          edge.source !== instanceId &&
          edge.target !== instanceId &&
          !isBlockBridgeEdge(edge, instanceId) &&
          !isBlockInternalEdge(edge, instanceId),
      ),
      ...internalEdges.map((edge) => ({
        ...edge,
        data: {
          ...(isRecord(edge.data) ? edge.data : {}),
          userBlockInstanceId: instanceId,
          userBlockInternal: true,
        },
      })),
      ...externalEdges,
    ],
  };
}

function snapshotExpandedBlock(
  blockNode: CustomNodeType,
  definition: UserBlockDefinition,
  children: CustomNodeType[],
  edges: Edge[],
) {
  const idByInstance = new Map(children.map((node) => [node.id, sourceNodeId(node)]));
  const nodes = children.map((node) =>
    stripBlockInstanceData(node, sourceNodeId(node), {
      x: node.position.x - USER_BLOCK_CHILD_LEFT,
      y: node.position.y - USER_BLOCK_CHILD_TOP,
    }),
  );
  const internalEdges = edges
    .filter(
      (edge) =>
        !isBlockBridgeEdge(edge, blockNode.id) && idByInstance.has(edge.source) && idByInstance.has(edge.target),
    )
    .map((edge) => ({
      ...stripBlockEdgeData(edge),
      id: nanoid(),
      source: idByInstance.get(edge.source)!,
      target: idByInstance.get(edge.target)!,
    }));
  const nextDefinition = normalizeUserBlockDefinition({
    ...cloneJson(definition),
    nodes,
    edges: internalEdges,
    updatedAt: Date.now(),
  });
  const replacementParams = createUserBlockNode(nextDefinition, blockNode.position, blockNode.id).data.params;
  const params = Object.fromEntries(
    Object.entries(replacementParams).map(([key, param]) => [
      key,
      blockNode.data.params[key]
        ? {
            ...param,
            value: blockNode.data.params[key].value,
            artifacts: blockNode.data.params[key].artifacts,
          }
        : param,
    ]),
  );
  nextDefinition.exposedParams.forEach((input) => {
    if (!input.nodeId || !input.paramKey) return;
    const parentParam = params[input.id];
    if (!parentParam) return;
    const child = children.find((node) => sourceNodeId(node) === input.nodeId);
    const childParam = child?.data.params?.[input.paramKey];
    if (childParam) parentParam.value = childParam.value;
  });
  children.forEach((child) => {
    Object.entries(child.data.params ?? {}).forEach(([paramKey, childParam]) => {
      if (!USER_BLOCK_PREVIEW_DISPLAYS.has(childParam.display ?? '')) return;
      const preview = params[userBlockPreviewParamId(sourceNodeId(child), paramKey)];
      if (!preview) return;
      preview.value = childParam.value;
      preview.artifacts = childParam.artifacts;
    });
  });
  return { definition: nextDefinition, params };
}

export function collapseUserBlockInstance(
  graph: FlowGraph,
  instanceId: string,
  blocks: UserBlockDefinition[],
): FlowGraph {
  const blockNode = graph.nodes.find((node) => node.id === instanceId && node.data.type === 'block');
  if (!blockNode || !isUserBlockExpandedInstance(graph, instanceId)) return graph;
  const definition = blockDefinitionForNode(blockNode, new Map(blocks.map((block) => [block.id, block])));
  if (!definition) return graph;
  const children = blockInstanceChildren(graph, instanceId);
  const childIds = new Set(children.map((node) => node.id));
  const snapshot = snapshotExpandedBlock(blockNode, definition, children, graph.edges);
  const sourceIdByChild = new Map(children.map((node) => [node.id, sourceNodeId(node)]));
  const collapsedExternalEdges = graph.edges.flatMap((edge) => {
    if (isBlockBridgeEdge(edge, instanceId) || isBlockInternalEdge(edge, instanceId)) return [];
    const sourceNodeId = sourceIdByChild.get(edge.source);
    const targetNodeId = sourceIdByChild.get(edge.target);
    if (sourceNodeId && targetNodeId) return [];
    if (sourceNodeId) {
      const port = snapshot.definition.outputs.find(
        (candidate) => candidate.nodeId === sourceNodeId && candidate.paramKey === edge.sourceHandle,
      );
      return port ? [{ ...cloneJson(edge), source: instanceId, sourceHandle: port.id }] : [];
    }
    if (targetNodeId) {
      const port = snapshot.definition.inputs.find(
        (candidate) => candidate.nodeId === targetNodeId && candidate.paramKey === edge.targetHandle,
      );
      return port ? [{ ...cloneJson(edge), target: instanceId, targetHandle: port.id }] : [];
    }
    return [cloneJson(edge)];
  });
  const parent = {
    ...blockNode,
    width: blockNode.data.uiState?.blockCollapsedWidth ?? USER_BLOCK_COLLAPSED_WIDTH,
    height: blockNode.data.uiState?.blockCollapsedHeight ?? USER_BLOCK_COLLAPSED_HEIGHT,
    data: {
      ...blockNode.data,
      params: snapshot.params,
      userBlockSnapshot: snapshot.definition,
      uiState: {
        ...blockNode.data.uiState,
        blockExpanded: false,
      },
    },
  } satisfies CustomNodeType;

  return {
    nodes: graph.nodes.filter((node) => !childIds.has(node.id)).map((node) => (node.id === instanceId ? parent : node)),
    edges: collapsedExternalEdges,
  };
}

export function fitUserBlockInstance(graph: FlowGraph, instanceId: string): FlowGraph {
  const blockNode = graph.nodes.find((node) => node.id === instanceId && node.data.type === 'block');
  if (!blockNode || !isUserBlockExpandedInstance(graph, instanceId)) return graph;
  const children = blockInstanceChildren(graph, instanceId);
  if (children.length === 0) return graph;
  const { children: alignedChildren, shiftX, shiftY, size } = alignBlockChildren(children);
  const sameWidth = Math.abs((blockNode.width ?? 0) - size.width) < 0.5;
  const sameHeight = Math.abs((blockNode.height ?? 0) - size.height) < 0.5;
  if (!shiftX && !shiftY && sameWidth && sameHeight) return graph;
  const childById = new Map(alignedChildren.map((node) => [node.id, node]));
  return {
    nodes: graph.nodes.map((node) => {
      if (node.id === instanceId) {
        return {
          ...node,
          position: {
            x: node.position.x + shiftX,
            y: node.position.y + shiftY,
          },
          width: size.width,
          height: size.height,
        };
      }
      return childById.get(node.id) ?? node;
    }),
    edges: graph.edges,
  };
}

export function userBlockAvailableExposedParams(definition: UserBlockDefinition) {
  return exposedParamsForNodes(
    definition.nodes.filter(isFlowNodeLike).map((node) => node as CustomNodeType),
    true,
  );
}

export function connectionCrossesUserBlockBoundary(nodes: CustomNodeType[], sourceId: string, targetId: string) {
  const sourceInstanceId = nodes.find((node) => node.id === sourceId)?.data.userBlockInstanceId ?? null;
  const targetInstanceId = nodes.find((node) => node.id === targetId)?.data.userBlockInstanceId ?? null;
  return Boolean(sourceInstanceId || targetInstanceId) && sourceInstanceId !== targetInstanceId;
}

/**
 * Permit ordinary connections inside one User Node, outside all User Nodes, or
 * through an explicitly exposed boundary socket. Direct links between two
 * different User Node instances are rejected; they must connect through the
 * two wrapper nodes so each instance retains an independent persisted graph.
 */
export function userBlockConnectionIsAllowed(
  nodes: CustomNodeType[],
  sourceId: string,
  sourceHandle: string | null | undefined,
  targetId: string,
  targetHandle: string | null | undefined,
) {
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  const sourceInstanceId = source?.data.userBlockInstanceId ?? null;
  const targetInstanceId = target?.data.userBlockInstanceId ?? null;
  if (sourceInstanceId === targetInstanceId) return true;
  if (!sourceInstanceId && !targetInstanceId) return true;
  if (sourceInstanceId && targetInstanceId) return false;

  if (sourceInstanceId && sourceHandle && source) {
    const root = nodes.find((node) => node.id === sourceInstanceId && node.data.type === 'block');
    const definition = root?.data.userBlockSnapshot;
    const sourceNodeId = source.data.userBlockSourceNodeId ?? source.id;
    return Boolean(definition?.outputs.some((port) => port.nodeId === sourceNodeId && port.paramKey === sourceHandle));
  }
  if (targetInstanceId && targetHandle && target) {
    const root = nodes.find((node) => node.id === targetInstanceId && node.data.type === 'block');
    const definition = root?.data.userBlockSnapshot;
    const targetNodeId = target.data.userBlockSourceNodeId ?? target.id;
    return Boolean(definition?.inputs.some((port) => port.nodeId === targetNodeId && port.paramKey === targetHandle));
  }
  return false;
}

export function configureUserBlockInstance(
  graph: FlowGraph,
  instanceId: string,
  blocks: UserBlockDefinition[],
  changes: {
    name: string;
    inputLabels: Record<string, string>;
    outputLabels: Record<string, string>;
    exposedParamIds: Set<string>;
  },
): FlowGraph {
  const blockNode = graph.nodes.find((node) => node.id === instanceId && node.data.type === 'block');
  if (!blockNode) return graph;
  const definition = blockDefinitionForNode(blockNode, new Map(blocks.map((block) => [block.id, block])));
  if (!definition) return graph;
  const available = userBlockAvailableExposedParams(definition);
  const nextDefinition: UserBlockDefinition = {
    ...definition,
    name: changes.name.trim() || definition.name,
    inputs: definition.inputs.map((port) => ({
      ...port,
      label: changes.inputLabels[port.id]?.trim() || port.label,
    })),
    outputs: definition.outputs.map((port) => ({
      ...port,
      label: changes.outputLabels[port.id]?.trim() || port.label,
    })),
    exposedParams: available.filter((input) => changes.exposedParamIds.has(input.id)),
    updatedAt: Date.now(),
  };
  const replacement = createUserBlockNode(nextDefinition, blockNode.position, blockNode.id);
  const existingParams = blockNode.data.params;
  replacement.data.params = Object.fromEntries(
    Object.entries(replacement.data.params).map(([key, param]) => [
      key,
      existingParams[key]
        ? {
            ...param,
            value: existingParams[key].value,
            artifacts: existingParams[key].artifacts,
          }
        : param,
    ]),
  );
  replacement.data.uiState = {
    ...blockNode.data.uiState,
  };
  replacement.width = blockNode.width;
  replacement.height = blockNode.height;
  replacement.selected = blockNode.selected;
  replacement.parentId = blockNode.parentId;
  replacement.extent = blockNode.extent;
  return {
    nodes: graph.nodes.map((node) => (node.id === instanceId ? replacement : node)),
    edges: graph.edges,
  };
}

export function snapshotUserBlockInstance(
  graph: FlowGraph,
  instanceId: string,
  blocks: UserBlockDefinition[],
): UserBlockDefinition | null {
  const blockNode = graph.nodes.find((node) => node.id === instanceId && node.data.type === 'block');
  if (!blockNode) return null;
  const definition = blockDefinitionForNode(blockNode, new Map(blocks.map((block) => [block.id, block])));
  if (!definition) return null;
  const children = blockInstanceChildren(graph, instanceId);
  if (children.length === 0) return normalizeUserBlockDefinition(definition);
  return snapshotExpandedBlock(blockNode, definition, children, graph.edges).definition;
}

export function copyUserBlockDefinition(
  definition: UserBlockDefinition,
  name: string,
  id = nanoid(),
): UserBlockDefinition {
  const now = Date.now();
  return normalizeUserBlockDefinition({
    ...cloneJson(definition),
    id,
    name: name.trim() || definition.name,
    createdAt: now,
    updatedAt: now,
  });
}

export function applyUserBlockDefinitionToInstance(
  graph: FlowGraph,
  instanceId: string,
  definition: UserBlockDefinition,
): FlowGraph {
  const blockNode = graph.nodes.find((node) => node.id === instanceId && node.data.type === 'block');
  if (!blockNode) return graph;
  const normalized = normalizeUserBlockDefinition(definition);
  const replacement = createUserBlockNode(normalized, blockNode.position, instanceId);
  replacement.data.params = Object.fromEntries(
    Object.entries(replacement.data.params).map(([key, param]) => [
      key,
      blockNode.data.params[key]
        ? {
            ...param,
            value: blockNode.data.params[key].value,
            artifacts: blockNode.data.params[key].artifacts,
          }
        : param,
    ]),
  );
  replacement.data.uiState = { ...blockNode.data.uiState };
  replacement.width = blockNode.width;
  replacement.height = blockNode.height;
  replacement.selected = blockNode.selected;
  replacement.parentId = blockNode.parentId;
  replacement.extent = blockNode.extent;
  return {
    nodes: graph.nodes.map((node) => (node.id === instanceId ? replacement : node)),
    edges: graph.edges,
  };
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

function expandOnePass(graph: FlowGraph, blocks: Map<string, UserBlockDefinition>): FlowGraph {
  const blockNodes = graph.nodes.filter((node) => node.data.type === 'block' && blockDefinitionForNode(node, blocks));
  if (blockNodes.length === 0) return graph;
  const blockIds = new Set(blockNodes.map((node) => node.id));
  const materializedChildIds = new Set(
    graph.nodes
      .filter((node) => node.data.userBlockInstanceId && blockIds.has(node.data.userBlockInstanceId))
      .map((node) => node.id),
  );
  const nextNodes = graph.nodes.filter((node) => !blockIds.has(node.id) && !materializedChildIds.has(node.id));
  const nextEdges = graph.edges
    .filter(
      (edge) =>
        !blockIds.has(edge.source) &&
        !blockIds.has(edge.target) &&
        !materializedChildIds.has(edge.source) &&
        !materializedChildIds.has(edge.target) &&
        !isBlockBridgeEdge(edge) &&
        !isBlockInternalEdge(edge),
    )
    .map(stripBlockEdgeData);

  blockNodes.forEach((blockNode) => {
    const definition = blockDefinitionForNode(blockNode, blocks);
    if (!definition) return;
    const children = materializedBlockChildren(graph, blockNode, definition, { absolute: true });
    nextNodes.push(
      ...children.map((node) => ({
        ...stripBlockInstanceData(node, node.id, node.position),
        parentId: node.parentId,
      })),
    );
    nextEdges.push(
      ...materializedBlockInternalEdges(graph, blockNode, definition, children).map(stripBlockEdgeData),
      ...expandedBlockExternalEdges(graph, blockNode, definition, children).map(stripBlockEdgeData),
    );
  });

  return { nodes: nextNodes, edges: nextEdges };
}

export function expandUserBlockGraph(nodes: CustomNodeType[], edges: Edge[], blocks: UserBlockDefinition[]): FlowGraph {
  const blockMap = new Map(blocks.map((block) => [block.id, block]));
  let graph: FlowGraph = { nodes, edges };
  for (let depth = 0; depth < 6; depth += 1) {
    if (!graph.nodes.some((node) => node.data.type === 'block' && blockDefinitionForNode(node, blockMap))) break;
    const expanded = expandOnePass(graph, blockMap);
    if (expanded === graph) break;
    graph = expanded;
  }
  return graph;
}
