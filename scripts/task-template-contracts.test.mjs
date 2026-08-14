import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let contractsModule;
let executionSpecsModule;
let hashModule;
let modelProfilesModule;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  contractsModule = await server.ssrLoadModule('/src/studio/taskTemplateContracts.ts');
  executionSpecsModule = await server.ssrLoadModule('/src/studio/executionSpecs.ts');
  hashModule = await server.ssrLoadModule('/src/studio/stableHash.ts');
  modelProfilesModule = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
});

after(async () => {
  await server?.close();
});

const fixtures = [
  {
    modelType: 'FluxDevPipeline',
    mode: 'text_to_image',
    mediaKind: 'image',
    profileId: 'fixture-image:direct',
    specId: 'fixture-image:text-to-image:v1',
    loaderModule: 'modules.DiffusersImage',
    loaderAction: 'LoadPipeline',
    loaderRole: 'diffusersImagePipeline',
    pipelineClass: 'FluxPipeline',
    repo: 'owner/image-model',
    outputRole: 'preview',
    outputNode: 'modules.Image.Preview',
    outputHandle: 'image',
    requiredMedia: [],
  },
  {
    modelType: 'WanVideoPipeline',
    mode: 'video_to_video',
    mediaKind: 'video',
    profileId: 'fixture-video:direct',
    specId: 'fixture-video:video-to-video:v1',
    loaderModule: 'modules.DiffusersVideo',
    loaderAction: 'LoadPipeline',
    loaderRole: 'wanPipeline',
    pipelineClass: 'WanVideoToVideoPipeline',
    repo: 'owner/video-model',
    outputRole: 'videoExport',
    outputNode: 'modules.Video.Export',
    outputHandle: 'video',
    requiredMedia: [{ kind: 'video', field: 'sourceVideo', minimumCount: 1 }],
  },
  {
    modelType: 'AceStepAudioPipeline',
    mode: 'audio_continuation',
    mediaKind: 'audio',
    profileId: 'fixture-audio:direct',
    specId: 'fixture-audio:audio-continuation:v1',
    loaderModule: 'modules.DiffusersAudio',
    loaderAction: 'LoadPipeline',
    loaderRole: 'audioPipeline',
    pipelineClass: 'AceStepPipeline',
    repo: 'owner/audio-model',
    outputRole: 'audioExport',
    outputNode: 'modules.Audio.Export',
    outputHandle: 'audio',
    requiredMedia: [{ kind: 'audio', field: 'sourceAudio', minimumCount: 1 }],
  },
  {
    modelType: 'HuggingFaceSpeechRecognitionModel',
    mode: 'speech_to_text',
    mediaKind: 'json',
    profileId: 'fixture-speech:direct',
    specId: 'fixture-speech:speech-to-text:v1',
    loaderModule: 'modules.HuggingFaceSpeech',
    loaderAction: 'LoadSpeechRecognitionModel',
    loaderRole: 'speechModel',
    pipelineClass: 'AutoModelForSpeechSeq2Seq',
    repo: 'owner/speech-model',
    outputRole: 'transcriptPreview',
    outputNode: 'modules.Primitive.DataViewer',
    outputHandle: 'value',
    requiredMedia: [{ kind: 'audio', field: 'sourceAudio', minimumCount: 1 }],
  },
  {
    modelType: 'HuggingFaceTextGenerationModel',
    mode: 'text_generation',
    mediaKind: 'json',
    profileId: 'fixture-transformers-text:direct',
    specId: 'fixture-transformers-text:text-generation:v1',
    loaderModule: 'modules.HuggingFaceTransformers',
    loaderAction: 'LoadTextGenerationModel',
    loaderRole: 'transformersTextModel',
    pipelineClass: 'AutoModelForCausalLM',
    repo: 'owner/text-model',
    outputRole: 'transformersTextPreview',
    outputNode: 'modules.Primitive.DataViewer',
    outputHandle: 'value',
    requiredMedia: [],
  },
  {
    modelType: 'HuggingFaceImageTextToTextModel',
    mode: 'image_to_text',
    mediaKind: 'json',
    profileId: 'fixture-transformers-image-text:direct',
    specId: 'fixture-transformers-image-text:image-to-text:v1',
    loaderModule: 'modules.HuggingFaceTransformers',
    loaderAction: 'LoadImageTextToTextModel',
    loaderRole: 'transformersImageTextModel',
    pipelineClass: 'AutoModelForImageTextToText',
    repo: 'owner/image-text-model',
    outputRole: 'transformersTextPreview',
    outputNode: 'modules.Primitive.DataViewer',
    outputHandle: 'value',
    requiredMedia: [{ kind: 'image', field: 'referenceImages', minimumCount: 1 }],
  },
];

