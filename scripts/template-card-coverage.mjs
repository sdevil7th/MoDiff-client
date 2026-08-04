import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTemplateRuntime } from './template-gallery-harness.mjs';
import { editorialPosterSizeError } from './template-card-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = join(root, 'public');
const manifest = JSON.parse(readFileSync(join(publicRoot, 'template-gallery', 'manifest.json'), 'utf8'));
const assetManifest = JSON.parse(readFileSync(join(root, 'config', 'template-assets.v1.json'), 'utf8'));
const runtime = await loadTemplateRuntime(root);
const manifestByTemplate = new Map((manifest.examples ?? []).map((entry) => [entry.templateId, entry]));
const assetManifestByPath = new Map((assetManifest.assets ?? []).map((asset) => [asset.path, asset]));

function resolvePublic(path) {
  if (!path || !String(path).startsWith('/')) return null;
  const relativePath = String(path).replace(/^\/+/, '');
  const localPath = join(publicRoot, relativePath);
  const record = assetManifestByPath.get(relativePath);
  if (!existsSync(localPath) && !record) return null;
  return { localPath: existsSync(localPath) ? localPath : null, path: relativePath, record };
}

function imageSize(asset) {
  if (!asset.localPath) {
    const width = Number(asset.record?.width);
    const height = Number(asset.record?.height);
    if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
      return { width, height };
    }
    throw new Error(`${asset.path} has no valid width and height in the asset manifest.`);
  }

  const bytes = readFileSync(asset.localPath);
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' &&
    bytes.subarray(12, 16).toString('ascii') === 'IHDR'
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  if (
    bytes.length >= 30 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = bytes.subarray(offset, offset + 4).toString('ascii');
      const chunkSize = bytes.readUInt32LE(offset + 4);
      const dataOffset = offset + 8;
      if (dataOffset + chunkSize > bytes.length) break;
      if (kind === 'VP8X' && chunkSize >= 10) {
        return {
          width: bytes.readUIntLE(dataOffset + 4, 3) + 1,
          height: bytes.readUIntLE(dataOffset + 7, 3) + 1,
        };
      }
      if (kind === 'VP8L' && chunkSize >= 5 && bytes[dataOffset] === 0x2f) {
        const bits = bytes.readUInt32LE(dataOffset + 1);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >>> 14) & 0x3fff) + 1,
        };
      }
      if (
        kind === 'VP8 ' &&
        chunkSize >= 10 &&
        bytes[dataOffset + 3] === 0x9d &&
        bytes[dataOffset + 4] === 0x01 &&
        bytes[dataOffset + 5] === 0x2a
      ) {
        return {
          width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
          height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
        };
      }
      offset = dataOffset + chunkSize + (chunkSize % 2);
    }
  }

  throw new Error(`${asset.path} is not a valid PNG or WebP card poster.`);
}

function sha256(asset) {
  if (asset.localPath) return createHash('sha256').update(readFileSync(asset.localPath)).digest('hex');
  const match = /^sha256:bytes:([0-9a-f]{64})$/.exec(String(asset.record?.sha256 ?? ''));
  if (!match) throw new Error(`${asset.path} has no valid SHA-256 in the asset manifest.`);
  return match[1];
}

