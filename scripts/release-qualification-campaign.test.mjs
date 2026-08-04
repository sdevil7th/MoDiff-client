import assert from 'node:assert/strict';
import test from 'node:test';
import {
  campaignStatusForRunner,
  galleryArgsForGroup,
  jobGroups,
  modelFamilyForTemplate,
  selectedJobs,
} from './release-qualification-campaign.mjs';

const contract = {
  templates: [
    {
      id: 'complete',
      modelType: 'ZImagePipeline',
      outputContract: { mediaKinds: ['image'] },
      qualificationReceiptMissingFields: [],
    },
    {
      id: 'image-incomplete',
      modelType: 'QwenImagePipeline',
      outputContract: { mediaKinds: ['image'] },
      qualificationReceiptMissingFields: ['receipt'],
    },
    {
      id: 'video-incomplete',
      modelType: 'WanPipeline',
      outputContract: { mediaKinds: ['video'] },
      qualificationReceiptMissingFields: ['receipt'],
    },
    {
      id: 'ace_step_chinese_new_year_lora',
      modelType: 'AceStepAudioPipeline',
      outputContract: { mediaKinds: ['audio'] },
      qualificationReceiptMissingFields: ['receipt'],
    },
  ],
};

function campaignArgs(overrides = {}) {
  return {
    templates: [],
    excludedMedia: [],
    maxTemplates: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

test('qualification campaign dry-run lists only incomplete locked templates', () => {
  const report = selectedJobs(contract, campaignArgs({ maxTemplates: 2 }));
  assert.equal(report.jobs.length, 2);
  assert.equal(
    report.jobs.every((job) => job.status === 'pending'),
    true,
  );
  assert.equal(
    report.jobs.every((job) => job.missing.length > 0),
    true,
  );
});

test('fast qualification dry-run excludes video outputs and groups jobs by model family', () => {
  const report = selectedJobs(contract, campaignArgs({ excludedMedia: ['video'] }));
  const groups = jobGroups(report.jobs, true);
  assert.equal(
    report.jobs.every((job) => !job.mediaKinds.includes('video')),
    true,
  );
  assert.equal(
    report.deferred.some((job) => job.status === 'deferred_media' && job.mediaKinds.includes('video')),
    true,
  );
  assert.equal(
    report.jobs.some((job) => job.templateId === 'ace_step_chinese_new_year_lora'),
    true,
  );
  assert.equal(
    groups.every((group) => group.jobs.length > 0),
    true,
  );
});

test('related pipeline adapters share one qualification model family', () => {
  assert.equal(modelFamilyForTemplate({ modelType: 'QwenImageEditModularPipeline' }), 'Qwen Image');
  assert.equal(modelFamilyForTemplate({ modelType: 'FluxKontextPipeline' }), 'FLUX Image');
  assert.equal(modelFamilyForTemplate({ modelType: 'AceStepAudioPipeline' }), 'ACE-Step Audio');
});

test('qualification executes locked non-exact templates without conflating execution with gallery approval', () => {
  const args = galleryArgsForGroup(
    {
      batchByModelFamily: true,
      port: 5194,
      timeoutMs: 10_000,
      queueWaitTimeoutMs: 5_000,
      reuseExistingRuntimeKey: 'ZImagePipeline:auto-planned',
    },
    ['z_image_lora_style'],
  );
  assert.equal(args.includes('--allow-non-exact'), true);
  assert.equal(args.includes('--record-qualification'), true);
  assert.equal(args.includes('--stop-on-failure'), true);
  assert.deepEqual(args.slice(args.indexOf('--resource-mode'), args.indexOf('--resource-mode') + 2), [
    '--resource-mode',
    'auto',
  ]);
  assert.equal(args.includes('--reuse-runtime-within-model'), true);
  assert.deepEqual(
    args.slice(args.indexOf('--reuse-existing-runtime-key'), args.indexOf('--reuse-existing-runtime-key') + 2),
    ['--reuse-existing-runtime-key', 'ZImagePipeline:auto-planned'],
  );
});

test('qualification campaign stops distinctly on runner infrastructure loss', () => {
  assert.equal(campaignStatusForRunner({ status: 0, error: null }), 'qualified');
  assert.equal(campaignStatusForRunner({ status: 1, error: null }), 'failed');
  assert.equal(campaignStatusForRunner({ status: 70, error: null }), 'infrastructure_failed');
});
