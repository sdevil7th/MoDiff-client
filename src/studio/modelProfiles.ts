import type {
  StudioFormState,
  StudioInpaintContractStatus,
  StudioMode,
  StudioModelProfile,
  StudioModelRequirement,
  StudioModelType,
} from './types';

export const QWEN_CONTROLNET_REPO = 'InstantX/Qwen-Image-ControlNet-Union';
export const QWEN_CONTROLNET_REVISION = 'b13036f066d6dee7c20513e263d3d673055e9de8';
export const QWEN_IMAGE_2512_REPO = 'Qwen/Qwen-Image-2512';
export const QWEN_IMAGE_2512_PREQUANTIZED_REPO = 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit';
export const QWEN_IMAGE_EDIT_PREQUANTIZED_REPO = 'ovedrive/qwen-image-edit-4bit';
export const QWEN_LOW_VRAM_QUANTIZATION_MODE = 'bnb_4bit';
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
export const QWEN_T2I_PIPELINE_NODE_KEY = 'modules.DiffusersImage.LoadPipeline';
export const QWEN_T2I_GENERATE_NODE_KEY = 'modules.DiffusersImage.Generate';
export const QWEN_INPAINT_PIPELINE_NODE_KEY = 'modules.DiffusersImage.LoadPipeline';
export const QWEN_OUTPAINT_CANVAS_NODE_KEY = 'modules.DiffusersImage.OutpaintCanvas';
export const QWEN_INPAINT_GENERATE_NODE_KEY = 'modules.DiffusersImage.Inpaint';
export const ACE_STEP_REPO = 'ACE-Step/acestep-v15-xl-turbo-diffusers';
export const FLUX_SCHNELL_REPO = 'black-forest-labs/FLUX.1-schnell';
export const FLUX_DEV_REPO = 'black-forest-labs/FLUX.1-dev';
export const FLUX_DEV_REVISION = '3de623fc3c33e44ffbe2bad470d0f45bccf2eb21';
export const FLUX_KREA_REPO = 'black-forest-labs/FLUX.1-Krea-dev';
export const FLUX_KONTEXT_REPO = 'black-forest-labs/FLUX.1-Kontext-dev';
export const FLUX_FILL_REPO = 'black-forest-labs/FLUX.1-Fill-dev';
export const FLUX_DEPTH_REPO = 'black-forest-labs/FLUX.1-Depth-dev';
export const FLUX_CANNY_REPO = 'black-forest-labs/FLUX.1-Canny-dev';
export const FLUX_REDUX_REPO = 'black-forest-labs/FLUX.1-Redux-dev';
export const FLUX2_KLEIN_REPO = 'black-forest-labs/FLUX.2-klein-4B';
export const FLUX_DEV_FP8_REPO = 'black-forest-labs/FLUX.1-dev-FP8';
export const FLUX_KONTEXT_NVFP4_REPO = 'black-forest-labs/FLUX.1-Kontext-dev-NVFP4';
export const SDXL_BASE_REPO = 'stabilityai/stable-diffusion-xl-base-1.0';

export const QWEN_CONTROLNET_REQUIREMENT: StudioModelRequirement = {
  id: 'qwen-controlnet-union',
  label: 'Qwen ControlNet Union',
  repo: QWEN_CONTROLNET_REPO,
  revision: QWEN_CONTROLNET_REVISION,
  kind: 'controlnet',
  description: 'Qwen ControlNet model.',
};

