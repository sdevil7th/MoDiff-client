export type StudioMode =
  | 'text_to_image'
  | 'edit_image'
  | 'multi_image_reference_edit'
  | 'inpaint'
  | 'outpaint'
  | 'control_image'
  | 'layer_decomposition'
  | 'text_to_video'
  | 'image_to_video'
  | 'video_to_video'
  | 'video_inpaint'
  | 'video_outpaint'
  | 'reference_to_video'
  | 'control_to_video'
  | 'video_color_edit'
  | 'text_to_audio'
  | 'audio_variation'
  | 'audio_continuation'
  | 'audio_repaint'
  | 'advanced_workflow';

export type StudioModelType =
  | 'ZImageModularPipeline'
  | 'QwenImageModularPipeline'
  | 'QwenImageEditModularPipeline'
  | 'QwenImageEditPlusModularPipeline'
  | 'QwenImageLayeredModularPipeline'
  | 'WanVACEPipeline'
  | 'AceStepAudioPipeline'
  | 'FluxSchnellPipeline'
  | 'FluxDevPipeline'
  | 'FluxKreaPipeline'
  | 'FluxKontextPipeline'
  | 'FluxFillPipeline'
  | 'FluxDepthPipeline'
  | 'FluxCannyPipeline'
  | 'FluxReduxPipeline';

export type StudioAspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | 'custom';
export type StudioQuantizationMode = 'none' | 'bnb_4bit' | 'bnb_8bit' | 'quanto_float8' | 'torchao_float8';
export type StudioOffloadMode = 'none' | 'model_cpu' | 'sequential_cpu' | 'group_cpu' | 'group_disk';
export type StudioResourceMode = 'auto' | 'expert';
export type StudioViewMode = StudioResourceMode;

export type StudioPresetId =
  | 'fast'
  | 'balanced'
  | 'quality'
  | 'text_accuracy'
  | 'low_vram'
  | 'video_preview'
  | 'video_balanced'
  | 'video_quality'
  | 'video_low_vram'
  | 'portrait_video'
  | 'color_preserve_edit'
  | 'audio_fast'
  | 'audio_balanced'
  | 'audio_continuation'
  | 'audio_variation'
  | 'flux_fast'
  | 'flux_quality'
  | 'flux_kontext'
  | 'flux_fill'
  | 'flux_control';

export type StudioTemplateId =
  | 'z_image_quick_concept'
  | 'z_image_product_mockup'
  | 'z_image_poster'
  | 'z_image_lora_style'
  | 'qwen_text_rendering'
  | 'qwen_poster_logo_text'
  | 'qwen_product_mockup'
  | 'qwen_low_vram_text_rendering'
  | 'qwen_low_vram_product_concept'
  | 'qwen_low_vram_poster_layout'
  | 'qwen_control_image_layout'
  | 'z_image_cinematic_contact_sheet'
  | 'qwen_product_ad_composite'
  | 'qwen_product_relight'
  | 'qwen_packaging_dieline'
  | 'qwen_character_angles'
  | 'qwen_tile_extract'
  | 'qwen_logo_texture'
  | 'qwen_layered_portrait'
  | 'qwen_outpaint_aspect_template'
  | 'qwen_inpaint_object_replace'
  | 'character_edit'
  | 'qwen_edit_strength_sweep'
  | 'reference_fusion'
  | 'qwen_multi_reference_product'
  | 'qwen_inpaint_mask_draft'
  | 'layer_decomposition'
  | 'qwen_upscale_finish'
  | 'qwen_outpaint_draft'
  | 'low_vram'
  | 'fast_lora'
  | 'high_quality'
  | 'wan_vace_cinematic_text_to_video'
  | 'wan_vace_animate_product_still'
  | 'wan_vace_video_color_grade'
  | 'wan_vace_masked_object_replace'
  | 'wan_vace_outpaint_reframe'
  | 'wan_vace_reference_motion'
  | 'wan_vace_grayscale_control'
  | 'ace_step_text_to_audio'
  | 'ace_step_audio_variation'
  | 'ace_step_audio_continuation'
  | 'ace_step_audio_repaint'
  | 'flux_schnell_text_to_image'
  | 'flux_dev_expert_text_to_image'
  | 'flux_kontext_edit'
  | 'flux_fill_inpaint'
  | 'flux_control_canny';

