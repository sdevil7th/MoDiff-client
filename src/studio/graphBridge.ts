import { nanoid } from 'nanoid';
import type { Edge } from '@xyflow/react';
import { enqueueSnackbar } from '../ui/snackbar';
import {
  settleGraphFinalization,
  waitForSettledGraphFinalization,
  type SettledGraphFinalization,
} from './graphFinalization';
import type { FieldProps } from '../components/NodeContent';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { type NodeData, type NodeParams, useNodesStore } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  assertWorkflowOperationContext,
  autoFieldOverrideKey,
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
  WorkflowOperationCancelledError,
  type WorkflowOperationContext,
  useStudioStore,
} from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
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
  WAN_22_I2V_A14B_REPO,
  WAN_22_TI2V_5B_REPO,
  WAN_T2V_1_3B_REPO,
  WAN_VACE_REVISION,
} from './modelProfiles';
import { selectedAutoCandidate } from './autoResource';
import { syncManagedFormControlAliases } from './managedControlSync';
import { resolveStudioResourceForm } from './resourcePlanner';
import { STUDIO_TEMPLATES } from './templates';
import type {
  StudioFormState,
  StudioGraphBinding,
  StudioGraphFinalizationState,
  StudioGraphRole,
  StudioMode,
  StudioModelType,
} from './types';

function activeAudioTemplateBaseModel() {
  const activeTemplateId = useStudioStore.getState().activeTemplateId;
  if (!activeTemplateId) return undefined;
  const artifact = STUDIO_TEMPLATES.find((template) => template.id === activeTemplateId)?.workflowBlockSettings?.lora
    ?.baseModel;
  return artifact?.source === 'hub' ? artifact.value : undefined;
}

function resolveGraphResourceForm(form: StudioFormState): StudioFormState {
  const plannedForm = resolveStudioResourceForm(form);
  if (form.resourceMode !== 'auto') return plannedForm;

  const candidate = selectedAutoCandidate(useStudioStore.getState().autoResourcePlan, plannedForm);
  if (!candidate) return plannedForm;

  const dtype =
    candidate.dtype === 'float16' || candidate.dtype === 'float32' || candidate.dtype === 'bfloat16'
      ? candidate.dtype
      : plannedForm.dtype;
  // Auto selection points at an already-created artifact. Never reinterpret
  // its artifact format as permission to quantize the base model on load.
  const quantizationMode = 'none';
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
  diffusersQuantization: 'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  diffusersRecipe: 'modules.DiffusersRuntime.DiffusersExecutionRecipe',
  wanPipeline: 'modules.DiffusersVideo.LoadPipeline',
  loadVideo: 'modules.Video.Load',
  loadControlVideo: 'modules.Video.Load',
  loadMaskVideo: 'modules.Video.Load',
  normalizeVideo: 'modules.VideoConditioning.Normalize',
  alignMaskVideo: 'modules.VideoConditioning.AlignMask',
  videoColor: 'modules.VideoColor.Adjust',
  wanGenerate: 'modules.DiffusersVideo.Generate',
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
  audioLoudnessMatch: 'modules.Audio.MatchLoudness',
  audioJoin: 'modules.Audio.Join',
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
  diffusersQuantization: { x: -1280, y: -80 },
  diffusersRecipe: { x: -900, y: -80 },
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
  audioLoudnessMatch: { x: 300, y: -80 },
  audioJoin: { x: 680, y: -80 },
  audioExport: { x: 1060, y: -80 },
};

const REQUIRED_BASE_ROLES: StudioGraphRole[] = ['models', 'prompt', 'denoise', 'decode', 'preview'];
const VIDEO_BASE_ROLES: StudioGraphRole[] = ['diffusersRecipe', 'wanPipeline', 'wanGenerate', 'videoExport'];

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
let graphFinalizationPromise: Promise<SettledGraphFinalization<BridgeResult>> | null = null;
let graphFinalizationContext: WorkflowOperationContext | null = null;
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
    ((form.modelType === 'QwenImageModularPipeline' &&
      form.mode === 'text_to_image' &&
      form.resourceMode !== 'expert') ||
      (form.modelType === 'QwenImageEditModularPipeline' && (form.mode === 'inpaint' || form.mode === 'outpaint')))
  ) {
    return hasDiffusersImageFacadeForMode(form.mode);
  }
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
    form.resourceMode === 'expert' &&
    STUDIO_MODEL_PROFILES[form.modelType]?.family === 'Qwen Image' &&
    form.quantizationMode === QWEN_LOW_VRAM_QUANTIZATION_MODE
  );
}

function usesQwenDirectTextToImage(
  _form: StudioFormState | StudioGraphBinding | Pick<StudioGraphBinding, 'mode' | 'modelType'>,
) {
  void _form;
  return false;
}

function usesQwenDirectInpaint(
  _form:
    StudioFormState | (Pick<StudioGraphBinding, 'mode' | 'modelType'> & Partial<Pick<StudioGraphBinding, 'nodes'>>),
) {
  void _form;
  return false;
}

function usesQwenDirectOutpaint(_form: StudioFormState | Pick<StudioGraphBinding, 'mode' | 'modelType'>) {
  void _form;
  return false;
}

function usesQwenDirectInpaintPipeline(form: StudioFormState | Pick<StudioGraphBinding, 'mode' | 'modelType'>) {
  return usesQwenDirectInpaint(form) || usesQwenDirectOutpaint(form);
}

function requiredRolesForForm(form: StudioFormState): StudioGraphRole[] {
  if (isAudioMode(form.mode)) {
    const roles: StudioGraphRole[] = [
      'diffusersQuantization',
      'diffusersRecipe',
      'audioPipeline',
      'audioGenerate',
      'audioExport',
    ];
    if (form.mode !== 'text_to_audio') {
      roles.unshift('loadAudio');
    }
    if (form.mode === 'audio_continuation') {
      roles.push('audioLoudnessMatch', 'audioJoin');
    }
    if (form.mode === 'audio_variation' && form.referenceAudio) {
      roles.unshift('loadReferenceAudio');
    }
    return roles;
  }

  if (isVideoMode(form.mode)) {
    const roles: StudioGraphRole[] = ['diffusersQuantization', ...VIDEO_BASE_ROLES];
    if (['video_to_video', 'video_inpaint', 'video_outpaint', 'video_color_edit'].includes(form.mode)) {
      roles.push('loadVideo', 'normalizeVideo');
    }
    if (form.mode === 'control_to_video') {
      roles.push('loadControlVideo', 'normalizeVideo');
    }
    if (form.mode === 'video_inpaint' || form.mode === 'video_outpaint') {
      roles.push('loadMaskVideo', 'alignMaskVideo');
    }
    if (
      form.mode === 'image_to_video' ||
      form.mode === 'reference_to_video' ||
      (form.modelType === 'WanVACEPipeline' && form.referenceImages.length > 0)
    ) {
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
    const runtimeRoles: StudioGraphRole[] = ['diffusersQuantization', 'diffusersRecipe'];
    if (form.mode === 'edit_image' || form.mode === 'multi_image_reference_edit') {
      return [...runtimeRoles, 'diffusersImagePipeline', 'loadImage', 'diffusersImageEdit', 'preview'];
    }
    if (form.mode === 'outpaint' && form.modelType === 'QwenImageEditModularPipeline') {
      return [
        ...runtimeRoles,
        'diffusersImagePipeline',
        'loadImage',
        'qwenOutpaintCanvas',
        'diffusersImageInpaint',
        'preview',
      ];
    }
    if (form.mode === 'inpaint' || form.mode === 'outpaint') {
      return [...runtimeRoles, 'diffusersImagePipeline', 'loadImage', 'loadMask', 'diffusersImageInpaint', 'preview'];
    }
    if (form.mode === 'control_image') {
      return [...runtimeRoles, 'diffusersImagePipeline', 'loadImage', 'diffusersImageControl', 'preview'];
    }
    return [...runtimeRoles, 'diffusersImagePipeline', 'diffusersImageGenerate', 'preview'];
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
  return (
    node.type === 'group' ||
    node.type === 'loop' ||
    node.data.type === 'group' ||
    node.data.type === 'loop' ||
    node.data.category === 'group'
  );
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

  const managedRoleOwners = new Map<string, string>();
  for (const nodeId of managedNodeIds) {
    const node = nodeById.get(nodeId);
    const role = node?.data.studioRole;
    if (typeof role !== 'string' || !role) continue;
    const existingOwner = managedRoleOwners.get(role);
    if (existingOwner && existingOwner !== nodeId) {
      return {
        kind: 'extra_graph_node',
        message: 'Custom graph detected.',
        details: `Multiple nodes claim the managed ${role} role.`,
      };
    }
    managedRoleOwners.set(role, nodeId);
  }

  const extraGraphNodes = nodes.filter((node) => !managedNodes.has(node.id) && !isIgnorableCustomGraphNode(node));
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

const GRAPH_PROOF_PARAM_KEYS: Array<keyof NodeParams> = [
  'type',
  'display',
  'disabled',
  'hidden',
  'required',
  'isInput',
  'spawn',
  'optionsSource',
  'min',
  'max',
  'step',
  'onChange',
  'onSignal',
  'dataSource',
  'fieldOptions',
];

function orderedGraphProofValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedGraphProofValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, orderedGraphProofValue(entryValue)]),
  );
}

