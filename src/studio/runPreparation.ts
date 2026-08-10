import { useFlowStore, type APIGraphExport } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { currentAutoResourcePlanTarget, useStudioStore } from '../stores/useStudioStore';
import type { JsonObject } from '../types/api';
import { formPatchForAutoCandidate, selectedAutoCandidate } from './autoResource';
import { studioExecutionSpecRuntimeReceipt } from './executionSpecs';
import {
  getModelRequirementsForMode,
  getProfileForForm,
  getStudioModelDisplayName,
  QWEN_IMAGE_2512_PREQUANTIZED_REPO,
  QWEN_LOW_VRAM_OFFLOAD_MODE,
  QWEN_LOW_VRAM_QUANTIZATION_MODE,
} from './modelProfiles';
import {
  qwenDirectRetryPlansFromCandidates,
  resolveStudioResourceForm,
  resolveStudioResourcePlan,
} from './resourcePlanner';
import { getRuntimeCudaDevice, isCudaDevice } from './runReadiness';
import {
  getPromptSettingsHash,
  getTemplateLockHash,
  hashString,
  isTemplateExactEligible,
  stableStringify,
} from './templateExactness';
import { STUDIO_TEMPLATES } from './templates';
import type { StudioFormState } from './types';

const GIB = 1024 ** 3;

function cudaIndexFromDevice(device: string) {
  const match = device.trim().match(/^cuda(?::(\d+))?$/i);
  if (!match) return undefined;
  return match[1] ? Number(match[1]) : 0;
}

export type StudioRunCorrelation = {
  clientRunId: string;
  runInputHash: string;
};

/**
 * Adds only transport correlation and the immutable workflow origin. This is
 * valid for every graph, including raw/imported graphs that have no Studio
 * model or resource plan.
 */
export function applyRunCorrelationHints(
  apiGraph: APIGraphExport,
  runIdentity: StudioRunCorrelation,
  options: { targetNodeId?: string } = {},
): APIGraphExport {
  const studio = useStudioStore.getState();
  const workflowTab = studio.workflowTabs.find((tab) => tab.id === studio.activeWorkflowTabId);
  const liveGraph = useFlowStore.getState().toObject();
  const workflowSnapshot =
    workflowTab?.snapshot ??
    ({
      nodes: liveGraph.nodes,
      edges: liveGraph.edges,
      viewport: liveGraph.viewport,
    } as unknown as JsonObject);

  return {
    ...apiGraph,
    runtimeHints: {
      ...apiGraph.runtimeHints,
      clientRunId: runIdentity.clientRunId,
      runInputHash: runIdentity.runInputHash,
      ...(studio.activeWorkflowTabId ? { workflowTabId: studio.activeWorkflowTabId } : {}),
      workflowCanvasEpoch: studio.workflowCanvasEpoch,
      ...(workflowTab?.title ? { workflowTitle: workflowTab.title } : {}),
      workflowSnapshot: workflowSnapshot as unknown as JsonObject,
      ...(options.targetNodeId ? { nodeId: options.targetNodeId } : {}),
    },
  };
}

