import type { Edge } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { expandBlockGraphV2ForExecution } from './blockRuntimeV2';
import { inspectBlockSeedBindingsV2 } from './blockSeedRepairV2';
import { inspectBlockDerivedControlsV2 } from './blockDerivedControlRepairV2';
import { inspectReviewedStateV2 } from './reviewedStateDiagnosticsV2';
import { inspectReviewedLoopV2 } from './reviewedLoopDiagnosticsV2';
import { reviewedLoopRepairEdgeV2 } from './reviewedLoopRepairV2';
import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';
import { isBlockRootV2Node, nodeConnectorParam, nodeConnectorParams } from './nodeConnectorResolution';
import type { RunReadinessIssue } from './types';

export type GraphFixConfidence = 'safe' | 'choice';
export type GraphFixExternalAction = 'open_model_manager' | 'open_assets' | 'open_setup' | 'inspect_node';

type GraphFixEndpoint = {
  nodeId: string;
  handle: string;
};

export type GraphFixOperation =
  | { kind: 'remove_edges'; edgeIds: string[] }
  | { kind: 'add_node'; ref: string; nodeKey: string; position: { x: number; y: number } }
  | { kind: 'connect'; source: GraphFixEndpoint; target: GraphFixEndpoint }
  | { kind: 'restore_block_structure'; rootNodeId: string }
  | { kind: 'repair_block_seed'; rootNodeId: string; sourceNodeId: string }
  | { kind: 'repair_block_derived_control'; rootNodeId: string; sourceNodeId: string; fieldId: string }
  | { kind: 'repair_block_state'; rootNodeId: string; sourceNodeId: string; targetNodeId: string; graphHash: string }
  | { kind: 'repair_block_loop'; rootNodeId: string; targetNodeId: string; graphHash: string }
  | { kind: 'external'; action: GraphFixExternalAction; nodeId?: string; repoId?: string };

export type GraphFixCandidate = {
  id: string;
  issueId: string;
  title: string;
  description: string;
  confidence: GraphFixConfidence;
  operations: GraphFixOperation[];
  targetNodeId?: string;
  targetHandle?: string;
};

export type GraphFixIssue = {
  id: string;
  kind:
    | 'broken_link'
    | 'type_mismatch'
    | 'missing_input'
    | 'missing_output'
    | 'missing_model'
    | 'missing_media'
    | 'block_structure'
    | 'block_seed'
    | 'block_derived_control'
    | 'environment';
  title: string;
  description: string;
  targetNodeId?: string;
  targetHandle?: string;
  candidates: GraphFixCandidate[];
};

export type GraphFixPlan = {
  issues: GraphFixIssue[];
  candidateCount: number;
  canFix: boolean;
};

export type GraphFixContext = {
  nodes: CustomNodeType[];
  edges: Edge[];
  registry: Record<string, NodeData>;
  readinessIssues?: RunReadinessIssue[];
  modularBlockDefinitions?: readonly HuggingFaceNodeLibraryBlockDefinition[];
};

export type GraphFixMaterialization = {
  nodes: CustomNodeType[];
  edges: Edge[];
  addedNodeIds: string[];
  externalActions: Array<Extract<GraphFixOperation, { kind: 'external' }>>;
};

const MEDIA_TYPES = new Set(['image', 'video', 'audio']);
const SIMPLE_TYPES = new Set(['bool', 'float', 'int', 'number', 'str', 'string', 'text']);