export const QWEN_IMAGE_EDIT_INPAINT_CONTRACT: StudioInpaintContractStatus = {
  available: true,
  status: 'supported',
  reason:
    'Qwen Image Edit inpaint uses the generic Diffusers image loader and inpaint nodes with source image and mask_image inputs. Outpaint uses the model-neutral Outpaint Canvas node before the same inpaint node.',
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

const STUDIO_MODEL_LABEL_VALUES = [
  'Z-Image Turbo',
  'Qwen-Image-2512',
  'Qwen-Image-Edit',
  'Qwen-Image-Edit-2511',
  'Qwen-Image-Layered',
  'Wan VACE 1.3B',
  'Wan 2.1 T2V 1.3B',
  'Wan 2.2 I2V A14B',
  'Wan 2.2 TI2V 5B',
  'LTX-Video',
  'ACE-Step Audio',
  'FLUX.1-schnell',
  'FLUX.1-dev',
  'FLUX.1-Krea-dev',
  'FLUX.1-Kontext-dev',
  'FLUX.1-Fill-dev',
  'FLUX.1-Depth-dev',
  'FLUX.1-Canny-dev',
  'FLUX.1-Redux-dev',
  'FLUX.2-klein-4B',
  'Stable Diffusion XL 1.0',
] as const;

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

export const STUDIO_MODE_LABELS = Object.fromEntries(
  Object.keys(STUDIO_MODE_DESCRIPTIONS).map((mode) => [
    mode,
    mode === 'multi_image_reference_edit'
      ? 'Multi-image reference edit'
      : mode.charAt(0).toUpperCase() + mode.slice(1).replace(/_/g, ' '),
  ]),
) as Record<StudioMode, string>;

export const WAN_VACE_REPO = 'Wan-AI/Wan2.1-VACE-1.3B-diffusers';
export const WAN_VACE_REVISION = 'ec4d2cb062b548996b179d493fdd05340de702a1';
export const WAN_T2V_1_3B_REPO = 'Wan-AI/Wan2.1-T2V-1.3B-Diffusers';
export const WAN_22_I2V_A14B_REPO = 'Wan-AI/Wan2.2-I2V-A14B-Diffusers';
export const WAN_22_TI2V_5B_REPO = 'Wan-AI/Wan2.2-TI2V-5B-Diffusers';
export const LTX_VIDEO_REPO = 'Lightricks/LTX-Video-0.9.8-13B-distilled';

export const LTX_VIDEO_MODES: StudioMode[] = [
  'text_to_video',
  'image_to_video',
  'video_to_video',
  'reference_to_video',
];

export const WAN_VACE_MODES: StudioMode[] = ['text_to_video', 'video_inpaint', 'video_outpaint', 'control_to_video'];

export const WAN_VIDEO_MODES: StudioMode[] = ['text_to_video', 'video_to_video', 'video_color_edit'];

export const WAN_22_I2V_MODES: StudioMode[] = ['image_to_video'];
export const WAN_22_TI2V_MODES: StudioMode[] = ['text_to_video'];

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

export const FLUX_STUDIO_MODEL_TYPES: StudioModelType[] = ['FluxSchnellPipeline', 'FluxDevPipeline'];

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

type StudioModelProfileSource = Omit<
  StudioModelProfile,
  | 'modelType'
  | 'label'
  | 'displayName'
  | 'artifactLabel'
  | 'defaultDtype'
  | 'guidanceLabel'
  | 'runtimeKind'
  | 'isDiffusersBacked'
  | 'supportsImageInput'
  | 'supportsMask'
  | 'supportsMultiImage'
  | 'supportsControlImage'
  | 'supportsLayers'
  | 'supportsLora'
  | 'defaultSize'
  | 'offloadSupport'
> &
  Partial<
    Pick<StudioModelProfile, 'displayName' | 'artifactLabel' | 'guidanceLabel' | 'defaultSize' | 'offloadSupport'>
  > & {
    supportFlags: number;
  };

const STUDIO_MODEL_PROFILE_SOURCES = {
  ZImageModularPipeline: {
    family: 'Z-Image',
    surfaceCategory: 'Image',
    defaultRepo: 'Tongyi-MAI/Z-Image-Turbo',
    defaultSize: { width: 640, height: 640, aspectRatio: '1:1' },
    recommendedSteps: 8,
    recommendedGuidance: 1,
    supportsNegativePrompt: false,
    supportFlags: 34,
    offloadSupport: MODULAR_OFFLOAD_SUPPORT,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: MODULAR_OFFLOAD_SUPPORT.lowVram, steps: 8 },
    modes: ['text_to_image'],
  },
  QwenImageModularPipeline: {
    family: 'Qwen Image',
    surfaceCategory: 'Image',
    defaultRepo: QWEN_IMAGE_2512_REPO,
    artifactLabel: 'bfloat16 Diffusers repo',
    defaultSize: { width: 1328, height: 1328, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 4,
    supportFlags: 40,
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
    modeRequirements: {
      control_image: {
        modelRequirements: [QWEN_CONTROLNET_REQUIREMENT],
        requiredImages: ['controlImage'],
        note: 'Requires Qwen ControlNet Union and a control image.',
      },
    },
  },
  QwenImageEditModularPipeline: {
    family: 'Qwen Image',
    surfaceCategory: 'Image Edit',
    defaultRepo: 'Qwen/Qwen-Image-Edit',
    artifactLabel: 'Diffusers image-edit repo',
    alternateArtifact: QWEN_IMAGE_EDIT_PREQUANTIZED_REPO,
    recommendedSteps: 40,
    recommendedGuidance: 4,
    supportFlags: 35,
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
    family: 'Qwen Image',
    surfaceCategory: 'Image Edit',
    defaultRepo: 'Qwen/Qwen-Image-Edit-2511',
    artifactLabel: 'bfloat16 Diffusers repo',
    recommendedSteps: 40,
    recommendedGuidance: 4,
    supportFlags: 37,
    inpaintContract: QWEN_IMAGE_EDIT_PLUS_INPAINT_CONTRACT,
    offloadSupport: QWEN_MODULAR_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: QWEN_LOW_VRAM_QUANTIZATION_MODE,
      autoOffload: true,
      offloadMode: QWEN_LOW_VRAM_OFFLOAD_MODE,
      steps: 24,
    },
    modes: ['edit_image', 'multi_image_reference_edit'],
    modeRequirements: {
      inpaint: {
        requiredImages: ['referenceImages', 'maskImage'],
        note: QWEN_IMAGE_EDIT_PLUS_INPAINT_CONTRACT.reason,
      },
    },
  },
  QwenImageLayeredModularPipeline: {
    family: 'Qwen Image',
    surfaceCategory: 'Utility',
    defaultRepo: 'Qwen/Qwen-Image-Layered',
    artifactLabel: 'bfloat16 Diffusers repo',
    defaultSize: { width: 640, height: 640, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 4,
    supportFlags: 49,
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
    displayName: 'Wan2.1-VACE-1.3B-diffusers',
    family: 'Wan Video',
    surfaceCategory: 'Video',
    defaultRepo: WAN_VACE_REPO,
    defaultSize: { width: 832, height: 480, aspectRatio: '16:9' },
    recommendedSteps: 50,
    recommendedGuidance: 5,
    supportFlags: 42,
    supportsVideoInput: true,
    supportsVideoMask: true,
    outputKind: 'video',
    recommendedFrames: 81,
    recommendedFps: 15,
    conditioningScale: 1,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 24,
      width: 832,
      height: 480,
      numFrames: 49,
    },
    modes: WAN_VACE_MODES,
    modeRequirements: {
      video_inpaint: {
        requiredVideos: ['sourceVideo', 'maskVideo'],
        note: 'Requires source and mask videos with matching frame counts.',
      },
      video_outpaint: {
        requiredVideos: ['sourceVideo', 'maskVideo'],
        note: 'Requires source video plus a boundary/generation mask video.',
      },
      control_to_video: {
        requiredVideos: ['controlVideo'],
        note: 'Requires a prepared control video.',
      },
    },
  },
  WanVideoPipeline: {
    displayName: 'Wan2.1-T2V-1.3B-Diffusers',
    family: 'Wan Video',
    surfaceCategory: 'Video',
    defaultRepo: WAN_T2V_1_3B_REPO,
    defaultSize: { width: 832, height: 480, aspectRatio: '16:9' },
    recommendedSteps: 50,
    recommendedGuidance: 6,
    supportFlags: 32,
    supportsVideoInput: true,
    supportsVideoMask: false,
    outputKind: 'video',
    recommendedFrames: 81,
    recommendedFps: 16,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 24,
      width: 832,
      height: 480,
      numFrames: 49,
    },
    modes: WAN_VIDEO_MODES,
    modeRequirements: {
      video_to_video: { requiredVideos: ['sourceVideo'], note: 'Requires one source video.' },
      video_color_edit: { requiredVideos: ['sourceVideo'], note: 'Requires one source video.' },
    },
  },
  WanImageToVideoPipeline: {
    displayName: 'Wan2.2-I2V-A14B-Diffusers',
    family: 'Wan Video',
    surfaceCategory: 'Video',
    catalogVisibility: 'default',
    defaultRepo: WAN_22_I2V_A14B_REPO,
    defaultSize: { width: 832, height: 480, aspectRatio: '16:9' },
    recommendedSteps: 40,
    recommendedGuidance: 3.5,
    guidanceLabel: 'High-noise guidance',
    supportFlags: 5,
    supportsVideoInput: false,
    supportsVideoMask: false,
    outputKind: 'video',
    recommendedFrames: 81,
    recommendedFps: 16,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 40,
      width: 832,
      height: 480,
      numFrames: 81,
    },
    modes: WAN_22_I2V_MODES,
    modeRequirements: {
      image_to_video: {
        requiredImages: ['referenceImages'],
        note: 'Upload one opening keyframe per planned shot, in story order.',
      },
    },
  },
  WanTI2VPipeline: {
    displayName: 'Wan2.2-TI2V-5B-Diffusers',
    family: 'Wan Video',
    surfaceCategory: 'Video',
    catalogVisibility: 'default',
    defaultRepo: WAN_22_TI2V_5B_REPO,
    defaultSize: { width: 1280, height: 704, aspectRatio: '16:9' },
    recommendedSteps: 50,
    recommendedGuidance: 5,
    supportFlags: 32,
    supportsVideoInput: false,
    supportsVideoMask: false,
    outputKind: 'video',
    recommendedFrames: 121,
    recommendedFps: 24,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 50,
      width: 1280,
      height: 704,
      numFrames: 121,
    },
    modes: WAN_22_TI2V_MODES,
    modeRequirements: {},
  },
  LTXVideoPipeline: {
    displayName: 'LTX-Video Diffusers',
    family: 'LTX Video',
    surfaceCategory: 'Video',
    catalogVisibility: 'default',
    defaultRepo: LTX_VIDEO_REPO,
    defaultSize: { width: 704, height: 480, aspectRatio: 'custom' },
    recommendedSteps: 8,
    recommendedGuidance: 1,
    supportFlags: 37,
    supportsVideoInput: true,
    supportsVideoMask: false,
    outputKind: 'video',
    recommendedFrames: 97,
    recommendedFps: 25,
    conditioningScale: 1,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 8,
      width: 704,
      height: 480,
      numFrames: 65,
    },
    modes: LTX_VIDEO_MODES,
    modeRequirements: {
      image_to_video: {
        requiredImages: ['referenceImages'],
        note: 'Requires one starting image.',
      },
      video_to_video: {
        requiredVideos: ['sourceVideo'],
        note: 'Requires one source video.',
      },
      reference_to_video: {
        requiredImages: ['referenceImages'],
        note: 'Requires one or more frame references.',
      },
    },
  },
  AceStepAudioPipeline: {
    displayName: 'acestep-v15-xl-turbo-diffusers',
    family: 'ACE Audio',
    surfaceCategory: 'Audio',
    defaultRepo: ACE_STEP_REPO,
    artifactLabel: 'Diffusers audio repo',
    recommendedSteps: 8,
    recommendedGuidance: 1,
    guidanceLabel: 'Guidance (distilled; fixed at 1)',
    supportFlags: 0,
    supportsAudioInput: true,
    outputKind: 'audio',
    recommendedDuration: 30,
    recommendedSampleRate: 48000,
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
    family: 'FLUX Image',
    surfaceCategory: 'Image',
    catalogVisibility: 'default',
    defaultRepo: FLUX_SCHNELL_REPO,
    recommendedSteps: 4,
    recommendedGuidance: 0,
    supportFlags: 32,
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
    family: 'FLUX Image',
    surfaceCategory: 'Image',
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_DEV_REPO,
    alternateArtifact: FLUX_DEV_FP8_REPO,
    recommendedSteps: 28,
    recommendedGuidance: 3.5,
    supportFlags: 33,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: 'quanto_float8',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency,
      steps: 24,
      width: 1024,
      height: 1024,
    },
    modes: ['text_to_image', 'edit_image'],
    modeRequirements: {
      edit_image: {
        requiredImages: ['referenceImages'],
        note: 'Requires one source image.',
      },
    },
  },
  FluxKreaPipeline: {
    family: 'FLUX Image',
    surfaceCategory: 'Image',
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_KREA_REPO,
    recommendedSteps: 28,
    recommendedGuidance: 3.5,
    supportFlags: 32,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency, steps: 24 },
    modes: ['text_to_image'],
  },
  FluxKontextPipeline: {
    family: 'FLUX Image',
    surfaceCategory: 'Image Edit',
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_KONTEXT_REPO,
    alternateArtifact: FLUX_KONTEXT_NVFP4_REPO,
    recommendedSteps: 28,
    recommendedGuidance: 3.5,
    supportFlags: 37,
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
    },
  },
  FluxFillPipeline: {
    family: 'FLUX Image',
    surfaceCategory: 'Image Edit',
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_FILL_REPO,
    recommendedSteps: 50,
    recommendedGuidance: 30,
    supportFlags: 35,
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
    family: 'FLUX Image',
    surfaceCategory: 'Control',
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_DEPTH_REPO,
    recommendedSteps: 50,
    recommendedGuidance: 30,
    supportFlags: 41,
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
    family: 'FLUX Image',
    surfaceCategory: 'Control',
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_CANNY_REPO,
    recommendedSteps: 50,
    recommendedGuidance: 30,
    supportFlags: 41,
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
    family: 'FLUX Image',
    surfaceCategory: 'Image Edit',
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_REDUX_REPO,
    recommendedSteps: 50,
    recommendedGuidance: 2.5,
    supportFlags: 37,
    additionalRequirements: [
      {
        id: 'flux-redux-base',
        label: 'FLUX.1-dev base pipeline',
        repo: FLUX_DEV_REPO,
        revision: FLUX_DEV_REVISION,
        kind: 'base',
        description: 'Redux supplies reference embeddings to the app-installed FLUX.1-dev base pipeline.',
      },
    ],
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency, steps: 24 },
    modes: ['edit_image', 'multi_image_reference_edit'],
    modeRequirements: {
      edit_image: {
        requiredImages: ['referenceImages'],
        note: 'Requires one source/reference image.',
      },
      multi_image_reference_edit: {
        requiredImages: ['referenceImages'],
        note: 'Uses Diffusers Redux weighted multi-reference conditioning; compatible visual references work best.',
      },
    },
  },
  Flux2KleinPipeline: {
    family: 'FLUX Image',
    surfaceCategory: 'Image Edit',
    catalogVisibility: 'default',
    defaultRepo: FLUX2_KLEIN_REPO,
    recommendedSteps: 4,
    recommendedGuidance: 1,
    supportFlags: 37,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 4,
      width: 768,
      height: 768,
    },
    modes: ['text_to_image', 'edit_image', 'multi_image_reference_edit'],
    modeRequirements: {
      edit_image: {
        requiredImages: ['referenceImages'],
        note: 'Requires one source/reference image.',
      },
      multi_image_reference_edit: {
        requiredImages: ['referenceImages'],
        note: 'Requires two or more reference images.',
      },
    },
  },
  StableDiffusionXLPipeline: {
    family: 'Stable Diffusion XL',
    surfaceCategory: 'Image',
    catalogVisibility: 'workflowOnly',
    defaultRepo: SDXL_BASE_REPO,
    recommendedSteps: 30,
    recommendedGuidance: 5,
    supportFlags: 35,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 24,
      width: 768,
      height: 768,
    },
    modes: ['text_to_image', 'edit_image', 'inpaint'],
    modeRequirements: {
      edit_image: {
        requiredImages: ['referenceImages'],
        note: 'Requires one source image.',
      },
      inpaint: {
        requiredImages: ['referenceImages', 'maskImage'],
        note: 'Requires one source image and one mask image.',
      },
    },
  },
} satisfies Record<StudioModelType, StudioModelProfileSource>;

