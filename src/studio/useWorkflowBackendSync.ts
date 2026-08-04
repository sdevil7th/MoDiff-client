import { useEffect, useMemo, useState } from 'react';
import config from '../../app.config';
import { useStudioStore } from '../stores/useStudioStore';
import { requestJson } from '../utils/requestJson';
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

export function backendWorkflowTab(value: unknown): WorkflowTab | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.snapshot)) return null;
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : 'Workflow',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    dirty: false,
    source: typeof value.source === 'string' ? (value.source as WorkflowTab['source']) : 'manual',
    sourceLabel: typeof value.sourceLabel === 'string' ? value.sourceLabel : undefined,
    backendRevision: typeof value.revision === 'number' ? value.revision : 0,
    snapshot: value.snapshot as WorkflowTab['snapshot'],
  };
}

function contentSignature(tab: WorkflowTab) {
  return JSON.stringify([tab.title, tab.source, tab.sourceLabel, tab.snapshot]);
}

const backendSignatures = new Map<string, string>();
const pendingSignatures = new Map<string, string>();
const saveChains = new Map<string, Promise<void>>();
const CLOSED_WORKFLOW_TABS_KEY = 'modiff-closed-workflow-tabs';

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

async function putWorkflow(tab: WorkflowTab) {
  const payload = await requestJson(`${config.serverAddress}/workflows/${encodeURIComponent(tab.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: tab.title,
      snapshot: tab.snapshot,
      source: tab.source,
      sourceLabel: tab.sourceLabel,
      createdAt: tab.createdAt,
      clientId: clientId(),
    }),
  });
  return backendWorkflowTab(payload);
}

/**
 * Persist one workflow immediately.
 *
 * The background sync remains crash-recovery/autosave. Explicit Save uses
 * this path so the UI can confirm only after the backend owns the exact
 * snapshot the user asked to save.
 */
export async function saveWorkflowNow(tab: WorkflowTab, options: { merge?: boolean } = {}) {
  const pending = saveChains.get(tab.id);
  if (pending) await pending.catch(() => undefined);
  const current = useStudioStore.getState().workflowTabs.find((item) => item.id === tab.id);
  if (!current || isWorkflowTabClosed(tab.id)) throw new Error(`Workflow ${tab.title} is no longer open.`);
  const saved = await putWorkflow(current);
  if (!saved) throw new Error(`MoDiff did not return the saved workflow ${current.title}.`);
  markBackendWorkflow(saved);
  const stillOpen = useStudioStore.getState().workflowTabs.some((item) => item.id === tab.id);
  if (options.merge !== false && stillOpen && !isWorkflowTabClosed(tab.id)) {
    useStudioStore.getState().mergeBackendWorkflow(saved);
  }
  return saved;
}

export async function deleteWorkflowNow(id: string) {
  await requestJson(`${config.serverAddress}/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
          useStudioStore.getState().mergeBackendWorkflow(saved);
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

  useEffect(() => {
    if (!workflowCanvasHydrated) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const hydrate = async () => {
      try {
        const payload = await requestJson(`${config.serverAddress}/workflows`);
        const records = isRecord(payload) && Array.isArray(payload.workflows) ? payload.workflows : [];
        if (cancelled) return;
        const store = useStudioStore.getState();
        const localById = new Map(store.workflowTabs.map((tab) => [tab.id, tab]));
        const backendTabs = records.map(backendWorkflowTab).filter((tab): tab is WorkflowTab => Boolean(tab));
        for (const tab of backendTabs) {
          markBackendWorkflow(tab);
          if (isWorkflowTabClosed(tab.id)) {
            localById.delete(tab.id);
            continue;
          }
          const local = localById.get(tab.id);
          if (local?.dirty) {
            // A synchronous local checkpoint can be newer than the last
            // backend revision when the page closes before the debounced PUT.
            // Keep and upload that document instead of restoring the older
            // server graph over it during the next startup.
            continue;
          }
          localById.delete(tab.id);
          store.mergeBackendWorkflow(tab);
        }
        for (const tab of localById.values()) {
          const saved = await putWorkflow(tab);
          if (cancelled || !saved) continue;
          markBackendWorkflow(saved);
          const latest = useStudioStore.getState().workflowTabs.find((item) => item.id === tab.id);
          if (latest && !isWorkflowTabClosed(tab.id)) useStudioStore.getState().mergeBackendWorkflow(saved);
        }
        if (!cancelled) setHydrated(true);
      } catch (error) {
        console.warn('Backend workflow sync is unavailable.', error);
        if (!cancelled) retryTimer = window.setTimeout(() => void hydrate(), 2000);
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [workflowCanvasHydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      const current = useStudioStore.getState().workflowTabs;
      current.forEach((tab) => {
        const signature = contentSignature(tab);
        if (backendSignatures.get(tab.id) === signature || pendingSignatures.get(tab.id) === signature) return;
        queueWorkflowPut(tab, (error) => {
          console.warn(`Could not sync workflow ${tab.title}.`, error);
          window.setTimeout(() => retrySync((value) => value + 1), 2000);
        });
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [hydrated, serialized, syncEpoch]);
}
