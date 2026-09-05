import { nanoid } from 'nanoid';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import type { HuggingFaceCatalogEntry } from './huggingFaceNodeCatalog';
import type { HuggingFaceNodeLibrary } from './huggingFaceNodeLibrary';
import type { HuggingFaceModularConditionalSnapshot } from './huggingFaceModularConditionals';
import {
  blockDefinitionContentHashV2,
  blockGraphHashV2,
  createBlockInstanceV2,
  normalizeBlockDefinitionV2,
  type BlockDefinitionV2,
  type BlockGraphNodeV2,
} from './blockSchemaV2';
import { createBlockRootNodeV2, setBlockPresentationV2 } from './blockRuntimeV2';
import { compactReviewedModularInternalLayoutV2 } from './reviewedModularGraphV2';

const STEP_KEY = 'modules.ModularDiffusers.ReviewedModularWorkflowStep';
export const HUGGING_FACE_MODULAR_BLOCK_DRAG_PREFIX = 'modiff:hugging-face-modular-block:';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function identity(base: NodeParams | undefined, value: unknown): NodeParams {
  if (!base) throw new Error('The backend Modular Diffusers step contract is incomplete.');
  return { ...clone(base), value, hidden: true };
}

function manifestInput(
  base: NodeParams | undefined,
  field: {
    name: string;
    type: string;
    required: boolean;
    default: unknown;
    description: string;
  },
): NodeParams {
  return {
    ...(base ? clone(base) : { type: field.type }),
    type: base?.type ?? field.type,
    label: base?.label ?? field.name.replace(/[_-]/gu, ' '),
    required: field.required,
    default: clone(field.default),
    value: clone(field.default),
    ...(field.description ? { description: field.description } : {}),
    hidden: false,
  };
}

/** Create one ordinary, draggable node for an exact pinned upstream placement. */
export function createModularDiffusersCatalogNode(
  entry: HuggingFaceCatalogEntry,
  library: HuggingFaceNodeLibrary,
  registry: Readonly<Record<string, NodeData>>,
  position: { x: number; y: number },
  modularSnapshot?: HuggingFaceModularConditionalSnapshot | null,
): CustomNodeType {
  const context = entry.modularBlockPlacement;
  if (entry.kind !== 'block' || !context) throw new Error('This catalog row is not a Modular Diffusers block.');
  const definition = library.definitions.find(({ id }) => id === context.definitionId);
  const block = [...library.blockDefinitions, ...(modularSnapshot?.blockDefinitions ?? [])].find(
    ({ id }) => id === context.placement.blockDefinitionId,
  );
  const base = registry[STEP_KEY];
  if (!definition || !block || !base) {
    throw new Error('The pinned pipeline, block, or backend step contract is unavailable.');
  }
  const parentPath = context.placement.path.slice(0, -1);
  const unprunedPipeline = modularSnapshot?.pipelines.find(
    ({ pipelineClass }) => pipelineClass === context.pipelineClass,
  );
  const contextualPlacements =
    context.executionScope === 'unpruned_pipeline' ? (unprunedPipeline?.placements ?? []) : definition.blockPlacements;
  const parentPlacement = parentPath.length
    ? contextualPlacements.find(
        ({ path }) =>
          path.length === parentPath.length && path.every((segment, index) => segment === parentPath[index]),
      )
    : undefined;
  const parentBlock = parentPlacement
    ? [...library.blockDefinitions, ...(modularSnapshot?.blockDefinitions ?? [])].find(
        ({ id }) => id === parentPlacement.blockDefinitionId,
      )
    : undefined;
  const executionKind = parentBlock?.kind === 'loop' ? 'loop_member' : block.kind === 'loop' ? 'loop_owner' : 'step';
  const sockets =
    executionKind === 'loop_member'
      ? ['loop_members_in', 'loop_members']
      : [
          'pipeline_components',
          'state_in',
          'state_out',
          ...(executionKind === 'loop_owner' ? ['loop_members_in'] : []),
        ];
  const params: Record<string, NodeParams> = Object.fromEntries(
    sockets.flatMap((name) => (base.params[name] ? [[name, clone(base.params[name])]] : [])),
  );
  Object.assign(params, {
    pipeline_class: identity(base.params.pipeline_class, context.pipelineClass),
    workflow_id: identity(base.params.workflow_id, context.workflowId),
    execution_scope: identity(base.params.execution_scope, context.executionScope ?? 'selected_workflow'),
    placement_path: identity(base.params.placement_path, context.placement.path),
    block_definition_id: identity(base.params.block_definition_id, block.id),
    block_class: identity(base.params.block_class, block.className),
    block_contract_hash: identity(base.params.block_contract_hash, block.contentHash),
    execution_kind: identity(base.params.execution_kind, executionKind),
  });
  block.inputs.forEach((field) => {
    if (field.name === 'generator') {
      if (base.params.seed) params.seed = clone(base.params.seed);
      return;
    }
    params[field.name] = manifestInput(base.params[field.name], field);
  });
  for (const output of block.outputs) {
    const outputParam = base.params[output.name];
    if (outputParam?.display === 'output') params[output.name] = clone(outputParam);
  }
  const metadata = {
    kind: 'upstream_block' as const,
    pipelineClass: context.pipelineClass,
    blocksClass: context.blocksClass,
    workflowId: context.workflowId,
    libraryRevision: definition.libraryRevision,
    runtimeRole: `catalog:${context.placement.path.join('/')}`,
    blockDefinitionId: block.id,
    blockClass: block.className,
    blockKind: block.kind,
    blockContractHash: block.contentHash,
    placementPath: [...context.placement.path],
    ...(parentPath.length ? { parentPlacementPath: parentPath } : {}),
    sourceDefinitionId: context.definitionId,
    sourcePlacementPath: [...context.placement.path],
    sourceExecutionScope: context.executionScope ?? 'selected_workflow',
    componentNames: block.components.map(({ name }) => name).sort(),
  };
  return {
    id: `modular-block-${nanoid(16)}`,
    type: 'custom',
    position,
    width: 340,
    height: Object.values(params).some(({ display }) => String(display).startsWith('text')) ? 400 : 240,
    selected: true,
    data: {
      ...clone(base),
      type: 'custom',
      label: entry.label,
      category: 'Modular Diffusers Blocks',
      description:
        `${entry.description} Exact placement ${context.pipelineClass}.${context.workflowId}.` +
        ' Connect Pipeline Components/Pipeline State, or drop it into an expanded Block and reconnect it.',
      params,
      resizable: true,
      skipParamsCheck: true,
      modularDiffusersCatalogNode: metadata,
    },
  };
}

