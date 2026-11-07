import type {
  StudioAudioFitSettings,
  StudioFormState,
  StudioTemplateLoraSettings,
  StudioTemplateWorkflowBlockSettings,
} from './types';
import { resolveStudioResourceForm } from './resourcePlanner';
import { CONTROLLED_ROLE_NODE_KEYS, type ControlledNodeRole } from './controlledWorkflowContracts';

export type ControlledFieldValue = { fields: string[]; value: unknown };

/** Exact settings shared by managed recipes and fresh operation graphs. */
export function loraWorkflowFieldValues(
  adapter: StudioTemplateLoraSettings | undefined,
  index: number,
): ControlledFieldValue[] {
  const values: ControlledFieldValue[] = [
    { fields: ['scale'], value: adapter?.scale ?? 1 },
    { fields: ['replace_existing'], value: index === 0 },
  ];
  if (adapter?.model)
    values.push(
      { fields: ['model', 'adapter_path'], value: { source: adapter.model.source, value: adapter.model.value } },
      { fields: ['revision'], value: adapter.model.revision ?? '' },
      { fields: ['expected_sha256'], value: adapter.model.sha256 ?? '' },
    );
  if (adapter?.weightName) values.push({ fields: ['weight_name'], value: adapter.weightName });
  if (adapter?.adapterName) values.push({ fields: ['adapter_name'], value: adapter.adapterName });
  if (index === 0 && adapter?.schedulerClass)
    values.push({ fields: ['scheduler_class'], value: adapter.schedulerClass });
  if (index === 0 && adapter?.schedulerConfig)
    values.push({ fields: ['scheduler_config'], value: JSON.stringify(adapter.schedulerConfig) });
  return values;
}

export function upscaleWorkflowFieldValues(
  settings: StudioTemplateWorkflowBlockSettings['upscaler'] | undefined,
  device: string,
): ControlledFieldValue[] {
  return [
    { fields: ['device'], value: device },
    ...(settings?.model ? [{ fields: ['model_id'], value: settings.model }] : []),
    ...(settings?.downscale !== undefined ? [{ fields: ['downscale'], value: settings.downscale }] : []),
  ];
}

export function audioFitWorkflowFieldValues(settings: StudioAudioFitSettings): ControlledFieldValue[] {
  return [
    { fields: ['source_start_seconds'], value: settings.sourceStartSeconds },
    { fields: ['source_duration_seconds'], value: settings.sourceDurationSeconds },
    { fields: ['target_duration_seconds'], value: settings.targetDurationSeconds },
    { fields: ['delay_seconds'], value: settings.delaySeconds ?? 0 },
    { fields: ['target_sample_rate'], value: settings.targetSampleRate ?? 48000 },
    { fields: ['fade_in_seconds'], value: settings.fadeInSeconds ?? 0 },
    { fields: ['fade_out_seconds'], value: settings.fadeOutSeconds ?? 0 },
  ];
}

/** The complete existing lyric composite, shared by legacy managed additions
 * and fresh ordinary authoring. Placement here is a request, never admission. */
export function lyricVideoWorkflowFieldValues(
  settings: NonNullable<StudioTemplateWorkflowBlockSettings['lyricVideo']>,
  form: StudioFormState,
): Record<
  | 'quantization'
  | 'recipe'
  | 'pipeline'
  | 'sequence'
  | 'compose'
  | 'upscaler'
  | 'overlay'
  | 'audioGenerate'
  | 'audioFit'
  | 'exporter',
  ControlledFieldValue[]
> {
  const executionForm = resolveStudioResourceForm(form);
  const fields = (values: Record<string, unknown>) =>
    Object.entries(values).map(([field, value]) => ({ fields: [field], value }));
  return {
    quantization: fields({
      backend: executionForm.resourceMode === 'expert' ? executionForm.quantizationMode : 'none',
      components: ['transformer'],
      dtype: executionForm.dtype,
    }),
    recipe: fields({
      device_map: 'none',
      offload_mode: executionForm.offloadMode,
      device: executionForm.device,
      attention_backend: 'auto',
      attention_components: '',
      vae_slicing: true,
      vae_tiling: true,
    }),
    pipeline: fields({
      model_id: settings.visualModel,
      pipeline_class: 'LTXConditionPipeline',
      dtype: executionForm.dtype,
      device: executionForm.device,
      auto_offload: executionForm.autoOffload,
      offload_mode: executionForm.offloadMode,
    }),
    sequence: fields({
      mode: 'text_to_video',
      prompts_json: settings.promptsJson,
      negative_prompt: form.negativePrompt,
      width: 768,
      height: 512,
      num_frames: 81,
      frame_rate: form.fps,
      num_inference_steps: 8,
      guidance_scale: 1,
      seed: form.seed,
      output_type: form.outputType,
      max_sequence_length: form.maxSequenceLength,
    }),
    compose: fields({ fps: 16, transition_seconds: settings.transitionSeconds }),
    upscaler: fields({
      model_id: {
        source: 'hub',
        value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
        revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
        sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
        byteSize: 67061725,
      },
      downscale: 1,
    }),
    overlay: fields({
      lrc: settings.lrc,
      fps: 16,
      font_size: settings.fontSize ?? 58,
      bottom_margin: settings.bottomMargin ?? 70,
    }),
    audioGenerate: fields({
      task_type: 'text2music',
      prompt: settings.audio.prompt,
      negative_prompt: '',
      lyrics: settings.audio.lyrics,
      audio_duration: settings.audio.durationSeconds,
      num_inference_steps: settings.audio.steps,
      guidance_scale: settings.audio.guidanceScale,
      shift: settings.audio.shift ?? 3,
      seed: settings.audio.seed,
      bpm: settings.audio.bpm ?? 0,
      keyscale: settings.audio.keyscale ?? '',
      timesignature: settings.audio.timesignature ?? '4',
      vocal_language: settings.audio.vocalLanguage ?? 'en',
      sample_rate: settings.audioFit.targetSampleRate ?? 48000,
    }),
    audioFit: audioFitWorkflowFieldValues(settings.audioFit),
    exporter: fields({ fps: 16 }),
  };
}

