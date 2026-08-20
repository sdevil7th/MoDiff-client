import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { findCanonicalWorkflowRecord } from './release-contract-core.mjs';
import {
  normalizePortableWorkflowNodeOffload,
  workflowNodeAttentionBackendError,
  workflowNodeDeviceOffloadError,
} from './workflow-library-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let templatesModule;
let browserModule;
let readinessModule;
let profilesModule;
let resourcePlannerModule;
let autoResourceModule;
let runReadinessModule;
let runMetadataModule;
let outputContractsModule;
let nodesStoreModule;
let studioStoreModule;
let templateQualityModule;
let templateAssetsModule;
let modelCacheModule;
let templateExactnessModule;
let templateInputsModule;
let workflowInferenceModule;
let startupRequestModule;
let flowStoreModule;
let runtimeOptionsModule;
let deviceRebaseModule;
let modelUsagePoliciesModule;
let modelCapabilitiesModule;

before(async () => {
  globalThis.window = {
    location: {
      origin: 'http://127.0.0.1:5191',
    },
  };
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  templatesModule = await server.ssrLoadModule('/src/studio/templates.ts');
  browserModule = await server.ssrLoadModule('/src/studio/templateBrowser.ts');
  readinessModule = await server.ssrLoadModule('/src/studio/templateReadiness.ts');
  profilesModule = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  resourcePlannerModule = await server.ssrLoadModule('/src/studio/resourcePlanner.ts');
  autoResourceModule = await server.ssrLoadModule('/src/studio/autoResource.ts');
  runReadinessModule = await server.ssrLoadModule('/src/studio/runReadiness.ts');
  runMetadataModule = await server.ssrLoadModule('/src/studio/runPreparation.ts');
  outputContractsModule = await server.ssrLoadModule('/src/studio/outputContracts.ts');
  nodesStoreModule = await server.ssrLoadModule('/src/stores/useNodeStore.ts');
  studioStoreModule = await server.ssrLoadModule('/src/stores/useStudioStore.ts');
  templateQualityModule = await server.ssrLoadModule('/src/studio/templateQuality.ts');
  templateAssetsModule = await server.ssrLoadModule('/src/studio/templateAssets.ts');
  modelCacheModule = await server.ssrLoadModule('/src/studio/modelCache.ts');
  templateExactnessModule = await server.ssrLoadModule('/src/studio/templateExactness.ts');
  templateInputsModule = await server.ssrLoadModule('/src/studio/templateInputs.ts');
  workflowInferenceModule = await server.ssrLoadModule('/src/studio/workflowInference.ts');
  startupRequestModule = await server.ssrLoadModule('/src/studio/startupRequest.ts');
  flowStoreModule = await server.ssrLoadModule('/src/stores/useFlowStore.ts');
  runtimeOptionsModule = await server.ssrLoadModule('/src/studio/runtimeOptions.ts');
  deviceRebaseModule = await server.ssrLoadModule('/src/studio/deviceRebase.ts');
  modelUsagePoliciesModule = await server.ssrLoadModule('/src/studio/modelUsagePolicies.ts');
  modelCapabilitiesModule = await server.ssrLoadModule('/src/studio/modelCapabilities.ts');
});

test('schema-v2 capability modes are exact while legacy mode metadata can fall back', () => {
  const explicitNoModes = {
    modelType: 'FluxDepthPipeline',
    modes: ['control_image'],
    runnableModes: [],
  };
  const exact = modelCapabilitiesModule.exactStudioCapabilitySupport(
    [explicitNoModes],
    true,
    'FluxDepthPipeline',
    'control_image',
  );

  assert.equal(exact.status, 'unsupported');
  assert.equal(exact.reason, 'mode_not_advertised');
  assert.deepEqual(exact.modes, []);
  assert.equal(
    modelCapabilitiesModule.exactStudioCapabilityUnsupportedMessage('FluxDepthPipeline', 'control_image', exact),
    'FLUX.1-Depth-dev does not support Control image on the connected backend.',
  );

  const legacy = { modelType: 'FluxDepthPipeline', modes: ['control_image'] };
  assert.deepEqual(modelCapabilitiesModule.advertisedStudioModes(legacy), ['control_image']);
  assert.equal(
    modelCapabilitiesModule.exactStudioCapabilitySupport([legacy], false, 'FluxDepthPipeline', 'control_image').status,
    'unknown',
  );
});

test('every public Studio template resolves an exact canonical workflow contract', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(ROOT, '..', 'MoDiff', 'data', 'workflow-library-manifest.json'), 'utf8'),
  );
  const workflowRecords = [...manifest.workflows, ...manifest.experimentalWorkflows].map((record) => ({
    manifest: record,
  }));
  for (const template of templatesModule.STUDIO_TEMPLATES) {
    const workflow = findCanonicalWorkflowRecord(workflowRecords, template);
    assert.ok(workflow, `${template.id} must resolve an exact canonical workflow`);
    assert.match(workflow.manifest.graphHash, /^[0-9a-f]{64}$/);
    assert.match(workflow.manifest.graphPath, /\.json$/);
  }
});

test('the managed Qwen ControlNet requirement carries its reviewed immutable commit', () => {
  assert.equal(profilesModule.QWEN_CONTROLNET_REQUIREMENT.repo, 'InstantX/Qwen-Image-ControlNet-Union');
  assert.equal(profilesModule.QWEN_CONTROLNET_REQUIREMENT.revision, 'b13036f066d6dee7c20513e263d3d673055e9de8');
  assert.deepEqual(
    profilesModule.modelDependencyReceiptForMode(profilesModule.STUDIO_MODEL_PROFILES.FluxReduxPipeline, 'edit_image'),
    [
      {
        id: 'flux-redux-base',
        kind: 'base',
        repo: 'black-forest-labs/FLUX.1-dev',
        revision: '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21',
      },
    ],
  );
});

test('unconditional image profiles expose prompt-free native sampling defaults', () => {
  assert.equal(profilesModule.getDefaultModelForMode('unconditional_image'), 'DDPMPipeline');
  assert.deepEqual(profilesModule.getCompatibleModelsForMode('unconditional_image', { includeWorkflowOnly: true }), [
    'DDPMPipeline',
    'DDIMPipeline',
    'ConsistencyModelPipeline',
  ]);

  const expected = {
    DDPMPipeline: { repo: profilesModule.DDPM_CIFAR10_REPO, side: 32, steps: 1000 },
    DDIMPipeline: { repo: profilesModule.DDPM_CIFAR10_REPO, side: 32, steps: 50 },
    ConsistencyModelPipeline: { repo: profilesModule.CONSISTENCY_IMAGENET64_REPO, side: 64, steps: 1 },
  };
  for (const [modelType, contract] of Object.entries(expected)) {
    const profile = profilesModule.STUDIO_MODEL_PROFILES[modelType];
    const form = profilesModule.getFormDefaultsForMode('unconditional_image', modelType);
    assert.equal(profile.defaultRepo, contract.repo);
    assert.equal(profile.supportsNegativePrompt, false);
    assert.equal(form.width, contract.side);
    assert.equal(form.height, contract.side);
    assert.equal(form.steps, contract.steps);
    assert.equal(form.batchSize, 1);
    assert.equal(form.eta, 0);
    assert.equal(form.classLabel, -1);
  }
});

test('Stable Diffusion 1.5 exposes generic 512px generation, edit, inpaint, and ControlNet modes', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.StableDiffusionPipeline;
  assert.equal(profile.defaultRepo, profilesModule.SD15_BASE_REPO);
  assert.equal(profile.defaultDtype, 'float32');
  assert.deepEqual(profile.modes, [
    'text_to_image',
    'edit_image',
    'inpaint',
    'control_image',
    'control_edit_image',
    'control_inpaint',
  ]);
  assert.equal(profile.supportsControlImage, true);
  assert.deepEqual(profile.modeRequirements.control_image.modelRequirements, [
    profilesModule.SD15_CONTROLNET_CANNY_REQUIREMENT,
  ]);
  for (const mode of profile.modes) {
    const form = profilesModule.getFormDefaultsForMode(mode, 'StableDiffusionPipeline');
    assert.equal(form.modelType, 'StableDiffusionPipeline');
    assert.equal(form.width, 512);
    assert.equal(form.height, 512);
    assert.equal(form.steps, 30);
    assert.equal(form.guidanceScale, 7.5);
  }
});

test('SDXL Turbo exposes its pinned one-step guidance-zero recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.StableDiffusionXLTurboPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'StableDiffusionXLTurboPipeline');
  assert.equal(profile.defaultRepo, profilesModule.SDXL_TURBO_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.equal(profile.supportsNegativePrompt, false);
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 512);
  assert.equal(form.height, 512);
  assert.equal(form.steps, 1);
  assert.equal(form.guidanceScale, 0);
});

test('SDXL InstructPix2Pix exposes its pinned 768px instruction-edit recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.StableDiffusionXLInstructPix2PixPipeline;
  const form = profilesModule.getFormDefaultsForMode('edit_image', 'StableDiffusionXLInstructPix2PixPipeline');
  assert.equal(profile.defaultRepo, profilesModule.SDXL_INSTRUCT_PIX2PIX_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.deepEqual(profile.modes, ['edit_image']);
  assert.deepEqual(profile.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 768);
  assert.equal(form.height, 768);
  assert.equal(form.steps, 30);
  assert.equal(form.guidanceScale, 3);
  assert.equal(form.conditioningScale, 1.5);
});

test('SDXL ControlNet exposes its pinned 1024px Canny recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.StableDiffusionXLControlNetPipeline;
  const form = profilesModule.getFormDefaultsForMode('control_image', 'StableDiffusionXLControlNetPipeline');
  assert.equal(profile.defaultRepo, profilesModule.SDXL_BASE_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.deepEqual(profile.modes, ['control_image', 'control_edit_image', 'control_inpaint']);
  assert.deepEqual(profile.modeRequirements.control_image.modelRequirements, [
    profilesModule.SDXL_CONTROLNET_CANNY_REQUIREMENT,
  ]);
  assert.deepEqual(profile.modeRequirements.control_image.requiredImages, ['controlImage']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.steps, 50);
  assert.equal(form.guidanceScale, 5);
  assert.equal(form.conditioningScale, 0.5);
});

test('Hunyuan-DiT exposes its exact standalone distilled recipe and immutable terms acknowledgement', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.HunyuanDiTPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'HunyuanDiTPipeline');
  assert.equal(profile.defaultRepo, profilesModule.HUNYUAN_DIT_DISTILLED_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.steps, 25);
  assert.equal(form.guidanceScale, 5);
  assert.equal(form.maxSequenceLength, 256);

  const policies = modelUsagePoliciesModule.acknowledgementRequiredForTemplate({
    id: 'hunyuan-dit-distilled-source',
    modelType: 'HunyuanDiTPipeline',
    mode: 'text_to_image',
  });
  assert.deepEqual(
    policies.map((policy) => policy.repository),
    [profilesModule.HUNYUAN_DIT_DISTILLED_REPO],
  );
  assert.equal(policies[0].acknowledgementRequired, true);
  assert.match(policies[0].termsUrl, /b47a590cac7a3e1a973036700e45b3fe457e2239\/LICENSE\.txt$/);
});

test('Hunyuan-DiT ControlNet exposes its exact Canny recipe and immutable terms acknowledgement', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.HunyuanDiTControlNetPipeline;
  const form = profilesModule.getFormDefaultsForMode('control_image', 'HunyuanDiTControlNetPipeline');
  assert.equal(profile.defaultRepo, profilesModule.HUNYUAN_DIT_DISTILLED_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.deepEqual(profile.modes, ['control_image']);
  assert.deepEqual(profile.modeRequirements.control_image.modelRequirements, [
    profilesModule.HUNYUAN_DIT_CONTROLNET_CANNY_REQUIREMENT,
  ]);
  assert.deepEqual(profile.modeRequirements.control_image.requiredImages, ['controlImage']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.steps, 50);
  assert.equal(form.guidanceScale, 6);
  assert.equal(form.conditioningScale, 1);
  assert.equal(form.maxSequenceLength, 256);

  const policies = modelUsagePoliciesModule.acknowledgementRequiredForTemplate({
    id: 'hunyuan-dit-controlnet-source',
    modelType: 'HunyuanDiTControlNetPipeline',
    mode: 'control_image',
  });
  assert.deepEqual(
    policies.map((policy) => policy.repository),
    [profilesModule.HUNYUAN_DIT_DISTILLED_REPO],
  );
  for (const policy of policies) {
    assert.equal(policy.useScope, 'commercial_allowed');
    assert.equal(policy.access, 'public');
    assert.equal(policy.acknowledgementRequired, true);
    assert.match(policy.shortSummary, /100M-MAU threshold/i);
    assert.match(policy.shortSummary, /machine-generation disclosure/i);
    assert.match(policy.termsUrl, /b47a590cac7a3e1a973036700e45b3fe457e2239\/LICENSE\.txt$/);
  }
});

test('SDXL T2I Adapter exposes its pinned 1024px Canny recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.StableDiffusionXLAdapterPipeline;
  const form = profilesModule.getFormDefaultsForMode('control_image', 'StableDiffusionXLAdapterPipeline');
  assert.equal(profile.defaultRepo, profilesModule.SDXL_BASE_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.deepEqual(profile.modes, ['control_image']);
  assert.deepEqual(profile.modeRequirements.control_image.modelRequirements, [
    profilesModule.SDXL_T2I_ADAPTER_CANNY_REQUIREMENT,
  ]);
  assert.deepEqual(profile.modeRequirements.control_image.requiredImages, ['controlImage']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.steps, 30);
  assert.equal(form.guidanceScale, 7.5);
  assert.equal(form.conditioningScale, 0.8);
});

test('SDXL PAG exposes generic perturbed-attention controls over the pinned base', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.StableDiffusionXLPAGPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'StableDiffusionXLPAGPipeline');
  const edit = profilesModule.getFormDefaultsForMode('edit_image', 'StableDiffusionXLPAGPipeline');
  const inpaint = profilesModule.getFormDefaultsForMode('inpaint', 'StableDiffusionXLPAGPipeline');
  assert.equal(profile.defaultRepo, profilesModule.SDXL_BASE_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.deepEqual(profile.modes, ['text_to_image', 'edit_image', 'inpaint', 'control_image', 'control_edit_image']);
  assert.deepEqual(profile.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.deepEqual(profile.modeRequirements.inpaint.requiredImages, ['referenceImages', 'maskImage']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.steps, 50);
  assert.equal(form.guidanceScale, 5);
  assert.equal(form.pagScale, 3);
  assert.equal(form.pagAdaptiveScale, 0);
  assert.equal(edit.strength, 0.8);
  assert.equal(inpaint.strength, 0.8);
});

test('Sana and Sana Sprint expose their pinned mixed-precision recipes', () => {
  const sana = profilesModule.STUDIO_MODEL_PROFILES.SanaPipeline;
  const sanaForm = profilesModule.getFormDefaultsForMode('text_to_image', 'SanaPipeline');
  assert.equal(sana.defaultRepo, profilesModule.SANA_REPO);
  assert.equal(sana.defaultDtype, 'float16');
  assert.deepEqual(sana.modes, ['text_to_image']);
  assert.equal(sanaForm.steps, 20);
  assert.equal(sanaForm.guidanceScale, 4.5);
  assert.equal(sanaForm.maxSequenceLength, 300);

  const sprint = profilesModule.STUDIO_MODEL_PROFILES.SanaSprintPipeline;
  const sprintText = profilesModule.getFormDefaultsForMode('text_to_image', 'SanaSprintPipeline');
  const sprintEdit = profilesModule.getFormDefaultsForMode('edit_image', 'SanaSprintPipeline');
  assert.equal(sprint.defaultRepo, profilesModule.SANA_SPRINT_REPO);
  assert.equal(sprint.defaultDtype, 'bfloat16');
  assert.equal(sprint.supportsNegativePrompt, false);
  assert.deepEqual(sprint.modes, ['text_to_image', 'edit_image']);
  assert.deepEqual(sprint.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.equal(sprintText.steps, 2);
  assert.equal(sprintText.guidanceScale, 4.5);
  assert.equal(sprintText.maxSequenceLength, 300);
  assert.equal(sprintEdit.strength, 0.5);
});

test('PixArt Sigma exposes its reviewed 1024px workflow recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.PixArtSigmaPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'PixArtSigmaPipeline');
  assert.equal(profile.label, 'PixArt Sigma XL 1024px');
  assert.equal(profile.defaultRepo, profilesModule.PIXART_SIGMA_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.steps, 20);
  assert.equal(form.guidanceScale, 4.5);
  assert.equal(form.maxSequenceLength, 300);
});

test('Kandinsky 3 exposes its reviewed single-stage generation and edit recipes', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.Kandinsky3Pipeline;
  const text = profilesModule.getFormDefaultsForMode('text_to_image', 'Kandinsky3Pipeline');
  const edit = profilesModule.getFormDefaultsForMode('edit_image', 'Kandinsky3Pipeline');
  assert.equal(profile.label, 'Kandinsky 3');
  assert.equal(profile.defaultRepo, profilesModule.KANDINSKY3_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.deepEqual(profile.modes, ['text_to_image', 'edit_image']);
  assert.deepEqual(profile.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(text.width, 1024);
  assert.equal(text.height, 1024);
  assert.equal(text.steps, 25);
  assert.equal(text.guidanceScale, 3);
  assert.equal(text.maxSequenceLength, 128);
  assert.equal(edit.strength, 0.75);
});

test('LongCat Image exposes the reviewed generation and single-image edit profiles', () => {
  const textProfile = profilesModule.STUDIO_MODEL_PROFILES.LongCatImagePipeline;
  const editProfile = profilesModule.STUDIO_MODEL_PROFILES.LongCatImageEditPipeline;
  const text = profilesModule.getFormDefaultsForMode('text_to_image', 'LongCatImagePipeline');
  const edit = profilesModule.getFormDefaultsForMode('edit_image', 'LongCatImageEditPipeline');
  assert.equal(textProfile.defaultRepo, profilesModule.LONGCAT_IMAGE_REPO);
  assert.equal(editProfile.defaultRepo, profilesModule.LONGCAT_IMAGE_EDIT_REPO);
  assert.deepEqual(textProfile.modes, ['text_to_image']);
  assert.deepEqual(editProfile.modes, ['edit_image']);
  assert.deepEqual(editProfile.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.equal(textProfile.catalogVisibility, 'workflowOnly');
  assert.equal(editProfile.catalogVisibility, 'workflowOnly');
  assert.equal(text.steps, 50);
  assert.equal(text.guidanceScale, 4);
  assert.equal(text.maxSequenceLength, 512);
  assert.equal(edit.steps, 50);
  assert.equal(edit.guidanceScale, 4.5);
});

test('Lumina exposes the reviewed generation profiles', () => {
  const luminaProfile = profilesModule.STUDIO_MODEL_PROFILES.LuminaPipeline;
  const lumina2Profile = profilesModule.STUDIO_MODEL_PROFILES.Lumina2Pipeline;
  const lumina = profilesModule.getFormDefaultsForMode('text_to_image', 'LuminaPipeline');
  const lumina2 = profilesModule.getFormDefaultsForMode('text_to_image', 'Lumina2Pipeline');
  assert.equal(luminaProfile.defaultRepo, profilesModule.LUMINA_REPO);
  assert.equal(lumina2Profile.defaultRepo, profilesModule.LUMINA2_REPO);
  assert.deepEqual(luminaProfile.modes, ['text_to_image']);
  assert.deepEqual(lumina2Profile.modes, ['text_to_image']);
  assert.equal(luminaProfile.catalogVisibility, 'workflowOnly');
  assert.equal(lumina2Profile.catalogVisibility, 'workflowOnly');
  assert.equal(lumina.steps, 30);
  assert.equal(lumina.guidanceScale, 4);
  assert.equal(lumina.maxSequenceLength, 256);
  assert.equal(lumina2.steps, 50);
  assert.equal(lumina2.guidanceScale, 4);
  assert.equal(lumina2.maxSequenceLength, 256);
});

test('OmniGen exposes text, single-image, and multi-reference profiles', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.OmniGenPipeline;
  const text = profilesModule.getFormDefaultsForMode('text_to_image', 'OmniGenPipeline');
  const edit = profilesModule.getFormDefaultsForMode('edit_image', 'OmniGenPipeline');
  assert.equal(profile.defaultRepo, profilesModule.OMNIGEN_REPO);
  assert.deepEqual(profile.modes, ['text_to_image', 'edit_image', 'multi_image_reference_edit']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.supportsNegativePrompt, false);
  assert.equal(profile.supportsImageInput, true);
  assert.equal(profile.supportsMultiImage, true);
  assert.deepEqual(profile.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.deepEqual(profile.modeRequirements.multi_image_reference_edit.requiredImages, ['referenceImages']);
  assert.equal(text.steps, 50);
  assert.equal(text.guidanceScale, 2.5);
  assert.equal(edit.conditioningScale, 1.6);
});

test('PRX exposes its bounded native 512px SFT recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.PRXPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'PRXPipeline');
  assert.equal(profile.defaultRepo, profilesModule.PRX_REPO);
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.family, 'PRX');
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 512);
  assert.equal(form.height, 512);
  assert.equal(form.steps, 28);
  assert.equal(form.guidanceScale, 5);
  assert.equal(form.maxSequenceLength, 256);
});

test('Nucleus Image exposes its reviewed 1024px MoE recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.NucleusMoEImagePipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'NucleusMoEImagePipeline');
  assert.equal(profile.defaultRepo, profilesModule.NUCLEUS_IMAGE_REPO);
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.family, 'Nucleus Image');
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.defaultDtype, 'bfloat16');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.steps, 50);
  assert.equal(form.guidanceScale, 4);
  assert.equal(form.maxSequenceLength, 1024);
});

test('AuraFlow v0.3 exposes its reviewed native fp16 recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.AuraFlowPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'AuraFlowPipeline');
  assert.equal(profile.label, 'AuraFlow v0.3 1536px');
  assert.equal(profile.defaultRepo, profilesModule.AURAFLOW_V03_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1536);
  assert.equal(form.height, 768);
  assert.equal(form.aspectRatio, 'custom');
  assert.equal(form.steps, 50);
  assert.equal(form.guidanceScale, 3.5);
  assert.equal(form.maxSequenceLength, 256);
});

test('Chroma1-HD exposes its reviewed bounded bfloat16 recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.ChromaPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'ChromaPipeline');
  assert.equal(profile.label, 'Chroma1-HD 1024px');
  assert.equal(profile.defaultRepo, profilesModule.CHROMA1_HD_REPO);
  assert.equal(profile.defaultDtype, 'bfloat16');
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.aspectRatio, '1:1');
  assert.equal(form.steps, 40);
  assert.equal(form.guidanceScale, 3);
  assert.equal(form.maxSequenceLength, 512);
});

test('CogView3 Plus exposes its reviewed bfloat16 1024px recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.CogView3PlusPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'CogView3PlusPipeline');
  assert.equal(profile.label, 'CogView3 Plus 3B');
  assert.equal(profile.defaultRepo, profilesModule.COGVIEW3_PLUS_REPO);
  assert.equal(profile.defaultDtype, 'bfloat16');
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.aspectRatio, '1:1');
  assert.equal(form.steps, 50);
  assert.equal(form.guidanceScale, 7);
  assert.equal(form.maxSequenceLength, 224);
});

test('CogView4 exposes its reviewed bounded bfloat16 1024px recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.CogView4Pipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'CogView4Pipeline');
  assert.equal(profile.label, 'CogView4 6B');
  assert.equal(profile.defaultRepo, profilesModule.COGVIEW4_6B_REPO);
  assert.equal(profile.defaultDtype, 'bfloat16');
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.aspectRatio, '1:1');
  assert.equal(form.steps, 50);
  assert.equal(form.guidanceScale, 3.5);
  assert.equal(form.maxSequenceLength, 1024);
});

test('ERNIE Image Turbo exposes its reviewed fixed 1024px recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.ErnieImagePipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'ErnieImagePipeline');
  assert.equal(profile.label, 'ERNIE Image Turbo');
  assert.equal(profile.defaultRepo, profilesModule.ERNIE_IMAGE_TURBO_REPO);
  assert.equal(profile.defaultDtype, 'bfloat16');
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.supportsNegativePrompt, false);
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.aspectRatio, '1:1');
  assert.equal(form.steps, 8);
  assert.equal(form.guidanceScale, 1);
  assert.equal(form.maxSequenceLength, 2048);
});

test('GLM-Image exposes its reviewed fixed 1024px recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.GlmImagePipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'GlmImagePipeline');
  assert.equal(profile.label, 'GLM-Image');
  assert.equal(profile.defaultRepo, profilesModule.GLM_IMAGE_REPO);
  assert.equal(profile.defaultDtype, 'bfloat16');
  assert.deepEqual(profile.modes, ['text_to_image']);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.supportsNegativePrompt, false);
  assert.equal(form.width, 1024);
  assert.equal(form.height, 1024);
  assert.equal(form.aspectRatio, '1:1');
  assert.equal(form.steps, 50);
  assert.equal(form.guidanceScale, 1.5);
  assert.equal(form.maxSequenceLength, 2048);
});

test('JoyAI Image exposes separate bounded single- and multi-image recipes', () => {
  const edit = profilesModule.STUDIO_MODEL_PROFILES.JoyImageEditPipeline;
  const textForm = profilesModule.getFormDefaultsForMode('text_to_image', 'JoyImageEditPipeline');
  const editForm = profilesModule.getFormDefaultsForMode('edit_image', 'JoyImageEditPipeline');
  assert.equal(edit.label, 'JoyAI Image Edit');
  assert.equal(edit.defaultRepo, profilesModule.JOYIMAGE_EDIT_REPO);
  assert.equal(edit.defaultDtype, 'bfloat16');
  assert.deepEqual(edit.modes, ['text_to_image', 'edit_image']);
  assert.deepEqual(edit.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.equal(edit.supportsImageInput, true);
  assert.equal(edit.supportsMultiImage, false);
  assert.equal(textForm.steps, 40);
  assert.equal(editForm.guidanceScale, 4);
  assert.equal(editForm.maxSequenceLength, 2048);

  const plus = profilesModule.STUDIO_MODEL_PROFILES.JoyImageEditPlusPipeline;
  const plusForm = profilesModule.getFormDefaultsForMode('multi_image_reference_edit', 'JoyImageEditPlusPipeline');
  assert.equal(plus.label, 'JoyAI Image Edit Plus');
  assert.equal(plus.defaultRepo, profilesModule.JOYIMAGE_EDIT_PLUS_REPO);
  assert.deepEqual(plus.modes, ['edit_image', 'multi_image_reference_edit']);
  assert.deepEqual(plus.modeRequirements.multi_image_reference_edit.requiredImages, ['referenceImages']);
  assert.equal(plus.supportsImageInput, true);
  assert.equal(plus.supportsMultiImage, true);
  assert.equal(plusForm.width, 1024);
  assert.equal(plusForm.height, 1024);
  assert.equal(plusForm.steps, 30);
  assert.equal(plusForm.guidanceScale, 4);
  assert.equal(plusForm.maxSequenceLength, 2048);
});

test('DreamLite base and mobile expose distinct pinned guidance recipes', () => {
  const base = profilesModule.STUDIO_MODEL_PROFILES.DreamLitePipeline;
  const baseText = profilesModule.getFormDefaultsForMode('text_to_image', 'DreamLitePipeline');
  const baseEdit = profilesModule.getFormDefaultsForMode('edit_image', 'DreamLitePipeline');
  assert.equal(base.defaultRepo, profilesModule.DREAMLITE_BASE_REPO);
  assert.equal(base.defaultDtype, 'bfloat16');
  assert.deepEqual(base.modes, ['text_to_image', 'edit_image']);
  assert.deepEqual(base.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.equal(baseText.steps, 28);
  assert.equal(baseText.guidanceScale, 3.5);
  assert.equal(baseText.maxSequenceLength, 200);
  assert.equal(baseEdit.conditioningScale, 1.5);

  const mobile = profilesModule.STUDIO_MODEL_PROFILES.DreamLiteMobilePipeline;
  const mobileText = profilesModule.getFormDefaultsForMode('text_to_image', 'DreamLiteMobilePipeline');
  assert.equal(mobile.defaultRepo, profilesModule.DREAMLITE_MOBILE_REPO);
  assert.equal(mobile.supportsNegativePrompt, false);
  assert.deepEqual(mobile.modes, ['text_to_image', 'edit_image']);
  assert.equal(mobileText.steps, 4);
  assert.equal(mobileText.guidanceScale, 0);
  assert.equal(mobileText.maxSequenceLength, 200);
  assert.equal(mobileText.conditioningScale, 0);
});

test('LongCat AudioDiT and AudioLDM2 expose their pinned generic audio recipes', () => {
  const longcat = profilesModule.STUDIO_MODEL_PROFILES.LongCatAudioDiTPipeline;
  const longcatForm = profilesModule.getFormDefaultsForMode('text_to_audio', 'LongCatAudioDiTPipeline');
  assert.equal(longcat.defaultRepo, profilesModule.LONGCAT_AUDIO_DIT_REPO);
  assert.equal(longcat.defaultDtype, 'bfloat16');
  assert.equal(longcat.recommendedSampleRate, 24000);
  assert.equal(longcatForm.audioDuration, 5);
  assert.equal(longcatForm.steps, 16);
  assert.equal(longcatForm.guidanceScale, 4);

  const audioldm2 = profilesModule.STUDIO_MODEL_PROFILES.AudioLDM2Pipeline;
  const audioldm2Form = profilesModule.getFormDefaultsForMode('text_to_audio', 'AudioLDM2Pipeline');
  assert.equal(audioldm2.defaultRepo, profilesModule.AUDIO_LDM2_REPO);
  assert.equal(audioldm2.defaultDtype, 'float16');
  assert.equal(audioldm2.recommendedSampleRate, 16000);
  assert.equal(audioldm2Form.audioDuration, 10);
  assert.equal(audioldm2Form.steps, 200);
  assert.equal(audioldm2Form.guidanceScale, 3.5);
});

test('Shap-E exposes the pinned safe rendered-orbit recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.ShapEPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_3d', 'ShapEPipeline');
  assert.equal(profilesModule.getDefaultModelForMode('text_to_3d'), 'ShapEPipeline');
  assert.equal(profile.defaultRepo, profilesModule.SHAP_E_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.equal(profile.outputKind, 'video');
  assert.equal(profile.recommendedFrames, 20);
  assert.equal(form.width, 256);
  assert.equal(form.height, 256);
  assert.equal(form.steps, 64);
  assert.equal(form.guidanceScale, 15);
  assert.equal(form.fps, 12);
  assert.ok(
    resourcePlannerModule.AUTO_RESOURCE_LOADER_TARGETS.includes(
      'modules.DiffusersThreeD.LoadPipeline.direct-diffusers-three-d',
    ),
  );
  assert.equal(
    resourcePlannerModule.getStudioResourceExecutionPathLabel({
      resourceMode: 'auto',
      executionPath: 'direct-diffusers-three-d',
    }),
    'Auto: Diffusers 3D',
  );
});

test('Stable Video Diffusion exposes a gated prompt-free short-video recipe', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.StableVideoDiffusionPipeline;
  const form = profilesModule.getFormDefaultsForMode('image_to_video', 'StableVideoDiffusionPipeline');
  assert.equal(profile.defaultRepo, profilesModule.STABLE_VIDEO_DIFFUSION_REPO);
  assert.equal(profile.defaultDtype, 'float16');
  assert.equal(profile.supportsPrompt, false);
  assert.equal(profile.supportsNegativePrompt, false);
  assert.equal(profile.outputKind, 'video');
  assert.equal(profile.recommendedFrames, 25);
  assert.equal(profile.recommendedFps, 7);
  assert.deepEqual(profile.modeRequirements.image_to_video.requiredImages, ['referenceImages']);
  assert.equal(form.width, 1024);
  assert.equal(form.height, 576);
  assert.equal(form.steps, 25);
  assert.equal(form.guidanceScale, 3);
  assert.equal(form.numFrames, 25);
  assert.equal(form.fps, 7);

  const policy = modelUsagePoliciesModule.usagePolicyForRepository(profile.defaultRepo);
  assert.equal(policy.access, 'huggingface_gated');
  assert.equal(policy.acknowledgementRequired, true);
  assert.equal(policy.reviewedRevision, profilesModule.STABLE_VIDEO_DIFFUSION_REVISION);
  assert.match(policy.shortSummary, /limited commercial use/i);
  assert.match(policy.shortSummary, /registration, revenue, attribution, AUP/i);
  assert.equal(modelUsagePoliciesModule.repositoryRequiresHuggingFaceGate(profile.defaultRepo), true);
});

