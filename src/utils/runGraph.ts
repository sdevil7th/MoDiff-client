// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import {
  assertCurrentExecutionScope,
  assertExecutionScopeSubmission,
  hasAncillaryExecutionClaim,
  prepareExecutionScope,
  type PreparedExecutionScope,
} from '../workflow/prepareExecutionScope';
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
  executionScope?: PreparedExecutionScope,
): Promise<RunGraphResponse> => {
  const flow = useFlowStore.getState();
  if (!executionScope && !preparedGraph) {
    const pending = prepareExecutionScope({ targetNodeId });
    if (pending) executionScope = await pending;
  }
  if (
    (hasAncillaryExecutionClaim(flow.nodes) ||
      Object.prototype.hasOwnProperty.call(preparedGraph?.runtimeHints ?? {}, 'executionPurpose')) &&
    !executionScope
  )
    throw new Error('Resolve a current execution scope before submitting a claimed graph.');
  assertCurrentExecutionScope(executionScope);
  const graph = preparedGraph ?? flow.exportGraph(sid, targetNodeId, { executionScope });
  if (executionScope) assertExecutionScopeSubmission(executionScope, graph);

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
