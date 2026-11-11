import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { runRecoveryOriginIsCurrent, type RunRecoveryFocusTarget } from './runRecovery';
import { enqueueSnackbar } from '../ui/snackbar';

const studioFieldSections: Record<string, string> = {
  width: 'advanced-generation',
  height: 'advanced-generation',
  layers: 'advanced-generation',
  controlMode: 'mask-control',
  device: 'runtime',
  offloadMode: 'runtime',
  quantizationMode: 'runtime',
};

function findTarget(root: HTMLElement, target: RunRecoveryFocusTarget): HTMLElement | null {
  if (target.kind === 'runtime') {
    return (
      [...root.querySelectorAll<HTMLElement>('[data-run-recovery-profile]')].find((element) =>
        target.profileIds.includes(element.dataset.runRecoveryProfile ?? ''),
      ) ?? (root.dataset.runRecoveryReady === 'true' ? root : null)
    );
  }
  if (target.kind === 'resources') return root.querySelector<HTMLElement>('[data-testid="plan-workflow-auto"]');
  if (target.kind === 'studio') {
    const section = studioFieldSections[target.fieldId];
    const toggle = section
      ? root.querySelector<HTMLButtonElement>(`[data-testid="studio-section-toggle-${section}"]`)
      : null;
    // An explicit recovery gesture opens the existing disclosure through its
    // normal handler. Inspection never changes the graph or persisted values.
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
    return (
      [...root.querySelectorAll<HTMLElement>('[data-run-recovery-field]')].find(
        (element) => element.dataset.runRecoveryField === target.fieldId,
      ) ?? null
    );
  }
  const inspector = [...root.querySelectorAll<HTMLElement>('[data-testid]')].find(
    (element) => element.dataset.testid === `studio-node-disclosure-${target.nodeId}`,
  );
  if (!inspector) return null;
  if (!target.fieldId) return inspector;
  return (
    [...inspector.querySelectorAll<HTMLElement>('[data-key]')].find(
      (element) => element.dataset.key === target.fieldId,
    ) ?? null
  );
}

/** Focus only the panel requested by an explicit, still-current recovery action. */
export function useRunRecoveryFocus<T extends HTMLElement = HTMLDivElement>(panel: 'studio' | 'runtime' | 'resources') {
  const rootRef = useRef<T>(null);
  const request = useSettingsStore((state) => state.runRecoveryFocusRequest);
  const panelOpen = useSettingsStore((state) => state.isRightPanelOpen);
  const panelTab = useSettingsStore((state) => state.rightPanelTab);
  useEffect(() => {
    const root = rootRef.current;
    const target = request?.target;
    if (!root || !request || !target || (target.kind === 'node' ? 'studio' : target.kind) !== panel) return;
    const expectedTab = panel === 'runtime' ? 'setup' : panel === 'resources' ? 'compatibility' : 'studio';
    if (!panelOpen || panelTab !== expectedTab) {
      if (useSettingsStore.getState().runRecoveryFocusRequest === request) {
        useSettingsStore.getState().setRunRecoveryFocusRequest(null);
      }
      return;
    }
    let finished = false;
    const clear = () => {
      finished = true;
      if (useSettingsStore.getState().runRecoveryFocusRequest === request) {
        useSettingsStore.getState().setRunRecoveryFocusRequest(null);
      }
    };
    const focus = () => {
      if (finished) return;
      if (!runRecoveryOriginIsCurrent(request.origin)) return clear();
      const element = findTarget(root, target);
      if (!element || element.getClientRects().length === 0) return;
      const control = element.matches('button,input,select,textarea,[tabindex]')
        ? element
        : element.querySelector<HTMLElement>('input:not([type="hidden"]),select,textarea,button,[tabindex]');
      if (!control || control.matches(':disabled')) return;
      if (target.kind === 'runtime' && element === root && target.profileIds.length > 0) {
        enqueueSnackbar(
          'The required runtime is not listed in Setup. Check backend compatibility and the connected platform before installing packages.',
          { variant: 'info' },
        );
      }
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      control.focus({ preventScroll: true });
      clear();
    };
    const observer = new MutationObserver(focus);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'disabled', 'data-run-recovery-ready'],
    });
    // Let the closing dialog finish restoring its focus before moving it into
    // the newly mounted panel. No model or backend request is started here.
    let innerFrame = 0;
    const frame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(focus);
    });
    const timer = window.setTimeout(() => {
      if (!finished && runRecoveryOriginIsCurrent(request.origin)) {
        enqueueSnackbar('The requested control is not available in this view. Inspect the selected node or settings.', {
          variant: 'info',
        });
      }
      clear();
    }, 3_000);
    return () => {
      finished = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(innerFrame);
      observer.disconnect();
      window.clearTimeout(timer);
      // Real panel navigation retires the request. A Strict Mode effect replay
      // keeps its DOM connected and must not cancel the replacement effect.
      queueMicrotask(() => {
        if (!root.isConnected && useSettingsStore.getState().runRecoveryFocusRequest === request) {
          useSettingsStore.getState().setRunRecoveryFocusRequest(null);
        }
      });
    };
  }, [panel, panelOpen, panelTab, request]);
  return rootRef;
}
