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
import { operationScope } from './operationScope';
export { operationScope } from './operationScope';
import {
  unpackVisualOperationGroups,
  restoreVisualOperationGroups,
  visualOperationGroup,
} from './visualOperationGroups';

export type RetainedOperationSetting = { field: string; value: unknown; pipeline: string; reason: string };
export type InactiveOperationDraft = { routeKey: string; nodes: CustomNodeType[]; edges: Edge[] };
/** Advisory provenance for ordinary nodes. It grants no execution authority. */
export type OperationAuthoring = {
  schemaVersion: 1;
  operation: OperationContract;
  defaults: Record<string, unknown>;
  retained: RetainedOperationSetting[];
  authored?: string[];
  /** Non-executable, route-scoped recovery copies; never an alternate executor. */
  inactiveDrafts?: InactiveOperationDraft[];
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
  /** Human-facing review grouped by outcome; never expose internal node IDs. */
  review: {
    changes: string[];
    preserved: string[];
    attention: string[];
    required: boolean;
  };
  /** Exact correspondence for adapters that preserve semantic ownership. */
  replacements: Record<string, string>;
};

function fieldLabel(node: CustomNodeType, field: string | null | undefined) {
  const label = field ? node.data.params[field]?.label : undefined;
  return String(label || field || 'port')
    .replace(/\s*\*\s*$/u, '')
    .trim();
}

function endpointLabel(node: CustomNodeType | undefined, field: string | null | undefined) {
  if (!node) return 'Unknown node';
  return `${node.data.label || node.data.action || 'Node'} · ${fieldLabel(node, field)}`;
}

