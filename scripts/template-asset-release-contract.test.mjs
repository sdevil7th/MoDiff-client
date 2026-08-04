import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  TEMPLATE_ASSET_BUILD_IDENTITY_PATH,
  verifyRemoteTemplateAssetBuild,
  verifyTemplateAssetReleaseCheckout,
} from './template-asset-release-contract.mjs';
import {
  resolveTemplateAssetBuildSource,
  resolveTemplateAssetViteContract,
  serializeTemplateAssetSource,
  validateTemplateAssetRelease,
  validateTemplateAssetSource,
} from './template-asset-source-contract.ts';

const localSource = {
  schemaVersion: 1,
  mode: 'local',
  localBasePath: '/template-gallery',
  repoType: 'dataset',
  repoId: null,
  revision: null,
  pathPrefix: 'template-gallery',
  assetManifestPath: '_modiff/template-assets.v1.json',
  assetSetId: null,
};
const assetSetId = `sha256:canonical-json:${'a'.repeat(64)}`;
const remoteSource = {
  ...localSource,
  mode: 'huggingface',
  repoId: 'modiff-project/modiff-template-gallery',
  revision: '0123456789abcdef0123456789abcdef01234567',
  assetSetId,
};
const readyManifest = { schemaVersion: 1, status: 'ready', assetSetId };

test('accepts the checked-in local migration shape', () => {
  assert.deepEqual(validateTemplateAssetSource(localSource), localSource);
});

test('fails closed for an invalid Vite asset-mode override', () => {
  assert.throws(
    () => resolveTemplateAssetBuildSource(localSource, { mode: 'hugging-face' }),
    /VITE_MODIFF_TEMPLATE_ASSET_MODE must be `local` or `huggingface`/,
  );
});

test('validates the complete effective source when build overrides select remote mode', () => {
  assert.deepEqual(
    resolveTemplateAssetBuildSource(localSource, {
      mode: 'huggingface',
      repoId: remoteSource.repoId,
      revision: remoteSource.revision,
      assetSetId,
    }),
    remoteSource,
  );
  assert.throws(
    () => resolveTemplateAssetBuildSource(localSource, { mode: 'huggingface' }),
    /Hugging Face mode requires repoId, revision, and assetSetId/,
  );
});

test('.env-loaded values bind public assets, emitted identity, and compiled runtime to one source', () => {
  const contract = resolveTemplateAssetViteContract(
    localSource,
    {
      VITE_MODIFF_TEMPLATE_ASSET_MODE: remoteSource.mode,
      VITE_MODIFF_TEMPLATE_ASSET_REPO: remoteSource.repoId,
      VITE_MODIFF_TEMPLATE_ASSET_REVISION: remoteSource.revision,
      VITE_MODIFF_TEMPLATE_ASSET_SET_ID: remoteSource.assetSetId,
    },
    {},
  );

  assert.deepEqual(contract.source, remoteSource);
  assert.equal(contract.publicDir, false);
  assert.deepEqual(contract.runtimeDefines, {
    'import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_MODE': JSON.stringify(remoteSource.mode),
    'import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_REPO': JSON.stringify(remoteSource.repoId),
    'import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_REVISION': JSON.stringify(remoteSource.revision),
    'import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_SET_ID': JSON.stringify(remoteSource.assetSetId),
  });
  assert.equal(serializeTemplateAssetSource(contract.source), serializeTemplateAssetSource(remoteSource));
});

test('explicit process values take precedence over .env-loaded asset values', () => {
  const processSource = {
    ...remoteSource,
    repoId: 'modiff-project/process-template-gallery',
    revision: '89abcdef0123456789abcdef0123456789abcdef',
    assetSetId: `sha256:canonical-json:${'b'.repeat(64)}`,
  };
  const contract = resolveTemplateAssetViteContract(
    localSource,
    {
      VITE_MODIFF_TEMPLATE_ASSET_MODE: remoteSource.mode,
      VITE_MODIFF_TEMPLATE_ASSET_REPO: remoteSource.repoId,
      VITE_MODIFF_TEMPLATE_ASSET_REVISION: remoteSource.revision,
      VITE_MODIFF_TEMPLATE_ASSET_SET_ID: remoteSource.assetSetId,
    },
    {
      VITE_MODIFF_TEMPLATE_ASSET_MODE: processSource.mode,
      VITE_MODIFF_TEMPLATE_ASSET_REPO: processSource.repoId,
      VITE_MODIFF_TEMPLATE_ASSET_REVISION: processSource.revision,
      VITE_MODIFF_TEMPLATE_ASSET_SET_ID: processSource.assetSetId,
    },
  );

  assert.deepEqual(contract.source, processSource);
  assert.equal(
    contract.runtimeDefines['import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_REPO'],
    '"modiff-project/process-template-gallery"',
  );
});

