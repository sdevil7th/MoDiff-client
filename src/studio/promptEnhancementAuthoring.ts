import type { CurrentAncillaryParentDefinition } from '../workflow/ancillaryExecutionScope';
import type { AncillaryOperation, AncillaryInstanceBinding } from './ancillaryOperations';
import { invalidAncillary } from './ancillaryBindings';
import {
  PARENT_KEYS,
  parsePromptEnhancementParent,
  promptEnhancementParentFromHint,
  type PromptEnhancementParent,
} from './promptEnhancementParent';
export {
  parsePromptEnhancementParent,
  promptEnhancementParentFromHint,
  remapPromptEnhancementParent,
} from './promptEnhancementParent';
export type { PromptEnhancementParent } from './promptEnhancementParent';
import type { OperationAuthoringRecipe } from './operationAuthoringRecipe';
import type { OperationGraph } from '../workflow/operationAuthoring';
import type { NodeData } from '../stores/useNodeStore';

/** Attach only a backend-declared offer to its actual prompt owner before grouping.
 * This does not add a branch, change values, make a request, or grant readiness. */
export function attachPromptEnhancementParents(graph: OperationGraph, recipe: OperationAuthoringRecipe | undefined) {
  if (!recipe?.ancillaryOperations) return graph;
  const roleNodes: Record<string, string> = {};
  for (const [role, key] of recipe.roles) {
    const matches = graph.nodes.filter(
      (node) => node.data.studioRole === role && `${node.data.module}.${node.data.action}` === key,
    );
    if (matches.length !== 1) invalidAncillary('prompt enhancement parent role is missing or ambiguous.');
    roleNodes[role] = matches[0]!.id;
  }
  for (const child of recipe.ancillaryOperations) {
    const owner = graph.nodes.find((node) => node.id === roleNodes[child.bindings.owner.role]);
    if (!owner?.data.operationAuthoring) invalidAncillary('prompt enhancement needs an ordinary declared input owner.');
    owner.data.operationAuthoring.ancillaryParent = parsePromptEnhancementParent({
      schemaVersion: 1,
      parent: { ...child.parent, authoringContentHash: recipe.contentHash },
      parentRoleNodes: roleNodes,
    });
  }
  return graph;
}

/** Rebuild advisory offers after a normal model/task change. Only replacement
 * operations and directly connected non-operation leaves can form this parent.
 * Incomplete or ambiguous custom graphs retain the ordinary editing path. */
export function refreshPromptEnhancementParents(
  graph: OperationGraph,
  recipe: OperationAuthoringRecipe | undefined,
  operationNodeIds: readonly string[],
): OperationGraph {
  if (!recipe?.ancillaryOperations) return graph;
  const selected = new Set(operationNodeIds);
  const keys = new Set(recipe.roles.map(([, key]) => key));
  const moduleKey = (node: OperationGraph['nodes'][number]) => `${node.data.module}.${node.data.action}`;
  for (const edge of graph.edges) {
    const externalId = selected.has(edge.source) ? edge.target : selected.has(edge.target) ? edge.source : undefined;
    const node = graph.nodes.find((node) => node.id === externalId);
    if (node && !node.data.operationAuthoring?.operation && keys.has(moduleKey(node))) selected.add(node.id);
  }
  const roleNodes = new Map<string, string>();
  for (const [role, key] of recipe.roles) {
    const candidates = graph.nodes.filter((node) => selected.has(node.id) && moduleKey(node) === key);
    const assigned = candidates.filter((node) => node.data.studioRole === role);
    const node = assigned.length === 1 ? assigned[0] : candidates.length === 1 ? candidates[0] : undefined;
    if (!node || [...roleNodes.values()].includes(node.id)) return graph;
    roleNodes.set(role, node.id);
  }
  if (
    recipe.edges.some(
      ([from, output, to, input]) =>
        graph.edges.filter(
          (edge) =>
            edge.source === roleNodes.get(from) &&
            edge.sourceHandle === output &&
            edge.target === roleNodes.get(to) &&
            edge.targetHandle === input,
        ).length !== 1,
    )
  )
    return graph;
  const roles = new Map([...roleNodes].map(([role, id]) => [id, role]));
  const parentNodes = graph.nodes
    .filter((node) => roles.has(node.id))
    .map((node) => ({
      ...node,
      data: { ...structuredClone(node.data), studioRole: roles.get(node.id)! },
    }));
  attachPromptEnhancementParents({ nodes: parentNodes, edges: graph.edges }, recipe);
  const replacements = new Map(parentNodes.map((node) => [node.id, node]));
  return { ...graph, nodes: graph.nodes.map((node) => replacements.get(node.id) ?? node) };
}

