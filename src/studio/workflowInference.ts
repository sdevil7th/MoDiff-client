import type { Edge, Viewport } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { rebaseGraphDevices } from './deviceRebase';
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
import type {
  StudioFormState,
  StudioGraphBinding,
  StudioGraphRole,
  StudioMode,
  StudioModelType,
  WorkflowTabSnapshot,
} from './types';

type GraphLike = {
  nodes?: unknown[];
  edges?: Edge[];
  viewport?: Viewport;
};

type NodeLike = {
  id?: string;
  type?: string;
  data?: {
    type?: string;
    module?: string;
    action?: string;
    category?: string;
    studioRole?: string;
    studioOwned?: boolean;
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

type ManagedWorkflowAdoption = {
  nodes: CustomNodeType[];
  binding: StudioGraphBinding;
};

type CanonicalNodeSpec = {
  module: string;
  action: string;
  role: StudioGraphRole;
};

type CanonicalEdgeSpec = {
  sourceRole: StudioGraphRole;
  sourceHandle: string;
  targetRole: StudioGraphRole;
  targetHandle: string;
};

const MODULAR_TEXT_TO_IMAGE_NODES: CanonicalNodeSpec[] = [
  { module: 'modules.ModularDiffusers', action: 'ModelsLoader', role: 'models' },
  { module: 'modules.ModularDiffusers', action: 'EncodePrompt', role: 'prompt' },
  { module: 'modules.ModularDiffusers', action: 'Denoise', role: 'denoise' },
  { module: 'modules.ModularDiffusers', action: 'DecodeLatents', role: 'decode' },
  { module: 'modules.Image', action: 'Preview', role: 'preview' },
];

const MODULAR_TEXT_TO_IMAGE_EDGES: CanonicalEdgeSpec[] = [
  { sourceRole: 'models', sourceHandle: 'text_encoders', targetRole: 'prompt', targetHandle: 'text_encoders' },
  { sourceRole: 'models', sourceHandle: 'unet_out', targetRole: 'denoise', targetHandle: 'unet' },
  { sourceRole: 'models', sourceHandle: 'vae_out', targetRole: 'decode', targetHandle: 'vae' },
  { sourceRole: 'models', sourceHandle: 'scheduler', targetRole: 'denoise', targetHandle: 'scheduler' },
  { sourceRole: 'prompt', sourceHandle: 'embeddings', targetRole: 'denoise', targetHandle: 'embeddings' },
  { sourceRole: 'denoise', sourceHandle: 'latents', targetRole: 'decode', targetHandle: 'latents' },
  { sourceRole: 'decode', sourceHandle: 'images', targetRole: 'preview', targetHandle: 'image' },
];

function isGraphContainer(node: NodeLike) {
  return (
    node.type === 'group' ||
    node.type === 'loop' ||
    node.data?.type === 'group' ||
    node.data?.type === 'loop' ||
    node.data?.category === 'group'
  );
}

function bindingForManagedNodes(
  nodes: CustomNodeType[],
  edges: Edge[],
  form: StudioFormState,
  roleNodeIds: Partial<Record<StudioGraphRole, string>>,
): StudioGraphBinding {
  const managedNodeIds = nodes.map((node) => node.id);
  const managedNodeSet = new Set(managedNodeIds);
  return {
    mode: form.mode,
    modelType: form.modelType,
    nodes: roleNodeIds,
    managedNodeIds,
    managedEdgeIds: edges
      .filter((edge) => managedNodeSet.has(edge.source) && managedNodeSet.has(edge.target))
      .map((edge) => edge.id),
    fingerprint: `${form.mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}`,
    // Inferred bindings must be deterministic so normalizing the same backend
    // record cannot create a new content signature and trigger a save loop.
    createdAt: 0,
    updatedAt: 0,
  };
}

function adoptRoleMarkedWorkflow(
  nodes: CustomNodeType[],
  edges: Edge[],
  form: StudioFormState,
): ManagedWorkflowAdoption | null {
  const executableNodes = nodes.filter((node) => !isGraphContainer(node));
  const roleNodes = executableNodes.filter((node) => typeof node.data.studioRole === 'string');
  if (roleNodes.length === 0) return null;
  if (executableNodes.some((node) => node.data.studioOwned !== true && typeof node.data.studioRole !== 'string')) {
    return null;
  }

  const roleNodeIds: Partial<Record<StudioGraphRole, string>> = {};
  for (const node of roleNodes) {
    const role = node.data.studioRole as StudioGraphRole;
    if (roleNodeIds[role]) return null;
    roleNodeIds[role] = node.id;
  }

  const managedNodeSet = new Set(executableNodes.map((node) => node.id));
  if (edges.some((edge) => !managedNodeSet.has(edge.source) || !managedNodeSet.has(edge.target))) return null;

  const executableNodeIds = new Set(executableNodes.map((node) => node.id));
  const adoptedManagedNodes = executableNodes.map((node) => ({
    ...node,
    data: { ...node.data, studioOwned: true },
  }));
  const adoptedNodes = nodes.map((node) => {
    const managed = adoptedManagedNodes.find((candidate) => candidate.id === node.id);
    return managed ?? node;
  });
  return {
    nodes: adoptedNodes,
    binding: bindingForManagedNodes(
      adoptedManagedNodes.filter((node) => executableNodeIds.has(node.id)),
      edges,
      form,
      roleNodeIds,
    ),
  };
}

function canonicalEdgeKey(
  source: string,
  sourceHandle: string | null | undefined,
  target: string,
  targetHandle: string | null | undefined,
) {
  return `${source}:${sourceHandle ?? ''}->${target}:${targetHandle ?? ''}`;
}

function adoptCanonicalModularTextToImageWorkflow(
  nodes: CustomNodeType[],
  edges: Edge[],
  form: StudioFormState,
): ManagedWorkflowAdoption | null {
  if (form.mode !== 'text_to_image' || nodes.length !== MODULAR_TEXT_TO_IMAGE_NODES.length) return null;
  if (edges.length !== MODULAR_TEXT_TO_IMAGE_EDGES.length) return null;

  const roleNodeIds: Partial<Record<StudioGraphRole, string>> = {};
  for (const spec of MODULAR_TEXT_TO_IMAGE_NODES) {
    const matches = nodes.filter((node) => node.data.module === spec.module && node.data.action === spec.action);
    const matchedNodeId = matches[0]?.id;
    if (matches.length !== 1 || !matchedNodeId) return null;
    roleNodeIds[spec.role] = matchedNodeId;
  }
  if (new Set(Object.values(roleNodeIds)).size !== nodes.length) return null;

  const expectedEdges = new Set(
    MODULAR_TEXT_TO_IMAGE_EDGES.map((spec) =>
      canonicalEdgeKey(
        roleNodeIds[spec.sourceRole] ?? '',
        spec.sourceHandle,
        roleNodeIds[spec.targetRole] ?? '',
        spec.targetHandle,
      ),
    ),
  );
  const actualEdges = edges.map((edge) =>
    canonicalEdgeKey(edge.source, edge.sourceHandle, edge.target, edge.targetHandle),
  );
  if (new Set(actualEdges).size !== actualEdges.length) return null;
  if (actualEdges.some((edge) => !expectedEdges.has(edge))) return null;

  const roleByNodeId = new Map(Object.entries(roleNodeIds).map(([role, nodeId]) => [nodeId, role as StudioGraphRole]));
  const adoptedNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      studioRole: roleByNodeId.get(node.id),
      studioOwned: true,
    },
  }));
  return {
    nodes: adoptedNodes,
    binding: bindingForManagedNodes(adoptedNodes, edges, form, roleNodeIds),
  };
}

