import { blockProjectionNodeIdV2 } from './blockRuntimeV2';
import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import type { RunReadinessIssue } from './types';
import { runtimeProgressTarget } from './userBlocks';
import { connectionTypesAreCompatible } from '../theme/connectionTypes';

/** Inspect current declarations on the same lowered graph used by Run. */
export function inspectRequiredGraphInputs(
  visible: CustomNodeType[],
  graph: { nodes: CustomNodeType[]; edges: Edge[] },
  registry: Record<string, NodeData>,
): RunReadinessIssue[] {
  const enabled = new Map(graph.nodes.filter((node) => !node.data.uiState?.disabled).map((node) => [node.id, node]));
  const issues: RunReadinessIssue[] = [];
  const owners = new Map(
    visible.flatMap(
      (root) =>
        root.data.blockInstanceV2?.effectiveGraph.nodes.map(
          (node) => [blockProjectionNodeIdV2(root.id, node.nodeId), root.id] as const,
        ) ?? [],
    ),
  );
  for (const node of enabled.values()) {
    const declared = registry[`${node.data.module}.${node.data.action}`]?.params;
    for (const field of new Set([...Object.keys(declared ?? {}), ...Object.keys(node.data.params)])) {
      const saved = node.data.params[field] ?? declared![field]!;
      const param = declared?.[field] ?? saved;
      if (
        !param.required ||
        param.disabled ||
        param.display === 'output' ||
        !(param.isInput || param.display === 'input')
      )
        continue;
      const value = saved.value ?? saved.default ?? param.default;
      if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length)) continue;
      const supplied = graph.edges.some((edge) => {
        if (edge.target !== node.id || edge.targetHandle !== field) return false;
        const source = enabled.get(edge.source)?.data.params[edge.sourceHandle ?? ''];
        return source?.display === 'output' && connectionTypesAreCompatible(source.type, saved.type);
      });
      if (supplied) continue;
      const target = visible.some((item) => item.id === node.id && !item.hidden)
        ? node.id
        : (owners.get(node.id) ?? runtimeProgressTarget(visible, node.id) ?? node.id);
      issues.push({
        id: `required-input:${node.id}:${field}`,
        code: 'required_graph_input_missing',
        category: 'graph',
        severity: 'error',
        blocking: true,
        action: 'inspect_node',
        nodeId: target,
        ...(target === node.id ? { fieldId: field } : {}),
        message: `${node.data.label || node.data.action} needs ${saved.label || field} before running.`,
        details: `Connect an enabled compatible source to ${field}, or provide its declared value. Expand the Block to inspect the affected node.`,
      });
    }
  }
  return issues;
}