function blockExecutionError(node: CustomNodeType) {
  if (!isBlockRootV2Node(node)) return null;
  try {
    expandBlockGraphV2ForExecution([node], []);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function blockExecutionErrorTarget(root: CustomNodeType, details: string, nodes: readonly CustomNodeType[]) {
  const candidates = nodes
    .filter(({ data }) => data.blockProjectionOwnerId === root.id && typeof data.blockProjectionNodeId === 'string')
    .sort(
      (left, right) => String(right.data.blockProjectionNodeId).length - String(left.data.blockProjectionNodeId).length,
    );
  return (
    candidates.find(({ id, data }) => {
      const semanticId = String(data.blockProjectionNodeId);
      return (
        details.includes(id) ||
        details.includes(`"${semanticId}"`) ||
        details.includes(`'${semanticId}'`) ||
        details.includes(` ${semanticId}:`) ||
        details.includes(` ${semanticId}.`) ||
        details.endsWith(` ${semanticId}`)
      );
    })?.id ?? root.id
  );
}

function nodeRegistryKey(node: Pick<CustomNodeType, 'data'>) {
  return `${node.data.module}.${node.data.action}`;
}

function nodesWithLiveContracts(nodes: CustomNodeType[], registry: Record<string, NodeData>) {
  return nodes.map((node) => {
    // Block V2 owns an immutable embedded definition snapshot. Applying a
    // registry contract to its empty root params would create a second socket
    // authority and make Graph Fix disagree with the canvas/runtime.
    if (isBlockRootV2Node(node)) return node;
    const definition = registry[nodeRegistryKey(node)];
    if (!definition) return node;
    const params = Object.fromEntries(
      Object.entries(node.data.params).map(([key, stored]) => {
        const live = definition.params[key];
        if (!live) return [key, stored];
        return [
          key,
          {
            ...stored,
            type: live.type ?? stored.type,
            required: live.required ?? stored.required,
          },
        ];
      }),
    );
    return { ...node, data: { ...node.data, params } };
  });
}

function normalizedTypes(param?: Pick<NodeParams, 'type'>) {
  const raw = Array.isArray(param?.type) ? param?.type : [param?.type ?? 'any'];
  return Array.from(
    new Set(
      raw
        .map((value) =>
          String(value || 'any')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
        .map((value) => (value === 'integer' ? 'int' : value)),
    ),
  );
}

export function graphSocketTypesAreCompatible(source?: Pick<NodeParams, 'type'>, target?: Pick<NodeParams, 'type'>) {
  const sourceTypes = normalizedTypes(source);
  const targetTypes = normalizedTypes(target);
  if (sourceTypes.includes('any') || targetTypes.includes('any')) return true;
  return sourceTypes.some((type) => targetTypes.includes(type));
}

function inputFields(node: Pick<CustomNodeType, 'data'>) {
  return Object.entries(nodeConnectorParams(node)).filter(([, param]) => param.display === 'input' || param.isInput);
}

function outputFields(node: Pick<CustomNodeType, 'data'>) {
  return Object.entries(nodeConnectorParams(node)).filter(([, param]) => param.display === 'output');
}

function usableValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    if ('value' in value) return usableValue((value as { value?: unknown }).value);
    return Object.keys(value).length > 0;
  }
  return true;
}

function inputIsRequired(key: string, param: NodeParams, skipParamsCheck = false) {
  if (param.hidden || param.disabled || param.spawn) return false;
  if (usableValue(param.value ?? param.default)) return false;
  if (param.required === false) return false;
  if (param.required === true) return true;
  if (skipParamsCheck) return false;
  const text = `${key} ${param.label ?? ''} ${param.description ?? ''}`.toLowerCase();
  if (/\boptional\b|\bif provided\b|\bwhen supplied\b/.test(text)) return false;
  return true;
}

function blockInputHasFieldControl(node: CustomNodeType, handle: string) {
  const instance = node.data.blockInstanceV2;
  if (!isBlockRootV2Node(node) || !instance) return false;
  const port = instance.effectiveInterface.boundary.inputs.find((port) => port.portId === handle);
  if (!port) return false;
  const bindings = [port.binding, ...(port.mirrorBindings ?? [])];
  return instance.effectiveInterface.controls.some((control) =>
    [control.binding, ...(control.mirrorBindings ?? [])].some((field) =>
      bindings.some((binding) => binding.nodeId === field.nodeId && binding.fieldOrPortId === field.fieldId),
    ),
  );
}

function executableNodes(nodes: CustomNodeType[]) {
  return nodes.filter(
    (node) =>
      node.data.type !== 'group' &&
      node.data.type !== 'loop' &&
      !node.data.uiState?.disabled &&
      Boolean(node.data.module) &&
      Boolean(node.data.action),
  );
}

export function graphNodeIsOutputLike(node: Pick<CustomNodeType, 'data'>) {
  const text = `${node.data.module} ${node.data.action} ${node.data.label} ${node.data.category}`.toLowerCase();
  return /\b(preview|export|save|display|output|gallery)\b|viewer\b/.test(text);
}

function blockHasConnectedOutput(node: CustomNodeType) {
  if (!isBlockRootV2Node(node) || !node.data.blockInstanceV2) return false;
  // Inspect the saved semantic graph, not visible projections: collapse must not
  // hide an existing output from Fix. Do not compile a potentially invalid draft.
  const graph = node.data.blockInstanceV2.effectiveGraph;
  const enabled = new Set(
    graph.nodes.filter(({ data }) => !(data as unknown as NodeData).uiState?.disabled).map(({ nodeId }) => nodeId),
  );
  return graph.nodes.some(
    (child) =>
      enabled.has(child.nodeId) &&
      graphNodeIsOutputLike({ data: child.data as unknown as NodeData }) &&
      graph.edges.some((edge) => edge.targetNodeId === child.nodeId && enabled.has(edge.sourceNodeId)),
  );
}

function fieldLabel(node: Pick<CustomNodeType, 'data'>, handle: string) {
  return nodeConnectorParam(node, handle)?.label || handle.replace(/_/g, ' ');
}

function lastKeySegment(key: string) {
  const parts = key.split('.');
  return parts[parts.length - 1] || key;
}

function graphHasPath(edges: Edge[], from: string, to: string) {
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]));
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    if (current === to) return true;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

function candidateId(...parts: Array<string | undefined>) {
  return parts
    .filter(Boolean)
    .join(':')
    .replace(/[^a-z0-9:_-]+/gi, '-')
    .toLowerCase();
}

function mediaPriority(param: NodeParams) {
  const types = normalizedTypes(param);
  if (types.some((type) => MEDIA_TYPES.has(type))) return 80;
  if (types.some((type) => type.includes('pipeline'))) return 70;
  if (types.some((type) => SIMPLE_TYPES.has(type))) return 10;
  if (types.includes('any')) return 0;
  return 40;
}

