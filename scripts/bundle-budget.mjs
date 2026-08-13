import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url);
const DIST_ASSETS = new URL('../dist/assets/', import.meta.url);
const DIST_LICENSES = new URL('../dist/THIRD_PARTY_LICENSES.txt', import.meta.url);
const SOURCE_LICENSES = new URL('../public/THIRD_PARTY_LICENSES.txt', import.meta.url);
// The capability-driven media contract and graph workspace share one stable
// production bundle. Keep a narrow margin over the measured largest chunk.
const MAX_ENTRY_GZIP_BYTES = 438 * 1024;
// Media contracts, task-template validation, and queue/workflow-ownership
// guards are intentionally fail-closed. The reviewed production surface is
// currently about 517.3 KiB after the P5.2 AnimateDiff controls; retain a
// sub-KiB ceiling so unrelated growth still fails this gate.
const MAX_TOTAL_GZIP_BYTES = 518 * 1024;

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

let names;
try {
  names = readdirSync(DIST_ASSETS).filter((name) => name.endsWith('.js'));
} catch {
  throw new Error('Bundle budget requires a production build. Run `npm run build` first.');
}

if (names.length === 0) {
  throw new Error('Bundle budget found no JavaScript assets in dist/assets.');
}

const assets = names
  .map((name) => {
    const path = new URL(name, DIST_ASSETS);
    const bytes = readFileSync(path);
    return {
      file: relative(ROOT.pathname, path.pathname).replaceAll('\\', '/'),
      rawBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
    };
  })
  .sort((left, right) => right.gzipBytes - left.gzipBytes);

const entry = assets[0];
const totalGzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const failures = [];

if (!existsSync(DIST_LICENSES)) {
  failures.push('dist/THIRD_PARTY_LICENSES.txt is missing');
} else if (readFileSync(DIST_LICENSES, 'utf8') !== readFileSync(SOURCE_LICENSES, 'utf8')) {
  failures.push('dist/THIRD_PARTY_LICENSES.txt does not match the reviewed source notice');
}

if (entry.gzipBytes > MAX_ENTRY_GZIP_BYTES) {
  failures.push(`largest chunk ${formatBytes(entry.gzipBytes)} exceeds ${formatBytes(MAX_ENTRY_GZIP_BYTES)}`);
}
if (totalGzipBytes > MAX_TOTAL_GZIP_BYTES) {
  failures.push(`total JavaScript ${formatBytes(totalGzipBytes)} exceeds ${formatBytes(MAX_TOTAL_GZIP_BYTES)}`);
}

console.log(
  JSON.stringify(
    {
      budgets: { maxEntryGzipBytes: MAX_ENTRY_GZIP_BYTES, maxTotalGzipBytes: MAX_TOTAL_GZIP_BYTES },
      entry,
      totalGzipBytes,
      assets,
      ok: failures.length === 0,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exitCode = 1;
