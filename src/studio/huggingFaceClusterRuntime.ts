import type { APIGraphExport, CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useHuggingFaceClusterRuntimeStore } from '../stores/useHuggingFaceClusterRuntimeStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import type { ApiGraphRuntimeHints, JsonObject } from '../types/api';
import { deepEqual } from '../utils/deepEqual';
import {
  autoPlanIsReady,
  fetchAutoResourcePlan,
  formPatchForAutoCandidate,
  selectedAutoCandidate,
  type StudioAutoResourceCandidate,
} from './autoResource';
import {
  fetchHuggingFaceClusterExpertQualification,
  type HuggingFaceClusterExpertQualificationReceipt,
} from './huggingFaceClusterQualification';
import type { HuggingFaceClusterInstance } from './huggingFaceClusterInstance';
import {
  canonicalHuggingFaceClusterExecutionSnapshot,
  huggingFaceClusterStudioExecutionSpecRuntimeReceipt,
  reconcileHuggingFaceClusterExecutionSkeleton,
  resolveHuggingFaceClusterBindingValues,
  type HuggingFaceClusterExecutionSkeleton,
} from './huggingFaceClusterMaterializer';
import type {
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryExecutionAdmission,
} from './huggingFaceNodeLibrary';
import { getFormDefaultsForRegisteredRoute } from './modelProfiles';
import { optionalRuntimeBlockState } from './optionalRuntimes';
import { resolveStudioResourceForm } from './resourcePlanner';
import { hashString, stableStringify } from './templateExactness';
import type { StudioExecutionSpec, StudioFormState } from './types';

export type HuggingFaceClusterRuntimeAuthority = {
  schemaVersion: 1;
  instanceId: string;
  definitionId: string;
  admissionId: string;
  executionFingerprint: string;
  runtimeFingerprint: string;
  checkedAt: number;
  claim: 'qualification_execution_authorized';
  publicationExecutable: false;
  resourceMode: 'auto' | 'expert';
  nodeIds: string[];
  bindingValues: Record<string, unknown>;
  form: StudioFormState;
  runtimeHints: ApiGraphRuntimeHints;
};

export type PrepareHuggingFaceClusterRuntimeAuthorityInput = {
  definition: HuggingFaceNodeLibraryDefinition;
  instance: HuggingFaceClusterInstance;
  admission: HuggingFaceNodeLibraryExecutionAdmission;
  executionSpec: StudioExecutionSpec;
  skeleton: HuggingFaceClusterExecutionSkeleton;
};

