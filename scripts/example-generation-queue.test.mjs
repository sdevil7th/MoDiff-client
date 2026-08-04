import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  failureSignature,
  reconcileInterruptedRun,
  selectNextJob,
  validateConfig,
  writeJsonAtomic,
} from './example-generation-queue.mjs';

const SCRIPT = fileURLToPath(new URL('./example-generation-queue.mjs', import.meta.url));

function tempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'modiff-example-queue-'));
  return {
    root,
    configPath: join(root, 'queue.config.json'),
    statePath: join(root, 'state', 'queue-state.json'),
  };
}

function writeConfig(path, jobs, defaults = {}) {
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        defaults: { maxAttempts: 2, timeoutMs: 5_000, ...defaults },
        jobs,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function runQueue(workspace, command, extraArgs = [], timeout = 10_000) {
  return spawnSync(
    process.execPath,
    [SCRIPT, command, '--config', workspace.configPath, '--state', workspace.statePath, ...extraArgs],
    { encoding: 'utf8', timeout },
  );
}

function stateFor(workspace) {
  return JSON.parse(readFileSync(workspace.statePath, 'utf8'));
}

function commandJob(id, source, extra = {}) {
  return {
    id,
    command: [process.execPath, '-e', source],
    ...extra,
  };
}

test('masked VACE queue uses the staged amber-vessel source contract', () => {
  const projectRoot = dirname(dirname(SCRIPT));
  const config = validateConfig(
    JSON.parse(readFileSync(join(projectRoot, 'scripts', 'example-generation-queue.config.json'), 'utf8')),
  );
  const sourceJob = config.jobs.find((job) => job.id === 'source-qwen-wan-amber-vessel-reference');
  const maskedJob = config.jobs.find((job) => job.id === 'wan-vace-masked-object-replace-v1');
  assert.ok(sourceJob);
  assert.ok(maskedJob);
  assert.deepEqual(sourceJob.command, [
    'node',
    'scripts/template-gallery-source-runner.mjs',
    '--asset',
    'qwen-wan-amber-vessel-reference',
  ]);
  assert.deepEqual(maskedJob.dependsOn, [sourceJob.id]);
  assert.deepEqual(maskedJob.args.slice(0, 3), [
    '--reviewed',
    '--template-input-map',
    'scripts/template-gallery-wan-inputs-v2.json',
  ]);
  assert.doesNotMatch(maskedJob.description, /harbor|pilot launch/i);

  const sourceCatalog = JSON.parse(
    readFileSync(join(projectRoot, 'scripts', 'template-gallery-source-assets.json'), 'utf8'),
  );
  const inputMap = JSON.parse(
    readFileSync(join(projectRoot, 'scripts', 'template-gallery-wan-inputs-v2.json'), 'utf8'),
  );
  const amberSource = sourceCatalog.assets.find((asset) => asset.id === 'qwen-wan-amber-vessel-reference');
  assert.ok(amberSource);
  assert.equal(amberSource.stagedFilename, 'wan-amber-vessel-reference-v2.webp');
  assert.deepEqual(amberSource.downstreamTemplates, ['wan_vace_masked_object_replace']);
  assert.equal(
    inputMap.wan_vace_masked_object_replace.referenceImages[0],
    `artifacts/template-gallery/source-assets/${amberSource.stagedFilename}`,
  );
  assert.equal(
    inputMap.wan_vace_masked_object_replace.sourceVideo,
    'artifacts/template-gallery/source-assets/wan-glass-orbit-source-v2.mp4',
  );
  assert.equal(
    inputMap.wan_vace_masked_object_replace.maskVideo,
    'artifacts/template-gallery/source-assets/wan-glass-orbit-mask-v2.mp4',
  );
});

test('FLUX Depth queue reuses the versioned control asset without a Transformers preprocessor', () => {
  const projectRoot = dirname(dirname(SCRIPT));
  const config = validateConfig(
    JSON.parse(readFileSync(join(projectRoot, 'scripts', 'example-generation-queue.config.json'), 'utf8')),
  );
  const versionedControlPath = 'public/template-gallery/inputs/flux_depth_control.before.png';
  const depthJobs = config.jobs.filter((job) => job.templates?.includes('flux_depth_control'));
  assert.ok(depthJobs.length > 0);
  for (const job of depthJobs) {
    const controlIndex = job.args?.indexOf('--control-image') ?? -1;
    assert.ok(controlIndex >= 0, `${job.id} must provide a reviewed control image`);
    assert.equal(job.args[controlIndex + 1], versionedControlPath);
    assert.deepEqual(job.dependsOn, ['install-flux-depth']);
  }

  const serializedConfig = JSON.stringify(config);
  assert.doesNotMatch(serializedConfig, /Depth-Anything|depth-anything|depth-control-image/);
  assert.equal(
    config.jobs.some((job) => job.id === 'install-depth-anything-preprocessor'),
    false,
  );
  assert.equal(
    config.jobs.some((job) => job.id === 'prepare-flux-coastal-pavilion-depth'),
    false,
  );
  assert.equal(
    config.jobs.some((job) => job.id === 'prepare-flux-depth-boatyard-v2'),
    false,
  );
  assert.equal(
    config.jobs.some((job) => job.id === 'source-flux-depth-boatyard-v2'),
    false,
  );

  const sourceCatalog = JSON.parse(
    readFileSync(join(projectRoot, 'scripts', 'template-gallery-source-assets.json'), 'utf8'),
  );
  assert.equal(
    sourceCatalog.assets.some((asset) => asset.id === 'flux-depth-boatyard-source-v2'),
    false,
  );
  const assetManifest = JSON.parse(readFileSync(join(projectRoot, 'config', 'template-assets.v1.json'), 'utf8'));
  const depthControl = assetManifest.assets.find(
    (asset) => asset.path === 'template-gallery/inputs/flux_depth_control.before.png',
  );
  assert.ok(depthControl);
  assert.match(depthControl.sha256, /^sha256:bytes:[a-f0-9]{64}$/);
  assert.deepEqual(depthControl.purposes, ['runtime', 'tooling']);
});

test('config validation and selection enforce a bounded pending-job queue', () => {
  const config = validateConfig({
    schemaVersion: 1,
    defaults: { maxAttempts: 2, timeoutMs: 1_000 },
    jobs: [commandJob('second', 'void 0', { priority: 20 }), commandJob('first', 'void 0', { priority: 10 })],
  });
  const timestamp = new Date().toISOString();
  const state = {
    schemaVersion: 1,
    activeJobId: null,
    jobs: Object.fromEntries(
      config.jobs.map((job) => [
        job.id,
        {
          id: job.id,
          status: 'pending',
          attempts: [],
          retrySuppressed: false,
          updatedAt: timestamp,
        },
      ]),
    ),
  };

  assert.equal(selectNextJob(config, state)?.id, 'first');
  state.jobs.first.status = 'running';
  assert.equal(selectNextJob(config, state)?.id, 'second');
  state.activeJobId = 'first';
  assert.equal(selectNextJob(config, state), null);
  assert.throws(
    () => validateConfig({ schemaVersion: 1, jobs: [{ id: 'bad', command: ['node'], maxAttempts: 0 }] }),
    /positive integer/i,
  );
});

test('interrupted final attempts are reconciled once with retries suppressed', () => {
  const config = validateConfig({
    schemaVersion: 1,
    defaults: { maxAttempts: 2, timeoutMs: 1_000 },
    jobs: [commandJob('video', 'void 0')],
  });
  const state = {
    schemaVersion: 1,
    activeJobId: 'video',
    jobs: {
      video: {
        id: 'video',
        status: 'running',
        attempts: [
          { startedAt: '2026-07-10T00:00:00.000Z', finishedAt: '2026-07-10T00:00:01.000Z' },
          { startedAt: '2026-07-10T00:01:00.000Z', finishedAt: null },
        ],
        failureSignatures: [],
        retrySuppressed: false,
      },
    },
  };

  assert.equal(reconcileInterruptedRun(state, config), 'video');
  assert.equal(state.activeJobId, null);
  assert.equal(state.jobs.video.status, 'failed_runtime');
  assert.equal(state.jobs.video.retrySuppressed, true);
  assert.equal(state.jobs.video.attempts[1].signal, 'interrupted');
});

test('one run executes one job and successful output waits for explicit quality evidence', () => {
  const workspace = tempWorkspace();
  writeConfig(workspace.configPath, [
    commandJob('first', "process.stdout.write('first complete')", { priority: 10 }),
    commandJob('second', "process.stdout.write('second complete')", { priority: 20 }),
  ]);

  const dryRun = runQueue(workspace, 'run', ['--dry-run', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).jobId, 'first');
  assert.equal(readdirSync(workspace.root).includes('state'), false, 'dry-run must not create state');

  const run = runQueue(workspace, 'run');
  assert.equal(run.status, 0, run.stderr);
  const state = stateFor(workspace);
  assert.equal(state.jobs.first.status, 'awaiting_quality');
  assert.equal(state.jobs.first.attempts.length, 1);
  assert.equal(state.jobs.second.status, 'pending');
  assert.equal(state.jobs.second.attempts.length, 0, 'a run invocation must stop after one job');
  assert.equal(state.activeJobId, null);
  assert.equal(
    readdirSync(dirname(workspace.statePath)).some((entry) => entry.endsWith('.tmp')),
    false,
    'atomic state replacement must not leave temp files',
  );

  const missingEvidence = runQueue(workspace, 'mark', ['--job', 'first', '--status', 'proven', '--reason', 'reviewed']);
  assert.notEqual(missingEvidence.status, 0);
  assert.match(missingEvidence.stderr, /requires --evidence/i);

  const evidence = join(workspace.root, 'quality-review.json');
  writeFileSync(evidence, '{"verdict":"pass"}\n', 'utf8');
  const mark = runQueue(workspace, 'mark', [
    '--job',
    'first',
    '--status',
    'proven',
    '--reason',
    'Quality review passed.',
    '--evidence',
    evidence,
  ]);
  assert.equal(mark.status, 0, mark.stderr);
  assert.equal(stateFor(workspace).jobs.first.status, 'proven');
});

test('runtime failures never auto-retry and a repeated signature permanently suppresses retries', () => {
  const workspace = tempWorkspace();
  writeConfig(workspace.configPath, [
    commandJob('stable-failure', "process.stderr.write('stable failure\\n'); process.exit(7)"),
  ]);

  const firstRun = runQueue(workspace, 'run');
  assert.equal(firstRun.status, 1);
  let state = stateFor(workspace);
  assert.equal(state.jobs['stable-failure'].status, 'failed_runtime');
  assert.equal(state.jobs['stable-failure'].attempts.length, 1);
  assert.equal(state.jobs['stable-failure'].retrySuppressed, false);

  const noAutomaticRetry = runQueue(workspace, 'run');
  assert.equal(noAutomaticRetry.status, 0, noAutomaticRetry.stderr);
  assert.equal(stateFor(workspace).jobs['stable-failure'].attempts.length, 1);

  const retry = runQueue(workspace, 'retry', [
    '--job',
    'stable-failure',
    '--reason',
    'Updated the runtime environment.',
    '--remediation-key',
    'runtime-env-v2',
  ]);
  assert.equal(retry.status, 0, retry.stderr);
  const secondRun = runQueue(workspace, 'run');
  assert.equal(secondRun.status, 1);
  state = stateFor(workspace);
  assert.equal(state.jobs['stable-failure'].attempts.length, 2);
  assert.equal(state.jobs['stable-failure'].retrySuppressed, true);
  assert.equal(
    state.jobs['stable-failure'].attempts[0].failureSignature,
    state.jobs['stable-failure'].attempts[1].failureSignature,
  );

  const refused = runQueue(workspace, 'retry', [
    '--job',
    'stable-failure',
    '--reason',
    'Try again.',
    '--remediation-key',
    'runtime-env-v3',
  ]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /attempt cap|repeated a failure signature|suppressed/i);
});

test('blocked jobs require a uniquely named remediation before becoming runnable', () => {
  const workspace = tempWorkspace();
  writeConfig(workspace.configPath, [commandJob('model-job', "process.stdout.write('ready')")]);
  const evidence = join(workspace.root, 'runtime-error.json');
  writeFileSync(evidence, '{"error":"model contract mismatch"}\n', 'utf8');

  const mark = runQueue(workspace, 'mark', [
    '--job',
    'model-job',
    '--status',
    'blocked_model',
    '--reason',
    'Model revision is not installed.',
    '--evidence',
    evidence,
  ]);
  assert.equal(mark.status, 0, mark.stderr);
  assert.equal(stateFor(workspace).jobs['model-job'].status, 'blocked_model');
  assert.equal(stateFor(workspace).jobs['model-job'].evidence, evidence);

  const missingKey = runQueue(workspace, 'retry', ['--job', 'model-job', '--reason', 'Model installed.']);
  assert.notEqual(missingKey.status, 0);
  assert.match(missingKey.stderr, /remediation-key/i);

  const retry = runQueue(workspace, 'retry', [
    '--job',
    'model-job',
    '--reason',
    'Pinned model revision is installed.',
    '--remediation-key',
    'model-revision-installed',
  ]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(stateFor(workspace).jobs['model-job'].status, 'pending');
});

test('timeouts become bounded failed_runtime attempts', () => {
  const workspace = tempWorkspace();
  writeConfig(
    workspace.configPath,
    [commandJob('timeout', 'setInterval(() => {}, 1000)', { timeoutMs: 250, maxAttempts: 1 })],
    { timeoutMs: 250, maxAttempts: 1 },
  );

  const run = runQueue(workspace, 'run', [], 5_000);
  assert.equal(run.status, 1);
  const state = stateFor(workspace);
  assert.equal(state.jobs.timeout.status, 'failed_runtime');
  assert.equal(state.jobs.timeout.attempts[0].timedOut, true);
  assert.equal(state.jobs.timeout.retrySuppressed, true);
});

test('an active process lock prevents a second queue runner', () => {
  const workspace = tempWorkspace();
  writeConfig(workspace.configPath, [commandJob('locked', "process.stdout.write('should not run')")]);
  mkdirSync(dirname(workspace.statePath), { recursive: true });
  writeFileSync(
    `${workspace.statePath}.lock`,
    `${JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() })}\n`,
    'utf8',
  );

  const run = runQueue(workspace, 'run');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /another queue process is active/i);
});

test('failure signatures ignore timestamp-only differences and atomic writes replace state', () => {
  assert.equal(
    failureSignature({ exitCode: 1, stderrTail: 'failed at 2026-07-10T08:00:00.000Z' }),
    failureSignature({ exitCode: 1, stderrTail: 'failed at 2026-07-10T09:00:00.000Z' }),
  );
  const workspace = tempWorkspace();
  writeJsonAtomic(workspace.statePath, { schemaVersion: 1, value: 1 });
  writeJsonAtomic(workspace.statePath, { schemaVersion: 1, value: 2 });
  assert.equal(JSON.parse(readFileSync(workspace.statePath, 'utf8')).value, 2);
});
