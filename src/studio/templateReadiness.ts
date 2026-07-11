import type { ModelCacheDiagnostics, NodeData, RuntimeStatus } from '../stores/useNodeStore';
import { getRepoCacheStatus } from './modelCache';
import { getStudioModelHardwareFit, type ModelHardwareFit } from './modelHardware';
import {
  autoPlanIsReady,
  autoResourceHealthBadge,
  autoResourceInstallTarget,
  type StudioAutoResourcePlan,
} from './autoResource';
import {
  getModelRequirementsForMode,
  QWEN_INPAINT_GENERATE_NODE_KEY,
  QWEN_INPAINT_PIPELINE_NODE_KEY,
  QWEN_LOW_VRAM_QUANTIZATION_COMPONENT,
  QWEN_OUTPAINT_CANVAS_NODE_KEY,
  QWEN_T2I_GENERATE_NODE_KEY,
  QWEN_T2I_PIPELINE_NODE_KEY,
  STUDIO_MODEL_LABELS,
  STUDIO_MODEL_PROFILES,
} from './modelProfiles';
import type { StudioFormState, StudioModelRequirement, StudioTemplate, StudioTemplateInputRequirements } from './types';

export type TemplateReadinessStatus =
  'ready' | 'needs_input' | 'needs_model' | 'needs_backend' | 'preparing' | 'planning';

export type TemplateReadinessTone = 'success' | 'warning' | 'error' | 'info' | 'default';

export type TemplateReadinessIssue = {
  id: string;
  tone: TemplateReadinessTone;
  title: string;
  detail: string;
  action?:
    'add_input' | 'install_model' | 'open_models' | 'open_assets' | 'open_setup' | 'apply_low_vram' | 'open_planning';
  repoId?: string;
  repair?: boolean;
  actionLabel?: string;
};

export type TemplateReadinessContext = {
  form: StudioFormState;
  hfCache: unknown[];
  localModels: unknown[];
  modelCacheDiagnostics: ModelCacheDiagnostics | null;
  runtimeStatus: RuntimeStatus | null;
  nodesRegistry: Record<string, NodeData>;
  autoResourcePlan?: StudioAutoResourcePlan | null;
};

export type TemplateReadinessResult = {
  status: TemplateReadinessStatus;
  label: string;
  tone: TemplateReadinessTone;
  summary: string;
  hardwareFit: ModelHardwareFit;
  issues: TemplateReadinessIssue[];
  missingModelRepos: string[];
  modelInstallTargets: Array<{ repoId: string; repair?: boolean; actionLabel?: string }>;
  missingInputs: string[];
  missingBackendCapabilities: string[];
};

