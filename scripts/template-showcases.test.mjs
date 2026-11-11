import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { createServer } from 'vite';

test('accepted showcase bytes have unique, immutable review identities and only two featured recipes', () => {
  const registry = JSON.parse(fs.readFileSync('src/studio/templateShowcases.json', 'utf8'));
  const assets = JSON.parse(fs.readFileSync('config/template-assets.v1.json', 'utf8'));
  const rights = JSON.parse(fs.readFileSync('config/template-asset-rights.v1.json', 'utf8'));
  assert.equal(registry.assets.length, 15);
  assert.equal(new Set(registry.assets.map((a) => a.id)).size, registry.assets.length);
  assert.equal(registry.assets.filter((a) => a.featuredTemplateId).length, 2);
  assert.deepEqual(
    registry.featured,
    registry.assets.filter((a) => a.featuredTemplateId),
  );
  for (const row of registry.assets) {
    assert.equal(row.status, 'approved');
    for (const [path, hash] of [
      [row.outputPath, row.mediaSHA256],
      [row.recordPath, row.recordSHA256],
    ]) {
      assert.match(hash, /^[a-f0-9]{64}$/u);
      assert.match(path, /^\/template-gallery\/showcases\/[a-z0-9.-]+\.(webp|json)$/u);
      const record = assets.assets.find((a) => a.path === path.slice(1));
      assert.equal(record?.sha256, `sha256:bytes:${hash}`);
      const accepted = rights.records.find((a) => a.path === path.slice(1));
      assert.equal(accepted?.sha256, record.sha256);
      assert.equal(accepted?.publishDecision, 'approved');
    }
  }
});

test('featured media never replaces current-template exactness or the actual default prompt', async () => {
  const server = await createServer({
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  try {
    const { STUDIO_TEMPLATES } = await server.ssrLoadModule('/src/studio/templates.ts');
    const exact = await server.ssrLoadModule('/src/studio/templateExactness.ts');
    const { getTemplateShowcase } = await server.ssrLoadModule('/src/studio/templateShowcases.ts');
    for (const [id, file, prompt] of [
      ['flux3_klein_fp8r512_text_to_image', 'flux3-pine-lake-mountains-pup.v1.webp', /radio/i],
      ['minimax_h3_image_old_town_cat', 'h3-emerald-material-transfer.webp', /orange tabby/i],
    ]) {
      const template = STUDIO_TEMPLATES.find((t) => t.id === id);
      assert.match(template.prompt, prompt);
      assert.ok(getTemplateShowcase(template.id).mediaPath.endsWith(file));
      assert.equal(exact.findManifestEntry(template, null), undefined);
      assert.equal(exact.getTemplateExampleUiState(template, {}, null, null).status, 'unverified');
    }
    const other = STUDIO_TEMPLATES.find((t) => t.id === 'flux2_dev_text_to_image');
    assert.equal(getTemplateShowcase(other.id), undefined);
  } finally {
    await server.close();
  }
});
