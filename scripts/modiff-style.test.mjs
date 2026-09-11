import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

import { renderSemanticTokenCss } from './theme-token-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let styles;
let controls;
let comboboxOptions;
let primitives;
let statusRows;
let tokens;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  styles = await server.ssrLoadModule('/src/theme/modiffStyle.ts');
  controls = await server.ssrLoadModule('/src/ui/controls.tsx');
  comboboxOptions = await server.ssrLoadModule('/src/ui/comboboxOptions.ts');
  primitives = await server.ssrLoadModule('/src/ui/primitives.tsx');
  statusRows = await server.ssrLoadModule('/src/ui/ActionStatusRow.tsx');
  tokens = await server.ssrLoadModule('/src/theme/designTokens.ts');
});

after(async () => {
  await server?.close();
});

function withoutWarnings(callback) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return callback();
  } finally {
    console.warn = originalWarn;
  }
}

test('sanitizeModiffFieldStyle keeps layout-only keys', () => {
  const sanitized = styles.sanitizeModiffFieldStyle({
    width: '100%',
    minHeight: 120,
    display: 'grid',
    gridArea: 'preview',
    aspectRatio: '1 / 1',
    zIndex: 1,
    px: 1,
  });

  assert.deepEqual(sanitized, {
    width: '100%',
    minHeight: 120,
    display: 'grid',
    gridArea: 'preview',
    aspectRatio: '1 / 1',
    zIndex: 1,
    px: 1,
  });
});

test('sanitizeModiffFieldStyle drops visual styling keys', () => {
  const sanitized = withoutWarnings(() =>
    styles.sanitizeModiffFieldStyle({
      width: 240,
      color: 'red',
      backgroundColor: 'black',
      border: '1px solid red',
      borderRadius: 8,
      boxShadow: '0 0 4px red',
      fontSize: 16,
    }),
  );

  assert.deepEqual(sanitized, { width: 240 });
});

test('sanitizeModiffNodeStyle ignores non-object inputs', () => {
  assert.deepEqual(styles.sanitizeModiffNodeStyle(null), {});
  assert.deepEqual(styles.sanitizeModiffNodeStyle('width: 100%'), {});
  assert.deepEqual(styles.sanitizeModiffNodeStyle(['width']), {});
});

test('global behavior hooks expose MoDiff-only classes', () => {
  const appCss = fs.readFileSync(path.join(ROOT, 'src', 'App.css'), 'utf8');

  ['.modiff-hidden', '.modiff-disabled', '.modiff-resize-handle-active'].forEach((hook) => {
    assert.match(appCss, new RegExp(hook.replace('.', '\\.')));
  });
});

test('semantic theme roles match the TypeScript control contract', () => {
  const themeEntry = fs.readFileSync(path.join(ROOT, 'src', 'theme', 'modiff.css'), 'utf8');
  const generatedCss = fs.readFileSync(path.join(ROOT, 'src', 'theme', 'semantic-tokens.generated.css'), 'utf8');
  const canonicalTokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'theme', 'semanticTokens.json'), 'utf8'));

  assert.equal(generatedCss, renderSemanticTokenCss(canonicalTokens));
  assert.match(themeEntry, /@import '\.\/semantic-tokens\.generated\.css';/);
  assert.doesNotMatch(themeEntry, /--(?:color|font|radius|shadow|text)-[a-z0-9-]+\s*:/);

  [
    '--color-modiff-focus:',
    '--color-modiff-warning:',
    '--color-modiff-invalid:',
    '--color-modiff-disabled:',
    '--color-modiff-subtle-text:',
    '--color-modiff-border-subtle:',
    '--color-modiff-surface-hover:',
    '--color-modiff-surface-pressed:',
    '--color-modiff-selected-surface:',
    '--color-modiff-primary-pressed:',
    '--color-modiff-on-accent:',
    '--color-modiff-on-danger:',
    '--color-modiff-media-backdrop:',
    '--color-modiff-overlay-text:',
    '--color-modiff-dialog-backdrop:',
    '--shadow-modiff-panel:',
  ].forEach((token) => assert.match(generatedCss, new RegExp(token)));

  ['color-hf-gray', 'color-modiff-muted', 'color-modiff-text-muted'].forEach((legacyToken) => {
    assert.equal(Object.hasOwn(canonicalTokens.cssVariables, legacyToken), false);
  });

  assert.equal(tokens.modiffColors.primary, canonicalTokens.cssVariables['color-hf-yellow']);
  assert.equal(tokens.modiffColors.primaryPressed, canonicalTokens.cssVariables['color-modiff-primary-pressed']);
  assert.equal(tokens.modiffColors.focus, canonicalTokens.cssVariables['color-modiff-focus']);
  assert.equal(tokens.modiffColors.subtleText, canonicalTokens.cssVariables['color-modiff-subtle-text']);
  assert.equal(tokens.modiffColors.surfacePressed, canonicalTokens.cssVariables['color-modiff-surface-pressed']);
  assert.equal(tokens.modiffColors.onAccent, canonicalTokens.cssVariables['color-modiff-on-accent']);
  assert.equal(tokens.modiffColors.onDanger, canonicalTokens.cssVariables['color-modiff-on-danger']);
  assert.equal(tokens.modiffColors.mediaBackdrop, canonicalTokens.cssVariables['color-modiff-media-backdrop']);
  assert.equal(tokens.modiffColors.overlayText, canonicalTokens.cssVariables['color-modiff-overlay-text']);
  assert.equal(tokens.modiffColors.dialogBackdrop, canonicalTokens.cssVariables['color-modiff-dialog-backdrop']);
  assert.equal(tokens.modiffTypography.fieldLabelSize, 11);
  assert.equal(tokens.modiffTypography.metadataSize, 12);
  assert.equal(tokens.modiffTypography.controlSize, 14);
  assert.deepEqual(tokens.modiffControlSizes, {
    iconCompact: 28,
    dense: 32,
    normal: 36,
    prominent: 40,
  });
});

