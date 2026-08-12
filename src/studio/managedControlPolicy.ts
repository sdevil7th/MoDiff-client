import type { NodeParams } from '../stores/useNodeStore';
import type { StudioFormState, StudioGraphRole } from './types';

/**
 * Essential controls belong on the compact managed stage surface. Advanced
 * controls are available to an explicit advanced/Expert surface. Internal
 * fields are graph plumbing or generated outputs and must not be editable.
 */
export type ManagedControlTier = 'essential' | 'advanced' | 'internal';
export type ManagedControlSurface = 'main' | 'advanced' | 'hidden';
export type ManagedControlFormKey = keyof StudioFormState;

export type ManagedControlRole =
  | StudioGraphRole
  | 'loraAdapter'
  | 'upscaler'
  | 'upscalePreview'
  | 'videoSequence'
  | 'videoCompose'
  | 'lyricOverlay'
  | 'exportWithAudio'
  | 'soundtrackQuantization'
  | 'soundtrackRecipe'
  | 'soundtrackPipeline'
  | 'soundtrackGenerate'
  | 'soundtrackAudioFit'
  | 'lyricAudioFit'
  | 'lyricVideoPipeline'
  | 'lyricVideoQuantization'
  | 'lyricVideoRecipe'
  | 'qualityVideoQuantization'
  | 'qualityVideoRecipe'
  | 'qualityVideoShots'
  | 'qualityVideoJobs'
  | 'qualityVideoLoopItems'
  | 'qualityVideoGenerate'
  | 'qualityVideoRetain'
  | 'qualityVideoLoopResult'
  | 'qualityVideoJoin';

export type ManagedControlPolicy = Readonly<{
  formKey?: ManagedControlFormKey;
  tier: ManagedControlTier;
}>;

export type ManagedControlClassification = ManagedControlPolicy & {
  source: 'field-option' | 'role-policy' | 'structural' | 'unknown';
  surface: ManagedControlSurface;
};

export type ManagedControlParamMetadata = Pick<NodeParams, 'display' | 'fieldOptions' | 'hidden' | 'isInput'>;

type RolePolicy = Readonly<Record<string, ManagedControlPolicy>>;

const essential = (formKey?: ManagedControlFormKey): ManagedControlPolicy => ({
  tier: 'essential',
  ...(formKey ? { formKey } : {}),
});
const advanced = (formKey?: ManagedControlFormKey): ManagedControlPolicy => ({
  tier: 'advanced',
  ...(formKey ? { formKey } : {}),
});
const internal = (): ManagedControlPolicy => ({ tier: 'internal' });

const IMAGE_GENERATION_POLICY = {
  prompt: essential('prompt'),
  negative_prompt: essential('negativePrompt'),
  width: essential('width'),
  height: essential('height'),
  seed: essential('seed'),
  num_inference_steps: essential('steps'),
  steps: essential('steps'),
  guidance_scale: essential('guidanceScale'),
  guidance: essential('guidanceScale'),
  true_cfg_scale: essential('guidanceScale'),
  pag_scale: essential('pagScale'),
  pag_adaptive_scale: advanced('pagAdaptiveScale'),
  strength: essential('strength'),
  denoise_strength: essential('strength'),
  reference_strength: essential('conditioningScale'),
  conditioning_scale: essential('conditioningScale'),
  controlnet_conditioning_scale: essential('conditioningScale'),
  layers: essential('layers'),
  output_type: advanced('outputType'),
  max_sequence_length: advanced('maxSequenceLength'),
  attention_kwargs_json: advanced('attentionKwargsJson'),
} satisfies RolePolicy;

const VIDEO_GENERATION_POLICY = {
  ...IMAGE_GENERATION_POLICY,
  mode: internal(),
  num_frames: essential('numFrames'),
  frame_rate: essential('fps'),
  fps: essential('fps'),
  guidance_scale_2: advanced('guidanceScale2'),
  scheduler_flow_shift: advanced('shift'),
  shift: advanced('shift'),
  use_guidance_scale_2: internal(),
} satisfies RolePolicy;

