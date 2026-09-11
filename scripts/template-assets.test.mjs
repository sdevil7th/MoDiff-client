import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { resolveTemplateAssetBuildSource, validateTemplateAssetRelease } from './template-asset-source-contract.ts';
import { editorialPosterSizeError } from './template-card-contract.mjs';

const server = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
const { resolveTemplateAssetUrlFromSource } = await server.ssrLoadModule('/src/studio/templateAssets.ts');

test.after(async () => {
  await server.close();
});

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

const remoteSource = {
  ...localSource,
  mode: 'huggingface',
  repoId: 'modiff-project/template-gallery',
  revision: '0123456789abcdef0123456789abcdef01234567',
  assetSetId: `sha256:canonical-json:${'a'.repeat(64)}`,
};

test('resolves local Gallery paths without changing unrelated URLs', () => {
  assert.equal(
    resolveTemplateAssetUrlFromSource('public/template-gallery/inputs/source image.webp', localSource),
    '/template-gallery/inputs/source image.webp',
  );
  assert.equal(
    resolveTemplateAssetUrlFromSource('https://example.com/image.webp', localSource),
    'https://example.com/image.webp',
  );
  assert.equal(resolveTemplateAssetUrlFromSource('/favicon.ico', localSource), '/favicon.ico');
});

test('builds a public Dataset URL pinned to an immutable revision', () => {
  assert.equal(
    resolveTemplateAssetUrlFromSource('/template-gallery/inputs/source image.webp', remoteSource),
    'https://huggingface.co/datasets/modiff-project/template-gallery/resolve/' +
      '0123456789abcdef0123456789abcdef01234567/template-gallery/inputs/source%20image.webp',
  );
});

test('keeps templates usable without requesting unavailable preview assets', () => {
  const unavailablePath = 'template-gallery/preview-awaiting-permission.webp';
  const approvedSubsetSource = {
    ...remoteSource,
    completeAssetSetId: `sha256:canonical-json:${'b'.repeat(64)}`,
    unavailableAssets: [unavailablePath],
  };
  assert.equal(resolveTemplateAssetUrlFromSource(`/${unavailablePath}`, approvedSubsetSource), undefined);
  assert.match(
    resolveTemplateAssetUrlFromSource('/template-gallery/available.webp', approvedSubsetSource),
    /\/template-gallery\/available\.webp$/,
  );
});

test('rejects moving revisions and path traversal', () => {
  assert.throws(
    () => resolveTemplateAssetUrlFromSource('/template-gallery/example.webp', { ...remoteSource, revision: 'main' }),
    /immutable 40-character commit SHA/,
  );
  assert.throws(
    () => resolveTemplateAssetUrlFromSource('/template-gallery/../secret', localSource),
    /Unsafe template Gallery asset path/,
  );
});

test('build and runtime contracts agree on local and immutable remote source shapes', () => {
  assert.deepEqual(resolveTemplateAssetBuildSource(localSource), localSource);
  assert.deepEqual(resolveTemplateAssetBuildSource(remoteSource), remoteSource);
  assert.equal(
    validateTemplateAssetRelease(remoteSource, {
      schemaVersion: 1,
      status: 'ready',
      assetSetId: remoteSource.assetSetId,
    }).revision,
    remoteSource.revision,
  );
});

test('invalid build mode overrides fail instead of silently selecting local public assets', () => {
  assert.throws(
    () => resolveTemplateAssetBuildSource(localSource, { mode: 'hugging-face' }),
    /VITE_MODIFF_TEMPLATE_ASSET_MODE must be `local` or `huggingface`/,
  );
});

test('editorial poster resolution accepts landscape and portrait orientation', () => {
  assert.equal(editorialPosterSizeError(1024, 768), null);
  assert.equal(editorialPosterSizeError(768, 1024), null);
  assert.equal(editorialPosterSizeError(1024, 767), 'editorial poster is too small: 1024x767');
  assert.equal(editorialPosterSizeError(768, 768), 'editorial poster is too small: 768x768');
});
