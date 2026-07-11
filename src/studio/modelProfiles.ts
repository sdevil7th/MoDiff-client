import type {
  StudioFormState,
  StudioInpaintContractStatus,
  StudioMode,
  StudioModelProfile,
  StudioModelRequirement,
  StudioModelType,
} from './types';

export const QWEN_CONTROLNET_REPO = 'InstantX/Qwen-Image-ControlNet-Union';
export const QWEN_IMAGE_2512_REPO = 'Qwen/Qwen-Image-2512';
export const QWEN_IMAGE_2512_PREQUANTIZED_REPO = 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit';
export const QWEN_IMAGE_EDIT_PREQUANTIZED_REPO = 'ovedrive/qwen-image-edit-4bit';
export const QWEN_LOW_VRAM_QUANTIZATION_MODE = 'bnb_4bit';
export const QWEN_LOW_VRAM_QUANTIZATION_COMPONENT = 'qwen_low_vram';
export const QWEN_TRANSFORMER_ONLY_QUANTIZED_COMPONENTS = ['transformer'] as const;
export const QWEN_LOW_VRAM_OFFLOAD_MODE = 'model_cpu';
export const STUDIO_OFFLOAD_MODES = ['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'] as const;
export const LEGACY_STUDIO_OFFLOAD_MODES = ['auto_cpu', ...STUDIO_OFFLOAD_MODES] as const;
export const STUDIO_OFFLOAD_LABELS: Record<StudioFormState['offloadMode'], string> = {
  none: 'Off',
  model_cpu: 'RAM/CPU model offload',
  sequential_cpu: 'RAM/CPU sequential offload',
  group_cpu: 'RAM/CPU group offload',
  group_disk: 'SSD group offload',
};
export const STUDIO_OFFLOAD_RUNTIME_LABELS: Record<StudioFormState['offloadMode'], string> = {
  none: 'off',
  model_cpu: 'model-cpu',
  sequential_cpu: 'sequential-cpu',
  group_cpu: 'group-cpu',
  group_disk: 'group-disk',
};
export const MODULAR_OFFLOAD_SUPPORT = {
  modes: ['none', 'model_cpu', 'group_cpu', 'group_disk'] as StudioFormState['offloadMode'][],
  default: 'model_cpu' as const,
  lowVram: 'model_cpu' as const,
  emergency: 'group_disk' as const,
};
export const DIRECT_OFFLOAD_SUPPORT = {
  modes: [...STUDIO_OFFLOAD_MODES],
  default: 'model_cpu' as const,
  lowVram: 'model_cpu' as const,
  emergency: 'group_disk' as const,
};
export const QWEN_MODULAR_OFFLOAD_SUPPORT = {
  modes: ['none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'] as StudioFormState['offloadMode'][],
  default: 'model_cpu' as const,
  lowVram: QWEN_LOW_VRAM_OFFLOAD_MODE as StudioFormState['offloadMode'],
  emergency: 'group_disk' as const,
};
export const QWEN_DIRECT_OFFLOAD_SUPPORT = {
  modes: [...STUDIO_OFFLOAD_MODES],
  default: 'model_cpu' as const,
  lowVram: QWEN_LOW_VRAM_OFFLOAD_MODE as StudioFormState['offloadMode'],
  emergency: 'group_disk' as const,
};
export const QWEN_QUANTIZATION_NODE_KEY = 'modules.ModularDiffusers.QuantizationConfigNode';
export const QWEN_T2I_PIPELINE_NODE_KEY = 'modules.QwenImage.LoadPipeline';
export const QWEN_T2I_GENERATE_NODE_KEY = 'modules.QwenImage.Generate';
export const QWEN_INPAINT_PIPELINE_NODE_KEY = 'modules.QwenImage.LoadInpaintPipeline';
export const QWEN_OUTPAINT_CANVAS_NODE_KEY = 'modules.QwenImage.OutpaintCanvas';
export const QWEN_INPAINT_GENERATE_NODE_KEY = 'modules.QwenImage.Inpaint';
export const ACE_STEP_REPO = 'ACE-Step/acestep-v15-xl-turbo-diffusers';
export const FLUX_SCHNELL_REPO = 'black-forest-labs/FLUX.1-schnell';
export const FLUX_DEV_REPO = 'black-forest-labs/FLUX.1-dev';
export const FLUX_KREA_REPO = 'black-forest-labs/FLUX.1-Krea-dev';
export const FLUX_KONTEXT_REPO = 'black-forest-labs/FLUX.1-Kontext-dev';
export const FLUX_FILL_REPO = 'black-forest-labs/FLUX.1-Fill-dev';
export const FLUX_DEPTH_REPO = 'black-forest-labs/FLUX.1-Depth-dev';
export const FLUX_CANNY_REPO = 'black-forest-labs/FLUX.1-Canny-dev';
export const FLUX_REDUX_REPO = 'black-forest-labs/FLUX.1-Redux-dev';
export const FLUX_DEV_FP8_REPO = 'black-forest-labs/FLUX.1-dev-FP8';
export const FLUX_KONTEXT_NVFP4_REPO = 'black-forest-labs/FLUX.1-Kontext-dev-NVFP4';

export const QWEN_CONTROLNET_REQUIREMENT: StudioModelRequirement = {
  id: 'qwen-controlnet-union',
  label: 'Qwen ControlNet Union',
  repo: QWEN_CONTROLNET_REPO,
  kind: 'controlnet',
  requiredForModes: ['control_image'],
  description: 'Required for Qwen Image Control image workflows.',
};

export const QWEN_IMAGE_EDIT_INPAINT_CONTRACT: StudioInpaintContractStatus = {
  available: true,
  status: 'supported',
  reason:
    'Direct Diffusers Qwen Image Edit inpaint is available through modules.QwenImage.LoadInpaintPipeline -> modules.QwenImage.Inpaint with source image and mask_image inputs. Outpaint uses modules.QwenImage.OutpaintCanvas to build the expanded canvas and boundary mask before the same inpaint node.',
  source: QWEN_INPAINT_GENERATE_NODE_KEY,
  checkedInputs: {
    loader: ['model_id', 'dtype', 'device', 'auto_offload', 'offload_mode', 'quant_config'],
    outpaint: [
      'image',
      'width',
      'height',
      'left',
      'right',
      'top',
      'bottom',
      'overlap',
      'feather',
      'fill_color',
      'canvas',
      'mask_image',
    ],
    inpaint: [
      'pipeline',
      'image',
      'mask_image',
      'prompt',
      'negative_prompt',
      'true_cfg_scale',
      'strength',
      'num_inference_steps',
    ],
  },
  missingInputs: [],
};

