import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, templates, selections;
before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    location: { origin: 'http://127.0.0.1:5191' },
    dispatchEvent: () => true,
    localStorage,
  };
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  ({ STUDIO_TEMPLATES: templates } = await server.ssrLoadModule('/src/studio/templates.ts'));
  selections = await server.ssrLoadModule('/src/studio/templateOperationSelections.ts');
});
after(async () => server?.close());

test('every normalized fresh media template has an explicit modern authoring route', async (t) => {
  assert.ok(templates.length >= 91, 'Audit the complete current catalogue, including later additions.');
  for (const template of templates) {
    await t.test(template.id, () => {
      assert.equal(
        selections.hasTemplateOperationRecipe(template),
        true,
        `${template.label} still falls back to the legacy flat graph builder`,
      );
    });
  }
});

test('coverage reads normalized delivery operations rather than source literals', () => {
  for (const id of [
    'wan_vace_cinematic_text_to_video',
    'wan_vace_video_color_grade',
    'wan_vace_masked_object_replace',
    'wan_vace_outpaint_reframe',
    'wan_vace_grayscale_control',
    'wan_vace_video_to_video',
    'wan_video_long_showcase',
    'ltx_video_animated_story',
  ]) {
    const template = templates.find((item) => item.id === id);
    assert.ok(template.workflowBlocks.includes('upscaler'), `${id}: actual delivery includes an upscaler`);
    assert.equal(template.workflowBlockSettings.upscaler.model.value, 'nateraw/real-esrgan/RealESRGAN_x2plus.pth');
  }
  for (const id of ['wan_22_i2v_seed_vault', 'wan_22_ti2v_5b_seed_vault']) {
    const template = templates.find((item) => item.id === id);
    assert.equal(template.videoDelivery, 'native');
    assert.ok(!template.workflowBlocks?.includes('upscaler'), `${id}: retain native delivery`);
  }
});
