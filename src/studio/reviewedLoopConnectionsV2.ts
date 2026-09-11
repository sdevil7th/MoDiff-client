import type { Edge } from '@xyflow/react';
import type { FlowGraphNode } from '../stores/flowGraphExport';

type IterationBinding = { kind: 'state'; sourcePath: string[]; output: string; timing: 'current' | 'previous' };

function memberPath(node: FlowGraphNode | undefined): string[] | null {
  const params = node?.data.params;
  const path = params?.placement_path?.value;
  return node?.data.module === 'modules.ModularDiffusers' &&
    node.data.action === 'ReviewedModularWorkflowStep' &&
    params?.execution_kind?.value === 'loop_member' &&
    Array.isArray(path) &&
    path.every((part) => typeof part === 'string')
    ? (path as string[])
    : null;
}

/** Iteration edges describe bindings inside an upstream loop, not outer DAG dependencies. */
export function lowerReviewedLoopConnectionsV2(nodes: FlowGraphNode[], edges: Edge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const loopOwner = (start: string): string | null => {
    const visited = new Set<string>();
    let id = start;
    while (!visited.has(id)) {
      visited.add(id);
      const node = byId.get(id);
      if (node?.data.params?.execution_kind?.value === 'loop_owner') return id;
      const next = edges.filter((edge) => edge.source === id && edge.sourceHandle === 'loop_members');
      if (next.length !== 1 || next[0]!.targetHandle !== 'loop_members_in') return null;
      id = next[0]!.target;
    }
    return null;
  };
  const bindings = new Map<string, Record<string, IterationBinding>>();
  const ordinaryEdges = edges.filter((edge) => {
    const handle = edge.sourceHandle ?? '';
    const prefix = handle.startsWith('iteration_output__')
      ? 'iteration_output__'
      : handle.startsWith('iteration_previous__')
        ? 'iteration_previous__'
        : null;
    if (!prefix) return true;
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const sourcePath = memberPath(source);
    const targetPath = memberPath(target);
    const label = `Iteration connection ${edge.id}`;
    if (!sourcePath || !targetPath || !edge.targetHandle?.startsWith('iteration_input__'))
      throw new Error(`${label}: connect iteration outputs only to a Modular loop member's iteration input.`);
    if (
      source!.data.blockProjectionOwnerId !== target!.data.blockProjectionOwnerId ||
      JSON.stringify(sourcePath.slice(0, -1)) !== JSON.stringify(targetPath.slice(0, -1)) ||
      source!.data.params.pipeline_class?.value !== target!.data.params.pipeline_class?.value ||
      source!.data.params.workflow_id?.value !== target!.data.params.workflow_id?.value
    )
      throw new Error(`${label}: producer and consumer must belong to the same loop instance.`);
    const owner = loopOwner(edge.source);
    if (!owner || owner !== loopOwner(edge.target))
      throw new Error(`${label}: connect both members to the same loop instance through one Loop Members chain.`);
    const field = edge.targetHandle.slice('iteration_input__'.length);
    const current = bindings.get(edge.target) ?? {};
    if (current[field]) throw new Error(`${label}: input ${field} has multiple iteration producers.`);
    current[field] = {
      kind: 'state',
      sourcePath: [...sourcePath],
      output: handle.slice(prefix.length),
      timing: prefix === 'iteration_previous__' ? 'previous' : 'current',
    };
    bindings.set(edge.target, current);
    return false;
  });
  if (!bindings.size) return { nodes, edges };
  return {
    nodes: nodes.map((node) => {
      const bound = bindings.get(node.id);
      if (!bound) return node;
      const params = structuredClone(node.data.params);
      for (const field of Object.keys(bound)) {
        const input = params[`iteration_input__${field}`];
        if (input?.value !== undefined && input.value !== null)
          throw new Error(
            `Loop member ${node.data.label ?? node.id}, input ${field}: disconnect the iteration wire or clear its competing constant.`,
          );
        delete params[`iteration_input__${field}`];
      }
      params.iteration_bindings = { type: 'object', hidden: true, value: bound };
      return { ...node, data: { ...node.data, params } };
    }),
    edges: ordinaryEdges,
  };
}