function pathStartsWith(path: readonly string[], prefix: readonly string[]) {
  return path.length >= prefix.length && prefix.every((segment, index) => path[index] === segment);
}

function contextualPlacements(
  entry: HuggingFaceCatalogEntry,
  library: HuggingFaceNodeLibrary,
  modularSnapshot?: HuggingFaceModularConditionalSnapshot | null,
) {
  const context = entry.modularBlockPlacement;
  if (!context) return [];
  if (context.executionScope === 'unpruned_pipeline') {
    return (
      modularSnapshot?.pipelines.find(({ pipelineClass }) => pipelineClass === context.pipelineClass)?.placements ?? []
    );
  }
  return library.definitions.find(({ id }) => id === context.definitionId)?.blockPlacements ?? [];
}

export function modularDiffusersCatalogEntryHasDescendants(
  entry: HuggingFaceCatalogEntry,
  library: HuggingFaceNodeLibrary,
  modularSnapshot?: HuggingFaceModularConditionalSnapshot | null,
) {
  const root = entry.modularBlockPlacement?.placement.path;
  return Boolean(
    root &&
    contextualPlacements(entry, library, modularSnapshot).some(
      ({ path }) => path.length > root.length && pathStartsWith(path, root),
    ),
  );
}

/**
 * Materialize a reviewed upstream container as one source-neutral V2 fragment.
 * Its expanded children are ordinary group/step nodes; inserting the fragment
 * into another V2 Block flattens those nodes rather than persisting a nested
 * User Node or Cluster Node.
 */
