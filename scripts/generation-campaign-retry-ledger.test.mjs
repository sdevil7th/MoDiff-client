import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildRetryLedger,
  classifyCampaignFailure,
  readQualityScreenRejections,
  readUserQualityRejections,
  retryLedgerForReportBytes,
} from './generation-campaign-retry-ledger.mjs';
import { orderCampaignTargetsForRetry } from './review-generation-campaign.mjs';

test('classifies every known campaign failure without converting it to a skip', () => {
  const cases = [
    ['Target page, context or browser has been closed', 'graph_client_lifecycle', 'browser_page_lifecycle'],
    ['Graph finalized before the requested update', 'graph_client_lifecycle', 'graph_finalization'],
    ['optional runtime required', 'runtime', 'optional_runtime'],
    ['Video edge preprocessing needs the gallery-media extra (OpenCV).', 'dependency', 'opencv_gallery_media'],
    ['Controlled artifact byteSize must be a positive integer.', 'artifact', 'controlled_artifact_receipt'],
    ['The selected model snapshot is incomplete.', 'artifact', 'incomplete_model'],
    ['Allegro is missing, so Text to video cannot run.', 'artifact', 'missing_model'],
    ['Studio output was too small to be a campaign image', 'output_integrity', 'implausibly_small_output'],
    [
      'Modular route fields are backend-managed and cannot participate in model identity: generator',
      'backend_action',
      'backend_managed_identity_field',
    ],
  ];
  const results = cases.map(([error], index) => ({
    workflowId: `Pipeline${index}:text_to_image`,
    skeletonId: `skeleton-${index}`,
    status: 'failed',
    error,
  }));
  const ledger = buildRetryLedger({ server: 'http://127.0.0.1:8088', results });
  assert.equal(ledger.summary.retryCount, cases.length);
  assert.equal(ledger.summary.unclassifiedCount, 0);
  for (const [index, retry] of ledger.retries.entries()) {
    assert.deepEqual(classifyCampaignFailure(cases[index][0]), {
      category: cases[index][1],
      defect: cases[index][2],
    });
    assert.equal(retry.state, 'classified');
    assert.equal(retry.nextState, 'reproduction');
    assert.equal(retry.maySkip, false);
    assert.equal(retry.externalBlocker, null);
    assert.equal(retry.error, cases[index][0]);
  }
});