function semanticName(node: CustomNodeType, field: string, direction: 'input' | 'output') {
  const declared = port(node, field, direction)?.semanticName;
  const value = declared || '';
  return value
    .toLowerCase()
    .replace(/\*/gu, '')
    .replace(/\b(input|output)\b/gu, '')
    .replace(/_(input|output|in|out)$/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function routeKey(node: CustomNodeType) {
  const hint = operationAuthoring(node)!;
  return JSON.stringify([
    hint.operation.pipelineClass,
    hint.operation.task,
    hint.operation.workflowId ?? null,
    ...['repo_id', 'model_id', 'revision', 'execution_profile_id', 'reviewed_variant'].map(
      (name) => operationFieldValue(node.data.params[name]) ?? null,
    ),
  ]);
}

function isAuthored(node: CustomNodeType, name: string, field: NodeParams) {
  const hint = operationAuthoring(node)!;
  return (
    hint.authored?.includes(name) ||
    !Object.prototype.hasOwnProperty.call(hint.defaults, name) ||
    !deepEqual(hint.defaults[name], operationFieldValue(field))
  );
}

function transferableSetting(source: CustomNodeType, sourceName: string, target: CustomNodeType, targetName: string) {
  const a = port(source, sourceName, 'input');
  const b = port(target, targetName, 'input');
  if (!a || !b || a.semanticName !== b.semanticName) return false;
  // Backend v3 contracts do not yet distinguish distilled, true CFG and CFG
  // guidance semantically. Do not invent that equivalence from their labels.
  if (
    /guidance|cfg/i.test(a.semanticName) &&
    operationAuthoring(source)!.operation.pipelineClass !== operationAuthoring(target)!.operation.pipelineClass
  )
    return false;
  // This is a value migration between two input declarations, not a wire
  // joining two input sockets. Assess the source as a supplied output value.
  return operationPortCompatibility({ ...a, direction: 'output' }, b) !== 'incompatible';
}

function reviewValue(value: unknown) {
  let result: string;
  if (typeof value === 'string') result = value;
  else {
    try {
      result = JSON.stringify(value);
    } catch {
      result = String(value);
    }
  }
  return result.length > 80 ? `${result.slice(0, 77)}…` : result;
}

function decompositionLabel(nodes: CustomNodeType[]) {
  return nodes.some((node) => {
    const decomposition = operationAuthoring(node)?.operation.decomposition;
    return decomposition === 'pipeline' || decomposition === 'integrated';
  })
    ? 'whole-pipeline nodes'
    : 'editable stage nodes';
}

function publicSetting(field: NodeParams) {
  return !field.hidden && field.display !== 'output' && !field.signal;
}

export function operationFieldValue(field: NodeParams | undefined): unknown {
  return field?.value ?? field?.default;
}

export function withOperationAuthoring(node: NodeData, operation: OperationContract): NodeData {
  return {
    ...node,
    // The backend has already resolved this exact operation/profile schema.
    // Mount-time selector/signal actions would replace it with family defaults
    // (e.g. unhide Schnell guidance or reset Turbo's bounds/artifact selector).
    // Explicit user actions and connection-driven visibility still run.
    params: Object.fromEntries(
      Object.entries(node.params).map(([key, param]) => [
        key,
        {
          ...param,
          ...(param.onSignal || (param.onChange && !['input', 'output'].includes(param.display ?? ''))
            ? {
                fieldOptions: {
                  ...param.fieldOptions,
                  ...(param.onSignal ? { suppressAutomaticSignalAction: true } : {}),
                  ...(param.onChange && !['input', 'output'].includes(param.display ?? '')
                    ? { suppressInitialFieldAction: true }
                    : {}),
                },
              }
            : {}),
        },
      ]),
    ),
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
  if (graph.nodes.some(visualOperationGroup)) return null;
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
      authoring.authored?.length ||
      authoring.inactiveDrafts?.length ||
      node.parentId ||
      !deepEqual(node.position, original.position) ||
      !deepEqual(node.data.uiState, original.data.uiState) ||
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
    review: {
      changes: [
        `Replace ${decompositionLabel(scope)} with ${decompositionLabel(fresh.nodes)} and reconnect the existing preview.`,
      ],
      preserved: ['Preview nodes and unrelated branches'],
      attention: [],
      required: false,
    },
    replacements: {},
  };
}

/** Pure preview. No graph, library, model cache, or backend mutation happens here. */
export function planOperationChange(
  graph: OperationGraph,
  loaderId: string,
  starter: OperationStarter,
  options: {
    replaceModel?: boolean;
    restoreDefaults?: boolean;
    baseline?: OperationStarter | null;
    preserveValues?: boolean;
  } = {},
): OperationChangePlan {
  if (graph.nodes.some(visualOperationGroup)) {
    const unpacked = unpackVisualOperationGroups(graph);
    const plan = planOperationChange(unpacked.graph, loaderId, starter, options);
    return { ...plan, graph: restoreVisualOperationGroups(plan.graph, unpacked, plan.replacements) };
  }
  const scope = operationScope(graph, loaderId);
  const root = scope.find((n) => n.id === loaderId)!;
  if (options.preserveValues && operationAuthoring(root)!.operation.pipelineClass !== starter.pipelineClass)
    throw new Error('Preserving all current values is only supported within the same pipeline.');
  const before = new Map(scope.map((n) => [operationAuthoring(n)!.operation.operationId, n]));
  const draft = createOperationStarter(starter, root.position);
  const nextOwner = draft.nodes.find((node) => operationOwnsModel(operationAuthoring(node)?.operation))!;
  const archived = operationAuthoring(root)!.inactiveDrafts ?? [];
  const returning = archived.find((item) => item.routeKey === routeKey(nextOwner));
  const inactiveByOperation = new Map(
    (returning?.nodes ?? []).map((node) => [operationAuthoring(node)!.operation.operationId, node]),
  );
  const changes: string[] = [];
  const diagnostics: string[] = [];
  const reviewChanges: string[] = [];
  const preserved: string[] = [];
  const addPreserved = (message: string) => {
    if (!preserved.includes(message)) preserved.push(message);
  };
  const idMap = new Map<string, string>();
  const replacements = new Map<string, CustomNodeType>();
  const changedIds = new Map<string, string>();
  const deferredSettings: {
    old: CustomNodeType;
    fresh: CustomNodeType;
    name: string;
    field: NodeParams;
    previous: OperationAuthoring;
  }[] = [];
  let added = 0;
  const insertionX = Math.max(...graph.nodes.map((n) => n.position.x + (n.measured?.width ?? n.width ?? 360))) + 100;
  const migrated = draft.nodes.map((fresh) => {
    const next = operationAuthoring(fresh)!;
    const old = before.get(next.operation.operationId) ?? inactiveByOperation.get(next.operation.operationId);
    if (!old) {
      changes.push(`Add ${fresh.data.label}.`);
      return { ...fresh, position: { x: insertionX + added++ * 420, y: root.position.y } };
    }
    const previous = operationAuthoring(old)!;
    const restored = inactiveByOperation.get(next.operation.operationId);
    // A changed implementation or bound pipeline needs a separate runtime cache
    // identity: generic Python nodes retain pipeline-specific instance state.
    // An exact return must recover the archived identity instead of allocating a
    // third one. The final collision check still protects unrelated nodes.
    const id =
      previous.operation.nodeKey === next.operation.nodeKey &&
      previous.operation.binding?.pipelineClass === next.operation.binding?.pipelineClass
        ? old.id
        : restored?.data.operationAuthoring?.operation.nodeKey === next.operation.nodeKey &&
            restored.data.operationAuthoring.operation.binding?.pipelineClass === next.operation.binding?.pipelineClass
          ? restored.id
          : fresh.id;
    idMap.set(fresh.id, id);
    changedIds.set(old.id, id);
    const params = structuredClone(fresh.data.params);
    if (restored && !options.restoreDefaults) {
      for (const [name, field] of Object.entries(restored.data.params)) {
        if (
          publicSetting(field) &&
          params[name] &&
          publicSetting(params[name]) &&
          isAuthored(restored, name, field) &&
          transferableSetting(restored, name, fresh, name) &&
          acceptsValue(params[name], operationFieldValue(field)) &&
          !Object.prototype.hasOwnProperty.call(next.operation.binding?.values ?? {}, name) &&
          !operationOwnsModel(next.operation)
        ) {
          params[name] = { ...params[name], value: structuredClone(operationFieldValue(field)) };
        }
      }
    }
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
    for (const [name, originalField] of Object.entries(old.data.params)) {
      // Preserve compatible creative defaults, not task-bound selectors or
      // controls absent from the destination. Authored overrides still go
      // through the normal review path below.
      const preserveDefault =
        options.preserveValues &&
        params[name] &&
        publicSetting(params[name]) &&
        !Object.prototype.hasOwnProperty.call(next.operation.binding?.values ?? {}, name) &&
        acceptsValue(params[name], operationFieldValue(originalField)) &&
        (operationOwnsModel(previous.operation) || transferableSetting(old, name, fresh, name));
      // A direct socket connection is not a request for a new creative example.
      // Retain default-backed visible values too, through the same schema and
      // semantic checks used for explicit overrides. Model-change behavior is
      // unchanged unless this narrowly scoped option is requested.
      const field =
        preserveDefault && originalField.value === undefined
          ? { ...originalField, value: operationFieldValue(originalField) as NodeParams['value'] }
          : originalField;
      if (!publicSetting(field) || field.value === undefined) continue;
      if (options.preserveValues && deepEqual(field.value, operationFieldValue(params[name]))) continue;
      const overridden = preserveDefault || isAuthored(old, name, field);
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
        (operationOwnsModel(previous.operation) || transferableSetting(old, name, fresh, name)) &&
        connectionTypesAreCompatible(field.type, target.type) &&
        acceptsValue(target, field.value);
      if (allowed) {
        params[name] = { ...target, value: field.value, ...(field.artifacts ? { artifacts: field.artifacts } : {}) };
        addPreserved(`${old.data.label} · ${fieldLabel(old, name)}: ${reviewValue(field.value)}`);
      } else if (!operationOwnsModel(previous.operation)) {
        deferredSettings.push({ old, fresh, name, field, previous });
      } else {
        const reason = `${old.data.label} · ${fieldLabel(old, name)} cannot be applied to ${fresh.data.label}; its previous value (${reviewValue(field.value)}) remains available in Implementation.`;
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
        operationAuthoring: {
          ...next,
          retained,
          authored: [
            ...new Set([...(previous.authored ?? []), ...(restored?.data.operationAuthoring?.authored ?? [])]),
          ],
        },
        uiState: old.data.uiState,
      },
    };
    replacements.set(old.id, replacement);
    return replacement;
  });
  const obsolete = new Set(scope.filter((n) => !replacements.has(n.id)).map((n) => n.id));
  const newOperations = migrated.filter((node) => !before.has(operationAuthoring(node)!.operation.operationId));
  const topologyChanged = decompositionLabel(scope) !== decompositionLabel(migrated);
  const pipelineChanged = operationAuthoring(root)!.operation.pipelineClass !== starter.pipelineClass;
  const replaceUnmatched = topologyChanged || (pipelineChanged && obsolete.size > 0);
  const claimed = new Set<string>();
  for (const entry of deferredSettings) {
    const key = semanticName(entry.old, entry.name, 'input');
    const candidates = migrated.flatMap((targetNode) =>
      Object.entries(targetNode.data.params).flatMap(([targetName, targetField]) => {
        if (
          claimed.has(`${targetNode.id}:${targetName}`) ||
          Object.prototype.hasOwnProperty.call(
            operationAuthoring(targetNode)!.operation.binding?.values ?? {},
            targetName,
          ) ||
          !publicSetting(targetField) ||
          targetField.display === 'output' ||
          !connectionTypesAreCompatible(entry.field.type, targetField.type) ||
          !acceptsValue(targetField, entry.field.value) ||
          !transferableSetting(entry.old, entry.name, targetNode, targetName)
        )
          return [];
        const targetKey = semanticName(targetNode, targetName, 'input');
        const score = entry.name === targetName ? 3 : key && key === targetKey ? 2 : 0;
        return score ? [{ node: targetNode, name: targetName, field: targetField, score }] : [];
      }),
    );
    const bestScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
    const best = candidates.filter((candidate) => candidate.score === bestScore);
    if (best.length === 1) {
      const target = best[0]!;
      target.node.data.params[target.name] = {
        ...target.field,
        value: structuredClone(entry.field.value),
        ...(entry.field.artifacts ? { artifacts: entry.field.artifacts } : {}),
      };
      const targetHint = operationAuthoring(target.node)!;
      targetHint.authored = [...new Set([...(targetHint.authored ?? []), target.name])];
      claimed.add(`${target.node.id}:${target.name}`);
      addPreserved(
        `${entry.old.data.label} · ${fieldLabel(entry.old, entry.name)} → ${target.node.data.label} · ${fieldLabel(target.node, target.name)}: ${reviewValue(entry.field.value)}`,
      );
      continue;
    }
    const replacement = migrated.find(
      (node) => operationAuthoring(node)!.operation.operationId === entry.previous.operation.operationId,
    );
    if (replacement) {
      const hint = operationAuthoring(replacement)!;
      const reason = `${entry.old.data.label} · ${fieldLabel(entry.old, entry.name)} has no unambiguous equivalent in the selected model; its previous value (${reviewValue(entry.field.value)}) remains available in Implementation.`;
      hint.retained.push({
        field: entry.name,
        value: entry.field.value,
        pipeline: entry.previous.operation.pipelineClass,
        reason,
      });
      diagnostics.push(reason);
    }
  }
  if (replaceUnmatched) {
    const oldLabels = scope.filter((node) => obsolete.has(node.id)).map((node) => node.data.label);
    const newLabels = newOperations.map((node) => node.data.label);
    reviewChanges.push(
      topologyChanged
        ? `Replace ${oldLabels.join(', ') || decompositionLabel(scope)} with ${newLabels.join(', ') || decompositionLabel(migrated)} because this model uses ${decompositionLabel(migrated)}.`
        : newLabels.length
          ? `Replace ${oldLabels.join(', ')} with ${newLabels.join(', ')} because the selected model uses different editable stages.`
          : `Remove ${oldLabels.join(', ')} because the selected model does not use ${oldLabels.length === 1 ? 'that stage' : 'those stages'}.`,
    );
    const owner = migrated.find((node) => operationOwnsModel(operationAuthoring(node)?.operation));
    for (const old of scope.filter((node) => obsolete.has(node.id))) {
      const previous = operationAuthoring(old)!;
      for (const [name, field] of Object.entries(old.data.params)) {
        if (!publicSetting(field) || field.value === undefined) continue;
        const overridden = isAuthored(old, name, field);
        if (!overridden) continue;
        const key = semanticName(old, name, 'input');
        const candidates = migrated.flatMap((targetNode) =>
          Object.entries(targetNode.data.params).flatMap(([targetName, targetField]) => {
            if (
              claimed.has(`${targetNode.id}:${targetName}`) ||
              Object.prototype.hasOwnProperty.call(
                operationAuthoring(targetNode)!.operation.binding?.values ?? {},
                targetName,
              ) ||
              !publicSetting(targetField) ||
              targetField.display === 'output' ||
              !connectionTypesAreCompatible(field.type, targetField.type) ||
              !acceptsValue(targetField, field.value) ||
              !transferableSetting(old, name, targetNode, targetName)
            )
              return [];
            const targetKey = semanticName(targetNode, targetName, 'input');
            const score = name === targetName ? 3 : key && key === targetKey ? 2 : 0;
            return score ? [{ node: targetNode, name: targetName, field: targetField, score }] : [];
          }),
        );
        const bestScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
        const best = candidates.filter((candidate) => candidate.score === bestScore);
        if (best.length === 1) {
          const target = best[0]!;
          target.node.data.params[target.name] = {
            ...target.field,
            value: structuredClone(field.value),
            ...(field.artifacts ? { artifacts: field.artifacts } : {}),
          };
          const targetHint = operationAuthoring(target.node)!;
          targetHint.authored = [...new Set([...(targetHint.authored ?? []), target.name])];
          claimed.add(`${target.node.id}:${target.name}`);
          addPreserved(
            `${old.data.label} · ${fieldLabel(old, name)} → ${target.node.data.label} · ${fieldLabel(target.node, target.name)}: ${reviewValue(field.value)}`,
          );
          continue;
        }
        if (owner) {
          const hint = operationAuthoring(owner)!;
          const reason = `${old.data.label} · ${fieldLabel(old, name)} has no equivalent setting in ${owner.data.label}'s new implementation; its previous value (${reviewValue(field.value)}) remains available in Implementation.`;
          hint.retained.push({
            field: `${previous.operation.operationId}.${name}`,
            value: field.value,
            pipeline: previous.operation.pipelineClass,
            reason,
          });
          diagnostics.push(reason);
        }
      }
    }
  }
  // Within one implementation shape, unmatched stages remain visible and
  // disabled. Across editable/whole-pipeline implementations they are replaced;
  // keeping a disconnected duplicate graph would be misleading and unrunnable.
  const nodes = graph.nodes.flatMap((n) => {
    if (replacements.has(n.id)) return replacements.get(n.id)!;
    if (!obsolete.has(n.id)) return n;
    if (replaceUnmatched) return [];
    diagnostics.push(
      `${n.data.label}: kept disabled because the new task has no matching operation. Reconnect it deliberately or remove it.`,
    );
    return { ...n, data: { ...n.data, uiState: { ...n.data.uiState, disabled: true } } };
  });
  nodes.push(...migrated.filter((n) => !nodes.some((old) => old.id === n.id)));
  const affected = new Set(scope.map((n) => n.id));
  const edges: Edge[] = [];
  let rebuiltManagedConnections = 0;
  const proposedDraftEdges = draft.edges.map((edge) => ({
    ...edge,
    source: idMap.get(edge.source) ?? edge.source,
    target: idMap.get(edge.target) ?? edge.target,
  }));
  const targetTaken = new Set(proposedDraftEdges.map((edge) => `${edge.target}:${edge.targetHandle}`));
  const replacementInput = (oldNode: CustomNodeType, oldField: string, edge: Edge) => {
    const key = semanticName(oldNode, oldField, 'input');
    const candidates = migrated.flatMap((candidate) =>
      Object.entries(candidate.data.params).flatMap(([name, field]) => {
        if (
          field.hidden ||
          field.display === 'output' ||
          targetTaken.has(`${candidate.id}:${name}`) ||
          !connectionTypesAreCompatible(oldNode.data.params[oldField]?.type, field.type)
        )
          return [];
        const match = oldField === name ? 3 : key && key === semanticName(candidate, name, 'input') ? 2 : 0;
        if (!match) return [];
        // Prefer a declared socket over converting an inline fallback widget.
        // Encode Prompt exposes prompt_input for connected text; choosing its
        // same-named prompt widget instead is undone by the live field schema
        // and leaves a dangling wire after a whole-pipeline round trip.
        const score = match + (field.display === 'input' ? 4 : 0);
        const proposed = { ...edge, target: candidate.id, targetHandle: name };
        const check = {
          ...candidate,
          data: { ...candidate.data, params: { ...candidate.data.params, [name]: { ...field, isInput: true } } },
        };
        return compatibleEdge(
          proposed,
          nodes.map((node) => (node.id === candidate.id ? check : node)),
        )
          ? [{ proposed, candidate, name, score }]
          : [];
      }),
    );
    const bestScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
    const best = candidates.filter((candidate) => candidate.score === bestScore);
    return best.length === 1 ? best[0]! : null;
  };
  const replacementOutput = (oldNode: CustomNodeType, oldField: string, edge: Edge) => {
    const key = semanticName(oldNode, oldField, 'output');
    const candidates = migrated.flatMap((candidate) =>
      Object.entries(candidate.data.params).flatMap(([name, field]) => {
        if (
          field.hidden ||
          field.display !== 'output' ||
          !connectionTypesAreCompatible(
            field.type,
            nodes.find((node) => node.id === edge.target)?.data.params[edge.targetHandle ?? '']?.type,
          )
        )
          return [];
        const score = oldField === name ? 3 : key && key === semanticName(candidate, name, 'output') ? 2 : 0;
        if (!score) return [];
        const proposed = { ...edge, source: candidate.id, sourceHandle: name };
        return compatibleEdge(proposed, nodes) ? [{ proposed, candidate, name, score }] : [];
      }),
    );
    const bestScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
    const best = candidates.filter((candidate) => candidate.score === bestScore);
    return best.length === 1 ? best[0]! : null;
  };
  for (const edge of graph.edges) {
    if (!affected.has(edge.source) && !affected.has(edge.target)) {
      edges.push(edge);
      continue;
    }
    if (replaceUnmatched && (obsolete.has(edge.source) || obsolete.has(edge.target))) {
      const source = graph.nodes.find((node) => node.id === edge.source);
      const target = graph.nodes.find((node) => node.id === edge.target);
      // Canonical connections inside the replaced implementation are supplied
      // by the selected starter. Only authored branches cross this boundary.
      if (affected.has(edge.source) && affected.has(edge.target)) continue;
      if (obsolete.has(edge.target) && source && target) {
        const replacement = replacementInput(target, edge.targetHandle ?? '', edge);
        if (replacement) {
          replacement.candidate.data.params[replacement.name] = {
            ...replacement.candidate.data.params[replacement.name],
            isInput: true,
          };
          edges.push(replacement.proposed);
          targetTaken.add(`${replacement.proposed.target}:${replacement.proposed.targetHandle}`);
          addPreserved(
            `${endpointLabel(source, edge.sourceHandle)} → ${endpointLabel(replacement.candidate, replacement.name)} connection`,
          );
          continue;
        }
      } else if (obsolete.has(edge.source) && source && target) {
        const replacement = replacementOutput(source, edge.sourceHandle ?? '', edge);
        if (replacement) {
          edges.push(replacement.proposed);
          addPreserved(
            `${endpointLabel(replacement.candidate, replacement.name)} → ${endpointLabel(target, edge.targetHandle)} connection`,
          );
          continue;
        }
      }
      diagnostics.push(
        `${endpointLabel(source, edge.sourceHandle)} → ${endpointLabel(target, edge.targetHandle)} cannot be reconnected because the selected implementation has no single compatible port.`,
      );
      continue;
    }
    const adapted = {
      ...edge,
      source: changedIds.get(edge.source) ?? edge.source,
      target: changedIds.get(edge.target) ?? edge.target,
    };
    if (!obsolete.has(edge.source) && !obsolete.has(edge.target) && compatibleEdge(adapted, nodes)) edges.push(adapted);
    else if (
      proposedDraftEdges.some(
        (candidate) =>
          candidate.source === adapted.source &&
          candidate.sourceHandle === adapted.sourceHandle &&
          candidate.target === adapted.target &&
          candidate.targetHandle === adapted.targetHandle,
      )
    )
      edges.push(adapted);
    else {
      const source = graph.nodes.find((node) => node.id === edge.source);
      const target = graph.nodes.find((node) => node.id === edge.target);
      const sourceOperation = source && operationAuthoring(source)?.operation.operationId;
      const targetOperation = target && operationAuthoring(target)?.operation.operationId;
      const baselineEdge =
        affected.has(edge.source) &&
        affected.has(edge.target) &&
        options.baseline?.edges.some(
          (candidate) =>
            candidate.source === sourceOperation &&
            candidate.sourceHandle === edge.sourceHandle &&
            candidate.target === targetOperation &&
            candidate.targetHandle === edge.targetHandle,
        );
      if (baselineEdge) {
        rebuiltManagedConnections += 1;
        continue;
      }
      diagnostics.push(
        `${endpointLabel(source, edge.sourceHandle)} → ${endpointLabel(target, edge.targetHandle)} will be disconnected because the selected model does not expose a compatible destination. Both nodes are kept.`,
      );
    }
  }
  for (const proposed of proposedDraftEdges) {
    if (!edges.some((e) => e.target === proposed.target && e.targetHandle === proposed.targetHandle))
      edges.push(proposed);
  }
  // Restore inactive custom crossing connections only when their endpoints
  // still exist, remain compatible, and the user has not since wired the input.
  for (const edge of returning?.edges ?? []) {
    if (
      !edges.some((current) => current.target === edge.target && current.targetHandle === edge.targetHandle) &&
      !edges.some((current) => current.id === edge.id) &&
      compatibleEdge(edge, nodes)
    )
      edges.push(structuredClone(edge));
  }
  if (rebuiltManagedConnections)
    reviewChanges.push(
      `Rebuild ${rebuiltManagedConnections} model-owned connection${rebuiltManagedConnections === 1 ? '' : 's'} for the selected model; no user-created nodes are removed.`,
    );
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
          overridden: isAuthored(old, m.field, field),
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
      `Share ${group.name} across ${members.map((m) => m.node.data.label).join(' and ')}; preserve its authored value${group.name === 'seed' ? ' and use one random draw per run' : ''}.`,
    );
  }
  if (!reviewChanges.length && operationAuthoring(root)!.operation.pipelineClass !== starter.pipelineClass)
    reviewChanges.push(
      'Update the connected nodes for the selected model while keeping their layout and compatible ports.',
    );
  const owner = migrated.find((node) => operationOwnsModel(operationAuthoring(node)?.operation));
  if (owner && routeKey(root) !== routeKey(owner)) {
    const snapshotNodes = structuredClone(scope);
    for (const node of snapshotNodes) delete node.data.operationAuthoring!.inactiveDrafts;
    const snapshot = {
      routeKey: routeKey(root),
      nodes: snapshotNodes,
      edges: structuredClone(graph.edges.filter((edge) => affected.has(edge.source) || affected.has(edge.target))),
    };
    const drafts = [...archived.filter((entry) => entry.routeKey !== snapshot.routeKey), snapshot];
    if (drafts.length > 16 || snapshot.nodes.length > 64 || snapshot.edges.length > 512)
      throw new Error('Too many inactive model drafts. Export this workflow before starting a separate model study.');
    owner.data.operationAuthoring!.inactiveDrafts = drafts;
    if (returning) addPreserved('Restored compatible values, stages and connections from this model’s inactive draft.');
    if (obsolete.size)
      addPreserved(
        'Replaced stages and their connections are retained in a model-scoped inactive draft; selecting that exact model restores compatible content.',
      );
  } else if (owner && archived.length) {
    owner.data.operationAuthoring!.inactiveDrafts = structuredClone(archived);
  }
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length)
    throw new Error(
      'An inactive stage identity is now used by another node. Nothing changed; restore it in a separate workflow.',
    );
  return {
    graph: { nodes, edges },
    changes,
    diagnostics,
    review: {
      changes: reviewChanges,
      preserved,
      attention: diagnostics,
      required: pipelineChanged || replaceUnmatched || diagnostics.length > 0,
    },
    replacements: Object.fromEntries(changedIds),
  };
}
