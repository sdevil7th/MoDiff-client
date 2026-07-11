import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { decodedMediaHash, loadTemplateRuntime } from './template-gallery-harness.mjs';
import {
  backendSourceIdentity,
  compareRunProvenance,
  createRunProvenance,
  modelSetIdentity,
  resolvedModelReposFromOutput,
  selectInstalledModelIdentity,
} from './live-proof-provenance.mjs';

const ROOT = process.cwd();
const ARTIFACT_ROOT = join(ROOT, 'artifacts', 'template-gallery');
const DEFAULT_SERVER = process.env.MODIFF_GALLERY_SERVER || 'http://127.0.0.1:8088';
const DEFAULT_PORT = Number(process.env.MODIFF_GALLERY_FRONTEND_PORT || 5192);
const DEFAULT_BACKEND_DIR = process.env.MODIFF_BACKEND_DIR || resolve(ROOT, '..', 'MoDiff');
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
  const binaries = join(backendDir, '.venv', 'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries');
  if (!existsSync(binaries)) return null;
  const executable = readdirSync(binaries).find((name) => /^ffmpeg.*\.exe$/i.test(name));
  return executable ? join(binaries, executable) : null;
}

function parseArgs(argv) {
  const args = {
    server: DEFAULT_SERVER,
    port: DEFAULT_PORT,
    runs: 2,
    timeoutMs: 15 * 60 * 1000,
    headless: true,
    publish: false,
    keepFrontend: false,
    keepBackend: false,
    sourceOnly: false,
    noStart: false,
    noBackendStart: false,
    backendDir: DEFAULT_BACKEND_DIR,
    startRun: 1,
    templates: [],
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
    if (entry === '--source-only') {
      args.sourceOnly = true;
      continue;
    }
    if (entry === '--allow-non-exact') {
      args.allowNonExact = true;
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
      } else if (key === 'timeout-ms') {
        args.timeoutMs = Number(value ?? args.timeoutMs);
      } else if (key === 'port') {
        args.port = Number(value ?? args.port);
      } else if (key === 'backend-dir') {
        args.backendDir = resolve(String(value ?? args.backendDir));
      } else if (key === 'headless') {
        args.headless = String(value) !== 'false';
      } else if (key === 'max-templates') {
        args.maxTemplates = Number(value);
      } else if (key === 'start-run') {
        args.startRun = Number(value);
      } else {
        args[key] = value;
      }
    }
  }

  args.frontendUrl = args['frontend-url'] || `http://127.0.0.1:${args.port}`;
  const minimumRuns = args.sourceOnly || args.reviewed ? 1 : 2;
  args.runs = Math.max(minimumRuns, Number.isFinite(args.runs) ? args.runs : 2);
  if (args.reviewed) args.runs = 1;
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
  if (args.sourceOnly && args.publish) {
    throw new Error('--source-only cannot be combined with --publish.');
  }
  if ((args.promptOverride || args.negativePromptOverride) && !args.sourceOnly) {
    throw new Error('Prompt overrides are allowed only with --source-only.');
  }
  if (args.installModel && (args.sourceOnly || args.publish || args.templates.length > 0)) {
    throw new Error(
      '--install-model is a standalone app operation and cannot be combined with template capture options.',
    );
  }
  if (args.repairModel && !args.installModel) {
    throw new Error('--repair-model requires --install-model <repo>.');
  }
  const resolveMediaInput = (value) => {
    const normalized = String(value ?? '').trim();
    if (!normalized || /^(?:https?:|data:)/i.test(normalized) || isAbsolute(normalized)) return normalized;
    return resolve(ROOT, normalized);
  };
  args.referenceImages = String(args['reference-image'] ?? '')
    .split(',')
    .map(resolveMediaInput)
    .filter(Boolean);
  args.maskImage = resolveMediaInput(args['mask-image']);
  args.controlImage = resolveMediaInput(args['control-image']);
  args.sourceVideo = resolveMediaInput(args['source-video']);
  args.maskVideo = resolveMediaInput(args['mask-video']);
  args.controlVideo = resolveMediaInput(args['control-video']);
  args.sourceAudio = resolveMediaInput(args['source-audio']);
  args.referenceAudio = resolveMediaInput(args['reference-audio']);
  args.ffmpeg = String(args.ffmpeg ?? process.env.MODIFF_FFMPEG ?? bundledFfmpegPath(args.backendDir) ?? '').trim();
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