/**
 * Recover MoDiff's managed Studio contract only when provenance or topology is
 * unambiguous. Role-marked generated workflows are authoritative. For older
 * graph-library files without roles, the complete five-node/seven-edge modular
 * pipeline must match exactly; arbitrary and partially similar imports remain
 * custom graphs.
 */
export function adoptManagedWorkflowGraph(
  nodesInput: unknown[],
  edgesInput: Edge[],
  form: StudioFormState,
): ManagedWorkflowAdoption | null {
  const nodes = nodesInput.filter(isNodeLike) as CustomNodeType[];
  if (nodes.length !== nodesInput.length || nodes.some((node) => typeof node.id !== 'string' || !node.id)) {
    return null;
  }
  if (edgesInput.some((edge) => typeof edge.id !== 'string' || !edge.id)) return null;
  return (
    adoptRoleMarkedWorkflow(nodes, edgesInput, form) ??
    adoptCanonicalModularTextToImageWorkflow(nodes, edgesInput, form)
  );
}

function inferModelType(nodes: NodeLike[], fallback: StudioFormState): StudioModelType {
  if (
    nodes.some(
      (node) => node.data?.studioRole === 'imageOperation' || nodeKey(node) === 'modules.ImageOperations.ProcessImage',
    )
  ) {
    return 'BuiltinImageOperation';
  }
  if (
    nodes.some((node) => node.data?.studioRole === 'videoOperation' || nodeKey(node) === 'modules.Video.ProcessVideo')
  ) {
    return 'BuiltinVideoOperation';
  }
  const explicit = nodes.map((node) => paramValue(node, ['model_type'])).find(isStudioModelType);
  if (explicit) return explicit;
  const pipelineClass = nodes.map((node) => paramValue(node, ['pipeline_class'])).find(isStudioModelType);
  if (pipelineClass) return pipelineClass;

  const repoText = nodes.map((node) => stringValue(paramValue(node, ['repo_id', 'model_id', 'repo']))).join(' ');
  const matchedProfile = Object.values(STUDIO_MODEL_PROFILES).find((profile) => repoText.includes(profile.defaultRepo));
  return matchedProfile?.modelType ?? fallback.modelType;
}

