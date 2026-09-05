import {
  parseHuggingFaceNodeLibraryBlockDefinition,
  type HuggingFaceNodeLibraryBlockDefinition,
  type HuggingFaceNodeLibraryBlockPlacement,
} from './huggingFaceNodeLibrary';
import {
  huggingFaceClusterChildSemanticId,
  huggingFaceClusterParameterProjection,
  validateHuggingFaceClusterInstance,
  type HuggingFaceClusterHierarchyNode,
  type HuggingFaceClusterInstance,
} from './huggingFaceClusterInstance';
import type { HuggingFaceNodeLibraryDefinition } from './huggingFaceNodeLibrary';

export type HuggingFaceModularConditionalSelection = {
  presentInputs: string[];
  selectedBlockName: string | null;
  error: string | null;
};

export type HuggingFaceModularConditional = {
  path: string[];
  legacyPath: string;
  blockDefinitionId: string;
  strategy: 'auto' | 'presence';
  branchNames: string[];
  triggerInputs: Array<string | null>;
  defaultBlockName: string | null;
  selectionTable: HuggingFaceModularConditionalSelection[];
};

export type HuggingFaceModularConditionalPlacement = HuggingFaceNodeLibraryBlockPlacement & {
  intermediateOutputs: string[];
};

export type HuggingFaceModularWorkflowSelection = {
  path: string[];
  legacyPath: string;
  selectedBlockName: string | null;
};

export type HuggingFaceModularWorkflowCase = {
  presentInputs: string[];
  activeLeafPaths: string[][];
  activeLeafDefinitionIds: string[];
  selections: HuggingFaceModularWorkflowSelection[];
};

export type HuggingFaceModularWorkflow = {
  id: string;
  cases: HuggingFaceModularWorkflowCase[];
};

export type HuggingFaceModularConditionalPipeline = {
  schemaVersion: 1;
  pipelineClass: string;
  rootBlockDefinitionId: string;
  placements: HuggingFaceModularConditionalPlacement[];
  conditionals: HuggingFaceModularConditional[];
  workflows: HuggingFaceModularWorkflow[];
  contentHash: string;
};

export type HuggingFaceModularConditionalSnapshot = {
  schemaVersion: 1;
  diffusersRevision: string;
  blockDefinitions: HuggingFaceNodeLibraryBlockDefinition[];
  pipelines: HuggingFaceModularConditionalPipeline[];
};

export type HuggingFaceModularBranchProjection = {
  pipeline: HuggingFaceModularConditionalPipeline;
  activePaths: Set<string>;
  inactivePaths: Set<string>;
  selectors: Map<
    string,
    {
      selectedBlockName: string | null;
      error: string | null;
      triggerInputs: string[];
    }
  >;
};

const IMMUTABLE_REVISION = /^[0-9a-f]{40}$/u;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/u;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/u;
const BLOCK_DEFINITION_ID = /^diffusers\.modular-block:[A-Za-z_][A-Za-z0-9_]{0,255}:sha256:[0-9a-f]{64}$/u;
const MAX_PIPELINES = 128;
const MAX_BLOCK_DEFINITIONS = 2048;
const MAX_PLACEMENTS = 4096;
const MAX_CONDITIONALS = 512;
const MAX_WORKFLOWS = 256;
const MAX_CASES = 16;
const MAX_PATH_DEPTH = 64;

function invalid(): never {
  throw new Error('Invalid Modular Diffusers conditional contract.');
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function text(value: unknown, pattern = IDENTIFIER, maximum = 256): string {
  if (typeof value !== 'string' || !value || value.length > maximum || !pattern.test(value)) invalid();
  return value;
}

function optionalMessage(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value || value.length > 512) invalid();
  return value;
}

function uniqueStrings(value: unknown, maximum = 512): string[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  const parsed = value.map((item) => text(item));
  if (new Set(parsed).size !== parsed.length) invalid();
  return parsed;
}

function path(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PATH_DEPTH) invalid();
  return value.map((segment) => text(segment));
}

function pathKey(value: readonly string[]) {
  return value.join('/');
}