export const QWEN_IMAGE_EDIT_PLUS_INPAINT_CONTRACT: StudioInpaintContractStatus = {
  available: false,
  status: 'blocked',
  reason:
    'Qwen Image Edit Plus does not yet have a confirmed native mask, mask_image, or masked_image_latents execution contract in MoDiff.',
  source: 'modules.ModularDiffusers.modular_utils.QWEN_IMAGE_EDIT_PLUS_NODE_SPECS',
  checkedInputs: {
    denoise: ['embeddings', 'seed', 'num_inference_steps', 'guidance_scale', 'image_latents'],
    vae_encoder: ['image'],
    text_encoder: ['prompt', 'negative_prompt', 'image'],
  },
  missingInputs: ['mask', 'mask_image', 'masked_image_latents'],
};

export const STUDIO_MODEL_LABELS: Record<StudioModelType, string> = {
  ZImageModularPipeline: 'Z-Image Turbo',
  QwenImageModularPipeline: 'Qwen-Image-2512',
  QwenImageEditModularPipeline: 'Qwen-Image-Edit',
  QwenImageEditPlusModularPipeline: 'Qwen-Image-Edit-2511',
  QwenImageLayeredModularPipeline: 'Qwen-Image-Layered',
  WanVACEPipeline: 'Wan VACE 1.3B',
  AceStepAudioPipeline: 'ACE-Step Audio',
  FluxSchnellPipeline: 'FLUX.1-schnell',
  FluxDevPipeline: 'FLUX.1-dev',
  FluxKreaPipeline: 'FLUX.1-Krea-dev',
  FluxKontextPipeline: 'FLUX.1-Kontext-dev',
  FluxFillPipeline: 'FLUX.1-Fill-dev',
  FluxDepthPipeline: 'FLUX.1-Depth-dev',
  FluxCannyPipeline: 'FLUX.1-Canny-dev',
  FluxReduxPipeline: 'FLUX.1-Redux-dev',
};

export const STUDIO_MODE_LABELS: Record<StudioMode, string> = {
  text_to_image: 'Text to image',
  edit_image: 'Edit image',
  multi_image_reference_edit: 'Multi-image reference edit',
  inpaint: 'Inpaint',
  outpaint: 'Outpaint',
  control_image: 'Control image',
  layer_decomposition: 'Layer decomposition',
  text_to_video: 'Text to video',
  image_to_video: 'Image to video',
  video_to_video: 'Video to video',
  video_inpaint: 'Video inpaint',
  video_outpaint: 'Video outpaint',
  reference_to_video: 'Reference to video',
  control_to_video: 'Control to video',
  video_color_edit: 'Video color edit',
  text_to_audio: 'Text to audio',
  audio_variation: 'Audio variation',
  audio_continuation: 'Audio continuation',
  audio_repaint: 'Audio repaint',
  advanced_workflow: 'Advanced workflow',
};

export const STUDIO_MODE_DESCRIPTIONS: Record<StudioMode, string> = {
  text_to_image: 'Generate from a prompt with a compatible image model.',
  edit_image: 'Use one source image and a prompt to guide an edit.',
  multi_image_reference_edit: 'Blend multiple references into one guided edit.',
  inpaint: 'Prepare an image and mask workflow for targeted edits.',
  outpaint: 'Extend an image onto a larger canvas with a generated boundary mask.',
  control_image: 'Use a control image with the Qwen ControlNet graph.',
  layer_decomposition: 'Use a layered model for separated outputs.',
  text_to_video: 'Generate a short video from a prompt.',
  image_to_video: 'Animate a still image or image reference.',
  video_to_video: 'Edit a source video with Wan VACE conditioning.',
  video_inpaint: 'Use source and mask videos for targeted video generation.',
  video_outpaint: 'Extend or reframe a video with boundary masks.',
  reference_to_video: 'Use reference images to guide a generated video.',
  control_to_video: 'Use a prepared control video such as grayscale, sketch, depth, or pose.',
  video_color_edit: 'Prompt-guided generative video color edit.',
  text_to_audio: 'Generate music or audio from prompt and lyrics.',
  audio_variation: 'Create a guided variation or cover from source audio.',
  audio_continuation: 'Continue source audio with prompt-guided generation.',
  audio_repaint: 'Regenerate a selected audio range while preserving the rest.',
  advanced_workflow: 'Open the empty graph and build manually.',
};

type StudioModelSurfaceMetadata = Pick<
  StudioModelProfile,
  'surfaceCategory' | 'runtimeKind' | 'isDiffusersBacked' | 'acceleratorStrategy' | 'legacyReason'
>;

const DIFFUSERS_IMAGE_MODEL: StudioModelSurfaceMetadata = {
  surfaceCategory: 'Image',
  runtimeKind: 'diffusers',
  isDiffusersBacked: true,
};

const DIFFUSERS_IMAGE_EDIT_MODEL: StudioModelSurfaceMetadata = {
  surfaceCategory: 'Image Edit',
  runtimeKind: 'diffusers',
  isDiffusersBacked: true,
};

const DIFFUSERS_CONTROL_MODEL: StudioModelSurfaceMetadata = {
  surfaceCategory: 'Control',
  runtimeKind: 'diffusers',
  isDiffusersBacked: true,
};

const DIFFUSERS_VIDEO_MODEL: StudioModelSurfaceMetadata = {
  surfaceCategory: 'Video',
  runtimeKind: 'diffusers',
  isDiffusersBacked: true,
};

const DIFFUSERS_AUDIO_MODEL: StudioModelSurfaceMetadata = {
  surfaceCategory: 'Audio',
  runtimeKind: 'diffusers',
  isDiffusersBacked: true,
};

const DIFFUSERS_UTILITY_MODEL: StudioModelSurfaceMetadata = {
  surfaceCategory: 'Utility',
  runtimeKind: 'diffusers',
  isDiffusersBacked: true,
};

