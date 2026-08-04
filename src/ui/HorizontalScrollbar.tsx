import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { cx } from '../utils/classNames';

type HorizontalScrollMetrics = {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
};

export type ModiffHorizontalScrollbarProps = {
  className?: string;
  controls: string;
  label: string;
  scrollRef: RefObject<HTMLElement | null>;
  testId?: string;
};

const EMPTY_METRICS: HorizontalScrollMetrics = {
  clientWidth: 0,
  scrollLeft: 0,
  scrollWidth: 0,
};

function metricsMatch(left: HorizontalScrollMetrics, right: HorizontalScrollMetrics) {
  return (
    left.clientWidth === right.clientWidth &&
    left.scrollWidth === right.scrollWidth &&
    Math.abs(left.scrollLeft - right.scrollLeft) < 0.5
  );
}

export function ModiffHorizontalScrollbar({
  className,
  controls,
  label,
  scrollRef,
  testId,
}: ModiffHorizontalScrollbarProps) {
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const dragRef = useRef<{ pointerX: number; scrollLeft: number } | null>(null);

  const readMetrics = useCallback(() => {
    const scrollport = scrollRef.current;
    if (!scrollport) return;
    const nextMetrics = {
      clientWidth: scrollport.clientWidth,
      scrollLeft: scrollport.scrollLeft,
      scrollWidth: scrollport.scrollWidth,
    };
    setMetrics((current) => (metricsMatch(current, nextMetrics) ? current : nextMetrics));
  }, [scrollRef]);

  useLayoutEffect(() => {
    const scrollport = scrollRef.current;
    if (!scrollport) return undefined;

    let animationFrame: number | null = null;
    const scheduleMetricsRead = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        readMetrics();
      });
    };

    readMetrics();
    scrollport.addEventListener('scroll', scheduleMetricsRead, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => scheduleMetricsRead());
    resizeObserver?.observe(scrollport);

    const mutationObserver =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => scheduleMetricsRead());
    mutationObserver?.observe(scrollport, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    void document.fonts?.ready.then(scheduleMetricsRead);
    window.addEventListener('resize', scheduleMetricsRead);

    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      scrollport.removeEventListener('scroll', scheduleMetricsRead);
      window.removeEventListener('resize', scheduleMetricsRead);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [readMetrics, scrollRef]);

  const maxScrollLeft = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  if (maxScrollLeft <= 0) return null;

  // The track is inset by 4px on both sides so it cannot collide with the
  // adjacent pinned action. Keeping it absolutely positioned leaves the
  // scrollport's full height available to its content.
  const trackWidth = Math.max(0, metrics.clientWidth - 8);
  const thumbWidth = Math.min(trackWidth, Math.max(28, (metrics.clientWidth / metrics.scrollWidth) * trackWidth));
  const maxThumbLeft = Math.max(0, trackWidth - thumbWidth);
  const thumbLeft = maxScrollLeft > 0 ? (metrics.scrollLeft / maxScrollLeft) * maxThumbLeft : 0;

  const setScrollLeft = (nextScrollLeft: number) => {
    const scrollport = scrollRef.current;
    if (!scrollport) return;
    scrollport.scrollLeft = Math.max(0, Math.min(maxScrollLeft, nextScrollLeft));
    readMetrics();
  };

  const handleTrackPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    const trackRect = event.currentTarget.getBoundingClientRect();
    const nextThumbLeft = Math.max(0, Math.min(maxThumbLeft, event.clientX - trackRect.left - thumbWidth / 2));
    setScrollLeft(maxThumbLeft > 0 ? (nextThumbLeft / maxThumbLeft) * maxScrollLeft : 0);
  };

  const handleThumbPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      pointerX: event.clientX,
      scrollLeft: scrollRef.current?.scrollLeft ?? 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleThumbPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const scrollDelta = maxThumbLeft > 0 ? ((event.clientX - drag.pointerX) / maxThumbLeft) * maxScrollLeft : 0;
    setScrollLeft(drag.scrollLeft + scrollDelta);
  };

  const finishThumbDrag = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextScrollLeft: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextScrollLeft = metrics.scrollLeft - 40;
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextScrollLeft = metrics.scrollLeft + 40;
    } else if (event.key === 'PageUp') {
      nextScrollLeft = metrics.scrollLeft - metrics.clientWidth * 0.8;
    } else if (event.key === 'PageDown') {
      nextScrollLeft = metrics.scrollLeft + metrics.clientWidth * 0.8;
    } else if (event.key === 'Home') {
      nextScrollLeft = 0;
    } else if (event.key === 'End') {
      nextScrollLeft = maxScrollLeft;
    }

    if (nextScrollLeft === null) return;
    event.preventDefault();
    setScrollLeft(nextScrollLeft);
  };

  return (
    <div
      role="scrollbar"
      aria-controls={controls}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemax={Math.round(maxScrollLeft)}
      aria-valuemin={0}
      aria-valuenow={Math.round(metrics.scrollLeft)}
      className={cx(
        'absolute inset-x-1 bottom-0 z-10 h-2 rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-modiff-focus',
        className,
      )}
      data-testid={testId}
      onKeyDown={handleKeyDown}
      onPointerDown={handleTrackPointerDown}
      tabIndex={0}
    >
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1 rounded-full bg-modiff-bg/70"
        data-testid={testId ? `${testId}-rail` : undefined}
      />
      <div
        className="absolute bottom-0 left-0 h-1 touch-none rounded-full bg-modiff-subtle-text/80 hover:bg-modiff-text"
        data-testid={testId ? `${testId}-thumb` : undefined}
        onLostPointerCapture={() => {
          dragRef.current = null;
        }}
        onPointerCancel={finishThumbDrag}
        onPointerDown={handleThumbPointerDown}
        onPointerMove={handleThumbPointerMove}
        onPointerUp={finishThumbDrag}
        style={{
          transform: `translate3d(${thumbLeft}px, 0, 0)`,
          width: `${thumbWidth}px`,
        }}
      />
    </div>
  );
}
