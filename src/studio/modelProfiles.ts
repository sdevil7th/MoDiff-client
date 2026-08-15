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
export const QWEN_IMAGE_2512_REVISION = '25468b98e3276ca6700de15c6628e51b7de54a26';
export const QWEN_IMAGE_LAYERED_REPO = 'Qwen/Qwen-Image-Layered';
export const QWEN_IMAGE_LAYERED_REVISION = '8f0ca708dfff6ba1dd5f2d85d78f8c108a040bcf';
export const QWEN_IMAGE_EDIT_REVISION = 'ac7f9318f633fc4b5778c59367c8128225f1e3de';
export const QWEN_IMAGE_EDIT_PLUS_REVISION = '6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9';
export const Z_IMAGE_REVISION = 'f332072aa78be7aecdf3ee76d5c247082da564a6';
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
export const SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT = {
  modes: [...STUDIO_OFFLOAD_MODES],
  default: 'model_cpu' as const,
  lowVram: 'sequential_cpu' as const,
  emergency: 'group_disk' as const,
};
export const QWEN_MODULAR_OFFLOAD_SUPPORT = DIRECT_OFFLOAD_SUPPORT;
export const QWEN_DIRECT_OFFLOAD_SUPPORT = DIRECT_OFFLOAD_SUPPORT;
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
export const FLUX_KONTEXT_REVISION = '24e9dedc4ef646698dc8eb4e18ae2cec3c9fea0d';
export const FLUX_FILL_REPO = 'black-forest-labs/FLUX.1-Fill-dev';
export const FLUX_DEPTH_REPO = 'black-forest-labs/FLUX.1-Depth-dev';
export const FLUX_CANNY_REPO = 'black-forest-labs/FLUX.1-Canny-dev';
export const FLUX_REDUX_REPO = 'black-forest-labs/FLUX.1-Redux-dev';
export const FLUX2_KLEIN_REPO = 'black-forest-labs/FLUX.2-klein-4B';
export const FLUX2_KLEIN_REVISION = 'e7b7dc27f91deacad38e78976d1f2b499d76a294';
export const FLUX_DEV_FP8_REPO = 'black-forest-labs/FLUX.1-dev-FP8';
export const FLUX_KONTEXT_NVFP4_REPO = 'black-forest-labs/FLUX.1-Kontext-dev-NVFP4';
export const SDXL_BASE_REPO = 'stabilityai/stable-diffusion-xl-base-1.0';
export const SDXL_TURBO_REPO = 'stabilityai/sdxl-turbo';
export const SDXL_INSTRUCT_PIX2PIX_REPO = 'diffusers/sdxl-instructpix2pix-768';
export const SDXL_CONTROLNET_CANNY_REPO = 'diffusers/controlnet-canny-sdxl-1.0';
export const SDXL_CONTROLNET_CANNY_REVISION = 'eb115a19a10d14909256db740ed109532ab1483c';
export const HUNYUAN_DIT_DISTILLED_REPO = 'Tencent-Hunyuan/HunyuanDiT-v1.2-Diffusers-Distilled';
export const HUNYUAN_DIT_DISTILLED_REVISION = 'ba991d1546d8c50936c4c16398ed0a87b9b99fb1';
export const HUNYUAN_DIT_CONTROLNET_CANNY_REPO = 'Tencent-Hunyuan/HunyuanDiT-v1.2-ControlNet-Diffusers-Canny';
export const HUNYUAN_DIT_CONTROLNET_CANNY_REVISION = 'b2d21391ebcf78939344cfec84891932f9d53aa0';
export const SDXL_T2I_ADAPTER_CANNY_REPO = 'TencentARC/t2i-adapter-canny-sdxl-1.0';
export const SDXL_T2I_ADAPTER_CANNY_REVISION = '2d7244ba45ded9129cfbf8e96a4befb7f6094210';
export const SD15_BASE_REPO = 'stable-diffusion-v1-5/stable-diffusion-v1-5';
export const SD15_BASE_REVISION = '451f4fe16113bff5a5d2269ed5ad43b0592e9a14';
export const SD15_CONTROLNET_CANNY_REPO = 'lllyasviel/control_v11p_sd15_canny';
export const SD15_CONTROLNET_CANNY_REVISION = '115a470d547982438f70198e353a921996e2e819';
export const PIXART_SIGMA_REPO = 'PixArt-alpha/PixArt-Sigma-XL-2-1024-MS';
export const KANDINSKY3_REPO = 'kandinsky-community/kandinsky-3';
export const LONGCAT_IMAGE_REPO = 'meituan-longcat/LongCat-Image';
export const LONGCAT_IMAGE_EDIT_REPO = 'meituan-longcat/LongCat-Image-Edit';
export const LUMINA_REPO = 'Alpha-VLLM/Lumina-Next-SFT-diffusers';
export const LUMINA2_REPO = 'Alpha-VLLM/Lumina-Image-2.0';
export const OMNIGEN_REPO = 'Shitao/OmniGen-v1-diffusers';
export const OVIS_IMAGE_REPO = 'ATH-MaaS/Ovis-Image-7B';
export const PRX_REPO = 'Photoroom/prx-512-t2i-sft';
export const NUCLEUS_IMAGE_REPO = 'NucleusAI/Nucleus-Image';
export const AURAFLOW_V03_REPO = 'fal/AuraFlow-v0.3';
export const CHROMA1_HD_REPO = 'lodestones/Chroma1-HD';
export const CHROMA1_HD_REVISION = '0e0c60ece1e82b17cb7f77342d765ba5024c40c0';
export const COGVIEW3_PLUS_REPO = 'zai-org/CogView3-Plus-3B';
export const COGVIEW4_6B_REPO = 'zai-org/CogView4-6B';
export const ERNIE_IMAGE_TURBO_REPO = 'baidu/ERNIE-Image-Turbo';
export const GLM_IMAGE_REPO = 'zai-org/GLM-Image';
export const JOYIMAGE_EDIT_REPO = 'jdopensource/JoyAI-Image-Edit-Diffusers';
export const JOYIMAGE_EDIT_PLUS_REPO = 'jdopensource/JoyAI-Image-Edit-Plus-Diffusers';
export const SANA_REPO = 'Efficient-Large-Model/Sana_600M_1024px_diffusers';
export const SANA_SPRINT_REPO = 'Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers';
export const DREAMLITE_BASE_REPO = 'carlofkl/DreamLite-base';
export const DREAMLITE_MOBILE_REPO = 'carlofkl/DreamLite-mobile';
export const LCM_DREAMSHAPER_REPO = 'SimianLuo/LCM_Dreamshaper_v7';
export const MARIGOLD_DEPTH_LCM_REPO = 'prs-eth/marigold-depth-lcm-v1-0';
export const SMOLLM2_135M_INSTRUCT_REPO = 'HuggingFaceTB/SmolLM2-135M-Instruct';
export const SMOLVLM_256M_INSTRUCT_REPO = 'HuggingFaceTB/SmolVLM-256M-Instruct';
export const JANUS_PRO_1B_REPO = 'deepseek-community/Janus-Pro-1B';
export const JANUS_PRO_1B_REVISION = '1655280bb75959cc1cb85529a2a8b26e7016072e';
export const WHISPER_TINY_REPO = 'openai/whisper-tiny';
export const DDPM_CIFAR10_REPO = 'google/ddpm-cifar10-32';
export const CONSISTENCY_IMAGENET64_REPO = 'openai/diffusers-cd_imagenet64_l2';
export const BUILTIN_IMAGE_OPERATION_REPO = 'builtin://modiff/image-operations/v1';
export const BUILTIN_IMAGE_OPERATION_MODES: StudioMode[] = [
  'image_adjustment',
  'image_filter',
  'image_crop',
  'image_resize',
  'image_tile',
  'image_channels',
];

export const QWEN_CONTROLNET_REQUIREMENT: StudioModelRequirement = {
  id: 'qwen-controlnet-union',
  label: 'Qwen ControlNet Union',
  repo: QWEN_CONTROLNET_REPO,
  revision: QWEN_CONTROLNET_REVISION,
  kind: 'controlnet',
  description: 'Qwen ControlNet model.',
};

export const SD15_CONTROLNET_CANNY_REQUIREMENT: StudioModelRequirement = {
  id: 'sd15-controlnet-canny',
  label: 'Stable Diffusion 1.5 Canny ControlNet',
  repo: SD15_CONTROLNET_CANNY_REPO,
  revision: SD15_CONTROLNET_CANNY_REVISION,
  kind: 'controlnet',
  requiredForModes: ['control_image', 'control_edit_image', 'control_inpaint'],
  description: 'Pinned safetensors ControlNet component for the generic SD1.5 control workflow.',
};

export const SDXL_CONTROLNET_CANNY_REQUIREMENT: StudioModelRequirement = {
  id: 'sdxl-controlnet-canny',
  label: 'Stable Diffusion XL Canny ControlNet',
  repo: SDXL_CONTROLNET_CANNY_REPO,
  revision: SDXL_CONTROLNET_CANNY_REVISION,
  kind: 'controlnet',
  requiredForModes: ['control_image', 'control_edit_image', 'control_inpaint'],
  description: 'Pinned fp16 safetensors ControlNet component for the generic SDXL control workflow.',
};

export const HUNYUAN_DIT_CONTROLNET_CANNY_REQUIREMENT: StudioModelRequirement = {
  id: 'hunyuan-dit-v1-2-controlnet-canny',
  label: 'Hunyuan-DiT v1.2 Canny ControlNet',
  repo: HUNYUAN_DIT_CONTROLNET_CANNY_REPO,
  revision: HUNYUAN_DIT_CONTROLNET_CANNY_REVISION,
  kind: 'controlnet',
  requiredForModes: ['control_image'],
  description: 'Pinned Canny component.',
};

export const SDXL_T2I_ADAPTER_CANNY_REQUIREMENT: StudioModelRequirement = {
  id: 'sdxl-t2i-adapter-canny',
  label: 'Stable Diffusion XL Canny T2I Adapter',
  repo: SDXL_T2I_ADAPTER_CANNY_REPO,
  revision: SDXL_T2I_ADAPTER_CANNY_REVISION,
  kind: 't2i_adapter',
  requiredForModes: ['control_image'],
  description: 'Pinned fp16 safetensors T2I-Adapter component for the generic SDXL control workflow.',
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
  'Qwen Image ControlNet (Standard Diffusers)',
  'Qwen Image Layered (Standard Diffusers)',
  'Wan VACE 1.3B',
  'Wan 2.1 T2V 1.3B',
  'Wan 2.2 I2V A14B',
  'Wan 2.2 TI2V 5B',
  'Wan 2.2 T2V A14B',
  'Wan 2.2 Animate',
  'Wan First/Last Frame',
  'LTX Long I2V',
  'LTX-2 Video + Audio',
  'Hunyuan FramePack',
  'Stable Video Diffusion XT 1.1',
  'AnimateDiff SD1.5 v2',
  'AnimateDiff SD1.5 v2 + PAG',
  'AnimateDiff SD1.5 v2 Video-to-Video',
  'AnimateDiff SD1.5 v2 + ControlNet',
  'AnimateDiff SD1.5 v2 Video-to-Video + ControlNet',
  'AnimateLCM SD1.5',
  'CogVideoX-2B',
  'CogVideoX-2B Video-to-Video',
  'Allegro',
  'Latte',
  'Mochi',
  'SANA-Video 2B 480p',
  'SANA-Video 2B 480p I2V',
  'LTX-Video',
  'ACE-Step Audio',
  'Stable Audio Open 1.0',
  'LongCat AudioDiT 1B',
  'AudioLDM2 Base',
  'Shap-E Rendered 3D',
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
  'Stable Diffusion XL Turbo',
  'Stable Diffusion XL InstructPix2Pix',
  'Stable Diffusion XL ControlNet',
  'Hunyuan-DiT v1.2 Distilled',
  'Hunyuan-DiT v1.2 Distilled PAG',
  'Hunyuan-DiT Canny',
  'Stable Diffusion XL T2I Adapter',
  'Stable Diffusion XL PAG',
  'PixArt Sigma XL 1024px',
  'PixArt Sigma XL 1024px PAG',
  'Kandinsky 3',
  'LongCat Image 6B',
  'LongCat Image Edit 6B',
  'Lumina Next SFT 2B',
  'Lumina Image 2.0 2.6B',
  'OmniGen v1',
  'Ovis Image 7B',
  'PRX 512 SFT',
  'Nucleus Image 17B MoE',
  'AuraFlow v0.3 1536px',
  'Chroma1-HD 1024px',
  'CogView3 Plus 3B',
  'CogView4 6B',
  'ERNIE Image Turbo',
  'GLM-Image',
  'JoyAI Image Edit',
  'JoyAI Image Edit Plus',
  'Sana 0.6B',
  'Sana 0.6B PAG',
  'Sana Sprint 0.6B',
  'DreamLite Base',
  'DreamLite Mobile',
  'Stable Diffusion 1.5',
  'LCM DreamShaper v7',
  'Stable Diffusion 1.5 PAG',
  'Marigold Depth LCM v1.0',
  'SmolLM2 135M Instruct',
  'SmolVLM 256M Instruct',
  'Janus Pro 1B',
  'Whisper Tiny',
  'DDPM CIFAR-10 32x32',
  'DDIM CIFAR-10 32x32',
  'Consistency Model ImageNet 64x64',
  'Qwen Image Edit (Standard Diffusers)',
  'Qwen Image Edit Plus (Standard Diffusers)',
  'Z-Image Inpaint (Standard Diffusers)',
  'FLUX.1 Kontext Inpaint (Standard Diffusers)',
  'FLUX.2 Klein Inpaint (Standard Diffusers)',
  'Chroma Image-to-Image (Standard Diffusers)',
  'Chroma1-HD Inpaint (Standard Diffusers)',
  'LTX-2 Standard Video + Audio',
  'Built-in Image Operations',
] as const;

