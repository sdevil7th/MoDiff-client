import type { DragEventHandler, MouseEventHandler, ReactNode } from 'react';
import { cx } from '../utils/classNames';

export type FileDropFrameProps = {
  children: ReactNode;
  className?: string;
  gridColumns: number;
  isActive?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
};

export function FileDropFrame({
  children,
  className,
  gridColumns,
  isActive = false,
  onClick,
  onDragLeave,
  onDragOver,
  onDrop,
}: FileDropFrameProps) {
  return (
    <div
      className={cx(
        'mt-2 grid h-full w-full cursor-pointer gap-2 overflow-hidden border border-dashed p-2 text-center transition',
        isActive ? 'border-gray-300 bg-modiff-green/20' : 'border-modiff-border bg-transparent',
        className,
      )}
      onClick={onClick}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}