export const WAN_VACE_REPO = 'Wan-AI/Wan2.1-VACE-1.3B-diffusers';
export const WAN_VACE_REVISION = 'ec4d2cb062b548996b179d493fdd05340de702a1';

export const VIDEO_STUDIO_MODES: StudioMode[] = [
  'text_to_video',
  'image_to_video',
  'video_to_video',
  'video_inpaint',
  'video_outpaint',
  'reference_to_video',
  'control_to_video',
  'video_color_edit',
];

export const AUDIO_STUDIO_MODES: StudioMode[] = [
  'text_to_audio',
  'audio_variation',
  'audio_continuation',
  'audio_repaint',
];

export const FLUX_STUDIO_MODEL_TYPES: StudioModelType[] = [
  'FluxSchnellPipeline',
  'FluxDevPipeline',
  'FluxKreaPipeline',
  'FluxKontextPipeline',
  'FluxFillPipeline',
  'FluxDepthPipeline',
  'FluxCannyPipeline',
  'FluxReduxPipeline',
];

export function normalizeStudioOffloadMode(value: unknown): StudioFormState['offloadMode'] {
  if (value === 'auto_cpu') return 'model_cpu';
  return typeof value === 'string' && (STUDIO_OFFLOAD_MODES as readonly string[]).includes(value)
    ? (value as StudioFormState['offloadMode'])
    : 'model_cpu';
}

export function offloadModeIsSupported(profile: StudioModelProfile, mode: StudioFormState['offloadMode']) {
  return profile.offloadSupport.modes.includes(mode);
}

export function getStudioModelCatalogVisibility(profile: StudioModelProfile) {
  return profile.catalogVisibility ?? 'default';
}

export function isStudioModelVisibleInCatalog(
  modelType: StudioModelType,
  options: { currentModelType?: StudioModelType | null; includeWorkflowOnly?: boolean } = {},
) {
  const profile = STUDIO_MODEL_PROFILES[modelType];
  if (!profile) return false;
  const visibility = getStudioModelCatalogVisibility(profile);
  if (visibility === 'default') return true;
  if (visibility === 'workflowOnly') {
    return Boolean(options.includeWorkflowOnly || options.currentModelType === modelType);
  }
  return false;
}

export function getCatalogModelProfiles(
  options: { currentModelType?: StudioModelType | null; includeWorkflowOnly?: boolean } = {},
) {
  return Object.values(STUDIO_MODEL_PROFILES).filter((profile) =>
    isStudioModelVisibleInCatalog(profile.modelType, options),
  );
}

export function getStudioModelRuntimeKind(profile: StudioModelProfile) {
  return profile.runtimeKind ?? 'diffusers';
}

export function isStudioModelDiffusersBacked(profile: StudioModelProfile) {
  const runtimeKind = getStudioModelRuntimeKind(profile);
  return profile.isDiffusersBacked ?? (runtimeKind === 'diffusers' || runtimeKind === 'diffusers_accelerated');
}

