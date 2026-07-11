import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { compareRunProvenance } from './live-proof-provenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_GALLERY_DIR = join(ROOT, 'public', 'template-gallery');
const PUBLIC_MANIFEST = join(PUBLIC_GALLERY_DIR, 'manifest.json');
const ARTIFACT_ROOT = join(ROOT, 'artifacts', 'template-gallery');
const EXACT_QUALITY_REVIEW_STATUS = 'approved_exact';
const REVIEWED_QUALITY_REVIEW_STATUS = 'approved_reviewed';
const QUALITY_REVIEW_STATUSES = new Set([EXACT_QUALITY_REVIEW_STATUS, REVIEWED_QUALITY_REVIEW_STATUS]);
const MEDIA_EXTENSIONS = {
  image: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  video: new Set(['.mp4', '.mov', '.mkv', '.webm']),
  audio: new Set(['.wav', '.mp3', '.flac', '.m4a', '.ogg']),
  json: new Set(['.json']),
};

function bundledFfmpegPath() {
  const binaries = resolve(ROOT, '..', 'MoDiff', '.venv', 'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries');
  if (!existsSync(binaries)) return null;
  const executable = readdirSync(binaries).find((name) => /^ffmpeg.*\.exe$/i.test(name));
  return executable ? join(binaries, executable) : null;
}

const DEFAULT_FFMPEG = process.env.MODIFF_FFMPEG || bundledFfmpegPath() || 'ffmpeg';

function parseArgs(argv) {
  const args = { mode: argv[2] ?? 'verify', publish: false, templates: [] };
  for (let index = 3; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === '--publish') {
      args.publish = true;
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
      } else {
        args[key] = value;
      }
    }
  }
  return args;
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJsonHash(value) {
  return `sha256:canonical-json:${sha256(Buffer.from(stableStringify(value)))}`;
}

function redactLocalPath(value) {
  const isWindowsPath = /^[a-z]:[\\/]/i.test(value);
  const isUserScopedPosixPath = /^\/(?:Users|home|tmp|private\/tmp|var\/tmp)\//.test(value);
  if (!isWindowsPath && !isUserScopedPosixPath) return value;
  const fileName = value.split(/[\\/]/).filter(Boolean).at(-1) ?? 'path';
  return `<local-path>/${fileName}`;
}

export function redactPublicProvenance(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => redactPublicProvenance(item));
  if (typeof value === 'string') {
    if (key === 'gitCommit') return '<redacted-source-commit>';
    return redactLocalPath(value);
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactPublicProvenance(entryValue, entryKey)]),
  );
}

export function validateBeforeMedia(filePath, provenance) {
  if (!filePath || !existsSync(filePath)) {
    return { errors: [`Before media is missing: ${filePath || 'not supplied'}`] };
  }
  const hash = `sha256:bytes:${sha256(readFileSync(filePath))}`;
  const inputItems = provenance?.inputs?.items ?? [];
  const matchedInput = inputItems.find((item) => item?.contentHash === hash);
  return {
    hash,
    byteSize: readFileSync(filePath).byteLength,
    errors: matchedInput ? [] : [`Before media hash ${hash} does not match any pinned provenance input.`],
  };
}

function isVerifiedRuntimeFingerprint(value) {
  return typeof value === 'string' && value.trim() !== '' && !/^unverified(?:-|$)/i.test(value.trim());
}

function qualityReviewFile(args, templateId) {
  if (args['quality-review']) return resolve(ROOT, args['quality-review']);
  if (!args['quality-review-dir']) return null;
  return resolve(ROOT, args['quality-review-dir'], `${templateId}.quality-review.json`);
}

function provenanceFiles(args, templateId) {
  if (args['provenance-run1'] || args['provenance-run2']) {
    if (!args['provenance-run1'] || !args['provenance-run2']) return null;
    return {
      run1: resolve(ROOT, args['provenance-run1']),
      run2: resolve(ROOT, args['provenance-run2']),
    };
  }
  if (!args['provenance-dir']) return null;
  const directory = resolve(ROOT, args['provenance-dir']);
  return {
    run1: join(directory, `${templateId}.run1.provenance.json`),
    run2: join(directory, `${templateId}.run2.provenance.json`),
  };
}

function singleProvenanceFile(args, templateId) {
  if (args['provenance-run1']) return resolve(ROOT, args['provenance-run1']);
  if (!args['provenance-dir']) return null;
  return join(resolve(ROOT, args['provenance-dir']), `${templateId}.run1.provenance.json`);
}

function validateDuplicateProvenance(run1, run2, expected) {
  const errors = [];
  const comparison = compareRunProvenance(run1, run2);
  if (!comparison.candidateExact) {
    errors.push('duplicate provenance comparison did not produce candidateExact=true');
    errors.push(...comparison.mismatches.map((item) => `duplicate provenance mismatch at ${item.field}`));
    errors.push(...comparison.baselineBlockers.map((item) => `run1 provenance blocker: ${item}`));
    errors.push(...comparison.candidateBlockers.map((item) => `run2 provenance blocker: ${item}`));
  }
  for (const [label, provenance] of [
    ['run1', run1],
    ['run2', run2],
  ]) {
    const bindings = {
      templateId: provenance?.template?.id,
      templateLockHash: provenance?.templateLockHash,
      promptSettingsHash: provenance?.template?.promptSettingsHash,
      modelRevision: provenance?.modelRevision,
      runtimeFingerprint: provenance?.runtimeFingerprint,
      decodedMediaHash: provenance?.mediaHash,
      modelSetHash: provenance?.models?.hash,
      inputArtifactsHash: provenance?.inputArtifactsHash,
    };
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (bindings[field] !== expectedValue) {
        errors.push(`${label} provenance ${field} mismatch: expected ${expectedValue}, got ${bindings[field]}`);
      }
    }
    for (const field of [
      'proofLockHash',
      'graphHash',
      'backendSourceFingerprint',
      'backendContractFingerprint',
      'modelCommit',
      'templateRevisionHash',
    ]) {
      if (!provenance?.[field]) errors.push(`${label} provenance missing ${field}`);
    }
  }
  return { errors, comparison };
}

