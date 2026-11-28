import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  serializeTemplateAssetSource,
  validateTemplateAssetRelease,
  validateTemplateAssetSource,
} from './template-asset-source-contract.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
export const TEMPLATE_ASSET_BUILD_IDENTITY_PATH = 'assets/template-asset-source.v1.json';

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} could not be read as JSON: ${path}`, { cause: error });
  }
}

// The authoring manifest can retain unavailable historical files. Only paths
// included in the public subset can expose a preview, including a renamed copy.
export function readPrivateGalleryReviews(clientRoot, source, manifest, gallery) {
  const registry = readJson(
    join(clientRoot, 'config', 'private-workflow-qualification.v1.json'),
    'Private workflow review registry',
  );
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.reviews)) {
    throw new Error('Invalid private workflow review registry.');
  }
  const privateHashes = new Set();
  const privateTemplates = new Set();
  for (const review of registry.reviews) {
    if (!/^[a-f0-9]{64}$/u.test(review.outputSha256) || !review.sourceTemplateId) {
      throw new Error('Invalid private workflow preview identity.');
    }
    privateHashes.add(`sha256:bytes:${review.outputSha256}`);
    privateTemplates.add(review.sourceTemplateId);
  }
  const unavailable = new Set(source.unavailableAssets ?? []);
  for (const { path, sha256 } of manifest.assets) {
    if (privateHashes.has(sha256) && !unavailable.has(path)) {
      throw new Error(`Private workflow output is listed as a public Gallery file: ${path}`);
    }
  }
  for (const entry of gallery.examples) {
    if (!privateTemplates.has(entry.templateId)) continue;
    for (const key of ['outputPath', 'thumbnailPath', 'cardPreviewPath', 'beforePath', 'afterPath', 'posterPath']) {
      const path = entry[key]?.replace(/^\/+/, '');
      if (path && !unavailable.has(path)) {
        throw new Error(`Private workflow preview is available in the Gallery: ${entry.templateId} (${key})`);
      }
    }
  }
  return registry.reviews;
}

export function verifyRemoteTemplateAssetBuild(distRoot, expectedSourceValue) {
  if (!existsSync(distRoot) || !statSync(distRoot).isDirectory()) {
    throw new Error(`Release build directory is missing: ${distRoot}`);
  }
  const indexPath = join(distRoot, 'index.html');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    throw new Error(`Release build is incomplete; index.html is missing: ${indexPath}`);
  }
  const identityPath = join(distRoot, TEMPLATE_ASSET_BUILD_IDENTITY_PATH);
  if (!existsSync(identityPath) || !statSync(identityPath).isFile()) {
    throw new Error(`Release build source identity is missing: ${identityPath}`);
  }
  const identityBytes = readFileSync(identityPath, 'utf8');
  let builtSourceValue;
  try {
    builtSourceValue = JSON.parse(identityBytes);
  } catch (error) {
    throw new Error(`Release build source identity is invalid JSON: ${identityPath}`, { cause: error });
  }
  const builtSource = validateTemplateAssetSource(builtSourceValue, 'Release build Template Gallery asset source');
  if (identityBytes !== serializeTemplateAssetSource(builtSource)) {
    throw new Error(`Release build source identity is not in the deterministic contract format: ${identityPath}`);
  }
  if (serializeTemplateAssetSource(builtSource) !== serializeTemplateAssetSource(expectedSourceValue)) {
    throw new Error('Release build Template Gallery asset source does not match the checked-in source configuration.');
  }
  const bundledGalleryPath = join(distRoot, 'template-gallery');
  if (existsSync(bundledGalleryPath)) {
    throw new Error(
      `Remote release build contains a local Gallery payload: ${bundledGalleryPath}. ` +
        'Rebuild with the checked-in Hugging Face asset source and do not publish this bundle.',
    );
  }
}

export function validateTemplateAssetReleaseCheckoutSource(clientRoot = CLIENT_ROOT) {
  const source = readJson(
    join(clientRoot, 'src', 'studio', 'templateAssetSource.json'),
    'Checked-in Template Gallery asset source',
  );
  const manifest = readJson(join(clientRoot, 'config', 'template-assets.v1.json'), 'Template Gallery asset manifest');
  const validatedSource = validateTemplateAssetRelease(source, manifest);
  const gallery = readJson(join(clientRoot, 'public', 'template-gallery', 'manifest.json'), 'Template Gallery');
  readPrivateGalleryReviews(clientRoot, validatedSource, manifest, gallery);
  return validatedSource;
}

export function verifyTemplateAssetReleaseCheckout(clientRoot = CLIENT_ROOT, distRoot = join(clientRoot, 'dist')) {
  const validatedSource = validateTemplateAssetReleaseCheckoutSource(clientRoot);
  verifyRemoteTemplateAssetBuild(distRoot, validatedSource);
  return validatedSource;
}

function isDirectInvocation() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isDirectInvocation()) {
  try {
    if (process.argv.includes('--source-only')) {
      const source = validateTemplateAssetReleaseCheckoutSource(CLIENT_ROOT);
      console.log(`Template asset release source verified: ${source.repoId}@${source.revision}.`);
    } else {
      const distRoot = resolve(process.env.MODIFF_CLIENT_DIST || join(CLIENT_ROOT, 'dist'));
      const source = verifyTemplateAssetReleaseCheckout(CLIENT_ROOT, distRoot);
      console.log(
        `Template asset release contract verified: ${source.repoId}@${source.revision}; no dist/template-gallery payload.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
