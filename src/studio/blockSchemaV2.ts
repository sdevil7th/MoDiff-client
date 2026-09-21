import type { AppModeInput, UserBlockDefinition, UserBlockPort } from './types';
import { hashString } from './stableHash';
import {
  blockMediaFileBoundaryIsCompatibleV2,
  blockValueTypeMatchesMediaV2,
  blockValueTypesAreCompatibleV2,
} from './blockValueTypeCompatibilityV2';

/**
 * Canonical persisted contract for every composite node shown by Studio.
 *
 * Registered Diffusers/Transformers Clusters, imported Hub blocks, and User
 * Nodes all use this schema. Source and ownership affect catalog placement and
 * permitted save actions; they never select another renderer or interface
 * inference algorithm. `BlockInstanceV2` is the sole persisted authority for
 * one workflow insertion; controls, sockets, projected children, previews,
 * and execution expansion are derived views, not parallel schemas.
 *
 * Maintenance rule:
 * - keep reusable-definition fields, strict validation, canonical JSON, and
 *   hashes aligned with `MoDiff/modiff/block_definition_v2.py`;
 * - update the cross-runtime fixtures and API documentation in the same
 *   change; and
 * - treat instance-only fields as workflow contracts, never as implicit
 *   `/studio/blocks` definition fields.
 *
 * Normative contract:
 * `MoDiff/docs/unified-composite-node-implementation-plan-2026-09-01.md`.
 */

export type BlockJsonPrimitive = string | number | boolean | null;
export type BlockJsonValue = BlockJsonPrimitive | BlockJsonValue[] | { [key: string]: BlockJsonValue };
export type BlockJsonObject = { [key: string]: BlockJsonValue };

export type BlockSourceKindV2 = 'diffusers_catalog' | 'transformers_catalog' | 'hub_import' | 'user';

export type BlockSourceV2 = {
  kind: BlockSourceKindV2;
  catalogCategory?: 'diffusers' | 'transformers';
  provider?: string;
  library?: 'diffusers' | 'transformers';
  libraryRevision?: string;
  pipelineClass?: string;
  blocksClass?: string;
  workflow?: string;
  manifestDefinitionId?: string;
  manifestContentHash?: string;
  /** Exact reviewed catalog execution admission used to compile this definition. */
  executionAdmissionId?: string;
  repository?: string;
  repositoryRevision?: string;
  parent?: {
    definitionId: string;
    contentHash: string;
    sourceKind: BlockSourceKindV2;
  };
};

export type BlockGraphNodeV2 = {
  nodeId: string;
  nodeType: string;
  data: BlockJsonObject;
  semanticRole?: string;
  upstreamBlockPath?: string;
  modularDiffusers?: BlockGraphNodeModularDiffusersV2;
  /** Durable local surface over this semantic node and its descendants; never another graph or value store. */
  containerInterface?: BlockContainerInterfaceV1;
  /** Explicit customized ownership in this flat graph; never a second nested instance. */
  parentNodeId?: string;
};

/** Hash-bound semantic identity for one expanded Modular Diffusers node. */
export type BlockGraphNodeModularDiffusersV2 = {
  kind: 'infrastructure' | 'upstream_block';
  pipelineClass: string;
  blocksClass: string;
  workflowId: string;
  libraryRevision: string;
  runtimeRole: string;
  blockDefinitionId?: string;
  blockClass?: string;
  blockKind?: 'auto' | 'conditional' | 'sequential' | 'loop' | 'block';
  blockContractHash?: string;
  placementPath?: string[];
  parentPlacementPath?: string[];
  /** Immutable catalog origin retained when this placement is inserted or replaces another placement. */
  sourceDefinitionId?: string;
  sourcePlacementPath?: string[];
  sourceExecutionScope?: 'selected_workflow' | 'unpruned_pipeline';
  componentNames?: string[];
};

function modularPlacementKeyV2(path: readonly string[] | undefined) {
  return path?.join('/') ?? '';
}

/**
 * Stable semantic IDs that own at least one immediate Modular Diffusers
 * placement. A container is defined by the upstream hierarchy, not by its
 * backend React Flow node type: executable upstream blocks can own nested
 * loop/sequential blocks while still being ordinary `custom` runtime nodes.
 */
export function blockModularContainerNodeIdsV2(graph: Pick<BlockGraphV2, 'nodes'>): string[] {
  return [
    ...new Set([
      ...blockGraphParentIdsV2(graph).values(),
      ...graph.nodes.filter((node) => node.nodeType === 'group' && !node.modularDiffusers).map(({ nodeId }) => nodeId),
    ]),
  ].sort();
}

/** Source-neutral ownership, with untouched catalog placement as the legacy default. */
export function blockGraphParentIdsV2(graph: Pick<BlockGraphV2, 'nodes'>): Map<string, string> {
  const nodeIdByPlacement = new Map<string, string>();
  const nodesById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  graph.nodes.forEach((node) => {
    const metadata = node.modularDiffusers;
    if (metadata?.kind !== 'upstream_block' || !metadata.placementPath?.length) return;
    const key = modularPlacementKeyV2(metadata.placementPath);
    if (nodeIdByPlacement.has(key)) throw new Error(`Ambiguous Block V2 subtree placement ${key}.`);
    nodeIdByPlacement.set(key, node.nodeId);
  });
  const parents = new Map<string, string>();
  for (const node of graph.nodes) {
    const metadata = node.modularDiffusers;
    const upstreamParent =
      metadata?.kind === 'upstream_block' && metadata.parentPlacementPath?.length
        ? nodeIdByPlacement.get(modularPlacementKeyV2(metadata.parentPlacementPath))
        : undefined;
    const parentId = node.parentNodeId ?? upstreamParent;
    if (!parentId) continue;
    if (node.parentNodeId !== undefined) {
      const parent = nodesById.get(parentId);
      if (!parent) throw new Error(`Block V2 node ${node.nodeId} references unknown parent ${parentId}.`);
      const parentMetadata = parent.modularDiffusers;
      if (
        parent.nodeType !== 'group' &&
        !(parentMetadata?.kind === 'upstream_block' && parentMetadata.blockKind !== 'block')
      )
        throw new Error(`Block V2 parent ${parentId} is not a container.`);
      if (upstreamParent && upstreamParent !== parentId)
        throw new Error(`Block V2 node ${node.nodeId} has conflicting explicit and upstream parents.`);
    }
    parents.set(node.nodeId, parentId);
  }
  for (const nodeId of parents.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = nodeId;
    while (current && parents.has(current)) {
      if (seen.has(current)) throw new Error(`Cyclic Block V2 subtree at ${current}.`);
      seen.add(current);
      current = parents.get(current);
    }
  }
  return parents;
}

export type BlockGraphEdgeV2 = {
  edgeId: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
};

export type BlockGraphV2 = {
  nodes: BlockGraphNodeV2[];
  edges: BlockGraphEdgeV2[];
  executionOrder?: string[];
  graphHash: string;
};

export type BlockPortV2 = {
  portId: string;
  label: string;
  valueType: string;
  required: boolean;
  multiple?: boolean;
  binding: {
    nodeId: string;
    fieldOrPortId: string;
  };
  /** Input-only additional internal fields driven by the same public value/edge. */
  mirrorBindings?: Array<{
    nodeId: string;
    fieldOrPortId: string;
  }>;
};

export type BlockBoundaryV2 = {
  mode: 'explicit' | 'derived';
  inputs: BlockPortV2[];
  outputs: BlockPortV2[];
  derivation?: {
    algorithmVersion: string;
    derivedAtDefinitionHash: string;
  };
};

export type BlockControlV2 = {
  controlId: string;
  label: string;
  binding: {
    nodeId: string;
    fieldId: string;
  };
  /** Additional internal fields driven atomically by this one logical control. */
  mirrorBindings?: Array<{
    nodeId: string;
    fieldId: string;
  }>;
  valueType: string;
  defaultValue?: BlockJsonValue;
  required?: boolean;
  sealed?: boolean;
  order: number;
  group?: string;
  help?: string;
};

/** Optional, hash-covered interface of an internal semantic container. */
export type BlockContainerInterfaceV1 = {
  schemaVersion: 1;
  boundary: BlockBoundaryV2;
  /** Values/defaults remain on the original fields or owning instance controls. */
  controls: Omit<BlockControlV2, 'defaultValue'>[];
  /** Local preview selection; run state remains in the owning instance inventory. */
  previews?: BlockPreviewBindingV2[];
};

/** Same semantic hierarchy used by rendering, independent of disclosure or canvas IDs. */
export function blockGraphSubtreeNodeIdsV2(graph: Pick<BlockGraphV2, 'nodes'>, rootNodeId: string): Set<string> {
  if (!graph.nodes.some(({ nodeId }) => nodeId === rootNodeId))
    throw new Error(`Unknown Block V2 subtree ${rootNodeId}.`);
  const children = new Map<string, string[]>();
  for (const [nodeId, parentId] of blockGraphParentIdsV2(graph))
    children.set(parentId, [...(children.get(parentId) ?? []), nodeId]);
  const included = new Set<string>();
  const visit = (nodeId: string, ancestors: Set<string>) => {
    if (ancestors.has(nodeId)) throw new Error(`Cyclic Block V2 subtree at ${nodeId}.`);
    if (included.has(nodeId)) return;
    included.add(nodeId);
    for (const child of children.get(nodeId) ?? []) visit(child, new Set([...ancestors, nodeId]));
  };
  visit(rootNodeId, new Set());
  return included;
}

export type SuggestedInputSetV2 = {
  suggestionId: string;
  label: string;
  source?: string;
  /** Suggested values are keyed by stable controlId, never by label/order. */
  values: Record<string, BlockJsonValue>;
};

export type BlockPreviewBindingV2 = {
  nodeId: string;
  outputPortId: string;
  mediaType: 'image' | 'video' | 'audio' | 'text' | 'file';
  /** Omitted/false previews remain available but are not the collapsed primary. */
  primary?: boolean;
};

export type BlockDefinitionV2 = {
  schemaVersion: 2;
  definitionId: string;
  displayName: string;
  description?: string;
  contentHash: string;
  source: BlockSourceV2;
  graph: BlockGraphV2;
  boundary: BlockBoundaryV2;
  controls: BlockControlV2[];
  suggestedInputs?: SuggestedInputSetV2[];
  previews: BlockPreviewBindingV2[];
  ownership: {
    kind: 'registered' | 'user';
    definitionMutable: boolean;
  };
};

/**
 * Workflow-instance public surface. The reusable definition remains the
 * immutable baseline; structural/interface customization changes this
 * snapshot copy-on-write without creating a second canvas-node authority.
 */
export type BlockEffectiveInterfaceV2 = {
  boundary: BlockBoundaryV2;
  controls: BlockControlV2[];
  baseInterfaceHash: string;
  effectiveInterfaceHash: string;
};

export type BlockPreviewStateV2 = {
  binding: BlockPreviewBindingV2;
  mediaReference?: string;
  taskId?: string;
  status?: 'idle' | 'queued' | 'running' | 'complete' | 'failed';
};

export type BlockAuthorityReceiptV2 = {
  kind: 'reviewed_execution' | 'auto' | 'publication';
  definitionId: string;
  definitionContentHash: string;
  effectiveGraphHash: string;
  executionParameterHash: string;
  artifactRevisions: Record<string, string>;
  admissionId: string;
  issuedAt: string;
  expiresAt?: string;
};

