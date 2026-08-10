import {
  DEFAULT_STUDIO_FORM,
  LEGACY_STUDIO_OFFLOAD_MODES,
  normalizeStudioOffloadMode,
  STUDIO_MODEL_PROFILES,
} from './modelProfiles';
import { normalizeStudioResourceMode } from './resourcePlanner';
import type {
  StudioFormState,
  StudioGraphBinding,
  StudioGraphSnapshot,
  StudioMode,
  StudioModelType,
  StudioOutput,
  StudioOutputMediaItem,
  StudioPreviewSlot,
  StudioPreviewSlotStatus,
  StudioTemplateId,
} from './types';

export type BackendOutputsResponse = {
  error?: boolean;
  message?: string;
  outputs: StudioOutput[];
  previewSlots: StudioPreviewSlot[];
  revision: number;
};

const STUDIO_PREVIEW_SLOT_STATUSES: readonly StudioPreviewSlotStatus[] = [
  'empty',
  'pending',
  'ready',
  'failed',
  'cancelled',
  'completed_without_output',
];

const STUDIO_MODES: readonly StudioMode[] = [
  'text_to_image',
  'edit_image',
  'multi_image_reference_edit',
  'inpaint',
  'outpaint',
  'control_image',
  'layer_decomposition',
  'text_to_video',
  'image_to_video',
  'video_to_video',
  'video_inpaint',
  'video_outpaint',
  'reference_to_video',
  'control_to_video',
  'video_color_edit',
  'text_to_audio',
  'audio_variation',
  'audio_continuation',
  'audio_repaint',
  'advanced_workflow',
];

// Keep persistence validation tied to the canonical model registry. A copied
// allow-list previously omitted the Wan and LTX model types, so restoring an
// otherwise valid video workflow silently replaced its model with the global
// Z-Image default while preserving the video graph.
const STUDIO_MODEL_TYPES = Object.keys(STUDIO_MODEL_PROFILES) as StudioModelType[];

const STUDIO_ASPECT_RATIOS: readonly StudioFormState['aspectRatio'][] = ['1:1', '4:3', '3:4', '16:9', '9:16', 'custom'];
const STUDIO_DTYPES: readonly StudioFormState['dtype'][] = ['float32', 'float16', 'bfloat16'];
const STUDIO_QUANTIZATION_MODES: readonly StudioFormState['quantizationMode'][] = [
  'none',
  'bnb_4bit',
  'bnb_8bit',
  'quanto_float8',
  'torchao_float8',
];
const STUDIO_ALPHA_MODES: readonly StudioFormState['alphaMode'][] = ['ignore', 'add alpha', 'remove alpha'];
const STUDIO_OUTPUT_TYPES: readonly StudioFormState['outputType'][] = ['pil', 'np', 'pt'];
const STUDIO_TEMPLATE_IDS: readonly StudioTemplateId[] = [
  'z_image_quick_concept',
  'z_image_product_mockup',
  'z_image_poster',
  'z_image_lora_style',
  'qwen_text_rendering',
  'qwen_poster_logo_text',
  'qwen_product_mockup',
  'qwen_low_vram_text_rendering',
  'qwen_low_vram_product_concept',
  'qwen_low_vram_poster_layout',
  'qwen_control_image_layout',
  'z_image_cinematic_contact_sheet',
  'qwen_product_ad_composite',
  'qwen_product_relight',
  'qwen_packaging_dieline',
  'qwen_character_angles',
  'qwen_tile_extract',
  'qwen_logo_texture',
  'qwen_layered_portrait',
  'qwen_outpaint_aspect_template',
  'qwen_inpaint_object_replace',
  'character_edit',
  'qwen_edit_strength_sweep',
  'reference_fusion',
  'qwen_multi_reference_product',
  'qwen_inpaint_mask_draft',
  'layer_decomposition',
  'qwen_upscale_finish',
  'qwen_outpaint_draft',
  'low_vram',
  'fast_lora',
  'high_quality',
  'wan_vace_cinematic_text_to_video',
  'wan_vace_direct_text_to_video',
  'wan_vace_animate_product_still',
  'wan_vace_video_color_grade',
  'wan_vace_masked_object_replace',
  'wan_vace_outpaint_reframe',
  'wan_vace_reference_motion',
  'wan_vace_grayscale_control',
  'ace_step_text_to_audio',
  'ace_step_audio_variation',
  'ace_step_audio_continuation',
  'ace_step_audio_repaint',
  'ace_step_chinese_new_year_lora',
  'ace_step_custom_lora',
  'flux_schnell_text_to_image',
  'flux_dev_expert_text_to_image',
  'flux_lora_ghibli_story',
  'flux_lora_oil_painting',
  'flux_lora_film_noir',
  'flux_lora_retro_comic',
  'flux_lora_watercolor',
  'flux_lora_paper_cutout',
  'flux_lora_photoreal_documentary',
  'flux_kontext_edit',
  'flux_fill_inpaint',
  'flux_control_canny',
  'flux_krea_text_to_image',
  'flux_kontext_multi_reference',
  'flux_fill_outpaint',
  'flux_depth_control',
  'flux_redux_edit',
  'flux_redux_multi_reference',
  'flux2_klein_text_to_image',
  'flux2_klein_edit',
  'flux2_klein_multi_reference',
  'wan_vace_video_to_video',
  'qwen_edit_plus_single_image',
  'ltx_video_text_to_video',
  'ltx_video_image_to_video',
  'ltx_video_video_to_video',
  'ltx_video_multi_reference',
  'ltx_video_long_showcase',
  'wan_video_long_showcase',
  'wan_22_i2v_seed_vault',
  'wan_21_t2v_13b_seed_vault',
  'wan_22_ti2v_5b_seed_vault',
  'ltx_video_animated_story',
  'ace_step_lyric_music_video',
];
const STUDIO_OUTPUT_DISPLAY_TYPES: readonly NonNullable<StudioOutput['displayType']>[] = [
  'image',
  'image_collection',
  'video',
  'audio',
  'text',
  'json',
  'unknown',
];
const STUDIO_MEDIA_ITEM_DISPLAY_TYPES: readonly NonNullable<StudioOutputMediaItem['displayType']>[] = [
  'image',
  'video',
  'audio',
  'text',
  'json',
  'unknown',
];
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

