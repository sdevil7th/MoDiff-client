import { canonicalJsonHash } from './template-gallery-harness.mjs';

/** An explicit showcase selection does not waive execution or hardware gates. */
export function validateReleaseShowcaseScope(profile, { templates, manifest, history, source }) {
  const { profileHash, ...body } = profile;
  if (
    profile.schemaVersion !== 1 ||
    profile.format !== 'modiff.release-showcase-scope.v1' ||
    profileHash !== canonicalJsonHash(body) ||
    profile.currentGraphQualificationClaimed !== false ||
    profile.userRuntimeLimitSeconds !== null ||
    !Array.isArray(profile.includedTemplates) ||
    !profile.includedTemplates.length ||
    !Array.isArray(profile.excludedTemplates) ||
    profile.dataset.repository !== source.repoId ||
    profile.dataset.revision !== source.revision
  )
    throw new Error('Invalid, stale or vacuous release showcase scope.');
  const ids = new Set(templates.map((template) => template.id));
  const selected = new Set();
  const all = [...profile.includedTemplates, ...profile.excludedTemplates];
  for (const row of all) {
    if (!ids.has(row.id) || selected.has(row.id)) throw new Error(`Duplicate or unknown release template: ${row.id}`);
    selected.add(row.id);
  }
  if (selected.size !== ids.size) throw new Error('Every current template must be included or explicitly excluded.');
  for (const row of profile.excludedTemplates) {
    if (
      !['amd-cloud', 'pending-review', 'rights-or-access', 'planning-contract', 'supplementary-only'].includes(
        row.category,
      ) ||
      typeof row.reason !== 'string' ||
      !row.reason.trim() ||
      row.countedAsComplete !== false
    ) {
      throw new Error(`Invalid release exclusion: ${row.id}`);
    }
  }
  for (const row of profile.includedTemplates) {
    const entry = manifest.examples.find((candidate) => candidate.templateId === row.id);
    if (
      !entry ||
      row.templateLockHash !== entry.templateLockHash ||
      !['current_recipe', 'approved_historical_recipe'].includes(row.evidenceScope)
    ) {
      throw new Error(`Release entry is missing or changed: ${row.id}`);
    }
    if (
      row.evidenceScope === 'approved_historical_recipe' &&
      !history.records.some(
        (record) => record.templateId === row.id && record.bindings.templateLockHash === row.templateLockHash,
      )
    ) {
      throw new Error(`Historical release entry has no explicit recipe record: ${row.id}`);
    }
  }
  return profile.includedTemplates.map((row) => row.id);
}
