import type { StudioTemplate } from './types';

type RetainedGalleryRecipe = {
  readonly workflowId: string;
  readonly sourceTaskTemplateId: string;
  readonly template: StudioTemplate;
  readonly retainedGraphHash: string;
  readonly originalReceiptSha256: string;
  readonly reviewedTemplateSha256: string;
  readonly reviewedCatalogLock: {
    readonly templateLockHash: string;
    readonly galleryTemplateLockHash: string;
    readonly promptSettingsHash: string;
  };
} & ({ readonly inputSha256: string; readonly inputFileName: string } | { readonly promptSha256: string });

const syntheticGradientSha256 = '626815c78eaad46cad849732d1598b45b91700ce046c1ee3f4e2444db80aa32a';
const marigoldRevision = '04a73502f7fd8fc5e59947b9df3b2266d71d6849';
const smollm2Revision = '12fd25f77366fa6b3b4b768ec3050bf629380bac';
const spandrelRevision = '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094';

/**
 * Reviewed catalog recipes tied to saved runs. Canonical workflow generation
 * continues to seed their task contracts with the standalone defaults.
 */
export const RETAINED_GALLERY_TEMPLATES = [
  {
    workflowId: 'MarigoldDepthPipeline:depth_estimation',
    sourceTaskTemplateId: 'task-template:marigold-depth-lcm-v1-0:depth-estimation:v1',
    retainedGraphHash: 'sha256:canonical-graph-v1:ee35e710ecaf34a8a57d93fbefeea28b6a3795027ea8a3a872178501e852e06a',
    originalReceiptSha256: '1c358ef18df00556b704f826c706674d5ddbd89d8ad091478da862b8ad87c6ea',
    reviewedTemplateSha256: '4e43813ae0e4b664e4982545884644ec097eb0cc25e8f13ff549ac24c2f49ce1',
    reviewedCatalogLock: {
      templateLockHash: 'tpl_bf1d929b',
      galleryTemplateLockHash: 'tpl_611e9ad6',
      promptSettingsHash: 'ps_d0a17851',
    },
    inputSha256: syntheticGradientSha256,
    inputFileName: 'marigold-depth-source.png',
    template: {
      id: 'marigold_depth_synthetic_ramp',
      label: 'Marigold Depth LCM — Synthetic Ramp',
      modelDisplayName: 'Marigold Depth LCM',
      mode: 'depth_estimation',
      modelType: 'MarigoldDepthPipeline',
      intentGroup: 'utility',
      category: 'reference',
      tags: ['depth', 'technical preview'],
      difficulty: 'starter',
      readinessPolicy: 'requires_input',
      outputKinds: ['image'],
      thumbnailVariant: 'compareSlider',
      inputBindings: [
        {
          id: 'synthetic-ramp',
          label: 'Synthetic ramp',
          mediaType: 'image',
          origin: 'user',
          requiredAt: 'workflow_start',
          field: 'referenceImages',
          count: 1,
        },
      ],
      mediaSlots: [
        {
          id: 'before',
          label: 'Source ramp',
          kind: 'comparison_before',
          role: 'before',
          placeholder: 'Source pending',
        },
        {
          id: 'after',
          label: 'Depth preview',
          kind: 'comparison_after',
          role: 'after',
          placeholder: 'Preview pending',
        },
      ],
      requiredBackendCapabilities: [
        'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
        'modules.DiffusersRuntime.DiffusersExecutionRecipe',
        'modules.DiffusersImage.LoadPipeline',
        'modules.Image.Load',
        'modules.DiffusersImage.PredictMap',
        'modules.Image.Preview',
      ],
      modelArtifact: { source: 'hub', value: 'prs-eth/marigold-depth-lcm-v1-0', revision: marigoldRevision },
      runtimeReuseKey: 'MarigoldDepthPipeline:float32:none:resident:none',
      description: 'Run one-step relative depth estimation and compare the input ramp with its grayscale preview.',
      recipeSummary: 'Compare a source image with a one-step relative-depth preview.',
      prompt: '',
      example: {
        mediaType: 'image',
        status: 'unverified',
        modelRevision: marigoldRevision,
        lockedSeed: 42,
        lockedSettings: {
          width: 768,
          height: 768,
          steps: 1,
          guidanceScale: 0,
          dtype: 'float32',
          resourceMode: 'expert',
          quantizationMode: 'none',
          autoOffload: false,
          offloadMode: 'none',
        },
        expectedOutput: { width: 64, height: 48 },
        runtimeEstimate: '11.73 seconds in the retained Windows CUDA run',
        notes: 'The synthetic ramp demonstrates delivery of the preview. Depth accuracy remains unmeasured.',
      },
    },
  },
  {
    workflowId: 'SpandrelImageUpscale:image_upscale',
    sourceTaskTemplateId: 'task-template:real-esrgan-x2-image-upscale:v1',
    retainedGraphHash: 'sha256:canonical-graph-v1:700b85c678b691dee3c8ad1e2ea6d4cc0017d1b12d47704e45e913e17f929451',
    originalReceiptSha256: '49336b0f76e158b3be514275763e8b2c50f00c048852a34cff43167687503f15',
    reviewedTemplateSha256: '8de95b8b13a0636a37a7db672fbced2199e00e6719517c282f68f685bc5fd482',
    reviewedCatalogLock: {
      templateLockHash: 'tpl_5d99038b',
      galleryTemplateLockHash: 'tpl_43c3b587',
      promptSettingsHash: 'ps_e7556958',
    },
    inputSha256: syntheticGradientSha256,
    inputFileName: 'real-esrgan-x2-smoke-source.png',
    template: {
      id: 'spandrel_x2_synthetic_gradient',
      label: 'Spandrel Real-ESRGAN 2× — Synthetic Gradient',
      modelDisplayName: 'Real-ESRGAN 2×',
      mode: 'image_upscale',
      modelType: 'SpandrelImageUpscale',
      intentGroup: 'utility',
      category: 'upscale',
      tags: ['image upscale', 'technical preview'],
      difficulty: 'starter',
      readinessPolicy: 'requires_input',
      outputKinds: ['image'],
      thumbnailVariant: 'compareSlider',
      inputBindings: [
        {
          id: 'source-image',
          label: 'Source image',
          mediaType: 'image',
          origin: 'user',
          requiredAt: 'workflow_start',
          field: 'referenceImages',
          count: 1,
        },
      ],
      mediaSlots: [
        {
          id: 'before',
          label: 'Source gradient',
          kind: 'comparison_before',
          role: 'before',
          placeholder: 'Source pending',
        },
        {
          id: 'after',
          label: 'Upscaled gradient',
          kind: 'comparison_after',
          role: 'after',
          placeholder: 'Preview pending',
        },
      ],
      requiredBackendCapabilities: ['modules.Image.Load', 'modules.Spandrel.Upscaler', 'modules.Image.Preview'],
      modelArtifact: {
        source: 'hub',
        value: 'nateraw/real-esrgan',
        revision: spandrelRevision,
        sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
        byteSize: 67061725,
        license: 'bsd-3-clause',
      },
      description: 'Double the source image dimensions with tiled Real-ESRGAN upscaling.',
      recipeSummary: 'Compare the source gradient with its 2× output.',
      prompt: '',
      example: {
        mediaType: 'image',
        status: 'unverified',
        modelRevision: spandrelRevision,
        // Spandrel has no seed input. The generic template form retains a fixed seed.
        lockedSeed: 42,
        lockedSettings: {
          width: 128,
          height: 96,
          steps: 1,
          guidanceScale: 0,
          dtype: 'float32',
          resourceMode: 'expert',
          quantizationMode: 'none',
          autoOffload: false,
          offloadMode: 'none',
        },
        expectedOutput: { width: 128, height: 96 },
        runtimeEstimate: '5.80 seconds in the retained Windows CUDA run',
        notes:
          'Minor edge-region grain and colour drift. The synthetic gradient does not test restoration of fine detail.',
      },
    },
  },
  {
    workflowId: 'HuggingFaceTextGenerationModel:text_generation',
    sourceTaskTemplateId: 'task-template:smollm2-135m-instruct:text-generation:v1',
    retainedGraphHash: 'sha256:canonical-graph-v1:285625f017e8de78e065d8fc32c9ce71ed9561b008cd5fa0e23ce9cda3dabefe',
    originalReceiptSha256: '4d0e3ad2819d02cc04c3f264145ddd384b17b9dfa39e83f4af6e923bce34f3d8',
    reviewedTemplateSha256: 'aab7cfcf15db94d4e3d1415e963cabc0cf7e6a4baafd243d4095539b1004545b',
    reviewedCatalogLock: {
      templateLockHash: 'tpl_84d96f79',
      galleryTemplateLockHash: 'tpl_a845a534',
      promptSettingsHash: 'ps_fe288802',
    },
    promptSha256: '47eb5ebb2dbce8f755621e569deba76f6f61f251763aeac5fafd5d09be3869b4',
    template: {
      id: 'smollm2_rain_gauge',
      label: 'SmolLM2 135M Instruct — Rain Gauge Answer',
      modelDisplayName: 'SmolLM2 135M Instruct',
      mode: 'text_generation',
      modelType: 'HuggingFaceTextGenerationModel',
      intentGroup: 'utility',
      category: 'text',
      tags: ['text generation', 'JSON'],
      difficulty: 'starter',
      readinessPolicy: 'runnable',
      outputKinds: ['json'],
      mediaSlots: [
        { id: 'result', label: 'Structured response', kind: 'json', role: 'output', placeholder: 'Result pending' },
      ],
      requiredBackendCapabilities: [
        'modules.HuggingFaceTransformers.LoadTextGenerationModel',
        'modules.HuggingFaceTransformers.GenerateText',
        'modules.Primitive.DataViewer',
      ],
      modelArtifact: { source: 'hub', value: 'HuggingFaceTB/SmolLM2-135M-Instruct', revision: smollm2Revision },
      runtimeReuseKey: 'HuggingFaceTextGenerationModel:float32:none:resident:none',
      description: 'Answer a short factual question using greedy decoding and inspect the structured result.',
      recipeSummary: 'Answer a short question and inspect the text, finish reason, and token counts.',
      prompt: 'Reply in one short sentence: What does a rain gauge measure?',
      example: {
        mediaType: 'json',
        status: 'unverified',
        modelRevision: smollm2Revision,
        // Text generation uses greedy decoding and has no seed input.
        lockedSeed: 42,
        lockedSettings: {
          width: 1,
          height: 1,
          steps: 1,
          guidanceScale: 0,
          dtype: 'float32',
          resourceMode: 'expert',
          quantizationMode: 'none',
          autoOffload: false,
          offloadMode: 'none',
        },
        runtimeEstimate: '1.86 seconds in the retained Windows CUDA run',
        notes: 'The retained result demonstrates one factual prompt and reports the finish reason and token counts.',
      },
    },
  },
] as const satisfies readonly RetainedGalleryRecipe[];
