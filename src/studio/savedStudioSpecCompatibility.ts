import type { StudioGraphBinding } from './types';

// Reviewed authoring-only updates. Both revisions have the same owners, ports,
// and profile. The backend retains the old exact contracts for Run receipts.
const ATTENTION_DEFAULT_UPDATES = [
  {
    modelType: 'DDPMPipeline',
    id: 'ddpm-cifar10:unconditional-image:v1',
    executionProfileId: 'ddpm-cifar10:direct',
    previousHash: 'studio-spec-v1-6a3b6073',
    currentHash: 'studio-spec-v1-02c5414e',
  },
  {
    modelType: 'ConsistencyModelPipeline',
    id: 'consistency-imagenet64:unconditional-image:v1',
    executionProfileId: 'consistency-imagenet64:direct',
    previousHash: 'studio-spec-v1-95990ceb',
    currentHash: 'studio-spec-v1-f3633720',
  },
] as const;

export function savedAttentionDefaultUpdate(binding: StudioGraphBinding | null) {
  const receipt = binding?.executionSpec;
  if (!receipt || receipt.schemaVersion !== 1 || binding.mode !== 'unconditional_image') return undefined;
  return ATTENTION_DEFAULT_UPDATES.find(
    (update) =>
      update.modelType === binding.modelType &&
      update.id === receipt.id &&
      update.executionProfileId === receipt.executionProfileId &&
      update.previousHash === receipt.contentHash,
  );
}