function loadDuplicateProvenance(args, template, expected) {
  const files = provenanceFiles(args, template.id);
  if (!files) {
    return {
      errors: ['No duplicate provenance supplied. Use --provenance-run1 and --provenance-run2, or --provenance-dir.'],
    };
  }
  for (const [label, filePath] of Object.entries(files)) {
    if (!existsSync(filePath)) return { errors: [`${label} provenance file is missing: ${filePath}`] };
  }
  try {
    const run1 = JSON.parse(readFileSync(files.run1, 'utf8'));
    const run2 = JSON.parse(readFileSync(files.run2, 'utf8'));
    const validation = validateDuplicateProvenance(run1, run2, expected);
    const bundle = {
      schemaVersion: 1,
      format: 'modiff.gallery.duplicate-provenance.v1',
      templateId: template.id,
      run1: redactPublicProvenance(run1),
      run2: redactPublicProvenance(run2),
      comparison: validation.comparison,
      redactions: {
        fingerprintsRemainOpaque: true,
        localPaths: true,
        note: 'Hashes attest to the original capture; redacted payloads are not sufficient to recompute them.',
        sourceCommit: true,
      },
    };
    return {
      files,
      run1,
      run2,
      bundle,
      hash: canonicalJsonHash(bundle),
      ...validation,
    };
  } catch (error) {
    return { errors: [`Could not read duplicate provenance: ${error instanceof Error ? error.message : error}`] };
  }
}

function validateSingleProvenance(provenance, expected) {
  const errors = [];
  const bindings = {
    templateId: provenance?.template?.id,
    templateLockHash: provenance?.templateLockHash,
    promptSettingsHash: provenance?.template?.promptSettingsHash,
    modelRevision: provenance?.modelRevision,
    runtimeFingerprint: provenance?.runtimeFingerprint,
    decodedMediaHash: provenance?.mediaHash,
    modelSetHash: provenance?.models?.hash,
    inputArtifactsHash: provenance?.inputArtifactsHash,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (bindings[field] !== expectedValue) {
      errors.push(`run provenance ${field} mismatch: expected ${expectedValue}, got ${bindings[field]}`);
    }
  }
  for (const field of [
    'proofLockHash',
    'graphHash',
    'backendSourceFingerprint',
    'backendContractFingerprint',
    'modelCommit',
    'templateRevisionHash',
  ]) {
    if (!provenance?.[field]) errors.push(`run provenance missing ${field}`);
  }
  for (const blocker of provenance?.blockers ?? []) errors.push(`run provenance blocker: ${blocker}`);
  return errors;
}

function loadSingleProvenance(args, template, expected) {
  const filePath = singleProvenanceFile(args, template.id);
  if (!filePath) {
    return { errors: ['No run provenance supplied. Use --provenance-run1 or --provenance-dir.'] };
  }
  if (!existsSync(filePath)) return { errors: [`Run provenance file is missing: ${filePath}`] };
  try {
    const run = JSON.parse(readFileSync(filePath, 'utf8'));
    const errors = validateSingleProvenance(run, expected);
    const bundle = {
      schemaVersion: 1,
      format: 'modiff.gallery.reviewed-provenance.v1',
      templateId: template.id,
      run: redactPublicProvenance(run),
      redactions: {
        fingerprintsRemainOpaque: true,
        localPaths: true,
        note: 'Hashes attest to the original capture; redacted payloads are not sufficient to recompute them.',
        sourceCommit: true,
      },
    };
    return { filePath, run, bundle, hash: canonicalJsonHash(bundle), errors };
  } catch (error) {
    return { errors: [`Could not read run provenance: ${error instanceof Error ? error.message : error}`] };
  }
}

export function validateQualityReview(review, expected, requiredStatus = EXACT_QUALITY_REVIEW_STATUS) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return ['Quality review must be a JSON object.'];
  }
  const requiredSchemaVersion = requiredStatus === REVIEWED_QUALITY_REVIEW_STATUS ? 2 : 1;
  if (review.schemaVersion !== requiredSchemaVersion) {
    errors.push(`quality review schemaVersion must be ${requiredSchemaVersion}`);
  }
  for (const field of [
    'templateId',
    'templateLockHash',
    'promptSettingsHash',
    'modelRevision',
    'runtimeFingerprint',
    'graphHash',
    'proofLockHash',
    'decodedMediaHash',
    'reviewStatus',
    'reviewer',
    'reviewedAt',
    'rubric',
    'summary',
  ]) {
    if (review[field] === undefined || review[field] === null || review[field] === '') {
      errors.push(`quality review missing ${field}`);
    }
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (review[field] !== expectedValue) {
      errors.push(`quality review ${field} mismatch: expected ${expectedValue}, got ${review[field]}`);
    }
  }
  if (review.reviewStatus !== requiredStatus) {
    errors.push(`quality review status must be ${requiredStatus}`);
  }
  if (!isVerifiedRuntimeFingerprint(review.runtimeFingerprint)) {
    errors.push('quality review runtimeFingerprint must be verified');
  }
  if (Number.isNaN(Date.parse(review.reviewedAt ?? ''))) {
    errors.push('quality review reviewedAt must be an ISO-compatible timestamp');
  }
  if (!review.rubric || typeof review.rubric !== 'object' || Array.isArray(review.rubric)) {
    errors.push('quality review rubric must be an object');
  } else {
    for (const requiredScore of ['taskAdherence', 'artifactControl', 'modalityQuality']) {
      const score = review.rubric[requiredScore];
      if (!Number.isFinite(score) || score < 1 || score > 5) {
        errors.push(`quality review rubric.${requiredScore} must be between 1 and 5`);
      }
    }
  }
  if (typeof review.summary !== 'string' || review.summary.trim().length < 20) {
    errors.push('quality review summary must explain the approval in at least 20 characters');
  }
  if (review.knownLimitations !== undefined && !Array.isArray(review.knownLimitations)) {
    errors.push('quality review knownLimitations must be an array when supplied');
  }
  if (requiredStatus === REVIEWED_QUALITY_REVIEW_STATUS) {
    if (!Array.isArray(review.referenceSet) || review.referenceSet.length < 2) {
      errors.push('reviewed quality review requires at least two Comfy referenceSet entries');
    } else {
      review.referenceSet.forEach((reference, index) => {
        for (const field of ['templateId', 'assetPath', 'assetHash', 'rationale']) {
          if (!reference?.[field]) errors.push(`quality review referenceSet[${index}] missing ${field}`);
        }
      });
    }
    for (const field of ['promptAdherence', 'composition', 'technicalExecution', 'templateUsefulness', 'comfyParity']) {
      const score = review.scores?.[field];
      if (!Number.isFinite(score) || score < 4 || score > 5) {
        errors.push(`reviewed quality review scores.${field} must be between 4 and 5`);
      }
    }
    if (review.parityDecision !== 'not_worse') {
      errors.push('reviewed quality review parityDecision must be not_worse');
    }
    if (!Array.isArray(review.hardFailures) || review.hardFailures.length > 0) {
      errors.push('reviewed quality review hardFailures must be an empty array');
    }
    if (review.objectiveChecks?.status !== 'pass') {
      errors.push('reviewed quality review objectiveChecks.status must be pass');
    }
    if (review.modalityReview?.status !== 'pass') {
      errors.push('reviewed quality review modalityReview.status must be pass');
    }
  }
  return errors;
}