test('shared fields wire labels, helper and error IDs, and inherited control states', () => {
  const fieldMarkup = renderToStaticMarkup(
    React.createElement(
      controls.ModiffFieldShell,
      {
        label: 'Prompt',
        htmlFor: 'prompt',
        required: true,
        readOnly: true,
        disabled: true,
        description: 'Describe the output.',
        error: 'Prompt is required',
      },
      React.createElement(controls.ModiffInput, {
        id: 'prompt',
        defaultValue: '',
      }),
    ),
  );
  const buttonMarkup = renderToStaticMarkup(
    React.createElement(primitives.ModiffButton, { loading: true }, 'Generate'),
  );

  assert.match(fieldMarkup, /for="prompt"/);
  assert.match(fieldMarkup, /aria-invalid="true"/);
  assert.match(fieldMarkup, /disabled=""/);
  assert.match(fieldMarkup, /readOnly=""/);
  assert.match(fieldMarkup, /required=""/);
  assert.match(fieldMarkup, /role="alert"/);
  const describedBy = fieldMarkup.match(/aria-describedby="([^"]+)"/)?.[1]?.split(' ') ?? [];
  const errorMessageIds = fieldMarkup.match(/aria-errormessage="([^"]+)"/)?.[1]?.split(' ') ?? [];
  assert.equal(describedBy.length, 2);
  assert.equal(errorMessageIds.length, 1);
  describedBy.forEach((id) => assert.match(fieldMarkup, new RegExp(`id="${id}"`)));
  assert.ok(describedBy.includes(errorMessageIds[0]));
  assert.match(buttonMarkup, /aria-busy="true"/);
  assert.match(buttonMarkup, /disabled=""/);
});

test('shared status rows contain and wrap long readiness messages', () => {
  const longMessage = `Runtime-${'contract-'.repeat(40)}repair-required`;
  const markup = renderToStaticMarkup(
    React.createElement(statusRows.ActionStatusRow, {
      title: 'Run blocked - 1 issue',
      meta: longMessage,
      tone: 'error',
    }),
  );

  assert.match(markup, /overflow-hidden/);
  assert.match(markup, /break-words/);
  assert.match(markup, /repair-required/);
});

test('ModiffSelect is a themed Headless UI button instead of a native select', () => {
  const markup = renderToStaticMarkup(
    React.createElement(controls.ModiffSelect, {
      'aria-label': 'Sort templates',
      value: 'recommended',
      onValueChange() {},
      options: [
        { value: 'recommended', label: 'Recommended' },
        { value: 'model', label: 'Model' },
      ],
    }),
  );

  assert.doesNotMatch(markup, /<select\b/);
  assert.match(markup, /aria-label="Sort templates"/);
  assert.match(markup, />Recommended</);
  assert.match(markup, /aria-haspopup="listbox"/);
});