export const STUDIO_MODEL_PROFILES: Record<StudioModelType, StudioModelProfile> = {
  ZImageModularPipeline: {
    modelType: 'ZImageModularPipeline',
    label: STUDIO_MODEL_LABELS.ZImageModularPipeline,
    displayName: 'Z-Image Turbo',
    family: 'Z-Image',
    ...DIFFUSERS_IMAGE_MODEL,
    defaultRepo: 'Tongyi-MAI/Z-Image-Turbo',
    artifactLabel: 'Diffusers repo',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 8,
    recommendedGuidance: 1,
    guidanceLabel: 'Guidance',
    supportsImageInput: false,
    supportsMask: true,
    supportsMultiImage: false,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: MODULAR_OFFLOAD_SUPPORT,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: MODULAR_OFFLOAD_SUPPORT.lowVram, steps: 8 },
    modes: ['text_to_image'],
  },
  QwenImageModularPipeline: {
    modelType: 'QwenImageModularPipeline',
    label: STUDIO_MODEL_LABELS.QwenImageModularPipeline,
    displayName: 'Qwen-Image-2512',
    family: 'Qwen Image',
    ...DIFFUSERS_IMAGE_MODEL,
    defaultRepo: QWEN_IMAGE_2512_REPO,
    artifactLabel: 'bfloat16 Diffusers repo',
    alternateArtifact: 'qwen_image_2512_fp8_e4m3fn.safetensors',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1328, height: 1328, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 4,
    guidanceLabel: 'Guidance',
    supportsImageInput: false,
    supportsMask: false,
    supportsMultiImage: false,
    supportsControlImage: true,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: QWEN_MODULAR_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: QWEN_LOW_VRAM_QUANTIZATION_MODE,
      autoOffload: true,
      offloadMode: QWEN_LOW_VRAM_OFFLOAD_MODE,
      steps: 50,
      width: 1024,
      height: 1024,
    },
    modes: ['text_to_image', 'control_image'],
    additionalRequirements: [QWEN_CONTROLNET_REQUIREMENT],
    modeRequirements: {
      control_image: {
        modelRequirements: [QWEN_CONTROLNET_REQUIREMENT],
        requiredImages: ['controlImage'],
        note: 'Requires the Qwen ControlNet Union model plus one control image.',
      },
    },
  },
  QwenImageEditModularPipeline: {
    modelType: 'QwenImageEditModularPipeline',
    label: STUDIO_MODEL_LABELS.QwenImageEditModularPipeline,
    displayName: 'Qwen-Image-Edit',
    family: 'Qwen Image',
    ...DIFFUSERS_IMAGE_EDIT_MODEL,
    defaultRepo: 'Qwen/Qwen-Image-Edit',
    artifactLabel: 'Diffusers image-edit repo',
    alternateArtifact: QWEN_IMAGE_EDIT_PREQUANTIZED_REPO,
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 40,
    recommendedGuidance: 4,
    guidanceLabel: 'Guidance',
    supportsImageInput: true,
    supportsMask: true,
    supportsMultiImage: false,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: true,
    inpaintContract: QWEN_IMAGE_EDIT_INPAINT_CONTRACT,
    offloadSupport: QWEN_DIRECT_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: QWEN_LOW_VRAM_QUANTIZATION_MODE,
      autoOffload: true,
      offloadMode: QWEN_LOW_VRAM_OFFLOAD_MODE,
      steps: 24,
    },
    modes: ['edit_image', 'inpaint', 'outpaint'],
    modeRequirements: {
      inpaint: {
        requiredImages: ['referenceImages', 'maskImage'],
        note: 'Requires one source image and one mask image.',
      },
      outpaint: {
        requiredImages: ['referenceImages'],
        note: 'Requires one source image; Studio builds the expanded canvas and boundary mask.',
      },
    },
  },
  QwenImageEditPlusModularPipeline: {
    modelType: 'QwenImageEditPlusModularPipeline',
    label: STUDIO_MODEL_LABELS.QwenImageEditPlusModularPipeline,
    displayName: 'Qwen-Image-Edit-2511',
    family: 'Qwen Image',
    ...DIFFUSERS_IMAGE_EDIT_MODEL,
    defaultRepo: 'Qwen/Qwen-Image-Edit-2511',
    artifactLabel: 'bfloat16 Diffusers repo',
    alternateArtifact: 'qwen_image_edit_2511_bf16.safetensors',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 40,
    recommendedGuidance: 4,
    guidanceLabel: 'Guidance',
    supportsImageInput: true,
    supportsMask: false,
    supportsMultiImage: true,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: true,
    inpaintContract: QWEN_IMAGE_EDIT_PLUS_INPAINT_CONTRACT,
    offloadSupport: QWEN_MODULAR_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: QWEN_LOW_VRAM_QUANTIZATION_MODE,
      autoOffload: true,
      offloadMode: QWEN_LOW_VRAM_OFFLOAD_MODE,
      steps: 24,
    },
    modes: ['edit_image', 'multi_image_reference_edit', 'inpaint'],
    modeRequirements: {
      inpaint: {
        requiredImages: ['referenceImages', 'maskImage'],
        note: QWEN_IMAGE_EDIT_PLUS_INPAINT_CONTRACT.reason,
      },
    },
  },
  QwenImageLayeredModularPipeline: {
    modelType: 'QwenImageLayeredModularPipeline',
    label: STUDIO_MODEL_LABELS.QwenImageLayeredModularPipeline,
    displayName: 'Qwen-Image-Layered',
    family: 'Qwen Image',
    ...DIFFUSERS_UTILITY_MODEL,
    defaultRepo: 'Qwen/Qwen-Image-Layered',
    artifactLabel: 'bfloat16 Diffusers repo',
    alternateArtifact: 'qwen_image_layered_bf16.safetensors',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 4,
    guidanceLabel: 'Guidance',
    supportsImageInput: true,
    supportsMask: false,
    supportsMultiImage: false,
    supportsControlImage: false,
    supportsLayers: true,
    supportsLora: true,
    offloadSupport: QWEN_MODULAR_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: QWEN_LOW_VRAM_QUANTIZATION_MODE,
      autoOffload: true,
      offloadMode: QWEN_LOW_VRAM_OFFLOAD_MODE,
      steps: 30,
    },
    modes: ['layer_decomposition'],
  },
  WanVACEPipeline: {
    modelType: 'WanVACEPipeline',
    label: STUDIO_MODEL_LABELS.WanVACEPipeline,
    displayName: 'Wan2.1-VACE-1.3B-diffusers',
    family: 'Wan Video',
    ...DIFFUSERS_VIDEO_MODEL,
    defaultRepo: WAN_VACE_REPO,
    artifactLabel: 'Diffusers repo',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 832, height: 480, aspectRatio: '16:9' },
    recommendedSteps: 30,
    recommendedGuidance: 5,
    guidanceLabel: 'Guidance',
    supportsImageInput: true,
    supportsMask: true,
    supportsMultiImage: true,
    supportsControlImage: true,
    supportsLayers: false,
    supportsLora: true,
    supportsVideoInput: true,
    supportsVideoMask: true,
    outputKind: 'video',
    recommendedFrames: 81,
    recommendedFps: 16,
    conditioningScale: 1,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram, steps: 24 },
    modes: VIDEO_STUDIO_MODES,
    modeRequirements: {
      image_to_video: {
        requiredImages: ['referenceImages'],
        note: 'Requires at least one starting/reference image.',
      },
      video_to_video: {
        requiredVideos: ['sourceVideo'],
        note: 'Requires one source video.',
      },
      video_inpaint: {
        requiredVideos: ['sourceVideo', 'maskVideo'],
        note: 'Requires source and mask videos with matching frame counts.',
      },
      video_outpaint: {
        requiredVideos: ['sourceVideo', 'maskVideo'],
        note: 'Requires source video plus a boundary/generation mask video.',
      },
      reference_to_video: {
        requiredImages: ['referenceImages'],
        note: 'Requires one or more reference images.',
      },
      control_to_video: {
        requiredVideos: ['controlVideo'],
        note: 'Requires a prepared control video.',
      },
      video_color_edit: {
        requiredVideos: ['sourceVideo'],
        note: 'Requires one source video.',
      },
    },
  },
  AceStepAudioPipeline: {
    modelType: 'AceStepAudioPipeline',
    label: STUDIO_MODEL_LABELS.AceStepAudioPipeline,
    displayName: 'acestep-v15-xl-turbo-diffusers',
    family: 'ACE Audio',
    ...DIFFUSERS_AUDIO_MODEL,
    defaultRepo: ACE_STEP_REPO,
    artifactLabel: 'Diffusers audio repo',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 8,
    recommendedGuidance: 1,
    guidanceLabel: 'Guidance (distilled; fixed at 1)',
    supportsImageInput: false,
    supportsMask: false,
    supportsMultiImage: false,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: false,
    supportsAudioInput: true,
    outputKind: 'audio',
    recommendedDuration: 30,
    recommendedSampleRate: 44100,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram, steps: 8 },
    modes: AUDIO_STUDIO_MODES,
    modeRequirements: {
      audio_variation: {
        requiredAudio: ['sourceAudio'],
        note: 'Requires one source audio file for cover or variation guidance.',
      },
      audio_continuation: {
        requiredAudio: ['sourceAudio'],
        note: 'Requires one source audio file to continue.',
      },
      audio_repaint: {
        requiredAudio: ['sourceAudio'],
        note: 'Requires one source audio file plus a repaint range.',
      },
    },
  },
  FluxSchnellPipeline: {
    modelType: 'FluxSchnellPipeline',
    label: STUDIO_MODEL_LABELS.FluxSchnellPipeline,
    displayName: 'FLUX.1-schnell',
    family: 'FLUX Image',
    ...DIFFUSERS_IMAGE_MODEL,
    catalogVisibility: 'default',
    defaultRepo: FLUX_SCHNELL_REPO,
    artifactLabel: 'Diffusers repo',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 4,
    recommendedGuidance: 0,
    guidanceLabel: 'Guidance',
    supportsImageInput: false,
    supportsMask: false,
    supportsMultiImage: false,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 4,
      width: 1024,
      height: 1024,
    },
    modes: ['text_to_image'],
  },
  FluxDevPipeline: {
    modelType: 'FluxDevPipeline',
    label: STUDIO_MODEL_LABELS.FluxDevPipeline,
    displayName: 'FLUX.1-dev',
    family: 'FLUX Image',
    ...DIFFUSERS_IMAGE_MODEL,
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_DEV_REPO,
    artifactLabel: 'Diffusers repo',
    alternateArtifact: FLUX_DEV_FP8_REPO,
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 28,
    recommendedGuidance: 3.5,
    guidanceLabel: 'Guidance',
    supportsImageInput: false,
    supportsMask: false,
    supportsMultiImage: false,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: 'quanto_float8',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency,
      steps: 24,
      width: 1024,
      height: 1024,
    },
    modes: ['text_to_image'],
  },
  FluxKreaPipeline: {
    modelType: 'FluxKreaPipeline',
    label: STUDIO_MODEL_LABELS.FluxKreaPipeline,
    displayName: 'FLUX.1-Krea-dev',
    family: 'FLUX Image',
    ...DIFFUSERS_IMAGE_MODEL,
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_KREA_REPO,
    artifactLabel: 'Diffusers repo',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 28,
    recommendedGuidance: 3.5,
    guidanceLabel: 'Guidance',
    supportsImageInput: false,
    supportsMask: false,
    supportsMultiImage: false,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency, steps: 24 },
    modes: ['text_to_image'],
  },
  FluxKontextPipeline: {
    modelType: 'FluxKontextPipeline',
    label: STUDIO_MODEL_LABELS.FluxKontextPipeline,
    displayName: 'FLUX.1-Kontext-dev',
    family: 'FLUX Image',
    ...DIFFUSERS_IMAGE_EDIT_MODEL,
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_KONTEXT_REPO,
    artifactLabel: 'Diffusers repo',
    alternateArtifact: FLUX_KONTEXT_NVFP4_REPO,
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 28,
    recommendedGuidance: 3.5,
    guidanceLabel: 'Guidance',
    supportsImageInput: true,
    supportsMask: false,
    supportsMultiImage: true,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: 'torchao_float8',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency,
      steps: 24,
    },
    modes: ['edit_image', 'multi_image_reference_edit'],
    modeRequirements: {
      edit_image: {
        requiredImages: ['referenceImages'],
        note: 'Requires one source image for Kontext editing.',
      },
      multi_image_reference_edit: {
        requiredImages: ['referenceImages'],
        note: 'Requires one or more source/reference images.',
      },
    },
  },
  FluxFillPipeline: {
    modelType: 'FluxFillPipeline',
    label: STUDIO_MODEL_LABELS.FluxFillPipeline,
    displayName: 'FLUX.1-Fill-dev',
    family: 'FLUX Image',
    ...DIFFUSERS_IMAGE_EDIT_MODEL,
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_FILL_REPO,
    artifactLabel: 'Diffusers repo',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 30,
    guidanceLabel: 'Guidance',
    supportsImageInput: true,
    supportsMask: true,
    supportsMultiImage: false,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: 'quanto_float8',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency,
      steps: 24,
    },
    modes: ['inpaint', 'outpaint'],
    modeRequirements: {
      inpaint: {
        requiredImages: ['referenceImages', 'maskImage'],
        note: 'Requires one source image and one mask image.',
      },
      outpaint: {
        requiredImages: ['referenceImages'],
        note: 'Requires one source image; Studio can prepare a larger canvas.',
      },
    },
  },
  FluxDepthPipeline: {
    modelType: 'FluxDepthPipeline',
    label: STUDIO_MODEL_LABELS.FluxDepthPipeline,
    displayName: 'FLUX.1-Depth-dev',
    family: 'FLUX Image',
    ...DIFFUSERS_CONTROL_MODEL,
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_DEPTH_REPO,
    artifactLabel: 'Diffusers repo',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 30,
    guidanceLabel: 'Guidance',
    supportsImageInput: true,
    supportsMask: false,
    supportsMultiImage: false,
    supportsControlImage: true,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency, steps: 24 },
    modes: ['control_image'],
    modeRequirements: {
      control_image: {
        requiredImages: ['controlImage'],
        note: 'Requires a depth control image.',
      },
    },
  },
  FluxCannyPipeline: {
    modelType: 'FluxCannyPipeline',
    label: STUDIO_MODEL_LABELS.FluxCannyPipeline,
    displayName: 'FLUX.1-Canny-dev',
    family: 'FLUX Image',
    ...DIFFUSERS_CONTROL_MODEL,
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_CANNY_REPO,
    artifactLabel: 'Diffusers repo',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 30,
    guidanceLabel: 'Guidance',
    supportsImageInput: true,
    supportsMask: false,
    supportsMultiImage: false,
    supportsControlImage: true,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency, steps: 24 },
    modes: ['control_image'],
    modeRequirements: {
      control_image: {
        requiredImages: ['controlImage'],
        note: 'Requires a canny/control image.',
      },
    },
  },
  FluxReduxPipeline: {
    modelType: 'FluxReduxPipeline',
    label: STUDIO_MODEL_LABELS.FluxReduxPipeline,
    displayName: 'FLUX.1-Redux-dev',
    family: 'FLUX Image',
    ...DIFFUSERS_IMAGE_EDIT_MODEL,
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_REDUX_REPO,
    artifactLabel: 'Diffusers repo',
    defaultDtype: 'bfloat16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 28,
    recommendedGuidance: 3.5,
    guidanceLabel: 'Guidance',
    supportsImageInput: true,
    supportsMask: false,
    supportsMultiImage: true,
    supportsControlImage: false,
    supportsLayers: false,
    supportsLora: true,
    offloadSupport: DIRECT_OFFLOAD_SUPPORT,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency, steps: 24 },
    modes: ['edit_image', 'multi_image_reference_edit'],
    modeRequirements: {
      edit_image: {
        requiredImages: ['referenceImages'],
        note: 'Requires one source/reference image.',
      },
      multi_image_reference_edit: {
        requiredImages: ['referenceImages'],
        note: 'Requires one or more source/reference images.',
      },
    },
  },
};

