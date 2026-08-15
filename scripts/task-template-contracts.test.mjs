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

test('Janus any-to-any specs preserve mode-specific text and image task contracts', () => {
  const modelType = 'HuggingFaceAnyToAnyModel';
  const profile = {
    id: 'janus-pro-1b:direct',
    modes: ['text_generation', 'image_to_text', 'text_to_image'],
    loader_module: 'modules.HuggingFaceTransformers',
    loader_action: 'LoadAnyToAnyModel',
    execution_path: 'direct-huggingface-transformers-any-to-any',
    pipeline_class: 'JanusForConditionalGeneration',
    default_repo: modelProfilesModule.JANUS_PRO_1B_REPO,
  };
  const cases = [
    {
      mode: 'text_generation',
      outputKind: 'json',
      generationSource: 'anyToAnyText',
      roles: [
        ['transformersAnyToAnyModel', 'modules.HuggingFaceTransformers.LoadAnyToAnyModel', -720, -80],
        ['transformersAnyToAnyGenerate', 'modules.HuggingFaceTransformers.GenerateAnyToAny', -240, -80],
        ['transformersTextPreview', 'modules.Primitive.DataViewer', 240, -80],
      ],
      edges: [
        ['transformersAnyToAnyModel', 'model', 'transformersAnyToAnyGenerate', 'model'],
        ['transformersAnyToAnyGenerate', 'result', 'transformersTextPreview', 'value'],
      ],
      requiredMedia: [],
      output: ['transformersTextPreview', 'modules.Primitive.DataViewer', 'value'],
    },
    {
      mode: 'image_to_text',
      outputKind: 'json',
      generationSource: 'anyToAnyText',
      roles: [
        ['transformersAnyToAnyModel', 'modules.HuggingFaceTransformers.LoadAnyToAnyModel', -720, -80],
        ['loadImage', 'modules.Image.Load', -720, 280],
        ['transformersAnyToAnyGenerate', 'modules.HuggingFaceTransformers.GenerateAnyToAny', -240, -80],
        ['transformersTextPreview', 'modules.Primitive.DataViewer', 240, -80],
      ],
      edges: [
        ['transformersAnyToAnyModel', 'model', 'transformersAnyToAnyGenerate', 'model'],
        ['loadImage', 'image', 'transformersAnyToAnyGenerate', 'images'],
        ['transformersAnyToAnyGenerate', 'result', 'transformersTextPreview', 'value'],
      ],
      requiredMedia: [{ kind: 'image', field: 'referenceImages', minimumCount: 1 }],
      output: ['transformersTextPreview', 'modules.Primitive.DataViewer', 'value'],
    },
    {
      mode: 'text_to_image',
      outputKind: 'image',
      generationSource: 'anyToAnyImage',
      roles: [
        ['transformersAnyToAnyModel', 'modules.HuggingFaceTransformers.LoadAnyToAnyModel', -720, -80],
        ['transformersAnyToAnyGenerate', 'modules.HuggingFaceTransformers.GenerateAnyToAny', -240, -80],
        ['preview', 'modules.Image.Preview', 240, -80],
      ],
      edges: [
        ['transformersAnyToAnyModel', 'model', 'transformersAnyToAnyGenerate', 'model'],
        ['transformersAnyToAnyGenerate', 'image', 'preview', 'image'],
      ],
      requiredMedia: [],
      output: ['preview', 'modules.Image.Preview', 'image'],
    },
  ];
  const specs = cases.map((item) => {
    const bindings = [
      ['transformersAnyToAnyModel', 'model_id', 'artifact'],
      ['transformersAnyToAnyModel', 'revision', 'defaultRevision'],
      ['transformersAnyToAnyModel', 'dtype', 'dtype'],
      ['transformersAnyToAnyModel', 'device', 'device'],
      ...(item.mode === 'image_to_text'
        ? [
            ['loadImage', 'file', 'referenceImages'],
            ['loadImage', 'alpha_channel', 'alphaMode'],
          ]
        : []),
      ['transformersAnyToAnyGenerate', 'prompt', 'prompt'],
      ['transformersAnyToAnyGenerate', 'generation_mode', item.generationSource],
    ];
    const semantic = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `janus-pro-1b:${item.mode.replaceAll('_', '-')}:v1`,
      modelType,
      mode: item.mode,
      executionProfileId: profile.id,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      executionPath: profile.execution_path,
      pipelineClass: profile.pipeline_class,
      defaultRepo: profile.default_repo,
      roles: item.roles,
      edges: item.edges,
      bindings,
      autoFields: [],
      actions: [],
    };
    return {
      ...semantic,
      contentHash: `studio-spec-v1-${hashModule.hashString(hashModule.stableStringify(semantic))}`,
    };
  });
  assert.deepEqual(executionSpecsModule.parseStudioExecutionSpecs(specs, modelType, profile.modes, [profile]), specs);

  const capability = { modelType, executionProfiles: [profile], studioExecutionSpecs: specs };
  const contracts = cases.map((item, index) => {
    const spec = specs[index];
    const semantic = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `task-template:${spec.id}`,
      modelType,
      mode: item.mode,
      mediaKind: item.outputKind,
      executionProfileId: profile.id,
      executionSpecId: spec.id,
      executionSpecContentHash: spec.contentHash,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      loaderRole: 'transformersAnyToAnyModel',
      pipelineClass: profile.pipeline_class,
      defaultRepo: profile.default_repo,
      loaderRepositories: [profile.default_repo],
      requiredMedia: item.requiredMedia,
      output: {
        mediaKind: item.outputKind,
        role: item.output[0],
        nodeKey: item.output[1],
        inputHandle: item.output[2],
      },
      qualificationStatus: 'graph-qualified-execution-pending',
      galleryEligible: false,
    };
    return {
      ...semantic,
      contentHash: `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semantic))}`,
    };
  });
  const parsed = contractsModule.parseTaskTemplateContracts(contracts, 1, [capability]);
  assert.deepEqual(
    parsed.map(({ mode, mediaKind, requiredMedia }) => ({ mode, mediaKind, requiredMedia })),
    cases.map(({ mode, outputKind: mediaKind, requiredMedia }) => ({ mode, mediaKind, requiredMedia })),
  );
  assert.deepEqual(contractsModule.galleryTaskTemplateSkeletons(parsed), []);

  const staticProfile = modelProfilesModule.STUDIO_MODEL_PROFILES[modelType];
  assert.equal(staticProfile.catalogVisibility, 'workflowOnly');
  assert.equal(staticProfile.executionStatus, 'expert_only');
  assert.deepEqual(staticProfile.modeOutputKinds, {
    text_generation: 'json',
    image_to_text: 'json',
    text_to_image: 'image',
  });
  assert.equal(staticProfile.autoEligible, false);
  assert.equal(staticProfile.galleryEligible, false);
  assert.equal(staticProfile.license, 'DeepSeek Model License Agreement v1.0');
  assert.equal(modelProfilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS[modelType].autoStatus, 'manual_only');
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

