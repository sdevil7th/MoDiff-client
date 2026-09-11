import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registeredCatalogBytesMatch } from './registered-block-v2-catalog-bytes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_ROOT = path.resolve(ROOT, '..', 'MoDiff');
const OUTPUT = path.join(BACKEND_ROOT, 'modiff', 'registered_block_v2_catalog.v1.json.gz');
const check = process.argv.includes('--check');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with status ${result.status}.\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  return result;
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'modiff-block-v2-catalog-'));
try {
  const auditOutput = path.join(temporaryDirectory, 'route-audit.json');
  const generatedOutput = path.join(temporaryDirectory, 'registered-block-v2-catalog.json.gz');
  run(process.execPath, ['--test', 'scripts/registered-block-v2-route-audit.test.mjs'], {
    env: {
      ...process.env,
      MODIFF_ROUTE_CANDIDATES_ONLY: '1',
      MODIFF_ROUTE_CANDIDATES_FULL: '1',
      MODIFF_ROUTE_CANDIDATE_OUTPUT: auditOutput,
    },
  });
  const generated = run(process.execPath, [
    'scripts/generate-registered-block-v2-catalog.mjs',
    auditOutput,
    generatedOutput,
  ]);
  const candidate = await readFile(generatedOutput);
  if (check) {
    const current = await readFile(OUTPUT).catch(() => null);
    if (!current || !registeredCatalogBytesMatch(current, candidate)) {
      throw new Error('The checked-in registered Block V2 catalog is stale. Run npm run catalog:block-v2:generate.');
    }
    process.stdout.write(`Registered Block V2 catalog is current: ${OUTPUT}\n`);
  } else {
    await writeFile(OUTPUT, candidate);
    process.stdout.write(generated.stdout);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
