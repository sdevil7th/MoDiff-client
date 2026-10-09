import type { ModelCacheDiagnostics, NodeData, RuntimeStatus } from '../stores/useNodeStore';
import { getRepoCacheStatus } from './modelCache';
import {
  autoPlanIsReady,
  autoResourceCompatibility,
  autoResourceInstallTarget,
  type StudioCompatibilityAssessment,
  type StudioAutoResourcePlan,
} from './autoResource';
import { getModelRequirementsForMode, STUDIO_MODEL_LABELS, STUDIO_MODEL_PROFILES } from './modelProfiles';
import { resolveTemplateInputs } from './templateInputs';
import { buildRunReadinessDecision } from './runReadiness';
import type {
  RunReadinessDecision,
  RunReadinessIssue,
  RunReadinessIssueAction,
  RunReadinessIssueCategory,
  StudioFormState,
  StudioModelRequirement,
  StudioTemplate,
  StudioTemplateInputRequirements,
  StudioTemplateModelArtifact,
} from './types';
import { backendNodeKeysForCapability } from './templateBackendCapabilities';
import { resolveTemplateModelSelection } from './templateModelSelection';
import { optionalRuntimeBlockState, type OptionalRuntimeCatalog } from './optionalRuntimes';
import type { StudioModelProfile } from './types';
export { isTemplateBackendCapabilityRecognized, templateBackendNodeKeys } from './templateBackendCapabilities';

export type TemplateReadinessStatus =
  'ready' | 'needs_input' | 'needs_model' | 'needs_backend' | 'needs_setup' | 'preparing' | 'planning';

export type TemplateReadinessTone = 'success' | 'warning' | 'error' | 'info' | 'default';

export type TemplateReadinessIssue = {
  id: string;
  category: RunReadinessIssueCategory;
  blocking: boolean;
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
  form?: StudioFormState;
  hfCache: unknown[];
  localModels: unknown[];
  modelCacheDiagnostics: ModelCacheDiagnostics | null;
  runtimeStatus: RuntimeStatus | null;
  nodesRegistry: Record<string, NodeData>;
  autoResourcePlan?: StudioAutoResourcePlan | null;
  modelIndexesRefreshing?: boolean;
  studioModelCapabilities?: StudioModelProfile[];
  optionalRuntimeCatalog?: OptionalRuntimeCatalog | null;
};

export type TemplateReadinessResult = {
  status: TemplateReadinessStatus;
  label: string;
  tone: TemplateReadinessTone;
  summary: string;
  compatibility:
    | StudioCompatibilityAssessment
    | (Omit<StudioCompatibilityAssessment, 'source'> & { source: 'backend_execution_profile' });
  issues: TemplateReadinessIssue[];
  missingModelRepos: string[];
  modelInstallTargets: Array<{
    repoId: string;
    repair?: boolean;
    actionLabel?: string;
    revision?: string;
    files?: string[];
  }>;
  missingInputs: string[];
  missingBackendCapabilities: string[];
  decision: RunReadinessDecision;
};

function runActionForTemplateAction(action: TemplateReadinessIssue['action']): RunReadinessIssueAction | undefined {
  if (action === 'install_model') return 'install_model';
  if (action === 'open_models') return 'open_model_manager';
  if (action === 'open_assets' || action === 'add_input') return 'select_image';
  if (action === 'open_setup') return 'open_setup';
  if (action === 'apply_low_vram') return 'apply_low_vram_preset';
  return undefined;
}

function runIssueForTemplateIssue(item: TemplateReadinessIssue): RunReadinessIssue {
  return {
    id: `template:${item.id}`,
    category: item.category,
    severity:
      item.tone === 'error'
        ? 'error'
        : item.tone === 'warning'
          ? 'warning'
          : item.tone === 'success'
            ? 'success'
            : 'info',
    repoId: item.repoId,
    message: item.title,
    details: item.detail,
    blocking: item.blocking,
    action: runActionForTemplateAction(item.action),
  };
}

function hasRegistry(nodesRegistry: Record<string, NodeData>) {
  return Object.keys(nodesRegistry).length > 0;
}

function missingBackendCapabilities(template: StudioTemplate, nodesRegistry: Record<string, NodeData>) {
  const capabilities = template.requiredBackendCapabilities ?? [];
  if (capabilities.length === 0) return [];

  return capabilities.filter((capability) => {
    const nodeKeys = backendNodeKeysForCapability(capability);
    if (!nodeKeys) return true;
    return hasRegistry(nodesRegistry) && !nodeKeys.every((nodeKey) => nodesRegistry[nodeKey]);
  });
}

