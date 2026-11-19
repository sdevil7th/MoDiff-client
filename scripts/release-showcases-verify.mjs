import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadTemplateRuntime, verifyGallery } from './template-gallery-harness.mjs';
import { verifyTemplateRecipeRecords } from './template-recipe-records.mjs';
import { validateReleaseShowcaseScope } from './release-showcase-scope.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const profile = read('config/release-showcase-scope.v1.json');
const history = read('config/template-recipe-history.v1.json');
const manifest = read('public/template-gallery/manifest.json');
const runtime = await loadTemplateRuntime(root, { includePlanning: true });
const ids = validateReleaseShowcaseScope(profile, {
  templates: runtime.templates,
  manifest,
  history,
  source: read('src/studio/templateAssetSource.json'),
});
const historical = verifyTemplateRecipeRecords(history, { root, runtime, manifest });
const selectedIds = new Set(ids);
const byId = new Map(
  historical.filter(({ templateId }) => selectedIds.has(templateId)).map((record) => [record.templateId, record]),
);
for (const selected of profile.includedTemplates) {
  const current = runtime.templates.find((template) => template.id === selected.id);
  if (selected.evidenceScope === 'current_recipe' && !runtime.findManifestEntry(current, manifest)) {
    throw new Error(`${selected.id}: current Gallery entry failed normal selection`);
  }
  if ((selected.evidenceScope === 'approved_historical_recipe') !== byId.has(selected.id)) {
    throw new Error(`${selected.id}: release proof scope differs from original recipe record`);
  }
}
const result = await verifyGallery({}, 'release-showcase-scope', {
  root,
  templateIds: ids,
  runtime: { ...runtime, templates: runtime.templates.map((template) => byId.get(template.id)?.template ?? template) },
});
const report = {
  ...result,
  profileHash: profile.profileHash,
  currentRecipeExamples: profile.includedTemplates.filter((row) => row.evidenceScope === 'current_recipe').length,
  approvedHistoricalRecipeExamples: byId.size,
  excludedTemplates: profile.excludedTemplates,
  currentGraphQualificationClaimed: false,
  hardwareQualificationClaimed: false,
  defaultFullGalleryGateChanged: false,
  modelsRun: 0,
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0)
  writeFileSync(resolve(process.argv[outputIndex + 1]), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify(
    {
      ok: report.ok,
      verifiedExamples: report.verifiedExamples,
      current: report.currentRecipeExamples,
      historical: report.approvedHistoricalRecipeExamples,
      excludedTemplates: report.excludedTemplates.length,
      errors: report.errors,
    },
    null,
    2,
  ),
);
if (!report.ok || report.verifiedExamples !== ids.length) process.exitCode = 1;
