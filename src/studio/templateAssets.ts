import checkedInSource from './templateAssetSource.json';

export type TemplateAssetMode = 'local' | 'huggingface';

export type TemplateAssetSource = {
  schemaVersion: 1;
  mode: TemplateAssetMode;
  localBasePath: string;
  repoType: 'dataset';
  repoId: string | null;
  revision: string | null;
  pathPrefix: string;
  assetManifestPath: string;
  assetSetId: string | null;
  completeAssetSetId?: string | null;
  unavailableAssets?: string[];
};

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const REPO_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GALLERY_PATH_PATTERN = /^(?:public\/)?template-gallery(?:\/(.*))?$/;

function environmentValue(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizedRelativePath(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const match = GALLERY_PATH_PATTERN.exec(normalized);
  if (!match) return null;
  const relativePath = match[1] ?? '';
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Unsafe template Gallery asset path: ${path}`);
  }
  return segments.join('/');
}

function encodedPath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function effectiveSource(): TemplateAssetSource {
  const configured = checkedInSource as TemplateAssetSource;
  const modeOverride = environmentValue(import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_MODE);
  const mode = modeOverride === 'local' || modeOverride === 'huggingface' ? modeOverride : configured.mode;
  return {
    ...configured,
    mode,
    repoId: environmentValue(import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_REPO) ?? configured.repoId,
    revision: environmentValue(import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_REVISION) ?? configured.revision,
    assetSetId: environmentValue(import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_SET_ID) ?? configured.assetSetId,
  };
}

function validateSource(source: TemplateAssetSource) {
  if (
    source.schemaVersion !== 1 ||
    source.repoType !== 'dataset' ||
    source.localBasePath !== '/template-gallery' ||
    source.pathPrefix !== 'template-gallery' ||
    source.assetManifestPath !== '_modiff/template-assets.v1.json'
  ) {
    throw new Error('The template Gallery asset source configuration is invalid.');
  }
  if (source.mode === 'huggingface') {
    if (!source.repoId || !REPO_ID_PATTERN.test(source.repoId)) {
      throw new Error('The Hugging Face template Gallery Dataset repo ID is missing or invalid.');
    }
    if (!source.revision || !COMMIT_PATTERN.test(source.revision)) {
      throw new Error('The Hugging Face template Gallery revision must be an immutable 40-character commit SHA.');
    }
    if (!/^sha256:canonical-json:[a-f0-9]{64}$/.test(source.assetSetId ?? '')) {
      throw new Error('The Hugging Face template Gallery asset-set identity is missing.');
    }
  }
  if (source.completeAssetSetId != null && !/^sha256:canonical-json:[a-f0-9]{64}$/.test(source.completeAssetSetId)) {
    throw new Error('The complete Template Gallery asset-set identity is invalid.');
  }
  const unavailableAssets = source.unavailableAssets ?? [];
  if (
    unavailableAssets.some((path) => normalizedRelativePath(path) === null) ||
    unavailableAssets.join('\n') !== [...new Set(unavailableAssets)].sort().join('\n')
  ) {
    throw new Error('Unavailable Template Gallery asset paths must be canonical, unique, and sorted.');
  }
  return source;
}

export function getTemplateAssetSource() {
  return validateSource(effectiveSource());
}

/**
 * Resolve a Gallery-owned public path without changing unrelated URLs.
 * Hugging Face mode always uses a public Dataset URL pinned to an immutable
 * commit; local mode supports development and explicitly downloaded offline
 * bundles.
 */
export function resolveTemplateAssetUrlFromSource(
  path: string | undefined,
  source: TemplateAssetSource,
): string | undefined {
  if (!path) return undefined;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) return path;

  const relativePath = normalizedRelativePath(path);
  if (relativePath === null) return path.startsWith('/') ? path : `/${path.replace(/^public\//, '')}`;

  validateSource(source);
  const repositoryPath = [source.pathPrefix, relativePath].filter(Boolean).join('/');
  if (source.unavailableAssets?.includes(repositoryPath)) return undefined;
  if (source.mode === 'local') {
    const base = source.localBasePath.replace(/\/+$/, '');
    return relativePath ? `${base}/${relativePath}` : base;
  }

  const repoId = source.repoId as string;
  const revision = source.revision as string;
  return `https://huggingface.co/datasets/${encodedPath(repoId)}/resolve/${revision}/${encodedPath(repositoryPath)}`;
}

export function resolveTemplateAssetUrl(path: string | undefined): string | undefined {
  return resolveTemplateAssetUrlFromSource(path, getTemplateAssetSource());
}