function samePath(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function blockClassFromDefinitionId(value: string) {
  const marker = ':sha256:';
  const markerIndex = value.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const classSeparator = value.lastIndexOf(':', markerIndex - 1);
  if (classSeparator < 0) return null;
  const className = value.slice(classSeparator + 1, markerIndex);
  return /^[A-Za-z_][A-Za-z0-9_]{0,255}$/u.test(className) ? className : null;
}

/**
 * Resolve an active branch placement back to its reviewed workflow placement.
 *
 * Auto blocks insert branch-container segments that do not exist in a selected
 * workflow returned by `get_workflow()`. Block-definition identity alone is not
 * enough because upstream legitimately reuses the same block class at multiple
 * paths (for example Wan's image-encoder and VAE-encoder resize steps). Remove
 * only branch segments declared by the immutable conditional contract, then
 * require one exact reviewed legacy-path match.
 */
export function reviewedConditionalParameterPlacement(
  item: HuggingFaceModularConditionalPlacement,
  conditionals: readonly HuggingFaceModularConditional[],
  candidates: readonly HuggingFaceNodeLibraryBlockPlacement[],
  definitions?: ReadonlyMap<string, HuggingFaceNodeLibraryBlockDefinition>,
): HuggingFaceNodeLibraryBlockPlacement | null {
  const exact = candidates.find(
    (candidate) =>
      candidate.blockDefinitionId === item.blockDefinitionId && pathKey(candidate.path) === pathKey(item.path),
  );
  if (exact) return exact;

  const originalSegments = item.legacyPath.split('.');
  const branchSegmentIndexes = conditionals.flatMap((conditional) => {
    const conditionalSegments = conditional.legacyPath.split('.');
    if (
      originalSegments.length <= conditionalSegments.length ||
      !samePath(originalSegments.slice(0, conditionalSegments.length), conditionalSegments) ||
      !conditional.branchNames.includes(originalSegments[conditionalSegments.length] ?? '')
    )
      return [];
    return [conditionalSegments.length];
  });
  const collapsedSegments = originalSegments.filter((_, index) => !branchSegmentIndexes.includes(index));
  const collapsedMatches = candidates.filter(
    (candidate) =>
      candidate.blockDefinitionId === item.blockDefinitionId &&
      samePath(candidate.legacyPath.split('.'), collapsedSegments),
  );
  if (collapsedMatches.length === 1) return collapsedMatches[0] ?? null;

  // Upstream can specialize the same configured step differently in an Auto
  // branch and in get_workflow(). Qwen inpaint, for example, marks
  // image_latents optional while resolving the Auto branch but required after
  // extracting the selected workflow. Those immutable contracts have distinct
  // content hashes even though the class and complete state/component shape
  // are otherwise the same. Map them only when the collapsed path is unique
  // and the reviewed definitions prove that structural equivalence.
  const activeDefinition = definitions?.get(item.blockDefinitionId);
  const blockShape = (block: HuggingFaceNodeLibraryBlockDefinition) =>
    JSON.stringify({
      schemaVersion: block.schemaVersion,
      className: block.className,
      kind: block.kind,
      inputs: block.inputs.map(({ name, type, kwargsType }) => ({ name, type, kwargsType })),
      variadicInputs: block.variadicInputs.map(({ kwargsType, type }) => ({ kwargsType, type })),
      outputs: block.outputs.map(({ name, type, kwargsType }) => ({ name, type, kwargsType })),
      components: block.components.map(({ name, type, creationMethod }) => ({ name, type, creationMethod })),
      configs: block.configs.map(({ name }) => name),
    });
  if (activeDefinition && definitions) {
    const collapsedShapeMatches = candidates.filter((candidate) => {
      if (!samePath(candidate.legacyPath.split('.'), collapsedSegments)) return false;
      const candidateDefinition = definitions.get(candidate.blockDefinitionId);
      return candidateDefinition ? blockShape(candidateDefinition) === blockShape(activeDefinition) : false;
    });
    if (collapsedShapeMatches.length === 1) return collapsedShapeMatches[0] ?? null;

    // get_workflow() may tighten required/default metadata after an Auto branch
    // is selected. Helios video-to-video, for example, changes image_latents
    // from optional to required without changing the upstream step class or its
    // semantic placement. The immutable workflow trace already proves which
    // branch is active, so a unique collapsed path plus the exact reviewed
    // class is sufficient identity. Never guess when more than one candidate
    // has the same path and class.
    const collapsedClassMatches = candidates.filter((candidate) => {
      if (!samePath(candidate.legacyPath.split('.'), collapsedSegments)) return false;
      return (
        (definitions.get(candidate.blockDefinitionId)?.className ??
          blockClassFromDefinitionId(candidate.blockDefinitionId)) === activeDefinition.className
      );
    });
    if (collapsedClassMatches.length === 1) return collapsedClassMatches[0] ?? null;
  }

  const identityMatches = candidates.filter((candidate) => candidate.blockDefinitionId === item.blockDefinitionId);
  return identityMatches.length === 1 ? (identityMatches[0] ?? null) : null;
}

function placement(
  value: unknown,
  definitions: ReadonlyMap<string, HuggingFaceNodeLibraryBlockDefinition>,
): HuggingFaceModularConditionalPlacement {
  if (!record(value) || !exactKeys(value, ['path', 'legacyPath', 'order', 'blockDefinitionId', 'intermediateOutputs']))
    invalid();
  const parsedPath = path(value.path);
  const legacyPath = text(value.legacyPath);
  const blockDefinitionId = text(value.blockDefinitionId, BLOCK_DEFINITION_ID, 384);
  const intermediateOutputs = uniqueStrings(value.intermediateOutputs);
  const definition = definitions.get(blockDefinitionId);
  if (!definition) invalid();
  if (legacyPath !== parsedPath.join('.') || !Number.isInteger(value.order) || (value.order as number) < 0) invalid();
  return { path: parsedPath, legacyPath, order: value.order as number, blockDefinitionId, intermediateOutputs };
}

function parseConditional(
  value: unknown,
  placements: ReadonlyMap<string, HuggingFaceModularConditionalPlacement>,
  definitions: ReadonlyMap<string, HuggingFaceNodeLibraryBlockDefinition>,
): HuggingFaceModularConditional {
  if (
    !record(value) ||
    !exactKeys(value, [
      'path',
      'legacyPath',
      'blockDefinitionId',
      'strategy',
      'branchNames',
      'triggerInputs',
      'defaultBlockName',
      'selectionTable',
    ]) ||
    (value.strategy !== 'auto' && value.strategy !== 'presence')
  )
    invalid();
  const parsedPath = path(value.path);
  const key = pathKey(parsedPath);
  const legacyPath = text(value.legacyPath);
  const blockDefinitionId = text(value.blockDefinitionId, BLOCK_DEFINITION_ID, 384);
  const definition = definitions.get(blockDefinitionId);
  if (
    legacyPath !== parsedPath.join('.') ||
    placements.get(key)?.blockDefinitionId !== blockDefinitionId ||
    !definition ||
    (definition.kind !== 'auto' && definition.kind !== 'conditional')
  )
    invalid();
  const branchNames = uniqueStrings(value.branchNames, 64);
  if (!branchNames.length) invalid();
  const triggerInputs = Array.isArray(value.triggerInputs)
    ? value.triggerInputs.map((item) => (item === null ? null : text(item)))
    : invalid();
  if (triggerInputs.length > 8) invalid();
  const triggerNames = triggerInputs.filter((item): item is string => item !== null);
  if (new Set(triggerNames).size !== triggerNames.length) invalid();
  const defaultBlockName = value.defaultBlockName === null ? null : text(value.defaultBlockName);
  if (defaultBlockName !== null && !branchNames.includes(defaultBlockName)) invalid();
  if (!Array.isArray(value.selectionTable) || value.selectionTable.length !== 2 ** triggerNames.length) invalid();
  const seenCases = new Set<string>();
  const selectionTable = value.selectionTable.map((item) => {
    if (!record(item) || !exactKeys(item, ['presentInputs', 'selectedBlockName', 'error'])) invalid();
    const presentInputs = uniqueStrings(item.presentInputs, 8);
    if (presentInputs.some((name) => !triggerNames.includes(name))) invalid();
    const selectedBlockName = item.selectedBlockName === null ? null : text(item.selectedBlockName);
    const error = optionalMessage(item.error);
    if ((selectedBlockName !== null && !branchNames.includes(selectedBlockName)) || (error && selectedBlockName))
      invalid();
    const caseKey = triggerNames.filter((name) => presentInputs.includes(name)).join('\0');
    if (seenCases.has(caseKey)) invalid();
    seenCases.add(caseKey);
    return { presentInputs, selectedBlockName, error };
  });
  for (let mask = 0; mask < 2 ** triggerNames.length; mask += 1) {
    const expected = triggerNames.filter((_name, index) => Boolean(mask & (1 << index))).join('\0');
    if (!seenCases.has(expected)) invalid();
  }
  branchNames.forEach((branch) => {
    if (!placements.has(pathKey([...parsedPath, branch]))) invalid();
  });
  return {
    path: parsedPath,
    legacyPath,
    blockDefinitionId,
    strategy: value.strategy,
    branchNames,
    triggerInputs,
    defaultBlockName,
    selectionTable,
  };
}

function pipeline(
  value: unknown,
  definitions: ReadonlyMap<string, HuggingFaceNodeLibraryBlockDefinition>,
): HuggingFaceModularConditionalPipeline {
  if (
    !record(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'pipelineClass',
      'rootBlockDefinitionId',
      'placements',
      'conditionals',
      'workflows',
      'contentHash',
    ]) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.placements) ||
    !value.placements.length ||
    value.placements.length > MAX_PLACEMENTS ||
    !Array.isArray(value.conditionals) ||
    value.conditionals.length > MAX_CONDITIONALS ||
    !Array.isArray(value.workflows) ||
    !value.workflows.length ||
    value.workflows.length > MAX_WORKFLOWS
  )
    invalid();
  const pipelineClass = text(value.pipelineClass);
  const rootBlockDefinitionId = text(value.rootBlockDefinitionId, BLOCK_DEFINITION_ID, 384);
  if (!definitions.has(rootBlockDefinitionId)) invalid();
  const placements = value.placements.map((item) => placement(item, definitions));
  const placementsByPath = new Map(placements.map((item) => [pathKey(item.path), item]));
  if (placementsByPath.size !== placements.length) invalid();
  const orders = new Map<string, number[]>();
  placements.forEach((item) => {
    const parent = pathKey(item.path.slice(0, -1));
    if (item.path.length > 1 && !placementsByPath.has(parent)) invalid();
    orders.set(parent, [...(orders.get(parent) ?? []), item.order]);
  });
  orders.forEach((items) => {
    if ([...items].sort((left, right) => left - right).some((item, index) => item !== index)) invalid();
  });
  const conditionals = value.conditionals.map((item) => parseConditional(item, placementsByPath, definitions));
  if (new Set(conditionals.map((item) => pathKey(item.path))).size !== conditionals.length) invalid();
  const workflowIds = new Set<string>();
  const workflows = value.workflows.map((item): HuggingFaceModularWorkflow => {
    if (!record(item) || !exactKeys(item, ['id', 'cases']) || !Array.isArray(item.cases) || !item.cases.length)
      invalid();
    const id = text(item.id);
    if (workflowIds.has(id) || item.cases.length > MAX_CASES) invalid();
    workflowIds.add(id);
    const cases = item.cases.map((candidate): HuggingFaceModularWorkflowCase => {
      if (
        !record(candidate) ||
        !exactKeys(candidate, ['presentInputs', 'activeLeafPaths', 'activeLeafDefinitionIds', 'selections']) ||
        !Array.isArray(candidate.activeLeafPaths) ||
        !Array.isArray(candidate.activeLeafDefinitionIds) ||
        candidate.activeLeafPaths.length !== candidate.activeLeafDefinitionIds.length ||
        !Array.isArray(candidate.selections)
      )
        invalid();
      const presentInputs = uniqueStrings(candidate.presentInputs, 64);
      const activeLeafPaths = candidate.activeLeafPaths.map(path);
      const activeLeafDefinitionIds = candidate.activeLeafDefinitionIds.map((definitionId) =>
        text(definitionId, BLOCK_DEFINITION_ID, 384),
      );
      if (
        new Set(activeLeafPaths.map(pathKey)).size !== activeLeafPaths.length ||
        activeLeafPaths.some((leafPath, index) => {
          const placed = placementsByPath.get(pathKey(leafPath));
          return !placed || placed.blockDefinitionId !== activeLeafDefinitionIds[index];
        })
      )
        invalid();
      const selections = candidate.selections.map((selection): HuggingFaceModularWorkflowSelection => {
        if (!record(selection) || !exactKeys(selection, ['path', 'legacyPath', 'selectedBlockName'])) invalid();
        const selectionPath = path(selection.path);
        const legacyPath = text(selection.legacyPath);
        const selectedBlockName = selection.selectedBlockName === null ? null : text(selection.selectedBlockName);
        const conditional = conditionals.find((item) => pathKey(item.path) === pathKey(selectionPath));
        if (
          legacyPath !== selectionPath.join('.') ||
          !conditional ||
          (selectedBlockName !== null && !conditional.branchNames.includes(selectedBlockName))
        )
          invalid();
        return { path: selectionPath, legacyPath, selectedBlockName };
      });
      if (new Set(selections.map(({ path: selectionPath }) => pathKey(selectionPath))).size !== selections.length)
        invalid();
      return { presentInputs, activeLeafPaths, activeLeafDefinitionIds, selections };
    });
    return { id, cases };
  });
  return {
    schemaVersion: 1,
    pipelineClass,
    rootBlockDefinitionId,
    placements,
    conditionals,
    workflows,
    contentHash: text(value.contentHash, CONTENT_HASH, 71),
  };
}

