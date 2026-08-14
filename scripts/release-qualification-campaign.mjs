import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const CONTRACT_PATH = join(BACKEND_ROOT, 'data', 'release-contract.v1.json');
const INPUT_BINDINGS_PATH = join(
  CLIENT_ROOT,
  'public',
  'template-gallery',
  'runtime-inputs',
  'default-input-bindings.json',
);
const ASSET_MANIFEST_PATH = join(CLIENT_ROOT, 'config', 'template-assets.v1.json');
const STATE_PATH = resolve(
  process.env.MODIFF_QUALIFICATION_CAMPAIGN_STATE ||
    join(CLIENT_ROOT, 'artifacts', 'template-qualification', 'campaign-state.v1.json'),
);
const USER_OWNED_TEMPLATE_IDS = new Set();
export const RUNNER_INFRASTRUCTURE_EXIT_CODE = 70;

function parseArgs(argv) {
  const args = {
    dryRun: false,
    checkAppReadiness: false,
    checkDownloadIdle: false,
    checkInputReadiness: false,
    maxTemplates: Number.POSITIVE_INFINITY,
    port: Number(process.env.MODIFF_QUALIFICATION_FRONTEND_PORT || 5194),
    server: process.env.MODIFF_GALLERY_SERVER || 'http://127.0.0.1:8088',
    cacheTimeoutMs: 30_000,
    timeoutMs: 8 * 60 * 60 * 1000,
    queueWaitTimeoutMs: 3 * 60 * 60 * 1000,
    templates: [],
    excludedMedia: [],
    batchByModelFamily: false,
    reuseExistingRuntimeKey: '',
  };
  for (let index = 2; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (entry === '--check-app-readiness') {
      args.checkAppReadiness = true;
      continue;
    }
    if (entry === '--check-download-idle') {
      args.checkDownloadIdle = true;
      continue;
    }
    if (entry === '--check-input-readiness') {
      args.checkInputReadiness = true;
      continue;
    }
    const value = argv[index + 1];
    if (entry === '--max-templates') {
      args.maxTemplates = Math.max(0, Number(value));
      index += 1;
    } else if (entry === '--port') {
      args.port = Number(value);
      index += 1;
    } else if (entry === '--server') {
      args.server = String(value ?? '').trim();
      index += 1;
    } else if (entry === '--cache-timeout-ms') {
      args.cacheTimeoutMs = Number(value);
      index += 1;
    } else if (entry === '--timeout-ms') {
      args.timeoutMs = Number(value);
      index += 1;
    } else if (entry === '--queue-wait-timeout-ms') {
      args.queueWaitTimeoutMs = Number(value);
      index += 1;
    } else if (entry === '--template') {
      args.templates.push(
        ...String(value ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );
      index += 1;
    } else if (entry === '--exclude-media') {
      args.excludedMedia.push(
        ...String(value ?? '')
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      );
      index += 1;
    } else if (entry === '--batch-by-model-family') {
      args.batchByModelFamily = true;
    } else if (entry === '--reuse-existing-runtime-key') {
      args.reuseExistingRuntimeKey = String(value ?? '').trim();
      index += 1;
    } else {
      throw new Error(`Unknown campaign option: ${entry}`);
    }
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: CLIENT_ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    env: { ...process.env, MODIFF_BACKEND_DIR: BACKEND_ROOT },
  });
}

