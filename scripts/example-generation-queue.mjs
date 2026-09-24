import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  createWriteStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CONFIG_PATH = join(ROOT, 'scripts', 'example-generation-coverage-queue.config.json');
const DEFAULT_STATE_PATH = join(ROOT, 'artifacts', 'example-generation', 'coverage-queue-state.json');
const STATE_SCHEMA_VERSION = 1;
const CONFIG_SCHEMA_VERSION = 1;
const RUNNABLE_STATUS = 'pending';
const ACTIVE_STATUS = 'running';
const MANUAL_STATUSES = new Set(['blocked_external', 'blocked_model', 'failed_quality', 'proven']);
const RETRYABLE_STATUSES = new Set(['blocked_external', 'blocked_model', 'failed_quality', 'failed_runtime']);
const REVIEW_DECISIONS = new Set([
  'approve',
  'revise_prompt',
  'revise_parameters',
  'replace_input',
  'fix_pipeline',
  'block',
]);
const KNOWN_STATUSES = new Set([
  RUNNABLE_STATUS,
  ACTIVE_STATUS,
  'awaiting_quality',
  ...MANUAL_STATUSES,
  'failed_runtime',
]);

function now() {
  return new Date().toISOString();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function orderedValue(value) {
  if (Array.isArray(value)) return value.map(orderedValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, orderedValue(entryValue)]),
  );
}

function stableStringify(value) {
  return JSON.stringify(orderedValue(value));
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer; received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_.-]+/gi, '-');
}

function resolveFromRoot(value) {
  return isAbsolute(value) ? value : resolve(ROOT, value);
}

function parseArgs(argv) {
  const args = {
    command: argv[2] ?? 'help',
    configPath: DEFAULT_CONFIG_PATH,
    statePath: DEFAULT_STATE_PATH,
    dryRun: false,
    json: false,
  };

  for (let index = 3; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (entry === '--json') {
      args.json = true;
      continue;
    }
    if (entry === '--help' || entry === '-h') {
      args.command = 'help';
      continue;
    }
    if (!entry.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${entry}`);
    }
    const [key, inlineValue] = entry.slice(2).split('=');
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (value === undefined || String(value).startsWith('--')) {
      throw new Error(`--${key} requires a value.`);
    }
    if (key === 'config') args.configPath = resolve(String(value));
    else if (key === 'state') args.statePath = resolve(String(value));
    else if (key === 'job') args.jobId = String(value);
    else if (key === 'status') args.status = String(value);
    else if (key === 'reason') args.reason = String(value);
    else if (key === 'evidence') args.evidence = String(value);
    else if (key === 'remediation-key') args.remediationKey = String(value);
    else if (key === 'decision') args.decision = String(value);
    else if (key === 'budget-ms') args.budgetMs = positiveInteger(value, 'budget-ms');
    else if (key === 'stop-file') args.stopFile = resolve(String(value));
    else throw new Error(`Unknown option: --${key}`);
  }

  return args;
}

function usage() {
  return `
Usage:
  npm run gallery:queue -- plan [--json]
  npm run gallery:queue -- status [--json]
  npm run gallery:queue -- next [--job <id>] [--json]
  npm run gallery:queue -- run [--job <id>] [--dry-run] [--json]
  npm run gallery:queue -- run-all --budget-ms <milliseconds> [--json]
  npm run gallery:queue -- mark --job <id> --status <status> --reason <text> [--evidence <path>]
  npm run gallery:queue -- retry --job <id> --reason <text> --remediation-key <unique-key>
  npm run gallery:queue -- review --job <id> --decision <decision> --reason <text> [--evidence <path>]

Commands:
  plan     Show the configured jobs, effective limits, dependencies, and current state.
  status   Show persisted state and the active job, if any.
  next     Show the single job that a run would select. It never changes state.
  run      Run at most one pending job, then stop. Runtime failures never auto-retry.
  run-all  Run eligible jobs serially within a required wall-clock budget;
           record each failure and continue. Completed/failed jobs are not repeated.
  mark     Record blocked_external, blocked_model, failed_quality, or proven.
           Marking proven requires an existing --evidence file.
  retry    Requeue one failed/blocked job after a named remediation. A new remediation
           key is mandatory; attempt caps and repeated failure signatures remain final.
  review   Record approve, revise_prompt, revise_parameters, replace_input,
           fix_pipeline, or block for an awaiting-quality output.

Options:
  --config <path>            Queue config. Default: ${DEFAULT_CONFIG_PATH}
  --state <path>             Persisted state. Default: ${DEFAULT_STATE_PATH}
  --job <id>                 Select one job explicitly.
  --stop-file <path>         run-all stops between jobs when this file exists; never interrupts the active job.
  --dry-run                  Print the selected command without executing or mutating state.
  --json                     Emit machine-readable JSON.

Safety model:
  - One process lock and one active job.
  - One job per run invocation; run-all requires a finite campaign budget.
  - Each job has a hard maxAttempts and timeoutMs.
  - Failed jobs require an explicit, uniquely keyed remediation before retry.
  - A repeated failure signature suppresses all further retries.
`.trim();
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON at ${path}: ${error instanceof Error ? error.message : error}`);
  }
}

