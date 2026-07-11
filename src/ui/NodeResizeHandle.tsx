import { NodeResizeControl } from '@xyflow/react';

export function NodeResizeHandle() {
  return (
    <NodeResizeControl style={{ background: 'transparent', border: 'none' }}>
      <div className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize" />
    </NodeResizeControl>
  );
}
