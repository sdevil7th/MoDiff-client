import { formPatchForAutoCandidate, type StudioAutoResourceCandidate } from './autoResource';
import { getModelRequirementsForMode, WAN_VACE_REVISION } from './modelProfiles';
import type { StudioExecutionSpec, StudioFormState, StudioModelProfile, StudioMode } from './types';

/** Shared semantic values for backend-declared bindings; no graph mutation or authority. */
export function resolveStudioExecutionSpecValues(
  form: StudioFormState,
  spec: StudioExecutionSpec,
  capability: StudioModelProfile | undefined,
  options: {
    candidate?: StudioAutoResourceCandidate | null;
    audioTemplateBaseModel?: string | null;
    seed?: number | { value: number; isRandom: boolean };
    defaultModelRevision?: string;
  } = {},
) {
  const candidate = options.candidate ?? null;
  const audioTemplateBaseModel = options.audioTemplateBaseModel ?? null;
  const quantizationMode = form.resourceMode === 'expert' ? form.quantizationMode : 'none';
  const bindsDefaultRevision = spec.bindings.some(([, , source]) => source === 'defaultRevision');
  const defaultRevision = options.defaultModelRevision
    ? [options.defaultModelRevision]
    : (capability?.revisionCandidates ?? []);
  if (bindsDefaultRevision && defaultRevision.length !== 1) {
    throw new Error('The Studio execution specification requires one reviewed default model revision.');
  }
  const bindsAuxiliaryModel = spec.bindings.some(([, , source]) => ['kind', 'repo', 'revision'].includes(source));
  const auxiliaryRequirements = capability ? getModelRequirementsForMode(capability, form.mode) : [];
  if (bindsAuxiliaryModel && auxiliaryRequirements.length !== 1) {
    throw new Error('The Studio execution specification requires one reviewed auxiliary model.');
  }
  const auxiliaryRequirement = auxiliaryRequirements[0];
  if (bindsAuxiliaryModel && !auxiliaryRequirement?.revision) {
    throw new Error('The reviewed auxiliary model requires an immutable revision.');
  }
  const bindsMotionAdapter = spec.bindings.some(([, , source]) =>
    ['motionAdapterRepo', 'motionAdapterRevision'].includes(source),
  );
  const motionAdapters = auxiliaryRequirements.filter((requirement) => requirement.kind === 'adapter');
  if (bindsMotionAdapter && motionAdapters.length !== 1) {
    throw new Error('The Studio execution specification requires one reviewed motion adapter.');
  }
  const motionAdapter = motionAdapters[0];
  if (bindsMotionAdapter && !motionAdapter?.revision) {
    throw new Error('The reviewed motion adapter requires an immutable revision.');
  }
  const controlnetRequirement = auxiliaryRequirements.find((requirement) => requirement.kind === 'controlnet');
  const ipAdapterRequirement = auxiliaryRequirements.find((requirement) => requirement.id === 'sdxl-ip-adapter');
  const bindsReviewedControlnet = spec.bindings.some(([, , source]) => source === 'controlnetRepo');
  const bindsReviewedIPAdapter = spec.bindings.some(([, , source]) => source === 'ipAdapterRepo');
  if (bindsReviewedControlnet && !controlnetRequirement?.revision) {
    throw new Error('The reviewed ControlNet component requires one immutable dependency.');
  }
  if (bindsReviewedIPAdapter && !ipAdapterRequirement?.revision) {
    throw new Error('The reviewed IP-Adapter component requires one immutable dependency.');
  }
  const unionControlnet = form.mode.includes('control_union');
  const hasDistinctLastImage = spec.bindings.some(([, , source]) => source === 'lastImage');
  const values: Record<string, unknown> = {
    ...form,
    paddingMaskCrop: (form as StudioFormState & { paddingMaskCrop?: number | null }).paddingMaskCrop ?? null,
    referenceImages: hasDistinctLastImage ? form.referenceImages.slice(0, 1) : [...form.referenceImages],
    quantizationMode,
    quantizedComponents: ['transformer'],
    deviceMapNone: 'none',
    attentionBackend:
      typeof form.attentionBackend === 'string' && form.attentionBackend.trim() ? form.attentionBackend : 'auto',
    nativeMath: '_native_math',
    empty: '',
    true: true,
    false: false,
    depth: 'depth',
    addAlpha: 'add alpha',
    removeAlpha: 'remove alpha',
    regionalCompile: false,
    denoiserCache: 'none',
    layerwiseCasting: false,
    channelsLast: false,
    artifact: audioTemplateBaseModel ?? spec.defaultRepo,
    defaultRevision: defaultRevision[0],
    pipelineClass: spec.pipelineClass,
    executionProfileId: spec.executionProfileId,
    defaultWorkflow: 'default',
    workflowId:
      (
        {
          image_to_image: 'img2img',
          text_to_video: 'text2video',
          image_to_video: 'image2video',
          video_to_video: 'video2video',
        } as Partial<Record<StudioMode, string>>
      )[spec.mode] ?? 'text2image',
    semanticGeneratorBlock: 'semantic_generator',
    workflowPromptEnhancerBlock: 'prompt_enhancer',
    workflowTextEncoderBlock: 'text_encoder',
    workflowImageEncoderBlock: 'vae_encoder',
    workflowDenoiseBlock: 'denoise',
    workflowDecodeBlock: 'decode',
    kind: auxiliaryRequirement?.kind,
    repo: auxiliaryRequirement ? { source: 'hub', value: auxiliaryRequirement.repo } : undefined,
    revision: auxiliaryRequirement?.revision,
    controlnetKind: controlnetRequirement?.kind,
    controlnetRepo: controlnetRequirement ? { source: 'hub', value: controlnetRequirement.repo } : undefined,
    controlnetRevision: controlnetRequirement?.revision,
    controlnetOffloadMode: 'none',
    controlnetWeightVariant: unionControlnet ? '' : 'fp16',
    controlnetRouteVariant: unionControlnet ? 'union' : 'ordinary',
    controlnetLoadClass: unionControlnet ? 'ControlNetUnionModel' : '',
    ipAdapterRepo: ipAdapterRequirement ? { source: 'hub', value: ipAdapterRequirement.repo } : undefined,
    ipAdapterRevision: ipAdapterRequirement?.revision,
    ipAdapterWeightName: ipAdapterRequirement ? 'sdxl_models/ip-adapter_sdxl.safetensors' : undefined,
    classifierFreeGuidance: 'ClassifierFreeGuidance',
    motionAdapterRepo: motionAdapter ? { source: 'hub', value: motionAdapter.repo } : undefined,
    motionAdapterRevision: motionAdapter?.revision,
    wanVaceRevision: WAN_VACE_REVISION,
    cannyLowThreshold: 0.1,
    cannyHighThreshold: 0.2,
    videoCannyLowThreshold100: 100,
    videoCannyHighThreshold200: 200,
    controlGuidanceStart: 0,
    controlGuidanceEnd: 1,
    resolution: form.width,
    cfgNormalize: false,
    useEnglishPrompt: false,
    maskThreshold127: 127,
    inpaintMaskGrow96: 96,
    outpaintMaskGrow0: 0,
    text2music: 'text2music',
    text2audio: 'text2audio',
    cover: 'cover',
    continuation: 'continuation',
    repaint: 'repaint',
    transcribe: 'transcribe',
    translate: 'translate',
    anyToAnyText: 'text',
    anyToAnyImage: 'image',
    maxNewTokens: 256,
    minNewTokens: 0,
    doSample: false,
    temperature: 1,
    topP: 1,
    topK: 50,
    numBeams: 1,
    repetitionPenalty: 1,
    useChatTemplate: true,
    bpmNormalized: form.bpm > 0 ? form.bpm : 0,
    sampleRate16000: 16000,
    sampleRate24000: 24000,
    sampleRate44100: 44100,
    sampleRate48000: 48000,
    numWaveforms1: 1,
    numWaveforms3: 3,
    referenceWindow15: 15,
    targetPeakMinus1: -1,
    maxAdjustment12: 12,
    boundaryFade001: 0.01,
    lastImage: hasDistinctLastImage ? (form.referenceImages[1] ?? '') : '',
    poseVideo: '',
    faceVideo: '',
    backgroundVideo: '',
    promptRef: '人物动作的参考视频',
    segmentFrameLength: 81,
    previousConditioningFrames: 1,
    segmentFrameLength77: 77,
    previousConditioningFrames1: 1,
    motionEncodeBatchSize1: 1,
    temporalTileSize80: 80,
    temporalOverlap24: 24,
    temporalOverlapConditionStrength05: 0.5,
    adainFactor025: 0.25,
    framepackSampling: 'inverted_anti_drifting',
    latentWindowSize9: 9,
    trueCfgScale1: 1,
    seed: options.seed ?? { value: form.seed, isRandom: form.randomSeed },
  };
  const candidateValues: Record<string, unknown> = {
    ...candidate,
    ...formPatchForAutoCandidate(candidate),
    'installTarget.repo': candidate?.installTarget?.repo,
  };
  for (const field of [...spec.autoFields].reverse()) {
    if (
      audioTemplateBaseModel &&
      (field === 'resolvedArtifact' || field === 'artifact' || field === 'installTarget.repo' || field === 'modelRepo')
    )
      continue;
    const value = candidateValues[field];
    if (value === undefined) continue;
    values[
      field === 'resolvedArtifact' || field === 'artifact' || field === 'installTarget.repo' || field === 'modelRepo'
        ? 'artifact'
        : field
    ] = value;
  }
  values.pipelineQuantizedComponents = quantizationMode === 'none' ? [] : values.quantizedComponents;
  values.autoOffload = values.offloadMode !== 'none';
  values.nativeFlashAttention =
    candidate?.attentionBackend ?? (form.device.startsWith('cuda') ? '_native_flash' : 'auto');
  values.transformer = values.nativeFlashAttention === '_native_flash' ? 'transformer' : '';
  values.dualTransformer = values.nativeFlashAttention === '_native_flash' ? 'transformer,transformer_2' : '';
  values.dualQuantizedComponents = candidate?.quantizedComponents ?? ['transformer', 'transformer_2'];
  values.videoVaeTiling =
    form.resourceMode !== 'expert' ||
    values.offloadMode !== 'none' ||
    form.width * form.height * form.numFrames > 40_000_000;
  values.useGuidanceScale2 = form.guidanceScale2 > 0;
  return values;
}