test('AnimateDiff and AnimateLCM expose independently pinned motion recipes and undeclared-rights notices', () => {
  const animatediff = profilesModule.STUDIO_MODEL_PROFILES.AnimateDiffPipeline;
  const animatelcm = profilesModule.STUDIO_MODEL_PROFILES.AnimateLCMPipeline;
  assert.equal(animatediff.defaultRepo, profilesModule.SD15_BASE_REPO);
  assert.equal(animatelcm.defaultRepo, profilesModule.SD15_BASE_REPO);
  assert.equal(animatediff.defaultDtype, 'float16');
  assert.equal(animatediff.recommendedSteps, 25);
  assert.equal(animatediff.recommendedGuidance, 7.5);
  assert.equal(animatelcm.recommendedSteps, 6);
  assert.equal(animatelcm.recommendedGuidance, 1.5);
  assert.equal(animatediff.recommendedFrames, 16);
  assert.equal(animatelcm.recommendedFrames, 16);
  assert.deepEqual(animatediff.modeRequirements.text_to_video.modelRequirements, [
    profilesModule.ANIMATEDIFF_MOTION_REQUIREMENT,
  ]);
  assert.deepEqual(animatelcm.modeRequirements.text_to_video.modelRequirements, [
    profilesModule.ANIMATELCM_MOTION_REQUIREMENT,
  ]);

  const templates = [
    { id: 'animatediff-source', modelType: 'AnimateDiffPipeline', mode: 'text_to_video' },
    { id: 'animatelcm-source', modelType: 'AnimateLCMPipeline', mode: 'text_to_video' },
  ];
  const policies = templates.map((template) => modelUsagePoliciesModule.acknowledgementRequiredForTemplate(template));
  assert.deepEqual(
    policies[0].map((policy) => policy.repository),
    [profilesModule.ANIMATEDIFF_MOTION_REPO],
  );
  assert.deepEqual(
    policies[1].map((policy) => policy.repository),
    [profilesModule.ANIMATELCM_MOTION_REPO],
  );
  for (const policy of policies.flat()) {
    assert.equal(policy.useScope, 'rights_undetermined');
    assert.equal(policy.access, 'public');
    assert.equal(policy.acknowledgementRequired, true);
    assert.match(policy.shortSummary, /does not declare a license/i);
    assert.match(policy.shortSummary, /independently establish authorization/i);
    assert.match(modelUsagePoliciesModule.usagePolicyAcknowledgementKey([policy]), /^terms-v2:[0-9a-f]{8}$/);
  }
});

test('CogVideoX-2B exposes the bounded native short-video source contract', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.CogVideoXPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_video', 'CogVideoXPipeline');
  assert.equal(profile.defaultRepo, profilesModule.COGVIDEOX_2B_REPO);
  assert.equal(profilesModule.COGVIDEOX_2B_REVISION, '1137dacfc2c9c012bed6a0793f4ecf2ca8e7ba01');
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.defaultDtype, 'float16');
  assert.equal(profile.outputKind, 'video');
  assert.equal(profile.recommendedMaxSequenceLength, 226);
  assert.equal(form.width, 720);
  assert.equal(form.height, 480);
  assert.equal(form.steps, 25);
  assert.equal(form.guidanceScale, 6);
  assert.equal(form.numFrames, 25);
  assert.equal(form.fps, 8);
});

test('direct Qwen and extended video profiles stay Expert-only with generic media contracts', () => {
  const qwenControl = profilesModule.STUDIO_MODEL_PROFILES.QwenImageControlNetPipeline;
  const qwenLayered = profilesModule.STUDIO_MODEL_PROFILES.QwenImageLayeredPipeline;
  assert.deepEqual(qwenControl.modes, ['control_image']);
  assert.deepEqual(qwenControl.revisionCandidates, [profilesModule.QWEN_IMAGE_2512_REVISION]);
  assert.deepEqual(qwenControl.modeRequirements.control_image.requiredImages, ['controlImage']);
  assert.deepEqual(qwenControl.modeRequirements.control_image.modelRequirements, [
    profilesModule.QWEN_CONTROLNET_REQUIREMENT,
  ]);
  assert.deepEqual(qwenLayered.modes, ['layer_decomposition']);
  assert.deepEqual(qwenLayered.revisionCandidates, [profilesModule.QWEN_IMAGE_LAYERED_REVISION]);
  assert.deepEqual(qwenLayered.modeRequirements.layer_decomposition.requiredImages, ['referenceImages']);
  assert.deepEqual(qwenLayered.layerCount, { default: 4, min: 1, max: 10 });
  assert.deepEqual(qwenLayered.layerResolutions, [640, 1024]);
  const layeredForm = profilesModule.getFormDefaultsForMode('layer_decomposition', 'QwenImageLayeredPipeline');
  assert.equal(layeredForm.layers, 4);
  assert.equal(layeredForm.width, 1024);
  assert.equal(layeredForm.height, 1024);

  const videoCases = [
    ['AnimateDiffPAGPipeline', 'text_to_video', []],
    ['AnimateDiffVideoToVideoPipeline', 'video_to_video', ['sourceVideo']],
    ['AnimateDiffControlNetPipeline', 'control_to_video', ['controlVideo']],
    ['AnimateDiffVideoToVideoControlNetPipeline', 'control_video_to_video', ['sourceVideo', 'controlVideo']],
    ['CogVideoXVideoToVideoPipeline', 'video_to_video', ['sourceVideo']],
  ];
  for (const [modelType, mode, requiredVideos] of videoCases) {
    const profile = profilesModule.STUDIO_MODEL_PROFILES[modelType];
    assert.deepEqual(profile.modes, [mode]);
    assert.deepEqual(profile.modeRequirements[mode].requiredVideos ?? [], requiredVideos);
    assert.equal(profile.outputKind, 'video');
    assert.equal(profile.catalogVisibility, 'workflowOnly');
    assert.equal(profile.executionStatus, 'expert_only');
    assert.equal(profile.qualificationStatus, 'graph-qualified-execution-pending');
    assert.deepEqual(profile.qualifiedModes, []);
    assert.equal(profile.autoEligible, false);
    assert.equal(profile.galleryEligible, false);
    assert.equal(profile.liveProof, false);
    assert.equal(profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS[modelType].autoStatus, 'manual_only');
  }
  assert.deepEqual(
    profilesModule.STUDIO_MODEL_PROFILES.AnimateDiffControlNetPipeline.modeRequirements.control_to_video.modelRequirements.map(
      ({ kind }) => kind,
    ),
    ['adapter', 'controlnet'],
  );
  assert.equal(
    profilesModule.getDefaultModelForMode('control_video_to_video'),
    'AnimateDiffVideoToVideoControlNetPipeline',
  );
});

test('final direct image and LTX2 routes stay additive, Expert-only, and media truthful', () => {
  const imageCases = [
    ['QwenImageEditPipeline', ['edit_image'], profilesModule.QWEN_IMAGE_EDIT_REVISION],
    [
      'QwenImageEditPlusPipeline',
      ['edit_image', 'multi_image_reference_edit'],
      profilesModule.QWEN_IMAGE_EDIT_PLUS_REVISION,
    ],
    ['ZImageInpaintPipeline', ['inpaint', 'outpaint'], profilesModule.Z_IMAGE_REVISION],
    ['FluxKontextInpaintPipeline', ['inpaint', 'outpaint'], profilesModule.FLUX_KONTEXT_REVISION],
    ['Flux2KleinInpaintPipeline', ['inpaint', 'outpaint'], profilesModule.FLUX2_KLEIN_REVISION],
    ['ChromaImg2ImgPipeline', ['edit_image'], profilesModule.CHROMA1_HD_REVISION],
    ['ChromaInpaintPipeline', ['inpaint', 'outpaint'], profilesModule.CHROMA1_HD_REVISION],
  ];
  for (const [modelType, modes, revision] of imageCases) {
    const profile = profilesModule.STUDIO_MODEL_PROFILES[modelType];
    assert.deepEqual(profile.modes, modes);
    assert.deepEqual(profile.revisionCandidates, [revision]);
    assert.equal(profile.outputKind, 'image');
    assert.equal(profile.catalogVisibility, 'workflowOnly');
    assert.equal(profile.executionStatus, 'expert_only');
    assert.equal(profile.qualificationStatus, 'graph-qualified-execution-pending');
    assert.deepEqual(profile.qualifiedModes, []);
    assert.equal(profile.autoEligible, false);
    assert.equal(profile.templateEligible, true);
    assert.equal(profile.galleryEligible, false);
    assert.equal(profile.liveProof, false);
    assert.equal(profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS[modelType].autoStatus, 'manual_only');
  }
  for (const modelType of [
    'ZImageInpaintPipeline',
    'FluxKontextInpaintPipeline',
    'Flux2KleinInpaintPipeline',
    'ChromaInpaintPipeline',
  ]) {
    const requirements = profilesModule.STUDIO_MODEL_PROFILES[modelType].modeRequirements;
    assert.deepEqual(requirements.inpaint.requiredImages, ['referenceImages', 'maskImage']);
    assert.deepEqual(requirements.outpaint.requiredImages, ['referenceImages']);
  }

  const ltx2 = profilesModule.STUDIO_MODEL_PROFILES.LTX2Pipeline;
  assert.deepEqual(ltx2.modes, ['text_to_video']);
  assert.deepEqual(ltx2.outputMedia, ['video', 'audio']);
  assert.equal(ltx2.outputKind, 'video');
  assert.equal(ltx2.recommendedFrames, 121);
  assert.equal(ltx2.recommendedFps, 24);
  assert.equal(ltx2.recommendedSteps, 40);
  assert.equal(ltx2.recommendedGuidance, 4);
  assert.deepEqual(ltx2.revisionCandidates, [profilesModule.LTX2_REVISION]);
  assert.equal(ltx2.catalogVisibility, 'workflowOnly');
  assert.equal(ltx2.autoEligible, false);
  assert.equal(ltx2.galleryEligible, false);

  assert.deepEqual(profilesModule.STUDIO_MODEL_PROFILES.QwenImageEditModularPipeline.modes, [
    'edit_image',
    'inpaint',
    'outpaint',
  ]);
  assert.deepEqual(profilesModule.STUDIO_MODEL_PROFILES.QwenImageEditPlusModularPipeline.modes, [
    'edit_image',
    'multi_image_reference_edit',
  ]);
  assert.deepEqual(profilesModule.STUDIO_MODEL_PROFILES.LTX2ConditionPipeline.modes, [
    'text_to_video',
    'image_to_video',
    'video_to_video',
    'reference_to_video',
  ]);
});

test('generic direct outpaint and synchronized LTX2 workflows infer exact modes and fields', () => {
  const node = (id, module, action, studioRole, params = {}) => ({
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { type: 'custom', module, action, studioRole, studioOwned: true, params },
  });
  const outpaint = workflowInferenceModule.inferStudioFormFromWorkflow([
    node('pipeline', 'modules.DiffusersImage', 'LoadPipeline', 'diffusersImagePipeline', {
      pipeline_class: { value: 'ChromaInpaintPipeline' },
    }),
    node('image', 'modules.Image', 'Load', 'loadImage', { file: { value: ['source.png'] } }),
    node('canvas', 'modules.DiffusersImage', 'OutpaintCanvas', 'outpaintCanvas', {
      left: { value: 320 },
      right: { value: 128 },
      top: { value: 16 },
      bottom: { value: 32 },
      overlap: { value: 20 },
      feather: { value: 6 },
      fill_color: { value: 'black' },
    }),
    node('inpaint', 'modules.DiffusersImage', 'Inpaint', 'diffusersImageInpaint', {
      prompt: { value: 'Extend the stone terrace' },
    }),
  ]);
  assert.equal(outpaint.modelType, 'ChromaInpaintPipeline');
  assert.equal(outpaint.mode, 'outpaint');
  assert.deepEqual(outpaint.referenceImages, ['source.png']);
  assert.equal(outpaint.outpaintLeft, 320);
  assert.equal(outpaint.outpaintRight, 128);
  assert.equal(outpaint.outpaintOverlap, 20);
  assert.equal(outpaint.prompt, 'Extend the stone terrace');

  const ltx2 = workflowInferenceModule.inferStudioFormFromWorkflow([
    node('pipeline', 'modules.DiffusersVideo', 'LoadPipeline', 'wanPipeline', {
      pipeline_class: { value: 'LTX2Pipeline' },
    }),
    node('generate', 'modules.DiffusersVideo', 'GenerateVideoAudio', 'wanGenerate', {
      prompt: { value: 'A synchronized musical clockwork scene' },
      num_frames: { value: 121 },
      frame_rate: { value: 24 },
    }),
    node('export', 'modules.Video', 'ExportWithAudio', 'videoExport'),
  ]);
  assert.equal(ltx2.modelType, 'LTX2Pipeline');
  assert.equal(ltx2.mode, 'text_to_video');
  assert.equal(ltx2.numFrames, 121);
  assert.equal(ltx2.fps, 24);
});

test('direct layers and dual-video workflows infer generic fields and block incomplete inputs', () => {
  const node = (id, module, action, studioRole, params = {}) => ({
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { type: 'custom', module, action, studioRole, studioOwned: true, params },
  });
  const combinedNodes = [
    node('pipeline', 'modules.DiffusersVideo', 'LoadPipeline', 'wanPipeline', {
      pipeline_class: { value: 'AnimateDiffVideoToVideoControlNetPipeline' },
    }),
    node('source', 'modules.Video', 'Load', 'loadVideo', { file: { value: 'source.mp4' } }),
    node('control', 'modules.Video', 'Load', 'loadControlVideo', { file: { value: 'control.mp4' } }),
    node('generate', 'modules.DiffusersVideo', 'Generate', 'wanGenerate', {
      prompt: { value: 'Follow the edge motion' },
      conditioning_scale: { value: 0.75 },
    }),
  ];
  const combined = workflowInferenceModule.inferStudioFormFromWorkflow(combinedNodes);
  assert.equal(combined.modelType, 'AnimateDiffVideoToVideoControlNetPipeline');
  assert.equal(combined.mode, 'control_video_to_video');
  assert.equal(combined.sourceVideo, 'source.mp4');
  assert.equal(combined.controlVideo, 'control.mp4');
  assert.equal(combined.conditioningScale, 0.75);

  const layered = workflowInferenceModule.inferStudioFormFromWorkflow([
    node('pipeline', 'modules.DiffusersImage', 'LoadPipeline', 'diffusersImagePipeline', {
      pipeline_class: { value: 'QwenImageLayeredPipeline' },
    }),
    node('image', 'modules.Image', 'Load', 'loadImage', { file: { value: ['portrait.png'] } }),
    node('layers', 'modules.DiffusersImage', 'LayerDecompose', 'diffusersImageLayerDecompose', {
      resolution: { value: 640 },
      layers: { value: 6 },
    }),
  ]);
  assert.equal(layered.modelType, 'QwenImageLayeredPipeline');
  assert.equal(layered.mode, 'layer_decomposition');
  assert.deepEqual(layered.referenceImages, ['portrait.png']);
  assert.equal(layered.width, 640);
  assert.equal(layered.height, 640);
  assert.equal(layered.layers, 6);

  const previousStudio = studioStoreModule.useStudioStore.getState();
  const previousNodes = nodesStoreModule.useNodesStore.getState();
  const previousFlow = flowStoreModule.useFlowStore.getState();
  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [],
      studioModelCapabilitiesAuthoritative: false,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });
    studioStoreModule.useStudioStore.setState({
      form: { ...combined, sourceVideo: '', controlVideo: '' },
      graphBinding: null,
      graphFinalization: null,
    });
    const videoMessages = runReadinessModule
      .collectRunReadinessIssues({ sid: 'contract-test', isConnected: true })
      .filter(({ message }) => /source video|control video/i.test(message))
      .map(({ message }) => message);
    assert.equal(
      videoMessages.some((message) => /source video/i.test(message)),
      true,
    );
    assert.equal(
      videoMessages.some((message) => /control video/i.test(message)),
      true,
    );

    studioStoreModule.useStudioStore.setState({ form: { ...layered, width: 768, height: 768, layers: 11 } });
    const layerMessages = runReadinessModule
      .collectRunReadinessIssues({ sid: 'contract-test', isConnected: true })
      .map(({ message }) => message);
    assert.equal(
      layerMessages.some((message) => /layer resolution/i.test(message)),
      true,
    );
    assert.equal(
      layerMessages.some((message) => /layer count/i.test(message)),
      true,
    );
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousNodes.studioModelCapabilities,
      studioModelCapabilitiesAuthoritative: previousNodes.studioModelCapabilitiesAuthoritative,
    });
    studioStoreModule.useStudioStore.setState({
      form: previousStudio.form,
      graphBinding: previousStudio.graphBinding,
      graphFinalization: previousStudio.graphFinalization,
    });
    flowStoreModule.useFlowStore.setState({ nodes: previousFlow.nodes, edges: previousFlow.edges });
  }
});

test('Allegro exposes its bounded native remote-only source contract', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.AllegroPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_video', 'AllegroPipeline');
  assert.equal(profile.defaultRepo, profilesModule.ALLEGRO_REPO);
  assert.equal(profilesModule.ALLEGRO_REVISION, 'c1b9207bb5cb79e2aa08f3d139c17d26c0de55b6');
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.defaultDtype, 'bfloat16');
  assert.equal(profile.outputKind, 'video');
  assert.equal(profile.recommendedMaxSequenceLength, 512);
  assert.equal(profile.offloadSupport.default, 'sequential_cpu');
  assert.equal(form.width, 1280);
  assert.equal(form.height, 720);
  assert.equal(form.steps, 100);
  assert.equal(form.guidanceScale, 7.5);
  assert.equal(form.numFrames, 88);
  assert.equal(form.fps, 15);
});

test('Latte exposes its bounded native remote-only source contract', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.LattePipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_video', 'LattePipeline');
  assert.equal(profile.defaultRepo, profilesModule.LATTE_REPO);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.defaultDtype, 'float16');
  assert.equal(profile.outputKind, 'video');
  assert.equal(profile.recommendedMaxSequenceLength, 120);
  assert.equal(profile.offloadSupport.default, 'sequential_cpu');
  assert.equal(form.width, 512);
  assert.equal(form.height, 512);
  assert.equal(form.steps, 50);
  assert.equal(form.guidanceScale, 7.5);
  assert.equal(form.numFrames, 16);
  assert.equal(form.fps, 8);
});

test('Mochi exposes its bounded native remote-only source contract', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.MochiPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_video', 'MochiPipeline');
  assert.equal(profile.defaultRepo, profilesModule.MOCHI_REPO);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.defaultDtype, 'bfloat16');
  assert.equal(profile.outputKind, 'video');
  assert.equal(profile.recommendedMaxSequenceLength, 256);
  assert.equal(profile.offloadSupport.default, 'sequential_cpu');
  assert.equal(form.width, 848);
  assert.equal(form.height, 480);
  assert.equal(form.steps, 64);
  assert.equal(form.guidanceScale, 4.5);
  assert.equal(form.numFrames, 31);
  assert.equal(form.fps, 30);
});

test('SANA-Video exposes bounded native text and image remote-only contracts', () => {
  for (const [modelType, mode, imageConditioned] of [
    ['SanaVideoPipeline', 'text_to_video', false],
    ['SanaImageToVideoPipeline', 'image_to_video', true],
  ]) {
    const profile = profilesModule.STUDIO_MODEL_PROFILES[modelType];
    const form = profilesModule.getFormDefaultsForMode(mode, modelType);
    assert.equal(profile.defaultRepo, profilesModule.SANA_VIDEO_REPO);
    assert.equal(profile.catalogVisibility, 'workflowOnly');
    assert.equal(profile.defaultDtype, 'bfloat16');
    assert.equal(profile.outputKind, 'video');
    assert.equal(profile.recommendedMaxSequenceLength, 300);
    assert.equal(profile.offloadSupport.default, 'sequential_cpu');
    assert.equal(profile.supportsImageInput, imageConditioned);
    assert.equal(form.width, 832);
    assert.equal(form.height, 480);
    assert.equal(form.steps, 50);
    assert.equal(form.guidanceScale, 6);
    assert.equal(form.numFrames, 81);
    assert.equal(form.fps, 16);
  }
});

test('canonical Shap-E graphs infer the rendered 3D form', async () => {
  const graph = JSON.parse(
    await readFile(path.resolve(ROOT, '../MoDiff/data/graphs/studio/shap-e-pipeline/text-to-3d.json'), 'utf8'),
  );
  const form = workflowInferenceModule.inferStudioFormFromWorkflow(graph.nodes);
  assert.equal(form.modelType, 'ShapEPipeline');
  assert.equal(form.mode, 'text_to_3d');
  assert.equal(form.width, 256);
  assert.equal(form.height, 256);
  assert.equal(form.fps, 12);
});

test('LCM DreamShaper exposes exact generic text and image-edit recipes', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.LatentConsistencyModelPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'LatentConsistencyModelPipeline');
  const editForm = profilesModule.getFormDefaultsForMode('edit_image', 'LatentConsistencyModelPipeline');
  assert.equal(profile.defaultRepo, profilesModule.LCM_DREAMSHAPER_REPO);
  assert.equal(profile.defaultDtype, 'float32');
  assert.equal(profile.supportsNegativePrompt, false);
  assert.equal(profile.supportsImageInput, true);
  assert.deepEqual(profile.modes, ['text_to_image', 'edit_image']);
  assert.deepEqual(profile.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.equal(form.width, 512);
  assert.equal(form.height, 512);
  assert.equal(form.steps, 4);
  assert.equal(form.guidanceScale, 8.5);
  assert.equal(editForm.strength, 0.8);
});

test('Stable Diffusion PAG exposes generic base and ControlNet controls over the pinned 1.5 base', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.StableDiffusionPAGPipeline;
  const form = profilesModule.getFormDefaultsForMode('text_to_image', 'StableDiffusionPAGPipeline');
  const editForm = profilesModule.getFormDefaultsForMode('edit_image', 'StableDiffusionPAGPipeline');
  const inpaintForm = profilesModule.getFormDefaultsForMode('inpaint', 'StableDiffusionPAGPipeline');
  assert.equal(profile.defaultRepo, profilesModule.SD15_BASE_REPO);
  assert.equal(profile.defaultDtype, 'float32');
  assert.equal(profile.supportsImageInput, true);
  assert.equal(profile.supportsMask, true);
  assert.deepEqual(profile.modes, ['text_to_image', 'edit_image', 'inpaint', 'control_image', 'control_inpaint']);
  assert.deepEqual(profile.modeRequirements.edit_image.requiredImages, ['referenceImages']);
  assert.deepEqual(profile.modeRequirements.inpaint.requiredImages, ['referenceImages', 'maskImage']);
  assert.equal(form.width, 512);
  assert.equal(form.height, 512);
  assert.equal(form.steps, 30);
  assert.equal(form.guidanceScale, 7.5);
  assert.equal(form.pagScale, 3);
  assert.equal(form.pagAdaptiveScale, 0);
  assert.equal(editForm.strength, 0.8);
  assert.equal(inpaintForm.strength, 0.8);
});

test('generic control workflows infer source, mask, and control images by role', () => {
  const node = (id, module, action, studioRole, params = {}) => ({
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module,
      action,
      studioRole,
      studioOwned: true,
      params,
    },
  });
  const image = (id, studioRole, file) => node(id, 'modules.Image', 'Load', studioRole, { file: { value: file } });

  for (const testCase of [
    {
      modelType: 'FluxCannyPipeline',
      mode: 'control_edit_image',
      action: 'ControlEdit',
      actionRole: 'diffusersImageControlEdit',
      images: [image('source', 'loadImage', 'source-edit.png'), image('control', 'loadControlImage', 'canny.png')],
      expectedMask: '',
    },
    {
      modelType: 'StableDiffusionPAGPipeline',
      mode: 'control_inpaint',
      action: 'ControlInpaint',
      actionRole: 'diffusersImageControlInpaint',
      images: [
        image('source', 'loadImage', 'source-inpaint.png'),
        image('mask', 'loadMask', 'mask.png'),
        image('control', 'loadControlImage', 'edges.png'),
      ],
      expectedMask: 'mask.png',
    },
  ]) {
    const nodes = [
      node('pipeline', 'modules.DiffusersImage', 'LoadPipeline', 'diffusersImagePipeline', {
        model_type: { value: testCase.modelType },
      }),
      ...testCase.images,
      node('action', 'modules.DiffusersImage', testCase.action, testCase.actionRole, {
        prompt: { value: 'Preserve the subject' },
        strength: { value: 0.65 },
        conditioning_scale: { value: 0.9 },
      }),
    ];

    const form = workflowInferenceModule.inferStudioFormFromWorkflow(nodes);
    assert.equal(form.modelType, testCase.modelType);
    assert.equal(form.mode, testCase.mode);
    assert.deepEqual(form.referenceImages, [testCase.images[0].data.params.file.value]);
    assert.equal(form.maskImage, testCase.expectedMask);
    assert.equal(form.controlImage, testCase.images.at(-1).data.params.file.value);
    assert.equal(form.strength, 0.65);
    assert.equal(form.conditioningScale, 0.9);
  }
});

test('Marigold depth exposes a generic source-to-prediction-map profile', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.MarigoldDepthPipeline;
  const form = profilesModule.getFormDefaultsForMode('depth_estimation', 'MarigoldDepthPipeline');
  assert.equal(profilesModule.getDefaultModelForMode('depth_estimation'), 'MarigoldDepthPipeline');
  assert.equal(profile.defaultRepo, profilesModule.MARIGOLD_DEPTH_LCM_REPO);
  assert.equal(profile.defaultDtype, 'float32');
  assert.equal(profile.supportsNegativePrompt, false);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.deepEqual(profile.modes, ['depth_estimation']);
  assert.deepEqual(profile.modeRequirements.depth_estimation.requiredImages, ['referenceImages']);
  assert.equal(form.steps, 1);
  assert.equal(form.guidanceScale, 0);
  assert.equal(form.processingResolution, 768);
  assert.equal(form.matchInputResolution, true);
});

test('Whisper Tiny exposes generic transcription and translation contracts', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.HuggingFaceSpeechRecognitionModel;
  const transcription = profilesModule.getFormDefaultsForMode('speech_to_text', 'HuggingFaceSpeechRecognitionModel');
  const translation = profilesModule.getFormDefaultsForMode('speech_translation', 'HuggingFaceSpeechRecognitionModel');
  assert.equal(profilesModule.getDefaultModelForMode('speech_to_text'), 'HuggingFaceSpeechRecognitionModel');
  assert.equal(profile.defaultRepo, profilesModule.WHISPER_TINY_REPO);
  assert.equal(profile.defaultDtype, 'float32');
  assert.equal(profile.runtimeKind, 'transformers');
  assert.equal(profile.isDiffusersBacked, false);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.outputKind, 'json');
  assert.deepEqual(profile.modes, ['speech_to_text', 'speech_translation']);
  assert.deepEqual(profile.modeRequirements.speech_to_text.requiredAudio, ['sourceAudio']);
  assert.equal(transcription.speechTimestamps, 'segment');
  assert.equal(transcription.speechChunkSeconds, 30);
  assert.equal(transcription.speechStrideSeconds, 5);
  assert.equal(translation.mode, 'speech_translation');
});

test('Janus stays Expert-only with a pinned run acknowledgement and generic mode inference', () => {
  const modelType = 'HuggingFaceAnyToAnyModel';
  const profile = profilesModule.STUDIO_MODEL_PROFILES[modelType];
  assert.equal(profile.defaultRepo, profilesModule.JANUS_PRO_1B_REPO);
  assert.deepEqual(profile.revisionCandidates, [profilesModule.JANUS_PRO_1B_REVISION]);
  assert.equal(profile.runtimeKind, 'transformers');
  assert.equal(profile.isDiffusersBacked, false);
  assert.equal(profile.catalogVisibility, 'workflowOnly');
  assert.equal(profile.executionStatus, 'expert_only');
  assert.equal(profile.autoEligible, false);
  assert.equal(profile.galleryEligible, false);
  assert.deepEqual(profile.modeOutputKinds, {
    text_generation: 'json',
    image_to_text: 'json',
    text_to_image: 'image',
  });
  assert.deepEqual(profile.modeRequirements.image_to_text.requiredImages, ['referenceImages']);

  const policies = modelUsagePoliciesModule.acknowledgementRequiredForModelRun({
    modelType,
    mode: 'text_to_image',
  });
  assert.equal(policies.length, 1);
  assert.equal(policies[0].repository, profilesModule.JANUS_PRO_1B_REPO);
  assert.equal(policies[0].revision, profilesModule.JANUS_PRO_1B_REVISION);
  assert.equal(policies[0].reviewedRevision, profilesModule.JANUS_PRO_1B_REVISION);
  assert.equal(policies[0].useScope, 'license_review_required');
  assert.match(policies[0].shortSummary, /not product legal approval/i);
  assert.match(policies[0].termsUrl, /LICENSE-MODEL$/);
  assert.match(modelUsagePoliciesModule.usagePolicyAcknowledgementKey(policies), /^terms-v2:[0-9a-f]{8}$/);
  assert.deepEqual(
    modelUsagePoliciesModule.acknowledgementRequiredForModelRun({
      modelType: 'HuggingFaceTextGenerationModel',
      mode: 'text_generation',
    }),
    [],
  );

  const node = (id, action, studioRole, params = {}) => ({
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: action === 'Load' ? 'modules.Image' : 'modules.HuggingFaceTransformers',
      action,
      studioRole,
      studioOwned: true,
      params,
    },
  });
  for (const [mode, generationMode, imagePath] of [
    ['text_generation', 'text', null],
    ['image_to_text', 'text', 'source.png'],
    ['text_to_image', 'image', null],
  ]) {
    const nodes = [
      node('model', 'LoadAnyToAnyModel', 'transformersAnyToAnyModel', {
        model_id: { value: profilesModule.JANUS_PRO_1B_REPO },
      }),
      ...(imagePath ? [node('source', 'Load', 'loadImage', { file: { value: imagePath } })] : []),
      node('generate', 'GenerateAnyToAny', 'transformersAnyToAnyGenerate', {
        prompt: { value: 'A small red fox' },
        generation_mode: { value: generationMode },
      }),
    ];
    const form = workflowInferenceModule.inferStudioFormFromWorkflow(nodes);
    assert.equal(form.modelType, modelType);
    assert.equal(form.mode, mode);
    assert.equal(form.prompt, 'A small red fox');
    assert.deepEqual(form.referenceImages, imagePath ? [imagePath] : []);
  }
});

