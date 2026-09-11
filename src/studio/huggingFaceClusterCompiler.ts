import { huggingFaceClusterPlacementPath } from './huggingFaceClusterInstance';
import type {
  HuggingFaceNodeLibrary,
  HuggingFaceNodeLibraryBlockConfig,
  HuggingFaceNodeLibraryBlockDefinition,
  HuggingFaceNodeLibraryBlockField,
  HuggingFaceNodeLibraryBlockRoleAdapter,
  HuggingFaceNodeLibraryContainerStateAdapter,
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryGraphAdapterContract,
  HuggingFaceNodeLibraryVariadicInput,
} from './huggingFaceNodeLibrary';

export type HuggingFaceClusterCompilerDiagnostic = {
  code: 'missing_required_state' | 'missing_required_variadic_state' | 'unresolved_workflow_output';
  path: string | null;
  field: string;
  message: string;
};

export type HuggingFaceClusterCompilerNode = {
  id: string;
  path: string;
  pathSegments: string[];
  legacyPath: string;
  parentPath: string | null;
  order: number;
  blockDefinitionId: string;
  className: string;
  kind: HuggingFaceNodeLibraryBlockDefinition['kind'];
  role: 'leaf' | 'container' | 'loop_container';
  inputs: HuggingFaceNodeLibraryBlockField[];
  variadicInputs: HuggingFaceNodeLibraryVariadicInput[];
  requiredInputs: string[];
  outputs: HuggingFaceNodeLibraryBlockField[];
  components: HuggingFaceNodeLibraryBlockDefinition['components'];
  configs: HuggingFaceNodeLibraryBlockConfig[];
  adapter: HuggingFaceNodeLibraryBlockRoleAdapter | null;
  containerStateAdapter: HuggingFaceNodeLibraryContainerStateAdapter | null;
};

export type HuggingFaceClusterCompilerEdge = {
  id: string;
  kind: 'state_sequence' | 'container_enter' | 'container_exit' | 'loop_feedback';
  source: string;
  target: string;
  containerPath: string | null;
};

export type HuggingFaceClusterStructuralPlan = {
  schemaVersion: 1;
  definitionId: string;
  libraryRevision: string;
  definitionContentHash: string;
  blockContractHash: string;
  rootBlockDefinitionId: string;
  executionClaim: 'structural_plan_only';
  executable: false;
  structurallyClosed: boolean;
  fullyRoleAdapted: boolean;
  rootInputs: HuggingFaceNodeLibraryBlockField[];
  rootVariadicInputs: HuggingFaceNodeLibraryVariadicInput[];
  rootOutputs: HuggingFaceNodeLibraryBlockField[];
  nodes: HuggingFaceClusterCompilerNode[];
  edges: HuggingFaceClusterCompilerEdge[];
  diagnostics: HuggingFaceClusterCompilerDiagnostic[];
  reviewedGraphAdapterContracts: HuggingFaceNodeLibraryGraphAdapterContract[];
  reviewedContainerStateAdapters: HuggingFaceNodeLibraryContainerStateAdapter[];
  unresolvedAdapterBlockDefinitionIds: string[];
};

const WORKFLOW_INPUT = 'diffusers.cluster-state:workflow-input';
const WORKFLOW_OUTPUT = 'diffusers.cluster-state:workflow-output';

function invalid(message: string): never {
  throw new Error(`Cannot compile Diffusers Cluster Node: ${message}`);
}

function sameNames(left: readonly { name: string }[], right: readonly { name: string }[]) {
  const leftNames = new Set(left.map((field) => field.name));
  const rightNames = new Set(right.map((field) => field.name));
  return leftNames.size === rightNames.size && [...leftNames].every((name) => rightNames.has(name));
}

function compilerNodeId(definitionId: string, path: string) {
  return `diffusers.cluster-plan:${encodeURIComponent(definitionId)}:${encodeURIComponent(path)}`;
}

function compilerEdgeId(kind: HuggingFaceClusterCompilerEdge['kind'], source: string, target: string) {
  return `diffusers.cluster-plan-edge:${kind}:${encodeURIComponent(source)}:${encodeURIComponent(target)}`;
}