export type WorkspacePanelTab = 'studio' | 'gallery' | 'queue' | 'setup' | 'share' | 'app' | 'blueprints';

export type FocusedModelManagerTarget = {
  modelType?: StudioModelType;
  repo?: string;
  requirementId?: string;
  label?: string;
  source?: 'studio' | 'setup' | 'template' | 'workflow' | 'graph' | 'models';
};

export type RunReadinessIssueSeverity = 'error' | 'warning' | 'info' | 'success';
export type RunReadinessIssueCategory = 'backend' | 'model' | 'graph' | 'input' | 'device';

export type RunReadinessIssueAction =
  | 'install_model'
  | 'open_setup'
  | 'refresh_cache'
  | 'select_image'
  | 'apply_low_vram_preset'
  | 'switch_to_z_image'
  | 'cleanup_gpu'
  | 'open_model_manager'
  | 'inspect_node';

export type RunReadinessIssue = {
  id: string;
  category: RunReadinessIssueCategory;
  severity: RunReadinessIssueSeverity;
  nodeId?: string;
  repoId?: string;
  modelPath?: string;
  message: string;
  details?: string;
  blocking: boolean;
  action?: RunReadinessIssueAction;
};

export type GraphInspectionSummary = {
  nodeCount: number;
  enabledExecutableCount: number;
  outputNodeIds: string[];
  connectedOutputNodeIds: string[];
  outputPathCount: number;
  outputRefs: Array<{
    nodeId: string;
    nodeLabel?: string;
    connected: boolean;
  }>;
  modelRefs: Array<{
    nodeId: string;
    nodeLabel?: string;
    kind: 'repo' | 'path';
    value: string;
    paramKey: string;
  }>;
  blockingIssues: RunReadinessIssue[];
};

export type RuntimeFailure = {
  id: string;
  taskId?: string | null;
  nodeId?: string | null;
  nodeName?: string | null;
  message: string;
  exceptionType?: string | null;
  category?: string | null;
  errorCode?: string | null;
  recoveryHint?: string | null;
  traceback?: string | null;
  oom?: boolean;
  memorySummary?: string | null;
  cudaMemorySnapshot?: RuntimeCudaMemorySnapshot | null;
  gpuProcesses?: RuntimeGpuProcessSnapshot | null;
  runtimeHints?: Record<string, unknown> | null;
  runtimeBudget?: Record<string, unknown> | null;
  loaderDiagnostics?: Record<string, unknown> | null;
  createdAt: number;
};

export type RuntimeCudaMemoryDeviceSnapshot = {
  index?: number;
  name?: string;
  free_bytes?: number;
  total_bytes?: number;
  allocated_bytes?: number;
  reserved_bytes?: number;
  max_allocated_bytes?: number;
  max_reserved_bytes?: number;
  [key: string]: unknown;
};

export type RuntimeCudaMemorySnapshot = {
  available?: boolean;
  device_count?: number;
  devices?: RuntimeCudaMemoryDeviceSnapshot[];
  device_name?: string;
  free_bytes?: number;
  total_bytes?: number;
  allocated_bytes?: number;
  reserved_bytes?: number;
  error?: string;
  [key: string]: unknown;
};

export type RuntimeGpuProcessSnapshot = {
  available?: boolean;
  reason?: string;
  gpus?: Array<{
    index?: number | string | null;
    name?: string;
    memory_used_mb?: number | null;
    memory_free_mb?: number | null;
    memory_total_mb?: number | null;
    [key: string]: unknown;
  }>;
  processes?: Array<{
    gpu_uuid?: string;
    pid?: number | null;
    process_name?: string;
    used_memory_mb?: number | null;
    [key: string]: unknown;
  }>;
  gpu_query_error?: string;
  process_query_error?: string;
  [key: string]: unknown;
};

