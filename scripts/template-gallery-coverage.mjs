import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadTemplateRuntime } from './template-gallery-harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'public', 'template-gallery', 'manifest.json'), 'utf8'));
const queue = JSON.parse(readFileSync(join(root, 'scripts', 'example-generation-queue.config.json'), 'utf8'));
const runtime = await loadTemplateRuntime(root);

const manifestIds = new Set((manifest.examples ?? []).map((entry) => entry.templateId));
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

const rows = runtime.templates.map((template) => {
  const checkedInMedia = (template.mediaSlots ?? []).some((slot) =>
    [slot.path, slot.posterPath].some(publicMediaExists),
  );
  const assetBacked = manifestIds.has(template.id) || checkedInMedia;
  const jobs = queuedByTemplate.get(template.id) ?? [];
  return {
    templateId: template.id,
    modelType: template.modelType,
    assetBacked,
    queued: jobs.length > 0,
    jobs,
  };
});

const missing = rows.filter((row) => !row.assetBacked && !row.queued);
const report = {
  schemaVersion: 1,
  templates: rows.length,
  assetBacked: rows.filter((row) => row.assetBacked).length,
  queuedCoverage: rows.filter((row) => !row.assetBacked && row.queued).length,
  uncovered: missing.length,
  missing,
  rows,
};

console.log(JSON.stringify(report, null, 2));
if (missing.length > 0) process.exitCode = 1;
