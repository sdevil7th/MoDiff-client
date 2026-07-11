import { nanoid } from 'nanoid';
import type { Edge } from '@xyflow/react';
import { enqueueSnackbar } from '../ui/snackbar';
import type { FieldProps } from '../components/NodeContent';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { type NodeData, type NodeParams, useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import fieldAction from '../utils/fieldAction';
import {
  QWEN_CONTROLNET_REPO,
  QWEN_INPAINT_GENERATE_NODE_KEY,
  QWEN_INPAINT_PIPELINE_NODE_KEY,
  QWEN_LOW_VRAM_QUANTIZATION_COMPONENT,
  QWEN_LOW_VRAM_QUANTIZATION_MODE,
  QWEN_OUTPAINT_CANVAS_NODE_KEY,
  QWEN_QUANTIZATION_NODE_KEY,
  QWEN_T2I_GENERATE_NODE_KEY,
  QWEN_T2I_PIPELINE_NODE_KEY,
  AUDIO_STUDIO_MODES,
  FLUX_STUDIO_MODEL_TYPES,
  STUDIO_MODEL_PROFILES,
  VIDEO_STUDIO_MODES,
  WAN_VACE_REVISION,
} from './modelProfiles';
import { selectedAutoCandidate } from './autoResource';
import { resolveStudioResourceForm } from './resourcePlanner';
import type { StudioFormState, StudioGraphBinding, StudioGraphRole, StudioMode, StudioModelType } from './types';

function resolveGraphResourceForm(form: StudioFormState): StudioFormState {
  const plannedForm = resolveStudioResourceForm(form);
  if (form.resourceMode !== 'auto') return plannedForm;

  const candidate = selectedAutoCandidate(useStudioStore.getState().autoResourcePlan);
  if (!candidate) return plannedForm;

  const dtype =
    candidate.dtype === 'float16' || candidate.dtype === 'float32' || candidate.dtype === 'bfloat16'
      ? candidate.dtype
      : plannedForm.dtype;
  const quantizationMode =
    candidate.quantizationMode === 'none' ||
    candidate.quantizationMode === 'bnb_4bit' ||
    candidate.quantizationMode === 'bnb_8bit' ||
    candidate.quantizationMode === 'quanto_float8' ||
    candidate.quantizationMode === 'torchao_float8'
      ? candidate.quantizationMode
      : plannedForm.quantizationMode;
  const offloadMode =
    candidate.offloadMode === 'none' ||
    candidate.offloadMode === 'model_cpu' ||
    candidate.offloadMode === 'sequential_cpu' ||
    candidate.offloadMode === 'group_cpu' ||
    candidate.offloadMode === 'group_disk'
      ? candidate.offloadMode
      : plannedForm.offloadMode;

  return {
    ...plannedForm,
    dtype,
    quantizationMode,
    offloadMode,
    autoOffload: offloadMode !== 'none',
  };
}

const NODE_KEYS = {
  models: 'modules.ModularDiffusers.ModelsLoader',
  qwenQuantization: QWEN_QUANTIZATION_NODE_KEY,
  qwenPipeline: QWEN_T2I_PIPELINE_NODE_KEY,
  qwenGenerate: QWEN_T2I_GENERATE_NODE_KEY,
  qwenInpaintPipeline: QWEN_INPAINT_PIPELINE_NODE_KEY,
  qwenOutpaintCanvas: QWEN_OUTPAINT_CANVAS_NODE_KEY,
  qwenInpaint: QWEN_INPAINT_GENERATE_NODE_KEY,
  prompt: 'modules.ModularDiffusers.EncodePrompt',
  denoise: 'modules.ModularDiffusers.Denoise',
  decode: 'modules.ModularDiffusers.DecodeLatents',
  preview: 'modules.Image.Preview',
  loadImage: 'modules.Image.Load',
  loadMask: 'modules.Image.Load',
  applyMask: 'modules.Image.ApplyMask',
  imageEncode: 'modules.ModularDiffusers.ImageEncode',
  controlnetModel: 'modules.ModularDiffusers.AutoModelLoader',
  controlnet: 'modules.ModularDiffusers.Controlnet',
  wanPipeline: 'modules.WanVACE.LoadPipeline',
  loadVideo: 'modules.Video.Load',
  loadControlVideo: 'modules.Video.Load',
  loadMaskVideo: 'modules.Video.Load',
  normalizeVideo: 'modules.VideoConditioning.Normalize',
  alignMaskVideo: 'modules.VideoConditioning.AlignMask',
  videoColor: 'modules.VideoColor.Adjust',
  wanGenerate: 'modules.WanVACE.Generate',
  videoExport: 'modules.Video.Export',
  diffusersImagePipeline: 'modules.DiffusersImage.LoadPipeline',
  diffusersImageGenerate: 'modules.DiffusersImage.Generate',
  diffusersImageEdit: 'modules.DiffusersImage.Edit',
  diffusersImageInpaint: 'modules.DiffusersImage.Inpaint',
  diffusersImageControl: 'modules.DiffusersImage.ControlGenerate',
  loadAdapter: 'modules.DiffusersImage.LoadAdapter',
  loadAudio: 'modules.Audio.Load',
  loadReferenceAudio: 'modules.Audio.Load',
  audioPipeline: 'modules.DiffusersAudio.LoadPipeline',
  audioGenerate: 'modules.DiffusersAudio.Generate',
  audioExport: 'modules.Audio.Export',
} satisfies Record<StudioGraphRole, string>;

const NODE_POSITIONS: Record<StudioGraphRole, { x: number; y: number }> = {
  models: { x: -520, y: -80 },
  qwenQuantization: { x: -880, y: -80 },
  qwenPipeline: { x: -520, y: -80 },
  qwenGenerate: { x: -120, y: -80 },
  qwenInpaintPipeline: { x: -520, y: -80 },
  qwenOutpaintCanvas: { x: -520, y: 300 },
  qwenInpaint: { x: -120, y: -80 },
  prompt: { x: -160, y: -160 },
  denoise: { x: 220, y: -80 },
  decode: { x: 600, y: -80 },
  preview: { x: 980, y: -80 },
  loadImage: { x: -520, y: 300 },
  loadMask: { x: -520, y: 560 },
  applyMask: { x: -160, y: 430 },
  imageEncode: { x: -160, y: 300 },
  controlnetModel: { x: -160, y: 520 },
  controlnet: { x: 220, y: 300 },
  wanPipeline: { x: -520, y: -80 },
  loadVideo: { x: -520, y: 260 },
  loadControlVideo: { x: -520, y: 260 },
  loadMaskVideo: { x: -520, y: 520 },
  normalizeVideo: { x: -160, y: 260 },
  alignMaskVideo: { x: -160, y: 520 },
  videoColor: { x: 220, y: 520 },
  wanGenerate: { x: 220, y: -80 },
  videoExport: { x: 640, y: -80 },
  diffusersImagePipeline: { x: -520, y: -80 },
  diffusersImageGenerate: { x: -120, y: -80 },
  diffusersImageEdit: { x: -120, y: -80 },
  diffusersImageInpaint: { x: -120, y: -80 },
  diffusersImageControl: { x: -120, y: -80 },
  loadAdapter: { x: -520, y: 560 },
  loadAudio: { x: -520, y: 300 },
  loadReferenceAudio: { x: -520, y: 560 },
  audioPipeline: { x: -520, y: -80 },
  audioGenerate: { x: -120, y: -80 },
  audioExport: { x: 300, y: -80 },
};

const REQUIRED_BASE_ROLES: StudioGraphRole[] = ['models', 'prompt', 'denoise', 'decode', 'preview'];
const VIDEO_BASE_ROLES: StudioGraphRole[] = ['wanPipeline', 'wanGenerate', 'videoExport'];

const IMAGE_MODES: StudioMode[] = [
  'edit_image',
  'multi_image_reference_edit',
  'inpaint',
  'outpaint',
  'layer_decomposition',
];

type BridgeResult = {
  binding: StudioGraphBinding;
  warnings: string[];
};

export type StudioGraphBindingDivergence = {
  kind: 'missing_managed_node' | 'missing_managed_edge' | 'extra_graph_node' | 'extra_managed_edge';
  message: string;
  details?: string;
} | null;

type FieldGroupWait = {
  label: string;
  nodeId: string | undefined;
  groups: string[][];
  timeout?: number;
};

let graphUpdatePromise: Promise<BridgeResult> | null = null;
let graphUpdateQueuedForm: StudioFormState | null = null;
let graphFinalizationPromise: Promise<BridgeResult> | null = null;
let graphFinalizationToken = 0;

function cloneStudioFormForGraph(form: StudioFormState): StudioFormState {
  return {
    ...form,
    referenceImages: [...form.referenceImages],
  };
}

function cloneNodeData(data: NodeData): NodeData {
  return JSON.parse(JSON.stringify(data)) as NodeData;
}

function requiresImageNodes(mode: StudioMode) {
  return IMAGE_MODES.includes(mode);
}

function isVideoMode(mode: StudioMode) {
  return VIDEO_STUDIO_MODES.includes(mode);
}

function isAudioMode(mode: StudioMode) {
  return AUDIO_STUDIO_MODES.includes(mode);
}

function isFluxModel(modelType: StudioModelType) {
  return FLUX_STUDIO_MODEL_TYPES.includes(modelType);
}

function hasRegistryNode(key: string) {
  return Boolean(useNodesStore.getState().nodesRegistry[key]);
}

function hasDiffusersImageFacadeForMode(mode: StudioMode) {
  const baseReady = hasRegistryNode(NODE_KEYS.diffusersImagePipeline) && hasRegistryNode(NODE_KEYS.preview);
  if (!baseReady) return false;
  if (mode === 'edit_image' || mode === 'multi_image_reference_edit') {
    return hasRegistryNode(NODE_KEYS.diffusersImageEdit) && hasRegistryNode(NODE_KEYS.loadImage);
  }
  if (mode === 'inpaint' || mode === 'outpaint') {
    return (
      hasRegistryNode(NODE_KEYS.diffusersImageInpaint) &&
      hasRegistryNode(NODE_KEYS.loadImage) &&
      hasRegistryNode(NODE_KEYS.loadMask)
    );
  }
  if (mode === 'control_image') {
    return hasRegistryNode(NODE_KEYS.diffusersImageControl) && hasRegistryNode(NODE_KEYS.loadImage);
  }
  return hasRegistryNode(NODE_KEYS.diffusersImageGenerate);
}

function usesDiffusersImageFacade(form: StudioFormState | Pick<StudioGraphBinding, 'mode' | 'modelType' | 'nodes'>) {
  if ('nodes' in form && form.nodes.diffusersImagePipeline) return true;
  if (isFluxModel(form.modelType)) return true;
  if (
    !('nodes' in form) &&
    form.resourceMode !== 'expert' &&
    form.modelType === 'ZImageModularPipeline' &&
    form.mode === 'text_to_image'
  ) {
    return hasDiffusersImageFacadeForMode(form.mode);
  }
  return false;
}

function usesQwenLowVramQuantization(form: StudioFormState) {
  return (
    STUDIO_MODEL_PROFILES[form.modelType]?.family === 'Qwen Image' &&
    form.quantizationMode === QWEN_LOW_VRAM_QUANTIZATION_MODE
  );
}

function usesQwenDirectTextToImage(
  form: StudioFormState | StudioGraphBinding | Pick<StudioGraphBinding, 'mode' | 'modelType'>,
) {
  const resourceMode = 'resourceMode' in form ? form.resourceMode : undefined;
  const hasDirectNodes = 'nodes' in form ? Boolean(form.nodes.qwenPipeline || form.nodes.qwenGenerate) : false;
  const isExistingBinding = 'nodes' in form;
  return (
    form.mode === 'text_to_image' &&
    form.modelType === 'QwenImageModularPipeline' &&
    resourceMode !== 'expert' &&
    (!isExistingBinding || hasDirectNodes)
  );
}

function usesQwenDirectInpaint(form: StudioFormState | Pick<StudioGraphBinding, 'mode' | 'modelType'>) {
  return form.mode === 'inpaint' && form.modelType === 'QwenImageEditModularPipeline';
}

function usesQwenDirectOutpaint(form: StudioFormState | Pick<StudioGraphBinding, 'mode' | 'modelType'>) {
  return form.mode === 'outpaint' && form.modelType === 'QwenImageEditModularPipeline';
}

function usesQwenDirectInpaintPipeline(form: StudioFormState | Pick<StudioGraphBinding, 'mode' | 'modelType'>) {
  return usesQwenDirectInpaint(form) || usesQwenDirectOutpaint(form);
}

function requiredRolesForForm(form: StudioFormState): StudioGraphRole[] {
  if (isAudioMode(form.mode)) {
    const roles: StudioGraphRole[] = ['audioPipeline', 'audioGenerate', 'audioExport'];
    if (form.mode !== 'text_to_audio') {
      roles.unshift('loadAudio');
    }
    if (form.mode === 'audio_variation' && form.referenceAudio) {
      roles.unshift('loadReferenceAudio');
    }
    return roles;
  }

  if (isVideoMode(form.mode)) {
    const roles = [...VIDEO_BASE_ROLES];
    if (['video_to_video', 'video_inpaint', 'video_outpaint', 'video_color_edit'].includes(form.mode)) {
      roles.push('loadVideo', 'normalizeVideo');
    }
    if (form.mode === 'control_to_video') {
      roles.push('loadControlVideo', 'normalizeVideo');
    }
    if (form.mode === 'video_inpaint' || form.mode === 'video_outpaint') {
      roles.push('loadMaskVideo', 'alignMaskVideo');
    }
    if (form.mode === 'image_to_video' || form.mode === 'reference_to_video') {
      roles.push('loadImage');
    }
    return roles;
  }

  if (usesQwenDirectTextToImage(form)) {
    return ['qwenPipeline', 'qwenGenerate', 'preview'];
  }

  if (usesQwenDirectInpaint(form)) {
    const roles: StudioGraphRole[] = ['qwenInpaintPipeline', 'loadImage', 'loadMask', 'qwenInpaint', 'preview'];
    if (usesQwenLowVramQuantization(form)) {
      roles.unshift('qwenQuantization');
    }
    return roles;
  }

  if (usesQwenDirectOutpaint(form)) {
    const roles: StudioGraphRole[] = [
      'qwenInpaintPipeline',
      'loadImage',
      'qwenOutpaintCanvas',
      'qwenInpaint',
      'preview',
    ];
    if (usesQwenLowVramQuantization(form)) {
      roles.unshift('qwenQuantization');
    }
    return roles;
  }

  if (usesDiffusersImageFacade(form)) {
    if (form.mode === 'edit_image' || form.mode === 'multi_image_reference_edit') {
      return ['diffusersImagePipeline', 'loadImage', 'diffusersImageEdit', 'preview'];
    }
    if (form.mode === 'inpaint' || form.mode === 'outpaint') {
      return ['diffusersImagePipeline', 'loadImage', 'loadMask', 'diffusersImageInpaint', 'preview'];
    }
    if (form.mode === 'control_image') {
      return ['diffusersImagePipeline', 'loadImage', 'diffusersImageControl', 'preview'];
    }
    return ['diffusersImagePipeline', 'diffusersImageGenerate', 'preview'];
  }

  const roles = [...REQUIRED_BASE_ROLES];
  if (usesQwenLowVramQuantization(form)) {
    roles.unshift('qwenQuantization');
  }
  if (form.mode === 'inpaint') {
    roles.push('loadImage', 'loadMask', 'applyMask', 'imageEncode');
  } else if (requiresImageNodes(form.mode)) {
    roles.push('loadImage', 'imageEncode');
  }
  if (form.mode === 'control_image') {
    roles.push('loadImage', 'controlnetModel', 'controlnet');
  }
  return roles;
}

function bindingFingerprint(form: StudioFormState) {
  return `${form.mode}:${form.modelType}:${form.resourceMode}:${form.quantizationMode}`;
}

export function getStudioGraphShapeKey(form: StudioFormState = useStudioStore.getState().form) {
  const plannedForm = resolveGraphResourceForm(form);
  return `${bindingFingerprint(plannedForm)}:${requiredRolesForForm(plannedForm).join('|')}`;
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}

function isIgnorableCustomGraphNode(node: CustomNodeType) {
  return node.type === 'group' || node.data.type === 'group' || node.data.category === 'group';
}

export function inspectStudioGraphBindingDivergence(
  binding: StudioGraphBinding | null = useStudioStore.getState().graphBinding,
): StudioGraphBindingDivergence {
  if (!binding) return null;

  const { nodes, edges } = useFlowStore.getState();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const managedNodeIds = binding.managedNodeIds?.length
    ? binding.managedNodeIds
    : Object.values(binding.nodes).filter(isString);
  const managedNodes = new Set(managedNodeIds);
  const missingManagedNodeIds = managedNodeIds.filter((nodeId) => !nodeById.has(nodeId));

  if (missingManagedNodeIds.length > 0) {
    return {
      kind: 'missing_managed_node',
      message: 'Managed graph changed.',
      details: `${missingManagedNodeIds.length} managed node${missingManagedNodeIds.length === 1 ? '' : 's'} no longer exist.`,
    };
  }

  const extraGraphNodes = nodes.filter(
    (node) => !managedNodes.has(node.id) && !node.data.studioOwned && !isIgnorableCustomGraphNode(node),
  );
  if (extraGraphNodes.length > 0) {
    return {
      kind: 'extra_graph_node',
      message: 'Custom graph detected.',
      details: `${extraGraphNodes.length} non-Studio node${extraGraphNodes.length === 1 ? '' : 's'} found on the canvas.`,
    };
  }

  const managedEdgeIds = new Set(binding.managedEdgeIds ?? []);
  const finalization = useStudioStore.getState().graphFinalization;
  const edgeTrackingReady = managedEdgeIds.size > 0 && finalization?.status !== 'pending';
  if (!edgeTrackingReady) return null;

  const missingManagedEdgeIds = [...managedEdgeIds].filter((edgeId) => !edgeIds.has(edgeId));
  if (missingManagedEdgeIds.length > 0) {
    return {
      kind: 'missing_managed_edge',
      message: 'Managed graph links changed.',
      details: `${missingManagedEdgeIds.length} managed link${missingManagedEdgeIds.length === 1 ? '' : 's'} no longer exist.`,
    };
  }

  const extraManagedEdges = edges.filter(
    (edge) => (managedNodes.has(edge.source) || managedNodes.has(edge.target)) && !managedEdgeIds.has(edge.id),
  );
  if (extraManagedEdges.length > 0) {
    return {
      kind: 'extra_managed_edge',
      message: 'Custom graph links detected.',
      details: `${extraManagedEdges.length} extra link${extraManagedEdges.length === 1 ? '' : 's'} touch managed Studio nodes.`,
    };
  }

  return null;
}

function nodeKeyForRole(role: StudioGraphRole) {
  return NODE_KEYS[role];
}

function nodeMatchesRole(nodeId: string | undefined, role: StudioGraphRole) {
  const node = getNode(nodeId);
  return Boolean(node && `${node.data.module}.${node.data.action}` === nodeKeyForRole(role));
}

function graphNodeKey(node: CustomNodeType) {
  return `${node.data.module}.${node.data.action}`;
}

function assignStudioRole(nodeId: string | undefined, role: StudioGraphRole, studioOwned: boolean) {
  if (!nodeId) return;
  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) =>
      node.id === nodeId ? { ...node, data: { ...node.data, studioRole: role, studioOwned } } : node,
    ),
  }));
}