function refreshReports({ inherit = true } = {}) {
  for (const script of [
    ['run', 'release:contract:generate'],
    ['run', 'release:qualification:generate'],
  ]) {
    const result = run('npm', script, { inherit });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Could not refresh release evidence with npm ${script.join(' ')}: ${
          result.error?.message ?? `exit ${result.status}`
        }`,
      );
    }
  }
}

function templateMediaKinds(template) {
  return Array.isArray(template?.outputContract?.mediaKinds)
    ? template.outputContract.mediaKinds.map((kind) => String(kind).trim().toLowerCase()).filter(Boolean)
    : [];
}

export function modelFamilyForTemplate(template) {
  const modelType = String(template?.modelType ?? '');
  if (modelType === 'AceStepAudioPipeline') return 'ACE-Step Audio';
  if (modelType.startsWith('QwenImage')) return 'Qwen Image';
  if (modelType.startsWith('ZImage')) return 'Z-Image';
  if (modelType.startsWith('Flux')) return 'FLUX Image';
  if (modelType.startsWith('StableDiffusionXL') || modelType.startsWith('SDXL')) return 'SDXL';
  if (modelType.startsWith('Wan')) return 'Wan Video';
  if (modelType.startsWith('LTX')) return 'LTX Video';
  return modelType || 'Unclassified';
}

export function selectedJobs(contract, args) {
  const requested = new Set(args.templates);
  const excludedMedia = new Set(args.excludedMedia);
  const knownIds = new Set(contract.templates.map((template) => template.id));
  const unknown = [...requested].filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown template id(s): ${unknown.join(', ')}`);
  }
  const incomplete = contract.templates.filter(
    (template) =>
      !template.qualificationExemption &&
      (template.qualificationReceiptMissingFields ?? []).length > 0 &&
      (requested.size === 0 || requested.has(template.id)),
  );
  const deferred = incomplete
    .filter(
      (template) =>
        USER_OWNED_TEMPLATE_IDS.has(template.id) ||
        templateMediaKinds(template).some((kind) => excludedMedia.has(kind)),
    )
    .map((template) => ({
      templateId: template.id,
      modelType: template.modelType,
      modelFamily: modelFamilyForTemplate(template),
      mediaKinds: templateMediaKinds(template),
      requiredArtifacts: Array.isArray(template.requiredArtifacts) ? template.requiredArtifacts : [],
      status: USER_OWNED_TEMPLATE_IDS.has(template.id) ? 'user_owned_excluded' : 'deferred_media',
      missing: template.qualificationReceiptMissingFields,
    }));
  const deferredIds = new Set(deferred.map((job) => job.templateId));
  const jobs = incomplete
    .filter((template) => !deferredIds.has(template.id))
    .map((template) => ({
      templateId: template.id,
      modelType: template.modelType,
      modelFamily: modelFamilyForTemplate(template),
      mediaKinds: templateMediaKinds(template),
      requiredArtifacts: Array.isArray(template.requiredArtifacts) ? template.requiredArtifacts : [],
      status: 'pending',
      missing: template.qualificationReceiptMissingFields,
    }))
    .sort(
      (left, right) =>
        left.modelFamily.localeCompare(right.modelFamily) ||
        left.modelType.localeCompare(right.modelType) ||
        left.templateId.localeCompare(right.templateId),
    )
    .slice(0, Number.isFinite(args.maxTemplates) ? args.maxTemplates : undefined);
  return {
    jobs,
    deferred: deferred.sort(
      (left, right) =>
        left.status.localeCompare(right.status) ||
        left.modelFamily.localeCompare(right.modelFamily) ||
        left.templateId.localeCompare(right.templateId),
    ),
  };
}

const IMMUTABLE_REVISION = /^[0-9a-f]{40}$/;
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const RUNTIME_INPUT_PATH = /^\/template-gallery\/runtime-inputs\/assets\/([a-f0-9]{64})\.([a-z0-9]+)$/;
const MAX_QUALIFICATION_INPUT_BYTES = 256 * 1024 * 1024;
const QUALIFICATION_INPUT_FIELDS = new Set([
  'referenceImages',
  'maskImage',
  'controlImage',
  'sourceVideo',
  'maskVideo',
  'controlVideo',
  'sourceAudio',
  'referenceAudio',
]);

