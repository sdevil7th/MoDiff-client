import type { Edge } from '@xyflow/react';

import config from '../../app.config';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useHuggingFaceModularConditionalStore } from '../stores/useHuggingFaceModularConditionalStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useNodesStore, type NodeParams } from '../stores/useNodeStore';
import { captureWorkflowOperationContext, workflowOperationContextIsCurrent } from '../stores/useStudioStore';
import { requestJson } from '../utils/requestJson';
import {
  parseRegisteredClusterCompilerSupplement,
  type CompositeMigrationCandidate,
  type LegacyClusterHistoricalCompilerMappingAuthority,
  type LegacyClusterSemanticEquivalenceAuthority,
  type RegisteredClusterCompilerConversion,
  type RegisteredClusterCompilerSupplement,
} from './compositeMigrationApi';
import { createHuggingFaceClusterNode } from './huggingFaceClusterGraph';
import { compileRegisteredCatalogBlockV2Exact } from './huggingFaceClusterInsertion';
import {
  huggingFaceClusterOverridesForBindingValues,
  type HuggingFaceClusterInstance,
} from './huggingFaceClusterInstance';
import type { HuggingFaceNodeLibraryDefinition } from './huggingFaceNodeLibrary';
import { compositeChildNodeId } from './compositeNodes';
import {
  canonicalBlockStringifyV2,
  blockInterfaceHashV2,
  normalizeBlockInstanceV2,
  type BlockInstanceV2,
  type BlockJsonValue,
  type BlockPortV2,
} from './blockSchemaV2';
import { normalizeBlockValueTypeV2 } from './blockValueTypeCompatibilityV2';
import { getFormDefaultsForRegisteredRoute } from './modelProfiles';
import { registeredBlockV2Route, type RegisteredBlockV2Route } from './registeredBlockV2Routes';
import type { StudioMode, StudioModelType } from './types';

const WORKFLOW_SOURCE = /^user-workflows\/([A-Za-z0-9_-]{1,96})\.json$/u;
const MAX_SUPPLEMENT_BYTES = 32 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;

export type RegisteredClusterCompilerDiagnostic = {
  sourcePath: string;
  instanceId: string | null;
  code:
    | 'candidate_receipt_missing'
    | 'compiler_failed'
    | 'execution_receipt_missing'
    | 'historical_manifest_unavailable'
    | 'legacy_snapshot_ambiguous'
    | 'registered_route_unavailable'
    | 'source_changed'
    | 'workflow_unavailable';
  message: string;
};

export type RegisteredClusterCompilerProgress = {
  completed: number;
  total: number;
  sourcePath: string;
  instanceId: string | null;
};

export type GeneratedRegisteredClusterCompilerSupplement = {
  supplement: RegisteredClusterCompilerSupplement;
  diagnostics: RegisteredClusterCompilerDiagnostic[];
  candidateCount: number;
  conversionCount: number;
};

type SavedWorkflowCompilerSource = {
  id: string;
  sourcePath: string;
  snapshot: {
    nodes: CustomNodeType[];
    edges: Edge[];
  };
};

type LegacyContext = {
  candidate: CompositeMigrationCandidate;
  workflow: SavedWorkflowCompilerSource;
  root: CustomNodeType;
  children: CustomNodeType[];
  edges: Edge[];
  instance: HuggingFaceClusterInstance & { execution: NonNullable<HuggingFaceClusterInstance['execution']> };
  definition: HuggingFaceNodeLibraryDefinition;
  route: RegisteredBlockV2Route;
  semanticEquivalenceAuthority: LegacyClusterSemanticEquivalenceAuthority | null;
  historicalCompilerMappingAuthority: LegacyClusterHistoricalCompilerMappingAuthority | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function lexicalCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tupleKey(...values: string[]) {
  return values.join('\0');
}

function jsonEqual(left: unknown, right: unknown) {
  return canonicalBlockStringifyV2(left as BlockJsonValue) === canonicalBlockStringifyV2(right as BlockJsonValue);
}

function fail(message: string): never {
  throw new Error(message);
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function exactPosition(node: CustomNodeType, label: string) {
  if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))
    fail(`${label} has no exact finite persisted position.`);
  return { x: node.position.x, y: node.position.y };
}

function workflowId(sourcePath: string) {
  const match = WORKFLOW_SOURCE.exec(sourcePath);
  if (!match) fail(`Compiler candidate source path ${sourcePath} is not a saved workflow path.`);
  return match[1]!;
}

function parseSavedWorkflow(value: unknown, sourcePath: string): SavedWorkflowCompilerSource {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.snapshot))
    fail(`Saved workflow ${sourcePath} is malformed.`);
  const expectedId = workflowId(sourcePath);
  if (value.id !== expectedId) fail(`Saved workflow ${sourcePath} returned a different workflow id.`);
  const nodes = value.snapshot.nodes;
  const edges = value.snapshot.edges;
  if (!Array.isArray(nodes) || !Array.isArray(edges)) fail(`Saved workflow ${sourcePath} has no exact graph snapshot.`);
  return {
    id: expectedId,
    sourcePath,
    snapshot: {
      nodes: structuredClone(nodes) as CustomNodeType[],
      edges: structuredClone(edges) as Edge[],
    },
  };
}

async function fetchSavedWorkflow(sourcePath: string, signal?: AbortSignal) {
  const id = workflowId(sourcePath);
  return requestJson(`${config.serverAddress}/workflows/${encodeURIComponent(id)}`, {
    timeoutMs: 120_000,
    signal,
    parse: (value) => parseSavedWorkflow(value, sourcePath),
  });
}

function clusterChildren(workflow: SavedWorkflowCompilerSource, rootId: string) {
  return workflow.snapshot.nodes
    .filter(
      (node) => node.id !== rootId && (node.parentId === rootId || node.data?.huggingFaceClusterInstanceId === rootId),
    )
    .sort((left, right) => lexicalCompare(left.id, right.id));
}

