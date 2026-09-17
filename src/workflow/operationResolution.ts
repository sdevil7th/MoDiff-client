import config from '../../app.config';
import { isRecord, parseNodesResponse, payloadRecord, type NodeData } from '../stores/useNodeStore';
import { requestJson } from '../utils/requestJson';
import { identifier, parseOperationContracts, type OperationContract } from './operationContracts';

/** Resolve metadata lazily; insertion still uses the ordinary node factory. */
export async function resolveOperation(operation: OperationContract, signal?: AbortSignal): Promise<NodeData> {
  const selection = {
    pipelineClass: operation.pipelineClass,
    task: operation.task,
    operationId: operation.operationId,
  };
  return requestJson(`${config.serverAddress}/operations/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selection),
    signal,
    parse: (value) => {
      const payload = payloadRecord(value, 'Invalid resolved operation.');
      if (payload.schemaVersion !== 1 || Object.keys(payload).length !== 3)
        throw new Error('Invalid resolved operation.');
      const [resolved] = parseOperationContracts([payload.operation], 3);
      if (
        !resolved ||
        resolved.pipelineClass !== selection.pipelineClass ||
        resolved.task !== selection.task ||
        resolved.operationId !== selection.operationId ||
        resolved.nodeKey !== operation.nodeKey
      )
        throw new Error('The resolved operation does not match the selection.');
      const key = resolved.nodeKey;
      const node = parseNodesResponse({ nodes: { [key]: payload.node } }).nodes[key]!;
      if (
        node.type !== 'custom' ||
        typeof node.label !== 'string' ||
        typeof node.category !== 'string' ||
        Object.keys(node.params).length > 512
      )
        throw new Error('Invalid resolved node schema.');
      for (const [name, field] of Object.entries(node.params)) {
        identifier(name);
        if (!isRecord(field)) throw new Error('Invalid resolved node field.');
      }
      if (
        `${node.module}.${node.action}` !== key ||
        !resolved.binding ||
        Object.entries(resolved.binding.values).some(([key, value]) => node.params[key]?.value !== value)
      )
        throw new Error('The resolved node does not match its operation binding.');
      return node;
    },
  });
}
