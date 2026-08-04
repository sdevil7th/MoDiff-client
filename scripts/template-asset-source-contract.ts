export type TemplateAssetSourceContract = {
  schemaVersion: 1;
  mode: 'local' | 'huggingface';
  localBasePath: '/template-gallery';
  repoType: 'dataset';
  repoId: string | null;
  revision: string | null;
  pathPrefix: 'template-gallery';
  assetManifestPath: '_modiff/template-assets.v1.json';
  assetSetId: string | null;
  completeAssetSetId?: string | null;
  unavailableAssets?: string[];
};

export type TemplateAssetBuildOverrides = {
  mode?: string;
  repoId?: string;
  revision?: string;
  assetSetId?: string;
};

export type TemplateAssetBuildEnvironment = Readonly<Record<string, string | undefined>>;

export type TemplateAssetViteContract = {
  source: TemplateAssetSourceContract;
  publicDir: 'public' | false;
  runtimeDefines: Record<string, string>;
};

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const REPO_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ASSET_SET_PATTERN = /^sha256:canonical-json:[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalOverride(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function serializeRuntimeString(value: string): string {
  return JSON.stringify(value)!;
}

/**
 * Validate the source contract independently of build-time overrides. Local
 * mode is intentionally valid during the one-time Dataset migration, while a
 * Hugging Face source must already be immutable and fully identified.
 */
export function validateTemplateAssetSource(
  value: unknown,
  label = 'Template Gallery asset source',
): TemplateAssetSourceContract {
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object.`);
  if (value.schemaVersion !== 1) throw new Error(`${label} must use schemaVersion 1.`);
  if (value.mode !== 'local' && value.mode !== 'huggingface') {
    throw new Error(`${label} mode must be \`local\` or \`huggingface\`.`);
  }
  if (value.localBasePath !== '/template-gallery') {
    throw new Error(`${label} localBasePath must be /template-gallery.`);
  }
  if (value.repoType !== 'dataset') throw new Error(`${label} repoType must be dataset.`);
  if (value.pathPrefix !== 'template-gallery') {
    throw new Error(`${label} pathPrefix must be template-gallery.`);
  }
  if (value.assetManifestPath !== '_modiff/template-assets.v1.json') {
    throw new Error(`${label} assetManifestPath must be _modiff/template-assets.v1.json.`);
  }

  const repoId = value.repoId;
  const revision = value.revision;
  const assetSetId = value.assetSetId;
  const completeAssetSetId = value.completeAssetSetId;
  if (repoId !== null && (typeof repoId !== 'string' || !REPO_ID_PATTERN.test(repoId))) {
    throw new Error(`${label} repoId must be null or a valid namespace/repository identifier.`);
  }
  if (revision !== null && (typeof revision !== 'string' || !COMMIT_PATTERN.test(revision))) {
    throw new Error(`${label} revision must be null or an immutable 40-character commit SHA.`);
  }
  if (assetSetId !== null && (typeof assetSetId !== 'string' || !ASSET_SET_PATTERN.test(assetSetId))) {
    throw new Error(`${label} assetSetId must be null or a canonical JSON SHA-256 identity.`);
  }
  if (
    completeAssetSetId !== undefined &&
    completeAssetSetId !== null &&
    (typeof completeAssetSetId !== 'string' || !ASSET_SET_PATTERN.test(completeAssetSetId))
  ) {
    throw new Error(`${label} completeAssetSetId must be null or a canonical JSON SHA-256 identity.`);
  }
  const unavailableAssets = value.unavailableAssets;
  if (
    unavailableAssets !== undefined &&
    (!Array.isArray(unavailableAssets) ||
      unavailableAssets.some(
        (path) =>
          typeof path !== 'string' ||
          !path.startsWith('template-gallery/') ||
          path.includes('\\') ||
          path.split('/').some((segment) => !segment || segment === '.' || segment === '..'),
      ) ||
      unavailableAssets.join('\n') !== [...new Set(unavailableAssets)].sort().join('\n'))
  ) {
    throw new Error(`${label} unavailableAssets must contain canonical, unique, sorted Gallery paths.`);
  }

  const remoteIdentityCount = [repoId, revision, assetSetId].filter((item) => item !== null).length;
  if (remoteIdentityCount !== 0 && remoteIdentityCount !== 3) {
    throw new Error(`${label} must declare repoId, revision, and assetSetId together.`);
  }
  if (value.mode === 'huggingface' && remoteIdentityCount !== 3) {
    throw new Error(`${label} Hugging Face mode requires repoId, revision, and assetSetId.`);
  }

  return value as TemplateAssetSourceContract;
}