function buildFixture() {
  const capabilities = [];
  const contracts = [];
  for (const fixture of fixtures) {
    const executionSpec = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: fixture.specId,
      modelType: fixture.modelType,
      mode: fixture.mode,
      executionProfileId: fixture.profileId,
      loaderModule: fixture.loaderModule,
      loaderAction: fixture.loaderAction,
      executionPath: `fixture-${fixture.mediaKind}`,
      pipelineClass: fixture.pipelineClass,
      defaultRepo: fixture.repo,
      roles: [
        [fixture.loaderRole, `${fixture.loaderModule}.${fixture.loaderAction}`, 0, 0],
        [fixture.outputRole, fixture.outputNode, 400, 0],
      ],
      edges: [[fixture.loaderRole, 'output', fixture.outputRole, fixture.outputHandle]],
      bindings: [[fixture.loaderRole, 'model_id', 'artifact']],
      autoFields: [],
      actions: [],
      contentHash: `studio-spec-v1-${fixture.mediaKind.padEnd(8, '0').slice(0, 8)}`,
    };
    const profile = {
      id: fixture.profileId,
      loader_module: fixture.loaderModule,
      loader_action: fixture.loaderAction,
      pipeline_class: fixture.pipelineClass,
      default_repo: fixture.repo,
    };
    capabilities.push({
      modelType: fixture.modelType,
      studioExecutionSpecs: [executionSpec],
      executionProfiles: [profile],
    });
    const semantic = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `task-template:${fixture.specId}`,
      modelType: fixture.modelType,
      mode: fixture.mode,
      mediaKind: fixture.mediaKind,
      executionProfileId: fixture.profileId,
      executionSpecId: fixture.specId,
      executionSpecContentHash: executionSpec.contentHash,
      loaderModule: fixture.loaderModule,
      loaderAction: fixture.loaderAction,
      loaderRole: fixture.loaderRole,
      pipelineClass: fixture.pipelineClass,
      defaultRepo: fixture.repo,
      loaderRepositories: [fixture.repo],
      requiredMedia: fixture.requiredMedia,
      output: {
        mediaKind: fixture.mediaKind,
        role: fixture.outputRole,
        nodeKey: fixture.outputNode,
        inputHandle: fixture.outputHandle,
      },
      qualificationStatus: 'graph-qualified-execution-pending',
      galleryEligible: false,
    };
    contracts.push({
      ...semantic,
      contentHash: `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semantic))}`,
    });
  }
  return { capabilities, contracts };
}

test('generic image video audio and JSON task contracts build stable skeletons and preserve required media', () => {
  const fixture = buildFixture();
  const parsed = contractsModule.parseTaskTemplateContracts(fixture.contracts, 1, fixture.capabilities);
  const first = parsed.map(contractsModule.buildTaskTemplateSkeleton);
  const second = parsed.map(contractsModule.buildTaskTemplateSkeleton);

  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(
    first.map(({ mediaKind, requiredMedia }) => [
      mediaKind,
      requiredMedia.map(({ kind, field, minimumCount }) => [kind, field, minimumCount]),
    ]),
    [
      ['image', []],
      ['video', [['video', 'sourceVideo', 1]]],
      ['audio', [['audio', 'sourceAudio', 1]]],
      ['json', [['audio', 'sourceAudio', 1]]],
      ['json', []],
      ['json', [['image', 'referenceImages', 1]]],
    ],
  );
  assert.equal(new Set(first.map(({ id }) => id)).size, 6);
});

test('qualification-pending task skeletons remain hidden from Gallery', () => {
  const fixture = buildFixture();
  const parsed = contractsModule.parseTaskTemplateContracts(fixture.contracts, 1, fixture.capabilities);
  assert.deepEqual(contractsModule.galleryTaskTemplateSkeletons(parsed), []);
  assert.ok(parsed.every((contract) => contract.galleryEligible === false));
});

