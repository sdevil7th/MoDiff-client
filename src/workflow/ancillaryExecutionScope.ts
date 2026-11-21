import type { Edge } from '@xyflow/react';
import type { NodeData } from '../stores/useNodeStore';
import type { OperationStarter } from './operationAuthoring';
import { executableFlowNodes, selectFlowGraphExecutionScope, type FlowGraphNode } from '../stores/flowGraphExport';
import {
  ancillaryBindingsFromHint,
  invalidAncillary,
  type AncillaryInstanceBinding,
  type AncillaryOperation,
  type AncillaryExecutionPurpose,
} from '../studio/ancillaryOperations';
import {
  parseOperationAuthoringRecipe,
  type OperationAuthoringRecipe,
  type OperationAuthoringSelection,
} from '../studio/operationAuthoringRecipe';
import { canonicalBlockStringifyV2 } from '../studio/blockSchemaV2';

export type CurrentAncillaryParentDefinition = Readonly<{ readonly currentParent: unique symbol }>;
type CurrentParent = {
  recipe: unknown;
  selection: OperationAuthoringSelection;
  definition?: CurrentAncillaryParentDefinition;
};
const parentDefinitions = new WeakMap<
  object,
  { key: string; schemas: Map<string, NodeData>; assertCurrent: () => void }
