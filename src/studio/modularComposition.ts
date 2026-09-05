import config from '../../app.config';
import { requestJson } from '../utils/requestJson';
import type { HuggingFaceNodeLibrary, HuggingFaceNodeLibraryDefinition } from './huggingFaceNodeLibrary';
import type { HuggingFaceModularConditionalSnapshot } from './huggingFaceModularConditionals';
import type { BlockGraphNodeModularDiffusersV2, BlockGraphNodeV2, BlockInstanceV2 } from './blockSchemaV2';
import type { UserBlockDefinition } from './types';

export type ModularCompositionOperation =
  | { kind: 'remove'; path: string[] }
  | { kind: 'duplicate' | 'move'; path: string[]; parentPath: string[]; name: string; index: number }
  | {
      kind: 'insert';
      sourceDefinitionId: string;
      sourceBlockDefinitionId: string;
      sourcePath: string[];
      sourceExecutionScope: 'selected_workflow' | 'unpruned_pipeline';
      parentPath: string[];
      name: string;
      index: number;
    }
  | {
      kind: 'replace';
      path: string[];
      sourceDefinitionId: string;
      sourceBlockDefinitionId: string;
      sourcePath: string[];
      sourceExecutionScope: 'selected_workflow' | 'unpruned_pipeline';
    };

export type ModularCompositionRecipe = {
  schemaVersion: 1;
  diffusersRevision: string;
  pipelineClass: string;
  workflowId: string;
  definitionId: string;
  blockContractHash: string;
  operations: ModularCompositionOperation[];
};

export type ModularCompositionReceipt = {
  schemaVersion: 1;
  claim: 'reviewed_modular_composition_rebuilt';
  executable: false;
  recipeHash: string;
  receiptHash: string;
  diffusersRevision: string;
  pipelineClass: string;
  workflowId: string;
  definitionId: string;
  blockContractHash: string;
  inputs: string[];
  outputs: string[];
  components: string[];
  configs: string[];
  composedPaths: string[][];
};

