import {
  ANIMATEDIFF_MOTION_REPO,
  ANIMATEDIFF_MOTION_REVISION,
  ANIMATELCM_MOTION_REPO,
  ANIMATELCM_MOTION_REVISION,
  FLUX_DEV_FP8_REPO,
  FLUX_DEV_REPO,
  FLUX_DEV_REVISION,
  FLUX_KONTEXT_NVFP4_REPO,
  HUNYUAN_DIT_CONTROLNET_CANNY_REPO,
  HUNYUAN_DIT_DISTILLED_REPO,
  HUNYUAN_DIT_DISTILLED_REVISION,
  JANUS_PRO_1B_REPO,
  JANUS_PRO_1B_REVISION,
  STABLE_VIDEO_DIFFUSION_REPO,
  STABLE_VIDEO_DIFFUSION_REVISION,
  STUDIO_MODEL_PROFILES,
  getModelRequirementsForMode,
} from './modelProfiles';
import type { StudioFormState, StudioTemplate, StudioTemplateModelArtifact } from './types';

export type ModelUseScope =
  | 'commercial_allowed'
  | 'noncommercial_only'
  | 'personal_noncommercial'
  | 'research_academic_only'
  | 'license_review_required'
  | 'rights_undetermined';
export type ModelAccessPolicy = 'public' | 'huggingface_gated' | 'unknown';

type ModelUsagePolicyBase = {
  id: string;
  repository: string;
  useScope: ModelUseScope;
  acknowledgementRequired: boolean;
  shortSummary: string;
  termsUrl: string;
  reviewedRevision: string;
  policyVersion: string;
  reviewedAt: string;
};

export type ModelUsagePolicy = ModelUsagePolicyBase &
  (
    | { access: 'huggingface_gated'; modelCardUrl: string }
    | { access: Exclude<ModelAccessPolicy, 'huggingface_gated'>; modelCardUrl?: never }
  );

export type ResolvedModelUsagePolicy = ModelUsagePolicy & {
  revision?: string;
};

const UNDECLARED_MOTION_RIGHTS_NOTICE =
  'This snapshot does not declare a license for its motion weights. Independently establish authorization before use; MoDiff grants no rights.';

const fluxDevPolicy = (
  repository: string,
  reviewedRevision: string,
  termsDocument: 'LICENSE.md' | 'README.md' = 'LICENSE.md',
): ModelUsagePolicy => ({
  id: `flux-dev-noncommercial:${repository}`,
  repository,
  useScope: 'noncommercial_only',
  acknowledgementRequired: true,
  shortSummary:
    'Model access and weight use follow the FLUX.1 [dev] Non-Commercial License; generated-output use is described separately in those terms.',
  termsUrl: `https://huggingface.co/${repository}/blob/${reviewedRevision}/${termsDocument}`,
  modelCardUrl: `https://huggingface.co/${repository}/tree/${reviewedRevision}`,
  access: 'huggingface_gated',
  reviewedRevision,
  policyVersion: '2026-08-04',
  reviewedAt: '2026-08-04',
});

const HUNYUAN_DIT_POLICY: ModelUsagePolicy = {
  id: 'hunyuan-license',
  repository: HUNYUAN_DIT_DISTILLED_REPO,
  useScope: 'commercial_allowed',
  acknowledgementRequired: true,
  shortSummary:
    'Tencent terms allow commercial use below the 100M-MAU threshold; AUP, notice, public machine-generation disclosure, and other restrictions apply.',
  termsUrl:
    'https://huggingface.co/Tencent-Hunyuan/HunyuanDiT/blob/b47a590cac7a3e1a973036700e45b3fe457e2239/LICENSE.txt',
  access: 'public',
  reviewedRevision: HUNYUAN_DIT_DISTILLED_REVISION,
  policyVersion: '2026-08-13',
  reviewedAt: '2026-08-13',
};

/**
 * Reviewed usage policies for dependencies that need an explicit user notice.
 * Components render this data generically; they must not infer rights from a
 * repository name, a license substring, a GPU type, or a template id.
 */