function hashGraphProof(value: unknown) {
  const serialized = JSON.stringify(orderedGraphProofValue(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `graph-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function fieldSchemaHash(binding: StudioGraphBinding, form: StudioFormState) {
  const nodes = useFlowStore.getState().nodes;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const roles = requiredRolesForForm(resolveGraphResourceForm(form));

  return hashGraphProof({
    nodes: roles.map((role) => {
      const nodeId = binding.nodes[role];
      const node = nodeId ? nodeById.get(nodeId) : undefined;
      return {
        role,
        id: nodeId,
        module: node?.data.module,
        action: node?.data.action,
        params: Object.fromEntries(
          Object.entries(node?.data.params ?? {})
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, param]) => [
              key,
              Object.fromEntries(
                GRAPH_PROOF_PARAM_KEYS.map((paramKey) => [paramKey, param[paramKey]]).filter(
                  ([, paramValue]) => paramValue !== undefined,
                ),
              ),
            ]),
        ),
      };
    }),
  });
}

function bindingWithFinalizationProof(
  binding: StudioGraphBinding,
  form: StudioFormState,
  finalizedAt = Date.now(),
): StudioGraphBinding {
  const plannedForm = resolveGraphResourceForm(form);
  return {
    ...binding,
    finalizationProof: {
      schemaVersion: 1,
      shapeKey: getStudioGraphShapeKey(plannedForm),
      fieldSchemaHash: fieldSchemaHash(binding, plannedForm),
      finalizedAt,
    },
    updatedAt: finalizedAt,
  };
}

function bindingFinalizationProofMatches(binding: StudioGraphBinding, form: StudioFormState) {
  const proof = binding.finalizationProof;
  const plannedForm = resolveGraphResourceForm(form);
  return Boolean(
    proof?.schemaVersion === 1 &&
    proof.shapeKey === getStudioGraphShapeKey(plannedForm) &&
    proof.fieldSchemaHash === fieldSchemaHash(binding, plannedForm),
  );
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
  const studio = useStudioStore.getState();
  if (
    key === 'value' &&
    studio.form.resourceMode === 'auto' &&
    studio.autoFieldOverrides[autoFieldOverrideKey(nodeId, fieldKey)]
  ) {
    return true;
  }
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
  if (form.modelType === 'QwenImageModularPipeline') return 'QwenImagePipeline';
  if (form.modelType === 'QwenImageEditModularPipeline' && (form.mode === 'inpaint' || form.mode === 'outpaint')) {
    return 'QwenImageEditInpaintPipeline';
  }
  if (form.modelType === 'FluxKontextPipeline') return 'FluxKontextPipeline';
  if (form.modelType === 'FluxReduxPipeline') return 'FluxReduxPipeline';
  if (form.modelType === 'Flux2KleinPipeline') return 'Flux2KleinPipeline';
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
    diffusersQuantization,
    diffusersRecipe,
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
  const controlledSequence = useFlowStore
    .getState()
    .nodes.find((node) => node.data?.studioRole === 'videoSequence')?.id;
  const controlledCompose = useFlowStore.getState().nodes.find((node) => node.data?.studioRole === 'videoCompose')?.id;
  const controlledUpscaler = useFlowStore.getState().nodes.find((node) => node.data?.studioRole === 'upscaler')?.id;
  const sequenceDeliverySource = controlledCompose ?? controlledSequence;
  const preUpscaleDeliverySource = sequenceDeliverySource ?? wanGenerate;
  const deliverySource = controlledUpscaler ?? sequenceDeliverySource ?? wanGenerate;
  const specs = [
    makeConnectionSpec(diffusersQuantization, ['quantization_config'], diffusersRecipe, ['quantization_config']),
    makeConnectionSpec(diffusersRecipe, ['execution_recipe'], wanPipeline, ['execution_recipe']),
    makeConnectionSpec(wanPipeline, ['pipeline'], controlledSequence ?? wanGenerate, ['pipeline']),
    makeConnectionSpec(controlledSequence, ['clips'], controlledCompose, ['clip_1']),
    makeConnectionSpec(
      controlledUpscaler ? preUpscaleDeliverySource : undefined,
      controlledCompose ? ['video'] : ['video_out'],
      controlledUpscaler,
      ['image'],
    ),
    makeConnectionSpec(
      deliverySource,
      controlledUpscaler ? ['output'] : controlledCompose ? ['video'] : ['video_out'],
      videoExport,
      ['video'],
    ),
  ];

  if (loadImage) {
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
    diffusersQuantization,
    diffusersRecipe,
    diffusersImagePipeline,
    diffusersImageGenerate,
    diffusersImageEdit,
    diffusersImageInpaint,
    diffusersImageControl,
    loadImage,
    loadMask,
    qwenOutpaintCanvas,
    preview,
  } = binding.nodes;
  const targetNode = diffusersImageInpaint ?? diffusersImageControl ?? diffusersImageEdit ?? diffusersImageGenerate;
  return [
    makeConnectionSpec(diffusersQuantization, ['quantization_config'], diffusersRecipe, ['quantization_config']),
    makeConnectionSpec(diffusersRecipe, ['execution_recipe'], diffusersImagePipeline, ['execution_recipe']),
    makeConnectionSpec(diffusersImagePipeline, ['pipeline'], targetNode, ['pipeline']),
    makeConnectionSpec(loadImage, ['image'], diffusersImageEdit, ['image']),
    makeConnectionSpec(loadImage, ['image'], qwenOutpaintCanvas, ['image']),
    makeConnectionSpec(qwenOutpaintCanvas, ['canvas'], diffusersImageInpaint, ['image']),
    makeConnectionSpec(qwenOutpaintCanvas, ['mask_image'], diffusersImageInpaint, ['mask_image']),
    makeConnectionSpec(qwenOutpaintCanvas ? undefined : loadImage, ['image'], diffusersImageInpaint, ['image']),
    makeConnectionSpec(loadMask, ['image'], diffusersImageInpaint, ['mask_image']),
    makeConnectionSpec(loadImage, ['image'], diffusersImageControl, ['control_image', 'image']),
    makeConnectionSpec(targetNode, ['images', 'image', 'output'], preview, ['image']),
  ].filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredStillUpscaleEdgeSpecs(binding: StudioGraphBinding) {
  const controlledUpscaler = useFlowStore.getState().nodes.find((node) => node.data?.studioRole === 'upscaler')?.id;
  const controlledPreview = useFlowStore
    .getState()
    .nodes.find((node) => node.data?.studioRole === 'upscalePreview')?.id;
  if (!controlledUpscaler || !controlledPreview) return [];

  const source = usesQwenDirectTextToImage(binding)
    ? binding.nodes.qwenGenerate
    : usesQwenDirectInpaint(binding) || usesQwenDirectOutpaint(binding)
      ? binding.nodes.qwenInpaint
      : usesDiffusersImageFacade(binding)
        ? (binding.nodes.diffusersImageInpaint ??
          binding.nodes.diffusersImageControl ??
          binding.nodes.diffusersImageEdit ??
          binding.nodes.diffusersImageGenerate)
        : binding.nodes.decode;

  return [
    makeConnectionSpec(source, ['images', 'image', 'output'], controlledUpscaler, ['image']),
    makeConnectionSpec(controlledUpscaler, ['output', 'image'], controlledPreview, ['image']),
  ].filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredAudioEdgeSpecs(binding: StudioGraphBinding) {
  const {
    diffusersQuantization,
    diffusersRecipe,
    audioPipeline,
    loadAudio,
    loadReferenceAudio,
    audioGenerate,
    audioLoudnessMatch,
    audioJoin,
    audioExport,
  } = binding.nodes;
  return [
    makeConnectionSpec(diffusersQuantization, ['quantization_config'], diffusersRecipe, ['quantization_config']),
    makeConnectionSpec(diffusersRecipe, ['execution_recipe'], audioPipeline, ['execution_recipe']),
    makeConnectionSpec(audioPipeline, ['pipeline'], audioGenerate, ['pipeline']),
    makeConnectionSpec(loadAudio, ['audio'], audioGenerate, ['source_audio', 'audio']),
    makeConnectionSpec(loadReferenceAudio, ['audio'], audioGenerate, ['reference_audio']),
    makeConnectionSpec(audioGenerate, ['audio'], audioLoudnessMatch ?? audioJoin ?? audioExport, [
      'audio',
      'continuation',
    ]),
    makeConnectionSpec(loadAudio, ['audio'], audioLoudnessMatch, ['reference']),
    makeConnectionSpec(audioLoudnessMatch, ['output'], audioJoin ?? audioExport, ['continuation', 'audio']),
    makeConnectionSpec(loadAudio, ['audio'], audioJoin, ['source']),
    makeConnectionSpec(audioJoin, ['output'], audioExport, ['audio']),
  ].filter((spec): spec is StudioEdgeSpec => Boolean(spec));
}

function desiredEdgeSpecs(binding: StudioGraphBinding) {
  if (usesQwenDirectTextToImage(binding)) {
    return [...desiredQwenTextToImageEdgeSpecs(binding), ...desiredStillUpscaleEdgeSpecs(binding)];
  }
  if (usesQwenDirectInpaint(binding)) {
    return [...desiredQwenInpaintEdgeSpecs(binding), ...desiredStillUpscaleEdgeSpecs(binding)];
  }
  if (usesQwenDirectOutpaint(binding)) {
    return [...desiredQwenOutpaintEdgeSpecs(binding), ...desiredStillUpscaleEdgeSpecs(binding)];
  }
  if (isAudioMode(binding.mode)) return desiredAudioEdgeSpecs(binding);
  if (usesDiffusersImageFacade(binding)) {
    return [...desiredDiffusersImageEdgeSpecs(binding), ...desiredStillUpscaleEdgeSpecs(binding)];
  }
  return isVideoMode(binding.mode)
    ? desiredVideoEdgeSpecs(binding)
    : [...desiredBaseEdgeSpecs(binding), ...desiredStillUpscaleEdgeSpecs(binding)];
}

function minimumDynamicManagedEdgeCount(binding: StudioGraphBinding) {
  // Modular Diffusers starts with seven core links. Dynamic field actions add
  // the concrete handles used by these links, so a smaller restored graph is
  // still a skeleton and must not be treated as finalized.
  let count = 7;
  if (binding.nodes.qwenQuantization) count += 1;

  if (
    binding.mode === 'inpaint' &&
    binding.nodes.loadImage &&
    binding.nodes.loadMask &&
    binding.nodes.applyMask &&
    binding.nodes.imageEncode
  ) {
    count += 6;
  } else if (binding.nodes.loadImage && binding.nodes.imageEncode) {
    count += 4;
  }

  if (binding.nodes.loadImage && binding.nodes.controlnetModel && binding.nodes.controlnet) {
    count += 4;
  }

  const controlledRoles = new Set(
    useFlowStore
      .getState()
      .nodes.map((node) => node.data.studioRole)
      .filter((role): role is string => typeof role === 'string'),
  );
  if (controlledRoles.has('upscaler') && controlledRoles.has('upscalePreview')) count += 2;
  return count;
}

function nodeHasFieldGroups(nodeId: string | undefined, groups: string[][]) {
  return Boolean(nodeId && groups.every((group) => Boolean(findParamKey(nodeId, group))));
}

function legacyDynamicFieldGroupsAreFinalized(binding: StudioGraphBinding) {
  if (
    !nodeHasFieldGroups(binding.nodes.prompt, [['prompt'], ['embeddings']]) ||
    !nodeHasFieldGroups(binding.nodes.denoise, [
      ['embeddings'],
      ['latents'],
      ...(binding.nodes.controlnet ? ([['controlnet_bundle']] as string[][]) : []),
    ]) ||
    !nodeHasFieldGroups(binding.nodes.decode, [['latents'], ['images']])
  ) {
    return false;
  }
  if (binding.nodes.qwenQuantization) {
    if (!nodeHasFieldGroups(binding.nodes.qwenQuantization, [['model_id'], ['quantization_config']])) return false;
  }
  if (binding.nodes.imageEncode) {
    if (!nodeHasFieldGroups(binding.nodes.imageEncode, [['image'], ['image_latents']])) return false;
  }
  if (binding.nodes.controlnet) {
    if (
      !nodeHasFieldGroups(binding.nodes.controlnet, [['control_image'], ['controlnet'], ['vae'], ['controlnet_bundle']])
    ) {
      return false;
    }
  }
  return true;
}

function restoredManagedGraphIsLocallyFinalized(
  binding: StudioGraphBinding,
  form: StudioFormState,
  allowLegacyDynamicProof: boolean,
) {
  const plannedForm = resolveGraphResourceForm(form);
  if (
    binding.mode !== plannedForm.mode ||
    binding.modelType !== plannedForm.modelType ||
    binding.fingerprint !== bindingFingerprint(plannedForm)
  ) {
    return false;
  }

  const requiredRoles = requiredRolesForForm(plannedForm);
  const requiredNodeIds = requiredRoles.map((role) => binding.nodes[role]);
  if (
    requiredNodeIds.some((nodeId) => !nodeId) ||
    new Set(requiredNodeIds).size !== requiredNodeIds.length ||
    requiredRoles.some((role) => !nodeMatchesRole(binding.nodes[role], role))
  ) {
    return false;
  }
  if (inspectStudioGraphBindingDivergence(binding)) return false;

  const hasProof = Boolean(binding.finalizationProof);
  if (hasProof) {
    return (
      bindingFinalizationProofMatches(binding, plannedForm) && getStudioGraphRunBlockingMessage(plannedForm) === null
    );
  }
  if (!allowLegacyDynamicProof || !requiresDynamicGraphChannel(plannedForm)) return false;

  const desiredSpecs = desiredEdgeSpecs(binding);
  const desiredEdgeIds = collectDesiredEdgeIds(desiredSpecs);
  const trackedEdgeIds = new Set(binding.managedEdgeIds ?? []);
  if (
    desiredSpecs.length === 0 ||
    desiredEdgeIds.length !== desiredSpecs.length ||
    desiredEdgeIds.some((edgeId) => !trackedEdgeIds.has(edgeId))
  ) {
    return false;
  }

  if (requiresDynamicGraphChannel(plannedForm) && desiredSpecs.length < minimumDynamicManagedEdgeCount(binding)) {
    return false;
  }
  if (!legacyDynamicFieldGroupsAreFinalized(binding)) return false;

  return getStudioGraphRunBlockingMessage(plannedForm) === null;
}

function restoreFinalizedGraphState(
  binding: StudioGraphBinding,
  form: StudioFormState,
  previous: StudioGraphFinalizationState | null,
) {
  const allowLegacyDynamicProof = !binding.finalizationProof;
  if (!restoredManagedGraphIsLocallyFinalized(binding, form, allowLegacyDynamicProof)) return false;

  const finalizedBinding = binding.finalizationProof ? binding : bindingWithFinalizationProof(binding, form);
  const finalizedAt = finalizedBinding.finalizationProof?.finalizedAt ?? Date.now();
  const studio = useStudioStore.getState();
  if (finalizedBinding !== binding) studio.setGraphBinding(finalizedBinding);
  studio.setGraphFinalization({
    status: 'complete',
    bindingFingerprint: finalizedBinding.fingerprint,
    startedAt: previous?.startedAt ?? null,
    skeletonMs: previous?.skeletonMs,
    finalizedAt,
    timedOutGroups: [],
    managedEdgeCount: finalizedBinding.managedEdgeIds.length,
    message: 'Restored finalized graph verified.',
  });
  studio.setLastError(null);
  studio.saveActiveWorkflowTab(true);
  return true;
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

function reconcileManagedGraphBinding(
  binding: StudioGraphBinding,
  managedExtensionNodeIds: readonly string[] = [],
): StudioGraphBinding {
  const { nodes, edges } = useFlowStore.getState();
  const requestedExtensionIds = new Set(managedExtensionNodeIds);
  const managedNodeIds = Array.from(
    new Set([
      ...(binding.managedNodeIds?.length ? binding.managedNodeIds : Object.values(binding.nodes).filter(isString)),
      ...nodes
        .filter((node) => requestedExtensionIds.has(node.id) && node.data.studioOwned === true)
        .map((node) => node.id),
    ]),
  );
  const managedNodes = new Set(managedNodeIds);
  return {
    ...binding,
    managedNodeIds,
    managedEdgeIds: edges
      .filter((edge) => managedNodes.has(edge.source) && managedNodes.has(edge.target))
      .map((edge) => edge.id),
    updatedAt: Date.now(),
  };
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

  const reconciledBinding = reconcileManagedGraphBinding(currentBinding);
  const nextEdgeIds = reconciledBinding.managedEdgeIds;

  const currentIds = [...(currentBinding.managedEdgeIds ?? [])].sort().join('|');
  const nextIds = [...nextEdgeIds].sort().join('|');
  const currentNodeIds = [...(currentBinding.managedNodeIds ?? [])].sort().join('|');
  const nextNodeIds = [...reconciledBinding.managedNodeIds].sort().join('|');
  if (currentIds === nextIds && currentNodeIds === nextNodeIds) return;

  useStudioStore.getState().setGraphBinding(reconciledBinding);
}

export function refreshStudioManagedGraphBinding(managedExtensionNodeIds: readonly string[] = []) {
  const binding = useStudioStore.getState().graphBinding;
  if (!binding) return null;
  const refreshed = reconcileManagedGraphBinding(binding, managedExtensionNodeIds);
  useStudioStore.getState().setGraphBinding(refreshed);
  return refreshed;
}

function scheduleManagedEdgeBindingRefresh(binding: StudioGraphBinding) {
  [0, 50, 150, 400, 900, 1500, 2500].forEach((delayMs) => {
    window.setTimeout(() => refreshManagedEdgeBinding(binding), delayMs);
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiresDynamicGraphChannel(form: StudioFormState) {
  return (
    !isVideoMode(form.mode) &&
    !isAudioMode(form.mode) &&
    !usesDiffusersImageFacade(form) &&
    !usesQwenDirectTextToImage(form) &&
    !usesQwenDirectInpaintPipeline(form)
  );
}

async function waitForDynamicGraphChannel(timeout = 20_000) {
  if (typeof WebSocket === 'undefined') return true;

  let websocket = useWebsocketStore.getState();
  if (websocket.isConnected && websocket.sid) return true;
  if (!websocket.isConnecting) {
    websocket.connect();
  }

  const started = Date.now();
  while (Date.now() - started < timeout) {
    websocket = useWebsocketStore.getState();
    if (websocket.isConnected && websocket.sid) return true;
    await delay(50);
  }

  const message = 'The Studio graph could not initialize because the MoDiff connection is not ready.';
  useStudioStore.getState().setLastError(message);
  throw new Error(message);
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
    const studioRole = node?.data.studioRole;
    return Boolean(
      node?.data.studioOwned &&
      typeof studioRole === 'string' &&
      Object.prototype.hasOwnProperty.call(NODE_KEYS, studioRole),
    );
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
    .filter(
      (node) =>
        typeof node.data.studioRole === 'string' &&
        Object.prototype.hasOwnProperty.call(NODE_KEYS, node.data.studioRole),
    )
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

async function applyManagedInputSignal(nodeId: string | undefined, candidates: string[], value: unknown) {
  const fieldKey = findParamKey(nodeId, candidates);
  if (!nodeId || !fieldKey) return;
  const props = buildFieldProps(nodeId, fieldKey);
  if (!props?.onSignal) return;

  useFlowStore.getState().setParam(nodeId, fieldKey, { direction: 'input', value }, 'signal');
  await fieldAction(props, value, 'onSignal');
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

function pinControlnetLoaderIdentity(controlnetModel: string | undefined) {
  if (!controlnetModel) return;

  // The dynamic ControlNet node relays the surrounding pipeline class through
  // its boundary handles. Connection reconciliation must never let that
  // QwenImageModularPipeline signal replace AutoModelLoader's component kind:
  // the latter must remain `controlnet` or ComponentSpec loads the repository
  // under an invalid component name and only fails after the base pipeline has
  // spent minutes materializing its weights.
  setParamIfPresent(controlnetModel, ['model_type'], 'controlnet');
  const outputKey = findParamKey(controlnetModel, ['model']);
  const outputParam = getNodeParam(controlnetModel, outputKey);
  if (outputKey && outputParam?.signal) {
    useFlowStore
      .getState()
      .setParam(
        controlnetModel,
        outputKey,
        { ...outputParam.signal, direction: 'output', value: 'controlnet' },
        'signal',
      );
  }
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
    imageEncode,
    loadImage,
    loadMask,
    controlnetModel,
    controlnet,
    qwenInpaintPipeline,
    qwenOutpaintCanvas,
    qwenInpaint,
    diffusersQuantization,
    diffusersRecipe,
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
    audioLoudnessMatch,
    audioJoin,
    audioExport,
  } = binding.nodes;

  if (isAudioMode(form.mode)) {
    const autoCandidate =
      form.resourceMode === 'auto' ? selectedAutoCandidate(useStudioStore.getState().autoResourcePlan, form) : null;
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
    // Auto candidates resolve to pre-built artifacts. On-load quantization is
    // deliberately restricted to Expert graphs where it remains visible.
    const audioQuantizationMode = form.resourceMode === 'expert' ? form.quantizationMode : 'none';
    const audioDtype =
      autoCandidate?.dtype === 'float16' || autoCandidate?.dtype === 'float32' || autoCandidate?.dtype === 'bfloat16'
        ? autoCandidate.dtype
        : form.dtype;
    const audioPipelineClass = autoCandidate?.pipelineClass ?? 'AceStepPipeline';
    const isStableAudioPipeline = audioPipelineClass === 'StableAudioPipeline';

    setParamIfPresent(diffusersQuantization, ['backend'], audioQuantizationMode);
    setParamIfPresent(diffusersQuantization, ['components'], autoCandidate?.quantizedComponents ?? ['transformer']);
    setParamIfPresent(diffusersQuantization, ['dtype'], audioDtype);
    setParamIfPresent(diffusersRecipe, ['device_map'], 'none');
    setParamIfPresent(diffusersRecipe, ['offload_mode'], autoOffloadMode);
    setParamIfPresent(diffusersRecipe, ['device'], form.device);
    setParamIfPresent(diffusersRecipe, ['attention_backend'], autoCandidate?.attentionBackend ?? 'auto');
    setParamIfPresent(diffusersRecipe, ['attention_components'], '');
    setParamIfPresent(diffusersRecipe, ['vae_slicing'], true);
    setParamIfPresent(diffusersRecipe, ['vae_tiling'], true);
    setParamIfPresent(diffusersRecipe, ['regional_compile'], autoCandidate?.regionalCompile ?? false);
    setParamIfPresent(diffusersRecipe, ['denoiser_cache'], autoCandidate?.denoiserCache ?? 'none');
    setParamIfPresent(diffusersRecipe, ['layerwise_casting'], autoCandidate?.layerwiseCasting ?? false);
    setParamIfPresent(diffusersRecipe, ['channels_last'], autoCandidate?.channelsLast ?? false);

    // An audio LoRA is architecture-specific. Keep its declared base model
    // authoritative across later Studio graph reconciliation; otherwise the
    // normal profile sync silently restores the default XL checkpoint and the
    // adapter fails with tensor-shape mismatches at run time.
    setModelRepo(audioPipeline, activeAudioTemplateBaseModel() ?? autoArtifact ?? capability.defaultRepo);
    setParamIfPresent(audioPipeline, ['pipeline_class'], audioPipelineClass);
    setParamIfPresent(audioPipeline, ['mode'], form.mode);
    setParamIfPresent(audioPipeline, ['dtype'], audioDtype);
    setParamIfPresent(audioPipeline, ['device'], form.device);
    setParamIfPresent(audioPipeline, ['auto_offload'], autoOffloadMode !== 'none');
    setParamIfPresent(audioPipeline, ['offload_mode'], autoOffloadMode);

    if (loadAudio) setParamIfPresent(loadAudio, ['file'], form.sourceAudio);
    if (loadReferenceAudio) setParamIfPresent(loadReferenceAudio, ['file'], form.referenceAudio);

    setParamIfPresent(audioGenerate, ['task_type'], audioTaskForMode(form.mode));
    setParamIfPresent(audioGenerate, ['prompt'], form.prompt);
    setParamIfPresent(audioGenerate, ['negative_prompt'], form.negativePrompt);
    setParamIfPresent(audioGenerate, ['lyrics'], form.lyrics);
    // Candidate defaults are reconciled into the Studio form before graph
    // synchronization. The form then remains authoritative so a user can edit
    // the main Auto controls without the previous candidate immediately
    // restoring its defaults.
    setParamIfPresent(audioGenerate, ['audio_duration'], form.audioDuration);
    setParamIfPresent(audioGenerate, ['extension_duration'], form.extensionDuration);
    setParamIfPresent(audioGenerate, ['vocal_language'], form.vocalLanguage);
    setParamIfPresent(audioGenerate, ['seed'], seedValue(form));
    setParamIfPresent(audioGenerate, ['num_inference_steps', 'steps'], form.steps);
    setParamIfPresent(audioGenerate, ['guidance_scale'], form.guidanceScale);
    setParamIfPresent(audioGenerate, ['shift'], form.shift);
    setParamIfPresent(audioGenerate, ['bpm'], form.bpm > 0 ? form.bpm : 0);
    setParamIfPresent(audioGenerate, ['keyscale'], form.keyscale);
    setParamIfPresent(audioGenerate, ['timesignature'], form.timesignature);
    setParamIfPresent(audioGenerate, ['repainting_start'], form.repaintingStart);
    setParamIfPresent(audioGenerate, ['repainting_end'], form.repaintingEnd);
    setParamIfPresent(audioGenerate, ['audio_cover_strength'], form.audioCoverStrength);
    setParamIfPresent(audioGenerate, ['return_continuation_tail'], form.mode === 'audio_continuation');
    setParamIfPresent(audioGenerate, ['sample_rate'], capability.recommendedSampleRate ?? 48000);
    // DiffusersAudio.Generate is shared by ACE-Step and Stable Audio, but the
    // two pipelines do not consume the same controls. Keep managed nodes
    // honest: never show an ACE user controls that this run will ignore.
    setParamIfPresent(audioGenerate, ['lora_scale'], true, 'hidden');
    setParamIfPresent(audioGenerate, ['stable_audio_steps'], !isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['stable_audio_guidance'], !isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['num_waveforms'], !isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['negative_prompt'], !isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['lyrics'], isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['extension_duration'], form.mode !== 'audio_continuation', 'hidden');
    setParamIfPresent(audioGenerate, ['vocal_language'], isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['num_inference_steps'], isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['guidance_scale'], isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['shift'], isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['bpm'], isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['keyscale'], isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['timesignature'], isStableAudioPipeline, 'hidden');
    setParamIfPresent(audioGenerate, ['repainting_start'], form.mode !== 'audio_repaint', 'hidden');
    setParamIfPresent(audioGenerate, ['repainting_end'], form.mode !== 'audio_repaint', 'hidden');
    setParamIfPresent(audioGenerate, ['audio_cover_strength'], form.mode !== 'audio_variation', 'hidden');
    setParamIfPresent(audioGenerate, ['return_continuation_tail'], form.mode !== 'audio_continuation', 'hidden');
    setParamIfPresent(audioLoudnessMatch, ['reference_window_seconds'], 15);
    setParamIfPresent(audioLoudnessMatch, ['target_peak_dbfs'], -1);
    setParamIfPresent(audioLoudnessMatch, ['max_adjustment_db'], 12);
    setParamIfPresent(audioJoin, ['boundary_fade_seconds'], 0.01);
    setParamIfPresent(audioExport, ['sample_rate'], capability.recommendedSampleRate ?? 48000);
    return;
  }

  if (isVideoMode(form.mode)) {
    const autoCandidate =
      form.resourceMode === 'auto' ? selectedAutoCandidate(useStudioStore.getState().autoResourcePlan, form) : null;
    const preservationWanMode = form.modelType === 'WanVideoPipeline';
    const qualityWanImageMode = form.modelType === 'WanImageToVideoPipeline';
    const qualityWanTextMode = form.modelType === 'WanTI2VPipeline';
    const wanTextToVideoMode = preservationWanMode && form.mode === 'text_to_video';
    const pipelineClass =
      autoCandidate?.pipelineClass ??
      (form.modelType === 'LTXVideoPipeline'
        ? 'LTXConditionPipeline'
        : qualityWanTextMode
          ? 'WanTI2VPipeline'
          : qualityWanImageMode
            ? 'WanImageToVideoPipeline'
            : preservationWanMode
              ? wanTextToVideoMode
                ? 'WanPipeline'
                : 'WanVideoToVideoPipeline'
              : 'WanVACEPipeline');
    const resolvedArtifact =
      autoCandidate?.resolvedArtifact ??
      autoCandidate?.artifact ??
      autoCandidate?.installTarget?.repo ??
      autoCandidate?.modelRepo ??
      (qualityWanTextMode
        ? WAN_22_TI2V_5B_REPO
        : qualityWanImageMode
          ? WAN_22_I2V_A14B_REPO
          : preservationWanMode
            ? WAN_T2V_1_3B_REPO
            : capability.defaultRepo);
    const resolvedOffloadMode = autoCandidate?.offloadMode ?? form.offloadMode;
    const decodedVideoPixels = form.width * form.height * form.numFrames;
    const needsVaeTiling =
      qualityWanImageMode ||
      form.resourceMode !== 'expert' ||
      resolvedOffloadMode !== 'none' ||
      decodedVideoPixels > 40_000_000;
    const supportsNativeFlash =
      form.device.startsWith('cuda') &&
      (pipelineClass === 'WanImageToVideoPipeline' ||
        pipelineClass === 'WanTI2VPipeline' ||
        pipelineClass === 'WanPipeline' ||
        pipelineClass === 'Wan22Pipeline');

    setParamIfPresent(
      diffusersQuantization,
      ['backend'],
      form.resourceMode === 'expert' ? form.quantizationMode : 'none',
    );
    setParamIfPresent(
      diffusersQuantization,
      ['components'],
      pipelineClass === 'WanImageToVideoPipeline' ? ['transformer', 'transformer_2'] : ['transformer'],
    );
    setParamIfPresent(diffusersQuantization, ['dtype'], autoCandidate?.dtype ?? form.dtype);
    setParamIfPresent(diffusersRecipe, ['device_map'], 'none');
    setParamIfPresent(diffusersRecipe, ['offload_mode'], resolvedOffloadMode);
    setParamIfPresent(diffusersRecipe, ['device'], form.device);
    // LTX cross-attention always carries a text mask. On the qualified ROCm
    // stack Diffusers' automatic dispatcher selects AITER native flash, whose
    // masked path raises before the first denoising step. Keep LTX on portable
    // math SDPA; Wan can still use native flash where its contract allows it.
    const attentionBackend =
      autoCandidate?.attentionBackend ??
      (pipelineClass === 'LTXConditionPipeline' ? '_native_math' : supportsNativeFlash ? '_native_flash' : 'auto');
    setParamIfPresent(diffusersRecipe, ['attention_backend'], attentionBackend);
    setParamIfPresent(
      diffusersRecipe,
      ['attention_components'],
      supportsNativeFlash
        ? pipelineClass === 'WanImageToVideoPipeline'
          ? 'transformer,transformer_2'
          : 'transformer'
        : '',
    );
    setParamIfPresent(diffusersRecipe, ['vae_slicing'], true);
    // Decode activation pressure can exceed sampling pressure by tens of GiB.
    // Wan I2V also VAE-encodes an 81-frame padded conditioning tensor before
    // denoising, which can exceed resident-model headroom even at 768x512.
    setParamIfPresent(diffusersRecipe, ['vae_tiling'], needsVaeTiling);
    setParamIfPresent(diffusersRecipe, ['regional_compile'], autoCandidate?.regionalCompile ?? false);
    setParamIfPresent(diffusersRecipe, ['denoiser_cache'], autoCandidate?.denoiserCache ?? 'none');
    setParamIfPresent(diffusersRecipe, ['layerwise_casting'], autoCandidate?.layerwiseCasting ?? false);
    setParamIfPresent(diffusersRecipe, ['channels_last'], autoCandidate?.channelsLast ?? false);

    setModelRepo(wanPipeline, resolvedArtifact);
    setParamIfPresent(wanPipeline, ['pipeline_class'], pipelineClass);
    setParamIfPresent(wanPipeline, ['revision'], pipelineClass === 'WanVACEPipeline' ? WAN_VACE_REVISION : '');
    setParamIfPresent(wanPipeline, ['dtype'], autoCandidate?.dtype ?? form.dtype);
    setParamIfPresent(wanPipeline, ['device'], form.device);
    setParamIfPresent(wanPipeline, ['auto_offload'], resolvedOffloadMode !== 'none');
    setParamIfPresent(wanPipeline, ['offload_mode'], resolvedOffloadMode);

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
      setParamIfPresent(alignMaskVideo, ['grow_pixels'], form.mode === 'video_inpaint' ? 96 : 0);
    }

    setParamIfPresent(wanGenerate, ['prompt'], form.prompt);
    setParamIfPresent(wanGenerate, ['mode'], form.mode);
    setParamIfPresent(wanGenerate, ['negative_prompt'], form.negativePrompt);
    setParamIfPresent(wanGenerate, ['width'], form.width);
    setParamIfPresent(wanGenerate, ['height'], form.height);
    setParamIfPresent(wanGenerate, ['seed'], seedValue(form));
    setParamIfPresent(wanGenerate, ['num_frames'], form.numFrames);
    setParamIfPresent(wanGenerate, ['num_inference_steps'], form.steps);
    setParamIfPresent(wanGenerate, ['guidance_scale'], form.guidanceScale);
    if (form.modelType === 'WanVideoPipeline' || form.modelType === 'WanTI2VPipeline') {
      setParamIfPresent(wanGenerate, ['scheduler_flow_shift'], form.shift);
    }
    setParamIfPresent(wanGenerate, ['conditioning_scale'], form.conditioningScale);
    // LTX exposes two separate controls for video-to-video: condition strength
    // keeps the source trajectory attached, while denoise strength determines
    // how far the generated appearance may move from the source. Reusing one
    // value for both made those controls fight each other and prevented visible
    // restyling. Other modes and adapters retain their existing normalized
    // strength contract.
    const conditionStrength =
      form.modelType === 'LTXVideoPipeline' && form.mode === 'video_to_video' ? form.conditioningScale : form.strength;
    setParamIfPresent(wanGenerate, ['strength'], conditionStrength);
    setParamIfPresent(wanGenerate, ['denoise_strength'], form.strength);
    setParamIfPresent(wanGenerate, ['frame_rate'], form.fps);
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
      form.resourceMode === 'auto' ? selectedAutoCandidate(useStudioStore.getState().autoResourcePlan, form) : null;
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
    const autoQuantizationMode = form.resourceMode === 'expert' ? form.quantizationMode : 'none';
    const targetNode = diffusersImageInpaint ?? diffusersImageControl ?? diffusersImageEdit ?? diffusersImageGenerate;
    const pipelineClass =
      isFluxModel(form.modelType) ||
      form.modelType === 'QwenImageModularPipeline' ||
      form.modelType === 'QwenImageEditModularPipeline'
        ? fluxPipelineClassFor(form, autoCandidate?.pipelineClass)
        : form.modelType === 'ZImageModularPipeline'
          ? (autoCandidate?.pipelineClass ?? 'ZImagePipeline')
          : autoCandidate?.pipelineClass;
    const imageDtype =
      autoCandidate?.dtype === 'float16' || autoCandidate?.dtype === 'float32' || autoCandidate?.dtype === 'bfloat16'
        ? autoCandidate.dtype
        : form.dtype;

    setParamIfPresent(diffusersQuantization, ['backend'], autoQuantizationMode);
    setParamIfPresent(diffusersQuantization, ['components'], autoCandidate?.quantizedComponents ?? ['transformer']);
    setParamIfPresent(diffusersQuantization, ['dtype'], imageDtype);
    setParamIfPresent(diffusersRecipe, ['device_map'], 'none');
    setParamIfPresent(diffusersRecipe, ['offload_mode'], autoOffloadMode);
    setParamIfPresent(diffusersRecipe, ['device'], form.device);
    setParamIfPresent(diffusersRecipe, ['attention_backend'], autoCandidate?.attentionBackend ?? 'auto');
    setParamIfPresent(diffusersRecipe, ['attention_components'], '');
    setParamIfPresent(diffusersRecipe, ['vae_slicing'], true);
    setParamIfPresent(diffusersRecipe, ['vae_tiling'], true);
    setParamIfPresent(diffusersRecipe, ['regional_compile'], autoCandidate?.regionalCompile ?? false);
    setParamIfPresent(diffusersRecipe, ['denoiser_cache'], autoCandidate?.denoiserCache ?? 'none');
    setParamIfPresent(diffusersRecipe, ['layerwise_casting'], autoCandidate?.layerwiseCasting ?? false);
    setParamIfPresent(diffusersRecipe, ['channels_last'], autoCandidate?.channelsLast ?? false);

    setModelRepo(diffusersImagePipeline, autoArtifact ?? capability.defaultRepo);
    if (pipelineClass) {
      setParamIfPresent(diffusersImagePipeline, ['pipeline_class'], pipelineClass);
    }
    setParamIfPresent(diffusersImagePipeline, ['mode'], form.mode);
    setParamIfPresent(diffusersImagePipeline, ['dtype'], imageDtype);
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
    if (qwenOutpaintCanvas) {
      setParamIfPresent(qwenOutpaintCanvas, ['width'], form.width);
      setParamIfPresent(qwenOutpaintCanvas, ['height'], form.height);
      setParamIfPresent(qwenOutpaintCanvas, ['left'], form.outpaintLeft);
      setParamIfPresent(qwenOutpaintCanvas, ['right'], form.outpaintRight);
      setParamIfPresent(qwenOutpaintCanvas, ['top'], form.outpaintTop);
      setParamIfPresent(qwenOutpaintCanvas, ['bottom'], form.outpaintBottom);
      setParamIfPresent(qwenOutpaintCanvas, ['overlap'], form.outpaintOverlap);
      setParamIfPresent(qwenOutpaintCanvas, ['feather'], form.outpaintFeather);
      setParamIfPresent(qwenOutpaintCanvas, ['fill_color'], form.outpaintFillColor);
    }

    setParamIfPresent(targetNode, ['prompt'], form.prompt);
    setParamIfPresent(targetNode, ['negative_prompt'], form.negativePrompt);
    // Auto resource planning has already reconciled the selected candidate into
    // the Studio form. The executable graph must preserve that final user-facing
    // resolution/aspect ratio instead of restoring the candidate's square native
    // dimensions here.
    setParamIfPresent(targetNode, ['width'], form.width);
    setParamIfPresent(targetNode, ['height'], form.height);
    setParamIfPresent(targetNode, ['seed'], seedValue(form));
    setParamIfPresent(targetNode, ['num_inference_steps', 'steps'], form.steps);
    setParamIfPresent(targetNode, ['guidance_scale', 'guidance'], form.guidanceScale);
    setParamIfPresent(targetNode, ['strength'], form.strength);
    setParamIfPresent(targetNode, ['reference_strength'], form.conditioningScale);
    setParamIfPresent(targetNode, ['output_type'], form.outputType);
    setParamIfPresent(targetNode, ['max_sequence_length'], form.maxSequenceLength);
    return;
  }

  if (usesQwenDirectTextToImage(form)) {
    const autoCandidate =
      form.resourceMode === 'auto' ? selectedAutoCandidate(useStudioStore.getState().autoResourcePlan, form) : null;
    const autoArtifact = autoCandidate?.resolvedArtifact ?? autoCandidate?.artifact ?? autoCandidate?.modelRepo;
    const autoOffloadMode =
      autoCandidate?.offloadMode === 'none' ||
      autoCandidate?.offloadMode === 'model_cpu' ||
      autoCandidate?.offloadMode === 'sequential_cpu' ||
      autoCandidate?.offloadMode === 'group_cpu' ||
      autoCandidate?.offloadMode === 'group_disk'
        ? autoCandidate.offloadMode
        : form.offloadMode;
    const autoQuantizationMode = form.resourceMode === 'expert' ? form.quantizationMode : 'none';

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
    setParamIfPresent(qwenGenerate, ['negative_prompt'], form.negativePrompt);
    setParamIfPresent(qwenGenerate, ['width'], form.width);
    setParamIfPresent(qwenGenerate, ['height'], form.height);
    setParamIfPresent(qwenGenerate, ['seed'], seedValue(form));
    setParamIfPresent(qwenGenerate, ['num_inference_steps', 'steps'], form.steps);
    setParamIfPresent(qwenGenerate, ['true_cfg_scale', 'guidance_scale', 'guidance'], form.guidanceScale);
    setParamIfPresent(qwenGenerate, ['output_type'], form.outputType);
    setParamIfPresent(qwenGenerate, ['max_sequence_length'], form.maxSequenceLength);
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
  if (form.modelType === 'QwenImageLayeredModularPipeline') {
    // Qwen-Image-Layered supports two explicit source resolutions. Keep the
    // generic prompt and image-encode nodes in lockstep so switching 640/1024
    // cannot silently fall back to the pipeline default on only one branch.
    const layerResolution = Math.max(form.width, form.height) >= 832 ? 1024 : 640;
    setParamIfPresent(prompt, ['resolution'], layerResolution);
    setParamIfPresent(imageEncode, ['resolution'], layerResolution);
  }

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
    pinControlnetLoaderIdentity(controlnetModel);
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
  syncManagedFormControlAliases(plannedForm, binding);
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

function createSkeletonGraph(
  form: StudioFormState,
  skeletonStartedAt: number,
  context: WorkflowOperationContext,
): BridgeResult {
  assertWorkflowOperationContext(context);
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
  scheduleStudioGraphFinalization(updatedBinding, form, Date.now() - skeletonStartedAt, context);
  return { binding: updatedBinding, warnings: [] };
}

function assertGraphFinalizationActive(token: number) {
  if (token !== graphFinalizationToken) {
    throw new WorkflowOperationCancelledError('Studio graph finalization was superseded.');
  }
  if (!graphFinalizationContext) {
    throw new WorkflowOperationCancelledError('Studio graph finalization no longer owns a workflow.');
  }
  assertWorkflowOperationContext(graphFinalizationContext);
}

function workflowOperationContextsMatch(left: WorkflowOperationContext | null, right: WorkflowOperationContext) {
  return Boolean(
    left &&
    left.workflowTabId === right.workflowTabId &&
    left.canvasEpoch === right.canvasEpoch &&
    left.formEpoch === right.formEpoch,
  );
}

function graphFinalizationOwnerIsCurrent(token: number) {
  return (
    token === graphFinalizationToken &&
    graphFinalizationContext !== null &&
    workflowOperationContextIsCurrentForGraph(graphFinalizationContext)
  );
}

async function finalizeDirectQwenGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  timedOutGroups: string[],
  token: number,
) {
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
            label: 'outpaint canvas',
            nodeId: binding.nodes.qwenOutpaintCanvas,
            groups: [['image'], ['canvas'], ['mask_image']],
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
  assertGraphFinalizationActive(token);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeDirectQwenTextToImageGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  timedOutGroups: string[],
  token: number,
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
  assertGraphFinalizationActive(token);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeDiffusersImageGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  timedOutGroups: string[],
  token: number,
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
  assertGraphFinalizationActive(token);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeAudioGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  timedOutGroups: string[],
  token: number,
) {
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
    binding.nodes.audioLoudnessMatch
      ? waitForFieldGroupsTracked(
          {
            label: 'audio loudness match',
            nodeId: binding.nodes.audioLoudnessMatch,
            groups: [['audio'], ['reference'], ['output']],
            timeout: 5000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
    binding.nodes.audioJoin
      ? waitForFieldGroupsTracked(
          {
            label: 'audio join',
            nodeId: binding.nodes.audioJoin,
            groups: [['source'], ['continuation'], ['output']],
            timeout: 5000,
          },
          timedOutGroups,
        )
      : Promise.resolve(true),
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
  assertGraphFinalizationActive(token);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
}

async function finalizeModularGraph(
  binding: StudioGraphBinding,
  form: StudioFormState,
  timedOutGroups: string[],
  token: number,
) {
  await applyModelType(binding, form.modelType, true);
  assertGraphFinalizationActive(token);
  await Promise.all([
    applyManagedInputSignal(binding.nodes.prompt, ['text_encoders'], form.modelType),
    applyManagedInputSignal(binding.nodes.denoise, ['unet'], form.modelType),
    applyManagedInputSignal(binding.nodes.decode, ['vae'], form.modelType),
    applyManagedInputSignal(binding.nodes.imageEncode, ['vae'], form.modelType),
  ]);
  assertGraphFinalizationActive(token);
  await applyControlnetPipelineType(binding, form.modelType);
  assertGraphFinalizationActive(token);
  await applyControlnetModel(binding, form);
  assertGraphFinalizationActive(token);

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

  assertGraphFinalizationActive(token);
  connectBaseGraph(binding);
  if (binding.nodes.imageEncode) {
    const imageConnectionsReady = await reinforceImageConnections(binding);
    assertGraphFinalizationActive(token);
    if (!imageConnectionsReady) {
      timedOutGroups.push('image input connections');
    }
  }
  if (binding.nodes.controlnet) {
    const controlConnectionsReady = await reinforceControlConnections(binding);
    assertGraphFinalizationActive(token);
    if (!controlConnectionsReady) {
      timedOutGroups.push('control image connections');
    }
  }
  assertGraphFinalizationActive(token);
  applyFormValues(binding, form);
  connectBaseGraph(binding);
  pinControlnetLoaderIdentity(binding.nodes.controlnetModel);
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
      await finalizeDirectQwenTextToImageGraph(binding, form, timedOutGroups, token);
    } else if (usesQwenDirectInpaintPipeline(form)) {
      await finalizeDirectQwenGraph(binding, form, timedOutGroups, token);
    } else if (isAudioMode(form.mode)) {
      await finalizeAudioGraph(binding, form, timedOutGroups, token);
    } else if (usesDiffusersImageFacade(form)) {
      await finalizeDiffusersImageGraph(binding, form, timedOutGroups, token);
    } else if (!isVideoMode(form.mode)) {
      await finalizeModularGraph(binding, form, timedOutGroups, token);
    } else {
      assertGraphFinalizationActive(token);
      applyFormValues(binding, form);
      connectBaseGraph(binding);
    }

    assertGraphFinalizationActive(token);
    const settledNodeEdgeIds = await waitForManagedEdges(binding, 750);
    assertGraphFinalizationActive(token);
    const settledManagedEdgeIds = collectDesiredEdgeIds(desiredEdgeSpecs(binding));
    const managedEdgeIds =
      settledManagedEdgeIds.length > 0
        ? settledManagedEdgeIds
        : settledNodeEdgeIds.length > 0
          ? settledNodeEdgeIds
          : collectManagedNodeEdgeIds(binding);
    const currentBinding = useStudioStore.getState().graphBinding;
    // Controlled template blocks can be added while this background finalizer
    // waits for dynamic fields. Reconcile from the current binding when it is
    // still the same managed graph so those already-adopted Studio extensions
    // are not dropped by this older core-binding snapshot.
    const reconciliationBinding = currentBinding?.fingerprint === binding.fingerprint ? currentBinding : binding;
    const updatedBinding = reconcileManagedGraphBinding({
      ...reconciliationBinding,
      managedEdgeIds,
      updatedAt: Date.now(),
    });
    const finalizedAt = Date.now();
    const finalizedBinding =
      timedOutGroups.length === 0
        ? bindingWithFinalizationProof(updatedBinding, form, finalizedAt)
        : { ...updatedBinding, finalizationProof: undefined, updatedAt: finalizedAt };

    if (graphFinalizationOwnerIsCurrent(token)) {
      useStudioStore.getState().setGraphBinding(finalizedBinding);
      scheduleManagedEdgeBindingRefresh(finalizedBinding);
      useStudioStore.getState().saveActiveWorkflowTab(true);
      const message =
        timedOutGroups.length > 0
          ? `Some graph fields are still finalizing: ${timedOutGroups.join(', ')}. Try syncing the graph if Run stays unavailable.`
          : 'Graph finalized.';
      useStudioStore.getState().setGraphFinalization({
        status: timedOutGroups.length > 0 ? 'warning' : 'complete',
        bindingFingerprint: finalizedBinding.fingerprint,
        startedAt,
        skeletonMs,
        finalizedAt,
        finalizationMs: finalizedAt - startedAt,
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

    return { binding: finalizedBinding, warnings };
  } catch (error) {
    if (isWorkflowOperationCancelled(error)) throw error;
    const message = `Could not finalize Studio graph. ${String(error)}`;
    if (graphFinalizationOwnerIsCurrent(token)) {
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

function scheduleStudioGraphFinalization(
  binding: StudioGraphBinding,
  form: StudioFormState,
  skeletonMs: number,
  context: WorkflowOperationContext,
) {
  assertWorkflowOperationContext(context);
  const token = ++graphFinalizationToken;
  graphFinalizationContext = context;
  const finalization = settleGraphFinalization(finalizeStudioGraph(binding, form, token, skeletonMs));
  graphFinalizationPromise = finalization.finally(() => {
    void finalization.then((outcome) => {
      if (
        outcome.status === 'error' &&
        !isWorkflowOperationCancelled(outcome.error) &&
        graphFinalizationOwnerIsCurrent(token)
      ) {
        console.error('Studio graph finalization failed', outcome.error);
      }
    });
    if (token === graphFinalizationToken) {
      graphFinalizationPromise = null;
      graphFinalizationContext = null;
    }
  });
}

function markGraphFinalizationWaitTimedOut(
  promise: Promise<SettledGraphFinalization<BridgeResult>>,
  timeout: number,
  context: WorkflowOperationContext,
) {
  if (graphFinalizationPromise !== promise) return;
  if (
    !workflowOperationContextsMatch(graphFinalizationContext, context) ||
    !workflowOperationContextIsCurrentForGraph(context)
  ) {
    graphFinalizationToken += 1;
    graphFinalizationPromise = null;
    graphFinalizationContext = null;
    return;
  }
  const state = useStudioStore.getState();
  const current = state.graphFinalization;
  const message = `Graph preparation is still running after ${Math.max(0, timeout)} ms. It will continue in the background; retry Queue when the graph is ready.`;
  state.setGraphFinalization({
    status: 'pending',
    bindingFingerprint: current?.bindingFingerprint ?? state.graphBinding?.fingerprint ?? null,
    startedAt: current?.startedAt ?? null,
    skeletonMs: current?.skeletonMs,
    timedOutGroups: Array.from(new Set([...(current?.timedOutGroups ?? []), 'overall graph preparation'])),
    managedEdgeCount: current?.managedEdgeCount ?? 0,
    message,
  });
  state.setLastError(message);
}

function workflowOperationContextIsCurrentForGraph(context: WorkflowOperationContext) {
  try {
    assertWorkflowOperationContext(context);
    return true;
  } catch (error) {
    if (isWorkflowOperationCancelled(error)) return false;
    throw error;
  }
}

async function createOrUpdateStudioGraphInner(
  formInput: StudioFormState = useStudioStore.getState().form,
  context: WorkflowOperationContext,
): Promise<BridgeResult> {
  assertWorkflowOperationContext(context);
  const skeletonStartedAt = Date.now();
  const form = resolveGraphResourceForm(formInput);
  const roles = requiredRolesForForm(form);
  const missingRoles = await ensureRegistryForRoles(roles);
  assertWorkflowOperationContext(context);
  if (missingRoles.length > 0) {
    const message = missingRolesMessage(form, missingRoles);
    useStudioStore.getState().setLastError(message);
    throw new Error(message);
  }

  if (requiresDynamicGraphChannel(form)) {
    await waitForDynamicGraphChannel();
    assertWorkflowOperationContext(context);
  }

  assertWorkflowOperationContext(context);
  const flow = useFlowStore.getState();
  flow.beginHistoryTransaction('Update Studio graph');
  try {
    return createSkeletonGraph(form, skeletonStartedAt, context);
  } finally {
    flow.commitHistoryTransaction();
  }
}

export async function createOrUpdateStudioGraph(
  form: StudioFormState = useStudioStore.getState().form,
  context: WorkflowOperationContext = captureWorkflowOperationContext(),
): Promise<BridgeResult> {
  const requestedForm = cloneStudioFormForGraph(form);
  const previousUpdate = graphUpdatePromise;
  const runGraphUpdate = async () => {
    if (previousUpdate) await previousUpdate.catch(() => undefined);
    assertWorkflowOperationContext(context);
    const result = await createOrUpdateStudioGraphInner(requestedForm, context);
    const finalized = await waitForStudioGraphFinalization(15_000, context);
    if (!finalized) {
      throw new Error(
        useStudioStore.getState().graphFinalization?.message ?? 'Graph preparation timed out before it was finalized.',
      );
    }
    assertWorkflowOperationContext(context);
    return result;
  };

  const operation = runGraphUpdate();
  graphUpdatePromise = operation;
  try {
    return await operation;
  } finally {
    if (graphUpdatePromise === operation) graphUpdatePromise = null;
  }
}

export async function waitForStudioGraphFinalization(
  timeout = 9000,
  context: WorkflowOperationContext = captureWorkflowOperationContext(),
) {
  assertWorkflowOperationContext(context);
  let promise = graphFinalizationPromise;
  if (promise && !workflowOperationContextsMatch(graphFinalizationContext, context)) {
    // A finalizer belongs to the document/form that created it. Never await it
    // from a different tab (including A -> B -> A); detach it and let the
    // current document resume from its own persisted pending state below.
    graphFinalizationToken += 1;
    graphFinalizationPromise = null;
    graphFinalizationContext = null;
    promise = null;
  }
  if (!promise) {
    const studio = useStudioStore.getState();
    const finalization = studio.graphFinalization;
    const recoverableLegacyTimeout = Boolean(
      finalization?.status === 'error' &&
      finalization.timedOutGroups.includes('overall graph preparation') &&
      finalization.message?.startsWith('Graph preparation timed out after '),
    );
    if (
      studio.graphBinding &&
      (!finalization || recoverableLegacyTimeout) &&
      restoreFinalizedGraphState(studio.graphBinding, studio.form, finalization)
    ) {
      return true;
    }
    if (finalization?.status === 'error') {
      throw new Error(finalization.message ?? 'Studio graph finalization failed.');
    }
    if (finalization?.status === 'pending') {
      if (!studio.graphBinding) {
        throw new Error('Studio graph finalization is pending without a managed graph binding.');
      }
      scheduleStudioGraphFinalization(studio.graphBinding, studio.form, finalization.skeletonMs ?? 0, context);
      return waitForStudioGraphFinalization(timeout, context);
    }
    if (!finalization && studio.graphBinding) {
      studio.setGraphFinalization({
        status: 'pending',
        bindingFingerprint: studio.graphBinding.fingerprint,
        startedAt: Date.now(),
        skeletonMs: 0,
        timedOutGroups: [],
        managedEdgeCount: studio.graphBinding.managedEdgeIds.length,
        message: 'Revalidating restored graph...',
      });
      scheduleStudioGraphFinalization(studio.graphBinding, resolveGraphResourceForm(studio.form), 0, context);
      return waitForStudioGraphFinalization(timeout, context);
    }
    return true;
  }

  const result = await waitForSettledGraphFinalization(promise, timeout);
  assertWorkflowOperationContext(context);
  if (result.status === 'timeout') {
    markGraphFinalizationWaitTimedOut(promise, timeout, context);
    return false;
  }
  if (result.status === 'error') throw result.error;
  return true;
}

export function getStudioGraphRunBlockingMessage(form: StudioFormState = useStudioStore.getState().form) {
  const plannedForm = resolveGraphResourceForm(form);
  if (
    STUDIO_MODEL_PROFILES[plannedForm.modelType]?.family !== 'Qwen Image' ||
    isVideoMode(plannedForm.mode) ||
    usesDiffusersImageFacade(plannedForm) ||
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

export function validateStudioGraphReadyForRun(form: StudioFormState = useStudioStore.getState().form) {
  syncStudioGraphValues(form);
  const issue = getStudioGraphRunBlockingMessage(form);
  if (issue) {
    useStudioStore.getState().setLastError(issue);
    throw new Error(issue);
  }
}

export async function ensureStudioGraphReadyForRun(
  form: StudioFormState = useStudioStore.getState().form,
  context: WorkflowOperationContext = captureWorkflowOperationContext(),
) {
  assertWorkflowOperationContext(context);
  const validatedAutoPlan = form.resourceMode === 'auto' ? useStudioStore.getState().autoResourcePlan : null;
  if (!useStudioStore.getState().graphBinding) {
    throw new Error('Create or open a managed workflow before running it.');
  }
  const finalized = await waitForStudioGraphFinalization(9000, context);
  assertWorkflowOperationContext(context);
  if (!finalized) {
    throw new Error(
      useStudioStore.getState().graphFinalization?.message ??
        'Graph preparation timed out. Retry the run after the graph is ready.',
    );
  }
  assertWorkflowOperationContext(context);
  syncStudioGraphValues(form);

  // Dynamic field signals can normalize form values during finalization.
  // Keep the just-validated Auto plan when it still targets this workflow,
  // without rebuilding or replacing any graph nodes at Run time.
  const currentForm = useStudioStore.getState().form;
  assertWorkflowOperationContext(context);
  const validatedCandidate = selectedAutoCandidate(validatedAutoPlan, currentForm);
  if (
    validatedAutoPlan &&
    validatedCandidate &&
    currentForm.resourceMode === 'auto' &&
    (!validatedCandidate.modelType || validatedCandidate.modelType === currentForm.modelType) &&
    (!validatedCandidate.mode || validatedCandidate.mode === currentForm.mode)
  ) {
    useStudioStore.getState().setAutoResourcePlan(validatedAutoPlan);
  }

  // Finalization may normalize resource fields (including the Auto-selected
  // offload/quantization recipe). Re-validating the stale caller snapshot here
  // would write those old values back into the graph immediately before Run.
  validateStudioGraphReadyForRun(currentForm);
  assertWorkflowOperationContext(context);
}

export { NODE_KEYS as STUDIO_NODE_KEYS };
