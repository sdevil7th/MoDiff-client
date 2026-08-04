import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONFIG_PATH = join(ROOT, 'scripts', 'template-gallery-source-assets.json');
const RUN_ROOT = join(ROOT, 'artifacts', 'template-gallery');
const STAGING_ROOT = join(RUN_ROOT, 'source-assets');

function parseArgs(argv) {
  const args = { command: 'run' };
  for (let index = 2; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === '--list') {
      args.command = 'list';
      continue;
    }
    if (entry === '--help' || entry === '-h') {
      args.command = 'help';
      continue;
    }
    if (!entry.startsWith('--')) throw new Error(`Unexpected positional argument: ${entry}`);
    const [key, inlineValue] = entry.slice(2).split('=');
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (!value || String(value).startsWith('--')) throw new Error(`--${key} requires a value.`);
    if (key === 'asset') args.assetId = String(value);
    else if (key === 'server') args.server = String(value);
    else if (key === 'port') args.port = String(value);
    else throw new Error(`Unknown option: --${key}`);
  }
  return args;
}

function usage() {
  return `
Usage:
  npm run gallery:source -- --list
  npm run gallery:source -- --asset <id> [--server <url>] [--port <number>]

Runs exactly one source-only app capture from the checked-in source catalog. The
result is staged under artifacts/template-gallery/source-assets for review and is
never added to the public gallery automatically.
`.trim();
}

function loadConfig() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  if (config.schemaVersion !== 1 || !Array.isArray(config.assets)) {
    throw new Error(`Invalid source-asset config: ${CONFIG_PATH}`);
  }
  const ids = new Set();
  for (const asset of config.assets) {
    if (!asset?.id || !asset?.template || !asset?.prompt)
      throw new Error('Every source asset needs id, template, and prompt.');
    if (ids.has(asset.id)) throw new Error(`Duplicate source asset id: ${asset.id}`);
    ids.add(asset.id);
  }
  return config;
}

function runDirectories() {
  if (!existsSync(RUN_ROOT)) return new Set();
  return new Set(
    readdirSync(RUN_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('-run'))
      .map((entry) => entry.name),
  );
}

function newestNewRun(previous) {
  const candidates = readdirSync(RUN_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('-run') && !previous.has(entry.name))
    .map((entry) => join(RUN_ROOT, entry.name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return candidates[0] ?? null;
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function stageResult(asset, runDir) {
  const reportPath = join(runDir, 'report.json');
  if (!existsSync(reportPath)) throw new Error(`Source capture did not write a report: ${reportPath}`);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const result = report.results?.find((item) => item.templateId === asset.template && !item.skipped);
  const output = result?.outputs?.[0];
  if (report.mode !== 'source-only' || !output?.filePath || !existsSync(output.filePath)) {
    throw new Error(result?.reason || report.skipped?.[0]?.reason || 'Source capture did not produce usable media.');
  }

  mkdirSync(STAGING_ROOT, { recursive: true });
  const extension = extname(output.filePath).toLowerCase();
  const stagedFilename = asset.stagedFilename || `${asset.id}${extension}`;
  if (extname(stagedFilename).toLowerCase() !== extension) {
    throw new Error(
      `Configured stagedFilename extension ${extname(stagedFilename)} does not match captured ${extension} for ${asset.id}.`,
    );
  }
  const stagedPath = join(STAGING_ROOT, stagedFilename);
  const metadataPath = join(STAGING_ROOT, `${asset.id}.source.json`);
  copyFileSync(output.filePath, stagedPath);
  const metadata = {
    schemaVersion: 1,
    status: 'awaiting_visual_review',
    assetId: asset.id,
    templateId: asset.template,
    mediaType: asset.mediaType,
    downstreamTemplates: asset.downstreamTemplates ?? [],
    prompt: asset.prompt,
    negativePrompt: asset.negativePrompt ?? '',
    contentHash: sha256File(stagedPath),
    byteSize: statSync(stagedPath).size,
    stagedPath,
    sourceRun: runDir,
    reportPath,
    provenancePath: output.evidence?.provenance ?? null,
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return { stagedPath, metadataPath, metadata };
}

function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig();
  if (args.command === 'help') {
    console.log(usage());
    return;
  }
  if (args.command === 'list') {
    console.log(
      JSON.stringify(
        config.assets.map((asset) => ({
          id: asset.id,
          template: asset.template,
          mediaType: asset.mediaType,
          downstreamTemplates: asset.downstreamTemplates ?? [],
        })),
        null,
        2,
      ),
    );
    return;
  }

  const asset = config.assets.find((item) => item.id === args.assetId);
  if (!asset) throw new Error(`Unknown --asset ${JSON.stringify(args.assetId)}. Use --list to inspect available ids.`);
  const previousRuns = runDirectories();
  const runnerArgs = [
    join(ROOT, 'scripts', 'template-gallery-runner.mjs'),
    '--source-only',
    '--template',
    asset.template,
    '--runs',
    '1',
    '--prompt-override',
    asset.prompt,
    '--output-name',
    asset.id,
    '--timeout-ms',
    String(asset.timeoutMs ?? 1800000),
  ];
  if (asset.referenceImages?.length) {
    runnerArgs.push('--reference-image', asset.referenceImages.map((item) => resolve(ROOT, item)).join(','));
  }
  if (asset.negativePrompt) runnerArgs.push('--negative-prompt-override', asset.negativePrompt);
  if (asset.width) runnerArgs.push('--width', String(asset.width));
  if (asset.height) runnerArgs.push('--height', String(asset.height));
  if (asset.steps) runnerArgs.push('--steps', String(asset.steps));
  if (args.server) runnerArgs.push('--server', args.server);
  if (args.port) runnerArgs.push('--port', args.port);

  const child = spawnSync(process.execPath, runnerArgs, { cwd: ROOT, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
  const runDir = newestNewRun(previousRuns);
  if (!runDir) throw new Error('Source capture completed without a new run directory.');
  console.log(JSON.stringify(stageResult(asset, runDir), null, 2));
}

main();