/**
 * Compiles the exact pinned workflow into an inspectable control/state plan.
 *
 * This deliberately does not emit executable MoDiff nodes. Modular blocks
 * exchange one mutable PipelineState, named fields may be written back, and
 * loop subclasses own custom iteration logic. An exact runtime adapter must be
 * admitted for every referenced block contract before a later promotion may
 * turn this plan into the executable graph.
 */
export function compileHuggingFaceClusterStructuralPlan(
  library: HuggingFaceNodeLibrary,
  requestedDefinition: HuggingFaceNodeLibraryDefinition,
): HuggingFaceClusterStructuralPlan {
  const definition = library.definitions.find((candidate) => candidate.id === requestedDefinition.id);
  if (
    !definition ||
    definition.libraryRevision !== requestedDefinition.libraryRevision ||
    definition.contentHash !== requestedDefinition.contentHash ||
    definition.blockContractHash !== requestedDefinition.blockContractHash
  )
    invalid('definition revision or content hashes do not match the loaded library.');

  const blocks = new Map(library.blockDefinitions.map((block) => [block.id, block]));
  const roleAdapters = new Map(library.blockRoleAdapters.map((adapter) => [adapter.blockDefinitionId, adapter]));
  const containerStateAdapters = new Map(
    library.containerStateAdapters.map((adapter) => [adapter.blockDefinitionId, adapter]),
  );
  const root = blocks.get(definition.rootBlockDefinitionId);
  if (!root || root.kind !== definition.workflowKind) invalid('root workflow block is missing or incompatible.');
  if (
    !sameNames(root.inputs, definition.inputs) ||
    !definition.outputs.every((field) => root.outputs.some((item) => item.name === field.name))
  )
    invalid('root workflow fields disagree with the reviewed Cluster definition.');

  const childrenByParent = new Map<string, HuggingFaceClusterCompilerNode[]>();
  const nodes = definition.blockPlacements.map((placement) => {
    const path = huggingFaceClusterPlacementPath(placement.path);
    const block = blocks.get(placement.blockDefinitionId);
    if (!block) invalid(`block contract ${placement.blockDefinitionId} is missing.`);
    const hasChildren = definition.blockPlacements.some(
      (candidate) =>
        candidate.path.length === placement.path.length + 1 &&
        placement.path.every((segment, index) => candidate.path[index] === segment),
    );
    const parentPath = placement.path.length > 1 ? huggingFaceClusterPlacementPath(placement.path.slice(0, -1)) : null;
    const node: HuggingFaceClusterCompilerNode = {
      id: compilerNodeId(definition.id, path),
      path,
      pathSegments: placement.path,
      legacyPath: placement.legacyPath,
      parentPath,
      order: placement.order,
      blockDefinitionId: block.id,
      className: block.className,
      kind: block.kind,
      role: hasChildren ? (block.kind === 'loop' ? 'loop_container' : 'container') : 'leaf',
      inputs: block.inputs,
      variadicInputs: block.variadicInputs,
      requiredInputs: block.requiredInputs,
      outputs: block.outputs,
      components: block.components,
      configs: block.configs,
      adapter: roleAdapters.get(block.id) ?? null,
      containerStateAdapter: containerStateAdapters.get(block.id) ?? null,
    };
    const parentKey = parentPath ?? '';
    childrenByParent.set(parentKey, [...(childrenByParent.get(parentKey) ?? []), node]);
    return node;
  });
  childrenByParent.forEach((children) => children.sort((left, right) => left.order - right.order));

  const edges: HuggingFaceClusterCompilerEdge[] = [];
  const addEdge = (
    kind: HuggingFaceClusterCompilerEdge['kind'],
    source: string,
    target: string,
    containerPath: string | null,
  ) =>
    edges.push({
      id: compilerEdgeId(kind, source, target),
      kind,
      source,
      target,
      containerPath,
    });
  const connectSequence = (
    children: HuggingFaceClusterCompilerNode[],
    container: HuggingFaceClusterCompilerNode | null,
  ) => {
    if (!children.length) return;
    const first = children[0]!;
    const last = children[children.length - 1]!;
    if (container) addEdge('container_enter', container.id, first.id, container.path);
    else addEdge('state_sequence', WORKFLOW_INPUT, first.id, null);
    children
      .slice(1)
      .forEach((child, index) => addEdge('state_sequence', children[index]!.id, child.id, container?.path ?? null));
    if (container) {
      addEdge('container_exit', last.id, container.id, container.path);
      if (container.kind === 'loop') addEdge('loop_feedback', last.id, first.id, container.path);
    } else addEdge('state_sequence', last.id, WORKFLOW_OUTPUT, null);
    children.forEach((child) => connectSequence(childrenByParent.get(child.path) ?? [], child));
  };
  connectSequence(childrenByParent.get('') ?? [], null);

  const availableState = new Set(root.inputs.map((field) => field.name));
  const availableKwargs = new Map<string, Set<string>>();
  root.inputs.forEach((field) => {
    if (field.kwargsType)
      availableKwargs.set(field.kwargsType, new Set([...(availableKwargs.get(field.kwargsType) ?? []), field.name]));
  });
  const diagnostics: HuggingFaceClusterCompilerDiagnostic[] = [];
  const inspectState = (node: HuggingFaceClusterCompilerNode) => {
    // Compound blocks may declare loop-local or wrapper-local values that are
    // initialized inside their custom __call__. Only leaf reads are statically
    // closed here; adapters must validate the container-local writes.
    node.containerStateAdapter?.stateInitializers.forEach(({ name }) => availableState.add(name));
    if (node.role === 'leaf') {
      node.requiredInputs.forEach((name) => {
        if (!availableState.has(name))
          diagnostics.push({
            code: 'missing_required_state',
            path: node.path,
            field: name,
            message: `${node.className} requires state field ${name}, but no reviewed upstream field produces it before this block.`,
          });
      });
      node.variadicInputs.forEach((input) => {
        if (input.required && !(availableKwargs.get(input.kwargsType)?.size ?? 0))
          diagnostics.push({
            code: 'missing_required_variadic_state',
            path: node.path,
            field: input.kwargsType,
            message: `${node.className} requires the ${input.kwargsType} PipelineState bundle before this block.`,
          });
      });
    }
    (childrenByParent.get(node.path) ?? []).forEach(inspectState);
    node.outputs.forEach((field) => {
      availableState.add(field.name);
      if (field.kwargsType)
        availableKwargs.set(field.kwargsType, new Set([...(availableKwargs.get(field.kwargsType) ?? []), field.name]));
    });
    node.containerStateAdapter?.publishedState.forEach((name) => availableState.add(name));
  };
  (childrenByParent.get('') ?? []).forEach(inspectState);
  definition.outputs.forEach((field) => {
    if (!availableState.has(field.name))
      diagnostics.push({
        code: 'unresolved_workflow_output',
        path: null,
        field: field.name,
        message: `Workflow output ${field.name} is declared by the aggregate upstream block but is not exposed by its child contracts.`,
      });
  });

  const unresolvedAdapterBlockDefinitionIds = [
    root.id,
    ...nodes.filter((node) => !node.adapter).map((node) => node.blockDefinitionId),
  ]
    .filter((blockDefinitionId) => !roleAdapters.has(blockDefinitionId))
    .filter((blockDefinitionId, index, values) => values.indexOf(blockDefinitionId) === index)
    .sort();

  return {
    schemaVersion: 1,
    definitionId: definition.id,
    libraryRevision: definition.libraryRevision,
    definitionContentHash: definition.contentHash,
    blockContractHash: definition.blockContractHash,
    rootBlockDefinitionId: definition.rootBlockDefinitionId,
    executionClaim: 'structural_plan_only',
    executable: false,
    structurallyClosed: diagnostics.length === 0,
    fullyRoleAdapted: unresolvedAdapterBlockDefinitionIds.length === 0,
    rootInputs: root.inputs,
    rootVariadicInputs: root.variadicInputs,
    rootOutputs: root.outputs,
    nodes,
    edges,
    diagnostics,
    reviewedGraphAdapterContracts: definition.graphAdapterContracts,
    reviewedContainerStateAdapters: nodes
      .map((node) => node.containerStateAdapter)
      .filter((adapter): adapter is HuggingFaceNodeLibraryContainerStateAdapter => adapter !== null),
    unresolvedAdapterBlockDefinitionIds,
  };
}