function loadQualityReview(args, template, expected, requiredStatus = EXACT_QUALITY_REVIEW_STATUS) {
  const filePath = qualityReviewFile(args, template.id);
  if (!filePath) {
    return {
      errors: [`No quality review supplied. Use --quality-review-dir <dir> with ${template.id}.quality-review.json.`],
    };
  }
  if (!existsSync(filePath)) return { errors: [`Quality review file is missing: ${filePath}`] };
  try {
    const review = JSON.parse(readFileSync(filePath, 'utf8'));
    const errors = validateQualityReview(review, expected, requiredStatus);
    return { filePath, review, errors, hash: canonicalJsonHash(review) };
  } catch (error) {
    return { errors: [`Could not read quality review ${filePath}: ${error instanceof Error ? error.message : error}`] };
  }
}

function runMediaTool(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr?.toString('utf8') || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function mediaProbe(command, mediaPath) {
  const result = spawnSync(command, ['-hide_banner', '-i', mediaPath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`ffmpeg media probe failed to start: ${result.error.message}`);
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

export function parseMediaProbe(text, mediaType) {
  const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  if (mediaType === 'video') {
    const stream = text.split(/\r?\n/).find((line) => /Stream .*Video:/i.test(line));
    const dimensions = stream?.match(/(?:^|[ ,])(\d{2,5})x(\d{2,5})(?:[ ,]|$)/);
    const fps = Number(stream?.match(/(\d+(?:\.\d+)?)\s+fps\b/i)?.[1] ?? 0);
    return {
      width: Number(dimensions?.[1] ?? 0),
      height: Number(dimensions?.[2] ?? 0),
      fps,
      durationSeconds,
    };
  }
  const stream = text.split(/\r?\n/).find((line) => /Stream .*Audio:/i.test(line));
  const sourceSampleRate = Number(stream?.match(/(\d+)\s+Hz\b/i)?.[1] ?? 0);
  const channelText = stream ?? '';
  const channels = /\bmono\b/i.test(channelText)
    ? 1
    : /\bstereo\b/i.test(channelText)
      ? 2
      : Number(channelText.match(/(\d+)\s+channels?\b/i)?.[1] ?? 0);
  return { sourceSampleRate, channels, durationSeconds };
}

export async function loadTemplateRuntime(root = ROOT) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const [templatesModule, exactnessModule] = await Promise.all([
      server.ssrLoadModule('/src/studio/templates.ts'),
      server.ssrLoadModule('/src/studio/templateExactness.ts'),
    ]);
    const templates = templatesModule.STUDIO_TEMPLATES;
    if (!Array.isArray(templates)) {
      throw new Error('Studio template runtime did not export STUDIO_TEMPLATES as an array.');
    }
    if (templates.length === 0) {
      throw new Error('Studio template runtime loaded zero templates; gallery generation cannot continue.');
    }

    return {
      templates,
      lockedSettingsForTemplate: exactnessModule.getTemplateLockedSettings,
      templateLockHash(template, modelRevision = template.example?.modelRevision) {
        return exactnessModule.getTemplateLockHash(template, modelRevision);
      },
      promptSettingsHash(template) {
        return exactnessModule.getPromptSettingsHash(exactnessModule.getTemplateLockedSettings(template));
      },
      findManifestEntry: exactnessModule.findManifestEntry,
    };
  } finally {
    await server.close();
  }
}

export function selectTemplates(templates, requestedIds = []) {
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error('Gallery template selection received zero runtime templates.');
  }
  const requested = [...new Set(requestedIds.map((id) => String(id).trim()).filter(Boolean))];
  if (requested.length === 0) return templates;

  const availableIds = new Set(templates.map((template) => template.id));
  const missingIds = requested.filter((id) => !availableIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(`Requested Studio template id(s) were not found: ${missingIds.join(', ')}.`);
  }
  const selected = templates.filter((template) => requested.includes(template.id));
  if (selected.length === 0) {
    throw new Error(`Requested Studio template selection resolved to zero templates: ${requested.join(', ')}.`);
  }
  return selected;
}

function mediaTypeForTemplate(template) {
  return template.example?.mediaType ?? 'image';
}

function requiresBeforeMedia(template) {
  const roles = (template.mediaSlots ?? []).map((slot) => slot?.role);
  return (
    ['compareSlider', 'hoverDissolve'].includes(template.thumbnailVariant) ||
    (template.tags ?? []).includes('before/after') ||
    roles.some((role) => role === 'before' || role === 'source')
  );
}

export function buildTemplateCandidate(runtime, template, modelRevision) {
  return {
    templateId: template.id,
    label: template.label,
    mediaType: mediaTypeForTemplate(template),
    lockedSettings: runtime.lockedSettingsForTemplate(template),
    promptSettingsHash: runtime.promptSettingsHash(template),
    templateLockHash: runtime.templateLockHash(template, modelRevision),
    runtimeEstimate: template.example?.runtimeEstimate ?? 'unknown',
  };
}

function artifactDirFor(mode) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ARTIFACT_ROOT, `${timestamp}-${mode}`);
  mkdirSync(artifactDir, { recursive: true });
  return artifactDir;
}

