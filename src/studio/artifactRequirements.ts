import type { ModelCacheDiagnostics } from '../stores/useNodeStore';
import {
  autoPlanIsReady,
  autoResourceInstallTarget,
  selectedAutoCandidate,
  type StudioAutoResourceInstallTarget,
  type StudioAutoResourcePlan,
} from './autoResource';
import { getRepoCacheStatus, localModelsContain, type StudioModelCacheStatus } from './modelCache';
import { getModelRequirementsForMode, getProfileForForm } from './modelProfiles';
import type { StudioFormState, StudioModelRequirement } from './types';

export type WorkflowArtifactRequirementRole =
  'Pipeline' | 'Adapter' | 'Control' | 'Text encoder' | 'VAE' | 'Transformer' | 'Other component';

export type WorkflowArtifactPrimaryAction = 'Ready' | 'Install' | 'Repair' | 'Use local' | 'Retry' | 'Details';

export type WorkflowArtifactRequirement = {
  id: string;
  role: WorkflowArtifactRequirementRole;
  label: string;
  repo: string;
  artifact: string;
  source: 'auto' | 'profile' | 'modeRequirement' | 'graph';
  status: StudioModelCacheStatus;
  primaryAction: WorkflowArtifactPrimaryAction;
  installTarget?: StudioAutoResourceInstallTarget;
  nodeId?: string;
  nodeLabel?: string;
  modelPath?: string;
  paramKey?: string;
  details?: string;
};

type WorkflowArtifactRequirementOptions = {
  form: StudioFormState;
  autoResourcePlan?: StudioAutoResourcePlan | null;
  hfCache: unknown[];
  localModels: unknown[];
  modelCacheDiagnostics: ModelCacheDiagnostics | null;
  includePipeline?: boolean;
};

export type WorkflowGraphArtifactReference = {
  nodeId: string;
  nodeLabel?: string;
  kind: 'repo' | 'path';
  value: string;
  paramKey: string;
};

type GraphWorkflowArtifactRequirementOptions = {
  references: WorkflowGraphArtifactReference[];
  hfCache: unknown[];
  localModels: unknown[];
  modelCacheDiagnostics: ModelCacheDiagnostics | null;
};

function roleForRequirement(requirement: StudioModelRequirement): WorkflowArtifactRequirementRole {
  if (requirement.kind === 'controlnet') return 'Control';
  if (requirement.kind === 'adapter') return 'Adapter';
  return roleForArtifact(requirement.repo, requirement.label);
}

function roleForArtifact(repo: string, label = ''): WorkflowArtifactRequirementRole {
  const text = `${repo} ${label}`.toLowerCase();
  if (text.includes('control')) return 'Control';
  if (text.includes('lora') || text.includes('adapter')) return 'Adapter';
  if (text.includes('text_encoder') || text.includes('text encoder') || text.includes('clip') || text.includes('t5'))
    return 'Text encoder';
  if (text.includes('vae')) return 'VAE';
  if (text.includes('transformer') || text.includes('unet') || text.includes('diffusion_model')) return 'Transformer';
  return 'Pipeline';
}

function actionForStatus(
  status: StudioModelCacheStatus,
  installTarget?: StudioAutoResourceInstallTarget,
): WorkflowArtifactPrimaryAction {
  if (status.runnable) return 'Ready';
  if (installTarget?.repair) return 'Repair';
  if (status.matchingExternalRepos.length > 0 || status.matchingExternalPackages.length > 0) return 'Use local';
  return 'Install';
}

function localPathStatus(path: string, localModels: unknown[]): StudioModelCacheStatus {
  const localCached = localModelsContain(localModels, path);
  return {
    hfCached: false,
    localCached,
    appDataDiscovered: false,
    matchingExternalPackages: [],
    matchingExternalRepos: [],
    installed: localCached,
    runnable: localCached,
    reason: localCached ? 'Found in MoDiff local model files' : 'Not found in MoDiff local model files',
    scannedPaths: [],
  };
}

function requirementFromRepo({
  details,
  id,
  installTarget,
  label,
  modelCacheDiagnostics,
  repo,
  role,
  source,
  hfCache,
  localModels,
}: {
  details?: string;
  id: string;
  installTarget?: StudioAutoResourceInstallTarget;
  label: string;
  modelCacheDiagnostics: ModelCacheDiagnostics | null;
  repo: string;
  role: WorkflowArtifactRequirementRole;
  source: WorkflowArtifactRequirement['source'];
  hfCache: unknown[];
  localModels: unknown[];
}): WorkflowArtifactRequirement {
  const status = getRepoCacheStatus(repo, hfCache, localModels, modelCacheDiagnostics);
  return {
    id,
    role,
    label,
    repo,
    artifact: repo,
    source,
    status,
    primaryAction: actionForStatus(status, installTarget),
    installTarget,
    details: details ?? status.reason,
  };
}