function exactTypeScore(source: NodeParams, target: NodeParams) {
  const sourceTypes = normalizedTypes(source);
  const targetTypes = normalizedTypes(target);
  const exact = sourceTypes.some((type) => type !== 'any' && targetTypes.includes(type));
  return exact ? 100 : sourceTypes.includes('any') || targetTypes.includes('any') ? 5 : 0;
}

function familyScore(source: Pick<CustomNodeType, 'data'>, target: Pick<CustomNodeType, 'data'>) {
  let score = 0;
  if (source.data.module === target.data.module) score += 24;
  if (source.data.category === target.data.category) score += 12;
  return score;
}

function operationPosition(
  role: 'producer' | 'bridge' | 'output',
  source: CustomNodeType | undefined,
  target: CustomNodeType | undefined,
) {
  if (role === 'output' && source) return { x: source.position.x + 340, y: source.position.y };
  if (role === 'producer' && target) return { x: target.position.x - 340, y: target.position.y };
  if (source && target) {
    return {
      x: Math.round((source.position.x + target.position.x) / 2),
      y: Math.round((source.position.y + target.position.y) / 2 + 140),
    };
  }
  return { x: 120, y: 100 };
}

/** Crossing an ownership boundary is an explicit user gesture. Automatic Fix
 * suggestions stay in one scope and cannot feed a root back into its child. */
function graphFixConnectionScopeIsAllowed(source: CustomNodeType, target: CustomNodeType) {
  return (source.data.blockProjectionOwnerId ?? null) === (target.data.blockProjectionOwnerId ?? null);
}

function existingConnectionCandidates(
  issueId: string,
  context: GraphFixContext,
  target: CustomNodeType,
  targetHandle: string,
  targetParam: NodeParams,
) {
  const enabled = executableNodes(context.nodes);
  return enabled
    .flatMap((source) =>
      outputFields(source).map(([sourceHandle, sourceParam]) => ({ source, sourceHandle, sourceParam })),
    )
    .filter(
      ({ source, sourceParam }) =>
        source.id !== target.id &&
        graphFixConnectionScopeIsAllowed(source, target) &&
        graphSocketTypesAreCompatible(sourceParam, targetParam) &&
        !graphHasPath(context.edges, target.id, source.id),
    )
    .map(({ source, sourceHandle, sourceParam }) => ({
      score:
        exactTypeScore(sourceParam, targetParam) +
        familyScore(source, target) -
        Math.min(40, Math.hypot(source.position.x - target.position.x, source.position.y - target.position.y) / 50),
      candidate: {
        id: candidateId(issueId, 'connect', source.id, sourceHandle),
        issueId,
        title: `Connect ${source.data.label || source.data.action}`,
        description: `Use its ${fieldLabel(source, sourceHandle)} output for ${fieldLabel(target, targetHandle)}.`,
        confidence: exactTypeScore(sourceParam, targetParam) === 100 ? ('safe' as const) : ('choice' as const),
        targetNodeId: target.id,
        targetHandle,
        operations: [
          {
            kind: 'connect' as const,
            source: { nodeId: source.id, handle: sourceHandle },
            target: { nodeId: target.id, handle: targetHandle },
          },
        ],
      },
    }))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.candidate);
}

function registryProducerCandidates(
  issueId: string,
  context: GraphFixContext,
  target: CustomNodeType,
  targetHandle: string,
  targetParam: NodeParams,
) {
  // New sources require explicit adoption/interface configuration for a Block.
  // Do not propose a top-level node wired directly to a derived child.
  if (target.data.blockProjectionOwnerId) return [];
  return Object.entries(context.registry)
    .flatMap(([key, data]) =>
      outputFields({ data }).map(([sourceHandle, sourceParam]) => ({ key, data, sourceHandle, sourceParam })),
    )
    .filter(({ data, sourceParam }) =>
      Boolean(
        data.type !== 'group' &&
        data.type !== 'loop' &&
        graphSocketTypesAreCompatible(sourceParam, targetParam) &&
        !graphNodeIsOutputLike({ data }),
      ),
    )
    .map(({ key, data, sourceHandle, sourceParam }) => {
      const text = `${key} ${data.label} ${data.category}`.toLowerCase();
      const targetTypes = normalizedTypes(targetParam);
      const loaderBonus = targetTypes.some((type) => type.includes('pipeline')) && /load|pipeline/.test(text) ? 50 : 0;
      const mediaBonus = targetTypes.some((type) => MEDIA_TYPES.has(type)) && /load|source|import/.test(text) ? 35 : 0;
      const genericPenalty = normalizedTypes(sourceParam).includes('any') ? 45 : 0;
      const ref = `@${candidateId(issueId, key)}`;
      return {
        score:
          exactTypeScore(sourceParam, targetParam) +
          familyScore({ data }, target) +
          loaderBonus +
          mediaBonus -
          genericPenalty,
        candidate: {
          id: candidateId(issueId, 'add', key, sourceHandle),
          issueId,
          title: `Add ${data.label || lastKeySegment(key)}`,
          description: `Add this compatible source and connect it to ${fieldLabel(target, targetHandle)}.`,
          confidence: 'choice' as const,
          targetNodeId: target.id,
          targetHandle,
          operations: [
            {
              kind: 'add_node' as const,
              ref,
              nodeKey: key,
              position: operationPosition('producer', undefined, target),
            },
            {
              kind: 'connect' as const,
              source: { nodeId: ref, handle: sourceHandle },
              target: { nodeId: target.id, handle: targetHandle },
            },
          ],
        },
      };
    })
    .filter((item) => item.score > 15)
    .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title))
    .map((item) => item.candidate);
}

