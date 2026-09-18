import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url);
const DIST_ASSETS = new URL('../dist/assets/', import.meta.url);
const DIST_INDEX = new URL('../dist/index.html', import.meta.url);
const DIST_LICENSES = new URL('../dist/THIRD_PARTY_LICENSES.txt', import.meta.url);
const SOURCE_LICENSES = new URL('../public/THIRD_PARTY_LICENSES.txt', import.meta.url);
// Keep an independently bounded startup chunk as well as a bounded complete
// startup graph. The 122-admission catalog adds 20 exact FLUX route records
// (about 3 KiB compressed): a bounded 4 KiB increase over the former 582 KiB
// ceiling covers that data. Deferred UI and individual chunk limits do not grow.
const MAX_STARTUP_CHUNK_GZIP_BYTES = 438 * 1024;
// Shared icons initialize in graph-vendor, avoiding an entry/lazy-panel cycle
// that captured undefined tab icons and crashed cold production startup. The
// Earlier startup measured 589.1 KiB. Shared Block crossing, explicit movement,
// scoped execution and durable previews bring it to 593.4 KiB; bound this
// checkpoint at 600 KiB without raising individual-chunk or deferred ceilings.
// Automatic nested legacy preparation and validated runtime resource updates
// measure 600.6 KiB together. Bound this feature addition at 602 KiB; keep
// individual-chunk and deferred limits unchanged.
// Shared operation seed editing/export adds 1.1 KiB to startup (603.0 KiB
// measured). Bound it at 604 KiB; retain both individual chunk ceilings.
// M6 validates custom-extension identity and dependency responses in the shared
// store. Startup measures 604.1 KiB; bound it at 605 KiB without increasing the
// individual chunk limit. The extension review panel is loaded on demand.
const MAX_STARTUP_GZIP_BYTES = 605 * 1024;
// Deferred surfaces are measured separately so code splitting cannot hide an
// unbounded feature bundle. These ceilings leave room for the reviewed dialogs
// and catalog tools while preventing either one oversized deferred chunk or
// unchecked aggregate growth.
const MAX_DEFERRED_CHUNK_GZIP_BYTES = 64 * 1024;
// The custom-workspace inspector now resolves declared Block controls and hidden
// pins, and exposes graph-owned artifact actions. Measured deferred code is
// 192.9 KiB. Bound this correctness fix at 194 KiB; startup and chunk caps stay fixed.
// Canonical operation/coverage validation and the lazy operation picker/resolver
// add about 4.4 KiB to the previous 193.7 KiB deferred graph. Measured total is
// 198.1 KiB; bound the added feature at 199 KiB. Startup and per-chunk caps stay fixed.
// Connected starters, atomic graph adaptation and implementation inspection add
// 5.8 KiB of deferred code. Measured total is 203.9 KiB; bound M4 at 204 KiB.
// Startup and individual chunk ceilings remain unchanged.
// Separate recompute/release controls add 0.2 KiB (204.1 KiB measured).
// Bound this addition at 205 KiB; startup and per-chunk caps stay fixed.
// M6 replaces the old module manager with one lazy source/approval/reload panel.
// The deferred graph measures 206.2 KiB; bound it at 207 KiB while retaining the
// per-chunk ceiling and requiring a cold production browser check.
// M7 adds the lazy service-interface export dialog (208.3 KiB aggregate).
// Bound the added surface at 209 KiB; startup and individual chunk caps stay fixed.
const MAX_DEFERRED_GZIP_BYTES = 209 * 1024;

const STATIC_MODULE_REFERENCE =
  /\b(?:import(?=\s|["'{*])(?!\s*\()|export(?=\s|["'{*]))[^;]*?["'](\.\/[^"'?]+\.js)(?:\?v=[0-9a-f]{16})?["']/g;

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
      name,
      file: relative(ROOT.pathname, path.pathname).replaceAll('\\', '/'),
      rawBytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9 }).length,
      source: bytes.toString('utf8'),
    };
  })
  .sort((left, right) => right.gzipBytes - left.gzipBytes);

const assetByName = new Map(assets.map((asset) => [asset.name, asset]));
const failures = [];
let entryNames = [];