function findRunPair(mediaDir, template) {
  if (!mediaDir || !existsSync(mediaDir)) return null;
  const files = readdirSync(mediaDir);
  const extensions = MEDIA_EXTENSIONS[mediaTypeForTemplate(template)] ?? MEDIA_EXTENSIONS.image;
  const run1 = files.find(
    (file) => file.startsWith(`${template.id}.run1.`) && extensions.has(extname(file).toLowerCase()),
  );
  const run2 = files.find(
    (file) => file.startsWith(`${template.id}.run2.`) && extensions.has(extname(file).toLowerCase()),
  );
  if (!run1 || !run2) return null;
  return {
    run1: join(mediaDir, run1),
    run2: join(mediaDir, run2),
    extension: extname(run1).toLowerCase(),
  };
}

function findSingleRun(mediaDir, template) {
  if (!mediaDir || !existsSync(mediaDir)) return null;
  const extensions = MEDIA_EXTENSIONS[mediaTypeForTemplate(template)] ?? MEDIA_EXTENSIONS.image;
  const file = readdirSync(mediaDir).find(
    (name) => name.startsWith(`${template.id}.run1.`) && extensions.has(extname(name).toLowerCase()),
  );
  return file ? { run1: join(mediaDir, file), extension: extname(file).toLowerCase() } : null;
}

async function decodedImageHash(imagePath) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const bytes = readFileSync(imagePath);
    const extension = extname(imagePath).toLowerCase().replace('.', '');
    const mime =
      extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png';
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
    const result = await page.evaluate(async (src) => {
      const image = new Image();
      image.decoding = 'sync';
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not create canvas context for decoded image hash.');
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      let lumaSum = 0;
      let lumaSquaredSum = 0;
      let nearBlackPixels = 0;
      const pixelCount = imageData.data.length / 4;
      for (let offset = 0; offset < imageData.data.length; offset += 4) {
        const luma =
          0.2126 * imageData.data[offset] + 0.7152 * imageData.data[offset + 1] + 0.0722 * imageData.data[offset + 2];
        lumaSum += luma;
        lumaSquaredSum += luma * luma;
        if (luma < 4) nearBlackPixels += 1;
      }
      const meanLuma = pixelCount > 0 ? lumaSum / pixelCount : 0;
      let binary = '';
      const chunkSize = 32768;
      for (let offset = 0; offset < imageData.data.length; offset += chunkSize) {
        binary += String.fromCharCode(...imageData.data.slice(offset, offset + chunkSize));
      }
      return {
        width: canvas.width,
        height: canvas.height,
        meanLuma,
        lumaStdDev: Math.sqrt(Math.max(0, lumaSquaredSum / pixelCount - meanLuma * meanLuma)),
        nearBlackRatio: pixelCount > 0 ? nearBlackPixels / pixelCount : 1,
        rgbaBase64: btoa(binary),
      };
    }, dataUrl);
    return {
      width: result.width,
      height: result.height,
      meanLuma: result.meanLuma,
      lumaStdDev: result.lumaStdDev,
      nearBlackRatio: result.nearBlackRatio,
      hash: `sha256:decoded-rgba:${sha256(Buffer.from(result.rgbaBase64, 'base64'))}`,
    };
  } finally {
    await browser.close();
  }
}

function decodedVideoHash(videoPath, args) {
  const ffmpeg = args.ffmpeg ?? DEFAULT_FFMPEG;
  const metadata = parseMediaProbe(mediaProbe(ffmpeg, videoPath), 'video');
  const frames = runMediaTool(
    ffmpeg,
    ['-v', 'error', '-i', videoPath, '-map', '0:v:0', '-an', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    'ffmpeg decoded video hash',
  );
  const bytesPerFrame = metadata.width * metadata.height * 4;
  const frameCount = bytesPerFrame > 0 ? frames.byteLength / bytesPerFrame : 0;
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error(
      `Decoded video frame buffer does not align with ${metadata.width}x${metadata.height} RGBA frames (${frames.byteLength} bytes).`,
    );
  }
  const frameHashes = [];
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let nearBlack = 0;
  let samples = 0;
  const pixelStride = Math.max(1, Math.floor((metadata.width * metadata.height) / 4096));
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStart = frameIndex * bytesPerFrame;
    frameHashes.push(sha256(frames.subarray(frameStart, frameStart + bytesPerFrame)));
    for (let pixel = 0; pixel < metadata.width * metadata.height; pixel += pixelStride) {
      const offset = frameStart + pixel * 4;
      const luma = 0.2126 * frames[offset] + 0.7152 * frames[offset + 1] + 0.0722 * frames[offset + 2];
      lumaSum += luma;
      lumaSquaredSum += luma * luma;
      if (luma < 4) nearBlack += 1;
      samples += 1;
    }
  }
  const meanLuma = samples > 0 ? lumaSum / samples : 0;
  return {
    width: metadata.width,
    height: metadata.height,
    frames: frameCount,
    durationSeconds: metadata.durationSeconds || (metadata.fps > 0 ? frameCount / metadata.fps : 0),
    uniqueFrameRatio: new Set(frameHashes).size / frameCount,
    meanLuma,
    lumaStdDev: Math.sqrt(Math.max(0, lumaSquaredSum / samples - meanLuma * meanLuma)),
    nearBlackRatio: samples > 0 ? nearBlack / samples : 1,
    hash: `sha256:decoded-video-rgba:${sha256(frames)}`,
  };
}

function decodedAudioHash(audioPath, args) {
  const ffmpeg = args.ffmpeg ?? DEFAULT_FFMPEG;
  const metadata = parseMediaProbe(mediaProbe(ffmpeg, audioPath), 'audio');
  const pcm = runMediaTool(
    ffmpeg,
    ['-v', 'error', '-i', audioPath, '-vn', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-'],
    'ffmpeg decoded audio hash',
  );
  let peak = 0;
  let clipped = 0;
  let silent = 0;
  const sampleCount = Math.floor(pcm.byteLength / 2);
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    const absolute = Math.abs(pcm.readInt16LE(offset));
    peak = Math.max(peak, absolute);
    if (absolute >= 32760) clipped += 1;
    if (absolute <= 32) silent += 1;
  }
  return {
    sampleRate: 48000,
    channels: metadata.channels || 2,
    sourceSampleRate: metadata.sourceSampleRate,
    durationSeconds: pcm.byteLength / (48000 * 2 * 2),
    peakAmplitude: peak / 32768,
    clippedSampleRatio: sampleCount > 0 ? clipped / sampleCount : 1,
    silenceRatio: sampleCount > 0 ? silent / sampleCount : 1,
    hash: `sha256:decoded-audio-pcm-s16le-48000-stereo:${sha256(pcm)}`,
  };
}

