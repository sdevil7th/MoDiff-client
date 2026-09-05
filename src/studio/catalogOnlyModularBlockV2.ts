import type { Edge } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import {
  blockDefinitionContentHashV2,
  blockGraphHashV2,
  createBlockInstanceV2,
  normalizeBlockDefinitionV2,
  type BlockControlV2,
  type BlockDefinitionV2,
  type BlockGraphEdgeV2,
  type BlockGraphNodeModularDiffusersV2,
  type BlockGraphNodeV2,
  type BlockJsonValue,
  type BlockPortV2,
  type BlockPreviewBindingV2,
} from './blockSchemaV2';
import { createBlockRootNodeV2, setBlockPresentationV2 } from './blockRuntimeV2';
import type {
  HuggingFaceNodeLibrary,
  HuggingFaceNodeLibraryBlockDefinition,
  HuggingFaceNodeLibraryBlockPlacement,
  HuggingFaceNodeLibraryDefinition,
} from './huggingFaceNodeLibrary';
import type { HuggingFaceModularConditionalSnapshot } from './huggingFaceModularConditionals';
import { createModularDiffusersCatalogNode } from './modularDiffusersBlockInsertion';
import { compactReviewedModularInternalLayoutV2, reviewedWorkflowHierarchyV2 } from './reviewedModularGraphV2';
import { normalizeBlockValueTypeV2 } from './blockValueTypeCompatibilityV2';

const MODELS_KEY = 'modules.ModularDiffusers.ModelsLoader';
const PUBLIC_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,383}$/u;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pathKey(path: readonly string[]) {
  return path.join('/');
}

