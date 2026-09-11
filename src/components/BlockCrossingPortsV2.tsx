import { useLayoutEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUpdateNodeInternals } from '@xyflow/react';
import { useFlowStore } from '../stores/useFlowStore';
import { blockCrossingSurfaceV2 } from '../studio/blockCrossingConnectionsV2';
import NodeContent from './NodeContent';

/** Connected-only view sockets; never written to a Block's reusable interface. */
export default function BlockCrossingPortsV2({ nodeId }: { nodeId: string }) {
  const { nodes, edges } = useFlowStore(useShallow((state) => ({ nodes: state.nodes, edges: state.edges })));
  const params = useMemo(() => {
    const local = nodes.find((node) => node.id === nodeId)?.data.params ?? {};
    const connected = Object.fromEntries(
      Object.entries(local).filter(([, param]) => param.fieldOptions?.blockConnectedCrossingV2),
    );
    Object.assign(connected, blockCrossingSurfaceV2(nodes, edges).paramsByNodeId.get(nodeId));
    return Object.keys(connected).length ? connected : undefined;
  }, [nodes, edges, nodeId]);
  const updateNodeInternals = useUpdateNodeInternals();
  const socketLayout = JSON.stringify(Object.entries(params ?? {}).map(([id, param]) => [id, param.label]));
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => updateNodeInternals(nodeId));
    return () => cancelAnimationFrame(frame);
  }, [nodeId, socketLayout, updateNodeInternals]);
  if (!params) return null;
  return (
    <div className="border-t border-modiff-border" data-testid={`block-crossing-ports-${nodeId}`}>
      <p className="px-2 pt-1 text-xs text-modiff-subtle-text">Connected internal ports</p>
      <NodeContent
        nodeId={nodeId}
        params={params}
        updateStore={() => {}}
        module="MoDiff"
        action="BlockCrossingPorts"
        mode="connectors"
      />
    </div>
  );
}