function missingInputCandidates(
  issueId: string,
  context: GraphFixContext,
  target: CustomNodeType,
  targetHandle: string,
  targetParam: NodeParams,
) {
  const existing = existingConnectionCandidates(issueId, context, target, targetHandle, targetParam);
  const producers = registryProducerCandidates(issueId, context, target, targetHandle, targetParam);
  return [...existing, ...producers].slice(0, 3);
}

function bridgeCandidates(
  issueId: string,
  context: GraphFixContext,
  source: CustomNodeType,
  sourceHandle: string,
  sourceParam: NodeParams,
  target: CustomNodeType,
  targetHandle: string,
  targetParam: NodeParams,
  invalidEdgeId: string,
) {
  if (source.data.blockProjectionOwnerId || target.data.blockProjectionOwnerId) return [];
  return Object.entries(context.registry)
    .flatMap(([key, data]) =>
      inputFields({ data }).flatMap(([bridgeInput, bridgeInputParam]) =>
        outputFields({ data }).map(([bridgeOutput, bridgeOutputParam]) => ({
          key,
          data,
          bridgeInput,
          bridgeInputParam,
          bridgeOutput,
          bridgeOutputParam,
        })),
      ),
    )
    .filter(
      ({ data, bridgeInputParam, bridgeOutputParam }) =>
        data.type !== 'group' &&
        data.type !== 'loop' &&
        graphSocketTypesAreCompatible(sourceParam, bridgeInputParam) &&
        graphSocketTypesAreCompatible(bridgeOutputParam, targetParam),
    )
    .map(({ key, data, bridgeInput, bridgeInputParam, bridgeOutput, bridgeOutputParam }) => {
      const ref = `@${candidateId(issueId, key, bridgeInput, bridgeOutput)}`;
      return {
        score:
          exactTypeScore(sourceParam, bridgeInputParam) +
          exactTypeScore(bridgeOutputParam, targetParam) +
          familyScore({ data }, target),
        candidate: {
          id: candidateId(issueId, 'bridge', key, bridgeInput, bridgeOutput),
          issueId,
          title: `Insert ${data.label || lastKeySegment(key)}`,
          description: `Replace the incompatible link with a typed conversion through ${data.label || 'this node'}.`,
          confidence: 'choice' as const,
          targetNodeId: target.id,
          targetHandle,
          operations: [
            { kind: 'remove_edges' as const, edgeIds: [invalidEdgeId] },
            {
              kind: 'add_node' as const,
              ref,
              nodeKey: key,
              position: operationPosition('bridge', source, target),
            },
            {
              kind: 'connect' as const,
              source: { nodeId: source.id, handle: sourceHandle },
              target: { nodeId: ref, handle: bridgeInput },
            },
            {
              kind: 'connect' as const,
              source: { nodeId: ref, handle: bridgeOutput },
              target: { nodeId: target.id, handle: targetHandle },
            },
          ],
        },
      };
    })
    .filter((item) => item.score > 30)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((item) => item.candidate);
}

