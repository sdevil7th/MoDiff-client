import config from '../../app.config';
import { requestJson } from '../utils/requestJson';
import {
  canonicalBlockDefinitionV2,
  canonicalBlockStringifyV2,
  normalizeBlockDefinitionV2,
  type BlockDefinitionV2,
  type BlockInstanceV2,
  type BlockJsonValue,
} from './blockSchemaV2';
import type {
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryExecutionAdmission,
} from './huggingFaceNodeLibrary';
import type { RegisteredBlockV2Route } from './registeredBlockV2Routes';

export type RegisteredBlockV2CompiledCatalogEntry = {
  catalogDefinitionId: string;
  catalogDefinitionContentHash: string;
  admissionId: string;
  compiledDefinitionCanonicalSha256: string;
  definition: BlockDefinitionV2;
  values: Record<string, BlockJsonValue>;
  internalLayout: BlockInstanceV2['presentation']['internalLayout'];
  internalLayoutMode: NonNullable<BlockInstanceV2['presentation']['internalLayoutMode']>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is malformed.`);
  return value;
}

function bytesHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function canonicalDefinitionSha256(definition: BlockDefinitionV2) {
  if (!globalThis.crypto?.subtle) throw new Error('The browser cannot verify the registered Block definition.');
  const canonical = canonicalBlockStringifyV2(canonicalBlockDefinitionV2(definition));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `sha256:${bytesHex(digest)}`;
}

function parseEntry(value: unknown): RegisteredBlockV2CompiledCatalogEntry {
  const payload = record(value);
  if (!payload || payload.schemaVersion !== 1 || payload.error !== false) {
    throw new Error('The backend returned an invalid registered Block V2 response.');
  }
  const raw = record(payload.entry);
  if (!raw) throw new Error('The backend did not return a registered Block V2 entry.');
  const definition = normalizeBlockDefinitionV2(raw.definition);
  const values = record(raw.values);
  const layout = record(raw.internalLayout);
  if (!values || !layout) throw new Error('The registered Block V2 instance defaults are malformed.');
  const internalLayoutMode = raw.internalLayoutMode;
  if (internalLayoutMode !== 'root' && internalLayoutMode !== 'hierarchical') {
    throw new Error('The registered Block V2 layout mode is malformed.');
  }
  return {
    catalogDefinitionId: text(raw.catalogDefinitionId, 'Registered catalog definition ID'),
    catalogDefinitionContentHash: text(raw.catalogDefinitionContentHash, 'Registered catalog definition hash'),
    admissionId: text(raw.admissionId, 'Registered admission ID'),
    compiledDefinitionCanonicalSha256: text(
      raw.compiledDefinitionCanonicalSha256,
      'Registered Block canonical SHA-256',
    ),
    definition,
    values: structuredClone(values) as Record<string, BlockJsonValue>,
    internalLayout: structuredClone(layout) as BlockInstanceV2['presentation']['internalLayout'],
    internalLayoutMode,
  };
}

/**
 * Fetch one build-time compiled definition. This performs no node action,
 * model load, optional-runtime activation, Hub access, or weight download.
 */
export async function fetchRegisteredBlockV2CompiledCatalogEntry(
  source: HuggingFaceNodeLibraryDefinition,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
  route: RegisteredBlockV2Route,
) {
  const query = new URLSearchParams({ definition_id: source.id, admission_id: admission.id });
  const entry = await requestJson(`${config.serverAddress}/huggingface/registered-block-v2?${query}`, {
    timeoutMs: 30_000,
    parse: parseEntry,
  });
  const definitionSource = entry.definition.source;
  if (
    entry.catalogDefinitionId !== source.id ||
    entry.catalogDefinitionContentHash !== source.contentHash ||
    entry.admissionId !== admission.id ||
    definitionSource.manifestDefinitionId !== source.id ||
    definitionSource.manifestContentHash !== source.contentHash ||
    definitionSource.executionAdmissionId !== admission.id ||
    entry.definition.definitionId !== admission.id ||
    entry.definition.contentHash !== route.compiledDefinitionContentHash ||
    entry.compiledDefinitionCanonicalSha256 !== route.compiledDefinitionCanonicalSha256
  ) {
    throw new Error('The generated registered BlockDefinitionV2 identity is stale for this catalog admission.');
  }
  if ((await canonicalDefinitionSha256(entry.definition)) !== route.compiledDefinitionCanonicalSha256) {
    throw new Error('The generated registered BlockDefinitionV2 canonical SHA-256 is stale.');
  }
  return entry;
}