function decodedJsonHash(jsonPath) {
  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  return {
    hash: `sha256:canonical-json:${sha256(Buffer.from(stableStringify(parsed)))}`,
  };
}

export async function decodedMediaHash(mediaPath, mediaType, args = {}) {
  if (mediaType === 'video') return decodedVideoHash(mediaPath, args);
  if (mediaType === 'audio') return decodedAudioHash(mediaPath, args);
  if (mediaType === 'json') return decodedJsonHash(mediaPath);
  return decodedImageHash(mediaPath);
}

export function technicalMediaErrors(decoded, expected = {}, mediaType = 'image') {
  const errors = [];
  for (const field of ['width', 'height', 'frames', 'sampleRate']) {
    if (expected[field] !== undefined && Number(decoded[field]) !== Number(expected[field])) {
      errors.push(`${field} must be ${expected[field]}, got ${decoded[field] ?? 'missing'}`);
    }
  }
  if (expected.durationSeconds !== undefined) {
    const tolerance = mediaType === 'audio' ? 0.75 : 0.2;
    if (Math.abs(Number(decoded.durationSeconds ?? 0) - Number(expected.durationSeconds)) > tolerance) {
      errors.push(
        `duration must be within ${tolerance}s of ${expected.durationSeconds}s, got ${decoded.durationSeconds ?? 0}s`,
      );
    }
  }
  if (mediaType === 'image' || mediaType === 'video') {
    if (Number(decoded.nearBlackRatio ?? 1) > 0.995) errors.push('decoded media is more than 99.5% near-black');
    if (Number(decoded.lumaStdDev ?? 0) < 0.75) errors.push('decoded media has near-zero visual variance');
  }
  if (mediaType === 'video') {
    if (Number(decoded.frames ?? 0) < 2) errors.push('video contains fewer than two decoded frames');
    if (Number(decoded.uniqueFrameRatio ?? 0) < 0.1) errors.push('video has fewer than 10% unique decoded frames');
  }
  if (mediaType === 'audio') {
    if (Number(decoded.peakAmplitude ?? 0) <= 0.001) errors.push('audio is effectively silent');
    if (Number(decoded.silenceRatio ?? 1) > 0.98) errors.push('audio contains more than 98% near-silence');
    if (Number(decoded.clippedSampleRatio ?? 0) > 0.01) errors.push('audio contains more than 1% clipped samples');
  }
  return errors;
}

function writeVideoPoster(videoPath, posterPath, args) {
  const ffmpeg = args.ffmpeg ?? DEFAULT_FFMPEG;
  runMediaTool(ffmpeg, ['-y', '-v', 'error', '-i', videoPath, '-frames:v', '1', posterPath], 'ffmpeg video poster');
}

function readManifest() {
  if (!existsSync(PUBLIC_MANIFEST)) {
    return { schemaVersion: 2, generatedAt: new Date(0).toISOString(), runtimeFingerprint: 'unverified', examples: [] };
  }
  return JSON.parse(readFileSync(PUBLIC_MANIFEST, 'utf8'));
}

function validateManifestShape(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 2) errors.push('manifest.schemaVersion must be 2');
  if (!Array.isArray(manifest.examples)) errors.push('manifest.examples must be an array');
  for (const entry of manifest.examples ?? []) {
    for (const field of [
      'templateId',
      'promptSettingsHash',
      'templateLockHash',
      'modelRevision',
      'runtimeFingerprint',
      'graphHash',
      'proofLockHash',
      'backendSourceFingerprint',
      'backendContractFingerprint',
      'modelCommit',
      'templateRevisionHash',
      'provenancePath',
      'provenanceHash',
      'outputPath',
      'thumbnailPath',
      'mediaHash',
      'mediaType',
      'verificationTimestamp',
      'qualityReviewPath',
      'qualityReviewHash',
      'qualityReviewStatus',
      'reviewer',
      'reviewedAt',
    ]) {
      if (!entry[field]) errors.push(`${entry.templateId ?? 'unknown'} missing ${field}`);
    }
    if (!QUALITY_REVIEW_STATUSES.has(entry.qualityReviewStatus)) {
      errors.push(`${entry.templateId ?? 'unknown'} has invalid qualityReviewStatus`);
    }
    const verificationStatus =
      entry.verificationStatus ?? (entry.qualityReviewStatus === EXACT_QUALITY_REVIEW_STATUS ? 'exact' : 'reviewed');
    if (!['reviewed', 'exact'].includes(verificationStatus)) {
      errors.push(`${entry.templateId ?? 'unknown'} has invalid verificationStatus`);
    }
    if (verificationStatus === 'exact' && entry.qualityReviewStatus !== EXACT_QUALITY_REVIEW_STATUS) {
      errors.push(`${entry.templateId ?? 'unknown'} exact entry requires approved_exact review`);
    }
    if (verificationStatus === 'reviewed' && entry.qualityReviewStatus !== REVIEWED_QUALITY_REVIEW_STATUS) {
      errors.push(`${entry.templateId ?? 'unknown'} reviewed entry requires approved_reviewed review`);
    }
    if (entry.beforePath && !entry.beforeMediaHash) {
      errors.push(`${entry.templateId ?? 'unknown'} beforePath requires beforeMediaHash`);
    }
  }
  return errors;
}

export function mergeManifestEntries(existingEntries = [], verifiedEntries = []) {
  const replacements = new Map(verifiedEntries.map((entry) => [entry.templateId, entry]));
  const retained = existingEntries.filter((entry) => !replacements.has(entry.templateId));
  return [...retained, ...verifiedEntries].sort((left, right) =>
    String(left.templateId).localeCompare(String(right.templateId)),
  );
}

