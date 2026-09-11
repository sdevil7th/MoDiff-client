import type {
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryExecutionAdmission,
  HuggingFaceNodeLibraryField,
} from './huggingFaceNodeLibrary';
import { hashString, stableStringify } from './stableHash';

export type HuggingFaceClusterDefinitionRef = {
  id: string;
  libraryRevision: string;
  contentHash: string;
};

export type HuggingFaceClusterPresentation = {
  expanded: boolean;
  expandedPaths: string[];
  /** Canonical parent-relative positions keyed by reviewed execution role. */
  executionLayout: Record<string, { x: number; y: number }>;
};

export type HuggingFaceClusterExecutionSelection = {
  admissionId: string;
  studioExecutionSpec: {
    id: string;
    contentHash: string;
    executionProfileId: string;
  };
  parameterOverrides: Record<string, unknown>;
  /**
   * Modular Diffusers conditionals distinguish an omitted input from an input
   * whose value happens to match a default. Studio seeds executable values when
   * a Cluster is inserted, so persist caller intent separately from those
   * values instead of inferring presence from parameterOverrides.
   */
  explicitParameterSources: string[];
};

export type HuggingFaceClusterInstance = {
  schemaVersion: 2;
  instanceId: string;
  definition: HuggingFaceClusterDefinitionRef;
  parameterOverrides: Record<string, unknown>;
  execution: HuggingFaceClusterExecutionSelection | null;
  structuralFork: null;
  presentation: HuggingFaceClusterPresentation;
};

export type HuggingFaceClusterHierarchyNode = {
  path: string;
  pathSegments: string[];
  legacyPath: string;
  semanticId: string;
  parameterPath?: string;
  label: string;
  className: string | null;
  kind: 'auto' | 'conditional' | 'sequential' | 'loop' | 'block' | 'container';
  implicit: boolean;
  conditionalRole?: 'selector' | 'branch';
  conditionalStatus?: 'active' | 'inactive' | 'skipped' | 'error';
  selectedBlockName?: string | null;
  triggerInputs?: string[];
  children: HuggingFaceClusterHierarchyNode[];
};

export type HuggingFaceClusterParameterProjection = HuggingFaceNodeLibraryField & {
  value: unknown;
  overridden: boolean;
};

export type HuggingFaceClusterBindingOverrides = {
  parameterOverrides: Record<string, unknown>;
  executionParameterOverrides: Record<string, unknown>;
};

const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const MAX_INSTANCE_BYTES = 1024 * 1024;