export type StudioGraphRole =
  | 'models'
  | 'qwenQuantization'
  | 'qwenPipeline'
  | 'qwenGenerate'
  | 'qwenInpaintPipeline'
  | 'qwenOutpaintCanvas'
  | 'qwenInpaint'
  | 'prompt'
  | 'denoise'
  | 'decode'
  | 'preview'
  | 'loadImage'
  | 'loadMask'
  | 'applyMask'
  | 'imageEncode'
  | 'controlnetModel'
  | 'controlnet'
  | 'wanPipeline'
  | 'loadVideo'
  | 'loadControlVideo'
  | 'loadMaskVideo'
  | 'normalizeVideo'
  | 'alignMaskVideo'
  | 'videoColor'
  | 'wanGenerate'
  | 'videoExport'
  | 'diffusersImagePipeline'
  | 'diffusersImageGenerate'
  | 'diffusersImageEdit'
  | 'diffusersImageInpaint'
  | 'diffusersImageControl'
  | 'loadAdapter'
  | 'loadAudio'
  | 'loadReferenceAudio'
  | 'audioPipeline'
  | 'audioGenerate'
  | 'audioExport';

export type StudioGraphBinding = {
  mode: StudioMode;
  modelType: StudioModelType;
  nodes: Partial<Record<StudioGraphRole, string>>;
  managedNodeIds: string[];
  managedEdgeIds: string[];
  fingerprint: string;
  createdAt: number;
  updatedAt: number;
};

export type StudioGraphFinalizationState = {
  status: 'idle' | 'pending' | 'complete' | 'warning' | 'error';
  bindingFingerprint: string | null;
  startedAt: number | null;
  skeletonMs?: number;
  finalizedAt?: number;
  finalizationMs?: number;
  timedOutGroups: string[];
  managedEdgeCount: number;
  message?: string | null;
};

export type WorkflowTabSnapshot = {
  nodes: unknown[];
  edges: unknown[];
  viewport?: unknown;
  studioForm: StudioFormState;
  studioGraphBinding: StudioGraphBinding | null;
  selectedMode: StudioMode;
  activeTemplateId: StudioTemplateId | null;
  sourceOutputId: string | null;
  pinnedGraphInputIds?: string[];
  userBlocks?: UserBlockDefinition[];
};

export type WorkflowTab = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  dirty: boolean;
  source?: 'new' | 'import' | 'template' | 'gallery' | 'manual';
  sourceLabel?: string;
  snapshot: WorkflowTabSnapshot;
};

export type AppModeInputKind = 'studio-form' | 'graph-param';

export type AppModeInput = {
  id: string;
  kind: AppModeInputKind;
  label: string;
  formKey?: keyof StudioFormState;
  nodeId?: string;
  paramKey?: string;
};

export type AppModeOutput = {
  id: string;
  label: string;
  nodeId: string;
  fieldKey?: string;
};

export type AppModeConfig = {
  id: string;
  workflowTabId: string;
  name: string;
  exposedInputs: AppModeInput[];
  exposedOutputs: AppModeOutput[];
  createdAt: number;
  updatedAt: number;
};

export type WorkflowBlueprint = {
  id: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  exposedInputs: AppModeInput[];
  exposedOutputs: AppModeOutput[];
  createdAt: number;
  updatedAt: number;
};

export type UserBlockPort = {
  id: string;
  label: string;
  nodeId: string;
  paramKey: string;
  type?: string | string[];
};

export type UserBlockDefinition = {
  id: string;
  name: string;
  version: 1;
  nodes: unknown[];
  edges: unknown[];
  inputs: UserBlockPort[];
  outputs: UserBlockPort[];
  exposedParams: AppModeInput[];
  createdAt: number;
  updatedAt: number;
};