/**
 * Inactive exact-route state owned by one workflow instance. A draft is not a
 * nested Block instance: identity, canvas geometry, previews, tasks,
 * authorities, and recursive route-selection state deliberately remain on the
 * one active root.
 */
export type BlockRouteDraftV1 = {
  schemaVersion: 1;
  routeKey: string;
  definitionRef: BlockInstanceV2['definitionRef'];
  definitionSnapshot: BlockDefinitionV2;
  effectiveGraph: BlockGraphV2;
  effectiveInterface: BlockEffectiveInterfaceV2;
  values: Record<string, BlockJsonValue>;
  customization: BlockInstanceV2['customization'];
  internalLayout: BlockInstanceV2['presentation']['internalLayout'];
  internalLayoutMode?: NonNullable<BlockInstanceV2['presentation']['internalLayoutMode']>;
  collapsedContainerNodeIds?: string[];
};

export type BlockRouteSelectionV1 = {
  schemaVersion: 1;
  routeSetId: string;
  selectedRouteKey: string;
  inactiveDrafts: Record<string, BlockRouteDraftV1>;
};

export type BlockInstanceV2 = {
  schemaVersion: 2;
  instanceId: string;
  definitionRef: {
    definitionId: string;
    contentHash: string;
  };
  /** Embedded snapshot prevents library updates/deletion from resetting this workflow. */
  definitionSnapshot: BlockDefinitionV2;
  /** Copy-on-write graph; initially semantically equal to definitionSnapshot.graph. */
  effectiveGraph: BlockGraphV2;
  /** Copy-on-write public surface; initially equals the definition boundary and controls. */
  effectiveInterface: BlockEffectiveInterfaceV2;
  /** Current values keyed by stable declared control/input IDs. */
  values: Record<string, BlockJsonValue>;
  customization: {
    state: 'unchanged' | 'parameters_changed' | 'structure_changed';
    baseGraphHash: string;
    effectiveGraphHash: string;
  };
  presentation: {
    expanded: boolean;
    position: { x: number; y: number };
    /** Collapsed/user-resized size. Expanded canvas bounds are derived from internalLayout and measured children. */
    size: { width: number; height: number };
    /**
     * Coordinate system used by internalLayout. Legacy/flat instances omit
     * this field and store every child relative to the outer Block root.
     * Hierarchical instances store a Modular Diffusers child's position
     * relative to its immediate parent placement, matching React Flow's
     * sub-flow contract without changing semantic graph ownership.
     */
    internalLayoutMode?: 'root' | 'hierarchical';
    /** Presentation-only semantic IDs of collapsed Modular Diffusers containers. */
    collapsedContainerNodeIds?: string[];
    internalLayout: Record<string, { x: number; y: number; width?: number; height?: number }>;
  };
  previewStates: BlockPreviewStateV2[];
  authorities: BlockAuthorityReceiptV2[];
  /** Optional generic shell around one active exact registered route. */
  routeSelection?: BlockRouteSelectionV1;
};

/** Computed view only: capabilities are never persisted as authority. */
export type CompositeNodeCapabilitiesV2 = {
  editInstanceValues: boolean;
  editInstanceStructure: boolean;
  configureInterface: boolean;
  keepWorkflowOnly: boolean;
  saveAsNewUserNode: boolean;
  updateReusableDefinition: boolean;
};

const MAX_DEFINITION_BYTES = 16 * 1024 * 1024;
const MAX_INSTANCE_BYTES = 20 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,383}$/u;
// Backend node parameters are Python keyword names and may intentionally be
// private-style fields such as Modular Diffusers `_auto_resize`. Public
// port/control ids still use ID; graph-field bindings must preserve the exact
// backend field key instead of renaming it.
const FIELD_ID = /^[A-Za-z_][A-Za-z0-9_.:/-]{0,383}$/u;
const REPOSITORY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const HASH = /^[A-Za-z0-9][A-Za-z0-9_.:-]{1,511}$/u;

