import { enqueueSnackbar } from '../ui/snackbar';
import config from '../../app.config';
import { useFlowStore, type APIGraphExport } from '../stores/useFlowStore';
import type { GraphRunResponse } from '../types/api';
import { formatRequestError, requestJson, RequestError } from './requestJson';

export type RunGraphResponse = GraphRunResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalStringOrNull(value: unknown) {
  return typeof value === 'string' ? value : value === null ? null : undefined;
}

function parseGraphRunResponse(value: unknown): GraphRunResponse {
  if (!isRecord(value)) {
    return { error: true, message: 'MoDiff returned an invalid graph response.' };
  }

  const errorMessage = typeof value.error === 'string' ? value.error : undefined;
  return {
    ...value,
    error: value.error === true || Boolean(errorMessage),
    message: typeof value.message === 'string' ? value.message : errorMessage,
    sid: optionalStringOrNull(value.sid),
    task_id: optionalStringOrNull(value.task_id),
  };
}

export const runGraph = async (
  sid: string,
  targetNodeId?: string,
  preparedGraph?: APIGraphExport,
): Promise<RunGraphResponse> => {
  const graph = preparedGraph ?? useFlowStore.getState().exportGraph(sid, targetNodeId);

  try {
    const data = await requestJson(`${config.serverAddress}/graph`, {
      method: 'POST',
      body: JSON.stringify(graph),
      headers: {
        'Content-Type': 'application/json',
      },
      timeoutMs: 60_000,
      parse: parseGraphRunResponse,
    });
    if (data.error) {
      const message = data.message || 'MoDiff could not queue this graph.';
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: message.length * 80 });
      return data;
    }
    console.info(data.message);
    return data;
  } catch (error) {
    const parsed = error instanceof RequestError ? parseGraphRunResponse(error.payload) : undefined;
    const message = parsed?.message || formatRequestError(error, 'MoDiff could not queue this graph.');
    const err = `Error exporting graph: ${message}`;
    enqueueSnackbar(err, { variant: 'error', autoHideDuration: err.length * 80 });
    console.error(err);
    return { ...parsed, error: true, message: err };
  }
};