export function applyStudioRuntimeHints(apiGraph: APIGraphExport, runIdentity?: StudioRunCorrelation): APIGraphExport {
  const studio = useStudioStore.getState();
  const baseForm = studio.form;
  const autoResourcePlan = studio.autoResourcePlan;
  const auto = baseForm.resourceMode === 'auto';
  const target = currentAutoResourcePlanTarget(autoResourcePlan, baseForm, studio.graphBinding);
  if (auto && target) throw new Error(target);
  const committedAutoCandidate = auto ? selectedAutoCandidate(autoResourcePlan, baseForm) : null;
  const autoFieldOverrides = studio.autoFieldOverrides;
  const pinnedAutoFormKeys = new Set(
    Object.values(autoFieldOverrides)
      .map((override) => override.formKey)
      .filter((key): key is keyof typeof studio.form => Boolean(key)),
  );
  // A ready Auto plan is the authoritative resource decision. Running the
  // committed form back through the generic profile fallback here used to
  // replace a live-proven resident recipe with model_cpu in the receipt and
  // runtime hints immediately before submission.
  const runtimeStatus = useNodesStore.getState().runtimeStatus;
  const studioExecutionSpec = studioExecutionSpecRuntimeReceipt(
    studio.graphBinding,
    useNodesStore.getState().studioModelCapabilities,
  );
  const form = committedAutoCandidate
    ? {
        ...baseForm,
        ...formPatchForAutoCandidate(committedAutoCandidate, baseForm, pinnedAutoFormKeys),
      }
    : resolveStudioResourceForm(baseForm);
  const profile = getProfileForForm(form);
  const resourcePlan = resolveStudioResourcePlan(form);
  const workflowTab = studio.workflowTabs.find((tab) => tab.id === studio.activeWorkflowTabId);
  const activeTemplate = STUDIO_TEMPLATES.find((template) => template.id === studio.activeTemplateId);
  const templateBaseModel = activeTemplate?.workflowBlockSettings?.lora?.baseModel;
  const templateBaseModelRepo = templateBaseModel?.source === 'hub' ? templateBaseModel.value : undefined;
  const templateBaseModelRevision = templateBaseModel?.revision;
  const selectedCandidate = auto ? selectedAutoCandidate(autoResourcePlan, form) : null;
  // The backend applies a proven Auto plan directly to loader nodes. Mirror an
  // architecture-locked audio LoRA base into that plan as well as the visible
  // graph, or the backend would replace the correct checkpoint with the
  // profile default immediately before execution.
  const autoCandidate =
    selectedCandidate && templateBaseModelRepo
      ? {
          ...selectedCandidate,
          modelRepo: templateBaseModelRepo,
          resolvedArtifact: templateBaseModelRepo,
          artifact: templateBaseModelRepo,
          baseArtifact: templateBaseModelRepo,
          artifactRevision: templateBaseModelRevision,
          artifactResolution: {
            ...(selectedCandidate.artifactResolution ?? {}),
            base: {
              ...(selectedCandidate.artifactResolution?.base ?? {}),
              repo: templateBaseModelRepo,
              revision: templateBaseModelRevision,
            },
            resolved: {
              ...(selectedCandidate.artifactResolution?.resolved ?? {}),
              repo: templateBaseModelRepo,
              revision: templateBaseModelRevision,
            },
            substituted: false,
          },
          installTarget: {
            ...(selectedCandidate.installTarget ?? {}),
            repo: templateBaseModelRepo,
          },
        }
      : selectedCandidate;
  const autoCandidates = autoResourcePlan?.candidates?.map((candidate) =>
    autoCandidate && candidate.id === autoCandidate.id ? autoCandidate : candidate,
  );
  const autoRetryPlans = auto
    ? qwenDirectRetryPlansFromCandidates(autoCandidates, autoCandidate?.id)
    : resourcePlan.retryPlans;
  const resolvedModelRepo =
    autoCandidate?.modelRepo ??
    autoCandidate?.installTarget?.repo ??
    autoCandidate?.resolvedArtifact ??
    templateBaseModelRepo ??
    resourcePlan.resolvedModelRepo;
  const resolvedArtifact =
    autoCandidate?.resolvedArtifact ??
    autoCandidate?.artifact ??
    autoCandidate?.installTarget?.repo ??
    autoCandidate?.modelRepo ??
    templateBaseModelRepo ??
    resourcePlan.resolvedArtifact;
  const resolvedExecutionPath = autoCandidate?.executionPath ?? resourcePlan.executionPath;
  const resolvedQuantizationMode = formPatchForAutoCandidate(autoCandidate).quantizationMode ?? form.quantizationMode;
  const resolvedQuantizedComponents = autoCandidate?.quantizedComponents ?? resourcePlan.quantizedComponents;
  const resolvedOffloadMode =
    (autoCandidate?.offloadMode as StudioFormState['offloadMode'] | undefined) ?? form.offloadMode;
  const resolvedAutoOffload =
    typeof autoCandidate?.autoOffload === 'boolean' ? autoCandidate.autoOffload : resolvedOffloadMode !== 'none';
  const cudaDevice = getRuntimeCudaDevice(runtimeStatus, form.device);
  const totalBytes = cudaDevice?.memory_total_bytes ?? cudaDevice?.total_memory ?? undefined;
  const freeBytes = cudaDevice?.memory_free_bytes ?? undefined;
  const reserveBytes = totalBytes ? Math.max(GIB, Math.floor(totalBytes * 0.1)) : undefined;
  const budgetFromFree = freeBytes && reserveBytes ? Math.max(0, freeBytes - reserveBytes) : undefined;
  const budgetFromTotal = totalBytes && reserveBytes ? Math.max(0, totalBytes - reserveBytes) : undefined;
  const locallyEstimatedCudaBudgetBytes =
    budgetFromFree && budgetFromTotal ? Math.min(budgetFromFree, budgetFromTotal) : (budgetFromFree ?? budgetFromTotal);
  const requestedCudaReserveBytes = form.resourceMode === 'expert' ? reserveBytes : undefined;
  const requestedCudaBudgetBytes = form.resourceMode === 'expert' ? locallyEstimatedCudaBudgetBytes : undefined;
  const lowVramMode =
    profile.family === 'Qwen Image' &&
    isCudaDevice(form.device) &&
    form.dtype === 'bfloat16' &&
    (resolvedQuantizationMode === QWEN_LOW_VRAM_QUANTIZATION_MODE ||
      resolvedArtifact === QWEN_IMAGE_2512_PREQUANTIZED_REPO) &&
    form.autoOffload &&
    (resolvedOffloadMode === QWEN_LOW_VRAM_OFFLOAD_MODE ||
      resolvedOffloadMode === 'sequential_cpu' ||
      resolvedOffloadMode === 'group_disk');
  const modelDependencies = getModelRequirementsForMode(profile, form.mode).map((requirement) => ({
    id: requirement.id,
    kind: requirement.kind,
    repo: requirement.repo,
  }));

  return {
    ...apiGraph,
    runtimeHints: {
      source: 'studio',
      device: form.device,
      cudaIndex: cudaIndexFromDevice(form.device),
      cudaMemoryFreeBytes: freeBytes,
      cudaMemoryTotalBytes: totalBytes,
      modelFamily: profile.family,
      modelType: profile.modelType,
      mode: form.mode,
      modelRepo: templateBaseModelRepo ?? profile.defaultRepo,
      modelName: getStudioModelDisplayName(profile),
      resolvedModelRepo,
      resolvedArtifact,
      modelDependencies,
      studioExecutionSpec,
      executionPath: resolvedExecutionPath,
      pipelineClass: autoCandidate?.pipelineClass,
      dtype: form.dtype,
      resourceMode: form.resourceMode,
      resolvedResourceMode: resourcePlan.resolvedResourceMode,
      quantizationMode: resolvedQuantizationMode,
      quantizedComponents: resolvedQuantizedComponents,
      autoOffload: resolvedAutoOffload,
      offloadMode: resolvedOffloadMode,
      deviceMap: autoCandidate?.deviceMap,
      attentionBackend: autoCandidate?.attentionBackend,
      regionalCompile: autoCandidate?.regionalCompile,
      denoiserCache: autoCandidate?.denoiserCache,
      channelsLast: autoCandidate?.channelsLast,
      layerwiseCasting: autoCandidate?.layerwiseCasting,
      supportedOffloadModes: profile.offloadSupport.modes,
      offloadDiskPath: resourcePlan.offloadDiskPath,
      resourcePlan: {
        summary: resourcePlan.summary,
        executionPath: resolvedExecutionPath ?? null,
        resolvedModelRepo: resolvedModelRepo ?? null,
        resolvedArtifact: resolvedArtifact ?? null,
        dtype: resourcePlan.dtype,
        quantizationMode: resolvedQuantizationMode,
        quantizedComponents: resolvedQuantizedComponents,
        autoOffload: resolvedAutoOffload,
        offloadMode: resolvedOffloadMode,
      },
      autoResourcePlan: autoCandidate ? (autoCandidate as unknown as JsonObject) : undefined,
      autoResourceCandidates: autoCandidates as unknown as JsonObject[] | undefined,
      autoResourceProofStatus: autoCandidate?.proof?.status,
      autoResourceCandidateId: autoCandidate?.id,
      autoFieldOverrides: Object.values(autoFieldOverrides) as unknown as JsonObject[],
      optimizationQualificationForm: form as unknown as JsonObject,
      resourceRetryModes: resourcePlan.retryOffloadModes,
      resourceRetryPlans: autoRetryPlans as unknown as JsonObject[],
      compatibilityStatus: autoCandidate?.proof?.status ?? (auto ? 'needs_setup' : 'expert'),
      lowVramMode,
      // Preserve upstream-recommended sampling settings for quality-first
      // local video runs. The backend still enforces a bounded 12-hour cap.
      maxRuntimeSeconds: profile.outputKind === 'video' ? 12 * 60 * 60 : undefined,
      cudaBudgetPolicy: 'advisory',
      enforceCudaBudget: false,
      requestedCudaReserveBytes,
      requestedCudaBudgetBytes,
      clientRunId: runIdentity?.clientRunId,
      runInputHash: runIdentity?.runInputHash,
      workflowTabId: workflowTab?.id,
      workflowTitle: workflowTab?.title,
      workflowSnapshot: workflowTab?.snapshot as unknown as JsonObject | undefined,
    },
  };
}