function invalid(label: string, message: string): never {
  throw new Error(`Invalid ${label}: ${message}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function objectAt(value: unknown, label: string) {
  if (!record(value)) invalid(label, 'must be a JSON object.');
  return value;
}

function keysAt(
  value: Record<string, unknown>,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length) invalid(label, `is missing ${missing.join(', ')}.`);
  if (unknown.length) invalid(label, `contains unknown keys: ${unknown.join(', ')}.`);
}

function textAt(value: unknown, label: string, pattern?: RegExp, maximum = 512) {
  if (typeof value !== 'string' || !value || value.length > maximum || (pattern && !pattern.test(value)))
    invalid(label, 'is malformed.');
  return value;
}

function optionalTextAt(value: unknown, label: string, maximum = 512) {
  return value === undefined ? undefined : textAt(value, label, undefined, maximum);
}

function booleanAt(value: unknown, label: string) {
  if (typeof value !== 'boolean') invalid(label, 'must be a boolean.');
  return value;
}

function finiteNumberAt(value: unknown, label: string, minimum?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (minimum !== undefined && value < minimum))
    invalid(label, 'must be a finite number.');
  return value;
}

function finiteJson(value: unknown, label: string, seen = new Set<object>()): asserts value is BlockJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(label, 'must contain only finite JSON values.');
    return;
  }
  if (!value || typeof value !== 'object' || seen.has(value))
    invalid(label, 'must contain only acyclic finite JSON values.');
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null &&
    !Array.isArray(value)
  )
    invalid(label, 'must contain only plain JSON objects.');
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => finiteJson(item, `${label}[${index}]`, seen));
  else Object.entries(value).forEach(([key, item]) => finiteJson(item, `${label}.${key}`, seen));
  seen.delete(value);
}

function jsonClone<T>(value: T, label: string, maximumBytes: number): T {
  finiteJson(value, label);
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > maximumBytes)
    invalid(label, `exceeds ${maximumBytes} bytes.`);
  return JSON.parse(encoded) as T;
}

function unique(items: readonly string[], label: string) {
  if (new Set(items).size !== items.length) invalid(label, 'must not contain duplicates.');
}

function lexicalCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalOrderedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalOrderedValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => lexicalCompare(left, right))
      .map(([key, entry]) => [key, canonicalOrderedValue(entry)]),
  );
}

/** Cross-runtime canonical JSON; never use locale-dependent key ordering. */
export function canonicalBlockStringifyV2(value: unknown) {
  return JSON.stringify(canonicalOrderedValue(value));
}

function hashValue(prefix: string, value: unknown) {
  return `${prefix}-${hashString(canonicalBlockStringifyV2(value))}`;
}

/** Node/edge array order is not identity; explicit executionOrder remains semantic. */
export function canonicalBlockGraphV2(graph: Omit<BlockGraphV2, 'graphHash'> | BlockGraphV2) {
  return {
    nodes: [...graph.nodes].sort((left, right) => lexicalCompare(left.nodeId, right.nodeId)),
    edges: [...graph.edges].sort((left, right) => lexicalCompare(left.edgeId, right.edgeId)),
    ...(graph.executionOrder ? { executionOrder: [...graph.executionOrder] } : {}),
  };
}

export function blockGraphHashV2(graph: Omit<BlockGraphV2, 'graphHash'> | BlockGraphV2) {
  return hashValue('block-graph-v2', canonicalBlockGraphV2(graph));
}

function executionRelevantBlockSourceV2(source: BlockSourceV2) {
  return {
    ...(source.provider ? { provider: source.provider } : {}),
    ...(source.library ? { library: source.library } : {}),
    ...(source.libraryRevision ? { libraryRevision: source.libraryRevision } : {}),
    ...(source.pipelineClass ? { pipelineClass: source.pipelineClass } : {}),
    ...(source.blocksClass ? { blocksClass: source.blocksClass } : {}),
    ...(source.workflow ? { workflow: source.workflow } : {}),
    ...(source.manifestDefinitionId ? { manifestDefinitionId: source.manifestDefinitionId } : {}),
    ...(source.manifestContentHash ? { manifestContentHash: source.manifestContentHash } : {}),
    ...(source.executionAdmissionId ? { executionAdmissionId: source.executionAdmissionId } : {}),
    ...(source.repository ? { repository: source.repository } : {}),
    ...(source.repositoryRevision ? { repositoryRevision: source.repositoryRevision } : {}),
  };
}

/** Presentation/provenance-only fields are intentionally excluded. */
export function canonicalBlockDefinitionV2(definition: Omit<BlockDefinitionV2, 'contentHash'> | BlockDefinitionV2) {
  return {
    graph: canonicalBlockGraphV2(definition.graph),
    boundary: definition.boundary,
    controls: definition.controls,
    previews: definition.previews,
    sourceBindings: executionRelevantBlockSourceV2(definition.source),
  };
}

export function blockDefinitionContentHashV2(definition: Omit<BlockDefinitionV2, 'contentHash'> | BlockDefinitionV2) {
  return hashValue('block-definition-v2', canonicalBlockDefinitionV2(definition));
}

export function canonicalBlockInterfaceV2(value: Pick<BlockEffectiveInterfaceV2, 'boundary' | 'controls'>) {
  return { boundary: value.boundary, controls: value.controls };
}

export function blockInterfaceHashV2(value: Pick<BlockEffectiveInterfaceV2, 'boundary' | 'controls'>) {
  return hashValue('block-interface-v2', canonicalBlockInterfaceV2(value));
}

function sourceAt(value: unknown): BlockSourceV2 {
  const source = objectAt(value, 'Block source V2');
  keysAt(
    source,
    'Block source V2',
    ['kind'],
    [
      'catalogCategory',
      'provider',
      'library',
      'libraryRevision',
      'pipelineClass',
      'blocksClass',
      'workflow',
      'manifestDefinitionId',
      'manifestContentHash',
      'executionAdmissionId',
      'repository',
      'repositoryRevision',
      'parent',
    ],
  );
  if (!['diffusers_catalog', 'transformers_catalog', 'hub_import', 'user'].includes(String(source.kind)))
    invalid('Block source V2.kind', 'is unsupported.');
  if (
    source.catalogCategory !== undefined &&
    source.catalogCategory !== 'diffusers' &&
    source.catalogCategory !== 'transformers'
  )
    invalid('Block source V2.catalogCategory', 'is unsupported.');
  if (source.library !== undefined && source.library !== 'diffusers' && source.library !== 'transformers')
    invalid('Block source V2.library', 'is unsupported.');
  [
    'provider',
    'libraryRevision',
    'pipelineClass',
    'blocksClass',
    'workflow',
    'manifestDefinitionId',
    'manifestContentHash',
    'executionAdmissionId',
  ].forEach((key) => optionalTextAt(source[key], `Block source V2.${key}`, 512));
  const repositoryPresent = source.repository !== undefined;
  const revisionPresent = source.repositoryRevision !== undefined;
  if (repositoryPresent !== revisionPresent)
    invalid('Block source V2', 'repository and repositoryRevision must be declared together.');
  if (repositoryPresent) {
    textAt(source.repository, 'Block source V2.repository', REPOSITORY_ID, 384);
    textAt(source.repositoryRevision, 'Block source V2.repositoryRevision', COMMIT, 40);
  }
  if (source.parent !== undefined) {
    const parent = objectAt(source.parent, 'Block source V2.parent');
    keysAt(parent, 'Block source V2.parent', ['definitionId', 'contentHash', 'sourceKind']);
    textAt(parent.definitionId, 'Block source V2.parent.definitionId', ID, 384);
    textAt(parent.contentHash, 'Block source V2.parent.contentHash', HASH, 512);
    if (!['diffusers_catalog', 'transformers_catalog', 'hub_import', 'user'].includes(String(parent.sourceKind)))
      invalid('Block source V2.parent.sourceKind', 'is unsupported.');
  }
  if (source.kind === 'diffusers_catalog') {
    if (source.catalogCategory !== 'diffusers' || source.library !== 'diffusers')
      invalid('Block source V2', 'a Diffusers catalog source requires Diffusers category and library.');
  }
  if (source.kind === 'transformers_catalog') {
    if (source.catalogCategory !== 'transformers' || source.library !== 'transformers')
      invalid('Block source V2', 'a Transformers catalog source requires Transformers category and library.');
  }
  if ((source.kind === 'hub_import' || source.kind === 'user') && source.catalogCategory !== undefined)
    invalid('Block source V2', 'Hub imports and User Nodes cannot use a registered catalog category.');
  if (source.kind === 'hub_import' && !repositoryPresent)
    invalid('Block source V2', 'a Hub import requires an immutable repository revision.');
  if (
    (source.kind === 'diffusers_catalog' || source.kind === 'transformers_catalog') &&
    (!source.libraryRevision ||
      !source.manifestDefinitionId ||
      !source.manifestContentHash ||
      !source.pipelineClass ||
      !source.workflow)
  )
    invalid(
      'Block source V2',
      'a registered catalog source requires library, manifest, pipeline class, and workflow identities.',
    );
  return source as BlockSourceV2;
}

const NESTED_COMPOSITE_MARKERS = new Set([
  'blockDefinitionId',
  'blockDefinitionV2',
  'blockInstanceId',
  'blockInstanceV2',
  'definitionSnapshot',
  'huggingFaceClusterDefinitionId',
  'huggingFaceClusterInstanceId',
  'huggingFaceClusterSnapshot',
  'userBlockId',
  'userBlockInstanceId',
  'userBlockSnapshot',
]);

function graphNodeAt(value: unknown, label: string): BlockGraphNodeV2 {
  const node = objectAt(value, label);
  keysAt(
    node,
    label,
    ['nodeId', 'nodeType', 'data'],
    ['semanticRole', 'upstreamBlockPath', 'modularDiffusers', 'containerInterface', 'parentNodeId'],
  );
  textAt(node.nodeId, `${label}.nodeId`, ID, 384);
  textAt(node.nodeType, `${label}.nodeType`, undefined, 512);
  if (node.parentNodeId !== undefined) textAt(node.parentNodeId, `${label}.parentNodeId`, ID, 384);
  const data = objectAt(node.data, `${label}.data`);
  finiteJson(data, `${label}.data`);
  const nodeType = String(node.nodeType).toLowerCase();
  const dataType = typeof data.type === 'string' ? data.type.toLowerCase() : '';
  if (
    nodeType === 'block' ||
    nodeType === 'cluster' ||
    dataType === 'block' ||
    dataType === 'cluster' ||
    Object.keys(data).some((key) => NESTED_COMPOSITE_MARKERS.has(key))
  )
    invalid(label, 'nested User Nodes and Cluster Nodes are not supported.');
  optionalTextAt(node.semanticRole, `${label}.semanticRole`, 512);
  optionalTextAt(node.upstreamBlockPath, `${label}.upstreamBlockPath`, 2048);
  if (node.modularDiffusers !== undefined) modularDiffusersNodeAt(node.modularDiffusers, `${label}.modularDiffusers`);
  return node as unknown as BlockGraphNodeV2;
}

function modularDiffusersNodeAt(value: unknown, label: string): BlockGraphNodeModularDiffusersV2 {
  const metadata = objectAt(value, label);
  const common = ['kind', 'pipelineClass', 'blocksClass', 'workflowId', 'libraryRevision', 'runtimeRole'];
  const upstream = [
    'blockDefinitionId',
    'blockClass',
    'blockKind',
    'blockContractHash',
    'placementPath',
    'componentNames',
  ];
  if (metadata.kind === 'infrastructure') keysAt(metadata, label, common, ['componentNames']);
  else if (metadata.kind === 'upstream_block')
    keysAt(
      metadata,
      label,
      [...common, ...upstream],
      ['parentPlacementPath', 'sourceDefinitionId', 'sourcePlacementPath', 'sourceExecutionScope'],
    );
  else invalid(`${label}.kind`, 'must be infrastructure or upstream_block.');

  ['pipelineClass', 'blocksClass', 'runtimeRole'].forEach((key) => textAt(metadata[key], `${label}.${key}`, ID, 512));
  // Workflow ids and upstream placement/component names come directly from
  // Python Modular Diffusers and may intentionally begin with `_` (for
  // example the exact unpruned catalog sentinel `__unpruned__`).
  textAt(metadata.workflowId, `${label}.workflowId`, FIELD_ID, 512);
  textAt(metadata.libraryRevision, `${label}.libraryRevision`, COMMIT, 40);

  const stringArray = (key: string, required = false) => {
    const values = metadata[key];
    if (!Array.isArray(values) || (required && !values.length) || values.length > 256)
      invalid(`${label}.${key}`, required ? 'must be a nonempty bounded array.' : 'must be a bounded array.');
    values.forEach((item, index) => textAt(item, `${label}.${key}[${index}]`, FIELD_ID, 512));
    if (key === 'componentNames') unique(values as string[], `${label}.${key}`);
  };
  if (metadata.componentNames !== undefined) stringArray('componentNames');
  if (metadata.kind === 'upstream_block') {
    textAt(metadata.blockDefinitionId, `${label}.blockDefinitionId`, ID, 512);
    textAt(metadata.blockClass, `${label}.blockClass`, ID, 512);
    if (!new Set(['auto', 'conditional', 'sequential', 'loop', 'block']).has(String(metadata.blockKind)))
      invalid(`${label}.blockKind`, 'is unsupported.');
    textAt(metadata.blockContractHash, `${label}.blockContractHash`, HASH, 512);
    stringArray('placementPath', true);
    if (metadata.parentPlacementPath !== undefined) stringArray('parentPlacementPath');
    if (metadata.sourceDefinitionId !== undefined)
      textAt(metadata.sourceDefinitionId, `${label}.sourceDefinitionId`, ID, 512);
    if (metadata.sourcePlacementPath !== undefined) stringArray('sourcePlacementPath', true);
    if (
      metadata.sourceExecutionScope !== undefined &&
      !new Set(['selected_workflow', 'unpruned_pipeline']).has(String(metadata.sourceExecutionScope))
    )
      invalid(`${label}.sourceExecutionScope`, 'is unsupported.');
    const sourceFields = [
      metadata.sourceDefinitionId,
      metadata.sourcePlacementPath,
      metadata.sourceExecutionScope,
    ].filter((item) => item !== undefined).length;
    if (sourceFields !== 0 && sourceFields !== 3)
      invalid(label, 'source definition, placement, and execution scope must be declared together.');
  }
  return metadata as unknown as BlockGraphNodeModularDiffusersV2;
}

function graphEdgeAt(value: unknown, label: string): BlockGraphEdgeV2 {
  const edge = objectAt(value, label);
  keysAt(edge, label, ['edgeId', 'sourceNodeId', 'sourcePortId', 'targetNodeId', 'targetPortId']);
  textAt(edge.edgeId, `${label}.edgeId`, ID, 384);
  textAt(edge.sourceNodeId, `${label}.sourceNodeId`, ID, 384);
  textAt(edge.sourcePortId, `${label}.sourcePortId`, ID, 384);
  textAt(edge.targetNodeId, `${label}.targetNodeId`, ID, 384);
  textAt(edge.targetPortId, `${label}.targetPortId`, ID, 384);
  return edge as BlockGraphEdgeV2;
}

function graphAt(value: unknown, label = 'Block graph V2'): BlockGraphV2 {
  const graph = objectAt(value, label);
  keysAt(graph, label, ['nodes', 'edges', 'graphHash'], ['executionOrder']);
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) invalid(label, 'nodes and edges must be arrays.');
  const nodes = graph.nodes.map((node, index) => graphNodeAt(node, `${label}.nodes[${index}]`));
  const edges = graph.edges.map((edge, index) => graphEdgeAt(edge, `${label}.edges[${index}]`));
  const nodeIds = nodes.map(({ nodeId }) => nodeId);
  const edgeIds = edges.map(({ edgeId }) => edgeId);
  unique(nodeIds, `${label}.nodes`);
  unique(edgeIds, `${label}.edges`);
  const nodeSet = new Set(nodeIds);
  edges.forEach((edge) => {
    if (!nodeSet.has(edge.sourceNodeId) || !nodeSet.has(edge.targetNodeId))
      invalid(label, `edge ${edge.edgeId} references an unknown node.`);
  });
  let executionOrder: string[] | undefined;
  if (graph.executionOrder !== undefined) {
    if (!Array.isArray(graph.executionOrder)) invalid(`${label}.executionOrder`, 'must be an array.');
    executionOrder = graph.executionOrder.map((nodeId, index) =>
      textAt(nodeId, `${label}.executionOrder[${index}]`, ID, 384),
    );
    unique(executionOrder, `${label}.executionOrder`);
    if (executionOrder.some((nodeId) => !nodeSet.has(nodeId)))
      invalid(`${label}.executionOrder`, 'references an unknown node.');
  }
  textAt(graph.graphHash, `${label}.graphHash`, HASH, 512);
  const parsed = { nodes, edges, ...(executionOrder ? { executionOrder } : {}), graphHash: String(graph.graphHash) };
  blockGraphParentIdsV2(parsed);
  nodes.forEach((node) => {
    if (node.containerInterface !== undefined) {
      const local = normalizeBlockContainerInterfaceV1(node.containerInterface, parsed, node.nodeId);
      const included = blockGraphSubtreeNodeIdsV2(parsed, node.nodeId);
      for (const edge of edges) {
        for (const direction of ['input', 'output'] as const) {
          const endpointId = direction === 'input' ? edge.targetNodeId : edge.sourceNodeId;
          const oppositeId = direction === 'input' ? edge.sourceNodeId : edge.targetNodeId;
          const fieldId = direction === 'input' ? edge.targetPortId : edge.sourcePortId;
          if (!included.has(endpointId) || (endpointId !== node.nodeId && included.has(oppositeId))) continue;
          if (
            !local.boundary[direction === 'input' ? 'inputs' : 'outputs'].some((port) =>
              [port.binding, ...(port.mirrorBindings ?? [])].some(
                (binding) => binding.nodeId === endpointId && binding.fieldOrPortId === fieldId,
              ),
            )
          ) {
            // Connected-only sockets are views of real internal fields, not
            // mandatory declarations in the reusable container interface.
            const endpoint = nodes.find((candidate) => candidate.nodeId === endpointId)!;
            const params = objectAt(endpoint.data.params, `${label} crossing endpoint params`);
            const field = objectAt(params[fieldId], `${label} crossing endpoint field`);
            if ((field.display === 'output') !== (direction === 'output'))
              invalid(
                label,
                `container ${node.nodeId} has an invalid connected ${direction} ${endpointId}.${fieldId}.`,
              );
          }
        }
      }
    }
  });
  const expectedHash = blockGraphHashV2(parsed);
  if (parsed.graphHash !== expectedHash) invalid(label, `graphHash must be ${expectedHash}.`);
  return parsed;
}

function portAt(value: unknown, label: string, graph: BlockGraphV2, direction: 'input' | 'output'): BlockPortV2 {
  const port = objectAt(value, label);
  keysAt(port, label, ['portId', 'label', 'valueType', 'required', 'binding'], ['multiple', 'mirrorBindings']);
  textAt(port.portId, `${label}.portId`, ID, 384);
  textAt(port.label, `${label}.label`, undefined, 512);
  textAt(port.valueType, `${label}.valueType`, undefined, 512);
  booleanAt(port.required, `${label}.required`);
  if (port.multiple !== undefined) booleanAt(port.multiple, `${label}.multiple`);
  const binding = objectAt(port.binding, `${label}.binding`);
  keysAt(binding, `${label}.binding`, ['nodeId', 'fieldOrPortId']);
  const nodeId = textAt(binding.nodeId, `${label}.binding.nodeId`, ID, 384);
  const nodeIds = new Set(graph.nodes.map(({ nodeId: graphNodeId }) => graphNodeId));
  if (!nodeIds.has(nodeId)) invalid(`${label}.binding`, `references unknown node ${nodeId}.`);
  const fieldOrPortId = textAt(binding.fieldOrPortId, `${label}.binding.fieldOrPortId`, FIELD_ID, 384);
  if (port.mirrorBindings !== undefined) {
    if (direction !== 'input') invalid(`${label}.mirrorBindings`, 'is supported only for public inputs.');
    if (!Array.isArray(port.mirrorBindings) || port.mirrorBindings.length === 0)
      invalid(`${label}.mirrorBindings`, 'must be a non-empty array when present.');
    const seen = new Set([`${nodeId}\0${fieldOrPortId}`]);
    let previousKey = '';
    port.mirrorBindings.forEach((candidate, index) => {
      const mirrorLabel = `${label}.mirrorBindings[${index}]`;
      const mirror = objectAt(candidate, mirrorLabel);
      keysAt(mirror, mirrorLabel, ['nodeId', 'fieldOrPortId']);
      const mirrorNodeId = textAt(mirror.nodeId, `${mirrorLabel}.nodeId`, ID, 384);
      const mirrorFieldId = textAt(mirror.fieldOrPortId, `${mirrorLabel}.fieldOrPortId`, FIELD_ID, 384);
      const key = `${mirrorNodeId}\0${mirrorFieldId}`;
      if (seen.has(key))
        invalid(`${label}.mirrorBindings`, 'must not duplicate the primary or another mirror binding.');
      if (previousKey && key <= previousKey)
        invalid(`${label}.mirrorBindings`, 'must be ordered canonically by nodeId and fieldOrPortId.');
      const node = graph.nodes.find(({ nodeId: graphNodeId }) => graphNodeId === mirrorNodeId);
      if (!node) invalid(mirrorLabel, `references unknown node ${mirrorNodeId}.`);
      const params = objectAt(node.data.params, `${mirrorLabel} target params`);
      const param = objectAt(params[mirrorFieldId], `${mirrorLabel} target field`);
      if (param.display === 'output') invalid(mirrorLabel, 'cannot target an output field.');
      if (
        !blockValueTypesAreCompatibleV2(port.valueType, param.type) &&
        !blockMediaFileBoundaryIsCompatibleV2(port.valueType, param)
      )
        invalid(mirrorLabel, 'targets an incompatible field type.');
      seen.add(key);
      previousKey = key;
    });
  }
  return port as unknown as BlockPortV2;
}

function boundaryAt(value: unknown, graph: BlockGraphV2, source: BlockSourceV2): BlockBoundaryV2 {
  const boundary = objectAt(value, 'Block boundary V2');
  keysAt(boundary, 'Block boundary V2', ['mode', 'inputs', 'outputs'], ['derivation']);
  if (boundary.mode !== 'explicit' && boundary.mode !== 'derived')
    invalid('Block boundary V2.mode', 'must be explicit or derived.');
  if ((source.kind === 'diffusers_catalog' || source.kind === 'transformers_catalog') && boundary.mode !== 'explicit')
    invalid('Block boundary V2', 'registered catalog definitions require an explicit boundary.');
  if (!Array.isArray(boundary.inputs) || !Array.isArray(boundary.outputs))
    invalid('Block boundary V2', 'inputs and outputs must be arrays.');
  const inputs = boundary.inputs.map((port, index) =>
    portAt(port, `Block boundary V2.inputs[${index}]`, graph, 'input'),
  );
  const outputs = boundary.outputs.map((port, index) =>
    portAt(port, `Block boundary V2.outputs[${index}]`, graph, 'output'),
  );
  unique(
    inputs.map(({ portId }) => portId),
    'Block boundary V2.inputs',
  );
  unique(
    outputs.map(({ portId }) => portId),
    'Block boundary V2.outputs',
  );
  // The shared renderer exposes both directions through one React Flow handle
  // namespace. A cross-direction collision would make one declared socket
  // overwrite the other in the projected connector map.
  unique(
    [...inputs, ...outputs].map(({ portId }) => portId),
    'Block boundary V2 public ports',
  );
  let derivation: BlockBoundaryV2['derivation'];
  if (boundary.derivation !== undefined) {
    const raw = objectAt(boundary.derivation, 'Block boundary V2.derivation');
    keysAt(raw, 'Block boundary V2.derivation', ['algorithmVersion', 'derivedAtDefinitionHash']);
    textAt(raw.algorithmVersion, 'Block boundary V2.derivation.algorithmVersion', undefined, 512);
    textAt(raw.derivedAtDefinitionHash, 'Block boundary V2.derivation.derivedAtDefinitionHash', HASH, 512);
    derivation = raw as BlockBoundaryV2['derivation'];
  }
  if (boundary.mode === 'derived' && !derivation)
    invalid('Block boundary V2', 'a derived boundary requires derivation metadata.');
  if (boundary.mode === 'explicit' && derivation)
    invalid('Block boundary V2', 'an explicit boundary cannot carry derivation metadata.');
  return { mode: boundary.mode, inputs, outputs, ...(derivation ? { derivation } : {}) };
}

function controlAt(value: unknown, label: string, graph: BlockGraphV2): BlockControlV2 {
  const control = objectAt(value, label);
  keysAt(
    control,
    label,
    ['controlId', 'label', 'binding', 'valueType', 'order'],
    ['defaultValue', 'required', 'sealed', 'group', 'help', 'mirrorBindings'],
  );
  textAt(control.controlId, `${label}.controlId`, ID, 384);
  textAt(control.label, `${label}.label`, undefined, 512);
  textAt(control.valueType, `${label}.valueType`, undefined, 512);
  const order = finiteNumberAt(control.order, `${label}.order`, 0);
  if (!Number.isInteger(order)) invalid(`${label}.order`, 'must be an integer.');
  if (control.defaultValue !== undefined) finiteJson(control.defaultValue, `${label}.defaultValue`);
  if (control.required !== undefined) booleanAt(control.required, `${label}.required`);
  if (control.sealed !== undefined) booleanAt(control.sealed, `${label}.sealed`);
  optionalTextAt(control.group, `${label}.group`, 512);
  optionalTextAt(control.help, `${label}.help`, 4096);
  const binding = objectAt(control.binding, `${label}.binding`);
  keysAt(binding, `${label}.binding`, ['nodeId', 'fieldId']);
  const nodeId = textAt(binding.nodeId, `${label}.binding.nodeId`, ID, 384);
  const nodeIds = new Set(graph.nodes.map(({ nodeId: graphNodeId }) => graphNodeId));
  if (!nodeIds.has(nodeId)) invalid(`${label}.binding`, `references unknown node ${nodeId}.`);
  const fieldId = textAt(binding.fieldId, `${label}.binding.fieldId`, FIELD_ID, 384);
  if (control.mirrorBindings !== undefined) {
    if (!Array.isArray(control.mirrorBindings) || control.mirrorBindings.length === 0)
      invalid(`${label}.mirrorBindings`, 'must be a non-empty array when present.');
    const primaryKey = `${nodeId}\0${fieldId}`;
    let previousKey = '';
    const seen = new Set([primaryKey]);
    control.mirrorBindings.forEach((candidate, index) => {
      const mirrorLabel = `${label}.mirrorBindings[${index}]`;
      const mirror = objectAt(candidate, mirrorLabel);
      keysAt(mirror, mirrorLabel, ['nodeId', 'fieldId']);
      const mirrorNodeId = textAt(mirror.nodeId, `${mirrorLabel}.nodeId`, ID, 384);
      const mirrorFieldId = textAt(mirror.fieldId, `${mirrorLabel}.fieldId`, FIELD_ID, 384);
      const key = `${mirrorNodeId}\0${mirrorFieldId}`;
      if (seen.has(key))
        invalid(`${label}.mirrorBindings`, 'must not duplicate the primary or another mirror binding.');
      if (previousKey && key <= previousKey)
        invalid(`${label}.mirrorBindings`, 'must be ordered canonically by nodeId and fieldId.');
      const node = graph.nodes.find(({ nodeId: graphNodeId }) => graphNodeId === mirrorNodeId);
      if (!node) invalid(mirrorLabel, `references unknown node ${mirrorNodeId}.`);
      const params = objectAt(node.data.params, `${mirrorLabel} target params`);
      const param = objectAt(params[mirrorFieldId], `${mirrorLabel} target field`);
      if (param.display === 'output') invalid(mirrorLabel, 'cannot target an output field.');
      if (!blockValueTypesAreCompatibleV2(control.valueType, param.type))
        invalid(mirrorLabel, 'targets an incompatible field type.');
      seen.add(key);
      previousKey = key;
    });
  }
  return control as unknown as BlockControlV2;
}

function controlsAt(value: unknown, graph: BlockGraphV2): BlockControlV2[] {
  if (!Array.isArray(value)) invalid('Block controls V2', 'must be an array.');
  const controls = value.map((control, index) => controlAt(control, `Block controls V2[${index}]`, graph));
  unique(
    controls.map(({ controlId }) => controlId),
    'Block controls V2',
  );
  unique(
    controls.map(({ order }) => String(order)),
    'Block controls V2 order',
  );
  if (controls.some((control, index) => control.order !== index))
    invalid('Block controls V2', 'must be ordered contiguously from zero.');
  return controls;
}

/** Strict reusable/workflow contract; declarations cannot reach a sibling or create hidden values. */
export function normalizeBlockContainerInterfaceV1(
  value: unknown,
  graph: BlockGraphV2,
  ownerNodeId: string,
): BlockContainerInterfaceV1 {
  const label = `Block container interface V1 (${ownerNodeId})`;
  const raw = objectAt(value, label);
  keysAt(raw, label, ['schemaVersion', 'boundary', 'controls'], ['previews']);
  if (raw.schemaVersion !== 1) invalid(label, 'schemaVersion must be 1.');
  const included = blockGraphSubtreeNodeIdsV2(graph, ownerNodeId);
  const scopedGraph = { ...graph, nodes: graph.nodes.filter(({ nodeId }) => included.has(nodeId)) };
  const boundary = boundaryAt(raw.boundary, scopedGraph, { kind: 'user' });
  if (boundary.mode !== 'explicit') invalid(label, 'the boundary must be explicit.');
  const controls = controlsAt(raw.controls, scopedGraph);
  const nodesById = new Map(scopedGraph.nodes.map((node) => [node.nodeId, node]));
  const validateField = (
    entry: { valueType: string },
    binding: { nodeId: string; fieldId?: string; fieldOrPortId?: string },
    direction: 'input' | 'output' | 'control',
  ) => {
    const fieldId = binding.fieldId ?? binding.fieldOrPortId!;
    const params = objectAt(nodesById.get(binding.nodeId)?.data.params, `${label} target params`);
    const param = objectAt(params[fieldId], `${label} target field ${binding.nodeId}.${fieldId}`);
    if ((direction === 'output') !== (param.display === 'output'))
      invalid(label, `field ${binding.nodeId}.${fieldId} has incompatible direction.`);
    if (
      !blockValueTypesAreCompatibleV2(entry.valueType, param.type) &&
      !(direction === 'input' && blockMediaFileBoundaryIsCompatibleV2(entry.valueType, param))
    )
      invalid(label, `field ${binding.nodeId}.${fieldId} has incompatible type.`);
  };
  const occupiedInputs = new Set<string>();
  for (const direction of ['input', 'output'] as const) {
    for (const port of boundary[direction === 'input' ? 'inputs' : 'outputs']) {
      for (const binding of [port.binding, ...(port.mirrorBindings ?? [])]) {
        validateField(port, binding, direction);
        const key = `${binding.nodeId}\0${binding.fieldOrPortId}`;
        if (direction === 'input' && occupiedInputs.has(key))
          invalid(label, 'an internal input cannot be exposed by multiple local ports.');
        if (direction === 'input') occupiedInputs.add(key);
      }
    }
  }
  const occupiedControls = new Set<string>();
  for (const control of controls) {
    if (Object.prototype.hasOwnProperty.call(control, 'defaultValue'))
      invalid(label, 'control defaults belong to the bound fields, not this view.');
    for (const binding of [control.binding, ...(control.mirrorBindings ?? [])]) {
      validateField(control, binding, 'control');
      const key = `${binding.nodeId}\0${binding.fieldId}`;
      if (occupiedControls.has(key)) invalid(label, 'a field cannot have multiple local controls.');
      occupiedControls.add(key);
    }
    const shared = boundary.inputs.find(({ portId }) => portId === control.controlId);
    if (shared) {
      const portTargets = [shared.binding, ...(shared.mirrorBindings ?? [])]
        .map(({ nodeId, fieldOrPortId }) => `${nodeId}\0${fieldOrPortId}`)
        .sort();
      const controlTargets = [control.binding, ...(control.mirrorBindings ?? [])]
        .map(({ nodeId, fieldId }) => `${nodeId}\0${fieldId}`)
        .sort();
      const mediaPathControl =
        blockValueTypesAreCompatibleV2(control.valueType, 'string') &&
        [shared.binding, ...(shared.mirrorBindings ?? [])].every((binding) => {
          const params = nodesById.get(binding.nodeId)?.data.params as Record<string, Record<string, unknown>>;
          const param = params[binding.fieldOrPortId];
          return Boolean(param && blockMediaFileBoundaryIsCompatibleV2(shared.valueType, param));
        });
      if (
        canonicalBlockStringifyV2(portTargets) !== canonicalBlockStringifyV2(controlTargets) ||
        (shared.valueType !== control.valueType && !mediaPathControl)
      )
        invalid(label, 'a shared input/control ID must bind the same complete field set and type.');
    }
  }
  const previews = raw.previews === undefined ? undefined : previewsAt(raw.previews, scopedGraph);
  for (const preview of previews ?? []) {
    const params = objectAt(nodesById.get(preview.nodeId)?.data.params, `${label} preview params`);
    const field = objectAt(params[preview.outputPortId], `${label} preview field`);
    const expectedDisplay = preview.mediaType === 'file' ? 'ui_text' : `ui_${preview.mediaType}`;
    // Backend preview widgets transport media as URLs/base64, not image tensors.
    // An explicitly declared media widget supplies the modality of that transport.
    const transportedPreview =
      field.display === expectedDisplay &&
      (field.type === undefined ||
        (Array.isArray(field.type) ? field.type : [field.type]).some(
          (type) => typeof type === 'string' && /^(url|uri|path|string|str|base64)$/iu.test(type),
        ));
    if (
      (!transportedPreview && !blockValueTypeMatchesMediaV2(field.type, preview.mediaType)) ||
      (field.display !== 'output' && field.display !== expectedDisplay)
    )
      invalid(label, `preview ${preview.nodeId}.${preview.outputPortId} has incompatible type or display.`);
  }
  return jsonClone(
    { schemaVersion: 1, boundary, controls, ...(previews === undefined ? {} : { previews }) },
    label,
    MAX_DEFINITION_BYTES,
  );
}

/** One inventory, root bindings first, then first-seen local bindings in graph
 * order. Primary selection belongs to each surface; shared sources have one
 * state. Callers validate definitions/graphs before using this helper.
 */
export function blockInstancePreviewBindingsV2(
  definition: Pick<BlockDefinitionV2, 'previews'>,
  graph: BlockGraphV2,
): BlockPreviewBindingV2[] {
  const nodeIds = new Set(graph.nodes.map(({ nodeId }) => nodeId));
  const bindings = definition.previews
    .filter((binding) => nodeIds.has(binding.nodeId))
    .map((binding) => ({ ...binding }));
  const bySource = new Map(bindings.map((binding) => [`${binding.nodeId}\0${binding.outputPortId}`, binding]));
  for (const node of graph.nodes)
    for (const preview of node.containerInterface?.previews ?? []) {
      const key = `${preview.nodeId}\0${preview.outputPortId}`;
      const existing = bySource.get(key);
      if (existing && existing.mediaType !== preview.mediaType)
        invalid('Block preview inventory V2', `conflicting media types for ${preview.nodeId}.${preview.outputPortId}.`);
      if (existing) continue;
      const binding = { ...preview };
      delete binding.primary;
      bindings.push(binding);
      bySource.set(key, binding);
    }
  return bindings;
}

function suggestionsAt(value: unknown, controls: BlockControlV2[]): SuggestedInputSetV2[] {
  if (!Array.isArray(value)) invalid('Block suggested inputs V2', 'must be an array.');
  const controlIds = new Set(controls.map(({ controlId }) => controlId));
  const suggestions = value.map((candidate, index): SuggestedInputSetV2 => {
    const label = `Block suggested inputs V2[${index}]`;
    const suggestion = objectAt(candidate, label);
    keysAt(suggestion, label, ['suggestionId', 'label', 'values'], ['source']);
    textAt(suggestion.suggestionId, `${label}.suggestionId`, ID, 384);
    textAt(suggestion.label, `${label}.label`, undefined, 512);
    optionalTextAt(suggestion.source, `${label}.source`, 2048);
    const values = objectAt(suggestion.values, `${label}.values`);
    Object.entries(values).forEach(([controlId, entry]) => {
      if (!controlIds.has(controlId)) invalid(`${label}.values`, `references unknown control ${controlId}.`);
      finiteJson(entry, `${label}.values.${controlId}`);
    });
    return suggestion as unknown as SuggestedInputSetV2;
  });
  unique(
    suggestions.map(({ suggestionId }) => suggestionId),
    'Block suggested inputs V2',
  );
  return suggestions;
}

function previewBindingAt(value: unknown, label: string, graph: BlockGraphV2): BlockPreviewBindingV2 {
  const preview = objectAt(value, label);
  keysAt(preview, label, ['nodeId', 'outputPortId', 'mediaType'], ['primary']);
  const nodeId = textAt(preview.nodeId, `${label}.nodeId`, ID, 384);
  if (!graph.nodes.some((node) => node.nodeId === nodeId)) invalid(label, `references unknown node ${nodeId}.`);
  textAt(preview.outputPortId, `${label}.outputPortId`, FIELD_ID, 384);
  if (!['image', 'video', 'audio', 'text', 'file'].includes(String(preview.mediaType)))
    invalid(`${label}.mediaType`, 'is unsupported.');
  if (preview.primary !== undefined) booleanAt(preview.primary, `${label}.primary`);
  return preview as BlockPreviewBindingV2;
}

function previewsAt(value: unknown, graph: BlockGraphV2): BlockPreviewBindingV2[] {
  if (!Array.isArray(value)) invalid('Block preview bindings V2', 'must be an array.');
  const previews = value.map((preview, index) =>
    previewBindingAt(preview, `Block preview bindings V2[${index}]`, graph),
  );
  unique(
    previews.map(({ nodeId, outputPortId }) => `${nodeId}\0${outputPortId}`),
    'Block preview bindings V2',
  );
  if (previews.filter(({ primary }) => primary).length > 1)
    invalid('Block preview bindings V2', 'may contain at most one primary preview.');
  return previews;
}

function ownershipAt(value: unknown, source: BlockSourceV2): BlockDefinitionV2['ownership'] {
  const ownership = objectAt(value, 'Block ownership V2');
  keysAt(ownership, 'Block ownership V2', ['kind', 'definitionMutable']);
  if (ownership.kind !== 'registered' && ownership.kind !== 'user')
    invalid('Block ownership V2.kind', 'is unsupported.');
  booleanAt(ownership.definitionMutable, 'Block ownership V2.definitionMutable');
  const catalog = source.kind === 'diffusers_catalog' || source.kind === 'transformers_catalog';
  if (catalog && (ownership.kind !== 'registered' || ownership.definitionMutable !== false))
    invalid('Block ownership V2', 'catalog definitions must be registered and immutable.');
  if (!catalog && (ownership.kind !== 'user' || ownership.definitionMutable !== true))
    invalid('Block ownership V2', 'Hub imports and User Nodes must be mutable user-owned definitions.');
  return ownership as BlockDefinitionV2['ownership'];
}

/** Strictly validate, hash-check, and JSON-clone a persisted V2 definition. */
export function normalizeBlockDefinitionV2(value: unknown): BlockDefinitionV2 {
  const definition = objectAt(value, 'Block Definition V2');
  keysAt(
    definition,
    'Block Definition V2',
    [
      'schemaVersion',
      'definitionId',
      'displayName',
      'contentHash',
      'source',
      'graph',
      'boundary',
      'controls',
      'previews',
      'ownership',
    ],
    ['description', 'suggestedInputs'],
  );
  if (definition.schemaVersion !== 2) invalid('Block Definition V2', 'schemaVersion must be 2.');
  textAt(definition.definitionId, 'Block Definition V2.definitionId', ID, 384);
  textAt(definition.displayName, 'Block Definition V2.displayName', undefined, 512);
  optionalTextAt(definition.description, 'Block Definition V2.description', 4096);
  textAt(definition.contentHash, 'Block Definition V2.contentHash', HASH, 512);
  const source = sourceAt(definition.source);
  const graph = graphAt(definition.graph);
  const boundary = boundaryAt(definition.boundary, graph, source);
  const controls = controlsAt(definition.controls, graph);
  const inputsById = new Map(boundary.inputs.map((input) => [input.portId, input]));
  controls.forEach((control) => {
    const sharedInput = inputsById.get(control.controlId);
    if (
      sharedInput &&
      (sharedInput.binding.nodeId !== control.binding.nodeId ||
        sharedInput.binding.fieldOrPortId !== control.binding.fieldId)
    )
      invalid(
        'Block Definition V2',
        `input and control ${control.controlId} share an id but bind different graph fields.`,
      );
  });
  if (definition.suggestedInputs !== undefined) suggestionsAt(definition.suggestedInputs, controls);
  blockInstancePreviewBindingsV2({ previews: previewsAt(definition.previews, graph) }, graph);
  ownershipAt(definition.ownership, source);
  const candidate = definition as unknown as BlockDefinitionV2;
  const expectedHash = blockDefinitionContentHashV2(candidate);
  if (candidate.contentHash !== expectedHash) invalid('Block Definition V2', `contentHash must be ${expectedHash}.`);
  return jsonClone(candidate, 'Block Definition V2', MAX_DEFINITION_BYTES);
}

function previewStateAt(value: unknown, graph: BlockGraphV2): BlockPreviewStateV2 {
  const preview = objectAt(value, 'Block preview state V2');
  keysAt(preview, 'Block preview state V2', ['binding'], ['mediaReference', 'taskId', 'status']);
  previewBindingAt(preview.binding, 'Block preview state V2.binding', graph);
  optionalTextAt(preview.mediaReference, 'Block preview state V2.mediaReference', 8192);
  optionalTextAt(preview.taskId, 'Block preview state V2.taskId', 512);
  if (
    preview.status !== undefined &&
    !['idle', 'queued', 'running', 'complete', 'failed'].includes(String(preview.status))
  )
    invalid('Block preview state V2.status', 'is unsupported.');
  return preview as unknown as BlockPreviewStateV2;
}

function isoTimestampAt(value: unknown, label: string) {
  const text = textAt(value, label, undefined, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(text) || !Number.isFinite(Date.parse(text)))
    invalid(label, 'must be an ISO-8601 UTC timestamp.');
  return text;
}

function authorityAt(value: unknown, instance: Pick<BlockInstanceV2, 'definitionRef' | 'effectiveGraph'>) {
  const authority = objectAt(value, 'Block authority receipt V2');
  keysAt(
    authority,
    'Block authority receipt V2',
    [
      'kind',
      'definitionId',
      'definitionContentHash',
      'effectiveGraphHash',
      'executionParameterHash',
      'artifactRevisions',
      'admissionId',
      'issuedAt',
    ],
    ['expiresAt'],
  );
  if (!['reviewed_execution', 'auto', 'publication'].includes(String(authority.kind)))
    invalid('Block authority receipt V2.kind', 'is unsupported.');
  textAt(authority.definitionId, 'Block authority receipt V2.definitionId', ID, 384);
  textAt(authority.definitionContentHash, 'Block authority receipt V2.definitionContentHash', HASH, 512);
  textAt(authority.effectiveGraphHash, 'Block authority receipt V2.effectiveGraphHash', HASH, 512);
  textAt(authority.executionParameterHash, 'Block authority receipt V2.executionParameterHash', HASH, 512);
  textAt(authority.admissionId, 'Block authority receipt V2.admissionId', undefined, 512);
  isoTimestampAt(authority.issuedAt, 'Block authority receipt V2.issuedAt');
  if (authority.expiresAt !== undefined) {
    const expiresAt = isoTimestampAt(authority.expiresAt, 'Block authority receipt V2.expiresAt');
    if (Date.parse(expiresAt) <= Date.parse(String(authority.issuedAt)))
      invalid('Block authority receipt V2', 'expiresAt must follow issuedAt.');
  }
  const revisions = objectAt(authority.artifactRevisions, 'Block authority receipt V2.artifactRevisions');
  Object.entries(revisions).forEach(([repository, revision]) => {
    textAt(repository, 'Block authority receipt V2 artifact repository', REPOSITORY_ID, 384);
    textAt(revision, `Block authority receipt V2.artifactRevisions.${repository}`, COMMIT, 40);
  });
  if (
    authority.definitionId !== instance.definitionRef.definitionId ||
    authority.definitionContentHash !== instance.definitionRef.contentHash ||
    authority.effectiveGraphHash !== instance.effectiveGraph.graphHash
  )
    invalid('Block authority receipt V2', 'does not describe the current definition and effective graph.');
  return authority as unknown as BlockAuthorityReceiptV2;
}

/** Strictly validate, hash-check, and JSON-clone a workflow-owned instance. */
export function normalizeBlockInstanceV2(value: unknown): BlockInstanceV2 {
  const instance = objectAt(value, 'Block Instance V2');
  // `effectiveInterface` was added as an instance-only V2 extension. Its
  // absence is the one admitted legacy form and deterministically migrates to
  // the embedded definition interface. Unknown fields still fail closed.
  keysAt(
    instance,
    'Block Instance V2',
    [
      'schemaVersion',
      'instanceId',
      'definitionRef',
      'definitionSnapshot',
      'effectiveGraph',
      'values',
      'customization',
      'presentation',
      'previewStates',
      'authorities',
    ],
    ['effectiveInterface', 'routeSelection'],
  );
  if (instance.schemaVersion !== 2) invalid('Block Instance V2', 'schemaVersion must be 2.');
  textAt(instance.instanceId, 'Block Instance V2.instanceId', ID, 384);
  const definitionRef = objectAt(instance.definitionRef, 'Block Instance V2.definitionRef');
  keysAt(definitionRef, 'Block Instance V2.definitionRef', ['definitionId', 'contentHash']);
  textAt(definitionRef.definitionId, 'Block Instance V2.definitionRef.definitionId', ID, 384);
  textAt(definitionRef.contentHash, 'Block Instance V2.definitionRef.contentHash', HASH, 512);
  const definitionSnapshot = normalizeBlockDefinitionV2(instance.definitionSnapshot);
  if (
    definitionRef.definitionId !== definitionSnapshot.definitionId ||
    definitionRef.contentHash !== definitionSnapshot.contentHash
  )
    invalid('Block Instance V2.definitionRef', 'does not match the embedded definition snapshot.');
  const effectiveGraph = graphAt(instance.effectiveGraph, 'Block Instance V2.effectiveGraph');

  const baseInterfaceHash = blockInterfaceHashV2({
    boundary: definitionSnapshot.boundary,
    controls: definitionSnapshot.controls,
  });
  const rawEffectiveInterface = instance.effectiveInterface ?? {
    boundary: definitionSnapshot.boundary,
    controls: definitionSnapshot.controls,
    baseInterfaceHash,
    effectiveInterfaceHash: baseInterfaceHash,
  };
  const effectiveInterfaceObject = objectAt(rawEffectiveInterface, 'Block effective interface V2');
  keysAt(effectiveInterfaceObject, 'Block effective interface V2', [
    'boundary',
    'controls',
    'baseInterfaceHash',
    'effectiveInterfaceHash',
  ]);
  const interfaceSource: BlockSourceV2 =
    definitionSnapshot.source.kind === 'diffusers_catalog' || definitionSnapshot.source.kind === 'transformers_catalog'
      ? definitionSnapshot.source
      : { kind: 'user' };
  const effectiveBoundary = boundaryAt(effectiveInterfaceObject.boundary, effectiveGraph, interfaceSource);
  const effectiveControls = controlsAt(effectiveInterfaceObject.controls, effectiveGraph);
  const effectiveInputsById = new Map(effectiveBoundary.inputs.map((input) => [input.portId, input]));
  effectiveControls.forEach((control) => {
    const sharedInput = effectiveInputsById.get(control.controlId);
    if (
      sharedInput &&
      (sharedInput.binding.nodeId !== control.binding.nodeId ||
        sharedInput.binding.fieldOrPortId !== control.binding.fieldId)
    )
      invalid(
        'Block effective interface V2',
        `input and control ${control.controlId} share an id but bind different graph fields.`,
      );
  });
  textAt(effectiveInterfaceObject.baseInterfaceHash, 'Block effective interface V2.baseInterfaceHash', HASH, 512);
  textAt(
    effectiveInterfaceObject.effectiveInterfaceHash,
    'Block effective interface V2.effectiveInterfaceHash',
    HASH,
    512,
  );
  if (effectiveInterfaceObject.baseInterfaceHash !== baseInterfaceHash)
    invalid('Block effective interface V2.baseInterfaceHash', 'does not match the definition interface.');
  const expectedEffectiveInterfaceHash = blockInterfaceHashV2({
    boundary: effectiveBoundary,
    controls: effectiveControls,
  });
  if (effectiveInterfaceObject.effectiveInterfaceHash !== expectedEffectiveInterfaceHash)
    invalid('Block effective interface V2.effectiveInterfaceHash', `must be ${expectedEffectiveInterfaceHash}.`);
  const effectiveInterface: BlockEffectiveInterfaceV2 = {
    boundary: effectiveBoundary,
    controls: effectiveControls,
    baseInterfaceHash,
    effectiveInterfaceHash: expectedEffectiveInterfaceHash,
  };

  const values = objectAt(instance.values, 'Block Instance V2.values');
  const valueIds = new Set([
    ...effectiveControls.map(({ controlId }) => controlId),
    ...effectiveBoundary.inputs.map(({ portId }) => portId),
  ]);
  Object.entries(values).forEach(([valueId, controlValue]) => {
    if (!valueIds.has(valueId)) invalid('Block Instance V2.values', `contains unknown input/control ${valueId}.`);
    finiteJson(controlValue, `Block Instance V2.values.${valueId}`);
  });

  const customization = objectAt(instance.customization, 'Block Instance V2.customization');
  keysAt(customization, 'Block Instance V2.customization', ['state', 'baseGraphHash', 'effectiveGraphHash']);
  if (!['unchanged', 'parameters_changed', 'structure_changed'].includes(String(customization.state)))
    invalid('Block Instance V2.customization.state', 'is unsupported.');
  textAt(customization.baseGraphHash, 'Block Instance V2.customization.baseGraphHash', HASH, 512);
  textAt(customization.effectiveGraphHash, 'Block Instance V2.customization.effectiveGraphHash', HASH, 512);
  if (customization.baseGraphHash !== definitionSnapshot.graph.graphHash)
    invalid('Block Instance V2.customization.baseGraphHash', 'does not match the definition graph.');
  if (customization.effectiveGraphHash !== effectiveGraph.graphHash)
    invalid('Block Instance V2.customization.effectiveGraphHash', 'does not match the effective graph.');
  const structureChanged =
    effectiveGraph.graphHash !== definitionSnapshot.graph.graphHash ||
    effectiveInterface.effectiveInterfaceHash !== effectiveInterface.baseInterfaceHash;
  if (customization.state !== 'structure_changed' && structureChanged)
    invalid('Block Instance V2.customization', 'only structure_changed may use a changed graph or interface.');
  if (customization.state === 'structure_changed' && !structureChanged)
    invalid('Block Instance V2.customization', 'structure_changed requires a different graph or interface.');

  const presentation = objectAt(instance.presentation, 'Block Instance V2.presentation');
  keysAt(
    presentation,
    'Block Instance V2.presentation',
    ['expanded', 'position', 'size', 'internalLayout'],
    ['internalLayoutMode', 'collapsedContainerNodeIds'],
  );
  booleanAt(presentation.expanded, 'Block Instance V2.presentation.expanded');
  const position = objectAt(presentation.position, 'Block Instance V2.presentation.position');
  keysAt(position, 'Block Instance V2.presentation.position', ['x', 'y']);
  finiteNumberAt(position.x, 'Block Instance V2.presentation.position.x');
  finiteNumberAt(position.y, 'Block Instance V2.presentation.position.y');
  const size = objectAt(presentation.size, 'Block Instance V2.presentation.size');
  keysAt(size, 'Block Instance V2.presentation.size', ['width', 'height']);
  finiteNumberAt(size.width, 'Block Instance V2.presentation.size.width', 1);
  finiteNumberAt(size.height, 'Block Instance V2.presentation.size.height', 1);
  if (
    presentation.internalLayoutMode !== undefined &&
    presentation.internalLayoutMode !== 'root' &&
    presentation.internalLayoutMode !== 'hierarchical'
  )
    invalid('Block Instance V2.presentation.internalLayoutMode', 'must be root or hierarchical.');
  const internalLayout = objectAt(presentation.internalLayout, 'Block Instance V2.presentation.internalLayout');
  const effectiveNodeIds = new Set(effectiveGraph.nodes.map(({ nodeId }) => nodeId));
  if (presentation.collapsedContainerNodeIds !== undefined) {
    if (
      !Array.isArray(presentation.collapsedContainerNodeIds) ||
      presentation.collapsedContainerNodeIds.length > effectiveGraph.nodes.length ||
      new Set(presentation.collapsedContainerNodeIds).size !== presentation.collapsedContainerNodeIds.length
    )
      invalid('Block Instance V2.presentation.collapsedContainerNodeIds', 'must be a bounded unique array.');
    const modularContainerNodeIds = new Set(blockModularContainerNodeIdsV2(effectiveGraph));
    presentation.collapsedContainerNodeIds.forEach((nodeId, index) => {
      textAt(nodeId, `Block Instance V2.presentation.collapsedContainerNodeIds.${index}`, ID, 384);
      if (!modularContainerNodeIds.has(nodeId))
        invalid('Block Instance V2.presentation.collapsedContainerNodeIds', `references non-container node ${nodeId}.`);
    });
  }
  Object.entries(internalLayout).forEach(([nodeId, rawLayout]) => {
    if (!effectiveNodeIds.has(nodeId))
      invalid('Block Instance V2.presentation.internalLayout', `references unknown node ${nodeId}.`);
    const layout = objectAt(rawLayout, `Block Instance V2.presentation.internalLayout.${nodeId}`);
    keysAt(layout, `Block Instance V2.presentation.internalLayout.${nodeId}`, ['x', 'y'], ['width', 'height']);
    finiteNumberAt(layout.x, `Block Instance V2.presentation.internalLayout.${nodeId}.x`);
    finiteNumberAt(layout.y, `Block Instance V2.presentation.internalLayout.${nodeId}.y`);
    if (layout.width !== undefined)
      finiteNumberAt(layout.width, `Block Instance V2.presentation.internalLayout.${nodeId}.width`, 1);
    if (layout.height !== undefined)
      finiteNumberAt(layout.height, `Block Instance V2.presentation.internalLayout.${nodeId}.height`, 1);
  });

  if (!Array.isArray(instance.previewStates)) invalid('Block Instance V2.previewStates', 'must be an array.');
  // Preview bindings are part of the preserved public definition surface.
  // A structural edit may break the effective source and must then surface a
  // composition/runtime issue; it must not make the workflow unloadable or
  // silently rewrite the binding.
  const expectedPreviews = blockInstancePreviewBindingsV2(definitionSnapshot, effectiveGraph);
  const previewGraph = { ...effectiveGraph, nodes: [...definitionSnapshot.graph.nodes, ...effectiveGraph.nodes] };
  const previewStates = instance.previewStates.map((preview) => previewStateAt(preview, previewGraph));
  if (
    previewStates.length !== expectedPreviews.length ||
    previewStates.some(
      (preview, index) =>
        canonicalBlockStringifyV2(preview.binding) !== canonicalBlockStringifyV2(expectedPreviews[index]),
    )
  )
    invalid('Block Instance V2.previewStates', 'must preserve the ordered definition and local preview bindings.');

  if (!Array.isArray(instance.authorities)) invalid('Block Instance V2.authorities', 'must be an array.');
  const authorityContext = {
    definitionRef: definitionRef as BlockInstanceV2['definitionRef'],
    effectiveGraph,
  };
  const authorities = instance.authorities.map((authority) => authorityAt(authority, authorityContext));
  unique(
    authorities.map(({ kind }) => kind),
    'Block Instance V2.authorities',
  );
  let routeSelection: BlockRouteSelectionV1 | undefined;
  if (instance.routeSelection !== undefined) {
    const selection = objectAt(instance.routeSelection, 'Block route selection V1');
    keysAt(selection, 'Block route selection V1', [
      'schemaVersion',
      'routeSetId',
      'selectedRouteKey',
      'inactiveDrafts',
    ]);
    if (selection.schemaVersion !== 1) invalid('Block route selection V1', 'schemaVersion must be 1.');
    const routeSetId = textAt(selection.routeSetId, 'Block route selection V1.routeSetId', ID, 384);
    const selectedRouteKey = textAt(selection.selectedRouteKey, 'Block route selection V1.selectedRouteKey', ID, 384);
    const rawDrafts = objectAt(selection.inactiveDrafts, 'Block route selection V1.inactiveDrafts');
    if (Object.keys(rawDrafts).length > 8)
      invalid('Block route selection V1.inactiveDrafts', 'may contain at most 8 exact-route drafts.');
    if (Object.prototype.hasOwnProperty.call(rawDrafts, selectedRouteKey))
      invalid('Block route selection V1.inactiveDrafts', 'must not contain the selected active route.');
    const inactiveDrafts = Object.fromEntries(
      Object.entries(rawDrafts).map(([draftKey, rawDraft]) => {
        textAt(draftKey, 'Block route selection V1 draft key', ID, 384);
        const draft = objectAt(rawDraft, `Block route draft V1 ${draftKey}`);
        keysAt(
          draft,
          `Block route draft V1 ${draftKey}`,
          [
            'schemaVersion',
            'routeKey',
            'definitionRef',
            'definitionSnapshot',
            'effectiveGraph',
            'effectiveInterface',
            'values',
            'customization',
            'internalLayout',
          ],
          ['internalLayoutMode', 'collapsedContainerNodeIds'],
        );
        if (draft.schemaVersion !== 1) invalid(`Block route draft V1 ${draftKey}`, 'schemaVersion must be 1.');
        if (draft.routeKey !== draftKey)
          invalid(`Block route draft V1 ${draftKey}`, 'routeKey must match its inactiveDrafts key.');
        const draftDefinition = normalizeBlockDefinitionV2(draft.definitionSnapshot);
        if (
          !(routeSetId === 'diffusers.definition-switch:v1' && draftDefinition.source.kind === 'user') &&
          (draftDefinition.ownership.kind !== 'registered' ||
            draftDefinition.ownership.definitionMutable ||
            (draftDefinition.source.kind !== 'diffusers_catalog' &&
              draftDefinition.source.kind !== 'transformers_catalog'))
        )
          invalid(`Block route draft V1 ${draftKey}`, 'must contain one immutable registered definition.');
        const draftPreviews = blockInstancePreviewBindingsV2(draftDefinition, graphAt(draft.effectiveGraph)).map(
          (binding) => ({ binding, status: 'idle' as const }),
        );
        const validated = normalizeBlockInstanceV2({
          schemaVersion: 2,
          instanceId: draftKey,
          definitionRef: draft.definitionRef,
          definitionSnapshot: draftDefinition,
          effectiveGraph: draft.effectiveGraph,
          effectiveInterface: draft.effectiveInterface,
          values: draft.values,
          customization: draft.customization,
          presentation: {
            expanded: false,
            position: { x: 0, y: 0 },
            size: { width: 1, height: 1 },
            internalLayout: draft.internalLayout,
            ...(draft.internalLayoutMode ? { internalLayoutMode: draft.internalLayoutMode } : {}),
            ...(draft.collapsedContainerNodeIds ? { collapsedContainerNodeIds: draft.collapsedContainerNodeIds } : {}),
          },
          previewStates: draftPreviews,
          authorities: [],
        });
        return [
          draftKey,
          {
            schemaVersion: 1 as const,
            routeKey: draftKey,
            definitionRef: validated.definitionRef,
            definitionSnapshot: validated.definitionSnapshot,
            effectiveGraph: validated.effectiveGraph,
            effectiveInterface: validated.effectiveInterface,
            values: validated.values,
            customization: validated.customization,
            internalLayout: validated.presentation.internalLayout,
            ...(validated.presentation.internalLayoutMode
              ? { internalLayoutMode: validated.presentation.internalLayoutMode }
              : {}),
            ...(validated.presentation.collapsedContainerNodeIds
              ? { collapsedContainerNodeIds: validated.presentation.collapsedContainerNodeIds }
              : {}),
          },
        ];
      }),
    );
    routeSelection = { schemaVersion: 1, routeSetId, selectedRouteKey, inactiveDrafts };
  }
  return jsonClone(
    { ...instance, effectiveInterface, ...(routeSelection ? { routeSelection } : {}) },
    'Block Instance V2',
    MAX_INSTANCE_BYTES,
  ) as unknown as BlockInstanceV2;
}

/** Absence alone falls back; explicit empty string, false, zero, and null win. */
export function blockInstanceValueV2(instance: BlockInstanceV2, valueId: string): BlockJsonValue | undefined {
  if (Object.prototype.hasOwnProperty.call(instance.values, valueId)) return instance.values[valueId];
  return instance.effectiveInterface.controls.find((control) => control.controlId === valueId)?.defaultValue;
}

/** Create and validate a deterministic, independent insertion. */
export function createBlockInstanceV2(
  definitionValue: BlockDefinitionV2,
  options: {
    instanceId: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    values?: Record<string, BlockJsonValue>;
    internalLayout?: BlockInstanceV2['presentation']['internalLayout'];
    internalLayoutMode?: NonNullable<BlockInstanceV2['presentation']['internalLayoutMode']>;
    collapsedContainerNodeIds?: string[];
    /**
     * A compiler/importer that materializes a reviewed definition's own
     * starter values may mark that materialized snapshot as its baseline.
     * Generic callers omit this and retain value-vs-default inference.
     */
    baselineValues?: boolean;
  },
): BlockInstanceV2 {
  const definition = normalizeBlockDefinitionV2(definitionValue);
  const values = options.values ?? {};
  const collapsedContainerNodeIds =
    options.collapsedContainerNodeIds ?? blockModularContainerNodeIdsV2(definition.graph);
  const controlledValueIds = new Set(definition.controls.map(({ controlId }) => controlId));
  const defaultsDiffer =
    // A public input that is also an exposed control has a reviewed default
    // and is compared below. Treating its mere presence as customization made
    // every freshly inserted registered Block dirty, because the compiler
    // materializes creator/default values eagerly. Boundary-only inputs have
    // no definition-owned default and remain workflow-local when supplied.
    definition.boundary.inputs.some(
      ({ portId }) => !controlledValueIds.has(portId) && Object.prototype.hasOwnProperty.call(values, portId),
    ) ||
    definition.controls.some(
      (control) =>
        Object.prototype.hasOwnProperty.call(values, control.controlId) &&
        canonicalBlockStringifyV2(values[control.controlId]) !== canonicalBlockStringifyV2(control.defaultValue),
    );
  return normalizeBlockInstanceV2({
    schemaVersion: 2,
    instanceId: options.instanceId,
    definitionRef: { definitionId: definition.definitionId, contentHash: definition.contentHash },
    definitionSnapshot: definition,
    effectiveGraph: definition.graph,
    effectiveInterface: {
      boundary: definition.boundary,
      controls: definition.controls,
      baseInterfaceHash: blockInterfaceHashV2({ boundary: definition.boundary, controls: definition.controls }),
      effectiveInterfaceHash: blockInterfaceHashV2({ boundary: definition.boundary, controls: definition.controls }),
    },
    values,
    customization: {
      state: options.baselineValues ? 'unchanged' : defaultsDiffer ? 'parameters_changed' : 'unchanged',
      baseGraphHash: definition.graph.graphHash,
      effectiveGraphHash: definition.graph.graphHash,
    },
    presentation: {
      expanded: false,
      position: options.position,
      size: options.size,
      ...(options.internalLayoutMode ? { internalLayoutMode: options.internalLayoutMode } : {}),
      ...(collapsedContainerNodeIds.length ? { collapsedContainerNodeIds } : {}),
      internalLayout: options.internalLayout ?? {},
    },
    previewStates: blockInstancePreviewBindingsV2(definition, definition.graph).map((binding) => ({
      binding,
      status: 'idle',
    })),
    authorities: [],
  });
}

function legacyRecord(value: unknown) {
  return record(value) ? value : {};
}

function legacyNodeId(value: unknown, label: string) {
  return textAt(legacyRecord(value).id, label, ID, 384);
}

function legacyNodeData(value: unknown): BlockJsonObject {
  const data = legacyRecord(legacyRecord(value).data);
  const presentationKeys = new Set([
    'uiState',
    'executionProgress',
    'outputSummary',
    'userBlockInstanceId',
    'userBlockSourceNodeId',
  ]);
  const semantic = Object.fromEntries(Object.entries(data).filter(([key]) => !presentationKeys.has(key)));
  return jsonClone(semantic, 'legacy User Node node data', MAX_DEFINITION_BYTES) as BlockJsonObject;
}

function graphFromLegacyBlock(block: UserBlockDefinition, controls: readonly AppModeInput[]) {
  const nodes: BlockGraphNodeV2[] = block.nodes.map((value, index) => {
    const candidate = legacyRecord(value);
    const data = legacyRecord(candidate.data);
    return {
      nodeId: legacyNodeId(value, `legacy User Node nodes[${index}].id`),
      nodeType:
        (typeof candidate.type === 'string' && candidate.type) ||
        (typeof data.type === 'string' && data.type) ||
        'custom',
      data: legacyNodeData(value),
    };
  });
  const studioControls = controls.filter((control) => control.kind === 'studio-form');
  let studioBindingNodeId = '__legacy_studio_form__';
  while (nodes.some(({ nodeId }) => nodeId === studioBindingNodeId)) studioBindingNodeId = `_${studioBindingNodeId}`;
  if (studioControls.length) {
    nodes.push({
      nodeId: studioBindingNodeId,
      nodeType: 'modiff.legacy.studio-form-binding',
      semanticRole: 'legacy_studio_form_binding',
      data: {
        hidden: true,
        formKeys: studioControls.map((control) => control.formKey ?? control.id),
      },
    });
  }
  const edges: BlockGraphEdgeV2[] = block.edges.map((value, index) => {
    const candidate = legacyRecord(value);
    return {
      edgeId: textAt(candidate.id, `legacy User Node edges[${index}].id`, ID, 384),
      sourceNodeId: textAt(candidate.source, `legacy User Node edges[${index}].source`, ID, 384),
      sourcePortId:
        typeof candidate.sourceHandle === 'string' && candidate.sourceHandle
          ? candidate.sourceHandle
          : `legacy-output-${index}`,
      targetNodeId: textAt(candidate.target, `legacy User Node edges[${index}].target`, ID, 384),
      targetPortId:
        typeof candidate.targetHandle === 'string' && candidate.targetHandle
          ? candidate.targetHandle
          : `legacy-input-${index}`,
    };
  });
  const unhashed = { nodes, edges };
  return { ...unhashed, graphHash: blockGraphHashV2(unhashed) };
}

function valueTypeFromLegacy(type: UserBlockPort['type'] | undefined) {
  if (Array.isArray(type)) return type.length ? type.join('|') : 'any';
  return type || 'any';
}

function portFromLegacy(port: UserBlockPort): BlockPortV2 {
  return {
    portId: port.id,
    label: port.label,
    valueType: valueTypeFromLegacy(port.type),
    required: false,
    binding: { nodeId: port.nodeId, fieldOrPortId: port.paramKey },
  };
}

function legacyParam(block: UserBlockDefinition, nodeId: string, fieldId: string) {
  const node = block.nodes.find((candidate) => legacyRecord(candidate).id === nodeId);
  const param = legacyRecord(legacyRecord(legacyRecord(node).data).params)[fieldId];
  return legacyRecord(param);
}

function controlsFromLegacy(block: UserBlockDefinition, graph: BlockGraphV2): BlockControlV2[] {
  const studioBindingNodeId = graph.nodes.find(
    ({ semanticRole }) => semanticRole === 'legacy_studio_form_binding',
  )?.nodeId;
  return block.exposedParams.map((control, order) => {
    const graphParam = control.kind === 'graph-param';
    if (graphParam && (!control.nodeId || !control.paramKey))
      invalid('legacy User Node', `control ${control.id} is missing nodeId or paramKey.`);
    if (!graphParam && (!studioBindingNodeId || !control.formKey))
      invalid('legacy User Node', `control ${control.id} cannot preserve its Studio form binding.`);
    const nodeId = graphParam ? control.nodeId! : studioBindingNodeId!;
    const fieldId = graphParam ? control.paramKey! : control.formKey!;
    const param = graphParam ? legacyParam(block, nodeId, fieldId) : {};
    const defaultValue = param.value ?? param.default;
    if (defaultValue !== undefined) finiteJson(defaultValue, `legacy User Node control ${control.id} default`);
    return {
      controlId: control.id,
      label: control.label,
      binding: { nodeId, fieldId },
      valueType: typeof param.type === 'string' && param.type ? param.type : 'any',
      ...(defaultValue === undefined ? {} : { defaultValue }),
      ...(param.optional === false ? { required: true } : {}),
      ...(param.disabled === true ? { sealed: true } : {}),
      order,
      ...(typeof param.description === 'string' && param.description ? { help: param.description } : {}),
    };
  });
}

const LEGACY_PREVIEW_MEDIA: Record<string, BlockPreviewBindingV2['mediaType']> = {
  ui_image: 'image',
  ui_video: 'video',
  ui_audio: 'audio',
  ui_text: 'text',
  ui_imagecompare: 'image',
};

function previewsFromLegacy(block: UserBlockDefinition): BlockPreviewBindingV2[] {
  const previews: BlockPreviewBindingV2[] = [];
  block.nodes.forEach((candidate) => {
    const nodeId = legacyRecord(candidate).id;
    if (typeof nodeId !== 'string') return;
    const params = legacyRecord(legacyRecord(legacyRecord(candidate).data).params);
    Object.entries(params).forEach(([fieldId, rawParam]) => {
      const display = legacyRecord(rawParam).display;
      if (typeof display !== 'string' || !LEGACY_PREVIEW_MEDIA[display]) return;
      previews.push({
        nodeId,
        outputPortId: fieldId,
        mediaType: LEGACY_PREVIEW_MEDIA[display],
        ...(previews.length === 0 ? { primary: true } : {}),
      });
    });
  });
  return previews;
}

function sourceFromLegacy(block: UserBlockDefinition): BlockSourceV2 {
  const origin = block.origin;
  if (!origin) return { kind: 'user' };
  const sourceKind: BlockSourceKindV2 = origin.kind === 'hugging_face_hub_import' ? 'hub_import' : 'user';
  const parentSourceKind: BlockSourceKindV2 =
    origin.provider === 'diffusers' ? 'diffusers_catalog' : 'transformers_catalog';
  return {
    kind: sourceKind,
    provider: origin.provider,
    library: origin.provider,
    ...(origin.libraryRevision ? { libraryRevision: origin.libraryRevision } : {}),
    ...(origin.pipelineClass ? { pipelineClass: origin.pipelineClass } : {}),
    ...(origin.workflowId ? { workflow: origin.workflowId } : {}),
    ...(origin.definitionId ? { manifestDefinitionId: origin.definitionId } : {}),
    ...(origin.contentHash ? { manifestContentHash: origin.contentHash } : {}),
    ...(origin.repo ? { repository: origin.repo } : {}),
    ...(origin.revision ? { repositoryRevision: origin.revision } : {}),
    ...(origin.definitionId && origin.contentHash
      ? {
          parent: {
            definitionId: origin.definitionId,
            contentHash: origin.contentHash,
            sourceKind: parentSourceKind,
          },
        }
      : {}),
  };
}

/**
 * Additive V1 reader. Existing V1 storage remains supported while new code can
 * consume a strict V2 snapshot. The adapter never infers additional ports;
 * it preserves the already-materialized V1 boundary exactly.
 */
export function migrateUserBlockDefinitionV1(block: UserBlockDefinition): BlockDefinitionV2 {
  if (!record(block) || block.version !== 1) invalid('legacy User Node', 'version must be 1.');
  textAt(block.id, 'legacy User Node.id', ID, 384);
  textAt(block.name, 'legacy User Node.name', undefined, 512);
  if (!Array.isArray(block.nodes) || !Array.isArray(block.edges))
    invalid('legacy User Node', 'nodes and edges must be arrays.');
  if (!Array.isArray(block.inputs) || !Array.isArray(block.outputs) || !Array.isArray(block.exposedParams))
    invalid('legacy User Node', 'inputs, outputs, and exposedParams must be arrays.');
  const graph = graphFromLegacyBlock(block, block.exposedParams);
  const controls = controlsFromLegacy(block, graph);
  const source = sourceFromLegacy(block);
  const mode = block.origin ? 'explicit' : 'derived';
  const previews = previewsFromLegacy(block);
  const withoutHash: Omit<BlockDefinitionV2, 'contentHash'> = {
    schemaVersion: 2,
    definitionId: block.id,
    displayName: block.name,
    source,
    graph,
    boundary: {
      mode,
      inputs: block.inputs.map(portFromLegacy),
      outputs: block.outputs.map(portFromLegacy),
      ...(mode === 'derived'
        ? {
            derivation: {
              algorithmVersion: 'legacy-user-block-boundary-v1',
              derivedAtDefinitionHash: graph.graphHash,
            },
          }
        : {}),
    },
    controls,
    previews,
    ownership: { kind: 'user', definitionMutable: true },
  };
  return normalizeBlockDefinitionV2({
    ...withoutHash,
    contentHash: blockDefinitionContentHashV2(withoutHash),
  });
}
