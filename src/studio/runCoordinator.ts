import { nanoid } from 'nanoid';
import { resolveFlowExecutionTargetNodeId, useFlowStore, type APIGraphExport } from '../stores/useFlowStore';
import {
  assertWorkflowOperationContext,
  useStudioStore,
  workflowOperationContextIsCurrent,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { runGraph, type RunGraphResponse } from '../utils/runGraph';
import {
  applyDeterministicRunMetadata,
  applyRunCorrelationHints,
  applyStudioRuntimeHints,
  getStudioRunInputHash,
} from './runPreparation';
import type { StudioRunContext } from './types';
import { applyHuggingFaceClusterRuntimeHints, huggingFaceClusterRunForm } from './huggingFaceClusterRuntime';
import { inspectUserBlockCompositions } from './userBlocks';
import { prepareHuggingFaceClustersForRun } from './huggingFaceClusterPreparation';
import { assertRegisteredBlockAutoAuthoritiesV2 } from './blockExecutionAuthorityV2';
import { prepareRegisteredBlockAutoAuthoritiesV2 } from './blockAutoAuthorityV2';
import { registeredBlockRunFormForFlowV2, userBlockRunFormForFlowV2 } from './blockRunFormV2';
import { inspectRegisteredBlockAutoEligibilityV2 } from './blockAutoEligibilityV2';
import {
  applyRegisteredBlockResourceRouteBindingV2,
  registeredBlockResourceRouteBindingV2,
} from './blockResourceRouteBindingV2';
import { canonicalBlockStringifyV2 } from './blockSchemaV2';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { registeredBlockV2Route } from './registeredBlockV2Routes';
import { applyRegisteredBlockExpertRuntimeHintsV2, registeredBlockExpertRuntimeHintsV2 } from './blockRuntimeHintsV2';
import { useNodesStore } from '../stores/useNodeStore';

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
  let requestedTarget = targetNodeId
    ? useFlowStore.getState().nodes.find((node) => node.id === targetNodeId)
    : undefined;
  const clusterInstanceIds = useFlowStore
    .getState()
    .nodes.filter(
      (node) =>
        node.data.huggingFaceClusterRole === 'root' &&
        !node.data.blockCompilationTransientV2 &&
        node.data.huggingFaceClusterInstance?.execution &&
        (!requestedTarget || node.id === requestedTarget.id),
    )
    .map((node) => node.id);
  // Preserve the synchronous submission-context capture used by ordinary
  // graphs. Cluster preparation is asynchronous only when this run actually
  // contains (or targets) a Cluster root.
  if (clusterInstanceIds.length > 0) {
    if (
      (!studioContext || studioContext.applyRuntimeMetadata === false) &&
      useStudioStore.getState().form.resourceMode === 'auto'
    ) {
      const { prepareHuggingFaceClusterForAuthoring } = await import('./huggingFaceClusterPreparation');
      for (const id of clusterInstanceIds) await prepareHuggingFaceClusterForAuthoring(id);
    } else await prepareHuggingFaceClustersForRun(clusterInstanceIds);
  }
  const manualMode = useStudioStore.getState().form.resourceMode === 'expert';
  const registeredEligibility = inspectRegisteredBlockAutoEligibilityV2(
    useFlowStore.getState().nodes,
    useFlowStore.getState().edges,
    requestedTarget?.data.blockInstanceV2 ? requestedTarget.id : undefined,
  );
  const workflowAuto =
    !manualMode && (!studioContext || studioContext.applyRuntimeMetadata === false) && !registeredEligibility.eligible;
  const registeredInstanceIds = useFlowStore
    .getState()
    .nodes.filter(
      (node) =>
        node.data.blockInstanceV2 &&
        (node.data.blockInstanceV2.definitionSnapshot.source.kind === 'diffusers_catalog' ||
          node.data.blockInstanceV2.definitionSnapshot.source.kind === 'transformers_catalog') &&
        (!requestedTarget || node.id === requestedTarget.id),
    )
    .map((node) => node.id);
  if (!manualMode && !workflowAuto && registeredInstanceIds.length > 0) {
    const eligibility = inspectRegisteredBlockAutoEligibilityV2(
      useFlowStore.getState().nodes,
      useFlowStore.getState().edges,
      requestedTarget?.data.blockInstanceV2 ? requestedTarget.id : undefined,
    );
    if (!eligibility.eligible) throw new Error(eligibility.reason);
    await prepareRegisteredBlockAutoAuthoritiesV2(registeredInstanceIds);
  }
  const currentFlow = useFlowStore.getState();
  const legacyPreparation =
    workflowAuto &&
    currentFlow.nodes.some(
      (node) =>
        !node.data.blockInstanceV2 &&
        (node.data.userBlockSnapshot || node.data.userBlockId || node.data.huggingFaceClusterRole === 'root'),
    )
      ? (await import('./legacyBlockMovementV2')).prepareLegacyGraphForAutoV2(
          currentFlow.nodes,
          currentFlow.edges,
          targetNodeId,
        )
      : undefined;
  if (legacyPreparation && targetNodeId) targetNodeId = legacyPreparation.remapped.get(targetNodeId) ?? targetNodeId;
  const flow = legacyPreparation
    ? {
        ...currentFlow,
        nodes: legacyPreparation.nodes,
        edges: legacyPreparation.edges,
        exportGraph: (sid: string, target?: string) =>
          currentFlow.exportGraph(sid, target, { sourceGraph: legacyPreparation }),
      }
    : currentFlow;
  requestedTarget = targetNodeId ? flow.nodes.find((node) => node.id === targetNodeId) : undefined;
  let lowerModularComposition: ((graph: APIGraphExport) => APIGraphExport) | undefined;
  if (
    flow.nodes.some((node) =>
      node.data.blockInstanceV2?.effectiveGraph.nodes.some(
        (child) => child.modularDiffusers?.kind === 'upstream_block',
      ),
    )
  ) {
    lowerModularComposition = await (
      await import('./modularComposition')
    ).prepareModularCompositionExecutionV2(currentFlow, flow.nodes);
    if (workflowContext) assertWorkflowOperationContext(workflowContext);
  }
  if (!manualMode && !workflowAuto) {
    assertRegisteredBlockAutoAuthoritiesV2(
      requestedTarget?.data.blockInstanceV2 ? flow.nodes.filter((node) => node.id === requestedTarget.id) : flow.nodes,
    );
  }
  const blockScope = Boolean(requestedTarget?.data.blockInstanceV2 || requestedTarget?.data.blockProjectionContainer);
  // Block export already contains every enabled terminal branch in its scope.
  // Sending one preview id would make the backend trim those other branches.
  const executionTargetNodeId = blockScope
    ? undefined
    : resolveFlowExecutionTargetNodeId(flow.nodes, targetNodeId, flow.edges);
  const invalidComposition = inspectUserBlockCompositions(
    {
      // V2 roots use their embedded BlockDefinitionV2 snapshot and are
      // validated by expandBlockGraphV2ForExecution during export. They are
      // not legacy User Nodes and must not be sent through the V1 registry.
      nodes: flow.nodes.filter((node) => node.data.blockInstanceV2 === undefined),
      edges: flow.edges,
    },
    useUserBlockStore.getState().blocks,
  ).find((inspection) => !inspection.report.valid);
  if (invalidComposition) {
    const firstIssue = invalidComposition.report.issues[0];
    throw new Error(
      `User Node "${invalidComposition.label}" cannot run: ${firstIssue?.message ?? 'its internal composition is invalid.'}`,
    );
  }
  useStudioStore.getState().saveActiveWorkflowTab(true);
  const currentFlowGraph = flow.exportGraph(sid, targetNodeId);
  let exportedGraph = lowerModularComposition
    ? lowerModularComposition(preparedGraph ?? currentFlowGraph)
    : (preparedGraph ?? currentFlowGraph);
  if (workflowAuto) {
    exportedGraph = await (
      await import('./workflowAutoExecutionV2')
    ).prepareWorkflowAutoExecutionV2(exportedGraph, legacyPreparation);
    if (workflowContext) assertWorkflowOperationContext(workflowContext, { includeForm: false });
  }
  // `studioContext` identifies a Studio-owned graph in both Auto and Expert
  // modes. Expert changes admission policy, not provenance: the submitted
  // graph must still carry the exact model/resource choices that the visible
  // Studio graph executes. Raw/imported manual graphs do not pass a Studio
  // context and therefore continue to receive correlation metadata only.
  const managedRun = Boolean(studioContext);
  const preparedGraphForRun =
    !managedRun || studioContext?.applyRuntimeMetadata === false
      ? exportedGraph
      : applyDeterministicRunMetadata(exportedGraph, { force: studioContext?.forceDeterministic });
  const clusterRunForm = huggingFaceClusterRunForm(preparedGraphForRun, { strict: !manualMode && !workflowAuto });
  const blockRunProjection = registeredBlockRunFormForFlowV2(
    flow.nodes,
    requestedTarget?.data.blockInstanceV2 ? requestedTarget.id : undefined,
    manualMode ? 'expert' : 'auto',
    { rejectAmbiguous: !manualMode && !workflowAuto },
  );
  const blockRunForm = blockRunProjection?.form;
  const userBlockRunForm = userBlockRunFormForFlowV2(
    flow.nodes,
    requestedTarget?.data.blockInstanceV2 ? requestedTarget.id : undefined,
  )?.form;
  const exactRunForm = clusterRunForm ?? blockRunForm ?? userBlockRunForm;
  const runForm = exactRunForm ?? useStudioStore.getState().form;
  const routeAdmissions = blockRunProjection
    ? (useHuggingFaceNodeLibraryStore.getState().library?.definitions ?? []).flatMap((definition) =>
        definition.executionAdmissions.flatMap((admission) =>
          registeredBlockV2Route(definition, admission) === blockRunProjection.route ? [admission] : [],
        ),
      )
    : [];
  const currentRouteBinding =
    !workflowAuto && blockRunProjection && routeAdmissions.length === 1
      ? await registeredBlockResourceRouteBindingV2(
          blockRunProjection.instance,
          blockRunProjection.route,
          routeAdmissions[0]!.modelDependencies,
        )
      : null;
  const preparedGraphMatchesCurrentFlow =
    preparedGraph === undefined ||
    canonicalBlockStringifyV2({ nodes: preparedGraph.nodes, paths: preparedGraph.paths }) ===
      canonicalBlockStringifyV2({ nodes: currentFlowGraph.nodes, paths: currentFlowGraph.paths });
  const preparedRouteBinding = preparedGraph?.provenance?.registeredBlockV2RouteBinding;
  const preparedBindingMatchesCurrent =
    preparedGraph === undefined ||
    (currentRouteBinding !== null &&
      preparedRouteBinding !== undefined &&
      canonicalBlockStringifyV2(preparedRouteBinding) === canonicalBlockStringifyV2(currentRouteBinding));
  const resourceRouteBinding =
    preparedGraphMatchesCurrentFlow && preparedBindingMatchesCurrent ? currentRouteBinding : null;
  const graphWithResourceRouteBinding = applyRegisteredBlockResourceRouteBindingV2(
    preparedGraphForRun,
    resourceRouteBinding,
  );
  const nodeCapabilities = useNodesStore.getState();
  const registeredBlockRuntimeHints = registeredBlockExpertRuntimeHintsV2(
    !workflowAuto && blockRunProjection && routeAdmissions.length === 1 && resourceRouteBinding
      ? {
          form: blockRunProjection.form,
          instanceLabel: blockRunProjection.instance.definitionSnapshot.displayName,
          route: blockRunProjection.route,
          admission: routeAdmissions[0]!,
          routeBinding: resourceRouteBinding,
        }
      : null,
    nodeCapabilities.studioModelCapabilities,
    {
      authoritative: nodeCapabilities.studioModelCapabilitiesAuthoritative,
      executionSpecInvalid: nodeCapabilities.studioExecutionSpecInvalid,
    },
  );
  const graphWithRegisteredBlockRuntimeHints = applyRegisteredBlockExpertRuntimeHintsV2(
    graphWithResourceRouteBinding,
    registeredBlockRuntimeHints,
    { stripStaleRouteHints: Boolean(blockRunProjection && preparedGraph && !resourceRouteBinding) },
  );
  const identity = {
    clientRunId: nanoid(),
    runInputHash: getStudioRunInputHash(runForm, graphWithRegisteredBlockRuntimeHints),
  };
  const graphWithManagedMetadata =
    managedRun && !blockRunProjection && studioContext?.applyRuntimeMetadata !== false
      ? applyStudioRuntimeHints(graphWithRegisteredBlockRuntimeHints, identity)
      : graphWithRegisteredBlockRuntimeHints;
  const graphWithExecutionAuthority = workflowAuto
    ? {
        ...graphWithManagedMetadata,
        runtimeHints: {
          ...graphWithManagedMetadata.runtimeHints,
          resourceMode: 'auto' as const,
          workflowAutoPlan: exportedGraph.runtimeHints!.workflowAutoPlan,
        },
      }
    : applyHuggingFaceClusterRuntimeHints(graphWithManagedMetadata, { strict: !manualMode });
  const submittedGraph = applyRunCorrelationHints(graphWithExecutionAuthority, identity, {
    targetNodeId: executionTargetNodeId,
    formSnapshot: exactRunForm,
  });

  const context = useStudioStore.getState().captureRunContext(submittedGraph, studioContext?.variation, identity, {
    activate: !deferCanvasOwnership,
    form: exactRunForm,
  });
  if (workflowContext) assertWorkflowOperationContext(workflowContext);
  const response = await runGraph(sid, executionTargetNodeId, submittedGraph);
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
        node_id: executionTargetNodeId,
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
    useRunIssueStore.getState().reportFailure(
      {
        taskId: taskId ?? null,
        clientRunId: identity.clientRunId,
        workflowTabId: context.workflowTabId ?? null,
        runInputHash: identity.runInputHash,
        nodeId: executionTargetNodeId ?? null,
        message: response.message || 'MoDiff could not queue this graph.',
        category: 'submission',
        errorCode: 'graph_submission_failed',
        recoveryHint: 'Review the backend error, edit the manual graph or runtime settings, then run again.',
      },
      true,
    );
  }

  return { response, submittedGraph, context };
}
