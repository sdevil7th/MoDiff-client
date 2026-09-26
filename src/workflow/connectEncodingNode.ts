import type { Connection } from '@xyflow/react';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { captureWorkflowOperationContext, assertWorkflowOperationContext } from '../stores/useStudioStore';
import { operationGraphSignature, commitOperationGraph } from './operationGraphTransaction';
import { requestOperationStarter } from './operationStarterRequest';
import { encodingConnectionRoute, encodingOwnerProfile, planEncodingConnection } from './encodingNodeConnection';

export async function connectEncodingNode(connection: Connection, pendingNode?: CustomNodeType, signal?: AbortSignal) {
  const context = captureWorkflowOperationContext();
  const graph = useFlowStore.getState().toObject();
  const signature = operationGraphSignature(graph);
  if (pendingNode) graph.nodes.push(pendingNode);
  const registry = useNodesStore.getState();
  const route = encodingConnectionRoute(graph, connection, registry.operationContracts, registry.pipelineSupport);
  const starter = await requestOperationStarter(
    route.operation.pipelineClass,
    route.operation.task!,
    registry.operationContracts,
    signal,
    encodingOwnerProfile(route.owner),
  );
  if (signal?.aborted) return;
  assertWorkflowOperationContext(context, { includeForm: false });
  if (operationGraphSignature(useFlowStore.getState().toObject()) !== signature)
    throw new Error('The workflow changed while preparing this connection. Connect again. Nothing changed.');
  const next = planEncodingConnection(graph, connection, route, starter);
  commitOperationGraph(next, context, signature, 'Connect encoding input/output');
}