/** Resolve and validate exactly the source identity that Vite will compile. */
export function resolveTemplateAssetBuildSource(
  checkedInValue: unknown,
  overrides: TemplateAssetBuildOverrides = {},
): TemplateAssetSourceContract {
  const checkedInSource = validateTemplateAssetSource(checkedInValue, 'Checked-in Template Gallery asset source');
  const modeOverride = optionalOverride(overrides.mode);
  if (modeOverride !== undefined && modeOverride !== 'local' && modeOverride !== 'huggingface') {
    throw new Error(
      `VITE_MODIFF_TEMPLATE_ASSET_MODE must be \`local\` or \`huggingface\`; received ${JSON.stringify(modeOverride)}.`,
    );
  }

  return validateTemplateAssetSource(
    {
      ...checkedInSource,
      mode: modeOverride ?? checkedInSource.mode,
      repoId: optionalOverride(overrides.repoId) ?? checkedInSource.repoId,
      revision: optionalOverride(overrides.revision) ?? checkedInSource.revision,
      assetSetId: optionalOverride(overrides.assetSetId) ?? checkedInSource.assetSetId,
    },
    'Effective Template Gallery asset source',
  );
}

/**
 * Resolve every Vite-facing consequence of the asset source from one value.
 * Vite loads `.env*` after evaluating its config unless the config explicitly
 * calls `loadEnv`; an existing process value has Vite's highest precedence and
 * therefore wins over the loaded file value.
 */
export function resolveTemplateAssetViteContract(
  checkedInValue: unknown,
  loadedEnvironment: TemplateAssetBuildEnvironment = {},
  processEnvironment: TemplateAssetBuildEnvironment = {},
): TemplateAssetViteContract {
  const environmentValue = (name: string) => processEnvironment[name] ?? loadedEnvironment[name];
  const source = resolveTemplateAssetBuildSource(checkedInValue, {
    mode: environmentValue('VITE_MODIFF_TEMPLATE_ASSET_MODE'),
    repoId: environmentValue('VITE_MODIFF_TEMPLATE_ASSET_REPO'),
    revision: environmentValue('VITE_MODIFF_TEMPLATE_ASSET_REVISION'),
    assetSetId: environmentValue('VITE_MODIFF_TEMPLATE_ASSET_SET_ID'),
  });

  return {
    source,
    publicDir: source.mode === 'huggingface' ? false : 'public',
    // Explicit definitions override Vite's later automatic import.meta.env
    // expansion, so runtime URL resolution cannot diverge from publicDir or
    // the identity emitted by the build plugin.
    runtimeDefines: {
      'import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_MODE': serializeRuntimeString(source.mode),
      'import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_REPO': serializeRuntimeString(source.repoId ?? ''),
      'import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_REVISION': serializeRuntimeString(source.revision ?? ''),
      'import.meta.env.VITE_MODIFF_TEMPLATE_ASSET_SET_ID': serializeRuntimeString(source.assetSetId ?? ''),
    },
  };
}

export function validateTemplateAssetRelease(
  sourceValue: unknown,
  manifestValue: unknown,
): TemplateAssetSourceContract {
  const source = validateTemplateAssetSource(sourceValue, 'Checked-in Template Gallery asset source');
  if (source.mode !== 'huggingface') {
    throw new Error('Release builds require checked-in Template Gallery source mode `huggingface`.');
  }
  if (!isRecord(manifestValue) || manifestValue.schemaVersion !== 1) {
    throw new Error('Template Gallery asset manifest must use schemaVersion 1.');
  }
  if (manifestValue.status !== 'ready') {
    throw new Error('Template Gallery asset manifest must be ready before a release build.');
  }
  const expectedCompleteAssetSetId = source.completeAssetSetId ?? source.assetSetId;
  if (manifestValue.assetSetId !== expectedCompleteAssetSetId) {
    throw new Error('Template Gallery source assetSetId does not match config/template-assets.v1.json.');
  }
  return source;
}

/** Stable bytes embedded into every Vite build for release-time verification. */
export function serializeTemplateAssetSource(value: unknown): string {
  const source = validateTemplateAssetSource(value);
  return `${JSON.stringify({
    schemaVersion: source.schemaVersion,
    mode: source.mode,
    localBasePath: source.localBasePath,
    repoType: source.repoType,
    repoId: source.repoId,
    revision: source.revision,
    pathPrefix: source.pathPrefix,
    assetManifestPath: source.assetManifestPath,
    assetSetId: source.assetSetId,
    ...(source.completeAssetSetId === undefined ? {} : { completeAssetSetId: source.completeAssetSetId }),
    ...(source.unavailableAssets === undefined ? {} : { unavailableAssets: source.unavailableAssets }),
  })}\n`;
}