function findAdoptableNode(role: StudioGraphRole, assignedNodeIds: Set<string>) {
  const expectedKey = nodeKeyForRole(role);
  const nodes = useFlowStore.getState().nodes;
  const roleMatch = nodes.find(
    (node) => !assignedNodeIds.has(node.id) && node.data.studioRole === role && graphNodeKey(node) === expectedKey,
  );
  if (roleMatch) return roleMatch;

  return nodes.find((node) => !assignedNodeIds.has(node.id) && graphNodeKey(node) === expectedKey);
}

function getNode(nodeId: string | undefined) {
  if (!nodeId) return undefined;
  return useFlowStore.getState().nodes.find((node) => node.id === nodeId);
}

function getNodeParam(nodeId: string | undefined, fieldKey: string | undefined) {
  const node = getNode(nodeId);
  if (!node || !fieldKey) return undefined;
  return node.data.params[fieldKey];
}

function findParamKey(nodeId: string | undefined, candidates: string[]) {
  const node = getNode(nodeId);
  if (!node) return undefined;
  return candidates.find((candidate) => node.data.params[candidate]);
}

function fieldTypeForParam(param: NodeParams | undefined) {
  if (!param) return 'text';
  const display = param.isInput ? 'input' : param.display || '';
  const type = Array.isArray(param.type) ? (param.type[0] ?? 'string') : (param.type ?? 'string');
  const dataType = String(type).toLowerCase();

  if (display === 'input' || display === 'output') return display;
  if (dataType.startsWith('bool')) return display === 'checkbox' || display === 'icontoggle' ? display : 'switch';
  if (display.startsWith('ui_')) return display;
  if (dataType === 'text' || display.startsWith('text')) return 'textarea';
  if (display) return display;
  if (param.options && typeof param.options === 'object') return 'select';
  if (dataType.startsWith('int') || dataType === 'float' || dataType === 'number')
    return display === 'slider' ? 'slider' : 'number';
  return 'text';
}

function buildFieldProps(nodeId: string, fieldKey: string): FieldProps | null {
  const node = getNode(nodeId);
  const param = getNodeParam(nodeId, fieldKey);
  if (!node || !param) return null;

  const display = param.isInput ? 'input' : param.display || '';
  const dataType = String(Array.isArray(param.type) ? (param.type[0] ?? 'string') : (param.type ?? 'string'));

  return {
    nodeId,
    fieldKey,
    label: param.label ?? fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1),
    display,
    disabled: param.disabled || false,
    hidden: param.hidden || false,
    style: param.style || {},
    value: param.value ?? param.default,
    default: param.default,
    options: param.options || [],
    optionsSource: param.optionsSource || {},
    dataType,
    fieldType: fieldTypeForParam(param),
    updateStore: (paramKey, value, key) => useFlowStore.getState().setParam(nodeId, paramKey, value, key),
    module: node.data.module,
    action: node.data.action,
    isConnected: display === 'input' || display === 'output' ? param.isConnected || false : undefined,
    onChange: param.onChange,
    min: param.min,
    max: param.max,
    step: param.step,
    fieldOptions: param.fieldOptions || {},
    onSignal: param.onSignal,
    signal: param.signal,
  };
}

function setParamIfPresent(
  nodeId: string | undefined,
  candidates: string[],
  value: unknown,
  key: keyof NodeParams = 'value',
) {
  const fieldKey = findParamKey(nodeId, candidates);
  if (!nodeId || !fieldKey) return false;
  useFlowStore.getState().setParam(nodeId, fieldKey, value, key);
  return true;
}

function setModelRepo(nodeId: string | undefined, repo: string) {
  const fieldKey = findParamKey(nodeId, ['repo_id', 'model_id']);
  const param = getNodeParam(nodeId, fieldKey);
  if (!nodeId || !fieldKey || !param) return;

  if (param.display === 'modelselect' || typeof param.value === 'object') {
    useFlowStore.getState().setParam(nodeId, fieldKey, { source: 'hub', value: repo });
  } else {
    useFlowStore.getState().setParam(nodeId, fieldKey, repo);
  }
}

