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
  return validateTemplateAssetRelease(source, manifest);
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