export type StudioFormState = {
  mode: StudioMode;
  modelType: StudioModelType;
  prompt: string;
  negativePrompt: string;
  aspectRatio: StudioAspectRatio;
  width: number;
  height: number;
  seed: number;
  randomSeed: boolean;
  steps: number;
  guidanceScale: number;
  resourceMode: StudioResourceMode;
  dtype: 'float32' | 'float16' | 'bfloat16';
  quantizationMode: StudioQuantizationMode;
  device: string;
  autoOffload: boolean;
  offloadMode: StudioOffloadMode;
  trustRemoteCode: boolean;
  strength: number;
  layers: number;
  outpaintLeft: number;
  outpaintRight: number;
  outpaintTop: number;
  outpaintBottom: number;
  outpaintOverlap: number;
  outpaintFeather: number;
  outpaintFillColor: string;
  alphaMode: 'ignore' | 'add alpha' | 'remove alpha';
  referenceImages: string[];
  maskImage: string;
  controlImage: string;
  sourceVideo: string;
  maskVideo: string;
  controlVideo: string;
  sourceAudio: string;
  referenceAudio: string;
  lyrics: string;
  audioDuration: number;
  extensionDuration: number;
  vocalLanguage: string;
  repaintingStart: number;
  repaintingEnd: number;
  audioCoverStrength: number;
  shift: number;
  bpm: number;
  keyscale: string;
  timesignature: string;
  numFrames: number;
  fps: number;
  conditioningScale: number;
  guidanceScale2: number;
  outputType: 'pil' | 'np' | 'pt';
  maxSequenceLength: number;
  attentionKwargsJson: string;
};

export type StudioInpaintContractStatus = {
  available: boolean;
  status: 'supported' | 'blocked' | 'unknown';
  reason: string;
  source: string;
  checkedInputs?: Record<string, string[]>;
  missingInputs?: string[];
};

export type StudioModelProfile = {
  modelType: StudioModelType;
  label: string;
  displayName: string;
  family: 'Z-Image' | 'Qwen Image' | 'Wan Video' | 'ACE Audio' | 'FLUX Image';
  catalogVisibility?: 'default' | 'workflowOnly' | 'internal';
  surfaceCategory?: 'Image' | 'Image Edit' | 'Control' | 'Video' | 'Audio' | 'Utility';
  runtimeKind?: 'diffusers' | 'diffusers_accelerated' | 'legacy_external' | 'unsupported';
  isDiffusersBacked?: boolean;
  acceleratorStrategy?: string;
  legacyReason?: string;
  defaultRepo: string;
  artifactLabel?: string;
  alternateArtifact?: string;
  defaultDtype: StudioFormState['dtype'];
  defaultSize: { width: number; height: number; aspectRatio: StudioAspectRatio };
  recommendedSteps: number;
  recommendedGuidance: number;
  guidanceLabel: string;
  supportsImageInput: boolean;
  supportsMask: boolean;
  supportsMultiImage: boolean;
  supportsControlImage: boolean;
  supportsLayers: boolean;
  supportsLora: boolean;
  supportsVideoInput?: boolean;
  supportsVideoMask?: boolean;
  supportsAudioInput?: boolean;
  outputKind?: 'image' | 'video' | 'audio' | 'json';
  recommendedFrames?: number;
  recommendedFps?: number;
  recommendedDuration?: number;
  recommendedSampleRate?: number;
  conditioningScale?: number;
  inpaintContract?: StudioInpaintContractStatus;
  offloadSupport: {
    modes: StudioOffloadMode[];
    default: StudioOffloadMode;
    lowVram: StudioOffloadMode;
    emergency?: StudioOffloadMode;
  };
  lowVram: {
    dtype: StudioFormState['dtype'];
    quantizationMode?: StudioQuantizationMode;
    autoOffload: boolean;
    offloadMode?: StudioOffloadMode;
    steps: number;
    width?: number;
    height?: number;
    numFrames?: number;
  };
  modes: StudioMode[];
  additionalRequirements?: StudioModelRequirement[];
  modeRequirements?: Partial<Record<StudioMode, StudioModeRequirement>>;
};

export type StudioModelRequirement = {
  id: string;
  label: string;
  repo: string;
  kind: 'base' | 'controlnet' | 'adapter';
  requiredForModes?: StudioMode[];
  description?: string;
};

