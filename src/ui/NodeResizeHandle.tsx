import { NodeResizeControl } from '@xyflow/react';
import type { MouseEventHandler } from 'react';

import { cx } from '../utils/classNames';

type NodeResizeGripProps = {
  className?: string;
  label?: string;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
};

export function NodeResizeGrip({ className, label = 'Drag to resize node', onMouseDown }: NodeResizeGripProps) {
  return (
    <div
      className={cx(
        'group nodrag absolute bottom-0 right-0 z-[9999] grid h-7 w-7 cursor-se-resize place-items-end rounded-tl-modiff-compact bg-modiff-bg/90 p-1 text-modiff-subtle-text shadow-[-1px_-1px_0_var(--color-modiff-border-subtle)] transition-colors hover:bg-modiff-surface-hover hover:text-hf-yellow',
        className,
      )}
      aria-label={label}
      data-testid="node-resize-grip"
      title={label}
      onMouseDown={onMouseDown}
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none h-[18px] w-[18px] overflow-visible"
        data-testid="node-resize-grip-icon"
        viewBox="0 0 18 18"
      >
        <path
          d="M4 16 16 4M9 16l7-7M14 16l2-2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

export function NodeResizeHandle() {
  return (
    <NodeResizeControl style={{ background: 'transparent', border: 'none' }}>
      <NodeResizeGrip />
    </NodeResizeControl>
  );
}
