/** Backend declarations, not execution permission or a graph recipe. */
export type OperationSemantics = {
  kind: 'value' | 'media' | 'component' | 'conditioning' | 'latents' | 'state' | 'pipeline' | 'opaque';
  scope: string | null;
  state: string | null;
  owner: 'same_loader' | 'none';
  members: { name: string; type: string }[];
};
export type OperationPort = {
  name: string;
  semanticName: string;
  direction: 'input' | 'output';
  roles: ('value' | 'component' | 'pipeline')[];
  types: string[];
  required: boolean;
  hidden: boolean;
  semantics?: OperationSemantics;
};

export type OperationContract = {
  pipelineClass: string;
  task: string | null;
  operationId: string;
  nodeKey: string;
  nodeType: string;
  blockName: string | null;
  decomposition: 'block' | 'bundle' | 'loader' | 'pipeline' | 'integrated';
  support: 'declared';
  ports: OperationPort[];
  workflowId?: string | null;
  binding?: { pipelineClass: string; values: Record<string, string> };
};

export function operationOwnsModel(
  operation: OperationContract | null | undefined,
): operation is OperationContract & { decomposition: 'loader' | 'integrated' } {
  return operation?.decomposition === 'loader' || operation?.decomposition === 'integrated';
}

const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const CONTRACT_KEYS = [
  'pipelineClass',
  'operationId',
  'nodeKey',
  'nodeType',
  'blockName',
  'decomposition',
  'support',
  'ports',
];
const PORT_KEYS = ['name', 'semanticName', 'direction', 'roles', 'types', 'required'];

export function invalid(): never {
  throw new Error('Invalid backend operation contract.');
}

export function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(result, key))
  )
    invalid();
  return result;
}

export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || RESERVED.has(value)) invalid();
  return value;
}

function parsePort(
  value: unknown,
  v2: boolean,
  wholePipeline: boolean,
  v3: boolean,
  scope: string,
  workflowId: string | null,
): OperationPort {
  const item = record(value, [...PORT_KEYS, ...(v2 ? ['hidden'] : []), ...(v3 ? ['semantics'] : [])]);
  const pipelineRole =
    wholePipeline && Array.isArray(item.roles) && item.roles.length === 1 && item.roles[0] === 'pipeline';
  if (
    (item.direction !== 'input' && item.direction !== 'output') ||
    !Array.isArray(item.roles) ||
    item.roles.length === 0 ||
    item.roles.length > 2 ||
    (!pipelineRole && !item.roles.every((role) => role === 'value' || role === 'component')) ||
    new Set(item.roles).size !== item.roles.length ||
    typeof item.required !== 'boolean' ||
    (item.direction === 'output' &&
      (item.required ||
        (!pipelineRole &&
          (item.roles.length !== 1 || (item.roles[0] !== 'value' && !(v3 && item.roles[0] === 'component')))))) ||
    (v2 && typeof item.hidden !== 'boolean') ||
    !Array.isArray(item.types) ||
    item.types.length === 0 ||
    item.types.length > 16
  )
    invalid();
  const types = item.types.map(identifier);
  if (new Set(types).size !== types.length) invalid();
  return {
    name: identifier(item.name),
    semanticName: identifier(item.semanticName),
    direction: item.direction,
    roles: [...item.roles] as OperationPort['roles'],
    types,
    required: item.required,
    hidden: v2 ? (item.hidden as boolean) : false,
    ...(v3 ? { semantics: parseSemantics(item.semantics, scope, workflowId) } : {}),
  };
}

export function boundedText(value: unknown, limit = 2048): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > limit ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    invalid();
  return value;
}

