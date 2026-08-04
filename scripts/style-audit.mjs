import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSemanticTokenCss } from './theme-token-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'src');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'style-audit-baseline.json');
const THEME_PATH = path.join(SRC_DIR, 'theme', 'modiff.css');
const TOKEN_SOURCE_PATH = path.join(SRC_DIR, 'theme', 'semanticTokens.json');
const GENERATED_THEME_PATH = path.join(SRC_DIR, 'theme', 'semantic-tokens.generated.css');
const WRITE_BASELINE = process.argv.includes('--write-baseline');

const ignoredPrefixes = ['src/assets/'];
const strictChecks = new Set([
  'nativeSelect',
  'nativeDatalist',
  'featureHeadlessUi',
  'rawFieldLabel',
  'literalMonochrome',
  'undersizedSharedAction',
  'featurePrimaryClone',
  'rawRadioRole',
  'nonSemanticInteraction',
  'localTooltip',
  'legacyAnchoredPanel',
  'legacyMutedColor',
  'nonSemanticFocus',
  'duplicatedControlStates',
  'rawPortalOverlay',
]);

// These are event-propagation or canvas/drop-zone affordances rather than
// standalone controls. Keep the allowance counted and narrow so an additional
// raw interaction in the same file still fails the audit.
const specializedInteractionAllowlist = new Map([['src/components/FileBrowserDialog.tsx', 1]]);

// Shared primitives are allowed to contain the native elements they wrap and
// the dynamic layout styles they centralize. They are not exempt from semantic
// colors, typography, focus treatment, or interaction semantics.
const approvedCheckPrefixes = {
  rawColors: ['src/theme/'],
  inlineStyle: ['src/theme/', 'src/ui/'],
  directFontSize: ['src/theme/', 'src/ui/'],
  directBorderRadius: ['src/theme/', 'src/ui/'],
  directBoxShadow: ['src/theme/', 'src/ui/'],
  rawButton: ['src/ui/'],
  rawInput: ['src/ui/'],
  rawTextarea: ['src/ui/'],
  rawChoiceOrSlider: ['src/ui/'],
  rawSwitch: ['src/ui/'],
  rawTabs: ['src/ui/'],
  rawFileInput: ['src/ui/'],
  rawPortalOverlay: ['src/ui/'],
  legacyAnchoredPanel: ['src/ui/'],
  duplicatedControlStates: ['src/ui/'],
  nativeDatalist: ['src/ui/RangeSliderFrame.tsx'],
  featureHeadlessUi: ['src/ui/'],
  rawFieldLabel: ['src/ui/'],
  rawRadioRole: ['src/ui/'],
};

specializedInteractionAllowlist.set('src/ui/NumberFieldFrame.tsx', 1);

