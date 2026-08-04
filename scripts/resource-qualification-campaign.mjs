import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const CONTRACT_PATH = join(BACKEND_ROOT, 'data', 'release-contract.v1.json');
const COVERAGE_PATH = join(BACKEND_ROOT, 'data', 'qualification', 'release', 'resource-recipe-coverage.v1.json');
const STATE_PATH = resolve(
  process.env.MODIFF_RESOURCE_CAMPAIGN_STATE ||
    join(CLIENT_ROOT, 'artifacts', 'resource-qualification', 'campaign-state.v1.json'),
);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    includeDeferred: false,
    includeQuantized: false,
    maxRecipes: Number.POSITIVE_INFINITY,
    port: Number(process.env.MODIFF_RESOURCE_QUALIFICATION_FRONTEND_PORT || 5194),
    server: process.env.MODIFF_GALLERY_SERVER || 'http://127.0.0.1:8088',
    timeoutMs: 8 * 60 * 60 * 1000,
    queueWaitTimeoutMs: 3 * 60 * 60 * 1000,
    templates: [],
    offloadModes: [],
  };
  for (let index = 2; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (entry === '--include-deferred') {
      args.includeDeferred = true;
      continue;
    }
    if (entry === '--include-quantized') {
      args.includeQuantized = true;
      continue;
    }
    const value = argv[index + 1];
    if (entry === '--max-recipes') {
      args.maxRecipes = Math.max(0, Number(value));
      index += 1;
    } else if (entry === '--port') {
      args.port = Number(value);
      index += 1;
    } else if (entry === '--server') {
      args.server = String(value);
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
    } else if (entry === '--offload-mode') {
      args.offloadModes.push(
        ...String(value ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );
      index += 1;
    } else {
      throw new Error(`Unknown resource campaign option: ${entry}`);
    }
  }
  return args;
}

function recipeKey(recipe) {
  return [recipe.modelType, recipe.dtype, recipe.offloadMode, recipe.quantizationMode].join('|');
}

function representativeTemplate(recipe, contractById) {
  return [...recipe.templates]
    .map((templateId) => contractById.get(templateId))
    .filter(Boolean)
    .sort(
      (left, right) =>
        Number(left.lastSuccessfulRealRun?.executionDurationSeconds ?? Number.POSITIVE_INFINITY) -
          Number(right.lastSuccessfulRealRun?.executionDurationSeconds ?? Number.POSITIVE_INFINITY) ||
        left.id.localeCompare(right.id),
    )[0];
}

export function selectResourceQualificationJobs(contract, coverage, args) {
  const requestedTemplates = new Set(args.templates);
  const requestedOffloadModes = new Set(args.offloadModes);
  const contractById = new Map(contract.templates.map((template) => [template.id, template]));
  return coverage.recipes
    .filter((recipe) => recipe.status === 'missing')
    .filter((recipe) => args.includeDeferred || recipe.releaseLane === 'release_eligible')
    .filter((recipe) => args.includeQuantized || recipe.quantizationMode === 'none')
    .filter((recipe) => requestedOffloadModes.size === 0 || requestedOffloadModes.has(recipe.offloadMode))
    .filter(
      (recipe) =>
        requestedTemplates.size === 0 || recipe.templates.some((templateId) => requestedTemplates.has(templateId)),
    )
    .map((recipe) => {
      const template = representativeTemplate(recipe, contractById);
      if (!template) throw new Error(`No current template owns missing resource recipe ${recipeKey(recipe)}.`);
      return {
        key: recipeKey(recipe),
        modelType: recipe.modelType,
        dtype: recipe.dtype,
        offloadMode: recipe.offloadMode,
        quantizationMode: recipe.quantizationMode,
        releaseLane: recipe.releaseLane,
        templateId: template.id,
        baselineExecutionDurationSeconds: Number(
          template.lastSuccessfulRealRun?.executionDurationSeconds ?? Number.POSITIVE_INFINITY,
        ),
        owningTemplates: recipe.templates,
        status: 'pending',
      };
    })
    .sort(
      (left, right) =>
        left.baselineExecutionDurationSeconds - right.baselineExecutionDurationSeconds ||
        left.modelType.localeCompare(right.modelType) ||
        left.offloadMode.localeCompare(right.offloadMode) ||
        left.quantizationMode.localeCompare(right.quantizationMode),
    )
    .slice(0, Number.isFinite(args.maxRecipes) ? args.maxRecipes : undefined);
}

export function galleryArgsForResourceJob(job, args) {
  return [
    join(CLIENT_ROOT, 'scripts', 'template-gallery-runner.mjs'),
    '--template',
    job.templateId,
    '--record-resource-qualification',
    '--resource-mode',
    'expert',
    '--offload-mode',
    job.offloadMode,
    '--quantization-mode',
    job.quantizationMode,
    '--no-backend-start',
    '--server',
    args.server,
    '--port',
    String(args.port),
    '--timeout-ms',
    String(args.timeoutMs),
    '--queue-wait-timeout-ms',
    String(args.queueWaitTimeoutMs),
  ];
}

function run(command, args, { inherit = false } = {}) {
  return spawnSync(command, args, {
    cwd: CLIENT_ROOT,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    env: { ...process.env, MODIFF_BACKEND_DIR: BACKEND_ROOT },
  });
}

function refreshCoverage({ inherit = false } = {}) {
  const result = run('npm', ['run', 'release:qualification:generate'], { inherit });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Could not regenerate resource qualification coverage: ${result.error?.message ?? `exit ${result.status}`}.`,
    );
  }
}

function writeState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

export function runResourceCampaign(argv = process.argv) {
  const args = parseArgs(argv);
  refreshCoverage({ inherit: !args.dryRun });
  const jobs = selectResourceQualificationJobs(readJson(CONTRACT_PATH), readJson(COVERAGE_PATH), args);
  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          format: 'modiff.resource-qualification-campaign.v1',
          dryRun: true,
          count: jobs.length,
          includeDeferred: args.includeDeferred,
          includeQuantized: args.includeQuantized,
          jobs,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const state = {
    schemaVersion: 1,
    format: 'modiff.resource-qualification-campaign.v1',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    backendUrl: args.server,
    includeDeferred: args.includeDeferred,
    includeQuantized: args.includeQuantized,
    jobs,
  };
  writeState(state);

  for (const job of jobs) {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    state.updatedAt = job.startedAt;
    writeState(state);
    const result = run(process.execPath, galleryArgsForResourceJob(job, args), { inherit: true });
    refreshCoverage({ inherit: true });
    const refreshed = readJson(COVERAGE_PATH).recipes.find((recipe) => recipeKey(recipe) === job.key);
    job.finishedAt = new Date().toISOString();
    job.exitCode = result.status;
    job.error = result.error?.message ?? null;
    job.status = refreshed?.status === 'qualified' ? 'qualified' : 'failed';
    state.updatedAt = job.finishedAt;
    writeState(state);
    if (job.status === 'failed') {
      state.stoppedReason = `Resource qualification failed for ${job.key}; later recipes remain pending.`;
      break;
    }
  }

  state.finishedAt = new Date().toISOString();
  state.updatedAt = state.finishedAt;
  state.coverage = {
    total: jobs.length,
    qualified: jobs.filter((job) => job.status === 'qualified').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    pending: jobs.filter((job) => job.status === 'pending').length,
  };
  writeState(state);
  console.log(JSON.stringify(state.coverage, null, 2));
  return state.coverage.failed > 0 || state.coverage.pending > 0 ? 1 : 0;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) process.exitCode = runResourceCampaign();
