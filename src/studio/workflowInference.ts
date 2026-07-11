import type { Edge, Viewport } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import {
  DEFAULT_STUDIO_FORM,
  QWEN_OUTPAINT_CANVAS_NODE_KEY,
  STUDIO_MODEL_PROFILES,
  getDefaultModeForModel,
  getFormDefaultsForMode,
  isModelCompatibleWithMode,
  normalizeStudioOffloadMode,
} from './modelProfiles';
import { normalizeStudioResourceMode } from './resourcePlanner';
import type { StudioFormState, StudioMode, StudioModelType, WorkflowTabSnapshot } from './types';

type GraphLike = {
  nodes?: unknown[];
  edges?: Edge[];
  viewport?: Viewport;
};

type NodeLike = {
  id?: string;
  data?: {
    module?: string;
    action?: string;
    studioRole?: string;
    params?: Record<string, { value?: unknown; default?: unknown }>;
  };
};

const MODEL_TYPES = Object.keys(STUDIO_MODEL_PROFILES) as StudioModelType[];

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isNodeLike(value: unknown): value is NodeLike {
  return Boolean(value && typeof value === 'object' && 'data' in value);
}

function isStudioModelType(value: unknown): value is StudioModelType {
  return typeof value === 'string' && MODEL_TYPES.includes(value as StudioModelType);
}

function paramValue(node: NodeLike | undefined, candidates: string[]) {
  if (!node?.data?.params) return undefined;
  for (const key of candidates) {
    const param = node.data.params[key];
    if (!param) continue;
    return param.value ?? param.default;
  }
  return undefined;
}

function stringValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value) {
    return String((value as { value?: unknown }).value ?? '');
  }
  return '';
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function arrayStringValue(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = stringValue(value);
  return text ? [text] : [];
}

function nodeKey(node: NodeLike) {
  return `${node.data?.module ?? ''}.${node.data?.action ?? ''}`;
}

function findNode(nodes: NodeLike[], predicate: (node: NodeLike) => boolean) {
  return nodes.find(predicate);
}

function findNodes(nodes: NodeLike[], predicate: (node: NodeLike) => boolean) {
  return nodes.filter(predicate);
}

function inferModelType(nodes: NodeLike[], fallback: StudioFormState): StudioModelType {
  const explicit = nodes.map((node) => paramValue(node, ['model_type'])).find(isStudioModelType);
  if (explicit) return explicit;

  const repoText = nodes.map((node) => stringValue(paramValue(node, ['repo_id', 'model_id', 'repo']))).join(' ');
  const matchedProfile = Object.values(STUDIO_MODEL_PROFILES).find((profile) => repoText.includes(profile.defaultRepo));
  return matchedProfile?.modelType ?? fallback.modelType;
}

