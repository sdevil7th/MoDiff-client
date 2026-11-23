import type { Edge, Viewport } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { unpackVisualOperationGroups } from '../workflow/visualOperationGroupProjection';
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
    params?: Record<string, { value?: unknown; default?: unknown; isConnected?: boolean }>;
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

  const adoptedNodes = nodes.map((node) =>
    managedNodeSet.has(node.id) ? { ...node, data: { ...node.data, studioOwned: true } } : node,
  );
  return {
    nodes: adoptedNodes,
    binding: bindingForManagedNodes(executableNodes, edges, form, roleNodeIds),
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
  // Explicit operation authoring is already a workflow-owned graph. Its shape
  // may resemble a legacy template, but saving must not adopt its controls,
  // reset its memory policy, or grant Studio authority over later model edits.
  if (nodes.some((node) => node.data.operationAuthoring || node.data.blockInstanceV2)) return null;
  if (nodes.length !== nodesInput.length || nodes.some((node) => typeof node.id !== 'string' || !node.id)) {
    return null;
  }
  if (edgesInput.some((edge) => typeof edge.id !== 'string' || !edge.id)) return null;
  return (
    adoptRoleMarkedWorkflow(nodes, edgesInput, form) ??
    adoptCanonicalModularTextToImageWorkflow(nodes, edgesInput, form)
  );
}

function isModelLoader(node: NodeLike) {
  return (
    [
      'models',
      'wanPipeline',
      'qwenPipeline',
      'qwenInpaintPipeline',
      'diffusersImagePipeline',
      'audioPipeline',
      'speechModel',
    ].includes(String(node.data?.studioRole)) ||
    ['ModelsLoader', 'LoadPipeline', 'LoadInpaintPipeline', 'LoadSpeechRecognitionModel', 'LoadAnyToAnyModel'].includes(
      String(node.data?.action),
    )
  );
}

function declaredModelType(nodes: NodeLike[], fallback: StudioModelType) {
  const explicit = nodes.map((node) => paramValue(node, ['model_type'])).find(isStudioModelType);
  if (explicit) return explicit;
  const pipelineClass = nodes.map((node) => paramValue(node, ['pipeline_class'])).find(isStudioModelType);
  if (pipelineClass) return pipelineClass;
  const repos = nodes.map((node) => stringValue(paramValue(node, ['repo_id', 'model_id', 'repo'])));
  // Several execution profiles may share weights. Retain matching authored
  // context rather than selecting a different profile from catalog order.
  if (repos.includes(STUDIO_MODEL_PROFILES[fallback].defaultRepo)) return fallback;
  return Object.values(STUDIO_MODEL_PROFILES).find((profile) => repos.includes(profile.defaultRepo))?.modelType;
}

/** Repair a same-repository summary only when the ordinary graph carries a
 * uniquely identified direct execution specification and its connected task.
 * The projection is inspected and never saved back into the document. */
