import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { nodeConnectorParam, nodeConnectorParams } from '../studio/nodeConnectorResolution';
import { blockOperationGraphV2, blockProjectionNodeIdV2 } from '../studio/blockRuntimeV2';
import { blockConnectionTargetsV2 } from '../studio/blockCrossingConnectionsV2';
import { operationOwnsModel } from './operationContracts';
import { nodeDisplayLabel } from './nodePresentation';

const blockViews = new WeakMap<object, ReturnType<typeof blockOperationGraphV2>>();

/** Read-only display context, never an ownership or connection decision. */
function sourceContexts(nodes: CustomNodeType[], edges: Edge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  const add = (source: string, target: string) => incoming.set(target, [...(incoming.get(target) ?? []), source]);
  const endpoints = (id: string, handle: string | null | undefined, direction: 'input' | 'output') => {
    const node = byId.get(id);
    if (!node?.data.blockInstanceV2 || !handle) return [id];
    try {
      return blockConnectionTargetsV2(node, handle, direction).map((binding) =>
        blockProjectionNodeIdV2(node.id, binding.nodeId),
      );
    } catch {
      // Retained broken wires have no display context; attachment validation still owns repair.
      return [];
    }
  };
  for (const node of nodes) {
    if (!node.data.blockInstanceV2) continue;
    const instance = node.data.blockInstanceV2;
    const view = blockViews.get(instance) ?? blockOperationGraphV2(instance);
    blockViews.set(instance, view);
    for (const child of view.nodes) byId.set(child.id, child);
    for (const edge of view.edges) add(edge.source, edge.target);
  }
  for (const edge of edges)
    for (const source of endpoints(edge.source, edge.sourceHandle, 'output'))
      for (const target of endpoints(edge.target, edge.targetHandle, 'input')) add(source, target);
  return (nodeId: string, handle: string) => {
    let next = endpoints(nodeId, handle, 'output');
    const seen = new Set<string>();
    while (next.length) {
      const current = next.filter((id) => !seen.has(id));
      current.forEach((id) => seen.add(id));
      const context = new Set<string>();
      for (const id of current) {
        const node = byId.get(id);
        if (!node) continue;
        for (const key of ['repo_id', 'model_id']) {
          const field = node.data.params[key];
          if (
            !field ||
            field.isConnected ||
            (!operationOwnsModel(node.data.operationAuthoring?.operation) && field.display !== 'modelselect')
          )
            continue;
          const value = field.value ?? field.default;
          if (typeof value === 'string' && value) context.add(value);
          else if (value && typeof value === 'object' && 'source' in value && 'value' in value) {
            if ((value.source === 'hub' || value.source === 'local') && typeof value.value === 'string' && value.value)
              context.add(value.source === 'local' ? `Local: ${value.value}` : value.value);
          }
        }
      }
      if (context.size) return [...context].join(', ');
      next = current.flatMap((id) => incoming.get(id) ?? []);
    }
    return '';
  };
}

export function mediaAttachmentSources(
  nodes: CustomNodeType[],
  edges: Edge[],
  kind: 'image' | 'audio',
  initialSource?: { nodeId: string; handleId: string },
) {
  const context = sourceContexts(nodes, edges);
  const sources = nodes.flatMap((candidate) => {
    const params = { ...nodeConnectorParams(candidate) };
    if (initialSource?.nodeId === candidate.id) {
      const initial = nodeConnectorParam(candidate, initialSource.handleId);
      if (initial) params[initialSource.handleId] = initial;
    }
    return Object.entries(params)
      .filter(
        ([, field]) =>
          field.display === 'output' &&
          !field.hidden &&
          !field.disabled &&
          (Array.isArray(field.type) ? field.type : [field.type]).includes(kind),
      )
      .map(([handle, field]) => {
        const model = context(candidate.id, handle);
        return {
          value: JSON.stringify([candidate.id, handle]),
          label: `${nodeDisplayLabel(candidate.data)} · ${field.label ?? handle}${model ? ` · ${model}` : ''}`,
        };
      });
  });
  const counts = new Map<string, number>();
  for (const source of sources) counts.set(source.label, (counts.get(source.label) ?? 0) + 1);
  const ordinals = new Map<string, number>();
  return sources.map((source) => {
    if (counts.get(source.label) === 1) return source;
    const ordinal = (ordinals.get(source.label) ?? 0) + 1;
    ordinals.set(source.label, ordinal);
    return { ...source, label: `${source.label} · Branch ${ordinal}` };
  });
}