test('Smol Transformers profiles and exact generic execution roles stay workflow-only', () => {
  const cases = [
    {
      modelType: 'HuggingFaceTextGenerationModel',
      mode: 'text_generation',
      profileId: 'smollm2-135m-instruct:direct',
      loaderAction: 'LoadTextGenerationModel',
      executionPath: 'direct-huggingface-transformers-text',
      pipelineClass: 'AutoModelForCausalLM',
      repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
      roles: [
        ['transformersTextModel', 'modules.HuggingFaceTransformers.LoadTextGenerationModel', -720, -80],
        ['transformersTextGenerate', 'modules.HuggingFaceTransformers.GenerateText', -240, -80],
        ['transformersTextPreview', 'modules.Primitive.DataViewer', 240, -80],
      ],
      edges: [
        ['transformersTextModel', 'model', 'transformersTextGenerate', 'model'],
        ['transformersTextGenerate', 'result', 'transformersTextPreview', 'value'],
      ],
      bindings: [
        ['transformersTextModel', 'model_id', 'artifact'],
        ['transformersTextModel', 'revision', 'defaultRevision'],
        ['transformersTextModel', 'dtype', 'dtype'],
        ['transformersTextModel', 'device', 'device'],
        ['transformersTextGenerate', 'prompt', 'prompt'],
      ],
    },
    {
      modelType: 'HuggingFaceImageTextToTextModel',
      mode: 'image_to_text',
      profileId: 'smolvlm-256m-instruct:direct',
      loaderAction: 'LoadImageTextToTextModel',
      executionPath: 'direct-huggingface-transformers-image-text',
      pipelineClass: 'AutoModelForImageTextToText',
      repo: 'HuggingFaceTB/SmolVLM-256M-Instruct',
      roles: [
        ['transformersImageTextModel', 'modules.HuggingFaceTransformers.LoadImageTextToTextModel', -720, -80],
        ['loadImage', 'modules.Image.Load', -720, 280],
        ['transformersImageTextGenerate', 'modules.HuggingFaceTransformers.GenerateImageVideoText', -240, -80],
        ['transformersTextPreview', 'modules.Primitive.DataViewer', 240, -80],
      ],
      edges: [
        ['transformersImageTextModel', 'model', 'transformersImageTextGenerate', 'model'],
        ['loadImage', 'image', 'transformersImageTextGenerate', 'images'],
        ['transformersImageTextGenerate', 'result', 'transformersTextPreview', 'value'],
      ],
      bindings: [
        ['transformersImageTextModel', 'model_id', 'artifact'],
        ['transformersImageTextModel', 'revision', 'defaultRevision'],
        ['transformersImageTextModel', 'dtype', 'dtype'],
        ['transformersImageTextModel', 'device', 'device'],
        ['loadImage', 'file', 'referenceImages'],
        ['loadImage', 'alpha_channel', 'alphaMode'],
        ['transformersImageTextGenerate', 'prompt', 'prompt'],
      ],
    },
  ];

  for (const item of cases) {
    const profile = {
      id: item.profileId,
      modes: [item.mode],
      loader_module: 'modules.HuggingFaceTransformers',
      loader_action: item.loaderAction,
      execution_path: item.executionPath,
      pipeline_class: item.pipelineClass,
      default_repo: item.repo,
    };
    const semantic = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `${item.profileId.split(':')[0]}:${item.mode.replaceAll('_', '-')}:v1`,
      modelType: item.modelType,
      mode: item.mode,
      executionProfileId: item.profileId,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      executionPath: profile.execution_path,
      pipelineClass: profile.pipeline_class,
      defaultRepo: profile.default_repo,
      roles: item.roles,
      edges: item.edges,
      bindings: item.bindings,
      autoFields: [],
      actions: [],
    };
    const spec = {
      ...semantic,
      contentHash: `studio-spec-v1-${hashModule.hashString(hashModule.stableStringify(semantic))}`,
    };
    assert.deepEqual(executionSpecsModule.parseStudioExecutionSpecs([spec], item.modelType, [item.mode], [profile]), [
      spec,
    ]);
    const staticProfile = modelProfilesModule.STUDIO_MODEL_PROFILES[item.modelType];
    assert.equal(staticProfile.catalogVisibility, 'workflowOnly');
    assert.equal(staticProfile.runtimeKind, 'transformers');
    assert.equal(staticProfile.isDiffusersBacked, false);
    assert.equal(staticProfile.defaultRepo, item.repo);
    assert.deepEqual(staticProfile.offloadSupport.modes, ['none']);
    assert.equal(modelProfilesModule.getDefaultModelForMode(item.mode), item.modelType);
  }
});

