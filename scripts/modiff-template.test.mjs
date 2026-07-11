import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

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
});

after(async () => {
  await server?.close();
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

function readinessContext({ form, hfCache = [], nodesRegistry = {} } = {}) {
  return {
    form: form ?? profilesModule.DEFAULT_STUDIO_FORM,
    hfCache,
    localModels: [],
    modelCacheDiagnostics: { locations: [] },
    runtimeStatus: runtimeStatus(),
    nodesRegistry,
  };
}

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
    assert.ok(template.prompt.length >= 120, `${template.id} prompt is detailed`);
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

test('Wan VACE execution pins the app-installed immutable model revision', () => {
  assert.equal(profilesModule.WAN_VACE_REPO, 'Wan-AI/Wan2.1-VACE-1.3B-diffusers');
  assert.equal(profilesModule.WAN_VACE_REVISION, 'ec4d2cb062b548996b179d493fdd05340de702a1');
});

test('Qwen Auto preserves safe template aspect ratios inside its local pixel budget', () => {
  const base = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    resourceMode: 'auto',
  };

  assert.deepEqual(resourcePlannerModule.getQwenAutoDimensions({ ...base, width: 1024, height: 768 }), {
    width: 1024,
    height: 768,
  });
  assert.deepEqual(resourcePlannerModule.getQwenAutoDimensions({ ...base, width: 768, height: 1344 }), {
    width: 768,
    height: 1344,
  });
  assert.deepEqual(resourcePlannerModule.getQwenAutoDimensions({ ...base, width: 1328, height: 1328 }), {
    width: 1024,
    height: 1024,
  });

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
  assert.equal(candidatePatch.width, 1024);
  assert.equal(candidatePatch.height, 768);
});

test('ACE templates lock musical structure, metadata, and model-aware negative behavior', () => {
  const templates = templatesModule.STUDIO_TEMPLATES.filter(
    (template) => template.modelType === 'AceStepAudioPipeline',
  );
  assert.equal(templates.length, 4);

  for (const template of templates) {
    const locked = template.example.lockedSettings;
    assert.equal(locked.steps, 8);
    assert.equal(locked.guidanceScale, 1);
    assert.equal(locked.shift, 3);
    assert.equal(locked.bpm, 170);
    assert.equal(locked.keyscale, 'C# minor');
    assert.equal(locked.timesignature, '4/4');
    assert.equal(template.negativePrompt, '');
  }

  const textToAudio = templates.find((template) => template.mode === 'text_to_audio');
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[intro\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[verse\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[chorus\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[bridge\]/i);
  assert.match(textToAudio.example.lockedSettings.lyrics, /\[outro\]/i);

  const continuation = templates.find((template) => template.mode === 'audio_continuation');
  assert.equal(continuation.example.expectedOutput.durationSeconds, 15);
  assert.match(continuation.prompt, /Boundary contract:/);
});

test('template browser uses the task-oriented taxonomy and hides backend-blocked recipes by default', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const { TEMPLATE_BROWSER_CATEGORIES, filterStudioTemplates, templateCategoryId } = browserModule;
  const form = profilesModule.DEFAULT_STUDIO_FORM;

  assert.deepEqual(
    TEMPLATE_BROWSER_CATEGORIES.map((category) => category.id),
    [
      'recommended',
      'all',
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
  assert.ok(imageTemplates.every((template) => templateCategoryId(template) === 'image'));

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

  const expertInventory = filterStudioTemplates(STUDIO_TEMPLATES, form, {
    category: 'all',
    includeBlocked: true,
    query: '',
    modelType: 'all',
    difficulty: 'all',
    sort: 'recommended',
  });
  assert.ok(expertInventory.length >= defaultInventory.length);
});

test('template readiness classifies ready, input, model, and backend states', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const { getTemplateReadiness } = readinessModule;
  const baseRegistry = {
    'modules.ModularDiffusers.AutoModelLoader': {},
    'modules.ModularDiffusers.Controlnet': {},
  };

  const quick = STUDIO_TEMPLATES.find((template) => template.id === 'z_image_quick_concept');
  const fastLora = STUDIO_TEMPLATES.find((template) => template.id === 'fast_lora');
  const character = STUDIO_TEMPLATES.find((template) => template.id === 'character_edit');
  const control = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_control_image_layout');
  const upscale = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_upscale_finish');
  const inpaint = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_inpaint_mask_draft');
  const layered = STUDIO_TEMPLATES.find((template) => template.id === 'layer_decomposition');
  const outpaint = STUDIO_TEMPLATES.find((template) => template.id === 'qwen_outpaint_aspect_template');
  assert.ok(quick && fastLora && character && control && upscale && inpaint && layered && outpaint);

  assert.equal(
    getTemplateReadiness(quick, readinessContext({ hfCache: ['Tongyi-MAI/Z-Image-Turbo'] })).status,
    'ready',
  );
  assert.equal(
    getTemplateReadiness(character, readinessContext({ hfCache: ['Qwen/Qwen-Image-Edit'] })).status,
    'needs_input',
  );
  assert.equal(getTemplateReadiness(quick, readinessContext()).status, 'needs_model');
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
    'needs_input',
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
  assert.equal(
    getTemplateReadiness(
      fastLora,
      readinessContext({
        hfCache: ['Tongyi-MAI/Z-Image-Turbo'],
        nodesRegistry: {
          'modules.ModularDiffusers.ModelsLoader': {},
          'modules.ModularDiffusers.Lora': {},
        },
      }),
    ).status,
    'needs_input',
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
  assert.equal(
    getTemplateReadiness(
      upscale,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-2512'],
        nodesRegistry: {
          'modules.Spandrel.Upscaler': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'needs_input',
  );
  assert.equal(
    getTemplateReadiness(
      inpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: { 'modules.QwenImage.LoadInpaintPipeline': {} },
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
          'modules.QwenImage.LoadInpaintPipeline': {},
          'modules.QwenImage.Inpaint': {},
          'modules.Image.Load': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'needs_input',
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
    'needs_input',
  );
  assert.equal(
    getTemplateReadiness(
      outpaint,
      readinessContext({
        hfCache: ['Qwen/Qwen-Image-Edit'],
        nodesRegistry: {
          'modules.QwenImage.LoadInpaintPipeline': {},
          'modules.QwenImage.Inpaint': {},
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
          'modules.QwenImage.LoadInpaintPipeline': {},
          'modules.QwenImage.OutpaintCanvas': {},
          'modules.QwenImage.Inpaint': {},
          'modules.Image.Load': {},
          'modules.Image.Preview': {},
        },
      }),
    ).status,
    'needs_input',
  );
});

test('legacy template ids normalize to MoDiff template ids', () => {
  const oldMarker = 'co' + 'mfy';
  const oldOutpaintId = ['qwen', oldMarker, 'outpaint_aspect'].join('_');
  assert.equal(outputContractsModule.coerceStudioTemplateId(oldOutpaintId), 'qwen_outpaint_aspect_template');

  const output = outputContractsModule.coerceStudioOutput({
    id: 'legacy-template-output',
    url: '/file?file=legacy-template-output.png',
    mode: 'outpaint',
    modelType: 'QwenImageEditModularPipeline',
    templateId: oldOutpaintId,
    formSnapshot: {
      ...profilesModule.DEFAULT_STUDIO_FORM,
      mode: 'outpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
  });
  assert.equal(output.templateId, 'qwen_outpaint_aspect_template');
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
  for (const id of ids) {
    const template = STUDIO_TEMPLATES.find((item) => item.id === id);
    assert.ok(template, `${id} exists`);
    assert.equal(template.mode, 'text_to_image');
    assert.equal(template.modelType, 'QwenImageModularPipeline');
    assert.notEqual(template.category, 'upscale');
    assert.ok(template.tags.includes('low vram'));
    assert.ok(template.requiredBackendCapabilities.includes('Qwen direct Auto Diffusers path'));
    assert.equal(template.example.lockedSettings.resourceMode, 'auto');
    assert.equal(template.example.lockedSettings.width, 1024);
    assert.equal(template.example.lockedSettings.height, template.id === 'qwen_low_vram_product_concept' ? 768 : 1024);
    assert.equal(template.example.lockedSettings.steps, 50);
    assert.equal(template.example.lockedSettings.guidanceScale, 4);
    assert.equal(template.example.lockedSettings.quantizationMode, 'none');
    assert.equal(template.example.lockedSettings.offloadMode, 'model_cpu');
    assert.equal(template.example.lockedSettings.autoOffload, true);
  }
});

test('Qwen ControlNet keeps diffusion guidance separate from the bounded control scale', () => {
  const template = templatesModule.STUDIO_TEMPLATES.find((item) => item.id === 'qwen_control_image_layout');
  assert.ok(template);
  assert.equal(template.example.lockedSettings.guidanceScale, 4);
  assert.equal(template.example.lockedSettings.conditioningScale, 1);
});

test('High quality Qwen template exposes the Unsloth preview image and Auto settings', () => {
  const { STUDIO_TEMPLATES } = templatesModule;
  const template = STUDIO_TEMPLATES.find((item) => item.id === 'high_quality');
  assert.ok(template);
  assert.equal(template.mode, 'text_to_image');
  assert.equal(template.modelType, 'QwenImageModularPipeline');
  assert.match(template.userGoal, /botanical observatory preview/);
  assert.ok(template.tags.includes('unsloth'));
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
  assert.equal(profile.label, 'Qwen-Image-2512');
  assert.equal(profile.displayName, 'Qwen-Image-2512');
  assert.equal(profile.defaultRepo, 'Qwen/Qwen-Image-2512');
  assert.equal(profile.alternateArtifact, 'qwen_image_2512_fp8_e4m3fn.safetensors');
  assert.equal(editProfile.supportsMask, true);
  assert.equal(editProfile.inpaintContract.available, true);
  assert.equal(editProfile.inpaintContract.source, 'modules.QwenImage.Inpaint');
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
    assert.ok(requirement.artifacts.length > 0, `${id} declares required artifacts`);
    if (requirement.autoStatus === 'manual_only') {
      assert.ok(requirement.manualOnlyReason, `${id} explains why Auto is not enabled`);
    }
  }
});

test('Studio form migration normalizes legacy auto_cpu offload', () => {
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
  assert.equal(zImage.quantizationMode, 'none');
  assert.equal(zImage.offloadMode, 'group_disk');
});

test('Qwen-Image-2512 on 16GB CUDA auto plans locally and Manual blocks unsafe settings', () => {
  const form = {
    ...profilesModule.DEFAULT_STUDIO_FORM,
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    device: 'cuda:0',
    dtype: 'bfloat16',
    autoOffload: true,
    quantizationMode: 'none',
  };
  const issue = runReadinessModule.getStudioCudaCapacityIssue(
    form,
    runtimeStatus({
      totalBytes: 16 * 1024 ** 3,
      freeBytes: 15 * 1024 ** 3,
    }),
  );
  assert.equal(issue.blocking, false);
  assert.equal(issue.severity, 'info');
  assert.match(issue.message, /Qwen-Image-2512/);
  assert.match(issue.message, /choose a local plan/);
  assert.match(issue.details, /checks installed artifacts and hardware metadata/);

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

  const missingQuantNodeIssue = runReadinessModule.getStudioQuantizationCapabilityIssue(
    { ...form, resourceMode: 'manual', quantizationMode: 'bnb_4bit' },
    {
      'modules.ModularDiffusers.ModelsLoader': {},
    },
  );
  assert.equal(missingQuantNodeIssue.blocking, true);
  assert.match(missingQuantNodeIssue.details, /QuantizationConfigNode/);

  const quantNodeReadyIssue = runReadinessModule.getStudioQuantizationCapabilityIssue(
    { ...form, resourceMode: 'manual', quantizationMode: 'bnb_4bit' },
    {
      'modules.ModularDiffusers.ModelsLoader': {
        params: {
          offload_mode: { options: ['none', 'model_cpu', 'group_cpu', 'group_disk'] },
        },
      },
      'modules.ModularDiffusers.QuantizationConfigNode': {
        params: {
          component: { options: ['transformer', 'text_encoder', 'qwen_low_vram'] },
        },
      },
    },
  );
  assert.equal(quantNodeReadyIssue, null);

  const missingOffloadIssue = runReadinessModule.getStudioOffloadCapabilityIssue(
    { ...form, resourceMode: 'manual', offloadMode: 'group_disk' },
    {
      'modules.ModularDiffusers.ModelsLoader': {
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
      'modules.ModularDiffusers.ModelsLoader': {
        params: {
          offload_mode: { options: ['auto_cpu', 'group_cpu'] },
        },
      },
    },
  );
  assert.equal(legacyModelCpuOffloadIssue, null);

  const missingInpaintNodeIssue = runReadinessModule.getStudioQwenInpaintCapabilityIssue(
    {
      ...form,
      mode: 'inpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
    {
      'modules.QwenImage.LoadInpaintPipeline': {},
    },
  );
  assert.equal(missingInpaintNodeIssue.blocking, true);
  assert.match(missingInpaintNodeIssue.details, /modules\.QwenImage\.Inpaint/);

  const inpaintNodesReadyIssue = runReadinessModule.getStudioQwenInpaintCapabilityIssue(
    {
      ...form,
      mode: 'inpaint',
      modelType: 'QwenImageEditModularPipeline',
    },
    {
      'modules.QwenImage.LoadInpaintPipeline': {},
      'modules.QwenImage.Inpaint': {},
    },
  );
  assert.equal(inpaintNodesReadyIssue, null);
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
  assert.equal(qwenAutoPlan.executionPath, 'direct-qwen-image');
  assert.equal(resourcePlannerModule.getStudioResourceExecutionPathLabel(qwenAutoPlan), 'Auto: Direct Qwen');

  const qwenExpertPlan = resourcePlannerModule.resolveStudioResourcePlan({
    ...qwenAutoForm,
    resourceMode: 'expert',
  });
  assert.equal(qwenExpertPlan.executionPath, 'modular-diffusers');
  assert.equal(resourcePlannerModule.getStudioResourceExecutionPathLabel(qwenExpertPlan), 'Expert: full graph');

  const zImagePlan = resourcePlannerModule.resolveStudioResourcePlan({
    ...profilesModule.DEFAULT_STUDIO_FORM,
    modelType: 'ZImageModularPipeline',
  });
  assert.equal(zImagePlan.executionPath, 'modular-diffusers');
  assert.equal(resourcePlannerModule.getStudioResourceExecutionPathLabel(zImagePlan), 'Auto: Modular graph');
});

test('Studio runtime hints include exact Qwen model and CUDA budget intent', () => {
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
        executionPath: 'direct-qwen-image',
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
          executionPath: 'direct-qwen-image',
          modelRepo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
          quantizationMode: 'none',
          quantizedComponents: [],
          offloadMode: 'model_cpu',
          proof: { status: 'declared_safe' },
        },
        {
          id: 'qwen-t2i-fallback',
          executionPath: 'direct-qwen-image',
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
  assert.equal(graph.runtimeHints.modelName, 'Qwen-Image-2512');
  assert.equal(graph.runtimeHints.modelRepo, 'Qwen/Qwen-Image-2512');
  assert.equal(graph.runtimeHints.dtype, 'bfloat16');
  assert.equal(graph.runtimeHints.quantizationMode, 'none');
  assert.deepEqual(graph.runtimeHints.quantizedComponents, []);
  assert.equal(graph.runtimeHints.autoOffload, true);
  assert.equal(graph.runtimeHints.offloadMode, 'model_cpu');
  assert.deepEqual(graph.runtimeHints.supportedOffloadModes, [
    'none',
    'model_cpu',
    'sequential_cpu',
    'group_cpu',
    'group_disk',
  ]);
  assert.equal(graph.runtimeHints.executionPath, 'direct-qwen-image');
  assert.equal(graph.runtimeHints.resolvedArtifact, 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit');
  assert.equal(graph.runtimeHints.autoResourceCandidateId, 'qwen-t2i-prequantized-model-cpu');
  assert.equal(graph.runtimeHints.autoResourceProofStatus, 'declared_safe');
  assert.ok(graph.runtimeHints.resourceRetryPlans.length >= 1);
  assert.equal(graph.runtimeHints.lowVramMode, true);
  assert.equal(graph.runtimeHints.cudaMemoryTotalBytes, totalBytes);
  assert.ok(graph.runtimeHints.requestedCudaReserveBytes >= 1024 ** 3);
  assert.ok(graph.runtimeHints.requestedCudaBudgetBytes > 0);
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
