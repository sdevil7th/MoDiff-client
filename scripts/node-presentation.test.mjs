import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let catalog;
let browser;
const cases = [
  ['ModularDiffusers', 'ModelsLoader', 'Load Models', 'Load Modular Components'],
  ['ModularDiffusers', 'AutoModelLoader', 'Load Model', 'Load Model Component'],
  ['DiffusersImage', 'LoadPipeline', 'Load Diffusers Image Pipeline', 'Load Image Pipeline'],
  ['DiffusersAudio', 'LoadPipeline', 'Load Diffusers Audio Pipeline', 'Load Audio Pipeline'],
  ['DiffusersVideo', 'LoadPipeline', 'Load Diffusers Video Pipeline', 'Load Video Pipeline'],
  ['DiffusersVideo', 'WanVACELoadPipeline', 'Load Wan VACE', 'Load Wan VACE Pipeline'],
  ['DiffusersImage', 'Generate', 'Diffusers Image Generate', 'Generate Image'],
  ['DiffusersAudio', 'Generate', 'Diffusers Audio Generate', 'Generate Audio'],
  ['DiffusersImage', 'LoadAdapter', 'Load Diffusers Image Adapter', 'Load Image Adapter'],
  ['DiffusersAudio', 'LoadAdapter', 'Load Diffusers Audio LoRA', 'Load Audio LoRA'],
  ['DiffusersThreeD', 'GenerateRenderedArtifact', 'Diffusers 3D Rendered Generate', 'Render 3D Orbit'],
  ['Video', 'LyricOverlay', 'Timed Lyric Overlay', 'Add Timed Lyrics'],
  ['DiffusersImage', 'ControlGenerate', 'Diffusers Control Generate', 'Generate Image with Control'],
  ['DiffusersImage', 'OutpaintCanvas', 'Outpaint Canvas', 'Prepare Outpaint Canvas'],
  ['DiffusersImage', 'Edit', 'Diffusers Image Edit', 'Edit Image'],
  ['DiffusersImage', 'ControlEdit', 'Diffusers Control Edit', 'Edit Image with Control'],
  ['DiffusersImage', 'ControlInpaint', 'Diffusers Control Inpaint', 'Inpaint Image with Control'],
  ['Audio', 'Preview', 'Preview Audio', 'Preview Audio'],
  ['Image', 'Preview', 'Preview Image', 'Preview Image'],
  ['ModularDiffusers', 'LatentsPreview', 'Latents Preview', 'Preview Latents'],
  ['Audio', 'Export', 'Export Audio', 'Export Audio'],
  ['Image', 'Save', 'Save Image', 'Save Image'],
  ['Primitive', 'ExportData', 'Export Data', 'Export Data'],
  ['Video', 'Export', 'Export Video', 'Export Video'],
  ['Video', 'ExportAsset', 'Export Retained Video Asset', 'Export Video Asset'],
  ['DiffusersVideo', 'Generate', 'Diffusers Video Generate', 'Generate Video'],
  ['DiffusersVideo', 'GenerateShotJob', 'Generate Video Shot Job', 'Generate Video Shot'],
  ['DiffusersVideo', 'WanVACEGenerate', 'Wan VACE Generate', 'Generate Video with Wan VACE'],
];
before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  catalog = await server.ssrLoadModule('/src/studio/nodeCatalog.ts');
  browser = await server.ssrLoadModule('/src/workflow/workflowTaskBrowser.ts');
});
after(async () => server?.close());

const node = (module, action, label) => ({ module: `modules.${module}`, action, label, params: {}, type: 'custom' });

test('distinct loader, edit, output and generation contracts have unambiguous catalog names', () => {
  const labels = cases.map(([module, action, label, expected]) => {
    const entry = catalog.getNodeCatalogEntry(node(module, action, label));
    assert.equal(entry.label, expected, `${module}.${action}`);
    assert.equal(catalog.getNodeCatalogEntry(node(module, action, `modules.${module}.${action}`)).label, expected);
    assert.equal(catalog.nodeCatalogEntryMatchesSearch(entry, label), true, 'Original name remains searchable');
    return entry.label.toLowerCase();
  });
  assert.equal(new Set(labels).size, labels.length);
});

test('custom and unknown operations keep their declared names, even with generate/edit/export in their identity', () => {
  for (const module of ['custom.PictureTools', 'modules.FutureTools']) {
    const data = { ...node('Unused', 'GenerateEditExport', 'Extract Foreground Mask'), module };
    const before = JSON.stringify(data);
    assert.equal(catalog.getNodeCatalogEntry(data).label, 'Extract Foreground Mask');
    assert.equal(JSON.stringify(data), before);
  }
});

test('user titles remain intact and a registry alias uses the executable identity for presentation', () => {
  const data = node('DiffusersImage', 'OutpaintCanvas', 'Outpaint Canvas');
  assert.equal(catalog.getNodeCatalogEntry(data, 'legacy.canvas').label, 'Prepare Outpaint Canvas');
  assert.equal(catalog.getNodeCatalogEntry({ ...data, label: 'My border preparation' }).label, 'My border preparation');
});

test('task browser groups modalities, deduplicates models and prefers available composable execution', () => {
  const choice = (id, task, overrides = {}) => ({
    id,
    task,
    label: id,
    cache: null,
    support: { dependencies: 'ready', execution: 'adapter', decomposition: 'pipeline' },
    ...overrides,
  });
  const choices = [
    choice('uninstalled', 'text_to_image'),
    choice('installed-pipeline', 'text_to_image', { cache: { runnable: true } }),
    choice('installed-modular', 'text_to_image', {
      cache: { runnable: true },
      support: { dependencies: 'ready', execution: 'adapter', decomposition: 'stages' },
    }),
    choice('audio', 'text_to_audio'),
    choice('video-audio', 'text_to_video_with_audio'),
    choice('mesh', 'image_to_3d'),
    choice('tools', 'action_policy'),
  ];
  const cards = browser.workflowTaskCards(choices);
  assert.equal(cards.length, 5);
  assert.equal(cards.find((c) => c.task === 'text_to_image').downloaded, true);
  assert.deepEqual(
    new Set(cards.map((c) => c.category)),
    new Set(['Image', 'Audio', 'Video', '3D', 'Text & Utilities']),
  );
  assert.equal(browser.defaultWorkflowChoice(choices, 'text_to_image').id, 'installed-modular');
  assert.equal(browser.defaultWorkflowChoice(choices, 'missing'), undefined);
});

test('composite runtime identities distinguish media loading from pipeline loading and generation', async () => {
  const { builtinNodeDisplayLabel } = await server.ssrLoadModule('/src/workflow/nodePresentation.ts');
  assert.equal(builtinNodeDisplayLabel('modules.Audio.Load', 'Load'), 'Load Audio');
  assert.equal(builtinNodeDisplayLabel('modules.Image.Load', 'Load'), 'Load Image');
  assert.equal(builtinNodeDisplayLabel('modules.DiffusersImage.LoadPipeline', 'Load'), 'Load Image Pipeline');
  assert.equal(builtinNodeDisplayLabel('modules.DiffusersAudio.LoadPipeline', 'Load'), 'Load Audio Pipeline');
  assert.equal(builtinNodeDisplayLabel('modules.DiffusersAudio.Generate', 'Generate'), 'Generate Audio');
  assert.equal(builtinNodeDisplayLabel('modules.DiffusersImage.Generate', 'Generate'), 'Generate Image');
  assert.equal(builtinNodeDisplayLabel('custom.Image.Generate', 'My custom sampler'), 'My custom sampler');
});