export function appCacheUrl(server) {
  let parsed;
  try {
    parsed = new URL(server);
  } catch {
    throw new Error('Qualification app readiness requires a valid loopback HTTP(S) server URL.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    !LOOPBACK_HOSTNAMES.has(parsed.hostname) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('Qualification app readiness accepts only an uncredentialed loopback HTTP(S) server URL.');
  }
  return new URL('/hf_cache', parsed.origin).toString();
}

export function appDownloadStatusUrl(server) {
  const cacheUrl = new URL(appCacheUrl(server));
  return new URL('/hf_download/status', cacheUrl.origin).toString();
}

export function downloadReadinessForStatus(payload) {
  const downloads = payload?.downloads;
  const activeCount = payload?.activeCount;
  const queuedReservationBytes = payload?.queuedReservationBytes;
  const templateGalleryReservationBytes = payload?.templateGalleryReservationBytes;
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.error !== false ||
    payload.schemaVersion !== 1 ||
    !Array.isArray(downloads) ||
    downloads.length > 256 ||
    !Number.isSafeInteger(activeCount) ||
    activeCount < 0 ||
    activeCount !== downloads.length ||
    !Number.isSafeInteger(queuedReservationBytes) ||
    queuedReservationBytes < 0 ||
    !Number.isSafeInteger(templateGalleryReservationBytes) ||
    templateGalleryReservationBytes < 0 ||
    downloads.some(
      (download) =>
        !download ||
        typeof download !== 'object' ||
        Array.isArray(download) ||
        typeof download.repo_id !== 'string' ||
        download.repo_id.length < 3 ||
        download.repo_id.length > 256 ||
        typeof download.task_id !== 'string' ||
        download.task_id.length < 1 ||
        download.task_id.length > 128 ||
        typeof download.status !== 'string' ||
        download.status.length < 1 ||
        download.status.length > 64 ||
        (download.revision != null &&
          (typeof download.revision !== 'string' || !IMMUTABLE_REVISION.test(download.revision))),
    )
  ) {
    throw new Error('The qualification app download status is malformed or exceeds its bound.');
  }
  const blocked = activeCount > 0 || queuedReservationBytes > 0 || templateGalleryReservationBytes > 0;
  return {
    status: blocked ? 'blocked' : 'ready',
    activeCount,
    queuedReservationBytes,
    templateGalleryReservationBytes,
    activeDownloads: downloads.map((download) => ({
      repo: download.repo_id,
      revision: download.revision ?? null,
      taskId: download.task_id,
      status: download.status,
      phase: typeof download.phase === 'string' ? download.phase : null,
      progress: typeof download.progress === 'number' && Number.isFinite(download.progress) ? download.progress : null,
      remainingBytes:
        Number.isSafeInteger(download.remaining_bytes) && download.remaining_bytes >= 0
          ? download.remaining_bytes
          : null,
    })),
  };
}

function artifactKey(artifact) {
  assertArtifactReceipt(artifact);
  return `${artifact.repo}@${artifact.revision}#${artifact.role}`;
}

function assertArtifactReceipt(artifact) {
  if (
    !artifact ||
    typeof artifact.repo !== 'string' ||
    !artifact.repo ||
    typeof artifact.revision !== 'string' ||
    !IMMUTABLE_REVISION.test(artifact.revision) ||
    typeof artifact.role !== 'string' ||
    !artifact.role
  ) {
    throw new Error('Qualification jobs require exact repo, immutable revision, and role artifact receipts.');
  }
}

function cacheArtifactStatus(cache, artifact) {
  assertArtifactReceipt(artifact);
  const repoEntries = cache.filter((entry) => entry.id === artifact.repo);
  if (repoEntries.length === 0) return { ...artifact, ready: false, reason: 'repository_missing' };
  const revisionEntries = repoEntries.filter(
    (entry) =>
      Array.isArray(entry.revisions) && entry.revisions.some((revision) => revision?.hash === artifact.revision),
  );
  if (revisionEntries.length === 0) return { ...artifact, ready: false, reason: 'revision_missing' };
  if (
    revisionEntries.some(
      (entry) => entry.installed === true && entry.complete === true && entry.repair_required === false,
    )
  ) {
    return { ...artifact, ready: true, reason: null };
  }
  if (revisionEntries.some((entry) => entry.repair_required === true)) {
    return { ...artifact, ready: false, reason: 'repair_required' };
  }
  if (revisionEntries.every((entry) => entry.installed !== true)) {
    return { ...artifact, ready: false, reason: 'not_installed' };
  }
  return { ...artifact, ready: false, reason: 'incomplete' };
}

