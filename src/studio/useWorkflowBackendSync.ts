import { useEffect, useMemo, useState } from 'react';
import config from '../../app.config';
import { useStudioStore } from '../stores/useStudioStore';
import { RequestError, requestJson } from '../utils/requestJson';
import { stableStringify } from './templateExactness';
import type { WorkflowTab } from './types';

function clientId() {
  const key = 'modiff-workflow-client-id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
  sessionStorage.setItem(key, next);
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** A broadcast of this browser's PUT is a save receipt, not a remote edit. */
export function isOwnWorkflowAcknowledgement(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.clientId === 'string' &&
    value.clientId.length > 0 &&
    value.clientId === sessionStorage.getItem('modiff-workflow-client-id')
  );
}

export function backendWorkflowTab(value: unknown): WorkflowTab | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.snapshot)) return null;
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : 'Workflow',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    dirty: false,
    intent: value.intent === 'draft' ? 'draft' : 'saved',
    source: typeof value.source === 'string' ? (value.source as WorkflowTab['source']) : 'manual',
    sourceLabel: typeof value.sourceLabel === 'string' ? value.sourceLabel : undefined,
    backendRevision: typeof value.revision === 'number' ? value.revision : 0,
    snapshot: value.snapshot as WorkflowTab['snapshot'],
  };
}

function contentSignature(tab: WorkflowTab) {
  return stableStringify([tab.title, tab.source, tab.sourceLabel, tab.intent ?? 'saved', tab.snapshot]);
}

const backendSignatures = new Map<string, string>();
const pendingSignatures = new Map<string, string>();
const saveChains = new Map<string, Promise<void>>();
const CLOSED_WORKFLOW_TABS_KEY = 'modiff-closed-workflow-tabs';
const WORKFLOW_SYNC_TIMEOUT_MS = 120_000;

function restoredClosedWorkflowIds() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CLOSED_WORKFLOW_TABS_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

const closedWorkflowIds = restoredClosedWorkflowIds();

function persistClosedWorkflowIds() {
  try {
    window.localStorage.setItem(CLOSED_WORKFLOW_TABS_KEY, JSON.stringify([...closedWorkflowIds]));
  } catch {
    // Closing/opening a tab must still work when browser storage is disabled.
  }
}

export function isWorkflowTabClosed(id: string) {
  return closedWorkflowIds.has(id);
}

export function markWorkflowTabClosed(id: string) {
  closedWorkflowIds.add(id);
  persistClosedWorkflowIds();
}

export function markWorkflowTabOpen(id: string) {
  if (!closedWorkflowIds.delete(id)) return;
  persistClosedWorkflowIds();
}

/** Record a server-originated document so websocket updates are not echoed back. */
export function markBackendWorkflow(tab: WorkflowTab) {
  backendSignatures.set(tab.id, contentSignature(tab));
  pendingSignatures.delete(tab.id);
}

export function forgetBackendWorkflow(id: string) {
  backendSignatures.delete(id);
  pendingSignatures.delete(id);
  closedWorkflowIds.delete(id);
  persistClosedWorkflowIds();
}

/**
 * A delayed canvas checkpoint can mark a tab dirty after an explicit save
 * acknowledgement even when its document is still byte-identical to the
 * backend-owned revision. Clear only that exact false-positive marker; a
 * genuinely newer local document remains dirty.
 */
export function clearDirtyMarkerForExactBackendDocument(id: string) {
  const current = useStudioStore.getState().workflowTabs.find((tab) => tab.id === id);
  if (!current?.dirty) return false;
  const signature = contentSignature(current);
  if (backendSignatures.get(id) !== signature) return false;
  let cleared = false;
  useStudioStore.setState((state) => {
    const latest = state.workflowTabs.find((tab) => tab.id === id);
    if (!latest?.dirty || contentSignature(latest) !== signature || backendSignatures.get(id) !== signature) {
      return state;
    }
    cleared = true;
    return {
      workflowTabs: state.workflowTabs.map((tab) => (tab.id === id ? { ...tab, dirty: false } : tab)),
    };
  });
  return cleared;
}

async function putWorkflow(tab: WorkflowTab, signal?: AbortSignal) {
  const payload = await requestJson(`${config.serverAddress}/workflows/${encodeURIComponent(tab.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: tab.title,
      intent: tab.intent ?? 'saved',
      snapshot: tab.snapshot,
      source: tab.source,
      sourceLabel: tab.sourceLabel,
      createdAt: tab.createdAt,
      clientId: clientId(),
    }),
    signal,
    timeoutMs: WORKFLOW_SYNC_TIMEOUT_MS,
  });
  return backendWorkflowTab(payload);
}

/** Persist a complete backend document without implicitly opening it as a browser tab. */
export async function saveDetachedWorkflowNow(tab: WorkflowTab) {
  const saved = await putWorkflow(tab);
  if (!saved) throw new Error(`MoDiff did not return the saved workflow ${tab.title}.`);
  markBackendWorkflow(saved);
  return saved;
}

/**
 * Persist one workflow immediately.
 *
 * The background sync remains crash-recovery/autosave. Explicit Save uses
 * this path so the UI can confirm only after the backend owns the exact
 * snapshot the user asked to save.
 */
export function saveWorkflowNow(tab: WorkflowTab, options: { merge?: boolean } = {}) {
  const pending = saveChains.get(tab.id) ?? Promise.resolve();
  const queued = pending
    .catch(() => undefined)
    .then(async () => {
      const current = useStudioStore.getState().workflowTabs.find((item) => item.id === tab.id);
      if (!current || isWorkflowTabClosed(tab.id)) throw new Error(`Workflow ${tab.title} is no longer open.`);
      const saved = await saveDetachedWorkflowNow({ ...current, intent: 'saved' });
      const stillOpen = useStudioStore.getState().workflowTabs.some((item) => item.id === tab.id);
      if (options.merge !== false && stillOpen && !isWorkflowTabClosed(tab.id)) {
        useStudioStore.getState().mergeBackendWorkflow(saved, { acknowledgement: true });
      }
      return saved;
    });
  // Explicit saves must own the same chain as autosave, not merely wait for
  // its previous tail. Otherwise a new autosave can overtake an explicit PUT.
  const completed = queued.then(
    () => undefined,
    () => undefined,
  );
  saveChains.set(tab.id, completed);
  void completed.then(() => {
    if (saveChains.get(tab.id) === completed) saveChains.delete(tab.id);
  });
  return queued;
}

export async function deleteWorkflowNow(id: string) {
  await requestJson(`${config.serverAddress}/workflows/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    timeoutMs: WORKFLOW_SYNC_TIMEOUT_MS,
  });
  forgetBackendWorkflow(id);
  useStudioStore.getState().removeBackendWorkflow(id);
}