test('the seven direct Qwen and video pairs preserve exact Expert task contracts', () => {
  const cases = [
    {
      modelType: 'QwenImageControlNetPipeline',
      mode: 'control_image',
      specId: 'qwen-image-controlnet-direct:control-image:v1',
      profileId: 'qwen-image-controlnet:direct',
      pipelineClass: 'QwenImageControlNetPipeline',
      repo: modelProfilesModule.QWEN_IMAGE_2512_REPO,
      kind: 'qwen-control',
      requiredMedia: [{ kind: 'image', field: 'controlImage', minimumCount: 1 }],
      backendHash: 'studio-spec-v1-40e18b12',
    },
    {
      modelType: 'QwenImageLayeredPipeline',
      mode: 'layer_decomposition',
      specId: 'qwen-image-layered-direct:layer-decomposition:v1',
      profileId: 'qwen-image-layered:direct',
      pipelineClass: 'QwenImageLayeredPipeline',
      repo: modelProfilesModule.QWEN_IMAGE_LAYERED_REPO,
      kind: 'qwen-layers',
      requiredMedia: [{ kind: 'image', field: 'referenceImages', minimumCount: 1 }],
      backendHash: 'studio-spec-v1-2d3b60ff',
    },
    {
      modelType: 'AnimateDiffPAGPipeline',
      mode: 'text_to_video',
      specId: 'animatediff-pag:text-to-video:v1',
      profileId: 'animatediff-sd15-v2-pag:direct',
      pipelineClass: 'AnimateDiffPAGPipeline',
      repo: modelProfilesModule.SD15_BASE_REPO,
      kind: 'video',
      requiredMedia: [],
      backendHash: 'studio-spec-v1-a3238501',
    },
    {
      modelType: 'AnimateDiffVideoToVideoPipeline',
      mode: 'video_to_video',
      specId: 'animatediff-video-to-video:video-to-video:v1',
      profileId: 'animatediff-sd15-v2-video-to-video:direct',
      pipelineClass: 'AnimateDiffVideoToVideoPipeline',
      repo: modelProfilesModule.SD15_BASE_REPO,
      kind: 'video-source',
      requiredMedia: [{ kind: 'video', field: 'sourceVideo', minimumCount: 1 }],
      backendHash: 'studio-spec-v1-b1ae3ddd',
    },
    {
      modelType: 'AnimateDiffControlNetPipeline',
      mode: 'control_to_video',
      specId: 'animatediff-controlnet:control-to-video:v1',
      profileId: 'animatediff-sd15-v2-controlnet:direct',
      pipelineClass: 'AnimateDiffControlNetPipeline',
      repo: modelProfilesModule.SD15_BASE_REPO,
      kind: 'video-control',
      requiredMedia: [{ kind: 'video', field: 'controlVideo', minimumCount: 1 }],
      backendHash: 'studio-spec-v1-cf67f340',
    },
    {
      modelType: 'AnimateDiffVideoToVideoControlNetPipeline',
      mode: 'control_video_to_video',
      specId: 'animatediff-controlnet-video-to-video:control-video-to-video:v1',
      profileId: 'animatediff-sd15-v2-controlnet-video-to-video:direct',
      pipelineClass: 'AnimateDiffVideoToVideoControlNetPipeline',
      repo: modelProfilesModule.SD15_BASE_REPO,
      kind: 'video-source-control',
      requiredMedia: [
        { kind: 'video', field: 'sourceVideo', minimumCount: 1 },
        { kind: 'video', field: 'controlVideo', minimumCount: 1 },
      ],
      backendHash: 'studio-spec-v1-4bec5f54',
    },
    {
      modelType: 'CogVideoXVideoToVideoPipeline',
      mode: 'video_to_video',
      specId: 'cogvideox-2b-video-to-video:video-to-video:v1',
      profileId: 'cogvideox-2b-video-to-video:direct',
      pipelineClass: 'CogVideoXVideoToVideoPipeline',
      repo: modelProfilesModule.COGVIDEOX_2B_REPO,
      kind: 'video-source',
      requiredMedia: [{ kind: 'video', field: 'sourceVideo', minimumCount: 1 }],
      backendHash: 'studio-spec-v1-de592d47',
    },
  ];
  const capabilities = [];
  const contracts = [];

  for (const item of cases) {
    const qwen = item.kind.startsWith('qwen');
    const layered = item.kind === 'qwen-layers';
    const sourceVideo = item.kind.includes('source');
    const controlVideo = item.kind.includes('control') && !qwen;
    const loaderRole = qwen ? 'diffusersImagePipeline' : 'wanPipeline';
    const actionRole = layered ? 'diffusersImageLayerDecompose' : qwen ? 'diffusersImageControl' : 'wanGenerate';
    const outputRole = qwen ? 'preview' : 'videoExport';
    const outputNode = qwen ? 'modules.Image.Preview' : 'modules.Video.Export';
    const outputHandle = qwen ? 'image' : 'video';
    const roles = qwen
      ? [
          [loaderRole, 'modules.DiffusersImage.LoadPipeline', -520, -80],
          ['loadImage', 'modules.Image.Load', -520, 300],
          [
            actionRole,
            layered ? 'modules.DiffusersImage.LayerDecompose' : 'modules.DiffusersImage.ControlGenerate',
            -120,
            -80,
          ],
          [outputRole, outputNode, 980, -80],
        ]
      : [
          [loaderRole, 'modules.DiffusersVideo.LoadPipeline', -520, -80],
          [actionRole, 'modules.DiffusersVideo.Generate', 220, -80],
          [outputRole, outputNode, 640, -80],
          ...(sourceVideo
            ? [
                ['loadVideo', 'modules.Video.Load', -520, 260],
                ['normalizeVideo', 'modules.VideoConditioning.Normalize', -160, 260],
              ]
            : []),
          ...(controlVideo
            ? [
                ['loadControlVideo', 'modules.Video.Load', -520, sourceVideo ? 520 : 260],
                ['normalizeControlVideo', 'modules.VideoConditioning.Normalize', -160, sourceVideo ? 520 : 260],
                ['controlPreprocessor', 'modules.VideoConditioning.EdgePreprocessor', 220, sourceVideo ? 520 : 260],
              ]
            : []),
        ];
    const edges = qwen
      ? [
          [loaderRole, 'pipeline', actionRole, 'pipeline'],
          ['loadImage', 'image', actionRole, layered ? 'image' : 'control_image'],
          [actionRole, 'images', outputRole, outputHandle],
        ]
      : [
          [loaderRole, 'pipeline', actionRole, 'pipeline'],
          [actionRole, 'video_out', outputRole, outputHandle],
          ...(sourceVideo
            ? [
                ['loadVideo', 'video', 'normalizeVideo', 'video'],
                ['normalizeVideo', 'output', actionRole, 'video'],
              ]
            : []),
          ...(controlVideo
            ? [
                ['loadControlVideo', 'video', 'normalizeControlVideo', 'video'],
                ['normalizeControlVideo', 'output', 'controlPreprocessor', 'video'],
                ['controlPreprocessor', 'output', actionRole, 'control_video'],
              ]
            : []),
        ];
    const bindings = [
      [loaderRole, 'model_id', 'artifact'],
      [loaderRole, 'revision', 'defaultRevision'],
      ...(qwen
        ? [
            ['loadImage', 'file', layered ? 'referenceImages' : 'controlImage'],
            ...(layered
              ? [
                  [actionRole, 'layers', 'layers'],
                  [actionRole, 'resolution', 'resolution'],
                  [actionRole, 'cfg_normalize', 'cfgNormalize'],
                  [actionRole, 'use_en_prompt', 'useEnglishPrompt'],
                ]
              : [
                  [loaderRole, 'conditioning_kind', 'kind'],
                  [loaderRole, 'conditioning_model_id', 'repo'],
                  [loaderRole, 'conditioning_revision', 'revision'],
                  [actionRole, 'control_guidance_start', 'controlGuidanceStart'],
                  [actionRole, 'control_guidance_end', 'controlGuidanceEnd'],
                ]),
          ]
        : [
            ...(item.modelType.startsWith('AnimateDiff')
              ? [
                  [loaderRole, 'motion_adapter_id', 'motionAdapterRepo'],
                  [loaderRole, 'motion_adapter_revision', 'motionAdapterRevision'],
                ]
              : []),
            ...(sourceVideo
              ? [
                  ['loadVideo', 'file', 'sourceVideo'],
                  ['normalizeVideo', 'num_frames', 'numFrames'],
                ]
              : []),
            ...(controlVideo
              ? [
                  ['loadControlVideo', 'file', 'controlVideo'],
                  ['normalizeControlVideo', 'num_frames', 'numFrames'],
                  ['controlPreprocessor', 'low_threshold', 'videoCannyLowThreshold100'],
                  ['controlPreprocessor', 'high_threshold', 'videoCannyHighThreshold200'],
                ]
              : []),
            ...(item.modelType === 'AnimateDiffPAGPipeline'
              ? [
                  [actionRole, 'pag_scale', 'pagScale'],
                  [actionRole, 'pag_adaptive_scale', 'pagAdaptiveScale'],
                ]
              : []),
          ]),
    ];
    const profile = {
      id: item.profileId,
      modes: [item.mode],
      loader_module: qwen ? 'modules.DiffusersImage' : 'modules.DiffusersVideo',
      loader_action: 'LoadPipeline',
      execution_path: qwen ? 'direct-diffusers-image' : 'direct-diffusers-video',
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
    assert.match(item.backendHash, /^studio-spec-v1-[0-9a-f]{8}$/);

    const staticProfile = modelProfilesModule.STUDIO_MODEL_PROFILES[item.modelType];
    assert.deepEqual(staticProfile.modes, [item.mode]);
    assert.equal(staticProfile.catalogVisibility, 'workflowOnly');
    assert.equal(staticProfile.executionStatus, 'expert_only');
    assert.equal(staticProfile.autoEligible, false);
    assert.equal(staticProfile.galleryEligible, false);
    assert.equal(staticProfile.liveProof, false);
    capabilities.push({
      modelType: item.modelType,
      studioExecutionSpecs: [spec],
      executionProfiles: [profile],
    });

    const mediaKind = qwen ? 'image' : 'video';
    const semanticContract = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `task-template:${item.specId}`,
      modelType: item.modelType,
      mode: item.mode,
      mediaKind,
      executionProfileId: item.profileId,
      executionSpecId: item.specId,
      executionSpecContentHash: spec.contentHash,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      loaderRole,
      pipelineClass: item.pipelineClass,
      defaultRepo: item.repo,
      loaderRepositories: [item.repo],
      requiredMedia: item.requiredMedia,
      output: { mediaKind, role: outputRole, nodeKey: outputNode, inputHandle: outputHandle },
      qualificationStatus: 'graph-qualified-execution-pending',
      galleryEligible: false,
    };
    contracts.push({
      ...semanticContract,
      contentHash: `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semanticContract))}`,
    });
  }

  const parsed = contractsModule.parseTaskTemplateContracts(contracts, 1, capabilities);
  assert.equal(parsed.length, 7);
  assert.deepEqual(
    parsed.map(({ id, requiredMedia, galleryEligible }) => [
      id,
      requiredMedia.map(({ field }) => field),
      galleryEligible,
    ]),
    cases.map(({ specId, requiredMedia }) => [
      `task-template:${specId}`,
      requiredMedia.map(({ field }) => field),
      false,
    ]),
  );
});

