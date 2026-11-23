import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server;
let catalog;
let browser;
let presentation;
let utilityPresentation;
let operationCatalog;
const cases = [
  ['ModularDiffusers', 'ModelsLoader', 'Load Models', 'Load Modular Components'],
  ['ModularDiffusers', 'AutoModelLoader', 'Load Model', 'Load Model Component'],
  [
    'ModularDiffusers',
    'WorkflowJointAVReferenceAssembler',
    'Add Ordered Video or Audio Reference',
    'Add Ordered Media Reference',
  ],
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
  ['ModularDiffusers', 'LatentsPreview', 'Latents Preview', 'Preview 4-Channel Latent'],
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
  presentation = await server.ssrLoadModule('/src/workflow/nodePresentation.ts');
  utilityPresentation = await server.ssrLoadModule('/src/workflow/builtinUtilityOperationPresentation.ts');
  operationCatalog = await server.ssrLoadModule('/src/workflow/operationCatalog.ts');
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

test('canonical portable captions display their exact execution action while retaining authored titles and data', () => {
  const stock = [
    ['DiffusersAudio', 'Generate', 'Diffusers.GenerateAudio', 'Generate Audio'],
    ['DiffusersAudio', 'LoadPipeline', 'Diffusers.LoadPipeline', 'Load Audio Pipeline'],
    ['DiffusersImage', 'ControlEdit', 'Diffusers.ControlEdit', 'Edit Image with Control'],
    ['DiffusersImage', 'ControlGenerate', 'Diffusers.Control', 'Generate Image with Control'],
    ['DiffusersImage', 'ControlInpaint', 'Diffusers.ControlInpaint', 'Inpaint Image with Control'],
    ['DiffusersImage', 'Edit', 'Diffusers.Edit', 'Edit Image'],
    ['DiffusersImage', 'Generate', 'Diffusers.Generate', 'Generate Image'],
    ['DiffusersImage', 'Inpaint', 'Diffusers.Inpaint', 'Inpaint Image'],
    ['DiffusersImage', 'LoadPipeline', 'Diffusers.LoadPipeline', 'Load Image Pipeline'],
    ['DiffusersThreeD', 'GenerateRenderedArtifact', 'Diffusers.Generate3D', 'Render 3D Orbit'],
    ['DiffusersThreeD', 'LoadPipeline', 'Diffusers.LoadPipeline', 'Load 3D Pipeline'],
    ['DiffusersVideo', 'Generate', 'Diffusers.Generate', 'Generate Video'],
    ['DiffusersVideo', 'GenerateVideoAudio', 'Diffusers.Generate', 'Generate Video and Audio'],
    ['DiffusersVideo', 'LoadPipeline', 'Diffusers.LoadPipeline', 'Load Video Pipeline'],
    ['ModularDiffusers', 'ModelsLoader', 'Diffusers.LoadPipeline', 'Load Modular Components'],
  ];
  for (const [module, action, label, expected] of stock) {
    const data = node(module, action, label);
    const before = JSON.stringify(data);
    assert.equal(presentation.nodeDisplayLabel(data), expected, module + '.' + action);
    assert.equal(catalog.nodeCatalogEntryMatchesSearch(catalog.getNodeCatalogEntry(data), label), true);
    assert.equal(presentation.nodeDisplayLabel({ ...data, label: label + ' for my scene' }), label + ' for my scene');
    assert.equal(presentation.nodeDisplayLabel({ ...data, module: 'custom.Models' }), label);
    assert.equal(JSON.stringify(data), before);
  }
  const authored = node('DiffusersImage', 'Edit', 'Diffusers.Generate');
  assert.equal(presentation.nodeDisplayLabel(authored), 'Diffusers.Generate');
});

test('stock media loaders show their bound role without changing custom names or unbound palette entries', () => {
  const stock = [
    ['Image', 'loadImage', 'Source Image'],
    ['Image', 'loadMask', 'Mask'],
    ['Image', 'loadControlImage', 'Control Image'],
    ['Image', 'loadIPAdapterImage', 'Reference Image'],
    ['Image', 'loadLastImage', 'Last Frame'],
    ['Audio', 'loadAudio', 'Source Audio'],
    ['Audio', 'loadReferenceAudio', 'Reference Audio'],
    ['Video', 'loadVideo', 'Source Video'],
    ['Video', 'loadReferenceVideo', 'Reference Video'],
    ['Video', 'loadControlVideo', 'Control Video'],
    ['Video', 'loadMaskVideo', 'Mask Video'],
    ['Video', 'loadPoseVideo', 'Pose Video'],
    ['Video', 'loadFaceVideo', 'Face Video'],
    ['Video', 'loadBackgroundVideo', 'Background Video'],
  ];
  for (const [module, studioRole, expected] of stock) {
    const label = 'Load ' + module;
    const data = { ...node(module, 'Load', label), studioRole };
    const before = JSON.stringify(data);
    assert.equal(presentation.nodeDisplayLabel(data), expected);
    assert.equal(
      presentation.nodeDisplayLabel({ ...data, label: 'Reference from my camera' }),
      'Reference from my camera',
    );
    assert.equal(presentation.nodeDisplayLabel({ ...data, studioRole: 'unknownRole' }), label);
    assert.equal(presentation.nodeDisplayLabel({ ...data, module: 'custom.Media' }), label);
    assert.equal(presentation.nodeDisplayLabel({ ...data, action: 'Clone' }), label);
    assert.equal(presentation.nodeDisplayLabel({ ...data, studioRole: undefined }), label);
    assert.equal(JSON.stringify(data), before);
  }
  assert.equal(
    presentation.nodeDisplayLabel({ ...node('Audio', 'Load', 'Load Audio'), studioRole: 'loadMask' }),
    'Load Audio',
  );
});

test('managed image actions show their exact task instead of the shared generation operation title', () => {
  const cases = [
    ['Edit', 'edit_image', 'Edit Image'],
    ['Edit', 'multi_image_reference_edit', 'Edit Image'],
    ['Inpaint', 'inpaint', 'Inpaint Image'],
    ['Inpaint', 'outpaint', 'Outpaint Image'],
    ['ControlGenerate', 'control_image', 'Generate Image with Control'],
    ['ControlEdit', 'control_edit_image', 'Edit Image with Control'],
    ['ControlInpaint', 'control_inpaint', 'Inpaint Image with Control'],
    ['UnconditionalGenerate', 'unconditional_image', 'Generate Unconditional Image'],
  ];
  for (const [action, task, expected] of cases) {
    const data = {
      ...node('DiffusersImage', action, 'Generate Image'),
      operationAuthoring: {
        operation: { operationId: 'diffusion.generate_image', nodeKey: `modules.DiffusersImage.${action}`, task },
      },
    };
    const before = JSON.stringify(data);
    assert.equal(presentation.nodeDisplayLabel(data), expected);
    assert.equal(operationCatalog.operationLabel(data.operationAuthoring.operation), expected);
    assert.equal(presentation.nodeDisplayLabel({ ...data, label: 'My authored stage' }), 'My authored stage');
    assert.equal(presentation.nodeDisplayLabel({ ...data, module: 'custom.Images' }), 'Generate Image');
    assert.equal(JSON.stringify(data), before);
  }
  assert.equal(
    operationCatalog.operationLabel({ operationId: 'diffusion.generate_image', nodeKey: 'custom.Images.Edit' }),
    'Generate image',
  );
});

test('common discovery shows ordinary image and video preparation but keeps native recipe details advanced', () => {
  const cases = [
    ['DiffusersImage', 'ControlEdit', 'Edit'],
    ['DiffusersImage', 'ControlInpaint', 'Edit'],
    ['DiffusersImage', 'LayerDecompose', 'Edit'],
    ['DiffusersImage', 'PredictMap', 'Condition'],
    ['VideoConditioning', 'Normalize', 'Condition'],
    ['VideoConditioning', 'AlignMask', 'Edit'],
    ['VideoConditioning', 'OutpaintCanvas', 'Edit'],
    ['VideoConditioning', 'EdgePreprocessor', 'Condition'],
  ];
  for (const [module, action, category] of cases) {
    const entry = catalog.getNodeCatalogEntry(node(module, action, action));
    assert.equal(entry.surfaceCategory, category);
    assert.equal(
      catalog.nodeCatalogEntryMatchesView(entry, 'common'),
      !['ControlEdit', 'ControlInpaint'].includes(action),
    );
    assert.ok(catalog.nodeCatalogEntryMatchesView(entry, 'common', true));
    assert.equal(entry.dragKey, `modules.${module}.${action}`);
  }
  for (const [module, action] of [
    ['DiffusersRuntime', 'PipelineQuantizationConfigV2'],
    ['DiffusersRuntime', 'DiffusersExecutionRecipe'],
    ['ModularDiffusers', 'WorkflowMiniMaxH3TextEncode'],
  ]) {
    const entry = catalog.getNodeCatalogEntry(node(module, action, action));
    assert.equal(catalog.nodeCatalogEntryMatchesView(entry, 'common'), false);
    assert.ok(catalog.nodeCatalogEntryMatchesView(entry, 'advanced'));
  }
});

test('ordinary controls and sockets distinguish requested settings from supplied or measured results', () => {
  const fields = [
    ['Image.Merge', 'image_from', 'Image From', 'Overlay image'],
    ['Image.Merge', 'image_to', 'Image To', 'Base image'],
    ['Image.Merge', 'output', 'Output', 'Composite image'],
    ['Image.ApplyMask', 'output', 'Output', 'Masked image'],
    ['Image.Compare', 'image_1', 'Image From', 'Before image'],
    ['Image.Compare', 'image_2', 'Image To', 'After image'],
    ['Image.Preview', 'export', 'Export', 'Image indices'],
    ['Video.FrameExtract', 'fps', 'FPS', 'Frame-list FPS'],
    ['VideoConditioning.FirstLastFrames', 'first', 'First', 'First frame'],
    ['VideoConditioning.FirstLastFrames', 'last', 'Last', 'Last frame'],
    ['VideoConditioning.FirstLastFrames', 'references', 'References', 'Frame pair'],
    ['ModularDiffusers.Guider', 'guider', 'Guider', 'Guidance type'],
    ['ModularDiffusers.Guider', 'guider_out', 'Guider', 'Configured guider'],
    ['ModularDiffusers.ModelsLoader', 'unet', 'Denoise Model', 'Denoiser override'],
    ['ModularDiffusers.ModelsLoader', 'unet_out', 'Denoise Model', 'Loaded denoiser'],
    ['ModularDiffusers.ModelsLoader', 'vae', 'VAE', 'VAE override'],
    ['ModularDiffusers.ModelsLoader', 'vae_out', 'VAE', 'Loaded VAE'],
    ['DiffusersRuntime.ApplyPipelineRuntimeConfig', 'configured_pipeline', 'Pipeline', 'Configured pipeline'],
    ['DiffusersImage.LoadAdapter', 'output', 'Pipeline', 'Adapted pipeline'],
    ['DiffusersImage.Generate', 'width_out', 'Width', 'Actual width'],
    ['DiffusersImage.Inpaint', 'height_out', 'Height', 'Actual height'],
    ['DiffusersVideo.Denoise', 'width_out', 'Width', 'Actual width'],
    ['DiffusersVideo.GenerateVideoAudio', 'height_out', 'Height', 'Actual height'],
    ['VideoConditioning.Normalize', 'video', 'Video', 'Source frames'],
    ['VideoConditioning.Normalize', 'num_frames', 'Frames', 'Target frames'],
    ['VideoConditioning.Normalize', 'output', 'Video', 'Normalized video'],
    ['VideoConditioning.Normalize', 'frames_out', 'Frames', 'Actual frame count'],
    ['ModularDiffusers.Scheduler', 'scheduler_in', 'Scheduler', 'Base scheduler'],
    ['ModularDiffusers.Scheduler', 'scheduler', 'Scheduler', 'Scheduler type'],
    ['ModularDiffusers.Scheduler', 'scheduler_out', 'Scheduler', 'Configured scheduler'],
    ['Video.MuxAudioAsset', 'fit', 'Duration', 'Audio fit'],
    ['Video.MuxAudioAsset', 'duration_seconds', 'Duration', 'Measured duration (s)'],
    ['DiffusersAudio.Generate', 'sample_rate', 'Sample Rate', 'Requested sample rate'],
    ['DiffusersAudio.Generate', 'sample_rate_out', 'Sample Rate', 'Actual sample rate'],
    ['Audio.FitDuration', 'target_sample_rate', 'Target SR', 'Target sample rate'],
  ];
  for (const [action, field, label, expected] of fields) {
    const key = `modules.${action}`;
    assert.equal(presentation.nodeFieldDisplayLabel(key, field, label), expected);
    assert.equal(presentation.nodeFieldDisplayLabel(key, field, 'My title'), 'My title');
    assert.equal(presentation.nodeFieldDisplayLabel(`custom.${action}`, field, label), label);
  }
});

test('the reviewed Block placement helper stays resolvable but cannot be inserted from discovery', () => {
  const step = node('ModularDiffusers', 'ReviewedModularWorkflowStep', 'Reviewed Modular Diffusers Block');
  const [entry] = catalog.nodeCatalogEntries({ 'modules.ModularDiffusers.ReviewedModularWorkflowStep': step });
  assert.equal(entry.node, step);
  for (const view of ['common', 'advanced', 'experimental', 'all']) {
    assert.equal(catalog.nodeCatalogEntryMatchesView(entry, view), false);
  }
  const custom = catalog.getNodeCatalogEntry({ ...step, module: 'custom.Example' });
  assert.equal(catalog.nodeCatalogEntryMatchesView(custom, 'common'), true);
});

test('utility enum captions retain values, live status and authored labels', () => {
  const descriptor = {
    schemaVersion: 1,
    value: 'audio_loudness_match',
    label: 'audio_loudness_match',
    compatibility: 'unknown',
    availability: 'unavailable',
    installationState: 'unavailable',
    disabledReason: 'Retain this status',
  };
  const custom = { ...descriptor, value: 'audio_join', label: 'My soundtrack join' };
  const options = ['audio_trim', descriptor, custom];
  assert.deepEqual(
    utilityPresentation.builtinUtilityOptionPresentation('modules.Audio.ProcessAudio', 'operation', options),
    [{ value: 'audio_trim', label: 'Trim Audio' }, { ...descriptor, label: 'Match Loudness' }, custom],
  );
  assert.equal(
    utilityPresentation.builtinUtilityOptionPresentation('custom.Audio.ProcessAudio', 'operation', options),
    options,
  );
  assert.equal(descriptor.label, descriptor.value);
});

test('direct and generic image filters keep only effective controls without replacing saved settings', () => {
  const { builtinUtilityOperationPresentation, builtinUtilityOptionPresentation } = utilityPresentation;
  const direct = 'modules.ImageOperations.FilterImage';
  const generic = 'modules.ImageOperations.ProcessImage';
  const params = { operation: { default: 'gaussian_blur' }, threshold: { value: 11 }, seed: { value: 23 } };
  const snapshot = structuredClone(params);
  assert.deepEqual([...builtinUtilityOperationPresentation(direct, params).inactive].sort(), ['seed', 'threshold']);
  for (const [filter, unavailable] of [
    ['unsharp_mask', 'seed'],
    ['film_grain', 'threshold'],
  ]) {
    const directView = builtinUtilityOperationPresentation(direct, { ...params, operation: { value: filter } });
    const genericView = builtinUtilityOperationPresentation(generic, {
      ...params,
      operation: { value: 'image_filter' },
      filter_operation: { value: filter },
    });
    assert.deepEqual([...directView.inactive], [unavailable]);
    assert.equal(genericView.inactive.has(unavailable), true);
    assert.equal(genericView.inactive.has(unavailable === 'seed' ? 'threshold' : 'seed'), false);
  }
  assert.deepEqual(
    [
      ...builtinUtilityOperationPresentation(direct, { operation: { value: 'gaussian_blur', isConnected: true } })
        .inactive,
    ],
    [],
  );
  assert.equal(builtinUtilityOperationPresentation('custom.Custom.FilterImage', params), undefined);
  assert.deepEqual(builtinUtilityOptionPresentation(direct, 'operation', ['gaussian_blur', 'film_grain']), [
    { value: 'gaussian_blur', label: 'Gaussian Blur' },
    { value: 'film_grain', label: 'Film Grain' },
  ]);
  assert.deepEqual(params, snapshot);
});

test('direct frame extraction shows the selected timing input and preserves frame-list FPS', () => {
  const { builtinUtilityOperationPresentation, builtinUtilityOptionPresentation } = utilityPresentation;
  const action = 'modules.Video.FrameExtract';
  const params = { mode: { default: 'first_last' }, fps: { value: 24 }, timecodes: { value: '1.25' } };
  const before = structuredClone(params);
  assert.deepEqual(
    [...builtinUtilityOperationPresentation(action, params).inactive],
    ['indices', 'timecodes', 'every_n'],
  );
  for (const active of ['indices', 'timecodes', 'every_n']) {
    const { inactive } = builtinUtilityOperationPresentation(action, { ...params, mode: { value: active } });
    assert.equal(inactive.size, 2);
    assert.equal(inactive.has(active), false);
    assert.equal(inactive.has('fps'), false);
  }
  assert.deepEqual(
    [...builtinUtilityOperationPresentation(action, { mode: { value: 'timecodes', isConnected: true } }).inactive],
    [],
  );
  assert.deepEqual(builtinUtilityOptionPresentation(action, 'mode', ['first_last', 'timecodes']), [
    { value: 'first_last', label: 'First and Last Frames' },
    { value: 'timecodes', label: 'Timecodes' },
  ]);
  assert.deepEqual(params, before);
});

test('discoverability reflects the encoder role and both declared upscale media types', () => {
  const encoder = { ...node('ModularDiffusers', 'ImageEncode', 'Encode Image'), category: 'sampler' };
  const upscaler = {
    ...node('Spandrel', 'Upscaler', 'Upscale with model'),
    category: 'upscaler',
    params: {
      image: { display: 'input', type: ['image', 'video'] },
      output: { display: 'output', type: ['image', 'video'] },
    },
  };
  const before = JSON.stringify({ encoder, upscaler });
  const encode = catalog.getNodeCatalogEntry(encoder);
  assert.deepEqual(encode.groupPath, ['Models & Components', 'Condition']);
  assert.equal(encode.dragKey, 'modules.ModularDiffusers.ImageEncode');
  assert.ok(catalog.nodeCatalogEntryMatchesSearch(encode, 'encode image'));

  const upscale = catalog.getNodeCatalogEntry(upscaler);
  assert.deepEqual(upscale.groupPath, ['Image & Video', 'Upscale']);
  assert.equal(upscale.dragKey, 'modules.Spandrel.Upscaler');
  assert.equal(upscale.label, 'Upscale Image or Video');
  assert.ok(catalog.nodeCatalogEntryMatchesView(upscale, 'common'));
  for (const search of ['image upscale', 'video upscale', 'Upscale with model']) {
    assert.ok(catalog.nodeCatalogEntryMatchesSearch(upscale, search), search);
  }
  const imageOnly = {
    ...upscaler,
    params: { ...upscaler.params, image: { display: 'input', type: 'image' } },
  };
  assert.notEqual(catalog.getNodeCatalogEntry(imageOnly).groupPath[0], 'Image & Video');
  assert.equal(JSON.stringify({ encoder, upscaler }), before);
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