function inferMode(nodes: NodeLike[], modelType: StudioModelType, fallback: StudioFormState): StudioMode {
  const roles = new Set(nodes.map((node) => String(node.data?.studioRole ?? '')));
  const keys = new Set(nodes.map(nodeKey));
  const hasWan = keys.has('modules.WanVACE.LoadPipeline') || keys.has('modules.WanVACE.Generate');
  if (hasWan || modelType === 'WanVACEPipeline') {
    if (roles.has('loadMaskVideo') || roles.has('alignMaskVideo')) return 'video_inpaint';
    if (roles.has('loadControlVideo')) return 'control_to_video';
    if (roles.has('loadVideo')) return 'video_to_video';
    if (roles.has('loadImage')) return 'image_to_video';
    return 'text_to_video';
  }

  if (
    modelType === 'AceStepAudioPipeline' ||
    roles.has('audioGenerate') ||
    keys.has('modules.DiffusersAudio.Generate')
  ) {
    if (roles.has('loadAudio')) {
      const generateNode = findNode(
        nodes,
        (node) => node.data?.studioRole === 'audioGenerate' || nodeKey(node) === 'modules.DiffusersAudio.Generate',
      );
      const taskType = stringValue(paramValue(generateNode, ['task_type']));
      if (taskType === 'continuation') return 'audio_continuation';
      if (taskType === 'repaint') return 'audio_repaint';
      return 'audio_variation';
    }
    return 'text_to_audio';
  }

  if (modelType.startsWith('Flux') || keys.has('modules.DiffusersImage.LoadPipeline')) {
    if (roles.has('diffusersImageControl') || keys.has('modules.DiffusersImage.ControlGenerate'))
      return 'control_image';
    if (roles.has('diffusersImageInpaint') || keys.has('modules.DiffusersImage.Inpaint')) return 'inpaint';
    if (roles.has('diffusersImageEdit') || keys.has('modules.DiffusersImage.Edit')) return 'edit_image';
    return 'text_to_image';
  }

  if (roles.has('controlnet') || keys.has('modules.ModularDiffusers.Controlnet')) return 'control_image';
  if (roles.has('qwenOutpaintCanvas') || keys.has(QWEN_OUTPAINT_CANVAS_NODE_KEY)) return 'outpaint';
  if (roles.has('qwenInpaint') || keys.has('modules.QwenImage.Inpaint')) return 'inpaint';
  if (roles.has('applyMask') || roles.has('loadMask') || keys.has('modules.Image.ApplyMask')) return 'inpaint';
  if (modelType === 'QwenImageLayeredModularPipeline') return 'layer_decomposition';
  if (modelType === 'QwenImageEditPlusModularPipeline') return 'multi_image_reference_edit';
  if (modelType === 'QwenImageEditModularPipeline') return 'edit_image';
  if (isModelCompatibleWithMode(modelType, fallback.mode)) return fallback.mode;
  return getDefaultModeForModel(modelType);
}

