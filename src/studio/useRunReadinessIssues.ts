import { useMemo } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import { collectRunReadinessIssues } from './runReadiness';
import type { RunReadinessIssue } from './types';

type RunReadinessOptions = {
  sid?: string | null;
  isConnected: boolean;
  includeStudio?: boolean;
};

export type RunReadinessSummaryTone = 'success' | 'warning' | 'error' | 'info';

export function summarizeRunReadinessIssues(issues: RunReadinessIssue[]) {
  const blockingIssues = issues.filter((item) => item.blocking);
  const warningIssues = issues.filter((item) => !item.blocking && item.severity === 'warning');
  const infoIssues = issues.filter((item) => !item.blocking && item.severity === 'info');
  const primaryIssue = blockingIssues[0] ?? warningIssues[0] ?? infoIssues[0] ?? issues[0] ?? null;
  const tone: RunReadinessSummaryTone =
    blockingIssues.length > 0
      ? 'error'
      : warningIssues.length > 0
        ? 'warning'
        : infoIssues.length > 0
          ? 'info'
          : 'success';

  return {
    tone,
    title: blockingIssues.length > 0 ? 'Run blocked' : warningIssues.length > 0 ? 'Setup needed' : 'Ready',
    message: primaryIssue?.message ?? 'Ready',
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
  const autoResourcePlan = useStudioStore((state) => state.autoResourcePlan);
  const hfCache = useNodesStore((state) => state.hfCache);
  const localModels = useNodesStore((state) => state.localModels);
  const modelCacheDiagnostics = useNodesStore((state) => state.modelCacheDiagnostics);
  const runtimeStatus = useNodesStore((state) => state.runtimeStatus);
  const nodesRegistry = useNodesStore((state) => state.nodesRegistry);
  const readinessRevision = useMemo(
    () =>
      JSON.stringify({
        autoResourcePlan,
        flowFingerprint,
        form,
        graphBindingFingerprint: graphBinding?.fingerprint,
        graphBindingNodeCount: graphBinding?.managedNodeIds.length ?? 0,
        graphFinalization,
        hfCacheCount: hfCache.length,
        localModelCount: localModels.length,
        modelCacheDiagnostics,
        nodesRegistryKeys: Object.keys(nodesRegistry).sort(),
        runtimeStatus,
      }),
    [
      autoResourcePlan,
      flowFingerprint,
      form,
      graphBinding,
      graphFinalization,
      hfCache.length,
      localModels.length,
      modelCacheDiagnostics,
      nodesRegistry,
      runtimeStatus,
    ],
  );

  const issues = useMemo(() => {
    void readinessRevision;
    return collectRunReadinessIssues({ sid, isConnected, includeStudio });
  }, [includeStudio, isConnected, readinessRevision, sid]);
  const blockingIssues = useMemo(() => issues.filter((item) => item.blocking), [issues]);
  const warningIssues = useMemo(() => issues.filter((item) => !item.blocking && item.severity === 'warning'), [issues]);
  const primaryIssue = blockingIssues[0] ?? warningIssues[0] ?? issues[0] ?? null;

  return {
    issues,
    blockingIssues,
    warningIssues,
    primaryIssue,
    canRun: blockingIssues.length === 0,
  };
}
