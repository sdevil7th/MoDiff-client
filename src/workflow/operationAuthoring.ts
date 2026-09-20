import type { Edge } from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { deepEqual } from '../utils/deepEqual';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { parseOperationContracts, type OperationContract } from './operationContracts';
import { operationPortCompatibility } from './operationCatalog';
import { createNodeFromRegistry } from './nodeFactory';

export type RetainedOperationSetting = { field: string; value: unknown; pipeline: string; reason: string };
/** Advisory provenance for ordinary nodes. It grants no execution authority. */
export type OperationAuthoring = {
  schemaVersion: 1;
  operation: OperationContract;
  defaults: Record<string, unknown>;
  retained: RetainedOperationSetting[];
  sharedInputs?: { field: string; name: string; loaderId: string; groupId: string }[];
};
export type OperationStarter = {
  pipelineClass: string;
  task: string;
  workflowId: string | null;
  nodes: { operation: OperationContract; node: NodeData }[];
  edges: { source: string; sourceHandle: string; target: string; targetHandle: string }[];
  requiredInputs: { operationId: string; field: string }[];
  upstreamBlocks: string[];
  sharedInputs: { name: string; members: { operationId: string; field: string }[] }[];
};
export type OperationGraph = { nodes: CustomNodeType[]; edges: Edge[] };
export type OperationChangePlan = {
  graph: OperationGraph;
  changes: string[];
  diagnostics: string[];
  /** Exact correspondence for adapters that preserve semantic ownership. */
  replacements: Record<string, string>;
};

function publicSetting(field: NodeParams) {
  return !field.hidden && field.display !== 'output' && field.display !== 'input' && !field.signal;
}

export function operationFieldValue(field: NodeParams | undefined): unknown {
  return field?.value ?? field?.default;
}

export function withOperationAuthoring(node: NodeData, operation: OperationContract): NodeData {
  return {
    ...node,
    operationAuthoring: {
      schemaVersion: 1,
      operation,
      defaults: Object.fromEntries(
        Object.entries(node.params)
          .filter(([, p]) => publicSetting(p) && operationFieldValue(p) !== undefined)
          .map(([key, p]) => [key, operationFieldValue(p)]),
      ),
      retained: [],
    },
  };
}

/** Imported hints are untrusted and never change a legacy graph on restore. */
export function operationAuthoring(node: CustomNodeType): OperationAuthoring | null {
  const hint = node.data.operationAuthoring;
  if (
    !hint ||
    hint.schemaVersion !== 1 ||
    !hint.defaults ||
    typeof hint.defaults !== 'object' ||
    Array.isArray(hint.defaults) ||
    Object.keys(hint.defaults).length > 512 ||
    !Array.isArray(hint.retained) ||
    hint.retained.length > 512
  )
    return null;
  try {
    const [operation] = parseOperationContracts([hint.operation], 3);
    if (!operation || operation.nodeKey !== `${node.data.module}.${node.data.action}`) return null;
    if (
      hint.retained.some(
        (v) => !v || typeof v.field !== 'string' || typeof v.reason !== 'string' || typeof v.pipeline !== 'string',
      )
    )
      return null;
    return hint;
  } catch {
    return null;
  }
}

export function createOperationStarter(starter: OperationStarter, position: { x: number; y: number }): OperationGraph {
  const nodes = starter.nodes.map(({ operation, node }, index) =>
    createNodeFromRegistry(
      operation.nodeKey,
      { [operation.nodeKey]: withOperationAuthoring(node, operation) },
      { x: position.x + index * 420, y: position.y },
    )!,
  );
  const ids = new Map(nodes.map((node) => [node.data.operationAuthoring!.operation.operationId, node.id]));
  const edges = starter.edges.map((edge) => ({
    ...edge,
    id: `edge-${nanoid()}`,
    source: ids.get(edge.source)!,
    target: ids.get(edge.target)!,
    type: 'default',
  }));
  attachSharedInputs(nodes, starter, ids);
  return { nodes, edges };
}

