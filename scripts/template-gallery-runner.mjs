import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  decodedMediaHash,
  finalizeReviewedDerivative,
  loadTemplateRuntime,
  technicalMediaErrors,
} from './template-gallery-harness.mjs';
import {
  backendSourceEvidence,
  backendSourceIdentity,
  compareRunProvenance,
  createRunProvenance,
  modelSetIdentity,
  resolvedModelReposFromOutput,
  selectBackendRuntimeFingerprintEvidence,
  selectInstalledModelIdentity,
} from './live-proof-provenance.mjs';
import {
  closeWorkflowBrowser,
  createWorkflowBrowserSessionGuard,
  isWorkflowBrowserSessionError,
  launchWorkflowBrowser,
} from './workflow-library-browser-session.mjs';

const ROOT = process.cwd();
const ARTIFACT_ROOT = join(ROOT, 'artifacts', 'template-gallery');
const DEFAULT_SERVER = process.env.MODIFF_GALLERY_SERVER || 'http://127.0.0.1:8088';
const DEFAULT_PORT = Number(process.env.MODIFF_GALLERY_FRONTEND_PORT || 5192);
const DEFAULT_BACKEND_DIR = process.env.MODIFF_BACKEND_DIR || resolve(ROOT, '..', 'MoDiff');
const RUNNER_LOCK_PATH = join(ARTIFACT_ROOT, '.runner.lock');
export const RUNNER_INFRASTRUCTURE_EXIT_CODE = 70;
export const GALLERY_BROWSER_RECOVERY_ATTEMPTS = 2;
export const GALLERY_CAPTURE_OPERATION_TIMEOUT_FLOOR_MS = 2 * 60 * 60 * 1000;
const GALLERY_BROWSER_SESSION_LABEL = 'template Gallery';
const DEFAULT_INPUT_BINDINGS_PATH = join(
  ROOT,
  'public',
  'template-gallery',
  'runtime-inputs',
  'default-input-bindings.json',
);
const DEFAULT_INPUT_RUNTIME_PATH = /^\/template-gallery\/runtime-inputs\/assets\/[a-f0-9]{64}\.[a-z0-9]+$/;
const GENERATED_EXTENSION_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/flac': '.flac',
  'application/json': '.json',
};
const GENERATED_EXTENSION_BY_TYPE = {
  image: '.png',
  video: '.mp4',
  audio: '.wav',
  json: '.json',
};

function bundledFfmpegPath(backendDir) {
  const roots = [join(backendDir, '.venv', 'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries')];
  const libraryRoot = join(backendDir, '.venv', 'lib');
  if (existsSync(libraryRoot)) {
    for (const pythonDir of readdirSync(libraryRoot).filter((name) => name.startsWith('python'))) {
      roots.push(join(libraryRoot, pythonDir, 'site-packages', 'imageio_ffmpeg', 'binaries'));
    }
  }
  for (const binaries of roots) {
    if (!existsSync(binaries)) continue;
    const executable = readdirSync(binaries).find((name) => /^ffmpeg(?:-|\.exe|$)/i.test(name));
    if (executable) return join(binaries, executable);
  }
  return null;
}

function bundledPythonPath(backendDir) {
  const candidate =
    process.platform === 'win32'
      ? join(backendDir, '.venv', 'Scripts', 'python.exe')
      : join(backendDir, '.venv', 'bin', 'python');
  return existsSync(candidate) ? candidate : 'python';
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireRunnerLock(lockPath = RUNNER_LOCK_PATH, pid = process.pid) {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(lockPath, 'wx');
      writeFileSync(descriptor, `${JSON.stringify({ pid, startedAt: new Date().toISOString() })}\n`);
      closeSync(descriptor);
      return () => {
        try {
          const owner = JSON.parse(readFileSync(lockPath, 'utf8'));
          if (owner?.pid === pid) unlinkSync(lockPath);
        } catch {
          // A replaced or already-cleaned lock belongs to another process.
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let owner = null;
      try {
        owner = JSON.parse(readFileSync(lockPath, 'utf8'));
      } catch {
        // Invalid lock files are stale and safe to replace.
      }
      if (processIsAlive(Number(owner?.pid))) {
        throw new Error(
          `Another template-gallery runner is active (PID ${owner.pid}). Wait for it to finish instead of sharing one app execution session.`,
        );
      }
      unlinkSync(lockPath);
    }
  }
  throw new Error('Could not acquire the template-gallery runner lock.');
}

export function parseArgs(argv) {
  const args = {
    server: DEFAULT_SERVER,
    port: DEFAULT_PORT,
    runs: 2,
    timeoutMs: 15 * 60 * 1000,
    queueWaitTimeoutMs: 2 * 60 * 1000,
    headless: true,
    publish: false,
    keepFrontend: false,
    keepBackend: false,
    sourceOnly: false,
    noStart: false,
    noBackendStart: false,
    reuseRuntimeWithinModel: false,
    reuseExistingRuntimeKey: '',
    stopOnFailure: false,
    backendDir: DEFAULT_BACKEND_DIR,
    startRun: 1,
    templates: [],
    referenceImageValues: [],
  };

  for (let index = 2; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === '--help' || entry === '-h') {
      args.help = true;
      continue;
    }
    if (entry === '--publish') {
      args.publish = true;
      continue;
    }
    if (entry === '--reviewed') {
      args.reviewed = true;
      continue;
    }
    if (entry === '--record-qualification') {
      args.recordQualification = true;
      continue;
    }
    if (entry === '--record-resource-qualification') {
      args.recordResourceQualification = true;
      continue;
    }
    if (entry === '--keep-frontend') {
      args.keepFrontend = true;
      continue;
    }
    if (entry === '--keep-backend') {
      args.keepBackend = true;
      continue;
    }
    if (entry === '--no-backend-start') {
      args.noBackendStart = true;
      continue;
    }
    if (entry === '--reuse-runtime-within-model') {
      args.reuseRuntimeWithinModel = true;
      continue;
    }
    if (entry === '--stop-on-failure') {
      args.stopOnFailure = true;
      continue;
    }
    if (entry === '--source-only') {
      args.sourceOnly = true;
      continue;
    }
    if (entry === '--allow-non-exact') {
      args.allowNonExact = true;
      continue;
    }
    if (entry === '--allow-blocked-probe') {
      args.allowBlockedProbe = true;
      continue;
    }
    if (entry === '--repair-model') {
      args.repairModel = true;
      continue;
    }
    if (entry === '--no-start') {
      args.noStart = true;
      continue;
    }
    if (entry === '--headed') {
      args.headless = false;
      continue;
    }
    if (entry.startsWith('--')) {
      const [key, inlineValue] = entry.slice(2).split('=');
      const value = inlineValue ?? argv[index + 1];
      if (inlineValue === undefined) index += 1;
      if (key === 'template') {
        args.templates.push(
          ...String(value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        );
      } else if (key === 'runs') {
        args.runs = Number(value ?? 2);
        args.runsExplicit = true;
      } else if (key === 'timeout-ms') {
        args.timeoutMs = Number(value ?? args.timeoutMs);
      } else if (key === 'queue-wait-timeout-ms') {
        args.queueWaitTimeoutMs = Number(value ?? args.queueWaitTimeoutMs);
      } else if (key === 'port') {
        args.port = Number(value ?? args.port);
      } else if (key === 'reuse-existing-runtime-key') {
        args.reuseExistingRuntimeKey = String(value ?? '').trim();
        args.reuseRuntimeWithinModel = true;
      } else if (key === 'backend-dir') {
        args.backendDir = resolve(String(value ?? args.backendDir));
      } else if (key === 'headless') {
        args.headless = String(value) !== 'false';
      } else if (key === 'max-templates') {
        args.maxTemplates = Number(value);
      } else if (key === 'start-run') {
        args.startRun = Number(value);
      } else if (key === 'reference-image') {
        args.referenceImageValues.push(
          ...String(value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        );
      } else {
        args[key] = value;
      }
    }
  }

  args.frontendUrlExplicit = typeof args['frontend-url'] === 'string' && args['frontend-url'].trim().length > 0;
  args.frontendUrl = args.frontendUrlExplicit ? args['frontend-url'].trim() : `http://127.0.0.1:${args.port}`;
  const minimumRuns = args.sourceOnly || args.reviewed ? 1 : 2;
  if (args.sourceOnly && !args.runsExplicit) args.runs = 1;
  args.runs = Math.max(minimumRuns, Number.isFinite(args.runs) ? args.runs : 2);
  if (args.reviewed) args.runs = 1;
  if (args.recordResourceQualification) {
    args.reviewed = true;
    args.runs = 1;
  }
  args.startRun = Math.max(1, Math.min(args.runs, Number.isFinite(args.startRun) ? args.startRun : 1));
  args.resumeMediaDir = args['resume-media-dir'] ? resolve(String(args['resume-media-dir'])) : '';
  if (args.startRun > 1 && !args.resumeMediaDir) {
    throw new Error('--start-run requires --resume-media-dir with retained earlier run evidence.');
  }
  args.promptOverride = typeof args['prompt-override'] === 'string' ? args['prompt-override'].trim() : '';
  args.negativePromptOverride =
    typeof args['negative-prompt-override'] === 'string' ? args['negative-prompt-override'].trim() : '';
  args.outputName = typeof args['output-name'] === 'string' ? safeFileName(args['output-name']) : '';
  args.installModel = typeof args['install-model'] === 'string' ? args['install-model'].trim() : '';
  args.installModelFiles =
    typeof args['install-model-file'] === 'string'
      ? args['install-model-file']
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  if (args.sourceOnly && args.publish) {
    throw new Error('--source-only cannot be combined with --publish.');
  }
  if (args.allowBlockedProbe && args.publish) {
    throw new Error('--allow-blocked-probe is qualification-only and cannot be combined with --publish.');
  }
  if (args.recordQualification && args.recordResourceQualification) {
    throw new Error('--record-qualification and --record-resource-qualification cannot be combined.');
  }
  if (args.recordResourceQualification && args.publish) {
    throw new Error('--record-resource-qualification cannot be combined with --publish.');
  }
  if (
    args.recordResourceQualification &&
    !args['resource-mode'] &&
    !args['offload-mode'] &&
    !args['quantization-mode']
  ) {
    throw new Error(
      '--record-resource-qualification requires an explicit resource, offload, or quantization override.',
    );
  }
  if (args.installModel && (args.sourceOnly || args.publish || args.templates.length > 0)) {
    throw new Error(
      '--install-model is a standalone app operation and cannot be combined with template capture options.',
    );
  }
  if (args.repairModel && !args.installModel) {
    throw new Error('--repair-model requires --install-model <repo>.');
  }
  if (args.installModelFiles.length > 0 && !args.installModel) {
    throw new Error('--install-model-file requires --install-model <repo>.');
  }
  const resolveMediaInput = (value) => {
    const normalized = String(value ?? '').trim();
    if (!normalized || /^(?:https?:|data:)/i.test(normalized) || isAbsolute(normalized)) return normalized;
    return resolve(ROOT, normalized);
  };
  args.referenceImages = args.referenceImageValues.map(resolveMediaInput).filter(Boolean);
  args.maskImage = resolveMediaInput(args['mask-image']);
  args.controlImage = resolveMediaInput(args['control-image']);
  args.sourceVideo = resolveMediaInput(args['source-video']);
  args.maskVideo = resolveMediaInput(args['mask-video']);
  args.controlVideo = resolveMediaInput(args['control-video']);
  args.sourceAudio = resolveMediaInput(args['source-audio']);
  args.referenceAudio = resolveMediaInput(args['reference-audio']);
  args.templateInputMap = {};
  const templateInputMapPath = String(args['template-input-map'] ?? '').trim();
  if (templateInputMapPath) {
    const parsed = JSON.parse(readFileSync(resolve(templateInputMapPath), 'utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('--template-input-map must point to a JSON object keyed by template id.');
    }
    for (const [templateId, value] of Object.entries(parsed)) {
      if (!value || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`Template input map entry ${templateId} must be an object.`);
      }
      args.templateInputMap[templateId] = {
        referenceImages: (value.referenceImages ?? []).map(resolveMediaInput).filter(Boolean),
        maskImage: resolveMediaInput(value.maskImage),
        controlImage: resolveMediaInput(value.controlImage),
        sourceVideo: resolveMediaInput(value.sourceVideo),
        maskVideo: resolveMediaInput(value.maskVideo),
        controlVideo: resolveMediaInput(value.controlVideo),
        sourceAudio: resolveMediaInput(value.sourceAudio),
        referenceAudio: resolveMediaInput(value.referenceAudio),
      };
    }
  }
  args.ffmpeg = String(
    args.ffmpeg ?? process.env.MODIFF_FFMPEG ?? bundledFfmpegPath(args.backendDir) ?? 'ffmpeg',
  ).trim();
  return args;
}

function usage() {
  return `
Usage:
  npm run gallery:run -- [options]

Runs eligible Studio templates through a live MoDiff backend and stores immutable
media plus provenance under artifacts/template-gallery. Exact mode uses two runs;
--reviewed coverage mode uses one run and pauses for manual quality review.

Use --allow-non-exact only to capture a currently non-exact template after all of
its model and input locks have been supplied. The resulting evidence must still
pass the normal two-run comparison and manual quality review before publishing.

Use --allow-blocked-probe only for bounded qualification evidence. It never
permits direct publishing of a blocked template.

Options:
  --server <url>             Backend URL. Default: ${DEFAULT_SERVER}
  --backend-dir <path>       Backend checkout to start when loopback is unavailable. Default: ${DEFAULT_BACKEND_DIR}
  --no-backend-start         Require an already-running backend.
  --reuse-runtime-within-model Keep cached nodes only when consecutive templates publish the same loader-contract key.
  --reuse-existing-runtime-key <key> Reuse an already-resident first-template loader only when its published contract key matches.
  --keep-backend             Keep a backend process started by this script.
  --port <number>            Dev frontend port. Default: ${DEFAULT_PORT}
  --frontend-url <url>       Existing frontend URL instead of the default port URL.
  --template <id[,id]>       Limit to one or more template ids. Repeatable.
  --max-templates <number>   Cap the number of selected templates.
  --reviewed                 Coverage mode: run once, then pause for manual quality review.
  --record-qualification     Retain successful v2 locked-template runs as release execution evidence.
  --record-resource-qualification Retain one full locked-workload run as evidence for the explicit resource recipe.
  --allow-blocked-probe      Run a blocked template for qualification evidence; incompatible with --publish.
  --runs <number>            Runs per gallery template (minimum 2); reviewed/source-only use 1.
  --start-run <number>       Resume at this run number; requires retained proof via --resume-media-dir.
  --resume-media-dir <path>  Reuse a prior run's media/evidence directory without regenerating good outputs.
  --model-revision <rev>     Optional explicit revision for manifest generation.
  --runtime-fingerprint <id> Fallback runtime fingerprint if outputs do not report one.
  --reference-image <path>   Source/reference image path for edit-style templates.
  --control-image <path>     Control image path for ControlNet templates.
  --mask-image <path>        Mask image path for inpaint templates.
  --source-video <path>      Source video path for video edit templates.
  --mask-video <path>        Mask video path for video inpaint/outpaint templates.
  --control-video <path>     Control video path for control-to-video templates.
  --source-audio <path>      Source audio path for variation/continuation/repaint templates.
  --reference-audio <path>   Optional reference audio path when required by a template.
  --template-input-map <path> JSON object of per-template media inputs for same-model batch runs.
  --resource-mode <mode>     Optional bounded probe override: auto or expert.
  --quantization-mode <mode> Optional bounded probe override, for example bnb_4bit.
  --offload-mode <mode>      Optional bounded probe override, for example group_cpu.
  --steps <number>           Optional bounded probe inference-step override.
  --width <number>           Optional bounded probe width override.
  --height <number>          Optional bounded probe height override.
  --num-frames <number>      Optional bounded probe frame-count override.
  --source-only              Capture purpose-built input media; never generate/publish a gallery manifest.
  --prompt-override <text>   Source-only prompt override for creating a purpose-matched input asset.
  --negative-prompt-override <text> Source-only negative-prompt override.
  --output-name <name>       Stable source-only media basename instead of the template id.
  --install-model <repo>     Install one Hugging Face repository through the app model-store action.
  --install-model-file <paths> Limit installation to a comma-separated set of pinned repository files.
  --repair-model             Repair an incomplete --install-model repository snapshot.
  --ffmpeg <path>            FFmpeg executable for decoded audio/video hashing and video posters.
  --publish                  Pass --publish to gallery:generate after verification.
  --headed                   Show the browser while running.
  --no-start                 Require an already-running frontend.
  --keep-frontend            Do not stop a frontend process started by this script.
  --timeout-ms <number>      Per-run inactivity timeout; live backend progress refreshes it. Default: 900000.
  --queue-wait-timeout-ms <number> Wait for an earlier app task before starting. Default: 120000.
`.trim();
}

function artifactDirForRun() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ARTIFACT_ROOT, `${timestamp}-run`);
  mkdirSync(artifactDir, { recursive: true });
  return artifactDir;
}

