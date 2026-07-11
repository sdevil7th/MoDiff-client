import type { ModelCacheDiagnostics } from '../stores/useNodeStore';
import type { StudioModelProfile } from './types';

export type StudioModelCacheStatus = {
  hfCached: boolean;
  localCached: boolean;
  appDataDiscovered: boolean;
  matchingExternalPackages: string[];
  matchingExternalRepos: string[];
  installed: boolean;
  runnable: boolean;
  reason: string;
  scannedPaths: string[];
};

function modelItemText(item: unknown) {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const model = item as { id?: unknown; rel_path?: unknown; path?: unknown };
    return String(model.id ?? model.rel_path ?? model.path ?? JSON.stringify(item));
  }
  return String(item ?? '');
}

function normalizeModelText(value: string) {
  return value.toLowerCase().replace(/\\/g, '/');
}

export function cacheContains(cache: unknown[], repo: string) {
  const repoLower = normalizeModelText(repo);
  return cache.some((item) => normalizeModelText(modelItemText(item)).includes(repoLower));
}

export function localModelsContain(localModels: unknown[], repo: string) {
  const repoName = repo.split('/').pop() ?? repo;
  const repoLower = normalizeModelText(repo);
  const repoNameLower = normalizeModelText(repoName);
  return localModels.some((item) => {
    const model = normalizeModelText(modelItemText(item));
    return model.includes(repoLower) || model.includes(repoNameLower);
  });
}

export function getStudioModelCacheStatus(
  profile: StudioModelProfile,
  hfCache: unknown[],
  localModels: unknown[],
  diagnostics: ModelCacheDiagnostics | null,
): StudioModelCacheStatus {
  return getRepoCacheStatus(profile.defaultRepo, hfCache, localModels, diagnostics);
}

export function getRepoCacheStatus(
  repo: string,
  hfCache: unknown[],
  localModels: unknown[],
  diagnostics: ModelCacheDiagnostics | null,
): StudioModelCacheStatus {
  const hfCached = cacheContains(hfCache, repo);
  const localCached = localModelsContain(localModels, repo);
  const scannedPaths =
    diagnostics?.locations.map((location) => `${location.label}: ${location.path || 'default'}`) ?? [];
  const repoName = repo.split('/').pop() ?? repo;
  const normalizedRepo = normalizeModelText(repo);
  const normalizedRepoName = normalizeModelText(repoName);
  const matchingExternalPackages = (diagnostics?.external_model_packages ?? [])
    .filter((item) => {
      const text = normalizeModelText(`${item.label} ${item.path} ${(item.class_names ?? []).join(' ')}`);
      return text.includes(normalizedRepo) || text.includes(normalizedRepoName);
    })
    .map((item) => item.label);
  const matchingExternalRepos = (diagnostics?.hf_compatible_external_repos ?? [])
    .filter((item) => {
      const text = normalizeModelText(`${item.repo_id} ${item.path}`);
      return text.includes(normalizedRepo) || text.includes(normalizedRepoName);
    })
    .map((item) => item.repo_id);
  const appDataDiscovered =
    diagnostics?.locations.some(
      (location) =>
        location.exists &&
        location.runnable === false &&
        normalizeModelText(`${location.label} ${location.path ?? ''}`).includes('appdata'),
    ) ?? false;

  const installed = hfCached || localCached;
  return {
    hfCached,
    localCached,
    appDataDiscovered,
    matchingExternalPackages,
    matchingExternalRepos,
    installed,
    runnable: installed,
    reason: installed
      ? hfCached
        ? 'Found in MoDiff Hugging Face cache'
        : 'Found in MoDiff local model files'
      : matchingExternalRepos.length > 0
        ? "Found a matching Hugging Face-compatible repo outside MoDiff's configured cache roots"
        : matchingExternalPackages.length > 0
          ? 'Found a matching AppData/OpenStudio package, but it is not in a runnable MoDiff model index'
          : appDataDiscovered
            ? 'AppData folders were scanned, but they are not runnable Hugging Face Diffusers repos yet'
            : 'Not found in MoDiff runnable model indexes',
    scannedPaths,
  };
}