export function optionalNullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function stringArrayValue(value: unknown, fallback: string[] = []) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
}

function stringRecordValue(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function stringUnionValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function optionalStringUnion<T extends string>(value: unknown, allowed: readonly T[]) {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function safeCloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return value;
  }
}

export function coerceStudioFormState(value: unknown): StudioFormState {
  const form = isRecord(value) ? value : {};
  const modelType = stringUnionValue(form.modelType, STUDIO_MODEL_TYPES, DEFAULT_STUDIO_FORM.modelType);
  const coerced: StudioFormState = {
    mode: stringUnionValue(form.mode, STUDIO_MODES, DEFAULT_STUDIO_FORM.mode),
    modelType,
    prompt: stringValue(form.prompt, DEFAULT_STUDIO_FORM.prompt),
    negativePrompt: stringValue(form.negativePrompt, DEFAULT_STUDIO_FORM.negativePrompt),
    aspectRatio: stringUnionValue(form.aspectRatio, STUDIO_ASPECT_RATIOS, DEFAULT_STUDIO_FORM.aspectRatio),
    width: numberValue(form.width, DEFAULT_STUDIO_FORM.width),
    height: numberValue(form.height, DEFAULT_STUDIO_FORM.height),
    seed: numberValue(form.seed, DEFAULT_STUDIO_FORM.seed),
    randomSeed: booleanValue(form.randomSeed, DEFAULT_STUDIO_FORM.randomSeed),
    steps: numberValue(form.steps, DEFAULT_STUDIO_FORM.steps),
    guidanceScale: numberValue(form.guidanceScale, DEFAULT_STUDIO_FORM.guidanceScale),
    resourceMode: normalizeStudioResourceMode(form.resourceMode),
    dtype: stringUnionValue(form.dtype, STUDIO_DTYPES, DEFAULT_STUDIO_FORM.dtype),
    quantizationMode: stringUnionValue(
      form.quantizationMode,
      STUDIO_QUANTIZATION_MODES,
      DEFAULT_STUDIO_FORM.quantizationMode,
    ),
    device: stringValue(form.device, DEFAULT_STUDIO_FORM.device),
    autoOffload: booleanValue(form.autoOffload, DEFAULT_STUDIO_FORM.autoOffload),
    offloadMode: normalizeStudioOffloadMode(
      stringUnionValue(form.offloadMode, LEGACY_STUDIO_OFFLOAD_MODES, DEFAULT_STUDIO_FORM.offloadMode),
    ),
    trustRemoteCode: booleanValue(form.trustRemoteCode, DEFAULT_STUDIO_FORM.trustRemoteCode),
    strength: numberValue(form.strength, DEFAULT_STUDIO_FORM.strength),
    layers: numberValue(form.layers, DEFAULT_STUDIO_FORM.layers),
    outpaintLeft: numberValue(form.outpaintLeft, DEFAULT_STUDIO_FORM.outpaintLeft),
    outpaintRight: numberValue(form.outpaintRight, DEFAULT_STUDIO_FORM.outpaintRight),
    outpaintTop: numberValue(form.outpaintTop, DEFAULT_STUDIO_FORM.outpaintTop),
    outpaintBottom: numberValue(form.outpaintBottom, DEFAULT_STUDIO_FORM.outpaintBottom),
    outpaintOverlap: numberValue(form.outpaintOverlap, DEFAULT_STUDIO_FORM.outpaintOverlap),
    outpaintFeather: numberValue(form.outpaintFeather, DEFAULT_STUDIO_FORM.outpaintFeather),
    outpaintFillColor: stringValue(form.outpaintFillColor, DEFAULT_STUDIO_FORM.outpaintFillColor),
    alphaMode: stringUnionValue(form.alphaMode, STUDIO_ALPHA_MODES, DEFAULT_STUDIO_FORM.alphaMode),
    referenceImages: stringArrayValue(form.referenceImages, DEFAULT_STUDIO_FORM.referenceImages),
    maskImage: stringValue(form.maskImage, DEFAULT_STUDIO_FORM.maskImage),
    controlImage: stringValue(form.controlImage, DEFAULT_STUDIO_FORM.controlImage),
    sourceVideo: stringValue(form.sourceVideo, DEFAULT_STUDIO_FORM.sourceVideo),
    maskVideo: stringValue(form.maskVideo, DEFAULT_STUDIO_FORM.maskVideo),
    controlVideo: stringValue(form.controlVideo, DEFAULT_STUDIO_FORM.controlVideo),
    sourceAudio: stringValue(form.sourceAudio, DEFAULT_STUDIO_FORM.sourceAudio),
    referenceAudio: stringValue(form.referenceAudio, DEFAULT_STUDIO_FORM.referenceAudio),
    lyrics: stringValue(form.lyrics, DEFAULT_STUDIO_FORM.lyrics),
    audioDuration: numberValue(form.audioDuration, DEFAULT_STUDIO_FORM.audioDuration),
    extensionDuration: numberValue(form.extensionDuration, DEFAULT_STUDIO_FORM.extensionDuration),
    vocalLanguage: stringValue(form.vocalLanguage, DEFAULT_STUDIO_FORM.vocalLanguage),
    repaintingStart: numberValue(form.repaintingStart, DEFAULT_STUDIO_FORM.repaintingStart),
    repaintingEnd: numberValue(form.repaintingEnd, DEFAULT_STUDIO_FORM.repaintingEnd),
    audioCoverStrength: numberValue(form.audioCoverStrength, DEFAULT_STUDIO_FORM.audioCoverStrength),
    shift: numberValue(form.shift, DEFAULT_STUDIO_FORM.shift),
    bpm: numberValue(form.bpm, DEFAULT_STUDIO_FORM.bpm),
    keyscale: stringValue(form.keyscale, DEFAULT_STUDIO_FORM.keyscale),
    timesignature: stringValue(form.timesignature, DEFAULT_STUDIO_FORM.timesignature),
    numFrames: numberValue(form.numFrames, DEFAULT_STUDIO_FORM.numFrames),
    fps: numberValue(form.fps, DEFAULT_STUDIO_FORM.fps),
    conditioningScale: numberValue(form.conditioningScale, DEFAULT_STUDIO_FORM.conditioningScale),
    guidanceScale2: numberValue(form.guidanceScale2, DEFAULT_STUDIO_FORM.guidanceScale2),
    outputType: stringUnionValue(form.outputType, STUDIO_OUTPUT_TYPES, DEFAULT_STUDIO_FORM.outputType),
    maxSequenceLength: numberValue(form.maxSequenceLength, DEFAULT_STUDIO_FORM.maxSequenceLength),
    attentionKwargsJson: stringValue(form.attentionKwargsJson, DEFAULT_STUDIO_FORM.attentionKwargsJson),
  };
  coerced.resourceMode = normalizeStudioResourceMode(form.resourceMode, coerced);
  if (!['Qwen Image', 'FLUX Image'].includes(STUDIO_MODEL_PROFILES[coerced.modelType]?.family ?? '')) {
    return { ...coerced, quantizationMode: 'none' };
  }
  return coerced;
}