test('release verification rejects a bundle built from a remote .env override', (context) => {
  const overrideSource = {
    ...remoteSource,
    repoId: 'modiff-project/override-template-gallery',
    revision: '89abcdef0123456789abcdef0123456789abcdef',
    assetSetId: `sha256:canonical-json:${'b'.repeat(64)}`,
  };
  const contract = resolveTemplateAssetViteContract(remoteSource, {
    VITE_MODIFF_TEMPLATE_ASSET_REPO: overrideSource.repoId,
    VITE_MODIFF_TEMPLATE_ASSET_REVISION: overrideSource.revision,
    VITE_MODIFF_TEMPLATE_ASSET_SET_ID: overrideSource.assetSetId,
  });
  const root = mkdtempSync(join(tmpdir(), 'modiff-template-override-build-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const distRoot = join(root, 'dist');
  mkdirSync(join(distRoot, 'assets'), { recursive: true });
  writeFileSync(join(distRoot, 'index.html'), '<!doctype html>');
  writeFileSync(join(distRoot, TEMPLATE_ASSET_BUILD_IDENTITY_PATH), serializeTemplateAssetSource(contract.source));

  assert.deepEqual(contract.source, overrideSource);
  assert.throws(
    () => verifyRemoteTemplateAssetBuild(distRoot, remoteSource),
    /does not match the checked-in source configuration/,
  );
});

test('release source must be remote, immutable, ready, and manifest-bound', () => {
  assert.equal(validateTemplateAssetRelease(remoteSource, readyManifest).revision, remoteSource.revision);
  assert.throws(() => validateTemplateAssetRelease(localSource, readyManifest), /source mode `huggingface`/);
  assert.throws(
    () => validateTemplateAssetRelease({ ...remoteSource, revision: 'main' }, readyManifest),
    /immutable 40-character commit SHA/,
  );
  assert.throws(
    () => validateTemplateAssetRelease(remoteSource, { ...readyManifest, status: 'blocked' }),
    /manifest must be ready/,
  );
  assert.throws(
    () =>
      validateTemplateAssetRelease(remoteSource, {
        ...readyManifest,
        assetSetId: `sha256:canonical-json:${'b'.repeat(64)}`,
      }),
    /assetSetId does not match/,
  );
});

test('an approved subset remains bound to the complete checked-in authoring manifest', () => {
  const completeAssetSetId = `sha256:canonical-json:${'b'.repeat(64)}`;
  const approvedSubsetSource = {
    ...remoteSource,
    completeAssetSetId,
    unavailableAssets: ['template-gallery/preview-awaiting-permission.webp'],
  };
  assert.equal(
    validateTemplateAssetRelease(approvedSubsetSource, {
      ...readyManifest,
      assetSetId: completeAssetSetId,
    }).assetSetId,
    remoteSource.assetSetId,
  );
});

test('remote build inspection rejects missing and bundled Gallery payloads', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'modiff-template-release-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const distRoot = join(root, 'dist');

  assert.throws(() => verifyRemoteTemplateAssetBuild(distRoot), /Release build directory is missing/);
  mkdirSync(distRoot);
  assert.throws(() => verifyRemoteTemplateAssetBuild(distRoot), /index.html is missing/);
  writeFileSync(join(distRoot, 'index.html'), '<!doctype html>');
  assert.throws(
    () => verifyRemoteTemplateAssetBuild(distRoot, remoteSource),
    /Release build source identity is missing/,
  );
  const identityPath = join(distRoot, TEMPLATE_ASSET_BUILD_IDENTITY_PATH);
  mkdirSync(join(distRoot, 'assets'));
  writeFileSync(identityPath, serializeTemplateAssetSource(localSource));
  assert.throws(
    () => verifyRemoteTemplateAssetBuild(distRoot, remoteSource),
    /does not match the checked-in source configuration/,
  );
  writeFileSync(identityPath, serializeTemplateAssetSource(remoteSource));
  assert.doesNotThrow(() => verifyRemoteTemplateAssetBuild(distRoot, remoteSource));
  mkdirSync(join(distRoot, 'template-gallery'));
  assert.throws(() => verifyRemoteTemplateAssetBuild(distRoot, remoteSource), /contains a local Gallery payload/);
});

test('release checkout verification reads the checked source, manifest, and fresh build together', (context) => {
  const root = mkdtempSync(join(tmpdir(), 'modiff-template-checkout-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src', 'studio'), { recursive: true });
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'src', 'studio', 'templateAssetSource.json'), JSON.stringify(remoteSource));
  writeFileSync(join(root, 'config', 'template-assets.v1.json'), JSON.stringify(readyManifest));
  writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html>');
  mkdirSync(join(root, 'dist', 'assets'));
  writeFileSync(join(root, 'dist', TEMPLATE_ASSET_BUILD_IDENTITY_PATH), serializeTemplateAssetSource(remoteSource));

  assert.equal(verifyTemplateAssetReleaseCheckout(root).assetSetId, assetSetId);
});