test('excludes completed workflows and produces stable source-bound output', () => {
  const report = {
    server: 'http://127.0.0.1:8088',
    results: [
      { workflowId: 'ReadyPipeline:text_to_image', status: 'completed' },
      { workflowId: 'FailedPipeline:text_to_image', status: 'failed', error: 'new failure' },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(report));
  const first = retryLedgerForReportBytes(bytes);
  const second = retryLedgerForReportBytes(bytes);
  assert.deepEqual(first, second);
  assert.equal(first.retries.length, 1);
  assert.equal(first.retries[0].category, 'unclassified');
  assert.match(first.source.reportSha256, /^[0-9a-f]{64}$/);
  assert.match(first.source.qualityRejectionsSha256, /^[0-9a-f]{64}$/);
  assert.match(first.source.qualityAcceptancesSha256, /^[0-9a-f]{64}$/);
});

test('a matching latest quality acceptance clears an older quality retry', () => {
  const report = {
    server: 'http://127.0.0.1:8088',
    results: [
      {
        workflowId: 'RecoveredPipeline:text_to_image',
        skeletonId: 'task-template:recovered:v1',
        taskId: 'accepted-task',
        status: 'completed',
      },
    ],
  };
  const qualityRejections = [
    {
      workflowId: 'RecoveredPipeline:text_to_image',
      taskId: 'failed-quality-task',
      outcome: 'rerun_required',
      reason: 'The old output was blurred.',
      correctiveAction: 'Restore the distilled inference settings.',
    },
  ];
  const qualityAcceptances = [
    {
      workflowId: 'RecoveredPipeline:text_to_image',
      taskId: 'accepted-task',
      outcome: 'shortlisted_for_user_review',
    },
  ];

  const ledger = retryLedgerForReportBytes(Buffer.from(JSON.stringify(report)), {
    qualityRejections,
    qualityAcceptances,
  });

  assert.equal(ledger.summary.retryCount, 0);
  assert.equal(ledger.source.qualityRejectionCount, 1);
  assert.equal(ledger.source.qualityAcceptanceCount, 1);
});

test('a stale acceptance cannot clear a newer technical or quality failure', () => {
  const report = {
    results: [
      {
        workflowId: 'StillBrokenPipeline:text_to_image',
        taskId: 'newer-task',
        status: 'completed',
      },
    ],
  };
  const qualityRejections = [
    {
      workflowId: 'StillBrokenPipeline:text_to_image',
      taskId: 'newer-task',
      outcome: 'rerun_required',
      reason: 'The newer output still failed review.',
      correctiveAction: 'Keep it in the retry queue.',
    },
  ];
  const qualityAcceptances = [
    {
      workflowId: 'StillBrokenPipeline:text_to_image',
      taskId: 'older-task',
      outcome: 'shortlisted_for_user_review',
    },
  ];

  const ledger = retryLedgerForReportBytes(Buffer.from(JSON.stringify(report)), {
    qualityRejections,
    qualityAcceptances,
  });

  assert.equal(ledger.summary.retryCount, 1);
  assert.equal(ledger.retries[0].latestTaskId, 'newer-task');
});

test('keeps the latest quality rejection in the retry ledger after technical completion', () => {
  const report = {
    server: 'http://127.0.0.1:8088',
    results: [
      {
        workflowId: 'EditPipeline:edit_image',
        skeletonId: 'task-template:edit:v1',
        status: 'completed',
      },
    ],
  };
  const qualityRejections = [
    {
      kind: 'generation_quality_rejection',
      workflowId: 'EditPipeline:edit_image',
      taskId: 'attempt-1',
      outcome: 'rerun_required',
      reason: 'The first output invented a person.',
      correctiveAction: 'Bind the source identity more tightly.',
      mediaPath: 'rejected/attempt1.webp',
      mediaSha256: 'first-hash',
    },
    {
      kind: 'generation_quality_rejection',
      workflowId: 'EditPipeline:edit_image',
      taskId: 'attempt-2',
      outcome: 'rerun_required',
      reason: 'The second output added an extra control.',
      correctiveAction: 'Use a stronger structure-preserving edit path.',
      mediaPath: 'rejected/attempt2.webp',
      mediaSha256: 'second-hash',
      sourceFixtureRightsState: 'review_required',
    },
  ];

  const ledger = retryLedgerForReportBytes(Buffer.from(JSON.stringify(report)), {
    qualityRejections,
  });

  assert.equal(ledger.summary.retryCount, 1);
  assert.equal(ledger.summary.byCategory.quality, 1);
  assert.equal(ledger.summary.byDefect.quality_review_rejected, 1);
  assert.deepEqual(ledger.retries[0], {
    workflowId: 'EditPipeline:edit_image',
    skeletonId: 'task-template:edit:v1',
    state: 'classified',
    nextState: 'fix',
    maySkip: false,
    externalBlocker: null,
    category: 'quality',
    defect: 'quality_review_rejected',
    error: 'The second output added an extra control.',
    correctiveAction: 'Use a stronger structure-preserving edit path.',
    latestTaskId: 'attempt-2',
    latestMediaPath: 'rejected/attempt2.webp',
    latestMediaSha256: 'second-hash',
    sourceFixtureRightsState: 'review_required',
    qualityAttemptCount: 2,
  });
});

test('video and audio screen failures enter the retry ledger instead of the human shortlist', () => {
  const pendingRoot = mkdtempSync(join(tmpdir(), 'modiff-quality-screens-'));
  writeFileSync(
    join(pendingRoot, 'generation-campaign-video-screen.v1.json'),
    JSON.stringify({
      kind: 'generation_campaign_video_screen',
      results: [
        {
          workflowId: 'StaticVideoPipeline:text_to_video',
          outcome: 'rerun_required',
          reason: 'The clip is effectively a still image.',
          sha256: 'video-hash',
        },
      ],
    }),
  );
  writeFileSync(
    join(pendingRoot, 'generation-campaign-audio-integrity.v1.json'),
    JSON.stringify({
      kind: 'generation_campaign_audio_integrity',
      results: [
        {
          workflowId: 'ShortAudioPipeline:text_to_audio',
          outcome: 'rerun_required',
          reason: 'The output ends abruptly.',
          sha256: 'audio-hash',
        },
      ],
    }),
  );

  const rejections = readQualityScreenRejections(pendingRoot);
  assert.equal(rejections.length, 2);
  const ledger = buildRetryLedger(
    {
      results: rejections.map(({ workflowId }) => ({ workflowId, status: 'completed' })),
    },
    { qualityRejections: rejections },
  );
  assert.equal(ledger.summary.retryCount, 2);
  assert.equal(ledger.summary.byCategory.quality, 2);
  assert.ok(ledger.retries.every((retry) => retry.nextState === 'fix'));
});

test('workspace-owner rejections remain machine-readable retry evidence', () => {
  const pendingRoot = mkdtempSync(join(tmpdir(), 'modiff-user-review-'));
  writeFileSync(
    join(pendingRoot, 'user-quality-review-2026-08-21.v1.json'),
    JSON.stringify({
      kind: 'generation_campaign_user_quality_review',
      results: [
        {
          workflowId: 'MalformedImagePipeline:text_to_image',
          outcome: 'rerun_required',
          reason: 'The main subject geometry is malformed.',
          correctiveAction: 'Research the exact family recipe and pass a geometry canary before rerunning.',
          mediaPath: 'MalformedImagePipeline__text_to_image/campaign.webp',
        },
        {
          workflowId: 'ApprovedPipeline:text_to_image',
          outcome: 'quality_approved_rights_pending',
          reason: 'Quality approved by the workspace owner.',
        },
      ],
    }),
  );

  const rejections = readUserQualityRejections(pendingRoot);
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0].workflowId, 'MalformedImagePipeline:text_to_image');
  assert.equal(rejections[0].outcome, 'rerun_required');
});