const WAN_GENERATION_POLICY = {
  ...VIDEO_GENERATION_POLICY,
  // The backend's reviewed video field contract binds this shared slot to the
  // selected adapter/mode's exact Studio control.
  strength: essential(),
  denoise_strength: essential('strength'),
} satisfies RolePolicy;

const AUDIO_GENERATION_POLICY = {
  prompt: essential('prompt'),
  negative_prompt: essential('negativePrompt'),
  lyrics: essential('lyrics'),
  audio_duration: essential('audioDuration'),
  extension_duration: essential('extensionDuration'),
  vocal_language: essential('vocalLanguage'),
  seed: essential('seed'),
  num_inference_steps: essential('steps'),
  steps: essential('steps'),
  stable_audio_steps: advanced(),
  guidance_scale: essential('guidanceScale'),
  stable_audio_guidance: advanced(),
  shift: advanced('shift'),
  bpm: essential('bpm'),
  keyscale: essential('keyscale'),
  timesignature: essential('timesignature'),
  repainting_start: essential('repaintingStart'),
  repainting_end: essential('repaintingEnd'),
  audio_cover_strength: essential('audioCoverStrength'),
  return_continuation_tail: internal(),
  task_type: internal(),
  sample_rate: advanced(),
} satisfies RolePolicy;

const PIPELINE_POLICY = {
  model_id: advanced(),
  repo_id: advanced(),
  model: advanced(),
  dtype: advanced('dtype'),
  device: advanced('device'),
  auto_offload: advanced('autoOffload'),
  offload_mode: advanced('offloadMode'),
  trust_remote_code: advanced('trustRemoteCode'),
  quantization_mode: advanced('quantizationMode'),
  quantized_components: advanced(),
  bnb_4bit_quant_type: advanced(),
  bnb_4bit_compute_dtype: advanced(),
  bnb_4bit_use_double_quant: advanced(),
  mode: internal(),
  pipeline_class: internal(),
  revision: internal(),
  subfolder: internal(),
  variant: internal(),
  resolved_artifact: internal(),
} satisfies RolePolicy;

const QUANTIZATION_POLICY = {
  backend: advanced('quantizationMode'),
  quantization_mode: advanced('quantizationMode'),
  components: advanced(),
  component: advanced(),
  quantized_components: advanced(),
  dtype: advanced('dtype'),
  model_id: advanced(),
  repo_id: advanced(),
  subfolder: advanced(),
  quant_type: advanced(),
  bnb_4bit_quant_type: advanced(),
  bnb_4bit_compute_dtype: advanced(),
  bnb_4bit_use_double_quant: advanced(),
  excluded_modules: advanced(),
  component_overrides: advanced(),
  quantization_config: internal(),
  quant_config: internal(),
  summary: internal(),
} satisfies RolePolicy;

const EXECUTION_RECIPE_POLICY = {
  device_map: advanced(),
  offload_mode: advanced('offloadMode'),
  device: advanced('device'),
  attention_backend: advanced(),
  attention_components: advanced(),
  vae_slicing: advanced(),
  vae_tiling: advanced(),
  execution_recipe: internal(),
  summary: internal(),
} satisfies RolePolicy;

const IMAGE_SOURCE_POLICY = {
  // A shared image loader may carry a reference, edit source, or control image.
  file: essential(),
  alpha_channel: essential('alphaMode'),
  selected_image: internal(),
  image: internal(),
} satisfies RolePolicy;

const MASK_SOURCE_POLICY = {
  file: essential('maskImage'),
  // Mask loaders are normalized to remove alpha by the graph bridge.
  alpha_channel: internal(),
  selected_image: internal(),
  image: internal(),
} satisfies RolePolicy;

const OUTPAINT_POLICY = {
  width: essential('width'),
  height: essential('height'),
  left: essential('outpaintLeft'),
  right: essential('outpaintRight'),
  top: essential('outpaintTop'),
  bottom: essential('outpaintBottom'),
  overlap: essential('outpaintOverlap'),
  feather: essential('outpaintFeather'),
  fill_color: essential('outpaintFillColor'),
  canvas: internal(),
  mask_image: internal(),
} satisfies RolePolicy;

