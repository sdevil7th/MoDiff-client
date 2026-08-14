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

test('contracts for backend model types unknown to this client are ignored', () => {
  const fixture = buildFixture();
  const parsed = contractsModule.parseTaskTemplateContracts(
    [...fixture.contracts, { modelType: 'FuturePipeline' }],
    1,
    fixture.capabilities,
  );
  assert.equal(parsed.length, fixture.contracts.length);
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