function queueWorkflowPut(tab: WorkflowTab, onError: (error: unknown) => void) {
  const signature = contentSignature(tab);
  pendingSignatures.set(tab.id, signature);
  const previous = saveChains.get(tab.id) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(async () => {
      const current = useStudioStore.getState().workflowTabs.find((item) => item.id === tab.id);
      if (!current || contentSignature(current) !== signature) return;
      try {
        const saved = await putWorkflow(current);
        if (!saved) return;
        markBackendWorkflow(saved);
        const latest = useStudioStore.getState().workflowTabs.find((item) => item.id === tab.id);
        if (latest && !isWorkflowTabClosed(tab.id) && contentSignature(latest) === signature) {
          useStudioStore.getState().mergeBackendWorkflow(saved, { acknowledgement: true });
        }
      } catch (error) {
        if (pendingSignatures.get(tab.id) === signature) pendingSignatures.delete(tab.id);
        onError(error);
      }
    });
  saveChains.set(tab.id, queued);
  void queued.finally(() => {
    if (saveChains.get(tab.id) === queued) saveChains.delete(tab.id);
  });
}

/** Keep browser tabs as views of one backend-owned saved-workflow library. */
export function useWorkflowBackendSync() {
  const tabs = useStudioStore((state) => state.workflowTabs);
  const workflowCanvasHydrated = useStudioStore((state) => state.workflowCanvasHydrated);
  const [hydrated, setHydrated] = useState(false);
  const [syncEpoch, retrySync] = useState(0);
  const serialized = useMemo(() => tabs.map((tab) => contentSignature(tab)).join('\n'), [tabs]);
  const dirtyState = useMemo(() => tabs.map((tab) => `${tab.id}:${tab.dirty ? 'dirty' : 'saved'}`).join('\n'), [tabs]);

  useEffect(() => {
    if (!workflowCanvasHydrated) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const controller = new AbortController();
    const cancelHydration = () => {
      if (cancelled) return;
      cancelled = true;
      controller.abort(new Error('Workflow hydration page lifecycle ended.'));
    };
    // A document reload/close can destroy an in-flight network request without running React's
    // effect cleanup first. Mark that lifecycle transition explicitly so the
    // resulting cancellation is not misreported as a backend outage.
    const handlePageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) cancelHydration();
    };
    window.addEventListener('pagehide', handlePageHide);
    const hydrate = async () => {
      try {
        const store = useStudioStore.getState();
        // Backend workflows are a saved-document library, not browser tabs.
        // Fetch only documents this browser already considers open; every
        // other saved document remains available from My workflows or a run.
        for (const tab of store.workflowTabs) {
          if (isWorkflowTabClosed(tab.id)) continue;
          let backendTab: WorkflowTab | null = null;
          try {
            const payload = await requestJson(`${config.serverAddress}/workflows/${encodeURIComponent(tab.id)}`, {
              signal: controller.signal,
              timeoutMs: WORKFLOW_SYNC_TIMEOUT_MS,
            });
            backendTab = backendWorkflowTab(payload);
          } catch (error) {
            if (!(error instanceof RequestError && error.status === 404)) throw error;
          }
          if (cancelled) return;
          if (backendTab && !tab.dirty) {
            markBackendWorkflow(backendTab);
            store.mergeBackendWorkflow(backendTab);
            continue;
          }
          // A new local document, or a synchronous checkpoint newer than the
          // last backend revision, must be uploaded before hydration finishes.
          const saved = await putWorkflow(tab, controller.signal);
          if (cancelled || !saved) continue;
          markBackendWorkflow(saved);
          const latest = useStudioStore.getState().workflowTabs.find((item) => item.id === tab.id);
          if (latest && !isWorkflowTabClosed(tab.id))
            useStudioStore.getState().mergeBackendWorkflow(saved, { acknowledgement: true });
        }
        if (!cancelled) setHydrated(true);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.warn('Backend workflow sync is unavailable.', error);
        if (!cancelled) retryTimer = window.setTimeout(() => void hydrate(), 2000);
      }
    };
    void hydrate();
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      cancelHydration();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [workflowCanvasHydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const current = useStudioStore.getState().workflowTabs;
      current.forEach((tab) => {
        const signature = contentSignature(tab);
        if (backendSignatures.get(tab.id) === signature) {
          if (tab.dirty) clearDirtyMarkerForExactBackendDocument(tab.id);
          return;
        }
        if (pendingSignatures.get(tab.id) === signature) return;
        queueWorkflowPut(tab, (error) => {
          console.warn(`Could not sync workflow ${tab.title}.`, error);
          window.setTimeout(() => retrySync((value) => value + 1), 2000);
        });
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dirtyState, hydrated, serialized, syncEpoch]);
}