test('the final 13 direct image and synchronized LTX2 pairs preserve sealed contracts', () => {
  const autoFields = [
    'resolvedArtifact',
    'artifact',
    'installTarget.repo',
    'modelRepo',
    'pipelineClass',
    'dtype',
    'offloadMode',
    'quantizedComponents',
    'attentionBackend',
    'regionalCompile',
    'denoiserCache',
    'layerwiseCasting',
    'channelsLast',
  ];
  const runtimeRoles = [
    ['diffusersQuantization', 'modules.DiffusersRuntime.PipelineQuantizationConfigV2', -1280, -80],
    ['diffusersRecipe', 'modules.DiffusersRuntime.DiffusersExecutionRecipe', -900, -80],
  ];
  const runtimeEdges = [['diffusersQuantization', 'quantization_config', 'diffusersRecipe', 'quantization_config']];
  const runtimeBindings = (video = false) => [
    ['diffusersQuantization', 'backend', 'quantizationMode'],
    ['diffusersQuantization', 'components', 'quantizedComponents'],
    ['diffusersQuantization', 'dtype', 'dtype'],
    ['diffusersRecipe', 'device_map', 'deviceMapNone'],
    ['diffusersRecipe', 'offload_mode', 'offloadMode'],
    ['diffusersRecipe', 'device', 'device'],
    ['diffusersRecipe', 'attention_backend', video ? 'nativeMath' : 'attentionBackend'],
    ['diffusersRecipe', 'attention_components', 'empty'],
    ['diffusersRecipe', 'vae_slicing', 'true'],
    ['diffusersRecipe', 'vae_tiling', video ? 'videoVaeTiling' : 'true'],
    ['diffusersRecipe', 'regional_compile', 'regionalCompile'],
    ['diffusersRecipe', 'denoiser_cache', 'denoiserCache'],
    ['diffusersRecipe', 'layerwise_casting', 'layerwiseCasting'],
    ['diffusersRecipe', 'channels_last', 'channelsLast'],
  ];
  const cases = [
    {
      modelType: 'QwenImageEditPipeline',
      mode: 'edit_image',
      specId: 'qwen-image-edit-direct:edit-image:v1',
      profileId: 'qwen-image-edit:direct',
      repo: 'Qwen/Qwen-Image-Edit',
      route: 'edit',
      specHash: 'studio-spec-v1-e2d95865',
      taskHash: 'task-template-v1-3d386eac',
    },
    {
      modelType: 'QwenImageEditPlusPipeline',
      mode: 'edit_image',
      specId: 'qwen-image-edit-plus-direct:edit-image:v1',
      profileId: 'qwen-image-edit-plus:direct',
      repo: 'Qwen/Qwen-Image-Edit-2511',
      route: 'edit',
      specHash: 'studio-spec-v1-44dd285f',
      taskHash: 'task-template-v1-7da630a4',
    },
    {
      modelType: 'QwenImageEditPlusPipeline',
      mode: 'multi_image_reference_edit',
      specId: 'qwen-image-edit-plus-direct:multi-image-reference-edit:v1',
      profileId: 'qwen-image-edit-plus:direct',
      repo: 'Qwen/Qwen-Image-Edit-2511',
      route: 'edit',
      specHash: 'studio-spec-v1-40dfc18f',
      taskHash: 'task-template-v1-68ba150d',
    },
    {
      modelType: 'ZImageInpaintPipeline',
      mode: 'inpaint',
      specId: 'z-image-inpaint-direct:inpaint:v1',
      profileId: 'z-image-inpaint:direct',
      repo: 'Tongyi-MAI/Z-Image-Turbo',
      route: 'inpaint',
      specHash: 'studio-spec-v1-fe4170f8',
      taskHash: 'task-template-v1-e5d4e75c',
    },
    {
      modelType: 'ZImageInpaintPipeline',
      mode: 'outpaint',
      specId: 'z-image-inpaint-direct:outpaint:v1',
      profileId: 'z-image-inpaint:direct',
      repo: 'Tongyi-MAI/Z-Image-Turbo',
      route: 'outpaint',
      specHash: 'studio-spec-v1-bae7a397',
      taskHash: 'task-template-v1-b45595b5',
    },
    {
      modelType: 'FluxKontextInpaintPipeline',
      mode: 'inpaint',
      specId: 'flux-kontext-inpaint-direct:inpaint:v1',
      profileId: 'flux-kontext-inpaint:direct',
      repo: 'black-forest-labs/FLUX.1-Kontext-dev',
      fallbackRepo: 'black-forest-labs/FLUX.1-Kontext-dev-NVFP4',
      route: 'inpaint',
      specHash: 'studio-spec-v1-934bf941',
      taskHash: 'task-template-v1-24349148',
    },
    {
      modelType: 'FluxKontextInpaintPipeline',
      mode: 'outpaint',
      specId: 'flux-kontext-inpaint-direct:outpaint:v1',
      profileId: 'flux-kontext-inpaint:direct',
      repo: 'black-forest-labs/FLUX.1-Kontext-dev',
      fallbackRepo: 'black-forest-labs/FLUX.1-Kontext-dev-NVFP4',
      route: 'outpaint',
      specHash: 'studio-spec-v1-c334b4d4',
      taskHash: 'task-template-v1-d0839fa4',
    },
    {
      modelType: 'Flux2KleinInpaintPipeline',
      mode: 'inpaint',
      specId: 'flux2-klein-inpaint-direct:inpaint:v1',
      profileId: 'flux2-klein-inpaint:direct',
      repo: 'black-forest-labs/FLUX.2-klein-4B',
      route: 'inpaint',
      negativePrompt: false,
      specHash: 'studio-spec-v1-1cdb8201',
      taskHash: 'task-template-v1-f1beda5b',
    },
    {
      modelType: 'Flux2KleinInpaintPipeline',
      mode: 'outpaint',
      specId: 'flux2-klein-inpaint-direct:outpaint:v1',
      profileId: 'flux2-klein-inpaint:direct',
      repo: 'black-forest-labs/FLUX.2-klein-4B',
      route: 'outpaint',
      negativePrompt: false,
      specHash: 'studio-spec-v1-1ec36902',
      taskHash: 'task-template-v1-1bac8598',
    },
    {
      modelType: 'ChromaImg2ImgPipeline',
      mode: 'edit_image',
      specId: 'chroma1-hd-img2img:edit-image:v1',
      profileId: 'chroma1-hd-img2img:direct',
      repo: 'lodestones/Chroma1-HD',
      route: 'edit',
      strength: true,
      specHash: 'studio-spec-v1-93d6037a',
      taskHash: 'task-template-v1-b893fd70',
    },
    {
      modelType: 'ChromaInpaintPipeline',
      mode: 'inpaint',
      specId: 'chroma1-hd-inpaint:inpaint:v1',
      profileId: 'chroma1-hd-inpaint:direct',
      repo: 'lodestones/Chroma1-HD',
      route: 'inpaint',
      specHash: 'studio-spec-v1-a2b13067',
      taskHash: 'task-template-v1-47e4e6d9',
    },
    {
      modelType: 'ChromaInpaintPipeline',
      mode: 'outpaint',
      specId: 'chroma1-hd-inpaint:outpaint:v1',
      profileId: 'chroma1-hd-inpaint:direct',
      repo: 'lodestones/Chroma1-HD',
      route: 'outpaint',
      specHash: 'studio-spec-v1-048def62',
      taskHash: 'task-template-v1-e06d3841',
    },
    {
      modelType: 'LTX2Pipeline',
      mode: 'text_to_video',
      specId: 'ltx2-standard:text-to-video:v1',
      profileId: 'ltx2-standard:direct',
      repo: 'Lightricks/LTX-2',
      route: 'video-audio',
      specHash: 'studio-spec-v1-b3b8990c',
      taskHash: 'task-template-v1-5527e480',
    },
  ];
  const imagePipelineBindings = [
    ['diffusersImagePipeline', 'model_id', 'artifact'],
    ['diffusersImagePipeline', 'pipeline_class', 'pipelineClass'],
    ['diffusersImagePipeline', 'mode', 'mode'],
    ['diffusersImagePipeline', 'dtype', 'dtype'],
    ['diffusersImagePipeline', 'device', 'device'],
    ['diffusersImagePipeline', 'quantization_mode', 'quantizationMode'],
    ['diffusersImagePipeline', 'quantized_components', 'pipelineQuantizedComponents'],
    ['diffusersImagePipeline', 'auto_offload', 'autoOffload'],
    ['diffusersImagePipeline', 'offload_mode', 'offloadMode'],
  ];
  const actionBindings = (role, item) => [
    [role, 'prompt', 'prompt'],
    ...(item.negativePrompt === false ? [] : [[role, 'negative_prompt', 'negativePrompt']]),
    [role, 'width', 'width'],
    [role, 'height', 'height'],
    [role, 'seed', 'seed'],
    [role, 'num_inference_steps', 'steps'],
    [role, 'guidance_scale', 'guidanceScale'],
    ...(item.route !== 'edit' || item.strength ? [[role, 'strength', 'strength']] : []),
    [role, 'output_type', 'outputType'],
    [role, 'max_sequence_length', 'maxSequenceLength'],
  ];
  const outpaintBindings = [
    ['outpaintCanvas', 'width', 'width'],
    ['outpaintCanvas', 'height', 'height'],
    ['outpaintCanvas', 'left', 'outpaintLeft'],
    ['outpaintCanvas', 'right', 'outpaintRight'],
    ['outpaintCanvas', 'top', 'outpaintTop'],
    ['outpaintCanvas', 'bottom', 'outpaintBottom'],
    ['outpaintCanvas', 'overlap', 'outpaintOverlap'],
    ['outpaintCanvas', 'feather', 'outpaintFeather'],
    ['outpaintCanvas', 'fill_color', 'outpaintFillColor'],
  ];
  const imageShape = (item) => {
    const edit = item.route === 'edit';
    const outpaint = item.route === 'outpaint';
    const actionRole = edit ? 'diffusersImageEdit' : 'diffusersImageInpaint';
    const roles = [
      ...runtimeRoles,
      ['diffusersImagePipeline', 'modules.DiffusersImage.LoadPipeline', -520, -80],
      ['loadImage', 'modules.Image.Load', -520, 300],
      ...(item.route === 'inpaint' ? [['loadMask', 'modules.Image.Load', -520, 560]] : []),
      ...(outpaint ? [['outpaintCanvas', 'modules.DiffusersImage.OutpaintCanvas', -520, 300]] : []),
      [actionRole, edit ? 'modules.DiffusersImage.Edit' : 'modules.DiffusersImage.Inpaint', -120, -80],
      ['preview', 'modules.Image.Preview', 980, -80],
    ];
    const edges = [
      ...runtimeEdges,
      ['diffusersRecipe', 'execution_recipe', 'diffusersImagePipeline', 'execution_recipe'],
      ['diffusersImagePipeline', 'pipeline', actionRole, 'pipeline'],
      ['loadImage', 'image', outpaint ? 'outpaintCanvas' : actionRole, 'image'],
      ...(item.route === 'inpaint' ? [['loadMask', 'image', actionRole, 'mask_image']] : []),
      ...(outpaint
        ? [
            ['outpaintCanvas', 'canvas', actionRole, 'image'],
            ['outpaintCanvas', 'mask_image', actionRole, 'mask_image'],
          ]
        : []),
      [actionRole, 'images', 'preview', 'image'],
    ];
    const bindings = [
      ...runtimeBindings(),
      ...imagePipelineBindings,
      ['loadImage', 'file', 'referenceImages'],
      ['loadImage', 'alpha_channel', 'alphaMode'],
      ...(item.route === 'inpaint'
        ? [
            ['loadMask', 'file', 'maskImage'],
            ['loadMask', 'alpha_channel', 'removeAlpha'],
          ]
        : []),
      ...actionBindings(actionRole, item),
      ...(outpaint ? outpaintBindings : []),
      ['diffusersImagePipeline', 'revision', 'defaultRevision'],
    ];
    return { roles, edges, bindings, loaderRole: 'diffusersImagePipeline', actionRole };
  };
  const ltx2Shape = {
    roles: [
      ...runtimeRoles,
      ['wanPipeline', 'modules.DiffusersVideo.LoadPipeline', -520, -80],
      ['wanGenerate', 'modules.DiffusersVideo.GenerateVideoAudio', 220, -80],
      ['videoExport', 'modules.Video.ExportWithAudio', 640, -80],
    ],
    edges: [
      ...runtimeEdges,
      ['diffusersRecipe', 'execution_recipe', 'wanPipeline', 'execution_recipe'],
      ['wanPipeline', 'pipeline', 'wanGenerate', 'pipeline'],
      ['wanGenerate', 'video_out', 'videoExport', 'video'],
      ['wanGenerate', 'audio', 'videoExport', 'audio'],
    ],
    bindings: [
      ...runtimeBindings(true),
      ['wanPipeline', 'model_id', 'artifact'],
      ['wanPipeline', 'pipeline_class', 'pipelineClass'],
      ['wanPipeline', 'revision', 'defaultRevision'],
      ['wanPipeline', 'dtype', 'dtype'],
      ['wanPipeline', 'device', 'device'],
      ['wanPipeline', 'auto_offload', 'autoOffload'],
      ['wanPipeline', 'offload_mode', 'offloadMode'],
      ['wanGenerate', 'prompt', 'prompt'],
      ['wanGenerate', 'mode', 'mode'],
      ['wanGenerate', 'negative_prompt', 'negativePrompt'],
      ['wanGenerate', 'width', 'width'],
      ['wanGenerate', 'height', 'height'],
      ['wanGenerate', 'seed', 'seed'],
      ['wanGenerate', 'num_frames', 'numFrames'],
      ['wanGenerate', 'num_inference_steps', 'steps'],
      ['wanGenerate', 'guidance_scale', 'guidanceScale'],
      ['wanGenerate', 'conditioning_scale', 'conditioningScale'],
      ['wanGenerate', 'strength', 'strength'],
      ['wanGenerate', 'denoise_strength', 'strength'],
      ['wanGenerate', 'frame_rate', 'fps'],
      ['wanGenerate', 'guidance_scale_2', 'guidanceScale2'],
      ['wanGenerate', 'use_guidance_scale_2', 'useGuidanceScale2'],
      ['wanGenerate', 'output_type', 'outputType'],
      ['wanGenerate', 'max_sequence_length', 'maxSequenceLength'],
      ['wanGenerate', 'attention_kwargs_json', 'attentionKwargsJson'],
      ['videoExport', 'fps', 'fps'],
    ],
    loaderRole: 'wanPipeline',
  };
  const grouped = new Map();
  const contracts = [];
  for (const item of cases) {
    const video = item.route === 'video-audio';
    const shape = video ? ltx2Shape : imageShape(item);
    const profile = {
      id: item.profileId,
      modes: cases.filter(({ profileId }) => profileId === item.profileId).map(({ mode }) => mode),
      loader_module: video ? 'modules.DiffusersVideo' : 'modules.DiffusersImage',
      loader_action: 'LoadPipeline',
      execution_path: video ? 'direct-diffusers-video' : 'direct-diffusers-image',
      pipeline_class: item.modelType,
      default_repo: item.repo,
      ...(item.fallbackRepo ? { fallback_repo: item.fallbackRepo } : {}),
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
      pipelineClass: item.modelType,
      defaultRepo: item.repo,
      roles: shape.roles,
      edges: shape.edges,
      bindings: shape.bindings,
      autoFields,
      actions: [],
    };
    const spec = {
      ...semanticSpec,
      contentHash: `studio-spec-v1-${hashModule.hashString(hashModule.stableStringify(semanticSpec))}`,
    };
    assert.equal(spec.contentHash, item.specHash, `${item.specId} drifted from the sealed backend hash`);
    assert.deepEqual(executionSpecsModule.parseStudioExecutionSpecs([spec], item.modelType, profile.modes, [profile]), [
      spec,
    ]);

    const existing = grouped.get(item.modelType) ?? {
      modelType: item.modelType,
      studioExecutionSpecs: [],
      executionProfiles: [profile],
    };
    existing.studioExecutionSpecs.push(spec);
    grouped.set(item.modelType, existing);
    const requiredMedia = video
      ? []
      : item.route === 'inpaint'
        ? [
            { kind: 'image', field: 'referenceImages', minimumCount: 1 },
            { kind: 'image', field: 'maskImage', minimumCount: 1 },
          ]
        : [{ kind: 'image', field: 'referenceImages', minimumCount: 1 }];
    const mediaKind = video ? 'video' : 'image';
    const outputRole = video ? 'videoExport' : 'preview';
    const outputNode = video ? 'modules.Video.ExportWithAudio' : 'modules.Image.Preview';
    const semanticContract = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `task-template:${item.specId}`,
      modelType: item.modelType,
      mode: item.mode,
      mediaKind,
      executionProfileId: item.profileId,
      executionSpecId: item.specId,
      executionSpecContentHash: item.specHash,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      loaderRole: shape.loaderRole,
      pipelineClass: item.modelType,
      defaultRepo: item.repo,
      loaderRepositories: [item.repo, ...(item.fallbackRepo ? [item.fallbackRepo] : [])],
      requiredMedia,
      output: { mediaKind, role: outputRole, nodeKey: outputNode, inputHandle: mediaKind },
      qualificationStatus: 'graph-qualified-execution-pending',
      galleryEligible: false,
    };
    const contract = {
      ...semanticContract,
      contentHash: `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semanticContract))}`,
    };
    assert.equal(contract.contentHash, item.taskHash, `${item.specId} task contract drifted from the sealed backend`);
    contracts.push(contract);
  }
  const parsed = contractsModule.parseTaskTemplateContracts(contracts, 1, [...grouped.values()]);
  assert.equal(parsed.length, 13);
  assert.equal(
    parsed.find(({ modelType }) => modelType === 'LTX2Pipeline').output.nodeKey,
    'modules.Video.ExportWithAudio',
  );
  assert.ok(
    parsed.every(
      ({ galleryEligible, qualificationStatus }) => !galleryEligible && qualificationStatus.endsWith('pending'),
    ),
  );
});