export function appReadinessForJobs(jobs, cache) {
  if (
    !Array.isArray(jobs) ||
    jobs.length > 10_000 ||
    jobs.some(
      (job) =>
        !job ||
        typeof job !== 'object' ||
        typeof job.templateId !== 'string' ||
        job.templateId.length < 1 ||
        job.templateId.length > 256 ||
        !Array.isArray(job.requiredArtifacts) ||
        job.requiredArtifacts.length > 128,
    ) ||
    !Array.isArray(cache) ||
    cache.length > 10_000 ||
    cache.some(
      (entry) =>
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        typeof entry.id !== 'string' ||
        entry.id.length < 3 ||
        entry.id.length > 256 ||
        !Array.isArray(entry.revisions) ||
        entry.revisions.length > 128 ||
        entry.revisions.some(
          (revision) =>
            !revision || typeof revision !== 'object' || !IMMUTABLE_REVISION.test(String(revision.hash ?? '')),
        ),
    )
  ) {
    throw new Error('The qualification job or app cache inventory is malformed or exceeds its bound.');
  }
  const artifactStatuses = new Map();
  const assessedJobs = jobs.map((job) => {
    const requiredArtifacts = Array.isArray(job.requiredArtifacts) ? job.requiredArtifacts : [];
    if (requiredArtifacts.length === 0) {
      return {
        templateId: job.templateId,
        ready: false,
        blockedArtifacts: [{ ready: false, reason: 'artifact_receipt_missing' }],
      };
    }
    const statuses = requiredArtifacts.map((artifact) => {
      const key = artifactKey(artifact);
      if (!artifactStatuses.has(key)) artifactStatuses.set(key, cacheArtifactStatus(cache, artifact));
      return artifactStatuses.get(key);
    });
    return {
      templateId: job.templateId,
      ready: statuses.every((artifact) => artifact.ready),
      blockedArtifacts: statuses.filter((artifact) => !artifact.ready),
    };
  });
  const artifacts = [...artifactStatuses.values()].sort(
    (left, right) =>
      left.repo.localeCompare(right.repo) ||
      left.revision.localeCompare(right.revision) ||
      left.role.localeCompare(right.role),
  );
  const blockedJobs = assessedJobs.filter((job) => !job.ready);
  return {
    status: blockedJobs.length === 0 ? 'ready' : 'blocked',
    jobCount: assessedJobs.length,
    readyJobCount: assessedJobs.length - blockedJobs.length,
    blockedJobCount: blockedJobs.length,
    artifactCount: artifacts.length,
    readyArtifactCount: artifacts.filter((artifact) => artifact.ready).length,
    blockedArtifactCount: artifacts.filter((artifact) => !artifact.ready).length,
    blockedJobs,
    blockedArtifacts: artifacts.filter((artifact) => !artifact.ready),
  };
}

function inputAssetIdentity(asset) {
  const runtimePath = String(asset?.runtimePath ?? '');
  const match = RUNTIME_INPUT_PATH.exec(runtimePath);
  const runtimeSha256 = String(asset?.runtimeSha256 ?? '');
  if (!match || runtimeSha256 !== `sha256:bytes:${match?.[1] ?? ''}`) {
    throw new Error('Qualification default inputs require a content-addressed runtime path and matching SHA-256.');
  }
  return { runtimePath, runtimeSha256 };
}

function inputAssetStatus(asset, manifestByPath, publicRoots) {
  const { runtimePath, runtimeSha256 } = inputAssetIdentity(asset);
  const manifestPath = runtimePath.replace(/^\/+/, '');
  const manifestAsset = manifestByPath.get(manifestPath);
  if (!manifestAsset) {
    return { runtimePath, runtimeSha256, byteSize: null, ready: false, reason: 'asset_manifest_missing' };
  }
  if (
    manifestAsset.sha256 !== runtimeSha256 ||
    !Number.isSafeInteger(manifestAsset.size) ||
    manifestAsset.size < 0 ||
    manifestAsset.size > MAX_QUALIFICATION_INPUT_BYTES
  ) {
    throw new Error(`Qualification input manifest metadata is invalid for ${runtimePath}.`);
  }
  const status = {
    runtimePath,
    runtimeSha256,
    byteSize: manifestAsset.size,
    ready: false,
    reason: 'local_file_missing',
  };
  for (const publicRoot of publicRoots) {
    const localPath = resolve(publicRoot, manifestPath);
    if (!existsSync(localPath)) continue;
    const file = lstatSync(localPath);
    if (!file.isFile() || file.isSymbolicLink()) return { ...status, reason: 'unsafe_local_file' };
    if (file.size !== manifestAsset.size) return { ...status, reason: 'byte_size_mismatch' };
    const digest = `sha256:bytes:${createHash('sha256').update(readFileSync(localPath)).digest('hex')}`;
    if (digest !== runtimeSha256) return { ...status, reason: 'sha256_mismatch' };
    return { ...status, ready: true, reason: null };
  }
  return status;
}

