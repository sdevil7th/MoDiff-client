import type { CustomNodeType } from '../stores/useFlowStore';
import { expandFlowExecutionGraph, normalizePersistedFlowState } from '../stores/useFlowStore';
import type { LayoutReferenceSummary } from './layoutConditioning';
import type { Edge } from '@xyflow/react';
import { blockProjectionNodeIdV2 } from './blockRuntimeV2';
import { stableStringify } from './stableHash';

/** Resolve a declared layout control through the same flat projection as Run.
 * The key is display freshness only; it cannot mint backend conditioning.
 */
export function layoutReferenceContext(nodes: CustomNodeType[], edges: Edge[], nodeId: string, fieldKey: string) {
  try {
    const owner = nodes.find((node) => node.id === nodeId);
    let target = nodeId;
    let field = fieldKey;
    const instance = owner?.data.blockInstanceV2;
    if (owner && instance) {
      const controls = instance.effectiveInterface.controls.filter((control) => control.controlId === fieldKey);
      if (controls.length !== 1 || controls[0]!.mirrorBindings?.length) return null;
      const binding = controls[0]!.binding;
      target = blockProjectionNodeIdV2(owner.id, binding.nodeId);
      field = binding.fieldId;
    } else if (owner?.data.blockProjectionOwnerId) {
      const root = nodes.find((node) => node.id === owner.data.blockProjectionOwnerId);
      if (!root?.data.blockInstanceV2 || !owner.data.blockProjectionNodeId) return null;
      target = blockProjectionNodeIdV2(root.id, owner.data.blockProjectionNodeId);
    }
    // Canonical snapshots omit rendered children. Resolve their declared leaves
    // through the same expansion as Run, never presentation-only slash aliases.
    const graph = expandFlowExecutionGraph(nodes, edges);
    const leaf = graph.nodes.find((node) => node.id === target);
    if (
      leaf?.data.params[field]?.type !== 'layout_conditioning' ||
      leaf.data.params[field]?.display !== 'layout' ||
      leaf.data.params.reference_binding?.type !== 'reference_conditioning'
    )
      return null;
    const incoming = graph.edges.filter((edge) => edge.target === target && edge.targetHandle === 'reference_binding');
    if (incoming.length !== 1 || incoming[0]!.sourceHandle !== 'reference_binding') return null;
    const supplier = graph.nodes.find((node) => node.id === incoming[0]!.source);
    if (
      supplier?.data.params.reference_binding?.type !== 'reference_conditioning' ||
      supplier.data.params.reference_binding.display !== 'output' ||
      supplier.data.params.layout_reference_summary?.type !== 'string' ||
      supplier.data.params.layout_reference_summary.display !== 'output'
    )
      return null;
    const selected = new Set<string>();
    const pending = [incoming[0]!.source];
    while (pending.length) {
      const id = pending.pop()!;
      if (id === target || selected.size >= 256) return null;
      if (selected.has(id)) continue;
      if (!graph.nodes.some((node) => node.id === id)) return null;
      selected.add(id);
      pending.push(...graph.edges.filter((edge) => edge.target === id).map((edge) => edge.source));
    }
    const ancestors = graph.nodes
      .filter((node) => selected.has(node.id))
      .map((node) => ({
        id: node.id,
        module: node.data.module,
        action: node.data.action,
        params: Object.fromEntries(
          Object.entries(node.data.params)
            .filter(([, param]) => param.display !== 'output' && !param.display?.startsWith('ui_'))
            .map(([key, param]) => [
              key,
              {
                value: param.value,
                default: param.default,
                type: param.type,
                // Persisted task snapshots discard runtime signal payloads.
                // Keep declaration changes meaningful without comparing that volatile authority.
                signal: param.signal ? { ...param.signal, value: undefined } : undefined,
              },
            ]),
        ),
      }));
    const links = graph.edges
      .filter((edge) => selected.has(edge.target) || edge === incoming[0])
      .map((edge) => [edge.source, edge.sourceHandle, edge.target, edge.targetHandle]);
    const key = stableStringify({ target, ancestors, links });
    return key.length <= 262144 ? { nodeId: target, summaryNodeId: supplier.id, key } : null;
  } catch {
    return null;
  }
}

/** Join the cache summary to the ordinary persisted task snapshot. */
export function validateLayoutReferenceRun(
  value: unknown,
  summary: LayoutReferenceSummary,
  current: { key: string },
  nodeId: string,
  fieldKey: string,
  workflowId: string | null,
) {
  const record = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (
    !summary.taskId ||
    !summary.runInputHash ||
    !record(value) ||
    !record(value.task) ||
    value.task.task_id !== summary.taskId ||
    value.task.attempt_index !== summary.attemptIndex ||
    value.task.run_input_hash !== summary.runInputHash ||
    value.workflow_id !== workflowId ||
    !record(value.workflow_snapshot) ||
    !Array.isArray(value.workflow_snapshot.nodes) ||
    !Array.isArray(value.workflow_snapshot.edges) ||
    value.workflow_snapshot.nodes.length > 4096 ||
    value.workflow_snapshot.edges.length > 16384 ||
    JSON.stringify(value.workflow_snapshot).length > 16 * 1024 * 1024
  )
    throw new Error(
      'Reference cache needs its actual task and workflow snapshot. Encode references in this workflow again.',
    );
  const saved = normalizePersistedFlowState(value.workflow_snapshot);
  if (layoutReferenceContext(saved.nodes, saved.edges, nodeId, fieldKey)?.key !== current.key)
    throw new Error(
      'The source graph changed since encoding. Encode again before explicitly rebinding source regions.',
    );
}