export const STUDIO_MODE_DESCRIPTIONS: Record<StudioMode, string> = {
  unconditional_image: 'Sample images without a prompt.',
  depth_estimation: 'Estimate relative depth from an image.',
  text_generation: 'Generate bounded text from a prompt.',
  image_to_text: 'Describe or answer questions about one image.',
  speech_to_text: 'Transcribe audio with optional timestamps.',
  speech_translation: 'Translate recognized speech to English.',
  text_to_image: 'Generate an image from a prompt.',
  edit_image: 'Edit one source image with a prompt.',
  multi_image_reference_edit: 'Blend multiple references in one edit.',
  inpaint: 'Edit a masked image region.',
  outpaint: 'Extend an image beyond its canvas.',
  control_image: 'Guide generation with a control image.',
  control_edit_image: 'Edit a source image while following a separate control image.',
  control_inpaint: 'Edit a masked source region while following a separate control image.',
  layer_decomposition: 'Separate an image into layers.',
  text_to_video: 'Generate a video from a prompt.',
  image_to_video: 'Animate a still image.',
  video_to_video: 'Edit a source video.',
  video_inpaint: 'Edit a masked video region.',
  video_outpaint: 'Extend or reframe a video with boundary masks.',
  reference_to_video: 'Guide a video with reference images.',
  control_to_video: 'Guide generation with a control video.',
  control_video_to_video: 'Edit a source video while following a separate control video.',
  video_color_edit: 'Edit video color from a prompt.',
  character_animate: 'Animate a character from pose and face videos.',
  character_replace: 'Replace a character using aligned control videos.',
  text_to_audio: 'Generate audio from a prompt and lyrics.',
  audio_variation: 'Vary or cover source audio.',
  audio_continuation: 'Continue source audio from a prompt.',
  audio_repaint: 'Regenerate a selected audio range.',
  text_to_3d: 'Generate a bounded rendered orbit of a 3D object from a prompt.',
  image_adjustment: 'Apply bounded color and tone adjustments to a source image.',
  image_filter: 'Apply a bounded deterministic filter to a source image.',
  image_crop: 'Crop a bounded region from a source image.',
  image_resize: 'Resize a source image with bounded traditional interpolation.',
  image_tile: 'Split a source image into a bounded tile grid.',
  image_channels: 'Extract a color, alpha, or luminance channel from a source image.',
  advanced_workflow: 'Build an empty graph manually.',
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
export const WAN_22_T2V_A14B_REPO = 'Wan-AI/Wan2.2-T2V-A14B-Diffusers';
export const WAN_ANIMATE_REPO = 'Wan-AI/Wan2.2-Animate-14B-Diffusers';
export const WAN_FLF_REPO = 'Wan-AI/Wan2.1-FLF2V-14B-720P-diffusers';
export const LTX_VIDEO_REPO = 'Lightricks/LTX-Video-0.9.8-13B-distilled';
export const LTX2_REPO = 'Lightricks/LTX-2';
export const LTX2_REVISION = '47da56e2ad66ce4125a9922b4a8826bf407f9d0a';
export const FRAMEPACK_REPO = 'lllyasviel/FramePackI2V_HY';
export const FRAMEPACK_BASE_REPO = 'hunyuanvideo-community/HunyuanVideo';
export const FRAMEPACK_BASE_REVISION = 'e8c2aaa66fe3742a32c11a6766aecbf07c56e773';
export const FRAMEPACK_VISION_REPO = 'lllyasviel/flux_redux_bfl';
export const FRAMEPACK_VISION_REVISION = '45b801affc54ff2af4e5daf1b282e0921901db87';
export const STABLE_VIDEO_DIFFUSION_REPO = 'stabilityai/stable-video-diffusion-img2vid-xt-1-1';
export const STABLE_VIDEO_DIFFUSION_REVISION = '043843887ccd51926e3efed36270444a838e7861';
export const ANIMATEDIFF_MOTION_REPO = 'guoyww/animatediff-motion-adapter-v1-5-2';
export const ANIMATEDIFF_MOTION_REVISION = '6167b88ffe39b4441fdf2113e77b99a6f56b7906';
export const ANIMATELCM_MOTION_REPO = 'wangfuyun/AnimateLCM';
export const ANIMATELCM_MOTION_REVISION = '3d4d00fc113225e1040f4d3bec504b6ec750c10c';
export const COGVIDEOX_2B_REPO = 'zai-org/CogVideoX-2b';
export const COGVIDEOX_2B_REVISION = '1137dacfc2c9c012bed6a0793f4ecf2ca8e7ba01';
export const ALLEGRO_REPO = 'rhymes-ai/Allegro';
export const ALLEGRO_REVISION = 'c1b9207bb5cb79e2aa08f3d139c17d26c0de55b6';
export const LATTE_REPO = 'maxin-cn/Latte-1';
export const MOCHI_REPO = 'genmo/mochi-1-preview';
export const SANA_VIDEO_REPO = 'Efficient-Large-Model/SANA-Video_2B_480p_diffusers';
export const STABLE_AUDIO_REPO = 'stabilityai/stable-audio-open-1.0';
export const LONGCAT_AUDIO_DIT_REPO = 'ruixiangma/LongCat-AudioDiT-1B-Diffusers';
export const AUDIO_LDM2_REPO = 'cvssp/audioldm2';
export const SHAP_E_REPO = 'openai/shap-e';

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
export const WAN_ANIMATE_MODES: StudioMode[] = ['character_animate', 'character_replace'];

export const ANIMATEDIFF_MOTION_REQUIREMENT: StudioModelRequirement = {
  id: 'animatediff-motion-adapter-v1-5-2',
  label: 'AnimateDiff SD1.5 v2 MotionAdapter',
  repo: ANIMATEDIFF_MOTION_REPO,
  revision: ANIMATEDIFF_MOTION_REVISION,
  kind: 'adapter',
  requiredForModes: ['text_to_video'],
  description: 'Pinned fp16 safetensors AnimateDiff motion module.',
};

export const ANIMATELCM_MOTION_REQUIREMENT: StudioModelRequirement = {
  id: 'animatelcm-motion-adapter-and-lora',
  label: 'AnimateLCM MotionAdapter and spatial LoRA',
  repo: ANIMATELCM_MOTION_REPO,
  revision: ANIMATELCM_MOTION_REVISION,
  kind: 'adapter',
  requiredForModes: ['text_to_video'],
  description: 'Pinned fp16 safetensors AnimateLCM motion module and LoRA.',
};

export const FRAMEPACK_BASE_REQUIREMENT: StudioModelRequirement = {
  id: 'framepack-hunyuan-base-components',
  label: 'FramePack HunyuanVideo base components',
  repo: FRAMEPACK_BASE_REPO,
  revision: FRAMEPACK_BASE_REVISION,
  kind: 'base',
  requiredForModes: ['image_to_video'],
  description: 'Exact scheduler, encoders, tokenizers, and VAE composed with the FramePack transformer.',
};

export const FRAMEPACK_VISION_REQUIREMENT: StudioModelRequirement = {
  id: 'framepack-siglip-vision-components',
  label: 'FramePack SigLIP vision components',
  repo: FRAMEPACK_VISION_REPO,
  revision: FRAMEPACK_VISION_REVISION,
  kind: 'adapter',
  requiredForModes: ['image_to_video'],
  description: 'Exact SigLIP image processor and vision encoder used by FramePack conditioning.',
};

export const VIDEO_STUDIO_MODES: StudioMode[] = [
  'text_to_video',
  'image_to_video',
  'video_to_video',
  'video_inpaint',
  'video_outpaint',
  'reference_to_video',
  'control_to_video',
  'control_video_to_video',
  'video_color_edit',
  'character_animate',
  'character_replace',
];

export const AUDIO_STUDIO_MODES: StudioMode[] = [
  'text_to_audio',
  'audio_variation',
  'audio_continuation',
  'audio_repaint',
];

export const SPEECH_STUDIO_MODES: StudioMode[] = ['speech_to_text', 'speech_translation'];
export const TRANSFORMERS_TEXT_STUDIO_MODES: StudioMode[] = ['text_generation'];
export const TRANSFORMERS_IMAGE_TEXT_STUDIO_MODES: StudioMode[] = ['image_to_text'];
export const TRANSFORMERS_ANY_TO_ANY_STUDIO_MODES: StudioMode[] = ['text_generation', 'image_to_text', 'text_to_image'];
export const THREE_D_STUDIO_MODES: StudioMode[] = ['text_to_3d'];

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
    Pick<
      StudioModelProfile,
      | 'displayName'
      | 'artifactLabel'
      | 'defaultDtype'
      | 'guidanceLabel'
      | 'defaultSize'
      | 'offloadSupport'
      | 'runtimeKind'
      | 'isDiffusersBacked'
    >
  > & {
    supportFlags: number;
  };

function planningVideoProfile(
  family: StudioModelProfile['family'],
  defaultRepo: string,
  modes: StudioMode[],
  modeRequirements: StudioModelProfile['modeRequirements'] = {},
  supportFlags = 1,
  supportsVideoInput = false,
): StudioModelProfileSource {
  return {
    family,
    surfaceCategory: 'Video',
    catalogVisibility: 'workflowOnly',
    defaultRepo,
    defaultSize: { width: 768, height: 512, aspectRatio: 'custom' },
    recommendedSteps: 30,
    recommendedGuidance: 3,
    supportFlags,
    supportsVideoInput,
    outputKind: 'video',
    recommendedFrames: 81,
    recommendedFps: 24,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 20,
      width: 768,
      height: 512,
      numFrames: 49,
    },
    modes,
    modeRequirements,
  };
}

function nativeTextVideoProfile(
  family: StudioModelProfile['family'],
  defaultRepo: string,
  [width, height, steps, guidance, maxSequenceLength, frames, fps, lowSteps = steps, lowFrames = frames]: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number?,
    number?,
  ],
  aspectRatio: StudioModelProfile['defaultSize']['aspectRatio'] = 'custom',
  sequential = false,
  dtype: StudioFormState['dtype'] = 'float16',
): StudioModelProfileSource {
  const offloadMode = sequential ? 'sequential_cpu' : 'model_cpu';
  return {
    family,
    surfaceCategory: 'Video',
    catalogVisibility: 'workflowOnly',
    defaultRepo,
    defaultDtype: dtype,
    defaultSize: { width, height, aspectRatio },
    offloadSupport: sequential
      ? { ...SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT, default: 'sequential_cpu' }
      : DIRECT_OFFLOAD_SUPPORT,
    recommendedSteps: steps,
    recommendedGuidance: guidance,
    recommendedMaxSequenceLength: maxSequenceLength,
    supportFlags: 0,
    outputKind: 'video',
    recommendedFrames: frames,
    recommendedFps: fps,
    lowVram: { dtype, autoOffload: true, offloadMode, steps: lowSteps, width, height, numFrames: lowFrames },
    modes: ['text_to_video'],
  };
}