export function coerceStudioGraphSnapshot(value: unknown): StudioGraphSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  return {
    nodes: Array.isArray(value.nodes) ? (safeCloneJson(value.nodes) as unknown[]) : [],
    edges: Array.isArray(value.edges) ? (safeCloneJson(value.edges) as unknown[]) : [],
    viewport: value.viewport === undefined ? undefined : safeCloneJson(value.viewport),
  };
}

export function coerceStudioGraphBinding(value: unknown): StudioGraphBinding | null {
  if (!isRecord(value)) return null;
  const rawProof = isRecord(value.finalizationProof) ? value.finalizationProof : null;
  const shapeKey = stringValue(rawProof?.shapeKey);
  const fieldSchemaHash = stringValue(rawProof?.fieldSchemaHash);
  const edgeSpecHash = stringValue(rawProof?.edgeSpecHash);
  const finalizationProof =
    rawProof?.schemaVersion === 2 &&
    shapeKey &&
    fieldSchemaHash &&
    edgeSpecHash &&
    typeof rawProof.finalizedAt === 'number' &&
    Number.isFinite(rawProof.finalizedAt)
      ? {
          schemaVersion: 2 as const,
          shapeKey,
          fieldSchemaHash,
          edgeSpecHash,
          finalizedAt: rawProof.finalizedAt,
        }
      : undefined;
  return {
    mode: stringUnionValue(value.mode, STUDIO_MODES, DEFAULT_STUDIO_FORM.mode),
    modelType: stringUnionValue(value.modelType, STUDIO_MODEL_TYPES, DEFAULT_STUDIO_FORM.modelType),
    nodes: stringRecordValue(value.nodes),
    managedNodeIds: stringArrayValue(value.managedNodeIds),
    managedEdgeIds: stringArrayValue(value.managedEdgeIds),
    fingerprint: stringValue(value.fingerprint, ''),
    ...(finalizationProof ? { finalizationProof } : {}),
    createdAt: numberValue(value.createdAt, Date.now()),
    updatedAt: numberValue(value.updatedAt, Date.now()),
  };
}

