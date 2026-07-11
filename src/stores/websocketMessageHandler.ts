import { enqueueSnackbar } from '../ui/snackbar';
import { syncStudioGraphValues } from '../studio/graphBridge';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { ensureStudioAutoPlanReadyForRun } from '../studio/useStudioRunActions';
import { isWebsocketMessage, type WebsocketMessage } from '../types/api';
import { useFlowStore } from './useFlowStore';
import { NodeParams, useNodesStore } from './useNodeStore';
import { useRunIssueStore } from './useRunIssueStore';
import { useSettingsStore } from './useSettingsStore';
import { useStudioStore } from './useStudioStore';
import { coerceTask, coerceTaskRecord, useTaskStore } from './useTaskStore';

export type WebsocketMessageHandlerContext = {
  sid: string | null;
  ws: WebSocket;
  getSid: () => string | null;
  setSid: (sid: string | null) => void;
  setLoopTimer: (timer: NodeJS.Timeout) => void;
};

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

function assertNeverMessage(message: never): never {
  throw new Error(`Unhandled websocket message type: ${JSON.stringify(message)}`);
}

function applyNodeExecutionStatus(message: WebsocketMessage) {
  if (!('node' in message) || !message.node || !('status' in message) || !message.status) return;
  const statusMessage =
    message.status === 'running'
      ? 'Running'
      : message.status === 'cached'
        ? 'Cached result reused'
        : message.status === 'failed'
          ? 'Failed'
          : 'Completed';
  useFlowStore.getState().setNodeUiState(message.node, {
    validationSeverity: message.status === 'failed' ? 'error' : message.status === 'running' ? 'info' : 'success',
    validationMessage: statusMessage,
  });
}

function shouldAcceptNodeProgress(message: WebsocketMessage) {
  if (!('node' in message) || !message.node) return false;
  const taskId = 'task_id' in message ? message.task_id : undefined;
  const clientRunId = 'client_run_id' in message ? message.client_run_id : undefined;
  if ((taskId || clientRunId) && !useStudioStore.getState().shouldApplyRunUpdateToActiveWorkflow(taskId, clientRunId)) {
    return false;
  }
  const currentTaskId = useTaskStore.getState().currentTask?.task_id;
  if (taskId && currentTaskId && taskId !== currentTaskId) return false;
  if (taskId && !currentTaskId && 'status' in message && message.status === 'running') return false;

  const attemptIndex = 'attempt_index' in message ? message.attempt_index : undefined;
  if (typeof attemptIndex === 'number') {
    const node = useFlowStore.getState().nodes.find((item) => item.id === message.node);
    const currentAttempt = node?.data.attemptIndex;
    if (typeof currentAttempt === 'number' && attemptIndex < currentAttempt) return false;
  }
  return true;
}

function nodeExecutionMetadata(message: WebsocketMessage) {
  if (!('node' in message)) return undefined;
  return {
    activeTaskId: 'task_id' in message ? (message.task_id ?? null) : null,
    attemptIndex:
      'attempt_index' in message && typeof message.attempt_index === 'number' ? message.attempt_index : undefined,
    executionStatus: 'status' in message ? message.status : undefined,
    executionPhase: 'phase' in message ? message.phase : undefined,
    progressMessage: 'message' in message ? message.message : undefined,
  };
}

function isGeneratedPreviewUpdate(message: WebsocketMessage) {
  if (!('node' in message) || !message.node || !('key' in message) || !message.key) return false;
  const node = useFlowStore.getState().nodes.find((item) => item.id === message.node);
  const display = node?.data.params?.[message.key]?.display;
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
  return preserved;
}