const VIDEO_SOURCE_POLICY = {
  file: essential('sourceVideo'),
  video: internal(),
} satisfies RolePolicy;

const CONTROL_VIDEO_SOURCE_POLICY = {
  file: essential('controlVideo'),
  video: internal(),
} satisfies RolePolicy;

const MASK_VIDEO_SOURCE_POLICY = {
  file: essential('maskVideo'),
  video: internal(),
} satisfies RolePolicy;

const AUDIO_SOURCE_POLICY = {
  file: essential('sourceAudio'),
  audio: internal(),
} satisfies RolePolicy;

const REFERENCE_AUDIO_SOURCE_POLICY = {
  file: essential('referenceAudio'),
  audio: internal(),
} satisfies RolePolicy;

const AUDIO_FIT_POLICY = {
  source_start_seconds: advanced(),
  source_duration_seconds: advanced(),
  target_duration_seconds: advanced(),
  delay_seconds: essential(),
  fade_in_seconds: advanced(),
  fade_out_seconds: advanced(),
  target_sample_rate: advanced(),
} satisfies RolePolicy;

const SEQUENCE_POLICY = {
  prompts_json: essential(),
  negative_prompt: essential('negativePrompt'),
  width: essential('width'),
  height: essential('height'),
  num_frames: essential('numFrames'),
  frame_rate: essential('fps'),
  fps: essential('fps'),
  num_inference_steps: essential('steps'),
  steps: essential('steps'),
  guidance_scale: essential('guidanceScale'),
  seed: essential('seed'),
  base_seed: essential('seed'),
  transition_seconds: essential(),
  minimum_seconds: essential(),
  maximum_shots: advanced(),
  reference_policy: advanced(),
  secondary_guidance_scale: advanced('guidanceScale2'),
  conditioning_strength: essential('strength'),
  quality: advanced(),
  output_type: advanced('outputType'),
  max_sequence_length: advanced('maxSequenceLength'),
  mode: internal(),
  pin: internal(),
} satisfies RolePolicy;

const LORA_POLICY = {
  scale: essential(),
  model: advanced(),
  model_id: advanced(),
  adapter_path: advanced(),
  weight_name: advanced(),
  adapter_name: advanced(),
  scheduler_class: advanced(),
  scheduler_config: advanced(),
  revision: internal(),
  expected_sha256: internal(),
} satisfies RolePolicy;

const UPSCALE_POLICY = {
  downscale: essential(),
  model_id: advanced(),
  model: advanced(),
  device: advanced('device'),
  image: internal(),
  output: internal(),
} satisfies RolePolicy;

const LYRIC_OVERLAY_POLICY = {
  lrc: essential(),
  fps: advanced('fps'),
  font_size: essential(),
  bottom_margin: essential(),
  video: internal(),
  output: internal(),
} satisfies RolePolicy;

const VIDEO_NORMALIZE_POLICY = {
  width: advanced('width'),
  height: advanced('height'),
  num_frames: advanced('numFrames'),
  video: internal(),
  output: internal(),
} satisfies RolePolicy;

const MASK_ALIGNMENT_POLICY = {
  threshold: advanced(),
  grow_pixels: advanced(),
  video: internal(),
  mask: internal(),
  output: internal(),
} satisfies RolePolicy;

const VIDEO_COLOR_POLICY = {
  brightness: essential(),
  contrast: essential(),
  saturation: essential(),
  gamma: advanced(),
  video: internal(),
  output: internal(),
} satisfies RolePolicy;

const VIDEO_EXPORT_POLICY = {
  fps: essential('fps'),
  quality: advanced(),
  codec: advanced(),
  video: internal(),
  output: internal(),
} satisfies RolePolicy;

const AUDIO_EXPORT_POLICY = {
  sample_rate: advanced(),
  audio: internal(),
  output: internal(),
} satisfies RolePolicy;

const OUTPUT_PREVIEW_POLICY = {
  image: internal(),
  images: internal(),
  video: internal(),
  audio: internal(),
  text: internal(),
  output: internal(),
} satisfies RolePolicy;

