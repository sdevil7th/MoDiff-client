import type { APIGraphExport } from '../stores/useFlowStore';
import type { ApiGraphRuntimeHints, JsonObject } from '../types/api';
import { exactStudioExecutionProfileForForm, exactStudioExecutionSpecForForm } from './executionSpecs';
import type { HuggingFaceNodeLibraryExecutionAdmission } from './huggingFaceNodeLibrary';
import type { ResourceRouteBindingV1 } from './blockResourceRouteBindingV2';
import { selectedRegisteredBlockArtifactV2, type RegisteredBlockV2Route } from './registeredBlockV2Routes';
import type { StudioFormState, StudioModelProfile } from './types';

export type RegisteredBlockExpertRuntimeProjectionV2 = Readonly<{
  form: StudioFormState;
  instanceLabel: string;
  route: RegisteredBlockV2Route;
  admission: HuggingFaceNodeLibraryExecutionAdmission;
  routeBinding: ResourceRouteBindingV1;
}>;

const ROUTE_RESOURCE_HINT_FIELDS = [
  'source',
  'device',
  'cudaIndex',
  'cudaMemoryFreeBytes',
  'cudaMemoryTotalBytes',
  'modelType',
  'mode',
  'modelRepo',
  'modelName',
  'resolvedModelRepo',
  'resolvedArtifact',
  'modelDependencies',
  'studioExecutionSpec',
  'controlledGraphContracts',
  'loaderModule',
  'loaderAction',
  'executionPath',
  'pipelineClass',
  'dtype',
  'resourceMode',
  'resolvedResourceMode',
  'quantizationMode',
  'quantizedComponents',
  'autoOffload',
  'offloadMode',
  'deviceMap',
  'attentionBackend',
  'regionalCompile',
  'denoiserCache',
  'channelsLast',
  'layerwiseCasting',
  'supportedOffloadModes',
  'offloadDiskPath',
  'resourcePlan',
  'clusterRuntimeQualification',
  'autoResourcePlan',
  'autoResourceCandidates',
  'autoResourceProofStatus',
  'autoResourceCandidateId',
  'autoFieldOverrides',
  'optimizationQualificationForm',
  'resourceRetryModes',
  'resourceRetryPlans',
  'compatibilityProbe',
  'compatibilityStatus',
  'cudaBudgetPolicy',
  'enforceCudaBudget',
  'requestedCudaReserveBytes',
  'requestedCudaBudgetBytes',
] as const satisfies readonly (keyof ApiGraphRuntimeHints)[];

function sameJson(left: unknown, right: unknown) {
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entry]) => [key, ordered(entry)]),
    );
  };
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

function dependencyBinding(admission: HuggingFaceNodeLibraryExecutionAdmission) {
  return admission.modelDependencies
    .map(({ id, kind, repo, revision }) => ({ id, kind, repository: repo, revision }))
    .sort((left, right) =>
      `${left.id}\0${left.repository}\0${left.revision}`.localeCompare(
        `${right.id}\0${right.repository}\0${right.revision}`,
      ),
    );
}

function routeBindingMatchesProjection({ route, admission, routeBinding }: RegisteredBlockExpertRuntimeProjectionV2) {
  const selectedArtifact = selectedRegisteredBlockArtifactV2(route, routeBinding.artifact.repository);
  return (
    Boolean(selectedArtifact) &&
    routeBinding.admissionId === route.admissionId &&
    routeBinding.blockDefinition.definitionId === route.admissionId &&
    routeBinding.blockDefinition.contentHash === route.compiledDefinitionContentHash &&
    routeBinding.blockDefinition.canonicalSha256 === route.compiledDefinitionCanonicalSha256 &&
    sameJson(routeBinding.studioExecutionSpec, route.studioExecutionSpec) &&
    sameJson(routeBinding.artifact, {
      repository: selectedArtifact?.repo,
      revision: selectedArtifact?.revision,
    }) &&
    sameJson(routeBinding.modelDependencies, dependencyBinding(admission)) &&
    admission.id === route.admissionId &&
    admission.definitionId === route.definitionId &&
    admission.studioMode === route.studioMode &&
    admission.status === 'admitted' &&
    admission.claim === 'static_graph_contract_compatible' &&
    admission.executable === false &&
    admission.publication.readiness === 'graph_qualified' &&
    admission.publication.insertable === true &&
    admission.publication.executable === false &&
    admission.reasons.length === 0 &&
    sameJson(admission.studioExecutionSpec, route.studioExecutionSpec) &&
    sameJson(admission.artifact, route.artifact)
  );
}

/**
 * Project Expert execution metadata from one exact current registered Block.
 *
 * This deliberately has no access to the global Studio form or active
 * template. The selected Block instance supplies user values, its sealed
 * admission supplies artifact/dependency identity, and authoritative backend
 * capabilities supply the exact loader execution contract. Any disagreement
 * leaves the run unqualified instead of falling back to family-level data.
 */