export type StudioModeRequirement = {
  modelRequirements?: StudioModelRequirement[];
  requiredImages?: Array<'referenceImages' | 'maskImage' | 'controlImage'>;
  requiredVideos?: Array<'sourceVideo' | 'maskVideo' | 'controlVideo'>;
  requiredAudio?: Array<'sourceAudio' | 'referenceAudio'>;
  note?: string;
};

export type StudioPreset = {
  id: StudioPresetId;
  label: string;
  description: string;
  values: Partial<StudioFormState>;
  compatibleModes?: StudioMode[];
  compatibleModelTypes?: StudioModelType[];
};

export type TemplateMediaType = 'image' | 'video' | 'audio' | 'json';

export type TemplateExactnessStatus = 'unverified' | 'reviewed' | 'exact' | 'blocked' | 'non_exact';

export type StudioTemplateIntentGroup =
  | 'generate_image'
  | 'product_brand'
  | 'typography_poster'
  | 'edit_image'
  | 'reference_control'
  | 'audio'
  | 'video'
  | 'adapters'
  | 'upscale'
  | 'performance'
  | 'utility'
  | 'planning';

export type StudioTemplateWorkflowBlock = 'lora' | 'upscaler';

export type StudioTemplateModelArtifact = {
  source: 'hub' | 'local';
  value: string;
  revision?: string;
  sha256?: string;
  byteSize?: number;
  license?: string;
};

export type StudioTemplateWorkflowBlockSettings = {
  lora?: {
    model: StudioTemplateModelArtifact;
    weightName?: string;
    scale: number;
  };
  upscaler?: {
    model: StudioTemplateModelArtifact;
    downscale: number;
  };
};

export type StudioTemplateMediaSlotKind =
  'image' | 'gif' | 'video' | 'audio' | 'json' | 'comparison_before' | 'comparison_after' | 'poster' | 'placeholder';

export type StudioTemplateMediaSlot = {
  id: string;
  label: string;
  kind: StudioTemplateMediaSlotKind;
  role?: 'preview' | 'before' | 'after' | 'poster' | 'hover' | 'comparison' | 'source' | 'output';
  path?: string;
  posterPath?: string;
  placeholder: string;
};

export type StudioTemplateReadinessPolicy =
  'runnable' | 'requires_input' | 'requires_model' | 'requires_backend' | 'planning';

export type StudioTemplateCategory =
  | 'concept'
  | 'product'
  | 'poster'
  | 'text'
  | 'edit'
  | 'control'
  | 'reference'
  | 'inpaint'
  | 'layers'
  | 'upscale'
  | 'outpaint'
  | 'low_vram'
  | 'lora'
  | 'video_generation'
  | 'video_edit'
  | 'video_inpaint'
  | 'video_outpaint'
  | 'video_control'
  | 'video_reference'
  | 'video_color'
  | 'audio_generation'
  | 'audio_edit'
  | 'flux';

export type StudioTemplateDifficulty = 'starter' | 'intermediate' | 'advanced' | 'blocked';

export type StudioTemplateThumbnailVariant =
  'image' | 'compareSlider' | 'hoverDissolve' | 'video' | 'audio' | 'contactSheet';

export type StudioTemplateInputRequirements = {
  referenceImages?: number;
  sourceImage?: boolean;
  maskImage?: boolean;
  controlImage?: boolean;
  sourceVideo?: boolean;
  maskVideo?: boolean;
  controlVideo?: boolean;
  sourceAudio?: boolean;
  referenceAudio?: boolean;
  loraAdapter?: boolean;
  upscalerModel?: boolean;
  sampleAssets?: string[];
};

