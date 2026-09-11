import type { APIGraphExport } from '../stores/useFlowStore';
import type { JsonObject } from '../types/api';
import {
  canonicalBlockDefinitionV2,
  canonicalBlockStringifyV2,
  normalizeBlockInstanceV2,
  type BlockInstanceV2,
} from './blockSchemaV2';
import { registeredBlockV2RouteForInstance } from './blockRunFormV2';
import { selectedRegisteredBlockArtifactV2, type RegisteredBlockV2Route } from './registeredBlockV2Routes';

export type ResourceRouteBindingV1 = Readonly<{
  schemaVersion: 1;
  admissionId: string;
  blockDefinition: Readonly<{
    definitionId: string;
    contentHash: string;
    canonicalSha256: string;
  }>;
  studioExecutionSpec: Readonly<{
    id: string;
    contentHash: string;
    executionProfileId: string;
  }>;
  artifact: Readonly<{
    repository: string;
    revision: string;
  }>;
  modelDependencies: readonly Readonly<{
    id: string;
    kind: string;
    repository: string;
    revision: string;
  }>[];
}>;

async function sha256(value: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function routeMatchesInstance(instance: BlockInstanceV2, route: RegisteredBlockV2Route) {
  const source = instance.definitionSnapshot.source;
  return (
    instance.definitionSnapshot.ownership.kind === 'registered' &&
    instance.definitionSnapshot.ownership.definitionMutable === false &&
    (source.kind === 'diffusers_catalog' || source.kind === 'transformers_catalog') &&
    instance.definitionRef.definitionId === route.admissionId &&
    source.executionAdmissionId === route.admissionId &&
    source.manifestDefinitionId === route.definitionId &&
    source.manifestContentHash === route.definitionContentHash &&
    source.library === route.provider &&
    source.libraryRevision === route.libraryRevision &&
    source.pipelineClass === route.pipelineClass &&
    source.workflow === route.workflowId &&
    source.repository === route.artifact.repo &&
    source.repositoryRevision === route.artifact.revision
  );
}

/**
 * Bind a run to one exact current registered route.
 *
 * Parameter-only instance changes remain eligible because the immutable
 * definition and execution graph are unchanged. A stale compiled definition,
 * a structurally customized graph/interface, or a non-registered source is
 * deliberately left unbound; family/model identity must never be upgraded to
 * exact route qualification by inference.
 */
export async function registeredBlockResourceRouteBindingV2(
  instanceValue: BlockInstanceV2,
  routeValue?: RegisteredBlockV2Route,
  modelDependenciesValue:
    readonly Readonly<{ id: string; kind: string; repo: string; revision: string }>[] | null = null,
): Promise<ResourceRouteBindingV1 | null> {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const route = routeValue ?? registeredBlockV2RouteForInstance(instance);
  if (
    !route ||
    !routeMatchesInstance(instance, route) ||
    instance.definitionRef.contentHash !== route.compiledDefinitionContentHash ||
    instance.effectiveGraph.graphHash !== instance.definitionSnapshot.graph.graphHash ||
    instance.effectiveInterface.effectiveInterfaceHash !== instance.effectiveInterface.baseInterfaceHash ||
    !modelDependenciesValue
  ) {
    return null;
  }

  let canonicalSha256: string;
  try {
    canonicalSha256 = await sha256(canonicalBlockStringifyV2(canonicalBlockDefinitionV2(instance.definitionSnapshot)));
  } catch {
    // Cryptographic route identity is publication evidence, not execution
    // authority. Environments without WebCrypto may still run in Expert mode,
    // but the resulting proof must remain explicitly unbound.
    return null;
  }
  if (canonicalSha256 !== route.compiledDefinitionCanonicalSha256) return null;
  const modelDependencies = modelDependenciesValue
    .map((dependency) => ({
      id: dependency.id,
      kind: dependency.kind,
      repository: dependency.repo,
      revision: dependency.revision,
    }))
    .sort((left, right) => {
      const leftKey = `${left.id}\0${left.repository}\0${left.revision}`;
      const rightKey = `${right.id}\0${right.repository}\0${right.revision}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  const selectedArtifact = selectedRegisteredBlockArtifactV2(route, instance.values.modelVariant);
  if (!selectedArtifact) return null;

  return {
    schemaVersion: 1,
    admissionId: route.admissionId,
    blockDefinition: {
      definitionId: instance.definitionRef.definitionId,
      contentHash: instance.definitionRef.contentHash,
      canonicalSha256,
    },
    studioExecutionSpec: {
      id: route.studioExecutionSpec.id,
      contentHash: route.studioExecutionSpec.contentHash,
      executionProfileId: route.studioExecutionSpec.executionProfileId,
    },
    artifact: {
      repository: selectedArtifact.repo,
      revision: selectedArtifact.revision,
    },
    modelDependencies,
  };
}

export function applyRegisteredBlockResourceRouteBindingV2(
  apiGraph: APIGraphExport,
  binding: ResourceRouteBindingV1 | null,
): APIGraphExport {
  const hasReservedBinding = Object.prototype.hasOwnProperty.call(
    apiGraph.provenance ?? {},
    'registeredBlockV2RouteBinding',
  );
  if (!binding && !hasReservedBinding) return apiGraph;
  const provenance = { ...apiGraph.provenance };
  delete provenance.registeredBlockV2RouteBinding;
  return {
    ...apiGraph,
    provenance: {
      ...provenance,
      ...(binding ? { registeredBlockV2RouteBinding: binding as unknown as JsonObject } : {}),
    },
  };
}
