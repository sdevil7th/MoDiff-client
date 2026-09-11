import assert from 'node:assert/strict';
import { test } from 'node:test';

import { galleryArgsForResourceJob, selectResourceQualificationJobs } from './resource-qualification-campaign.mjs';

const contract = {
  templates: [
    {
      id: 'slow',
      modelType: 'FluxSchnellPipeline',
      lastSuccessfulRealRun: {
        executionDurationSeconds: 100,
        evidenceMatch: 'current',
        proofFormat: 'modiff.live-proof.provenance.v2',
        provenancePath: 'data/slow.json',
      },
    },
    {
      id: 'fast',
      modelType: 'FluxSchnellPipeline',
      lastSuccessfulRealRun: {
        executionDurationSeconds: 20,
        evidenceMatch: 'current',
        proofFormat: 'modiff.live-proof.provenance.v2',
        provenancePath: 'data/fast.json',
      },
    },
  ],
};
const coverage = {
  recipes: [
    {
      status: 'missing',
      releaseLane: 'release_eligible',
      modelType: 'FluxSchnellPipeline',
      dtype: 'bfloat16',
      offloadMode: 'model_cpu',
      quantizationMode: 'none',
      templates: ['slow', 'fast'],
    },
    {
      status: 'missing',
      releaseLane: 'release_eligible',
      modelType: 'FluxSchnellPipeline',
      dtype: 'bfloat16',
      offloadMode: 'group_disk',
      quantizationMode: 'quanto_float8',
      templates: ['fast'],
    },
  ],
};

test('resource campaign chooses the shortest locked representative and excludes quantized recipes by default', () => {
  const jobs = selectResourceQualificationJobs(contract, coverage, {
    templates: [],
    offloadModes: [],
    includeDeferred: false,
    includeQuantized: false,
    maxRecipes: Number.POSITIVE_INFINITY,
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].templateId, 'fast');
  assert.equal(jobs[0].offloadMode, 'model_cpu');
  assert.equal(jobs[0].baselineExecutionDurationSeconds, 20);
});

test('resource campaign runs the shortest missing recipe before alphabetical model order', () => {
  const jobs = selectResourceQualificationJobs(
    {
      templates: [
        {
          id: 'alphabetical-slow',
          lastSuccessfulRealRun: {
            executionDurationSeconds: 200,
            evidenceMatch: 'current',
            proofFormat: 'modiff.live-proof.provenance.v2',
            provenancePath: 'data/alphabetical-slow.json',
          },
        },
        {
          id: 'later-fast',
          lastSuccessfulRealRun: {
            executionDurationSeconds: 10,
            evidenceMatch: 'current',
            proofFormat: 'modiff.live-proof.provenance.v2',
            provenancePath: 'data/later-fast.json',
          },
        },
      ],
    },
    {
      recipes: [
        {
          status: 'missing',
          releaseLane: 'release_eligible',
          modelType: 'AlphaPipeline',
          dtype: 'bfloat16',
          offloadMode: 'model_cpu',
          quantizationMode: 'none',
          templates: ['alphabetical-slow'],
        },
        {
          status: 'missing',
          releaseLane: 'release_eligible',
          modelType: 'ZuluPipeline',
          dtype: 'bfloat16',
          offloadMode: 'model_cpu',
          quantizationMode: 'none',
          templates: ['later-fast'],
        },
      ],
    },
    {
      templates: [],
      offloadModes: [],
      includeDeferred: false,
      includeQuantized: false,
      maxRecipes: 1,
    },
  );

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].modelType, 'ZuluPipeline');
  assert.equal(jobs[0].templateId, 'later-fast');
});

test('resource campaign invokes one full-workload receipt run with the exact recipe', () => {
  const job = selectResourceQualificationJobs(contract, coverage, {
    templates: [],
    offloadModes: [],
    includeDeferred: false,
    includeQuantized: true,
    maxRecipes: Number.POSITIVE_INFINITY,
  }).find((candidate) => candidate.offloadMode === 'model_cpu');
  const args = galleryArgsForResourceJob(job, {
    server: 'http://127.0.0.1:8088',
    port: 5194,
    timeoutMs: 1000,
    queueWaitTimeoutMs: 2000,
  });
  assert.ok(args.includes('--record-resource-qualification'));
  assert.deepEqual(args.slice(args.indexOf('--offload-mode'), args.indexOf('--offload-mode') + 2), [
    '--offload-mode',
    'model_cpu',
  ]);
  assert.deepEqual(args.slice(args.indexOf('--quantization-mode'), args.indexOf('--quantization-mode') + 2), [
    '--quantization-mode',
    'none',
  ]);
  assert.equal(args.includes('--steps'), false);
  assert.equal(args.includes('--width'), false);
  assert.equal(args.includes('--height'), false);
});

test('resource campaign honors an explicitly requested owning template', () => {
  const jobs = selectResourceQualificationJobs(contract, coverage, {
    templates: ['slow'],
    offloadModes: [],
    includeDeferred: false,
    includeQuantized: false,
    maxRecipes: Number.POSITIVE_INFINITY,
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].templateId, 'slow');
  assert.equal(jobs[0].baselineExecutionDurationSeconds, 100);
});

test('resource campaign blocks a recipe before inference when no current v2 baseline exists', () => {
  const jobs = selectResourceQualificationJobs(
    {
      templates: [{ id: 'unproven', modelType: 'WanTI2VPipeline', lastSuccessfulRealRun: null }],
    },
    {
      recipes: [
        {
          status: 'missing',
          releaseLane: 'deferred',
          modelType: 'WanTI2VPipeline',
          dtype: 'bfloat16',
          offloadMode: 'none',
          quantizationMode: 'none',
          templates: ['unproven'],
        },
      ],
    },
    {
      templates: ['unproven'],
      offloadModes: ['none'],
      includeDeferred: true,
      includeQuantized: false,
      maxRecipes: Number.POSITIVE_INFINITY,
    },
  );

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'blocked');
  assert.match(jobs[0].blocker, /baseline/);
  assert.throws(
    () =>
      galleryArgsForResourceJob(jobs[0], {
        server: 'http://127.0.0.1:8088',
        port: 5194,
        timeoutMs: 1000,
        queueWaitTimeoutMs: 2000,
      }),
    /without a current v2 locked-template baseline/,
  );
});