export const STUDIO_MODEL_PROFILES = Object.fromEntries(
  Object.entries(STUDIO_MODEL_PROFILE_SOURCES).map(([modelType, source], index) => {
    const { supportFlags, ...profile } = source;
    const label = STUDIO_MODEL_LABEL_VALUES[index]!;
    return [
      modelType,
      {
        modelType,
        label,
        displayName: label,
        artifactLabel: 'Diffusers repo',
        defaultDtype: 'bfloat16',
        guidanceLabel: 'Guidance',
        defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
        offloadSupport: DIRECT_OFFLOAD_SUPPORT,
        runtimeKind: 'diffusers',
        isDiffusersBacked: true,
        supportsImageInput: Boolean(supportFlags & 1),
        supportsMask: Boolean(supportFlags & 2),
        supportsMultiImage: Boolean(supportFlags & 4),
        supportsControlImage: Boolean(supportFlags & 8),
        supportsLayers: Boolean(supportFlags & 16),
        supportsLora: Boolean(supportFlags & 32),
        ...profile,
      },
    ];
  }),
) as Record<StudioModelType, StudioModelProfile>;

export const STUDIO_MODEL_LABELS = Object.fromEntries(
  Object.entries(STUDIO_MODEL_PROFILES).map(([modelType, profile]) => [modelType, profile.label]),
) as Record<StudioModelType, string>;

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
    minimum:
      'A 16 GB-class CUDA candidate requires a complete compatible prequantized artifact and a successful live Auto proof for that machine.',
    recommended:
      'Use the physically qualified native BF16 recipe on a 64 GB-class high-memory host. Do not treat the lower-memory candidate as qualified without a matching hardware receipt.',
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
    minimum:
      'A 16 GB-class CUDA candidate requires the complete compatible 4-bit edit artifact and a successful live Auto proof for that machine.',
    recommended:
      'Use the physically qualified official BF16 recipe on a 64 GB-class high-memory host. Use constrained prequantized/offloaded candidates only after matching real-hardware qualification.',
    qualityDefaults: '1024x1024, 40 steps, true CFG 4.',
    artifacts: ['Qwen/Qwen-Image-Edit', QWEN_IMAGE_EDIT_PREQUANTIZED_REPO],
    notes: 'Auto prefers the Apache-2.0 prequantized Diffusers edit artifact on constrained CUDA hardware.',
  },
  QwenImageEditPlusModularPipeline: {
    modelType: 'QwenImageEditPlusModularPipeline',
    supportedModes: ['edit_image', 'multi_image_reference_edit'],
    autoStatus: 'auto_ready',
    minimum:
      'ROCm or CUDA accelerator with enough usable accelerator/unified memory for the selected validated recipe; the qualified native BF16 path requires 64 GB-class memory.',
    recommended:
      'Use the qualified native BF16 recipe on a 64 GB-class high-memory host. Use lower-memory quantized/offloaded candidates only when live Auto planning validates them for that machine.',
    qualityDefaults: 'Model card defaults: 40 steps, true CFG 4, guidance 1 where applicable.',
    artifacts: ['Qwen/Qwen-Image-Edit-2511'],
    notes:
      'The high-memory ROCm modular Auto path is physically qualified. Other platform and constrained-memory recipes remain unqualified until backed by matching real-hardware receipts.',
  },
  QwenImageLayeredModularPipeline: {
    modelType: 'QwenImageLayeredModularPipeline',
    supportedModes: ['layer_decomposition'],
    autoStatus: 'auto_ready',
    minimum:
      'The physically qualified native BF16 path requires a 64 GB-class high-memory ROCm host. Other platforms require their own validated recipe and matching hardware receipt.',
    recommended:
      'Use the qualified 640px, three-layer native BF16 recipe on a 64 GB-class high-memory host. Use constrained quantized/offloaded candidates only after matching real-hardware qualification.',
    qualityDefaults: 'Qualified template: 640px source, 3 layers, 30 steps, true CFG 4.',
    artifacts: ['Qwen/Qwen-Image-Layered'],
    notes:
      'The high-memory ROCm modular Auto path and three-output layered contract are physically qualified. Other platform and constrained-memory recipes remain unqualified until backed by matching real-hardware receipts.',
  },
  WanVACEPipeline: {
    modelType: 'WanVACEPipeline',
    supportedModes: WAN_VACE_MODES,
    autoStatus: 'auto_ready',
    minimum: 'CUDA accelerator with enough memory for 1.3B Wan VACE plus CPU/system-memory offload.',
    recommended: '12 GB or more VRAM, 32 GB system RAM, 20 GB or more free disk for emergency offload.',
    qualityDefaults: '832x480, 49 frames, 24 steps for constrained hardware; 81 frames/30 steps when resources fit.',
    artifacts: [WAN_VACE_REPO],
    notes: 'Video recipes are slower and use visible retry/fallback only after the user starts Run.',
  },
  WanVideoPipeline: {
    modelType: 'WanVideoPipeline',
    supportedModes: WAN_VIDEO_MODES,
    autoStatus: 'auto_ready',
    minimum: 'CUDA or ROCm accelerator with enough memory for Wan 2.1 T2V 1.3B plus CPU/system-memory offload.',
    recommended: '12 GB or more VRAM, 32 GB system RAM, and 30 GB free disk.',
    qualityDefaults: '832x480, 81 frames at 15 fps, 50 steps, guidance 5, and native flash attention.',
    artifacts: [WAN_T2V_1_3B_REPO],
    notes:
      'WanPipeline text-to-video is mechanically qualified on Radeon 8060S at about 49 minutes for a 5.4-second shot; human visual review remains pending.',
  },
  WanImageToVideoPipeline: {
    modelType: 'WanImageToVideoPipeline',
    supportedModes: WAN_22_I2V_MODES,
    autoStatus: 'auto_ready',
    minimum:
      'ROCm or CUDA accelerator with model offload, about 64 GB of usable accelerator/system memory, and INT8 dual-transformer quantization.',
    recommended: '80 GB or more unified/accelerator memory and 140 GB free disk for the full local artifact.',
    qualityDefaults: '832x480, 81 frames at 16 fps, 40 steps, guidance 3.5 for both denoising experts.',
    artifacts: [WAN_22_I2V_A14B_REPO],
    notes:
      'The quality workflow quantizes both denoising experts to Quanto INT8 weight-only and retains each five-second segment before FFmpeg composition.',
  },
  WanTI2VPipeline: {
    modelType: 'WanTI2VPipeline',
    supportedModes: WAN_22_TI2V_MODES,
    autoStatus: 'auto_ready',
    minimum: 'CUDA or ROCm accelerator with 24 GB usable accelerator memory and model offload.',
    recommended: '40 GB or more accelerator/unified memory and 45 GB free disk for resident BF16 execution.',
    qualityDefaults:
      'Official Diffusers model-card recipe: 1280x704, 121 frames at 24 fps, 50 UniPC steps, guidance 5, flow shift 8.',
    artifacts: [WAN_22_TI2V_5B_REPO],
    notes:
      'Uses the official dense Wan 2.2 5B high-compression model and exposes a locked per-run scheduler flow shift while preserving the quality-first Diffusers step count.',
  },
  LTXVideoPipeline: {
    modelType: 'LTXVideoPipeline',
    supportedModes: LTX_VIDEO_MODES,
    autoStatus: 'auto_ready',
    minimum: 'CUDA or ROCm accelerator with 12 GB or more VRAM, 32 GB system RAM, and model CPU offload.',
    recommended: '24 GB or more VRAM, bfloat16, 704x480, and 97 frames for the first qualified workflow.',
    qualityDefaults: '704x480, 97 frames at 25 fps, 40 steps, guidance 3.',
    artifacts: [LTX_VIDEO_REPO],
    notes:
      'Uses generic Diffusers video nodes. Mask and control modes remain excluded until their adapter contracts are qualified.',
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
    qualityDefaults: '1024x1024, 50 steps, guidance 2.5 for the official Redux quality recipe.',
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
    supportedModes: ['edit_image'],
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
    minimum: 'Expert only; Redux requires its pinned FLUX Dev base and substantial memory.',
    recommended: '24 GB or more VRAM or a proven quantized artifact.',
    qualityDefaults: '1024x1024, 24-28 steps, guidance 3.5.',
    artifacts: [FLUX_REDUX_REPO],
    notes:
      'Single-reference variation is qualified. A bounded, compatible multi-reference visual-blend proof awaits maintainer approval; Redux does not promise role-separated geometry or material preservation.',
    manualOnlyReason:
      'FLUX Redux remains Expert-only because it loads the Redux prior with a pinned FLUX Dev base; the staged multi-reference visual-blend contract remains hidden until its generated asset is approved.',
  },
  Flux2KleinPipeline: {
    modelType: 'Flux2KleinPipeline',
    supportedModes: ['text_to_image', 'edit_image', 'multi_image_reference_edit'],
    autoStatus: 'auto_ready',
    minimum: '13 GB VRAM or model CPU offload.',
    recommended: '20 GB VRAM and 32 GB system RAM.',
    qualityDefaults: '1024x1024, 4 steps, guidance 1.',
    artifacts: [FLUX2_KLEIN_REPO],
    notes: 'Qualified through the generic Diffusers image façade with zero, one, and two reference images.',
  },
  StableDiffusionXLPipeline: {
    modelType: 'StableDiffusionXLPipeline',
    supportedModes: ['text_to_image', 'edit_image', 'inpaint'],
    autoStatus: 'manual_only',
    minimum: 'Expert-only pending a measured runtime envelope for SDXL base.',
    recommended: 'Use a CUDA or MPS accelerator with model CPU offload when full residency is unavailable.',
    qualityDefaults: '1024x1024, 30 steps, guidance 5.',
    artifacts: [SDXL_BASE_REPO],
    notes: 'Pinned graphs ready; output qualification pending.',
    manualOnlyReason: 'Live resource and Gallery qualification pending.',
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
  return profile.additionalRequirements ?? [];
}

export function modelDependencyReceiptForMode(profile: StudioModelProfile, mode: StudioMode) {
  return getModelRequirementsForMode(profile, mode).map(({ id, kind, repo, revision }) => ({
    id,
    kind,
    repo,
    revision: revision!,
  }));
}
