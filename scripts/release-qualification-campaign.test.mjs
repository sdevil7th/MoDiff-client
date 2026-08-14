import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  appCacheUrl,
  appReadinessForJobs,
  campaignStatusForRunner,
  galleryArgsForGroup,
  inputReadinessForJobs,
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
      server: 'http://127.0.0.1:8088',
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
  assert.deepEqual(args.slice(args.indexOf('--server'), args.indexOf('--server') + 2), [
    '--server',
    'http://127.0.0.1:8088',
  ]);
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

test('qualification app readiness requires every exact app-installed artifact revision', () => {
  const jobs = [
    {
      templateId: 'ready-template',
      requiredArtifacts: [
        { repo: 'owner/model', revision: 'a'.repeat(40), role: 'model' },
        { repo: 'owner/lora', revision: 'b'.repeat(40), role: 'lora' },
      ],
    },
  ];
  const readiness = appReadinessForJobs(jobs, [
    {
      id: 'owner/model',
      installed: true,
      complete: true,
      repair_required: false,
      revisions: [{ hash: 'a'.repeat(40) }],
    },
    {
      id: 'owner/lora',
      installed: true,
      complete: true,
      repair_required: false,
      revisions: [{ hash: 'b'.repeat(40) }],
    },
  ]);
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.readyJobCount, 1);
  assert.equal(readiness.readyArtifactCount, 2);
  assert.deepEqual(readiness.blockedJobs, []);
});

test('qualification app readiness fails closed for absent, incomplete, repair, and receipt gaps', () => {
  const revision = 'c'.repeat(40);
  const readiness = appReadinessForJobs(
    [
      {
        templateId: 'repair-template',
        requiredArtifacts: [{ repo: 'owner/repair', revision, role: 'model' }],
      },
      {
        templateId: 'missing-template',
        requiredArtifacts: [{ repo: 'owner/missing', revision, role: 'model' }],
      },
      { templateId: 'receiptless-template', requiredArtifacts: [] },
    ],
    [
      {
        id: 'owner/repair',
        installed: true,
        complete: false,
        repair_required: true,
        revisions: [{ hash: revision }],
      },
    ],
  );
  assert.equal(readiness.status, 'blocked');
  assert.equal(readiness.blockedJobCount, 3);
  assert.deepEqual(
    readiness.blockedJobs.map((job) => job.blockedArtifacts[0].reason),
    ['repair_required', 'repository_missing', 'artifact_receipt_missing'],
  );
});

test('qualification app readiness permits only uncredentialed loopback HTTP origins', () => {
  assert.equal(appCacheUrl('http://127.0.0.1:8088/path'), 'http://127.0.0.1:8088/hf_cache');
  assert.equal(appCacheUrl('https://localhost:8443'), 'https://localhost:8443/hf_cache');
  assert.equal(appCacheUrl('http://[::1]:8088'), 'http://[::1]:8088/hf_cache');
  for (const server of ['https://example.com', 'file:///tmp/app', 'http://user:secret@127.0.0.1:8088', 'not a URL']) {
    assert.throws(() => appCacheUrl(server), /loopback/);
  }
});

test('qualification app readiness rejects malformed app inventory and artifact receipts', () => {
  assert.throws(
    () => appReadinessForJobs([], [{ id: 'owner/model', revisions: [{ hash: 'main' }] }]),
    /malformed|bound/,
  );
  assert.throws(
    () =>
      appReadinessForJobs(
        [{ templateId: 'moving', requiredArtifacts: [{ repo: 'owner/model', revision: 'main', role: 'model' }] }],
        [],
      ),
    /immutable revision/,
  );
});

test('qualification input readiness verifies exact local default-input bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'modiff-qualification-inputs-'));
  try {
    const bytes = Buffer.from('byte-pinned qualification input');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const runtimePath = `/template-gallery/runtime-inputs/assets/${digest}.webp`;
    const localPath = join(root, runtimePath.replace(/^\/+/, ''));
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, bytes);
    const readiness = inputReadinessForJobs(
      [{ templateId: 'with-input' }, { templateId: 'text-only' }],
      {
        'with-input': [
          {
            field: 'referenceImages',
            defaultAssets: [{ runtimePath, runtimeSha256: `sha256:bytes:${digest}` }],
          },
        ],
      },
      {
        assets: [
          {
            path: runtimePath.replace(/^\/+/, ''),
            sha256: `sha256:bytes:${digest}`,
            size: bytes.length,
          },
        ],
      },
      [join(root, 'lightweight-client-public'), root],
    );
    assert.equal(readiness.status, 'ready');
    assert.equal(readiness.jobCount, 2);
    assert.equal(readiness.assetCount, 1);
    assert.equal(readiness.requiredBytes, bytes.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('qualification input readiness blocks absent and hash-mismatched local bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'modiff-qualification-inputs-'));
  try {
    const expected = Buffer.from('expected');
    const digest = createHash('sha256').update(expected).digest('hex');
    const runtimePath = `/template-gallery/runtime-inputs/assets/${digest}.png`;
    const bindings = {
      input: [
        {
          field: 'controlImage',
          defaultAssets: [{ runtimePath, runtimeSha256: `sha256:bytes:${digest}` }],
        },
      ],
    };
    const manifest = {
      assets: [
        {
          path: runtimePath.replace(/^\/+/, ''),
          sha256: `sha256:bytes:${digest}`,
          size: expected.length,
        },
      ],
    };
    const missing = inputReadinessForJobs([{ templateId: 'input' }], bindings, manifest, root);
    assert.equal(missing.status, 'blocked');
    assert.equal(missing.blockedAssets[0].reason, 'local_file_missing');

    const localPath = join(root, runtimePath.replace(/^\/+/, ''));
    mkdirSync(dirname(localPath), { recursive: true });
    writeFileSync(localPath, Buffer.from('tampered'));
    const mismatched = inputReadinessForJobs([{ templateId: 'input' }], bindings, manifest, root);
    assert.equal(mismatched.blockedAssets[0].reason, 'sha256_mismatch');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('qualification input readiness rejects unpinned binding and manifest metadata', () => {
  assert.throws(
    () =>
      inputReadinessForJobs(
        [{ templateId: 'input' }],
        {
          input: [
            {
              field: 'sourceVideo',
              defaultAssets: [
                {
                  runtimePath: '/template-gallery/runtime-inputs/assets/moving.png',
                  runtimeSha256: 'sha256:bytes:not-a-digest',
                },
              ],
            },
          ],
        },
        { assets: [] },
        '/tmp',
      ),
    /content-addressed/,
  );
});