if (!existsSync(DIST_INDEX)) {
  failures.push('dist/index.html is missing');
} else {
  const indexHtml = readFileSync(DIST_INDEX, 'utf8');
  const shellVersions = [...indexHtml.matchAll(/(?:href|src)="\/assets\/[^"?]+\.(?:css|js)\?v=([0-9a-f]{16})"/g)].map(
    (match) => match[1],
  );
  if (shellVersions.length < 2 || new Set(shellVersions).size !== 1) {
    failures.push('dist/index.html shell assets do not share one content-derived cache version');
  }
  if (/(?:href|src)="\/assets\/[^"?]+\.(?:css|js)"/.test(indexHtml)) {
    failures.push('dist/index.html contains an unversioned JavaScript or CSS shell asset');
  }
  entryNames = [...indexHtml.matchAll(/<script\b[^>]*\bsrc="\/assets\/([^"?]+\.js)\?v=[0-9a-f]{16}"[^>]*>/g)]
    .map((match) => match[1])
    .filter((name, index, entries) => entries.indexOf(name) === index);
  if (entryNames.length === 0) {
    failures.push('dist/index.html does not declare a versioned JavaScript entry');
  }
  const unversionedImports = names.filter((name) => /["']\.\/[^"'?]+\.js["']/.test(assetByName.get(name).source));
  if (unversionedImports.length > 0) {
    failures.push(`JavaScript chunks contain unversioned local imports: ${unversionedImports.join(', ')}`);
  }
}

function staticDependencies(source) {
  return [...source.matchAll(STATIC_MODULE_REFERENCE)].map((match) => match[1].slice(2));
}

const startupNames = new Set();
const pendingStartupNames = [...entryNames];
while (pendingStartupNames.length > 0) {
  const name = pendingStartupNames.pop();
  if (startupNames.has(name)) continue;
  const asset = assetByName.get(name);
  if (!asset) {
    failures.push(`startup module graph references missing JavaScript asset: ${name}`);
    continue;
  }
  startupNames.add(name);
  for (const dependency of staticDependencies(asset.source)) {
    if (!startupNames.has(dependency)) pendingStartupNames.push(dependency);
  }
}

const publicAsset = ({ file, rawBytes, gzipBytes }) => ({ file, rawBytes, gzipBytes });
const publicAssets = assets.map(publicAsset);
const startupAssets = assets.filter((asset) => startupNames.has(asset.name));
const deferredAssets = assets.filter((asset) => !startupNames.has(asset.name));
const entries = entryNames.map((name) => assetByName.get(name)).filter(Boolean);
const entry = entries[0] ? publicAsset(entries[0]) : null;
const largestStartupAsset = startupAssets[0] ? publicAsset(startupAssets[0]) : null;
const largestDeferredAsset = deferredAssets[0] ? publicAsset(deferredAssets[0]) : null;
const startupGzipBytes = startupAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const deferredGzipBytes = deferredAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const allJavascriptGzipBytes = startupGzipBytes + deferredGzipBytes;

if (!existsSync(DIST_LICENSES)) {
  failures.push('dist/THIRD_PARTY_LICENSES.txt is missing');
} else if (readFileSync(DIST_LICENSES, 'utf8') !== readFileSync(SOURCE_LICENSES, 'utf8')) {
  failures.push('dist/THIRD_PARTY_LICENSES.txt does not match the reviewed source notice');
}

if (largestStartupAsset?.gzipBytes > MAX_STARTUP_CHUNK_GZIP_BYTES) {
  failures.push(
    `largest startup chunk ${formatBytes(largestStartupAsset.gzipBytes)} exceeds ${formatBytes(MAX_STARTUP_CHUNK_GZIP_BYTES)}`,
  );
}
if (startupGzipBytes > MAX_STARTUP_GZIP_BYTES) {
  failures.push(`startup JavaScript ${formatBytes(startupGzipBytes)} exceeds ${formatBytes(MAX_STARTUP_GZIP_BYTES)}`);
}
if (largestDeferredAsset?.gzipBytes > MAX_DEFERRED_CHUNK_GZIP_BYTES) {
  failures.push(
    `largest deferred chunk ${formatBytes(largestDeferredAsset.gzipBytes)} exceeds ${formatBytes(MAX_DEFERRED_CHUNK_GZIP_BYTES)}`,
  );
}
if (deferredGzipBytes > MAX_DEFERRED_GZIP_BYTES) {
  failures.push(
    `deferred JavaScript ${formatBytes(deferredGzipBytes)} exceeds ${formatBytes(MAX_DEFERRED_GZIP_BYTES)}`,
  );
}

console.log(
  JSON.stringify(
    {
      budgets: {
        maxStartupChunkGzipBytes: MAX_STARTUP_CHUNK_GZIP_BYTES,
        maxStartupGzipBytes: MAX_STARTUP_GZIP_BYTES,
        maxDeferredChunkGzipBytes: MAX_DEFERRED_CHUNK_GZIP_BYTES,
        maxDeferredGzipBytes: MAX_DEFERRED_GZIP_BYTES,
      },
      entry,
      largestStartupAsset,
      largestDeferredAsset,
      startupGzipBytes,
      deferredGzipBytes,
      allJavascriptGzipBytes,
      startupAssets: startupAssets.map(publicAsset),
      deferredAssets: deferredAssets.map(publicAsset),
      assets: publicAssets,
      ok: failures.length === 0,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exitCode = 1;