export type AuthoredEnhancementPair = { prompt: string; layout: unknown };

function sameParent(selection: PromptEnhancementParent, recipe: OperationAuthoringRecipe) {
  const parent = selection.parent;
  if (
    parent.authoringRecipeId !== recipe.id ||
    parent.authoringContentHash !== recipe.contentHash ||
    parent.baseSpecId !== recipe.baseSpecId ||
    parent.baseSpecContentHash !== recipe.baseSpecContentHash ||
    !recipe.executionProfileIds.includes(parent.executionProfileId)
  )
    invalidAncillary('refresh the selected parent declaration before editing enhancement.');
}

async function editableContext(graph: OperationGraph, ownerId: string) {
  const groups = await import('../workflow/visualOperationGroups');
  const { blockProjectionNodeIdV2 } = await import('./blockRuntimeV2');
  const unpacked = groups.unpackVisualOperationGroups(structuredClone(graph));
  const containing = unpacked.roots.find((root) =>
    root.data.blockInstanceV2!.effectiveGraph.nodes.some(
      (leaf) => blockProjectionNodeIdV2(root.id, leaf.nodeId) === ownerId,
    ),
  );
  const originalLeaf = containing?.data.blockInstanceV2!.effectiveGraph.nodes.find(
    (leaf) => blockProjectionNodeIdV2(containing.id, leaf.nodeId) === ownerId,
  );
  const id = containing && originalLeaf ? `${containing.id}/${originalLeaf.nodeId}` : ownerId;
  const owner = unpacked.graph.nodes.find((node) => node.id === id);
  const selection = promptEnhancementParentFromHint(owner?.data.operationAuthoring);
  if (!owner || !selection) invalidAncillary('select the current declared Prompt/Inputs stage.');
  return { groups, unpacked, containing, owner, selection };
}

function selectedChild(selection: PromptEnhancementParent, recipe: OperationAuthoringRecipe, childId: string) {
  sameParent(selection, recipe);
  const child = recipe.ancillaryOperations?.find((child) => child.id === childId);
  if (!child) invalidAncillary('the current declaration has no selected enhancement.');
  for (const key of PARENT_KEYS) {
    if (key !== 'authoringContentHash' && child.parent[key] !== selection.parent[key])
      invalidAncillary('the enhancement belongs to a different selected parent.');
  }
  return child;
}

function authoredPair(graph: OperationGraph, ownerId: string, child: AncillaryOperation): AuthoredEnhancementPair {
  const owner = graph.nodes.find((node) => node.id === ownerId);
  const { promptField, layoutField } = child.bindings.owner;
  if (
    !owner ||
    [promptField, layoutField].some((field) =>
      graph.edges.some((edge) => edge.target === ownerId && edge.targetHandle === field),
    )
  )
    invalidAncillary('enhancement needs authored inline prompt and layout controls.');
  const prompt = owner.data.params[promptField],
    layout = owner.data.params[layoutField];
  const value = prompt?.value ?? prompt?.default;
  if (typeof value !== 'string' || !layout) invalidAncillary('the declared prompt or layout control is unavailable.');
  return { prompt: value, layout: structuredClone(layout.value ?? layout.default ?? null) };
}

function assertDeclaredLayout(child: AncillaryOperation, layout: unknown) {
  if (
    layout !== null &&
    child.verification &&
    !child.verification.supportedPromptModes.some(
      (mode) => mode === (child.bindings.owner.referenceSource ? 'i2i_bbox' : 't2i_bbox'),
    )
  )
    invalidAncillary('this enhancement does not support authored layout objects. Keep the raw prompt/layout path.');
}

