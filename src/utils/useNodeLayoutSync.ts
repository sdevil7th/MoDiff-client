import { useUpdateNodeInternals } from '@xyflow/react';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

export function useNodeLayoutSync(nodeId: string, ref: RefObject<HTMLElement | null>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const frameRef = useRef<number | null>(null);

  const scheduleNodeLayoutSync = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      updateNodeInternals(nodeId);
    });
  }, [nodeId, updateNodeInternals]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    scheduleNodeLayoutSync();
    if (typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(() => scheduleNodeLayoutSync());
    // React can mount passive effects while React Flow is delivering a node
    // measurement. Registering a new (shallower) observation in that delivery
    // produces a skipped-notification loop error even with a deferred callback.
    // Both registration and mutations belong outside that delivery cycle.
    const observeFrame = window.requestAnimationFrame(() => observer.observe(element));
    const observedEvents = ['load', 'error', 'loadeddata', 'loadedmetadata', 'transitionend'] as const;
    observedEvents.forEach((eventName) => {
      element.addEventListener(eventName, scheduleNodeLayoutSync, true);
    });
    return () => {
      window.cancelAnimationFrame(observeFrame);
      observer.disconnect();
      observedEvents.forEach((eventName) => {
        element.removeEventListener(eventName, scheduleNodeLayoutSync, true);
      });
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [ref, scheduleNodeLayoutSync]);

  return scheduleNodeLayoutSync;
}