function request(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Timed out requesting ${url}`));
    });
  });
}

async function waitForHttp(url, timeoutMs = 60_000, watchedChild = null) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    if (watchedChild && watchedChild.exitCode !== null) {
      throw new Error(`Backend exited with code ${watchedChild.exitCode} before ${url} became ready.`);
    }
    try {
      const status = await request(url);
      if (status >= 200 && status < 500) return;
      lastError = `HTTP ${status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}. ${lastError}`);
}

function pipeProcessLog(child, logPath, role) {
  const output = createWriteStream(logPath, { flags: 'a' });
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  child.on('close', (code, signal) => {
    if (!output.destroyed && !output.writableEnded) {
      output.end(`\n[${role}] exited code=${code} signal=${signal}\n`);
    }
  });
}

async function stopManagedProcess(child, timeoutMs = 5_000) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  const exited = new Promise((resolveExit) => {
    child.once('close', resolveExit);
  });
  child.kill('SIGTERM');
  const timedOut = await Promise.race([exited.then(() => false), delay(timeoutMs).then(() => true)]);
  if (timedOut && child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(1_000)]);
  }
}

export function backendProcessEnv(environment = process.env, rocmRoot = '/opt/rocm') {
  const childEnv = { ...environment, PYTHONUNBUFFERED: '1' };
  if (process.platform === 'win32' || !existsSync(rocmRoot)) return childEnv;

  const libraryPaths = [join(rocmRoot, 'lib')];
  libraryPaths.push(
    ...readdirSync(rocmRoot)
      .filter((entry) => entry.startsWith('core-'))
      .map((entry) => join(rocmRoot, entry, 'lib')),
  );
  const existingPaths = libraryPaths.filter((entry) => existsSync(entry));
  if (existingPaths.length > 0) {
    childEnv.LD_LIBRARY_PATH = [
      ...existingPaths,
      ...(environment.LD_LIBRARY_PATH ? [environment.LD_LIBRARY_PATH] : []),
    ].join(':');
    childEnv.ROCM_PATH ||= rocmRoot;
    childEnv.HIP_PATH ||= rocmRoot;
    childEnv.TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL ||= '1';
  }
  return childEnv;
}

async function ensureBackend(args, managedProcesses, artifactDir) {
  const healthUrl = `${args.server.replace(/\/$/, '')}/health`;
  try {
    await waitForHttp(healthUrl, 1500);
    return { started: false, url: args.server };
  } catch (initialError) {
    if (args.noBackendStart) throw initialError;
  }

  const serverUrl = new URL(args.server);
  if (!['127.0.0.1', 'localhost', '::1'].includes(serverUrl.hostname)) {
    throw new Error(`Refusing to auto-start a local backend for non-loopback server ${args.server}.`);
  }
  if (!existsSync(args.backendDir)) {
    throw new Error(`MoDiff backend directory does not exist: ${args.backendDir}`);
  }

  const bundledPython =
    process.platform === 'win32'
      ? join(args.backendDir, '.venv', 'Scripts', 'python.exe')
      : join(args.backendDir, '.venv', 'bin', 'python');
  const child = spawn(existsSync(bundledPython) ? bundledPython : 'python', ['main.py'], {
    cwd: args.backendDir,
    env: backendProcessEnv(),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipeProcessLog(child, join(artifactDir, 'backend.log'), 'backend');
  managedProcesses.push({ child, role: 'backend' });
  await waitForHttp(healthUrl, 120_000, child);
  return { started: true, url: args.server, pid: child.pid, log: join(artifactDir, 'backend.log') };
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

export async function ensureFrontend(args, managedProcesses) {
  if (args.frontendUrlExplicit) {
    await waitForHttp(args.frontendUrl);
    return { started: false, url: args.frontendUrl, explicitlyReused: true };
  }
  if (!(await isPortFree(args.port))) {
    if (!args.noStart) {
      throw new Error(
        `Frontend port ${args.port} is already occupied. Refusing to reuse an unverified app session; ` +
          'stop that process or pass --frontend-url explicitly.',
      );
    }
    await waitForHttp(args.frontendUrl);
    return { started: false, url: args.frontendUrl, explicitlyReused: true };
  }
  if (args.noStart) {
    throw new Error(`Frontend is not running on ${args.frontendUrl}, and --no-start was set.`);
  }

  const viteCli = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteCli)) {
    throw new Error(`Vite CLI is missing at ${viteCli}. Install the client dependencies before running the gallery.`);
  }
  const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(args.port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_BACKEND_PROXY_TARGET: args.server,
      MODIFF_GALLERY_STABLE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  managedProcesses.push({ child, role: 'frontend' });
  await waitForHttp(args.frontendUrl);
  return { started: true, url: args.frontendUrl };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeFileName(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-');
}

export function galleryRunExitCode(results, manifestGeneration = {}) {
  if (results.some((item) => item?.failureKind === 'infrastructure')) {
    return RUNNER_INFRASTRUCTURE_EXIT_CODE;
  }
  if (results.some((item) => item.skipped)) return 1;
  return Number(manifestGeneration.code || 0);
}

export async function installEphemeralGalleryStorage(page) {
  await page.addInitScript(() => {
    const persistentKeys = new Set(['modiff.studio', 'modiff.flow']);
    const originalSetItem = Storage.prototype.setItem;

    Storage.prototype.setItem = function setEphemeralGalleryItem(key, value) {
      if (persistentKeys.has(String(key))) return;
      return originalSetItem.call(this, key, value);
    };

    for (const key of persistentKeys) {
      localStorage.removeItem(key);
    }
  });
}

export function createGalleryBrowserSessionGuard(options) {
  return createWorkflowBrowserSessionGuard({
    ...options,
    sessionLabel: GALLERY_BROWSER_SESSION_LABEL,
  });
}

export function isGalleryBrowserLifecycleFailure(error) {
  if (isWorkflowBrowserSessionError(error)) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Target page, context or browser has been closed|Target crashed|Page crashed|browser has been closed/i.test(
    message,
  );
}

export async function runWithGalleryBrowserRecovery(action, recover, attempts = GALLERY_BROWSER_RECOVERY_ATTEMPTS) {
  let recovery = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { value: await action(attempt), recovery };
    } catch (error) {
      if (!isGalleryBrowserLifecycleFailure(error) || attempt === attempts) throw error;
      recovery = await recover(error, attempt + 1);
    }
  }
  throw new Error('Template Gallery browser recovery exhausted without a terminal result.');
}

export function galleryCaptureOperationTimeoutMs(timeoutMs, runs = 1) {
  const perRunTimeoutMs = Number(timeoutMs);
  const runCount = Number(runs);
  if (!Number.isFinite(perRunTimeoutMs) || perRunTimeoutMs < 1) {
    throw new Error('Gallery capture inactivity timeout must be a positive number.');
  }
  if (!Number.isInteger(runCount) || runCount < 1) {
    throw new Error('Gallery capture run count must be a positive integer.');
  }
  // waitForOutput and waitForTaskTerminal already enforce the caller's
  // inactivity timeout and refresh it when the backend reports progress. The
  // outer browser guard is only a final safety net; it must not expire first
  // during a healthy cold load or a long exact workload such as Qwen.
  return Math.max(GALLERY_CAPTURE_OPERATION_TIMEOUT_FLOOR_MS, perRunTimeoutMs * runCount + 180_000);
}

async function closeGalleryBrowser(browser) {
  await closeWorkflowBrowser(browser, undefined, GALLERY_BROWSER_SESSION_LABEL);
}

async function withGalleryBrowserPage(args, frontendUrl, operation, action, operationTimeoutMs = 180_000) {
  const browser = await launchWorkflowBrowser(
    () => chromium.launch({ headless: args.headless, args: ['--disable-dev-shm-usage'] }),
    { sessionLabel: GALLERY_BROWSER_SESSION_LABEL },
  );
  let guard = null;
  let operationError = null;
  try {
    const page = await browser.newPage();
    guard = createGalleryBrowserSessionGuard({
      browser,
      page,
      operationTimeoutMs: Math.max(180_000, Number(operationTimeoutMs) || 0),
    });
    const websocketEvents = [];
    page.on('websocket', (websocket) => {
      websocket.on('framereceived', (event) => {
        try {
          websocketEvents.push(JSON.parse(String(event.payload)));
        } catch {
          websocketEvents.push({ raw: String(event.payload) });
        }
      });
    });
    await guard.run('initializing the app page', async (currentPage) => {
      await installEphemeralGalleryStorage(currentPage);
      await currentPage.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
      await currentPage.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
      await currentPage.waitForFunction(
        () => Boolean(window.__MODIFF_E2E__?.getState()?.websocket?.isConnected),
        null,
        { timeout: 60_000 },
      );
    });
    return await guard.run(operation, (currentPage) => action(currentPage, websocketEvents));
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    guard?.dispose();
    try {
      await closeGalleryBrowser(browser);
    } catch (closeError) {
      if (!operationError) throw closeError;
    }
  }
}

export function galleryGenerateInvocation({
  mediaDir,
  modelRevision,
  runtimeFingerprint,
  provenanceDir,
  ffmpeg,
  beforeMedia,
  templates = [],
  verification = 'exact',
  publish = false,
}) {
  const args = [
    join(ROOT, 'scripts', 'template-gallery-harness.mjs'),
    'generate',
    '--media-dir',
    mediaDir,
    '--model-revision',
    modelRevision,
    '--runtime-fingerprint',
    runtimeFingerprint,
    '--verification',
    verification,
  ];
  if (provenanceDir) args.push('--provenance-dir', provenanceDir);
  if (ffmpeg) args.push('--ffmpeg', ffmpeg);
  if (beforeMedia) args.push('--before-media', beforeMedia);
  for (const templateId of templates) args.push('--template', templateId);
  if (publish) args.push('--publish');
  return { command: process.execPath, args };
}

export function failureMessageForRun(failure, { taskId, startedAt }) {
  if (!failure || typeof failure !== 'object') return null;
  if (taskId && failure.taskId && failure.taskId !== taskId) return null;
  if (Number(failure.createdAt ?? 0) < Number(startedAt ?? 0)) return null;
  return String(failure.message || failure.error || 'The backend reported a task failure.');
}

async function queueReceiptForTask(server, taskId) {
  if (!server || !taskId) return null;
  try {
    const response = await fetch(new URL('/queue', server));
    if (!response.ok) return null;
    const payload = await response.json();
    const candidates = [payload?.current, ...Object.values(payload?.queued ?? {}), ...(payload?.recent ?? [])];
    return candidates.find((item) => item?.task_id === taskId || item?.id === taskId) ?? null;
  } catch {
    return null;
  }
}

function throwForTerminalReceipt(receipt, taskId) {
  if (!receipt || !['failed', 'cancelled'].includes(receipt.status)) return;
  throw new Error(`Task ${taskId} became ${receipt.status}: ${receipt.message ?? receipt.error ?? ''}`);
}

async function recoverOutputFromBackendCache(page, { receipt, server, taskId, templateId }) {
  if (!receipt?.current_node || !server) return null;
  let recovered = null;
  for (const fieldKey of ['file', 'output', 'audio', 'preview']) {
    const query = fieldKey === 'output' ? '?format=WEBP&quality=100' : '';
    const cacheUrl = new URL(`/cache/${receipt.current_node}/${fieldKey}/0${query}`, server).toString();
    try {
      const response = await fetch(cacheUrl);
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? '';
      if (!/^(image|video|audio)\//.test(contentType)) continue;
      recovered = { cacheUrl, contentType, fieldKey };
      break;
    } catch {
      // A completed output node may expose only one of these media fields.
    }
  }
  if (!recovered) return null;

  return page.evaluate(
    ({ expectedTaskId, expectedTemplateId, nodeId, url, completedAt, runtimeFingerprint, contentType, fieldKey }) => {
      const state = window.__MODIFF_E2E__?.getState();
      const context = state?.studio?.currentRunContext;
      const form = context?.form ?? state?.studio?.form;
      if (!form || !context) return null;
      const apiGraph = context.apiGraph ?? null;
      const runtimeHints = apiGraph?.runtimeHints ?? {};
      return {
        id: `backend-cache-${expectedTaskId}-${nodeId}`,
        clientRunId: context.clientRunId,
        runInputHash: context.runInputHash,
        workflowTabId: context.workflowTabId,
        nodeId,
        fieldKey,
        value: [url],
        url,
        mode: form.mode,
        modelType: form.modelType,
        modelLabel: form.modelType,
        repo: runtimeHints.resolvedArtifact ?? runtimeHints.resolvedModelRepo ?? runtimeHints.modelRepo ?? '',
        templateId: expectedTemplateId,
        runId: context.run?.runId ?? context.id,
        taskId: expectedTaskId,
        sid: context.run?.sid ?? null,
        prompt: form.prompt,
        negativePrompt: form.negativePrompt,
        seed: form.seed,
        width: form.width,
        height: form.height,
        steps: form.steps,
        guidanceScale: form.guidanceScale,
        referenceImages: [...(form.referenceImages ?? [])],
        formSnapshot: form,
        graphSnapshot: context.graph,
        graphBindingSnapshot: context.binding,
        apiGraphSnapshot: apiGraph,
        createdAt: Number(completedAt ?? Date.now() / 1000) * 1000,
        favorite: false,
        displayType: contentType.split('/')[0],
        backendProvenance: { runtimeFingerprint: runtimeFingerprint ?? null },
      };
    },
    {
      expectedTaskId: taskId,
      expectedTemplateId: templateId,
      nodeId: receipt.current_node,
      url: recovered.cacheUrl,
      completedAt: receipt.completed_at,
      runtimeFingerprint: receipt.runtimeFingerprint,
      contentType: recovered.contentType,
      fieldKey: recovered.fieldKey,
    },
  );
}

export async function waitForTaskTerminal(page, { taskId, server, timeoutMs = 120_000 }) {
  const started = Date.now();
  let backendUnreachableStreak = 0;
  while (Date.now() - started < timeoutMs) {
    const observation = await page.evaluate((expectedTaskId) => {
      const state = window.__MODIFF_E2E__?.getState();
      const run = (state?.tasks?.sessionRuns ?? []).find(
        (item) => item?.task_id === expectedTaskId || item?.id === expectedTaskId,
      );
      return {
        run: run ?? null,
        failure: state?.runIssues?.failure ?? null,
      };
    }, taskId);
    if (observation?.run?.status === 'completed') return observation.run;
    if (['failed', 'cancelled'].includes(observation?.run?.status)) {
      throw new Error(
        `Task ${taskId} became ${observation.run.status}: ${observation.run.error ?? observation.run.message ?? ''}`,
      );
    }
    const failureMessage = failureMessageForRun(observation?.failure, { taskId, startedAt: started });
    if (failureMessage) throw new Error(`Task ${taskId} failed while waiting for terminal state: ${failureMessage}`);
    let backendReachable = true;
    try {
      const response = await fetch(new URL('/health', server), { signal: AbortSignal.timeout(5_000) });
      backendReachable = response.ok;
    } catch {
      backendReachable = false;
    }
    if (!backendReachable) {
      backendUnreachableStreak += 1;
      if (backendUnreachableStreak >= 24) {
        throw new Error(`Backend became unreachable while waiting for task ${taskId}.`);
      }
    } else {
      backendUnreachableStreak = 0;
    }
    const receipt = await queueReceiptForTask(server, taskId);
    if (receipt?.status === 'completed') return receipt;
    throwForTerminalReceipt(receipt, taskId);
    await delay(500);
  }
  throw new Error(`Timed out waiting for task ${taskId} to become terminal after its output was captured.`);
}

export async function applyGalleryTemplate(page, templateId, formOverrides = {}, timeoutMs = 180_000) {
  try {
    await page.evaluate(
      ({ selectedTemplateId, selectedFormOverrides }) =>
        window.__MODIFF_E2E__?.applyTemplate(selectedTemplateId, selectedFormOverrides),
      { selectedTemplateId: templateId, selectedFormOverrides: formOverrides },
    );
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Graph preparation is still running/i.test(message)) throw error;
  }

  // A timeout does not cancel the owned finalizer. Keep the same page and wait
  // for that operation to settle instead of re-applying the template and
  // superseding its dynamic field requests with a new workflow context.
  await page.waitForFunction(
    () => {
      const status = window.__MODIFF_E2E__?.getState()?.studio?.graphFinalization?.status;
      return status === 'complete' || status === 'error';
    },
    null,
    { timeout: timeoutMs },
  );
  const finalization = await page.evaluate(() => window.__MODIFF_E2E__?.getState()?.studio?.graphFinalization);
  if (finalization?.status !== 'complete') {
    throw new Error(finalization?.message ?? `Template ${templateId} graph finalization failed.`);
  }
}

async function requestRuntimeCleanup(server, fetchImpl = fetch) {
  const cleanupUrl = new URL('/runtime/gpu_cleanup', server);
  const response = await fetchImpl(cleanupUrl, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Runtime cleanup failed with HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.message || 'Runtime cleanup reported an error.');
  }
  return payload;
}

export async function waitForQueueIdle(server, fetchImpl = fetch, { timeoutMs = 120_000, pollMs = 250 } = {}) {
  const startedAt = Date.now();
  const queueUrl = new URL('/queue', server);
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
      const response = await fetchImpl(queueUrl, {
        signal: AbortSignal.timeout(Math.min(10_000, remainingMs)),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else {
        const payload = await response.json();
        const queuedCount = Object.keys(payload?.queued ?? {}).length;
        if (!payload?.current && queuedCount === 0) return payload;
        lastError = payload?.current
          ? `task ${payload.current.task_id ?? 'unknown'} is still ${payload.current.status ?? 'running'}`
          : `${queuedCount} queued task(s) remain`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(pollMs);
  }
  throw new Error(
    `Backend queue did not become idle within ${timeoutMs}ms.${lastError ? ` Last observation: ${lastError}.` : ''}`,
  );
}

export async function requireAppDownloadsIdle(server, fetchImpl = fetch, { timeoutMs = 10_000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('App download-status timeout must be between 1 and 120000 milliseconds.');
  }
  const response = await fetchImpl(new URL('/hf_download/status', server), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Could not inspect app downloads: HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 1024 * 1024) {
    throw new Error('Could not inspect app downloads: response exceeds the 1 MiB bound.');
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > 1024 * 1024) {
    throw new Error('Could not inspect app downloads: response exceeds the 1 MiB bound.');
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error('Could not inspect app downloads: response is not valid JSON.');
  }
  if (
    payload?.error !== false ||
    payload?.schemaVersion !== 1 ||
    !Array.isArray(payload.downloads) ||
    payload.downloads.length > 256 ||
    !Number.isSafeInteger(payload.activeCount) ||
    payload.activeCount < 0 ||
    payload.activeCount !== payload.downloads.length ||
    !Number.isSafeInteger(payload.queuedReservationBytes) ||
    payload.queuedReservationBytes < 0 ||
    !Number.isSafeInteger(payload.templateGalleryReservationBytes) ||
    payload.templateGalleryReservationBytes < 0 ||
    payload.downloads.some(
      (download) =>
        !download ||
        typeof download !== 'object' ||
        Array.isArray(download) ||
        typeof download.repo_id !== 'string' ||
        download.repo_id.length < 3 ||
        download.repo_id.length > 256 ||
        typeof download.task_id !== 'string' ||
        download.task_id.length < 1 ||
        download.task_id.length > 128 ||
        typeof download.status !== 'string' ||
        download.status.length < 1 ||
        download.status.length > 64,
    )
  ) {
    throw new Error('Could not inspect app downloads: status payload is malformed or exceeds its bound.');
  }
  if (payload.activeCount > 0 || payload.queuedReservationBytes > 0 || payload.templateGalleryReservationBytes > 0) {
    const activeRepos = payload.downloads
      .slice(0, 3)
      .map((download) => download?.repo_id)
      .filter((repo) => typeof repo === 'string' && repo)
      .join(', ');
    throw new Error(
      `App downloads or Gallery installation are active (${payload.activeCount} task(s), ` +
        `${payload.queuedReservationBytes} model bytes and ${payload.templateGalleryReservationBytes} Gallery bytes reserved)` +
        `${activeRepos ? `: ${activeRepos}` : '.'}`,
    );
  }
  return payload;
}

export function isGalleryInfrastructureFailure(error) {
  if (isGalleryBrowserLifecycleFailure(error)) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return [
    /Failed to fetch/i,
    /fetch failed/i,
    /ECONNREFUSED/i,
    /ERR_CONNECTION_REFUSED/i,
    /backend queue did not become idle/i,
    /Could not inspect the backend queue/i,
    /Could not inspect app downloads/i,
    /App downloads.*active/i,
    /Frontend port \d+ is already occupied/i,
    /Timed out waiting for .*\/health/i,
    /websocket.*(?:connect|timeout)/i,
  ].some((pattern) => pattern.test(message));
}

export async function prepareRuntimeForTemplate(server, fetchImpl = fetch, waitOptions = undefined) {
  // A cancelled websocket receipt can arrive while the accelerator is still
  // finishing its in-flight kernel and clearing the current backend task.
  // Never release cached nodes or submit the next proof until that teardown is
  // complete.
  await waitForQueueIdle(server, fetchImpl, waitOptions);
  const payload = await requestRuntimeCleanup(server, fetchImpl);
  if (!Number.isInteger(payload?.released_node_count) || payload.released_node_count < 0) {
    throw new Error('Runtime cleanup returned an invalid released-node count.');
  }
  return payload;
}

export function shouldPrepareRuntimeForTemplate(previousTemplate, template, reuseRuntimeWithinModel = false) {
  if (!reuseRuntimeWithinModel || !previousTemplate) return true;
  // A model family is not a sufficient cache identity: dtype, quantization,
  // offload mode, artifact and revision can all change loader parameters while
  // modelType stays constant. Reuse only when the frontend supplies an explicit
  // loader-contract key proving those values are identical.
  const previousKey = String(previousTemplate.runtimeReuseKey ?? '');
  const nextKey = String(template.runtimeReuseKey ?? '');
  // An `auto-planned` key cannot itself prove that the resident recipe and
  // loader topology match. The backend now owns that live decision: every Auto
  // run compares its resolved resource candidate, artifact, dtype/offload
  // contract, and concrete graph loader topology before preserving anything.
  // Keep the runner-level cache boundary only when the catalog key changes so
  // compatible same-family runs can reuse their expensive loader, while an
  // incompatible Auto graph still tears down inside execute_graph.
  return !previousKey || previousKey !== nextKey;
}

export function argsForTemplateInputs(args, template) {
  const inputs = args.templateInputMap?.[template.id];
  const selected = inputs ? { ...args, ...inputs } : args;
  if (!existsSync(DEFAULT_INPUT_BINDINGS_PATH)) return selected;
  const bindings = JSON.parse(readFileSync(DEFAULT_INPUT_BINDINGS_PATH, 'utf8'))?.[template.id];
  if (!Array.isArray(bindings) || bindings.length === 0) return selected;
  let resolved = selected;
  for (const binding of bindings) {
    const field = String(binding?.field ?? '');
    const assets = (binding?.defaultAssets ?? [])
      .map((asset) => String(asset?.runtimePath ?? '').trim())
      .filter(Boolean)
      .map((runtimePath) => {
        if (!DEFAULT_INPUT_RUNTIME_PATH.test(runtimePath)) {
          throw new Error(`Template ${template.id} has an invalid default runtime input path.`);
        }
        const relativePath = runtimePath.replace(/^\/+/, '');
        // Qualify the chosen app installation's inputs. A developer may also
        // have an offline Gallery in this checkout; it must not shadow the
        // backend being tested. The public copy remains an offline fallback.
        const candidates = [
          resolve(args.backendDir || DEFAULT_BACKEND_DIR, 'web', relativePath),
          resolve(ROOT, 'public', relativePath),
        ];
        return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
      });
    if (assets.length === 0) continue;
    if (field === 'referenceImages' && (resolved.referenceImages?.length ?? 0) === 0) {
      resolved = { ...resolved, referenceImages: assets };
    } else if (
      [
        'maskImage',
        'controlImage',
        'sourceVideo',
        'maskVideo',
        'controlVideo',
        'sourceAudio',
        'referenceAudio',
      ].includes(field) &&
      !resolved[field]
    ) {
      resolved = { ...resolved, [field]: assets[0] };
    }
  }
  return resolved;
}

export async function clearRuntimeBetweenRuns(server, fetchImpl = fetch) {
  const payload = await requestRuntimeCleanup(server, fetchImpl);
  if (!Number.isInteger(payload?.released_node_count) || payload.released_node_count < 1) {
    throw new Error('Runtime cleanup did not prove that any cached node objects were released.');
  }
  return payload;
}

export function executionReceiptsForRun(template, output, websocketEvents) {
  const requiredActionGroups = template.workflowBlocks?.includes('quality_video_sequence')
    ? [
        [['modules.DiffusersVideo', 'GenerateShotJob']],
        [['modules.Video', 'ExportAsset']],
        [['modules.Video', 'ConcatenateAssets']],
      ]
    : template.workflowBlocks?.includes('lyric_video')
      ? [
          [['modules.DiffusersAudio', 'Generate']],
          [['modules.DiffusersVideo', 'GenerateSequence']],
          [['modules.Video', 'ExportWithAudio']],
        ]
      : ['WanVACEPipeline', 'WanVideoPipeline', 'LTXVideoPipeline'].includes(template.modelType)
        ? [
            [
              ['modules.DiffusersVideo', 'Generate'],
              ['modules.DiffusersVideo', 'GenerateSequence'],
              ['modules.DiffusersVideo', 'Generate'],
            ],
            [['modules.Video', 'Export']],
          ]
        : template.modelType === 'AceStepAudioPipeline'
          ? [[['modules.DiffusersAudio', 'Generate']], [['modules.Audio', 'Export']]]
          : [];
  if (requiredActionGroups.length === 0) return [];
  const graphNodes = Array.isArray(output?.apiGraphSnapshot?.nodes)
    ? output.apiGraphSnapshot.nodes
    : Object.entries(output?.apiGraphSnapshot?.nodes ?? {}).map(([id, node]) => ({ id, ...node }));
  return requiredActionGroups.map((alternatives) => {
    const matchedAction = alternatives.find(([moduleName, actionName]) =>
      graphNodes.some((item) => item?.module === moduleName && item?.action === actionName),
    );
    if (!matchedAction) {
      throw new Error(
        `Executed graph is missing an accepted action: ${alternatives
          .map(([moduleName, actionName]) => `${moduleName}.${actionName}`)
          .join(' or ')}.`,
      );
    }
    const [moduleName, actionName] = matchedAction;
    const node = graphNodes.find((item) => item?.module === moduleName && item?.action === actionName);
    const receipts = websocketEvents.filter(
      (event) => event?.type === 'executed' && event?.task_id === output?.taskId && event?.node === node.id,
    );
    if (receipts.length === 0) throw new Error(`No execution receipt was captured for ${moduleName}.${actionName}.`);
    // A branched graph can visit the same upstream node twice in one task: the
    // first visit executes it and a later branch reuses that result. That is
    // valid within-run graph reuse, not a vacuous gallery proof. Require at
    // least one genuinely changed execution for this task and retain it.
    const receipt = receipts.find((event) => event.status !== 'cached' && event.hasChanged !== false);
    if (!receipt) {
      throw new Error(`${moduleName}.${actionName} returned cached output; this is not an independent duplicate run.`);
    }
    return { module: moduleName, action: actionName, nodeId: node.id, receipt };
  });
}

function dataUrlToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?,(.+)$/);
  if (!match) throw new Error('Invalid data URL output.');
  const [, contentType = 'application/octet-stream', body] = match;
  return {
    buffer: Buffer.from(body, dataUrl.includes(';base64,') ? 'base64' : 'utf8'),
    contentType,
  };
}

async function fetchOutput(output, frontendUrl) {
  if (typeof output.url !== 'string' || !output.url) {
    throw new Error('Output did not include a fetchable URL.');
  }
  if (output.url.startsWith('data:')) {
    return dataUrlToBuffer(output.url);
  }

  const absoluteUrl = new URL(output.url, frontendUrl).toString();
  const response = await fetch(absoluteUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch output ${absoluteUrl}: HTTP ${response.status}`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? '',
  };
}