function outputCandidates(issueId: string, context: GraphFixContext, existingOutputs: CustomNodeType[]) {
  const enabled = executableNodes(context.nodes);
  const outgoing = new Set(context.edges.map((edge) => `${edge.source}:${edge.sourceHandle ?? ''}`));
  const terminalOutputs = enabled
    .flatMap((source) =>
      outputFields(source).map(([sourceHandle, sourceParam]) => ({ source, sourceHandle, sourceParam })),
    )
    .filter(({ source, sourceHandle }) => !outgoing.has(`${source.id}:${sourceHandle}`))
    .sort((left, right) => mediaPriority(right.sourceParam) - mediaPriority(left.sourceParam));

  const directExisting = existingOutputs.flatMap((target) =>
    inputFields(target).flatMap(([targetHandle, targetParam]) =>
      terminalOutputs
        .filter(
          ({ source, sourceParam }) =>
            source.id !== target.id &&
            graphFixConnectionScopeIsAllowed(source, target) &&
            graphSocketTypesAreCompatible(sourceParam, targetParam) &&
            !graphHasPath(context.edges, target.id, source.id),
        )
        .map(({ source, sourceHandle, sourceParam }) => ({
          score: exactTypeScore(sourceParam, targetParam) + mediaPriority(sourceParam),
          candidate: {
            id: candidateId(issueId, 'connect-output', source.id, sourceHandle, target.id, targetHandle),
            issueId,
            title: `Connect ${source.data.label || source.data.action} to ${target.data.label || target.data.action}`,
            description: `Send ${fieldLabel(source, sourceHandle)} to the existing output node.`,
            confidence: 'safe' as const,
            targetNodeId: target.id,
            targetHandle,
            operations: [
              {
                kind: 'connect' as const,
                source: { nodeId: source.id, handle: sourceHandle },
                target: { nodeId: target.id, handle: targetHandle },
              },
            ],
          },
        })),
    ),
  );
  if (directExisting.length) {
    return directExisting
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((item) => item.candidate);
  }

  return Object.entries(context.registry)
    .filter(([, data]) => graphNodeIsOutputLike({ data }))
    .flatMap(([key, data]) =>
      inputFields({ data }).flatMap(([targetHandle, targetParam]) =>
        terminalOutputs
          .filter(
            ({ source, sourceParam }) =>
              !source.data.blockProjectionOwnerId && graphSocketTypesAreCompatible(sourceParam, targetParam),
          )
          .map(({ source, sourceHandle, sourceParam }) => {
            const ref = `@${candidateId(issueId, key, source.id)}`;
            return {
              score: exactTypeScore(sourceParam, targetParam) + mediaPriority(sourceParam),
              candidate: {
                id: candidateId(issueId, 'add-output', key, source.id, sourceHandle, targetHandle),
                issueId,
                title: `Add ${data.label || lastKeySegment(key)}`,
                description: `Create a visible output for ${fieldLabel(source, sourceHandle)}.`,
                confidence: 'choice' as const,
                targetNodeId: source.id,
                targetHandle: sourceHandle,
                operations: [
                  {
                    kind: 'add_node' as const,
                    ref,
                    nodeKey: key,
                    position: operationPosition('output', source, undefined),
                  },
                  {
                    kind: 'connect' as const,
                    source: { nodeId: source.id, handle: sourceHandle },
                    target: { nodeId: ref, handle: targetHandle },
                  },
                ],
              },
            };
          }),
      ),
    )
    .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title))
    .slice(0, 3)
    .map((item) => item.candidate);
}

