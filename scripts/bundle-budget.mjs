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
// Authored-default provenance and bounded inactive-draft validation add less
// than 1 KiB to the shared graph chunk. Keep the increase explicitly bounded.
// Workflow tab pointer/keyboard reordering stays in the existing eager tab bar.
// Its dependency-free interaction adds about 1.6 KiB compressed overall; the
// measured largest startup chunk is 439.6 KiB. Bound it at 440 KiB.
// Unified editor, custom-source actions and typed socket guidance measure
// 440.9 KiB after keeping media adaptation on demand. No new dependencies.
// Visual stage grouping measures 443.6 KiB after keeping model/task replacement
// deferred via the shared operationScope helper. No new dependencies.
// Encoding-node correction, including transient stage summaries: 446.1 KiB.
// Keep the editor lazy (eager loading measured 458.3 KiB); no new dependencies.
// Shared ordinary Guidance presentation adds <1 KiB; metadata editing remains
// deferred. Keep the bounded startup chunk at 448 KiB (no new dependency).
const MAX_STARTUP_CHUNK_GZIP_BYTES = 448 * 1024;
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
// Preserve generic operation relationships through Block projection, nested
// adoption and shared control writes. Startup measures 605.6 KiB; bound this
// correctness fix at 606 KiB. Individual chunks and deferred limits stay fixed.
// W5 captured model identities and decimal-string history display add 200 bytes
// compressed (620678 measured). Allow 256 bytes; individual chunk caps stay fixed.
// Required operation-media readiness shares the contract parser with startup.
// Measured startup 622466 bytes, deferred 229644 (combined smaller than before).
// Bound startup at 608 KiB; retain all deferred and individual chunk limits.
// W5 exact draft switching, bounds checks and shared field validation measure
// 623267 startup bytes (+801). The workflow chooser remains lazy. Bound this
// addition at 609 KiB and retain the individual startup chunk ceiling.
// Generic backend-only workflow identities add 55 startup bytes (623650 measured).
// Allow 128 bytes for their shared store metadata; keep the chunk ceiling fixed.
// Current-preview artifact ownership adds 65 bytes (623807 measured). Allow
// another 128 bytes for this shared renderer fix; individual chunk caps stay fixed.
// Legacy exposed-field callback routing adds about 0.4 KiB compressed to startup.
// Bound this shared correctness fix at 610 KiB; deferred and chunk caps stay fixed.
// Identity-based node names, prompt attribution and contextual raw-model
// selection measure 610.5 KiB. The graph-change planner stays deferred behind a
// separate advisory-hint validator. Bound startup at 611 KiB; chunk caps stay fixed.
// Declared image-pipeline task compatibility now blocks invalid direct wires and
// picker insertion before Run. Measured startup is 625760 bytes; allow 256 bytes
// for the shared validator while retaining every chunk and deferred ceiling.
// Generic signal-option contracts and model-change disconnection extend that
// validator to component and custom nodes. Measured startup is 626016 bytes;
// the compact memory toggle and hover guidance bring the final shell to 626241
// bytes. Bound the reviewed UI addition without changing either chunk ceiling.
// Image-prototyping preservation: measured startup 612.1 KiB, no new dependency.
// Tab reordering, accessible feedback and order-preserving recovery measure
// 628458 startup bytes (613.7 KiB). Allow 614 KiB; deferred/total caps stay fixed.
// Developer-first node UX measures 629759 bytes (+1301); retain a bounded
// 616 KiB startup graph rather than eagerly loading the attachment planner.
// Visual grouping adds 2748 compressed startup bytes (632507 total); keep the
// increase bounded at 618 KiB. The replacement planner remains on demand.
// Dedicated encoding renderer + summary routing: 620.3 KiB measured.
// Required media starters and ordinary Guidance: 621.2 KiB measured.
// Explicit Guidance removal persistence and shared schema validation add 449
// compressed startup bytes (636542 -> 636991). Bound the added metadata path
// with 256 bytes above the prior total ceiling; individual/deferred caps stay fixed.
const MAX_STARTUP_GZIP_BYTES = 622 * 1024 + 256;
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
// M8 shares the stage inspector with a lazy canvas entry point and checks its
// workflow/selection lifetime. Aggregate deferred code measures 209.3 KiB.
// Bound this surface at 210 KiB; startup and individual chunk caps stay fixed.
// W3 adds the task-first Developer chooser and defers the existing Creator
// launcher. Measured deferred code is 214.9 KiB; bound the added feature at
// 215 KiB. Startup and individual chunk ceilings remain unchanged.
// W4 replaces the operation-only inspector with shared Parameters, Interface,
// Implementation, Docs and Run details for nodes and Blocks. The same controls
// serve the side panel and lazy dialog; metadata is deferred. Measured aggregate
// is 217.4 KiB (2.5 KiB added); bound it at 218 KiB. Startup (604.0 KiB) and
// individual chunk ceilings stay fixed; verify the cold production inspector.
// W4 shares the Nodes library filters and pipeline/task discovery with the lazy
// canvas picker, adds bound-node resolution/cancellation, and removes four catalog
// tabs. Final measured aggregate is 219.7 KiB (1.9 KiB added). Bound this surface
// at 220 KiB; startup and individual chunk ceilings stay fixed.
// W4 adds catalog Block search, compiled public-interface validation and shared
// asynchronous insertion/retry. Deferred code measures 221.5 KiB (+1.8 KiB).
// Bound this feature at 222 KiB; startup and individual chunk caps stay fixed.
// W5 adds a lazy loader-owned pipeline/task chooser and shares the existing
// preview transaction. Deferred code measures 223.0 KiB (+1.5 KiB); bound it at
// 224 KiB. Startup and individual chunk ceilings remain unchanged.
// W5 adds lazy owning-Block model/task adaptation and loader selection. The
// deferred graph measures 225.3 KiB (+1.9 KiB); bound the feature at 226 KiB.
// Startup (605.7 KiB) and individual chunk ceilings stay unchanged.
// Receipt-owned Gallery filters add 139 bytes (231442 measured). The prior cap
// had 121 bytes of headroom; allow a further 128 bytes, with no chunk-cap change.
// W5 adds the lazy upstream workflow/draft chooser and exact model selection.
// Measured deferred aggregate is 231983 bytes (+2339 from required-media W5).
// Bound this feature at 227 KiB; retain both individual chunk ceilings.
// W6 adds Hub revision lookup and shared Developer source entry points. Keep the
// resolver out of startup; measured deferred code is 227.8 KiB. Bound this added
// surface at 228 KiB without changing startup or individual chunk ceilings.
// W7 adds persistent planning feedback and bounded saved-workflow pagination.
// Measured deferred code is 233700 bytes (228.2 KiB); bound these controls at
// 229 KiB. Startup and individual chunk limits remain unchanged.
// Shared discovery/replacement descriptors add 875 deferred bytes (234516 total).
// Bound this generic-model support at one additional KiB; chunk limits stay fixed.
// Legacy Saved Block model controls add 1059 deferred bytes (235575 measured).
// Allow 128 bytes beyond the existing aggregate cap; keep startup and chunk caps.
// Normal discovery includes image filters, color inversion and Outpaint Canvas.
// Measured deferred aggregate is 235674 bytes (+75); allow 64 bytes beyond the
// previous cap. Startup and individual chunk budgets stay unchanged.
// Task cards and the lazy model-first graph picker replace the launcher wizard.
// With pristine-route replacement, aggregate is 232.5 KiB; bound this surface at 233 KiB and retain both
// per-chunk ceilings. Cold production startup and model selection remain required.
// Task resolution, saved/draft navigation, grouped model choices, explicit reset
// and exposed Block selection add ~2 KiB of deferred code. Keep planning lazy;
// the measured 234.5 KiB aggregate gets a 236 KiB feature budget. Startup and
// individual chunk limits remain unchanged; cold production checks are required.
// Origin-ranked connection search and independently collapsible built-in/custom
// result panes plus the model review footer measure 241986 bytes. Allow 384 bytes
// for these picker behaviors; retain both individual chunk ceilings.
// Semantic cross-model migration, readable review groups and the exhaustive
// model matrix add 1883 compressed bytes (243869 measured). Bound that planner
// at 238 KiB + 256 bytes; the 64 KiB per-chunk ceiling remains unchanged.
// Lossless cross-model inactive-stage/wire restoration measures 239.1 KiB.
// Keep the planner deferred and its individual 64 KiB chunk limit unchanged.
// Unified custom-source forms and media-role attachment measure 240.6 KiB.
// Keep the per-deferred-chunk ceiling unchanged.
// Group controls and retained deferred model replacement measure 247212 bytes.
// On-demand encoding editor and its inspection surface: 242.8 KiB measured.
// Direct encoding input/output preparation and registry-loaded route selection
// measure 250289 deferred bytes (244.4 KiB). Keep the existing startup and
// per-chunk limits; allocate one bounded KiB for this added connection behavior.
// Atomic backend-defined Guidance controls and contextual inspector actions:
// 247.4 KiB measured; retain the independent 64 KiB per-chunk limit.
const MAX_DEFERRED_GZIP_BYTES = 248 * 1024;

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
