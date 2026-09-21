import type { Edge } from '@xyflow/react';
import config from '../../app.config';
import { useFlowStore, type APIGraphExport, type CustomNodeType } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useRunIssueStore } from '../stores/useRunIssueStore';
import { formatRequestError, requestJson } from '../utils/requestJson';
import { canonicalBlockStringifyV2, type BlockInstanceV2 } from './blockSchemaV2';
import {
  blockProjectionNodeIdV2,
  createBlockRootNodeV2,
  materializeBlockProjectionV2,
  replaceBlockEffectiveGraphV2,
} from './blockRuntimeV2';

export type WorkflowAutoPlanV2 = {
  schemaVersion: 1;
  graphHash: string;
  plannedGraphHash: string;
  canAutoRun: boolean;
  issues: string[];
  message: string;
  patches: { nodeId: string; field: 'offload_mode' | 'auto_offload'; value: string | boolean }[];
  loaders: { nodeId: string; modelType: string; repository: string; consumers: string[]; candidateId: string }[];
  requirements: Record<string, number>;
  available: Record<string, number | null>;
  sharedMemory: boolean;
  requiresPreparation?: boolean;
  preparationNodeIds?: string[];
  schedule?: { releases: { afterNodeId: string; ownerIds: string[] }[] } | null;
};
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export function parseWorkflowAutoPlanV2(value: unknown): WorkflowAutoPlanV2 {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.canAutoRun !== 'boolean' ||
    !strings(value.issues) ||
    typeof value.message !== 'string' ||
    ![value.graphHash, value.plannedGraphHash].every(
      (hash) => typeof hash === 'string' && /^sha256:workflow-auto-v1:[a-f0-9]{64}$/u.test(hash),
    ) ||
    !Array.isArray(value.patches) ||
    !value.patches.every(
      (patch) =>
        record(patch) &&
        typeof patch.nodeId === 'string' &&
        ((patch.field === 'auto_offload' && typeof patch.value === 'boolean') ||
          (patch.field === 'offload_mode' && typeof patch.value === 'string')),
    ) ||
    !Array.isArray(value.loaders) ||
    !value.loaders.every(
      (loader) =>
        record(loader) &&
        ['nodeId', 'modelType', 'repository', 'candidateId'].every((key) => typeof loader[key] === 'string') &&
        strings(loader.consumers),
    ) ||
    !record(value.requirements) ||
    !Object.values(value.requirements).every(
      (item) => typeof item === 'number' && Number.isFinite(item) && item >= 0,
    ) ||
    !record(value.available) ||
    !Object.values(value.available).every(
      (item) => item === null || (typeof item === 'number' && Number.isFinite(item) && item >= 0),
    ) ||
    typeof value.sharedMemory !== 'boolean' ||
    (value.requiresPreparation !== undefined && typeof value.requiresPreparation !== 'boolean') ||
    (value.preparationNodeIds !== undefined && !strings(value.preparationNodeIds)) ||
    (value.canAutoRun && value.issues.length) ||
    (!value.canAutoRun && value.patches.length)
  )
    throw new Error('The backend returned an invalid workflow Auto plan.');
  return value as WorkflowAutoPlanV2;
}