test('canonical Whisper graphs infer their speech form without model-specific graph rewrites', async () => {
  for (const [file, mode] of [
    ['speech-to-text.json', 'speech_to_text'],
    ['speech-translation.json', 'speech_translation'],
  ]) {
    const graph = JSON.parse(
      await readFile(
        path.resolve(ROOT, '../MoDiff/data/graphs/studio/hugging-face-speech-recognition-model', file),
        'utf8',
      ),
    );
    const form = workflowInferenceModule.inferStudioFormFromWorkflow(graph.nodes);
    assert.equal(form.modelType, 'HuggingFaceSpeechRecognitionModel');
    assert.equal(form.mode, mode);
    assert.equal(form.speechTimestamps, 'segment');
    assert.equal(form.speechChunkSeconds, 30);
    assert.equal(form.speechStrideSeconds, 5);
  }
});

test('run readiness blocks a model and task pair omitted by authoritative backend capabilities', () => {
  const previousCapabilities = nodesStoreModule.useNodesStore.getState().studioModelCapabilities;
  const previousAuthoritative = nodesStoreModule.useNodesStore.getState().studioModelCapabilitiesAuthoritative;
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;

  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image', 'control_image'],
          runnableModes: ['text_to_image'],
        },
      ],
      studioModelCapabilitiesAuthoritative: true,
    });
    studioStoreModule.useStudioStore.setState({
      form: {
        ...previousForm,
        mode: 'control_image',
        modelType: 'QwenImageModularPipeline',
        resourceMode: 'expert',
      },
      graphBinding: null,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });

    const issue = runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'backend_mode_unsupported');
    assert.equal(issue?.blocking, true);
    assert.equal(issue?.message, 'Qwen-Image-2512 does not support Control image on the connected backend.');
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousCapabilities,
      studioModelCapabilitiesAuthoritative: previousAuthoritative,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

test('an imported stale Qwen Edit Plus inpaint form stays blocked by backend capability truth', () => {
  const previousCapabilities = nodesStoreModule.useNodesStore.getState().studioModelCapabilities;
  const previousAuthoritative = nodesStoreModule.useNodesStore.getState().studioModelCapabilitiesAuthoritative;
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;

  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [
        {
          modelType: 'QwenImageEditPlusModularPipeline',
          // Preserve a stale legacy metadata claim to prove schema-v2
          // runnableModes remains authoritative for an imported form.
          modes: ['edit_image', 'multi_image_reference_edit', 'inpaint'],
          runnableModes: ['edit_image', 'multi_image_reference_edit'],
        },
      ],
      studioModelCapabilitiesAuthoritative: true,
    });
    studioStoreModule.useStudioStore.setState({
      form: {
        ...previousForm,
        mode: 'inpaint',
        modelType: 'QwenImageEditPlusModularPipeline',
        resourceMode: 'auto',
      },
      graphBinding: null,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });

    const issue = runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'backend_mode_unsupported');
    assert.equal(issue?.blocking, true);
    assert.equal(issue?.message, 'Qwen-Image-Edit-2511 does not support Inpaint on the connected backend.');
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousCapabilities,
      studioModelCapabilitiesAuthoritative: previousAuthoritative,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

function optionalRequirement(overrides = {}) {
  return {
    schemaVersion: 1,
    delivery: 'base',
    requiredNow: false,
    profileIds: ['huggingface-transformers-peft-5.14.1-0.20.0'],
    executionProfileIds: ['qwen-image:t2i-direct'],
    state: 'base_satisfied',
    reason: 'base_runtime_contract',
    ...overrides,
  };
}

function qualifiedOptionalRuntimeCatalog() {
  const profileId = 'huggingface-transformers-peft-5.14.1-0.20.0';
  const specDigest = `sha256:${'1'.repeat(64)}`;
  return {
    schemaVersion: 1,
    processLoadStatus: 'active',
    activeOptionalRuntimeSpecs: [{ profileId, specDigest }],
    profiles: [
      {
        id: profileId,
        label: 'Hugging Face Transformers + PEFT',
        specDigest,
        contractState: 'qualified',
        cutoverReady: true,
        installActionAvailable: true,
        activationAvailable: true,
        status: 'present_unqualified',
        overlayStatus: 'active',
      },
    ],
  };
}

test('optional runtime readiness is exact-mode scoped and base delivery stays neutral', () => {
  const previousNodesState = nodesStoreModule.useNodesStore.getState();
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;
  const base = optionalRequirement();
  const required = optionalRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    executionProfileIds: ['qwen-image:control'],
    state: 'missing',
    reason: 'optional_runtime_missing',
  });
  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilitiesAuthoritative: true,
      optionalRuntimeCatalog: null,
      studioModelCapabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image', 'control_image'],
          runnableModes: ['text_to_image', 'control_image'],
          executionProfiles: [
            { id: 'qwen-image:t2i-direct', modes: ['text_to_image'], optionalRuntimeRequirement: base },
            { id: 'qwen-image:control', modes: ['control_image'], optionalRuntimeRequirement: required },
          ],
        },
      ],
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });
    studioStoreModule.useStudioStore.setState({
      form: { ...previousForm, modelType: 'QwenImageModularPipeline', mode: 'text_to_image', resourceMode: 'expert' },
      graphBinding: null,
    });
    let issue = runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'optional_runtime_required');
    assert.equal(issue, undefined, 'base-delivered exact mode must ignore missing overlay status');

    studioStoreModule.useStudioStore.setState({
      form: { ...previousForm, modelType: 'QwenImageModularPipeline', mode: 'control_image', resourceMode: 'expert' },
    });
    issue = runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'optional_runtime_required');
    assert.equal(issue?.blocking, true);
    assert.equal(issue?.action, 'open_setup');
    assert.match(issue?.message ?? '', /reviewed optional runtime/i);
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousNodesState.studioModelCapabilities,
      studioModelCapabilitiesAuthoritative: previousNodesState.studioModelCapabilitiesAuthoritative,
      optionalRuntimeCatalog: previousNodesState.optionalRuntimeCatalog,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

test('optional runtime readiness mirrors repository disambiguation for shared loaders', () => {
  const nodesState = nodesStoreModule.useNodesStore.getState();
  const studioState = studioStoreModule.useStudioStore.getState();
  const flowState = flowStoreModule.useFlowStore.getState();
  const runtime = (id, delivery, state, reason) =>
    optionalRequirement({
      delivery,
      requiredNow: delivery === 'optional_overlay',
      executionProfileIds: [id],
      state,
      reason,
    });
  const base = runtime('flux-schnell:direct', 'base', 'base_satisfied', 'base_runtime_contract');
  const required = runtime('flux-dev:direct', 'optional_overlay', 'active', 'optional_runtime_active');
  const executionProfile = (id, modelType, repo, requirement) => ({
    id,
    model_type: modelType,
    modes: ['text_to_image'],
    loader_module: 'modules.DiffusersImage',
    loader_action: 'LoadPipeline',
    execution_path: 'direct-diffusers-image',
    backend_path: 'modules.DiffusersImage.LoadPipeline',
    pipeline_class: 'FluxPipeline',
    default_repo: repo,
    fallback_repo: null,
    compatible_repos: [],
    optionalRuntimeRequirement: requirement,
  });
  const capability = (modelType, executionProfile, requirement) => ({
    modelType,
    modes: ['text_to_image'],
    runnableModes: ['text_to_image'],
    optionalRuntimeRequirement: requirement,
    executionProfiles: [executionProfile],
  });
  const schnell = executionProfile(
    'flux-schnell:direct',
    'FluxSchnellPipeline',
    'black-forest-labs/FLUX.1-schnell',
    base,
  );
  const dev = executionProfile('flux-dev:direct', 'FluxDevPipeline', 'black-forest-labs/FLUX.1-dev', required);
  const loader = (modelId) => ({
    id: 'flux-loader',
    data: {
      type: 'custom',
      module: 'modules.DiffusersImage',
      action: 'LoadPipeline',
      params: { pipeline_class: { value: 'FluxPipeline' }, model_id: { value: modelId } },
    },
  });
  const optionalIssue = () =>
    runReadinessModule
      .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
      .find((item) => item.code === 'optional_runtime_required');
  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilitiesAuthoritative: true,
      optionalRuntimeCatalog: qualifiedOptionalRuntimeCatalog(),
      discoveryRequests: {
        ...nodesState.discoveryRequests,
        capabilities: { status: 'success', error: null, requestId: 1 },
        optionalRuntimes: { status: 'success', error: null, requestId: 1 },
      },
      studioModelCapabilities: [
        capability('FluxSchnellPipeline', schnell, base),
        capability('FluxDevPipeline', dev, required),
      ],
    });
    studioStoreModule.useStudioStore.setState({
      form: { ...studioState.form, modelType: 'FluxDevPipeline', mode: 'text_to_image', resourceMode: 'expert' },
      graphBinding: {
        mode: 'text_to_image',
        modelType: 'FluxDevPipeline',
        nodes: { diffusersImagePipeline: 'flux-loader' },
        managedNodeIds: ['flux-loader'],
        managedEdgeIds: [],
        fingerprint: 'repo-aware-runtime-test',
      },
    });

    flowStoreModule.useFlowStore.setState({ nodes: [loader('black-forest-labs/FLUX.1-dev')], edges: [] });
    assert.equal(optionalIssue(), undefined);
    flowStoreModule.useFlowStore.setState({
      nodes: [loader({ source: 'local', value: 'black-forest-labs/FLUX.1-dev' })],
    });
    assert.equal(optionalIssue()?.blocking, true, 'local selections cannot prove a shared loader profile');
    flowStoreModule.useFlowStore.setState({ nodes: [loader('example/unknown-flux')] });
    assert.equal(optionalIssue()?.blocking, true, 'unknown Hub repositories remain ambiguous');
    flowStoreModule.useFlowStore.setState({ nodes: [loader('black-forest-labs/FLUX.1-schnell')] });
    assert.equal(optionalIssue(), undefined, 'a known sibling repository uses that sibling runtime delivery');

    const baseDev = { ...dev, optionalRuntimeRequirement: { ...base, executionProfileIds: ['flux-dev:direct'] } };
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [
        capability('FluxSchnellPipeline', schnell, base),
        capability('FluxDevPipeline', baseDev, baseDev.optionalRuntimeRequirement),
      ],
    });
    flowStoreModule.useFlowStore.setState({ nodes: [loader('example/unknown-flux')] });
    assert.equal(optionalIssue(), undefined, 'ambiguous base-delivered loaders remain readiness-neutral');
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: nodesState.studioModelCapabilities,
      studioModelCapabilitiesAuthoritative: nodesState.studioModelCapabilitiesAuthoritative,
      optionalRuntimeCatalog: nodesState.optionalRuntimeCatalog,
      discoveryRequests: nodesState.discoveryRequests,
    });
    studioStoreModule.useStudioStore.setState({ form: studioState.form, graphBinding: studioState.graphBinding });
    flowStoreModule.useFlowStore.setState({ nodes: flowState.nodes, edges: flowState.edges });
  }
});

test('a required runtime becomes ready only with the exact qualified active catalog', () => {
  const previousNodesState = nodesStoreModule.useNodesStore.getState();
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;
  const required = optionalRequirement({
    delivery: 'optional_overlay',
    requiredNow: true,
    state: 'active',
    reason: 'optional_runtime_active',
  });
  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilitiesAuthoritative: true,
      optionalRuntimeCatalog: qualifiedOptionalRuntimeCatalog(),
      discoveryRequests: {
        ...previousNodesState.discoveryRequests,
        capabilities: { status: 'success', error: null, requestId: 1 },
        optionalRuntimes: { status: 'success', error: null, requestId: 1 },
      },
      studioModelCapabilities: [
        {
          modelType: 'QwenImageModularPipeline',
          modes: ['text_to_image'],
          runnableModes: ['text_to_image'],
          optionalRuntimeRequirement: required,
          executionProfiles: [
            { id: 'qwen-image:t2i-direct', modes: ['text_to_image'], optionalRuntimeRequirement: required },
          ],
        },
      ],
    });
    studioStoreModule.useStudioStore.setState({
      form: { ...previousForm, modelType: 'QwenImageModularPipeline', mode: 'text_to_image', resourceMode: 'expert' },
      graphBinding: null,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });

    const optionalIssue = () =>
      runReadinessModule
        .collectRunReadinessIssues({ sid: 'test-session', isConnected: true })
        .find((item) => item.code === 'optional_runtime_required');
    const setDiscovery = (key, status) => {
      const discoveryRequests = nodesStoreModule.useNodesStore.getState().discoveryRequests;
      nodesStoreModule.useNodesStore.setState({
        discoveryRequests: { ...discoveryRequests, [key]: { status, error: null, requestId: 2 } },
      });
    };
    assert.equal(optionalIssue(), undefined);
    const activeCapability = nodesStoreModule.useNodesStore.getState().studioModelCapabilities[0];
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [
        {
          ...activeCapability,
          executionProfiles: activeCapability.executionProfiles.map((profile) => ({
            ...profile,
            modes: ['control_image'],
          })),
        },
      ],
    });
    assert.equal(optionalIssue()?.blocking, true, 'present execution profiles require an exact selected-mode match');
    nodesStoreModule.useNodesStore.setState({ studioModelCapabilities: [activeCapability] });
    assert.equal(optionalIssue(), undefined);
    for (const key of ['capabilities', 'optionalRuntimes']) {
      for (const status of ['loading', 'error']) {
        setDiscovery(key, status);
        assert.equal(optionalIssue()?.blocking, true, `${key} ${status} must make retained runtime status stale`);
        setDiscovery(key, 'success');
        assert.equal(optionalIssue(), undefined);
      }
    }
    nodesStoreModule.useNodesStore.setState({ optionalRuntimeCatalog: null });
    assert.equal(optionalIssue()?.blocking, true, 'missing or stale status must restore the blocker');
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousNodesState.studioModelCapabilities,
      studioModelCapabilitiesAuthoritative: previousNodesState.studioModelCapabilitiesAuthoritative,
      optionalRuntimeCatalog: previousNodesState.optionalRuntimeCatalog,
      discoveryRequests: previousNodesState.discoveryRequests,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

test('Intel XPU is preferred over CPU while compatibility remains backend-owned', () => {
  const runtime = {
    packages: {
      torch: {
        xpu_available: true,
        xpu_devices: [
          {
            index: 0,
            name: 'Intel Arc Graphics',
            total_memory: 12 * 1024 ** 3,
            memory_free_bytes: 10 * 1024 ** 3,
            memory_kind: 'shared',
          },
        ],
      },
    },
  };
  assert.equal(runReadinessModule.getPreferredRuntimeDevice(runtime), 'xpu:0');
  assert.equal(runReadinessModule.runtimeDeviceIsAvailable(runtime, 'xpu:0'), true);
  const compatibility = autoResourceModule.autoResourceCompatibility({
    schemaVersion: 2,
    compatibility: {
      state: 'ready',
      severity: 'success',
      code: 'auto_recipe_ready',
      summary: 'Ready with local Auto recipe',
      detail: 'The backend qualified Intel XPU for this recipe.',
      action: null,
      source: 'backend_auto_planner',
    },
  });
  assert.equal(compatibility.state, 'ready');
  assert.match(compatibility.detail, /backend qualified Intel XPU/);
});

after(async () => {
  await server?.close();
});

test('template runtime estimates use only stable hardware-matched local history', () => {
  assert.equal(autoResourceModule.localRuntimeEstimate(null), null);
  assert.equal(
    autoResourceModule.localRuntimeEstimate({
      selectedCandidate: {
        id: 'unmeasured',
        successHistory: null,
      },
    }),
    null,
  );

  const measured = autoResourceModule.localRuntimeEstimate({
    selectedCandidate: {
      id: 'measured-here',
      successHistory: {
        successCount: 1,
        bestElapsedSeconds: 632.4,
        lastMeasurement: { elapsedSeconds: 632.4 },
      },
    },
  });
  assert.equal(measured.label, '~5 min–22 min locally');
  assert.equal(measured.observedSeconds, 632.4);
  assert.match(measured.title, /1 matching successful local run/);

  assert.equal(
    autoResourceModule.localRuntimeEstimate({
      selectedCandidate: {
        id: 'unstable-cold-warm-history',
        successHistory: {
          successCount: 2,
          bestElapsedSeconds: 30,
          lastMeasurement: { elapsedSeconds: 632.4 },
        },
      },
    }),
    null,
    'an astronomically wide local history must be hidden instead of presented as a prediction',
  );
});

test('template gallery manifest parser validates every entry and rejects unsafe asset paths', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'public', 'template-gallery', 'manifest.json'), 'utf8'));
  const parsed = templateExactnessModule.parseTemplateGalleryManifest(manifest);
  assert.equal(parsed.examples.length, manifest.examples.length);
  assert.throws(
    () => templateExactnessModule.parseTemplateGalleryManifest({ ...manifest, examples: [null] }),
    /example 1 is invalid/i,
  );
  assert.throws(
    () =>
      templateExactnessModule.parseTemplateGalleryManifest({
        ...manifest,
        examples: [{ ...manifest.examples[0], outputPath: '/template-gallery/../secret.json' }],
      }),
    /unsafe outputPath/i,
  );
  assert.throws(
    () =>
      templateExactnessModule.parseTemplateGalleryManifest({
        ...manifest,
        examples: [{ ...manifest.examples[0], templateId: 'unknown-template' }],
      }),
    /invalid or duplicate templateId/i,
  );
});

function runtimeStatus({ totalBytes = 24 * 1024 ** 3, freeBytes = 18 * 1024 ** 3 } = {}) {
  return {
    ready: true,
    packages: {
      torch: {
        available: true,
        cuda_available: true,
        cuda_device_count: 1,
        cuda_devices: [
          {
            index: 0,
            name: 'Mock CUDA',
            memory_total_bytes: totalBytes,
            memory_free_bytes: freeBytes,
          },
        ],
      },
    },
  };
}

function readinessContext({
  autoResourcePlan = {
    schemaVersion: 2,
    status: 'ready',
    readiness: 'ready',
    selectedCandidate: {
      id: 'unit-ready',
      loaderModule: 'modules.ModularDiffusers',
      loaderAction: 'ModelsLoader',
      executionPath: 'modular-diffusers',
      installed: true,
      proof: { status: 'declared_safe' },
    },
    candidates: [
      {
        id: 'unit-ready',
        loaderModule: 'modules.ModularDiffusers',
        loaderAction: 'ModelsLoader',
        executionPath: 'modular-diffusers',
        installed: true,
        proof: { status: 'declared_safe' },
      },
    ],
    compatibility: {
      state: 'ready',
      severity: 'success',
      code: 'auto_recipe_ready',
      summary: 'Ready with local Auto recipe',
      detail: 'Qualified by the backend test fixture.',
      action: null,
      source: 'backend_auto_planner',
    },
  },
  form,
  hfCache = [],
  modelIndexesRefreshing = false,
  nodesRegistry = {},
  runtime = runtimeStatus(),
} = {}) {
  return {
    form: form ?? profilesModule.DEFAULT_STUDIO_FORM,
    hfCache,
    localModels: [],
    modelCacheDiagnostics: { locations: [] },
    runtimeStatus: runtime,
    nodesRegistry,
    autoResourcePlan,
    modelIndexesRefreshing,
  };
}

function optionDescriptor(value, overrides = {}) {
  return {
    schemaVersion: 1,
    value,
    label: value,
    compatibility: 'compatible',
    availability: 'installed',
    installationState: 'installed',
    ...overrides,
  };
}

function canonicalModularTextToImageGraph() {
  const node = (id, module, action, params = {}) => ({
    id,
    type: 'custom',
    position: { x: id.length * 31, y: id.length * -17 },
    data: {
      type: 'custom',
      module,
      action,
      label: action,
      category: module,
      params,
    },
  });
  const nodes = [
    node('models', 'modules.ModularDiffusers', 'ModelsLoader', {
      model_type: { value: 'ZImageModularPipeline' },
      repo_id: { value: { source: 'hub', value: 'Tongyi-MAI/Z-Image-Turbo' } },
    }),
    node('prompt', 'modules.ModularDiffusers', 'EncodePrompt', {
      prompt: { value: 'A canonical imported prompt' },
    }),
    node('denoise', 'modules.ModularDiffusers', 'Denoise', {
      width: { value: 1024 },
      height: { value: 1024 },
      num_inference_steps: { value: 9 },
    }),
    node('decode', 'modules.ModularDiffusers', 'DecodeLatents'),
    node('preview', 'modules.Image', 'Preview'),
  ];
  const edge = (id, source, sourceHandle, target, targetHandle) => ({
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
  });
  return {
    nodes,
    edges: [
      edge('models-prompt', 'models', 'text_encoders', 'prompt', 'text_encoders'),
      edge('models-denoise-unet', 'models', 'unet_out', 'denoise', 'unet'),
      edge('models-decode', 'models', 'vae_out', 'decode', 'vae'),
      edge('models-denoise-scheduler', 'models', 'scheduler', 'denoise', 'scheduler'),
      edge('prompt-denoise', 'prompt', 'embeddings', 'denoise', 'embeddings'),
      edge('denoise-decode', 'denoise', 'latents', 'decode', 'latents'),
      edge('decode-preview', 'decode', 'images', 'preview', 'image'),
    ],
    viewport: { x: -140, y: 100, zoom: 0.73 },
  };
}

test('exact canonical modular imports are adopted as managed without rebuilding or moving them', () => {
  const graph = canonicalModularTextToImageGraph();
  const snapshot = workflowInferenceModule.workflowSnapshotFromGraph(
    graph,
    'smoothstep',
    profilesModule.DEFAULT_STUDIO_FORM,
  );

  assert.equal(snapshot.activeTemplateId, null);
  assert.equal(snapshot.studioForm.mode, 'text_to_image');
  assert.equal(snapshot.studioForm.modelType, 'ZImageModularPipeline');
  assert.deepEqual(
    snapshot.nodes.map((node) => node.position),
    graph.nodes.map((node) => node.position),
  );
  assert.deepEqual(snapshot.viewport, graph.viewport);
  assert.deepEqual(snapshot.studioGraphBinding?.nodes, {
    models: 'models',
    prompt: 'prompt',
    denoise: 'denoise',
    decode: 'decode',
    preview: 'preview',
  });
  assert.deepEqual(
    snapshot.studioGraphBinding?.managedNodeIds,
    graph.nodes.map((node) => node.id),
  );
  assert.deepEqual(
    snapshot.studioGraphBinding?.managedEdgeIds,
    graph.edges.map((edge) => edge.id),
  );
  assert.ok(snapshot.nodes.every((node) => node.data.studioOwned === true));
});

test('partially similar and extended graph imports remain custom', () => {
  const rewired = canonicalModularTextToImageGraph();
  rewired.edges[0].targetHandle = 'wrong_input';
  const rewiredSnapshot = workflowInferenceModule.workflowSnapshotFromGraph(
    rewired,
    'smoothstep',
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(rewiredSnapshot.studioGraphBinding, null);
  assert.ok(rewiredSnapshot.nodes.every((node) => node.data.studioRole === undefined));

  const extended = canonicalModularTextToImageGraph();
  extended.nodes.push({
    id: 'custom',
    type: 'custom',
    position: { x: 900, y: 300 },
    data: {
      type: 'custom',
      module: 'modules.Image',
      action: 'Resize',
      label: 'Resize',
      category: 'image',
      params: {},
    },
  });
  const extendedSnapshot = workflowInferenceModule.workflowSnapshotFromGraph(
    extended,
    'smoothstep',
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(extendedSnapshot.studioGraphBinding, null);
  assert.ok(extendedSnapshot.nodes.every((node) => node.data.studioRole === undefined));
});

test('device rebasing only changes declared device parameters', () => {
  const graph = {
    nodes: [
      {
        id: 'loader',
        data: {
          label: 'cpu',
          params: {
            device: { value: 'cpu:0', default: 'cpu' },
            prompt: { value: 'cpu' },
            notes: { value: ['cuda:0', { label: 'mps:0' }] },
          },
        },
      },
    ],
    metadata: { preferredLabel: 'cuda:0' },
  };

  assert.deepEqual(deviceRebaseModule.inspectGraphDeviceReferences(graph), [
    { path: 'nodes[0].data.params.device.value', device: 'cpu:0' },
    { path: 'nodes[0].data.params.device.default', device: 'cpu' },
  ]);
  const rebased = deviceRebaseModule.rebaseGraphDevices(graph, 'cuda:1');
  assert.equal(rebased.nodes[0].data.params.device.value, 'cuda:1');
  assert.equal(rebased.nodes[0].data.params.device.default, 'cuda:1');
  assert.equal(rebased.nodes[0].data.params.prompt.value, 'cpu');
  assert.deepEqual(rebased.nodes[0].data.params.notes.value, ['cuda:0', { label: 'mps:0' }]);
  assert.equal(rebased.nodes[0].data.label, 'cpu');
  assert.equal(rebased.metadata.preferredLabel, 'cuda:0');
});

test('role-marked generated Studio workflow imports retain their managed contract', () => {
  const graph = canonicalModularTextToImageGraph();
  graph.nodes = graph.nodes.map((node, index) => ({
    ...node,
    data: {
      ...node.data,
      studioOwned: true,
      studioRole: ['models', 'prompt', 'denoise', 'decode', 'preview'][index],
    },
  }));
  // A generated graph may evolve its internal edge set. Explicit Studio roles
  // are provenance, so this no longer depends on the legacy exact-edge matcher.
  graph.edges[0].targetHandle = 'dynamic_text_encoders';

  const snapshot = workflowInferenceModule.workflowSnapshotFromGraph(
    graph,
    'smoothstep',
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.deepEqual(
    snapshot.studioGraphBinding?.managedNodeIds,
    graph.nodes.map((node) => node.id),
  );
  assert.deepEqual(
    snapshot.studioGraphBinding?.managedEdgeIds,
    graph.edges.map((edge) => edge.id),
  );
  assert.equal(snapshot.nodes.find((node) => node.id === 'prompt')?.data.studioRole, 'prompt');
});

test('existing saved canonical imports are adopted during workflow-tab normalization', () => {
  const graph = canonicalModularTextToImageGraph();
  const modelNode = graph.nodes.find((node) => node.id === 'models');
  modelNode.data.params.model_type.value = 'Flux2KleinModularPipeline';
  modelNode.data.params.repo_id.value = {
    source: 'hub',
    value: 'black-forest-labs/FLUX.2-klein-4B',
  };
  const staleForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
  };
  const beforeTabs = studioStoreModule.useStudioStore.getState().workflowTabs;
  try {
    studioStoreModule.useStudioStore.getState().mergeBackendWorkflow({
      id: 'legacy-canonical-import',
      title: 'text_to_image',
      createdAt: 1,
      updatedAt: 1,
      dirty: false,
      source: 'import',
      sourceLabel: '/data/graphs/modular_diffusers/text_to_image.json',
      backendRevision: 1,
      snapshot: {
        nodes: graph.nodes,
        edges: graph.edges,
        viewport: graph.viewport,
        studioForm: staleForm,
        studioGraphBinding: null,
        selectedMode: staleForm.mode,
        activeTemplateId: null,
        sourceOutputId: null,
      },
    });

    const restored = studioStoreModule.useStudioStore
      .getState()
      .workflowTabs.find((tab) => tab.id === 'legacy-canonical-import');
    assert.ok(restored?.snapshot.studioGraphBinding);
    assert.deepEqual(restored.snapshot.studioGraphBinding.nodes, {
      models: 'models',
      prompt: 'prompt',
      denoise: 'denoise',
      decode: 'decode',
      preview: 'preview',
    });
    assert.equal(restored.snapshot.studioForm.modelType, 'Flux2KleinPipeline');
    assert.equal(restored.snapshot.studioGraphBinding.modelType, 'Flux2KleinPipeline');
    assert.ok(restored.snapshot.nodes.every((node) => node.data.studioOwned === true));
  } finally {
    studioStoreModule.useStudioStore.setState({ workflowTabs: beforeTabs });
  }
});

test('persisted inferred bindings self-repair stale model metadata from canonical nodes', () => {
  const graph = canonicalModularTextToImageGraph();
  const modelNode = graph.nodes.find((node) => node.id === 'models');
  modelNode.data.params.model_type.value = 'Flux2KleinModularPipeline';
  modelNode.data.params.repo_id.value = {
    source: 'hub',
    value: 'black-forest-labs/FLUX.2-klein-4B',
  };
  const roles = ['models', 'prompt', 'denoise', 'decode', 'preview'];
  graph.nodes = graph.nodes.map((node, index) => ({
    ...node,
    data: {
      ...node.data,
      studioOwned: true,
      studioRole: roles[index],
    },
  }));
  const staleForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
  };
  const staleInferredBinding = {
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    nodes: {
      models: 'models',
      prompt: 'prompt',
      denoise: 'denoise',
      decode: 'decode',
      preview: 'preview',
    },
    managedNodeIds: graph.nodes.map((node) => node.id),
    managedEdgeIds: graph.edges.map((edge) => edge.id),
    fingerprint: 'text_to_image:ZImageModularPipeline:auto:none',
    createdAt: 0,
    updatedAt: 0,
  };
  const beforeTabs = studioStoreModule.useStudioStore.getState().workflowTabs;
  try {
    studioStoreModule.useStudioStore.getState().mergeBackendWorkflow({
      id: 'interim-stale-canonical-import',
      title: 'text_to_image',
      createdAt: 1,
      updatedAt: 1,
      dirty: false,
      source: 'import',
      sourceLabel: '/data/graphs/modular_diffusers/text_to_image.json',
      backendRevision: 1,
      snapshot: {
        nodes: graph.nodes,
        edges: graph.edges,
        viewport: graph.viewport,
        studioForm: staleForm,
        studioGraphBinding: staleInferredBinding,
        selectedMode: staleForm.mode,
        activeTemplateId: null,
        sourceOutputId: null,
      },
    });

    const restored = studioStoreModule.useStudioStore
      .getState()
      .workflowTabs.find((tab) => tab.id === 'interim-stale-canonical-import');
    assert.equal(restored?.snapshot.studioForm.modelType, 'Flux2KleinPipeline');
    assert.equal(restored?.snapshot.studioGraphBinding?.modelType, 'Flux2KleinPipeline');
    assert.equal(restored?.snapshot.studioGraphBinding?.createdAt, 0);
    assert.equal(restored?.snapshot.studioGraphBinding?.updatedAt, 0);
  } finally {
    studioStoreModule.useStudioStore.setState({ workflowTabs: beforeTabs });
  }
});

test('template prompts are unique, detailed, and not generic placeholders', () => {
  const prompts = templatesModule.STUDIO_TEMPLATES.map((template) => template.prompt);
  assert.equal(new Set(prompts).size, prompts.length);

  const weakFragments = [
    'one clear subject, cinematic lighting',
    'a polished image with clean composition',
    'a focused concept image using the selected style',
    'a highly detailed final image, refined lighting',
  ];

  for (const template of templatesModule.STUDIO_TEMPLATES) {
    assert.ok(template.intentGroup, `${template.id} has an intent group`);
    assert.ok(template.recipeSummary, `${template.id} has a recipe summary`);
    assert.ok(template.mediaSlots?.length > 0, `${template.id} has media placeholders`);
    if (template.promptQualityPolicy === 'adapter_reference') {
      assert.equal(template.category, 'lora', `${template.id} adapter reference prompts are limited to LoRA recipes`);
      assert.ok(template.prompt.length >= 20, `${template.id} retains a meaningful adapter reference prompt`);
    } else {
      assert.ok(template.prompt.length >= 120, `${template.id} prompt is detailed`);
    }
    const audit = templateQualityModule.auditTemplateQuality(template);
    assert.deepEqual(audit.issues, [], `${template.id} has a modality-complete prompt and model-aware negative policy`);
    for (const fragment of weakFragments) {
      assert.equal(
        template.prompt.toLowerCase().includes(fragment),
        false,
        `${template.id} avoids generic prompt fragment`,
      );
    }
  }
});

test('parameter presets stay model-specific and match the installed pipeline recipes', () => {
  const preset = (id) => templatesModule.STUDIO_PRESETS.find((entry) => entry.id === id);

  assert.deepEqual(preset('fast').compatibleModelTypes, ['ZImageModularPipeline']);
  assert.equal(preset('fast').values.steps, 8);
  assert.equal(preset('fast').values.guidanceScale, 1);

  assert.ok(preset('balanced').compatibleModelTypes.every((modelType) => modelType.startsWith('QwenImage')));
  assert.equal(preset('quality').values.steps, 50);
  assert.equal(preset('quality').values.guidanceScale, 4);
  assert.equal(preset('text_accuracy').values.guidanceScale, 4);

  for (const id of ['audio_fast', 'audio_balanced', 'audio_continuation', 'audio_variation']) {
    assert.equal(preset(id).values.steps, 8, `${id} uses the ACE-Step v1.5 Turbo native step count`);
    assert.equal(preset(id).values.guidanceScale, 1, `${id} does not request ignored turbo guidance`);
  }

  assert.equal(preset('flux_fill').values.steps, 50);
  assert.equal(preset('flux_fill').values.guidanceScale, 30);
  assert.equal(preset('flux_fill').values.strength, 1);
  assert.equal(preset('flux_control').values.steps, 50);
  assert.equal(preset('flux_control').values.guidanceScale, 30);
  assert.deepEqual(preset('flux_kontext').compatibleModelTypes, ['FluxKontextPipeline']);

  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.AceStepAudioPipeline.recommendedSteps, 8);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.AceStepAudioPipeline.recommendedGuidance, 1);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.FluxFillPipeline.recommendedSteps, 50);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.FluxCannyPipeline.recommendedGuidance, 30);
});