function resolveContext(
  candidate: CompositeMigrationCandidate,
  workflow: SavedWorkflowCompilerSource,
  definitions: readonly HuggingFaceNodeLibraryDefinition[],
): LegacyContext {
  if (!candidate.id) fail('Legacy registered Cluster candidate has no instance id.');
  if (!candidate.sourceSha256 || !candidate.legacyCompositeHash)
    fail('Backend preview did not provide the exact source and legacy composite hashes.');
  const rootMatches = workflow.snapshot.nodes.filter((node) => node.id === candidate.id);
  if (rootMatches.length !== 1) fail(`Legacy Cluster ${candidate.id} does not resolve to exactly one saved root.`);
  const root = rootMatches[0]!;
  const instance = root.data?.huggingFaceClusterInstance;
  if (
    root.type !== 'cluster' ||
    root.data?.type !== 'cluster' ||
    root.data?.huggingFaceClusterRole !== 'root' ||
    !instance ||
    instance.instanceId !== root.id
  )
    fail(`Saved node ${candidate.id} is not one exact legacy registered Cluster root.`);
  if (instance.structuralFork !== null) fail(`Legacy Cluster ${candidate.id} is structurally forked.`);
  const execution = instance.execution;
  if (!execution) fail(`Legacy Cluster ${candidate.id} has no execution receipt.`);
  const sameId = definitions.filter(({ id }) => id === instance.definition.id);
  let definition = sameId.find(
    (item) =>
      item.libraryRevision === instance.definition.libraryRevision &&
      item.contentHash === instance.definition.contentHash,
  );
  const semanticEquivalenceAuthority = candidate.semanticEquivalenceAuthority ?? null;
  const historicalCompilerMappingAuthority = candidate.historicalCompilerMappingAuthority ?? null;
  if (semanticEquivalenceAuthority && historicalCompilerMappingAuthority)
    fail(`Legacy Cluster ${candidate.id} has conflicting historical review authorities.`);
  const historicalAuthority = semanticEquivalenceAuthority ?? historicalCompilerMappingAuthority;
  if (!definition) {
    if (!historicalAuthority) {
      if (sameId.length)
        fail(
          `Legacy Cluster ${candidate.id} uses historical manifest ${instance.definition.contentHash}; no reviewed archived definition or equivalence receipt is registered.`,
        );
      fail(`Legacy Cluster ${candidate.id} references an unavailable catalog definition ${instance.definition.id}.`);
    }
    const historical = historicalAuthority.historical;
    if (
      historical.manifestDefinitionId !== instance.definition.id ||
      historical.libraryRevision !== instance.definition.libraryRevision ||
      historical.manifestContentHash !== instance.definition.contentHash ||
      historical.executionAdmissionId !== execution.admissionId ||
      !jsonEqual(historical.studioExecutionSpec, execution.studioExecutionSpec)
    )
      fail(`Legacy Cluster ${candidate.id} does not match the reviewed historical compiler authority.`);
    const destination = historicalAuthority.destination;
    const matches = definitions.filter(
      (item) =>
        item.id === destination.manifestDefinitionId &&
        item.libraryRevision === destination.libraryRevision &&
        item.contentHash === destination.manifestContentHash,
    );
    if (matches.length !== 1)
      fail(`Legacy Cluster ${candidate.id} historical compiler destination is unavailable or ambiguous.`);
    definition = matches[0]!;
  }
  const destinationAdmissionId = historicalAuthority
    ? historicalAuthority.destination.executionAdmissionId
    : execution.admissionId;
  const admission = definition.executionAdmissions.find(({ id }) => id === destinationAdmissionId);
  if (!admission) fail(`Legacy Cluster ${candidate.id} references an unavailable execution admission.`);
  if (
    !historicalAuthority &&
    (admission.studioExecutionSpec?.id !== execution.studioExecutionSpec.id ||
      admission.studioExecutionSpec?.contentHash !== execution.studioExecutionSpec.contentHash ||
      admission.studioExecutionSpec?.executionProfileId !== execution.studioExecutionSpec.executionProfileId)
  )
    fail(`Legacy Cluster ${candidate.id} has a stale Studio execution specification receipt.`);
  const route = registeredBlockV2Route(definition, admission);
  if (!route) fail(`Legacy Cluster ${candidate.id} is not an exact current registered Block V2 route.`);
  if (!positiveFinite(root.width) || !positiveFinite(root.height))
    fail(`Legacy Cluster ${candidate.id} has no exact positive persisted width and height.`);
  exactPosition(root, `Legacy Cluster ${candidate.id}`);
  return {
    candidate,
    workflow,
    root,
    children: clusterChildren(workflow, root.id),
    edges: workflow.snapshot.edges,
    instance: instance as LegacyContext['instance'],
    definition,
    route,
    semanticEquivalenceAuthority,
    historicalCompilerMappingAuthority,
  };
}

function semanticMappings(context: LegacyContext, compiled: BlockInstanceV2) {
  const graphByRole = new Map<string, string[]>();
  compiled.effectiveGraph.nodes.forEach((node) => {
    const role = node.semanticRole;
    if (!role) return;
    graphByRole.set(role, [...(graphByRole.get(role) ?? []), node.nodeId]);
  });
  const mappings = context.children.map((child) => {
    const data = child.data;
    const role = data?.huggingFaceClusterExecutionRole;
    if (
      data?.huggingFaceClusterRole !== 'execution' ||
      data.huggingFaceClusterInstanceId !== context.root.id ||
      data.huggingFaceClusterExecutionAdmissionId !== context.instance.execution?.admissionId ||
      data.huggingFaceClusterExecutionSpecId !== context.instance.execution.studioExecutionSpec.id ||
      !role
    )
      fail(`Legacy projection ${child.id} has incomplete or stale execution ownership.`);
    const semanticMatches = graphByRole.get(role) ?? [];
    if (semanticMatches.length !== 1)
      fail(`Legacy projection ${child.id} cannot be mapped one-to-one to semantic role ${role}.`);
    return { legacyNodeId: child.id, semanticNodeId: semanticMatches[0]! };
  });
  const semanticIds = mappings.map(({ semanticNodeId }) => semanticNodeId);
  if (new Set(semanticIds).size !== semanticIds.length)
    fail(`Legacy Cluster ${context.root.id} would merge multiple projection nodes.`);
  return mappings.sort((left, right) =>
    lexicalCompare(
      tupleKey(left.legacyNodeId, left.semanticNodeId),
      tupleKey(right.legacyNodeId, right.semanticNodeId),
    ),
  );
}

