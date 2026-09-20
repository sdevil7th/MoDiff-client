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
  repairRequired: boolean;
  reason: string;
  scannedPaths: string[];
};

export type StudioModelCacheExpectation = {
  revision?: string;
  files?: readonly string[];
};

export type ReviewedExpertInstallTarget = {
  repo: string;
  label: string;
  reason: string;
  actionLabel: 'Install' | 'Repair';
  repair: boolean;
  revision: string;
  files: string[];
};

const IMMUTABLE_HUGGING_FACE_REVISION = /^[0-9a-f]{40}$/i;
const HUGGING_FACE_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

function isReviewedDownloadFile(value: string) {
  if (!value || value.length > 512 || value.includes('\\') || value.startsWith('/') || value.endsWith('/')) {
    return false;
  }
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

export function reviewedExpertInstallTarget(
  profile: StudioModelProfile,
  status: StudioModelCacheStatus,
): ReviewedExpertInstallTarget | null {
  if (profile.executionStatus !== 'expert_only' || status.runnable) return null;
  if (profile.optionalRuntimeRequirement?.requiredNow && profile.optionalRuntimeRequirement.state !== 'active')
    return null;
  const revisions = Array.from(new Set(profile.revisionCandidates ?? []));
  const files = Array.from(new Set(profile.downloadFiles ?? [])).sort();
  const revision = revisions[0];
  if (
    revisions.length !== 1 ||
    !revision ||
    !IMMUTABLE_HUGGING_FACE_REVISION.test(revision) ||
    files.length === 0 ||
    files.some((file) => !isReviewedDownloadFile(file)) ||
    !HUGGING_FACE_REPO.test(profile.defaultRepo)
  )
    return null;
  return {
    repo: profile.defaultRepo,
    label: profile.artifactLabel || profile.label,
    reason: status.repairRequired
      ? 'Repair the exact reviewed model revision and file selection required by this workflow.'
      : 'Install the exact reviewed model revision and file selection required by this workflow.',
    actionLabel: status.repairRequired ? 'Repair' : 'Install',
    repair: status.repairRequired,
    revision,
    files,
  };
}

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
  return cache.some((item) => {
    if (!normalizeModelText(modelItemText(item)).includes(repoLower)) return false;
    if (!item || typeof item !== 'object') return true;
    const status = item as { complete?: unknown; installed?: unknown; repair_required?: unknown };
    return status.complete !== false && status.installed !== false && status.repair_required !== true;
  });
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
  if (profile.artifactInstallRequired === false) {
    return {
      hfCached: false,
      localCached: true,
      appDataDiscovered: false,
      matchingExternalPackages: [],
      matchingExternalRepos: [],
      installed: true,
      runnable: true,
      repairRequired: false,
      reason: 'Built into this MoDiff version; no model installation is required',
      scannedPaths: [],
    };
  }
  const revisions = Array.from(new Set(profile.revisionCandidates ?? []));
  const files = Array.from(new Set(profile.downloadFiles ?? [])).sort();
  const exactExpectation =
    revisions.length === 1 &&
    Boolean(revisions[0]) &&
    IMMUTABLE_HUGGING_FACE_REVISION.test(revisions[0]!) &&
    files.length > 0
      ? { revision: revisions[0], files }
      : undefined;
  return getRepoCacheStatus(profile.defaultRepo, hfCache, localModels, diagnostics, exactExpectation);
}

export function getRepoCacheStatus(
  repo: string,
  hfCache: unknown[],
  localModels: unknown[],
  diagnostics: ModelCacheDiagnostics | null,
  expectation?: StudioModelCacheExpectation,
): StudioModelCacheStatus {
  const repoLower = normalizeModelText(repo);
  const cacheEntry = hfCache.find((item) => normalizeModelText(modelItemText(item)).includes(repoLower));
  const baseHfCached = cacheContains(hfCache, repo);
  const expectedRevision = expectation?.revision?.trim().toLowerCase() || '';
  const expectedFiles = Array.from(new Set((expectation?.files ?? []).map((file) => file.replace(/\\/g, '/')))).sort();
  const hasExactExpectation = Boolean(expectedRevision || expectedFiles.length);
  const cacheRecord =
    cacheEntry && typeof cacheEntry === 'object'
      ? (cacheEntry as { planned_revision?: unknown; planned_files?: unknown })
      : null;
  const plannedRevision = String(cacheRecord?.planned_revision ?? '')
    .trim()
    .toLowerCase();
  const plannedFiles = new Set(
    Array.isArray(cacheRecord?.planned_files)
      ? cacheRecord.planned_files.map((file) => String(file).replace(/\\/g, '/'))
      : [],
  );
  const selectionMatches =
    !hasExactExpectation ||
    (Boolean(cacheRecord) &&
      (!expectedRevision || plannedRevision === expectedRevision) &&
      expectedFiles.every((file) => plannedFiles.has(file)));
  const hfCached = baseHfCached && selectionMatches;
  const selectionNeedsRepair = baseHfCached && !selectionMatches;
  const localCached = !hasExactExpectation && localModelsContain(localModels, repo);
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
    repairRequired: selectionNeedsRepair,
    reason: installed
      ? hfCached
        ? 'Found in MoDiff Hugging Face cache'
        : 'Found in MoDiff local model files'
      : selectionNeedsRepair
        ? 'The installed Hugging Face snapshot does not include the exact revision and files required by this workflow'
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