Options:
  --server <url>             Backend URL. Default: ${DEFAULT_SERVER}
  --backend-dir <path>       Backend checkout to start when loopback is unavailable. Default: ${DEFAULT_BACKEND_DIR}
  --no-backend-start         Require an already-running backend.
  --keep-backend             Keep a backend process started by this script.
  --port <number>            Dev frontend port. Default: ${DEFAULT_PORT}
  --frontend-url <url>       Existing frontend URL instead of the default port URL.
  --template <id[,id]>       Limit to one or more template ids. Repeatable.
  --max-templates <number>   Cap the number of selected templates.
  --reviewed                 Coverage mode: run once, then pause for manual quality review.
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
  --resource-mode <mode>     Optional bounded probe override: auto or expert.
  --quantization-mode <mode> Optional bounded probe override, for example bnb_4bit.
  --offload-mode <mode>      Optional bounded probe override, for example group_cpu.
  --steps <number>           Optional bounded probe inference-step override.
  --width <number>           Optional bounded probe width override.
  --height <number>          Optional bounded probe height override.
  --source-only              Capture purpose-built input media; never generate/publish a gallery manifest.
  --prompt-override <text>   Source-only prompt override for creating a purpose-matched input asset.
  --negative-prompt-override <text> Source-only negative-prompt override.
  --output-name <name>       Stable source-only media basename instead of the template id.
  --install-model <repo>     Install one Hugging Face repository through the app model-store action.
  --repair-model             Repair an incomplete --install-model repository snapshot.
  --ffmpeg <path>            FFmpeg executable for decoded audio/video hashing and video posters.
  --publish                  Pass --publish to gallery:generate after verification.
  --headed                   Show the browser while running.
  --no-start                 Require an already-running frontend.
  --keep-frontend            Do not stop a frontend process started by this script.
  --timeout-ms <number>      Per-run output wait timeout. Default: 900000.
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

function stopManagedProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill();
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
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
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

async function ensureFrontend(args, managedProcesses) {
  if (!(await isPortFree(args.port))) {
    return { started: false, url: args.frontendUrl };
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
  if (results.some((item) => item.skipped)) return 1;
  return Number(manifestGeneration.code || 0);
}

export function galleryGenerateInvocation({
  mediaDir,
  modelRevision,
  runtimeFingerprint,
  provenanceDir,
  ffmpeg,
  beforeMedia,
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
  const cacheUrl = new URL(`/cache/${receipt.current_node}/output/0?format=WEBP&quality=100`, server).toString();
  try {
    const response = await fetch(cacheUrl);
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? '';
    if (!contentType.startsWith('image/')) return null;
  } catch {
    return null;
  }

  return page.evaluate(
    ({ expectedTaskId, expectedTemplateId, nodeId, url, completedAt, runtimeFingerprint }) => {
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
        fieldKey: 'preview',
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
        displayType: 'image',
        backendProvenance: { runtimeFingerprint: runtimeFingerprint ?? null },
      };
    },
    {
      expectedTaskId: taskId,
      expectedTemplateId: templateId,
      nodeId: receipt.current_node,
      url: cacheUrl,
      completedAt: receipt.completed_at,
      runtimeFingerprint: receipt.runtimeFingerprint,
    },
  );
}

export async function waitForTaskTerminal(page, { taskId, server, timeoutMs = 120_000 }) {
  const started = Date.now();
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
    const receipt = await queueReceiptForTask(server, taskId);
    if (receipt?.status === 'completed') return receipt;
    throwForTerminalReceipt(receipt, taskId);
    await delay(500);
  }
  throw new Error(`Timed out waiting for task ${taskId} to become terminal after its output was captured.`);
}

export async function clearRuntimeBetweenRuns(server, fetchImpl = fetch) {
  const cleanupUrl = new URL('/runtime/gpu_cleanup', server);
  const response = await fetchImpl(cleanupUrl, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Runtime cleanup failed with HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(payload.message || 'Runtime cleanup reported an error.');
  }
  if (!Number.isInteger(payload?.released_node_count) || payload.released_node_count < 1) {
    throw new Error('Runtime cleanup did not prove that any cached node objects were released.');
  }
  return payload;
}

