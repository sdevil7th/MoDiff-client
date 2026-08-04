import {
  forwardRef,
  type MouseEventHandler,
  type PointerEventHandler,
  type SyntheticEvent,
  type TouchEventHandler,
} from 'react';
import { cx } from '../utils/classNames';

export type ImageCompareFrameProps = {
  'aria-label'?: string;
  imageFrom: string;
  imageTo: string;
  beforeLabel?: string;
  afterLabel?: string;
  sliderPosition: number;
  onError: (event: SyntheticEvent<HTMLImageElement, Event>) => void;
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseMove: MouseEventHandler<HTMLDivElement>;
  onMouseUp: MouseEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onTouchStart?: TouchEventHandler<HTMLDivElement>;
  onTouchMove?: TouchEventHandler<HTMLDivElement>;
  onTouchEnd?: TouchEventHandler<HTMLDivElement>;
  onSliderPositionChange: (position: number) => void;
  className?: string;
  testId?: string;
};

export const ImageCompareFrame = forwardRef<HTMLDivElement, ImageCompareFrameProps>(function ImageCompareFrame(
  {
    'aria-label': ariaLabel = 'Image comparison position',
    imageFrom,
    imageTo,
    beforeLabel = 'A · Before',
    afterLabel = 'B · After',
    sliderPosition,
    onError,
    onMouseDown,
    onMouseEnter,
    onMouseMove,
    onMouseUp,
    onPointerMove,
    onTouchEnd,
    onTouchMove,
    onTouchStart,
    onSliderPositionChange,
    className,
    testId,
  },
  ref,
) {
  const clamped = Math.max(0, Math.min(100, sliderPosition));

  return (
    <div
      ref={ref}
      data-testid={testId}
      data-position={clamped.toFixed(2)}
      data-left="before"
      data-right="after"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={`${Math.round(clamped)}% before image`}
      className={cx(
        'pointer-events-auto relative h-full w-full cursor-ew-resize select-none overflow-hidden rounded-modiff-compact outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-modiff-focus',
        className,
      )}
      onMouseMove={onMouseMove}
      onMouseEnter={onMouseEnter}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (bounds.width > 0) {
            onSliderPositionChange(Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)));
          }
        }
        onPointerMove?.(event);
      }}
      onMouseUp={onMouseUp}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onKeyDown={(event) => {
        let next = clamped;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= event.shiftKey ? 10 : 1;
        else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += event.shiftKey ? 10 : 1;
        else if (event.key === 'PageDown') next -= 10;
        else if (event.key === 'PageUp') next += 10;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = 100;
        else return;

        event.preventDefault();
        onSliderPositionChange(Math.max(0, Math.min(100, next)));
      }}
    >
      <div className="relative z-0 block h-full w-full">
        <img
          src={imageTo}
          alt={afterLabel}
          onError={onError}
          className="pointer-events-none block h-full w-full object-contain"
        />
      </div>
      <div
        className="absolute inset-0 z-[1] bg-modiff-bg"
        style={{ clipPath: `inset(0 ${Math.max(0, 100 - clamped)}% 0 0)` }}
      >
        <img
          src={imageFrom}
          alt={beforeLabel}
          onError={onError}
          className="pointer-events-none block h-full w-full object-contain"
        />
      </div>
      <div
        className="absolute top-0 z-[3] flex h-full w-0.5 cursor-ew-resize items-center justify-center bg-hf-yellow shadow-modiff-node"
        style={{ left: `calc(${clamped}% - 1px)` }}
      >
        <span className="h-7 w-3 shrink-0 rounded-full border border-modiff-border bg-modiff-panel shadow-modiff-panel" />
      </div>
      <span className="pointer-events-none absolute left-2 top-2 z-[4] rounded-full border border-modiff-border bg-modiff-panel/90 px-2 py-1 text-xs font-semibold text-modiff-text shadow-modiff-panel">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 z-[4] rounded-full border border-modiff-border bg-modiff-panel/90 px-2 py-1 text-xs font-semibold text-modiff-text shadow-modiff-panel">
        {afterLabel}
      </span>
    </div>
  );
});
