import { nanoid } from 'nanoid';
import { useFlowStore, type APIGraphExport } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { runGraph, type RunGraphResponse } from '../utils/runGraph';
import { applyDeterministicRunMetadata, applyStudioRuntimeHints, getStudioRunInputHash } from './runPreparation';
import type { StudioRunContext } from './types';

type StudioContextOptions = {
  applyRuntimeMetadata?: boolean;
  clearChangedPreviews?: boolean;
  forceDeterministic?: boolean;
  variation?: Pick<StudioRunContext, 'variationGroupId' | 'variationLabel'>;
};

export type CoordinatedGraphRunOptions = {
  sid: string;
  targetNodeId?: string;
  preparedGraph?: APIGraphExport;
  studioContext?: StudioContextOptions;
};

export type CoordinatedGraphRunResult = {
  response: RunGraphResponse;
  submittedGraph: APIGraphExport;
  context?: StudioRunContext;
};

/**
 * Owns submission-time identity and response attachment while leaving HTTP
 * transport in runGraph. Callers retain readiness and UX responsibilities.
 */
export async function coordinateGraphRun({
  sid,
  targetNodeId,
  preparedGraph,
  studioContext,
}: CoordinatedGraphRunOptions): Promise<CoordinatedGraphRunResult> {
  const exportedGraph = preparedGraph ?? useFlowStore.getState().exportGraph(sid, targetNodeId);
  if (!studioContext) {
    return {
      response: await runGraph(sid, targetNodeId, exportedGraph),
      submittedGraph: exportedGraph,
    };
  }

  const preparedStudioGraph =
    studioContext.applyRuntimeMetadata === false
      ? exportedGraph
      : applyDeterministicRunMetadata(exportedGraph, { force: studioContext.forceDeterministic });
  const identity = {
    clientRunId: nanoid(),
    runInputHash: getStudioRunInputHash(useStudioStore.getState().form, preparedStudioGraph),
  };
  const submittedGraph =
    studioContext.applyRuntimeMetadata === false
      ? preparedStudioGraph
      : applyStudioRuntimeHints(preparedStudioGraph, identity);

  if (studioContext.clearChangedPreviews !== false) {
    useStudioStore.getState().clearChangedPreviewFieldsForRun(identity.runInputHash);
  }
  const context = useStudioStore.getState().captureRunContext(submittedGraph, studioContext.variation, identity);
  const response = await runGraph(sid, targetNodeId, submittedGraph);
  useStudioStore.getState().attachRunResponse(response, identity.clientRunId);
  if (response.error) {
    useStudioStore.getState().setLastError(response.message || 'MoDiff could not queue this graph.');
  }

  return { response, submittedGraph, context };
}