>();
/** Ephemeral current-response context only; saved hints and JSON copies cannot issue it. */
export function captureCurrentAncillaryParentDefinition(
  starter: OperationStarter,
  binding: Pick<AncillaryInstanceBinding, 'parent' | 'parentRoleNodes'>,
  assertCurrent: () => void,
): CurrentAncillaryParentDefinition {
  assertCurrent();
  const parent = parseOperationAuthoringRecipe(starter.authoring, binding.parent);
  if (
    starter.pipelineClass !== binding.parent.pipelineClass ||
    starter.task !== binding.parent.task ||
    parent.id !== binding.parent.authoringRecipeId ||
    parent.contentHash !== binding.parent.authoringContentHash ||
    parent.baseSpecId !== binding.parent.baseSpecId ||
    parent.baseSpecContentHash !== binding.parent.baseSpecContentHash ||
    !parent.executionProfileIds.includes(binding.parent.executionProfileId)
  )
    invalidAncillary('selected parent definitions differ from the current response.');
  exactRoleMap(binding.parentRoleNodes, parent.roles);
  if (new Set(Object.values(binding.parentRoleNodes)).size !== parent.roles.length)
    invalidAncillary('selected parent role identities collide.');
  const schemas = new Map<string, NodeData>();
  for (const [role, key] of parent.roles) {
    const matches = starter.nodes.filter(({ operation }) => operation.nodeKey === key);
    if (matches.length > 1) invalidAncillary('selected parent definition is ambiguous.');
    const selected = matches[0];
    if (!selected) continue;
    if (
      selected.operation.pipelineClass !== starter.pipelineClass ||
      selected.operation.task !== starter.task ||
      `${selected.node.module}.${selected.node.action}` !== key
    )
      invalidAncillary('selected parent operation identity differs.');
    schemas.set(binding.parentRoleNodes[role]!, structuredClone(selected.node));
  }
  const token = Object.freeze({}) as CurrentAncillaryParentDefinition;
  parentDefinitions.set(token, {
    key: canonicalBlockStringifyV2([binding.parent, binding.parentRoleNodes, parent]),
    schemas,
    assertCurrent,
  });
  return token;
}
/** Preserve the same fresh definition while the existing native editor unpacks IDs. */
export function remapCurrentAncillaryParentDefinition(
  definition: CurrentAncillaryParentDefinition | undefined,
  original: Pick<AncillaryInstanceBinding, 'parent' | 'parentRoleNodes'>,
  next: Pick<AncillaryInstanceBinding, 'parent' | 'parentRoleNodes'>,
): CurrentAncillaryParentDefinition | undefined {
  if (definition === undefined) return undefined;
  const current = parentDefinitions.get(definition);
  if (!current) invalidAncillary('missing current parent definition context.');
  current.assertCurrent();
  const [parent, roles, recipe] = JSON.parse(current.key) as [
    unknown,
    Record<string, string>,
    OperationAuthoringRecipe,
  ];
  if (!equal(parent, original.parent) || !equal(roles, original.parentRoleNodes) || !equal(parent, next.parent))
    invalidAncillary('parent definition remap differs from its original native offer.');
  exactRoleMap(next.parentRoleNodes, recipe.roles);
  if (new Set(Object.values(next.parentRoleNodes)).size !== recipe.roles.length)
    invalidAncillary('parent definition remap collides.');
  const ids = new Map(recipe.roles.map(([role]) => [roles[role]!, next.parentRoleNodes[role]!]));
  const token = Object.freeze({}) as CurrentAncillaryParentDefinition;
  parentDefinitions.set(token, {
    key: canonicalBlockStringifyV2([next.parent, next.parentRoleNodes, recipe]),
    schemas: new Map([...current.schemas].map(([id, node]) => [ids.get(id)!, node])),
    assertCurrent: current.assertCurrent,
  });
  return token;
}
function currentParentSchemas(
  definition: CurrentAncillaryParentDefinition | undefined,
  parent: OperationAuthoringRecipe,
  binding: AncillaryInstanceBinding,
) {
  if (definition === undefined) return undefined;
  const value = definition && typeof definition === 'object' ? parentDefinitions.get(definition) : undefined;
  if (!value || value.key !== canonicalBlockStringifyV2([binding.parent, binding.parentRoleNodes, parent]))
    invalidAncillary('missing or stale current parent definition context.');
  value.assertCurrent();
  return value.schemas;
}
export type AncillaryScopeResult = {
  purpose: AncillaryExecutionPurpose | undefined;
  nodeIds: string[];
  targetNodeIds: string[] | undefined;
};
type ScopeOptions = {
  /** Already expanded native leaves from the existing canonical materializer. */
  nodes: FlowGraphNode[];
  edges: Edge[];
  parents: readonly CurrentParent[];
  registry: Record<string, NodeData>;
  kind: 'workflow' | 'explicit_preview';
  target?: { nodeId: string; outputField: string };
  workflowTargetNodeIds?: string[];
};
function equal(left: unknown, right: unknown) {
  return canonicalBlockStringifyV2(left) === canonicalBlockStringifyV2(right);
}
function exactRoleMap(map: Record<string, string>, roles: readonly [string, ...unknown[]][]) {
  if (!equal(Object.keys(map).sort(), roles.map(([role]) => role).sort()))
    invalidAncillary('role map does not cover its exact current declaration.');
}
function key(node: FlowGraphNode) {
  return `${node.data.module}.${node.data.action}`;
}
function literal(node: FlowGraphNode, name: string, edges: Edge[]) {
  if (edges.some((edge) => edge.target === node.id && edge.targetHandle === name))
    invalidAncillary('claimed request fields require actual authored literals.');
  const param = node.data.params[name];
  if (!param) invalidAncillary('bound field is missing.');
  return param.value ?? param.default;
}
function staticField(
  registry: Record<string, NodeData>,
  node: FlowGraphNode,
  field: string,
  output: boolean,
  selected?: Map<string, NodeData>,
) {
  const declared = selected?.has(node.id) ? selected.get(node.id)!.params[field] : registry[key(node)]?.params[field];
  if (!declared || (declared.display === 'output') !== output || !node.data.params[field])
    invalidAncillary('bound field/direction is not currently registered.');
  return declared;
}
function roleNodes(
  nodes: Map<string, FlowGraphNode>,
  roles: readonly [string, string, number, number][],
  map: Record<string, string>,
) {
  exactRoleMap(map, roles);
  for (const [role, action] of roles) {
    const node = nodes.get(map[role]!);
    if (!node || key(node) !== action) invalidAncillary('role differs from its native leaf.');
  }
}
function edgeSignature(edge: Pick<Edge, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>) {
  return canonicalBlockStringifyV2([edge.source, edge.sourceHandle ?? null, edge.target, edge.targetHandle ?? null]);
}
function declaredEdges(edges: readonly [string, string, string, string][], map: Record<string, string>) {
  return edges.map(([a, b, c, d]) => ({ source: map[a]!, sourceHandle: b, target: map[c]!, targetHandle: d }));
}
function requireEdges(actual: Edge[], expected: ReturnType<typeof declaredEdges>) {
  for (const edge of expected)
    if (actual.filter((candidate) => edgeSignature(candidate) === edgeSignature(edge)).length !== 1)
      invalidAncillary('declared edge is missing or ambiguous.');
}

