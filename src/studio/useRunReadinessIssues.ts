import { useEffect, useMemo, useState } from 'react';
import { flowExecutionScopeSourceKey, useFlowStore } from '../stores/useFlowStore';
import {
  hasAncillaryExecutionClaim,
  prepareExecutionScope,
  type PreparedExecutionScope,
} from '../workflow/prepareExecutionScope';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { buildRunReadinessDecision, collectRunReadinessIssues, runReadinessTaskFingerprint } from './runReadiness';
import type { RunReadinessIssue } from './types';

type ScopeRequest = { key: string; registry: object; contracts: object };
type ScopeResult = { request: ScopeRequest; scope?: PreparedExecutionScope; error?: string };
let displayScope:
  | {
      request: ScopeRequest;
      controller: AbortController;
      promise: Promise<PreparedExecutionScope | undefined>;
      users: number;
    }
  | undefined;

// Readiness consumers share only a display witness. Run still resolves its own
// fresh declaration, and synchronous export retains its strict scope boundary.
function retainDisplayScope(request: ScopeRequest) {
  if (
    !displayScope ||
    displayScope.controller.signal.aborted ||
    displayScope.request.key !== request.key ||
    displayScope.request.registry !== request.registry ||
    displayScope.request.contracts !== request.contracts
  ) {
    const controller = new AbortController();
    displayScope = {
      request,
      controller,
      users: 0,
      // Geometry is part of the strict export key. Coalesce a drag/resize burst
      // before requesting metadata; an obsolete timer cannot start a request.
      promise: new Promise<void>((resolve) => setTimeout(resolve, 75)).then(() => {
        controller.signal.throwIfAborted();
        return prepareExecutionScope({ signal: controller.signal });
      }),
    };
  }
  const current = displayScope;
  current.users++;
  return {
    promise: current.promise,
    release: () => {
      current.users--;
      queueMicrotask(() => {
        if (current.users === 0) {
          current.controller.abort();
          if (displayScope === current) displayScope = undefined;
        }
      });
    },
  };
}

const blockValueFingerprints = new WeakMap<object, string>();
function blockValuesFingerprint(values: object | undefined) {
  if (!values) return '';
  let fingerprint = blockValueFingerprints.get(values);
  if (fingerprint === undefined) {
    fingerprint = JSON.stringify(values);
    blockValueFingerprints.set(values, fingerprint);
  }
  return fingerprint;
}

type RunReadinessOptions = {
  sid?: string | null;
  isConnected: boolean;
  includeStudio?: boolean;
};

export type RunReadinessSummaryTone = 'success' | 'warning' | 'error' | 'info';

export function summarizeRunReadinessIssues(issues: RunReadinessIssue[]) {
  const decision = buildRunReadinessDecision(issues);
  const { blockingIssues, warningIssues, primaryIssue } = decision;
  const infoIssues = issues.filter((item) => !item.blocking && item.severity === 'info');
  const tone: RunReadinessSummaryTone =
    decision.state === 'blocked'
      ? 'error'
      : decision.state === 'ready_with_warnings'
        ? 'warning'
        : infoIssues.length > 0
          ? 'info'
          : 'success';

  return {
    tone,
    title: decision.title,
    message: decision.message,
    details: primaryIssue?.details,
    primaryIssue,
    issueCount: issues.length,
    blockingCount: blockingIssues.length,
    warningCount: warningIssues.length,
    infoCount: infoIssues.length,
  };
}

