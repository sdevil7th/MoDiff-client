import { Handle, type HandleProps } from '@xyflow/react';
import type { CSSProperties } from 'react';

type GraphTypedHandleProps = HandleProps & {
  connectionColor: string;
  connectionGradient?: string;
};

export function GraphTypedHandle({ connectionColor, connectionGradient, style, ...props }: GraphTypedHandleProps) {
  return (
    <Handle
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