/** Pure selection only. No graph mutation, preparation, Auto, owner release or Run. */
export function selectAncillaryExecutionScope({
  nodes,
  edges,
  parents,
  registry,
  kind,
  target,
  workflowTargetNodeIds,
}: ScopeOptions): AncillaryScopeResult {
  if (kind !== 'workflow' && kind !== 'explicit_preview') invalidAncillary('unknown scope kind.');
  if (kind === 'workflow' && target !== undefined) invalidAncillary('ordinary workflow has no Preview target.');
  const claimed = nodes.flatMap((node) => {
    const bindings = ancillaryBindingsFromHint(node.data.operationAuthoring);
    return bindings ? bindings.map((binding) => ({ holderId: node.id, binding })) : [];
  });
  if (!claimed.length) {
    if (kind !== 'workflow') invalidAncillary('Preview needs a current declared binding.');
    return {
      purpose: undefined,
      nodeIds: selectFlowGraphExecutionScope({ nodes, edges, targetNodeIds: workflowTargetNodeIds }).nodes.map(
        (node) => node.id,
      ),
      targetNodeIds: workflowTargetNodeIds,
    };
  }
  if (claimed.length > 4) invalidAncillary('too many selected ancillary bindings.');
  const native = new Map(nodes.map((node) => [node.id, node]));
  if (native.size !== nodes.length) invalidAncillary('duplicate native node identities.');
  if (parents.length > 4) invalidAncillary('too many current parents.');
  const contracts = parents.map(({ recipe, selection, definition }) => ({
    parent: parseOperationAuthoringRecipe(recipe, selection),
    definition,
  }));
  const seen = new Set<string>(),
    childIds = new Set<string>();
  const resolved: Array<{
    binding: AncillaryInstanceBinding;
    contract: AncillaryOperation;
    parent: OperationAuthoringRecipe;
  }> = [];
  for (const { holderId, binding } of claimed) {
    if (seen.has(binding.contractId)) invalidAncillary('duplicate claimed ancillary contract.');
    seen.add(binding.contractId);
    const matches = contracts.flatMap(({ parent, definition }) =>
      (parent.ancillaryOperations ?? [])
        .filter((child) => child.id === binding.contractId)
        .map((contract) => ({ parent, contract, definition })),
    );
    if (matches.length !== 1) invalidAncillary('missing or ambiguous current ancillary declaration.');
    const { parent, contract, definition } = matches[0]!;
    const selectedParent = currentParentSchemas(definition, parent, binding);
    if (
      binding.contentHash !== contract.contentHash ||
      !equal(binding.parent, { ...contract.parent, authoringContentHash: parent.contentHash })
    )
      invalidAncillary('stale or mixed current parent/child identity.');
    roleNodes(native, parent.roles, binding.parentRoleNodes);
    roleNodes(native, contract.roles, binding.roleNodes);
    if (holderId !== binding.parentRoleNodes[contract.bindings.owner.role])
      invalidAncillary('claim is not on its exact declared input owner.');
    requireEdges(edges, declaredEdges(parent.edges, binding.parentRoleNodes));
    const child = Object.values(binding.roleNodes);
    if (child.some((id) => childIds.has(id))) invalidAncillary('ancillary instance IDs collide.');
    child.forEach((id) => childIds.add(id));
    const expected = declaredEdges(contract.edges, binding.roleNodes);
    const reference = contract.bindings.owner.referenceSource;
    if (reference)
      expected.push({
        source: binding.parentRoleNodes[reference.role]!,
        sourceHandle: reference.field,
        target: binding.roleNodes[contract.bindings.request.role]!,
        targetHandle: contract.bindings.request.imagesField,
      });
    requireEdges(edges, expected);
    for (const edge of expected) {
      const from = staticField(registry, native.get(edge.source)!, edge.sourceHandle, true);
      const to = staticField(registry, native.get(edge.target)!, edge.targetHandle, false);
      if (!equal(from.type, to.type)) invalidAncillary('declared child field types differ.');
    }
    for (const edge of edges.filter((edge) => child.includes(edge.source) || child.includes(edge.target)))
      if (!expected.some((candidate) => edgeSignature(candidate) === edgeSignature(edge)))
        invalidAncillary('undeclared ancillary or cross-branch connection.');
    const owner = native.get(holderId)!,
      request = native.get(binding.roleNodes[contract.bindings.request.role]!)!;
    for (const [ownerField, requestField] of [
      [contract.bindings.owner.promptField, contract.bindings.request.promptField],
      [contract.bindings.owner.layoutField, contract.bindings.request.layoutField],
    ]) {
      staticField(registry, owner, ownerField!, false, selectedParent);
      staticField(registry, request, requestField!, false);
      if (
        kind === 'explicit_preview' &&
        !equal(literal(owner, ownerField!, edges) ?? null, literal(request, requestField!, edges) ?? null)
      )
        invalidAncillary('request differs from the current authored input owner.');
    }
    for (const [role, name, value] of contract.initialValues) {
      const node = native.get(binding.roleNodes[role]!)!;
      staticField(registry, node, name, false);
      if (kind === 'explicit_preview' && !equal(literal(node, name, edges), value))
        invalidAncillary('declared input selection changed.');
    }
    const output = native.get(binding.roleNodes[contract.bindings.output.role]!)!;
    if (staticField(registry, output, contract.bindings.output.field, true).type !== 'string')
      invalidAncillary('Preview requires the declared static string output.');
    if (reference) {
      const source = native.get(binding.parentRoleNodes[reference.role]!)!;
      const from = staticField(registry, source, reference.field, true, selectedParent),
        to = staticField(registry, request, contract.bindings.request.imagesField, false);
      if (!equal(from.type, to.type)) invalidAncillary('declared reference field types differ.');
    } else if (kind === 'explicit_preview' && literal(request, contract.bindings.request.imagesField, edges) != null)
      invalidAncillary('text-only Preview has no authored image source.');
    resolved.push({ parent, contract, binding });
  }
  if (kind === 'explicit_preview') {
    if (!target) invalidAncillary('Preview target is required.');
    const matches = resolved.filter(
      ({ contract, binding }) =>
        target.nodeId === binding.roleNodes[contract.bindings.output.role] &&
        target.outputField === contract.bindings.output.field,
    );
    if (matches.length !== 1) invalidAncillary('target is not the exact declared proposal output.');
    const { binding, contract } = matches[0]!;
    const selected = selectFlowGraphExecutionScope({ nodes, edges, targetNodeId: target.nodeId }).nodes;
    const reference = contract.bindings.owner.referenceSource;
    const expected = [
      ...Object.values(binding.roleNodes),
      ...(reference ? [binding.parentRoleNodes[reference.role]!] : []),
    ];
    const inLoop = (node: FlowGraphNode) => {
      let id = node.parentId,
        remaining = nodes.length;
      while (id && remaining--) {
        const owner = native.get(id);
        if (owner?.data.type === 'loop') return true;
        id = owner?.parentId;
      }
      return false;
    };
    if (!equal(selected.map((node) => node.id).sort(), expected.sort()) || selected.some(inLoop))
      invalidAncillary('Preview has an undeclared ancestor, disabled role or loop body.');
    return {
      purpose: { schemaVersion: 1, kind, bindings: [binding], target: { ...target } },
      nodeIds: selected.map((node) => node.id),
      targetNodeIds: [target.nodeId],
    };
  }
  const executable = executableFlowNodes(nodes),
    active = new Set(executable.map((node) => node.id));
  const terminals = executable.filter(
    (node) => !edges.some((edge) => edge.source === node.id && active.has(edge.target)),
  );
  const seeds = workflowTargetNodeIds
    ? workflowTargetNodeIds.filter((id) => !childIds.has(id))
    : (terminals.length ? terminals : executable).filter((node) => !childIds.has(node.id)).map((node) => node.id);
  if (!seeds.length) invalidAncillary('ordinary workflow has no remaining executable output.');
  const selected = selectFlowGraphExecutionScope({ nodes, edges, targetNodeIds: seeds }).nodes;
  if (!selected.length) invalidAncillary('ordinary scope has no executable output.');
  const selectedIds = new Set(selected.map((node) => node.id));
  const included = resolved.filter(({ binding }) =>
    Object.values(binding.parentRoleNodes).some((id) => selectedIds.has(id)),
  );
  if (included.some(({ binding }) => Object.values(binding.parentRoleNodes).some((id) => !selectedIds.has(id))))
    invalidAncillary('ordinary scope omits a declared parent role.');
  if (selected.some((node) => childIds.has(node.id)))
    invalidAncillary('ordinary workflow still depends on a Preview-only role.');
  return {
    purpose: included.length
      ? { schemaVersion: 1, kind, bindings: included.map((item) => item.binding), target: null }
      : undefined,
    nodeIds: selected.map((node) => node.id),
    targetNodeIds: seeds,
  };
}