test('static Studio profiles bridge the six newly admitted generic Diffusers pairs', () => {
  const pagTextProfiles = [
    [
      'HunyuanDiTPAGPipeline',
      'Hunyuan-DiT v1.2 Distilled PAG',
      'Tencent-Hunyuan/HunyuanDiT-v1.2-Diffusers-Distilled',
      25,
      5,
      undefined,
    ],
    ['PixArtSigmaPAGPipeline', 'PixArt Sigma XL 1024px PAG', 'PixArt-alpha/PixArt-Sigma-XL-2-1024-MS', 20, 4.5, 300],
    ['SanaPAGPipeline', 'Sana 0.6B PAG', 'Efficient-Large-Model/Sana_600M_1024px_diffusers', 20, 4.5, 300],
  ];
  for (const [modelType, label, repo, steps, guidance, maxSequenceLength] of pagTextProfiles) {
    const profile = modelProfilesModule.STUDIO_MODEL_PROFILES[modelType];
    assert.equal(profile.label, label);
    assert.equal(profile.catalogVisibility, 'workflowOnly');
    assert.equal(profile.defaultRepo, repo);
    assert.equal(profile.recommendedSteps, steps);
    assert.equal(profile.recommendedGuidance, guidance);
    assert.equal(profile.recommendedMaxSequenceLength, maxSequenceLength);
    assert.equal(profile.recommendedPagScale, 3);
    assert.equal(profile.recommendedPagAdaptiveScale, 0);
    assert.deepEqual(profile.modes, ['text_to_image']);
    assert.deepEqual(modelProfilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS[modelType].supportedModes, ['text_to_image']);
  }

  const lcm = modelProfilesModule.STUDIO_MODEL_PROFILES.LatentConsistencyModelPipeline;
  assert.deepEqual(lcm.modes, ['text_to_image', 'edit_image']);
  assert.equal(lcm.supportsImageInput, true);
  assert.deepEqual(lcm.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.deepEqual(modelProfilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.LatentConsistencyModelPipeline.supportedModes, [
    'text_to_image',
    'edit_image',
  ]);

  const sd15Pag = modelProfilesModule.STUDIO_MODEL_PROFILES.StableDiffusionPAGPipeline;
  assert.deepEqual(sd15Pag.modes, ['text_to_image', 'edit_image', 'inpaint', 'control_image', 'control_inpaint']);
  assert.equal(sd15Pag.supportsImageInput, true);
  assert.equal(sd15Pag.supportsMask, true);
  assert.deepEqual(sd15Pag.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.deepEqual(sd15Pag.modeRequirements.inpaint.requiredImages, ['referenceImages', 'maskImage']);
  assert.deepEqual(modelProfilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.StableDiffusionPAGPipeline.supportedModes, [
    'text_to_image',
    'edit_image',
    'inpaint',
    'control_image',
    'control_inpaint',
  ]);
});

test('the 12 reviewed control pairs expose exact generic media and execution contracts', () => {
  const cases = [
    {
      modelType: 'StableDiffusionPAGPipeline',
      mode: 'control_image',
      specId: 'sd15-pag-controlnet-canny:control-image:v1',
      profileId: 'sd15-pag-controlnet-canny:direct',
      pipelineClass: 'StableDiffusionControlNetPAGPipeline',
      repo: modelProfilesModule.SD15_BASE_REPO,
    },
    {
      modelType: 'StableDiffusionPAGPipeline',
      mode: 'control_inpaint',
      specId: 'sd15-pag-controlnet-canny:control-inpaint:v1',
      profileId: 'sd15-pag-controlnet-canny:inpaint-direct',
      pipelineClass: 'StableDiffusionControlNetPAGInpaintPipeline',
      repo: modelProfilesModule.SD15_BASE_REPO,
    },
    {
      modelType: 'StableDiffusionXLPAGPipeline',
      mode: 'control_image',
      specId: 'sdxl-pag-controlnet-canny:control-image:v1',
      profileId: 'sdxl-pag-controlnet-canny:direct',
      pipelineClass: 'StableDiffusionXLControlNetPAGPipeline',
      repo: modelProfilesModule.SDXL_BASE_REPO,
    },
    {
      modelType: 'StableDiffusionXLPAGPipeline',
      mode: 'control_edit_image',
      specId: 'sdxl-pag-controlnet-canny:control-edit-image:v1',
      profileId: 'sdxl-pag-controlnet-canny:img2img-direct',
      pipelineClass: 'StableDiffusionXLControlNetPAGImg2ImgPipeline',
      repo: modelProfilesModule.SDXL_BASE_REPO,
    },
    {
      modelType: 'StableDiffusionPipeline',
      mode: 'control_edit_image',
      specId: 'sd15-controlnet-canny:control-edit-image:v1',
      profileId: 'sd15-controlnet-canny:img2img-direct',
      pipelineClass: 'StableDiffusionControlNetImg2ImgPipeline',
      repo: modelProfilesModule.SD15_BASE_REPO,
    },
    {
      modelType: 'StableDiffusionPipeline',
      mode: 'control_inpaint',
      specId: 'sd15-controlnet-canny:control-inpaint:v1',
      profileId: 'sd15-controlnet-canny:inpaint-direct',
      pipelineClass: 'StableDiffusionControlNetInpaintPipeline',
      repo: modelProfilesModule.SD15_BASE_REPO,
    },
    {
      modelType: 'StableDiffusionXLControlNetPipeline',
      mode: 'control_edit_image',
      specId: 'sdxl-controlnet-canny:control-edit-image:v1',
      profileId: 'sdxl-controlnet-canny:img2img-direct',
      pipelineClass: 'StableDiffusionXLControlNetImg2ImgPipeline',
      repo: modelProfilesModule.SDXL_BASE_REPO,
    },
    {
      modelType: 'StableDiffusionXLControlNetPipeline',
      mode: 'control_inpaint',
      specId: 'sdxl-controlnet-canny:control-inpaint:v1',
      profileId: 'sdxl-controlnet-canny:inpaint-direct',
      pipelineClass: 'StableDiffusionXLControlNetInpaintPipeline',
      repo: modelProfilesModule.SDXL_BASE_REPO,
    },
    {
      modelType: 'FluxDepthPipeline',
      mode: 'control_edit_image',
      specId: 'flux-depth:control-edit-image:v1',
      profileId: 'flux-depth:img2img-direct',
      pipelineClass: 'FluxControlImg2ImgPipeline',
      repo: modelProfilesModule.FLUX_DEPTH_REPO,
    },
    {
      modelType: 'FluxDepthPipeline',
      mode: 'control_inpaint',
      specId: 'flux-depth:control-inpaint:v1',
      profileId: 'flux-depth:inpaint-direct',
      pipelineClass: 'FluxControlInpaintPipeline',
      repo: modelProfilesModule.FLUX_DEPTH_REPO,
    },
    {
      modelType: 'FluxCannyPipeline',
      mode: 'control_edit_image',
      specId: 'flux-canny:control-edit-image:v1',
      profileId: 'flux-canny:img2img-direct',
      pipelineClass: 'FluxControlImg2ImgPipeline',
      repo: modelProfilesModule.FLUX_CANNY_REPO,
    },
    {
      modelType: 'FluxCannyPipeline',
      mode: 'control_inpaint',
      specId: 'flux-canny:control-inpaint:v1',
      profileId: 'flux-canny:inpaint-direct',
      pipelineClass: 'FluxControlInpaintPipeline',
      repo: modelProfilesModule.FLUX_CANNY_REPO,
    },
  ];
  const requiredImages = (mode) =>
    mode === 'control_image'
      ? ['controlImage']
      : mode === 'control_edit_image'
        ? ['referenceImages', 'controlImage']
        : ['referenceImages', 'maskImage', 'controlImage'];
  const requiredMedia = (mode) => requiredImages(mode).map((field) => ({ kind: 'image', field, minimumCount: 1 }));
  const capabilities = new Map();
  const contracts = [];

  for (const item of cases) {
    const actionRole =
      item.mode === 'control_image'
        ? 'diffusersImageControl'
        : item.mode === 'control_edit_image'
          ? 'diffusersImageControlEdit'
          : 'diffusersImageControlInpaint';
    const action =
      item.mode === 'control_image'
        ? 'ControlGenerate'
        : item.mode === 'control_edit_image'
          ? 'ControlEdit'
          : 'ControlInpaint';
    const roles = [
      ['diffusersImagePipeline', 'modules.DiffusersImage.LoadPipeline', -520, -80],
      ['loadImage', 'modules.Image.Load', -520, 300],
      ...(item.mode === 'control_inpaint' ? [['loadMask', 'modules.Image.Load', -520, 560]] : []),
      ...(item.mode === 'control_image' ? [] : [['loadControlImage', 'modules.Image.Load', -520, 430]]),
      [actionRole, `modules.DiffusersImage.${action}`, -120, -80],
      ['preview', 'modules.Image.Preview', 320, -80],
    ];
    const sourceRole = item.mode === 'control_image' ? 'loadImage' : 'loadControlImage';
    const edges = [
      ['diffusersImagePipeline', 'pipeline', actionRole, 'pipeline'],
      ...(item.mode === 'control_image' ? [] : [['loadImage', 'image', actionRole, 'image']]),
      ...(item.mode === 'control_inpaint' ? [['loadMask', 'image', actionRole, 'mask_image']] : []),
      [sourceRole, 'image', actionRole, 'control_image'],
      [actionRole, 'images', 'preview', 'image'],
    ];
    const bindings = [
      ['diffusersImagePipeline', 'model_id', 'artifact'],
      ['diffusersImagePipeline', 'pipeline_class', 'pipelineClass'],
      ['diffusersImagePipeline', 'mode', 'mode'],
      ...(item.mode === 'control_image'
        ? [['loadImage', 'file', 'controlImage']]
        : [
            ['loadImage', 'file', 'referenceImages'],
            ['loadControlImage', 'file', 'controlImage'],
          ]),
      ...(item.mode === 'control_inpaint' ? [['loadMask', 'file', 'maskImage']] : []),
      [actionRole, 'prompt', 'prompt'],
      [actionRole, 'conditioning_scale', 'conditioningScale'],
    ];
    const profile = {
      id: item.profileId,
      modes: [item.mode],
      loader_module: 'modules.DiffusersImage',
      loader_action: 'LoadPipeline',
      execution_path: 'direct-diffusers-image',
      pipeline_class: item.pipelineClass,
      default_repo: item.repo,
    };
    const semanticSpec = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: item.specId,
      modelType: item.modelType,
      mode: item.mode,
      executionProfileId: item.profileId,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      executionPath: profile.execution_path,
      pipelineClass: item.pipelineClass,
      defaultRepo: item.repo,
      roles,
      edges,
      bindings,
      autoFields: [],
      actions: [],
    };
    const spec = {
      ...semanticSpec,
      contentHash: `studio-spec-v1-${hashModule.hashString(hashModule.stableStringify(semanticSpec))}`,
    };
    assert.deepEqual(executionSpecsModule.parseStudioExecutionSpecs([spec], item.modelType, [item.mode], [profile]), [
      spec,
    ]);

    const staticProfile = modelProfilesModule.STUDIO_MODEL_PROFILES[item.modelType];
    assert.ok(staticProfile.modes.includes(item.mode), `${item.modelType}/${item.mode} is missing from static modes`);
    assert.deepEqual(staticProfile.modeRequirements[item.mode].requiredImages, requiredImages(item.mode));
    assert.equal(staticProfile.supportsControlImage, true);
    assert.equal(staticProfile.supportsImageInput, true);
    if (item.mode === 'control_inpaint') assert.equal(staticProfile.supportsMask, true);
    assert.ok(modelProfilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS[item.modelType].supportedModes.includes(item.mode));

    const capability = capabilities.get(item.modelType) ?? {
      modelType: item.modelType,
      studioExecutionSpecs: [],
      executionProfiles: [],
    };
    capability.studioExecutionSpecs.push(spec);
    capability.executionProfiles.push(profile);
    capabilities.set(item.modelType, capability);

    const semanticContract = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `task-template:${item.specId}`,
      modelType: item.modelType,
      mode: item.mode,
      mediaKind: 'image',
      executionProfileId: item.profileId,
      executionSpecId: item.specId,
      executionSpecContentHash: spec.contentHash,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      loaderRole: 'diffusersImagePipeline',
      pipelineClass: item.pipelineClass,
      defaultRepo: item.repo,
      loaderRepositories: [item.repo],
      requiredMedia: requiredMedia(item.mode),
      output: {
        mediaKind: 'image',
        role: 'preview',
        nodeKey: 'modules.Image.Preview',
        inputHandle: 'image',
      },
      qualificationStatus: 'graph-qualified-execution-pending',
      galleryEligible: false,
    };
    contracts.push({
      ...semanticContract,
      contentHash: `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semanticContract))}`,
    });
  }

  const parsed = contractsModule.parseTaskTemplateContracts(contracts, 1, [...capabilities.values()]);
  assert.equal(parsed.length, 12);
  assert.ok(parsed.every((contract) => contract.mediaKind === 'image' && contract.output.role === 'preview'));
  assert.equal(modelProfilesModule.STUDIO_MODE_LABELS.control_edit_image, 'Control edit image');
  assert.equal(modelProfilesModule.STUDIO_MODE_LABELS.control_inpaint, 'Control inpaint');
  assert.match(modelProfilesModule.STUDIO_MODE_DESCRIPTIONS.control_edit_image, /source image.*control image/i);
  assert.match(modelProfilesModule.STUDIO_MODE_DESCRIPTIONS.control_inpaint, /masked source.*control image/i);
  assert.equal(modelProfilesModule.getDefaultModelForMode('control_edit_image'), 'StableDiffusionPipeline');
  assert.equal(modelProfilesModule.getDefaultModelForMode('control_inpaint'), 'StableDiffusionPipeline');
});