export function useRunReadinessIssues({ sid, isConnected, includeStudio = true }: RunReadinessOptions) {
  const ancillarySource = useFlowStore((state) => {
    try {
      return hasAncillaryExecutionClaim(state.nodes)
        ? flowExecutionScopeSourceKey(state.nodes, state.edges)
        : undefined;
    } catch (error) {
      // Imported advisory hints are untrusted. Keep malformed presence blocked
      // without throwing from a render-time store selector or fetching metadata.
      return `invalid:${error instanceof Error ? error.message : String(error)}`;
    }
  });
  const ancillarySourceError = ancillarySource?.startsWith('invalid:') ? ancillarySource.slice(8) : undefined;
  const flowFingerprint = useFlowStore((state) =>
    [
      state.nodes
        .map((node) => {
          const modelParams = Object.entries(node.data.params)
            .filter(
              ([key, param]) =>
                param.required ||
                param.isInput ||
                param.display === 'input' ||
                // Optional loader pickers can supply a required downstream media input.
                param.display === 'filebrowser' ||
                key === 'operation' ||
                key === 'pipeline_class' ||
                /repo|model|checkpoint|ckpt|safetensors|lora|vae|controlnet|adapter/i.test(key),
            )
            .map(([key, param]) => `${key}:${JSON.stringify(param.value ?? param.default ?? '')}`)
            .join(',');
          const instance = node.data.blockInstanceV2;
          return `${node.id}:${node.hidden ? 'hidden' : 'visible'}:${node.data.module}:${node.data.action}:${node.data.uiState?.disabled ? 'disabled' : 'enabled'}:${modelParams}:${instance?.effectiveGraph.graphHash ?? ''}:${instance?.effectiveInterface.effectiveInterfaceHash ?? ''}:${blockValuesFingerprint(instance?.values)}`;
        })
        .join('|'),
      state.edges
        .map(
          (edge) => `${edge.id}:${edge.source}:${edge.sourceHandle ?? ''}->${edge.target}:${edge.targetHandle ?? ''}`,
        )
        .join('|'),
    ].join('||'),
  );
  const form = useStudioStore((state) => state.form);
  const graphBinding = useStudioStore((state) => state.graphBinding);
  const graphFinalization = useStudioStore((state) => state.graphFinalization);
  const canvasTransition = useStudioStore((state) => state.canvasTransition);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const failure = useRunIssueStore((state) => state.failure);
  const currentRunContext = useStudioStore((state) => state.currentRunContext);
  const failureRunContext = useStudioStore((state) =>
    failure?.taskId
      ? state.runContextsByTaskId[failure.taskId]
      : failure?.clientRunId
        ? state.runContextsByClientRunId[failure.clientRunId]
        : null,
  );
  const isGraphPreparing =
    canvasTransition?.type === 'template_graph_building' && canvasTransition.workflowTabId === activeWorkflowTabId;
  const autoResourcePlan = useStudioStore((state) => state.autoResourcePlan);
  const hfCache = useNodesStore((state) => state.hfCache);
  const localModels = useNodesStore((state) => state.localModels);
  const modelCacheDiagnostics = useNodesStore((state) => state.modelCacheDiagnostics);
  const studioModelCapabilities = useNodesStore((state) => state.studioModelCapabilities);
  const studioModelCapabilitiesAuthoritative = useNodesStore((state) => state.studioModelCapabilitiesAuthoritative);
  const optionalRuntimeCatalog = useNodesStore((state) => state.optionalRuntimeCatalog);
  const discoveryRequests = useNodesStore((state) => state.discoveryRequests);
  const runtimeStatus = useNodesStore((state) => state.runtimeStatus);
  const runtimeResources = useNodesStore((state) => state.runtimeResources);
  const queueRevision = useTaskStore((state) => state.queueRevision);
  const currentTaskFingerprint = useTaskStore((state) => runReadinessTaskFingerprint(state.currentTask));
  const nodesRegistry = useNodesStore((state) => state.nodesRegistry);
  const operationContracts = useNodesStore((state) => state.operationContracts);
  const canvasEpoch = useStudioStore((state) => state.workflowCanvasEpoch);
  const formEpoch = useStudioStore((state) => state.workflowFormEpoch);
  const scopeRequest = useMemo(
    () =>
      ancillarySource && !ancillarySourceError && isConnected && sid && !isGraphPreparing
        ? {
            key: JSON.stringify([ancillarySource, activeWorkflowTabId, canvasEpoch, formEpoch, sid]),
            registry: nodesRegistry,
            contracts: operationContracts,
          }
        : undefined,
    [
      ancillarySource,
      ancillarySourceError,
      activeWorkflowTabId,
      canvasEpoch,
      formEpoch,
      sid,
      isConnected,
      isGraphPreparing,
      nodesRegistry,
      operationContracts,
    ],
  );
  const [scopeResult, setScopeResult] = useState<ScopeResult>();
  useEffect(() => {
    if (!scopeRequest) return;
    let active = true;
    const pending = retainDisplayScope(scopeRequest);
    pending.promise.then(
      (scope) => {
        if (active) setScopeResult({ request: scopeRequest, scope });
      },
      (error) => {
        if (active)
          setScopeResult({ request: scopeRequest, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      active = false;
      pending.release();
    };
  }, [scopeRequest]);
  const currentScope = scopeResult?.request === scopeRequest ? scopeResult : undefined;
  const isPreparing = isGraphPreparing || Boolean(scopeRequest && !currentScope);
  const modularBlockDefinitions = useHuggingFaceNodeLibraryStore((state) => state.library?.blockDefinitions);
  const issues = useMemo(() => {
    // A template graph is assembled, finalized, and laid out as one atomic
    // transition. Do not classify its intentionally incomplete hidden states.
    if (isPreparing) return [];
    if (ancillarySourceError || currentScope?.error)
      return [
        {
          id: 'ancillary-declaration-invalid',
          code: 'ancillary_declaration_invalid',
          category: 'graph',
          severity: 'error',
          blocking: true,
          action: 'inspect_node',
          message:
            'The enhancement declaration could not be verified. Reload capabilities or reopen the workflow to retry.',
          details: ancillarySourceError ?? currentScope?.error,
        } satisfies RunReadinessIssue,
      ];
    return collectRunReadinessIssues({ sid, isConnected, includeStudio, executionScope: currentScope?.scope });
    // The collector reads stores imperatively; selected snapshots below are intentional invalidation signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeWorkflowTabId,
    autoResourcePlan,
    currentTaskFingerprint,
    currentRunContext,
    currentScope,
    ancillarySourceError,
    failure,
    failureRunContext,
    discoveryRequests,
    flowFingerprint,
    form,
    graphBinding,
    graphFinalization,
    hfCache,
    includeStudio,
    isConnected,
    isPreparing,
    localModels,
    modelCacheDiagnostics,
    modularBlockDefinitions,
    nodesRegistry,
    operationContracts,
    optionalRuntimeCatalog,
    queueRevision,
    runtimeResources,
    runtimeStatus,
    sid,
    studioModelCapabilities,
    studioModelCapabilitiesAuthoritative,
  ]);
  const decision = useMemo(() => buildRunReadinessDecision(issues, { preparing: isPreparing }), [isPreparing, issues]);

  return {
    ...decision,
    isPreparing,
    operationContracts,
  };
}
