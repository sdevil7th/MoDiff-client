import type { APIGraphExport } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import type { JsonObject } from '../types/api';
import { selectedAutoCandidate } from './autoResource';
import {
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
import { getRuntimeCudaDevice, isCudaDevice, QWEN_MIN_CUDA_TOTAL_BYTES } from './runReadiness';
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

export function applyStudioRuntimeHints(apiGraph: APIGraphExport, runIdentity?: StudioRunCorrelation): APIGraphExport {
  const form = resolveStudioResourceForm(useStudioStore.getState().form, {
    runtimeStatus: useNodesStore.getState().runtimeStatus,
  });
  const profile = getProfileForForm(form);
  const runtimeStatus = useNodesStore.getState().runtimeStatus;
  const resourcePlan = resolveStudioResourcePlan(form, { runtimeStatus });
  const autoResourcePlan = useStudioStore.getState().autoResourcePlan;
  const autoCandidate = form.resourceMode === 'auto' ? selectedAutoCandidate(autoResourcePlan) : null;
  const autoRetryPlans =
    form.resourceMode === 'auto'
      ? qwenDirectRetryPlansFromCandidates(autoResourcePlan?.candidates, autoCandidate?.id, form)
      : resourcePlan.retryPlans;
  const resolvedModelRepo =
    autoCandidate?.modelRepo ??
    autoCandidate?.installTarget?.repo ??
    autoCandidate?.resolvedArtifact ??
    resourcePlan.resolvedModelRepo;
  const resolvedArtifact =
    autoCandidate?.resolvedArtifact ??
    autoCandidate?.artifact ??
    autoCandidate?.installTarget?.repo ??
    autoCandidate?.modelRepo ??
    resourcePlan.resolvedArtifact;
  const resolvedExecutionPath = autoCandidate?.executionPath ?? resourcePlan.executionPath;
  const resolvedQuantizationMode =
    autoCandidate?.quantizationMode === 'none' ||
    autoCandidate?.quantizationMode === 'bnb_4bit' ||
    autoCandidate?.quantizationMode === 'bnb_8bit' ||
    autoCandidate?.quantizationMode === 'quanto_float8' ||
    autoCandidate?.quantizationMode === 'torchao_float8'
      ? autoCandidate.quantizationMode
      : form.quantizationMode;
  const resolvedQuantizedComponents = autoCandidate?.quantizedComponents ?? resourcePlan.quantizedComponents;
  const resolvedOffloadMode =
    (autoCandidate?.offloadMode as StudioFormState['offloadMode'] | undefined) ?? form.offloadMode;
  const cudaDevice = getRuntimeCudaDevice(runtimeStatus, form.device);
  const totalBytes = cudaDevice?.memory_total_bytes ?? cudaDevice?.total_memory ?? undefined;
  const freeBytes = cudaDevice?.memory_free_bytes ?? undefined;
  const reserveBytes = totalBytes ? Math.max(GIB, Math.floor(totalBytes * 0.1)) : undefined;
  const budgetFromFree = freeBytes && reserveBytes ? Math.max(0, freeBytes - reserveBytes) : undefined;
  const budgetFromTotal = totalBytes && reserveBytes ? Math.max(0, totalBytes - reserveBytes) : undefined;
  const requestedCudaBudgetBytes =
    budgetFromFree && budgetFromTotal ? Math.min(budgetFromFree, budgetFromTotal) : (budgetFromFree ?? budgetFromTotal);
  const lowVramMode =
    profile.family === 'Qwen Image' &&
    isCudaDevice(form.device) &&
    form.dtype === 'bfloat16' &&
    (resolvedQuantizationMode === QWEN_LOW_VRAM_QUANTIZATION_MODE ||
      resolvedArtifact === QWEN_IMAGE_2512_PREQUANTIZED_REPO) &&
    form.autoOffload &&
    (resolvedOffloadMode === QWEN_LOW_VRAM_OFFLOAD_MODE ||
      resolvedOffloadMode === 'sequential_cpu' ||
      resolvedOffloadMode === 'group_disk') &&
    Boolean(totalBytes && totalBytes < QWEN_MIN_CUDA_TOTAL_BYTES);

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
      modelRepo: profile.defaultRepo,
      modelName: getStudioModelDisplayName(profile),
      resolvedModelRepo,
      resolvedArtifact,
      executionPath: resolvedExecutionPath,
      pipelineClass: autoCandidate?.pipelineClass,
      dtype: form.dtype,
      resourceMode: form.resourceMode,
      resolvedResourceMode: resourcePlan.resolvedResourceMode,
      quantizationMode: resolvedQuantizationMode,
      quantizedComponents: resolvedQuantizedComponents,
      autoOffload: form.autoOffload,
      offloadMode: resolvedOffloadMode,
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
        autoOffload: resourcePlan.autoOffload,
        offloadMode: resolvedOffloadMode,
      },
      autoResourcePlan: autoCandidate ? (autoCandidate as unknown as JsonObject) : undefined,
      autoResourceCandidates: autoResourcePlan?.candidates
        ? (autoResourcePlan.candidates as unknown as JsonObject[])
        : undefined,
      autoResourceProofStatus: autoCandidate?.proof?.status,
      autoResourceCandidateId: autoCandidate?.id,
      resourceRetryModes: resourcePlan.retryOffloadModes,
      resourceRetryPlans: autoRetryPlans as unknown as JsonObject[],
      compatibilityStatus: autoCandidate?.proof?.status ?? (form.resourceMode === 'auto' ? 'needs_setup' : 'expert'),
      lowVramMode,
      cudaBudgetPolicy: 'advisory',
      enforceCudaBudget: false,
      requestedCudaReserveBytes: reserveBytes,
      requestedCudaBudgetBytes,
      clientRunId: runIdentity?.clientRunId,
      runInputHash: runIdentity?.runInputHash,
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
      strict: true,
      seed: studio.form.seed,
      promptSettingsHash,
      ...(template ? { templateId: template.id } : {}),
      ...(templateLockHash ? { templateLockHash } : {}),
    },
    provenance,
  };
}