export function parseHuggingFaceModularConditionalSnapshot(value: unknown): HuggingFaceModularConditionalSnapshot {
  if (
    !record(value) ||
    !exactKeys(value, ['schemaVersion', 'diffusersRevision', 'blockDefinitions', 'pipelines']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.blockDefinitions) ||
    !value.blockDefinitions.length ||
    value.blockDefinitions.length > MAX_BLOCK_DEFINITIONS ||
    !Array.isArray(value.pipelines) ||
    !value.pipelines.length ||
    value.pipelines.length > MAX_PIPELINES
  )
    invalid();
  const diffusersRevision = text(value.diffusersRevision, IMMUTABLE_REVISION, 40);
  let blockDefinitions: HuggingFaceNodeLibraryBlockDefinition[];
  try {
    blockDefinitions = value.blockDefinitions.map(parseHuggingFaceNodeLibraryBlockDefinition);
  } catch {
    invalid();
  }
  if (blockDefinitions.some((definition) => definition.provider !== 'diffusers')) invalid();
  const definitionsById = new Map(blockDefinitions.map((item) => [item.id, item]));
  if (definitionsById.size !== blockDefinitions.length) invalid();
  const pipelines = value.pipelines.map((item) => pipeline(item, definitionsById));
  if (new Set(pipelines.map((item) => item.pipelineClass)).size !== pipelines.length) invalid();
  return { schemaVersion: 1, diffusersRevision, blockDefinitions, pipelines };
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined;
}

