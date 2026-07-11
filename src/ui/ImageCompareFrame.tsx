import { forwardRef, type MouseEventHandler, type SyntheticEvent, type TouchEventHandler } from 'react';
import { cx } from '../utils/classNames';

export type ImageCompareFrameProps = {
  imageFrom: string;
  imageTo: string;
  sliderPosition: number;
  onError: (event: SyntheticEvent<HTMLImageElement, Event>) => void;
  onMouseDown: MouseEventHandler<HTMLDivElement>;
  onMouseMove: MouseEventHandler<HTMLDivElement>;
  onMouseUp: MouseEventHandler<HTMLDivElement>;
  onTouchStart?: TouchEventHandler<HTMLDivElement>;
  onTouchMove?: TouchEventHandler<HTMLDivElement>;
  onTouchEnd?: TouchEventHandler<HTMLDivElement>;
  className?: string;
  testId?: string;
};

export const ImageCompareFrame = forwardRef<HTMLDivElement, ImageCompareFrameProps>(function ImageCompareFrame(
  {
    imageFrom,
    imageTo,
    sliderPosition,
    onError,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onTouchEnd,
    onTouchMove,
    onTouchStart,
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
      className={cx('relative h-full w-full cursor-ew-resize select-none overflow-hidden', className)}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="relative z-0 block h-full w-full">
        <img
          src={imageTo}
          alt="Original"
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
          alt="Modified"
          onError={onError}
          className="pointer-events-none block h-full w-full object-contain"
        />
      </div>
      <div
        className="absolute top-0 z-[3] flex h-full w-1 cursor-ew-resize items-center justify-center bg-white/65 outline outline-1 outline-white/35"
        style={{ left: `calc(${clamped}% - 2px)` }}
      />
    </div>
  );
});