const MODELS_POLICY = {
  model_type: advanced('modelType'),
  repo_id: advanced(),
  model_id: advanced(),
  dtype: advanced('dtype'),
  device: advanced('device'),
  auto_offload: advanced('autoOffload'),
  offload_mode: advanced('offloadMode'),
  trust_remote_code: advanced('trustRemoteCode'),
} satisfies RolePolicy;

/**
 * Exact role+parameter policy. Spreads only reuse exact-key maps; classification
 * never searches parameter names or labels. A missing role/key therefore
 * remains advanced unless the registry supplies a valid controlTier override.
 */
export const MANAGED_CONTROL_POLICIES = {
  models: MODELS_POLICY,
  qwenQuantization: QUANTIZATION_POLICY,
  qwenPipeline: PIPELINE_POLICY,
  qwenGenerate: IMAGE_GENERATION_POLICY,
  qwenInpaintPipeline: PIPELINE_POLICY,
  qwenOutpaintCanvas: OUTPAINT_POLICY,
  qwenInpaint: IMAGE_GENERATION_POLICY,
  prompt: {
    prompt: essential('prompt'),
    negative_prompt: essential('negativePrompt'),
    resolution: advanced(),
    image: internal(),
    embeddings: internal(),
  },
  denoise: {
    ...IMAGE_GENERATION_POLICY,
    num_frames: essential('numFrames'),
  },
  decode: OUTPUT_PREVIEW_POLICY,
  preview: OUTPUT_PREVIEW_POLICY,
  loadImage: IMAGE_SOURCE_POLICY,
  loadControlImage: IMAGE_SOURCE_POLICY,
  loadMask: MASK_SOURCE_POLICY,
  applyMask: {
    image: internal(),
    mask: internal(),
    output: internal(),
  },
  imageEmbeddings: {
    width: essential('width'),
    height: essential('height'),
    image: internal(),
    last_image: internal(),
    image_encoder: internal(),
    image_embeds: internal(),
    route_state_out: internal(),
  },
  imageEncode: {
    resolution: advanced(),
    width: essential('width'),
    height: essential('height'),
    num_frames: essential('numFrames'),
    seed: essential('seed'),
    image: internal(),
    last_image: internal(),
    vae: internal(),
    image_latents: internal(),
    image_condition_latents: internal(),
    route_state_in: internal(),
    route_state_out: internal(),
  },
  loadLastImage: IMAGE_SOURCE_POLICY,
  controlnetModel: {
    ...MODELS_POLICY,
    // AutoModelLoader's model_type is the component kind (`controlnet`), not
    // the surrounding Studio pipeline class. Treating it as form.modelType
    // corrupts managed Qwen ControlNet graphs during alias synchronization.
    model_type: internal(),
    subfolder: internal(),
    variant: internal(),
  },
  controlnet: {
    width: advanced('width'),
    height: advanced('height'),
    controlnet_conditioning_scale: essential('conditioningScale'),
    model_type: internal(),
    control_image: internal(),
    controlnet: internal(),
    controlnet_bundle: internal(),
    vae: internal(),
  },
  diffusersQuantization: QUANTIZATION_POLICY,
  diffusersRecipe: EXECUTION_RECIPE_POLICY,
  wanPipeline: PIPELINE_POLICY,
  loadVideo: VIDEO_SOURCE_POLICY,
  loadControlVideo: CONTROL_VIDEO_SOURCE_POLICY,
  loadMaskVideo: MASK_VIDEO_SOURCE_POLICY,
  loadPoseVideo: VIDEO_SOURCE_POLICY,
  loadFaceVideo: VIDEO_SOURCE_POLICY,
  loadBackgroundVideo: VIDEO_SOURCE_POLICY,
  normalizeVideo: VIDEO_NORMALIZE_POLICY,
  alignMaskVideo: MASK_ALIGNMENT_POLICY,
  videoColor: VIDEO_COLOR_POLICY,
  wanGenerate: WAN_GENERATION_POLICY,
  videoExport: VIDEO_EXPORT_POLICY,
  diffusersImagePipeline: PIPELINE_POLICY,
  diffusersImageGenerate: IMAGE_GENERATION_POLICY,
  diffusersUnconditionalGenerate: {
    pipeline: internal(),
    image_contract: internal(),
    batch_size: essential('batchSize'),
    seed: essential('seed'),
    num_inference_steps: essential('steps'),
    eta: advanced('eta'),
    class_label: advanced('classLabel'),
    output_type: advanced('outputType'),
    images: internal(),
    width_out: internal(),
    height_out: internal(),
  },
  diffusersImageEdit: IMAGE_GENERATION_POLICY,
  diffusersImageInpaint: IMAGE_GENERATION_POLICY,
  diffusersImageControl: IMAGE_GENERATION_POLICY,
  loadAdapter: LORA_POLICY,
  loadAudio: AUDIO_SOURCE_POLICY,
  loadReferenceAudio: REFERENCE_AUDIO_SOURCE_POLICY,
  audioPipeline: PIPELINE_POLICY,
  audioGenerate: AUDIO_GENERATION_POLICY,
  audioLoudnessMatch: {
    audio: internal(),
    reference: internal(),
    reference_window_seconds: advanced(),
    target_peak_dbfs: advanced(),
    max_adjustment_db: advanced(),
    output: internal(),
    reference_lufs: internal(),
    input_lufs: internal(),
    output_lufs: internal(),
    adjustment_db: internal(),
    true_peak_dbfs: internal(),
  },
  audioJoin: {
    source: internal(),
    continuation: internal(),
    boundary_fade_seconds: advanced(),
    output: internal(),
    sample_rate: internal(),
    duration: internal(),
  },
  audioExport: AUDIO_EXPORT_POLICY,
  loraAdapter: LORA_POLICY,
  upscaler: UPSCALE_POLICY,
  upscalePreview: OUTPUT_PREVIEW_POLICY,
  videoSequence: SEQUENCE_POLICY,
  videoCompose: {
    fps: essential('fps'),
    transition_seconds: essential(),
    videos: internal(),
    output: internal(),
  },
  lyricOverlay: LYRIC_OVERLAY_POLICY,
  exportWithAudio: {
    fps: advanced('fps'),
    video: internal(),
    audio: internal(),
    output: internal(),
  },
  soundtrackQuantization: QUANTIZATION_POLICY,
  soundtrackRecipe: EXECUTION_RECIPE_POLICY,
  soundtrackPipeline: PIPELINE_POLICY,
  soundtrackGenerate: AUDIO_GENERATION_POLICY,
  soundtrackAudioFit: AUDIO_FIT_POLICY,
  lyricAudioFit: AUDIO_FIT_POLICY,
  lyricVideoPipeline: PIPELINE_POLICY,
  lyricVideoQuantization: QUANTIZATION_POLICY,
  lyricVideoRecipe: EXECUTION_RECIPE_POLICY,
  qualityVideoQuantization: QUANTIZATION_POLICY,
  qualityVideoRecipe: EXECUTION_RECIPE_POLICY,
  qualityVideoShots: {
    shots_json: essential(),
    maximum_shots: advanced(),
  },
  qualityVideoJobs: SEQUENCE_POLICY,
  qualityVideoLoopItems: {
    collection: internal(),
    item_index: internal(),
    item: internal(),
    index: internal(),
    count: internal(),
  },
  qualityVideoGenerate: VIDEO_GENERATION_POLICY,
  qualityVideoRetain: {
    quality: advanced(),
    pin: internal(),
    video: internal(),
    output: internal(),
  },
  qualityVideoLoopResult: {
    value_input: internal(),
    stop_input: internal(),
    value: internal(),
    collection: internal(),
    stopped: internal(),
  },
  qualityVideoJoin: {
    transition_seconds: essential(),
    pin: internal(),
    videos: internal(),
    output: internal(),
  },
} satisfies Record<ManagedControlRole, RolePolicy>;