export function restoreReviewedDirectImageModelType(
  nodes: CustomNodeType[],
  edges: Edge[],
  form: StudioFormState,
): StudioFormState {
  const registry = useNodesStore.getState();
  if (!registry.studioModelCapabilitiesAuthoritative || registry.studioExecutionSpecInvalid) return form;
  const authoredRepo = STUDIO_MODEL_PROFILES[form.modelType]?.defaultRepo;
  if (!authoredRepo) return form;
  let graph;
  try {
    graph = unpackVisualOperationGroups({ nodes, edges }).graph;
  } catch {
    return form;
  }
  const loaders = graph.nodes.filter(isModelLoader);
  const loader = loaders[0];
  if (
    loaders.length !== 1 ||
    !loader ||
    nodeKey(loader) !== 'modules.DiffusersImage.LoadPipeline' ||
    loader.data.studioOwned !== true ||
    loader.data.studioRole !== 'diffusersImagePipeline' ||
    paramValue(loader, ['model_type']) !== undefined ||
    paramValue(loader, ['mode']) !== form.mode
  )
    return form;
  const selection = paramValue(loader, ['model_id']);
  if (
    typeof selection !== 'object' ||
    !selection ||
    !('source' in selection) ||
    selection.source !== 'hub' ||
    stringValue(selection) !== authoredRepo
  )
    return form;
  const pipeline = paramValue(loader, ['pipeline_class']);
  const specs = registry.studioModelCapabilities.flatMap((profile) => profile.studioExecutionSpecs ?? []);
  const routes = specs.filter(
    (spec) =>
      spec.mode === form.mode &&
      spec.executionPath === 'direct-diffusers-image' &&
      spec.loaderModule === loader.data.module &&
      spec.loaderAction === loader.data.action &&
      spec.pipelineClass === pipeline &&
      spec.defaultRepo === authoredRepo,
  );
  const route = routes[0];
  if (routes.length !== 1 || !route || route.modelType === form.modelType) return form;
  const consumers = graph.edges.filter(
    (edge) => edge.source === loader.id && edge.sourceHandle === 'pipeline' && edge.targetHandle === 'pipeline',
  );
  if (consumers.length !== 1) return form;
  const consumer = graph.nodes.find((node) => node.id === consumers[0]?.target);
  const consumerRole = consumer?.data.studioRole;
  if (
    !consumer ||
    !consumerRole ||
    consumer.data.studioOwned !== true ||
    !route.roles.some(([role, key]) => role === consumerRole && key === nodeKey(consumer)) ||
    !route.edges.some(
      ([sourceRole, sourcePort, targetRole, targetPort]) =>
        sourceRole === loader.data.studioRole &&
        sourcePort === 'pipeline' &&
        targetRole === consumerRole &&
        targetPort === 'pipeline',
    )
  )
    return form;
  const contract = paramValue(consumer, ['image_contract']);
  if (
    !contract ||
    typeof contract !== 'object' ||
    !('pipelineClass' in contract) ||
    contract.pipelineClass !== route.pipelineClass ||
    !('mode' in contract) ||
    contract.mode !== route.mode
  )
    return form;
  return { ...form, modelType: route.modelType };
}

// Preserve the published default and precedence when several processors occur in one graph.
const VIDEO_PROCESSOR = ['BuiltinVideoOperation', 'videoOperation', 'modules.Video.ProcessVideo'] as const;
const VIDEO_UPSCALER = ['SpandrelVideoUpscale', 'videoUpscaler', 'modules.Video.UpscaleVideo'] as const;
const PROCESSORS = [
  ['BuiltinDataOperation', 'dataOperation', 'modules.Text.ProcessText'],
  ['BuiltinAudioOperation', 'audioOperation', 'modules.Audio.ProcessAudio'],
  ['BuiltinImageOperation', 'imageOperation', 'modules.ImageOperations.ProcessImage'],
  VIDEO_PROCESSOR,
  VIDEO_UPSCALER,
  ['SpandrelImageUpscale', 'imageUpscaler', 'modules.Spandrel.Upscaler'],
] as const;

function findProcessor(nodes: NodeLike[], [, role, key]: (typeof PROCESSORS)[number]) {
  return nodes.find((node) => node.data?.studioRole === role || nodeKey(node) === key);
}

function inferModelType(nodes: NodeLike[], fallback: StudioFormState): StudioModelType {
  // A processing stage is not the generation model. Prefer the existing
  // loader declarations before the standalone-operation fallbacks, independent
  // of canvas order. This summary never changes the executable graph.
  const loadedModel = declaredModelType(nodes.filter(isModelLoader), fallback.modelType);
  if (loadedModel) return loadedModel;
  for (const processor of PROCESSORS) {
    if (findProcessor(nodes, processor)) return processor[0];
  }
  return declaredModelType(nodes, fallback.modelType) ?? fallback.modelType;
}