function dedupeRequirements(requirements: WorkflowArtifactRequirement[]) {
  const seen = new Set<string>();
  return requirements.filter((requirement) => {
    const key = `${requirement.role}:${requirement.repo}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getStudioWorkflowArtifactRequirements({
  autoResourcePlan,
  form,
  hfCache,
  includePipeline = true,
  localModels,
  modelCacheDiagnostics,
}: WorkflowArtifactRequirementOptions): WorkflowArtifactRequirement[] {
  const profile = getProfileForForm(form);
  const requirements: WorkflowArtifactRequirement[] = [];

  if (includePipeline) {
    if (form.resourceMode === 'auto') {
      const installTarget = autoResourceInstallTarget(autoResourcePlan, form);
      const candidate = selectedAutoCandidate(autoResourcePlan, form);
      const repo =
        installTarget?.repo ??
        candidate?.resolvedArtifact ??
        candidate?.artifact ??
        candidate?.installTarget?.repo ??
        candidate?.modelRepo ??
        profile.defaultRepo;
      const label = installTarget?.label || candidate?.installTarget?.label || profile.label;
      const details =
        installTarget?.reason ??
        candidate?.proof?.message ??
        autoResourcePlan?.blockingReason ??
        autoResourcePlan?.willNotWorkReason ??
        (autoPlanIsReady(autoResourcePlan, form) ? 'Auto-selected artifact is ready.' : undefined);
      requirements.push(
        requirementFromRepo({
          details,
          hfCache,
          id: `auto:${profile.modelType}:${form.mode}:${repo}`,
          installTarget: installTarget ?? { repo, label, actionLabel: 'Install' },
          label,
          localModels,
          modelCacheDiagnostics,
          repo,
          role: roleForArtifact(repo, label),
          source: 'auto',
        }),
      );
    } else {
      requirements.push(
        requirementFromRepo({
          details: profile.artifactLabel,
          hfCache,
          id: `profile:${profile.modelType}:${profile.defaultRepo}`,
          installTarget: { repo: profile.defaultRepo, label: profile.label, actionLabel: 'Install' },
          label: profile.label,
          localModels,
          modelCacheDiagnostics,
          repo: profile.defaultRepo,
          role: 'Pipeline',
          source: 'profile',
        }),
      );
    }
  }

  getModelRequirementsForMode(profile, form.mode).forEach((requirement) => {
    requirements.push(
      requirementFromRepo({
        details: requirement.description,
        hfCache,
        id: `mode:${profile.modelType}:${form.mode}:${requirement.id}`,
        installTarget: { repo: requirement.repo, label: requirement.label, actionLabel: 'Install' },
        label: requirement.label,
        localModels,
        modelCacheDiagnostics,
        repo: requirement.repo,
        role: roleForRequirement(requirement),
        source: 'modeRequirement',
      }),
    );
  });

  return dedupeRequirements(requirements);
}

export function getGraphWorkflowArtifactRequirements({
  references,
  hfCache,
  localModels,
  modelCacheDiagnostics,
}: GraphWorkflowArtifactRequirementOptions): WorkflowArtifactRequirement[] {
  const requirements = references.map((reference): WorkflowArtifactRequirement => {
    const label = reference.value.split(/[\\/]/).pop() || reference.value;
    if (reference.kind === 'path') {
      const status = localPathStatus(reference.value, localModels);
      return {
        id: `graph:${reference.nodeId}:${reference.paramKey}:${reference.value}`,
        role: roleForArtifact(reference.value, label),
        label,
        repo: reference.value,
        artifact: reference.value,
        source: 'graph',
        status,
        primaryAction: status.runnable ? 'Ready' : 'Use local',
        nodeId: reference.nodeId,
        nodeLabel: reference.nodeLabel,
        modelPath: reference.value,
        paramKey: reference.paramKey,
        details: `${status.reason}. Source field: ${reference.paramKey}.`,
      };
    }

    const status = getRepoCacheStatus(reference.value, hfCache, localModels, modelCacheDiagnostics);
    const primaryAction = actionForStatus(status, { repo: reference.value, label, actionLabel: 'Install' });
    return {
      id: `graph:${reference.nodeId}:${reference.paramKey}:${reference.value}`,
      role: roleForArtifact(reference.value, label),
      label,
      repo: reference.value,
      artifact: reference.value,
      source: 'graph',
      status,
      primaryAction,
      installTarget:
        primaryAction === 'Install' || primaryAction === 'Repair'
          ? { repo: reference.value, label, actionLabel: primaryAction }
          : undefined,
      nodeId: reference.nodeId,
      nodeLabel: reference.nodeLabel,
      paramKey: reference.paramKey,
      details: `${status.reason}. Source field: ${reference.paramKey}.`,
    };
  });

  return dedupeRequirements(requirements);
}
