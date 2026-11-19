import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalJsonHash } from './canonical-json.mjs';
import { verifiedRetainedGalleryAssetIndex } from './retained-gallery-release.mjs';

const hash = (value) => `sha256:canonical-json:${canonicalJsonHash(value)}`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'retained-gallery-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'src', 'studio'), { recursive: true });
  const available = { path: 'template-gallery/retained.json', size: 10, sha256: `sha256:bytes:${'a'.repeat(64)}` };
  const held = { path: 'template-gallery/withheld.webp', size: 20, sha256: `sha256:bytes:${'b'.repeat(64)}` };
  const payload = { schemaVersion: 1, assetVersion: 'v1', assets: [available, held] };
  const inventory = {
    ...payload,
    status: 'ready',
    assetSetId: hash(payload),
    assetCount: 2,
    totalBytes: 30,
    missingAssets: [],
  };
  const source = {
    schemaVersion: 1,
    mode: 'huggingface',
    localBasePath: '/template-gallery',
    repoType: 'dataset',
    repoId: 'maintainer/gallery',
    revision: 'c'.repeat(40),
    pathPrefix: 'template-gallery',
    assetManifestPath: '_modiff/template-assets.v1.json',
    assetSetId: hash({ ...payload, assets: [available] }),
    completeAssetSetId: inventory.assetSetId,
    unavailableAssets: [held.path],
  };
  const rights = {
    schemaVersion: 1,
    assetSetId: inventory.assetSetId,
    records: [
      { path: available.path, sha256: available.sha256, publishDecision: 'approved' },
      { path: held.path, sha256: held.sha256, publishDecision: 'hold', holdReason: 'existing rights hold' },
    ],
  };
  const write = () => {
    for (const [name, value] of [
      ['src/studio/templateAssetSource.json', source],
      ['config/template-assets.v1.json', inventory],
      ['config/template-asset-rights.v1.json', rights],
    ])
      writeFileSync(join(root, name), JSON.stringify(value));
  };
  return { root, source, inventory, rights, available, held, write };
}

test('retained publication resolves only exact registered rights-approved assets', (t) => {
  const { root, source, available, held, write } = fixture(t);
  write();
  const approved = verifiedRetainedGalleryAssetIndex(root, source);
  assert.deepEqual(approved.get(available.path), available);
  assert.equal(approved.has(held.path), false);
  assert.throws(
    () => verifiedRetainedGalleryAssetIndex(root, { ...source, revision: 'd'.repeat(40) }),
    /differs from the activated Gallery source/u,
  );
});

test('retained release refuses stale Gallery inventory, unbound rights and changed holds', (t) => {
  for (const alter of [
    (value) => {
      value.source.assetSetId = 'sha256:canonical-json:' + 'd'.repeat(64);
    },
    (value) => {
      value.inventory.assets[0].size += 1;
    },
    (value) => {
      value.rights.records[0].sha256 = value.held.sha256;
    },
    (value) => {
      value.rights.records[1].publishDecision = 'approved';
    },
    (value) => {
      value.source.unavailableAssets = [];
    },
  ]) {
    const value = fixture(t);
    alter(value);
    value.write();
    assert.throws(() => verifiedRetainedGalleryAssetIndex(value.root, value.source));
  }
});