function inferMode(nodes: NodeLike[], modelType: StudioModelType, fallback: StudioFormState): StudioMode {
  const roles = new Set(nodes.map((node) => String(node.data?.studioRole ?? '')));
  const keys = new Set(nodes.map(nodeKey));
  if (modelType === 'BuiltinImageOperation' || roles.has('imageOperation')) {
    const operationNode = findNode(
      nodes,
      (node) => node.data?.studioRole === 'imageOperation' || nodeKey(node) === 'modules.ImageOperations.ProcessImage',
    );
    const operation = stringValue(paramValue(operationNode, ['operation']));
    if (
      [
        'image_adjustment',
        'image_filter',
        'image_crop',
        'image_upscale',
        'image_tile',
        'image_channels',
        'mask_composite',
      ].includes(operation)
    ) {
      return operation as StudioMode;
    }
    return 'image_adjustment';
  }
  if (modelType === 'BuiltinVideoOperation' || roles.has('videoOperation')) {
    const operationNode = findNode(
      nodes,
      (node) => node.data?.studioRole === 'videoOperation' || nodeKey(node) === 'modules.Video.ProcessVideo',
    );
    const operation = stringValue(paramValue(operationNode, ['operation']));
    return operation === 'video_stitch' ? 'video_stitch' : 'video_frame_extract';
  }
  if (
    modelType === 'ShapEPipeline' ||
    roles.has('diffusersThreeDGenerate') ||
    keys.has('modules.DiffusersThreeD.GenerateRenderedArtifact')
  ) {
    return 'text_to_3d';
  }
  const hasWan = keys.has('modules.DiffusersVideo.LoadPipeline') || keys.has('modules.DiffusersVideo.Generate');
  if (hasWan || modelType === 'WanVACEPipeline') {
    if (roles.has('loadMaskVideo') || roles.has('alignMaskVideo')) return 'video_inpaint';
    if (roles.has('loadVideo') && roles.has('loadControlVideo')) return 'control_video_to_video';
    if (roles.has('loadControlVideo')) return 'control_to_video';
    if (roles.has('loadVideo')) return 'video_to_video';
    if (roles.has('loadImage')) return 'image_to_video';
    return 'text_to_video';
  }

  if (keys.has('modules.HuggingFaceTransformers.GenerateAnyToAny')) {
    const generateNode = findNode(
      nodes,
      (node) => nodeKey(node) === 'modules.HuggingFaceTransformers.GenerateAnyToAny',
    );
    if (stringValue(paramValue(generateNode, ['generation_mode'])) === 'image') return 'text_to_image';
    return keys.has('modules.Image.Load') ? 'image_to_text' : 'text_generation';
  }

  if (
    modelType === 'HuggingFaceImageTextToTextModel' ||
    roles.has('transformersImageTextGenerate') ||
    keys.has('modules.HuggingFaceTransformers.GenerateImageVideoText')
  ) {
    return 'image_to_text';
  }

  if (
    modelType === 'HuggingFaceTextGenerationModel' ||
    roles.has('transformersTextGenerate') ||
    keys.has('modules.HuggingFaceTransformers.GenerateText')
  ) {
    return 'text_generation';
  }

  if (
    modelType === 'HuggingFaceSpeechRecognitionModel' ||
    roles.has('transcribeAudio') ||
    keys.has('modules.HuggingFaceSpeech.TranscribeAudio')
  ) {
    const actionNode = findNode(
      nodes,
      (node) =>
        node.data?.studioRole === 'transcribeAudio' || nodeKey(node) === 'modules.HuggingFaceSpeech.TranscribeAudio',
    );
    return stringValue(paramValue(actionNode, ['task'])) === 'translate' ? 'speech_translation' : 'speech_to_text';
  }

  if (
    modelType === 'AceStepAudioPipeline' ||
    modelType === 'StableAudioPipeline' ||
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
    if (roles.has('diffusersUnconditionalGenerate') || keys.has('modules.DiffusersImage.UnconditionalGenerate'))
      return 'unconditional_image';
    if (roles.has('diffusersPredictMap') || keys.has('modules.DiffusersImage.PredictMap')) return 'depth_estimation';
    if (roles.has('diffusersImageLayerDecompose') || keys.has('modules.DiffusersImage.LayerDecompose'))
      return 'layer_decomposition';
    if (roles.has('diffusersImageControlInpaint') || keys.has('modules.DiffusersImage.ControlInpaint'))
      return 'control_inpaint';
    if (roles.has('diffusersImageControlEdit') || keys.has('modules.DiffusersImage.ControlEdit'))
      return 'control_edit_image';
    if (roles.has('diffusersImageControl') || keys.has('modules.DiffusersImage.ControlGenerate'))
      return 'control_image';
    if (roles.has('outpaintCanvas') || roles.has('qwenOutpaintCanvas') || keys.has(QWEN_OUTPAINT_CANVAS_NODE_KEY))
      return 'outpaint';
    if (roles.has('diffusersImageInpaint') || keys.has('modules.DiffusersImage.Inpaint')) return 'inpaint';
    if (roles.has('diffusersImageEdit') || keys.has('modules.DiffusersImage.Edit')) return 'edit_image';
    return 'text_to_image';
  }

  if (roles.has('controlnet') || keys.has('modules.ModularDiffusers.Controlnet')) return 'control_image';
  if (roles.has('qwenOutpaintCanvas') || keys.has(QWEN_OUTPAINT_CANVAS_NODE_KEY)) return 'outpaint';
  if (roles.has('qwenInpaint') || keys.has('modules.DiffusersImage.Inpaint')) return 'inpaint';
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
        'diffusersUnconditionalGenerate',
        'diffusersPredictMap',
        'diffusersImageEdit',
        'diffusersImageInpaint',
        'diffusersImageControl',
        'diffusersImageControlEdit',
        'diffusersImageControlInpaint',
        'diffusersImageLayerDecompose',
        'audioGenerate',
        'transcribeAudio',
      ].includes(String(node.data?.studioRole)) ||
      [
        'EncodePrompt',
        'Generate',
        'UnconditionalGenerate',
        'PredictMap',
        'Inpaint',
        'Edit',
        'ControlGenerate',
        'ControlEdit',
        'ControlInpaint',
        'LayerDecompose',
        'TranscribeAudio',
        'GenerateAnyToAny',
      ].includes(String(node.data?.action)),
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
        'speechModel',
      ].includes(String(node.data?.studioRole)) ||
      [
        'ModelsLoader',
        'LoadPipeline',
        'LoadInpaintPipeline',
        'LoadSpeechRecognitionModel',
        'LoadAnyToAnyModel',
      ].includes(String(node.data?.action)),
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
        'diffusersUnconditionalGenerate',
        'diffusersPredictMap',
        'diffusersImageEdit',
        'diffusersImageInpaint',
        'diffusersImageControl',
        'diffusersImageControlEdit',
        'diffusersImageControlInpaint',
        'diffusersImageLayerDecompose',
        'audioGenerate',
        'transcribeAudio',
      ].includes(String(node.data?.studioRole)) ||
      [
        'Generate',
        'UnconditionalGenerate',
        'PredictMap',
        'Inpaint',
        'Edit',
        'ControlGenerate',
        'ControlEdit',
        'ControlInpaint',
        'LayerDecompose',
        'TranscribeAudio',
        'GenerateAnyToAny',
      ].includes(String(node.data?.action)),
  );
  const outpaintNode = findNode(
    nodes,
    (node) =>
      node.data?.studioRole === 'outpaintCanvas' ||
      node.data?.studioRole === 'qwenOutpaintCanvas' ||
      nodeKey(node) === QWEN_OUTPAINT_CANVAS_NODE_KEY,
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
    loadVideos.find((node) => node.data?.studioRole === 'loadVideo') ??
    loadVideos.find((node) => !['loadControlVideo', 'loadMaskVideo'].includes(String(node.data?.studioRole)));
  const maskVideoNode = loadVideos.find((node) => node.data?.studioRole === 'loadMaskVideo');
  const controlVideoNode = loadVideos.find((node) => node.data?.studioRole === 'loadControlVideo');
  const videoOperationNode = findNode(
    nodes,
    (node) => node.data?.studioRole === 'videoOperation' || nodeKey(node) === 'modules.Video.ProcessVideo',
  );
  const operationVideos = arrayStringValue(paramValue(videoOperationNode, ['videos']));
  const loadImageNode = loadImages.find((node) => node.data?.studioRole === 'loadImage') ?? loadImages[0];
  const loadControlImageNode = loadImages.find((node) => node.data?.studioRole === 'loadControlImage');
  const loadMaskNode = loadImages.find((node) => node.data?.studioRole === 'loadMask');
  const loadAudioNode = loadAudios.find((node) => node.data?.studioRole === 'loadAudio') ?? loadAudios[0];
  const loadReferenceAudioNode = loadAudios.find((node) => node.data?.studioRole === 'loadReferenceAudio');
  const sizeNode = generateNode ?? denoiseNode;
  const squareResolution = numberValue(paramValue(sizeNode, ['resolution']), defaults.width);
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
    width: numberValue(paramValue(sizeNode, ['width']), squareResolution),
    height: numberValue(paramValue(sizeNode, ['height']), squareResolution),
    seed: numberValue(seedObject?.value ?? seed, fallback.seed),
    randomSeed: boolValue(seedObject?.isRandom, fallback.randomSeed),
    steps: numberValue(paramValue(sizeNode, ['num_inference_steps', 'steps']), defaults.steps),
    guidanceScale: numberValue(
      paramValue(sizeNode, ['true_cfg_scale', 'guidance_scale', 'guidance']),
      defaults.guidanceScale,
    ),
    pagScale: numberValue(paramValue(sizeNode, ['pag_scale']), defaults.pagScale),
    pagAdaptiveScale: numberValue(paramValue(sizeNode, ['pag_adaptive_scale']), defaults.pagAdaptiveScale),
    processingResolution: numberValue(paramValue(sizeNode, ['processing_resolution']), defaults.processingResolution),
    matchInputResolution: boolValue(paramValue(sizeNode, ['match_input_resolution']), defaults.matchInputResolution),
    batchSize: numberValue(paramValue(sizeNode, ['batch_size']), defaults.batchSize),
    eta: numberValue(paramValue(sizeNode, ['eta']), defaults.eta),
    classLabel: numberValue(paramValue(sizeNode, ['class_label']), defaults.classLabel),
    resourceMode: normalizeStudioResourceMode(undefined),
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
    referenceVideos: mode === 'video_stitch' ? operationVideos : defaults.referenceVideos,
    maskImage: stringValue(paramValue(loadMaskNode, ['file'])),
    controlImage:
      stringValue(paramValue(loadControlImageNode, ['file'])) ||
      (mode === 'control_image' ? stringValue(paramValue(loadImageNode, ['file'])) : ''),
    sourceVideo:
      (mode === 'video_frame_extract' ? operationVideos[0] : '') || stringValue(paramValue(sourceVideoNode, ['file'])),
    maskVideo: stringValue(paramValue(maskVideoNode, ['file'])),
    controlVideo: stringValue(paramValue(controlVideoNode, ['file'])),
    sourceAudio: stringValue(paramValue(loadAudioNode, ['file'])),
    referenceAudio: stringValue(paramValue(loadReferenceAudioNode, ['file'])),
    speechLanguage: stringValue(paramValue(generateNode, ['language'])) || defaults.speechLanguage,
    speechTimestamps:
      (stringValue(paramValue(generateNode, ['timestamps'])) as StudioFormState['speechTimestamps']) ||
      defaults.speechTimestamps,
    speechChunkSeconds: numberValue(paramValue(generateNode, ['chunk_length_seconds']), defaults.speechChunkSeconds),
    speechStrideSeconds: numberValue(paramValue(generateNode, ['stride_length_seconds']), defaults.speechStrideSeconds),
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
  const portableGraph = rebaseGraphDevices(cloneJson(graph), fallback.device);
  const nodes = cloneJson((Array.isArray(portableGraph.nodes) ? portableGraph.nodes : []) as CustomNodeType[]);
  const edges = cloneJson(Array.isArray(portableGraph.edges) ? portableGraph.edges : []).map((edge) => ({
    ...edge,
    type: edge.type ?? edgeType,
  }));
  const form = inferStudioFormFromWorkflow(nodes, fallback);
  const adopted = adoptManagedWorkflowGraph(nodes, edges, form);
  return {
    nodes: adopted?.nodes ?? nodes,
    edges,
    viewport: cloneJson(portableGraph.viewport ?? { x: 0, y: 0, zoom: 1 }),
    studioForm: form,
    studioGraphBinding: adopted?.binding ?? null,
    selectedMode: form.mode,
    activeTemplateId: null,
    sourceOutputId: null,
  };
}