export function coerceStudioTemplateId(value: unknown): StudioTemplateId | undefined {
  if (typeof value !== 'string') return undefined;
  return optionalStringUnion(value, STUDIO_TEMPLATE_IDS);
}

function coerceStudioOutputMediaItem(value: unknown, fallbackIndex: number): StudioOutputMediaItem | undefined {
  if (!isRecord(value)) return undefined;
  const url = stringValue(value.url);
  if (!url) return undefined;
  return {
    index: numberValue(value.index, fallbackIndex),
    role: optionalString(value.role),
    label: optionalString(value.label),
    value: safeCloneJson(value.value),
    url,
    displayType: optionalStringUnion(value.displayType, STUDIO_MEDIA_ITEM_DISPLAY_TYPES),
    backendPath: optionalString(value.backendPath),
    mediaHash: optionalString(value.mediaHash),
    contentType: optionalString(value.contentType),
    byteSize: optionalNumber(value.byteSize),
    width: optionalNumber(value.width),
    height: optionalNumber(value.height),
    durationSeconds: optionalNumber(value.durationSeconds),
    clientRunId: optionalString(value.clientRunId),
    runInputHash: optionalString(value.runInputHash),
    attemptIndex: optionalNumber(value.attemptIndex),
    taskId: optionalNullableString(value.taskId),
  };
}

function coerceStudioOutputMediaItems(value: unknown): StudioOutputMediaItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item, index) => coerceStudioOutputMediaItem(item, index))
    .filter((item): item is StudioOutputMediaItem => Boolean(item));
  return items.length > 0 ? items : undefined;
}

