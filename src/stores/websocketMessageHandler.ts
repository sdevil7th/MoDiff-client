import { enqueueSnackbar } from '../ui/snackbar';
import { deepEqual } from '../utils/deepEqual';
import { markStudioGraphDefinitionPending, syncStudioGraphDefinition } from '../studio/graphBridge';
import { collapsedHuggingFaceClusterPreviewTarget } from '../studio/huggingFaceClusterGraph';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { ensureStudioAutoPlanReadyForRun } from '../studio/useStudioRunActions';
import { blockPreviewTargetV2, collapsedUserBlockPreviewTarget, runtimeProgressTarget } from '../studio/userBlocks';
import { executionProgressFrom } from '../studio/executionProgress';
import {
  backendWorkflowTab,
  forgetBackendWorkflow,
  isWorkflowTabClosed,
  isOwnWorkflowAcknowledgement,
  markBackendWorkflow,
} from '../studio/useWorkflowBackendSync';
import { isWebsocketMessage, type TaskWebsocketMessage, type WebsocketMessage } from '../types/api';
import { useFlowStore, type CustomNodeType } from './useFlowStore';
import { NodeParams, useNodesStore } from './useNodeStore';
import { useRunIssueStore } from './useRunIssueStore';
import { useSettingsStore } from './useSettingsStore';
import {
  captureWorkflowOperationContext,
  findStudioRunContext,
  isWorkflowOperationCancelled,
  useStudioStore,
  workflowOperationContextIsCurrent,
} from './useStudioStore';
import { coerceTask, coerceTaskRecord, type Task, useTaskStore } from './useTaskStore';

export type WebsocketMessageHandlerContext = {
  sid: string | null;
  ws: WebSocket;
  getSid: () => string | null;
  setSid: (sid: string | null) => void;
  setLoopTimer: (timer: NodeJS.Timeout) => void;
};

const TERMINAL_NODE_PROGRESS_TASK_LIMIT = 64;
const terminalNodeProgressTaskIds = new Set<string>();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function markNodeProgressTaskTerminal(taskId?: string | null) {
  if (!taskId) return;
  terminalNodeProgressTaskIds.delete(taskId);
  terminalNodeProgressTaskIds.add(taskId);
  while (terminalNodeProgressTaskIds.size > TERMINAL_NODE_PROGRESS_TASK_LIMIT) {
    const oldestTaskId = terminalNodeProgressTaskIds.values().next().value;
    if (!oldestTaskId) break;
    terminalNodeProgressTaskIds.delete(oldestTaskId);
  }
}

export function parseWebsocketMessage(data: unknown): WebsocketMessage | null {
  try {
    const value = typeof data === 'string' ? JSON.parse(data) : data;
    return isWebsocketMessage(value) ? value : null;
  } catch {
    return null;
  }
}

function isTaskCompletionFieldArgs(value: unknown): value is { node: string; key: string; queue?: boolean } {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { node?: unknown }).node === 'string' &&
    typeof (value as { key?: unknown }).key === 'string',
  );
}

function taskWithMessageMetadata(task: Task | undefined, message: TaskWebsocketMessage): Task | undefined {
  const taskId = message.task_id ?? task?.task_id;
  if (!task && !taskId) return undefined;
  return coerceTask({
    ...(task ?? {}),
    name: message.name || task?.name || taskId || 'Graph execution',
    task_id: taskId,
    sid: message.sid ?? task?.sid,
    client_run_id: message.client_run_id ?? task?.client_run_id,
    run_input_hash: message.run_input_hash ?? task?.run_input_hash,
    workflow_tab_id: message.workflow_tab_id ?? task?.workflow_tab_id,
    node_id: message.node_id ?? task?.node_id,
    queued_at: message.queued_at ?? task?.queued_at,
    started_at: message.started_at ?? task?.started_at,
    completed_at: message.completed_at ?? task?.completed_at,
    updated_at: message.updated_at ?? task?.updated_at,
    progress: message.progress ?? task?.progress,
    node_progress: message.node_progress ?? task?.node_progress,
    attempt_index: message.attempt_index ?? task?.attempt_index,
    current_node: message.current_node ?? message.node ?? task?.current_node,
    current_node_name: message.current_node_name ?? message.node_name ?? task?.current_node_name,
    phase: message.phase ?? task?.phase,
    current_step: message.current_step ?? task?.current_step,
    total_steps: message.total_steps ?? task?.total_steps,
    component: message.component ?? task?.component,
    shard_current: message.shard_current ?? task?.shard_current,
    shard_total: message.shard_total ?? task?.shard_total,
    eta_seconds: message.eta_seconds ?? task?.eta_seconds,
    average_step_seconds: message.average_step_seconds ?? task?.average_step_seconds,
    elapsed_seconds: message.elapsed_seconds ?? task?.elapsed_seconds,
    last_heartbeat_at: message.last_heartbeat_at ?? task?.last_heartbeat_at,
    resource_snapshot: message.resource_snapshot ?? task?.resource_snapshot,
    phase_timings: message.phase_timings ?? task?.phase_timings,
    status: message.status ?? task?.status,
    error: message.error ?? task?.error,
    message: message.message ?? task?.message,
    exception_type: message.exception_type ?? task?.exception_type,
    category: message.category ?? task?.category,
    error_code: message.error_code ?? task?.error_code,
    recovery_hint: message.recovery_hint ?? task?.recovery_hint,
    oom: message.oom ?? task?.oom,
  });
}

function taskWithMatchingMessageMetadata(task: Task | undefined, message: TaskWebsocketMessage): Task | undefined {
  if (!task) return undefined;
  if (task?.task_id && message.task_id && task.task_id !== message.task_id) return task;
  return taskWithMessageMetadata(task, message);
}

function assertNeverMessage(message: never): never {
  throw new Error(`Unhandled websocket message type: ${JSON.stringify(message)}`);
}