export type StudioAutoModelRequirementMetadata = {
  modelType: StudioModelType;
  supportedModes: StudioMode[];
  autoStatus: 'auto_ready' | 'manual_only';
  minimum: string;
  recommended: string;
  qualityDefaults: string;
  artifacts: string[];
  notes: string;
  manualOnlyReason?: string;
};

export const STUDIO_AUTO_MODEL_REQUIREMENTS = {
  ZImageModularPipeline: {
    modelType: 'ZImageModularPipeline',
    supportedModes: ['text_to_image'],
    autoStatus: 'auto_ready',
    minimum: 'CPU fallback is technically possible; CUDA or MPS is preferred.',
    recommended: '8 GB or more accelerator memory, 16 GB system RAM, official Diffusers repo installed.',
    qualityDefaults: '1024x1024, 8 steps, guidance 1.',
    artifacts: ['Tongyi-MAI/Z-Image-Turbo'],
    notes: 'Turbo model; Auto can prioritize speed without lowering model intent.',
  },
  QwenImageModularPipeline: {
    modelType: 'QwenImageModularPipeline',
    supportedModes: ['text_to_image', 'control_image'],
    autoStatus: 'auto_ready',
    minimum: 'CUDA accelerator, 10 GB or more VRAM, 24 GB system RAM for prequantized text-to-image.',
    recommended:
      '16 GB or more VRAM with the Diffusers-compatible prequantized Qwen artifact; official BF16 native requires much larger headroom.',
    qualityDefaults:
      '1024x1024, 50 steps, true CFG 4 for constrained hardware; native 1328 only when requirements match.',
    artifacts: [QWEN_IMAGE_2512_REPO, QWEN_IMAGE_2512_PREQUANTIZED_REPO],
    notes:
      'Auto text-to-image may use the prequantized Diffusers artifact. Control image remains Expert until its modular recipe is validated.',
  },
  QwenImageEditModularPipeline: {
    modelType: 'QwenImageEditModularPipeline',
    supportedModes: ['edit_image', 'inpaint', 'outpaint'],
    autoStatus: 'auto_ready',
    minimum: 'CUDA accelerator with 16 GB VRAM and 24 GB system RAM for the Diffusers-compatible 4-bit edit artifact.',
    recommended:
      'Use the prequantized edit artifact on 16 GB hardware; reserve official BF16 for 24-32 GB VRAM systems.',
    qualityDefaults: '1024x1024, 40 steps, true CFG 4.',
    artifacts: ['Qwen/Qwen-Image-Edit', QWEN_IMAGE_EDIT_PREQUANTIZED_REPO],
    notes: 'Auto prefers the Apache-2.0 prequantized Diffusers edit artifact on constrained CUDA hardware.',
  },
  QwenImageEditPlusModularPipeline: {
    modelType: 'QwenImageEditPlusModularPipeline',
    supportedModes: ['edit_image', 'multi_image_reference_edit', 'inpaint'],
    autoStatus: 'manual_only',
    minimum: 'Expert only until the Modular/Diffusers execution contract is validated.',
    recommended: 'Define a direct or strict modular recipe before enabling Auto.',
    qualityDefaults: 'Model card defaults: 40 steps, true CFG 4, guidance 1 where applicable.',
    artifacts: ['Qwen/Qwen-Image-Edit-2511'],
    notes: 'Do not expose as Auto-ready without a model requirements update.',
    manualOnlyReason: QWEN_IMAGE_EDIT_PLUS_INPAINT_CONTRACT.reason,
  },
  QwenImageLayeredModularPipeline: {
    modelType: 'QwenImageLayeredModularPipeline',
    supportedModes: ['layer_decomposition'],
    autoStatus: 'manual_only',
    minimum: 'Expert only until layered outputs are validated against a resource recipe.',
    recommended: 'Define per-layer resolution, memory, and decode requirements before enabling Auto.',
    qualityDefaults: 'Layered model defaults: 4 layers, 50 steps, true CFG 4.',
    artifacts: ['Qwen/Qwen-Image-Layered'],
    notes: 'Specialized output contract; Auto should not guess.',
    manualOnlyReason: 'Layered generation needs a validated per-layer Auto recipe.',
  },
  WanVACEPipeline: {
    modelType: 'WanVACEPipeline',
    supportedModes: VIDEO_STUDIO_MODES,
    autoStatus: 'auto_ready',
    minimum: 'CUDA accelerator with enough memory for 1.3B Wan VACE plus CPU/system-memory offload.',
    recommended: '12 GB or more VRAM, 32 GB system RAM, 20 GB or more free disk for emergency offload.',
    qualityDefaults: '832x480, 49 frames, 24 steps for constrained hardware; 81 frames/30 steps when resources fit.',
    artifacts: [WAN_VACE_REPO],
    notes: 'Video recipes are slower and use visible retry/fallback only after the user starts Run.',
  },
  AceStepAudioPipeline: {
    modelType: 'AceStepAudioPipeline',
    supportedModes: AUDIO_STUDIO_MODES,
    autoStatus: 'auto_ready',
    minimum:
      'CUDA accelerator, CPU/system-RAM offload, 24 GB system RAM, and enough disk for the ACE-Step Diffusers repo.',
    recommended: '16 GB VRAM with bfloat16, model CPU offload, and 30-60 second generations before longer runs.',
    qualityDefaults:
      '30 seconds, 8 steps, guidance 1, shift 3. XL Turbo is guidance-distilled and ignores guidance above 1.',
    artifacts: [ACE_STEP_REPO],
    notes:
      'Auto enables Diffusers offload by default. XL Turbo is guidance-distilled, so guidance above 1 is ignored; source audio is used only for variation, continuation, and repaint tasks.',
  },
  FluxSchnellPipeline: {
    modelType: 'FluxSchnellPipeline',
    supportedModes: ['text_to_image'],
    autoStatus: 'auto_ready',
    minimum: 'CUDA accelerator with 12 GB or more VRAM plus CPU/system-RAM offload.',
    recommended: 'RTX 4080 16 GB or better, bfloat16, low-step schnell recipe, and model CPU offload.',
    qualityDefaults: '1024x1024, 4 steps, guidance 0.',
    artifacts: [FLUX_SCHNELL_REPO],
    notes: 'This is the local FLUX default for the current 16 GB VRAM target.',
  },
  FluxDevPipeline: {
    modelType: 'FluxDevPipeline',
    supportedModes: ['text_to_image'],
    autoStatus: 'auto_ready',
    minimum:
      'Official bfloat16 is guarded on 16 GB VRAM; Auto should prefer a quantized/lower-memory artifact when available.',
    recommended:
      '24 GB or more VRAM for native bfloat16, or an FP8 artifact with CPU/SSD offload on constrained machines.',
    qualityDefaults: '1024x1024, 24-28 steps, guidance 3.5.',
    artifacts: [FLUX_DEV_REPO, FLUX_DEV_FP8_REPO],
    notes: 'Auto install should target the quantized artifact on 16 GB VRAM when native bfloat16 is not safe.',
  },
  FluxKreaPipeline: {
    modelType: 'FluxKreaPipeline',
    supportedModes: ['text_to_image'],
    autoStatus: 'manual_only',
    minimum: 'Expert only until a local low-memory Krea recipe is validated.',
    recommended: '24 GB or more VRAM or a proven quantized artifact.',
    qualityDefaults: '1024x1024, 24-28 steps, guidance 3.5.',
    artifacts: [FLUX_KREA_REPO],
    notes: 'Expose the model, but block Auto until runtime support is proven.',
    manualOnlyReason: 'FLUX Krea has no validated Auto recipe for this machine yet.',
  },
  FluxKontextPipeline: {
    modelType: 'FluxKontextPipeline',
    supportedModes: ['edit_image', 'multi_image_reference_edit'],
    autoStatus: 'manual_only',
    minimum: 'Expert only unless a validated NVFP4/FP8 artifact and image-edit pipeline support are installed.',
    recommended: '24 GB or more VRAM or a proven quantized artifact with image input support.',
    qualityDefaults: '1024x1024, 24-28 steps, guidance 3.5.',
    artifacts: [FLUX_KONTEXT_REPO, FLUX_KONTEXT_NVFP4_REPO],
    notes: 'Expose as a guarded edit profile. Auto can be enabled after local compatibility probes pass.',
    manualOnlyReason: 'FLUX Kontext needs validated image-edit pipeline support before Auto is enabled.',
  },
  FluxFillPipeline: {
    modelType: 'FluxFillPipeline',
    supportedModes: ['inpaint', 'outpaint'],
    autoStatus: 'manual_only',
    minimum: 'Expert only until the Fill inpaint/outpaint contract is validated locally.',
    recommended: '24 GB or more VRAM or a proven quantized Fill artifact.',
    qualityDefaults: '1024x1024, 50 steps, embedded guidance 30, full masked-region strength.',
    artifacts: [FLUX_FILL_REPO],
    notes: 'Requires image and mask handling through generic Diffusers image nodes.',
    manualOnlyReason: 'FLUX Fill needs validated mask/canvas behavior before Auto is enabled.',
  },
  FluxDepthPipeline: {
    modelType: 'FluxDepthPipeline',
    supportedModes: ['control_image'],
    autoStatus: 'manual_only',
    minimum: 'Expert only until control-image support is validated.',
    recommended: '24 GB or more VRAM or a proven quantized artifact.',
    qualityDefaults: '1024x1024, 50 steps, embedded guidance 30 with a user-supplied depth map.',
    artifacts: [FLUX_DEPTH_REPO],
    notes: 'Requires a prepared depth control image.',
    manualOnlyReason: 'FLUX Depth control input mapping needs local proof.',
  },
  FluxCannyPipeline: {
    modelType: 'FluxCannyPipeline',
    supportedModes: ['control_image'],
    autoStatus: 'manual_only',
    minimum: 'Expert only until control-image support is validated.',
    recommended: '24 GB or more VRAM or a proven quantized artifact.',
    qualityDefaults: '1024x1024, 50 steps, embedded guidance 30 with a user-supplied Canny map.',
    artifacts: [FLUX_CANNY_REPO],
    notes: 'Requires a prepared canny/control image.',
    manualOnlyReason: 'FLUX Canny control input mapping needs local proof.',
  },
  FluxReduxPipeline: {
    modelType: 'FluxReduxPipeline',
    supportedModes: ['edit_image', 'multi_image_reference_edit'],
    autoStatus: 'manual_only',
    minimum: 'Expert only until Redux adapter/reference behavior is validated.',
    recommended: '24 GB or more VRAM or a proven quantized artifact.',
    qualityDefaults: '1024x1024, 24-28 steps, guidance 3.5.',
    artifacts: [FLUX_REDUX_REPO],
    notes: 'Requires adapter/reference-image handling through generic Diffusers nodes.',
    manualOnlyReason: 'FLUX Redux needs validated adapter/reference support before Auto is enabled.',
  },
} satisfies Record<StudioModelType, StudioAutoModelRequirementMetadata>;