function words(value: string) {
  return value
    .replace(/[_-]/gu, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function publicFieldId(direction: 'input' | 'output', fieldName: string) {
  if (PUBLIC_ID.test(fieldName)) return fieldName;
  const escaped = fieldName.replace(/[^A-Za-z0-9_.:/-]+/gu, '_').slice(0, 360);
  return `${direction}:${escaped || 'field'}`;
}

function projectedValueType(value: unknown) {
  const normalized = normalizeBlockValueTypeV2(value);
  return Array.isArray(normalized) ? normalized.map(String).join('|') || 'any' : String(normalized || 'any');
}

function paramValue(param: NodeParams, value: unknown) {
  if (param.display === 'modelselect' && typeof value === 'string') return { source: 'hub', value };
  return clone(value);
}

function setParam(data: NodeData, field: string, value: unknown, options: Partial<NodeParams> = {}) {
  const current = data.params[field];
  if (!current) return;
  data.params[field] = { ...current, value: paramValue(current, value), ...options };
}

function graphEdge(
  id: string,
  sourceNodeId: string,
  sourcePortId: string,
  targetNodeId: string,
  targetPortId: string,
): BlockGraphEdgeV2 {
  return { edgeId: id, sourceNodeId, sourcePortId, targetNodeId, targetPortId };
}

function semanticData(node: CustomNodeType): BlockGraphNodeV2['data'] {
  return clone({
    type: node.data.type,
    module: node.data.module,
    action: node.data.action,
    label: node.data.label,
    category: node.data.category,
    params: node.data.params,
    ...(node.data.description ? { description: node.data.description } : {}),
    ...(node.data.resizable === undefined ? {} : { resizable: node.data.resizable }),
    ...(node.data.skipParamsCheck === undefined ? {} : { skipParamsCheck: node.data.skipParamsCheck }),
  }) as unknown as BlockGraphNodeV2['data'];
}

function catalogEntry(definition: HuggingFaceNodeLibraryDefinition, placement: HuggingFaceNodeLibraryBlockPlacement) {
  return {
    id: `catalog-only:${definition.id}:${pathKey(placement.path)}`,
    kind: 'block' as const,
    label: words(placement.legacyPath),
    description: `Pinned Modular Diffusers placement ${placement.legacyPath}.`,
    detail: placement.legacyPath,
    searchText: placement.legacyPath,
    groupPath: [words(definition.pipelineClass), words(placement.legacyPath)],
    readiness: 'composable' as const,
    readinessLabel: 'Composable' as const,
    insertable: true,
    definitionIds: [definition.id],
    modularBlockPlacement: {
      definitionId: definition.id,
      pipelineClass: definition.pipelineClass,
      blocksClass: definition.blocksClass,
      workflowId: definition.workflowId,
      placement,
      executionScope: 'selected_workflow' as const,
    },
  };
}

function sourceMetadata(
  definition: HuggingFaceNodeLibraryDefinition,
  block: HuggingFaceNodeLibraryBlockDefinition,
  placementPath: string[],
  sourcePlacementPath: string[],
  options: { structural: boolean },
): BlockGraphNodeModularDiffusersV2 {
  return {
    kind: 'upstream_block',
    pipelineClass: definition.pipelineClass,
    blocksClass: definition.blocksClass,
    workflowId: definition.workflowId,
    libraryRevision: definition.libraryRevision,
    runtimeRole: `${options.structural ? 'container' : 'upstream'}:${pathKey(placementPath)}`,
    blockDefinitionId: block.id,
    blockClass: block.className,
    blockKind: block.kind,
    blockContractHash: block.contentHash,
    placementPath,
    ...(placementPath.length > 1 ? { parentPlacementPath: placementPath.slice(0, -1) } : {}),
    sourceDefinitionId: definition.id,
    sourcePlacementPath,
    sourceExecutionScope: options.structural ? 'unpruned_pipeline' : 'selected_workflow',
    componentNames: block.components.map(({ name }) => name).sort(),
  };
}

function loaderGraphNode(
  definition: HuggingFaceNodeLibraryDefinition,
  registry: Readonly<Record<string, NodeData>>,
): BlockGraphNodeV2 {
  const registered = registry[MODELS_KEY];
  if (!registered) throw new Error(`The backend did not publish ${MODELS_KEY}.`);
  const data = clone(registered);
  data.type = 'custom';
  data.label = `Load ${definition.label.replace(/\s*[—-].*$/u, '')} Components`;
  data.category = 'Modular Diffusers Blocks';
  data.description =
    `Loads the model components for ${definition.pipelineClass}/${definition.workflowId}. ` +
    'This structural catalog Block is not an execution qualification claim.';
  data.resizable = true;
  setParam(data, 'model_type', definition.pipelineClass, { hidden: false, disabled: true });
  setParam(data, 'pipeline_class', definition.pipelineClass, { hidden: true, disabled: true });
  setParam(data, 'workflow_id', definition.workflowId, { hidden: true, disabled: true });
  const artifacts = definition.executionAdmissions.flatMap(({ artifact }) => (artifact ? [artifact] : []));
  const artifact = artifacts[0];
  if (artifact) {
    setParam(data, 'repo_id', artifact.repo);
    setParam(data, 'revision', artifact.revision, { hidden: false, disabled: true });
  }
  return {
    nodeId: 'models',
    nodeType: 'custom',
    data: semanticData({ data } as CustomNodeType),
    semanticRole: 'loader',
    modularDiffusers: {
      kind: 'infrastructure',
      pipelineClass: definition.pipelineClass,
      blocksClass: definition.blocksClass,
      workflowId: definition.workflowId,
      libraryRevision: definition.libraryRevision,
      runtimeRole: 'models',
      componentNames: [...new Set(definition.components.map(({ name }) => name))].sort(),
    },
  };
}

function matchingField(
  nodes: readonly BlockGraphNodeV2[],
  blocksByNodeId: ReadonlyMap<string, HuggingFaceNodeLibraryBlockDefinition>,
  fieldName: string,
  direction: 'input' | 'output',
) {
  const ordered = direction === 'output' ? [...nodes].reverse() : nodes;
  return ordered.find((node) => {
    const block = blocksByNodeId.get(node.nodeId);
    const fields = direction === 'input' ? block?.inputs : block?.outputs;
    return fields?.some(({ name }) => name === fieldName) && fieldName in ((node.data.params as object) ?? {});
  });
}

/**
 * Compile an exact structural BlockDefinitionV2 for a reviewed workflow that
 * has not yet received an executable route receipt. It contains ordinary
 * loader/step/group graph nodes and creator defaults, but carries no Auto or
 * publication authority.
 */
export function createCatalogOnlyModularBlockRootV2(
  definition: HuggingFaceNodeLibraryDefinition,
  library: HuggingFaceNodeLibrary,
  registry: Readonly<Record<string, NodeData>>,
  snapshot: HuggingFaceModularConditionalSnapshot,
  position: { x: number; y: number },
): CustomNodeType {
  if (definition.provider !== 'diffusers' || !definition.blocksClass)
    throw new Error('Only a reviewed Modular Diffusers workflow can use the structural V2 compiler.');
  if (snapshot.diffusersRevision !== definition.libraryRevision)
    throw new Error('The unpruned Modular Diffusers hierarchy revision is stale.');
  const hierarchy = reviewedWorkflowHierarchyV2(snapshot, definition);
  if (!hierarchy) throw new Error('The exact reviewed Modular Diffusers workflow hierarchy is unavailable.');
  const blocks = new Map([...library.blockDefinitions, ...snapshot.blockDefinitions].map((block) => [block.id, block]));
  const nodes: BlockGraphNodeV2[] = [loaderGraphNode(definition, registry)];
  const blocksByNodeId = new Map<string, HuggingFaceNodeLibraryBlockDefinition>();

  hierarchy.structuralPlacements.forEach(({ placement, block }) => {
    const nodeId = `container:${pathKey(placement.path)}`;
    blocksByNodeId.set(nodeId, block);
    nodes.push({
      nodeId,
      nodeType: 'group',
      data: {
        type: 'group',
        module: '',
        action: '',
        label: words(block.className),
        category: 'Modular Diffusers Blocks',
        description: block.description || `${block.kind} container from ${definition.blocksClass}.`,
        params: {},
        resizable: true,
      },
      semanticRole: 'container',
      upstreamBlockPath: pathKey(placement.path),
      modularDiffusers: sourceMetadata(definition, block, [...placement.path], [...placement.path], {
        structural: true,
      }),
    });
  });

  definition.blockPlacements.forEach((placement) => {
    const block = blocks.get(placement.blockDefinitionId);
    if (!block) throw new Error(`Pinned block ${placement.blockDefinitionId} is unavailable.`);
    const visualPlacement = hierarchy.fullPlacementBySelectedPath.get(pathKey(placement.path)) ?? placement;
    const created = createModularDiffusersCatalogNode(
      catalogEntry(definition, placement),
      library,
      registry,
      { x: 0, y: 0 },
      snapshot,
    );
    const nodeId = `upstream:${pathKey(placement.path)}`;
    blocksByNodeId.set(nodeId, block);
    nodes.push({
      nodeId,
      nodeType: 'custom',
      data: semanticData(created),
      semanticRole: 'upstream_block',
      upstreamBlockPath: pathKey(visualPlacement.path),
      modularDiffusers: sourceMetadata(definition, block, [...visualPlacement.path], [...placement.path], {
        structural: false,
      }),
    });
  });

  const executable = definition.blockPlacements.map((placement) => ({
    placement,
    nodeId: `upstream:${pathKey(placement.path)}`,
    block: blocks.get(placement.blockDefinitionId)!,
  }));
  const topLevel = executable.filter(({ placement }) => placement.path.length === 1);
  const edges: BlockGraphEdgeV2[] = [];
  if (topLevel.length) {
    edges.push(
      graphEdge('models-to-workflow', 'models', 'pipeline_components', topLevel[0]!.nodeId, 'pipeline_components'),
    );
    topLevel
      .slice(1)
      .forEach((item, index) =>
        edges.push(graphEdge(`state:${index}`, topLevel[index]!.nodeId, 'state_out', item.nodeId, 'state_in')),
      );
  }
  executable
    .filter(({ block }) => block.kind === 'loop')
    .forEach((owner) => {
      const members = executable.filter(
        ({ placement }) =>
          placement.path.length === owner.placement.path.length + 1 &&
          owner.placement.path.every((segment, index) => placement.path[index] === segment),
      );
      members
        .slice(1)
        .forEach((member, index) =>
          edges.push(
            graphEdge(
              `loop:${pathKey(owner.placement.path)}:${index}`,
              members[index]!.nodeId,
              'loop_members',
              member.nodeId,
              'loop_members_in',
            ),
          ),
        );
      if (members.length)
        edges.push(
          graphEdge(
            `loop:${pathKey(owner.placement.path)}:owner`,
            members[members.length - 1]!.nodeId,
            'loop_members',
            owner.nodeId,
            'loop_members_in',
          ),
        );
    });

  const controls: BlockControlV2[] = [];
  const inputs: BlockPortV2[] = [];
  definition.inputs.forEach((field) => {
    const fieldName = field.name === 'generator' ? 'seed' : field.name;
    const controlId = publicFieldId('input', fieldName);
    const target =
      matchingField(nodes, blocksByNodeId, field.name, 'input') ??
      (field.name === 'generator'
        ? nodes.find((node) => fieldName in ((node.data.params as object) ?? {}))
        : undefined);
    const param = target ? (target.data.params as Record<string, NodeParams>)[fieldName] : undefined;
    if (!target || !param || param.display === 'output') return;
    const valueType = projectedValueType(param.type ?? field.type);
    const defaultValue = field.name === 'generator' ? (param.default ?? 0) : field.default;
    controls.push({
      controlId,
      label: words(fieldName),
      binding: { nodeId: target.nodeId, fieldId: fieldName },
      valueType,
      ...(defaultValue === undefined ? {} : { defaultValue: clone(defaultValue) as BlockJsonValue }),
      required: field.required,
      order: controls.length,
      group: 'Inputs',
      ...(field.description ? { help: field.description } : {}),
    });
    inputs.push({
      portId: controlId,
      label: words(fieldName),
      valueType,
      required: field.required,
      binding: { nodeId: target.nodeId, fieldOrPortId: fieldName },
    });
  });

  const outputs: BlockPortV2[] = [];
  const previews: BlockPreviewBindingV2[] = [];
  definition.outputs.forEach((field) => {
    const target = matchingField(nodes, blocksByNodeId, field.name, 'output');
    const param = target ? (target.data.params as Record<string, NodeParams>)[field.name] : undefined;
    if (!target || !param || param.display !== 'output') return;
    const valueType = projectedValueType(param.type ?? field.type);
    outputs.push({
      portId: publicFieldId('output', field.name),
      label: words(field.name),
      valueType,
      required: field.required,
      binding: { nodeId: target.nodeId, fieldOrPortId: field.name },
    });
    const mediaType = /image/iu.test(`${field.name} ${field.type}`)
      ? 'image'
      : /video/iu.test(`${field.name} ${field.type}`)
        ? 'video'
        : /audio/iu.test(`${field.name} ${field.type}`)
          ? 'audio'
          : null;
    if (mediaType)
      previews.push({
        nodeId: target.nodeId,
        outputPortId: field.name,
        mediaType,
        primary: previews.length === 0,
      });
  });

  const graphSemantic = {
    nodes,
    edges,
    executionOrder: nodes.map(({ nodeId }) => nodeId),
  };
  const graph = { ...graphSemantic, graphHash: blockGraphHashV2(graphSemantic) };
  const sourceArtifact = definition.executionAdmissions.flatMap(({ artifact }) => (artifact ? [artifact] : []))[0];
  const source = {
    kind: 'diffusers_catalog' as const,
    catalogCategory: 'diffusers' as const,
    provider: 'huggingface',
    library: 'diffusers' as const,
    libraryRevision: definition.libraryRevision,
    pipelineClass: definition.pipelineClass,
    blocksClass: definition.blocksClass,
    workflow: definition.workflowId,
    manifestDefinitionId: definition.id,
    manifestContentHash: definition.contentHash,
    ...(definition.executionAdmissions[0]?.id ? { executionAdmissionId: definition.executionAdmissions[0].id } : {}),
    ...(sourceArtifact ? { repository: sourceArtifact.repo, repositoryRevision: sourceArtifact.revision } : {}),
  };
  const draft = {
    schemaVersion: 2 as const,
    definitionId: definition.id,
    displayName: definition.label,
    description:
      `${definition.description} Structural catalog Block: exact hierarchy is available; ` +
      'execution and Auto eligibility still require a route-specific qualification receipt.',
    source,
    graph,
    boundary: { mode: 'explicit' as const, inputs, outputs },
    controls,
    ...(definition.suggestedInputs
      ? {
          suggestedInputs: [
            {
              suggestionId: 'publisher-example',
              label: definition.suggestedInputs.source.label,
              ...(definition.suggestedInputs.source.url ? { source: definition.suggestedInputs.source.url } : {}),
              values: Object.fromEntries(
                Object.entries(definition.suggestedInputs.values).flatMap(([key, value]) => {
                  const controlId = publicFieldId('input', key === 'generator' ? 'seed' : key);
                  return controls.some((control) => control.controlId === controlId) ? [[controlId, value]] : [];
                }),
              ) as Record<string, BlockJsonValue>,
            },
          ].filter(({ values }) => Object.keys(values).length),
        }
      : {}),
    previews,
    ownership: { kind: 'registered' as const, definitionMutable: false },
  };
  const blockDefinition = normalizeBlockDefinitionV2({
    ...draft,
    contentHash: blockDefinitionContentHashV2(draft),
  } satisfies BlockDefinitionV2);
  const starterValues = Object.fromEntries(
    Object.entries(definition.suggestedInputs?.values ?? {}).flatMap(([key, value]) => {
      const controlId = publicFieldId('input', key === 'generator' ? 'seed' : key);
      return controls.some((control) => control.controlId === controlId) ? [[controlId, value]] : [];
    }),
  ) as Record<string, BlockJsonValue>;
  let instance = createBlockInstanceV2(blockDefinition, {
    instanceId: `block-v2-${globalThis.crypto.randomUUID()}`,
    position,
    size: { width: 560, height: 720 },
    values: starterValues,
    baselineValues: true,
    internalLayoutMode: 'hierarchical',
  });
  const internalLayout = compactReviewedModularInternalLayoutV2(instance);
  if (internalLayout) instance = setBlockPresentationV2(instance, { internalLayout });
  return createBlockRootNodeV2(instance);
}

/** Canvas-edge form used only by focused compiler tests and diagnostics. */
export function catalogOnlyBlockEdgesV2(root: CustomNodeType): Edge[] {
  return (
    root.data.blockInstanceV2?.effectiveGraph.edges.map((edge) => ({
      id: edge.edgeId,
      source: edge.sourceNodeId,
      sourceHandle: edge.sourcePortId,
      target: edge.targetNodeId,
      targetHandle: edge.targetPortId,
    })) ?? []
  );
}