function isPinnedHubArtifact(
  artifact: StudioTemplateModelArtifact | undefined,
): artifact is StudioTemplateModelArtifact {
  return artifact?.source === 'hub' && artifact.value.trim().length > 0;
}

function missingInputLabels(template: StudioTemplate, requirements: StudioTemplateInputRequirements | undefined) {
  const missing = resolveTemplateInputs(template).missingLabels;
  if (!requirements) return missing;
  if (requirements.loraAdapter && !isPinnedHubArtifact(template.workflowBlockSettings?.lora?.model)) {
    missing.push('LoRA adapter');
  }
  if (requirements.upscalerModel && !isPinnedHubArtifact(template.workflowBlockSettings?.upscaler?.model)) {
    missing.push('Upscaler model');
  }
  return Array.from(new Set(missing));
}

function artifactRepoId(artifact: StudioTemplateModelArtifact) {
  const [owner, repo] = artifact.value.split('/');
  return owner && repo ? `${owner}/${repo}` : artifact.value;
}

function workflowModelRequirements(template: StudioTemplate): StudioModelRequirement[] {
  const requirements: StudioModelRequirement[] = [];
  const addArtifact = (id: string, label: string, artifact: StudioTemplateModelArtifact | undefined) => {
    if (!isPinnedHubArtifact(artifact)) return;
    requirements.push({
      id,
      label,
      repo: artifactRepoId(artifact),
      revision: artifact.revision,
      kind: 'adapter',
      requiredForModes: [template.mode],
      description: `${label} pinned by ${template.label}.`,
    });
  };

  addArtifact(`${template.id}-lora`, 'LoRA adapter', template.workflowBlockSettings?.lora?.model);
  addArtifact(`${template.id}-lora-base`, 'LoRA base model', template.workflowBlockSettings?.lora?.baseModel);
  for (const [index, adapter] of (template.workflowBlockSettings?.lora?.additionalAdapters ?? []).entries()) {
    addArtifact(`${template.id}-lora-${index + 2}`, `LoRA adapter ${index + 2}`, adapter.model);
    addArtifact(`${template.id}-lora-${index + 2}-base`, `LoRA base model ${index + 2}`, adapter.baseModel);
  }
  addArtifact(`${template.id}-upscaler`, 'Upscaler model', template.workflowBlockSettings?.upscaler?.model);
  return requirements;
}

function modelRequirements(template: StudioTemplate): StudioModelRequirement[] {
  const profile = STUDIO_MODEL_PROFILES[template.modelType];
  return [
    ...(profile.artifactInstallRequired === false
      ? []
      : [
          {
            id: `${template.modelType}-base`,
            label: profile.label,
            repo: profile.defaultRepo,
            kind: 'base' as const,
            requiredForModes: [template.mode],
            description: `Base model for ${profile.label}.`,
          },
        ]),
    ...getModelRequirementsForMode(profile, template.mode),
    ...workflowModelRequirements(template),
  ];
}

function statusCopy(status: TemplateReadinessStatus) {
  if (status === 'ready') return { label: 'Ready now', tone: 'success' as const };
  if (status === 'needs_input') return { label: 'Needs input', tone: 'warning' as const };
  if (status === 'needs_model') return { label: 'Needs model', tone: 'warning' as const };
  if (status === 'needs_backend') return { label: 'Backend blocked', tone: 'error' as const };
  if (status === 'needs_setup') return { label: 'Needs setup', tone: 'warning' as const };
  if (status === 'preparing') return { label: 'Checking models', tone: 'info' as const };
  return { label: 'Planning only', tone: 'info' as const };
}

function needsLocalCompatibilityProof(template: StudioTemplate) {
  void template;
  return false;
}