export function inputReadinessForJobs(
  jobs,
  bindings,
  assetManifest,
  publicRoots = [join(CLIENT_ROOT, 'public'), join(BACKEND_ROOT, 'web')],
) {
  const rootValues = Array.isArray(publicRoots) ? publicRoots : [publicRoots];
  if (
    !Array.isArray(jobs) ||
    jobs.length > 10_000 ||
    jobs.some(
      (job) =>
        !job ||
        typeof job !== 'object' ||
        typeof job.templateId !== 'string' ||
        job.templateId.length < 1 ||
        job.templateId.length > 256,
    ) ||
    !bindings ||
    typeof bindings !== 'object' ||
    Array.isArray(bindings) ||
    !assetManifest ||
    !Array.isArray(assetManifest.assets) ||
    assetManifest.assets.length > 100_000 ||
    rootValues.length < 1 ||
    rootValues.length > 8 ||
    rootValues.some((root) => typeof root !== 'string' || root.length < 1 || root.length > 4096)
  ) {
    throw new Error('The qualification job, input binding, or asset inventory is malformed or exceeds its bound.');
  }
  const roots = rootValues.map((root) => resolve(root));
  const manifestByPath = new Map();
  for (const asset of assetManifest.assets) {
    if (!asset || typeof asset.path !== 'string' || manifestByPath.has(asset.path)) {
      throw new Error('The qualification asset inventory contains an invalid or duplicate path.');
    }
    manifestByPath.set(asset.path, asset);
  }
  const assetStatuses = new Map();
  const assessedJobs = jobs.map((job) => {
    const templateBindings = bindings[job.templateId] ?? [];
    if (!Array.isArray(templateBindings) || templateBindings.length > 128) {
      throw new Error(`Qualification input bindings are malformed for ${job.templateId}.`);
    }
    const statuses = [];
    for (const binding of templateBindings) {
      if (
        !binding ||
        !QUALIFICATION_INPUT_FIELDS.has(binding.field) ||
        !Array.isArray(binding.defaultAssets) ||
        binding.defaultAssets.length < 1 ||
        binding.defaultAssets.length > 128
      ) {
        throw new Error(`Qualification default input binding is malformed for ${job.templateId}.`);
      }
      for (const asset of binding.defaultAssets) {
        const { runtimePath, runtimeSha256 } = inputAssetIdentity(asset);
        if (!assetStatuses.has(runtimePath)) {
          assetStatuses.set(runtimePath, inputAssetStatus(asset, manifestByPath, roots));
        } else if (assetStatuses.get(runtimePath).runtimeSha256 !== runtimeSha256) {
          throw new Error(`Qualification default input bindings disagree for ${runtimePath}.`);
        }
        statuses.push(assetStatuses.get(runtimePath));
      }
    }
    return {
      templateId: job.templateId,
      ready: statuses.every((asset) => asset.ready),
      blockedInputs: statuses.filter((asset) => !asset.ready),
    };
  });
  const assets = [...assetStatuses.values()].sort((left, right) => left.runtimePath.localeCompare(right.runtimePath));
  const blockedJobs = assessedJobs.filter((job) => !job.ready);
  return {
    status: blockedJobs.length === 0 ? 'ready' : 'blocked',
    jobCount: assessedJobs.length,
    readyJobCount: assessedJobs.length - blockedJobs.length,
    blockedJobCount: blockedJobs.length,
    assetCount: assets.length,
    readyAssetCount: assets.filter((asset) => asset.ready).length,
    blockedAssetCount: assets.filter((asset) => !asset.ready).length,
    requiredBytes: assets.reduce((total, asset) => total + (asset.byteSize ?? 0), 0),
    blockedJobs,
    blockedAssets: assets.filter((asset) => !asset.ready),
  };
}

async function fetchAppCache(server, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('Qualification cache timeout must be between 1 and 120000 milliseconds.');
  }
  const response = await fetch(appCacheUrl(server), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`The app cache readiness request failed with HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 8 * 1024 * 1024) {
    throw new Error('The app cache readiness response exceeds the 8 MiB bound.');
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > 8 * 1024 * 1024) {
    throw new Error('The app cache readiness response exceeds the 8 MiB bound.');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('The app cache readiness response is not valid JSON.');
  }
}

async function fetchAppDownloadStatus(server, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('Qualification download-status timeout must be between 1 and 120000 milliseconds.');
  }
  const response = await fetch(appDownloadStatusUrl(server), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`The app download-status request failed with HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > 1024 * 1024) {
    throw new Error('The app download-status response exceeds the 1 MiB bound.');
  }
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > 1024 * 1024) {
    throw new Error('The app download-status response exceeds the 1 MiB bound.');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('The app download-status response is not valid JSON.');
  }
}

