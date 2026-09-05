#!/usr/bin/env node
/**
 * Batch-generate review assets through the running app.
 *
 * Public templates keep their locked campaign briefs. Hidden skeletons overlay
 * original MoDiff campaign briefs and Auto. Raw outputs land in
 * review-pending/raw-campaign/ and are not human-review candidates. A separate
 * quality screen must explicitly shortlist an output. Nothing is
 * Gallery-registered.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  acquireRunnerLock,
  ensureFrontend,
  installEphemeralGalleryStorage,
  prepareRuntimeForTemplate,
  waitForTaskTerminal,
  requireAppDownloadsIdle,
} from './template-gallery-runner.mjs';
import { classifyCampaignFailure, writeRetryLedger } from './generation-campaign-retry-ledger.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const SERVER = process.env.MODIFF_GALLERY_SERVER || 'http://127.0.0.1:8088';
const PENDING_ROOT = join(BACKEND_ROOT, 'review-pending');
const RAW_ROOT = join(PENDING_ROOT, 'raw-campaign');
const RESEARCH_ROOT = join(PENDING_ROOT, 'research');
const CAMPAIGN_LOCK_PATH = join(PENDING_ROOT, '.campaign-runner.lock');
const CAMPAIGN_REPORT_PATH = join(PENDING_ROOT, 'generation-campaign-report.v1.json');
const CAMPAIGN_RETRY_PATH = join(PENDING_ROOT, 'generation-campaign-retry-ledger.v1.json');
const FIXTURE_KIT = join(PENDING_ROOT, 'input-fixtures', 'kit');
const PYTHON = join(BACKEND_ROOT, '.venv', 'bin', 'python');

const CAMPAIGN_USAGE = `Usage: node scripts/review-generation-campaign.mjs [options]

Options:
  --only <text[,text]>    Run only matching workflow IDs, template IDs, or model types
  --mode <mode[,mode]>    Run only matching modes
  --max <count>           Limit all processed workflows, including existing outputs
  --max-new <count>       Limit new attempts
  --retry-failed          Deprecated; failed workflows are retried by default
  --help                  Print this help without starting the app or campaign`;

const CAMPAIGN_EXTENSION_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/flac': '.flac',
  'application/json': '.json',
  'text/plain': '.txt',
};

const CAMPAIGN_EXTENSION_BY_TYPE = {
  image: '.png',
  image_collection: '.png',
  video: '.mp4',
  audio: '.wav',
  json: '.json',
  string: '.txt',
  text: '.txt',
};

const FIXTURE_FIELDS = {
  referenceImages: ['still_life.png', 'tram_stop.png'],
  controlImage: ['control_lines.png'],
  maskImage: ['mask.png'],
  lastImage: ['tram_stop.png'],
  sourceVideo: ['motion.mp4'],
  controlVideo: ['control_motion.mp4'],
  referenceVideos: ['motion.mp4', 'tram_motion.mp4'],
  poseVideo: ['pose_motion.mp4'],
  faceVideo: ['face_motion.mp4'],
  backgroundVideo: ['background_motion.mp4'],
  maskVideo: ['mask_motion.mp4'],
  sourceAudio: ['tone_a.wav'],
  referenceAudio: ['tone_b.wav'],
};

const WORKFLOW_AUDIO_FIXTURES = {
  'AceStepAudioPipeline:audio_continuation': {
    sourceAudio: join(BACKEND_ROOT, 'web', 'template-gallery', 'ace_step_text_to_audio.current.wav'),
  },
  'AceStepAudioPipeline:audio_repaint': {
    sourceAudio: join(BACKEND_ROOT, 'web', 'template-gallery', 'ace_step_text_to_audio.current.wav'),
  },
  'AceStepAudioPipeline:audio_variation': {
    sourceAudio: join(BACKEND_ROOT, 'web', 'template-gallery', 'ace_step_text_to_audio.current.wav'),
  },
};

const WORKFLOW_IMAGE_FIXTURES = {
  'HuggingFaceImageTextToTextModel:image_to_text': {
    referenceImages: join(
      PENDING_ROOT,
      'AuraFlowPipeline__text_to_image',
      'campaign-auraflowpipeline__text_to_image-gpu-v1.png',
    ),
  },
  'JoyImageEditPipeline:edit_image': {
    referenceImages: join(
      PENDING_ROOT,
      'JoyImageEditPipeline__text_to_image',
      'campaign-joyimageeditpipeline__text_to_image-gpu-v1.webp',
    ),
  },
  'OmniGenPipeline:multi_image_reference_edit': {
    referenceImages: [
      join(
        PENDING_ROOT,
        'QwenImageModularPipeline__text_to_image',
        'campaign-qwenimagemodularpipeline__text_to_image-gpu-v1.png',
      ),
      join(
        PENDING_ROOT,
        'FluxSchnellPipeline__text_to_image__gguf_q4_0',
        'campaign-fluxschnellpipeline__text_to_image__gguf_q4_0-gpu-v1.webp',
      ),
    ],
  },
  'OmniGenPipeline:edit_image': {
    referenceImages: join(
      PENDING_ROOT,
      'LongCatImagePipeline__text_to_image',
      'campaign-longcatimagepipeline__text_to_image-gpu-v1.png',
    ),
  },
  'LongCatImageEditPipeline:edit_image': {
    referenceImages: join(
      PENDING_ROOT,
      'LongCatImagePipeline__text_to_image',
      'campaign-longcatimagepipeline__text_to_image-gpu-v1.png',
    ),
  },
  'SanaSprintPipeline:edit_image': {
    referenceImages: join(
      PENDING_ROOT,
      'AuraFlowPipeline__text_to_image',
      'campaign-auraflowpipeline__text_to_image-gpu-v1.png',
    ),
  },
  'StableDiffusionXLInstructPix2PixPipeline:edit_image': {
    referenceImages: join(
      PENDING_ROOT,
      'ErnieImagePipeline__text_to_image',
      'campaign-ernieimagepipeline__text_to_image-gpu-v1.png',
    ),
  },
  'SpandrelImageUpscale:image_upscale': {
    referenceImages: join(PENDING_ROOT, 'input-fixtures', 'upscaling', 'aura-rain-stop-lowres-q72.jpg'),
  },
};

const WORKFLOW_VIDEO_FIXTURES = {
  'SpandrelVideoUpscale:video_upscale': {
    sourceVideo: join(PENDING_ROOT, 'input-fixtures', 'upscaling', 'sana-greenhouse-motion-lowres.mp4'),
  },
};

function loadBriefs() {
  const result = spawnSync(
    PYTHON,
    [
      '-c',
      'import json; from modiff.generation_campaign_briefs import campaign_document, form_overrides_for, is_builtin_model; ' +
        'print(json.dumps({"document": campaign_document()}))',
    ],
    { cwd: BACKEND_ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Could not load campaign briefs.');
  }
  return JSON.parse(result.stdout);
}

function loadOverrides(workflowId, mode, modelType) {
  const result = spawnSync(
    PYTHON,
    [
      '-c',
      'import json, sys; from modiff.generation_campaign_briefs import form_overrides_for; ' +
        'print(json.dumps(form_overrides_for(sys.argv[1], sys.argv[2], sys.argv[3])))',
      workflowId,
      mode,
      modelType,
    ],
    { cwd: BACKEND_ROOT, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Could not build overrides for ${workflowId}.`);
  }
  return JSON.parse(result.stdout);
}

function workflowIdForSkeleton(skeleton) {
  return `${skeleton.modelType}:${skeleton.mode}`;
}

export function fixtureOverrides(workflowId, requiredMedia) {
  const overrides = {};
  for (const item of requiredMedia || []) {
    const reviewedAudioPath = WORKFLOW_AUDIO_FIXTURES[workflowId]?.[item.field];
    const reviewedImagePath = WORKFLOW_IMAGE_FIXTURES[workflowId]?.[item.field];
    const reviewedVideoPath = WORKFLOW_VIDEO_FIXTURES[workflowId]?.[item.field];
    if (reviewedVideoPath) {
      if (!existsSync(reviewedVideoPath)) {
        throw new Error(`${workflowId} requires the reviewed workflow-specific ${item.field} fixture.`);
      }
      overrides[item.field] = item.field.endsWith('s') ? [reviewedVideoPath] : reviewedVideoPath;
      continue;
    }
    if (reviewedImagePath) {
      const reviewedImagePaths = Array.isArray(reviewedImagePath) ? reviewedImagePath : [reviewedImagePath];
      if (
        reviewedImagePaths.length < (item.minimumCount || 1) ||
        reviewedImagePaths.some((path) => !existsSync(path))
      ) {
        throw new Error(`${workflowId} requires the reviewed workflow-specific ${item.field} fixture.`);
      }
      overrides[item.field] = item.field.endsWith('s') ? reviewedImagePaths : reviewedImagePaths[0];
      continue;
    }
    if (item.field === 'sourceAudio' || item.field === 'referenceAudio') {
      if (!reviewedAudioPath || !existsSync(reviewedAudioPath)) {
        throw new Error(
          `${workflowId} requires a reviewed workflow-specific ${item.field} fixture; ` +
            'the two-second synthetic campaign tones are technical canaries and cannot be used for showcase generation.',
        );
      }
      overrides[item.field] = reviewedAudioPath;
      continue;
    }
    const files = FIXTURE_FIELDS[item.field];
    if (!files) continue;
    const paths = files.slice(0, item.minimumCount || 1).map((name) => join(FIXTURE_KIT, name));
    overrides[item.field] = item.field.endsWith('s') ? paths : paths[0];
  }
  return overrides;
}

async function fetchJson(path) {
  const response = await fetch(new URL(path, SERVER), { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

function installedRepos(localModels) {
  const repos = new Set();
  for (const item of localModels || []) {
    const repo = item?.id || item?.repo_id || item?.repo || item?.name;
    if (typeof repo === 'string' && repo.includes('/')) repos.add(repo);
    const snapshot = item?.snapshot_id || item?.snapshot;
    if (typeof snapshot === 'string' && snapshot.includes('/')) repos.add(snapshot.split('@')[0]);
  }
  return repos;
}

export function qualityBlockedWorkflowsFromResearch(documents) {
  const blocked = new Set();
  for (const document of documents || []) {
    if (
      document?.kind === 'generation_recipe_research' &&
      typeof document.workflowId === 'string' &&
      typeof document.status === 'string' &&
      document.status.startsWith('quality_blocked')
    ) {
      blocked.add(document.workflowId);
    }
  }
  return blocked;
}

function loadQualityBlockedWorkflows() {
  if (!existsSync(RESEARCH_ROOT)) return new Set();
  const documents = [];
  for (const name of readdirSync(RESEARCH_ROOT).sort()) {
    if (!name.endsWith('.json')) continue;
    const path = join(RESEARCH_ROOT, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    documents.push(JSON.parse(readFileSync(path, 'utf8')));
  }
  return qualityBlockedWorkflowsFromResearch(documents);
}

export function extensionForCampaignOutput(output, absoluteUrl, contentType) {
  const normalizedContentType = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const mimeExtension = CAMPAIGN_EXTENSION_BY_MIME[normalizedContentType];
  if (mimeExtension) return mimeExtension;

  const parsedUrl = new URL(absoluteUrl);
  if (['http:', 'https:', 'file:'].includes(parsedUrl.protocol)) {
    const urlExtension = extname(parsedUrl.pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,10}$/.test(urlExtension)) return urlExtension;
  }

  const displayType = String(output?.displayType || output?.mediaKind || '');
  return CAMPAIGN_EXTENSION_BY_TYPE[displayType] || '.bin';
}

export function isCampaignImagePayload(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return false;
  const ascii = (start, end) => buffer.subarray(start, end).toString('ascii');
  return (
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    ascii(0, 6) === 'GIF87a' ||
    ascii(0, 6) === 'GIF89a' ||
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
  );
}

export async function copyOutput(page, run, frontendUrl, destination, mediaKind, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const outputWaitMs = options.outputWaitMs ?? 20_000;
  const server = options.server || SERVER;
  const deadline = Date.now() + outputWaitMs;
  let output = null;
  const wantImage =
    /image/i.test(String(mediaKind || '')) ||
    /text_to_image|edit_image|inpaint|outpaint|control/i.test(String(destination));
  while (Date.now() < deadline) {
    output = await page.evaluate(
      ({ taskId, startedAt, wantImage: preferImage }) => {
        const outputs = window.__MODIFF_E2E__?.getState()?.studio?.outputs ?? [];
        const matches = outputs.filter((item) => {
          if (!item?.url) return false;
          if (item.taskId === taskId || item.task_id === taskId) return true;
          return Number(item.createdAt ?? 0) >= startedAt;
        });
        const isImage = (item) => {
          const type = String(item.displayType || item.mediaKind || '');
          const url = String(item.url || '');
          return /image|png|jpe?g|webp/i.test(`${type} ${url}`);
        };
        if (preferImage) {
          const images = matches.filter(isImage);
          if (images.length) return images.at(-1);
          return null;
        }
        return matches.at(-1) ?? null;
      },
      { taskId: run.taskId, startedAt: run.startedAt, wantImage },
    );
    if (output?.url) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!output?.url) {
    const receiptResponse = await fetchImpl(new URL(`/runs/${encodeURIComponent(run.taskId)}`, server));
    if (receiptResponse.ok) {
      const receipt = await receiptResponse.json();
      const outputs = Array.isArray(receipt?.outputs)
        ? receipt.outputs
        : Array.isArray(receipt?.run?.outputs)
          ? receipt.run.outputs
          : [];
      const matches = outputs.filter(
        (item) => item?.url && (item.taskId === run.taskId || item.task_id === run.taskId),
      );
      if (wantImage) {
        output = matches.filter((item) => /image/i.test(String(item.displayType || item.mediaKind || ''))).at(-1);
      } else {
        output = matches.at(-1);
      }
    }
  }
  if (!output?.url) throw new Error(`No studio output URL for task ${run.taskId}.`);
  const absoluteUrl = new URL(output.url, frontendUrl).toString();
  const response = await fetchImpl(absoluteUrl);
  if (!response.ok) throw new Error(`Could not fetch output ${absoluteUrl}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (wantImage && !isCampaignImagePayload(buffer)) {
    throw new Error(
      `Studio output for task ${run.taskId} was not a recognized campaign image (${buffer.length} bytes).`,
    );
  }
  const extension = extensionForCampaignOutput(output, absoluteUrl, response.headers.get('content-type'));
  writeFileSync(destination + extension, buffer);
  return destination + extension;
}

export function destinationStem(workflowId) {
  const slug = workflowId.replace(/:/g, '__');
  return join(RAW_ROOT, slug, `campaign-${slug.toLowerCase()}-gpu-v1`);
}

function existingOutput(workflowId) {
  const stem = destinationStem(workflowId);
  for (const extension of [
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.mp4',
    '.webm',
    '.wav',
    '.mp3',
    '.flac',
    '.json',
    '.glb',
  ]) {
    const candidate = stem + extension;
    if (existsSync(candidate) && statSync(candidate).isFile() && statSync(candidate).size > 0) {
      return candidate;
    }
  }
  return null;
}

function isRecoverableBrowserError(message) {
  return /Target page, context or browser has been closed|Target crashed|Page crashed|browser has been closed/i.test(
    message,
  );
}

function loadPreviousResults() {
  if (!existsSync(CAMPAIGN_REPORT_PATH)) return [];
  try {
    const payload = JSON.parse(readFileSync(CAMPAIGN_REPORT_PATH, 'utf8'));
    return Array.isArray(payload?.results) ? payload.results : [];
  } catch {
    return [];
  }
}

function mergeResults(previous, next) {
  const byWorkflow = new Map(previous.map((item) => [item.workflowId, item]));
  for (const item of next) {
    byWorkflow.set(item.workflowId, item);
  }
  return [...byWorkflow.values()].sort((left, right) => left.workflowId.localeCompare(right.workflowId));
}

function writeReport(results) {
  const merged = mergeResults(loadPreviousResults(), results);
  const completed = merged.filter((item) => item.status === 'completed').length;
  writeFileSync(
    CAMPAIGN_REPORT_PATH,
    `${JSON.stringify({ server: SERVER, completed, total: merged.length, results: merged }, null, 2)}\n`,
  );
  writeRetryLedger(CAMPAIGN_REPORT_PATH, CAMPAIGN_RETRY_PATH);
  return CAMPAIGN_REPORT_PATH;
}

const CAMPAIGN_RETRY_PRIORITY = {
  graph_client_lifecycle: 0,
  dependency: 1,
  runtime: 2,
  output_integrity: 3,
  backend_action: 4,
  artifact: 6,
  unclassified: 7,
};

export function orderCampaignTargetsForRetry(targets, previousResults) {
  const failures = new Map(
    previousResults
      .filter((item) => item?.status === 'failed' && typeof item.workflowId === 'string')
      .map((item) => [item.workflowId, classifyCampaignFailure(item.error).category]),
  );
  return targets
    .map((target, index) => {
      const category = failures.get(workflowIdForSkeleton(target));
      const priority = category === undefined ? 5 : CAMPAIGN_RETRY_PRIORITY[category];
      return { target, index, priority };
    })
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ target }) => target);
}

export function parseCampaignArgs(argv = process.argv.slice(2)) {
  const modes = [];
  const only = [];
  let maxJobs = Number.POSITIVE_INFINITY;
  let maxNewJobs = Number.POSITIVE_INFINITY;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--mode' || option === '--only') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
      const target = option === '--mode' ? modes : only;
      target.push(
        ...String(value)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );
      index += 1;
    } else if (option === '--max' || option === '--max-new') {
      const value = Number(argv[index + 1]);
      if (!Number.isFinite(value) || value < 0) throw new Error(`${option} requires a non-negative number.`);
      if (option === '--max') maxJobs = value;
      else maxNewJobs = value;
      index += 1;
    } else if (option === '--retry-failed') {
      console.warn('--retry-failed is now the default; failed workflows are never skipped.');
    } else if (option === '--help') {
      help = true;
    } else {
      throw new Error(`Unknown campaign option: ${option}`);
    }
  }
  return { help, maxJobs, maxNewJobs, modes, only };
}

export function isCampaignSkeletonRunnable(skeleton, { modes = [], only = [] } = {}) {
  const workflowId = workflowIdForSkeleton(skeleton);
  if (modes.length > 0 && !modes.includes(skeleton.mode)) return false;
  if (only.length > 0) {
    const haystack = `${workflowId} ${skeleton.id} ${skeleton.modelType}`.toLowerCase();
    if (!only.some((needle) => haystack.includes(needle.toLowerCase()))) return false;
  }
  // Built-ins stay out of broad model-generation campaigns, but an exact
  // --only selection may opt into their cheap, deterministic qualification.
  if (String(skeleton.modelType || '').startsWith('Builtin') && only.length === 0) return false;
  return true;
}

function buildOverrides(skeleton, { expertFallback = false, capability } = {}) {
  const workflowId = workflowIdForSkeleton(skeleton);
  const overrides = {
    ...loadOverrides(workflowId, skeleton.mode, skeleton.modelType),
    ...fixtureOverrides(workflowId, skeleton.requiredMedia),
    resourceMode: expertFallback ? 'expert' : 'auto',
  };
  if (skeleton.galleryVisible) {
    delete overrides.prompt;
    delete overrides.negativePrompt;
  }
  if (expertFallback) {
    Object.assign(overrides, expertFallbackResourceOverrides(capability));
  }
  return overrides;
}

export function expertFallbackResourceOverrides(capability) {
  const modes = capability?.offloadSupport?.modes;
  const supportsOffload = !Array.isArray(modes) || modes.some((mode) => mode !== 'none');
  return {
    device: 'cuda:0',
    autoOffload: supportsOffload,
    ...(supportsOffload ? {} : { offloadMode: 'none' }),
  };
}

function usesAuto(skeleton, capability) {
  if (!capability) return Boolean(skeleton.galleryVisible);
  if (capability.executionStatus === 'expert_only') return false;
  if (capability.autoEligible === false) return false;
  return Boolean(skeleton.galleryVisible) || capability.autoEligible === true;
}

async function waitForGraphReady(page) {
  await page.waitForFunction(
    () => {
      const status = window.__MODIFF_E2E__?.getState()?.studio?.graphFinalization?.status;
      return status === 'complete' || status === 'error';
    },
    null,
    { timeout: 120_000 },
  );
  const status = await page.evaluate(
    () => window.__MODIFF_E2E__?.getState()?.studio?.graphFinalization?.status ?? null,
  );
  if (status !== 'complete') {
    const message = await page.evaluate(
      () => window.__MODIFF_E2E__?.getState()?.studio?.graphFinalization?.message ?? 'Graph preparation failed.',
    );
    throw new Error(message);
  }
}

async function applySkeleton(page, skeleton, overrides) {
  const payload = {
    templateId: skeleton.templateId || skeleton.id,
    formOverrides: overrides,
    usePublicTemplate: Boolean(skeleton.templateId),
  };
  try {
    await page.evaluate(
      ({ templateId, formOverrides, usePublicTemplate }) =>
        usePublicTemplate
          ? window.__MODIFF_E2E__?.applyTemplate(templateId, formOverrides)
          : window.__MODIFF_E2E__?.applyTaskTemplateSkeleton(templateId, formOverrides),
      payload,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Graph preparation is still running/i.test(message)) throw error;
  }
  await waitForGraphReady(page);
}

function isAutoAdmissionError(message) {
  return /Auto could not|No Auto recipe|Expert configuration|manual_only|Expert only|could not admit/i.test(message);
}

async function runSkeleton(page, skeleton, args, results, capability) {
  const workflowId = workflowIdForSkeleton(skeleton);
  const existing = existingOutput(workflowId);
  if (existing) {
    results.push({
      workflowId,
      skeletonId: skeleton.id,
      filePath: existing,
      status: 'completed',
      skippedExisting: true,
    });
    console.log(`skipped existing ${workflowId}`);
    return;
  }
  const preferAuto = usesAuto(skeleton, capability);
  await applySkeleton(page, skeleton, buildOverrides(skeleton, { expertFallback: !preferAuto, capability }));
  let run;
  const queueRun = async () => page.evaluate(() => window.__MODIFF_E2E__?.runActiveTemplate());
  try {
    run = await queueRun();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let snapshot = null;
    if (/optional runtime|unavailable|Graph changed/i.test(message)) {
      snapshot = await page.evaluate(() => {
        const state = window.__MODIFF_E2E__?.getState();
        const catalog = state?.nodes?.optionalRuntimeCatalog;
        return {
          lastError: state?.studio?.lastError,
          resourceMode: state?.studio?.form?.resourceMode,
          modelType: state?.studio?.form?.modelType,
          processLoadStatus: catalog?.processLoadStatus,
          profiles: (catalog?.profiles || []).map((profile) => ({
            id: profile.id,
            overlayStatus: profile.overlayStatus,
            contractState: profile.contractState,
            cutoverReady: profile.cutoverReady,
            status: profile.status,
          })),
          discovery: state?.nodes?.discoveryRequests,
        };
      });
      console.warn(`run snapshot ${workflowId}: ${JSON.stringify(snapshot)}`);
    }
    if (/Graph changed/i.test(message)) {
      run = await queueRun();
    } else if (!preferAuto || !isAutoAdmissionError(message)) {
      throw error;
    } else {
      console.warn(`Auto unavailable for ${workflowId}; falling back to expert cuda:0 + offload`);
      await applySkeleton(page, skeleton, buildOverrides(skeleton, { expertFallback: true, capability }));
      run = await queueRun();
    }
  }
  if (!run || run.response?.error) {
    const message = run?.response?.message || `Could not queue ${workflowId}.`;
    if (preferAuto && isAutoAdmissionError(message)) {
      console.warn(`Auto unavailable for ${workflowId}; falling back to expert cuda:0 + offload`);
      await applySkeleton(page, skeleton, buildOverrides(skeleton, { expertFallback: true, capability }));
      run = await page.evaluate(() => window.__MODIFF_E2E__?.runActiveTemplate());
    }
  }
  if (!run || run.response?.error) {
    throw new Error(run?.response?.message || `Could not queue ${workflowId}.`);
  }
  await waitForTaskTerminal(page, {
    taskId: run.taskId,
    server: args.server,
    timeoutMs: args.timeoutMs,
  });
  mkdirSync(join(RAW_ROOT, workflowId.replace(/:/g, '__')), { recursive: true });
  const filePath = await copyOutput(
    page,
    run,
    args.frontendUrl,
    destinationStem(workflowId),
    skeleton.mediaKind || skeleton.mode,
  );
  results.push({
    workflowId,
    skeletonId: skeleton.id,
    taskId: run.taskId,
    filePath,
    status: 'completed',
    resourceMode: preferAuto ? 'auto' : 'expert',
  });
}

async function waitForBackend(server, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/health', server), { signal: AbortSignal.timeout(30_000) });
      if (response.ok) return;
    } catch {
      // Backend may be busy loading a model and unable to serve HTTP yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Backend at ${server} did not become healthy within ${timeoutMs}ms.`);
}

async function main() {
  const { help, maxJobs, maxNewJobs, modes, only } = parseCampaignArgs();
  if (help) {
    console.log(CAMPAIGN_USAGE);
    return;
  }
  const args = {
    server: SERVER,
    port: Number(process.env.MODIFF_GALLERY_FRONTEND_PORT || 5192),
    frontendUrl: `http://127.0.0.1:${Number(process.env.MODIFF_GALLERY_FRONTEND_PORT || 5192)}`,
    timeoutMs: 3 * 60 * 60 * 1000,
    queueWaitTimeoutMs: 3 * 60 * 60 * 1000,
    noStart: false,
    noBackendStart: true,
    headless: true,
  };
  loadBriefs();
  const qualityBlockedWorkflows = loadQualityBlockedWorkflows();
  const health = await fetchJson('/health');
  const backend = health?.runtime_profile?.device_validation?.backend || health?.runtime_profile?.smoke?.backend;
  if (backend && backend !== 'rocm' && backend !== 'cuda') {
    console.warn(`Runtime backend is ${backend}; Auto will not use the Radeon until the AMD profile is active.`);
  }
  const localModels = await fetchJson('/local_models');
  const capabilities = ((await fetchJson('/model_capabilities')).capabilities || []).reduce((map, item) => {
    if (item?.modelType) map.set(item.modelType, item);
    return map;
  }, new Map());
  const repos = installedRepos(localModels);
  const managedProcesses = [];
  const frontend = await ensureFrontend(args, managedProcesses);
  args.frontendUrl = frontend.url;
  const results = [];
  const browser = await chromium.launch({
    headless: args.headless,
    args: ['--disable-dev-shm-usage'],
  });
  try {
    let page = await browser.newPage();
    await installEphemeralGalleryStorage(page);
    await page.goto(frontend.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState()?.websocket?.isConnected), null, {
      timeout: 180_000,
    });
    let skeletons = [];
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const count = await page.evaluate(async () => (await window.__MODIFF_E2E__?.refreshTaskTemplateContracts()) ?? 0);
      skeletons = await page.evaluate(() => window.__MODIFF_E2E__?.listTaskTemplateSkeletons() ?? []);
      if (skeletons.length > 0) break;
      console.warn(`task-template refresh attempt ${attempt} returned ${count} contracts`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (skeletons.length === 0) {
      const templates = await page.evaluate(() => window.__MODIFF_E2E__?.listTemplates(true) ?? []);
      console.warn(`falling back to ${templates.length} Studio templates including blocked planning cards`);
      skeletons = templates.map((item) => ({
        id: item.id,
        modelType: item.modelType,
        mode: item.mode,
        mediaKind: item.mediaType,
        requiredMedia: [],
        galleryVisible: item.exampleStatus !== 'blocked',
        templateId: item.id,
      }));
    }
    await page.evaluate(() => window.__MODIFF_E2E__?.refreshModelIndexes?.(false));
    console.log(`loaded ${skeletons.length} generation targets`);
    const selected = skeletons.filter((item) => isCampaignSkeletonRunnable(item, { modes, only }));
    const blockedSelected = selected.filter((item) => qualityBlockedWorkflows.has(workflowIdForSkeleton(item)));
    for (const item of blockedSelected) {
      console.warn(`quality-blocked by reviewed research dossier: ${workflowIdForSkeleton(item)}`);
    }
    const runnable = selected.filter((item) => !qualityBlockedWorkflows.has(workflowIdForSkeleton(item)));
    const textFirst = [
      ...runnable.filter((item) => item.mode === 'text_to_image'),
      ...runnable.filter((item) => item.mode === 'text_to_video'),
      ...runnable.filter((item) => item.mode === 'text_to_audio'),
      ...runnable.filter((item) => !['text_to_image', 'text_to_video', 'text_to_audio'].includes(item.mode)),
    ];
    const attemptOrder = orderCampaignTargetsForRetry(textFirst, loadPreviousResults());
    async function preparePage(forceReload = false) {
      if (forceReload) {
        await page.goto(args.frontendUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
        await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState()?.websocket?.isConnected), null, {
          timeout: 180_000,
        });
        await page.evaluate(async () => {
          await window.__MODIFF_E2E__?.refreshTaskTemplateContracts();
          await window.__MODIFF_E2E__?.refreshModelIndexes?.(false);
        });
      }
      const discoveryReady = (snapshot) => {
        // Discovery only needs the authoritative catalog. Exact overlay
        // admission is workflow-specific and belongs to runActiveTemplate.
        return Boolean(
          snapshot?.hfCacheCount > 0 &&
          snapshot?.capabilitiesStatus === 'success' &&
          snapshot?.optionalRuntimesStatus === 'success',
        );
      };
      let indexSnapshot = null;
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        indexSnapshot = await page.evaluate(() => window.__MODIFF_E2E__?.inspectDiscovery?.() ?? null);
        if (discoveryReady(indexSnapshot)) break;
        console.warn(`discovery attempt ${attempt}: ${JSON.stringify(indexSnapshot)}`);
        await page.evaluate(async () => {
          await window.__MODIFF_E2E__?.refreshModelIndexes?.(false);
        });
      }
      if (!discoveryReady(indexSnapshot) && !forceReload) {
        console.warn('discovery empty; reloading Studio page');
        return preparePage(true);
      }
      console.log(`indexes ${JSON.stringify(indexSnapshot)}`);
      return indexSnapshot;
    }

    async function replacePage(reason) {
      console.warn(`replacing Studio page (${reason})`);
      await waitForBackend(args.server);
      try {
        await page.close();
      } catch {
        // The previous page may already be dead.
      }
      page = await browser.newPage();
      await installEphemeralGalleryStorage(page);
      await preparePage(true);
    }

    await preparePage(false);
    let attemptedNewJobs = 0;
    let processedJobs = 0;
    for (const skeleton of attemptOrder) {
      if (Number.isFinite(maxJobs) && processedJobs >= maxJobs) break;
      if (Number.isFinite(maxNewJobs) && attemptedNewJobs >= maxNewJobs) break;
      const workflowId = workflowIdForSkeleton(skeleton);
      if (!runnable.some((item) => workflowIdForSkeleton(item) === workflowId)) continue;
      processedJobs += 1;
      if (existingOutput(workflowId)) {
        results.push({
          workflowId,
          skeletonId: skeleton.id,
          filePath: existingOutput(workflowId),
          status: 'completed',
          skippedExisting: true,
        });
        writeReport(results);
        console.log(`skipped existing ${workflowId}`);
        continue;
      }
      try {
        await requireAppDownloadsIdle(args.server, fetch, { timeoutMs: 120_000 });
        await prepareRuntimeForTemplate(args.server, fetch, {
          timeoutMs: args.queueWaitTimeoutMs,
          pollMs: 1_000,
        });
        await runSkeleton(page, skeleton, args, results, capabilities.get(skeleton.modelType));
        console.log(`completed ${workflowId}`);
        attemptedNewJobs += 1;
        writeReport(results);
        if (!results.at(-1)?.skippedExisting) {
          try {
            await replacePage('post-run recycle');
          } catch (recycleError) {
            const recycleMessage = recycleError instanceof Error ? recycleError.message : String(recycleError);
            console.warn(`post-run page recycle failed after ${workflowId} was durably recorded: ${recycleMessage}`);
          }
        }
      } catch (error) {
        let message = error instanceof Error ? error.message : String(error);
        if (isRecoverableBrowserError(message)) {
          try {
            console.warn(`recovering Studio session after: ${message}`);
            await replacePage(message);
            await requireAppDownloadsIdle(args.server, fetch, { timeoutMs: 120_000 });
            await prepareRuntimeForTemplate(args.server, fetch, {
              timeoutMs: args.queueWaitTimeoutMs,
              pollMs: 1_000,
            });
            await runSkeleton(page, skeleton, args, results, capabilities.get(skeleton.modelType));
            console.log(`completed ${workflowId} after browser recovery`);
            attemptedNewJobs += 1;
            writeReport(results);
            if (!results.at(-1)?.skippedExisting) {
              try {
                await replacePage('post-run recycle');
              } catch (recycleError) {
                const recycleMessage = recycleError instanceof Error ? recycleError.message : String(recycleError);
                console.warn(
                  `post-run page recycle failed after ${workflowId} was durably recorded: ${recycleMessage}`,
                );
              }
            }
            writeReport(results);
            continue;
          } catch (retryError) {
            message = retryError instanceof Error ? retryError.message : String(retryError);
          }
        } else if (
          /Target crashed|Page crashed|fetch failed|websocket is not connected|InspectDiscovery|hfCacheCount/i.test(
            message,
          )
        ) {
          console.warn(`recovering Studio session after: ${message}`);
          try {
            if (/Target crashed|Page crashed/i.test(message)) {
              await replacePage(message);
            } else {
              await preparePage(true);
            }
          } catch (recoveryError) {
            const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
            console.warn(`reload recovery failed: ${recoveryMessage}`);
            try {
              await replacePage(recoveryMessage);
            } catch (secondRecoveryError) {
              const secondMessage =
                secondRecoveryError instanceof Error ? secondRecoveryError.message : String(secondRecoveryError);
              console.warn(`second recovery failed: ${secondMessage}`);
            }
          }
        }
        results.push({
          workflowId,
          skeletonId: skeleton.id,
          status: 'failed',
          error: message,
          cachedRepoHint: [...repos].slice(0, 8),
        });
        attemptedNewJobs += 1;
        console.error(`failed ${workflowId}: ${message}`);
      }
      writeReport(results);
    }
  } finally {
    await browser.close();
    for (const processInfo of managedProcesses) {
      processInfo.child?.kill('SIGTERM');
    }
  }
  const reportPath = writeReport(results);
  const merged = mergeResults(loadPreviousResults(), results);
  const completed = merged.filter((item) => item.status === 'completed').length;
  const newAttempts = results.filter((item) => !item.skippedExisting).length;
  console.log(
    `Wrote ${completed}/${merged.length} cumulative raw assets into ${RAW_ROOT}. ` +
      `This run: ${newAttempts} attempt(s). Report: ${reportPath}`,
  );
  if (Number.isFinite(maxNewJobs) && newAttempts === 0) {
    process.exitCode = 2;
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  const releaseCampaignLock = acquireRunnerLock(CAMPAIGN_LOCK_PATH);
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : error);
      process.exitCode = 1;
    })
    .finally(() => {
      releaseCampaignLock();
    });
}
