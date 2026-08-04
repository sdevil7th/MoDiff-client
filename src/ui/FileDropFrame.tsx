import type { DragEventHandler, MouseEventHandler, ReactNode } from 'react';
import { cx } from '../utils/classNames';

export type FileDropFrameProps = {
  activationLabel?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  gridColumns: number;
  isActive?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
};

export function FileDropFrame({
  activationLabel = 'Choose files',
  children,
  className,
  disabled = false,
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
        'relative mt-2 grid h-full w-full gap-2 overflow-hidden rounded-modiff-compact border border-dashed p-2 text-center transition',
        onClick && !disabled && 'cursor-pointer',
        isActive ? 'border-modiff-focus bg-modiff-green/20' : 'border-modiff-border bg-transparent',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
    >
      {onClick ? (
        <button
          type="button"
          aria-label={activationLabel}
          disabled={disabled}
          onClick={onClick}
          className="absolute inset-0 z-0 rounded-modiff-compact outline-none transition active:bg-modiff-surface-pressed/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-modiff-focus"
        />
      ) : null}
      <div className="contents [&>*]:pointer-events-none [&>*]:relative [&>*]:z-[1]">{children}</div>
    </div>
  );
}