test('LTX templates use the qualified 13B distilled execution contract', () => {
  const preset = templatesModule.STUDIO_PRESETS.find((entry) => entry.id === 'ltx_video_balanced');
  assert.ok(preset);
  assert.equal(profilesModule.LTX_VIDEO_REPO, 'Lightricks/LTX-Video-0.9.8-13B-distilled');
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.LTXVideoPipeline.recommendedSteps, 8);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.LTXVideoPipeline.recommendedGuidance, 1);
  assert.equal(preset.values.numFrames, 161);
  assert.equal(preset.values.steps, 8);
  assert.equal(preset.values.guidanceScale, 1);

  const templates = templatesModule.STUDIO_TEMPLATES.filter((entry) => entry.modelType === 'LTXVideoPipeline');
  assert.equal(templates.length, 6);
  for (const template of templates) {
    assert.equal(
      template.runtimeReuseKey,
      'ltx-0.9.8-13b-distilled-bfloat16-model-cpu',
      `${template.id} declares the shared immutable loader contract`,
    );
    assert.equal(template.negativePrompt, '', `${template.id} does not request ignored distilled CFG`);
    if (
      template.workflowBlocks?.includes('video_sequence') ||
      template.workflowBlocks?.includes('quality_video_sequence')
    ) {
      const nativeShotFrames = template.id === 'ltx_video_text_to_video' ? 121 : 81;
      assert.equal(
        template.example.lockedSettings.numFrames,
        nativeShotFrames,
        `${template.id} composes native-length shots`,
      );
      assert.ok(template.example.expectedOutput.durationSeconds >= 10, `${template.id} delivers a multi-shot sequence`);
    } else {
      const nativeFrames =
        template.id === 'ltx_video_text_to_video'
          ? 121
          : template.id === 'ltx_video_multi_reference'
            ? 81
            : template.id === 'ltx_video_video_to_video'
              ? 81
              : 161;
      assert.equal(
        template.example.lockedSettings.numFrames,
        nativeFrames,
        `${template.id} exposes its qualified native preview length`,
      );
    }
    if (template.videoDelivery === 'native') {
      assert.ok(!template.workflowBlocks?.includes('upscaler'), `${template.id} avoids framewise delivery upscaling`);
      assert.ok(template.example.expectedOutput.width >= 1216, `${template.id} uses the official native width`);
      assert.ok(template.example.expectedOutput.height >= 704, `${template.id} uses the official native height`);
    } else {
      assert.ok(template.workflowBlocks?.includes('upscaler'), `${template.id} includes delivery upscaling`);
    }
    assert.equal(template.example.lockedSettings.steps, 8, `${template.id} uses distilled steps`);
    assert.equal(template.example.lockedSettings.guidanceScale, 1, `${template.id} disables CFG`);
  }
  for (const id of ['ltx_video_long_showcase', 'wan_video_long_showcase']) {
    const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === id);
    assert.ok(template.example.expectedOutput.durationSeconds >= 20, `${id} remains a 20-30 second showcase`);
  }

  const railApproach = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'ltx_video_text_to_video');
  assert.ok(railApproach);
  assert.match(railApproach.label, /Rainy Rail Approach/);
  assert.match(railApproach.prompt, /moves rapidly forward from frame one/i);
  assert.match(railApproach.prompt, /sleepers rush out beneath the lens/i);
  assert.match(railApproach.prompt, /stone tunnel grows steadily ahead/i);
  assert.match(railApproach.prompt, /keep rail spacing, horizon, forest depth and forward direction stable/i);
  assert.deepEqual(
    {
      motionReviewProfile: railApproach.example.expectedOutput.motionReviewProfile,
      minimumMotionCoverage: railApproach.example.expectedOutput.minimumMotionCoverage,
      minimumAdjacentMotionCoverage: railApproach.example.expectedOutput.minimumAdjacentMotionCoverage,
      minimumEndToEndMotionCoverage: railApproach.example.expectedOutput.minimumEndToEndMotionCoverage,
      minimumActiveMotionWindowRatio: railApproach.example.expectedOutput.minimumActiveMotionWindowRatio,
      minimumStrongMotionWindowRatio: railApproach.example.expectedOutput.minimumStrongMotionWindowRatio,
      maximumLowMotionFrameRatio: railApproach.example.expectedOutput.maximumLowMotionFrameRatio,
    },
    {
      motionReviewProfile: 'global_camera',
      minimumMotionCoverage: 0.7,
      minimumAdjacentMotionCoverage: 0.08,
      minimumEndToEndMotionCoverage: 0.45,
      minimumActiveMotionWindowRatio: 0.9,
      minimumStrongMotionWindowRatio: 0.8,
      maximumLowMotionFrameRatio: 0.2,
    },
  );
  assert.ok(
    railApproach.prompt.trim().split(/\s+/).length <= 128,
    'the LTX rail prompt stays within the concise 128-word authoring budget',
  );
});

test('every published template exposes a hardware-aware loader reuse contract for family batches', () => {
  for (const template of templatesModule.STUDIO_TEMPLATES) {
    assert.ok(template.runtimeReuseKey, `${template.id} has a loader reuse key`);
  }

  const qwenText = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'qwen_text_rendering');
  const qwenPoster = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'qwen_poster_logo_text');
  const qwenLowVram = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'qwen_low_vram_text_rendering',
  );
  const qwenControl = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'qwen_control_image_layout');
  const qwenUpscale = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'qwen_upscale_finish');
  assert.equal(qwenText.runtimeReuseKey, qwenPoster.runtimeReuseKey);
  assert.equal(qwenText.runtimeReuseKey, qwenLowVram.runtimeReuseKey);
  assert.equal(qwenText.runtimeReuseKey, qwenUpscale.runtimeReuseKey);
  assert.match(qwenText.runtimeReuseKey, /:auto-planned:base-image$/);
  assert.match(qwenControl.runtimeReuseKey, /:auto-planned:control-image$/);
  assert.notEqual(qwenText.runtimeReuseKey, qwenControl.runtimeReuseKey);

  const fastLora = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'fast_lora');
  const zImageLora = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'z_image_lora_style');
  assert.match(fastLora.runtimeReuseKey, /:auto-planned:default$/);
  assert.equal(fastLora.runtimeReuseKey, zImageLora.runtimeReuseKey);
});

test('Qwen Edit Lightning templates retain the reviewed immutable auxiliary identity', () => {
  const templates = templatesModule.STUDIO_TEMPLATES.filter(
    (template) => template.workflowBlockSettings?.lora?.model?.value === 'lightx2v/Qwen-Image-Edit-2511-Lightning',
  );
  assert.ok(templates.length > 0);
  for (const template of templates) {
    const artifact = template.workflowBlockSettings.lora.model;
    assert.equal(artifact.revision, 'd74eba145674fd7e31b949324e148e21e7118abd', template.id);
    assert.equal(artifact.sha256, '22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f', template.id);
    assert.equal(
      template.workflowBlockSettings.lora.weightName,
      'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
      template.id,
    );
  }
});

test('native five-second video proofs follow the shared card-preview contract', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'wan_vace_outpaint_reframe');
  const base = {
    templateId: template.id,
    promptSettingsHash: templateExactnessModule.getPromptSettingsHash(
      templateExactnessModule.getTemplateLockedSettings(template),
    ),
    modelRevision: template.example.modelRevision,
    runtimeFingerprint: 'runtime',
    graphHash: 'graph',
    proofLockHash: 'proof',
    backendSourceFingerprint: 'backend-source',
    backendContractFingerprint: 'backend-contract',
    modelCommit: 'commit',
    templateRevisionHash: 'revision',
    provenancePath: '/proof.json',
    provenanceHash: 'provenance',
    outputPath: '/video.mp4',
    thumbnailPath: '/poster.webp',
    cardPreviewPath: '/video.card-preview.mp4',
    cardPreviewSha256: 'sha256:bytes:preview',
    mediaHash: 'media',
    mediaType: 'video',
    verificationTimestamp: new Date(0).toISOString(),
    qualityReviewPath: '/review.json',
    qualityReviewHash: 'review',
    qualityReviewStatus: 'approved_reviewed',
    reviewer: 'test',
    reviewedAt: new Date(0).toISOString(),
    width: 1664,
    height: 960,
    frames: 81,
    durationSeconds: 5.06,
  };
  base.templateLockHash = templateExactnessModule.getTemplateLockHash(template, base.modelRevision);
  base.templateInputContractHash = templateExactnessModule.getTemplateInputContractHash(template);
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    runtimeFingerprint: 'runtime',
    examples: [base],
  };

  assert.ok(templateExactnessModule.findManifestEntry(template, manifest));
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, promptSettingsHash: 'ps_stale_prompt_settings' }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, templateLockHash: 'tpl_stale_template_lock' }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, templateInputContractHash: 'tic_stale_default_inputs' }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, cardPreviewPath: undefined, cardPreviewSha256: undefined }],
    }),
    undefined,
  );
  assert.ok(
    templateExactnessModule.findManifestEntry(
      template,
      {
        ...manifest,
        examples: [{ ...base, cardPreviewPath: undefined, cardPreviewSha256: undefined }],
      },
      { requireCardPreview: false },
    ),
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, durationSeconds: 4.99 }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, frames: 80 }],
    }),
    undefined,
  );
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [{ ...base, width: 640, height: 360 }],
    }),
    undefined,
  );
});

test('template cards keep valid base motion after form edits and reject stale or revoked card media', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'wan_vace_outpaint_reframe');
  assert.ok(template);
  const lockedSettings = templateExactnessModule.getTemplateLockedSettings(template);
  const proof = {
    templateId: template.id,
    promptSettingsHash: templateExactnessModule.getPromptSettingsHash(lockedSettings),
    modelRevision: template.example.modelRevision,
    runtimeFingerprint: 'runtime',
    graphHash: 'graph',
    proofLockHash: 'proof',
    backendSourceFingerprint: 'backend-source',
    backendContractFingerprint: 'backend-contract',
    modelCommit: 'commit',
    templateRevisionHash: 'revision',
    provenancePath: '/proof.json',
    provenanceHash: 'provenance',
    outputPath: '/reviewed-video.mp4',
    thumbnailPath: '/reviewed-poster.webp',
    cardPreviewPath: '/reviewed-video.card-preview.mp4',
    cardPreviewSha256: 'sha256:bytes:preview',
    beforePath: '/reviewed-source.mp4',
    beforeMediaHash: 'sha256:bytes:source-preview',
    mediaHash: 'sha256:decoded-video-framemd5:valid-card-proof',
    mediaType: 'video',
    verificationTimestamp: new Date(0).toISOString(),
    qualityReviewPath: '/review.json',
    qualityReviewHash: 'review',
    qualityReviewStatus: 'approved_reviewed',
    reviewer: 'test',
    reviewedAt: new Date(0).toISOString(),
    width: 1664,
    height: 960,
    frames: 81,
    durationSeconds: 5.06,
  };
  proof.templateLockHash = templateExactnessModule.getTemplateLockHash(template, proof.modelRevision);
  proof.templateInputContractHash = templateExactnessModule.getTemplateInputContractHash(template);
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    runtimeFingerprint: 'runtime',
    examples: [proof],
  };
  const modifiedForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    ...lockedSettings,
    prompt: `${template.prompt} User edit.`,
  };

  const modifiedUiState = templateExactnessModule.getTemplateExampleUiState(
    template,
    modifiedForm,
    template.id,
    manifest,
  );
  assert.equal(modifiedUiState.status, 'modified');
  assert.equal(modifiedUiState.manifestEntry, undefined);
  assert.deepEqual(templateExactnessModule.getTemplateCardMedia(template, manifest), {
    beforePath: '/reviewed-source.mp4',
    mediaPath: '/reviewed-video.card-preview.mp4',
    thumbnailPath: '/reviewed-poster.webp',
  });

  const editorialFallback = templateExactnessModule.templateManifestPath(
    template.example.thumbnailPath ?? template.example.outputPath,
  );
  for (const rejectedProof of [
    {
      ...proof,
      templateLockHash: 'tpl_stale_template_lock',
      outputPath: '/stale-video.mp4',
      thumbnailPath: '/stale-poster.webp',
      cardPreviewPath: '/stale-video.card-preview.mp4',
      beforePath: '/stale-source.mp4',
    },
    {
      ...proof,
      mediaHash: 'sha256:decoded-video-framemd5:346b9ca1410359054c090c54f7238914997222f3999d836553cd3921817a07cf',
      outputPath: '/revoked-video.mp4',
      thumbnailPath: '/revoked-poster.webp',
      cardPreviewPath: '/revoked-video.card-preview.mp4',
      beforePath: '/revoked-source.mp4',
    },
  ]) {
    assert.deepEqual(
      templateExactnessModule.getTemplateCardMedia(template, {
        ...manifest,
        examples: [rejectedProof],
      }),
      {
        beforePath: undefined,
        mediaPath: undefined,
        thumbnailPath: editorialFallback,
      },
    );
  }
});

test('revocation follows the rejected media proof instead of permanently blocking a template', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'ltx_video_text_to_video');
  assert.ok(template);
  const expected = template.example.expectedOutput;
  const rejectedProof = {
    templateId: template.id,
    promptSettingsHash: templateExactnessModule.getPromptSettingsHash(
      templateExactnessModule.getTemplateLockedSettings(template),
    ),
    modelRevision: template.example.modelRevision,
    runtimeFingerprint: 'runtime',
    graphHash: 'graph',
    proofLockHash: 'proof',
    backendSourceFingerprint: 'backend-source',
    backendContractFingerprint: 'backend-contract',
    modelCommit: 'commit',
    templateRevisionHash: 'revision',
    provenancePath: '/proof.json',
    provenanceHash: 'provenance',
    outputPath: '/video.mp4',
    thumbnailPath: '/poster.webp',
    cardPreviewPath: '/video.card-preview.mp4',
    cardPreviewSha256: 'sha256:bytes:preview',
    mediaHash: 'sha256:decoded-video-framemd5:346b9ca1410359054c090c54f7238914997222f3999d836553cd3921817a07cf',
    mediaType: 'video',
    verificationTimestamp: new Date(0).toISOString(),
    qualityReviewPath: '/review.json',
    qualityReviewHash: 'review',
    qualityReviewStatus: 'approved_reviewed',
    reviewer: 'test',
    reviewedAt: new Date(0).toISOString(),
    width: expected.width,
    height: expected.height,
    frames: expected.frames,
    durationSeconds: expected.durationSeconds,
  };
  rejectedProof.templateLockHash = templateExactnessModule.getTemplateLockHash(template, rejectedProof.modelRevision);
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    runtimeFingerprint: 'runtime',
    examples: [rejectedProof],
  };

  assert.equal(templateExactnessModule.findManifestEntry(template, manifest), undefined);
  assert.ok(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [
        {
          ...rejectedProof,
          mediaHash: 'sha256:decoded-video-framemd5:3d57a6c1ad3fd403692281f7b59b9f540ff56e70c195fb27e3c9404f70584160',
        },
      ],
    }),
    'a newly reviewed proof with a different media hash can qualify',
  );
});

test('required-audio video manifests bind the soundtrack without revoking a reusable visual', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'wan_22_ti2v_5b_seed_vault');
  assert.ok(template);
  assert.equal(template.example.expectedOutput.requiresAudio, true);
  const expected = template.example.expectedOutput;
  const proof = {
    templateId: template.id,
    promptSettingsHash: templateExactnessModule.getPromptSettingsHash(
      templateExactnessModule.getTemplateLockedSettings(template),
    ),
    modelRevision: template.example.modelRevision,
    runtimeFingerprint: 'runtime',
    graphHash: 'graph',
    proofLockHash: 'proof',
    backendSourceFingerprint: 'backend-source',
    backendContractFingerprint: 'backend-contract',
    modelCommit: 'commit',
    templateRevisionHash: 'revision',
    provenancePath: '/proof.json',
    provenanceHash: 'provenance',
    outputPath: '/video.mp4',
    thumbnailPath: '/poster.webp',
    cardPreviewPath: '/video.card-preview.mp4',
    cardPreviewSha256: 'sha256:bytes:preview',
    mediaHash: 'sha256:decoded-video-framemd5:f46d1387bd5848c62fe9343a800d813a906ea33e0139f43f50926cc822bb1de7',
    mediaType: 'video',
    verificationTimestamp: new Date(0).toISOString(),
    qualityReviewPath: '/review.json',
    qualityReviewHash: 'review',
    qualityReviewStatus: 'approved_reviewed',
    reviewer: 'test',
    reviewedAt: new Date(0).toISOString(),
    width: expected.width,
    height: expected.height,
    frames: expected.frames,
    durationSeconds: expected.durationSeconds,
  };
  proof.templateLockHash = templateExactnessModule.getTemplateLockHash(template, proof.modelRevision);
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date(0).toISOString(),
    runtimeFingerprint: 'runtime',
    examples: [proof],
  };

  assert.equal(templateExactnessModule.findManifestEntry(template, manifest), undefined);
  assert.equal(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [
        {
          ...proof,
          decodedAudioHash:
            'sha256:decoded-audio-pcm-s16le-48000-stereo:811cfa5f48a6b84410a861f25488709641f03d208092f60c6dbe6040f2b089aa',
          audiovisualMediaHash: 'sha256:decoded-av-v1:rejected-pair',
        },
      ],
    }),
    undefined,
    'the explicitly rejected soundtrack remains revoked',
  );
  assert.ok(
    templateExactnessModule.findManifestEntry(template, {
      ...manifest,
      examples: [
        {
          ...proof,
          decodedAudioHash:
            'sha256:decoded-audio-pcm-s16le-48000-stereo:7971158f3e9988632c8c2100cd1f485c3477dbdb1006e9814d52fcbb1c84db3d',
          audiovisualMediaHash: 'sha256:decoded-av-v1:abb6bde8c9ac4d302e1741e51eb38bc139d873ae6914b5de548058a00c4bb476',
        },
      ],
    }),
    'a newly reviewed soundtrack can qualify while retaining the accepted picture',
  );
});

test('Wan VACE execution pins the app-installed immutable model revision', () => {
  assert.equal(profilesModule.WAN_VACE_REPO, 'Wan-AI/Wan2.1-VACE-1.3B-diffusers');
  assert.equal(profilesModule.WAN_VACE_REVISION, 'ec4d2cb062b548996b179d493fdd05340de702a1');
});

test('qualified Wan gallery proofs use native five-second shots without reducing recommended steps', () => {
  for (const template of [...templatesModule.STUDIO_TEMPLATES, ...templatesModule.PLANNING_STUDIO_TEMPLATES]) {
    if (!template.id.startsWith('wan_')) continue;
    assert.match(template.negativePrompt, /deformity/i, `${template.id} includes the shared deformity guard`);
  }

  const ids = [
    'wan_vace_cinematic_text_to_video',
    'wan_vace_direct_text_to_video',
    'wan_vace_video_color_grade',
    'wan_vace_masked_object_replace',
    'wan_vace_outpaint_reframe',
    'wan_vace_grayscale_control',
    'wan_vace_video_to_video',
  ];
  for (const id of ids) {
    const template = [...templatesModule.STUDIO_TEMPLATES, ...templatesModule.PLANNING_STUDIO_TEMPLATES].find(
      (item) => item.id === id,
    );
    assert.ok(template, `${id} exists`);
    if (id === 'wan_vace_direct_text_to_video') {
      assert.equal(template.example.status, 'blocked', `${id} stays hidden after failed motion qualification`);
    }
    if (id === 'wan_vace_cinematic_text_to_video') {
      assert.equal(template.modelType, 'WanVideoPipeline', `${id} uses the dedicated base Wan text pipeline`);
      assert.equal(template.example.lockedSettings.numFrames, 81, `${id} uses native-length Wan shots`);
      assert.equal(template.example.expectedOutput.frames, 81, `${id} delivers one fully active five-second shot`);
      assert.ok(!template.workflowBlocks.includes('video_sequence'), `${id} uses direct single-shot generation`);
      assert.ok(template.requiredBackendCapabilities.includes('modules.DiffusersVideo.Generate'));
    } else if (id === 'wan_vace_masked_object_replace') {
      assert.equal(template.example.lockedSettings.numFrames, 161, `${id} keeps its accepted full-orbit proof`);
    } else {
      assert.equal(template.example.lockedSettings.numFrames, 81, `${id} uses a native five-second motion window`);
    }
    assert.ok(template.workflowBlocks.includes('upscaler'), `${id} includes delivery upscaling`);
    const expectedSteps =
      id === 'wan_vace_masked_object_replace' ||
      id === 'wan_vace_direct_text_to_video' ||
      id === 'wan_vace_outpaint_reframe' ||
      id === 'wan_vace_grayscale_control'
        ? 30
        : 50;
    assert.equal(template.example.lockedSettings.steps, expectedSteps, `${id} preserves the upstream quality recipe`);
  }

  const wanTi2v = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'wan_22_ti2v_5b_seed_vault');
  assert.equal(
    wanTi2v.example.lockedSettings.steps,
    50,
    'Wan 2.2 TI2V 5B uses its official Diffusers model-card steps',
  );
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.WanTI2VPipeline.recommendedSteps, 50);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.WanTI2VPipeline.lowVram.steps, 50);
  assert.ok(wanTi2v.workflowBlocks.includes('soundtrack'));
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.pipelineClass, 'AceStepPipeline');
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.steps, 8);
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.guidanceScale, 1);
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.durationSeconds, 12);
  assert.equal(wanTi2v.workflowBlockSettings.soundtrack.seed, 1684710282);
  assert.deepEqual(wanTi2v.workflowBlockSettings.soundtrack.audioFit, {
    sourceStartSeconds: 1,
    sourceDurationSeconds: 121 / 24,
    targetDurationSeconds: 121 / 24,
    delaySeconds: 4 / 24,
    targetSampleRate: 48000,
    fadeInSeconds: 0.008,
    fadeOutSeconds: 0.12,
  });
  assert.ok(wanTi2v.requiredBackendCapabilities.includes('modules.Audio.FitDuration'));
  assert.equal(wanTi2v.example.expectedOutput.requiresAudio, true);

  const colorGrade = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'wan_vace_video_color_grade');
  assert.ok(colorGrade);
  assert.ok(
    colorGrade.example.lockedSettings.strength <= 0.2,
    'Wan color finishing stays below the observed 0.25 rigid-geometry redesign regime',
  );
  assert.equal(colorGrade.example.expectedOutput.motionReviewProfile, 'localized_subject');
  assert.equal(colorGrade.example.expectedOutput.minimumMotionCoverage, 0.27);
  assert.equal(colorGrade.example.expectedOutput.minimumAdjacentMotionCoverage, 0.03);
  assert.equal(colorGrade.example.expectedOutput.minimumEndToEndMotionCoverage, 0.18);
  assert.equal(colorGrade.example.expectedOutput.minimumActiveMotionWindowRatio, 0.65);
  assert.equal(colorGrade.example.expectedOutput.minimumStrongMotionWindowRatio, 0);
  assert.equal(colorGrade.example.expectedOutput.maximumLowMotionFrameRatio, 0.3);

  const grayscaleControl = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'wan_vace_grayscale_control');
  assert.ok(grayscaleControl);
  assert.equal(grayscaleControl.example.expectedOutput.minimumMotionCoverage, 0.75);
  assert.equal(grayscaleControl.example.expectedOutput.minimumAdjacentMotionCoverage, 0.03);
  assert.equal(grayscaleControl.example.expectedOutput.minimumEndToEndMotionCoverage, 0.6);
  assert.equal(grayscaleControl.example.expectedOutput.minimumActiveMotionWindowRatio, 0.6);
  assert.equal(grayscaleControl.example.expectedOutput.minimumStrongMotionWindowRatio, 0.4);
  assert.equal(grayscaleControl.example.expectedOutput.maximumLowMotionFrameRatio, 0.8);

  const planningReference = templatesModule.PLANNING_STUDIO_TEMPLATES.find(
    (item) => item.id === 'wan_vace_reference_motion',
  );
  assert.ok(planningReference, 'failed Wan reference conditioning remains available to planning reports');
  assert.equal(planningReference.example.status, 'blocked');

  const reduxBlend = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'flux_redux_multi_reference');
  assert.ok(reduxBlend, 'the user-approved Redux visual-blend proof is available in the template browser');
  assert.equal(reduxBlend.mode, 'multi_image_reference_edit');
  assert.equal(reduxBlend.example.status, 'reviewed');
  assert.equal(
    templatesModule.PLANNING_STUDIO_TEMPLATES.some((item) => item.id === 'flux_redux_multi_reference'),
    false,
    'the approved Redux card no longer remains hidden in planning',
  );
});

test('LTX video variation separates source conditioning from denoise strength', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'ltx_video_video_to_video');
  assert.ok(template);
  assert.equal(template.example.lockedSettings.conditioningScale, 1);
  assert.equal(template.example.lockedSettings.strength, 0.6);
  assert.ok(
    template.example.lockedSettings.conditioningScale > template.example.lockedSettings.strength,
    'the remaster hard-locks the source trajectory while denoising reconstructs its delivery frames',
  );
});

test('Qwen Auto never rewrites user generation controls while planning runtime resources', () => {
  const base = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    resourceMode: 'auto',
  };

  const resolved = resourcePlannerModule.resolveStudioResourceForm({ ...base, width: 1024, height: 768 });
  assert.equal(resolved.width, 1024);
  assert.equal(resolved.height, 768);

  const candidatePatch = autoResourceModule.formPatchForAutoCandidate(
    {
      dtype: 'bfloat16',
      offloadMode: 'model_cpu',
      generation: { width: 1024, height: 1024, steps: 50, guidanceScale: 4 },
    },
    { ...base, width: 1024, height: 768 },
  );
  assert.equal(candidatePatch.width, undefined);
  assert.equal(candidatePatch.height, undefined);

  const editedSamplingForm = {
    ...base,
    steps: 17,
    guidanceScale: 6.5,
    negativePrompt: 'Keep this user-authored negative prompt',
  };
  assert.equal(
    autoResourceModule.autoPlanKeyForForm(editedSamplingForm),
    autoResourceModule.autoPlanKeyForForm({
      ...editedSamplingForm,
      steps: 49,
      guidanceScale: 2.25,
      negativePrompt: 'A different user-authored negative prompt',
    }),
    'sampling edits must not invalidate a compatible hardware plan',
  );
  const editedSamplingPatch = autoResourceModule.formPatchForAutoCandidate(
    {
      dtype: 'bfloat16',
      offloadMode: 'model_cpu',
      generation: {
        width: 1024,
        height: 1024,
        steps: 50,
        guidanceScale: 4,
        negativePrompt: 'Planner default',
      },
    },
    editedSamplingForm,
  );
  assert.equal(Object.hasOwn(editedSamplingPatch, 'steps'), false);
  assert.equal(Object.hasOwn(editedSamplingPatch, 'guidanceScale'), false);
  assert.equal(Object.hasOwn(editedSamplingPatch, 'negativePrompt'), false);
});