test('shared combobox and rich radio cards replace browser and feature-local choice surfaces', () => {
  const comboboxMarkup = renderToStaticMarkup(
    React.createElement(controls.ModiffCombobox, {
      'aria-label': 'Find a model',
      query: 'Model',
      value: 'model',
      onQueryChange() {},
      onValueChange() {},
      options: [
        { value: 'model', label: 'Model' },
        { value: 'runtime', label: 'Runtime' },
      ],
    }),
  );
  const radioMarkup = renderToStaticMarkup(
    React.createElement(controls.ModiffRadioCardGroup, {
      'aria-label': 'Repair choice',
      value: 'direct',
      onValueChange() {},
      options: [
        {
          value: 'direct',
          label: 'Direct repair',
          description: 'Use the deterministic connection.',
          meta: 'Direct',
        },
      ],
    }),
  );

  assert.doesNotMatch(comboboxMarkup, /<datalist\b/);
  assert.match(comboboxMarkup, /role="combobox"/);
  assert.match(comboboxMarkup, /aria-label="Find a model"/);
  assert.match(radioMarkup, /role="radiogroup"/);
  assert.match(radioMarkup, /role="radio"/);
  assert.match(radioMarkup, /Direct repair/);
});

test('typing a live free-form selection keeps suggestions filtered before Tab commits', () => {
  const options = [
    { value: 'unrelated/audio', label: 'unrelated/audio' },
    { value: 'InstantX/Union', label: 'InstantX/Union' },
  ];
  assert.deepEqual(
    comboboxOptions.visibleModiffComboboxOptions(options, 'InstantX/Union', ['InstantX/Union'], false, true),
    [options[1]],
  );
  assert.deepEqual(
    comboboxOptions.visibleModiffComboboxOptions(
      options,
      'custom/not-installed',
      ['custom/not-installed'],
      false,
      true,
    ),
    [],
  );
});

test('combobox opens installed alternatives when the current free-form value is unavailable', () => {
  const options = [{ value: 'InstantX/Qwen-Image-ControlNet-Union', label: 'InstantX/Qwen-Image-ControlNet-Union' }];

  assert.deepEqual(
    comboboxOptions.visibleModiffComboboxOptions(
      options,
      'diffusers/controlnet-depth-sdxl-1.0',
      ['diffusers/controlnet-depth-sdxl-1.0'],
      false,
    ),
    options,
  );
  assert.deepEqual(
    comboboxOptions.visibleModiffComboboxOptions(options, 'qwen', ['diffusers/controlnet-depth-sdxl-1.0'], false),
    options,
  );
  assert.deepEqual(
    comboboxOptions.visibleModiffComboboxOptions(options, 'sdxl', ['diffusers/controlnet-depth-sdxl-1.0'], false),
    [],
  );
});

test('style audit covers the complete interactive-control surface with only narrow specialized allowances', () => {
  const audit = fs.readFileSync(path.join(ROOT, 'scripts', 'style-audit.mjs'), 'utf8');

  [
    'nativeSelect',
    'nativeDatalist',
    'featureHeadlessUi',
    'rawFieldLabel',
    'literalMonochrome',
    'undersizedSharedAction',
    'featurePrimaryClone',
    'rawRadioRole',
    'rawButton',
    'rawInput',
    'rawTextarea',
    'rawChoiceOrSlider',
    'rawSwitch',
    'rawTabs',
    'rawDisclosure',
    'rawFileInput',
    'arbitraryTextSize',
    'genericGray',
    'legacyMutedColor',
    'nonSemanticFocus',
    'duplicatedControlStates',
    'localTooltip',
    'legacyAnchoredPanel',
    'rawPortalOverlay',
  ].forEach((check) => assert.match(audit, new RegExp(check)));
  assert.doesNotMatch(audit, /\bapprovedPrefixes\b/);
  assert.doesNotMatch(audit, /approvedDynamicStyleProps/);
  assert.match(audit, /specializedInteractionAllowlist/);
  assert.match(audit, /src\/components\/FileBrowserDialog\.tsx/);
  assert.match(audit, /src\/ui\/NumberFieldFrame\.tsx/);
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'ui', 'GraphConnectionSurface.tsx')));
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'ui', 'GraphTypedHandle.tsx')));
});

test('shared overlays and menus are portalled, collision-aware, and replace feature-local overlays', () => {
  const overlays = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'overlays.tsx'), 'utf8');
  const menus = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'menus.tsx'), 'utf8');
  const selectionToolbar = fs.readFileSync(path.join(ROOT, 'src', 'components', 'SelectionToolbar.tsx'), 'utf8');
  const customNode = fs.readFileSync(path.join(ROOT, 'src', 'components', 'CustomNode.tsx'), 'utf8');
  const nodeSearch = fs.readFileSync(path.join(ROOT, 'src', 'components', 'NodeSearchDialog.tsx'), 'utf8');

  assert.match(overlays, /\bcreatePortal\s*\(/);
  assert.match(overlays, /collisionAwarePosition/);
  assert.match(overlays, /ResizeObserver/);
  assert.match(overlays, /font-sans/);
  assert.match(menus, /MenuItems/);
  assert.match(menus, /\bportal=\{portal\}/);
  assert.match(menus, /font-sans/);
  assert.match(selectionToolbar, /GraphIconButton/);
  assert.match(selectionToolbar, /ModiffMenuSurface/);
  assert.doesNotMatch(selectionToolbar, /@headlessui\/react/);
  assert.match(customNode, /ModiffPopover/);
  assert.match(nodeSearch, /ModiffPopover/);
  [selectionToolbar, customNode, nodeSearch].forEach((source) => {
    assert.doesNotMatch(source, /\bAnchoredPanel\b/);
    assert.doesNotMatch(source, /\bcreatePortal\s*\(/);
  });
});

