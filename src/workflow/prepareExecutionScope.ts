import type { Edge } from '@xyflow/react';
import {
  useFlowStore,
  expandFlowExecutionGraph,
  flowExecutionScopeSourceKey,
  resolveFlowExecutionTargetNodeIds,
  type CustomNodeType,
  type APIGraphExport,
} from '../stores/useFlowStore';
import {
  captureWorkflowOperationContext,
  assertWorkflowOperationContext,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { blockProjectionNodeIdV2 } from '../studio/blockRuntimeV2';
import { canonicalBlockStringifyV2 } from '../studio/blockSchemaV2';
import { ancillaryBindingsFromHint, invalidAncillary } from '../studio/ancillaryBindings';
import type { OperationAuthoringRecipe } from '../studio/operationAuthoringRecipe';
import type { AncillaryScopeResult } from './ancillaryExecutionScope';

/** Local freshness witness only. The server independently validates every claim. */
export type PreparedExecutionScope = Readonly<{ readonly scope: unique symbol }>;
export type PrepareExecutionScopeOptions = {
  targetNodeId?: string;
  previewTarget?: { nodeId: string; outputField: string };
  workflowContext?: WorkflowOperationContext;
  signal?: AbortSignal;
};
type Resolved = {
  sourceKey: string;
  targetNodeId: string | undefined;
  result: AncillaryScopeResult;
  context: WorkflowOperationContext;
  rootNodeIds: Set<string>;
  exportedGraph?: APIGraphExport;
};
const resolved = new WeakMap<PreparedExecutionScope, Resolved>();

/** Only active durable graph data is examined; never inactive route drafts. */
export function hasAncillaryExecutionClaim(nodes: CustomNodeType[]): boolean {
  return nodes.some((node) => {
    if (ancillaryBindingsFromHint(node.data.operationAuthoring)) return true;
    const effective = node.data.blockInstanceV2?.effectiveGraph.nodes;
    if (effective?.some((leaf) => ancillaryBindingsFromHint(leaf.data.operationAuthoring))) return true;
    const snapshot = node.data.userBlockSnapshot;
    return (
      snapshot?.nodes.some((leaf) => {
        if (!leaf || typeof leaf !== 'object' || !('data' in leaf)) return false;
        const data = leaf.data;
        return Boolean(
          data &&
          typeof data === 'object' &&
          'operationAuthoring' in data &&
          ancillaryBindingsFromHint(data.operationAuthoring),
        );
      }) ?? false
    );
  });
}

export function assertPreparedExecutionScope(
  scope: PreparedExecutionScope | undefined,
  sourceKey: string,
  targetNodeId: string | undefined,
): AncillaryScopeResult {
  const current = scope && resolved.get(scope);
  if (!current || current.sourceKey !== sourceKey || current.targetNodeId !== targetNodeId)
    invalidAncillary('resolve a fresh execution scope for this exact workflow and target before export.');
  assertWorkflowOperationContext(current.context);
  return current.result;
}

export function executionScopeIncludesRoot(scope: PreparedExecutionScope | undefined, rootId: string) {
  return scope === undefined || resolved.get(scope)?.rootNodeIds.has(rootId) === true;
}

export function executionScopeRootIds(scope: PreparedExecutionScope | undefined) {
  return scope ? [...(resolved.get(scope)?.rootNodeIds ?? [])] : undefined;
}

export function assertCurrentExecutionScope(scope: PreparedExecutionScope | undefined) {
  if (scope) {
    const current = resolved.get(scope);
    if (!current) invalidAncillary('unknown execution scope.');
    assertPreparedExecutionScope(scope, currentFlow().sourceKey(), current.targetNodeId);
  }
}

/** Export may synchronously commit its existing randomized seed values. */
export function recordExecutionScopeExport(scope: PreparedExecutionScope, sourceKey: string, graph: APIGraphExport) {
  const current = resolved.get(scope);
  if (!current) invalidAncillary('unknown execution scope.');
  current.sourceKey = sourceKey;
  current.exportedGraph = structuredClone(graph);
}

export function assertExecutionScopeSubmission(scope: PreparedExecutionScope, graph: APIGraphExport) {
  assertCurrentExecutionScope(scope);
  const expected = resolved.get(scope)?.exportedGraph;
  if (!expected) invalidAncillary('execution scope has not been exported.');
  assertExecutionScopeGraph(graph, expected);
}

export function assertExecutionScopeGraph(graph: APIGraphExport, expected: APIGraphExport) {
  const shape = (value: APIGraphExport) => ({
    nodes: value.nodes,
    paths: value.paths,
    loopsPresent: Object.prototype.hasOwnProperty.call(value, 'loops'),
    loops: value.loops ?? null,
    purposePresent: Object.prototype.hasOwnProperty.call(value.runtimeHints ?? {}, 'executionPurpose'),
    purpose: value.runtimeHints?.executionPurpose ?? null,
  });
  if (canonicalBlockStringifyV2(shape(graph)) !== canonicalBlockStringifyV2(shape(expected)))
    invalidAncillary('prepared nodes, paths, loops or execution purpose differ from the resolved scope.');
}

/** The unclaimed path deliberately stays synchronous and does not fetch metadata. */
export function prepareExecutionScope(
  options: PrepareExecutionScopeOptions = {},
): Promise<PreparedExecutionScope> | undefined {
  const state = currentFlow();
  if (!hasAncillaryExecutionClaim(state.nodes)) {
    if (options.previewTarget) invalidAncillary('Preview needs a current declared binding.');
    return undefined;
  }
  const context = { ...(options.workflowContext ?? captureWorkflowOperationContext()) };
  return resolve(state, state.sourceKey(), context, options);
}

type FlowAccess = {
  nodes: CustomNodeType[];
  edges: Edge[];
  sourceKey: () => string;
  expand: () => { nodes: CustomNodeType[]; edges: Edge[] };
  targets: (target?: string) => string[] | undefined;
};
function currentFlow(): FlowAccess {
  const state = useFlowStore.getState();
  return {
    nodes: state.nodes,
    edges: state.edges,
    sourceKey: () => flowExecutionScopeSourceKey(useFlowStore.getState().nodes, useFlowStore.getState().edges),
    expand: () => expandFlowExecutionGraph(state.nodes, state.edges),
    targets: (target) => resolveFlowExecutionTargetNodeIds(state.nodes, target, state.edges),
  };
}

async function resolve(
  initial: FlowAccess,
  sourceKey: string,
  context: WorkflowOperationContext,
  options: PrepareExecutionScopeOptions,
): Promise<PreparedExecutionScope> {
  const { useNodesStore } = await import('../stores/useNodeStore');
  const { requestOperationStarter } = await import('./operationStarterRequest');
  const { selectAncillaryExecutionScope, captureCurrentAncillaryParentDefinition } =
    await import('./ancillaryExecutionScope');
  const checkSource = () => {
    assertWorkflowOperationContext(context);
    if (currentFlow().sourceKey() !== sourceKey) invalidAncillary('workflow changed while resolving its declaration.');
    options.signal?.throwIfAborted();
  };
  checkSource();
  const native = initial.expand();
  const claims = native.nodes.flatMap((node) => ancillaryBindingsFromHint(node.data.operationAuthoring) ?? []);
  if (!claims.length || claims.length > 4) invalidAncillary('claimed binding is not in the active native graph.');
  const roleIds = new Set(
    claims.flatMap((claim) => [...Object.values(claim.parentRoleNodes), ...Object.values(claim.roleNodes)]),
  );
  const actions = [
    ...new Set(
      native.nodes.filter((node) => roleIds.has(node.id)).map((node) => `${node.data.module}.${node.data.action}`),
    ),
  ].sort();
  const metadataKey = () =>
    canonicalBlockStringifyV2({
      operations: useNodesStore
        .getState()
        .operationContracts.filter((operation) =>
          claims.some(
            (claim) => operation.pipelineClass === claim.parent.pipelineClass && operation.task === claim.parent.task,
          ),
        ),
      registry: actions.map((action) => [action, useNodesStore.getState().nodesRegistry[action] ?? null]),
    });
  const originalMetadata = metadataKey();
  const check = () => {
    checkSource();
    if (metadataKey() !== originalMetadata)
      invalidAncillary('selected registry or operation metadata changed while resolving the declaration.');
  };
  const parents: Array<{
    recipe: OperationAuthoringRecipe;
    selection: (typeof claims)[number]['parent'];
    definition: ReturnType<typeof captureCurrentAncillaryParentDefinition>;
  }> = [];
  for (const claim of claims) {
    const identity = claim.parent;
    const operations = useNodesStore.getState().operationContracts;
    const selection = { ...identity };
    const starter = await requestOperationStarter(
      identity.pipelineClass,
      identity.task,
      operations,
      options.signal,
      identity.executionProfileId,
      identity.authoringRecipeId,
    );
    check();
    if (!starter.authoring) invalidAncillary('current metadata has no selected authoring declaration.');
    const recipe = starter.authoring;
    const literal = (role: string, field: string) => {
      const id = claim.parentRoleNodes[role];
      const node = native.nodes.find((candidate) => candidate.id === id);
      const param = node?.data.params[field];
      if (!node || !param || native.edges.some((edge) => edge.target === id && edge.targetHandle === field))
        invalidAncillary('model identity must be an actual bound authored literal.');
      return param.value ?? param.default;
    };
    const repositoryBindings = recipe.bindings.filter(([, , source]) => source === 'artifact');
    if (repositoryBindings.length !== 1) invalidAncillary('current declaration has no unique model artifact binding.');
    const [role, field] = repositoryBindings[0]!;
    const artifact = literal(role, field);
    if (
      !artifact ||
      typeof artifact !== 'object' ||
      Array.isArray(artifact) ||
      !('source' in artifact) ||
      artifact.source !== 'hub' ||
      !('value' in artifact) ||
      typeof artifact.value !== 'string' ||
      !artifact.value
    )
      invalidAncillary('selected model needs an immutable Hub repository.');
    const selected = await requestOperationStarter(
      identity.pipelineClass,
      identity.task,
      operations,
      options.signal,
      identity.executionProfileId,
      identity.authoringRecipeId,
      artifact.value,
    );
    check();
    if (!selected.authoring || canonicalBlockStringifyV2(recipe) !== canonicalBlockStringifyV2(selected.authoring))
      invalidAncillary('selected repository changed the current authoring declaration.');
    for (const [boundRole, boundField, source] of recipe.bindings) {
      if (source !== 'pipelineClass' && source !== 'defaultRevision') continue;
      const actual = literal(boundRole, boundField);
      const expected =
        source === 'pipelineClass'
          ? identity.pipelineClass
          : selected.nodes
              .filter(({ operation }) => operation.nodeKey === recipe.roles.find(([role]) => role === boundRole)?.[1])
              .flatMap(({ node }) => {
                const value = node.params[boundField]?.value ?? node.params[boundField]?.default;
                return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value) ? [value] : [];
              });
      if (
        source === 'pipelineClass'
          ? actual !== expected
          : !Array.isArray(expected) || expected.length !== 1 || actual !== expected[0]
      )
        invalidAncillary('current model identity or immutable revision differs from selected metadata.');
    }
    parents.push({ recipe, selection, definition: captureCurrentAncillaryParentDefinition(selected, claim, check) });
  }
  check();
  const result = selectAncillaryExecutionScope({
    ...native,
    parents,
    registry: useNodesStore.getState().nodesRegistry,
    kind: options.previewTarget ? 'explicit_preview' : 'workflow',
    target: options.previewTarget,
    workflowTargetNodeIds: options.previewTarget ? undefined : initial.targets(options.targetNodeId),
  });
  const selectedIds = new Set(result.nodeIds);
  const rootNodeIds = new Set(
    initial.nodes
      .filter(
        (node) =>
          selectedIds.has(node.id) ||
          node.data.blockInstanceV2?.effectiveGraph.nodes.some(({ nodeId }) =>
            selectedIds.has(blockProjectionNodeIdV2(node.id, nodeId)),
          ),
      )
      .map((node) => node.id),
  );
  const witness = Object.freeze({}) as PreparedExecutionScope;
  resolved.set(witness, { sourceKey, context, targetNodeId: options.targetNodeId, result, rootNodeIds });
  return witness;
}