function applyNodeExecutionStatus(message: WebsocketMessage) {
  if (!('node' in message) || !message.node || !('status' in message) || !message.status) return;
  const flow = useFlowStore.getState();
  const targetNodeId = runtimeProgressTarget(
    flow.nodes,
    message.node,
    'name' in message && typeof message.name === 'string' ? message.name : null,
  );
  if (!targetNodeId) return;
  const statusMessage =
    message.status === 'running'
      ? 'Running'
      : message.status === 'cached'
        ? 'Cached result reused'
        : message.status === 'failed'
          ? 'Failed'
          : 'Completed';
  flow.setNodeUiState(targetNodeId, {
    validationSeverity: message.status === 'failed' ? 'error' : message.status === 'running' ? 'info' : 'success',
    validationMessage: statusMessage,
  });
}

function shouldAcceptNodeProgress(message: WebsocketMessage) {
  if (!('node' in message) || !message.node) return false;
  const taskId = 'task_id' in message ? message.task_id : undefined;
  const clientRunId = 'client_run_id' in message ? message.client_run_id : undefined;
  if (
    taskId &&
    terminalNodeProgressTaskIds.has(taskId) &&
    (message.type === 'progress' || message.type === 'executed')
  ) {
    return false;
  }
  const workflowTabId = 'workflow_tab_id' in message ? message.workflow_tab_id : undefined;
  if (
    (taskId || clientRunId) &&
    !useStudioStore.getState().shouldApplyRunUpdateToActiveWorkflow(taskId, clientRunId, workflowTabId)
  ) {
    return false;
  }
  const currentTaskId = useTaskStore.getState().currentTask?.task_id;
  if (taskId && currentTaskId && taskId !== currentTaskId) return false;
  if (taskId && !currentTaskId && 'status' in message && message.status === 'running') return false;

  const attemptIndex = 'attempt_index' in message ? message.attempt_index : undefined;
  if (typeof attemptIndex === 'number') {
    const flow = useFlowStore.getState();
    const targetNodeId = runtimeProgressTarget(
      flow.nodes,
      message.node,
      'name' in message && typeof message.name === 'string' ? message.name : null,
    );
    const node = flow.nodes.find((item) => item.id === targetNodeId);
    const currentAttempt = node?.data.attemptIndex;
    if (typeof currentAttempt === 'number' && attemptIndex < currentAttempt) return false;
  }
  return true;
}

function shouldApplyWorkflowCanvasMutation(
  message: WebsocketMessage,
  context?: Pick<WebsocketMessageHandlerContext, 'sid'>,
) {
  if (message.sid && context?.sid && message.sid !== context.sid) return false;

  const studio = useStudioStore.getState();
  const taskId = 'task_id' in message ? message.task_id : undefined;
  const clientRunId = 'client_run_id' in message ? message.client_run_id : undefined;
  const workflowTabId = 'workflow_tab_id' in message ? message.workflow_tab_id : undefined;
  const canvasEpoch = 'workflow_canvas_epoch' in message ? message.workflow_canvas_epoch : undefined;
  const formEpoch = 'workflow_form_epoch' in message ? message.workflow_form_epoch : undefined;
  const runContext = findStudioRunContext(taskId, clientRunId);
  if (runContext) {
    return studio.shouldApplyRunUpdateToActiveWorkflow(taskId, clientRunId, workflowTabId);
  }

  // A captured run's epoch identifies the graph it was submitted from. Once
  // that exact graph is restored, its context is structurally verified and
  // rebound to the new canvas epoch. Uncorrelated messages retain the raw
  // epoch guard so an old document can never mutate its replacement.
  if (typeof canvasEpoch === 'number' && canvasEpoch !== studio.workflowCanvasEpoch) return false;
  if (typeof formEpoch === 'number' && formEpoch !== studio.workflowFormEpoch) return false;
  if (workflowTabId) {
    return studio.shouldApplyRunUpdateToActiveWorkflow(taskId, clientRunId, workflowTabId);
  }

  if (typeof canvasEpoch === 'number') return true;

  // Older backends did not include workflow ownership on dynamic field
  // messages. Retain that contract only when there is no multi-tab ambiguity.
  return studio.workflowTabs.length <= 1;
}

