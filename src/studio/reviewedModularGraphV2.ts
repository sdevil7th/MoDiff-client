import type { Edge } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import type { BlockGraphNodeModularDiffusersV2, BlockInstanceV2 } from './blockSchemaV2';
import type { HuggingFaceClusterExecutionSkeleton } from './huggingFaceClusterMaterializer';
import type {
  HuggingFaceNodeLibraryBlockDefinition,
  HuggingFaceNodeLibraryBlockRoleAdapter,
  HuggingFaceNodeLibraryDefinition,
} from './huggingFaceNodeLibrary';
import type { RegisteredBlockV2ControlFanOut, RegisteredBlockV2Route } from './registeredBlockV2Routes';
import { reviewedCallerInputOwnersV2 } from './reviewedControlOwnershipV2';
import {
  reviewedConditionalParameterPlacement,
  type HuggingFaceModularConditionalPlacement,
  type HuggingFaceModularConditionalSnapshot,
} from './huggingFaceModularConditionals';

export type ExactReviewedModularGraphV2 = {
  skeleton: HuggingFaceClusterExecutionSkeleton;
  metadataBySemanticRole: ReadonlyMap<string, BlockGraphNodeModularDiffusersV2>;
  boundaryInputs?: RegisteredBlockV2Route['boundary']['inputs'];
  boundaryOutputs?: RegisteredBlockV2Route['boundary']['outputs'];
  controlFanOuts?: readonly RegisteredBlockV2ControlFanOut[];
  routeControlFanOuts?: readonly RegisteredBlockV2ControlFanOut[];
};

type ReviewedWorkflowHierarchy = {
  structuralPlacements: Array<{
    placement: HuggingFaceModularConditionalPlacement;
    block: HuggingFaceNodeLibraryBlockDefinition;
  }>;
  fullPlacementBySelectedPath: ReadonlyMap<string, HuggingFaceModularConditionalPlacement>;
};

type PersistedBinding = {
  schemaVersion: 1;
  admissionId: string;
  source: string;
  persistence: 'instance_input' | 'execution_parameter' | 'sealed';
  input?: string;
};

const STEP_MODULE = 'modules.ModularDiffusers';
const STEP_ACTION = 'ReviewedModularWorkflowStep';
const GRID_COLUMNS = 4;
const GRID_X = 390;
const GRID_ROW_GAP = 72;
const GRID_LEFT = 48;
const GRID_TOP = 104;
const NODE_WIDTH = 340;
const HIERARCHY_COLUMNS = 3;
const HIERARCHY_PADDING = 28;
const HIERARCHY_CHILD_TOP = 76;
const HIERARCHY_GAP_X = 36;
const HIERARCHY_GAP_Y = 44;