export function validateConfig(rawConfig, configPath = DEFAULT_CONFIG_PATH) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new Error(`Queue config must be an object: ${configPath}`);
  }
  if (rawConfig.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(`Queue config schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(rawConfig.jobs) || rawConfig.jobs.length === 0) {
    throw new Error('Queue config must contain at least one job.');
  }

  const defaultMaxAttempts = positiveInteger(rawConfig.defaults?.maxAttempts ?? 2, 'defaults.maxAttempts');
  const defaultTimeoutMs = positiveInteger(rawConfig.defaults?.timeoutMs ?? 45 * 60 * 1000, 'defaults.timeoutMs');
  const ids = new Set();
  const jobs = rawConfig.jobs.map((rawJob, index) => {
    if (!rawJob || typeof rawJob !== 'object' || Array.isArray(rawJob)) {
      throw new Error(`jobs[${index}] must be an object.`);
    }
    const id = String(rawJob.id ?? '').trim();
    if (!id) throw new Error(`jobs[${index}].id is required.`);
    if (ids.has(id)) throw new Error(`Duplicate queue job id: ${id}`);
    ids.add(id);

    const initialStatus = String(rawJob.initialStatus ?? RUNNABLE_STATUS);
    if (![RUNNABLE_STATUS, 'blocked_external', 'blocked_model'].includes(initialStatus)) {
      throw new Error(`${id}.initialStatus must be pending, blocked_external, or blocked_model.`);
    }
    const hasCommand = Array.isArray(rawJob.command) && rawJob.command.length > 0;
    const hasGalleryRunner = rawJob.runner === 'gallery';
    if (Number(hasCommand) + Number(hasGalleryRunner) !== 1) {
      throw new Error(`${id} must define exactly one of command[] or runner: "gallery".`);
    }
    if (hasCommand && rawJob.command.some((entry) => typeof entry !== 'string' || !entry)) {
      throw new Error(`${id}.command must contain non-empty strings.`);
    }
    if (hasGalleryRunner && (!Array.isArray(rawJob.templates) || rawJob.templates.length === 0)) {
      throw new Error(`${id}.templates must contain at least one Studio template id.`);
    }
    if (rawJob.args !== undefined && !Array.isArray(rawJob.args)) {
      throw new Error(`${id}.args must be an array when supplied.`);
    }
    if (rawJob.env !== undefined && (!rawJob.env || typeof rawJob.env !== 'object' || Array.isArray(rawJob.env))) {
      throw new Error(`${id}.env must be an object when supplied.`);
    }
    const campaignMode = String(rawJob.campaignMode ?? rawConfig.campaignMode ?? 'legacy_exact');
    const recipeLockHash = rawJob.recipeLockHash ? String(rawJob.recipeLockHash) : null;
    const normalizedArgs = (rawJob.args ?? []).map((entry) => String(entry));
    if (campaignMode === 'coverage_reviewed') {
      if (!hasGalleryRunner) throw new Error(`${id} coverage_reviewed jobs must use runner: "gallery".`);
      if (rawJob.templates.length !== 1) throw new Error(`${id} coverage_reviewed jobs must target one template.`);
      if (!normalizedArgs.includes('--reviewed'))
        throw new Error(`${id} coverage_reviewed job must include --reviewed.`);
      const runsIndex = normalizedArgs.indexOf('--runs');
      if (runsIndex < 0 || normalizedArgs[runsIndex + 1] !== '1') {
        throw new Error(`${id} coverage_reviewed job must include --runs 1.`);
      }
      if (!/^sha256:recipe-lock-v1:[a-f0-9]{64}$/.test(recipeLockHash ?? '')) {
        throw new Error(`${id} coverage_reviewed job requires a valid recipeLockHash.`);
      }
      if (positiveInteger(rawJob.maxAttempts ?? defaultMaxAttempts, `${id}.maxAttempts`) > 2) {
        throw new Error(`${id} coverage_reviewed job cannot exceed two attempts.`);
      }
    }

    return {
      id,
      description: String(rawJob.description ?? ''),
      priority: Number.isFinite(Number(rawJob.priority)) ? Number(rawJob.priority) : index,
      initialStatus,
      initialReason: String(rawJob.initialReason ?? ''),
      maxAttempts: positiveInteger(rawJob.maxAttempts ?? defaultMaxAttempts, `${id}.maxAttempts`),
      timeoutMs: positiveInteger(rawJob.timeoutMs ?? defaultTimeoutMs, `${id}.timeoutMs`),
      dependsOn: [...new Set((rawJob.dependsOn ?? []).map((entry) => String(entry).trim()).filter(Boolean))],
      workingDirectory: resolveFromRoot(String(rawJob.workingDirectory ?? '.')),
      env: Object.fromEntries(Object.entries(rawJob.env ?? {}).map(([key, value]) => [key, String(value)])),
      runner: hasGalleryRunner ? 'gallery' : 'command',
      campaignMode,
      recipeLockHash,
      requiresReviewBeforeRun: Boolean(rawJob.requiresReviewBeforeRun),
      templates: hasGalleryRunner ? rawJob.templates.map((entry) => String(entry).trim()).filter(Boolean) : [],
      args: normalizedArgs,
      command: hasCommand ? rawJob.command : null,
    };
  });

  for (const job of jobs) {
    const unknownDependencies = job.dependsOn.filter((dependency) => !ids.has(dependency));
    if (unknownDependencies.length > 0) {
      throw new Error(`${job.id} has unknown dependencies: ${unknownDependencies.join(', ')}.`);
    }
    if (job.dependsOn.includes(job.id)) throw new Error(`${job.id} cannot depend on itself.`);
  }

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaults: { maxAttempts: defaultMaxAttempts, timeoutMs: defaultTimeoutMs },
    jobs: jobs.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id)),
  };
}

function loadConfig(configPath) {
  if (!existsSync(configPath)) throw new Error(`Queue config does not exist: ${configPath}`);
  return validateConfig(readJson(configPath, 'Queue config'), configPath);
}

function initialJobState(job, timestamp) {
  return {
    id: job.id,
    status: job.initialStatus,
    reason: job.initialReason || null,
    attempts: [],
    retryApprovals: [],
    reviewDecisions: [],
    currentRecipeLockHash: job.recipeLockHash,
    failureSignatures: [],
    retrySuppressed: false,
    evidence: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createState(config, configHash) {
  const timestamp = now();
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    configHash,
    createdAt: timestamp,
    updatedAt: timestamp,
    activeJobId: null,
    jobs: Object.fromEntries(config.jobs.map((job) => [job.id, initialJobState(job, timestamp)])),
    retiredJobs: {},
  };
}

function validateState(state, statePath) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`Queue state must be an object: ${statePath}`);
  }
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`Queue state schemaVersion must be ${STATE_SCHEMA_VERSION}: ${statePath}`);
  }
  if (!state.jobs || typeof state.jobs !== 'object' || Array.isArray(state.jobs)) {
    throw new Error(`Queue state jobs must be an object: ${statePath}`);
  }
  for (const [jobId, jobState] of Object.entries(state.jobs)) {
    if (!KNOWN_STATUSES.has(jobState?.status)) {
      throw new Error(`Queue state for ${jobId} has unknown status: ${jobState?.status}`);
    }
    if (!Array.isArray(jobState.attempts)) throw new Error(`Queue state for ${jobId} has invalid attempts.`);
  }
  return state;
}

function syncState(config, state) {
  const configHash = sha256(stableStringify(config));
  if (!state) return createState(config, configHash);
  const timestamp = now();
  const configuredIds = new Set(config.jobs.map((job) => job.id));
  state.retiredJobs ??= {};
  for (const [jobId, jobState] of Object.entries(state.jobs)) {
    if (!configuredIds.has(jobId)) state.retiredJobs[jobId] = jobState;
  }
  state.jobs = Object.fromEntries(
    config.jobs.map((job) => [job.id, state.jobs[job.id] ?? initialJobState(job, timestamp)]),
  );
  for (const job of config.jobs) {
    const jobState = state.jobs[job.id];
    jobState.reviewDecisions ??= [];
    jobState.currentRecipeLockHash = job.recipeLockHash;
    if (RETRYABLE_STATUSES.has(jobState.status) && jobState.attempts.length >= job.maxAttempts) {
      jobState.retrySuppressed = true;
    }
  }
  state.configHash = configHash;
  state.updatedAt = timestamp;
  return state;
}

function loadContext(args) {
  const config = loadConfig(args.configPath);
  const state = existsSync(args.statePath)
    ? validateState(readJson(args.statePath, 'Queue state'), args.statePath)
    : null;
  return { config, state: syncState(config, state) };
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporaryPath, 'wx');
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporaryPath, path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function commandForJob(job) {
  if (job.runner === 'command') return [...job.command, ...job.args];
  return [
    process.execPath,
    join(ROOT, 'scripts', 'template-gallery-runner.mjs'),
    ...job.templates.flatMap((templateId) => ['--template', templateId]),
    ...job.args,
  ];
}

function dependencyBlockers(config, state, job) {
  return job.dependsOn.filter((dependency) => state.jobs[dependency]?.status !== 'proven');
}

export function selectNextJob(config, state, requestedJobId) {
  if (state.activeJobId) return null;
  const candidates = requestedJobId ? config.jobs.filter((job) => job.id === requestedJobId) : config.jobs;
  if (requestedJobId && candidates.length === 0) throw new Error(`Unknown queue job id: ${requestedJobId}`);
  return (
    candidates.find((job) => {
      const jobState = state.jobs[job.id];
      return (
        jobState?.status === RUNNABLE_STATUS &&
        jobState.attempts.length < job.maxAttempts &&
        !jobState.retrySuppressed &&
        !job.requiresReviewBeforeRun &&
        dependencyBlockers(config, state, job).length === 0
      );
    }) ?? null
  );
}

function normalizeFailureText(value) {
  return String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<timestamp>')
    .replace(/\\/g, '/')
    .trim()
    .slice(-16_384);
}

export function failureSignature(result) {
  const payload = {
    timedOut: Boolean(result.timedOut),
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    launchError: normalizeFailureText(result.launchError),
    stderr: normalizeFailureText(result.stderrTail),
    stdout: normalizeFailureText(result.stderrTail ? '' : result.stdoutTail),
  };
  return `sha256:${sha256(stableStringify(payload))}`;
}

function appendTail(current, chunk, limit = 64 * 1024) {
  const next = `${current}${chunk.toString('utf8')}`;
  return next.length > limit ? next.slice(-limit) : next;
}

function terminateTree(child, signal = 'SIGTERM') {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 2_000,
    });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export async function executeJob(job, command, logPaths, onHeartbeat = () => {}) {
  mkdirSync(dirname(logPaths.stdout), { recursive: true });
  const stdoutLog = createWriteStream(logPaths.stdout, { flags: 'wx' });
  const stderrLog = createWriteStream(logPaths.stderr, { flags: 'wx' });
  let stdoutTail = '';
  let stderrTail = '';
  let timedOut = false;
  let launchError = null;
  let lastOutputAt = null;
  const logLimit = 16 * 1024 * 1024;
  const logBytes = { stdout: 0, stderr: 0 };
  // A full disk or broken log destination is a recorded failure, not an
  // unhandled EventEmitter error that kills the entire campaign.
  for (const stream of [stdoutLog, stderrLog]) {
    stream.on('error', (error) => {
      launchError = `Log write failed: ${error.message}`;
    });
  }

  const result = await new Promise((resolvePromise) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: job.workingDirectory,
      env: { ...process.env, ...job.env },
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      const remaining = Math.max(0, logLimit - logBytes.stdout);
      if (remaining && !stdoutLog.destroyed) stdoutLog.write(chunk.subarray(0, remaining));
      logBytes.stdout += chunk.length;
      lastOutputAt = now();
      stdoutTail = appendTail(stdoutTail, chunk);
    });
    child.stderr.on('data', (chunk) => {
      const remaining = Math.max(0, logLimit - logBytes.stderr);
      if (remaining && !stderrLog.destroyed) stderrLog.write(chunk.subarray(0, remaining));
      logBytes.stderr += chunk.length;
      lastOutputAt = now();
      stderrTail = appendTail(stderrTail, chunk);
    });
    child.once('error', (error) => {
      launchError = error instanceof Error ? error.message : String(error);
    });
    let settled = false;
    let forceTimer;
    let abandonTimer;
    const heartbeat = setInterval(() => {
      try {
        onHeartbeat({ pid: child.pid ?? null, heartbeatAt: now(), lastOutputAt });
      } catch (error) {
        launchError = `Heartbeat write failed: ${error.message}`;
        stop();
      }
    }, 10_000);
    const finish = (exitCode, signal, cleanupUnconfirmed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      clearTimeout(abandonTimer);
      clearInterval(heartbeat);
      process.removeListener('SIGTERM', interrupted);
      process.removeListener('SIGINT', interrupted);
      // Also reap grandchildren after an early parent exit. Their inherited
      // pipes must not hold the queue's close event open indefinitely.
      terminateTree(child, 'SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolvePromise({ exitCode, signal, cleanupUnconfirmed });
    };
    const stop = () => {
      if (forceTimer || settled) return;
      terminateTree(child);
      forceTimer = setTimeout(() => terminateTree(child, 'SIGKILL'), 2_000);
      abandonTimer = setTimeout(() => finish(null, 'SIGKILL', true), 4_000);
    };
    const interrupted = () => {
      launchError = 'Queue interrupted by operator signal.';
      stop();
    };
    process.once('SIGTERM', interrupted);
    process.once('SIGINT', interrupted);
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, job.timeoutMs);
    child.once('exit', (exitCode, signal) => {
      // close normally follows exit, but an orphan can keep pipes open.
      terminateTree(child, 'SIGKILL');
      abandonTimer ??= setTimeout(() => finish(exitCode, signal, true), 2_000);
    });
    child.once('close', (exitCode, signal) => finish(exitCode, signal));
  });

  await Promise.all(
    [stdoutLog, stderrLog].map(
      (stream) =>
        new Promise((resolvePromise) => {
          if (stream.destroyed) {
            resolvePromise();
            return;
          }
          stream.once('error', resolvePromise);
          stream.end(resolvePromise);
        }),
    ),
  );
  return {
    ...result,
    timedOut,
    launchError,
    stdoutTail,
    stderrTail,
    logsTruncated: Object.values(logBytes).some((bytes) => bytes > logLimit),
  };
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireRunLock(statePath) {
  const lockPath = `${statePath}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  try {
    const descriptor = openSync(lockPath, 'wx');
    writeFileSync(
      descriptor,
      `${JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: now() }, null, 2)}\n`,
      'utf8',
    );
    fsyncSync(descriptor);
    closeSync(descriptor);
    return { lockPath, staleLock: null };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let existing = null;
    try {
      existing = readJson(lockPath, 'Queue run lock');
    } catch {
      existing = { pid: null, malformed: true };
    }
    if (existing.hostname === hostname() && isPidAlive(Number(existing.pid))) {
      throw new Error(`Another queue process is active (pid ${existing.pid}, lock ${lockPath}).`);
    }
    rmSync(lockPath, { force: true });
    const lock = acquireRunLock(statePath);
    return { ...lock, staleLock: existing };
  }
}

function releaseRunLock(lockPath) {
  rmSync(lockPath, { force: true });
}

export function reconcileInterruptedRun(state, config = null) {
  if (!state.activeJobId) return null;
  const jobState = state.jobs[state.activeJobId];
  if (!jobState || jobState.status !== ACTIVE_STATUS) {
    state.activeJobId = null;
    return null;
  }
  const attempt = jobState.attempts.at(-1);
  const signature = `sha256:${sha256(`interrupted:${jobState.id}:${attempt?.startedAt ?? 'unknown'}`)}`;
  if (attempt && !attempt.finishedAt) {
    attempt.finishedAt = now();
    attempt.exitCode = null;
    attempt.signal = 'interrupted';
    attempt.timedOut = false;
    attempt.failureSignature = signature;
  }
  jobState.failureSignatures = [...new Set([...(jobState.failureSignatures ?? []), signature])];
  jobState.status = 'failed_runtime';
  jobState.reason = 'The previous queue process ended while this job was active; explicit remediation is required.';
  const configuredJob = config?.jobs?.find((job) => job.id === jobState.id);
  jobState.retrySuppressed = Boolean(configuredJob && jobState.attempts.length >= configuredJob.maxAttempts);
  jobState.updatedAt = now();
  state.activeJobId = null;
  state.updatedAt = now();
  return jobState.id;
}

function summary(config, state) {
  const jobs = config.jobs.map((job) => {
    const jobState = state.jobs[job.id];
    return {
      id: job.id,
      description: job.description,
      priority: job.priority,
      status: jobState.status,
      attempts: jobState.attempts.length,
      maxAttempts: job.maxAttempts,
      timeoutMs: job.timeoutMs,
      dependsOn: job.dependsOn,
      dependencyBlockers: dependencyBlockers(config, state, job),
      retrySuppressed: Boolean(jobState.retrySuppressed),
      reason: jobState.reason,
      evidence: jobState.evidence,
      command: commandForJob(job),
      campaignMode: job.campaignMode,
      recipeLockHash: job.recipeLockHash,
      requiresReviewBeforeRun: job.requiresReviewBeforeRun,
    };
  });
  return {
    schemaVersion: state.schemaVersion,
    activeJobId: state.activeJobId,
    updatedAt: state.updatedAt,
    counts: Object.fromEntries(
      [...KNOWN_STATUSES].map((status) => [status, jobs.filter((job) => job.status === status).length]),
    ),
    jobs,
  };
}

function printValue(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (value?.jobs) {
    console.log(`Queue: ${value.jobs.length} jobs; active=${value.activeJobId ?? 'none'}`);
    for (const job of value.jobs) {
      const blockers = job.dependencyBlockers.length ? ` dependencies=${job.dependencyBlockers.join(',')}` : '';
      console.log(
        `${job.id}: ${job.status} attempts=${job.attempts}/${job.maxAttempts} timeout=${job.timeoutMs}ms${blockers}`,
      );
      if (job.reason) console.log(`  reason: ${job.reason}`);
    }
    return;
  }
  console.log(value ? JSON.stringify(value, null, 2) : 'No runnable job.');
}

async function runOne(args) {
  if (args.dryRun) {
    const { config, state } = loadContext(args);
    const job = selectNextJob(config, state, args.jobId);
    const result = job
      ? { dryRun: true, jobId: job.id, timeoutMs: job.timeoutMs, command: commandForJob(job) }
      : { dryRun: true, jobId: null, reason: 'No pending eligible job.' };
    printValue(result, args.json);
    return 0;
  }

  const lock = args.runLock ?? acquireRunLock(args.statePath);
  try {
    const { config, state } = loadContext(args);
    const interruptedJobId = reconcileInterruptedRun(state, config);
    if (interruptedJobId) writeJsonAtomic(args.statePath, state);
    const job = selectNextJob(config, state, args.jobId);
    if (!job) {
      writeJsonAtomic(args.statePath, state);
      printValue(
        {
          jobId: null,
          reason: interruptedJobId
            ? `Recovered interrupted job ${interruptedJobId}; explicit remediation is required.`
            : 'No pending eligible job.',
        },
        args.json,
      );
      return 0;
    }

    const jobState = state.jobs[job.id];
    const attemptNumber = jobState.attempts.length + 1;
    const command = commandForJob(job);
    const logsDir = join(dirname(args.statePath), 'logs');
    const logBase = `${safeName(job.id)}.attempt-${attemptNumber}`;
    const logPaths = {
      stdout: join(logsDir, `${logBase}.stdout.log`),
      stderr: join(logsDir, `${logBase}.stderr.log`),
    };
    const attempt = {
      number: attemptNumber,
      startedAt: now(),
      finishedAt: null,
      timeoutMs: job.timeoutMs,
      command,
      workingDirectory: job.workingDirectory,
      remediationKey: jobState.retryApprovals.at(-1)?.key ?? null,
      recipeLockHash: job.recipeLockHash,
      stdoutLog: logPaths.stdout,
      stderrLog: logPaths.stderr,
    };
    jobState.attempts.push(attempt);
    jobState.status = ACTIVE_STATUS;
    jobState.reason = null;
    jobState.updatedAt = now();
    state.activeJobId = job.id;
    state.updatedAt = now();
    writeJsonAtomic(args.statePath, state);

    const effectiveJob = args.deadlineMs
      ? { ...job, timeoutMs: Math.min(job.timeoutMs, Math.max(1, args.deadlineMs - Date.now() - 5_000)) }
      : job;
    attempt.timeoutMs = effectiveJob.timeoutMs;
    const result = await executeJob(effectiveJob, command, logPaths, (heartbeat) => {
      Object.assign(attempt, heartbeat);
      writeJsonAtomic(args.statePath, state);
    });
    attempt.finishedAt = now();
    attempt.exitCode = result.exitCode;
    attempt.signal = result.signal;
    attempt.timedOut = result.timedOut;
    attempt.launchError = result.launchError;
    attempt.cleanupUnconfirmed = result.cleanupUnconfirmed;
    attempt.logsTruncated = result.logsTruncated;
    state.activeJobId = null;

    const succeeded = !result.timedOut && !result.launchError && !result.cleanupUnconfirmed && result.exitCode === 0;
    if (succeeded) {
      jobState.status = 'awaiting_quality';
      jobState.reason = 'Generation command completed; quality evidence and manual review are still required.';
      jobState.retrySuppressed = false;
    } else {
      const signature = failureSignature(result);
      const previousOccurrences = jobState.failureSignatures.filter((entry) => entry === signature).length;
      attempt.failureSignature = signature;
      jobState.failureSignatures.push(signature);
      jobState.status = 'failed_runtime';
      jobState.retrySuppressed = previousOccurrences > 0 || jobState.attempts.length >= job.maxAttempts;
      jobState.reason = result.timedOut
        ? `Command exceeded the ${effectiveJob.timeoutMs}ms timeout.`
        : result.launchError
          ? `Command failed to start: ${result.launchError}`
          : `Command exited with code ${result.exitCode ?? 'null'}${result.signal ? ` (${result.signal})` : ''}.`;
      if (previousOccurrences > 0) jobState.reason += ' The failure signature repeated; retries are suppressed.';
      else if (jobState.attempts.length >= job.maxAttempts) jobState.reason += ' The attempt cap is exhausted.';
    }
    jobState.updatedAt = now();
    state.updatedAt = now();
    writeJsonAtomic(args.statePath, state);
    const output = {
      jobId: job.id,
      status: jobState.status,
      attempt: attemptNumber,
      maxAttempts: job.maxAttempts,
      timedOut: result.timedOut,
      exitCode: result.exitCode,
      failureSignature: attempt.failureSignature ?? null,
      retrySuppressed: jobState.retrySuppressed,
      stdoutLog: logPaths.stdout,
      stderrLog: logPaths.stderr,
    };
    printValue(output, args.json);
    return succeeded ? 0 : 1;
  } finally {
    if (!args.runLock) releaseRunLock(lock.lockPath);
  }
}

async function runAll(args) {
  if (!args.budgetMs || args.budgetMs > 24 * 60 * 60 * 1000) {
    throw new Error('run-all requires --budget-ms between 1 and 86400000.');
  }
  if (args.jobId || args.dryRun)
    throw new Error('Use plan/next for inspection; run-all does not accept --job or --dry-run.');
  const lock = acquireRunLock(args.statePath);
  const deadlineMs = Date.now() + args.budgetMs;
  let failures = 0;
  let processed = 0;
  let interrupted = false;
  const onInterrupt = () => {
    interrupted = true;
  };
  process.on('SIGTERM', onInterrupt);
  process.on('SIGINT', onInterrupt);
  try {
    while (!interrupted && Date.now() + 5_000 < deadlineMs) {
      if (args.stopFile && existsSync(args.stopFile)) break;
      const { config, state } = loadContext(args);
      if (reconcileInterruptedRun(state, config)) writeJsonAtomic(args.statePath, state);
      if (!selectNextJob(config, state)) break;
      failures += await runOne({ ...args, runLock: lock, deadlineMs });
      processed += 1;
    }
    printValue(
      {
        processed,
        failures,
        deadlineReached: Date.now() + 5_000 >= deadlineMs,
        stopRequested: Boolean(args.stopFile && existsSync(args.stopFile)),
      },
      args.json,
    );
    return interrupted ? 130 : failures ? 1 : 0;
  } finally {
    process.removeListener('SIGTERM', onInterrupt);
    process.removeListener('SIGINT', onInterrupt);
    releaseRunLock(lock.lockPath);
  }
}

function withShortLock(args, operation) {
  const lock = acquireRunLock(args.statePath);
  try {
    const context = loadContext(args);
    reconcileInterruptedRun(context.state, context.config);
    const result = operation(context);
    writeJsonAtomic(args.statePath, context.state);
    return result;
  } finally {
    releaseRunLock(lock.lockPath);
  }
}

function markJob(args) {
  if (!args.jobId) throw new Error('mark requires --job <id>.');
  if (!MANUAL_STATUSES.has(args.status)) {
    throw new Error(`mark --status must be one of: ${[...MANUAL_STATUSES].join(', ')}.`);
  }
  if (!args.reason?.trim()) throw new Error('mark requires a non-empty --reason.');
  return withShortLock(args, ({ config, state }) => {
    const job = config.jobs.find((entry) => entry.id === args.jobId);
    if (!job) throw new Error(`Unknown queue job id: ${args.jobId}`);
    const jobState = state.jobs[job.id];
    if (jobState.status === ACTIVE_STATUS) throw new Error(`Cannot mark active job ${job.id}.`);
    let evidence = null;
    if (args.status === 'proven' && !args.evidence) {
      throw new Error('Marking proven requires --evidence <existing-path>.');
    }
    if (args.evidence) {
      evidence = resolveFromRoot(args.evidence);
      if (!existsSync(evidence)) throw new Error(`Proof evidence does not exist: ${evidence}`);
    }
    jobState.status = args.status;
    jobState.reason = args.reason.trim();
    jobState.evidence = evidence;
    jobState.retrySuppressed = args.status === 'failed_quality' && jobState.attempts.length >= job.maxAttempts;
    jobState.updatedAt = now();
    state.updatedAt = now();
    return { jobId: job.id, status: jobState.status, reason: jobState.reason, evidence };
  });
}

function retryJob(args) {
  if (!args.jobId) throw new Error('retry requires --job <id>.');
  if (!args.reason?.trim()) throw new Error('retry requires a non-empty --reason.');
  if (!args.remediationKey?.trim()) throw new Error('retry requires --remediation-key <unique-key>.');
  return withShortLock(args, ({ config, state }) => {
    const job = config.jobs.find((entry) => entry.id === args.jobId);
    if (!job) throw new Error(`Unknown queue job id: ${args.jobId}`);
    const jobState = state.jobs[job.id];
    if (!RETRYABLE_STATUSES.has(jobState.status)) {
      throw new Error(`${job.id} is ${jobState.status}; only failed or blocked jobs can be retried.`);
    }
    if (job.requiresReviewBeforeRun) {
      throw new Error(`${job.id} already has a valid output; review or publish it instead of regenerating.`);
    }
    if (jobState.attempts.length >= job.maxAttempts) {
      throw new Error(`${job.id} exhausted its ${job.maxAttempts}-attempt cap.`);
    }
    const signatureCounts = new Map();
    for (const signature of jobState.failureSignatures) {
      signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1);
    }
    if ([...signatureCounts.values()].some((count) => count > 1)) {
      throw new Error(`${job.id} repeated a failure signature; retries are permanently suppressed.`);
    }
    if (jobState.retrySuppressed) throw new Error(`${job.id} has retries suppressed.`);
    const previousAttempt = jobState.attempts.at(-1);
    if (jobState.status === 'failed_quality') {
      const decision = jobState.reviewDecisions.at(-1);
      if (!decision || decision.decision === 'approve') {
        throw new Error(`${job.id} needs a recorded quality review decision before retry.`);
      }
      if (!job.recipeLockHash || job.recipeLockHash === previousAttempt?.recipeLockHash) {
        throw new Error(`${job.id} failed quality and cannot rerun an unchanged recipe lock hash.`);
      }
    }
    const key = args.remediationKey.trim();
    if (jobState.retryApprovals.some((approval) => approval.key === key)) {
      throw new Error(`Remediation key was already used for ${job.id}: ${key}`);
    }
    jobState.retryApprovals.push({ key, reason: args.reason.trim(), approvedAt: now() });
    jobState.status = RUNNABLE_STATUS;
    jobState.reason = `Requeued after remediation ${key}: ${args.reason.trim()}`;
    jobState.evidence = null;
    jobState.updatedAt = now();
    state.updatedAt = now();
    return { jobId: job.id, status: jobState.status, remediationKey: key };
  });
}