function startsWithPath(path: string, parent: string) {
  return path === parent || path.startsWith(`${parent}/`);
}

/** Resolve the reviewed truth tables with the same presence propagation as upstream get_execution_blocks(). */
export function projectHuggingFaceModularBranches(
  snapshot: HuggingFaceModularConditionalSnapshot,
  pipelineClass: string,
  effectiveInputs: Readonly<Record<string, unknown>>,
): HuggingFaceModularBranchProjection | null {
  const pipeline = snapshot.pipelines.find((item) => item.pipelineClass === pipelineClass);
  if (!pipeline) return null;
  const definitions = new Map(snapshot.blockDefinitions.map((item) => [item.id, item]));
  const placements = new Map(pipeline.placements.map((item) => [pathKey(item.path), item]));
  const children = new Map<string, HuggingFaceModularConditionalPlacement[]>();
  pipeline.placements.forEach((item) => {
    const parent = pathKey(item.path.slice(0, -1));
    children.set(parent, [...(children.get(parent) ?? []), item]);
  });
  children.forEach((items) => items.sort((left, right) => left.order - right.order));
  const conditionals = new Map(pipeline.conditionals.map((item) => [pathKey(item.path), item]));
  const activeInputs = new Set(
    Object.entries(effectiveInputs).flatMap(([name, value]) => (hasValue(value) ? [name] : [])),
  );
  const activePaths = new Set<string>();
  const inactivePaths = new Set<string>();
  const selectors: HuggingFaceModularBranchProjection['selectors'] = new Map();

  const markInactive = (key: string) => {
    pipeline.placements.forEach((item) => {
      const candidate = pathKey(item.path);
      if (startsWithPath(candidate, key)) inactivePaths.add(candidate);
    });
  };
  const visit = (item: HuggingFaceModularConditionalPlacement) => {
    const key = pathKey(item.path);
    activePaths.add(key);
    const conditional = conditionals.get(key);
    if (conditional) {
      const triggerNames = conditional.triggerInputs.filter((name): name is string => name !== null);
      const presentInputs = triggerNames.filter((name) => activeInputs.has(name));
      const selection = conditional.selectionTable.find(
        (candidate) =>
          candidate.presentInputs.length === presentInputs.length &&
          triggerNames.every((name) => candidate.presentInputs.includes(name) === presentInputs.includes(name)),
      );
      if (!selection) invalid();
      selectors.set(key, {
        selectedBlockName: selection.selectedBlockName,
        error: selection.error,
        triggerInputs: triggerNames,
      });
      conditional.branchNames.forEach((branchName) => {
        const branchKey = pathKey([...item.path, branchName]);
        if (branchName === selection.selectedBlockName) {
          const branch = placements.get(branchKey);
          if (!branch) invalid();
          visit(branch);
        } else markInactive(branchKey);
      });
      return;
    }
    const definition = definitions.get(item.blockDefinitionId);
    if (!definition) invalid();
    const nested = children.get(key) ?? [];
    if (nested.length && definition.kind !== 'loop') nested.forEach(visit);
    else item.intermediateOutputs.forEach((name) => activeInputs.add(name));
  };
  (children.get('') ?? []).forEach(visit);
  return { pipeline, activePaths, inactivePaths, selectors };
}

