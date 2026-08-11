import type {
  StudioPreset,
  StudioTemplate,
  StudioTemplateExample,
  StudioTemplateIntentGroup,
  StudioTemplateLockedSettings,
  StudioTemplateMediaSlot,
  StudioTemplatePredictability,
  StudioTemplateReadinessPolicy,
  StudioTemplateWorkflowBlockSettings,
} from './types';
import {
  DEFAULT_STUDIO_FORM,
  QWEN_CONTROLNET_REQUIREMENT,
  QWEN_IMAGE_EDIT_INPAINT_CONTRACT,
  QWEN_LOW_VRAM_OFFLOAD_MODE,
  WAN_VACE_REPO,
  VIDEO_STUDIO_MODES,
} from './modelProfiles';
import {
  AUDIO_PROMPT_GUIDE,
  BASE_PROMPT_GUIDE,
  CONTROL_PROMPT_GUIDE,
  EDIT_PROMPT_GUIDE,
  LAYER_PROMPT_GUIDE,
  VIDEO_PROMPT_GUIDE,
} from './promptGuides';
import { templateDefaultInputBindings } from './generated/templateDefaultInputBindings';

// Editorial card posters keep every runnable template visually complete while
// model-generated video/audio evidence is still awaiting qualification. They
// are browsing artwork only: they never set outputPath, verificationStatus, or
// any proof/review field.
const TEMPLATE_CARD_POSTER_INDEXES = new Set([
  3, 29, 50, 51, 52, 53, 54, 55, 56, 57, 58, 31, 32, 33, 35, 36, 38, 39, 40, 42, 43, 44, 46, 47, 48, 71, 72, 73, 74, 75,
  76, 77, 78,
]);
const WEBP_CARD_POSTER_INDEXES = new Set([3, 29, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

const QWEN_EDIT_RUNTIME_ESTIMATE =
  'About 55-75 min cold on the qualified ROCm APU; about 24-28 min after the model is resident for 40-50 steps';
const QWEN_EDIT_RUNTIME_AFTER_INPUT =
  'About 55-75 min cold after inputs are prepared on the qualified ROCm APU; about 24-28 min after the model is resident';
const QWEN_IMAGE_RUNTIME_ESTIMATE =
  'About 45-50 min cold on the qualified ROCm APU; about 6-10 min after the model is resident for 40-50 steps';
const QWEN_AUTO_RUNTIME_ESTIMATE =
  'About 45-55 min cold on the qualified high-memory ROCm APU; about 7-10 min after the model is resident, longer with offload';
const QWEN_CONTROL_RUNTIME_ESTIMATE =
  'About 45-55 min cold on the qualified ROCm APU; about 4-6 min after the model is resident';
const QWEN_EDIT_2511_LIGHTNING_RUNTIME_ESTIMATE =
  'About 35-55 min cold on the qualified ROCm APU; about 3-5 min after the model is resident using the official four-step Lightning adapter';
const QWEN_NATIVE_MEMORY_ESTIMATE =
  '64 GB native BF16 on the qualified high-memory host; 16 GB-class prequantized/offloaded candidates require separate hardware qualification';
const ACE_STEP_MEMORY_ESTIMATE = '16 GB direct; Auto offloads on smaller supported GPUs';
const QWEN_EDIT_2511_LIGHTNING_LORA: NonNullable<StudioTemplateWorkflowBlockSettings['lora']> = {
  model: {
    source: 'hub',
    value: 'lightx2v/Qwen-Image-Edit-2511-Lightning',
    revision: 'd74eba145674fd7e31b949324e148e21e7118abd',
    sha256: '22226e8d05d354bb356627d428809f5afd7819399b077238a2b70a82883a904f',
    byteSize: 849608296,
    license: 'Apache-2.0',
  },
  weightName: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
  scale: 1,
  schedulerClass: 'FlowMatchEulerDiscreteScheduler',
  schedulerConfig: {
    base_image_seq_len: 256,
    base_shift: 1.0986122886681098,
    invert_sigmas: false,
    max_image_seq_len: 8192,
    max_shift: 1.0986122886681098,
    num_train_timesteps: 1000,
    shift: 1,
    shift_terminal: null,
    stochastic_sampling: false,
    time_shift_type: 'exponential',
    use_beta_sigmas: false,
    use_dynamic_shifting: true,
    use_exponential_sigmas: false,
    use_karras_sigmas: false,
  },
};
const FLUX_THEME_LORAS = {
  cinematicOctane3d: {
    model: {
      source: 'hub' as const,
      value: 'aixonlab/FLUX.1-dev-LoRA-Cinematic-Octane',
      revision: '3ab70503ba8df37565d0212e2876ec48e35e7cb4',
      sha256: 'cad317378978ba03438c9f00a4fa5ef0628c4a65937c69b8420feaee5e780f81',
      byteSize: 171969432,
      license: 'FLUX.1-dev non-commercial',
    },
    weightName: 'cinematic-octane.safetensors',
    adapterName: 'cinematic_octane',
    scale: 0.8,
    additionalAdapters: [
      {
        model: {
          source: 'hub' as const,
          value: 'prithivMLmods/3D-Render-Flux-LoRA',
          revision: '6b32a1624d3fdfab4d518223e8311731dd432cd8',
          sha256: '64e2788c9d236a3e5f62323baa8853116e2a9c7df41cd2a048141eb22cd46d89',
          byteSize: 612747200,
          license: 'CreativeML OpenRAIL-M adapter; FLUX.1-dev base non-commercial',
        },
        weightName: '3D_Portrait.safetensors',
        adapterName: 'render_3d',
        scale: 0.18,
      },
    ],
  },
  ghibli: {
    model: {
      source: 'hub' as const,
      value: 'alvarobartt/ghibli-characters-flux-lora',
      revision: 'ed846114c71efc525e7f5a51e274dc976bb970a8',
      sha256: '5216bd7eeb12bf6f18cd5d40cb090831796b28aca7446577d08c5a7e4a09dc63',
      byteSize: 171969336,
      license: 'flux-1-dev-non-commercial; personal-use-only',
    },
    weightName: 'ghibli-characters-flux-lora.safetensors',
    adapterName: 'ghibli_style',
    scale: 0.8,
  },
  oilPainting: {
    model: {
      source: 'hub' as const,
      value: 'dtthanh/flux_oil_painting_lora',
      revision: '1118ed195c7304ffc52a6cd42b41a520ef749cd9',
      sha256: '6de4e6d451ad7690db7185cf84235bf9c15c80aaeb69793fb6647fab62bdd704',
      byteSize: 38421064,
      license: 'apache-2.0 adapter; FLUX.1-dev base non-commercial',
    },
    weightName: 'flux-oilpainting1.3-00001.safetensors',
    adapterName: 'oil_painting',
    scale: 0.85,
  },
  filmNoir: {
    model: {
      source: 'hub' as const,
      value: 'dvyio/flux-lora-film-noir',
      revision: '7a7ff13bbae807a2db6c2e4918f3e13bb1265e60',
      sha256: '2970393ce5376e982a594808c1ff0a87f9cec5ddc0da2c094d2a4305d4079324',
      byteSize: 172070512,
      license: 'flux-1-dev-non-commercial',
    },
    weightName: '5ee2c3c6409f4618a134b883da64d04e_pytorch_lora_weights.safetensors',
    adapterName: 'film_noir',
    scale: 1,
  },
  retroComic: {
    model: {
      source: 'hub' as const,
      value: 'renderartist/retrocomicflux',
      revision: '46f73222df6c97c9f56c3bef42a11979ba5d5aeb',
      sha256: 'af31beee9ea67955d36425f25624d2585fa31271680013e5c9731690aeb78f9d',
      byteSize: 229879376,
      license: 'creativeml-openrail-m adapter; FLUX.1-dev base non-commercial',
    },
    weightName: 'Retro_Comic_Flux_v2_renderartist.safetensors',
    adapterName: 'retro_comic',
    scale: 0.9,
  },
  watercolor: {
    model: {
      source: 'hub' as const,
      value: 'SebastianBodza/Flux_Aquarell_Watercolor_v2',
      revision: 'a565b2140a05f1eece244514f90d2e29b3b1d45d',
      sha256: 'e63e44417df35456f425329ad4334143a8bc9fd10316345730ade434106b050e',
      byteSize: 171969424,
      license: 'flux-1-dev-non-commercial',
    },
    weightName: 'lora.safetensors',
    adapterName: 'watercolor',
    scale: 0.9,
  },
  paperCutout: {
    model: {
      source: 'hub' as const,
      value: 'Norod78/Flux_1_Dev_LoRA_Paper-Cutout-Style',
      revision: '5cdd7ac47ad1b99f705ac2a03a39d480d34abb5d',
      sha256: '1863f382199698b8b756d98ecd8060698d5928ed30009cd16f0531f142e4057b',
      byteSize: 171969408,
      license: 'FLUX.1-dev terms',
    },
    weightName: 'Flux_1_Dev_LoRA_Paper-Cutout-Style.safetensors',
    adapterName: 'paper_cutout',
    scale: 0.9,
  },
  photoreal: {
    model: {
      source: 'hub' as const,
      value: 'XLabs-AI/flux-RealismLora',
      revision: '1965e17d2e745fcbf8f4004bdbdf603421ef37a8',
      sha256: '0a83a924b822b70b5e458d27935ebfa7713edaee04ff9f194209525354031eca',
      byteSize: 22431400,
      license: 'flux-1-dev-non-commercial',
    },
    weightName: 'lora.safetensors',
    adapterName: 'photoreal',
    scale: 0.85,
  },
} satisfies Record<string, NonNullable<StudioTemplateWorkflowBlockSettings['lora']>>;
const ACE_STEP_CNY_LORA: NonNullable<StudioTemplateWorkflowBlockSettings['lora']> = {
  baseModel: {
    source: 'hub',
    value: 'Runware/acestep-v15-turbo-diffusers',
    revision: 'be23effe449c5957947f3020fd63bee23c64abe4',
  },
  model: {
    source: 'hub',
    value: 'ACE-Step/ACE-Step-v1.5-chinese-new-year-LoRA',
    revision: 'cb829a12775740c830a6d49795f16913065dc492',
    sha256: '78650245c79cbfda7169eae34eb2ccb5f5e639b31a99da0a153a5bbd74194b0d',
    byteSize: 88100000,
    license: 'CreativeML OpenRAIL-M metadata; model card limits use to research/academic and prohibits commercial use',
  },
  weightName: 'adapter_model.safetensors',
  adapterName: 'chinese_new_year',
  scale: 0.5,
};
const ACE_STEP_CUSTOM_LORA: NonNullable<StudioTemplateWorkflowBlockSettings['lora']> = {
  baseModel: {
    source: 'hub',
    value: 'Runware/acestep-v15-turbo-diffusers',
    revision: 'be23effe449c5957947f3020fd63bee23c64abe4',
  },
  model: {
    source: 'local',
    value: 'loras/ace-step/my-style',
  },
  weightName: 'adapter_model.safetensors',
  adapterName: 'my_style',
  scale: 0.7,
};
const VIDEO_DELIVERY_UPSCALER: NonNullable<StudioTemplateWorkflowBlockSettings['upscaler']> = {
  model: {
    source: 'hub',
    value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
    revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
    sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
    byteSize: 67061725,
    license: 'bsd-3-clause',
  },
  downscale: 1,
};
const QWEN_EDIT_2511_LIGHTNING_EXAMPLE_SETTINGS = {
  width: 1024,
  height: 1024,
  steps: 4,
  guidanceScale: 1,
  resourceMode: 'expert' as const,
  dtype: 'bfloat16' as const,
  quantizationMode: 'none' as const,
  autoOffload: false,
  offloadMode: 'none' as const,
};

export const STUDIO_PRESETS: StudioPreset[] = [
  {
    id: 'fast',
    label: 'Z-Image turbo',
    description:
      'Native eight-step Z-Image Turbo preview; speed comes from the model recipe, not an arbitrary quality cut.',
    compatibleModes: ['text_to_image'],
    compatibleModelTypes: ['ZImageModularPipeline'],
    values: { steps: 8, guidanceScale: 1, randomSeed: true },
  },
  {
    id: 'balanced',
    label: 'Qwen balanced',
    description: 'Forty-step Qwen generation/edit preview using the model-family true-CFG recipe.',
    compatibleModes: [
      'text_to_image',
      'edit_image',
      'multi_image_reference_edit',
      'inpaint',
      'outpaint',
      'control_image',
      'layer_decomposition',
    ],
    compatibleModelTypes: [
      'QwenImageModularPipeline',
      'QwenImageEditModularPipeline',
      'QwenImageEditPlusModularPipeline',
      'QwenImageLayeredModularPipeline',
    ],
    values: { steps: 40, guidanceScale: 4, randomSeed: true },
  },
  {
    id: 'quality',
    label: 'Qwen quality',
    description: 'Native fifty-step Qwen quality recipe for final candidates; keep the seed fixed for comparisons.',
    compatibleModes: [
      'text_to_image',
      'edit_image',
      'multi_image_reference_edit',
      'inpaint',
      'outpaint',
      'control_image',
      'layer_decomposition',
    ],
    compatibleModelTypes: [
      'QwenImageModularPipeline',
      'QwenImageEditModularPipeline',
      'QwenImageEditPlusModularPipeline',
      'QwenImageLayeredModularPipeline',
    ],
    values: { steps: 50, guidanceScale: 4, randomSeed: false },
  },
  {
    id: 'text_accuracy',
    label: 'Qwen text accuracy',
    description:
      'Native Qwen quality sampling with a fixed seed; prompt structure and short exact copy drive text accuracy.',
    compatibleModes: ['text_to_image', 'multi_image_reference_edit', 'control_image'],
    compatibleModelTypes: ['QwenImageModularPipeline', 'QwenImageEditPlusModularPipeline'],
    values: { steps: 50, guidanceScale: 4, randomSeed: false },
  },
  {
    id: 'low_vram',
    label: 'Auto plan',
    description: 'Auto chooses the best local settings for this hardware.',
    values: { resourceMode: 'auto', dtype: 'bfloat16', autoOffload: true, offloadMode: 'model_cpu' },
  },
  {
    id: 'video_preview',
    label: 'Video preview',
    description: 'Short 16fps Wan run for quick motion checks.',
    compatibleModes: VIDEO_STUDIO_MODES,
    compatibleModelTypes: ['WanVACEPipeline', 'WanVideoPipeline'],
    values: {
      width: 832,
      height: 480,
      aspectRatio: '16:9',
      numFrames: 49,
      fps: 16,
      steps: 24,
      guidanceScale: 5,
      conditioningScale: 1,
      dtype: 'bfloat16',
      autoOffload: true,
      randomSeed: true,
    },
  },
  {
    id: 'video_balanced',
    label: 'Video balanced',
    description: '16GB-safe default for Wan 480p clips.',
    compatibleModes: VIDEO_STUDIO_MODES,
    compatibleModelTypes: ['WanVACEPipeline', 'WanVideoPipeline'],
    values: {
      width: 832,
      height: 480,
      aspectRatio: '16:9',
      numFrames: 161,
      fps: 16,
      steps: 30,
      guidanceScale: 5,
      conditioningScale: 1,
      dtype: 'bfloat16',
      autoOffload: true,
      randomSeed: true,
    },
  },
  {
    id: 'ltx_video_balanced',
    label: 'LTX balanced',
    description: 'Official Diffusers LTX baseline with the 8n+1 frame contract.',
    compatibleModes: ['text_to_video', 'image_to_video', 'video_to_video', 'reference_to_video'],
    compatibleModelTypes: ['LTXVideoPipeline'],
    values: {
      width: 704,
      height: 480,
      aspectRatio: 'custom',
      numFrames: 161,
      fps: 16,
      steps: 8,
      guidanceScale: 1,
      conditioningScale: 1,
      dtype: 'bfloat16',
      autoOffload: true,
      randomSeed: true,
    },
  },
  {
    id: 'video_quality',
    label: 'Video quality',
    description: 'More steps for final Wan candidates.',
    compatibleModes: VIDEO_STUDIO_MODES,
    compatibleModelTypes: ['WanVACEPipeline', 'WanVideoPipeline'],
    values: {
      width: 832,
      height: 480,
      aspectRatio: '16:9',
      numFrames: 161,
      fps: 16,
      steps: 50,
      guidanceScale: 5,
      conditioningScale: 1,
      dtype: 'bfloat16',
      autoOffload: true,
      randomSeed: false,
    },
  },
  {
    id: 'wan_i2v_quality',
    label: 'Wan 2.2 I2V quality',
    description: 'Official five-second Wan 2.2 A14B I2V dimensions and two-expert guidance.',
    compatibleModes: ['image_to_video'],
    compatibleModelTypes: ['WanImageToVideoPipeline'],
    values: {
      width: 832,
      height: 480,
      aspectRatio: '16:9',
      numFrames: 81,
      fps: 16,
      steps: 40,
      guidanceScale: 3.5,
      guidanceScale2: 3.5,
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'model_cpu',
      randomSeed: false,
    },
  },
  {
    id: 'wan_t2v_13b_quality',
    label: 'Wan 2.1 T2V 1.3B qualified quality',
    description: 'Mechanically qualified five-second 480p Wan 2.1 contract for constrained local hardware.',
    compatibleModes: ['text_to_video'],
    compatibleModelTypes: ['WanVideoPipeline'],
    values: {
      width: 832,
      height: 480,
      aspectRatio: '16:9',
      numFrames: 81,
      fps: 15,
      steps: 50,
      guidanceScale: 6,
      shift: 8,
      dtype: 'bfloat16',
      autoOffload: false,
      offloadMode: 'none',
      randomSeed: false,
    },
  },
  {
    id: 'wan_ti2v_quality',
    label: 'Wan 2.2 TI2V 5B Diffusers quality',
    description: 'Official Diffusers five-second 720p/24fps Wan 2.2 TI2V 5B contract.',
    compatibleModes: ['text_to_video'],
    compatibleModelTypes: ['WanTI2VPipeline'],
    values: {
      width: 1280,
      height: 704,
      aspectRatio: '16:9',
      numFrames: 121,
      fps: 24,
      steps: 50,
      guidanceScale: 5,
      shift: 8,
      dtype: 'bfloat16',
      autoOffload: false,
      offloadMode: 'none',
      randomSeed: false,
    },
  },
  {
    id: 'video_low_vram',
    label: 'Video auto-safe',
    description: 'Shorter Wan settings while Auto chooses the local resource plan.',
    compatibleModes: VIDEO_STUDIO_MODES,
    compatibleModelTypes: ['WanVACEPipeline', 'WanVideoPipeline'],
    values: {
      width: 832,
      height: 480,
      aspectRatio: '16:9',
      numFrames: 49,
      fps: 16,
      steps: 22,
      guidanceScale: 4.5,
      conditioningScale: 1,
      resourceMode: 'auto',
      dtype: 'bfloat16',
      autoOffload: true,
      randomSeed: true,
    },
  },
  {
    id: 'portrait_video',
    label: 'Portrait video',
    description: 'Vertical Wan clip settings.',
    compatibleModes: VIDEO_STUDIO_MODES,
    compatibleModelTypes: ['WanVACEPipeline', 'WanVideoPipeline'],
    values: {
      width: 480,
      height: 832,
      aspectRatio: '9:16',
      numFrames: 161,
      fps: 16,
      steps: 30,
      guidanceScale: 5,
      conditioningScale: 1,
      dtype: 'bfloat16',
      autoOffload: true,
    },
  },
  {
    id: 'color_preserve_edit',
    label: 'Color preserve edit',
    description: 'Conservative source-video color edit with stronger conditioning.',
    compatibleModes: ['video_color_edit', 'video_to_video'],
    compatibleModelTypes: ['WanVideoPipeline'],
    values: {
      width: 832,
      height: 480,
      aspectRatio: '16:9',
      numFrames: 161,
      fps: 16,
      steps: 30,
      guidanceScale: 4.5,
      conditioningScale: 1.25,
      strength: 0.25,
      dtype: 'bfloat16',
      autoOffload: true,
      randomSeed: false,
    },
  },
  {
    id: 'audio_fast',
    label: 'ACE short preview',
    description: 'Short ACE-Step v1.5 Turbo render for prompt, lyric-density, and ending checks.',
    compatibleModes: ['text_to_audio', 'audio_variation', 'audio_continuation', 'audio_repaint'],
    compatibleModelTypes: ['AceStepAudioPipeline'],
    values: {
      audioDuration: 20,
      extensionDuration: 10,
      steps: 8,
      guidanceScale: 1,
      shift: 3,
      resourceMode: 'auto',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'model_cpu',
      randomSeed: true,
    },
  },
  {
    id: 'audio_balanced',
    label: 'ACE production',
    description: 'ACE-Step v1.5 XL Turbo native eight-step, guidance-distilled production recipe.',
    compatibleModes: ['text_to_audio', 'audio_variation', 'audio_continuation', 'audio_repaint'],
    compatibleModelTypes: ['AceStepAudioPipeline'],
    values: {
      audioDuration: 30,
      extensionDuration: 15,
      steps: 8,
      guidanceScale: 1,
      shift: 3,
      resourceMode: 'auto',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'model_cpu',
      randomSeed: true,
    },
  },
  {
    id: 'audio_continuation',
    label: 'Audio continue',
    description: 'Continuation settings with a short generated tail.',
    compatibleModes: ['audio_continuation'],
    compatibleModelTypes: ['AceStepAudioPipeline'],
    values: {
      extensionDuration: 15,
      steps: 8,
      guidanceScale: 1,
      shift: 3,
      resourceMode: 'auto',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'model_cpu',
    },
  },
  {
    id: 'audio_variation',
    label: 'Audio variation',
    description: 'Cover/variation settings that keep more of the source feel.',
    compatibleModes: ['audio_variation'],
    compatibleModelTypes: ['AceStepAudioPipeline'],
    values: {
      audioCoverStrength: 0.75,
      audioDuration: 30,
      steps: 8,
      guidanceScale: 1,
      shift: 3,
      resourceMode: 'auto',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'model_cpu',
    },
  },
  {
    id: 'flux_fast',
    label: 'FLUX fast',
    description: 'FLUX.1-schnell low-step recipe for 16GB VRAM.',
    compatibleModes: ['text_to_image'],
    compatibleModelTypes: ['FluxSchnellPipeline'],
    values: {
      width: 1024,
      height: 1024,
      aspectRatio: '1:1',
      steps: 4,
      guidanceScale: 0,
      resourceMode: 'auto',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'model_cpu',
      randomSeed: true,
    },
  },
  {
    id: 'flux_quality',
    label: 'FLUX Dev quality',
    description: 'Native FLUX Dev sampling recipe for final text-to-image candidates.',
    compatibleModes: ['text_to_image'],
    compatibleModelTypes: ['FluxDevPipeline', 'FluxKreaPipeline'],
    values: {
      width: 1024,
      height: 1024,
      aspectRatio: '1:1',
      steps: 28,
      guidanceScale: 3.5,
      resourceMode: 'expert',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'group_cpu',
      randomSeed: true,
    },
  },
  {
    id: 'flux_kontext',
    label: 'FLUX Kontext edit',
    description:
      'Native Kontext edit recipe; negative text stays inactive until true CFG is exposed by the graph contract.',
    compatibleModes: ['edit_image'],
    compatibleModelTypes: ['FluxKontextPipeline'],
    values: {
      width: 1024,
      height: 1024,
      aspectRatio: '1:1',
      steps: 28,
      guidanceScale: 3.5,
      strength: 1,
      resourceMode: 'expert',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'group_cpu',
      randomSeed: true,
    },
  },
  {
    id: 'flux_fill',
    label: 'FLUX Fill quality',
    description: 'Native FLUX Fill recipe with full masked-region denoising and embedded guidance 30.',
    compatibleModes: ['inpaint'],
    compatibleModelTypes: ['FluxFillPipeline'],
    values: {
      width: 1024,
      height: 1024,
      aspectRatio: '1:1',
      steps: 50,
      guidanceScale: 30,
      strength: 1,
      resourceMode: 'expert',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'group_cpu',
      randomSeed: true,
    },
  },
  {
    id: 'flux_control',
    label: 'FLUX structural control',
    description:
      'Installed Diffusers FLUX Control quality recipe; the control image carries geometry while the prompt directs appearance.',
    compatibleModes: ['control_image'],
    compatibleModelTypes: ['FluxDepthPipeline', 'FluxCannyPipeline'],
    values: {
      width: 1024,
      height: 1024,
      aspectRatio: '1:1',
      steps: 50,
      guidanceScale: 30,
      resourceMode: 'expert',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'group_cpu',
      randomSeed: true,
    },
  },
];

function example(
  seed: number,
  runtimeEstimate: string,
  settings: Partial<StudioTemplateLockedSettings> = {},
): StudioTemplateExample {
  return {
    mediaType: 'image',
    status: 'unverified',
    lockedSeed: seed,
    lockedSettings: {
      width: 1024,
      height: 1024,
      randomSeed: false,
      ...settings,
    },
    expectedOutput: {
      width: settings.width ?? 1024,
      height: settings.height ?? 1024,
    },
    modelRevision: 'pin-required',
    runtimeEstimate,
    notes: 'Exact status requires two clean harness runs with matching decoded media hashes.',
  };
}

function videoExample(
  seed: number,
  runtimeEstimate: string,
  settings: Partial<StudioTemplateLockedSettings> = {},
  expectedOutput: Partial<NonNullable<StudioTemplateExample['expectedOutput']>> = {},
): StudioTemplateExample {
  return {
    mediaType: 'video',
    status: 'unverified',
    lockedSeed: seed,
    lockedSettings: {
      width: 832,
      height: 480,
      randomSeed: false,
      numFrames: 161,
      fps: 16,
      conditioningScale: 1,
      guidanceScale2: 0,
      outputType: 'pil',
      maxSequenceLength: 512,
      attentionKwargsJson: '',
      ...settings,
    },
    expectedOutput: {
      width: settings.width ?? 832,
      height: settings.height ?? 480,
      frames: settings.numFrames ?? 81,
      durationSeconds: Number(((settings.numFrames ?? 81) / (settings.fps ?? 16)).toFixed(2)),
      minimumMotionCoverage: 0.5,
      minimumAdjacentMotionCoverage: 0.08,
      minimumEndToEndMotionCoverage: 0.45,
      minimumActiveMotionWindowRatio: 0.8,
      minimumStrongMotionWindowRatio: 0.65,
      maximumLowMotionFrameRatio: 0.2,
      motionReviewProfile: 'global_camera',
      ...expectedOutput,
    },
    modelRevision: 'pin-required',
    runtimeEstimate,
    notes: 'Exact status requires clean app-run video proofs with matching decoded frame hashes and motion review.',
  };
}

function nonExactExample(
  seed: number,
  runtimeEstimate: string,
  notes: string,
  settings: Partial<StudioTemplateLockedSettings> = {},
): StudioTemplateExample {
  return {
    ...example(seed, runtimeEstimate, settings),
    status: 'non_exact',
    notes,
  };
}

function predictability(seed: number): StudioTemplatePredictability {
  return {
    lockReason: 'Prompt, model, seed, size, steps, guidance, dtype, and runtime fingerprint must stay unchanged.',
    exactnessNotes: [
      'Exact means decoded pixels, frames, or audio PCM match the stored hash.',
      'Changing the prompt or any locked setting makes the shown example modified.',
      'A manifest entry is required before this template can display an Exact badge.',
    ],
    deterministicSettings: {
      seed,
      randomSeed: false,
    },
  };
}

function videoPredictability(seed: number): StudioTemplatePredictability {
  const base = predictability(seed);
  return {
    ...base,
    lockReason:
      'Prompt, model, seed, size, steps, guidance, frame count, fps, conditioning scale, media hashes, and runtime fingerprint must stay unchanged.',
    requiredModels: [
      {
        id: 'wan-vace-1.3b',
        label: 'Wan VACE 1.3B',
        repo: WAN_VACE_REPO,
        kind: 'base',
        requiredForModes: VIDEO_STUDIO_MODES,
        description: 'Required for Wan VACE video generation and editing templates.',
      },
    ],
    exactnessNotes: [
      ...base.exactnessNotes,
      'Source video, mask video, control video, and reference image decoded hashes are part of the video exactness lock when present.',
      'Frame count, fps, conditioning scale, output type, model revision, and runtime fingerprint must match before Exact can be shown.',
    ],
  };
}

const CONTACT_SHEET_PROMPT =
  'Output one landscape 2x2 cinematic storyboard sheet with exactly four widescreen frames separated only by narrow black gutters; include no title, labels, captions, numbers, or interface marks. Story continuity: the same covert operative in a tailored black suit and concealed earpiece crosses a luxury midnight gala inside one marble mansion under warm golden chandeliers. Preserve the same face, hair, suit, lighting, architecture, and tense elegant mood in all four frames. Frame one, upper left: low-angle wide entrance with the operative crossing the marble floor and guests in the foreground. Frame two, upper right: close over-shoulder view at the champagne bar with a security guard reflected in a mirror. Frame three, lower left: tight profile close-up of the earpiece and watchful eyes behind a foreground glass. Frame four, lower right: long symmetrical hallway exit with dramatic vanishing lines and the operative moving away. Each frame must be a genuinely different camera distance, angle, pose, and story beat while remaining a clean premium 16:9 movie still. Keep the four cells aligned, equally sized, sharp, and readable at thumbnail scale.';

const PRODUCT_AD_PROMPT =
  'Create one premium magazine advertisement by combining the two supplied references. Input 1 defines the restrained editorial grid, generous warm-white margins and disciplined typography hierarchy. Input 2 defines the immutable ASTERMIST lavender sleep-spray bottle. Build a believable bedside ritual context: place exactly one ASTERMIST bottle at normal cosmetic scale on a honed limestone nightstand beside one folded linen eye mask and a small dried-lavender stem. A softly blurred bed and dawn window belong to the same quiet room; every object rests on the same physical surface with coherent perspective, contact shadows and window light. Preserve the bottle’s pale-lavender glass, liquid level, dip tube, satin-silver atomizer, clear cap and rectangular label. Keep both exact label lines readable: “ASTERMIST” and “LAVENDER SLEEP SPRAY”. Do not enlarge it into architecture, a sculpture or a surreal monument. Use Input 1 only for layout discipline. Add exactly one clean headline in the upper negative space: “NIGHT RITUAL”. Include no other campaign copy. Use black editorial type, warm stone, muted lavender and natural blue dawn light with realistic glass refraction and premium photographic grain. The output must read as one real-location commercial photograph, not a pasted packshot or fantasy composite: matching scale, lens, light direction, color spill, focus falloff and surface contact, with no collage edge, halo, floating product, unrelated scenery or arbitrary object replacement.';

const PRODUCT_RELIGHT_PROMPT =
  'Create one high-end fragrance campaign photograph from two references. Input 1 is the immutable blue-hour mineral-spa vanity scene; Input 2 is the immutable ASTERMIST lavender sleep spray. Preserve Input 1’s square crop, long honed-limestone counter, carved basin and brass faucet at left, empty counter area at lower right, lime-plaster wall, coastal window, linen shelf, eucalyptus niche, camera height, cool window key and restrained warm shelf light. Do not move the basin, faucet, window, shelf or counter, and do not turn the scene into a studio backdrop. Place exactly one ASTERMIST bottle upright on the existing empty lower-right limestone counter, occupying between twenty-five and thirty percent of the image height. Its complete base must touch that original horizontal counter plane directly. Do not add a pedestal, plinth, block, shelf or raised display surface. Preserve its cylindrical lavender glass body, visible liquid level, internal dip tube, silver collar, clear cap, spray nozzle, label proportions and the exact readable two-line copy "ASTERMIST" and "LAVENDER SLEEP SPRAY". Do not float, crop, duplicate or redesign it. Relight the transparent bottle from the room: cool window fill through the lavender liquid, one restrained warm edge from the shelf light, physically plausible wall thickness and refraction, and a soft contact shadow across the porous limestone. Keep controlled label glare that leaves both lines readable. The matte counter must never mirror the bottle or label text. Match the source lens, focus falloff, grain, color response and low-contrast blue-hour atmosphere. The result must read as a real location campaign photographed in one exposure, not a pasted packshot: coherent scale, perspective, contact, refraction and color spill, with no collage edge, halo, contradictory shadow, synthetic glow, random text, extra packaging or altered background.';

const PACKAGING_DIELINE_PROMPT =
  'Objective: turn the supplied dieline or structural control image into a premium retail package for the fictional traditional-pigment maker "TIDELINE MINERAL PIGMENTS" while keeping the control geometry authoritative. Structural contract: preserve every panel boundary, fold and cut direction, glue flap, product-window position, handle or tab, label-safe zone, front/side hierarchy, and dominant outer silhouette. Do not move folds to accommodate decoration. Graphic system: use unbleached warm-gray paperboard, deep indigo block printing, one restrained oxidized-copper foil line, a clear exact front-panel title "TIDELINE MINERAL PIGMENTS", and the smaller exact line "COASTAL SET 06". Add a sparse hand-drawn mineral strata diagram and compact pigment-safety icons; avoid the yellow technical-grid visual language used by the separate layout-control template. Material and camera: show one assembled, manufacturable carton standing on a pigment-stained oak workbench in a working ceramics studio, with subtle paper tooth, accurate creases, clean die-cut edges, slight edge wear, soft north-window key light, white-card fill, grounded shadow, eye-level three-quarter package view, and crisp focus across the front plane. Include restrained background evidence of the craft—two ceramic test tiles, a stone mortar, and folded linen—without obscuring the package. Output contract: one manufacturable-looking package mockup with straight typography, consistent print registration, intact folds, no melted corners, no impossible window, and no decoration crossing structural seams unintentionally.';

const CHARACTER_ANGLES_PROMPT =
  'Create a 2x2 character turnaround contact sheet from the source character image. Preserve the character identity, face shape, hair, outfit materials, color palette, age, body proportions, and core silhouette. Render four clean views in one image: front close portrait, three-quarter view, low-angle hero view, and wide full-body view. Keep lighting, background style, and rendering quality consistent across all four panels. Do not change the character into a different person. No labels, no panel borders, no captions.';

const TILE_EXTRACT_PROMPT =
  'Look at the uploaded contact sheet image. Focus only on the selected tile or the strongest cinematic frame if no tile is explicitly marked. Recreate that single tile as a standalone full-frame high-resolution image. Match the subject, pose, composition, camera angle, lighting direction, color palette, mood, background geometry, and visual style as closely as possible. Do not include the rest of the grid, borders, labels, captions, UI, or neighboring tiles.';

const LOGO_TEXTURE_PROMPT =
  'Create one photorealistic architectural monogram using two references with strict roles. Input 1 defines the immutable centered modular M silhouette, proportions, three vertical legs, two diagonal joins, negative counters and square margins. Input 2 defines only the deep forest-green bookmatched marble, sparse pale veins, honed reflectivity and narrow aged-satin-brass bevel. Preserve Input 1’s exact outer contour, central V notch, lower counters, baseline and symmetry. Fill only the face of the M with the forest-green marble from Input 2, align one quiet bookmatch seam through its center, and wrap the complete outer and inner perimeter with one narrow continuous aged-brass bevel. Do not convert the M into another letter, add a duplicate outline, close either counter or thicken one leg differently. Mount the finished M flush on one warm off-white lime-plaster wall under soft raking daylight from upper left. Use realistic stone depth, sparse veins that continue across joins, fine brass grain, a restrained contact shadow and subtle photographic falloff. Output one premium architectural identity photograph with no word, caption, extra letter, icon, screw, cable, cobalt blue, chrome, enamel, neon, frame or decorative clutter.';

const LAYERED_PORTRAIT_PROMPT =
  'Decompose the supplied image into three ordered editable RGBA layers while faithfully preserving the complete photographed content. Overall image description: at blue hour on an alpine observatory deck, one adult woman astronomer in a navy field jacket and charcoal trousers stands center-right with both empty hands relaxed beside her body. One physically separate brass-and-matte-black refractor telescope on a complete three-leg tripod occupies the lower-left foreground without touching or overlapping the woman. A white observatory dome, a standard-height open doorway, a metal safety rail, mountain silhouettes and a clear deep-blue sky form the background. Occluded-content description: reconstruct the uninterrupted deck, rail, observatory wall, mountains and sky behind the woman and telescope so hiding a layer does not reveal an obvious cutout hole. Keep the source identity, pose, scale, eye-level 50 mm perspective, blue-hour lighting and object placement. Preserve the measured source relationship: the complete telescope assembly is about ninety-four percent of the woman’s visible height, its tube length is about fifty-one percent of her visible height, and a clear gap of about three percent of the image width separates the telescope from her body. Keep the entire telescope and all three grounded tripod feet coherent in one place without a detached tube, mount or tripod fragment elsewhere. Produce useful alpha boundaries and a recomposition that matches the source without bright fringe, dark matte, duplicated feature, missing content or flattened depth.';

const INPAINT_REPLACE_PROMPT =
  'Mask contract: replace only the small masked charcoal box on the entryway console with one handcrafted stoneware keepsake chest; treat the complete unmasked entryway as immutable. Replacement design: preserve the original box outer width, height, depth, position and rectangular silhouette so the new chest fills the masked footprint. Construct four straight vertical stoneware walls, softly chamfered corners, uninterrupted rectangular faces, a narrow unglazed clay foot and one flat fitted dark-walnut slab lid. Finish the body in deep forest-green low-sheen celadon with subtle horizontal hand-finishing texture and a thin cork gasket line. Integration: match the source camera perspective, focus plane, soft left window light, warm wall bounce, texture scale, grain, wall tone and exposure; ground the stoneware chest with one physically correct contact shadow, a restrained broad glaze highlight facing the window, and believable base occlusion, then feather the boundary without a halo. Preserve the source crop, doorway, switch plate, hooks, folded scarf, ceramic bowl, basket, wall color, console geometry and every region outside the mask.';

const MODIFF_AUDIO_PROMPT =
  'Dark modern alternative metal with nu-metal and djent production. Use an unmistakable triple-meter groove: strong beat one, two lighter quarter-note pulses, and palm-muted riffs resolving in three-beat phrases, never 4/4 or 6/8. Use down-tuned seven-string guitars, pick bass, a tight acoustic metal kit, sparse sub impact, a coarse male lead, and a female scream double only on the chorus. Approximate arrangement: 0-6 seconds, filtered clean arpeggio and reverse texture; 6-23 seconds, restrained verse; 23-32 seconds, tom-led pre-chorus; 32-49 seconds, full chorus with wide guitars, triple-meter double-kick, riff-locked bass, and layered hook; 49-57 seconds, tapping bridge and one tom fill; 57-72 seconds, strongest final chorus; 72-75 seconds, short closing tag and unified hard stop. Keep precise attacks, natural pick noise, human drum velocity, intelligible aggression, centered kick, snare, bass, and lead, wide guitars and backing scream, punchy low mids, restrained cymbals, a short dark room, and clean headroom. Band and vocal stop on one transient with no fade, trailing silence, extra outro, clipping, or artist imitation.';

const MODIFF_AUDIO_75_SECOND_EXAMPLE_PATH = '/template-gallery/ace_step_text_to_audio.current.wav';
const ACE_STEP_CHINESE_NEW_YEAR_EXAMPLE_PATH = '/template-gallery/ace_step_chinese_new_year_lora.wav';

const MODIFF_AUDIO_COVER_PROMPT =
  'Task: create a cohesive alternative-metal cover of the supplied source recording, not a loose song with similar mood. Source invariants: preserve the recognizable lead melody, lyric wording and phrase timing, harmonic movement, section order, meter, tempo, and total duration. The source remains the authority if its musical metadata differs from the written brief. Transformation: recast the arrangement with down-tuned seven-string rhythm guitars, articulate pick bass, a tight acoustic metal kit, coarse male lead vocal, and a restrained female scream double only on the main hook. Keep melodic contour recognizable while changing timbre, articulation, voicing, and production weight. Section behavior: let the opening retain space, build density through the verse, make the chorus wider and rhythmically heavier, insert only a short transitional guitar figure where the source permits it, and preserve the source ending cadence rather than adding a new section. Mix and continuity: match source phrase boundaries, keep tempo and pitch stable, center lead elements, spread rhythm guitars, retain intelligible lyrics, and avoid clipping, phase smear, abrupt loudness jumps, or a premature fade.';

const MODIFF_AUDIO_CONTINUATION_PROMPT =
  'Continue the supplied 75-second alternative-metal song from absolute time 75 to 90 seconds, generating exactly one 15-second tail at 170 BPM in C-sharp minor and strict 3/4. Preserve its down-tuned seven-string guitars, pick bass, tight acoustic metal kit, coarse male lead, chorus-only female scream double, melody language, vocalist identity, mix, room, loudness, and three-beat pulse. Treat the source hard stop as one intentional dramatic breath before a final coda, not as permission to restart with a new intro. Relative to the generated tail: 0-2 seconds, re-enter on beat one with the established low-string motif and drum tone; 2-6 seconds, sing the two-line continuation couplet; 6-12 seconds, lift into the two-line final hook over the established chorus harmony; 12-15 seconds, complete the last phrase and resolve every instrument and vocal together on one new hard stop. Match beat phase, key, timbre, noise floor, stereo width, and ambience at the join. Do not replay the intro, change singer, drift into 4/4 or 6/8, quote unrelated lyrics, fade out, clip, or leave trailing audio.';

const MODIFF_AUDIO_REPAINT_PROMPT =
  'Task: regenerate only the selected source-audio region while treating all audio before and after that interval as immutable. Musical contract: preserve the source tempo, key, meter, chord progression, melodic destination, lyric wording, vocalist identity, instrumentation, groove, and section function. Replace the damaged phrase with a natural alternative performance, not a new composition. Arrangement and timbre: continue the same down-tuned guitar tone, bass articulation, drum-room character, vocal intensity, stereo placement, and density heard immediately around the selection. Let fills and syllables lead causally into the untouched next phrase. Two-boundary integration: match beat phase, pitch, loudness, noise floor, ambience, reverb tail, decay, and transient shape at both the entrance and exit; preserve sufficient pre-roll and release so no note or word is cut unnaturally. Avoid an audible splice, flammed drum attack, phase smear, tempo drift, changed singer, lyric substitution, sudden mix-width change, clipping, silence, or a reverb tail crossing incorrectly into untouched audio.';

const MODIFF_AUDIO_LYRICS = `[intro]
Signal waking, low and slow

[verse]
Blocks ignite beneath the wire
Shape the noise and feed the fire
Image, motion, sound align
Every path becomes design

[chorus]
MoDiff, move the whole graph now
Break it down and build it loud
Run the chain, let modules shift
Make the impossible a modular gift

[bridge]
Cut the grid, the low strings climb

[outro]
MoDiff—lock the final line

[hard stop]`;

const MODIFF_AUDIO_75_SECOND_LYRICS = `[Intro]
Signal waking, low and slow

[Verse]
Blocks ignite beneath the wire
Shape the noise and feed the fire
Image, motion, sound align
Every path becomes design
Hold the pulse in groups of three
Build the chain and set it free

[Pre-Chorus]
One by one the modules rise
Pressure climbing through the lines

[Chorus]
MoDiff, move the whole graph now
Break it down and build it loud
Run the chain, let modules shift
Make the impossible a modular gift

[Bridge]

[Chorus]
MoDiff, move the whole graph now
Every signal ringing out
Run the chain, let modules shift
Make the impossible a modular gift

[Outro]
MoDiff—lock the final line`;

const MODIFF_AUDIO_CONTINUATION_LYRICS = `${MODIFF_AUDIO_75_SECOND_LYRICS}

[Continuation]
From the silence, count to three
One last circuit, set it free

[Final Hook]
MoDiff, drive the signal home
Every path returns as one

[Hard Stop]`;

const TEMPLATE_PROMPTS: Array<[prompt: string, negativePrompt: string]> = [
  [
    'Create a realistic documentary product photograph of one unbranded compact rescue-equipment case used inside a mountain storm lookout. The compact tabletop case has a rigid wet-graphite rectangular shell with softly rounded corners, two small black mechanical latches, one flat burnt-orange silicone pull tab, a continuous dark gasket seam, four tiny rubber feet and no other parts. It is a closed passive case: no lamp, lens, display, dial, antenna, speaker, button, glow or electronic component. Use a natural eye-level 50 mm three-quarter view with the complete case on a scratched timber table, sharp latch and gasket detail, correct feet and contact shadow, and a rain-streaked window with blue-gray mountain weather softly out of focus behind it. Light the scene only with cool overcast window light and weak warm room bounce. Preserve dark graphite material detail, realistic rain beads, restrained highlights and fine film grain, with no cross symbol, branding, lettering, labels, typography or cinematic fantasy glow.',
    '',
  ],
  [
    'Campaign objective: create a premium tabletop launch photograph for LumaPod Brew, a pocket espresso-capsule warmer designed for boutique travel kits. Show one palm-sized appliance with a matte ivory ceramic shell, brushed-brass heating ring, charcoal silicone base, precise lid seam, one recessed indicator, and no invented controls. Compose a front three-quarter view at counter height with an 85 mm product lens; place the warmer slightly right of center and arrange exactly three capsules as a restrained diagonal foreground rhythm. Use a dark honed-slate cafe counter, soft overcast morning window key from camera left, white-card fill, a narrow warm rim on the brass, controlled reflections, crisp microtexture, realistic contact shadows, shallow background bokeh, and generous editorial negative space.',
    '',
  ],
  [
    'Create a finished vertical photographic poster for a heritage seed library. Set the exact title “HERITAGE SEED LIBRARY” in large, clean, dark-sage sans-serif type across the upper field; render those three words exactly once and include no other text, numbers, logos or typographic marks. On a worn oak potting table, arrange one open archival seed box containing small unprinted kraft envelopes, dried bean pods, a brass hand trowel, loose dark soil, and a few living nasturtium leaves. Every object rests naturally under gravity; nothing floats or glows. Frame the still life in the lower half with a natural 50 mm editorial camera and leave the upper forty percent as a softly textured limewashed wall for later typography. Use asymmetrical but balanced spacing, clean print margins, and one clear hierarchy. Use soft north-window daylight, gentle warm bounce from the timber, realistic paper fibers, soil granules, oxidized brass and leaf translucency. Keep an earthy umber, sage and faded-cream palette with restrained film grain and no neon color or synthetic light.',
    '',
  ],
  [
    'Create a four-panel photoreal documentary style study of the same coastal rescue engineer at a working lifeboat station, using the selected realism LoRA consistently. Identity lock: the same weathered woman in her early forties, short dark curls, small scar above the left eyebrow, navy waterproof jacket with one orange shoulder yoke, gray knit layer and no logo in every panel. Panel plan: waist-up portrait beside the open boathouse door; wide view checking a real orange rescue boat; close hands fastening a steel radio clip; three-quarter portrait in wind-driven spray. Use genuinely different camera distances while preserving face, clothing and station identity. Natural overcast daylight, wet fabric, believable skin pores, salt-stained steel, documentary 35 mm grain and grounded real-location backgrounds. This must look photographed, never like a toy, mascot, illustration, animation or glossy 3D render.',
    '',
  ],
  [
    'Create a square launch poster for the fictional sparkling tea VERDA 03. Render the exact large headline text "VERDA 03" at the top in crisp white geometric sans lettering, with the smaller readable line "YUZU MINT SPARKLING TEA" below it. Place a slim emerald can on a frosted glass plinth, condensation beads, softbox reflections, lime peel accent, strict centered layout, premium beverage advertising finish, and high contrast between typography and background.',
    'misspelled VERDA 03, extra letters, warped typography, unreadable subtitle, deformed can, smeared logo, low contrast, blur',
  ],
  [
    'Design a print-ready portrait poster for the fictional exhibition "MATERIAL CULTURE" using a refined photo-led editorial layout, not a synthetic 3D render. Render exactly three text elements and nothing else: the dominant title "MATERIAL CULTURE", the subtitle "DESIGN ARCHIVE", and the date "SEP 06—21". All three must be readable, correctly spelled, and aligned to one disciplined grid; do not generate microcopy. Use one documentary macro photograph of layered handmade paper, a bone folder and a single red binding thread as the visual field. Keep real paper fibers, tool wear and natural shadows, with the title integrated into clean warm-white negative space rather than placed over busy texture. Use black type, warm paper whites and one restrained vermilion accent. Maintain generous margins, typographic hierarchy, optical spacing and a credible contemporary museum-print finish.',
    'wrong title, misspelled MATERIAL CULTURE, misspelled DESIGN ARCHIVE, wrong date, extra text, microcopy, random symbols, chrome ring, glowing orbit, synthetic 3D object, cluttered grid, illegible date, broken kerning, print artifacts',
  ],
  [
    'Campaign objective: generate a high-end studio launch photograph for AsterMist, a fictional lavender sleep spray positioned as quiet, clinical luxury. Product design: one translucent pale-lavender glass bottle with visible wall thickness, clear liquid meniscus, satin-silver atomizer, fine dip tube, and a perfectly rectangular warm-white paper label. Typography: the exact centered brand line must read "ASTERMIST" in black uppercase lettering, with the smaller exact line "LAVENDER SLEEP SPRAY" directly below; no other visible words or symbols. Composition and camera: eye-level front three-quarter hero view through an 85 mm macro product lens, bottle centered slightly right, label plane nearly parallel to camera, sharp label and atomizer, gentle focus falloff into a pale limestone sweep. Lighting and finish: large diffused key at upper left, white-card fill, narrow lavender rim, controlled vertical softbox reflections, dewy stone reflection, natural contact shadow, subtle condensation, calm silver-lilac-charcoal palette, premium cosmetic retouching without plastic surfaces.',
    'misspelled ASTERMIST, wrong subtitle, extra letters, duplicate bottles, warped label rectangle, bent atomizer, missing dip tube, plastic-looking glass, opaque liquid, harsh glare, floating product, cluttered props, low-detail reflections',
  ],
  [
    'Create a compact square label study for the fictional stationery brand "KITE & ANVIL". Render the exact main text "KITE & ANVIL" in clean black serif lettering on a warm white paper tag, with the smaller readable line "FIELD NOTE NO. 12" below it. Keep the scene low-VRAM friendly: one paper tag clipped to a single charcoal notebook, soft window light, subtle paper fibers, tidy tabletop shadow, centered composition, and no extra typography beyond the requested words.',
    'misspelled KITE & ANVIL, wrong ampersand, extra words, unreadable small line, warped tag, duplicate notebooks, clutter, blur',
  ],
  [
    'Campaign objective: create a premium industrial-design hero image for "MICA DROP", a compact portable desk humidifier for calm home offices. Product design: one squat matte-sage cylinder with a softly chamfered top, narrow annular mist outlet, translucent smoked-glass water window showing a believable waterline, and one flush circular brass power button no larger than eight millimeters placed near the upper-right front edge. Add precise part seams and a charcoal silicone foot; do not create a central dial, rotary knob, speaker grille, or invented controls. Typography: print the exact small label "MICA DROP" once on the front in crisp charcoal geometric lettering; keep it level, centered, and fully readable. Composition and camera: landscape 4:3 campaign frame, low eye-level front three-quarter hero view that clearly reveals the right side and elliptical top, 85 mm product lens, full humidifier and its base occupying no more than fifty-five percent of the image and positioned on the left third, sharp focus on button and label, shallow falloff, generous editorial negative space across the right half. Set and lighting: pale limestone desk, warm-gray seamless background, one blurred eucalyptus stem far behind the product, large soft key from upper left, gentle cool fill, narrow warm rim on brass, realistic contact shadow, controlled glass reflection, delicate mist catching the rim light. Finish: quiet Scandinavian art direction, physically plausible matte polymer, brass, glass, water, and vapor microdetail; polished campaign realism rather than a generic white-background render.',
    'misspelled MICA DROP, duplicate label, extra devices, extra buttons, oversized brass control, central dial, rotary knob, speaker grille, centered front-on catalog view, product filling the frame, cropped base, warped cylinder, uneven seams, floating product, plastic-looking brass, opaque water window, noisy smoke cloud, hard-edged mist, cluttered background, flat frontal lighting, weak contact shadow, generic white cube render, low detail',
  ],
  [
    'Create a portrait-format photographic campaign artwork for a fictional coastal film week, built around one real place rather than floating graphic text. Show the weathered entrance of a small 1930s seaside cinema at blue hour after rain: glazed teal tile, dark timber doors, wet pavement, one warm tungsten wall lamp, and the Atlantic horizon glimpsed at the end of the street. Use documentary architectural photography with believable reflections, straight verticals, fine material wear, and restrained offset-print grain. Above the doors is one physical three-row milk-glass marquee. Its removable black letters read exactly "TIDELINE" on row one, "COASTAL FILM WEEK" on row two, and "OCT 12" on row three. This single marquee is the artwork’s complete typographic hierarchy. Frame the entrance low in the portrait with generous rainy sky above it, a quiet asymmetrical composition, deep teal and warm amber color separation, and enough environmental detail to feel like a real cultural venue rather than a layout mockup.',
    'warped architecture, plastic materials, impossible reflection, floating sign, illegible marquee letters, extra building, crowd, neon nightclub, cartoon, illustration, blur',
  ],
  [
    'Packaging objective: turn the supplied control image into an orthographic premium folding-carton design proof for the fictional expedition notebook brand "NORTHSTAR FIELD NOTES". Control contract: preserve every outer flap, central and side-panel proportion, fold boundary, main front label rectangle, lower specification modules, circular feature marks, and yellow footer bars from the control image. Directly below the main label, retain two separate outlined specification boxes in their original positions: one small box on the left containing exactly one circular mark, and one wide box on the right containing exactly three circular marks. Keep all four marks inside those two front-panel boxes, never on the side panels. Keep the layout straight-on and centered; do not fold, rotate, crop, merge, relocate, or invent panels. Front-panel copy: set the exact readable brand "NORTHSTAR FIELD NOTES" in a compact black grotesk, with the smaller line "EXPEDITION SERIES 04". Use the lower modules for short technical copy and icons only; the side panels may carry restrained grid lines and small vertical product information. Material and finish: warm-white FSC paperboard, fine uncoated fiber, crisp black keylines, muted mustard-yellow technical badges, shallow blind emboss on the brand block, precise print registration, subtle scored fold channels, and physically plausible paper thickness along the outer cut edge. Presentation: neutral warm-gray proofing table, orthographic 90-degree camera, even D50 studio light with gentle relief shadows only at score lines, clean prepress/editorial art direction, generous clear space, and sharp readable print detail across the full board.',
    'ignored control layout, folded box, rotated dieline, missing flap, merged panel, shifted label block, warped fold, broken symmetry, cropped edge, invented window, misspelled NORTHSTAR FIELD NOTES, unreadable series line, random copy, duplicated badge, muddy yellow, glossy plastic paper, heavy cast shadow, perspective distortion, messy registration, low detail',
  ],
  [
    CONTACT_SHEET_PROMPT,
    'borders, labels, captions, UI, panel dividers, duplicate tiles, inconsistent identity, blurry frames, low quality',
  ],
  [
    PRODUCT_AD_PROMPT,
    'headline, body copy, caption, logo, any printed text, fake letters, gibberish typography, graphic panel, neon studio backdrop, collage edges, mismatched perspective, closed cube, solid block, glowing glass, floating product, missing platform, missing person, missing lake reflection, contradictory refraction, wrong vessel proportions, duplicate vessel, synthetic illustration, arbitrary neon, unrelated props covering product',
  ],
  [
    PRODUCT_RELIGHT_PROMPT,
    'misspelled ASTERMIST, misspelled LAVENDER SLEEP SPRAY, unreadable label, oversized bottle, duplicate bottle, redesigned pump, missing dip tube, floating base, cropped product, invented pedestal, raised plinth, new stone block, mirrored label on stone, wrong reflections, mismatched lighting, altered architecture, moved pool, warped packaging, hard cutout edge, synthetic glow, arbitrary neon, low detail',
  ],
  [
    PACKAGING_DIELINE_PROMPT,
    'flat unfolded proof, yellow grid design, warped panels, broken folds, missing flap, unreadable TIDELINE MINERAL PIGMENTS, misspelled COASTAL SET 06, wrong silhouette, floating carton, melted edge, decoration across seam, synthetic plastic paper, impossible window, duplicate package, clutter covering package, arbitrary neon, messy shadows',
  ],
  [
    CHARACTER_ANGLES_PROMPT,
    'identity drift, different outfit, different face, borders, labels, captions, inconsistent lighting, extra limbs, warped anatomy',
  ],
  [
    TILE_EXTRACT_PROMPT,
    'grid, neighboring tiles, borders, labels, captions, low resolution, compression artifacts, changed subject, changed camera angle',
  ],
  [
    LOGO_TEXTURE_PROMPT,
    'changed M silhouette, second letter, word, caption, closed counter, asymmetric leg, broken bevel, busy veins, cracked stone, cobalt blue, chrome, enamel, neon, screw, cable, clutter, low contrast',
  ],
  [
    LAYERED_PORTRAIT_PROMPT,
    'merged layers, empty layer, jagged alpha, halos, detached telescope fragment, duplicated tripod, person-telescope overlap, wrong relative scale, broken background, flattened depth',
  ],
  [
    'Extend the source documentary portrait of a marine field researcher into a wide environmental photograph while preserving the original person, facial identity, waterproof jacket, pose, scale, central crop, horizon, camera height, lens perspective and overcast light. Generate only a level continuation of the same low basalt foreshore outside the source: similarly sized layered black rocks, shallow tide pools, sparse low wind-bent grass and uninterrupted distant gray water. Keep the shoreline elevation low and continuous; do not introduce cliffs, coves, headlands or large new landforms. Match rock scale, atmospheric depth, cloud structure, grain, focus falloff and shadow softness across both transitions. Keep the original image visually anchored in the center. Do not add another person, duplicate equipment, repeat rock patterns, stretch the body, change the face, or turn the new borders into a painted or fantastical landscape.',
    'repeated rock patterns, stretched subject, changed face, duplicate person, extra equipment, broken horizon, mismatched weather, changed original crop, obvious seam, painted landscape, fantasy glow',
  ],
  [
    INPAINT_REPLACE_PROMPT,
    'changed unmasked pixels, visible mask boundary, wrong scale, mismatched lighting, floating object, altered background',
  ],
  [
    'Restyle only the source singer into a realistic coastal field-recording presenter while preserving her exact face shape, age, warm skin tone, gaze direction, hairstyle and copper streak, hand positions, microphone, pose, crop, camera perspective, and the complete rocky-coast background. Replace the silver jacket with one tailored rust-brown waxed-canvas field jacket: matte weathered fabric, dark navy wool collar, reinforced shoulder panels, two believable brass snaps, and one narrow slate-blue scarf tucked naturally inside the collar. Keep the garment correctly fitted around both shoulders, elbows, wrists, and microphone grip. Treat every non-clothing region as structurally locked. Keep the distant ship as a comparably small, soft, out-of-focus silhouette in the same upper-left distance; preserve the horizon, water highlights, rocks, amber practical lights, hair flyaways, face, hands, microphone, cable, crop, focus, and original warm late-afternoon illumination. The result must remain a documentary photograph, not science fiction, fashion illustration, or animation.',
    'identity drift, different face, changed hairstyle, missing copper streak, changed pose, changed hands or microphone, extra fingers, extra limbs, plastic skin, changed ship position, enlarged ship, sharp ship, changed horizon, changed rocks or water, moved practical lights, translucent clothing, neon, armor, cyberpunk, illustration, mismatched jacket lighting, malformed seams, warped eyes, visible edit boundary, text, watermark',
  ],
  [
    'Use the source image as a controlled strength-sweep test: transform the cafe interior into a quiet midnight reading lounge while preserving the original camera angle, furniture positions, window geometry, and perspective. Change only mood, lighting, and materials: walnut tables, blue velvet chairs, brass lamp pools, rain outside the windows, warm practical lights, and a refined cinematic finish.',
    'over-editing, moved furniture, changed room geometry, inconsistent perspective, blown highlights, identity drift, warped structure',
  ],
  [
    'Create one photorealistic furniture campaign by fusing two references with explicit roles. Input 1 defines the immutable lounge-chair identity: low curved back flowing into both arms, deep seat, walnut outer shell, four short splayed feet, complete proportions and front three-quarter view. Input 2 defines only the cobalt vitreous-enamel and champagne-aluminum surface language. Preserve Input 1’s chair silhouette, ergonomic seams, seat depth, arm thickness, walnut rear shell and all four mechanically attached feet. Apply deep cobalt enamel only to two inset outer-arm panels and use brushed champagne aluminum only on the four feet and their small mounting plates. Keep the main seat and inner back in understated charcoal wool so the chair remains usable; do not coat cushions in hard enamel. Place the single complete chair in a quiet sunlit rammed-earth hotel reading room with one tall arched opening, pale terrazzo floor and no other furniture. Use a 70 mm eye-level camera, warm side light, cool fill, an accurate grounded shadow, fine wool fibers, walnut pores, enamel depth, directional metal grain and restrained editorial negative space. Output one coherent manufactured chair photographed in a real interior. No second chair, floating feet, changed silhouette, melted join, full-metal cushion, generic studio cyclorama, arbitrary neon, text, logo, person or decorative clutter.',
    'changed chair silhouette, two chairs, missing foot, floating leg, broken arm join, enamel cushion, all-metal seat, mismatched perspective, material confusion, glossy plastic wool, cluttered room, arbitrary neon, text, logo, person, low detail',
  ],
  [
    'Create one photorealistic catalog finish-transfer photograph using two references with strict roles. Input 1 defines the immutable full-size road-touring bicycle geometry and studio camera: two equal 700C wheels, complete double-triangle frame, fork, compact drop handlebar with two brake hoods, saddle, front disc brake, crank, chain, rear cassette, derailleur and connected pedal pair. Input 2 defines only the deep cobalt vitreous-enamel finish, narrow polished bevel and brushed champagne-aluminum grain. Preserve Input 1’s wheel diameter, wheelbase, straight frame tubes, frame-triangle topology, fork alignment, handlebar, brake and drivetrain layout, side three-quarter camera, neutral warm-gray sweep, ground line and clean margins. Apply deep cobalt enamel only to the steel frame and fork; use brushed champagne aluminum only for both wheel rims, crank, hubs and small fittings; retain black rubber tires, dark leather saddle and dark handlebar tape. Add exactly one intentional down-tube wordmark: VELA. Render the four adjacent uppercase letters VELA as one uninterrupted word in a geometric sans-serif, reading left to right along the down tube. Use no hyphen, dash, dot, punctuation, gap, separator or extra mark between any letters. Both black tire sidewalls may retain only a pair of short symmetric non-letter reflective registration dashes; they must contain no readable characters. No other letters, numbers, logo, badge or symbol anywhere. Keep the complete bicycle fully visible at eighty-five to ninety-six percent of the image width, both tires on the same ground line, both wheels differing in apparent diameter by no more than eight percent, and all components physically connected. Output one believable premium bicycle catalog photograph with controlled reflections, readable spokes, realistic tire compression and fine studio grain. No duplicate bicycle, extra wheel, oval wheel, bent frame, broken fork, impossible chain, floating pedal, cropped tire, display plinth, loose hardware, person, scenery, random text, arbitrary neon or illustration.',
    'person, rider, duplicate bicycle, extra wheel, unequal wheels, oval wheel, bent frame, missing frame tube, broken fork, impossible chain, extra crank, floating pedal, cropped tire, readable tire-sidewall text, tire brand, tire label, V-ELA, V ELA, misspelled VELA, hyphen inside VELA, punctuation inside VELA, separator inside VELA, extra letters, extra words, numbers, logo, badge, symbol, enamel tires, display plinth, loose hardware, scenery, arbitrary neon, illustration, low detail',
  ],
  [
    'Inside the mask only, repaint the existing cream enamel surface of the same mug in muted dark burgundy vitreous enamel. Do not generate a new mug. Preserve its exact outer silhouette, rim diameter, body width, height, base footprint, handle position, handle opening, and full occupancy of the original object area. This is a color-and-surface edit only: do not shrink, narrow, move, duplicate, replace, or place anything behind or beneath the mug. Retain the existing dark-green rolled rim and the existing handle geometry. Give the burgundy enamel a believable slightly uneven fired surface, two or three pinhead cream flecks, restrained soft highlights, and subtle wear only on the exposed rim edge. Keep the front completely unbranded and text-free; add no badge, logo, symbol, lettering, decorative image, lid, saucer, coaster, pad, paper, cloth, shadow-card, backdrop, straw, cable, grip band, rubber base, or separate accessory. Match the field-desk perspective, grounded contact shadow, believable mug scale, neutral morning daylight, and warm canvas bounce. Preserve the field notebook, pencil, basalt samples, folded map, tent seams, support pole, open flap, background edges, crop, focus, and every unmasked table texture unchanged; blend the feathered mask edge without a dark or bright halo.',
    'changed unmasked area, rectangular patch, dark patch behind mug, bright patch behind mug, visible mask boundary, shrunken mug, narrowed mug, wrong object scale, moved mug, floating mug, duplicate mug, changed silhouette, inconsistent texture, broken rim, warped handle, grip band, rubber base, text, badge, logo, symbol, lid, saucer, cloth, backdrop, straw, cable, clock, watch, dial, altered notebook, map, rocks or tent',
  ],
  [
    'Create a final-pass architectural visualization of a cliffside micro-library built from dark timber and translucent glass. Show a readable entrance sign "TIDE INDEX", evening ocean mist, warm interior shelves, crisp window mullions, natural rock contact shadows, fine material detail, and clean edges suitable for a later upscale block.',
    'compression artifacts, noisy texture, blurry edges, warped sign text, impossible structure, melted windows, over-sharpened halos',
  ],
  [
    'Extend the source documentary bakery photograph into a wider editorial frame while keeping both bakers, their anatomy, white workwear, the long shaped dough, central wooden bench, brick oven, fire, camera height, lens perspective, depth of field, and mixed cool-window and warm-fire light unchanged. Generate only plausible continuation outside the original borders: more of the same flour-dusted timber bench, a restrained brick wall and tall blue-hour window on the left, and the oven masonry plus one dark preparation shelf on the right. Match brick courses, bench thickness, floor line, grain, color temperature, focus falloff, smoke haze, and shadow direction. Add no people, loaves, signs, clocks, lamps, cables, or decorative props. Blend both boundaries with narrow invisible seams. Keep the two original bakers at their existing scale and positions; do not duplicate limbs, repeat tools, stretch the bench or oven, mirror the fire, or alter the square source region beyond the feathered overlap.',
    'extra person, duplicate baker, extra limb, malformed hand, duplicated dough, repeated tool, stretched bench, bent brick courses, mirrored fire, mismatched lighting, changed central crop, obvious seam, border haze, sign, letters, clock, lamp, cable, decorative clutter',
  ],
  [
    'Create a cinematic industrial-design story frame for Kepler Pin, a modular desk lamp used in a compact architect studio during a rainy blue-hour evening. Hero design: one circular brushed-brass shade, slim charcoal stem, weighted speckled-stone base, precise hinge hardware, braided black cable, and a warm pool of light grazing an open folded blueprint. Build clear foreground, midground, and background depth without adding another hero object: cropped drafting pencils and tracing-paper curls in the foreground, the lamp on a worn walnut desk in the midground, and softly blurred material samples, pinned sketches, and rain-streaked windows behind it. Use a low eye-level 50 mm three-quarter view, warm practical light against cool window ambience, believable brass anisotropy, stone pores, paper fibers, contact shadows, subtle reflections, and restrained film grain. Keep geometry stable and render no readable text.',
    'extra lamps, competing hero objects, chaotic clutter, readable writing, noisy shadows, melted brass shade, broken hinge, floating base, weak silhouette, flat catalog lighting, blurry render',
  ],
  [
    'Create one premium industrial-design hero photograph of a fictional courier helmet named Relay Nine. Show one complete helmet only, centered in a confident helmet-left three-quarter view on a low warm-gray museum plinth. Product identity: compact graphite shell, a continuous narrow amber visor strip, brushed-titanium lower rim, three small rear cooling slots, and one flush circular comms port on the visible side. Keep the helmet physically plausible, wearable, and free of branding, text, or decorative controls. Use a chest-height 70 mm product camera, a soft overhead rectangular key, a narrow cool rim, realistic graphite microtexture, restrained amber transmission, titanium anisotropy, precise seams, a grounded contact shadow, and the pinned realism-LoRA finish. Keep the background quiet and the full silhouette unobstructed.',
    'contact sheet, multiple helmets, duplicate product, cropped helmet, changing shell proportions, extra visor, extra vents, invented controls, text, logo, label, overprocessed texture, clutter, low detail, broken visor, floating product, noisy adapter artifacts',
  ],
  [
    'Create a photorealistic documentary editorial image inside a century-old neighborhood bakery during the first production hour before sunrise. Show one experienced baker in plain white work clothes shaping a long row of sourdough loaves on a scarred beech bench, with a second worker naturally blurred near the brick oven. Hands, tools, flour, dough weight and body posture must be anatomically and physically believable. Use a chest-height 35 mm camera from the end of the bench, warm practical oven light balanced by cool blue window light, real flour dust in the air, worn tile, linen cloth, steel trays and subtle steam. Preserve documentary imperfection, natural skin texture and realistic depth rather than symmetrical fantasy staging. The result must resemble a high-end real-location magazine photograph: no conservatory, orchids, cream overcoat, centered mannequin pose, CGI surfaces, theatrical spotlights or rendered text.',
    'conservatory, greenhouse, orchids, curator, cream overcoat, CGI render, illustration, animated look, plastic skin, extra fingers, distorted hands, floating tools, duplicated bread, impossible oven, theatrical spotlights, oversaturated colors, soft focus',
  ],
  [
    'Create one five-second photographic documentary shot of an approaching storm crossing volcanic highlands. A shoulder-height camera tracks rapidly beside wind-bent silver tussock grass on an exposed upland trail; close stalks sweep both card edges while full-field gust waves and a dark rain curtain advance across stable distant hills. Use restrained natural color, soft storm daylight, realistic motion blur, stable geology and plausible rain and plant dynamics. No people, animals, buildings, vehicles, lightning bolts, fantasy color, corrupted dark bands or static-image hold.',
    'static camera, frozen frame, erratic camera, abrupt pan, zoom, cut, moving horizon, terrain geometry drift, warped geology, duplicated ridge, fog popping, flicker, frame tearing, exposure pumping, fake lightning, oversaturated color, illustration, animation, watermark',
  ],
  [
    'Photoreal printworks documentary called The First Fold, one continuous five-second process shot with immediate readable action. A wide unprinted white paper web streams continuously from the upper-left feed roller, passes through two large counter-rotating steel cylinders at frame center, and exits as evenly folded blank sections toward the lower-right delivery belt. The cylinders make several visibly complete rotations while a stabilized close side camera trucks briskly beside the press; safety rails and fixed vertical frame posts sweep across the foreground in strong parallax. Keep one rigid press, attached rollers, taut paper, believable contact and the same feed direction from opening to closing. Cool industrial daylight, oily steel and natural motion blur. No people, hands, printed words, newspaper headline, loose sheet, torn paper, duplicate press, moving frame, cut, reverse motion or static hold.',
    'deformity, deformed rollers, painting, illustration, synthetic render, low resolution, static frame, frozen action, slow motion, motionless paper, locked camera, camera pause, weak parallax, flicker, temporal jitter, warped cylinder, changing roller size, loose paper, torn paper, duplicate hardware, impossible paper contact, reversed travel, abrupt camera jump, text, subtitle, logo, watermark',
  ],
  [
    'Five-second photoreal single take through a mountain train’s front window in rain. The camera moves rapidly forward from frame one above two straight wet rails. Sleepers rush out beneath the lens; close pine trunks and blank signal posts sweep backward past both edges; raindrops streak upward on the glass; a stone tunnel grows steadily ahead. Keep rail spacing, horizon, forest depth and forward direction stable. Natural overcast light. No exterior train, people, station, writing, cut, zoom, warped track, reversal, freeze or animation.',
    '',
  ],
  [
    'Ten-second photoreal rally follow-pan from the supplied still. Motion begins immediately: the white classic car accelerates across the foreground and clears frame center before second three, throwing one coherent fan of tire spray. At frame center the roadside camera pans decisively right with the car, sweeping road markings and guardrail posts across more than half the frame, then holds the car as it rapidly recedes around the upper-right bend. Preserve body, four wheels, lamps, road contact and scale. Natural rotation and blur; no hold, collision, morphing or text.',
    '',
  ],
  [
    'Photoreal generative remaster of the supplied rocket launch. Improve fine edge clarity, smoke detail, natural tonal separation and stable compression while preserving the exact event. Keep the same rigid white rocket, nose cone, body diameter, vertical trajectory, camera, sky, terrain and plume timing. The rocket rises continuously and stays fully visible. No restyle, extra booster, bent body, duplicate rocket, explosion, altered flight path, writing, logo, flicker, cut or static hold.',
    '',
  ],
  [
    'Five-second photoreal stabilized run between the supplied coastal boardwalk keyframes. Move forward immediately and evenly: wet plank seams stream under the lens, opening posts pass behind camera, new right rope posts sweep past, and grass bends left in wind. Preserve one connected walkway, ocean left, cliff right, cold storm light, rain, scale and perspective. Reach the closing view gradually through real parallax. No hold, late jump, dissolve, zoom-only motion, mirrored coast, duplicated posts, people, text, illustration or CGI.',
    '',
  ],
  [
    'Task: animate the supplied landscape still of a sparkling lemon drink into one continuous two-second fixed-camera editorial food film. Source lock: preserve the exact tumbler height and rim ellipse, pale liquid level, lemon wheel attached at the upper-right rim, every ice cube, the diagonal rosemary sprig to the right of the base, weathered café table, background planters, crop, lens perspective, and every object scale and position. Motion and light: keep the camera locked while fine carbonation bubbles rise through the drink, one condensation bead descends naturally on the outside of the glass, the rosemary tips move once in a faint breeze, and existing leaf shadows shift subtly across the table. Preserve physically plausible refraction, contact shadow, exposure, and daylight direction. End state: finish with the glass at exactly the starting scale and position, grounded on the table, with the same single lemon wheel and every ice cube intact; no cut, morph, camera move, added fruit, or disappearing ice.',
    'static frame, camera movement, zoom, scale drift, warped glass, changing rim, changing liquid level, changing lemon shape, extra fruit, duplicate glass, floating base, disappearing ice, flicker, inconsistent reflections, frozen bubbles, rubbery glass, unrequested cut, text, logo, watermark, low detail',
  ],
  [
    'Task: apply a cool high-speed materials-laboratory grade to the complete supplied hydraulic compression test; this is a color-and-tone finish only, not content regeneration. Preservation contract: keep the exact steel press, red test cylinder, circular platens, green safety wall, compression timing, deformation, fragments, locked camera, crop and motion blur unchanged from first frame to last. Grade design: render machined steel neutral and crisp, keep the specimen safety red, mute the green wall, cool the shadows slightly, protect bright metal highlights and retain detail inside the crushed material. Do not invent gauges, hands, labels, tools or another specimen. Temporal behavior: exposure, white balance, saturation and local contrast must remain continuous as the press descends and the specimen fails; prevent pumping, edge halos or color crawling around fragments. Output contract: the identical compression action with a clearly cooler premium laboratory finish, stable machine geometry and natural material color; no geometry changes, crushed blacks, clipped steel, cyan metal or oversaturation.',
    'content regeneration, changed press geometry, changed platen diameter, duplicate cylinder, moved machinery housing, invented gauge, hand, person, label, changed camera path, flicker, exposure pumping, color crawling, temporal halo, warped motion, frame tearing, cyan steel, oversaturated red, crushed shadows, clipped metal highlights, plastic texture, watermark',
  ],
  [
    'Mask task: throughout the supplied product-orbit clip, replace only the square glass vessel inside the mask with one translucent amber vessel; preserve every unmasked stone edge, tabletop, background, cast-shadow direction, camera orbit, crop and timing. Replacement identity: one rigid open-top square vessel with the source rim opening, wall thickness, base thickness, height, width and grounded position. Use warm amber glass with restrained refraction and no label or text. Reference authority: use the supplied amber-vessel image for color, material, rim, corner and base identity while the source video remains authoritative for scale, pose, camera orbit and surrounding scene. Temporal integration: preserve the exact orbit and apparent scale while reflections travel continuously around four stable faces. Keep the same single amber vessel from first frame to last; do not inherit the source green-to-blue color transition. Boundary behavior: feather only the mask edge and prevent halo trails, texture drag, color spill or changes outside the mask. The pale stone slab must remain rigid and fully connected beneath the vessel. End state: one amber square vessel remains grounded with unchanged proportions, rim, base and contact shadow; no mask bleed, duplicate, melting corner, frame-wise redesign or floating object.',
    'mask bleed, changed unmasked pixels, edge halo, texture drag, color spill, flicker, camera jitter, changing vessel shape, closed rim, floating vessel, wrong scale, duplicate object, melting corner, reflection popping, text, temporal noise, low detail',
  ],
  [
    'Canvas task: extend the supplied moving orange laboratory-robot clip laterally into a wider workcell view while treating the complete center strip as immutable source content. Preservation contract: keep the exact orange arm, joints, cables, gripper, blue-capped vial, orange rack, black bench, white wall, camera, timing and center perspective unchanged. New side content: continue the same bench and white safety enclosure through both boundaries, adding only plausible fixed cable routing and the cropped edges of the existing workcell. Match lens perspective, scale, neutral light and contact shadows. Temporal behavior: generated side panels remain spatially locked while the preserved robot completes its reach. Both vertical seams remain stable and invisible through the full action. Output contract: one coherent wider robotics workcell; no extra arm, duplicate gripper, duplicated vial, mirrored bench, stretched center, perspective jump, frozen seam, flicker, border crawl, person or text.',
    'changed central frame, repeated borders, mirrored forest, stretched rail, warped perspective, broken parallax, crawling seam, frozen side panel, flicker, mismatched lighting, exposure pumping, smeared sleepers, text, unstable geometry, low detail',
  ],
  [
    'Shot objective: create one continuous two-second cinematic gallery-walk shot using the supplied reference images as the immutable identity and wardrobe guide for the same subject. Identity lock: preserve face proportions, hairstyle, age, skin tone, coat silhouette, fabric color, shoes, accessories, and body proportions across all frames; do not average references into a new person. Timeline and blocking: hold one medium-wide side three-quarter view while the subject takes exactly two natural steps from left to right between two large stone sculptures and makes one small upward glance toward a skylight. Preserve the same framing and body scale from start to finish, with grounded foot plants, modest arm swing, cloth inertia, and realistic weight transfer. Camera and environment: nearly locked chest-height 50 mm camera with only a subtle stabilized forward drift, soft overcast skylight, warm gallery practicals, restrained polished-floor reflections, stable sculpture positions, shallow atmospheric depth, and no cut or camera arc. Continuity contract: face, wardrobe, gallery layout, lighting direction, walking cadence, and reflection behavior remain coherent with no sliding feet, pose reset, morphing profile, background teleport, or camera jitter.',
    'identity drift, averaged face, face warp, changing hairstyle, inconsistent wardrobe, extra accessories, sliding feet, weightless walk, pose reset, rubbery limbs, flicker, camera jitter, changing sculpture layout, reflection popping, reversed screen direction, unrequested cut, low detail',
  ],
  [
    'Control task: reconstruct the supplied moving grayscale street segmentation clip as a photoreal protected urban cycle-lane point-of-view while following every curb, paving boundary, parked scooter silhouette, tree, façade, timing and camera movement frame for frame. Control roles: let the grayscale clip determine geometry, scale, forward travel and occlusion. Use text only for real materials and light: pale concrete cycle lane, red-brown brick sidewalk, dark asphalt, a parked black scooter at the right curb, leafy street trees and warm clear-morning sunlight. Camera and motion: preserve the exact low forward point of view. Near paving seams and curb edges move beneath the camera while the distant street grows continuously; the parked scooter passes the right edge according to the control sequence. Lighting and continuity: keep natural exposure, stable horizon, crisp lane boundaries and layered parallax across the full ride. Shadows remain attached to their objects and move only with the source camera. Output contract: one believable real city cycling-lane inspection with obvious forward travel; no static hold, moving parked scooter, changing curb layout, flicker, camera reversal, lettering, illustration or synthetic render.',
    'ignored control video, motion drift, camera-path deviation, broken rail, unstable silhouette, changing track count, frozen mist, reversed travel, shrinking tunnel, flicker, jitter, frame tear, illustration, animation, synthetic render, text, low detail, watermark',
  ],
  [MODIFF_AUDIO_PROMPT, ''],
  [MODIFF_AUDIO_COVER_PROMPT, ''],
  [MODIFF_AUDIO_CONTINUATION_PROMPT, ''],
  [MODIFF_AUDIO_REPAINT_PROMPT, ''],
  ['chinese traditional music, erhu solo, peaceful and elegant', ''],
  [
    'Original cinematic folk song shaped by the selected personal style adapter, intimate lead vocal, fingerpicked acoustic guitar, bowed strings entering in the chorus, restrained hand percussion, clear verse and chorus structure, natural performance timing, detailed balanced mix.',
    '',
  ],
  [
    'Create a photorealistic editorial landscape photograph of coastal conservation work after a rain shower on a windswept Atlantic headland. Show an experienced dry-stone mason in a mustard rain shell and navy work trousers repairing one storm-damaged field wall. The mason kneels side-on with both gloved hands setting one flat gray slate into a clear gap; the wall is built from irregular local stone laid in stable overlapping courses with visible through-stones and small packing stones, never mortar or impossible balancing rocks. Build a detailed working foreground around the repair: a wooden wheelbarrow holding sorted slate, one canvas tool roll with a mason hammer and two chisels, a taut yellow string line between short stakes, a folded waterproof site plan, muddy boot prints, and separate neat piles of large face stones and small packing stones. Every tool rests naturally and the worker has believable anatomy, grip, weight and ground contact. Use a natural eye-level 35 mm camera from the wet footpath. Let the repaired wall lead diagonally from the near left toward the worker at center, with rough grass, a distant white cottage, layered sea cliffs and gray Atlantic water receding on the right. Keep the horizon level and the perspective documentary rather than heroic. Use cool late-afternoon overcast light with one weak sun break catching wet slate edges, believable water-darkened stone and fabric, restrained reflections, natural gray-green color, fine documentary grain, and no signs, letters, logos or rendered text.',
    '',
  ],
  [
    'Create a high-end documentary photograph inside a working coastal aircraft-restoration hangar during a winter rainstorm. Show one experienced mechanic inspecting the exposed radial engine of a 1940s aluminum seaplane. Frame the aircraft nose, engine, near wing root and both pontoons while the tail continues naturally outside the square crop. The aircraft rests on locked maintenance stands with both pontoons grounded, and every hose, cylinder, fastener and tool has believable mechanical scale and attachment. Compose a wide chest-height 35 mm view through a partially open hangar door, with rain streaks and the gray harbor outside, the mechanic and engine on the right third, a rolling tool chest and oil-stained work mat in the foreground, and timber roof trusses receding into depth. Preserve natural anatomy, safe working posture and clear spatial layers. Use cool storm daylight balanced by warm overhead shop lamps, realistic oxidized aluminum, wet concrete reflections, worn cotton coveralls, restrained color and fine editorial grain. Keep the fuselage completely unlettered: no decal, serial, writing, emblem, symbol or logo. No floating parts, invented aircraft geometry, duplicate person, plastic surface or theatrical glow.',
    '',
  ],
  [
    'cinematic_octane, 3D Portrait, 3d render of one original near-future deep-sea salvage engineer standing inside a compact pressure-dock airlock. Show a weathered woman in her late thirties wearing a graphite diving suit with an oxidized-brass pressure collar, one transparent helmet carried under her left arm, a small scar through the right eyebrow, damp short black hair, and no logo or lettering. Frame a vertical waist-up 50 mm portrait from slightly below eye level. Place the engineer on the right third, with a circular steel hatch, wet cable conduits, one amber maintenance lamp and a glimpse of dark ocean through a thick round window behind her. Use cinematic Octane-style physically based materials, ray-traced reflections, restrained volumetric haze, crisp suit microtexture, realistic skin, a cool cyan environment key, warm amber rim light and deep but readable contrast. Keep the low-strength 3D appearance subtle: premium cinematic character visualization rather than plastic toy styling. No extra person, duplicate limb, deformed hand, helmet on the head, floating equipment, readable text, watermark or franchise character.',
    '',
  ],
  [
    'Ghibli style original-character story illustration on a broad rural station platform safely separated from the railway. Show two complete travelers together in the foreground: a young bicycle courier with a short chestnut bob, round brass goggles, teal rain cape, bicycle, and one red travel satchel; beside her, a visibly elderly woman station keeper with silver-gray hair, a wrinkled kind face, forest-green uniform, and her own smaller red travel case. They pause together before departure with warm, familiar expressions. Keep both people, both bags, and the entire bicycle on the platform, never on the rails. A small cream local train is stopped behind them across the platform edge. Lush mossy forest after rain, warm late-afternoon light, hand-painted cel-animation background, no existing franchise character, logo, lettering or watermark.',
    '',
  ],
  [
    'A realistic oil painting of one weathered lighthouse keeper carrying a brass storm lantern along a cliff path at dusk, the lighthouse beam beginning to sweep across a darkening sea while a squall approaches beyond the headland. Large simple composition, one complete figure, wind-bent grass, restrained earth and ultramarine palette, strong textured brushwork, soft distant background, believable anatomy and a clear journey toward the lit doorway.',
    '',
  ],
  [
    'One exhausted night-shift radio operator discovers an urgent handwritten warning emerging from a teletype machine in an empty 1940s newsroom, one hand stopping above the paper while the other reaches for a black telephone, rain streaking the tall window and a clock approaching midnight, low Dutch camera angle, hard venetian-blind shadows, cigarette haze without a visible smoker, in the style of FLMNR, high contrast black and white, one clear dramatic decision, no modern device, logo or watermark.',
    '',
  ],
  [
    'c0m1c style vintage 1930s comic strip panel on a city-hall rooftop: one night watchman yanks down a red emergency lever beside an enormous brass alarm bell as a meteor streaks high across the open sky toward the sleeping city below. Show the lever, bell, watchman and distant meteor as four clearly separate objects with readable cause and effect. Include exactly one large speech balloon. Inside it print exactly these three uppercase words, including the middle word: “WAKE THE CITY!” The balloon must read WAKE THE CITY!, not WAKE CITY, and no other text may appear. Bold ink contours, limited vermilion teal and cream printing, coarse halftone dots, dramatic diagonal composition, aged paper edges, no telescope, cannon, firearm, beam, extra panel, duplicated limb or watermark.',
    '',
  ],
  [
    'AQUACOLTOK watercolor painting on clean white cotton paper with exactly two complete people. On the near half of a narrow footbridge, one mountain trail engineer kneels and secures the final plank. On the far bank, one hiker stands and waits safely, fully visible and clearly separate from the engineer. Show the bridge connecting both banks, a turquoise stream below, one red survey flag and one compact tool satchel beside the engineer, and pale alpine peaks dissolving into mist. Transparent pigment blooms, confident indigo and burnt-sienna linework, generous unpainted margins, clear cause and effect, no extra people, lettering, logo or photorealistic rendering.',
    '',
  ],
  [
    'An original folktale scene of a small village astronomer climbing a moonlit hill to relight a fallen star lantern before dawn, layered midnight-blue hills, amber village windows, silver clouds and one winding path built from visibly cut textured paper with raised edges and soft cast shadows, Paper Cutout Style, coherent foreground middle ground and sky layers, simple readable silhouette, no existing character, text, logo or plastic 3D render.',
    '',
  ],
  [
    'A natural documentary photograph of a rural veterinarian examining an injured tawny owl inside a working wildlife rescue clinic at dawn. Show one veterinarian in plain navy scrubs supporting the owl with both gloved hands while a rehabilitator adjusts one small examination lamp, stainless worktable, folded cotton towel, transport crate and rain-dark trees visible through the window. Eye-level 50 mm lens, practical window and lamp light, realistic skin, feathers, fabric and metal, restrained color, believable anatomy and hand contact, no glamour pose, illustration, CGI, logo, text or duplicated animal.',
    '',
  ],
  [
    'Edit the source photo. Keep the bottle outline, pump, label, exact ASTERMIST and LAVENDER SLEEP SPRAY text, camera, background, and shadow fixed. Change only the lavender body to brushed graphite metal, clear cap to frosted glass, and silver collar to amber metal. Match light, perspective, grain, reflections, and contact shadow. No shape drift, moved parts, duplicate edges, or misspelled text.',
    '',
  ],
  [
    'Mask contract: replace only the masked source region with a compact walnut-and-brass tabletop radio; preserve all unmasked people, hands, props, typography, background geometry, camera framing, and source pixels conceptually unchanged. Replacement design: low rectangular smoked-walnut cabinet, woven charcoal speaker cloth, two knurled brass dials, one narrow amber frequency scale without readable station text, small rubber feet, and a believable size relative to adjacent objects. Integration: continue any hidden tabletop and background through the old object, match local lens perspective, horizon, focus plane, texture scale, grain, and exposure, then ground the radio with correct contact shadow, cast-shadow softness, nearby color spill, reflections, and foreground occlusion. Use the full mask without leaking across its boundary. Result: one seamless source photograph with no halo, pasted edge, floating base, repeated texture, warped radio, extra knobs, changed unmasked content, mismatched lighting, or low-detail fill.',
    '',
  ],
  [
    'Control contract: strictly follow the supplied Canny control image as the authoritative architecture for massing, roofline, facade divisions, openings, stairs, perspective, horizon, and primary edges; do not move, omit, or invent major structural lines. Appearance brief: render the controlled structure as a compact coastal research pavilion built from board-formed concrete, low-iron glass, dark bronze mullions, weathered timber soffits, and a shallow reflecting pool. Add only scale-appropriate doors, railings, interior desks, dune grass, and one distant person where the control geometry permits. Camera and light: retain the control viewpoint and vanishing lines, wide 32 mm architectural lens, late-afternoon overcast key with a warm break near the horizon, soft interior practicals, grounded environmental shadows, realistic glass reflections, subtle sea haze, restrained gray-bronze-amber palette, and crisp material microtexture. Output must honor the edge map while remaining photographic: no warped facade, shifted windows, extra floor, broken stairs, ignored control lines, cluttered foreground, impossible reflection, flat light, blur, or rendered labels.',
    '',
  ],
  [
    'Create a natural editorial portrait of one ceramic artist in a sunlit coastal workshop, hands resting beside a half-finished cobalt vase. Preserve believable anatomy, clay dust, linen texture, wood grain, and an uncluttered silhouette. Compose a waist-up 50 mm view with the artist on the right third, shelves receding softly behind, warm window key from camera left, cool skylight fill, realistic contact shadows, restrained film color, and no rendered text, duplicate hands, plastic skin, warped pottery, or stock-photo staging.',
    '',
  ],
  [
    'Use the first reference as the fixed ASTERMIST bottle and the second only for cobalt ceramic color, warm studio light, and tactile material. Keep the bottle silhouette, pump, label, exact text, camera, crop, and background fixed. Change only the body to brushed cobalt enamel and collar to champagne aluminum. Match source reflections, grain, focus, and shadow. Do not add the potter, pottery, objects, controls, seams, duplicate edges, or new text.',
    '',
  ],
  [
    'Outpaint only beyond the supplied source boundaries to widen the same documentary photograph of a traditional bookbinder at a workbench. Keep the complete original center image, hands, open book, bone folder, linen thread, cutting mat, bench edge, camera, exposure and focus conceptually unchanged. Continue the real workshop at both sides with asymmetric shelves of paper, one small cast-iron book press, cropped binding hand tools and natural window falloff, all at correct 50 mm perspective and scale. Match wood grain, paper texture, shadow direction, film grain and color temperature across both seams. Deliver one continuous wide photograph with the single original worker and naturally varied workshop detail.',
    '',
  ],
  [
    'Strictly follow the supplied depth map as authoritative for the camera, boat-repair shed geometry, timber ribs, workbench positions, skiff hull, open doorway, floor plane and occlusion. Render a real working wooden-boat repair shed on an overcast morning: one partially restored clinker-built fishing skiff resting securely on two timber trestles, old structural framing, steel hand tools, two naturally coiled ropes, scattered sawdust and cool daylight entering through the open doors. Preserve every major depth boundary and vanishing line while adding only scale-compatible construction detail. Use natural documentary exposure, believable worn timber, oxidized metal, fibrous rope, grounded furniture and directional floor shadows.',
    '',
  ],
  [
    'Create a natural-color documentary variation of the source watchmaker photograph. Use the source as the visual reference for one elderly watchmaker, his hand-held wristwatch, dark wool cardigan, repair bench, parts drawers, north-facing window and camera on the sill. Keep these recognizable visual cues while allowing Redux to create a new coherent composition rather than claiming pixel-exact preservation. Show the watchmaker seated at one bench, examining one complete watch above a shallow tray containing a few brass gears, with tweezers and small steel tools grounded on worn wood. Use honest north-window daylight, realistic skin, wool, glass, brass and timber texture, restrained color, fine reportage grain, natural anatomy, practical object scale and one plausible 50 mm camera perspective.',
    '',
  ],
  [
    'Wide photoreal documentary. Preserve the first reference pose: the woman courier stands beside her single complete dark city bicycle on the shoulder of the rainy underpass road, one hand holding the saddle and the other holding the handlebar. Show her full body and the entire bicycle in clean side profile with both round wheels fully visible. Preserve the bicycle mechanics from the courier reference: two brake levers, routed brake cables, one small round white front lamp mounted at the head tube, complete crankset, two crank arms and pedals, chain, fork, saddle, mudguards and rear rack. Use the second reference for unmistakable concrete columns, long wet road, ceiling beams, lights and deep vanishing point toward the bright exit. Rust-red jacket, one woman, one bicycle, natural anatomy, plausible scale and grounded contact shadows. No riding pose, duplicates, CGI, collage or text.',
    'cartoon, animation, illustration, oil painting, painterly texture, CGI render, plastic skin, split screen, collage seam, duplicate person, extra limbs, malformed hands, deformed bicycle, warped wheel, broken frame, floating bicycle, impossible reflection, glowing headlamp, text, watermark',
  ],
  [
    'Create an editorial material-study photograph in a sunlit conservation studio. Hero subject: one hand-cast translucent cobalt glass cube with a precise silhouette, subtly irregular thick glass walls, trapped microbubbles, internal refraction, and physically accurate blue caustics. Place it on layered pale limestone and crumpled archival linen, with a cropped brass caliper and color swatch entering the far foreground as supporting scale cues, never competing subjects. Compose a low front three-quarter 70 mm view with the cube on the right third, diagonal late-afternoon window light crossing the table, a long prismatic shadow, cool reflected fill, softly receding plaster shelves, and visible dust motes. Deliver tactile stone grain, glass edge highlights, linen fibers, grounded contact, rich foreground-midground-background depth, and no labels, duplicate cubes, warped edges, blacked-out glass, floating geometry, or sterile white-cyclorama staging.',
    '',
  ],
  [
    'Preserve the source cube geometry, camera angle, crop, limestone slab, background, focus, and light direction. Change only the cobalt glass to transparent emerald green glass with physically consistent transmission, refraction, highlights, and colored spill. Keep every edge and shadow anchored to the original photograph; do not add objects, reshape the cube, move the camera, replace the surface, introduce text, or alter unrelated pixels.',
    '',
  ],
  [
    'Use the first reference as the exact composition and geometry anchor for one worn hiking boot resting on a damp trail rock. Use the second reference only for indigo woven-canvas texture, rust-orange stitching and dark waxed-leather material evidence. Preserve the single boot silhouette, sole construction, complete lace path, camera, crop, scale, mossy rock, background focus and overcast light. Transform only the existing boot-panel materials: apply the three reference materials coherently with correct weave direction, purposeful seam placement, natural edge wear, firm contact shadow and restrained moisture. Deliver one continuous outdoor product photograph with an unchanged sole and one physically complete boot.',
    '',
  ],
  [
    'Transform the supplied daylight clip of one cat walking left to right across grass into a photoreal rain-dark stone courtyard at blue hour. Preserve the exact same cat, coat markings, body proportions, four-leg gait, head direction, tail motion, screen path, camera, crop, timing and frame cadence. Change the environment and light clearly: replace the green lawn with wet charcoal cobblestones, add restrained warm window reflections behind the cat and a thin natural sheen beneath its paws, while keeping every paw grounded and the animal fully visible. No illustration, different cat, extra limb, missing paw, sliding foot, changing coat, puddle splash, person, text, geometry morph, flicker, frame tearing, frozen region or crawling texture.',
    'changed camera path, changed motion timing, geometry drift, illustration, synthetic render, invented train, people, lettering, flicker, exposure pumping, texture crawl, frozen side region, broken rail, duplicate sleepers, unrequested cuts, watermark',
  ],
  [
    'Photoreal six-shot road thriller, The Last Signal. Follow one white vintage rally coupe with a black hood, two headlamps and three auxiliary lamps carrying an emergency radio from wet mountain bends through pines, a blocked pass and snow to a stone weather station. Each authored camera move begins immediately and shows measurable subject travel or foreground parallax. Preserve rigid car geometry, plausible grip, story direction and natural light. No deformity, deformed tire, missing wheel, people, crash, text, CGI or static hold.',
    '',
  ],
  [
    'Create a coherent photoreal port-logistics documentary called Before Sunrise. Follow one orange container from ship unloading, across the crane gantry, onto a terminal tractor, through ordered container lanes and finally onto a departing freight train. In every shot, a stabilized tracking, panning or crane camera follows one simple readable operation with immediate large-scale machinery movement, stable rigid geometry, realistic wheel or cable contact, and foreground parallax. Preserve the orange container identity and cool predawn industrial light; no people in close view, water spectacle, collision, invented machine, text, synthetic rendering or static hold.',
    'cartoon, painting, illustration, game render, static frame, fixed subject, geometry morph, scale drift, contact sliding, flicker, frame tear, duplicate container, malformed crane, impossible cable, collision, illegible text, watermark',
  ],
  [
    'Create a coherent six-shot photoreal railway short called The Winter Delivery. Follow one blue-and-cream electric freight locomotive carrying emergency supplies from a mountain depot, through valley switches and a rock tunnel, across a snowy high pass, and finally into an isolated village station before night. Preserve rigid locomotive geometry, the same sealed wagons, plausible wheel-to-rail contact, forward screen direction and motivated documentary camera coverage in every shot.',
    'deformity, deformed wheels, deformed bodywork, cartoon, painting, illustration, game render, toy train, low resolution, pixelation, compression artifacts, static pose, frozen frame, flicker, temporal jitter, warped locomotive, changing paint color, changing wagon count, duplicate train, missing wheel, wheel sliding, broken rail, impossible cable, collision, text, subtitle, logo, watermark',
  ],
  [
    'Low contrast. In a retro 1970s-style subway station, a street musician plays in dim colors and rough textures. He wears an old jacket, playing guitar with focus. Commuters hurry by, and a small crowd gathers to listen. The camera slowly moves right, capturing the blend of music and city noise, with old subway signs and mottled walls in the background.',
    '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走',
  ],
  [
    'Continue exactly from the supplied fine-dining kitchen keyframe in one continuous five-second photoreal documentary shot. This is the final carrot-garnish cut for a composed root-vegetable course. Preserve the same adult chef, white jacket, dark apron, face, natural two-hand anatomy, one chef knife, one carrot, separated carrot rounds, walnut cutting board, white plate, folded towel, copper pans, stainless pass, camera height, lens and warm service light. Motion starts in the first frame: the chef keeps the guide hand in a safe curled claw grip and completes one slow controlled slicing action—the unchanged knife descends through the carrot, contacts the board, one new round separates cleanly, then the blade lifts slightly and holds. A stabilized close side camera slides slowly along the counter for the entire shot, creating visible foreground parallax while the chef shifts weight naturally. Keep five fingers per visible hand, one unchanged knife, one unchanged carrot, stationary plate, towel and background cookware, physically plausible contact and consistent shadows. No extra person, extra limb, extra utensil, repeated chopping, morphing food, cutaway, flambé, liquid splash, reflection figure, logo or writing.',
    'deformity, deformed anatomy, deformed limbs, malformed hands, extra fingers, missing fingers, fused fingers, extra hand, extra arm, detached limb, changing face, identity drift, painting, illustration, animation, cartoon, game render, plastic CGI, low resolution, pixelation, excessive blur, static frame, frozen action, camera freeze, flicker, temporal jitter, warped knife, bending knife, duplicate knife, extra utensil, morphing carrot, fused slices, floating food, impossible contact, unsafe grip, abrupt camera jump, extra person, text, subtitle, logo, watermark',
  ],
  [
    'Three-shot live-action documentary called From Green Bean to Morning Cup. Follow pale raw coffee beans pouring into a roaster hopper, chestnut roasted beans swirling across a cooling tray, and fresh espresso filling one white cup. Keep immediate readable motion, stable machinery, real bean texture and natural roastery light. No people, plastic pellets, labels, text, logo, cartoon, static hold, flicker or frame tear.',
    '',
  ],
  [
    'Original dream-pop music at a 96 BPM tempo with an intimate clear lead vocal, soft electronic drums, warm bass, glassy arpeggiator, six short intelligible lyric lines, a polished spacious stereo mix, and a clean ending; no artist imitation.',
    '',
  ],
  [
    'Source contract: preserve the photographed product identity, silhouette, proportions, controls, logo spelling, camera angle, crop, background geometry, and depth of field. Change only the tabletop setting into a quiet rain-lit hotel desk with dark walnut, one folded linen napkin, and a soft window reflection; keep the product fixed in place. Match source perspective, key-light direction, exposure, contact shadow, reflections, texture scale, grain, and occlusion so the edit reads as one photograph. Do not redesign the product, add controls, move branding, duplicate objects, change the lens, create halos, or alter unrelated details.',
    'identity drift, changed product geometry, misspelled branding, moved controls, duplicate product, changed camera angle, pasted edge, halo, mismatched light, floating base, clutter, blur',
  ],
];

const WAN_VIDEO_DEFORMITY_GUARD =
  'deformity, deformed anatomy, deformed limbs, deformed wheels, deformed rigid-body geometry, identity drift';

type StudioTemplateSource = Omit<StudioTemplate, 'prompt' | 'negativePrompt'>;

function inferIntentGroup(template: StudioTemplateSource): StudioTemplateIntentGroup {
  if (template.difficulty === 'blocked' || template.example?.status === 'blocked') return 'planning';
  if (template.category === 'audio_generation' || template.category === 'audio_edit') return 'audio';
  if (VIDEO_STUDIO_MODES.includes(template.mode)) return 'video';
  if (template.category === 'low_vram') return 'performance';
  if (template.category === 'lora') return 'adapters';
  if (template.category === 'upscale') return 'upscale';
  if (template.category === 'product' || template.category === 'poster' || template.category === 'text')
    return 'generate_image';
  if (template.category === 'control' || template.category === 'reference' || template.category === 'layers')
    return 'reference_control';
  if (template.category === 'edit' || template.category === 'inpaint' || template.category === 'outpaint')
    return 'edit_image';
  return 'generate_image';
}

function readinessPolicy(template: StudioTemplateSource): StudioTemplateReadinessPolicy {
  if (template.difficulty === 'blocked' || template.example?.status === 'blocked') return 'planning';
  if (template.inputRequirements) return 'requires_input';
  return 'runnable';
}

function defaultOutputKinds(mode: StudioTemplate['mode']): NonNullable<StudioTemplate['outputKinds']> {
  if (VIDEO_STUDIO_MODES.includes(mode)) return ['video'];
  if (mode === 'text_to_audio' || mode.startsWith('audio_')) return ['audio'];
  return ['image'];
}

function defaultThumbnailVariant(outputKinds: NonNullable<StudioTemplate['outputKinds']>) {
  return outputKinds[0] === 'video'
    ? ('video' as const)
    : outputKinds[0] === 'audio'
      ? ('audio' as const)
      : ('image' as const);
}

function mediaSlotsForTemplate(template: StudioTemplateSource): StudioTemplateMediaSlot[] {
  const outputKinds = template.outputKinds ?? defaultOutputKinds(template.mode);
  const mediaType = template.example?.mediaType ?? outputKinds[0];
  const variant = template.thumbnailVariant ?? defaultThumbnailVariant(outputKinds);
  if (variant === 'compareSlider' || variant === 'hoverDissolve') {
    return [
      { id: 'before', label: 'Before', kind: 'comparison_before', role: 'before', placeholder: 'source asset pending' },
      {
        id: 'after',
        label: 'After',
        kind: 'comparison_after',
        role: 'after',
        placeholder: `${mediaType} result pending`,
      },
    ];
  }
  if (variant === 'contactSheet') {
    return ['A', 'B', 'C', 'D'].map((label) => ({
      id: label.toLowerCase(),
      label,
      kind: mediaType === 'video' ? 'video' : 'image',
      role: 'preview',
      placeholder: `${mediaType} tile pending`,
    }));
  }
  if (variant === 'video') {
    return [
      { id: 'poster', label: 'Poster', kind: 'poster', role: 'poster', placeholder: 'video poster pending' },
      { id: 'video', label: 'Video', kind: 'video', role: 'output', placeholder: 'video example pending' },
    ];
  }
  if (variant === 'audio' || mediaType === 'audio') {
    return [{ id: 'audio', label: 'Audio', kind: 'audio', role: 'output', placeholder: 'audio example pending' }];
  }
  return [
    {
      id: 'primary',
      label: mediaType === 'video' ? 'Video' : 'Preview',
      kind: mediaType === 'video' ? 'video' : 'image',
      role: 'preview',
      placeholder: `${mediaType} example pending`,
    },
  ];
}

function userGoalForTemplate(template: StudioTemplateSource) {
  const intent = inferIntentGroup(template);
  if (intent === 'product_brand')
    return 'Create polished product, packaging, or campaign imagery with realistic materials and brand-safe structure.';
  if (intent === 'typography_poster')
    return 'Generate layouts where hierarchy, spacing, and short readable text matter.';
  if (intent === 'edit_image')
    return 'Use source imagery deliberately while preserving identity, perspective, lighting, and unedited regions.';
  if (intent === 'reference_control')
    return 'Use references, controls, or layered outputs to guide structure instead of relying on prompt text alone.';
  if (intent === 'video')
    return 'Create or edit a short video with stable subject identity, motion, and lighting across frames.';
  if (intent === 'adapters')
    return 'Start from a reusable adapter recipe such as LoRA style testing without exposing backend node details first.';
  if (intent === 'upscale')
    return 'Prepare a finishing recipe that sends the generated result through an upscaling pass.';
  if (intent === 'performance')
    return 'Use hardware-aware settings for lower-memory local runs without hand-editing backend runtime nodes.';
  if (intent === 'utility')
    return 'Prepare practical graph helpers such as low-VRAM runs, LoRA studies, or finishing passes.';
  if (intent === 'planning')
    return 'Inspect a recipe that needs a backend contract before MoDiff should present it as runnable.';
  return 'Generate a strong first image concept from a detailed prompt and model-appropriate settings.';
}

function withTemplateRecipeDefaults(
  template: StudioTemplateSource,
  [prompt, rawNegativePrompt]: (typeof TEMPLATE_PROMPTS)[number],
  index: number,
): StudioTemplate {
  const negativePrompt =
    template.id.startsWith('wan_') && rawNegativePrompt.trim() && !rawNegativePrompt.toLowerCase().includes('deformity')
      ? `${WAN_VIDEO_DEFORMITY_GUARD}, ${rawNegativePrompt}`
      : rawNegativePrompt;
  const cardPoster = TEMPLATE_CARD_POSTER_INDEXES.has(index)
    ? `/template-gallery/${template.id}.${index === 39 ? 'poster' : 'card-poster'}.${WEBP_CARD_POSTER_INDEXES.has(index) ? 'webp' : 'png'}`
    : undefined;
  const outputKinds = template.outputKinds ?? defaultOutputKinds(template.mode);
  const lockedSettings = template.example?.lockedSettings;
  const loaderSettings = {
    ...DEFAULT_STUDIO_FORM,
    ...(getPreset(template.presetId)?.values ?? {}),
    ...(lockedSettings ?? {}),
  };
  const autoLoaderTopology =
    template.modelType === 'QwenImageModularPipeline'
      ? template.mode === 'control_image'
        ? 'control-image'
        : 'base-image'
      : 'default';
  const runtimeContract =
    loaderSettings.resourceMode === 'auto'
      ? ['auto-planned', autoLoaderTopology]
      : [
          loaderSettings.dtype,
          loaderSettings.quantizationMode,
          loaderSettings.autoOffload ? 'auto-offload' : 'resident',
          loaderSettings.offloadMode,
        ];
  const runtimeReuseKey =
    template.runtimeReuseKey ??
    (template.modelType === 'LTXVideoPipeline'
      ? 'ltx-0.9.8-13b-distilled-bfloat16-model-cpu'
      : template.modelType === 'WanVACEPipeline'
        ? 'wan-vace-1.3b-bfloat16-model-cpu'
        : template.modelType === 'WanVideoPipeline'
          ? 'wan-2.1-t2v-1.3b-bfloat16-model-cpu'
          : template.modelType === 'WanTI2VPipeline'
            ? 'wan-2.2-ti2v-5b-bfloat16-resident'
            : [template.modelType, ...runtimeContract].join(':'));
  return {
    ...template,
    intentGroup: template.intentGroup ?? inferIntentGroup(template),
    readinessPolicy: template.readinessPolicy ?? readinessPolicy(template),
    userGoal: template.userGoal ?? userGoalForTemplate(template),
    recipeSummary: template.recipeSummary ?? template.description,
    outputKinds,
    thumbnailVariant: template.thumbnailVariant ?? defaultThumbnailVariant(outputKinds),
    mediaSlots: template.mediaSlots ?? mediaSlotsForTemplate(template),
    verificationStatus: template.verificationStatus ?? template.example?.status ?? 'unverified',
    runtimeReuseKey,
    example:
      template.example && cardPoster
        ? { ...template.example, thumbnailPath: template.example.thumbnailPath ?? cardPoster }
        : template.example,
    prompt,
    negativePrompt,
  };
}

function audioExample(
  seed: number,
  runtimeEstimate: string,
  settings: Partial<StudioTemplateLockedSettings> = {},
  expectedDurationSeconds?: number,
): StudioTemplateExample {
  return {
    mediaType: 'audio',
    status: 'unverified',
    lockedSeed: seed,
    lockedSettings: {
      randomSeed: false,
      lyrics: MODIFF_AUDIO_LYRICS,
      audioDuration: 30,
      extensionDuration: 15,
      vocalLanguage: 'en',
      steps: 8,
      guidanceScale: 1,
      shift: 3,
      bpm: 170,
      keyscale: 'C# minor',
      timesignature: '4/4',
      ...settings,
    },
    expectedOutput: {
      durationSeconds: expectedDurationSeconds ?? settings.audioDuration ?? settings.extensionDuration ?? 30,
      sampleRate: 48000,
    },
    modelRevision: 'pin-required',
    runtimeEstimate,
    notes: 'Exact status requires two clean ACE-Step runs with matching exported audio hashes.',
  };
}

const QWEN_LOW_VRAM_TEMPLATE_SETTINGS: Partial<StudioTemplateLockedSettings> = {
  width: 1024,
  height: 1024,
  steps: 50,
  guidanceScale: 4,
  resourceMode: 'auto',
  dtype: 'bfloat16',
  quantizationMode: 'none',
  autoOffload: true,
  offloadMode: QWEN_LOW_VRAM_OFFLOAD_MODE,
};

const BASE_STUDIO_TEMPLATES: StudioTemplateSource[] = [
  {
    id: 'z_image_quick_concept',
    label: 'Z-Image Turbo — Text to Image: Quick Concept',
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    category: 'concept',
    tags: ['fast', 'ideation', 'starter'],
    difficulty: 'starter',
    vramEstimate: '8-12 GB with offload',
    runtimeEstimate: '20-45 sec',
    description: 'Fast text-to-image iteration with Z-Image Turbo.',
    presetId: 'fast',
    example: example(4201, '20-45 sec on a consumer GPU'),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(4201),
  },
  {
    id: 'z_image_product_mockup',
    label: 'Z-Image Turbo — Text to Image: Product Mockup',
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    category: 'product',
    tags: ['product', 'packaging', 'mockup'],
    difficulty: 'starter',
    vramEstimate: '8-12 GB with offload',
    runtimeEstimate: '20-45 sec',
    description: 'Small-model product and packaging ideation.',
    presetId: 'fast',
    example: example(4202, '20-45 sec on a consumer GPU'),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(4202),
  },
  {
    id: 'z_image_poster',
    label: 'Z-Image Turbo — Text to Image: Poster Artwork',
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    category: 'poster',
    tags: ['poster', 'layout', 'composition'],
    difficulty: 'starter',
    vramEstimate: '8-12 GB with offload',
    runtimeEstimate: '20-45 sec',
    description: 'Fast poster layout exploration.',
    presetId: 'fast',
    example: example(4203, '20-45 sec on a consumer GPU', { width: 768, height: 1344 }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(4203),
  },
  {
    id: 'z_image_lora_style',
    label: 'Z-Image Turbo — LoRA Text to Image: Coastal Rescue Documentary',
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    category: 'lora',
    tags: ['style', 'adapter', 'graph'],
    difficulty: 'advanced',
    thumbnailVariant: 'contactSheet',
    inputRequirements: { loraAdapter: true, sampleAssets: ['pinned LoRA adapter'] },
    requiredBackendCapabilities: ['LoRA loader node with pinned adapter hash'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: {
      lora: {
        model: {
          source: 'hub',
          value: 'youknownothing/v1-realism-v1-adapter-ZIT-lora',
          revision: 'fd6d52d1199ad47f73c18db58339ad01ef766fa7',
          sha256: '1fe0487cfe69b31f6d93ec1a1a6e49f75e9ff77adc8d845380ba7352a3931190',
          byteSize: 170128272,
          license: 'apache-2.0',
        },
        weightName: 'v1-realism.safetensors',
        scale: 0.8,
      },
    },
    vramEstimate: '8-14 GB plus adapter',
    runtimeEstimate: '20-45 sec plus adapter load',
    description: 'Pinned Z-Image realism-adapter style study with a graph-owned LoRA block.',
    presetId: 'fast',
    example: nonExactExample(
      4210,
      '20-45 sec plus adapter load time',
      'Adapter file, weight, revision, hash, and scale are pinned; the Exact badge awaits matching live runs and review.',
      {},
    ),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: {
      ...predictability(4210),
      exactnessNotes: [
        ...predictability(4210).exactnessNotes,
        'LoRA outputs are only exact when the adapter model path, weight file, scale, and loader behavior are locked.',
      ],
    },
  },
  {
    id: 'qwen_text_rendering',
    label: 'Qwen-Image-2512 — Text to Image: Exact Text',
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    category: 'text',
    tags: ['typography', 'labels', 'signage'],
    difficulty: 'intermediate',
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_IMAGE_RUNTIME_ESTIMATE,
    description: 'Readable signs, labels, and short typography.',
    presetId: 'text_accuracy',
    example: example(5101, QWEN_IMAGE_RUNTIME_ESTIMATE),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(5101),
  },
  {
    id: 'qwen_poster_logo_text',
    label: 'Qwen-Image-2512 — Text to Image: Poster and Logo',
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    category: 'poster',
    tags: ['brand', 'poster', 'readable text'],
    difficulty: 'intermediate',
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_IMAGE_RUNTIME_ESTIMATE,
    description: 'Brand-style compositions with strong text hierarchy.',
    presetId: 'text_accuracy',
    example: example(5102, QWEN_IMAGE_RUNTIME_ESTIMATE, { width: 768, height: 1344 }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(5102),
  },
  {
    id: 'qwen_product_mockup',
    label: 'Qwen-Image-2512 — Text to Image: Product Mockup',
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    category: 'product',
    tags: ['product', 'packaging', 'studio'],
    difficulty: 'intermediate',
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_IMAGE_RUNTIME_ESTIMATE,
    description: 'Studio product imagery and packaging concepts.',
    presetId: 'quality',
    example: example(5103, QWEN_IMAGE_RUNTIME_ESTIMATE),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(5103),
  },
  {
    id: 'qwen_low_vram_text_rendering',
    label: 'Qwen-Image-2512 — Text to Image: Label (Auto Offload)',
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    category: 'text',
    tags: ['low vram', 'auto offload', 'typography', 'text to image'],
    difficulty: 'starter',
    requiredBackendCapabilities: ['Qwen direct Auto Diffusers path'],
    vramEstimate: '16 GB cautious with Auto resource mode',
    runtimeEstimate: QWEN_AUTO_RUNTIME_ESTIMATE,
    description: 'Readable short label text using Qwen Auto on constrained local hardware.',
    presetId: 'low_vram',
    example: example(5111, QWEN_AUTO_RUNTIME_ESTIMATE, QWEN_LOW_VRAM_TEMPLATE_SETTINGS),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(5111),
  },
  {
    id: 'qwen_low_vram_product_concept',
    label: 'Qwen-Image-2512 — Text to Image: Product Concept (Auto Offload)',
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    category: 'product',
    tags: ['low vram', 'auto offload', 'product', 'text to image'],
    difficulty: 'starter',
    requiredBackendCapabilities: ['Qwen direct Auto Diffusers path'],
    vramEstimate: '16 GB cautious with Auto resource mode',
    runtimeEstimate: QWEN_AUTO_RUNTIME_ESTIMATE,
    description: 'Directed 4:3 product campaign recipe for Qwen Auto on smaller CUDA GPUs.',
    presetId: 'low_vram',
    example: example(5112, QWEN_AUTO_RUNTIME_ESTIMATE, {
      ...QWEN_LOW_VRAM_TEMPLATE_SETTINGS,
      width: 1024,
      height: 768,
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(5112),
  },
  {
    id: 'qwen_low_vram_poster_layout',
    label: 'Qwen-Image-2512 — Text to Image: Poster Layout (Auto Offload)',
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    category: 'poster',
    tags: ['low vram', 'auto offload', 'poster', 'text to image'],
    difficulty: 'starter',
    requiredBackendCapabilities: ['Qwen direct Auto Diffusers path'],
    vramEstimate: '16 GB cautious with Auto resource mode',
    runtimeEstimate: QWEN_AUTO_RUNTIME_ESTIMATE,
    description:
      'Portrait cultural-poster artwork with a photographed cinema marquee, generated using Qwen Auto offload.',
    presetId: 'low_vram',
    example: example(6219, QWEN_AUTO_RUNTIME_ESTIMATE, {
      ...QWEN_LOW_VRAM_TEMPLATE_SETTINGS,
      width: 768,
      height: 1024,
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(6219),
  },
  {
    id: 'qwen_control_image_layout',
    label: 'Qwen-Image-2512 — Control Image: Layout-Guided Generation',
    mode: 'control_image',
    modelType: 'QwenImageModularPipeline',
    category: 'control',
    tags: ['control image', 'layout', 'composition'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { controlImage: true, sampleAssets: ['layout or edge/control image'] },
    requiredBackendCapabilities: ['Qwen ControlNet Union graph contract'],
    vramEstimate: 'Auto selects native BF16 on high-memory GPUs or a bounded offload plan on smaller supported GPUs',
    runtimeEstimate: QWEN_CONTROL_RUNTIME_ESTIMATE,
    description:
      'Control image recipe using Qwen Image and Qwen ControlNet Union with hardware-adaptive Auto resources.',
    presetId: 'balanced',
    example: example(5201, QWEN_CONTROL_RUNTIME_ESTIMATE, {
      width: 768,
      height: 768,
      steps: 36,
      guidanceScale: 4,
      conditioningScale: 1.2,
      resourceMode: 'auto',
      dtype: 'bfloat16',
      quantizationMode: 'none',
      autoOffload: false,
      offloadMode: 'none',
      maxSequenceLength: 512,
    }),
    promptGuide: CONTROL_PROMPT_GUIDE,
    predictability: {
      ...predictability(5201),
      requiredModels: [QWEN_CONTROLNET_REQUIREMENT],
      exactnessNotes: [
        ...predictability(5201).exactnessNotes,
        'The control image file and Qwen ControlNet Union revision are part of the exactness lock.',
      ],
    },
  },
  {
    id: 'z_image_cinematic_contact_sheet',
    label: 'Z-Image Turbo — Text to Image: Cinematic Contact Sheet',
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    category: 'concept',
    tags: ['contact sheet', 'cinematic', 'variation grid'],
    difficulty: 'intermediate',
    vramEstimate: '8-12 GB with offload',
    runtimeEstimate: '30-70 sec',
    description: 'MoDiff-native 3x3 ideation grid in one runnable Z-Image prompt.',
    presetId: 'fast',
    example: example(4301, '30-70 sec on a consumer GPU', { width: 1344, height: 768 }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(4301),
  },
  {
    id: 'qwen_product_ad_composite',
    label: 'Qwen-Image-Edit-2511 — Multi-Reference Edit: Product Ad',
    mode: 'multi_image_reference_edit',
    modelType: 'QwenImageEditPlusModularPipeline',
    category: 'product',
    tags: ['product', 'poster', 'reference ad'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 2, sampleAssets: ['layout/ad reference', 'product reference'] },
    requiredBackendCapabilities: ['Qwen multi-image reference edit', 'Modular Diffusers LoRA scheduler metadata'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_EDIT_2511_LIGHTNING_RUNTIME_ESTIMATE,
    description:
      'Product poster replacement with layout and product references using the official Qwen 2511 Lightning adapter.',
    presetId: 'quality',
    workflowBlocks: ['lora'],
    workflowBlockSettings: {
      lora: QWEN_EDIT_2511_LIGHTNING_LORA,
    },
    example: example(6201, 'About 3-5 min after inputs are prepared', QWEN_EDIT_2511_LIGHTNING_EXAMPLE_SETTINGS),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: {
      ...predictability(6201),
      exactnessNotes: [
        ...predictability(6201).exactnessNotes,
        'The ad reference and product reference are part of the exactness lock.',
      ],
    },
  },
  {
    id: 'qwen_product_relight',
    label: 'Qwen-Image-Edit-2511 — Multi-Reference Edit: Product Relighting',
    mode: 'multi_image_reference_edit',
    modelType: 'QwenImageEditPlusModularPipeline',
    category: 'product',
    tags: ['product', 'relight', 'composite'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 2, sampleAssets: ['scene/background reference', 'product reference'] },
    requiredBackendCapabilities: ['Qwen multi-image reference edit', 'Modular Diffusers LoRA scheduler metadata'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_EDIT_2511_LIGHTNING_RUNTIME_ESTIMATE,
    description: 'Material-aware product insertion and relighting inspired by MoDiff product scene recipes.',
    presetId: 'quality',
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: QWEN_EDIT_2511_LIGHTNING_LORA },
    example: example(6202, 'About 3-5 min after inputs are prepared', QWEN_EDIT_2511_LIGHTNING_EXAMPLE_SETTINGS),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(6202),
  },
  {
    id: 'qwen_packaging_dieline',
    label: 'Qwen-Image-2512 — Control Image: Packaging Dieline',
    mode: 'control_image',
    modelType: 'QwenImageModularPipeline',
    category: 'control',
    tags: ['packaging', 'dieline', 'control image'],
    difficulty: 'advanced',
    thumbnailVariant: 'hoverDissolve',
    inputRequirements: { controlImage: true, sampleAssets: ['dieline or packaging layout image'] },
    requiredBackendCapabilities: ['Qwen ControlNet Union graph contract'],
    vramEstimate: 'Auto selects native BF16 on high-memory GPUs or a bounded offload plan on smaller supported GPUs',
    runtimeEstimate: QWEN_CONTROL_RUNTIME_ESTIMATE,
    description: 'Generate a retail packaging mockup that follows a dieline/control layout.',
    presetId: 'text_accuracy',
    example: example(5202, QWEN_CONTROL_RUNTIME_ESTIMATE, {
      width: 768,
      height: 768,
      steps: 36,
      guidanceScale: 4,
      conditioningScale: 1.1,
      resourceMode: 'auto',
      dtype: 'bfloat16',
      quantizationMode: 'none',
      autoOffload: false,
      offloadMode: 'none',
      maxSequenceLength: 512,
    }),
    promptGuide: CONTROL_PROMPT_GUIDE,
    predictability: {
      ...predictability(5202),
      requiredModels: [QWEN_CONTROLNET_REQUIREMENT],
      exactnessNotes: [
        ...predictability(5202).exactnessNotes,
        'The dieline/control image and Qwen ControlNet Union revision are part of the exactness lock.',
      ],
    },
  },
  {
    id: 'qwen_character_angles',
    label: 'Qwen-Image-Edit — Image Edit: Character Angle Sheet',
    mode: 'edit_image',
    modelType: 'QwenImageEditModularPipeline',
    category: 'edit',
    tags: ['character', 'turnaround', 'contact sheet'],
    difficulty: 'advanced',
    thumbnailVariant: 'contactSheet',
    inputRequirements: { sourceImage: true, referenceImages: 1, sampleAssets: ['character source image'] },
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_EDIT_RUNTIME_ESTIMATE,
    description: 'One-image character turnaround inspired by MoDiff multi-angle recipes.',
    presetId: 'quality',
    example: example(6203, QWEN_EDIT_RUNTIME_AFTER_INPUT, { width: 1024, height: 1024 }),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(6203),
  },
  {
    id: 'qwen_tile_extract',
    label: 'Qwen-Image-Edit — Image Edit: Contact-Sheet Tile Extraction',
    mode: 'edit_image',
    modelType: 'QwenImageEditModularPipeline',
    category: 'edit',
    tags: ['contact sheet', 'upres', 'selection'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, referenceImages: 1, sampleAssets: ['generated 3x3 contact sheet'] },
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_EDIT_RUNTIME_ESTIMATE,
    description: 'Turn one selected contact-sheet tile into a standalone high-quality frame.',
    presetId: 'quality',
    example: example(6204, QWEN_EDIT_RUNTIME_AFTER_INPUT, { width: 1344, height: 768 }),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(6204),
  },
  {
    id: 'qwen_logo_texture',
    label: 'Qwen-Image-Edit-2511 — Multi-Reference Edit: Logo Texture Transfer',
    mode: 'multi_image_reference_edit',
    modelType: 'QwenImageEditPlusModularPipeline',
    category: 'product',
    tags: ['brand', 'logo', 'texture'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 2, sampleAssets: ['logo/mark image', 'material texture reference'] },
    requiredBackendCapabilities: ['Qwen multi-image reference edit', 'Modular Diffusers LoRA scheduler metadata'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_EDIT_2511_LIGHTNING_RUNTIME_ESTIMATE,
    description: 'Apply material and lighting from a texture reference to a logo while preserving its silhouette.',
    presetId: 'text_accuracy',
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: QWEN_EDIT_2511_LIGHTNING_LORA },
    example: example(6205, 'About 3-5 min after inputs are prepared', QWEN_EDIT_2511_LIGHTNING_EXAMPLE_SETTINGS),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(6205),
  },
  {
    id: 'qwen_layered_portrait',
    label: 'Qwen-Image-Layered — Layer Decomposition: Portrait into Editable Layers',
    mode: 'layer_decomposition',
    modelType: 'QwenImageLayeredModularPipeline',
    category: 'layers',
    tags: ['layers', 'portrait', 'editable'],
    difficulty: 'advanced',
    thumbnailVariant: 'contactSheet',
    inputRequirements: { sourceImage: true, referenceImages: 1, sampleAssets: ['portrait/source image'] },
    outputKinds: ['image', 'json'],
    requiredBackendCapabilities: ['layer output metadata and per-layer media hashes'],
    vramEstimate:
      '64 GB native BF16 on the qualified high-memory host; lower-memory quantized/offloaded paths require separate hardware qualification',
    runtimeEstimate:
      'About 13-15 min once resident; about 47-50 min including a cold native-BF16 load on the qualified ROCm host',
    description:
      'Decompose an observatory portrait into separately previewable background, person, and foreground-telescope layers.',
    presetId: 'balanced',
    example: {
      ...example(7102, 'About 13-15 min once resident on the qualified ROCm host', {
        // Qwen-Image-Layered exposes 640 and 1024 source-resolution contracts;
        // 768 was never a valid pipeline output size. The default stays at the
        // official 640 path for an 18-minute proof while the same generic graph
        // can switch to 1024 through the Studio size controls.
        width: 640,
        height: 640,
        steps: 30,
        guidanceScale: 4,
        layers: 3,
      }),
      // The graph emits three individual 640px RGBA layers. The browser asset
      // is a derived 3x2 review sheet containing the source, recomposition,
      // every layer, and measured review status.
      expectedOutput: { width: 640, height: 640 },
      galleryExpectedOutput: { width: 1536, height: 1108 },
    },
    promptGuide: LAYER_PROMPT_GUIDE,
    predictability: predictability(7102),
  },
  {
    id: 'qwen_outpaint_aspect_template',
    label: 'Qwen-Image-Edit — Outpaint: Aspect-Ratio Expansion',
    mode: 'outpaint',
    modelType: 'QwenImageEditModularPipeline',
    category: 'outpaint',
    tags: ['outpaint', 'aspect ratio', 'canvas'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, sampleAssets: ['source product or lifestyle image'] },
    inputBindings: [
      {
        id: 'generated-outpaint-canvas',
        label: 'Expanded source canvas',
        mediaType: 'image',
        origin: 'graph',
        requiredAt: 'downstream',
        producer: { role: 'qwenOutpaintCanvas', output: 'image' },
      },
      {
        id: 'generated-outpaint-mask',
        label: 'Boundary mask',
        mediaType: 'image',
        origin: 'graph',
        requiredAt: 'downstream',
        producer: { role: 'qwenOutpaintCanvas', output: 'mask' },
      },
    ],
    requiredBackendCapabilities: ['outpaint canvas, mask, and placement controls'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate:
      'About 4-6 min once resident; about 46-50 min including a cold native-BF16 load on the qualified ROCm host',
    description:
      'Any-aspect outpaint recipe that builds an expanded canvas and boundary mask before Qwen Image inpaint.',
    presetId: 'balanced',
    example: nonExactExample(
      7302,
      'About 4-6 min once resident; about 46-50 min including a cold native-BF16 load on the qualified ROCm host',
      'Exact outpaint examples require pinned source image, generated canvas/mask metadata, runtime fingerprint, and decoded output hashes.',
      {
        width: 1344,
        height: 768,
        steps: 12,
        outpaintLeft: 256,
        outpaintRight: 256,
        outpaintTop: 0,
        outpaintBottom: 0,
        outpaintOverlap: 96,
        outpaintFeather: 48,
        outpaintFillColor: 'black',
        strength: 1,
      },
    ),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: {
      ...predictability(7302),
      exactnessNotes: [
        'This template cannot be exact until a live outpaint run records source image, generated canvas, generated mask, runtime, and output hashes.',
        'Changing the source image, canvas size, margins, seam overlap, feather, seed, prompt, or model revision makes the shown example modified.',
      ],
    },
  },
  {
    id: 'qwen_inpaint_object_replace',
    label: 'Qwen-Image-Edit — Inpaint: Masked Object Replacement',
    mode: 'inpaint',
    modelType: 'QwenImageEditModularPipeline',
    category: 'inpaint',
    tags: ['inpaint', 'object replace', 'mask'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, maskImage: true, sampleAssets: ['source image', 'object mask'] },
    requiredBackendCapabilities: ['native inpaint mask graph contract'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: '2-8 min depending on accelerator; about 4 min on the qualified ROCm APU',
    description: 'Masked object replacement recipe using Qwen Image inpaint with one source image and one mask.',
    presetId: 'balanced',
    example: nonExactExample(
      6131,
      '2-8 min depending on accelerator; about 4 min on the qualified ROCm APU',
      'Exact inpaint examples require pinned source image, mask image, backend revision, and decoded output hashes.',
      { strength: 1, steps: 8 },
    ),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(6131),
  },
  {
    id: 'character_edit',
    label: 'Qwen-Image-Edit-2511 — Portrait Edit: Wardrobe Restyling',
    mode: 'edit_image',
    modelType: 'QwenImageEditPlusModularPipeline',
    category: 'edit',
    tags: ['before/after', 'identity', 'retouch'],
    difficulty: 'intermediate',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, referenceImages: 1, sampleAssets: ['source portrait or character image'] },
    requiredBackendCapabilities: ['Qwen single-image reference edit', 'Modular Diffusers LoRA scheduler metadata'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_EDIT_2511_LIGHTNING_RUNTIME_ESTIMATE,
    description: 'Restyle a portrait wardrobe while preserving identity, pose, held objects, and scene lighting.',
    presetId: 'balanced',
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: QWEN_EDIT_2511_LIGHTNING_LORA },
    example: example(6101, 'About 3-5 min after inputs are prepared', QWEN_EDIT_2511_LIGHTNING_EXAMPLE_SETTINGS),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(6101),
  },
  {
    id: 'qwen_edit_strength_sweep',
    label: 'Qwen-Image-Edit — Image Edit: Strength Comparison',
    mode: 'edit_image',
    modelType: 'QwenImageEditModularPipeline',
    category: 'edit',
    tags: ['before/after', 'sweep', 'compare'],
    difficulty: 'advanced',
    thumbnailVariant: 'contactSheet',
    inputRequirements: { sourceImage: true, referenceImages: 1, sampleAssets: ['source image for strength sweep'] },
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: `${QWEN_EDIT_RUNTIME_ESTIMATE} per candidate`,
    description: 'Image-to-image edit starting point for strength sweeps.',
    presetId: 'balanced',
    example: example(6110, `${QWEN_EDIT_RUNTIME_AFTER_INPUT} per sweep candidate`),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: {
      ...predictability(6110),
      exactnessNotes: [
        ...predictability(6110).exactnessNotes,
        'Sweep variants are deliberately Modified because strength, seed, guidance, or steps change.',
      ],
    },
  },
  {
    id: 'reference_fusion',
    label: 'Qwen-Image-Edit-2511 — Multi-Reference Edit: Reference Fusion',
    mode: 'multi_image_reference_edit',
    modelType: 'QwenImageEditPlusModularPipeline',
    category: 'reference',
    tags: ['multi-reference', 'fusion', 'style transfer'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 2, sampleAssets: ['subject reference', 'style/material reference'] },
    requiredBackendCapabilities: ['Qwen multi-image reference edit', 'Modular Diffusers LoRA scheduler metadata'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_EDIT_2511_LIGHTNING_RUNTIME_ESTIMATE,
    description: 'Use multiple reference images for combined direction.',
    presetId: 'balanced',
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: QWEN_EDIT_2511_LIGHTNING_LORA },
    example: example(6102, 'About 3-5 min after inputs are prepared', QWEN_EDIT_2511_LIGHTNING_EXAMPLE_SETTINGS),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(6102),
  },
  {
    id: 'qwen_multi_reference_product',
    label: 'Qwen-Image-Edit-2511 — Multi-Reference Product Finish Transfer',
    mode: 'multi_image_reference_edit',
    modelType: 'QwenImageEditPlusModularPipeline',
    category: 'product',
    tags: ['multi-reference', 'product', 'material'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 2, sampleAssets: ['product geometry', 'material finish'] },
    requiredBackendCapabilities: ['Qwen multi-image reference edit', 'Modular Diffusers LoRA scheduler metadata'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate: QWEN_EDIT_2511_LIGHTNING_RUNTIME_ESTIMATE,
    description: 'Transfer a material reference onto preserved product geometry with exact branded text.',
    presetId: 'balanced',
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: QWEN_EDIT_2511_LIGHTNING_LORA },
    example: example(6120, 'About 3-5 min after inputs are prepared', QWEN_EDIT_2511_LIGHTNING_EXAMPLE_SETTINGS),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: {
      ...predictability(6120),
      exactnessNotes: [
        ...predictability(6120).exactnessNotes,
        'Every reference image path and decode hash is part of the exactness lock.',
      ],
    },
  },
  {
    id: 'qwen_inpaint_mask_draft',
    label: 'Qwen-Image-Edit — Inpaint: Localized Mug Material Restyle',
    mode: 'inpaint',
    modelType: 'QwenImageEditModularPipeline',
    category: 'inpaint',
    tags: ['mask', 'localized edit', 'inpaint'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, maskImage: true, sampleAssets: ['source image', 'mask image'] },
    requiredBackendCapabilities: ['native inpaint mask graph contract'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate:
      '4-12 min depending on accelerator; about 7 min for the bounded sixteen-step proof on the qualified ROCm APU',
    description:
      'Restyle only a masked mug surface while preserving its scale, silhouette, and surrounding documentary worktable.',
    presetId: 'balanced',
    example: nonExactExample(
      6130,
      '4-12 min depending on accelerator; about 7 min for the bounded sixteen-step proof on the qualified ROCm APU',
      'Exact inpaint examples require pinned source image, mask image, backend revision, and decoded output hashes.',
      { strength: 1, steps: 16 },
    ),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: {
      ...predictability(6130),
      exactnessNotes: [
        'This template cannot be exact until a live inpaint run records source, mask, runtime, and output hashes.',
        `Backend contract source: ${QWEN_IMAGE_EDIT_INPAINT_CONTRACT.source}.`,
        'Changing source image, mask image, strength, crop padding, seed, or prompt makes the shown example modified.',
      ],
    },
  },
  {
    id: 'qwen_upscale_finish',
    label: 'Qwen-Image-2512 — Text to Image and Upscale: 2× Product Upscale',
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    category: 'upscale',
    tags: ['final pass', 'upscale', 'quality'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { upscalerModel: true, sampleAssets: ['pinned Real-ESRGAN x4plus model'] },
    requiredBackendCapabilities: ['Spandrel or equivalent upscaler graph block'],
    // The finishing node loads after the same Qwen base pipeline. Keep it in
    // the base-image group so qualification does not discard and reload
    // roughly 58 GB of identical weights before the upscaler step.
    runtimeReuseKey: 'QwenImageModularPipeline:auto-planned:base-image',
    workflowBlocks: ['upscaler'],
    workflowBlockSettings: {
      upscaler: {
        model: {
          source: 'hub',
          value: 'amd/realesrgan-x4plus/RealESRGAN_x4plus.pth',
          revision: 'bda69abcaf525425b371622349e975245ae090c2',
          sha256: '4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1',
          byteSize: 67040989,
          license: 'bsd-3-clause',
        },
        downscale: 0.5,
      },
    },
    vramEstimate: '16 GB plus upscaler',
    runtimeEstimate: '75-150 sec plus upscaler',
    description: 'Generate a final candidate, then finish it with the pinned Real-ESRGAN x4plus graph block.',
    presetId: 'quality',
    example: {
      ...nonExactExample(
        7201,
        '75-150 sec plus upscaler runtime',
        'The upscaler file, revision, hash, and net scale are pinned; the Exact badge awaits matching live runs and review.',
        { resourceMode: 'expert' },
      ),
      // Real-ESRGAN x4 followed by the pinned 0.5 post-downscale is a strict
      // 2x workflow output, not the generator's 1024px intermediate.
      expectedOutput: { width: 2048, height: 2048 },
    },
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: {
      ...predictability(7201),
      exactnessNotes: [
        ...predictability(7201).exactnessNotes,
        'The upscaler model path, model hash, and downscale value must be locked before an Exact badge is allowed.',
      ],
    },
  },
  {
    id: 'qwen_outpaint_draft',
    label: 'Qwen-Image-Edit — Outpaint: Bakery Workspace Expansion',
    mode: 'outpaint',
    modelType: 'QwenImageEditModularPipeline',
    category: 'outpaint',
    tags: ['canvas expansion', 'mask', 'edit'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, sampleAssets: ['source portrait or scene image'] },
    inputBindings: [
      {
        id: 'generated-outpaint-canvas',
        label: 'Expanded source canvas',
        mediaType: 'image',
        origin: 'graph',
        requiredAt: 'downstream',
        producer: { role: 'qwenOutpaintCanvas', output: 'image' },
      },
      {
        id: 'generated-outpaint-mask',
        label: 'Boundary mask',
        mediaType: 'image',
        origin: 'graph',
        requiredAt: 'downstream',
        producer: { role: 'qwenOutpaintCanvas', output: 'mask' },
      },
    ],
    requiredBackendCapabilities: ['outpaint canvas, mask, and boundary-fill graph contract'],
    vramEstimate: QWEN_NATIVE_MEMORY_ESTIMATE,
    runtimeEstimate:
      'About 8-9 min once resident; about 50-55 min including a cold native-BF16 load on the qualified ROCm host',
    description:
      'Expand a documentary bakery workspace horizontally using an automatically generated boundary mask and Qwen Image inpaint.',
    presetId: 'balanced',
    example: nonExactExample(
      7301,
      'About 8-9 min once resident; about 50-55 min including a cold native-BF16 load on the qualified ROCm host',
      'Exact outpaint examples require pinned source image, generated canvas/mask metadata, runtime fingerprint, and decoded output hashes.',
      {
        width: 1344,
        height: 768,
        outpaintLeft: 288,
        outpaintRight: 288,
        outpaintTop: 0,
        outpaintBottom: 0,
        outpaintOverlap: 24,
        outpaintFeather: 8,
        outpaintFillColor: 'black',
        strength: 1,
        steps: 20,
      },
    ),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: {
      ...predictability(7301),
      exactnessNotes: [
        'This template cannot be exact until a live outpaint run records source image, generated canvas, generated mask, runtime, and output hashes.',
        'Changing the source image, canvas size, margins, seam overlap, feather, seed, prompt, or model revision makes the shown example modified.',
      ],
    },
  },
  {
    id: 'low_vram',
    label: 'Z-Image Turbo — Text to Image: Auto-Offload Preview',
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    category: 'low_vram',
    tags: ['low vram', 'offload', 'starter'],
    difficulty: 'starter',
    vramEstimate: '6-8 GB with offload',
    runtimeEstimate: '30-70 sec',
    description: 'Z-Image Turbo text-to-image preview using automatic CPU offload for lower-memory GPUs.',
    presetId: 'low_vram',
    example: example(4204, '30-70 sec with offload enabled'),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(4204),
  },
  {
    id: 'fast_lora',
    label: 'Z-Image Turbo — LoRA Text to Image: Product Hero',
    mode: 'text_to_image',
    modelType: 'ZImageModularPipeline',
    category: 'lora',
    tags: ['lora', 'style', 'fast'],
    difficulty: 'advanced',
    inputRequirements: { loraAdapter: true, sampleAssets: ['pinned LoRA adapter'] },
    requiredBackendCapabilities: ['LoRA loader node with pinned adapter hash'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: {
      lora: {
        model: {
          source: 'hub',
          value: 'youknownothing/v1-realism-v1-adapter-ZIT-lora',
          revision: 'fd6d52d1199ad47f73c18db58339ad01ef766fa7',
          sha256: '1fe0487cfe69b31f6d93ec1a1a6e49f75e9ff77adc8d845380ba7352a3931190',
          byteSize: 170128272,
          license: 'apache-2.0',
        },
        weightName: 'v1-realism.safetensors',
        scale: 0.65,
      },
    },
    vramEstimate: '8-14 GB plus adapter',
    runtimeEstimate: '20-45 sec plus adapter load',
    description: 'Z-Image Turbo product hero using a pinned realism LoRA adapter.',
    presetId: 'fast',
    example: example(7423, '20-45 sec when LoRA assets are available'),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(7423),
  },
  {
    id: 'high_quality',
    label: 'Qwen-Image-2512 — Text to Image: High-Detail Scene',
    mode: 'text_to_image',
    modelType: 'QwenImageModularPipeline',
    category: 'concept',
    tags: ['quality', 'final pass', 'detail', 'bakery documentary'],
    difficulty: 'intermediate',
    mediaSlots: [
      {
        id: 'primary',
        label: 'Preview',
        kind: 'image',
        role: 'preview',
        path: '/template-gallery/high_quality.webp',
        placeholder: 'image example pending',
      },
    ],
    requiredBackendCapabilities: ['Qwen direct Auto Diffusers path'],
    vramEstimate: '16 GB cautious with Auto resource mode',
    runtimeEstimate: QWEN_IMAGE_RUNTIME_ESTIMATE,
    description: 'Qwen-Image-2512 text-to-image final pass using the Auto offload-compatible local recipe.',
    userGoal:
      'Review the generated documentary bakery preview and build the same Qwen Auto recipe as a runnable graph.',
    presetId: 'quality',
    example: example(5104, QWEN_IMAGE_RUNTIME_ESTIMATE, QWEN_LOW_VRAM_TEMPLATE_SETTINGS),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(5104),
  },
  {
    id: 'wan_vace_cinematic_text_to_video',
    label: 'Wan 2.1 T2V 1.3B — Text to Video: Storm Across Volcanic Highlands',
    mode: 'text_to_video',
    modelType: 'WanVideoPipeline',
    category: 'video_generation',
    tags: ['video', 'text to video', 'wan 2.1'],
    difficulty: 'starter',
    mediaSlots: [
      {
        id: 'primary',
        label: 'Generated preview',
        kind: 'video',
        role: 'output',
        path: '/template-gallery/wan_vace_cinematic_text_to_video.mp4',
        posterPath: '/template-gallery/wan_vace_cinematic_text_to_video.poster.png',
        placeholder: 'video example pending',
      },
    ],
    requiredBackendCapabilities: [
      'modules.DiffusersVideo.LoadPipeline',
      'modules.DiffusersVideo.Generate',
      'modules.Video.Export',
    ],
    vramEstimate: '16 GB recommended, 8 GB documented baseline',
    runtimeEstimate: 'About 45-75 min for one native 81-frame shot and 50 steps on the qualified ROCm host',
    description: 'Generate one native-length, visibly moving storm-trail documentary shot.',
    presetId: 'video_low_vram',
    example: videoExample(
      8201,
      'About 45-75 min on the qualified ROCm host',
      {
        numFrames: 81,
        fps: 16,
        steps: 50,
        guidanceScale: 4.5,
      },
      {
        frames: 81,
        durationSeconds: 5.06,
        maximumNearBlackFrameRatio: 0.35,
      },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8201),
  },
  {
    id: 'wan_vace_direct_text_to_video',
    label: 'Wan VACE 1.3B — Text to Video: Working Print Press',
    mode: 'text_to_video',
    modelType: 'WanVACEPipeline',
    category: 'video_generation',
    tags: ['wan vace', 'text to video', 'printworks', 'process', 'photoreal'],
    difficulty: 'blocked',
    requiredBackendCapabilities: ['modules.DiffusersVideo.LoadPipeline', 'modules.DiffusersVideo.Generate'],
    vramEstimate: '16 GB recommended with model CPU offload',
    runtimeEstimate: 'Model-dependent; one 81-frame quality shot',
    description: 'Generate one native five-second moving print-press process shot through the generic Diffusers graph.',
    presetId: 'video_quality',
    example: {
      ...videoExample(8231, 'Qualification blocked after two full app-run motion proofs', {
        numFrames: 81,
        fps: 16,
        steps: 30,
        guidanceScale: 5,
      }),
      status: 'blocked',
      notes:
        'Planning item only: full 30-step VACE text-only proofs produced sharp frames but ignored the requested conveyor and print-press motion. Use the dedicated Wan text-to-video adapter for reliable text-only motion; keep VACE for source-conditioned editing.',
    },
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8231),
  },
  {
    id: 'ltx_video_text_to_video',
    label: 'LTX-Video — Text to Video: Rainy Rail Approach',
    mode: 'text_to_video',
    modelType: 'LTXVideoPipeline',
    category: 'video_generation',
    tags: ['video', 'text to video', 'ltx', 'railway', 'rain', 'forward motion', 'camera motion'],
    difficulty: 'intermediate',
    videoDelivery: 'spatial_upscale',
    mediaSlots: [
      {
        id: 'primary',
        label: 'Generated preview',
        kind: 'video',
        role: 'output',
        path: '/template-gallery/ltx_video_text_to_video.mp4',
        posterPath: '/template-gallery/ltx_video_text_to_video.poster.png',
        placeholder: 'LTX rainy rail-window motion proof pending qualification',
      },
    ],
    requiredBackendCapabilities: [
      'modules.DiffusersVideo.LoadPipeline',
      'modules.DiffusersVideo.Generate',
      'modules.Spandrel.Upscaler',
      'modules.Video.Export',
    ],
    vramEstimate: '32 GB VRAM or 64 GB unified memory; CPU offload supported',
    runtimeEstimate: 'About 8-18 min for one five-second shot and 2× delivery upscale on the qualified ROCm host',
    description:
      'Generate a continuous rainy rail-window approach in LTX’s motion-stable 768×512 regime, then apply the pinned 2× delivery upscale.',
    presetId: 'ltx_video_balanced',
    workflowBlocks: ['upscaler'],
    workflowBlockSettings: { upscaler: VIDEO_DELIVERY_UPSCALER },
    example: videoExample(
      8301,
      'About 8-18 min on the qualified ROCm host',
      {
        width: 768,
        height: 512,
        numFrames: 121,
        fps: 24,
        steps: 8,
        guidanceScale: 1,
      },
      {
        frames: 121,
        durationSeconds: 5.04,
        motionReviewProfile: 'global_camera',
        minimumMotionCoverage: 0.7,
        minimumAdjacentMotionCoverage: 0.08,
        minimumEndToEndMotionCoverage: 0.45,
        minimumActiveMotionWindowRatio: 0.9,
        minimumStrongMotionWindowRatio: 0.8,
        maximumLowMotionFrameRatio: 0.2,
        maximumNearBlackFrameRatio: 0.35,
      },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8301),
  },
  {
    id: 'ltx_video_image_to_video',
    label: 'LTX-Video — Image to Video: Rally Car Tracking Shot',
    mode: 'image_to_video',
    modelType: 'LTXVideoPipeline',
    category: 'video_edit',
    tags: ['video', 'image to video', 'ltx', 'rally car', 'tracking shot', 'parallax'],
    difficulty: 'starter',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 1, sampleAssets: ['rally car source still'] },
    requiredBackendCapabilities: [
      'modules.DiffusersVideo.LoadPipeline',
      'modules.DiffusersVideo.Generate',
      'modules.Video.Export',
    ],
    vramEstimate: '32 GB VRAM or 64 GB unified memory; CPU offload supported',
    runtimeEstimate: 'About 2-6 min for 161 frames and 8 distilled steps on the qualified ROCm host',
    description: 'Animate a rally still into an immediate car pass with wheel motion, tire spray and camera parallax.',
    presetId: 'ltx_video_balanced',
    example: videoExample(
      8302,
      'About 2-6 min on the qualified ROCm host',
      {
        width: 768,
        height: 512,
        numFrames: 161,
        fps: 16,
        steps: 8,
        guidanceScale: 1,
        conditioningScale: 0.7,
        strength: 0.7,
      },
      {
        // I2V may correctly preserve a locked background while a large foreground
        // subject traverses and recedes. This profile still rejects the old
        // near-static clips, while measuring the localized action the card shows.
        motionReviewProfile: 'localized_subject',
        minimumMotionCoverage: 0.55,
        minimumAdjacentMotionCoverage: 0.03,
        minimumEndToEndMotionCoverage: 0.35,
        minimumStrongMotionWindowRatio: 0.45,
      },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8302),
  },
  {
    id: 'ltx_video_video_to_video',
    label: 'LTX-Video — Generative Remaster: Rocket Launch',
    mode: 'video_to_video',
    modelType: 'LTXVideoPipeline',
    category: 'video_edit',
    tags: ['video', 'video to video', 'ltx', 'rocket', 'remaster', 'restoration'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceVideo: true, sampleAssets: ['daylight rocket launch source video'] },
    videoDelivery: 'spatial_upscale',
    requiredBackendCapabilities: [
      'modules.DiffusersVideo.LoadPipeline',
      'modules.DiffusersVideo.Generate',
      'modules.Spandrel.Upscaler',
      'modules.Video.Export',
    ],
    vramEstimate: '32 GB VRAM or 64 GB unified memory; CPU offload supported',
    runtimeEstimate:
      'About 6-15 min for a five-second source excerpt and 2× delivery upscale on the qualified ROCm host',
    description:
      'Reconstruct and upscale a rocket launch while preserving its vehicle, trajectory, plume timing and camera.',
    presetId: 'ltx_video_balanced',
    workflowBlocks: ['upscaler'],
    workflowBlockSettings: { upscaler: VIDEO_DELIVERY_UPSCALER },
    example: videoExample(
      8313,
      'About 6-15 min on the qualified ROCm host',
      {
        width: 768,
        height: 512,
        numFrames: 81,
        fps: 16,
        steps: 8,
        guidanceScale: 1,
        conditioningScale: 1,
        strength: 0.6,
      },
      {
        motionReviewProfile: 'localized_subject',
        minimumMotionCoverage: 0.8,
        minimumAdjacentMotionCoverage: 0.025,
        minimumEndToEndMotionCoverage: 0.4,
        minimumStrongMotionWindowRatio: 0.15,
        maximumLowMotionFrameRatio: 0.75,
        frames: 81,
        durationSeconds: 5.06,
      },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8313),
  },
  {
    id: 'ltx_video_multi_reference',
    label: 'LTX-Video — Multi-Reference to Video: Storm Boardwalk Tracking',
    mode: 'reference_to_video',
    modelType: 'LTXVideoPipeline',
    category: 'video_reference',
    tags: ['video', 'multi-reference', 'ltx', 'boardwalk', 'camera tracking', 'storm'],
    difficulty: 'intermediate',
    thumbnailVariant: 'contactSheet',
    inputRequirements: {
      referenceImages: 2,
      sampleAssets: ['coastal boardwalk opening keyframe', 'coastal boardwalk closing keyframe'],
    },
    videoDelivery: 'spatial_upscale',
    mediaSlots: [
      {
        id: 'subject-reference',
        label: 'Opening boardwalk keyframe',
        kind: 'image',
        role: 'source',
        path: '/template-gallery/inputs/ltx_boardwalk_tracking.start.webp',
        placeholder: 'opening boardwalk keyframe pending',
      },
      {
        id: 'composition-reference',
        label: 'Closing boardwalk keyframe',
        kind: 'image',
        role: 'source',
        path: '/template-gallery/inputs/ltx_boardwalk_tracking.end.webp',
        placeholder: 'closing boardwalk keyframe pending',
      },
      {
        id: 'output',
        label: 'Generated motion',
        kind: 'video',
        role: 'output',
        path: '/template-gallery/ltx_video_multi_reference.mp4',
        posterPath: '/template-gallery/ltx_video_multi_reference.poster.png',
        placeholder: 'multi-reference video pending',
      },
    ],
    requiredBackendCapabilities: [
      'modules.DiffusersVideo.LoadPipeline',
      'modules.DiffusersVideo.Generate',
      'modules.Spandrel.Upscaler',
      'modules.Video.Export',
    ],
    vramEstimate: '32 GB VRAM or 64 GB unified memory; CPU offload supported',
    runtimeEstimate: 'About 6-15 min for one five-second shot and 2× delivery upscale on the qualified ROCm host',
    description:
      'Track forward between two matching boardwalk keyframes in LTX’s motion-stable 768×512 regime, then apply the pinned 2× delivery upscale.',
    presetId: 'ltx_video_balanced',
    workflowBlocks: ['upscaler'],
    workflowBlockSettings: { upscaler: VIDEO_DELIVERY_UPSCALER },
    example: videoExample(
      8304,
      'About 6-15 min on the qualified ROCm host',
      {
        width: 768,
        height: 512,
        numFrames: 81,
        fps: 16,
        steps: 8,
        guidanceScale: 1,
        conditioningScale: 1,
        strength: 0.55,
      },
      {
        motionReviewProfile: 'global_camera',
        minimumMotionCoverage: 0.75,
        minimumAdjacentMotionCoverage: 0.08,
        minimumEndToEndMotionCoverage: 0.55,
        frames: 81,
        durationSeconds: 5.06,
      },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8304),
  },
  {
    id: 'wan_vace_animate_product_still',
    label: 'Wan VACE 1.3B — Still Image to Video: Sparkling Lemon Drink',
    mode: 'image_to_video',
    modelType: 'WanVACEPipeline',
    category: 'video_edit',
    tags: ['video', 'image to video', 'food', 'photoreal'],
    difficulty: 'blocked',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 1, sampleAssets: ['landscape beverage still'] },
    requiredBackendCapabilities: ['modules.DiffusersVideo.Generate', 'modules.VideoConditioning.ReferenceImages'],
    vramEstimate: '16 GB recommended',
    runtimeEstimate:
      'Measured about 9 min end-to-end for 33 frames and 16 steps on the qualified high-memory ROCm host',
    description:
      'Animate a realistic beverage still with restrained bubbles, condensation, and breeze while preserving glass geometry, physical scale, and table contact.',
    presetId: 'video_low_vram',
    example: {
      ...videoExample(8202, 'Qualification blocked after three app-run source-fidelity proofs', {
        width: 832,
        height: 480,
        numFrames: 33,
        fps: 16,
        steps: 16,
        guidanceScale: 4.5,
        conditioningScale: 1,
      }),
      status: 'blocked',
      notes:
        'Planning item only: app proofs were temporally stable, but the 1.3B VACE pipeline either reframed/reconstructed source objects or applied a strong global contrast and saturation shift before motion began.',
    },
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8202),
  },
  {
    id: 'wan_vace_video_color_grade',
    label: 'Wan 2.1 T2V 1.3B — Generative Look Transfer: Materials Lab',
    mode: 'video_color_edit',
    modelType: 'WanVideoPipeline',
    category: 'video_color',
    tags: ['video', 'color', 'edit'],
    difficulty: 'intermediate',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceVideo: true, sampleAssets: ['source video'] },
    requiredBackendCapabilities: ['modules.Video.Load', 'modules.DiffusersVideo.Generate', 'modules.Video.Export'],
    vramEstimate: '16 GB recommended',
    runtimeEstimate: 'About 35-65 min for 81 frames and 50 steps on the qualified high-memory ROCm host',
    description:
      'Prompt-guided generative look transfer; source motion and geometry can change. Use deterministic Video Color nodes when an exact grade is required.',
    presetId: 'color_preserve_edit',
    example: videoExample(
      8203,
      'About 35-65 min on the qualified high-memory ROCm host',
      {
        numFrames: 81,
        steps: 50,
        // 0.18 preserved the source but the qualified press proof was still too
        // subtle to communicate a look-transfer operation. Keep the structural
        // guard at 0.20 and use the model's recommended CFG 5 for a clearer grade.
        strength: 0.2,
        guidanceScale: 5,
      },
      {
        // The camera is intentionally locked and motion is localized to the
        // descending press and specimen. These floors match the byte-locked
        // source motion while still rejecting a frozen or mistimed edit.
        motionReviewProfile: 'localized_subject',
        minimumMotionCoverage: 0.27,
        minimumAdjacentMotionCoverage: 0.03,
        minimumEndToEndMotionCoverage: 0.18,
        minimumActiveMotionWindowRatio: 0.65,
        minimumStrongMotionWindowRatio: 0,
        maximumLowMotionFrameRatio: 0.3,
      },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8203),
  },
  {
    id: 'wan_vace_masked_object_replace',
    label: 'Wan VACE 1.3B — Video Inpaint: Amber Glass Replacement',
    mode: 'video_inpaint',
    modelType: 'WanVACEPipeline',
    category: 'video_inpaint',
    tags: ['video', 'mask', 'inpaint', 'product', 'glass'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: {
      sourceVideo: true,
      maskVideo: true,
      referenceImages: 1,
      sampleAssets: ['source video', 'white-generate mask video', 'replacement identity reference'],
    },
    requiredBackendCapabilities: [
      'modules.Image.Load',
      'modules.VideoConditioning.AlignMask',
      'modules.DiffusersVideo.Generate',
    ],
    vramEstimate: '16 GB recommended',
    runtimeEstimate: 'About 100-130 min for two native segments, 161 frames, and 30 steps on the qualified ROCm host',
    description: 'Replace one masked glass vessel across a moving product orbit while preserving its surrounding set.',
    presetId: 'video_balanced',
    example: videoExample(
      8217,
      'Measured about 110 min on the qualified Radeon 8060S host',
      {
        numFrames: 161,
        steps: 30,
      },
      {
        motionReviewProfile: 'localized_subject',
        minimumMotionCoverage: 0.5,
        minimumAdjacentMotionCoverage: 0.08,
        // A product orbit can finish close to its opening view. Require strong
        // continuous motion, but do not reject the intended return angle.
        minimumEndToEndMotionCoverage: 0.35,
        minimumActiveMotionWindowRatio: 0.9,
        minimumStrongMotionWindowRatio: 0.75,
        maximumLowMotionFrameRatio: 0.2,
      },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8217),
  },
  {
    id: 'wan_vace_outpaint_reframe',
    label: 'Wan VACE 1.3B — Video Outpaint: Wider Robotics Workcell',
    mode: 'video_outpaint',
    modelType: 'WanVACEPipeline',
    category: 'video_outpaint',
    tags: ['video', 'outpaint', 'reframe', 'robotics', 'laboratory'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceVideo: true, maskVideo: true, sampleAssets: ['source video', 'boundary mask video'] },
    requiredBackendCapabilities: [
      'modules.VideoConditioning.Normalize',
      'modules.VideoConditioning.AlignMask',
      'modules.DiffusersVideo.Generate',
    ],
    vramEstimate: '16 GB recommended',
    runtimeEstimate: 'About 25-45 min for 81 frames and 30 steps on the qualified high-memory ROCm host',
    description: 'Extend a moving laboratory-robot clip with perspective-correct, temporally stable side content.',
    presetId: 'video_balanced',
    example: videoExample(8205, 'About 25-45 min on the qualified high-memory ROCm host', {
      numFrames: 81,
      steps: 30,
    }),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8205),
  },
  {
    id: 'wan_vace_reference_motion',
    label: 'Wan VACE 1.3B — Reference to Video: Subject Motion',
    mode: 'reference_to_video',
    modelType: 'WanVACEPipeline',
    category: 'video_reference',
    tags: ['video', 'reference', 'subject'],
    difficulty: 'intermediate',
    inputRequirements: { referenceImages: 2, sampleAssets: ['subject reference', 'style reference'] },
    requiredBackendCapabilities: ['modules.VideoConditioning.ReferenceImages', 'modules.DiffusersVideo.Generate'],
    vramEstimate: '16 GB recommended',
    runtimeEstimate: 'About 9-15 min for 33 frames and 16 steps on the qualified high-memory ROCm host',
    description: 'Use references to guide a short subject-driven video.',
    presetId: 'video_balanced',
    example: {
      ...videoExample(8206, 'Qualification blocked after a real two-reference app proof', {
        numFrames: 33,
        steps: 16,
      }),
      status: 'blocked',
      notes:
        'Planning item only: the Wan 1.3B reference proof rendered the rainy portrait as a giant scene billboard, kept the subject nearly static, and did not produce the requested gallery walk. The adapter needs reference-identity conditioning that cannot leak source pixels into the scene before this mode is supported.',
    },
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8206),
  },
  {
    id: 'wan_vace_grayscale_control',
    label: 'Wan VACE 1.3B — Control to Video: City Cycle Lane',
    mode: 'control_to_video',
    modelType: 'WanVACEPipeline',
    category: 'video_control',
    tags: ['video', 'control', 'grayscale', 'street', 'cycling', 'photoreal'],
    difficulty: 'intermediate',
    inputRequirements: { controlVideo: true, sampleAssets: ['prepared grayscale/control video'] },
    requiredBackendCapabilities: ['modules.Video.Load', 'modules.DiffusersVideo.Generate', 'modules.Video.Export'],
    vramEstimate: '16 GB recommended',
    runtimeEstimate: 'About 25-45 min for 81 frames and 30 steps on the qualified high-memory ROCm host',
    description: 'Turn a moving street segmentation study into a photoreal protected cycle-lane journey.',
    presetId: 'video_balanced',
    example: videoExample(
      8207,
      'About 25-45 min on the qualified high-memory ROCm host',
      {
        numFrames: 81,
        steps: 30,
      },
      {
        // This workflow follows a deliberately smooth low-speed control camera.
        // Require broad end-to-end travel while allowing small per-frame deltas;
        // the global defaults are calibrated for faster free-generation shots.
        minimumMotionCoverage: 0.75,
        minimumAdjacentMotionCoverage: 0.03,
        minimumEndToEndMotionCoverage: 0.6,
        minimumActiveMotionWindowRatio: 0.6,
        minimumStrongMotionWindowRatio: 0.4,
        maximumLowMotionFrameRatio: 0.8,
      },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8207),
  },
  {
    id: 'ace_step_text_to_audio',
    label: 'ACE-Step Audio — Text to Audio: Alternative-Metal Song',
    mode: 'text_to_audio',
    modelType: 'AceStepAudioPipeline',
    category: 'audio_generation',
    tags: ['audio', 'music', 'ace-step'],
    difficulty: 'starter',
    requiredBackendCapabilities: ['Diffusers audio direct pipeline'],
    vramEstimate: ACE_STEP_MEMORY_ESTIMATE,
    runtimeEstimate: 'About 5-15 min for 75 sec audio',
    description: 'Generate music from prompt and optional lyrics with ACE-Step Diffusers.',
    presetId: 'audio_balanced',
    example: {
      ...audioExample(8301, 'About 5-15 min for 75 sec audio', {
        audioDuration: 75,
        lyrics: MODIFF_AUDIO_75_SECOND_LYRICS,
        bpm: 170,
        keyscale: 'C# minor',
        timesignature: '3',
      }),
      outputPath: MODIFF_AUDIO_75_SECOND_EXAMPLE_PATH,
    },
    promptGuide: AUDIO_PROMPT_GUIDE,
    predictability: predictability(8301),
  },
  {
    id: 'ace_step_audio_variation',
    label: 'ACE-Step Audio — Audio Variation: Alternate Arrangement',
    mode: 'audio_variation',
    modelType: 'AceStepAudioPipeline',
    category: 'audio_edit',
    tags: ['audio', 'cover', 'variation'],
    difficulty: 'intermediate',
    inputRequirements: { sourceAudio: true, sampleAssets: ['source wav audio'] },
    requiredBackendCapabilities: ['Diffusers audio direct pipeline', 'modules.Audio.Load'],
    vramEstimate: ACE_STEP_MEMORY_ESTIMATE,
    runtimeEstimate: '2-6 min after source audio load',
    description: 'Create a guided cover or variation from source audio.',
    presetId: 'audio_variation',
    example: audioExample(8302, '2-6 min after source audio load'),
    promptGuide: AUDIO_PROMPT_GUIDE,
    predictability: predictability(8302),
  },
  {
    id: 'ace_step_audio_continuation',
    label: 'ACE-Step Audio — Audio Continuation: Extend Track',
    mode: 'audio_continuation',
    modelType: 'AceStepAudioPipeline',
    category: 'audio_edit',
    tags: ['audio', 'continuation'],
    difficulty: 'intermediate',
    inputRequirements: { sourceAudio: true, sampleAssets: ['source wav audio'] },
    requiredBackendCapabilities: [
      'Diffusers audio direct pipeline',
      'modules.Audio.Load',
      'modules.Audio.MatchLoudness',
      'modules.Audio.Join',
    ],
    vramEstimate: ACE_STEP_MEMORY_ESTIMATE,
    runtimeEstimate: '2-6 min after source audio load',
    description: 'Continue the included 75-second track and export the complete joined 90-second song.',
    presetId: 'audio_continuation',
    example: audioExample(
      8303,
      '2-6 min after source audio load',
      {
        audioDuration: 75,
        extensionDuration: 15,
        lyrics: MODIFF_AUDIO_CONTINUATION_LYRICS,
        bpm: 170,
        keyscale: 'C# minor',
        timesignature: '3',
      },
      90,
    ),
    promptGuide: AUDIO_PROMPT_GUIDE,
    predictability: predictability(8303),
  },
  {
    id: 'ace_step_audio_repaint',
    label: 'ACE-Step Audio — Audio Repaint: Replace Segment',
    mode: 'audio_repaint',
    modelType: 'AceStepAudioPipeline',
    category: 'audio_edit',
    tags: ['audio', 'repaint', 'inpaint'],
    difficulty: 'intermediate',
    inputRequirements: { sourceAudio: true, sampleAssets: ['source wav audio'] },
    requiredBackendCapabilities: ['Diffusers audio direct pipeline', 'modules.Audio.Load'],
    vramEstimate: ACE_STEP_MEMORY_ESTIMATE,
    runtimeEstimate: '2-6 min after source audio load',
    description: 'Regenerate a selected section of source audio while preserving the rest.',
    presetId: 'audio_balanced',
    example: audioExample(8304, '2-6 min after source audio load'),
    promptGuide: AUDIO_PROMPT_GUIDE,
    predictability: predictability(8304),
  },
  {
    id: 'ace_step_chinese_new_year_lora',
    label: 'ACE-Step Audio — LoRA: Chinese New Year Ensemble',
    mode: 'text_to_audio',
    modelType: 'AceStepAudioPipeline',
    category: 'lora',
    tags: ['audio', 'music', 'lora', 'ace-step', 'traditional'],
    difficulty: 'starter',
    requiredBackendCapabilities: ['modules.DiffusersAudio.LoadAdapter', 'modules.DiffusersAudio.Generate'],
    vramEstimate: '12-16 GB with model offload',
    runtimeEstimate: 'About 1-5 min for the pinned 30 sec recipe after model load',
    description: 'Use the adapter and base-model pairing verified in the merged Diffusers ACE-Step LoRA change.',
    promptQualityPolicy: 'adapter_reference',
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: ACE_STEP_CNY_LORA },
    inputRequirements: { loraAdapter: true, sampleAssets: ['pinned ACE-Step LoRA'] },
    presetId: 'audio_balanced',
    example: {
      ...audioExample(42, 'About 1-5 min for 30 sec audio after model load', {
        audioDuration: 30,
        bpm: 96,
        keyscale: 'D major',
        lyrics: '[verse]\n\u6625\u98ce\u53c8\u7eff\u6c5f\u5357\u5cb8\n\u660e\u6708\u4f55\u65f6\u7167\u6211\u8fd8',
      }),
      outputPath: ACE_STEP_CHINESE_NEW_YEAR_EXAMPLE_PATH,
    },
    promptGuide: AUDIO_PROMPT_GUIDE,
    predictability: predictability(42),
  },
  {
    id: 'ace_step_custom_lora',
    label: 'ACE-Step Audio — LoRA: Your Trained Audio Style',
    mode: 'text_to_audio',
    modelType: 'AceStepAudioPipeline',
    category: 'lora',
    tags: ['audio', 'music', 'lora', 'ace-step', 'custom'],
    difficulty: 'advanced',
    evidencePolicy: 'user_supplied',
    requiredBackendCapabilities: ['modules.DiffusersAudio.LoadAdapter', 'modules.DiffusersAudio.Generate'],
    vramEstimate: '12-16 GB with model offload',
    runtimeEstimate: 'Depends on the selected adapter and duration',
    description: 'Start with an original ACE-Step 1.5 LoRA folder, then tune adapter strength without editing code.',
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: ACE_STEP_CUSTOM_LORA },
    inputRequirements: { loraAdapter: true, sampleAssets: ['your trained adapter_model.safetensors'] },
    presetId: 'audio_balanced',
    example: {
      ...audioExample(8451, 'Depends on the selected adapter', {
        audioDuration: 20,
        bpm: 92,
        keyscale: 'A minor',
        lyrics: '[instrumental]',
      }),
      notes:
        'Bring-your-own adapter recipe. The generic ACE-Step LoRA path is qualified by the pinned Chinese New Year adapter, while this card deliberately waits for the user’s own compatible weights.',
    },
    promptGuide: AUDIO_PROMPT_GUIDE,
    predictability: predictability(8451),
  },
  {
    id: 'flux_schnell_text_to_image',
    label: 'FLUX.1-schnell — Text to Image: Coastal Wall Restoration',
    mode: 'text_to_image',
    modelType: 'FluxSchnellPipeline',
    category: 'flux',
    tags: ['flux', 'schnell', 'black-forest-labs'],
    difficulty: 'starter',
    requiredBackendCapabilities: ['Diffusers image direct pipeline'],
    vramEstimate: '16 GB with offload',
    runtimeEstimate: 'About 25-27 min cold; 45-120 sec after the model is resident',
    description: 'Low-step FLUX documentary scene showing a mason repairing a coastal dry-stone wall.',
    presetId: 'flux_fast',
    example: example(8427, 'About 25-27 min cold; 45-120 sec after the model is resident', {
      steps: 4,
      guidanceScale: 0,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(8427),
  },
  {
    id: 'flux_dev_expert_text_to_image',
    label: 'FLUX.1-dev — Text to Image: Aircraft Restoration Documentary',
    mode: 'text_to_image',
    modelType: 'FluxDevPipeline',
    category: 'flux',
    tags: ['flux', 'dev', 'aircraft', 'documentary', 'restoration'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline', 'Diffusers artifact quantization node'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min depending on artifact',
    description: 'Expose FLUX.1-dev for larger GPUs or quantized artifacts.',
    presetId: 'flux_quality',
    example: example(8402, '2-6 min depending on artifact', {
      steps: 28,
      guidanceScale: 3.5,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(8402),
  },
  {
    id: 'flux_lora_cinematic_octane_3d',
    label: 'FLUX.1-dev — LoRA Mix: Cinematic Octane 3D',
    mode: 'text_to_image',
    modelType: 'FluxDevPipeline',
    category: 'lora',
    tags: ['lora', 'cinematic octane', '3d render', 'character', 'flux'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline', 'pinned LoRA adapter verification'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: FLUX_THEME_LORAS.cinematicOctane3d },
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after the base and both adapters are resident',
    description:
      'Cinematic-Octane character rendering with the documented trigger and a low-strength 3D-render adapter for controlled CG depth.',
    presetId: 'flux_quality',
    example: example(9371, '2-6 min after the base and both adapters are resident', {
      width: 768,
      height: 1024,
      steps: 24,
      guidanceScale: 3,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(9371),
  },
  {
    id: 'flux_lora_ghibli_story',
    label: 'FLUX.1-dev — LoRA: Ghibli-Style Story Illustration',
    mode: 'text_to_image',
    modelType: 'FluxDevPipeline',
    category: 'lora',
    tags: ['lora', 'ghibli', 'animation', 'story'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline', 'pinned LoRA adapter verification'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: FLUX_THEME_LORAS.ghibli },
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after adapter load',
    description: 'Personal-use-only original-character story illustration using the documented Ghibli adapter recipe.',
    presetId: 'flux_quality',
    example: example(9361, '2-6 min after adapter load', {
      width: 1024,
      height: 768,
      steps: 30,
      guidanceScale: 3.5,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(9361),
  },
  {
    id: 'flux_lora_oil_painting',
    label: 'FLUX.1-dev — LoRA: Textured Oil Painting',
    mode: 'text_to_image',
    modelType: 'FluxDevPipeline',
    category: 'lora',
    tags: ['lora', 'oil painting', 'painterly'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline', 'pinned LoRA adapter verification'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: FLUX_THEME_LORAS.oilPainting },
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after adapter load',
    description: 'Single-subject atmospheric oil painting tuned to the adapter author’s recommended 0.8–1.0 weight.',
    presetId: 'flux_quality',
    example: example(8451, '2-6 min after adapter load', {
      width: 1024,
      height: 1024,
      steps: 28,
      guidanceScale: 3.5,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(8451),
  },
  {
    id: 'flux_lora_film_noir',
    label: 'FLUX.1-dev — LoRA: Film-Noir Turning Point',
    mode: 'text_to_image',
    modelType: 'FluxDevPipeline',
    category: 'lora',
    tags: ['lora', 'film noir', 'cinematic', 'black and white'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline', 'pinned LoRA adapter verification'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: FLUX_THEME_LORAS.filmNoir },
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after adapter load',
    description: 'A readable newsroom crisis using the adapter’s documented FLMNR trigger and noir lighting language.',
    presetId: 'flux_quality',
    example: example(8452, '2-6 min after adapter load', {
      width: 1024,
      height: 1024,
      steps: 28,
      guidanceScale: 3.5,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(8452),
  },
  {
    id: 'flux_lora_retro_comic',
    label: 'FLUX.1-dev — LoRA: Retro Comic Emergency',
    mode: 'text_to_image',
    modelType: 'FluxDevPipeline',
    category: 'lora',
    tags: ['lora', 'retro comic', 'halftone', 'story'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline', 'pinned LoRA adapter verification'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: FLUX_THEME_LORAS.retroComic },
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after adapter load',
    description:
      'One decisive comic panel using the documented c0m1c trigger, v2 weight, halftone print, and concise dialogue.',
    presetId: 'flux_quality',
    example: example(9362, '2-6 min after adapter load', {
      width: 1024,
      height: 1024,
      steps: 28,
      guidanceScale: 3.5,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(9362),
  },
  {
    id: 'flux_lora_watercolor',
    label: 'FLUX.1-dev — LoRA: Alpine Watercolor',
    mode: 'text_to_image',
    modelType: 'FluxDevPipeline',
    category: 'lora',
    tags: ['lora', 'watercolor', 'aquarelle', 'paper'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline', 'pinned LoRA adapter verification'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: FLUX_THEME_LORAS.watercolor },
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after adapter load',
    description:
      'Clean-paper watercolor composition using the documented AQUACOLTOK trigger and restrained scene design.',
    presetId: 'flux_quality',
    example: example(9363, '2-6 min after adapter load', {
      width: 1024,
      height: 1024,
      steps: 28,
      guidanceScale: 3.5,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(9363),
  },
  {
    id: 'flux_lora_paper_cutout',
    label: 'FLUX.1-dev — LoRA: Layered Paper Folktale',
    mode: 'text_to_image',
    modelType: 'FluxDevPipeline',
    category: 'lora',
    tags: ['lora', 'paper cutout', 'folktale', 'layered'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline', 'pinned LoRA adapter verification'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: FLUX_THEME_LORAS.paperCutout },
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after adapter load',
    description: 'Original layered-paper folktale using the adapter’s exact Paper Cutout Style trigger.',
    presetId: 'flux_quality',
    example: example(8455, '2-6 min after adapter load', {
      width: 1024,
      height: 1024,
      steps: 28,
      guidanceScale: 3.5,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(8455),
  },
  {
    id: 'flux_lora_photoreal_documentary',
    label: 'FLUX.1-dev — LoRA: Wildlife Rescue Documentary',
    mode: 'text_to_image',
    modelType: 'FluxDevPipeline',
    category: 'lora',
    tags: ['lora', 'photoreal', 'documentary', 'wildlife'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline', 'pinned LoRA adapter verification'],
    workflowBlocks: ['lora'],
    workflowBlockSettings: { lora: FLUX_THEME_LORAS.photoreal },
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after adapter load',
    description: 'Photographic wildlife-clinic scene using the widely adopted XLabs FLUX realism adapter.',
    presetId: 'flux_quality',
    example: example(8456, '2-6 min after adapter load', {
      width: 1024,
      height: 1024,
      steps: 28,
      guidanceScale: 3.5,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(8456),
  },
  {
    id: 'flux_kontext_edit',
    label: 'FLUX.1-Kontext-dev — Image Edit: Material Replacement',
    mode: 'edit_image',
    modelType: 'FluxKontextPipeline',
    category: 'flux',
    tags: ['flux', 'kontext', 'edit'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, sampleAssets: ['source image'] },
    requiredBackendCapabilities: ['Diffusers image edit pipeline'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after source load',
    description: 'Guarded FLUX Kontext image edit recipe through generic Diffusers image nodes.',
    presetId: 'flux_kontext',
    example: example(8443, '2-6 min after source load', { steps: 28, guidanceScale: 3.5, resourceMode: 'expert' }),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(8443),
  },
  {
    id: 'flux_fill_inpaint',
    label: 'FLUX.1-Fill-dev — Inpaint: Masked Object Replacement',
    mode: 'inpaint',
    modelType: 'FluxFillPipeline',
    category: 'flux',
    tags: ['flux', 'fill', 'inpaint'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, maskImage: true, sampleAssets: ['source image', 'mask image'] },
    requiredBackendCapabilities: ['Diffusers image inpaint pipeline'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after source and mask load',
    description: 'Guarded FLUX Fill mask recipe through generic Diffusers image nodes.',
    presetId: 'flux_fill',
    example: example(8404, '2-6 min after source and mask load', {
      steps: 50,
      guidanceScale: 30,
      strength: 1,
      resourceMode: 'expert',
    }),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(8404),
  },
  {
    id: 'flux_control_canny',
    label: 'FLUX.1-Canny-dev — Control Image: Edge-Guided Architecture',
    mode: 'control_image',
    modelType: 'FluxCannyPipeline',
    category: 'flux',
    tags: ['flux', 'canny', 'control'],
    difficulty: 'advanced',
    inputRequirements: { controlImage: true, sampleAssets: ['control image'] },
    requiredBackendCapabilities: ['Diffusers image control pipeline'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after control image load',
    description: 'Guarded FLUX Canny control recipe through generic Diffusers image nodes.',
    presetId: 'flux_control',
    example: example(8405, '2-6 min after control image load', {
      steps: 50,
      guidanceScale: 30,
      resourceMode: 'expert',
    }),
    promptGuide: CONTROL_PROMPT_GUIDE,
    predictability: predictability(8405),
  },
  {
    id: 'flux_krea_text_to_image',
    label: 'FLUX.1-Krea-dev — Text to Image: Editorial Portrait',
    mode: 'text_to_image',
    modelType: 'FluxKreaPipeline',
    category: 'flux',
    tags: ['flux', 'krea', 'portrait'],
    difficulty: 'advanced',
    requiredBackendCapabilities: ['Diffusers image direct pipeline'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min',
    description: 'Natural editorial image generation with FLUX.1-Krea-dev.',
    presetId: 'flux_quality',
    example: example(8406, '2-6 min', { steps: 28, guidanceScale: 3.5, resourceMode: 'expert' }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(8406),
  },
  {
    id: 'flux_kontext_multi_reference',
    label: 'FLUX.1-Kontext-dev — Multi-Reference Edit: Material Transfer',
    mode: 'multi_image_reference_edit',
    modelType: 'FluxKontextPipeline',
    category: 'flux',
    tags: ['flux', 'kontext', 'multi-reference'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 2, sampleAssets: ['source image', 'material reference'] },
    requiredBackendCapabilities: ['Diffusers image edit pipeline'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after reference load',
    description: 'Preserve a primary image while transferring material cues from additional references.',
    presetId: 'flux_kontext',
    example: example(8407, '2-6 min after reference load', { steps: 28, guidanceScale: 3.5, resourceMode: 'expert' }),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(8407),
  },
  {
    id: 'flux_fill_outpaint',
    label: 'FLUX.1-Fill-dev — Outpaint: Canvas Expansion',
    mode: 'outpaint',
    modelType: 'FluxFillPipeline',
    category: 'flux',
    tags: ['flux', 'fill', 'outpaint'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: {
      sourceImage: true,
      maskImage: true,
      sampleAssets: ['expanded source canvas', 'boundary mask'],
    },
    requiredBackendCapabilities: ['Diffusers image inpaint pipeline'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after source load',
    description: 'Extend a source image through the generic FLUX Fill contract.',
    presetId: 'flux_fill',
    example: example(8408, '2-6 min after source load', {
      width: 1536,
      height: 1024,
      steps: 50,
      guidanceScale: 30,
      resourceMode: 'expert',
      outpaintLeft: 256,
      outpaintRight: 256,
      outpaintTop: 0,
      outpaintBottom: 0,
      outpaintOverlap: 24,
      outpaintFeather: 8,
      outpaintFillColor: 'black',
    }),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(8408),
  },
  {
    id: 'flux_depth_control',
    label: 'FLUX.1-Depth-dev — Control Image: Depth-Guided Architecture',
    mode: 'control_image',
    modelType: 'FluxDepthPipeline',
    category: 'flux',
    tags: ['flux', 'depth', 'control'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { controlImage: true, sampleAssets: ['depth control image'] },
    requiredBackendCapabilities: ['Diffusers image control pipeline'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after control load',
    description: 'Render appearance while retaining an authoritative depth layout.',
    presetId: 'flux_control',
    example: example(8409, '2-6 min after control load', { steps: 50, guidanceScale: 30, resourceMode: 'expert' }),
    promptGuide: CONTROL_PROMPT_GUIDE,
    predictability: predictability(8409),
  },
  {
    id: 'flux_redux_edit',
    label: 'FLUX.1-Redux-dev — Image Variation: Documentary Watchmaker',
    mode: 'edit_image',
    modelType: 'FluxReduxPipeline',
    category: 'flux',
    tags: ['flux', 'redux', 'edit'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, sampleAssets: ['source image'] },
    requiredBackendCapabilities: ['Diffusers image edit pipeline'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after source load',
    description:
      'Generate a natural documentary watchmaker variation from one visual reference with the FLUX Redux adapter.',
    presetId: 'flux_kontext',
    example: example(8410, '2-6 min after source load', { steps: 28, guidanceScale: 3.5, resourceMode: 'expert' }),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(8410),
  },
  {
    id: 'flux_redux_multi_reference',
    label: 'FLUX.1-Redux-dev — Multi-Reference Visual Blend: Rain Courier',
    mode: 'multi_image_reference_edit',
    modelType: 'FluxReduxPipeline',
    category: 'flux',
    tags: ['flux', 'redux', 'multi-reference', 'visual blend'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 2, sampleAssets: ['rainy underpass reference', 'bicycle courier reference'] },
    requiredBackendCapabilities: ['Diffusers image edit pipeline'],
    vramEstimate: '24 GB native or quantized/offloaded',
    runtimeEstimate: '2-6 min after reference load',
    description:
      'Blend two compatible photographic references into one documentary variation with Diffusers FLUX Redux.',
    presetId: 'flux_kontext',
    example: {
      ...example(8413, '2-6 min after reference load', {
        steps: 50,
        guidanceScale: 2.5,
        conditioningScale: 0.7,
        resourceMode: 'expert',
      }),
      status: 'reviewed',
      notes:
        'User-reviewed real-weight proof generated through the generic Diffusers graph with native weighted multi-reference Redux conditioning.',
    },
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(8413),
  },
  {
    id: 'flux2_klein_text_to_image',
    label: 'FLUX.2-klein-4B — Text to Image: Glass Material Study',
    mode: 'text_to_image',
    modelType: 'Flux2KleinPipeline',
    category: 'flux',
    tags: ['flux2', 'klein', 'product'],
    difficulty: 'starter',
    requiredBackendCapabilities: ['Diffusers image direct pipeline'],
    vramEstimate: '13 GB native or model offload',
    runtimeEstimate: 'About 13 min cold; under 1 min after the model is resident',
    description: 'Fast four-step product generation through the generic Diffusers image façade.',
    presetId: 'flux_fast',
    example: example(173, 'About 13 min cold; under 1 min after the model is resident', {
      steps: 4,
      guidanceScale: 1,
      resourceMode: 'auto',
    }),
    promptGuide: BASE_PROMPT_GUIDE,
    predictability: predictability(173),
  },
  {
    id: 'flux2_klein_edit',
    label: 'FLUX.2-klein-4B — Image Edit: Material Change',
    mode: 'edit_image',
    modelType: 'Flux2KleinPipeline',
    category: 'flux',
    tags: ['flux2', 'klein', 'edit'],
    difficulty: 'starter',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, sampleAssets: ['source image'] },
    requiredBackendCapabilities: ['Diffusers image edit pipeline'],
    vramEstimate: '13 GB native or model offload',
    runtimeEstimate: 'About 12 sec with the model resident; about 13 min cold',
    description: 'A preservation-focused single-reference material transformation.',
    presetId: 'flux_kontext',
    example: example(174, 'About 12 sec with the model resident; about 13 min cold', {
      steps: 4,
      guidanceScale: 1,
      resourceMode: 'auto',
    }),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(174),
  },
  {
    id: 'flux2_klein_multi_reference',
    label: 'FLUX.2-klein-4B — Multi-Reference Edit: Material Fusion',
    mode: 'multi_image_reference_edit',
    modelType: 'Flux2KleinPipeline',
    category: 'flux',
    tags: ['flux2', 'klein', 'multi-reference'],
    difficulty: 'intermediate',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { referenceImages: 2, sampleAssets: ['composition reference', 'material reference'] },
    requiredBackendCapabilities: ['Diffusers image edit pipeline'],
    vramEstimate: '13 GB native or model offload',
    runtimeEstimate: 'About 37 sec with the model resident; about 13 min cold',
    description: 'Two-reference fusion through the same model-neutral edit node.',
    presetId: 'flux_kontext',
    example: example(175, 'About 37 sec with the model resident; about 13 min cold', {
      steps: 4,
      guidanceScale: 1,
      resourceMode: 'auto',
    }),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(175),
  },
  {
    id: 'wan_vace_video_to_video',
    label: 'Wan 2.1 T2V 1.3B — Video to Video: Rainy Courtyard Cat',
    mode: 'video_to_video',
    modelType: 'WanVideoPipeline',
    category: 'video_edit',
    tags: ['wan', 'video-to-video', 'photoreal', 'cat', 'courtyard', 'environment restyle'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceVideo: true, sampleAssets: ['source video'] },
    requiredBackendCapabilities: ['Diffusers video direct pipeline', 'modules.Video.Load'],
    vramEstimate: '24 GB with offload',
    runtimeEstimate: 'About 35-65 min for 81 frames and 50 steps on the qualified high-memory ROCm host',
    description:
      'Move a walking cat from a daylight lawn into a rain-dark courtyard while preserving its gait and identity.',
    presetId: 'video_balanced',
    example: videoExample(8412, 'About 35-65 min on the qualified high-memory ROCm host', {
      numFrames: 81,
      steps: 50,
      // Match the upstream Diffusers Wan video-to-video example. The earlier
      // 0.35 proof preserved the source but failed the requested semantic edit.
      strength: 0.7,
      guidanceScale: 5,
    }),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8412),
  },
  {
    id: 'ltx_video_long_showcase',
    label: 'LTX-Video — Long Video: The Last Signal',
    mode: 'image_to_video',
    modelType: 'LTXVideoPipeline',
    category: 'video_generation',
    tags: ['video', 'long-form', 'sequence', 'road thriller', 'story', 'ltx'],
    difficulty: 'advanced',
    inputRequirements: {
      referenceImages: 6,
      sampleAssets: [
        'wet hairpin opening keyframe',
        'pine-road opening keyframe',
        'closed-road lateral-dolly keyframe',
        'snow-ridge opening keyframe',
        'weather-station approach keyframe',
        'weather-station crane-finale keyframe',
      ],
    },
    videoDelivery: 'spatial_upscale',
    requiredBackendCapabilities: [
      'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
      'modules.DiffusersVideo.BuildShotJobs',
      'modules.DiffusersVideo.GenerateShotJob',
      'visual collection loops',
      'modules.Video.ConcatenateAssets',
    ],
    workflowBlocks: ['quality_video_sequence'],
    workflowBlockSettings: {
      qualityVideoSequence: {
        mode: 'image_to_video',
        fps: 16,
        width: 768,
        height: 512,
        steps: 8,
        guidanceScale: 1,
        conditioningStrength: 0.9,
        transitionSeconds: 0,
        shotsJson: JSON.stringify([
          {
            title: 'The Dispatch',
            seed: 718268,
            duration_seconds: 5,
            conditioning_strength: 0.7,
            prompt:
              'Photoreal wet mountain hairpin. The white vintage rally coupe stays parked with rigid tires, black hood, lamps and body unchanged. Camera immediately slides laterally and pushes closer, carrying the complete car across frame while curve, gravel, guardrail and firs create strong parallax. Rain and reflections move naturally. No wheel rotation, vehicle motion, smoke, deformed tire, changing car, person, text, morph, cut or static hold.',
          },
          {
            title: 'Through the Pines',
            seed: 718242,
            duration_seconds: 5,
            conditioning_strength: 1,
            prompt:
              'Locked low camera behind the supplied pine road. The same white rally coupe accelerates away immediately, becoming smaller but recognizable near the left bend at the end. Preserve the existing double yellow centerline exactly from frame one. Trees, road edges and reflector posts stay rigid while wheel spray trails and settles. Preserve the fastback, spoiler and four wheels. No pan, new marking, sign, person, crash, morph, text or cut.',
          },
          {
            title: 'The Dead End',
            seed: 718263,
            duration_seconds: 5,
            conditioning_strength: 0.7,
            prompt:
              'Five-second photoreal low lateral dolly past the stopped white vintage rally coupe at a blocked mountain road. Camera motion starts in frame one and travels rapidly right across the pale gravel, creating strong foreground parallax while the complete parked car, red-white barrier, wet asphalt bend, forest and mountains remain rigid. Wind moves grass and rain crosses frame. Preserve four grounded wheels, black hood, lamps and body. No vehicle motion, reverse motion, morph, duplicated car, changing barrier, text, cut or static hold.',
          },
          {
            title: 'Above the Snow Line',
            seed: 718204,
            duration_seconds: 5,
            conditioning_strength: 0.95,
            prompt:
              'Locked rear camera on the supplied snow ridge. The white rally coupe drives away immediately, becomes smaller and reaches the far bend near the weather mast. Wheels rotate, light powder trails behind and every snow pole stays fixed. Preserve the rigid fastback, spoiler, four tires and plausible traction. No pan, people, avalanche, morph, text or cut.',
          },
          {
            title: 'The Last Signal',
            seed: 718245,
            duration_seconds: 5,
            conditioning_strength: 1,
            prompt:
              'Locked station-entrance camera. The complete white vintage rally coupe rolls less than one car length toward screen left, then brakes before the gray door and remains fully visible. Wheels rotate slowly and small gravel spray settles. Preserve the exact car, door, stone wall, roof, mast, mountains and road geometry. The car never touches the building or frame edge. No distant road, disappearance, person, sign, morph, text or cut.',
          },
          {
            title: 'Tower in Sight',
            seed: 718267,
            duration_seconds: 5,
            conditioning_strength: 0.7,
            prompt:
              'Photoreal rear view on the supplied mountain road. The same white rally coupe drives continuously uphill toward the weather station without changing its fastback, spoiler or tires. Keep the complete tower and antenna centered above the wet curve while guardrails and snow poles create strong parallax. Wheel spray, rain and storm clouds move naturally. No reversing, new structure, bent antenna, person, text, morph, cut or static hold.',
          },
        ]),
      },
    },
    vramEstimate: '32 GB VRAM or 64 GB unified memory; sequential app-managed shots',
    runtimeEstimate: 'About 15-35 min for six keyframe-locked distilled shots plus per-shot 2x delivery upscale',
    description:
      'Animate six authored keyframes inside a visible retryable loop, retain every segment, and join them into a meaningful 30-second emergency journey.',
    presetId: 'ltx_video_balanced',
    example: videoExample(
      8510,
      'About 15-35 min on the qualified host',
      { width: 768, height: 512, numFrames: 81, fps: 16, steps: 8, guidanceScale: 1 },
      {
        frames: 486,
        durationSeconds: 30.38,
        maximumNearBlackFrameRatio: 0.35,
        minimumActiveMotionWindowRatio: 0.65,
        maximumLowMotionFrameRatio: 0.4,
      },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8510),
  },
  {
    id: 'wan_video_long_showcase',
    label: 'Wan 2.1 T2V 1.3B — Long Video: Before Sunrise',
    mode: 'text_to_video',
    modelType: 'WanVideoPipeline',
    category: 'video_generation',
    tags: ['video', 'long-form', 'sequence', 'port logistics', 'documentary', 'story', 'wan'],
    difficulty: 'advanced',
    inputRequirements: {},
    requiredBackendCapabilities: ['modules.DiffusersVideo.GenerateSequence', 'modules.Video.Compose'],
    workflowBlocks: ['video_sequence'],
    workflowBlockSettings: {
      videoSequence: {
        transitionSeconds: 0,
        promptsJson: JSON.stringify([
          'Photoreal predawn port documentary. One orange shipping container rises immediately from a cargo ship hold on four taut crane cables while a stabilized camera cranes beside it and rigid blue container stacks pass behind. Preserve the orange box shape, corner castings and plausible cable tension; no close people, water spectacle, collision, text or cut.',
          'Continue the same orange container crossing high above the quay on a ship-to-shore gantry trolley. A parallel camera tracks briskly as crane beams and container rows sweep past in layered parallax. Stable rigid geometry, controlled sway and cool predawn work lights; no dropped load, duplicate container, text or cut.',
          'Continue as the same orange container lowers squarely onto one terminal tractor trailer and the twist locks engage. A low three-quarter camera moves with the simple operation, then the tractor pulls forward. Plausible contact, wheel rotation and scale; no people in close view, collision, extra load, text or cut.',
          'Continue the orange container journey through ordered terminal lanes. The tractor drives steadily between tall rigid stacks while a side-tracking camera keeps the complete vehicle visible and near lane markers cross the frame. Stable container identity, wheels and architecture; no crash, warped stacks, text or cut.',
          'Photoreal logistics finale at dawn. A rail crane places the same orange container onto a departing freight wagon; after secure contact, the loaded train moves toward sunrise as a low camera pans beside rotating wheels. Preserve one container, rigid wagon geometry and plausible rail contact; no people in close view, collision, text or cut.',
        ]),
      },
    },
    vramEstimate: '24 GB with sequential offload',
    runtimeEstimate: 'About 4 hr 40 min-7 hr 50 min for five upstream-quality 50-step Wan shots plus upscale',
    description: 'Generate and compose five readable logistics operations into one purposeful predawn cargo journey.',
    presetId: 'video_balanced',
    example: videoExample(
      8511,
      'About 4 hr 40 min-7 hr 50 min on the qualified host',
      { numFrames: 81, fps: 16, steps: 50 },
      { frames: 405, durationSeconds: 25.31, maximumNearBlackFrameRatio: 0.7 },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8511),
  },
  {
    id: 'wan_21_t2v_13b_seed_vault',
    label: 'Wan 2.1 T2V 1.3B — Long Video: The Winter Delivery',
    mode: 'text_to_video',
    modelType: 'WanVideoPipeline',
    category: 'video_generation',
    tags: [
      'wan 2.1',
      'text-to-video',
      'photoreal',
      'railway documentary',
      'story',
      '30 seconds',
      'loop',
      'qualified hardware',
    ],
    difficulty: 'advanced',
    inputRequirements: {},
    requiredBackendCapabilities: [
      'modules.DiffusersVideo.BuildShotJobs',
      'modules.DiffusersVideo.GenerateShotJob',
      'visual collection loops',
      'modules.Video.ConcatenateAssets',
    ],
    workflowBlocks: ['quality_video_sequence'],
    workflowBlockSettings: {
      qualityVideoSequence: {
        mode: 'text_to_video',
        fps: 15,
        width: 832,
        height: 480,
        steps: 50,
        guidanceScale: 6,
        transitionSeconds: 0.15,
        shotsJson: JSON.stringify([
          {
            title: 'The Dispatch',
            duration_seconds: 5.4,
            prompt:
              'Photoreal railway-documentary opening. One blue-and-cream electric freight locomotive immediately pulls six sealed supply wagons out of a compact mountain depot with plain unmarked gray walls before a storm. A low trackside camera pans with the full rigid locomotive as wheels rotate and bare utility poles cross the frame. Preserve blue-and-cream paint, two front windows, one headlamp, six gray wagons and plausible rail contact; no wall sign, symbol, writing, people, duplicate train, collision or cut.',
          },
          {
            title: 'Valley Switches',
            duration_seconds: 5.4,
            prompt:
              'Continue the emergency supply journey with the same blue-and-cream electric locomotive and six sealed gray wagons. The train moves briskly through ordinary valley switches while a stabilized side camera tracks beside it and near switch stands sweep past. Preserve locomotive proportions, paint, wagon count, forward screen direction and rotating wheels; natural overcast light, no people, collision, text or cut.',
          },
          {
            title: 'Rock Tunnel',
            duration_seconds: 5.4,
            prompt:
              'Continue the same blue-and-cream supply train approaching and entering one real stone railway tunnel. A low three-quarter chase camera follows as tunnel marker posts and the portal grow rapidly, the headlamp brightens and the complete locomotive remains on both rails. Stable bodywork, six sealed wagons and plausible motion blur; no people, cave fantasy, collision, text or cut.',
          },
          {
            title: 'The High Pass',
            duration_seconds: 5.4,
            prompt:
              'Continue the same blue-and-cream electric freight train emerging into a snowy alpine pass. A parallel moving camera keeps the full locomotive and first wagons visible while snow poles cross both card edges and windblown powder travels across the tracks. Preserve rigid geometry, rail contact, forward screen direction and restrained gray daylight; no avalanche, people, collision, text or cut.',
          },
          {
            title: 'Village Ahead',
            duration_seconds: 5.4,
            prompt:
              'Continue the emergency train descending toward one isolated alpine village now clearly visible ahead. The same blue-and-cream locomotive and six gray wagons round a broad safe curve while a high roadside camera tracks forward; near catenary poles pass quickly and warm station lights grow. Stable railway geometry and realistic speed; no people in close view, derailment, text or cut.',
          },
          {
            title: 'Supplies Arrive',
            duration_seconds: 5.4,
            prompt:
              'Photoreal railway-documentary finale. The same blue-and-cream supply locomotive enters the small village station, brakes naturally and stops with its six sealed wagons beside the lit freight platform as the station signal changes from red to green. A low camera dollies backward then settles on the complete train and station, clearly showing delivery. Stable wheels, rails and architecture; no people in close view, opening cargo, text or cut.',
          },
        ]),
      },
    },
    vramEstimate: 'About 20 GB accelerator memory in resident BF16 on the qualified Radeon host',
    runtimeEstimate: 'About 49 minutes per 5.4-second shot; roughly five hours for six shots plus composition',
    description:
      'Tell a chronological emergency-supply railway story, pin every source segment for re-editing, and join them inside a visible retryable loop.',
    presetId: 'wan_t2v_13b_quality',
    example: videoExample(
      48117,
      'About five hours on the qualified Radeon 8060S host',
      { width: 832, height: 480, numFrames: 81, fps: 15, steps: 50, guidanceScale: 6, shift: 8 },
      { frames: 486, durationSeconds: 31.65 },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(48117),
  },
  {
    id: 'wan_22_ti2v_5b_seed_vault',
    label: 'Wan 2.2 TI2V 5B — Music Video with ACE-Step: Subway Musician',
    mode: 'text_to_video',
    modelType: 'WanTI2VPipeline',
    category: 'video_generation',
    tags: ['wan 2.2', 'ace-step', 'text-to-video', 'music video', 'street musician', 'generated soundtrack'],
    difficulty: 'intermediate',
    inputRequirements: {},
    videoDelivery: 'native',
    requiredBackendCapabilities: [
      'modules.DiffusersVideo.LoadPipeline',
      'modules.DiffusersVideo.Generate',
      'modules.DiffusersAudio.LoadPipeline',
      'modules.DiffusersAudio.Generate',
      'modules.Audio.FitDuration',
      'modules.Video.ExportWithAudio',
    ],
    workflowBlocks: ['soundtrack'],
    workflowBlockSettings: {
      soundtrack: {
        model: {
          source: 'hub',
          value: 'ACE-Step/acestep-v15-xl-turbo-diffusers',
          revision: '200ba991ae448051e14b0183157e35c2d27c9fb0',
        },
        pipelineClass: 'AceStepPipeline',
        prompt:
          'Instrumental diegetic solo acoustic-guitar soundtrack matching existing subway footage. For the entire twelve seconds, perform forceful uninterrupted 84 BPM eighth-note down-up chord strumming on one warm steel-string acoustic guitar. Start the established strumming pattern immediately and keep its energy, tempo, and full-chord attack constant past ten seconds. Use a clear alternating downstroke-upstroke pick pattern, realistic pick attack, and natural fret noise, with no pauses or melodic detours. Do not cadence, resolve, decay, slow down, thin out, or stop early; the usable soundtrack will be cut from the middle of this continuous performance. Keep subtle station room ambience far beneath the guitar. No fingerpicking, arpeggio, lead melody, vocals, spoken words, drums, percussion, bass, band, synthesizer, applause, crowd cheering, fade-in, fade-out, or early ending.',
        negativePrompt:
          'fingerpicking, fingerpicked riff, arpeggio, arpeggiated guitar, lead guitar, lead melody, guitar solo, single-note melody, sparse picking, gentle picking, vocals, singing, speech, drums, percussion, bass guitar, full band, synthesizer, electronic beat, applause, crowd cheering, silence, pause, breakdown, cadence, final chord, early resolution, early decay, early ending, long intro, fade-in, fade-out, clipping, abrupt cutoff',
        durationSeconds: 12,
        steps: 8,
        guidanceScale: 1,
        seed: 1684710282,
        bpm: 84,
        keyscale: 'E minor',
        timesignature: '4/4',
        audioFit: {
          sourceStartSeconds: 1,
          sourceDurationSeconds: 121 / 24,
          targetDurationSeconds: 121 / 24,
          delaySeconds: 4 / 24,
          targetSampleRate: 48000,
          fadeInSeconds: 0.008,
          fadeOutSeconds: 0.12,
        },
      },
    },
    vramEstimate:
      'About 32 GB resident BF16 on the qualified Radeon host; smaller systems require a qualified Diffusers offload recipe',
    runtimeEstimate:
      'Estimated about 3 hr 45 min for the official 50-step Wan shot plus under one minute for ACE-Step and muxing',
    description:
      'Generate the cinematic subway-musician shot, an editable ACE-Step guitar soundtrack, and one muxed MP4.',
    presetId: 'wan_ti2v_quality',
    example: videoExample(
      898471028164125,
      'Estimated about 3 hr 45 min on the qualified Radeon 8060S host',
      { width: 1280, height: 704, numFrames: 121, fps: 24, steps: 50, guidanceScale: 5, shift: 8 },
      { frames: 121, durationSeconds: 5.04, requiresAudio: true },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(898471028164125),
  },
  {
    id: 'wan_22_i2v_seed_vault',
    label: 'Wan 2.2 I2V A14B — Image to Video: Final Mise en Place',
    mode: 'image_to_video',
    modelType: 'WanImageToVideoPipeline',
    category: 'video_generation',
    tags: ['wan 2.2', 'image-to-video', 'photoreal', 'fine dining', 'chef', 'food preparation', 'five seconds'],
    difficulty: 'advanced',
    inputRequirements: {
      referenceImages: 1,
      sampleAssets: ['identity-locked fine-dining kitchen opening keyframe'],
    },
    videoDelivery: 'native',
    requiredBackendCapabilities: [
      'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
      'modules.DiffusersVideo.LoadPipeline',
      'modules.DiffusersVideo.Generate',
      'modules.Video.ExportAsset',
    ],
    vramEstimate:
      'About 85 GB peak resident BF16 with tiled VAE conditioning on the qualified host; model offload is available on smaller systems',
    runtimeEstimate: 'About 6 hr 25-40 min for the recommended 40-step resident-BF16 recipe on this Radeon host',
    description:
      'Follow one chef completing a single controlled carrot-garnish cut for a composed root-vegetable course in a five-second, quality-first kitchen shot.',
    presetId: 'wan_i2v_quality',
    example: videoExample(
      92021,
      'About 6 hr 25-40 min on the qualified Radeon 8060S host',
      {
        width: 768,
        height: 512,
        numFrames: 81,
        fps: 16,
        steps: 40,
        guidanceScale: 3.5,
        guidanceScale2: 3.5,
      },
      { frames: 81, durationSeconds: 5.06 },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(92021),
  },
  {
    id: 'ltx_video_animated_story',
    label: 'LTX-Video — Text to Video: From Green Bean to Morning Cup',
    mode: 'text_to_video',
    modelType: 'LTXVideoPipeline',
    category: 'video_generation',
    tags: ['video', 'photoreal', 'coffee roasting', 'food process', 'story', 'ltx'],
    difficulty: 'intermediate',
    inputRequirements: {},
    videoDelivery: 'spatial_upscale',
    requiredBackendCapabilities: [
      'modules.DiffusersVideo.GenerateSequence',
      'modules.Video.Compose',
      'modules.Spandrel.Upscaler',
    ],
    workflowBlocks: ['video_sequence', 'upscaler'],
    workflowBlockSettings: {
      videoSequence: {
        transitionSeconds: 0,
        promptsJson: JSON.stringify([
          {
            prompt:
              'Five-second live-action coffee roastery. Pale sage-green unroasted coffee beans cascade immediately from a burlap chute into one steel hopper. Every bean is a small oval with one straight central crease, never round like a pea or long like a peanut. A close side camera trucks beside the falling beans as the hopper rim crosses the foreground. Natural gravity, dry matte texture and morning window light. No people, hands, nuts, plastic pellets, glass, writing, spill, cut or hold.',
            seed: 8622,
          },
          {
            prompt:
              'Five-second live-action coffee roastery. Chestnut-brown roasted coffee beans tumble continuously across one perforated steel cooling tray while its rigid sweep arm rotates clockwise. A low close camera arcs around the tray, revealing warm bean texture, light chaff and stable attached machinery. No people, raw beans, plastic pellets, smoke, fire, writing, logo, cut or hold.',
            seed: 8613,
          },
          {
            prompt:
              'Five-second live-action coffee finale. One plain white demitasse filled with dark espresso and golden crema sits alone on a walnut table. A close table-level camera makes a steady clockwise half-orbit for all five seconds, creating clear background parallax. Two natural steam ribbons twist upward continuously while tiny crema bubbles rotate and pop. Preserve the rigid cup, round rim, handle and table contact. No machine, utensil, person, second cup, letters, numbers, logo, warped ceramic, cut, freeze or hold.',
            seed: 8644,
          },
        ]),
      },
      upscaler: VIDEO_DELIVERY_UPSCALER,
    },
    vramEstimate: '32 GB VRAM or 64 GB unified memory',
    runtimeEstimate: 'About 15-30 min for three distilled shots plus 2× delivery upscale',
    description: 'A 15-second three-stage coffee story from raw beans through roasting to one finished espresso.',
    presetId: 'ltx_video_balanced',
    example: videoExample(
      8512,
      'About 18-35 min on the qualified host',
      { width: 768, height: 512, numFrames: 81, fps: 16, steps: 8, guidanceScale: 1 },
      { frames: 243, durationSeconds: 15.19, maximumNearBlackFrameRatio: 0.7 },
    ),
    promptGuide: VIDEO_PROMPT_GUIDE,
    predictability: videoPredictability(8512),
  },
  {
    id: 'ace_step_lyric_music_video',
    label: 'ACE-Step Audio — Lyrics to Music Video: Moonflower Night',
    mode: 'text_to_audio',
    modelType: 'AceStepAudioPipeline',
    category: 'audio_generation',
    tags: ['audio', 'video', 'lyrics', 'music video', 'ace-step', 'ltx', 'photoreal', 'story'],
    difficulty: 'advanced',
    thumbnailVariant: 'audio',
    inputRequirements: {},
    outputKinds: ['video', 'audio'],
    requiredBackendCapabilities: [
      'modules.DiffusersAudio.Generate',
      'modules.DiffusersVideo.GenerateSequence',
      'modules.Audio.FitDuration',
      'modules.Video.LyricOverlay',
      'modules.Video.ExportWithAudio',
    ],
    workflowBlocks: ['lyric_video'],
    workflowBlockSettings: {
      lyricVideo: {
        visualModel: {
          source: 'hub',
          value: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
          revision: '7c64400e1861cc0d7b98d570a1926d5408ec60cd',
        },
        transitionSeconds: 0.35,
        ['fontSize']: 58,
        bottomMargin: 70,
        audio: {
          prompt:
            "Dream-pop at 100 BPM in C-sharp minor and 4/4. A clear English lead vocal starts on the first beat and sings each of the six supplied lines exactly once, in order, one line every two bars. Finish the final words 'the dawn' by bar 12, then leave a short instrumental tail. Soft electronic drums, warm bass, glassy arpeggiator, polished spacious stereo. No intro, interlude, ad-libs, repeated lines, omitted words, or fade.",
          lyrics:
            '[Verse]\nDaylight leaves the garden wall\nSilver buds begin to call\nWhite petals turn into the night\nEvery vine unfolds its light\nStars grow pale above the lawn\nMoonflowers hold until the dawn',
          durationSeconds: 30,
          steps: 8,
          guidanceScale: 1,
          shift: 3,
          seed: 1201047366,
          bpm: 100,
          keyscale: 'C# minor',
          timesignature: '4',
          vocalLanguage: 'en',
        },
        audioFit: {
          sourceStartSeconds: 0,
          sourceDurationSeconds: 30,
          targetDurationSeconds: 381 / 16,
          delaySeconds: 0,
          targetSampleRate: 48000,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
        },
        lrc: '[00:00.00]Daylight leaves the garden wall\n[00:03.26]Silver buds begin to call\n[00:07.44]White petals turn into the night\n[00:11.38]Every vine unfolds its light\n[00:15.08]Stars grow pale above the lawn\n[00:18.90]Moonflowers hold until the dawn',
        promptsJson: JSON.stringify([
          'Photoreal music-video opening without visible text. At blue dusk, a stabilized camera glides low beside a real garden wall as closed white moonflower buds and heart-shaped leaves stream past in foreground parallax. Wind moves every vine from frame one while the last warm daylight visibly fades. Natural plant anatomy and restrained color; no people, fantasy glow, illustration, duplicate stems or static hold.',
          'Photoreal macro time-lapse in the same garden. One healthy white moonflower bud opens continuously into a complete trumpet-shaped bloom while nearby leaves sway in an evening breeze. The camera makes a slow curved move, keeping the flower center sharp and the stone wall softly behind it. Preserve realistic petals and stem attachment; no hands, insects, melting, extra petals, text or frozen interval.',
          'Photoreal moonlit tracking shot along a mature trellis covered in fully opened white moonflowers. The camera travels steadily between foreground leaves while several blooms turn gently in the wind and soft cloud shadows cross the wall. Clear depth and natural silver-blue light; no people, fantasy particles, artificial neon, warped vines, lettering or static frame.',
          'Photoreal close passage through the moonflower canopy after a brief shower. The camera pushes forward continuously as round droplets roll down broad leaves, flexible stems rebound in the breeze and white blossoms pass close to both edges. Keep flowers crisp, attached and naturally wet; no flood, impossible water, insects, people, text, synthetic render or sudden jump.',
          'Photoreal dawn finale in the same garden. A wide camera cranes slowly upward from open white moonflowers toward a pale gold horizon while vines ripple, clouds travel and the first sunlight moves across the wall. The flowers remain stable and recognizable through the closing frame. No people, fantasy glow, melting petals, duplicate blooms, text, illustration or static hold.',
        ]),
      },
    },
    vramEstimate: 'ACE-Step and LTX run sequentially with model offload',
    runtimeEstimate: 'About 20-45 min plus listening and lyric-sync review',
    description:
      'Generate an original lyric song and a five-shot photoreal dusk-to-dawn moonflower story with timed lyrics and a muxed 20-30 second final video.',
    presetId: 'audio_balanced',
    example: {
      ...audioExample(1201047366, 'About 20-45 min on the qualified host', {
        audioDuration: 30,
        lyrics:
          '[Verse]\nDaylight leaves the garden wall\nSilver buds begin to call\nWhite petals turn into the night\nEvery vine unfolds its light\nStars grow pale above the lawn\nMoonflowers hold until the dawn',
        bpm: 100,
        timesignature: '4',
      }),
      mediaType: 'video',
      expectedOutput: {
        width: 1536,
        height: 1024,
        frames: 381,
        durationSeconds: 23.81,
        requiresAudio: true,
        minimumMotionCoverage: 0.75,
        minimumAdjacentMotionCoverage: 0.08,
        minimumEndToEndMotionCoverage: 0.5,
      },
    },
    promptGuide: AUDIO_PROMPT_GUIDE,
    predictability: predictability(8513),
  },
  {
    id: 'qwen_edit_plus_single_image',
    label: 'Qwen-Image-Edit-2511 — Image Edit: Single-Image Restyling',
    mode: 'edit_image',
    modelType: 'QwenImageEditPlusModularPipeline',
    category: 'edit',
    tags: ['qwen', 'edit', 'single-image'],
    difficulty: 'advanced',
    thumbnailVariant: 'compareSlider',
    inputRequirements: { sourceImage: true, sampleAssets: ['source product image'] },
    requiredBackendCapabilities: ['Modular Diffusers Qwen Image Edit Plus'],
    vramEstimate:
      '64 GB native BF16 on the qualified high-memory host; lower-memory quantized/offloaded recipes require separate hardware qualification',
    runtimeEstimate:
      'About 19-21 min once resident; about 60-65 min including a cold native-BF16 load on the qualified ROCm host',
    description: 'A single-source edit using the same generic modular contract as multi-reference Qwen.',
    presetId: 'balanced',
    example: example(
      8501,
      'About 19-21 min once resident; about 60-65 min including a cold native-BF16 load on the qualified ROCm host',
      { steps: 40, guidanceScale: 4, resourceMode: 'auto' },
    ),
    promptGuide: EDIT_PROMPT_GUIDE,
    predictability: predictability(8501),
  },
];

function withVideoDeliveryWorkflow(template: StudioTemplateSource, index: number): StudioTemplate {
  const generatedInputBindings = templateDefaultInputBindings(template.id, index);
  const explicitTemplateInputBindings =
    template.inputBindings?.filter((binding) => binding.origin === 'template') ?? [];
  const overriddenTemplateFields = new Set(explicitTemplateInputBindings.map((binding) => binding.field));
  const normalized = withTemplateRecipeDefaults(
    {
      ...template,
      inputBindings: [
        ...(template.inputBindings ?? []).filter((binding) => binding.origin !== 'template'),
        ...generatedInputBindings.filter(
          (binding) => binding.origin !== 'template' || !overriddenTemplateFields.has(binding.field),
        ),
        ...explicitTemplateInputBindings,
      ],
    },
    TEMPLATE_PROMPTS[index]!,
    index,
  );
  if (!normalized.outputKinds?.includes('video')) return normalized;
  if (normalized.videoDelivery === 'native') return normalized;
  const lyricVideo = normalized.workflowBlocks?.includes('lyric_video') === true;
  const expectedOutput = normalized.example?.expectedOutput;
  const deliveredExample =
    !lyricVideo && normalized.example && expectedOutput?.width && expectedOutput?.height
      ? {
          ...normalized.example,
          expectedOutput: {
            ...expectedOutput,
            width: expectedOutput.width * 2,
            height: expectedOutput.height * 2,
          },
        }
      : normalized.example;
  return {
    ...normalized,
    example: deliveredExample,
    inputRequirements: { ...normalized.inputRequirements, upscalerModel: true },
    requiredBackendCapabilities: [
      ...new Set([...(normalized.requiredBackendCapabilities ?? []), 'modules.Spandrel.Upscaler']),
    ],
    workflowBlocks: lyricVideo
      ? normalized.workflowBlocks
      : [...new Set([...(normalized.workflowBlocks ?? []), 'upscaler' as const])],
    workflowBlockSettings: {
      ...normalized.workflowBlockSettings,
      upscaler: normalized.workflowBlockSettings?.upscaler ?? VIDEO_DELIVERY_UPSCALER,
    },
  };
}

const NORMALIZED_STUDIO_TEMPLATES: StudioTemplate[] = BASE_STUDIO_TEMPLATES.map(withVideoDeliveryWorkflow);

// Failed qualification contracts stay available to planning/reporting code, but
// never appear as runnable browser templates. A template returns to the browser
// only after its app-managed proof and modality review remove the blocked state.
export const PLANNING_STUDIO_TEMPLATES: StudioTemplate[] = NORMALIZED_STUDIO_TEMPLATES.filter(
  (template) => template.example?.status === 'blocked',
);

export const STUDIO_TEMPLATES: StudioTemplate[] = NORMALIZED_STUDIO_TEMPLATES.filter(
  (template) => template.example?.status !== 'blocked',
);

export function getPreset(id: string | undefined) {
  return STUDIO_PRESETS.find((preset) => preset.id === id);
}