function invalid(message: string): never {
  throw new Error(`Cannot compile exact reviewed Modular Diffusers graph: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function binding(value: unknown): PersistedBinding | null {
  if (!isRecord(value) || !isRecord(value.huggingFaceClusterBinding)) return null;
  const candidate = value.huggingFaceClusterBinding;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.admissionId !== 'string' ||
    typeof candidate.source !== 'string' ||
    (candidate.persistence !== 'instance_input' &&
      candidate.persistence !== 'execution_parameter' &&
      candidate.persistence !== 'sealed')
  )
    return null;
  return candidate as PersistedBinding;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pathKey(path: readonly string[]) {
  return path.join('/');
}

function lexicalCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function defaultRole(path: readonly string[]) {
  return `upstream:${path.join('/')}`;
}

function humanClassName(value: string) {
  return value
    .replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function exactNodeId(instanceId: string, semanticRole: string) {
  return `reviewed-modular:${instanceId.length}:${instanceId}:${semanticRole.length}:${semanticRole}`;
}

function exactEdge(
  instanceId: string,
  sourceRole: string,
  sourceHandle: string,
  targetRole: string,
  targetHandle: string,
): Edge {
  return {
    id: `reviewed-modular-edge:${instanceId}:${sourceRole}:${sourceHandle}:${targetRole}:${targetHandle}`,
    source: exactNodeId(instanceId, sourceRole),
    sourceHandle,
    target: exactNodeId(instanceId, targetRole),
    targetHandle,
  };
}

function identityParam(base: NodeData, name: string, value: unknown): NodeParams {
  const param = base.params[name];
  if (!param) invalid(`backend action ${STEP_MODULE}.${STEP_ACTION} has no ${name} field.`);
  return { ...clone(param), value, hidden: true };
}

function socketParam(base: NodeData, name: string, required = false): NodeParams {
  const param = base.params[name];
  if (!param) invalid(`backend action ${STEP_MODULE}.${STEP_ACTION} has no ${name} socket.`);
  return { ...clone(param), hidden: false, ...(required ? { required: true } : {}) };
}

function topLevelPlacements(definition: HuggingFaceNodeLibraryDefinition) {
  return definition.blockPlacements
    .filter(({ path }) => path.length === 1)
    .sort((left, right) => left.order - right.order);
}

export function reviewedWorkflowHierarchyV2(
  snapshot: HuggingFaceModularConditionalSnapshot | undefined,
  definition: HuggingFaceNodeLibraryDefinition,
): ReviewedWorkflowHierarchy | null {
  if (!snapshot || snapshot.diffusersRevision !== definition.libraryRevision) return null;
  const pipeline = snapshot.pipelines.find(({ pipelineClass }) => pipelineClass === definition.pipelineClass);
  const workflow = pipeline?.workflows.find(({ id }) => id === definition.workflowId);
  if (!pipeline || !workflow) return null;
  const hierarchySignatures = new Set(
    workflow.cases.map((item) =>
      JSON.stringify({
        leaves: item.activeLeafPaths,
        selections: item.selections.map(({ path, selectedBlockName }) => ({ path, selectedBlockName })),
      }),
    ),
  );
  if (hierarchySignatures.size !== 1)
    invalid(`workflow ${definition.workflowId} has multiple incompatible reviewed hierarchy cases.`);
  const workflowCase = workflow.cases[0]!;
  const selectionByPath = new Map(workflowCase.selections.map((item) => [pathKey(item.path), item]));
  const definitions = new Map(snapshot.blockDefinitions.map((item) => [item.id, item]));
  const allowedPlacements = pipeline.placements.filter((placement) =>
    pipeline.conditionals.every((conditional) => {
      if (placement.path.length <= conditional.path.length) return true;
      if (!conditional.path.every((segment, index) => placement.path[index] === segment)) return true;
      const branch = placement.path[conditional.path.length];
      if (!branch || !conditional.branchNames.includes(branch)) return true;
      return selectionByPath.get(pathKey(conditional.path))?.selectedBlockName === branch;
    }),
  );
  const fullPlacementBySelectedPath = new Map<string, HuggingFaceModularConditionalPlacement>();
  allowedPlacements.forEach((placement) => {
    const selected = reviewedConditionalParameterPlacement(
      placement,
      pipeline.conditionals,
      definition.blockPlacements,
      definitions,
    );
    if (!selected) return;
    const selectedKey = pathKey(selected.path);
    const previous = fullPlacementBySelectedPath.get(selectedKey);
    if (previous && pathKey(previous.path) !== pathKey(placement.path))
      invalid(`selected placement ${selected.legacyPath} maps to more than one active upstream path.`);
    fullPlacementBySelectedPath.set(selectedKey, placement);
  });
  const missing = definition.blockPlacements.filter(
    (placement) => !fullPlacementBySelectedPath.has(pathKey(placement.path)),
  );
  if (missing.length) invalid(`the unpruned workflow trace does not map selected placement ${missing[0]!.legacyPath}.`);
  const selectedFullPaths = new Set([...fullPlacementBySelectedPath.values()].map(({ path }) => pathKey(path)));
  return {
    structuralPlacements: allowedPlacements.flatMap((placement) => {
      const key = pathKey(placement.path);
      if (selectedFullPaths.has(key)) return [];
      // A structural placement belongs to the selected workflow only when it
      // owns a selected descendant. A skipped Conditional/Auto placement is
      // still available in the Modular Diffusers library, but rendering it in
      // the active graph creates a portless node which neither executes nor
      // participates in dataflow (for example Qwen's optional VAE encoders in
      // the text-to-image route).
      if (![...selectedFullPaths].some((selectedKey) => selectedKey.startsWith(`${key}/`))) return [];
      const block = definitions.get(placement.blockDefinitionId);
      if (!block) invalid(`unpruned placement ${placement.legacyPath} has no reviewed block definition.`);
      return [{ placement, block }];
    }),
    fullPlacementBySelectedPath,
  };
}

function isVisibleControl(param: NodeParams) {
  if (param.hidden) return false;
  const display = String(param.display ?? '').toLowerCase();
  return display !== 'input' && display !== 'output';
}

function isMultilineControl(param: NodeParams) {
  const display = String(param.display ?? '').toLowerCase();
  const type = Array.isArray(param.type) ? param.type.join(' ').toLowerCase() : String(param.type ?? '').toLowerCase();
  return display.startsWith('text') || type === 'text';
}

/** Presentation-only defaults; executable upstream block boundaries are unchanged. */
export function reviewedModularNodeDefaultSizeV2(node: CustomNodeType, role: string) {
  if (node.data.type === 'group') return { width: NODE_WIDTH, height: 176 };
  const visible = Object.values(node.data.params).filter(isVisibleControl);
  const multiline = visible.some(isMultilineControl);
  const hasMedia = visible.some(({ display }) =>
    String(display ?? '')
      .toLowerCase()
      .startsWith('ui_'),
  );
  // A parameterless upstream leaf still exposes typed state/component sockets,
  // but it does not need the large editor body used by configurable nodes.
  let height = visible.length === 0 ? 132 : 176;
  if (role === 'models') height = 400;
  else if (role === 'preview' || hasMedia) height = 320;
  else if (multiline) height = 400;
  else if (visible.length > 6) height = 400;
  else if (visible.length > 3) height = 320;
  else if (visible.length > 0) height = 240;
  return { width: NODE_WIDTH, height };
}

type ReviewedLayoutItem = {
  role: string;
  node: CustomNodeType;
  metadata?: BlockGraphNodeModularDiffusersV2;
};

function reviewedHierarchyLayout(items: readonly ReviewedLayoutItem[]) {
  const byRole = new Map(items.map((item) => [item.role, item]));
  const roleByPath = new Map(
    items.flatMap((item) => {
      const path = item.metadata?.kind === 'upstream_block' ? item.metadata.placementPath : undefined;
      return path?.length ? ([[pathKey(path), item.role]] as const) : [];
    }),
  );
  const parentByRole = new Map<string, string>();
  items.forEach((item) => {
    const parentPath = item.metadata?.kind === 'upstream_block' ? item.metadata.parentPlacementPath : undefined;
    const parentRole = parentPath?.length ? roleByPath.get(pathKey(parentPath)) : undefined;
    if (parentRole) parentByRole.set(item.role, parentRole);
  });
  const childrenByRole = new Map<string, string[]>();
  items.forEach((item) => {
    const parent = parentByRole.get(item.role);
    if (parent) childrenByRole.set(parent, [...(childrenByRole.get(parent) ?? []), item.role]);
  });

  type Measured = { width: number; height: number };
  const measured = new Map<string, Measured>();
  const measure = (role: string): Measured => {
    const cached = measured.get(role);
    if (cached) return cached;
    const item = byRole.get(role);
    if (!item) invalid(`the reviewed hierarchy references missing node ${role}.`);
    const own = reviewedModularNodeDefaultSizeV2(item.node, role);
    measured.set(role, own);
    return own;
  };
  const roots = items.filter(({ role }) => !parentByRole.has(role)).map(({ role }) => role);
  roots.forEach((role) => measure(role));

  const layout: BlockInstanceV2['presentation']['internalLayout'] = {};
  const placeChildren = (role: string) => {
    const children = childrenByRole.get(role) ?? [];
    if (!children.length) return;
    const columns = Math.min(HIERARCHY_COLUMNS, children.length);
    const childSizes = children.map((child) => measure(child));
    const columnWidths = Array.from({ length: columns }, (_, column) =>
      Math.max(...childSizes.filter((_size, index) => index % columns === column).map(({ width }) => width)),
    );
    const rowCount = Math.ceil(children.length / columns);
    const rowHeights = Array.from({ length: rowCount }, (_, row) =>
      Math.max(...childSizes.slice(row * columns, row * columns + columns).map(({ height }) => height)),
    );
    const columnX = columnWidths.map(
      (_width, column) =>
        HIERARCHY_PADDING +
        columnWidths.slice(0, column).reduce((total, width) => total + width, 0) +
        HIERARCHY_GAP_X * column,
    );
    const rowY = rowHeights.map(
      (_height, row) =>
        HIERARCHY_CHILD_TOP +
        rowHeights.slice(0, row).reduce((total, height) => total + height, 0) +
        HIERARCHY_GAP_Y * row,
    );
    children.forEach((child, index) => {
      const size = measure(child);
      layout[child] = {
        x: columnX[index % columns]!,
        y: rowY[Math.floor(index / columns)]!,
        width: size.width,
        height: size.height,
      };
      placeChildren(child);
    });
  };

  let rowY = GRID_TOP;
  for (let rowStart = 0; rowStart < roots.length; rowStart += GRID_COLUMNS) {
    const row = roots.slice(rowStart, rowStart + GRID_COLUMNS);
    const sizes = row.map((role) => measure(role));
    row.forEach((role, column) => {
      const size = sizes[column]!;
      const x =
        GRID_LEFT +
        sizes.slice(0, column).reduce((total, item) => total + item.width, 0) +
        (GRID_X - NODE_WIDTH) * column;
      layout[role] = { x, y: rowY, width: size.width, height: size.height };
      placeChildren(role);
    });
    rowY += Math.max(...sizes.map(({ height }) => height)) + GRID_ROW_GAP;
  }
  return layout;
}

function applyCompactReviewedLayout(nodes: ReviewedLayoutItem[]) {
  const layout = reviewedHierarchyLayout(nodes);
  nodes.forEach(({ role, node }) => {
    const item = layout[role]!;
    node.position = { x: item.x, y: item.y };
    node.width = item.width;
    node.height = item.height;
  });
}

/**
 * Reapply the current presentation defaults to an existing reviewed Diffusers
 * Block instance. This is intentionally an explicit user action: ordinary
 * expand/collapse and model-variant changes must preserve saved manual layout.
 * Graph nodes, edges, values, interfaces, definition identity, and authority
 * are not inspected or rewritten by this helper.
 */
export function compactReviewedModularInternalLayoutV2(
  instance: BlockInstanceV2,
): BlockInstanceV2['presentation']['internalLayout'] | null {
  if (instance.definitionSnapshot.source.kind !== 'diffusers_catalog') return null;
  if (!instance.effectiveGraph.nodes.some((node) => node.modularDiffusers)) return null;

  const byId = new Map(instance.effectiveGraph.nodes.map((node) => [node.nodeId, node]));
  const ordered = (instance.effectiveGraph.executionOrder ?? []).flatMap((nodeId) => {
    const node = byId.get(nodeId);
    if (!node) return [];
    byId.delete(nodeId);
    return [node];
  });
  ordered.push(...[...byId.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)));

  return reviewedHierarchyLayout(
    ordered.map((graphNode) => ({
      role: graphNode.nodeId,
      node: { data: graphNode.data as unknown as NodeData } as CustomNodeType,
      metadata: graphNode.modularDiffusers,
    })),
  );
}

/**
 * Replace an admitted coarse Studio execution witness with the exact reviewed
 * upstream block placements. The witness remains the source of loader fields,
 * user values, and backend-finalized bindings; upstream structure comes only
 * from the immutable Hugging Face library manifest.
 */
export function reviewedModularGraphV2(
  definition: HuggingFaceNodeLibraryDefinition,
  source: HuggingFaceClusterExecutionSkeleton,
  route: RegisteredBlockV2Route,
  blockDefinitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
  reviewedStepNodeData: NodeData,
  conditionalSnapshot?: HuggingFaceModularConditionalSnapshot,
  blockRoleAdapters: readonly HuggingFaceNodeLibraryBlockRoleAdapter[] = [],
): ExactReviewedModularGraphV2 {
  const exact = route.exactModularGraph ?? { semanticRoleByPlacementPath: {} };
  if (definition.provider !== 'diffusers' || definition.blocksClass === null)
    invalid('only a reviewed Modular Diffusers definition can opt into exact placement execution.');
  if (reviewedStepNodeData.module !== STEP_MODULE || reviewedStepNodeData.action !== STEP_ACTION)
    invalid(`the backend did not publish ${STEP_MODULE}.${STEP_ACTION}.`);

  const admission = definition.executionAdmissions.find(({ id }) => id === source.admissionId);
  if (!admission) invalid('the exact execution admission is unavailable.');
  const blocks = new Map(blockDefinitions.map((block) => [block.id, block]));
  const placements = definition.blockPlacements.map((placement) => {
    const block = blocks.get(placement.blockDefinitionId);
    if (!block) invalid(`reviewed block ${placement.blockDefinitionId} is unavailable.`);
    return { placement, block };
  });
  if (!placements.length) invalid('the reviewed workflow has no upstream block placements.');
  const hierarchy = reviewedWorkflowHierarchyV2(conditionalSnapshot, definition);

  const sourceByRole = new Map(source.nodes.map((node) => [node.data.huggingFaceClusterExecutionRole, node]));
  const models = sourceByRole.get('models');
  if (!models) invalid('the admitted Studio witness has no models loader.');

  const graphAdapter = definition.graphAdapterContracts.find(({ id }) => id === route.adapterContractId);
  if (!graphAdapter) invalid('the reviewed graph adapter is absent from the selected definition.');
  const roleAdapterByBlock = new Map(blockRoleAdapters.map((adapter) => [adapter.blockDefinitionId, adapter.role]));
  const normalized = (value: string) => value.replace(/[^a-z0-9]/giu, '').toLowerCase();
  const actionFamily = (action: string) => {
    const value = action.toLowerCase();
    if (value.includes('prompt_enhancer')) return 'prompt_enhancer';
    if (value.includes('text_encoder') || value.includes('textencode') || value === 'semantic_generator')
      return 'text_encoder';
    if (value.includes('image_encoder') && !value.includes('vae')) return 'image_encoder';
    if (value.includes('video_encoder')) return 'video_encoder';
    if (value.includes('vae_encoder') || value.includes('imageencode')) return 'vae_encoder';
    if (value.includes('before_encode')) return 'before_encode';
    if (value.includes('after_decode')) return 'after_decode';
    if (value.includes('decoder') || value === 'decode') return 'decoder';
    if (value.includes('denoise')) return 'denoise';
    if (value.includes('ip_adapter')) return 'ip_adapter';
    if (value.includes('controlnet')) return 'controlnet';
    if (value.includes('duration')) return 'duration';
    return value.replace(/^workflow_/u, '');
  };
  const sourceRoleAliases: Readonly<Record<string, readonly string[]>> = {
    prompt_enhancer: ['promptEnhance'],
    text_encoder: ['prompt'],
    semantic_generator: ['prompt'],
    image_encoder: ['imageEmbeddings', 'imageEncode'],
    vae_encoder: ['imageEncode'],
    video_encoder: ['videoEncode', 'imageEncode'],
    before_encode: ['beforeEncode'],
    denoise: ['denoise'],
    decoder: ['decode'],
    after_decode: ['afterDecode'],
    ip_adapter: ['ipAdapter'],
    controlnet: ['controlnet'],
    duration: ['duration'],
  };
  const sourceRoleForAction = new Map<string, string>();
  const usedSourceRoles = new Set<string>();
  const sourceRoleIsInfrastructure = (role: string) => {
    const node = sourceByRole.get(role);
    if (!node) return false;
    const action = node.data.action.toLowerCase();
    return (
      role === 'models' ||
      role === 'preview' ||
      action.includes('loadpipeline') ||
      action.includes('loadmodels') ||
      action.includes('preview') ||
      action.includes('export') ||
      Object.entries(node.data.params).some(
        ([fieldId, param]) =>
          param.display === 'output' && (fieldId === 'pipeline_components' || fieldId === 'pipelineComponents'),
      )
    );
  };
  const sourceRoleIsOldExactPlacement = (role: string) => {
    const node = sourceByRole.get(role);
    return Boolean(
      node && ((node.data.module === STEP_MODULE && node.data.action === STEP_ACTION) || role.startsWith('container:')),
    );
  };
  graphAdapter.actionSequence.forEach((action) => {
    const family = actionFamily(action);
    const candidates = [
      ...(sourceRoleAliases[family] ?? []),
      action,
      family,
      ...source.nodes
        .map((node) => node.data.huggingFaceClusterExecutionRole!)
        .filter((role) => normalized(role) === normalized(action) || normalized(role) === normalized(family)),
    ];
    const role = candidates.find((candidate) => sourceByRole.has(candidate) && !usedSourceRoles.has(candidate));
    if (!role) invalid(`graph adapter action ${action} has no unique admitted Studio role.`);
    if (sourceRoleIsInfrastructure(role)) return;
    sourceRoleForAction.set(action, role);
    usedSourceRoles.add(role);
  });

  const placementForSourceRole = new Map<string, (typeof placements)[number]>();
  const usedPlacementPaths = new Set<string>();
  const explicitlyMappedSourceRoles = new Set<string>();
  Object.entries(exact.semanticRoleByPlacementPath).forEach(([placementPath, sourceRole]) => {
    if (!sourceByRole.has(sourceRole)) return;
    const target = placements.find(({ placement }) => pathKey(placement.path) === placementPath);
    if (!target) invalid(`explicit semantic role ${sourceRole} targets missing placement ${placementPath}.`);
    placementForSourceRole.set(sourceRole, target);
    explicitlyMappedSourceRoles.add(sourceRole);
    usedPlacementPaths.add(pathKey(target.placement.path));
  });
  graphAdapter.actionSequence.forEach((action, actionIndex) => {
    const sourceRole = sourceRoleForAction.get(action);
    if (!sourceRole) return;
    if (placementForSourceRole.has(sourceRole)) return;
    const sourceNode = sourceByRole.get(sourceRole)!;
    const directLegacyPath =
      graphAdapter.upstreamBlockSequence.length === graphAdapter.actionSequence.length
        ? graphAdapter.upstreamBlockSequence[actionIndex]
        : undefined;
    const family = actionFamily(action);
    const sourceInputs = new Set(
      Object.entries(sourceNode.data.params)
        .filter(([, param]) => param.display !== 'output')
        .map(([fieldId]) => fieldId),
    );
    const sourceOutputs = new Set(
      Object.entries(sourceNode.data.params)
        .filter(([, param]) => param.display === 'output')
        .map(([fieldId]) => fieldId),
    );
    const scored = placements
      .filter(({ placement }) => !usedPlacementPaths.has(pathKey(placement.path)))
      .map((candidate) => {
        const adapterRole = roleAdapterByBlock.get(candidate.block.id);
        const candidateFamily = adapterRole === 'decoder' ? 'decoder' : adapterRole;
        const legacy = candidate.placement.legacyPath;
        const inputNames = new Set(candidate.block.inputs.map(({ name }) => name));
        const outputNames = new Set(candidate.block.outputs.map(({ name }) => name));
        let score = 0;
        if (directLegacyPath === legacy || directLegacyPath === pathKey(candidate.placement.path)) score += 10_000;
        if (candidateFamily === family) score += 1_000;
        if (legacy === family || legacy.startsWith(`${family}.`)) score += 500;
        sourceInputs.forEach((name) => {
          if (inputNames.has(name)) score += 50;
        });
        sourceOutputs.forEach((name) => {
          if (outputNames.has(name)) score += 40;
        });
        if (
          family === 'decoder' &&
          candidate.block.outputs.some(({ name }) => definition.outputs.some((item) => item.name === name))
        )
          score += 400;
        if (family === 'denoise' && candidate.block.kind === 'loop') score += 200;
        return { candidate, score };
      })
      .sort(
        (left, right) => right.score - left.score || left.candidate.placement.order - right.candidate.placement.order,
      );
    const selected = scored[0];
    if (!selected || selected.score <= 0)
      invalid(`graph adapter action ${action} has no reviewed upstream block owner.`);
    placementForSourceRole.set(sourceRole, selected.candidate);
    usedPlacementPaths.add(pathKey(selected.candidate.placement.path));
  });

  const semanticRoleByPath = new Map<string, string>();
  placements.forEach(({ placement }) => {
    const key = pathKey(placement.path);
    const mappedSourceRole = [...placementForSourceRole].find(
      ([, candidate]) => candidate.placement === placement,
    )?.[0];
    const role = exact.semanticRoleByPlacementPath[key] ?? mappedSourceRole ?? defaultRole(placement.path);
    if ([...semanticRoleByPath.values()].includes(role)) invalid(`semantic role ${role} is duplicated.`);
    semanticRoleByPath.set(key, role);
  });

  const exactOutputTarget = (sourceRole: string, fieldId: string) => {
    const preferredTarget = placementForSourceRole.get(sourceRole);
    if (!preferredTarget) return null;
    if (sourceByRole.get(sourceRole)?.data.params[fieldId]?.display !== 'output') {
      return { target: preferredTarget, fieldId };
    }
    const reviewed = route.boundary.outputs.find(
      (binding) => binding.role === sourceRole && binding.fieldId === fieldId,
    );
    const declaredName = reviewed?.outputName ?? reviewed?.portId;
    const aliases: Readonly<Record<string, readonly string[]>> = {
      image: ['images'],
      video: ['videos'],
      audio: ['audios', 'sound'],
      sample_rate: ['sampling_rate'],
    };
    const candidateNames = [fieldId, ...(declaredName ? [declaredName] : []), ...(aliases[fieldId] ?? [])];
    // A sequential Modular workflow can expose the same state key from an
    // intermediate decoder and from a later postprocessor. Unless the route
    // explicitly pins the role, the public output must bind to the last
    // selected writer; otherwise execution can finish successfully while a
    // Preview receives the raw/intermediate value and persists no media.
    const inferredTargets = explicitlyMappedSourceRoles.has(sourceRole)
      ? [preferredTarget, ...placements]
      : [...placements].reverse().concat(preferredTarget);
    const orderedTargets = inferredTargets.filter(
      (target, index, values): target is (typeof placements)[number] =>
        Boolean(target) && values.indexOf(target) === index,
    );
    for (const target of orderedTargets) {
      const outputNames = new Set(target.block.outputs.map(({ name }) => name));
      const outputField = candidateNames.find((name) => outputNames.has(name));
      if (outputField) return { target, fieldId: outputField };
    }
    return { target: preferredTarget, fieldId };
  };
  const boundaryOutputs = route.boundary.outputs.map((output) => {
    const exactTarget = exactOutputTarget(output.role, output.fieldId);
    if (!exactTarget || output.adaptation === 'media_file_export') return output;
    return {
      ...output,
      role: semanticRoleByPath.get(pathKey(exactTarget.target.placement.path))!,
      fieldId: exactTarget.fieldId,
    };
  });

  const mutableFields = source.nodes.flatMap((node) => {
    const role = node.data.huggingFaceClusterExecutionRole;
    if (!role || !placementForSourceRole.has(role)) return [];
    return Object.entries(node.data.params).flatMap(([fieldId, param]) => {
      const receipt = binding(param.fieldOptions);
      return receipt ? [{ fieldId, param: clone(param), receipt, sourceRole: role }] : [];
    });
  });
  const inputBySource = new Map(admission.instanceInputBindings.map((item) => [item.bindingSource, item.input]));
  const admittedMutableSourceKeys = new Set([
    ...definition.inputs.flatMap((field) => {
      const admitted = admission.instanceInputBindings.find((item) => item.input === field.name);
      return admitted ? [`instance_input\0${admitted.bindingSource}`] : [];
    }),
    ...admission.executionParameterSources.map((source) => `execution_parameter\0${source}`),
  ]);
  const targetForField = (fieldId: string, sourceName?: string, sourceRole?: string) => {
    // MoDiff's bounded seed is the adapter for upstream's Generator input,
    // not a parameter consumed by every coarse denoiser. Initialize the shared
    // PipelineState generator at its first selected consumer; later blocks
    // inherit its advanced state instead of restarting the random sequence.
    if (fieldId === 'seed') {
      const consumer = placements
        .filter(({ block }) => block.inputs.some(({ name }) => name === 'generator'))
        .sort((left, right) => left.placement.order - right.placement.order)[0];
      if (!consumer) invalid(`seed has no selected upstream Generator consumer.`);
      return consumer;
    }
    const inputName = (sourceName && inputBySource.get(sourceName)) || fieldId;
    const stateOwners = reviewedCallerInputOwnersV2(placements, inputName);
    const explicit = sourceName ? exact.controlPlacementPathBySource?.[sourceName] : undefined;
    if (explicit) {
      const target = placements.find(({ placement }) => pathKey(placement.path) === explicit);
      if (!target) invalid(`control ${sourceName} targets missing placement ${explicit}.`);
      if (stateOwners && !stateOwners.includes(target)) return stateOwners[0]!;
      return target;
    }
    const roleTarget = sourceRole ? placementForSourceRole.get(sourceRole) : undefined;
    if (stateOwners && (!roleTarget || !stateOwners.includes(roleTarget))) return stateOwners[0]!;
    if (roleTarget) return roleTarget;
    const targets = placements.filter(({ block }) => block.inputs.some(({ name }) => name === inputName));
    const target = targets[0];
    if (!target) invalid(`field ${sourceName ?? fieldId} has no exact upstream owner.`);
    return target;
  };
  const topLevel = topLevelPlacements(definition).map((placement) => ({
    placement,
    block: blocks.get(placement.blockDefinitionId)!,
  }));
  const boundaryInputs = route.boundary.inputs?.map((input) => {
    const previous =
      placementForSourceRole.get(input.role) ??
      placements.find(({ placement }) => semanticRoleByPath.get(pathKey(placement.path)) === input.role);
    if (!previous || !reviewedCallerInputOwnersV2(placements, input.fieldId)) return input;
    const sourceName = admission.instanceInputBindings.find(
      (binding) => binding.input === (input.inputName ?? input.portId),
    )?.bindingSource;
    const target = targetForField(input.fieldId, sourceName, input.role);
    return { ...input, role: semanticRoleByPath.get(pathKey(target.placement.path))! };
  });

  const paramsByPath = new Map<string, Record<string, NodeParams>>();
  placements.forEach(({ placement, block }) => {
    const key = pathKey(placement.path);
    // Named Auto/Conditional workflows execute the pruned tree returned by
    // get_workflow(), so their reviewed parameter placement is already the
    // runtime path. A fixed SequentialPipelineBlocks definition has no
    // _workflow_map and uses MoDiff's internal "default" workflow identity;
    // it executes the original nested tree instead. In that case the selected
    // manifest may represent a nested leaf as one dotted segment while the
    // conditional snapshot retains the real upstream path. Never send that
    // presentation shorthand to the backend path walker.
    const runtimePlacementPath =
      definition.workflowId === 'default'
        ? (hierarchy?.fullPlacementBySelectedPath.get(key)?.path ?? placement.path)
        : placement.path;
    const isLoopOwner = block.kind === 'loop';
    const parent = placement.path.length > 1 ? placement.path.slice(0, -1) : null;
    const parentBlock = parent
      ? placements.find(({ placement: candidate }) => pathKey(candidate.path) === pathKey(parent))?.block
      : null;
    const isLoopMember = parentBlock?.kind === 'loop';
    const params: Record<string, NodeParams> = {
      pipeline_class: identityParam(reviewedStepNodeData, 'pipeline_class', definition.pipelineClass),
      workflow_id: identityParam(reviewedStepNodeData, 'workflow_id', definition.workflowId),
      execution_scope: identityParam(reviewedStepNodeData, 'execution_scope', 'selected_workflow'),
      placement_path: identityParam(reviewedStepNodeData, 'placement_path', runtimePlacementPath),
      block_definition_id: identityParam(reviewedStepNodeData, 'block_definition_id', block.id),
      block_class: identityParam(reviewedStepNodeData, 'block_class', block.className),
      block_contract_hash: identityParam(reviewedStepNodeData, 'block_contract_hash', block.contentHash),
      execution_kind: identityParam(
        reviewedStepNodeData,
        'execution_kind',
        isLoopMember ? 'loop_member' : isLoopOwner ? 'loop_owner' : 'step',
      ),
    };
    if (isLoopMember) {
      params.loop_members_in = socketParam(reviewedStepNodeData, 'loop_members_in');
      params.loop_members = socketParam(reviewedStepNodeData, 'loop_members');
    } else {
      params.state_in = socketParam(reviewedStepNodeData, 'state_in');
      params.state_out = socketParam(reviewedStepNodeData, 'state_out');
      if (isLoopOwner) params.loop_members_in = socketParam(reviewedStepNodeData, 'loop_members_in', true);
      if (key === pathKey(topLevel[0]!.placement.path)) {
        params.pipeline_components = socketParam(reviewedStepNodeData, 'pipeline_components', true);
      }
      for (const output of block.outputs) {
        if (reviewedStepNodeData.params[output.name]?.display === 'output') {
          const runtimeRole = semanticRoleByPath.get(key)!;
          const publicOutput = boundaryOutputs.find(
            (binding) => binding.role === runtimeRole && binding.fieldId === output.name,
          );
          params[output.name] = {
            ...socketParam(reviewedStepNodeData, output.name),
            ...(publicOutput?.adaptation === 'direct_media' && publicOutput.mediaType
              ? { type: publicOutput.mediaType }
              : {}),
          };
        }
      }
    }
    addReviewedValuePortsV2(
      params,
      reviewedStepNodeData.params,
      block.inputs,
      block.outputs,
      isLoopMember ? 'loop_member' : isLoopOwner ? 'loop_owner' : 'step',
    );
    paramsByPath.set(key, params);
  });

  const derivedControlFanOuts: RegisteredBlockV2ControlFanOut[] = [];
  const mutableBindingOwnerByTarget = new Map<string, string>();
  mutableFields.forEach(({ fieldId, param, receipt, sourceRole }) => {
    const target = targetForField(fieldId, receipt.source, sourceRole);
    mutableBindingOwnerByTarget.set(
      `${pathKey(target.placement.path)}\0${fieldId}`,
      `${receipt.persistence}\0${receipt.source}`,
    );
    paramsByPath.get(pathKey(target.placement.path))![fieldId] = param;
  });

  const derivedControlSources = new Set<string>();
  mutableFields.forEach(({ fieldId, param, receipt, sourceRole }) => {
    const target = targetForField(fieldId, receipt.source, sourceRole);
    if (receipt.persistence === 'sealed') return;
    const sourceKey = `${receipt.persistence}\0${receipt.source}`;
    if (!admittedMutableSourceKeys.has(sourceKey) || param.display === 'output') return;
    if (derivedControlSources.has(sourceKey)) return;
    derivedControlSources.add(sourceKey);
    if (fieldId === 'seed') return;

    // A top-level ModularPipeline argument can be consumed by more than one
    // decomposed upstream leaf. The legacy execution skeleton carries the
    // caller binding on one representative node, so exact reviewed routes must
    // explicitly name every additional leaf that needs the same value. Copying
    // the binding receipt here lets BlockDefinitionV2 compile one control with
    // mirrorBindings instead of silently leaving an earlier leaf at its
    // upstream default (for example Qwen prepare_latents at 1024x1024).
    const upstreamInputName = inputBySource.get(receipt.source) ?? fieldId;
    const stateOwnerPaths = reviewedCallerInputOwnersV2(placements, upstreamInputName)?.map(({ placement }) =>
      pathKey(placement.path),
    );
    const mirrorPaths = [
      ...(exact.controlMirrorPlacementPathsBySource?.[receipt.source] ?? []),
      ...placements
        .filter(
          ({ placement, block }) =>
            pathKey(placement.path) !== pathKey(target.placement.path) &&
            block.inputs.some(({ name }) => name === upstreamInputName),
        )
        .map(({ placement }) => pathKey(placement.path)),
    ]
      .filter((path, index, values) => values.indexOf(path) === index)
      .filter((mirrorPath) => mirrorPath !== pathKey(target.placement.path))
      .filter((mirrorPath) => !stateOwnerPaths || stateOwnerPaths.includes(mirrorPath))
      .filter((mirrorPath) => {
        const owner = mutableBindingOwnerByTarget.get(`${mirrorPath}\0${fieldId}`);
        if (owner && owner !== sourceKey) return false;
        const existing = binding(paramsByPath.get(mirrorPath)?.[fieldId]?.fieldOptions);
        return !existing || `${existing.persistence}\0${existing.source}` === sourceKey;
      });
    if (!mirrorPaths.length) return;
    const primaryRole = semanticRoleByPath.get(pathKey(target.placement.path))!;
    const mirrors = mirrorPaths.map((mirrorPath) => {
      const mirrorTarget = placements.find(({ placement }) => pathKey(placement.path) === mirrorPath);
      if (!mirrorTarget) invalid(`control ${receipt.source} targets missing mirror placement ${mirrorPath}.`);
      const mirrorRole = semanticRoleByPath.get(mirrorPath)!;
      const targetParams = paramsByPath.get(mirrorPath)!;
      if (!mirrorTarget.block.inputs.some(({ name }) => name === upstreamInputName))
        invalid(`control ${receipt.source} targets non-input ${mirrorRole}.${fieldId}.`);
      // A projected leaf may already expose the upstream field using the
      // library default but without the Studio admission receipt. Replace that
      // editable field with the one authoritative caller-bound parameter so it
      // participates in the same V2 control instead of looking like an
      // unrelated local default.
      targetParams[fieldId] = clone(param);
      return { role: mirrorRole, fieldId };
    });
    derivedControlFanOuts.push({
      source: receipt.source,
      persistence: receipt.persistence,
      primary: { role: primaryRole, fieldId },
      mirrors: mirrors.sort((left, right) =>
        lexicalCompare(`${left.role}\0${left.fieldId}`, `${right.role}\0${right.fieldId}`),
      ),
    });
  });

  // Inputs not promoted by the admission remain editable only after expansion.
  // Their reviewed upstream defaults come from the library manifest; direct
  // torch.Generator injection remains replaced by MoDiff's bounded seed field.
  definition.inputs.forEach((field) => {
    if (field.name === 'generator') return;
    const target = targetForField(field.name);
    const params = paramsByPath.get(pathKey(target.placement.path))!;
    if (params[field.name]) return;
    const base = reviewedStepNodeData.params[field.name];
    if (!base) invalid(`backend reviewed-step action cannot represent upstream input ${field.name}.`);
    params[field.name] = {
      ...clone(base),
      hidden: false,
      default: clone(field.default),
      ...(field.description ? { description: field.description } : {}),
      required: field.required,
    };
  });

  // A later reviewed binding may legitimately own the same field name on a
  // selected leaf (for example an optional width/height control). Normalize
  // derived fan-outs from the final parameter map so we never publish a
  // mirror declaration for a field that is no longer bound to that source.
  const verifiedDerivedControlFanOuts = derivedControlFanOuts.flatMap((fanOut) => {
    const targets = placements.flatMap(({ placement }) => {
      const fieldId = fanOut.primary.fieldId;
      const projectedParam = paramsByPath.get(pathKey(placement.path))?.[fieldId];
      const receipt = binding(projectedParam?.fieldOptions);
      return projectedParam?.display !== 'output' &&
        receipt?.source === fanOut.source &&
        receipt.persistence === fanOut.persistence
        ? [{ role: semanticRoleByPath.get(pathKey(placement.path))!, fieldId }]
        : [];
    });
    if (targets.length < 2) return [];
    const requestedPrimaryKey = `${fanOut.primary.role}\0${fanOut.primary.fieldId}`;
    const primary = targets.find(({ role, fieldId }) => `${role}\0${fieldId}` === requestedPrimaryKey) ?? targets[0]!;
    const primaryKey = `${primary.role}\0${primary.fieldId}`;
    return [
      {
        source: fanOut.source,
        persistence: fanOut.persistence,
        primary,
        mirrors: targets
          .filter(({ role, fieldId }) => `${role}\0${fieldId}` !== primaryKey)
          .sort((left, right) => lexicalCompare(`${left.role}\0${left.fieldId}`, `${right.role}\0${right.fieldId}`)),
      },
    ];
  });

  // Coarse route fan-outs remain authoritative for infrastructure fields
  // (such as an exporter FPS). Remap only their replaced execution roles to
  // the exact reviewed field owner, deduplicating aliases that now name the
  // same consumer (notably one seed/Generator initialization).
  const routeControlFanOuts = (route.controlFanOuts ?? []).flatMap((fanOut) => {
    const targets = [fanOut.primary, ...fanOut.mirrors]
      .map((target) => {
        if (!placementForSourceRole.has(target.role)) return target;
        const owner = targetForField(target.fieldId, fanOut.source, target.role);
        return { role: semanticRoleByPath.get(pathKey(owner.placement.path))!, fieldId: target.fieldId };
      })
      .filter(
        (target, index, values) =>
          values.findIndex((candidate) => candidate.role === target.role && candidate.fieldId === target.fieldId) ===
          index,
      );
    return targets.length > 1 ? [{ ...fanOut, primary: targets[0]!, mirrors: targets.slice(1) }] : [];
  });

  const structuralRuntime = (hierarchy?.structuralPlacements ?? []).map(({ placement, block }) => {
    const role = `container:${pathKey(placement.path)}`;
    return {
      role,
      node: {
        id: exactNodeId(source.instanceId, role),
        type: 'group' as const,
        parentId: source.instanceId,
        position: { x: GRID_LEFT, y: GRID_TOP },
        width: NODE_WIDTH,
        height: 72,
        data: {
          type: 'group' as const,
          label: humanClassName(block.className),
          category: 'Modular Diffusers Blocks',
          module: '',
          action: '',
          params: {},
          description:
            block.description || `${block.kind} container from ${definition.blocksClass}.${definition.workflowId}.`,
          resizable: true,
          huggingFaceClusterRole: 'execution' as const,
          huggingFaceClusterInstanceId: source.instanceId,
          huggingFaceClusterExecutionAdmissionId: source.admissionId,
          huggingFaceClusterExecutionSpecId: source.studioExecutionSpec.id,
          huggingFaceClusterExecutionRole: role,
        },
      } satisfies CustomNodeType,
    };
  });

  const preservedRuntime = source.nodes.flatMap((node) => {
    const role = node.data.huggingFaceClusterExecutionRole;
    // Re-finalization may receive a skeleton produced by an older exact
    // compiler. Coarse witness nodes (loaders, external inputs, previews and
    // exports) remain source-owned and are eligible for preservation; prior
    // exact ReviewedModularWorkflowStep/container nodes are not. Keeping every
    // unmatched exact role resurrects
    // obsolete/skipped upstream placements as disconnected nodes when a
    // Conditional/Auto selection changes (or when an old workflow refreshes).
    return role && !placementForSourceRole.has(role) && !sourceRoleIsOldExactPlacement(role)
      ? [{ role, node: clone(node) }]
      : [];
  });
  const orderedRuntime: Array<{ role: string; node: CustomNodeType }> = [
    ...preservedRuntime,
    ...structuralRuntime,
    ...placements.map(({ placement, block }) => {
      const key = pathKey(placement.path);
      const role = semanticRoleByPath.get(key)!;
      const index = placements.findIndex((candidate) => candidate.placement === placement) + 1;
      return {
        role,
        node: {
          id: exactNodeId(source.instanceId, role),
          type: 'custom' as const,
          parentId: source.instanceId,
          position: {
            x: GRID_LEFT + (index % GRID_COLUMNS) * GRID_X,
            y: GRID_TOP,
          },
          width: NODE_WIDTH,
          height: 176,
          data: {
            ...clone(reviewedStepNodeData),
            type: 'custom' as const,
            label: humanClassName(block.className),
            category: 'Modular Diffusers Blocks',
            description:
              block.description ||
              `${block.className} from ${definition.blocksClass}.${definition.workflowId}. Required components: ${
                block.components.map(({ name }) => name).join(', ') || 'none'
              }.`,
            params: paramsByPath.get(key)!,
            resizable: true,
            skipParamsCheck: true,
            huggingFaceClusterRole: 'execution' as const,
            huggingFaceClusterInstanceId: source.instanceId,
            huggingFaceClusterExecutionAdmissionId: source.admissionId,
            huggingFaceClusterExecutionSpecId: source.studioExecutionSpec.id,
            huggingFaceClusterExecutionRole: role,
          },
        } satisfies CustomNodeType,
      };
    }),
  ];

  const modelNode = orderedRuntime.find(({ role }) => role === 'models')!.node;
  modelNode.data.label = `Load ${definition.label.replace(/\s*[—-].*$/u, '')} Components`;
  modelNode.data.description = route.reviewedArtifacts?.length
    ? `Loads one selected immutable reviewed component set for ${definition.pipelineClass} / ` +
      `${definition.blocksClass}.${definition.workflowId}. The registered default is ` +
      `${route.artifact.repo}@${route.artifact.revision}.`
    : `Loads the pinned ${route.artifact.repo}@${route.artifact.revision} component set for ` +
      `${definition.pipelineClass} / ${definition.blocksClass}.${definition.workflowId}.`;
  const reviewedWorkflow = modelNode.data.params.workflow_id;
  if (!reviewedWorkflow) invalid('the Models Loader has no reviewed workflow identity field.');
  modelNode.data.params.workflow_id = {
    ...reviewedWorkflow,
    value: definition.workflowId,
    hidden: true,
  };
  const reviewedVariant = modelNode.data.params.reviewed_variant;
  const reviewedArtifacts = route.reviewedArtifacts ?? [route.artifact];
  const reviewedRepositories = reviewedArtifacts.map(({ repo }) => repo);
  if (new Set(reviewedRepositories).size !== reviewedRepositories.length)
    invalid('the reviewed model-variant set contains duplicate repositories.');
  if (!reviewedRepositories.includes(route.artifact.repo))
    invalid('the registered default artifact is absent from the reviewed model-variant set.');
  if (route.reviewedArtifacts?.length && !reviewedVariant)
    invalid('the Models Loader has no reviewed model-variant field.');
  if (reviewedVariant) {
    modelNode.data.params.reviewed_variant = {
      ...reviewedVariant,
      value: route.artifact.repo,
      default: route.artifact.repo,
      options: reviewedRepositories,
      hidden: reviewedRepositories.length < 2,
      fieldOptions: {
        ...(reviewedVariant.fieldOptions ?? {}),
        controlTier: 'essential',
      },
    };
  }
  modelNode.position = { x: GRID_LEFT, y: GRID_TOP };
  modelNode.width = NODE_WIDTH;
  modelNode.height = 400;

  preservedRuntime.forEach(({ role, node }, index) => {
    if (role === 'models') return;
    node.position = {
      x: GRID_LEFT + ((placements.length + index + 1) % GRID_COLUMNS) * GRID_X,
      y: GRID_TOP,
    };
    node.width = NODE_WIDTH;
    node.height = reviewedModularNodeDefaultSizeV2(node, role).height;
  });

  const edges: Edge[] = [];
  const topRoles = topLevel.map(({ placement }) => semanticRoleByPath.get(pathKey(placement.path))!);
  if (!topRoles.length) invalid('the reviewed workflow has no executable top-level block.');
  edges.push(exactEdge(source.instanceId, 'models', 'pipeline_components', topRoles[0]!, 'pipeline_components'));
  topRoles
    .slice(1)
    .forEach((role, index) =>
      edges.push(exactEdge(source.instanceId, topRoles[index]!, 'state_out', role, 'state_in')),
    );
  placements
    .filter(({ placement, block }) => placement.path.length === 1 && block.kind === 'loop')
    .forEach(({ placement }) => {
      const ownerKey = pathKey(placement.path);
      const ownerRole = semanticRoleByPath.get(ownerKey)!;
      const members = placements
        .filter(
          ({ placement: candidate }) =>
            candidate.path.length === placement.path.length + 1 &&
            placement.path.every((segment, index) => candidate.path[index] === segment),
        )
        .sort((left, right) => left.placement.order - right.placement.order)
        .map(({ placement: candidate }) => semanticRoleByPath.get(pathKey(candidate.path))!);
      if (!members.length) invalid(`loop ${ownerKey} has no reviewed members.`);
      members
        .slice(1)
        .forEach((role, index) =>
          edges.push(exactEdge(source.instanceId, members[index]!, 'loop_members', role, 'loop_members_in')),
        );
      edges.push(
        exactEdge(source.instanceId, members[members.length - 1]!, 'loop_members', ownerRole, 'loop_members_in'),
      );
    });

  const sourceRoleByNodeId = new Map(source.nodes.map((node) => [node.id, node.data.huggingFaceClusterExecutionRole!]));
  const preservedRoles = new Set(preservedRuntime.map(({ role }) => role));
  const materializedEdgeKeys = new Set<string>();
  const pushExactEdge = (sourceRole: string, sourceHandle: string, targetRole: string, targetHandle: string) => {
    const key = `${sourceRole}\0${sourceHandle}\0${targetRole}\0${targetHandle}`;
    if (materializedEdgeKeys.has(key)) return;
    materializedEdgeKeys.add(key);
    edges.push(exactEdge(source.instanceId, sourceRole, sourceHandle, targetRole, targetHandle));
  };
  edges.forEach((edge) => {
    const sourceRole =
      sourceRoleByNodeId.get(edge.source) ?? orderedRuntime.find(({ node }) => node.id === edge.source)?.role;
    const targetRole =
      sourceRoleByNodeId.get(edge.target) ?? orderedRuntime.find(({ node }) => node.id === edge.target)?.role;
    if (sourceRole && targetRole && edge.sourceHandle && edge.targetHandle)
      materializedEdgeKeys.add(`${sourceRole}\0${edge.sourceHandle}\0${targetRole}\0${edge.targetHandle}`);
  });
  source.edges.forEach((edge) => {
    const sourceRole = sourceRoleByNodeId.get(edge.source);
    const targetRole = sourceRoleByNodeId.get(edge.target);
    if (!sourceRole || !targetRole || !edge.sourceHandle || !edge.targetHandle)
      invalid(`admitted Studio edge ${edge.id} has an invalid endpoint.`);
    const targetHandle = edge.targetHandle;
    const mappedSource = placementForSourceRole.get(sourceRole);
    const mappedTarget = placementForSourceRole.get(targetRole);
    if (mappedSource && mappedTarget) return;
    // Edges involving a previously finalized exact placement are rebuilt from
    // the current pinned hierarchy below. Retaining them would either revive a
    // now-skipped branch or make an old semantic role an unowned endpoint.
    if (
      (!mappedSource && sourceRoleIsOldExactPlacement(sourceRole)) ||
      (!mappedTarget && sourceRoleIsOldExactPlacement(targetRole))
    )
      return;
    // The exact state chain replaces component fan-out from the Models Loader.
    if (sourceRole === 'models' && mappedTarget) return;
    const exactSourceTarget = mappedSource ? exactOutputTarget(sourceRole, edge.sourceHandle) : null;
    const nextSourceRole = exactSourceTarget
      ? semanticRoleByPath.get(pathKey(exactSourceTarget.target.placement.path))!
      : sourceRole;
    const nextSourceHandle = exactSourceTarget?.fieldId ?? edge.sourceHandle;
    const nextTargetRole = mappedTarget ? semanticRoleByPath.get(pathKey(mappedTarget.placement.path))! : targetRole;
    if (mappedTarget) {
      const params = paramsByPath.get(pathKey(mappedTarget.placement.path))!;
      if (!params[targetHandle]) {
        const original = sourceByRole.get(targetRole)?.data.params[targetHandle];
        if (!original) invalid(`admitted Studio edge ${edge.id} targets an unavailable exact input.`);
        params[targetHandle] = { ...clone(original), display: 'input', hidden: false };
      }
    }
    if ((!mappedSource && !preservedRoles.has(sourceRole)) || (!mappedTarget && !preservedRoles.has(targetRole)))
      invalid(`admitted Studio edge ${edge.id} crosses an unowned execution node.`);
    pushExactEdge(nextSourceRole, nextSourceHandle, nextTargetRole, targetHandle);

    // ModularPipeline call inputs live in one shared PipelineState. Once the
    // reviewed hierarchy is decomposed into separately scheduled canvas
    // leaves, every active leaf that declares the same externally-produced
    // socket must receive that value before it executes. The coarse Studio
    // witness may name only representative owners (for example Qwen Edit's
    // text encoder and VAE encoder), while an earlier nested resize leaf also
    // consumes `image`. Fan the immutable external edge out across the
    // selected active hierarchy; inactive Conditional/Auto branches are not
    // present in `placements` and therefore cannot receive an edge.
    if (!mappedSource && mappedTarget) {
      placements
        .filter(({ placement, block }) => {
          if (placement === mappedTarget.placement) return false;
          return block.inputs.some(({ name }) => name === targetHandle);
        })
        .forEach((candidate) => {
          const candidateRole = semanticRoleByPath.get(pathKey(candidate.placement.path))!;
          const candidateParams = paramsByPath.get(pathKey(candidate.placement.path))!;
          if (!candidateParams[targetHandle]) {
            const base = reviewedStepNodeData.params[targetHandle];
            if (!base) invalid(`backend reviewed-step action cannot represent exact input ${targetHandle}.`);
            const input = candidate.block.inputs.find(({ name }) => name === targetHandle)!;
            candidateParams[targetHandle] = {
              ...clone(base),
              display: 'input',
              hidden: false,
              required: input.required,
              ...(input.description ? { description: input.description } : {}),
            };
          }
          pushExactEdge(nextSourceRole, nextSourceHandle, candidateRole, targetHandle);
        });
    }
  });

  const allComponents = [
    ...new Set(placements.flatMap(({ block }) => block.components.map(({ name }) => name))),
  ].sort();
  const metadataBySemanticRole = new Map<string, BlockGraphNodeModularDiffusersV2>();
  preservedRuntime.forEach(({ role }) => {
    metadataBySemanticRole.set(role, {
      kind: 'infrastructure',
      pipelineClass: definition.pipelineClass,
      blocksClass: definition.blocksClass,
      workflowId: definition.workflowId,
      libraryRevision: definition.libraryRevision,
      runtimeRole: role,
      ...(role === 'models' ? { componentNames: allComponents } : {}),
    });
  });
  placements.forEach(({ placement, block }) => {
    const role = semanticRoleByPath.get(pathKey(placement.path))!;
    const visualPlacement = hierarchy?.fullPlacementBySelectedPath.get(pathKey(placement.path)) ?? placement;
    metadataBySemanticRole.set(role, {
      kind: 'upstream_block',
      pipelineClass: definition.pipelineClass,
      blocksClass: definition.blocksClass!,
      workflowId: definition.workflowId,
      libraryRevision: definition.libraryRevision,
      runtimeRole: role,
      blockDefinitionId: block.id,
      blockClass: block.className,
      blockKind: block.kind,
      blockContractHash: block.contentHash,
      placementPath: [...visualPlacement.path],
      ...(visualPlacement.path.length > 1 ? { parentPlacementPath: visualPlacement.path.slice(0, -1) } : {}),
      componentNames: block.components.map(({ name }) => name).sort(),
    });
  });
  (hierarchy?.structuralPlacements ?? []).forEach(({ placement, block }) => {
    const role = `container:${pathKey(placement.path)}`;
    metadataBySemanticRole.set(role, {
      kind: 'upstream_block',
      pipelineClass: definition.pipelineClass,
      blocksClass: definition.blocksClass!,
      workflowId: definition.workflowId,
      libraryRevision: definition.libraryRevision,
      runtimeRole: role,
      blockDefinitionId: block.id,
      blockClass: block.className,
      blockKind: block.kind,
      blockContractHash: block.contentHash,
      placementPath: [...placement.path],
      ...(placement.path.length > 1 ? { parentPlacementPath: placement.path.slice(0, -1) } : {}),
      componentNames: block.components.map(({ name }) => name).sort(),
    });
  });

  applyCompactReviewedLayout(
    orderedRuntime.map((item) => ({
      ...item,
      metadata: metadataBySemanticRole.get(item.role),
    })),
  );

  return {
    skeleton: {
      ...source,
      nodes: orderedRuntime.map(({ role, node }) => ({
        ...node,
        id: exactNodeId(source.instanceId, role),
        parentId: source.instanceId,
        data: { ...node.data, huggingFaceClusterExecutionRole: role },
      })),
      edges,
      nodeIdsByRole: Object.fromEntries(
        orderedRuntime.map(({ role }) => [role, exactNodeId(source.instanceId, role)]),
      ) as HuggingFaceClusterExecutionSkeleton['nodeIdsByRole'],
    },
    metadataBySemanticRole,
    ...(boundaryInputs ? { boundaryInputs } : {}),
    boundaryOutputs,
    ...(verifiedDerivedControlFanOuts.length ? { controlFanOuts: verifiedDerivedControlFanOuts } : {}),
    routeControlFanOuts,
  };
}
import { addReviewedValuePortsV2 } from './reviewedValuePortsV2';
