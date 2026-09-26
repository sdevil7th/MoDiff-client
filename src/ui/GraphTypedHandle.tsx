import { Handle, useConnection, useNodeId, useStore, type HandleProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { cx } from '../utils/classNames';
import { connectionTypes } from '../theme/connectionTypeCompatibility';
import { useFlowStore } from '../stores/useFlowStore';
import { nodeConnectorParam } from '../studio/nodeConnectorResolution';

type GraphTypedHandleProps = HandleProps & {
  connectionColor: string;
  connectionGradient?: string;
};

export function GraphTypedHandle({
  connectionColor,
  connectionGradient,
  style,
  className,
  ...props
}: GraphTypedHandleProps) {
  const nodeId = useNodeId();
  // Select stable origin values, not the moving pointer coordinates.
  const fromNode = useConnection((state) => state.fromNode?.id ?? null);
  const fromHandle = useConnection((state) => state.fromHandle);
  const validate = useStore((state) => state.isValidConnection);
  const candidate =
    fromNode && fromHandle?.id && nodeId && props.id && fromHandle.type !== props.type
      ? fromHandle.type === 'source'
        ? { source: fromNode, sourceHandle: fromHandle.id, target: nodeId, targetHandle: props.id }
        : { source: nodeId, sourceHandle: props.id, target: fromNode, targetHandle: fromHandle.id }
      : null;
  const graph = useFlowStore.getState().nodes;
  const declared = candidate
    ? [
        nodeConnectorParam(
          graph.find((node) => node.id === candidate.source),
          candidate.sourceHandle,
        )?.type,
        nodeConnectorParam(
          graph.find((node) => node.id === candidate.target),
          candidate.targetHandle,
        )?.type,
      ].map(connectionTypes)
    : [];
  const known = declared.length === 2 && declared.every((types) => types.length && !types.includes('any'));
  const matches = candidate && known && fromNode !== nodeId && props.isConnectable !== false && validate?.(candidate);
  return (
    <Handle
      className={cx(className, matches && 'ring-2 ring-hf-yellow ring-offset-2 ring-offset-modiff-bg')}
      data-connection-match={matches ? 'compatible' : undefined}
      style={
        {
          ...style,
          '--modiff-flow-handle-color': connectionColor,
          '--modiff-flow-handle-segments': connectionGradient ?? 'none',
        } as CSSProperties
      }
      {...props}
    />
  );
}
