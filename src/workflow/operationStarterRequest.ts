import { operationOwnsModel } from './operationContracts';
import { declaredImagePipelineStageContracts } from './imagePipelineStageContracts';
import config from '../../app.config';
import { requestJson } from '../utils/requestJson';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { boundedText, identifier, record, parseOperationContracts, type OperationContract } from './operationContracts';
import { parseResolvedOperation } from './operationResolution';
import type { OperationStarter } from './operationAuthoring';
import { parseOperationAuthoringRecipe, type OperationAuthoringSelection } from '../studio/operationAuthoringRecipe';

export function parseOperationStarter(
  value: unknown,
  pipelineClass: string,
  task: string,
  operations: OperationContract[],
  selection: OperationAuthoringSelection & { repository?: string } = {},
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
    ...(selection.authoringRecipeId ? ['authoring'] : []),
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
  if (byId.size !== nodes.length || nodes.filter((n) => operationOwnsModel(n.operation)).length !== 1) invalid();
  const declaredWorkflows = new Set(nodes.map((node) => node.operation.workflowId).filter((id) => id !== null));
  if (
    declaredWorkflows.size > 1 ||
    (payload.workflowId === null ? declaredWorkflows.size !== 0 : !declaredWorkflows.has(payload.workflowId as string))
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
  const stageKinds = new Set(['image_encoder', 'denoise', 'decoder']);
  const owners = expected.filter(operationOwnsModel);
  const stages = expected.filter(
    (operation) => operation.decomposition === 'bundle' && stageKinds.has(operation.nodeType),
  );
  const whole = expected.filter(
    (operation) => operation.decomposition === 'pipeline' && operation.nodeType === 'pipeline',
  );
  const alternateImageRoutes =
    expected.length === 5 &&
    owners.length === 1 &&
    stages.length === 3 &&
    whole.length === 1 &&
    new Set(expected.map((operation) => operation.operationId)).size === 5 &&
    new Set(stages.map((operation) => operation.nodeType)).size === 3;
  if (alternateImageRoutes) {
    const owner = owners[0]!;
    const sameRoute = (route: OperationContract[]) =>
      route.length === nodes.length && route.every((operation) => byId.has(operation.operationId));
    const pipelineEdges = edges.filter((edge) => edge.source === owner.operationId);
    const ownerNode = byId.get(owner.operationId)!;
    if (
      selection.executionProfileId &&
      (ownerNode.node.params.execution_profile_id?.value ?? ownerNode.node.params.execution_profile_id?.default) !==
        selection.executionProfileId
    )
      invalid();
    const scope = owner.binding?.pipelineClass ?? owner.pipelineClass;
    const outgoing = owner.ports.filter(
      (port) =>
        port.direction === 'output' &&
        port.types.length === 1 &&
        port.types[0] === 'image_diffusion_pipeline' &&
        port.semantics?.kind === 'pipeline' &&
        port.semantics.owner === 'same_loader' &&
        port.semantics.scope === scope,
    );
    if (outgoing.length !== 1 || pipelineEdges.some((edge) => edge.sourceHandle !== outgoing[0]!.name)) invalid();
    if (sameRoute([owner, ...stages])) {
      if (
        !declaredImagePipelineStageContracts(
          nodes.map(({ operation, node }) => ({ id: operation.operationId, operation, params: node.params })),
          owner.operationId,
          edges,
          pipelineEdges,
        )
      )
        invalid();
    } else if (sameRoute([owner, whole[0]!])) {
      const consumer = whole[0]!;
      const incoming = consumer.ports.filter(
        (port) =>
          port.direction === 'input' &&
          port.types.length === 1 &&
          port.types[0] === 'image_diffusion_pipeline' &&
          port.semantics?.kind === 'pipeline' &&
          port.semantics.owner === 'same_loader' &&
          port.semantics.scope === scope,
      );
      if (
        outgoing.length !== 1 ||
        incoming.length !== 1 ||
        edges.length !== 1 ||
        edges[0]!.source !== owner.operationId ||
        edges[0]!.sourceHandle !== outgoing[0]!.name ||
        edges[0]!.target !== consumer.operationId ||
        edges[0]!.targetHandle !== incoming[0]!.name ||
        !consumer.ports.some(
          (port) => port.direction === 'output' && port.types.includes('image') && port.semantics?.kind === 'media',
        )
      )
        invalid();
    } else invalid();
  } else if (expected.length !== nodes.length) invalid();

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
  if (selection.repository !== undefined) {
    const owners = nodes.filter((row) => operationOwnsModel(row.operation));
    const field = owners.length === 1 && (owners[0]!.node.params.repo_id ?? owners[0]!.node.params.model_id);
    const value = field && (field.value ?? field.default);
    if (
      !value ||
      typeof value !== 'object' ||
      !('source' in value) ||
      value.source !== 'hub' ||
      !('value' in value) ||
      value.value !== selection.repository
    )
      invalid();
  }
  return {
    ...(selection.authoringRecipeId
      ? { authoring: parseOperationAuthoringRecipe(payload.authoring, { ...selection, pipelineClass, task }) }
      : {}),
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
  authoringRecipeId?: string,
  repository?: string,
) {
  return requestJson(`${config.serverAddress}/operations/starter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pipelineClass,
      task,
      ...(executionProfileId ? { executionProfileId } : {}),
      ...(authoringRecipeId ? { authoringRecipeId } : {}),
      ...(repository ? { repository } : {}),
    }),
    signal,
    parse: (value) =>
      parseOperationStarter(value, pipelineClass, task, operations, {
        executionProfileId,
        authoringRecipeId,
        repository,
      }),
  });
}

export function requestTaskStarter(
  task: string,
  operations: OperationContract[],
  options: { preferredProfileId?: string; resourceMode: 'auto' | 'expert'; signal?: AbortSignal },
) {
  return requestJson(`${config.serverAddress}/operations/task-starter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task,
      resourceMode: options.resourceMode,
      ...(options.preferredProfileId ? { preferredProfileId: options.preferredProfileId } : {}),
    }),
    signal: options.signal,
    timeoutMs: 120_000,
    parse: (value) => {
      const result = record(value, ['schemaVersion', 'starter', 'profileId', 'unbound', 'message']);
      if (
        result.schemaVersion !== 1 ||
        typeof result.unbound !== 'boolean' ||
        typeof result.message !== 'string' ||
        (result.profileId !== null && typeof result.profileId !== 'string')
      )
        throw new Error('Invalid task starter.');
      const raw = result.starter;
      if (!raw || typeof raw !== 'object' || !('pipelineClass' in raw)) throw new Error('Missing task starter.');
      const pipeline = identifier(raw.pipelineClass);
      return {
        starter: parseOperationStarter(raw, pipeline, task, operations),
        unbound: result.unbound,
        message: result.message,
      };
    },
  });
}
