import config from '../../app.config';
import type { ApiGraphExport, JsonObject, JsonValue } from '../types/api';
import { requestJson } from '../utils/requestJson';

export type ServiceTarget = { nodeId: string; field: string };
export type ServiceCandidate = ServiceTarget & { type: string };
export type ServiceCandidates = { inputs: ServiceCandidate[]; outputs: ServiceCandidate[] };
export type ServiceInterface = { inputs: Record<string, ServiceTarget[]>; outputs: Record<string, ServiceTarget[]> };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseServiceCandidates(value: unknown): ServiceCandidates {
  if (!record(value) || value.error !== false) throw new Error('Invalid service inspection response.');
  const parse = (items: unknown): ServiceCandidate[] => {
    if (!Array.isArray(items) || items.length > 32768) throw new Error('Invalid service fields.');
    return items.map((item: unknown) => {
      if (!record(item) || !['nodeId', 'field', 'type'].every((key) => typeof item[key] === 'string'))
        throw new Error('Invalid service field identity.');
      return { nodeId: String(item.nodeId), field: String(item.field), type: String(item.type) };
    });
  };
  return { inputs: parse(value.inputs), outputs: parse(value.outputs) };
}

function json(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => json(item, depth + 1));
  return record(value) && Object.values(value).every((item) => json(item, depth + 1));
}

export function parseServicePackage(value: unknown): JsonObject {
  if (!record(value) || value.error !== false || !record(value.package)) throw new Error('Invalid service export.');
  const item = value.package;
  if (
    item.schema !== 'modiff-service-v1' ||
    typeof item.contentHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(item.contentHash) ||
    !record(item.graph) ||
    !record(item.graph.nodes) ||
    !Array.isArray(item.graph.paths) ||
    !record(item.interface) ||
    !record(item.interface.inputs) ||
    !record(item.interface.outputs) ||
    !record(item.requirements) ||
    !json(item) ||
    JSON.stringify(item).length > 8 * 1024 * 1024
  )
    throw new Error('Invalid service package contract.');
  return item;
}

export function buildServiceInterface(candidates: ServiceCandidates, names: Record<string, string>): ServiceInterface {
  const result: ServiceInterface = { inputs: {}, outputs: {} };
  for (const kind of ['inputs', 'outputs'] as const) {
    for (const candidate of candidates[kind]) {
      const name = names[JSON.stringify([kind, candidate.nodeId, candidate.field])]?.trim();
      if (!name) continue;
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name))
        throw new Error('Use names starting with a letter, followed by letters, digits or underscores.');
      if (Object.prototype.hasOwnProperty.call(result[kind], name))
        throw new Error(`Use a different name for each ${kind} field.`);
      Object.defineProperty(result[kind], name, {
        value: [{ nodeId: candidate.nodeId, field: candidate.field }],
        enumerable: true,
      });
    }
  }
  if (!Object.keys(result.outputs).length) throw new Error('Name at least one preview output.');
  return result;
}

export const inspectServiceGraph = (graph: ApiGraphExport) =>
  requestJson(`${config.serverAddress}/service_package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'inspect', graph }),
    parse: parseServiceCandidates,
  });

export const exportServicePackage = (graph: ApiGraphExport, serviceInterface: ServiceInterface) =>
  requestJson(`${config.serverAddress}/service_package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'build', graph, interface: serviceInterface }),
    parse: parseServicePackage,
  });
