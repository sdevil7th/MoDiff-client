import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import templateGalleryContract from '../src/studio/templateGalleryContract.json' with { type: 'json' };
import { loadTemplateRuntime } from './template-gallery-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = join(root, 'public');
const galleryRoot = join(publicRoot, 'template-gallery');
const manifestPath = join(galleryRoot, 'manifest.json');

function findBundledFfmpeg() {
  const backendRoot = resolve(root, '..', 'MoDiff');
  const roots = [];
  for (const environment of ['.venv', '.venv.previous']) {
    const libraryRoot = join(backendRoot, environment, 'lib');
    if (!existsSync(libraryRoot)) continue;
    for (const pythonDir of readdirSync(libraryRoot).filter((name) => name.startsWith('python'))) {
      roots.push(join(libraryRoot, pythonDir, 'site-packages', 'imageio_ffmpeg', 'binaries'));
    }
  }
  for (const binaries of roots) {
    if (!existsSync(binaries)) continue;
    const executable = readdirSync(binaries).find((name) => /^ffmpeg(?:-|$)/i.test(name));
    if (executable) return join(binaries, executable);
  }
  return null;
}

function resolvePublicPath(path) {
  if (!path || !String(path).startsWith('/')) return null;
  const resolved = join(publicRoot, String(path).replace(/^\//, ''));
  return existsSync(resolved) ? resolved : null;
}

function bytesSha256(path) {
  return `sha256:bytes:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

const requestedIds = new Set(
  process.argv
    .slice(2)
    .filter((argument) => argument.startsWith('--template='))
    .map((argument) => argument.slice('--template='.length))
    .filter(Boolean),
);
const ffmpeg = process.env.MODIFF_FFMPEG || findBundledFfmpeg() || 'ffmpeg';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const runtime = await loadTemplateRuntime(root);
const templatesById = new Map(runtime.templates.map((template) => [template.id, template]));
const generated = [];
const skipped = [];

for (const entry of manifest.examples ?? []) {
  if (entry.mediaType !== 'video') continue;
  if (requestedIds.size > 0 && !requestedIds.has(entry.templateId)) continue;
  const template = templatesById.get(entry.templateId);
  if (!template) {
    skipped.push({ templateId: entry.templateId, reason: 'Template is not present in the current runtime.' });
    continue;
  }
  const currentEntry = runtime.findManifestEntry(
    template,
    { ...manifest, examples: [entry] },
    { requireCardPreview: false },
  );
  if (!currentEntry) {
    skipped.push({
      templateId: entry.templateId,
      reason: 'Reviewed output is stale, revoked, or does not satisfy the current template media contract.',
    });
    continue;
  }
  const sourcePath = resolvePublicPath(entry.outputPath);
  if (!sourcePath) {
    skipped.push({ templateId: entry.templateId, reason: `Output is missing: ${entry.outputPath}` });
    continue;
  }

  const publicPreviewPath = `/template-gallery/${entry.templateId}.card-preview.mp4`;
  const previewPath = join(publicRoot, publicPreviewPath.replace(/^\//, ''));
  const preview = templateGalleryContract.video.cardPreview;
  const durationSeconds = Math.min(Number(entry.durationSeconds ?? preview.durationSeconds), preview.durationSeconds);
  const result = spawnSync(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      '-i',
      sourcePath,
      '-t',
      String(durationSeconds),
      '-vf',
      `scale=${preview.width}:-2:flags=lanczos`,
      '-an',
      '-c:v',
      preview.videoCodec,
      '-preset',
      'medium',
      '-crf',
      String(preview.crf),
      '-pix_fmt',
      preview.pixelFormat,
      '-movflags',
      '+faststart',
      previewPath,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !existsSync(previewPath)) {
    throw new Error(
      `Could not generate ${entry.templateId} card preview with ${ffmpeg}: ${result.stderr || result.error || 'unknown error'}`,
    );
  }

  entry.cardPreviewPath = publicPreviewPath;
  entry.cardPreviewSha256 = bytesSha256(previewPath);
  generated.push({
    templateId: entry.templateId,
    cardPreviewPath: entry.cardPreviewPath,
    cardPreviewSha256: entry.cardPreviewSha256,
  });
}

if (requestedIds.size > 0) {
  const handled = new Set([...generated, ...skipped].map((item) => item.templateId));
  const missing = [...requestedIds].filter((templateId) => !handled.has(templateId));
  if (missing.length > 0) throw new Error(`Requested video template(s) were not found: ${missing.join(', ')}`);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ generated, skipped }, null, 2));