const EXPERT_WORKFLOW_PENDING = {
  catalogVisibility: 'workflowOnly',
  executionStatus: 'expert_only',
  qualificationStatus: 'graph-qualified-execution-pending',
  qualifiedModes: [] as StudioMode[],
  autoEligible: false,
  templateEligible: true,
  galleryEligible: false,
  liveProof: false,
} satisfies Partial<StudioModelProfileSource>;

function expertVideoProfile(
  source: StudioModelProfileSource,
  modes: StudioMode[],
  modeRequirements: StudioModelProfile['modeRequirements'],
  supportsVideoInput = false,
): StudioModelProfileSource {
  return {
    ...source,
    ...EXPERT_WORKFLOW_PENDING,
    modes,
    modeRequirements,
    supportsVideoInput,
  };
}

function expertImageRouteProfile({
  family,
  defaultRepo,
  revision,
  modes,
  modeRequirements,
  recommendedSteps,
  recommendedGuidance,
  recommendedMaxSequenceLength,
  supportFlags,
  lowVramSide,
  lowVramSteps = recommendedSteps,
  lowVramOffload,
  offloadSupport = SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT,
  supportsNegativePrompt = true,
  alternateArtifact,
}: {
  family: StudioModelProfile['family'];
  defaultRepo: string;
  revision: string;
  modes: StudioMode[];
  modeRequirements: StudioModelProfile['modeRequirements'];
  recommendedSteps: number;
  recommendedGuidance: number;
  recommendedMaxSequenceLength?: number;
  supportFlags: number;
  lowVramSide: number;
  lowVramSteps?: number;
  lowVramOffload: StudioFormState['offloadMode'];
  offloadSupport?: StudioModelProfile['offloadSupport'];
  supportsNegativePrompt?: boolean;
  alternateArtifact?: string;
}): StudioModelProfileSource {
  return {
    ...EXPERT_WORKFLOW_PENDING,
    family,
    surfaceCategory: 'Image Edit',
    defaultRepo,
    artifactLabel: 'Immutable safetensors Diffusers repo',
    ...(alternateArtifact ? { alternateArtifact } : {}),
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps,
    recommendedGuidance,
    ...(recommendedMaxSequenceLength ? { recommendedMaxSequenceLength } : {}),
    supportFlags,
    supportsNegativePrompt,
    outputKind: 'image',
    offloadSupport,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: lowVramOffload,
      steps: lowVramSteps,
      width: lowVramSide,
      height: lowVramSide,
    },
    modes,
    modeRequirements,
    revisionCandidates: [revision],
  };
}

function planningAudioProfile(
  family: StudioModelProfile['family'],
  defaultRepo: string,
  steps: number,
  guidance: number,
  duration: number,
  sampleRate: number,
  dtype: StudioFormState['dtype'],
  offloadMode: StudioFormState['offloadMode'] = SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT.lowVram,
): StudioModelProfileSource {
  return {
    family,
    surfaceCategory: 'Audio',
    catalogVisibility: 'workflowOnly',
    defaultRepo,
    recommendedSteps: steps,
    recommendedGuidance: guidance,
    supportFlags: 0,
    outputKind: 'audio',
    recommendedDuration: duration,
    recommendedSampleRate: sampleRate,
    lowVram: { dtype, autoOffload: true, offloadMode, steps },
    modes: ['text_to_audio'],
  };
}

function planningImageProfile(
  family: StudioModelProfile['family'],
  defaultRepo: string,
  steps: number,
  guidance: number,
  maxSequenceLength: number,
  dtype: StudioFormState['dtype'] = 'bfloat16',
  width = 1024,
  height = 1024,
  aspectRatio: StudioModelProfile['defaultSize']['aspectRatio'] = '1:1',
): StudioModelProfileSource {
  return {
    family,
    catalogVisibility: 'workflowOnly',
    defaultRepo,
    defaultDtype: dtype,
    defaultSize: { width, height, aspectRatio },
    offloadSupport: SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT,
    recommendedSteps: steps,
    recommendedGuidance: guidance,
    recommendedMaxSequenceLength: maxSequenceLength,
    supportFlags: 0,
    lowVram: { dtype, autoOffload: true, offloadMode: 'sequential_cpu', steps, width, height },
    modes: ['text_to_image'],
  };
}

function controlImageProfile(
  family: StudioModelProfile['family'],
  defaultRepo: string,
  requirement: StudioModelRequirement,
  steps: number,
  guidance: number,
  conditioningScale: number,
  recommendedMaxSequenceLength?: number,
): StudioModelProfileSource {
  return {
    family,
    surfaceCategory: 'Control',
    catalogVisibility: 'workflowOnly',
    defaultRepo,
    defaultDtype: 'float16',
    recommendedSteps: steps,
    recommendedGuidance: guidance,
    recommendedMaxSequenceLength,
    conditioningScale,
    supportFlags: 8,
    lowVram: {
      dtype: 'float16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps,
      width: 1024,
      height: 1024,
    },
    modes: ['control_image'],
    modeRequirements: {
      control_image: {
        modelRequirements: [requirement],
        requiredImages: ['controlImage'],
      },
    },
  };
}