export function buildGraphFixPlan(context: GraphFixContext): GraphFixPlan {
  context = { ...context, nodes: nodesWithLiveContracts(context.nodes, context.registry) };
  const issues: GraphFixIssue[] = [];
  const nodesById = new Map(context.nodes.map((node) => [node.id, node]));
  const validIncoming = new Set<string>();

  for (const node of context.nodes) {
    if (!isBlockRootV2Node(node) || !node.data.blockInstanceV2) continue;
    for (const loopIssue of inspectReviewedLoopV2(node.data.blockInstanceV2, context.modularBlockDefinitions ?? [])) {
      const targetNodeId =
        context.nodes.find(
          ({ data, hidden }) =>
            !hidden && data.blockProjectionOwnerId === node.id && data.blockProjectionNodeId === loopIssue.nodeId,
        )?.id ?? node.id;
      const issueId = candidateId('block-loop', node.id, loopIssue.nodeId, loopIssue.fieldId);
      const repairEdge = reviewedLoopRepairEdgeV2(
        node.data.blockInstanceV2,
        loopIssue.nodeId,
        context.modularBlockDefinitions ?? [],
      );
      issues.push({
        id: issueId,
        kind: 'block_structure',
        title: 'Invalid loop connection',
        description: loopIssue.message,
        targetNodeId,
        targetHandle: loopIssue.fieldId,
        candidates: repairEdge
          ? [
              {
                id: candidateId(issueId, 'restore-one-edge'),
                issueId,
                title: 'Reconnect the missing Loop Members link',
                description: `Restore only ${repairEdge.sourceNodeId} → ${repairEdge.targetNodeId}; keep all other edits.`,
                confidence: 'choice',
                targetNodeId,
                operations: [
                  {
                    kind: 'repair_block_loop',
                    rootNodeId: node.id,
                    targetNodeId: loopIssue.nodeId,
                    graphHash: node.data.blockInstanceV2.effectiveGraph.graphHash,
                  },
                ],
              },
            ]
          : [],
      });
    }
    for (const stateIssue of inspectReviewedStateV2(node.data.blockInstanceV2, context.modularBlockDefinitions ?? [])) {
      const targetNodeId =
        context.nodes.find(
          ({ data, hidden }) =>
            !hidden && data.blockProjectionOwnerId === node.id && data.blockProjectionNodeId === stateIssue.nodeId,
        )?.id ?? node.id;
      const issueId = candidateId('block-state-input', node.id, stateIssue.nodeId);
      issues.push({
        id: issueId,
        kind: 'missing_input',
        title: 'Missing upstream inputs',
        description: stateIssue.message,
        targetNodeId,
        candidates: stateIssue.reconnectFrom.map((sourceNodeId) => ({
          id: candidateId(issueId, sourceNodeId),
          issueId,
          title: `Reconnect Pipeline State from ${node.data.blockInstanceV2!.effectiveGraph.nodes.find((item) => item.nodeId === sourceNodeId)?.data.label ?? sourceNodeId}`,
          description: 'Reconnect one edge; keep all other edits.',
          confidence: 'choice',
          targetNodeId,
          operations: [
            {
              kind: 'repair_block_state',
              rootNodeId: node.id,
              sourceNodeId,
              targetNodeId: stateIssue.nodeId,
              graphHash: node.data.blockInstanceV2!.effectiveGraph.graphHash,
            },
          ],
        })),
      });
    }
    const derivedIssues = inspectBlockDerivedControlsV2(
      node.data.blockInstanceV2,
      context.modularBlockDefinitions ?? [],
    ).filter((issue) => issue.canRepair);
    if (derivedIssues.length) {
      const issueId = candidateId('block-derived-control', node.id);
      const fields = [...new Set(derivedIssues.map(({ fieldId }) => fieldId))].join(', ');
      const description = `Repair ${derivedIssues.length} bindings (${fields}) to inherit derived values. Preserve prompts, requested values, layout and other wires.`;
      issues.push({
        id: issueId,
        kind: 'block_derived_control',
        title: 'A mirrored control overwrites an upstream-derived value',
        description,
        targetNodeId: node.id,
        candidates: [
          {
            id: candidateId(issueId, 'inherit-derived-state'),
            issueId,
            title: 'Use the upstream-derived values',
            description,
            confidence: 'choice',
            targetNodeId: node.id,
            operations: derivedIssues.map(({ nodeId, fieldId }) => ({
              kind: 'repair_block_derived_control',
              rootNodeId: node.id,
              sourceNodeId: nodeId,
              fieldId,
            })),
          },
        ],
      });
    }
    for (const seedIssue of inspectBlockSeedBindingsV2(
      node.data.blockInstanceV2,
      context.modularBlockDefinitions ?? [],
    )) {
      if (!seedIssue.canRepair) continue;
      const targetNodeId =
        context.nodes.find(
          ({ data, hidden }) =>
            !hidden && data.blockProjectionOwnerId === node.id && data.blockProjectionNodeId === seedIssue.nodeId,
        )?.id ?? node.id;
      const issueId = candidateId('block-seed', node.id, seedIssue.nodeId);
      issues.push({
        id: issueId,
        kind: 'block_seed',
        title: 'A saved seed is attached to a step that does not consume it',
        description: seedIssue.reason,
        targetNodeId,
        candidates: [
          {
            id: candidateId(issueId, 'move-to-generator'),
            issueId,
            title: 'Connect seed to its Generator consumer',
            description: seedIssue.reason,
            confidence: 'choice',
            targetNodeId,
            operations: [{ kind: 'repair_block_seed', rootNodeId: node.id, sourceNodeId: seedIssue.nodeId }],
          },
        ],
      });
    }
  }

  context.nodes.forEach((node) => {
    const error = blockExecutionError(node);
    if (!error) return;
    const targetNodeId = blockExecutionErrorTarget(node, error, context.nodes);
    const issueId = candidateId('block-structure', node.id, error);
    issues.push({
      id: issueId,
      kind: 'block_structure',
      title: `${node.data.label || 'Block'} has invalid internal structure`,
      description: error,
      targetNodeId,
      candidates: [
        {
          id: candidateId(issueId, 'restore-reviewed'),
          issueId,
          title: 'Restore reviewed internal structure',
          description:
            'Restore the registered nodes and links for this workflow instance. Compatible custom additions are retained; incompatible structural edits are removed.',
          confidence: 'choice',
          targetNodeId,
          operations: [{ kind: 'restore_block_structure', rootNodeId: node.id }],
        },
      ],
    });
  });

  context.edges.forEach((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    const sourceHandle = edge.sourceHandle ?? '';
    const targetHandle = edge.targetHandle ?? '';
    const sourceParam = nodeConnectorParam(source, sourceHandle);
    const targetParam = nodeConnectorParam(target, targetHandle);
    if (!source || !target || !sourceHandle || !targetHandle || !sourceParam || !targetParam) {
      const issueId = candidateId('broken-link', edge.id);
      issues.push({
        id: issueId,
        kind: 'broken_link',
        title: 'Remove a broken connection',
        description: 'One connection points to a node or socket that no longer exists.',
        targetNodeId: target?.id,
        targetHandle: targetHandle || undefined,
        candidates: [
          {
            id: candidateId(issueId, 'remove'),
            issueId,
            title: 'Remove broken link',
            description: 'Delete only the invalid connection.',
            confidence: 'safe',
            targetNodeId: target?.id,
            targetHandle: targetHandle || undefined,
            operations: [{ kind: 'remove_edges', edgeIds: [edge.id] }],
          },
        ],
      });
      return;
    }
    if (!graphSocketTypesAreCompatible(sourceParam, targetParam)) {
      const issueId = candidateId('type-mismatch', edge.id);
      const candidates: GraphFixCandidate[] = bridgeCandidates(
        issueId,
        context,
        source,
        sourceHandle,
        sourceParam,
        target,
        targetHandle,
        targetParam,
        edge.id,
      );
      candidates.push({
        id: candidateId(issueId, 'remove'),
        issueId,
        title: 'Remove incompatible link',
        description: 'Disconnect the mismatched sockets and leave the input highlighted for another fix.',
        confidence: 'safe',
        targetNodeId: target.id,
        targetHandle,
        operations: [{ kind: 'remove_edges', edgeIds: [edge.id] }],
      });
      issues.push({
        id: issueId,
        kind: 'type_mismatch',
        title: `${fieldLabel(source, sourceHandle)} cannot connect to ${fieldLabel(target, targetHandle)}`,
        description: `The sockets use incompatible types: ${normalizedTypes(sourceParam).join(' or ')} and ${normalizedTypes(targetParam).join(' or ')}.`,
        targetNodeId: target.id,
        targetHandle,
        candidates: candidates.slice(0, 3),
      });
      return;
    }
    validIncoming.add(`${target.id}:${targetHandle}`);
  });

  const enabled = executableNodes(context.nodes);
  const outputNodes = enabled.filter(graphNodeIsOutputLike);
  const connectedOutputs = outputNodes.filter((node) =>
    context.edges.some((edge) => edge.target === node.id && nodesById.has(edge.source)),
  );
  if (enabled.length > 0 && connectedOutputs.length === 0 && !enabled.some(blockHasConnectedOutput)) {
    const issueId = 'missing-output';
    const candidates = outputCandidates(issueId, context, outputNodes);
    if (candidates.length) {
      issues.push({
        id: issueId,
        kind: 'missing_output',
        title: outputNodes.length ? 'Connect the graph output' : 'Add a graph output',
        description: outputNodes.length
          ? 'An output node exists, but no generated result reaches it.'
          : 'The graph needs a Preview, Save, or Export node to produce a usable result.',
        targetNodeId: outputNodes[0]?.id,
        candidates,
      });
    }
  }

  const missingOutputTargetIds = new Set(outputNodes.map((node) => node.id));
  enabled.forEach((target) => {
    inputFields(target).forEach(([targetHandle, targetParam]) => {
      // A public socket may mirror a normal editable field. It does not require
      // a wire merely because its text/picker is blank. Required media receives
      // the targeted readiness finding below, not duplicate topology repairs.
      if (blockInputHasFieldControl(target, targetHandle)) return;
      if (!inputIsRequired(targetHandle, targetParam, Boolean(target.data.skipParamsCheck))) return;
      if (validIncoming.has(`${target.id}:${targetHandle}`)) return;
      if (missingOutputTargetIds.has(target.id) && connectedOutputs.length === 0) return;
      const issueId = candidateId('missing-input', target.id, targetHandle);
      const candidates = missingInputCandidates(issueId, context, target, targetHandle, targetParam);
      if (!candidates.length) return;
      issues.push({
        id: issueId,
        kind: 'missing_input',
        title: `${target.data.label || target.data.action} needs ${fieldLabel(target, targetHandle)}`,
        description: 'Connect an existing compatible value or add a matching source node.',
        targetNodeId: target.id,
        targetHandle,
        candidates,
      });
    });
  });

  const seenReadinessKeys = new Set<string>();
  (context.readinessIssues ?? []).forEach((readiness) => {
    if (readiness.code === 'block_media_input_missing' || readiness.code === 'operation_media_input_missing') {
      const issueId = candidateId(readiness.code, readiness.id);
      issues.push({
        id: issueId,
        kind: 'missing_media',
        title: readiness.message,
        description: readiness.details ?? readiness.message,
        targetNodeId: readiness.nodeId,
        targetHandle: readiness.fieldId,
        candidates: [
          {
            id: candidateId(issueId, 'inspect'),
            issueId,
            title: 'Open required input',
            description:
              'Select the affected node and its controls. Choose the file yourself; no mask, prompt or connection is changed automatically.',
            confidence: 'safe',
            targetNodeId: readiness.nodeId,
            targetHandle: readiness.fieldId,
            operations: [{ kind: 'external', action: 'inspect_node', nodeId: readiness.nodeId }],
          },
        ],
      });
      return;
    }
    if (readiness.code === 'modular_component_requirement' || readiness.code === 'modular_runtime_failure') {
      issues.push({
        id: candidateId(readiness.code, readiness.nodeId ?? '', readiness.message),
        kind: 'block_structure',
        title:
          readiness.code === 'modular_runtime_failure'
            ? 'Review the failed Modular block'
            : 'Review component compatibility',
        description: `${readiness.message} ${readiness.details ?? ''}`,
        targetNodeId: readiness.nodeId,
        candidates: [],
      });
      return;
    }
    // Expert mode deliberately demotes policy, artifact, and runtime findings
    // to non-blocking warnings so users can submit the graph to the backend.
    // They are still actionable diagnostics: Graph Fix must keep offering the
    // same explicit Setup, Models, or Gallery route without silently applying
    // anything. Branches below remain the allowlist for fixable findings.
    if (
      ['environment', 'package', 'backend', 'hardware_fit'].includes(readiness.category) &&
      readiness.action === 'open_setup'
    ) {
      const key = `${readiness.category}:${readiness.message}`;
      if (seenReadinessKeys.has(key)) return;
      seenReadinessKeys.add(key);
      const issueId = candidateId(readiness.category, readiness.message);
      const title =
        readiness.category === 'package'
          ? 'Repair backend packages'
          : readiness.category === 'backend'
            ? 'Reconnect or update the backend'
            : readiness.category === 'hardware_fit'
              ? 'Review hardware compatibility'
              : 'Repair the runtime environment';
      issues.push({
        id: issueId,
        kind: 'environment',
        title,
        description: readiness.message,
        candidates: [
          {
            id: candidateId(issueId, 'setup'),
            issueId,
            title: 'Open Setup',
            description: readiness.details || 'Review the detected runtime mismatch and its exact repair command.',
            confidence: 'safe',
            operations: [{ kind: 'external', action: 'open_setup' }],
          },
        ],
      });
    } else if (
      (readiness.category === 'model' || readiness.category === 'model_integrity') &&
      (readiness.repoId || readiness.modelPath)
    ) {
      const key = `missing_model:${readiness.nodeId ?? ''}:${readiness.repoId ?? readiness.modelPath}`;
      if (seenReadinessKeys.has(key)) return;
      seenReadinessKeys.add(key);
      const issueId = candidateId('missing-model', readiness.nodeId, readiness.repoId, readiness.modelPath);
      issues.push({
        id: issueId,
        kind: 'missing_model',
        title: 'Choose or install the required model',
        description: readiness.message,
        targetNodeId: readiness.nodeId,
        candidates: [
          {
            id: candidateId(issueId, 'models'),
            issueId,
            title: 'Open Models',
            description: 'Review compatible installed models or explicitly install the required model.',
            confidence: 'safe',
            targetNodeId: readiness.nodeId,
            operations: [
              {
                kind: 'external',
                action: 'open_model_manager',
                nodeId: readiness.nodeId,
                repoId: readiness.repoId,
              },
            ],
          },
        ],
      });
    } else if (readiness.category === 'asset' && readiness.action === 'select_image') {
      const key = `missing_media:${readiness.nodeId ?? ''}:${readiness.message}`;
      if (seenReadinessKeys.has(key)) return;
      seenReadinessKeys.add(key);
      const issueId = candidateId('missing-media', readiness.nodeId, readiness.message);
      issues.push({
        id: issueId,
        kind: 'missing_media',
        title: 'Choose the required media',
        description: readiness.message,
        targetNodeId: readiness.nodeId,
        candidates: [
          {
            id: candidateId(issueId, 'assets'),
            issueId,
            title: 'Open Gallery',
            description: 'Choose an imported image, video, or audio file without changing the graph automatically.',
            confidence: 'safe',
            targetNodeId: readiness.nodeId,
            operations: [{ kind: 'external', action: 'open_assets', nodeId: readiness.nodeId }],
          },
        ],
      });
    }
  });

  const repairable = issues.filter((item) => item.candidates.length > 0);
  return {
    issues,
    candidateCount: repairable.reduce((count, item) => count + item.candidates.length, 0),
    canFix: repairable.length > 0,
  };
}