test('built-in image operations preserve exact install-free task contracts', () => {
  const modes = modelProfilesModule.BUILTIN_IMAGE_OPERATION_MODES;
  const repo = modelProfilesModule.BUILTIN_IMAGE_OPERATION_REPO;
  const profile = {
    id: 'builtin-image-operations:direct',
    model_type: 'BuiltinImageOperation',
    modes,
    loader_module: 'modules.ImageOperations',
    loader_action: 'ProcessImage',
    execution_path: 'builtin-image-operation',
    pipeline_class: 'BuiltinImageOperationV1',
    default_repo: repo,
    fallback_repo: null,
    compatible_repos: [],
  };
  const roles = [
    ['loadImage', 'modules.Image.Load', -620, -80],
    ['imageOperation', 'modules.ImageOperations.ProcessImage', -160, -80],
    ['preview', 'modules.Image.Preview', 300, -80],
  ];
  const edges = [
    ['loadImage', 'image', 'imageOperation', 'image'],
    ['imageOperation', 'output', 'preview', 'image'],
  ];
  const bindings = [
    ['loadImage', 'file', 'referenceImages'],
    ['loadImage', 'alpha_channel', 'alphaMode'],
    ['imageOperation', 'pipeline_class', 'pipelineClass'],
    ['imageOperation', 'operation', 'mode'],
  ];
  const autoFields = [
    'resolvedArtifact',
    'artifact',
    'installTarget.repo',
    'modelRepo',
    'pipelineClass',
    'dtype',
    'offloadMode',
    'quantizedComponents',
    'attentionBackend',
    'regionalCompile',
    'denoiserCache',
    'layerwiseCasting',
    'channelsLast',
  ];
  const expectedHashes = {
    image_adjustment: ['studio-spec-v1-0b33529b', 'task-template-v1-192dc695'],
    image_filter: ['studio-spec-v1-79b9fe9f', 'task-template-v1-70f8b61b'],
    image_crop: ['studio-spec-v1-2ab6b5fb', 'task-template-v1-80ab83f0'],
    image_upscale: ['studio-spec-v1-769830b5', 'task-template-v1-539bf425'],
    image_tile: ['studio-spec-v1-54fee057', 'task-template-v1-202bc67b'],
    image_channels: ['studio-spec-v1-c76ee6b7', 'task-template-v1-69640a3d'],
    mask_composite: ['studio-spec-v1-e6a11a52', 'task-template-v1-7b319535'],
  };
  const specs = [];
  const contracts = [];
  for (const mode of modes) {
    const modeRoles =
      mode === 'mask_composite'
        ? [
            ['loadImage', 'modules.Image.Load', -720, -180],
            ['loadMask', 'modules.Image.Load', -720, 240],
            ['imageOperation', 'modules.ImageOperations.ProcessImage', -160, -80],
            ['preview', 'modules.Image.Preview', 400, -80],
          ]
        : roles;
    const modeEdges =
      mode === 'mask_composite'
        ? [
            ['loadImage', 'image', 'imageOperation', 'image'],
            ['loadMask', 'image', 'imageOperation', 'mask'],
            ['imageOperation', 'output', 'preview', 'image'],
          ]
        : edges;
    const modeBindings =
      mode === 'mask_composite'
        ? [...bindings, ['loadMask', 'file', 'maskImage'], ['loadMask', 'alpha_channel', 'removeAlpha']]
        : bindings;
    const semanticSpec = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `builtin-image-operations:${mode.replaceAll('_', '-')}:v1`,
      modelType: 'BuiltinImageOperation',
      mode,
      executionProfileId: profile.id,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      executionPath: profile.execution_path,
      pipelineClass: profile.pipeline_class,
      defaultRepo: repo,
      roles: modeRoles,
      edges: modeEdges,
      bindings: modeBindings,
      autoFields,
      actions: [],
    };
    const spec = {
      ...semanticSpec,
      contentHash: `studio-spec-v1-${hashModule.hashString(hashModule.stableStringify(semanticSpec))}`,
    };
    assert.equal(spec.contentHash, expectedHashes[mode][0]);
    specs.push(spec);
    const semanticContract = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `task-template:${spec.id}`,
      modelType: 'BuiltinImageOperation',
      mode,
      mediaKind: 'image',
      executionProfileId: profile.id,
      executionSpecId: spec.id,
      executionSpecContentHash: spec.contentHash,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      loaderRole: 'imageOperation',
      pipelineClass: profile.pipeline_class,
      defaultRepo: repo,
      loaderRepositories: [repo],
      requiredMedia:
        mode === 'mask_composite'
          ? [
              { kind: 'image', field: 'referenceImages', minimumCount: 2 },
              { kind: 'image', field: 'maskImage', minimumCount: 1 },
            ]
          : [{ kind: 'image', field: 'referenceImages', minimumCount: 1 }],
      output: {
        mediaKind: 'image',
        role: 'preview',
        nodeKey: 'modules.Image.Preview',
        inputHandle: 'image',
      },
      qualificationStatus: 'graph-qualified-execution-pending',
      galleryEligible: false,
    };
    const contract = {
      ...semanticContract,
      contentHash: `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semanticContract))}`,
    };
    assert.equal(contract.contentHash, expectedHashes[mode][1]);
    contracts.push(contract);
  }

  const parsedSpecs = executionSpecsModule.parseStudioExecutionSpecs(specs, 'BuiltinImageOperation', modes, [profile]);
  const capability = {
    modelType: 'BuiltinImageOperation',
    studioExecutionSpecs: parsedSpecs,
    executionProfiles: [profile],
  };
  assert.equal(contractsModule.parseTaskTemplateContracts(contracts, 1, [capability]).length, 7);
  assert.equal(modelProfilesModule.STUDIO_MODEL_PROFILES.BuiltinImageOperation.artifactInstallRequired, false);
  assert.deepEqual(modelProfilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.BuiltinImageOperation.artifacts, []);
});