function invalid(message: string): never {
  throw new Error(`Cannot authorize Hugging Face Cluster Node execution: ${message}`);
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function candidateArtifact(candidate: StudioAutoResourceCandidate) {
  const values = [
    candidate.resolvedArtifact,
    candidate.artifact,
    candidate.modelRepo,
    candidate.artifactResolution?.resolved?.repo,
  ].filter((value): value is string => Boolean(value));
  return new Set(values).size === 1 ? values[0] : null;
}

function selectedModelVariant(
  instance: HuggingFaceClusterInstance,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
) {
  const selected = instance.execution?.parameterOverrides.modelVariant ?? instance.parameterOverrides.modelVariant;
  return typeof selected === 'string' && selected.trim() ? selected.trim() : (admission.artifact?.repo ?? '');
}

function clusterForm(
  definition: HuggingFaceNodeLibraryDefinition,
  instance: HuggingFaceClusterInstance,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
  resourceMode: 'auto' | 'expert',
) {
  // A Cluster is a durable, isolated workflow instance. Global Studio fields
  // may describe another open graph (for example LTX model-CPU offload while
  // preparing Whisper), so they are not a safe execution base. Insertion
  // already snapshots every admitted user-facing/execution binding into the
  // instance; fill only non-bound technical fields from this model/mode's
  // reviewed defaults.
  const base = getFormDefaultsForRegisteredRoute(
    admission.studioMode as StudioFormState['mode'],
    definition.pipelineClass as StudioFormState['modelType'],
  );
  const intrinsic = resolveHuggingFaceClusterBindingValues(definition, instance, admission);
  const formKeys = new Set(Object.keys(base));
  const projected = Object.fromEntries(
    Object.entries(intrinsic).filter(([source]) => formKeys.has(source)),
  ) as Partial<StudioFormState>;
  return {
    ...base,
    ...projected,
    modelType: definition.pipelineClass as StudioFormState['modelType'],
    modelRepo: selectedModelVariant(instance, admission),
    mode: admission.studioMode as StudioFormState['mode'],
    resourceMode,
  } satisfies StudioFormState;
}

function assertExactCandidate(
  candidate: StudioAutoResourceCandidate,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
  executionSpec: StudioExecutionSpec,
  expectedArtifactRepo: string,
) {
  const contract = candidate.studioExecutionSpecContract;
  const artifact = candidateArtifact(candidate);
  const revision = candidate.artifactResolution?.resolved?.revision;
  const admittedArtifact = admission.artifact;
  if (!admittedArtifact) invalid('the static admission has no sealed artifact receipt.');
  if (
    candidate.modelType !== executionSpec.modelType ||
    candidate.mode !== executionSpec.mode ||
    candidate.loaderModule !== executionSpec.loaderModule ||
    candidate.loaderAction !== executionSpec.loaderAction ||
    candidate.executionPath !== executionSpec.executionPath ||
    candidate.pipelineClass !== executionSpec.pipelineClass ||
    candidate.executionProfileId !== executionSpec.executionProfileId ||
    contract?.schemaVersion !== executionSpec.schemaVersion ||
    contract.id !== executionSpec.id ||
    contract.contentHash !== executionSpec.contentHash ||
    contract.executionProfileId !== executionSpec.executionProfileId ||
    artifact !== expectedArtifactRepo ||
    !revision ||
    !deepEqual(candidate.modelDependencies ?? [], admission.modelDependencies)
  )
    invalid('the backend Auto candidate does not match the sealed admission, artifact, dependencies, or Studio spec.');
}

function selectedBindingValues(
  admission: HuggingFaceNodeLibraryExecutionAdmission,
  effectiveForm: StudioFormState,
  candidate: StudioAutoResourceCandidate | null,
  quantizableComponents: readonly string[],
  modelVariant: string,
) {
  const values = huggingFaceClusterExecutionParameterValues(
    admission,
    effectiveForm,
    candidate,
    quantizableComponents,
    modelVariant,
  );
  return Object.fromEntries(
    admission.executionParameterSources.flatMap((source) =>
      values[source] === undefined ? [] : [[source, jsonClone(values[source])]],
    ),
  );
}

/**
 * Resolve the technical binding values used by Studio execution specs.
 *
 * A Cluster graph needs a complete disabled skeleton before Auto/Expert
 * qualification can run. These values provide that provisional shape. The
 * same resolver is called again with the selected backend candidate (or the
 * reviewed Expert component list) before the child nodes are enabled, so a
 * provisional optimization value can never become runtime authority.
 */
export function huggingFaceClusterExecutionParameterValues(
  admission: HuggingFaceNodeLibraryExecutionAdmission,
  form: StudioFormState,
  candidate: StudioAutoResourceCandidate | null = null,
  quantizableComponents: readonly string[] = ['transformer'],
  modelVariant: string = admission.artifact?.repo ?? '',
): Record<string, unknown> {
  const selectedQuantizedComponents =
    form.quantizationMode === 'none' ? [] : jsonClone(candidate?.quantizedComponents ?? [...quantizableComponents]);
  const attentionBackend =
    candidate?.attentionBackend ??
    (typeof form.attentionBackend === 'string' && form.attentionBackend.trim() ? form.attentionBackend : 'auto');
  const nativeFlashAttention =
    candidate?.attentionBackend ?? (form.device.startsWith('cuda') ? '_native_flash' : 'auto');
  const values: Record<string, unknown> = {
    ...form,
    bpmNormalized: form.bpm > 0 ? form.bpm : 0,
    // A reviewed same-pipeline model variant is an instance value. Default it
    // to the admission artifact so a newly inserted Block has a complete
    // executable binding without making the repository identity user-editable.
    modelVariant,
    autoOffload: form.offloadMode !== 'none',
    quantizedComponents: selectedQuantizedComponents,
    pipelineQuantizedComponents: selectedQuantizedComponents,
    dualQuantizedComponents:
      form.quantizationMode === 'none'
        ? []
        : jsonClone(candidate?.quantizedComponents ?? ['transformer', 'transformer_2']),
    deviceMapNone: 'none',
    attentionBackend,
    nativeFlashAttention,
    nativeMath: '_native_math',
    transformer: nativeFlashAttention === '_native_flash' ? 'transformer' : '',
    dualTransformer: nativeFlashAttention === '_native_flash' ? 'transformer,transformer_2' : '',
    regionalCompile: candidate?.regionalCompile ?? false,
    denoiserCache: candidate?.denoiserCache ?? 'none',
    layerwiseCasting: candidate?.layerwiseCasting ?? false,
    channelsLast: candidate?.channelsLast ?? false,
    videoVaeTiling:
      form.resourceMode !== 'expert' ||
      form.offloadMode !== 'none' ||
      form.width * form.height * form.numFrames > 40_000_000,
    useGuidanceScale2: form.guidanceScale2 > 0,
  };
  return Object.fromEntries(
    admission.executionParameterSources.flatMap((source) =>
      values[source] === undefined ? [] : [[source, jsonClone(values[source])]],
    ),
  );
}

export function provisionalHuggingFaceClusterExecutionParameterValues(
  definition: HuggingFaceNodeLibraryDefinition,
  instance: HuggingFaceClusterInstance,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
) {
  const resourceMode = useStudioStore.getState().form.resourceMode;
  return huggingFaceClusterExecutionParameterValues(
    admission,
    clusterForm(definition, instance, admission, resourceMode),
    null,
    ['transformer'],
    selectedModelVariant(instance, admission),
  );
}

function assertExactExpertQualification(
  receipt: HuggingFaceClusterExpertQualificationReceipt,
  definition: HuggingFaceNodeLibraryDefinition,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
  executionSpec: StudioExecutionSpec,
  form: StudioFormState,
  runtimeFingerprint: string,
  expectedArtifactRepo: string,
) {
  const artifact = admission.artifact;
  const expectedRecipe = {
    device: form.device,
    dtype: form.dtype,
    quantizationMode: form.quantizationMode,
    autoOffload: form.autoOffload,
    offloadMode: form.offloadMode,
  };
  const dependencies = receipt.dependencies.map((item) => ({
    id: item.id,
    kind: item.kind,
    repo: item.artifactStatus.repo,
    revision: item.artifactStatus.revision,
  }));
  if (
    !artifact ||
    receipt.definitionId !== definition.id ||
    receipt.admissionId !== admission.id ||
    receipt.executionProfileId !== executionSpec.executionProfileId ||
    receipt.modelType !== executionSpec.modelType ||
    receipt.mode !== executionSpec.mode ||
    receipt.pipelineClass !== executionSpec.pipelineClass ||
    receipt.loaderModule !== executionSpec.loaderModule ||
    receipt.loaderAction !== executionSpec.loaderAction ||
    receipt.executionPath !== executionSpec.executionPath ||
    receipt.resourceFingerprint !== runtimeFingerprint ||
    receipt.artifactStatus.repo !== expectedArtifactRepo ||
    !receipt.artifactStatus.exactRevisionComplete ||
    receipt.artifactStatus.repairRequired ||
    !deepEqual(dependencies, admission.modelDependencies) ||
    !deepEqual(receipt.recipe, expectedRecipe)
  )
    invalid('the backend Expert qualification does not match the sealed graph, artifact, runtime, or recipe.');
}

/**
 * Join one finalized Cluster graph to the existing backend Auto planner and
 * live optional-runtime/model authority. This authorizes a qualification run;
 * it does not mutate the immutable catalog publication claim.
 */
export async function prepareHuggingFaceClusterRuntimeAuthority({
  definition,
  instance,
  admission,
  executionSpec,
  skeleton,
}: PrepareHuggingFaceClusterRuntimeAuthorityInput): Promise<{
  authority: HuggingFaceClusterRuntimeAuthority;
  skeleton: HuggingFaceClusterExecutionSkeleton;
}> {
  const nodeState = useNodesStore.getState();
  const selectedArtifactRepo = selectedModelVariant(instance, admission);
  const runtimeFingerprint = nodeState.runtimeStatus?.runtime_fingerprint;
  if (!nodeState.runtimeStatus?.ready || !runtimeFingerprint) invalid('the backend runtime is not ready.');
  if (
    !nodeState.studioModelCapabilitiesAuthoritative ||
    nodeState.discoveryRequests.capabilities.status !== 'success' ||
    nodeState.discoveryRequests.optionalRuntimes.status !== 'success'
  )
    invalid('runtime capability or optional-runtime discovery is stale. Refresh Setup and try again.');

  const capability = nodeState.studioModelCapabilities.find((item) => item.modelType === definition.pipelineClass);
  const profile = capability?.executionProfiles?.find(
    (item) => item.id === executionSpec.executionProfileId && item.modes.includes(executionSpec.mode),
  );
  if (!profile) invalid('the exact execution profile is absent from the authoritative backend capabilities.');
  const optionalRuntimeState = optionalRuntimeBlockState(
    profile.optionalRuntimeRequirement,
    nodeState.optionalRuntimeCatalog,
  );
  if (optionalRuntimeState) invalid(`the reviewed optional runtime is ${optionalRuntimeState.replace(/_/gu, ' ')}.`);

  const autoForm = clusterForm(definition, instance, admission, 'auto');
  const plan = await fetchAutoResourcePlan(autoForm);
  const candidate = selectedAutoCandidate(plan, autoForm);
  const autoReady = autoPlanIsReady(plan, autoForm) && Boolean(candidate);
  let effectiveForm: StudioFormState;
  let runtimeHints: ApiGraphRuntimeHints;
  let bindingCandidate: StudioAutoResourceCandidate | null = null;

  if (autoReady && candidate) {
    assertExactCandidate(candidate, admission, executionSpec, selectedArtifactRepo);
    const candidateRuntimeState = optionalRuntimeBlockState(
      candidate.optionalRuntimeRequirement,
      nodeState.optionalRuntimeCatalog,
    );
    if (candidateRuntimeState)
      invalid(`the selected Auto candidate requires an optional runtime that is ${candidateRuntimeState}.`);
    effectiveForm = { ...autoForm, ...formPatchForAutoCandidate(candidate, autoForm) };
    bindingCandidate = candidate;
    const resolvedArtifact = candidateArtifact(candidate)!;
    runtimeHints = {
      source: 'hugging-face-cluster',
      device: effectiveForm.device,
      modelType: definition.pipelineClass,
      mode: admission.studioMode as StudioFormState['mode'],
      modelRepo: selectedArtifactRepo,
      modelName: definition.label,
      resolvedModelRepo: resolvedArtifact,
      resolvedArtifact,
      modelDependencies: jsonClone(admission.modelDependencies) as JsonObject[],
      loaderModule: candidate.loaderModule,
      loaderAction: candidate.loaderAction,
      executionPath: candidate.executionPath,
      pipelineClass: candidate.pipelineClass,
      dtype: effectiveForm.dtype,
      resourceMode: 'auto',
      resolvedResourceMode: 'auto',
      quantizationMode: effectiveForm.quantizationMode,
      quantizedComponents: candidate.quantizedComponents,
      autoOffload: effectiveForm.autoOffload,
      offloadMode: effectiveForm.offloadMode,
      deviceMap: candidate.deviceMap,
      attentionBackend: candidate.attentionBackend,
      regionalCompile: candidate.regionalCompile,
      denoiserCache: candidate.denoiserCache,
      channelsLast: candidate.channelsLast,
      layerwiseCasting: candidate.layerwiseCasting,
      resourcePlan: {
        summary: plan.statusLabel ?? 'Backend Auto Cluster plan',
        executionPath: candidate.executionPath ?? null,
        resolvedModelRepo: resolvedArtifact,
        resolvedArtifact,
        dtype: effectiveForm.dtype,
        quantizationMode: effectiveForm.quantizationMode,
        quantizedComponents: jsonClone(candidate.quantizedComponents ?? []),
        autoOffload: effectiveForm.autoOffload,
        offloadMode: effectiveForm.offloadMode,
      },
      autoResourcePlan: jsonClone(candidate) as unknown as JsonObject,
      autoResourceCandidates: jsonClone(plan.candidates ?? []) as unknown as JsonObject[],
      autoResourceProofStatus: candidate.proof?.status,
      autoResourceCandidateId: candidate.id,
      optimizationQualificationForm: jsonClone(effectiveForm) as unknown as JsonObject,
      compatibilityStatus: candidate.proof?.status ?? 'needs_setup',
      cudaBudgetPolicy: 'advisory',
      enforceCudaBudget: false,
    };
  } else if (plan.compatibility?.state === 'expert_only') {
    effectiveForm = resolveStudioResourceForm(clusterForm(definition, instance, admission, 'expert'));
    const receipt = await fetchHuggingFaceClusterExpertQualification({
      definitionId: definition.id,
      admissionId: admission.id,
      form: effectiveForm,
      artifactRepo: selectedArtifactRepo,
    });
    assertExactExpertQualification(
      receipt,
      definition,
      admission,
      executionSpec,
      effectiveForm,
      runtimeFingerprint,
      selectedArtifactRepo,
    );
    runtimeHints = {
      source: 'hugging-face-cluster',
      device: effectiveForm.device,
      modelType: definition.pipelineClass,
      mode: admission.studioMode as StudioFormState['mode'],
      modelRepo: receipt.artifactStatus.repo,
      modelName: definition.label,
      resolvedModelRepo: receipt.artifactStatus.repo,
      resolvedArtifact: receipt.artifactStatus.repo,
      modelDependencies: jsonClone(admission.modelDependencies) as JsonObject[],
      loaderModule: receipt.loaderModule,
      loaderAction: receipt.loaderAction,
      executionPath: receipt.executionPath,
      pipelineClass: receipt.pipelineClass,
      dtype: effectiveForm.dtype,
      resourceMode: 'expert',
      resolvedResourceMode: 'expert',
      quantizationMode: effectiveForm.quantizationMode,
      quantizedComponents: effectiveForm.quantizationMode === 'none' ? [] : jsonClone(profile.quantizable_components),
      autoOffload: effectiveForm.autoOffload,
      offloadMode: effectiveForm.offloadMode,
      supportedOffloadModes: jsonClone(profile.supported_offload_modes),
      resourceRetryModes: jsonClone(profile.retry_offload_modes),
      resourcePlan: {
        summary: `Backend-qualified Expert Cluster recipe: ${effectiveForm.dtype}, ${effectiveForm.offloadMode}`,
        executionPath: receipt.executionPath,
        resolvedModelRepo: receipt.artifactStatus.repo,
        resolvedArtifact: receipt.artifactStatus.repo,
        artifactRevision: receipt.artifactStatus.revision,
        dtype: effectiveForm.dtype,
        quantizationMode: effectiveForm.quantizationMode,
        quantizedComponents: effectiveForm.quantizationMode === 'none' ? [] : jsonClone(profile.quantizable_components),
        autoOffload: effectiveForm.autoOffload,
        offloadMode: effectiveForm.offloadMode,
        qualificationFingerprint: receipt.qualificationFingerprint,
      },
      clusterRuntimeQualification: jsonClone(receipt) as unknown as JsonObject,
      optimizationQualificationForm: jsonClone(effectiveForm) as unknown as JsonObject,
      compatibilityStatus: 'expert',
      cudaBudgetPolicy: 'advisory',
      enforceCudaBudget: false,
    };
  } else {
    invalid(plan.blockingReason || plan.compatibility?.detail || 'the backend Auto resource plan is not ready.');
  }

  const bindingValues = selectedBindingValues(
    admission,
    effectiveForm,
    bindingCandidate,
    profile.quantizable_components,
    selectedArtifactRepo,
  );
  const rebound = reconcileHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec,
    skeleton,
    currentNodes: useFlowStore.getState().nodes,
    bindingValues,
    expanded: instance.presentation.expanded,
  });
  const studioExecutionSpec = huggingFaceClusterStudioExecutionSpecRuntimeReceipt(rebound);
  const snapshot = canonicalHuggingFaceClusterExecutionSnapshot(rebound);
  const executionFingerprint = `hfcluster_${hashString(stableStringify(snapshot))}`;
  runtimeHints.studioExecutionSpec = jsonClone(studioExecutionSpec) as unknown as JsonObject;
  const authority: HuggingFaceClusterRuntimeAuthority = {
    schemaVersion: 1,
    instanceId: instance.instanceId,
    definitionId: definition.id,
    admissionId: admission.id,
    executionFingerprint,
    runtimeFingerprint,
    checkedAt: Date.now(),
    claim: 'qualification_execution_authorized',
    publicationExecutable: false,
    resourceMode: effectiveForm.resourceMode,
    nodeIds: Object.values(studioExecutionSpec.nodes).filter((id): id is string => Boolean(id)),
    bindingValues,
    form: jsonClone(effectiveForm),
    runtimeHints,
  };
  return { authority, skeleton: rebound };
}