function extensionForOutput(output, contentType) {
  const fromMime = GENERATED_EXTENSION_BY_MIME[contentType];
  if (fromMime) return fromMime;
  if (typeof output.url === 'string') {
    const parsedExtension = extname(output.url.split('?')[0] ?? '').toLowerCase();
    if (parsedExtension) return parsedExtension;
  }
  return GENERATED_EXTENSION_BY_TYPE[output.displayType] ?? GENERATED_EXTENSION_BY_TYPE[output.mediaType] ?? '.bin';
}

async function waitForOutput(
  page,
  { templateId, taskId, startedAt, server, websocketEvents = [], timeoutMs, preferredStudioRole = '' },
) {
  let lastActivityAt = Date.now();
  let lastReceiptProgress = '';
  const replayedUpdates = new Set();
  while (Date.now() - lastActivityAt < timeoutMs) {
    const capturedUpdate = [...websocketEvents]
      .reverse()
      .find(
        (event) =>
          event?.type === 'update_value' &&
          event?.task_id === taskId &&
          event?.node &&
          event?.key &&
          Array.isArray(event?.value) &&
          event.value.length > 0 &&
          !replayedUpdates.has(event),
      );
    if (capturedUpdate) {
      replayedUpdates.add(capturedUpdate);
      await page.evaluate((event) => window.__MODIFF_E2E__?.sendWebsocketMessage(event), capturedUpdate);
    }
    const observation = await page.evaluate(
      ({ expectedTemplateId, expectedTaskId, expectedStartedAt, expectedStudioRole }) => {
        const state = window.__MODIFF_E2E__?.getState();
        if (!state || typeof state !== 'object') return null;
        const outputs = state.studio?.outputs ?? [];
        const matching = outputs.filter(
          (item) =>
            item.templateId === expectedTemplateId &&
            (!expectedTaskId || item.taskId === expectedTaskId) &&
            Number(item.createdAt ?? 0) >= expectedStartedAt,
        );
        const roleForOutput = (item) =>
          item.graphSnapshot?.nodes?.find((node) => node?.id === item.nodeId)?.data?.studioRole ?? '';
        return {
          output: expectedStudioRole
            ? (matching.find((item) => roleForOutput(item) === expectedStudioRole) ?? null)
            : (matching.at(-1) ?? null),
          failure: state.runIssues?.failure ?? null,
        };
      },
      {
        expectedTemplateId: templateId,
        expectedTaskId: taskId,
        expectedStartedAt: startedAt,
        expectedStudioRole: preferredStudioRole,
      },
    );
    if (observation?.output) return observation.output;
    const failureMessage = failureMessageForRun(observation?.failure, { taskId, startedAt });
    if (failureMessage) throw new Error(`Task ${taskId ?? 'unknown'} failed: ${failureMessage}`);
    const receipt = await queueReceiptForTask(server, taskId);
    const receiptProgress = taskProgressFingerprint(receipt);
    if (receiptProgress && receiptProgress !== lastReceiptProgress) {
      lastReceiptProgress = receiptProgress;
      lastActivityAt = Date.now();
    }
    throwForTerminalReceipt(receipt, taskId ?? 'unknown');
    if (receipt?.status === 'completed') {
      const recovered = await recoverOutputFromBackendCache(page, { receipt, server, taskId, templateId });
      if (recovered) return recovered;
    }
    await delay(1000);
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms without backend progress while waiting for output from ${templateId} (${taskId ?? 'no task id'}).`,
  );
}

export function taskProgressFingerprint(receipt) {
  if (!receipt || typeof receipt !== 'object') return '';
  return JSON.stringify([
    receipt.status ?? null,
    receipt.updated_at ?? receipt.updatedAt ?? null,
    receipt.current_node ?? receipt.currentNode ?? null,
    receipt.current_node_name ?? receipt.currentNodeName ?? null,
    receipt.progress ?? null,
    receipt.node_progress ?? receipt.nodeProgress ?? null,
    receipt.phase ?? null,
    receipt.message ?? null,
    receipt.current_step ?? receipt.currentStep ?? null,
    receipt.total_steps ?? receipt.totalSteps ?? null,
  ]);
}

async function findRunOutputByStudioRole(page, { templateId, taskId, startedAt, studioRole }) {
  return page.evaluate(
    ({ expectedTemplateId, expectedTaskId, expectedStartedAt, expectedStudioRole }) => {
      const outputs = window.__MODIFF_E2E__?.getState()?.studio?.outputs ?? [];
      return (
        outputs.find((item) => {
          if (
            item.templateId !== expectedTemplateId ||
            item.taskId !== expectedTaskId ||
            Number(item.createdAt ?? 0) < expectedStartedAt
          ) {
            return false;
          }
          const node = item.graphSnapshot?.nodes?.find((entry) => entry?.id === item.nodeId);
          return node?.data?.studioRole === expectedStudioRole;
        }) ?? null
      );
    },
    {
      expectedTemplateId: templateId,
      expectedTaskId: taskId,
      expectedStartedAt: startedAt,
      expectedStudioRole: studioRole,
    },
  );
}

export function formOverridesForTemplate(template, args) {
  if (template.exampleStatus === 'blocked' && !args.allowBlockedProbe) {
    return { skipReason: `Template is ${template.exampleStatus}.` };
  }
  if (template.exampleStatus === 'non_exact' && !args.allowNonExact) {
    return {
      skipReason: 'Template is non_exact; rerun with --allow-non-exact after pinning every missing model and input.',
    };
  }

  const overrides = {};
  if (args.promptOverride) overrides.prompt = args.promptOverride;
  if (args.negativePromptOverride) overrides.negativePrompt = args.negativePromptOverride;
  if (args['confirmed-community-artifact']) {
    overrides.confirmedCommunityArtifact = String(args['confirmed-community-artifact']);
  }
  if (args['resource-mode']) overrides.resourceMode = String(args['resource-mode']);
  if (args['quantization-mode']) overrides.quantizationMode = String(args['quantization-mode']);
  if (args['offload-mode']) {
    overrides.offloadMode = String(args['offload-mode']);
    overrides.autoOffload = String(args['offload-mode']) !== 'none';
  }
  for (const numericField of ['steps', 'width', 'height']) {
    const value = Number(args[numericField]);
    if (Number.isFinite(value) && value > 0) overrides[numericField] = value;
  }
  const numFrames = Number(args['num-frames']);
  if (Number.isInteger(numFrames) && numFrames > 0) overrides.numFrames = numFrames;
  const seed = Number(args.seed);
  if (Number.isInteger(seed) && seed >= 0) overrides.seed = seed;
  if (
    [
      'edit_image',
      'multi_image_reference_edit',
      'layer_decomposition',
      'image_to_video',
      'reference_to_video',
    ].includes(template.mode)
  ) {
    if (args.referenceImages.length === 0) {
      return { skipReason: 'Template requires --reference-image.' };
    }
    overrides.referenceImages = args.referenceImages;
  }
  if (template.mode === 'control_image') {
    if (!args.controlImage && args.referenceImages.length === 0) {
      return { skipReason: 'Template requires --control-image or --reference-image.' };
    }
    overrides.controlImage = args.controlImage || args.referenceImages[0];
  }
  if (template.mode === 'outpaint' && template.modelType === 'QwenImageEditModularPipeline') {
    if (args.referenceImages.length === 0) {
      return { skipReason: 'Template requires --reference-image.' };
    }
    overrides.referenceImages = args.referenceImages;
  } else if (template.mode === 'inpaint' || template.mode === 'outpaint') {
    if (args.referenceImages.length === 0 || !args.maskImage) {
      return { skipReason: 'Template requires --reference-image and --mask-image.' };
    }
    overrides.referenceImages = args.referenceImages;
    overrides.maskImage = args.maskImage;
  }
  if (['video_to_video', 'video_color_edit', 'video_inpaint', 'video_outpaint'].includes(template.mode)) {
    if (!args.sourceVideo) {
      return { skipReason: 'Template requires --source-video.' };
    }
    overrides.sourceVideo = args.sourceVideo;
  }
  if (['video_inpaint', 'video_outpaint'].includes(template.mode)) {
    if (!args.maskVideo) {
      return { skipReason: 'Template requires --mask-video.' };
    }
    overrides.maskVideo = args.maskVideo;
  }
  if (template.modelType === 'WanVACEPipeline' && args.referenceImages.length > 0) {
    overrides.referenceImages = args.referenceImages;
  }
  if (template.mode === 'control_to_video') {
    if (!args.controlVideo) {
      return { skipReason: 'Template requires --control-video.' };
    }
    overrides.controlVideo = args.controlVideo;
  }
  if (['audio_variation', 'audio_continuation', 'audio_repaint'].includes(template.mode)) {
    if (!args.sourceAudio) {
      return { skipReason: 'Template requires --source-audio.' };
    }
    overrides.sourceAudio = args.sourceAudio;
  }
  if (args.referenceAudio) overrides.referenceAudio = args.referenceAudio;
  return { overrides };
}

export function expectedOutputContractForCapture(runtimeTemplate, args) {
  // Source-only captures deliberately change dimensions/frame counts to make
  // reviewed dependency media. They must still decode cleanly, but they are
  // not evidence that the parent public template met its locked release size.
  return args.sourceOnly ? {} : (runtimeTemplate.example?.expectedOutput ?? {});
}

export function preferredOutputRoleForTemplate(template) {
  if (template.workflowBlocks?.includes('lyric_video') || template.workflowBlocks?.includes('soundtrack')) {
    return 'exportWithAudio';
  }
  if (template.mediaType === 'video') return 'videoExport';
  if (template.workflowBlocks?.includes('upscaler')) return 'upscalePreview';
  if (template.modelType === 'AceStepAudioPipeline') return 'audioExport';
  return '';
}

function stableInputPath(filePath) {
  const relativePath = relative(ROOT, filePath);
  if (relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath)) {
    return relativePath.replaceAll('\\', '/');
  }
  return filePath.replaceAll('\\', '/');
}

function localInputArtifact(role, filePath) {
  if (!filePath || /^(?:https?:|data:)/i.test(filePath)) {
    throw new Error(`Gallery proof input ${role} must be a pinned local file.`);
  }
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`Gallery proof input ${role} does not exist: ${resolvedPath}`);
  }
  const buffer = readFileSync(resolvedPath);
  return {
    role,
    path: stableInputPath(resolvedPath),
    contentHash: `sha256:bytes:${createHash('sha256').update(buffer).digest('hex')}`,
    byteSize: buffer.byteLength,
  };
}

export function inputArtifactsForOverrides(overrides = {}) {
  const artifacts = [];
  for (const [index, filePath] of (overrides.referenceImages ?? []).entries()) {
    artifacts.push(localInputArtifact(`reference_image_${index + 1}`, filePath));
  }
  for (const [key, role] of [
    ['maskImage', 'mask_image'],
    ['controlImage', 'control_image'],
    ['sourceVideo', 'source_video'],
    ['maskVideo', 'mask_video'],
    ['controlVideo', 'control_video'],
    ['sourceAudio', 'source_audio'],
    ['referenceAudio', 'reference_audio'],
  ]) {
    if (overrides[key]) artifacts.push(localInputArtifact(role, overrides[key]));
  }
  return artifacts;
}

export function executionReceiptForProvenance(completionEvent, terminalTask) {
  const recoveredReceipt = completionEvent?.terminalReceipt;
  return {
    ...(terminalTask && typeof terminalTask === 'object' ? terminalTask : {}),
    ...(recoveredReceipt && typeof recoveredReceipt === 'object' ? recoveredReceipt : {}),
    ...(completionEvent && typeof completionEvent === 'object' ? completionEvent : {}),
    runtimeMeasurement:
      completionEvent?.runtimeMeasurement ??
      recoveredReceipt?.runtimeMeasurement ??
      terminalTask?.runtimeMeasurement ??
      null,
    runtimeHints: completionEvent?.runtimeHints ?? recoveredReceipt?.runtimeHints ?? terminalTask?.runtimeHints ?? null,
  };
}

export function runtimeFingerprintForProvenance({ deterministicEvent, completionEvent, terminalTask, output }) {
  const deterministicMode = deterministicEvent?.deterministicMode ?? output?.apiGraphSnapshot?.deterministicMode;
  return selectBackendRuntimeFingerprintEvidence(
    [
      // graph_completed is the terminal execution receipt and carries the
      // complete packages/torch/directories payload. A compact /queue task
      // normally carries only the corresponding scalar fingerprint.
      completionEvent?.runtimeFingerprint,
      deterministicEvent?.runtimeFingerprint,
      output?.backendProvenance?.runtimeFingerprint,
      terminalTask?.runtimeFingerprint,
      output?.provenance?.runtimeFingerprint,
    ],
    deterministicMode,
  );
}

function comparisonBeforeMediaForTemplate(template, args) {
  if (!['compareSlider', 'hoverDissolve', 'contactSheet'].includes(template.thumbnailVariant)) return '';
  return args.sourceVideo || args.referenceImages[0] || args.controlImage || args.controlVideo || '';
}

async function runTemplate(page, template, args, mediaDir, websocketEvents, templateRuntime, backendSource) {
  const { overrides, skipReason } = formOverridesForTemplate(template, args);
  if (skipReason) {
    return { templateId: template.id, skipped: true, reason: skipReason };
  }

  const outputs = [];
  const provenances = [];
  let resumedPreparedGraph = null;
  const inputArtifacts = inputArtifactsForOverrides(overrides);
  let generatedComparisonBeforeMedia = '';
  const runtimeTemplate = templateRuntime.templates.find((item) => item.id === template.id);
  if (!runtimeTemplate) throw new Error(`Template runtime is missing ${template.id}.`);
  if (args.startRun > 1) {
    const outputBase = args.sourceOnly && args.outputName ? args.outputName : safeFileName(template.id);
    const evidenceDir = join(mediaDir, 'evidence');
    for (let runIndex = 1; runIndex < args.startRun; runIndex += 1) {
      const evidenceBase = `${safeFileName(template.id)}.run${runIndex}`;
      const outputEvidencePath = join(evidenceDir, `${evidenceBase}.output.json`);
      const nodesEvidencePath = join(evidenceDir, `${evidenceBase}.nodes.json`);
      const modelEvidencePath = join(evidenceDir, `${evidenceBase}.model-fingerprint.json`);
      const websocketEvidencePath = join(evidenceDir, `${evidenceBase}.websocket-events.json`);
      const provenancePath = join(evidenceDir, `${evidenceBase}.provenance.json`);
      const fileName = readdirSync(mediaDir).find(
        (name) => name.startsWith(`${outputBase}.run${runIndex}.`) && !name.includes('.before.'),
      );
      const required = [
        fileName && join(mediaDir, fileName),
        outputEvidencePath,
        nodesEvidencePath,
        modelEvidencePath,
        websocketEvidencePath,
        provenancePath,
      ];
      if (required.some((path) => !path || !existsSync(path))) {
        throw new Error(
          `Cannot resume ${template.id} at run ${args.startRun}: retained run ${runIndex} proof is incomplete.`,
        );
      }
      const outputEvidence = JSON.parse(readFileSync(outputEvidencePath, 'utf8'));
      const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
      resumedPreparedGraph = outputEvidence.output?.apiGraphSnapshot ?? resumedPreparedGraph;
      provenances.push(provenance);
      outputs.push({
        runIndex,
        taskId: outputEvidence.run?.taskId ?? outputEvidence.terminalTask?.task_id ?? provenance.taskId,
        outputId: outputEvidence.output?.id ?? `resumed-${template.id}-${runIndex}`,
        filePath: join(mediaDir, fileName),
        contentType: `image/${extname(fileName).slice(1).replace('jpg', 'jpeg')}`,
        runtimeFingerprint: provenance.runtimeFingerprint,
        modelRevision: provenance.modelRevision,
        modelSetHash: provenance.models?.hash ?? null,
        mediaHash: provenance.mediaHash,
        terminalTask: outputEvidence.terminalTask,
        resumed: true,
        evidence: {
          output: outputEvidencePath,
          nodes: nodesEvidencePath,
          modelFingerprint: modelEvidencePath,
          websocketEvents: websocketEvidencePath,
          provenance: provenancePath,
        },
      });
    }
  }
  // Prepare the template once for this capture session. Re-applying it between
  // deterministic duplicates discards the valid Auto plan and can trigger a
  // minute-scale full model-store rescan even though only runtime tensors were
  // cleared. The graph and locked form remain unchanged across runtime cleanup.
  await applyGalleryTemplate(page, template.id, overrides ?? {}, Math.max(180_000, args.timeoutMs));
  if (process.env.MODIFF_GALLERY_DEBUG_STATE === '1') {
    const debugState = await page.evaluate(() => {
      const state = window.__MODIFF_E2E__?.getState();
      return {
        form: state?.studio?.form,
        lastError: state?.studio?.lastError,
        failure: state?.runIssues?.failure,
        websocket: state?.websocket,
        tasks: state?.tasks?.sessionRuns,
        graph: window.__MODIFF_E2E__?.inspectCurrentGraph(),
      };
    });
    console.error(JSON.stringify({ galleryDebugState: debugState }, null, 2));
  }
  for (let runIndex = args.startRun; runIndex <= args.runs; runIndex += 1) {
    try {
      const run =
        runIndex === args.startRun && resumedPreparedGraph
          ? await page.evaluate(
              (preparedGraph) => window.__MODIFF_E2E__?.runPreparedTemplateGraph(preparedGraph),
              resumedPreparedGraph,
            )
          : await page.evaluate(() => window.__MODIFF_E2E__?.runActiveTemplate());
      if (!run || run.response?.error) {
        throw new Error(run?.response?.message || `Could not queue ${template.id} run ${runIndex}.`);
      }

      const output = await waitForOutput(page, {
        templateId: template.id,
        taskId: run.taskId,
        startedAt: run.startedAt,
        server: args.server,
        websocketEvents,
        timeoutMs: args.timeoutMs,
        preferredStudioRole: preferredOutputRoleForTemplate(template),
      });
      // Media cache notifications can precede completion of a downstream
      // delivery node (notably frame-by-frame video upscaling). Bind the proof
      // to the terminal backend receipt before fetching or hashing any file so
      // a stale/intermediate cache URL cannot be published as the run result.
      const terminalTask = await waitForTaskTerminal(page, {
        taskId: run.taskId,
        server: args.server,
        timeoutMs: args.timeoutMs,
      });
      const fetched = await fetchOutput(output, args.frontendUrl);
      const extension = extensionForOutput(output, fetched.contentType);
      const outputBase = args.sourceOnly && args.outputName ? args.outputName : safeFileName(template.id);
      const fileName = `${outputBase}.run${runIndex}${extension}`;
      const filePath = join(mediaDir, fileName);
      writeFileSync(filePath, fetched.buffer);
      const fetchedOutputs = [{ filePath, fetched, output }];
      const fetchedUrls = new Set([output.url]);
      for (const [itemIndex, mediaItem] of (output.mediaItems ?? []).entries()) {
        if (!mediaItem?.url || fetchedUrls.has(mediaItem.url)) continue;
        fetchedUrls.add(mediaItem.url);
        const itemOutput = {
          ...output,
          ...mediaItem,
          url: mediaItem.url,
          displayType: mediaItem.displayType ?? output.displayType,
        };
        const itemFetched = await fetchOutput(itemOutput, args.frontendUrl);
        if (fetchedOutputs.some(({ fetched: capturedOutput }) => capturedOutput.buffer.equals(itemFetched.buffer))) {
          continue;
        }
        const itemExtension = extensionForOutput(itemOutput, itemFetched.contentType);
        const itemFilePath = join(mediaDir, `${outputBase}.run${runIndex}.item${itemIndex + 1}${itemExtension}`);
        writeFileSync(itemFilePath, itemFetched.buffer);
        fetchedOutputs.push({ filePath: itemFilePath, fetched: itemFetched, output: itemOutput });
      }
      const runInputArtifacts = [...inputArtifacts];
      if (template.mediaType !== 'video' && template.workflowBlocks?.includes('upscaler')) {
        const baseOutput = await findRunOutputByStudioRole(page, {
          templateId: template.id,
          taskId: run.taskId,
          startedAt: run.startedAt,
          studioRole: 'preview',
        });
        const fallbackBaseOutput =
          baseOutput ??
          (await page.evaluate(
            ({ expectedTemplateId, expectedTaskId, expectedStartedAt, excludedNodeId }) => {
              const outputs = window.__MODIFF_E2E__?.getState()?.studio?.outputs ?? [];
              return (
                outputs.find(
                  (item) =>
                    item.templateId === expectedTemplateId &&
                    item.taskId === expectedTaskId &&
                    item.nodeId !== excludedNodeId &&
                    Number(item.createdAt ?? 0) >= expectedStartedAt,
                ) ?? null
              );
            },
            {
              expectedTemplateId: template.id,
              expectedTaskId: run.taskId,
              expectedStartedAt: run.startedAt,
              excludedNodeId: output.nodeId,
            },
          ));
        if (!fallbackBaseOutput) {
          throw new Error('Upscale proof did not expose the base Preview output required for Before/After review.');
        }
        const baseFetched = await fetchOutput(fallbackBaseOutput, args.frontendUrl);
        const baseExtension = extensionForOutput(fallbackBaseOutput, baseFetched.contentType);
        const baseFilePath = join(mediaDir, `${safeFileName(template.id)}.before.run${runIndex}${baseExtension}`);
        writeFileSync(baseFilePath, baseFetched.buffer);
        const baseContentHash = `sha256:bytes:${createHash('sha256').update(baseFetched.buffer).digest('hex')}`;
        runInputArtifacts.push({
          role: 'generated_before_upscale',
          path: `generated:${template.id}/base-preview`,
          contentHash: baseContentHash,
          byteSize: baseFetched.buffer.byteLength,
        });
        generatedComparisonBeforeMedia = baseFilePath;
      }
      const taskEvents = websocketEvents.filter((event) => event?.task_id === run.taskId);
      const backendCompletionProven = terminalTask?.status === 'completed' && Number(terminalTask?.progress) === 100;
      if (backendCompletionProven && !taskEvents.some((event) => event?.type === 'graph_completed')) {
        taskEvents.push({
          type: 'graph_completed',
          task_id: run.taskId,
          recovered: true,
          source: 'backend_queue_recent',
          terminalReceipt: terminalTask,
        });
      }
      if (backendCompletionProven && !taskEvents.some((event) => event?.type === 'task_completed')) {
        taskEvents.push({
          type: 'task_completed',
          task_id: run.taskId,
          recovered: true,
          source: 'backend_queue_recent',
          terminalReceipt: terminalTask,
        });
      }
      const evidenceDir = join(mediaDir, 'evidence');
      mkdirSync(evidenceDir, { recursive: true });
      const evidenceBase = `${safeFileName(template.id)}.run${runIndex}`;
      const outputEvidencePath = join(evidenceDir, `${evidenceBase}.output.json`);
      const nodesEvidencePath = join(evidenceDir, `${evidenceBase}.nodes.json`);
      const modelEvidencePath = join(evidenceDir, `${evidenceBase}.model-fingerprint.json`);
      const websocketEvidencePath = join(evidenceDir, `${evidenceBase}.websocket-events.json`);
      // Persist the expensive app run before applying receipt/provenance gates.
      // If a harness contract changes, the output, executed graph, terminal task,
      // and raw websocket receipts remain available for audit and repair.
      writeFileSync(
        outputEvidencePath,
        `${JSON.stringify({ runIndex, run, terminalTask, output }, null, 2)}\n`,
        'utf8',
      );
      writeFileSync(
        websocketEvidencePath,
        `${JSON.stringify({ taskId: run.taskId, executionReceipts: [], events: taskEvents }, null, 2)}\n`,
        'utf8',
      );
      const executionReceipts = executionReceiptsForRun(template, output, taskEvents);
      if (!taskEvents.some((event) => event?.type === 'graph_completed')) {
        throw new Error(`No graph_completed receipt was captured for task ${run.taskId}.`);
      }
      if (!taskEvents.some((event) => event?.type === 'task_completed')) {
        throw new Error(`No task_completed receipt was captured for task ${run.taskId}.`);
      }
      const resolvedModelRepos = resolvedModelReposFromOutput(output);
      if (resolvedModelRepos.length === 0) {
        throw new Error('The executed graph did not identify its resolved model repository.');
      }
      const [nodesResponse, modelResponses] = await Promise.all([
        fetch(new URL('/nodes', args.server)),
        Promise.all(
          resolvedModelRepos.map((repo) =>
            fetch(
              new URL(
                `/model_fingerprints?modelType=${encodeURIComponent(template.modelType)}&repo=${encodeURIComponent(repo)}`,
                args.server,
              ),
            ),
          ),
        ),
      ]);
      const failedModelResponse = modelResponses.find((response) => !response.ok);
      if (!nodesResponse.ok || failedModelResponse) {
        throw new Error(
          `Could not retain run evidence (nodes HTTP ${nodesResponse.status}, model HTTP ${failedModelResponse?.status ?? 200}).`,
        );
      }
      const [nodesPayload, modelPayloads, decodedOutputs] = await Promise.all([
        nodesResponse.json(),
        Promise.all(modelResponses.map((response) => response.json())),
        Promise.all(
          fetchedOutputs.map(({ filePath: capturedPath }) =>
            decodedMediaHash(capturedPath, template.mediaType, { ffmpeg: args.ffmpeg }),
          ),
        ),
      ]);
      const modelPayload = {
        error: false,
        count: modelPayloads.reduce((count, payload) => count + Number(payload?.count ?? 0), 0),
        models: modelPayloads.flatMap((payload) => payload?.models ?? []),
        runtimeFingerprint: modelPayloads.find((payload) => payload?.runtimeFingerprint)?.runtimeFingerprint ?? null,
        source: 'modiff-backend-executed-repos',
      };
      const modelIdentities = resolvedModelRepos.map((repo) => {
        const identity = selectInstalledModelIdentity(modelPayload, repo);
        if (!identity) throw new Error(`The backend did not resolve an installed commit for ${repo}.`);
        return identity;
      });
      const modelSet = modelSetIdentity(modelIdentities);
      const deterministicEvent = [...taskEvents]
        .reverse()
        .find((event) => event?.type === 'deterministic_execution' && event?.task_id === run.taskId);
      const completionEvent = [...taskEvents]
        .reverse()
        .find((event) => event?.type === 'graph_completed' && event?.task_id === run.taskId);
      const analyses = fetchedOutputs.map(({ filePath: capturedPath, fetched: capturedOutput }, outputIndex) => {
        const decoded = decodedOutputs[outputIndex];
        const errors = technicalMediaErrors(
          decoded,
          expectedOutputContractForCapture(runtimeTemplate, args),
          template.mediaType,
        );
        return {
          ...decoded,
          mediaType: template.mediaType,
          byteSize: capturedOutput.buffer.byteLength,
          encodedSha256: `sha256:${createHash('sha256').update(capturedOutput.buffer).digest('hex')}`,
          decodedSha256: decoded.hash,
          collectionIndex: outputIndex,
          capturedFileName: relative(mediaDir, capturedPath),
          ok: errors.length === 0,
          errors,
        };
      });
      const outputAnalysis = {
        ok: analyses.every((analysis) => analysis.ok),
        outputCount: fetchedOutputs.length,
        analyses,
      };
      const provenancePath = join(evidenceDir, `${evidenceBase}.provenance.json`);
      const incompleteProvenancePath = join(evidenceDir, `${evidenceBase}.provenance.incomplete.json`);
      const backendSourceAfterPath = join(evidenceDir, `${evidenceBase}.backend-source-after.json`);
      // Retain backend receipts before deriving the stricter publication
      // provenance. If provenance validation uncovers a harness defect, the
      // successful and expensive model run must remain auditable/resumable.
      writeFileSync(
        outputEvidencePath,
        `${JSON.stringify({ runIndex, run, terminalTask, output }, null, 2)}\n`,
        'utf8',
      );
      writeFileSync(nodesEvidencePath, `${JSON.stringify(nodesPayload, null, 2)}\n`, 'utf8');
      writeFileSync(modelEvidencePath, `${JSON.stringify(modelPayload, null, 2)}\n`, 'utf8');
      writeFileSync(
        websocketEvidencePath,
        `${JSON.stringify({ taskId: run.taskId, executionReceipts, events: taskEvents }, null, 2)}\n`,
        'utf8',
      );
      // Source-only captures intentionally replace the catalog prompt to create
      // reviewed dependency media. Their proof must describe the executed form,
      // not impersonate the parent template's default prompt/settings lock.
      const executedLockedSettings =
        args.sourceOnly && output.formSnapshot
          ? output.formSnapshot
          : templateRuntime.lockedSettingsForTemplate(runtimeTemplate);
      const executedPromptSettingsHash =
        args.sourceOnly && output.promptSettingsHash
          ? output.promptSettingsHash
          : templateRuntime.promptSettingsHash(runtimeTemplate);
      const catalogTemplateLockHash =
        args.sourceOnly && output.templateLockHash
          ? output.templateLockHash
          : templateRuntime.templateLockHash(runtimeTemplate);
      const resolvedTemplateLockHash = args.sourceOnly
        ? catalogTemplateLockHash
        : templateRuntime.templateLockHash(runtimeTemplate, modelSet.revisionLock);
      const selectedRuntimeFingerprint = runtimeFingerprintForProvenance({
        deterministicEvent,
        completionEvent,
        terminalTask,
        output,
      });
      let backendSourceAfter = null;
      let backendSourceAfterError = null;
      try {
        backendSourceAfter = backendSourceIdentity(args.backendDir);
      } catch (error) {
        backendSourceAfterError = error instanceof Error ? error.message : String(error);
      }
      const sourceEvidence = backendSourceEvidence({
        before: backendSource,
        after: backendSourceAfter,
        runtimeFingerprint: selectedRuntimeFingerprint,
      });
      writeFileSync(
        backendSourceAfterPath,
        `${JSON.stringify(
          {
            capturedAt: new Date().toISOString(),
            identity: backendSourceAfter,
            workerAttestation: sourceEvidence.attestation,
            error: backendSourceAfterError,
            blockers: sourceEvidence.blockers,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      const provenance = createRunProvenance({
        templateId: template.id,
        lockedSettings: executedLockedSettings,
        promptSettingsHash: executedPromptSettingsHash,
        catalogTemplateLockHash,
        resolvedTemplateLockHash,
        apiGraph: output.apiGraphSnapshot,
        nodesPayload,
        modelIdentity: modelIdentities[0],
        modelIdentities,
        inputArtifacts: runInputArtifacts,
        runtimeFingerprint: selectedRuntimeFingerprint,
        deterministicMode: deterministicEvent?.deterministicMode ?? output.apiGraphSnapshot?.deterministicMode,
        backendSource: sourceEvidence.identity,
        outputAnalysis,
        executedOutput: output,
        executionReceipt: executionReceiptForProvenance(completionEvent, terminalTask),
        taskId: run.taskId,
        expectedOutput: expectedOutputContractForCapture(runtimeTemplate, args),
      });
      if (backendSourceAfterError) {
        provenance.blockers.push(`backend source capture failed after execution: ${backendSourceAfterError}`);
      }
      provenance.blockers.push(...sourceEvidence.blockers);
      if (provenance.blockers.length > 0) {
        writeFileSync(incompleteProvenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
        throw new Error(`Run provenance is incomplete: ${provenance.blockers.join(' ')}`);
      }
      provenances.push(provenance);
      writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
      let collectionFilePaths = fetchedOutputs.map(({ filePath: capturedPath }) => capturedPath);
      let derivativeProvenancePath = null;
      if (template.id === 'qwen_layered_portrait') {
        const expectedLayerCount = Number(output.formSnapshot?.layers ?? 3);
        if (fetchedOutputs.length !== expectedLayerCount) {
          throw new Error(
            `Qwen Layered review sheet requires ${expectedLayerCount} captured layers, got ${fetchedOutputs.length}.`,
          );
        }
        const sourcePath = args.referenceImages[0];
        if (!sourcePath) throw new Error('Qwen Layered review sheet requires its pinned source image.');
        const firstLayerPath = join(mediaDir, `${outputBase}.run${runIndex}.item1${extension}`);
        copyFileSync(filePath, firstLayerPath);
        collectionFilePaths = [firstLayerPath, ...fetchedOutputs.slice(1).map((item) => item.filePath)];
        derivativeProvenancePath = join(evidenceDir, `${evidenceBase}.derivative.json`);
        const recomposedPath = join(mediaDir, `${outputBase}.run${runIndex}.recomposed.png`);
        const derivative = spawnSync(
          bundledPythonPath(args.backendDir),
          [
            join(ROOT, 'scripts', 'template-gallery-layer-sheet.py'),
            '--source',
            sourcePath,
            '--layers',
            ...collectionFilePaths,
            '--output',
            filePath,
            '--recomposed-output',
            recomposedPath,
            '--run-provenance',
            provenancePath,
            '--derivative-provenance',
            derivativeProvenancePath,
          ],
          { cwd: ROOT, encoding: 'utf8' },
        );
        if (derivative.error || derivative.status !== 0) {
          throw new Error(
            `Could not build the Qwen Layered review sheet: ${derivative.error?.message ?? derivative.stderr ?? `exit ${derivative.status}`}`,
          );
        }
        await finalizeReviewedDerivative(derivativeProvenancePath, filePath, template.mediaType, {
          ffmpeg: args.ffmpeg,
        });
      }
      const captured = {
        runIndex,
        taskId: run.taskId,
        outputId: output.id,
        filePath,
        collectionFilePaths,
        contentType: fetched.contentType,
        runtimeFingerprint: provenance.runtimeFingerprint,
        modelRevision: provenance.modelRevision,
        modelSetHash: provenance.models?.hash ?? null,
        mediaHash: provenance.mediaHash,
        terminalTask,
        evidence: {
          output: outputEvidencePath,
          nodes: nodesEvidencePath,
          modelFingerprint: modelEvidencePath,
          websocketEvents: websocketEvidencePath,
          provenance: provenancePath,
          ...(derivativeProvenancePath ? { derivativeProvenance: derivativeProvenancePath } : {}),
        },
      };
      outputs.push(captured);

      if (runIndex < args.runs) {
        const cleanup = await clearRuntimeBetweenRuns(args.server);
        const cleanupPath = join(evidenceDir, `${evidenceBase}.runtime-cleanup.json`);
        writeFileSync(cleanupPath, `${JSON.stringify(cleanup, null, 2)}\n`, 'utf8');
        captured.evidence.runtimeCleanup = cleanupPath;
        await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState()?.websocket?.isConnected), null, {
          timeout: 30_000,
        });
      }
    } catch (error) {
      if (error && typeof error === 'object') error.partialOutputs = [...outputs];
      throw error;
    }
  }

  if (args.sourceOnly) {
    return {
      templateId: template.id,
      modelType: template.modelType,
      skipped: false,
      sourceOnly: true,
      outputs,
    };
  }

  if (args.reviewed) {
    return {
      templateId: template.id,
      modelType: template.modelType,
      skipped: false,
      outputs,
      comparisonBeforeMedia: generatedComparisonBeforeMedia || comparisonBeforeMediaForTemplate(template, args),
      verificationStatus: 'reviewed',
      awaitingReview: true,
    };
  }

  const duplicateComparison = compareRunProvenance(provenances[0], provenances[1]);
  const duplicateComparisonPath = join(
    mediaDir,
    'evidence',
    `${safeFileName(template.id)}.duplicate-provenance-comparison.json`,
  );
  writeFileSync(duplicateComparisonPath, `${JSON.stringify(duplicateComparison, null, 2)}\n`, 'utf8');
  if (!duplicateComparison.candidateExact) {
    const error = new Error(
      `Duplicate run provenance did not match: ${duplicateComparison.mismatches.map((item) => item.field).join(', ') || duplicateComparison.baselineBlockers.concat(duplicateComparison.candidateBlockers).join(', ')}`,
    );
    error.partialOutputs = [...outputs];
    throw error;
  }

  return {
    templateId: template.id,
    modelType: template.modelType,
    skipped: false,
    outputs,
    comparisonBeforeMedia: generatedComparisonBeforeMedia || comparisonBeforeMediaForTemplate(template, args),
    duplicateComparison,
    duplicateComparisonPath,
  };
}

export function orderTemplatesForRuntimeReuse(templates, enabled = false) {
  if (!enabled) return templates;
  const keyOrder = new Map();
  for (const template of templates) {
    const key = String(template?.runtimeReuseKey ?? '');
    if (!keyOrder.has(key)) keyOrder.set(key, keyOrder.size);
  }
  return templates
    .map((template, index) => ({ template, index }))
    .sort((left, right) => {
      const leftKey = String(left.template?.runtimeReuseKey ?? '');
      const rightKey = String(right.template?.runtimeReuseKey ?? '');
      return (keyOrder.get(leftKey) ?? 0) - (keyOrder.get(rightKey) ?? 0) || left.index - right.index;
    })
    .map(({ template }) => template);
}

function selectedTemplates(allTemplates, args) {
  if (!Array.isArray(allTemplates) || allTemplates.length === 0) {
    throw new Error('Studio exposed zero templates; gallery runs cannot continue.');
  }
  const requestedIds = [...new Set(args.templates)];
  const availableIds = new Set(allTemplates.map((template) => template.id));
  const missingIds = requestedIds.filter((id) => !availableIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(`Requested Studio template id(s) were not found: ${missingIds.join(', ')}.`);
  }

  const selected =
    requestedIds.length > 0 ? allTemplates.filter((template) => requestedIds.includes(template.id)) : allTemplates;
  const limited =
    typeof args.maxTemplates === 'number' && Number.isFinite(args.maxTemplates)
      ? selected.slice(0, Math.max(0, args.maxTemplates))
      : selected;
  if (limited.length === 0) {
    throw new Error('Gallery template selection resolved to zero templates.');
  }
  return orderTemplatesForRuntimeReuse(limited, args.reuseRuntimeWithinModel);
}

async function maybeGenerateManifest(args, artifactDir, mediaDir, results) {
  if (args.allowBlockedProbe) {
    return {
      skipped: true,
      reason: 'Blocked-template probes retain qualification evidence only and never generate gallery manifests.',
    };
  }
  const revisionResolution = await resolveModelRevision(args, results);
  if (!revisionResolution.modelRevision) {
    return {
      skipped: true,
      reason: revisionResolution.reason,
      modelRevisions: revisionResolution.modelRevisions,
      command: `npm run gallery:generate -- --media-dir ${mediaDir} --model-revision <revision>`,
    };
  }

  const runtimeFingerprint =
    results.flatMap((item) => item.outputs ?? []).find((item) => item.runtimeFingerprint)?.runtimeFingerprint ??
    args['runtime-fingerprint'] ??
    revisionResolution.runtimeFingerprint ??
    'unverified-local';
  const successfulResults = results.filter((item) => !item.skipped);
  const beforeMedia = successfulResults.length === 1 ? successfulResults[0].comparisonBeforeMedia : '';
  const generateInvocation = galleryGenerateInvocation({
    mediaDir,
    modelRevision: revisionResolution.modelRevision,
    runtimeFingerprint,
    provenanceDir: join(mediaDir, 'evidence'),
    ffmpeg: args.ffmpeg,
    beforeMedia,
    templates: successfulResults.map((item) => item.templateId),
    verification: args.reviewed ? 'reviewed' : 'exact',
    publish: args.publish,
  });
  const result = await new Promise((resolve) => {
    const child = spawn(generateInvocation.command, generateInvocation.args, { cwd: ROOT, stdio: 'inherit' });
    child.once('error', (error) => resolve({ code: 1, error: error.message }));
    child.once('close', (code) => resolve({ code }));
  });
  return {
    skipped: false,
    code: result.code,
    modelRevision: revisionResolution.modelRevision,
    revisionResolution,
    runtimeFingerprint,
  };
}

async function fetchModelRevisionForType(args, modelType) {
  const url = new URL('/model_fingerprints', args.server);
  url.searchParams.set('modelType', modelType);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = await response.json();
  const model = Array.isArray(data.models) ? data.models.find((item) => item?.installed && item?.modelRevision) : null;
  return {
    modelType,
    modelRevision: model?.modelRevision ?? null,
    repoId: model?.repoId ?? null,
    selectedRevision: model?.selectedRevision ?? null,
    runtimeFingerprint: data.runtimeFingerprint ?? null,
  };
}

async function resolveModelRevision(args, results) {
  if (args['model-revision']) {
    return {
      modelRevision: args['model-revision'],
      reason: 'Explicit --model-revision supplied.',
      modelRevisions: [],
      runtimeFingerprint: null,
    };
  }

  const modelTypes = [
    ...new Set(results.filter((item) => !item.skipped && item.modelType).map((item) => item.modelType)),
  ];
  if (modelTypes.length === 0) {
    return {
      modelRevision: null,
      reason: 'No successful template runs produced a model type for revision resolution.',
      modelRevisions: [],
      runtimeFingerprint: null,
    };
  }

  const capturedRevisions = [
    ...new Set(
      results
        .filter((item) => !item.skipped)
        .flatMap((item) => item.outputs ?? [])
        .map((output) => output.modelRevision)
        .filter(Boolean),
    ),
  ];
  if (capturedRevisions.length === 1) {
    return {
      modelRevision: capturedRevisions[0],
      reason: 'Resolved from the executed run provenance model set.',
      modelRevisions: [],
      runtimeFingerprint:
        results.flatMap((item) => item.outputs ?? []).find((item) => item.runtimeFingerprint)?.runtimeFingerprint ??
        null,
    };
  }
  if (capturedRevisions.length > 1) {
    return {
      modelRevision: null,
      reason: 'Captured templates use multiple executed model sets. Run one model family at a time.',
      modelRevisions: [],
      runtimeFingerprint:
        results.flatMap((item) => item.outputs ?? []).find((item) => item.runtimeFingerprint)?.runtimeFingerprint ??
        null,
    };
  }

  try {
    const modelRevisions = await Promise.all(modelTypes.map((modelType) => fetchModelRevisionForType(args, modelType)));
    const missing = modelRevisions.filter((item) => !item.modelRevision);
    if (missing.length > 0) {
      return {
        modelRevision: null,
        reason: `Backend could not resolve installed model revisions for: ${missing.map((item) => item.modelType).join(', ')}.`,
        modelRevisions,
        runtimeFingerprint: modelRevisions.find((item) => item.runtimeFingerprint)?.runtimeFingerprint ?? null,
      };
    }

    const uniqueRevisions = [...new Set(modelRevisions.map((item) => item.modelRevision))];
    if (uniqueRevisions.length !== 1) {
      return {
        modelRevision: null,
        reason:
          'Captured templates use multiple model revisions. Run one model family at a time or pass --model-revision explicitly.',
        modelRevisions,
        runtimeFingerprint: modelRevisions.find((item) => item.runtimeFingerprint)?.runtimeFingerprint ?? null,
      };
    }

    return {
      modelRevision: uniqueRevisions[0],
      reason: 'Resolved from backend /model_fingerprints.',
      modelRevisions,
      runtimeFingerprint: modelRevisions.find((item) => item.runtimeFingerprint)?.runtimeFingerprint ?? null,
    };
  } catch (error) {
    return {
      modelRevision: null,
      reason: `Could not auto-resolve model revision from backend /model_fingerprints: ${error instanceof Error ? error.message : String(error)}.`,
      modelRevisions: [],
      runtimeFingerprint: null,
    };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const releaseRunnerLock = acquireRunnerLock();
  const mediaDir = args.resumeMediaDir || join(artifactDirForRun(), 'media');
  const artifactDir = dirname(mediaDir);
  const managedProcesses = [];
  mkdirSync(mediaDir, { recursive: true });

  try {
    const templateRuntime = await loadTemplateRuntime(ROOT, { includePlanning: args.allowBlockedProbe });
    const backendSource = backendSourceIdentity(args.backendDir);
    writeFileSync(
      join(artifactDir, 'backend-source-before.json'),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), identity: backendSource }, null, 2)}\n`,
      'utf8',
    );
    const backend = await ensureBackend(args, managedProcesses, artifactDir);
    const backendHealthResponse = await fetch(new URL('/health', args.server), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!backendHealthResponse.ok) {
      throw new Error(`Backend source preflight could not read /health (HTTP ${backendHealthResponse.status}).`);
    }
    const backendHealth = await backendHealthResponse.json();
    const backendSourcePreflight = backendSourceEvidence({
      before: backendSource,
      after: backendSource,
      runtimeFingerprint: { backendSource: backendHealth?.backend_source },
    });
    writeFileSync(
      join(artifactDir, 'backend-source-before.json'),
      `${JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          identity: backendSource,
          workerAttestation: backendSourcePreflight.attestation,
          blockers: backendSourcePreflight.blockers,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    if (backendSourcePreflight.blockers.length > 0) {
      throw new Error(
        `Backend source preflight failed before generation. Restart the backend after the final source edit: ${backendSourcePreflight.blockers.join(' ')}`,
      );
    }
    // An interrupted capture can leave a valid backend graph running after its
    // browser exits. Wait for that graph before opening a second app session;
    // otherwise model loading can delay websocket bootstrap and make session
    // overlap look like a template failure.
    await waitForQueueIdle(args.server, fetch, {
      timeoutMs: args.queueWaitTimeoutMs,
      pollMs: 1_000,
    });
    await requireAppDownloadsIdle(args.server, fetch, { timeoutMs: Math.min(args.queueWaitTimeoutMs, 120_000) });
    const frontend = await ensureFrontend(args, managedProcesses);
    if (args.installModel) {
      const installResult = await withGalleryBrowserPage(
        args,
        frontend.url,
        `installing ${args.installModel}`,
        (page) =>
          page.evaluate(({ repoId, repair, files }) => window.__MODIFF_E2E__?.installHfModel(repoId, repair, files), {
            repoId: args.installModel,
            repair: Boolean(args.repairModel),
            files: args.installModelFiles,
          }),
        Math.max(args.timeoutMs, 180_000),
      );
      const report = {
        mode: 'install-model',
        artifactDir,
        frontend,
        backend,
        server: args.server,
        repoId: args.installModel,
        requestedFiles: args.installModelFiles,
        repair: Boolean(args.repairModel),
        result: installResult,
      };
      writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const allTemplates = await withGalleryBrowserPage(
      args,
      frontend.url,
      'loading the template catalog',
      async (page) => {
        // A freshly started frontend can connect before its initial model-index
        // discovery has settled. Refresh explicitly so app-installed snapshots
        // are the readiness source for every proof run.
        await page.evaluate(() => window.__MODIFF_E2E__?.refreshModelIndexes());
        return page.evaluate(
          (includePlanning) => window.__MODIFF_E2E__?.listTemplates(includePlanning) ?? [],
          args.allowBlockedProbe,
        );
      },
    );
    const templates = selectedTemplates(allTemplates, args);
    if (args.reuseExistingRuntimeKey && String(templates[0]?.runtimeReuseKey ?? '') !== args.reuseExistingRuntimeKey) {
      throw new Error(
        `The first template loader key does not match --reuse-existing-runtime-key (${args.reuseExistingRuntimeKey}).`,
      );
    }
    if (
      !args.sourceOnly &&
      templates.length > 0 &&
      templates.every((template) => template.mediaType === 'audio' || template.mediaType === 'video')
    ) {
      args.reviewed = true;
      args.runs = 1;
    }
    const results = [];
    let previousTemplate = args.reuseExistingRuntimeKey ? { runtimeReuseKey: args.reuseExistingRuntimeKey } : null;
    for (const template of templates) {
      try {
        await requireAppDownloadsIdle(args.server, fetch, {
          timeoutMs: Math.min(args.queueWaitTimeoutMs, 120_000),
        });
        const templateArgs = argsForTemplateInputs(args, template);
        const shouldPrepare = shouldPrepareRuntimeForTemplate(previousTemplate, template, args.reuseRuntimeWithinModel);
        const runtimePreparation = shouldPrepare
          ? await prepareRuntimeForTemplate(args.server, fetch, { timeoutMs: args.queueWaitTimeoutMs })
          : null;
        const browserExecution = await runWithGalleryBrowserRecovery(
          () =>
            withGalleryBrowserPage(
              args,
              frontend.url,
              `capturing template ${template.id}`,
              async (page, websocketEvents) => {
                await page.evaluate(() => window.__MODIFF_E2E__?.refreshModelIndexes());
                return runTemplate(
                  page,
                  template,
                  templateArgs,
                  mediaDir,
                  websocketEvents,
                  templateRuntime,
                  backendSource,
                );
              },
              galleryCaptureOperationTimeoutMs(args.timeoutMs, args.runs),
            ),
          async (error, nextAttempt) => {
            // The renderer may disappear after the backend accepted a graph.
            // Wait for that attributed work to reach a terminal state, then
            // clear its node cache before retrying the same template in a new
            // browser. This prevents both overlapping executions and vacuous
            // cached duplicate evidence.
            await waitForQueueIdle(args.server, fetch, {
              timeoutMs: args.queueWaitTimeoutMs,
              pollMs: 1_000,
            });
            const cleanup = await prepareRuntimeForTemplate(args.server, fetch, {
              timeoutMs: args.queueWaitTimeoutMs,
            });
            return {
              attempts: nextAttempt,
              reason: error instanceof Error ? error.message : String(error),
              cleanup,
            };
          },
        );
        const result = browserExecution.value;
        if (browserExecution.recovery) result.browserRecovery = browserExecution.recovery;
        if (args.recordQualification && !result.sourceOnly && !result.skipped) {
          const provenancePath = result.outputs?.at(-1)?.evidence?.provenance;
          if (!provenancePath) {
            throw new Error(`Template ${template.id} completed without a provenance file to record.`);
          }
          const qualification = spawnSync(process.execPath, [join(ROOT, 'scripts', 'template-qualification.mjs')], {
            cwd: ROOT,
            encoding: 'utf8',
            env: {
              ...process.env,
              MODIFF_BACKEND_DIR: args.backendDir,
              MODIFF_TEMPLATE_PROVENANCE: provenancePath,
            },
          });
          if (qualification.error || qualification.status !== 0) {
            throw new Error(
              `Could not record ${template.id} qualification: ${
                qualification.error?.message ?? qualification.stderr?.trim() ?? `exit ${qualification.status}`
              }`,
            );
          }
          result.qualification = {
            recorded: true,
            provenancePath,
            message: qualification.stdout.trim(),
          };
        }
        if (args.recordResourceQualification && !result.sourceOnly && !result.skipped) {
          const provenancePath = result.outputs?.at(-1)?.evidence?.provenance;
          if (!provenancePath) {
            throw new Error(
              `Template ${template.id} completed without a provenance file to record as resource evidence.`,
            );
          }
          const qualification = spawnSync(process.execPath, [join(ROOT, 'scripts', 'resource-qualification.mjs')], {
            cwd: ROOT,
            encoding: 'utf8',
            env: {
              ...process.env,
              MODIFF_BACKEND_DIR: args.backendDir,
              MODIFF_RESOURCE_PROVENANCE: provenancePath,
            },
          });
          if (qualification.error || qualification.status !== 0) {
            throw new Error(
              `Could not record ${template.id} resource qualification: ${
                qualification.error?.message ?? qualification.stderr?.trim() ?? `exit ${qualification.status}`
              }`,
            );
          }
          result.resourceQualification = {
            recorded: true,
            provenancePath,
            message: qualification.stdout.trim(),
          };
        }
        if (runtimePreparation) result.runtimePreparation = runtimePreparation;
        if (!shouldPrepare) {
          result.runtimeReuse = {
            modelType: template.modelType,
            previousTemplateId: previousTemplate?.id ?? null,
            proof: 'matching-loader-contract-key-and-backend-loader-cache-eligible',
          };
        }
        results.push(result);
        previousTemplate = template;
      } catch (error) {
        results.push({
          templateId: template.id,
          skipped: true,
          reason: error instanceof Error ? error.message : String(error),
          failureKind: isGalleryInfrastructureFailure(error) ? 'infrastructure' : 'template',
          outputs: error?.partialOutputs ?? [],
        });
        previousTemplate = null;
        if (args.stopOnFailure) break;
      }
    }
    const manifestGeneration = args.sourceOnly
      ? {
          skipped: true,
          reason: 'Source-only capture never generates or publishes a gallery manifest.',
        }
      : args.recordQualification || args.recordResourceQualification
        ? {
            skipped: true,
            reason:
              'Qualification-only capture records execution receipts without generating or publishing gallery media.',
          }
        : await maybeGenerateManifest(args, artifactDir, mediaDir, results);
    const report = {
      mode: args.sourceOnly ? 'source-only' : 'run',
      artifactDir,
      mediaDir,
      frontend,
      backend,
      server: args.server,
      templates: templates.length,
      captured: results.filter((item) => !item.skipped).length,
      skipped: results.filter((item) => item.skipped),
      results,
      manifestGeneration,
    };
    writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    const exitCode = galleryRunExitCode(results, manifestGeneration);
    if (exitCode !== 0) process.exitCode = exitCode;
  } finally {
    for (const managed of managedProcesses.reverse()) {
      if (managed.role === 'frontend' && args.keepFrontend) continue;
      if (managed.role === 'backend' && args.keepBackend) continue;
      await stopManagedProcess(managed.child);
    }
    releaseRunnerLock();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = RUNNER_INFRASTRUCTURE_EXIT_CODE;
  });
}