test('built-in audio operations preserve exact install-free source and reference contracts', () => {
  const modes = modelProfilesModule.BUILTIN_AUDIO_OPERATION_MODES;
  const repo = modelProfilesModule.BUILTIN_AUDIO_OPERATION_REPO;
  const profile = {
    id: 'builtin-audio-operations:direct',
    model_type: 'BuiltinAudioOperation',
    modes,
    loader_module: 'modules.Audio',
    loader_action: 'ProcessAudio',
    execution_path: 'builtin-audio-operation',
    pipeline_class: 'BuiltinAudioOperationV1',
    default_repo: repo,
    fallback_repo: null,
    compatible_repos: [],
  };
  const autoFields = [
    'resolvedArtifact',
    'artifact',
    'installTarget.repo',
    'modelRepo',
    'pipelineClass',
    'dtype',
    'offloadMode',
    'quantizedComponents',
    'attentionBackend',
    'regionalCompile',
    'denoiserCache',
    'layerwiseCasting',
    'channelsLast',
  ];
  const cases = [
    {
      mode: 'audio_trim',
      id: 'builtin-audio-operations:trim:v1',
      specHash: 'studio-spec-v1-12b8e293',
      taskHash: 'task-template-v1-b514b0d6',
      requiredMedia: [{ kind: 'audio', field: 'sourceAudio', minimumCount: 1 }],
    },
    {
      mode: 'audio_join',
      id: 'builtin-audio-operations:join:v1',
      specHash: 'studio-spec-v1-03d9427a',
      taskHash: 'task-template-v1-d59c3071',
      requiredMedia: [
        { kind: 'audio', field: 'sourceAudio', minimumCount: 1 },
        { kind: 'audio', field: 'referenceAudio', minimumCount: 1 },
      ],
    },
    {
      mode: 'audio_loudness_match',
      id: 'builtin-audio-operations:loudness-match:v1',
      specHash: 'studio-spec-v1-a3373c8c',
      taskHash: 'task-template-v1-4baf5cf9',
      requiredMedia: [
        { kind: 'audio', field: 'sourceAudio', minimumCount: 1 },
        { kind: 'audio', field: 'referenceAudio', minimumCount: 1 },
      ],
    },
  ];
  const baseRoles = [
    ['loadAudio', 'modules.Audio.Load', -620, -80],
    ['audioOperation', 'modules.Audio.ProcessAudio', -220, -80],
    ['audioExport', 'modules.Audio.Export', 260, -80],
  ];
  const baseEdges = [
    ['loadAudio', 'audio', 'audioOperation', 'source'],
    ['audioOperation', 'output', 'audioExport', 'audio'],
  ];
  const baseBindings = [
    ['audioOperation', 'pipeline_class', 'pipelineClass'],
    ['audioOperation', 'operation', 'mode'],
    ['loadAudio', 'file', 'sourceAudio'],
    ['audioExport', 'sample_rate', 'sampleRate48000'],
  ];
  const specs = cases.map((item) => {
    const dualSource = item.mode !== 'audio_trim';
    const semantic = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: item.id,
      modelType: 'BuiltinAudioOperation',
      mode: item.mode,
      executionProfileId: profile.id,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      executionPath: profile.execution_path,
      pipelineClass: profile.pipeline_class,
      defaultRepo: repo,
      roles: dualSource ? [...baseRoles, ['loadReferenceAudio', 'modules.Audio.Load', -620, 160]] : baseRoles,
      edges: dualSource ? [...baseEdges, ['loadReferenceAudio', 'audio', 'audioOperation', 'reference']] : baseEdges,
      bindings: dualSource ? [...baseBindings, ['loadReferenceAudio', 'file', 'referenceAudio']] : baseBindings,
      autoFields,
      actions: [],
    };
    const spec = {
      ...semantic,
      contentHash: `studio-spec-v1-${hashModule.hashString(hashModule.stableStringify(semantic))}`,
    };
    assert.equal(spec.contentHash, item.specHash);
    return spec;
  });
  const parsedSpecs = executionSpecsModule.parseStudioExecutionSpecs(specs, 'BuiltinAudioOperation', modes, [profile]);
  const contracts = cases.map((item, index) => {
    const semantic = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `task-template:${item.id}`,
      modelType: 'BuiltinAudioOperation',
      mode: item.mode,
      mediaKind: 'audio',
      executionProfileId: profile.id,
      executionSpecId: item.id,
      executionSpecContentHash: specs[index].contentHash,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      loaderRole: 'audioOperation',
      pipelineClass: profile.pipeline_class,
      defaultRepo: repo,
      loaderRepositories: [repo],
      requiredMedia: item.requiredMedia,
      output: {
        mediaKind: 'audio',
        role: 'audioExport',
        nodeKey: 'modules.Audio.Export',
        inputHandle: 'audio',
      },
      qualificationStatus: 'graph-qualified-execution-pending',
      galleryEligible: false,
    };
    const contract = {
      ...semantic,
      contentHash: `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semantic))}`,
    };
    assert.equal(contract.contentHash, item.taskHash);
    return contract;
  });
  const capability = {
    modelType: 'BuiltinAudioOperation',
    studioExecutionSpecs: parsedSpecs,
    executionProfiles: [profile],
  };
  assert.equal(contractsModule.parseTaskTemplateContracts(contracts, 1, [capability]).length, 3);
  assert.equal(modelProfilesModule.STUDIO_MODEL_PROFILES.BuiltinAudioOperation.artifactInstallRequired, false);
  assert.deepEqual(modelProfilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.BuiltinAudioOperation.artifacts, []);
});

