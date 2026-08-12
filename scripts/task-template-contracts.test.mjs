import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let contractsModule;
let hashModule;
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
  hashModule = await server.ssrLoadModule('/src/studio/stableHash.ts');
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

test('generic image video and audio task contracts build stable skeletons and preserve required media', () => {
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
    ],
  );
  assert.equal(new Set(first.map(({ id }) => id)).size, 3);
});

test('qualification-pending task skeletons remain hidden from Gallery', () => {
  const fixture = buildFixture();
  const parsed = contractsModule.parseTaskTemplateContracts(fixture.contracts, 1, fixture.capabilities);
  assert.deepEqual(contractsModule.galleryTaskTemplateSkeletons(parsed), []);
  assert.ok(parsed.every((contract) => contract.galleryEligible === false));
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