function semanticTargetsByLegacyId(
  context: LegacyContext,
  instance: BlockInstanceV2,
  ownedMappings: RegisteredClusterCompilerConversion['ownedNodeMappings'],
) {
  const targets = new Map(ownedMappings.map((mapping) => [mapping.legacyNodeId, mapping.semanticNodeId]));
  const roles = new Set<string>();
  instance.effectiveGraph.nodes.forEach((node) => {
    if (!node.semanticRole) return;
    if (roles.has(node.semanticRole))
      fail(`Compiled graph has duplicate semantic role ${node.semanticRole}; legacy endpoint ownership is ambiguous.`);
    roles.add(node.semanticRole);
    const legacyNodeId = compositeChildNodeId(
      context.root.id,
      `diffusers.cluster-execution:${encodeURIComponent(node.semanticRole)}`,
    );
    const previous = targets.get(legacyNodeId);
    if (previous && previous !== node.nodeId)
      fail(`Legacy execution endpoint ${legacyNodeId} maps to conflicting semantic nodes.`);
    targets.set(legacyNodeId, node.nodeId);
  });
  return targets;
}

function bindingTargets(port: BlockPortV2) {
  return [port.binding, ...(port.mirrorBindings ?? [])].map(({ nodeId, fieldOrPortId }) => ({
    nodeId,
    fieldId: fieldOrPortId,
  }));
}

function portForTarget(instance: BlockInstanceV2, direction: 'input' | 'output', nodeId: string, fieldId: string) {
  const ports =
    direction === 'input' ? instance.effectiveInterface.boundary.inputs : instance.effectiveInterface.boundary.outputs;
  const matches = ports.filter((port) =>
    bindingTargets(port).some((target) => target.nodeId === nodeId && target.fieldId === fieldId),
  );
  if (matches.length !== 1)
    fail(`Legacy ${direction} endpoint ${nodeId}.${fieldId} does not resolve to exactly one V2 public port.`);
  return matches[0]!;
}

function legacyPortTarget(
  context: LegacyContext,
  semanticByLegacy: ReadonlyMap<string, string>,
  direction: 'input' | 'output',
  legacyNodeId: string,
  legacyPortId: string,
) {
  if (legacyNodeId !== context.root.id) {
    const semanticNodeId = semanticByLegacy.get(legacyNodeId);
    if (!semanticNodeId) fail(`Legacy boundary endpoint ${legacyNodeId}.${legacyPortId} is not an owned projection.`);
    return { semanticNodeId, fieldId: legacyPortId };
  }
  const param = context.root.data.params?.[legacyPortId];
  const options = isRecord(param?.fieldOptions) ? param.fieldOptions : {};
  if (
    options.huggingFaceClusterPortDirection !== direction ||
    typeof options.huggingFaceClusterPortNodeId !== 'string' ||
    typeof options.huggingFaceClusterPortField !== 'string'
  )
    fail(`Legacy root port ${legacyPortId} has incomplete ${direction} metadata.`);
  const semanticNodeId = semanticByLegacy.get(options.huggingFaceClusterPortNodeId);
  if (!semanticNodeId)
    fail(`Legacy root port ${legacyPortId} targets a projection that is absent from the saved snapshot.`);
  return { semanticNodeId, fieldId: options.huggingFaceClusterPortField };
}

function portMappings(
  context: LegacyContext,
  instance: BlockInstanceV2,
  ownedMappings: RegisteredClusterCompilerConversion['ownedNodeMappings'],
) {
  const semanticByLegacy = semanticTargetsByLegacyId(context, instance, ownedMappings);
  const ownedIds = new Set([context.root.id, ...context.children.map(({ id }) => id)]);
  const endpoints = new Map<string, { direction: 'input' | 'output'; legacyNodeId: string; legacyPortId: string }>();
  Object.entries(context.root.data.params ?? {}).forEach(([legacyPortId, param]) => {
    const direction = param.fieldOptions?.huggingFaceClusterPortDirection;
    if (direction !== 'input' && direction !== 'output') return;
    const item = { direction, legacyNodeId: context.root.id, legacyPortId } as const;
    endpoints.set(tupleKey(direction, context.root.id, legacyPortId), item);
  });
  context.edges.forEach((edge) => {
    const sourceOwned = ownedIds.has(edge.source);
    const targetOwned = ownedIds.has(edge.target);
    if (sourceOwned === targetOwned) return;
    if (sourceOwned) {
      if (!edge.sourceHandle) fail(`Crossing edge ${edge.id} has no exact source handle.`);
      const item = { direction: 'output' as const, legacyNodeId: edge.source, legacyPortId: edge.sourceHandle };
      endpoints.set(tupleKey(item.direction, item.legacyNodeId, item.legacyPortId), item);
    }
    if (targetOwned) {
      if (!edge.targetHandle) fail(`Crossing edge ${edge.id} has no exact target handle.`);
      const item = { direction: 'input' as const, legacyNodeId: edge.target, legacyPortId: edge.targetHandle };
      endpoints.set(tupleKey(item.direction, item.legacyNodeId, item.legacyPortId), item);
    }
  });
  return [...endpoints.values()]
    .map((endpoint) => {
      const target = legacyPortTarget(
        context,
        semanticByLegacy,
        endpoint.direction,
        endpoint.legacyNodeId,
        endpoint.legacyPortId,
      );
      return {
        ...endpoint,
        v2PortId: portForTarget(instance, endpoint.direction, target.semanticNodeId, target.fieldId).portId,
      };
    })
    .sort((left, right) =>
      lexicalCompare(
        tupleKey(left.direction, left.legacyNodeId, left.legacyPortId, left.v2PortId),
        tupleKey(right.direction, right.legacyNodeId, right.legacyPortId, right.v2PortId),
      ),
    );
}