export function huggingFaceClusterRunForm(
  apiGraph: APIGraphExport,
  options: { strict?: boolean } = {},
): StudioFormState | undefined {
  const nodeIds = new Set(Object.keys(apiGraph.nodes));
  const matches = Object.values(useHuggingFaceClusterRuntimeStore.getState().authorities).filter((authority) =>
    authority.nodeIds.some((id) => nodeIds.has(id)),
  );
  if (!matches.length) return undefined;
  if (matches.length !== 1) {
    if (options.strict === false) return undefined;
    invalid('the Cluster run form does not resolve to one volatile execution authority.');
  }
  return jsonClone(matches[0]!.form);
}

export function applyHuggingFaceClusterRuntimeHints(
  apiGraph: APIGraphExport,
  options: { strict?: boolean } = {},
): APIGraphExport {
  const exportedNodeIds = new Set(Object.keys(apiGraph.nodes));
  const runtimeFingerprint = useNodesStore.getState().runtimeStatus?.runtime_fingerprint;
  const authorities = Object.values(useHuggingFaceClusterRuntimeStore.getState().authorities).filter((authority) =>
    authority.nodeIds.some((id) => exportedNodeIds.has(id)),
  );
  if (!authorities.length) return apiGraph;
  if (authorities.length !== 1) {
    if (options.strict === false) return apiGraph;
    invalid(
      'one run cannot combine multiple independently planned Cluster resource authorities yet. Run one output branch.',
    );
  }
  const authority = authorities[0]!;
  if (
    authority.runtimeFingerprint !== runtimeFingerprint ||
    authority.nodeIds.some((id) => !exportedNodeIds.has(id)) ||
    apiGraph.runtimeHints?.source === 'studio'
  ) {
    if (options.strict === false) return apiGraph;
    invalid('the prepared Cluster authority is stale or conflicts with a managed Studio graph. Prepare it again.');
  }
  return {
    ...apiGraph,
    runtimeHints: { ...apiGraph.runtimeHints, ...jsonClone(authority.runtimeHints) },
  };
}

export function clearHuggingFaceClusterRuntimeAuthority(instanceId: string) {
  useHuggingFaceClusterRuntimeStore.getState().clearAuthority(instanceId);
}

export function executableHuggingFaceClusterAuthorities(nodes: readonly CustomNodeType[]) {
  const enabledIds = new Set(
    nodes
      .filter((node) => node.data.huggingFaceClusterRole === 'execution' && !node.data.uiState?.disabled)
      .map((node) => node.id),
  );
  return Object.values(useHuggingFaceClusterRuntimeStore.getState().authorities).filter((authority) =>
    authority.nodeIds.some((id) => enabledIds.has(id)),
  );
}