test('schema-v2 Auto targets only the exact managed loader for Qwen and Wan profiles', () => {
  const cases = [
    [
      'QwenImageModularPipeline',
      'text_to_image',
      'modules.DiffusersImage',
      'LoadPipeline',
      'direct-diffusers-image',
      'QwenImagePipeline',
    ],
    [
      'QwenImageModularPipeline',
      'control_image',
      'modules.ModularDiffusers',
      'ModelsLoader',
      'modular-diffusers',
      'QwenImageModularPipeline',
    ],
    [
      'QwenImageEditPlusModularPipeline',
      'edit_image',
      'modules.ModularDiffusers',
      'ModelsLoader',
      'modular-diffusers',
      'QwenImageEditPlusModularPipeline',
    ],
    [
      'QwenImageLayeredModularPipeline',
      'layer_decomposition',
      'modules.ModularDiffusers',
      'ModelsLoader',
      'modular-diffusers',
      'QwenImageLayeredModularPipeline',
    ],
    [
      'WanVACEPipeline',
      'control_to_video',
      'modules.DiffusersVideo',
      'LoadPipeline',
      'direct-wan-vace',
      'WanVACEPipeline',
    ],
    [
      'WanVideoPipeline',
      'text_to_video',
      'modules.DiffusersVideo',
      'LoadPipeline',
      'direct-diffusers-video',
      'WanPipeline',
    ],
  ];
  const node = (id, module, action, identity, disabled = false, parentId, repo) => ({
    id,
    parentId,
    data: {
      module,
      action,
      type: 'custom',
      params: {
        [module === 'modules.ModularDiffusers' ? 'model_type' : 'pipeline_class']: { value: identity },
        ...(repo ? { model_id: { value: repo } } : {}),
      },
      uiState: disabled ? { disabled: true } : undefined,
    },
  });
  const planFor = (modelType, mode, loaderModule, loaderAction, executionPath, pipelineClass, id = 'selected') => {
    const candidate = {
      id,
      modelType,
      mode,
      loaderModule,
      loaderAction,
      executionPath,
      pipelineClass,
      modelRepo: 'owner/model',
      modelDependencies: [],
    };
    return {
      schemaVersion: 2,
      status: 'ready',
      canAutoRun: true,
      compatibility: { state: 'ready' },
      selectedCandidate: candidate,
      candidates: [{ ...candidate }],
    };
  };

  for (const [modelType, mode, loaderModule, loaderAction, executionPath, pipelineClass] of cases) {
    const plan = planFor(modelType, mode, loaderModule, loaderAction, executionPath, pipelineClass);
    const nodes = [
      node('modular', 'modules.ModularDiffusers', 'ModelsLoader', modelType, false, undefined, 'owner/model'),
      node('image', 'modules.DiffusersImage', 'LoadPipeline', pipelineClass, false, undefined, 'owner/model'),
      node('video', 'modules.DiffusersVideo', 'LoadPipeline', pipelineClass, false, undefined, 'owner/model'),
    ];
    const managedId =
      loaderModule === 'modules.ModularDiffusers' ? 'modular' : loaderModule.includes('Video') ? 'video' : 'image';
    assert.equal(
      autoResourceModule.autoResourcePlanTargetMatches(plan, nodes, [managedId], {
        modelType,
        mode,
        modelDependencies: [],
      }),
      true,
      `${modelType}:${mode}`,
    );
  }

  const qwenPlan = planFor(
    'QwenImageModularPipeline',
    'control_image',
    'modules.ModularDiffusers',
    'ModelsLoader',
    'modular-diffusers',
    'QwenImageModularPipeline',
  );
  const mixedNodes = [
    node('managed-image', 'modules.DiffusersImage', 'LoadPipeline', 'QwenImagePipeline'),
    node('unrelated-modular', 'modules.ModularDiffusers', 'ModelsLoader', 'QwenImageModularPipeline'),
  ];
  const qwenDependencies = [
    {
      id: 'qwen-controlnet-union',
      kind: 'controlnet',
      repo: 'InstantX/Qwen-Image-ControlNet-Union',
      revision: 'b13036f066d6dee7c20513e263d3d673055e9de8',
    },
  ];
  const dependencyCandidate = { ...qwenPlan.selectedCandidate, modelDependencies: qwenDependencies };
  const dependencyPlan = {
    ...qwenPlan,
    selectedCandidate: dependencyCandidate,
    candidates: [{ ...dependencyCandidate }],
  };
  assert.equal(
    autoResourceModule.autoResourcePlanTargetMatches(
      dependencyPlan,
      [
        node(
          'managed-modular',
          'modules.ModularDiffusers',
          'ModelsLoader',
          'QwenImageModularPipeline',
          false,
          undefined,
          'owner/model',
        ),
      ],
      ['managed-modular'],
      { modelType: 'QwenImageModularPipeline', mode: 'control_image', modelDependencies: qwenDependencies },
    ),
    true,
  );
  assert.equal(
    autoResourceModule.autoResourcePlanTargetMatches(
      {
        ...dependencyPlan,
        selectedCandidate: {
          ...dependencyCandidate,
          modelDependencies: [{ ...qwenDependencies[0], revision: '0'.repeat(40) }],
        },
        candidates: [
          {
            ...dependencyCandidate,
            modelDependencies: [{ ...qwenDependencies[0], revision: '0'.repeat(40) }],
          },
        ],
      },
      [node('managed-modular', 'modules.ModularDiffusers', 'ModelsLoader', 'QwenImageModularPipeline')],
      ['managed-modular'],
      { modelType: 'QwenImageModularPipeline', mode: 'control_image', modelDependencies: qwenDependencies },
    ),
    false,
    'a stale auxiliary artifact revision cannot satisfy the current profile receipt',
  );
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(qwenPlan, mixedNodes, ['managed-image'], {
      modelType: 'QwenImageModularPipeline',
      mode: 'control_image',
    }),
    'an unrelated visible loader cannot satisfy the managed target',
  );
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(
      qwenPlan,
      [node('managed-modular', 'modules.ModularDiffusers', 'ModelsLoader', 'QwenImageModularPipeline', true)],
      ['managed-modular'],
      { modelType: 'QwenImageModularPipeline', mode: 'control_image' },
    ),
    'a disabled loader is not executable',
  );
  for (const containers of [
    [{ id: 'disabled-group', data: { type: 'group', uiState: { disabled: true } } }],
    [
      { id: 'disabled-loop', data: { type: 'loop', uiState: { disabled: true } } },
      { id: 'nested-group', parentId: 'disabled-loop', data: { type: 'group' } },
    ],
  ]) {
    const parentId = containers.at(-1).id;
    assert.ok(
      !autoResourceModule.autoResourcePlanTargetMatches(
        qwenPlan,
        [
          ...containers,
          node(
            'managed-modular',
            'modules.ModularDiffusers',
            'ModelsLoader',
            'QwenImageModularPipeline',
            false,
            parentId,
          ),
        ],
        ['managed-modular'],
        { modelType: 'QwenImageModularPipeline', mode: 'control_image' },
      ),
      'a loader nested under a disabled group or loop is not executable',
    );
  }

  const staleId = { ...qwenPlan, selectedCandidate: { ...qwenPlan.selectedCandidate, id: 'stale' } };
  assert.equal(autoResourceModule.selectedAutoCandidate(staleId), null);
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(staleId, mixedNodes, ['unrelated-modular'], {
      modelType: 'QwenImageModularPipeline',
      mode: 'control_image',
    }),
  );
  const boundCandidate = {
    ...qwenPlan.selectedCandidate,
    artifactRevision: 'a'.repeat(40),
    artifactResolution: {
      resolved: { repo: 'Qwen/Qwen-Image-2512', revision: 'a'.repeat(40), components: ['transformer'] },
    },
    quantizedComponents: ['transformer'],
    bnb4ComputeDtype: 'bfloat16',
    autoOffload: true,
    generation: { width: 1024, height: 1024, steps: 50 },
    proof: { status: 'declared_safe' },
  };
  const exactBoundPlan = {
    ...qwenPlan,
    selectedCandidate: { ...boundCandidate },
    candidates: [{ ...boundCandidate }],
  };
  assert.equal(autoResourceModule.selectedAutoCandidate(exactBoundPlan)?.id, 'selected');
  for (const selectedCandidate of [
    { ...boundCandidate, artifactRevision: 'b'.repeat(40) },
    { ...boundCandidate, quantizedComponents: ['text_encoder'] },
    { ...boundCandidate, quantizedComponents: { 0: 'transformer' } },
    { ...boundCandidate, generation: { ...boundCandidate.generation, steps: 28 } },
  ]) {
    const stalePayload = { ...exactBoundPlan, selectedCandidate };
    assert.equal(autoResourceModule.selectedAutoCandidate(stalePayload), null);
    assert.ok(
      !autoResourceModule.autoResourcePlanTargetMatches(stalePayload, mixedNodes, ['unrelated-modular'], {
        modelType: 'QwenImageModularPipeline',
        mode: 'control_image',
      }),
    );
  }
  const graphBoundCandidate = {
    id: 'specified',
    executionProfileId: 'flux-schnell:direct',
    modelType: 'FluxSchnellPipeline',
    mode: 'text_to_image',
    loaderModule: 'modules.DiffusersImage',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-image',
    pipelineClass: 'FluxPipeline',
    modelRepo: 'black-forest-labs/FLUX.1-schnell',
    modelDependencies: [],
    studioExecutionSpecContract: {
      schemaVersion: 1,
      id: 'flux-schnell:text-to-image:v1',
      contentHash: 'studio-spec-v1-9cd1abb5',
      executionProfileId: 'flux-schnell:direct',
    },
  };
  const graphBoundPlan = {
    schemaVersion: 2,
    selectedCandidate: graphBoundCandidate,
    candidates: [{ ...graphBoundCandidate }],
  };
  assert.equal(autoResourceModule.selectedAutoCandidate(graphBoundPlan)?.id, 'specified');
  const graphSpec = { ...graphBoundCandidate.studioExecutionSpecContract };
  const fluxLoader = node(
    'flux-loader',
    'modules.DiffusersImage',
    'LoadPipeline',
    'FluxPipeline',
    false,
    undefined,
    'black-forest-labs/FLUX.1-schnell',
  );
  assert.equal(
    autoResourceModule.autoResourcePlanTargetMatches(graphBoundPlan, [fluxLoader], ['flux-loader'], {
      modelType: 'FluxSchnellPipeline',
      mode: 'text_to_image',
      spec: graphSpec,
      modelDependencies: [],
    }),
    true,
  );
  assert.equal(
    autoResourceModule.autoResourcePlanTargetMatches(
      {
        ...graphBoundPlan,
        selectedCandidate: { ...graphBoundCandidate, studioExecutionSpecContract: undefined },
        candidates: [{ ...graphBoundCandidate, studioExecutionSpecContract: undefined }],
      },
      [fluxLoader],
      ['flux-loader'],
      { modelType: 'FluxSchnellPipeline', mode: 'text_to_image', spec: graphSpec },
    ),
    false,
  );
  assert.equal(
    autoResourceModule.autoResourcePlanTargetMatches(
      graphBoundPlan,
      [
        node(
          'flux-loader',
          'modules.DiffusersImage',
          'LoadPipeline',
          'FluxPipeline',
          false,
          undefined,
          'black-forest-labs/FLUX.1-dev',
        ),
      ],
      ['flux-loader'],
      { modelType: 'FluxSchnellPipeline', mode: 'text_to_image', spec: graphSpec, modelDependencies: [] },
    ),
    false,
    'a shared loader class cannot satisfy Auto with a different live repository',
  );
  const inconsistentArtifact = {
    ...graphBoundCandidate,
    resolvedArtifact: 'black-forest-labs/FLUX.1-dev',
  };
  assert.equal(
    autoResourceModule.autoResourcePlanTargetMatches(
      {
        ...graphBoundPlan,
        selectedCandidate: inconsistentArtifact,
        candidates: [inconsistentArtifact],
      },
      [fluxLoader],
      ['flux-loader'],
      { modelType: 'FluxSchnellPipeline', mode: 'text_to_image', spec: graphSpec, modelDependencies: [] },
    ),
    false,
    'conflicting artifact identities cannot bind a selected Auto plan',
  );
  assert.equal(
    autoResourceModule.selectedAutoCandidate({
      ...graphBoundPlan,
      selectedCandidate: {
        ...graphBoundCandidate,
        studioExecutionSpecContract: {
          ...graphBoundCandidate.studioExecutionSpecContract,
          contentHash: 'studio-spec-v1-00000000',
        },
      },
    }),
    null,
  );
  for (const selectedCandidate of [
    { ...qwenPlan.selectedCandidate, executionPath: 'direct-diffusers-image' },
    { ...qwenPlan.selectedCandidate, pipelineClass: 'FluxPipeline' },
  ]) {
    const inconsistentTarget = {
      ...qwenPlan,
      selectedCandidate,
      candidates: [{ ...selectedCandidate }],
    };
    assert.equal(autoResourceModule.selectedAutoCandidate(inconsistentTarget), null);
    assert.equal(
      autoResourceModule.autoResourcePlanTargetMatches(inconsistentTarget, mixedNodes, ['unrelated-modular'], {
        modelType: 'QwenImageModularPipeline',
        mode: 'control_image',
      }),
      false,
    );
  }
  const wrongPair = planFor(
    'FluxSchnellPipeline',
    'text_to_image',
    'modules.DiffusersImage',
    'LoadPipeline',
    'direct-diffusers-image',
    'FluxPipeline',
  );
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(wrongPair, mixedNodes, ['managed-image'], {
      modelType: 'QwenImageModularPipeline',
      mode: 'text_to_image',
    }),
  );
  const wrongClass = planFor(
    'QwenImageModularPipeline',
    'text_to_image',
    'modules.DiffusersImage',
    'LoadPipeline',
    'direct-diffusers-image',
    'FluxPipeline',
  );
  assert.ok(
    !autoResourceModule.autoResourcePlanTargetMatches(wrongClass, mixedNodes, ['managed-image'], {
      modelType: 'QwenImageModularPipeline',
      mode: 'text_to_image',
    }),
    'the same loader module/action cannot repurpose a different live pipeline class',
  );
});

test('Auto retry plans preserve exact targets and never fall back from a stale selected id', () => {
  const identity = {
    executionProfileId: 'qwen-image:t2i-direct',
    modelType: 'QwenImageModularPipeline',
    mode: 'text_to_image',
    loaderModule: 'modules.DiffusersImage',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-image',
    pipelineClass: 'QwenImagePipeline',
  };
  const candidates = [
    { id: 'selected', ...identity, proof: { status: 'passed' }, offloadMode: 'none' },
    { id: 'retry', ...identity, proof: { status: 'declared_safe' }, offloadMode: 'model_cpu' },
    {
      id: 'cross-branch',
      ...identity,
      modelType: 'FluxSchnellPipeline',
      pipelineClass: 'FluxPipeline',
      proof: { status: 'passed' },
      offloadMode: 'model_cpu',
    },
    { id: 'targetless', proof: { status: 'passed' }, offloadMode: 'model_cpu' },
  ];
  assert.deepEqual(resourcePlannerModule.qwenDirectRetryPlansFromCandidates(candidates, 'selected')[0], {
    candidateId: 'retry',
    ...identity,
    onCategories: ['oom', 'cuda_kernel'],
    onErrorCodes: ['cuda_kernel_unsupported', 'cuda_oom'],
  });
  assert.equal(resourcePlannerModule.qwenDirectRetryPlansFromCandidates(candidates, 'selected').length, 1);
  assert.deepEqual(resourcePlannerModule.qwenDirectRetryPlansFromCandidates(candidates, 'missing'), []);
});

test('controlled artifacts never inherit a base-only Ran here label at plan time', () => {
  const candidate = { id: 'selected', proof: { status: 'live_proven' } };
  assert.deepEqual(autoResourceModule.controlledArtifactProofNotice(candidate, ['lora.diffusers-image.v1']), {
    label: 'Base recipe ran here',
    message: 'MoDiff verifies this exact controlled artifact set when Run starts.',
  });
  for (const contractId of ['upscale.image.v1', 'soundtrack.v1', 'lyric-video.v1']) {
    assert.equal(
      autoResourceModule.controlledArtifactProofNotice(candidate, [contractId])?.label,
      'Base recipe ran here',
    );
  }
  assert.equal(autoResourceModule.controlledArtifactProofNotice(candidate, ['video-sequence.v1']), null);
  assert.equal(
    autoResourceModule.controlledArtifactProofNotice({ ...candidate, proof: { status: 'declared_safe' } }, [
      'lora.diffusers-image.v1',
    ]),
    null,
  );
});

test('ACE templates lock musical structure, metadata, and model-aware negative behavior', () => {
  const templates = templatesModule.STUDIO_TEMPLATES.filter(
    (template) => template.modelType === 'AceStepAudioPipeline',
  );
  assert.equal(templates.length, 7);
  assert.equal(profilesModule.STUDIO_MODEL_PROFILES.AceStepAudioPipeline.recommendedSampleRate, 48000);

  for (const template of templates) {
    const locked = template.example.lockedSettings;
    assert.equal(locked.steps, 8);
    assert.equal(locked.guidanceScale, 1);
    assert.equal(locked.shift, 3);
    const expectedBpm =
      template.id === 'ace_step_lyric_music_video'
        ? 100
        : template.id === 'ace_step_chinese_new_year_lora'
          ? 96
          : template.id === 'ace_step_custom_lora'
            ? 92
            : 170;
    const expectedKey =
      template.id === 'ace_step_chinese_new_year_lora'
        ? 'D major'
        : template.id === 'ace_step_custom_lora'
          ? 'A minor'
          : 'C# minor';
    assert.equal(locked.bpm, expectedBpm);
    assert.equal(locked.keyscale, expectedKey);
    const expectedTimeSignature =
      template.id === 'ace_step_text_to_audio' || template.id === 'ace_step_audio_continuation'
        ? '3'
        : template.id === 'ace_step_lyric_music_video'
          ? '4'
          : '4/4';
    assert.equal(locked.timesignature, expectedTimeSignature);
    assert.equal(template.negativePrompt, '');
  }

  const textToAudio75 = templates.find((template) => template.id === 'ace_step_text_to_audio');
  assert.equal(textToAudio75.example.lockedSettings.audioDuration, 75);
  assert.equal(textToAudio75.example.expectedOutput.durationSeconds, 75);
  assert.match(textToAudio75.prompt, /0-6 seconds/);
  assert.match(textToAudio75.prompt, /72-75 seconds/);
  assert.match(textToAudio75.example.lockedSettings.lyrics, /\[Pre-Chorus\]/);
  assert.match(textToAudio75.example.lockedSettings.lyrics, /\[Bridge\]/);
  assert.equal(
    templateExactnessModule.getTemplateCardMedia(textToAudio75, null).mediaPath,
    templateAssetsModule.resolveTemplateAssetUrl('/template-gallery/ace_step_text_to_audio.current.wav'),
  );

  const lyricVideo = templates.find((template) => template.id === 'ace_step_lyric_music_video');
  assert.ok(lyricVideo.workflowBlocks.includes('lyric_video'));
  assert.ok(lyricVideo.example.expectedOutput.durationSeconds >= 20);
  assert.equal(lyricVideo.example.lockedSeed, 1201047366);
  assert.equal(lyricVideo.example.lockedSettings.audioDuration, 30);
  assert.equal(lyricVideo.example.expectedOutput.requiresAudio, true);
  assert.ok(lyricVideo.requiredBackendCapabilities.includes('modules.Audio.FitDuration'));
  assert.deepEqual(lyricVideo.workflowBlockSettings.lyricVideo.audioFit, {
    sourceStartSeconds: 0,
    sourceDurationSeconds: 30,
    targetDurationSeconds: 381 / 16,
    delaySeconds: 0,
    targetSampleRate: 48000,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  });
  assert.equal(lyricVideo.workflowBlockSettings.lyricVideo.audio.seed, 1201047366);
  assert.equal(lyricVideo.workflowBlockSettings.lyricVideo.audio.bpm, 100);
  assert.match(lyricVideo.workflowBlockSettings.lyricVideo.audio.lyrics, /^\[Verse\]/);
  assert.equal(
    lyricVideo.workflowBlockSettings.lyricVideo.lrc,
    [
      '[00:00.00]Daylight leaves the garden wall',
      '[00:03.26]Silver buds begin to call',
      '[00:07.44]White petals turn into the night',
      '[00:11.38]Every vine unfolds its light',
      '[00:15.08]Stars grow pale above the lawn',
      '[00:18.90]Moonflowers hold until the dawn',
    ].join('\n'),
  );

  const textToAudio = templates.find((template) => template.mode === 'text_to_audio');
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[intro\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[verse\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[chorus\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[bridge\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[outro\]/i);

  const chineseNewYear = templates.find((template) => template.id === 'ace_step_chinese_new_year_lora');
  assert.equal(
    chineseNewYear.workflowBlockSettings.lora.baseModel.value,
    'Runware/acestep-v15-turbo-diffusers',
    'the official 2048-wide LoRA must retain its matching base instead of the XL Studio default',
  );
  assert.equal(
    chineseNewYear.workflowBlockSettings.lora.baseModel.revision,
    'be23effe449c5957947f3020fd63bee23c64abe4',
    'the matching Diffusers base must remain pinned to the reviewed revision',
  );
  assert.equal(
    chineseNewYear.workflowBlockSettings.lora.model.revision,
    'cb829a12775740c830a6d49795f16913065dc492',
    'the restricted adapter must remain pinned to the reviewed revision',
  );
  assert.equal(chineseNewYear.workflowBlockSettings.lora.scale, 0.5);
  assert.equal(chineseNewYear.prompt, 'chinese traditional music, erhu solo, peaceful and elegant');
  assert.equal(chineseNewYear.example.lockedSettings.audioDuration, 30);
  assert.equal(chineseNewYear.example.expectedOutput.durationSeconds, 30);
  assert.equal(
    templateExactnessModule.getTemplateCardMedia(chineseNewYear, null).mediaPath,
    templateAssetsModule.resolveTemplateAssetUrl('/template-gallery/ace_step_chinese_new_year_lora.wav'),
  );
  assert.equal(
    chineseNewYear.example.lockedSettings.lyrics,
    '[verse]\n\u6625\u98ce\u53c8\u7eff\u6c5f\u5357\u5cb8\n\u660e\u6708\u4f55\u65f6\u7167\u6211\u8fd8',
  );
  const customLora = templates.find((template) => template.id === 'ace_step_custom_lora');
  assert.equal(customLora.evidencePolicy, 'user_supplied');
  assert.match(customLora.example.notes, /bring-your-own adapter/i);
  assert.equal(
    customLora.workflowBlockSettings.lora.baseModel.revision,
    'be23effe449c5957947f3020fd63bee23c64abe4',
    'the local-adapter starter must still pin its managed Hub base model',
  );

  const ghibliLora = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'flux_lora_ghibli_story');
  const ghibliMedia = templateExactnessModule.getTemplateCardMedia(ghibliLora, null);
  assert.equal(ghibliMedia.mediaPath, undefined, 'permission-pending generated media must not resolve');
  assert.equal(ghibliMedia.thumbnailPath, undefined, 'permission-pending posters must not resolve');
  for (const templateId of ['flux_lora_oil_painting', 'flux_lora_retro_comic']) {
    const template = templatesModule.STUDIO_TEMPLATES.find((candidate) => candidate.id === templateId);
    const media = templateExactnessModule.getTemplateCardMedia(template, null);
    assert.ok(media.mediaPath || media.thumbnailPath, `${templateId} keeps its reviewed public preview`);
  }
  const octaneTemplate = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'flux_lora_cinematic_octane_3d',
  );
  assert.equal(
    templateExactnessModule.getTemplateCardMedia(octaneTemplate, null).thumbnailPath,
    templateAssetsModule.resolveTemplateAssetUrl('/template-gallery/flux_lora_cinematic_octane_3d.card-poster.webp'),
    'the portrait editorial poster remains visible as the template card fallback',
  );

  const ghibliPolicies = modelUsagePoliciesModule.acknowledgementRequiredForTemplate(ghibliLora);
  assert.deepEqual(ghibliPolicies.map((policy) => policy.repository).sort(), [
    'alvarobartt/ghibli-characters-flux-lora',
    'black-forest-labs/FLUX.1-dev',
  ]);
  assert.equal(
    ghibliPolicies.find((policy) => policy.repository === 'alvarobartt/ghibli-characters-flux-lora')?.useScope,
    'personal_noncommercial',
  );
  const ghibliAcknowledgementKey = modelUsagePoliciesModule.usagePolicyAcknowledgementKey(ghibliPolicies);
  assert.match(ghibliAcknowledgementKey, /^terms-v2:[0-9a-f]{8}$/);
  assert.ok(
    ghibliPolicies.every((policy) => /^[0-9a-f]{40}$/.test(policy.revision)),
    'acknowledgement contracts must use immutable model revisions',
  );

  const chineseNewYearPolicies = modelUsagePoliciesModule.acknowledgementRequiredForTemplate(chineseNewYear);
  assert.deepEqual(
    chineseNewYearPolicies.map((policy) => policy.repository),
    ['ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA'],
  );
  const chineseNewYearPolicy = chineseNewYearPolicies[0];
  assert.equal(chineseNewYearPolicy.useScope, 'research_academic_only');
  assert.equal(chineseNewYearPolicy.revision, 'cb829a12775740c830a6d49795f16913065dc492');
  assert.equal(chineseNewYearPolicy.reviewedRevision, 'cb829a12775740c830a6d49795f16913065dc492');
  assert.match(chineseNewYearPolicy.shortSummary, /research and academic exchange only/i);
  assert.match(chineseNewYearPolicy.shortSummary, /prohibits commercial use/i);
  assert.equal(
    chineseNewYearPolicy.termsUrl,
    'https://huggingface.co/ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA/blob/cb829a12775740c830a6d49795f16913065dc492/README.md',
  );
  assert.match(
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey(chineseNewYearPolicies),
    /^terms-v2:[0-9a-f]{8}$/,
  );
  assert.notEqual(
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey(chineseNewYearPolicies),
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey([
      { ...chineseNewYearPolicy, revision: '0000000000000000000000000000000000000000' },
    ]),
    'changing a repository revision must invalidate the stored acknowledgement',
  );
  assert.notEqual(
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey(chineseNewYearPolicies),
    modelUsagePoliciesModule.usagePolicyAcknowledgementKey([
      { ...chineseNewYearPolicy, policyVersion: 'next-policy-review' },
    ]),
    'changing the reviewed policy version must invalidate the stored acknowledgement',
  );

  const oilTemplate = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'flux_lora_oil_painting');
  assert.deepEqual(
    modelUsagePoliciesModule.acknowledgementRequiredForTemplate(oilTemplate).map((policy) => policy.repository),
    ['black-forest-labs/FLUX.1-dev'],
    'a commercially licensed adapter still surfaces the restricted FLUX dev base terms',
  );
  const unrestrictedTemplate = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'flux_schnell_text_to_image',
  );
  assert.deepEqual(modelUsagePoliciesModule.acknowledgementRequiredForTemplate(unrestrictedTemplate), []);
  assert.equal(modelUsagePoliciesModule.repositoryRequiresHuggingFaceGate('black-forest-labs/FLUX.1-dev'), true);
  assert.equal(
    modelUsagePoliciesModule.repositoryRequiresHuggingFaceGate('alvarobartt/ghibli-characters-flux-lora'),
    false,
  );

  const continuation = templates.find((template) => template.mode === 'audio_continuation');
  assert.equal(continuation.example.lockedSettings.audioDuration, 75);
  assert.equal(continuation.example.lockedSettings.extensionDuration, 15);
  assert.equal(continuation.example.expectedOutput.durationSeconds, 90);
  assert.ok(continuation.requiredBackendCapabilities.includes('modules.Audio.MatchLoudness'));
  assert.ok(continuation.requiredBackendCapabilities.includes('modules.Audio.Join'));
  assert.match(continuation.prompt, /absolute time 75 to 90 seconds/);
  assert.match(continuation.prompt, /strict 3\/4/);
  assert.match(continuation.example.lockedSettings.lyrics, /MoDiff—lock the final line[\s\S]*\[Continuation\]/);
  assert.match(continuation.example.lockedSettings.lyrics, /\[Final Hook\]/);
  assert.equal(continuation.inputBindings[0].label, 'Included 75-second source audio');
  assert.equal(
    continuation.inputBindings[0].defaultAssets[0].runtimeSha256,
    'sha256:bytes:3807d712e24a94c4b445c2fa950a784bba334f5f665e74964fe4d47a43856230',
  );
  assert.equal(
    templateExactnessModule.getTemplateCardMedia(continuation, null).beforePath,
    templateAssetsModule.resolveTemplateAssetUrl('/template-gallery/ace_step_text_to_audio.current.wav'),
  );
});

test('template browser exposes the complete workflow catalog across task and adapter categories', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const { TEMPLATE_BROWSER_CATEGORIES, filterStudioTemplates, templateCategoryId, templateCategoryIds } = browserModule;
  const form = profilesModule.DEFAULT_STUDIO_FORM;

  assert.deepEqual(
    TEMPLATE_BROWSER_CATEGORIES.map((category) => category.id),
    [
      'recommended',
      'all',
      'experimental',
      'getting-started',
      'image',
      'edit',
      'control',
      'video',
      'audio',
      'adapters',
      'upscale',
      'performance',
    ],
  );

  const imageTemplates = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'image',
    query: '',
    modelType: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });
  assert.ok(imageTemplates.length > 0);
  assert.ok(imageTemplates.every((template) => templateCategoryIds(template).includes('image')));
  assert.ok(imageTemplates.some((template) => template.id === 'flux_lora_oil_painting'));
  assert.ok(imageTemplates.some((template) => template.id === 'flux_lora_retro_comic'));

  const adapterTemplates = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'adapters',
    includeBlocked: true,
    query: '',
    modelType: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });
  const authoredAdapterIds = STUDIO_TEMPLATES.filter((template) => template.category === 'lora').map(
    (template) => template.id,
  );
  assert.deepEqual(
    authoredAdapterIds.filter((templateId) => !adapterTemplates.some((template) => template.id === templateId)),
    [],
  );

  const referenceEdits = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'edit',
    query: '',
    modelType: 'all',
    mode: 'multi_image_reference_edit',
    difficulty: 'all',
    sort: 'recommended',
  });
  assert.ok(referenceEdits.length > 0);
  assert.ok(referenceEdits.every((template) => template.mode === 'multi_image_reference_edit'));
  assert.ok(referenceEdits.every((template) => templateCategoryId(template) === 'edit'));

  const defaultInventory = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'all',
    query: '',
    modelType: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });
  assert.equal(
    defaultInventory.some((template) => template.difficulty === 'blocked' || template.example?.status === 'blocked'),
    false,
  );

  const completeInventory = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'all',
    includeBlocked: true,
    query: '',
    modelType: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });
  assert.equal(completeInventory.length, STUDIO_TEMPLATES.length);
  assert.ok(completeInventory.length >= defaultInventory.length);
});

test('every template name identifies its exact model and operation', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const { STUDIO_MODEL_LABELS } = profilesModule;
  for (const template of STUDIO_TEMPLATES) {
    assert.ok(
      template.label.startsWith(`${STUDIO_MODEL_LABELS[template.modelType]} — `),
      `${template.id} must begin with its model name`,
    );
    assert.doesNotMatch(template.label, /^(Low VRAM|High quality|Fast LoRA)$/i);
  }
  assert.equal(
    STUDIO_TEMPLATES.find((template) => template.id === 'low_vram')?.label,
    'Z-Image Turbo — Text to Image: Auto-Offload Preview',
  );
});

test('browser display names stay concise because model and operation have dedicated metadata', () => {
  const displayNames = templatesModule.STUDIO_TEMPLATES.map((template) => ({
    template,
    name: browserModule.templateDisplayName(template),
  }));
  const productConcept = displayNames.find(({ template }) => template.id === 'qwen_low_vram_product_concept');
  assert.equal(productConcept?.name, 'Product Concept');
  const quickPreview = displayNames.find(({ template }) => template.id === 'low_vram');
  assert.equal(quickPreview?.name, 'Quick Preview');
  for (const { template, name } of displayNames) {
    assert.ok(name.length > 0, `${template.id} has a display name`);
    assert.equal(/auto[ -]?offload|low[ -]?vram/i.test(name), false, `${template.id} hides execution strategy`);
    assert.equal(
      name.includes(profilesModule.STUDIO_MODEL_LABELS[template.modelType]),
      false,
      `${template.id} hides duplicate model name`,
    );
    assert.equal(
      name.includes(profilesModule.STUDIO_MODE_LABELS[template.mode]),
      false,
      `${template.id} hides duplicate operation`,
    );
  }
});

test('every declared template backend capability has an explicit registry contract', () => {
  const templates = [...templatesModule.STUDIO_TEMPLATES, ...templatesModule.PLANNING_STUDIO_TEMPLATES];
  for (const template of templates) {
    const capabilities = template.requiredBackendCapabilities ?? [];
    for (const capability of capabilities) {
      assert.equal(
        readinessModule.isTemplateBackendCapabilityRecognized(capability),
        true,
        `${template.id} has no readiness resolver for ${capability}`,
      );
    }
    if (capabilities.length > 0) {
      assert.ok(
        readinessModule.templateBackendNodeKeys(template).length > 0,
        `${template.id} has no source-controlled backend-node contract`,
      );
    }
  }
  assert.equal(readinessModule.isTemplateBackendCapabilityRecognized('unregistered future capability'), false);
});

test('runtime option normalization supports the real registry descriptor contract and legacy declarations', () => {
  const entries = runtimeOptionsModule.runtimeOptionEntries([
    optionDescriptor('model_cpu', { label: 'RAM/CPU model offload' }),
    optionDescriptor('group_disk', {
      label: 'SSD group offload',
      availability: 'remote',
      installationState: 'installable',
    }),
    { id: 'legacy', label: 'Legacy object choice' },
    { unsupportedShape: true },
  ]);

  assert.deepEqual(
    entries
      .filter((entry) => entry.type === 'option')
      .map(({ value, label, disabled }) => ({
        value,
        label,
        disabled,
      })),
    [
      { value: 'model_cpu', label: 'RAM/CPU model offload', disabled: false },
      { value: 'group_disk', label: 'SSD group offload', disabled: true },
      { value: 'legacy', label: 'Legacy object choice', disabled: false },
    ],
  );
  assert.deepEqual(runtimeOptionsModule.runtimeOptionValues(entries.map((entry) => entry.raw)), [
    'model_cpu',
    'legacy',
  ]);
  assert.equal(JSON.stringify(entries).includes('[object Object]'), false);

  const dictionaryEntries = runtimeOptionsModule.runtimeOptionEntries({
    __runtime: 'Installed',
    quality: optionDescriptor('quality', { label: 'Quality' }),
    fast: 'Fast',
  });
  assert.equal(dictionaryEntries[0].type, 'header');
  assert.deepEqual(runtimeOptionsModule.runtimeOptionValues({ quality: optionDescriptor('quality'), fast: 'Fast' }), [
    'quality',
    'fast',
  ]);
});

