import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path, { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadTemplateRuntime } from './template-gallery-harness.mjs';
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

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function defaultBackendRoot() {
  const candidates = [path.resolve(clientRoot, '..', 'MoDiff'), path.resolve(clientRoot, '..', 'modiff')];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

const backendRoot = process.env.MODIFF_BACKEND_DIR || defaultBackendRoot();
const backendPort = Number(process.env.MODIFF_LIVE_BACKEND_PORT || 8088);
const frontendPort = Number(process.env.MODIFF_LIVE_FRONTEND_PORT || 5193);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactRoot = path.resolve(
  process.env.MODIFF_LIVE_PROOF_ARTIFACT || path.join(clientRoot, 'artifacts', 'live-qwen-proof', stamp),
);
const generationTimeoutMs = Number(process.env.MODIFF_LIVE_GENERATION_TIMEOUT_MS || 60 * 60 * 1000);
const minNonBlackRatio = Number(process.env.MODIFF_LIVE_MIN_NONBLACK_RATIO || 0.02);
const baselineProvenanceInput = String(process.env.MODIFF_LIVE_PROOF_BASELINE || '').trim();
const managed = [];
const DEFAULT_TEMPLATE_ID = 'qwen_low_vram_product_concept';
const DIAGNOSTIC_OVERRIDE_ENV = [
  'MODIFF_LIVE_PROOF_WIDTH',
  'MODIFF_LIVE_PROOF_HEIGHT',
  'MODIFF_LIVE_PROOF_STEPS',
  'MODIFF_LIVE_PROOF_SEED',
  'MODIFF_LIVE_PROOF_PROMPT',
  'MODIFF_LIVE_PROOF_NEGATIVE_PROMPT',
];
const SMOKE_DEFAULTS = {
  width: 512,
  height: 512,
  steps: 8,
  seed: 12345,
  prompt:
    'A compact studio product render of a matte white ceramic desk speaker with a yellow anodized volume ring, soft side lighting, clean gray sweep background, realistic shadows, crisp industrial design details, no readable text.',
  negativePrompt: 'text, watermark, logo, blurry edges, extra objects, warped geometry, noisy background',
};

let proofConfig = null;

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer; received ${JSON.stringify(value)}.`);
  }
  return parsed;
}

function envValue(env, key, fallback) {
  const value = env[key];
  return value === undefined || String(value).trim() === '' ? fallback : value;
}

export function resolveLiveProofConfig(env = process.env) {
  const templateId = String(env.MODIFF_LIVE_PROOF_TEMPLATE_ID ?? DEFAULT_TEMPLATE_ID).trim();
  if (!templateId) throw new Error('MODIFF_LIVE_PROOF_TEMPLATE_ID cannot be empty.');
  const controlImage = String(env.MODIFF_LIVE_PROOF_CONTROL_IMAGE ?? '').trim();
  const requestedMode = String(env.MODIFF_LIVE_PROOF_MODE ?? 'template')
    .trim()
    .toLowerCase();
  if (!['template', 'smoke'].includes(requestedMode)) {
    throw new Error('MODIFF_LIVE_PROOF_MODE must be either "template" or "smoke".');
  }

  const suppliedDiagnosticOverrides = DIAGNOSTIC_OVERRIDE_ENV.filter(
    (key) => env[key] !== undefined && String(env[key]).trim() !== '',
  );
  if (requestedMode !== 'smoke' && suppliedDiagnosticOverrides.length > 0) {
    throw new Error(
      `Diagnostic generation overrides require MODIFF_LIVE_PROOF_MODE=smoke: ${suppliedDiagnosticOverrides.join(', ')}.`,
    );
  }

  if (requestedMode === 'smoke') {
    const diagnosticOverrides = {
      resourceMode: 'auto',
      width: positiveInteger(envValue(env, 'MODIFF_LIVE_PROOF_WIDTH', SMOKE_DEFAULTS.width), 'Smoke width'),
      height: positiveInteger(envValue(env, 'MODIFF_LIVE_PROOF_HEIGHT', SMOKE_DEFAULTS.height), 'Smoke height'),
      steps: positiveInteger(envValue(env, 'MODIFF_LIVE_PROOF_STEPS', SMOKE_DEFAULTS.steps), 'Smoke steps'),
      randomSeed: false,
      seed: positiveInteger(envValue(env, 'MODIFF_LIVE_PROOF_SEED', SMOKE_DEFAULTS.seed), 'Smoke seed'),
      prompt: String(envValue(env, 'MODIFF_LIVE_PROOF_PROMPT', SMOKE_DEFAULTS.prompt)),
      negativePrompt: String(envValue(env, 'MODIFF_LIVE_PROOF_NEGATIVE_PROMPT', SMOKE_DEFAULTS.negativePrompt)),
    };
    return {
      proofMode: 'smoke',
      templateId,
      applyOverrides: controlImage ? { ...diagnosticOverrides, controlImage } : diagnosticOverrides,
      diagnosticOverrides,
      exactInputs: controlImage ? { controlImage } : null,
      templateLockPreserved: false,
      exactnessStatus: 'non_exact',
      exactProof: false,
      exactnessReason:
        'Diagnostic smoke mode overrides locked template generation settings and cannot be presented as Exact proof.',
    };
  }

  return {
    proofMode: 'template',
    templateId,
    applyOverrides: controlImage ? { controlImage } : {},
    diagnosticOverrides: null,
    exactInputs: controlImage ? { controlImage } : null,
    templateLockPreserved: true,
    exactnessStatus: 'unverified',
    exactProof: false,
    exactnessReason:
      'The locked template settings are preserved, but one live run is not Exact proof without duplicate matching decoded output hashes and a pinned runtime fingerprint.',
  };
}

export function proofArtifactFields(config) {
  return {
    proofMode: config?.proofMode ?? 'configuration-error',
    templateId: config?.templateId ?? DEFAULT_TEMPLATE_ID,
    diagnosticOverrides: config?.diagnosticOverrides ?? null,
    exactInputs: config?.exactInputs ?? null,
    templateLockPreserved: Boolean(config?.templateLockPreserved),
    exactnessStatus: config?.exactnessStatus ?? 'non_exact',
    exactProof: false,
    exactnessReason:
      config?.exactnessReason ?? 'The proof configuration was invalid, so this artifact cannot be Exact proof.',
  };
}

export function compareTemplateLock(appliedForm, expectedLockedSettings) {
  const mismatches = Object.entries(expectedLockedSettings ?? {}).flatMap(([field, expected]) => {
    const actual = appliedForm?.[field];
    const matches = JSON.stringify(actual) === JSON.stringify(expected);
    return matches ? [] : [{ field, expected, actual }];
  });
  return {
    matches: mismatches.length === 0,
    comparedFields: Object.keys(expectedLockedSettings ?? {}).length,
    mismatches,
  };
}

export function backendSourceDriftBlocker(before, after) {
  if (!before?.fingerprint || !after?.fingerprint) {
    return 'backend source identity could not be captured at both proof boundaries.';
  }
  if (before.fingerprint !== after.fingerprint) {
    return 'backend source files changed while the live proof was running.';
  }
  return null;
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(artifactRoot, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readBaselineProvenance(input) {
  if (!input) return null;
  const requestedPath = path.resolve(clientRoot, input);
  const provenancePath =
    fs.existsSync(requestedPath) && fs.statSync(requestedPath).isDirectory()
      ? path.join(requestedPath, 'run-provenance.json')
      : requestedPath;
  if (!fs.existsSync(provenancePath)) {
    throw new Error(`Baseline provenance file was not found: ${provenancePath}`);
  }
  return {
    path: provenancePath,
    value: JSON.parse(fs.readFileSync(provenancePath, 'utf8')),
  };
}

function status(step, detail = {}) {
  writeJson('status.json', {
    step,
    artifactRoot,
    backendUrl,
    frontendUrl,
    updatedAt: new Date().toISOString(),
    ...detail,
    ...proofArtifactFields(proofConfig),
  });
}

export function pipeChildLogs(child, out, name) {
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });
  child.on('close', (code, signal) => {
    if (!out.destroyed && !out.writableEnded) {
      out.end(`\n[${name}] exited code=${code} signal=${signal}\n`);
    }
  });
}

function start(name, command, args, cwd, env = {}) {
  const out = fs.createWriteStream(path.join(artifactRoot, `${name}.log`), { flags: 'a' });
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    windowsHide: true,
  });
  pipeChildLogs(child, out, name);
  managed.push(child);
  return child;
}

function fetchText(url, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${url} returned ${response.statusCode}: ${text.slice(0, 1000)}`));
          return;
        }
        resolve(text);
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Timed out waiting for ${url}`)));
    request.on('error', reject);
  });
}

async function fetchJson(url, timeoutMs = 30_000) {
  const text = await fetchText(url, timeoutMs);
  return text ? JSON.parse(text) : null;
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      await fetchText(url, 5000);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function hasNode(payload, moduleName, actionName) {
  const nodes = payload?.nodes ?? payload;
  return Boolean(nodes?.[`${moduleName}.${actionName}`] || nodes?.[moduleName]?.[actionName]);
}

function cacheHasRepo(cache, repo) {
  const lower = repo.toLowerCase();
  return cache.some((item) => JSON.stringify(item).toLowerCase().includes(lower));
}

function localInputArtifact(role, value, workDir) {
  if (!value || /^https?:\/\//i.test(value)) {
    throw new Error(`${role} proof input must be a backend-readable local file so its bytes can be locked.`);
  }
  const absolutePath = path.isAbsolute(value) ? value : path.resolve(workDir, value);
  if (!fs.existsSync(absolutePath)) throw new Error(`${role} proof input does not exist: ${absolutePath}`);
  const bytes = fs.readFileSync(absolutePath);
  return {
    role,
    path: value.replaceAll('\\', '/'),
    contentHash: `sha256:bytes:${createHash('sha256').update(bytes).digest('hex')}`,
    byteSize: bytes.length,
  };
}

async function waitForTaskDone(page, timeoutMs, taskId, websocketEvents) {
  const started = Date.now();
  let lastStatusAt = 0;
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(() => window.__MODIFF_E2E__?.getState());
    const failure = state?.runIssues?.failure;
    const lastError = state?.studio?.lastError;
    const outputs = state?.studio?.outputs ?? [];
    const taskCount = state?.tasks?.taskCount ?? 0;
    const taskFailed = websocketEvents.find((event) => event?.type === 'task_failed' && event?.task_id === taskId);
    const taskCompleted = websocketEvents.find(
      (event) => event?.type === 'task_completed' && event?.task_id === taskId,
    );
    const graphCompleted = websocketEvents.find(
      (event) => event?.type === 'graph_completed' && event?.task_id === taskId,
    );
    const currentOutputs = outputs.filter((output) => output?.taskId === taskId);
    const elapsedMs = Date.now() - started;
    if (failure || lastError || taskFailed) {
      return { ok: false, state, elapsedMs, taskFailed };
    }
    if (isAttributedTaskComplete({ taskCompleted, graphCompleted, currentOutputCount: currentOutputs.length })) {
      return { ok: true, state, elapsedMs, currentOutputs: currentOutputs.length, taskCompleted, graphCompleted };
    }
    if (elapsedMs - lastStatusAt > 10_000) {
      lastStatusAt = elapsedMs;
      status('generation-running', {
        elapsedMs,
        taskId,
        taskCount,
        outputs: outputs.length,
        currentOutputs: currentOutputs.length,
      });
    }
    await page.waitForTimeout(2000);
  }
  return {
    ok: false,
    timeout: true,
    elapsedMs: Date.now() - started,
    state: await page.evaluate(() => window.__MODIFF_E2E__?.getState()),
  };
}

export function isAttributedTaskComplete({ taskCompleted, graphCompleted, currentOutputCount }) {
  return Boolean(taskCompleted && (graphCompleted || Number(currentOutputCount) > 0));
}

async function analyzeCurrentTaskOutputs(page, taskId) {
  return page.evaluate(
    async ({ taskId: currentTaskId, minNonBlackRatio: minimumNonBlackRatio }) => {
      const state = window.__MODIFF_E2E__?.getState();
      const outputs = (state?.studio?.outputs ?? []).filter((output) => output?.taskId === currentTaskId);
      const analyses = [];
      for (const output of outputs) {
        const url = output?.url ?? output?.value?.[0];
        if (!url) {
          analyses.push({ outputId: output?.id ?? null, ok: false, reason: 'missing_output_url' });
          continue;
        }
        const response = await fetch(url);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        const image = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        const decodedDigest = await crypto.subtle.digest('SHA-256', image);
        const decodedSha256 = Array.from(new Uint8Array(decodedDigest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
        let nonBlackPixels = 0;
        let sampledPixels = 0;
        let channelSum = 0;
        const pixelStride = Math.max(1, Math.floor((bitmap.width * bitmap.height) / 20000));
        for (let pixelIndex = 0; pixelIndex < bitmap.width * bitmap.height; pixelIndex += pixelStride) {
          const offset = pixelIndex * 4;
          const r = image[offset] ?? 0;
          const g = image[offset + 1] ?? 0;
          const b = image[offset + 2] ?? 0;
          channelSum += r + g + b;
          sampledPixels += 1;
          if (r > 8 || g > 8 || b > 8) {
            nonBlackPixels += 1;
          }
        }
        const nonBlackRatio = sampledPixels ? nonBlackPixels / sampledPixels : 0;
        analyses.push({
          outputId: output?.id ?? null,
          url,
          byteSize: blob.size,
          width: bitmap.width,
          height: bitmap.height,
          sampledPixels,
          nonBlackRatio,
          averageChannelValue: sampledPixels ? channelSum / (sampledPixels * 3) : 0,
          decodedSha256: `sha256:decoded-rgba:${decodedSha256}`,
          ok: nonBlackRatio >= minimumNonBlackRatio,
        });
      }
      return {
        ok: analyses.some((item) => item.ok),
        outputCount: outputs.length,
        minNonBlackRatio: minimumNonBlackRatio,
        analyses,
      };
    },
    { taskId, minNonBlackRatio },
  );
}

function cleanup() {
  for (const child of managed.reverse()) {
    try {
      if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        child.kill();
      }
    } catch {
      // Best-effort cleanup for proof-only child processes.
    }
  }
}

async function persistOutputArtifacts(outputAnalysis) {
  const outputDir = path.join(artifactRoot, 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const analyses = [];

  for (const [index, analysis] of outputAnalysis.analyses.entries()) {
    if (!analysis.url) {
      analyses.push(analysis);
      continue;
    }
    const outputUrl = new URL(analysis.url, frontendUrl);
    const response = await fetch(outputUrl);
    if (!response.ok) {
      analyses.push({ ...analysis, artifactError: `HTTP ${response.status} while saving ${outputUrl}` });
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const requestedFile = outputUrl.searchParams.get('file');
    const fileName = basename(requestedFile || `output-${index + 1}.bin`);
    const outputPath = path.join(outputDir, fileName);
    fs.writeFileSync(outputPath, bytes);
    analyses.push({
      ...analysis,
      artifactFile: path.relative(artifactRoot, outputPath),
      encodedSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  }

  return { ...outputAnalysis, analyses };
}

async function main() {
  const runtime = await loadTemplateRuntime(clientRoot);
  const requestedConfig = resolveLiveProofConfig();
  const template = runtime.templates.find((item) => item.id === requestedConfig.templateId);
  if (!template)
    throw new Error(`Live proof template ${requestedConfig.templateId} was not found in the runtime catalog.`);
  const supportedTemplate =
    (template.modelType === 'QwenImageModularPipeline' && ['text_to_image', 'control_image'].includes(template.mode)) ||
    (template.modelType === 'ZImageModularPipeline' && template.mode === 'text_to_image');
  if (!supportedTemplate) {
    throw new Error(
      `Live image proof supports Qwen text/control and Z-Image text-to-image templates; ${template.id} is ${template.modelType}/${template.mode}.`,
    );
  }
  if (template.mode === 'control_image' && !requestedConfig.exactInputs?.controlImage) {
    throw new Error('Control-image proof requires MODIFF_LIVE_PROOF_CONTROL_IMAGE with a backend-readable file path.');
  }
  const expectedLockedSettings = runtime.lockedSettingsForTemplate(template);
  proofConfig = {
    ...requestedConfig,
    expectedLockedSettings,
    expectedPromptSettingsHash: runtime.promptSettingsHash(template),
    expectedTemplateLockHash: runtime.templateLockHash(template),
  };
  writeJson('proof-config.json', {
    ...proofConfig,
    ...proofArtifactFields(proofConfig),
    createdAt: new Date().toISOString(),
  });
  status('starting-backend');
  let existingBackend = null;
  let managedBackendStarted = false;
  try {
    existingBackend = await fetchJson(`${backendUrl}/health`, 2500);
  } catch {
    // Start the managed backend below.
  }
  if (existingBackend?.ready !== true) {
    const python =
      process.platform === 'win32'
        ? path.join(backendRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(backendRoot, '.venv', 'bin', 'python');
    if (process.platform === 'win32') {
      start('backend', fs.existsSync(python) ? python : 'python', ['main.py'], backendRoot, {
        PYTORCH_CUDA_ALLOC_CONF: process.env.PYTORCH_CUDA_ALLOC_CONF || 'expandable_segments:True',
      });
    } else {
      start('backend', path.join(backendRoot, 'run.sh'), [], backendRoot);
    }
    managedBackendStarted = true;
  } else if (process.env.MODIFF_LIVE_BACKEND_REUSE !== '1') {
    throw new Error(
      `A backend is already running at ${backendUrl}. Stop it so the proof can start and pin its own process, ` +
        'or set MODIFF_LIVE_BACKEND_REUSE=1 for diagnostic-only reuse.',
    );
  }
  await waitForHttp(`${backendUrl}/nodes`, 120_000);

  status('checking-backend');
  const healthPayload = await fetchJson(`${backendUrl}/health`);
  writeJson('backend-health.json', healthPayload);
  let backendSourceBefore = null;
  let backendSourceBeforeError = null;
  try {
    backendSourceBefore = backendSourceIdentity(backendRoot);
  } catch (error) {
    backendSourceBeforeError = error instanceof Error ? error.message : String(error);
  }
  const backendSourcePreflight = backendSourceEvidence({
    before: backendSourceBefore,
    after: backendSourceBefore,
    runtimeFingerprint: { backendSource: healthPayload?.backend_source },
  });
  writeJson('backend-source-before.json', {
    managedBackendStarted,
    diagnosticReuse: !managedBackendStarted,
    identity: backendSourceBefore,
    workerAttestation: backendSourcePreflight.attestation,
    error: backendSourceBeforeError,
    blockers: backendSourcePreflight.blockers,
  });
  if (backendSourceBeforeError || backendSourcePreflight.blockers.length > 0) {
    throw new Error(
      `Backend source preflight failed before generation. Restart the backend after the final source edit: ${[
        ...(backendSourceBeforeError ? [backendSourceBeforeError] : []),
        ...backendSourcePreflight.blockers,
      ].join(' ')}`,
    );
  }
  const backendWorkDir = healthPayload?.server?.work_dir ?? path.join(backendRoot, 'data');
  const inputArtifacts = [];
  if (template.mode === 'control_image') {
    inputArtifacts.push(localInputArtifact('control_image', requestedConfig.exactInputs.controlImage, backendWorkDir));
  }
  writeJson('input-artifacts.json', { items: inputArtifacts });
  const nodesPayload = await fetchJson(`${backendUrl}/nodes`);
  writeJson('nodes-payload.json', nodesPayload);
  let provenanceNodesPayload = nodesPayload;
  const requiredNodes =
    template.modelType === 'QwenImageModularPipeline' && template.mode === 'text_to_image'
      ? [
          ['modules.DiffusersImage', 'LoadPipeline'],
          ['modules.DiffusersImage', 'Generate'],
        ]
      : template.mode === 'control_image'
        ? [
            ['modules.ModularDiffusers', 'ModelsLoader'],
            ['modules.ModularDiffusers', 'EncodePrompt'],
            ['modules.ModularDiffusers', 'Denoise'],
            ['modules.ModularDiffusers', 'DecodeLatents'],
            ['modules.ModularDiffusers', 'AutoModelLoader'],
            ['modules.ModularDiffusers', 'Controlnet'],
            ['modules.Image', 'Load'],
            ['modules.Image', 'Preview'],
          ]
        : [
            ['modules.ModularDiffusers', 'ModelsLoader'],
            ['modules.ModularDiffusers', 'EncodePrompt'],
            ['modules.ModularDiffusers', 'Denoise'],
            ['modules.ModularDiffusers', 'DecodeLatents'],
            ['modules.Image', 'Preview'],
          ];
  const missingNodes = requiredNodes.filter(
    ([moduleName, actionName]) => !hasNode(nodesPayload, moduleName, actionName),
  );
  if (missingNodes.length > 0) {
    throw new Error(`Missing backend nodes: ${missingNodes.map((item) => item.join('.')).join(', ')}`);
  }

  const cache = await fetchJson(`${backendUrl}/hf_cache?compact=1&refresh=1`, 60_000);
  writeJson('hf-cache.json', cache);
  const requiredBaseRepo =
    template.modelType === 'ZImageModularPipeline' ? 'Tongyi-MAI/Z-Image-Turbo' : 'Qwen/Qwen-Image-2512';
  if (!cacheHasRepo(cache, requiredBaseRepo)) {
    throw new Error(`${requiredBaseRepo} is not cached. Live proof did not start a large download.`);
  }
  if (template.mode === 'control_image' && !cacheHasRepo(cache, 'InstantX/Qwen-Image-ControlNet-Union')) {
    throw new Error('InstantX/Qwen-Image-ControlNet-Union is not cached. Live proof did not start a large download.');
  }

  status('starting-frontend');
  const reuseFrontend = process.env.MODIFF_LIVE_FRONTEND_REUSE === '1';
  if (reuseFrontend) {
    await fetchText(`${frontendUrl}/`, 2500);
  } else {
    if (process.platform === 'win32') {
      start(
        'frontend',
        'cmd.exe',
        ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`],
        clientRoot,
        {
          MODIFF_GALLERY_STABLE: '1',
          VITE_BACKEND_PROXY_TARGET: backendUrl,
        },
      );
    } else {
      start(
        'frontend',
        'npm',
        ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'],
        clientRoot,
        {
          MODIFF_GALLERY_STABLE: '1',
          VITE_BACKEND_PROXY_TARGET: backendUrl,
        },
      );
    }
  }
  await waitForHttp(`${frontendUrl}/`, 120_000);

  status('opening-browser');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleLines = [];
  const websocketEvents = [];
  page.on('console', (message) => {
    consoleLines.push(`[${message.type()}] ${message.text()}`);
  });
  page.on('websocket', (ws) => {
    ws.on('framereceived', (event) => {
      try {
        websocketEvents.push(JSON.parse(String(event.payload)));
      } catch {
        websocketEvents.push({ raw: String(event.payload) });
      }
    });
  });

  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState()?.websocket?.isConnected), null, {
    timeout: 30_000,
  });

  status('refreshing-model-indexes');
  await page.evaluate(async () => window.__MODIFF_E2E__.refreshModelIndexes());
  await page.waitForFunction(
    (repoId) => {
      const state = window.__MODIFF_E2E__?.getState();
      const cache = state?.nodes?.hfCache ?? [];
      return cache.some((item) => JSON.stringify(item).toLowerCase().includes(String(repoId).toLowerCase()));
    },
    'Qwen/Qwen-Image-2512',
    { timeout: 60_000 },
  );

  status('creating-qwen-auto-graph', { applyOverrides: proofConfig.applyOverrides });
  await page.evaluate(
    async ({ templateId, applyOverrides }) => {
      await window.__MODIFF_E2E__.applyTemplate(templateId, applyOverrides);
    },
    { templateId: proofConfig.templateId, applyOverrides: proofConfig.applyOverrides },
  );
  const graphState = await page.evaluate(() => window.__MODIFF_E2E__.getState());
  writeJson('graph-state-before-run.json', graphState);
  provenanceNodesPayload = await fetchJson(`${backendUrl}/nodes`);
  writeJson('nodes-payload-after-graph-finalization.json', provenanceNodesPayload);
  const appliedForm = graphState?.studio?.form ?? graphState?.form;
  const lockComparison = compareTemplateLock(appliedForm, expectedLockedSettings);
  const activeTemplateId = graphState?.studio?.activeTemplateId ?? graphState?.activeTemplateId ?? null;
  if (activeTemplateId !== proofConfig.templateId) {
    lockComparison.matches = false;
    lockComparison.mismatches.push({
      field: 'activeTemplateId',
      expected: proofConfig.templateId,
      actual: activeTemplateId,
    });
  }
  writeJson('template-lock-comparison.json', lockComparison);
  if (proofConfig.proofMode === 'template' && !lockComparison.matches) {
    proofConfig = {
      ...proofConfig,
      templateLockPreserved: false,
      exactnessStatus: 'non_exact',
      exactnessReason: `Applied form drifted from ${proofConfig.templateId} in ${lockComparison.mismatches.length} locked field(s).`,
    };
    writeJson('proof-config.json', {
      ...proofConfig,
      ...proofArtifactFields(proofConfig),
      updatedAt: new Date().toISOString(),
    });
    throw new Error(`Applied template lock mismatch: ${JSON.stringify(lockComparison.mismatches)}`);
  }
  await page.screenshot({ path: path.join(artifactRoot, 'qwen-auto-before-run.png'), fullPage: true });

  status('queueing-run');
  const runResult = await page.evaluate(async () => window.__MODIFF_E2E__.runActiveTemplate());
  writeJson('run-result.json', runResult);
  if (runResult?.response?.error) {
    throw new Error(runResult.response.message || 'Backend rejected the graph run.');
  }

  const taskId = runResult?.taskId ?? null;
  status('generation-running', { taskId });
  const done = await waitForTaskDone(page, generationTimeoutMs, taskId, websocketEvents);
  const finalState = await page.evaluate(() => window.__MODIFF_E2E__.getState());
  const outputAnalysis = await persistOutputArtifacts(await analyzeCurrentTaskOutputs(page, taskId));
  const executedOutput = (finalState?.studio?.outputs ?? []).find((output) => output?.taskId === taskId);
  const executionLockComparison = compareTemplateLock(executedOutput?.formSnapshot, expectedLockedSettings);
  for (const analysis of outputAnalysis.analyses) {
    if (analysis.width !== expectedLockedSettings.width) {
      executionLockComparison.matches = false;
      executionLockComparison.mismatches.push({
        field: 'output.width',
        expected: expectedLockedSettings.width,
        actual: analysis.width,
      });
    }
    if (analysis.height !== expectedLockedSettings.height) {
      executionLockComparison.matches = false;
      executionLockComparison.mismatches.push({
        field: 'output.height',
        expected: expectedLockedSettings.height,
        actual: analysis.height,
      });
    }
  }
  writeJson('execution-lock-comparison.json', executionLockComparison);
  if (proofConfig.proofMode === 'template' && !executionLockComparison.matches) {
    proofConfig = {
      ...proofConfig,
      templateLockPreserved: false,
      exactnessStatus: 'non_exact',
      exactnessReason: `Executed output drifted from ${proofConfig.templateId} in ${executionLockComparison.mismatches.length} locked field(s).`,
    };
    writeJson('proof-config.json', {
      ...proofConfig,
      ...proofArtifactFields(proofConfig),
      updatedAt: new Date().toISOString(),
    });
  }
  writeJson('final-state.json', finalState);
  writeJson('websocket-events.json', websocketEvents);
  writeJson('output-analysis.json', outputAnalysis);

  status('capturing-versioned-provenance', { taskId });
  const resolvedModelRepos = resolvedModelReposFromOutput(executedOutput);
  let modelFingerprintPayloads = [];
  let modelIdentities = [];
  let modelResolutionError = null;
  try {
    if (resolvedModelRepos.length === 0) {
      throw new Error('The executed API graph did not identify its resolved model repositories.');
    }
    modelFingerprintPayloads = await Promise.all(
      resolvedModelRepos.map(async (repo) => {
        const modelFingerprintUrl = new URL('/model_fingerprints', backendUrl);
        modelFingerprintUrl.searchParams.set('repo', repo);
        return { repo, payload: await fetchJson(modelFingerprintUrl.toString(), 60_000) };
      }),
    );
    modelIdentities = modelFingerprintPayloads.map(({ repo, payload }) => {
      const identity = selectInstalledModelIdentity(payload, repo);
      if (!identity) throw new Error(`The backend did not resolve an installed commit for ${repo}.`);
      return identity;
    });
  } catch (error) {
    modelResolutionError = error instanceof Error ? error.message : String(error);
  }
  writeJson('model-fingerprint.json', {
    resolvedModelRepos,
    modelIdentities,
    error: modelResolutionError,
    payloads: modelFingerprintPayloads,
  });

  const deterministicEvent = [...websocketEvents]
    .reverse()
    .find((event) => event?.type === 'deterministic_execution' && event?.task_id === taskId);
  const completionEvent = [...websocketEvents]
    .reverse()
    .find((event) => event?.type === 'graph_completed' && event?.task_id === taskId);
  const selectedRuntimeFingerprint = selectBackendRuntimeFingerprintEvidence(
    [
      completionEvent?.runtimeFingerprint,
      deterministicEvent?.runtimeFingerprint,
      executedOutput?.backendProvenance?.runtimeFingerprint,
      executedOutput?.provenance?.runtimeFingerprint,
    ],
    deterministicEvent?.deterministicMode ?? executedOutput?.apiGraphSnapshot?.deterministicMode,
  );
  let backendSourceAfter = null;
  let backendSourceAfterError = null;
  try {
    backendSourceAfter = backendSourceIdentity(backendRoot);
  } catch (error) {
    backendSourceAfterError = error instanceof Error ? error.message : String(error);
  }
  const backendSourceDrift = backendSourceDriftBlocker(backendSourceBefore, backendSourceAfter);
  const sourceEvidence = backendSourceEvidence({
    before: backendSourceBefore,
    after: backendSourceAfter,
    runtimeFingerprint: selectedRuntimeFingerprint,
  });
  writeJson('backend-source-after.json', {
    managedBackendStarted,
    diagnosticReuse: !managedBackendStarted,
    identity: backendSourceAfter,
    workerAttestation: sourceEvidence.attestation,
    error: backendSourceAfterError,
    driftBlocker: backendSourceDrift,
    blockers: sourceEvidence.blockers,
  });
  const resolvedModelSet = modelSetIdentity(modelIdentities);
  const resolvedTemplateLockHash =
    resolvedModelSet.count > 0 ? runtime.templateLockHash(template, resolvedModelSet.revisionLock) : null;
  const runProvenance = createRunProvenance({
    templateId: proofConfig.templateId,
    lockedSettings: expectedLockedSettings,
    promptSettingsHash: runtime.promptSettingsHash(template),
    catalogTemplateLockHash: runtime.templateLockHash(template),
    resolvedTemplateLockHash,
    apiGraph: executedOutput?.apiGraphSnapshot,
    nodesPayload: provenanceNodesPayload,
    modelIdentity: modelIdentities[0] ?? null,
    modelIdentities,
    inputArtifacts,
    runtimeFingerprint: selectedRuntimeFingerprint,
    deterministicMode: deterministicEvent?.deterministicMode ?? executedOutput?.apiGraphSnapshot?.deterministicMode,
    backendSource: sourceEvidence.identity,
    outputAnalysis,
    executedOutput,
    executionReceipt: completionEvent,
    taskId,
    expectedOutput: template.example?.expectedOutput,
  });
  if (modelResolutionError) runProvenance.blockers.push(`model resolution failed: ${modelResolutionError}`);
  if (backendSourceBeforeError) {
    runProvenance.blockers.push(`backend source capture failed before execution: ${backendSourceBeforeError}`);
  }
  if (backendSourceAfterError) {
    runProvenance.blockers.push(`backend source capture failed after execution: ${backendSourceAfterError}`);
  }
  runProvenance.blockers.push(...sourceEvidence.blockers);
  writeJson('run-provenance.json', runProvenance);

  let baselineProvenance = null;
  let provenanceComparison = null;
  let baselineError = null;
  try {
    baselineProvenance = readBaselineProvenance(baselineProvenanceInput);
    if (baselineProvenance) {
      provenanceComparison = compareRunProvenance(baselineProvenance.value, runProvenance);
      writeJson('duplicate-provenance-comparison.json', {
        baselinePath: baselineProvenance.path,
        ...provenanceComparison,
      });
      if (provenanceComparison.candidateExact) {
        proofConfig = {
          ...proofConfig,
          exactnessStatus: 'duplicate_verified',
          exactnessReason:
            'Two untouched runs match the versioned graph, template, model commit, stable runtime/backend, and decoded output locks. Gallery publication still requires its separate quality-review gate.',
        };
      }
    }
  } catch (error) {
    baselineError = error instanceof Error ? error.message : String(error);
    writeJson('duplicate-provenance-comparison.json', {
      baselinePath: baselineProvenanceInput || null,
      matches: false,
      candidateExact: false,
      error: baselineError,
    });
  }
  writeJson('proof-config.json', {
    ...proofConfig,
    ...proofArtifactFields(proofConfig),
    resolvedTemplateLockHash,
    provenanceBlockers: runProvenance.blockers,
    baselinePath: (baselineProvenance?.path ?? baselineProvenanceInput) || null,
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(path.join(artifactRoot, 'browser-console.log'), consoleLines.join('\n'), 'utf8');
  await page.screenshot({ path: path.join(artifactRoot, 'qwen-auto-after-run.png'), fullPage: true });
  await browser.close();

  const executionLockRequired = proofConfig.proofMode === 'template';
  const provenanceRequired = proofConfig.proofMode === 'template';
  const provenanceOk = !provenanceRequired || runProvenance.blockers.length === 0;
  const duplicateOk = !baselineProvenanceInput || Boolean(provenanceComparison?.candidateExact && !baselineError);
  const result = {
    ...proofArtifactFields(proofConfig),
    ok: Boolean(
      done.ok &&
      outputAnalysis.ok &&
      (!executionLockRequired || executionLockComparison.matches) &&
      provenanceOk &&
      duplicateOk,
    ),
    timeout: Boolean(done.timeout),
    elapsedMs: done.elapsedMs,
    outputs: finalState?.studio?.outputs?.length ?? 0,
    currentTaskOutputs: done.currentOutputs ?? 0,
    taskCompleted: Boolean(done.taskCompleted),
    graphCompleted: Boolean(done.graphCompleted),
    taskFailed: done.taskFailed ?? null,
    lastError: finalState?.studio?.lastError ?? null,
    failure: finalState?.runIssues?.failure ?? null,
    taskCount: finalState?.tasks?.taskCount ?? null,
    outputAnalysis,
    executionLockComparison,
    provenance: {
      proofLockHash: runProvenance.proofLockHash,
      graphHash: runProvenance.graphHash,
      runtimeFingerprint: runProvenance.runtimeFingerprint,
      backendSourceFingerprint: runProvenance.backendSourceFingerprint,
      backendContractFingerprint: runProvenance.backendContractFingerprint,
      modelRevision: runProvenance.modelRevision,
      modelCommit: runProvenance.modelCommit,
      modelSetHash: runProvenance.models?.hash ?? null,
      modelCount: runProvenance.models?.count ?? 0,
      inputArtifactsHash: runProvenance.inputArtifactsHash ?? null,
      templateLockHash: runProvenance.templateLockHash,
      templateRevisionHash: runProvenance.templateRevisionHash,
      mediaHash: runProvenance.mediaHash,
      width: runProvenance.width,
      height: runProvenance.height,
      blockers: runProvenance.blockers,
    },
    duplicateComparison: provenanceComparison,
    baselineError,
  };
  writeJson('proof-result.json', result);
  status(result.ok ? 'success' : 'failed', result);
  if (!done.ok) {
    throw new Error(`Live image proof failed: ${JSON.stringify(result)}`);
  }
  if (!outputAnalysis.ok) {
    throw new Error(`Live image proof produced no usable image: ${JSON.stringify(outputAnalysis)}`);
  }
  if (executionLockRequired && !executionLockComparison.matches) {
    throw new Error(`Executed template lock mismatch: ${JSON.stringify(executionLockComparison.mismatches)}`);
  }
  if (provenanceRequired && !provenanceOk) {
    throw new Error(`Live image proof provenance is incomplete: ${JSON.stringify(runProvenance.blockers)}`);
  }
  if (!duplicateOk) {
    throw new Error(
      `Live image duplicate provenance did not match the baseline: ${JSON.stringify(
        provenanceComparison?.mismatches ?? baselineError,
      )}`,
    );
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMainModule) {
  if (process.argv.includes('--help')) {
    console.log(`Run a real MoDiff image proof using environment variables.

MODIFF_LIVE_PROOF_TEMPLATE_ID   Qwen/Z-Image template id
MODIFF_LIVE_PROOF_MODE          template (default) or smoke
MODIFF_LIVE_PROOF_ARTIFACT      output directory
MODIFF_LIVE_PROOF_BASELINE      optional v2 provenance used for duplicate proof
MODIFF_LIVE_GENERATION_TIMEOUT_MS
MODIFF_LIVE_FRONTEND_PORT       dedicated stable frontend port (default 5193)
MODIFF_LIVE_FRONTEND_REUSE=1    explicitly reuse an already-running stable frontend
MODIFF_LIVE_BACKEND_REUSE=1     reuse a backend for diagnostics; reused processes cannot qualify

Template mode preserves locked settings. Smoke mode requires explicit
MODIFF_LIVE_PROOF_* generation overrides and never counts as exact proof.`);
    process.exit(0);
  }
  fs.mkdirSync(artifactRoot, { recursive: true });
  process.on('SIGINT', () => {
    status('interrupted');
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    status('terminated');
    cleanup();
    process.exit(143);
  });

  main()
    .catch((error) => {
      writeJson('proof-error.json', {
        error: String(error),
        stack: error?.stack ?? null,
        artifactRoot,
        requestedProofMode: process.env.MODIFF_LIVE_PROOF_MODE ?? 'template',
        ...proofArtifactFields(proofConfig),
        at: new Date().toISOString(),
      });
      status('error', { error: String(error) });
      process.exitCode = 1;
    })
    .finally(() => {
      cleanup();
    });
}