function persistedBinding(param: NodeParams | undefined) {
  const value = param?.fieldOptions?.huggingFaceClusterBinding;
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1 ||
    typeof value.source !== 'string' ||
    (value.persistence !== 'instance_input' &&
      value.persistence !== 'execution_parameter' &&
      value.persistence !== 'sealed') ||
    (value.input !== undefined && typeof value.input !== 'string')
  )
    return null;
  return value as {
    source: string;
    persistence: 'instance_input' | 'execution_parameter' | 'sealed';
    input?: string;
  };
}

function controlForTarget(instance: BlockInstanceV2, nodeId: string, fieldId: string) {
  const matches = instance.effectiveInterface.controls.filter((control) =>
    [control.binding, ...(control.mirrorBindings ?? [])].some(
      (binding) => binding.nodeId === nodeId && binding.fieldId === fieldId,
    ),
  );
  if (matches.length !== 1) return null;
  return matches[0]!;
}

function jsonShape(value: BlockJsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function hasCompatibleJsonShape(value: BlockJsonValue, baseline: BlockJsonValue) {
  const actual = jsonShape(value);
  const expected = jsonShape(baseline);
  return actual === expected || (actual === 'integer' && expected === 'number');
}

/**
 * Block V2 declares connector/control types but intentionally stores only JSON
 * values. Historical migration therefore needs a concrete, fail-closed bridge:
 * a value may enter `BlockInstanceV2.values` only when its current public
 * declaration admits that JSON shape. Unknown implementation types are
 * accepted only when the current definition supplies a non-null default whose
 * JSON shape can be checked; an opaque declaration without such a witness is
 * not migration authority.
 */
function concreteValueMatchesType(
  value: BlockJsonValue,
  valueType: unknown,
  options: { defaultValue?: BlockJsonValue; required?: boolean } = {},
): boolean {
  if (value === null) return options.required !== true || options.defaultValue === null;
  const normalized = normalizeBlockValueTypeV2(valueType);
  const declarations = Array.isArray(normalized) ? normalized : [normalized];
  const matchesKnown = declarations.some((candidate) => {
    if (typeof candidate !== 'string') return false;
    const type = candidate.trim().toLowerCase();
    if (type === 'string' || type === 'text' || type === 'str' || type === 'dropdown') return typeof value === 'string';
    if (type === 'bool' || type === 'boolean') return typeof value === 'boolean';
    if (type === 'int' || type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'float' || type === 'double' || type === 'number')
      return typeof value === 'number' && Number.isFinite(value);
    if (type === 'minimax_h3_references' || /^(?:list|array|sequence|tuple|set)(?:\[|$)/u.test(type))
      return Array.isArray(value);
    if (/^(?:dict|mapping|object|json)(?:\[|$)/u.test(type)) return isRecord(value);
    if (/^(?:image|video|audio|file|path|uri|url|media)(?:\b|_)/u.test(type))
      return typeof value === 'string' || isRecord(value);
    return false;
  });
  if (matchesKnown) return true;
  return options.defaultValue !== undefined && options.defaultValue !== null
    ? hasCompatibleJsonShape(value, options.defaultValue)
    : false;
}

function assertDeclaredInstanceValue(instance: BlockInstanceV2, valueId: string, value: BlockJsonValue) {
  const controls = instance.effectiveInterface.controls.filter(({ controlId }) => controlId === valueId);
  const inputs = instance.effectiveInterface.boundary.inputs.filter(({ portId }) => portId === valueId);
  if (controls.length + inputs.length === 0)
    fail(`Legacy value ${valueId} does not target a declared V2 input/control.`);
  controls.forEach((control) => {
    if (control.sealed && !jsonEqual(value, control.defaultValue))
      fail(`Legacy value ${valueId} attempts to rewrite a sealed V2 control.`);
    if (
      !concreteValueMatchesType(value, control.valueType, {
        ...(control.defaultValue === undefined ? {} : { defaultValue: control.defaultValue }),
        required: control.required,
      })
    )
      fail(`Legacy value ${valueId} is incompatible with V2 control type ${String(control.valueType)}.`);
  });
  inputs.forEach((input) => {
    if (!concreteValueMatchesType(value, input.valueType, { required: input.required }))
      fail(`Legacy value ${valueId} is incompatible with V2 input type ${String(input.valueType)}.`);
  });
}

type LegacyValueSource = {
  sourceKind: string;
  sourceNodeId: string;
  sourceFieldId: string;
  value: BlockJsonValue;
};

type LegacyValueTarget =
  | { targetKind: 'instance_value'; targetValueId: string }
  | { targetKind: 'graph_param'; targetNodeId: string; targetFieldId: string };

function legacyValueSources(context: LegacyContext) {
  const sources: LegacyValueSource[] = [];
  [context.root, ...context.children]
    .sort((left, right) => lexicalCompare(left.id, right.id))
    .forEach((node) => {
      Object.entries(node.data.params ?? {})
        .sort(([left], [right]) => lexicalCompare(left, right))
        .forEach(([fieldId, param]) => {
          if (Object.prototype.hasOwnProperty.call(param, 'value') && param.display !== 'output')
            sources.push({
              sourceKind: 'node_param',
              sourceNodeId: node.id,
              sourceFieldId: fieldId,
              value: structuredClone(param.value) as BlockJsonValue,
            });
        });
    });
  Object.entries(context.instance.parameterOverrides)
    .sort(([left], [right]) => lexicalCompare(left, right))
    .forEach(([fieldId, value]) =>
      sources.push({
        sourceKind: 'instance_parameter_override',
        sourceNodeId: context.root.id,
        sourceFieldId: fieldId,
        value: structuredClone(value) as BlockJsonValue,
      }),
    );
  Object.entries(context.instance.execution?.parameterOverrides ?? {})
    .sort(([left], [right]) => lexicalCompare(left, right))
    .forEach(([fieldId, value]) =>
      sources.push({
        sourceKind: 'execution_parameter_override',
        sourceNodeId: context.root.id,
        sourceFieldId: fieldId,
        value: structuredClone(value) as BlockJsonValue,
      }),
    );
  return sources;
}

function resolveValueTarget(
  context: LegacyContext,
  instance: BlockInstanceV2,
  semanticByLegacy: ReadonlyMap<string, string>,
  source: LegacyValueSource,
): LegacyValueTarget {
  if (source.sourceKind === 'instance_parameter_override' || source.sourceKind === 'execution_parameter_override') {
    const allowed = new Set([
      ...instance.effectiveInterface.controls.map(({ controlId }) => controlId),
      ...instance.effectiveInterface.boundary.inputs.map(({ portId }) => portId),
    ]);
    if (!allowed.has(source.sourceFieldId))
      fail(`Legacy override ${source.sourceKind}/${source.sourceFieldId} has no exact V2 input/control.`);
    return { targetKind: 'instance_value', targetValueId: source.sourceFieldId };
  }
  if (source.sourceNodeId === context.root.id) {
    const param = context.root.data.params[source.sourceFieldId];
    const options = param?.fieldOptions;
    if (
      options?.huggingFaceClusterPortDirection === 'input' &&
      typeof options.huggingFaceClusterPortNodeId === 'string' &&
      typeof options.huggingFaceClusterPortField === 'string'
    ) {
      const semanticNodeId = semanticByLegacy.get(options.huggingFaceClusterPortNodeId);
      const control = semanticNodeId
        ? controlForTarget(instance, semanticNodeId, options.huggingFaceClusterPortField)
        : null;
      if (!control) fail(`Legacy root value ${source.sourceFieldId} has ambiguous input-port ownership.`);
      return { targetKind: 'instance_value', targetValueId: control.controlId };
    }
    const allowed = new Set([
      ...instance.effectiveInterface.controls.map(({ controlId }) => controlId),
      ...instance.effectiveInterface.boundary.inputs.map(({ portId }) => portId),
    ]);
    if (!allowed.has(source.sourceFieldId))
      fail(`Legacy root value ${source.sourceFieldId} has no exact V2 input/control.`);
    return { targetKind: 'instance_value', targetValueId: source.sourceFieldId };
  }
  const semanticNodeId = semanticByLegacy.get(source.sourceNodeId);
  if (!semanticNodeId)
    fail(`Legacy value ${source.sourceNodeId}.${source.sourceFieldId} is outside the owned projection.`);
  const child = context.children.find(({ id }) => id === source.sourceNodeId)!;
  const binding = persistedBinding(child.data.params[source.sourceFieldId]);
  if (binding?.persistence === 'instance_input' || binding?.persistence === 'execution_parameter') {
    const control = controlForTarget(instance, semanticNodeId, source.sourceFieldId);
    if (!control) fail(`Legacy mutable field ${source.sourceNodeId}.${source.sourceFieldId} has no exact V2 control.`);
    return { targetKind: 'instance_value', targetValueId: control.controlId };
  }
  const graphNode = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === semanticNodeId);
  const params = isRecord(graphNode?.data.params) ? graphNode.data.params : {};
  const graphParam = params[source.sourceFieldId];
  if (!isRecord(graphParam) || !Object.prototype.hasOwnProperty.call(graphParam, 'value'))
    fail(`Legacy static field ${source.sourceNodeId}.${source.sourceFieldId} has no exact V2 graph parameter.`);
  return { targetKind: 'graph_param', targetNodeId: semanticNodeId, targetFieldId: source.sourceFieldId };
}

function mapValues(
  context: LegacyContext,
  instance: BlockInstanceV2,
  ownedMappings: RegisteredClusterCompilerConversion['ownedNodeMappings'],
) {
  const semanticByLegacy = semanticTargetsByLegacyId(context, instance, ownedMappings);
  const mappings: RegisteredClusterCompilerConversion['valueMappings'] = [];
  const values = { ...instance.values };
  const assigned = new Map<string, BlockJsonValue>();
  legacyValueSources(context).forEach((source) => {
    const target = resolveValueTarget(context, instance, semanticByLegacy, source);
    if (target.targetKind === 'instance_value') {
      assertDeclaredInstanceValue(instance, target.targetValueId, source.value);
      const previous = assigned.get(target.targetValueId);
      if (previous !== undefined && !jsonEqual(previous, source.value))
        fail(`Legacy sources disagree for V2 input/control ${target.targetValueId}.`);
      assigned.set(target.targetValueId, source.value);
      values[target.targetValueId] = source.value;
    } else {
      const graphNode = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === target.targetNodeId)!;
      const graphParam = (graphNode.data.params as JsonRecord)[target.targetFieldId];
      if (!isRecord(graphParam) || !jsonEqual(graphParam.value, source.value))
        fail(`Legacy static value ${source.sourceNodeId}.${source.sourceFieldId} differs from the pinned definition.`);
    }
    mappings.push({
      sourceKind: source.sourceKind,
      sourceNodeId: source.sourceNodeId,
      sourceFieldId: source.sourceFieldId,
      ...target,
    } as RegisteredClusterCompilerConversion['valueMappings'][number]);
  });
  mappings.sort((left, right) =>
    lexicalCompare(
      tupleKey(left.sourceKind, left.sourceNodeId, left.sourceFieldId, left.targetKind),
      tupleKey(right.sourceKind, right.sourceNodeId, right.sourceFieldId, right.targetKind),
    ),
  );
  const parametersChanged =
    instance.effectiveInterface.boundary.inputs.some(({ portId }) =>
      Object.prototype.hasOwnProperty.call(values, portId),
    ) ||
    instance.effectiveInterface.controls.some(
      (control) =>
        Object.prototype.hasOwnProperty.call(values, control.controlId) &&
        !jsonEqual(values[control.controlId], control.defaultValue),
    );
  return {
    mappings,
    instance: normalizeBlockInstanceV2({
      ...instance,
      values,
      customization: {
        ...instance.customization,
        state: parametersChanged ? 'parameters_changed' : 'unchanged',
      },
    }),
  };
}

function legacyPreviewSources(context: LegacyContext) {
  return [context.root, ...context.children].flatMap((node) =>
    Object.entries(node.data.params ?? {}).flatMap(([fieldId, param]) => {
      if (param.display !== 'output' || param.value === null || param.value === undefined) return [];
      if (typeof param.value !== 'string' || !param.value)
        fail(`Legacy output ${node.id}.${fieldId} is not a persistable media reference.`);
      return [{ node, fieldId, mediaReference: param.value }];
    }),
  );
}

function mapPreviews(
  context: LegacyContext,
  instance: BlockInstanceV2,
  ownedMappings: RegisteredClusterCompilerConversion['ownedNodeMappings'],
) {
  const semanticByLegacy = semanticTargetsByLegacyId(context, instance, ownedMappings);
  const previewStates = structuredClone(instance.previewStates);
  const mappings: RegisteredClusterCompilerConversion['previewMappings'] = [];
  legacyPreviewSources(context).forEach(({ node, fieldId, mediaReference }) => {
    let semanticNodeId: string | undefined;
    let semanticFieldId = fieldId;
    if (node.id === context.root.id) {
      const options = node.data.params[fieldId]?.fieldOptions;
      const legacySourceNodeId =
        typeof options?.huggingFaceClusterPreviewSourceNodeId === 'string'
          ? options.huggingFaceClusterPreviewSourceNodeId
          : options?.huggingFaceClusterPortDirection === 'output' &&
              typeof options.huggingFaceClusterPortNodeId === 'string'
            ? options.huggingFaceClusterPortNodeId
            : null;
      const legacySourceField =
        typeof options?.huggingFaceClusterPreviewSourceField === 'string'
          ? options.huggingFaceClusterPreviewSourceField
          : options?.huggingFaceClusterPortDirection === 'output' &&
              typeof options.huggingFaceClusterPortField === 'string'
            ? options.huggingFaceClusterPortField
            : null;
      if (!legacySourceNodeId || !legacySourceField)
        fail(`Legacy root output ${fieldId} has no exact preview-source metadata.`);
      semanticNodeId = semanticByLegacy.get(legacySourceNodeId);
      semanticFieldId = legacySourceField;
    } else semanticNodeId = semanticByLegacy.get(node.id);
    if (!semanticNodeId) fail(`Legacy output ${node.id}.${fieldId} targets an absent projection.`);
    const matches = previewStates
      .map((state, index) => ({ state, index }))
      .filter(({ state }) => state.binding.nodeId === semanticNodeId && state.binding.outputPortId === semanticFieldId);
    if (matches.length !== 1)
      fail(`Legacy output ${node.id}.${fieldId} does not resolve to exactly one V2 preview binding.`);
    const match = matches[0]!;
    if (match.state.mediaReference && match.state.mediaReference !== mediaReference)
      fail(`Legacy outputs conflict for V2 preview ${semanticNodeId}.${semanticFieldId}.`);
    previewStates[match.index] = { ...match.state, mediaReference, status: 'complete' };
    mappings.push({
      sourceNodeId: node.id,
      sourceFieldId: fieldId,
      targetNodeId: semanticNodeId,
      targetOutputPortId: semanticFieldId,
    });
  });
  mappings.sort((left, right) =>
    lexicalCompare(
      tupleKey(left.sourceNodeId, left.sourceFieldId, left.targetNodeId, left.targetOutputPortId),
      tupleKey(right.sourceNodeId, right.sourceFieldId, right.targetNodeId, right.targetOutputPortId),
    ),
  );
  return {
    mappings,
    instance: normalizeBlockInstanceV2({ ...instance, previewStates }),
  };
}

function withLegacyLayout(
  context: LegacyContext,
  instance: BlockInstanceV2,
  mappings: RegisteredClusterCompilerConversion['ownedNodeMappings'],
) {
  const internalLayout = { ...instance.presentation.internalLayout };
  mappings.forEach(({ legacyNodeId, semanticNodeId }) => {
    const child = context.children.find(({ id }) => id === legacyNodeId)!;
    internalLayout[semanticNodeId] = {
      ...exactPosition(child, `Legacy projection ${legacyNodeId}`),
      ...(positiveFinite(child.width) ? { width: child.width } : {}),
      ...(positiveFinite(child.height) ? { height: child.height } : {}),
    };
  });
  return normalizeBlockInstanceV2({
    ...instance,
    presentation: { ...instance.presentation, internalLayout },
  });
}

function destinationCompilerRoot(context: LegacyContext) {
  if (!context.semanticEquivalenceAuthority && !context.historicalCompilerMappingAuthority) return context.root;
  const admission = context.definition.executionAdmissions.find(({ id }) => id === context.route.admissionId);
  if (!admission) fail(`Current destination admission ${context.route.admissionId} is unavailable.`);
  const bindingForm = {
    ...getFormDefaultsForRegisteredRoute(
      admission.studioMode as StudioMode,
      context.definition.pipelineClass as StudioModelType,
    ),
    modelType: context.definition.pipelineClass as StudioModelType,
    mode: admission.studioMode as StudioMode,
  };
  const { parameterOverrides, executionParameterOverrides } = huggingFaceClusterOverridesForBindingValues(
    context.definition,
    admission,
    bindingForm as unknown as Record<string, unknown>,
  );
  const suggestedValues = context.definition.suggestedInputs?.values ?? {};
  const seededParameterOverrides = Object.fromEntries(
    Object.entries(parameterOverrides).filter(
      ([name, value]) => !(value === '' && Object.prototype.hasOwnProperty.call(suggestedValues, name)),
    ),
  );

  // Historical bytes are evidence for source identity and instance values;
  // they are never a compiler input for the current destination definition.
  // In particular, do not clone the old root params/overrides here: dynamic
  // field actions may use those values to publish a different graph/control
  // surface. Build the same clean current-route witness as a fresh catalog
  // insertion, then adapt compatible persisted values only after the pinned
  // BlockDefinitionV2 has finalized.
  const root = createHuggingFaceClusterNode(
    context.definition,
    context.root.id,
    exactPosition(context.root, `Legacy Cluster ${context.root.id}`),
    { ...suggestedValues, ...seededParameterOverrides },
    admission.id,
    executionParameterOverrides,
  );
  root.width = context.root.width;
  root.height = context.root.height;
  const cleanInstance = root.data.huggingFaceClusterInstance;
  if (!cleanInstance?.execution) fail(`Current destination compiler root ${context.root.id} has no execution receipt.`);
  root.data.huggingFaceClusterInstance = {
    ...cleanInstance,
    presentation: {
      ...cleanInstance.presentation,
      expanded: context.instance.presentation.expanded,
    },
  };
  return root;
}

async function compileConversion(context: LegacyContext, timeoutMs?: number) {
  const compiled = await compileRegisteredCatalogBlockV2Exact(context.definition, destinationCompilerRoot(context), {
    timeoutMs,
  });
  const compilerMismatches = [
    ...(compiled.definition.contentHash !== context.route.compiledDefinitionContentHash
      ? ['definition content hash']
      : []),
    ...(compiled.instance.definitionSnapshot.source.executionAdmissionId !== context.route.admissionId
      ? ['execution admission']
      : []),
    ...(compiled.instance.authorities.length ? ['instance authorities'] : []),
    ...(compiled.instance.effectiveGraph.graphHash !== compiled.definition.graph.graphHash ? ['effective graph'] : []),
  ];
  if (compilerMismatches.length)
    fail(
      `Compiled registered definition for ${context.root.id} is stale or structurally customized (${compilerMismatches.join(', ')}).`,
    );
  const historicalAuthority = context.semanticEquivalenceAuthority ?? context.historicalCompilerMappingAuthority;
  if (historicalAuthority) {
    const destination = historicalAuthority.destination;
    const actualDestination = {
      manifestDefinitionId: context.route.definitionId,
      libraryRevision: context.route.libraryRevision,
      manifestContentHash: context.route.definitionContentHash,
      executionAdmissionId: context.route.admissionId,
      blockDefinitionId: compiled.definition.definitionId,
      blockDefinitionContentHash: compiled.definition.contentHash,
      blockDefinitionCanonicalSha256: context.route.compiledDefinitionCanonicalSha256,
      executionGraphHash: compiled.definition.graph.graphHash,
      interfaceHash: blockInterfaceHashV2({
        boundary: compiled.definition.boundary,
        controls: compiled.definition.controls,
      }),
    };
    if (!jsonEqual(destination, actualDestination))
      fail(
        `Reviewed historical compiler authority for ${context.root.id} is stale for the compiled BlockDefinitionV2 graph or interface.`,
      );
  }
  const ownedNodeMappings = semanticMappings(context, compiled.instance);
  let instance = withLegacyLayout(context, compiled.instance, ownedNodeMappings);
  const values = mapValues(context, instance, ownedNodeMappings);
  instance = values.instance;
  const previews = mapPreviews(context, instance, ownedNodeMappings);
  instance = previews.instance;
  const ownedIds = new Set([context.root.id, ...context.children.map(({ id }) => id)]);
  const absorbedInternalEdgeIds = context.edges
    .filter((edge) => ownedIds.has(edge.source) && ownedIds.has(edge.target))
    .map((edge) => {
      if (!edge.id) fail(`Legacy Cluster ${context.root.id} has an internal edge without an id.`);
      return edge.id;
    })
    .sort(lexicalCompare);
  if (new Set(absorbedInternalEdgeIds).size !== absorbedInternalEdgeIds.length)
    fail(`Legacy Cluster ${context.root.id} has duplicate internal edge ids.`);
  return {
    legacyInstanceId: context.root.id,
    legacyCompositeHash: context.candidate.legacyCompositeHash!,
    admissionId: context.route.admissionId,
    compiledDefinitionContentHash: context.route.compiledDefinitionContentHash,
    compiledDefinitionCanonicalSha256: context.route.compiledDefinitionCanonicalSha256,
    blockInstanceV2: instance,
    ownedNodeMappings,
    portMappings: portMappings(context, instance, ownedNodeMappings),
    valueMappings: values.mappings,
    previewMappings: previews.mappings,
    absorbedInternalEdgeIds,
    ...(context.semanticEquivalenceAuthority
      ? {
          semanticEquivalenceReceipt: {
            receiptId: context.semanticEquivalenceAuthority.receiptId,
            receiptHash: context.semanticEquivalenceAuthority.receiptHash,
          },
        }
      : {}),
    ...(context.historicalCompilerMappingAuthority
      ? {
          historicalCompilerMapping: {
            mappingId: context.historicalCompilerMappingAuthority.mappingId,
            mappingHash: context.historicalCompilerMappingAuthority.mappingHash,
          },
        }
      : {}),
  } satisfies RegisteredClusterCompilerConversion;
}

function diagnosticFor(error: unknown, candidate: CompositeMigrationCandidate): RegisteredClusterCompilerDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.includes('historical manifest')
    ? 'historical_manifest_unavailable'
    : message.includes('no execution receipt')
      ? 'execution_receipt_missing'
      : message.includes('source and legacy composite hashes')
        ? 'candidate_receipt_missing'
        : message.includes('saved root') || message.includes('projection') || message.includes('ambiguous')
          ? 'legacy_snapshot_ambiguous'
          : message.includes('route') || message.includes('admission') || message.includes('catalog definition')
            ? 'registered_route_unavailable'
            : message.includes('workflow')
              ? 'workflow_unavailable'
              : 'compiler_failed';
  return { sourcePath: candidate.sourcePath, instanceId: candidate.id, code, message };
}