export function getStudioModelDisplayName(profile: StudioModelProfile) {
  return profile.displayName || profile.defaultRepo.split('/').pop() || profile.label;
}

export function getPrimaryModeForProfile(profile: StudioModelProfile): StudioMode {
  return profile.modes[0] ?? 'text_to_image';
}

export function getStudioModelRuntimeLabel(
  profile: StudioModelProfile,
  form?: Pick<StudioFormState, 'dtype' | 'autoOffload' | 'quantizationMode' | 'offloadMode'>,
) {
  const dtype = form?.dtype ?? profile.defaultDtype;
  const quantization = form?.quantizationMode && form.quantizationMode !== 'none' ? ` · ${form.quantizationMode}` : '';
  const offloadMode = normalizeStudioOffloadMode(form?.offloadMode ?? DEFAULT_STUDIO_FORM.offloadMode);
  const offload = form?.autoOffload ? STUDIO_OFFLOAD_RUNTIME_LABELS[offloadMode] : 'no offload';
  return `${profile.defaultRepo} · ${dtype}${quantization} · ${offload}`;
}

export function getStudioModelArtifactNote(profile: StudioModelProfile) {
  const artifact = profile.artifactLabel ?? 'model artifact';
  if (!profile.alternateArtifact) return artifact;
  return `${artifact}; Alternate low-memory artifact may use ${profile.alternateArtifact}`;
}