export function executionReceiptsForRun(template, output, websocketEvents) {
  const requiredActions =
    template.modelType === 'WanVACEPipeline'
      ? [
          ['modules.WanVACE', 'Generate'],
          ['modules.Video', 'Export'],
        ]
      : template.modelType === 'AceStepAudioPipeline'
        ? [
            ['modules.DiffusersAudio', 'Generate'],
            ['modules.Audio', 'Export'],
          ]
        : [];
  if (requiredActions.length === 0) return [];
  const graphNodes = Array.isArray(output?.apiGraphSnapshot?.nodes)
    ? output.apiGraphSnapshot.nodes
    : Object.entries(output?.apiGraphSnapshot?.nodes ?? {}).map(([id, node]) => ({ id, ...node }));
  return requiredActions.map(([moduleName, actionName]) => {
    const node = graphNodes.find((item) => item?.module === moduleName && item?.action === actionName);
    if (!node?.id) throw new Error(`Executed graph is missing ${moduleName}.${actionName}.`);
    const receipt = [...websocketEvents]
      .reverse()
      .find((event) => event?.type === 'executed' && event?.task_id === output?.taskId && event?.node === node.id);
    if (!receipt) throw new Error(`No execution receipt was captured for ${moduleName}.${actionName}.`);
    if (receipt.status === 'cached' || receipt.hasChanged === false) {
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
  const started = Date.now();
  const replayedUpdates = new Set();
  while (Date.now() - started < timeoutMs) {
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
    throwForTerminalReceipt(receipt, taskId ?? 'unknown');
    if (receipt?.status === 'completed') {
      const recovered = await recoverOutputFromBackendCache(page, { receipt, server, taskId, templateId });
      if (recovered) return recovered;
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for output from ${templateId} (${taskId ?? 'no task id'}).`);
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

function formOverridesForTemplate(template, args) {
  if (template.exampleStatus === 'blocked') {
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
  if (template.mode === 'inpaint') {
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

function inputArtifactsForOverrides(overrides = {}) {
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

function comparisonBeforeMediaForTemplate(template, args) {
  if (!['compareSlider', 'hoverDissolve'].includes(template.thumbnailVariant)) return '';
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
  await page.evaluate(
    ({ templateId, formOverrides }) => window.__MODIFF_E2E__?.applyTemplate(templateId, formOverrides),
    { templateId: template.id, formOverrides: overrides ?? {} },
  );
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
        preferredStudioRole: template.workflowBlocks?.includes('upscaler') ? 'upscalePreview' : '',
      });
      const fetched = await fetchOutput(output, args.frontendUrl);
      const extension = extensionForOutput(output, fetched.contentType);
      const outputBase = args.sourceOnly && args.outputName ? args.outputName : safeFileName(template.id);
      const fileName = `${outputBase}.run${runIndex}${extension}`;
      const filePath = join(mediaDir, fileName);
      writeFileSync(filePath, fetched.buffer);
      const runInputArtifacts = [...inputArtifacts];
      if (template.workflowBlocks?.includes('upscaler')) {
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
      const terminalTask = await waitForTaskTerminal(page, {
        taskId: run.taskId,
        server: args.server,
        timeoutMs: Math.min(args.timeoutMs, 120_000),
      });
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
      const executionReceipts = executionReceiptsForRun(template, output, taskEvents);
      if (!taskEvents.some((event) => event?.type === 'graph_completed')) {
        throw new Error(`No graph_completed receipt was captured for task ${run.taskId}.`);
      }
      if (!taskEvents.some((event) => event?.type === 'task_completed')) {
        throw new Error(`No task_completed receipt was captured for task ${run.taskId}.`);
      }
      const evidenceDir = join(mediaDir, 'evidence');
      mkdirSync(evidenceDir, { recursive: true });
      const evidenceBase = `${safeFileName(template.id)}.run${runIndex}`;
      const outputEvidencePath = join(evidenceDir, `${evidenceBase}.output.json`);
      const nodesEvidencePath = join(evidenceDir, `${evidenceBase}.nodes.json`);
      const modelEvidencePath = join(evidenceDir, `${evidenceBase}.model-fingerprint.json`);
      const websocketEvidencePath = join(evidenceDir, `${evidenceBase}.websocket-events.json`);
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
      const [nodesPayload, modelPayloads, decoded] = await Promise.all([
        nodesResponse.json(),
        Promise.all(modelResponses.map((response) => response.json())),
        decodedMediaHash(filePath, template.mediaType, { ffmpeg: args.ffmpeg }),
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
      const encodedSha256 = `sha256:${createHash('sha256').update(fetched.buffer).digest('hex')}`;
      const outputAnalysis = {
        ok: true,
        outputCount: 1,
        analyses: [
          {
            ...decoded,
            mediaType: template.mediaType,
            byteSize: fetched.buffer.byteLength,
            encodedSha256,
            decodedSha256: decoded.hash,
            ok: true,
          },
        ],
      };
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
        runtimeFingerprint:
          deterministicEvent?.runtimeFingerprint ?? output.backendProvenance?.runtimeFingerprint ?? null,
        deterministicMode: deterministicEvent?.deterministicMode ?? output.apiGraphSnapshot?.deterministicMode,
        backendSource,
        outputAnalysis,
        executedOutput: output,
        taskId: run.taskId,
      });
      if (provenance.blockers.length > 0) {
        throw new Error(`Run provenance is incomplete: ${provenance.blockers.join(' ')}`);
      }
      provenances.push(provenance);
      const provenancePath = join(evidenceDir, `${evidenceBase}.provenance.json`);
      writeFileSync(
        outputEvidencePath,
        `${JSON.stringify({ runIndex, run, terminalTask, output }, null, 2)}\n`,
        'utf8',
      );
      writeFileSync(nodesEvidencePath, `${JSON.stringify(nodesPayload, null, 2)}\n`, 'utf8');
      writeFileSync(modelEvidencePath, `${JSON.stringify(modelPayload, null, 2)}\n`, 'utf8');
      writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
      writeFileSync(
        websocketEvidencePath,
        `${JSON.stringify({ taskId: run.taskId, executionReceipts, events: taskEvents }, null, 2)}\n`,
        'utf8',
      );
      const captured = {
        runIndex,
        taskId: run.taskId,
        outputId: output.id,
        filePath,
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
  return limited;
}

async function maybeGenerateManifest(args, artifactDir, mediaDir, results) {
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
  const mediaDir = args.resumeMediaDir || join(artifactDirForRun(), 'media');
  const artifactDir = dirname(mediaDir);
  const managedProcesses = [];
  mkdirSync(mediaDir, { recursive: true });

  try {
    const templateRuntime = await loadTemplateRuntime(ROOT);
    const backendSource = backendSourceIdentity(args.backendDir);
    const backend = await ensureBackend(args, managedProcesses, artifactDir);
    const frontend = await ensureFrontend(args, managedProcesses);
    const browser = await chromium.launch({ headless: args.headless });
    try {
      const page = await browser.newPage();
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
      await page.goto(frontend.url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
      await page.waitForFunction(
        () => {
          const state = window.__MODIFF_E2E__?.getState();
          return Boolean(state?.websocket?.isConnected);
        },
        null,
        { timeout: 60_000 },
      );

      if (args.installModel) {
        const installResult = await page.evaluate(
          ({ repoId, repair }) => window.__MODIFF_E2E__?.installHfModel(repoId, repair),
          { repoId: args.installModel, repair: Boolean(args.repairModel) },
        );
        const report = {
          mode: 'install-model',
          artifactDir,
          frontend,
          backend,
          server: args.server,
          repoId: args.installModel,
          repair: Boolean(args.repairModel),
          result: installResult,
        };
        writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      const templates = selectedTemplates(
        await page.evaluate(() => window.__MODIFF_E2E__?.listTemplates() ?? []),
        args,
      );
      const results = [];
      for (const template of templates) {
        try {
          results.push(
            await runTemplate(page, template, args, mediaDir, websocketEvents, templateRuntime, backendSource),
          );
        } catch (error) {
          results.push({
            templateId: template.id,
            skipped: true,
            reason: error instanceof Error ? error.message : String(error),
            outputs: error?.partialOutputs ?? [],
          });
        }
      }
      const manifestGeneration = args.sourceOnly
        ? { skipped: true, reason: 'Source-only capture never generates or publishes a gallery manifest.' }
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
      await browser.close();
    }
  } finally {
    for (const managed of managedProcesses.reverse()) {
      if (managed.role === 'frontend' && args.keepFrontend) continue;
      if (managed.role === 'backend' && args.keepBackend) continue;
      stopManagedProcess(managed.child);
    }
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