function inferMode(
  nodes: NodeLike[],
  modelType: StudioModelType,
  fallback: StudioFormState,
  speech: NodeLike | undefined,
): StudioMode {
  const roles = new Set(nodes.map((node) => String(node.data?.studioRole ?? '')));
  const keys = new Set(nodes.map(nodeKey));
  const hasRoleOrAction = (role: string, action: string) => roles.has(role) || keys.has(action);
  const processor = PROCESSORS.find(([type]) => type === modelType);
  if (processor) {
    const mode = stringValue(paramValue(findProcessor(nodes, processor), ['operation'])) as StudioMode;
    const modes = STUDIO_MODEL_PROFILES[processor[0]].modes;
    return modes.includes(mode) ? mode : modes[0]!;
  }
  if (
    modelType === 'ShapEPipeline' ||
    hasRoleOrAction('diffusersThreeDGenerate', 'modules.DiffusersThreeD.GenerateRenderedArtifact')
  ) {
    return 'text_to_3d';
  }
  const hasWan = keys.has('modules.DiffusersVideo.LoadPipeline') || keys.has('modules.DiffusersVideo.Generate');
  if (hasWan || modelType === 'WanVACEPipeline') {
    const authoredMode = nodes
      .filter((node) => node.data?.module === 'modules.DiffusersVideo')
      .map((node) => paramValue(node, ['mode']))
      .find(
        (value): value is StudioMode =>
          typeof value === 'string' && isModelCompatibleWithMode(modelType, value as StudioMode),
      );
    if (authoredMode) return authoredMode;
    if (roles.has('loadMaskVideo') || roles.has('alignMaskVideo')) return 'video_inpaint';
    if (roles.has('loadVideo') && roles.has('loadControlVideo')) return 'control_video_to_video';
    if (roles.has('loadControlVideo')) return 'control_to_video';
    if (roles.has('loadVideo')) return 'video_to_video';
    if (roles.has('loadImage')) return 'image_to_video';
    return 'text_to_video';
  }

  if (keys.has('modules.HuggingFaceTransformers.GenerateAnyToAny')) {
    const generateNode = nodes.find((node) => nodeKey(node) === 'modules.HuggingFaceTransformers.GenerateAnyToAny');
    if (stringValue(paramValue(generateNode, ['generation_mode'])) === 'image') return 'text_to_image';
    return keys.has('modules.Image.Load') ? 'image_to_text' : 'text_generation';
  }

  if (
    modelType === 'HuggingFaceImageTextToTextModel' ||
    hasRoleOrAction('transformersImageTextGenerate', 'modules.HuggingFaceTransformers.GenerateImageVideoText')
  ) {
    return 'image_to_text';
  }

  if (
    modelType === 'HuggingFaceTextGenerationModel' ||
    hasRoleOrAction('transformersTextGenerate', 'modules.HuggingFaceTransformers.GenerateText')
  ) {
    return 'text_generation';
  }

  if (
    modelType === 'HuggingFaceSpeechRecognitionModel' ||
    modelType === 'HuggingFaceCTCSpeechRecognitionModel' ||
    speech
  ) {
    if (modelType === 'HuggingFaceCTCSpeechRecognitionModel') return 'speech_to_text';
    return stringValue(paramValue(speech, ['task'])) === 'translate' ? 'speech_translation' : 'speech_to_text';
  }

  if (
    modelType === 'AceStepAudioPipeline' ||
    modelType === 'StableAudioPipeline' ||
    hasRoleOrAction('audioGenerate', 'modules.DiffusersAudio.Generate')
  ) {
    if (roles.has('loadAudio')) {
      const generateNode = nodes.find(
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
    if (hasRoleOrAction('diffusersUnconditionalGenerate', 'modules.DiffusersImage.UnconditionalGenerate'))
      return 'unconditional_image';
    if (hasRoleOrAction('diffusersPredictMap', 'modules.DiffusersImage.PredictMap')) return 'depth_estimation';
    if (hasRoleOrAction('diffusersImageLayerDecompose', 'modules.DiffusersImage.LayerDecompose'))
      return 'layer_decomposition';
    if (hasRoleOrAction('diffusersImageControlInpaint', 'modules.DiffusersImage.ControlInpaint'))
      return 'control_inpaint';
    if (hasRoleOrAction('diffusersImageControlEdit', 'modules.DiffusersImage.ControlEdit')) return 'control_edit_image';
    if (hasRoleOrAction('diffusersImageControl', 'modules.DiffusersImage.ControlGenerate')) return 'control_image';
    if (roles.has('outpaintCanvas') || hasRoleOrAction('qwenOutpaintCanvas', QWEN_OUTPAINT_CANVAS_NODE_KEY))
      return 'outpaint';
    if (hasRoleOrAction('diffusersImageInpaint', 'modules.DiffusersImage.Inpaint')) return 'inpaint';
    if (hasRoleOrAction('diffusersImageEdit', 'modules.DiffusersImage.Edit')) return 'edit_image';
    return 'text_to_image';
  }

  if (hasRoleOrAction('controlnet', 'modules.ModularDiffusers.Controlnet')) return 'control_image';
  if (hasRoleOrAction('qwenOutpaintCanvas', QWEN_OUTPAINT_CANVAS_NODE_KEY)) return 'outpaint';
  if (hasRoleOrAction('qwenInpaint', 'modules.DiffusersImage.Inpaint')) return 'inpaint';
  if (roles.has('applyMask') || hasRoleOrAction('loadMask', 'modules.Image.ApplyMask')) return 'inpaint';
  if (modelType === 'QwenImageLayeredModularPipeline') return 'layer_decomposition';
  if (modelType === 'QwenImageEditPlusModularPipeline') return 'multi_image_reference_edit';
  if (modelType === 'QwenImageEditModularPipeline') return 'edit_image';
  if (isModelCompatibleWithMode(modelType, fallback.mode)) return fallback.mode;
  return getDefaultModeForModel(modelType);
}

function isGenerationStage(node: NodeLike) {
  return (
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
      'TranscribeCTCAudio',
      'GenerateAnyToAny',
    ].includes(String(node.data?.action))
  );
}

export function inferStudioFormFromWorkflow(
  nodesInput: unknown[],
  fallback: StudioFormState = DEFAULT_STUDIO_FORM,
  edges: Edge[] = [],
): StudioFormState {
  const nodes = nodesInput.filter(isNodeLike);
  const transcribers = nodes.filter(
    (n) =>
      n.data?.studioRole === 'transcribeAudio' ||
      (n.data?.module === 'modules.HuggingFaceSpeech' &&
        ['TranscribeAudio', 'TranscribeCTCAudio'].includes(String(n.data.action))),
  );
  const modelWire =
    transcribers.length === 1 &&
    edges.find((e) => e.target === transcribers[0]?.id && e.targetHandle === 'model' && e.sourceHandle === 'model');
  const speechLoader =
    modelWire && nodes.find((n) => n.id === modelWire.source && n.data?.module === 'modules.HuggingFaceSpeech');
  const modelType =
    (speechLoader && declaredModelType([speechLoader], fallback.modelType)) || inferModelType(nodes, fallback);
  const mode = inferMode(nodes, modelType, fallback, transcribers[0]);
  const defaults = getFormDefaultsForMode(mode, modelType);
  const promptNode = nodes.find(
    (node) =>
      isGenerationStage(node) ||
      ['prompt', 'dataOperation'].includes(String(node.data?.studioRole)) ||
      ['EncodePrompt', 'EncodeInputs', 'ProcessText'].includes(String(node.data?.action)),
  );
  const denoiseNode = nodes.find((node) => node.data?.studioRole === 'denoise' || node.data?.action === 'Denoise');
  const modelNode =
    speechLoader ||
    nodes.find(isModelLoader) ||
    nodes.find(
      (node) =>
        ['imageUpscaler', 'videoUpscaler'].includes(String(node.data?.studioRole)) ||
        ['Upscaler', 'UpscaleVideo'].includes(String(node.data?.action)),
    );
  const quantizationNode = nodes.find(
    (node) => node.data?.studioRole === 'qwenQuantization' || node.data?.action === 'QuantizationConfigNode',
  );
  const generateNode = nodes.find((node) => isGenerationStage(node) || node.data?.action === 'Denoise');
  const outpaintNode = nodes.find(
    (node) =>
      node.data?.studioRole === 'outpaintCanvas' ||
      node.data?.studioRole === 'qwenOutpaintCanvas' ||
      nodeKey(node) === QWEN_OUTPAINT_CANVAS_NODE_KEY,
  );
  const loadImages = nodes.filter((node) => node.data?.action === 'Load' && nodeKey(node).startsWith('modules.Image.'));
  const loadVideos = nodes.filter((node) => node.data?.action === 'Load' && nodeKey(node).startsWith('modules.Video.'));
  const loadAudios = nodes.filter((node) => node.data?.action === 'Load' && nodeKey(node).startsWith('modules.Audio.'));
  const sourceVideoNode =
    loadVideos.find((node) => node.data?.studioRole === 'loadVideo') ??
    loadVideos.find((node) => !['loadControlVideo', 'loadMaskVideo'].includes(String(node.data?.studioRole)));
  const maskVideoNode = loadVideos.find((node) => node.data?.studioRole === 'loadMaskVideo');
  const controlVideoNode = loadVideos.find((node) => node.data?.studioRole === 'loadControlVideo');
  const videoOperationNode = findProcessor(nodes, VIDEO_PROCESSOR);
  const videoUpscaleNode = findProcessor(nodes, VIDEO_UPSCALER);
  const operationVideos =
    videoOperationNode &&
    (videoOperationNode.data?.params?.source?.isConnected ||
      edges.some((edge) => edge.target === videoOperationNode.id && edge.targetHandle === 'source'))
      ? []
      : arrayStringValue(paramValue(videoOperationNode, ['videos']));
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
    prompt: stringValue(paramValue(promptNode, ['prompt', 'source'])) || fallback.prompt,
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
    referenceVideos: mode === 'video_stitch' || mode === 'video_tile' ? operationVideos : defaults.referenceVideos,
    maskImage: stringValue(paramValue(loadMaskNode, ['file'])),
    controlImage:
      stringValue(paramValue(loadControlImageNode, ['file'])) ||
      (mode === 'control_image' ? stringValue(paramValue(loadImageNode, ['file'])) : ''),
    sourceVideo:
      (['video_frame_extract', 'frame_interpolation', 'video_trim', 'video_reverse'].includes(mode)
        ? operationVideos[0]
        : '') ||
      (mode === 'video_upscale' ? stringValue(paramValue(videoUpscaleNode, ['video'])) : '') ||
      stringValue(paramValue(sourceVideoNode, ['file'])),
    maskVideo: stringValue(paramValue(maskVideoNode, ['file'])),
    controlVideo: stringValue(paramValue(controlVideoNode, ['file'])),
    sourceAudio: stringValue(paramValue(loadAudioNode, ['file'])),
    referenceAudio: stringValue(paramValue(loadReferenceAudioNode, ['file'])),
    speechLanguage:
      modelType === 'HuggingFaceCTCSpeechRecognitionModel'
        ? defaults.speechLanguage
        : stringValue(paramValue(generateNode, ['language'])) || defaults.speechLanguage,
    speechTimestamps:
      (stringValue(
        paramValue(generateNode, [
          modelType === 'HuggingFaceCTCSpeechRecognitionModel' && generateNode?.data?.action === 'TranscribeAudio'
            ? 'ctc_timestamps'
            : 'timestamps',
        ]),
      ) as StudioFormState['speechTimestamps']) || defaults.speechTimestamps,
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
        nodes.find((node) => node.data?.studioRole === 'videoExport' || nodeKey(node) === 'modules.Video.Export'),
        ['fps'],
      ) ?? paramValue(videoUpscaleNode, ['fps']),
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
  // Import retains each node's authored placement. The current form is only
  // context for summary inference, not permission to move every node's device.
  const portableGraph = cloneJson(graph);
  const nodes = cloneJson((Array.isArray(portableGraph.nodes) ? portableGraph.nodes : []) as CustomNodeType[]);
  const edges = cloneJson(Array.isArray(portableGraph.edges) ? portableGraph.edges : []).map((edge) => ({
    ...edge,
    type: edge.type ?? edgeType,
  }));
  const form = restoreReviewedDirectImageModelType(nodes, edges, inferStudioFormFromWorkflow(nodes, fallback, edges));
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
