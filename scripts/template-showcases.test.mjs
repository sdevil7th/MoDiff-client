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
    const base = `/template-gallery/showcases/${row.id}`;
    assert.equal(row.outputPath, base + '.webp');
    assert.equal(row.recordPath, base + '.json');
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
  const workflowIds = registry.workflowAssets.map((row) => row.id);
  assert.equal(new Set(workflowIds).size, workflowIds.length);
  for (const row of registry.workflowAssets) {
    assert.equal(row.status, 'approved');
    assert.equal(row.mediaKind, 'video');
    assert.match(row.id, /^[a-z0-9][a-z0-9.-]*$/u);
    assert.ok(row.title.trim() && row.modelLabel.trim());
    assert.match(row.workflowExecutionSpecId, /^[a-z0-9_-]+:[a-z0-9_-]+:v[1-9][0-9]*$/u);
    assert.ok([row.width, row.height].every((size) => Number.isInteger(size) && size > 0));
    const base = `/template-gallery/showcases/${row.id}`;
    assert.equal(row.outputPath, base + '.mp4');
    assert.ok([base + '.poster.png', base + '.poster.webp'].includes(row.posterPath));
    assert.equal(row.recordPath, base + '.json');
    for (const [path, hash] of [
      [row.outputPath, row.mediaSHA256],
      [row.posterPath, row.posterSHA256],
      [row.recordPath, row.recordSHA256],
    ]) {
      assert.match(hash, /^[a-f0-9]{64}$/u);
      const record = assets.assets.find((asset) => asset.path === path.slice(1));
      assert.equal(record?.sha256, `sha256:bytes:${hash}`);
      const accepted = rights.records.find((asset) => asset.path === path.slice(1));
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
    const manifest = exact.parseTemplateGalleryManifest(
      JSON.parse(fs.readFileSync('public/template-gallery/manifest.json', 'utf8')),
    );
    for (const [id, file, prompt] of [
      ['flux3_klein_fp8r512_text_to_image', 'flux3-pine-lake-mountains-pup.v1.webp', /radio/i],
      ['minimax_h3_image_old_town_cat', 'h3-emerald-material-transfer.webp', /orange tabby/i],
    ]) {
      const template = STUDIO_TEMPLATES.find((t) => t.id === id);
      assert.match(template.prompt, prompt);
      assert.ok(getTemplateShowcase(template.id).mediaPath.endsWith(file));
      assert.deepEqual(exact.getTemplateCardMedia(template, null, { currentRecipeOnly: true }), {});
      const card = exact.getTemplateCardMedia(template, manifest, { currentRecipeOnly: true });
      const entry = exact.findManifestEntry(template, manifest);
      if (entry) assert.equal(card.mediaPath, exact.templateManifestPath(entry.afterPath ?? entry.outputPath));
      else assert.deepEqual(card, {});
      assert.ok(!Object.values(card).some((path) => path?.endsWith(file)));
      assert.equal(exact.findManifestEntry(template, null), undefined);
      assert.equal(exact.getTemplateExampleUiState(template, {}, null, null).status, 'unverified');
    }
    const other = STUDIO_TEMPLATES.find((t) => t.id === 'flux2_dev_text_to_image');
    assert.equal(getTemplateShowcase(other.id), undefined);
  } finally {
    await server.close();
  }
});

test('approved workflow videos are searchable and resolve through the pinned Gallery source', async () => {
  const server = await createServer({
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  try {
    const { getWorkflowShowcases } = await server.ssrLoadModule('/src/studio/templateShowcases.ts');
    const { getTemplateAssetSource, resolveTemplateAssetUrl } = await server.ssrLoadModule(
      '/src/studio/templateAssets.ts',
    );
    const registry = JSON.parse(fs.readFileSync('src/studio/templateShowcases.json', 'utf8'));
    const asset = registry.workflowAssets.find((row) => row.id === 'ltx25-monday-morning-brisk-crossing.v1');
    const resolved = getWorkflowShowcases('LTX-2.5 Full').find((row) => row.id === asset.id);
    assert.equal(resolved.workflowExecutionSpecId, 'ltx25-full-av:image_to_video_with_audio:v1');
    const { revision, mode } = getTemplateAssetSource();
    for (const [actual, original] of [
      [resolved.mediaPath, asset.outputPath],
      [resolved.posterPath, asset.posterPath],
      [resolved.recordPath, asset.recordPath],
    ]) {
      assert.equal(actual, resolveTemplateAssetUrl(original));
      if (mode === 'huggingface') assert.ok(actual.includes(`/resolve/${revision}/`));
    }
    assert.deepEqual(getWorkflowShowcases('unrelated model'), []);
  } finally {
    await server.close();
  }
});
