import type { Edge } from '@xyflow/react';
import type { FlowGraphNode } from '../stores/flowGraphExport';
import { deepEqual } from '../utils/deepEqual';

/** A shared editing relationship between ordinary nodes, scoped to one loader.
 * It grants no runtime authority. Detached/cloned/legacy nodes keep their values. */
export function sharedOperationInput(nodes: FlowGraphNode[], edges: Edge[], nodeId: string, field: string) {
  const node = nodes.find((n) => n.id === nodeId);
  const hint = node?.data.operationAuthoring;
  if (
    !node ||
    node.parentId ||
    node.data.blockProjectionOwnerId ||
    node.data.blockInstanceV2 ||
    !Array.isArray(hint?.sharedInputs) ||
    hint.sharedInputs.length > 32
  )
    return null;
  const binding = hint.sharedInputs.find((b) => b?.field === field);
  if (
    !binding ||
    typeof binding.loaderId !== 'string' ||
    typeof binding.groupId !== 'string' ||
    binding.groupId.length > 8192
  )
    return null;
  const root = nodes.find((n) => n.id === binding.loaderId);
  const rootOperation = root?.data.operationAuthoring?.operation;
  if (
    !root ||
    root.parentId ||
    root.data.blockInstanceV2 ||
    rootOperation?.decomposition !== 'loader' ||
    !rootOperation.binding ||
    !rootOperation.binding.values ||
    typeof rootOperation.binding.values !== 'object' ||
    Array.isArray(rootOperation.binding.values) ||
    Object.entries(rootOperation.binding.values).some(
      ([key, value]) => !deepEqual(root.data.params[key]?.value ?? root.data.params[key]?.default, value),
    )
  )
    return null;
  const candidates = nodes.filter((n) => {
    const op = n.data.operationAuthoring?.operation;
    return (
      !n.parentId &&
      !n.data.blockProjectionOwnerId &&
      !n.data.blockInstanceV2 &&
      op &&
      Array.isArray(op.ports) &&
      op.nodeKey === `${n.data.module}.${n.data.action}` &&
      op.pipelineClass === rootOperation.pipelineClass &&
      op.task === rootOperation.task &&
      (op.decomposition !== 'loader' || n.id === root.id)
    );
  });
  const ids = new Set(candidates.map((n) => n.id)),
    reached = new Set([root.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges)
      if (ids.has(e.source) && ids.has(e.target) && (reached.has(e.source) || reached.has(e.target))) {
        if (!reached.has(e.source) || !reached.has(e.target)) changed = true;
        reached.add(e.source);
        reached.add(e.target);
      }
  }
  if (!reached.has(node.id)) return null;
  const members = candidates.flatMap((n) => {
    if (!reached.has(n.id)) return [];
    const bindings = n.data.operationAuthoring?.sharedInputs;
    return Array.isArray(bindings) && bindings.length <= 32
      ? bindings
          .filter(
            (b) =>
              b?.loaderId === root.id &&
              b.groupId === binding.groupId &&
              n.data.params[b.field] &&
              n.data.operationAuthoring!.operation.ports.some(
                (p) =>
                  p?.direction === 'input' &&
                  p.name === b.field &&
                  p.semanticName === binding.name &&
                  p.semantics?.kind === 'value',
              ),
          )
          .map((b) => ({ node: n, field: b.field }))
      : [];
  });
  const declaredMembers = members
    .map((m) => `${m.node.data.operationAuthoring!.operation.operationId}.${m.field}`)
    .sort()
    .join('|');
  if (members.length < 2 || declaredMembers !== binding.groupId) return null;
  return { key: `operation:${root.id}:${binding.groupId}`, name: binding.name, members };
}

export function assertSharedOperationInput(group: NonNullable<ReturnType<typeof sharedOperationInput>>, edges: Edge[]) {
  const values = group.members.map(({ node, field }) => {
    const value = node.data.params[field]?.value ?? node.data.params[field]?.default;
    return typeof value === 'object' && value !== null && 'value' in value
      ? { value: String(value.value), random: 'isRandom' in value && value.isRandom === true }
      : { value: String(value), random: false };
  });
  const drivers = group.members.map((m) => edges.find((e) => e.target === m.node.id && e.targetHandle === m.field));
  const sources = new Set(drivers.map((e) => (e ? `${e.source}:${e.sourceHandle}` : 'literal')));
  if (sources.size !== 1 || (sources.has('literal') && values.some((v) => !deepEqual(v, values[0]))))
    throw new Error(
      `Shared ${group.name} controls disagree. Edit either control to align the values, or connect every member to the same source.`,
    );
}
