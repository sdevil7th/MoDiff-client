import config from '../../app.config';
import { useFlowStore } from '../stores/useFlowStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { useSettingsStore, type MediaViewerItem } from '../stores/useSettingsStore';
import { findStudioRunContext, useStudioStore } from '../stores/useStudioStore';
import { coerceTask, useTaskStore, type SessionRun, type Task } from '../stores/useTaskStore';
import { coerceStudioOutput, isRecord } from './outputContracts';
import type { StudioOutput } from './types';
import { backendWorkflowTab, markBackendWorkflow, markWorkflowTabOpen } from './useWorkflowBackendSync';
import { enqueueSnackbar } from '../ui/snackbar';
import { requestJson } from '../utils/requestJson';
import { runtimeProgressTarget } from './userBlocks';
import { executionProgressFrom } from './executionProgress';

export type RunActivityStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type RunActivityTarget = {
  taskId: string;
  clientRunId?: string | null;
  workflowTabId?: string | null;
  nodeId?: string | null;
  status: RunActivityStatus;
  name?: string | null;
  preferWorkflow?: boolean;
};

export type RunActivityResult = 'workflow' | 'preview' | 'failure' | 'queue' | 'superseded';

let latestRunActivityRequest = 0;

function sessionRunSortTime(run: SessionRun) {
  return run.completedAtMs ?? run.startedAtMs ?? run.queuedAtMs ?? run.createdAtMs;
}

export function sortSessionRunsNewestFirst(runs: SessionRun[]) {
  return [...runs].sort((left, right) => sessionRunSortTime(right) - sessionRunSortTime(left));
}

type RunLookupResponse = {
  task?: Task;
  workflow_id?: string | null;
  workflow_title?: string | null;
  workflow_snapshot?: unknown;
  outputs?: unknown[];
};

export function runActivityTargetForTask(
  task: Task | SessionRun,
  fallbackTaskId?: string,
  fallbackStatus: RunActivityStatus = 'queued',
): RunActivityTarget {
  const sessionRunId = 'id' in task && typeof task.id === 'string' ? task.id : undefined;
  return {
    taskId: task.task_id || fallbackTaskId || sessionRunId || task.sid || 'unknown-task',
    clientRunId: task.client_run_id,
    workflowTabId: task.workflow_tab_id,
    nodeId: task.node_id || task.current_node,
    status: task.status ?? fallbackStatus,
    name: task.name,
  };
}

export function runActivityLabelForTask(task: Task | SessionRun, fallback = 'Graph execution') {
  return usableWorkflowName(task.workflow_title) || usableWorkflowName(task.name) || fallback;
}

function taskForActivity(taskId: string) {
  const state = useTaskStore.getState();
  return (
    state.sessionRuns.find((run) => run.task_id === taskId || run.id === taskId) ??
    (state.currentTask?.task_id === taskId ? state.currentTask : undefined) ??
    state.queuedTasks[taskId] ??
    state.failedTasks[taskId]
  );
}

function recordedIdentities(
  output: StudioOutput,
  key: 'clientRunId' | 'taskId',
  provenanceKey: 'backendExecutionId' | 'clientRunId',
) {
  const values = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) values.add(value.trim());
  };
  add(output[key]);
  add(output.provenance?.[provenanceKey]);
  add(output.backendProvenance?.[provenanceKey]);
  output.mediaItems?.forEach((item) => add(item[key]));
  return values;
}

function outputIdentities(output: StudioOutput) {
  return {
    taskIds: recordedIdentities(output, 'taskId', 'backendExecutionId'),
    clientRunIds: recordedIdentities(output, 'clientRunId', 'clientRunId'),
  };
}

export function outputsForRun(outputs: StudioOutput[], taskId: string, clientRunId?: string | null): StudioOutput[] {
  const taskMatches = outputs.filter((output) => {
    const { taskIds, clientRunIds } = outputIdentities(output);
    if (taskIds.size !== 1 || !taskIds.has(taskId)) return false;
    if (!clientRunId) return clientRunIds.size <= 1;
    return clientRunIds.size === 0 || (clientRunIds.size === 1 && clientRunIds.has(clientRunId));
  });
  const candidates =
    taskMatches.length > 0 || !clientRunId
      ? taskMatches
      : outputs.filter((output) => {
          const { taskIds, clientRunIds } = outputIdentities(output);
          return taskIds.size === 0 && clientRunIds.size === 1 && clientRunIds.has(clientRunId);
        });
  return candidates.sort((left, right) => left.createdAt - right.createdAt);
}