export const MODEL_USAGE_POLICIES: Readonly<Record<string, ModelUsagePolicy>> = Object.freeze({
  [HUNYUAN_DIT_DISTILLED_REPO]: HUNYUAN_DIT_POLICY,
  [HUNYUAN_DIT_CONTROLNET_CANNY_REPO]: HUNYUAN_DIT_POLICY,
  [ANIMATEDIFF_MOTION_REPO]: {
    id: 'undeclared-weight-license:animatediff-v1-5-2',
    repository: ANIMATEDIFF_MOTION_REPO,
    useScope: 'rights_undetermined',
    acknowledgementRequired: true,
    shortSummary: UNDECLARED_MOTION_RIGHTS_NOTICE,
    termsUrl: `https://huggingface.co/${ANIMATEDIFF_MOTION_REPO}/blob/${ANIMATEDIFF_MOTION_REVISION}/README.md`,
    access: 'public',
    reviewedRevision: ANIMATEDIFF_MOTION_REVISION,
    policyVersion: '2026-08-13',
    reviewedAt: '2026-08-13',
  },
  [ANIMATELCM_MOTION_REPO]: {
    id: 'undeclared-weight-license:animatelcm',
    repository: ANIMATELCM_MOTION_REPO,
    useScope: 'rights_undetermined',
    acknowledgementRequired: true,
    shortSummary: UNDECLARED_MOTION_RIGHTS_NOTICE,
    termsUrl: `https://huggingface.co/${ANIMATELCM_MOTION_REPO}/blob/${ANIMATELCM_MOTION_REVISION}/README.md`,
    access: 'public',
    reviewedRevision: ANIMATELCM_MOTION_REVISION,
    policyVersion: '2026-08-13',
    reviewedAt: '2026-08-13',
  },
  [STABLE_VIDEO_DIFFUSION_REPO]: {
    id: 'stability-ai-community-license:stable-video-diffusion-xt-1-1',
    repository: STABLE_VIDEO_DIFFUSION_REPO,
    useScope: 'commercial_allowed',
    acknowledgementRequired: true,
    shortSummary:
      'The Stability AI Community License permits research, non-commercial, and limited commercial use subject to its registration, revenue, attribution, AUP, and other conditions.',
    termsUrl: `https://huggingface.co/${STABLE_VIDEO_DIFFUSION_REPO}/blob/${STABLE_VIDEO_DIFFUSION_REVISION}/LICENSE.md`,
    modelCardUrl: `https://huggingface.co/${STABLE_VIDEO_DIFFUSION_REPO}/tree/${STABLE_VIDEO_DIFFUSION_REVISION}`,
    access: 'huggingface_gated',
    reviewedRevision: STABLE_VIDEO_DIFFUSION_REVISION,
    policyVersion: '2026-08-13',
    reviewedAt: '2026-08-13',
  },
  [JANUS_PRO_1B_REPO]: {
    id: 'deepseek-model-license-v1:janus-pro-1b',
    repository: JANUS_PRO_1B_REPO,
    useScope: 'license_review_required',
    acknowledgementRequired: true,
    shortSummary:
      'DeepSeek Model License Agreement v1.0 has use restrictions and distribution or hosted-use duties. Acknowledgement is review, not product legal approval.',
    termsUrl: `https://huggingface.co/${JANUS_PRO_1B_REPO}/blob/${JANUS_PRO_1B_REVISION}/LICENSE-MODEL`,
    access: 'public',
    reviewedRevision: JANUS_PRO_1B_REVISION,
    policyVersion: '2026-08-15',
    reviewedAt: '2026-08-15',
  },
  [FLUX_DEV_REPO]: fluxDevPolicy(FLUX_DEV_REPO, FLUX_DEV_REVISION),
  'black-forest-labs/FLUX.1-Krea-dev': fluxDevPolicy(
    'black-forest-labs/FLUX.1-Krea-dev',
    '8162a9c7b05a641be098422bf2fcf335615c2f28',
  ),
  'black-forest-labs/FLUX.1-Kontext-dev': fluxDevPolicy(
    'black-forest-labs/FLUX.1-Kontext-dev',
    '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d',
  ),
  'black-forest-labs/FLUX.1-Fill-dev': fluxDevPolicy(
    'black-forest-labs/FLUX.1-Fill-dev',
    '358293da0354175698b67ec8299acf928313a78a',
  ),
  'black-forest-labs/FLUX.1-Depth-dev': fluxDevPolicy(
    'black-forest-labs/FLUX.1-Depth-dev',
    'fb5e9b1bae41b8c8adcea4ea2a87b74dd298f07a',
  ),
  'black-forest-labs/FLUX.1-Canny-dev': fluxDevPolicy(
    'black-forest-labs/FLUX.1-Canny-dev',
    '27c3d8bdc17509b47cf4fd9ba25ab1c7508a69a2',
  ),
  'black-forest-labs/FLUX.1-Redux-dev': fluxDevPolicy(
    'black-forest-labs/FLUX.1-Redux-dev',
    'c95859fbf7703ca4d6824b4da4407d7cd0434f81',
  ),
  [FLUX_DEV_FP8_REPO]: fluxDevPolicy(FLUX_DEV_FP8_REPO, '2fcc6a7ddee78972c8834226b37a09cebff1b6de', 'README.md'),
  [FLUX_KONTEXT_NVFP4_REPO]: fluxDevPolicy(
    FLUX_KONTEXT_NVFP4_REPO,
    '7e9dee453a3454251216a394697a6dcea44f54f8',
    'README.md',
  ),
  'alvarobartt/ghibli-characters-flux-lora': {
    id: 'ghibli-characters-personal-noncommercial',
    repository: 'alvarobartt/ghibli-characters-flux-lora',
    useScope: 'personal_noncommercial',
    acknowledgementRequired: true,
    shortSummary: 'Personal, non-commercial use only under the adapter’s published terms.',
    termsUrl:
      'https://huggingface.co/alvarobartt/ghibli-characters-flux-lora/blob/ed846114c71efc525e7f5a51e274dc976bb970a8/README.md',
    access: 'public',
    reviewedRevision: 'ed846114c71efc525e7f5a51e274dc976bb970a8',
    policyVersion: '2026-08-04',
    reviewedAt: '2026-08-04',
  },
  'ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA': {
    id: 'ace-step-chinese-new-year-research-academic-only',
    repository: 'ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA',
    useScope: 'research_academic_only',
    acknowledgementRequired: true,
    shortSummary: 'Research and academic exchange only; the model card prohibits commercial use.',
    termsUrl:
      'https://huggingface.co/ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA/blob/cb829a12775740c830a6d49795f16913065dc492/README.md',
    access: 'public',
    reviewedRevision: 'cb829a12775740c830a6d49795f16913065dc492',
    policyVersion: '2026-08-05',
    reviewedAt: '2026-08-05',
  },
});

