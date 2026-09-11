import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeResourceRouteBinding,
  RESOURCE_ROUTE_BINDING_HASH_PREFIX,
  resourceRouteBindingHash,
} from './resource-route-binding.mjs';

const binding = {
  schemaVersion: 1,
  admissionId: 'diffusers.cluster-admission:Pipeline:workflow',
  blockDefinition: {
    definitionId: 'diffusers.cluster-admission:Pipeline:workflow',
    contentHash: 'block-definition-v2-1234abcd',
    canonicalSha256: `sha256:${'a'.repeat(64)}`,
  },
  studioExecutionSpec: {
    id: 'pipeline:workflow:v1',
    contentHash: 'studio-spec-v1-1234abcd',
    executionProfileId: 'pipeline:workflow',
  },
  artifact: {
    repository: 'owner/model',
    revision: 'b'.repeat(40),
  },
  modelDependencies: [
    {
      id: 'text_encoder',
      kind: 'text_encoder',
      repository: 'owner/text-encoder',
      revision: 'c'.repeat(40),
    },
  ],
};

test('resource route binding is canonical, strict, and hash-locked', () => {
  assert.deepEqual(normalizeResourceRouteBinding(structuredClone(binding)), binding);
  assert.match(
    resourceRouteBindingHash(binding),
    new RegExp(`^${RESOURCE_ROUTE_BINDING_HASH_PREFIX}[a-f0-9]{64}$`, 'u'),
  );
  assert.equal(
    resourceRouteBindingHash(binding),
    resourceRouteBindingHash({
      artifact: binding.artifact,
      studioExecutionSpec: binding.studioExecutionSpec,
      blockDefinition: binding.blockDefinition,
      admissionId: binding.admissionId,
      schemaVersion: 1,
      modelDependencies: binding.modelDependencies,
    }),
  );
});

test('resource route binding rejects partial, mutable, or ambiguous identities', () => {
  for (const candidate of [
    { ...binding, family: 'Pipeline' },
    { ...binding, blockDefinition: { ...binding.blockDefinition, definitionId: 'another-admission' } },
    { ...binding, blockDefinition: { ...binding.blockDefinition, canonicalSha256: 'sha256:short' } },
    { ...binding, artifact: { ...binding.artifact, revision: 'main' } },
    { ...binding, modelDependencies: [{ ...binding.modelDependencies[0], revision: 'main' }] },
  ]) {
    assert.throws(() => normalizeResourceRouteBinding(candidate), /Resource route binding/u);
  }
});