test('feature dialogs, searches, graph fields, and dropdowns consume the shared interaction contracts', () => {
  const readSource = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const dialogSources = [
    'src/components/SettingsDialog.tsx',
    'src/components/FileBrowserDialog.tsx',
    'src/components/ModelManagerDialog.tsx',
    'src/components/LightboxDialog.tsx',
    'src/components/StudioCommandPalette.tsx',
  ].map(readSource);
  const searchSources = [
    'src/components/GraphList.tsx',
    'src/components/NodeList.tsx',
    'src/components/NodeSearchDialog.tsx',
    'src/fields/SelectDialogField.tsx',
  ].map(readSource);
  const topBar = readSource('src/components/TopBar.tsx');
  const selectionToolbar = readSource('src/components/SelectionToolbar.tsx');
  const customNode = readSource('src/components/CustomNode.tsx');
  const selectField = readSource('src/fields/SelectField.tsx');
  const graphFieldSources = [
    'src/fields/SelectDialogField.tsx',
    'src/fields/RangeField.tsx',
    'src/fields/LayerConfigField.tsx',
  ].map(readSource);

  dialogSources.forEach((source) => {
    assert.match(source, /<ModiffDialog\b/);
    assert.doesNotMatch(source, /role="dialog"/);
  });
  searchSources.forEach((source) => assert.match(source, /<ModiffSearchInput\b/));
  graphFieldSources.forEach((source) => assert.match(source, /<ModiffFieldShell\b/));
  assert.match(topBar, /<ModiffMenuSurface\b/);
  assert.match(selectionToolbar, /<ModiffMenuSurface\b/);
  assert.doesNotMatch(topBar, /@headlessui\/react/);
  assert.doesNotMatch(selectionToolbar, /@headlessui\/react/);
  assert.match(customNode, /event\.key === 'ArrowDown'/);
  assert.match(customNode, /contextMenuReturnFocusRef/);
  assert.match(selectField, /<ModiffMultiSelect\b/);
  assert.doesNotMatch(selectField, /@headlessui\/react/);
});

test('all graph option controls consume the shared runtime option descriptor contract', () => {
  const readSource = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const runtimeOptions = readSource('src/studio/runtimeOptions.ts');
  const optionConsumers = [
    'src/fields/SelectField.tsx',
    'src/fields/AutocompleteField.tsx',
    'src/fields/SelectDialogField.tsx',
    'src/fields/RadioField.tsx',
    'src/fields/ToggleField.tsx',
    'src/components/NodeContent.tsx',
    'src/studio/runReadiness.ts',
  ].map(readSource);

  assert.match(runtimeOptions, /export function runtimeOptionEntries/);
  assert.match(runtimeOptions, /export function runtimeOptionValues/);
  optionConsumers.forEach((source) => {
    assert.match(source, /from ['"]\.\.\/studio\/runtimeOptions|from ['"]\.\/runtimeOptions/);
    assert.doesNotMatch(source, /options\.map\(String\)/);
  });
});

test('Studio sticky prompt follows the measured header and seals its spacing with an opaque surface', () => {
  const studioPanel = fs.readFileSync(path.join(ROOT, 'src', 'components', 'StudioPanel.tsx'), 'utf8');

  assert.match(studioPanel, /stickyHeaderRef/);
  assert.match(studioPanel, /new ResizeObserver/);
  assert.match(studioPanel, /requestAnimationFrame\(syncHeaderHeight\)/);
  assert.match(studioPanel, /stickyTop=\{stickyHeaderHeight \+ 12\}/);
  assert.match(studioPanel, /before:-top-3 before:h-3 before:bg-modiff-bg/);
  assert.match(studioPanel, /data-testid="studio-sticky-header"/);
  assert.match(studioPanel, /testId="studio-sticky-prompt"/);
  assert.doesNotMatch(studioPanel, /sticky top-32/);
  assert.doesNotMatch(studioPanel, /bg-modiff-bg\/95/);
});