function attachSharedInputs(nodes: CustomNodeType[], starter: OperationStarter, ids: Map<string, string>) {
  const loader = starter.nodes.find((n) => n.operation.decomposition === 'loader')!;
  for (const group of starter.sharedInputs)
    for (const member of group.members) {
      const node = nodes.find((n) => n.id === ids.get(member.operationId))!;
      const hint = node.data.operationAuthoring!;
      hint.sharedInputs ??= [];
      hint.sharedInputs.push({
        field: member.field,
        name: group.name,
        groupId: group.members
          .map((m) => `${m.operationId}.${m.field}`)
          .sort()
          .join('|'),
        loaderId: ids.get(loader.operation.operationId)!,
      });
      node.data.params[member.field] = {
        ...node.data.params[member.field],
        description: `Shared ${group.name} for this connected stage graph. Editing either field updates all members.`,
      };
    }
}

/** Follow existing canonical connections from one loader. Custom branches are
 * preserved, and an unrelated loader/Block is never adopted into this scope. */
export function operationScope(graph: OperationGraph, loaderId: string): CustomNodeType[] {
  const root = graph.nodes.find((n) => n.id === loaderId);
  const hint = root && operationAuthoring(root);
  if (
    !root ||
    !hint ||
    hint.operation.decomposition !== 'loader' ||
    root.parentId ||
    root.data.blockInstanceV2 ||
    root.data.blockProjectionOwnerId
  )
    throw new Error('Choose a top-level operation loader. Use the existing Block inspector for nested Blocks.');
  const candidates = new Map(
    graph.nodes
      .filter((n) => {
        const h = operationAuthoring(n);
        return (
          h &&
          !n.parentId &&
          !n.data.blockInstanceV2 &&
          !n.data.blockProjectionOwnerId &&
          h.operation.pipelineClass === hint.operation.pipelineClass &&
          h.operation.task === hint.operation.task &&
          (h.operation.decomposition !== 'loader' || n.id === loaderId)
        );
      })
      .map((n) => [n.id, n]),
  );
  const ids = new Set([loaderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      for (const [source, target] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ]) {
        if (source && target && ids.has(source) && candidates.has(target) && !ids.has(target)) {
          ids.add(target);
          changed = true;
        }
      }
    }
  }
  const result = [...ids].map((id) => candidates.get(id)!);
  if (new Set(result.map((n) => operationAuthoring(n)!.operation.operationId)).size !== result.length)
    throw new Error(
      'This graph has several instances of one stage. Change a separate branch or reconnect it to its own loader first.',
    );
  // A shared stage belongs to neither loader exclusively.
  for (const edge of graph.edges) {
    if (!ids.has(edge.target) || ids.has(edge.source)) continue;
    const source = graph.nodes.find((n) => n.id === edge.source);
    const h = source && operationAuthoring(source);
    if (h?.operation.decomposition === 'loader')
      throw new Error(
        'A stage uses another loader too. Separate the shared component connection before changing this graph.',
      );
  }
  return result;
}

function acceptsValue(field: NodeParams, value: unknown): boolean {
  if (field.display === 'random' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const seed = value as Record<string, unknown>;
    return (
      Object.keys(seed).length === 2 &&
      typeof seed.isRandom === 'boolean' &&
      acceptsValue({ ...field, display: 'number' }, seed.value)
    );
  }
  const types = Array.isArray(field.type) ? field.type : [field.type];
  if (
    typeof value === 'number' ||
    (typeof value === 'string' &&
      value.trim() &&
      Number.isFinite(Number(value)) &&
      types.some((t) => ['int', 'float', 'number'].includes(t ?? '')))
  ) {
    const number = Number(value);
    if (
      !Number.isFinite(number) ||
      (types.includes('int') && !Number.isInteger(number)) ||
      (field.min !== undefined && number < field.min) ||
      (field.max !== undefined && number > field.max)
    )
      return false;
  }
  if (
    types.some((t) => ['int', 'float', 'number'].includes(t ?? '')) &&
    !(typeof value === 'number' || (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))))
  )
    return false;
  if (types.some((t) => ['bool', 'boolean'].includes(t ?? '')) && typeof value !== 'boolean') return false;
  if (field.options) {
    const options = Array.isArray(field.options) ? field.options : Object.keys(field.options);
    if (
      options.length &&
      !options.some(
        (option) =>
          deepEqual(option, value) ||
          (typeof option === 'object' && option !== null && 'value' in option && deepEqual(option.value, value)),
      )
    )
      return false;
  }
  return true;
}

function port(node: CustomNodeType, field: string | null | undefined, direction: 'input' | 'output') {
  return operationAuthoring(node)?.operation.ports.find((p) => p.name === field && p.direction === direction);
}

