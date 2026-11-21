import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let Panel;
let studio;

before(async () => {
  globalThis.window = { location: { origin: 'http://127.0.0.1:5191' } };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  Panel = (await server.ssrLoadModule('/src/components/CompatibilityPanel.tsx')).default;
  studio = (await server.ssrLoadModule('/src/stores/useStudioStore.ts')).useStudioStore;
  // SSR uses the store's initial snapshot. Render the explicitly configured
  // fixture rather than hydration defaults; no browser/application store is changed.
});
after(async () => {
  await server?.close();
});

const binding = {
  mode: 'text_to_image',
  modelType: 'ZImageModularPipeline',
  nodes: {},
  managedNodeIds: [],
  managedEdgeIds: [],
  fingerprint: 'managed-resource-fixture',
  createdAt: 1,
  updatedAt: 1,
  controlled: { contractIds: ['lora.diffusers-image.v1'] },
};

for (const selected of [false, true]) {
  test(`managed resources include a whole-workflow check with selected model ${selected}`, () => {
    const candidate = { id: 'primary-recipe', modelRepo: 'test/model', proof: { status: 'live_proven' } };
    Object.assign(studio.getInitialState(), {
      graphBinding: binding,
      autoResourcePlan: selected
        ? {
            schemaVersion: 1,
            candidates: [candidate],
            selectedCandidate: candidate,
          }
        : null,
    });
    const markup = renderToStaticMarkup(React.createElement(Panel));
    assert.equal(markup.includes('data-testid="workflow-resource-assessment"'), true);
    assert.equal(markup.includes('data-testid="plan-workflow-auto"'), true);
    assert.equal(markup.includes('Whole workflow'), true);
    if (selected) {
      assert.equal(markup.includes('Base recipe ran here'), true);
      assert.equal(markup.includes('test/model'), true);
    }
  });
}

test('ordinary resources retain exactly one whole-workflow assessment', () => {
  Object.assign(studio.getInitialState(), { graphBinding: null, autoResourcePlan: null });
  const markup = renderToStaticMarkup(React.createElement(Panel));
  assert.equal((markup.match(/data-testid="workflow-resource-assessment"/g) ?? []).length, 1);
});
