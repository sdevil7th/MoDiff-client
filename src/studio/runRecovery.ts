import { durableFlowNodeSnapshot, useFlowStore, withoutBlockCompilationTransientsV2 } from '../stores/useFlowStore';
import { canonicalBlockStringifyV2 } from './blockSchemaV2';
import {
  captureWorkflowOperationContext,
  workflowOperationContextIsCurrent,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';

export type RunRecoveryOrigin = {
  workflow: WorkflowOperationContext;
  graphKey: string;
};

export type RunRecoveryFocusTarget =
  | { kind: 'studio'; fieldId: string }
  | { kind: 'node'; nodeId: string; fieldId?: string }
  | { kind: 'runtime'; profileIds: string[] }
  | { kind: 'resources' };

export type RunRecoveryFocusRequest = {
  origin: RunRecoveryOrigin;
  target: RunRecoveryFocusTarget;
};

function recoveryGraphKey() {
  const flow = useFlowStore.getState();
  const graph = withoutBlockCompilationTransientsV2(flow.nodes, flow.edges);
  return canonicalBlockStringifyV2({
    nodes: graph.nodes.map(durableFlowNodeSnapshot).map(({ id, type, parentId, data }) => ({
      id,
      type,
      parentId,
      data: { ...data, uiState: data.uiState?.disabled ? { disabled: true } : undefined },
    })),
    edges: graph.edges.map(({ id, source, sourceHandle, target, targetHandle, data }) => ({
      id,
      source,
      sourceHandle,
      target,
      targetHandle,
      data,
    })),
  });
}

/** Recovery is navigation for one observed document, not authority over the next tab. */
export function captureRunRecoveryOrigin(): RunRecoveryOrigin {
  return {
    workflow: captureWorkflowOperationContext(),
    graphKey: recoveryGraphKey(),
  };
}

export function runRecoveryOriginIsCurrent(origin: RunRecoveryOrigin | null) {
  if (!origin || !workflowOperationContextIsCurrent(origin.workflow)) return false;
  return origin.graphKey === recoveryGraphKey();
}
