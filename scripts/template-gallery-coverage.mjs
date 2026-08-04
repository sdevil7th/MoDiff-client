import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodedMediaHash,
  galleryExpectedOutput,
  loadTemplateRuntime,
  technicalMediaErrors,
} from './template-gallery-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'public', 'template-gallery', 'manifest.json'), 'utf8'));
const queue = JSON.parse(readFileSync(join(root, 'scripts', 'example-generation-queue.config.json'), 'utf8'));
const runtime = await loadTemplateRuntime(root);

const manifestByTemplate = new Map((manifest.examples ?? []).map((entry) => [entry.templateId, entry]));
const queuedByTemplate = new Map();
for (const job of queue.jobs ?? []) {
  for (const templateId of job.templates ?? []) {
    const jobs = queuedByTemplate.get(templateId) ?? [];
    jobs.push(job.id);
    queuedByTemplate.set(templateId, jobs);
  }
}

function publicMediaExists(path) {
  if (!path || !String(path).startsWith('/')) return false;
  return existsSync(join(root, 'public', String(path).replace(/^\//, '')));
}

function publicMediaPath(path) {
  if (!publicMediaExists(path)) return null;
  return join(root, 'public', String(path).replace(/^\//, ''));
}

function publicMediaSha256(path) {
  const mediaPath = publicMediaPath(path);
  if (!mediaPath) return null;
  return `sha256:bytes:${createHash('sha256').update(readFileSync(mediaPath)).digest('hex')}`;
}

const rows = [];
for (const template of runtime.templates) {
  const checkedInMedia =
    [template.example?.thumbnailPath, template.example?.outputPath].some(publicMediaExists) ||
    (template.mediaSlots ?? []).some((slot) => [slot.path, slot.posterPath].some(publicMediaExists));
  const evidence = manifestByTemplate.get(template.id);
  const currentEvidence = evidence
    ? runtime.findManifestEntry(template, { ...manifest, examples: [evidence] })
    : undefined;
  let technicalErrors = [];
  if (template.example?.mediaType === 'video' && currentEvidence?.outputPath) {
    const outputPath = publicMediaPath(currentEvidence.outputPath);
    if (outputPath) {
      try {
        const decoded = await decodedMediaHash(outputPath, 'video');
        technicalErrors = technicalMediaErrors(decoded, galleryExpectedOutput(template), 'video');
      } catch (error) {
        technicalErrors = [String(error)];
      }
    }
  }
  const motionPreview =
    template.example?.mediaType !== 'video' ||
    Boolean(
      currentEvidence?.cardPreviewPath &&
      publicMediaExists(currentEvidence.cardPreviewPath) &&
      currentEvidence.cardPreviewSha256 === publicMediaSha256(currentEvidence.cardPreviewPath),
    );
  const evidenceChecks = {
    manifest: Boolean(currentEvidence),
    media: Boolean(currentEvidence?.outputPath && publicMediaExists(currentEvidence.outputPath)),
    provenance: Boolean(currentEvidence?.provenancePath && publicMediaExists(currentEvidence.provenancePath)),
    review: Boolean(
      currentEvidence?.qualityReviewPath &&
      publicMediaExists(currentEvidence.qualityReviewPath) &&
      String(currentEvidence.qualityReviewStatus ?? '').startsWith('approved') &&
      currentEvidence.reviewer,
    ),
    technical: technicalErrors.length === 0,
    motionPreview,
  };
  const assetBacked = Object.values(evidenceChecks).every(Boolean);
  const jobs = queuedByTemplate.get(template.id) ?? [];
  rows.push({
    templateId: template.id,
    modelType: template.modelType,
    qualificationStatus:
      template.example?.status === 'blocked'
        ? 'blocked'
        : template.evidencePolicy === 'user_supplied'
          ? 'user_supplied'
          : 'supported',
    qualificationNotes: template.example?.notes ?? null,
    mediaType: template.example?.mediaType ?? 'image',
    assetBacked,
    motionPreview,
    checkedInMedia,
    evidenceChecks,
    technicalErrors,
    queued: jobs.length > 0,
    jobs,
  });
}

// A queued generation is work-in-progress, not gallery coverage.  Shipping the
// browser requires immutable media plus manifest/review evidence.
const supportedRows = rows.filter((row) => row.qualificationStatus === 'supported');
const blockedRows = rows.filter((row) => row.qualificationStatus === 'blocked');
const userSuppliedRows = rows.filter((row) => row.qualificationStatus === 'user_supplied');
const missing = supportedRows.filter((row) => !row.assetBacked);
const videoRows = supportedRows.filter((row) => row.mediaType === 'video');
const missingMotionPreviews = videoRows.filter((row) => !row.motionPreview);
const report = {
  schemaVersion: 3,
  templates: rows.length,
  supportedTemplates: supportedRows.length,
  planningBlocked: blockedRows.length,
  userSupplied: userSuppliedRows.length,
  assetBacked: supportedRows.filter((row) => row.assetBacked).length,
  videoTemplates: videoRows.length,
  motionPreviews: videoRows.length - missingMotionPreviews.length,
  missingMotionPreviewCount: missingMotionPreviews.length,
  missingMotionPreviews,
  queuedPending: supportedRows.filter((row) => !row.assetBacked && row.queued).length,
  uncovered: missing.length,
  blocked: blockedRows,
  userSuppliedTemplates: userSuppliedRows,
  missing,
  rows,
};

console.log(JSON.stringify(report, null, 2));
if (missing.length > 0) process.exitCode = 1;
