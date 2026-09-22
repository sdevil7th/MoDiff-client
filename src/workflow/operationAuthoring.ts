import { operationOwnsModel } from './operationContracts';
import type { Edge } from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { deepEqual } from '../utils/deepEqual';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import type { OperationContract } from './operationContracts';
import { operationAuthoring } from './operationAuthoringHint';
export { operationAuthoring } from './operationAuthoringHint';
import { operationPortCompatibility } from './operationCatalog';
import { createNodeFromRegistry } from './nodeFactory';
import { acceptsOperationValue as acceptsValue } from './operationFieldValue';

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
  return !field.hidden && field.display !== 'output' && !field.signal;
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
  const loader = starter.nodes.find((n) => operationOwnsModel(n.operation))!;
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
    !operationOwnsModel(hint.operation) ||
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
          (!operationOwnsModel(h.operation) || n.id === loaderId)
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
    if (operationOwnsModel(h?.operation))
      throw new Error(
        'A stage uses another loader too. Separate the shared component connection before changing this graph.',
      );
  }
  return result;
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

/** Replace a demonstrably untouched starter when its decomposition changes.
 * Any authored value, custom connection or ambiguous output falls back to the
 * ordinary preservation/review planner. The baseline is resolved by the backend. */
export function planPristineOperationChange(
  graph: OperationGraph,
  loaderId: string,
  baseline: OperationStarter,
  starter: OperationStarter,
): OperationChangePlan | null {
  const scope = operationScope(graph, loaderId);
  const root = scope.find((n) => n.id === loaderId)!;
  const hint = operationAuthoring(root)!;
  if (
    baseline.pipelineClass !== hint.operation.pipelineClass ||
    baseline.task !== hint.operation.task ||
    baseline.task !== starter.task ||
    scope.length !== baseline.nodes.length
  )
    return null;
  const baselineGraph = createOperationStarter(baseline, root.position);
  const baselineByOperation = new Map(
    baselineGraph.nodes.map((n) => [operationAuthoring(n)!.operation.operationId, n]),
  );
  const currentByOperation = new Map(scope.map((n) => [operationAuthoring(n)!.operation.operationId, n]));
  if (
    starter.nodes.every((n) => currentByOperation.has(n.operation.operationId)) &&
    starter.nodes.length === scope.length
  )
    return null;
  for (const node of scope) {
    const authoring = operationAuthoring(node)!;
    const original = baselineByOperation.get(authoring.operation.operationId);
    if (
      !original ||
      authoring.retained.length ||
      node.data.uiState?.disabled ||
      node.data.label !== original.data.label
    )
      return null;
    for (const [name, field] of Object.entries(node.data.params)) {
      if (!publicSetting(field)) continue;
      if (!deepEqual(operationFieldValue(field), authoring.defaults[name])) return null;
      if (Boolean(field.isInput) !== Boolean(original.data.params[name]?.isInput)) return null;
    }
  }
  const affected = new Set(scope.map((n) => n.id));
  const edgeKey = (edge: Edge, nodes: CustomNodeType[]) =>
    JSON.stringify([
      operationAuthoring(nodes.find((n) => n.id === edge.source)!)!.operation.operationId,
      edge.sourceHandle,
      operationAuthoring(nodes.find((n) => n.id === edge.target)!)!.operation.operationId,
      edge.targetHandle,
    ]);
  const internal = graph.edges.filter((e) => affected.has(e.source) && affected.has(e.target));
  if (
    !deepEqual(
      internal.map((e) => edgeKey(e, scope)).sort(),
      baselineGraph.edges.map((e) => edgeKey(e, baselineGraph.nodes)).sort(),
    )
  )
    return null;
  if (graph.edges.some((e) => !affected.has(e.source) && affected.has(e.target))) return null;
  const fresh = createOperationStarter(starter, root.position);
  const outside = graph.nodes.filter((n) => !affected.has(n.id));
  const edges = graph.edges.filter((e) => !affected.has(e.source) && !affected.has(e.target));
  for (const edge of graph.edges.filter((e) => affected.has(e.source) && !affected.has(e.target))) {
    const target = outside.find((n) => n.id === edge.target);
    if (!target || target.data.action !== 'Preview' || !['modules.Image', 'modules.Audio'].includes(target.data.module))
      return null;
    const originalPort = port(
      scope.find((n) => n.id === edge.source)!,
      edge.sourceHandle,
      'output',
    );
    if (originalPort?.semantics?.kind !== 'media') return null;
    const candidates = fresh.nodes.flatMap((node) =>
      operationAuthoring(node)!.operation.ports.flatMap((output) => {
        const proposed = { ...edge, source: node.id, sourceHandle: output.name };
        return output.direction === 'output' &&
          output.semantics?.kind === 'media' &&
          !fresh.edges.some((e) => e.source === node.id && e.sourceHandle === output.name) &&
          compatibleEdge(proposed, [...fresh.nodes, ...outside])
          ? [proposed]
          : [];
      }),
    );
    if (candidates.length !== 1) return null;
    edges.push(candidates[0]!);
  }
  return {
    graph: { nodes: [...outside, ...fresh.nodes], edges: [...edges, ...fresh.edges] },
    changes: [
      'Replace the untouched starter with the selected model’s connected operations; preserve preview nodes and unrelated branches.',
    ],
    diagnostics: [],
    replacements: {},
  };
}

/** Pure preview. No graph, library, model cache, or backend mutation happens here. */
export function planOperationChange(
  graph: OperationGraph,
  loaderId: string,
  starter: OperationStarter,
  options: { replaceModel?: boolean; restoreDefaults?: boolean } = {},
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
      // Explicit reset applies only to creative value controls. Preserve model
      // ownership, resource settings, media, custom nodes and connected inputs.
      if (
        options.restoreDefaults &&
        !operationOwnsModel(previous.operation) &&
        next.operation.ports.some(
          (port) => port.name === name && port.direction === 'input' && port.semantics?.kind === 'value',
        ) &&
        !graph.edges.some((edge) => edge.target === old.id && edge.targetHandle === name)
      )
        continue;
      // A changed loader adopts the target's exact artifact and trust defaults.
      // Treat previous loader overrides as retained settings for explicit review.
      const allowed =
        !Object.prototype.hasOwnProperty.call(next.operation.binding?.values ?? {}, name) &&
        !(
          (modelChanged || options.replaceModel) &&
          operationOwnsModel(previous.operation) &&
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
            'execution_profile_id',
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