const PREVIEW_DISPLAYS = new Set(['ui_image', 'ui_video', 'ui_audio', 'ui_text', 'ui_imagecompare']);
const STRUCTURAL_INTERNAL_KEYS = new Set([
  'execution_recipe',
  'image_latents',
  'images',
  'latents',
  'output',
  'outputs',
  'pipeline',
  'quant_config',
  'quantization_config',
]);

function surfaceForTier(tier: ManagedControlTier): ManagedControlSurface {
  if (tier === 'essential') return 'main';
  if (tier === 'advanced') return 'advanced';
  return 'hidden';
}

/**
 * Manual and imported graphs have no Studio role, but Auto still needs to
 * distinguish normal creative controls from runtime tuning. Role-specific
 * policies remain authoritative; this is the common fallback.
 */
const GENERIC_CONTROL_POLICY: RolePolicy = {
  prompt: essential(),
  negative_prompt: essential(),
  lyrics: essential(),
  file: essential(),
  width: essential(),
  height: essential(),
  seed: essential(),
  num_inference_steps: essential(),
  steps: essential(),
  guidance_scale: essential(),
  guidance: essential(),
  true_cfg_scale: essential(),
  strength: essential(),
  denoise_strength: essential(),
  conditioning_scale: essential(),
  controlnet_conditioning_scale: essential(),
  num_frames: essential(),
  frame_rate: essential(),
  fps: essential(),
  audio_duration: essential(),
  duration: essential(),
  bpm: essential(),
  keyscale: essential(),
  timesignature: essential(),
  model_id: advanced(),
  repo_id: advanced(),
  model: advanced(),
  pipeline_class: advanced(),
  device: advanced(),
  dtype: advanced(),
  quantization_mode: advanced(),
  quantized_components: advanced(),
  offload_mode: advanced(),
  auto_offload: advanced(),
  trust_remote_code: advanced(),
  revision: advanced(),
  subfolder: advanced(),
  variant: advanced(),
};

