import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfigFromFile } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';

test('lazy panel icon descriptors initialize in the vendor dependency chunk', async () => {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' });
  const groups = loaded.config.build.rollupOptions.output.codeSplitting.groups;
  const classifier = groups.find((group) => typeof group.name === 'function').name;
  assert.equal(classifier('/app/node_modules/lucide-react/dist/esm/icons/rocket.js'), 'graph-vendor');
  assert.equal(classifier('/app/node_modules/lucide-react/dist/esm/createLucideIcon.js'), 'graph-vendor');
});

test('production cache busting gives static and dynamic imports the same module URL', async () => {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' });
  const plugin = loaded.config.plugins.find((item) => item?.name === 'modiff-shell-asset-version');
  assert.ok(plugin);
  const bundle = {
    'assets/entry.js': {
      type: 'chunk',
      code: [
        'import {store} from "./state.js";',
        "import('./state.js');",
        'import(`./state.js`);',
        'const css = ["assets/graph.css", "/assets/graph.css"];',
        'const unrelated = "./not-emitted.js";',
        'const dynamic = import(`./${name}.js`);',
        'const external = import("https://example.com/state.js");',
      ].join('\n'),
    },
    'assets/state.js': { type: 'chunk', code: 'export const store = {};' },
    'assets/graph.css': { type: 'asset', source: '.graph {}' },
    'index.html': { type: 'asset', source: '<script type="module" src="/assets/entry.js"></script>' },
  };
  await plugin.generateBundle({}, bundle);
  const code = bundle['assets/entry.js'].code;
  const version = /state\.js\?v=([a-f0-9]{16})/.exec(code)?.[1];
  assert.ok(version);
  for (const quote of ['"', "'", '`']) assert.ok(code.includes(`${quote}./state.js?v=${version}${quote}`), code);
  assert.ok(code.includes(`"assets/graph.css?v=${version}"`));
  assert.ok(code.includes(`"/assets/graph.css?v=${version}"`));
  assert.ok(bundle['index.html'].source.includes(`/assets/entry.js?v=${version}`));
  assert.ok(code.includes('"./not-emitted.js"'));
  assert.ok(code.includes('`./${name}.js`'));
  assert.ok(code.includes('"https://example.com/state.js"'));
});

test('the built shell has one versioned URL per emitted JavaScript and CSS module', () => {
  const directory = new URL('../dist/assets/', import.meta.url);
  const files = readdirSync(directory).filter((name) => /\.(?:js|css)$/.test(name));
  assert.ok(files.length > 0, 'Build the production bundle before checking its module identity.');
  const known = new Set(files.map((name) => `assets/${name}`));
  const versions = new Set();
  let references = 0;
  for (const name of files.filter((name) => name.endsWith('.js'))) {
    const code = readFileSync(new URL(name, directory), 'utf8');
    const literals = code.matchAll(/(["'`])((?:\.\/|\/?assets\/)[^"'`$\s\\]+\.(?:js|css)(?:\?[^"'`$\s\\]*)?)\1/g);
    for (const [, , reference] of literals) {
      const url = new URL(reference.replace(/^\.\//, '/assets/'), 'http://localhost/');
      if (!known.has(url.pathname.slice(1))) continue;
      const version = url.searchParams.get('v');
      assert.match(version ?? '', /^[a-f0-9]{16}$/, `${name}: unversioned module reference ${reference}`);
      versions.add(version);
      references += 1;
    }
  }
  assert.ok(references > 10, 'Inspect actual cross-chunk references, not an empty fixture.');
  assert.equal(versions.size, 1, 'All static, dynamic and preload references must share one shell identity.');
});
