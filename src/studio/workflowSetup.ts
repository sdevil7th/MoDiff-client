import config from '../../app.config';
import { requestJson } from '../utils/requestJson';
import { useFlowStore, flowExecutionScopeSourceKey, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import {
  captureWorkflowOperationContext,
  assertWorkflowOperationContext,
  useStudioStore,
} from '../stores/useStudioStore';
import { prepareExecutionScope, executionScopeIncludesRoot } from '../workflow/prepareExecutionScope';
import { collectNodeModelReferences } from './runReadiness';
import { getGraphWorkflowArtifactRequirements } from './artifactRequirements';
import { parseOptionalRuntimeRequirement, type OptionalRuntimeRequirement } from './optionalRuntimes';
import type { ApiGraphExport } from '../types/api';
import type { HfDownloadProgress } from '../stores/useNodeStore';
import type { WorkflowArtifactRequirement } from './artifactRequirements';
import { isHfDownloadActive } from './modelInstall';

export function workflowSetupDownload(requirement: WorkflowArtifactRequirement, progress?: HfDownloadProgress) {
  // The public job reports a revision and file count, not exact requested files.
  // A count cannot prove file identity. Keep the durable job in Downloads and
  // prevent a second mutation instead of labelling it this row's progress.
  const matches = progress && !requirement.files?.length && (requirement.revision ?? '') === (progress.revision ?? '');
  return {
    progress: matches ? progress : undefined,
    blocked: Boolean(progress && isHfDownloadActive(progress) && !matches),
  };
}

export type WorkflowSetupRuntime = { nodeIds: string[]; requirement: OptionalRuntimeRequirement };
export type WorkflowSetupObservation = {
  schemaVersion: 1;
  instance: string;
  graphHash: string;
  requirements: WorkflowSetupRuntime[];
};
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function parseWorkflowSetup(value: unknown): WorkflowSetupObservation {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.instance !== 'string' ||
    !value.instance ||
    value.instance.length > 256 ||
    typeof value.graphHash !== 'string' ||
    !/^sha256:workflow-auto-v1:[a-f0-9]{64}$/u.test(value.graphHash) ||
    !Array.isArray(value.requirements) ||
    value.requirements.length > 2048
  )
    throw new Error('The workflow setup response is invalid. Refresh its status.');
  const seen = new Set<string>();
  const requirements = value.requirements.map((row): WorkflowSetupRuntime => {
    if (
      !record(row) ||
      !Array.isArray(row.nodeIds) ||
      !row.nodeIds.length ||
      row.nodeIds.length > 2048 ||
      !row.nodeIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 1024)
    )
      throw new Error('The workflow setup scope is invalid. Refresh its status.');
    for (const id of row.nodeIds as string[]) {
      if (seen.has(id) || seen.size >= 2048) throw new Error('The workflow setup scope is duplicated or too large.');
      seen.add(id);
    }
    return { nodeIds: row.nodeIds as string[], requirement: parseOptionalRuntimeRequirement(row.requirement) };
  });
  return { schemaVersion: 1, instance: value.instance, graphHash: value.graphHash, requirements };
}

/** Ordinary Run export/lowering, without authoring, randomized seeds or submission. */
export async function inspectWorkflowSetup(targetNodeId?: string, signal?: AbortSignal) {
  const context = captureWorkflowOperationContext();
  const sourceKey = flowExecutionScopeSourceKey(useFlowStore.getState().nodes, useFlowStore.getState().edges);
  const check = () => {
    signal?.throwIfAborted();
    assertWorkflowOperationContext(context);
    if (sourceKey !== flowExecutionScopeSourceKey(useFlowStore.getState().nodes, useFlowStore.getState().edges))
      throw new Error('The workflow changed. Refresh setup for its current settings.');
  };
  const pending = prepareExecutionScope({ targetNodeId, workflowContext: context, signal });
  const executionScope = pending ? await pending : undefined;
  check();
  const flow = useFlowStore.getState();
  const sourceGraph =
    useStudioStore.getState().form.resourceMode === 'auto'
      ? (await import('./legacyBlockMovementV2')).prepareLegacyGraphForAutoV2(flow.nodes, flow.edges, targetNodeId)
      : undefined;
  check();
  let graph = flow.exportGraph(
    '',
    targetNodeId && sourceGraph ? (sourceGraph.remapped.get(targetNodeId) ?? targetNodeId) : targetNodeId,
    { randomizeSeeds: false, executionScope, ...(sourceGraph ? { sourceGraph } : {}) },
  );
  const scopedNodes = (sourceGraph?.nodes ?? flow.nodes).filter((node) =>
    executionScopeIncludesRoot(executionScope, node.id),
  );
  if (
    scopedNodes.some((node) =>
      node.data.blockInstanceV2?.effectiveGraph.nodes.some(
        (child) => child.modularDiffusers?.kind === 'upstream_block',
      ),
    )
  ) {
    const lower = await (await import('./modularComposition')).prepareModularCompositionExecutionV2(flow, scopedNodes);
    check();
    graph = lower(graph);
  }
  const observation = await requestJson(`${config.serverAddress}/runtime/workflow-setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    timeoutMs: 30_000,
    body: JSON.stringify({
      schemaVersion: 1,
      graph: { nodes: graph.nodes, paths: graph.paths, ...(graph.loops ? { loops: graph.loops } : {}) },
    }),
    parse: parseWorkflowSetup,
  });
  check();
  const ids = observation.requirements.flatMap((row) => row.nodeIds);
  if (
    ids.length !== Object.keys(graph.nodes).length ||
    ids.some((id) => !Object.prototype.hasOwnProperty.call(graph.nodes, id)) ||
    observation.instance !== useNodesStore.getState().instance
  )
    throw new Error('The backend or execution scope changed. Refresh setup before taking action.');
  return { graph, observation, assertCurrent: check };
}

/** Read the actual lowered node parameters, never another branch's saved draft. */
export function workflowSetupArtifacts(graph: ApiGraphExport) {
  const store = useNodesStore.getState();
  const nodes = Object.entries(graph.nodes).map(([id, node]): CustomNodeType => ({
    id,
    position: { x: 0, y: 0 },
    type: 'custom',
    data: {
      type: 'custom',
      module: node.module,
      action: node.action,
      category: '',
      label: useFlowStore.getState().nodes.find((item) => item.id === id)?.data.label ?? node.action,
      params: Object.fromEntries(
        Object.entries(node.params)
          .filter(([, param]) => !param.sourceId)
          .map(([key, param]) => [
            key,
            {
              ...store.nodesRegistry[`${node.module}.${node.action}`]?.params[key],
              // The concrete export owns the value. A registry default cannot fill a connected input.
              value: param.value,
              default: undefined,
            },
          ]),
      ),
    },
  }));
  return getGraphWorkflowArtifactRequirements({
    references: nodes.flatMap((node) =>
      collectNodeModelReferences(node).map((reference) => ({
        ...reference,
        nodeId: node.id,
        nodeLabel: node.data.label,
        ...(typeof node.data.params.revision?.value === 'string' &&
        /^[a-f0-9]{40}$/u.test(node.data.params.revision.value)
          ? { revision: node.data.params.revision.value }
          : {}),
      })),
    ),
    nodes,
    workflowModelDescriptors: store.workflowModelDescriptors,
    hfCache: store.hfCache,
    localModels: store.localModels,
    modelCacheDiagnostics: store.modelCacheDiagnostics,
  });
}