/**
 * Reads only the documented values from dynamic registry metadata. `main` is
 * accepted as a presentation-oriented alias for the canonical `essential`
 * tier. Arbitrary strings never promote an unknown field.
 */
export function readManagedControlTierOverride(
  fieldOptions: NodeParams['fieldOptions'],
): ManagedControlTier | undefined {
  const value = fieldOptions?.controlTier;
  if (value === 'main' || value === 'essential') return 'essential';
  if (value === 'advanced' || value === 'internal') return value;
  return undefined;
}

function isStructurallyInternal(paramKey: string, param?: ManagedControlParamMetadata) {
  const display = param?.isInput ? 'input' : param?.display;
  return Boolean(
    param?.hidden ||
    param?.isInput ||
    display === 'input' ||
    display === 'output' ||
    (display && PREVIEW_DISPLAYS.has(display)) ||
    STRUCTURAL_INTERNAL_KEYS.has(paramKey),
  );
}

export function classifyManagedControl(
  role: string | undefined,
  paramKey: string,
  param?: ManagedControlParamMetadata,
): ManagedControlClassification {
  const rolePolicy = role
    ? (MANAGED_CONTROL_POLICIES[role as ManagedControlRole] as RolePolicy | undefined)
    : undefined;
  const declaredPolicy = rolePolicy?.[paramKey] ?? GENERIC_CONTROL_POLICY[paramKey];

  if (isStructurallyInternal(paramKey, param)) {
    return {
      tier: 'internal',
      surface: 'hidden',
      source: 'structural',
    };
  }

  const override = readManagedControlTierOverride(param?.fieldOptions);
  if (override) {
    return {
      tier: override,
      surface: surfaceForTier(override),
      source: 'field-option',
      ...(declaredPolicy?.formKey ? { formKey: declaredPolicy.formKey } : {}),
    };
  }

  if (declaredPolicy) {
    return {
      ...declaredPolicy,
      surface: surfaceForTier(declaredPolicy.tier),
      source: 'role-policy',
    };
  }

  return {
    tier: 'advanced',
    surface: 'advanced',
    source: 'unknown',
  };
}

export function isManagedMainControl(role: string | undefined, paramKey: string, param?: ManagedControlParamMetadata) {
  return classifyManagedControl(role, paramKey, param).surface === 'main';
}