async function generate(args, artifactDir) {
  const runtime = await loadTemplateRuntime();
  const templates = selectTemplates(runtime.templates, args.templates);
  const mediaDir = args['media-dir'] ? resolve(ROOT, args['media-dir']) : null;
  const beforeMediaPath = args['before-media'] ? resolve(ROOT, args['before-media']) : null;
  if (beforeMediaPath && templates.length !== 1) {
    throw new Error('--before-media requires exactly one selected template.');
  }
  const runtimeFingerprint = args['runtime-fingerprint'] ?? 'unverified-local';
  const modelRevision = args['model-revision'];
  const verificationStatus = args.verification === 'reviewed' ? 'reviewed' : 'exact';
  const exactPublication = verificationStatus === 'exact';
  const requiredReviewStatus = exactPublication ? EXACT_QUALITY_REVIEW_STATUS : REVIEWED_QUALITY_REVIEW_STATUS;
  const verified = [];
  const skipped = [];
  const mediaOut = join(artifactDir, 'media');
  mkdirSync(mediaOut, { recursive: true });

  for (const template of templates) {
    const mediaType = mediaTypeForTemplate(template);
    const media = exactPublication ? findRunPair(mediaDir, template) : findSingleRun(mediaDir, template);
    if (!media) {
      skipped.push({
        templateId: template.id,
        reason: exactPublication ? 'No duplicate media pair found.' : 'No reviewed run1 media found.',
      });
      continue;
    }
    const left = await decodedMediaHash(media.run1, mediaType, args);
    const right = exactPublication ? await decodedMediaHash(media.run2, mediaType, args) : left;
    const technicalErrors = technicalMediaErrors(left, template.example?.expectedOutput ?? {}, mediaType);
    if (technicalErrors.length > 0) {
      skipped.push({
        templateId: template.id,
        reason: 'Objective technical media gate failed.',
        technicalErrors,
        decoded: left,
      });
      continue;
    }
    if (exactPublication && left.hash !== right.hash) {
      skipped.push({
        templateId: template.id,
        reason: 'Duplicate runs produced different decoded media hashes.',
        left,
        right,
      });
      continue;
    }
    if (!modelRevision) {
      skipped.push({
        templateId: template.id,
        reason: `--model-revision is required before publishing ${verificationStatus} examples.`,
        decoded: left,
      });
      continue;
    }
    if (!isVerifiedRuntimeFingerprint(runtimeFingerprint)) {
      skipped.push({
        templateId: template.id,
        reason: `A verified --runtime-fingerprint is required before ${verificationStatus} publication.`,
        decoded: left,
      });
      continue;
    }

    const promptSettingsHash = runtime.promptSettingsHash(template);
    const templateLockHash = runtime.templateLockHash(template, modelRevision);
    const provenanceExpected = {
      templateId: template.id,
      templateLockHash,
      promptSettingsHash,
      modelRevision,
      runtimeFingerprint,
      decodedMediaHash: left.hash,
    };
    const provenanceResult = exactPublication
      ? loadDuplicateProvenance(args, template, provenanceExpected)
      : loadSingleProvenance(args, template, provenanceExpected);
    if (provenanceResult.errors.length > 0) {
      skipped.push({
        templateId: template.id,
        reason: exactPublication
          ? 'Exact publication requires two matching, complete run provenance records.'
          : 'Reviewed publication requires one complete run provenance record.',
        provenanceErrors: provenanceResult.errors,
      });
      continue;
    }
    const pinnedProvenance = exactPublication ? provenanceResult.run2 : provenanceResult.run;
    const comparisonTemplate = requiresBeforeMedia(template);
    let beforeMedia = null;
    if (comparisonTemplate || beforeMediaPath) {
      if (!beforeMediaPath) {
        skipped.push({
          templateId: template.id,
          reason: 'Comparison publication requires --before-media bound to a pinned provenance input.',
        });
        continue;
      }
      beforeMedia = validateBeforeMedia(beforeMediaPath, pinnedProvenance);
      if (beforeMedia.errors.length > 0) {
        skipped.push({
          templateId: template.id,
          reason: 'Before media provenance validation failed.',
          errors: beforeMedia.errors,
        });
        continue;
      }
    }
    const reviewResult = loadQualityReview(
      args,
      template,
      {
        templateId: template.id,
        templateLockHash,
        promptSettingsHash,
        modelRevision,
        runtimeFingerprint,
        graphHash: pinnedProvenance.graphHash,
        proofLockHash: pinnedProvenance.proofLockHash,
        ...(pinnedProvenance.models?.hash ? { modelSetHash: pinnedProvenance.models.hash } : {}),
        ...(pinnedProvenance.inputArtifactsHash ? { inputArtifactsHash: pinnedProvenance.inputArtifactsHash } : {}),
        decodedMediaHash: left.hash,
      },
      requiredReviewStatus,
    );
    if (reviewResult.errors.length > 0) {
      skipped.push({
        templateId: template.id,
        reason: `${verificationStatus === 'exact' ? 'Exact' : 'Reviewed'} publication requires a matching approved quality review.`,
        qualityReviewErrors: reviewResult.errors,
      });
      continue;
    }

    const fileName = `${template.id}${media.extension}`;
    const artifactMediaPath = join(mediaOut, fileName);
    const posterName = mediaType === 'video' ? `${template.id}.poster.png` : fileName;
    const artifactPosterPath = join(mediaOut, posterName);
    const beforeName = beforeMedia ? `${template.id}.before${extname(beforeMediaPath).toLowerCase()}` : null;
    const artifactBeforePath = beforeName ? join(mediaOut, beforeName) : null;
    copyFileSync(media.run1, artifactMediaPath);
    if (artifactBeforePath) copyFileSync(beforeMediaPath, artifactBeforePath);
    if (mediaType === 'video') {
      writeVideoPoster(media.run1, artifactPosterPath, args);
    }
    const reviewName = `${template.id}.quality-review.json`;
    const provenanceName = exactPublication
      ? `${template.id}.duplicate-provenance.json`
      : `${template.id}.reviewed-provenance.json`;
    const artifactReviewDir = join(artifactDir, 'reviews');
    const artifactReviewPath = join(artifactReviewDir, reviewName);
    const artifactProvenancePath = join(artifactReviewDir, provenanceName);
    mkdirSync(artifactReviewDir, { recursive: true });
    copyFileSync(reviewResult.filePath, artifactReviewPath);
    writeFileSync(artifactProvenancePath, `${JSON.stringify(provenanceResult.bundle, null, 2)}\n`, 'utf8');
    verified.push({
      templateId: template.id,
      verificationStatus,
      promptSettingsHash,
      templateLockHash,
      modelRevision,
      runtimeFingerprint,
      graphHash: pinnedProvenance.graphHash,
      proofLockHash: pinnedProvenance.proofLockHash,
      backendSourceFingerprint: pinnedProvenance.backendSourceFingerprint,
      backendContractFingerprint: pinnedProvenance.backendContractFingerprint,
      modelCommit: pinnedProvenance.modelCommit,
      modelSetHash: pinnedProvenance.models?.hash,
      inputArtifactsHash: pinnedProvenance.inputArtifactsHash,
      templateRevisionHash: pinnedProvenance.templateRevisionHash,
      provenancePath: `/template-gallery/reviews/${provenanceName}`,
      provenanceHash: provenanceResult.hash,
      outputPath: `/template-gallery/${fileName}`,
      thumbnailPath: `/template-gallery/${posterName}`,
      ...(beforeName
        ? {
            beforePath: `/template-gallery/inputs/${beforeName}`,
            beforeMediaHash: beforeMedia.hash,
            afterPath: `/template-gallery/${fileName}`,
          }
        : {}),
      mediaHash: left.hash,
      mediaType,
      verificationTimestamp: new Date().toISOString(),
      qualityReviewPath: `/template-gallery/reviews/${reviewName}`,
      qualityReviewHash: reviewResult.hash,
      qualityReviewStatus: reviewResult.review.reviewStatus,
      reviewer: reviewResult.review.reviewer,
      reviewedAt: reviewResult.review.reviewedAt,
      width: left.width,
      height: left.height,
      frames: left.frames,
      durationSeconds: left.durationSeconds,
      sampleRate: left.sampleRate,
      artifactMediaPath,
      artifactPosterPath,
      artifactBeforePath,
      artifactReviewPath,
      artifactProvenancePath,
    });
  }

  const existingManifest = readManifest();
  const generatedEntries = verified.map(
    ({
      artifactMediaPath,
      artifactPosterPath,
      artifactBeforePath,
      artifactReviewPath,
      artifactProvenancePath,
      ...entry
    }) => entry,
  );
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    runtimeFingerprint,
    examples: mergeManifestEntries(existingManifest.examples, generatedEntries),
  };

  writeFileSync(
    join(artifactDir, 'template-candidates.json'),
    JSON.stringify(
      templates.map((template) => buildTemplateCandidate(runtime, template, modelRevision)),
      null,
      2,
    ),
  );
  writeFileSync(join(artifactDir, 'manifest-candidate.json'), JSON.stringify(manifest, null, 2));

  if (args.publish && verified.length > 0) {
    mkdirSync(PUBLIC_GALLERY_DIR, { recursive: true });
    verified.forEach((entry) => {
      copyFileSync(entry.artifactMediaPath, join(PUBLIC_GALLERY_DIR, entry.outputPath.split('/').at(-1)));
      if (entry.artifactPosterPath && entry.artifactPosterPath !== entry.artifactMediaPath) {
        copyFileSync(entry.artifactPosterPath, join(PUBLIC_GALLERY_DIR, entry.thumbnailPath.split('/').at(-1)));
      }
      if (entry.artifactBeforePath && entry.beforePath) {
        const publicBeforePath = join(ROOT, 'public', entry.beforePath.replace(/^\//, ''));
        mkdirSync(dirname(publicBeforePath), { recursive: true });
        copyFileSync(entry.artifactBeforePath, publicBeforePath);
      }
      const publicReviewPath = join(ROOT, 'public', entry.qualityReviewPath.replace(/^\//, ''));
      mkdirSync(dirname(publicReviewPath), { recursive: true });
      copyFileSync(entry.artifactReviewPath, publicReviewPath);
      const publicProvenancePath = join(ROOT, 'public', entry.provenancePath.replace(/^\//, ''));
      mkdirSync(dirname(publicProvenancePath), { recursive: true });
      copyFileSync(entry.artifactProvenancePath, publicProvenancePath);
    });
    writeFileSync(PUBLIC_MANIFEST, JSON.stringify(manifest, null, 2));
  }

  return {
    mode: 'generate',
    artifactDir,
    templates: templates.length,
    verified: verified.length,
    skipped,
    published: Boolean(args.publish && verified.length > 0),
  };
}

async function verify(args, artifactDir) {
  const runtime = await loadTemplateRuntime();
  const templatesById = new Map(runtime.templates.map((template) => [template.id, template]));
  const manifest = readManifest();
  const errors = validateManifestShape(manifest);
  if ((manifest.examples?.length ?? 0) === 0) {
    errors.push('Gallery manifest is vacuous: at least one reviewed or exact runtime-generated example is required.');
  }
  for (const entry of manifest.examples ?? []) {
    const verificationStatus =
      entry.verificationStatus ?? (entry.qualityReviewStatus === EXACT_QUALITY_REVIEW_STATUS ? 'exact' : 'reviewed');
    const exactPublication = verificationStatus === 'exact';
    const requiredReviewStatus = exactPublication ? EXACT_QUALITY_REVIEW_STATUS : REVIEWED_QUALITY_REVIEW_STATUS;
    const outputPath = join(ROOT, 'public', entry.outputPath.replace(/^\//, ''));
    if (!existsSync(outputPath)) {
      errors.push(`${entry.templateId} media file missing: ${entry.outputPath}`);
      continue;
    }
    const thumbnailPath = join(ROOT, 'public', entry.thumbnailPath.replace(/^\//, ''));
    if (!existsSync(thumbnailPath)) {
      errors.push(`${entry.templateId} thumbnail file missing: ${entry.thumbnailPath}`);
    }
    const decoded = await decodedMediaHash(outputPath, entry.mediaType ?? 'image', args);
    if (decoded.hash !== entry.mediaHash) {
      errors.push(`${entry.templateId} decoded hash mismatch: expected ${entry.mediaHash}, got ${decoded.hash}`);
    }
    const template = templatesById.get(entry.templateId);
    if (!template) {
      errors.push(`${entry.templateId} is not present in the current template runtime`);
    } else {
      errors.push(
        ...technicalMediaErrors(decoded, template.example?.expectedOutput ?? {}, entry.mediaType ?? 'image').map(
          (error) => `${entry.templateId} technical media gate: ${error}`,
        ),
      );
      if (requiresBeforeMedia(template) && (!entry.beforePath || !entry.afterPath || !entry.beforeMediaHash)) {
        errors.push(
          `${entry.templateId} comparison publication requires genuine beforePath, afterPath and beforeMediaHash`,
        );
      }
    }
    if (entry.beforePath) {
      const beforePath = join(ROOT, 'public', entry.beforePath.replace(/^\//, ''));
      if (!existsSync(beforePath)) {
        errors.push(`${entry.templateId} before media file missing: ${entry.beforePath}`);
      } else {
        const beforeHash = `sha256:bytes:${sha256(readFileSync(beforePath))}`;
        if (beforeHash !== entry.beforeMediaHash) {
          errors.push(
            `${entry.templateId} before media hash mismatch: expected ${entry.beforeMediaHash}, got ${beforeHash}`,
          );
        }
      }
    }
    const provenancePath = join(ROOT, 'public', String(entry.provenancePath ?? '').replace(/^\//, ''));
    if (!existsSync(provenancePath)) {
      errors.push(`${entry.templateId} provenance missing: ${entry.provenancePath}`);
    } else {
      try {
        const bundle = JSON.parse(readFileSync(provenancePath, 'utf8'));
        const provenanceHash = canonicalJsonHash(bundle);
        if (provenanceHash !== entry.provenanceHash) {
          errors.push(
            `${entry.templateId} provenance hash mismatch: expected ${entry.provenanceHash}, got ${provenanceHash}`,
          );
        }
        const expectedFormat = exactPublication
          ? 'modiff.gallery.duplicate-provenance.v1'
          : 'modiff.gallery.reviewed-provenance.v1';
        if (bundle.schemaVersion !== 1 || bundle.format !== expectedFormat) {
          errors.push(`${entry.templateId} provenance bundle schema/format is invalid for ${verificationStatus}`);
        }
        if (bundle.templateId !== entry.templateId) {
          errors.push(`${entry.templateId} provenance bundle templateId mismatch`);
        }
        const expectedBindings = {
          templateId: entry.templateId,
          templateLockHash: entry.templateLockHash,
          promptSettingsHash: entry.promptSettingsHash,
          modelRevision: entry.modelRevision,
          runtimeFingerprint: entry.runtimeFingerprint,
          decodedMediaHash: entry.mediaHash,
          ...(entry.modelSetHash ? { modelSetHash: entry.modelSetHash } : {}),
          ...(entry.inputArtifactsHash ? { inputArtifactsHash: entry.inputArtifactsHash } : {}),
        };
        const pinnedRun = exactPublication ? bundle.run2 : bundle.run;
        const provenanceErrors = exactPublication
          ? validateDuplicateProvenance(bundle.run1, bundle.run2, expectedBindings).errors
          : validateSingleProvenance(bundle.run, expectedBindings);
        errors.push(...provenanceErrors.map((error) => `${entry.templateId} ${error}`));
        if (entry.beforeMediaHash) {
          const inputHashes = (pinnedRun?.inputs?.items ?? []).map((item) => item?.contentHash);
          if (!inputHashes.includes(entry.beforeMediaHash)) {
            errors.push(`${entry.templateId} before media hash does not match pinned provenance inputs`);
          }
        }
        for (const field of [
          'graphHash',
          'proofLockHash',
          'backendSourceFingerprint',
          'backendContractFingerprint',
          'modelCommit',
          'templateRevisionHash',
          ...(entry.modelSetHash ? ['modelSetHash'] : []),
          ...(entry.inputArtifactsHash ? ['inputArtifactsHash'] : []),
        ]) {
          const provenanceValue =
            field === 'modelSetHash'
              ? pinnedRun?.models?.hash
              : field === 'inputArtifactsHash'
                ? pinnedRun?.inputArtifactsHash
                : pinnedRun?.[field];
          if (provenanceValue !== entry[field]) {
            errors.push(`${entry.templateId} manifest ${field} does not match pinned provenance`);
          }
        }
      } catch (error) {
        errors.push(
          `${entry.templateId} provenance is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const qualityReviewPath = join(ROOT, 'public', String(entry.qualityReviewPath ?? '').replace(/^\//, ''));
    if (!existsSync(qualityReviewPath)) {
      errors.push(`${entry.templateId} quality review missing: ${entry.qualityReviewPath}`);
      continue;
    }
    try {
      const review = JSON.parse(readFileSync(qualityReviewPath, 'utf8'));
      const reviewHash = canonicalJsonHash(review);
      if (reviewHash !== entry.qualityReviewHash) {
        errors.push(
          `${entry.templateId} quality review hash mismatch: expected ${entry.qualityReviewHash}, got ${reviewHash}`,
        );
      }
      const reviewErrors = validateQualityReview(
        review,
        {
          templateId: entry.templateId,
          templateLockHash: entry.templateLockHash,
          promptSettingsHash: entry.promptSettingsHash,
          modelRevision: entry.modelRevision,
          runtimeFingerprint: entry.runtimeFingerprint,
          graphHash: entry.graphHash,
          proofLockHash: entry.proofLockHash,
          ...(entry.modelSetHash ? { modelSetHash: entry.modelSetHash } : {}),
          ...(entry.inputArtifactsHash ? { inputArtifactsHash: entry.inputArtifactsHash } : {}),
          decodedMediaHash: entry.mediaHash,
        },
        requiredReviewStatus,
      );
      errors.push(...reviewErrors.map((error) => `${entry.templateId} ${error}`));
    } catch (error) {
      errors.push(
        `${entry.templateId} quality review is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    mode: 'verify',
    artifactDir,
    examples: manifest.examples?.length ?? 0,
    errors,
    ok: errors.length === 0,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const artifactDir = artifactDirFor(args.mode);
  mkdirSync(PUBLIC_GALLERY_DIR, { recursive: true });
  const result = args.mode === 'generate' ? await generate(args, artifactDir) : await verify(args, artifactDir);
  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.errors?.length) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