function invalid(message: string): never {
  throw new Error(`Invalid Diffusers Cluster Node instance: ${message}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function assertFiniteJson(value: unknown, seen = new Set<object>()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('values must be finite JSON.');
    return;
  }
  if (!value || typeof value !== 'object') invalid('values must be finite JSON.');
  if (seen.has(value)) invalid('values must be finite JSON.');
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item) => assertFiniteJson(item, seen));
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      invalid('values must be plain JSON objects.');
    Object.values(value as Record<string, unknown>).forEach((item) => assertFiniteJson(item, seen));
  }
  seen.delete(value);
}

function finiteJsonClone<T>(value: T): T {
  assertFiniteJson(value);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    invalid('values must be finite JSON.');
  }
  if (encoded === undefined) invalid('values must be finite JSON.');
  if (new TextEncoder().encode(encoded).byteLength > MAX_INSTANCE_BYTES) invalid('payload exceeds 1 MiB.');
  try {
    return JSON.parse(encoded) as T;
  } catch {
    invalid('values must be finite JSON.');
  }
}

function definitionRef(definition: HuggingFaceNodeLibraryDefinition): HuggingFaceClusterDefinitionRef {
  return {
    id: definition.id,
    libraryRevision: definition.libraryRevision,
    contentHash: definition.contentHash,
  };
}

export function huggingFaceClusterPlacementPath(path: readonly string[]) {
  if (!path.length || path.some((segment) => !segment || segment.includes('/'))) invalid('block path is malformed.');
  return path.join('/');
}

function hierarchyPaths(definition: HuggingFaceNodeLibraryDefinition) {
  return new Set(definition.blockPlacements.map((placement) => huggingFaceClusterPlacementPath(placement.path)));
}

function words(value: string) {
  return value
    .replace(/Step$/u, '')
    .replace(/[_-]/gu, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function admittedExecution(
  definition: HuggingFaceNodeLibraryDefinition,
  admissionId: string,
): HuggingFaceNodeLibraryExecutionAdmission {
  const admission = definition.executionAdmissions.find((candidate) => candidate.id === admissionId);
  if (
    !admission ||
    admission.status !== 'admitted' ||
    admission.claim !== 'static_graph_contract_compatible' ||
    admission.executable !== false ||
    admission.publication.readiness !== 'graph_qualified' ||
    !admission.publication.insertable ||
    !admission.adapterContractId ||
    !admission.studioExecutionSpec ||
    !admission.artifact ||
    admission.reasons.length
  )
    invalid('execution admission is absent or is not a reviewed static contract.');
  return admission;
}

/**
 * Project caller-provided values through backend-declared binding sources.
 * Model and workflow aliases never live in this client function.
 */
export function huggingFaceClusterOverridesForBindingValues(
  definition: HuggingFaceNodeLibraryDefinition,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
  bindingValues: Readonly<Record<string, unknown>>,
): HuggingFaceClusterBindingOverrides {
  if (
    admission.definitionId !== definition.id ||
    admission.status !== 'admitted' ||
    admission.claim !== 'static_graph_contract_compatible' ||
    admission.executable !== false ||
    admission.publication.readiness !== 'graph_qualified' ||
    !admission.publication.insertable ||
    admission.reasons.length
  )
    invalid('binding values require an insertable graph-qualified admission.');
  const supplied = (source: string) =>
    Object.prototype.hasOwnProperty.call(bindingValues, source) && bindingValues[source] !== undefined;
  return {
    parameterOverrides: Object.fromEntries(
      admission.instanceInputBindings.flatMap(({ bindingSource, input }) =>
        supplied(bindingSource) ? [[input, finiteJsonClone(bindingValues[bindingSource])]] : [],
      ),
    ),
    executionParameterOverrides: Object.fromEntries(
      admission.executionParameterSources.flatMap((source) =>
        supplied(source) ? [[source, finiteJsonClone(bindingValues[source])]] : [],
      ),
    ),
  };
}

export function huggingFaceClusterChildSemanticId(instanceId: string, path: string) {
  if (!INSTANCE_ID.test(instanceId) || !path || path.length > 256) invalid('child identity is malformed.');
  return `diffusers.cluster-child:${encodeURIComponent(instanceId)}:${encodeURIComponent(path)}`;
}

export function validateHuggingFaceClusterInstance(
  value: unknown,
  definition: HuggingFaceNodeLibraryDefinition,
): HuggingFaceClusterInstance {
  const requested = finiteJsonClone(value);
  let normalized: unknown =
    record(requested) &&
    requested.schemaVersion === 1 &&
    exactKeys(requested, [
      'schemaVersion',
      'instanceId',
      'definition',
      'parameterOverrides',
      'structuralFork',
      'presentation',
    ])
      ? { ...requested, schemaVersion: 2, execution: null }
      : requested;
  // Schema-v2 receipts created before explicit input-presence tracking inferred
  // presence from every stored override. Preserve that behavior during load;
  // new receipts always persist explicitParameterSources themselves.
  if (
    record(normalized) &&
    record(normalized.execution) &&
    exactKeys(normalized.execution, ['admissionId', 'studioExecutionSpec', 'parameterOverrides'])
  ) {
    normalized = {
      ...normalized,
      execution: {
        ...normalized.execution,
        explicitParameterSources: record(normalized.execution.parameterOverrides)
          ? Object.keys(normalized.execution.parameterOverrides)
          : [],
      },
    };
  }
  // Early schema-v2 instances persisted expansion but not execution-card
  // placement. Treat them as using the reviewed default layout so existing
  // workflows remain readable while newly moved cards can round-trip.
  if (
    record(normalized) &&
    record(normalized.presentation) &&
    exactKeys(normalized.presentation, ['expanded', 'expandedPaths'])
  ) {
    normalized = {
      ...normalized,
      presentation: { ...normalized.presentation, executionLayout: {} },
    };
  }
  if (
    !record(normalized) ||
    !exactKeys(normalized, [
      'schemaVersion',
      'instanceId',
      'definition',
      'parameterOverrides',
      'execution',
      'structuralFork',
      'presentation',
    ]) ||
    normalized.schemaVersion !== 2 ||
    typeof normalized.instanceId !== 'string' ||
    !INSTANCE_ID.test(normalized.instanceId) ||
    normalized.structuralFork !== null
  )
    invalid('schema or identity is malformed.');

  if (
    !record(normalized.definition) ||
    !exactKeys(normalized.definition, ['id', 'libraryRevision', 'contentHash']) ||
    normalized.definition.id !== definition.id ||
    normalized.definition.libraryRevision !== definition.libraryRevision ||
    normalized.definition.contentHash !== definition.contentHash
  )
    invalid('definition revision or content hash does not match the reviewed catalog.');

  const inputNames = new Set(definition.inputs.map((field) => field.name));
  if (
    !record(normalized.parameterOverrides) ||
    Object.keys(normalized.parameterOverrides).some((name) => !inputNames.has(name))
  )
    invalid('parameter overrides contain an unknown field.');

  if (normalized.execution !== null) {
    if (
      !record(normalized.execution) ||
      !exactKeys(normalized.execution, [
        'admissionId',
        'studioExecutionSpec',
        'parameterOverrides',
        'explicitParameterSources',
      ]) ||
      typeof normalized.execution.admissionId !== 'string'
    )
      invalid('execution selection is malformed.');
    const admission = admittedExecution(definition, normalized.execution.admissionId);
    if (
      !record(normalized.execution.studioExecutionSpec) ||
      !exactKeys(normalized.execution.studioExecutionSpec, ['id', 'contentHash', 'executionProfileId']) ||
      !sameJson(normalized.execution.studioExecutionSpec, admission.studioExecutionSpec)
    )
      invalid('execution specification receipt does not match the reviewed admission.');
    const allowedSources = new Set(admission.executionParameterSources);
    if (
      !record(normalized.execution.parameterOverrides) ||
      Object.keys(normalized.execution.parameterOverrides).some((source) => !allowedSources.has(source))
    )
      invalid('execution parameter overrides contain an unknown or sealed binding source.');
    const executionParameterOverrides = normalized.execution.parameterOverrides;
    if (
      !Array.isArray(normalized.execution.explicitParameterSources) ||
      new Set(normalized.execution.explicitParameterSources).size !==
        normalized.execution.explicitParameterSources.length ||
      normalized.execution.explicitParameterSources.some(
        (source) =>
          typeof source !== 'string' ||
          !allowedSources.has(source) ||
          !Object.prototype.hasOwnProperty.call(executionParameterOverrides, source),
      )
    )
      invalid('explicit execution parameter sources are malformed or do not have a stored value.');
  }

  if (
    !record(normalized.presentation) ||
    !exactKeys(normalized.presentation, ['expanded', 'expandedPaths', 'executionLayout']) ||
    typeof normalized.presentation.expanded !== 'boolean' ||
    !Array.isArray(normalized.presentation.expandedPaths) ||
    normalized.presentation.expandedPaths.length > 1024 ||
    normalized.presentation.expandedPaths.some((path) => typeof path !== 'string') ||
    !record(normalized.presentation.executionLayout) ||
    Object.keys(normalized.presentation.executionLayout).length > 256 ||
    Object.entries(normalized.presentation.executionLayout).some(
      ([role, position]) =>
        !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(role) ||
        !record(position) ||
        !exactKeys(position, ['x', 'y']) ||
        typeof position.x !== 'number' ||
        !Number.isFinite(position.x) ||
        typeof position.y !== 'number' ||
        !Number.isFinite(position.y),
    )
  )
    invalid('presentation state is malformed.');
  const expandedPaths = normalized.presentation.expandedPaths as string[];
  const validPaths = hierarchyPaths(definition);
  if (new Set(expandedPaths).size !== expandedPaths.length || expandedPaths.some((path) => !validPaths.has(path)))
    invalid('presentation references an unknown block path.');

  return normalized as HuggingFaceClusterInstance;
}

export function createHuggingFaceClusterInstance(
  definition: HuggingFaceNodeLibraryDefinition,
  instanceId: string,
  parameterOverrides: Record<string, unknown> = {},
): HuggingFaceClusterInstance {
  return validateHuggingFaceClusterInstance(
    {
      schemaVersion: 2,
      instanceId,
      definition: definitionRef(definition),
      parameterOverrides,
      execution: null,
      structuralFork: null,
      presentation: { expanded: false, expandedPaths: [], executionLayout: {} },
    },
    definition,
  );
}

export function setHuggingFaceClusterParameter(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
  name: string,
  value: unknown,
): HuggingFaceClusterInstance {
  const field = definition.inputs.find((candidate) => candidate.name === name);
  if (!field) invalid(`unknown parameter ${name}.`);
  // NumberField deliberately commits text so users can edit incomplete values.
  // Cluster instances are durable semantic receipts, so retain the exact JSON
  // type declared by the reviewed backend definition instead of a DOM string.
  const normalizedValue =
    typeof value === 'string' && (field.type === 'int' || field.type === 'builtins.int')
      ? Number(value)
      : typeof value === 'string' && (field.type === 'float' || field.type === 'builtins.float')
        ? Number(value)
        : value;
  if (
    ((field.type === 'int' || field.type === 'builtins.int') &&
      (typeof normalizedValue !== 'number' || !Number.isSafeInteger(normalizedValue))) ||
    ((field.type === 'float' || field.type === 'builtins.float') &&
      (typeof normalizedValue !== 'number' || !Number.isFinite(normalizedValue)))
  )
    invalid(`parameter ${name} must be a finite ${field.type.endsWith('int') ? 'integer' : 'number'}.`);
  const parameterOverrides = { ...instance.parameterOverrides };
  if (sameJson(normalizedValue, field.default)) delete parameterOverrides[name];
  else parameterOverrides[name] = normalizedValue;
  return validateHuggingFaceClusterInstance({ ...instance, parameterOverrides }, definition);
}

export function setHuggingFaceClusterExecution(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
  admissionId: string | null,
): HuggingFaceClusterInstance {
  const normalized = validateHuggingFaceClusterInstance(instance, definition);
  if (admissionId === null) {
    return validateHuggingFaceClusterInstance({ ...normalized, execution: null }, definition);
  }
  const admission = admittedExecution(definition, admissionId);
  const previousOverrides =
    normalized.execution?.admissionId === admissionId ? normalized.execution.parameterOverrides : {};
  const previousExplicitSources =
    normalized.execution?.admissionId === admissionId ? normalized.execution.explicitParameterSources : [];
  return validateHuggingFaceClusterInstance(
    {
      ...normalized,
      execution: {
        admissionId,
        studioExecutionSpec: admission.studioExecutionSpec,
        parameterOverrides: previousOverrides,
        explicitParameterSources: previousExplicitSources,
      },
    },
    definition,
  );
}

export function setHuggingFaceClusterExecutionParameter(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
  source: string,
  value: unknown,
): HuggingFaceClusterInstance {
  const normalized = validateHuggingFaceClusterInstance(instance, definition);
  if (!normalized.execution) invalid('an execution mode must be selected before editing execution parameters.');
  const admission = admittedExecution(definition, normalized.execution.admissionId);
  if (!admission.executionParameterSources.includes(source))
    invalid(`unknown or sealed execution parameter ${source}.`);
  const parameterOverrides = { ...normalized.execution.parameterOverrides };
  const explicitSources = new Set(normalized.execution.explicitParameterSources);
  if (value === undefined) {
    delete parameterOverrides[source];
    explicitSources.delete(source);
  } else {
    parameterOverrides[source] = value;
    explicitSources.add(source);
  }
  const explicitParameterSources = admission.executionParameterSources.filter((candidate) =>
    explicitSources.has(candidate),
  );
  return validateHuggingFaceClusterInstance(
    {
      ...normalized,
      execution: { ...normalized.execution, parameterOverrides, explicitParameterSources },
    },
    definition,
  );
}

export function setHuggingFaceClusterPresentation(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
  presentation: HuggingFaceClusterPresentation,
): HuggingFaceClusterInstance {
  return validateHuggingFaceClusterInstance({ ...instance, presentation }, definition);
}

export function huggingFaceClusterParameterProjection(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
): HuggingFaceClusterParameterProjection[] {
  const normalized = validateHuggingFaceClusterInstance(instance, definition);
  return definition.inputs.map((field) => ({
    ...field,
    value: Object.prototype.hasOwnProperty.call(normalized.parameterOverrides, field.name)
      ? normalized.parameterOverrides[field.name]
      : field.default,
    overridden: Object.prototype.hasOwnProperty.call(normalized.parameterOverrides, field.name),
  }));
}

export function huggingFaceClusterHierarchy(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
): HuggingFaceClusterHierarchyNode[] {
  const normalized = validateHuggingFaceClusterInstance(instance, definition);
  const exactSteps = new Map(definition.steps.map((step) => [step.path, step]));
  const explicitLegacyPaths = new Set(definition.blockPlacements.map((placement) => placement.legacyPath));
  const nodesByLegacyPath = new Map<string, HuggingFaceClusterHierarchyNode>();
  const orderedNodes: HuggingFaceClusterHierarchyNode[] = [];
  definition.blockPlacements.forEach((placement) => {
    const legacySegments = placement.legacyPath.split('.');
    legacySegments.slice(0, -1).forEach((_, index) => {
      const legacyPath = legacySegments.slice(0, index + 1).join('.');
      if (explicitLegacyPaths.has(legacyPath) || nodesByLegacyPath.has(legacyPath)) return;
      const implicit: HuggingFaceClusterHierarchyNode = {
        path: legacyPath,
        pathSegments: [legacyPath],
        legacyPath,
        semanticId: huggingFaceClusterChildSemanticId(normalized.instanceId, legacyPath),
        label: words(legacySegments[index]!),
        className: null,
        kind: 'container',
        implicit: true,
        children: [],
      };
      nodesByLegacyPath.set(legacyPath, implicit);
      orderedNodes.push(implicit);
    });
    const path = huggingFaceClusterPlacementPath(placement.path);
    const step = exactSteps.get(placement.legacyPath);
    if (!step) invalid(`reviewed block ${placement.legacyPath} is missing.`);
    const node: HuggingFaceClusterHierarchyNode = {
      path,
      pathSegments: placement.path,
      legacyPath: placement.legacyPath,
      semanticId: huggingFaceClusterChildSemanticId(normalized.instanceId, path),
      parameterPath: path,
      label: words(step.className),
      className: step.className,
      kind: step.kind,
      implicit: false,
      children: [],
    };
    nodesByLegacyPath.set(placement.legacyPath, node);
    orderedNodes.push(node);
  });
  const roots: HuggingFaceClusterHierarchyNode[] = [];
  orderedNodes.forEach((node) => {
    const separator = node.legacyPath.lastIndexOf('.');
    const parentLegacyPath = separator > 0 ? node.legacyPath.slice(0, separator) : null;
    const parent = parentLegacyPath ? nodesByLegacyPath.get(parentLegacyPath) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

export function huggingFaceClusterSemanticSnapshot(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
) {
  const normalized = validateHuggingFaceClusterInstance(instance, definition);
  return finiteJsonClone({
    schemaVersion: normalized.schemaVersion,
    instanceId: normalized.instanceId,
    definition: normalized.definition,
    parameterOverrides: normalized.parameterOverrides,
    execution: normalized.execution,
    structuralFork: normalized.structuralFork,
  });
}

export function huggingFaceClusterExecutionFingerprint(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
) {
  const normalized = validateHuggingFaceClusterInstance(instance, definition);
  if (!normalized.execution) return null;
  const admission = admittedExecution(definition, normalized.execution.admissionId);
  const semantic = {
    canonicalizationVersion: 1,
    definition: normalized.definition,
    parameterOverrides: normalized.parameterOverrides,
    execution: normalized.execution,
    admission: {
      id: admission.id,
      adapterContractId: admission.adapterContractId,
      studioMode: admission.studioMode,
      studioExecutionSpec: admission.studioExecutionSpec,
      artifact: admission.artifact,
      sealedBindingValues: admission.sealedBindingValues,
      modelDependencies: admission.modelDependencies,
    },
  };
  return `hf-cluster-v1-${hashString(stableStringify(semantic))}`;
}
