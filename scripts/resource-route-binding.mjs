import { createHash } from 'node:crypto';

export const RESOURCE_ROUTE_BINDING_SCHEMA_VERSION = 1;
export const RESOURCE_ROUTE_BINDING_HASH_PREFIX = 'sha256:resource-route-binding-v1:';

const BLOCK_DEFINITION_HASH = /^block-definition-v2-[a-f0-9]{8}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value, expected) {
  return isRecord(value) && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function nonEmptyText(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) {
    throw new Error(`Resource route binding has an invalid ${label}.`);
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

/** Strict, source-neutral identity for one registered BlockDefinitionV2 route. */
export function normalizeResourceRouteBinding(value) {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'admissionId',
      'blockDefinition',
      'studioExecutionSpec',
      'artifact',
      'modelDependencies',
    ]) ||
    value.schemaVersion !== RESOURCE_ROUTE_BINDING_SCHEMA_VERSION
  ) {
    throw new Error('Resource route binding has an unsupported shape or schema.');
  }
  const admissionId = nonEmptyText(value.admissionId, 'admissionId');
  const blockDefinition = value.blockDefinition;
  if (!exactKeys(blockDefinition, ['definitionId', 'contentHash', 'canonicalSha256'])) {
    throw new Error('Resource route binding has an invalid BlockDefinitionV2 identity.');
  }
  const definitionId = nonEmptyText(blockDefinition.definitionId, 'BlockDefinitionV2 definitionId');
  if (definitionId !== admissionId) {
    throw new Error('Resource route binding BlockDefinitionV2 definitionId must equal its exact admissionId.');
  }
  if (!BLOCK_DEFINITION_HASH.test(String(blockDefinition.contentHash ?? ''))) {
    throw new Error('Resource route binding has an invalid BlockDefinitionV2 content hash.');
  }
  if (!SHA256.test(String(blockDefinition.canonicalSha256 ?? ''))) {
    throw new Error('Resource route binding requires the canonical BlockDefinitionV2 SHA-256.');
  }

  const studioExecutionSpec = value.studioExecutionSpec;
  if (!exactKeys(studioExecutionSpec, ['id', 'contentHash', 'executionProfileId'])) {
    throw new Error('Resource route binding has an invalid Studio execution specification.');
  }
  const artifact = value.artifact;
  if (!exactKeys(artifact, ['repository', 'revision'])) {
    throw new Error('Resource route binding has an invalid artifact identity.');
  }
  const repository = nonEmptyText(artifact.repository, 'artifact repository');
  const revision = nonEmptyText(artifact.revision, 'artifact revision');
  if (!REPOSITORY.test(repository) || !COMMIT.test(revision)) {
    throw new Error('Resource route binding requires an exact Hugging Face repository and immutable commit.');
  }
  if (!Array.isArray(value.modelDependencies) || value.modelDependencies.length > 128) {
    throw new Error('Resource route binding requires the exact admission model dependency list.');
  }
  const dependencyIds = new Set();
  const modelDependencies = value.modelDependencies
    .map((dependency) => {
      if (!exactKeys(dependency, ['id', 'kind', 'repository', 'revision'])) {
        throw new Error('Resource route binding has a malformed model dependency identity.');
      }
      const id = nonEmptyText(dependency.id, 'model dependency id');
      if (dependencyIds.has(id)) throw new Error('Resource route binding has duplicate model dependency ids.');
      dependencyIds.add(id);
      const dependencyRepository = nonEmptyText(dependency.repository, 'model dependency repository');
      const dependencyRevision = nonEmptyText(dependency.revision, 'model dependency revision');
      if (!REPOSITORY.test(dependencyRepository) || !COMMIT.test(dependencyRevision)) {
        throw new Error('Resource route binding model dependencies require immutable Hugging Face artifacts.');
      }
      return {
        id,
        kind: nonEmptyText(dependency.kind, 'model dependency kind'),
        repository: dependencyRepository,
        revision: dependencyRevision,
      };
    })
    .sort((left, right) => {
      const leftKey = `${left.id}\0${left.repository}\0${left.revision}`;
      const rightKey = `${right.id}\0${right.repository}\0${right.revision}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

  return {
    schemaVersion: RESOURCE_ROUTE_BINDING_SCHEMA_VERSION,
    admissionId,
    blockDefinition: {
      definitionId,
      contentHash: blockDefinition.contentHash,
      canonicalSha256: blockDefinition.canonicalSha256,
    },
    studioExecutionSpec: {
      id: nonEmptyText(studioExecutionSpec.id, 'Studio execution spec id'),
      contentHash: nonEmptyText(studioExecutionSpec.contentHash, 'Studio execution spec content hash'),
      executionProfileId: nonEmptyText(studioExecutionSpec.executionProfileId, 'Studio execution profile id'),
    },
    artifact: { repository, revision },
    modelDependencies,
  };
}

export function resourceRouteBindingHash(value) {
  const binding = normalizeResourceRouteBinding(value);
  return `${RESOURCE_ROUTE_BINDING_HASH_PREFIX}${createHash('sha256')
    .update(JSON.stringify(stable(binding)))
    .digest('hex')}`;
}