function seedValue(form: StudioFormState) {
  return { value: form.seed, isRandom: form.randomSeed };
}

function fluxPipelineClassFor(form: StudioFormState, candidatePipelineClass?: string) {
  if (candidatePipelineClass) return candidatePipelineClass;
  if (form.modelType === 'FluxKontextPipeline') return 'FluxKontextPipeline';
  if (form.modelType === 'FluxFillPipeline') return 'FluxFillPipeline';
  if (form.modelType === 'FluxDepthPipeline' || form.modelType === 'FluxCannyPipeline') return 'FluxControlPipeline';
  if (form.mode === 'edit_image' || form.mode === 'multi_image_reference_edit') return 'FluxImg2ImgPipeline';
  if (form.mode === 'inpaint' || form.mode === 'outpaint') return 'FluxInpaintPipeline';
  return 'FluxPipeline';
}

function audioTaskForMode(mode: StudioMode) {
  if (mode === 'audio_variation') return 'cover';
  if (mode === 'audio_continuation') return 'continuation';
  if (mode === 'audio_repaint') return 'repaint';
  return 'text2music';
}

function ensureConnection(
  source: string | undefined,
  sourceHandles: string[],
  target: string | undefined,
  targetHandles: string[],
) {
  if (!source || !target) return null;
  const sourceHandle = findParamKey(source, sourceHandles);
  const targetHandle = findParamKey(target, targetHandles);
  if (!sourceHandle || !targetHandle) return null;

  const flow = useFlowStore.getState();
  const exists = flow.edges.find(
    (edge) =>
      edge.source === source &&
      edge.target === target &&
      edge.sourceHandle === sourceHandle &&
      edge.targetHandle === targetHandle,
  );
  if (exists) return exists.id;

  flow.onConnect({
    source,
    sourceHandle,
    target,
    targetHandle,
    edgeType: useSettingsStore.getState().edgeType,
  });
  return (
    useFlowStore
      .getState()
      .edges.find(
        (edge) =>
          edge.source === source &&
          edge.target === target &&
          edge.sourceHandle === sourceHandle &&
          edge.targetHandle === targetHandle,
      )?.id ?? null
  );
}

type StudioEdgeSpec = {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
};

function edgeKey(
  source: string | undefined,
  sourceHandle: string | undefined | null,
  target: string | undefined,
  targetHandle: string | undefined | null,
) {
  return `${source ?? ''}:${sourceHandle ?? ''}->${target ?? ''}:${targetHandle ?? ''}`;
}

function makeConnectionSpec(
  source: string | undefined,
  sourceHandles: string[],
  target: string | undefined,
  targetHandles: string[],
): StudioEdgeSpec | null {
  if (!source || !target) return null;
  const sourceHandle = findParamKey(source, sourceHandles);
  const targetHandle = findParamKey(target, targetHandles);
  if (!sourceHandle || !targetHandle) return null;
  return { source, sourceHandle, target, targetHandle };
}

