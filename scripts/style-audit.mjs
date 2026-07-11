import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'style-audit-baseline.json');
const WRITE_BASELINE = process.argv.includes('--write-baseline');

const approvedPrefixes = ['src/theme/', 'src/ui/'];

const ignoredPrefixes = ['src/assets/'];

const checks = {
  rawColors: {
    description: 'raw hex/rgb/rgba color literal',
    pattern: /#[0-9a-fA-F]{3,8}\b|rgba?\(/g,
  },
  inlineStyle: {
    description: 'JSX inline style prop',
    pattern: /\bstyle=\{/g,
  },
  directFontSize: {
    description: 'direct fontSize assignment',
    pattern: /\bfontSize\s*:/g,
  },
  directBorderRadius: {
    description: 'direct borderRadius assignment',
    pattern: /\bborderRadius\s*:/g,
  },
  directBoxShadow: {
    description: 'direct boxShadow assignment',
    pattern: /\bboxShadow\s*:/g,
  },
};

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function shouldSkip(repoPath) {
  return ignoredPrefixes.some((prefix) => repoPath.startsWith(prefix));
}

function isApprovedVisualSource(repoPath) {
  return approvedPrefixes.some((prefix) => repoPath.startsWith(prefix));
}

function readFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readFiles(fullPath));
    } else if (/\.(css|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function countGlobalCssSelectors(text, repoPath) {
  if (!repoPath.endsWith('.css')) return 0;

  return text.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed.endsWith('{') && !trimmed.startsWith('@') && !trimmed.startsWith('/*') && !trimmed.startsWith('*');
  }).length;
}

function countFile(filePath) {
  const repoPath = toRepoPath(filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  const result = {};

  if (!isApprovedVisualSource(repoPath)) {
    for (const [name, check] of Object.entries(checks)) {
      result[name] = [...text.matchAll(check.pattern)].length;
    }
  }

  if (!isApprovedVisualSource(repoPath)) {
    result.globalCssSelectors = countGlobalCssSelectors(text, repoPath);
  }
  return Object.fromEntries(Object.entries(result).filter(([, count]) => count > 0));
}

function collectCounts() {
  const counts = {};
  for (const filePath of readFiles(SRC_DIR)) {
    const repoPath = toRepoPath(filePath);
    if (shouldSkip(repoPath)) continue;

    const fileCounts = countFile(filePath);
    if (Object.keys(fileCounts).length > 0) {
      counts[repoPath] = fileCounts;
    }
  }
  return counts;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(counts) {
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`, 'utf8');
}

function compareToBaseline(current, baseline) {
  const failures = [];
  const allFiles = new Set([...Object.keys(current), ...Object.keys(baseline)]);

  for (const file of [...allFiles].sort()) {
    const currentChecks = current[file] ?? {};
    const baselineChecks = baseline[file] ?? {};
    const allChecks = new Set([...Object.keys(currentChecks), ...Object.keys(baselineChecks)]);

    for (const check of [...allChecks].sort()) {
      const now = currentChecks[check] ?? 0;
      const allowed = baselineChecks[check] ?? 0;
      if (now > allowed) {
        failures.push({ file, check, now, allowed });
      }
    }
  }

  return failures;
}

const current = collectCounts();

if (WRITE_BASELINE) {
  writeBaseline(current);
  console.log(`Wrote ${path.relative(ROOT, BASELINE_PATH)} for ${Object.keys(current).length} files.`);
  process.exit(0);
}

const baseline = readBaseline();
const failures = compareToBaseline(current, baseline);

if (failures.length > 0) {
  console.error('Style audit failed. New styling violations were introduced over baseline:');
  for (const failure of failures) {
    const description = checks[failure.check]?.description ?? failure.check;
    console.error(`- ${failure.file}: ${failure.check} (${description}) ${failure.now} > ${failure.allowed}`);
  }
  console.error(
    '\nUse theme tokens or src/ui primitives. Only update the baseline when intentionally paying down or reclassifying style debt.',
  );
  process.exit(1);
}

console.log(`Style audit passed for ${Object.keys(current).length} files with existing debt capped by baseline.`);