export const DEFAULT_STUDIO_FORM: StudioFormState = {
  mode: 'text_to_image',
  modelType: 'ZImageModularPipeline',
  prompt: '',
  negativePrompt: '',
  aspectRatio: '1:1',
  width: 1024,
  height: 1024,
  seed: 42,
  randomSeed: true,
  steps: 8,
  guidanceScale: 1,
  resourceMode: 'auto',
  dtype: 'bfloat16',
  quantizationMode: 'none',
  device: 'cuda:0',
  autoOffload: true,
  offloadMode: 'model_cpu',
  trustRemoteCode: false,
  strength: 0.8,
  layers: 4,
  outpaintLeft: 256,
  outpaintRight: 256,
  outpaintTop: 0,
  outpaintBottom: 0,
  outpaintOverlap: 24,
  outpaintFeather: 8,
  outpaintFillColor: 'black',
  alphaMode: 'ignore',
  referenceImages: [],
  maskImage: '',
  controlImage: '',
  sourceVideo: '',
  maskVideo: '',
  controlVideo: '',
  sourceAudio: '',
  referenceAudio: '',
  lyrics: '',
  audioDuration: 30,
  extensionDuration: 15,
  vocalLanguage: 'en',
  repaintingStart: 0,
  repaintingEnd: 10,
  audioCoverStrength: 0.5,
  shift: 3,
  bpm: 0,
  keyscale: 'C',
  timesignature: '4/4',
  numFrames: 81,
  fps: 16,
  conditioningScale: 1,
  guidanceScale2: 0,
  outputType: 'pil',
  maxSequenceLength: 512,
  attentionKwargsJson: '',
};