function inferredMediaKind(
  displayType: StudioOutput['displayType'] | NonNullable<StudioOutput['mediaItems']>[number]['displayType'],
  url: string,
): MediaViewerItem['kind'] {
  if (displayType === 'video' || displayType === 'audio' || displayType === 'text') return displayType;
  if (displayType === 'image' || displayType === 'image_collection') return 'image';
  const path = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  if (/\.(mp4|webm|mov|mkv)$/.test(path)) return 'video';
  if (/\.(wav|mp3|flac|m4a|ogg)$/.test(path)) return 'audio';
  if (/^data:text\//.test(url) || /\.(txt|json|md)$/.test(path)) return 'text';
  return 'image';
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function mediaViewerItemsForRun(outputs: StudioOutput[]): MediaViewerItem[] {
  const items: MediaViewerItem[] = [];
  const seen = new Set<string>();

  outputs.forEach((output, outputIndex) => {
    const sourceItems =
      output.mediaItems && output.mediaItems.length > 0
        ? output.mediaItems
        : [
            {
              index: 0,
              value: output.value,
              url: output.url,
              displayType: output.displayType,
              backendPath: output.backendMediaPath ?? output.backendImagePath,
              label: undefined,
              role: undefined,
            },
          ];
    sourceItems.forEach((item, itemIndex) => {
      const url = typeof item.url === 'string' ? item.url : '';
      const kind = inferredMediaKind(item.displayType, url);
      const text = kind === 'text' ? textValue(item.value ?? output.value) : undefined;
      if (kind !== 'text' && !url) return;
      const dedupeKey = `${kind}:${kind === 'text' ? text : url}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      items.push({
        id: `${output.id}:${item.index ?? itemIndex}`,
        kind,
        label: item.label || item.role || output.templateLabel || output.modelLabel || `Output ${outputIndex + 1}`,
        ...(kind === 'text' ? { text } : { url }),
        downloadName: item.backendPath?.split(/[\\/]/).pop(),
      });
    });
  });

  return items;
}

async function fetchRun(taskId: string): Promise<RunLookupResponse | null> {
  try {
    return await requestJson<RunLookupResponse>(`${config.serverAddress}/runs/${encodeURIComponent(taskId)}`);
  } catch (error) {
    console.warn(`Could not load run ${taskId}.`, error);
    return null;
  }
}

async function fetchWorkflow(workflowTabId: string) {
  try {
    const payload = await requestJson(`${config.serverAddress}/workflows/${encodeURIComponent(workflowTabId)}`);
    return backendWorkflowTab(payload);
  } catch (error) {
    console.warn(`Could not load workflow ${workflowTabId}; using the run snapshot when available.`, error);
    return null;
  }
}

function workflowFromRunLookup(lookup: RunLookupResponse, workflowTabId: string) {
  return backendWorkflowTab({
    id: workflowTabId,
    title: lookup.workflow_title || 'Workflow',
    snapshot: lookup.workflow_snapshot,
    source: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    revision: 0,
  });
}

function workflowFromTask(task: Task | SessionRun | undefined, workflowTabId: string) {
  if (!task?.workflow_snapshot) return null;
  return backendWorkflowTab({
    id: workflowTabId,
    title: task.workflow_title || 'Workflow',
    snapshot: task.workflow_snapshot,
    source: 'manual',
    createdAt: task.queued_at ?? task.started_at ?? Date.now(),
    updatedAt: task.updated_at ?? Date.now(),
    revision: 0,
  });
}

function workflowMetadataFromOutput(output: StudioOutput | undefined) {
  if (!output || !isRecord(output.apiGraphSnapshot)) return { title: null, snapshot: null };
  const runtimeHints = isRecord(output.apiGraphSnapshot.runtimeHints) ? output.apiGraphSnapshot.runtimeHints : null;
  return {
    title: usableWorkflowName(runtimeHints?.workflowTitle),
    snapshot: isRecord(runtimeHints?.workflowSnapshot) ? runtimeHints.workflowSnapshot : null,
  };
}

function workflowFromOutput(output: StudioOutput | undefined, workflowTabId: string, title: string) {
  if (!output) return null;
  const persistedSnapshot = workflowMetadataFromOutput(output).snapshot;
  const graphSnapshot = output.graphSnapshot;
  const snapshot =
    persistedSnapshot ??
    (graphSnapshot
      ? {
          nodes: graphSnapshot.nodes ?? [],
          edges: graphSnapshot.edges ?? [],
          viewport: graphSnapshot.viewport ?? { x: 0, y: 0, zoom: 1 },
          studioForm: output.formSnapshot,
          studioGraphBinding: output.graphBindingSnapshot ?? null,
          selectedMode: output.formSnapshot.mode,
          activeTemplateId: output.templateId ?? null,
          sourceOutputId: output.sourceOutputId ?? output.parentId ?? null,
          pinnedGraphInputIds: [],
        }
      : null);
  if (!snapshot) return null;
  return backendWorkflowTab({
    id: workflowTabId,
    title,
    snapshot,
    source: 'gallery',
    sourceLabel: 'Run output',
    createdAt: output.createdAt,
    updatedAt: Date.now(),
    revision: 0,
  });
}

function usableWorkflowName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.toLowerCase() === 'graph execution') return null;
  return name;
}

function workflowNameForRun(
  target: RunActivityTarget,
  task: Task | SessionRun | undefined,
  lookup: RunLookupResponse | null,
  workflowTabId: string | null,
  outputs: StudioOutput[] = [],
) {
  const openWorkflowName = workflowTabId
    ? useStudioStore.getState().workflowTabs.find((tab) => tab.id === workflowTabId)?.title
    : null;
  return (
    usableWorkflowName(lookup?.workflow_title) ||
    usableWorkflowName(task?.workflow_title) ||
    usableWorkflowName(openWorkflowName) ||
    outputs.map((output) => workflowMetadataFromOutput(output).title).find(Boolean) ||
    usableWorkflowName(target.name) ||
    outputs.map((output) => usableWorkflowName(output.templateLabel)).find(Boolean) ||
    'Untitled workflow'
  );
}

function coerceRunOutputs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(coerceStudioOutput).filter((output): output is StudioOutput => Boolean(output));
}

function failureFromRun(
  target: RunActivityTarget,
  task: Task | SessionRun | undefined,
  lookup: RunLookupResponse | null,
  workflowTabId: string | null,
  nodeId: string | null | undefined,
) {
  const lookupTask = coerceTask(lookup?.task);
  const source = lookupTask ?? task;
  const category = source?.category ?? null;
  return {
    taskId: target.taskId,
    clientRunId: target.clientRunId ?? source?.client_run_id ?? null,
    workflowTabId: workflowTabId ?? source?.workflow_tab_id ?? null,
    runInputHash: source?.run_input_hash ?? null,
    nodeId: nodeId ?? source?.node_id ?? source?.current_node ?? null,
    nodeName: source?.current_node_name ?? null,
    message: source?.error || source?.message || 'The run failed.',
    exceptionType: source?.exception_type ?? null,
    category,
    errorCode: source?.error_code ?? null,
    recoveryHint: source?.recovery_hint ?? null,
    oom: source?.oom ?? category === 'oom',
  };
}

function showQueue(taskId: string) {
  useTaskStore.getState().setFocusedTaskId(taskId);
  useSettingsStore.getState().setRightPanelOpen(true);
  useSettingsStore.getState().setRightPanelTab('queue');
}

function showWorkflow(
  workflowTabId: string,
  nodeId: string | null | undefined,
  target: RunActivityTarget,
  task: Task | SessionRun | undefined,
  requestRevision: number,
) {
  const studio = useStudioStore.getState();
  studio.switchWorkflowTab(workflowTabId);
  const flow = useFlowStore.getState();
  const progressNodeId = nodeId ? runtimeProgressTarget(flow.nodes, nodeId, task?.current_node_name) : null;
  const focusNodeId = progressNodeId ?? nodeId;
  const settings = useSettingsStore.getState();
  settings.setRightPanelOpen(true);
  settings.setRightPanelTab('studio');
  if (focusNodeId) {
    settings.setWorkflowFocusRequest({
      workflowTabId,
      nodeId: focusNodeId,
      requestId: requestRevision,
      requestedAt: Date.now(),
    });
    if (progressNodeId && (target.status === 'running' || target.status === 'queued')) {
      flow.updateProgress(progressNodeId, task?.node_progress ?? 0, {
        activeTaskId: task?.task_id ?? target.taskId,
        attemptIndex: task?.attempt_index,
        executionStatus: task?.status ?? target.status,
        executionPhase: task?.phase,
        progressMessage: task?.message,
        executionProgress: task ? executionProgressFrom(task) : undefined,
      });
    }
  }
}

async function openRunActivityUnsafe(target: RunActivityTarget): Promise<RunActivityResult> {
  const requestRevision = (latestRunActivityRequest += 1);
  useSettingsStore.getState().setRunActivityPendingTaskId(target.taskId);
  const complete = (result: Exclude<RunActivityResult, 'superseded'>) => {
    if (requestRevision === latestRunActivityRequest) {
      useSettingsStore.getState().setRunActivityPendingTaskId(null);
    }
    return result;
  };
  const localTask = taskForActivity(target.taskId);
  const context = findStudioRunContext(target.taskId, target.clientRunId);
  const studio = useStudioStore.getState();
  let workflowTabId =
    target.workflowTabId ||
    context?.workflowTabId ||
    ('workflow_tab_id' in (localTask ?? {}) && typeof localTask?.workflow_tab_id === 'string'
      ? localTask.workflow_tab_id
      : null);
  let localOutputs = outputsForRun(studio.outputs, target.taskId, target.clientRunId);
  workflowTabId = workflowTabId || localOutputs.find((output) => output.workflowTabId)?.workflowTabId || null;
  let nodeId =
    target.nodeId ||
    localTask?.current_node ||
    ('node_id' in (localTask ?? {}) && typeof localTask?.node_id === 'string' ? localTask.node_id : null);
  let lookup: RunLookupResponse | null = null;
  const storedFailure = useRunIssueStore.getState().failuresByTaskId?.[target.taskId];
  workflowTabId = workflowTabId || storedFailure?.workflowTabId || null;
  nodeId = nodeId || storedFailure?.nodeId || null;
  if (target.status === 'failed' && !storedFailure) {
    lookup = await fetchRun(target.taskId);
    if (requestRevision !== latestRunActivityRequest) return 'superseded';
    const fetchedTask = coerceTask(lookup?.task);
    workflowTabId = workflowTabId || lookup?.workflow_id || fetchedTask?.workflow_tab_id || null;
    nodeId = nodeId || fetchedTask?.node_id || fetchedTask?.current_node || null;
  }
  const openTab = workflowTabId ? studio.workflowTabs.find((tab) => tab.id === workflowTabId) : undefined;

  if (openTab) {
    showWorkflow(openTab.id, nodeId, target, localTask, requestRevision);
    if (target.status === 'failed') {
      const issues = useRunIssueStore.getState();
      if (!issues.failuresByTaskId?.[target.taskId]) {
        issues.reportFailure(failureFromRun(target, localTask, lookup, workflowTabId, nodeId), false);
      }
      useRunIssueStore.getState().openFailure(target.taskId);
      return complete('failure');
    }
    return complete('workflow');
  }

  const hasLocalNavigationSnapshot =
    (target.status === 'running' || target.status === 'queued') &&
    Boolean(workflowTabId && localTask?.workflow_snapshot);
  const completedRunNeedsWorkflowMetadata =
    target.status === 'completed' && !openTab && !usableWorkflowName(localTask?.workflow_title);
  const needsRunLookup =
    target.preferWorkflow ||
    completedRunNeedsWorkflowMetadata ||
    (target.status === 'failed'
      ? !storedFailure
      : !hasLocalNavigationSnapshot && (localOutputs.length === 0 || !workflowTabId));
  if (needsRunLookup && !lookup) {
    lookup = await fetchRun(target.taskId);
    if (requestRevision !== latestRunActivityRequest) return 'superseded';
    const fetchedTask = coerceTask(lookup?.task);
    workflowTabId = workflowTabId || lookup?.workflow_id || fetchedTask?.workflow_tab_id || null;
    nodeId = nodeId || fetchedTask?.node_id || fetchedTask?.current_node || null;
    if (localOutputs.length === 0) {
      localOutputs = outputsForRun(coerceRunOutputs(lookup?.outputs), target.taskId, target.clientRunId);
    }
  }

  if ((target.status === 'running' || target.status === 'queued' || target.preferWorkflow) && workflowTabId) {
    const currentStudio = useStudioStore.getState();
    let workflowTab = currentStudio.workflowTabs.find((tab) => tab.id === workflowTabId);
    let restoredFromOutput = false;
    if (!workflowTab) {
      workflowTab = workflowFromTask(localTask, workflowTabId) ?? undefined;
      if (workflowTab) {
        markWorkflowTabOpen(workflowTab.id);
        markBackendWorkflow(workflowTab);
        useStudioStore.getState().mergeBackendWorkflow(workflowTab);
      }
    }
    if (!workflowTab && lookup) {
      workflowTab = workflowFromRunLookup(lookup, workflowTabId) ?? undefined;
      if (workflowTab) {
        markWorkflowTabOpen(workflowTab.id);
        markBackendWorkflow(workflowTab);
        useStudioStore.getState().mergeBackendWorkflow(workflowTab);
      }
    }
    if (!workflowTab) {
      const workflowName = workflowNameForRun(target, localTask, lookup, workflowTabId, localOutputs);
      workflowTab = workflowFromOutput(localOutputs[localOutputs.length - 1], workflowTabId, workflowName) ?? undefined;
      restoredFromOutput = Boolean(workflowTab);
      if (workflowTab) {
        markWorkflowTabOpen(workflowTab.id);
        useStudioStore.getState().mergeBackendWorkflow(workflowTab);
      }
    }
    if (!workflowTab) {
      workflowTab = (await fetchWorkflow(workflowTabId)) ?? undefined;
      if (requestRevision !== latestRunActivityRequest) return 'superseded';
      if (workflowTab) {
        markWorkflowTabOpen(workflowTab.id);
        markBackendWorkflow(workflowTab);
        useStudioStore.getState().mergeBackendWorkflow(workflowTab);
      }
    }
    if (workflowTab) {
      const task = coerceTask(lookup?.task) ?? localTask;
      showWorkflow(workflowTab.id, nodeId, target, task, requestRevision);
      if (restoredFromOutput) {
        enqueueSnackbar(`Restored ${workflowTab.title} from its completed run.`, {
          variant: 'success',
          autoHideDuration: 2600,
        });
      }
      return complete('workflow');
    }
  }

  if (target.status === 'failed') {
    const issues = useRunIssueStore.getState();
    if (!issues.failuresByTaskId?.[target.taskId]) {
      issues.reportFailure(failureFromRun(target, localTask, lookup, workflowTabId, nodeId), false);
    }
    useRunIssueStore.getState().openFailure(target.taskId);
    return complete('failure');
  }

  const mediaItems = mediaViewerItemsForRun(localOutputs);
  if (mediaItems.length > 0) {
    const workflowName = workflowNameForRun(target, localTask, lookup, workflowTabId, localOutputs);
    useSettingsStore.getState().setMediaViewerOpener({
      title: `Output preview - ${workflowName}`,
      items: mediaItems,
      currentIndex: 0,
      ...(workflowTabId
        ? {
            workflow: {
              taskId: target.taskId,
              clientRunId: target.clientRunId,
              workflowTabId,
              nodeId,
              name: workflowName,
            },
          }
        : {}),
    });
    return complete('preview');
  }

  if (target.status === 'completed') {
    enqueueSnackbar('Run completed, but no previewable output was generated. Showing its Queue details.', {
      variant: 'info',
      autoHideDuration: 6000,
    });
  }
  showQueue(target.taskId);
  return complete('queue');
}

export async function openRunActivity(target: RunActivityTarget): Promise<RunActivityResult> {
  try {
    return await openRunActivityUnsafe(target);
  } catch (error) {
    if (useSettingsStore.getState().runActivityPendingTaskId !== target.taskId) return 'superseded';
    console.error(`Could not open run ${target.taskId}.`, error);
    enqueueSnackbar('Could not restore that workflow. Showing its Queue details instead.', {
      variant: 'error',
      autoHideDuration: 7000,
    });
    showQueue(target.taskId);
    useSettingsStore.getState().setRunActivityPendingTaskId(null);
    return 'queue';
  }
}