function scheduleStudioDefinitionSync() {
  if (studioDefinitionSyncTimer) {
    globalThis.clearTimeout(studioDefinitionSyncTimer);
  }
  studioDefinitionSyncTimer = globalThis.setTimeout(() => {
    studioDefinitionSyncTimer = null;
    syncStudioGraphValues();
    useStudioStore.getState().saveActiveWorkflowTab(true);
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
        useNodesStore.getState().fetchNodes();
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
      break;
    }
    case 'executed':
      if (!message.node) {
        console.error('Invalid websocket message: executed without node');
        return;
      }
      if (!shouldAcceptNodeProgress(message)) return;
      applyNodeExecutionStatus(message);
      useFlowStore.getState().updateProgress(message.node, 100, nodeExecutionMetadata(message));
      useFlowStore
        .getState()
        .setNodeCached(
          message.node,
          true,
          message.hasChanged ? message.memoryUsage : undefined,
          message.hasChanged ? message.executionTime : undefined,
        );
      scheduleNodeProgressClear(message.node, message.task_id, message.attempt_index);
      break;
    case 'graph_completed': {
      console.info('Graph completed in', message.executionTime, 'ms');
      useStudioStore.getState().markRunContextStatus(message.task_id, message.client_run_id, 'completed');
      if (message.runtimeFingerprint) {
        console.info('Graph runtime fingerprint', message.runtimeFingerprint);
      }
      useFlowStore.getState().lastExecutionTime = message.executionTime ?? 0;
      const runningState = useSettingsStore.getState().runningState;
      const taskCount = useTaskStore.getState().taskCount;

      if (runningState === 'loop' && context.sid !== null && taskCount === 1) {
        const loopTimer = setTimeout(() => {
          void (async () => {
            const sid = context.sid;
            if (!sid) return;
            if (useStudioStore.getState().graphBinding) {
              const autoReady = await ensureStudioAutoPlanReadyForRun();
              if (!autoReady) return;
              await coordinateGraphRun({ sid, studioContext: {} });
              return;
            }
            await coordinateGraphRun({ sid });
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
    case 'error':
      console.error('Websocket error', message.error);
      break;
    case 'node_error': {
      if (message.node) {
        if (!shouldAcceptNodeProgress(message)) return;
        applyNodeExecutionStatus(message);
        useFlowStore.getState().updateProgress(message.node, 0, nodeExecutionMetadata(message));
        useFlowStore.getState().setNodeUiState(message.node, {
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
      if (generatedPreviewUpdate && !studio.shouldAcceptRunOutputUpdate(message.task_id, message.client_run_id)) {
        return;
      }
      const value = message.value ?? null;
      const correlatedRunUpdate = Boolean(message.task_id || message.client_run_id);
      if (!correlatedRunUpdate || studio.shouldApplyRunUpdateToActiveWorkflow(message.task_id, message.client_run_id)) {
        useFlowStore.getState().setParam(message.node, message.key, value);
        useFlowStore.getState().setParam(message.node, message.key, message.artifacts, 'artifacts');
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
        });
      }
      break;
    }
    case 'progress':
      if (!message.node) {
        console.error('Invalid websocket message: progress without node');
        return;
      }
      if (!shouldAcceptNodeProgress(message)) return;
      applyNodeExecutionStatus(message);
      useFlowStore.getState().updateProgress(message.node, message.progress ?? 0, nodeExecutionMetadata(message));
      if (message.task_id) {
        const currentTask = useTaskStore.getState().currentTask;
        const overallProgress = message.overall_progress ?? currentTask?.progress;
        if (typeof overallProgress === 'number') {
          useTaskStore.getState().updateProgress(message.task_id, overallProgress, message.message, {
            node_progress: message.progress,
            current_node: message.node,
            phase: message.phase,
            current_step: message.current_step,
            total_steps: message.total_steps,
            elapsed_seconds: message.elapsed_seconds,
            average_step_seconds: message.average_step_seconds,
            eta_seconds: message.eta_seconds,
            updated_at: message.updated_at,
          });
        } else if (message.message) {
          useTaskStore.getState().recordTaskSnapshot(
            {
              ...(currentTask ?? {}),
              task_id: message.task_id,
              name: currentTask?.name || message.task_id,
              message: message.message,
              status: 'running',
            },
            'running',
            message.message,
          );
        }
      }
      break;
    case 'task_queued':
    case 'task_cancelled':
    case 'task_started':
    case 'task_completed': {
      if (!message.queued && !message.current) {
        console.error('Invalid task websocket message.');
        return;
      }
      const taskStore = useTaskStore.getState();
      const previousCurrent = taskStore.currentTask;
      const currentTask = coerceTask(message.current);
      const queuedTasks = coerceTaskRecord(message.queued);

      if (message.type === 'task_completed') {
        const completedTask =
          currentTask ??
          (message.task_id
            ? {
                task_id: message.task_id,
                sid: message.sid ?? undefined,
                name: message.name || previousCurrent?.name || 'Graph execution',
                status: 'completed' as const,
              }
            : previousCurrent);
        if (completedTask) {
          taskStore.markTaskCompleted(completedTask);
        }
      } else if (message.type === 'task_cancelled') {
        const cancelledTask =
          currentTask ??
          (message.task_id
            ? {
                task_id: message.task_id,
                sid: message.sid ?? undefined,
                name: message.name || 'Graph execution',
                status: 'cancelled' as const,
                completed_at: Date.now() / 1000,
              }
            : undefined);
        if (cancelledTask) {
          taskStore.recordTaskSnapshot(cancelledTask, 'cancelled', message.message);
        }
      }

      useTaskStore.getState().setTasks(currentTask, queuedTasks);
      if (message.type === 'task_started') {
        useStudioStore.getState().markRunContextStatus(message.task_id, message.client_run_id, 'running');
        useFlowStore.getState().resetExecutionProgress();
        if (currentTask) {
          useTaskStore.getState().recordTaskSnapshot(currentTask, 'running', message.message);
        }
      }
      if (message.type === 'task_completed') {
        useStudioStore.getState().markRunContextStatus(message.task_id, message.client_run_id, 'completed');
      } else if (message.type === 'task_cancelled') {
        useStudioStore.getState().markRunContextStatus(message.task_id, message.client_run_id, 'cancelled');
      }

      if (message.type === 'task_completed' && message.sid === context.sid && message.args) {
        const args = Array.isArray(message.args) && message.args.length > 1 ? message.args[1] : null;
        if (!isTaskCompletionFieldArgs(args)) {
          return;
        }
        if (args.queue) {
          useFlowStore.getState().setParam(args.node, args.key, false, 'disabled');
        }
      }

      break;
    }
    case 'task_failed': {
      useSettingsStore.getState().setRunningState('one_shot');
      if (message.node && shouldAcceptNodeProgress(message)) {
        useFlowStore.getState().updateProgress(message.node, 0, nodeExecutionMetadata(message));
        useFlowStore.getState().setNodeUiState(message.node, {
          validationSeverity: 'error',
          validationMessage: message.message || message.error || 'Run failed.',
          errorMessage: message.message || message.error || 'Run failed.',
        });
      }
      useTaskStore.getState().markTaskFailed({
        task_id: message.task_id,
        sid: message.sid ?? undefined,
        name: message.name || 'Graph execution',
        error: message.message || message.error || 'Run failed.',
        status: 'failed',
      });
      useStudioStore.getState().markRunContextStatus(message.task_id, message.client_run_id, 'failed');
      useRunIssueStore.getState().reportFailure({
        taskId: message.task_id ?? null,
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
      });
      useStudioStore.getState().clearPreviewFieldsForFailedRun(message.task_id, message.client_run_id);
      if (message.queued || message.current !== undefined) {
        useTaskStore.getState().setTasks(coerceTask(message.current), coerceTaskRecord(message.queued));
      }
      break;
    }
    case 'task_progress':
      if (!message.task_id || typeof message.progress !== 'number') {
        console.error('Invalid websocket message: task_progress without task_id or progress');
        return;
      }
      useTaskStore.getState().updateProgress(message.task_id, message.progress ?? 0, message.message);
      break;
    case 'node_definition': {
      if (!message.node || !message.params) {
        console.error('Invalid websocket message: node_definition without node');
        return;
      }

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

      const definitionParams = message.params as Record<string, NodeParams>;
      Object.values(definitionParams).forEach((param) => {
        param.value = param.value ?? param.default;
      });

      const newParams = { ...defaultDef.params, ...definitionParams };
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
      if (node.data.studioOwned) {
        scheduleStudioDefinitionSync();
      }
      break;
    }
    case 'set_field_visibility': {
      if (!message.node || !message.fields) {
        console.error('Invalid websocket message: set_field_visibility without node or fields');
        return;
      }
      const nodeId = message.node;
      const visibility = message.fields as Record<string, boolean>;
      Object.keys(visibility).forEach((key) => {
        useFlowStore.getState().setParam(nodeId, key, !visibility[key], 'hidden');
      });
      break;
    }
    case 'set_field_value': {
      if (!message.node || !message.fields) {
        console.error('Invalid websocket message: set_field_value without node or fields');
        return;
      }
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
      const nodeId = message.node;
      const field = message.field;
      const params = message.params;

      useFlowStore.getState().setParam(nodeId, field, true, 'disabled');
      Object.keys(params).forEach((key) => {
        const currValue = useFlowStore.getState().getParam(nodeId, field, key as keyof NodeParams);
        const newValue = params[key];
        const updatedValue = (() => {
          if (currValue === undefined || currValue === null) {
            return newValue;
          }

          if (typeof currValue === 'object' && typeof newValue === 'object') {
            return { ...currValue, ...newValue };
          }

          return newValue;
        })();

        useFlowStore.getState().setParam(nodeId, field, updatedValue, key as keyof NodeParams);
      });
      queueMicrotask(() => {
        useFlowStore.getState().setParam(nodeId, field, false, 'disabled');
      });

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

      enqueueSnackbar(message.message, { variant, autoHideDuration, persist });
      break;
    }
    default:
      assertNeverMessage(message);
  }
}
