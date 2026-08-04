import { nanoid } from 'nanoid';
import { useFlowStore, type APIGraphExport } from '../stores/useFlowStore';
import {
  assertWorkflowOperationContext,
  useStudioStore,
  workflowOperationContextIsCurrent,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { runGraph, type RunGraphResponse } from '../utils/runGraph';
import {
  applyDeterministicRunMetadata,
  applyRunCorrelationHints,
  applyStudioRuntimeHints,
  getStudioRunInputHash,
} from './runPreparation';
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
  workflowContext?: WorkflowOperationContext;
  /** Keep the currently executing run as canvas owner until this queued run starts. */
  deferCanvasOwnership?: boolean;
};

export type CoordinatedGraphRunResult = {
  response: RunGraphResponse;
  submittedGraph: APIGraphExport;
  context: StudioRunContext;
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
  workflowContext,
  deferCanvasOwnership = false,
}: CoordinatedGraphRunOptions): Promise<CoordinatedGraphRunResult> {
  if (workflowContext) assertWorkflowOperationContext(workflowContext);
  useStudioStore.getState().saveActiveWorkflowTab(true);
  const exportedGraph = preparedGraph ?? useFlowStore.getState().exportGraph(sid, targetNodeId);
  const managedRun = Boolean(studioContext);
  const preparedGraphForRun =
    !managedRun || studioContext?.applyRuntimeMetadata === false
      ? exportedGraph
      : applyDeterministicRunMetadata(exportedGraph, { force: studioContext?.forceDeterministic });
  const identity = {
    clientRunId: nanoid(),
    runInputHash: getStudioRunInputHash(useStudioStore.getState().form, preparedGraphForRun),
  };
  const graphWithManagedMetadata =
    managedRun && studioContext?.applyRuntimeMetadata !== false
      ? applyStudioRuntimeHints(preparedGraphForRun, identity)
      : preparedGraphForRun;
  const submittedGraph = applyRunCorrelationHints(graphWithManagedMetadata, identity, { targetNodeId });

  const context = useStudioStore
    .getState()
    .captureRunContext(submittedGraph, studioContext?.variation, identity, { activate: !deferCanvasOwnership });
  if (workflowContext) assertWorkflowOperationContext(workflowContext);
  const response = await runGraph(sid, targetNodeId, submittedGraph);
  useStudioStore.getState().attachRunResponse(response, identity.clientRunId);
  const taskId = typeof response.task_id === 'string' && response.task_id.trim() ? response.task_id : undefined;
  if (taskId) {
    const studio = useStudioStore.getState();
    const workflowTab = context.workflowTabId
      ? studio.workflowTabs.find((tab) => tab.id === context.workflowTabId)
      : undefined;
    useTaskStore.getState().recordTaskSnapshot(
      {
        name: typeof response.name === 'string' && response.name ? response.name : 'Graph execution',
        task_id: taskId,
        sid: typeof response.sid === 'string' ? response.sid : sid,
        status: response.error ? 'failed' : 'queued',
        client_run_id: identity.clientRunId,
        run_input_hash: identity.runInputHash,
        workflow_tab_id: context.workflowTabId ?? undefined,
        workflow_title: workflowTab?.title,
        // Model loading can make the worker's HTTP endpoint briefly
        // unresponsive. Keep the immutable submission snapshot in the local
        // activity entry so clicking a running notification can open its graph
        // immediately without depending on a /runs lookup.
        workflow_snapshot: workflowTab?.snapshot,
        node_id: targetNodeId,
      },
      response.error ? 'failed' : 'queued',
      response.message,
    );
  }
  if (response.error) {
    useStudioStore.getState().markRunContextStatus(taskId, identity.clientRunId, 'failed');
    if (!workflowContext || workflowOperationContextIsCurrent(workflowContext, { includeForm: false })) {
      useStudioStore.getState().setLastError(response.message || 'MoDiff could not queue this graph.');
    }
  }

  return { response, submittedGraph, context };
}
