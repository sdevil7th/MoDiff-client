import type {
  StudioAudioFitSettings,
  StudioFormState,
  StudioTemplateLoraSettings,
  StudioTemplateWorkflowBlockSettings,
} from './types';

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
