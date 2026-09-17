/** Backend declarations, not execution permission or a graph recipe. */
export type OperationPort = {
  name: string;
  semanticName: string;
  direction: 'input' | 'output';
  roles: ('value' | 'component' | 'pipeline')[];
  types: string[];
  required: boolean;
  hidden: boolean;
};

export type OperationContract = {
  pipelineClass: string;
  task: string | null;
  operationId: string;
  nodeKey: string;
  nodeType: string;
  blockName: string | null;
  decomposition: 'block' | 'bundle' | 'loader' | 'pipeline';
  support: 'declared';
  ports: OperationPort[];
};

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

function invalid(): never {
  throw new Error('Invalid backend operation contract.');
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(result, key))
  )
    invalid();
  return result;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || RESERVED.has(value)) invalid();
  return value;
}

function parsePort(value: unknown, v2: boolean, wholePipeline: boolean): OperationPort {
  const item = record(value, v2 ? [...PORT_KEYS, 'hidden'] : PORT_KEYS);
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
      (item.required || (!pipelineRole && (item.roles.length !== 1 || item.roles[0] !== 'value')))) ||
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
  };
}

/**
 * Do not narrow pipeline names through Studio's closed model-family union.
 * Port meaning remains scoped to pipelineClass; matching types/names alone is
 * insufficient to approve a connection, model change or upstream block call.
 */
export function parseOperationContracts(value: unknown, schemaVersion: unknown): OperationContract[] {
  if (value === undefined && schemaVersion === undefined) return [];
  if ((schemaVersion !== 1 && schemaVersion !== 2) || !Array.isArray(value) || value.length > 4096) invalid();
  const v2 = schemaVersion === 2;
  const identities = new Set<string>();
  return value.map((entry): OperationContract => {
    const item = record(entry, v2 ? [...CONTRACT_KEYS, 'task'] : CONTRACT_KEYS);
    const pipelineClass = identifier(item.pipelineClass);
    const nodeType = identifier(item.nodeType);
    const task = !v2 || item.task === null ? null : identifier(item.task);
    const wholePipeline = v2 && (item.decomposition === 'loader' || item.decomposition === 'pipeline');
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
    const ports = item.ports.map((port) => parsePort(port, v2, wholePipeline));
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
    };
  });
}