const STUDIO_MODEL_PROFILE_SOURCES = {
  ZImageModularPipeline: {
    family: 'Z-Image',
    defaultRepo: 'Tongyi-MAI/Z-Image-Turbo',
    defaultSize: { width: 640, height: 640, aspectRatio: '1:1' },
    recommendedSteps: 8,
    recommendedGuidance: 1,
    supportsNegativePrompt: false,
    supportFlags: 33,
    offloadSupport: MODULAR_OFFLOAD_SUPPORT,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: MODULAR_OFFLOAD_SUPPORT.lowVram, steps: 8 },
    modes: ['text_to_image', 'edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
    },
  },
  QwenImageModularPipeline: {
    family: 'Qwen Image',
    defaultRepo: QWEN_IMAGE_2512_REPO,
    artifactLabel: 'bfloat16 Diffusers repo',
    defaultSize: { width: 1328, height: 1328, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 4,
    supportFlags: 43,
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
    modes: ['text_to_image', 'edit_image', 'inpaint', 'control_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      control_image: {
        modelRequirements: [QWEN_CONTROLNET_REQUIREMENT],
        requiredImages: ['controlImage'],
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
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      outpaint: {
        requiredImages: ['referenceImages'],
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
      },
    },
  },
  QwenImageLayeredModularPipeline: {
    family: 'Qwen Image',
    surfaceCategory: 'Utility',
    defaultRepo: QWEN_IMAGE_LAYERED_REPO,
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
  QwenImageControlNetPipeline: {
    ...EXPERT_WORKFLOW_PENDING,
    family: 'Qwen Image',
    surfaceCategory: 'Control',
    defaultRepo: QWEN_IMAGE_2512_REPO,
    displayName: 'Qwen-Image-2512 + ControlNet Union',
    artifactLabel: 'bfloat16 safetensors base plus pinned ControlNet component',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 4.5,
    supportFlags: 41,
    offloadSupport: { ...DIRECT_OFFLOAD_SUPPORT, lowVram: 'sequential_cpu' },
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'sequential_cpu',
      steps: 28,
      width: 768,
      height: 768,
    },
    modes: ['control_image'],
    modeRequirements: {
      control_image: {
        modelRequirements: [QWEN_CONTROLNET_REQUIREMENT],
        requiredImages: ['controlImage'],
      },
    },
    revisionCandidates: [QWEN_IMAGE_2512_REVISION],
  },
  QwenImageLayeredPipeline: {
    ...EXPERT_WORKFLOW_PENDING,
    family: 'Qwen Image',
    surfaceCategory: 'Utility',
    defaultRepo: QWEN_IMAGE_LAYERED_REPO,
    artifactLabel: 'bfloat16 safetensors Diffusers repo',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    recommendedSteps: 50,
    recommendedGuidance: 4,
    supportFlags: 49,
    offloadSupport: { ...DIRECT_OFFLOAD_SUPPORT, lowVram: 'sequential_cpu' },
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'sequential_cpu',
      steps: 30,
      width: 640,
      height: 640,
    },
    modes: ['layer_decomposition'],
    modeRequirements: { layer_decomposition: { requiredImages: ['referenceImages'] } },
    revisionCandidates: [QWEN_IMAGE_LAYERED_REVISION],
    layerCount: { default: 4, min: 1, max: 10 },
    layerResolutions: [640, 1024],
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
      },
      video_outpaint: {
        requiredVideos: ['sourceVideo', 'maskVideo'],
      },
      control_to_video: {
        requiredVideos: ['controlVideo'],
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
      video_to_video: { requiredVideos: ['sourceVideo'] },
      video_color_edit: { requiredVideos: ['sourceVideo'] },
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
  },
  Wan22Pipeline: planningVideoProfile('Wan Video', WAN_22_T2V_A14B_REPO, ['text_to_video'], {}, 0),
  WanAnimatePipeline: planningVideoProfile(
    'Wan Video',
    WAN_ANIMATE_REPO,
    WAN_ANIMATE_MODES,
    {
      character_animate: {
        requiredImages: ['referenceImages'],
        requiredVideos: ['poseVideo', 'faceVideo'],
      },
      character_replace: {
        requiredImages: ['referenceImages'],
        requiredVideos: ['poseVideo', 'faceVideo', 'backgroundVideo', 'maskVideo'],
      },
    },
    1,
    true,
  ),
  WanImage2VideoModularPipeline: planningVideoProfile('Wan Video', WAN_FLF_REPO, ['image_to_video'], {
    image_to_video: { requiredImages: ['referenceImages', 'lastImage'] },
  }),
  LTXI2VLongMultiPromptPipeline: planningVideoProfile('LTX Video', LTX_VIDEO_REPO, ['image_to_video'], {
    image_to_video: { requiredImages: ['referenceImages'] },
  }),
  LTX2ConditionPipeline: planningVideoProfile(
    'LTX Video',
    LTX2_REPO,
    LTX_VIDEO_MODES,
    {
      image_to_video: { requiredImages: ['referenceImages'] },
      reference_to_video: { requiredImages: ['referenceImages'] },
      video_to_video: { requiredVideos: ['sourceVideo'] },
    },
    1,
    true,
  ),
  HunyuanVideoFramepackPipeline: planningVideoProfile('Wan Video', FRAMEPACK_REPO, ['image_to_video'], {
    image_to_video: {
      modelRequirements: [FRAMEPACK_BASE_REQUIREMENT, FRAMEPACK_VISION_REQUIREMENT],
      requiredImages: ['referenceImages'],
      note: 'Requires the exact HunyuanVideo base and SigLIP vision component selections.',
    },
  }),
  StableVideoDiffusionPipeline: {
    family: 'Stable Video Diffusion',
    surfaceCategory: 'Video',
    catalogVisibility: 'workflowOnly',
    defaultRepo: STABLE_VIDEO_DIFFUSION_REPO,
    displayName: 'stable-video-diffusion-img2vid-xt-1-1',
    artifactLabel: 'Gated safetensors Diffusers repo',
    defaultDtype: 'float16',
    defaultSize: { width: 1024, height: 576, aspectRatio: '16:9' },
    recommendedSteps: 25,
    recommendedGuidance: 3,
    supportFlags: 1,
    supportsPrompt: false,
    supportsNegativePrompt: false,
    outputKind: 'video',
    recommendedFrames: 25,
    recommendedFps: 7,
    lowVram: {
      dtype: 'float16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 25,
      width: 1024,
      height: 576,
      numFrames: 8,
    },
    modes: ['image_to_video'],
    modeRequirements: {
      image_to_video: {
        requiredImages: ['referenceImages'],
      },
    },
  },
  AnimateDiffPipeline: {
    ...nativeTextVideoProfile('AnimateDiff', SD15_BASE_REPO, [512, 512, 25, 7.5, 77, 16, 8, 16, 8], '1:1'),
    modeRequirements: {
      text_to_video: {
        modelRequirements: [ANIMATEDIFF_MOTION_REQUIREMENT],
      },
    },
  },
  AnimateDiffPAGPipeline: {
    ...expertVideoProfile(
      nativeTextVideoProfile('AnimateDiff', SD15_BASE_REPO, [512, 512, 25, 7.5, 77, 16, 8, 16, 8], '1:1'),
      ['text_to_video'],
      { text_to_video: { modelRequirements: [ANIMATEDIFF_MOTION_REQUIREMENT] } },
    ),
    recommendedPagScale: 3,
    recommendedPagAdaptiveScale: 0,
    revisionCandidates: [SD15_BASE_REVISION],
  },
  AnimateDiffVideoToVideoPipeline: {
    ...expertVideoProfile(
      nativeTextVideoProfile('AnimateDiff', SD15_BASE_REPO, [512, 512, 25, 7.5, 77, 16, 8, 16, 8], '1:1'),
      ['video_to_video'],
      {
        video_to_video: {
          modelRequirements: [ANIMATEDIFF_MOTION_REQUIREMENT],
          requiredVideos: ['sourceVideo'],
        },
      },
      true,
    ),
    recommendedStrength: 0.8,
    revisionCandidates: [SD15_BASE_REVISION],
  },
  AnimateDiffControlNetPipeline: {
    ...expertVideoProfile(
      nativeTextVideoProfile('AnimateDiff', SD15_BASE_REPO, [512, 512, 25, 7.5, 77, 16, 8, 16, 8], '1:1'),
      ['control_to_video'],
      {
        control_to_video: {
          modelRequirements: [ANIMATEDIFF_MOTION_REQUIREMENT, SD15_CONTROLNET_CANNY_REQUIREMENT],
          requiredVideos: ['controlVideo'],
        },
      },
      true,
    ),
    conditioningScale: 1,
    revisionCandidates: [SD15_BASE_REVISION],
  },
  AnimateDiffVideoToVideoControlNetPipeline: {
    ...expertVideoProfile(
      nativeTextVideoProfile('AnimateDiff', SD15_BASE_REPO, [512, 512, 25, 7.5, 77, 16, 8, 16, 8], '1:1'),
      ['control_video_to_video'],
      {
        control_video_to_video: {
          modelRequirements: [ANIMATEDIFF_MOTION_REQUIREMENT, SD15_CONTROLNET_CANNY_REQUIREMENT],
          requiredVideos: ['sourceVideo', 'controlVideo'],
        },
      },
      true,
    ),
    recommendedStrength: 0.8,
    conditioningScale: 1,
    revisionCandidates: [SD15_BASE_REVISION],
  },
  AnimateLCMPipeline: {
    ...nativeTextVideoProfile('AnimateDiff', SD15_BASE_REPO, [512, 512, 6, 1.5, 77, 16, 8, 4, 8], '1:1'),
    modeRequirements: {
      text_to_video: {
        modelRequirements: [ANIMATELCM_MOTION_REQUIREMENT],
      },
    },
  },
  CogVideoXPipeline: nativeTextVideoProfile('CogVideoX', COGVIDEOX_2B_REPO, [720, 480, 25, 6, 226, 25, 8, 16, 9]),
  CogVideoXVideoToVideoPipeline: {
    ...expertVideoProfile(
      nativeTextVideoProfile('CogVideoX', COGVIDEOX_2B_REPO, [720, 480, 25, 6, 226, 25, 8, 16, 9]),
      ['video_to_video'],
      { video_to_video: { requiredVideos: ['sourceVideo'] } },
      true,
    ),
    recommendedStrength: 0.8,
    revisionCandidates: [COGVIDEOX_2B_REVISION],
  },
  AllegroPipeline: nativeTextVideoProfile(
    'Allegro',
    ALLEGRO_REPO,
    [1280, 720, 100, 7.5, 512, 88, 15],
    '16:9',
    true,
    'bfloat16',
  ),
  LattePipeline: nativeTextVideoProfile('Latte', LATTE_REPO, [512, 512, 50, 7.5, 120, 16, 8], '1:1', true),
  MochiPipeline: nativeTextVideoProfile(
    'Mochi',
    MOCHI_REPO,
    [848, 480, 64, 4.5, 256, 31, 30],
    '16:9',
    true,
    'bfloat16',
  ),
  SanaVideoPipeline: nativeTextVideoProfile(
    'SANA Video',
    SANA_VIDEO_REPO,
    [832, 480, 50, 6, 300, 81, 16],
    '16:9',
    true,
    'bfloat16',
  ),
  SanaImageToVideoPipeline: {
    ...nativeTextVideoProfile('SANA Video', SANA_VIDEO_REPO, [832, 480, 50, 6, 300, 81, 16], '16:9', true, 'bfloat16'),
    supportFlags: 1,
    modes: ['image_to_video'],
    modeRequirements: {
      image_to_video: { requiredImages: ['referenceImages'] },
    },
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
      },
      video_to_video: { requiredVideos: ['sourceVideo'] },
      reference_to_video: {
        requiredImages: ['referenceImages'],
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
      audio_variation: { requiredAudio: ['sourceAudio'] },
      audio_continuation: { requiredAudio: ['sourceAudio'] },
      audio_repaint: {
        requiredAudio: ['sourceAudio'],
      },
    },
  },
  StableAudioPipeline: {
    ...planningAudioProfile(
      'Stable Audio',
      STABLE_AUDIO_REPO,
      100,
      7,
      30,
      48000,
      'bfloat16',
      DIRECT_OFFLOAD_SUPPORT.lowVram,
    ),
    displayName: 'stable-audio-open-1.0',
    artifactLabel: 'Diffusers audio repo',
  },
  LongCatAudioDiTPipeline: {
    ...planningAudioProfile('LongCat AudioDiT', LONGCAT_AUDIO_DIT_REPO, 16, 4, 5, 24000, 'bfloat16'),
    displayName: 'LongCat-AudioDiT-1B-Diffusers',
    artifactLabel: 'Reviewed Diffusers-format safetensors conversion',
  },
  AudioLDM2Pipeline: {
    ...planningAudioProfile('AudioLDM2', AUDIO_LDM2_REPO, 200, 3.5, 10, 16000, 'float16'),
    displayName: 'audioldm2',
    artifactLabel: 'Diffusers safetensors repo',
    defaultDtype: 'float16',
  },
  ShapEPipeline: {
    family: 'Shap-E',
    surfaceCategory: 'Utility',
    catalogVisibility: 'workflowOnly',
    defaultRepo: SHAP_E_REPO,
    displayName: 'shap-e',
    artifactLabel: 'Explicit safe-component Diffusers assembly',
    defaultDtype: 'float16',
    defaultSize: { width: 256, height: 256, aspectRatio: '1:1' },
    recommendedSteps: 64,
    recommendedGuidance: 15,
    supportFlags: 0,
    supportsNegativePrompt: false,
    outputKind: 'video',
    recommendedFrames: 20,
    recommendedFps: 12,
    offloadSupport: SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT,
    lowVram: {
      dtype: 'float16',
      autoOffload: true,
      offloadMode: SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 64,
      width: 256,
      height: 256,
      numFrames: 20,
    },
    modes: THREE_D_STUDIO_MODES,
  },
  FluxSchnellPipeline: {
    family: 'FLUX Image',
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
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_DEV_REPO,
    alternateArtifact: FLUX_DEV_FP8_REPO,
    recommendedSteps: 28,
    recommendedGuidance: 3.5,
    supportFlags: 35,
    lowVram: {
      dtype: 'bfloat16',
      quantizationMode: 'quanto_float8',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency,
      steps: 24,
      width: 1024,
      height: 1024,
    },
    modes: ['text_to_image', 'edit_image', 'inpaint'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
    },
  },
  FluxKreaPipeline: {
    family: 'FLUX Image',
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
      edit_image: { requiredImages: ['referenceImages'] },
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
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      outpaint: {
        requiredImages: ['referenceImages'],
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
    supportFlags: 43,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency, steps: 24 },
    modes: ['control_image', 'control_edit_image', 'control_inpaint'],
    modeRequirements: {
      control_image: { requiredImages: ['controlImage'] },
      control_edit_image: { requiredImages: ['referenceImages', 'controlImage'] },
      control_inpaint: { requiredImages: ['referenceImages', 'maskImage', 'controlImage'] },
    },
  },
  FluxCannyPipeline: {
    family: 'FLUX Image',
    surfaceCategory: 'Control',
    catalogVisibility: 'workflowOnly',
    defaultRepo: FLUX_CANNY_REPO,
    recommendedSteps: 50,
    recommendedGuidance: 30,
    supportFlags: 43,
    lowVram: { dtype: 'bfloat16', autoOffload: true, offloadMode: DIRECT_OFFLOAD_SUPPORT.emergency, steps: 24 },
    modes: ['control_image', 'control_edit_image', 'control_inpaint'],
    modeRequirements: {
      control_image: { requiredImages: ['controlImage'] },
      control_edit_image: { requiredImages: ['referenceImages', 'controlImage'] },
      control_inpaint: { requiredImages: ['referenceImages', 'maskImage', 'controlImage'] },
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
      edit_image: { requiredImages: ['referenceImages'] },
      multi_image_reference_edit: {
        requiredImages: ['referenceImages'],
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
      edit_image: { requiredImages: ['referenceImages'] },
      multi_image_reference_edit: {
        requiredImages: ['referenceImages'],
      },
    },
  },
  StableDiffusionXLPipeline: {
    family: 'Stable Diffusion XL',
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
      edit_image: { requiredImages: ['referenceImages'] },
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
    },
  },
  StableDiffusionXLTurboPipeline: {
    family: 'Stable Diffusion XL',
    catalogVisibility: 'workflowOnly',
    defaultRepo: SDXL_TURBO_REPO,
    artifactLabel: 'Diffusers safetensors repo',
    defaultDtype: 'float16',
    defaultSize: { width: 512, height: 512, aspectRatio: '1:1' },
    recommendedSteps: 1,
    recommendedGuidance: 0,
    supportFlags: 1,
    supportsNegativePrompt: false,
    lowVram: {
      dtype: 'float16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 1,
      width: 512,
      height: 512,
    },
    modes: ['text_to_image'],
  },
  StableDiffusionXLInstructPix2PixPipeline: {
    family: 'Stable Diffusion XL',
    surfaceCategory: 'Image Edit',
    catalogVisibility: 'workflowOnly',
    defaultRepo: SDXL_INSTRUCT_PIX2PIX_REPO,
    artifactLabel: 'Diffusers safetensors repo',
    defaultDtype: 'float16',
    defaultSize: { width: 768, height: 768, aspectRatio: '1:1' },
    recommendedSteps: 30,
    recommendedGuidance: 3,
    conditioningScale: 1.5,
    supportFlags: 1,
    lowVram: {
      dtype: 'float16',
      autoOffload: true,
      offloadMode: DIRECT_OFFLOAD_SUPPORT.lowVram,
      steps: 30,
      width: 768,
      height: 768,
    },
    modes: ['edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
    },
  },
  StableDiffusionXLControlNetPipeline: {
    ...controlImageProfile('Stable Diffusion XL', SDXL_BASE_REPO, SDXL_CONTROLNET_CANNY_REQUIREMENT, 50, 5, 0.5),
    supportFlags: 11,
    modes: ['control_image', 'control_edit_image', 'control_inpaint'],
    modeRequirements: {
      control_image: {
        modelRequirements: [SDXL_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['controlImage'],
      },
      control_edit_image: {
        modelRequirements: [SDXL_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['referenceImages', 'controlImage'],
      },
      control_inpaint: {
        modelRequirements: [SDXL_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['referenceImages', 'maskImage', 'controlImage'],
      },
    },
  },
  HunyuanDiTPipeline: planningImageProfile('Hunyuan-DiT', HUNYUAN_DIT_DISTILLED_REPO, 25, 5, 256, 'float16'),
  HunyuanDiTPAGPipeline: {
    family: 'Hunyuan-DiT',
    catalogVisibility: 'workflowOnly',
    defaultRepo: HUNYUAN_DIT_DISTILLED_REPO,
    defaultDtype: 'float16',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    offloadSupport: SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT,
    recommendedSteps: 25,
    recommendedGuidance: 5,
    recommendedPagScale: 3,
    recommendedPagAdaptiveScale: 0,
    supportFlags: 0,
    lowVram: {
      dtype: 'float16',
      autoOffload: true,
      offloadMode: 'sequential_cpu',
      steps: 25,
      width: 1024,
      height: 1024,
    },
    modes: ['text_to_image'],
  },
  HunyuanDiTControlNetPipeline: controlImageProfile(
    'Hunyuan-DiT',
    HUNYUAN_DIT_DISTILLED_REPO,
    HUNYUAN_DIT_CONTROLNET_CANNY_REQUIREMENT,
    50,
    6,
    1,
    256,
  ),
  StableDiffusionXLAdapterPipeline: controlImageProfile(
    'Stable Diffusion XL',
    SDXL_BASE_REPO,
    SDXL_T2I_ADAPTER_CANNY_REQUIREMENT,
    30,
    7.5,
    0.8,
  ),
  StableDiffusionXLPAGPipeline: {
    family: 'Stable Diffusion XL',
    catalogVisibility: 'workflowOnly',
    defaultRepo: SDXL_BASE_REPO,
    artifactLabel: 'Diffusers fp16 safetensors repo',
    defaultDtype: 'float16',
    offloadSupport: SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT,
    recommendedSteps: 50,
    recommendedGuidance: 5,
    recommendedPagScale: 3,
    recommendedPagAdaptiveScale: 0,
    supportFlags: 43,
    lowVram: {
      dtype: 'float16',
      autoOffload: true,
      offloadMode: 'sequential_cpu',
      steps: 50,
      width: 1024,
      height: 1024,
    },
    modes: ['text_to_image', 'edit_image', 'inpaint', 'control_image', 'control_edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      control_image: {
        modelRequirements: [SDXL_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['controlImage'],
      },
      control_edit_image: {
        modelRequirements: [SDXL_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['referenceImages', 'controlImage'],
      },
    },
  },
  PixArtSigmaPipeline: planningImageProfile('PixArt Sigma', PIXART_SIGMA_REPO, 20, 4.5, 300, 'float16'),
  PixArtSigmaPAGPipeline: {
    ...planningImageProfile('PixArt Sigma', PIXART_SIGMA_REPO, 20, 4.5, 300, 'float16'),
    recommendedPagScale: 3,
    recommendedPagAdaptiveScale: 0,
  },
  Kandinsky3Pipeline: {
    ...planningImageProfile('Kandinsky', KANDINSKY3_REPO, 25, 3, 128, 'float16'),
    surfaceCategory: 'Image Edit',
    supportFlags: 1,
    recommendedStrength: 0.75,
    modes: ['text_to_image', 'edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
    },
  },
  LongCatImagePipeline: planningImageProfile('LongCat Image', LONGCAT_IMAGE_REPO, 50, 4, 512),
  LongCatImageEditPipeline: {
    ...planningImageProfile('LongCat Image', LONGCAT_IMAGE_EDIT_REPO, 50, 4.5, 512),
    surfaceCategory: 'Image Edit',
    supportFlags: 1,
    modes: ['edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
    },
  },
  LuminaPipeline: planningImageProfile('Lumina', LUMINA_REPO, 30, 4, 256),
  Lumina2Pipeline: planningImageProfile('Lumina', LUMINA2_REPO, 50, 4, 256),
  OmniGenPipeline: {
    ...planningImageProfile('OmniGen', OMNIGEN_REPO, 50, 2.5, 256),
    surfaceCategory: 'Image Edit',
    supportsNegativePrompt: false,
    conditioningScale: 1.6,
    supportFlags: 5,
    modes: ['text_to_image', 'edit_image', 'multi_image_reference_edit'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
      multi_image_reference_edit: { requiredImages: ['referenceImages'] },
    },
  },
  OvisImagePipeline: planningImageProfile('Ovis Image', OVIS_IMAGE_REPO, 50, 5, 256),
  PRXPipeline: planningImageProfile('PRX', PRX_REPO, 28, 5, 256, 'bfloat16', 512, 512),
  NucleusMoEImagePipeline: planningImageProfile(
    'Nucleus Image',
    NUCLEUS_IMAGE_REPO,
    50,
    4,
    1024,
    'bfloat16',
    1024,
    1024,
  ),
  AuraFlowPipeline: planningImageProfile('AuraFlow', AURAFLOW_V03_REPO, 50, 3.5, 256, 'float16', 1536, 768, 'custom'),
  ChromaPipeline: planningImageProfile('Chroma', CHROMA1_HD_REPO, 40, 3, 512),
  CogView3PlusPipeline: planningImageProfile('CogView3', COGVIEW3_PLUS_REPO, 50, 7, 224),
  CogView4Pipeline: planningImageProfile('CogView4', COGVIEW4_6B_REPO, 50, 3.5, 1024),
  ErnieImagePipeline: {
    ...planningImageProfile('ERNIE Image', ERNIE_IMAGE_TURBO_REPO, 8, 1, 2048),
    supportsNegativePrompt: false,
  },
  GlmImagePipeline: {
    ...planningImageProfile('GLM-Image', GLM_IMAGE_REPO, 50, 1.5, 2048),
    supportsNegativePrompt: false,
  },
  JoyImageEditPipeline: {
    ...planningImageProfile('JoyAI Image', JOYIMAGE_EDIT_REPO, 40, 4, 2048),
    surfaceCategory: 'Image Edit',
    supportFlags: 1,
    modes: ['text_to_image', 'edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
    },
  },
  JoyImageEditPlusPipeline: {
    ...planningImageProfile('JoyAI Image', JOYIMAGE_EDIT_PLUS_REPO, 30, 4, 2048),
    surfaceCategory: 'Image Edit',
    supportFlags: 5,
    modes: ['edit_image', 'multi_image_reference_edit'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
      multi_image_reference_edit: { requiredImages: ['referenceImages'] },
    },
  },
  SanaPipeline: planningImageProfile('Sana', SANA_REPO, 20, 4.5, 300, 'float16'),
  SanaPAGPipeline: {
    ...planningImageProfile('Sana', SANA_REPO, 20, 4.5, 300, 'float16'),
    recommendedPagScale: 3,
    recommendedPagAdaptiveScale: 0,
  },
  SanaSprintPipeline: {
    family: 'Sana',
    catalogVisibility: 'workflowOnly',
    defaultRepo: SANA_SPRINT_REPO,
    offloadSupport: SEQUENTIAL_DIRECT_OFFLOAD_SUPPORT,
    recommendedSteps: 2,
    recommendedGuidance: 4.5,
    recommendedStrength: 0.5,
    recommendedMaxSequenceLength: 300,
    supportsNegativePrompt: false,
    supportFlags: 1,
    lowVram: {
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'sequential_cpu',
      steps: 2,
      width: 1024,
      height: 1024,
    },
    modes: ['text_to_image', 'edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
    },
  },
  DreamLitePipeline: {
    ...planningImageProfile('DreamLite', DREAMLITE_BASE_REPO, 28, 3.5, 200),
    conditioningScale: 1.5,
    supportFlags: 1,
    modes: ['text_to_image', 'edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
    },
  },
  DreamLiteMobilePipeline: {
    ...planningImageProfile('DreamLite', DREAMLITE_MOBILE_REPO, 4, 0, 200),
    conditioningScale: 0,
    supportsNegativePrompt: false,
    supportFlags: 1,
    modes: ['text_to_image', 'edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
    },
  },
  StableDiffusionPipeline: {
    family: 'Stable Diffusion 1.x',
    catalogVisibility: 'workflowOnly',
    defaultRepo: SD15_BASE_REPO,
    artifactLabel: 'Diffusers safetensors repo',
    defaultDtype: 'float32',
    defaultSize: { width: 512, height: 512, aspectRatio: '1:1' },
    offloadSupport: {
      modes: [...STUDIO_OFFLOAD_MODES],
      default: 'none',
      lowVram: 'model_cpu',
      emergency: 'sequential_cpu',
    },
    recommendedSteps: 30,
    recommendedGuidance: 7.5,
    supportFlags: 43,
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 20, width: 512, height: 512 },
    modes: ['text_to_image', 'edit_image', 'inpaint', 'control_image', 'control_edit_image', 'control_inpaint'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      control_image: {
        modelRequirements: [SD15_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['controlImage'],
      },
      control_edit_image: {
        modelRequirements: [SD15_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['referenceImages', 'controlImage'],
      },
      control_inpaint: {
        modelRequirements: [SD15_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['referenceImages', 'maskImage', 'controlImage'],
      },
    },
  },
  LatentConsistencyModelPipeline: {
    family: 'Latent Consistency Models',
    catalogVisibility: 'workflowOnly',
    defaultRepo: LCM_DREAMSHAPER_REPO,
    artifactLabel: 'Diffusers safetensors repo',
    defaultDtype: 'float32',
    defaultSize: { width: 512, height: 512, aspectRatio: '1:1' },
    offloadSupport: {
      modes: [...STUDIO_OFFLOAD_MODES],
      default: 'none',
      lowVram: 'model_cpu',
      emergency: 'sequential_cpu',
    },
    recommendedSteps: 4,
    recommendedGuidance: 8.5,
    supportFlags: 1,
    supportsNegativePrompt: false,
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 4, width: 512, height: 512 },
    modes: ['text_to_image', 'edit_image'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
    },
  },
  StableDiffusionPAGPipeline: {
    family: 'Stable Diffusion 1.x',
    catalogVisibility: 'workflowOnly',
    defaultRepo: SD15_BASE_REPO,
    artifactLabel: 'Diffusers safetensors repo',
    defaultDtype: 'float32',
    defaultSize: { width: 512, height: 512, aspectRatio: '1:1' },
    offloadSupport: {
      modes: [...STUDIO_OFFLOAD_MODES],
      default: 'none',
      lowVram: 'model_cpu',
      emergency: 'sequential_cpu',
    },
    recommendedSteps: 30,
    recommendedGuidance: 7.5,
    recommendedPagScale: 3,
    recommendedPagAdaptiveScale: 0,
    supportFlags: 43,
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 20, width: 512, height: 512 },
    modes: ['text_to_image', 'edit_image', 'inpaint', 'control_image', 'control_inpaint'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      control_image: {
        modelRequirements: [SD15_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['controlImage'],
      },
      control_inpaint: {
        modelRequirements: [SD15_CONTROLNET_CANNY_REQUIREMENT],
        requiredImages: ['referenceImages', 'maskImage', 'controlImage'],
      },
    },
  },
  MarigoldDepthPipeline: {
    family: 'Marigold',
    surfaceCategory: 'Utility',
    catalogVisibility: 'workflowOnly',
    defaultRepo: MARIGOLD_DEPTH_LCM_REPO,
    artifactLabel: 'Diffusers safetensors repo',
    defaultDtype: 'float32',
    guidanceLabel: 'Not used',
    defaultSize: { width: 768, height: 768, aspectRatio: '1:1' },
    offloadSupport: {
      modes: [...STUDIO_OFFLOAD_MODES],
      default: 'none',
      lowVram: 'model_cpu',
      emergency: 'sequential_cpu',
    },
    recommendedSteps: 1,
    recommendedGuidance: 0,
    supportFlags: 1,
    supportsNegativePrompt: false,
    outputKind: 'image',
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 1, width: 768, height: 768 },
    modes: ['depth_estimation'],
    modeRequirements: {
      depth_estimation: {
        requiredImages: ['referenceImages'],
      },
    },
  },
  HuggingFaceTextGenerationModel: {
    family: 'SmolLM',
    surfaceCategory: 'Utility',
    catalogVisibility: 'workflowOnly',
    runtimeKind: 'transformers',
    isDiffusersBacked: false,
    defaultRepo: SMOLLM2_135M_INSTRUCT_REPO,
    artifactLabel: 'Transformers safetensors repo',
    defaultDtype: 'float32',
    guidanceLabel: 'Not used',
    defaultSize: { width: 1, height: 1, aspectRatio: '1:1' },
    offloadSupport: {
      modes: ['none'],
      default: 'none',
      lowVram: 'none',
      emergency: 'none',
    },
    recommendedSteps: 1,
    recommendedGuidance: 0,
    supportFlags: 0,
    supportsNegativePrompt: false,
    outputKind: 'json',
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 1 },
    modes: TRANSFORMERS_TEXT_STUDIO_MODES,
  },
  HuggingFaceImageTextToTextModel: {
    family: 'SmolVLM',
    surfaceCategory: 'Utility',
    catalogVisibility: 'workflowOnly',
    runtimeKind: 'transformers',
    isDiffusersBacked: false,
    defaultRepo: SMOLVLM_256M_INSTRUCT_REPO,
    artifactLabel: 'Transformers safetensors repo',
    defaultDtype: 'float32',
    guidanceLabel: 'Not used',
    defaultSize: { width: 512, height: 512, aspectRatio: '1:1' },
    offloadSupport: {
      modes: ['none'],
      default: 'none',
      lowVram: 'none',
      emergency: 'none',
    },
    recommendedSteps: 1,
    recommendedGuidance: 0,
    supportFlags: 1,
    supportsNegativePrompt: false,
    outputKind: 'json',
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 1, width: 512, height: 512 },
    modes: TRANSFORMERS_IMAGE_TEXT_STUDIO_MODES,
    modeRequirements: {
      image_to_text: { requiredImages: ['referenceImages'] },
    },
  },
  HuggingFaceAnyToAnyModel: {
    family: 'Janus',
    displayName: 'Janus-Pro-1B',
    surfaceCategory: 'Utility',
    catalogVisibility: 'workflowOnly',
    runtimeKind: 'transformers',
    isDiffusersBacked: false,
    defaultRepo: JANUS_PRO_1B_REPO,
    artifactLabel: 'Transformers safetensors repo (DeepSeek Model License)',
    defaultDtype: 'bfloat16',
    guidanceLabel: 'Not used',
    defaultSize: { width: 384, height: 384, aspectRatio: '1:1' },
    offloadSupport: {
      modes: ['none'],
      default: 'none',
      lowVram: 'none',
      emergency: 'none',
    },
    recommendedSteps: 1,
    recommendedGuidance: 0,
    supportFlags: 1,
    supportsNegativePrompt: false,
    outputKind: 'image',
    modeOutputKinds: { text_generation: 'json', image_to_text: 'json', text_to_image: 'image' },
    lowVram: { dtype: 'bfloat16', autoOffload: false, offloadMode: 'none', steps: 1, width: 384, height: 384 },
    modes: TRANSFORMERS_ANY_TO_ANY_STUDIO_MODES,
    modeRequirements: {
      image_to_text: { requiredImages: ['referenceImages'] },
    },
    revisionCandidates: [JANUS_PRO_1B_REVISION],
    executionStatus: 'expert_only',
    autoEligible: false,
    galleryEligible: false,
    license: 'DeepSeek Model License Agreement v1.0',
  },
  HuggingFaceSpeechRecognitionModel: {
    family: 'Whisper',
    surfaceCategory: 'Utility',
    catalogVisibility: 'workflowOnly',
    runtimeKind: 'transformers',
    isDiffusersBacked: false,
    defaultRepo: WHISPER_TINY_REPO,
    artifactLabel: 'Transformers safetensors repo',
    defaultDtype: 'float32',
    guidanceLabel: 'Not used',
    defaultSize: { width: 1, height: 1, aspectRatio: '1:1' },
    offloadSupport: {
      modes: ['none'],
      default: 'none',
      lowVram: 'none',
      emergency: 'none',
    },
    recommendedSteps: 1,
    recommendedGuidance: 0,
    supportFlags: 0,
    supportsNegativePrompt: false,
    supportsAudioInput: true,
    outputKind: 'json',
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 1 },
    modes: SPEECH_STUDIO_MODES,
    modeRequirements: {
      speech_to_text: { requiredAudio: ['sourceAudio'] },
      speech_translation: { requiredAudio: ['sourceAudio'] },
    },
  },
  DDPMPipeline: {
    family: 'DDPM',
    catalogVisibility: 'workflowOnly',
    defaultRepo: DDPM_CIFAR10_REPO,
    artifactLabel: 'Unconditional image repo',
    defaultDtype: 'float32',
    guidanceLabel: 'Not used',
    defaultSize: { width: 32, height: 32, aspectRatio: '1:1' },
    offloadSupport: { modes: ['none', 'model_cpu'], default: 'none', lowVram: 'none', emergency: 'model_cpu' },
    recommendedSteps: 1000,
    recommendedGuidance: 0,
    supportFlags: 0,
    supportsNegativePrompt: false,
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 1000, width: 32, height: 32 },
    modes: ['unconditional_image'],
  },
  DDIMPipeline: {
    family: 'DDIM',
    catalogVisibility: 'workflowOnly',
    defaultRepo: DDPM_CIFAR10_REPO,
    artifactLabel: 'Unconditional image repo',
    defaultDtype: 'float32',
    guidanceLabel: 'Not used',
    defaultSize: { width: 32, height: 32, aspectRatio: '1:1' },
    offloadSupport: { modes: ['none', 'model_cpu'], default: 'none', lowVram: 'none', emergency: 'model_cpu' },
    recommendedSteps: 50,
    recommendedGuidance: 0,
    supportFlags: 0,
    supportsNegativePrompt: false,
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 50, width: 32, height: 32 },
    modes: ['unconditional_image'],
  },
  ConsistencyModelPipeline: {
    family: 'Consistency Models',
    catalogVisibility: 'workflowOnly',
    defaultRepo: CONSISTENCY_IMAGENET64_REPO,
    artifactLabel: 'Unconditional image repo',
    defaultDtype: 'float32',
    guidanceLabel: 'Not used',
    defaultSize: { width: 64, height: 64, aspectRatio: '1:1' },
    offloadSupport: { modes: ['none', 'model_cpu'], default: 'none', lowVram: 'none', emergency: 'model_cpu' },
    recommendedSteps: 1,
    recommendedGuidance: 0,
    supportFlags: 0,
    supportsNegativePrompt: false,
    lowVram: { dtype: 'float32', autoOffload: false, offloadMode: 'none', steps: 1, width: 64, height: 64 },
    modes: ['unconditional_image'],
  },
  QwenImageEditPipeline: expertImageRouteProfile({
    family: 'Qwen Image',
    defaultRepo: 'Qwen/Qwen-Image-Edit',
    revision: QWEN_IMAGE_EDIT_REVISION,
    modes: ['edit_image'],
    modeRequirements: { edit_image: { requiredImages: ['referenceImages'] } },
    recommendedSteps: 40,
    recommendedGuidance: 4,
    supportFlags: 33,
    lowVramSide: 768,
    lowVramSteps: 24,
    lowVramOffload: 'sequential_cpu',
  }),
  QwenImageEditPlusPipeline: expertImageRouteProfile({
    family: 'Qwen Image',
    defaultRepo: 'Qwen/Qwen-Image-Edit-2511',
    revision: QWEN_IMAGE_EDIT_PLUS_REVISION,
    modes: ['edit_image', 'multi_image_reference_edit'],
    modeRequirements: {
      edit_image: { requiredImages: ['referenceImages'] },
      multi_image_reference_edit: { requiredImages: ['referenceImages'] },
    },
    recommendedSteps: 40,
    recommendedGuidance: 4,
    supportFlags: 37,
    lowVramSide: 768,
    lowVramSteps: 24,
    lowVramOffload: 'sequential_cpu',
  }),
  ZImageInpaintPipeline: expertImageRouteProfile({
    family: 'Z-Image',
    defaultRepo: 'Tongyi-MAI/Z-Image-Turbo',
    revision: Z_IMAGE_REVISION,
    modes: ['inpaint', 'outpaint'],
    modeRequirements: {
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      outpaint: { requiredImages: ['referenceImages'] },
    },
    recommendedSteps: 8,
    recommendedGuidance: 1,
    supportFlags: 35,
    lowVramSide: 1024,
    lowVramOffload: 'model_cpu',
    offloadSupport: {
      modes: ['none', 'model_cpu', 'group_cpu', 'group_disk'],
      default: 'model_cpu',
      lowVram: 'model_cpu',
      emergency: 'group_disk',
    },
  }),
  FluxKontextInpaintPipeline: expertImageRouteProfile({
    family: 'FLUX Image',
    defaultRepo: FLUX_KONTEXT_REPO,
    revision: FLUX_KONTEXT_REVISION,
    modes: ['inpaint', 'outpaint'],
    modeRequirements: {
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      outpaint: { requiredImages: ['referenceImages'] },
    },
    recommendedSteps: 24,
    recommendedGuidance: 3.5,
    supportFlags: 35,
    lowVramSide: 768,
    lowVramOffload: 'sequential_cpu',
    alternateArtifact: FLUX_KONTEXT_NVFP4_REPO,
    offloadSupport: {
      modes: ['model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'],
      default: 'model_cpu',
      lowVram: 'sequential_cpu',
      emergency: 'group_disk',
    },
  }),
  Flux2KleinInpaintPipeline: expertImageRouteProfile({
    family: 'FLUX Image',
    defaultRepo: FLUX2_KLEIN_REPO,
    revision: FLUX2_KLEIN_REVISION,
    modes: ['inpaint', 'outpaint'],
    modeRequirements: {
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      outpaint: { requiredImages: ['referenceImages'] },
    },
    recommendedSteps: 4,
    recommendedGuidance: 1,
    supportFlags: 35,
    supportsNegativePrompt: false,
    lowVramSide: 768,
    lowVramOffload: 'model_cpu',
    offloadSupport: {
      modes: ['model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'],
      default: 'model_cpu',
      lowVram: 'model_cpu',
      emergency: 'group_disk',
    },
  }),
  ChromaImg2ImgPipeline: expertImageRouteProfile({
    family: 'Chroma',
    defaultRepo: CHROMA1_HD_REPO,
    revision: CHROMA1_HD_REVISION,
    modes: ['edit_image'],
    modeRequirements: { edit_image: { requiredImages: ['referenceImages'] } },
    recommendedSteps: 35,
    recommendedGuidance: 5,
    recommendedMaxSequenceLength: 512,
    supportFlags: 1,
    lowVramSide: 1024,
    lowVramOffload: 'sequential_cpu',
  }),
  ChromaInpaintPipeline: expertImageRouteProfile({
    family: 'Chroma',
    defaultRepo: CHROMA1_HD_REPO,
    revision: CHROMA1_HD_REVISION,
    modes: ['inpaint', 'outpaint'],
    modeRequirements: {
      inpaint: { requiredImages: ['referenceImages', 'maskImage'] },
      outpaint: { requiredImages: ['referenceImages'] },
    },
    recommendedSteps: 28,
    recommendedGuidance: 7,
    recommendedMaxSequenceLength: 512,
    supportFlags: 3,
    lowVramSide: 1024,
    lowVramOffload: 'sequential_cpu',
  }),
  LTX2Pipeline: {
    ...expertVideoProfile(
      planningVideoProfile('LTX Video', LTX2_REPO, ['text_to_video'], {}, 0),
      ['text_to_video'],
      {},
    ),
    displayName: 'LTX-2 synchronized video + audio',
    artifactLabel: 'Immutable Diffusers video-and-audio repo',
    recommendedSteps: 40,
    recommendedGuidance: 4,
    recommendedFrames: 121,
    outputMedia: ['video', 'audio'],
    revisionCandidates: [LTX2_REVISION],
  },
  BuiltinImageOperation: {
    family: 'Built-in Media',
    surfaceCategory: 'Utility',
    catalogVisibility: 'workflowOnly',
    runtimeKind: 'builtin',
    isDiffusersBacked: false,
    defaultRepo: BUILTIN_IMAGE_OPERATION_REPO,
    artifactLabel: 'Versioned MoDiff built-in operation contract',
    artifactKind: 'builtin',
    artifactInstallRequired: false,
    defaultDtype: 'float32',
    defaultSize: { width: 1024, height: 1024, aspectRatio: '1:1' },
    offloadSupport: { modes: ['none'], default: 'none', lowVram: 'none', emergency: 'none' },
    recommendedSteps: 1,
    recommendedGuidance: 0,
    guidanceLabel: 'Not used',
    supportFlags: 5,
    supportsNegativePrompt: false,
    outputKind: 'image',
    lowVram: {
      dtype: 'float32',
      autoOffload: false,
      offloadMode: 'none',
      steps: 1,
      width: 1024,
      height: 1024,
    },
    modes: BUILTIN_IMAGE_OPERATION_MODES,
    modeRequirements: Object.fromEntries(
      BUILTIN_IMAGE_OPERATION_MODES.map((mode) => [mode, { requiredImages: ['referenceImages'] }]),
    ),
    executionStatus: 'supported',
    qualificationStatus: 'graph-qualified-execution-pending',
    qualifiedModes: [],
    autoEligible: false,
    templateEligible: true,
    galleryEligible: false,
    liveProof: false,
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
        surfaceCategory: 'Image',
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

const EXPERT_PENDING_MINIMUM = 'Expert-only pending live qualification.';
const ACCELERATOR_OFFLOAD_RECOMMENDATION = 'Use accelerator offload as needed.';
const LIVE_QUALIFICATION_PENDING = 'Live output and Gallery qualification pending.';

function pendingPlanningRequirement(modelType: StudioModelType): StudioAutoModelRequirementMetadata {
  const profile = STUDIO_MODEL_PROFILES[modelType];
  return {
    modelType,
    supportedModes: profile.modes,
    autoStatus: 'manual_only',
    minimum: 'Expert only.',
    recommended: 'Qualify remotely.',
    qualityDefaults: 'Graph defaults.',
    artifacts: [profile.defaultRepo],
    notes: 'No local proof.',
    manualOnlyReason: 'Qualification pending.',
  };
}

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
  QwenImageControlNetPipeline: /* @__PURE__ */ pendingPlanningRequirement('QwenImageControlNetPipeline'),
  QwenImageLayeredPipeline: /* @__PURE__ */ pendingPlanningRequirement('QwenImageLayeredPipeline'),
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
  Wan22Pipeline: /* @__PURE__ */ pendingPlanningRequirement('Wan22Pipeline'),
  WanAnimatePipeline: /* @__PURE__ */ pendingPlanningRequirement('WanAnimatePipeline'),
  WanImage2VideoModularPipeline: /* @__PURE__ */ pendingPlanningRequirement('WanImage2VideoModularPipeline'),
  LTXI2VLongMultiPromptPipeline: /* @__PURE__ */ pendingPlanningRequirement('LTXI2VLongMultiPromptPipeline'),
  LTX2ConditionPipeline: /* @__PURE__ */ pendingPlanningRequirement('LTX2ConditionPipeline'),
  HunyuanVideoFramepackPipeline: /* @__PURE__ */ pendingPlanningRequirement('HunyuanVideoFramepackPipeline'),
  StableVideoDiffusionPipeline: /* @__PURE__ */ pendingPlanningRequirement('StableVideoDiffusionPipeline'),
  AnimateDiffPipeline: /* @__PURE__ */ pendingPlanningRequirement('AnimateDiffPipeline'),
  AnimateDiffPAGPipeline: /* @__PURE__ */ pendingPlanningRequirement('AnimateDiffPAGPipeline'),
  AnimateDiffVideoToVideoPipeline: /* @__PURE__ */ pendingPlanningRequirement('AnimateDiffVideoToVideoPipeline'),
  AnimateDiffControlNetPipeline: /* @__PURE__ */ pendingPlanningRequirement('AnimateDiffControlNetPipeline'),
  AnimateDiffVideoToVideoControlNetPipeline: /* @__PURE__ */ pendingPlanningRequirement(
    'AnimateDiffVideoToVideoControlNetPipeline',
  ),
  AnimateLCMPipeline: /* @__PURE__ */ pendingPlanningRequirement('AnimateLCMPipeline'),
  CogVideoXPipeline: /* @__PURE__ */ pendingPlanningRequirement('CogVideoXPipeline'),
  CogVideoXVideoToVideoPipeline: /* @__PURE__ */ pendingPlanningRequirement('CogVideoXVideoToVideoPipeline'),
  AllegroPipeline: /* @__PURE__ */ pendingPlanningRequirement('AllegroPipeline'),
  LattePipeline: /* @__PURE__ */ pendingPlanningRequirement('LattePipeline'),
  MochiPipeline: /* @__PURE__ */ pendingPlanningRequirement('MochiPipeline'),
  SanaVideoPipeline: /* @__PURE__ */ pendingPlanningRequirement('SanaVideoPipeline'),
  SanaImageToVideoPipeline: /* @__PURE__ */ pendingPlanningRequirement('SanaImageToVideoPipeline'),
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
  StableAudioPipeline: {
    modelType: 'StableAudioPipeline',
    supportedModes: ['text_to_audio'],
    autoStatus: 'manual_only',
    minimum: 'Expert-only pending a measured Stable Audio runtime envelope.',
    recommended: 'Use a CUDA or MPS accelerator with model CPU offload when full residency is unavailable.',
    qualityDefaults: '30 seconds, 100 steps, guidance 7, one waveform.',
    artifacts: [STABLE_AUDIO_REPO],
    notes: 'Uses the generic Diffusers audio loader and generation nodes with a pinned model revision.',
    manualOnlyReason: 'Live resource and Gallery qualification pending.',
  },
  LongCatAudioDiTPipeline: /* @__PURE__ */ pendingPlanningRequirement('LongCatAudioDiTPipeline'),
  AudioLDM2Pipeline: /* @__PURE__ */ pendingPlanningRequirement('AudioLDM2Pipeline'),
  ShapEPipeline: /* @__PURE__ */ pendingPlanningRequirement('ShapEPipeline'),
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
    supportedModes: ['control_image', 'control_edit_image', 'control_inpaint'],
    autoStatus: 'manual_only',
    minimum: 'Expert only until control-image support is validated.',
    recommended: '24 GB or more VRAM or a proven quantized artifact.',
    qualityDefaults: '1024x1024, 50 steps, embedded guidance 30 with a user-supplied depth map.',
    artifacts: [FLUX_DEPTH_REPO],
    notes: 'Supports generation, source-image editing, and masked editing with a prepared depth control image.',
    manualOnlyReason: 'FLUX Depth control input mapping needs local proof.',
  },
  FluxCannyPipeline: {
    modelType: 'FluxCannyPipeline',
    supportedModes: ['control_image', 'control_edit_image', 'control_inpaint'],
    autoStatus: 'manual_only',
    minimum: 'Expert only until control-image support is validated.',
    recommended: '24 GB or more VRAM or a proven quantized artifact.',
    qualityDefaults: '1024x1024, 50 steps, embedded guidance 30 with a user-supplied Canny map.',
    artifacts: [FLUX_CANNY_REPO],
    notes: 'Supports generation, source-image editing, and masked editing with a prepared Canny control image.',
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
  StableDiffusionXLTurboPipeline: {
    modelType: 'StableDiffusionXLTurboPipeline',
    supportedModes: ['text_to_image'],
    autoStatus: 'manual_only',
    minimum: EXPERT_PENDING_MINIMUM,
    recommended: ACCELERATOR_OFFLOAD_RECOMMENDATION,
    qualityDefaults: '512x512, one to four steps, guidance 0.',
    artifacts: [SDXL_TURBO_REPO],
    notes: 'Pinned fp16 safetensors graph.',
    manualOnlyReason: LIVE_QUALIFICATION_PENDING,
  },
  StableDiffusionXLInstructPix2PixPipeline: {
    modelType: 'StableDiffusionXLInstructPix2PixPipeline',
    supportedModes: ['edit_image'],
    autoStatus: 'manual_only',
    minimum: EXPERT_PENDING_MINIMUM,
    recommended: ACCELERATOR_OFFLOAD_RECOMMENDATION,
    qualityDefaults: '768x768, 30 steps, text guidance 3, image guidance 1.5.',
    artifacts: [SDXL_INSTRUCT_PIX2PIX_REPO],
    notes: 'Pinned safetensors instruction-edit graph.',
    manualOnlyReason: LIVE_QUALIFICATION_PENDING,
  },
  StableDiffusionXLControlNetPipeline: {
    modelType: 'StableDiffusionXLControlNetPipeline',
    supportedModes: ['control_image', 'control_edit_image', 'control_inpaint'],
    autoStatus: 'manual_only',
    minimum: EXPERT_PENDING_MINIMUM,
    recommended: ACCELERATOR_OFFLOAD_RECOMMENDATION,
    qualityDefaults: '1024x1024, 50 steps, guidance 5, ControlNet scale 0.5.',
    artifacts: [SDXL_BASE_REPO, SDXL_CONTROLNET_CANNY_REPO],
    notes: 'Pinned fp16 base and Canny ControlNet generation, source-edit, and masked-edit graphs.',
    manualOnlyReason: LIVE_QUALIFICATION_PENDING,
  },
  HunyuanDiTPipeline: /* @__PURE__ */ pendingPlanningRequirement('HunyuanDiTPipeline'),
  HunyuanDiTPAGPipeline: /* @__PURE__ */ pendingPlanningRequirement('HunyuanDiTPAGPipeline'),
  HunyuanDiTControlNetPipeline: {
    modelType: 'HunyuanDiTControlNetPipeline',
    supportedModes: ['control_image'],
    autoStatus: 'manual_only',
    minimum: EXPERT_PENDING_MINIMUM,
    recommended: ACCELERATOR_OFFLOAD_RECOMMENDATION,
    qualityDefaults: '1024px, 50 steps, guidance 6, control 1.',
    artifacts: [HUNYUAN_DIT_DISTILLED_REPO, HUNYUAN_DIT_CONTROLNET_CANNY_REPO],
    notes: 'Pinned base and Canny graph; terms acknowledgement required.',
    manualOnlyReason: LIVE_QUALIFICATION_PENDING,
  },
  StableDiffusionXLAdapterPipeline: {
    modelType: 'StableDiffusionXLAdapterPipeline',
    supportedModes: ['control_image'],
    autoStatus: 'manual_only',
    minimum: EXPERT_PENDING_MINIMUM,
    recommended: ACCELERATOR_OFFLOAD_RECOMMENDATION,
    qualityDefaults: '1024x1024, 30 steps, guidance 7.5, adapter scale 0.8.',
    artifacts: [SDXL_BASE_REPO, SDXL_T2I_ADAPTER_CANNY_REPO],
    notes: 'Pinned fp16 base and Canny T2I-Adapter graph.',
    manualOnlyReason: LIVE_QUALIFICATION_PENDING,
  },
  StableDiffusionXLPAGPipeline: {
    modelType: 'StableDiffusionXLPAGPipeline',
    supportedModes: ['text_to_image', 'edit_image', 'inpaint', 'control_image', 'control_edit_image'],
    autoStatus: 'manual_only',
    minimum: EXPERT_PENDING_MINIMUM,
    recommended: ACCELERATOR_OFFLOAD_RECOMMENDATION,
    qualityDefaults: '1024x1024, 50 steps, guidance 5, strength 0.8, PAG scale 3, adaptive scale 0.',
    artifacts: [SDXL_BASE_REPO, SDXL_CONTROLNET_CANNY_REPO],
    notes: 'Text, edit, inpaint, ControlNet generation, and ControlNet source-edit graphs expose PAG controls.',
    manualOnlyReason: LIVE_QUALIFICATION_PENDING,
  },
  PixArtSigmaPipeline: /* @__PURE__ */ pendingPlanningRequirement('PixArtSigmaPipeline'),
  PixArtSigmaPAGPipeline: /* @__PURE__ */ pendingPlanningRequirement('PixArtSigmaPAGPipeline'),
  Kandinsky3Pipeline: /* @__PURE__ */ pendingPlanningRequirement('Kandinsky3Pipeline'),
  LongCatImagePipeline: /* @__PURE__ */ pendingPlanningRequirement('LongCatImagePipeline'),
  LongCatImageEditPipeline: /* @__PURE__ */ pendingPlanningRequirement('LongCatImageEditPipeline'),
  LuminaPipeline: /* @__PURE__ */ pendingPlanningRequirement('LuminaPipeline'),
  Lumina2Pipeline: /* @__PURE__ */ pendingPlanningRequirement('Lumina2Pipeline'),
  OmniGenPipeline: /* @__PURE__ */ pendingPlanningRequirement('OmniGenPipeline'),
  OvisImagePipeline: /* @__PURE__ */ pendingPlanningRequirement('OvisImagePipeline'),
  PRXPipeline: /* @__PURE__ */ pendingPlanningRequirement('PRXPipeline'),
  NucleusMoEImagePipeline: /* @__PURE__ */ pendingPlanningRequirement('NucleusMoEImagePipeline'),
  AuraFlowPipeline: /* @__PURE__ */ pendingPlanningRequirement('AuraFlowPipeline'),
  ChromaPipeline: /* @__PURE__ */ pendingPlanningRequirement('ChromaPipeline'),
  CogView3PlusPipeline: /* @__PURE__ */ pendingPlanningRequirement('CogView3PlusPipeline'),
  CogView4Pipeline: /* @__PURE__ */ pendingPlanningRequirement('CogView4Pipeline'),
  ErnieImagePipeline: /* @__PURE__ */ pendingPlanningRequirement('ErnieImagePipeline'),
  GlmImagePipeline: /* @__PURE__ */ pendingPlanningRequirement('GlmImagePipeline'),
  JoyImageEditPipeline: /* @__PURE__ */ pendingPlanningRequirement('JoyImageEditPipeline'),
  JoyImageEditPlusPipeline: /* @__PURE__ */ pendingPlanningRequirement('JoyImageEditPlusPipeline'),
  SanaPipeline: /* @__PURE__ */ pendingPlanningRequirement('SanaPipeline'),
  SanaPAGPipeline: /* @__PURE__ */ pendingPlanningRequirement('SanaPAGPipeline'),
  SanaSprintPipeline: /* @__PURE__ */ pendingPlanningRequirement('SanaSprintPipeline'),
  DreamLitePipeline: /* @__PURE__ */ pendingPlanningRequirement('DreamLitePipeline'),
  DreamLiteMobilePipeline: /* @__PURE__ */ pendingPlanningRequirement('DreamLiteMobilePipeline'),
  StableDiffusionPipeline: {
    modelType: 'StableDiffusionPipeline',
    supportedModes: [
      'text_to_image',
      'edit_image',
      'inpaint',
      'control_image',
      'control_edit_image',
      'control_inpaint',
    ],
    autoStatus: 'manual_only',
    minimum: 'CPU or accelerator execution with the pinned safetensors snapshot.',
    recommended: 'Use the reviewed 512px profile.',
    qualityDefaults: '512x512, 30 steps, guidance 7.5.',
    artifacts: [SD15_BASE_REPO, SD15_CONTROLNET_CANNY_REPO],
    notes:
      'Generic text, image edit, inpaint, and pinned Canny ControlNet generation/edit/inpaint graphs are available.',
    manualOnlyReason: 'Remote quality review and Gallery qualification pending.',
  },
  LatentConsistencyModelPipeline: {
    modelType: 'LatentConsistencyModelPipeline',
    supportedModes: ['text_to_image', 'edit_image'],
    autoStatus: 'manual_only',
    minimum: 'CPU or accelerator execution with the pinned safetensors snapshot.',
    recommended: 'Use the reviewed 512px one-to-four-step profile.',
    qualityDefaults: '512x512, 4 steps, guidance 8.5, image strength 0.8.',
    artifacts: [LCM_DREAMSHAPER_REPO],
    notes: 'The generic text-to-image and image-to-image graphs expose the checkpoint’s native recipe.',
    manualOnlyReason: 'Remote quality review and Gallery qualification pending.',
  },
  StableDiffusionPAGPipeline: {
    modelType: 'StableDiffusionPAGPipeline',
    supportedModes: ['text_to_image', 'edit_image', 'inpaint', 'control_image', 'control_inpaint'],
    autoStatus: 'manual_only',
    minimum: 'CPU or accelerator execution with the pinned safetensors snapshot.',
    recommended: 'Use the reviewed 512px profile with PAG scale 3.',
    qualityDefaults: '512x512, 30 steps, guidance 7.5, image strength 0.8, PAG scale 3.',
    artifacts: [SD15_BASE_REPO, SD15_CONTROLNET_CANNY_REPO],
    notes:
      'The generic text, image edit, inpaint, ControlNet generation, and ControlNet inpaint graphs expose PAG controls.',
    manualOnlyReason: 'Remote quality review and Gallery qualification pending.',
  },
  MarigoldDepthPipeline: {
    modelType: 'MarigoldDepthPipeline',
    supportedModes: ['depth_estimation'],
    autoStatus: 'manual_only',
    minimum: 'CPU or accelerator execution with the pinned safetensors snapshot.',
    recommended: 'Use one source image and the reviewed 768px one-step LCM profile.',
    qualityDefaults: 'One step, 768px internal processing, output matched to the source image.',
    artifacts: [MARIGOLD_DEPTH_LCM_REPO],
    notes: 'The generic prediction-map graph returns relative depth and a grayscale preview.',
    manualOnlyReason: 'The shared prediction-map contract and remote quality review are pending qualification.',
  },
  HuggingFaceTextGenerationModel: {
    modelType: 'HuggingFaceTextGenerationModel',
    supportedModes: TRANSFORMERS_TEXT_STUDIO_MODES,
    autoStatus: 'manual_only',
    minimum: 'CPU or accelerator execution with the pinned safetensors snapshot and optional Transformers runtime.',
    recommended: 'Use the reviewed SmolLM2 135M Instruct float32 profile with bounded token controls.',
    qualityDefaults: 'Deterministic generation, at most 256 new tokens.',
    artifacts: [SMOLLM2_135M_INSTRUCT_REPO],
    notes: 'The generic causal-LM graph returns bounded text and a versioned JSON receipt.',
    manualOnlyReason: 'App-only model installation, live output review, and Gallery qualification pending.',
  },
  HuggingFaceImageTextToTextModel: {
    modelType: 'HuggingFaceImageTextToTextModel',
    supportedModes: TRANSFORMERS_IMAGE_TEXT_STUDIO_MODES,
    autoStatus: 'manual_only',
    minimum: 'CPU or accelerator execution with the pinned safetensors snapshot and optional Transformers runtime.',
    recommended: 'Use the reviewed SmolVLM 256M Instruct float32 profile with one bounded local image.',
    qualityDefaults: 'One image, deterministic generation, at most 256 new tokens.',
    artifacts: [SMOLVLM_256M_INSTRUCT_REPO],
    notes: 'The generic image-to-text graph returns bounded text and a versioned JSON receipt.',
    manualOnlyReason: 'App-only model installation, live output review, and Gallery qualification pending.',
  },
  HuggingFaceAnyToAnyModel: {
    modelType: 'HuggingFaceAnyToAnyModel',
    supportedModes: TRANSFORMERS_ANY_TO_ANY_STUDIO_MODES,
    autoStatus: 'manual_only',
    minimum: 'Expert-only execution with the pinned safetensors snapshot and optional Transformers runtime.',
    recommended: 'Use the reviewed Janus Pro 1B bfloat16 profile after acknowledging the pinned model terms.',
    qualityDefaults: 'Bounded text generation or native 384x384 image generation.',
    artifacts: [JANUS_PRO_1B_REPO],
    notes: 'The generic any-to-any graph returns mode-specific versioned text or image output.',
    manualOnlyReason: 'License review, live output review, Auto, and Gallery qualification remain pending.',
  },
  HuggingFaceSpeechRecognitionModel: {
    modelType: 'HuggingFaceSpeechRecognitionModel',
    supportedModes: SPEECH_STUDIO_MODES,
    autoStatus: 'manual_only',
    minimum: 'CPU or accelerator execution with the pinned safetensors snapshot and optional Transformers runtime.',
    recommended: 'Use the reviewed Whisper Tiny float32 profile and bounded local audio.',
    qualityDefaults: '30-second chunks, 5-second stride, segment timestamps.',
    artifacts: [WHISPER_TINY_REPO],
    notes: 'The generic speech graph supports transcription and translation to English.',
    manualOnlyReason: 'Remote fixture review and Gallery qualification pending.',
  },
  DDPMPipeline: {
    modelType: 'DDPMPipeline',
    supportedModes: ['unconditional_image'],
    autoStatus: 'manual_only',
    minimum: 'CPU with the pinned snapshot.',
    recommended: 'Use the reviewed float32 profile.',
    qualityDefaults: '32x32, 1000 steps, batch 1.',
    artifacts: [DDPM_CIFAR10_REPO],
    notes: 'Bounded local execution passed.',
    manualOnlyReason: 'Remote output and Gallery qualification pending.',
  },
  DDIMPipeline: {
    modelType: 'DDIMPipeline',
    supportedModes: ['unconditional_image'],
    autoStatus: 'manual_only',
    minimum: 'CPU with the pinned snapshot.',
    recommended: 'Use the reviewed float32 profile.',
    qualityDefaults: '32x32, 50 steps, eta 0, batch 1.',
    artifacts: [DDPM_CIFAR10_REPO],
    notes: 'Bounded local execution passed.',
    manualOnlyReason: 'Remote output and Gallery qualification pending.',
  },
  ConsistencyModelPipeline: {
    modelType: 'ConsistencyModelPipeline',
    supportedModes: ['unconditional_image'],
    autoStatus: 'manual_only',
    minimum: 'CPU with the pinned snapshot.',
    recommended: 'Use the reviewed float32 profile.',
    qualityDefaults: '64x64, one step, optional class, batch 1.',
    artifacts: [CONSISTENCY_IMAGENET64_REPO],
    notes: 'Bounded local execution passed.',
    manualOnlyReason: 'Remote output and Gallery qualification pending.',
  },
  QwenImageEditPipeline: /* @__PURE__ */ pendingPlanningRequirement('QwenImageEditPipeline'),
  QwenImageEditPlusPipeline: /* @__PURE__ */ pendingPlanningRequirement('QwenImageEditPlusPipeline'),
  ZImageInpaintPipeline: /* @__PURE__ */ pendingPlanningRequirement('ZImageInpaintPipeline'),
  FluxKontextInpaintPipeline: /* @__PURE__ */ pendingPlanningRequirement('FluxKontextInpaintPipeline'),
  Flux2KleinInpaintPipeline: /* @__PURE__ */ pendingPlanningRequirement('Flux2KleinInpaintPipeline'),
  ChromaImg2ImgPipeline: /* @__PURE__ */ pendingPlanningRequirement('ChromaImg2ImgPipeline'),
  ChromaInpaintPipeline: /* @__PURE__ */ pendingPlanningRequirement('ChromaInpaintPipeline'),
  LTX2Pipeline: /* @__PURE__ */ pendingPlanningRequirement('LTX2Pipeline'),
  BuiltinImageOperation: {
    modelType: 'BuiltinImageOperation',
    supportedModes: BUILTIN_IMAGE_OPERATION_MODES,
    autoStatus: 'manual_only',
    minimum: 'Base MoDiff CPU runtime; no model installation is required.',
    recommended: 'Any supported CPU runtime.',
    qualityDefaults: 'Source-sized deterministic operation with bounded inputs.',
    artifacts: [],
    notes: 'Runs entirely through the versioned built-in image-operation contract.',
    manualOnlyReason: 'Use the Expert workflow surface to configure operation-specific controls.',
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
  if (profile.artifactInstallRequired === false) return 'Built-in · CPU · no model download';
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
  pagScale: 0,
  pagAdaptiveScale: 0,
  processingResolution: 768,
  matchInputResolution: true,
  batchSize: 1,
  eta: 0,
  classLabel: -1,
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
  speechLanguage: '',
  speechTimestamps: 'segment',
  speechChunkSeconds: 30,
  speechStrideSeconds: 5,
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
  if (mode === 'unconditional_image') {
    return 'DDPMPipeline';
  }
  if (mode === 'depth_estimation') {
    return 'MarigoldDepthPipeline';
  }
  if (TRANSFORMERS_TEXT_STUDIO_MODES.includes(mode)) {
    return 'HuggingFaceTextGenerationModel';
  }
  if (TRANSFORMERS_IMAGE_TEXT_STUDIO_MODES.includes(mode)) {
    return 'HuggingFaceImageTextToTextModel';
  }
  if (SPEECH_STUDIO_MODES.includes(mode)) {
    return 'HuggingFaceSpeechRecognitionModel';
  }
  if (THREE_D_STUDIO_MODES.includes(mode)) {
    return 'ShapEPipeline';
  }
  if (mode === 'control_video_to_video') {
    return 'AnimateDiffVideoToVideoControlNetPipeline';
  }
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

  if (mode === 'control_edit_image' || mode === 'control_inpaint') {
    return 'StableDiffusionPipeline';
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
    pagScale: profile.recommendedPagScale ?? DEFAULT_STUDIO_FORM.pagScale,
    pagAdaptiveScale: profile.recommendedPagAdaptiveScale ?? DEFAULT_STUDIO_FORM.pagAdaptiveScale,
    maxSequenceLength: profile.recommendedMaxSequenceLength ?? DEFAULT_STUDIO_FORM.maxSequenceLength,
    resourceMode: DEFAULT_STUDIO_FORM.resourceMode,
    strength: mode === 'outpaint' ? 0.85 : (profile.recommendedStrength ?? DEFAULT_STUDIO_FORM.strength),
    numFrames: profile.recommendedFrames ?? DEFAULT_STUDIO_FORM.numFrames,
    fps: profile.recommendedFps ?? DEFAULT_STUDIO_FORM.fps,
    conditioningScale: profile.conditioningScale ?? DEFAULT_STUDIO_FORM.conditioningScale,
    layers: profile.layerCount?.default ?? DEFAULT_STUDIO_FORM.layers,
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
