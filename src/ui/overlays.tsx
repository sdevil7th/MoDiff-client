import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { cx } from '../utils/classNames';

export type ModiffOverlayAnchor = { left: number; top: number };
export type ModiffOverlayPlacement =
  'bottom' | 'bottom-end' | 'bottom-start' | 'left-start' | 'right-start' | 'top' | 'top-end' | 'top-start';

type OverlayPosition = { left: number; ready: boolean; top: number };

const VIEWPORT_PADDING = 8;

function desiredPosition(
  placement: ModiffOverlayPlacement,
  anchorRect: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top' | 'width'>,
  panelWidth: number,
  panelHeight: number,
  gap: number,
) {
  const centeredLeft = anchorRect.left + anchorRect.width / 2 - panelWidth / 2;
  switch (placement) {
    case 'bottom':
      return { left: centeredLeft, top: anchorRect.bottom + gap };
    case 'bottom-end':
      return { left: anchorRect.right - panelWidth, top: anchorRect.bottom + gap };
    case 'top':
      return { left: centeredLeft, top: anchorRect.top - panelHeight - gap };
    case 'top-end':
      return { left: anchorRect.right - panelWidth, top: anchorRect.top - panelHeight - gap };
    case 'top-start':
      return { left: anchorRect.left, top: anchorRect.top - panelHeight - gap };
    case 'right-start':
      return { left: anchorRect.right + gap, top: anchorRect.top };
    case 'left-start':
      return { left: anchorRect.left - panelWidth - gap, top: anchorRect.top };
    case 'bottom-start':
    default:
      return { left: anchorRect.left, top: anchorRect.bottom + gap };
  }
}

function collisionAwarePosition(
  placement: ModiffOverlayPlacement,
  anchorRect: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top' | 'width'>,
  panelWidth: number,
  panelHeight: number,
  gap: number,
  padding: number,
) {
  let effectivePlacement = placement;
  let position = desiredPosition(effectivePlacement, anchorRect, panelWidth, panelHeight, gap);
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (
    placement.startsWith('bottom') &&
    position.top + panelHeight > viewportHeight - padding &&
    anchorRect.top - panelHeight - gap >= padding
  ) {
    effectivePlacement = placement.replace('bottom', 'top') as ModiffOverlayPlacement;
    position = desiredPosition(effectivePlacement, anchorRect, panelWidth, panelHeight, gap);
  } else if (
    placement.startsWith('top') &&
    position.top < padding &&
    anchorRect.bottom + gap + panelHeight <= viewportHeight - padding
  ) {
    effectivePlacement = placement.replace('top', 'bottom') as ModiffOverlayPlacement;
    position = desiredPosition(effectivePlacement, anchorRect, panelWidth, panelHeight, gap);
  } else if (
    placement === 'right-start' &&
    position.left + panelWidth > viewportWidth - padding &&
    anchorRect.left - panelWidth - gap >= padding
  ) {
    position = desiredPosition('left-start', anchorRect, panelWidth, panelHeight, gap);
  } else if (
    placement === 'left-start' &&
    position.left < padding &&
    anchorRect.right + gap + panelWidth <= viewportWidth - padding
  ) {
    position = desiredPosition('right-start', anchorRect, panelWidth, panelHeight, gap);
  }

  return {
    left: Math.max(padding, Math.min(position.left, viewportWidth - panelWidth - padding)),
    top: Math.max(padding, Math.min(position.top, viewportHeight - panelHeight - padding)),
  };
}

function pointRect(anchor: ModiffOverlayAnchor) {
  return {
    bottom: anchor.top,
    left: anchor.left,
    right: anchor.left,
    top: anchor.top,
    width: 0,
  };
}

