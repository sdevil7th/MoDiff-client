import {
  FLUX_DEV_FP8_REPO,
  FLUX_DEV_REPO,
  FLUX_DEV_REVISION,
  FLUX_KONTEXT_NVFP4_REPO,
  STUDIO_MODEL_PROFILES,
} from './modelProfiles';
import type { StudioTemplate, StudioTemplateModelArtifact } from './types';

export type ModelUseScope =
  'commercial_allowed' | 'noncommercial_only' | 'personal_noncommercial' | 'research_academic_only';
export type ModelAccessPolicy = 'public' | 'huggingface_gated' | 'unknown';

export type ModelUsagePolicy = {
  id: string;
  repository: string;
  useScope: ModelUseScope;
  acknowledgementRequired: boolean;
  shortSummary: string;
  termsUrl: string;
  modelCardUrl: string;
  access: ModelAccessPolicy;
  reviewedRevision: string;
  policyVersion: string;
  reviewedAt: string;
};

export type ResolvedModelUsagePolicy = ModelUsagePolicy & {
  revision?: string;
};

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

/**
 * Reviewed usage policies for dependencies that need an explicit user notice.
 * Components render this data generically; they must not infer rights from a
 * repository name, a license substring, a GPU type, or a template id.
 */
export const MODEL_USAGE_POLICIES: Readonly<Record<string, ModelUsagePolicy>> = Object.freeze({
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
    modelCardUrl:
      'https://huggingface.co/alvarobartt/ghibli-characters-flux-lora/tree/ed846114c71efc525e7f5a51e274dc976bb970a8',
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
    modelCardUrl:
      'https://huggingface.co/ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA/tree/cb829a12775740c830a6d49795f16913065dc492',
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
    ...workflowArtifacts(template).map((artifact) => ({
      repository: artifact.value,
      revision: artifact.revision,
    })),
  ];
  const policies = dependencies.flatMap((dependency) => {
    const policy = usagePolicyForRepository(dependency.repository);
    return policy ? [{ ...policy, revision: dependency.revision ?? policy.reviewedRevision }] : [];
  });
  return Array.from(new Map(policies.map((policy) => [`${policy.id}:${policy.revision ?? ''}`, policy])).values());
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