export function getCompatibleModelsForMode(
  mode: StudioMode,
  options: { currentModelType?: StudioModelType | null; includeWorkflowOnly?: boolean } = {},
): StudioModelType[] {
  if (mode === 'advanced_workflow') return [];
  return Object.values(STUDIO_MODEL_PROFILES)
    .filter((profile) => profile.modes.includes(mode) && isStudioModelVisibleInCatalog(profile.modelType, options))
    .map((profile) => profile.modelType);
}

export function isModelCompatibleWithMode(modelType: StudioModelType, mode: StudioMode) {
  return STUDIO_MODEL_PROFILES[modelType]?.modes.includes(mode) ?? false;
}

export function getDefaultModelForMode(mode: StudioMode): StudioModelType {
  if (VIDEO_STUDIO_MODES.includes(mode)) {
    return 'WanVACEPipeline';
  }

  if (AUDIO_STUDIO_MODES.includes(mode)) {
    return 'AceStepAudioPipeline';
  }

  if (mode === 'edit_image' || mode === 'inpaint' || mode === 'outpaint') {
    return 'QwenImageEditModularPipeline';
  }

  if (mode === 'multi_image_reference_edit') {
    return 'QwenImageEditPlusModularPipeline';
  }

  if (mode === 'control_image') {
    return 'QwenImageModularPipeline';
  }

  if (mode === 'layer_decomposition') {
    return 'QwenImageLayeredModularPipeline';
  }

  return 'ZImageModularPipeline';
}

export function getDefaultModeForModel(modelType: StudioModelType): StudioMode {
  return STUDIO_MODEL_PROFILES[modelType]?.modes[0] ?? 'text_to_image';
}

export function getFormDefaultsForMode(mode: StudioMode, preferredModel?: StudioModelType): StudioFormState {
  const modelType =
    preferredModel && isModelCompatibleWithMode(preferredModel, mode) ? preferredModel : getDefaultModelForMode(mode);
  const profile = STUDIO_MODEL_PROFILES[modelType];
  const size = mode === 'outpaint' ? { aspectRatio: '16:9' as const, width: 1344, height: 768 } : profile.defaultSize;

  return {
    ...DEFAULT_STUDIO_FORM,
    mode,
    modelType,
    aspectRatio: size.aspectRatio,
    width: size.width,
    height: size.height,
    dtype: profile.defaultDtype,
    steps: mode === 'outpaint' ? 32 : profile.recommendedSteps,
    guidanceScale: profile.recommendedGuidance,
    resourceMode: DEFAULT_STUDIO_FORM.resourceMode,
    strength: mode === 'outpaint' ? 0.85 : DEFAULT_STUDIO_FORM.strength,
    numFrames: profile.recommendedFrames ?? DEFAULT_STUDIO_FORM.numFrames,
    fps: profile.recommendedFps ?? DEFAULT_STUDIO_FORM.fps,
    conditioningScale: profile.conditioningScale ?? DEFAULT_STUDIO_FORM.conditioningScale,
    audioDuration: profile.recommendedDuration ?? DEFAULT_STUDIO_FORM.audioDuration,
    autoOffload: profile.lowVram.autoOffload,
    offloadMode: profile.offloadSupport.default,
  };
}

export function getFormDefaultsForModel(modelType: StudioModelType): StudioFormState {
  return getFormDefaultsForMode(getDefaultModeForModel(modelType), modelType);
}

export function getProfileForForm(form: StudioFormState): StudioModelProfile {
  return STUDIO_MODEL_PROFILES[form.modelType];
}

export function getModelRequirementsForMode(profile: StudioModelProfile, mode: StudioMode) {
  const modeRequirements = profile.modeRequirements?.[mode]?.modelRequirements ?? [];
  if (modeRequirements.length > 0) return modeRequirements;
  return (profile.additionalRequirements ?? []).filter(
    (requirement) => !requirement.requiredForModes || requirement.requiredForModes.includes(mode),
  );
}
