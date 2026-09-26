import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

type Destination = { id: string; placement: 'before' | 'after' };
type Preview = Destination & { sourceId: string };

// Drag is presentation-only until pointer-up. Stable IDs resolve against the
// latest store state, so a save acknowledgement cannot be overwritten by a drag.
export function useWorkflowTabReorder(
  listRef: RefObject<HTMLDivElement | null>,
  order: string,
  move: (id: string, targetId: string, placement: 'before' | 'after') => void,
) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);

  // Structural changes during a gesture cancel it; content-only saves do not.
  useEffect(() => () => cleanupRef.current?.(), [order]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, sourceId: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    cleanupRef.current?.();
    suppressClickRef.current = false;
    const list = listRef.current;
    if (!list) return;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let x = startX;
    let y = startY;
    let dragging = false;
    let destination: Destination | null = null;
    let frame = 0;
    let previousTime = 0;

    const locate = () => {
      const bounds = list.getBoundingClientRect();
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
        destination = null;
      } else {
        const items = Array.from(list.querySelectorAll<HTMLElement>('[data-workflow-tab-id]'));
        destination = null;
        for (const item of items) {
          const id = item.dataset.workflowTabId!;
          if (id === sourceId) continue;
          const rect = item.getBoundingClientRect();
          destination = { id, placement: 'after' };
          if (x < rect.left + rect.width / 2) {
            destination = { id, placement: 'before' };
            break;
          }
        }
      }
      const next = destination ? { ...destination, sourceId } : null;
      setPreview((current) => (current?.id === next?.id && current?.placement === next?.placement ? current : next));
    };

    const scroll = (time: number) => {
      const bounds = list.getBoundingClientRect();
      const elapsed = previousTime ? Math.min(time - previousTime, 32) : 16;
      previousTime = time;
      if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        const edge = Math.min(40, bounds.width / 4);
        const velocity = x < bounds.left + edge ? -1 : x > bounds.right - edge ? 1 : 0;
        list.scrollLeft += velocity * elapsed * 0.6;
      }
      locate();
      frame = requestAnimationFrame(scroll);
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cleanup);
      setPreview(null);
      cleanupRef.current = null;
    };
    const onMove = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      y = e.clientY;
      if (!dragging && Math.hypot(x - startX, y - startY) >= 6) {
        dragging = true;
        suppressClickRef.current = true;
        frame = requestAnimationFrame(scroll);
      }
      if (dragging) {
        e.preventDefault();
        locate();
      }
    };
    const onUp = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX;
      y = e.clientY;
      if (dragging) locate();
      const result = dragging ? destination : null;
      cleanup();
      if (result) move(sourceId, result.id, result.placement);
    };
    const onCancel = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointerId) cleanup();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      cleanup();
    };
    cleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cleanup);
  };

  return {
    preview,
    onPointerDown,
    shouldSelect: () => !suppressClickRef.current,
    allowKeyboardSelection: () => {
      suppressClickRef.current = false;
    },
  };
}