/** Custom recipe admission checks prerequisites, never an Auto fit or media proof. */
function customRecipeReadiness(template: StudioTemplate, context: TemplateReadinessContext): TemplateReadinessResult {
  const selected = resolveTemplateModelSelection(template, context.studioModelCapabilities ?? []);
  const issues: TemplateReadinessIssue[] = [];
  const modelInstallTargets: TemplateReadinessResult['modelInstallTargets'] = [];
  const missingRepos: string[] = [];
  const backendIssues = missingBackendCapabilities(template, context.nodesRegistry);
  const inputIssues = missingInputLabels(template, template.inputRequirements);
  const planningOnly =
    template.readinessPolicy === 'planning' ||
    template.difficulty === 'blocked' ||
    template.example?.status === 'blocked';
  const checkingModels = context.modelIndexesRefreshing === true;
  const addSetup = (id: string, title: string, detail: string, category: RunReadinessIssueCategory = 'package') =>
    issues.push({ id, category, blocking: true, tone: 'error', title, detail, action: 'open_setup' });

  if (planningOnly)
    issues.push({
      id: 'planning',
      category: 'graph',
      blocking: true,
      tone: 'info',
      title: 'Planning template',
      detail: template.example?.blockReason ?? 'This experimental recipe has not been admitted for normal use.',
      action: 'open_planning',
    });
  if (context.form?.resourceMode !== 'expert')
    addSetup(
      'custom:memory',
      'Custom memory required',
      'This experimental recipe declares Custom settings; no Auto fit is qualified.',
      'environment',
    );
  if (!selected)
    addSetup(
      'custom:contract',
      'Exact backend recipe needed',
      'The declared profile, model artifact and immutable revision must match the backend contract.',
      'backend',
    );
  if (!hasRegistry(context.nodesRegistry))
    addSetup(
      'backend:registry',
      'Backend contract needed',
      'Connect to the backend and refresh its node registry.',
      'backend',
    );
  backendIssues.forEach((capability) => addSetup(`backend:${capability}`, 'Backend contract needed', capability));
  const runtime = context.runtimeStatus;
  if (
    runtime?.ready !== true ||
    runtime.runtimeEnvironment?.profileVerified !== true ||
    runtime.runtimeEnvironment?.executionReady !== true ||
    (runtime.missing_required_packages?.length ?? 0) > 0 ||
    ['torch', 'diffusers', 'transformers', 'peft'].some((name) => runtime.packages?.[name]?.available !== true)
  )
    addSetup(
      'custom:base-runtime',
      'Standard runtime needs repair',
      'Verify the installed accelerator runtime and required Torch, Diffusers, Transformers and PEFT packages.',
    );
  if (selected) {
    const requirement = selected.profile.optionalRuntimeRequirement;
    const declaredOptional = selected.profile.optional_runtime_profiles ?? [];
    const invalidRequirement =
      declaredOptional.length > 0 &&
      (!requirement ||
        !requirement.executionProfileIds.includes(selected.profile.id) ||
        (requirement.requiredNow && !requirement.profileIds.some((id) => declaredOptional.includes(id))));
    const runtimeBlock = optionalRuntimeBlockState(requirement, context.optionalRuntimeCatalog ?? null);
    if (invalidRequirement || runtimeBlock)
      addSetup(
        'custom:optional-runtime',
        'Recipe runtime needed',
        invalidRequirement
          ? 'Refresh the exact backend runtime requirement for this recipe.'
          : `${requirement?.reason ?? 'Required recipe runtime is not active.'} (${runtimeBlock})`,
      );

    const artifactSelection = selected.capability.artifactSelections?.find(
      (item) =>
        item.repo === selected.repository && item.revision === selected.revision && item.modes.includes(template.mode),
    );
    const requirements: StudioModelRequirement[] = [
      {
        id: `${template.id}-base`,
        label: selected.profile.id,
        repo: selected.repository,
        revision: selected.revision,
        kind: 'base',
        downloadFiles:
          artifactSelection?.downloadFiles ??
          (selected.capability.defaultRepo === selected.repository ? selected.capability.downloadFiles : undefined),
      },
      ...getModelRequirementsForMode(selected.capability, template.mode),
      ...workflowModelRequirements(template),
    ];
    if (!checkingModels)
      for (const requirement of requirements) {
        // Exact recipe checks must not accept a different repository with a matching substring.
        const exactCache = context.hfCache.filter((entry) =>
          typeof entry === 'string'
            ? entry === requirement.repo
            : entry && typeof entry === 'object' && (entry as { id?: unknown }).id === requirement.repo,
        );
        const cache = getRepoCacheStatus(
          requirement.repo,
          exactCache,
          context.localModels,
          context.modelCacheDiagnostics,
          { revision: requirement.revision, files: requirement.downloadFiles },
        );
        if (cache.runnable) continue;
        const repair =
          cache.repairRequired ||
          exactCache.some((entry) => {
            if (!entry || typeof entry !== 'object') return false;
            const status = entry as { complete?: unknown; installed?: unknown; repair_required?: unknown };
            return status.complete === false || status.installed === false || status.repair_required === true;
          });
        missingRepos.push(requirement.repo);
        const actionLabel = repair ? 'Repair' : 'Install';
        modelInstallTargets.push({
          repoId: requirement.repo,
          revision: requirement.revision,
          files: requirement.downloadFiles,
          repair,
          actionLabel,
        });
        issues.push({
          id: `model:${requirement.repo}`,
          category: repair ? 'model_integrity' : 'model',
          blocking: true,
          tone: repair ? 'error' : 'warning',
          title: repair ? 'Exact model package repair required' : 'Model package missing',
          detail: `${requirement.repo}${requirement.revision ? ` @ ${requirement.revision}` : ''}: ${cache.reason}`,
          action: 'install_model',
          repoId: requirement.repo,
          repair,
          actionLabel,
        });
      }
  }
  if (checkingModels)
    issues.push({
      id: 'model-index-refresh',
      category: 'model',
      blocking: true,
      tone: 'info',
      title: 'Checking installed models',
      detail: 'Refreshing the local model index before reporting recipe prerequisites.',
    });
  inputIssues.forEach((input) =>
    issues.push({
      id: `input:${input}`,
      category: 'asset',
      blocking: true,
      tone: 'warning',
      title: `${input} required`,
      detail: 'Add the declared required input before running this workflow.',
      action: 'open_assets',
    }),
  );
  const decision = buildRunReadinessDecision(issues.map(runIssueForTemplateIssue), { preparing: checkingModels });
  const category = decision.primaryIssue?.category;
  const status: TemplateReadinessStatus = planningOnly
    ? 'planning'
    : decision.state === 'preparing'
      ? 'preparing'
      : decision.state !== 'blocked'
        ? 'ready'
        : category === 'backend' || category === 'package'
          ? 'needs_backend'
          : category === 'model' || category === 'model_integrity'
            ? 'needs_model'
            : category === 'asset' || category === 'user_input'
              ? 'needs_input'
              : 'needs_setup';
  const copy = statusCopy(status);
  const summary =
    status === 'ready'
      ? 'Required packages, exact model artifacts and inputs are available. This uses Custom memory; hardware fit and output quality remain experimental.'
      : (issues[0]?.detail ?? 'Review the declared recipe prerequisites.');
  return {
    status,
    label: status === 'ready' ? 'Custom · experimental' : copy.label,
    tone: status === 'ready' ? 'warning' : copy.tone,
    summary,
    compatibility: {
      state: status === 'ready' ? 'ready' : status === 'needs_model' ? 'needs_model' : 'needs_setup',
      severity: 'warning',
      code: 'custom_recipe_experimental',
      summary: 'Custom memory · experimental',
      detail: 'Checks recipe prerequisites without claiming Auto hardware fit or validated output quality.',
      source: 'backend_execution_profile',
    },
    issues,
    missingModelRepos: Array.from(new Set(missingRepos)),
    modelInstallTargets: Array.from(new Map(modelInstallTargets.map((target) => [target.repoId, target])).values()),
    missingInputs: inputIssues,
    missingBackendCapabilities: backendIssues,
    decision,
  };
}

