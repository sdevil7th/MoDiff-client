import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { isRecord } from '../studio/outputContracts';
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

export type RegisteredBlockInterface = {
  catalogDefinitionId: string;
  catalogDefinitionContentHash: string;
  admissionId: string;
  compiledDefinitionContentHash: string;
  compiledDefinitionCanonicalSha256: string;
  inputs: { portId: string; valueType: string | string[] }[];
  outputs: { portId: string; valueType: string | string[] }[];
};

function invalid(): never {
  throw new Error('Invalid registered Block interface index.');
}
function text(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /\p{Cc}/u.test(value)) invalid();
  return value;
}
function ports(value: unknown): RegisteredBlockInterface['inputs'] {
  if (!Array.isArray(value) || value.length > 512) invalid();
  const parsed = value.map((port) => {
    if (!isRecord(port) || Object.keys(port).sort().join(',') !== 'portId,valueType') invalid();
    const valueType = Array.isArray(port.valueType)
      ? port.valueType.length && port.valueType.length <= 64
        ? port.valueType.map(text)
        : invalid()
      : text(port.valueType);
    return { portId: text(port.portId), valueType };
  });
  if (new Set(parsed.map((port) => port.portId)).size !== parsed.length) invalid();
  return parsed;
}
export function parseRegisteredBlockInterfaces(value: unknown): RegisteredBlockInterface[] {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(',') !== 'entries,error,schemaVersion' ||
    value.schemaVersion !== 1 ||
    value.error !== false ||
    !Array.isArray(value.entries) ||
    value.entries.length > 2048
  )
    invalid();
  const entries = value.entries.map((entry) => {
    if (
      !isRecord(entry) ||
      Object.keys(entry).sort().join(',') !==
        'admissionId,catalogDefinitionContentHash,catalogDefinitionId,compiledDefinitionCanonicalSha256,compiledDefinitionContentHash,inputs,outputs'
    )
      invalid();
    const result = {
      catalogDefinitionId: text(entry.catalogDefinitionId),
      catalogDefinitionContentHash: text(entry.catalogDefinitionContentHash),
      admissionId: text(entry.admissionId),
      compiledDefinitionContentHash: text(entry.compiledDefinitionContentHash),
      compiledDefinitionCanonicalSha256: text(entry.compiledDefinitionCanonicalSha256),
      inputs: ports(entry.inputs),
      outputs: ports(entry.outputs),
    };
    if (!/^sha256:[a-f0-9]{64}$/u.test(result.compiledDefinitionCanonicalSha256)) invalid();
    return result;
  });
  if (new Set(entries.map((entry) => `${entry.catalogDefinitionId}\0${entry.admissionId}`)).size !== entries.length)
    invalid();
  return entries;
}

/** Suggestions cannot substitute another admission or stale build's public ports. */
export function registeredBlockInterfaceNode(
  interfaces: RegisteredBlockInterface[],
  route: RegisteredBlockV2Route,
): NodeData | null {
  const entry = interfaces.find(
    (candidate) => candidate.catalogDefinitionId === route.definitionId && candidate.admissionId === route.admissionId,
  );
  if (
    !entry ||
    entry.catalogDefinitionContentHash !== route.definitionContentHash ||
    entry.compiledDefinitionContentHash !== route.compiledDefinitionContentHash ||
    entry.compiledDefinitionCanonicalSha256 !== route.compiledDefinitionCanonicalSha256
  )
    return null;
  const params: Record<string, NodeParams> = {};
  for (const [direction, ports] of [
    ['input', entry.inputs],
    ['output', entry.outputs],
  ] as const) {
    for (const port of ports) params[`${direction}:${port.portId}`] = { display: direction, type: port.valueType };
  }
  return { type: 'block', module: '', action: '', label: '', category: '', params };
}
