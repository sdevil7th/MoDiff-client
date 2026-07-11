import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let styles;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  styles = await server.ssrLoadModule('/src/theme/modiffStyle.ts');
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