const posterOwners = new Map();
const posterHashOwners = new Map();
const rows = runtime.templates.map((template) => {
  const entry = manifestByTemplate.get(template.id);
  const publishedOutput = resolvePublic(entry?.afterPath ?? entry?.outputPath);
  const publishedThumbnail = resolvePublic(entry?.thumbnailPath ?? entry?.posterPath);
  const needsBefore = ['compareSlider', 'hoverDissolve'].includes(template.thumbnailVariant);
  const publishedBefore = resolvePublic(entry?.beforePath);
  const currentEntry = entry ? runtime.findManifestEntry(template, { ...manifest, examples: [entry] }) : undefined;
  const motionPreview =
    template.example?.mediaType !== 'video' && template.outputKinds?.[0] !== 'video'
      ? true
      : Boolean(currentEntry?.cardPreviewPath && resolvePublic(currentEntry.cardPreviewPath));
  const entryMatchesTemplate = Boolean(
    currentEntry &&
    currentEntry.promptSettingsHash === runtime.promptSettingsHash(template) &&
    currentEntry.templateLockHash === runtime.templateLockHash(template, currentEntry.modelRevision),
  );
  const completePublishedPreview = Boolean(
    entryMatchesTemplate &&
    publishedOutput &&
    motionPreview &&
    (!needsBefore || publishedBefore) &&
    String(entry?.qualityReviewStatus ?? '').startsWith('approved') &&
    entry?.reviewer,
  );
  const publishedPoster = Boolean(
    publishedThumbnail && String(entry?.qualityReviewStatus ?? '').startsWith('approved') && entry?.reviewer,
  );

  const posterPath = template.example?.thumbnailPath;
  const editorialPoster = resolvePublic(posterPath);
  const errors = [];
  if (!completePublishedPreview && !publishedPoster && !editorialPoster) {
    errors.push('no complete reviewed preview or editorial card poster');
  }
  if (editorialPoster) {
    if (!/\.(?:card-poster|poster)\.(?:png|webp)$/.test(String(posterPath))) {
      errors.push('unreviewed fallback must use an explicit editorial poster asset');
    } else {
      const { width, height } = imageSize(editorialPoster);
      const sizeError = editorialPosterSizeError(width, height);
      if (sizeError) errors.push(sizeError);
      const priorOwner = posterOwners.get(posterPath);
      if (priorOwner && priorOwner !== template.id) errors.push(`editorial poster is reused by ${priorOwner}`);
      posterOwners.set(posterPath, template.id);
      const posterHash = sha256(editorialPoster);
      const priorHashOwner = posterHashOwners.get(posterHash);
      if (priorHashOwner && priorHashOwner !== template.id) {
        errors.push(`editorial poster duplicates the bytes used by ${priorHashOwner}`);
      }
      posterHashOwners.set(posterHash, template.id);
    }
  }

  return {
    templateId: template.id,
    mediaType: template.example?.mediaType ?? template.outputKinds?.[0] ?? 'image',
    motionPreview,
    source: completePublishedPreview
      ? 'reviewed_generation'
      : publishedPoster
        ? 'published_poster'
        : editorialPoster
          ? 'editorial_poster'
          : 'missing',
    previewPath:
      completePublishedPreview && entry
        ? template.example?.mediaType === 'video' || template.outputKinds?.[0] === 'video'
          ? entry.cardPreviewPath
          : (entry.thumbnailPath ?? entry.posterPath ?? entry.afterPath ?? entry.outputPath)
        : publishedPoster && entry
          ? (entry.thumbnailPath ?? entry.posterPath)
          : (posterPath ?? null),
    errors,
  };
});

const failed = rows.filter((row) => row.errors.length > 0);
const videoRows = rows.filter((row) => row.mediaType === 'video');
const completeRows = rows.filter((row) => row.errors.length === 0 && (row.mediaType !== 'video' || row.motionPreview));
const report = {
  schemaVersion: 2,
  templates: rows.length,
  completeCards: completeRows.length,
  visualCards: rows.length - failed.length,
  reviewedGenerationCards: rows.filter((row) => row.source === 'reviewed_generation').length,
  publishedPosterCards: rows.filter((row) => row.source === 'published_poster').length,
  editorialPosterCards: rows.filter((row) => row.source === 'editorial_poster').length,
  posterBackedVideoCards: videoRows.filter((row) => !row.motionPreview && row.source !== 'missing').length,
  videoTemplates: videoRows.length,
  motionPreviewCards: videoRows.filter((row) => row.motionPreview).length,
  missingMotionPreviews: videoRows.filter((row) => !row.motionPreview),
  failed,
  rows,
};

console.log(JSON.stringify(report, null, 2));
if (failed.length > 0) process.exitCode = 1;