export function getStudioRunInputHash(form: StudioFormState, apiGraph: APIGraphExport) {
  return `run_${hashString(
    stableStringify({
      form,
      nodes: apiGraph.nodes,
      paths: apiGraph.paths,
      deterministicMode: apiGraph.deterministicMode,
      provenance: apiGraph.provenance,
    }),
  )}`;
}

export function applyDeterministicRunMetadata(
  apiGraph: APIGraphExport,
  options: { force?: boolean } = {},
): APIGraphExport {
  const studio = useStudioStore.getState();
  const template = STUDIO_TEMPLATES.find((item) => item.id === studio.activeTemplateId);
  const exactTemplateCompatible = template ? isTemplateExactEligible(template, studio.form) : false;
  if (!options.force && (!template || !exactTemplateCompatible)) {
    return apiGraph;
  }

  const templateLockHash = template ? getTemplateLockHash(template) : undefined;
  const promptSettingsHash = getPromptSettingsHash(studio.form);
  const expensiveMediaProof = template?.outputKinds?.some((kind) => kind === 'video' || kind === 'audio') ?? false;
  const provenance: JsonObject = {
    source: exactTemplateCompatible ? 'studio-template' : 'studio-variation',
    promptSettingsHash,
    exactTemplateCompatible,
  };
  if (template) {
    provenance.templateId = template.id;
    provenance.templateLabel = template.label;
  }
  if (templateLockHash) {
    provenance.templateLockHash = templateLockHash;
  }
  return {
    ...apiGraph,
    deterministicMode: {
      enabled: true,
      // Audio/video proofs need a locked seed and complete provenance, but
      // forcing deterministic kernels can make supported pipelines unusably
      // slow (especially Wan on ROCm). Duplicate image proofs retain the
      // stronger byte-reproducibility contract.
      strict: !expensiveMediaProof,
      seed: studio.form.seed,
      promptSettingsHash,
      ...(template ? { templateId: template.id } : {}),
      ...(templateLockHash ? { templateLockHash } : {}),
    },
    provenance,
  };
}