function reviewJob(args) {
  if (!args.jobId) throw new Error('review requires --job <id>.');
  if (!REVIEW_DECISIONS.has(args.decision)) {
    throw new Error(`review --decision must be one of: ${[...REVIEW_DECISIONS].join(', ')}.`);
  }
  if (!args.reason?.trim()) throw new Error('review requires a non-empty --reason.');
  return withShortLock(args, ({ config, state }) => {
    const job = config.jobs.find((entry) => entry.id === args.jobId);
    if (!job) throw new Error(`Unknown queue job id: ${args.jobId}`);
    const jobState = state.jobs[job.id];
    if (jobState.status !== 'awaiting_quality') {
      throw new Error(`${job.id} is ${jobState.status}; only awaiting_quality jobs can be reviewed.`);
    }
    let evidence = null;
    if (args.evidence) {
      evidence = resolveFromRoot(args.evidence);
      if (!existsSync(evidence)) throw new Error(`Review evidence does not exist: ${evidence}`);
    }
    if (args.decision === 'approve' && !evidence) {
      throw new Error('Approving an output requires --evidence <existing quality-review-path>.');
    }
    const record = {
      decision: args.decision,
      reason: args.reason.trim(),
      evidence,
      recipeLockHash: jobState.attempts.at(-1)?.recipeLockHash ?? job.recipeLockHash,
      reviewedAt: now(),
    };
    jobState.reviewDecisions.push(record);
    jobState.evidence = evidence;
    if (args.decision === 'approve') {
      jobState.status = 'proven';
      jobState.retrySuppressed = true;
    } else if (args.decision === 'block') {
      jobState.status = 'blocked_external';
    } else {
      jobState.status = 'failed_quality';
      jobState.retrySuppressed = jobState.attempts.length >= job.maxAttempts;
    }
    jobState.reason = `${args.decision}: ${args.reason.trim()}`;
    jobState.updatedAt = now();
    state.updatedAt = now();
    return { jobId: job.id, status: jobState.status, ...record };
  });
}

export async function runCli(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.command === 'help') {
    console.log(usage());
    return 0;
  }
  if (!['plan', 'status', 'next', 'run', 'run-all', 'mark', 'retry', 'review'].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command}\n\n${usage()}`);
  }
  if (args.command === 'run') return runOne(args);
  if (args.command === 'run-all') return runAll(args);
  if (args.command === 'mark') {
    printValue(markJob(args), args.json);
    return 0;
  }
  if (args.command === 'retry') {
    printValue(retryJob(args), args.json);
    return 0;
  }
  if (args.command === 'review') {
    printValue(reviewJob(args), args.json);
    return 0;
  }

  const { config, state } = loadContext(args);
  if (args.command === 'next') {
    const job = selectNextJob(config, state, args.jobId);
    printValue(
      job
        ? {
            jobId: job.id,
            status: state.jobs[job.id].status,
            timeoutMs: job.timeoutMs,
            attempts: state.jobs[job.id].attempts.length,
            maxAttempts: job.maxAttempts,
            command: commandForJob(job),
          }
        : null,
      args.json,
    );
    return 0;
  }
  printValue(summary(config, state), args.json);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