function resolvedNodeId(nodeId: string, refs: Map<string, string>) {
  return refs.get(nodeId) ?? nodeId;
}

export function buildGraphFixPreview(
  context: Pick<GraphFixContext, 'nodes' | 'registry'>,
  candidate: GraphFixCandidate | null,
) {
  if (!candidate) return { nodes: [] as CustomNodeType[], edges: [] as Edge[] };
  const refs = new Map<string, string>();
  const nodes: CustomNodeType[] = [];
  candidate.operations.forEach((operation) => {
    if (operation.kind !== 'add_node') return;
    const registryNode = createNodeFromRegistry(operation.nodeKey, context.registry, operation.position);
    if (!registryNode) return;
    const id = `graph-fix-preview-${candidate.id}-${refs.size}`;
    const created: CustomNodeType = {
      ...registryNode,
      id,
      className: 'modiff-graph-fix-ghost',
      draggable: false,
      selectable: false,
      deletable: false,
    };
    created.data.label = `${created.data.label} preview`;
    refs.set(operation.ref, id);
    nodes.push(created);
  });
  const allNodes = [...context.nodes, ...nodes];
  const edges = candidate.operations.flatMap((operation, index): Edge[] => {
    if (operation.kind !== 'connect') return [];
    const source = resolvedNodeId(operation.source.nodeId, refs);
    const target = resolvedNodeId(operation.target.nodeId, refs);
    if (!allNodes.some((node) => node.id === source) || !allNodes.some((node) => node.id === target)) return [];
    return [
      {
        id: `graph-fix-preview-edge-${candidate.id}-${index}`,
        source,
        sourceHandle: operation.source.handle,
        target,
        targetHandle: operation.target.handle,
        type: 'default',
        selectable: false,
        focusable: false,
        className: 'modiff-graph-fix-ghost',
      },
    ];
  });
  return { nodes, edges };
}

export function graphFixHighlightedSockets(candidate: GraphFixCandidate | null) {
  if (!candidate) return [];
  return candidate.operations.flatMap((operation) =>
    operation.kind === 'connect' ? [operation.source, operation.target] : [],
  );
}
