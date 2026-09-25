import config from '../../app.config';
import { requestJson } from '../utils/requestJson';

export type ExtensionSource = { kind: 'local' | 'git' | 'hub'; source: string; name: string; revision?: string };
export type ExtensionImport = ExtensionSource | { kind: 'file'; name: string; content: string };

export function extensionName(source: string): string {
  const leaf = source.trim().replace(/\/$/u, '').split(/[\\/]/u).pop() ?? '';
  const safe = leaf.replace(/\.(?:py|git)$/iu, '').replace(/[^A-Za-z0-9_]/gu, '_');
  return (/^[A-Za-z]/u.test(safe) ? safe : `Node_${safe}`).slice(0, 64);
}

export async function pythonFileImport(file: File): Promise<ExtensionImport> {
  if (!/\.py$/iu.test(file.name) || file.size > 2 * 1024 * 1024)
    throw new Error('Choose a Python node file (.py), at most 2 MiB.');
  return { kind: 'file', name: extensionName(file.name), content: await file.text() };
}
export type ResolvedExtensionSource = { kind: 'hub'; source: string; requestedRevision: string; revision: string };
export type ExtensionInfo = {
  name: string;
  moduleKey: string;
  source: 'custom';
  kind?: string;
  revision?: string | null;
  runtimeRole?: 'manual' | 'data' | 'connected_components';
  enabled: boolean;
  status: 'enabled' | 'disabled' | 'changed' | 'error';
  path: string;
  codeHash: string | null;
  approvedHash?: string | null;
  diagnostic?: string | null;
  nodes: string[];
  nodeCount: number;
  canDisable: boolean;
  canEnable: boolean;
  dependencies: Array<{ requirement: string; installed: string | null; status: string }>;
  files: Array<{ name: string; bytes: number; sha256: string }>;
  preview: {
    kind: 'python' | 'modular';
    diagnostics: string[];
    nodes: Record<string, { label: string; params: Record<string, { type?: string | string[]; display?: string }> }>;
  } | null;
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const hash = (value: unknown) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);

export function parseExtensionInfo(value: unknown): ExtensionInfo {
  if (
    !record(value) ||
    typeof value.name !== 'string' ||
    value.moduleKey !== `custom.${value.name}` ||
    value.source !== 'custom' ||
    typeof value.enabled !== 'boolean' ||
    !['enabled', 'disabled', 'changed', 'error'].includes(String(value.status)) ||
    !(
      value.runtimeRole === undefined || ['manual', 'data', 'connected_components'].includes(String(value.runtimeRole))
    ) ||
    typeof value.path !== 'string' ||
    ['kind', 'revision', 'approvedHash'].some(
      (key) => value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string',
    ) ||
    !(value.codeHash === null || hash(value.codeHash)) ||
    !strings(value.nodes) ||
    !Number.isSafeInteger(value.nodeCount) ||
    Number(value.nodeCount) < 0 ||
    typeof value.canDisable !== 'boolean' ||
    typeof value.canEnable !== 'boolean' ||
    !(value.diagnostic === undefined || value.diagnostic === null || typeof value.diagnostic === 'string') ||
    !Array.isArray(value.dependencies) ||
    value.dependencies.length > 256 ||
    value.dependencies.some(
      (dep) =>
        !record(dep) ||
        typeof dep.requirement !== 'string' ||
        !(dep.installed === null || typeof dep.installed === 'string') ||
        !['satisfied', 'missing', 'incompatible', 'manual_review'].includes(String(dep.status)),
    ) ||
    !Array.isArray(value.files) ||
    value.files.length > 256 ||
    value.files.some(
      (file) =>
        !record(file) ||
        typeof file.name !== 'string' ||
        !Number.isSafeInteger(file.bytes) ||
        Number(file.bytes) < 0 ||
        typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(file.sha256),
    )
  )
    throw new Error('The backend returned an invalid custom extension record.');
  if (value.preview !== null) {
    const preview = value.preview;
    if (
      !record(preview) ||
      !['python', 'modular'].includes(String(preview.kind)) ||
      !strings(preview.diagnostics) ||
      !record(preview.nodes) ||
      Object.values(preview.nodes).some(
        (node) =>
          !record(node) ||
          typeof node.label !== 'string' ||
          !record(node.params) ||
          Object.values(node.params).some(
            (field) =>
              !record(field) ||
              !(field.type === undefined || typeof field.type === 'string' || strings(field.type)) ||
              !(field.display === undefined || typeof field.display === 'string'),
          ),
      )
    ) {
      throw new Error('The backend returned an invalid extension preview.');
    }
  }
  if (value.enabled && (!hash(value.codeHash) || value.status !== 'enabled')) {
    throw new Error('The backend returned an inconsistent code approval.');
  }
  return value as ExtensionInfo;
}

export function inspectExtension(name: string, signal?: AbortSignal) {
  return requestJson(`${config.serverAddress}/custom_modules/${encodeURIComponent(name)}/inspect`, {
    method: 'POST',
    signal,
    timeoutMs: 30_000,
    parse: (value) => {
      if (!record(value)) throw new Error('The backend returned an invalid extension inspection.');
      return parseExtensionInfo(value.module);
    },
  });
}