export function getTemplateReadiness(
  template: StudioTemplate,
  context: TemplateReadinessContext,
): TemplateReadinessResult {
  if (template.executionSelection?.memoryPolicy === 'custom_experimental')
    return customRecipeReadiness(template, context);
  const profile = STUDIO_MODEL_PROFILES[template.modelType];
  const autoReady = autoPlanIsReady(context.autoResourcePlan, context.form);
  const autoInstallTarget = autoResourceInstallTarget(context.autoResourcePlan, context.form);
  const compatibility = autoResourceCompatibility(context.autoResourcePlan, context.form);
  const checkingModels = context.modelIndexesRefreshing === true;
  const planningOnly =
    template.readinessPolicy === 'planning' ||
    template.difficulty === 'blocked' ||
    template.example?.status === 'blocked';
  const backendUnavailable = !context.runtimeStatus && !hasRegistry(context.nodesRegistry);
  const backendIssues = missingBackendCapabilities(template, context.nodesRegistry);
  const inputIssues = missingInputLabels(template, template.inputRequirements);
  const missingRepos = checkingModels
    ? []
    : [
        ...(context.autoResourcePlan
          ? getModelRequirementsForMode(profile, template.mode)
          : modelRequirements(template)),
        ...(context.autoResourcePlan ? workflowModelRequirements(template) : []),
      ]
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
      category: 'graph',
      blocking: true,
      tone: 'info',
      title: 'Planning template',
      detail:
        template.example?.blockReason ??
        'This recipe can be opened and inspected, but MoDiff should not present it as runnable yet.',
      action: 'open_planning',
    });
  }

  if (checkingModels) {
    issues.push({
      id: 'model-index-refresh',
      category: 'model',
      blocking: true,
      tone: 'info',
      title: 'Checking installed models',
      detail: 'Refreshing the local model index before reporting template readiness.',
    });
  }

  if (!checkingModels && compatibility.state === 'checking') {
    issues.push({
      id: 'auto-plan-checking',
      category: 'environment',
      blocking: true,
      tone: 'info',
      title: compatibility.summary,
      detail: compatibility.detail,
    });
  }

  if (backendUnavailable) {
    issues.push({
      id: 'backend:connection',
      category: 'backend',
      blocking: true,
      tone: 'error',
      title: 'Backend connection needed',
      detail: 'Connect to the MoDiff backend before checking installed models.',
      action: 'open_setup',
    });
  }

  backendIssues.forEach((capability) => {
    issues.push({
      id: `backend:${capability}`,
      category: 'package',
      blocking: true,
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
      category: 'model',
      blocking: true,
      tone: 'warning',
      title: 'Model package missing',
      detail: repoId,
      action: 'install_model',
      repoId,
      actionLabel: 'Install',
    });
  });

  if (!checkingModels && !autoReady && autoInstallTarget) {
    modelInstallTargets.push({
      repoId: autoInstallTarget.repo,
      repair: autoInstallTarget.repair,
      actionLabel: autoInstallTarget.actionLabel,
    });
    issues.push({
      id: `auto-model:${autoInstallTarget.repo}`,
      category: autoInstallTarget.repair ? 'model_integrity' : 'model',
      blocking: true,
      tone: autoInstallTarget.repair ? 'error' : 'warning',
      title: autoInstallTarget.repair ? 'Model package repair required' : 'Auto model package missing',
      detail: `${autoInstallTarget.actionLabel ?? 'Install Auto artifact'}: ${autoInstallTarget.repo}`,
      action: 'install_model',
      repoId: autoInstallTarget.repo,
      repair: autoInstallTarget.repair,
      actionLabel: autoInstallTarget.actionLabel,
    });
  } else if (!checkingModels && !autoReady && context.autoResourcePlan && !autoInstallTarget) {
    issues.push({
      id: 'auto-plan-blocked',
      category:
        context.autoResourcePlan.issue?.category === 'environment'
          ? 'environment'
          : context.autoResourcePlan.issue?.category === 'package'
            ? 'package'
            : context.autoResourcePlan.issue?.category === 'device'
              ? 'hardware_fit'
              : 'environment',
      blocking: true,
      tone: compatibility.severity === 'error' ? 'error' : compatibility.severity === 'warning' ? 'warning' : 'info',
      title: compatibility.summary,
      detail: compatibility.detail,
      action: compatibility.state === 'expert_only' ? 'open_planning' : 'open_setup',
    });
  }

  inputIssues.forEach((input) => {
    issues.push({
      id: `input:${input}`,
      category: 'asset',
      blocking: true,
      tone: 'warning',
      title: `${input} required`,
      detail:
        'Add the required asset in Studio after creating this workflow, or open the Assets library to reuse an existing output.',
      action: 'open_assets',
    });
  });

  const decision = buildRunReadinessDecision(issues.map(runIssueForTemplateIssue), {
    preparing: checkingModels || compatibility.state === 'checking',
  });
  const primaryCategory = decision.primaryIssue?.category;
  const status: TemplateReadinessStatus =
    planningOnly || issues.some((item) => item.action === 'open_planning')
      ? 'planning'
      : decision.state === 'preparing' || needsLocalCompatibilityProof(template)
        ? 'preparing'
        : decision.state !== 'blocked'
          ? 'ready'
          : primaryCategory === 'backend' || primaryCategory === 'package'
            ? 'needs_backend'
            : primaryCategory === 'model' || primaryCategory === 'model_integrity'
              ? 'needs_model'
              : primaryCategory === 'asset' || primaryCategory === 'user_input'
                ? 'needs_input'
                : 'needs_setup';

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
    compatibility,
    issues,
    missingModelRepos: Array.from(new Set(missingRepos)),
    modelInstallTargets: Array.from(new Map(modelInstallTargets.map((target) => [target.repoId, target])).values()),
    missingInputs: inputIssues,
    missingBackendCapabilities: backendIssues,
    decision,
  };
}