async function loadCompilerDependencies() {
  const libraryStore = useHuggingFaceNodeLibraryStore.getState();
  const nodeStore = useNodesStore.getState();
  await Promise.all([
    libraryStore.loaded ? Promise.resolve() : libraryStore.fetchLibrary(),
    Object.keys(nodeStore.nodesRegistry).length ? Promise.resolve() : nodeStore.fetchNodes(),
    nodeStore.studioModelCapabilities.length ? Promise.resolve() : nodeStore.fetchStudioModelCapabilities(),
  ]);
  const libraryState = useHuggingFaceNodeLibraryStore.getState();
  if (!libraryState.library) fail(libraryState.error || 'The Hugging Face node library is unavailable.');
  if (!Object.keys(useNodesStore.getState().nodesRegistry).length) fail('The backend node registry is unavailable.');
  return libraryState.library;
}

/**
 * Generate compiler evidence only. This function never writes a workflow,
 * User Node, migration journal, or reusable definition. The caller must POST
 * the returned object back to the backend for a second read-only preview and
 * must reuse that exact parsed object if the user later authorizes Apply.
 */
export async function generateRegisteredClusterCompilerSupplement(options: {
  candidates: readonly CompositeMigrationCandidate[];
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: RegisteredClusterCompilerProgress) => void;
}): Promise<GeneratedRegisteredClusterCompilerSupplement> {
  const operationContext = captureWorkflowOperationContext();
  const candidates = options.candidates
    .filter(({ kind, status }) => kind === 'legacy_registered_cluster_instance' && status === 'blocked')
    .sort((left, right) =>
      lexicalCompare(tupleKey(left.sourcePath, left.id ?? ''), tupleKey(right.sourcePath, right.id ?? '')),
    );
  const library = await loadCompilerDependencies();
  if (library.definitions.some(({ provider }) => provider === 'diffusers')) {
    const conditional = useHuggingFaceModularConditionalStore.getState();
    if (!conditional.loaded) await conditional.fetchSnapshot();
  }
  if (!workflowOperationContextIsCurrent(operationContext, { includeForm: false }))
    fail('The active workflow changed while compiler dependencies were loading. Generate a fresh supplement.');
  // Candidates are sorted by source path, so one raw saved workflow can serve
  // all of its roots and then be released. Do not retain hundreds of complete
  // graph documents for the duration of a large legacy inventory.
  let activeWorkflow: SavedWorkflowCompilerSource | null = null;
  const diagnostics: RegisteredClusterCompilerDiagnostic[] = [];
  const conversions = new Map<string, RegisteredClusterCompilerConversion[]>();
  let completed = 0;
  for (const candidate of candidates) {
    if (options.signal?.aborted) throw new DOMException('Compiler supplement generation was cancelled.', 'AbortError');
    if (!workflowOperationContextIsCurrent(operationContext, { includeForm: false }))
      fail('The active workflow changed during compiler supplement generation. Generate a fresh supplement.');
    try {
      if (activeWorkflow?.sourcePath !== candidate.sourcePath)
        activeWorkflow = await fetchSavedWorkflow(candidate.sourcePath, options.signal);
      const workflow = activeWorkflow;
      if (!workflowOperationContextIsCurrent(operationContext, { includeForm: false }))
        fail('The active workflow changed while a saved workflow was loading. Generate a fresh supplement.');
      const context = resolveContext(candidate, workflow, library.definitions);
      const conversion = await compileConversion(context, options.timeoutMs);
      if (!workflowOperationContextIsCurrent(operationContext, { includeForm: false }))
        fail('The active workflow changed during compiler supplement generation. Generate a fresh supplement.');
      conversions.set(candidate.sourcePath, [...(conversions.get(candidate.sourcePath) ?? []), conversion]);
    } catch (error) {
      if (!workflowOperationContextIsCurrent(operationContext, { includeForm: false })) throw error;
      diagnostics.push(diagnosticFor(error, candidate));
    } finally {
      completed += 1;
      options.onProgress?.({
        completed,
        total: candidates.length,
        sourcePath: candidate.sourcePath,
        instanceId: candidate.id,
      });
    }
  }
  const supplement = parseRegisteredClusterCompilerSupplement({
    schemaVersion: 1,
    kind: 'registered_cluster_v2_compiler_supplement',
    compilerOutputs: [...conversions.entries()]
      .sort(([left], [right]) => lexicalCompare(left, right))
      .map(([sourcePath, sourceConversions]) => {
        const candidate = candidates.find(({ sourcePath: path }) => path === sourcePath)!;
        return {
          sourcePath,
          sourceSha256: candidate.sourceSha256,
          conversions: sourceConversions.sort((left, right) =>
            lexicalCompare(left.legacyInstanceId, right.legacyInstanceId),
          ),
        };
      }),
  });
  if (new TextEncoder().encode(JSON.stringify(supplement)).byteLength > MAX_SUPPLEMENT_BYTES)
    fail('Generated compiler supplement exceeds the reviewed 32 MiB request limit.');
  return {
    supplement,
    diagnostics: diagnostics.sort((left, right) =>
      lexicalCompare(
        tupleKey(left.sourcePath, left.instanceId ?? '', left.code),
        tupleKey(right.sourcePath, right.instanceId ?? '', right.code),
      ),
    ),
    candidateCount: candidates.length,
    conversionCount: supplement.compilerOutputs.reduce((count, output) => count + output.conversions.length, 0),
  };
}

/** Tests can assert that compiler cleanup never changes unrelated canvas data. */
export function registeredClusterCompilerTransientCount() {
  return useFlowStore.getState().nodes.filter(({ data }) => typeof data.blockCompilationTransientV2 === 'string')
    .length;
}