test('contracts for backend model types unknown to this client are ignored', () => {
  const fixture = buildFixture();
  const parsed = contractsModule.parseTaskTemplateContracts(
    [...fixture.contracts, { modelType: 'FuturePipeline' }],
    1,
    fixture.capabilities,
  );
  assert.equal(parsed.length, fixture.contracts.length);
});

test('the bounded contract envelope admits catalogs larger than the legacy 128-entry limit', () => {
  const fixture = buildFixture();
  const unknownContract = (index) => ({ modelType: `FuturePipeline${index}` });
  const currentCatalog = [
    ...fixture.contracts,
    ...Array.from({ length: 130 - fixture.contracts.length }, (_, index) => unknownContract(index)),
  ];

  const parsed = contractsModule.parseTaskTemplateContracts(currentCatalog, 1, fixture.capabilities);
  assert.equal(parsed.length, fixture.contracts.length);
  assert.equal(contractsModule.MAX_TASK_TEMPLATE_CONTRACTS, 128 * 16);
  assert.throws(
    () =>
      contractsModule.parseTaskTemplateContracts(
        Array.from({ length: contractsModule.MAX_TASK_TEMPLATE_CONTRACTS + 1 }, (_, index) => unknownContract(index)),
        1,
        fixture.capabilities,
      ),
    /Invalid Studio task-template contract/,
  );
});

test('task contracts reject a loader or output identity that diverges from its execution spec', () => {
  const fixture = buildFixture();
  const loaderTamper = structuredClone(fixture.contracts);
  loaderTamper[0].loaderAction = 'AttackerLoader';
  assert.throws(
    () => contractsModule.parseTaskTemplateContracts(loaderTamper, 1, fixture.capabilities),
    /Invalid Studio task-template contract/,
  );

  const outputTamper = structuredClone(fixture.contracts);
  outputTamper[1].output.nodeKey = 'modules.Image.Preview';
  assert.throws(
    () => contractsModule.parseTaskTemplateContracts(outputTamper, 1, fixture.capabilities),
    /Invalid Studio task-template contract/,
  );
});
