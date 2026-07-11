import type { MouseEventHandler, ReactNode } from 'react';
import { modiffOverlays } from '../theme';
import { cx } from '../utils/classNames';

export type NumberFieldFrameProps = {
  children: ReactNode;
  className?: string;
  focused?: boolean;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
  sliderPercent?: number;
};

export function NumberFieldFrame({
  children,
  className,
  focused = false,
  onDoubleClick,
  onMouseDown,
  sliderPercent,
}: NumberFieldFrameProps) {
  const clampedPercent = typeof sliderPercent === 'number' ? Math.max(0, Math.min(100, sliderPercent)) : undefined;
  const background =
    clampedPercent === undefined
      ? undefined
      : `linear-gradient(to right, ${modiffOverlays.softLight} ${clampedPercent}%, ${modiffOverlays.transparentLight} ${clampedPercent}%)`;

  return (
    <div
      className={cx(
        'nodrag flex w-full cursor-default items-center justify-between gap-1 overflow-hidden rounded-modiff-compact bg-modiff-bg px-1 py-1 outline outline-2',
        focused ? 'outline-hf-yellow' : 'outline-transparent',
        className,
      )}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      style={background ? { background } : undefined}
    >
      {children}
    </div>
  );
}