function parseSemantics(value: unknown, pipeline: string, workflowId: string | null): OperationSemantics {
  const item = record(value, ['kind', 'scope', 'state', 'owner', 'members']);
  if (
    !['value', 'media', 'component', 'conditioning', 'latents', 'state', 'pipeline', 'opaque'].includes(
      String(item.kind),
    ) ||
    !['same_loader', 'none'].includes(String(item.owner)) ||
    !Array.isArray(item.members) ||
    item.members.length > 256
  )
    invalid();
  const scoped = !['value', 'media'].includes(String(item.kind));
  if (item.owner !== (scoped && item.kind !== 'opaque' ? 'same_loader' : 'none')) invalid();
  const scope = item.kind === 'state' && workflowId ? `${pipeline}:${workflowId}` : pipeline;
  if (item.scope !== (scoped ? scope : null) || (item.kind !== 'state' && item.state !== null)) invalid();
  const members = item.members.map((value) => {
    const member = record(value, ['name', 'type']);
    return { name: identifier(member.name), type: boundedText(member.type, 1024) };
  });
  if (new Set(members.map((m) => m.name)).size !== members.length) invalid();
  return {
    kind: item.kind as OperationSemantics['kind'],
    scope: item.scope as string | null,
    state: item.state === null ? null : identifier(item.state),
    owner: item.owner as OperationSemantics['owner'],
    members,
  };
}

/**
 * Do not narrow pipeline names through Studio's closed model-family union.
 * Port meaning remains scoped to pipelineClass; matching types/names alone is
 * insufficient to approve a connection, model change or upstream block call.
 */
export function parseOperationContracts(value: unknown, schemaVersion: unknown): OperationContract[] {
  if (value === undefined && schemaVersion === undefined) return [];
  if (
    (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) ||
    !Array.isArray(value) ||
    value.length > 4096
  )
    invalid();
  const v3 = schemaVersion === 3;
  const v2 = schemaVersion === 2 || v3;
  const identities = new Set<string>();
  return value.map((entry): OperationContract => {
    const item = record(entry, [...CONTRACT_KEYS, ...(v2 ? ['task'] : []), ...(v3 ? ['workflowId', 'binding'] : [])]);
    const workflowId = !v3 || item.workflowId === null ? null : identifier(item.workflowId);
    let binding: OperationContract['binding'];
    if (v3) {
      const value = record(item.binding, ['pipelineClass', 'values']);
      if (
        typeof value.values !== 'object' ||
        !value.values ||
        Array.isArray(value.values) ||
        Object.keys(value.values).length > 16
      )
        invalid();
      binding = {
        pipelineClass: identifier(value.pipelineClass),
        values: Object.fromEntries(
          Object.entries(value.values).map(([key, value]) => [identifier(key), identifier(value)]),
        ),
      };
    }
    const pipelineClass = identifier(item.pipelineClass);
    const nodeType = identifier(item.nodeType);
    const task = !v2 || item.task === null ? null : identifier(item.task);
    const wholePipeline =
      v2 &&
      (item.decomposition === 'loader' ||
        item.decomposition === 'pipeline' ||
        (v3 && item.decomposition === 'integrated'));
    if (
      typeof item.operationId !== 'string' ||
      item.operationId.split('.').length !== 2 ||
      typeof item.nodeKey !== 'string' ||
      !item.nodeKey.startsWith('modules.') ||
      item.nodeKey.split('.').length !== 3 ||
      item.support !== 'declared' ||
      (!wholePipeline && item.decomposition !== 'block' && item.decomposition !== 'bundle') ||
      (wholePipeline && (task === null || nodeType !== item.decomposition)) ||
      (item.decomposition === 'block' ? typeof item.blockName !== 'string' : item.blockName !== null) ||
      !Array.isArray(item.ports) ||
      item.ports.length > 128
    )
      invalid();
    item.operationId.split('.').forEach(identifier);
    item.nodeKey.split('.').forEach(identifier);
    const identity = `${pipelineClass}:${item.operationId}:${task ?? ''}`;
    if (identities.has(identity)) invalid();
    identities.add(identity);
    const ports = item.ports.map((port) =>
      parsePort(port, v2, wholePipeline, v3, binding?.pipelineClass ?? pipelineClass, workflowId),
    );
    if (new Set(ports.map((port) => `${port.direction}:${port.name}`)).size !== ports.length) invalid();
    return {
      pipelineClass,
      task,
      operationId: item.operationId,
      nodeKey: item.nodeKey,
      nodeType,
      blockName: item.blockName === null ? null : identifier(item.blockName),
      decomposition: item.decomposition as OperationContract['decomposition'],
      support: item.support,
      ports,
      ...(v3 ? { workflowId, binding } : {}),
    };
  });
}