export function registeredBlockExpertRuntimeHintsV2(
  projection: RegisteredBlockExpertRuntimeProjectionV2 | null,
  capabilities: readonly StudioModelProfile[],
  options: { authoritative: boolean; executionSpecInvalid: boolean },
): ApiGraphRuntimeHints | null {
  if (
    !projection ||
    projection.form.resourceMode !== 'expert' ||
    !options.authoritative ||
    options.executionSpecInvalid ||
    !routeBindingMatchesProjection(projection)
  )
    return null;

  const { form, instanceLabel, route, admission, routeBinding } = projection;
  if (form.modelType !== route.pipelineClass || form.mode !== route.studioMode) return null;
  const spec = exactStudioExecutionSpecForForm(capabilities, options.executionSpecInvalid, form);
  const profile = exactStudioExecutionProfileForForm(capabilities, options.executionSpecInvalid, form);
  if (
    !spec ||
    !profile ||
    spec.id !== route.studioExecutionSpec.id ||
    spec.contentHash !== route.studioExecutionSpec.contentHash ||
    spec.executionProfileId !== route.studioExecutionSpec.executionProfileId ||
    profile.id !== route.studioExecutionSpec.executionProfileId ||
    spec.modelType !== form.modelType ||
    spec.mode !== form.mode ||
    profile.model_type !== form.modelType ||
    !profile.modes.includes(form.mode) ||
    spec.loaderModule !== profile.loader_module ||
    spec.loaderAction !== profile.loader_action ||
    spec.executionPath !== profile.execution_path ||
    spec.pipelineClass !== profile.pipeline_class
  )
    return null;

  const quantizedComponents = form.quantizationMode === 'none' ? [] : [...profile.quantizable_components];
  const modelDependencies = admission.modelDependencies.map((dependency) => ({ ...dependency }));
  const selectedArtifact = selectedRegisteredBlockArtifactV2(route, form.modelRepo);
  if (!selectedArtifact || routeBinding.artifact.repository !== selectedArtifact.repo) return null;
  return {
    source: 'hugging-face-cluster',
    device: form.device,
    modelType: form.modelType,
    mode: form.mode,
    modelRepo: selectedArtifact.repo,
    modelName: instanceLabel,
    resolvedModelRepo: selectedArtifact.repo,
    resolvedArtifact: selectedArtifact.repo,
    modelDependencies: modelDependencies as JsonObject[],
    loaderModule: spec.loaderModule,
    loaderAction: spec.loaderAction,
    executionPath: spec.executionPath,
    pipelineClass: spec.pipelineClass,
    dtype: form.dtype,
    resourceMode: 'expert',
    resolvedResourceMode: 'expert',
    quantizationMode: form.quantizationMode,
    quantizedComponents,
    autoOffload: form.autoOffload,
    offloadMode: form.offloadMode,
    attentionBackend: form.attentionBackend,
    supportedOffloadModes: [...profile.supported_offload_modes],
    offloadDiskPath: form.offloadMode === 'group_disk' ? 'data/offload/diffusers' : undefined,
    resourceRetryModes: [...profile.retry_offload_modes],
    resourcePlan: {
      summary: `Exact registered Block Expert recipe: ${form.dtype}, ${form.quantizationMode}, ${form.offloadMode}`,
      executionPath: spec.executionPath,
      resolvedModelRepo: selectedArtifact.repo,
      resolvedArtifact: selectedArtifact.repo,
      artifactRevision: selectedArtifact.revision,
      dtype: form.dtype,
      quantizationMode: form.quantizationMode,
      quantizedComponents,
      autoOffload: form.autoOffload,
      offloadMode: form.offloadMode,
      studioExecutionSpecContract: { ...route.studioExecutionSpec },
      modelDependencies,
    },
    optimizationQualificationForm: { ...form } as unknown as JsonObject,
    compatibilityStatus: 'expert',
    cudaBudgetPolicy: 'advisory',
    enforceCudaBudget: false,
  };
}

/** Replace every model/resource field as one unit while preserving navigation
 * and correlation metadata. This prevents an unrelated global Studio form or
 * a previously prepared submission from leaking into the selected instance. */
export function applyRegisteredBlockExpertRuntimeHintsV2(
  apiGraph: APIGraphExport,
  runtimeHints: ApiGraphRuntimeHints | null,
  options: { stripStaleRouteHints?: boolean } = {},
): APIGraphExport {
  if (!runtimeHints && !options.stripStaleRouteHints) return apiGraph;
  const retained = { ...(apiGraph.runtimeHints ?? {}) };
  ROUTE_RESOURCE_HINT_FIELDS.forEach((field) => delete retained[field]);
  const next = { ...retained, ...(runtimeHints ?? {}) };
  return {
    ...apiGraph,
    ...(Object.keys(next).length ? { runtimeHints: next } : { runtimeHints: undefined }),
  };
}
