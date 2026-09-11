import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { relatedWorkflowEvidencePaths } from './catalog-evidence-discovery.mjs';

test('catalog evidence discovery matches exact structured identities, not prompt substrings', () => {
  const identity = 'diffusers.modular:Example:text2image';
  const files = new Map([
    ['exact.json', JSON.stringify({ workflow: { definitionId: identity } })],
    ['prompt.json', JSON.stringify({ prompt: `Compare ${identity} with a different workflow` })],
    ['broken.json', identity],
  ]);
  assert.deepEqual(relatedWorkflowEvidencePaths(files, [identity]), ['exact.json']);
});

test('failed or stale files remain explicitly related references, never current proof', () => {
  const files = new Map([
    ['failed.json', JSON.stringify({ id: 'admission', passed: false })],
    ['stale.json', JSON.stringify({ id: 'admission', contentHash: 'old' })],
  ]);
  assert.deepEqual(relatedWorkflowEvidencePaths(files, ['admission']), ['failed.json', 'stale.json']);
  const source = readFileSync(new URL('./diffusers-94-qualification-manifest.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /workflowsWithCurrentEvidenceCount/);
  assert.match(source, /discovery_only_not_qualification/);
  assert.match(source, /workflowsWithRelatedEvidenceCount/);
});

test('large nested evidence arrays do not overflow spread argument limits', () => {
  const text = JSON.stringify(Array.from({ length: 140_000 }, () => 0));
  assert.deepEqual(relatedWorkflowEvidencePaths(new Map([['large.json', text]]), ['absent']), []);
});