function writeState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

export function campaignStatusForRunner(result) {
  if (!result.error && result.status === 0) return 'qualified';
  if (result.status === RUNNER_INFRASTRUCTURE_EXIT_CODE) return 'infrastructure_failed';
  return 'failed';
}

export function jobGroups(jobs, batchByModelFamily) {
  if (!batchByModelFamily) return jobs.map((job) => ({ modelFamily: job.modelFamily, jobs: [job] }));
  const groups = new Map();
  for (const job of jobs) {
    const group = groups.get(job.modelFamily) ?? [];
    group.push(job);
    groups.set(job.modelFamily, group);
  }
  return [...groups].map(([modelFamily, groupedJobs]) => ({ modelFamily, jobs: groupedJobs }));
}

export function galleryArgsForGroup(args, templateIds) {
  return [
    join(CLIENT_ROOT, 'scripts', 'template-gallery-runner.mjs'),
    '--template',
    templateIds.join(','),
    '--reviewed',
    // A published non-exact example is precisely one of the items the
    // qualification campaign must be able to execute and measure. Human
    // gallery approval remains separate from this locked execution receipt.
    '--allow-non-exact',
    '--record-qualification',
    // A shared graph/runtime defect usually affects every following template
    // using the same loader contract. Stop at the first failure so it can be
    // repaired and tested as a batch instead of spending hours collecting the
    // same failure repeatedly.
    '--stop-on-failure',
    // V2 qualification receipts are resource-recipe evidence. Running a
    // template's catalog default in Expert mode can produce valid media but
    // cannot identify the planner candidate that was measured, making the
    // entire run ineligible for a receipt. Force Auto for qualification only;
    // the locked prompt, graph, and generation settings remain the template's.
    '--resource-mode',
    'auto',
    '--no-backend-start',
    '--server',
    args.server,
    ...(args.batchByModelFamily ? ['--reuse-runtime-within-model'] : []),
    ...(args.reuseExistingRuntimeKey ? ['--reuse-existing-runtime-key', args.reuseExistingRuntimeKey] : []),
    '--port',
    String(args.port),
    '--timeout-ms',
    String(args.timeoutMs),
    '--queue-wait-timeout-ms',
    String(args.queueWaitTimeoutMs),
  ];
}