test('template readiness classifies ready, input, model, and backend states', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const { getTemplateReadiness } = readinessModule;
  const baseRegistry = {
    'modules.ModularDiffusers.AutoModelLoader': {},
    'modules.ModularDiffusers.Controlnet': {},
  };
  const modularQwenEditRegistry = {
    'modules.ModularDiffusers.ModelsLoader': {},
    'modules.ModularDiffusers.EncodePrompt': {},
    'modules.ModularDiffusers.ImageEncode': {},
    'modules.ModularDiffusers.Denoise': {},
    'modules.ModularDiffusers.DecodeLatents': {},
    'modules.ModularDiffusers.Lora': {},
    'modules.Image.Load': {},
    'modules.Image.Preview': {},
  };

  const quick = STUDIO_TEMPLATES.find((template) => template.id === 'z_image_quick_concept');
  const fastLora = STUDIO_TEMPLATES.find((template) => template.id === 'fast_lora');
  const fluxLora = STUDIO_TEMPLATES.find((template) => template.id === 'flux_lora_ghibli_story');
  const character = STUDIO_TEMPLATES.find((template) => template.id === 'character_edit');
  const control = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_control_image_layout');
  const upscale = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_upscale_finish');
  const inpaint = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_inpaint_mask_draft');
  const layered = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_layered_portrait');
  const outpaint = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_outpaint_aspect_template');
  const storm = STUDIO_TEMPLATES.find((template) => template.id === 'wan_vace_cinematic_text_to_video');
  assert.ok(
    quick && fastLora && fluxLora && character && control && upscale && inpaint && layered && outpaint && storm,
  );

  assert.equal(
    getTemplateReadiness(quick, readinessContext({ hfCache: ['Tongyi-MAI/Z-Image-Turbo'] })).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      character,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit-2511', 'lightx2v/Qwen-Image-Edit-2511-Lightning'],
        nodesRegistry: modularQwenEditRegistry,
      }),
    ).status,
    'ready',
  );
  const userInputQuick = {
    ...quick,
    inputRequirements: { sourceImage: true },
    inputBindings: [
      {
        id: 'user-source-image',
        label: 'Source image',
        mediaType: 'image',
        origin: 'user',
        requiredAt: 'workflow_start',
        field: 'referenceImages',
        count: 1,
      },
    ],
  };
  assert.equal(
    getTemplateReadiness(userInputQuick, readinessContext({ hfCache: ['Tongyi-MAI/Z-Image-Turbo'] })).status,
    'needs_input',
  );
  assert.equal(
    getTemplateReadiness(
      character,
      readinessContext({
        nodesRegistry: {
          ...modularQwenEditRegistry,
          'modules.ModularDiffusers.EncodePrompt': undefined,
        },
      }),
    ).status,
    'needs_backend',
  );
  const fluxLoraRegistry = {
    'modules.DiffusersImage.LoadPipeline': {},
    'modules.DiffusersImage.Generate': {},
    'modules.DiffusersImage.LoadAdapter': {},
    'modules.Image.Preview': {},
  };
  assert.deepEqual(
    getTemplateReadiness(fluxLora, readinessContext({ nodesRegistry: fluxLoraRegistry })).missingBackendCapabilities,
    [],
  );
  assert.deepEqual(
    getTemplateReadiness(
      fluxLora,
      readinessContext({
        nodesRegistry: {
          ...fluxLoraRegistry,
          'modules.DiffusersImage.LoadAdapter': undefined,
        },
      }),
    ).missingBackendCapabilities,
    ['pinned LoRA adapter verification'],
  );
  assert.equal(
    getTemplateReadiness(
      quick,
      readinessContext({
        autoResourcePlan: {
          status: 'needs_setup',
          selectedInstallTarget: {
            repo: 'Tongyi-MAI/Z-Image-Turbo',
            label: 'Z-Image Turbo',
            actionLabel: 'Install',
          },
        },
      }),
    ).status,
    'needs_model',
  );
  assert.equal(
    getTemplateReadiness(
      quick,
      readinessContext({
        hfCache: ['Tongyi-MAI/Z-Image-Turbo'],
        autoResourcePlan: {
          status: 'needs_setup',
          healthBadge: 'Failed here before',
          blockingReason: 'The installed model needs a different runtime configuration.',
        },
      }),
    ).status,
    'needs_setup',
  );
  assert.equal(getTemplateReadiness(quick, readinessContext({ modelIndexesRefreshing: true })).status, 'preparing');
  assert.equal(getTemplateReadiness(quick, readinessContext({ runtime: null })).status, 'needs_backend');
  const controlMissingBackend = getTemplateReadiness(
    control,
    readinessContext({
      hfCache: ['Qwen/Qwen-Image-2512', 'InstantX/Qwen-Image-ControlNet-Union'],
      nodesRegistry: { 'modules.ModularDiffusers.ModelsLoader': {} },
    }),
  );
  assert.equal(controlMissingBackend.status, 'needs_backend');
  assert.equal(controlMissingBackend.label, 'Backend blocked');
  assert.equal(
    getTemplateReadiness(
      control,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-2512', 'InstantX/Qwen-Image-ControlNet-Union'],
        nodesRegistry: baseRegistry,
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      fastLora,
      readinessContext({
        hfCache: ['Tongyi-MAI/Z-Image-Turbo'],
        nodesRegistry: { 'modules.ModularDiffusers.ModelsLoader': {} },
      }),
    ).status,
    'needs_backend',
  );
  const missingPinnedLora = getTemplateReadiness(
    fastLora,
    readinessContext({
      hfCache: ['Tongyi-MAI/Z-Image-Turbo'],
      nodesRegistry: {
        'modules.ModularDiffusers.ModelsLoader': {},
        'modules.ModularDiffusers.Lora': {},
      },
    }),
  );
  assert.equal(missingPinnedLora.status, 'needs_model');
  assert.deepEqual(missingPinnedLora.missingModelRepos, ['youknownothing/v1-realism-v1-adapter-ZIT-lora']);
  assert.deepEqual(missingPinnedLora.missingInputs, []);
  assert.equal(
    getTemplateReadiness(
      fastLora,
      readinessContext({
        hfCache: ['Tongyi-MAI/Z-Image-Turbo', 'youknownothing/v1-realism-v1-adapter-ZIT-lora'],
        nodesRegistry: {
          'modules.ModularDiffusers.ModelsLoader': {},
          'modules.ModularDiffusers.Lora': {},
        },
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      upscale,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-2512'],
        nodesRegistry: { 'modules.Image.Preview': {} },
      }),
    ).status,
    'needs_backend',
  );
  const missingUpscaler = getTemplateReadiness(
    upscale,
    readinessContext({
      hfCache: ['Qwen/Qwen-Image-2512'],
      nodesRegistry: {
        'modules.Spandrel.Upscaler': {},
        'modules.Image.Preview': {},
      },
    }),
  );
  assert.equal(missingUpscaler.status, 'needs_model');
  assert.deepEqual(missingUpscaler.missingModelRepos, ['amd/realesrgan-x4plus']);
  assert.deepEqual(missingUpscaler.missingInputs, []);
  assert.equal(
    getTemplateReadiness(
      upscale,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-2512', 'amd/realesrgan-x4plus'],
        nodesRegistry: {
          'modules.Spandrel.Upscaler': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'ready',
  );
  const stormRegistry = {
    'modules.DiffusersVideo.LoadPipeline': {},
    'modules.DiffusersVideo.Generate': {},
    'modules.Spandrel.Upscaler': {},
    'modules.Video.Export': {},
  };
  const stormMissingUpscaler = getTemplateReadiness(
    storm,
    readinessContext({
      hfCache: ['Wan-AI/Wan2.1-T2V-1.3B-Diffusers'],
      nodesRegistry: stormRegistry,
    }),
  );
  assert.equal(stormMissingUpscaler.status, 'needs_model');
  assert.deepEqual(stormMissingUpscaler.missingModelRepos, ['nateraw/real-esrgan']);
  assert.deepEqual(stormMissingUpscaler.missingInputs, []);
  assert.equal(
    getTemplateReadiness(
      storm,
      readinessContext({
        hfCache: ['Wan-AI/Wan2.1-T2V-1.3B-Diffusers', 'nateraw/real-esrgan'],
        nodesRegistry: stormRegistry,
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      inpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: { 'modules.DiffusersImage.LoadPipeline': {} },
      }),
    ).status,
    'needs_backend',
  );
  assert.equal(
    getTemplateReadiness(
      inpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: {
          'modules.DiffusersImage.LoadPipeline': {},
          'modules.DiffusersImage.Inpaint': {},
          'modules.Image.Load': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      layered,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Layered'],
        nodesRegistry: { 'modules.Image.Preview': {} },
      }),
    ).status,
    'needs_backend',
  );
  assert.equal(
    getTemplateReadiness(
      layered,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Layered'],
        nodesRegistry: {
          'modules.ModularDiffusers.DecodeLatents': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(
      outpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: {
          'modules.DiffusersImage.LoadPipeline': {},
          'modules.DiffusersImage.Inpaint': {},
          'modules.Image.Load': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'needs_backend',
  );
  assert.equal(
    getTemplateReadiness(
      outpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: {
          'modules.DiffusersImage.LoadPipeline': {},
          'modules.DiffusersImage.OutpaintCanvas': {},
          'modules.DiffusersImage.Inpaint': {},
          'modules.Image.Load': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'ready',
  );
});

test('template and run surfaces share one structured readiness decision with precise categories', () => {
  const quick = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'z_image_quick_concept');
  assert.ok(quick);

  const ready = readinessModule.getTemplateReadiness(
    quick,
    readinessContext({ hfCache: ['Tongyi-MAI/Z-Image-Turbo'] }),
  );
  assert.equal(ready.status, 'ready');
  assert.equal(ready.decision.state, 'ready');
  assert.equal(ready.decision.canRun, true);

  const sourceRequired = readinessModule.getTemplateReadiness(
    {
      ...quick,
      inputRequirements: { sourceImage: true },
      inputBindings: [
        {
          id: 'required-source',
          label: 'Source image',
          mediaType: 'image',
          origin: 'user',
          requiredAt: 'workflow_start',
          field: 'referenceImages',
          count: 1,
        },
      ],
    },
    readinessContext({ hfCache: ['Tongyi-MAI/Z-Image-Turbo'] }),
  );
  assert.equal(sourceRequired.status, 'needs_input');
  assert.equal(sourceRequired.decision.state, 'blocked');
  assert.equal(sourceRequired.decision.primaryIssue.category, 'asset');

  const integrityRepair = readinessModule.getTemplateReadiness(
    quick,
    readinessContext({
      autoResourcePlan: {
        status: 'needs_setup',
        repairRequired: true,
        selectedInstallTarget: {
          repo: 'Tongyi-MAI/Z-Image-Turbo',
          label: 'Z-Image Turbo',
          repair: true,
        },
      },
    }),
  );
  assert.equal(integrityRepair.status, 'needs_model');
  assert.equal(integrityRepair.decision.primaryIssue.category, 'model_integrity');

  const packageDecision = runReadinessModule.buildRunReadinessDecision([
    {
      id: 'package:missing',
      category: 'package',
      severity: 'error',
      message: 'Backend package missing',
      blocking: true,
      action: 'open_setup',
    },
  ]);
  assert.equal(packageDecision.state, 'blocked');
  assert.equal(packageDecision.canRun, false);
  assert.equal(packageDecision.primaryIssue.category, 'package');
});

test('template input readiness is isolated from the active workflow and distinguishes downstream graph inputs', () => {
  const character = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'character_edit');
  const userInputTemplate = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'wan_22_i2v_seed_vault',
  );
  const qwenOutpaint = templatesModule.STUDIO_TEMPLATES.find(
    (template) => template.id === 'qwen_outpaint_aspect_template',
  );
  const wanOutpaint = templatesModule.STUDIO_TEMPLATES.find((template) => template.id === 'wan_vace_outpaint_reframe');
  assert.ok(character && userInputTemplate && qwenOutpaint && wanOutpaint);

  const userInputResolution = templateInputsModule.resolveTemplateInputs(userInputTemplate);
  assert.deepEqual(userInputResolution.missingLabels, ['1 reference image']);
  assert.equal(userInputResolution.templateDefaultBindings.length, 0);

  const characterResolution = templateInputsModule.resolveTemplateInputs(character);
  assert.deepEqual(characterResolution.missingLabels, []);
  assert.equal(characterResolution.templateDefaultBindings.length, 1);
  const wanResolution = templateInputsModule.resolveTemplateInputs(wanOutpaint);
  assert.deepEqual(wanResolution.missingLabels, []);
  assert.equal(wanResolution.templateDefaultBindings.length, 2);
  assert.deepEqual(
    wanResolution.templateDefaultBindings.map((binding) => binding.field),
    ['sourceVideo', 'maskVideo'],
  );

  const qwenResolution = templateInputsModule.resolveTemplateInputs(qwenOutpaint);
  assert.deepEqual(qwenResolution.missingLabels, []);
  assert.equal(qwenResolution.templateDefaultBindings.length, 1);
  assert.deepEqual(
    qwenResolution.downstreamBindings.map((binding) => [binding.producer.role, binding.producer.output]),
    [
      ['qwenOutpaintCanvas', 'image'],
      ['qwenOutpaintCanvas', 'mask'],
    ],
  );
});

test('Wan outpaint publishes byte-pinned runtime defaults and materializes backend paths before graph creation', async () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((entry) => entry.id === 'wan_vace_outpaint_reframe');
  assert.ok(template);
  const bindings = template.inputBindings.filter((binding) => binding.origin === 'template');
  assert.equal(bindings.length, 2);
  const assetManifest = JSON.parse(await readFile(path.join(ROOT, 'config', 'template-assets.v1.json'), 'utf8'));
  const assetManifestByPath = new Map(assetManifest.assets.map((asset) => [asset.path, asset]));

  for (const binding of bindings) {
    for (const asset of binding.defaultAssets) {
      const storageRecord = assetManifestByPath.get(asset.runtimePath.replace(/^\/+/, ''));
      assert.ok(storageRecord, `${asset.id} is published in the storage manifest`);
      assert.equal(storageRecord.sha256, asset.runtimeSha256, `${asset.id} retains its reviewed runtime-byte identity`);
    }
  }
  assert.notEqual(
    bindings[0].defaultAssets[0].runtimePath,
    bindings[0].defaultAssets[0].previewPath,
    'the browser-safe Before derivative is not reused as the runtime source',
  );
  const changedInputTemplate = structuredClone(template);
  changedInputTemplate.inputBindings.find((binding) => binding.origin === 'template').defaultAssets[0].runtimeSha256 =
    'sha256:bytes:changed-reviewed-input';
  assert.notEqual(
    templateExactnessModule.getTemplateInputContractHash(changedInputTemplate),
    templateExactnessModule.getTemplateInputContractHash(template),
    'changing a bundled runtime input invalidates the gallery proof contract',
  );

  const uploaded = [];
  const expectedHashes = new Map(
    bindings.flatMap((binding) => binding.defaultAssets.map((asset) => [asset.id, asset.runtimeSha256])),
  );
  const patch = await templateInputsModule.materializeTemplateDefaultInputs(template, {
    load: async (asset) => new Blob([asset.id], { type: 'video/mp4' }),
    sha256: async (blob) => expectedHashes.get(await blob.text()),
    upload: async (file, mediaType) => {
      uploaded.push({ name: file.name, mediaType, contents: await file.text() });
      return `data/videos/${file.name}`;
    },
  });

  assert.deepEqual(
    patch,
    Object.fromEntries(bindings.map((binding) => [binding.field, `data/videos/${binding.defaultAssets[0].fileName}`])),
  );
  assert.deepEqual(
    uploaded.map(({ name, mediaType, contents }) => ({ name, mediaType, contents })),
    bindings.flatMap((binding) =>
      binding.defaultAssets.map((asset) => ({
        name: asset.fileName,
        mediaType: asset.mediaType,
        contents: asset.id,
      })),
    ),
  );

  let rejectedUploadCalls = 0;
  await assert.rejects(
    templateInputsModule.materializeTemplateDefaultInputs(template, {
      load: async () => new Blob(['stale-input'], { type: 'video/mp4' }),
      sha256: async () => 'sha256:bytes:stale-input',
      upload: async () => {
        rejectedUploadCalls += 1;
        return 'data/videos/should-not-exist.mp4';
      },
    }),
    /failed checksum verification/,
  );
  assert.equal(rejectedUploadCalls, 0, 'a stale bundled input is rejected before backend upload');
});

test('Qwen outpaint templates fully denoise the generated canvas boundary', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  for (const id of ['qwen_outpaint_aspect_template', 'qwen_outpaint_draft']) {
    const template = STUDIO_TEMPLATES.find((candidate) => candidate.id === id);
    assert.ok(template, `missing ${id}`);
    assert.equal(template.example.lockedSettings.strength, 1, `${id} must fill blank outpaint margins`);
  }
});

test('unknown template ids are discarded instead of entering persisted output state', () => {
  for (const template of [...templatesModule.STUDIO_TEMPLATES, ...templatesModule.PLANNING_STUDIO_TEMPLATES]) {
    assert.equal(
      outputContractsModule.coerceStudioTemplateId(template.id),
      template.id,
      `${template.id} remains accepted by persistence coercion`,
    );
  }
  const obsoleteTemplateId = 'obsolete_qwen_outpaint_template';
  assert.equal(outputContractsModule.coerceStudioTemplateId(obsoleteTemplateId), undefined);
  const output = outputContractsModule.coerceStudioOutput({
    id: 'obsolete-template-output',
    url: '/file?file=obsolete-template-output.png',
    mode: 'outpaint',
    modelType: 'QwenImageEditModularPipeline',
    templateId: obsoleteTemplateId,
    formSnapshot: {
      ...profilesModule.DEFAULT_STUDIO_FORM,
      mode: 'outpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
  });
  assert.equal(output.templateId, undefined);
});

test('template metadata declares graph blocks for recipes that need them', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  assert.deepEqual(STUDIO_TEMPLATES.find((template) => template.id === 'fast_lora')?.workflowBlocks, ['lora']);
  assert.deepEqual(STUDIO_TEMPLATES.find((template) => template.id === 'z_image_lora_style')?.workflowBlocks, ['lora']);
  assert.deepEqual(STUDIO_TEMPLATES.find((template) => template.id === 'qwen_upscale_finish')?.workflowBlocks, [
    'upscaler',
  ]);
});

test('Qwen Auto text-to-image templates lock quality-first Auto model-offload settings', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const ids = ['qwen_low_vram_text_rendering', 'qwen_low_vram_product_concept', 'qwen_low_vram_poster_layout'];
  const expectedDimensions = {
    qwen_low_vram_text_rendering: [1024, 1024],
    qwen_low_vram_product_concept: [1024, 768],
    qwen_low_vram_poster_layout: [768, 1024],
  };
  for (const id of ids) {
    const template = STUDIO_TEMPLATES.find((item) => item.id === id);
    assert.ok(template, `${id} exists`);
    assert.equal(template.mode, 'text_to_image');
    assert.equal(template.modelType, 'QwenImageModularPipeline');
    assert.notEqual(template.category, 'upscale');
    assert.ok(template.tags.includes('low vram'));
    assert.ok(template.requiredBackendCapabilities.includes('Qwen direct Auto Diffusers path'));
    assert.equal(template.example.lockedSettings.resourceMode, 'auto');
    assert.equal(template.example.lockedSettings.width, expectedDimensions[id][0]);
    assert.equal(template.example.lockedSettings.height, expectedDimensions[id][1]);
    assert.equal(template.example.lockedSettings.steps, 50);
    assert.equal(template.example.lockedSettings.guidanceScale, 4);
    assert.equal(template.example.lockedSettings.quantizationMode, 'none');
    assert.equal(template.example.lockedSettings.offloadMode, 'model_cpu');
    assert.equal(template.example.lockedSettings.autoOffload, true);
  }
});

test('published FLUX-dev base and LoRA templates allow Auto to choose hardware placement', () => {
  const ids = [
    'flux_dev_expert_text_to_image',
    'flux_lora_ghibli_story',
    'flux_lora_oil_painting',
    'flux_lora_film_noir',
    'flux_lora_retro_comic',
    'flux_lora_watercolor',
    'flux_lora_paper_cutout',
    'flux_lora_photoreal_documentary',
  ];
  for (const id of ids) {
    const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === id);
    assert.ok(template, `${id} exists`);
    assert.equal(template.modelType, 'FluxDevPipeline');
    assert.equal(template.example.lockedSettings.resourceMode, 'auto');
  }
});

test('Qwen ControlNet keeps diffusion guidance separate from the bounded control scale', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'qwen_control_image_layout');
  assert.ok(template);
  assert.equal(template.example.lockedSettings.guidanceScale, 4);
  assert.equal(template.example.lockedSettings.conditioningScale, 1.2);
  assert.equal(template.example.lockedSettings.resourceMode, 'auto');
  assert.equal(template.example.lockedSettings.quantizationMode, 'none');
  assert.equal(template.example.lockedSettings.offloadMode, 'none');
});

test('High-detail Qwen template exposes the documentary bakery preview and Auto settings', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const template = STUDIO_TEMPLATES.find((item) => item.id === 'high_quality');
  assert.ok(template);
  assert.equal(template.mode, 'text_to_image');
  assert.equal(template.modelType, 'QwenImageModularPipeline');
  assert.match(template.userGoal, /documentary bakery preview/);
  assert.ok(template.tags.includes('bakery documentary'));
  assert.ok(template.requiredBackendCapabilities.includes('Qwen direct Auto Diffusers path'));
  assert.deepEqual(template.mediaSlots, [
    {
      id: 'primary',
      label: 'Preview',
      kind: 'image',
      role: 'preview',
      path: '/template-gallery/high_quality.webp',
      placeholder: 'image example pending',
    },
  ]);
  assert.equal(template.example.lockedSettings.resourceMode, 'auto');
  assert.equal(template.example.lockedSettings.width, 1024);
  assert.equal(template.example.lockedSettings.height, 1024);
  assert.equal(template.example.lockedSettings.steps, 50);
  assert.equal(template.example.lockedSettings.guidanceScale, 4);
  assert.equal(template.example.lockedSettings.quantizationMode, 'none');
  assert.equal(template.example.lockedSettings.offloadMode, 'model_cpu');
  assert.equal(template.example.lockedSettings.autoOffload, true);
});

test('Qwen model profiles show exact repo-backed model names', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.QwenImageModularPipeline;
  const editProfile = profilesModule.STUDIO_MODEL_PROFILES.QwenImageEditModularPipeline;
  const editPlusProfile = profilesModule.STUDIO_MODEL_PROFILES.QwenImageEditPlusModularPipeline;
  const editPlusAuto = profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.QwenImageEditPlusModularPipeline;
  assert.equal(profile.label, 'Qwen-Image-2512');
  assert.equal(profile.displayName, 'Qwen-Image-2512');
  assert.equal(profile.defaultRepo, 'Qwen/Qwen-Image-2512');
  assert.equal(profile.alternateArtifact, undefined);
  assert.equal(editProfile.supportsMask, true);
  assert.equal(editProfile.inpaintContract.available, true);
  assert.equal(editProfile.inpaintContract.source, 'modules.DiffusersImage.Inpaint');
  assert.deepEqual(editProfile.modes, ['edit_image', 'inpaint', 'outpaint']);
  assert.deepEqual(profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.QwenImageEditModularPipeline.supportedModes, [
    'edit_image',
    'inpaint',
    'outpaint',
  ]);
  assert.deepEqual(editPlusProfile.modes, ['edit_image', 'multi_image_reference_edit']);
  assert.deepEqual(editPlusAuto.supportedModes, ['edit_image', 'multi_image_reference_edit']);
  assert.equal(editPlusProfile.inpaintContract.available, false);
  assert.equal(profilesModule.isModelCompatibleWithMode('QwenImageEditPlusModularPipeline', 'inpaint'), false);
  assert.equal(profilesModule.isModelCompatibleWithMode('QwenImageEditModularPipeline', 'inpaint'), true);
  assert.deepEqual(profile.offloadSupport.modes, ['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk']);
  assert.equal(profile.offloadSupport.default, 'model_cpu');
  assert.equal(profile.offloadSupport.lowVram, 'model_cpu');
  assert.equal(
    profilesModule.getStudioModelRuntimeLabel(profile, {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'auto_cpu',
    }),
    'Qwen/Qwen-Image-2512 · bfloat16 · model-cpu',
  );
  assert.equal(
    profilesModule.getStudioModelRuntimeLabel(profile, {
      dtype: 'bfloat16',
      quantizationMode: 'bnb_4bit',
      autoOffload: true,
      offloadMode: 'model_cpu',
    }),
    'Qwen/Qwen-Image-2512 · bfloat16 · bnb_4bit · model-cpu',
  );
});

test('every Studio model declares Auto requirements or an explicit Manual-only reason', () => {
  const profileIds = Object.keys(profilesModule.STUDIO_MODEL_PROFILES).sort();
  const requirementIds = Object.keys(profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS).sort();
  assert.deepEqual(requirementIds, profileIds);

  for (const id of profileIds) {
    const requirement = profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS[id];
    assert.ok(requirement.minimum, `${id} declares minimum hardware requirements`);
    assert.ok(requirement.recommended, `${id} declares recommended hardware requirements`);
    assert.ok(requirement.qualityDefaults, `${id} declares quality-safe defaults`);
    if (profilesModule.STUDIO_MODEL_PROFILES[id].artifactInstallRequired === false) {
      assert.deepEqual(requirement.artifacts, [], `${id} does not invent an installable artifact`);
    } else {
      assert.ok(requirement.artifacts.length > 0, `${id} declares required artifacts`);
    }
    if (requirement.autoStatus === 'manual_only') {
      assert.ok(requirement.manualOnlyReason, `${id} explains why Auto is not enabled`);
    }
  }
});

test('built-in image operations are locally ready without model discovery or installation', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.BuiltinImageOperation;
  const requirement = profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.BuiltinImageOperation;
  assert.equal(profile.runtimeKind, 'builtin');
  assert.equal(profile.artifactKind, 'builtin');
  assert.equal(profile.artifactInstallRequired, false);
  assert.equal(profile.defaultRepo, 'builtin://modiff/image-operations/v1');
  assert.deepEqual(profile.modes, [
    'image_adjustment',
    'image_filter',
    'image_crop',
    'image_upscale',
    'image_stitch',
    'image_tile',
    'image_channels',
    'mask_composite',
  ]);
  assert.deepEqual(requirement.artifacts, []);
  assert.equal(profilesModule.getStudioModelRuntimeLabel(profile), 'Built-in · CPU · no model download');

  const status = modelCacheModule.getStudioModelCacheStatus(profile, [], [], null);
  assert.equal(status.installed, true);
  assert.equal(status.runnable, true);
  assert.match(status.reason, /no model installation/i);

  const inferred = workflowInferenceModule.inferStudioFormFromWorkflow(
    [
      {
        data: {
          module: 'modules.ImageOperations',
          action: 'ProcessImage',
          studioRole: 'imageOperation',
          params: { operation: { value: 'image_filter' } },
        },
      },
    ],
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(inferred.modelType, 'BuiltinImageOperation');
  assert.equal(inferred.mode, 'image_filter');
});

test('built-in data operations are locally ready and preserve source text inference', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.BuiltinDataOperation;
  const requirement = profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.BuiltinDataOperation;
  assert.equal(profile.runtimeKind, 'builtin');
  assert.equal(profile.artifactKind, 'builtin');
  assert.equal(profile.artifactInstallRequired, false);
  assert.equal(profile.defaultRepo, 'builtin://modiff/data-operations/v1');
  assert.deepEqual(profile.modes, ['text_select', 'data_conversion', 'graph_utility']);
  assert.deepEqual(requirement.artifacts, []);
  assert.equal(profilesModule.getDefaultModelForMode('text_select'), 'BuiltinDataOperation');
  assert.equal(profilesModule.getDefaultModelForMode('graph_utility'), 'BuiltinDataOperation');
  assert.equal(profilesModule.getStudioModelRuntimeLabel(profile), 'Built-in · CPU · no model download');

  const status = modelCacheModule.getStudioModelCacheStatus(profile, [], [], null);
  assert.equal(status.installed, true);
  assert.equal(status.runnable, true);
  assert.match(status.reason, /no model installation/i);

  const inferred = workflowInferenceModule.inferStudioFormFromWorkflow(
    [
      {
        data: {
          module: 'modules.Text',
          action: 'ProcessText',
          studioRole: 'dataOperation',
          params: {
            operation: { value: 'text_select' },
            source: { value: 'first\nsecond' },
          },
        },
      },
    ],
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(inferred.modelType, 'BuiltinDataOperation');
  assert.equal(inferred.mode, 'text_select');
  assert.equal(inferred.prompt, 'first\nsecond');
});

test('built-in audio operations are locally ready and preserve dual-source inference', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.BuiltinAudioOperation;
  const requirement = profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.BuiltinAudioOperation;
  assert.equal(profile.runtimeKind, 'builtin');
  assert.equal(profile.artifactKind, 'builtin');
  assert.equal(profile.artifactInstallRequired, false);
  assert.equal(profile.defaultRepo, 'builtin://modiff/audio-operations/v1');
  assert.deepEqual(profile.modes, ['audio_trim', 'audio_join', 'audio_loudness_match']);
  assert.deepEqual(profile.modeRequirements, {
    audio_trim: { requiredAudio: ['sourceAudio'] },
    audio_join: { requiredAudio: ['sourceAudio', 'referenceAudio'] },
    audio_loudness_match: { requiredAudio: ['sourceAudio', 'referenceAudio'] },
  });
  assert.deepEqual(requirement.artifacts, []);
  assert.equal(profilesModule.getDefaultModelForMode('audio_trim'), 'BuiltinAudioOperation');
  assert.equal(profilesModule.getStudioModelRuntimeLabel(profile), 'Built-in · CPU · no model download');

  const status = modelCacheModule.getStudioModelCacheStatus(profile, [], [], null);
  assert.equal(status.installed, true);
  assert.equal(status.runnable, true);

  const inferred = workflowInferenceModule.inferStudioFormFromWorkflow(
    [
      {
        data: {
          module: 'modules.Audio',
          action: 'Load',
          studioRole: 'loadAudio',
          params: { file: { value: 'source.wav' } },
        },
      },
      {
        data: {
          module: 'modules.Audio',
          action: 'Load',
          studioRole: 'loadReferenceAudio',
          params: { file: { value: 'reference.wav' } },
        },
      },
      {
        data: {
          module: 'modules.Audio',
          action: 'ProcessAudio',
          studioRole: 'audioOperation',
          params: { operation: { value: 'audio_loudness_match' } },
        },
      },
    ],
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(inferred.modelType, 'BuiltinAudioOperation');
  assert.equal(inferred.mode, 'audio_loudness_match');
  assert.equal(inferred.sourceAudio, 'source.wav');
  assert.equal(inferred.referenceAudio, 'reference.wav');
});