const CAPABILITY_NODE_KEYS: Record<string, string[]> = {
  'Qwen direct Auto Diffusers path': [QWEN_T2I_PIPELINE_NODE_KEY, QWEN_T2I_GENERATE_NODE_KEY],
  'Qwen low-VRAM quantized Modular Diffusers path': [QWEN_T2I_PIPELINE_NODE_KEY, QWEN_T2I_GENERATE_NODE_KEY],
  'Qwen ControlNet Union graph contract': [
    'modules.ModularDiffusers.AutoModelLoader',
    'modules.ModularDiffusers.Controlnet',
  ],
  'LoRA loader node with pinned adapter hash': [
    'modules.ModularDiffusers.ModelsLoader',
    'modules.ModularDiffusers.Lora',
  ],
  'Spandrel or equivalent upscaler graph block': ['modules.Spandrel.Upscaler', 'modules.Image.Preview'],
  'layer output metadata and per-layer media hashes': [
    'modules.ModularDiffusers.DecodeLatents',
    'modules.Image.Preview',
  ],
  'native inpaint mask graph contract': [
    QWEN_INPAINT_PIPELINE_NODE_KEY,
    QWEN_INPAINT_GENERATE_NODE_KEY,
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'outpaint canvas, mask, and placement controls': [
    QWEN_INPAINT_PIPELINE_NODE_KEY,
    QWEN_OUTPAINT_CANVAS_NODE_KEY,
    QWEN_INPAINT_GENERATE_NODE_KEY,
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'outpaint canvas, mask, and boundary-fill graph contract': [
    QWEN_INPAINT_PIPELINE_NODE_KEY,
    QWEN_OUTPAINT_CANVAS_NODE_KEY,
    QWEN_INPAINT_GENERATE_NODE_KEY,
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'modules.VideoConditioning.ReferenceImages': ['modules.Image.Load', 'modules.WanVACE.Generate'],
  'Diffusers audio direct pipeline': [
    'modules.DiffusersAudio.LoadPipeline',
    'modules.DiffusersAudio.Generate',
    'modules.Audio.Export',
  ],
  'Diffusers image direct pipeline': [
    'modules.DiffusersImage.LoadPipeline',
    'modules.DiffusersImage.Generate',
    'modules.Image.Preview',
  ],
  'Diffusers image edit pipeline': [
    'modules.DiffusersImage.LoadPipeline',
    'modules.DiffusersImage.Edit',
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'Diffusers image inpaint pipeline': [
    'modules.DiffusersImage.LoadPipeline',
    'modules.DiffusersImage.Inpaint',
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'Diffusers image control pipeline': [
    'modules.DiffusersImage.LoadPipeline',
    'modules.DiffusersImage.ControlGenerate',
    'modules.Image.Load',
    'modules.Image.Preview',
  ],
  'Diffusers artifact quantization node': ['modules.ModelArtifact.QuantizeDiffusersComponents'],
};

function hasRegistry(nodesRegistry: Record<string, NodeData>) {
  return Object.keys(nodesRegistry).length > 0;
}

function capabilityNodeKeys(capability: string) {
  if (CAPABILITY_NODE_KEYS[capability]) return CAPABILITY_NODE_KEYS[capability];
  return capability.startsWith('modules.') ? [capability] : [];
}

function nodeParam(nodesRegistry: Record<string, NodeData>, nodeKey: string, paramKey: string) {
  return nodesRegistry[nodeKey]?.params?.[paramKey];
}

function paramOptions(param: unknown) {
  if (!param || typeof param !== 'object' || !('options' in param)) return [];
  const options = (param as { options?: unknown }).options;
  return Array.isArray(options) ? options.map(String) : [];
}

function hasQwenLowVramBackend(nodesRegistry: Record<string, NodeData>) {
  const hasDirectPath = Boolean(
    nodesRegistry[QWEN_T2I_PIPELINE_NODE_KEY] &&
    nodesRegistry[QWEN_T2I_GENERATE_NODE_KEY] &&
    nodeParam(nodesRegistry, QWEN_T2I_PIPELINE_NODE_KEY, 'quantization_mode') &&
    nodeParam(nodesRegistry, QWEN_T2I_PIPELINE_NODE_KEY, 'quantized_components') &&
    nodeParam(nodesRegistry, QWEN_T2I_PIPELINE_NODE_KEY, 'offload_mode'),
  );
  const hasModularPath = Boolean(
    nodesRegistry['modules.ModularDiffusers.ModelsLoader'] &&
    nodesRegistry['modules.ModularDiffusers.QuantizationConfigNode'] &&
    nodeParam(nodesRegistry, 'modules.ModularDiffusers.ModelsLoader', 'offload_mode') &&
    paramOptions(nodeParam(nodesRegistry, 'modules.ModularDiffusers.QuantizationConfigNode', 'component')).includes(
      QWEN_LOW_VRAM_QUANTIZATION_COMPONENT,
    ),
  );
  return hasDirectPath || hasModularPath;
}

function missingBackendCapabilities(template: StudioTemplate, nodesRegistry: Record<string, NodeData>) {
  const capabilities = template.requiredBackendCapabilities ?? [];
  if (capabilities.length === 0) return [];

  return capabilities.filter((capability) => {
    if (
      capability === 'Qwen direct Auto Diffusers path' ||
      capability === 'Qwen low-VRAM quantized Modular Diffusers path'
    ) {
      return hasRegistry(nodesRegistry) && !hasQwenLowVramBackend(nodesRegistry);
    }

    const nodeKeys = capabilityNodeKeys(capability);
    if (nodeKeys.length > 0) {
      return hasRegistry(nodesRegistry) && !nodeKeys.every((nodeKey) => nodesRegistry[nodeKey]);
    }

    const normalized = capability.toLowerCase();
    return (
      normalized.includes('lora') ||
      normalized.includes('spandrel') ||
      normalized.includes('upscaler') ||
      normalized.includes('layer output') ||
      normalized.includes('outpaint') ||
      normalized.includes('inpaint')
    );
  });
}

function missingInputLabels(requirements: StudioTemplateInputRequirements | undefined, form: StudioFormState) {
  if (!requirements) return [];
  const missing: string[] = [];
  const referenceCount = form.referenceImages.filter(Boolean).length;

  if (requirements.sourceImage && referenceCount < 1) missing.push('Source image');
  if (requirements.referenceImages && referenceCount < requirements.referenceImages) {
    missing.push(`${requirements.referenceImages} reference image${requirements.referenceImages === 1 ? '' : 's'}`);
  }
  if (requirements.controlImage && !form.controlImage) missing.push('Control image');
  if (requirements.maskImage && !form.maskImage) missing.push('Mask image');
  if (requirements.sourceVideo && !form.sourceVideo) missing.push('Source video');
  if (requirements.maskVideo && !form.maskVideo) missing.push('Mask video');
  if (requirements.controlVideo && !form.controlVideo) missing.push('Control video');
  if (requirements.sourceAudio && !form.sourceAudio) missing.push('Source audio');
  if (requirements.referenceAudio && !form.referenceAudio) missing.push('Reference audio');
  if (requirements.loraAdapter) missing.push('LoRA adapter');
  if (requirements.upscalerModel) missing.push('Upscaler model');
  return Array.from(new Set(missing));
}

function modelRequirements(template: StudioTemplate): StudioModelRequirement[] {
  const profile = STUDIO_MODEL_PROFILES[template.modelType];
  return [
    {
      id: `${template.modelType}-base`,
      label: profile.label,
      repo: profile.defaultRepo,
      kind: 'base',
      requiredForModes: [template.mode],
      description: `Base model for ${profile.label}.`,
    },
    ...getModelRequirementsForMode(profile, template.mode),
  ];
}

function statusCopy(status: TemplateReadinessStatus) {
  if (status === 'ready') return { label: 'Ready now', tone: 'success' as const };
  if (status === 'needs_input') return { label: 'Needs input', tone: 'warning' as const };
  if (status === 'needs_model') return { label: 'Needs model', tone: 'warning' as const };
  if (status === 'needs_backend') return { label: 'Backend blocked', tone: 'error' as const };
  if (status === 'preparing') return { label: 'Preparing Auto plan', tone: 'info' as const };
  return { label: 'Planning only', tone: 'info' as const };
}

function needsLocalCompatibilityProof(template: StudioTemplate) {
  void template;
  return false;
}

export function getTemplateReadiness(
  template: StudioTemplate,
  context: TemplateReadinessContext,
): TemplateReadinessResult {
  const profile = STUDIO_MODEL_PROFILES[template.modelType];
  const autoReady = autoPlanIsReady(context.autoResourcePlan);
  const autoInstallTarget = autoResourceInstallTarget(context.autoResourcePlan);
  const autoHealthBadge = autoResourceHealthBadge(context.autoResourcePlan);
  const hardwareFit = getStudioModelHardwareFit(profile, context.runtimeStatus);
  const planningOnly =
    template.readinessPolicy === 'planning' ||
    template.difficulty === 'blocked' ||
    template.example?.status === 'blocked';
  const backendIssues = missingBackendCapabilities(template, context.nodesRegistry);
  const inputIssues = missingInputLabels(template.inputRequirements, context.form);
  const missingRepos = (
    context.autoResourcePlan ? getModelRequirementsForMode(profile, template.mode) : modelRequirements(template)
  )
    .filter(
      (requirement) =>
        !getRepoCacheStatus(requirement.repo, context.hfCache, context.localModels, context.modelCacheDiagnostics)
          .runnable,
    )
    .map((requirement) => requirement.repo);

  const issues: TemplateReadinessIssue[] = [];
  const modelInstallTargets: Array<{ repoId: string; repair?: boolean; actionLabel?: string }> = [];

  if (planningOnly) {
    issues.push({
      id: 'planning',
      tone: 'info',
      title: 'Planning template',
      detail:
        template.example?.blockReason ??
        'This recipe can be opened and inspected, but MoDiff should not present it as runnable yet.',
      action: 'open_planning',
    });
  }

  backendIssues.forEach((capability) => {
    issues.push({
      id: `backend:${capability}`,
      tone: 'error',
      title: 'Backend contract needed',
      detail: capability,
      action: 'open_setup',
    });
  });

  missingRepos.forEach((repoId) => {
    modelInstallTargets.push({ repoId, actionLabel: 'Install' });
    issues.push({
      id: `model:${repoId}`,
      tone: 'warning',
      title: 'Model package missing',
      detail: repoId,
      action: 'install_model',
      repoId,
      actionLabel: 'Install',
    });
  });

  if (!autoReady && autoInstallTarget) {
    modelInstallTargets.push({
      repoId: autoInstallTarget.repo,
      repair: autoInstallTarget.repair,
      actionLabel: autoInstallTarget.actionLabel,
    });
    issues.push({
      id: `auto-model:${autoInstallTarget.repo}`,
      tone: autoInstallTarget.repair ? 'error' : 'warning',
      title: autoInstallTarget.repair ? 'Model package repair required' : 'Auto model package missing',
      detail: `${autoInstallTarget.actionLabel ?? 'Install Auto artifact'}: ${autoInstallTarget.repo}`,
      action: 'install_model',
      repoId: autoInstallTarget.repo,
      repair: autoInstallTarget.repair,
      actionLabel: autoInstallTarget.actionLabel,
    });
  } else if (!autoReady && context.autoResourcePlan && !autoInstallTarget) {
    issues.push({
      id: 'auto-plan-blocked',
      tone:
        autoHealthBadge === 'Will not work on this machine' || autoHealthBadge === 'Failed here before'
          ? 'error'
          : 'info',
      title: autoHealthBadge,
      detail:
        context.autoResourcePlan.willNotWorkReason ||
        context.autoResourcePlan.blockingReason ||
        context.autoResourcePlan.message ||
        'Auto cannot choose a runnable local recipe for this template.',
      action: autoHealthBadge === 'Expert only' ? 'open_planning' : 'open_setup',
    });
  }

  if (hardwareFit.status === 'blocked') {
    issues.push({
      id: 'hardware-blocked',
      tone: 'error',
      title: hardwareFit.label,
      detail: hardwareFit.details ?? hardwareFit.message,
      action: 'open_setup',
    });
  } else if (hardwareFit.status === 'warning') {
    issues.push({
      id: 'hardware-warning',
      tone: 'warning',
      title: hardwareFit.label,
      detail: hardwareFit.details ?? hardwareFit.message,
      action: 'apply_low_vram',
    });
  }

  inputIssues.forEach((input) => {
    issues.push({
      id: `input:${input}`,
      tone: 'warning',
      title: `${input} required`,
      detail:
        'Add the required asset in Studio after creating this workflow, or open the Assets library to reuse an existing output.',
      action: 'open_assets',
    });
  });

  let status: TemplateReadinessStatus = 'ready';
  if (planningOnly) {
    status = 'planning';
  } else if (backendIssues.length > 0) {
    status = 'needs_backend';
  } else if (!autoReady && context.autoResourcePlan && autoHealthBadge === 'Expert only') {
    status = 'planning';
  } else if (
    missingRepos.length > 0 ||
    Boolean(autoInstallTarget) ||
    (!autoReady && context.autoResourcePlan && autoHealthBadge !== 'Expert only') ||
    hardwareFit.status === 'blocked'
  ) {
    status = 'needs_model';
  } else if (inputIssues.length > 0) {
    status = 'needs_input';
  } else if (needsLocalCompatibilityProof(template)) {
    status = 'preparing';
  }

  const copy = statusCopy(status);
  const summary =
    status === 'ready'
      ? `${STUDIO_MODEL_LABELS[template.modelType]} Auto plan is ready, hardware looks usable, and no required inputs are missing.`
      : (issues[0]?.detail ?? 'Review the required setup before running this recipe.');

  return {
    status,
    label: copy.label,
    tone: copy.tone,
    summary,
    hardwareFit,
    issues,
    missingModelRepos: Array.from(new Set(missingRepos)),
    modelInstallTargets: Array.from(new Map(modelInstallTargets.map((target) => [target.repoId, target])).values()),
    missingInputs: inputIssues,
    missingBackendCapabilities: backendIssues,
  };
}
