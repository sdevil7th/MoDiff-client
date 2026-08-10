import { useMemo } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useTaskStore } from '../stores/useTaskStore';
import { buildRunReadinessDecision, collectRunReadinessIssues } from './runReadiness';
import type { RunReadinessIssue } from './types';

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
  const flowFingerprint = useFlowStore((state) =>
    [
      state.nodes
        .map((node) => {
          const modelParams = Object.entries(node.data.params)
            .filter(([key]) => /repo|model|checkpoint|ckpt|safetensors|lora|vae|controlnet|adapter/i.test(key))
            .map(([key, param]) => `${key}:${JSON.stringify(param.value ?? param.default ?? '')}`)
            .join(',');
          return `${node.id}:${node.data.module}:${node.data.action}:${node.data.uiState?.disabled ? 'disabled' : 'enabled'}:${modelParams}`;
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
  const isPreparing =
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
  const currentTaskFingerprint = useTaskStore((state) => {
    const task = state.currentTask;
    return task
      ? `${task.task_id ?? ''}:${task.status ?? 'running'}:${task.workflow_tab_id ?? ''}:${task.updated_at ?? ''}`
      : 'idle';
  });
  const nodesRegistry = useNodesStore((state) => state.nodesRegistry);
  const issues = useMemo(() => {
    // A template graph is assembled, finalized, and laid out as one atomic
    // transition. Do not classify its intentionally incomplete hidden states.
    if (isPreparing) return [];
    return collectRunReadinessIssues({ sid, isConnected, includeStudio });
    // The collector reads stores imperatively; selected snapshots below are intentional invalidation signals.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoResourcePlan,
    currentTaskFingerprint,
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
    nodesRegistry,
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
  };
}