test('built-in video operations are locally ready and preserve multi-video inference', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.BuiltinVideoOperation;
  const requirement = profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.BuiltinVideoOperation;
  assert.equal(profile.runtimeKind, 'builtin');
  assert.equal(profile.artifactKind, 'builtin');
  assert.equal(profile.artifactInstallRequired, false);
  assert.equal(profile.defaultRepo, 'builtin://modiff/video-operations/v1');
  assert.deepEqual(profile.modes, [
    'video_frame_extract',
    'frame_interpolation',
    'video_stitch',
    'video_trim',
    'video_reverse',
    'video_tile',
  ]);
  assert.deepEqual(requirement.artifacts, []);
  assert.equal(profilesModule.getStudioModelRuntimeLabel(profile), 'Built-in · CPU · no model download');

  const status = modelCacheModule.getStudioModelCacheStatus(profile, [], [], null);
  assert.equal(status.installed, true);
  assert.equal(status.runnable, true);

  const inferred = workflowInferenceModule.inferStudioFormFromWorkflow(
    [
      {
        data: {
          module: 'modules.Video',
          action: 'ProcessVideo',
          studioRole: 'videoOperation',
          params: {
            operation: { value: 'video_stitch' },
            videos: { value: ['first.mp4', 'second.mp4'] },
          },
        },
      },
    ],
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(inferred.modelType, 'BuiltinVideoOperation');
  assert.equal(inferred.mode, 'video_stitch');
  assert.deepEqual(inferred.referenceVideos, ['first.mp4', 'second.mp4']);

  const trimmed = workflowInferenceModule.inferStudioFormFromWorkflow(
    [
      {
        data: {
          module: 'modules.Video',
          action: 'ProcessVideo',
          studioRole: 'videoOperation',
          params: {
            operation: { value: 'video_trim' },
            videos: { value: ['source.mp4'] },
          },
        },
      },
    ],
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(trimmed.mode, 'video_trim');
  assert.equal(trimmed.sourceVideo, 'source.mp4');

  const interpolated = workflowInferenceModule.inferStudioFormFromWorkflow(
    [
      {
        data: {
          module: 'modules.Video',
          action: 'ProcessVideo',
          studioRole: 'videoOperation',
          params: {
            operation: { value: 'frame_interpolation' },
            videos: { value: ['source.mp4'] },
            interpolation_fps: { value: 60 },
          },
        },
      },
      {
        data: {
          module: 'modules.Video',
          action: 'Export',
          studioRole: 'videoExport',
          params: { fps: { value: 60 } },
        },
      },
    ],
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(interpolated.mode, 'frame_interpolation');
  assert.equal(interpolated.sourceVideo, 'source.mp4');
  assert.equal(interpolated.fps, 60);
  assert.equal(profilesModule.getFormDefaultsForMode('frame_interpolation', 'BuiltinVideoOperation').fps, 60);

  const tiled = workflowInferenceModule.inferStudioFormFromWorkflow(
    [
      {
        data: {
          module: 'modules.Video',
          action: 'ProcessVideo',
          studioRole: 'videoOperation',
          params: {
            operation: { value: 'video_tile' },
            videos: { value: ['first.mp4', 'second.mp4'] },
          },
        },
      },
    ],
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(tiled.mode, 'video_tile');
  assert.deepEqual(tiled.referenceVideos, ['first.mp4', 'second.mp4']);
});

test('Real-ESRGAN video upscale stays model-backed and infers the generic source-video contract', () => {
  const profile = profilesModule.STUDIO_MODEL_PROFILES.SpandrelVideoUpscale;
  const requirement = profilesModule.STUDIO_AUTO_MODEL_REQUIREMENTS.SpandrelVideoUpscale;
  assert.equal(profile.runtimeKind, 'spandrel');
  assert.equal(profile.artifactKind, 'spandrel_upscaler');
  assert.equal(profile.artifactInstallRequired, true);
  assert.equal(profile.defaultRepo, 'nateraw/real-esrgan');
  assert.deepEqual(profile.downloadFiles, ['RealESRGAN_x2plus.pth']);
  assert.deepEqual(profile.revisionCandidates, ['42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094']);
  assert.deepEqual(profile.modes, ['video_upscale']);
  assert.deepEqual(requirement.artifacts, ['nateraw/real-esrgan']);

  const inferred = workflowInferenceModule.inferStudioFormFromWorkflow(
    [
      {
        data: {
          module: 'modules.Video',
          action: 'UpscaleVideo',
          studioRole: 'videoUpscaler',
          params: {
            operation: { value: 'video_upscale' },
            video: { value: '/managed/source.mp4' },
            device: { value: 'cpu' },
            fps: { value: 30 },
          },
        },
      },
    ],
    profilesModule.DEFAULT_STUDIO_FORM,
  );
  assert.equal(inferred.modelType, 'SpandrelVideoUpscale');
  assert.equal(inferred.mode, 'video_upscale');
  assert.equal(inferred.sourceVideo, '/managed/source.mp4');
  assert.equal(inferred.device, 'cpu');
  assert.equal(inferred.fps, 30);
});

test('video stitching requires two local source videos before execution', () => {
  const previousCapabilities = nodesStoreModule.useNodesStore.getState().studioModelCapabilities;
  const previousAuthoritative = nodesStoreModule.useNodesStore.getState().studioModelCapabilitiesAuthoritative;
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;

  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [],
      studioModelCapabilitiesAuthoritative: false,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });
    const baseForm = {
      ...profilesModule.getFormDefaultsForMode('video_stitch', 'BuiltinVideoOperation'),
      referenceVideos: ['first.mp4'],
    };
    studioStoreModule.useStudioStore.setState({ form: baseForm, graphBinding: null });
    let messages = runReadinessModule
      .collectRunReadinessIssues({ sid: 'contract-test', isConnected: true })
      .map(({ message }) => message);
    assert.ok(messages.some((message) => /2 source videos/i.test(message)));

    studioStoreModule.useStudioStore.setState({
      form: { ...baseForm, referenceVideos: ['first.mp4', 'second.mp4'] },
    });
    messages = runReadinessModule
      .collectRunReadinessIssues({ sid: 'contract-test', isConnected: true })
      .map(({ message }) => message);
    assert.equal(
      messages.some((message) => /source videos/i.test(message)),
      false,
    );
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousCapabilities,
      studioModelCapabilitiesAuthoritative: previousAuthoritative,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

test('mask compositing requires two source images and one mask before execution', () => {
  const previousCapabilities = nodesStoreModule.useNodesStore.getState().studioModelCapabilities;
  const previousAuthoritative = nodesStoreModule.useNodesStore.getState().studioModelCapabilitiesAuthoritative;
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;

  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [],
      studioModelCapabilitiesAuthoritative: false,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });
    const baseForm = {
      ...profilesModule.getFormDefaultsForMode('mask_composite', 'BuiltinImageOperation'),
      referenceImages: ['background.png'],
      maskImage: '',
    };
    studioStoreModule.useStudioStore.setState({ form: baseForm, graphBinding: null });
    let messages = runReadinessModule
      .collectRunReadinessIssues({ sid: 'contract-test', isConnected: true })
      .map(({ message }) => message);
    assert.ok(messages.some((message) => /2 source images/i.test(message)));
    assert.ok(messages.some((message) => /mask image/i.test(message)));

    studioStoreModule.useStudioStore.setState({
      form: {
        ...baseForm,
        referenceImages: ['background.png', 'foreground.png'],
        maskImage: 'mask.png',
      },
    });
    messages = runReadinessModule
      .collectRunReadinessIssues({ sid: 'contract-test', isConnected: true })
      .map(({ message }) => message);
    assert.equal(
      messages.some((message) => /source images|required.*mask image/i.test(message)),
      false,
    );
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousCapabilities,
      studioModelCapabilitiesAuthoritative: previousAuthoritative,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

test('image stitching requires at least two source images before execution', () => {
  const previousCapabilities = nodesStoreModule.useNodesStore.getState().studioModelCapabilities;
  const previousAuthoritative = nodesStoreModule.useNodesStore.getState().studioModelCapabilitiesAuthoritative;
  const previousForm = studioStoreModule.useStudioStore.getState().form;
  const previousNodes = flowStoreModule.useFlowStore.getState().nodes;
  const previousEdges = flowStoreModule.useFlowStore.getState().edges;

  try {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: [],
      studioModelCapabilitiesAuthoritative: false,
    });
    flowStoreModule.useFlowStore.setState({ nodes: [], edges: [] });
    const baseForm = {
      ...profilesModule.getFormDefaultsForMode('image_stitch', 'BuiltinImageOperation'),
      referenceImages: ['first.png'],
    };
    studioStoreModule.useStudioStore.setState({ form: baseForm, graphBinding: null });
    let messages = runReadinessModule
      .collectRunReadinessIssues({ sid: 'contract-test', isConnected: true })
      .map(({ message }) => message);
    assert.ok(messages.some((message) => /2 source images/i.test(message)));

    studioStoreModule.useStudioStore.setState({
      form: { ...baseForm, referenceImages: ['first.png', 'second.png'] },
    });
    messages = runReadinessModule
      .collectRunReadinessIssues({ sid: 'contract-test', isConnected: true })
      .map(({ message }) => message);
    assert.equal(
      messages.some((message) => /2 source images/i.test(message)),
      false,
    );
  } finally {
    nodesStoreModule.useNodesStore.setState({
      studioModelCapabilities: previousCapabilities,
      studioModelCapabilitiesAuthoritative: previousAuthoritative,
    });
    studioStoreModule.useStudioStore.setState({ form: previousForm });
    flowStoreModule.useFlowStore.setState({ nodes: previousNodes, edges: previousEdges });
  }
});

test('Studio form migration normalizes legacy offload and leaves quantization to exact readiness', () => {
  const legacy = outputContractsModule.coerceStudioFormState({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'QwenImageModularPipeline',
    offloadMode: 'auto_cpu',
  });
  assert.equal(legacy.offloadMode, 'model_cpu');

  const zImage = outputContractsModule.coerceStudioFormState({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'ZImageModularPipeline',
    quantizationMode: 'bnb_4bit',
    offloadMode: 'group_disk',
  });
  assert.equal(zImage.quantizationMode, 'bnb_4bit');
  assert.equal(zImage.offloadMode, 'group_disk');

  const speech = outputContractsModule.coerceStudioFormState({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'speech_to_text',
    modelType: 'HuggingFaceSpeechRecognitionModel',
    speechLanguage: 'French',
    speechTimestamps: 'sentence',
    speechChunkSeconds: 20,
    speechStrideSeconds: 3,
  });
  assert.equal(speech.speechLanguage, 'French');
  assert.equal(speech.speechTimestamps, 'segment');
  assert.equal(speech.speechChunkSeconds, 20);
  assert.equal(speech.speechStrideSeconds, 3);
});

test('every registered Studio model survives persisted form and binding validation', () => {
  for (const modelType of Object.keys(profilesModule.STUDIO_MODEL_PROFILES)) {
    const form = outputContractsModule.coerceStudioFormState({
      ...profilesModule.DEFAULT_STUDIO_FORM,
      modelType,
    });
    assert.equal(form.modelType, modelType, `${modelType} must not be replaced while restoring a workflow form`);

    const binding = outputContractsModule.coerceStudioGraphBinding({
      mode: form.mode,
      modelType,
      nodes: {},
      managedNodeIds: [],
      managedEdgeIds: [],
      fingerprint: `${form.mode}:${modelType}`,
      createdAt: 1,
      updatedAt: 1,
    });
    assert.equal(binding?.modelType, modelType, `${modelType} must not be replaced while restoring graph binding`);
  }
});

test('completed graph finalization proofs survive persistence validation', () => {
  const proof = {
    schemaVersion: 2,
    shapeKey: 'edit_image:QwenImageEditModularPipeline:expert:none:models|prompt|denoise',
    fieldSchemaHash: 'graph-v1-0123abcd',
    edgeSpecHash: 'graph-v1-4567cdef',
    finalizedAt: 1234,
  };
  const binding = outputContractsModule.coerceStudioGraphBinding({
    mode: 'edit_image',
    modelType: 'QwenImageEditModularPipeline',
    nodes: {},
    managedNodeIds: [],
    managedEdgeIds: [],
    fingerprint: 'edit_image:QwenImageEditModularPipeline:expert:none',
    finalizationProof: proof,
    createdAt: 1,
    updatedAt: 2,
  });
  assert.deepEqual(binding?.finalizationProof, proof);

  const malformed = outputContractsModule.coerceStudioGraphBinding({
    ...binding,
    finalizationProof: { ...proof, schemaVersion: 1 },
  });
  assert.equal(malformed?.finalizationProof, undefined);
  assert.equal(malformed?.finalizationProofInvalid, true);
});

test('Studio execution-spec receipts are exact and malformed persistence is quarantined', () => {
  const executionSpec = {
    schemaVersion: 1,
    id: 'flux-schnell:text-to-image:v1',
    contentHash: 'studio-spec-v1-9cd1abb5',
    executionProfileId: 'flux-schnell:direct',
  };
  const base = {
    mode: 'text_to_image',
    modelType: 'FluxSchnellPipeline',
    nodes: {},
    managedNodeIds: [],
    managedEdgeIds: [],
    fingerprint: 'text_to_image:FluxSchnellPipeline:expert:none',
    executionSpec,
    createdAt: 1,
    updatedAt: 2,
  };
  const binding = outputContractsModule.coerceStudioGraphBinding(base);
  assert.deepEqual(binding?.executionSpec, executionSpec);
  assert.equal(binding?.finalizationProofInvalid, undefined);

  for (const malformedReceipt of [
    { ...executionSpec, schemaVersion: 2 },
    { ...executionSpec, id: 'invalid receipt' },
    { ...executionSpec, contentHash: 'studio-spec-v1-not-a-hash' },
    { ...executionSpec, executionProfileId: '' },
    { ...executionSpec, unexpected: true },
  ]) {
    const malformed = outputContractsModule.coerceStudioGraphBinding({ ...base, executionSpec: malformedReceipt });
    assert.equal(malformed?.executionSpec, undefined);
    assert.equal(malformed?.finalizationProofInvalid, true);
  }
});

test('controlled graph declarations require an exact schema-v3 persistence proof', () => {
  const controlled = {
    schemaVersion: 1,
    contractRevision: 1,
    contractIds: ['upscale.video.v1'],
  };
  const proof = {
    schemaVersion: 3,
    canonicalizationVersion: 1,
    contractRevision: 1,
    shapeKey: 'text_to_video:WanVideoPipeline:expert:none:runtime|generate|export',
    fieldSchemaHash: 'graph-v1-0123abcd',
    managedGraphHash: 'graph-v1-4567cdef',
    contractIds: controlled.contractIds,
    finalizedAt: 1234,
  };
  const base = {
    mode: 'text_to_video',
    modelType: 'WanVideoPipeline',
    nodes: {},
    managedNodeIds: [],
    managedEdgeIds: [],
    fingerprint: 'text_to_video:WanVideoPipeline:expert:none',
    controlled,
    finalizationProof: proof,
    createdAt: 1,
    updatedAt: 2,
  };
  const binding = outputContractsModule.coerceStudioGraphBinding(base);
  assert.deepEqual(binding?.controlled, controlled);
  assert.deepEqual(binding?.finalizationProof, proof);
  assert.equal(binding?.finalizationProofInvalid, undefined);

  const malformedCases = [
    { ...base, controlled: { ...controlled, contractIds: ['unknown.v1'] } },
    { ...base, finalizationProof: { ...proof, schemaVersion: 2, edgeSpecHash: 'graph-v1-89abcdef' } },
    { ...base, finalizationProof: { ...proof, managedGraphHash: 'not-a-proof-hash' } },
    { ...base, finalizationProof: { ...proof, contractIds: ['soundtrack.v1'] } },
  ];
  malformedCases.forEach((value) => {
    const malformed = outputContractsModule.coerceStudioGraphBinding(value);
    assert.equal(malformed?.finalizationProof, undefined);
    assert.equal(malformed?.finalizationProofInvalid, true);
  });
});

test('Qwen-Image-2512 Auto remains backend-owned while Expert blocks unsafe settings', (t) => {
  const previousCapabilityState = {
    studioModelCapabilities: nodesStoreModule.useNodesStore.getState().studioModelCapabilities,
    studioExecutionSpecInvalid: nodesStoreModule.useNodesStore.getState().studioExecutionSpecInvalid,
  };
  t.after(() => nodesStoreModule.useNodesStore.setState(previousCapabilityState));
  const expertCudaPolicy = {
    schema_version: 1,
    blocked_dtypes: ['float32'],
    recommended_dtype: 'bfloat16',
    offloaded_vram_bytes: 12 * 1024 ** 3,
    resident_vram_bytes: 80 * 1024 ** 3,
    quantized_resident_vram_bytes: [['bnb_4bit', 24 * 1024 ** 3]],
  };
  const expertQuantizationPolicy = {
    schema_version: 1,
    quantization_mode: 'bnb_4bit',
    offload_mode: 'model_cpu',
    modular_node: 'modules.ModularDiffusers.QuantizationConfigNode',
    subfolder: 'transformer',
    component: 'reviewed_low_vram',
    four_bit_quant_type: 'nf4',
    compute_dtype: 'bfloat16',
    double_quant: true,
  };
  const expertMpsPolicy = {
    schema_version: 1,
    qualification: 'experimental',
    fallback_action: 'open_setup',
  };
  nodesStoreModule.useNodesStore.setState({
    studioExecutionSpecInvalid: false,
    studioModelCapabilities: [
      {
        modelType: 'QwenImageModularPipeline',
        executionProfiles: [
          {
            id: 'qwen-image:t2i-direct',
            modes: ['text_to_image'],
            expert_cuda_policy: expertCudaPolicy,
            expert_quantization_policy: expertQuantizationPolicy,
            expert_quantization_modes: ['bnb_4bit'],
            expert_mps_policy: expertMpsPolicy,
          },
        ],
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: ['text_to_image'],
        studioExecutionSpecs: [{ mode: 'text_to_image', executionProfileId: 'qwen-image:t2i-direct' }],
      },
    ],
  });
  const form = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    device: 'cuda:0',
    dtype: 'bfloat16',
    autoOffload: true,
    quantizationMode: 'none',
  };
  const mpsIssue = runReadinessModule.getStudioMpsCompatibilityIssue({ ...form, device: 'mps:0' });
  assert.match(mpsIssue.message, /experimental/);
  assert.equal(mpsIssue.action, 'open_setup');
  const issue = runReadinessModule.getStudioCudaCapacityIssue(
    form,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  );
  assert.equal(issue, null, 'Auto hardware compatibility must come from the backend plan');

  const manualIssue = runReadinessModule.getStudioCudaCapacityIssue(
    { ...form, resourceMode: 'manual' },
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  );
  assert.equal(manualIssue, null);

  const roomyIssue = runReadinessModule.getStudioCudaCapacityIssue(
    { ...form, resourceMode: 'manual' },
    runtimeStatus({
      totalBytes: 24 * 1024 ** 3,
      freeBytes: 18 * 1024 ** 3,
    }),
  );
  assert.equal(roomyIssue, null);

  const float32Issue = runReadinessModule.getStudioCudaCapacityIssue(
    { ...form, resourceMode: 'manual', dtype: 'float32' },
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  );
  assert.equal(float32Issue.blocking, true);
  assert.match(float32Issue.message, /bfloat16/);

  const offloadIssue = runReadinessModule.getStudioCudaCapacityIssue(
    { ...form, resourceMode: 'manual', autoOffload: false },
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  );
  assert.equal(offloadIssue.blocking, true);
  assert.match(offloadIssue.message, /auto-offload/);

  const residentQuantizedIssue = runReadinessModule.getStudioCudaCapacityIssue(
    {
      ...form,
      resourceMode: 'expert',
      autoOffload: false,
      quantizationMode: 'bnb_4bit',
    },
    runtimeStatus({
      totalBytes: 24 * 1024 ** 3,
      freeBytes: 22 * 1024 ** 3,
    }),
  );
  assert.equal(residentQuantizedIssue, null);

  const residentBfloat16Issue = runReadinessModule.getStudioCudaCapacityIssue(
    {
      ...form,
      resourceMode: 'expert',
      autoOffload: false,
      quantizationMode: 'none',
    },
    runtimeStatus({
      totalBytes: 96 * 1024 ** 3,
      freeBytes: 90 * 1024 ** 3,
    }),
  );
  assert.equal(residentBfloat16Issue, null);

  const policyPressureIssue = runReadinessModule.getStudioCudaRecipePressureIssue(
    { ...form, resourceMode: 'expert', autoOffload: true },
    null,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 11 * 1024 ** 3,
    }),
  );
  assert.equal(policyPressureIssue?.severity, 'warning');
  assert.match(policyPressureIssue?.details ?? '', /12 GB/);

  const autoCandidate = {
    id: 'qwen-auto-offload',
    requirements: { vramBytes: 10 * 1024 ** 3 },
  };
  assert.equal(
    runReadinessModule.getStudioCudaRecipePressureIssue(
      { ...form, resourceMode: 'auto' },
      autoCandidate,
      runtimeStatus({
        totalBytes: 96 * 1024 ** 3,
        freeBytes: 90 * 1024 ** 3,
      }),
    ),
    null,
  );
  const equalCapacityIssue = runReadinessModule.getStudioCudaRecipePressureIssue(
    { ...form, resourceMode: 'auto' },
    autoCandidate,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 10 * 1024 ** 3,
    }),
  );
  assert.equal(equalCapacityIssue, null, 'frontend pressure estimates must not override an Auto plan');

  const queuedIssue = runReadinessModule.getStudioCudaRecipePressureIssue(
    { ...form, resourceMode: 'auto' },
    autoCandidate,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 2 * 1024 ** 3,
    }),
    null,
    {
      activeWorkflowTabId: 'waiting-workflow',
      currentTask: {
        name: 'LTX image to video',
        status: 'running',
        task_id: 'active-task',
        workflow_tab_id: 'active-workflow',
        workflow_title: 'Current video render',
      },
    },
  );
  assert.equal(queuedIssue.blocking, false);
  assert.equal(queuedIssue.severity, 'info');
  assert.match(queuedIssue.message, /will run after Current video render/);
  assert.match(queuedIssue.details, /memory used by the active MoDiff run is temporary/);

  const ownRunIssue = runReadinessModule.getStudioCudaRecipePressureIssue(
    { ...form, resourceMode: 'auto' },
    autoCandidate,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 2 * 1024 ** 3,
    }),
    null,
    {
      activeWorkflowTabId: 'active-workflow',
      currentTask: {
        name: 'LTX image to video',
        status: 'running',
        task_id: 'active-task',
        workflow_tab_id: 'active-workflow',
      },
    },
  );
  assert.equal(ownRunIssue, null);

  const readinessSpec = (mode, loaderModule, loaderAction, roles) => ({
    mode,
    loaderModule,
    loaderAction,
    roles,
  });
  nodesStoreModule.useNodesStore.setState({
    studioExecutionSpecInvalid: false,
    studioModelCapabilities: [
      {
        modelType: 'QwenImageModularPipeline',
        executionProfiles: [
          {
            id: 'qwen-image:modular',
            modes: ['control_image'],
            execution_path: 'modular-diffusers',
            expert_quantization_policy: expertQuantizationPolicy,
            expert_quantization_modes: ['bnb_4bit'],
          },
        ],
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: ['control_image'],
        studioExecutionSpecs: [
          {
            ...readinessSpec('control_image', 'modules.ModularDiffusers', 'ModelsLoader', [
              ['models', 'modules.ModularDiffusers.ModelsLoader'],
            ]),
            executionProfileId: 'qwen-image:modular',
            bindings: [['models', 'offload_mode', 'offloadMode']],
          },
        ],
      },
      {
        modelType: 'AceStepAudioPipeline',
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: ['text_to_audio'],
        studioExecutionSpecs: [
          readinessSpec('text_to_audio', 'modules.DiffusersAudio', 'LoadPipeline', [
            ['audioPipeline', 'modules.DiffusersAudio.LoadPipeline'],
          ]),
        ],
      },
      {
        modelType: 'QwenImageEditModularPipeline',
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: ['inpaint'],
        studioExecutionSpecs: [
          readinessSpec('inpaint', 'modules.DiffusersImage', 'LoadPipeline', [
            ['diffusersImagePipeline', 'modules.DiffusersImage.LoadPipeline'],
            ['diffusersImageInpaint', 'modules.DiffusersImage.Inpaint'],
          ]),
        ],
      },
      {
        modelType: 'FluxKreaPipeline',
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: ['text_to_image'],
        studioExecutionSpecs: [
          readinessSpec('text_to_image', 'modules.FutureImage', 'ReviewedLoader', [
            ['diffusersImagePipeline', 'modules.FutureImage.ReviewedLoader'],
          ]),
        ],
      },
      {
        modelType: 'BuiltinImageOperation',
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: ['image_upscale'],
        studioExecutionSpecs: [
          {
            ...readinessSpec('image_upscale', 'modules.ImageOperations', 'ProcessImage', [
              ['imageOperation', 'modules.ImageOperations.ProcessImage'],
            ]),
            bindings: [],
          },
        ],
      },
      {
        modelType: 'SpandrelVideoUpscale',
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: ['video_upscale'],
        studioExecutionSpecs: [
          {
            ...readinessSpec('video_upscale', 'modules.Video', 'UpscaleVideo', [
              ['videoUpscaler', 'modules.Video.UpscaleVideo'],
            ]),
            bindings: [],
          },
        ],
      },
    ],
  });

  for (const [modelType, mode, nodeKey] of [
    ['BuiltinImageOperation', 'image_upscale', 'modules.ImageOperations.ProcessImage'],
    ['SpandrelVideoUpscale', 'video_upscale', 'modules.Video.UpscaleVideo'],
  ]) {
    const noneOnlyIssue = runReadinessModule.getStudioOffloadCapabilityIssue(
      {
        ...form,
        modelType,
        mode,
        resourceMode: 'expert',
        autoOffload: false,
        offloadMode: 'none',
      },
      { [nodeKey]: { params: {} } },
    );
    assert.equal(noneOnlyIssue, null, `${modelType} must not require a synthetic no-op offload field`);
  }

  const missingQuantNodeIssue = runReadinessModule.getStudioQuantizationCapabilityIssue(
    { ...form, mode: 'control_image', resourceMode: 'expert', quantizationMode: 'bnb_4bit' },
    {
      'modules.ModularDiffusers.ModelsLoader': {},
    },
  );
  assert.equal(missingQuantNodeIssue.blocking, true);
  assert.match(missingQuantNodeIssue.details, /QuantizationConfigNode/);

  const quantNodeReadyIssue = runReadinessModule.getStudioQuantizationCapabilityIssue(
    { ...form, mode: 'control_image', resourceMode: 'expert', quantizationMode: 'bnb_4bit' },
    {
      'modules.ModularDiffusers.ModelsLoader': {
        params: {
          offload_mode: { options: ['none', 'model_cpu', 'group_cpu', 'group_disk'] },
        },
      },
      'modules.ModularDiffusers.QuantizationConfigNode': {
        params: {
          model_id: {},
          subfolder: {},
          component: { options: ['transformer', 'text_encoder', 'reviewed_low_vram'] },
          quant_type: { options: ['bnb_4bit', 'bnb_8bit'] },
          bnb_4bit_quant_type: { options: ['nf4', 'fp4'] },
          bnb_4bit_compute_dtype: { options: ['', 'float32', 'float16', 'bfloat16'] },
          bnb_4bit_use_double_quant: {},
          quantization_config: { display: 'output' },
        },
      },
    },
  );
  assert.equal(quantNodeReadyIssue, null);

  const otherCapabilities = nodesStoreModule.useNodesStore
    .getState()
    .studioModelCapabilities.filter((capability) => capability.modelType !== 'QwenImageModularPipeline');
  nodesStoreModule.useNodesStore.setState({
    studioModelCapabilities: [
      {
        modelType: 'QwenImageModularPipeline',
        executionProfiles: [
          {
            id: 'qwen-image:t2i-direct',
            modes: ['text_to_image'],
            execution_path: 'direct-diffusers-image',
            expert_quantization_policy: expertQuantizationPolicy,
            expert_quantization_modes: ['bnb_4bit'],
          },
        ],
        studioExecutionSpecSchemaVersion: 1,
        studioExecutionSpecModes: ['text_to_image'],
        studioExecutionSpecs: [
          {
            ...readinessSpec('text_to_image', 'modules.DiffusersImage', 'LoadPipeline', [
              ['diffusersImagePipeline', 'modules.DiffusersImage.LoadPipeline'],
              ['diffusersImageGenerate', 'modules.DiffusersImage.Generate'],
            ]),
            executionProfileId: 'qwen-image:t2i-direct',
            bindings: [
              ['diffusersImagePipeline', 'quantization_mode', 'quantizationMode'],
              ['diffusersImagePipeline', 'quantized_components', 'pipelineQuantizedComponents'],
              ['diffusersImagePipeline', 'offload_mode', 'offloadMode'],
            ],
          },
        ],
      },
      ...otherCapabilities,
    ],
  });
  const directQuantizationIssue = runReadinessModule.getStudioQuantizationCapabilityIssue(
    { ...form, resourceMode: 'expert', quantizationMode: 'bnb_4bit' },
    {
      'modules.DiffusersImage.LoadPipeline': {
        params: { quantization_mode: {}, offload_mode: {} },
      },
      'modules.DiffusersImage.Generate': {},
    },
  );
  assert.equal(directQuantizationIssue.blocking, true);
  assert.match(directQuantizationIssue.details, /quantized_components/);

  const unsupportedQuantizationIssue = runReadinessModule.getStudioQuantizationCapabilityIssue(
    {
      ...form,
      modelType: 'FluxKreaPipeline',
      resourceMode: 'expert',
      quantizationMode: 'bnb_4bit',
    },
    {},
  );
  assert.equal(unsupportedQuantizationIssue.blocking, true);
  assert.match(unsupportedQuantizationIssue.message, /does not declare bnb_4bit/);

  const missingOffloadIssue = runReadinessModule.getStudioOffloadCapabilityIssue(
    { ...form, resourceMode: 'manual', offloadMode: 'group_disk' },
    {
      'modules.DiffusersImage.LoadPipeline': {
        params: {
          offload_mode: { options: ['auto_cpu', 'group_cpu'] },
        },
      },
    },
  );
  assert.equal(missingOffloadIssue.blocking, true);
  assert.match(missingOffloadIssue.details, /offload_mode/);

  const legacyModelCpuOffloadIssue = runReadinessModule.getStudioOffloadCapabilityIssue(
    { ...form, resourceMode: 'manual', offloadMode: 'model_cpu' },
    {
      'modules.DiffusersImage.LoadPipeline': {
        params: {
          offload_mode: { options: ['auto_cpu', 'group_cpu'] },
        },
      },
    },
  );
  assert.equal(legacyModelCpuOffloadIssue, null);

  const audioForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_audio',
    modelType: 'AceStepAudioPipeline',
    resourceMode: 'expert',
    device: 'cuda:0',
    autoOffload: true,
    offloadMode: 'model_cpu',
  };
  const structuredAudioOffloadIssue = runReadinessModule.getStudioOffloadCapabilityIssue(audioForm, {
    'modules.DiffusersAudio.LoadPipeline': {
      params: {
        offload_mode: {
          options: [
            optionDescriptor('none', { label: 'Off' }),
            optionDescriptor('model_cpu', { label: 'RAM/CPU model offload' }),
            optionDescriptor('sequential_cpu'),
          ],
        },
      },
    },
  });
  assert.equal(
    structuredAudioOffloadIssue,
    null,
    'real /nodes descriptors must not make supported audio offload look unavailable',
  );

  const unavailableAudioOffloadIssue = runReadinessModule.getStudioOffloadCapabilityIssue(audioForm, {
    'modules.DiffusersAudio.LoadPipeline': {
      params: {
        offload_mode: {
          options: [
            optionDescriptor('none', { label: 'Off' }),
            optionDescriptor('model_cpu', {
              compatibility: 'incompatible',
              availability: 'unavailable',
              installationState: 'unavailable',
              disabledReason: 'Unavailable in this runtime.',
            }),
          ],
        },
      },
    },
  });
  assert.equal(unavailableAudioOffloadIssue.blocking, true);
  assert.doesNotMatch(unavailableAudioOffloadIssue.details, /\[object Object\]/);

  const missingInpaintNodeIssue = runReadinessModule.getStudioExecutionSpecCapabilityIssue(
    {
      ...form,
      mode: 'inpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
    {
      'modules.DiffusersImage.LoadPipeline': {},
    },
  );
  assert.equal(missingInpaintNodeIssue.blocking, true);
  assert.match(missingInpaintNodeIssue.details, /modules\.DiffusersImage\.Inpaint/);

  const inpaintNodesReadyIssue = runReadinessModule.getStudioExecutionSpecCapabilityIssue(
    {
      ...form,
      mode: 'inpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
    {
      'modules.DiffusersImage.LoadPipeline': {},
      'modules.DiffusersImage.Inpaint': {},
    },
  );
  assert.equal(inpaintNodesReadyIssue, null);

  const genericInpaintNodesReadyIssue = runReadinessModule.getStudioExecutionSpecCapabilityIssue(
    {
      ...form,
      mode: 'inpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
    {
      'modules.DiffusersImage.LoadPipeline': {},
      'modules.DiffusersImage.Inpaint': {},
    },
  );
  assert.equal(genericInpaintNodesReadyIssue, null);

  const futureForm = {
    ...form,
    modelType: 'FluxKreaPipeline',
    resourceMode: 'expert',
    offloadMode: 'model_cpu',
  };
  assert.equal(
    runReadinessModule.getStudioOffloadCapabilityIssue(futureForm, {
      'modules.FutureImage.ReviewedLoader': {
        params: { offload_mode: { options: ['none', 'model_cpu'] } },
      },
    }),
    null,
  );
  const futureLoaderIssue = runReadinessModule.getStudioOffloadCapabilityIssue(futureForm, {
    'modules.FutureImage.ReviewedLoader': { params: {} },
  });
  assert.equal(futureLoaderIssue.blocking, true);
  assert.match(futureLoaderIssue.details, /modules\.FutureImage\.ReviewedLoader/);
});

test('Auto resource setup offers app-driven repair for incomplete artifacts', () => {
  const plan = {
    status: 'needs_setup',
    statusLabel: 'Needs setup',
    blockingReason: 'Cached artifact snapshot is incomplete; missing text_encoder/model-00001-of-00002.safetensors.',
    candidates: [
      {
        id: 'qwen-t2i-prequantized-model-cpu',
        rank: 1,
        artifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
        resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
        installed: true,
        artifactStatus: {
          installed: true,
          complete: false,
          reason: 'Cached artifact snapshot is incomplete; missing text_encoder/model-00001-of-00002.safetensors.',
          missingFiles: ['text_encoder/model-00001-of-00002.safetensors'],
        },
        proof: {
          status: 'skipped',
          message: 'Cached artifact snapshot is incomplete.',
        },
      },
    ],
  };

  assert.equal(autoResourceModule.autoPlanIsReady(plan), false);
  const target = autoResourceModule.autoResourceInstallTarget(plan);
  assert.deepEqual(target, {
    repo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
    label: 'Auto artifact',
    reason: 'Cached artifact snapshot is incomplete; missing text_encoder/model-00001-of-00002.safetensors.',
    actionLabel: 'Repair Auto artifact',
    repair: true,
    candidateId: 'qwen-t2i-prequantized-model-cpu',
  });
});

test('Studio resource plans expose user-facing execution path labels', () => {
  const qwenAutoForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    resourceMode: 'auto',
    device: 'cuda:0',
  };
  const qwenAutoPlan = resourcePlannerModule.resolveStudioResourcePlan(qwenAutoForm, {
    runtimeStatus: runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  });
  assert.equal(qwenAutoPlan.executionPath, undefined);
  assert.equal(resourcePlannerModule.getStudioResourceExecutionPathLabel(qwenAutoPlan), 'Auto');

  const qwenExpertPlan = resourcePlannerModule.resolveStudioResourcePlan({
    ...qwenAutoForm,
    resourceMode: 'expert',
  });
  assert.equal(qwenExpertPlan.executionPath, undefined);
  assert.equal(resourcePlannerModule.getStudioResourceExecutionPathLabel(qwenExpertPlan), 'Expert: full graph');
  assert.deepEqual(qwenExpertPlan.retryPlans, [], 'Expert must not retry through the direct-image Auto branch');

  const zImagePlan = resourcePlannerModule.resolveStudioResourcePlan({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'ZImageModularPipeline',
  });
  assert.equal(zImagePlan.executionPath, undefined);
  assert.equal(resourcePlannerModule.getStudioResourceExecutionPathLabel(zImagePlan), 'Auto');
  assert.equal(
    resourcePlannerModule.getStudioResourceExecutionPathLabel({
      ...zImagePlan,
      executionPath: 'direct-diffusers-image',
    }),
    'Auto: Diffusers image',
  );

  for (const profile of Object.values(profilesModule.STUDIO_MODEL_PROFILES)) {
    for (const mode of profile.modes) {
      const plan = resourcePlannerModule.resolveStudioResourcePlan({
        ...profilesModule.getFormDefaultsForMode(mode, profile.modelType),
        resourceMode: 'auto',
      });
      assert.equal(plan.executionPath, undefined, `${profile.modelType}:${mode} must wait for backend path authority`);
    }
  }
});

