import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearRuntimeBetweenRuns,
  executionReceiptsForRun,
  failureMessageForRun,
  galleryGenerateInvocation,
  galleryRunExitCode,
  waitForTaskTerminal,
} from './template-gallery-runner.mjs';

test('gallery runner fails the process when any selected template is skipped', () => {
  assert.equal(galleryRunExitCode([{ templateId: 'ready', skipped: false }], { code: 0 }), 0);
  assert.equal(
    galleryRunExitCode(
      [
        { templateId: 'ready', skipped: false },
        { templateId: 'failed', skipped: true, reason: 'runtime failure' },
      ],
      { code: 0 },
    ),
    1,
  );
});

test('gallery runner propagates manifest generation failures', () => {
  assert.equal(galleryRunExitCode([{ templateId: 'ready', skipped: false }], { code: 7 }), 7);
});

test('gallery runner invokes the harness through Node without a platform shell shim', () => {
  const invocation = galleryGenerateInvocation({
    mediaDir: 'C:\\proof media',
    modelRevision: 'repo/model@commit',
    runtimeFingerprint: 'runtime-lock',
    publish: true,
  });

  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0], /template-gallery-harness\.mjs$/);
  assert.deepEqual(invocation.args.slice(1), [
    'generate',
    '--media-dir',
    'C:\\proof media',
    '--model-revision',
    'repo/model@commit',
    '--runtime-fingerprint',
    'runtime-lock',
    '--verification',
    'exact',
    '--publish',
  ]);
});

test('gallery runner stops only for a failure attributed to the active run', () => {
  const run = { taskId: 'task-current', startedAt: 2_000 };
  assert.equal(
    failureMessageForRun({ taskId: 'task-current', createdAt: 2_001, message: 'model load failed' }, run),
    'model load failed',
  );
  assert.equal(failureMessageForRun({ taskId: 'task-old', createdAt: 2_001, message: 'old task' }, run), null);
  assert.equal(failureMessageForRun({ taskId: 'task-current', createdAt: 1_999, message: 'stale failure' }, run), null);
});

test('gallery runner requires a successful cache-clearing receipt between duplicate runs', async () => {
  const calls = [];
  const payload = await clearRuntimeBetweenRuns('http://127.0.0.1:8088', async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ error: false, released_node_count: 6, cleanup_errors: [] }),
    };
  });

  assert.equal(payload.released_node_count, 6);
  assert.deepEqual(calls, [
    {
      url: 'http://127.0.0.1:8088/runtime/gpu_cleanup',
      options: { method: 'POST' },
    },
  ]);
  await assert.rejects(
    clearRuntimeBetweenRuns('http://127.0.0.1:8088', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: false, released_node_count: 0 }),
    })),
    /did not prove that any cached node objects were released/,
  );
});

test('gallery runner waits for the attributed task terminal receipt after media appears', async () => {
  const page = {
    evaluate: async (_callback, taskId) => ({
      run: { id: taskId, task_id: taskId, status: 'completed', durationMs: 1250 },
      failure: null,
    }),
  };

  const terminal = await waitForTaskTerminal(page, { taskId: 'task-proof', timeoutMs: 1000 });
  assert.equal(terminal.status, 'completed');
  assert.equal(terminal.task_id, 'task-proof');
});

test('gallery runner rejects cached audio/video generation receipts as vacuous duplicates', () => {
  const template = { modelType: 'WanVACEPipeline' };
  const output = {
    taskId: 'task-wan',
    apiGraphSnapshot: {
      nodes: {
        generate: { module: 'modules.WanVACE', action: 'Generate' },
        export: { module: 'modules.Video', action: 'Export' },
      },
    },
  };
  const fresh = [
    { type: 'executed', task_id: 'task-wan', node: 'generate', status: 'succeeded', hasChanged: true },
    { type: 'executed', task_id: 'task-wan', node: 'export', status: 'succeeded', hasChanged: true },
  ];

  assert.equal(executionReceiptsForRun(template, output, fresh).length, 2);
  assert.throws(
    () =>
      executionReceiptsForRun(template, output, [
        ...fresh.slice(0, 1),
        { type: 'executed', task_id: 'task-wan', node: 'export', status: 'cached', hasChanged: false },
      ]),
    /cached output/,
  );
});
