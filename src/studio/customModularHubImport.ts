import config from '../../app.config';
import { requestJson } from '../utils/requestJson';

export type CustomModularParameterPreview = {
  name: string;
  label: string;
  type: string | unknown[];
  display?: string;
  description?: string;
  default?: string | number | boolean | null;
};

export type CustomModularBlockPreview = {
  id: string;
  label: string;
  blockName: string | null;
  hierarchy: string[];
  nodeType: string | null;
  inputNames: string[];
  modelInputNames: string[];
  outputNames: string[];
  parameters: CustomModularParameterPreview[];
};

export type CustomModularHubInspection = {
  schemaVersion: 1;
  repository: string;
  revision: string;
  sidecar: {
    filename: string;
    format: 'modiff' | 'mellon';
    sha256: string;
    translatedFromMellon: boolean;
  };
  definition: {
    label: string;
    defaultRepository: string | null;
    defaultDtype: string | null;
    blocks: CustomModularBlockPreview[];
    blockCount: number;
    parameterCount: number;
  };
  remoteCode: {
    allowed: false;
    repositoryPythonPresent: boolean;
    requiredForExecution: boolean;
  };
  admission: {
    status: 'executable' | 'preview_only' | 'rejected';
    executable: boolean;
    pipelineClass: string | null;
    blocksClass: string | null;
    components: Array<{
      name: string;
      library: string;
      className: string;
      repository: string;
      revision: string | null;
      subfolder: string;
    }>;
    reasons: string[];
    recoveryHint?: string;
  };
  runtimeNode: {
    label: string;
    params: Record<string, Record<string, unknown>>;
    identity: Record<string, unknown>;
  } | null;
  rejectedFields: string[];
};

export type CustomModularDependency = {
  repository: string;
  revision: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

function parseInspection(value: unknown): CustomModularHubInspection {
  const root = record(value);
  const sidecar = record(root?.sidecar);
  const definition = record(root?.definition);
  const remoteCode = record(root?.remoteCode);
  const admission = record(root?.admission);
  const runtimeNode = root?.runtimeNode === null ? null : record(root?.runtimeNode);
  const blocks = Array.isArray(definition?.blocks) ? definition.blocks : null;
  const components = Array.isArray(admission?.components) ? admission.components : null;
  const reasons = stringArray(admission?.reasons);
  const rejectedFields = stringArray(root?.rejectedFields);
  if (
    root?.schemaVersion !== 1 ||
    typeof root.repository !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(String(root.revision)) ||
    typeof sidecar?.filename !== 'string' ||
    !['modiff', 'mellon'].includes(String(sidecar.format)) ||
    typeof sidecar.sha256 !== 'string' ||
    typeof sidecar.translatedFromMellon !== 'boolean' ||
    typeof definition?.label !== 'string' ||
    !blocks ||
    typeof definition.blockCount !== 'number' ||
    typeof definition.parameterCount !== 'number' ||
    remoteCode?.allowed !== false ||
    typeof remoteCode.repositoryPythonPresent !== 'boolean' ||
    typeof remoteCode.requiredForExecution !== 'boolean' ||
    !['executable', 'preview_only', 'rejected'].includes(String(admission?.status)) ||
    typeof admission?.executable !== 'boolean' ||
    !components ||
    !reasons ||
    !rejectedFields
  ) {
    throw new Error('The backend returned an invalid custom Modular inspection contract.');
  }
  if (
    blocks.some((value) => {
      const block = record(value);
      return (
        typeof block?.id !== 'string' ||
        typeof block.label !== 'string' ||
        !stringArray(block.hierarchy) ||
        !stringArray(block.inputNames) ||
        !stringArray(block.modelInputNames) ||
        !stringArray(block.outputNames) ||
        !Array.isArray(block.parameters)
      );
    })
  ) {
    throw new Error('The backend returned an invalid custom Modular block hierarchy.');
  }
  if (
    runtimeNode &&
    (typeof runtimeNode.label !== 'string' || !record(runtimeNode.params) || !record(runtimeNode.identity))
  ) {
    throw new Error('The backend returned an invalid executable custom Modular node contract.');
  }
  return value as CustomModularHubInspection;
}

export function inspectInstalledCustomModularContract(repository: string, revision: string, signal?: AbortSignal) {
  return requestJson(`${config.serverAddress}/custom_modular/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repository, revision }),
    signal,
    timeoutMs: 30_000,
    parse: parseInspection,
  });
}

export function executableCustomModularDependencies(inspection: CustomModularHubInspection): CustomModularDependency[] {
  if (!inspection.admission.executable || !inspection.runtimeNode) return [];
  const identity = record(inspection.runtimeNode.identity);
  const revisions = record(identity?.component_revisions);
  if (identity?.schema !== 'modiff.custom-pipeline-identity.v3' || !revisions) {
    throw new Error('The executable custom Modular contract did not pin every component repository.');
  }
  const dependencies = Object.entries(revisions).map(([repository, revision]) => {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(repository) ||
      typeof revision !== 'string' ||
      !/^[a-f0-9]{40}$/u.test(revision)
    ) {
      throw new Error('The executable custom Modular contract contains an invalid component pin.');
    }
    return { repository, revision };
  });
  if (dependencies.length === 0) {
    throw new Error('The executable custom Modular contract did not declare any component repositories.');
  }
  return dependencies.sort((left, right) => left.repository.localeCompare(right.repository));
}