test('all Studio profiles and templates keep offload plans compatible with their execution device', () => {
  const unsupportedDevices = ['cpu:0', 'mps:0', 'xpu:0'];
  const requestedOffloadModes = ['model_cpu', 'sequential_cpu'];

  for (const profile of Object.values(profilesModule.STUDIO_MODEL_PROFILES)) {
    for (const mode of profile.modes) {
      const defaults = profilesModule.getFormDefaultsForMode(mode, profile.modelType);
      for (const device of unsupportedDevices) {
        for (const offloadMode of requestedOffloadModes) {
          const input = {
            ...defaults,
            device,
            autoOffload: true,
            offloadMode,
          };
          const resolved = resourcePlannerModule.resolveStudioResourceForm(input);
          const plan = resourcePlannerModule.resolveStudioResourcePlan(input);
          assert.equal(resolved.autoOffload, false, `${profile.modelType}|${mode}|${device} form`);
          assert.equal(resolved.offloadMode, 'none', `${profile.modelType}|${mode}|${device} form`);
          assert.equal(plan.autoOffload, false, `${profile.modelType}|${mode}|${device} plan`);
          assert.equal(plan.offloadMode, 'none', `${profile.modelType}|${mode}|${device} plan`);
          assert.deepEqual(plan.retryOffloadModes, [], `${profile.modelType}|${mode}|${device} retries`);
          const expert = resourcePlannerModule.resolveStudioResourceForm({
            ...input,
            resourceMode: 'expert',
          });
          assert.equal(expert.autoOffload, false, `${profile.modelType}|${mode}|${device} expert form`);
          assert.equal(expert.offloadMode, 'none', `${profile.modelType}|${mode}|${device} expert form`);
        }
      }

      const cudaInput = {
        ...defaults,
        device: 'cuda:0',
        autoOffload: true,
        offloadMode: profile.offloadSupport.default,
      };
      const cudaPlan = resourcePlannerModule.resolveStudioResourcePlan(cudaInput);
      assert.equal(cudaPlan.offloadMode, profile.offloadSupport.default, `${profile.modelType}|${mode}|cuda`);
      assert.equal(cudaPlan.autoOffload, profile.offloadSupport.default !== 'none');
    }
  }

  for (const template of templatesModule.STUDIO_TEMPLATES) {
    const defaults = profilesModule.getFormDefaultsForMode(template.mode, template.modelType);
    const locked = templateExactnessModule.getTemplateLockedSettings(template);
    for (const device of unsupportedDevices) {
      const resolved = resourcePlannerModule.resolveStudioResourceForm({
        ...defaults,
        ...locked,
        device,
        autoOffload: true,
        offloadMode: 'model_cpu',
      });
      assert.equal(resolved.autoOffload, false, `${template.id}|${device}`);
      assert.equal(resolved.offloadMode, 'none', `${template.id}|${device}`);
    }
  }
});

test('low-memory form patches follow the selected declarative profile without family switches', () => {
  const qwen = resourcePlannerModule.studioLowMemoryFormValues({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'QwenImageModularPipeline',
  });
  assert.deepEqual(
    { width: qwen.width, height: qwen.height, steps: qwen.steps, numFrames: qwen.numFrames },
    { width: 1024, height: 1024, steps: 50, numFrames: undefined },
  );

  const wanVace = resourcePlannerModule.studioLowMemoryFormValues({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'WanVACEPipeline',
    mode: 'text_to_video',
  });
  assert.deepEqual(
    { width: wanVace.width, height: wanVace.height, steps: wanVace.steps, numFrames: wanVace.numFrames },
    { width: 832, height: 480, steps: 24, numFrames: 49 },
  );

  const wanI2v = resourcePlannerModule.studioLowMemoryFormValues({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'WanImageToVideoPipeline',
    mode: 'image_to_video',
  });
  assert.deepEqual(
    { width: wanI2v.width, height: wanI2v.height, steps: wanI2v.steps, numFrames: wanI2v.numFrames },
    { width: 832, height: 480, steps: 40, numFrames: 81 },
  );

  const ltx = resourcePlannerModule.studioLowMemoryFormValues({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'LTXVideoPipeline',
    mode: 'text_to_video',
  });
  assert.deepEqual(
    { width: ltx.width, height: ltx.height, steps: ltx.steps, numFrames: ltx.numFrames },
    { width: 704, height: 480, steps: 8, numFrames: 65 },
  );
});

test('Auto plans, form patches, cache keys, readiness, and persisted managed nodes share the device contract', () => {
  const cpuForm = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'QwenImageModularPipeline',
    device: 'cpu:0',
    autoOffload: false,
    offloadMode: 'none',
  };
  const cudaForm = {
    ...cpuForm,
    device: 'cuda:0',
    autoOffload: true,
    offloadMode: 'model_cpu',
  };
  const offloadCandidate = {
    id: 'qwen-model-cpu',
    offloadMode: 'model_cpu',
    autoOffload: true,
    proof: { status: 'passed' },
  };
  const offloadPlan = {
    status: 'ready',
    selectedCandidate: offloadCandidate,
    candidates: [offloadCandidate],
  };
  assert.equal(autoResourceModule.autoPlanIsReady(offloadPlan, cudaForm), true);
  assert.equal(autoResourceModule.autoPlanIsReady(offloadPlan, cpuForm), false);
  assert.equal(autoResourceModule.selectedAutoCandidate(offloadPlan, cpuForm), null);
  assert.deepEqual(autoResourceModule.formPatchForAutoCandidate(offloadCandidate, cpuForm), {
    resourceMode: 'auto',
    autoOffload: false,
    offloadMode: 'none',
  });
  assert.notEqual(autoResourceModule.autoPlanKeyForForm(cpuForm), autoResourceModule.autoPlanKeyForForm(cudaForm));

  const studioBefore = studioStoreModule.useStudioStore.getState();
  const residentCandidate = {
    id: 'qwen-resident',
    dtype: 'bfloat16',
    quantizationMode: 'none',
    offloadMode: 'none',
    proof: { status: 'live_proven' },
  };
  const residentPlan = {
    status: 'ready',
    selectedCandidate: residentCandidate,
    candidates: [residentCandidate],
  };
  try {
    studioStoreModule.useStudioStore.setState({
      form: {
        ...cudaForm,
        resourceMode: 'auto',
        quantizationMode: 'bnb_4bit',
        autoOffload: true,
        offloadMode: 'model_cpu',
      },
      autoResourcePlan: null,
      autoResourcePlans: {},
    });
    const current = studioStoreModule.useStudioStore.getState().form;
    studioStoreModule.useStudioStore
      .getState()
      .applyAutoResourcePlan(residentPlan, autoResourceModule.formPatchForAutoCandidate(residentCandidate, current));
    const committed = studioStoreModule.useStudioStore.getState();
    assert.equal(committed.form.quantizationMode, 'none');
    assert.equal(committed.form.autoOffload, false);
    assert.equal(committed.form.offloadMode, 'none');
    assert.equal(committed.autoResourcePlan, residentPlan);
  } finally {
    studioStoreModule.useStudioStore.setState({
      form: studioBefore.form,
      autoResourcePlan: studioBefore.autoResourcePlan,
      autoResourcePlans: studioBefore.autoResourcePlans,
    });
  }

  for (const device of ['cpu:0', 'mps:0', 'xpu:0']) {
    const issue = runReadinessModule.getStudioDeviceOffloadIssue({
      ...cpuForm,
      device,
      autoOffload: true,
      offloadMode: 'model_cpu',
    });
    assert.equal(issue?.blocking, true, device);
    assert.match(issue?.details ?? '', /CUDA or ROCm/);
  }
  assert.equal(runReadinessModule.getStudioDeviceOffloadIssue(cudaForm), null);

  const previousGraph = flowStoreModule.useFlowStore.getState().toObject();
  flowStoreModule.useFlowStore.getState().replaceGraph({
    nodes: [
      {
        id: 'manual-loader',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          type: 'custom',
          module: 'modules.ModularDiffusers',
          action: 'ModelsLoader',
          label: 'Load models',
          params: {
            device: { value: 'cpu:0' },
            auto_offload: { value: true },
            offload_mode: { value: 'model_cpu' },
          },
        },
      },
    ],
    edges: [],
  });
  try {
    const graphIssues = runReadinessModule.collectGraphDeviceOffloadIssues();
    assert.equal(graphIssues.length, 1);
    assert.equal(graphIssues[0].blocking, true);
    assert.equal(graphIssues[0].nodeId, 'manual-loader');
  } finally {
    flowStoreModule.useFlowStore.getState().replaceGraph(previousGraph);
  }

  const managedNode = {
    id: 'managed-loader',
    data: {
      studioOwned: true,
      params: {
        device: { value: 'cpu:0' },
        auto_offload: { value: true },
        offload_mode: { value: 'model_cpu' },
      },
    },
  };
  const customNode = {
    id: 'custom-loader',
    data: {
      params: {
        device: { value: 'cpu:0' },
        auto_offload: { value: true },
        offload_mode: { value: 'model_cpu' },
      },
    },
  };
  const migrated = studioStoreModule.normalizeManagedSnapshotExecutionPlan([managedNode, customNode], cpuForm, null);
  assert.deepEqual(
    Object.fromEntries(Object.entries(migrated[0].data.params).map(([key, value]) => [key, value.value])),
    { device: 'cpu:0', auto_offload: false, offload_mode: 'none' },
  );
  assert.equal(migrated[1].data.params.auto_offload.value, true, 'manual graphs are blocked, not silently rewritten');
});

test('canonical workflow generation normalizes unsupported devices and preserves CUDA/ROCm offload', () => {
  for (const device of ['cpu:0', 'mps:0', 'xpu:0']) {
    const node = {
      data: {
        params: {
          device: { value: device },
          auto_offload: { value: true },
          offload_mode: { value: 'sequential_cpu' },
        },
      },
    };
    assert.match(workflowNodeDeviceOffloadError(node), /offload/);
    normalizePortableWorkflowNodeOffload(node);
    assert.equal(node.data.params.auto_offload.value, false);
    assert.equal(node.data.params.offload_mode.value, 'none');
    assert.equal(workflowNodeDeviceOffloadError(node), null);
  }

  const cudaNode = {
    data: {
      params: {
        device: { value: 'cuda:0' },
        auto_offload: { value: true },
        offload_mode: { value: 'model_cpu' },
      },
    },
  };
  normalizePortableWorkflowNodeOffload(cudaNode);
  assert.equal(cudaNode.data.params.auto_offload.value, true);
  assert.equal(cudaNode.data.params.offload_mode.value, 'model_cpu');
  assert.equal(workflowNodeDeviceOffloadError(cudaNode), null);
});

test('canonical workflows reject retired or mutable Hub attention backends', () => {
  const node = (value, options) => ({ data: { params: { attention_backend: { value, options } } } });
  assert.match(workflowNodeAttentionBackendError(node('auto', ['auto', { value: 'aiter' }])), /aiter/);
  assert.match(
    workflowNodeAttentionBackendError(node('aiter_fa2_hub', { auto: 'Auto', aiter_fa2_hub: 'Hub AITER' })),
    /aiter_fa2_hub/,
  );
  assert.equal(workflowNodeAttentionBackendError(node('_native_flash', ['auto', '_native_flash'])), null);
  assert.equal(workflowNodeAttentionBackendError({ data: { params: {} } }), null);
});

test('Studio runtime hints preserve the exact Qwen Auto recipe without a client-owned CUDA budget', () => {
  const totalBytes = 16 * 1024 ** 3;
  const freeBytes = 15 * 1024 ** 3;
  nodesStoreModule.useNodesStore.setState({ runtimeStatus: runtimeStatus({ totalBytes, freeBytes }) });
  studioStoreModule.useStudioStore.setState({
    form: {
      ...profilesModule.DEFAULT_STUDIO_FORM,
      mode: 'text_to_image',
      modelType: 'QwenImageModularPipeline',
      device: 'cuda:0',
      dtype: 'bfloat16',
      resourceMode: 'auto',
      quantizationMode: 'none',
      autoOffload: true,
      offloadMode: 'model_cpu',
    },
    autoResourcePlan: {
      status: 'ready',
      statusLabel: 'Ready with local Auto recipe',
      selectedCandidate: {
        id: 'qwen-t2i-prequantized-model-cpu',
        executionProfileId: 'qwen-image:t2i-direct',
        modelType: 'QwenImageModularPipeline',
        mode: 'text_to_image',
        loaderModule: 'modules.DiffusersImage',
        loaderAction: 'LoadPipeline',
        executionPath: 'direct-diffusers-image',
        pipelineClass: 'QwenImagePipeline',
        modelRepo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
        resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
        dtype: 'bfloat16',
        quantizationMode: 'none',
        quantizedComponents: [],
        offloadMode: 'model_cpu',
        generation: {
          width: 1024,
          height: 1024,
          steps: 50,
          guidanceScale: 4,
          negativePrompt: ' ',
          maxSequenceLength: 512,
        },
        proof: { status: 'declared_safe', source: 'static_auto_requirements' },
      },
      candidates: [
        {
          id: 'qwen-t2i-prequantized-model-cpu',
          executionProfileId: 'qwen-image:t2i-direct',
          modelType: 'QwenImageModularPipeline',
          mode: 'text_to_image',
          loaderModule: 'modules.DiffusersImage',
          loaderAction: 'LoadPipeline',
          executionPath: 'direct-diffusers-image',
          pipelineClass: 'QwenImagePipeline',
          dtype: 'bfloat16',
          modelRepo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          quantizationMode: 'none',
          quantizedComponents: [],
          offloadMode: 'model_cpu',
          proof: { status: 'declared_safe' },
        },
        {
          id: 'qwen-t2i-fallback',
          executionProfileId: 'qwen-image:t2i-direct',
          modelType: 'QwenImageModularPipeline',
          mode: 'text_to_image',
          loaderModule: 'modules.DiffusersImage',
          loaderAction: 'LoadPipeline',
          executionPath: 'direct-diffusers-image',
          pipelineClass: 'QwenImagePipeline',
          modelRepo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          quantizationMode: 'none',
          quantizedComponents: [],
          offloadMode: 'sequential_cpu',
          proof: { status: 'passed' },
        },
      ],
    },
  });

  const graph = runMetadataModule.applyStudioRuntimeHints({ sid: 'test', nodes: {}, paths: [] });
  assert.equal(graph.runtimeHints.modelType, 'QwenImageModularPipeline');
  assert.equal(graph.runtimeHints.mode, 'text_to_image');
  assert.equal(graph.runtimeHints.modelName, 'Qwen-Image-2512');
  assert.equal(graph.runtimeHints.modelRepo, 'Qwen/Qwen-Image-2512');
  assert.equal(graph.runtimeHints.dtype, 'bfloat16');
  assert.equal(graph.runtimeHints.quantizationMode, 'none');
  assert.deepEqual(graph.runtimeHints.quantizedComponents, []);
  assert.equal(graph.runtimeHints.autoOffload, true);
  assert.equal(graph.runtimeHints.offloadMode, 'model_cpu');
  assert.equal(graph.runtimeHints.supportedOffloadModes, undefined);
  assert.equal(graph.runtimeHints.executionPath, 'direct-diffusers-image');
  assert.equal(graph.runtimeHints.resolvedArtifact, 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit');
  assert.equal(graph.runtimeHints.autoResourceCandidateId, 'qwen-t2i-prequantized-model-cpu');
  assert.equal(graph.runtimeHints.autoResourceProofStatus, 'declared_safe');
  assert.equal(graph.runtimeHints.resourceRetryModes, undefined);
  assert.ok(graph.runtimeHints.resourceRetryPlans.length >= 1);
  assert.equal(graph.runtimeHints.modelFamily, undefined);
  assert.equal(graph.runtimeHints.lowVramMode, undefined);
  assert.equal(graph.runtimeHints.cudaMemoryTotalBytes, totalBytes);
  assert.equal(graph.runtimeHints.requestedCudaReserveBytes, undefined);
  assert.equal(graph.runtimeHints.requestedCudaBudgetBytes, undefined);
});

test('Studio runtime hints carry immutable auxiliary model dependency revisions', () => {
  const previous = studioStoreModule.useStudioStore.getState();
  try {
    studioStoreModule.useStudioStore.setState({
      form: {
        ...profilesModule.DEFAULT_STUDIO_FORM,
        modelType: 'QwenImageModularPipeline',
        mode: 'control_image',
        resourceMode: 'expert',
      },
      autoResourcePlan: null,
      graphBinding: null,
    });
    const graph = runMetadataModule.applyStudioRuntimeHints({ sid: 'dependencies', nodes: {}, paths: [] });
    assert.deepEqual(graph.runtimeHints.supportedOffloadModes, [
      'none',
      'model_cpu',
      'sequential_cpu',
      'group_cpu',
      'group_disk',
    ]);
    assert.deepEqual(graph.runtimeHints.resourceRetryModes, ['sequential_cpu', 'group_disk']);
    assert.deepEqual(graph.runtimeHints.modelDependencies, [
      {
        id: 'qwen-controlnet-union',
        kind: 'controlnet',
        repo: 'InstantX/Qwen-Image-ControlNet-Union',
        revision: 'b13036f066d6dee7c20513e263d3d673055e9de8',
      },
    ]);
  } finally {
    studioStoreModule.useStudioStore.setState({
      form: previous.form,
      autoResourcePlan: previous.autoResourcePlan,
      graphBinding: previous.graphBinding,
    });
  }
});

test('ACE LoRA runtime hints replace the selected candidate and its complete artifact receipt', () => {
  const previousStudio = studioStoreModule.useStudioStore.getState();
  const previousFlow = flowStoreModule.useFlowStore.getState();
  const originalRepo = 'ACE-Step/ACE-Step-v1.5-turbo';
  const originalRevision = 'a'.repeat(40);
  const reviewedRepo = 'Runware/acestep-v15-turbo-diffusers';
  const reviewedRevision = 'be23effe449c5957947f3020fd63bee23c64abe4';
  const candidate = {
    id: 'ace-auto',
    modelType: 'AceStepAudioPipeline',
    mode: 'text_to_audio',
    loaderModule: 'modules.DiffusersAudio',
    loaderAction: 'LoadPipeline',
    executionPath: 'direct-diffusers-audio',
    pipelineClass: 'AceStepPipeline',
    modelDependencies: [],
    modelRepo: originalRepo,
    resolvedArtifact: originalRepo,
    artifact: originalRepo,
    baseArtifact: originalRepo,
    artifactRevision: originalRevision,
    artifactResolution: {
      base: { repo: originalRepo, revision: originalRevision },
      resolved: {
        repo: originalRepo,
        revision: originalRevision,
        format: 'diffusers',
        bits: null,
        quantization: 'none',
        components: ['transformer'],
      },
      substituted: true,
    },
    installTarget: { repo: originalRepo, candidateId: 'ace-auto' },
    dtype: 'bfloat16',
    quantizationMode: 'none',
    quantizedComponents: [],
    autoOffload: false,
    offloadMode: 'none',
    proof: { status: 'passed' },
  };

  try {
    studioStoreModule.useStudioStore.setState({
      activeTemplateId: 'ace_step_chinese_new_year_lora',
      form: {
        ...profilesModule.DEFAULT_STUDIO_FORM,
        modelType: 'AceStepAudioPipeline',
        mode: 'text_to_audio',
        resourceMode: 'auto',
        device: 'cpu:0',
        autoOffload: false,
        offloadMode: 'none',
      },
      graphBinding: {
        mode: 'text_to_audio',
        modelType: 'AceStepAudioPipeline',
        nodes: { audioPipeline: 'ace-loader' },
        managedNodeIds: ['ace-loader'],
        managedEdgeIds: [],
        fingerprint: 'text_to_audio:AceStepAudioPipeline:auto:none',
        createdAt: 1,
        updatedAt: 1,
      },
      autoResourcePlan: {
        schemaVersion: 2,
        status: 'ready',
        canAutoRun: true,
        compatibility: { state: 'ready' },
        selectedCandidate: { ...candidate },
        candidates: [{ ...candidate }],
      },
    });
    flowStoreModule.useFlowStore.setState({
      nodes: [
        {
          id: 'ace-loader',
          data: {
            type: 'custom',
            module: 'modules.DiffusersAudio',
            action: 'LoadPipeline',
            params: {
              pipeline_class: { value: 'AceStepPipeline' },
              model_id: { value: reviewedRepo },
            },
          },
        },
      ],
      edges: [],
    });

    const hints = runMetadataModule.applyStudioRuntimeHints({ sid: 'ace', nodes: {}, paths: [] }).runtimeHints;
    const selected = hints.autoResourcePlan;
    const listed = hints.autoResourceCandidates.find((item) => item.id === candidate.id);
    for (const receipt of [selected, listed]) {
      assert.equal(receipt.modelRepo, reviewedRepo);
      assert.equal(receipt.resolvedArtifact, reviewedRepo);
      assert.equal(receipt.artifact, reviewedRepo);
      assert.equal(receipt.baseArtifact, reviewedRepo);
      assert.equal(receipt.artifactRevision, reviewedRevision);
      assert.deepEqual(receipt.artifactResolution.base, { repo: reviewedRepo, revision: reviewedRevision });
      assert.deepEqual(receipt.artifactResolution.resolved, {
        ...candidate.artifactResolution.resolved,
        repo: reviewedRepo,
        revision: reviewedRevision,
      });
      assert.equal(receipt.artifactResolution.substituted, false);
      assert.equal(receipt.installTarget.repo, reviewedRepo);
    }
    assert.deepEqual(listed, selected, 'the canonical same-id list entry must be updated with the selected receipt');
    assert.equal(hints.modelRepo, reviewedRepo);
    assert.equal(hints.resolvedArtifact, reviewedRepo);
    assert.equal(candidate.artifactResolution.resolved.repo, originalRepo, 'the backend plan must not be mutated');
  } finally {
    studioStoreModule.useStudioStore.setState({
      activeTemplateId: previousStudio.activeTemplateId,
      form: previousStudio.form,
      graphBinding: previousStudio.graphBinding,
      autoResourcePlan: previousStudio.autoResourcePlan,
    });
    flowStoreModule.useFlowStore.setState({ nodes: previousFlow.nodes, edges: previousFlow.edges });
  }
});

test('Studio output contract preserves per-layer media item hashes', () => {
  const output = outputContractsModule.coerceStudioOutput({
    id: 'layered-output',
    nodeId: 'node-1',
    fieldKey: 'images',
    value: ['/cache/node-1/images?index=0', '/cache/node-1/images?index=1'],
    url: '/cache/node-1/images?index=0',
    mode: 'layer_decomposition',
    modelType: 'QwenImageLayeredModularPipeline',
    formSnapshot: {
      ...profilesModule.DEFAULT_STUDIO_FORM,
      mode: 'layer_decomposition',
      modelType: 'QwenImageLayeredModularPipeline',
    },
    createdAt: 1,
    mediaHash: 'sha256:collection:abc',
    mediaCollectionHash: 'sha256:collection:abc',
    mediaItems: [
      { index: 0, role: 'layer', label: 'Layer 1', url: '/file?file=layer0.webp', mediaHash: 'sha256:bytes:000' },
      { index: 1, role: 'layer', label: 'Layer 2', url: '/file?file=layer1.webp', mediaHash: 'sha256:bytes:111' },
    ],
  });
  assert.equal(output.mediaItems.length, 2);
  assert.equal(output.mediaCollectionHash, 'sha256:collection:abc');
  assert.equal(output.mediaItems[0].role, 'layer');
  assert.equal(output.mediaItems[1].mediaHash, 'sha256:bytes:111');
});

test('Qwen Layered defaults to a pipeline-supported source resolution', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'qwen_layered_portrait');
  const profile = profilesModule.STUDIO_MODEL_PROFILES.QwenImageLayeredModularPipeline;
  assert.ok(template);
  assert.deepEqual(profile.defaultSize, { width: 640, height: 640, aspectRatio: '1:1' });
  assert.equal(template.example.lockedSettings.width, 640);
  assert.equal(template.example.lockedSettings.height, 640);
  assert.equal(template.example.lockedSettings.layers, 3);
  assert.deepEqual(template.example.expectedOutput, { width: 640, height: 640 });
  assert.deepEqual(template.example.galleryExpectedOutput, { width: 1536, height: 1108 });
});

test('partially downloaded Hugging Face snapshots are not runnable cache hits', () => {
  const repo = 'Qwen/Qwen-Image-Layered';
  assert.equal(
    modelCacheModule.cacheContains(
      [
        {
          id: repo,
          cached: true,
          installed: false,
          complete: false,
          repair_required: true,
          active_files: ['blobs/weights.incomplete'],
        },
      ],
      repo,
    ),
    false,
  );
  assert.equal(modelCacheModule.cacheContains([{ id: repo, installed: true, complete: true }], repo), true);
  // Older backends did not provide installation metadata; preserve that wire contract.
  assert.equal(modelCacheModule.cacheContains([{ id: repo }], repo), true);
});

test('startup request caches recover manifest and plans at their startup readiness signals without a modal refresh', async () => {
  let attempts = 0;
  const cache = startupRequestModule.createStartupRequestCache(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('backend not ready');
    return { ready: true };
  });

  await assert.rejects(cache.load(), /backend not ready/);
  assert.equal(cache.hasRejected(), true);
  assert.equal(
    startupRequestModule.shouldRetryStaticStartupRequest({
      attempted: false,
      failed: cache.hasRejected(),
    }),
    true,
  );
  assert.equal(
    startupRequestModule.shouldRetryStaticStartupRequest({
      attempted: true,
      failed: cache.hasRejected(),
    }),
    false,
  );
  assert.equal(
    startupRequestModule.shouldRetryStartupRequest({
      attempted: false,
      backendReady: false,
      discoveryRefreshing: false,
      failed: cache.hasRejected(),
    }),
    false,
  );
  assert.equal(
    startupRequestModule.shouldRetryStartupRequest({
      attempted: false,
      backendReady: true,
      discoveryRefreshing: true,
      failed: cache.hasRejected(),
    }),
    false,
  );
  assert.equal(
    startupRequestModule.shouldRetryStartupRequest({
      attempted: false,
      backendReady: true,
      discoveryRefreshing: false,
      failed: cache.hasRejected(),
    }),
    true,
  );

  assert.deepEqual(await cache.load(), { ready: true });
  assert.equal(cache.hasRejected(), false);
  assert.deepEqual(await cache.load(), { ready: true });
  assert.equal(attempts, 2);
  assert.equal(
    startupRequestModule.shouldRetryStartupRequest({
      attempted: true,
      backendReady: true,
      discoveryRefreshing: false,
      failed: true,
    }),
    false,
  );

  const browserSource = await readFile(path.join(ROOT, 'src/components/TemplateBrowserDialog.tsx'), 'utf8');
  assert.match(browserSource, /const templateManifestRequest = createStartupRequestCache<TemplateGalleryManifest>/);
  assert.match(
    browserSource,
    /const templateAutoPlansRequest = createStartupRequestCache<Record<string, StudioAutoResourcePlan>>/,
  );
  assert.match(browserSource, /shouldRetryStaticStartupRequest\(\{[\s\S]*?manifestStartupRetryAttempted\.current/);
  assert.doesNotMatch(browserSource, /templateManifestRequest\s*\?\?=/);
});
