import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const CONTRACT_PATH = join(BACKEND_ROOT, 'data', 'release-contract.v1.json');
const STATE_PATH = resolve(
  process.env.MODIFF_QUALIFICATION_CAMPAIGN_STATE ||
    join(CLIENT_ROOT, 'artifacts', 'template-qualification', 'campaign-state.v1.json'),
);
const USER_OWNED_TEMPLATE_IDS = new Set();
export const RUNNER_INFRASTRUCTURE_EXIT_CODE = 70;

function parseArgs(argv) {
  const args = {
    dryRun: false,
    maxTemplates: Number.POSITIVE_INFINITY,
    port: Number(process.env.MODIFF_QUALIFICATION_FRONTEND_PORT || 5194),
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
    const value = argv[index + 1];
    if (entry === '--max-templates') {
      args.maxTemplates = Math.max(0, Number(value));
      index += 1;
    } else if (entry === '--port') {
      args.port = Number(value);
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

export function runCampaign(argv = process.argv) {
  const args = parseArgs(argv);
  // A previous or interrupted gallery run can write a valid receipt before
  // this campaign state is finalized. Always rebuild the contract before
  // selecting work so resume never repeats a template that is already
  // qualified merely because release-contract.v1.json was stale.
  refreshReports({ inherit: !args.dryRun });
  const selection = selectedJobs(readJson(CONTRACT_PATH), args);
  const groups = jobGroups(selection.jobs, args.batchByModelFamily);
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
    return 0;
  }

  const state = {
    schemaVersion: 1,
    format: 'modiff.template-qualification-campaign.v1',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    backendUrl: process.env.MODIFF_GALLERY_SERVER || 'http://127.0.0.1:8088',
    batchByModelFamily: args.batchByModelFamily,
    reuseExistingRuntimeKey: args.reuseExistingRuntimeKey || null,
    excludedMedia: [...new Set(args.excludedMedia)],
    jobs: selection.jobs,
    deferred: selection.deferred,
  };
  writeState(state);

  for (const group of groups) {
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
  process.exitCode = runCampaign();
}
