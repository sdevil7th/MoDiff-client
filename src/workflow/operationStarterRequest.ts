import { operationOwnsModel } from './operationContracts';
import config from '../../app.config';
import { requestJson } from '../utils/requestJson';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { boundedText, identifier, record, parseOperationContracts, type OperationContract } from './operationContracts';
import { parseResolvedOperation } from './operationResolution';
import type { OperationStarter } from './operationAuthoring';

export function parseOperationStarter(
  value: unknown,
  pipelineClass: string,
  task: string,
  operations: OperationContract[],
): OperationStarter {
  const payload = record(value, [
    'schemaVersion',
    'pipelineClass',
    'task',
    'workflowId',
    'nodes',
    'edges',
    'requiredInputs',
    'sharedInputs',
    'upstreamBlocks',
  ]);
  const invalid = () => {
    throw new Error('Invalid operation starter. Reload capabilities and try again.');
  };
  if (payload.schemaVersion !== 1 || payload.pipelineClass !== pipelineClass || payload.task !== task) invalid();
  if (payload.workflowId !== null) identifier(payload.workflowId);
  if (
    !Array.isArray(payload.nodes) ||
    !payload.nodes.length ||
    payload.nodes.length > 64 ||
    !Array.isArray(payload.edges) ||
    payload.edges.length > 512 ||
    !Array.isArray(payload.requiredInputs) ||
    payload.requiredInputs.length > 512 ||
    !Array.isArray(payload.sharedInputs) ||
    payload.sharedInputs.length > 32 ||
    !Array.isArray(payload.upstreamBlocks) ||
    payload.upstreamBlocks.length > 512
  )
    return invalid();
  const nodes = payload.nodes.map((row) => {
    const item = record(row, ['operation', 'node']);
    const [operation] = parseOperationContracts([item.operation], 3);
    const expected = operations.find(
      (o) => o.pipelineClass === pipelineClass && o.task === task && o.operationId === operation?.operationId,
    );
    if (!operation || !expected) return invalid();
    return { operation, node: parseResolvedOperation({ schemaVersion: 1, ...item }, expected) };
  });
  const byId = new Map(nodes.map((n) => [n.operation.operationId, n]));
  const expected = operations.filter((o) => o.pipelineClass === pipelineClass && o.task === task);
  if (
    byId.size !== nodes.length ||
    expected.length !== nodes.length ||
    nodes.filter((n) => operationOwnsModel(n.operation)).length !== 1
  )
    invalid();
  const targets = new Set<string>();
  const edges = payload.edges.map((raw) => {
    const edge = record(raw, ['source', 'sourceHandle', 'target', 'targetHandle']);
    const source = boundedText(edge.source, 257),
      target = boundedText(edge.target, 257);
    const sourceHandle = identifier(edge.sourceHandle),
      targetHandle = identifier(edge.targetHandle);
    const left = byId.get(source)?.node.params[sourceHandle],
      right = byId.get(target)?.node.params[targetHandle];
    const key = `${target}:${targetHandle}`;
    if (
      !left ||
      !right ||
      left.hidden ||
      right.hidden ||
      left.display !== 'output' ||
      !(right.display === 'input' || right.isInput) ||
      !connectionTypesAreCompatible(left.type, right.type) ||
      targets.has(key) ||
      source === target
    )
      invalid();
    targets.add(key);
    return { source, sourceHandle, target, targetHandle };
  });
  const visited = new Set<string>(),
    visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) invalid();
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of edges) if (edge.source === id) visit(edge.target);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
  const requiredInputs = payload.requiredInputs.map((raw) => {
    const input = record(raw, ['operationId', 'field']);
    const operationId = boundedText(input.operationId, 257),
      field = identifier(input.field);
    const param = byId.get(operationId)?.node.params[field];
    if (!param || param.hidden || param.display === 'output' || targets.has(`${operationId}:${field}`)) invalid();
    return { operationId, field };
  });
  const sharedMembers = new Set<string>();
  const sharedInputs = payload.sharedInputs.map((raw) => {
    const group = record(raw, ['name', 'members']);
    const name = identifier(group.name);
    if (!Array.isArray(group.members) || group.members.length < 2 || group.members.length > 64) return invalid();
    const members = group.members.map((rawMember) => {
      const member = record(rawMember, ['operationId', 'field']);
      const operationId = boundedText(member.operationId, 257),
        field = identifier(member.field);
      const node = byId.get(operationId);
      const port = node?.operation.ports.find((p) => p.name === field && p.direction === 'input');
      const key = `${operationId}:${field}`;
      if (
        !port ||
        port.hidden ||
        port.semanticName !== name ||
        port.semantics?.kind !== 'value' ||
        sharedMembers.has(key)
      )
        invalid();
      sharedMembers.add(key);
      return { operationId, field };
    });
    return { name, members };
  });
  return {
    pipelineClass,
    task,
    workflowId: payload.workflowId as string | null,
    nodes,
    edges,
    requiredInputs,
    sharedInputs,
    upstreamBlocks: payload.upstreamBlocks.map((p) => boundedText(p, 512)),
  };
}

export function requestOperationStarter(
  pipelineClass: string,
  task: string,
  operations: OperationContract[],
  signal?: AbortSignal,
  executionProfileId?: string,
) {
  return requestJson(`${config.serverAddress}/operations/starter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineClass, task, ...(executionProfileId ? { executionProfileId } : {}) }),
    signal,
    parse: (value) => parseOperationStarter(value, pipelineClass, task, operations),
  });
}
