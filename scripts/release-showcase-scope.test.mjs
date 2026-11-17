import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { canonicalJsonHash, loadTemplateRuntime } from './template-gallery-harness.mjs';
import { validateReleaseShowcaseScope } from './release-showcase-scope.mjs';

function fixture() {
  const body = {
    schemaVersion: 1,
    format: 'modiff.release-showcase-scope.v1',
    currentGraphQualificationClaimed: false,
    userRuntimeLimitSeconds: null,
    dataset: { repository: 'test/gallery', revision: 'a'.repeat(40) },
    includedTemplates: [{ id: 'kept', evidenceScope: 'approved_historical_recipe', templateLockHash: 'old-lock' }],
    excludedTemplates: [
      { id: 'cloud', category: 'amd-cloud', reason: 'Pending cloud resources', countedAsComplete: false },
    ],
  };
  const profile = { ...body, profileHash: canonicalJsonHash(body) };
  const context = {
    templates: [{ id: 'kept' }, { id: 'cloud' }],
    manifest: { examples: [{ templateId: 'kept', templateLockHash: 'old-lock' }] },
    history: { records: [{ templateId: 'kept', bindings: { templateLockHash: 'old-lock' } }] },
    source: { repoId: 'test/gallery', revision: 'a'.repeat(40) },
  };
  return { profile, context };
}

test('scoped showcases retain explicit exclusions without granting current graph proof', () => {
  const { profile, context } = fixture();
  assert.deepEqual(validateReleaseShowcaseScope(profile, context), ['kept']);
  assert.equal(profile.currentGraphQualificationClaimed, false);
});

test('the checked-in showcase selection preserves exact file locks for current and historical examples', async () => {
  const root = resolve(import.meta.dirname, '..');
  const read = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
  const profile = read('config/release-showcase-scope.v1.json');
  const manifest = read('public/template-gallery/manifest.json');
  const history = read('config/template-recipe-history.v1.json');
  const runtime = await loadTemplateRuntime(root, { includePlanning: true });
  const selected = validateReleaseShowcaseScope(profile, {
    templates: runtime.templates,
    manifest,
    history,
    source: read('src/studio/templateAssetSource.json'),
  });
  assert.equal(selected.length, profile.includedTemplates.length);
  const historicalIds = new Set(history.records.map((record) => record.templateId));
  for (const row of profile.includedTemplates) {
    assert.equal(row.evidenceScope === 'approved_historical_recipe', historicalIds.has(row.id), row.id);
    if (row.evidenceScope === 'current_recipe') {
      const template = runtime.templates.find((candidate) => candidate.id === row.id);
      assert.ok(runtime.findManifestEntry(template, manifest), row.id);
    }
  }
});

test('curation rejects unknown, omitted, vacuous, silently completed and stale records', () => {
  for (const mutate of [
    (p) => {
      p.includedTemplates = [];
    },
    (p) => {
      p.excludedTemplates = [];
    },
    (p) => {
      p.excludedTemplates[0].reason = '';
    },
    (p) => {
      p.excludedTemplates[0].countedAsComplete = true;
    },
    (p) => {
      p.excludedTemplates[0].id = 'kept';
    },
    (p) => {
      p.includedTemplates[0].templateLockHash = 'changed';
    },
    (p) => {
      p.dataset.revision = 'b'.repeat(40);
    },
    (p) => {
      p.currentGraphQualificationClaimed = true;
    },
    (p) => {
      p.userRuntimeLimitSeconds = 7200;
    },
  ]) {
    const { profile, context } = fixture();
    mutate(profile);
    const { profileHash: _old, ...body } = profile;
    profile.profileHash = canonicalJsonHash(body);
    assert.throws(() => validateReleaseShowcaseScope(profile, context));
  }
  const { profile, context } = fixture();
  context.history.records = [];
  assert.throws(() => validateReleaseShowcaseScope(profile, context), /no explicit recipe record/u);
});