test('rejects duplicate workflows and failures without preserved errors', () => {
  assert.throws(
    () =>
      buildRetryLedger({
        results: [
          { workflowId: 'Duplicate:text_to_image', status: 'failed', error: 'first' },
          { workflowId: 'Duplicate:text_to_image', status: 'failed', error: 'second' },
        ],
      }),
    /Duplicate campaign result/,
  );
  assert.throws(
    () => buildRetryLedger({ results: [{ workflowId: 'NoError:text_to_image', status: 'failed' }] }),
    /has no preserved error/,
  );
});

test('campaign prioritizes fixable retries without omitting new or artifact-blocked targets', () => {
  const targets = [
    { modelType: 'NewPipeline', mode: 'text_to_image' },
    { modelType: 'MissingPipeline', mode: 'text_to_image' },
    { modelType: 'LifecyclePipeline', mode: 'text_to_video' },
    { modelType: 'RuntimePipeline', mode: 'text_to_audio' },
  ];
  const previous = [
    {
      workflowId: 'MissingPipeline:text_to_image',
      status: 'failed',
      error: 'MissingPipeline is missing, so Text to image cannot run.',
    },
    {
      workflowId: 'LifecyclePipeline:text_to_video',
      status: 'failed',
      error: 'Target page, context or browser has been closed',
    },
    {
      workflowId: 'RuntimePipeline:text_to_audio',
      status: 'failed',
      error: 'optional runtime required',
    },
  ];
  assert.deepEqual(
    orderCampaignTargetsForRetry(targets, previous).map(({ modelType }) => modelType),
    ['LifecyclePipeline', 'RuntimePipeline', 'NewPipeline', 'MissingPipeline'],
  );
});
