/** Backend declarations, not execution permission or a graph recipe. */
export type OperationPort = {
  name: string;
  semanticName: string;
  direction: 'input' | 'output';
  roles: ('value' | 'component')[];
  types: string[];
  required: boolean;
};

export type OperationContract = {
  pipelineClass: string;
  operationId: string;
  nodeKey: string;
  nodeType: string;
  blockName: string | null;
  decomposition: 'block' | 'bundle';
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

function parsePort(value: unknown): OperationPort {
  const item = record(value, PORT_KEYS);
  if (
    (item.direction !== 'input' && item.direction !== 'output') ||
    !Array.isArray(item.roles) ||
    item.roles.length === 0 ||
    item.roles.length > 2 ||
    !item.roles.every((role) => role === 'value' || role === 'component') ||
    new Set(item.roles).size !== item.roles.length ||
    typeof item.required !== 'boolean' ||
    (item.direction === 'output' && (item.required || item.roles.length !== 1 || item.roles[0] !== 'value')) ||
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
  };
}

/**
 * Do not narrow pipeline names through Studio's closed model-family union.
 * Port meaning remains scoped to pipelineClass; matching types/names alone is
 * insufficient to approve a connection, model change or upstream block call.
 */
export function parseOperationContracts(value: unknown, schemaVersion: unknown): OperationContract[] {
  if (value === undefined && schemaVersion === undefined) return [];
  if (schemaVersion !== 1 || !Array.isArray(value) || value.length > 4096) invalid();
  const identities = new Set<string>();
  return value.map((entry): OperationContract => {
    const item = record(entry, CONTRACT_KEYS);
    const pipelineClass = identifier(item.pipelineClass);
    const nodeType = identifier(item.nodeType);
    if (
      typeof item.operationId !== 'string' ||
      item.operationId.split('.').length !== 2 ||
      typeof item.nodeKey !== 'string' ||
      !item.nodeKey.startsWith('modules.') ||
      item.nodeKey.split('.').length !== 3 ||
      item.support !== 'declared' ||
      (item.decomposition !== 'block' && item.decomposition !== 'bundle') ||
      (item.decomposition === 'bundle' ? item.blockName !== null : typeof item.blockName !== 'string') ||
      !Array.isArray(item.ports) ||
      item.ports.length > 128
    )
      invalid();
    item.operationId.split('.').forEach(identifier);
    item.nodeKey.split('.').forEach(identifier);
    const identity = `${pipelineClass}:${item.operationId}`;
    if (identities.has(identity)) invalid();
    identities.add(identity);
    const ports = item.ports.map(parsePort);
    if (new Set(ports.map((port) => `${port.direction}:${port.name}`)).size !== ports.length) invalid();
    return {
      pipelineClass,
      operationId: item.operationId,
      nodeKey: item.nodeKey,
      nodeType,
      blockName: item.blockName === null ? null : identifier(item.blockName),
      decomposition: item.decomposition,
      support: item.support,
      ports,
    };
  });
}