function words(value: string) {
  return value
    .replace(/Step$/u, '')
    .replace(/Blocks?$/u, '')
    .replace(/[_-]/gu, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function huggingFaceModularConditionalHierarchy(
  snapshot: HuggingFaceModularConditionalSnapshot,
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
  additionalInputs: Readonly<Record<string, unknown>> = {},
): HuggingFaceClusterHierarchyNode[] | null {
  if (definition.provider !== 'diffusers' || definition.libraryRevision !== snapshot.diffusersRevision) return null;
  const normalized = validateHuggingFaceClusterInstance(instance, definition);
  const effectiveInputs = Object.fromEntries(
    huggingFaceClusterParameterProjection(normalized, definition).map((field) => [field.name, field.value]),
  );
  Object.assign(effectiveInputs, additionalInputs);
  const projection = projectHuggingFaceModularBranches(snapshot, definition.pipelineClass, effectiveInputs);
  if (!projection) return null;
  const definitions = new Map(snapshot.blockDefinitions.map((item) => [item.id, item]));
  const conditionals = new Map(projection.pipeline.conditionals.map((item) => [pathKey(item.path), item]));
  const nodes = new Map<string, HuggingFaceClusterHierarchyNode>();
  projection.pipeline.placements.forEach((item) => {
    const key = pathKey(item.path);
    const block = definitions.get(item.blockDefinitionId);
    if (!block) invalid();
    const selector = projection.selectors.get(key);
    const parentKey = pathKey(item.path.slice(0, -1));
    const parentConditional = conditionals.get(parentKey);
    const branch = parentConditional?.branchNames.includes(item.path[item.path.length - 1] ?? '') ?? false;
    const parameterPlacement =
      projection.inactivePaths.has(key) || selector
        ? null
        : reviewedConditionalParameterPlacement(
            item,
            projection.pipeline.conditionals,
            definition.blockPlacements,
            definitions,
          );
    nodes.set(key, {
      path: key,
      pathSegments: item.path,
      legacyPath: item.legacyPath,
      semanticId: huggingFaceClusterChildSemanticId(normalized.instanceId, key),
      parameterPath: parameterPlacement ? pathKey(parameterPlacement.path) : undefined,
      label: words(block.className),
      className: block.className,
      kind: block.kind,
      implicit: false,
      conditionalRole: selector ? 'selector' : branch ? 'branch' : undefined,
      conditionalStatus: selector
        ? selector.error
          ? 'error'
          : selector.selectedBlockName === null
            ? 'skipped'
            : 'active'
        : projection.inactivePaths.has(key)
          ? 'inactive'
          : projection.activePaths.has(key)
            ? 'active'
            : undefined,
      selectedBlockName: selector?.selectedBlockName,
      triggerInputs: selector?.triggerInputs,
      children: [],
    });
  });
  const roots: HuggingFaceClusterHierarchyNode[] = [];
  projection.pipeline.placements.forEach((item) => {
    const key = pathKey(item.path);
    const node = nodes.get(key);
    if (!node) invalid();
    const parent = item.path.length > 1 ? nodes.get(pathKey(item.path.slice(0, -1))) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}
