import { useFlowStore } from '../stores/useFlowStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  type WorkflowOperationContext,
  useStudioStore,
} from '../stores/useStudioStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { contextualUserNodeName } from './huggingFaceClusterCustomization';
import { copyUserBlockDefinition, snapshotUserBlockInstance } from './userBlocks';
import type { UserBlockDefinition } from './types';

export type UserBlockPersistenceChoice = 'update' | 'new' | 'workflow';

export function userBlockInstanceSourceSignature(instanceId: string) {
  const flow = useFlowStore.getState();
  const ownedIds = new Set(
    flow.nodes
      .filter((node) => node.id === instanceId || node.data.userBlockInstanceId === instanceId)
      .map((node) => node.id),
  );
  return JSON.stringify({
    nodes: flow.nodes
      .filter((node) => ownedIds.has(node.id))
      .map((node) => [node.id, node.parentId, node.position, node.data.params, node.data.userBlockSnapshot])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
    edges: flow.edges
      .filter((edge) => ownedIds.has(edge.source) || ownedIds.has(edge.target))
      .map((edge) => [edge.id, edge.source, edge.sourceHandle, edge.target, edge.targetHandle])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  });
}

/**
 * Commits one of the three User Node persistence choices without allowing an
 * awaited backend write to spill into another workflow or a concurrently
 * edited instance. Reusable definitions are persisted before the canvas is
 * replaced; workflow-only changes remain entirely local to the active tab.
 */
export async function persistUserBlockInstanceChoice(
  {
    instanceId,
    choice,
    workflowTitle,
    context = captureWorkflowOperationContext(),
  }: {
    instanceId: string;
    choice: UserBlockPersistenceChoice;
    workflowTitle: string;
    context?: WorkflowOperationContext;
  },
  saveBlock: (block: UserBlockDefinition) => Promise<UserBlockDefinition> = (definition) =>
    useUserBlockStore.getState().saveBlock(definition),
) {
  const snapshot = snapshotUserBlockInstance(useFlowStore.getState(), instanceId, useUserBlockStore.getState().blocks);
  if (!snapshot) throw new Error('The current User Node definition could not be captured.');
  const sourceSignature = userBlockInstanceSourceSignature(instanceId);
  const candidate =
    choice === 'new'
      ? copyUserBlockDefinition(snapshot, contextualUserNodeName(snapshot.name, workflowTitle))
      : snapshot;
  const saved = choice === 'workflow' ? candidate : await saveBlock(candidate);

  assertWorkflowOperationContext(context, { includeForm: false });
  if (userBlockInstanceSourceSignature(instanceId) !== sourceSignature) {
    throw new Error('The User Node changed while its reusable definition was saving. Retry the operation.');
  }
  const flow = useFlowStore.getState();
  if (!flow.nodes.some((node) => node.id === instanceId && node.data.type === 'block')) {
    throw new Error('The User Node instance is no longer available in this workflow.');
  }
  flow.applyUserBlockDefinition(instanceId, saved);
  useStudioStore.getState().saveActiveWorkflowTab(true);
  return saved;
}