function restoreAnchorFocus(anchorRef?: RefObject<HTMLElement | null>) {
  const anchor = anchorRef?.current;
  if (!anchor) return;
  const focusTarget = anchor.matches('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ? anchor
    : anchor.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  focusTarget?.focus();
}

export type ModiffPopoverProps = {
  anchor?: ModiffOverlayAnchor;
  anchorRef?: RefObject<HTMLElement | null>;
  ariaLabel?: string;
  children: ReactNode;
  closeOnEscape?: boolean;
  closeOnOutside?: boolean;
  collisionPadding?: number;
  gap?: number;
  modal?: boolean;
  onClose: () => void;
  open: boolean;
  panelClassName?: string;
  panelId?: string;
  placement?: ModiffOverlayPlacement;
  role?: 'dialog' | 'menu' | 'tooltip';
  testId?: string;
};

export function ModiffPopover({
  anchor,
  anchorRef,
  ariaLabel,
  children,
  closeOnEscape = true,
  closeOnOutside = true,
  collisionPadding = VIEWPORT_PADDING,
  gap = 6,
  modal = false,
  onClose,
  open,
  panelClassName,
  panelId,
  placement = 'bottom-start',
  role = 'dialog',
  testId,
}: ModiffPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<OverlayPosition>({ left: 0, ready: false, top: 0 });

  const updatePosition = useCallback(() => {
    const panel = panelRef.current;
    if (!open || !panel || typeof window === 'undefined') return;
    const anchorRect = anchorRef?.current?.getBoundingClientRect() ?? (anchor ? pointRect(anchor) : null);
    if (!anchorRect) return;
    const next = collisionAwarePosition(
      placement,
      anchorRect,
      panel.offsetWidth,
      panel.offsetHeight,
      gap,
      collisionPadding,
    );
    setPosition((current) =>
      current.ready && current.left === next.left && current.top === next.top ? current : { ...next, ready: true },
    );
  }, [anchor, anchorRef, collisionPadding, gap, open, placement]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    updatePosition();
    let frame: number | null = null;
    let active = true;
    const schedulePosition = () => {
      if (!active || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (active) updatePosition();
      });
    };
    schedulePosition();
    const observer =
      typeof ResizeObserver === 'undefined' || !panelRef.current ? null : new ResizeObserver(schedulePosition);
    // Restoring focus after a node dialog can mount this shallow portal while
    // React Flow is delivering deeper node measurements. Registering it in
    // that delivery itself creates undelivered notifications, even when the
    // observer callback already defers its writes.
    const observeFrame = requestAnimationFrame(() => {
      if (active && panelRef.current) observer?.observe(panelRef.current);
    });
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('scroll', schedulePosition, true);
    return () => {
      active = false;
      cancelAnimationFrame(observeFrame);
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedulePosition);
      window.removeEventListener('scroll', schedulePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!closeOnOutside) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || anchorRef?.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') {
        event.preventDefault();
        onClose();
        restoreAnchorFocus(anchorRef);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, closeOnEscape, closeOnOutside, onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <Fragment>
      {modal ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close popover"
          className="fixed inset-0 z-[100] cursor-default bg-transparent"
          onClick={onClose}
        />
      ) : null}
      <div
        ref={panelRef}
        id={panelId}
        role={role}
        aria-label={ariaLabel}
        aria-modal={modal && role === 'dialog' ? true : undefined}
        data-testid={testId}
        className={cx(
          'fixed z-[110] rounded-modiff-panel border border-modiff-border-subtle bg-modiff-surface font-sans text-modiff-text shadow-modiff-panel',
          !position.ready && 'invisible',
          panelClassName,
        )}
        style={{ left: position.left, top: position.top }}
        onPointerDown={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </Fragment>,
    document.body,
  );
}

export type ModiffTooltipTriggerProps<TElement extends HTMLElement> = {
  'aria-describedby'?: string;
  onBlur: FocusEventHandler<TElement>;
  onFocus: FocusEventHandler<TElement>;
  onPointerEnter: PointerEventHandler<TElement>;
  onPointerLeave: PointerEventHandler<TElement>;
};

export function ModiffTooltip<TElement extends HTMLElement = HTMLElement>({
  children,
  content,
  delay = 250,
  placement = 'bottom',
}: {
  children: (props: ModiffTooltipTriggerProps<TElement>) => ReactNode;
  content: ReactNode;
  delay?: number;
  placement?: 'bottom' | 'top';
}) {
  const tooltipId = useId();
  const triggerRef = useRef<TElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(
    (immediate: boolean) => {
      clearTimer();
      if (immediate || delay <= 0) {
        setOpen(true);
        return;
      }
      timerRef.current = window.setTimeout(() => setOpen(true), delay);
    },
    [clearTimer, delay],
  );

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  useEffect(() => hide, [hide]);

  return (
    <Fragment>
      {children({
        'aria-describedby': open ? tooltipId : undefined,
        onBlur: hide,
        onFocus: (event) => {
          triggerRef.current = event.currentTarget;
          show(true);
        },
        onPointerEnter: (event) => {
          triggerRef.current = event.currentTarget;
          show(false);
        },
        onPointerLeave: hide,
      })}
      <ModiffPopover
        anchorRef={triggerRef}
        closeOnEscape={false}
        closeOnOutside={false}
        onClose={hide}
        open={open}
        panelClassName="pointer-events-none max-w-64 px-2 py-1 text-xs font-semibold"
        panelId={tooltipId}
        placement={placement}
        role="tooltip"
      >
        {content}
      </ModiffPopover>
    </Fragment>
  );
}