function compatibleEdge(edge: Edge, nodes: CustomNodeType[]) {
  const source = nodes.find((n) => n.id === edge.source);
  const target = nodes.find((n) => n.id === edge.target);
  const left = source?.data.params[edge.sourceHandle ?? ''];
  const right = target?.data.params[edge.targetHandle ?? ''];
  if (
    !source ||
    !target ||
    !left ||
    !right ||
    left.hidden ||
    right.hidden ||
    left.display !== 'output' ||
    !(right.display === 'input' || right.isInput) ||
    !connectionTypesAreCompatible(left.type, right.type)
  )
    return false;
  const a = port(source, edge.sourceHandle, 'output');
  const b = port(target, edge.targetHandle, 'input');
  return !a || !b || operationPortCompatibility(a, b) !== 'incompatible';
}

/** Pure preview. No graph, library, model cache, or backend mutation happens here. */
export function planOperationChange(
  graph: OperationGraph,
  loaderId: string,
  starter: OperationStarter,
): OperationChangePlan {
  const scope = operationScope(graph, loaderId);
  const root = scope.find((n) => n.id === loaderId)!;
  const before = new Map(scope.map((n) => [operationAuthoring(n)!.operation.operationId, n]));
  const draft = createOperationStarter(starter, root.position);
  const changes: string[] = [];
  const diagnostics: string[] = [];
  const idMap = new Map<string, string>();
  const replacements = new Map<string, CustomNodeType>();
  const changedIds = new Map<string, string>();
  let added = 0;
  const insertionX = Math.max(...graph.nodes.map((n) => n.position.x + (n.measured?.width ?? n.width ?? 360))) + 100;
  const migrated = draft.nodes.map((fresh) => {
    const next = operationAuthoring(fresh)!;
    const old = before.get(next.operation.operationId);
    if (!old) {
      changes.push(`Add ${fresh.data.label}.`);
      return { ...fresh, position: { x: insertionX + added++ * 420, y: root.position.y } };
    }
    const previous = operationAuthoring(old)!;
    const id = previous.operation.nodeKey === next.operation.nodeKey ? old.id : fresh.id;
    idMap.set(fresh.id, id);
    changedIds.set(old.id, id);
    const params = structuredClone(fresh.data.params);
    for (const [name, field] of Object.entries(old.data.params)) {
      if (
        field.isInput &&
        params[name] &&
        publicSetting(params[name]) &&
        connectionTypesAreCompatible(field.type, params[name].type)
      )
        params[name] = { ...params[name], isInput: true };
    }
    const retained = [...previous.retained];
    const modelChanged = previous.operation.binding?.pipelineClass !== next.operation.binding?.pipelineClass;
    for (const [name, field] of Object.entries(old.data.params)) {
      if (!publicSetting(field) || field.value === undefined) continue;
      const overridden =
        !Object.prototype.hasOwnProperty.call(previous.defaults, name) ||
        !deepEqual(previous.defaults[name], field.value);
      if (!overridden) continue;
      const target = params[name];
      // A changed loader adopts the target's exact artifact and trust defaults.
      // Treat previous loader overrides as retained settings for explicit review.
      const allowed =
        !Object.prototype.hasOwnProperty.call(next.operation.binding?.values ?? {}, name) &&
        !(
          modelChanged &&
          previous.operation.decomposition === 'loader' &&
          [
            'repo_id',
            'model_id',
            'revision',
            'reviewed_variant',
            'trust_remote_code',
            'conditioning_model_id',
            'conditioning_revision',
            'conditioning_kind',
            'execution_recipe',
          ].includes(name)
        ) &&
        target &&
        publicSetting(target) &&
        connectionTypesAreCompatible(field.type, target.type) &&
        acceptsValue(target, field.value);
      if (allowed)
        params[name] = { ...target, value: field.value, ...(field.artifacts ? { artifacts: field.artifacts } : {}) };
      else {
        const reason = `${old.data.label}.${name}: retained outside execution; review the new ${fresh.data.label} settings.`;
        retained.push({ field: name, value: field.value, pipeline: previous.operation.pipelineClass, reason });
        diagnostics.push(reason);
      }
    }
    if (retained.length > 512)
      throw new Error('Too many retained settings. Review and remove old retained entries before another change.');
    changes.push(
      `Adapt ${old.data.label}; keep its position and compatible overrides${id === old.id ? ' and node identity' : '; replace the runtime identity for the changed implementation'}.`,
    );
    const replacement = {
      ...old,
      id,
      data: {
        ...old.data,
        ...fresh.data,
        params,
        operationAuthoring: { ...next, retained },
        uiState: old.data.uiState,
      },
    };
    replacements.set(old.id, replacement);
    return replacement;
  });
  // Unmatched stages remain visible and disabled, retaining their full schema
  // and values. Undo restores their original edges and active status.
  const obsolete = new Set(scope.filter((n) => !replacements.has(n.id)).map((n) => n.id));
  const nodes = graph.nodes.map((n) => {
    if (replacements.has(n.id)) return replacements.get(n.id)!;
    if (!obsolete.has(n.id)) return n;
    diagnostics.push(
      `${n.data.label}: kept disabled because the new task has no matching operation. Reconnect it deliberately or remove it.`,
    );
    return { ...n, data: { ...n.data, uiState: { ...n.data.uiState, disabled: true } } };
  });
  nodes.push(...migrated.filter((n) => !nodes.some((old) => old.id === n.id)));
  const affected = new Set(scope.map((n) => n.id));
  const edges: Edge[] = [];
  for (const edge of graph.edges) {
    if (!affected.has(edge.source) && !affected.has(edge.target)) {
      edges.push(edge);
      continue;
    }
    const adapted = {
      ...edge,
      source: changedIds.get(edge.source) ?? edge.source,
      target: changedIds.get(edge.target) ?? edge.target,
    };
    if (!obsolete.has(edge.source) && !obsolete.has(edge.target) && compatibleEdge(adapted, nodes)) edges.push(adapted);
    else
      diagnostics.push(
        `Disconnect ${edge.source}.${edge.sourceHandle} → ${edge.target}.${edge.targetHandle}. Its endpoint or model/state contract changed; reconnect a compatible port. The nodes are retained.`,
      );
  }
  for (const edge of draft.edges) {
    const proposed = {
      ...edge,
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
    };
    if (!edges.some((e) => e.target === proposed.target && e.targetHandle === proposed.targetHandle))
      edges.push(proposed);
  }
  const operationIds = new Map(migrated.map((n) => [operationAuthoring(n)!.operation.operationId, n.id]));
  for (const node of migrated) delete node.data.operationAuthoring!.sharedInputs;
  attachSharedInputs(nodes, starter, operationIds);
  for (const group of starter.sharedInputs) {
    const members = group.members.map((m) => ({
      node: nodes.find((n) => n.id === operationIds.get(m.operationId))!,
      field: m.field,
    }));
    const existing = group.members.flatMap((m) => {
      const old = before.get(m.operationId),
        field = old?.data.params[m.field];
      if (!old || !field || operationFieldValue(field) === undefined) return [];
      return [
        {
          value: operationFieldValue(field),
          overridden: !deepEqual(operationAuthoring(old)!.defaults[m.field], operationFieldValue(field)),
        },
      ];
    });
    const choices = existing.some((v) => v.overridden) ? existing.filter((v) => v.overridden) : existing;
    const value = choices[0]?.value ?? operationFieldValue(members[0]!.node.data.params[members[0]!.field]);
    if (
      choices.some((v) => !deepEqual(v.value, value)) ||
      members.some((m) => !acceptsValue(m.node.data.params[m.field]!, value))
    )
      throw new Error(
        `The shared ${group.name} has conflicting or incompatible values. Align the existing controls before changing this task.`,
      );
    const drivers = edges.filter((e) => members.some((m) => e.target === m.node.id && e.targetHandle === m.field));
    if (new Set(drivers.map((e) => `${e.source}:${e.sourceHandle}`)).size > 1)
      throw new Error(
        `The shared ${group.name} has several input sources. Choose one source before changing this task.`,
      );
    for (const member of members) {
      member.node.data.params[member.field] = {
        ...member.node.data.params[member.field],
        value: structuredClone(value),
      };
      if (drivers[0]) {
        member.node.data.params[member.field]!.isInput = true;
        if (!edges.some((e) => e.target === member.node.id && e.targetHandle === member.field))
          edges.push({ ...drivers[0], id: `edge-${nanoid()}`, target: member.node.id, targetHandle: member.field });
      }
    }
    changes.push(
      `Share ${group.name} across ${members.map((m) => m.node.data.label).join(' and ')}; preserve its authored value and use one random draw per run.`,
    );
  }
  return { graph: { nodes, edges }, changes, diagnostics, replacements: Object.fromEntries(changedIds) };
}