test('built-in video operations preserve exact install-free multi-media contracts', () => {
  const modes = modelProfilesModule.BUILTIN_VIDEO_OPERATION_MODES;
  const repo = modelProfilesModule.BUILTIN_VIDEO_OPERATION_REPO;
  const profile = {
    id: 'builtin-video-operations:direct',
    model_type: 'BuiltinVideoOperation',
    modes,
    loader_module: 'modules.Video',
    loader_action: 'ProcessVideo',
    execution_path: 'builtin-video-operation',
    pipeline_class: 'BuiltinVideoOperationV1',
    default_repo: repo,
    fallback_repo: null,
    compatible_repos: [],
  };
  const autoFields = [
    'resolvedArtifact',
    'artifact',
    'installTarget.repo',
    'modelRepo',
    'pipelineClass',
    'dtype',
    'offloadMode',
    'quantizedComponents',
    'attentionBackend',
    'regionalCompile',
    'denoiserCache',
    'layerwiseCasting',
    'channelsLast',
  ];
  const cases = [
    {
      mode: 'video_frame_extract',
      id: 'builtin-video-operations:frame-extract:v1',
      specHash: 'studio-spec-v1-aba82fc2',
      taskHash: 'task-template-v1-42558889',
      roles: [
        ['videoOperation', 'modules.Video.ProcessVideo', -220, -80],
        ['preview', 'modules.Image.Preview', 260, -80],
      ],
      edges: [['videoOperation', 'images', 'preview', 'image']],
      bindings: [
        ['videoOperation', 'pipeline_class', 'pipelineClass'],
        ['videoOperation', 'operation', 'mode'],
        ['videoOperation', 'videos', 'sourceVideo'],
      ],
      mediaKind: 'image',
      requiredMedia: [{ kind: 'video', field: 'sourceVideo', minimumCount: 1 }],
      output: { mediaKind: 'image', role: 'preview', nodeKey: 'modules.Image.Preview', inputHandle: 'image' },
    },
    {
      mode: 'video_stitch',
      id: 'builtin-video-operations:stitch:v1',
      specHash: 'studio-spec-v1-bd7dbb61',
      taskHash: 'task-template-v1-b7962657',
      roles: [
        ['videoOperation', 'modules.Video.ProcessVideo', -220, -80],
        ['videoExport', 'modules.Video.Export', 260, -80],
      ],
      edges: [['videoOperation', 'video', 'videoExport', 'video']],
      bindings: [
        ['videoOperation', 'pipeline_class', 'pipelineClass'],
        ['videoOperation', 'operation', 'mode'],
        ['videoOperation', 'videos', 'referenceVideos'],
        ['videoExport', 'fps', 'fps'],
      ],
      mediaKind: 'video',
      requiredMedia: [{ kind: 'video', field: 'referenceVideos', minimumCount: 2 }],
      output: { mediaKind: 'video', role: 'videoExport', nodeKey: 'modules.Video.Export', inputHandle: 'video' },
    },
    {
      mode: 'video_trim',
      id: 'builtin-video-operations:trim:v1',
      specHash: 'studio-spec-v1-8ae51a00',
      taskHash: 'task-template-v1-0eef5c73',
      roles: [
        ['videoOperation', 'modules.Video.ProcessVideo', -220, -80],
        ['videoExport', 'modules.Video.Export', 260, -80],
      ],
      edges: [['videoOperation', 'video', 'videoExport', 'video']],
      bindings: [
        ['videoOperation', 'pipeline_class', 'pipelineClass'],
        ['videoOperation', 'operation', 'mode'],
        ['videoOperation', 'videos', 'sourceVideo'],
        ['videoExport', 'fps', 'fps'],
      ],
      mediaKind: 'video',
      requiredMedia: [{ kind: 'video', field: 'sourceVideo', minimumCount: 1 }],
      output: { mediaKind: 'video', role: 'videoExport', nodeKey: 'modules.Video.Export', inputHandle: 'video' },
    },
    {
      mode: 'video_reverse',
      id: 'builtin-video-operations:reverse:v1',
      specHash: 'studio-spec-v1-cbdd8724',
      taskHash: 'task-template-v1-46a24f4c',
      roles: [
        ['videoOperation', 'modules.Video.ProcessVideo', -220, -80],
        ['videoExport', 'modules.Video.Export', 260, -80],
      ],
      edges: [['videoOperation', 'video', 'videoExport', 'video']],
      bindings: [
        ['videoOperation', 'pipeline_class', 'pipelineClass'],
        ['videoOperation', 'operation', 'mode'],
        ['videoOperation', 'videos', 'sourceVideo'],
        ['videoExport', 'fps', 'fps'],
      ],
      mediaKind: 'video',
      requiredMedia: [{ kind: 'video', field: 'sourceVideo', minimumCount: 1 }],
      output: { mediaKind: 'video', role: 'videoExport', nodeKey: 'modules.Video.Export', inputHandle: 'video' },
    },
    {
      mode: 'video_tile',
      id: 'builtin-video-operations:tile:v1',
      specHash: 'studio-spec-v1-60a5fab5',
      taskHash: 'task-template-v1-163731b8',
      roles: [
        ['videoOperation', 'modules.Video.ProcessVideo', -220, -80],
        ['videoExport', 'modules.Video.Export', 260, -80],
      ],
      edges: [['videoOperation', 'video', 'videoExport', 'video']],
      bindings: [
        ['videoOperation', 'pipeline_class', 'pipelineClass'],
        ['videoOperation', 'operation', 'mode'],
        ['videoOperation', 'videos', 'referenceVideos'],
        ['videoExport', 'fps', 'fps'],
      ],
      mediaKind: 'video',
      requiredMedia: [{ kind: 'video', field: 'referenceVideos', minimumCount: 2 }],
      output: { mediaKind: 'video', role: 'videoExport', nodeKey: 'modules.Video.Export', inputHandle: 'video' },
    },
  ];
  const specs = cases.map((item) => {
    const semantic = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: item.id,
      modelType: 'BuiltinVideoOperation',
      mode: item.mode,
      executionProfileId: profile.id,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      executionPath: profile.execution_path,
      pipelineClass: profile.pipeline_class,
      defaultRepo: repo,
      roles: item.roles,
      edges: item.edges,
      bindings: item.bindings,
      autoFields,
      actions: [],
    };
    const spec = {
      ...semantic,
      contentHash: `studio-spec-v1-${hashModule.hashString(hashModule.stableStringify(semantic))}`,
    };
    assert.equal(spec.contentHash, item.specHash);
    return spec;
  });
  const parsedSpecs = executionSpecsModule.parseStudioExecutionSpecs(specs, 'BuiltinVideoOperation', modes, [profile]);
  const contracts = cases.map((item, index) => {
    const semantic = {
      schemaVersion: 1,
      canonicalizationVersion: 1,
      id: `task-template:${item.id}`,
      modelType: 'BuiltinVideoOperation',
      mode: item.mode,
      mediaKind: item.mediaKind,
      executionProfileId: profile.id,
      executionSpecId: item.id,
      executionSpecContentHash: specs[index].contentHash,
      loaderModule: profile.loader_module,
      loaderAction: profile.loader_action,
      loaderRole: 'videoOperation',
      pipelineClass: profile.pipeline_class,
      defaultRepo: repo,
      loaderRepositories: [repo],
      requiredMedia: item.requiredMedia,
      output: item.output,
      qualificationStatus: 'graph-qualified-execution-pending',
      galleryEligible: false,
    };
    const contract = {
      ...semantic,
      contentHash: `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semantic))}`,
    };
    assert.equal(contract.contentHash, item.taskHash);
    return contract;
  });
  const capability = {
    modelType: 'BuiltinVideoOperation',
    studioExecutionSpecs: parsedSpecs,
    executionProfiles: [profile],
  };
  assert.equal(contractsModule.parseTaskTemplateContracts(contracts, 1, [capability]).length, 5);
  assert.deepEqual(modelProfilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.BuiltinVideoOperation.artifacts, []);
});