export type StudioTemplateLockedSettings = Pick<
  StudioFormState,
  | 'mode'
  | 'modelType'
  | 'prompt'
  | 'negativePrompt'
  | 'width'
  | 'height'
  | 'seed'
  | 'randomSeed'
  | 'steps'
  | 'guidanceScale'
  | 'resourceMode'
  | 'dtype'
  | 'quantizationMode'
  | 'autoOffload'
  | 'offloadMode'
  | 'strength'
  | 'layers'
  | 'outpaintLeft'
  | 'outpaintRight'
  | 'outpaintTop'
  | 'outpaintBottom'
  | 'outpaintOverlap'
  | 'outpaintFeather'
  | 'outpaintFillColor'
  | 'sourceVideo'
  | 'maskVideo'
  | 'controlVideo'
  | 'sourceAudio'
  | 'referenceAudio'
  | 'lyrics'
  | 'audioDuration'
  | 'extensionDuration'
  | 'vocalLanguage'
  | 'repaintingStart'
  | 'repaintingEnd'
  | 'audioCoverStrength'
  | 'shift'
  | 'bpm'
  | 'keyscale'
  | 'timesignature'
  | 'numFrames'
  | 'fps'
  | 'conditioningScale'
  | 'guidanceScale2'
  | 'outputType'
  | 'maxSequenceLength'
  | 'attentionKwargsJson'
>;

export type StudioTemplateExample = {
  mediaType: TemplateMediaType;
  status: TemplateExactnessStatus;
  lockedSeed: number;
  lockedSettings?: Partial<StudioTemplateLockedSettings>;
  expectedOutput?: {
    width?: number;
    height?: number;
    frames?: number;
    durationSeconds?: number;
    sampleRate?: number;
  };
  modelRevision: string;
  runtimeEstimate: string;
  outputPath?: string;
  thumbnailPath?: string;
  mediaHash?: string;
  runtimeFingerprint?: string;
  verificationTimestamp?: string;
  blockReason?: string;
  notes?: string;
};

export type StudioTemplatePromptGuide = {
  subject: string[];
  composition: string[];
  style: string[];
  lighting: string[];
  camera: string[];
  textRendering: string[];
  negative: string[];
  modelHints: string[];
  environment?: string[];
  materials?: string[];
  preservation?: string[];
  change?: string[];
  motion?: string[];
  continuity?: string[];
  arrangement?: string[];
  mix?: string[];
  parameters?: string[];
};

export type StudioTemplatePredictability = {
  lockReason: string;
  exactnessNotes: string[];
  deterministicSettings: Partial<StudioTemplateLockedSettings>;
  requiredModels?: StudioModelRequirement[];
};

export type StudioTemplate = {
  id: StudioTemplateId;
  label: string;
  mode: StudioMode;
  modelType: StudioModelType;
  intentGroup?: StudioTemplateIntentGroup;
  category?: StudioTemplateCategory;
  tags?: string[];
  difficulty?: StudioTemplateDifficulty;
  thumbnailVariant?: StudioTemplateThumbnailVariant;
  inputRequirements?: StudioTemplateInputRequirements;
  outputKinds?: TemplateMediaType[];
  mediaSlots?: StudioTemplateMediaSlot[];
  requiredBackendCapabilities?: string[];
  workflowBlocks?: StudioTemplateWorkflowBlock[];
  workflowBlockSettings?: StudioTemplateWorkflowBlockSettings;
  readinessPolicy?: StudioTemplateReadinessPolicy;
  vramEstimate?: string;
  runtimeEstimate?: string;
  userGoal?: string;
  recipeSummary?: string;
  verificationStatus?: TemplateExactnessStatus;
  description: string;
  prompt: string;
  negativePrompt?: string;
  presetId?: StudioPresetId;
  example?: StudioTemplateExample;
  promptGuide?: StudioTemplatePromptGuide;
  predictability?: StudioTemplatePredictability;
};

export type StudioGraphSnapshot = {
  nodes: unknown[];
  edges: unknown[];
  viewport?: unknown;
};

export type StudioRunIdentity = {
  runId: string;
  sid?: string | null;
  taskId?: string | null;
  response?: unknown;
};

export type StudioRunContext = {
  id: string;
  startedAt: number;
  completedAt?: number;
  status?: 'submitted' | 'running' | 'completed' | 'failed' | 'cancelled';
  clientRunId: string;
  runInputHash: string;
  workflowTabId?: string | null;
  form: StudioFormState;
  graph: StudioGraphSnapshot;
  binding: StudioGraphBinding | null;
  apiGraph?: unknown;
  run?: StudioRunIdentity;
  templateId?: StudioTemplateId;
  sourceOutputId?: string;
  variationGroupId?: string;
  variationLabel?: string;
};