const checks = {
  rawColors: {
    description: 'raw hex/rgb/rgba color literal',
    pattern: /#[0-9a-fA-F]{3,8}\b|rgba?\(/g,
  },
  inlineStyle: {
    description: 'JSX inline style prop outside shared UI visual primitives',
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
  nativeSelect: {
    description: 'native select outside the shared ModiffSelect primitive',
    pattern: /<select\b/g,
  },
  nativeDatalist: {
    description: 'native datalist popup outside the shared range-slider tick-mark implementation',
    pattern: /<datalist\b/g,
  },
  featureHeadlessUi: {
    description: 'feature-level Headless UI import instead of a shared MoDiff primitive',
    pattern: /from\s+['"]@headlessui\/react['"]/g,
  },
  rawFieldLabel: {
    description: 'feature-level field label outside ModiffFieldShell',
    pattern: /<label\b/g,
  },
  literalMonochrome: {
    description: 'literal black/white utility instead of a semantic on-color, media, overlay, or backdrop token',
    pattern: /\b(?:text|bg|border|ring|outline|fill|stroke)-(?:black|white)(?:\/\d+)?\b/g,
  },
  undersizedSharedAction: {
    description: 'shared interactive control overridden below the 28px compact action size',
    pattern:
      /<(?:ModiffIconButton|StudioIconButton|GraphIconButton|GraphControlButton|ModiffChip|StudioChip|StatusActionChip|ModiffButton|StudioButton)\b(?=[^>]*className\s*=\s*["'][^"']*(?:\bsize-[1-6]\b|\bmin-h-6\b|\bh-6\b))[^>]*>/gs,
  },
  featurePrimaryClone: {
    description: 'feature-level action recreating the shared primary/on-accent control tone',
    pattern:
      /<(?:ModiffButton|StudioButton|ModiffIconButton|StudioIconButton|GraphIconButton|GraphControlButton)\b(?=[^>]*className\s*=\s*["'][^"']*\bbg-hf-yellow\b)(?=[^>]*className\s*=\s*["'][^"']*\btext-modiff-on-accent\b)[^>]*>/gs,
  },
  rawRadioRole: {
    description: 'feature-local radio or radiogroup role instead of a shared radio primitive',
    pattern: /\brole\s*=\s*['"]radio(?:group)?['"]/g,
  },
  nonSemanticInteraction: {
    description:
      'clickable or focusable article/div/span/section/list item without an explicit interactive role or shared control',
    pattern: /<(?:article|div|span|section|li)\b(?=[^>]*(?:\bonClick\s*=|\btabIndex\s*=))(?![^>]*\brole\s*=)[^>]*>/gs,
  },
  localTooltip: {
    description: 'component-local pseudo tooltip instead of the shared portalled ModiffTooltip',
    pattern: /\bdata-tooltip\s*=|content-\[attr\(data-tooltip\)\]/g,
  },
  legacyAnchoredPanel: {
    description: 'legacy non-collision-aware AnchoredPanel usage outside shared UI',
    pattern: /\bAnchoredPanel\b/g,
  },
  rawPortalOverlay: {
    description: 'feature-local createPortal overlay instead of a shared portalled surface',
    pattern: /\bcreatePortal\s*\(/g,
  },
  rawButton: {
    description:
      'raw button outside shared UI primitives (includes tabs, chips, menus, pagination, and dialog actions)',
    pattern: /<button\b/g,
  },
  rawInput: {
    description: 'raw input outside shared UI primitives (includes text, number, search, and media/file pickers)',
    pattern: /<input\b/g,
  },
  rawTextarea: {
    description: 'raw textarea outside shared UI primitives',
    pattern: /<textarea\b/g,
  },
  rawChoiceOrSlider: {
    description: 'raw checkbox, radio, or range control outside shared UI primitives',
    pattern: /<input\b(?=[^>]*\btype\s*=\s*['"](?:checkbox|radio|range)['"])[^>]*>/gs,
  },
  rawSwitch: {
    description: 'raw switch role outside shared UI primitives',
    pattern: /\brole\s*=\s*['"]switch['"]/g,
  },
  rawTabs: {
    description: 'raw tab or tablist role outside shared UI primitives',
    pattern: /\brole\s*=\s*['"]tab(?:list)?['"]/g,
  },
  rawDisclosure: {
    description: 'raw details disclosure used as a menu or multi-select',
    pattern: /<details\b/g,
  },
  rawFileInput: {
    description: 'raw file/media picker outside shared UI primitives',
    pattern: /<input\b(?=[^>]*\btype\s*=\s*['"]file['"])[^>]*>/gs,
  },
  arbitraryTextSize: {
    description: 'arbitrary Tailwind text size instead of a named typography role',
    pattern: /\btext-\[[^\]]+\]/g,
  },
  genericGray: {
    description: 'generic grayscale utility instead of a semantic MoDiff token',
    pattern: /\b(?:text|bg|border|ring|outline|fill|stroke)-(?:gray|slate|zinc|neutral|stone)-\d+(?:\/\d+)?/g,
  },
  legacyMutedColor: {
    description: 'legacy generic muted token instead of the semantic subtle-text token',
    pattern: /\b(?:text|bg|border|ring|outline|fill|stroke)-(?:hf-gray|modiff-muted|modiff-text-muted)(?:\/\d+)?/g,
  },
  nonSemanticFocus: {
    description: 'component-local focus color instead of the semantic focus or invalid token',
    pattern:
      /\b(?:focus|focus-visible):(?:border|outline|ring)-(?:hf-(?:yellow|orange)|modiff-(?:red|blue|green))(?:\/\d+)?/g,
  },
  duplicatedControlStates: {
    description: 'component-local hover/focus state bundle instead of a shared control primitive',
    pattern:
      /['"`][^'"`\r\n]*\bhover:[^'"`\r\n]*\bfocus-visible:(?:outline|ring|border|bg|text)-(?:hf|modiff)-[^'"`\s]+[^'"`\r\n]*['"`]/g,
  },
};

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function shouldSkip(repoPath) {
  return ignoredPrefixes.some((prefix) => repoPath.startsWith(prefix));
}

function isApprovedForCheck(repoPath, checkName) {
  return (approvedCheckPrefixes[checkName] ?? []).some((prefix) => repoPath.startsWith(prefix));
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

  for (const [name, check] of Object.entries(checks)) {
    if (isApprovedForCheck(repoPath, name)) continue;
    const matches = [...text.matchAll(check.pattern)].length;
    result[name] =
      name === 'nonSemanticInteraction'
        ? Math.max(0, matches - (specializedInteractionAllowlist.get(repoPath) ?? 0))
        : matches;
  }
  if (!repoPath.startsWith('src/theme/')) {
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

function collectThemeTokenFailures() {
  const failures = [];
  const themeEntry = fs.readFileSync(THEME_PATH, 'utf8');
  const tokenSource = JSON.parse(fs.readFileSync(TOKEN_SOURCE_PATH, 'utf8'));
  const generatedTheme = fs.existsSync(GENERATED_THEME_PATH) ? fs.readFileSync(GENERATED_THEME_PATH, 'utf8') : '';
  const expectedTheme = renderSemanticTokenCss(tokenSource);

  if (generatedTheme !== expectedTheme) {
    failures.push({
      file: toRepoPath(GENERATED_THEME_PATH),
      message: 'does not match the canonical semanticTokens.json artifact; run `npm run theme:tokens`',
    });
  }
  if (!themeEntry.includes("@import './semantic-tokens.generated.css';")) {
    failures.push({
      file: toRepoPath(THEME_PATH),
      message: 'must import the generated canonical semantic token stylesheet',
    });
  }
  if (/--(?:color|font|radius|shadow|text)-[a-z0-9-]+\s*:/.test(themeEntry)) {
    failures.push({
      file: toRepoPath(THEME_PATH),
      message: 'must not redeclare canonical semantic tokens locally',
    });
  }

  const theme = generatedTheme;
  const declared = {
    color: new Set([...theme.matchAll(/--color-modiff-([a-z0-9-]+)\s*:/g)].map((match) => match[1])),
    radius: new Set([...theme.matchAll(/--radius-modiff-([a-z0-9-]+)\s*:/g)].map((match) => match[1])),
    shadow: new Set([...theme.matchAll(/--shadow-modiff-([a-z0-9-]+)\s*:/g)].map((match) => match[1])),
    text: new Set([...theme.matchAll(/--text-modiff-([a-z0-9-]+)\s*:/g)].map((match) => match[1])),
  };
  const utilityPattern =
    /\b(text|bg|border|ring|outline|accent|fill|stroke|decoration|caret|divide|rounded|shadow)-modiff-([a-z0-9-]+)/g;

  for (const filePath of readFiles(SRC_DIR)) {
    const repoPath = toRepoPath(filePath);
    if (shouldSkip(repoPath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const match of text.matchAll(utilityPattern)) {
      const [, utility, token] = match;
      const valid =
        utility === 'rounded'
          ? declared.radius.has(token)
          : utility === 'shadow'
            ? declared.shadow.has(token)
            : utility === 'text'
              ? declared.color.has(token) || declared.text.has(token)
              : declared.color.has(token);
      if (!valid) failures.push({ file: repoPath, utility: match[0], token });
    }
  }

  return failures;
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
      const allowed = strictChecks.has(check) ? 0 : (baselineChecks[check] ?? 0);
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
const tokenFailures = collectThemeTokenFailures();

if (failures.length > 0 || tokenFailures.length > 0) {
  console.error('Style audit failed. New styling or shared-control violations were introduced:');
  for (const failure of failures) {
    const description = checks[failure.check]?.description ?? failure.check;
    console.error(`- ${failure.file}: ${failure.check} (${description}) ${failure.now} > ${failure.allowed}`);
  }
  for (const failure of tokenFailures) {
    if (failure.message) {
      console.error(`- ${failure.file}: ${failure.message}`);
    } else {
      console.error(`- ${failure.file}: ${failure.utility} references undefined semantic token "${failure.token}"`);
    }
  }
  console.error(
    '\nUse semantic theme tokens or src/ui primitives. The baseline is an exact legacy-debt cap; native selects are never permitted.',
  );
  process.exit(1);
}

console.log(
  `Style audit passed across ${readFiles(SRC_DIR).length} source files; ${Object.keys(current).length} file(s) retain capped baseline patterns.`,
);