test('model-backed video upscale preserves the exact Spandrel task boundary', () => {
  const mode = 'video_upscale';
  const repo = modelProfilesModule.SPANDREL_VIDEO_UPSCALE_REPO;
  const profile = {
    id: 'real-esrgan-x2-video-upscale:direct',
    model_type: 'SpandrelVideoUpscale',
    modes: [mode],
    loader_module: 'modules.Video',
    loader_action: 'UpscaleVideo',
    execution_path: 'spandrel-video-upscale',
    pipeline_class: 'SpandrelVideoUpscaleV1',
    default_repo: repo,
    fallback_repo: null,
    compatible_repos: [],
  };
  const semanticSpec = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    id: 'real-esrgan-x2-video-upscale:v1',
    modelType: 'SpandrelVideoUpscale',
    mode,
    executionProfileId: profile.id,
    loaderModule: profile.loader_module,
    loaderAction: profile.loader_action,
    executionPath: profile.execution_path,
    pipelineClass: profile.pipeline_class,
    defaultRepo: repo,
    roles: [
      ['videoUpscaler', 'modules.Video.UpscaleVideo', -220, -80],
      ['videoExport', 'modules.Video.Export', 300, -80],
    ],
    edges: [['videoUpscaler', 'video_out', 'videoExport', 'video']],
    bindings: [
      ['videoUpscaler', 'video', 'sourceVideo'],
      ['videoUpscaler', 'pipeline_class', 'pipelineClass'],
      ['videoUpscaler', 'operation', 'mode'],
      ['videoUpscaler', 'device', 'device'],
      ['videoUpscaler', 'fps', 'fps'],
      ['videoExport', 'fps', 'fps'],
    ],
    autoFields: [
      'resolvedArtifact',
      'artifact',
      'installTarget.repo',
      'modelRepo',
      'pipelineClass',
      'dtype',
      'offloadMode',
      'quantizedComponents',
      'attentionBackend',
      'regionalCompile',
      'denoiserCache',
      'layerwiseCasting',
      'channelsLast',
    ],
    actions: [],
  };
  const spec = {
    ...semanticSpec,
    contentHash: `studio-spec-v1-${hashModule.hashString(hashModule.stableStringify(semanticSpec))}`,
  };
  assert.equal(spec.contentHash, 'studio-spec-v1-231f621f');
  const parsedSpecs = executionSpecsModule.parseStudioExecutionSpecs([spec], 'SpandrelVideoUpscale', [mode], [profile]);
  const semanticContract = {
    schemaVersion: 1,
    canonicalizationVersion: 1,
    id: 'task-template:real-esrgan-x2-video-upscale:v1',
    modelType: 'SpandrelVideoUpscale',
    mode,
    mediaKind: 'video',
    executionProfileId: profile.id,
    executionSpecId: spec.id,
    executionSpecContentHash: spec.contentHash,
    loaderModule: profile.loader_module,
    loaderAction: profile.loader_action,
    loaderRole: 'videoUpscaler',
    pipelineClass: profile.pipeline_class,
    defaultRepo: repo,
    loaderRepositories: [repo],
    requiredMedia: [{ kind: 'video', field: 'sourceVideo', minimumCount: 1 }],
    output: { mediaKind: 'video', role: 'videoExport', nodeKey: 'modules.Video.Export', inputHandle: 'video' },
    qualificationStatus: 'graph-qualified-execution-pending',
    galleryEligible: false,
  };
  const contract = {
    ...semanticContract,
    contentHash: `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semanticContract))}`,
  };
  assert.equal(contract.contentHash, 'task-template-v1-a05b8a58');
  const capability = {
    modelType: 'SpandrelVideoUpscale',
    studioExecutionSpecs: parsedSpecs,
    executionProfiles: [profile],
  };
  assert.equal(contractsModule.parseTaskTemplateContracts([contract], 1, [capability]).length, 1);
  assert.deepEqual(modelProfilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.SpandrelVideoUpscale.artifacts, [repo]);
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

  for (const minimumCount of [0, 65]) {
    const countTamper = structuredClone(fixture.contracts);
    countTamper[1].requiredMedia[0].minimumCount = minimumCount;
    const { contentHash: _oldHash, ...semantic } = countTamper[1];
    countTamper[1].contentHash = `task-template-v1-${hashModule.hashString(hashModule.stableStringify(semantic))}`;
    assert.throws(
      () => contractsModule.parseTaskTemplateContracts(countTamper, 1, fixture.capabilities),
      /Invalid Studio task-template contract/,
    );
  }
});