export type StudioOutputMediaItem = {
  index: number;
  role?: string;
  label?: string;
  value?: unknown;
  url: string;
  displayType?: 'image' | 'video' | 'audio' | 'text' | 'json' | 'unknown';
  backendPath?: string;
  mediaHash?: string;
  contentType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  clientRunId?: string;
  runInputHash?: string;
  attemptIndex?: number;
  taskId?: string | null;
};

export type StudioImportedAsset = {
  id: string;
  kind: 'imported';
  name: string;
  url: string;
  backendPath?: string;
  displayType: 'image' | 'video' | 'audio' | 'unknown';
  mimeType?: string;
  byteSize?: number;
  createdAt: number;
  source: 'upload';
  storage?: 'backend' | 'browser';
};

export type StudioOutputProvenance = {
  schemaVersion: 1;
  source: 'frontend-record' | 'backend-record' | 'template-gallery';
  capturedAt: string;
  templateId?: StudioTemplateId;
  templateLockHash?: string;
  promptSettingsHash?: string;
  exactTemplateCompatible?: boolean;
  backendExecutionId?: string | null;
  clientRunId?: string;
  runInputHash?: string;
  workflowTabId?: string | null;
  attemptIndex?: number;
  nodeId: string;
  graphBindingFingerprint?: string;
  modelRevision?: string;
  runtimeFingerprint?: string;
  resourcePlan?: Record<string, unknown>;
  mediaHash?: string;
  mediaCollectionHash?: string;
  mediaItems?: StudioOutputMediaItem[];
  video?: {
    sourceVideo?: string;
    maskVideo?: string;
    controlVideo?: string;
    numFrames?: number;
    fps?: number;
    conditioningScale?: number;
    guidanceScale2?: number;
    outputType?: StudioFormState['outputType'];
  };
  audio?: {
    sourceAudio?: string;
    referenceAudio?: string;
    durationSeconds?: number;
  };
};

export type StudioOutput = {
  id: string;
  clientRunId?: string;
  runInputHash?: string;
  workflowTabId?: string | null;
  attemptIndex?: number;
  nodeId: string;
  fieldKey: string;
  value: unknown;
  url: string;
  mode: StudioMode;
  modelType: StudioModelType;
  modelLabel: string;
  repo: string;
  templateId?: StudioTemplateId;
  templateLabel?: string;
  runId?: string;
  taskId?: string | null;
  sid?: string | null;
  prompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  steps: number;
  guidanceScale: number;
  referenceImages: string[];
  sourceOutputId?: string;
  formSnapshot: StudioFormState;
  graphSnapshot?: StudioGraphSnapshot;
  graphBindingSnapshot?: StudioGraphBinding | null;
  apiGraphSnapshot?: unknown;
  createdAt: number;
  favorite: boolean;
  parentId?: string;
  backendImagePath?: string;
  backendMediaPath?: string;
  backendSyncedAt?: number;
  displayType?: 'image' | 'image_collection' | 'video' | 'audio' | 'text' | 'json' | 'unknown';
  mediaHash?: string;
  mediaCollectionHash?: string;
  mediaItems?: StudioOutputMediaItem[];
  templateLockHash?: string;
  promptSettingsHash?: string;
  exactTemplateCompatible?: boolean;
  variationGroupId?: string;
  variationLabel?: string;
  provenance?: StudioOutputProvenance;
  backendProvenance?: {
    schemaVersion: 1;
    source: 'backend-record';
    capturedAt: number;
    backendExecutionId?: string | null;
    clientRunId?: string;
    runInputHash?: string;
    workflowTabId?: string | null;
    attemptIndex?: number;
    nodeId?: string;
    fieldKey?: string;
    historyPath?: string;
    mediaPath?: string;
    mediaHash?: string;
    mediaCollectionHash?: string;
    mediaItems?: StudioOutputMediaItem[];
    runtimeFingerprint?: string;
    templateId?: StudioTemplateId;
    templateLockHash?: string;
    promptSettingsHash?: string;
  };
};