export async function fetchWorkflowAutoPlanV2(graph: APIGraphExport, signal?: AbortSignal) {
  return requestJson(`${config.serverAddress}/auto_resource/workflow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      graph: { nodes: graph.nodes, paths: graph.paths, ...(graph.loops ? { loops: graph.loops } : {}) },
    }),
    timeoutMs: 120_000,
    signal,
    parse: parseWorkflowAutoPlanV2,
  });
}

export async function inspectWorkflowAutoPlanV2(targetNodeId?: string, signal?: AbortSignal) {
  const flow = useFlowStore.getState();
  const { prepareLegacyGraphForAutoV2 } = await import('./legacyBlockMovementV2');
  const prepared = prepareLegacyGraphForAutoV2(flow.nodes, flow.edges, targetNodeId);
  const graph = flow.exportGraph('', targetNodeId ? (prepared.remapped.get(targetNodeId) ?? targetNodeId) : undefined, {
    randomizeSeeds: false,
    sourceGraph: prepared,
  });
  if (
    !prepared.nodes.some((node) =>
      node.data.blockInstanceV2?.effectiveGraph.nodes.some(
        (child) => child.modularDiffusers?.kind === 'upstream_block',
      ),
    )
  )
    return fetchWorkflowAutoPlanV2(graph, signal);
  const lower = await (await import('./modularComposition')).prepareModularCompositionExecutionV2(flow, prepared.nodes);
  return fetchWorkflowAutoPlanV2(lower(graph), signal);
}

function semanticFlowKey() {
  const graph = useFlowStore.getState().toObject();
  return canonicalBlockStringifyV2({
    nodes: graph.nodes.map((node) => ({ id: node.id, data: node.data })),
    edges: graph.edges,
  });
}

/** Inputs and controls share instance-value ownership, including mirrored fields. */
function resourceValueOwners(instance: BlockInstanceV2) {
  const owners = new Map(
    instance.effectiveInterface.controls.map((control) => [
      control.controlId,
      [control.binding, ...(control.mirrorBindings ?? [])],
    ]),
  );
  for (const input of instance.effectiveInterface.boundary.inputs) {
    // A control and input with the same logical id have identical bindings,
    // enforced by the Block schema. Keep one owner and one runtime group.
    if (!owners.has(input.portId))
      owners.set(
        input.portId,
        [input.binding, ...(input.mirrorBindings ?? [])].map(({ nodeId, fieldOrPortId }) => ({
          nodeId,
          fieldId: fieldOrPortId,
        })),
      );
  }
  return [...owners].map(([logicalId, bindings]) => ({ logicalId, bindings }));
}

/** Run-time preparation uses the same exported graph and visible instance values.
 * A workflow receipt is separate from immutable registered-source authority. */
export async function prepareWorkflowAutoExecutionV2(
  graph: APIGraphExport,
  preparedLegacy?: { nodes: CustomNodeType[]; edges: Edge[] },
) {
  const workflowId = useStudioStore.getState().activeWorkflowTabId;
  const beforeKey = semanticFlowKey();
  const isCurrent = () =>
    workflowId === useStudioStore.getState().activeWorkflowTabId &&
    beforeKey === semanticFlowKey() &&
    useStudioStore.getState().form.resourceMode === 'auto';
  let plan: WorkflowAutoPlanV2;
  try {
    plan = await fetchWorkflowAutoPlanV2(graph);
    if (!isCurrent())
      throw new Error('The workflow or mode changed while Auto was planning. Run again with the current graph.');
    if (!plan.canAutoRun) throw new Error(`Auto cannot run this workflow: ${plan.issues.join(' ')}`);
  } catch (error) {
    // Preparation has no task or captured run context. Keep the explanation in
    // the existing blocking dialog without inventing a failed model execution.
    if (isCurrent())
      useRunIssueStore.getState().showIssues([
        {
          id: 'workflow-auto-planning',
          category: 'hardware_fit',
          severity: 'error',
          blocking: true,
          message: formatRequestError(error, 'Workflow memory planning failed.'),
          details:
            'No run was submitted. Review the requirements and model/memory settings, then Run again for a fresh plan.',
        },
      ]);
    throw error;
  }
  const result = applyWorkflowAutoSettingsV2(graph, plan.patches, preparedLegacy);
  const groups = useFlowStore.getState().nodes.flatMap((node) => {
    const instance = node.data.blockInstanceV2;
    return instance
      ? resourceValueOwners(instance).flatMap(({ bindings }) => {
          if (
            bindings.length < 2 ||
            !bindings.every((binding) => binding.fieldId === 'offload_mode' || binding.fieldId === 'auto_offload')
          )
            return [];
          return [
            bindings.map((binding) => ({
              nodeId: blockProjectionNodeIdV2(node.id, binding.nodeId),
              field: binding.fieldId,
            })),
          ];
        })
      : [];
  });
  return {
    ...result,
    runtimeHints: {
      workflowAutoPlan: {
        schemaVersion: 1,
        graphHash: plan.plannedGraphHash,
        ...(groups.length ? { resourceControlGroups: groups } : {}),
      },
      resourceMode: 'auto',
    },
  };
}

export function applyWorkflowAutoSettingsV2(
  graph: APIGraphExport,
  patches: WorkflowAutoPlanV2['patches'],
  preparedLegacy?: { nodes: CustomNodeType[]; edges: Edge[] },
) {
  const result = structuredClone(graph);
  const state = useFlowStore.getState();
  state.beginHistoryTransaction('Apply workflow Auto resource settings');
  try {
    if (preparedLegacy) useFlowStore.setState({ nodes: preparedLegacy.nodes, edges: preparedLegacy.edges });
    const patched = new Set<string>();
    for (const patch of patches) {
      const key = `${patch.nodeId}.${patch.field}`;
      const param = result.nodes[patch.nodeId]?.params[patch.field];
      if (patched.has(key) || !param || param.sourceId)
        throw new Error('The Auto plan targets a missing, connected or repeated resource field.');
      patched.add(key);
      param.value = patch.value;
      const current = useFlowStore.getState();
      const root = current.nodes.find((node) =>
        node.data.blockInstanceV2?.effectiveGraph.nodes.some(
          (child) => blockProjectionNodeIdV2(node.id, child.nodeId) === patch.nodeId,
        ),
      );
      if (!root?.data.blockInstanceV2) {
        if (!current.nodes.some((node) => node.id === patch.nodeId))
          throw new Error(
            'The loader is inside an older Block. Move it into a current Block before applying Auto settings.',
          );
        current.setParamWithHistory(patch.nodeId, patch.field, patch.value);
        continue;
      }
      const instance = root.data.blockInstanceV2;
      const child = instance.effectiveGraph.nodes.find(
        (node) => blockProjectionNodeIdV2(root.id, node.nodeId) === patch.nodeId,
      )!;
      const owners = resourceValueOwners(instance).filter((item) =>
        item.bindings.some((binding) => binding.nodeId === child.nodeId && binding.fieldId === patch.field),
      );
      if (owners.length) {
        for (const binding of owners.flatMap((owner) => owner.bindings)) {
          const id = blockProjectionNodeIdV2(root.id, binding.nodeId);
          const effective = graph.nodes[id]?.params[binding.fieldId];
          const planned = patches.find((item) => item.nodeId === id && item.field === binding.fieldId);
          if (!effective || effective.sourceId || (planned?.value ?? effective.value) !== patch.value)
            throw new Error(
              'A shared resource control would change a node outside this Auto plan. Configure that control separately.',
            );
        }
        for (const owner of owners) current.setBlockInstanceValueV2(root.id, owner.logicalId, patch.value);
      } else {
        const effective = structuredClone(instance.effectiveGraph);
        const target = effective.nodes.find((node) => node.nodeId === child.nodeId)!;
        const params = target.data.params as Record<string, Record<string, unknown>>;
        params[patch.field] = { ...params[patch.field], value: patch.value };
        const projection = materializeBlockProjectionV2(
          createBlockRootNodeV2(replaceBlockEffectiveGraphV2(instance, effective), { selected: root.selected }),
        );
        useFlowStore.setState({
          nodes: [
            ...current.nodes.filter((node) => node.id !== root.id && node.data.blockProjectionOwnerId !== root.id),
            ...projection.nodes,
          ],
          edges: [
            ...current.edges.filter((edge) => edge.data?.blockProjectionOwnerId !== root.id),
            ...projection.edges,
          ],
        });
      }
    }
    useFlowStore.getState().commitHistoryTransaction();
  } catch (error) {
    useFlowStore.getState().cancelHistoryTransaction();
    throw error;
  }
  return result;
}

export function applyRuntimeWorkflowAutoSettingsV2(
  updates: (WorkflowAutoPlanV2['patches'][number] & { previousValue?: string | boolean | null })[],
) {
  const flow = useFlowStore.getState();
  const graph = flow.exportGraph('', undefined, { randomizeSeeds: false });
  for (const update of updates) {
    const param = graph.nodes[update.nodeId]?.params[update.field];
    if (!param || param.sourceId || (param.value ?? null) !== (update.previousValue ?? null))
      throw new Error(
        'The run changed resource settings, but your newer workflow edits were preserved. The run details show the settings used.',
      );
  }
  applyWorkflowAutoSettingsV2(graph, updates);
}