function nodeExecutionMetadata(message: WebsocketMessage) {
  if (!('node' in message)) return undefined;
  const executionProgress = executionProgressFrom({
    status: 'status' in message ? message.status : undefined,
    phase: 'phase' in message ? message.phase : undefined,
    message: 'message' in message ? message.message : undefined,
    component: 'component' in message ? message.component : undefined,
    shard_current: 'shard_current' in message ? message.shard_current : undefined,
    shard_total: 'shard_total' in message ? message.shard_total : undefined,
    current_step: 'current_step' in message ? message.current_step : undefined,
    total_steps: 'total_steps' in message ? message.total_steps : undefined,
    average_step_seconds: 'average_step_seconds' in message ? message.average_step_seconds : undefined,
    eta_seconds: 'eta_seconds' in message ? message.eta_seconds : undefined,
    elapsed_seconds: 'elapsed_seconds' in message ? message.elapsed_seconds : undefined,
    attempt_index: 'attempt_index' in message ? message.attempt_index : undefined,
    last_heartbeat_at: 'last_heartbeat_at' in message ? message.last_heartbeat_at : undefined,
    updated_at: 'updated_at' in message ? message.updated_at : undefined,
    resource_snapshot: 'resource_snapshot' in message ? message.resource_snapshot : undefined,
    phase_timings: 'phase_timings' in message ? message.phase_timings : undefined,
  });
  return {
    activeTaskId: 'task_id' in message ? (message.task_id ?? null) : null,
    attemptIndex:
      'attempt_index' in message && typeof message.attempt_index === 'number' ? message.attempt_index : undefined,
    executionStatus: 'status' in message ? message.status : undefined,
    executionPhase: 'phase' in message ? message.phase : undefined,
    progressMessage: 'message' in message ? message.message : undefined,
    executionProgress,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function capturedPreviewDescriptor(
  taskId: string | null | undefined,
  clientRunId: string | null | undefined,
  nodeId: string,
  fieldKey: string,
) {
  const runContext = findStudioRunContext(taskId, clientRunId);
  if (!runContext) return null;
  const capturedNodes = runContext.graph.nodes;
  const node = capturedNodes.map(recordValue).find((candidate) => candidate?.id === nodeId);
  if (!node) {
    const blockPreview = blockPreviewTargetV2(capturedNodes as unknown as CustomNodeType[], nodeId, fieldKey);
    if (blockPreview) {
      return {
        found: true,
        module: 'MoDiff',
        action: 'BlockV2',
        display:
          blockPreview.mediaType === 'image'
            ? 'ui_image'
            : blockPreview.mediaType === 'video'
              ? 'ui_video'
              : blockPreview.mediaType === 'audio'
                ? 'ui_audio'
                : 'ui_text',
        hidden: false,
      };
    }
  }
  const data = recordValue(node?.data);
  const params = recordValue(data?.params);
  const param = recordValue(params?.[fieldKey]);
  return {
    found: Boolean(node),
    module: typeof data?.module === 'string' ? data.module : undefined,
    action: typeof data?.action === 'string' ? data.action : undefined,
    display: typeof param?.display === 'string' ? param.display : undefined,
    hidden: param?.hidden === true,
  };
}

function boundedPreviewReference(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const candidate = value.trim();
    return candidate && candidate.length <= 8192 ? candidate : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  for (const candidate of value) {
    const reference = boundedPreviewReference(candidate);
    if (reference) return reference;
  }
  return undefined;
}

function previewMediaReference(value: unknown, artifacts: unknown) {
  if (Array.isArray(artifacts)) {
    for (const artifact of artifacts) {
      const reference = boundedPreviewReference(recordValue(artifact)?.url);
      if (reference) return reference;
    }
  }
  return boundedPreviewReference(value);
}

function isGeneratedPreviewUpdate(message: WebsocketMessage) {
  if (!('node' in message) || !message.node || !('key' in message) || !message.key) return false;
  const taskId = 'task_id' in message ? message.task_id : undefined;
  const clientRunId = 'client_run_id' in message ? message.client_run_id : undefined;
  const captured = capturedPreviewDescriptor(taskId, clientRunId, message.node, message.key);
  if (captured) {
    if (!captured.found) return false;
    if (captured.hidden) return false;
    if (captured.module === 'modules.Audio' && captured.action === 'Load') return false;
    return (
      captured.display === 'ui_image' ||
      captured.display === 'ui_video' ||
      captured.display === 'ui_audio' ||
      captured.display === 'ui_text'
    );
  }

  const node = useFlowStore.getState().nodes.find((item) => item.id === message.node);
  if (node?.data.module === 'modules.Audio' && node.data.action === 'Load') return false;
  const display = node?.data.params?.[message.key]?.display;
  if (node?.data.params?.[message.key]?.hidden) return false;
  return display === 'ui_image' || display === 'ui_video' || display === 'ui_audio' || display === 'ui_text';
}

function scheduleNodeProgressClear(nodeId: string, taskId?: string | null, attemptIndex?: number) {
  globalThis.setTimeout(() => {
    const node = useFlowStore.getState().nodes.find((item) => item.id === nodeId);
    if (!node) return;
    if (taskId && node.data.activeTaskId && node.data.activeTaskId !== taskId) return;
    if (
      typeof attemptIndex === 'number' &&
      typeof node.data.attemptIndex === 'number' &&
      node.data.attemptIndex !== attemptIndex
    )
      return;
    if (node.data.executionStatus === 'running' || node.data.executionStatus === 'failed') return;
    useFlowStore.getState().updateProgress(nodeId, 0, {
      activeTaskId: null,
      attemptIndex: undefined,
      executionStatus: undefined,
      executionPhase: undefined,
      progressMessage: undefined,
    });
  }, 1400);
}

let studioDefinitionSyncTimer: ReturnType<typeof setTimeout> | null = null;

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function preserveCurrentParamValue(current: NodeParams | undefined, incoming: NodeParams) {
  if (!current) return incoming;
  const preserved = { ...incoming };
  if (hasOwn(current, 'value')) {
    preserved.value = current.value;
  }
  if (current.signal !== undefined) {
    preserved.signal = current.signal;
  }
  if (current.isConnected !== undefined) {
    preserved.isConnected = current.isConnected;
  }
  // Cluster execution metadata belongs to the workflow instance, not to the
  // backend's dynamic field definition. In particular, dropping
  // suppressInitialFieldAction for even one render causes a republished
  // onSignal/onChange handle to dispatch again, which feeds the definition
  // response back into the backend and leaves React Flow rebuilding edges in
  // a loop. Preserve only the app-owned Cluster keys while accepting every
  // other field option from the fresh backend definition.
  const clusterFieldOptions = Object.fromEntries(
    Object.entries(current.fieldOptions ?? {}).filter(
      ([key]) => key === 'suppressInitialFieldAction' || key.startsWith('huggingFaceCluster'),
    ),
  );
  if (Object.keys(clusterFieldOptions).length > 0) {
    preserved.fieldOptions = {
      ...(incoming.fieldOptions ?? {}),
      ...clusterFieldOptions,
    };
  }
  // Dynamic definitions are allowed to republish their declarative actions.
  // Keep the existing object identity when the action itself did not change:
  // HandleField effects intentionally react to action identity, and replacing
  // an equivalent onSignal descriptor would execute the action again and let
  // a definition response feed back into another identical request.
  if (current.onChange !== undefined && deepEqual(current.onChange, incoming.onChange)) {
    preserved.onChange = current.onChange;
  }
  if (current.onSignal !== undefined && deepEqual(current.onSignal, incoming.onSignal)) {
    preserved.onSignal = current.onSignal;
  }
  return preserved;
}

function scheduleStudioDefinitionSync() {
  const workflowContext = captureWorkflowOperationContext();
  if (studioDefinitionSyncTimer) {
    globalThis.clearTimeout(studioDefinitionSyncTimer);
  }
  studioDefinitionSyncTimer = globalThis.setTimeout(() => {
    studioDefinitionSyncTimer = null;
    if (!workflowOperationContextIsCurrent(workflowContext, { includeForm: false })) return;
    syncStudioGraphDefinition();
  }, 80);
}

export function handleWebsocketMessage(message: WebsocketMessage, context: WebsocketMessageHandlerContext) {
  switch (message.type) {
    case 'welcome': {
      if (message.sid !== context.sid) {
        context.setSid(message.sid ?? null);
        console.info('Websocket sid changed');
      }
      const instance = message.instance ?? '';
      if (instance !== useNodesStore.getState().instance) {
        const workflowContext = captureWorkflowOperationContext();
        const schemaPending = useStudioStore.getState().graphBinding ? markStudioGraphDefinitionPending() : false;
        void useNodesStore
          .getState()
          .fetchNodes()
          .then(() => {
            if (!workflowOperationContextIsCurrent(workflowContext, { includeForm: false })) return;
            const flow = useFlowStore.getState();
            flow.replaceGraph({ nodes: flow.nodes, edges: flow.edges, viewport: flow.viewport });
            if (schemaPending) syncStudioGraphDefinition();
          });
        console.info('Server instance changed, fetching nodes');
      }
      const cached = message.cachedNodes ?? [];
      useFlowStore.getState().resetStatus(cached);
      if (message.current !== undefined || message.queued !== undefined) {
        const recent = (message.recent ?? []).flatMap((snapshot) => {
          const task = coerceTask(snapshot);
          return task ? [task] : [];
        });
        useTaskStore.getState().setTasks(coerceTask(message.current), coerceTaskRecord(message.queued ?? {}), recent);
      } else {
        void useTaskStore.getState().fetchTasks();
      }
      if (message.downloads !== undefined) {
        useNodesStore.getState().rehydrateHfDownloadProgress(message.downloads);
      }
      // Output records and their current-preview pointers are backend-owned.
      // Rehydrate them on every reconnect so work completed while this socket
      // was unavailable is reflected without relying on a canvas snapshot.
      void useStudioStore.getState().fetchBackendOutputs();
      break;
    }
    case 'workflow_updated': {
      const workflow = backendWorkflowTab(message.workflow);
      if (workflow) {
        markBackendWorkflow(workflow);
        const isOpen = useStudioStore.getState().workflowTabs.some((tab) => tab.id === workflow.id);
        if (isOpen && !isWorkflowTabClosed(workflow.id)) {
          useStudioStore.getState().mergeBackendWorkflow(workflow, {
            acknowledgement: isOwnWorkflowAcknowledgement(message.workflow),
          });
        }
      }
      break;
    }
    case 'workflow_deleted': {
      if (message.workflow_id) {
        forgetBackendWorkflow(message.workflow_id);
        useStudioStore.getState().removeBackendWorkflow(message.workflow_id);
      }
      break;
    }
    case 'executed':
      if (!message.node) {
        console.error('Invalid websocket message: executed without node');
        return;
      }
      if (!shouldAcceptNodeProgress(message)) return;
      applyNodeExecutionStatus(message);
      {
        const flow = useFlowStore.getState();
        const targetNodeId = runtimeProgressTarget(flow.nodes, message.node, message.label);
        if (!targetNodeId) break;
        flow.updateProgress(targetNodeId, 100, nodeExecutionMetadata(message));
        flow.setNodeCached(
          targetNodeId,
          true,
          message.hasChanged ? message.memoryUsage : undefined,
          message.hasChanged ? message.executionTime : undefined,
        );
        scheduleNodeProgressClear(targetNodeId, message.task_id, message.attempt_index);
      }
      break;
    case 'graph_completed': {
      console.info('Graph completed in', message.executionTime, 'ms');
      const completedRunContext = findStudioRunContext(message.task_id, message.client_run_id);
      markNodeProgressTaskTerminal(message.task_id);
      useStudioStore.getState().markRunContextStatus(message.task_id, message.client_run_id, 'completed');
      // A collapsed User/Cluster Node executes backend-owned synthetic preview
      // node IDs that are intentionally absent from the captured canvas graph.
      // The update_value classifier therefore cannot always enrich local
      // history from that event. The backend persists previews before emitting
      // graph_completed, so rehydrate its authoritative output record here.
      void useStudioStore.getState().fetchBackendOutputs();
      if (message.runtimeFingerprint) {
        console.info('Graph runtime fingerprint', message.runtimeFingerprint);
      }
      useFlowStore.getState().lastExecutionTime = message.executionTime ?? 0;
      useFlowStore.getState().resetExecutionProgress(message.task_id);
      const runningState = useSettingsStore.getState().runningState;
      const taskCount = useTaskStore.getState().taskCount;

      if (runningState === 'loop' && context.sid !== null && taskCount === 1) {
        const workflowTabId = completedRunContext?.workflowTabId ?? useStudioStore.getState().activeWorkflowTabId;
        const loopTimer = setTimeout(() => {
          void (async () => {
            const sid = context.sid;
            if (!sid) return;
            const studio = useStudioStore.getState();
            if (studio.activeWorkflowTabId !== workflowTabId) return;
            const workflowContext = captureWorkflowOperationContext();
            try {
              if (studio.graphBinding) {
                const autoReady = await ensureStudioAutoPlanReadyForRun(workflowContext);
                if (!autoReady) return;
                await coordinateGraphRun({ sid, studioContext: {}, workflowContext });
                return;
              }
              await coordinateGraphRun({ sid, workflowContext });
            } catch (error) {
              if (!isWorkflowOperationCancelled(error)) {
                console.error('Could not queue the next loop run', error);
              }
            }
          })();
        }, 517);
        context.setLoopTimer(loopTimer);
      }
      break;
    }
    case 'deterministic_execution':
      console.info('Deterministic execution enabled', message.deterministicMode, message.runtimeFingerprint);
      break;
    case 'resource_retry':
      console.info('Resource retry', message);
      enqueueSnackbar(message.message || 'Retrying with a lower-memory resource plan.', {
        variant: 'info',
        autoHideDuration: 5000,
      });
      break;
    case 'resource_retry_cleanup':
      console.info('Resource retry cleanup', message);
      break;
    case 'auto_resource_plan_applied':
      if (message.resourceUpdates?.length && shouldApplyWorkflowCanvasMutation(message, context)) {
        const updates = message.resourceUpdates;
        void Promise.all([import('../studio/workflowAutoExecutionV2'), import('./useStudioStore')])
          .then(([runtime, studio]) => {
            if (!shouldApplyWorkflowCanvasMutation(message, context)) return;
            runtime.applyRuntimeWorkflowAutoSettingsV2(updates);
            studio.useStudioStore.getState().saveActiveWorkflowTab(true);
          })
          .catch((error) =>
            enqueueSnackbar(error instanceof Error ? error.message : 'Could not show the run resource settings.', {
              variant: 'warning',
              autoHideDuration: 6000,
            }),
          );
      }
      console.info('Auto resource plan applied', message);
      if (message.message) {
        enqueueSnackbar(message.message, { variant: 'info', autoHideDuration: 3200 });
      }
      break;
    case 'auto_resource_cleanup':
    case 'runtime_resource_cleanup': {
      console.info('Runtime resource cleanup', message);
      if (message.performed) {
        const reason = message.reasons?.filter(Boolean).join('; ');
        enqueueSnackbar(reason ? `Released stale runtime resources: ${reason}` : 'Released stale runtime resources.', {
          variant: 'info',
          autoHideDuration: 4500,
        });
      }
      break;
    }
    case 'auto_retry_requires_approval': {
      const recoveryHint = message.message || 'A safer Auto retry needs approval for pinned workflow fields.';
      const ownsActiveCanvas = shouldApplyWorkflowCanvasMutation(message, context);
      if (ownsActiveCanvas) {
        useStudioStore.getState().setLastError(recoveryHint);
      }
      useRunIssueStore.getState().reportFailure(
        {
          taskId: message.task_id ?? null,
          clientRunId: message.client_run_id ?? null,
          workflowTabId: message.workflow_tab_id ?? null,
          runInputHash: message.run_input_hash ?? null,
          nodeId: message.node ?? message.node_id ?? null,
          message: recoveryHint,
          category: 'auto_resource',
          errorCode: 'auto_retry_requires_override_approval',
          recoveryHint,
          runtimeHints: { retryPlans: message.retryPlans ?? [] },
        },
        ownsActiveCanvas,
      );
      if (ownsActiveCanvas) {
        enqueueSnackbar(recoveryHint, { variant: 'warning', persist: true });
      }
      break;
    }
    case 'runtime_loader_reused':
      console.info('Runtime loader reused', message);
      break;
    case 'error':
      console.error('Websocket error', message.error);
      break;
    case 'node_error': {
      if (message.node) {
        if (!shouldAcceptNodeProgress(message)) return;
        applyNodeExecutionStatus(message);
        const flow = useFlowStore.getState();
        const targetNodeId = runtimeProgressTarget(flow.nodes, message.node, message.label);
        if (!targetNodeId) break;
        flow.updateProgress(targetNodeId, 0, nodeExecutionMetadata(message));
        flow.setNodeUiState(targetNodeId, {
          validationSeverity: 'error',
          validationMessage: message.message || message.error || 'Node failed.',
          errorMessage: message.message || message.error || 'Node failed.',
        });
      }
      break;
    }
    case 'update_value': {
      if (!message.node || !message.key) {
        console.error('Invalid websocket message: update_value without node or fieldkey');
        return;
      }
      const generatedPreviewUpdate = isGeneratedPreviewUpdate(message);
      const studio = useStudioStore.getState();
      if (message.preview_slot && typeof message.preview_state_revision === 'number') {
        studio.mergePreviewState([message.preview_slot], message.preview_state_revision);
      }
      if (generatedPreviewUpdate && !studio.shouldAcceptRunOutputUpdate(message.task_id, message.client_run_id)) {
        return;
      }
      const value = message.value ?? null;
      const correlatedRunUpdate = Boolean(message.task_id || message.client_run_id);
      const activeTaskId = useTaskStore.getState().currentTask?.task_id;
      const belongsToActiveBackendTask = !message.task_id || !activeTaskId || message.task_id === activeTaskId;
      if (
        !correlatedRunUpdate ||
        (belongsToActiveBackendTask &&
          studio.shouldApplyRunUpdateToActiveWorkflow(message.task_id, message.client_run_id, message.workflow_tab_id))
      ) {
        const flow = useFlowStore.getState();
        const blockPreview = blockPreviewTargetV2(flow.nodes, message.node, message.key);
        if (blockPreview) {
          const mediaReference = previewMediaReference(value, message.artifacts);
          flow.setBlockPreviewStateV2(
            blockPreview.rootId,
            { nodeId: blockPreview.nodeId, outputPortId: blockPreview.outputPortId },
            {
              mediaReference: mediaReference ?? null,
              taskId: message.task_id ?? null,
              status: 'complete',
            },
          );
        } else {
          flow.setParam(message.node, message.key, value);
          flow.setParam(message.node, message.key, message.artifacts, 'artifacts');
          const compositePreview =
            collapsedUserBlockPreviewTarget(flow.nodes, message.node, message.key) ??
            collapsedHuggingFaceClusterPreviewTarget(flow.nodes, message.node, message.key);
          if (compositePreview) {
            flow.setParam(compositePreview.nodeId, compositePreview.fieldKey, value);
            flow.setParam(compositePreview.nodeId, compositePreview.fieldKey, message.artifacts, 'artifacts');
          }
        }
      }
      if (generatedPreviewUpdate) {
        studio.recordOutputFromUpdate(message.node, message.key, value, {
          taskId: message.task_id,
          clientRunId: message.client_run_id,
          runInputHash: message.run_input_hash,
          attemptIndex: message.attempt_index,
          runtimeFingerprint: message.runtimeFingerprint,
          dataType: message.data_type,
          artifacts: message.artifacts,
          outputId: message.output_id,
          resolvedExecutionInputs: message.resolved_execution_inputs,
        });
        const currentOutputId = message.preview_slot?.currentOutputId;
        if (currentOutputId && !useStudioStore.getState().outputs.some((output) => output.id === currentOutputId)) {
          void useStudioStore.getState().fetchBackendOutputs();
        }
      }
      break;
    }
    case 'progress':
      if (!message.node) {
        console.error('Invalid websocket message: progress without node');
        return;
      }
      if (message.task_id) {
        const currentTask = useTaskStore.getState().currentTask;
        const ownsCurrentTask = currentTask?.task_id === message.task_id;
        const isTerminalUpdate = terminalNodeProgressTaskIds.has(message.task_id);
        const overallProgress = message.overall_progress ?? currentTask?.progress ?? 0;
        if (ownsCurrentTask && !isTerminalUpdate) {
          useTaskStore.getState().updateProgress(message.task_id, overallProgress, message.message, {
            client_run_id: message.client_run_id,
            run_input_hash: message.run_input_hash,
            workflow_tab_id: message.workflow_tab_id,
            node_id: message.node_id,
            node_progress: message.progress,
            current_node: message.node,
            attempt_index: message.attempt_index,
            phase: message.phase,
            current_step: message.current_step ?? undefined,
            total_steps: message.total_steps ?? undefined,
            component: message.component ?? undefined,
            shard_current: message.shard_current ?? undefined,
            shard_total: message.shard_total ?? undefined,
            elapsed_seconds: message.elapsed_seconds ?? undefined,
            average_step_seconds: message.average_step_seconds ?? undefined,
            eta_seconds: message.eta_seconds ?? undefined,
            last_heartbeat_at: message.last_heartbeat_at,
            resource_snapshot: message.resource_snapshot ?? undefined,
            phase_timings: message.phase_timings,
            updated_at: message.updated_at,
          });
        }
      }
      // Progress for an inactive workflow still belongs in the task/session
      // record so its notification can restore and animate the owning graph.
      // Only the currently visible canvas mutation is workflow-gated.
      if (!shouldAcceptNodeProgress(message)) return;
      applyNodeExecutionStatus(message);
      {
        const flow = useFlowStore.getState();
        const targetNodeId = runtimeProgressTarget(flow.nodes, message.node, message.label);
        if (targetNodeId) {
          flow.updateProgress(targetNodeId, message.progress ?? 0, nodeExecutionMetadata(message));
        }
      }
      break;
    case 'task_queued':
    case 'task_cancelled':
    case 'task_started':
    case 'task_completed': {
      if (message.preview_slots && typeof message.preview_state_revision === 'number') {
        useStudioStore.getState().mergePreviewState(message.preview_slots, message.preview_state_revision);
      }
      const hasQueueSnapshot = message.queued !== undefined || message.current !== undefined;
      if (!hasQueueSnapshot && (message.type === 'task_queued' || message.type === 'task_started')) {
        console.error('Invalid task websocket message.');
        return;
      }
      const taskStore = useTaskStore.getState();
      const originatingRun = findStudioRunContext(message.task_id, message.client_run_id);
      const previousCurrent = taskStore.currentTask;
      const coercedCurrentTask = hasQueueSnapshot ? coerceTask(message.current) : undefined;
      const currentTask = taskWithMatchingMessageMetadata(coercedCurrentTask, message);
      let queuedTasks = hasQueueSnapshot ? coerceTaskRecord(message.queued) : taskStore.queuedTasks;
      if (message.task_id && queuedTasks[message.task_id]) {
        const queuedEventTask = taskWithMatchingMessageMetadata(queuedTasks[message.task_id], message);
        if (queuedEventTask) queuedTasks = { ...queuedTasks, [message.task_id]: queuedEventTask };
      }
      const recentTasks = (message.recent ?? []).flatMap((snapshot) => {
        const task = coerceTask(snapshot);
        return task ? [task] : [];
      });
      const terminalTaskId = message.task_id ?? previousCurrent?.task_id ?? null;
      const eventStatus =
        message.type === 'task_queued'
          ? 'queued'
          : message.type === 'task_started'
            ? 'running'
            : message.type === 'task_completed'
              ? 'completed'
              : 'cancelled';
      const eventSnapshot = message.task_id
        ? [currentTask, queuedTasks[message.task_id], previousCurrent].find((task) => task?.task_id === message.task_id)
        : previousCurrent;
      const eventTask = taskWithMessageMetadata(eventSnapshot, { ...message, status: eventStatus });

      if (message.type === 'task_completed') {
        const completedTask = eventTask ?? taskWithMessageMetadata(undefined, { ...message, status: 'completed' });
        if (completedTask) {
          taskStore.markTaskCompleted(completedTask);
        }
      } else if (message.type === 'task_cancelled') {
        const cancelledTask =
          eventTask ??
          (message.task_id
            ? taskWithMessageMetadata(undefined, {
                ...message,
                status: 'cancelled',
                completed_at: message.completed_at ?? Date.now() / 1000,
              })
            : undefined);
        if (cancelledTask) {
          taskStore.recordTaskSnapshot(cancelledTask, 'cancelled', message.message);
        }
      }

      if (hasQueueSnapshot) {
        useTaskStore.getState().setTasks(currentTask, queuedTasks, recentTasks);
      } else if (message.type === 'task_cancelled') {
        const remainingQueued = { ...queuedTasks };
        if (terminalTaskId) delete remainingQueued[terminalTaskId];
        useTaskStore
          .getState()
          .setTasks(previousCurrent?.task_id === terminalTaskId ? undefined : previousCurrent, remainingQueued);
      }
      if (message.type === 'task_started') {
        if (message.task_id) terminalNodeProgressTaskIds.delete(message.task_id);
        const studio = useStudioStore.getState();
        studio.markRunContextStatus(message.task_id, message.client_run_id, 'running');
        const activatedRun = studio.activateRunContext(message.task_id, message.client_run_id);
        if (activatedRun?.binding) {
          studio.clearChangedPreviewFieldsForRun(activatedRun.runInputHash);
        }
        if (activatedRun || !originatingRun) {
          useFlowStore.getState().resetExecutionProgress();
        }
        if (eventTask) {
          useTaskStore.getState().recordTaskSnapshot(eventTask, 'running', message.message);
        }
      }
      if (message.type === 'task_completed') {
        markNodeProgressTaskTerminal(terminalTaskId);
        useFlowStore.getState().resetExecutionProgress(terminalTaskId);
        useStudioStore.getState().markRunContextStatus(message.task_id, message.client_run_id, 'completed');
        if (message.task_id && (originatingRun || message.workflow_tab_id)) {
          enqueueSnackbar('Generation completed', {
            variant: 'success',
            autoHideDuration: 8000,
            action: {
              type: 'open_task_run',
              taskId: message.task_id,
              clientRunId: message.client_run_id,
              workflowTabId: message.workflow_tab_id || originatingRun?.workflowTabId,
              nodeId: message.node_id || message.node,
              outcome: 'completed',
            },
          });
        }
      } else if (message.type === 'task_cancelled') {
        markNodeProgressTaskTerminal(terminalTaskId);
        useFlowStore.getState().resetExecutionProgress(terminalTaskId);
        useStudioStore.getState().markRunContextStatus(message.task_id, message.client_run_id, 'cancelled');
      }

      if (message.type === 'task_completed' && message.sid === context.sid && message.args) {
        const args = Array.isArray(message.args) && message.args.length > 1 ? message.args[1] : null;
        if (!isTaskCompletionFieldArgs(args)) {
          return;
        }
        if (args.queue && shouldApplyWorkflowCanvasMutation(message, context)) {
          useFlowStore.getState().setParam(args.node, args.key, false, 'disabled');
        }
      }

      break;
    }
    case 'task_failed': {
      if (message.preview_slots && typeof message.preview_state_revision === 'number') {
        useStudioStore.getState().mergePreviewState(message.preview_slots, message.preview_state_revision);
      }
      const originatingRun = findStudioRunContext(message.task_id, message.client_run_id);
      markNodeProgressTaskTerminal(message.task_id);
      useSettingsStore.getState().setRunningState('one_shot');
      if (message.node && shouldAcceptNodeProgress(message)) {
        const flow = useFlowStore.getState();
        const targetNodeId = runtimeProgressTarget(flow.nodes, message.node, message.name);
        if (targetNodeId) {
          flow.updateProgress(targetNodeId, 0, nodeExecutionMetadata(message));
          flow.setNodeUiState(targetNodeId, {
            validationSeverity: 'error',
            validationMessage: message.message || message.error || 'Run failed.',
            errorMessage: message.message || message.error || 'Run failed.',
          });
        }
      }
      const failedTask = taskWithMessageMetadata(undefined, {
        ...message,
        status: 'failed',
        completed_at: message.completed_at ?? Date.now() / 1000,
        error: message.message || message.error || 'Run failed.',
      });
      if (failedTask) useTaskStore.getState().markTaskFailed(failedTask);
      useFlowStore.getState().resetExecutionProgress(message.task_id);
      useStudioStore.getState().markRunContextStatus(message.task_id, message.client_run_id, 'failed');
      useRunIssueStore.getState().reportFailure(
        {
          taskId: message.task_id ?? null,
          clientRunId: message.client_run_id ?? originatingRun?.clientRunId ?? null,
          workflowTabId: message.workflow_tab_id ?? originatingRun?.workflowTabId ?? null,
          runInputHash: message.run_input_hash ?? originatingRun?.runInputHash ?? null,
          nodeId: message.node ?? null,
          nodeName: message.node_name ?? null,
          message: message.message || message.error || 'Run failed.',
          exceptionType: message.exception_type ?? null,
          category: message.category ?? null,
          errorCode: message.error_code ?? null,
          recoveryHint: message.recovery_hint ?? null,
          traceback: message.traceback ?? null,
          oom: Boolean(message.oom),
          memorySummary: message.memory_summary ?? null,
          cudaMemorySnapshot: message.cuda_memory_snapshot ?? null,
          gpuProcesses: message.gpu_processes ?? null,
          runtimeHints: message.runtime_hints ?? null,
          runtimeBudget: message.runtime_budget ?? null,
          loaderDiagnostics: message.loader_diagnostics ?? null,
        },
        false,
      );
      if (message.task_id) {
        enqueueSnackbar(message.message || message.error || 'Generation failed', {
          variant: 'error',
          persist: true,
          action: {
            type: 'open_task_run',
            taskId: message.task_id,
            clientRunId: message.client_run_id,
            workflowTabId: message.workflow_tab_id || originatingRun?.workflowTabId,
            nodeId: message.node_id || message.node,
            outcome: 'failed',
          },
        });
      }
      useStudioStore.getState().clearPreviewFieldsForFailedRun(message.task_id, message.client_run_id);
      if (message.queued || message.current !== undefined) {
        const recentTasks = (message.recent ?? []).flatMap((snapshot) => {
          const task = coerceTask(snapshot);
          return task ? [task] : [];
        });
        const currentTask = coerceTask(message.current);
        useTaskStore
          .getState()
          .setTasks(
            taskWithMatchingMessageMetadata(currentTask, message),
            coerceTaskRecord(message.queued),
            recentTasks,
          );
      }
      break;
    }
    case 'task_progress':
      if (!message.task_id || typeof message.progress !== 'number') {
        console.error('Invalid websocket message: task_progress without task_id or progress');
        return;
      }
      useTaskStore.getState().updateProgress(message.task_id, message.progress ?? 0, message.message, {
        client_run_id: message.client_run_id,
        run_input_hash: message.run_input_hash,
        workflow_tab_id: message.workflow_tab_id,
        node_id: message.node_id,
        current_node: message.current_node ?? message.node,
        current_node_name: message.current_node_name ?? message.node_name,
        node_progress: message.node_progress,
        attempt_index: message.attempt_index,
        phase: message.phase,
        current_step: message.current_step ?? undefined,
        total_steps: message.total_steps ?? undefined,
        component: message.component ?? undefined,
        shard_current: message.shard_current ?? undefined,
        shard_total: message.shard_total ?? undefined,
        eta_seconds: message.eta_seconds ?? undefined,
        average_step_seconds: message.average_step_seconds ?? undefined,
        elapsed_seconds: message.elapsed_seconds ?? undefined,
        last_heartbeat_at: message.last_heartbeat_at,
        resource_snapshot: message.resource_snapshot ?? undefined,
        phase_timings: message.phase_timings,
        updated_at: message.updated_at,
      });
      break;
    case 'node_definition': {
      if (!message.node || !message.params) {
        console.error('Invalid websocket message: node_definition without node');
        return;
      }
      if (!shouldApplyWorkflowCanvasMutation(message, context)) return;

      const node = useFlowStore.getState().nodes.find((n) => n.id === message.node);
      if (!node) {
        console.warn('The node is no longer in the graph');
        return;
      }
      const nodeId = node.data.module + '.' + node.data.action;
      const defaultDef = useNodesStore.getState().nodesRegistry[nodeId];
      if (!defaultDef) {
        console.warn('The node is no longer in the node registry');
        return;
      }

      const schemaPending = markStudioGraphDefinitionPending(node.id);

      const definitionParams = message.params as Record<string, NodeParams>;
      Object.values(definitionParams).forEach((param) => {
        param.value = param.value ?? param.default;
      });

      const newParams = { ...defaultDef.params, ...definitionParams };
      if (node.data.huggingFaceClusterRole === 'execution') {
        // A reviewed Cluster admission owns an exact, already-finalized edge
        // schema. Late dynamic-definition responses can be older than that
        // receipt and omit handles that are still required by the immutable
        // graph. Retain only connected or explicitly bound Cluster fields;
        // ordinary unowned dynamic fields continue to follow the backend's
        // latest definition exactly.
        const ownedFields = new Set(
          useFlowStore
            .getState()
            .edges.flatMap((edge) => [
              ...(edge.source === node.id && edge.sourceHandle ? [edge.sourceHandle] : []),
              ...(edge.target === node.id && edge.targetHandle ? [edge.targetHandle] : []),
            ]),
        );
        Object.entries(node.data.params).forEach(([key, currentParam]) => {
          if (
            newParams[key] === undefined &&
            (ownedFields.has(key) || currentParam.fieldOptions?.huggingFaceClusterBinding !== undefined)
          ) {
            newParams[key] = currentParam;
          }
        });
      }
      Object.keys(newParams).forEach((key) => {
        const currentParam = node.data.params[key];
        const incomingParam = newParams[key];
        if (currentParam && incomingParam) {
          newParams[key] = preserveCurrentParamValue(currentParam, incomingParam);
        }
      });
      useFlowStore.getState().replaceNodeParams(node.id, newParams);
      const updatedNodes = useFlowStore.getState().nodes.map((n) =>
        n.id !== node.id
          ? n
          : {
              ...n,
              data: {
                ...n.data,
                label: message.label || n.data.label,
                headerColor: message.style?.headerColor || n.data.headerColor,
              },
            },
      );
      useFlowStore.setState({ nodes: updatedNodes });
      if (schemaPending) scheduleStudioDefinitionSync();
      break;
    }
    case 'set_field_visibility': {
      if (!message.node || !message.fields) {
        console.error('Invalid websocket message: set_field_visibility without node or fields');
        return;
      }
      if (!shouldApplyWorkflowCanvasMutation(message, context)) return;
      const nodeId = message.node;
      const visibility = message.fields as Record<string, boolean>;
      const schemaPending = markStudioGraphDefinitionPending(nodeId, ['hidden']);
      Object.keys(visibility).forEach((key) => {
        useFlowStore.getState().setParam(nodeId, key, !visibility[key], 'hidden');
      });
      if (schemaPending) scheduleStudioDefinitionSync();
      break;
    }
    case 'set_field_value': {
      if (!message.node || !message.fields) {
        console.error('Invalid websocket message: set_field_value without node or fields');
        return;
      }
      if (!shouldApplyWorkflowCanvasMutation(message, context)) return;
      const nodeId = message.node;
      const values = message.fields;
      Object.keys(values).forEach((key) => {
        useFlowStore.getState().setParam(nodeId, key, values[key], 'value');
      });
      break;
    }
    case 'set_field_params': {
      if (!message.node || !message.field || !message.params) {
        console.error('Invalid websocket message: set_field_params without node, field or params');
        return;
      }
      if (!shouldApplyWorkflowCanvasMutation(message, context)) return;
      const nodeId = message.node;
      const field = message.field;
      const params = message.params;
      const workflowContext = captureWorkflowOperationContext();
      const schemaPending = markStudioGraphDefinitionPending(nodeId, Object.keys(params) as Array<keyof NodeParams>);

      useFlowStore.getState().setParam(nodeId, field, true, 'disabled');
      Object.keys(params).forEach((key) => {
        const currValue = useFlowStore.getState().getParam(nodeId, field, key as keyof NodeParams);
        const newValue = params[key];
        const updatedValue = (() => {
          if (currValue === undefined || currValue === null) {
            return newValue;
          }

          if (isPlainRecord(currValue) && isPlainRecord(newValue)) {
            return { ...currValue, ...newValue };
          }

          return newValue;
        })();

        useFlowStore.getState().setParam(nodeId, field, updatedValue, key as keyof NodeParams);
      });
      const signalChanged = params.signal !== undefined;
      queueMicrotask(() => {
        if (!workflowOperationContextIsCurrent(workflowContext, { includeForm: false })) return;
        const flow = useFlowStore.getState();
        flow.setParam(nodeId, field, false, 'disabled');
        if (signalChanged) flow.updateSignalValues(flow.edges);
      });
      if (schemaPending) scheduleStudioDefinitionSync();

      break;
    }
    case 'hf_cache_update':
      useNodesStore.getState().fetchHfCache();
      console.info('HF cache updated');
      break;
    case 'hf_download_progress':
      useNodesStore.getState().setHfDownloadProgress(message);
      if ((message.progress ?? 0) >= 1 || message.status === 'complete') {
        useNodesStore.getState().refreshModelIndexes(true);
      }
      console.info('HF download progress', message.repo_id, message.status, message.progress, message.downloaded_bytes);
      break;
    case 'local_cache_update':
      useNodesStore.getState().fetchLocalModels();
      console.info('Local cache updated');
      break;
    case 'get_signal_value': {
      if (!message.node || !message.field || !message.request_id || !message.sid) {
        console.error('Invalid websocket message: get_signal_value without node, field or request_id');
        return;
      }
      if (message.sid !== context.sid) {
        console.warn('Websocket sid mismatch for get_signal_value');
        return;
      }
      const signalValue = useFlowStore.getState().getSignalValue(message.node, message.field);
      if (context.ws.readyState === WebSocket.OPEN) {
        context.ws.send(
          JSON.stringify({
            type: 'signal_value',
            request_id: message.request_id,
            value: signalValue,
            sid: context.getSid(),
          }),
        );
      } else {
        console.error('Websocket is not ready, cannot send signal value');
      }
      break;
    }
    case 'notification': {
      if (!message.message) {
        console.error('Invalid websocket message: notification without message');
        return;
      }
      const variant = message.variant || 'default';
      const persist = message.persist || false;
      const autoHideDuration = !persist
        ? message.autoHideDuration || Math.max(message.message.length * 80, 3000)
        : undefined;

      const action =
        message.action?.type === 'open_task_run' &&
        typeof message.action.taskId === 'string' &&
        (message.action.outcome === 'completed' || message.action.outcome === 'failed')
          ? message.action
          : undefined;
      enqueueSnackbar(message.message, { variant, autoHideDuration, persist, action });
      break;
    }
    default:
      assertNeverMessage(message);
  }
}