export async function promptEnhancementPairHash(pair: AuthoredEnhancementPair): Promise<`sha256:${string}`> {
  const { canonicalBlockStringifyV2 } = await import('./blockSchemaV2');
  const body = new TextEncoder().encode(canonicalBlockStringifyV2(pair));
  const hash = await crypto.subtle.digest('SHA-256', body);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Add real registry nodes to the existing graph. Callers must freshly resolve recipe. */
export async function planEnablePromptEnhancement(
  graph: OperationGraph,
  ownerId: string,
  recipe: OperationAuthoringRecipe,
  childId: string,
  registry: Record<string, NodeData>,
  definition?: CurrentAncillaryParentDefinition,
): Promise<OperationGraph> {
  const context = await editableContext(graph, ownerId);
  const { owner, selection, unpacked, groups, containing } = context;
  const child = selectedChild(selection, recipe, childId);
  const { ancillaryBindingsFromHint, parseAncillaryBindings } = await import('./ancillaryOperations');
  if (ancillaryBindingsFromHint(owner.data.operationAuthoring))
    invalidAncillary('disable the current enhancement before selecting another one.');
  const pair = authoredPair(unpacked.graph, owner.id, child);
  const { parseLayoutConditioning } = await import('./layoutConditioning');
  parseLayoutConditioning(pair.layout);
  assertDeclaredLayout(child, pair.layout);
  if (pair.layout !== null) {
    const layout = parseLayoutConditioning(pair.layout);
    if (
      !layout ||
      layout.regions.some((region) => 'source' in region || ('action' in region && region.action !== 'place'))
    )
      invalidAncillary('enhancement does not support source-region or removal proposals; keep the raw prompt path.');
  }
  const { createNodeFromRegistry } = await import('../workflow/nodeFactory');
  const children = child.roles.map(([role, key, x, y]) => {
    const node = createNodeFromRegistry(key, registry, { x: owner.position.x + x, y: owner.position.y + y });
    if (!node) invalidAncillary('refresh the node registry before enabling enhancement.');
    return { role, node };
  });
  const roleNodes = Object.fromEntries(children.map(({ role, node }) => [role, node.id]));
  if (child.verification) {
    for (const mapping of [child.verification.runtimeInputs, child.verification.requestInputs]) {
      const node = children.find((item) => item.role === mapping.role)?.node;
      for (const [name, field] of Object.entries(mapping)) {
        if (name === 'role') continue;
        const param = node?.data.params[field];
        if (!param || param.display === 'output' || param.display === 'input' || param.signal)
          invalidAncillary('the declared enhancement literal control is unavailable.');
      }
    }
  }
  for (const [role, field, override] of child.fieldOverrides ?? []) {
    const node = children.find((item) => item.role === role)?.node;
    const param = node?.data.params[field];
    if (!param || param.display === 'output' || param.display === 'input' || param.signal)
      invalidAncillary('the declared enhancement presentation does not match a registered control.');
    param.hidden = override.hidden;
  }
  const write = (role: string, field: string, value: unknown) => {
    const node = children.find((item) => item.role === role)?.node;
    const param = node?.data.params[field];
    if (!param || param.display === 'output') invalidAncillary('the declared enhancement input is unavailable.');
    param.value = structuredClone(value);
  };
  for (const [role, field, value] of child.initialValues) write(role, field, value);
  write(child.bindings.request.role, child.bindings.request.promptField, pair.prompt);
  write(child.bindings.request.role, child.bindings.request.layoutField, pair.layout);
  const binding = parseAncillaryBindings([
    {
      contractId: child.id,
      contentHash: child.contentHash,
      parent: selection.parent,
      parentRoleNodes: selection.parentRoleNodes,
      roleNodes,
    },
  ])[0]!;
  owner.data.operationAuthoring!.ancillaryBindings = [binding];
  const next: OperationGraph = {
    nodes: [...unpacked.graph.nodes, ...children.map(({ node }) => node)],
    edges: [
      ...unpacked.graph.edges,
      ...child.edges.map(([from, output, to, input], index) => ({
        id: `enhancement-${roleNodes[from]}-${index}`,
        source: roleNodes[from]!,
        sourceHandle: output,
        target: roleNodes[to]!,
        targetHandle: input,
      })),
    ],
  };
  const reference = child.bindings.owner.referenceSource;
  if (reference)
    next.edges.push({
      id: `enhancement-reference-${roleNodes[child.bindings.request.role]}`,
      source: selection.parentRoleNodes[reference.role]!,
      sourceHandle: reference.field,
      target: roleNodes[child.bindings.request.role]!,
      targetHandle: child.bindings.request.imagesField,
    });
  const { selectAncillaryExecutionScope, remapCurrentAncillaryParentDefinition } =
    await import('../workflow/ancillaryExecutionScope');
  const { expandFlowExecutionGraph } = await import('../stores/useFlowStore');
  const originalOwner = expandFlowExecutionGraph(graph.nodes, graph.edges).nodes.find((node) => node.id === ownerId);
  const original = promptEnhancementParentFromHint(originalOwner?.data.operationAuthoring);
  if (!original) invalidAncillary('the original native enhancement offer is unavailable.');
  const currentDefinition = remapCurrentAncillaryParentDefinition(definition, original, selection);
  selectAncillaryExecutionScope({
    ...next,
    parents: [{ recipe, selection: selection.parent, definition: currentDefinition }],
    registry,
    kind: 'workflow',
  });
  if (!containing) return groups.restoreVisualOperationGroups(next, unpacked);
  const siblings = { ...unpacked, roots: unpacked.roots.filter((root) => root.id !== containing.id) };
  const restored = groups.restoreVisualOperationGroups(next, siblings);
  return groups.groupVisualStages(
    restored,
    [...unpacked.members.get(containing.id)!, ...children.map(({ node }) => node.id)],
    'inputs',
    containing,
    { implicitScalarControlNodeIds: children.map(({ node }) => node.id) },
  );
}

function bindingFor(owner: OperationGraph['nodes'][number], child: AncillaryOperation): AncillaryInstanceBinding {
  const bindings = owner.data.operationAuthoring?.ancillaryBindings;
  if (
    !Array.isArray(bindings) ||
    bindings.length !== 1 ||
    bindings[0]?.contractId !== child.id ||
    bindings[0].contentHash !== child.contentHash
  )
    invalidAncillary('refresh the current enhancement binding.');
  return bindings[0];
}

function restoreEnhancementGroup(
  context: Awaited<ReturnType<typeof editableContext>>,
  next: OperationGraph,
  binding: AncillaryInstanceBinding,
) {
  const { containing, unpacked, groups } = context;
  if (!containing) return groups.restoreVisualOperationGroups(next, unpacked);
  const siblings = { ...unpacked, roots: unpacked.roots.filter((root) => root.id !== containing.id) };
  const restored = groups.restoreVisualOperationGroups(next, siblings);
  const ids = new Set(next.nodes.map((node) => node.id));
  return groups.groupVisualStages(
    restored,
    unpacked.members.get(containing.id)!.filter((id) => ids.has(id)),
    'inputs',
    containing,
    { implicitScalarControlNodeIds: Object.values(binding.roleNodes).filter((id) => ids.has(id)) },
  );
}

/** Data-only atomic graph plan. Verification and an explicit Apply gesture are separate. */
export async function planApplyPromptEnhancement(
  graph: OperationGraph,
  ownerId: string,
  recipe: OperationAuthoringRecipe,
  childId: string,
  pair: AuthoredEnhancementPair,
  expectedPairHash: string,
): Promise<OperationGraph> {
  const context = await editableContext(graph, ownerId);
  const { owner, selection, unpacked } = context;
  const child = selectedChild(selection, recipe, childId);
  const binding = bindingFor(owner, child);
  const original = authoredPair(unpacked.graph, owner.id, child);
  if ((await promptEnhancementPairHash(original)) !== expectedPairHash)
    invalidAncillary('the authored prompt or layout changed; request a fresh proposal.');
  if (typeof pair.prompt !== 'string' || !pair.prompt.trim()) invalidAncillary('the proposed caption is empty.');
  const { parseLayoutConditioning } = await import('./layoutConditioning');
  const { canonicalBlockStringifyV2 } = await import('./blockSchemaV2');
  const authoredLayout = parseLayoutConditioning(original.layout),
    proposedLayout = parseLayoutConditioning(pair.layout);
  const geometry = (layout: typeof authoredLayout) =>
    layout === null
      ? null
      : {
          ...layout,
          regions: layout.regions.map((region) => {
            const copy: Record<string, unknown> = { ...region };
            delete copy.description;
            return copy;
          }),
        };
  if (
    proposedLayout?.regions.some((region) => 'source' in region || ('action' in region && region.action !== 'place')) ||
    canonicalBlockStringifyV2(geometry(authoredLayout)) !== canonicalBlockStringifyV2(geometry(proposedLayout))
  )
    invalidAncillary('a prompt enhancement cannot change authored layout identities or geometry.');
  owner.data.params[child.bindings.owner.promptField]!.value = pair.prompt;
  owner.data.params[child.bindings.owner.layoutField]!.value = structuredClone(pair.layout);
  owner.data.operationAuthoring!.ancillaryParent = {
    ...selection,
    appliedPairSha256: await promptEnhancementPairHash(pair),
  };
  return restoreEnhancementGroup(context, unpacked.graph, binding);
}

/** Disable removes only the declared branch and preserves later user edits. */
export async function planDisablePromptEnhancement(
  graph: OperationGraph,
  ownerId: string,
  recipe: OperationAuthoringRecipe,
  childId: string,
): Promise<OperationGraph> {
  const { owner, selection, unpacked, groups } = await editableContext(graph, ownerId);
  const child = selectedChild(selection, recipe, childId);
  const binding = bindingFor(owner, child);
  const ids = new Set(Object.values(binding.roleNodes));
  const allowed = new Set(
    child.edges.map(([a, b, c, d]) => `${binding.roleNodes[a]}\0${b}\0${binding.roleNodes[c]}\0${d}`),
  );
  const reference = child.bindings.owner.referenceSource;
  if (reference)
    allowed.add(
      `${binding.parentRoleNodes[reference.role]}\0${reference.field}\0${binding.roleNodes[child.bindings.request.role]}\0${child.bindings.request.imagesField}`,
    );
  if (
    unpacked.graph.edges.some(
      (edge) =>
        (ids.has(edge.source) || ids.has(edge.target)) &&
        !allowed.has(`${edge.source}\0${edge.sourceHandle}\0${edge.target}\0${edge.targetHandle}`),
    )
  )
    invalidAncillary('the enhancement branch has additional connections; separate those explicitly before disabling.');
  if (
    selection.appliedPairSha256 &&
    (await promptEnhancementPairHash(authoredPair(unpacked.graph, owner.id, child))) === selection.appliedPairSha256
  ) {
    const request = unpacked.graph.nodes.find((node) => node.id === binding.roleNodes[child.bindings.request.role]);
    if (!request) invalidAncillary('the original enhancement request is unavailable.');
    const prompt = request.data.params[child.bindings.request.promptField];
    const layout = request.data.params[child.bindings.request.layoutField];
    owner.data.params[child.bindings.owner.promptField]!.value = structuredClone(prompt?.value ?? prompt?.default);
    owner.data.params[child.bindings.owner.layoutField]!.value = structuredClone(
      layout?.value ?? layout?.default ?? null,
    );
  }
  delete owner.data.operationAuthoring!.ancillaryBindings;
  delete selection.appliedPairSha256;
  owner.data.operationAuthoring!.ancillaryParent = selection;
  const next = {
    nodes: unpacked.graph.nodes.filter((node) => !ids.has(node.id)),
    edges: unpacked.graph.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
  };
  return groups.restoreVisualOperationGroups(next, unpacked);
}

/** An explicit new Preview reuses the original request after an untouched Apply,
 * or captures later user edits. It never recursively enhances its own output. */
export async function planRefreshPromptEnhancementRequest(
  graph: OperationGraph,
  ownerId: string,
  recipe: OperationAuthoringRecipe,
  childId: string,
): Promise<OperationGraph> {
  const context = await editableContext(graph, ownerId);
  const { owner, selection, unpacked } = context;
  const child = selectedChild(selection, recipe, childId);
  const binding = bindingFor(owner, child);
  const request = unpacked.graph.nodes.find((node) => node.id === binding.roleNodes[child.bindings.request.role]);
  if (!request) invalidAncillary('the original enhancement request is unavailable.');
  let pair = authoredPair(unpacked.graph, owner.id, child);
  if (selection.appliedPairSha256 && (await promptEnhancementPairHash(pair)) === selection.appliedPairSha256) {
    const prompt = request.data.params[child.bindings.request.promptField];
    const layout = request.data.params[child.bindings.request.layoutField];
    const value = prompt?.value ?? prompt?.default;
    if (typeof value !== 'string' || !layout) invalidAncillary('the original request is no longer available.');
    pair = { prompt: value, layout: structuredClone(layout.value ?? layout.default ?? null) };
    owner.data.params[child.bindings.owner.promptField]!.value = pair.prompt;
    owner.data.params[child.bindings.owner.layoutField]!.value = structuredClone(pair.layout);
  }
  const { parseLayoutConditioning } = await import('./layoutConditioning');
  const layout = parseLayoutConditioning(pair.layout);
  assertDeclaredLayout(child, pair.layout);
  if (layout?.regions.some((region) => 'source' in region || ('action' in region && region.action !== 'place')))
    invalidAncillary('source-region and removal enhancement are unsupported; keep the raw prompt path.');
  request.data.params[child.bindings.request.promptField]!.value = pair.prompt;
  request.data.params[child.bindings.request.layoutField]!.value = structuredClone(pair.layout);
  delete selection.appliedPairSha256;
  owner.data.operationAuthoring!.ancillaryParent = selection;
  return restoreEnhancementGroup(context, unpacked.graph, binding);
}