export function createModularDiffusersCatalogFragmentV2(
  entry: HuggingFaceCatalogEntry,
  library: HuggingFaceNodeLibrary,
  registry: Readonly<Record<string, NodeData>>,
  position: { x: number; y: number },
  modularSnapshot?: HuggingFaceModularConditionalSnapshot | null,
): CustomNodeType {
  const context = entry.modularBlockPlacement;
  if (!context) throw new Error('This catalog row is not a Modular Diffusers block.');
  const definition = library.definitions.find(({ id }) => id === context.definitionId);
  if (!definition) throw new Error('The pinned parent workflow definition is unavailable.');
  const rootPath = context.placement.path;
  const placements = contextualPlacements(entry, library, modularSnapshot)
    .filter(({ path }) => pathStartsWith(path, rootPath))
    .sort((left, right) => left.path.length - right.path.length || left.order - right.order);
  if (placements.length < 2) {
    return createModularDiffusersCatalogNode(entry, library, registry, position, modularSnapshot);
  }
  const blocks = new Map(
    [...library.blockDefinitions, ...(modularSnapshot?.blockDefinitions ?? [])].map((block) => [block.id, block]),
  );
  const nodes = placements.map((placement, index): BlockGraphNodeV2 => {
    const block = blocks.get(placement.blockDefinitionId);
    if (!block) throw new Error(`Pinned Modular block ${placement.blockDefinitionId} is unavailable.`);
    const childEntry: HuggingFaceCatalogEntry = {
      ...entry,
      id: `${entry.id}:${pathKey(placement.path)}`,
      label: block.className.replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' '),
      modularBlockPlacement: { ...context, placement },
    };
    const ordinary = createModularDiffusersCatalogNode(childEntry, library, registry, { x: 0, y: 0 }, modularSnapshot);
    const metadata = ordinary.data.modularDiffusersCatalogNode!;
    const structural = block.kind === 'auto' || block.kind === 'conditional' || block.kind === 'sequential';
    const nodeId = `fragment:${index}:${placement.path[placement.path.length - 1]}`;
    return {
      nodeId,
      nodeType: structural ? 'group' : 'custom',
      data: structuredClone(
        structural
          ? {
              type: 'group',
              module: '',
              action: '',
              label: ordinary.data.label,
              category: 'Modular Diffusers Blocks',
              description: ordinary.data.description,
              params: {},
              resizable: true,
            }
          : {
              type: 'custom',
              module: ordinary.data.module,
              action: ordinary.data.action,
              label: ordinary.data.label,
              category: ordinary.data.category,
              description: ordinary.data.description,
              params: ordinary.data.params,
              resizable: true,
              skipParamsCheck: true,
            },
      ) as BlockGraphNodeV2['data'],
      semanticRole: structural ? 'container' : 'upstream_block',
      upstreamBlockPath: placement.path.join('/'),
      modularDiffusers: metadata,
    };
  });
  const graphSemantic = { nodes, edges: [], executionOrder: nodes.map(({ nodeId }) => nodeId) };
  const graph = { ...graphSemantic, graphHash: blockGraphHashV2(graphSemantic) };
  const sourceArtifact = definition.executionAdmissions.flatMap(({ artifact }) => (artifact ? [artifact] : []))[0];
  const draft = {
    schemaVersion: 2 as const,
    definitionId: `diffusers.modular-fragment:${definition.pipelineClass}:${context.placement.blockDefinitionId}`,
    displayName: entry.label,
    description:
      `${entry.description} Exact pinned Modular Diffusers subtree. ` +
      'Expand to edit its ordinary nodes, or drop it into an expanded compatible Block to flatten it.',
    source: {
      kind: 'diffusers_catalog' as const,
      catalogCategory: 'diffusers' as const,
      provider: 'huggingface',
      library: 'diffusers' as const,
      libraryRevision: definition.libraryRevision,
      pipelineClass: definition.pipelineClass,
      blocksClass: definition.blocksClass,
      workflow: context.workflowId,
      manifestDefinitionId: definition.id,
      manifestContentHash: definition.contentHash,
      ...(sourceArtifact ? { repository: sourceArtifact.repo, repositoryRevision: sourceArtifact.revision } : {}),
    },
    graph,
    boundary: { mode: 'explicit' as const, inputs: [], outputs: [] },
    controls: [],
    previews: [],
    ownership: { kind: 'registered' as const, definitionMutable: false },
  };
  const blockDefinition = normalizeBlockDefinitionV2({
    ...draft,
    contentHash: blockDefinitionContentHashV2(draft),
  } satisfies BlockDefinitionV2);
  let instance = createBlockInstanceV2(blockDefinition, {
    instanceId: `block-v2-${globalThis.crypto.randomUUID()}`,
    position,
    size: { width: 460, height: 520 },
    internalLayoutMode: 'hierarchical',
  });
  const layout = compactReviewedModularInternalLayoutV2(instance);
  if (layout) instance = setBlockPresentationV2(instance, { internalLayout: layout });
  return createBlockRootNodeV2(instance);
}

function pathKey(path: readonly string[]) {
  return path.join('/');
}