function desiredBaseEdgeSpecs(binding: StudioGraphBinding) {
  const {
    models,
    qwenQuantization,
    prompt,
    denoise,
    decode,
    preview,
    loadImage,
    loadMask,
    applyMask,
    imageEncode,
    controlnetModel,
    controlnet,
  } = binding.nodes;
  const specs = [
    makeConnectionSpec(qwenQuantization, ['quantization_config'], models, ['quant_config']),
    makeConnectionSpec(models, ['text_encoders'], prompt, ['text_encoders']),
    makeConnectionSpec(models, ['unet_out'], denoise, ['unet']),
    makeConnectionSpec(models, ['scheduler'], denoise, ['scheduler']),
    makeConnectionSpec(models, ['vae_out'], decode, ['vae']),
    makeConnectionSpec(prompt, ['embeddings'], denoise, ['embeddings']),
    makeConnectionSpec(denoise, ['latents'], decode, ['latents']),
    makeConnectionSpec(decode, ['images', 'image', 'output'], preview, ['image']),
  ];

  if (binding.mode === 'inpaint' && loadImage && loadMask && applyMask && imageEncode) {
    specs.push(
      makeConnectionSpec(models, ['vae_out'], imageEncode, ['vae']),
      makeConnectionSpec(loadImage, ['image'], applyMask, ['image']),
      makeConnectionSpec(loadMask, ['image'], applyMask, ['mask']),
      makeConnectionSpec(applyMask, ['output'], imageEncode, ['image']),
      makeConnectionSpec(applyMask, ['output'], prompt, ['image']),
      makeConnectionSpec(imageEncode, ['image_latents'], denoise, ['image_latents', 'image_latents_with_strength']),
    );
  } else if (loadImage && imageEncode) {
    specs.push(
      makeConnectionSpec(models, ['vae_out'], imageEncode, ['vae']),
      makeConnectionSpec(loadImage, ['image'], imageEncode, ['image']),
      makeConnectionSpec(loadImage, ['image'], prompt, ['image']),
      makeConnectionSpec(imageEncode, ['image_latents'], denoise, ['image_latents', 'image_latents_with_strength']),
    );
  }

  if (loadImage && controlnetModel && controlnet) {
    specs.push(
      makeConnectionSpec(models, ['vae_out'], controlnet, ['vae']),
      makeConnectionSpec(controlnetModel, ['model'], controlnet, ['controlnet']),
      makeConnectionSpec(loadImage, ['image'], controlnet, ['control_image']),
      makeConnectionSpec(controlnet, ['controlnet_bundle'], denoise, ['controlnet_bundle']),
    );
  }

  return specs.filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredVideoEdgeSpecs(binding: StudioGraphBinding) {
  const {
    wanPipeline,
    loadVideo,
    loadControlVideo,
    loadMaskVideo,
    normalizeVideo,
    alignMaskVideo,
    loadImage,
    wanGenerate,
    videoExport,
  } = binding.nodes;
  const specs = [
    makeConnectionSpec(wanPipeline, ['pipeline'], wanGenerate, ['pipeline']),
    makeConnectionSpec(wanGenerate, ['video_out'], videoExport, ['video']),
  ];

  if (binding.mode === 'image_to_video' || binding.mode === 'reference_to_video') {
    specs.push(makeConnectionSpec(loadImage, ['image'], wanGenerate, ['reference_images']));
  }

  if (binding.mode === 'control_to_video') {
    specs.push(
      makeConnectionSpec(loadControlVideo, ['video'], normalizeVideo, ['video']),
      makeConnectionSpec(normalizeVideo, ['output'], wanGenerate, ['video']),
    );
  }

  if (binding.mode === 'video_to_video' || binding.mode === 'video_color_edit') {
    specs.push(
      makeConnectionSpec(loadVideo, ['video'], normalizeVideo, ['video']),
      makeConnectionSpec(normalizeVideo, ['output'], wanGenerate, ['video']),
    );
  }

  if (binding.mode === 'video_inpaint' || binding.mode === 'video_outpaint') {
    specs.push(
      makeConnectionSpec(loadVideo, ['video'], normalizeVideo, ['video']),
      makeConnectionSpec(normalizeVideo, ['output'], wanGenerate, ['video']),
      makeConnectionSpec(normalizeVideo, ['output'], alignMaskVideo, ['video']),
      makeConnectionSpec(loadMaskVideo, ['video'], alignMaskVideo, ['mask']),
      makeConnectionSpec(alignMaskVideo, ['output'], wanGenerate, ['mask']),
    );
  }

  return specs.filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredQwenTextToImageEdgeSpecs(binding: StudioGraphBinding) {
  const { qwenPipeline, qwenGenerate, preview } = binding.nodes;
  return [
    makeConnectionSpec(qwenPipeline, ['pipeline'], qwenGenerate, ['pipeline']),
    makeConnectionSpec(qwenGenerate, ['images', 'image', 'output'], preview, ['image']),
  ].filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredQwenInpaintEdgeSpecs(binding: StudioGraphBinding) {
  const { qwenQuantization, qwenInpaintPipeline, loadImage, loadMask, qwenInpaint, preview } = binding.nodes;
  return [
    makeConnectionSpec(qwenQuantization, ['quantization_config'], qwenInpaintPipeline, ['quant_config']),
    makeConnectionSpec(qwenInpaintPipeline, ['pipeline'], qwenInpaint, ['pipeline']),
    makeConnectionSpec(loadImage, ['image'], qwenInpaint, ['image']),
    makeConnectionSpec(loadMask, ['image'], qwenInpaint, ['mask_image']),
    makeConnectionSpec(qwenInpaint, ['images', 'image', 'output'], preview, ['image']),
  ].filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredQwenOutpaintEdgeSpecs(binding: StudioGraphBinding) {
  const { qwenQuantization, qwenInpaintPipeline, loadImage, qwenOutpaintCanvas, qwenInpaint, preview } = binding.nodes;
  return [
    makeConnectionSpec(qwenQuantization, ['quantization_config'], qwenInpaintPipeline, ['quant_config']),
    makeConnectionSpec(qwenInpaintPipeline, ['pipeline'], qwenInpaint, ['pipeline']),
    makeConnectionSpec(loadImage, ['image'], qwenOutpaintCanvas, ['image']),
    makeConnectionSpec(qwenOutpaintCanvas, ['canvas'], qwenInpaint, ['image']),
    makeConnectionSpec(qwenOutpaintCanvas, ['mask_image'], qwenInpaint, ['mask_image']),
    makeConnectionSpec(qwenInpaint, ['images', 'image', 'output'], preview, ['image']),
  ].filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredDiffusersImageEdgeSpecs(binding: StudioGraphBinding) {
  const {
    diffusersImagePipeline,
    diffusersImageGenerate,
    diffusersImageEdit,
    diffusersImageInpaint,
    diffusersImageControl,
    loadImage,
    loadMask,
    preview,
  } = binding.nodes;
  const targetNode = diffusersImageInpaint ?? diffusersImageControl ?? diffusersImageEdit ?? diffusersImageGenerate;
  return [
    makeConnectionSpec(diffusersImagePipeline, ['pipeline'], targetNode, ['pipeline']),
    makeConnectionSpec(loadImage, ['image'], diffusersImageEdit, ['image']),
    makeConnectionSpec(loadImage, ['image'], diffusersImageInpaint, ['image']),
    makeConnectionSpec(loadMask, ['image'], diffusersImageInpaint, ['mask_image']),
    makeConnectionSpec(loadImage, ['image'], diffusersImageControl, ['control_image', 'image']),
    makeConnectionSpec(targetNode, ['images', 'image', 'output'], preview, ['image']),
  ].filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredAudioEdgeSpecs(binding: StudioGraphBinding) {
  const { audioPipeline, loadAudio, loadReferenceAudio, audioGenerate, audioExport } = binding.nodes;
  return [
    makeConnectionSpec(audioPipeline, ['pipeline'], audioGenerate, ['pipeline']),
    makeConnectionSpec(loadAudio, ['audio'], audioGenerate, ['source_audio', 'audio']),
    makeConnectionSpec(loadReferenceAudio, ['audio'], audioGenerate, ['reference_audio']),
    makeConnectionSpec(audioGenerate, ['audio'], audioExport, ['audio']),
  ].filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredEdgeSpecs(binding: StudioGraphBinding) {
  if (usesQwenDirectTextToImage(binding)) return desiredQwenTextToImageEdgeSpecs(binding);
  if (usesQwenDirectInpaint(binding)) return desiredQwenInpaintEdgeSpecs(binding);
  if (usesQwenDirectOutpaint(binding)) return desiredQwenOutpaintEdgeSpecs(binding);
  if (isAudioMode(binding.mode)) return desiredAudioEdgeSpecs(binding);
  if (usesDiffusersImageFacade(binding)) return desiredDiffusersImageEdgeSpecs(binding);
  return isVideoMode(binding.mode) ? desiredVideoEdgeSpecs(binding) : desiredBaseEdgeSpecs(binding);
}

function hasConnection(
  source: string | undefined,
  sourceHandles: string[],
  target: string | undefined,
  targetHandles: string[],
) {
  if (!source || !target) return false;
  const sourceHandle = findParamKey(source, sourceHandles);
  const targetHandle = findParamKey(target, targetHandles);
  if (!sourceHandle || !targetHandle) return false;

  return useFlowStore
    .getState()
    .edges.some(
      (edge) =>
        edge.source === source &&
        edge.target === target &&
        edge.sourceHandle === sourceHandle &&
        edge.targetHandle === targetHandle,
    );
}

function reconcileManagedEdges(binding: StudioGraphBinding, specs: StudioEdgeSpec[]) {
  const managedNodeIds = binding.managedNodeIds?.length
    ? binding.managedNodeIds
    : Object.values(binding.nodes).filter(Boolean);
  const managedEdgeIds = new Set(binding.managedEdgeIds ?? []);
  const desiredKeys = new Set(
    specs.map((spec) => edgeKey(spec.source, spec.sourceHandle, spec.target, spec.targetHandle)),
  );
  const keptDesiredKeys = new Set<string>();
  const obsoleteEdgeIds: string[] = [];

  useFlowStore.getState().edges.forEach((edge: Edge) => {
    const isManaged =
      managedEdgeIds.has(edge.id) || (managedNodeIds.includes(edge.source) && managedNodeIds.includes(edge.target));
    if (!isManaged) return;

    const key = edgeKey(edge.source, edge.sourceHandle, edge.target, edge.targetHandle);
    if (!desiredKeys.has(key) || keptDesiredKeys.has(key)) {
      obsoleteEdgeIds.push(edge.id);
      return;
    }
    keptDesiredKeys.add(key);
  });

  if (obsoleteEdgeIds.length > 0) {
    useFlowStore.getState().removeEdges(obsoleteEdgeIds);
  }

  const edgeIds: string[] = [];
  specs.forEach((spec) => {
    const existing = useFlowStore
      .getState()
      .edges.find(
        (edge) =>
          edge.source === spec.source &&
          edge.target === spec.target &&
          edge.sourceHandle === spec.sourceHandle &&
          edge.targetHandle === spec.targetHandle,
      );

    if (existing) {
      edgeIds.push(existing.id);
      return;
    }

    useFlowStore.getState().onConnect({
      source: spec.source,
      sourceHandle: spec.sourceHandle,
      target: spec.target,
      targetHandle: spec.targetHandle,
      edgeType: useSettingsStore.getState().edgeType,
    });

    const created = useFlowStore
      .getState()
      .edges.find(
        (edge) =>
          edge.source === spec.source &&
          edge.target === spec.target &&
          edge.sourceHandle === spec.sourceHandle &&
          edge.targetHandle === spec.targetHandle,
      );
    if (created) edgeIds.push(created.id);
  });

  return Array.from(new Set(edgeIds));
}

function collectDesiredEdgeIds(specs: StudioEdgeSpec[]) {
  const edges = useFlowStore.getState().edges;
  return Array.from(
    new Set(
      specs
        .map(
          (spec) =>
            edges.find(
              (edge) =>
                edge.source === spec.source &&
                edge.target === spec.target &&
                edge.sourceHandle === spec.sourceHandle &&
                edge.targetHandle === spec.targetHandle,
            )?.id,
        )
        .filter(isString),
    ),
  );
}

function collectManagedNodeEdgeIds(binding: StudioGraphBinding) {
  const managedNodeIds = binding.managedNodeIds?.length
    ? binding.managedNodeIds
    : Object.values(binding.nodes).filter(isString);
  const managedNodes = new Set(managedNodeIds);
  return useFlowStore
    .getState()
    .edges.filter((edge) => managedNodes.has(edge.source) && managedNodes.has(edge.target))
    .map((edge) => edge.id);
}

function expectedManagedEdgeCount(binding: StudioGraphBinding) {
  return desiredEdgeSpecs(binding).length;
}

async function waitForManagedEdges(binding: StudioGraphBinding, timeout = 1500) {
  const expectedCount = expectedManagedEdgeCount(binding);
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const edgeIds = collectManagedNodeEdgeIds(binding);
    if (edgeIds.length >= expectedCount) return edgeIds;
    await delay(50);
  }
  return collectManagedNodeEdgeIds(binding);
}

function refreshManagedEdgeBinding(binding: StudioGraphBinding) {
  const currentBinding = useStudioStore.getState().graphBinding;
  if (!currentBinding || currentBinding.fingerprint !== binding.fingerprint) return;

  const desiredEdgeIds = collectDesiredEdgeIds(desiredEdgeSpecs(currentBinding));
  const nodeEdgeIds = collectManagedNodeEdgeIds(currentBinding);
  const nextEdgeIds = desiredEdgeIds.length > 0 ? desiredEdgeIds : nodeEdgeIds;
  if (nextEdgeIds.length === 0) return;

  const currentIds = [...(currentBinding.managedEdgeIds ?? [])].sort().join('|');
  const nextIds = [...nextEdgeIds].sort().join('|');
  if (currentIds === nextIds) return;

  useStudioStore.getState().setGraphBinding({
    ...currentBinding,
    managedEdgeIds: nextEdgeIds,
    updatedAt: Date.now(),
  });
}

function scheduleManagedEdgeBindingRefresh(binding: StudioGraphBinding) {
  [0, 50, 150, 400, 900, 1500, 2500].forEach((delayMs) => {
    window.setTimeout(() => refreshManagedEdgeBinding(binding), delayMs);
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFieldGroups(nodeId: string | undefined, groups: string[][], timeout = 4500) {
  if (!nodeId || groups.length === 0) return true;
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const ready = groups.every((group) => Boolean(findParamKey(nodeId, group)));
    if (ready) return true;
    await delay(100);
  }
  return groups.every((group) => Boolean(findParamKey(nodeId, group)));
}

async function waitForFieldGroupsTracked(wait: FieldGroupWait, timedOutGroups: string[]) {
  const ready = await waitForFieldGroups(wait.nodeId, wait.groups, wait.timeout ?? 4500);
  if (!ready) {
    timedOutGroups.push(wait.label);
  }
  return ready;
}

function missingRegistryRoles(roles: StudioGraphRole[], registry = useNodesStore.getState().nodesRegistry) {
  return roles.filter((role) => !registry[NODE_KEYS[role]]);
}

async function ensureRegistryForRoles(roles: StudioGraphRole[]) {
  const nodesStore = useNodesStore.getState();
  let registry = nodesStore.nodesRegistry;
  let missingRoles = missingRegistryRoles(roles, registry);

  if (Object.keys(registry).length === 0 || missingRoles.length > 0) {
    await nodesStore.fetchNodes();
    registry = useNodesStore.getState().nodesRegistry;
    missingRoles = missingRegistryRoles(roles, registry);
  }

  if (Object.keys(registry).length === 0) {
    const message =
      useNodesStore.getState().error ||
      'MoDiff node registry is not loaded. Check the backend server and try syncing the graph again.';
    useStudioStore.getState().setLastError(message);
    throw new Error(message);
  }

  return missingRoles;
}

function ensureNode(
  role: StudioGraphRole,
  bindingNodes: Partial<Record<StudioGraphRole, string>>,
  assignedNodeIds: Set<string>,
) {
  const existingNode = nodeMatchesRole(bindingNodes[role], role) ? getNode(bindingNodes[role]) : undefined;
  if (existingNode && !assignedNodeIds.has(existingNode.id)) {
    assignedNodeIds.add(existingNode.id);
    assignStudioRole(existingNode.id, role, existingNode.data.studioOwned === true);
    return existingNode.id;
  }

  const adoptableNode = findAdoptableNode(role, assignedNodeIds);
  if (adoptableNode) {
    assignedNodeIds.add(adoptableNode.id);
    assignStudioRole(adoptableNode.id, role, Boolean(adoptableNode.data.studioOwned));
    return adoptableNode.id;
  }

  const registryNode = useNodesStore.getState().nodesRegistry[NODE_KEYS[role]];
  if (!registryNode) return undefined;

  const node: CustomNodeType = {
    id: nanoid(),
    type: registryNode.type,
    position: NODE_POSITIONS[role],
    data: {
      ...cloneNodeData(registryNode),
      studioRole: role,
      studioOwned: true,
    },
  };
  useFlowStore.getState().addNode(node);
  assignedNodeIds.add(node.id);
  return node.id;
}

function pruneObsoleteManagedNodes(
  previous: StudioGraphBinding | null,
  nodes: Partial<Record<StudioGraphRole, string>>,
  roles: StudioGraphRole[],
) {
  if (!previous) return;
  const desiredNodeIds = new Set(roles.map((role) => nodes[role]).filter(isString));
  const previousManagedNodeIds = previous.managedNodeIds?.length
    ? previous.managedNodeIds
    : Object.values(previous.nodes).filter(isString);
  const obsoleteNodeIds = previousManagedNodeIds.filter((nodeId) => {
    if (desiredNodeIds.has(nodeId)) return false;
    const node = getNode(nodeId);
    return Boolean(node?.data.studioOwned);
  });

  if (obsoleteNodeIds.length > 0) {
    useFlowStore.getState().removeNodes(obsoleteNodeIds);
  }
}

function pruneDuplicateStudioOwnedNodes(nodes: Partial<Record<StudioGraphRole, string>>, roles: StudioGraphRole[]) {
  const desiredNodeIds = new Set(roles.map((role) => nodes[role]).filter(isString));
  const obsoleteNodeIds = useFlowStore
    .getState()
    .nodes.filter((node) => node.data.studioOwned && !desiredNodeIds.has(node.id))
    .filter((node) => !roles.includes(node.data.studioRole as StudioGraphRole) || node.data.studioRole)
    .map((node) => node.id);

  if (obsoleteNodeIds.length > 0) {
    useFlowStore.getState().removeNodes(obsoleteNodeIds);
  }
}

function buildOrReuseBinding(form: StudioFormState) {
  const previous = useStudioStore.getState().graphBinding;
  const roles = requiredRolesForForm(form);
  const nodes: Partial<Record<StudioGraphRole, string>> = {};
  const assignedNodeIds = new Set<string>();

  roles.forEach((role) => {
    nodes[role] = ensureNode(role, previous?.nodes ?? nodes, assignedNodeIds);
  });
  pruneObsoleteManagedNodes(previous, nodes, roles);
  pruneDuplicateStudioOwnedNodes(nodes, roles);

  return {
    mode: form.mode,
    modelType: form.modelType,
    nodes,
    managedNodeIds: roles.map((role) => nodes[role]).filter(isString),
    managedEdgeIds: [],
    fingerprint: bindingFingerprint(form),
    createdAt: previous?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  } satisfies StudioGraphBinding;
}

function studioFacadeLabelForRole(role: StudioGraphRole) {
  if (
    [
      'models',
      'qwenPipeline',
      'qwenInpaintPipeline',
      'wanPipeline',
      'diffusersImagePipeline',
      'audioPipeline',
    ].includes(role)
  ) {
    return 'Diffusers.LoadPipeline';
  }
  if (['qwenGenerate', 'wanGenerate', 'diffusersImageGenerate'].includes(role)) {
    return 'Diffusers.Generate';
  }
  if (role === 'audioGenerate') return 'Diffusers.GenerateAudio';
  if (role === 'diffusersImageEdit') return 'Diffusers.Edit';
  if (role === 'diffusersImageInpaint' || role === 'qwenInpaint') return 'Diffusers.Inpaint';
  if (role === 'diffusersImageControl') return 'Diffusers.Control';
  if (role === 'loadAdapter') return 'Diffusers.LoadAdapter';
  return null;
}

function applyAuxiliaryNodePresentation(binding: StudioGraphBinding, form: StudioFormState) {
  const auxiliaryNodeIds = [binding.nodes.qwenQuantization].filter(isString);
  const auxiliaryIds = new Set(auxiliaryNodeIds);
  const roleByNodeId = new Map<string, StudioGraphRole>();
  Object.entries(binding.nodes).forEach(([role, nodeId]) => {
    if (nodeId) roleByNodeId.set(nodeId, role as StudioGraphRole);
  });

  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => {
      const role = roleByNodeId.get(node.id);
      const facadeLabel = role ? studioFacadeLabelForRole(role) : null;
      if (!auxiliaryIds.has(node.id) && !facadeLabel) return node;
      const uiState = node.data.uiState ?? {};
      const hasManualCollapsedState = Object.prototype.hasOwnProperty.call(uiState, 'collapsed');
      const collapsed = hasManualCollapsedState ? Boolean(uiState.collapsed) : form.resourceMode !== 'expert';
      return {
        ...node,
        data: {
          ...node.data,
          label: facadeLabel ?? node.data.label,
          studioAuxiliary: auxiliaryIds.has(node.id) ? true : node.data.studioAuxiliary,
          uiState: auxiliaryIds.has(node.id)
            ? {
                ...uiState,
                collapsed,
              }
            : uiState,
        },
      };
    }),
  }));
}

async function applyModelType(binding: StudioGraphBinding, modelType: StudioModelType, force = false) {
  const modelsNode = binding.nodes.models;
  const modelTypeKey = findParamKey(modelsNode, ['model_type']);
  if (!modelsNode || !modelTypeKey) return;

  const previous = useFlowStore.getState().getParam(modelsNode, modelTypeKey, 'value');
  useFlowStore.getState().setParam(modelsNode, modelTypeKey, modelType);

  if (previous === modelType && !force) return;

  const props = buildFieldProps(modelsNode, modelTypeKey);
  if (!props?.onChange) return;

  await fieldAction(props, modelType);
}

async function applyAutoModelLoaderType(nodeId: string | undefined, loaderType: string) {
  const modelTypeKey = findParamKey(nodeId, ['model_type']);
  if (!nodeId || !modelTypeKey) return;

  const previous = useFlowStore.getState().getParam(nodeId, modelTypeKey, 'value');
  useFlowStore.getState().setParam(nodeId, modelTypeKey, loaderType);

  if (previous !== loaderType) {
    const props = buildFieldProps(nodeId, modelTypeKey);
    if (props?.onChange) {
      await fieldAction(props, loaderType);
    }
  }
}

async function applyControlnetModel(binding: StudioGraphBinding, form: StudioFormState) {
  const controlnetModel = binding.nodes.controlnetModel;
  if (!controlnetModel) return;

  await applyAutoModelLoaderType(controlnetModel, 'controlnet');
  setModelRepo(controlnetModel, QWEN_CONTROLNET_REPO);
  setParamIfPresent(controlnetModel, ['dtype'], form.dtype);
  setParamIfPresent(controlnetModel, ['trust_remote_code'], form.trustRemoteCode);
  setParamIfPresent(controlnetModel, ['device'], form.device);
  setParamIfPresent(controlnetModel, ['auto_offload'], form.autoOffload);
  setParamIfPresent(controlnetModel, ['offload_mode'], form.offloadMode);
  setParamIfPresent(controlnetModel, ['subfolder'], '');
  setParamIfPresent(controlnetModel, ['variant'], '');
}

async function applyControlnetPipelineType(binding: StudioGraphBinding, modelType: StudioModelType) {
  const controlnet = binding.nodes.controlnet;
  const bundleKey = findParamKey(controlnet, ['controlnet_bundle']);
  if (!controlnet || !bundleKey) return;

  setParamIfPresent(controlnet, ['model_type'], modelType);
  const props = buildFieldProps(controlnet, bundleKey);
  if (props?.onSignal) {
    await fieldAction(props, modelType, 'onSignal');
  }
}

function applyQwenQuantizationConfig(binding: StudioGraphBinding, form: StudioFormState) {
  const quantizationNode = binding.nodes.qwenQuantization;
  if (!quantizationNode) return;
  const capability = STUDIO_MODEL_PROFILES[form.modelType];

  setModelRepo(quantizationNode, capability.defaultRepo);
  setParamIfPresent(quantizationNode, ['subfolder'], 'transformer');
  setParamIfPresent(quantizationNode, ['component'], QWEN_LOW_VRAM_QUANTIZATION_COMPONENT);
  setParamIfPresent(quantizationNode, ['quant_type'], QWEN_LOW_VRAM_QUANTIZATION_MODE);
  setParamIfPresent(quantizationNode, ['bnb_4bit_quant_type'], 'nf4');
  setParamIfPresent(quantizationNode, ['bnb_4bit_compute_dtype'], 'bfloat16');
  setParamIfPresent(quantizationNode, ['bnb_4bit_use_double_quant'], true);
}

function connectBaseGraph(binding: StudioGraphBinding) {
  return reconcileManagedEdges(binding, desiredEdgeSpecs(binding));
}

async function reinforceImageConnections(binding: StudioGraphBinding) {
  const { loadImage, loadMask, applyMask, imageEncode, prompt, denoise } = binding.nodes;
  if (!loadImage || !imageEncode || !denoise) return true;

  await delay(250);
  if (binding.mode === 'inpaint' && loadMask && applyMask && prompt) {
    await waitForFieldGroups(applyMask, [['image'], ['mask'], ['output']], 3000);
    await waitForFieldGroups(prompt, [['image']], 3000);
    await waitForFieldGroups(imageEncode, [['image'], ['image_latents']], 3000);
    await waitForFieldGroups(denoise, [['image_latents', 'image_latents_with_strength']], 3000);
    connectBaseGraph(binding);

    return (
      hasConnection(loadImage, ['image'], applyMask, ['image']) &&
      hasConnection(loadMask, ['image'], applyMask, ['mask']) &&
      hasConnection(applyMask, ['output'], imageEncode, ['image']) &&
      hasConnection(applyMask, ['output'], prompt, ['image']) &&
      hasConnection(imageEncode, ['image_latents'], denoise, ['image_latents', 'image_latents_with_strength'])
    );
  }

  await waitForFieldGroups(imageEncode, [['image'], ['image_latents']], 3000);
  await waitForFieldGroups(denoise, [['image_latents', 'image_latents_with_strength']], 3000);
  connectBaseGraph(binding);

  return (
    hasConnection(loadImage, ['image'], imageEncode, ['image']) &&
    hasConnection(imageEncode, ['image_latents'], denoise, ['image_latents', 'image_latents_with_strength'])
  );
}

async function reinforceControlConnections(binding: StudioGraphBinding) {
  const { models, loadImage, controlnetModel, controlnet, denoise } = binding.nodes;
  if (!models || !loadImage || !controlnetModel || !controlnet || !denoise) return true;

  await delay(250);
  await waitForFieldGroups(controlnetModel, [['model'], ['model_id']], 3000);
  await waitForFieldGroups(controlnet, [['control_image'], ['controlnet'], ['vae'], ['controlnet_bundle']], 5000);
  await waitForFieldGroups(denoise, [['controlnet_bundle']], 3000);
  connectBaseGraph(binding);

  return (
    hasConnection(models, ['vae_out'], controlnet, ['vae']) &&
    hasConnection(controlnetModel, ['model'], controlnet, ['controlnet']) &&
    hasConnection(loadImage, ['image'], controlnet, ['control_image']) &&
    hasConnection(controlnet, ['controlnet_bundle'], denoise, ['controlnet_bundle'])
  );
}

function applyFormValues(binding: StudioGraphBinding, form: StudioFormState) {
  const capability = STUDIO_MODEL_PROFILES[form.modelType];
  const {
    models,
    qwenQuantization,
    qwenPipeline,
    qwenGenerate,
    prompt,
    denoise,
    loadImage,
    loadMask,
    controlnetModel,
    controlnet,
    qwenInpaintPipeline,
    qwenOutpaintCanvas,
    qwenInpaint,
    wanPipeline,
    loadVideo,
    loadControlVideo,
    loadMaskVideo,
    normalizeVideo,
    alignMaskVideo,
    wanGenerate,
    videoExport,
    diffusersImagePipeline,
    diffusersImageGenerate,
    diffusersImageEdit,
    diffusersImageInpaint,
    diffusersImageControl,
    audioPipeline,
    loadAudio,
    loadReferenceAudio,
    audioGenerate,
    audioExport,
  } = binding.nodes;

  if (isAudioMode(form.mode)) {
    const autoCandidate =
      form.resourceMode === 'auto' ? selectedAutoCandidate(useStudioStore.getState().autoResourcePlan) : null;
    const autoArtifact =
      autoCandidate?.resolvedArtifact ??
      autoCandidate?.artifact ??
      autoCandidate?.installTarget?.repo ??
      autoCandidate?.modelRepo;
    const autoOffloadMode =
      autoCandidate?.offloadMode === 'none' ||
      autoCandidate?.offloadMode === 'model_cpu' ||
      autoCandidate?.offloadMode === 'sequential_cpu' ||
      autoCandidate?.offloadMode === 'group_cpu' ||
      autoCandidate?.offloadMode === 'group_disk'
        ? autoCandidate.offloadMode
        : form.offloadMode;
    const autoGeneration = autoCandidate?.generation ?? {};

    setModelRepo(audioPipeline, autoArtifact ?? capability.defaultRepo);
    setParamIfPresent(audioPipeline, ['pipeline_class'], autoCandidate?.pipelineClass ?? 'AceStepPipeline');
    setParamIfPresent(
      audioPipeline,
      ['dtype'],
      autoCandidate?.dtype === 'float16' || autoCandidate?.dtype === 'float32' || autoCandidate?.dtype === 'bfloat16'
        ? autoCandidate.dtype
        : form.dtype,
    );
    setParamIfPresent(audioPipeline, ['device'], form.device);
    setParamIfPresent(audioPipeline, ['auto_offload'], autoOffloadMode !== 'none');
    setParamIfPresent(audioPipeline, ['offload_mode'], autoOffloadMode);

    if (loadAudio) setParamIfPresent(loadAudio, ['file'], form.sourceAudio);
    if (loadReferenceAudio) setParamIfPresent(loadReferenceAudio, ['file'], form.referenceAudio);

    setParamIfPresent(audioGenerate, ['task_type'], audioTaskForMode(form.mode));
    setParamIfPresent(audioGenerate, ['prompt'], form.prompt);
    setParamIfPresent(audioGenerate, ['lyrics'], form.lyrics);
    setParamIfPresent(audioGenerate, ['audio_duration'], autoGeneration.audioDuration ?? form.audioDuration);
    setParamIfPresent(audioGenerate, ['extension_duration'], form.extensionDuration);
    setParamIfPresent(audioGenerate, ['vocal_language'], form.vocalLanguage);
    setParamIfPresent(audioGenerate, ['seed'], seedValue(form));
    setParamIfPresent(audioGenerate, ['num_inference_steps', 'steps'], autoGeneration.steps ?? form.steps);
    setParamIfPresent(audioGenerate, ['guidance_scale'], autoGeneration.guidanceScale ?? form.guidanceScale);
    setParamIfPresent(audioGenerate, ['shift'], autoGeneration.shift ?? form.shift);
    setParamIfPresent(audioGenerate, ['bpm'], form.bpm > 0 ? form.bpm : 0);
    setParamIfPresent(audioGenerate, ['keyscale'], form.keyscale);
    setParamIfPresent(audioGenerate, ['timesignature'], form.timesignature);
    setParamIfPresent(audioGenerate, ['repainting_start'], form.repaintingStart);
    setParamIfPresent(audioGenerate, ['repainting_end'], form.repaintingEnd);
    setParamIfPresent(audioGenerate, ['audio_cover_strength'], form.audioCoverStrength);
    setParamIfPresent(audioGenerate, ['sample_rate'], capability.recommendedSampleRate ?? 48000);
    setParamIfPresent(audioExport, ['sample_rate'], capability.recommendedSampleRate ?? 48000);
    return;
  }

  if (isVideoMode(form.mode)) {
    setModelRepo(wanPipeline, capability.defaultRepo);
    setParamIfPresent(wanPipeline, ['revision'], WAN_VACE_REVISION);
    setParamIfPresent(wanPipeline, ['dtype'], form.dtype);
    setParamIfPresent(wanPipeline, ['device'], form.device);
    setParamIfPresent(wanPipeline, ['auto_offload'], form.autoOffload);
    setParamIfPresent(wanPipeline, ['offload_mode'], form.offloadMode);

    if (loadVideo) setParamIfPresent(loadVideo, ['file'], form.sourceVideo);
    if (loadControlVideo) setParamIfPresent(loadControlVideo, ['file'], form.controlVideo);
    if (loadMaskVideo) setParamIfPresent(loadMaskVideo, ['file'], form.maskVideo);
    if (loadImage) {
      setParamIfPresent(loadImage, ['file'], form.referenceImages);
      setParamIfPresent(loadImage, ['alpha_channel'], form.alphaMode);
    }

    if (normalizeVideo) {
      setParamIfPresent(normalizeVideo, ['width'], form.width);
      setParamIfPresent(normalizeVideo, ['height'], form.height);
      setParamIfPresent(normalizeVideo, ['num_frames'], form.numFrames);
    }
    if (alignMaskVideo) {
      setParamIfPresent(alignMaskVideo, ['threshold'], 127);
    }

    setParamIfPresent(wanGenerate, ['prompt'], form.prompt);
    setParamIfPresent(wanGenerate, ['negative_prompt'], form.negativePrompt);
    setParamIfPresent(wanGenerate, ['width'], form.width);
    setParamIfPresent(wanGenerate, ['height'], form.height);
    setParamIfPresent(wanGenerate, ['seed'], seedValue(form));
    setParamIfPresent(wanGenerate, ['num_frames'], form.numFrames);
    setParamIfPresent(wanGenerate, ['num_inference_steps'], form.steps);
    setParamIfPresent(wanGenerate, ['guidance_scale'], form.guidanceScale);
    setParamIfPresent(wanGenerate, ['conditioning_scale'], form.conditioningScale);
    setParamIfPresent(wanGenerate, ['guidance_scale_2'], form.guidanceScale2);
    setParamIfPresent(wanGenerate, ['use_guidance_scale_2'], form.guidanceScale2 > 0);
    setParamIfPresent(wanGenerate, ['output_type'], form.outputType);
    setParamIfPresent(wanGenerate, ['max_sequence_length'], form.maxSequenceLength);
    setParamIfPresent(wanGenerate, ['attention_kwargs_json'], form.attentionKwargsJson);
    setParamIfPresent(videoExport, ['fps'], form.fps);
    return;
  }

  if (usesDiffusersImageFacade(binding)) {
    const autoCandidate =
      form.resourceMode === 'auto' ? selectedAutoCandidate(useStudioStore.getState().autoResourcePlan) : null;
    const autoArtifact =
      autoCandidate?.resolvedArtifact ??
      autoCandidate?.artifact ??
      autoCandidate?.installTarget?.repo ??
      autoCandidate?.modelRepo;
    const autoOffloadMode =
      autoCandidate?.offloadMode === 'none' ||
      autoCandidate?.offloadMode === 'model_cpu' ||
      autoCandidate?.offloadMode === 'sequential_cpu' ||
      autoCandidate?.offloadMode === 'group_cpu' ||
      autoCandidate?.offloadMode === 'group_disk'
        ? autoCandidate.offloadMode
        : form.offloadMode;
    const autoQuantizationMode =
      autoCandidate?.quantizationMode === 'none' ||
      autoCandidate?.quantizationMode === 'bnb_4bit' ||
      autoCandidate?.quantizationMode === 'bnb_8bit' ||
      autoCandidate?.quantizationMode === 'quanto_float8' ||
      autoCandidate?.quantizationMode === 'torchao_float8'
        ? autoCandidate.quantizationMode
        : form.quantizationMode;
    const autoGeneration = autoCandidate?.generation ?? {};
    const targetNode = diffusersImageInpaint ?? diffusersImageControl ?? diffusersImageEdit ?? diffusersImageGenerate;
    const pipelineClass = isFluxModel(form.modelType)
      ? fluxPipelineClassFor(form, autoCandidate?.pipelineClass)
      : form.modelType === 'ZImageModularPipeline'
        ? (autoCandidate?.pipelineClass ?? 'ZImagePipeline')
        : autoCandidate?.pipelineClass;

    setModelRepo(diffusersImagePipeline, autoArtifact ?? capability.defaultRepo);
    if (pipelineClass) {
      setParamIfPresent(diffusersImagePipeline, ['pipeline_class'], pipelineClass);
    }
    setParamIfPresent(
      diffusersImagePipeline,
      ['dtype'],
      autoCandidate?.dtype === 'float16' || autoCandidate?.dtype === 'float32' || autoCandidate?.dtype === 'bfloat16'
        ? autoCandidate.dtype
        : form.dtype,
    );
    setParamIfPresent(diffusersImagePipeline, ['device'], form.device);
    setParamIfPresent(diffusersImagePipeline, ['quantization_mode'], autoQuantizationMode);
    setParamIfPresent(
      diffusersImagePipeline,
      ['quantized_components'],
      autoQuantizationMode !== 'none' ? (autoCandidate?.quantizedComponents ?? ['transformer']) : [],
    );
    setParamIfPresent(diffusersImagePipeline, ['auto_offload'], autoOffloadMode !== 'none');
    setParamIfPresent(diffusersImagePipeline, ['offload_mode'], autoOffloadMode);

    const imageValue =
      form.mode === 'control_image' ? form.controlImage || form.referenceImages[0] || '' : form.referenceImages;
    if (loadImage) {
      setParamIfPresent(loadImage, ['file'], imageValue);
      setParamIfPresent(loadImage, ['alpha_channel'], form.alphaMode);
    }
    if (loadMask) {
      setParamIfPresent(loadMask, ['file'], form.maskImage);
      setParamIfPresent(loadMask, ['alpha_channel'], 'remove alpha');
    }

    setParamIfPresent(targetNode, ['prompt'], form.prompt);
    setParamIfPresent(targetNode, ['negative_prompt'], autoGeneration.negativePrompt ?? form.negativePrompt);
    setParamIfPresent(targetNode, ['width'], autoGeneration.width ?? form.width);
    setParamIfPresent(targetNode, ['height'], autoGeneration.height ?? form.height);
    setParamIfPresent(targetNode, ['seed'], seedValue(form));
    setParamIfPresent(targetNode, ['num_inference_steps', 'steps'], autoGeneration.steps ?? form.steps);
    setParamIfPresent(targetNode, ['guidance_scale', 'guidance'], autoGeneration.guidanceScale ?? form.guidanceScale);
    setParamIfPresent(targetNode, ['strength'], form.strength);
    setParamIfPresent(targetNode, ['output_type'], form.outputType);
    setParamIfPresent(targetNode, ['max_sequence_length'], autoGeneration.maxSequenceLength ?? form.maxSequenceLength);
    return;
  }

  if (usesQwenDirectTextToImage(form)) {
    const autoCandidate =
      form.resourceMode === 'auto' ? selectedAutoCandidate(useStudioStore.getState().autoResourcePlan) : null;
    const autoArtifact = autoCandidate?.resolvedArtifact ?? autoCandidate?.artifact ?? autoCandidate?.modelRepo;
    const autoOffloadMode =
      autoCandidate?.offloadMode === 'none' ||
      autoCandidate?.offloadMode === 'model_cpu' ||
      autoCandidate?.offloadMode === 'sequential_cpu' ||
      autoCandidate?.offloadMode === 'group_cpu' ||
      autoCandidate?.offloadMode === 'group_disk'
        ? autoCandidate.offloadMode
        : form.offloadMode;
    const autoQuantizationMode =
      autoCandidate?.quantizationMode === 'bnb_4bit' || autoCandidate?.quantizationMode === 'none'
        ? autoCandidate.quantizationMode
        : form.quantizationMode;
    const autoGeneration = autoCandidate?.generation ?? {};

    setModelRepo(qwenPipeline, autoArtifact ?? capability.defaultRepo);
    setParamIfPresent(
      qwenPipeline,
      ['dtype'],
      autoCandidate?.dtype === 'float16' || autoCandidate?.dtype === 'float32' || autoCandidate?.dtype === 'bfloat16'
        ? autoCandidate.dtype
        : form.dtype,
    );
    setParamIfPresent(qwenPipeline, ['device'], form.device);
    setParamIfPresent(qwenPipeline, ['auto_offload'], autoOffloadMode !== 'none');
    setParamIfPresent(qwenPipeline, ['offload_mode'], autoOffloadMode);
    setParamIfPresent(qwenPipeline, ['quantization_mode'], autoQuantizationMode);
    setParamIfPresent(
      qwenPipeline,
      ['quantized_components'],
      autoQuantizationMode === QWEN_LOW_VRAM_QUANTIZATION_MODE
        ? (autoCandidate?.quantizedComponents ?? ['transformer'])
        : [],
    );
    setParamIfPresent(qwenPipeline, ['bnb_4bit_quant_type'], 'nf4');
    setParamIfPresent(qwenPipeline, ['bnb_4bit_compute_dtype'], 'bfloat16');
    setParamIfPresent(qwenPipeline, ['bnb_4bit_use_double_quant'], true);

    setParamIfPresent(qwenGenerate, ['prompt'], form.prompt);
    setParamIfPresent(qwenGenerate, ['negative_prompt'], autoGeneration.negativePrompt ?? form.negativePrompt);
    setParamIfPresent(qwenGenerate, ['width'], form.width);
    setParamIfPresent(qwenGenerate, ['height'], form.height);
    setParamIfPresent(qwenGenerate, ['seed'], seedValue(form));
    setParamIfPresent(qwenGenerate, ['num_inference_steps', 'steps'], autoGeneration.steps ?? form.steps);
    setParamIfPresent(
      qwenGenerate,
      ['true_cfg_scale', 'guidance_scale', 'guidance'],
      autoGeneration.guidanceScale ?? form.guidanceScale,
    );
    setParamIfPresent(qwenGenerate, ['output_type'], form.outputType);
    setParamIfPresent(
      qwenGenerate,
      ['max_sequence_length'],
      autoGeneration.maxSequenceLength ?? form.maxSequenceLength,
    );
    return;
  }

  if (usesQwenDirectInpaint(form)) {
    setModelRepo(qwenInpaintPipeline, capability.defaultRepo);
    setParamIfPresent(qwenInpaintPipeline, ['dtype'], form.dtype);
    setParamIfPresent(qwenInpaintPipeline, ['device'], form.device);
    setParamIfPresent(qwenInpaintPipeline, ['auto_offload'], form.autoOffload);
    setParamIfPresent(qwenInpaintPipeline, ['offload_mode'], form.offloadMode);
    if (qwenQuantization) {
      applyQwenQuantizationConfig(binding, form);
    }

    setParamIfPresent(loadImage, ['file'], form.referenceImages);
    setParamIfPresent(loadImage, ['alpha_channel'], form.alphaMode);
    setParamIfPresent(loadMask, ['file'], form.maskImage);
    setParamIfPresent(loadMask, ['alpha_channel'], 'remove alpha');

    setParamIfPresent(qwenInpaint, ['prompt'], form.prompt);
    setParamIfPresent(qwenInpaint, ['negative_prompt'], form.negativePrompt);
    setParamIfPresent(qwenInpaint, ['width'], form.width);
    setParamIfPresent(qwenInpaint, ['height'], form.height);
    setParamIfPresent(qwenInpaint, ['seed'], seedValue(form));
    setParamIfPresent(qwenInpaint, ['num_inference_steps', 'steps'], form.steps);
    setParamIfPresent(qwenInpaint, ['true_cfg_scale', 'guidance_scale', 'guidance'], form.guidanceScale);
    setParamIfPresent(qwenInpaint, ['strength'], form.strength);
    setParamIfPresent(qwenInpaint, ['output_type'], form.outputType);
    setParamIfPresent(qwenInpaint, ['max_sequence_length'], form.maxSequenceLength);
    return;
  }

  if (usesQwenDirectOutpaint(form)) {
    setModelRepo(qwenInpaintPipeline, capability.defaultRepo);
    setParamIfPresent(qwenInpaintPipeline, ['dtype'], form.dtype);
    setParamIfPresent(qwenInpaintPipeline, ['device'], form.device);
    setParamIfPresent(qwenInpaintPipeline, ['auto_offload'], form.autoOffload);
    setParamIfPresent(qwenInpaintPipeline, ['offload_mode'], form.offloadMode);
    if (qwenQuantization) {
      applyQwenQuantizationConfig(binding, form);
    }

    setParamIfPresent(loadImage, ['file'], form.referenceImages);
    setParamIfPresent(loadImage, ['alpha_channel'], 'add alpha');

    setParamIfPresent(qwenOutpaintCanvas, ['width'], form.width);
    setParamIfPresent(qwenOutpaintCanvas, ['height'], form.height);
    setParamIfPresent(qwenOutpaintCanvas, ['left'], form.outpaintLeft);
    setParamIfPresent(qwenOutpaintCanvas, ['right'], form.outpaintRight);
    setParamIfPresent(qwenOutpaintCanvas, ['top'], form.outpaintTop);
    setParamIfPresent(qwenOutpaintCanvas, ['bottom'], form.outpaintBottom);
    setParamIfPresent(qwenOutpaintCanvas, ['overlap'], form.outpaintOverlap);
    setParamIfPresent(qwenOutpaintCanvas, ['feather'], form.outpaintFeather);
    setParamIfPresent(qwenOutpaintCanvas, ['fill_color'], form.outpaintFillColor);

    setParamIfPresent(qwenInpaint, ['prompt'], form.prompt);
    setParamIfPresent(qwenInpaint, ['negative_prompt'], form.negativePrompt);
    setParamIfPresent(qwenInpaint, ['width'], form.width);
    setParamIfPresent(qwenInpaint, ['height'], form.height);
    setParamIfPresent(qwenInpaint, ['seed'], seedValue(form));
    setParamIfPresent(qwenInpaint, ['num_inference_steps', 'steps'], form.steps);
    setParamIfPresent(qwenInpaint, ['true_cfg_scale', 'guidance_scale', 'guidance'], form.guidanceScale);
    setParamIfPresent(qwenInpaint, ['strength'], form.strength);
    setParamIfPresent(qwenInpaint, ['output_type'], form.outputType);
    setParamIfPresent(qwenInpaint, ['max_sequence_length'], form.maxSequenceLength);
    return;
  }

  setParamIfPresent(models, ['model_type'], form.modelType);
  setModelRepo(models, capability.defaultRepo);
  setParamIfPresent(models, ['dtype'], form.dtype);
  setParamIfPresent(models, ['device'], form.device);
  setParamIfPresent(models, ['auto_offload'], form.autoOffload);
  setParamIfPresent(models, ['offload_mode'], form.offloadMode);
  setParamIfPresent(models, ['trust_remote_code'], form.trustRemoteCode);
  if (qwenQuantization) {
    applyQwenQuantizationConfig(binding, form);
  }

  setParamIfPresent(prompt, ['prompt'], form.prompt);
  setParamIfPresent(prompt, ['negative_prompt'], form.negativePrompt);

  setParamIfPresent(denoise, ['width'], form.width);
  setParamIfPresent(denoise, ['height'], form.height);
  setParamIfPresent(denoise, ['seed'], seedValue(form));
  setParamIfPresent(denoise, ['num_inference_steps', 'steps'], form.steps);
  setParamIfPresent(denoise, ['guidance_scale', 'guidance'], form.guidanceScale);
  setParamIfPresent(denoise, ['strength'], form.strength);
  setParamIfPresent(denoise, ['layers'], form.layers);

  if (loadImage) {
    const imageValue =
      form.mode === 'control_image' ? form.controlImage || form.referenceImages[0] || '' : form.referenceImages;
    setParamIfPresent(loadImage, ['file'], imageValue);
    // Qwen Image Layered's VAE is RGBA-native. Its public Diffusers contract
    // converts source images to RGBA before encoding; passing the Studio RGB
    // default reaches a 4-channel VAE with only 3 channels.
    setParamIfPresent(loadImage, ['alpha_channel'], form.mode === 'layer_decomposition' ? 'add alpha' : form.alphaMode);
  }

  if (loadMask) {
    setParamIfPresent(loadMask, ['file'], form.maskImage);
    setParamIfPresent(loadMask, ['alpha_channel'], 'remove alpha');
  }

  if (controlnetModel) {
    setModelRepo(controlnetModel, QWEN_CONTROLNET_REPO);
    setParamIfPresent(controlnetModel, ['dtype'], form.dtype);
    setParamIfPresent(controlnetModel, ['trust_remote_code'], form.trustRemoteCode);
    setParamIfPresent(controlnetModel, ['device'], form.device);
    setParamIfPresent(controlnetModel, ['auto_offload'], form.autoOffload);
    setParamIfPresent(controlnetModel, ['offload_mode'], form.offloadMode);
  }

  if (controlnet) {
    setParamIfPresent(controlnet, ['width'], form.width);
    setParamIfPresent(controlnet, ['height'], form.height);
    setParamIfPresent(controlnet, ['controlnet_conditioning_scale'], form.conditioningScale);
  }
}

export function syncStudioGraphValues(form: StudioFormState = useStudioStore.getState().form) {
  const plannedForm = resolveGraphResourceForm(form);
  const binding = useStudioStore.getState().graphBinding;
  if (!binding) return false;
  applyFormValues(binding, plannedForm);
  return true;
}

function missingRolesMessage(form: StudioFormState, missingRoles: StudioGraphRole[]) {
  const missingQwenTextRoles = missingRoles.filter((role) => role === 'qwenPipeline' || role === 'qwenGenerate');
  const missingQwenInpaintRoles = missingRoles.filter(
    (role) => role === 'qwenInpaintPipeline' || role === 'qwenInpaint',
  );
  const missingQwenOutpaintRoles = missingRoles.filter((role) => role === 'qwenOutpaintCanvas');
  return missingQwenTextRoles.length > 0
    ? `Qwen text-to-image Auto needs the MoDiff backend to expose ${QWEN_T2I_PIPELINE_NODE_KEY} and ${QWEN_T2I_GENERATE_NODE_KEY}. Restart or update the backend with direct Qwen Image support.`
    : form.mode === 'outpaint' && (missingQwenInpaintRoles.length > 0 || missingQwenOutpaintRoles.length > 0)
      ? `Qwen outpaint needs the MoDiff backend to expose ${QWEN_INPAINT_PIPELINE_NODE_KEY}, ${QWEN_OUTPAINT_CANVAS_NODE_KEY}, and ${QWEN_INPAINT_GENERATE_NODE_KEY}. Restart or update the backend with direct Qwen Image outpaint support.`
      : missingQwenInpaintRoles.length > 0
        ? `Qwen inpaint needs the MoDiff backend to expose ${QWEN_INPAINT_PIPELINE_NODE_KEY} and ${QWEN_INPAINT_GENERATE_NODE_KEY}. Restart or update the backend with direct Qwen Image inpaint support.`
        : missingQwenOutpaintRoles.length > 0
          ? `Qwen outpaint needs the MoDiff backend to expose ${QWEN_OUTPAINT_CANVAS_NODE_KEY}. Restart or update the backend with direct Qwen Image outpaint canvas support.`
          : missingRoles.includes('qwenQuantization')
            ? `Qwen low-VRAM mode needs the MoDiff backend to expose ${QWEN_QUANTIZATION_NODE_KEY}. Restart or update the backend with Modular Diffusers quantization support.`
            : `Missing MoDiff node registry entries: ${missingRoles.map((role) => NODE_KEYS[role]).join(', ')}`;
}

function createSkeletonGraph(form: StudioFormState, skeletonStartedAt: number): BridgeResult {
  const binding = buildOrReuseBinding(form);
  applyAuxiliaryNodePresentation(binding, form);
  applyFormValues(binding, form);
  const managedEdgeIds = connectBaseGraph(binding);
  const updatedBinding = {
    ...binding,
    managedEdgeIds,
    updatedAt: Date.now(),
  };
  useStudioStore.getState().setGraphBinding(updatedBinding);
  scheduleManagedEdgeBindingRefresh(updatedBinding);
  useStudioStore.getState().setLastError(null);
  useStudioStore.getState().setGraphFinalization({
    status: 'pending',
    bindingFingerprint: updatedBinding.fingerprint,
    startedAt: Date.now(),
    skeletonMs: Date.now() - skeletonStartedAt,
    timedOutGroups: [],
    managedEdgeCount: managedEdgeIds.length,
    message: 'Finalizing graph...',
  });
  scheduleStudioGraphFinalization(updatedBinding, form, Date.now() - skeletonStartedAt);
  return { binding: updatedBinding, warnings: [] };
}

async function finalizeDirectQwenGraph(binding: StudioGraphBinding, form: StudioFormState, timedOutGroups: string[]) {
  await Promise.all([
    binding.nodes.qwenQuantization
      ? waitForFieldGroupsTracked(
          {
            label: 'qwen quantization config',
            nodeId: binding.nodes.qwenQuantization,
            groups: [['model_id'], ['quantization_config']],
            timeout: 5000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
    waitForFieldGroupsTracked(
      {
        label: 'qwen direct pipeline',
        nodeId: binding.nodes.qwenInpaintPipeline,
        groups: [['pipeline'], ['model_id']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    waitForFieldGroupsTracked(
      {
        label: 'qwen direct generate',
        nodeId: binding.nodes.qwenInpaint,
        groups: [['pipeline'], ['image'], ['mask_image'], ['images']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    waitForFieldGroupsTracked(
      {
        label: 'source image loader',
        nodeId: binding.nodes.loadImage,
        groups: [['image'], ['file']],
        timeout: 3000,
      },
      timedOutGroups,
    ),
    binding.nodes.loadMask
      ? waitForFieldGroupsTracked(
          {
            label: 'mask image loader',
            nodeId: binding.nodes.loadMask,
            groups: [['image'], ['file']],
            timeout: 3000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
    binding.nodes.qwenOutpaintCanvas
      ? waitForFieldGroupsTracked(
          {
            label: 'qwen outpaint canvas',
            nodeId: binding.nodes.qwenOutpaintCanvas,
            groups: [['image'], ['canvas'], ['mask_image']],
            timeout: 3000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
  ]);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeDirectQwenTextToImageGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  timedOutGroups: string[],
) {
  await Promise.all([
    waitForFieldGroupsTracked(
      {
        label: 'qwen image pipeline',
        nodeId: binding.nodes.qwenPipeline,
        groups: [['pipeline'], ['model_id']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    waitForFieldGroupsTracked(
      {
        label: 'qwen image generate',
        nodeId: binding.nodes.qwenGenerate,
        groups: [['pipeline'], ['prompt'], ['images']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
  ]);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeDiffusersImageGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  timedOutGroups: string[],
) {
  const targetNode =
    binding.nodes.diffusersImageInpaint ??
    binding.nodes.diffusersImageControl ??
    binding.nodes.diffusersImageEdit ??
    binding.nodes.diffusersImageGenerate;
  await Promise.all([
    waitForFieldGroupsTracked(
      {
        label: 'diffusers image pipeline',
        nodeId: binding.nodes.diffusersImagePipeline,
        groups: [['pipeline'], ['model_id']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    waitForFieldGroupsTracked(
      {
        label: 'diffusers image generate',
        nodeId: targetNode,
        groups: [['pipeline'], ['prompt'], ['images']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    binding.nodes.loadImage
      ? waitForFieldGroupsTracked(
          {
            label: 'source image loader',
            nodeId: binding.nodes.loadImage,
            groups: [['image'], ['file']],
            timeout: 3000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
    binding.nodes.loadMask
      ? waitForFieldGroupsTracked(
          {
            label: 'mask image loader',
            nodeId: binding.nodes.loadMask,
            groups: [['image'], ['file']],
            timeout: 3000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
  ]);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeAudioGraph(binding: StudioGraphBinding, form: StudioFormState, timedOutGroups: string[]) {
  await Promise.all([
    waitForFieldGroupsTracked(
      {
        label: 'diffusers audio pipeline',
        nodeId: binding.nodes.audioPipeline,
        groups: [['pipeline'], ['model_id']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    waitForFieldGroupsTracked(
      {
        label: 'diffusers audio generate',
        nodeId: binding.nodes.audioGenerate,
        groups: [['pipeline'], ['audio']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    waitForFieldGroupsTracked(
      {
        label: 'audio export',
        nodeId: binding.nodes.audioExport,
        groups: [['audio'], ['file']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    binding.nodes.loadAudio
      ? waitForFieldGroupsTracked(
          {
            label: 'source audio loader',
            nodeId: binding.nodes.loadAudio,
            groups: [['audio'], ['file']],
            timeout: 3000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
  ]);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeModularGraph(binding: StudioGraphBinding, form: StudioFormState, timedOutGroups: string[]) {
  await applyModelType(binding, form.modelType, true);
  await applyControlnetModel(binding, form);
  await applyControlnetPipelineType(binding, form.modelType);

  ensureConnection(binding.nodes.models, ['text_encoders'], binding.nodes.prompt, ['text_encoders']);
  ensureConnection(binding.nodes.models, ['unet_out'], binding.nodes.denoise, ['unet']);
  ensureConnection(binding.nodes.models, ['vae_out'], binding.nodes.decode, ['vae']);
  ensureConnection(binding.nodes.qwenQuantization, ['quantization_config'], binding.nodes.models, ['quant_config']);

  const denoiseGroups = binding.nodes.controlnet
    ? [['embeddings'], ['latents'], ['controlnet_bundle']]
    : [['embeddings'], ['latents']];

  await Promise.all([
    binding.nodes.qwenQuantization
      ? waitForFieldGroupsTracked(
          {
            label: 'qwen quantization config',
            nodeId: binding.nodes.qwenQuantization,
            groups: [['model_id'], ['quantization_config']],
            timeout: 5000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
    waitForFieldGroupsTracked(
      {
        label: 'prompt embeddings',
        nodeId: binding.nodes.prompt,
        groups: [['prompt'], ['embeddings']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    waitForFieldGroupsTracked(
      {
        label: 'denoise inputs',
        nodeId: binding.nodes.denoise,
        groups: denoiseGroups,
        timeout: 5000,
      },
      timedOutGroups,
    ),
    waitForFieldGroupsTracked(
      {
        label: 'decode inputs',
        nodeId: binding.nodes.decode,
        groups: [['latents'], ['images']],
        timeout: 5000,
      },
      timedOutGroups,
    ),
    binding.nodes.imageEncode
      ? waitForFieldGroupsTracked(
          {
            label: 'image encoder inputs',
            nodeId: binding.nodes.imageEncode,
            groups: [['image'], ['image_latents']],
            timeout: 5000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
    binding.nodes.controlnet
      ? waitForFieldGroupsTracked(
          {
            label: 'controlnet inputs',
            nodeId: binding.nodes.controlnet,
            groups: [['control_image'], ['controlnet'], ['vae'], ['controlnet_bundle']],
            timeout: 5000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
  ]);

  connectBaseGraph(binding);
  if (binding.nodes.imageEncode) {
    const imageConnectionsReady = await reinforceImageConnections(binding);
    if (!imageConnectionsReady) {
      timedOutGroups.push('image input connections');
    }
  }
  if (binding.nodes.controlnet) {
    const controlConnectionsReady = await reinforceControlConnections(binding);
    if (!controlConnectionsReady) {
      timedOutGroups.push('control image connections');
    }
  }
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeStudioGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  token: number,
  skeletonMs: number,
): Promise<BridgeResult> {
  const startedAt = Date.now();
  const timedOutGroups: string[] = [];
  const warnings: string[] = [];
  try {
    if (usesQwenDirectTextToImage(form)) {
      await finalizeDirectQwenTextToImageGraph(binding, form, timedOutGroups);
    } else if (usesQwenDirectInpaintPipeline(form)) {
      await finalizeDirectQwenGraph(binding, form, timedOutGroups);
    } else if (isAudioMode(form.mode)) {
      await finalizeAudioGraph(binding, form, timedOutGroups);
    } else if (isFluxModel(form.modelType)) {
      await finalizeDiffusersImageGraph(binding, form, timedOutGroups);
    } else if (!isVideoMode(form.mode)) {
      await finalizeModularGraph(binding, form, timedOutGroups);
    } else {
      applyFormValues(binding, form);
      connectBaseGraph(binding);
    }

    const settledNodeEdgeIds = await waitForManagedEdges(binding, 750);
    const settledManagedEdgeIds = collectDesiredEdgeIds(desiredEdgeSpecs(binding));
    const managedEdgeIds =
      settledManagedEdgeIds.length > 0
        ? settledManagedEdgeIds
        : settledNodeEdgeIds.length > 0
          ? settledNodeEdgeIds
          : collectManagedNodeEdgeIds(binding);
    const updatedBinding = {
      ...binding,
      managedEdgeIds,
      updatedAt: Date.now(),
    };

    if (token === graphFinalizationToken) {
      useStudioStore.getState().setGraphBinding(updatedBinding);
      scheduleManagedEdgeBindingRefresh(updatedBinding);
      useStudioStore.getState().saveActiveWorkflowTab(true);
      const message =
        timedOutGroups.length > 0
          ? `Some graph fields are still finalizing: ${timedOutGroups.join(', ')}. Try syncing the graph if Run stays unavailable.`
          : 'Graph finalized.';
      useStudioStore.getState().setGraphFinalization({
        status: timedOutGroups.length > 0 ? 'warning' : 'complete',
        bindingFingerprint: updatedBinding.fingerprint,
        startedAt,
        skeletonMs,
        finalizedAt: Date.now(),
        finalizationMs: Date.now() - startedAt,
        timedOutGroups,
        managedEdgeCount: managedEdgeIds.length,
        message,
      });
      useStudioStore.getState().setLastError(null);
      if (timedOutGroups.length > 0) {
        warnings.push(message);
        enqueueSnackbar(message, { variant: 'warning', autoHideDuration: 7000 });
      }
    }

    return { binding: updatedBinding, warnings };
  } catch (error) {
    const message = `Could not finalize Studio graph. ${String(error)}`;
    if (token === graphFinalizationToken) {
      useStudioStore.getState().setGraphFinalization({
        status: 'error',
        bindingFingerprint: binding.fingerprint,
        startedAt,
        skeletonMs,
        finalizedAt: Date.now(),
        finalizationMs: Date.now() - startedAt,
        timedOutGroups,
        managedEdgeCount: collectManagedNodeEdgeIds(binding).length,
        message,
      });
      useStudioStore.getState().setLastError(message);
      enqueueSnackbar(message, { variant: 'error', autoHideDuration: 7000 });
    }
    throw error;
  }
}

function scheduleStudioGraphFinalization(binding: StudioGraphBinding, form: StudioFormState, skeletonMs: number) {
  const token = ++graphFinalizationToken;
  graphFinalizationPromise = finalizeStudioGraph(binding, form, token, skeletonMs)
    .catch((error) => {
      console.error('Studio graph finalization failed', error);
      return { binding, warnings: [String(error)] };
    })
    .finally(() => {
      if (token === graphFinalizationToken) {
        graphFinalizationPromise = null;
      }
    });
}

async function createOrUpdateStudioGraphInner(
  formInput: StudioFormState = useStudioStore.getState().form,
): Promise<BridgeResult> {
  const skeletonStartedAt = Date.now();
  const form = resolveGraphResourceForm(formInput);
  const roles = requiredRolesForForm(form);
  const missingRoles = await ensureRegistryForRoles(roles);
  if (missingRoles.length > 0) {
    const message = missingRolesMessage(form, missingRoles);
    useStudioStore.getState().setLastError(message);
    throw new Error(message);
  }

  return createSkeletonGraph(form, skeletonStartedAt);
}

export async function createOrUpdateStudioGraph(
  form: StudioFormState = useStudioStore.getState().form,
): Promise<BridgeResult> {
  const requestedForm = cloneStudioFormForGraph(form);
  if (graphUpdatePromise) {
    graphUpdateQueuedForm = requestedForm;
    return graphUpdatePromise;
  }

  const runGraphUpdate = async (nextForm: StudioFormState) => {
    useFlowStore.getState().beginHistoryTransaction('Update Studio graph');
    try {
      return await createOrUpdateStudioGraphInner(nextForm);
    } finally {
      useFlowStore.getState().commitHistoryTransaction();
    }
  };

  graphUpdatePromise = (async () => {
    let result = await runGraphUpdate(requestedForm);
    while (graphUpdateQueuedForm) {
      const nextForm = graphUpdateQueuedForm;
      graphUpdateQueuedForm = null;
      result = await runGraphUpdate(nextForm);
    }
    return result;
  })().finally(() => {
    graphUpdatePromise = null;
    graphUpdateQueuedForm = null;
  });

  return graphUpdatePromise;
}

export async function waitForStudioGraphFinalization(timeout = 9000) {
  const promise = graphFinalizationPromise;
  if (!promise) return true;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<false>((resolve) => {
    timeoutId = globalThis.setTimeout(() => resolve(false), timeout);
  });
  const result = await Promise.race([promise.then(() => true), timeoutPromise]);
  if (timeoutId !== undefined) {
    globalThis.clearTimeout(timeoutId);
  }
  return result;
}

function qwenEmbeddingReadinessIssue(form: StudioFormState = useStudioStore.getState().form) {
  const plannedForm = resolveGraphResourceForm(form);
  if (
    STUDIO_MODEL_PROFILES[plannedForm.modelType]?.family !== 'Qwen Image' ||
    isVideoMode(plannedForm.mode) ||
    usesQwenDirectTextToImage(plannedForm) ||
    usesQwenDirectInpaintPipeline(plannedForm)
  ) {
    return null;
  }

  const binding = useStudioStore.getState().graphBinding;
  if (!binding) {
    return 'Qwen graph is not created yet. Create the graph before running.';
  }
  const promptNode = binding.nodes.prompt;
  const denoiseNode = binding.nodes.denoise;
  if (!findParamKey(promptNode, ['embeddings']) || !findParamKey(denoiseNode, ['embeddings'])) {
    return 'Prompt embeddings are still finalizing. Wait for the graph to finish finalizing, then run again.';
  }
  const edgeReady = hasConnection(promptNode, ['embeddings'], denoiseNode, ['embeddings']);
  if (!edgeReady) {
    return 'Prompt embeddings are not connected to Denoise yet. Update or recreate the Studio graph.';
  }
  return null;
}

export async function ensureStudioGraphReadyForRun(form: StudioFormState = useStudioStore.getState().form) {
  await createOrUpdateStudioGraph(form);
  await waitForStudioGraphFinalization();
  syncStudioGraphValues(form);
  const issue = qwenEmbeddingReadinessIssue(form);
  if (issue) {
    useStudioStore.getState().setLastError(issue);
    throw new Error(issue);
  }
}

export { NODE_KEYS as STUDIO_NODE_KEYS };