export type ReviewedModularCompositionSource = {
  definition: HuggingFaceNodeLibraryDefinition;
  recipe: Omit<ModularCompositionRecipe, 'operations'>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseReceipt(value: unknown): ModularCompositionReceipt {
  const envelope = record(value);
  if (envelope?.error === true) {
    throw new Error(
      typeof envelope.message === 'string' ? envelope.message : 'The Modular composition rebuild failed.',
    );
  }
  const root = record(envelope?.receipt ?? value);
  if (
    root?.schemaVersion !== 1 ||
    root.claim !== 'reviewed_modular_composition_rebuilt' ||
    root.executable !== false ||
    typeof root.recipeHash !== 'string' ||
    typeof root.receiptHash !== 'string' ||
    typeof root.diffusersRevision !== 'string' ||
    typeof root.pipelineClass !== 'string' ||
    typeof root.workflowId !== 'string' ||
    typeof root.definitionId !== 'string' ||
    typeof root.blockContractHash !== 'string' ||
    !stringArray(root.inputs) ||
    !stringArray(root.outputs) ||
    !stringArray(root.components) ||
    !stringArray(root.configs) ||
    !Array.isArray(root.composedPaths) ||
    !root.composedPaths.every(stringArray)
  ) {
    throw new Error('The backend returned an invalid Modular composition receipt.');
  }
  return root as ModularCompositionReceipt;
}

export function reviewedModularCompositionSource(
  block: UserBlockDefinition | undefined,
  library: HuggingFaceNodeLibrary | null,
): ReviewedModularCompositionSource | null {
  const origin = block?.origin;
  if (
    !origin ||
    origin.kind !== 'hugging_face_cluster_fork' ||
    origin.provider !== 'diffusers' ||
    !origin.definitionId ||
    !origin.pipelineClass ||
    !origin.workflowId ||
    !origin.blockContractHash ||
    !library ||
    library.diffusersRevision !== origin.libraryRevision
  ) {
    return null;
  }
  const definition = library.definitions.find(
    (candidate) =>
      candidate.id === origin.definitionId &&
      candidate.pipelineClass === origin.pipelineClass &&
      candidate.workflowId === origin.workflowId &&
      candidate.blockContractHash === origin.blockContractHash,
  );
  if (!definition) return null;
  return {
    definition,
    recipe: {
      schemaVersion: 1,
      diffusersRevision: library.diffusersRevision,
      pipelineClass: definition.pipelineClass,
      workflowId: definition.workflowId,
      definitionId: definition.id,
      blockContractHash: definition.blockContractHash,
    },
  };
}

/** Resolve a registered/user-owned V2 instance back to its exact reviewed Modular workflow. */
export function reviewedModularCompositionSourceV2(
  instance: BlockInstanceV2 | undefined,
  library: HuggingFaceNodeLibrary | null,
): ReviewedModularCompositionSource | null {
  const source = instance?.definitionSnapshot.source;
  if (
    !instance ||
    !source ||
    source.library !== 'diffusers' ||
    !source.manifestDefinitionId ||
    !source.pipelineClass ||
    !source.workflow ||
    !source.libraryRevision ||
    !library ||
    library.diffusersRevision !== source.libraryRevision
  )
    return null;
  const definition = library.definitions.find(
    (candidate) =>
      candidate.id === source.manifestDefinitionId &&
      candidate.provider === 'diffusers' &&
      candidate.pipelineClass === source.pipelineClass &&
      candidate.workflowId === source.workflow &&
      candidate.libraryRevision === source.libraryRevision,
  );
  if (!definition) return null;
  return {
    definition,
    recipe: {
      schemaVersion: 1,
      diffusersRevision: library.diffusersRevision,
      pipelineClass: definition.pipelineClass,
      workflowId: definition.workflowId,
      definitionId: definition.id,
      blockContractHash: definition.blockContractHash,
    },
  };
}

function upstreamMetadata(node: BlockGraphNodeV2): BlockGraphNodeModularDiffusersV2 | null {
  return node.modularDiffusers?.kind === 'upstream_block' ? node.modularDiffusers : null;
}

function pathKey(path: readonly string[]) {
  return path.join('\0');
}

function samePath(left: readonly string[], right: readonly string[]) {
  return pathKey(left) === pathKey(right);
}

function topmostMissingPaths(paths: readonly string[][]) {
  return paths.filter(
    (path) =>
      !paths.some(
        (candidate) => candidate.length < path.length && samePath(path.slice(0, candidate.length), candidate),
      ),
  );
}

function sourceOperationFields(metadata: BlockGraphNodeModularDiffusersV2): {
  sourceDefinitionId: string;
  sourceBlockDefinitionId: string;
  sourcePath: string[];
  sourceExecutionScope: 'selected_workflow' | 'unpruned_pipeline';
} {
  if (
    !metadata.sourceDefinitionId ||
    !metadata.sourcePlacementPath?.length ||
    !metadata.sourceExecutionScope ||
    !metadata.blockDefinitionId
  )
    throw new Error(
      `The inserted Modular block ${metadata.blockClass ?? metadata.runtimeRole} has no complete pinned catalog provenance. Remove it and add it again from Modular Diffusers Blocks.`,
    );
  return {
    sourceDefinitionId: metadata.sourceDefinitionId,
    sourceBlockDefinitionId: metadata.blockDefinitionId,
    sourcePath: [...metadata.sourcePlacementPath],
    sourceExecutionScope: metadata.sourceExecutionScope,
  };
}

/**
 * Translate the effective V2 hierarchy into the smallest exact upstream tree
 * recipe. Parameter-only edits deliberately produce no operations: their
 * values remain ordinary workflow-instance state and never rebuild siblings.
 */
export function reviewedModularCompositionRecipeForInstanceV2(
  instance: BlockInstanceV2,
  library: HuggingFaceNodeLibrary | null,
  conditionalSnapshot?: HuggingFaceModularConditionalSnapshot | null,
): ModularCompositionRecipe | null {
  const source = reviewedModularCompositionSourceV2(instance, library);
  if (!source) return null;
  const baselineNodeIds = new Set(instance.definitionSnapshot.graph.nodes.map(({ nodeId }) => nodeId));
  const nonUpstreamAdditions = instance.effectiveGraph.nodes.filter(
    (node) => !baselineNodeIds.has(node.nodeId) && upstreamMetadata(node) === null,
  );
  if (nonUpstreamAdditions.length)
    throw new Error(
      `This workflow contains ${nonUpstreamAdditions.length} ordinary Studio node${nonUpstreamAdditions.length === 1 ? '' : 's'} that cannot be represented as upstream ModularPipelineBlocks. It remains a valid workflow-local graph customization, but it cannot receive an upstream init_pipeline() composition receipt.`,
    );
  const baseline = instance.definitionSnapshot.graph.nodes.filter((node) => upstreamMetadata(node));
  const effective = instance.effectiveGraph.nodes.filter((node) => upstreamMetadata(node));
  const baselineById = new Map(baseline.map((node) => [node.nodeId, node]));
  const effectiveById = new Map(effective.map((node) => [node.nodeId, node]));
  const baselineByPath = new Map(baseline.map((node) => [pathKey(upstreamMetadata(node)!.placementPath ?? []), node]));
  const effectiveByPath = new Map(
    effective.map((node) => [pathKey(upstreamMetadata(node)!.placementPath ?? []), node]),
  );
  if (baselineByPath.has('') || effectiveByPath.has(''))
    throw new Error('A Modular Diffusers graph contains an upstream node without an exact placement path.');

  const replacements: ModularCompositionOperation[] = [];
  const replacedEffectiveIds = new Set<string>();
  const missingPaths: string[][] = [];
  baseline.forEach((baselineNode) => {
    if (effectiveById.has(baselineNode.nodeId)) return;
    const targetPath = upstreamMetadata(baselineNode)!.placementPath!;
    const candidate = effectiveByPath.get(pathKey(targetPath));
    const candidateMetadata = candidate ? upstreamMetadata(candidate) : null;
    if (candidate && candidateMetadata?.sourceDefinitionId) {
      replacements.push({ kind: 'replace', path: [...targetPath], ...sourceOperationFields(candidateMetadata) });
      replacedEffectiveIds.add(candidate.nodeId);
    } else {
      missingPaths.push([...targetPath]);
    }
  });

  const removals: ModularCompositionOperation[] = topmostMissingPaths(missingPaths)
    .sort((left, right) => right.length - left.length || pathKey(left).localeCompare(pathKey(right)))
    .map((path) => ({ kind: 'remove', path }));
  const moves: ModularCompositionOperation[] = [];
  effective.forEach((effectiveNode) => {
    const baselineNode = baselineById.get(effectiveNode.nodeId);
    if (!baselineNode) return;
    const before = upstreamMetadata(baselineNode)!.placementPath!;
    const after = upstreamMetadata(effectiveNode)!.placementPath!;
    if (samePath(before, after)) return;
    const siblings = effective.filter((candidate) =>
      samePath(upstreamMetadata(candidate)!.placementPath!.slice(0, -1), after.slice(0, -1)),
    );
    moves.push({
      kind: 'move',
      path: [...before],
      parentPath: after.slice(0, -1),
      name: after[after.length - 1]!,
      index: Math.max(
        0,
        siblings.findIndex(({ nodeId }) => nodeId === effectiveNode.nodeId),
      ),
    });
  });
  const insertedNodes = effective
    .filter((node) => !baselineById.has(node.nodeId) && !replacedEffectiveIds.has(node.nodeId))
    .sort(
      (left, right) => upstreamMetadata(left)!.placementPath!.length - upstreamMetadata(right)!.placementPath!.length,
    );
  const handledInsertions = new Set<string>();
  const insertions: ModularCompositionOperation[] = [];
  insertedNodes.forEach((effectiveNode) => {
    if (handledInsertions.has(effectiveNode.nodeId)) return;
    const metadata = upstreamMetadata(effectiveNode)!;
    if (!metadata.sourceDefinitionId) return;
    const path = metadata.placementPath!;
    const sourceDefinition = library?.definitions.find(
      ({ id, provider, pipelineClass }) =>
        id === metadata.sourceDefinitionId && provider === 'diffusers' && pipelineClass === metadata.pipelineClass,
    );
    const sourcePlacements =
      metadata.sourceExecutionScope === 'selected_workflow'
        ? sourceDefinition?.blockPlacements
        : conditionalSnapshot?.diffusersRevision === metadata.libraryRevision
          ? conditionalSnapshot.pipelines.find(({ pipelineClass }) => pipelineClass === metadata.pipelineClass)
              ?.placements
          : undefined;
    if (!sourceDefinition || !sourcePlacements)
      throw new Error(
        `The inserted Modular subtree ${metadata.blockClass ?? metadata.runtimeRole} cannot be checked against its pinned source hierarchy. Reload the Modular Diffusers catalog and try again.`,
      );
    const sourcePath = metadata.sourcePlacementPath!;
    const sourceSubtree = sourcePlacements.filter(
      (placement) =>
        placement.path.length >= sourcePath.length && samePath(placement.path.slice(0, sourcePath.length), sourcePath),
    );
    if (!sourceSubtree.length)
      throw new Error(
        `The inserted Modular subtree ${metadata.blockClass ?? metadata.runtimeRole} has no pinned source.`,
      );
    const destinationRoot = metadata.placementPath!;
    for (const placement of sourceSubtree) {
      const destinationPath = [...destinationRoot, ...placement.path.slice(sourcePath.length)];
      const candidate = insertedNodes.find((node) => {
        const candidateMetadata = upstreamMetadata(node)!;
        return (
          candidateMetadata.sourceDefinitionId === metadata.sourceDefinitionId &&
          candidateMetadata.sourceExecutionScope === metadata.sourceExecutionScope &&
          samePath(candidateMetadata.sourcePlacementPath ?? [], placement.path) &&
          samePath(candidateMetadata.placementPath ?? [], destinationPath)
        );
      });
      if (!candidate || upstreamMetadata(candidate)!.blockDefinitionId !== placement.blockDefinitionId)
        throw new Error(
          `The inserted Modular container ${metadata.blockClass ?? metadata.runtimeRole} is missing its exact descendant ${placement.path.join('.')}. Add the complete subtree again or use Fix to remove the incomplete insertion.`,
        );
      handledInsertions.add(candidate.nodeId);
    }
    const siblings = effective.filter((candidate) =>
      samePath(upstreamMetadata(candidate)!.placementPath!.slice(0, -1), path.slice(0, -1)),
    );
    insertions.push({
      kind: 'insert',
      ...sourceOperationFields(metadata),
      parentPath: path.slice(0, -1),
      name: path[path.length - 1]!,
      index: Math.max(
        0,
        siblings.findIndex(({ nodeId }) => nodeId === effectiveNode.nodeId),
      ),
    });
  });
  return { ...source.recipe, operations: [...replacements, ...moves, ...removals, ...insertions] };
}

export function duplicateReviewedModularBlockRecipe(
  source: NonNullable<ReturnType<typeof reviewedModularCompositionSource>>,
  path: string[],
): ModularCompositionRecipe {
  const placement = source.definition.blockPlacements.find(
    (candidate) => candidate.path.join('\0') === path.join('\0'),
  );
  if (!placement) throw new Error('The selected reviewed Modular block path is unavailable.');
  const parentPath = path.slice(0, -1);
  const siblingCount = source.definition.blockPlacements.filter(
    (candidate) =>
      candidate.path.length === path.length && candidate.path.slice(0, -1).join('\0') === parentPath.join('\0'),
  ).length;
  const baseName = path[path.length - 1] || 'block';
  return {
    ...source.recipe,
    operations: [
      {
        kind: 'duplicate',
        path,
        parentPath,
        name: `${baseName}_copy`,
        index: siblingCount,
      },
    ],
  };
}

export function rebuildReviewedModularComposition(recipe: ModularCompositionRecipe, signal?: AbortSignal) {
  return requestJson(`${config.serverAddress}/huggingface/modular-composition/rebuild`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recipe),
    signal,
    timeoutMs: 60_000,
    parse: parseReceipt,
  });
}