export function inferStudioFormFromWorkflow(
  nodesInput: unknown[],
  fallback: StudioFormState = DEFAULT_STUDIO_FORM,
): StudioFormState {
  const nodes = nodesInput.filter(isNodeLike);
  const modelType = inferModelType(nodes, fallback);
  const mode = inferMode(nodes, modelType, fallback);
  const defaults = getFormDefaultsForMode(mode, modelType);
  const promptNode = findNode(
    nodes,
    (node) =>
      [
        'prompt',
        'wanGenerate',
        'qwenGenerate',
        'qwenInpaint',
        'diffusersImageGenerate',
        'diffusersImageEdit',
        'diffusersImageInpaint',
        'diffusersImageControl',
        'audioGenerate',
      ].includes(String(node.data?.studioRole)) ||
      ['EncodePrompt', 'Generate', 'Inpaint', 'Edit', 'ControlGenerate'].includes(String(node.data?.action)),
  );
  const denoiseNode = findNode(nodes, (node) => node.data?.studioRole === 'denoise' || node.data?.action === 'Denoise');
  const modelNode = findNode(
    nodes,
    (node) =>
      [
        'models',
        'wanPipeline',
        'qwenPipeline',
        'qwenInpaintPipeline',
        'diffusersImagePipeline',
        'audioPipeline',
      ].includes(String(node.data?.studioRole)) ||
      ['ModelsLoader', 'LoadPipeline', 'LoadInpaintPipeline'].includes(String(node.data?.action)),
  );
  const quantizationNode = findNode(
    nodes,
    (node) => node.data?.studioRole === 'qwenQuantization' || node.data?.action === 'QuantizationConfigNode',
  );
  const generateNode = findNode(
    nodes,
    (node) =>
      [
        'wanGenerate',
        'qwenGenerate',
        'qwenInpaint',
        'diffusersImageGenerate',
        'diffusersImageEdit',
        'diffusersImageInpaint',
        'diffusersImageControl',
        'audioGenerate',
      ].includes(String(node.data?.studioRole)) ||
      ['Generate', 'Inpaint', 'Edit', 'ControlGenerate'].includes(String(node.data?.action)),
  );
  const outpaintNode = findNode(
    nodes,
    (node) => node.data?.studioRole === 'qwenOutpaintCanvas' || nodeKey(node) === QWEN_OUTPAINT_CANVAS_NODE_KEY,
  );
  const loadImages = findNodes(
    nodes,
    (node) => node.data?.action === 'Load' && nodeKey(node).startsWith('modules.Image.'),
  );
  const loadVideos = findNodes(
    nodes,
    (node) => node.data?.action === 'Load' && nodeKey(node).startsWith('modules.Video.'),
  );
  const loadAudios = findNodes(
    nodes,
    (node) => node.data?.action === 'Load' && nodeKey(node).startsWith('modules.Audio.'),
  );
  const sourceVideoNode =
    loadVideos.find((node) => ['loadVideo'].includes(String(node.data?.studioRole))) ?? loadVideos[0];
  const maskVideoNode = loadVideos.find((node) => node.data?.studioRole === 'loadMaskVideo');
  const controlVideoNode = loadVideos.find((node) => node.data?.studioRole === 'loadControlVideo');
  const loadImageNode = loadImages.find((node) => node.data?.studioRole === 'loadImage') ?? loadImages[0];
  const loadMaskNode = loadImages.find((node) => node.data?.studioRole === 'loadMask');
  const loadAudioNode = loadAudios.find((node) => node.data?.studioRole === 'loadAudio') ?? loadAudios[0];
  const loadReferenceAudioNode = loadAudios.find((node) => node.data?.studioRole === 'loadReferenceAudio');
  const sizeNode = generateNode ?? denoiseNode;
  const seed = paramValue(sizeNode, ['seed']);
  const seedObject = seed && typeof seed === 'object' ? (seed as { value?: unknown; isRandom?: unknown }) : null;
  const modelQuantizationMode = stringValue(paramValue(modelNode, ['quantization_mode']));
  const quantizationMode =
    modelQuantizationMode === 'bnb_4bit' ||
    modelQuantizationMode === 'bnb_8bit' ||
    modelQuantizationMode === 'quanto_float8' ||
    modelQuantizationMode === 'torchao_float8'
      ? modelQuantizationMode
      : stringValue(paramValue(quantizationNode, ['quant_type'])) === 'bnb_4bit'
        ? 'bnb_4bit'
        : defaults.quantizationMode;
  const autoOffload = boolValue(paramValue(modelNode, ['auto_offload']), defaults.autoOffload);
  const offloadMode = normalizeStudioOffloadMode(
    stringValue(paramValue(modelNode, ['offload_mode'])) || defaults.offloadMode,
  );

  return {
    ...fallback,
    ...defaults,
    mode,
    modelType,
    prompt: stringValue(paramValue(promptNode, ['prompt'])) || fallback.prompt,
    negativePrompt: stringValue(paramValue(promptNode, ['negative_prompt'])) || fallback.negativePrompt,
    width: numberValue(paramValue(sizeNode, ['width']), defaults.width),
    height: numberValue(paramValue(sizeNode, ['height']), defaults.height),
    seed: numberValue(seedObject?.value ?? seed, fallback.seed),
    randomSeed: boolValue(seedObject?.isRandom, fallback.randomSeed),
    steps: numberValue(paramValue(sizeNode, ['num_inference_steps', 'steps']), defaults.steps),
    guidanceScale: numberValue(
      paramValue(sizeNode, ['true_cfg_scale', 'guidance_scale', 'guidance']),
      defaults.guidanceScale,
    ),
    resourceMode: normalizeStudioResourceMode(undefined, { ...defaults, quantizationMode, autoOffload, offloadMode }),
    dtype: (stringValue(paramValue(modelNode, ['dtype'])) as StudioFormState['dtype']) || defaults.dtype,
    quantizationMode,
    device: stringValue(paramValue(modelNode, ['device'])) || defaults.device,
    autoOffload,
    offloadMode,
    strength: numberValue(paramValue(sizeNode, ['strength']), defaults.strength),
    layers: numberValue(paramValue(sizeNode, ['layers']), defaults.layers),
    outpaintLeft: numberValue(paramValue(outpaintNode, ['left']), defaults.outpaintLeft),
    outpaintRight: numberValue(paramValue(outpaintNode, ['right']), defaults.outpaintRight),
    outpaintTop: numberValue(paramValue(outpaintNode, ['top']), defaults.outpaintTop),
    outpaintBottom: numberValue(paramValue(outpaintNode, ['bottom']), defaults.outpaintBottom),
    outpaintOverlap: numberValue(paramValue(outpaintNode, ['overlap']), defaults.outpaintOverlap),
    outpaintFeather: numberValue(paramValue(outpaintNode, ['feather']), defaults.outpaintFeather),
    outpaintFillColor: stringValue(paramValue(outpaintNode, ['fill_color'])) || defaults.outpaintFillColor,
    referenceImages: arrayStringValue(paramValue(loadImageNode, ['file'])),
    maskImage: stringValue(paramValue(loadMaskNode, ['file'])),
    controlImage: mode === 'control_image' ? stringValue(paramValue(loadImageNode, ['file'])) : '',
    sourceVideo: stringValue(paramValue(sourceVideoNode, ['file'])),
    maskVideo: stringValue(paramValue(maskVideoNode, ['file'])),
    controlVideo: stringValue(paramValue(controlVideoNode, ['file'])),
    sourceAudio: stringValue(paramValue(loadAudioNode, ['file'])),
    referenceAudio: stringValue(paramValue(loadReferenceAudioNode, ['file'])),
    lyrics: stringValue(paramValue(generateNode, ['lyrics'])) || defaults.lyrics,
    audioDuration: numberValue(paramValue(generateNode, ['audio_duration']), defaults.audioDuration),
    extensionDuration: numberValue(paramValue(generateNode, ['extension_duration']), defaults.extensionDuration),
    vocalLanguage: stringValue(paramValue(generateNode, ['vocal_language'])) || defaults.vocalLanguage,
    repaintingStart: numberValue(paramValue(generateNode, ['repainting_start']), defaults.repaintingStart),
    repaintingEnd: numberValue(paramValue(generateNode, ['repainting_end']), defaults.repaintingEnd),
    audioCoverStrength: numberValue(paramValue(generateNode, ['audio_cover_strength']), defaults.audioCoverStrength),
    shift: numberValue(paramValue(generateNode, ['shift']), defaults.shift),
    bpm: numberValue(paramValue(generateNode, ['bpm']), defaults.bpm),
    keyscale: stringValue(paramValue(generateNode, ['keyscale'])) || defaults.keyscale,
    timesignature: stringValue(paramValue(generateNode, ['timesignature'])) || defaults.timesignature,
    numFrames: numberValue(paramValue(generateNode, ['num_frames']), defaults.numFrames),
    fps: numberValue(
      paramValue(
        findNode(nodes, (node) => node.data?.studioRole === 'videoExport'),
        ['fps'],
      ),
      defaults.fps,
    ),
    conditioningScale: numberValue(paramValue(generateNode, ['conditioning_scale']), defaults.conditioningScale),
    guidanceScale2: numberValue(paramValue(generateNode, ['guidance_scale_2']), defaults.guidanceScale2),
    outputType:
      (stringValue(paramValue(generateNode, ['output_type'])) as StudioFormState['outputType']) || defaults.outputType,
    maxSequenceLength: numberValue(paramValue(generateNode, ['max_sequence_length']), defaults.maxSequenceLength),
    attentionKwargsJson:
      stringValue(paramValue(generateNode, ['attention_kwargs_json'])) || defaults.attentionKwargsJson,
  };
}

export function workflowSnapshotFromGraph(
  graph: GraphLike,
  edgeType: string,
  fallback: StudioFormState = DEFAULT_STUDIO_FORM,
): WorkflowTabSnapshot {
  const nodes = cloneJson((Array.isArray(graph.nodes) ? graph.nodes : []) as CustomNodeType[]);
  const form = inferStudioFormFromWorkflow(nodes, fallback);
  return {
    nodes,
    edges: cloneJson(Array.isArray(graph.edges) ? graph.edges : []).map((edge) => ({
      ...edge,
      type: edge.type ?? edgeType,
    })),
    viewport: cloneJson(graph.viewport ?? { x: 0, y: 0, zoom: 1 }),
    studioForm: form,
    studioGraphBinding: null,
    selectedMode: form.mode,
    activeTemplateId: null,
    sourceOutputId: null,
  };
}