export async function runCampaign(argv = process.argv) {
  const args = parseArgs(argv);
  // A previous or interrupted gallery run can write a valid receipt before
  // this campaign state is finalized. Always rebuild the contract before
  // selecting work so resume never repeats a template that is already
  // qualified merely because release-contract.v1.json was stale.
  refreshReports({ inherit: !args.dryRun });
  const selection = selectedJobs(readJson(CONTRACT_PATH), args);
  const groups = jobGroups(selection.jobs, args.batchByModelFamily);
  const appReadiness = args.checkAppReadiness
    ? appReadinessForJobs(selection.jobs, await fetchAppCache(args.server, args.cacheTimeoutMs))
    : null;
  const downloadReadiness =
    !args.dryRun || args.checkDownloadIdle
      ? downloadReadinessForStatus(await fetchAppDownloadStatus(args.server, args.cacheTimeoutMs))
      : null;
  const inputReadiness = args.checkInputReadiness
    ? inputReadinessForJobs(selection.jobs, readJson(INPUT_BINDINGS_PATH), readJson(ASSET_MANIFEST_PATH))
    : null;
  if (args.reuseExistingRuntimeKey && groups.length > 1) {
    throw new Error('--reuse-existing-runtime-key is only safe for a campaign containing one model-family group.');
  }
  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          format: 'modiff.template-qualification-campaign.v1',
          dryRun: true,
          count: selection.jobs.length,
          deferredCount: selection.deferred.length,
          batchByModelFamily: args.batchByModelFamily,
          reuseExistingRuntimeKey: args.reuseExistingRuntimeKey || null,
          excludedMedia: [...new Set(args.excludedMedia)],
          appReadiness,
          downloadReadiness,
          inputReadiness,
          groups: groups.map((group) => ({
            modelFamily: group.modelFamily,
            templateIds: group.jobs.map((job) => job.templateId),
          })),
          jobs: selection.jobs,
          deferred: selection.deferred,
        },
        null,
        2,
      ),
    );
    return [appReadiness, downloadReadiness, inputReadiness].some((readiness) => readiness?.status === 'blocked')
      ? 1
      : 0;
  }

  if ([appReadiness, downloadReadiness, inputReadiness].some((readiness) => readiness?.status === 'blocked')) {
    console.error(JSON.stringify({ appReadiness, downloadReadiness, inputReadiness }, null, 2));
    return 1;
  }

  const state = {
    schemaVersion: 1,
    format: 'modiff.template-qualification-campaign.v1',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    backendUrl: args.server,
    batchByModelFamily: args.batchByModelFamily,
    reuseExistingRuntimeKey: args.reuseExistingRuntimeKey || null,
    excludedMedia: [...new Set(args.excludedMedia)],
    appReadiness,
    downloadReadiness,
    inputReadiness,
    jobs: selection.jobs,
    deferred: selection.deferred,
  };
  writeState(state);

  for (const group of groups) {
    const currentDownloadReadiness = downloadReadinessForStatus(
      await fetchAppDownloadStatus(args.server, args.cacheTimeoutMs),
    );
    state.downloadReadiness = currentDownloadReadiness;
    if (currentDownloadReadiness.status === 'blocked') {
      state.status = 'blocked';
      state.stoppedReason =
        `App downloads became active before the ${group.modelFamily} qualification group; ` +
        'no graph in that group was submitted.';
      state.updatedAt = new Date().toISOString();
      writeState(state);
      console.error(JSON.stringify({ downloadReadiness: currentDownloadReadiness }, null, 2));
      return 1;
    }
    const startedAt = new Date().toISOString();
    for (const job of group.jobs) {
      job.startedAt = startedAt;
    }
    state.activeGroup = {
      modelFamily: group.modelFamily,
      templateIds: group.jobs.map((job) => job.templateId),
      startedAt,
      status: 'running',
    };
    state.updatedAt = startedAt;
    writeState(state);
    const templateIds = group.jobs.map((job) => job.templateId);
    const result = run(process.execPath, galleryArgsForGroup(args, templateIds), { inherit: true });
    const finishedAt = new Date().toISOString();
    refreshReports();
    const refreshedTemplates = new Map(readJson(CONTRACT_PATH).templates.map((template) => [template.id, template]));
    const runnerStatus = campaignStatusForRunner(result);
    const unresolved = [];
    for (const job of group.jobs) {
      const refreshed = refreshedTemplates.get(job.templateId);
      const missing = refreshed?.qualificationReceiptMissingFields ?? job.missing;
      job.finishedAt = finishedAt;
      job.missing = missing;
      job.exitCode = result.status;
      job.error = result.error?.message ?? null;
      if (missing.length === 0) {
        job.status = 'qualified';
      } else {
        unresolved.push(job);
        job.status = runnerStatus === 'infrastructure_failed' ? 'pending' : 'failed';
      }
    }
    state.activeGroup = null;
    state.updatedAt = finishedAt;
    if (runnerStatus === 'infrastructure_failed' && unresolved.length > 0) {
      unresolved[0].status = 'infrastructure_failed';
      state.stoppedReason =
        `Qualification infrastructure failed while running ${unresolved[0].templateId} in ${group.modelFamily}; ` +
        'remaining templates were left pending instead of being mislabeled as failures.';
      writeState(state);
      break;
    }
    writeState(state);
  }

  state.finishedAt = new Date().toISOString();
  state.activeGroup = null;
  state.updatedAt = state.finishedAt;
  state.coverage = {
    total: state.jobs.length,
    qualified: state.jobs.filter((job) => job.status === 'qualified').length,
    failed: state.jobs.filter((job) => job.status === 'failed').length,
    infrastructureFailed: state.jobs.filter((job) => job.status === 'infrastructure_failed').length,
    pending: state.jobs.filter((job) => job.status === 'pending').length,
    deferredMedia: state.deferred.filter((job) => job.status === 'deferred_media').length,
    userOwnedExcluded: state.deferred.filter((job) => job.status === 'user_owned_excluded').length,
  };
  writeState(state);
  console.log(JSON.stringify(state.coverage, null, 2));
  return state.coverage.failed > 0 || state.coverage.infrastructureFailed > 0 || state.coverage.pending > 0 ? 1 : 0;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  process.exitCode = await runCampaign();
}
