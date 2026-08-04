import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';

type GraphConnectionSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  connectionColor: string;
};

export const GraphConnectionSurface = forwardRef<HTMLDivElement, GraphConnectionSurfaceProps>(
  function GraphConnectionSurface({ connectionColor, style, ...props }, ref) {
    return (
      <div
        ref={ref}
        style={{ ...style, '--modiff-flow-connection-color': connectionColor } as CSSProperties}
        {...props}
      />
    );
  },
);