export function coerceStudioOutput(value: unknown): StudioOutput | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const url = stringValue(value.url);
  if (!id || !url) return undefined;

  const mode = stringUnionValue(value.mode, STUDIO_MODES, DEFAULT_STUDIO_FORM.mode);
  const modelType = stringUnionValue(value.modelType, STUDIO_MODEL_TYPES, DEFAULT_STUDIO_FORM.modelType);
  const profile = STUDIO_MODEL_PROFILES[modelType];
  const formSnapshot = coerceStudioFormState(value.formSnapshot);

  return {
    id,
    clientRunId: optionalString(value.clientRunId),
    runInputHash: optionalString(value.runInputHash),
    workflowTabId: optionalNullableString(value.workflowTabId),
    attemptIndex: optionalNumber(value.attemptIndex),
    nodeId: stringValue(value.nodeId, 'studio-output'),
    fieldKey: stringValue(value.fieldKey, 'output'),
    value: safeCloneJson(value.value ?? url),
    url,
    mode,
    modelType,
    modelLabel: stringValue(value.modelLabel, profile.label),
    repo: stringValue(value.repo, profile.defaultRepo),
    templateId: coerceStudioTemplateId(value.templateId),
    templateLabel: optionalString(value.templateLabel),
    runId: optionalString(value.runId),
    taskId: optionalNullableString(value.taskId),
    sid: optionalNullableString(value.sid),
    prompt: stringValue(value.prompt, formSnapshot.prompt),
    negativePrompt: stringValue(value.negativePrompt, formSnapshot.negativePrompt),
    seed: numberValue(value.seed, formSnapshot.seed),
    width: numberValue(value.width, formSnapshot.width),
    height: numberValue(value.height, formSnapshot.height),
    steps: numberValue(value.steps, formSnapshot.steps),
    guidanceScale: numberValue(value.guidanceScale, formSnapshot.guidanceScale),
    referenceImages: stringArrayValue(value.referenceImages, formSnapshot.referenceImages),
    sourceOutputId: optionalString(value.sourceOutputId),
    formSnapshot,
    graphSnapshot: coerceStudioGraphSnapshot(value.graphSnapshot),
    graphBindingSnapshot: coerceStudioGraphBinding(value.graphBindingSnapshot),
    apiGraphSnapshot: safeCloneJson(value.apiGraphSnapshot),
    createdAt: numberValue(value.createdAt, Date.now()),
    favorite: booleanValue(value.favorite, false),
    parentId: optionalString(value.parentId),
    backendImagePath: optionalString(value.backendImagePath),
    backendMediaPath: optionalString(value.backendMediaPath),
    backendSyncedAt: optionalNumber(value.backendSyncedAt),
    displayType: optionalStringUnion(value.displayType, STUDIO_OUTPUT_DISPLAY_TYPES),
    mediaHash: optionalString(value.mediaHash),
    mediaCollectionHash: optionalString(value.mediaCollectionHash),
    mediaItems: coerceStudioOutputMediaItems(value.mediaItems),
    templateLockHash: optionalString(value.templateLockHash),
    promptSettingsHash: optionalString(value.promptSettingsHash),
    exactTemplateCompatible:
      typeof value.exactTemplateCompatible === 'boolean' ? value.exactTemplateCompatible : undefined,
    variationGroupId: optionalString(value.variationGroupId),
    variationLabel: optionalString(value.variationLabel),
    provenance: safeCloneJson(value.provenance) as StudioOutput['provenance'],
    backendProvenance: safeCloneJson(value.backendProvenance) as StudioOutput['backendProvenance'],
  };
}

export function parseBackendOutputsResponse(value: unknown): BackendOutputsResponse {
  const data = isRecord(value) ? value : {};
  const errorMessage = typeof data.error === 'string' ? data.error : undefined;
  return {
    error: data.error === true || Boolean(errorMessage),
    message: optionalString(data.message) ?? errorMessage,
    outputs: Array.isArray(data.outputs)
      ? data.outputs.map(coerceStudioOutput).filter((output): output is StudioOutput => Boolean(output))
      : [],
    previewSlots: Array.isArray(data.previewSlots)
      ? data.previewSlots.map(coerceStudioPreviewSlot).filter((slot): slot is StudioPreviewSlot => Boolean(slot))
      : [],
    revision: numberValue(data.revision, 0),
  };
}

export function coerceStudioPreviewSlot(value: unknown): StudioPreviewSlot | null {
  if (!isRecord(value)) return null;
  const workflowTabId = optionalString(value.workflowTabId);
  const nodeId = optionalString(value.nodeId);
  const fieldKey = optionalString(value.fieldKey);
  if (!workflowTabId || !nodeId || !fieldKey) return null;
  return {
    schemaVersion: 1,
    workflowTabId,
    nodeId,
    fieldKey,
    currentOutputId: optionalNullableString(value.currentOutputId),
    pendingClientRunId: optionalNullableString(value.pendingClientRunId),
    pendingTaskId: optionalNullableString(value.pendingTaskId),
    generation: Math.max(0, numberValue(value.generation, 0)),
    attemptIndex:
      typeof value.attemptIndex === 'number' && Number.isFinite(value.attemptIndex) ? value.attemptIndex : null,
    status: stringUnionValue(value.status, STUDIO_PREVIEW_SLOT_STATUSES, 'empty'),
    updatedAt: numberValue(value.updatedAt, 0),
  };
}
