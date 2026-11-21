import type { StudioGraphBinding } from './types';

// Reviewed authoring-only updates. Both revisions have the same owners, ports,
// and profile. The backend retains the old exact contracts for Run receipts.
const ATTENTION_DEFAULT_UPDATES = [
  {
    modelType: 'DDPMPipeline',
    mode: 'unconditional_image',
    id: 'ddpm-cifar10:unconditional-image:v1',
    executionProfileId: 'ddpm-cifar10:direct',
    previousHash: 'studio-spec-v1-6a3b6073',
    currentHash: 'studio-spec-v1-02c5414e',
  },
  {
    modelType: 'ConsistencyModelPipeline',
    mode: 'unconditional_image',
    id: 'consistency-imagenet64:unconditional-image:v1',
    executionProfileId: 'consistency-imagenet64:direct',
    previousHash: 'studio-spec-v1-95990ceb',
    currentHash: 'studio-spec-v1-f3633720',
  },
  {
    modelType: 'AnimateDiffPipeline',
    mode: 'text_to_video',
    id: 'animatediff:text-to-video:v1',
    executionProfileId: 'animatediff-sd15-v2:direct',
    previousHash: 'studio-spec-v1-ccb16ca8',
    currentHash: 'studio-spec-v1-47f27245',
  },
  {
    modelType: 'AnimateDiffPAGPipeline',
    mode: 'text_to_video',
    id: 'animatediff-pag:text-to-video:v1',
    executionProfileId: 'animatediff-sd15-v2-pag:direct',
    previousHash: 'studio-spec-v1-e980c1b1',
    currentHash: 'studio-spec-v1-9033412a',
  },
  {
    modelType: 'AnimateLCMPipeline',
    mode: 'text_to_video',
    id: 'animatelcm:text-to-video:v1',
    executionProfileId: 'animatelcm-sd15:direct',
    previousHash: 'studio-spec-v1-aba7ebb7',
    currentHash: 'studio-spec-v1-c5d9ff8c',
  },
  {
    modelType: 'CogVideoXPipeline',
    mode: 'text_to_video',
    id: 'cogvideox-2b:text-to-video:v1',
    executionProfileId: 'cogvideox-2b:direct',
    previousHash: 'studio-spec-v1-0993e43c',
    currentHash: 'studio-spec-v1-407c9ddf',
  },
  {
    modelType: 'SanaVideoPipeline',
    mode: 'text_to_video',
    id: 'sana-video-480p:text-to-video:v1',
    executionProfileId: 'sana-video-480p:direct',
    previousHash: 'studio-spec-v1-b2fedfda',
    currentHash: 'studio-spec-v1-3b63a399',
  },
] as const;

export function savedAttentionDefaultUpdate(binding: StudioGraphBinding | null) {
  const receipt = binding?.executionSpec;
  if (!receipt || receipt.schemaVersion !== 1) return undefined;
  return ATTENTION_DEFAULT_UPDATES.find(
    (update) =>
      update.modelType === binding.modelType &&
      update.mode === binding.mode &&
      update.id === receipt.id &&
      update.executionProfileId === receipt.executionProfileId &&
      update.previousHash === receipt.contentHash,
  );
}
