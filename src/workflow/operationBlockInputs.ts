import type { Edge } from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import {
  blockConnectionTargetsV2,
  blockCrossingHandleV2,
  blockCrossingParamV2,
} from '../studio/blockCrossingConnectionsV2';
import { blockOperationGraphV2 } from '../studio/blockRuntimeV2';
import type { OperationGraph } from './operationAuthoring';

/** Read-only outside sources let the ordinary planner see occupied inputs and
 * shared drivers. These temporary nodes never enter the saved/executable graph. */
export function blockOperationInputs(
  canvas: OperationGraph,
  root: CustomNodeType,
  internal: OperationGraph,
  scope: ReadonlySet<string>,
) {
  const proxies = new Map<string, { node: CustomNodeType; handle: string; wire: Edge }>();
  const originals = new Map<string, Edge>();
  const bridges: Edge[] = [];
  const connectedFields = new Map<string, Set<string>>();
  for (const wire of canvas.edges.filter((edge) => edge.target === root.id)) {
    const targets = blockConnectionTargetsV2(root, wire.targetHandle ?? '', 'input').filter((target) =>
      scope.has(target.nodeId),
    );
    if (!targets.length) continue;
    const source = canvas.nodes.find((node) => node.id === wire.source);
    if (!source || !wire.sourceHandle || source.id === root.id)
      throw new Error('An outside input has no valid source. Review its connection before changing the task.');
    const instance = source.data.blockInstanceV2;
    const binding = instance ? blockConnectionTargetsV2(source, wire.sourceHandle, 'output')[0] : null;
    const leaf =
      instance && binding
        ? blockOperationGraphV2(instance).nodes.find((node) => node.data.blockProjectionNodeId === binding.nodeId)
        : source;
    const handle = binding?.fieldOrPortId ?? wire.sourceHandle;
    const param =
      instance && binding
        ? blockCrossingParamV2(instance, { ...binding, direction: 'output' })
        : leaf?.data.params[handle];
    if (!leaf || !param || param.display !== 'output')
      throw new Error(
        'An outside input source has no compatible output. Review its connection before changing the task.',
      );
    const key = JSON.stringify([source.id, binding?.nodeId ?? null, handle]);
    let proxy = proxies.get(key);
    if (!proxy) {
      proxy = {
        node: {
          ...leaf,
          id: `boundary-source-${nanoid()}`,
          // Exclude this source from operationScope while retaining its exact
          // semantic port metadata for compatibility/competing-loader checks.
          parentId: root.id,
          position: { x: 0, y: 0 },
          width: 0,
          height: 0,
          measured: { width: 0, height: 0 },
          data: { ...leaf.data, params: { [handle]: { ...param, hidden: false } } },
        },
        handle,
        wire,
      };
      proxies.set(key, proxy);
    }
    for (const target of targets) {
      const fields = connectedFields.get(target.nodeId) ?? new Set<string>();
      fields.add(target.fieldOrPortId);
      connectedFields.set(target.nodeId, fields);
      const id = `boundary-edge-${nanoid()}`;
      originals.set(id, wire);
      bridges.push({
        id,
        source: proxy.node.id,
        sourceHandle: handle,
        target: target.nodeId,
        targetHandle: target.fieldOrPortId,
      });
    }
  }
  const byId = new Map([...proxies.values()].map((proxy) => [proxy.node.id, proxy]));
  return {
    graph: {
      nodes: [
        ...internal.nodes.map((node) => {
          const fields = connectedFields.get(node.id);
          if (!fields) return node;
          return {
            ...node,
            data: {
              ...node.data,
              params: Object.fromEntries(
                Object.entries(node.data.params).map(([name, param]) => [
                  name,
                  fields.has(name) ? { ...param, isInput: true } : param,
                ]),
              ),
            },
          };
        }),
        ...[...proxies.values()].map((proxy) => proxy.node),
      ],
      edges: [...internal.edges, ...bridges],
    },
    restore(planned: OperationGraph, semanticId: (id: string) => string) {
      for (const [id, wire] of originals) {
        if (!planned.edges.some((edge) => edge.id === id))
          throw new Error(
            `The connected input ${wire.targetHandle} changes type or loses its operation. Review that connection before retrying.`,
          );
      }
      const added: Edge[] = [];
      for (const edge of planned.edges) {
        const proxy = byId.get(edge.source);
        if (!proxy || originals.has(edge.id)) continue;
        if (!edge.targetHandle) throw new Error('The shared input has no destination field.');
        added.push({
          ...proxy.wire,
          id: `edge-${nanoid()}`,
          target: root.id,
          targetHandle: blockCrossingHandleV2({
            nodeId: semanticId(edge.target),
            fieldOrPortId: edge.targetHandle,
            direction: 'input',
          }),
        });
      }
      return {
        internal: {
          nodes: planned.nodes.filter((node) => !byId.has(node.id)),
          edges: planned.edges.filter((edge) => !byId.has(edge.source)),
        },
        added,
      };
    },
  };
}