export function usagePolicyForRepository(repository: string | null | undefined) {
  if (!repository) return null;
  return MODEL_USAGE_POLICIES[repository] ?? null;
}

function hubArtifact(artifact: StudioTemplateModelArtifact | undefined) {
  if (!artifact || artifact.source !== 'hub' || !artifact.value.trim()) return null;
  return artifact;
}

function workflowArtifacts(template: StudioTemplate) {
  const artifacts: StudioTemplateModelArtifact[] = [];
  const add = (artifact: StudioTemplateModelArtifact | undefined) => {
    const value = hubArtifact(artifact);
    if (value) artifacts.push(value);
  };
  const lora = template.workflowBlockSettings?.lora;
  add(lora?.model);
  add(lora?.baseModel);
  for (const adapter of lora?.additionalAdapters ?? []) {
    add(adapter.model);
    add(adapter.baseModel);
  }
  add(template.workflowBlockSettings?.upscaler?.model);
  add(template.workflowBlockSettings?.soundtrack?.model);
  add(template.workflowBlockSettings?.lyricVideo?.visualModel);
  return artifacts;
}

export function templateUsagePolicies(template: StudioTemplate): ResolvedModelUsagePolicy[] {
  const profile = STUDIO_MODEL_PROFILES[template.modelType];
  const dependencies: Array<{ repository: string; revision?: string }> = [
    { repository: profile.defaultRepo },
    ...getModelRequirementsForMode(profile, template.mode).map((requirement) => ({
      repository: requirement.repo,
      revision: requirement.revision,
    })),
    ...workflowArtifacts(template).map((artifact) => ({
      repository: artifact.value,
      revision: artifact.revision,
    })),
  ];
  return resolvedUsagePolicies(dependencies);
}

function resolvedUsagePolicies(dependencies: Array<{ repository: string; revision?: string }>) {
  const policies = dependencies.flatMap((dependency) => {
    const policy = usagePolicyForRepository(dependency.repository);
    return policy ? [{ ...policy, revision: dependency.revision ?? policy.reviewedRevision }] : [];
  });
  return policies.filter((policy, index) => policies.findIndex((candidate) => candidate.id === policy.id) === index);
}

export function acknowledgementRequiredForModelRun(
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
): ResolvedModelUsagePolicy[] {
  const profile = STUDIO_MODEL_PROFILES[form.modelType];
  const revision = profile.revisionCandidates?.length === 1 ? profile.revisionCandidates[0] : undefined;
  return resolvedUsagePolicies([
    { repository: profile.defaultRepo, revision },
    ...getModelRequirementsForMode(profile, form.mode).map((requirement) => ({
      repository: requirement.repo,
      revision: requirement.revision,
    })),
  ]).filter((policy) => policy.acknowledgementRequired && policy.useScope === 'license_review_required');
}

export function acknowledgementRequiredForTemplate(template: StudioTemplate) {
  return templateUsagePolicies(template).filter((policy) => policy.acknowledgementRequired);
}

function fingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function usagePolicyAcknowledgementKey(policies: readonly ResolvedModelUsagePolicy[]) {
  const contract = policies
    .filter((policy) => policy.acknowledgementRequired)
    .map(
      (policy) =>
        `${policy.id}|${policy.repository}|artifact:${policy.revision ?? 'unpinned'}|review:${policy.reviewedRevision}|policy:${policy.policyVersion}|${policy.termsUrl}`,
    )
    .sort()
    .join('\n');
  return contract ? `terms-v2:${fingerprint(contract)}` : null;
}

export function repositoryRequiresHuggingFaceGate(repository: string | null | undefined) {
  return usagePolicyForRepository(repository)?.access === 'huggingface_gated';
}