type LyricRole = keyof ReturnType<typeof lyricVideoWorkflowFieldValues>;

/** Shared construction keeps the managed and ordinary composite's real stages
 * and wires identical without introducing another execution representation. */
export function buildLyricVideoWorkflow<T>(
  settings: NonNullable<StudioTemplateWorkflowBlockSettings['lyricVideo']>,
  form: StudioFormState,
  audioGenerate: T,
  create: (key: string, role: ControlledNodeRole, position: { x: number; y: number }) => T,
  set: (node: T, fields: string[], value: unknown, role: LyricRole) => void,
  connect: (from: T, outputs: string[], to: T, inputs: string[]) => void,
) {
  const layout: [Exclude<LyricRole, 'audioGenerate'>, ControlledNodeRole, number, number][] = [
    ['quantization', 'lyricVideoQuantization', -1280, 340],
    ['recipe', 'lyricVideoRecipe', -900, 340],
    ['pipeline', 'lyricVideoPipeline', -500, 340],
    ['sequence', 'videoSequence', -100, 340],
    ['compose', 'videoCompose', 300, 340],
    ['upscaler', 'upscaler', 680, 340],
    ['overlay', 'lyricOverlay', 1060, 340],
    ['audioFit', 'lyricAudioFit', 1060, 720],
    ['exporter', 'exportWithAudio', 1440, 180],
  ];
  const nodes = { audioGenerate } as Record<LyricRole, T>;
  for (const [name, role, x, y] of layout) nodes[name] = create(CONTROLLED_ROLE_NODE_KEYS[role]!, role, { x, y });
  const values = lyricVideoWorkflowFieldValues(settings, form);
  for (const role of Object.keys(nodes) as LyricRole[])
    for (const { fields, value } of values[role]) set(nodes[role], fields, value, role);
  const edges: [LyricRole, string, LyricRole, string][] = [
    ['quantization', 'quantization_config', 'recipe', 'quantization_config'],
    ['recipe', 'execution_recipe', 'pipeline', 'execution_recipe'],
    ['pipeline', 'pipeline', 'sequence', 'pipeline'],
    ['sequence', 'clips', 'compose', 'clip_1'],
    ['compose', 'video', 'upscaler', 'image'],
    ['upscaler', 'output', 'overlay', 'video'],
    ['overlay', 'output', 'exporter', 'video'],
    ['audioGenerate', 'audio', 'audioFit', 'audio'],
    ['audioFit', 'output', 'exporter', 'audio'],
  ];
  for (const [source, output, target, input] of edges) connect(nodes[source], [output], nodes[target], [input]);
  return nodes.exporter;
}

/** A soundtrack remains a separate, visible audio pipeline and timeline fit. */
export function soundtrackWorkflowFieldValues(
  settings: NonNullable<StudioTemplateWorkflowBlockSettings['soundtrack']>,
  executionForm: StudioFormState,
  options: { retainSelectorMetadata?: boolean; attentionBackend?: StudioFormState['attentionBackend'] } = {},
): Record<'quantization' | 'recipe' | 'pipeline' | 'generate' | 'audioFit' | 'exporter', ControlledFieldValue[]> {
  const fields = (values: Record<string, unknown>) =>
    Object.entries(values).map(([field, value]) => ({ fields: [field], value }));
  return {
    quantization: fields({ backend: 'none', components: [], dtype: executionForm.dtype }),
    // Keep the legacy managed recipe's explicit math policy. Fresh ordinary
    // graphs pass their authored choice; automatic SDPA can select a supported
    // kernel without pretending that a CUDA device guarantees flash support.
    recipe: fields({
      device_map: 'none',
      offload_mode: executionForm.offloadMode,
      device: executionForm.device,
      attention_backend: options.attentionBackend ?? '_native_math',
      attention_components: '',
      vae_slicing: true,
      vae_tiling: true,
    }),
    pipeline: fields({
      // Managed documents retain their full recorded selector. Fresh registry
      // fields use its transport value plus the separately declared revision.
      model_id: options.retainSelectorMetadata
        ? settings.model
        : { source: settings.model.source, value: settings.model.value },
      ...(settings.model.revision ? { revision: settings.model.revision } : {}),
      pipeline_class: settings.pipelineClass,
      mode: 'text_to_audio',
      dtype: executionForm.dtype,
      device: executionForm.device,
      auto_offload: executionForm.autoOffload,
      offload_mode: executionForm.offloadMode,
    }),
    generate: fields({
      task_type: 'text2music',
      prompt: settings.prompt,
      negative_prompt: settings.negativePrompt ?? '',
      lyrics: '',
      audio_duration: settings.durationSeconds,
      num_inference_steps: settings.steps,
      guidance_scale: settings.guidanceScale,
      stable_audio_steps: settings.steps,
      stable_audio_guidance: settings.guidanceScale,
      seed: settings.seed,
      bpm: settings.bpm ?? 0,
      keyscale: settings.keyscale ?? '',
      timesignature: settings.timesignature ?? '4/4',
    }),
    audioFit: audioFitWorkflowFieldValues(settings.audioFit),
    exporter: fields({ fps: executionForm.fps, quality: 10 }),
  };
}
